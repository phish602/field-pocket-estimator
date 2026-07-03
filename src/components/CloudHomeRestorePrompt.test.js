import { act, fireEvent, render, screen } from "@testing-library/react";
import CloudHomeRestorePrompt from "./CloudHomeRestorePrompt";
import { markCloudBackupDirty } from "../lib/cloudBackupQueue";

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
  CLOUD_RESTORE_COMPLETE_EVENT: "estipaid:cloud-restore-complete",
  getLastCloudRestoreCompleteAt: jest.fn(() => 0),
}));

const useSupabaseAuth = require("../lib/useSupabaseAuth").default;
const useSupabaseAccount = require("../lib/useSupabaseAccount").default;
const { checkSupabaseCloudOnboardingStatus, runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } = require("../lib/supabaseCloudOnboarding");
const { executeSupabaseCloudRestore, CLOUD_RESTORE_STATUS } = require("../lib/supabaseCloudRestore");

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
  signInWithCompany();
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

test("empty device restore calls executeSupabaseCloudRestore directly, with no dead-end confirmation step", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  executeSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.RESTORED, restored: true });

  await renderAndSettle();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Restore This Device" }));
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

  expect(screen.getByTestId("cloud-home-restore-prompt")).toBeInTheDocument();
  expect(screen.getByText("Something went wrong.")).toBeInTheDocument();
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
