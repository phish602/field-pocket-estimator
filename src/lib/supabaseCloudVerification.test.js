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
  return {
    getItem(key) {
      const values = {
        "estipaid-company-profile-v1": JSON.stringify(companyProfile || { id: "local_company", companyName: "AAS Property Care" }),
        "estipaid-customers-v1": JSON.stringify(customers || [{ id: "cust_1", name: "Acme Co" }]),
        "estipaid-projects-v1": JSON.stringify(projects || [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }]),
        "estipaid-estimates-v1": JSON.stringify(estimates || [{
          id: "est_1",
          projectId: "proj_1",
          customerId: "cust_1",
          estimateNumber: "EST-1",
          total: 100,
          labor: { lines: [{ id: "line_1", description: "Labor", quantity: 1, rate: 100 }] },
        }]),
        "estipaid-invoices-v1": JSON.stringify(invoices || [{
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
        }]),
        "estipaid-settings-v1": JSON.stringify(settings || {}),
        "estipaid-scope-templates-v1": JSON.stringify(scopeTemplates || []),
        "estipaid-audit-events-v1": JSON.stringify(auditEvents || []),
        "estipaid-cloud-partial-recovery-status-v1": cloudPartialRecoveryStatus
          ? JSON.stringify(cloudPartialRecoveryStatus)
          : null,
      };
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
  };
}

function defaultMatchingRows() {
  return {
    customers: [{ id: "db_cust_1", legacy_local_id: "cust_1" }],
    projects: [{ id: "db_proj_1", legacy_local_id: "proj_1" }],
    estimates: [{
      id: "db_est_1",
      legacy_local_id: "est_1",
      restore_payload: { schema: "estipaid.estimate.restore_payload", version: 1, estimate: { id: "est_1" } },
      restore_payload_version: "1",
    }],
    invoices: [{ id: "db_inv_1", legacy_local_id: "inv_1" }],
    invoice_payments: [{ id: "db_pay_1", legacy_local_id: "pay_1" }],
    estimate_line_items: [{ id: "db_est_line_1", legacy_local_id: "estimate:est_1:line:0" }],
    invoice_line_items: [{ id: "db_inv_line_1", legacy_local_id: "invoice:inv_1:line:0" }],
  };
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
      expect.objectContaining({ table: "estimate_line_items", status: "matched", countOnly: true }),
      expect.objectContaining({ table: "invoice_line_items", status: "matched", countOnly: true }),
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
    expect(mockClient.selectMocks.estimates).toHaveBeenCalledWith("id, legacy_local_id, restore_payload, restore_payload_version");
    expect(mockClient.selectMocks.customers).toHaveBeenCalledWith("id, legacy_local_id");
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
      { id: "db_est_line_1", legacy_local_id: "estimate:est_1:line:0", estimate_id: "db_est_1" },
      { id: "db_est_line_2", legacy_local_id: "estimate:est_2:line:0", estimate_id: "db_est_2" },
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
      expect.objectContaining({ table: "estimate_line_items", status: "mismatch", localCount: 1, cloudCount: 0, countOnly: true }),
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
