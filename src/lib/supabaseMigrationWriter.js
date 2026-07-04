import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { getSupabaseClient } from "./supabaseClient";
import { collectBackendMappingWarnings, mapLocalSnapshotToBackendDraft } from "../utils/backendDataMapper";
import { buildEstimateRestorePayload, ESTIMATE_RESTORE_PAYLOAD_VERSION } from "./supabaseEstimateRestorePayload";
import {
  buildIntegrityNotices,
  buildLocalSnapshotFromArtifact,
  repairStoredLocalDataIntegrity,
} from "./localDataIntegrity";

export const SUPABASE_MIGRATION_WRITER_VERSION = "supabase-migration-writer-v1";

const ALLOWED_MIGRATION_ROLES = new Set(["owner", "admin"]);
const COUNTED_TABLES = [
  ["customers", "customers"],
  ["projects", "projects"],
  ["estimates", "estimates"],
  ["estimate_line_items", "estimateLineItems"],
  ["invoices", "invoices"],
  ["invoice_line_items", "invoiceLineItems"],
  ["invoice_payments", "invoicePayments"],
];
const PROJECT_STATUS_MAP = new Map([
  ["active", "active"],
  ["completed", "completed"],
  ["archived", "archived"],
  ["draft", "draft"],
  ["open", "active"],
  ["in_progress", "active"],
  ["in-progress", "active"],
  ["pending", "draft"],
  ["planned", "draft"],
  ["proposal", "draft"],
  ["closed", "completed"],
  ["done", "completed"],
  ["complete", "completed"],
  ["cancelled", "archived"],
  ["canceled", "archived"],
]);
const ESTIMATE_LINE_ITEM_READY_MESSAGE =
  "Estimate line items are ready for guarded migration using company_id + legacy_local_id idempotency.";
const INVOICE_LINE_ITEM_READY_MESSAGE =
  "Invoice line items are ready for guarded migration using company_id + legacy_local_id idempotency.";

function asText(value) {
  return String(value || "").trim();
}

function buildNotice(level, code, message, details = {}) {
  return { level, code, message, details };
}

function buildTableResult(table, label, localCount, status = "pending", extra = {}) {
  return {
    table,
    label,
    localCount: Number(localCount || 0),
    status,
    written: 0,
    skipped: 0,
    reused: 0,
    failed: 0,
    ...extra,
  };
}

function hasBlockingPreviewNotice(preview) {
  const notices = Array.isArray(preview?.notices) ? preview.notices : [];
  return notices.some((notice) => String(notice?.level || "").toLowerCase() === "error");
}

export function isSupabaseMigrationPreviewReady(preview) {
  const validations = preview?.validations || {};
  const localCounts = preview?.localCounts || {};
  const totalLocalRecords = (
    Number(localCounts.customers || 0) +
    Number(localCounts.projects || 0) +
    Number(localCounts.estimates || 0) +
    Number(localCounts.invoices || 0) +
    Number(localCounts.invoicePayments || 0)
  );

  return Boolean(
    preview &&
    validations.supabaseConfigured &&
    validations.signedIn &&
    validations.hasCompany &&
    validations.roleAllowedForMigration &&
    validations.backupDownloadAvailable &&
    validations.exportArtifactBuilt &&
    validations.localDataReadable &&
    totalLocalRecords > 0 &&
    !hasBlockingPreviewNotice(preview)
  );
}

async function readTableCount(client, table, companyId) {
  const response = await client
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  if (response?.error) {
    throw response.error;
  }

  return Number(response?.count || 0);
}

async function readCloudCounts(client, companyId) {
  const entries = await Promise.all(COUNTED_TABLES.map(async ([table, key]) => {
    const count = await readTableCount(client, table, companyId);
    return [key, count];
  }));
  return Object.fromEntries(entries);
}

async function readExistingCustomers(client, companyId) {
  return readExistingRows(client, "customers", companyId);
}

async function readExistingRows(client, table, companyId) {
  const response = await client
    .from(table)
    .select("id, legacy_local_id")
    .eq("company_id", companyId);

  if (response?.error) {
    throw response.error;
  }

  return Array.isArray(response?.data) ? response.data : [];
}

function collectInvoicePaymentValidationIssues(draft) {
  const warnings = [];
  const seen = new Set();

  (Array.isArray(draft?.invoicePayments) ? draft.invoicePayments : []).forEach((payment, index) => {
    const legacyId = asText(payment?.legacy_local_id);
    if (!legacyId) {
      warnings.push(buildNotice(
        "error",
        `invoice_payment_missing_id:${index}`,
        "Invoice payment is missing a local id.",
      ));
      return;
    }
    if (seen.has(legacyId)) {
      warnings.push(buildNotice(
        "error",
        `duplicate_invoice_payment_local_id:${legacyId}`,
        "Duplicate local invoice payment id detected.",
      ));
      return;
    }
    seen.add(legacyId);
  });

  return warnings;
}

