import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import CloudHomeRestorePrompt from "./CloudHomeRestorePrompt";
import { markCloudBackupDirty, markCloudBackupReviewRequired } from "../lib/cloudBackupQueue";
import { commitStoredCustomerCollectionMutation } from "../lib/businessCloudMutationOwners";
import { readCloudMutationLedger } from "../lib/cloudMutationLedger";
import { runtimeCommitAtomicRecords } from "../lib/vaultRuntimeStore";
import { STORAGE_KEYS } from "../constants/storageKeys";
import useCloudAutoConvergence from "../lib/useCloudAutoConvergence";

jest.mock("../lib/supabaseCloudConvergence", () => {
  const actual = jest.requireActual("../lib/supabaseCloudConvergence");
  return {
    ...actual,
    runSupabaseCloudConvergence: jest.fn(),
    recoverInterruptedCloudConvergence: jest.fn(),
  };
});

jest.mock("../lib/vaultRuntimeStore", () => ({
  ...jest.requireActual("../lib/vaultRuntimeStore"),
  runtimeCommitAtomicRecords: jest.fn(),
}));

jest.mock("../lib/useSupabaseAuth", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../lib/useSupabaseAccount", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../lib/supabaseCloudOnboarding", () => ({
  __esModule: true,
  checkSupabaseCloudOnboardingStatus: jest.fn(),
  runSupabaseCloudOnboardingBackup: jest.fn(),
  removePreservedOlderCloudEstimates: jest.fn(),
  CLOUD_ONBOARDING_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    NO_LOCAL_DATA: "no_local_data",
    CLOUD_AVAILABLE_EMPTY_DEVICE: "cloud_available_empty_device",
    READY_TO_BACKUP: "ready_to_backup",
    ALREADY_BACKED_UP: "already_backed_up",
    LOCAL_CLOUD_MISMATCH: "local_cloud_mismatch",
    BACKUP_COMPLETED: "backup_completed",
    NEEDS_ATTENTION: "needs_attention",
    ERROR: "error",
  },
  PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    NOTHING_TO_CLEAN: "nothing_to_clean",
    REFUSED: "refused",
    COMPLETED: "completed",
    ERROR: "error",
  },
}));

jest.mock("../lib/supabaseCloudRestore", () => ({
  __esModule: true,
  executeSupabaseCloudRestore: jest.fn(),
  previewSupabaseCloudRestore: jest.fn(),
  exportSupabaseCloudBackupArtifact: jest.fn(),
  CLOUD_RESTORE_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    LOCAL_NOT_EMPTY: "local_not_empty",
    NO_CLOUD_DATA: "no_cloud_data",
    ELIGIBLE: "eligible",
    RESTORED: "restored",
    RECOVERED_UNVERIFIED: "recovered_unverified",
    BLOCKED_UNSUPPORTED_SHAPE: "blocked_unsupported_shape",
    RUN_LOCK_BUSY: "run_lock_busy",
    ERROR: "error",
  },
  CLOUD_BACKUP_EXPORT_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    EXPORTED: "exported",
    ERROR: "error",
  },
  CLOUD_BACKUP_EXPORT_ARTIFACT_VERSION: "cloud-backup-export-artifact-v1",
  CLOUD_RESTORE_COMPLETE_EVENT: "estipaid:cloud-restore-complete",
  getLastCloudRestoreCompleteAt: jest.fn(() => 0),
}));

jest.mock("../lib/cloudSafeRecovery", () => ({
  __esModule: true,
  previewSafeCloudRecovery: jest.fn(),
  applySafeCloudRecovery: jest.fn(),
  runRecoveryContinuation: jest.fn(),
  describeBackupPauseReason: jest.fn((blocker) => blocker?.code === "estimate_project_missing"
    ? "Some recovered estimates are not linked to a job."
    : "Some records need attention before backup."),
  SAFE_CLOUD_RECOVERY_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    NOTHING_TO_RECOVER: "nothing_to_recover",
    PREVIEWED: "previewed",
    RECOVERED: "recovered",
    ERROR: "error",
  },
  RECOVERY_CONTINUATION_STATUS: {
    BACKED_UP: "backed_up",
    BACKED_UP_WITH_SKIPPED: "backed_up_with_skipped",
    PAUSED: "paused",
    ERROR: "error",
  },
}));

