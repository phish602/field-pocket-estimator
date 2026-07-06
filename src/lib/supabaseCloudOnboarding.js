import { createSupabaseMigrationPreview } from "./supabaseMigrationPreview";
import { isSupabaseMigrationPreviewReady, runSupabaseMigrationWrite } from "./supabaseMigrationWriter";
import { runSupabaseCloudVerification } from "./supabaseCloudVerification";
import { clearCloudBackupDirty } from "./cloudBackupQueue";
import { readCloudPartialRecoveryStatus } from "./cloudPartialRecoveryStatus";
import { repairStoredLocalDataIntegrity } from "./localDataIntegrity";
import {
  checkEstimateRestorePayloadProtection,
  updateEstimateRestorePayloads,
  ESTIMATE_PAYLOAD_PROTECTION_STATUS,
  ESTIMATE_PAYLOAD_UPDATE_STATUS,
} from "./supabaseEstimateRestorePayload";

export const SUPABASE_CLOUD_ONBOARDING_VERSION = "supabase-cloud-onboarding-v1";

// Contractor-friendly status values. The screen owns the exact wording for
// each of these; this module only decides which one applies.
export const CLOUD_ONBOARDING_STATUS = {
  SIGNED_OUT: "signed_out",
  NO_WORKSPACE: "no_workspace",
  // Neither this device nor the cloud workspace has any core business data.
  NO_LOCAL_DATA: "no_local_data",
  // This device has no local core data, but the cloud workspace does
  // (e.g. a fresh second device signing into an already-backed-up workspace).
  CLOUD_AVAILABLE_EMPTY_DEVICE: "cloud_available_empty_device",
  // This device has local data and the cloud workspace has none yet.
  READY_TO_BACKUP: "ready_to_backup",
  ALREADY_BACKED_UP: "already_backed_up",
  // Both sides have core data, but verification could not confirm they match
  // (different device, partial sync, etc.) -- needs human review, not an
  // automatic merge or overwrite.
  LOCAL_CLOUD_MISMATCH: "local_cloud_mismatch",
  BACKUP_COMPLETED: "backup_completed",
  NEEDS_ATTENTION: "needs_attention",
  ERROR: "error",
};

const automaticSafeRepairRuns = new Map();

function asText(value) {
  return String(value || "").trim();
}

function normalizeLegacyIds(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => asText(value))
      .filter(Boolean)
  )].sort();
}

// Mirrors isSupabaseMigrationPreviewReady's own "is there anything to back
// up" definition so the two stay in agreement. Used by the explicit backup
// flow (Phase B), unchanged from Gate 9.
function totalLocalRecords(localCounts) {
  const counts = localCounts || {};
  return (
    Number(counts.customers || 0) +
    Number(counts.projects || 0) +
    Number(counts.estimates || 0) +
    Number(counts.invoices || 0) +
    Number(counts.invoicePayments || 0)
  );
}

// "Core" business docs only -- customers/projects/estimates/invoices. Used
// to classify device emptiness (Phase A). Line items and payments are
// dependent data: if their parent docs are zero, they don't change whether
// a device counts as empty.
function sumCoreDocCounts(counts) {
  const c = counts || {};
  return (
    Number(c.customers || 0) +
    Number(c.projects || 0) +
    Number(c.estimates || 0) +
    Number(c.invoices || 0)
  );
}

function buildHelperContext({ storageSnapshot, configured, user, company, role }) {
  return {
    storageSnapshot,
    configured: Boolean(configured),
    user,
    company,
    role,
    backupDownloadAvailable: true,
  };
}

// Read-only: signed-out / no-workspace are determined locally without any
// Supabase call.
function gateBasicPrerequisites({ configured, user, company }) {
  const userId = asText(user?.id);
  const companyId = asText(company?.id);

  if (!configured || !userId) return CLOUD_ONBOARDING_STATUS.SIGNED_OUT;
  if (!companyId) return CLOUD_ONBOARDING_STATUS.NO_WORKSPACE;
  return null;
}

