import { createSupabaseMigrationPreview } from "./supabaseMigrationPreview";
import { isSupabaseMigrationPreviewReady, runSupabaseMigrationWrite } from "./supabaseMigrationWriter";
import { runSupabaseCloudVerification } from "./supabaseCloudVerification";

export const SUPABASE_CLOUD_ONBOARDING_VERSION = "supabase-cloud-onboarding-v1";

// Contractor-friendly status values. The screen owns the exact wording for
// each of these; this module only decides which one applies.
export const CLOUD_ONBOARDING_STATUS = {
  SIGNED_OUT: "signed_out",
  NO_WORKSPACE: "no_workspace",
  NO_LOCAL_DATA: "no_local_data",
  READY_TO_BACKUP: "ready_to_backup",
  ALREADY_BACKED_UP: "already_backed_up",
  BACKUP_COMPLETED: "backup_completed",
  NEEDS_ATTENTION: "needs_attention",
  ERROR: "error",
};

function asText(value) {
  return String(value || "").trim();
}

// Mirrors isSupabaseMigrationPreviewReady's own "is there anything to back
// up" definition so the two stay in agreement.
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

// Phase A: read-only status check. Runs migration preview and, if local data
// exists, cloud verification, to decide whether the cloud already matches
// local data (already_backed_up) or a one-click backup should be offered
// (ready_to_backup). Never writes.
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

    if (totalLocalRecords(preview?.localCounts) === 0) {
      return buildStatusResult(CLOUD_ONBOARDING_STATUS.NO_LOCAL_DATA, { preview });
    }

    const verification = await runSupabaseCloudVerification(context);

    return buildStatusResult(
      verification?.allMatched ? CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP : CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP,
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

    return buildBackupResult(CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED, { preview, writeResult, verification });
  } catch (error) {
    return buildBackupResult(CLOUD_ONBOARDING_STATUS.ERROR, {
      error: asText(error?.message) || "Unable to complete cloud backup.",
    });
  }
}
