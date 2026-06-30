import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";

const mockGetSupabaseClient = jest.fn();

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

const {
  createSupabaseMigrationPreview,
  SUPABASE_MIGRATION_PREVIEW_VERSION,
} = require("./supabaseMigrationPreview");

function buildSnapshot(overrides = {}) {
  const base = {
    "estipaid-company-profile-v1": JSON.stringify({ name: "Field Pocket LLC" }),
    "estipaid-customers-v1": JSON.stringify([{ id: "cust_1" }, { id: "cust_2" }]),
    "estipaid-projects-v1": JSON.stringify([{ id: "proj_1" }]),
    "estipaid-estimates-v1": JSON.stringify([{ id: "est_1", labor: { lines: [{ id: "est_line_1", description: "Labor", quantity: 1, rate: 25 }] } }]),
    "estipaid-invoices-v1": JSON.stringify([
      {
        id: "inv_1",
        lineItems: [{ id: "inv_line_1", description: "Material", quantity: 2, price: 10, total: 20 }],
        payments: [{ id: "pay_1", amount: 25 }, { id: "pay_2", amount: 10 }],
      },
      { id: "inv_2", payments: [] },
    ]),
    "estipaid-settings-v1": JSON.stringify({ pdf: { includeLogo: true } }),
    "estipaid-scope-templates-v1": JSON.stringify([{ id: "tmpl_1" }]),
    "estipaid-audit-events-v1": JSON.stringify([]),
  };
  return { ...base, ...overrides };
}

function createCountChain(response) {
  const eq = jest.fn(async () => response);
  const select = jest.fn(() => ({ eq }));
  return { select, eq };
}

function createMockClient(counts = {}) {
  const chains = {
    customers: createCountChain({ count: counts.customers ?? 3, error: null }),
    projects: createCountChain({ count: counts.projects ?? 1, error: null }),
    estimates: createCountChain({ count: counts.estimates ?? 4, error: null }),
    estimate_line_items: createCountChain({ count: counts.estimateLineItems ?? 6, error: null }),
    invoices: createCountChain({ count: counts.invoices ?? 2, error: null }),
    invoice_line_items: createCountChain({ count: counts.invoiceLineItems ?? 7, error: null }),
    invoice_payments: createCountChain({ count: counts.invoicePayments ?? 5, error: null }),
  };
  const from = jest.fn((table) => {
    const chain = chains[table];
    if (!chain) throw new Error(`Unexpected table: ${table}`);
    return chain;
  });
  return { from, chains };
}

describe("createSupabaseMigrationPreview", () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
  });

  test("builds local counts from the export artifact and reads cloud counts with select-only queries", async () => {
    const mockClient = createMockClient();
    mockGetSupabaseClient.mockReturnValue(mockClient);

    const preview = await createSupabaseMigrationPreview({
      storageSnapshot: buildSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      backupDownloadAvailable: true,
    });

    expect(preview.previewVersion).toBe(SUPABASE_MIGRATION_PREVIEW_VERSION);
    expect(preview.localCounts).toEqual({
      customers: 2,
      projects: 1,
      estimates: 1,
      estimateLineItems: 1,
      invoices: 2,
      invoiceLineItems: 1,
      invoicePayments: 2,
      scopeTemplates: 1,
      settings: 1,
    });
    expect(preview.cloudCountCheckAvailable).toBe(true);
    expect(preview.cloudCounts).toEqual({
      customers: 3,
      projects: 1,
      estimates: 4,
      estimateLineItems: 6,
      invoices: 2,
      invoiceLineItems: 7,
      invoicePayments: 5,
    });
    expect(preview.noWritesPerformed).toBe(true);
    expect(preview.notices.some((notice) => notice.level === "error")).toBe(false);
    expect(mockClient.from).toHaveBeenCalledWith("customers");
    expect(mockClient.from).toHaveBeenCalledWith("projects");
    expect(mockClient.from).toHaveBeenCalledWith("estimates");
    expect(mockClient.from).toHaveBeenCalledWith("estimate_line_items");
    expect(mockClient.from).toHaveBeenCalledWith("invoices");
    expect(mockClient.from).toHaveBeenCalledWith("invoice_line_items");
    expect(mockClient.from).toHaveBeenCalledWith("invoice_payments");
    expect(mockClient.chains.customers.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(mockClient.chains.customers.eq).toHaveBeenCalledWith("company_id", "company_1");
    expect(preview.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "estimate_line_items_schema_blocked" }),
      expect.objectContaining({ code: "invoice_line_items_schema_blocked" }),
    ]));
  });

  test("reports validation issues and unavailable cloud counts without performing writes", async () => {
    const preview = await createSupabaseMigrationPreview({
      storageSnapshot: buildSnapshot({
        "estipaid-estimates-v1": "{broken",
        "estipaid-invoices-v1": undefined,
      }),
      configured: false,
      user: null,
      company: null,
      role: "member",
      backupDownloadAvailable: false,
    });

    expect(preview.validations.supabaseConfigured).toBe(false);
    expect(preview.validations.signedIn).toBe(false);
    expect(preview.validations.hasCompany).toBe(false);
    expect(preview.validations.roleAllowedForMigration).toBe(false);
    expect(preview.validations.backupDownloadAvailable).toBe(false);
    expect(preview.validations.localDataReadable).toBe(false);
    expect(preview.cloudCountCheckAvailable).toBe(false);
    expect(preview.cloudCounts).toBeNull();
    expect(preview.noWritesPerformed).toBe(true);
    expect(preview.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "backup_gate_missing" }),
      expect.objectContaining({ code: "supabase_not_configured" }),
      expect.objectContaining({ code: "not_signed_in" }),
      expect.objectContaining({ code: "company_missing" }),
      expect.objectContaining({ code: "role_not_allowed" }),
      expect.objectContaining({ code: "local_data_unreadable" }),
      expect.objectContaining({ code: "local_keys_missing" }),
      expect.objectContaining({ code: "cloud_counts_unavailable" }),
    ]));
  });

  test("uses the same artifact shape as the backup export helper", async () => {
    const snapshot = buildSnapshot();
    const artifact = buildLocalStorageExportArtifact(snapshot);

    const preview = await createSupabaseMigrationPreview({
      storageSnapshot: snapshot,
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "admin",
      backupDownloadAvailable: true,
    });

    expect(preview.localArtifact.migrationReadiness.customerCount).toBe(artifact.migrationReadiness.customerCount);
    expect(preview.localArtifact.migrationReadiness.projectCount).toBe(artifact.migrationReadiness.projectCount);
    expect(preview.localArtifact.parseWarnings).toEqual(artifact.parseWarnings);
    expect(preview.localArtifact.storageKeysMissing).toEqual(artifact.storageKeysMissing);
  });

  test("falls back to unavailable cloud counts when a read-only count query fails", async () => {
    const failingChain = createCountChain({ count: null, error: { message: "relation does not exist" } });
    mockGetSupabaseClient.mockReturnValue({
      from: jest.fn((table) => {
        if (table === "customers") return failingChain;
        throw new Error(`Unexpected table: ${table}`);
      }),
    });

    const preview = await createSupabaseMigrationPreview({
      storageSnapshot: buildSnapshot(),
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      backupDownloadAvailable: true,
    });

    expect(preview.cloudCountCheckAvailable).toBe(false);
    expect(preview.cloudCounts).toBeNull();
    expect(preview.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "cloud_counts_unavailable" }),
    ]));
  });
});
