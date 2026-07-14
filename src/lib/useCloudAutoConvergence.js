// @ts-nocheck
/* eslint-disable */

import { useEffect, useRef } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { acquireCloudBackupRunLock, releaseCloudBackupRunLock } from "./cloudBackupRunLock";
import {
  runSupabaseCloudConvergence,
  recoverInterruptedCloudConvergence,
  recordCloudConvergenceResult,
  CLOUD_CONVERGENCE_REQUEST_EVENT,
} from "./supabaseCloudConvergence";

// Bounded automatic retry for TEMPORARY failures only (never conflicts, deletion
// ambiguity, malformed cloud data, or critical rollback failures).
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

function online() { try { return typeof navigator === "undefined" || navigator.onLine !== false; } catch { return true; } }

// After a verified local convergence (and only after the journal is cleared),
// refresh exactly the screens whose families changed -- no full browser reload,
// and no success events for rolled-back work.
function dispatchConvergenceChangeEvents(result) {
  const changed = result?.changedFamilies;
  if (!changed || typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  try {
    if (changed.customers) window.dispatchEvent(new Event("estipaid:customers-changed"));
    if (changed.projects) window.dispatchEvent(new Event("estipaid:projects-changed"));
    if (changed.invoices) window.dispatchEvent(new Event("estipaid:invoices-changed"));
    if (changed.estimates) window.dispatchEvent(new Event("estipaid:estimates-changed"));
    if (changed.settings) window.dispatchEvent(new Event("estipaid:settings-changed"));
    if (changed.companyProfile) window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: STORAGE_KEYS.COMPANY_PROFILE, value: localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE) } }));
    if (changed.scopeTemplates) window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: STORAGE_KEYS.SCOPE_TEMPLATES, value: localStorage.getItem(STORAGE_KEYS.SCOPE_TEMPLATES) } }));
  } catch {}
}