jest.mock("../lib/supabaseEstimateRestorePayload", () => ({
  __esModule: true,
  updateEstimateRestorePayloads: jest.fn(),
  ESTIMATE_PAYLOAD_UPDATE_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    NO_LOCAL_ESTIMATES: "no_local_estimates",
    COMPLETED: "completed",
    ERROR: "error",
  },
}));

jest.mock("../lib/cloudPartialRecoveryStatus", () => {
  const actual = jest.requireActual("../lib/cloudPartialRecoveryStatus");
  return {
    __esModule: true,
    ...actual,
    readCloudPartialRecoveryStatus: jest.fn((...args) => actual.readCloudPartialRecoveryStatus(...args)),
  };
});

const useSupabaseAuth = require("../lib/useSupabaseAuth").default;
const useSupabaseAccount = require("../lib/useSupabaseAccount").default;
const {
  checkSupabaseCloudOnboardingStatus,
  runSupabaseCloudOnboardingBackup,
  removePreservedOlderCloudEstimates,
  CLOUD_ONBOARDING_STATUS,
  PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS,
} = require("../lib/supabaseCloudOnboarding");
const {
  executeSupabaseCloudRestore,
  previewSupabaseCloudRestore,
  exportSupabaseCloudBackupArtifact,
  CLOUD_RESTORE_STATUS,
  CLOUD_BACKUP_EXPORT_STATUS,
} = require("../lib/supabaseCloudRestore");
const {
  previewSafeCloudRecovery,
  applySafeCloudRecovery,
  runRecoveryContinuation,
  SAFE_CLOUD_RECOVERY_STATUS,
  RECOVERY_CONTINUATION_STATUS,
} = require("../lib/cloudSafeRecovery");
const { updateEstimateRestorePayloads, ESTIMATE_PAYLOAD_UPDATE_STATUS } = require("../lib/supabaseEstimateRestorePayload");
const { readCloudPartialRecoveryStatus } = require("../lib/cloudPartialRecoveryStatus");
const actualCloudPartialRecoveryStatus = jest.requireActual("../lib/cloudPartialRecoveryStatus");
const { runSupabaseCloudConvergence, recoverInterruptedCloudConvergence } = require("../lib/supabaseCloudConvergence");

const ACTIVE_DEVICE_LOCK = { ready: true, loading: false, isActive: true, isLocked: false };

function signInWithCompany() {
  useSupabaseAuth.mockReturnValue({
    configured: true,
    user: { id: "user_1" },
    userEmail: "owner@example.com",
  });
  useSupabaseAccount.mockReturnValue({
    company: { id: "company_1", name: "BVW Contracting Solutions" },
    role: "owner",
    hasCompany: true,
  });
}

function blockedMissingPayloadPreview(missingCount = 3) {
  return {
    status: CLOUD_RESTORE_STATUS.BLOCKED_UNSUPPORTED_SHAPE,
    eligible: true,
    partial: true,
    blockers: [{
      code: "estimates_not_reconstructable",
      message: "Estimates cannot be safely restored yet.",
      details: { missingRestorePayloadCount: missingCount },
    }],
    notices: [],
  };
}

function safeRecoveryPreviewFixture(overrides = {}) {
  return {
    status: SAFE_CLOUD_RECOVERY_STATUS.PREVIEWED,
    error: "",
    counts: { customers: 4, projects: 2, estimates: 1, invoices: 2, invoicePayments: 1 },
    skippedEstimates: 3,
    warnings: [],
    plan: { ok: true },
    settings: null,
    ...overrides,
  };
}

// Home recovery contract: automatic empty-device hydration is retired. A
// fully-restorable empty device is offered ONE explicit, confirmed restore;
// every other state (blocked preview, pending local work, established
// workspace) shows no Home recovery console and runs no recovery writer.
function eligibleRestorePreview(overrides = {}) {
  return {
    status: CLOUD_RESTORE_STATUS.ELIGIBLE,
    eligible: true,
    partial: false,
    fullyRestorable: true,
    blockers: [],
    notices: [],
    ...overrides,
  };
}

async function confirmExplicitRestore() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore Cloud to This Device" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore Data" }));
  });
}

function expectNoRetiredRecoveryWriters() {
  expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
  expect(previewSafeCloudRecovery).not.toHaveBeenCalled();
  expect(applySafeCloudRecovery).not.toHaveBeenCalled();
  expect(runRecoveryContinuation).not.toHaveBeenCalled();
  expect(updateEstimateRestorePayloads).not.toHaveBeenCalled();
  expect(removePreservedOlderCloudEstimates).not.toHaveBeenCalled();
  expect(exportSupabaseCloudBackupArtifact).not.toHaveBeenCalled();
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
}

