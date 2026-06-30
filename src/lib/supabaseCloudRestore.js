import { getSupabaseClient } from "./supabaseClient";
import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { STORAGE_KEYS } from "../constants/storageKeys";

export const SUPABASE_CLOUD_RESTORE_VERSION = "supabase-cloud-restore-v1";

export const CLOUD_RESTORE_STATUS = {
  SIGNED_OUT: "signed_out",
  NO_WORKSPACE: "no_workspace",
  LOCAL_NOT_EMPTY: "local_not_empty",
  NO_CLOUD_DATA: "no_cloud_data",
  ELIGIBLE: "eligible",
  RESTORED: "restored",
  BLOCKED_UNSUPPORTED_SHAPE: "blocked_unsupported_shape",
  ERROR: "error",
};

// customers/projects/invoices(+payments/line items) carry enough cloud
// columns to faithfully rebuild the local record shape; estimates do not
// (see buildEstimateBlockerNotice below for why they're excluded).
const ALL_CLOUD_TABLES = ["customers", "projects", "estimates", "invoices", "invoice_payments", "estimate_line_items", "invoice_line_items"];

function asText(value) {
  return String(value || "").trim();
}

function buildNotice(level, code, message, details = {}) {
  return { level, code, message, details };
}

// Estimates are intentionally not restorable yet: the cloud `estimates`
// table only stores company_id/customer_id/project_id/legacy_local_id/
// estimate_number/status/document_type/total_amount/notes/terms (see
// mapEstimatePayloads in supabaseMigrationWriter.js). It does not carry the
// local estimate's computational inputs -- labor.lines[].hours, labor
// hazardPct/riskPct/multiplier, materials.markupPct, or materialsMode (see
// src/estimator/defaultState.js). Reconstructing those by guessing defaults
// would let the estimator engine silently recompute wrong totals the next
// time the estimate is edited, which is exactly the "guessed restore" this
// lane must not do. Estimate line items have the same gap: the cloud row
// only has description/quantity/unit_price/unit_cost/total_price/kind, not
// the original labor-line `rate` vs material-item `price` field shape.
function buildEstimateBlockerNotice(estimateCount, lineItemCount) {
  return buildNotice(
    "warning",
    "estimates_not_reconstructable",
    "Estimates cannot be safely restored yet. The cloud copy only stores a financial summary (estimate number, status, total amount, notes) and flattened line items, not the original labor hours, hazard %, risk %, multiplier, or materials markup % needed to recompute the estimate correctly. Restoring a guessed version risks silently wrong totals if the estimate is edited again.",
    {
      table: "estimates",
      cloudEstimateCount: estimateCount,
      cloudEstimateLineItemCount: lineItemCount,
      missingFields: ["labor.lines[].hours", "labor.hazardPct", "labor.riskPct", "labor.multiplier", "materials.markupPct", "materialsMode"],
    }
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

function buildPreviewResult(status, extra = {}) {
  return {
    restoreVersion: SUPABASE_CLOUD_RESTORE_VERSION,
    status,
    eligible: false,
    cloudCounts: null,
    localCounts: null,
    blockers: [],
    notices: [],
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
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated) return buildPreviewResult(gated);

  const client = getSupabaseClient();
  if (!client?.from) {
    return buildPreviewResult(CLOUD_RESTORE_STATUS.ERROR, {
      notices: [buildNotice("error", "supabase_not_configured", "Supabase is not configured.")],
    });
  }

  const localCounts = readLocalCoreCounts(storageSnapshot);
  if (!isLocalCoreEmpty(localCounts)) {
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

  const coreCloudTotal = Number(cloudCounts.customers || 0) + Number(cloudCounts.projects || 0) + Number(cloudCounts.invoices || 0);
  const estimateCount = Number(cloudCounts.estimates || 0);
  const estimateLineItemCount = Number(cloudCounts.estimate_line_items || 0);

  const blockers = [];
  if (estimateCount > 0 || estimateLineItemCount > 0) {
    blockers.push(buildEstimateBlockerNotice(estimateCount, estimateLineItemCount));
  }

  if (coreCloudTotal === 0) {
    return buildPreviewResult(CLOUD_RESTORE_STATUS.NO_CLOUD_DATA, { localCounts, cloudCounts, blockers, notices });
  }

  return buildPreviewResult(CLOUD_RESTORE_STATUS.ELIGIBLE, {
    eligible: true,
    partial: blockers.length > 0,
    localCounts,
    cloudCounts,
    blockers,
    notices,
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
function buildLocalRestorePayload({ customers, projects, invoices, invoicePayments, invoiceLineItems }) {
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

  return { customers: localCustomers, projects: localProjects, invoices: localInvoices };
}

function dispatchChangeEvents() {
  try {
    if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
    window.dispatchEvent(new Event("estipaid:customers-changed"));
    window.dispatchEvent(new Event("estipaid:projects-changed"));
    window.dispatchEvent(new Event("estipaid:invoices-changed"));
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
    noWritesPerformed: true,
    noCloudDataDeleted: true,
    noExistingLocalDataOverwritten: true,
    ...extra,
  };
}

// Phase B: explicit restore. Only call this from a direct user click after
// the user has typed the confirmation phrase. Rechecks local emptiness both
// before fetching cloud data and again immediately before writing, builds
// the complete local payload in memory first, and only then writes
// localStorage in one guarded pass. Never writes to Supabase. Estimates are
// reported as a blocker (see buildEstimateBlockerNotice) rather than
// restored, but customers/projects/invoices/payments/invoice line items are
// still restored when present -- this is a transparent partial restore, not
// a guessed one: every field that is written comes directly from a cloud
// column with a known, faithful local equivalent.
export async function executeSupabaseCloudRestore({
  storage,
  configured = false,
  user = null,
  company = null,
} = {}) {
  const gated = gateBasicPrerequisites({ configured, user, company });
  if (gated) return buildExecuteResult(gated);

  const client = getSupabaseClient();
  if (!client?.from) {
    return buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, {
      error: "Supabase is not configured.",
    });
  }

  const initialLocalCounts = readLocalCoreCounts(storage);
  if (!isLocalCoreEmpty(initialLocalCounts)) {
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
  const blockers = (estimateCount > 0 || estimateLineItemCount > 0)
    ? [buildEstimateBlockerNotice(estimateCount, estimateLineItemCount)]
    : [];

  const coreRestorableTotal = fetched.customers.length + fetched.projects.length + fetched.invoices.length;
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
    });
  } catch (error) {
    return buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, {
      error: asText(error?.message) || "Unable to map cloud data to local records.",
    });
  }

  // Recheck immediately before writing -- nothing should have changed
  // locally between the first check and now, but never trust a stale read.
  const finalLocalCounts = readLocalCoreCounts(storage);
  if (!isLocalCoreEmpty(finalLocalCounts)) {
    return buildExecuteResult(CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY, { localCounts: finalLocalCounts });
  }

  try {
    storage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(payload.customers));
    storage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(payload.projects));
    storage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(payload.invoices));
  } catch (error) {
    return buildExecuteResult(CLOUD_RESTORE_STATUS.ERROR, {
      error: asText(error?.message) || "Restore failed while writing local data.",
      noWritesPerformed: false,
    });
  }

  dispatchChangeEvents();

  return buildExecuteResult(CLOUD_RESTORE_STATUS.RESTORED, {
    restored: true,
    partial: blockers.length > 0,
    blockers,
    noWritesPerformed: false,
    restoredCounts: {
      customers: payload.customers.length,
      projects: payload.projects.length,
      invoices: payload.invoices.length,
    },
  });
}
