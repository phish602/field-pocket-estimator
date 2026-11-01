import { runSupabaseCloudMutationWrite } from "./supabaseCloudMutationWriter";
import {
  buildTargetEstimatePersistencePayloads,
  buildTargetInvoicePersistencePayloads,
} from "./supabaseMigrationWriter";
import { ensureCurrentDeviceCanWriteCloud, operationFenceStillCurrent } from "./supabaseDeviceLock";
import { CLOUD_MUTATION_ENTITY, CLOUD_MUTATION_OPERATION } from "./cloudMutationLedger";

let mockClient;
const mockUpdateSupabaseAppRestoreBundle = jest.fn();
const mockReadSupabaseAppRestoreBundle = jest.fn();
const mockValidateSupabaseAppRestoreBundle = jest.fn();

jest.mock("./supabaseClient", () => ({ getSupabaseClient: () => mockClient }));
jest.mock("./supabaseDeviceLock", () => ({
  ensureCurrentDeviceCanWriteCloud: jest.fn(),
  operationFenceStillCurrent: jest.fn(),
  buildStaleOperationResult: jest.fn(() => ({ ok: false, code: "device_generation_changed", error: "Device changed.", deviceLockLost: true })),
}));
jest.mock("./supabaseMigrationWriter", () => ({
  buildTargetCustomerPersistencePayload: jest.fn(),
  buildTargetEstimatePersistencePayloads: jest.fn(),
  buildTargetInvoicePersistencePayloads: jest.fn(),
  buildTargetProjectPersistencePayload: jest.fn(),
}));
jest.mock("./supabaseAppRestoreBundle", () => ({
  APP_RESTORE_BUNDLE_STATUS: { COMPLETED: "completed" },
  validateSupabaseAppRestoreBundle: (...args) => mockValidateSupabaseAppRestoreBundle(...args),
  updateSupabaseAppRestoreBundle: (...args) => mockUpdateSupabaseAppRestoreBundle(...args),
  readSupabaseAppRestoreBundle: (...args) => mockReadSupabaseAppRestoreBundle(...args),
}));