function collectDocumentIdentifierIssues(draft) {
  const notices = [];

  (Array.isArray(draft?.estimates) ? draft.estimates : []).forEach((estimate, index) => {
    if (!asText(estimate?.estimate_number)) {
      const legacyId = asText(estimate?.legacy_local_id || estimate?.id) || `estimate_${index + 1}`;
      notices.push(buildNotice(
        "error",
        `estimate_number_missing:${index}`,
        `Estimate ${legacyId} is missing an estimate number required by the cloud schema.`,
      ));
    }
  });

  (Array.isArray(draft?.invoices) ? draft.invoices : []).forEach((invoice, index) => {
    if (!asText(invoice?.invoice_number)) {
      const legacyId = asText(invoice?.legacy_local_id || invoice?.id) || `invoice_${index + 1}`;
      notices.push(buildNotice(
        "error",
        `invoice_number_missing:${index}`,
        `Invoice ${legacyId} is missing an invoice number required by the cloud schema.`,
      ));
    }
  });

  return notices;
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

function sanitizeLegacyIdSegment(value, fallback = "line_item") {
  const normalized = asText(value).toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

// Raw local line-item ids may be missing, reused, parent-scoped, or duplicated
// across the company, so they are never used as the Supabase legacy_local_id.
// stableIndex prefers sort_order only when every item in the parent's line_items
// array has a defined, mutually-unique sort_order; otherwise it falls back to the
// item's position in the normalized draft array. Mixing the two within one parent
// could let a sort_order value collide with another item's array index, so the
// choice is made once for the whole parent, not per item.
function computeStableLineItemIndexes(items) {
  const list = Array.isArray(items) ? items : [];
  const sortOrders = list.map((item) => {
    const raw = item?.sort_order;
    if (raw === null || raw === undefined || raw === "") return null;
    const num = Number(raw);
    return Number.isFinite(num) ? num : null;
  });
  const allDefined = sortOrders.every((value) => value !== null);
  const allUnique = allDefined && new Set(sortOrders).size === sortOrders.length;
  if (allDefined && allUnique) return sortOrders;
  return list.map((_, index) => index);
}

function buildDeterministicLineItemLegacyId(parentLegacyId, stableIndex, entityType) {
  const safeParent = sanitizeLegacyIdSegment(parentLegacyId, "parent");
  return `${entityType}:${safeParent}:line:${stableIndex}`;
}

function buildLineItemMetadata(item, { includeKind = false } = {}) {
  const metadata = {};
  const unitCost = item?.unit_cost;
  if (unitCost !== null && unitCost !== undefined && unitCost !== "") {
    const nextCost = Number(unitCost);
    if (Number.isFinite(nextCost)) metadata.unit_cost = nextCost;
  }
  if (includeKind) {
    const kind = asText(item?.kind);
    if (kind) metadata.kind = kind;
  }
  return Object.keys(metadata).length > 0 ? metadata : null;
}

function projectHasRealActivity(project, localSnapshot) {
  const projectId = asText(project?.id || project?.legacy_local_id || project?.legacyLocalId);
  const linkedEstimate = (Array.isArray(localSnapshot?.estimates) ? localSnapshot.estimates : []).some((estimate) => {
    return asText(estimate?.projectId) === projectId;
  });
  const linkedInvoice = (Array.isArray(localSnapshot?.invoices) ? localSnapshot.invoices : []).some((invoice) => {
    return asText(invoice?.projectId || invoice?.project?.id) === projectId;
  });
  return Boolean(
    linkedEstimate ||
    linkedInvoice ||
    asText(project?.projectName || project?.name) ||
    asText(project?.projectNumber) ||
    asText(project?.notes || project?.projectNotes) ||
    asText(project?.scopeSummary || project?.scopeNotes || project?.additionalNotes)
  );
}

function normalizeProjectStatusForMigration(sourceProject, localSnapshot) {
  const raw = asText(sourceProject?.status || sourceProject?.projectStatus).toLowerCase();
  if (PROJECT_STATUS_MAP.has(raw)) {
    return {
      status: PROJECT_STATUS_MAP.get(raw),
      changed: PROJECT_STATUS_MAP.get(raw) !== raw,
      from: raw,
    };
  }

  const fallback = projectHasRealActivity(sourceProject, localSnapshot) ? "active" : "draft";
  return {
    status: fallback,
    changed: raw !== fallback,
    from: raw,
  };
}

function collectProjectStatusNormalization(localSnapshot) {
  const normalized = [];
  const issues = [];

  (Array.isArray(localSnapshot?.projects) ? localSnapshot.projects : []).forEach((project, index) => {
    const next = normalizeProjectStatusForMigration(project, localSnapshot);
    if (!next.status) {
      issues.push(buildNotice(
        "error",
        `project_status_unresolved:${index}`,
        "Project status could not be normalized for migration.",
      ));
      return;
    }
    if (next.changed) {
      normalized.push({
        legacyLocalId: asText(project?.id || project?.legacy_local_id || project?.legacyLocalId) || `project_${index}`,
        from: next.from || "(blank)",
        to: next.status,
      });
    }
  });

  return { normalized, issues };
}

function classifyMappingWarnings(warnings) {
  return (Array.isArray(warnings) ? warnings : []).filter((warning) => {
    const code = asText(warning?.code);
    const severity = asText(warning?.severity).toLowerCase();
    if (severity === "error") {
      return !code.startsWith("duplicate_local_id:");
    }
    return false;
  }).map((warning) => buildNotice(
    "error",
    asText(warning?.code),
    asText(warning?.message) || "Migration mapping warning requires review before write.",
    { entityType: warning?.entityType, entityId: warning?.entityId }
  ));
}

function mapCustomerPayloads(draft, userId) {
  return (Array.isArray(draft?.customers) ? draft.customers : []).map((customer) => ({
    company_id: asText(customer?.company_id),
    legacy_local_id: asText(customer?.legacy_local_id),
    display_name: customer?.display_name || null,
    company_name: customer?.company_name || null,
    contact_name: customer?.contact_name || null,
    phone: customer?.phone || null,
    email: customer?.email || null,
    billing_address: customer?.billing_address || customer?.address || null,
    customer_type: customer?.customer_type || null,
    customer_status: customer?.status || null,
    created_by: userId,
    updated_by: userId,
  }));
}

function mapProjectPayloads(draft, customerIdByLegacyId, userId, localSnapshot) {
  return (Array.isArray(draft?.projects) ? draft.projects : []).map((project, index) => {
    const sourceProject = Array.isArray(localSnapshot?.projects) ? localSnapshot.projects[index] : null;
    const normalizedStatus = normalizeProjectStatusForMigration(sourceProject || project, localSnapshot).status;
    return ({
    company_id: asText(project?.company_id),
    customer_id: customerIdByLegacyId.get(asText(project?.customer_legacy_local_id)) || null,
    legacy_local_id: asText(project?.legacy_local_id),
    project_number: project?.project_number || null,
    project_name: project?.project_name || null,
    site_address: project?.site_address || null,
    status: normalizedStatus || "draft",
    notes: project?.notes || null,
    scope_summary: project?.scope_summary || null,
    created_by: userId,
    updated_by: userId,
  });
  });
}

function mapEstimatePayloads(draft, customerIdByLegacyId, projectIdByLegacyId, userId) {
  return (Array.isArray(draft?.estimates) ? draft.estimates : []).map((estimate) => ({
    company_id: asText(estimate?.company_id),
    customer_id: customerIdByLegacyId.get(asText(estimate?.customer_legacy_local_id)) || null,
    project_id: projectIdByLegacyId.get(asText(estimate?.project_legacy_local_id)) || null,
    legacy_local_id: asText(estimate?.legacy_local_id),
    estimate_number: estimate?.estimate_number || null,
    status: estimate?.status || "pending",
    document_type: "estimate",
    total_amount: estimate?.approved_total ?? estimate?.grand_total ?? estimate?.total ?? null,
    notes: estimate?.notes || null,
    terms: estimate?.terms || null,
    converted_invoice_legacy_id: estimate?.converted_invoice_legacy_local_id || null,
    restore_payload: estimate?.restore_payload || null,
    restore_payload_version: estimate?.restore_payload ? ESTIMATE_RESTORE_PAYLOAD_VERSION : null,
    restore_payload_captured_at: estimate?.restore_payload ? new Date().toISOString() : null,
    created_by: userId,
    updated_by: userId,
  }));
}

function attachEstimateRestorePayloads(draft, localSnapshot) {
  const sourceEstimates = Array.isArray(localSnapshot?.estimates) ? localSnapshot.estimates : [];
  const sourceByLegacyId = new Map(
    sourceEstimates
      .map((estimate) => [asText(estimate?.id), estimate])
      .filter(([legacyLocalId]) => Boolean(legacyLocalId))
  );

  return {
    ...(draft || {}),
    estimates: (Array.isArray(draft?.estimates) ? draft.estimates : []).map((estimate) => {
      const legacyLocalId = asText(estimate?.legacy_local_id);
      const sourceEstimate = sourceByLegacyId.get(legacyLocalId);
      if (!sourceEstimate) return { ...estimate };

      return {
        ...estimate,
        restore_payload: buildEstimateRestorePayload(sourceEstimate),
      };
    }),
  };
}

function mapInvoicePayloads(draft, customerIdByLegacyId, projectIdByLegacyId, estimateIdByLegacyId, userId) {
  return (Array.isArray(draft?.invoices) ? draft.invoices : []).map((invoice) => ({
    company_id: asText(invoice?.company_id),
    customer_id: customerIdByLegacyId.get(asText(invoice?.customer_legacy_local_id)) || null,
    project_id: projectIdByLegacyId.get(asText(invoice?.project_legacy_local_id)) || null,
    estimate_id: estimateIdByLegacyId.get(asText(invoice?.source_estimate_legacy_local_id)) || null,
    source_estimate_legacy_id: invoice?.source_estimate_legacy_local_id || null,
    legacy_local_id: asText(invoice?.legacy_local_id),
    invoice_number: invoice?.invoice_number || null,
    estimate_number: invoice?.estimate_number || null,
    status: invoice?.status || "draft",
    payment_status: invoice?.payment_status || "unpaid",
    invoice_date: invoice?.invoice_date || null,
    due_date: invoice?.due_date || null,
    total_amount: invoice?.total ?? null,
    amount_paid: invoice?.amount_paid ?? 0,
    balance_remaining: invoice?.balance_remaining ?? null,
    notes: invoice?.notes || null,
    terms: invoice?.terms || null,
    created_by: userId,
    updated_by: userId,
  }));
}

function mapInvoicePaymentPayloads(draft, invoiceIdByLegacyId, userId) {
  return (Array.isArray(draft?.invoicePayments) ? draft.invoicePayments : []).map((payment) => ({
    company_id: asText(payment?.company_id),
    invoice_id: invoiceIdByLegacyId.get(asText(payment?.invoice_legacy_local_id)) || null,
    legacy_local_id: asText(payment?.legacy_local_id),
    amount: payment?.amount ?? null,
    method: payment?.method || null,
    status: payment?.status || null,
    paid_at: payment?.paid_at || null,
    created_by: userId,
    updated_by: userId,
  }));
}

function mapEstimateLineItemPayloads(draft, estimateIdByLegacyId) {
  const payloads = [];
  const issues = [];
  const seenLegacyIds = new Set();
  const seenRawIds = new Set();
  const normalizedRawDuplicates = new Set();

  (Array.isArray(draft?.estimates) ? draft.estimates : []).forEach((estimate) => {
    const parentLegacyId = asText(estimate?.legacy_local_id);
    const estimateId = estimateIdByLegacyId.get(parentLegacyId) || "";
    const companyId = asText(estimate?.company_id);
    const items = Array.isArray(estimate?.line_items) ? estimate.line_items : [];
    const stableIndexes = computeStableLineItemIndexes(items);

    items.forEach((item, index) => {
      const legacyLocalId = buildDeterministicLineItemLegacyId(parentLegacyId, stableIndexes[index], "estimate");

      const rawId = asText(item?.legacy_local_id || item?.legacyLocalId || item?.id);
      if (rawId) {
        if (seenRawIds.has(rawId)) normalizedRawDuplicates.add(rawId);
        seenRawIds.add(rawId);
      }

      if (!parentLegacyId) {
        issues.push(buildNotice("error", `estimate_line_item_parent_missing:${index}`, "Estimate line item is missing its parent estimate local id."));
        return;
      }
      if (!estimateId) {
        issues.push(buildNotice("error", `estimate_line_item_parent_lookup_missing:${legacyLocalId}`, "Estimate line item could not resolve a cloud estimate parent id."));
        return;
      }
      if (seenLegacyIds.has(legacyLocalId)) {
        issues.push(buildNotice("error", `duplicate_estimate_line_item_local_id:${legacyLocalId}`, "Duplicate estimate line-item local id detected."));
        return;
      }
      seenLegacyIds.add(legacyLocalId);

      const metadata = buildLineItemMetadata(item);
      payloads.push({
        company_id: companyId,
        estimate_id: estimateId,
        legacy_local_id: legacyLocalId,
        sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index,
        description: item?.description || null,
        quantity: item?.quantity ?? null,
        unit: item?.unit || null,
        unit_price: item?.unit_price ?? null,
        total_price: item?.total ?? null,
        line_role: item?.kind || null,
        ...(metadata ? { metadata } : {}),
      });
    });
  });

  if (normalizedRawDuplicates.size > 0) {
    issues.push(buildNotice(
      "warning",
      "estimate_line_item_raw_ids_normalized",
      "Duplicate raw estimate line-item ids were normalized into deterministic migration ids.",
      { count: normalizedRawDuplicates.size }
    ));
  }

  return { payloads, issues };
}

function mapInvoiceLineItemPayloads(draft, invoiceIdByLegacyId) {
  const payloads = [];
  const issues = [];
  const seenLegacyIds = new Set();
  const seenRawIds = new Set();
  const normalizedRawDuplicates = new Set();

  (Array.isArray(draft?.invoices) ? draft.invoices : []).forEach((invoice) => {
    const parentLegacyId = asText(invoice?.legacy_local_id);
    const invoiceId = invoiceIdByLegacyId.get(parentLegacyId) || "";
    const companyId = asText(invoice?.company_id);
    const items = Array.isArray(invoice?.line_items) ? invoice.line_items : [];
    const stableIndexes = computeStableLineItemIndexes(items);

    items.forEach((item, index) => {
      const legacyLocalId = buildDeterministicLineItemLegacyId(parentLegacyId, stableIndexes[index], "invoice");

      const rawId = asText(item?.legacy_local_id || item?.legacyLocalId || item?.id);
      if (rawId) {
        if (seenRawIds.has(rawId)) normalizedRawDuplicates.add(rawId);
        seenRawIds.add(rawId);
      }

      if (!parentLegacyId) {
        issues.push(buildNotice("error", `invoice_line_item_parent_missing:${index}`, "Invoice line item is missing its parent invoice local id."));
        return;
      }
      if (!invoiceId) {
        issues.push(buildNotice("error", `invoice_line_item_parent_lookup_missing:${legacyLocalId}`, "Invoice line item could not resolve a cloud invoice parent id."));
        return;
      }
      if (seenLegacyIds.has(legacyLocalId)) {
        issues.push(buildNotice("error", `duplicate_invoice_line_item_local_id:${legacyLocalId}`, "Duplicate invoice line-item local id detected."));
        return;
      }
      seenLegacyIds.add(legacyLocalId);

      const metadata = buildLineItemMetadata(item, { includeKind: true });
      payloads.push({
        company_id: companyId,
        invoice_id: invoiceId,
        legacy_local_id: legacyLocalId,
        sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index,
        description: item?.description || null,
        quantity: item?.quantity ?? null,
        unit: item?.unit || null,
        unit_price: item?.unit_price ?? null,
        total_price: item?.total ?? null,
        ...(metadata ? { metadata } : {}),
      });
    });
  });

  if (normalizedRawDuplicates.size > 0) {
    issues.push(buildNotice(
      "warning",
      "invoice_line_item_raw_ids_normalized",
      "Duplicate raw invoice line-item ids were normalized into deterministic migration ids.",
      { count: normalizedRawDuplicates.size }
    ));
  }

  return { payloads, issues };
}

function buildLegacyIdMap(rows) {
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [asText(row?.legacy_local_id), asText(row?.id)]));
}

