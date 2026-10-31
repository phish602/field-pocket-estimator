// @ts-nocheck
/* eslint-disable */

import useCloudBackupStatus, { CLOUD_PRODUCT_STATE } from "../lib/useCloudBackupStatus";
import { SHOW_CLOUD_RESTORE_PROMPT_EVENT } from "../lib/useCloudRestorePrompt";
import useIsNarrowViewport from "../lib/useIsNarrowViewport";
import { DEVICE_LOCK_EXPLANATION } from "../lib/supabaseDeviceLock";

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

function showDeviceLockExplanation() {
  try {
    window.alert(DEVICE_LOCK_EXPLANATION);
  } catch {}
}

export default function CloudHeaderStatusChip({ style } = {}) {
  const { isSupabaseReady, hasCompany, userEmail, productState, productStatus } = useCloudBackupStatus();

  const isNarrow = useIsNarrowViewport();

  if (!isSupabaseReady || !userEmail || !hasCompany) return null;
  let label = null;
  let color = "rgba(230,241,248,0.62)";
  let background = "rgba(255,255,255,0.05)";
  let border = "1px solid rgba(255,255,255,0.1)";
  let narrowMaxWidth = 88;

  if (productState === CLOUD_PRODUCT_STATE.SYNCING) {
    label = "Syncing";
    color = "rgba(99,179,237,0.95)";
    narrowMaxWidth = 96;
  } else if (productState === CLOUD_PRODUCT_STATE.PENDING) {
    label = "Pending";
    color = "rgba(191,214,235,0.92)";
    background = "rgba(148,177,209,0.1)";
    border = "1px solid rgba(148,177,209,0.32)";
  } else if (productState === CLOUD_PRODUCT_STATE.SYNC_ISSUE) {
    label = "Sync issue";
    color = "rgba(253,224,71,0.95)";
    background = "rgba(245,158,11,0.09)";
    border = "1px solid rgba(245,158,11,0.28)";
    narrowMaxWidth = 128;
  } else if (productState === CLOUD_PRODUCT_STATE.RESTORE_AVAILABLE) {
    label = "Restore";
    color = "rgba(99,179,237,0.95)";
  } else if (productState === CLOUD_PRODUCT_STATE.CLOUD_OK) {
    label = "Cloud OK";
    color = "rgba(187,247,208,0.9)";
  } else if (productState === CLOUD_PRODUCT_STATE.CLOUD_CONNECTED) {
    label = "Cloud connected";
    color = "rgba(187,247,208,0.82)";
  }

  if (!label) return null;

  return (
    <button
      type="button"
      data-testid="cloud-header-status-chip"
      onClick={productStatus.action === "device_locked"
        ? showDeviceLockExplanation
        : productStatus.action === "open_restore"
          ? reopenRestorePrompt
          : openCloudSettings}
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
