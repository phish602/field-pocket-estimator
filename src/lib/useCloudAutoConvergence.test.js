import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react";
import useCloudAutoConvergence from "./useCloudAutoConvergence";
import { runSupabaseCloudConvergence, recoverInterruptedCloudConvergence } from "./supabaseCloudConvergence";
import { acquireCloudBackupRunLock, releaseCloudBackupRunLock, isCloudBackupRunLocked } from "./cloudBackupRunLock";

jest.mock("./supabaseCloudConvergence", () => {
  const actual = jest.requireActual("./supabaseCloudConvergence");
  return {
    ...actual,
    runSupabaseCloudConvergence: jest.fn(),
    recoverInterruptedCloudConvergence: jest.fn(),
  };
});

const ACTIVE_LOCK = { ready: true, loading: false, isActive: true, isLocked: false };
const props = (overrides = {}) => ({ configured: true, user: { id: "user-1" }, company: { id: "company-1" }, deviceLock: ACTIVE_LOCK, ...overrides });

beforeEach(() => {
  localStorage.clear();
  releaseCloudBackupRunLock();
  jest.clearAllMocks();
  recoverInterruptedCloudConvergence.mockReturnValue({ ok: true, recovered: false });
  runSupabaseCloudConvergence.mockResolvedValue({ ok: true, status: "matched" });
});

afterEach(() => releaseCloudBackupRunLock());

test("runs once for an authenticated, ready, active, unlocked device without user action", async () => {
  renderHook(() => useCloudAutoConvergence(props()));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
  expect(runSupabaseCloudConvergence).toHaveBeenCalledWith(expect.objectContaining({ configured: true, user: { id: "user-1" }, company: { id: "company-1" } }));
  expect(recoverInterruptedCloudConvergence).toHaveBeenCalled();
  expect(isCloudBackupRunLocked()).toBe(false); // lock released after the run
});

test("does not run until the device lock is ready and active", async () => {
  const { rerender } = renderHook((p) => useCloudAutoConvergence(p), {
    initialProps: props({ deviceLock: { ready: false, loading: true, isActive: false, isLocked: false } }),
  });
  await act(async () => { await Promise.resolve(); });
  expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();

  // Lock finishes loading and this device is the active owner -> now it runs.
  rerender(props({ deviceLock: ACTIVE_LOCK }));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
});

test("an inactive device never runs", async () => {
  renderHook(() => useCloudAutoConvergence(props({ deviceLock: { ready: true, loading: false, isActive: false, isLocked: false } })));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();
});

test("a locked device never runs", async () => {
  renderHook(() => useCloudAutoConvergence(props({ deviceLock: { ready: true, loading: false, isActive: true, isLocked: true } })));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();
});

test("a busy shared backup lock defers the attempt without permanently suppressing it", async () => {
  // The backup worker holds the lock.
  expect(acquireCloudBackupRunLock()).toBe(true);
  renderHook(() => useCloudAutoConvergence(props()));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(runSupabaseCloudConvergence).not.toHaveBeenCalled(); // deferred, not consumed

  // Lock frees up; a later lifecycle event runs the (still pending) attempt.
  releaseCloudBackupRunLock();
  act(() => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
});

test("window focus re-evaluates even when the local mutation revision has not changed", async () => {
  renderHook(() => useCloudAutoConvergence(props()));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
  act(() => { window.dispatchEvent(new Event("focus")); });
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2));
});

// Gate E2: one foreground action fires focus + pageshow + visibilitychange in
// quick succession. These PASSIVE signals must coalesce into ONE fresh scan.
test("a passive foreground burst (focus + pageshow + visibilitychange) within the window coalesces to one fresh run", async () => {
  renderHook(() => useCloudAutoConvergence(props({ foregroundBurstMs: 500 })));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1)); // mount

  act(() => {
    window.dispatchEvent(new Event("focus"));
    window.dispatchEvent(new Event("pageshow"));
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2));
  // The burst produced exactly one additional fresh scan, not three.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2);
});