const {
  buildTargetCustomerPersistencePayload,
  buildTargetProjectPersistencePayload,
} = require("./supabaseMigrationWriter");
function createClient({ paymentMismatch = false, estimateHeaderMismatch = false, estimateDateMismatch = false, estimateLineMismatch = false, unexpectedEstimateLine = false, estimateCleanupError = false, missingEstimateProject = false, unexpectedInvoicePayment = false, paymentCleanupError = false } = {}) {
  const operations = [];
  const rows = {
    customers: [{ id: "cust-cloud", legacy_local_id: "cust-1", company_id: "company-1" }],
    projects: [{ id: "proj-cloud", legacy_local_id: "proj-1", company_id: "company-1" }],
    estimates: [{ id: "est-cloud", legacy_local_id: "est-1", company_id: "company-1" }],
    estimate_line_items: [{ id: "unrelated-estimate-line", legacy_local_id: "estimate:est-1:line:0", estimate_id: "est-cloud", company_id: "company-1", unit_price: 77 }],
    invoices: [{ id: "unrelated-invoice", legacy_local_id: "old-invoice", company_id: "company-1" }],
    invoice_line_items: [{ id: "old-line", legacy_local_id: "old-line", invoice_id: "unrelated-invoice", company_id: "company-1" }],
    invoice_payments: [{ id: "old-payment", legacy_local_id: "old-payment", invoice_id: "unrelated-invoice", company_id: "company-1" }],
  };
  if (missingEstimateProject) rows.projects = [];
  if (unexpectedEstimateLine) rows.estimate_line_items.push({
    id: "stale-target-line",
    legacy_local_id: "estimate:estimate-2606:line:99",
    estimate_id: "estimates-cloud-2",
    company_id: "company-1",
  });
  // A payment left under the TARGET invoice by an earlier partial write. It is
  // the exact row the money-side cleanup must remove before verification.
  if (unexpectedInvoicePayment) rows.invoice_payments.push({
    id: "stale-target-payment",
    legacy_local_id: "pay-stale",
    invoice_id: "invoices-cloud-2",
    company_id: "company-1",
  });

  class Query {
    constructor(table) { this.table = table; this.filters = []; this.mode = "select"; this.payload = null; this.columns = ""; }
    select(columns) { this.columns = columns; return this; }
    eq(column, value) { this.filters.push([column, value]); return this; }
    in(column, values) { this.filters.push([column, values]); return this; }
    upsert(payload) { this.mode = "upsert"; this.payload = payload; return this; }
    delete() { this.mode = "delete"; return this; }
    filtered() {
      return rows[this.table].filter((row) => this.filters.every(([column, value]) => (
        Array.isArray(value) ? value.includes(row[column]) : row[column] === value
      )));
    }
    execute() {
      operations.push({ table: this.table, mode: this.mode, filters: [...this.filters], payload: this.payload });
      if (this.mode === "upsert") {
        const output = this.payload.map((payload) => {
          const existing = rows[this.table].find((row) => row.company_id === payload.company_id && row.legacy_local_id === payload.legacy_local_id);
          const id = existing?.id || `${this.table}-cloud-${rows[this.table].length + 1}`;
          const next = { ...(existing || {}), ...payload, id };
          if (existing) Object.assign(existing, next); else rows[this.table].push(next);
          return { id, legacy_local_id: payload.legacy_local_id };
        });
        return { data: output, error: null };
      }
      if (this.mode === "delete") {
        if (estimateCleanupError && this.table === "estimate_line_items") {
          return { data: null, error: { message: "permission denied" } };
        }
        // Exactly what an ungranted authenticated DELETE returns through
        // PostgREST before any application proof can run.
        if (paymentCleanupError && this.table === "invoice_payments") {
          return { data: null, error: { message: "permission denied for table invoice_payments" } };
        }
        const deleted = this.filtered();
        rows[this.table] = rows[this.table].filter((row) => !deleted.includes(row));
        return { data: deleted.map((row) => ({ id: row.id })), error: null };
      }
      const data = this.filtered().map((row) => {
        if (paymentMismatch && this.table === "invoice_payments" && row.legacy_local_id === "pay-1") return { ...row, paid_at: "2026-08-22T00:00:00.000Z" };
        if (estimateHeaderMismatch && this.table === "estimates" && row.legacy_local_id === "estimate-2606") return { ...row, total_amount: 1 };
        if (estimateDateMismatch && this.table === "estimates" && row.legacy_local_id === "estimate-2606") return { ...row, estimate_date: "2026-06-27" };
        if (estimateLineMismatch && this.table === "estimate_line_items" && row.legacy_local_id === "estimate:estimate-2606:line:0") return { ...row, unit_price: 1 };
        return { ...row };
      });
      return { data, error: null };
    }
    maybeSingle() { const result = this.execute(); return Promise.resolve({ ...result, data: result.data[0] || null }); }
    then(resolve, reject) { return Promise.resolve(this.execute()).then(resolve, reject); }
  }
  return { client: { from: (table) => new Query(table) }, operations, rows };
}

function mutation() {
  return {
    mutationId: "mutation-1", revision: 1, companyId: "company-1", documentId: "inv-1",
    entityType: CLOUD_MUTATION_ENTITY.INVOICE,
    operation: CLOUD_MUTATION_OPERATION.UPSERT,
    payload: { id: "inv-1", customerId: "cust-1", projectId: "proj-1", sourceEstimateId: "est-1", payments: [{ id: "pay-1" }] },
  };
}

function estimateMutation() {
  return {
    mutationId: "mutation-estimate-1",
    revision: 2,
    companyId: "company-1",
    entityType: "estimate",
    operation: CLOUD_MUTATION_OPERATION.UPSERT,
    documentId: "estimate-2606",
    payload: {
      id: "estimate-2606",
      estimateNumber: "EST-2606",
      customerId: "cust-1",
      projectId: "proj-1",
      date: "2026-06-26",
      total: 6000,
      materials: { items: [{ id: "material-1", desc: "Fixtures", qty: 1, priceEach: 2000 }] },
    },
  };
}

