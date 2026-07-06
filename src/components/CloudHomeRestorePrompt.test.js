import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import CloudHomeRestorePrompt from "./CloudHomeRestorePrompt";
import { markCloudBackupDirty } from "../lib/cloudBackupQueue";
import { SHOW_CLOUD_RESTORE_PROMPT_EVENT } from "../lib/useCloudRestorePrompt";

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
  SAFE_CLOUD_RECOVERY_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    NOTHING_TO_RECOVER: "nothing_to_recover",
    PREVIEWED: "previewed",
    RECOVERED: "recovered",
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

const useSupabaseAuth = require("../lib/useSupabaseAuth").default;
const useSupabaseAccount = require("../lib/useSupabaseAccount").default;
const { checkSupabaseCloudOnboardingStatus, runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } = require("../lib/supabaseCloudOnboarding");
const { executeSupabaseCloudRestore, previewSupabaseCloudRestore, exportSupabaseCloudBackupArtifact, CLOUD_RESTORE_STATUS, CLOUD_BACKUP_EXPORT_STATUS } = require("../lib/supabaseCloudRestore");
const { previewSafeCloudRecovery, applySafeCloudRecovery, SAFE_CLOUD_RECOVERY_STATUS } = require("../lib/cloudSafeRecovery");
const { updateEstimateRestorePayloads, ESTIMATE_PAYLOAD_UPDATE_STATUS } = require("../lib/supabaseEstimateRestorePayload");

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
      estimateLineItems: 3,
      invoices: 1,
      invoiceLineItems: 2,
      invoicePayments: 1,
      scopeTemplates: 0,
    },
    restorePayloadCoverage: { totalEstimates: 1, estimatesWithRestorePayload: 1, estimatesMissingRestorePayload: 0 },
    optionalSections: { appRestoreBundle: "missing" },
    records: { customers: [], projects: [], estimates: [], invoices: [], companyProfile: null, settings: null, scopeTemplates: null },
    notices: [],
    ...overrides,
  };
}

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

async function renderAndSettle(props = {}) {
  let utils;
  await act(async () => {
    utils = render(<CloudHomeRestorePrompt {...props} />);
  });
  return utils;
}

beforeEach(() => {
  localStorage.clear();
  try { sessionStorage.clear(); } catch {}
  global.Blob = global.Blob || function FakeBlob() {};
  global.URL.createObjectURL = jest.fn(() => "blob:test");
  global.URL.revokeObjectURL = jest.fn();
  signInWithCompany();
  previewSupabaseCloudRestore.mockReset();
  previewSupabaseCloudRestore.mockResolvedValue({
    status: CLOUD_RESTORE_STATUS.ELIGIBLE,
    eligible: true,
    partial: false,
    blockers: [],
    notices: [],
  });
  executeSupabaseCloudRestore.mockReset();
  runSupabaseCloudOnboardingBackup.mockReset();
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
  updateEstimateRestorePayloads.mockReset();
});

test("does not show a restore prompt when no cloud backup exists (already matches)", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP });

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
});

test("empty device shows Restore This Device", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });

  await renderAndSettle();

  expect(screen.getByText("Cloud backup found")).toBeInTheDocument();
  expect(screen.getByText(/Restore your BVW Contracting Solutions workspace to this device\./)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Restore This Device" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Back Up This Device" })).not.toBeInTheDocument();
});

test("empty device restore opens confirmation and does not execute until confirmed", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  executeSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.RESTORED, restored: true });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore This Device" }));
  });

  expect(screen.getByRole("dialog", { name: "Restore cloud data to this device?" })).toBeInTheDocument();
  expect(screen.getByText("This will copy your cloud backup onto this device.")).toBeInTheDocument();
  expect(screen.getByText("It will overwrite this device's current local data with cloud data.")).toBeInTheDocument();
  expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore Data" }));
  });

  expect(executeSupabaseCloudRestore).toHaveBeenCalledWith(expect.objectContaining({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
  }));
  // Once restored, the card hides -- the Home badge covers the confirmation.
  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
});

