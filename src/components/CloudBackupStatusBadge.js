// @ts-nocheck
/* eslint-disable */

// Gate 13C/13D: a compact, self-contained cloud-backup status indicator for
// use outside Advanced Settings (Home). Reads the shared useCloudBackupStatus
// hook (Gate 13A/13B/13C signals: queue state, worker running, restore
// complete) so it never duplicates backup logic -- it only renders a calm
// summary of it. Self-gates its own visibility (signed in, configured, has a
// workspace) so callers can render it unconditionally. Project Detail uses
// the same hook but its own compact chip markup/copy -- see
// ProjectDetailScreen.js's renderBackupChip.

import useCloudBackupStatus from "../lib/useCloudBackupStatus";

export default function CloudBackupStatusBadge({ style } = {}) {
  const { isSupabaseReady, hasCompany, userEmail, displayState, restoredRecently } = useCloudBackupStatus();

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