function buildLegacyIdSet(rows) {
  return new Set((Array.isArray(rows) ? rows : []).map((row) => asText(row?.legacy_local_id)).filter(Boolean));
}

function buildPayloadLegacyIdSet(rows) {
  return new Set((Array.isArray(rows) ? rows : []).map((row) => asText(row?.legacy_local_id)).filter(Boolean));
}

const SAFE_RESUME_TABLES = [
  ["customers", "customers", "customer"],
  ["projects", "projects", "project"],
  ["estimates", "estimates", "estimate"],
  ["invoices", "invoices", "invoice"],
  ["invoice_payments", "invoicePayments", "invoice payment"],
];

function setsEqual(left, right) {
  if (left.size !== right.size) return false;
  for (const value of left) {
    if (!right.has(value)) return false;
  }
  return true;
}

function summarizeNormalizedProjectStatuses(normalizedStatuses) {
  if (!Array.isArray(normalizedStatuses) || normalizedStatuses.length === 0) return null;
  const summary = normalizedStatuses
    .map((entry) => `${entry.legacyLocalId}: ${entry.from} -> ${entry.to}`)
    .join(", ");
  return buildNotice("warning", "project_statuses_normalized", `Project statuses normalized for migration: ${summary}`);
}

function isCustomersOnlyPartialState(localCounts, cloudCounts) {
  return (
    Number(cloudCounts?.customers || 0) === Number(localCounts?.customers || 0) &&
    Number(cloudCounts?.projects || 0) === 0 &&
    Number(cloudCounts?.estimates || 0) === 0 &&
    Number(cloudCounts?.invoices || 0) === 0 &&
    Number(cloudCounts?.invoicePayments || 0) === 0
  );
}

