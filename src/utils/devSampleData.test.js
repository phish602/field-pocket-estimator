import {
  DEV_SAMPLE_DATA_VERSION,
  buildDevSampleDataset,
  seedDevSampleData,
} from "./devSampleData";
import {
  mapLocalInvoiceToBackendInvoice,
  mapLocalSnapshotToBackendDraft,
} from "./backendDataMapper";
import { scanLocalDataIntegrity } from "../lib/localDataIntegrity";
import { buildParentLineItemContract } from "../lib/cloudLineItemContract";
import { buildEstimateRestorePayload } from "../lib/supabaseEstimateRestorePayload";
import { mapCloudInvoiceLineItem } from "../lib/supabaseCloudRestore";
import { planProvenStaleInvoiceLineItems } from "../lib/supabaseMigrationWriter";
import { normalizeInvoiceRecord } from "./invoices";
import { STORAGE_KEYS } from "../constants/storageKeys";

function buildSnapshot() {
  return {
    companyProfile: { id: "sample_company", companyName: "Sample Contract Co." },
    ...buildDevSampleDataset(),
    settings: {},
    scopeTemplates: [],
    auditEvents: [],
  };
}

function hasBusinessContent(line = {}) {
  return ["description", "quantity", "unit", "unit_price", "unit_cost", "total", "hours"]
    .some((key) => line[key] !== null && line[key] !== undefined && line[key] !== "");
}

function childRows(entityType, record) {
  const mapped = entityType === "estimate"
    ? mapLocalSnapshotToBackendDraft({ ...buildSnapshot(), estimates: [record], invoices: [] }).estimates[0]
    : mapLocalInvoiceToBackendInvoice(record, {});
  return buildParentLineItemContract({
    entityType,
    parentLegacyId: mapped.legacy_local_id,
    parentColumn: entityType === "estimate" ? "estimate_id" : "invoice_id",
    items: mapped.line_items,
  }).rows;
}

function restoreInvoiceFromCloudShape(invoice) {
  const children = childRows("invoice", invoice).map((row) => mapCloudInvoiceLineItem({
    legacy_local_id: row.legacy_local_id,
    description: row.description,
    quantity: row.quantity,
    unit: row.unit,
    unit_price: row.unit_price,
    total_price: row.total_price,
    sort_order: row.sort_order,
    metadata: row.metadata,
  }));
  return normalizeInvoiceRecord({
    id: invoice.id,
    customerId: invoice.customerId,
    projectId: invoice.projectId,
    sourceEstimateId: invoice.sourceEstimateId,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    paymentStatus: invoice.paymentStatus,
    invoiceTotal: invoice.invoiceTotal,
    amountPaid: invoice.amountPaid,
    date: invoice.date,
    dueDate: invoice.dueDate,
    lineItems: children,
    payments: invoice.payments,
  });
}

function stored(key) {
  return JSON.parse(localStorage.getItem(key) || "[]");
}

