// @ts-nocheck
/* eslint-disable */

// Gate 13D: shared status-derivation for cloud backup indicators. Extracted
// from CloudBackupStatusBadge (Gate 13C) so Project Detail's compact chip and
// Home's full badge read the exact same signals -- queue state, the Gate 13B
// worker's running event, and a recent restore -- without each maintaining
// its own copy of the listener/timer wiring. Never renders anything itself;
// callers own their own markup/copy.

import { useEffect, useState } from "react";
import { readCloudBackupQueueState, CLOUD_BACKUP_STATUS } from "./cloudBackupQueue";
import { CLOUD_AUTO_BACKUP_RUNNING_EVENT } from "./useCloudAutoBackup";
import { CLOUD_RESTORE_COMPLETE_EVENT, getLastCloudRestoreCompleteAt } from "./supabaseCloudRestore";
import useSupabaseAuth from "./useSupabaseAuth";
import useSupabaseAccount from "./useSupabaseAccount";
import { STORAGE_KEYS } from "../constants/storageKeys";

export const CLOUD_BACKUP_RESTORE_BANNER_DURATION_MS = 6000;

function isRestoreRecent() {
  const at = getLastCloudRestoreCompleteAt();
  return Boolean(at) && Date.now() - at < CLOUD_BACKUP_RESTORE_BANNER_DURATION_MS;
}

// displayState is one of: "running" | "failed" | "pending" | "current" | "none".
// restoredRecently is a separate flag (a restore can complete while the queue
// is already otherwise "current") so callers can prioritize a "just restored"
// message without losing the underlying queue-derived state.
export default function useCloudBackupStatus() {
  const { configured: isSupabaseReady, user, userEmail } = useSupabaseAuth();
  const { hasCompany } = useSupabaseAccount({ configured: isSupabaseReady, user });
  const [queueState, setQueueState] = useState(() => readCloudBackupQueueState());
  const [workerRunning, setWorkerRunning] = useState(false);
  // Lazy-initialized so a consumer that mounts *after* a restore already
  // completed elsewhere still shows the confirmation instead of missing it.
  const [restoredRecently, setRestoredRecently] = useState(isRestoreRecent);

  useEffect(() => {
    const refresh = () => setQueueState(readCloudBackupQueueState());

    const onStorageEvent = (event) => {
      const key = event?.detail?.key;
      if (key && key !== STORAGE_KEYS.CLOUD_BACKUP_QUEUE) return;
      refresh();
    };

    const onWorkerRunningEvent = (event) => {
      setWorkerRunning(Boolean(event?.detail?.running));
    };

    let restoreBannerTimer = null;
    const armRestoreBannerTimer = (remainingMs) => {
      if (restoreBannerTimer) clearTimeout(restoreBannerTimer);
      restoreBannerTimer = setTimeout(() => setRestoredRecently(false), remainingMs);
    };
    const onRestoreComplete = () => {
      refresh();
      setRestoredRecently(true);
      armRestoreBannerTimer(CLOUD_BACKUP_RESTORE_BANNER_DURATION_MS);
    };

    refresh();

    if (isRestoreRecent()) {
      armRestoreBannerTimer(CLOUD_BACKUP_RESTORE_BANNER_DURATION_MS - (Date.now() - getLastCloudRestoreCompleteAt()));
    }

    try {
      window.addEventListener("pe-localstorage", onStorageEvent);
      window.addEventListener(CLOUD_AUTO_BACKUP_RUNNING_EVENT, onWorkerRunningEvent);
      window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onRestoreComplete);
    } catch {}

    return () => {
      if (restoreBannerTimer) clearTimeout(restoreBannerTimer);
      try {
        window.removeEventListener("pe-localstorage", onStorageEvent);
        window.removeEventListener(CLOUD_AUTO_BACKUP_RUNNING_EVENT, onWorkerRunningEvent);
        window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onRestoreComplete);
      } catch {}
    };
  }, []);

  // "Current" is only reported once a backup has actually been confirmed --
  // a fresh queue that has never been dirty and never backed up has nothing
  // to report yet.
  const displayState = workerRunning
    ? "running"
    : queueState.status === CLOUD_BACKUP_STATUS.FAILED
      ? "failed"
      : queueState.pending
        ? "pending"
        : queueState.lastSuccessfulBackupAt
          ? "current"
          : "none";

  return {
    isSupabaseReady,
    hasCompany,
    userEmail,
    queueState,
    displayState,
    restoredRecently,
  };
}