test("a fully-restorable empty device is never hydrated automatically and restores only after explicit confirmation", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(eligibleRestorePreview());
  executeSupabaseCloudRestore.mockResolvedValue({
    status: CLOUD_RESTORE_STATUS.RESTORED,
    restored: true,
    restoredCounts: { customers: 2, projects: 1, estimates: 1, invoices: 1 },
  });
  const convergenceRequested = jest.fn();
  window.addEventListener("estipaid:cloud-convergence-request", convergenceRequested);
  try {
    await renderAndSettle();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeEnabled();
    expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();

    await confirmExplicitRestore();

    await waitFor(() => expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1));
    expect(executeSupabaseCloudRestore).toHaveBeenCalledWith(expect.objectContaining({
      configured: true,
      user: expect.objectContaining({ id: "user_1" }),
      company: expect.objectContaining({ id: "company_1" }),
      storage: localStorage,
    }));
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    // Home never issues its own convergence request; the restore owner's
    // completion handoff is the only continuation.
    expect(convergenceRequested).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("estipaid:cloud-convergence-request", convergenceRequested);
  }
});

test("established current sync issue never turns Home recovery into a whole-workspace retry engine", async () => {
  markCloudBackupDirty({ reason: "invoice_saved", severity: "money_critical" });
  markCloudBackupReviewRequired("Current conflict", { status: "conflict" });
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION });

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
});

test("an explicit restore disables Home actions while in flight and hides the card once restored", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(eligibleRestorePreview());
  const deferred = createDeferred();
  executeSupabaseCloudRestore.mockReturnValue(deferred.promise);

  await renderAndSettle();
  await confirmExplicitRestore();

  expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Not now" })).toBeDisabled();

  await act(async () => {
    deferred.resolve({ status: CLOUD_RESTORE_STATUS.RESTORED, restored: true });
    await deferred.promise;
  });

  await waitFor(() => expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument());
  expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1);
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
});

test("a post-write verification mismatch keeps the explicit restore visible and requests no convergence", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(eligibleRestorePreview());
  executeSupabaseCloudRestore.mockResolvedValue({
    status: CLOUD_RESTORE_STATUS.RECOVERED_UNVERIFIED,
    restored: false,
    localRecoveryApplied: true,
    error: "Recovery copied data to this device, but cloud verification still needs attention.",
  });
  const convergenceRequested = jest.fn();
  window.addEventListener("estipaid:cloud-convergence-request", convergenceRequested);
  try {
    await renderAndSettle();
    await confirmExplicitRestore();

    await waitFor(() => expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId("cloud-home-restore-prompt")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Recovery copied data to this device, but cloud verification still needs attention.");
    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeEnabled();
    expect(convergenceRequested).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("estipaid:cloud-convergence-request", convergenceRequested);
  }
});

test("an explicit restore failure clears restoring and is never retried on its own", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(eligibleRestorePreview());
  const deferred = createDeferred();
  executeSupabaseCloudRestore.mockReturnValue(deferred.promise);

  await renderAndSettle();
  await confirmExplicitRestore();
  expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeDisabled();

  await act(async () => {
    deferred.reject(new Error("local recovery failed"));
    try { await deferred.promise; } catch {}
  });

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("local recovery failed"));
  expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeEnabled();
  expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1);
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
});

test("an empty device keeps recovery ownership while convergence mounts before its delayed preview, and nothing hydrates without consent", async () => {
  const previewDeferred = createDeferred();
  const convergenceRequested = jest.fn();
  window.addEventListener("estipaid:cloud-convergence-request", convergenceRequested);
  try {
    previewSupabaseCloudRestore.mockReturnValue(previewDeferred.promise);
    executeSupabaseCloudRestore.mockImplementation(async () => {
      // Models the restore transaction's local apply before it returns RESTORED.
      localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([{ id: "customer-restored" }]));
      return { status: CLOUD_RESTORE_STATUS.RESTORED, restored: true };
    });

    // The app-level convergence hook mounts first while the fresh-device
    // recovery preview is still unresolved.
    renderHook(() => useCloudAutoConvergence({
      configured: true,
      user: { id: "user_1" },
      company: { id: "company_1" },
      deviceLock: ACTIVE_DEVICE_LOCK,
    }));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();

    await renderAndSettle();
    await act(async () => {
      previewDeferred.resolve(eligibleRestorePreview());
      await previewDeferred.promise;
    });

    expect(await screen.findByRole("button", { name: "Restore Cloud to This Device" })).toBeEnabled();
    expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
    expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();
    expect(convergenceRequested).not.toHaveBeenCalled();

    await confirmExplicitRestore();

    await waitFor(() => expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1));
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener("estipaid:cloud-convergence-request", convergenceRequested);
  }
});

