import { getSupabaseClient } from "./supabaseClient";
import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { readSupabaseAppRestoreBundle } from "./supabaseAppRestoreBundle";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { clearCloudBackupDirty } from "./cloudBackupQueue";
import { buildLocalSnapshotFromStorage, scanLocalDataIntegrity } from "./localDataIntegrity";
import {
  ensureCurrentDeviceCanWriteCloud,
  ensureCurrentDeviceCanApplyLocalRestore,
  DEVICE_LOCK_LOST_CODE,
  DEVICE_LOCK_LOST_RESTORE_MESSAGE,
} from "./supabaseDeviceLock";

export const SUPABASE_CLOUD_RESTORE_VERSION = "supabase-cloud-restore-v1";

// Gate 13O-2J: the downloadable "Cloud Backup JSON" artifact. Records are
// stored already mapped to the local app shapes (the same mapping the
// restore path writes to localStorage), so the import path never has to
// re-derive cloud column mappings from a file.
export const CLOUD_BACKUP_EXPORT_ARTIFACT_VERSION = "cloud-backup-export-artifact-v1";
export const CLOUD_BACKUP_EXPORT_SCHEMA_VERSION = 1;

export const CLOUD_BACKUP_EXPORT_STATUS = {
  SIGNED_OUT: "signed_out",
  NO_WORKSPACE: "no_workspace",
  EXPORTED: "exported",
  ERROR: "error",
};

// Gate 13C: fired once a restore has finished writing local data, dispatching
// its change events, and clearing the backup queue -- so the app shell can
// navigate the user to Home and surface a success signal instead of leaving
// them on a stale screen. Same-tab only; never fired on failure.
export const CLOUD_RESTORE_COMPLETE_EVENT = "estipaid:cloud-restore-complete";

// In-memory only (never persisted): lets a component that mounts *after* the
// event already fired (e.g. Home, freshly mounted by the app shell's
// navigation-on-restore) still know a restore just completed, without
// relying on event-listener mount order.
let lastRestoreCompleteAt = 0;

export function getLastCloudRestoreCompleteAt() {
  return lastRestoreCompleteAt;
}

export const CLOUD_RESTORE_STATUS = {
  SIGNED_OUT: "signed_out",
  NO_WORKSPACE: "no_workspace",
  LOCAL_NOT_EMPTY: "local_not_empty",
  NO_CLOUD_DATA: "no_cloud_data",
  ELIGIBLE: "eligible",
  RESTORED: "restored",
  DEVICE_LOCKED: "device_locked",
  BLOCKED_UNSUPPORTED_SHAPE: "blocked_unsupported_shape",
  ERROR: "error",
};

export const CLOUD_RESTORE_STOPPED_MESSAGE = DEVICE_LOCK_LOST_RESTORE_MESSAGE;

// customers/projects/invoices(+payments/line items) carry enough cloud
// columns to faithfully rebuild the local record shape; estimates do not
// (see buildEstimateBlockerNotice below for why they're excluded).
const ALL_CLOUD_TABLES = ["customers", "projects", "estimates", "invoices", "invoice_payments", "estimate_line_items", "invoice_line_items"];
const COMPANY_PROFILE_RESTORE_KEY = STORAGE_KEYS.COMPANY_PROFILE;
const SETTINGS_RESTORE_KEY = STORAGE_KEYS.SETTINGS;
const SCOPE_TEMPLATES_RESTORE_KEY = STORAGE_KEYS.SCOPE_TEMPLATES;
const PARTIAL_LOCAL_SNAPSHOT_BLOCKER_CODE = "empty_estimates_with_invoices";

