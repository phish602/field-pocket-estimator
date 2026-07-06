const mockCreateSupabaseMigrationPreview = jest.fn();
const mockIsSupabaseMigrationPreviewReady = jest.fn();
const mockRunSupabaseMigrationWrite = jest.fn();
const mockRunSupabaseCloudVerification = jest.fn();

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

const {
  checkSupabaseCloudOnboardingStatus,
  runSupabaseCloudOnboardingBackup,
  CLOUD_ONBOARDING_STATUS,
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

describe("supabaseCloudOnboarding", () => {
  beforeEach(() => {
    mockCreateSupabaseMigrationPreview.mockReset();
    mockIsSupabaseMigrationPreviewReady.mockReset();
    mockRunSupabaseMigrationWrite.mockReset();
    mockRunSupabaseCloudVerification.mockReset();
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
        preservedSkippedEstimateLegacyIds: ["est_9", "est_10"],
      }));
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
});
