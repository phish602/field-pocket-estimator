// Fresh-device restore fidelity, replayed on the exact clean-lane dataset that
// exposed the losses: a 12-hour technician at $95 ($45 internal), a 3-ton
// condenser ($2,400 / $1,800 internal, quantity left blank) and an evaporator
// coil ($900 / $650 internal) -- $4,440 billed at a 33% margin, a $1,500 check
// payment with a note, on an Estimating project.
//
// Every step goes through the production owners: the backend mapper, the shared
// line-item contract, the persistence payload builders, the cloud restore
// mappers and the invoice normalizer. Nothing here re-implements their logic.

import fs from "fs";
import path from "path";
import { mapLocalInvoiceToBackendInvoice } from "../utils/backendDataMapper";
import { extractFinancialSummaryFromDoc, normalizeInvoiceRecord } from "../utils/invoices";
import { buildParentLineItemContract } from "./cloudLineItemContract";
import { mapCloudInvoiceLineItem, mapCloudPayment, mapCloudProjectToLocal } from "./supabaseCloudRestore";
import {
  buildTargetInvoicePersistencePayloads,
  buildTargetProjectPersistencePayload,
} from "./supabaseMigrationWriter";

const PAYMENT = {
  id: "pay_clean_lane",
  amount: 1500,
  method: "check",
  paidAt: "2026-10-31",
  note: "Clean-lane test deposit",
};

// The builder saves an invoice together with the financial summary its engine
// priced, so the original record carries its own cost basis.
function buildOriginalInvoice() {
  const sections = {
    ui: { materialsMode: "itemized" },
    labor: {
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
      lines: [{ id: "l1", role: "technician", label: "Technician", qty: "1", hours: "12", rate: "95", trueRateInternal: "45" }],
    },
    materials: {
      items: [
        { id: "m1", desc: "3-ton condenser", qty: "", priceEach: "2400", unitCostInternal: "1800", costInternal: "1800" },
        { id: "m2", desc: "Matching evaporator coil", qty: 1, priceEach: "900", unitCostInternal: "650", costInternal: "650" },
      ],
    },
  };
  return {
    ...extractFinancialSummaryFromDoc(sections),
    ...sections,
    id: "inv_clean_lane",
    invoiceNumber: "INV-0001",
    estimateNumber: "EST-0001",
    sourceEstimateId: "doc_clean_lane",
    status: "sent",
    invoiceTotal: 4440,
    payments: [PAYMENT],
  };
}

// The cloud rows the persistence payload builder writes for this invoice.
function persistInvoice(invoice) {
  return buildTargetInvoicePersistencePayloads({
    invoice,
    companyId: "company-clean-lane",
    userId: "user-clean-lane",
    invoiceId: "cloud-invoice",
  });
}

// The thin record a fresh-device restore stores: the parent total plus the
// children re-read through the real restore mapper.
function restoreThinInvoice(invoice) {
  const backend = mapLocalInvoiceToBackendInvoice(invoice, {});
  const { rows } = buildParentLineItemContract({
    entityType: "invoice",
    parentLegacyId: backend.legacy_local_id,
    parentColumn: "invoice_id",
    items: backend.line_items,
  });
  return {
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    sourceEstimateId: invoice.sourceEstimateId,
    status: invoice.status,
    invoiceTotal: invoice.invoiceTotal,
    amountPaid: 1500,
    balanceRemaining: 2940,
    lineItems: rows.map((row) => mapCloudInvoiceLineItem({
      legacy_local_id: row.legacy_local_id,
      description: row.description,
      quantity: row.quantity,
      unit: row.unit,
      unit_price: row.unit_price,
      total_price: row.total,
      sort_order: row.sort_order,
      metadata: row.metadata || {},
    })),
    payments: persistInvoice(invoice).paymentPayloads.map((row) => mapCloudPayment(row)),
  };
}

