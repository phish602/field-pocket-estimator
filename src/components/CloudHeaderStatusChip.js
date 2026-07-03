// @ts-nocheck
/* eslint-disable */

// Gate 13G: a compact cloud backup/restore status chip for the app's
// reactive/sticky header, so this signal is visible everywhere (not just
// buried in Home's scrollable content). Reuses the same shared signals as
// the Home badge (useCloudBackupStatus) and the Home restore card
// (useCloudRestorePrompt) -- no new backup/restore logic, presentation only.
//
// Tapping the chip always dispatches the same "show restore prompt" event:
// harmless when there's nothing to restore (it just returns Home), and it
// reopens the Home restore card when "Not now" had dismissed it for the
// session -- so the restore path is never buried behind Advanced Settings.
//
// Gate 13G amendment: on narrow/phone widths the full-length copy ("Cloud up
// to date", "Backup needs attention") was wide enough to crowd the header's
// center mark. Below the shared narrow-viewport breakpoint this now uses
// short labels instead -- same priority logic, same tap behavior.

import useCloudBackupStatus from "../lib/useCloudBackupStatus";
import useCloudRestorePrompt, { CLOUD_RESTORE_PROMPT_STATE, SHOW_CLOUD_RESTORE_PROMPT_EVENT } from "../lib/useCloudRestorePrompt";
import useIsNarrowViewport from "../lib/useIsNarrowViewport";

function reopenRestorePrompt() {
  try {
    window.dispatchEvent(new CustomEvent(SHOW_CLOUD_RESTORE_PROMPT_EVENT));
  } catch {}
}

export default function CloudHeaderStatusChip({ style } = {}) {
  const { isSupabaseReady, hasCompany, userEmail, displayState, restoredRecently } = useCloudBackupStatus();
  // hasChamberedDraft is intentionally not threaded in here -- it only
  // changes which of the two actionable restore states applies, and both
  // read identically ("Restore available" / "Restore") in this compact chip.
  const { state: restorePromptState } = useCloudRestorePrompt({ hasChamberedDraft: false });
  const isNarrow = useIsNarrowViewport();

  if (!isSupabaseReady || !userEmail || !hasCompany) return null;

  const restoreAvailable = restorePromptState === CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE
    || restorePromptState === CLOUD_RESTORE_PROMPT_STATE.CLOUD_AVAILABLE_LOCAL_EXISTS;

  // Priority: a just-completed restore, then backup pending/running/failed
  // (local safety) always wins over a restore recommendation, then restore
  // availability, then a confirmed "up to date" -- otherwise nothing to say.
  let label = null;
  let color = "rgba(230,241,248,0.62)";
  let background = "rgba(255,255,255,0.05)";
  let border = "1px solid rgba(255,255,255,0.1)";
  // Gate 13G micro amendment: "Backing up" is the longest narrow label, so it
  // gets a touch more room than the other compact states; nothing else
  // changes size.
  let narrowMaxWidth = 88;
  if (restoredRecently) {
    label = "Restored";
    color = "rgba(187,247,208,0.95)";
  } else if (displayState === "running") {
    label = isNarrow ? "Backing up" : "Backing up...";
    color = "rgba(99,179,237,0.95)";
    narrowMaxWidth = 96;
  } else if (displayState === "failed") {
    label = isNarrow ? "Backup issue" : "Backup needs attention";
    color = "rgba(253,224,71,0.95)";
  } else if (displayState === "pending") {
    label = isNarrow ? "Pending" : "Backup pending";
    // Gate 13G micro amendment: the previous default color read as muted to
    // the point of looking disabled. A calm blue-gray (distinct from the
    // brighter "running" blue and the green "current"/"restored" tones, and
    // nowhere near the failed-state yellow) reads as "waiting" without
    // looking like a warning.
    color = "rgba(191,214,235,0.92)";
    background = "rgba(148,177,209,0.1)";
    border = "1px solid rgba(148,177,209,0.32)";
  } else if (restoreAvailable) {
    label = isNarrow ? "Restore" : "Restore available";
    color = "rgba(99,179,237,0.95)";
  } else if (displayState === "current") {
    label = isNarrow ? "Cloud OK" : "Cloud up to date";
    color = "rgba(187,247,208,0.9)";
  }

  if (!label) return null;

  return (
    <button
      type="button"
      data-testid="cloud-header-status-chip"
      onClick={reopenRestorePrompt}
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