function buildStatusResult(status, extra = {}) {
  return {
    onboardingVersion: SUPABASE_CLOUD_ONBOARDING_VERSION,
    status,
    preview: null,
    verification: null,
    writeResult: null,
    noWritesPerformed: true,
    automaticSafeRepair: null,
    ...extra,
  };
}

function buildBackupResult(status, extra = {}) {
  return {
    onboardingVersion: SUPABASE_CLOUD_ONBOARDING_VERSION,
    status,
    preview: null,
    verification: null,
    writeResult: null,
    noLocalDeletes: true,
    ...extra,
  };
}

function getRepairableMissingEstimatePayloadIds(protectionCheck) {
  return Array.isArray(protectionCheck?.repairableMissingLegacyIds)
    ? protectionCheck.repairableMissingLegacyIds
    : [];
}

function hasAutomaticSafeRepairCandidate(preview) {
  return Boolean(preview?.integrity?.backupReadiness?.canProceedAfterSafeRepair);
}

function buildAutomaticSafeRepairState(extra = {}) {
  return {
    attempted: false,
    succeeded: false,
    failed: false,
    repairChanged: false,
    technicalDetail: "",
    ...extra,
  };
}

function buildAutomaticSafeRepairFailureResult({
  preview = null,
  repairedIntegrity = null,
  technicalDetail = "",
  writeResult = null,
  verification = null,
} = {}) {
  return buildStatusResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, {
    preview: preview ? { ...preview, integrity: repairedIntegrity || preview.integrity || null } : null,
    verification,
    writeResult,
    error: "We could not finish protecting this device automatically.",
    noWritesPerformed: false,
    automaticSafeRepair: buildAutomaticSafeRepairState({
      attempted: true,
      failed: true,
      technicalDetail: asText(technicalDetail),
    }),
  });
}

async function runAutomaticSafeRepairAndBackup({
  preview,
  storageSnapshot,
  configured,
  user,
  company,
  role,
} = {}) {
  let repaired;
  try {
    repaired = repairStoredLocalDataIntegrity(storageSnapshot);
  } catch (error) {
    return buildAutomaticSafeRepairFailureResult({
      preview,
      technicalDetail: asText(error?.message) || "Automatic safe repair could not run.",
    });
  }

  const repairedIntegrity = repaired?.integrity || preview?.integrity || null;
  const remainingSafeRepairs = Array.isArray(repairedIntegrity?.safeRepairs) ? repairedIntegrity.safeRepairs : [];
  const firstRemainingIssue = repairedIntegrity?.backupReadiness?.firstBlocker || remainingSafeRepairs[0] || null;

  if (!repaired?.changed || repairedIntegrity?.backupReadiness?.blocked || remainingSafeRepairs.length > 0) {
    return buildAutomaticSafeRepairFailureResult({
      preview,
      repairedIntegrity,
      technicalDetail: asText(firstRemainingIssue?.message) || "Automatic safe repair could not clear the remaining backup issue.",
    });
  }

  let backupResult;
  try {
    backupResult = await runSupabaseCloudOnboardingBackup({
      storageSnapshot,
      configured,
      user,
      company,
      role,
    });
  } catch (error) {
    return buildAutomaticSafeRepairFailureResult({
      preview,
      repairedIntegrity,
      technicalDetail: asText(error?.message) || "Automatic backup protection did not finish cleanly.",
    });
  }

  if (backupResult?.status !== CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED) {
    return buildAutomaticSafeRepairFailureResult({
      preview: backupResult?.preview || preview,
      repairedIntegrity: backupResult?.preview?.integrity || repairedIntegrity,
      technicalDetail: asText(
        backupResult?.writeResult?.notices?.find((notice) => notice?.level !== "info")?.message
        || backupResult?.verification?.notices?.find((notice) => notice?.level !== "info")?.message
        || backupResult?.error
      ) || "Automatic backup protection did not finish cleanly.",
      writeResult: backupResult?.writeResult || null,
      verification: backupResult?.verification || null,
    });
  }

  return {
    ...backupResult,
    automaticSafeRepair: buildAutomaticSafeRepairState({
      attempted: true,
      succeeded: true,
      repairChanged: Boolean(repaired?.changed),
    }),
  };
}

