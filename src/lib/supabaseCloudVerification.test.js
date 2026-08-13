const mockGetSupabaseClient = jest.fn();

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

const { runSupabaseCloudVerification } = require("./supabaseCloudVerification");

function buildStorageSnapshot({
  customers,
  projects,
  estimates,
  invoices,
  companyProfile,
  settings,
  scopeTemplates,
  auditEvents,
  cloudPartialRecoveryStatus,
} = {}) {
  const defaults = defaultLocalData();
  return {
    getItem(key) {
      const values = {
        "estipaid-company-profile-v1": JSON.stringify(companyProfile ?? defaults.companyProfile),
        "estipaid-customers-v1": JSON.stringify(customers ?? defaults.customers),
        "estipaid-projects-v1": JSON.stringify(projects ?? defaults.projects),
        "estipaid-estimates-v1": JSON.stringify(estimates ?? defaults.estimates),
        "estipaid-invoices-v1": JSON.stringify(invoices ?? defaults.invoices),
        "estipaid-settings-v1": JSON.stringify(settings ?? defaults.settings),
        "estipaid-scope-templates-v1": JSON.stringify(scopeTemplates ?? defaults.scopeTemplates),
        "estipaid-audit-events-v1": JSON.stringify(auditEvents ?? defaults.auditEvents),
        "estipaid-cloud-partial-recovery-status-v1": cloudPartialRecoveryStatus
          ? JSON.stringify(cloudPartialRecoveryStatus)
          : null,
      };
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
  };
}

function defaultLocalData() {
  return {
    companyProfile: { id: "local_company", companyName: "AAS Property Care" },
    customers: [{ id: "cust_1", name: "Acme Co" }],
    projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
    estimates: [{
      id: "est_1",
      projectId: "proj_1",
      customerId: "cust_1",
      estimateNumber: "EST-1",
      total: 100,
      labor: { lines: [{ id: "line_1", description: "Labor", quantity: 1, rate: 100 }] },
    }],
    invoices: [{
      id: "inv_1",
      projectId: "proj_1",
      customerId: "cust_1",
      sourceEstimateId: "est_1",
      invoiceNumber: "INV-1",
      invoiceTotal: 100,
      amountPaid: 25,
      balanceRemaining: 75,
      lineItems: [{ id: "inv_line_1", description: "Material", quantity: 1, price: 100, total: 100 }],
      payments: [{ id: "pay_1", amount: 25, method: "cash", status: "paid" }],
    }],
    settings: {},
    scopeTemplates: [],
    auditEvents: [],
  };
}

function defaultMatchingRows() {
  return writerShapedCloudRows(defaultLocalData());
}

function createMockClient(rowsByTable = {}, errorsByTable = {}) {
  const eqMocks = {};
  const selectMocks = {};
  const from = jest.fn((table) => {
    const eq = jest.fn(async () => {
      if (errorsByTable[table]) return { data: null, error: errorsByTable[table] };
      return { data: rowsByTable[table] || [], error: null };
    });
    const select = jest.fn(() => ({ eq }));
    eqMocks[table] = eq;
    selectMocks[table] = select;
    return { select, from: undefined, insert: undefined, update: undefined, upsert: undefined, delete: undefined };
  });
  return { from, eqMocks, selectMocks };
}

async function verifyCloud({ localData = defaultLocalData(), cloudRows = writerShapedCloudRows(defaultLocalData()) } = {}) {
  const mockClient = createMockClient(cloudRows);
  mockGetSupabaseClient.mockReturnValue(mockClient);
  return runSupabaseCloudVerification({
    storageSnapshot: buildStorageSnapshot(localData),
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "AAS Property Care" },
  });
}