beforeEach(() => {
  const fixture = createClient();
  mockClient = fixture.client;
  mockClient.fixture = fixture;
  ensureCurrentDeviceCanWriteCloud.mockReset();
  ensureCurrentDeviceCanWriteCloud.mockResolvedValue({ ok: true, access: { fence: { companyId: "company-1", deviceId: "device-1", lockVersion: 5 } } });
  operationFenceStillCurrent.mockReset();
  operationFenceStillCurrent.mockReturnValue(true);
  buildTargetCustomerPersistencePayload.mockReset();
  buildTargetCustomerPersistencePayload.mockImplementation(({ customer, companyId }) => ({
    mappedCustomer: { legacy_local_id: customer.id },
    customerPayload: {
      company_id: companyId,
      legacy_local_id: customer.id,
      display_name: customer.name,
      company_name: null,
      contact_name: customer.name,
      phone: customer.phone || null,
      email: customer.email || null,
      billing_address: null,
      customer_type: "residential",
      customer_status: "active",
    },
  }));
  buildTargetProjectPersistencePayload.mockReset();
  buildTargetProjectPersistencePayload.mockImplementation(({ project, companyId, customerId = null }) => ({
    mappedProject: { customer_legacy_local_id: project.customerId },
    projectPayload: {
      company_id: companyId,
      legacy_local_id: project.id,
      customer_id: customerId,
      project_number: project.projectNumber || null,
      project_name: project.name,
      site_address: null,
      status: "active",
      notes: null,
      scope_summary: null,
    },
  }));
  buildTargetInvoicePersistencePayloads.mockReset();
  buildTargetInvoicePersistencePayloads.mockImplementation(({ invoiceId = null }) => ({
    mappedInvoice: { customer_legacy_local_id: "cust-1", project_legacy_local_id: "proj-1", source_estimate_legacy_local_id: "est-1" },
    invoicePayload: { company_id: "company-1", legacy_local_id: "inv-1", customer_id: "cust-cloud", project_id: "proj-cloud", estimate_id: "est-cloud", invoice_number: "INV-1", total_amount: 50 },
    lineItemPayloads: invoiceId ? [{ company_id: "company-1", legacy_local_id: "invoice:inv-1:line-1", invoice_id: invoiceId, description: "Work", total_price: 50 }] : [],
    lineItemIssues: [],
    paymentPayloads: invoiceId ? [{ company_id: "company-1", legacy_local_id: "pay-1", invoice_id: invoiceId, amount: 50, paid_at: "2026-08-23T00:00:00.000Z" }] : [],
  }));
  buildTargetEstimatePersistencePayloads.mockReset();
  buildTargetEstimatePersistencePayloads.mockImplementation(({ estimateId = null }) => ({
    mappedEstimate: { customer_legacy_local_id: "cust-1", project_legacy_local_id: "proj-1" },
    estimatePayload: {
      company_id: "company-1",
      legacy_local_id: "estimate-2606",
      customer_id: "cust-cloud",
      project_id: "proj-cloud",
      estimate_number: "EST-2606",
      estimate_date: "2026-06-26",
      status: "draft",
      total_amount: 6000,
      restore_payload: { version: 1, estimate: estimateMutation().payload },
      restore_payload_version: "1.0.0",
    },
    lineItemPayloads: estimateId ? [{
      company_id: "company-1",
      legacy_local_id: "estimate:estimate-2606:line:0",
      estimate_id: estimateId,
      sort_order: 0,
      line_role: "material",
      description: "Fixtures",
      quantity: 1,
      unit: null,
      unit_price: 2000,
      total_price: null,
      metadata: null,
    }] : [],
    lineItemIssues: [],
  }));
  mockUpdateSupabaseAppRestoreBundle.mockReset();
  mockReadSupabaseAppRestoreBundle.mockReset();
  mockValidateSupabaseAppRestoreBundle.mockReset();
  mockValidateSupabaseAppRestoreBundle.mockReturnValue({ valid: true });
});

