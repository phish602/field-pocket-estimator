import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CloudHomeRestorePrompt from "./CloudHomeRestorePrompt";
import { markCloudBackupDirty } from "../lib/cloudBackupQueue";
import { STORAGE_KEYS } from "../constants/storageKeys";

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
    BLOCKED_UNSUPPORTED_SHAPE: "blocked_unsupported_shape",
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
const { checkSupabaseCloudOnboardingStatus, runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } = require("../lib/supabaseCloudOnboarding");
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
  updateEstimateRestorePayloads.mockReset();
  readCloudPartialRecoveryStatus.mockReset();
  readCloudPartialRecoveryStatus.mockImplementation((...args) => actualCloudPartialRecoveryStatus.readCloudPartialRecoveryStatus(...args));
});

test("empty device shows a simple Finish Recovery path when full recovery is available", async () => {
  executeSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.RESTORED, restored: true });

  await renderAndSettle();

  expect(screen.getByText("Recovery Available")).toBeInTheDocument();
  expect(screen.getByText("Recover your BVW Contracting Solutions records on this device.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Finish Recovery" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download Emergency Backup File" })).not.toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Recovery" }));
  });

  expect(screen.getByRole("dialog", { name: "Restore cloud data to this device?" })).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore Data" }));
  });

  expect(executeSupabaseCloudRestore).toHaveBeenCalledWith(expect.objectContaining({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
  }));
});

test("blocked empty-device recovery uses contractor language and Home-owned actions", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(2));

  await renderAndSettle();

  expect(screen.getByText("Most of your data can still be recovered safely on this device.")).toBeInTheDocument();
  expect(screen.getByText("2 older estimates are still kept safely in cloud. They could not be fully rebuilt on this device.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Finish Recovery" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download Emergency Backup File" })).toBeInTheDocument();
  expect(screen.getByText(/Downloads an emergency backup file\. It does not automatically restore or back up your account\./)).toBeInTheDocument();
  expect(screen.queryByText(/restore payload/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/metadata/i)).not.toBeInTheDocument();
});

test("Finish Recovery runs safe recovery and continuation, then shows the kept-in-cloud completion state", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Recovery" }));
  });

  expect(previewSafeCloudRecovery).toHaveBeenCalledWith({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
  });
  expect(screen.getByRole("dialog", { name: "Finish recovery on this device?" })).toBeInTheDocument();
  expect(screen.getByText("This will recover 4 customers, 2 jobs, 1 estimates, and 2 invoices.")).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Finish Recovery" })[1]);
  });

  expect(applySafeCloudRecovery).toHaveBeenCalledWith(expect.objectContaining({
    preview: expect.objectContaining({ status: SAFE_CLOUD_RECOVERY_STATUS.PREVIEWED }),
    storage: localStorage,
  }));
  expect(runRecoveryContinuation).toHaveBeenCalledWith(expect.objectContaining({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
    role: "owner",
    storage: localStorage,
    skippedEstimates: 3,
    skippedEstimateLegacyIds: [],
    onPhase: expect.any(Function),
  }));

  await waitFor(() => {
    expect(screen.getByText("Recovery finished.")).toBeInTheDocument();
  });
  expect(screen.getByText("Your data is back on this device.")).toBeInTheDocument();
  expect(screen.getByText("3 older estimates are still kept safely in cloud. They could not be fully rebuilt on this device.")).toBeInTheDocument();
  expect(screen.getByText("Use the old device to repair those estimates if needed.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download Emergency Backup File" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try Again" })).not.toBeInTheDocument();
  [
    "metadata",
    "payload",
    "project id",
    "blockers",
    "warnings",
    "mismatch",
    "cloud-only",
    "local-only",
    "JSON",
  ].forEach((word) => {
    expect(screen.queryByText(new RegExp(word, "i"))).not.toBeInTheDocument();
  });
});

test("Finish Recovery confirmation renders through a portal into document.body and Cancel closes it", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));

  const { container } = await renderAndSettle();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Recovery" }));
  });

  expect(container.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.querySelector('[role="dialog"]')).toBeTruthy();
  expect(screen.getByRole("dialog", { name: "Finish recovery on this device?" })).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  expect(screen.queryByRole("dialog", { name: "Finish recovery on this device?" })).not.toBeInTheDocument();
});

test("Finish Recovery cannot double-submit on a rapid double click", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));
  const deferred = createDeferred();
  runRecoveryContinuation.mockReturnValue(deferred.promise);

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Recovery" }));
  });

  const confirmButton = screen.getAllByRole("button", { name: "Finish Recovery" })[1];
  await act(async () => {
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);
  });

  expect(applySafeCloudRecovery).toHaveBeenCalledTimes(1);
  expect(runRecoveryContinuation).toHaveBeenCalledTimes(1);

  await act(async () => {
    deferred.resolve({
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
    await deferred.promise;
  });
});

