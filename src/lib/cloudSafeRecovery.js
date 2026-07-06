// @ts-nocheck
/* eslint-disable */

// Gate 13O-2K: Home-first "Recover What Can Be Safely Recovered". Chains the
// existing cloud export (exportSupabaseCloudBackupArtifact) and the existing
// backup JSON import contract (buildBackupJsonImportPlan /
// applyBackupJsonImportPlan) entirely in memory, so a user on a fresh device
// never has to download a JSON file, walk to Settings, and re-import it just
// to get their safe records back.
//
// Safety inherited from those two contracts, not re-implemented here:
// - estimates without a valid restore_payload are excluded by the export
//   (never rebuilt from guessed math) and reported as skipped counts;
// - empty cloud collections never overwrite existing local collections;
// - a failed cloud table read aborts with the failing table instead of
//   silently recovering nothing.
// The preview/apply split exists so the UI can show exact counts in a
// confirmation dialog BEFORE anything is written.

import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  exportSupabaseCloudBackupArtifact,
  CLOUD_BACKUP_EXPORT_STATUS,
} from "./supabaseCloudRestore";
import { buildBackupJsonImportPlan, applyBackupJsonImportPlan } from "./backupJsonImport";

export const SAFE_CLOUD_RECOVERY_STATUS = {
  SIGNED_OUT: "signed_out",
  NO_WORKSPACE: "no_workspace",
  NOTHING_TO_RECOVER: "nothing_to_recover",
  PREVIEWED: "previewed",
  RECOVERED: "recovered",
  ERROR: "error",
};

function emptyCounts() {
  return { customers: 0, projects: 0, estimates: 0, invoices: 0, invoicePayments: 0 };
}

/**
 * Phase A: read-only. Fetches the cloud artifact and builds the local write
 * plan without writing anything, so callers can confirm with exact counts.
 */
export async function previewSafeCloudRecovery({ configured = false, user = null, company = null } = {}) {
  const exportResult = await exportSupabaseCloudBackupArtifact({ configured, user, company });

  if (exportResult.status === CLOUD_BACKUP_EXPORT_STATUS.SIGNED_OUT) {
    return { status: SAFE_CLOUD_RECOVERY_STATUS.SIGNED_OUT, error: exportResult.error, counts: emptyCounts(), skippedEstimates: 0, plan: null };
  }
  if (exportResult.status === CLOUD_BACKUP_EXPORT_STATUS.NO_WORKSPACE) {
    return { status: SAFE_CLOUD_RECOVERY_STATUS.NO_WORKSPACE, error: exportResult.error, counts: emptyCounts(), skippedEstimates: 0, plan: null };
  }
  if (exportResult.status !== CLOUD_BACKUP_EXPORT_STATUS.EXPORTED || !exportResult.artifact) {
    return {
      status: SAFE_CLOUD_RECOVERY_STATUS.ERROR,
      error: String(exportResult.error || "Unable to read cloud data for recovery."),
      failedTable: String(exportResult.failedTable || ""),
      counts: emptyCounts(),
      skippedEstimates: 0,
      plan: null,
    };
  }

  const artifact = exportResult.artifact;
  const plan = buildBackupJsonImportPlan(artifact);
  if (!plan.ok) {
    return {
      status: SAFE_CLOUD_RECOVERY_STATUS.ERROR,
      error: String(plan.blockedReason || "Cloud data could not be mapped for recovery."),
      counts: emptyCounts(),
      skippedEstimates: 0,
      plan: null,
    };
  }

  const skippedEstimates = Number(artifact?.restorePayloadCoverage?.estimatesMissingRestorePayload || 0);

  if (plan.coreRecordTotal === 0) {
    return {
      status: SAFE_CLOUD_RECOVERY_STATUS.NOTHING_TO_RECOVER,
      error: "",
      counts: plan.counts,
      skippedEstimates,
      plan: null,
    };
  }

  return {
    status: SAFE_CLOUD_RECOVERY_STATUS.PREVIEWED,
    error: "",
    counts: plan.counts,
    skippedEstimates,
    warnings: plan.warnings,
    plan,
    settings: plan.settings,
  };
}

function dispatchChangeEvents(settingsWritten) {
  try {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new Event("estipaid:customers-changed"));
    window.dispatchEvent(new Event("estipaid:projects-changed"));
    window.dispatchEvent(new Event("estipaid:estimates-changed"));
    window.dispatchEvent(new Event("estipaid:invoices-changed"));
    if (settingsWritten) window.dispatchEvent(new Event("estipaid:settings-changed"));
  } catch {
    // Best-effort same-tab refresh only; the recovery itself already succeeded.
  }
}

/**
 * Phase B: applies a PREVIEWED recovery to local storage. Only call after
 * the user explicitly confirmed the previewed counts.
 */
export function applySafeCloudRecovery({ preview, storage } = {}) {
  if (preview?.status !== SAFE_CLOUD_RECOVERY_STATUS.PREVIEWED || !preview.plan || !storage) {
    return {
      status: SAFE_CLOUD_RECOVERY_STATUS.ERROR,
      error: "Nothing to recover: run the recovery preview first.",
      recoveredCounts: emptyCounts(),
      skippedEstimates: 0,
    };
  }

  const applied = applyBackupJsonImportPlan({ plan: preview.plan, storage });

  // Cloud-sourced settings are written whole (same as full cloud restore) --
  // this recovery only runs on effectively-empty devices.
  let settingsWritten = false;
  if (preview.settings && typeof preview.settings === "object") {
    try {
      storage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(preview.settings));
      settingsWritten = true;
    } catch {}
  }

  dispatchChangeEvents(settingsWritten);

  return {
    status: SAFE_CLOUD_RECOVERY_STATUS.RECOVERED,
    error: "",
    recoveredCounts: applied.importedCounts,
    skippedEstimates: preview.skippedEstimates,
    writeCount: applied.writeCount,
    settingsWritten,
  };
}
