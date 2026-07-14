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

test("pageshow, visibilitychange, and online each re-trigger a run", async () => {
  renderHook(() => useCloudAutoConvergence(props()));
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));

  act(() => { window.dispatchEvent(new Event("pageshow")); });
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(2));

  act(() => { window.dispatchEvent(new Event("online")); });
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(3));

  // visibilitychange only re-triggers when the document is visible.
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(4));
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
  // Only safe fields -- no names, numbers, descriptions, totals, or ids.
  expect(Object.keys(detail).sort()).toEqual(["at", "attempt", "blockerCount", "changedFamilies", "code", "conflictCount", "noCloudWritesPerformed", "noWritesPerformed", "ok", "retryable", "stage", "status"]);
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