describe("supabaseCloudVerification", () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
  });

  test("blocks when Supabase is not configured", async () => {
    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: false,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.ok).toBe(false);
    expect(result.validations.supabaseConfigured).toBe(false);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", code: "supabase_not_configured" }),
    ]));
    expect(result.noWritesPerformed).toBe(true);
  });

  test("blocks when no signed-in user is present", async () => {
    const mockClient = createMockClient(defaultMatchingRows());
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: null,
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.ok).toBe(false);
    expect(result.validations.signedIn).toBe(false);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", code: "not_signed_in" }),
    ]));
    expect(mockClient.from).not.toHaveBeenCalled();
  });

  test("blocks when no cloud workspace/company is linked", async () => {
    const mockClient = createMockClient(defaultMatchingRows());
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: null,
    });

    expect(result.ok).toBe(false);
    expect(result.validations.hasCompany).toBe(false);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", code: "company_missing" }),
    ]));
  });

  test("reports all tables matched when local and cloud data agree", async () => {
    const mockClient = createMockClient(defaultMatchingRows());
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.ok).toBe(true);
    expect(result.allMatched).toBe(true);
    expect(result.localCounts).toEqual({
      customers: 1,
      projects: 1,
      estimates: 1,
      invoices: 1,
      invoicePayments: 1,
      estimateLineItems: 1,
      invoiceLineItems: 1,
    });
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "customers", status: "matched", localCount: 1, cloudCount: 1 }),
      expect.objectContaining({ table: "projects", status: "matched" }),
      expect.objectContaining({ table: "estimates", status: "matched" }),
      expect.objectContaining({ table: "invoices", status: "matched" }),
      expect.objectContaining({ table: "invoice_payments", status: "matched" }),
      expect.objectContaining({ table: "estimate_line_items", status: "matched", countOnly: false }),
      expect.objectContaining({ table: "invoice_line_items", status: "matched", countOnly: false }),
    ]));
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "info",
        code: "cloud_verification_passed",
        message: "Cloud verification passed. Supabase data matches local migration data.",
      }),
    ]));
  });

  test("performs select-only reads and never calls any write method", async () => {
    const mockClient = createMockClient(defaultMatchingRows());
    mockGetSupabaseClient.mockReturnValue(mockClient);

    await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(mockClient.from).toHaveBeenCalledWith("customers");
    expect(mockClient.from).toHaveBeenCalledWith("projects");
    expect(mockClient.from).toHaveBeenCalledWith("estimates");
    expect(mockClient.from).toHaveBeenCalledWith("invoices");
    expect(mockClient.from).toHaveBeenCalledWith("invoice_payments");
    expect(mockClient.from).toHaveBeenCalledWith("estimate_line_items");
    expect(mockClient.from).toHaveBeenCalledWith("invoice_line_items");
    expect(mockClient.selectMocks.estimates).toHaveBeenCalledWith(expect.stringContaining("restore_payload"));
    expect(mockClient.selectMocks.estimates).toHaveBeenCalledWith(expect.stringContaining("total_amount"));
    expect(mockClient.selectMocks.customers).toHaveBeenCalledWith(expect.stringContaining("display_name"));
  });

  test("treats estimates without restore_payload as a cloud mismatch even when ids and counts match", async () => {
    const rows = defaultMatchingRows();
    rows.estimates = [{ id: "db_est_1", legacy_local_id: "est_1", restore_payload: null, restore_payload_version: null }];
    const mockClient = createMockClient(rows);
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.allMatched).toBe(false);
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "estimates",
        status: "mismatch",
        missingLegacyIds: [],
        extraLegacyIds: [],
        missingRestorePayloadLegacyIds: ["est_1"],
      }),
    ]));
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "estimates_restore_payload_missing" }),
    ]));
  });

  test("reports missing cloud rows when a local legacy id has no matching cloud row", async () => {
    const rows = defaultMatchingRows();
    rows.customers = [];
    const mockClient = createMockClient(rows);
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.allMatched).toBe(false);
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "customers",
        status: "mismatch",
        localCount: 1,
        cloudCount: 0,
        missingLegacyIds: ["cust_1"],
        extraLegacyIds: [],
      }),
    ]));
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "warning", code: "cloud_verification_mismatch" }),
    ]));
  });

  test("reports extra cloud rows when cloud has a legacy id not present locally", async () => {
    const rows = defaultMatchingRows();
    rows.customers = [
      { id: "db_cust_1", legacy_local_id: "cust_1" },
      { id: "db_cust_2", legacy_local_id: "cust_stale" },
    ];
    const mockClient = createMockClient(rows);
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.allMatched).toBe(false);
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "customers",
        status: "mismatch",
        localCount: 1,
        cloudCount: 2,
        missingLegacyIds: [],
        extraLegacyIds: ["cust_stale"],
      }),
    ]));
  });

  test("treats the exact preserved older-estimate set as matched after partial recovery", async () => {
    const rows = defaultMatchingRows();
    rows.estimates = [
      rows.estimates[0],
      { id: "db_est_2", legacy_local_id: "est_2", restore_payload: null, restore_payload_version: null },
    ];
    rows.estimate_line_items = [
      ...rows.estimate_line_items,
      { id: "db_est_line_2", legacy_local_id: "estimate:est_2:line:0", estimate_id: "db_est_2", sort_order: 0, description: "Older", quantity: 1, unit: null, unit_price: 1, total_price: 1, metadata: null, line_role: "labor" },
    ];
    const mockClient = createMockClient(rows);
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot({
        cloudPartialRecoveryStatus: {
          recoveryMode: "partial_cloud_recovery",
          status: "finished_with_older_estimates_kept",
          skippedEstimateCount: 1,
          skippedEstimateIds: ["est_2"],
          skippedReason: "missing_full_estimate_details",
          recoveredAt: "2026-07-06T02:00:00.000Z",
          olderEstimatesKeptInCloud: true,
        },
      }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.allMatched).toBe(true);
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "estimates",
        status: "matched",
        extraLegacyIds: ["est_2"],
        preservedExtraLegacyIds: ["est_2"],
      }),
      expect.objectContaining({
        table: "estimate_line_items",
        status: "matched",
        preservedExtraLegacyIds: ["est_2"],
      }),
    ]));
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "older_estimates_kept_in_cloud" }),
    ]));
  });

  test("unknown extra estimates still mismatch when they do not match the preserved recovery set", async () => {
    const rows = defaultMatchingRows();
    rows.estimates = [
      rows.estimates[0],
      { id: "db_est_2", legacy_local_id: "est_unknown", restore_payload: null, restore_payload_version: null },
    ];
    rows.estimate_line_items = [
      { id: "db_est_line_1", legacy_local_id: "estimate:est_1:line:0", estimate_id: "db_est_1" },
      { id: "db_est_line_2", legacy_local_id: "estimate:est_unknown:line:0", estimate_id: "db_est_2" },
    ];
    const mockClient = createMockClient(rows);
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot({
        cloudPartialRecoveryStatus: {
          recoveryMode: "partial_cloud_recovery",
          status: "finished_with_older_estimates_kept",
          skippedEstimateCount: 1,
          skippedEstimateIds: ["est_2"],
          skippedReason: "missing_full_estimate_details",
          recoveredAt: "2026-07-06T02:00:00.000Z",
          olderEstimatesKeptInCloud: true,
        },
      }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.allMatched).toBe(false);
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({
        table: "estimates",
        status: "mismatch",
        extraLegacyIds: ["est_unknown"],
        oldDeviceRequiredMissingRestorePayloadLegacyIds: ["est_unknown"],
      }),
    ]));
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "estimates_backup_protection_old_device_required",
        message: "Some older estimates need the original device to finish backup protection.",
      }),
    ]));
  });

  test("reports mismatch for line-item tables by count when totals differ", async () => {
    const rows = defaultMatchingRows();
    rows.estimate_line_items = [];
    const mockClient = createMockClient(rows);
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.allMatched).toBe(false);
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "estimate_line_items", status: "mismatch", localCount: 1, cloudCount: 0, countOnly: false }),
    ]));
  });

  test("flags orphaned child rows when a child table has cloud rows but the parent table has none", async () => {
    const rows = defaultMatchingRows();
    rows.estimates = [];
    const mockClient = createMockClient(rows);
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "warning", code: "estimate_line_items_orphaned" }),
    ]));
  });

  test("reports per-table unavailable status when a cloud read fails without blocking other tables", async () => {
    const rows = defaultMatchingRows();
    const mockClient = createMockClient(rows, { projects: { message: "network error" } });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseCloudVerification({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
    });

    expect(result.allMatched).toBe(false);
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "projects", status: "unavailable", error: "network error" }),
      expect.objectContaining({ table: "customers", status: "matched" }),
    ]));
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ level: "error", code: "projects_read_failed" }),
    ]));
  });
});

