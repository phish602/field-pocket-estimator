import { act, fireEvent, render, screen } from "@testing-library/react";
import CloudHeaderStatusChip from "./CloudHeaderStatusChip";
import {
  markCloudBackupDirty,
  clearCloudBackupDirty,
} from "../lib/cloudBackupQueue";
import { CLOUD_AUTO_BACKUP_RUNNING_EVENT } from "../lib/useCloudAutoBackup";
import { SHOW_CLOUD_RESTORE_PROMPT_EVENT } from "../lib/useCloudRestorePrompt";
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
  previewSupabaseCloudRestore: jest.fn(),
  CLOUD_RESTORE_COMPLETE_EVENT: "estipaid:cloud-restore-complete",
  getLastCloudRestoreCompleteAt: jest.fn(() => null),
}));

const useSupabaseAuth = require("../lib/useSupabaseAuth").default;
const useSupabaseAccount = require("../lib/useSupabaseAccount").default;
const { checkSupabaseCloudOnboardingStatus, CLOUD_ONBOARDING_STATUS } = require("../lib/supabaseCloudOnboarding");
const { previewSupabaseCloudRestore } = require("../lib/supabaseCloudRestore");

function setViewportWidth(width) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
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
    utils = render(<CloudHeaderStatusChip {...props} />);
  });
  return utils;
}

beforeEach(() => {
  localStorage.clear();
  setViewportWidth(1024);
  signInWithCompany();
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP });
  previewSupabaseCloudRestore.mockResolvedValue({ eligible: true, partial: false });
});

afterEach(() => {
  setViewportWidth(1024);
});

test("shows Cloud OK when verification confirms cloud current", async () => {
  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Cloud OK");
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

test("shows Cloud OK after a successful backup is confirmed", async () => {
  clearCloudBackupDirty("test_backup_success");

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Cloud OK");
});

test("shows Backup issue for a failed state", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION });

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Backup issue");
});

test("does not get stuck on Pending when a local blocker exists alongside a dirty backup queue", async () => {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([{ id: "cust_1", name: "Acme Co" }]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([{
    id: "inv_1",
    projectId: "proj_1",
    customerId: "cust_1",
    invoiceNumber: "INV-100",
    sourceEstimateId: "est_1",
    invoiceTotal: 100,
    total: 100,
    amountPaid: 0,
    balanceRemaining: 100,
  }]));
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Backup issue");
  expect(screen.queryByText("Backup pending")).not.toBeInTheDocument();
});

test("does not get stuck on Pending when repairable stale metadata exists alongside a dirty backup queue", async () => {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([{ id: "cust_1", name: "Acme Co" }]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([{ id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-1", total: 100 }]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([{
    id: "inv_1",
    projectId: "missing_project",
    customerId: "cust_1",
    invoiceNumber: "INV-100",
    invoiceTotal: 100,
    total: 100,
    amountPaid: 0,
    balanceRemaining: 100,
  }]));
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Backup issue");
  expect(screen.queryByText("Backup pending")).not.toBeInTheDocument();
});

test("shows Restore when cloud restore is safely available", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Restore");
});

test("backup pending takes priority over restore available", async () => {
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });

  await renderAndSettle();

  expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Backup pending");
  expect(screen.queryByText("Restore")).not.toBeInTheDocument();
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

test("tapping a mismatch chip routes to cloud settings", async () => {
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });
  const dispatchSpy = jest.spyOn(window, "dispatchEvent");

  await renderAndSettle();
  fireEvent.click(screen.getByTestId("cloud-header-status-chip"));

  const events = dispatchSpy.mock.calls.filter((call) => call[0]?.type === "estipaid:navigate-cloud-settings");
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

describe("compact mobile copy on narrow viewports", () => {
  beforeEach(() => {
    setViewportWidth(375);
  });

  test("shows Cloud OK on narrow viewports", async () => {
    clearCloudBackupDirty("test_backup_success");

    await renderAndSettle();

    expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Cloud OK");
  });

  test("shows Pending instead of the full 'Backup pending' copy", async () => {
    markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

    await renderAndSettle();

    expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Pending");
  });

  test("shows Backing up instead of the full 'Backing up...' copy", async () => {
    markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

    await renderAndSettle();
    act(() => {
      window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, { detail: { running: true } }));
    });

    expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Backing up");
  });

  test("shows Backup issue on narrow viewports", async () => {
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION });

    await renderAndSettle();

    expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Backup issue");
  });

  test("shows Restore instead of the full 'Restore available' copy", async () => {
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE });

    await renderAndSettle();

    expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Restore");
  });

  test("shows Data mismatch on narrow viewports", async () => {
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH });

    await renderAndSettle();

    expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Data mismatch");
  });

  test("still shows Restored (already short) after a completed restore", async () => {
    await renderAndSettle();
    act(() => {
      window.dispatchEvent(new CustomEvent("estipaid:cloud-restore-complete", { detail: { restored: true } }));
    });

    expect(screen.getByTestId("cloud-header-status-chip")).toHaveTextContent("Restored");
  });

  test("running state gets a little extra breathing room over other narrow states", async () => {
    markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

    await renderAndSettle();
    const pendingWidth = Number(screen.getByTestId("cloud-header-status-chip").style.maxWidth.replace("px", ""));

    act(() => {
      window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, { detail: { running: true } }));
    });
    const runningWidth = Number(screen.getByTestId("cloud-header-status-chip").style.maxWidth.replace("px", ""));

    expect(runningWidth).toBeGreaterThan(pendingWidth);
  });

  test("pending is more visible than the muted default (not the same washed-out color)", async () => {
    markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

    await renderAndSettle();

    const chip = screen.getByTestId("cloud-header-status-chip");
    expect(chip.style.color).not.toBe("rgba(230, 241, 248, 0.62)");
    // Calm/blue-toned, not the failed-state yellow and not the current-state green.
    expect(chip.style.color).not.toBe("rgba(253, 224, 71, 0.95)");
    expect(chip.style.color).not.toBe("rgba(187, 247, 208, 0.9)");
  });
});