test("a busy restore run lock is reported and never retried automatically; only the user can try again", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(eligibleRestorePreview());
  executeSupabaseCloudRestore
    .mockResolvedValueOnce({
      status: CLOUD_RESTORE_STATUS.RUN_LOCK_BUSY,
      error: "Cloud recovery is already running. Please wait for it to finish.",
      noWritesPerformed: true,
    })
    .mockResolvedValueOnce({ status: CLOUD_RESTORE_STATUS.RESTORED, restored: true });

  await renderAndSettle();
  await confirmExplicitRestore();

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Cloud recovery is already running. Please wait for it to finish."));
  // Longer than the first retired automatic retry delay (250 ms).
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 400)); });
  expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1);

  await confirmExplicitRestore();

  await waitFor(() => expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument());
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
});

function buildCloudExportArtifact(overrides = {}) {
  return {
    artifactVersion: "cloud-backup-export-artifact-v1",
    schemaVersion: 1,
    source: "cloud",
    app: "EstiPaid",
    exportedAt: "2026-07-05T12:00:00.000Z",
    companyId: "company_1",
    companyName: "BVW Contracting Solutions",
    counts: {
      customers: 2,
      projects: 1,
      estimates: 1,
      estimateLineItems: 0,
      invoices: 1,
      invoiceLineItems: 1,
      invoicePayments: 1,
      scopeTemplates: 0,
    },
    restorePayloadCoverage: { totalEstimates: 1, estimatesWithRestorePayload: 1, estimatesMissingRestorePayload: 0 },
    records: { customers: [], projects: [], estimates: [], invoices: [], companyProfile: null, settings: null, scopeTemplates: null },
    notices: [],
    ...overrides,
  };
}

function writePartialRecoveryStatus(overrides = {}) {
  localStorage.setItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS, JSON.stringify({
    recoveryMode: "partial_cloud_recovery",
    status: "finished_with_older_estimates_kept",
    skippedEstimateCount: 3,
    skippedEstimateIds: ["est_2", "est_3", "est_4"],
    skippedReason: "missing_full_estimate_details",
    recoveredAt: "2026-07-06T01:00:00.000Z",
    olderEstimatesKeptInCloud: true,
    ...overrides,
  }));
}

async function renderAndSettle(props = {}) {
  let utils;
  await act(async () => {
    utils = render(<CloudHomeRestorePrompt {...props} />);
  });
  return utils;
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  localStorage.clear();
  try { sessionStorage.clear(); } catch {}
  global.Blob = global.Blob || function FakeBlob() {};
  global.URL.createObjectURL = jest.fn(() => "blob:test");
  global.URL.revokeObjectURL = jest.fn();
  signInWithCompany();
  checkSupabaseCloudOnboardingStatus.mockReset();
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  previewSupabaseCloudRestore.mockReset();
  previewSupabaseCloudRestore.mockResolvedValue({
    status: CLOUD_RESTORE_STATUS.ELIGIBLE,
    eligible: true,
    partial: false,
    blockers: [],
    notices: [],
  });
  executeSupabaseCloudRestore.mockReset();
  runSupabaseCloudConvergence.mockReset();
  runSupabaseCloudConvergence.mockResolvedValue({ ok: true, status: "matched" });
  recoverInterruptedCloudConvergence.mockReset();
  recoverInterruptedCloudConvergence.mockReturnValue({ ok: true, recovered: false });
  exportSupabaseCloudBackupArtifact.mockReset();
  exportSupabaseCloudBackupArtifact.mockResolvedValue({
    status: CLOUD_BACKUP_EXPORT_STATUS.EXPORTED,
    artifact: buildCloudExportArtifact(),
    error: "",
  });
  previewSafeCloudRecovery.mockReset();
  previewSafeCloudRecovery.mockResolvedValue(safeRecoveryPreviewFixture());
  applySafeCloudRecovery.mockReset();
  applySafeCloudRecovery.mockReturnValue({
    status: SAFE_CLOUD_RECOVERY_STATUS.RECOVERED,
    error: "",
    recoveredCounts: { customers: 4, projects: 2, estimates: 1, invoices: 2, invoicePayments: 1 },
    skippedEstimates: 3,
    writeCount: 4,
    settingsWritten: false,
  });
  runRecoveryContinuation.mockReset();
  runRecoveryContinuation.mockResolvedValue({
    status: RECOVERY_CONTINUATION_STATUS.BACKED_UP_WITH_SKIPPED,
    backupRan: true,
    repairChanged: true,
    repairs: {},
    skippedEstimates: 3,
    olderEstimatesKeptInCloud: true,
    recoveryStatus: {
      recoveryMode: "partial_cloud_recovery",
      status: "finished_with_older_estimates_kept",
      skippedEstimateCount: 3,
      skippedEstimateIds: ["est_2", "est_3", "est_4"],
      skippedReason: "missing_full_estimate_details",
      recoveredAt: "2026-07-06T01:00:00.000Z",
      olderEstimatesKeptInCloud: true,
    },
  });
  runSupabaseCloudOnboardingBackup.mockReset();
  removePreservedOlderCloudEstimates.mockReset();
  removePreservedOlderCloudEstimates.mockResolvedValue({
    status: PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.COMPLETED,
    clearedPartialRecoveryStatus: true,
  });
  updateEstimateRestorePayloads.mockReset();
  readCloudPartialRecoveryStatus.mockReset();
  readCloudPartialRecoveryStatus.mockImplementation((...args) => actualCloudPartialRecoveryStatus.readCloudPartialRecoveryStatus(...args));
});