test("writes and semantically rereads only one exact customer", async () => {
  const target = {
    mutationId: "mutation-customer-1", revision: 3, companyId: "company-1",
    entityType: CLOUD_MUTATION_ENTITY.CUSTOMER, operation: CLOUD_MUTATION_OPERATION.UPSERT,
    documentId: "cust-2", payload: { id: "cust-2", name: "New Customer", phone: "555-0102" },
  };
  const unrelatedBefore = JSON.parse(JSON.stringify(mockClient.fixture.rows.customers));
  const result = await runSupabaseCloudMutationWrite({ mutation: target, configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage });
  expect(result).toEqual(expect.objectContaining({ ok: true, verified: true, documentId: "cust-2" }));
  expect(mockClient.fixture.operations.filter((operation) => operation.mode === "upsert")).toEqual([
    expect.objectContaining({ table: "customers", payload: [expect.objectContaining({ legacy_local_id: "cust-2" })] }),
  ]);
  expect(mockClient.fixture.rows.customers.find((row) => row.legacy_local_id === "cust-1")).toEqual(unrelatedBefore[0]);
});

test("writes and semantically rereads only one exact project with its existing customer parent", async () => {
  const target = {
    mutationId: "mutation-project-1", revision: 4, companyId: "company-1",
    entityType: CLOUD_MUTATION_ENTITY.PROJECT, operation: CLOUD_MUTATION_OPERATION.UPSERT,
    documentId: "proj-2", payload: { id: "proj-2", name: "Kitchen", customerId: "cust-1", projectNumber: "JOB-2" },
  };
  const result = await runSupabaseCloudMutationWrite({ mutation: target, configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage });
  expect(result).toEqual(expect.objectContaining({ ok: true, verified: true, documentId: "proj-2" }));
  expect(mockClient.fixture.operations.filter((operation) => operation.mode === "upsert")).toEqual([
    expect.objectContaining({ table: "projects", payload: [expect.objectContaining({ legacy_local_id: "proj-2", customer_id: "cust-cloud" })] }),
  ]);
});

test("writes and strictly verifies only the target invoice family", async () => {
  const result = await runSupabaseCloudMutationWrite({ mutation: mutation(), configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage });
  expect(result).toEqual(expect.objectContaining({ ok: true, verified: true, revision: 1 }));
  const { operations, rows } = mockClient.fixture;
  expect(operations.filter((operation) => operation.mode === "upsert").map((operation) => operation.table)).toEqual(["invoices", "invoice_line_items", "invoice_payments"]);
  operations.filter((operation) => operation.mode === "select").forEach((operation) => {
    expect(operation.filters).toContainEqual(["company_id", "company-1"]);
    expect(operation.filters.some(([column]) => column === "legacy_local_id" || column === "invoice_id")).toBe(true);
  });
  expect(rows.invoices.find((row) => row.id === "unrelated-invoice").legacy_local_id).toBe("old-invoice");
  expect(rows.invoice_payments.find((row) => row.id === "old-payment").invoice_id).toBe("unrelated-invoice");
  expect(buildTargetInvoicePersistencePayloads).toHaveBeenCalled();
});

test("successful upsert with a mismatched payment date does not verify", async () => {
  const fixture = createClient({ paymentMismatch: true });
  mockClient = fixture.client;
  mockClient.fixture = fixture;
  const result = await runSupabaseCloudMutationWrite({ mutation: mutation(), configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage });
  expect(result).toEqual(expect.objectContaining({ ok: false, verified: false, code: "target_verification_failed" }));
});

test("device generation takeover before completion prevents verification", async () => {
  operationFenceStillCurrent.mockImplementation(() => operationFenceStillCurrent.mock.calls.length < 4);
  const result = await runSupabaseCloudMutationWrite({ mutation: mutation(), configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage });
  expect(result).toEqual(expect.objectContaining({ ok: false, verified: false, deviceLockLost: true }));
});