// Freshness preserved: a genuinely separate foreground action after the window
// still performs a brand-new fresh read (this is NOT a stale cache).
test("a passive foreground after the burst window performs a new fresh run", async () => {
  renderHook(() => useCloudAutoConvergence(props({ foregroundBurstMs: 30 })));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1)); // mount

  act(() => { window.dispatchEvent(new Event("pageshow")); });
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2));

  await new Promise((resolve) => setTimeout(resolve, 50)); // let the burst window elapse
  act(() => { window.dispatchEvent(new Event("pageshow")); });
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(3));
});

// Online recovery must never be swallowed by the passive burst window.
test("online recovery bypasses passive burst suppression and runs fresh", async () => {
  renderHook(() => useCloudAutoConvergence(props({ foregroundBurstMs: 1000 })));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1)); // mount

  act(() => { window.dispatchEvent(new Event("focus")); }); // opens a 1s passive window
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2));

  act(() => { window.dispatchEvent(new Event("online")); }); // bypass -> fresh even inside the window
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(3));
});

// Multiple bypass signals during an active run collapse to at most ONE trailing run.
test("explicit/online requests during an active run schedule at most one fresh trailing run", async () => {
  let resolveFirst;
  runSupabaseCloudConvergence
    .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = () => resolve({ ok: true, status: "matched" }); }))
    .mockResolvedValue({ ok: true, status: "matched" });

  renderHook(() => useCloudAutoConvergence(props()));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1); // mount run in flight

  // Three bypass signals arrive while the first scan is still running.
  act(() => {
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
    window.dispatchEvent(new Event("online"));
  });
  expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1); // none started yet -- one scan in flight

  await act(async () => { resolveFirst(); await Promise.resolve(); await Promise.resolve(); });
  expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2); // exactly one trailing run
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2);
});

test("StrictMode double-mount does not create simultaneous runs", async () => {
  let resolveRun;
  runSupabaseCloudConvergence.mockImplementation(() => new Promise((resolve) => { resolveRun = () => resolve({ ok: true, status: "matched" }); }));
  renderHook(() => useCloudAutoConvergence(props()), { wrapper: React.StrictMode });
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1);
  await act(async () => { resolveRun?.(); });
});

test("an unresolved journal blocks the convergence run", async () => {
  recoverInterruptedCloudConvergence.mockReturnValue({ ok: false, code: "journal_rollback_failed" });
  renderHook(() => useCloudAutoConvergence(props()));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
  expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();
  expect(isCloudBackupRunLocked()).toBe(false);
});

test("a rolled-back convergence emits no success change events", async () => {
  runSupabaseCloudConvergence.mockResolvedValue({ ok: false, status: "rolled_back", code: "cloud_verification_failed" });
  const customersChanged = jest.fn();
  window.addEventListener("estipaid:customers-changed", customersChanged);
  renderHook(() => useCloudAutoConvergence(props()));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
  await act(async () => { await Promise.resolve(); });
  expect(customersChanged).not.toHaveBeenCalled();
  window.removeEventListener("estipaid:customers-changed", customersChanged);
});

test("a converged run dispatches change events only for the families that changed", async () => {
  runSupabaseCloudConvergence.mockResolvedValue({ ok: true, status: "converged", changedFamilies: { customers: true, invoices: true, estimates: false, projects: false, settings: false, companyProfile: false, scopeTemplates: false } });
  const customersChanged = jest.fn();
  const invoicesChanged = jest.fn();
  const estimatesChanged = jest.fn();
  window.addEventListener("estipaid:customers-changed", customersChanged);
  window.addEventListener("estipaid:invoices-changed", invoicesChanged);
  window.addEventListener("estipaid:estimates-changed", estimatesChanged);
  renderHook(() => useCloudAutoConvergence(props()));
  await waitFor(() => expect(customersChanged).toHaveBeenCalledTimes(1));
  expect(invoicesChanged).toHaveBeenCalledTimes(1);
  expect(estimatesChanged).not.toHaveBeenCalled();
  window.removeEventListener("estipaid:customers-changed", customersChanged);
  window.removeEventListener("estipaid:invoices-changed", invoicesChanged);
  window.removeEventListener("estipaid:estimates-changed", estimatesChanged);
});

