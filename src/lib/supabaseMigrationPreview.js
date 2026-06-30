import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { getSupabaseClient } from "./supabaseClient";
import { mapLocalSnapshotToBackendDraft } from "../utils/backendDataMapper";

export const SUPABASE_MIGRATION_PREVIEW_VERSION = "supabase-migration-preview-v1";

const ALLOWED_MIGRATION_ROLES = new Set(["owner", "admin"]);
const CLOUD_COUNT_TABLES = [
  ["customers", "customers"],
  ["projects", "projects"],
  ["estimates", "estimates"],
  ["estimate_line_items", "estimateLineItems"],
  ["invoices", "invoices"],
  ["invoice_line_items", "invoiceLineItems"],
  ["invoice_payments", "invoicePayments"],
];

const ESTIMATE_LINE_ITEM_SCHEMA_BLOCKER =
  "Estimate line items are still blocked because the documented schema has no unique idempotent upsert path for company_id + legacy_local_id or estimate_id + legacy_local_id.";
const INVOICE_LINE_ITEM_SCHEMA_BLOCKER =
  "Invoice line items are still blocked because the documented schema has no unique idempotent upsert path for company_id + legacy_local_id or invoice_id + legacy_local_id.";

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

function buildLocalSnapshotFromArtifact(artifact) {
  const migration = artifact?.parsedData?.migration || {};
  return {
    companyProfile: migration?.companyProfile?.parsed || null,
    customers: Array.isArray(migration?.customers?.parsed) ? migration.customers.parsed : [],
    projects: Array.isArray(migration?.projects?.parsed) ? migration.projects.parsed : [],
    estimates: Array.isArray(migration?.estimates?.parsed) ? migration.estimates.parsed : [],
    invoices: Array.isArray(migration?.invoices?.parsed) ? migration.invoices.parsed : [],
    settings: migration?.settings?.parsed || null,
    scopeTemplates: Array.isArray(migration?.scopeTemplates?.parsed) ? migration.scopeTemplates.parsed : [],
    auditEvents: Array.isArray(migration?.auditEvents?.parsed) ? migration.auditEvents.parsed : [],
  };
}

function countDraftLineItems(draft) {
  const estimateLineItems = (Array.isArray(draft?.estimates) ? draft.estimates : []).reduce((sum, estimate) => {
    return sum + (Array.isArray(estimate?.line_items) ? estimate.line_items.length : 0);
  }, 0);
  const invoiceLineItems = (Array.isArray(draft?.invoices) ? draft.invoices : []).reduce((sum, invoice) => {
    return sum + (Array.isArray(invoice?.line_items) ? invoice.line_items.length : 0);
  }, 0);

  return {
    estimateLineItems,
    invoiceLineItems,
  };
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
  const localSnapshot = buildLocalSnapshotFromArtifact(artifact);
  const normalizedRole = normalizeRole(role);
  const companyId = String(company?.id || "").trim();
  const companyName = String(company?.name || "").trim();
  const userId = String(user?.id || "").trim();
  const draft = mapLocalSnapshotToBackendDraft(localSnapshot, { companyId, userId });
  const lineItemCounts = countDraftLineItems(draft);

  const localCounts = {
    customers: Number(migration?.customers?.count || 0),
    projects: Number(migration?.projects?.count || 0),
    estimates: Number(migration?.estimates?.count || 0),
    estimateLineItems: Number(lineItemCounts.estimateLineItems || 0),
    invoices: Number(migration?.invoices?.count || 0),
    invoiceLineItems: Number(lineItemCounts.invoiceLineItems || 0),
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
  if (localCounts.estimateLineItems > 0) {
    notices.push(buildNotice("warning", "estimate_line_items_schema_blocked", ESTIMATE_LINE_ITEM_SCHEMA_BLOCKER));
  }
  if (localCounts.invoiceLineItems > 0) {
    notices.push(buildNotice("warning", "invoice_line_items_schema_blocked", INVOICE_LINE_ITEM_SCHEMA_BLOCKER));
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
