import { act, render, screen } from "@testing-library/react";
import CloudBackupStatusBadge from "./CloudBackupStatusBadge";
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

  render(<CloudBackupStatusBadge />);

  expect(screen.queryByTestId("cloud-backup-status-badge")).not.toBeInTheDocument();
});

test("renders nothing when the queue has never been dirty and never backed up", () => {
  render(<CloudBackupStatusBadge />);

  expect(screen.queryByTestId("cloud-backup-status-badge")).not.toBeInTheDocument();
});

test("shows a calm pending status when the queue is dirty", () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  render(<CloudBackupStatusBadge />);

  expect(screen.getByText("Cloud backup pending")).toBeInTheDocument();
  expect(screen.getByText("Latest changes are saved on this device.")).toBeInTheDocument();
  expect(screen.queryByText(/sync/i)).not.toBeInTheDocument();
});

test("shows running status when the auto-backup worker reports it is running", () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  render(<CloudBackupStatusBadge />);
  act(() => {
    window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, { detail: { running: true } }));
  });

  expect(screen.getByText("Backing up changes...")).toBeInTheDocument();
});

test("shows current status only once a successful backup is confirmed", () => {
  clearCloudBackupDirty("test_backup_success");

  render(<CloudBackupStatusBadge />);

  expect(screen.getByText("Cloud backup is up to date.")).toBeInTheDocument();
});

test("shows a calm failed status that reassures local work is safe", () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });
  recordCloudBackupAttemptFailure("network_error");

  render(<CloudBackupStatusBadge />);

  expect(screen.getByText("Cloud backup needs attention")).toBeInTheDocument();
  expect(screen.getByText("Your work is saved on this device. Backup will retry.")).toBeInTheDocument();
});

test("shows a restored confirmation after a cloud-restore-complete event", () => {
  render(<CloudBackupStatusBadge />);
  act(() => {
    window.dispatchEvent(new CustomEvent(CLOUD_RESTORE_COMPLETE_EVENT, { detail: { restored: true } }));
  });

  expect(screen.getByText("Cloud backup restored.")).toBeInTheDocument();
});