// Phase A: status check. Runs migration preview and, when the only problem
// is an already-classified safe local metadata repair, finishes that repair
// plus one guarded backup attempt automatically before returning a user-
// facing status. Otherwise it remains read-only.
export async function checkSupabaseCloudOnboardingStatus({
  storageSnapshot,
  configured = false,
  user = null,
  company = null,
  role = "",
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated) return buildStatusResult(gated);

  const context = buildHelperContext({ storageSnapshot, configured, user, company, role });

  try {
    const preview = await createSupabaseMigrationPreview(context);
    if (preview?.integrity?.backupReadiness?.blocked) {
      return buildStatusResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, { preview });
    }
    if (hasAutomaticSafeRepairCandidate(preview)) {
      const runKey = `${asText(company?.id)}:${asText(user?.id)}:${JSON.stringify(
        (Array.isArray(preview?.integrity?.safeRepairs) ? preview.integrity.safeRepairs : []).map((issue) => ({
          code: asText(issue?.code),
          count: Number(issue?.details?.count || 0),
          entityIds: Array.isArray(issue?.details?.entityIds) ? issue.details.entityIds : [],
        }))
      )}`;
      if (!automaticSafeRepairRuns.has(runKey)) {
        automaticSafeRepairRuns.set(runKey, runAutomaticSafeRepairAndBackup({
          preview,
          storageSnapshot,
          configured,
          user,
          company,
          role,
        }).finally(() => {
          automaticSafeRepairRuns.delete(runKey);
        }));
      }
      return automaticSafeRepairRuns.get(runKey);
    }
    const localCoreCount = sumCoreDocCounts(preview?.localCounts);
    const cloudCountKnown = Boolean(preview?.cloudCountCheckAvailable);
    const cloudCoreCount = cloudCountKnown ? sumCoreDocCounts(preview?.cloudCounts) : 0;

    if (localCoreCount === 0) {
      // This device has no estimates/invoices/customers/projects of its own.
      // Distinguish "nothing exists yet anywhere" from "a second device
      // signing into a workspace that's already backed up".
      return buildStatusResult(
        cloudCoreCount > 0 ? CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE : CLOUD_ONBOARDING_STATUS.NO_LOCAL_DATA,
        { preview }
      );
    }

    if (cloudCountKnown && cloudCoreCount === 0) {
      // Confidently empty cloud -- no need for a row-level verification call.
      return buildStatusResult(CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP, { preview });
    }

    // Both sides may have data (or the cloud count check itself failed) --
    // only a precise id-level comparison can tell us whether they actually
    // match, so this is the one case verification is worth the extra reads.
    const verification = await runSupabaseCloudVerification(context);

    return buildStatusResult(
      verification?.allMatched ? CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP : CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
      { preview, verification }
    );
  } catch (error) {
    return buildStatusResult(CLOUD_ONBOARDING_STATUS.ERROR, {
      error: asText(error?.message) || "Unable to check cloud backup status.",
    });
  }
}

