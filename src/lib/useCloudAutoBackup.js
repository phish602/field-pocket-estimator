// @ts-nocheck
/* eslint-disable */

// Gate 13B: turns the Gate 13A cloud-backup dirty queue into a real
// automatic background backup worker.
//
// Important product rule: this is automatic cloud backup, not two-way sync.
// This hook never restores from cloud, never overwrites local data, and
// never changes the backup payload schema -- it only decides *when* to call
// the existing manual-backup orchestration (runSupabaseCloudOnboardingBackup)
// on the user's behalf, in the background, without blocking any local save.

import { useEffect, useRef, useState } from "react";
import {
  isCloudAutoBackupPaused,
  readCloudBackupQueueState,
  markCloudBackupSyncing,
  markCloudBackupOfflinePending,
  recordCloudBackupAttemptFailure,
  applyCloudBackupResultToQueue,
  markCloudBackupDirty,
  CLOUD_BACKUP_PRIORITY,
} from "./cloudBackupQueue";
import { acquireCloudBackupRunLock, releaseCloudBackupRunLock } from "./cloudBackupRunLock";
import { runSupabaseCloudOnboardingBackup } from "./supabaseCloudOnboarding";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { getOrCreateLocalDeviceId } from "./supabaseDeviceLock";
import { ensureCurrentDeviceCanApplyLocalRestore } from "./supabaseDeviceLock";
import { readSupabaseCloudConvergenceSnapshot } from "./supabaseCloudRestore";
import { captureVerifiedCloudSyncBaseline } from "./cloudSyncBaseline";
import { updateSupabaseAppRestoreBundle, APP_RESTORE_BUNDLE_STATUS } from "./supabaseAppRestoreBundle";

// Test-friendly, overridable debounce constants. Immediate covers
// money-critical queue entries (invoices/payments); normal covers
// everything else. A "deferred" priority queue entry never auto-runs.
//
// Gate E2: the NORMAL window is widened to 5s so a burst of ordinary local
// edits (typing, field-by-field saves) collapses into a single backup + verify
// scan instead of one per mutation -- the main non-money-critical egress source.
// Because each pe-localstorage event re-arms the timer (trailing-edge debounce),
// the backup fires once, five seconds after the LAST mutation. The money-critical
// window is deliberately left short so invoice/payment safety is never delayed.
export const CLOUD_AUTO_BACKUP_IMMEDIATE_DELAY_MS = 900;
export const CLOUD_AUTO_BACKUP_NORMAL_DELAY_MS = 5000;
export const CLOUD_AUTO_BACKUP_MAX_RETRY_DELAY_MS = 60000;

export const CLOUD_AUTO_BACKUP_RUNNING_EVENT = "estipaid:cloud-auto-backup-running";

function canRunAutomatically({ enabled, configured, user, company, deviceLocked }) {
  return Boolean(
    enabled
    && configured
    && user?.id
    && company?.id
    && !deviceLocked
    && !isCloudAutoBackupPaused()
  );
}

function isEligibleQueueState(queueState) {
  return Boolean(queueState?.pending)
    && queueState?.priority !== CLOUD_BACKUP_PRIORITY.DEFERRED
    && !["remote_changed", "conflict"].includes(String(queueState?.status || ""));
}

function hasUnresolvedConvergenceJournal() {
  try { return Boolean(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)); } catch { return true; }
}

function queueIdentity(queueState, companyId) {
  return [
    String(queueState?.companyId || companyId || "").trim(),
    Number(queueState?.localMutationRevision || 0),
    Number(queueState?.createdAt || 0),
    String(queueState?.documentId || "").trim(),
  ].join(":");
}

function delayForPriority(priority, immediateDelayMs, normalDelayMs) {
  return priority === CLOUD_BACKUP_PRIORITY.IMMEDIATE ? immediateDelayMs : normalDelayMs;
}

function isBrowserOnline() {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true;
  }
}

function retryDelayMs(retryCount) {
  const exponent = Math.max(0, Math.min(6, Number(retryCount || 0) - 1));
  return Math.min(CLOUD_AUTO_BACKUP_MAX_RETRY_DELAY_MS, 1500 * (2 ** exponent));
}

async function captureAutomaticBackupBaseline({ result, params, queueGeneration }) {
  if (result?.status !== "backup_completed" || !result?.verification?.ok || !result?.verification?.allMatched) return { ok: true, skipped: true };
  const warnings = Array.isArray(result.verification?.notices) && result.verification.notices.some((notice) => notice?.level === "warning" || notice?.level === "error");
  if (warnings) return { ok: false, code: "verification_requires_attention" };
  const access = await ensureCurrentDeviceCanApplyLocalRestore({ configured: params.configured, user: params.user, company: params.company, storage: localStorage, reason: "backup_baseline_capture" });
  if (!access?.ok) return { ok: false, code: "device_not_active", deviceLockLost: Boolean(access?.deviceLockLost) };
  if (Number(readCloudBackupQueueState()?.localMutationRevision || 0) !== Number(queueGeneration || 0)) return { ok: false, code: "newer_queue_revision" };
  const cloudSnapshot = await readSupabaseCloudConvergenceSnapshot({ configured: params.configured, user: params.user, company: params.company });
  const captured = captureVerifiedCloudSyncBaseline({ storage: localStorage, companyId: params.company?.id, queueRevision: queueGeneration, cloudSnapshot, verified: true, deviceAccess: access });
  return captured.ok ? { ok: true } : { ok: false, code: captured.code || "baseline_write_failed" };
}

