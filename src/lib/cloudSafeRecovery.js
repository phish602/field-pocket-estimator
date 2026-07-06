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
import {
  buildLocalSnapshotFromStorage,
  scanLocalDataIntegrity,
  repairStoredLocalDataIntegrity,
} from "./localDataIntegrity";
import {
  runSupabaseCloudOnboardingBackup,
  CLOUD_ONBOARDING_STATUS,
} from "./supabaseCloudOnboarding";
import { clearCloudBackupDirty } from "./cloudBackupQueue";

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

// ---------------------------------------------------------------------------
// Gate 13O-2L: recovery continuation. After safe recovery writes local data,
// this single pipeline finishes the job the way a contractor expects:
// check the recovered records -> run the existing safe repair if one is
// available -> re-check -> back up to cloud automatically ONLY when no
// blockers remain -> report a plain-language final state. It never loops,
// never backs up over inconsistent local data, and never invents data.
// ---------------------------------------------------------------------------

export const RECOVERY_CONTINUATION_STATUS = {
  BACKED_UP: "backed_up",
  BACKED_UP_WITH_SKIPPED: "backed_up_with_skipped",
  PAUSED: "paused",
  ERROR: "error",
};

// Contractor-facing reason for a paused backup. Technical blocker codes stay
// available to callers for collapsed "technical details" only.
export function describeBackupPauseReason(blocker) {
  const code = String(blocker?.code || "").trim();
  if (code === "estimate_project_missing" || code === "estimate_project_stale") {
    return "Some recovered estimates are not linked to a job.";
  }
  if (code === "estimate_customer_missing" || code === "project_customer_missing" || code === "invoice_customer_missing") {
    return "Some records are not linked to a customer.";
  }
  if (code === "invoice_number_missing") {
    return "Some invoices are missing invoice numbers.";
  }
  if (code === "empty_estimates_with_invoices") {
    return "This device has invoices but no estimates, so backup is paused to protect your cloud data.";
  }
  return "Some records need attention before backup.";
}

function scanStoredIntegrity(storage) {
  try {
    return scanLocalDataIntegrity(buildLocalSnapshotFromStorage(storage).snapshot);
  } catch {
    return null;
  }
}

function firstIntegrityBlocker(integrity) {
  const blockers = Array.isArray(integrity?.blockers) ? integrity.blockers : [];
  return blockers[0] || null;
}

// After a partial safe recovery, the cloud legitimately keeps rows this
// device could not take: the skipped (payload-less) estimates and their
// line items. A backup verification that mismatches ONLY in that exact way
// means every local record IS safely in the cloud -- reporting it as a
// failure would tell the contractor their backup is broken when it isn't.
// Anything else (missing local rows in cloud, other tables off) stays a
// real problem and is never reclassified.
function isSkippedEstimateOnlyMismatch(verification, skippedEstimates) {
  const results = Array.isArray(verification?.tableResults) ? verification.tableResults : [];
  if (!verification?.ok || results.length === 0 || Number(skippedEstimates) <= 0) return false;
  return results.every((result) => {
    if (result?.status === "matched") return true;
    if (result?.status !== "mismatch") return false;
    const missing = Array.isArray(result?.missingLegacyIds) ? result.missingLegacyIds.length : 0;
    const extra = Array.isArray(result?.extraLegacyIds) ? result.extraLegacyIds.length : 0;
    if (result?.table === "estimates") {
      return missing === 0 && extra > 0 && extra <= Number(skippedEstimates);
    }
    if (result?.table === "estimate_line_items") {
      return Boolean(result?.countOnly) && Number(result?.cloudCount || 0) > Number(result?.localCount || 0);
    }
    return false;
  });
}

/**
 * Runs the post-recovery pipeline: integrity -> safe repair -> integrity ->
 * automatic cloud backup (only when blocker-free) -> plain-language result.
 * Backup itself re-validates through the existing safe onboarding path, so
 * this can never bypass the writer's own checks. onPhase (optional) receives
 * "checking" | "repairing" | "backing_up" for UI progress.
 */