describe("restored invoice keeps its billable structure and cost basis", () => {
  const original = normalizeInvoiceRecord(buildOriginalInvoice());
  const restored = normalizeInvoiceRecord(restoreThinInvoice(buildOriginalInvoice()));

  test("the original device prices the invoice at $4,440 and 33%", () => {
    expect(original.invoiceTotal).toBe(4440);
    expect(original.totalCost).toBe(2990);
    expect(original.marginPct).toBe(33);
  });

  test("labor hours, rate and internal rate survive restore", () => {
    expect(restored.labor.lines).toHaveLength(1);
    expect(restored.labor.lines[0]).toEqual(expect.objectContaining({
      role: "technician",
      qty: 1,
      hours: 12,
      rate: 95,
      trueRateInternal: 45,
    }));
  });

  test("material prices and internal unit costs survive restore", () => {
    expect(restored.materials.items.map((item) => [item.desc, item.priceEach, item.unitCostInternal])).toEqual([
      ["3-ton condenser", 2400, 1800],
      ["Matching evaporator coil", 900, 650],
    ]);
  });

  test("the restored financial summary matches the original, not a 100% margin", () => {
    ["invoiceTotal", "totalCost", "laborCost", "materialsCost", "laborRevenue", "materialsRevenue", "grossProfit", "marginPct"]
      .forEach((field) => expect([field, restored[field]]).toEqual([field, original[field]]));
    expect(restored.marginPct).toBe(33);
    expect(restored.financials.totalCost).toBe(2990);
  });

  test("a restored record that already carries its own cost is not repriced", () => {
    const thin = { ...restoreThinInvoice(buildOriginalInvoice()), totalCost: 1234 };
    expect(normalizeInvoiceRecord(thin).totalCost).toBe(1234);
  });

  test("restored children are not duplicated into a generic array", () => {
    expect(restored.lineItems).toBeUndefined();
  });
});

describe("payment note survives the cloud round trip", () => {
  test("the persistence payload writes the note to invoice_payments.notes", () => {
    const [payload] = persistInvoice(buildOriginalInvoice()).paymentPayloads;
    expect(payload).toEqual(expect.objectContaining({
      legacy_local_id: "pay_clean_lane",
      amount: 1500,
      method: "check",
      notes: "Clean-lane test deposit",
    }));
  });

  test("restore reads the note back and the normalizer keeps it", () => {
    const restored = normalizeInvoiceRecord(restoreThinInvoice(buildOriginalInvoice()));
    expect(restored.payments).toHaveLength(1);
    expect(restored.payments[0]).toEqual(expect.objectContaining({
      id: "pay_clean_lane",
      amount: 1500,
      method: "check",
      paidAt: "2026-10-31",
      note: "Clean-lane test deposit",
    }));
  });

  test("a payment without a note writes no note and restores without one", () => {
    const invoice = { ...buildOriginalInvoice(), payments: [{ ...PAYMENT, note: "" }] };
    const [payload] = persistInvoice(invoice).paymentPayloads;
    expect(payload.notes).toBeNull();
    expect(mapCloudPayment(payload)).not.toHaveProperty("note");
  });
});

describe("project status survives the cloud round trip", () => {
  test("an Estimating project is persisted and restored as estimating", () => {
    const { projectPayload } = buildTargetProjectPersistencePayload({
      project: { id: "proj_clean_lane", customerId: "c1", projectName: "Clean Lane AC Replacement", status: "estimating" },
      companyId: "company-clean-lane",
      userId: "user-clean-lane",
    });
    expect(projectPayload.status).toBe("estimating");
    expect(mapCloudProjectToLocal(projectPayload, new Map()).status).toBe("estimating");
  });

  test.each(["draft", "active", "completed", "archived"])("%s is still persisted as itself", (status) => {
    const { projectPayload } = buildTargetProjectPersistencePayload({
      project: { id: `proj_${status}`, projectName: "Status check", status },
      companyId: "company-clean-lane",
      userId: "user-clean-lane",
    });
    expect(projectPayload.status).toBe(status);
  });

  // The writer may only persist values the database accepts. Read the latest
  // projects_status_check definition from the migrations so the client can
  // never be widened without the schema.
  test("the latest projects_status_check migration accepts every persisted status", () => {
    const dir = path.join(__dirname, "../../supabase/migrations");
    const definitions = fs.readdirSync(dir).sort()
      .map((file) => fs.readFileSync(path.join(dir, file), "utf8"))
      .flatMap((sql) => sql.match(/projects_status_check"?\s+CHECK\s*\(\(?"?status"?\s*=\s*ANY\s*\(ARRAY\[[^\]]*\]/gi) || []);
    const allowed = (definitions[definitions.length - 1].match(/'([a-z_]+)'/g) || []).map((value) => value.slice(1, -1));
    ["draft", "estimating", "active", "completed", "archived"].forEach((status) => expect(allowed).toContain(status));
  });
});
