// @ts-nocheck
/* eslint-disable */

// Gate 13C: a compact, self-contained cloud-backup status indicator for use
// outside Advanced Settings (Home, Project Detail, etc.). It reads the same
// Gate 13A/13B queue + worker signals Advanced Settings already mirrors, so
// it never duplicates backup logic -- it only renders a calm, small summary
// of it. Self-gates its own visibility (signed in, configured, has a
// workspace) so callers can render it unconditionally.

import { useEffect, useState } from "react";
import { readCloudBackupQueueState, CLOUD_BACKUP_STATUS } from "../lib/cloudBackupQueue";
import { CLOUD_AUTO_BACKUP_RUNNING_EVENT } from "../lib/useCloudAutoBackup";
import { CLOUD_RESTORE_COMPLETE_EVENT, getLastCloudRestoreCompleteAt } from "../lib/supabaseCloudRestore";
import useSupabaseAuth from "../lib/useSupabaseAuth";
import useSupabaseAccount from "../lib/useSupabaseAccount";
import { STORAGE_KEYS } from "../constants/storageKeys";

const RESTORE_BANNER_DURATION_MS = 6000;

function isRestoreRecent() {
  const at = getLastCloudRestoreCompleteAt();
  return Boolean(at) && Date.now() - at < RESTORE_BANNER_DURATION_MS;
}

export default function CloudBackupStatusBadge({ style } = {}) {
  const { configured: isSupabaseReady, user, userEmail } = useSupabaseAuth();
  const { hasCompany } = useSupabaseAccount({ configured: isSupabaseReady, user });
  const [queueState, setQueueState] = useState(() => readCloudBackupQueueState());
  const [workerRunning, setWorkerRunning] = useState(false);
  // Lazy-initialized so a badge that mounts *after* a restore already
  // completed elsewhere (e.g. Home, freshly mounted by app-shell navigation)
  // still shows the confirmation instead of missing the event.
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
      armRestoreBannerTimer(RESTORE_BANNER_DURATION_MS);
    };

    refresh();

    if (isRestoreRecent()) {
      armRestoreBannerTimer(RESTORE_BANNER_DURATION_MS - (Date.now() - getLastCloudRestoreCompleteAt()));
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

  const autoBackupRunning = workerRunning;
  // "Current" is only shown once a backup has actually been confirmed --
  // a fresh queue that has never been dirty and never backed up has nothing
  // to report yet, matching the same rule Advanced Settings already applies.
  const displayState = autoBackupRunning
    ? "running"
    : queueState.status === CLOUD_BACKUP_STATUS.FAILED
      ? "failed"
      : queueState.pending
        ? "pending"
        : queueState.lastSuccessfulBackupAt
          ? "current"
          : "none";

  if (!isSupabaseReady || !userEmail || !hasCompany) return null;
  if (displayState === "none" && !restoredRecently) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="cloud-backup-status-badge"
      className="pe-cloud-backup-status-badge"
      style={{
        display: "grid",
        gap: 1,
        padding: "8px 12px",
        borderRadius: 10,
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        fontSize: 11.5,
        fontWeight: 700,
        color: "rgba(230,241,248,0.72)",
        ...style,
      }}
    >
      {restoredRecently ? (
        <div style={{ color: "rgba(187,247,208,0.95)" }}>Cloud backup restored.</div>
      ) : displayState === "running" ? (
        <div style={{ color: "rgba(99,179,237,0.92)" }}>Backing up changes...</div>
      ) : displayState === "failed" ? (
        <>
          <div style={{ color: "rgba(253,224,71,0.95)" }}>Cloud backup needs attention</div>
          <div style={{ fontWeight: 500, opacity: 0.75 }}>Your work is saved on this device. Backup will retry.</div>
        </>
      ) : displayState === "pending" ? (
        <>
          <div>Cloud backup pending</div>
          <div style={{ fontWeight: 500, opacity: 0.75 }}>Latest changes are saved on this device.</div>
        </>
      ) : (
        <div style={{ color: "rgba(187,247,208,0.95)" }}>Cloud backup is up to date.</div>
      )}
    </div>
  );
}
