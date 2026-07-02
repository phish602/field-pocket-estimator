import { createSupabaseMigrationPreview } from "./supabaseMigrationPreview";
import { isSupabaseMigrationPreviewReady, runSupabaseMigrationWrite } from "./supabaseMigrationWriter";
import { runSupabaseCloudVerification } from "./supabaseCloudVerification";
import { clearCloudBackupDirty } from "./cloudBackupQueue";

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

function asText(value) {
  return String(value || "").trim();
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

// Phase A: read-only status check. Runs migration preview, and cloud
// verification only when both sides might have data, to classify this
// device/workspace pair (signed out, no workspace, no data anywhere, cloud
// data on an empty device, ready to back up, already matched, or a
// local/cloud mismatch needing review). Never writes, never restores.
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
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated) return buildBackupResult(gated);

  const context = buildHelperContext({ storageSnapshot, configured, user, company, role });

  try {
    const preview = await createSupabaseMigrationPreview(context);

    if (totalLocalRecords(preview?.localCounts) === 0) {
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.NO_LOCAL_DATA, { preview });
    }

    if (!isSupabaseMigrationPreviewReady(preview)) {
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, { preview });
    }

    const writeResult = await runSupabaseMigrationWrite({ ...context, preview });

    if (!writeResult?.ok) {
      return buildBackupResult(CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, { preview, writeResult });
    }

    const verification = await runSupabaseCloudVerification(context);

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