describe("supabaseCloudVerification semantic business contracts", () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
  });

  test.each([
    ["invoice status", (rows) => { rows.invoices[0].status = "sent"; }, "invoices", "status"],
    ["invoice amount paid", (rows) => { rows.invoices[0].amount_paid = 0; }, "invoices", "amount_paid"],
    ["invoice balance", (rows) => { rows.invoices[0].balance_remaining = 100; }, "invoices", "balance_remaining"],
    ["invoice total", (rows) => { rows.invoices[0].total_amount = 101; }, "invoices", "total_amount"],
    ["payment amount", (rows) => { rows.invoice_payments[0].amount = 24; }, "invoice_payments", "amount"],
    ["payment parent invoice", (rows) => { rows.invoice_payments[0].invoice_id = "db_invoice_wrong"; }, "invoice_payments", "invoice_id"],
    ["payment method", (rows) => { rows.invoice_payments[0].method = "card"; }, "invoice_payments", "method"],
    ["customer business field", (rows) => { rows.customers[0].display_name = "Changed customer"; }, "customers", "display_name"],
    ["project relationship", (rows) => { rows.projects[0].customer_id = "db_customer_wrong"; }, "projects", "customer_id"],
    ["estimate financial field", (rows) => { rows.estimates[0].total_amount = 101; }, "estimates", "total_amount"],
  ])("rejects same-id semantic drift in %s", async (_name, mutate, table, field) => {
    const cloudRows = writerShapedCloudRows(defaultLocalData());
    mutate(cloudRows);

    const result = await verifyCloud({ cloudRows });
    const tableResult = result.tableResults.find((entry) => entry.table === table);

    expect(result.allMatched).toBe(false);
    expect(tableResult).toEqual(expect.objectContaining({ status: "mismatch", semanticMismatchCount: 1 }));
    expect(tableResult.semanticMismatchFields).toContain(field);
  });

  test("rejects the INV-2609 stale paid-header false green", async () => {
    const localData = defaultLocalData();
    localData.invoices[0] = {
      ...localData.invoices[0],
      invoiceNumber: "INV-2609",
      status: "paid",
      paymentStatus: "paid",
      invoiceTotal: 9050.32,
      amountPaid: 9050.32,
      balanceRemaining: 0,
      payments: [{ id: "pay_2609", amount: 9050.32, method: "bank_transfer", paidAt: "2026-08-12" }],
    };
    const cloudRows = writerShapedCloudRows(localData);
    cloudRows.invoices[0] = {
      ...cloudRows.invoices[0],
      status: "sent",
      payment_status: "unpaid",
      amount_paid: 0,
      balance_remaining: 9050.32,
    };

    const result = await verifyCloud({ localData, cloudRows });
    const invoiceResult = result.tableResults.find((entry) => entry.table === "invoices");

    expect(result.allMatched).toBe(false);
    expect(invoiceResult.semanticMismatchFields).toEqual(expect.arrayContaining([
      "status", "payment_status", "amount_paid", "balance_remaining",
    ]));
  });

  test("accepts equivalent normalized money, dates, and ignored server metadata", async () => {
    const localData = defaultLocalData();
    localData.invoices[0].payments[0].paidAt = "2026-08-12";
    const cloudRows = writerShapedCloudRows(localData);
    cloudRows.invoices[0] = {
      ...cloudRows.invoices[0], total_amount: "100.000", amount_paid: "25.0", balance_remaining: "75.000", created_at: "server", updated_at: "server",
    };
    cloudRows.invoice_payments[0] = { ...cloudRows.invoice_payments[0], paid_at: "2026-08-12T00:00:00.000Z", created_by: "server", updated_by: "server" };

    const result = await verifyCloud({ localData, cloudRows });
    expect(result.allMatched).toBe(true);
  });
});

