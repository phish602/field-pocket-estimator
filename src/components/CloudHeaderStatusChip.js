// @ts-nocheck
/* eslint-disable */

import useCloudBackupStatus from "../lib/useCloudBackupStatus";
import { SHOW_CLOUD_RESTORE_PROMPT_EVENT } from "../lib/useCloudRestorePrompt";
import useIsNarrowViewport from "../lib/useIsNarrowViewport";

function reopenRestorePrompt() {
  try {
    window.dispatchEvent(new CustomEvent(SHOW_CLOUD_RESTORE_PROMPT_EVENT));
  } catch {}
}

function openCloudSettings() {
  try {
    window.dispatchEvent(new CustomEvent("estipaid:navigate-cloud-settings"));
  } catch {}
}

export default function CloudHeaderStatusChip({ style } = {}) {
  const { isSupabaseReady, hasCompany, userEmail, chipState, chipAction } = useCloudBackupStatus();
  const isNarrow = useIsNarrowViewport();

  if (!isSupabaseReady || !userEmail || !hasCompany) return null;
  let label = null;
  let color = "rgba(230,241,248,0.62)";
  let background = "rgba(255,255,255,0.05)";
  let border = "1px solid rgba(255,255,255,0.1)";
  let narrowMaxWidth = 88;

  if (chipState === "backup_running") {
    label = isNarrow ? "Backing up" : "Backing up...";
    color = "rgba(99,179,237,0.95)";
    narrowMaxWidth = 96;
  } else if (chipState === "backup_pending") {
    label = isNarrow ? "Pending" : "Backup pending";
    color = "rgba(191,214,235,0.92)";
    background = "rgba(148,177,209,0.1)";
    border = "1px solid rgba(148,177,209,0.32)";
  } else if (chipState === "backup_failed") {
    // Cloud status language is important enough to never abbreviate. The
    // center Home mark is already hidden on narrow phones (see App.js
    // showCenterMark), which freed up plenty of room in the header for a
    // wider chip instead of shorter words.
    label = "Backup issue";
    color = "rgba(253,224,71,0.95)";
    narrowMaxWidth = 128;
  } else if (chipState === "local_cloud_mismatch") {
    label = "Data mismatch";
    color = "rgba(253,224,71,0.95)";
    narrowMaxWidth = 128;
  } else if (chipState === "safe_to_restore_empty_device") {
    label = "Restore";
    color = "rgba(99,179,237,0.95)";
  } else if (chipState === "restored") {
    label = "Restored";
    color = "rgba(187,247,208,0.95)";
  } else if (chipState === "cloud_verified_current") {
    label = "Cloud OK";
    color = "rgba(187,247,208,0.9)";
  }

  if (!label) return null;

  return (
    <button
      type="button"
      data-testid="cloud-header-status-chip"
      onClick={chipAction === "open_settings" ? openCloudSettings : reopenRestorePrompt}
      style={{
        display: "inline-flex",
        alignItems: "center",
        maxWidth: isNarrow ? narrowMaxWidth : 132,
        padding: isNarrow ? "5px 8px" : "5px 9px",
        borderRadius: 999,
        background,
        border,
        fontSize: isNarrow ? 10 : 10.5,
        fontWeight: 700,
        lineHeight: 1.2,
        color,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        cursor: "pointer",
        font: "inherit",
        ...style,
      }}
    >
      {label}
    </button>
  );
}