test("empty-device restore failure shows a readable error and stays on Home", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  executeSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.ERROR, error: "Something went wrong." });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore This Device" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore Data" }));
  });

  expect(screen.getByTestId("cloud-home-restore-prompt")).toBeInTheDocument();
  expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
});

test("blocked empty-device recovery is Home-first: safe recovery primary, no Settings routing", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(2));

  await renderAndSettle();

  expect(screen.getByText("Estimates cannot be safely restored yet. 2 cloud estimates are missing restore payload data needed for a faithful restore.")).toBeInTheDocument();
  // Gate 13O-2K: one primary recovery action, owned by Home.
  expect(screen.getByRole("button", { name: "Recover What Can Be Safely Recovered" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Restore This Device" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Update Payloads in Settings" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Manage Restore in Settings" })).not.toBeInTheDocument();
  // State D copy: this empty device cannot run the payload repair itself.
  expect(screen.getByText(/This device cannot rebuild missing estimate restore data because the original local estimates are not on this device/)).toBeInTheDocument();
  // Secondary actions stay available without becoming the main path.
  expect(screen.getByRole("button", { name: "Recheck Cloud Status" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download Cloud Backup JSON" })).toBeInTheDocument();
  expect(screen.getByText(/downloads an emergency cloud backup file\. It does not automatically restore this device\./)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
  // Gate 13O-2J: the cloud recovery prompt must never offer a generic or
  // device-sourced backup download -- an empty device would export an empty
  // "backup" that imports as 0 records.
  expect(screen.queryByRole("button", { name: "Download Backup JSON" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Download This Device Backup JSON" })).not.toBeInTheDocument();
  expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
});

test("Recover What Can Be Safely Recovered previews counts, confirms before writing, and reports the result", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Recover What Can Be Safely Recovered" }));
  });

  // Preview only -- nothing written until the user confirms.
  expect(previewSafeCloudRecovery).toHaveBeenCalledWith({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
  });
  expect(applySafeCloudRecovery).not.toHaveBeenCalled();
  expect(screen.getByRole("dialog", { name: "Recover safe cloud records to this device?" })).toBeInTheDocument();
  expect(screen.getByText(/cannot safely rebuild editable estimates without risking wrong totals/)).toBeInTheDocument();
  expect(screen.getByText("This will write 4 customers, 2 projects, 1 estimates, and 2 invoices to this device.")).toBeInTheDocument();
  expect(screen.getByText(/3 estimates missing restore payload will be skipped, not guessed\./)).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Recover Safe Records" }));
  });

  expect(applySafeCloudRecovery).toHaveBeenCalledWith(expect.objectContaining({
    preview: expect.objectContaining({ status: SAFE_CLOUD_RECOVERY_STATUS.PREVIEWED }),
    storage: localStorage,
  }));
  expect(screen.getByText(/Recovered 4 customers, 2 projects, 1 estimates, 2 invoices\. Skipped 3 estimates missing restore payload\./)).toBeInTheDocument();
  expect(screen.getByText(/use a device that still has the original estimates to repair estimate restore data/)).toBeInTheDocument();
});

test("cancelling the safe recovery confirmation writes nothing", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Recover What Can Be Safely Recovered" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  });

  expect(applySafeCloudRecovery).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

test("safe recovery surfaces the cloud read failure instead of silently recovering nothing", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));
  previewSafeCloudRecovery.mockResolvedValue({
    status: SAFE_CLOUD_RECOVERY_STATUS.ERROR,
    error: "Unable to read customers from Supabase. Cloud backup JSON was not created.",
    counts: { customers: 0, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 },
    skippedEstimates: 0,
    plan: null,
  });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Recover What Can Be Safely Recovered" }));
  });

  expect(screen.getByText("Unable to read customers from Supabase. Cloud backup JSON was not created.")).toBeInTheDocument();
  expect(applySafeCloudRecovery).not.toHaveBeenCalled();
});

