// START-FENCE for the automatic backup baseline capture.
//
// captureAutomaticBackupBaseline proves ownership, then performs a full cloud
// convergence read, then stamps a durable verified baseline. That middle step is
// a network scan, and a takeover -- or a takeover followed by this device taking
// the workspace back under a NEWER generation -- can complete inside it. Asking
// "am I active now?" after the scan is satisfied by A(v5) -> B(v6) -> A(v7),
// which would let a superseded run declare local equal to cloud.
//
// These live in their own file because they need ./supabaseDeviceLock and
// ./supabaseCloudRestore stubbed, and jest.mock is file-wide: mocking them in
// useCloudAutoBackup.test.js would silently change the 26 tests there.

import { renderHook, waitFor } from "@testing-library/react";
import { markCloudBootstrapPending, readCloudBackupQueueState } from "./cloudBackupQueue";
import { resetCloudOperationRunLockForTests } from "./cloudOperationRunLock";
import { checkSupabaseCloudOnboardingStatus, runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } from "./supabaseCloudOnboarding";
import { updateSupabaseAppRestoreBundle } from "./supabaseAppRestoreBundle";
import {
  ensureCurrentDeviceCanApplyLocalRestore,
  ensureCurrentDeviceCanWriteCloud,
  ensureDeviceFenceStillCurrent,
} from "./supabaseDeviceLock";
import { readSupabaseCloudConvergenceSnapshot } from "./supabaseCloudRestore";
import useCloudAutoBackup from "./useCloudAutoBackup";
import { STORAGE_KEYS } from "../constants/storageKeys";

jest.mock("./supabaseCloudOnboarding", () => {
  const actual = jest.requireActual("./supabaseCloudOnboarding");
  return { ...actual, checkSupabaseCloudOnboardingStatus: jest.fn(), runSupabaseCloudOnboardingBackup: jest.fn() };
});

jest.mock("./supabaseAppRestoreBundle", () => ({
  APP_RESTORE_BUNDLE_STATUS: { COMPLETED: "completed" },
  updateSupabaseAppRestoreBundle: jest.fn(),
}));

jest.mock("./supabaseCloudRestore", () => ({
  readSupabaseCloudConvergenceSnapshot: jest.fn(),
}));

// Only the ownership READS are stubbed; operationFenceStillCurrent stays real.
// The worker also takes an attempt-level generation before the backup chain and
// re-proves it at its clean boundary; both are authorized here so these tests
// reach the baseline capture, which is what they exist to prove.
jest.mock("./supabaseDeviceLock", () => ({
  ...jest.requireActual("./supabaseDeviceLock"),
  ensureCurrentDeviceCanApplyLocalRestore: jest.fn(),
  ensureCurrentDeviceCanWriteCloud: jest.fn(),
  ensureDeviceFenceStillCurrent: jest.fn(),
}));

const USER = { id: "user-1" };
const COMPANY = { id: "company-1" };

const fenceA5 = { companyId: "company-1", deviceId: "device-a", lockVersion: 5 };
const fenceA7 = { companyId: "company-1", deviceId: "device-a", lockVersion: 7 };
const fenceB6 = { companyId: "company-1", deviceId: "device-b", lockVersion: 6 };
const accessOk = (fence) => ({ ok: true, access: { isActive: true, isLocked: false, fence }, error: "" });

function baseProps(overrides = {}) {
  return {
    enabled: true,
    configured: true,
    user: USER,
    company: COMPANY,
    role: "owner",
    immediateDelayMs: 5,
    normalDelayMs: 5,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  resetCloudOperationRunLockForTests();
  runSupabaseCloudOnboardingBackup.mockReset();
  checkSupabaseCloudOnboardingStatus.mockReset();
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED,
    verification: { ok: true, allMatched: true, notices: [] },
  });
  updateSupabaseAppRestoreBundle.mockReset();
  updateSupabaseAppRestoreBundle.mockResolvedValue({ status: "completed", bundleUpdated: true });
  readSupabaseCloudConvergenceSnapshot.mockReset();
  readSupabaseCloudConvergenceSnapshot.mockResolvedValue({
    ok: true,
    mapped: { customers: [], projects: [], estimates: [], invoices: [] },
  });
  ensureCurrentDeviceCanApplyLocalRestore.mockReset();
  ensureCurrentDeviceCanWriteCloud.mockReset();
  ensureCurrentDeviceCanWriteCloud.mockResolvedValue(accessOk(fenceA5));
  ensureDeviceFenceStillCurrent.mockReset();
  ensureDeviceFenceStillCurrent.mockResolvedValue({ ok: true, code: "", deviceLockLost: false });
});

afterEach(() => {
  resetCloudOperationRunLockForTests();
});

function baselineRaw() {
  return localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE);
}

test("a same-owner heartbeat keeps the same generation and captures the baseline", async () => {
  // Positive control: without it, every assertion below would also pass on a
  // run that never reached the capture at all.
  ensureCurrentDeviceCanApplyLocalRestore.mockResolvedValue(accessOk(fenceA5));
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(baselineRaw()).toBeTruthy());
  expect(readSupabaseCloudConvergenceSnapshot).toHaveBeenCalled();
  expect(JSON.parse(baselineRaw()).companyId).toBe("company-1");

  unmount();
});

test("A(v5) -> B(v6) -> A(v7) cannot capture a verified baseline", async () => {
  // Active before the convergence read, active again after it -- but under a
  // generation this run never proved.
  ensureCurrentDeviceCanApplyLocalRestore
    .mockResolvedValueOnce(accessOk(fenceA5))
    .mockResolvedValue(accessOk(fenceA7));
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  // It reached the fenced boundary: the convergence read actually ran.
  await waitFor(() => expect(readSupabaseCloudConvergenceSnapshot).toHaveBeenCalledTimes(1));
  // FORBIDDEN: no durable "local equals cloud" claim, and the queue stays dirty.
  await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(true));
  expect(baselineRaw()).toBeNull();

  unmount();
});

test("a takeover reported as still-active cannot capture a verified baseline", async () => {
  ensureCurrentDeviceCanApplyLocalRestore
    .mockResolvedValueOnce(accessOk(fenceA5))
    .mockResolvedValue(accessOk(fenceB6));
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(readSupabaseCloudConvergenceSnapshot).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(true));
  expect(baselineRaw()).toBeNull();

  unmount();
});

test("an unprovable generation fails closed rather than capturing a baseline", async () => {
  // An ok access with no fence cannot prove anything, so it must not pass.
  ensureCurrentDeviceCanApplyLocalRestore.mockResolvedValue({
    ok: true,
    access: { isActive: true, isLocked: false },
    error: "",
  });
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(readSupabaseCloudConvergenceSnapshot).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(true));
  expect(baselineRaw()).toBeNull();

  unmount();
});
