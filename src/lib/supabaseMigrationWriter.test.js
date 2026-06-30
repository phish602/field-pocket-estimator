const mockGetSupabaseClient = jest.fn();

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

const {
  isSupabaseMigrationPreviewReady,
  runSupabaseMigrationWrite,
} = require("./supabaseMigrationWriter");

function buildPreview(overrides = {}) {
  return {
    validations: {
      supabaseConfigured: true,
      signedIn: true,
      hasCompany: true,
      roleAllowedForMigration: true,
      backupDownloadAvailable: true,
      exportArtifactBuilt: true,
      localDataReadable: true,
    },
    localCounts: {
      customers: 1,
      projects: 1,
      estimates: 1,
      estimateLineItems: 0,
      invoices: 1,
      invoiceLineItems: 0,
      invoicePayments: 1,
    },
    cloudCountCheckAvailable: true,
    cloudCounts: {
      customers: 0,
      projects: 0,
      estimates: 0,
      estimateLineItems: 0,
      invoices: 0,
      invoiceLineItems: 0,
      invoicePayments: 0,
    },
    notices: [],
    noWritesPerformed: true,
    ...overrides,
  };
}

function buildStorageSnapshot({
  customers,
  projects,
  estimates,
  invoices,
  companyProfile,
  settings,
  scopeTemplates,
  auditEvents,
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
          labor: { lines: [{ id: "est_line_1", description: "Labor", quantity: 1, rate: 100 }] },
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
      };
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
  };
}

function createCountChain(response) {
  const eq = jest.fn(async () => response);
  const select = jest.fn(() => ({ eq }));
  return { select, eq };
}

function createUpsertChain(response) {
  const select = jest.fn(async () => response);
  const upsert = jest.fn(() => ({ select }));
  return { upsert, select };
}

function createMockClient({
  counts = {},
  existingCustomerRows,
  customerRows = [{ id: "db_cust_1", legacy_local_id: "cust_1" }],
  projectRows = [{ id: "db_proj_1", legacy_local_id: "proj_1" }],
  estimateRows = [{ id: "db_est_1", legacy_local_id: "est_1" }],
  invoiceRows = [{ id: "db_inv_1", legacy_local_id: "inv_1" }],
  paymentRows = [{ id: "db_pay_1", legacy_local_id: "pay_1" }],
  customerError = null,
  projectError = null,
  estimateError = null,
  invoiceError = null,
  paymentError = null,
} = {}) {
  const countChains = {
    customers: createCountChain({ count: counts.customers ?? 0, error: null }),
    projects: createCountChain({ count: counts.projects ?? 0, error: null }),
    estimates: createCountChain({ count: counts.estimates ?? 0, error: null }),
    estimate_line_items: createCountChain({ count: counts.estimateLineItems ?? 0, error: null }),
    invoices: createCountChain({ count: counts.invoices ?? 0, error: null }),
    invoice_line_items: createCountChain({ count: counts.invoiceLineItems ?? 0, error: null }),
    invoice_payments: createCountChain({ count: counts.invoicePayments ?? 0, error: null }),
  };
  const writeChains = {
    customers: createUpsertChain({ data: customerRows, error: customerError }),
    projects: createUpsertChain({ data: projectRows, error: projectError }),
    estimates: createUpsertChain({ data: estimateRows, error: estimateError }),
    estimate_line_items: createUpsertChain({ data: [], error: null }),
    invoices: createUpsertChain({ data: invoiceRows, error: invoiceError }),
    invoice_line_items: createUpsertChain({ data: [], error: null }),
    invoice_payments: createUpsertChain({ data: paymentRows, error: paymentError }),
  };
  const readRowsByTable = {
    customers: existingCustomerRows || customerRows,
    projects: projectRows,
    estimates: estimateRows,
    invoices: invoiceRows,
    invoice_payments: paymentRows,
  };

  const from = jest.fn((table) => {
    const countChain = countChains[table];
    const writeChain = writeChains[table];
    const readRows = readRowsByTable[table];
    if (!countChain || !writeChain) {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      select: jest.fn((columns, options) => {
        const isCountQuery = options && options.head === true;
        if (isCountQuery) {
          return countChain.select(columns, options);
        }
        return {
          eq: jest.fn(async () => ({ data: readRows, error: null })),
        };
      }),
      upsert: writeChain.upsert,
    };
  });

  return { from, countChains, writeChains };
}