function asText(value) {
  return String(value || "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function buildNotice(level, code, message, details = {}) {
  return { level, code, message, details };
}

// Estimates are restorable only once every cloud estimate row carries a
// valid restore_payload (Gate 10C-A/B): a JSONB capture of the exact local
// estimate-builder object, including the computational inputs the display
// columns alone can't carry -- labor.lines[].hours, labor hazardPct/
// riskPct/multiplier, materials.markupPct, materialsMode (see
// src/estimator/defaultState.js). Until every cloud estimate has been
// captured via updateEstimateRestorePayloads, reconstructing from the
// display-only columns would force the estimator engine to recompute from
// guessed defaults the next time the estimate is edited -- exactly the
// "guessed restore" this lane must not do.
function buildEstimateBlockerNotice(estimateCount, lineItemCount, missingRestorePayloadCount = estimateCount) {
  return buildNotice(
    "warning",
    "estimates_not_reconstructable",
    "Estimates cannot be safely restored yet. Some or all cloud estimates do not have a restore payload captured (Settings → Update Estimate Restore Payloads), so the original labor hours, hazard %, risk %, multiplier, and materials markup % needed to recompute the estimate correctly are not available. Restoring a guessed version risks silently wrong totals if the estimate is edited again.",
    {
      table: "estimates",
      cloudEstimateCount: estimateCount,
      cloudEstimateLineItemCount: lineItemCount,
      missingRestorePayloadCount,
      missingFields: ["labor.lines[].hours", "labor.hazardPct", "labor.riskPct", "labor.multiplier", "materials.markupPct", "materialsMode"],
    }
  );
}

function buildSupplementalRestoreCoverageNotice() {
  return buildNotice(
    "warning",
    "supplemental_restore_not_available",
    "Business records can be restored on an empty device, but company profile, logo, settings, and scope templates are not part of Supabase restore yet. They need a separate backup/update step.",
    {
      localStorageKeys: {
        companyProfile: COMPANY_PROFILE_RESTORE_KEY,
        logoField: "logoDataUrl",
        settings: SETTINGS_RESTORE_KEY,
        scopeTemplates: SCOPE_TEMPLATES_RESTORE_KEY,
      },
      cloudCoverage: {
        companies: "workspace identity only; no full company-profile/logo payload is restored here",
        app_settings: "not read by the current restore path",
        scope_templates: "not read by the current restore path",
      },
    }
  );
}

// A cloud estimate row is restorable only if it carries a fully-formed
// restore payload: a JSON object (not null/array/scalar) plus a version
// marker. Mirrors the estimates_restore_payload_object_check DB constraint.
function hasValidRestorePayload(row) {
  return Boolean(
    row?.restore_payload &&
    typeof row.restore_payload === "object" &&
    !Array.isArray(row.restore_payload) &&
    asText(row?.restore_payload_version)
  );
}

function gateBasicPrerequisites({ configured, user, company }) {
  const userId = asText(user?.id);
  const companyId = asText(company?.id);
  if (!configured || !userId) return CLOUD_RESTORE_STATUS.SIGNED_OUT;
  if (!companyId) return CLOUD_RESTORE_STATUS.NO_WORKSPACE;
  return null;
}

function readLocalCoreCounts(storageSnapshot) {
  const artifact = buildLocalStorageExportArtifact(storageSnapshot);
  const migration = artifact?.parsedData?.migration || {};
  return {
    customers: Number(migration?.customers?.count || 0),
    projects: Number(migration?.projects?.count || 0),
    estimates: Number(migration?.estimates?.count || 0),
    invoices: Number(migration?.invoices?.count || 0),
  };
}

function isLocalCoreEmpty(counts) {
  const c = counts || {};
  return (
    Number(c.customers || 0) +
    Number(c.projects || 0) +
    Number(c.estimates || 0) +
    Number(c.invoices || 0)
  ) === 0;
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

function collectRequiredEstimateIdsForPartialSnapshot(localSnapshot) {
  return [...new Set(
    asArray(localSnapshot?.invoices)
      .map((invoice) => extractLocalInvoiceSourceEstimateId(invoice))
      .filter(Boolean)
  )].sort();
}

function hasPartialLocalSnapshotBlocker(integrity) {
  return Boolean(
    Array.isArray(integrity?.blockers)
    && integrity.blockers.some((issue) => asText(issue?.code) === PARTIAL_LOCAL_SNAPSHOT_BLOCKER_CODE)
  );
}

function readLocalRestoreState(storageSnapshot) {
  const { snapshot } = buildLocalSnapshotFromStorage(storageSnapshot);
  const localCounts = readLocalCoreCounts(storageSnapshot);
  let localIntegrity = null;
  try {
    localIntegrity = scanLocalDataIntegrity(snapshot);
  } catch {
    localIntegrity = null;
  }
  return {
    snapshot,
    localCounts,
    localIntegrity,
    partialLocalSnapshot: hasPartialLocalSnapshotBlocker(localIntegrity),
    requiredEstimateIdsForPartialSnapshot: collectRequiredEstimateIdsForPartialSnapshot(snapshot),
  };
}

function canRestoreOverExistingLocalData(localRestoreState, allowPartialLocalSnapshot = false) {
  return Boolean(allowPartialLocalSnapshot && localRestoreState?.partialLocalSnapshot);
}

function buildPartialSnapshotEstimateBlocker(requiredEstimateIds, availableEstimateIds, invalidEstimateIds) {
  const requiredCount = asArray(requiredEstimateIds).length;
  const missingCloudIds = asArray(requiredEstimateIds).filter((id) => !availableEstimateIds.has(id));
  const missingPayloadIds = asArray(requiredEstimateIds).filter((id) => invalidEstimateIds.has(id));
  return buildNotice(
    "warning",
    "partial_snapshot_estimates_unrestorable",
    "Cloud backup cannot safely rebuild this device because one or more linked estimates are missing valid restore data.",
    {
      requiredEstimateCount: requiredCount,
      missingCloudEstimateIds: missingCloudIds,
      missingRestorePayloadEstimateIds: missingPayloadIds,
      missingRequiredRestorePayloadCount: missingPayloadIds.length,
    }
  );
}

function analyzeEstimateRestoreState({
  estimateRows,
  estimateCount,
  estimateLineItemCount,
  localRestoreState = null,
  allowPartialLocalSnapshot = false,
} = {}) {
  const rows = asArray(estimateRows);
  const restorableRows = rows.filter((row) => hasValidRestorePayload(row));
  const allEstimatesRestorable = estimateCount === 0 || restorableRows.length === estimateCount;
  const partialSnapshotMode = canRestoreOverExistingLocalData(localRestoreState, allowPartialLocalSnapshot);
  const requiredEstimateIds = partialSnapshotMode
    ? asArray(localRestoreState?.requiredEstimateIdsForPartialSnapshot)
    : [];
  const availableEstimateIds = new Set(rows.map((row) => asText(row?.legacy_local_id)).filter(Boolean));
  const restorableEstimateIds = new Set(restorableRows.map((row) => asText(row?.legacy_local_id)).filter(Boolean));
  const invalidEstimateIds = new Set(
    rows
      .filter((row) => !hasValidRestorePayload(row))
      .map((row) => asText(row?.legacy_local_id))
      .filter(Boolean)
  );
  const missingRestorePayloadCount = invalidEstimateIds.size;
  const missingRequiredEstimateIds = requiredEstimateIds.filter((id) => !restorableEstimateIds.has(id));
  const recoveryEligibleForPartialLocalSnapshot = partialSnapshotMode
    && requiredEstimateIds.length > 0
    && missingRequiredEstimateIds.length === 0;

  if (estimateCount === 0) {
    return {
      blockers: [],
      restorableEstimateRows: [],
      recoveryEligibleForPartialLocalSnapshot,
    };
  }

  if (allEstimatesRestorable) {
    return {
      blockers: [],
      restorableEstimateRows: rows,
      recoveryEligibleForPartialLocalSnapshot,
    };
  }

  if (recoveryEligibleForPartialLocalSnapshot) {
    return {
      blockers: [],
      restorableEstimateRows: restorableRows,
      recoveryEligibleForPartialLocalSnapshot,
    };
  }

  const blocker = partialSnapshotMode && requiredEstimateIds.length > 0
    ? buildPartialSnapshotEstimateBlocker(requiredEstimateIds, availableEstimateIds, invalidEstimateIds)
    : buildEstimateBlockerNotice(estimateCount, estimateLineItemCount, missingRestorePayloadCount);

  return {
    blockers: [blocker],
    restorableEstimateRows: [],
    recoveryEligibleForPartialLocalSnapshot: false,
  };
}

async function readCloudCount(client, table, companyId) {
  try {
    const response = await client.from(table).select("id", { count: "exact", head: true }).eq("company_id", companyId);
    if (response?.error) return { count: null, error: response.error };
    return { count: Number(response?.count || 0), error: null };
  } catch (error) {
    return { count: null, error };
  }
}

async function readCloudRows(client, table, companyId) {
  try {
    const response = await client.from(table).select("*").eq("company_id", companyId);
    if (response?.error) return { rows: null, error: response.error };
    return { rows: Array.isArray(response?.data) ? response.data : [], error: null };
  } catch (error) {
    return { rows: null, error };
  }
}

async function readAppRestoreBundleResult(client, companyId) {
  try {
    return await readSupabaseAppRestoreBundle({ client, companyId });
  } catch {
    return {
      status: "error",
      bundle: null,
      notices: [buildNotice("warning", "app_restore_bundle_read_failed", "Unable to read the app restore bundle from Supabase.")],
      captureSummary: {
        companyProfileCaptured: false,
        logoDataUrlCaptured: false,
        settingsCaptured: false,
        scopeTemplatesCaptured: false,
      },
    };
  }
}

function buildPreviewResult(status, extra = {}) {
  return {
    restoreVersion: SUPABASE_CLOUD_RESTORE_VERSION,
    status,
    eligible: false,
    cloudCounts: null,
    localCounts: null,
    blockers: [],
    notices: [],
    appBundleAvailable: false,
    appBundleSummary: {
      companyProfileCaptured: false,
      logoDataUrlCaptured: false,
      settingsCaptured: false,
      scopeTemplatesCaptured: false,
    },
    recoveryEligibleForPartialLocalSnapshot: false,
    noWritesPerformed: true,
    ...extra,
  };
}

// Phase A: read-only restore preview. Reports cloud counts, confirms this
// device's local core business data is empty, and reports whether a (partial
// or full) restore is eligible. Performs no writes.
export async function previewSupabaseCloudRestore({
  storageSnapshot,
  configured = false,
  user = null,
  company = null,
  allowPartialLocalSnapshot = false,
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated) return buildPreviewResult(gated);

  const client = getSupabaseClient();
  if (!client?.from) {
    return buildPreviewResult(CLOUD_RESTORE_STATUS.ERROR, {
      notices: [buildNotice("error", "supabase_not_configured", "Supabase is not configured.")],
    });
  }

  const localRestoreState = readLocalRestoreState(storageSnapshot);
  const localCounts = localRestoreState.localCounts;
  if (!isLocalCoreEmpty(localCounts) && !canRestoreOverExistingLocalData(localRestoreState, allowPartialLocalSnapshot)) {
    return buildPreviewResult(CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY, { localCounts });
  }

  const companyId = asText(company?.id);
  const notices = [];
  const cloudCounts = {};

  for (const table of ALL_CLOUD_TABLES) {
    const { count, error } = await readCloudCount(client, table, companyId);
    if (error) {
      notices.push(buildNotice("error", `${table}_read_failed`, `Unable to read ${table} from Supabase.`));
      cloudCounts[table] = null;
    } else {
      cloudCounts[table] = count;
    }
  }

  const estimateCount = Number(cloudCounts.estimates || 0);
  const estimateLineItemCount = Number(cloudCounts.estimate_line_items || 0);
  const coreCloudTotal = Number(cloudCounts.customers || 0) + Number(cloudCounts.projects || 0) + Number(cloudCounts.invoices || 0) + estimateCount;
  const appBundle = await readAppRestoreBundleResult(client, companyId);

  let blockers = [];
  let recoveryEligibleForPartialLocalSnapshot = false;
  if (estimateCount > 0) {
    const { rows: estimateRows, error: estimateRowsError } = await readCloudRows(client, "estimates", companyId);
    if (estimateRowsError) {
      notices.push(buildNotice("error", "estimates_read_failed", "Unable to read estimates from Supabase."));
      blockers = [buildEstimateBlockerNotice(estimateCount, estimateLineItemCount)];
    } else {
      const estimateRestoreState = analyzeEstimateRestoreState({
        estimateRows,
        estimateCount,
        estimateLineItemCount,
        localRestoreState,
        allowPartialLocalSnapshot,
      });
      blockers = estimateRestoreState.blockers;
      recoveryEligibleForPartialLocalSnapshot = estimateRestoreState.recoveryEligibleForPartialLocalSnapshot;
    }
  }

  if (coreCloudTotal === 0) {
    return buildPreviewResult(CLOUD_RESTORE_STATUS.NO_CLOUD_DATA, {
      localCounts,
      cloudCounts,
      blockers,
      notices: [...notices, ...appBundle.notices],
      appBundleAvailable: appBundle.status === "available",
      appBundleSummary: appBundle.captureSummary,
      recoveryEligibleForPartialLocalSnapshot,
    });
  }

  return buildPreviewResult(CLOUD_RESTORE_STATUS.ELIGIBLE, {
    eligible: true,
    partial: blockers.length > 0,
    localCounts,
    cloudCounts,
    blockers,
    notices: appBundle.status === "available"
      ? [...notices, ...appBundle.notices]
      : [...notices, ...appBundle.notices, buildSupplementalRestoreCoverageNotice()],
    appBundleAvailable: appBundle.status === "available",
    appBundleSummary: appBundle.captureSummary,
    recoveryEligibleForPartialLocalSnapshot,
  });
}

function buildLegacyIdMap(rows) {
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [asText(row?.id), asText(row?.legacy_local_id)]));
}

