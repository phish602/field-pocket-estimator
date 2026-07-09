const mockCreateSupabaseMigrationPreview = jest.fn();
const mockIsSupabaseMigrationPreviewReady = jest.fn();
const mockRunSupabaseMigrationWrite = jest.fn();
const mockRunSupabaseCloudVerification = jest.fn();
const mockCheckEstimateRestorePayloadProtection = jest.fn();
const mockUpdateEstimateRestorePayloads = jest.fn();
const mockRepairStoredLocalDataIntegrity = jest.fn();
const mockBuildLocalSnapshotFromStorage = jest.fn();
const mockGetSupabaseClient = jest.fn();
const mockEnsureCurrentDeviceCanWriteCloud = jest.fn();

jest.mock("./supabaseMigrationPreview", () => ({
  __esModule: true,
  createSupabaseMigrationPreview: (...args) => mockCreateSupabaseMigrationPreview(...args),
}));

jest.mock("./supabaseMigrationWriter", () => ({
  __esModule: true,
  isSupabaseMigrationPreviewReady: (...args) => mockIsSupabaseMigrationPreviewReady(...args),
  runSupabaseMigrationWrite: (...args) => mockRunSupabaseMigrationWrite(...args),
}));

jest.mock("./supabaseCloudVerification", () => ({
  __esModule: true,
  runSupabaseCloudVerification: (...args) => mockRunSupabaseCloudVerification(...args),
}));

jest.mock("./supabaseClient", () => ({
  __esModule: true,
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

jest.mock("./supabaseDeviceLock", () => ({
  __esModule: true,
  ensureCurrentDeviceCanWriteCloud: (...args) => mockEnsureCurrentDeviceCanWriteCloud(...args),
}));

jest.mock("./supabaseEstimateRestorePayload", () => ({
  __esModule: true,
  checkEstimateRestorePayloadProtection: (...args) => mockCheckEstimateRestorePayloadProtection(...args),
  updateEstimateRestorePayloads: (...args) => mockUpdateEstimateRestorePayloads(...args),
  ESTIMATE_PAYLOAD_PROTECTION_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    CHECKED: "checked",
    ERROR: "error",
  },
  ESTIMATE_PAYLOAD_UPDATE_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    NO_LOCAL_ESTIMATES: "no_local_estimates",
    COMPLETED: "completed",
    ERROR: "error",
  },
}));

jest.mock("./localDataIntegrity", () => {
  const actual = jest.requireActual("./localDataIntegrity");
  return {
    __esModule: true,
    ...actual,
    repairStoredLocalDataIntegrity: (...args) => mockRepairStoredLocalDataIntegrity(...args),
    buildLocalSnapshotFromStorage: (...args) => mockBuildLocalSnapshotFromStorage(...args),
  };
});

const {
  checkSupabaseCloudOnboardingStatus,
  runSupabaseCloudOnboardingBackup,
  CLOUD_ONBOARDING_STATUS,
  PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS,
  removePreservedOlderCloudEstimates,
} = require("./supabaseCloudOnboarding");
const { markCloudBackupDirty, readCloudBackupQueueState } = require("./cloudBackupQueue");
const { STORAGE_KEYS } = require("../constants/storageKeys");

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
      customers: 1,
      projects: 1,
      estimates: 1,
      estimateLineItems: 1,
      invoices: 1,
      invoiceLineItems: 1,
      invoicePayments: 1,
    },
    notices: [],
    noWritesPerformed: true,
    ...overrides,
  };
}

function buildVerification(overrides = {}) {
  return {
    ok: true,
    allMatched: true,
    company: { id: "company_1", name: "Field Pocket LLC" },
    tableResults: [],
    notices: [],
    noWritesPerformed: true,
    ...overrides,
  };
}

function buildWriteResult(overrides = {}) {
  return {
    ok: true,
    blocked: false,
    tableResults: [],
    notices: [],
    noLocalDeletes: true,
    ...overrides,
  };
}

function buildPayloadProtection(overrides = {}) {
  return {
    status: "checked",
    repairableMissingLegacyIds: [],
    oldDeviceRequiredLegacyIds: [],
    preservedOlderEstimateLegacyIds: [],
    noWritesPerformed: true,
    ...overrides,
  };
}

