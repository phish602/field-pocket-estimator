// @ts-nocheck
/* eslint-disable */

// Gate 13E: a tiny, compact save+backup status line for use near Save/Update
// controls across durable edit flows (estimate/invoice editor, project,
// customer, templates, company profile). Reads the same shared signals as
// the Home CloudBackupStatusBadge and the Project Detail metadata chip
// (src/lib/useCloudBackupStatus.js) so all three surfaces stay in sync
// without duplicating queue/worker logic -- only the copy and markup differ
// per surface. Self-gates its own visibility; safe to render unconditionally.

import useCloudBackupStatus from "../lib/useCloudBackupStatus";

export default function CloudBackupInlineStatus({ className, style } = {}) {
  const { isSupabaseReady, hasCompany, userEmail, displayState, restoredRecently, queueState, chipState } = useCloudBackupStatus();

  if (!isSupabaseReady || !userEmail || !hasCompany) return null;
  if (displayState === "none" && !restoredRecently) return null;

  // The persisted queue is the local source of truth for work that has not
  // received verified cloud completion. Prefer it over a stale verification
  // result so a just-saved profile never briefly reports "Cloud up to date".
  const queueStatus = String(queueState?.status || "").trim();
  const effectiveDisplayState = queueState?.pending
    ? (displayState === "running" || queueStatus === "syncing"
      ? "running"
      : ["needs_attention", "remote_changed", "conflict"].includes(queueStatus)
        ? "failed"
        : "pending")
    : displayState;

  const text = restoredRecently
    ? "Cloud backup restored"
    : effectiveDisplayState === "running"
      ? "Saved on this device · Syncing automatically"
      : effectiveDisplayState === "failed"
        ? chipState === "local_cloud_mismatch"
          ? queueState?.status === "conflict"
            ? "Saved on this device · Cloud sync conflict"
            : "Saved on this device · Cloud changed elsewhere"
          : queueState?.status === "conflict"
            ? "Saved on this device · Cloud sync conflict"
            : "Saved on this device · Sync needs attention"
        : effectiveDisplayState === "pending"
          ? queueState?.status === "offline_pending"
            ? "Saved on this device · Waiting for connection"
            : queueState?.status === "retry_wait"
              ? "Saved on this device · Retrying cloud sync"
              : "Saved on this device · Backup pending"
          : "Saved on this device · Cloud up to date";

  const color = restoredRecently || effectiveDisplayState === "current"
    ? "rgba(187,247,208,0.88)"
    : effectiveDisplayState === "failed"
      ? "rgba(253,224,71,0.92)"
      : "rgba(230,241,248,0.5)";

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="cloud-backup-inline-status"
      className={`pe-cloud-backup-inline-status${className ? ` ${className}` : ""}`}
      style={{
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.01em",
        color,
        ...style,
      }}
    >
      {text}
    </div>
  );
}
