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
  readCloudBackupQueueState,
  recordCloudBackupAttemptFailure,
  CLOUD_BACKUP_PRIORITY,
} from "./cloudBackupQueue";
import { acquireCloudBackupRunLock, releaseCloudBackupRunLock } from "./cloudBackupRunLock";
import { runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } from "./supabaseCloudOnboarding";
import { STORAGE_KEYS } from "../constants/storageKeys";

// Test-friendly, overridable debounce constants. Immediate covers
// money-critical queue entries (invoices/payments); normal covers
// everything else. A "deferred" priority queue entry never auto-runs.
export const CLOUD_AUTO_BACKUP_IMMEDIATE_DELAY_MS = 8000;
export const CLOUD_AUTO_BACKUP_NORMAL_DELAY_MS = 45000;

export const CLOUD_AUTO_BACKUP_RUNNING_EVENT = "estipaid:cloud-auto-backup-running";

function canRunAutomatically({ enabled, configured, user, company, deviceLocked }) {
  return Boolean(enabled && configured && user?.id && company?.id && !deviceLocked);
}

function isEligibleQueueState(queueState) {
  return Boolean(queueState?.pending) && queueState?.priority !== CLOUD_BACKUP_PRIORITY.DEFERRED;
}

function delayForPriority(priority, immediateDelayMs, normalDelayMs) {
  return priority === CLOUD_BACKUP_PRIORITY.IMMEDIATE ? immediateDelayMs : normalDelayMs;
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

      if (!acquireCloudBackupRunLock()) return;
      setRunningState(true);

      try {
        const result = await runSupabaseCloudOnboardingBackup({
          storageSnapshot: localStorage,
          configured: params.configured,
          user: params.user,
          company: params.company,
          role: params.role,
        });

        if (result?.status !== CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED) {
          recordCloudBackupAttemptFailure(result?.error || result?.status || "automatic_backup_incomplete");
        }
      } catch (error) {
        recordCloudBackupAttemptFailure(error?.message || "automatic_backup_error");
      } finally {
        releaseCloudBackupRunLock();
        setRunningState(false);
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

      clearTimer();
      const delay = delayForPriority(queueState.priority, immediateDelayMs, normalDelayMs);
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