function buildPayloadRepairResult(overrides = {}) {
  return {
    status: "completed",
    estimatesChecked: 1,
    estimatesUpdated: 1,
    missingCloudRows: [],
    skipped: [],
    failed: [],
    noLocalDataChanged: true,
    ...overrides,
  };
}

function buildIntegrity(overrides = {}) {
  return {
    blockers: [],
    warnings: [],
    safeRepairs: [],
    summary: {
      blockersCount: 0,
      warningsCount: 0,
      repairsAvailableCount: 0,
    },
    backupReadiness: {
      blocked: false,
      safe: true,
      canProceedAfterSafeRepair: false,
      firstBlocker: null,
    },
    ...overrides,
  };
}

const baseContext = {
  storageSnapshot: { getItem: () => null },
  configured: true,
  user: { id: "user_1" },
  company: { id: "company_1", name: "Field Pocket LLC" },
  role: "owner",
};

function buildPartialRecoveryStorage(skippedEstimateIds = ["est_2", "est_3"]) {
  const recoveryStatus = JSON.stringify({
    recoveryMode: "partial_cloud_recovery",
    status: "finished_with_older_estimates_kept",
    skippedEstimateCount: skippedEstimateIds.length,
    skippedEstimateIds,
    skippedReason: "missing_full_estimate_details",
    recoveredAt: "2026-07-06T01:00:00.000Z",
    olderEstimatesKeptInCloud: true,
  });
  return {
    getItem: jest.fn((key) => (key === STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS ? recoveryStatus : null)),
  };
}

function buildMutablePartialRecoveryStorage({
  skippedEstimateIds = ["est_2", "est_3", "est_4"],
  estimates = [],
  invoices = [],
} = {}) {
  const values = new Map();
  values.set(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS, JSON.stringify({
    recoveryMode: "partial_cloud_recovery",
    status: "finished_with_older_estimates_kept",
    skippedEstimateCount: skippedEstimateIds.length,
    skippedEstimateIds,
    skippedReason: "missing_full_estimate_details",
    recoveredAt: "2026-07-06T01:00:00.000Z",
    olderEstimatesKeptInCloud: true,
  }));
  values.set(STORAGE_KEYS.ESTIMATES, JSON.stringify(estimates));
  values.set(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));

  return {
    getItem: jest.fn((key) => (values.has(key) ? values.get(key) : null)),
    setItem: jest.fn((key, value) => values.set(key, value)),
    removeItem: jest.fn((key) => values.delete(key)),
  };
}

function createCleanupClient(rowsByTable = {}, errorsByTable = {}) {
  const calls = [];
  const from = jest.fn((table) => {
    const chain = {
      _mode: "select",
      _columns: "*",
      _eqColumn: "",
      _eqValue: "",
      select: jest.fn((columns) => {
        chain._mode = "select";
        chain._columns = columns;
        return chain;
      }),
      delete: jest.fn(() => {
        chain._mode = "delete";
        return chain;
      }),
      eq: jest.fn((column, value) => {
        chain._eqColumn = column;
        chain._eqValue = value;
        return chain;
      }),
      in: jest.fn(async (column, values) => {
        calls.push({
          table,
          mode: chain._mode,
          columns: chain._columns,
          eqColumn: chain._eqColumn,
          eqValue: chain._eqValue,
          inColumn: column,
          inValues: values,
        });
        const tableError = errorsByTable[table];
        if (tableError) return { data: null, error: tableError };
        if (chain._mode === "delete") return { error: null };
        return { data: rowsByTable[table] || [], error: null };
      }),
    };
    return chain;
  });

  return { from, calls };
}