function requireLegacyId(row, table) {
  const id = asText(row?.legacy_local_id);
  if (!id) throw new Error(`A ${table} row is missing its legacy_local_id and cannot be restored.`);
  return id;
}

function mapCloudCustomerToLocal(row) {
  const id = requireLegacyId(row, "customers");
  const type = asText(row?.customer_type).toLowerCase() === "commercial" ? "commercial" : "residential";
  const base = {
    id,
    type,
    billingAddress: row?.billing_address || "",
    address: row?.billing_address || "",
    status: row?.customer_status || "",
  };
  if (type === "commercial") {
    return {
      ...base,
      companyName: row?.company_name || row?.display_name || "",
      contactName: row?.contact_name || "",
      comPhone: row?.phone || "",
      comEmail: row?.email || "",
    };
  }
  return {
    ...base,
    fullName: row?.contact_name || row?.display_name || "",
    resPhone: row?.phone || "",
    resEmail: row?.email || "",
  };
}

function mapCloudProjectToLocal(row, customerIdByCloudId) {
  const id = requireLegacyId(row, "projects");
  return {
    id,
    customerId: customerIdByCloudId.get(asText(row?.customer_id)) || "",
    projectName: row?.project_name || "",
    projectNumber: row?.project_number || "",
    siteAddress: row?.site_address || "",
    status: row?.status || "draft",
    notes: row?.notes || "",
    scopeNotes: row?.scope_summary || "",
  };
}

