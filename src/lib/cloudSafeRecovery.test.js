const mockExportSupabaseCloudBackupArtifact = jest.fn();
const mockBuildLocalSnapshotFromStorage = jest.fn();
const mockScanLocalDataIntegrity = jest.fn();
const mockRepairStoredLocalDataIntegrity = jest.fn();
const mockRunSupabaseCloudOnboardingBackup = jest.fn();
const mockClearCloudBackupDirty = jest.fn();

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

jest.mock("./localDataIntegrity", () => ({
  __esModule: true,
  buildLocalSnapshotFromStorage: (...args) => mockBuildLocalSnapshotFromStorage(...args),
  scanLocalDataIntegrity: (...args) => mockScanLocalDataIntegrity(...args),
  repairStoredLocalDataIntegrity: (...args) => mockRepairStoredLocalDataIntegrity(...args),
}));

jest.mock("./supabaseCloudOnboarding", () => ({
  __esModule: true,
  runSupabaseCloudOnboardingBackup: (...args) => mockRunSupabaseCloudOnboardingBackup(...args),
  CLOUD_ONBOARDING_STATUS: {
    BACKUP_COMPLETED: "backup_completed",
    NEEDS_ATTENTION: "needs_attention",
  },
}));

jest.mock("./cloudBackupQueue", () => ({
  __esModule: true,
  clearCloudBackupDirty: (...args) => mockClearCloudBackupDirty(...args),
}));

const {
  previewSafeCloudRecovery,
  applySafeCloudRecovery,
  runRecoveryContinuation,
  describeBackupPauseReason,
  SAFE_CLOUD_RECOVERY_STATUS,
  RECOVERY_CONTINUATION_STATUS,
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
    notices: [{
      level: "warning",
      code: "estimates_missing_restore_payload_excluded",
      message: "3 cloud estimate(s) have no restore payload and are not included as importable estimates.",
      details: {
        missingRestorePayloadCount: 3,
        missingLegacyIds: ["est_2", "est_3", "est_4"],
      },
    }],
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
  mockBuildLocalSnapshotFromStorage.mockReset();
  mockBuildLocalSnapshotFromStorage.mockImplementation((storage) => ({ snapshot: storage?.__snapshot || {} }));
  mockScanLocalDataIntegrity.mockReset();
  mockRepairStoredLocalDataIntegrity.mockReset();
  mockRunSupabaseCloudOnboardingBackup.mockReset();
  mockClearCloudBackupDirty.mockReset();
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
    expect(preview.skippedEstimateLegacyIds).toEqual(["est_2", "est_3", "est_4"]);
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
    expect(result.skippedEstimateLegacyIds).toEqual(["est_2", "est_3", "est_4"]);
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

describe("recovery continuation", () => {
  test("maps estimate job-link blockers to contractor-safe language", () => {
    expect(describeBackupPauseReason({ code: "estimate_project_missing" })).toBe(
      "Some recovered estimates are not linked to a job."
    );
  });

  test("repairs once and then backs up automatically when recovered data is safe", async () => {
    const phases = [];
    mockScanLocalDataIntegrity.mockReturnValue({
      blockers: [],
      safeRepairs: [{ code: "estimate_project_stale" }],
    });
    mockRepairStoredLocalDataIntegrity.mockReturnValue({
      changed: true,
      repairs: { staleEstimateProjectIds: [{ estimateId: "est_1", staleProjectId: "missing_project" }] },
      integrity: { blockers: [], safeRepairs: [] },
    });
    mockRunSupabaseCloudOnboardingBackup.mockResolvedValue({
      status: "backup_completed",
    });

    const result = await runRecoveryContinuation({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
      storage: { __snapshot: {} },
      skippedEstimates: 0,
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.BACKED_UP);
    expect(result.repairChanged).toBe(true);
    expect(mockRunSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
    }));
    expect(phases).toEqual(["checking", "repairing", "backing_up"]);
  });

  test("pauses with job-language when a blocker remains after the recheck", async () => {
    mockScanLocalDataIntegrity.mockReturnValue({
      blockers: [{ code: "estimate_project_missing", message: "One or more estimates reference a project id that is not present locally." }],
      safeRepairs: [],
    });

    const result = await runRecoveryContinuation({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
      storage: { __snapshot: {} },
      skippedEstimates: 3,
    });

    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.PAUSED);
    expect(result.pausedReason).toBe("Some recovered estimates are not linked to a job.");
    expect(result.pausedReasonCode).toBe("estimate_project_missing");
    expect(mockRunSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  });

  test("treats skipped-estimate-only mismatch as a successful backup and clears the queue", async () => {
    mockScanLocalDataIntegrity.mockReturnValue({
      blockers: [],
      safeRepairs: [],
    });
    const storage = buildWritableStorage();
    mockRunSupabaseCloudOnboardingBackup.mockResolvedValue({
      status: "needs_attention",
      writeResult: { ok: true },
      verification: {
        ok: true,
        tableResults: [
          { table: "estimates", status: "mismatch", missingLegacyIds: [], extraLegacyIds: ["cloud_only_est_1"] },
          { table: "estimate_line_items", status: "mismatch", countOnly: true, localCount: 0, cloudCount: 2 },
          { table: "customers", status: "matched" },
        ],
      },
    });

    const result = await runRecoveryContinuation({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
      storage,
      skippedEstimates: 1,
      skippedEstimateLegacyIds: ["cloud_only_est_1"],
    });

    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.BACKED_UP_WITH_SKIPPED);
    expect(mockClearCloudBackupDirty).toHaveBeenCalledWith("safe_recovery_backup_success");
    expect(result.olderEstimatesKeptInCloud).toBe(true);
    expect(JSON.parse(storage.__store[STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS])).toEqual(expect.objectContaining({
      recoveryMode: "partial_cloud_recovery",
      status: "finished_with_older_estimates_kept",
      skippedEstimateCount: 1,
      skippedEstimateIds: ["cloud_only_est_1"],
      skippedReason: "missing_full_estimate_details",
      olderEstimatesKeptInCloud: true,
    }));
  });

  test("passes the known skipped estimate ids into the backup verification step", async () => {
    mockScanLocalDataIntegrity.mockReturnValue({
      blockers: [],
      safeRepairs: [],
    });
    mockRunSupabaseCloudOnboardingBackup.mockResolvedValue({
      status: "backup_completed",
    });

    await runRecoveryContinuation({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
      storage: buildWritableStorage(),
      skippedEstimates: 2,
      skippedEstimateLegacyIds: ["est_7", "est_8"],
    });

    expect(mockRunSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({
      preservedSkippedEstimateLegacyIds: ["est_7", "est_8"],
    }));
  });

  test("keeps the concrete blocker when backup returns needs_attention after recovery", async () => {
    mockScanLocalDataIntegrity.mockReturnValue({
      blockers: [],
      safeRepairs: [],
    });
    mockRunSupabaseCloudOnboardingBackup.mockResolvedValue({
      status: "needs_attention",
      preview: {
        integrity: {
          backupReadiness: {
            firstBlocker: {
              code: "estimate_project_missing",
              message: "One or more estimates reference a project id that is not present locally.",
            },
          },
        },
      },
    });

    const result = await runRecoveryContinuation({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
      storage: { __snapshot: {} },
      skippedEstimates: 0,
    });

    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.PAUSED);
    expect(result.pausedReason).toBe("Some recovered estimates are not linked to a job.");
    expect(result.pausedReasonCode).toBe("estimate_project_missing");
    expect(result.technicalDetail).toBe(
      "One or more estimates reference a project id that is not present locally."
    );
  });
});