const { CLOUD_CONVERGENCE_RESULT_EVENT } = require("./supabaseCloudConvergence");

test("dispatches a safe convergence-result event for a FAILED outcome (not only success)", async () => {
  runSupabaseCloudConvergence.mockResolvedValue({ ok: false, status: "rolled_back", code: "cloud_verification_failed", noCloudWritesPerformed: true, mismatch: { blockerCount: 0 } });
  const seen = jest.fn();
  window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, (e) => seen(e.detail));
  renderHook(() => useCloudAutoConvergence(props()));
  await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
  const detail = seen.mock.calls[0][0];
  expect(detail).toEqual(expect.objectContaining({ ok: false, status: "rolled_back", code: "cloud_verification_failed" }));
  // Only safe fields -- no names, numbers, descriptions, totals, or ids. The
  // Gate 16G sync-metadata fields are fixed codes, schema version strings and
  // booleans, so they belong to this closed allowlist too.
  expect(Object.keys(detail).sort()).toEqual([
    "at", "attempt", "baselineCompacted", "blockerCount", "bootstrapCode", "bootstrapDetailCode", "changedFamilies",
    "code", "conflictCount", "conflictSummary", "metadataRecoveryStage", "noCloudWritesPerformed", "noWritesPerformed",
    "ok", "pauseReason", "pauseRecovered", "queueSchemaAfter", "queueSchemaBefore", "retryable", "stage", "status",
  ]);
});

test("dispatches the result event for a converged outcome with only changed-family booleans", async () => {
  runSupabaseCloudConvergence.mockResolvedValue({ ok: true, status: "converged", changedFamilies: { invoices: true }, noCloudWritesPerformed: true });
  const seen = jest.fn();
  window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, (e) => seen(e.detail));
  renderHook(() => useCloudAutoConvergence(props()));
  await waitFor(() => expect(seen).toHaveBeenCalledTimes(1));
  expect(seen.mock.calls[0][0].changedFamilies).toEqual(expect.objectContaining({ invoices: true, customers: false }));
});

const { getLastCloudConvergenceResult, requestCloudConvergence } = require("./supabaseCloudConvergence");
const READY_UNVERIFIED = { ready: true, loading: false, isActive: false, isLocked: false };

test("a ready-but-unverified device re-reads ownership once and runs when it becomes active", async () => {
  const refresh = jest.fn(async () => ({ ready: true, loading: false, isActive: true, isLocked: false }));
  renderHook(() => useCloudAutoConvergence(props({ deviceLock: { ...READY_UNVERIFIED, refresh } })));
  await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
});

test("a ready-but-unverified device that stays unverified publishes device_access_unverified and does not run", async () => {
  const refresh = jest.fn(async () => ({ ...READY_UNVERIFIED }));
  const seen = jest.fn();
  window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, (e) => seen(e.detail));
  renderHook(() => useCloudAutoConvergence(props({ deviceLock: { ...READY_UNVERIFIED, refresh } })));
  await waitFor(() => expect(seen).toHaveBeenCalled());
  const detail = seen.mock.calls[seen.mock.calls.length - 1][0];
  expect(detail).toEqual(expect.objectContaining({ status: "skipped", code: "device_access_unverified", stage: "device_access", retryable: true }));
  expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();
  expect(refresh).toHaveBeenCalledTimes(1); // once per cycle, no takeover
});

test("a locked device publishes device_locked and performs no convergence", async () => {
  const seen = jest.fn();
  window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, (e) => seen(e.detail));
  renderHook(() => useCloudAutoConvergence(props({ deviceLock: { ready: true, loading: false, isActive: false, isLocked: true } })));
  await waitFor(() => expect(seen).toHaveBeenCalled());
  expect(seen.mock.calls.some((c) => c[0].code === "device_locked" && c[0].retryable === false)).toBe(true);
  expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();
});