test("EST-2606 target write ignores unrelated workspace divergence and touches only its estimate family", async () => {
  const unrelatedBefore = JSON.parse(JSON.stringify({
    invoices: mockClient.fixture.rows.invoices,
    invoiceLines: mockClient.fixture.rows.invoice_line_items,
    invoicePayments: mockClient.fixture.rows.invoice_payments,
    unrelatedEstimateLine: mockClient.fixture.rows.estimate_line_items[0],
  }));
  const result = await runSupabaseCloudMutationWrite({
    mutation: estimateMutation(),
    configured: true,
    user: { id: "user-1" },
    company: { id: "company-1" },
    storageSnapshot: localStorage,
  });

  expect(result).toEqual(expect.objectContaining({ ok: true, verified: true, revision: 2, documentId: "estimate-2606" }));
  const { operations, rows } = mockClient.fixture;
  expect(operations.filter((operation) => operation.mode === "upsert").map((operation) => operation.table)).toEqual(["estimates", "estimate_line_items"]);
  expect(operations.some((operation) => ["invoices", "invoice_line_items", "invoice_payments"].includes(operation.table))).toBe(false);
  operations.filter((operation) => operation.mode === "select").forEach((operation) => {
    expect(operation.filters).toContainEqual(["company_id", "company-1"]);
    expect(operation.filters.some(([column]) => column === "legacy_local_id" || column === "estimate_id")).toBe(true);
  });
  expect(rows.invoices).toEqual(unrelatedBefore.invoices);
  expect(rows.invoice_line_items).toEqual(unrelatedBefore.invoiceLines);
  expect(rows.invoice_payments).toEqual(unrelatedBefore.invoicePayments);
  expect(rows.estimate_line_items.find((row) => row.id === "unrelated-estimate-line")).toEqual(unrelatedBefore.unrelatedEstimateLine);
});

test.each([
  ["header", { estimateHeaderMismatch: true }],
  ["date", { estimateDateMismatch: true }],
  ["line item", { estimateLineMismatch: true }],
])("strict estimate %s mismatch does not verify", async (_label, options) => {
  const fixture = createClient(options);
  mockClient = fixture.client;
  mockClient.fixture = fixture;
  const result = await runSupabaseCloudMutationWrite({
    mutation: estimateMutation(),
    configured: true,
    user: { id: "user-1" },
    company: { id: "company-1" },
    storageSnapshot: localStorage,
  });
  expect(result).toEqual(expect.objectContaining({ ok: false, verified: false, code: "target_verification_failed" }));
});

test("one stale EST-2606 child is deleted by exact target UUID and row id before strict verification", async () => {
  const fixture = createClient({ unexpectedEstimateLine: true });
  mockClient = fixture.client;
  mockClient.fixture = fixture;
  const result = await runSupabaseCloudMutationWrite({
    mutation: estimateMutation(),
    configured: true,
    user: { id: "user-1" },
    company: { id: "company-1" },
    storageSnapshot: localStorage,
  });
  expect(result).toEqual(expect.objectContaining({ ok: true, verified: true }));
  const deletes = fixture.operations.filter((operation) => operation.mode === "delete");
  expect(deletes).toEqual([
    expect.objectContaining({
      table: "estimate_line_items",
      filters: expect.arrayContaining([
        ["company_id", "company-1"],
        ["estimate_id", "estimates-cloud-2"],
        ["id", ["stale-target-line"]],
      ]),
    }),
  ]);
  expect(fixture.rows.estimate_line_items.some((row) => row.id === "stale-target-line")).toBe(false);
  expect(fixture.rows.estimate_line_items.some((row) => row.id === "unrelated-estimate-line")).toBe(true);
});

test("target stale-child cleanup failure remains a specific unverified mutation failure", async () => {
  const fixture = createClient({ unexpectedEstimateLine: true, estimateCleanupError: true });
  mockClient = fixture.client;
  mockClient.fixture = fixture;
  const result = await runSupabaseCloudMutationWrite({
    mutation: estimateMutation(),
    configured: true,
    user: { id: "user-1" },
    company: { id: "company-1" },
    storageSnapshot: localStorage,
  });
  expect(result).toEqual(expect.objectContaining({
    ok: false,
    verified: false,
    code: "estimate_line_items_target_cleanup_failed",
  }));
  expect(fixture.rows.estimate_line_items.some((row) => row.id === "stale-target-line")).toBe(true);
});

