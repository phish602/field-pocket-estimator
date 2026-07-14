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
    estimate_line_items: [{ id: "db_est_line_1", legacy_local_id: "estimate:est_1:line:0", estimate_id: "db_est_1", sort_order: 0, description: "Labor", quantity: 1, unit: null, unit_price: 100, total_price: null, metadata: null, line_role: "labor" }],
    // Invoice line items carry kind inside metadata (the writer's real output);
    // estimate line items carry kind in the line_role column instead.
    invoice_line_items: [{ id: "db_inv_line_1", legacy_local_id: "invoice:inv_1:line:0", invoice_id: "db_inv_1", sort_order: 0, description: "Material", quantity: 1, unit: null, unit_price: 100, total_price: 100, metadata: { kind: "invoice" } }],
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
      { id: "db_est_line_1", legacy_local_id: "estimate:est_1:line:0", estimate_id: "db_est_1", sort_order: 0, description: "Labor", quantity: 1, unit: null, unit_price: 100, total_price: null, metadata: null, line_role: "labor" },
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

// Gate 16A live stale-device regression: the writer and verifier must generate
// identical child identities so correctly-written children never look cloud-only.
// This builds cloud rows via the SHARED contract from the same local snapshot the
// verifier maps, including estimates whose labor + material sort orders overlap
// (both starting at 0) -- the exact shape that used to produce false cloud-only
// estimate line items.
const { buildParentLineItemContract } = require("./cloudLineItemContract");
const { mapLocalSnapshotToBackendDraft } = require("../utils/backendDataMapper");

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
  const parentRows = (list, prefix) => list.map((r, i) => ({ id: `db_${prefix}_${i}`, legacy_local_id: r.legacy_local_id }));
  const estimates = draft.estimates.map((e, i) => ({ id: `db_est_${i}`, legacy_local_id: e.legacy_local_id, restore_payload: { schema: "estipaid.estimate.restore_payload", version: 1, estimate: { id: e.legacy_local_id } }, restore_payload_version: "1" }));
  const estIdBy = Object.fromEntries(estimates.map((r) => [r.legacy_local_id, r.id]));
  const invoices = draft.invoices.map((v, i) => ({ id: `db_inv_${i}`, legacy_local_id: v.legacy_local_id }));
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
    customers: parentRows(draft.customers, "cust"),
    projects: parentRows(draft.projects, "proj"),
    estimates,
    invoices,
    invoice_payments: draft.invoicePayments.map((p, i) => ({ id: `db_pay_${i}`, legacy_local_id: p.legacy_local_id })),
    estimate_line_items,
    invoice_line_items,
  };
}

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
