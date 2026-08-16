// @ts-nocheck
/* eslint-disable */

import { useEffect, useRef } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { buildLocalSnapshotFromStorage } from "./localDataIntegrity";
import { tryAcquireCloudOperationRunLock, releaseCloudOperationRunLock } from "./cloudOperationRunLock";
import {
  markCloudBackupDirty,
  readCloudBackupQueueState,
  CLOUD_BACKUP_SEVERITY,
  CLOUD_BACKUP_PRIORITY,
} from "./cloudBackupQueue";
import { STALE_INVOICE_LINE_ITEM_PLACEHOLDER_REPAIR } from "./supabaseCloudVerification";
import {
  CLOUD_OPERATION_OWNER,
  resolveOperationOwnerFromSnapshot,
} from "./cloudOperationOwnership";
import {
  runSupabaseCloudConvergence,
  recoverInterruptedCloudConvergence,
  recordCloudConvergenceResult,
  CLOUD_CONVERGENCE_REQUEST_EVENT,
} from "./supabaseCloudConvergence";
import { getOrCreateLocalDeviceId } from "./supabaseDeviceLock";

// Bounded automatic retry for TEMPORARY failures only (never conflicts, deletion
// ambiguity, malformed cloud data, or critical rollback failures).
const RETRY_DELAYS_MS = [1000, 3000, 7000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;

// Gate E2 -- passive lifecycle-burst coalescing window. A single foreground
// action (alt-tab, unminimize) can fire focus + pageshow + visibilitychange in
// quick succession; each previously triggered its own full cloud scan. This
// window coalesces that PASSIVE burst into ONE fresh convergence read. It is a
// leading-edge suppressor, not a cache: the first passive signal reads fresh
// immediately, and any passive signal after the window still reads fresh. It
// must stay <= 1s so real cross-device foreground checks are never withheld.
// Explicit convergence requests and online-recovery always bypass it.
export const CLOUD_CONVERGENCE_FOREGROUND_BURST_MS = 1000;

function online() { try { return typeof navigator === "undefined" || navigator.onLine !== false; } catch { return true; } }

// Which automatic actor owns the next cloud operation. The precedence RULE lives
// in the shared cloudOperationOwnership contract, which auto-backup, onboarding
// and the restore prompt consume too, so no actor can invent its own order. This
// reads the same existing local model used by recovery eligibility plus the
// existing backup queue; it neither reaches Supabase nor changes storage/queue
// state.
function resolveLocalOperationOwner(storage) {
  try {
    const { snapshot } = buildLocalSnapshotFromStorage(storage);
    return resolveOperationOwnerFromSnapshot({ snapshot, queueState: readCloudBackupQueueState() });
  } catch {
    // A malformed/unreadable local snapshot must retain the established safe
    // convergence behavior rather than silently suppressing recovery checks.
    return CLOUD_OPERATION_OWNER.CONVERGENCE;
  }
}

// Reason marker for the ONE queue entry an automatically-repairable mismatch
// creates. It is a normal money-critical backup request -- the existing auto
// backup worker drains it through the existing migration writer, which is where
// the proven stale-child repair already lives.
export const STALE_INVOICE_LINE_ITEM_REPAIR_QUEUE_REASON = "stale_invoice_line_item_placeholder_repair";

// Convergence NEVER writes to the cloud. When verification proves the entire
// mismatch is the repairable blank-invoice-child class, the only action taken
// here is enqueuing existing backup work, exactly as a normal user edit would.
// Returns true when a queue entry was created.
export function requestStaleInvoiceLineItemRepairBackup(result) {
  const mismatch = result?.mismatch;
  if (result?.status !== "mismatch" || result?.code !== "verification_mismatch") return false;
  if (mismatch?.repairableMismatchOnly !== true) return false;
  const repairTypes = Array.isArray(mismatch?.repairTypes) ? mismatch.repairTypes : [];
  if (!repairTypes.includes(STALE_INVOICE_LINE_ITEM_PLACEHOLDER_REPAIR)) return false;
  // Loop protection via the EXISTING queue: if a generation carrying this exact
  // repair reason is still pending, the worker has not drained it yet and a
  // second identical request would only churn the queue revision.
  try {
    const queue = readCloudBackupQueueState();
    if (queue?.pending && Array.isArray(queue?.reasons)
      && queue.reasons.includes(STALE_INVOICE_LINE_ITEM_REPAIR_QUEUE_REASON)) {
      return false;
    }
  } catch { return false; }
  markCloudBackupDirty({
    reason: STALE_INVOICE_LINE_ITEM_REPAIR_QUEUE_REASON,
    domains: ["invoices", "invoice_line_items"],
    severity: CLOUD_BACKUP_SEVERITY.MONEY_CRITICAL,
    priority: CLOUD_BACKUP_PRIORITY.IMMEDIATE,
    source: "cloud_convergence_repairable_mismatch",
  });
  return true;
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

export default function useCloudAutoConvergence({ configured = false, user = null, company = null, deviceLock = null, foregroundBurstMs = CLOUD_CONVERGENCE_FOREGROUND_BURST_MS } = {}) {
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
  // At most one automatic repair-backup request per repair cycle; cleared once a
  // convergence cycle settles matched/converged.
  const repairQueuedRef = useRef(false);
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

        // ONE shared precedence decision for this scan.
        const operationOwner = resolveLocalOperationOwner(localStorage);

        // Fresh-device startup ownership: automatic convergence must never
        // acquire the shared run lock before the existing recovery path has
        // had a chance to hydrate an empty core snapshot. Recovery explicitly
        // requests convergence after a successful local apply, at which point
        // this condition is no longer true and the normal path resumes.
        //
        // Note the shared contract already ranked a pending local mutation ABOVE
        // an empty core, so a user who just deleted their last document reaches
        // the backup branch below instead of being mistaken for a fresh device.
        if (operationOwner === CLOUD_OPERATION_OWNER.RECOVERY) {
          record({ status: "skipped", code: "fresh_device_recovery_pending", stage: "startup_ownership", retryable: false });
          return;
        }

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
        const recovered = recoverInterruptedCloudConvergence({
          storage: localStorage,
          companyId: cmp.id,
          userId: usr.id,
          deviceId: getOrCreateLocalDeviceId(localStorage),
        });
        if (!recovered.ok) { record({ status: "critical", code: recovered.code || "unresolved_journal", stage: "journal_recovery", retryable: false }); return; }
        if (disposed) return;

        // Pending local work outranks convergence: yield BEFORE touching the
        // shared run lock so the existing backup worker keeps its turn. This sits
        // after journal recovery on purpose -- the backup worker refuses to run
        // while an unresolved convergence journal exists, so yielding any earlier
        // would leave that journal with nobody to recover it.
        if (operationOwner === CLOUD_OPERATION_OWNER.BACKUP) {
          record({ status: "skipped", code: "local_backup_pending", stage: "operation_ownership", retryable: true });
          scheduleRetry(); return;
        }

        // The shared operation lock gates against the backup and restore actors.
        // A busy lock is a transient miss that must receive a bounded retry --
        // never abandonment.
        const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.CONVERGENCE);
        if (!lease) {
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
            // A settled cycle re-arms the repair bridge, so a genuinely new
            // repairable mismatch later can still queue exactly one request.
            repairQueuedRef.current = false;
          } else if (!repairQueuedRef.current && requestStaleInvoiceLineItemRepairBackup(result)) {
            // One queue entry per repair cycle. The existing auto-backup worker
            // picks it up and runs the existing writer + server repair path.
            repairQueuedRef.current = true;
          }
        } finally {
          // Releases only THIS scan's lease, so a late unwind can never unlock a
          // newer operation that has since acquired the mutex.
          releaseCloudOperationRunLock(lease);
        }
      } finally {
        inFlightRef.current = false;
        // At most ONE trailing fresh run: an explicit/online request that arrived
        // while this scan was already in flight may have needed newer data than
        // this run started with. Passive lifecycle signals never set this (they
        // are already represented by the run that was in flight).
        if (!disposed && trailingFreshScheduled) {
          trailingFreshScheduled = false;
          Promise.resolve().then(() => { if (!disposed) runOnce({ fresh: true }); });
        }
      }
    };

    // Gate E2 coalescing state. `passiveBurstUntil` is a timestamp: passive
    // lifecycle signals before it are folded into the burst that already ran a
    // fresh read. `trailingFreshScheduled` caps deferred bypass work at one run.
    let passiveBurstUntil = 0;
    let trailingFreshScheduled = false;

    // Initial convergence (mount / device-lock becomes ready+active). Runs fresh
    // immediately and does NOT open a passive-suppression window, so a genuine
    // foreground action right after mount still reads fresh.
    const scheduleInitialFresh = () => {
      if (disposed || inFlightRef.current) return;
      Promise.resolve().then(() => { if (!disposed) runOnce({ fresh: true }); });
    };

    // PASSIVE foreground signals: focus / pageshow / visibilitychange. Leading
    // edge -- the first opens a short window; identical signals inside that
    // window (the same alt-tab burst) are coalesced away.
    //
    // Gate E2.2 freshness fix: the burst window is checked BEFORE the in-flight
    // guard. If the window has already expired while an older convergence is
    // still running, a genuine later foreground is NOT discarded -- it opens a
    // new window and schedules exactly ONE trailing fresh run for when the older
    // run settles (never a concurrent run). Additional passive signals inside
    // the new window are coalesced. This is not a cache and reuses no snapshot.
    const schedulePassiveFresh = () => {
      if (disposed) return;
      if (Date.now() < passiveBurstUntil) return; // coalesced into the current burst window
      passiveBurstUntil = Date.now() + foregroundBurstMs; // genuine new foreground -> new window
      if (inFlightRef.current) { trailingFreshScheduled = true; return; } // one trailing after the in-flight run
      Promise.resolve().then(() => { if (!disposed) runOnce({ fresh: true }); });
    };

    // BYPASS signals: explicit convergence request / online recovery. Never
    // suppressed by the passive window. If a run is already in flight, schedule
    // exactly one trailing fresh run; otherwise run immediately. Either way the
    // window is (re)opened so a passive signal in its wake is coalesced.
    const scheduleBypassFresh = () => {
      if (disposed) return;
      passiveBurstUntil = Date.now() + foregroundBurstMs;
      if (inFlightRef.current) { trailingFreshScheduled = true; return; }
      Promise.resolve().then(() => { if (!disposed) runOnce({ fresh: true }); });
    };

    const onFocus = () => schedulePassiveFresh();
    const onPageShow = () => schedulePassiveFresh();
    const onOnline = () => scheduleBypassFresh();
    const onExplicitRequest = () => scheduleBypassFresh();
    // A backup attempt can classify its pending generation as `remote_changed`
    // after this hook has already yielded to BACKUP. Queue writes already publish
    // this app-local event; consume that terminal transition directly rather than
    // waiting for a focus/reload after the bounded pending-backup retry budget.
    // The next scan still asks the shared ownership rule, so ordinary pending
    // writes, true conflicts, and empty-device deletion safety stay unchanged.
    const onCloudBackupQueueChanged = (event) => {
      if (event?.detail?.key !== STORAGE_KEYS.CLOUD_BACKUP_QUEUE) return;
      if (String(readCloudBackupQueueState()?.status || "") !== "remote_changed") return;
      scheduleBypassFresh();
    };
    const onVisibility = () => { if (typeof document === "undefined" || document.visibilityState === "visible") schedulePassiveFresh(); };

    // Run on mount / whenever the device lock becomes ready + active.
    scheduleInitialFresh();

    if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
      window.addEventListener("focus", onFocus);
      window.addEventListener("pageshow", onPageShow);
      window.addEventListener("online", onOnline);
      window.addEventListener(CLOUD_CONVERGENCE_REQUEST_EVENT, onExplicitRequest);
      window.addEventListener("pe-localstorage", onCloudBackupQueueChanged);
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        document.addEventListener("visibilitychange", onVisibility);
      }
    }

    return () => {
      disposed = true;
      clearRetry();
      if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
        window.removeEventListener("focus", onFocus);
        window.removeEventListener("pageshow", onPageShow);
        window.removeEventListener("online", onOnline);
        window.removeEventListener(CLOUD_CONVERGENCE_REQUEST_EVENT, onExplicitRequest);
        window.removeEventListener("pe-localstorage", onCloudBackupQueueChanged);
        if (typeof document !== "undefined" && typeof document.removeEventListener === "function") {
          document.removeEventListener("visibilitychange", onVisibility);
        }
      }
    };
  }, [configured, user?.id, company?.id, deviceLock?.ready, deviceLock?.loading, deviceLock?.isActive, deviceLock?.isLocked, foregroundBurstMs]);
}
