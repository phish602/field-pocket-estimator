const mockExportSupabaseCloudBackupArtifact = jest.fn();
const mockBuildLocalSnapshotFromStorage = jest.fn();
const mockScanLocalDataIntegrity = jest.fn();
const mockRepairStoredLocalDataIntegrity = jest.fn();
const mockRunSupabaseCloudOnboardingBackup = jest.fn();
const mockClearCloudBackupDirty = jest.fn();
const mockRunSupabaseCloudVerification = jest.fn();
const mockEnsureCurrentDeviceCanWriteCloud = jest.fn();
const mockEnsureDeviceFenceStillCurrent = jest.fn();
const mockAppendCloudMutationsDurably = jest.fn();

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

jest.mock("./cloudMutationLedger", () => ({
  __esModule: true,
  ...jest.requireActual("./cloudMutationLedger"),
  appendCloudMutationsDurably: (...args) => mockAppendCloudMutationsDurably(...args),
}));

jest.mock("./supabaseCloudVerification", () => ({
  __esModule: true,
  runSupabaseCloudVerification: (...args) => mockRunSupabaseCloudVerification(...args),
}));

// Both recovery-owned queue clears now prove their own generation. Only the two
// ownership reads are stubbed; the rest of the device-lock authority is real.
jest.mock("./supabaseDeviceLock", () => ({
  __esModule: true,
  ...jest.requireActual("./supabaseDeviceLock"),
  ensureCurrentDeviceCanWriteCloud: (...args) => mockEnsureCurrentDeviceCanWriteCloud(...args),
  ensureDeviceFenceStillCurrent: (...args) => mockEnsureDeviceFenceStillCurrent(...args),
}));

const RECOVERY_FENCE_A5 = { companyId: "company_1", deviceId: "device-a", lockVersion: 5 };
function recoveryAccessOk(fence = RECOVERY_FENCE_A5) {
  return { ok: true, access: { isActive: true, isLocked: false, fence }, error: "" };
}

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
  mockRunSupabaseCloudVerification.mockReset();
  mockAppendCloudMutationsDurably.mockReset();
  mockAppendCloudMutationsDurably.mockResolvedValue({ ok: true, appended: [] });
  // A device that reaches recovery continuation is, in production, an
  // authorized active device holding a lease generation.
  mockEnsureCurrentDeviceCanWriteCloud.mockReset();
  mockEnsureCurrentDeviceCanWriteCloud.mockResolvedValue(recoveryAccessOk());
  mockEnsureDeviceFenceStillCurrent.mockReset();
  mockEnsureDeviceFenceStillCurrent.mockResolvedValue({ ok: true, code: "", deviceLockLost: false });
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

  test("repairs once and queues only the exact repaired cloud target", async () => {
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
    mockBuildLocalSnapshotFromStorage.mockReturnValue({ snapshot: { estimates: [{ id: "est_1", projectId: "" }], invoices: [] } });

    const result = await runRecoveryContinuation({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
      storage: { __snapshot: {} },
      skippedEstimates: 0,
      onPhase: (phase) => phases.push(phase),
    });

    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.PAUSED);
    expect(result.pausedReasonCode).toBe("recovery_targeted_sync_pending");
    expect(result.backupRan).toBe(false);
    expect(result.repairChanged).toBe(true);
    expect(mockAppendCloudMutationsDurably).toHaveBeenCalledWith([
      expect.objectContaining({ companyId: "company_1", entityType: "estimate", documentId: "est_1", operation: "upsert" }),
    ], expect.objectContaining({ storage: expect.anything() }));
    expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
    expect(mockRunSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    expect(phases).toEqual(["checking", "repairing"]);
  });

  test("writes partial recovery status before attempting backup for preserved skipped estimates", async () => {
    mockScanLocalDataIntegrity.mockReturnValue({
      blockers: [],
      safeRepairs: [],
    });
    const storage = buildWritableStorage();
    mockRunSupabaseCloudVerification.mockResolvedValue({ ok: true, allMatched: true, notices: [], availableRepairs: [] });

    const result = await runRecoveryContinuation({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
      storage,
      skippedEstimates: 3,
      skippedEstimateLegacyIds: ["est_2", "est_3", "est_4"],
    });

    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.BACKED_UP_WITH_SKIPPED);
    expect(mockRunSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
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
    mockRunSupabaseCloudVerification.mockResolvedValue({ ok: true, allMatched: true, notices: [], availableRepairs: [] });

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
    expect(mockClearCloudBackupDirty).toHaveBeenCalledWith("safe_recovery_verified_with_preserved_estimates");
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
    mockRunSupabaseCloudVerification.mockResolvedValue({ ok: true, allMatched: true, notices: [], availableRepairs: [] });

    await runRecoveryContinuation({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
      storage: buildWritableStorage(),
      skippedEstimates: 2,
      skippedEstimateLegacyIds: ["est_7", "est_8"],
    });

    expect(mockRunSupabaseCloudVerification).toHaveBeenCalledWith(expect.objectContaining({
      preservedSkippedEstimateLegacyIds: ["est_7", "est_8"],
    }));
    expect(mockRunSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  });

  test("keeps the concrete blocker when backup returns needs_attention after recovery", async () => {
    mockScanLocalDataIntegrity
      .mockReturnValueOnce({ blockers: [], safeRepairs: [] })
      .mockReturnValueOnce({ blockers: [{ code: "estimate_project_missing", message: "One or more estimates reference a project id that is not present locally." }], safeRepairs: [] });
    mockRunSupabaseCloudVerification.mockResolvedValue({ ok: true, allMatched: false, notices: [{ level: "warning" }], availableRepairs: [] });

    const result = await runRecoveryContinuation({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      role: "owner",
      storage: buildWritableStorage(),
      skippedEstimates: 1,
      skippedEstimateLegacyIds: ["cloud_only_est_1"],
    });

    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.PAUSED);
    expect(result.pausedReason).toBe("Some recovered estimates are not linked to a job.");
    expect(result.pausedReasonCode).toBe("estimate_project_missing");
    expect(result.technicalDetail).toBe(
      "One or more estimates reference a project id that is not present locally."
    );
  });
});