test("device takeover leaves estimate mutation unverified", async () => {
  operationFenceStillCurrent.mockImplementation(() => operationFenceStillCurrent.mock.calls.length < 3);
  const result = await runSupabaseCloudMutationWrite({
    mutation: estimateMutation(),
    configured: true,
    user: { id: "user-1" },
    company: { id: "company-1" },
    storageSnapshot: localStorage,
  });
  expect(result).toEqual(expect.objectContaining({ ok: false, verified: false, deviceLockLost: true }));
});

test("missing referenced estimate parent fails only this mutation without any business upsert", async () => {
  const fixture = createClient({ missingEstimateProject: true });
  mockClient = fixture.client;
  mockClient.fixture = fixture;
  const result = await runSupabaseCloudMutationWrite({
    mutation: estimateMutation(),
    configured: true,
    user: { id: "user-1" },
    company: { id: "company-1" },
    storageSnapshot: localStorage,
  });
  expect(result).toEqual(expect.objectContaining({ ok: false, verified: false, code: "projects_parent_missing" }));
  expect(fixture.operations.filter((operation) => operation.mode === "upsert")).toEqual([]);
});

test("invoice delete removes only the exact parent and its proven children, then rereads absence", async () => {
  const fixture = createClient();
  fixture.rows.invoices.push({ id: "invoice-target-cloud", legacy_local_id: "inv-delete", company_id: "company-1" });
  fixture.rows.invoice_line_items.push({ id: "line-target-cloud", legacy_local_id: "invoice:inv-delete:line:0", invoice_id: "invoice-target-cloud", company_id: "company-1" });
  fixture.rows.invoice_payments.push({ id: "payment-target-cloud", legacy_local_id: "pay-delete", invoice_id: "invoice-target-cloud", company_id: "company-1" });
  mockClient = fixture.client;
  mockClient.fixture = fixture;
  const result = await runSupabaseCloudMutationWrite({
    mutation: {
      mutationId: "mutation-delete-1", revision: 8, companyId: "company-1",
      entityType: CLOUD_MUTATION_ENTITY.INVOICE, operation: CLOUD_MUTATION_OPERATION.DELETE,
      documentId: "inv-delete", payload: { id: "inv-delete", legacyLocalId: "inv-delete" },
    },
    configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage,
  });
  expect(result).toEqual(expect.objectContaining({
    ok: true, verified: true,
    deleted: expect.objectContaining({ invoices: 1, invoice_line_items: 1, invoice_payments: 1 }),
  }));
  expect(fixture.rows.invoices).toEqual([expect.objectContaining({ id: "unrelated-invoice" })]);
  expect(fixture.rows.invoice_line_items).toEqual([expect.objectContaining({ id: "old-line" })]);
  expect(fixture.rows.invoice_payments).toEqual([expect.objectContaining({ id: "old-payment" })]);
  fixture.operations.filter((operation) => operation.mode === "delete").forEach((operation) => {
    expect(operation.filters).toContainEqual(["company_id", "company-1"]);
    expect(operation.filters.some(([column]) => column === "id")).toBe(true);
  });
});

test("app restore bundle reuses its existing writer and requires an exact reread match", async () => {
  const bundle = { version: "supabase-app-restore-bundle-v1", companyProfile: { name: "AAS" }, settings: { language: "en" }, scopeTemplates: [] };
  mockUpdateSupabaseAppRestoreBundle.mockResolvedValue({ status: "completed", bundleUpdated: true });
  mockReadSupabaseAppRestoreBundle.mockResolvedValue({ status: "available", bundle });
  const mutation = {
    mutationId: "mutation-bundle-1", revision: 9, companyId: "company-1",
    entityType: CLOUD_MUTATION_ENTITY.APP_RESTORE_BUNDLE, operation: CLOUD_MUTATION_OPERATION.UPSERT,
    documentId: "app_restore_bundle", payload: { bundle },
  };
  const result = await runSupabaseCloudMutationWrite({ mutation, configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage });
  expect(result).toEqual(expect.objectContaining({ ok: true, verified: true, written: { appRestoreBundle: 1 } }));
  expect(mockUpdateSupabaseAppRestoreBundle).toHaveBeenCalledWith(expect.objectContaining({ proposedBundle: bundle, storageSnapshot: localStorage }));
  expect(mockReadSupabaseAppRestoreBundle).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company-1" }));
});

