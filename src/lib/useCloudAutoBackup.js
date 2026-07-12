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
  markCloudBackupReviewRequired,
  clearCloudBackupDirty,
  recordCloudBackupAttemptFailure,
  CLOUD_BACKUP_PRIORITY,
} from "./cloudBackupQueue";
import { acquireCloudBackupRunLock, releaseCloudBackupRunLock } from "./cloudBackupRunLock";
import { runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } from "./supabaseCloudOnboarding";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { getOrCreateLocalDeviceId } from "./supabaseDeviceLock";

// Test-friendly, overridable debounce constants. Immediate covers
// money-critical queue entries (invoices/payments); normal covers
// everything else. A "deferred" priority queue entry never auto-runs.
export const CLOUD_AUTO_BACKUP_IMMEDIATE_DELAY_MS = 900;
export const CLOUD_AUTO_BACKUP_NORMAL_DELAY_MS = 1200;
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

      const queueState = readCloudBackupQueueState();
      if (!isEligibleQueueState(queueState)) return;

      if (!isBrowserOnline()) {
        markCloudBackupOfflinePending();
        return;
      }

      if (!acquireCloudBackupRunLock()) return;
      setRunningState(true);
      const activeDeviceId = getOrCreateLocalDeviceId(localStorage);
      const syncingQueue = markCloudBackupSyncing({ companyId: params.company?.id, activeDeviceId });
      const queueGeneration = Number(syncingQueue?.syncingRevision ?? queueState.localMutationRevision ?? 0);
      let deviceLockLost = false;

      try {
        const result = await runSupabaseCloudOnboardingBackup({
          storageSnapshot: localStorage,
          configured: params.configured,
          user: params.user,
          company: params.company,
          role: params.role,
          queueGeneration,
        });
        deviceLockLost = Boolean(result?.deviceLockLost);

        if (result?.permanentIdentityConflict) {
          markCloudBackupReviewRequired(result?.error || result?.reason, {
            status: result?.syncReviewState,
            errorCode: "identity_review_required",
          });
        } else if (result?.status === CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED) {
          // The production writer performs this after verified success. Keep
          // this generation-aware fallback for alternate callers/tests.
          clearCloudBackupDirty("automatic_backup_verified", { expectedRevision: queueGeneration });
        } else if (!result?.deviceLockLost) {
          const current = readCloudBackupQueueState();
          recordCloudBackupAttemptFailure(
            result?.error || result?.status || "automatic_backup_incomplete",
            { retryDelayMs: retryDelayMs(Number(current.retryCount || 0) + 1), errorCode: result?.status || "automatic_backup_incomplete" }
          );
        }
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

      const queueState = readCloudBackupQueueState();
      if (!isEligibleQueueState(queueState)) return;

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

    // Skips the debounce window -- used for reconnect/foreground/pagehide,
    // where waiting the full debounce would miss the opportunity.
    const attemptNowIfSafe = () => {
      const params = paramsRef.current;
      if (!canRunAutomatically(params) || runningNow) return;

      const queueState = readCloudBackupQueueState();
      if (!isEligibleQueueState(queueState)) return;

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

    const onPageHide = () => attemptNowIfSafe();

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
