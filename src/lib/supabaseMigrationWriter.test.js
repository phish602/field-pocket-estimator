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
      invoices: 1,
      invoicePayments: 1,
    },
    cloudCountCheckAvailable: true,
    cloudCounts: {
      customers: 0,
      projects: 0,
      estimates: 0,
      invoices: 0,
      invoicePayments: 0,
    },
    notices: [],
    noWritesPerformed: true,
    ...overrides,
  };
}

function buildStorageSnapshot() {
  return {
    getItem(key) {
      const values = {
        "estipaid-company-profile-v1": JSON.stringify({ id: "local_company", companyName: "AAS Property Care" }),
        "estipaid-customers-v1": JSON.stringify([{ id: "cust_1", name: "Acme Co" }]),
        "estipaid-projects-v1": JSON.stringify([{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }]),
        "estipaid-estimates-v1": JSON.stringify([{ id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-1", total: 100 }]),
        "estipaid-invoices-v1": JSON.stringify([{
          id: "inv_1",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "est_1",
          invoiceNumber: "INV-1",
          invoiceTotal: 100,
          amountPaid: 25,
          balanceRemaining: 75,
          payments: [{ id: "pay_1", amount: 25, method: "cash", status: "paid" }],
        }]),
        "estipaid-settings-v1": JSON.stringify({}),
        "estipaid-scope-templates-v1": JSON.stringify([]),
        "estipaid-audit-events-v1": JSON.stringify([]),
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
    invoices: createCountChain({ count: counts.invoices ?? 0, error: null }),
    invoice_payments: createCountChain({ count: counts.invoicePayments ?? 0, error: null }),
  };
  const writeChains = {
    customers: createUpsertChain({ data: customerRows, error: customerError }),
    projects: createUpsertChain({ data: projectRows, error: projectError }),
    estimates: createUpsertChain({ data: estimateRows, error: estimateError }),
    invoices: createUpsertChain({ data: invoiceRows, error: invoiceError }),
    invoice_payments: createUpsertChain({ data: paymentRows, error: paymentError }),
  };

  const from = jest.fn((table) => {
    const countChain = countChains[table];
    const writeChain = writeChains[table];
    if (!countChain || !writeChain) {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      select: jest.fn((columns, options) => {
        const isCountQuery = options && options.head === true;
        return isCountQuery ? countChain.select(columns, options) : undefined;
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
      counts: { customers: 1, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 },
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
      customers: 1,
      projects: 0,
      estimates: 0,
      invoices: 0,
      invoicePayments: 0,
    });
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
      invoices: 0,
      invoicePayments: 0,
    });
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "customers", status: "success", written: 1 }),
      expect.objectContaining({ table: "projects", status: "success", written: 1 }),
      expect.objectContaining({ table: "estimates", status: "success", written: 1 }),
      expect.objectContaining({ table: "estimate_line_items", status: "skipped" }),
      expect.objectContaining({ table: "invoices", status: "success", written: 1 }),
      expect.objectContaining({ table: "invoice_line_items", status: "skipped" }),
      expect.objectContaining({ table: "invoice_payments", status: "success", written: 1 }),
    ]));
    expect(mockClient.writeChains.customers.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.projects.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.estimates.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoice_payments.upsert).toHaveBeenCalled();
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
