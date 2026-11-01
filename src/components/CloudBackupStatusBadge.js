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

import useCloudBackupStatus, { CLOUD_PRODUCT_STATE } from "../lib/useCloudBackupStatus";
import { useLanguage } from "../lib/i18n";

export default function CloudBackupStatusBadge({ style } = {}) {
  const { isSupabaseReady, hasCompany, userEmail, productState, productStatus } = useCloudBackupStatus();
  const { t } = useLanguage();

  if (!isSupabaseReady || !userEmail || !hasCompany) return null;
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
      {productState === CLOUD_PRODUCT_STATE.SYNCING ? (
        <div style={{ color: "rgba(99,179,237,0.92)" }}>{t("cloud.backingUpChanges")}</div>
      ) : productState === CLOUD_PRODUCT_STATE.SYNC_ISSUE ? (
        <>
          <div style={{ color: "rgba(253,224,71,0.95)" }}>
            {t("cloud.syncNeedsAttention")}
          </div>
          <div style={{ fontWeight: 500, opacity: 0.75 }}>
            {t("cloud.inlineNeedsAttention")}
          </div>
        </>
      ) : productState === CLOUD_PRODUCT_STATE.PENDING ? (
        <>
          <div>{productStatus.pendingReason === "offline" ? t("cloud.waitingForConnection") : productStatus.pendingReason === "retry" ? t("cloud.syncRetrying") : t("cloud.syncPending")}</div>
          <div style={{ fontWeight: 500, opacity: 0.75 }}>{productStatus.pendingReason === "offline" ? t("cloud.savedOfflineWillContinue") : t("cloud.savedWillSyncAutomatically")}</div>
        </>
      ) : productState === CLOUD_PRODUCT_STATE.RESTORE_AVAILABLE ? (
        <div style={{ color: "rgba(99,179,237,0.92)" }}>{t("cloud.restore")}</div>
      ) : productState === CLOUD_PRODUCT_STATE.CLOUD_CONNECTED ? (
        <div style={{ color: "rgba(187,247,208,0.9)" }}>{t("cloud.connected")}</div>
      ) : (
        <div style={{ color: "rgba(187,247,208,0.95)" }}>{t("cloud.backupUpToDate")}</div>
      )}
    </div>
  );
}
