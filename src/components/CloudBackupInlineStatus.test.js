import { act, render, screen } from "@testing-library/react";
import CloudBackupInlineStatus from "./CloudBackupInlineStatus";
import {
  markCloudBackupDirty,
  clearCloudBackupDirty,
  recordCloudBackupAttemptFailure,
} from "../lib/cloudBackupQueue";
import { CLOUD_AUTO_BACKUP_RUNNING_EVENT } from "../lib/useCloudAutoBackup";
import { CLOUD_RESTORE_COMPLETE_EVENT } from "../lib/supabaseCloudRestore";

jest.mock("../lib/useSupabaseAuth", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../lib/useSupabaseAccount", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const useSupabaseAuth = require("../lib/useSupabaseAuth").default;
const useSupabaseAccount = require("../lib/useSupabaseAccount").default;

function signInWithCompany() {
  useSupabaseAuth.mockReturnValue({
    configured: true,
    user: { id: "user_1" },
    userEmail: "owner@example.com",
  });
  useSupabaseAccount.mockReturnValue({ hasCompany: true });
}

beforeEach(() => {
  localStorage.clear();
  signInWithCompany();
});

test("renders nothing when not signed in or no cloud workspace", () => {
  useSupabaseAuth.mockReturnValue({ configured: false, user: null, userEmail: "" });
  useSupabaseAccount.mockReturnValue({ hasCompany: false });
  markCloudBackupDirty({ reason: "test", severity: "normal" });

  render(<CloudBackupInlineStatus />);

  expect(screen.queryByTestId("cloud-backup-inline-status")).not.toBeInTheDocument();
});

test("renders nothing when there is no meaningful backup state", () => {
  render(<CloudBackupInlineStatus />);

  expect(screen.queryByTestId("cloud-backup-inline-status")).not.toBeInTheDocument();
});

test("renders pending copy", () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  render(<CloudBackupInlineStatus />);

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Backup pending"
  );
  expect(screen.queryByText(/sync/i)).not.toBeInTheDocument();
});

test("renders running copy", () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  render(<CloudBackupInlineStatus />);
  act(() => {
    window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, { detail: { running: true } }));
  });

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Backing up..."
  );
});

test("renders current copy only once a successful backup is confirmed", () => {
  clearCloudBackupDirty("test_backup_success");

  render(<CloudBackupInlineStatus />);

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Cloud up to date"
  );
});

test("renders a calm failed/retry copy", () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });
  recordCloudBackupAttemptFailure("network_error");

  render(<CloudBackupInlineStatus />);

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Backup will retry"
  );
});

test("renders restored copy after a cloud-restore-complete event", () => {
  render(<CloudBackupInlineStatus />);
  act(() => {
    window.dispatchEvent(new CustomEvent(CLOUD_RESTORE_COMPLETE_EVENT, { detail: { restored: true } }));
  });

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent("Cloud backup restored");
});