// Gate 16A live stale-device regression: the writer and verifier must generate
// identical child identities so correctly-written children never look cloud-only.
// This builds cloud rows via the SHARED contract from the same local snapshot the
// verifier maps, including estimates whose labor + material sort orders overlap
// (both starting at 0) -- the exact shape that used to produce false cloud-only
// estimate line items.
const { buildParentLineItemContract } = require("./cloudLineItemContract");
const { mapLocalSnapshotToBackendDraft } = require("../utils/backendDataMapper");
const { buildPersistedEstimateContract } = require("./supabaseEstimatePersistenceContract");
const { buildEstimateRestorePayload, ESTIMATE_RESTORE_PAYLOAD_VERSION } = require("./supabaseEstimateRestorePayload");
const { buildDevSampleDataset, DEV_SAMPLE_DATA_VERSION } = require("../utils/devSampleData");

function liveShapeLocalData() {
  const customers = Array.from({ length: 7 }, (_, i) => ({ id: `cust-${i + 1}`, name: `Customer ${i + 1}` }));
  const projects = Array.from({ length: 11 }, (_, i) => ({ id: `proj-${i + 1}`, customerId: `cust-${(i % 7) + 1}`, projectName: `Project ${i + 1}` }));
  // 12 estimates whose labor/material line counts sum to exactly 22 line items,
  // several with overlapping per-category sort orders (labor 0.. and material 0..).
  const estimateSpecs = [
    { labor: 2, material: 2 }, { labor: 2, material: 1 }, { labor: 1, material: 1 }, { labor: 1, material: 1 },
    { labor: 1, material: 1 }, { labor: 1, material: 1 }, { labor: 1, material: 1 }, { labor: 1, material: 1 },
    { labor: 1, material: 0 }, { labor: 1, material: 1 }, { labor: 0, material: 0 }, { labor: 0, material: 0 },
  ];
  const estimates = estimateSpecs.map((spec, i) => {
    const id = `est-${i + 1}`;
    return {
      id, customerId: `cust-${(i % 7) + 1}`, projectId: `proj-${(i % 11) + 1}`, estimateNumber: `EST-${i + 1}`,
      total: 100, status: "draft", notes: "", terms: "",
      labor: { lines: Array.from({ length: spec.labor }, (_, j) => ({ id: `${id}-lab-${j}`, description: `Labor ${j}`, quantity: 1, rate: 100 + j, cost: 60 + j })) },
      materials: { items: Array.from({ length: spec.material }, (_, j) => ({ id: `${id}-mat-${j}`, description: `Material ${j}`, quantity: 1, price: 50 + j, cost: 30 + j })) },
    };
  });
  // 9 invoices, each with one line item; 4 payments spread across them.
  const invoices = Array.from({ length: 9 }, (_, i) => ({
    id: `inv-${i + 1}`, customerId: `cust-${(i % 7) + 1}`, projectId: `proj-${(i % 11) + 1}`,
    sourceEstimateId: `est-${i + 1}`, invoiceNumber: `INV-${i + 1}`, invoiceTotal: 100, amountPaid: 0, balanceRemaining: 100,
    status: "sent", paymentStatus: "unpaid",
    lineItems: [{ id: `inv-${i + 1}-line`, description: "Service", quantity: 1, price: 100, total: 100 }],
    payments: i < 4 ? [{ id: `pay-${i + 1}`, amount: 25, method: "cash", status: "paid", paidAt: "2026-07-01" }] : [],
  }));
  const scopeTemplates = [{ id: "tmpl-1", name: "Template 1", scopeText: "Scope" }];
  return { customers, projects, estimates, invoices, scopeTemplates };
}