test("rejected recovery continuation shows a clear error and does not leave the modal stuck", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));
  runRecoveryContinuation.mockRejectedValue(new Error("network timeout"));

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Recovery" }));
  });
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Finish Recovery" })[1]);
  });

  await waitFor(() => {
    expect(screen.getByRole("alert")).toHaveTextContent("Recovery could not continue right now.");
  });
  expect(screen.queryByRole("dialog", { name: "Finish recovery on this device?" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByText("Technical details"));
  expect(screen.getByText("network timeout")).toBeInTheDocument();
});

test("full safe recovery with no skipped estimates still shows the normal backed-up success state", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(1));
  previewSafeCloudRecovery.mockResolvedValue(safeRecoveryPreviewFixture({ skippedEstimates: 0 }));
  applySafeCloudRecovery.mockReturnValue({
    status: SAFE_CLOUD_RECOVERY_STATUS.RECOVERED,
    error: "",
    recoveredCounts: { customers: 4, projects: 2, estimates: 1, invoices: 2, invoicePayments: 1 },
    skippedEstimates: 0,
    skippedEstimateLegacyIds: [],
    writeCount: 4,
    settingsWritten: false,
  });
  runRecoveryContinuation.mockResolvedValue({
    status: RECOVERY_CONTINUATION_STATUS.BACKED_UP,
    backupRan: true,
    repairChanged: false,
    repairs: {},
    skippedEstimates: 0,
  });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Recovery" }));
  });
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Finish Recovery" })[1]);
  });

  await waitFor(() => {
    expect(screen.getByText("Recovery finished. Your data is backed up.")).toBeInTheDocument();
  });
  expect(screen.queryByText(/older estimates are still kept safely in cloud/i)).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
});

test("paused continuation due to estimate-job links shows Fix Estimate Job Links as the primary action", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));
  runRecoveryContinuation.mockResolvedValue({
    status: RECOVERY_CONTINUATION_STATUS.PAUSED,
    backupRan: true,
    repairChanged: true,
    repairs: {},
    skippedEstimates: 3,
    pausedReason: "Some recovered estimates are not linked to a job.",
    pausedReasonCode: "estimate_project_missing",
    technicalDetail: "One or more estimates reference a project id that is not present locally.",
  });
  const dispatchSpy = jest.spyOn(window, "dispatchEvent");

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Recovery" }));
  });
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Finish Recovery" })[1]);
  });

  await waitFor(() => {
    expect(screen.getByText("Recovery finished, but backup is paused.")).toBeInTheDocument();
  });
  expect(screen.getAllByText("Some recovered estimates are not linked to a job.")).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Fix Estimate Job Links" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try Again" })).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole("button", { name: "Fix Estimate Job Links" }));
  expect(dispatchSpy.mock.calls.some((call) => call[0]?.type === "estipaid:navigate-estimates")).toBe(true);

  dispatchSpy.mockRestore();
});

test("generic paused continuation shows the paused reason once and only one Try Again action", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));
  runRecoveryContinuation.mockResolvedValue({
    status: RECOVERY_CONTINUATION_STATUS.PAUSED,
    backupRan: true,
    repairChanged: false,
    repairs: null,
    skippedEstimates: 0,
    pausedReason: "Backup could not finish yet. Your recovered data is saved on this device.",
    pausedReasonCode: "needs_attention",
    technicalDetail: "Cloud verification still needs attention.",
  });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Recovery" }));
  });
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Finish Recovery" })[1]);
  });

  await waitFor(() => {
    expect(screen.getByText("Recovery finished, but backup is paused.")).toBeInTheDocument();
  });
  expect(screen.getAllByText("Backup could not finish yet. Your recovered data is saved on this device.")).toHaveLength(1);
  expect(screen.getAllByRole("button", { name: "Try Again" })).toHaveLength(1);
});

test("real backup failure after recovery still shows Try Again", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));
  runRecoveryContinuation.mockResolvedValue({
    status: RECOVERY_CONTINUATION_STATUS.ERROR,
    error: "Backup could not finish. Your recovered data is saved on this device.",
    technicalDetail: "network timeout",
  });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Recovery" }));
  });
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Finish Recovery" })[1]);
  });

  await waitFor(() => {
    expect(screen.getByText("Backup could not finish. Your recovered data is saved on this device.")).toBeInTheDocument();
  });
  expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
});

test("technical details after recovery do not fall back to the restore blocked reason", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(1));
  runRecoveryContinuation.mockResolvedValue({
    status: RECOVERY_CONTINUATION_STATUS.PAUSED,
    backupRan: true,
    repairChanged: false,
    repairs: null,
    skippedEstimates: 0,
    pausedReason: "Backup could not finish yet. Your recovered data is saved on this device.",
    pausedReasonCode: "needs_attention",
    technicalDetail: "Cloud verification still needs attention.",
  });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Finish Recovery" }));
  });
  await act(async () => {
    fireEvent.click(screen.getAllByRole("button", { name: "Finish Recovery" })[1]);
  });

  await waitFor(() => {
    expect(screen.getByText("Recovery finished, but backup is paused.")).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText("Technical details"));
  expect(screen.getByText("Cloud verification still needs attention.")).toBeInTheDocument();
  expect(screen.queryByText("Restore is not available on this device yet.")).not.toBeInTheDocument();
});