export default function useCloudAutoConvergence({ configured = false, user = null, company = null, deviceLock = null } = {}) {
  // One in-flight promise prevents simultaneous duplicate runs (incl. StrictMode
  // double-mount and coincident lifecycle events) WITHOUT permanently suppressing
  // future attempts -- there is no persistent "attempted" set.
  const inFlightRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef(null);
  // Once-per-cycle guard so device recovery calls deviceLock.refresh() at most
  // once before a fresh trigger resets the cycle.
  const refreshedThisCycleRef = useRef(false);
  // Dedupe identical consecutive transient publishes so a re-render or heartbeat
  // does not spam the status surfaces with the same loading/transient result.
  const lastKeyRef = useRef("");
  const stateRef = useRef({ configured, user, company, deviceLock });
  stateRef.current = { configured, user, company, deviceLock };

  useEffect(() => {
    let disposed = false;

    const clearRetry = () => {
      if (retryTimerRef.current) { clearTimeout(retryTimerRef.current); retryTimerRef.current = null; }
    };

    // Records a safe outcome. Transient outcomes identical to the last publish are
    // suppressed; terminal (non-retryable) and successful outcomes always publish.
    const record = (outcome) => {
      if (disposed) return;
      const key = `${outcome.status}:${outcome.code}:${outcome.stage}`;
      if (outcome.retryable && key === lastKeyRef.current) return;
      lastKeyRef.current = key;
      recordCloudConvergenceResult({ ...outcome, attempt: retryCountRef.current });
    };

    const scheduleRetry = () => {
      if (disposed || retryTimerRef.current) return;
      if (retryCountRef.current >= MAX_RETRIES) return; // budget exhausted this cycle
      const delay = RETRY_DELAYS_MS[Math.min(retryCountRef.current, RETRY_DELAYS_MS.length - 1)];
      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null;
        runOnce();
      }, delay);
    };

    const runOnce = async ({ fresh = false } = {}) => {
      if (disposed || inFlightRef.current) return;
      // A fresh cycle (mount, focus, pageshow, visibility, online, explicit
      // request) resets the retry budget and the once-per-cycle refresh guard.
      if (fresh) { retryCountRef.current = 0; refreshedThisCycleRef.current = false; lastKeyRef.current = ""; clearRetry(); }
      inFlightRef.current = true;
      try {
        const { configured: cfg, user: usr, company: cmp, deviceLock: lock } = stateRef.current;

        if (!cfg || !usr?.id || !cmp?.id) { record({ status: "skipped", code: "prerequisites_missing", stage: "eligibility", retryable: false }); return; }
        if (!online()) { record({ status: "skipped", code: "offline", stage: "eligibility", retryable: true }); scheduleRetry(); return; }
        if (!lock || lock.ready !== true || lock.loading === true) { record({ status: "skipped", code: "device_lock_loading", stage: "eligibility", retryable: true }); scheduleRetry(); return; }
        if (lock.isLocked === true) { record({ status: "skipped", code: "device_locked", stage: "device_access", retryable: false }); return; }

        // Device-state recovery WITHOUT takeover: a ready, unlocked, but inactive
        // device re-reads ownership once (deviceLock.refresh performs a non-force
        // claim only when no active-device row exists). It must never takeover.
        let activeLock = lock;
        if (lock.isActive !== true) {
          if (refreshedThisCycleRef.current || typeof lock.refresh !== "function") {
            record({ status: "skipped", code: "device_access_unverified", stage: "device_access", retryable: true });
            scheduleRetry(); return;
          }
          refreshedThisCycleRef.current = true;
          let refreshed = null;
          try { refreshed = await lock.refresh(); } catch { refreshed = null; }
          if (disposed) return;
          activeLock = refreshed || lock;
          if (activeLock.isLocked === true) { record({ status: "skipped", code: "device_locked", stage: "device_access", retryable: false }); return; }
          if (activeLock.isActive !== true) {
            record({ status: "skipped", code: "device_access_unverified", stage: "device_access", retryable: true });
            scheduleRetry(); return;
          }
        }

        // Recover an interrupted journal BEFORE acting; a failed recovery is a
        // critical (non-retryable) local-recovery situation, not a transient skip.
        const recovered = recoverInterruptedCloudConvergence({ storage: localStorage });
        if (!recovered.ok) { record({ status: "critical", code: recovered.code || "unresolved_journal", stage: "journal_recovery", retryable: false }); return; }
        if (disposed) return;

        // The shared backup lock gates against the backup worker. A busy lock is a
        // transient miss that must receive a bounded retry -- never abandonment.
        if (!acquireCloudBackupRunLock()) {
          record({ status: "skipped", code: "run_lock_busy", stage: "run_lock", retryable: true });
          scheduleRetry(); return;
        }
        try {
          const result = await runSupabaseCloudConvergence({ storage: localStorage, configured: cfg, user: usr, company: cmp });
          if (disposed) return;
          lastKeyRef.current = `${result?.status}:${result?.code || ""}`;
          recordCloudConvergenceResult({ ...result, attempt: retryCountRef.current });
          if (result?.ok && (result.status === "converged" || result.status === "matched")) {
            clearRetry();
            dispatchConvergenceChangeEvents(result);
          }
        } finally {
          releaseCloudBackupRunLock();
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    const scheduleFresh = () => { Promise.resolve().then(() => { if (!disposed) runOnce({ fresh: true }); }); };
    const onVisibility = () => { if (typeof document === "undefined" || document.visibilityState === "visible") scheduleFresh(); };

    // Run on mount / whenever the device lock becomes ready + active.
    scheduleFresh();

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("focus", scheduleFresh);
      window.addEventListener("pageshow", scheduleFresh);
      window.addEventListener("online", scheduleFresh);
      window.addEventListener(CLOUD_CONVERGENCE_REQUEST_EVENT, scheduleFresh);
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onVisibility);
      }
    }

    return () => {
      disposed = true;
      clearRetry();
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", scheduleFresh);
        window.removeEventListener("pageshow", scheduleFresh);
        window.removeEventListener("online", scheduleFresh);
        window.removeEventListener(CLOUD_CONVERGENCE_REQUEST_EVENT, scheduleFresh);
        if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", onVisibility);
        }
      }
    };
  }, [configured, user?.id, company?.id, deviceLock?.ready, deviceLock?.loading, deviceLock?.isActive, deviceLock?.isLocked]);
}