async function collectExistingCloudResumeIssues(client, companyId, draft) {
  const notices = [];

  for (const [table, draftKey, label] of SAFE_RESUME_TABLES) {
    const existingRows = await readExistingRows(client, table, companyId);
    const rowsMissingLegacyId = existingRows.some((row) => !asText(row?.legacy_local_id));
    if (rowsMissingLegacyId) {
      notices.push(buildNotice(
        "error",
        `${table}_legacy_local_id_missing`,
        `Cloud ${label} rows are missing legacy_local_id values, so safe backup resume is blocked.`
      ));
      continue;
    }

    const localIds = buildLegacyIdSet(draft?.[draftKey]);
    const cloudIds = buildLegacyIdSet(existingRows);
    const cloudOnlyIds = [...cloudIds].filter((legacyId) => !localIds.has(legacyId)).sort();

    if (cloudOnlyIds.length > 0) {
      notices.push(buildNotice(
        "error",
        `${table}_cloud_only_rows`,
        `Cloud ${label} rows exist that are not present on this device, so backup is blocked without an override path.`,
        { cloudOnlyLegacyIds: cloudOnlyIds }
      ));
    }
  }

  return notices;
}

function summarizeLineItemSync(payloads, existingRows) {
  const existingIds = buildLegacyIdSet(existingRows);
  const reused = (Array.isArray(payloads) ? payloads : []).reduce((sum, row) => {
    return sum + (existingIds.has(asText(row?.legacy_local_id)) ? 1 : 0);
  }, 0);
  const written = Math.max((Array.isArray(payloads) ? payloads.length : 0) - reused, 0);
  return { reused, written };
}