async function captureAutomaticAppRestoreBundle({ result, params }) {
  if (result?.status !== "backup_completed") return { ok: true, skipped: true };
  const bundleResult = await updateSupabaseAppRestoreBundle({
    storageSnapshot: localStorage,
    configured: params.configured,
    user: params.user,
    company: params.company,
    role: params.role,
  });
  if (bundleResult?.status === APP_RESTORE_BUNDLE_STATUS.COMPLETED && bundleResult?.bundleUpdated) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "app_restore_bundle_incomplete",
    error: bundleResult?.error || "The app restore bundle could not be updated.",
    deviceLockLost: Boolean(bundleResult?.deviceLockLost),
  };
}

export default function useCloudAutoBackup({
  enabled = false,
  configured = false,
  user = null,
  company = null,
  role = "",
  deviceLocked = false,
  immediateDelayMs = CLOUD_AUTO_BACKUP_IMMEDIATE_DELAY_MS,
  normalDelayMs = CLOUD_AUTO_BACKUP_NORMAL_DELAY_MS,
} = {}) {
  const [running, setRunning] = useState(false);
  const paramsRef = useRef({ enabled, configured, user, company, role, deviceLocked });
  // A NEEDS_ATTENTION item may be a repaired stale-child duplicate from a
  // previous bundle. Give it one fresh-bundle recovery attempt, but never
  // turn a failed recovery into a tight same-session retry loop.
  const needsAttentionRecoveryAttemptsRef = useRef(new Set());
  paramsRef.current = { enabled, configured, user, company, role, deviceLocked };

  useEffect(() => {
    let disposed = false;
    let timer = null;
    let runningNow = false;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const setRunningState = (value) => {
      runningNow = value;
      if (!disposed) setRunning(value);
      try {
        window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, {
          detail: { running: value },
        }));
      } catch {}
    };

    const attemptBackup = async () => {
      clearTimer();
      const params = paramsRef.current;
      if (!canRunAutomatically(params)) return;
      if (runningNow) return;
      if (hasUnresolvedConvergenceJournal()) return;

      const queueState = readCloudBackupQueueState();
      if (!isEligibleQueueState(queueState)) return;
      const recoveryKey = queueIdentity(queueState, params.company?.id);
      const recoveringNeedsAttention = queueState.status === "needs_attention";
      if (needsAttentionRecoveryAttemptsRef.current.has(recoveryKey)) return;

      if (!isBrowserOnline()) {
        markCloudBackupOfflinePending();
        return;
      }

      if (!acquireCloudBackupRunLock()) {
        // Convergence and backup share this lock. Keep the queue intact and
        // recheck later instead of dropping a pending local mutation.
        scheduleCheck();
        return;
      }
      if (recoveringNeedsAttention) needsAttentionRecoveryAttemptsRef.current.add(recoveryKey);
      setRunningState(true);
      const activeDeviceId = getOrCreateLocalDeviceId(localStorage);
      const syncingQueue = markCloudBackupSyncing({ companyId: params.company?.id, activeDeviceId });
      const queueGeneration = Number(syncingQueue?.syncingRevision ?? queueState.localMutationRevision ?? 0);
      let deviceLockLost = false;

      try {
        let result = await runSupabaseCloudOnboardingBackup({
          storageSnapshot: localStorage,
          configured: params.configured,
          user: params.user,
          company: params.company,
          role: params.role,
          queueGeneration,
        });
        let completionQueueGeneration = queueGeneration;
        if (result?.status === "backup_completed") {
          const latestQueue = readCloudBackupQueueState();
          const newerMutationArrived = latestQueue.pending
            && Number(latestQueue.localMutationRevision || 0) !== Number(queueGeneration || 0);
          if (newerMutationArrived) {
            // A newer local change arrived while the business backup was in
            // flight. Leave that generation pending for its own full backup
            // and bundle capture; never let this older completion clear it.
            applyCloudBackupResultToQueue(result, { queueGeneration });
            return;
          }
          // The business backup verified its own data before returning, but the
          // app restore bundle is a second required cloud write. Re-queue this
          // final capture so the UI cannot call the cloud current until both
          // writes have completed successfully.
          const appBundleQueue = markCloudBackupDirty({
            reason: "app_restore_bundle_capture",
            domains: ["company_profile"],
            severity: "normal",
            source: "useCloudAutoBackup",
          });
          completionQueueGeneration = Number(appBundleQueue?.localMutationRevision || queueGeneration || 0);
          const appRestoreBundle = await captureAutomaticAppRestoreBundle({ result, params });
          if (!appRestoreBundle.ok) {
            result = {
              ...result,
              status: "needs_attention",
              error: appRestoreBundle.error || "Cloud backup needs another verification before it can be marked complete.",
              deviceLockLost: appRestoreBundle.deviceLockLost,
            };
          }
        }
        const baseline = await captureAutomaticBackupBaseline({ result, params, queueGeneration: completionQueueGeneration });
        if (!baseline.ok) {
          markCloudBackupDirty({ reason: "cloud_sync_baseline_incomplete", severity: "normal" });
          result = { ...result, status: "needs_attention", error: "Cloud backup needs another verification before it can be marked complete.", deviceLockLost: baseline.deviceLockLost };
        }
        deviceLockLost = Boolean(result?.deviceLockLost);

        // Both the automatic worker and the manual Retry Sync button classify a
        // backup result through the SAME shared queue transition, so the queue
        // status can never disagree with the result the user sees.
        applyCloudBackupResultToQueue(result, { queueGeneration: completionQueueGeneration });
      } catch (error) {
        const current = readCloudBackupQueueState();
        recordCloudBackupAttemptFailure(
          error?.message || "automatic_backup_error",
          { retryDelayMs: retryDelayMs(Number(current.retryCount || 0) + 1), errorCode: "automatic_backup_error" }
        );
      } finally {
        releaseCloudBackupRunLock();
        setRunningState(false);
        // A mutation may have landed while the writer was awaiting cloud I/O.
        // Its generation remains pending, so schedule exactly one follow-up.
        if (!deviceLockLost) scheduleCheck();
      }
    };

    // Debounced: waits for local changes to settle before running, faster
    // for money-critical (immediate-priority) queue entries. Never runs
    // concurrently with itself or with a manual backup (shared run lock).
    const scheduleCheck = () => {
      const params = paramsRef.current;
      if (!canRunAutomatically(params) || runningNow) return;
      if (hasUnresolvedConvergenceJournal()) return;

      const queueState = readCloudBackupQueueState();
      if (!isEligibleQueueState(queueState)) return;
      if (needsAttentionRecoveryAttemptsRef.current.has(queueIdentity(queueState, params.company?.id))) return;

      if (!isBrowserOnline()) {
        markCloudBackupOfflinePending();
        return;
      }

      clearTimer();
      const retryAt = Number(queueState?.nextRetryAt || 0);
      const retryDelay = retryAt > Date.now() ? retryAt - Date.now() : 0;
      const delay = retryDelay || delayForPriority(queueState.priority, immediateDelayMs, normalDelayMs);
      timer = setTimeout(attemptBackup, delay);
    };

    // Skips the debounce window -- used for reconnect (online) and foreground
    // (visibility), where waiting the full debounce would miss the opportunity.
    const attemptNowIfSafe = () => {
      const params = paramsRef.current;
      if (!canRunAutomatically(params) || runningNow) return;
      if (hasUnresolvedConvergenceJournal()) return;

      const queueState = readCloudBackupQueueState();
      if (!isEligibleQueueState(queueState)) return;
      if (needsAttentionRecoveryAttemptsRef.current.has(queueIdentity(queueState, params.company?.id))) return;

      attemptBackup();
    };

    const onQueueStorageEvent = (event) => {
      const key = event?.detail?.key;
      if (key && key !== STORAGE_KEYS.CLOUD_BACKUP_QUEUE) return;
      scheduleCheck();
    };

    const onOnline = () => attemptNowIfSafe();

    const onVisibilityChange = () => {
      try {
        if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      } catch {
        return;
      }
      attemptNowIfSafe();
    };

    // Gate E2 / E2.2: pagehide must NOT start a new full-table cloud read -- its
    // ONLY action is to cancel an already-scheduled backup timer so no
    // backup+verify scan fires during unload (a request the browser routinely
    // kills mid-flight, wasting egress). It never calls attemptBackup /
    // attemptNowIfSafe / runSupabaseCloudOnboardingBackup /
    // readSupabaseCloudConvergenceSnapshot, and it never clears, completes, or
    // mutates the dirty queue -- the pending queue stays in localStorage and a
    // later safe remount / visible foreground / online recovery resumes it once.
    const onPageHide = () => { clearTimer(); };

    // Requirement: on mount (app launch / hook remount), a pending queue is
    // eligible to run again.
    scheduleCheck();

    try {
      window.addEventListener("pe-localstorage", onQueueStorageEvent);
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("pagehide", onPageHide);
    } catch {}

    return () => {
      disposed = true;
      clearTimer();
      try {
        window.removeEventListener("pe-localstorage", onQueueStorageEvent);
        window.removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", onPageHide);
      } catch {}
    };
  }, [enabled, configured, user?.id, company?.id, role, deviceLocked, immediateDelayMs, normalDelayMs]);

  return { running };
}
