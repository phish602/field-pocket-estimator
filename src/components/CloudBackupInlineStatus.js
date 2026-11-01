// @ts-nocheck
/* eslint-disable */

// Gate 13E: a tiny, compact save+backup status line for use near Save/Update
// controls across durable edit flows (estimate/invoice editor, project,
// customer, templates, company profile). Reads the same shared signals as
// the Home CloudBackupStatusBadge and the Project Detail metadata chip
// (src/lib/useCloudBackupStatus.js) so all three surfaces stay in sync
// without duplicating queue/worker logic -- only the copy and markup differ
// per surface. Self-gates its own visibility; safe to render unconditionally.

import useCloudBackupStatus, { CLOUD_PRODUCT_STATE } from "../lib/useCloudBackupStatus";
import { useLanguage } from "../lib/i18n";

export default function CloudBackupInlineStatus({ className, style } = {}) {
  const { isSupabaseReady, hasCompany, userEmail, productState, productStatus } = useCloudBackupStatus();
  // Both hooks must run before the visibility gates below, or the hook order
  // changes between renders once this component starts returning early.
  const { t } = useLanguage();

  if (!isSupabaseReady || !userEmail || !hasCompany) return null;
  const text = productState === CLOUD_PRODUCT_STATE.SYNCING
      ? t("cloud.inlineSyncing")
      : productState === CLOUD_PRODUCT_STATE.SYNC_ISSUE
        ? t("cloud.inlineNeedsAttention")
        : productState === CLOUD_PRODUCT_STATE.PENDING
          ? productStatus.pendingReason === "offline"
            ? t("cloud.inlineWaitingConnection")
            : productStatus.pendingReason === "retry"
              ? t("cloud.inlineRetrying")
              : t("cloud.inlineBackupPending")
          : productState === CLOUD_PRODUCT_STATE.RESTORE_AVAILABLE
            ? t("cloud.restore")
            : productState === CLOUD_PRODUCT_STATE.CLOUD_OK
              ? t("cloud.inlineUpToDate")
              : t("cloud.connected");

  const color = productState === CLOUD_PRODUCT_STATE.CLOUD_OK || productState === CLOUD_PRODUCT_STATE.CLOUD_CONNECTED
    ? "rgba(187,247,208,0.88)"
    : productState === CLOUD_PRODUCT_STATE.SYNC_ISSUE
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