test("empty device shows the single explicit Restore Cloud to This Device path when full recovery is available", async () => {
  executeSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.RESTORED, restored: true });

  await renderAndSettle();

  expect(screen.getByText("Recovery Available")).toBeInTheDocument();
  expect(screen.getByText("Recover your BVW Contracting Solutions records on this device.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeInTheDocument();
  ["Finish Recovery", "Try Again", "Download Emergency Backup File", "Repair Missing Estimate Details", "Remove Older Estimates"]
    .forEach((name) => expect(screen.queryByRole("button", { name })).not.toBeInTheDocument());

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore Cloud to This Device" }));
  });

  expect(screen.getByRole("dialog", { name: "Restore cloud data to this device?" })).toBeInTheDocument();
  expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore Data" }));
  });

  expect(executeSupabaseCloudRestore).toHaveBeenCalledWith(expect.objectContaining({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
  }));
});

test.each([
  ["missing estimate details", () => blockedMissingPayloadPreview(2)],
  ["a partial cloud backup", () => eligibleRestorePreview({ partial: true, fullyRestorable: false })],
  ["no cloud data", () => ({ status: CLOUD_RESTORE_STATUS.NO_CLOUD_DATA, eligible: false, partial: false, blockers: [], notices: [] })],
])("an empty device blocked by %s shows no Home recovery console and runs no recovery writer", async (_label, buildPreview) => {
  previewSupabaseCloudRestore.mockResolvedValue(buildPreview());

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
  ["Restore Cloud to This Device", "Finish Recovery", "Try Again", "Download Emergency Backup File", "Repair Missing Estimate Details"]
    .forEach((name) => expect(screen.queryByRole("button", { name })).not.toBeInTheDocument());
  expectNoRetiredRecoveryWriters();
});

test("a blocked preview never repairs cloud estimate details from Home, even with original estimates on this device", async () => {
  localStorage.setItem("estipaid-estimates-v1", JSON.stringify([{ id: "est_1" }, { id: "est_2" }]));
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(2));
  updateEstimateRestorePayloads.mockResolvedValue({ status: ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED, estimatesUpdated: 2 });

  await renderAndSettle();

  expect(screen.queryByRole("button", { name: "Repair Missing Estimate Details" })).not.toBeInTheDocument();
  expectNoRetiredRecoveryWriters();
});

test("restore confirmation renders through a portal into document.body and Cancel closes it without restoring", async () => {
  const { container } = await renderAndSettle();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore Cloud to This Device" }));
  });

  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "Restore cloud data to this device?" })).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  expect(screen.queryByRole("dialog", { name: "Restore cloud data to this device?" })).not.toBeInTheDocument();
  expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
});

