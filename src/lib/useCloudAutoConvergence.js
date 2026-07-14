// @ts-nocheck
/* eslint-disable */

import { useEffect, useRef } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { acquireCloudBackupRunLock, releaseCloudBackupRunLock } from "./cloudBackupRunLock";
import { runSupabaseCloudConvergence, recoverInterruptedCloudConvergence, recordCloudConvergenceResult } from "./supabaseCloudConvergence";

function online() { try { return typeof navigator === "undefined" || navigator.onLine !== false; } catch { return true; } }

// Eligibility is intentionally strict: automatic convergence runs only for the
// active, unlocked owning device once its lock has finished loading. This is NOT
// keyed on the local mutation revision -- a remote-only change (no pending local
// backup) must still be allowed to trigger a re-evaluation.
function isConvergenceEligible({ configured, user, company, deviceLock }) {
  return Boolean(
    configured &&
    user?.id &&
    company?.id &&
    online() &&
    deviceLock &&
    deviceLock.ready === true &&
    deviceLock.loading === false &&
    deviceLock.isActive === true &&
    deviceLock.isLocked === false
  );
}

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
  // double-mount and coincident focus/visibility events) WITHOUT permanently
  // suppressing future attempts -- there is no persistent "attempted" set.
  const inFlightRef = useRef(false);
  // Latest props, so lifecycle listeners registered once always see current state.
  const stateRef = useRef({ configured, user, company, deviceLock });
  stateRef.current = { configured, user, company, deviceLock };

  useEffect(() => {
    let disposed = false;

    const runOnce = async () => {
      if (disposed || inFlightRef.current) return;
      if (!isConvergenceEligible(stateRef.current)) return;
      inFlightRef.current = true;
      try {
        const { configured: cfg, user: usr, company: cmp } = stateRef.current;
        // Recover an interrupted journal BEFORE the attempt is acted on; a failed
        // recovery must not permanently suppress future attempts.
        const recovered = recoverInterruptedCloudConvergence({ storage: localStorage });
        if (!recovered.ok || disposed) return;
        // The shared backup lock gates against the backup worker. If it is busy,
        // exit safely and let a later lifecycle event / dependency change retry.
        if (!acquireCloudBackupRunLock()) return;
        try {
          const result = await runSupabaseCloudConvergence({ storage: localStorage, configured: cfg, user: usr, company: cmp });
          if (disposed) return;
          // Surface EVERY outcome to status surfaces via the safe result event.
          recordCloudConvergenceResult(result);
          // Only a verified success dispatches family-change events (and only for
          // families that actually changed) -- never for rolled-back work.
          if (result?.ok && (result.status === "converged" || result.status === "matched")) {
            dispatchConvergenceChangeEvents(result);
          }
        } finally {
          releaseCloudBackupRunLock();
        }
      } finally {
        inFlightRef.current = false;
      }
    };

    // Defer to a microtask so StrictMode's synchronous mount/cleanup/mount cannot
    // start two overlapping runs, and so the run never blocks render.
    const schedule = () => { Promise.resolve().then(() => { if (!disposed) runOnce(); }); };

    const onVisibility = () => { if (typeof document === "undefined" || document.visibilityState === "visible") schedule(); };

    // Run on mount / whenever the device lock becomes ready + active.
    schedule();

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("focus", schedule);
      window.addEventListener("pageshow", schedule);
      window.addEventListener("online", schedule);
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onVisibility);
      }
    }

    return () => {
      disposed = true;
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", schedule);
        window.removeEventListener("pageshow", schedule);
        window.removeEventListener("online", schedule);
        if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", onVisibility);
        }
      }
    };
  }, [configured, user?.id, company?.id, deviceLock?.ready, deviceLock?.loading, deviceLock?.isActive, deviceLock?.isLocked]);
}