function writerShapedCloudRows(localData) {
  const draft = mapLocalSnapshotToBackendDraft(localData, { companyId: "company_1", userId: "user_1" });
  const customers = draft.customers.map((customer, i) => ({
    id: `db_cust_${i}`,
    legacy_local_id: customer.legacy_local_id,
    display_name: customer.display_name || null,
    company_name: customer.company_name || null,
    contact_name: customer.contact_name || null,
    phone: customer.phone || null,
    email: customer.email || null,
    billing_address: customer.billing_address || customer.address || null,
    customer_type: customer.customer_type || null,
    customer_status: customer.status || null,
  }));
  const customerIdByLegacyId = Object.fromEntries(customers.map((row) => [row.legacy_local_id, row.id]));
  const projects = draft.projects.map((project, i) => ({
    id: `db_proj_${i}`,
    legacy_local_id: project.legacy_local_id,
    customer_id: customerIdByLegacyId[project.customer_legacy_local_id] || null,
    project_number: project.project_number || null,
    project_name: project.project_name || null,
    site_address: project.site_address || null,
    status: project.status || "draft",
    notes: project.notes || null,
    scope_summary: project.scope_summary || null,
  }));
  const projectIdByLegacyId = Object.fromEntries(projects.map((row) => [row.legacy_local_id, row.id]));
  const localEstimateByLegacyId = Object.fromEntries((localData.estimates || []).map((estimate) => [estimate.id, estimate]));
  const estimates = draft.estimates.map((estimate, i) => {
    const persisted = buildPersistedEstimateContract(estimate);
    return {
      id: `db_est_${i}`,
      legacy_local_id: persisted.legacy_local_id,
      customer_id: customerIdByLegacyId[persisted.customer_legacy_local_id] || null,
      project_id: projectIdByLegacyId[persisted.project_legacy_local_id] || null,
      estimate_number: persisted.estimate_number,
      status: persisted.status,
      total_amount: persisted.total_amount,
      notes: persisted.notes,
      terms: persisted.terms,
      converted_invoice_legacy_id: persisted.converted_invoice_legacy_local_id,
      restore_payload: buildEstimateRestorePayload(localEstimateByLegacyId[persisted.legacy_local_id]),
      restore_payload_version: ESTIMATE_RESTORE_PAYLOAD_VERSION,
    };
  });
  const estIdBy = Object.fromEntries(estimates.map((r) => [r.legacy_local_id, r.id]));
  const invoices = draft.invoices.map((invoice, i) => ({
    id: `db_inv_${i}`,
    legacy_local_id: invoice.legacy_local_id,
    customer_id: customerIdByLegacyId[invoice.customer_legacy_local_id] || null,
    project_id: projectIdByLegacyId[invoice.project_legacy_local_id] || null,
    estimate_id: estIdBy[invoice.source_estimate_legacy_local_id] || null,
    source_estimate_legacy_id: invoice.source_estimate_legacy_local_id || null,
    invoice_number: invoice.invoice_number || null,
    estimate_number: invoice.estimate_number || null,
    status: invoice.status || "draft",
    payment_status: invoice.payment_status || "unpaid",
    invoice_date: invoice.invoice_date || null,
    due_date: invoice.due_date || null,
    total_amount: invoice.total ?? null,
    amount_paid: invoice.amount_paid ?? 0,
    balance_remaining: invoice.balance_remaining ?? null,
    notes: invoice.notes || null,
    terms: invoice.terms || null,
  }));
  const invIdBy = Object.fromEntries(invoices.map((r) => [r.legacy_local_id, r.id]));
  const estimate_line_items = [];
  draft.estimates.forEach((e) => {
    buildParentLineItemContract({ entityType: "estimate", parentLegacyId: e.legacy_local_id, parentCloudId: estIdBy[e.legacy_local_id], parentColumn: "estimate_id", items: e.line_items }).rows.forEach((row, idx) => {
      estimate_line_items.push({ id: `db_el_${e.legacy_local_id}_${idx}`, ...row });
    });
  });
  const invoice_line_items = [];
  draft.invoices.forEach((v) => {
    buildParentLineItemContract({ entityType: "invoice", parentLegacyId: v.legacy_local_id, parentCloudId: invIdBy[v.legacy_local_id], parentColumn: "invoice_id", items: v.line_items }).rows.forEach((row, idx) => {
      invoice_line_items.push({ id: `db_il_${v.legacy_local_id}_${idx}`, ...row });
    });
  });
  return {
    customers,
    projects,
    estimates,
    invoices,
    invoice_payments: draft.invoicePayments.map((payment, i) => ({
      id: `db_pay_${i}`,
      legacy_local_id: payment.legacy_local_id,
      invoice_id: invIdBy[payment.invoice_legacy_local_id] || null,
      amount: payment.amount ?? null,
      method: payment.method || null,
      status: payment.status || null,
      paid_at: payment.paid_at || null,
    })),
    estimate_line_items,
    invoice_line_items,
  };
}