function mapCloudInvoiceLineItem(row) {
  return {
    id: requireLegacyId(row, "invoice_line_items"),
    description: row?.description || "",
    quantity: row?.quantity ?? null,
    unit: row?.unit || "",
    price: row?.unit_price ?? null,
    total: row?.total_price ?? null,
  };
}

function mapCloudPayment(row) {
  return {
    id: requireLegacyId(row, "invoice_payments"),
    amount: row?.amount ?? null,
    method: row?.method || "",
    status: row?.status || "paid",
    paidAt: row?.paid_at || null,
  };
}

// Restores the estimate from its restore_payload verbatim -- the payload
// already carries the exact local estimate-builder object (labor lines,
// hazard/risk/multiplier, materials markup, etc.), so estimate_line_items
// rows are not needed and are not consulted here: using them would mean
// reconstructing an incompatible flattened shape instead of preferring the
// faithful one already captured in the payload.
function mapCloudEstimateToLocal(row) {
  const legacyLocalId = requireLegacyId(row, "estimates");
  if (!hasValidRestorePayload(row)) {
    throw new Error(`Estimate ${legacyLocalId} is missing a valid restore_payload and cannot be restored.`);
  }
  const estimate = row.restore_payload?.estimate;
  if (!estimate || typeof estimate !== "object" || Array.isArray(estimate)) {
    throw new Error(`Estimate ${legacyLocalId} restore_payload does not contain a usable estimate object.`);
  }
  // Never trust only the payload's own copy of the id -- always pin it to
  // the legacy_local_id this cloud row was actually matched on.
  return { ...estimate, id: legacyLocalId };
}

