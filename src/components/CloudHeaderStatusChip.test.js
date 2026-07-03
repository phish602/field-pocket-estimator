import { act, fireEvent, render, screen } from "@testing-library/react";
import CloudHeaderStatusChip from "./CloudHeaderStatusChip";
import {
  markCloudBackupDirty,
  clearCloudBackupDirty,
  recordCloudBackupAttemptFailure,
} from "../lib/cloudBackupQueue";
import { CLOUD_AUTO_BACKUP_RUNNING_EVENT } from "../lib/useCloudAutoBackup";
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

const useSupabaseAuth = require("../lib/useSupabaseAuth").default;
const useSupabaseAccount = require("../lib/useSupabaseAccount").default;
const { checkSupabaseCloudOnboardingStatus, CLOUD_ONBOARDING_STATUS } = require("../lib/supabaseCloudOnboarding");

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
    utils = render(<CloudHeaderStatusChip {...props} />);
  });
  return utils;
}

beforeEach(() => {
  localStorage.clear();
  signInWithCompany();
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP });
});

test("renders nothing when there is no meaningful backup/restore state", async () => {
  await renderAndSettle();

  expect(screen.queryByTestId("cloud-header-status-chip")).not.toBeInTheDocument();
});

test("shows Backup pending when the queue is dirty", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Backup pending");
});

test("shows Backing up... when the auto-backup worker reports it is running", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  await renderAndSettle();
  act(() => {
    window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, { detail: { running: true } }));
  });

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Backing up...");
});

test("shows Cloud up to date only once a successful backup is confirmed", async () => {
  clearCloudBackupDirty("test_backup_success");

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Cloud up to date");
});

test("shows Backup needs attention for a failed state", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });
  recordCloudBackupAttemptFailure("network_error");

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Backup needs attention");
});

test("shows Restore available when the cloud restore prompt is available", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Restore available");
});

test("backup pending takes priority over restore available", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Backup pending");
  expect(screen.queryByText("Restore available")).not.toBeInTheDocument();
});

test("tapping the chip dispatches the show-restore-prompt event", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });
  const dispatchSpy = jest.spyOn(window, "dispatchEvent");

  await renderAndSettle();
  fireEvent.click(screen.getByTestId("cloud-header-status-chip"));

  const events = dispatchSpy.mock.calls.filter((call) => call[0]?.type === SHOW_CLOUD_RESTORE_PROMPT_EVENT);
  expect(events.length).toBe(1);

  dispatchSpy.mockRestore();
});

test("does not render when there is no cloud workspace", async () => {
  useSupabaseAuth.mockReturnValue({ configured: false, user: null, userEmail: "" });
  useSupabaseAccount.mockReturnValue({ hasCompany: false });
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-header-status-chip")).not.toBeInTheDocument();
});