test("current canonical sample data maps through the writer contract and verifies Cloud OK", async () => {
  const localData = buildDevSampleDataset();
  const draft = mapLocalSnapshotToBackendDraft(localData, { companyId: "company_1", userId: "user_1" });
  const cloudRows = writerShapedCloudRows(localData);
  const paidInvoice = draft.invoices.find((invoice) => invoice.legacy_local_id === "sample_invoice_hilton_mobilization_deposit");
  const partialInvoice = draft.invoices.find((invoice) => invoice.legacy_local_id === "sample_invoice_sonoran_signage_add");
  const paidPayment = draft.invoicePayments.find((payment) => payment.legacy_local_id === "sample_payment_hilton_mobilization_deposit");
  const partialPayment = draft.invoicePayments.find((payment) => payment.legacy_local_id === "sample_payment_sonoran_signage_add");

  expect(DEV_SAMPLE_DATA_VERSION).toBe("2026-08-canonical-v1");
  expect(draft.customers).toHaveLength(6);
  expect(draft.projects).toHaveLength(6);
  expect(draft.estimates).toHaveLength(8);
  expect(draft.invoices).toHaveLength(8);
  expect(draft.invoicePayments).toHaveLength(3);
  expect(draft.estimates.flatMap((estimate) => estimate.line_items)).toHaveLength(40);
  expect(draft.invoices.flatMap((invoice) => invoice.line_items)).toHaveLength(0);
  expect(paidInvoice).toEqual(expect.objectContaining({ status: "paid", payment_status: "paid", amount_paid: paidInvoice.total, balance_remaining: 0 }));
  expect(partialInvoice).toEqual(expect.objectContaining({ payment_status: "partial" }));
  expect(partialInvoice.amount_paid).toBeGreaterThan(0);
  expect(partialInvoice.balance_remaining).toBeGreaterThan(0);
  expect(paidPayment).toEqual(expect.objectContaining({ status: "paid", method: "ach" }));
  expect(partialPayment).toEqual(expect.objectContaining({ status: "paid", method: "ach" }));

  const result = await verifyCloud({ localData, cloudRows });
  expect(result.allMatched).toBe(true);

  cloudRows.invoices[0].status = "sent";
  const mismatched = await verifyCloud({ localData, cloudRows });
  expect(mismatched.allMatched).toBe(false);
});