function mapCloudInvoiceToLocal(row, customerIdByCloudId, projectIdByCloudId, lineItemsByInvoiceCloudId, paymentsByInvoiceCloudId) {
  const id = requireLegacyId(row, "invoices");
  const cloudId = asText(row?.id);
  return {
    id,
    customerId: customerIdByCloudId.get(asText(row?.customer_id)) || "",
    projectId: projectIdByCloudId.get(asText(row?.project_id)) || "",
    sourceEstimateId: asText(row?.source_estimate_legacy_id) || "",
    invoiceNumber: row?.invoice_number || "",
    status: row?.status || "draft",
    paymentStatus: row?.payment_status || "unpaid",
    invoiceTotal: row?.total_amount ?? 0,
    amountPaid: row?.amount_paid ?? 0,
    balanceRemaining: row?.balance_remaining ?? 0,
    date: row?.invoice_date || "",
    dueDate: row?.due_date || "",
    notes: row?.notes || "",
    lineItems: lineItemsByInvoiceCloudId.get(cloudId) || [],
    payments: paymentsByInvoiceCloudId.get(cloudId) || [],
  };
}

// Builds the full local restore payload in memory from already-fetched cloud
// rows. Pure -- never touches localStorage. Throws if any row is missing the
// identity (legacy_local_id) needed to restore it, so the caller can abort
// before writing anything.
function buildLocalRestorePayload({ customers, projects, invoices, invoicePayments, invoiceLineItems, estimates, appRestoreBundle = null }) {
  const customerIdByCloudId = buildLegacyIdMap(customers);
  const projectIdByCloudId = buildLegacyIdMap(projects);
  const invoiceLegacyIdByCloudId = buildLegacyIdMap(invoices);

  const lineItemsByInvoiceCloudId = new Map();
  (Array.isArray(invoiceLineItems) ? invoiceLineItems : [])
    .slice()
    .sort((a, b) => Number(a?.sort_order || 0) - Number(b?.sort_order || 0))
    .forEach((row) => {
      const invoiceCloudId = asText(row?.invoice_id);
      if (!invoiceLegacyIdByCloudId.has(invoiceCloudId)) {
        throw new Error("An invoice line item references an invoice that was not found in the cloud read.");
      }
      const mapped = mapCloudInvoiceLineItem(row);
      const list = lineItemsByInvoiceCloudId.get(invoiceCloudId) || [];
      list.push(mapped);
      lineItemsByInvoiceCloudId.set(invoiceCloudId, list);
    });

  const paymentsByInvoiceCloudId = new Map();
  (Array.isArray(invoicePayments) ? invoicePayments : []).forEach((row) => {
    const invoiceCloudId = asText(row?.invoice_id);
    if (!invoiceLegacyIdByCloudId.has(invoiceCloudId)) {
      throw new Error("An invoice payment references an invoice that was not found in the cloud read.");
    }
    const mapped = mapCloudPayment(row);
    const list = paymentsByInvoiceCloudId.get(invoiceCloudId) || [];
    list.push(mapped);
    paymentsByInvoiceCloudId.set(invoiceCloudId, list);
  });

  const localCustomers = (Array.isArray(customers) ? customers : []).map(mapCloudCustomerToLocal);
  const localProjects = (Array.isArray(projects) ? projects : []).map((row) => mapCloudProjectToLocal(row, customerIdByCloudId));
  const localInvoices = (Array.isArray(invoices) ? invoices : []).map((row) => mapCloudInvoiceToLocal(
    row, customerIdByCloudId, projectIdByCloudId, lineItemsByInvoiceCloudId, paymentsByInvoiceCloudId
  ));
  const localEstimates = (Array.isArray(estimates) ? estimates : []).map(mapCloudEstimateToLocal);
  const companyProfile = appRestoreBundle?.companyProfile ?? null;
  const settings = appRestoreBundle?.settings ?? null;
  const scopeTemplates = appRestoreBundle?.scopeTemplates ?? null;

  return {
    customers: localCustomers,
    projects: localProjects,
    invoices: localInvoices,
    estimates: localEstimates,
    companyProfile,
    settings,
    scopeTemplates,
  };
}

function dispatchLocalStorageEvent(key, value) {
  try {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key, value } }));
  } catch {}
}

function dispatchChangeEvents({ includeEstimates, includeCompanyProfile, includeSettings, includeScopeTemplates, values }) {
  try {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new Event("estipaid:customers-changed"));
    window.dispatchEvent(new Event("estipaid:projects-changed"));
    window.dispatchEvent(new Event("estipaid:invoices-changed"));
    if (includeEstimates) window.dispatchEvent(new Event("estipaid:estimates-changed"));
    if (includeSettings) window.dispatchEvent(new Event("estipaid:settings-changed"));
    if (includeCompanyProfile) dispatchLocalStorageEvent(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(values?.companyProfile ?? null));
    if (includeScopeTemplates) dispatchLocalStorageEvent(STORAGE_KEYS.SCOPE_TEMPLATES, JSON.stringify(values?.scopeTemplates ?? []));
  } catch {
    // Best-effort same-tab refresh signal only; restore itself already succeeded.
  }
}