async function migrateLineItemTable({
  client,
  table,
  baseResult,
  payloads,
  existingRows,
}) {
  if (!Array.isArray(payloads) || payloads.length === 0) {
    return {
      result: {
        ...baseResult,
        status: "skipped",
        written: 0,
        reused: 0,
        skipped: 0,
      },
      response: null,
    };
  }

  const { written, reused } = summarizeLineItemSync(payloads, existingRows);
  const existingSet = buildLegacyIdSet(existingRows);
  const payloadSet = buildPayloadLegacyIdSet(payloads);
  const alreadyMatched = written === 0 && setsEqual(existingSet, payloadSet);

  if (alreadyMatched) {
    return {
      result: {
        ...baseResult,
        status: "reused",
        written: 0,
        reused,
        skipped: reused,
      },
      response: null,
    };
  }

  const response = await upsertTableRows(client, table, payloads);
  if (response?.error) {
    return {
      result: {
        ...baseResult,
        status: "failed",
        failed: payloads.length,
        error: asText(response.error?.message),
      },
      response,
    };
  }

  return {
    result: {
      ...baseResult,
      status: written > 0 ? "success" : "reused",
      written,
      reused,
      skipped: reused,
    },
    response,
  };
}

async function upsertTableRows(client, table, rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { data: [], error: null };
  }

  return client
    .from(table)
    .upsert(rows, { onConflict: "company_id,legacy_local_id" })
    .select("id, legacy_local_id");
}

