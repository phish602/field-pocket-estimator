import { createSupabaseMigrationPreview } from "./supabaseMigrationPreview";
import { isSupabaseMigrationPreviewReady, runSupabaseMigrationWrite } from "./supabaseMigrationWriter";
import { runSupabaseCloudVerification } from "./supabaseCloudVerification";
import { clearCloudBackupDirty } from "./cloudBackupQueue";
import { getSupabaseClient } from "./supabaseClient";
import { clearCloudPartialRecoveryStatus, readCloudPartialRecoveryStatus } from "./cloudPartialRecoveryStatus";
import { buildLocalSnapshotFromStorage, repairStoredLocalDataIntegrity } from "./localDataIntegrity";
import {
  checkEstimateRestorePayloadProtection,
  updateEstimateRestorePayloads,
  ESTIMATE_PAYLOAD_PROTECTION_STATUS,
  ESTIMATE_PAYLOAD_UPDATE_STATUS,
} from "./supabaseEstimateRestorePayload";
import { ensureCurrentDeviceCanWriteCloud } from "./supabaseDeviceLock";

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

export const PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS = {
  SIGNED_OUT: CLOUD_ONBOARDING_STATUS.SIGNED_OUT,
  NO_WORKSPACE: CLOUD_ONBOARDING_STATUS.NO_WORKSPACE,
  NOTHING_TO_CLEAN: "nothing_to_clean",
  REFUSED: "refused",
  COMPLETED: "completed",
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

function buildPreservedEstimateCleanupResult(status, extra = {}) {
  return {
    onboardingVersion: SUPABASE_CLOUD_ONBOARDING_VERSION,
    status,
    deletedEstimateCount: 0,
    deletedEstimateLineItemCount: 0,
    verification: null,
    noLocalDeletes: true,
    clearedPartialRecoveryStatus: false,
    ...extra,
  };
}

function getRepairableMissingEstimatePayloadIds(protectionCheck) {
  return Array.isArray(protectionCheck?.repairableMissingLegacyIds)
    ? protectionCheck.repairableMissingLegacyIds
    : [];
}

function extractLocalInvoiceSourceEstimateId(invoice) {
  return asText(
    invoice?.sourceEstimateId
    || invoice?.sourceEstimateLegacyId
    || invoice?.convertedFromEstimateId
    || invoice?.metadata?.sourceEstimateId
    || invoice?.sourceEstimateSnapshot?.estimateId
  );
}

function buildLocalIdSet(records) {
  return new Set(
    (Array.isArray(records) ? records : [])
      .map((record) => asText(record?.id))
      .filter(Boolean)
  );
}

async function readCompanyRowsByColumnIn(client, table, companyId, column, values, columns = "id") {
  const normalizedValues = normalizeLegacyIds(values);
  if (normalizedValues.length === 0) {
    return { rows: [], error: null };
  }

  try {
    const response = await client
      .from(table)
      .select(columns)
      .eq("company_id", companyId)
      .in(column, normalizedValues);

    if (response?.error) {
      return { rows: null, error: response.error };
    }
    return { rows: Array.isArray(response?.data) ? response.data : [], error: null };
  } catch (error) {
    return { rows: null, error };
  }
}

async function deleteCompanyRowsByColumnIn(client, table, companyId, column, values) {
  const normalizedValues = normalizeLegacyIds(values);
  if (normalizedValues.length === 0) {
    return { error: null };
  }

  try {
    const response = await client
      .from(table)
      .delete()
      .eq("company_id", companyId)
      .in(column, normalizedValues);

    return { error: response?.error || null };
  } catch (error) {
    return { error };
  }
}

function buildPreservedEstimateCleanupRefusal(message, details = {}) {
  return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.REFUSED, {
    error: "We could not safely remove those older estimates automatically.",
    technicalDetail: asText(message) || "Cleanup safety checks did not pass.",
    ...details,
  });
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
  // This path repairs local business metadata before attempting backup, so it
  // needs the same fresh ownership check as a cloud write. It can run from a
  // status effect without a visible user click.
  const deviceAccess = await ensureCurrentDeviceCanWriteCloud({
    configured,
    user,
    company,
    storage: storageSnapshot,
    reason: "local_save",
    claimIfMissing: false,
  });
  if (!deviceAccess.ok) {
    return buildStatusResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, {
      preview,
      error: deviceAccess.userMessage || deviceAccess.error,
      noWritesPerformed: true,
      automaticSafeRepair: buildAutomaticSafeRepairState({
        attempted: true,
        failed: true,
        technicalDetail: deviceAccess.userMessage || deviceAccess.error,
      }),
    });
  }

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