describe("supabaseMigrationWriter", () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
  });

  test("preview readiness requires a successful preview", () => {
    expect(isSupabaseMigrationPreviewReady(buildPreview())).toBe(true);
    expect(isSupabaseMigrationPreviewReady(buildPreview({
      validations: { supabaseConfigured: false },
    }))).toBe(false);
    expect(isSupabaseMigrationPreviewReady(buildPreview({
      localCounts: { customers: 0, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 },
    }))).toBe(false);
  });

  test("blocks migration when preview has not succeeded", async () => {
    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: null,
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/Run a successful migration preview/i);
  });

  test("blocks migration when cloud business tables already contain records", async () => {
    const mockClient = createMockClient({
      counts: { customers: 0, projects: 1, estimates: 0, invoices: 0, invoicePayments: 0 },
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.cloudCountsBefore).toEqual({
      customers: 0,
      projects: 1,
      estimates: 0,
      estimateLineItems: 0,
      invoices: 0,
      invoiceLineItems: 0,
      invoicePayments: 0,
    });
  });

  test("normalizes project statuses before writing and reports the mapping", async () => {
    const mockClient = createMockClient();
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({
        projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair", status: "closed" }],
      }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(true);
    expect(mockClient.writeChains.projects.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ legacy_local_id: "proj_1", status: "completed" }),
      ]),
      expect.any(Object),
    );
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "project_statuses_normalized",
        message: expect.stringContaining("proj_1: closed -> completed"),
      }),
    ]));
  });

  test("migrates customers, projects, estimates, invoices, and invoice payments in dependency order", async () => {
    const mockClient = createMockClient();
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(true);
    expect(result.noLocalDeletes).toBe(true);
    expect(result.cloudCountsBefore).toEqual({
      customers: 0,
      projects: 0,
      estimates: 0,
      estimateLineItems: 0,
      invoices: 0,
      invoiceLineItems: 0,
      invoicePayments: 0,
    });
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "customers", status: "success", written: 1 }),
      expect.objectContaining({ table: "projects", status: "success", written: 1 }),
      expect.objectContaining({ table: "estimates", status: "success", written: 1 }),
      expect.objectContaining({ table: "estimate_line_items", status: "blocked", skipped: 1 }),
      expect.objectContaining({ table: "invoices", status: "success", written: 1 }),
      expect.objectContaining({ table: "invoice_line_items", status: "blocked", skipped: 1 }),
      expect.objectContaining({ table: "invoice_payments", status: "success", written: 1 }),
    ]));
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "estimate_line_items_schema_blocked" }),
      expect.objectContaining({ code: "invoice_line_items_schema_blocked" }),
    ]));
    expect(mockClient.writeChains.customers.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.projects.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.estimates.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoice_payments.upsert).toHaveBeenCalled();
  });

  test("reuses existing cloud customers for a safe customers-only partial migration", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 },
      existingCustomerRows: [{ id: "db_cust_1", legacy_local_id: "cust_1" }],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(true);
    expect(mockClient.writeChains.customers.upsert).not.toHaveBeenCalled();
    expect(mockClient.writeChains.projects.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ customer_id: "db_cust_1" }),
      ]),
      expect.any(Object),
    );
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "customers", status: "reused", reused: 1, skipped: 1 }),
    ]));
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "existing_customers_reused" }),
      expect.objectContaining({ code: "prevalidation_complete" }),
    ]));
  });

  test("blocks partial migration resume when cloud customers do not match local legacy ids", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 },
      existingCustomerRows: [{ id: "db_cust_x", legacy_local_id: "cust_x" }],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/do not match local customers/i);
    expect(mockClient.writeChains.customers.upsert).not.toHaveBeenCalled();
    expect(mockClient.writeChains.projects.upsert).not.toHaveBeenCalled();
  });

  test("blocks reruns after the full migration already exists in cloud", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 1, invoicePayments: 1 },
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({
        estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-1", total: 100 }],
        invoices: [{
          id: "inv_1",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "est_1",
          invoiceNumber: "INV-1",
          invoiceTotal: 100,
          amountPaid: 25,
          balanceRemaining: 75,
          payments: [{ id: "pay_1", amount: 25, method: "cash", status: "paid" }],
        }],
      }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/already match the local migration counts/i);
    expect(mockClient.writeChains.customers.upsert).not.toHaveBeenCalled();
  });

  test("blocks reruns with an exact line-item schema message when core tables are already migrated", async () => {
    const mockClient = createMockClient({
      counts: {
        customers: 1,
        projects: 1,
        estimates: 1,
        estimateLineItems: 0,
        invoices: 1,
        invoiceLineItems: 0,
        invoicePayments: 1,
      },
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/line item migration remains blocked/i);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "core_tables_already_migrated" }),
      expect.objectContaining({ code: "estimate_line_items_schema_blocked" }),
      expect.objectContaining({ code: "invoice_line_items_schema_blocked" }),
    ]));
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "estimate_line_items", status: "blocked", skipped: 1 }),
      expect.objectContaining({ table: "invoice_line_items", status: "blocked", skipped: 1 }),
    ]));
    expect(mockClient.writeChains.customers.upsert).not.toHaveBeenCalled();
  });

  test("completes validation before writes and blocks early on local document issues", async () => {
    const mockClient = createMockClient();
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({
        estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1", total: 100 }],
      }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/local validation issues/i);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "estimate_number_missing:0" }),
    ]));
    expect(mockClient.writeChains.customers.upsert).not.toHaveBeenCalled();
    expect(mockClient.writeChains.projects.upsert).not.toHaveBeenCalled();
  });

  test("surfaces per-table failures without hiding partial progress", async () => {
    const mockClient = createMockClient({
      invoiceError: { message: "new row violates row-level security policy for table invoices" },
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.reason).toMatch(/row-level security policy/i);
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "customers", status: "success", written: 1 }),
      expect.objectContaining({ table: "projects", status: "success", written: 1 }),
      expect.objectContaining({ table: "estimates", status: "success", written: 1 }),
      expect.objectContaining({ table: "invoices", status: "failed", failed: 1 }),
    ]));
  });
});