export async function runRecoveryContinuation({
  configured = false,
  user = null,
  company = null,
  role = "",
  storage = null,
  skippedEstimates = 0,
  onPhase = null,
} = {}) {
  const notifyPhase = (phase) => {
    try {
      if (typeof onPhase === "function") onPhase(phase);
    } catch {}
  };

  notifyPhase("checking");
  let integrity = scanStoredIntegrity(storage);
  if (!integrity) {
    return {
      status: RECOVERY_CONTINUATION_STATUS.ERROR,
      error: "Could not check the recovered records on this device.",
      backupRan: false,
      repairChanged: false,
      skippedEstimates,
    };
  }

  // One safe-repair pass, then one re-scan -- never a loop.
  let repairChanged = false;
  let repairs = null;
  if (Array.isArray(integrity.safeRepairs) && integrity.safeRepairs.length > 0) {
    notifyPhase("repairing");
    try {
      const repaired = repairStoredLocalDataIntegrity(storage);
      repairChanged = Boolean(repaired?.changed);
      repairs = repaired?.repairs || null;
      integrity = repaired?.integrity || scanStoredIntegrity(storage);
    } catch {
      integrity = scanStoredIntegrity(storage);
    }
  }

  const blockers = Array.isArray(integrity?.blockers) ? integrity.blockers : [];
  if (!integrity || blockers.length > 0) {
    const firstBlocker = blockers[0] || null;
    return {
      status: RECOVERY_CONTINUATION_STATUS.PAUSED,
      backupRan: false,
      repairChanged,
      repairs,
      skippedEstimates,
      pausedReason: describeBackupPauseReason(firstBlocker),
      pausedReasonCode: String(firstBlocker?.code || "integrity_unavailable"),
      technicalDetail: String(firstBlocker?.message || "Local integrity could not be confirmed."),
    };
  }

  notifyPhase("backing_up");
  let backup = null;
  try {
    backup = await runSupabaseCloudOnboardingBackup({
      storageSnapshot: storage,
      configured,
      user,
      company,
      role,
    });
  } catch (error) {
    return {
      status: RECOVERY_CONTINUATION_STATUS.ERROR,
      error: "Backup could not finish. Your recovered data is saved on this device.",
      technicalDetail: String(error?.message || ""),
      backupRan: true,
      repairChanged,
      repairs,
      skippedEstimates,
    };
  }

  if (backup?.status === CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED) {
    return {
      status: Number(skippedEstimates) > 0
        ? RECOVERY_CONTINUATION_STATUS.BACKED_UP_WITH_SKIPPED
        : RECOVERY_CONTINUATION_STATUS.BACKED_UP,
      backupRan: true,
      repairChanged,
      repairs,
      skippedEstimates,
    };
  }

  if (backup?.writeResult?.ok && isSkippedEstimateOnlyMismatch(backup?.verification, skippedEstimates)) {
    // Every local record verified in cloud; the only difference is the
    // skipped estimates the cloud is intentionally keeping. Local changes
    // are backed up, so the queue is current.
    clearCloudBackupDirty("safe_recovery_backup_success");
    return {
      status: RECOVERY_CONTINUATION_STATUS.BACKED_UP_WITH_SKIPPED,
      backupRan: true,
      repairChanged,
      repairs,
      skippedEstimates,
    };
  }

  const backupBlocker = backup?.preview?.integrity?.backupReadiness?.firstBlocker
    || firstIntegrityBlocker(scanStoredIntegrity(storage));
  if (backupBlocker) {
    return {
      status: RECOVERY_CONTINUATION_STATUS.PAUSED,
      backupRan: true,
      repairChanged,
      repairs,
      skippedEstimates,
      pausedReason: describeBackupPauseReason(backupBlocker),
      pausedReasonCode: String(backupBlocker?.code || backup?.status || "backup_incomplete"),
      technicalDetail: String(backupBlocker?.message || backup?.error || ""),
    };
  }

  return {
    status: RECOVERY_CONTINUATION_STATUS.PAUSED,
    backupRan: true,
    repairChanged,
    repairs,
    skippedEstimates,
    pausedReason: "Backup could not finish yet. Your recovered data is saved on this device.",
    pausedReasonCode: String(backup?.status || "backup_incomplete"),
    technicalDetail: String(backup?.error || ""),
  };
}