test("restore confirmation cannot double-submit on a rapid double click", async () => {
  const deferred = createDeferred();
  executeSupabaseCloudRestore.mockReturnValue(deferred.promise);

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore Cloud to This Device" }));
  });

  const confirmButton = screen.getByRole("button", { name: "Restore Data" });
  await act(async () => {
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
  });

  expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1);

  await act(async () => {
    deferred.resolve({ status: CLOUD_RESTORE_STATUS.RESTORED, restored: true });
    await deferred.promise;
  });
  expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1);
});

test("a restore refused because this device already has data keeps the overwrite protection visible", async () => {
  executeSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY, restored: false });

  await renderAndSettle();
  await confirmExplicitRestore();

  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("This device already has local data. Restore is blocked to prevent overwriting."));
  expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1);
});

test("an unsaved in-progress draft keeps an empty device out of the restore offer", async () => {
  await renderAndSettle({ hasChamberedDraft: true });

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
  expectNoRetiredRecoveryWriters();
});

test("pending mutation-ledger work on an empty device blocks the fresh-device restore offer", async () => {
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
  // The contractor deleted their last customer: the device is empty, but that
  // delete is durable local work the cloud has not acknowledged yet.
  await commitStoredCustomerCollectionMutation({
    previousCustomers: [{ id: "customer-deleted", name: "Martinez" }],
    nextCustomers: [],
    event: { companyId: "company_1" },
  });
  expect(readCloudMutationLedger().entries).toEqual([
    expect.objectContaining({ entityType: "customer", documentId: "customer-deleted", operation: "delete" }),
  ]);

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
  expectNoRetiredRecoveryWriters();
});

test("established mismatch does not expose Home as a backup retry engine", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
});

test("established mismatch diagnostics do not reopen the retired Home backup path", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
    verification: {
      ok: true,
      allMatched: false,
      tableResults: [
        {
          table: "estimates",
          status: "mismatch",
          oldDeviceRequiredMissingRestorePayloadLegacyIds: ["est_unknown"],
        },
      ],
      notices: [{
        level: "warning",
        code: "estimates_backup_protection_old_device_required",
        message: "Some older estimates need the original device to finish backup protection.",
      }],
    },
  });

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
});

test("established onboarding failure does not expose Home retry actions", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
    preview: {
      integrity: {
        blockers: [],
        safeRepairs: [{
          code: "estimate_project_stale",
          message: "Safe repair can detach a stale project link on 2 estimates.",
        }],
        summary: { blockersCount: 0, warningsCount: 0, repairsAvailableCount: 1 },
        backupReadiness: {
          blocked: false,
          safe: false,
          canProceedAfterSafeRepair: true,
          firstBlocker: null,
        },
      },
    },
    automaticSafeRepair: {
      attempted: true,
      failed: true,
      technicalDetail: "Safe repair can detach a stale project link on 2 estimates.",
    },
    noWritesPerformed: false,
  });

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
});

test("established mismatch cannot directly run onboarding backup from Home", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED });

  await renderAndSettle();
  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
});

test("established mismatch never uses preserved recovery metadata to create a Home retry", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });
  writePartialRecoveryStatus();
  readCloudPartialRecoveryStatus
    .mockImplementationOnce(() => null)
    .mockImplementation((...args) => actualCloudPartialRecoveryStatus.readCloudPartialRecoveryStatus(...args));
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED });

  await renderAndSettle();
  expect(screen.queryByRole("button", { name: "Back Up Now" })).not.toBeInTheDocument();
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
});

test.each([
  CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
  CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP,
])("stored partial-recovery completion on an established %s workspace exposes no retired completion or cleanup UI", async (status) => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status });
  writePartialRecoveryStatus();

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
  expect(screen.queryByText("Recovery finished.")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Remove Older Estimates" })).not.toBeInTheDocument();
  expectNoRetiredRecoveryWriters();
});

test("does not show a restore prompt while local has unbacked pending changes", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
});

test("Not now dismisses the prompt", async () => {
  await renderAndSettle();
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
});

test("a local/cloud mismatch stays out of Home execution paths", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED, noWritesPerformed: false });
  const requestSeen = jest.fn();
  const restoreBefore = executeSupabaseCloudRestore.mock.calls.length;
  window.addEventListener("estipaid:cloud-convergence-request", requestSeen);
  try {
    await renderAndSettle();
    expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
    expect(requestSeen).not.toHaveBeenCalled();
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    expect(executeSupabaseCloudRestore.mock.calls.length).toBe(restoreBefore);
  } finally {
    window.removeEventListener("estipaid:cloud-convergence-request", requestSeen);
  }
});