// Phase B: explicit one-click backup. Only called from a direct user click.
// Runs preview -> migration write (only if preview is safe) -> verification,
// in that order, and only reports success if verification confirms the
// write actually landed. Never weakens the underlying writer's own safety
// checks (idempotency, role gating, local-validation blocking) -- it simply
// surfaces a writer block as "needs_attention" instead of a false success.
export async function runSupabaseCloudOnboardingBackup({
  storageSnapshot,
  configured = false,
  user = null,
  company = null,
  role = "",
  allowCloudOnlyReplacement = false,
  preservedSkippedEstimateLegacyIds = null,
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated) return buildBackupResult(gated);

  const context = buildHelperContext({ storageSnapshot, configured, user, company, role });
  const explicitPreservedSkippedEstimateLegacyIds = normalizeLegacyIds(preservedSkippedEstimateLegacyIds);
  const storedRecoveryStatus = explicitPreservedSkippedEstimateLegacyIds.length === 0
    ? readCloudPartialRecoveryStatus(storageSnapshot)
    : null;
  const effectivePreservedSkippedEstimateLegacyIds = explicitPreservedSkippedEstimateLegacyIds.length > 0
    ? explicitPreservedSkippedEstimateLegacyIds
    : normalizeLegacyIds(storedRecoveryStatus?.skippedEstimateIds);

  try {
    const preview = await createSupabaseMigrationPreview(context);

    if (totalLocalRecords(preview?.localCounts) === 0) {
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.NO_LOCAL_DATA, { preview });
    }

    if (preview?.integrity?.backupReadiness?.blocked) {
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, { preview });
    }

    if (!isSupabaseMigrationPreviewReady(preview)) {
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, { preview });
    }

    const payloadProtection = await checkEstimateRestorePayloadProtection({
      storageSnapshot,
      configured,
      user,
      company,
      preservedSkippedEstimateLegacyIds: effectivePreservedSkippedEstimateLegacyIds,
    });
    const repairableMissingEstimatePayloadIds = getRepairableMissingEstimatePayloadIds(payloadProtection);
    let payloadRepairResult = null;

    if (payloadProtection?.status === ESTIMATE_PAYLOAD_PROTECTION_STATUS.ERROR) {
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.ERROR, {
        preview,
        payloadProtection,
        error: payloadProtection.error || "Unable to inspect estimate backup protection.",
      });
    }

    if (repairableMissingEstimatePayloadIds.length > 0) {
      payloadRepairResult = await updateEstimateRestorePayloads({
        storageSnapshot,
        configured,
        user,
        company,
      });

      if (
        payloadRepairResult?.status !== ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED
        || (Array.isArray(payloadRepairResult?.failed) && payloadRepairResult.failed.length > 0)
      ) {
        return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, {
          preview,
          payloadProtection,
          payloadRepairResult,
        });
      }

      const postRepairProtection = await checkEstimateRestorePayloadProtection({
        storageSnapshot,
        configured,
        user,
        company,
        preservedSkippedEstimateLegacyIds: effectivePreservedSkippedEstimateLegacyIds,
      });
      if (getRepairableMissingEstimatePayloadIds(postRepairProtection).length > 0) {
        return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, {
          preview,
          payloadProtection: postRepairProtection,
          payloadRepairResult,
        });
      }
    }

    const writeResult = await runSupabaseMigrationWrite({
      ...context,
      preview,
      allowCloudOnlyReplacement,
      preservedSkippedEstimateLegacyIds: effectivePreservedSkippedEstimateLegacyIds,
    });

    if (!writeResult?.ok) {
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, { preview, writeResult });
    }

    const verification = await runSupabaseCloudVerification({
      ...context,
      preservedSkippedEstimateLegacyIds: effectivePreservedSkippedEstimateLegacyIds,
    });

    if (!verification?.ok || !verification?.allMatched) {
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, { preview, writeResult, verification });
    }

    // Verification confirmed the cloud write actually landed and matches
    // local data -- the queue is current, not just "attempted".
    clearCloudBackupDirty("manual_backup_success");

    return buildBackupResult(CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED, { preview, writeResult, verification });
  } catch (error) {
    return buildBackupResult(CLOUD_ONBOARDING_STATUS.ERROR, {
      error: asText(error?.message) || "Unable to complete cloud backup.",
    });
  }
}