function buildExecuteResult(status, extra = {}) {
  return {
    restoreVersion: SUPABASE_CLOUD_RESTORE_VERSION,
    status,
    restored: false,
    partial: false,
    restoredCounts: null,
    blockers: [],
    notices: [],
    appBundleRestored: false,
    appBundleSummary: {
      companyProfileCaptured: false,
      logoDataUrlCaptured: false,
      settingsCaptured: false,
      scopeTemplatesCaptured: false,
    },
    noWritesPerformed: true,
    noCloudDataDeleted: true,
    noExistingLocalDataOverwritten: true,
    ...extra,
  };
}

function buildDeviceLockRestoreResult(extra = {}) {
  return buildExecuteResult(CLOUD_RESTORE_STATUS.DEVICE_LOCKED, {
    error: CLOUD_RESTORE_STOPPED_MESSAGE,
    code: DEVICE_LOCK_LOST_CODE,
    deviceLockLost: true,
    ...extra,
  });
}

// Phase B: explicit restore. Only call this from a direct user click after
// the user has typed the confirmation phrase. Rechecks local emptiness both
// before fetching cloud data and again immediately before writing, builds
// the complete local payload in memory first, and only then writes
// localStorage in one guarded pass. Never writes to Supabase.
// Customers/projects/invoices/payments/invoice line items always restore
// from their cloud display columns. Estimates restore only when every cloud
// estimate carries a valid restore_payload (see hasValidRestorePayload) --
// otherwise they're reported as a blocker (see buildEstimateBlockerNotice)
// instead of being restored from guessed defaults. This is a transparent
// partial restore, not a guessed one: every field that is written comes
// directly from a cloud column (or, for estimates, the exact captured local
// object) with a known, faithful local equivalent.
export async function executeSupabaseCloudRestore({
  storage,
  configured = false,
  user = null,
  company = null,
  allowPartialLocalSnapshot = false,
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated) return buildExecuteResult(gated);

  const deviceAccess = await ensureCurrentDeviceCanWriteCloud({ configured, user, company, storage, reason: "restore" });
  if (!deviceAccess.ok) {
    if (deviceAccess.code === DEVICE_LOCK_LOST_CODE || deviceAccess.deviceLockLost) {
      return buildDeviceLockRestoreResult();
    }
    return buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, {
      error: deviceAccess.error,
      noWritesPerformed: true,
      noCloudDataDeleted: true,
      noExistingLocalDataOverwritten: true,
    });
  }

  const client = getSupabaseClient();
  if (!client?.from) {
    return buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, {
      error: "Supabase is not configured.",
    });
  }

  const initialLocalRestoreState = readLocalRestoreState(storage);
  const initialLocalCounts = initialLocalRestoreState.localCounts;
  const overwritingExistingLocalData = !isLocalCoreEmpty(initialLocalCounts);
  if (overwritingExistingLocalData && !canRestoreOverExistingLocalData(initialLocalRestoreState, allowPartialLocalSnapshot)) {
    return buildExecuteResult(CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY, { localCounts: initialLocalCounts });
  }

  const companyId = asText(company?.id);
  const fetched = {};
  for (const table of ALL_CLOUD_TABLES) {
    const { rows, error } = await readCloudRows(client, table, companyId);
    if (error) {
      return buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, {
        error: `Unable to read ${table} from Supabase.`,
      });
    }
    fetched[table] = rows;
  }

  const estimateCount = fetched.estimates.length;
  const estimateLineItemCount = fetched.estimate_line_items.length;
  const estimateRestoreState = analyzeEstimateRestoreState({
    estimateRows: fetched.estimates,
    estimateCount,
    estimateLineItemCount,
    localRestoreState: initialLocalRestoreState,
    allowPartialLocalSnapshot,
  });
  const appBundle = await readAppRestoreBundleResult(client, companyId);
  const blockers = estimateRestoreState.blockers;
  const partialSnapshotRecoveryMode = canRestoreOverExistingLocalData(initialLocalRestoreState, allowPartialLocalSnapshot);

  if (partialSnapshotRecoveryMode && blockers.length > 0) {
    return buildExecuteResult(CLOUD_RESTORE_STATUS.BLOCKED_UNSUPPORTED_SHAPE, { blockers });
  }

  const coreRestorableTotal = fetched.customers.length + fetched.projects.length + fetched.invoices.length
    + estimateRestoreState.restorableEstimateRows.length;
  if (coreRestorableTotal === 0) {
    return buildExecuteResult(
      blockers.length > 0 ? CLOUD_RESTORE_STATUS.BLOCKED_UNSUPPORTED_SHAPE : CLOUD_RESTORE_STATUS.NO_CLOUD_DATA,
      { blockers }
    );
  }

  let payload;
  try {
    payload = buildLocalRestorePayload({
      customers: fetched.customers,
      projects: fetched.projects,
      invoices: fetched.invoices,
      invoicePayments: fetched.invoice_payments,
      invoiceLineItems: fetched.invoice_line_items,
      // estimate_line_items are intentionally not passed here -- when
      // estimates are restorable, restore_payload.estimate already carries
      // the original labor/materials line structure faithfully, so the
      // flattened estimate_line_items rows are redundant for restore.
      estimates: estimateRestoreState.restorableEstimateRows,
      appRestoreBundle: appBundle.status === "available" ? appBundle.bundle : null,
    });
  } catch (error) {
    return buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, {
      error: asText(error?.message) || "Unable to map cloud data to local records.",
      notices: appBundle.status === "available"
        ? [...appBundle.notices]
        : [...appBundle.notices, buildSupplementalRestoreCoverageNotice()],
      appBundleSummary: appBundle.captureSummary,
    });
  }

  // Recheck immediately before writing -- nothing should have changed
  // locally between the first check and now, but never trust a stale read.
  const finalLocalRestoreState = readLocalRestoreState(storage);
  const finalLocalCounts = finalLocalRestoreState.localCounts;
  if (!isLocalCoreEmpty(finalLocalCounts) && !canRestoreOverExistingLocalData(finalLocalRestoreState, allowPartialLocalSnapshot)) {
    return buildExecuteResult(CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY, { localCounts: finalLocalCounts });
  }

  // All cloud reads and validation are complete. The following localStorage
  // batch is synchronous, so a fresh ownership read directly before it closes
  // the takeover window without risking a partial restore batch.
  const applyAccess = await ensureCurrentDeviceCanApplyLocalRestore({
    configured,
    user,
    company,
    storage,
    reason: "before_local_restore_apply",
  });
  if (!applyAccess.ok) {
    if (applyAccess.deviceLockLost) return buildDeviceLockRestoreResult();
    return buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, { error: applyAccess.error });
  }

  try {
    storage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(payload.customers));
    storage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(payload.projects));
    storage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(payload.invoices));
    if (payload.estimates.length > 0) {
      storage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(payload.estimates));
    }
    if (payload.companyProfile) {
      storage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(payload.companyProfile));
    }
    if (payload.settings) {
      storage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(payload.settings));
    }
    if (Array.isArray(payload.scopeTemplates)) {
      storage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, JSON.stringify(payload.scopeTemplates));
    }
  } catch (error) {
    return buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, {
      error: asText(error?.message) || "Restore failed while writing local data.",
      notices: appBundle.status === "available"
        ? [...appBundle.notices]
        : [...appBundle.notices, buildSupplementalRestoreCoverageNotice()],
      appBundleSummary: appBundle.captureSummary,
      noWritesPerformed: false,
      noExistingLocalDataOverwritten: !overwritingExistingLocalData,
    });
  }

  dispatchChangeEvents({
    includeEstimates: payload.estimates.length > 0,
    includeCompanyProfile: Boolean(payload.companyProfile),
    includeSettings: Boolean(payload.settings),
    includeScopeTemplates: Array.isArray(payload.scopeTemplates),
    values: payload,
  });

  // A successful restore makes local data equal to cloud by definition --
  // there is nothing dirty to back up, so clear (not mark) the queue.
  const queueAccess = await ensureCurrentDeviceCanApplyLocalRestore({
    configured,
    user,
    company,
    storage,
    reason: "before_restore_queue_clear",
  });
  if (!queueAccess.ok) {
    const extra = {
      noWritesPerformed: false,
      noExistingLocalDataOverwritten: !overwritingExistingLocalData,
    };
    return queueAccess.deviceLockLost
      ? buildDeviceLockRestoreResult(extra)
      : buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, { error: queueAccess.error, ...extra });
  }
  clearCloudBackupDirty("cloud_restore_success");

  const completionAccess = await ensureCurrentDeviceCanApplyLocalRestore({
    configured,
    user,
    company,
    storage,
    reason: "before_restore_complete",
  });
  if (!completionAccess.ok) {
    const extra = {
      noWritesPerformed: false,
      noExistingLocalDataOverwritten: !overwritingExistingLocalData,
    };
    return completionAccess.deviceLockLost
      ? buildDeviceLockRestoreResult(extra)
      : buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, { error: completionAccess.error, ...extra });
  }

  try {
    lastRestoreCompleteAt = Date.now();
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(CLOUD_RESTORE_COMPLETE_EVENT, { detail: { restored: true, at: lastRestoreCompleteAt } }));
    }
  } catch {}

  return buildExecuteResult(CLOUD_RESTORE_STATUS.RESTORED, {
    restored: true,
    partial: blockers.length > 0,
    blockers,
    notices: appBundle.status === "available"
      ? [...appBundle.notices]
      : [...appBundle.notices, buildSupplementalRestoreCoverageNotice()],
    appBundleRestored: appBundle.status === "available",
    appBundleSummary: appBundle.captureSummary,
    noWritesPerformed: false,
    noExistingLocalDataOverwritten: !overwritingExistingLocalData,
    restoredCounts: {
      customers: payload.customers.length,
      projects: payload.projects.length,
      invoices: payload.invoices.length,
      estimates: payload.estimates.length,
    },
  });
}