test("live stale-device shape: writer-shaped children with overlapping sort orders verify as allMatched (22 estimate line items)", async () => {
  const localData = liveShapeLocalData();
  const cloudRows = writerShapedCloudRows(localData);
  // Sanity: the fixture really carries 22 estimate line items and overlapping ids.
  expect(cloudRows.estimate_line_items).toHaveLength(22);
  expect(cloudRows.invoice_line_items).toHaveLength(9);
  expect(cloudRows.estimate_line_items.filter((r) => r.legacy_local_id === "estimate:est-1:line:2")).toHaveLength(1);

  const mockClient = createMockClient(cloudRows);
  mockGetSupabaseClient.mockReturnValue(mockClient);

  const result = await runSupabaseCloudVerification({
    storageSnapshot: buildStorageSnapshot(localData),
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
  });

  expect(result.allMatched).toBe(true);
  const byTable = Object.fromEntries(result.tableResults.map((r) => [r.table, r]));
  expect(byTable.estimate_line_items).toMatchObject({ status: "matched", localCount: 22, cloudCount: 22, missingLegacyIds: [], extraLegacyIds: [] });
  expect(byTable.invoice_line_items).toMatchObject({ status: "matched", localCount: 9, cloudCount: 9, missingLegacyIds: [], extraLegacyIds: [] });
});
