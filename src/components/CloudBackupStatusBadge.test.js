import { act, render, screen } from "@testing-library/react";
import CloudBackupStatusBadge from "./CloudBackupStatusBadge";
import {
  markCloudBackupDirty,
  clearCloudBackupDirty,
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

jest.mock("../lib/supabaseCloudOnboarding", () => ({
  __esModule: true,
  checkSupabaseCloudOnboardingStatus: jest.fn(),
}));

jest.mock("../lib/supabaseCloudRestore", () => ({
  __esModule: true,
  previewSupabaseCloudRestore: jest.fn(),
  CLOUD_RESTORE_COMPLETE_EVENT: "estipaid:cloud-restore-complete",
  getLastCloudRestoreCompleteAt: jest.fn(() => null),
}));

const useSupabaseAuth = require("../lib/useSupabaseAuth").default;
const useSupabaseAccount = require("../lib/useSupabaseAccount").default;
const { checkSupabaseCloudOnboardingStatus } = require("../lib/supabaseCloudOnboarding");
const { previewSupabaseCloudRestore } = require("../lib/supabaseCloudRestore");

function signInWithCompany() {
  useSupabaseAuth.mockReturnValue({
    configured: true,
    user: { id: "user_1" },
    userEmail: "owner@example.com",
  });
  useSupabaseAccount.mockReturnValue({
    company: { id: "company_1", name: "Field Pocket LLC" },
    role: "owner",
    hasCompany: true,
  });
}

async function renderAndSettle() {
  await act(async () => {
    render(<CloudBackupStatusBadge />);
  });
}

beforeEach(() => {
  localStorage.clear();
  signInWithCompany();
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: "already_backed_up" });
  previewSupabaseCloudRestore.mockResolvedValue({ eligible: true, partial: false });
});

test("renders nothing when not signed in or no cloud workspace", async () => {
  useSupabaseAuth.mockReturnValue({ configured: false, user: null, userEmail: "" });
  useSupabaseAccount.mockReturnValue({ hasCompany: false });
  markCloudBackupDirty({ reason: "test", severity: "normal" });

  await renderAndSettle();

  expect(screen.queryByTestId("cloud-backup-status-badge")).not.toBeInTheDocument();
});

test("shows current status when cloud verification confirms this device is current", async () => {
  await renderAndSettle();

  expect(screen.getByText("Cloud backup is up to date.")).toBeInTheDocument();
});

test("shows a calm pending status when the queue is dirty", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  await renderAndSettle();

  expect(screen.getByText("Cloud backup pending")).toBeInTheDocument();
  expect(screen.getByText("Latest changes are saved on this device.")).toBeInTheDocument();
  expect(screen.queryByText(/sync/i)).not.toBeInTheDocument();
});

test("shows running status when the auto-backup worker reports it is running", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  await renderAndSettle();
  act(() => {
    window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, { detail: { running: true } }));
  });

  expect(screen.getByText("Backing up changes...")).toBeInTheDocument();
});

test("shows current status only once a successful backup is confirmed", async () => {
  clearCloudBackupDirty("test_backup_success");

  await renderAndSettle();

  expect(screen.getByText("Cloud backup is up to date.")).toBeInTheDocument();
});

test("shows a calm failed status that reassures local work is safe", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: "needs_attention" });

  await renderAndSettle();

  expect(screen.getByText("Cloud backup needs attention")).toBeInTheDocument();
  expect(screen.getByText("Your work is saved on this device. Backup will retry.")).toBeInTheDocument();
});

test("shows a restored confirmation after a cloud-restore-complete event", async () => {
  await renderAndSettle();
  act(() => {
    window.dispatchEvent(new CustomEvent(CLOUD_RESTORE_COMPLETE_EVENT, { detail: { restored: true } }));
  });

  expect(screen.getByText("Cloud backup restored.")).toBeInTheDocument();
});
