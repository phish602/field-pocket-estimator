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
      estimateLineItems: 1,
      invoices: 1,
      invoiceLineItems: 1,
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

  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null;
    },
    setItem(key, value) {
      values[key] = value;
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

function createDeleteChain(response = { error: null }) {
  const inFn = jest.fn(async () => response);
  const eq = jest.fn(() => ({ in: inFn }));
  const del = jest.fn(() => ({ eq }));
  return { delete: del, eq, in: inFn };
}

function createMockClient({
  counts = {},
  existingCustomerRows,
  existingProjectRows,
  existingEstimateRows,
  existingInvoiceRows,
  existingEstimateLineItemRows,
  existingInvoiceLineItemRows,
  existingPaymentRows,
  customerRows = [{ id: "db_cust_1", legacy_local_id: "cust_1" }],
  projectRows = [{ id: "db_proj_1", legacy_local_id: "proj_1" }],
  estimateRows = [{ id: "db_est_1", legacy_local_id: "est_1" }],
  estimateLineItemRows = [{ id: "db_est_line_1", legacy_local_id: "est_line_1" }],
  invoiceRows = [{ id: "db_inv_1", legacy_local_id: "inv_1" }],
  invoiceLineItemRows = [{ id: "db_inv_line_1", legacy_local_id: "inv_line_1" }],
  paymentRows = [{ id: "db_pay_1", legacy_local_id: "pay_1" }],
  customerError = null,
  projectError = null,
  estimateError = null,
  estimateLineItemError = null,
  invoiceError = null,
  invoiceLineItemError = null,
  paymentError = null,
  deleteErrors = {},
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
    estimate_line_items: createUpsertChain({ data: estimateLineItemRows, error: estimateLineItemError }),
    invoices: createUpsertChain({ data: invoiceRows, error: invoiceError }),
    invoice_line_items: createUpsertChain({ data: invoiceLineItemRows, error: invoiceLineItemError }),
    invoice_payments: createUpsertChain({ data: paymentRows, error: paymentError }),
  };
  const readRowsByTable = {
    customers: existingCustomerRows || customerRows,
    projects: existingProjectRows || projectRows,
    estimates: existingEstimateRows || estimateRows,
    estimate_line_items: existingEstimateLineItemRows || [],
    invoices: existingInvoiceRows || invoiceRows,
    invoice_line_items: existingInvoiceLineItemRows || [],
    invoice_payments: existingPaymentRows || paymentRows,
  };
  const deleteChains = {
    customers: createDeleteChain({ error: deleteErrors.customers || null }),
    projects: createDeleteChain({ error: deleteErrors.projects || null }),
    estimates: createDeleteChain({ error: deleteErrors.estimates || null }),
    estimate_line_items: createDeleteChain({ error: deleteErrors.estimate_line_items || null }),
    invoices: createDeleteChain({ error: deleteErrors.invoices || null }),
    invoice_payments: createDeleteChain({ error: deleteErrors.invoice_payments || null }),
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
      delete: deleteChains[table] ? deleteChains[table].delete : undefined,
    };
  });

  return { from, countChains, writeChains, deleteChains };
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

  test("blocks migration when cloud rows exist that are not present on this device", async () => {
    const mockClient = createMockClient({
      counts: { customers: 0, projects: 1, estimates: 0, invoices: 0, invoicePayments: 0 },
      existingProjectRows: [{ id: "db_proj_x", legacy_local_id: "proj_x" }],
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
    expect(result.reason).toMatch(/not present on this device/i);
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

  test("normal backup blocks cloud-only estimate rows", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 0, invoicePayments: 0 },
      existingEstimateRows: [{ id: "db_est_x", legacy_local_id: "cloud_only_est" }],
      existingInvoiceRows: [],
      existingPaymentRows: [],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({ invoices: [] }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/not present on this device/i);
    expect(mockClient.deleteChains.estimates.delete).not.toHaveBeenCalled();
  });

  test("explicit replace-cloud option removes cloud-only estimate rows and completes the backup", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 0, invoicePayments: 0 },
      existingEstimateRows: [{ id: "db_est_x", legacy_local_id: "cloud_only_est" }],
      existingInvoiceRows: [],
      existingPaymentRows: [],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({ invoices: [] }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
      allowCloudOnlyReplacement: true,
    });

    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(false);
    expect(mockClient.deleteChains.estimates.delete).toHaveBeenCalled();
    expect(mockClient.deleteChains.estimates.eq).toHaveBeenCalledWith("company_id", "company_1");
    expect(mockClient.deleteChains.estimates.in).toHaveBeenCalledWith("id", ["db_est_x"]);
    expect(result.replacedCloudOnlyRows).toEqual([
      expect.objectContaining({ table: "estimates", legacyIds: ["cloud_only_est"], cloudRowIds: ["db_est_x"] }),
    ]);
  });

  test("replace-cloud option also removes the cloud-only estimate's orphaned line items so verification can actually clear", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 0, invoicePayments: 0 },
      existingEstimateRows: [{ id: "db_est_x", legacy_local_id: "cloud_only_est" }],
      existingInvoiceRows: [],
      existingPaymentRows: [],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({ invoices: [] }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
      allowCloudOnlyReplacement: true,
    });

    expect(result.ok).toBe(true);
    // The estimate's cloud-side line items (matched by the raw cloud
    // estimate id, not the legacy_local_id) must be deleted before the
    // estimate row itself, or they'd be permanently orphaned in the cloud
    // and estimate_line_items count would never match local again.
    expect(mockClient.deleteChains.estimate_line_items.delete).toHaveBeenCalled();
    expect(mockClient.deleteChains.estimate_line_items.eq).toHaveBeenCalledWith("company_id", "company_1");
    expect(mockClient.deleteChains.estimate_line_items.in).toHaveBeenCalledWith("estimate_id", ["db_est_x"]);
  });

  test("replace-cloud option surfaces estimate_line_items delete permission errors before attempting the parent estimate delete", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 0, invoicePayments: 0 },
      existingEstimateRows: [{ id: "db_est_x", legacy_local_id: "cloud_only_est" }],
      existingInvoiceRows: [],
      existingPaymentRows: [],
      deleteErrors: { estimate_line_items: { message: "permission denied for table estimate_line_items" } },
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({ invoices: [] }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
      allowCloudOnlyReplacement: true,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/permission denied for table estimate_line_items/i);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "error",
        code: "estimate_line_items_cloud_only_replace_failed",
        message: "permission denied for table estimate_line_items",
      }),
    ]));
    expect(mockClient.deleteChains.estimates.delete).not.toHaveBeenCalled();
  });

  test("replace-cloud option never deletes cloud-only invoice rows -- it still blocks and requires restore instead", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 1, invoicePayments: 0 },
      existingInvoiceRows: [{ id: "db_inv_x", legacy_local_id: "cloud_only_inv" }],
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
      allowCloudOnlyReplacement: true,
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/not present on this device/i);
    expect(mockClient.deleteChains.invoices.delete).not.toHaveBeenCalled();
  });

  test("replace-cloud option surfaces estimate delete errors instead of falsely reporting success", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 0, invoicePayments: 0 },
      existingEstimateRows: [{ id: "db_est_x", legacy_local_id: "cloud_only_est" }],
      existingInvoiceRows: [],
      existingPaymentRows: [],
      deleteErrors: { estimates: { message: "delete blocked by policy" } },
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({ invoices: [] }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
      allowCloudOnlyReplacement: true,
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.reason).toMatch(/delete blocked by policy/i);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({
        level: "error",
        code: "estimates_cloud_only_replace_failed",
        message: "delete blocked by policy",
      }),
    ]));
  });

  test("replace-cloud option still blocks duplicate local invoice ids", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 1, invoicePayments: 0 },
      existingEstimateRows: [{ id: "db_est_x", legacy_local_id: "cloud_only_est" }],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({
        invoices: [
          { id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-1", invoiceTotal: 100, amountPaid: 0, balanceRemaining: 100 },
          { id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-2", invoiceTotal: 100, amountPaid: 0, balanceRemaining: 100 },
        ],
      }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
      allowCloudOnlyReplacement: true,
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/local validation issues/i);
    expect(mockClient.deleteChains.estimates.delete).not.toHaveBeenCalled();
  });

  test("replace-cloud option still blocks duplicate local invoice numbers", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 1, invoicePayments: 0 },
      existingEstimateRows: [{ id: "db_est_x", legacy_local_id: "cloud_only_est" }],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({
        invoices: [
          { id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", invoiceTotal: 100, amountPaid: 0, balanceRemaining: 100 },
          { id: "inv_2", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", invoiceTotal: 100, amountPaid: 0, balanceRemaining: 100 },
        ],
      }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
      allowCloudOnlyReplacement: true,
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/local validation issues/i);
    expect(mockClient.deleteChains.estimates.delete).not.toHaveBeenCalled();
  });

  test("replace-cloud option preserves local invoice totals and payments while removing cloud-only estimates", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 1, invoicePayments: 1 },
      existingEstimateRows: [{ id: "db_est_x", legacy_local_id: "cloud_only_est" }],
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
      allowCloudOnlyReplacement: true,
    });

    expect(result.ok).toBe(true);
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          legacy_local_id: "inv_1",
          invoice_number: "INV-1",
          total_amount: 100,
          amount_paid: 25,
          balance_remaining: 75,
        }),
      ]),
      expect.any(Object),
    );
    expect(mockClient.writeChains.invoice_payments.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ legacy_local_id: "pay_1", amount: 25 }),
      ]),
      expect.any(Object),
    );
  });

  test("replace-cloud option still runs safe metadata repair before replacing cloud-only rows", async () => {
    const mockClient = createMockClient({
      counts: { customers: 1, projects: 1, estimates: 1, invoices: 1, invoicePayments: 0 },
      existingEstimateRows: [{ id: "db_est_x", legacy_local_id: "cloud_only_est" }],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const storageSnapshot = buildStorageSnapshot({
      invoices: [{
        id: "inv_1",
        projectId: "proj_1",
        customerId: "cust_1",
        sourceEstimateId: "missing_estimate",
        sourceEstimateSnapshot: { estimateId: "missing_estimate", estimateNumber: "EST-404" },
        estimateNumber: "EST-404",
        invoiceNumber: "INV-100",
        invoiceTotal: 100,
        total: 100,
        amountPaid: 25,
        balanceRemaining: 75,
        payments: [{ id: "pay_1", amount: 25, method: "cash", status: "paid" }],
      }],
    });

    const result = await runSupabaseMigrationWrite({
      storageSnapshot,
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
      allowCloudOnlyReplacement: true,
    });

    expect(result.ok).toBe(true);
    expect(result.repairSummary.staleInvoiceSourceEstimateIds).toEqual([
      expect.objectContaining({ invoiceId: "inv_1", staleSourceEstimateId: "missing_estimate" }),
    ]);
    const repairedInvoices = JSON.parse(storageSnapshot.getItem("estipaid-invoices-v1"));
    expect(repairedInvoices[0]).toEqual(expect.objectContaining({ sourceEstimateId: "" }));
    expect(mockClient.deleteChains.estimates.delete).toHaveBeenCalled();
  });

  test("resumes safe incremental backup writes when cloud rows are a subset of this device", async () => {
    const mockClient = createMockClient({
      counts: {
        customers: 1,
        projects: 1,
        estimates: 1,
        estimateLineItems: 1,
        invoices: 1,
        invoiceLineItems: 1,
        invoicePayments: 1,
      },
      existingEstimateRows: [{ id: "db_est_1", legacy_local_id: "est_1" }],
      existingInvoiceRows: [{ id: "db_inv_1", legacy_local_id: "inv_1" }],
      existingEstimateLineItemRows: [{ id: "db_est_line_1", legacy_local_id: "estimate:est_1:line:0" }],
      existingInvoiceLineItemRows: [{ id: "db_inv_line_1", legacy_local_id: "invoice:inv_1:line:0" }],
      existingPaymentRows: [{ id: "db_pay_1", legacy_local_id: "pay_1" }],
      estimateRows: [
        { id: "db_est_1", legacy_local_id: "est_1" },
        { id: "db_est_2", legacy_local_id: "est_2" },
      ],
      estimateLineItemRows: [
        { id: "db_est_line_1", legacy_local_id: "estimate:est_1:line:0" },
        { id: "db_est_line_2", legacy_local_id: "estimate:est_2:line:0" },
      ],
      invoiceRows: [
        { id: "db_inv_1", legacy_local_id: "inv_1" },
        { id: "db_inv_2", legacy_local_id: "inv_2" },
      ],
      invoiceLineItemRows: [
        { id: "db_inv_line_1", legacy_local_id: "invoice:inv_1:line:0" },
        { id: "db_inv_line_2", legacy_local_id: "invoice:inv_2:line:0" },
      ],
      paymentRows: [
        { id: "db_pay_1", legacy_local_id: "pay_1" },
        { id: "db_pay_2", legacy_local_id: "pay_2" },
      ],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const storageSnapshot = buildStorageSnapshot({
      estimates: [
        {
          id: "est_1",
          projectId: "proj_1",
          customerId: "cust_1",
          estimateNumber: "EST-1",
          total: 100,
          labor: { lines: [{ id: "est_line_1", description: "Labor", quantity: 1, rate: 100 }] },
        },
        {
          id: "est_2",
          projectId: "proj_1",
          customerId: "cust_1",
          estimateNumber: "EST-2",
          total: 220,
          labor: { lines: [{ id: "est_line_2", description: "Paint", quantity: 2, rate: 110 }] },
        },
      ],
      invoices: [
        {
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
        },
        {
          id: "inv_2",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "est_2",
          invoiceNumber: "INV-2",
          invoiceTotal: 220,
          amountPaid: 50,
          balanceRemaining: 170,
          lineItems: [{ id: "inv_line_2", description: "Paint", quantity: 2, price: 110, total: 220 }],
          payments: [{ id: "pay_2", amount: 50, method: "card", status: "paid" }],
        },
      ],
    });

    const preview = buildPreview({
      localCounts: {
        customers: 1,
        projects: 1,
        estimates: 2,
        estimateLineItems: 2,
        invoices: 2,
        invoiceLineItems: 2,
        invoicePayments: 2,
      },
      cloudCounts: {
        customers: 1,
        projects: 1,
        estimates: 1,
        estimateLineItems: 1,
        invoices: 1,
        invoiceLineItems: 1,
        invoicePayments: 1,
      },
    });

    const result = await runSupabaseMigrationWrite({
      storageSnapshot,
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview,
    });

    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "core_tables_upsert_safe_resume" }),
    ]));
    expect(mockClient.writeChains.customers.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.projects.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.estimates.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ legacy_local_id: "est_1" }),
        expect.objectContaining({ legacy_local_id: "est_2" }),
      ]),
      expect.any(Object),
    );
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ legacy_local_id: "inv_1" }),
        expect.objectContaining({ legacy_local_id: "inv_2" }),
      ]),
      expect.any(Object),
    );
    expect(mockClient.writeChains.invoice_payments.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ legacy_local_id: "pay_1" }),
        expect.objectContaining({ legacy_local_id: "pay_2" }),
      ]),
      expect.any(Object),
    );
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
      expect.objectContaining({ table: "estimate_line_items", status: "success", written: 1 }),
      expect.objectContaining({ table: "invoices", status: "success", written: 1 }),
      expect.objectContaining({ table: "invoice_line_items", status: "success", written: 1 }),
      expect.objectContaining({ table: "invoice_payments", status: "success", written: 1 }),
    ]));
    expect(mockClient.writeChains.customers.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.projects.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.estimates.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.estimate_line_items.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoice_line_items.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoice_payments.upsert).toHaveBeenCalled();
  });

  test("writes estimate restore payloads during cloud backup so estimates can be restored later", async () => {
    const mockClient = createMockClient();
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const storageSnapshot = buildStorageSnapshot({
      estimates: [{
        id: "est_1",
        projectId: "proj_1",
        customerId: "cust_1",
        estimateNumber: "EST-1",
        status: "approved",
        scopeNotes: "Restore me exactly.",
        job: { docNumber: "EST-1" },
        labor: { lines: [{ id: "est_line_1", role: "Tech", hours: 6, rate: 100, trueRateInternal: 50 }] },
        materials: { markupPct: 15, items: [] },
        ui: { materialsMode: "itemized" },
      }],
    });

    const result = await runSupabaseMigrationWrite({
      storageSnapshot,
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(true);
    expect(mockClient.writeChains.estimates.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          legacy_local_id: "est_1",
          estimate_number: "EST-1",
          restore_payload: expect.objectContaining({
            schema: "estipaid.estimate.restore_payload",
            legacyLocalId: "est_1",
            estimate: expect.objectContaining({
              id: "est_1",
              estimateNumber: "EST-1",
              scopeNotes: "Restore me exactly.",
              job: expect.objectContaining({ docNumber: "EST-1" }),
            }),
          }),
          restore_payload_version: "1",
          restore_payload_captured_at: expect.any(String),
        }),
      ]),
      expect.any(Object),
    );
  });

  test("repairs stale invoice sourceEstimateId before backup without changing invoice business values", async () => {
    const mockClient = createMockClient({
      estimateRows: [{ id: "db_est_2", legacy_local_id: "est_2" }],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const storageSnapshot = buildStorageSnapshot({
      estimates: [{
        id: "est_2",
        projectId: "proj_1",
        customerId: "cust_1",
        estimateNumber: "EST-2",
        total: 250,
      }],
      invoices: [{
        id: "inv_1",
        projectId: "proj_1",
        customerId: "cust_1",
        sourceEstimateId: "missing_estimate",
        sourceEstimateSnapshot: { estimateId: "missing_estimate", estimateNumber: "EST-404" },
        estimateNumber: "EST-404",
        invoiceNumber: "INV-100",
        invoiceTotal: 250,
        total: 250,
        amountPaid: 50,
        balanceRemaining: 200,
        payments: [{ id: "pay_1", amount: 50, method: "cash", status: "paid" }],
      }],
    });

    const result = await runSupabaseMigrationWrite({
      storageSnapshot,
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(true);
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          legacy_local_id: "inv_1",
          source_estimate_legacy_id: null,
          estimate_id: null,
          estimate_number: "EST-404",
          invoice_number: "INV-100",
          total_amount: 250,
          amount_paid: 50,
          balance_remaining: 200,
        }),
      ]),
      expect.any(Object),
    );

    const repairedInvoices = JSON.parse(storageSnapshot.getItem("estipaid-invoices-v1"));
    expect(repairedInvoices[0]).toEqual(expect.objectContaining({
      sourceEstimateId: "",
      sourceEstimateSnapshot: null,
      estimateNumber: "EST-404",
      invoiceNumber: "INV-100",
      total: 250,
      amountPaid: 50,
    }));
  });

  test("preserves a valid sourceEstimateId when the source estimate still exists", async () => {
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
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          legacy_local_id: "inv_1",
          source_estimate_legacy_id: "est_1",
          invoice_number: "INV-1",
        }),
      ]),
      expect.any(Object),
    );
  });

  test("backs up a standalone invoice without sourceEstimateId", async () => {
    const mockClient = createMockClient({
      estimateRows: [],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({
        estimates: [],
        invoices: [{
          id: "inv_1",
          projectId: "proj_1",
          customerId: "cust_1",
          invoiceNumber: "INV-100",
          invoiceTotal: 120,
          total: 120,
          amountPaid: 20,
          balanceRemaining: 100,
          payments: [{ id: "pay_1", amount: 20, method: "cash", status: "paid" }],
        }],
      }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview({
        localCounts: {
          customers: 1,
          projects: 1,
          estimates: 0,
          estimateLineItems: 0,
          invoices: 1,
          invoiceLineItems: 0,
          invoicePayments: 1,
        },
      }),
    });

    expect(result.ok).toBe(true);
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          legacy_local_id: "inv_1",
          source_estimate_legacy_id: null,
          estimate_id: null,
          invoice_number: "INV-100",
        }),
      ]),
      expect.any(Object),
    );
  });

  test("repairs a stale invoice projectId before backup without blocking or changing invoice values", async () => {
    const mockClient = createMockClient();
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const storageSnapshot = buildStorageSnapshot({
      invoices: [{
        id: "inv_1",
        projectId: "missing_project",
        customerId: "cust_1",
        sourceEstimateId: "est_1",
        invoiceNumber: "INV-100",
        status: "sent",
        invoiceTotal: 250,
        total: 250,
        amountPaid: 50,
        balanceRemaining: 200,
        payments: [{ id: "pay_1", amount: 50, method: "cash", status: "paid" }],
      }],
    });

    const result = await runSupabaseMigrationWrite({
      storageSnapshot,
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(false);
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          legacy_local_id: "inv_1",
          project_id: null,
          invoice_number: "INV-100",
          total_amount: 250,
          amount_paid: 50,
          balance_remaining: 200,
        }),
      ]),
      expect.any(Object),
    );

    const repairedInvoices = JSON.parse(storageSnapshot.getItem("estipaid-invoices-v1"));
    expect(repairedInvoices[0]).toEqual(expect.objectContaining({
      projectId: "",
      invoiceNumber: "INV-100",
      status: "sent",
      total: 250,
      amountPaid: 50,
      balanceRemaining: 200,
    }));
  });

  test("preserves a valid invoice projectId when the project still exists", async () => {
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
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          legacy_local_id: "inv_1",
          project_id: "db_proj_1",
          customer_id: "db_cust_1",
          invoice_number: "INV-1",
          total_amount: 100,
          amount_paid: 25,
          balance_remaining: 75,
        }),
      ]),
      expect.any(Object),
    );
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

  test("safe resume skips duplicate line-item writes when they already match cloud data", async () => {
    const mockClient = createMockClient({
      counts: {
        customers: 1,
        projects: 1,
        estimates: 1,
        estimateLineItems: 1,
        invoices: 1,
        invoiceLineItems: 1,
        invoicePayments: 1,
      },
      existingEstimateRows: [{ id: "db_est_1", legacy_local_id: "est_1" }],
      existingInvoiceRows: [{ id: "db_inv_1", legacy_local_id: "inv_1" }],
      existingEstimateLineItemRows: [{ id: "db_est_line_1", legacy_local_id: "estimate:est_1:line:0" }],
      existingInvoiceLineItemRows: [{ id: "db_inv_line_1", legacy_local_id: "invoice:inv_1:line:0" }],
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
    expect(result.blocked).toBe(false);
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "estimate_line_items", status: "reused", reused: 1, skipped: 1 }),
      expect.objectContaining({ table: "invoice_line_items", status: "reused", reused: 1, skipped: 1 }),
    ]));
    expect(mockClient.writeChains.customers.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.estimates.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.estimate_line_items.upsert).not.toHaveBeenCalled();
    expect(mockClient.writeChains.invoice_line_items.upsert).not.toHaveBeenCalled();
  });

  test("safe resume migrates missing line items while still upserting the existing core rows", async () => {
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
      existingEstimateRows: [{ id: "db_est_1", legacy_local_id: "est_1" }],
      existingInvoiceRows: [{ id: "db_inv_1", legacy_local_id: "inv_1" }],
      existingEstimateLineItemRows: [],
      existingInvoiceLineItemRows: [],
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
    expect(result.tableResults).toEqual(expect.arrayContaining([
      expect.objectContaining({ table: "customers", status: "success", written: 1 }),
      expect.objectContaining({ table: "estimate_line_items", status: "success", written: 1 }),
      expect.objectContaining({ table: "invoice_line_items", status: "success", written: 1 }),
    ]));
    expect(mockClient.writeChains.customers.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.projects.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.estimates.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoices.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoice_payments.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.estimate_line_items.upsert).toHaveBeenCalled();
    expect(mockClient.writeChains.invoice_line_items.upsert).toHaveBeenCalled();
  });

  test("generated estimate and invoice line-item ids include the parent local id and a stable index, never the raw item id", async () => {
    const mockClient = createMockClient({
      estimateLineItemRows: [{ id: "db_est_line_1", legacy_local_id: "estimate:est_1:line:0" }],
      invoiceLineItemRows: [{ id: "db_inv_line_1", legacy_local_id: "invoice:inv_1:line:0" }],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({
        estimates: [{
          id: "est_1",
          projectId: "proj_1",
          customerId: "cust_1",
          estimateNumber: "EST-1",
          total: 300,
          labor: { lines: [{ description: "Labor", quantity: 1, rate: 100 }] },
          materials: { items: [{ description: "Lumber", quantity: 1, price: 200 }] },
        }],
        invoices: [{
          id: "inv_1",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "est_1",
          invoiceNumber: "INV-1",
          invoiceTotal: 300,
          amountPaid: 25,
          balanceRemaining: 275,
          lineItems: [
            { description: "Material", quantity: 1, price: 100, total: 100 },
            { description: "Labor", quantity: 1, price: 200, total: 200 },
          ],
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

    expect(result.ok).toBe(true);
    // Two kinds (labor + materials) both start their own local index at 0, so
    // sort_order collides across the parent's combined line_items array; the
    // writer must fall back to the normalized array position, not raw ids.
    expect(mockClient.writeChains.estimate_line_items.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ legacy_local_id: "estimate:est_1:line:0" }),
        expect.objectContaining({ legacy_local_id: "estimate:est_1:line:1" }),
      ]),
      expect.any(Object),
    );
    expect(mockClient.writeChains.invoice_line_items.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ legacy_local_id: "invoice:inv_1:line:0" }),
        expect.objectContaining({ legacy_local_id: "invoice:inv_1:line:1" }),
      ]),
      expect.any(Object),
    );
  });

  test("does not block when raw invoice line-item ids duplicate across different invoices but generated ids are unique", async () => {
    const mockClient = createMockClient({
      invoiceRows: [
        { id: "db_inv_1", legacy_local_id: "inv_1" },
        { id: "db_inv_2", legacy_local_id: "inv_2" },
      ],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({
        estimates: [],
        invoices: [
          {
            id: "inv_1",
            projectId: "proj_1",
            customerId: "cust_1",
            invoiceNumber: "INV-1",
            invoiceTotal: 100,
            amountPaid: 0,
            balanceRemaining: 100,
            lineItems: [{ id: "dup_line", description: "Material A", quantity: 1, price: 100, total: 100 }],
          },
          {
            id: "inv_2",
            projectId: "proj_1",
            customerId: "cust_1",
            invoiceNumber: "INV-2",
            invoiceTotal: 200,
            amountPaid: 0,
            balanceRemaining: 200,
            lineItems: [{ id: "dup_line", description: "Material B", quantity: 1, price: 200, total: 200 }],
          },
        ],
      }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview({
        localCounts: {
          customers: 1,
          projects: 1,
          estimates: 0,
          estimateLineItems: 0,
          invoices: 2,
          invoiceLineItems: 2,
          invoicePayments: 0,
        },
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.blocked).toBe(false);
    expect(mockClient.writeChains.invoice_line_items.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ legacy_local_id: "invoice:inv_1:line:0" }),
        expect.objectContaining({ legacy_local_id: "invoice:inv_2:line:0" }),
      ]),
      expect.any(Object),
    );
    expect(result.notices.some((notice) => notice.level === "error")).toBe(false);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invoice_line_item_raw_ids_normalized" }),
    ]));
  });

  test("still blocks when generated line-item migration ids collide", async () => {
    // Two distinct (non-duplicate) parent local ids that sanitize to the same
    // segment ("est 1" -> "est_1", "est_1" -> "est_1") so this exercises the
    // line-item-level dedup itself, not the separate duplicate-parent-id guard.
    const mockClient = createMockClient({
      estimateRows: [
        { id: "db_est_1", legacy_local_id: "est 1" },
        { id: "db_est_2", legacy_local_id: "est_1" },
      ],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({
        estimates: [
          {
            id: "est 1",
            projectId: "proj_1",
            customerId: "cust_1",
            estimateNumber: "EST-1",
            total: 100,
            labor: { lines: [{ id: "line_a", description: "Labor A", quantity: 1, rate: 100 }] },
          },
          {
            id: "est_1",
            projectId: "proj_1",
            customerId: "cust_1",
            estimateNumber: "EST-2",
            total: 200,
            labor: { lines: [{ id: "line_b", description: "Labor B", quantity: 1, rate: 200 }] },
          },
        ],
        invoices: [],
      }),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview({
        localCounts: {
          customers: 1,
          projects: 1,
          estimates: 2,
          estimateLineItems: 2,
          invoices: 0,
          invoiceLineItems: 0,
          invoicePayments: 0,
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.blocked).toBe(true);
    expect(result.notices.some((notice) =>
      notice.level === "error" && notice.code.startsWith("duplicate_estimate_line_item_local_id")
    )).toBe(true);
  });

  test("completes validation before writes and blocks early on unrepaired local document issues", async () => {
    const mockClient = createMockClient();
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const result = await runSupabaseMigrationWrite({
      storageSnapshot: buildStorageSnapshot({
        invoices: [{
          id: "inv_missing_number",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "est_1",
          invoiceNumber: "",
          invoiceTotal: 100,
          amountPaid: 0,
          balanceRemaining: 100,
          lineItems: [{ id: "inv_line_1", description: "Material", quantity: 1, price: 100, total: 100 }],
          payments: [],
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
    expect(result.reason).toMatch(/local validation issues/i);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invoice_number_missing" }),
    ]));
    expect(mockClient.writeChains.customers.upsert).not.toHaveBeenCalled();
    expect(mockClient.writeChains.projects.upsert).not.toHaveBeenCalled();
  });

  test("repairs missing estimate numbers before cloud backup and persists the repaired value", async () => {
    const mockClient = createMockClient({
      estimateRows: [{ id: "db_est_missing_number", legacy_local_id: "est_missing_number" }],
      estimateLineItemRows: [{ id: "db_est_line_1", legacy_local_id: "estimate:est_missing_number:line:0" }],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);
    const storageSnapshot = buildStorageSnapshot({
      estimates: [{
        id: "est_missing_number",
        projectId: "proj_1",
        customerId: "cust_1",
        total: 100,
        grandTotal: 100,
        totalRevenue: 100,
        labor: { lines: [{ id: "est_line_1", description: "Labor", quantity: 1, rate: 100 }] },
        job: { date: "2026-07-03", docNumber: "" },
      }],
      invoices: [],
    });

    const result = await runSupabaseMigrationWrite({
      storageSnapshot,
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview: buildPreview(),
    });

    expect(result.ok).toBe(true);
    expect(result.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "safe_metadata_repaired" }),
    ]));
    expect(mockClient.writeChains.estimates.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          legacy_local_id: "est_missing_number",
          estimate_number: "EST-0001",
          total_amount: 100,
        }),
      ]),
      expect.any(Object),
    );

    const persisted = JSON.parse(storageSnapshot.getItem("estipaid-estimates-v1"));
    expect(persisted[0]).toEqual(expect.objectContaining({
      id: "est_missing_number",
      estimateNumber: "EST-0001",
      projectId: "proj_1",
      customerId: "cust_1",
      total: 100,
    }));
    expect(persisted[0].job).toEqual(expect.objectContaining({ docNumber: "EST-0001" }));
  });

  test("repairs multiple missing estimate numbers uniquely and keeps the repaired values stable across backups", async () => {
    const mockClient = createMockClient({
      estimateRows: [
        { id: "db_est_1", legacy_local_id: "est_missing_1" },
        { id: "db_est_2", legacy_local_id: "est_existing" },
        { id: "db_est_3", legacy_local_id: "est_missing_2" },
      ],
      estimateLineItemRows: [
        { id: "db_est_line_1", legacy_local_id: "estimate:est_missing_1:line:0" },
        { id: "db_est_line_2", legacy_local_id: "estimate:est_existing:line:0" },
        { id: "db_est_line_3", legacy_local_id: "estimate:est_missing_2:line:0" },
      ],
    });
    mockGetSupabaseClient.mockReturnValue(mockClient);
    const storageSnapshot = buildStorageSnapshot({
      estimates: [
        {
          id: "est_missing_1",
          projectId: "proj_1",
          customerId: "cust_1",
          total: 100,
          labor: { lines: [{ id: "line_1", description: "Labor 1", quantity: 1, rate: 100 }] },
          job: { date: "2026-07-03", docNumber: "" },
        },
        {
          id: "est_existing",
          projectId: "proj_1",
          customerId: "cust_1",
          estimateNumber: "EST-0021",
          total: 120,
          labor: { lines: [{ id: "line_2", description: "Labor 2", quantity: 1, rate: 120 }] },
          job: { date: "2026-07-03", docNumber: "EST-0021" },
        },
        {
          id: "est_missing_2",
          projectId: "proj_1",
          customerId: "cust_1",
          total: 140,
          labor: { lines: [{ id: "line_3", description: "Labor 3", quantity: 1, rate: 140 }] },
          job: { date: "2026-07-03", docNumber: "" },
        },
      ],
      invoices: [],
    });
    const preview = buildPreview({
      localCounts: {
        customers: 1,
        projects: 1,
        estimates: 3,
        estimateLineItems: 3,
        invoices: 0,
        invoiceLineItems: 0,
        invoicePayments: 0,
      },
      cloudCounts: {
        customers: 0,
        projects: 0,
        estimates: 0,
        estimateLineItems: 0,
        invoices: 0,
        invoiceLineItems: 0,
        invoicePayments: 0,
      },
    });

    const first = await runSupabaseMigrationWrite({
      storageSnapshot,
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview,
    });

    expect(first.ok).toBe(true);
    const repairedOnce = JSON.parse(storageSnapshot.getItem("estipaid-estimates-v1"));
    expect(repairedOnce.map((estimate) => estimate.estimateNumber)).toEqual([
      "EST-0022",
      "EST-0021",
      "EST-0023",
    ]);

    const second = await runSupabaseMigrationWrite({
      storageSnapshot,
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "AAS Property Care" },
      role: "owner",
      backupDownloadAvailable: true,
      preview,
    });

    expect(second.ok).toBe(true);
    expect(second.notices.some((notice) => notice.code === "estimate_numbers_repaired")).toBe(false);
    const repairedTwice = JSON.parse(storageSnapshot.getItem("estipaid-estimates-v1"));
    expect(repairedTwice.map((estimate) => estimate.estimateNumber)).toEqual([
      "EST-0022",
      "EST-0021",
      "EST-0023",
    ]);
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
