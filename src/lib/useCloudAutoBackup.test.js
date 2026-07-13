import { act, renderHook, waitFor } from "@testing-library/react";
import {
  markCloudBackupDirty,
  clearCloudBackupDirty,
  pauseCloudAutoBackup,
  recordCloudBackupAttemptFailure,
  readCloudBackupQueueState,
  CLOUD_BACKUP_STATUS,
} from "./cloudBackupQueue";
import { releaseCloudBackupRunLock, acquireCloudBackupRunLock } from "./cloudBackupRunLock";
import { runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } from "./supabaseCloudOnboarding";
import useCloudAutoBackup from "./useCloudAutoBackup";

jest.mock("./supabaseCloudOnboarding", () => {
  const actual = jest.requireActual("./supabaseCloudOnboarding");
  return {
    ...actual,
    runSupabaseCloudOnboardingBackup: jest.fn(),
  };
});

const USER = { id: "user-1" };
const COMPANY = { id: "company-1" };
const FAST_DELAYS = { immediateDelayMs: 5, normalDelayMs: 15 };

function baseProps(overrides = {}) {
  return {
    enabled: true,
    configured: true,
    user: USER,
    company: COMPANY,
    role: "owner",
    ...FAST_DELAYS,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  releaseCloudBackupRunLock();
  runSupabaseCloudOnboardingBackup.mockReset();
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED });
});

afterEach(() => {
  releaseCloudBackupRunLock();
});

test("pending normal-priority queue schedules and runs an automatic backup", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(
    expect.objectContaining({ configured: true, user: USER, company: COMPANY, role: "owner" })
  );

  unmount();
});

test("money-critical/immediate queue runs faster than normal-priority", async () => {
  markCloudBackupDirty({ reason: "invoice_saved", severity: "money_critical" });

  const start = Date.now();
  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ immediateDelayMs: 5, normalDelayMs: 500 })));

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  expect(Date.now() - start).toBeLessThan(500);

  unmount();
});

test("no pending queue does not run a backup", async () => {
  clearCloudBackupDirty("test_setup");

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  unmount();
});

test("an unresolved convergence journal blocks automatic cloud backup", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });
  localStorage.setItem("estipaid-cloud-convergence-journal-v1", JSON.stringify({ version: 1, previous: {} }));
  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  unmount();
});

test("signed-out state (enabled=false) does not run a backup", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ enabled: false })));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  unmount();
});

test("Supabase not configured does not run a backup", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ configured: false })));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  unmount();
});

test("missing company/workspace context does not run a backup", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ company: null })));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  unmount();
});

test("backup success clears the queue back to current", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });
  runSupabaseCloudOnboardingBackup.mockImplementation(async () => {
    clearCloudBackupDirty("manual_backup_success");
    return { status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED };
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(false));
  expect(readCloudBackupQueueState().status).toBe(CLOUD_BACKUP_STATUS.CURRENT);

  unmount();
});

test("backup failure records the failure and keeps the queue pending", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
    error: "Unable to complete cloud backup.",
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(readCloudBackupQueueState().status).toBe(CLOUD_BACKUP_STATUS.FAILED));
  const state = readCloudBackupQueueState();
  expect(state.pending).toBe(true);
  expect(state.attempts).toBeGreaterThan(0);
  expect(state.lastError).toBeTruthy();

  unmount();
});