test("Repair Cloud Restore Data is the primary action when this device still has the original estimates", async () => {
  localStorage.setItem("estipaid-estimates-v1", JSON.stringify([{ id: "est_1" }, { id: "est_2" }]));
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(2));
  updateEstimateRestorePayloads.mockResolvedValue({
    status: ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED,
    estimatesChecked: 2,
    estimatesUpdated: 2,
    noLocalDataChanged: true,
  });

  await renderAndSettle();

  expect(screen.getByRole("button", { name: "Repair Cloud Restore Data" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: "Recover What Can Be Safely Recovered" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Update Payloads in Settings" })).not.toBeInTheDocument();
  expect(screen.getByText(/This device still has the original estimates, so it can repair the missing cloud restore data directly from here\./)).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Repair Cloud Restore Data" }));
  });

  // Cloud-writing repair confirms first.
  expect(screen.getByRole("dialog", { name: "Repair cloud restore data?" })).toBeInTheDocument();
  expect(updateEstimateRestorePayloads).not.toHaveBeenCalled();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Repair Restore Data" }));
  });

  expect(updateEstimateRestorePayloads).toHaveBeenCalledWith(expect.objectContaining({
    storageSnapshot: localStorage,
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
  }));
  expect(screen.getByText(/Repair complete\. Restore data captured for 2 estimates\. Rechecking cloud status\.\.\./)).toBeInTheDocument();
  // Automatic recheck after repair -- no Settings round trip.
  await waitFor(() => {
    expect(previewSupabaseCloudRestore.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

test("Recheck Cloud Status refreshes the restore preview and can enable restore", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
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
  expect(screen.queryByRole("button", { name: "Restore This Device" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Recover What Can Be Safely Recovered" })).toBeInTheDocument();

  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Recheck Cloud Status" }));
  });

  await waitFor(() => {
    expect(previewSupabaseCloudRestore).toHaveBeenCalledTimes(2);
  });
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Restore This Device" })).toBeEnabled();
  });
  expect(screen.getByText("Recheck complete. Restore is now available.")).toBeInTheDocument();
});

test("recheck that stays blocked reports the missing restore metadata count inline", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  previewSupabaseCloudRestore.mockResolvedValue(blockedMissingPayloadPreview(3));

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Recheck Cloud Status" }));
  });

  await waitFor(() => {
    expect(screen.getByText("Recheck complete. 3 estimates are still missing restore metadata.")).toBeInTheDocument();
  });
});

test("Download Cloud Backup JSON downloads the cloud artifact with record counts from the blocked empty-device prompt", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  previewSupabaseCloudRestore.mockResolvedValue({
    status: CLOUD_RESTORE_STATUS.BLOCKED_UNSUPPORTED_SHAPE,
    eligible: true,
    partial: true,
    blockers: [{
      code: "estimates_not_reconstructable",
      message: "Estimates cannot be safely restored yet.",
      details: { missingRestorePayloadCount: 1 },
    }],
    notices: [],
  });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Download Cloud Backup JSON" }));
  });

  expect(exportSupabaseCloudBackupArtifact).toHaveBeenCalledWith({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
  });
  expect(screen.getByText(/Cloud backup JSON downloaded: estipaid-cloud-backup-.*\(2 customers, 1 projects, 1 estimates, 1 invoices\)/)).toBeInTheDocument();
  expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
  expect(global.URL.revokeObjectURL).toHaveBeenCalledTimes(1);
});

test("Download Cloud Backup JSON surfaces the cloud read failure instead of downloading an empty file", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  previewSupabaseCloudRestore.mockResolvedValue({
    status: CLOUD_RESTORE_STATUS.BLOCKED_UNSUPPORTED_SHAPE,
    eligible: true,
    partial: true,
    blockers: [{
      code: "estimates_not_reconstructable",
      message: "Estimates cannot be safely restored yet.",
      details: { missingRestorePayloadCount: 1 },
    }],
    notices: [],
  });
  exportSupabaseCloudBackupArtifact.mockResolvedValue({
    status: CLOUD_BACKUP_EXPORT_STATUS.ERROR,
    artifact: null,
    error: "Unable to read customers from Supabase. Cloud backup JSON was not created.",
    failedTable: "customers",
  });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Download Cloud Backup JSON" }));
  });

  expect(screen.getByText("Unable to read customers from Supabase. Cloud backup JSON was not created.")).toBeInTheDocument();
  expect(global.URL.createObjectURL).not.toHaveBeenCalled();
});

