import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { getSupabaseClient } from "./supabaseClient";

export const SUPABASE_MIGRATION_PREVIEW_VERSION = "supabase-migration-preview-v1";

const ALLOWED_MIGRATION_ROLES = new Set(["owner", "admin"]);
const CLOUD_COUNT_TABLES = [
  ["customers", "customers"],
  ["projects", "projects"],
  ["estimates", "estimates"],
  ["invoices", "invoices"],
  ["invoice_payments", "invoicePayments"],
];

function countInvoicePayments(invoices) {
  if (!Array.isArray(invoices)) return 0;
  return invoices.reduce((sum, invoice) => {
    if (!Array.isArray(invoice?.payments)) return sum;
    return sum + invoice.payments.filter(Boolean).length;
  }, 0);
}

function buildNotice(level, code, message) {
  return { level, code, message };
}

function normalizeRole(role) {
  return String(role || "").trim().toLowerCase();
}

async function readCloudCounts(companyId) {
  const client = getSupabaseClient();

  if (!companyId || !client?.from) {
    return {
      available: false,
      counts: null,
      statusMessage: "Cloud count check unavailable.",
    };
  }

  try {
    const entries = await Promise.all(CLOUD_COUNT_TABLES.map(async ([table, key]) => {
      const response = await client
        .from(table)
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId);

      if (response?.error) {
        throw response.error;
      }

      return [key, Number(response?.count || 0)];
    }));

    return {
      available: true,
      counts: Object.fromEntries(entries),
      statusMessage: "Cloud count check completed.",
    };
  } catch {
    return {
      available: false,
      counts: null,
      statusMessage: "Cloud count check unavailable.",
    };
  }
}

export async function createSupabaseMigrationPreview({
  storageSnapshot,
  configured = false,
  user = null,
  company = null,
  role = "",
  backupDownloadAvailable = false,
} = {}) {
  const artifact = buildLocalStorageExportArtifact(storageSnapshot);
  const migration = artifact?.parsedData?.migration || {};
  const invoices = migration?.invoices?.parsed;
  const normalizedRole = normalizeRole(role);
  const companyId = String(company?.id || "").trim();
  const companyName = String(company?.name || "").trim();
  const userId = String(user?.id || "").trim();

  const localCounts = {
    customers: Number(migration?.customers?.count || 0),
    projects: Number(migration?.projects?.count || 0),
    estimates: Number(migration?.estimates?.count || 0),
    invoices: Number(migration?.invoices?.count || 0),
    invoicePayments: countInvoicePayments(invoices),
    scopeTemplates: Number(migration?.scopeTemplates?.count || 0),
    settings: migration?.settings?.present ? 1 : 0,
  };

  const notices = [];

  if (!backupDownloadAvailable) {
    notices.push(buildNotice("warning", "backup_gate_missing", "Download Backup JSON action is not available."));
  }
  if (!configured) {
    notices.push(buildNotice("error", "supabase_not_configured", "Supabase is not configured."));
  }
  if (!userId) {
    notices.push(buildNotice("error", "not_signed_in", "No signed-in Supabase user found."));
  }
  if (!companyId) {
    notices.push(buildNotice("error", "company_missing", "No cloud workspace is linked to this account yet."));
  }
  if (!normalizedRole) {
    notices.push(buildNotice("warning", "role_missing", "Cloud role could not be determined."));
  } else if (!ALLOWED_MIGRATION_ROLES.has(normalizedRole)) {
    notices.push(buildNotice("warning", "role_not_allowed", "Current cloud role is not allowed to run migration writes."));
  }
  if (artifact?.migrationReadiness?.parseErrorCount > 0) {
    notices.push(buildNotice("error", "local_data_unreadable", "Local export artifact contains unreadable JSON data."));
  }
  if (Array.isArray(artifact?.storageKeysMissing) && artifact.storageKeysMissing.length > 0) {
    notices.push(buildNotice("warning", "local_keys_missing", "Some migration keys are missing from localStorage."));
  }

  const cloudCounts = await readCloudCounts(companyId);
  if (!cloudCounts.available) {
    notices.push(buildNotice("info", "cloud_counts_unavailable", cloudCounts.statusMessage));
  }

  return {
    previewVersion: SUPABASE_MIGRATION_PREVIEW_VERSION,
    generatedAt: new Date().toISOString(),
    company: {
      id: companyId,
      name: companyName,
      role: normalizedRole,
    },
    validations: {
      supabaseConfigured: Boolean(configured),
      signedIn: Boolean(userId),
      hasCompany: Boolean(companyId),
      roleAllowedForMigration: ALLOWED_MIGRATION_ROLES.has(normalizedRole),
      backupDownloadAvailable: Boolean(backupDownloadAvailable),
      exportArtifactBuilt: Boolean(artifact),
      localDataReadable: Number(artifact?.migrationReadiness?.parseErrorCount || 0) === 0,
    },
    localCounts,
    localArtifact: {
      storageKeysMissing: Array.isArray(artifact?.storageKeysMissing) ? artifact.storageKeysMissing : [],
      parseWarnings: Array.isArray(artifact?.parseWarnings) ? artifact.parseWarnings : [],
      migrationReadiness: artifact?.migrationReadiness || {},
    },
    cloudCounts: cloudCounts.counts,
    cloudCountCheckAvailable: cloudCounts.available,
    cloudCountStatusMessage: cloudCounts.statusMessage,
    notices,
    noWritesPerformed: true,
  };
}

export default createSupabaseMigrationPreview;