describe("supabaseCloudOnboarding", () => {
  beforeEach(() => {
    mockCreateSupabaseMigrationPreview.mockReset();
    mockIsSupabaseMigrationPreviewReady.mockReset();
    mockRunSupabaseMigrationWrite.mockReset();
    mockRunSupabaseCloudVerification.mockReset();
    mockCheckEstimateRestorePayloadProtection.mockReset();
    mockUpdateEstimateRestorePayloads.mockReset();
    mockRepairStoredLocalDataIntegrity.mockReset();
    mockBuildLocalSnapshotFromStorage.mockReset();
    mockGetSupabaseClient.mockReset();
    mockEnsureCurrentDeviceCanWriteCloud.mockReset();
    mockCheckEstimateRestorePayloadProtection.mockResolvedValue(buildPayloadProtection());
    mockUpdateEstimateRestorePayloads.mockResolvedValue(buildPayloadRepairResult());
    mockRepairStoredLocalDataIntegrity.mockReturnValue({
      changed: false,
      repairs: {},
      integrity: buildIntegrity(),
    });
    mockBuildLocalSnapshotFromStorage.mockReturnValue({
      artifact: null,
      snapshot: {
        customers: [],
        projects: [],
        estimates: [],
        invoices: [],
      },
    });
    mockGetSupabaseClient.mockReturnValue(null);
    mockEnsureCurrentDeviceCanWriteCloud.mockResolvedValue({ ok: true, access: { isActive: true, isLocked: false }, error: "" });
  });

  describe("checkSupabaseCloudOnboardingStatus", () => {
    test("returns signed_out and performs no calls when not configured or no user", async () => {
      const result = await checkSupabaseCloudOnboardingStatus({
        ...baseContext,
        configured: false,
        user: null,
      });

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.SIGNED_OUT);
      expect(result.noWritesPerformed).toBe(true);
      expect(mockCreateSupabaseMigrationPreview).not.toHaveBeenCalled();
      expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
    });

    test("returns no_workspace when there is no company and performs no writes", async () => {
      const result = await checkSupabaseCloudOnboardingStatus({
        ...baseContext,
        company: null,
      });

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.NO_WORKSPACE);
      expect(mockCreateSupabaseMigrationPreview).not.toHaveBeenCalled();
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
    });

    test("returns no_local_data when local and cloud core counts are both zero", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview({
        localCounts: { customers: 0, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 },
        cloudCounts: { customers: 0, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 },
      }));

      const result = await checkSupabaseCloudOnboardingStatus(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.NO_LOCAL_DATA);
      expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
    });

    test("returns cloud_available_empty_device when this device has no local core data but the cloud workspace does, and never calls migration write", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview({
        localCounts: { customers: 0, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 },
        cloudCounts: { customers: 7, projects: 9, estimates: 8, invoices: 10, invoicePayments: 3 },
      }));

      const result = await checkSupabaseCloudOnboardingStatus(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE);
      expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
      expect(result.noWritesPerformed).toBe(true);
    });

    test("returns already_backed_up when verification confirms a full match, without calling migration write", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: true }));

      const result = await checkSupabaseCloudOnboardingStatus(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP);
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
      expect(result.noWritesPerformed).toBe(true);
    });

    test("returns ready_to_backup when local data exists and the cloud workspace is empty", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview({
        cloudCounts: { customers: 0, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 },
      }));

      const result = await checkSupabaseCloudOnboardingStatus(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP);
      expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
    });

    test("returns local_cloud_mismatch when both sides have data but verification does not confirm a match, and never calls migration write", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: false }));

      const result = await checkSupabaseCloudOnboardingStatus(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH);
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
      expect(result.noWritesPerformed).toBe(true);
    });

    test("auto-runs one safe metadata repair and then backs up before reporting status", async () => {
      mockCreateSupabaseMigrationPreview
        .mockResolvedValueOnce(buildPreview({
          integrity: buildIntegrity({
            safeRepairs: [{ code: "estimate_project_stale", details: { count: 2, entityIds: ["est_1", "est_2"] } }],
            backupReadiness: {
              blocked: false,
              safe: false,
              canProceedAfterSafeRepair: true,
              firstBlocker: null,
            },
          }),
        }))
        .mockResolvedValueOnce(buildPreview({
          integrity: buildIntegrity(),
        }));
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRepairStoredLocalDataIntegrity.mockReturnValue({
        changed: true,
        repairs: { staleEstimateProjectIds: [{ estimateId: "est_1", staleProjectId: "proj_missing" }] },
        integrity: buildIntegrity(),
      });
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: true }));

      const result = await checkSupabaseCloudOnboardingStatus(baseContext);

      expect(mockRepairStoredLocalDataIntegrity).toHaveBeenCalledWith(baseContext.storageSnapshot);
      expect(mockRunSupabaseMigrationWrite).toHaveBeenCalledTimes(1);
      expect(mockRunSupabaseCloudVerification).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED);
      expect(result.automaticSafeRepair).toEqual(expect.objectContaining({
        attempted: true,
        succeeded: true,
        failed: false,
        repairChanged: true,
      }));
    });

    test("safe metadata repair failure reports contractor-safe needs_attention without writing cloud data", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview({
        integrity: buildIntegrity({
          safeRepairs: [{ code: "estimate_project_stale", message: "Safe repair can detach a stale project link on 2 estimates." }],
          backupReadiness: {
            blocked: false,
            safe: false,
            canProceedAfterSafeRepair: true,
            firstBlocker: null,
          },
        }),
      }));
      mockRepairStoredLocalDataIntegrity.mockReturnValue({
        changed: false,
        repairs: {},
        integrity: buildIntegrity({
          safeRepairs: [{ code: "estimate_project_stale", message: "Safe repair can detach a stale project link on 2 estimates." }],
          backupReadiness: {
            blocked: false,
            safe: false,
            canProceedAfterSafeRepair: true,
            firstBlocker: null,
          },
        }),
      });

      const result = await checkSupabaseCloudOnboardingStatus(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION);
      expect(result.error).toBe("We could not finish protecting this device automatically.");
      expect(result.automaticSafeRepair).toEqual(expect.objectContaining({
        attempted: true,
        failed: true,
      }));
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
      expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
    });

    test("falls back to verification when the cloud count check itself is unavailable", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview({
        cloudCountCheckAvailable: false,
        cloudCounts: null,
      }));
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: true }));

      const result = await checkSupabaseCloudOnboardingStatus(baseContext);

      expect(mockRunSupabaseCloudVerification).toHaveBeenCalled();
      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP);
    });

    test("never writes to localStorage while checking status", async () => {
      const setItemSpy = jest.fn();
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: false }));

      await checkSupabaseCloudOnboardingStatus({
        ...baseContext,
        storageSnapshot: { getItem: () => null, setItem: setItemSpy },
      });

      expect(setItemSpy).not.toHaveBeenCalled();
    });
  });

  describe("runSupabaseCloudOnboardingBackup", () => {
    test("blocks at signed_out without calling preview, write, or verification", async () => {
      const result = await runSupabaseCloudOnboardingBackup({ ...baseContext, user: null });

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.SIGNED_OUT);
      expect(mockCreateSupabaseMigrationPreview).not.toHaveBeenCalled();
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
      expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
      expect(result.noLocalDeletes).toBe(true);
    });

    test("rejects when a fresh device-lock check says this device is locked", async () => {
      mockEnsureCurrentDeviceCanWriteCloud.mockResolvedValue({
        ok: false,
        access: { isLocked: true, isActive: false },
        error: "This device is locked because EstiPaid is active on another device.",
      });

      const result = await runSupabaseCloudOnboardingBackup(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION);
      expect(result.error).toMatch(/locked/i);
      expect(mockCreateSupabaseMigrationPreview).not.toHaveBeenCalled();
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
      expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
    });

    test("runs preview, then migration write, then verification, in that order", async () => {
      const callOrder = [];
      mockCreateSupabaseMigrationPreview.mockImplementation(async () => {
        callOrder.push("preview");
        return buildPreview();
      });
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockImplementation(async () => {
        callOrder.push("write");
        return buildWriteResult();
      });
      mockRunSupabaseCloudVerification.mockImplementation(async () => {
        callOrder.push("verify");
        return buildVerification();
      });

      await runSupabaseCloudOnboardingBackup(baseContext);

      expect(callOrder).toEqual(["preview", "write", "verify"]);
      expect(mockRunSupabaseMigrationWrite).toHaveBeenCalledWith(expect.objectContaining({
        storageSnapshot: baseContext.storageSnapshot,
        configured: true,
        company: baseContext.company,
        role: "owner",
        preview: expect.any(Object),
      }));
    });

    test("passes preserved skipped estimate ids through to verification when provided", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification());

      await runSupabaseCloudOnboardingBackup({
        ...baseContext,
        preservedSkippedEstimateLegacyIds: ["est_2", "est_3"],
      });

      expect(mockRunSupabaseCloudVerification).toHaveBeenCalledWith(expect.objectContaining({
        preservedSkippedEstimateLegacyIds: ["est_2", "est_3"],
      }));
    });

    test("reads preserved skipped estimate ids from stored partial recovery status when callers omit them", async () => {
      const storageSnapshot = buildPartialRecoveryStorage(["est_2", "est_3", "est_4"]);
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification());

      await runSupabaseCloudOnboardingBackup({
        ...baseContext,
        storageSnapshot,
      });

      expect(storageSnapshot.getItem).toHaveBeenCalledWith(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS);
    });

    test("passes preserved skipped estimate ids through to the writer when provided", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification());

      await runSupabaseCloudOnboardingBackup({
        ...baseContext,
        preservedSkippedEstimateLegacyIds: ["est_2", "est_3"],
      });

      expect(mockRunSupabaseMigrationWrite).toHaveBeenCalledWith(expect.objectContaining({
        preservedSkippedEstimateLegacyIds: ["est_2", "est_3"],
      }));
    });

    test("passes fallback preserved skipped estimate ids from stored recovery status into the writer", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification());

      await runSupabaseCloudOnboardingBackup({
        ...baseContext,
        storageSnapshot: buildPartialRecoveryStorage(["est_7", "est_8"]),
      });

      expect(mockRunSupabaseMigrationWrite).toHaveBeenCalledWith(expect.objectContaining({
        preservedSkippedEstimateLegacyIds: ["est_7", "est_8"],
      }));
    });

    test("passes fallback preserved skipped estimate ids from stored recovery status into verification", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification());

      await runSupabaseCloudOnboardingBackup({
        ...baseContext,
        storageSnapshot: buildPartialRecoveryStorage(["est_9", "est_10"]),
      });

      expect(mockRunSupabaseCloudVerification).toHaveBeenCalledWith(expect.objectContaining({
        preservedSkippedEstimateLegacyIds: ["est_10", "est_9"],
      }));
    });

    test("repairs matching local estimates when cloud backup protection is missing before backup verifies", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockCheckEstimateRestorePayloadProtection
        .mockResolvedValueOnce(buildPayloadProtection({ repairableMissingLegacyIds: ["est_1"] }))
        .mockResolvedValueOnce(buildPayloadProtection());
      mockUpdateEstimateRestorePayloads.mockResolvedValue(buildPayloadRepairResult({
        estimatesChecked: 1,
        estimatesUpdated: 1,
      }));
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: true }));

      const result = await runSupabaseCloudOnboardingBackup(baseContext);

      expect(mockUpdateEstimateRestorePayloads).toHaveBeenCalledWith(expect.objectContaining({
        storageSnapshot: baseContext.storageSnapshot,
        configured: true,
        company: baseContext.company,
      }));
      expect(mockRunSupabaseMigrationWrite).toHaveBeenCalled();
      expect(mockRunSupabaseCloudVerification).toHaveBeenCalled();
      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED);
    });

    test("rechecks backup protection after repair before final verification", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockCheckEstimateRestorePayloadProtection
        .mockResolvedValueOnce(buildPayloadProtection({ repairableMissingLegacyIds: ["est_1"] }))
        .mockResolvedValueOnce(buildPayloadProtection({ repairableMissingLegacyIds: [] }));
      mockUpdateEstimateRestorePayloads.mockResolvedValue(buildPayloadRepairResult());
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: true }));

      await runSupabaseCloudOnboardingBackup(baseContext);

      expect(mockCheckEstimateRestorePayloadProtection).toHaveBeenCalledTimes(2);
      expect(mockRunSupabaseCloudVerification).toHaveBeenCalledTimes(1);
    });

    test("reports backup_completed with no local deletion when write and verification both succeed", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: true }));

      const result = await runSupabaseCloudOnboardingBackup(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED);
      expect(result.noLocalDeletes).toBe(true);
      expect(result.writeResult.ok).toBe(true);
      expect(result.verification.allMatched).toBe(true);
    });

    test("a confirmed successful backup clears the local cloud backup dirty queue", async () => {
      localStorage.clear();
      markCloudBackupDirty({ reason: "pre_backup_stale_marker", domains: ["invoices"], severity: "money_critical" });
      expect(readCloudBackupQueueState().pending).toBe(true);

      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: true }));

      const result = await runSupabaseCloudOnboardingBackup(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED);
      const queueState = readCloudBackupQueueState();
      expect(queueState.pending).toBe(false);
      expect(queueState.status).toBe("current");
    });

    test("does not clear the backup dirty queue when verification does not confirm a match", async () => {
      localStorage.clear();
      markCloudBackupDirty({ reason: "pre_backup_stale_marker", domains: ["invoices"], severity: "money_critical" });

      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: false }));

      const result = await runSupabaseCloudOnboardingBackup(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION);
      expect(readCloudBackupQueueState().pending).toBe(true);
    });

    test("reports needs_attention, not success, when the migration writer blocks", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult({
        ok: false,
        blocked: true,
        reason: "Migration write blocked by local validation issues.",
        notices: [{ level: "error", code: "duplicate_invoice_line_item_local_id", message: "Duplicate invoice line-item local id detected." }],
      }));

      const result = await runSupabaseCloudOnboardingBackup(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION);
      expect(result.writeResult.ok).toBe(false);
      expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
    });

    test("reports needs_attention when preview itself is not safe to write", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(false);

      const result = await runSupabaseCloudOnboardingBackup(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION);
      expect(mockRunSupabaseMigrationWrite).not.toHaveBeenCalled();
      expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
    });

    test("reports needs_attention when verification finds a mismatch after a successful write", async () => {
      mockCreateSupabaseMigrationPreview.mockResolvedValue(buildPreview());
      mockIsSupabaseMigrationPreviewReady.mockReturnValue(true);
      mockRunSupabaseMigrationWrite.mockResolvedValue(buildWriteResult());
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: false }));

      const result = await runSupabaseCloudOnboardingBackup(baseContext);

      expect(result.status).toBe(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION);
      expect(result.writeResult.ok).toBe(true);
      expect(result.verification.allMatched).toBe(false);
    });
  });

  describe("removePreservedOlderCloudEstimates", () => {
    test("refuses cleanup when stored preserved estimate ids are not exactly 3", async () => {
      const storageSnapshot = buildMutablePartialRecoveryStorage({
        skippedEstimateIds: ["est_2", "est_3"],
      });

      const result = await removePreservedOlderCloudEstimates({
        ...baseContext,
        storageSnapshot,
      });

      expect(result.status).toBe(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.REFUSED);
      expect(result.preservedEstimateLegacyIds).toEqual(["est_2", "est_3"]);
      expect(mockGetSupabaseClient).not.toHaveBeenCalled();
    });

    test("refuses cleanup when any preserved estimate is already present locally", async () => {
      const storageSnapshot = buildMutablePartialRecoveryStorage();
      mockBuildLocalSnapshotFromStorage.mockReturnValue({
        artifact: null,
        snapshot: {
          customers: [],
          projects: [],
          estimates: [{ id: "est_3" }],
          invoices: [],
        },
      });
      mockGetSupabaseClient.mockReturnValue(createCleanupClient());

      const result = await removePreservedOlderCloudEstimates({
        ...baseContext,
        storageSnapshot,
      });

      expect(result.status).toBe(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.REFUSED);
      expect(result.localEstimateLegacyIds).toEqual(["est_3"]);
    });

    test("refuses cleanup when a cloud invoice still references one of the preserved estimates", async () => {
      const storageSnapshot = buildMutablePartialRecoveryStorage();
      const client = createCleanupClient({
        estimates: [
          { id: "db_est_2", legacy_local_id: "est_2" },
          { id: "db_est_3", legacy_local_id: "est_3" },
          { id: "db_est_4", legacy_local_id: "est_4" },
        ],
        invoices: [
          { id: "db_inv_1", legacy_local_id: "inv_1", source_estimate_legacy_local_id: "est_3" },
        ],
      });
      mockGetSupabaseClient.mockReturnValue(client);

      const result = await removePreservedOlderCloudEstimates({
        ...baseContext,
        storageSnapshot,
      });

      expect(result.status).toBe(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.REFUSED);
      expect(result.cloudInvoicesReferencingPreservedEstimates).toEqual([
        { id: "db_inv_1", legacyLocalId: "inv_1", sourceEstimateLegacyId: "est_3" },
      ]);
      expect(mockRunSupabaseCloudVerification).not.toHaveBeenCalled();
    });

    test("deletes only the preserved estimate line items and estimates, then clears partial recovery status after clean verification", async () => {
      const storageSnapshot = buildMutablePartialRecoveryStorage();
      const client = createCleanupClient({
        estimates: [
          { id: "db_est_2", legacy_local_id: "est_2" },
          { id: "db_est_3", legacy_local_id: "est_3" },
          { id: "db_est_4", legacy_local_id: "est_4" },
        ],
        invoices: [],
        estimate_line_items: [
          { id: "db_line_1", estimate_id: "db_est_2" },
          { id: "db_line_2", estimate_id: "db_est_3" },
          { id: "db_line_3", estimate_id: "db_est_4" },
        ],
      });
      mockGetSupabaseClient.mockReturnValue(client);
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: true }));

      const result = await removePreservedOlderCloudEstimates({
        ...baseContext,
        storageSnapshot,
      });

      expect(result.status).toBe(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.COMPLETED);
      expect(result.deletedEstimateCount).toBe(3);
      expect(result.deletedEstimateLineItemCount).toBe(3);
      expect(result.clearedPartialRecoveryStatus).toBe(true);
      expect(storageSnapshot.getItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS)).toBeNull();
      expect(client.calls).toEqual(expect.arrayContaining([
        expect.objectContaining({
          table: "estimate_line_items",
          mode: "delete",
          eqColumn: "company_id",
          eqValue: "company_1",
          inColumn: "estimate_id",
          inValues: ["db_est_2", "db_est_3", "db_est_4"],
        }),
        expect.objectContaining({
          table: "estimates",
          mode: "delete",
          eqColumn: "company_id",
          eqValue: "company_1",
          inColumn: "id",
          inValues: ["db_est_2", "db_est_3", "db_est_4"],
        }),
      ]));
      expect(mockRunSupabaseCloudVerification).toHaveBeenCalledWith(expect.objectContaining({
        storageSnapshot,
        configured: true,
        user: baseContext.user,
        company: baseContext.company,
        role: "owner",
      }));
    });

    test("keeps partial recovery status when post-delete verification does not pass", async () => {
      const storageSnapshot = buildMutablePartialRecoveryStorage();
      const client = createCleanupClient({
        estimates: [
          { id: "db_est_2", legacy_local_id: "est_2" },
          { id: "db_est_3", legacy_local_id: "est_3" },
          { id: "db_est_4", legacy_local_id: "est_4" },
        ],
        invoices: [],
        estimate_line_items: [],
      });
      mockGetSupabaseClient.mockReturnValue(client);
      mockRunSupabaseCloudVerification.mockResolvedValue(buildVerification({ allMatched: false }));

      const result = await removePreservedOlderCloudEstimates({
        ...baseContext,
        storageSnapshot,
      });

      expect(result.status).toBe(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR);
      expect(result.clearedPartialRecoveryStatus).toBe(false);
      expect(JSON.parse(storageSnapshot.getItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS))).toEqual(expect.objectContaining({
        skippedEstimateCount: 3,
        skippedEstimateIds: ["est_2", "est_3", "est_4"],
      }));
    });
  });
});
