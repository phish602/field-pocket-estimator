import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { getSupabaseClient } from "./supabaseClient";
import { mapLocalSnapshotToBackendDraft } from "../utils/backendDataMapper";
import {
  buildIntegrityNotices,
  buildLocalSnapshotFromArtifact,
  scanLocalDataIntegrity,
} from "./localDataIntegrity";

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

const ESTIMATE_LINE_ITEM_READY_MESSAGE =
  "Estimate line items are ready for guarded migration using company_id + legacy_local_id idempotency.";
const INVOICE_LINE_ITEM_READY_MESSAGE =
  "Invoice line items are ready for guarded migration using company_id + legacy_local_id idempotency.";

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

function isCoreMigrationAlreadyPresent(localCounts, cloudCounts) {
  return (
    Number(cloudCounts?.customers || 0) === Number(localCounts?.customers || 0) &&
    Number(cloudCounts?.projects || 0) === Number(localCounts?.projects || 0) &&
    Number(cloudCounts?.estimates || 0) === Number(localCounts?.estimates || 0) &&
    Number(cloudCounts?.invoices || 0) === Number(localCounts?.invoices || 0) &&
    Number(cloudCounts?.invoicePayments || 0) === Number(localCounts?.invoicePayments || 0)
  );
}

function isLineItemMigrationAlreadyPresent(localCounts, cloudCounts) {
  return (
    Number(cloudCounts?.estimateLineItems || 0) === Number(localCounts?.estimateLineItems || 0) &&
    Number(cloudCounts?.invoiceLineItems || 0) === Number(localCounts?.invoiceLineItems || 0)
  );
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
  const integrity = scanLocalDataIntegrity(localSnapshot);
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
  notices.push(...buildIntegrityNotices(integrity));
  const cloudCounts = await readCloudCounts(companyId);
  if (!cloudCounts.available) {
    notices.push(buildNotice("info", "cloud_counts_unavailable", cloudCounts.statusMessage));
  } else if (localCounts.estimateLineItems > 0 || localCounts.invoiceLineItems > 0) {
    const coreReady = isCoreMigrationAlreadyPresent(localCounts, cloudCounts.counts);
    const lineItemsReady = isLineItemMigrationAlreadyPresent(localCounts, cloudCounts.counts);

    if (lineItemsReady) {
      notices.push(buildNotice("info", "line_items_already_migrated", "Line items already match local data. No duplicate write should be needed."));
    } else if (coreReady) {
      if (localCounts.estimateLineItems > 0) {
        notices.push(buildNotice("info", "estimate_line_items_ready", ESTIMATE_LINE_ITEM_READY_MESSAGE));
      }
      if (localCounts.invoiceLineItems > 0) {
        notices.push(buildNotice("info", "invoice_line_items_ready", INVOICE_LINE_ITEM_READY_MESSAGE));
      }
    } else {
      notices.push(buildNotice("info", "line_items_waiting_for_core", "Line items will migrate after core customer/project/document rows are present in cloud for this workspace."));
    }
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
    integrity,
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
