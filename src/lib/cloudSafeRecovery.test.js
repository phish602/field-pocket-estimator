const mockExportSupabaseCloudBackupArtifact = jest.fn();

jest.mock("./supabaseCloudRestore", () => ({
  __esModule: true,
  exportSupabaseCloudBackupArtifact: (...args) => mockExportSupabaseCloudBackupArtifact(...args),
  CLOUD_BACKUP_EXPORT_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    EXPORTED: "exported",
    ERROR: "error",
  },
  CLOUD_BACKUP_EXPORT_ARTIFACT_VERSION: "cloud-backup-export-artifact-v1",
}));

const {
  previewSafeCloudRecovery,
  applySafeCloudRecovery,
  SAFE_CLOUD_RECOVERY_STATUS,
} = require("./cloudSafeRecovery");
const { STORAGE_KEYS } = require("../constants/storageKeys");

const baseContext = {
  configured: true,
  user: { id: "user_1" },
  company: { id: "company_1", name: "AAS Property Care" },
};

function cloudArtifact(overrides = {}) {
  return {
    artifactVersion: "cloud-backup-export-artifact-v1",
    schemaVersion: 1,
    source: "cloud",
    app: "EstiPaid",
    exportedAt: "2026-07-05T12:00:00.000Z",
    companyId: "company_1",
    counts: {
      customers: 2,
      projects: 1,
      estimates: 4,
      estimateLineItems: 0,
      invoices: 1,
      invoiceLineItems: 1,
      invoicePayments: 1,
      scopeTemplates: 0,
    },
    restorePayloadCoverage: { totalEstimates: 4, estimatesWithRestorePayload: 1, estimatesMissingRestorePayload: 3 },
    optionalSections: { appRestoreBundle: "missing" },
    records: {
      customers: [{ id: "cust_1" }, { id: "cust_2" }],
      projects: [{ id: "proj_1" }],
      estimates: [{ id: "est_1", labor: { hazardPct: 5, lines: [] } }],
      invoices: [{ id: "inv_1", lineItems: [{ id: "line_1" }], payments: [{ id: "pay_1" }] }],
      companyProfile: null,
      settings: { pdf: { includeLogo: true } },
      scopeTemplates: null,
    },
    notices: [],
    ...overrides,
  };
}

function buildWritableStorage() {
  const store = {};
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: jest.fn((key, value) => {
      store[key] = value;
    }),
    __store: store,
  };
}

beforeEach(() => {
  mockExportSupabaseCloudBackupArtifact.mockReset();
});

describe("previewSafeCloudRecovery", () => {
  test("previews counts and skipped estimates from the cloud without writing anything", async () => {
    mockExportSupabaseCloudBackupArtifact.mockResolvedValue({
      status: "exported",
      artifact: cloudArtifact(),
      error: "",
    });

    const preview = await previewSafeCloudRecovery(baseContext);

    expect(preview.status).toBe(SAFE_CLOUD_RECOVERY_STATUS.PREVIEWED);
    expect(preview.counts).toEqual({ customers: 2, projects: 1, estimates: 1, invoices: 1, invoicePayments: 1 });
    expect(preview.skippedEstimates).toBe(3);
    expect(preview.plan.ok).toBe(true);
  });

  test("propagates a cloud read failure instead of previewing an empty recovery", async () => {
    mockExportSupabaseCloudBackupArtifact.mockResolvedValue({
      status: "error",
      artifact: null,
      error: "Unable to read customers from Supabase. Cloud backup JSON was not created.",
      failedTable: "customers",
    });

    const preview = await previewSafeCloudRecovery(baseContext);

    expect(preview.status).toBe(SAFE_CLOUD_RECOVERY_STATUS.ERROR);
    expect(preview.error).toContain("Unable to read customers from Supabase");
    expect(preview.failedTable).toBe("customers");
    expect(preview.plan).toBeNull();
  });

  test("reports nothing_to_recover when the cloud has no core records", async () => {
    mockExportSupabaseCloudBackupArtifact.mockResolvedValue({
      status: "exported",
      artifact: cloudArtifact({
        records: {
          customers: [],
          projects: [],
          estimates: [],
          invoices: [],
          companyProfile: null,
          settings: null,
          scopeTemplates: null,
        },
        restorePayloadCoverage: { totalEstimates: 3, estimatesWithRestorePayload: 0, estimatesMissingRestorePayload: 3 },
      }),
      error: "",
    });

    const preview = await previewSafeCloudRecovery(baseContext);

    expect(preview.status).toBe(SAFE_CLOUD_RECOVERY_STATUS.NOTHING_TO_RECOVER);
    expect(preview.skippedEstimates).toBe(3);
    expect(preview.plan).toBeNull();
  });

  test("blocks at signed_out / no_workspace", async () => {
    mockExportSupabaseCloudBackupArtifact.mockResolvedValue({
      status: "signed_out",
      artifact: null,
      error: "Sign in to Supabase before downloading a cloud backup JSON.",
    });

    const preview = await previewSafeCloudRecovery({ configured: false });
    expect(preview.status).toBe(SAFE_CLOUD_RECOVERY_STATUS.SIGNED_OUT);
  });
});