// START-FENCE: these two queue clears are owned by RECOVERY, not by onboarding.
// Onboarding's internal completion fence only runs on its fully-matched path,
// so a device that began the sequence under A/v5, lost the workspace to B/v6 and
// took it back as A/v7 could otherwise clear a generation it no longer owns.
describe("recovery continuation START fence", () => {
  const fenceA5 = { companyId: "company_1", deviceId: "device-a", lockVersion: 5 };
  const fenceA7 = { companyId: "company_1", deviceId: "device-a", lockVersion: 7 };
  const staleFence = (currentFence) => ({
    ok: false,
    code: "device_lock_lost",
    deviceLockLost: true,
    fence: fenceA5,
    currentFence,
    userMessage: "Backup stopped because EstiPaid was switched to another device.",
    error: "Backup stopped because EstiPaid was switched to another device.",
  });

  const continuationArgs = (overrides = {}) => ({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1" },
    role: "owner",
    storage: { __snapshot: {} },
    skippedEstimates: 0,
    ...overrides,
  });

  function skippedOnlyBackup() {
    mockRunSupabaseCloudVerification.mockResolvedValue({ ok: true, allMatched: true, notices: [], availableRepairs: [] });
  }

  beforeEach(() => {
    mockScanLocalDataIntegrity.mockReturnValue({ blockers: [], safeRepairs: [] });
    mockRunSupabaseCloudVerification.mockReset();
  });

  test("complete recovery at a stable generation clears the queue", async () => {
    // Positive control for the verified branch.
    mockRunSupabaseCloudVerification.mockResolvedValue({ ok: true, allMatched: true, notices: [], availableRepairs: [] });

    const result = await runRecoveryContinuation(continuationArgs());

    expect(mockRunSupabaseCloudVerification).toHaveBeenCalledTimes(1);
    expect(mockEnsureDeviceFenceStillCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ fence: fenceA5 })
    );
    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.VERIFIED);
    expect(mockClearCloudBackupDirty).toHaveBeenCalledWith("safe_cloud_recovery_verified");
  });

  test("complete recovery A(v5) -> B(v6) -> A(v7) pauses and never clears the queue", async () => {
    mockRunSupabaseCloudVerification.mockResolvedValue({ ok: true, allMatched: true, notices: [], availableRepairs: [] });
    mockEnsureDeviceFenceStillCurrent.mockResolvedValue(staleFence(fenceA7));

    const result = await runRecoveryContinuation(continuationArgs());

    // It genuinely reached the boundary: verification ran and matched.
    expect(mockRunSupabaseCloudVerification).toHaveBeenCalledTimes(1);
    expect(mockEnsureDeviceFenceStillCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ fence: fenceA5 })
    );
    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.PAUSED);
    // FORBIDDEN: acknowledging a queue generation this sequence no longer owns.
    expect(mockClearCloudBackupDirty).not.toHaveBeenCalledWith("safe_cloud_recovery_verified");
  });

  test("skipped-estimate continuation at a stable generation clears the queue", async () => {
    // Positive control for the exceptional acknowledgment branch.
    skippedOnlyBackup();

    const result = await runRecoveryContinuation(continuationArgs({
      skippedEstimates: 1,
      skippedEstimateLegacyIds: ["cloud_only_est_1"],
    }));

    expect(mockRunSupabaseCloudVerification).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.BACKED_UP_WITH_SKIPPED);
    expect(mockClearCloudBackupDirty).toHaveBeenCalledWith("safe_recovery_verified_with_preserved_estimates");
  });

  test("skipped-estimate continuation A(v5) -> B(v6) -> A(v7) pauses and never clears the queue", async () => {
    skippedOnlyBackup();
    mockEnsureDeviceFenceStillCurrent.mockResolvedValue(staleFence(fenceA7));

    const result = await runRecoveryContinuation(continuationArgs({
      skippedEstimates: 1,
      skippedEstimateLegacyIds: ["cloud_only_est_1"],
    }));

    // The skipped-only condition was genuinely reached without invoking the
    // broad onboarding writer.
    expect(mockRunSupabaseCloudVerification).toHaveBeenCalledTimes(1);
    expect(mockEnsureDeviceFenceStillCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ fence: fenceA5 })
    );
    expect(result.status).toBe(RECOVERY_CONTINUATION_STATUS.PAUSED);
    // FORBIDDEN: the exceptional direct acknowledgment under a stale generation.
    expect(mockClearCloudBackupDirty).not.toHaveBeenCalledWith("safe_recovery_verified_with_preserved_estimates");
  });
});