export async function removePreservedOlderCloudEstimates({
  storageSnapshot,
  configured = false,
  user = null,
  company = null,
  role = "",
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated) return buildPreservedEstimateCleanupResult(gated);

  const deviceAccess = await ensureCurrentDeviceCanWriteCloud({
    configured,
    user,
    company,
    storage: storageSnapshot,
    reason: "replace_cloud",
  });
  if (!deviceAccess.ok) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR, {
      error: deviceAccess.userMessage || deviceAccess.error,
      technicalDetail: deviceAccess.userMessage || deviceAccess.error,
      code: deviceAccess.code,
      deviceLockLost: deviceAccess.deviceLockLost,
    });
  }

  const storedRecoveryStatus = readCloudPartialRecoveryStatus(storageSnapshot);
  const preservedEstimateLegacyIds = normalizeLegacyIds(storedRecoveryStatus?.skippedEstimateIds);
  const skippedEstimateCount = Number(storedRecoveryStatus?.skippedEstimateCount || 0);

  if (!storedRecoveryStatus?.olderEstimatesKeptInCloud) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.NOTHING_TO_CLEAN, {
      technicalDetail: "No preserved older-estimate recovery state is stored on this device.",
    });
  }

  if (skippedEstimateCount !== 3 || preservedEstimateLegacyIds.length !== 3) {
    return buildPreservedEstimateCleanupRefusal(
      "Stored partial recovery status does not contain the exact 3 preserved estimate ids required for cleanup.",
      {
        skippedEstimateCount,
        preservedEstimateLegacyIds,
      }
    );
  }

  const { snapshot: localSnapshot } = buildLocalSnapshotFromStorage(storageSnapshot);
  const localEstimateIds = buildLocalIdSet(localSnapshot?.estimates);
  const preservedEstimateIdSet = new Set(preservedEstimateLegacyIds);
  const localMatches = preservedEstimateLegacyIds.filter((legacyId) => localEstimateIds.has(legacyId));
  if (localMatches.length > 0) {
    return buildPreservedEstimateCleanupRefusal(
      "One or more preserved older estimates are already present on this device.",
      {
        localEstimateLegacyIds: localMatches,
        preservedEstimateLegacyIds,
      }
    );
  }

  const localInvoiceIdsReferencingPreservedEstimates = (Array.isArray(localSnapshot?.invoices) ? localSnapshot.invoices : [])
    .filter((invoice) => preservedEstimateIdSet.has(extractLocalInvoiceSourceEstimateId(invoice)))
    .map((invoice) => asText(invoice?.id))
    .filter(Boolean)
    .sort();
  if (localInvoiceIdsReferencingPreservedEstimates.length > 0) {
    return buildPreservedEstimateCleanupRefusal(
      "One or more local invoices still reference those preserved older estimates.",
      {
        localInvoiceIds: localInvoiceIdsReferencingPreservedEstimates,
        preservedEstimateLegacyIds,
      }
    );
  }

  const client = getSupabaseClient();
  if (!client?.from) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR, {
      error: "We could not safely remove those older estimates automatically.",
      technicalDetail: "Supabase is not configured.",
    });
  }

  const companyId = asText(company?.id);
  const context = buildHelperContext({ storageSnapshot, configured, user, company, role });
  const cloudEstimateRead = await readCompanyRowsByColumnIn(
    client,
    "estimates",
    companyId,
    "legacy_local_id",
    preservedEstimateLegacyIds,
    "id, legacy_local_id"
  );
  if (cloudEstimateRead.error) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR, {
      error: "We could not safely remove those older estimates automatically.",
      technicalDetail: asText(cloudEstimateRead.error?.message) || "Unable to read the preserved cloud estimates.",
      preservedEstimateLegacyIds,
    });
  }

  const cloudEstimateRows = Array.isArray(cloudEstimateRead.rows) ? cloudEstimateRead.rows : [];
  const matchedCloudEstimateLegacyIds = normalizeLegacyIds(
    cloudEstimateRows.map((row) => asText(row?.legacy_local_id))
  );
  const missingCloudEstimateLegacyIds = preservedEstimateLegacyIds.filter(
    (legacyId) => !matchedCloudEstimateLegacyIds.includes(legacyId)
  );
  if (
    cloudEstimateRows.length !== 3
    || matchedCloudEstimateLegacyIds.length !== 3
    || missingCloudEstimateLegacyIds.length > 0
  ) {
    return buildPreservedEstimateCleanupRefusal(
      "The exact 3 preserved older cloud estimates could not be confirmed for cleanup.",
      {
        preservedEstimateLegacyIds,
        matchedCloudEstimateLegacyIds,
        missingCloudEstimateLegacyIds,
      }
    );
  }

  const cloudEstimateRowIds = cloudEstimateRows
    .map((row) => asText(row?.id))
    .filter(Boolean)
    .sort();
  if (cloudEstimateRowIds.length !== 3) {
    return buildPreservedEstimateCleanupRefusal(
      "One or more preserved cloud estimate rows are missing stable cloud ids.",
      {
        preservedEstimateLegacyIds,
        cloudEstimateRowIds,
      }
    );
  }

  const cloudInvoiceRead = await readCompanyRowsByColumnIn(
    client,
    "invoices",
    companyId,
    "source_estimate_legacy_id",
    preservedEstimateLegacyIds,
    "id, legacy_local_id, source_estimate_legacy_id"
  );
  if (cloudInvoiceRead.error) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR, {
      error: "We could not safely remove those older estimates automatically.",
      technicalDetail: asText(cloudInvoiceRead.error?.message) || "Unable to inspect cloud invoices linked to those estimates.",
      preservedEstimateLegacyIds,
    });
  }

  const cloudInvoicesReferencingPreservedEstimates = Array.isArray(cloudInvoiceRead.rows)
    ? cloudInvoiceRead.rows.map((row) => ({
      id: asText(row?.id),
      legacyLocalId: asText(row?.legacy_local_id),
      sourceEstimateLegacyId: asText(row?.source_estimate_legacy_id),
    }))
    : [];
  if (cloudInvoicesReferencingPreservedEstimates.length > 0) {
    return buildPreservedEstimateCleanupRefusal(
      "One or more cloud invoices still reference those preserved older estimates.",
      {
        preservedEstimateLegacyIds,
        cloudInvoicesReferencingPreservedEstimates,
      }
    );
  }

  const lineItemRead = await readCompanyRowsByColumnIn(
    client,
    "estimate_line_items",
    companyId,
    "estimate_id",
    cloudEstimateRowIds,
    "id, estimate_id"
  );
  if (lineItemRead.error) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR, {
      error: "We could not safely remove those older estimates automatically.",
      technicalDetail: asText(lineItemRead.error?.message) || "Unable to inspect estimate line items for those older estimates.",
      preservedEstimateLegacyIds,
      cloudEstimateRowIds,
    });
  }

  const estimateLineItemRows = Array.isArray(lineItemRead.rows) ? lineItemRead.rows : [];
  const lineItemDeleteAccess = await ensureCurrentDeviceCanWriteCloud({
    configured,
    user,
    company,
    storage: storageSnapshot,
    reason: "replace_cloud",
    claimIfMissing: false,
  });
  if (!lineItemDeleteAccess.ok) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR, {
      error: lineItemDeleteAccess.userMessage || lineItemDeleteAccess.error,
      technicalDetail: lineItemDeleteAccess.userMessage || lineItemDeleteAccess.error,
      code: lineItemDeleteAccess.code,
      deviceLockLost: lineItemDeleteAccess.deviceLockLost,
    });
  }
  const deleteLineItems = await deleteCompanyRowsByColumnIn(
    client,
    "estimate_line_items",
    companyId,
    "estimate_id",
    cloudEstimateRowIds
  );
  if (deleteLineItems.error) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR, {
      error: "We could not safely remove those older estimates automatically.",
      technicalDetail: asText(deleteLineItems.error?.message) || "Unable to delete the preserved estimate line items.",
      preservedEstimateLegacyIds,
      cloudEstimateRowIds,
    });
  }

  const estimateDeleteAccess = await ensureCurrentDeviceCanWriteCloud({
    configured,
    user,
    company,
    storage: storageSnapshot,
    reason: "replace_cloud",
    claimIfMissing: false,
  });
  if (!estimateDeleteAccess.ok) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR, {
      error: estimateDeleteAccess.userMessage || estimateDeleteAccess.error,
      technicalDetail: estimateDeleteAccess.userMessage || estimateDeleteAccess.error,
      code: estimateDeleteAccess.code,
      deviceLockLost: estimateDeleteAccess.deviceLockLost,
    });
  }
  const deleteEstimates = await deleteCompanyRowsByColumnIn(
    client,
    "estimates",
    companyId,
    "id",
    cloudEstimateRowIds
  );
  if (deleteEstimates.error) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR, {
      error: "We could not safely remove those older estimates automatically.",
      technicalDetail: asText(deleteEstimates.error?.message) || "Unable to delete the preserved cloud estimates.",
      preservedEstimateLegacyIds,
      cloudEstimateRowIds,
      deletedEstimateLineItemCount: estimateLineItemRows.length,
    });
  }

  const verification = await runSupabaseCloudVerification(context);
  if (!verification?.ok || !verification?.allMatched) {
    return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.ERROR, {
      error: "We could not safely remove those older estimates automatically.",
      technicalDetail: "Cloud verification did not pass after removing the preserved older estimates.",
      verification,
      preservedEstimateLegacyIds,
      cloudEstimateRowIds,
      deletedEstimateCount: cloudEstimateRowIds.length,
      deletedEstimateLineItemCount: estimateLineItemRows.length,
    });
  }

  clearCloudPartialRecoveryStatus(storageSnapshot);

  return buildPreservedEstimateCleanupResult(PRESERVED_OLDER_ESTIMATE_CLEANUP_STATUS.COMPLETED, {
    verification,
    preservedEstimateLegacyIds,
    cloudEstimateRowIds,
    deletedEstimateCount: cloudEstimateRowIds.length,
    deletedEstimateLineItemCount: estimateLineItemRows.length,
    clearedPartialRecoveryStatus: !readCloudPartialRecoveryStatus(storageSnapshot),
  });
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
  queueGeneration = null,
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated) return buildBackupResult(gated);

  const mutationReason = allowCloudOnlyReplacement ? "replace_cloud" : "backup";
  const deviceAccess = await ensureCurrentDeviceCanWriteCloud({
    configured,
    user,
    company,
    storage: storageSnapshot,
    reason: mutationReason,
  });
  if (!deviceAccess.ok) {
    return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, {
      error: deviceAccess.userMessage || deviceAccess.error,
      technicalDetail: deviceAccess.access?.reason || deviceAccess.userMessage || deviceAccess.error,
      code: deviceAccess.code,
      deviceLockLost: deviceAccess.deviceLockLost,
      noWritesPerformed: true,
    });
  }

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
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, {
        preview,
        writeResult,
        permanentIdentityConflict: Boolean(writeResult?.permanentIdentityConflict),
        syncReviewState: writeResult?.syncReviewState || "",
        error: writeResult?.permanentIdentityConflict ? writeResult?.reason : "",
      });
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
    // Do not turn a successful cloud write into "Cloud OK" if this device
    // lost ownership while verification was running. The queue must remain
    // pending so the newly active device can decide what to do safely.
    const completionAccess = await ensureCurrentDeviceCanWriteCloud({
      configured,
      user,
      company,
      storage: storageSnapshot,
      reason: mutationReason,
      claimIfMissing: false,
    });
    if (!completionAccess.ok) {
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, {
        preview,
        writeResult,
        verification,
        error: completionAccess.userMessage || completionAccess.error,
        technicalDetail: completionAccess.access?.reason || completionAccess.userMessage || completionAccess.error,
        code: completionAccess.code,
        deviceLockLost: completionAccess.deviceLockLost,
      });
    }

    clearCloudBackupDirty("cloud_backup_verified", { expectedRevision: queueGeneration });

    return buildBackupResult(CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED, { preview, writeResult, verification });
  } catch (error) {
    return buildBackupResult(CLOUD_ONBOARDING_STATUS.ERROR, {
      error: asText(error?.message) || "Unable to complete cloud backup.",
    });
  }
}