test("repairable missing estimate details can be repaired from Home", async () => {
  localStorage.setItem("estipaid-estimates-v1", JSON.stringify([{ id: "est_1" }, { id: "est_2" }]));
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(2));
  updateEstimateRestorePayloads.mockResolvedValue({
    status: ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED,
    estimatesChecked: 2,
    estimatesUpdated: 2,
    noLocalDataChanged: true,
  });

  await renderAndSettle();

  expect(screen.getByRole("button", { name: "Repair Missing Estimate Details" })).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Repair Missing Estimate Details" }));
  });
  expect(screen.getByRole("dialog", { name: "Repair missing estimate details?" })).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Repair Estimate Details" }));
  });

  expect(updateEstimateRestorePayloads).toHaveBeenCalledWith(expect.objectContaining({
    storageSnapshot: localStorage,
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
  }));
  expect(screen.getByText("Estimate details repaired for 2 estimates. Checking again...")).toBeInTheDocument();
});

test("Try Again rechecks blocked recovery and can return the simple Finish Recovery state", async () => {
  previewSupabaseCloudRestore
    .mockResolvedValueOnce(blockedMissingPayloadPreview(1))
    .mockResolvedValueOnce({
      status: CLOUD_RESTORE_STATUS.ELIGIBLE,
      eligible: true,
      partial: false,
      blockers: [],
      notices: [],
    });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Try Again" }));
  });

  await waitFor(() => {
    expect(previewSupabaseCloudRestore).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(screen.getByText("Check complete. Recovery is ready on this device.")).toBeInTheDocument();
  });
  expect(screen.getByRole("button", { name: "Finish Recovery" })).toBeInTheDocument();
});

test("Download Emergency Backup File downloads the cloud artifact and keeps the copy non-technical", async () => {
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(1));

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Download Emergency Backup File" }));
  });

  expect(exportSupabaseCloudBackupArtifact).toHaveBeenCalledWith({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
  });
  expect(screen.getByText(/Emergency backup file downloaded: estipaid-cloud-backup-/)).toBeInTheDocument();
  expect(screen.queryByText(/Cloud backup JSON downloaded/i)).not.toBeInTheDocument();
});

test("local-data-exists state uses Back Up Now as the primary safe action", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });

  await renderAndSettle();

  expect(screen.getByText("Backup Available")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Back Up Now" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Finish Recovery" })).not.toBeInTheDocument();
});

test("unknown incomplete cloud estimates show the old-device backup protection state instead of generic backup available copy", async () => {
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

  expect(screen.getByText("Backup needs old device.")).toBeInTheDocument();
  expect(screen.getByText("Some older estimates need the original device to finish backup protection.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Back Up Now" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download Emergency Backup File" })).toBeInTheDocument();
});

test("automatic safe backup repair failure shows contractor-safe retry copy without repair jargon", async () => {
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

  expect(screen.getByText("Backup needs attention.")).toBeInTheDocument();
  expect(screen.getByText("We could not finish protecting this device automatically.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download Emergency Backup File" })).toBeInTheDocument();
  expect(screen.queryByText("Repair Safe Metadata")).not.toBeInTheDocument();
  expect(screen.queryByText(/stale project link/i)).not.toBeInTheDocument();
});

test("Back Up Now runs the existing onboarding backup path and reports success plainly", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Back Up Now" }));
  });

  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
    role: "owner",
  }));
  expect(screen.getByText("Backup finished. Your data is backed up.")).toBeInTheDocument();
});

test("Back Up Now uses stored partial recovery status when retrying a preserved-skipped backup", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });
  writePartialRecoveryStatus();
  readCloudPartialRecoveryStatus
    .mockImplementationOnce(() => null)
    .mockImplementation((...args) => actualCloudPartialRecoveryStatus.readCloudPartialRecoveryStatus(...args));
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Back Up Now" }));
  });

  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({
    preservedSkippedEstimateLegacyIds: ["est_2", "est_3", "est_4"],
  }));
});

test("hydrates completed recovery status from localStorage on mount", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });
  writePartialRecoveryStatus();

  await renderAndSettle();

  expect(screen.getByText("Recovery finished.")).toBeInTheDocument();
  expect(screen.getByText("Your data is back on this device.")).toBeInTheDocument();
  expect(screen.getByText("3 older estimates are still kept safely in cloud. They could not be fully rebuilt on this device.")).toBeInTheDocument();
  expect(screen.queryByText("Backup Available")).not.toBeInTheDocument();
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