function buildCloudExportResult(status, extra = {}) {
  return {
    exportVersion: CLOUD_BACKUP_EXPORT_ARTIFACT_VERSION,
    status,
    artifact: null,
    error: "",
    failedTable: "",
    notices: [],
    noWritesPerformed: true,
    ...extra,
  };
}

// Gate 13O-2J: read-only cloud backup JSON export. Fetches every cloud table
// the restore path reads, maps rows through the exact same cloud->local
// mapping restore uses, and returns a source:"cloud" artifact with explicit
// counts. Never writes to Supabase or localStorage. If ANY required table
// read fails, this returns an error instead of a "successful" empty artifact
// -- a cloud backup download must never silently degrade to zero records.
// Estimates are included only when they carry a valid restore_payload (the
// same safety rule restore enforces); missing ones are reported in
// restorePayloadCoverage, never reconstructed from guessed math.
export async function exportSupabaseCloudBackupArtifact({
  configured = false,
  user = null,
  company = null,
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated === CLOUD_RESTORE_STATUS.SIGNED_OUT) {
    return buildCloudExportResult(CLOUD_BACKUP_EXPORT_STATUS.SIGNED_OUT, {
      error: "Sign in to Supabase before downloading a cloud backup JSON.",
    });
  }
  if (gated === CLOUD_RESTORE_STATUS.NO_WORKSPACE) {
    return buildCloudExportResult(CLOUD_BACKUP_EXPORT_STATUS.NO_WORKSPACE, {
      error: "This account has no cloud workspace to export.",
    });
  }

  const client = getSupabaseClient();
  if (!client?.from) {
    return buildCloudExportResult(CLOUD_BACKUP_EXPORT_STATUS.ERROR, {
      error: "Supabase is not configured.",
    });
  }

  const companyId = asText(company?.id);
  const fetched = {};
  for (const table of ALL_CLOUD_TABLES) {
    const { rows, error } = await readCloudRows(client, table, companyId);
    if (error) {
      return buildCloudExportResult(CLOUD_BACKUP_EXPORT_STATUS.ERROR, {
        error: `Unable to read ${table} from Supabase. Cloud backup JSON was not created.`,
        failedTable: table,
      });
    }
    fetched[table] = rows;
  }

  // Company profile / settings / scope templates live in the optional app
  // restore bundle (app_settings row). Its absence must not block exporting
  // the core business records, but it is reported explicitly.
  const appBundle = await readAppRestoreBundleResult(client, companyId);

  const estimateRows = fetched.estimates;
  const payloadBackedEstimates = estimateRows.filter((row) => hasValidRestorePayload(row));
  const missingPayloadCount = estimateRows.length - payloadBackedEstimates.length;
  const missingPayloadLegacyIds = estimateRows
    .filter((row) => !hasValidRestorePayload(row))
    .map((row) => asText(row?.legacy_local_id))
    .filter(Boolean)
    .sort();

  let records;
  try {
    records = buildLocalRestorePayload({
      customers: fetched.customers,
      projects: fetched.projects,
      invoices: fetched.invoices,
      invoicePayments: fetched.invoice_payments,
      invoiceLineItems: fetched.invoice_line_items,
      estimates: payloadBackedEstimates,
      appRestoreBundle: appBundle.status === "available" ? appBundle.bundle : null,
    });
  } catch (error) {
    return buildCloudExportResult(CLOUD_BACKUP_EXPORT_STATUS.ERROR, {
      error: asText(error?.message) || "Unable to map cloud data for export.",
    });
  }

  const notices = [];
  if (missingPayloadCount > 0) {
    notices.push(buildNotice(
      "warning",
      "estimates_missing_restore_payload_excluded",
      `${missingPayloadCount} cloud estimate(s) have no restore payload and are not included as importable estimates. Run Settings -> Update Estimate Restore Payloads on a device that still has the original estimates, then export again.`,
      {
        missingRestorePayloadCount: missingPayloadCount,
        missingLegacyIds: missingPayloadLegacyIds,
      }
    ));
  }
  if (appBundle.status !== "available") {
    notices.push(buildNotice(
      "info",
      "app_restore_bundle_unavailable",
      "Company profile, settings, and scope templates were not available in the cloud app restore bundle and are not included in this export.",
      { appBundleStatus: appBundle.status }
    ));
  }

  const artifact = {
    artifactVersion: CLOUD_BACKUP_EXPORT_ARTIFACT_VERSION,
    schemaVersion: CLOUD_BACKUP_EXPORT_SCHEMA_VERSION,
    source: "cloud",
    app: "EstiPaid",
    exportedAt: new Date().toISOString(),
    companyId,
    companyName: asText(company?.name),
    counts: {
      customers: fetched.customers.length,
      projects: fetched.projects.length,
      estimates: fetched.estimates.length,
      estimateLineItems: fetched.estimate_line_items.length,
      invoices: fetched.invoices.length,
      invoiceLineItems: fetched.invoice_line_items.length,
      invoicePayments: fetched.invoice_payments.length,
      scopeTemplates: Array.isArray(records.scopeTemplates) ? records.scopeTemplates.length : 0,
    },
    restorePayloadCoverage: {
      totalEstimates: estimateRows.length,
      estimatesWithRestorePayload: payloadBackedEstimates.length,
      estimatesMissingRestorePayload: missingPayloadCount,
    },
    optionalSections: {
      appRestoreBundle: appBundle.status === "available" ? "available" : "missing",
    },
    // records.* are already in the local app storage shape: invoice line
    // items and payments are embedded on their invoices, and each estimate
    // is the exact captured restore_payload object (never a guessed rebuild).
    records: {
      customers: records.customers,
      projects: records.projects,
      estimates: records.estimates,
      invoices: records.invoices,
      companyProfile: records.companyProfile,
      settings: records.settings,
      scopeTemplates: records.scopeTemplates,
    },
    notices,
  };

  return buildCloudExportResult(CLOUD_BACKUP_EXPORT_STATUS.EXPORTED, {
    artifact,
    notices,
  });
}