export async function runSupabaseMigrationWrite({
  storageSnapshot,
  configured = false,
  user = null,
  company = null,
  role = "",
  backupDownloadAvailable = false,
  preview = null,
} = {}) {
  const notices = [];
  const tableResults = [
    buildTableResult("customers", "Customers", preview?.localCounts?.customers || 0),
    buildTableResult("projects", "Projects", preview?.localCounts?.projects || 0),
    buildTableResult("estimates", "Estimates", preview?.localCounts?.estimates || 0),
    buildTableResult("estimate_line_items", "Estimate line items", 0, "skipped", {
      skipped: 0,
      reason: "Skipped in this guarded lane until line-item idempotency is separately approved.",
    }),
    buildTableResult("invoices", "Invoices", preview?.localCounts?.invoices || 0),
    buildTableResult("invoice_line_items", "Invoice line items", 0, "skipped", {
      skipped: 0,
      reason: "Skipped in this guarded lane until line-item idempotency is separately approved.",
    }),
    buildTableResult("invoice_payments", "Invoice payments", preview?.localCounts?.invoicePayments || 0),
  ];

  const normalizedRole = asText(role).toLowerCase();
  const userId = asText(user?.id);
  const companyId = asText(company?.id);
  const client = getSupabaseClient();

  if (!isSupabaseMigrationPreviewReady(preview)) {
    return {
      ok: false,
      blocked: true,
      reason: "Run a successful migration preview before enabling cloud migration writes.",
      notices: [buildNotice("error", "preview_required", "Run a successful migration preview before enabling cloud migration writes.")],
      tableResults,
      noLocalDeletes: true,
    };
  }

  if (!configured || !client?.from) {
    return {
      ok: false,
      blocked: true,
      reason: "Supabase is not configured.",
      notices: [buildNotice("error", "supabase_not_configured", "Supabase is not configured.")],
      tableResults,
      noLocalDeletes: true,
    };
  }

  if (!userId || !companyId || !ALLOWED_MIGRATION_ROLES.has(normalizedRole) || !backupDownloadAvailable) {
    if (!userId) notices.push(buildNotice("error", "not_signed_in", "No signed-in Supabase user found."));
    if (!companyId) notices.push(buildNotice("error", "company_missing", "No cloud workspace is linked to this account yet."));
    if (!ALLOWED_MIGRATION_ROLES.has(normalizedRole)) notices.push(buildNotice("error", "role_not_allowed", "Only owner/admin may run the migration write."));
    if (!backupDownloadAvailable) notices.push(buildNotice("error", "backup_gate_missing", "Download Backup JSON action is not available."));
    return {
      ok: false,
      blocked: true,
      reason: "Migration prerequisites are not satisfied.",
      notices,
      tableResults,
      noLocalDeletes: true,
    };
  }

  const artifact = buildLocalStorageExportArtifact(storageSnapshot);
  let localSnapshot = buildLocalSnapshotFromArtifact(artifact);
  const repairedLocalData = repairStoredLocalDataIntegrity(storageSnapshot);
  localSnapshot = repairedLocalData.snapshot;
  if (repairedLocalData.changed) {
    notices.push(buildNotice(
      "warning",
      "safe_metadata_repaired",
      "Safe metadata was repaired before cloud backup. Totals, payments, and visible document values were not changed.",
      { repairs: repairedLocalData.repairs }
    ));
  }
  const integrity = repairedLocalData.integrity;
  notices.push(...buildIntegrityNotices(integrity));
  if (integrity?.backupReadiness?.blocked) {
    return {
      ok: false,
      blocked: true,
      reason: "Migration write blocked by local validation issues.",
      notices,
      integrity,
      tableResults,
      noLocalDeletes: true,
    };
  }
  const mappedDraft = mapLocalSnapshotToBackendDraft(localSnapshot, {
    companyId,
    userId,
  });
  const draft = attachEstimateRestorePayloads(mappedDraft, localSnapshot);
  const normalizedProjectStatuses = collectProjectStatusNormalization(localSnapshot);
  const localLineItemCounts = countDraftLineItems(draft);

  tableResults[3] = buildTableResult("estimate_line_items", "Estimate line items", localLineItemCounts.estimateLineItems, "skipped", {
    skipped: localLineItemCounts.estimateLineItems,
    reason: localLineItemCounts.estimateLineItems > 0
      ? ESTIMATE_LINE_ITEM_READY_MESSAGE
      : "No local estimate line items were found for migration.",
  });
  tableResults[5] = buildTableResult("invoice_line_items", "Invoice line items", localLineItemCounts.invoiceLineItems, "skipped", {
    skipped: localLineItemCounts.invoiceLineItems,
    reason: localLineItemCounts.invoiceLineItems > 0
      ? INVOICE_LINE_ITEM_READY_MESSAGE
      : "No local invoice line items were found for migration.",
  });

  notices.push(...classifyMappingWarnings(collectBackendMappingWarnings(localSnapshot, { companyId, userId })));
  notices.push(...collectDocumentIdentifierIssues(draft));
  notices.push(...collectInvoicePaymentValidationIssues(draft));
  notices.push(...normalizedProjectStatuses.issues);
  const normalizationSummary = summarizeNormalizedProjectStatuses(normalizedProjectStatuses.normalized);
  if (normalizationSummary) notices.push(normalizationSummary);

  if (artifact?.migrationReadiness?.parseErrorCount > 0) {
    notices.push(buildNotice("error", "local_data_unreadable", "Local export artifact contains unreadable JSON data."));
  }

  if (notices.some((notice) => notice.level === "error")) {
    return {
      ok: false,
      blocked: true,
      reason: "Migration write blocked by local validation issues.",
      notices,
      integrity,
      tableResults,
      noLocalDeletes: true,
    };
  }

  const cloudCounts = await readCloudCounts(client, companyId);
  const localCounts = preview?.localCounts || {};

  let customerIdByLegacyId = new Map();
  let shouldWriteCustomers = true;

  if (isCustomersOnlyPartialState(localCounts, cloudCounts)) {
    const existingCustomers = await readExistingCustomers(client, companyId);
    const existingLegacyIds = new Set(existingCustomers.map((row) => asText(row?.legacy_local_id)).filter(Boolean));
    const localLegacyIds = new Set(
      (Array.isArray(draft?.customers) ? draft.customers : [])
        .map((customer) => asText(customer?.legacy_local_id))
        .filter(Boolean)
    );

    if (!setsEqual(existingLegacyIds, localLegacyIds)) {
      return {
        ok: false,
        blocked: true,
        reason: "Partial customer migration exists but the cloud customer legacy ids do not match local customers.",
        notices: [
          buildNotice(
            "error",
            "partial_customer_mismatch",
            "Partial customer migration exists but the cloud customer legacy ids do not match local customers.",
            { cloudCounts }
          ),
        ],
        cloudCountsBefore: cloudCounts,
        tableResults,
        noLocalDeletes: true,
      };
    }

    customerIdByLegacyId = buildLegacyIdMap(existingCustomers);
    shouldWriteCustomers = false;
    tableResults[0] = {
      ...tableResults[0],
      status: "reused",
      reused: existingCustomers.length,
      skipped: existingCustomers.length,
    };
    notices.push(buildNotice(
      "info",
      "existing_customers_reused",
      "Existing cloud customers were reused from the partial migration state.",
      { reused: existingCustomers.length }
    ));
  } else {
    const occupiedTables = Object.entries(cloudCounts).filter(([, count]) => Number(count) > 0);
    if (occupiedTables.length > 0) {
      const resumeIssues = await collectExistingCloudResumeIssues(client, companyId, draft);
      if (resumeIssues.length === 0) {
        notices.push(buildNotice(
          "info",
          "core_tables_upsert_safe_resume",
          "Cloud backup resumed safely against existing workspace rows."
        ));
      } else {
      return {
        ok: false,
        blocked: true,
        reason: "Cloud business tables contain rows that are not present on this device. Backup is blocked without an override path.",
        notices: resumeIssues,
        cloudCountsBefore: cloudCounts,
        tableResults,
        noLocalDeletes: true,
      };
      }
    }
  }

  if (shouldWriteCustomers) {
    const customerPayloads = mapCustomerPayloads(draft, userId);
    const customerResponse = await upsertTableRows(client, "customers", customerPayloads);
    if (customerResponse?.error) {
      tableResults[0] = { ...tableResults[0], status: "failed", failed: customerPayloads.length, error: asText(customerResponse.error?.message) };
      return {
        ok: false,
        blocked: false,
        reason: asText(customerResponse.error?.message) || "Customer migration failed.",
        notices: [buildNotice("error", "customers_write_failed", asText(customerResponse.error?.message) || "Customer migration failed.")],
        cloudCountsBefore: cloudCounts,
        tableResults,
        noLocalDeletes: true,
      };
    }
    tableResults[0] = { ...tableResults[0], status: "success", written: customerPayloads.length };
    customerIdByLegacyId = buildLegacyIdMap(customerResponse?.data);
  }

  const projectPayloads = mapProjectPayloads(draft, customerIdByLegacyId, userId, localSnapshot);
  const projectResponse = await upsertTableRows(client, "projects", projectPayloads);
  if (projectResponse?.error) {
    tableResults[1] = { ...tableResults[1], status: "failed", failed: projectPayloads.length, error: asText(projectResponse.error?.message) };
    return {
      ok: false,
      blocked: false,
      reason: asText(projectResponse.error?.message) || "Project migration failed.",
      notices: [buildNotice("error", "projects_write_failed", asText(projectResponse.error?.message) || "Project migration failed.")],
      cloudCountsBefore: cloudCounts,
      tableResults,
      noLocalDeletes: true,
    };
  }
  tableResults[1] = { ...tableResults[1], status: "success", written: projectPayloads.length };
  const projectIdByLegacyId = buildLegacyIdMap(projectResponse?.data);

  const estimatePayloads = mapEstimatePayloads(draft, customerIdByLegacyId, projectIdByLegacyId, userId);
  const estimateResponse = await upsertTableRows(client, "estimates", estimatePayloads);
  if (estimateResponse?.error) {
    tableResults[2] = { ...tableResults[2], status: "failed", failed: estimatePayloads.length, error: asText(estimateResponse.error?.message) };
    return {
      ok: false,
      blocked: false,
      reason: asText(estimateResponse.error?.message) || "Estimate migration failed.",
      notices: [buildNotice("error", "estimates_write_failed", asText(estimateResponse.error?.message) || "Estimate migration failed.")],
      cloudCountsBefore: cloudCounts,
      tableResults,
      noLocalDeletes: true,
    };
  }
  tableResults[2] = { ...tableResults[2], status: "success", written: estimatePayloads.length };
  const estimateIdByLegacyId = buildLegacyIdMap(estimateResponse?.data);

  const invoicePayloads = mapInvoicePayloads(draft, customerIdByLegacyId, projectIdByLegacyId, estimateIdByLegacyId, userId);
  const invoiceResponse = await upsertTableRows(client, "invoices", invoicePayloads);
  if (invoiceResponse?.error) {
    tableResults[4] = { ...tableResults[4], status: "failed", failed: invoicePayloads.length, error: asText(invoiceResponse.error?.message) };
    return {
      ok: false,
      blocked: false,
      reason: asText(invoiceResponse.error?.message) || "Invoice migration failed.",
      notices: [buildNotice("error", "invoices_write_failed", asText(invoiceResponse.error?.message) || "Invoice migration failed.")],
      cloudCountsBefore: cloudCounts,
      tableResults,
      noLocalDeletes: true,
    };
  }
  tableResults[4] = { ...tableResults[4], status: "success", written: invoicePayloads.length };
  const invoiceIdByLegacyId = buildLegacyIdMap(invoiceResponse?.data);

  const estimateLineItemPayloads = mapEstimateLineItemPayloads(draft, estimateIdByLegacyId);
  const invoiceLineItemPayloads = mapInvoiceLineItemPayloads(draft, invoiceIdByLegacyId);
  const lineItemIssues = [...estimateLineItemPayloads.issues, ...invoiceLineItemPayloads.issues];
  notices.push(...lineItemIssues);
  if (lineItemIssues.some((notice) => notice.level === "error")) {
    return {
      ok: false,
      blocked: true,
      reason: "Line-item migration write blocked by local validation issues.",
      notices,
      cloudCountsBefore: cloudCounts,
      tableResults,
      noLocalDeletes: true,
    };
  }

  const existingEstimateLineItems = await readExistingRows(client, "estimate_line_items", companyId);
  const estimateLineItemSync = await migrateLineItemTable({
    client,
    table: "estimate_line_items",
    baseResult: tableResults[3],
    payloads: estimateLineItemPayloads.payloads,
    existingRows: existingEstimateLineItems,
  });
  tableResults[3] = estimateLineItemSync.result;
  if (estimateLineItemSync.response?.error) {
    return {
      ok: false,
      blocked: false,
      reason: asText(estimateLineItemSync.response.error?.message) || "Estimate line-item migration failed.",
      notices: [buildNotice("error", "estimate_line_items_write_failed", asText(estimateLineItemSync.response.error?.message) || "Estimate line-item migration failed.")],
      cloudCountsBefore: cloudCounts,
      tableResults,
      noLocalDeletes: true,
    };
  }

  const existingInvoiceLineItems = await readExistingRows(client, "invoice_line_items", companyId);
  const invoiceLineItemSync = await migrateLineItemTable({
    client,
    table: "invoice_line_items",
    baseResult: tableResults[5],
    payloads: invoiceLineItemPayloads.payloads,
    existingRows: existingInvoiceLineItems,
  });
  tableResults[5] = invoiceLineItemSync.result;
  if (invoiceLineItemSync.response?.error) {
    return {
      ok: false,
      blocked: false,
      reason: asText(invoiceLineItemSync.response.error?.message) || "Invoice line-item migration failed.",
      notices: [buildNotice("error", "invoice_line_items_write_failed", asText(invoiceLineItemSync.response.error?.message) || "Invoice line-item migration failed.")],
      cloudCountsBefore: cloudCounts,
      tableResults,
      noLocalDeletes: true,
    };
  }

  const paymentPayloads = mapInvoicePaymentPayloads(draft, invoiceIdByLegacyId, userId);
  const paymentResponse = await upsertTableRows(client, "invoice_payments", paymentPayloads);
  if (paymentResponse?.error) {
    tableResults[6] = { ...tableResults[6], status: "failed", failed: paymentPayloads.length, error: asText(paymentResponse.error?.message) };
    return {
      ok: false,
      blocked: false,
      reason: asText(paymentResponse.error?.message) || "Invoice payment migration failed.",
      notices: [buildNotice("error", "invoice_payments_write_failed", asText(paymentResponse.error?.message) || "Invoice payment migration failed.")],
      cloudCountsBefore: cloudCounts,
      tableResults,
      noLocalDeletes: true,
    };
  }
  tableResults[6] = { ...tableResults[6], status: "success", written: paymentPayloads.length };

  return {
    ok: true,
    blocked: false,
    writerVersion: SUPABASE_MIGRATION_WRITER_VERSION,
    companyId,
    noLocalDeletes: true,
    cloudCountsBefore: cloudCounts,
    integrity,
    repairSummary: repairedLocalData.repairs,
    notices: [
      buildNotice("info", "prevalidation_complete", "Prevalidation completed before any migration writes started."),
      ...notices,
    ],
    tableResults,
  };
}

export default runSupabaseMigrationWrite;
