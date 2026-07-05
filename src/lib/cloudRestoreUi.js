import { CLOUD_RESTORE_STATUS } from "./supabaseCloudRestore";

function asText(value) {
  return String(value || "").trim();
}

export function buildCloudRestoreConfirmationDialog({ partialLocalSnapshot = false } = {}) {
  return {
    title: "Restore cloud data to this device?",
    lines: partialLocalSnapshot
      ? [
          "This device has invoices but missing estimates. Restoring cloud data is the safe recovery path.",
          "This will overwrite this device's incomplete local data with cloud data.",
          "It will not delete your cloud backup.",
        ]
      : [
          "This will copy your cloud backup onto this device.",
          "It will overwrite this device's current local data with cloud data.",
          "It will not delete your cloud backup.",
        ],
    confirmLabel: "Restore Data",
  };
}

export function getCloudRestoreAvailability({
  restorePreview = null,
  partialLocalSnapshot = false,
} = {}) {
  const status = asText(restorePreview?.status);
  const blockedReason = asText(restorePreview?.blockers?.[0]?.message)
    || asText(restorePreview?.error)
    || (status === CLOUD_RESTORE_STATUS.NO_CLOUD_DATA
      ? "No valid cloud backup is available to restore to this device."
      : "");
  const available = partialLocalSnapshot
    ? Boolean(restorePreview?.eligible && (restorePreview?.recoveryEligibleForPartialLocalSnapshot || !restorePreview?.partial))
    : Boolean(restorePreview?.eligible && !restorePreview?.partial);

  return {
    available,
    blockedReason: blockedReason || (
      partialLocalSnapshot
        ? "Restore is not available yet because the current cloud backup cannot safely rebuild the missing local records."
        : "Restore is not available on this device yet."
    ),
  };
}

export function buildPartialSnapshotRecheckMessage({
  restoreAvailable = false,
  blockedReason = "",
} = {}) {
  if (restoreAvailable) {
    return "Recheck complete. This device still has invoices but no local estimates. Restore cloud data to this device to rebuild the missing local records.";
  }
  const reason = asText(blockedReason);
  return reason
    ? `Recheck complete. Cloud backup still cannot rebuild the missing local estimates. ${reason}`
    : "Recheck complete. Cloud backup still cannot rebuild the missing local estimates on this device.";
}