test("a fresh bundle automatically recovers one pending NEEDS_ATTENTION item without a Retry Sync click", async () => {
  markCloudBackupDirty({ reason: "stale_invoice_duplicate", severity: "money_critical" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: true, status: CLOUD_BACKUP_STATUS.NEEDS_ATTENTION, lastError: "previous browser delete path failed" }));

  const localRecords = { customers: "local-customers", projects: "local-projects", estimates: "local-estimates", invoices: "local-invoices" };
  Object.entries(localRecords).forEach(([key, value]) => localStorage.setItem(key, value));
  runSupabaseCloudOnboardingBackup.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED,
    writeResult: { staleInvoiceLineItemRepair: { ok: true, repaired: 2 } },
    verification: { ok: true },
    noLocalDeletes: true,
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: false, status: CLOUD_BACKUP_STATUS.CURRENT })));
  await new Promise((resolve) => setTimeout(resolve, 40));

  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1);
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({ user: USER, company: COMPANY, role: "owner" }));
  Object.entries(localRecords).forEach(([key, value]) => expect(localStorage.getItem(key)).toBe(value));
  unmount();
});

test("failed fresh-bundle NEEDS_ATTENTION recovery remains pending without a same-session retry loop", async () => {
  markCloudBackupDirty({ reason: "stale_invoice_duplicate", severity: "money_critical" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, error: "server repair unavailable" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: true, status: CLOUD_BACKUP_STATUS.NEEDS_ATTENTION, lastError: "server repair unavailable" })));
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1);
  unmount();
});

test("device-lock abort leaves the pending queue untouched instead of recording a backup failure", async () => {
  markCloudBackupDirty({ reason: "invoice_saved", severity: "money_critical" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
    deviceLockLost: true,
    error: "Backup stopped because EstiPaid was switched to another device.",
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));

  expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({
    pending: true,
    attempts: 0,
    lastError: "",
  }));
  unmount();
});

test("a mutation during upload schedules one follow-up backup after the first completes", async () => {
  markCloudBackupDirty({ reason: "invoice_saved", severity: "money_critical" });
  let resolveBackup;
  runSupabaseCloudOnboardingBackup.mockImplementation(
    () => new Promise((resolve) => { resolveBackup = resolve; })
  );

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));

  // A second dirty event arrives while the first attempt is still in flight.
  markCloudBackupDirty({ reason: "invoice_saved", severity: "money_critical" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1);

  resolveBackup({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED });
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(2));
  unmount();
});

test("pending queue resumes on hook remount", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION });

  const first = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  first.unmount();

  const second = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(2), { timeout: 3000 });
  second.unmount();
});

test("browser online event retries a pending queue", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ normalDelayMs: 100000 })));

  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  act(() => {
    window.dispatchEvent(new Event("online"));
  });

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));

  unmount();
});

test("offline mutation remains safely queued until connectivity returns", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  markCloudBackupDirty({ reason: "invoice_saved", severity: "money_critical" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(readCloudBackupQueueState().status).toBe("offline_pending"));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));

  if (descriptor) Object.defineProperty(navigator, "onLine", descriptor);
  unmount();
});

test("deferred-priority queue does not auto-run even when pending", async () => {
  markCloudBackupDirty({ reason: "low_priority_change", severity: "low", priority: "deferred" });
  expect(readCloudBackupQueueState().priority).toBe("deferred");

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  unmount();
});

test("does not run while a manual backup already holds the shared run lock", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });
  expect(acquireCloudBackupRunLock()).toBe(true);

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  releaseCloudBackupRunLock();
  unmount();
});

test("takeover pause blocks automatic backup until a fresh local change re-dirties the queue", async () => {
  markCloudBackupDirty({ reason: "project_saved", severity: "normal" });
  pauseCloudAutoBackup("device_takeover");

  const hook = renderHook(() => useCloudAutoBackup(baseProps()));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  markCloudBackupDirty({ reason: "estimate_saved_after_takeover", severity: "normal" });

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  hook.unmount();
});

test("a permanent identity conflict stops automatic retries and remains review-required", async () => {
  markCloudBackupDirty({ reason: "invoice_saved", severity: "money_critical" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
    permanentIdentityConflict: true,
    syncReviewState: "conflict",
    reason: "Cloud records require identity review.",
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudBackupQueueState().status).toBe(CLOUD_BACKUP_STATUS.CONFLICT));
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1);
  unmount();
});