test("offline publishes a retryable offline result and does not run", async () => {
  const spy = jest.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
  const seen = jest.fn();
  window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, (e) => seen(e.detail));
  renderHook(() => useCloudAutoConvergence(props()));
  await waitFor(() => expect(seen).toHaveBeenCalled());
  expect(seen.mock.calls.some((c) => c[0].code === "offline" && c[0].retryable === true && c[0].stage === "eligibility")).toBe(true);
  expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();
  spy.mockRestore();
});

test("a busy shared lock retries on a bounded timer and later succeeds without any focus event", async () => {
  jest.useFakeTimers();
  try {
    acquireCloudBackupRunLock(); // worker holds the lock
    renderHook(() => useCloudAutoConvergence(props()));
    await Promise.resolve(); await Promise.resolve();
    expect(runSupabaseCloudConvergence).not.toHaveBeenCalled();
    // Free the lock, then let the bounded retry (1s) fire -- no lifecycle event.
    releaseCloudBackupRunLock();
    await act(async () => { jest.advanceTimersByTime(1000); await Promise.resolve(); await Promise.resolve(); });
    expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1);
  } finally {
    jest.useRealTimers();
  }
});

test("an explicit convergence request starts a fresh attempt cycle", async () => {
  renderHook(() => useCloudAutoConvergence(props()));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
  act(() => { requestCloudConvergence(); });
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2));
});

// Gate E2.2 freshness fix: a genuine foreground that arrives AFTER the burst
// window has expired, while an older convergence is still running, must not be
// discarded -- it schedules exactly one trailing fresh run (never concurrent).
test("a genuine passive foreground after the expired burst window schedules exactly one trailing run while an older convergence is still in flight", async () => {
  let n = 0;
  let resolveInFlight;
  runSupabaseCloudConvergence.mockImplementation(() => {
    n += 1;
    // The SECOND run (the focus-started one) stays unresolved to model a long
    // in-flight convergence; all others resolve immediately.
    if (n === 2) return new Promise((resolve) => { resolveInFlight = () => resolve({ ok: true, status: "matched" }); });
    return Promise.resolve({ ok: true, status: "matched" });
  });

  renderHook(() => useCloudAutoConvergence(props({ foregroundBurstMs: 30 })));
  // (mount) run 1 resolves immediately.
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));

  // Start a long in-flight convergence via a passive foreground (opens the burst
  // window), and (2) fire same-burst signals that must be suppressed (no trailing).
  act(() => {
    window.dispatchEvent(new Event("focus"));               // opens window + starts run 2 (deferred)
    window.dispatchEvent(new Event("pageshow"));             // same burst -> suppressed
    document.dispatchEvent(new Event("visibilitychange"));   // same burst -> suppressed
  });
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2));
  // (1) run 2 remains unresolved; (2) same-burst signals scheduled no trailing.
  await act(async () => { await Promise.resolve(); });
  expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2);

  // (3) Let the burst window elapse while run 2 is STILL unresolved.
  await new Promise((resolve) => setTimeout(resolve, 50));

  // (4) A genuine later foreground schedules exactly one trailing run, and
  // (5) additional passive events inside the new window are coalesced.
  act(() => {
    window.dispatchEvent(new Event("focus"));               // window expired + in flight -> one trailing
    window.dispatchEvent(new Event("pageshow"));             // new-burst -> coalesced
    document.dispatchEvent(new Event("visibilitychange"));   // new-burst -> coalesced
  });
  await act(async () => { await Promise.resolve(); });
  // Trailing is deferred until run 2 settles -> still 2 (no concurrent run).
  expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2);

  // (6) The old convergence resolves -> (7) exactly one trailing fresh run starts.
  await act(async () => { resolveInFlight(); await Promise.resolve(); await Promise.resolve(); });
  expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(3);

  // (8) No concurrency and no further runs afterward.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(3);
});