test("Download Cloud Backup JSON warns when the cloud workspace has no core records", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  previewSupabaseCloudRestore.mockResolvedValue({
    status: CLOUD_RESTORE_STATUS.BLOCKED_UNSUPPORTED_SHAPE,
    eligible: true,
    partial: true,
    blockers: [{
      code: "estimates_not_reconstructable",
      message: "Estimates cannot be safely restored yet.",
      details: { missingRestorePayloadCount: 1 },
    }],
    notices: [],
  });
  exportSupabaseCloudBackupArtifact.mockResolvedValue({
    status: CLOUD_BACKUP_EXPORT_STATUS.EXPORTED,
    artifact: buildCloudExportArtifact({
      counts: {
        customers: 0,
        projects: 0,
        estimates: 0,
        estimateLineItems: 0,
        invoices: 0,
        invoiceLineItems: 0,
        invoicePayments: 0,
        scopeTemplates: 0,
      },
    }),
    error: "",
  });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Download Cloud Backup JSON" }));
  });

  expect(screen.getByText(/Warning: the cloud has no customer, project, estimate, or invoice records\./)).toBeInTheDocument();
});

test("local-data-exists state does not offer a restore action and never calls executeSupabaseCloudRestore", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });

  await renderAndSettle();

  expect(screen.getByText("Cloud backup available")).toBeInTheDocument();
  expect(screen.getByText(/This device has local work\. Back up this device before restoring/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^restore/i })).not.toBeInTheDocument();
  expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
});

test("local-data-exists state shows Back Up This Device as the primary action", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });

  await renderAndSettle();

  expect(screen.getByRole("button", { name: "Back Up This Device" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Manage Restore in Settings" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Not now" })).toBeInTheDocument();
});

test("Back Up This Device calls the existing onboarding backup function and shows success inline", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Back Up This Device" }));
  });

  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({
    configured: true,
    user: { id: "user_1" },
    company: { id: "company_1", name: "BVW Contracting Solutions" },
    role: "owner",
  }));
  expect(screen.getByText("This device has been backed up to the cloud.")).toBeInTheDocument();
});

test("backup failure shows a readable error and stays on Home", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.ERROR, error: "Backup failed." });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Back Up This Device" }));
  });

  expect(screen.getByTestId("cloud-home-restore-prompt")).toBeInTheDocument();
  expect(screen.getByText("Backup couldn't complete. Try again from Advanced Settings.")).toBeInTheDocument();
});

test("Manage Restore in Settings dispatches a navigation event instead of restoring directly", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });
  const dispatchSpy = jest.spyOn(window, "dispatchEvent");

  await renderAndSettle();
  fireEvent.click(screen.getByRole("button", { name: "Manage Restore in Settings" }));

  const navEvents = dispatchSpy.mock.calls.filter((call) => call[0]?.type === "estipaid:navigate-cloud-settings");
  expect(navEvents.length).toBe(1);
  expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();

  dispatchSpy.mockRestore();
});

test("a chambered draft is treated as local work even with zero saved records", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });

  await renderAndSettle({ hasChamberedDraft: true });

  expect(screen.getByText("Cloud backup available")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^restore/i })).not.toBeInTheDocument();
});

test("does not show a restore prompt while local has unbacked pending changes", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
});

test("Not now dismisses the prompt", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });

  await renderAndSettle();
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));

  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();
});

test("the header's show-restore-prompt event reopens the card after Not now dismissed it", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });

  await renderAndSettle();
  fireEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(screen.queryByTestId("cloud-home-restore-prompt")).not.toBeInTheDocument();

  act(() => {
    window.dispatchEvent(new CustomEvent(SHOW_CLOUD_RESTORE_PROMPT_EVENT));
  });

  expect(screen.getByTestId("cloud-home-restore-prompt")).toBeInTheDocument();
  expect(screen.getByText("Cloud backup found")).toBeInTheDocument();
});