test("app restore bundle never verifies when the cloud reread differs", async () => {
  const bundle = { version: "supabase-app-restore-bundle-v1", companyProfile: { name: "AAS" }, settings: { language: "en" }, scopeTemplates: [] };
  mockUpdateSupabaseAppRestoreBundle.mockResolvedValue({ status: "completed", bundleUpdated: true });
  mockReadSupabaseAppRestoreBundle.mockResolvedValue({ status: "available", bundle: { ...bundle, settings: { language: "es" } } });
  const result = await runSupabaseCloudMutationWrite({
    mutation: {
      mutationId: "mutation-bundle-2", revision: 10, companyId: "company-1",
      entityType: CLOUD_MUTATION_ENTITY.APP_RESTORE_BUNDLE, operation: CLOUD_MUTATION_OPERATION.UPSERT,
      documentId: "app_restore_bundle", payload: { bundle },
    },
    configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage,
  });
  expect(result).toEqual(expect.objectContaining({ ok: false, verified: false, code: "app_restore_bundle_verification_failed" }));
});

test.each([
  [{ ...mutation(), entityType: "unknown_entity" }],
  [{ ...mutation(), operation: "replace_everything" }],
])("unknown entity or operation fails closed without touching a table", async (unsupportedMutation) => {
  const result = await runSupabaseCloudMutationWrite({
    mutation: unsupportedMutation,
    configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage,
  });
  expect(result).toEqual(expect.objectContaining({ ok: false, verified: false, code: "unsupported_cloud_mutation" }));
  expect(mockClient.fixture.operations).toEqual([]);
});

// The money-side half of targeted cleanup. Payments carry the same exact-target
// rule as line items: only rows under this invoice UUID in this company may be
// removed, and a refused delete stays a real, specific, unverified failure.
test("one stale target invoice payment is deleted by exact invoice UUID and row id before strict verification", async () => {
  const fixture = createClient({ unexpectedInvoicePayment: true });
  mockClient = fixture.client;
  mockClient.fixture = fixture;

  const result = await runSupabaseCloudMutationWrite({
    mutation: mutation(), configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage,
  });

  expect(result).toEqual(expect.objectContaining({ ok: true, verified: true }));
  const paymentDeletes = fixture.operations.filter((operation) => operation.mode === "delete" && operation.table === "invoice_payments");
  expect(paymentDeletes).toEqual([
    expect.objectContaining({
      filters: expect.arrayContaining([
        ["company_id", "company-1"],
        ["invoice_id", "invoices-cloud-2"],
        ["id", ["stale-target-payment"]],
      ]),
    }),
  ]);
  expect(fixture.rows.invoice_payments.some((row) => row.id === "stale-target-payment")).toBe(false);
  // The payment belonging to another invoice is never even considered.
  expect(fixture.rows.invoice_payments.find((row) => row.id === "old-payment").invoice_id).toBe("unrelated-invoice");
});

test("target stale invoice payment cleanup failure remains a specific unverified mutation failure", async () => {
  const fixture = createClient({ unexpectedInvoicePayment: true, paymentCleanupError: true });
  mockClient = fixture.client;
  mockClient.fixture = fixture;

  const result = await runSupabaseCloudMutationWrite({
    mutation: mutation(), configured: true, user: { id: "user-1" }, company: { id: "company-1" }, storageSnapshot: localStorage,
  });

  expect(result).toEqual(expect.objectContaining({
    ok: false,
    verified: false,
    code: "invoice_payments_target_cleanup_failed",
  }));
  // Nothing is acknowledged and nothing is silently dropped.
  expect(fixture.rows.invoice_payments.some((row) => row.id === "stale-target-payment")).toBe(true);
});
