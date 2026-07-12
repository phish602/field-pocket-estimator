import { act, render, screen } from "@testing-library/react";
import CloudBackupInlineStatus from "./CloudBackupInlineStatus";
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
    render(<CloudBackupInlineStatus />);
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

  expect(screen.queryByTestId("cloud-backup-inline-status")).not.toBeInTheDocument();
});

test("renders current copy when cloud verification confirms this device is current", async () => {
  await renderAndSettle();

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Cloud up to date"
  );
});

test("renders pending copy", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  await renderAndSettle();

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Syncing automatically"
  );
});

test("renders running copy", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  await renderAndSettle();
  act(() => {
    window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, { detail: { running: true } }));
  });

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Backing up..."
  );
});

test("renders current copy only once a successful backup is confirmed", async () => {
  clearCloudBackupDirty("test_backup_success");

  await renderAndSettle();

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Cloud up to date"
  );
});

test("renders a calm failed/retry copy", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: "needs_attention" });

  await renderAndSettle();

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Sync needs attention"
  );
});

test("renders restored copy after a cloud-restore-complete event", async () => {
  await renderAndSettle();
  act(() => {
    window.dispatchEvent(new CustomEvent(CLOUD_RESTORE_COMPLETE_EVENT, { detail: { restored: true } }));
  });

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent("Cloud backup restored");
});