describe("applySafeCloudRecovery", () => {
  test("maps cloud records into local storage in one pass -- no JSON download/import round trip", async () => {
    mockExportSupabaseCloudBackupArtifact.mockResolvedValue({
      status: "exported",
      artifact: cloudArtifact(),
      error: "",
    });
    const storage = buildWritableStorage();

    const preview = await previewSafeCloudRecovery(baseContext);
    const result = applySafeCloudRecovery({ preview, storage });

    expect(result.status).toBe(SAFE_CLOUD_RECOVERY_STATUS.RECOVERED);
    expect(result.recoveredCounts).toEqual({ customers: 2, projects: 1, estimates: 1, invoices: 1, invoicePayments: 1 });
    expect(result.skippedEstimates).toBe(3);
    expect(JSON.parse(storage.__store[STORAGE_KEYS.CUSTOMERS])).toHaveLength(2);
    expect(JSON.parse(storage.__store[STORAGE_KEYS.PROJECTS])).toHaveLength(1);
    // Only payload-backed estimates are written -- skipped ones are never guessed.
    expect(JSON.parse(storage.__store[STORAGE_KEYS.ESTIMATES])).toEqual([
      expect.objectContaining({ id: "est_1" }),
    ]);
    expect(JSON.parse(storage.__store[STORAGE_KEYS.INVOICES])[0]).toEqual(
      expect.objectContaining({ id: "inv_1", payments: [expect.objectContaining({ id: "pay_1" })] })
    );
    // Cloud settings restore whole, same as full cloud restore.
    expect(JSON.parse(storage.__store[STORAGE_KEYS.SETTINGS])).toEqual({ pdf: { includeLogo: true } });
    expect(result.settingsWritten).toBe(true);
  });

  test("dispatches same-tab refresh events so Home/Settings update without a reload", async () => {
    mockExportSupabaseCloudBackupArtifact.mockResolvedValue({
      status: "exported",
      artifact: cloudArtifact(),
      error: "",
    });
    const storage = buildWritableStorage();
    const seen = [];
    const events = [
      "estipaid:customers-changed",
      "estipaid:projects-changed",
      "estipaid:estimates-changed",
      "estipaid:invoices-changed",
      "estipaid:settings-changed",
    ];
    const listeners = events.map((name) => {
      const listener = () => seen.push(name);
      window.addEventListener(name, listener);
      return { name, listener };
    });

    try {
      const preview = await previewSafeCloudRecovery(baseContext);
      applySafeCloudRecovery({ preview, storage });
    } finally {
      listeners.forEach(({ name, listener }) => window.removeEventListener(name, listener));
    }

    expect(seen).toEqual(expect.arrayContaining(events));
  });

  test("refuses to apply without a previewed plan", () => {
    const storage = buildWritableStorage();

    const result = applySafeCloudRecovery({
      preview: { status: SAFE_CLOUD_RECOVERY_STATUS.NOTHING_TO_RECOVER, plan: null },
      storage,
    });

    expect(result.status).toBe(SAFE_CLOUD_RECOVERY_STATUS.ERROR);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