describe("current development sample data", () => {
  beforeEach(() => localStorage.clear());

  test("uses the current local model without integrity blockers", () => {
    const snapshot = buildSnapshot();
    const result = scanLocalDataIntegrity(snapshot);

    expect(result.blockers).toEqual([]);
  });

  test("does not map semantically empty fixture rows into cloud children", () => {
    const snapshot = buildSnapshot();
    const mapped = mapLocalSnapshotToBackendDraft(snapshot, {
      companyId: "sample_company",
      userId: "sample_user",
    });
    const emptyEstimateChildren = mapped.estimates.flatMap((estimate) => estimate.line_items)
      .filter((line) => !hasBusinessContent(line));
    const emptyInvoiceChildren = mapped.invoices.flatMap((invoice) => invoice.line_items)
      .filter((line) => !hasBusinessContent(line));

    expect(emptyEstimateChildren).toEqual([]);
    expect(emptyInvoiceChildren).toEqual([]);
  });

  test("has the exact current persisted sample-child contract", () => {
    const sample = buildDevSampleDataset();
    const mapped = mapLocalSnapshotToBackendDraft(buildSnapshot(), {
      companyId: "sample_company",
      userId: "sample_user",
    });
    const invoiceChildren = sample.invoices.flatMap((invoice) => childRows("invoice", invoice));
    const estimateChildren = sample.estimates.flatMap((estimate) => childRows("estimate", estimate));

    expect(sample).toEqual(expect.objectContaining({
      customers: expect.any(Array),
      projects: expect.any(Array),
      estimates: expect.any(Array),
      invoices: expect.any(Array),
    }));
    expect(sample.customers).toHaveLength(6);
    expect(sample.projects).toHaveLength(6);
    expect(sample.estimates).toHaveLength(8);
    expect(sample.invoices).toHaveLength(8);
    expect(sample.invoices.flatMap((invoice) => invoice.payments)).toHaveLength(3);
    expect(invoiceChildren).toEqual([]);
    expect(estimateChildren).toHaveLength(40);
    expect(estimateChildren.map((row) => row.legacy_local_id)).not.toContain(
      "estimate:sample_estimate_copper_state_unit_turn_add_alt:line:2"
    );
    expect(mapped.invoices.map((invoice) => invoice.total)).toEqual(sample.invoices.map((invoice) => invoice.invoiceTotal));
    expect(sample.invoices.flatMap((invoice) => invoice.payments.map((payment) => [payment.amount, payment.method])))
      .toEqual([[3430.26, "ach"], [3909.84, "card"], [2600, "ach"]]);
  });

  test("has deterministic current cloud identities, complete estimate restore payloads, and invoice round trips", () => {
    const first = buildDevSampleDataset();
    const second = buildDevSampleDataset();
    const firstMapped = mapLocalSnapshotToBackendDraft(buildSnapshot(), { companyId: "sample_company", userId: "sample_user" });
    const secondMapped = mapLocalSnapshotToBackendDraft({
      companyProfile: { id: "sample_company", companyName: "Sample Contract Co." },
      ...second,
      settings: {},
      scopeTemplates: [],
      auditEvents: [],
    }, { companyId: "sample_company", userId: "sample_user" });

    expect(first.customers.map((record) => record.id)).toEqual(second.customers.map((record) => record.id));
    expect(first.projects.map((record) => record.id)).toEqual(second.projects.map((record) => record.id));
    expect(first.estimates.map((record) => record.id)).toEqual(second.estimates.map((record) => record.id));
    expect(first.invoices.map((record) => record.id)).toEqual(second.invoices.map((record) => record.id));
    expect(firstMapped.estimates.flatMap((record) => childRows("estimate", record).map((row) => row.legacy_local_id)))
      .toEqual(secondMapped.estimates.flatMap((record) => childRows("estimate", record).map((row) => row.legacy_local_id)));
    expect(firstMapped.invoices.flatMap((record) => childRows("invoice", record).map((row) => row.legacy_local_id)))
      .toEqual(secondMapped.invoices.flatMap((record) => childRows("invoice", record).map((row) => row.legacy_local_id)));

    first.estimates.forEach((estimate) => {
      const payload = buildEstimateRestorePayload(estimate);
      expect(payload).toEqual(expect.objectContaining({ legacyLocalId: estimate.id, estimate }));
    });

    first.invoices.forEach((invoice) => {
      const restored = restoreInvoiceFromCloudShape(invoice);
      expect(restored).toEqual(expect.objectContaining({
        id: invoice.id,
        sourceEstimateId: invoice.sourceEstimateId,
        invoiceNumber: invoice.invoiceNumber,
        invoiceTotal: invoice.invoiceTotal,
      }));
      expect(restored.payments.map((payment) => payment.amount)).toEqual(invoice.payments.map((payment) => payment.amount));
      expect(childRows("invoice", restored)).toEqual(childRows("invoice", invoice));
    });
  });

  test("reseeds the current version idempotently, replaces a legacy registry, and preserves real records", () => {
    const realCustomer = { id: "real_customer", fullName: "Real Customer" };
    const oldSampleCustomer = { id: "sample_customer_legacy", fullName: "Old Sample" };
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([realCustomer, oldSampleCustomer]));
    localStorage.setItem("estipaid-dev-sample-registry-v1", JSON.stringify({
      seededAt: 1,
      customers: [oldSampleCustomer.id],
      projects: [],
      estimates: [],
      invoices: [],
    }));

    const first = seedDevSampleData();
    const once = stored(STORAGE_KEYS.CUSTOMERS);
    const second = seedDevSampleData();
    const twice = stored(STORAGE_KEYS.CUSTOMERS);
    const registry = JSON.parse(localStorage.getItem("estipaid-dev-sample-registry-v1"));

    expect(first.replacedPreviousSampleVersion).toBeNull();
    expect(second.version).toBe(DEV_SAMPLE_DATA_VERSION);
    expect(registry.version).toBe(DEV_SAMPLE_DATA_VERSION);
    expect(once.map((record) => record.id)).toEqual(twice.map((record) => record.id));
    expect(twice).toContainEqual(realCustomer);
    expect(twice.map((record) => record.id)).not.toContain(oldSampleCustomer.id);
    expect(new Set(twice.map((record) => record.id)).size).toBe(twice.length);
  });

  test("reseeds restored sample projects without a local-only registry", () => {
    seedDevSampleData();
    localStorage.removeItem("estipaid-dev-sample-registry-v1");

    seedDevSampleData();

    const projects = stored(STORAGE_KEYS.PROJECTS);
    expect(projects).toHaveLength(6);
    expect(new Set(projects.map((record) => record.id)).size).toBe(projects.length);
  });

  test("reproduces the historical manual-invoice placeholder mismatch with exact stale child identities", () => {
    // `9c626a9` (the last material sample-data replacement) built each manual
    // sample invoice with these persisted blank labor/material entries. Before
    // the later mapper filter, they produced cloud children despite carrying no
    // business content. The current generator must never recreate them.
    const parentIds = [
      "sample_invoice_copper_state_turn_cycle_one",
      "sample_invoice_copper_state_after_hours_punch",
    ];
    const confirmedInvoiceIds = new Map(parentIds.map((parent, index) => [parent, `cloud_invoice_${index + 1}`]));
    const historicalCloudRows = parentIds.flatMap((parent, parentIndex) => {
      const contract = buildParentLineItemContract({
        entityType: "invoice",
        parentLegacyId: parent,
        parentCloudId: `cloud_invoice_${parentIndex + 1}`,
        parentColumn: "invoice_id",
        items: [
          { id: `${parent}_labor_blank`, kind: "labor" },
          { id: `${parent}_material_blank`, kind: "material" },
        ],
      });
      return contract.rows.map((row, rowIndex) => ({ id: `historical_${parentIndex}_${rowIndex}`, ...row }));
    });
    const currentPayloads = buildDevSampleDataset().invoices
      .filter((invoice) => parentIds.includes(invoice.id))
      .flatMap((invoice) => childRows("invoice", invoice));
    const plan = planProvenStaleInvoiceLineItems(historicalCloudRows, currentPayloads, confirmedInvoiceIds);

    expect(currentPayloads).toEqual([]);
    expect(plan.counts.provenStalePlaceholder).toBe(4);
    expect(plan.counts.unresolvedExtra).toBe(0);
    expect(plan.provenStaleRows.map((row) => row.legacy_local_id).sort()).toEqual([
      "invoice:sample_invoice_copper_state_after_hours_punch:line:0",
      "invoice:sample_invoice_copper_state_after_hours_punch:line:1",
      "invoice:sample_invoice_copper_state_turn_cycle_one:line:0",
      "invoice:sample_invoice_copper_state_turn_cycle_one:line:1",
    ]);
  });
});
