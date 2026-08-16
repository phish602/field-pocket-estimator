import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { getSupabaseClient } from "./supabaseClient";
import { mapLocalSnapshotToBackendDraft, mapLocalEstimateToBackendEstimate } from "../utils/backendDataMapper";
import { buildPersistedEstimateContract } from "./supabaseEstimatePersistenceContract";
import { buildEstimateRestorePayload, ESTIMATE_RESTORE_PAYLOAD_VERSION } from "./supabaseEstimateRestorePayload";
import { readCloudPartialRecoveryStatus } from "./cloudPartialRecoveryStatus";
import { readCloudAssetBindings } from "./cloudAssetBindings";
import {
  buildParentLineItemContract,
  sanitizeLineItemParentSegment,
  parseInvoiceChildLegacyId,
} from "./cloudLineItemContract";
import { isProvenEmptyInvoiceLineItemPlaceholder } from "./staleInvoiceLineItemProof";

// Repair class this verifier can prove: obsolete blank invoice children left in
// the cloud by an older writer that persisted the estimator's empty placeholder
// rows. The corrected mapper no longer emits them, so they are extra in the
// cloud and carry no business content.
export const STALE_INVOICE_LINE_ITEM_PLACEHOLDER_REPAIR = "stale_invoice_line_item_empty_placeholders";

export const SUPABASE_CLOUD_VERIFICATION_VERSION = "supabase-cloud-verification-v2";

// These tables carry a direct local legacy_local_id, so local vs cloud rows
// can be diffed 1:1 by id, not just by count.
const ID_COMPARABLE_TABLES = [
  ["customers", "customers", "id, legacy_local_id, display_name, company_name, contact_name, phone, email, billing_address, customer_type, customer_status"],
  ["projects", "projects", "id, legacy_local_id, customer_id, project_number, project_name, site_address, status, notes, scope_summary"],
  ["estimates", "estimates", "id, legacy_local_id, customer_id, project_id, estimate_number, status, total_amount, notes, terms, converted_invoice_legacy_id, restore_payload, restore_payload_version"],
  ["invoices", "invoices", "id, legacy_local_id, customer_id, project_id, estimate_id, source_estimate_legacy_id, invoice_number, estimate_number, status, payment_status, invoice_date, due_date, total_amount, amount_paid, balance_remaining, notes, terms"],
  ["invoice_payments", "invoicePayments", "id, legacy_local_id, invoice_id, amount, method, status, paid_at"],
];

const CHILD_TABLES = [
  ["estimate_line_items", "estimateLineItems", "estimates", "estimate_id", "estimates", true],
  ["invoice_line_items", "invoiceLineItems", "invoices", "invoice_id", "invoices", false],
];

function asText(value) {
  return String(value || "").trim();
}

function buildNotice(level, code, message, details = {}) {
  return { level, code, message, details };
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

function countLineItems(draft) {
  const estimateLineItems = (Array.isArray(draft?.estimates) ? draft.estimates : []).reduce((sum, estimate) => {
    return sum + (Array.isArray(estimate?.line_items) ? estimate.line_items.length : 0);
  }, 0);
  const invoiceLineItems = (Array.isArray(draft?.invoices) ? draft.invoices : []).reduce((sum, invoice) => {
    return sum + (Array.isArray(invoice?.line_items) ? invoice.line_items.length : 0);
  }, 0);
  return { estimateLineItems, invoiceLineItems };
}

function buildLegacyIdSet(rows) {
  return new Set(
    (Array.isArray(rows) ? rows : [])
      .map((row) => asText(row?.legacy_local_id))
      .filter(Boolean)
  );
}

function normalizeLegacyIds(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => asText(value))
      .filter(Boolean)
  )].sort();
}

function normalizedChildValue(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "object" && Number.isFinite(Number(value))) return Number(value);
  if (Array.isArray(value)) return value.map(normalizedChildValue);
  if (typeof value === "object") return Object.keys(value).sort().reduce((out, key) => ({ ...out, [key]: normalizedChildValue(value[key]) }), {});
  return value;
}

function normalizedText(value) {
  const text = asText(value);
  return text || null;
}

function normalizedMoney(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

function normalizedDate(value) {
  const text = asText(value);
  if (!text) return null;
  const dateOnly = text.match(/^(\d{4}-\d{2}-\d{2})(?:$|T)/);
  if (dateOnly) return dateOnly[1];
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString().slice(0, 10) : text;
}

function normalizedJson(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.map(normalizedJson);
  if (typeof value === "object") {
    return Object.keys(value).sort().reduce((out, key) => ({ ...out, [key]: normalizedJson(value[key]) }), {});
  }
  return value;
}

function sameNormalizedValue(expected, actual, kind) {
  const normalize = kind === "money"
    ? normalizedMoney
    : kind === "date"
      ? normalizedDate
      : kind === "json"
        ? normalizedJson
        : normalizedText;
  return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(actual));
}

function compareSemanticContract(expected, cloud, fields) {
  return fields
    .filter(([field, kind = "text"]) => !sameNormalizedValue(expected?.[field], cloud?.[field], kind))
    .map(([field]) => field);
}

function cloudIdByLegacyId(rows) {
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [asText(row?.legacy_local_id), asText(row?.id)]));
}

function buildCustomerContract(customer) {
  return {
    display_name: customer?.display_name || null,
    company_name: customer?.company_name || null,
    contact_name: customer?.contact_name || null,
    phone: customer?.phone || null,
    email: customer?.email || null,
    billing_address: customer?.billing_address || customer?.address || null,
    customer_type: customer?.customer_type || null,
    customer_status: customer?.status || null,
  };
}

function buildProjectContract(project, customerIds) {
  return {
    customer_id: customerIds.get(asText(project?.customer_legacy_local_id)) || null,
    project_number: project?.project_number || null,
    project_name: project?.project_name || null,
    site_address: project?.site_address || null,
    status: project?.status || "draft",
    notes: project?.notes || null,
    scope_summary: project?.scope_summary || null,
  };
}

function buildEstimateContract(estimate, customerIds, projectIds, localEstimatesByLegacyId) {
  const persisted = buildPersistedEstimateContract(estimate);
  const sourceEstimate = localEstimatesByLegacyId.get(asText(persisted.legacy_local_id));
  return {
    customer_id: customerIds.get(asText(persisted.customer_legacy_local_id)) || null,
    project_id: projectIds.get(asText(persisted.project_legacy_local_id)) || null,
    estimate_number: persisted.estimate_number,
    status: persisted.status,
    total_amount: persisted.total_amount,
    notes: persisted.notes,
    terms: persisted.terms,
    converted_invoice_legacy_id: persisted.converted_invoice_legacy_local_id,
    restore_payload: sourceEstimate ? buildEstimateRestorePayload(sourceEstimate) : null,
    restore_payload_version: sourceEstimate ? ESTIMATE_RESTORE_PAYLOAD_VERSION : null,
  };
}

function buildInvoiceContract(invoice, customerIds, projectIds, estimateIds, localEstimatesByLegacyId, cloudEstimateNumber = "") {
  const sourceEstimateLegacyId = asText(invoice?.source_estimate_legacy_id || invoice?.source_estimate_legacy_local_id);
  const linkedEstimate = localEstimatesByLegacyId.get(sourceEstimateLegacyId);
  const linkedEstimateNumber = linkedEstimate
    ? buildPersistedEstimateContract(mapLocalEstimateToBackendEstimate(linkedEstimate, {})).estimate_number
    : null;
  const derivedLegacyEstimateNumber = asText(cloudEstimateNumber) && linkedEstimateNumber === asText(cloudEstimateNumber)
    ? linkedEstimateNumber
    : null;
  return {
    customer_id: customerIds.get(asText(invoice?.customer_legacy_local_id)) || null,
    project_id: projectIds.get(asText(invoice?.project_legacy_local_id)) || null,
    estimate_id: estimateIds.get(sourceEstimateLegacyId) || null,
    source_estimate_legacy_id: sourceEstimateLegacyId || null,
    invoice_number: invoice?.invoice_number || null,
    // Older local invoices can legitimately predate the persisted
    // estimateNumber field. Their linked local estimate is the canonical source
    // for this denormalized cloud column, so derive it before declaring a
    // business-state mismatch.
    estimate_number: invoice?.estimate_number || derivedLegacyEstimateNumber || null,
    status: invoice?.status || "draft",
    payment_status: invoice?.payment_status || "unpaid",
    invoice_date: invoice?.invoice_date || null,
    due_date: invoice?.due_date || null,
    total_amount: invoice?.total ?? null,
    amount_paid: invoice?.amount_paid ?? 0,
    balance_remaining: invoice?.balance_remaining ?? null,
    notes: invoice?.notes || null,
    terms: invoice?.terms || null,
  };
}

function buildInvoicePaymentContract(payment, invoiceIds) {
  return {
    invoice_id: invoiceIds.get(asText(payment?.invoice_legacy_local_id)) || null,
    amount: payment?.amount ?? null,
    method: payment?.method || null,
    status: payment?.status || null,
    paid_at: payment?.paid_at || null,
  };
}

const SEMANTIC_FIELDS = {
  customers: [["display_name"], ["company_name"], ["contact_name"], ["phone"], ["email"], ["billing_address"], ["customer_type"], ["customer_status"]],
  projects: [["customer_id"], ["project_number"], ["project_name"], ["site_address"], ["status"], ["notes"], ["scope_summary"]],
  estimates: [["customer_id"], ["project_id"], ["estimate_number"], ["status"], ["total_amount", "money"], ["notes"], ["terms"], ["converted_invoice_legacy_id"], ["restore_payload", "json"], ["restore_payload_version"]],
  invoices: [["customer_id"], ["project_id"], ["estimate_id"], ["source_estimate_legacy_id"], ["invoice_number"], ["estimate_number"], ["status"], ["payment_status"], ["invoice_date", "date"], ["due_date", "date"], ["total_amount", "money"], ["amount_paid", "money"], ["balance_remaining", "money"], ["notes"], ["terms"]],
  invoice_payments: [["invoice_id"], ["amount", "money"], ["method"], ["status"], ["paid_at", "date"]],
};

function sameChildContract(expected, cloud, { parentColumn, includeLineRole }) {
  const fields = [parentColumn, "sort_order", "description", "quantity", "unit", "unit_price", "total_price", "metadata"];
  if (includeLineRole) fields.push("line_role");
  return JSON.stringify(fields.map((field) => normalizedChildValue(expected?.[field])))
    === JSON.stringify(fields.map((field) => normalizedChildValue(cloud?.[field])));
}

// Expected cloud child rows are built from the SHARED line-item contract, so the
// verifier's identity + metadata match exactly what the migration writer
// persisted (sanitized parent segment, whole-parent stable index, and
// metadata.unit_cost / metadata.kind). prefix is the entity type ("estimate" |
// "invoice"). Cross-parent id collisions (e.g. two parents sanitizing to the
// same segment) are still surfaced as duplicates.
function expectedChildren(draft, parentKey, parentCloudRows, parentColumn, prefix, includeLineRole) {
  const parentCloudId = new Map((Array.isArray(parentCloudRows) ? parentCloudRows : []).map((row) => [asText(row?.legacy_local_id), asText(row?.id)]));
  const out = []; const duplicateIds = [];
  (Array.isArray(draft?.[parentKey]) ? draft[parentKey] : []).forEach((parent) => {
    const parentLegacyId = asText(parent?.legacy_local_id);
    const contract = buildParentLineItemContract({
      entityType: prefix,
      parentLegacyId,
      parentCloudId: parentCloudId.get(parentLegacyId) || "",
      parentColumn,
      items: parent?.line_items,
    });
    contract.rows.forEach((row) => {
      if (out.some((existing) => existing.legacy_local_id === row.legacy_local_id)) duplicateIds.push(row.legacy_local_id);
      out.push(row);
    });
    duplicateIds.push(...contract.duplicateIds);
  });
  return { rows: out, duplicateIds };
}

function hasValidEstimateRestorePayload(row) {
  return Boolean(
    row?.restore_payload &&
    typeof row.restore_payload === "object" &&
    !Array.isArray(row.restore_payload) &&
    asText(row?.restore_payload_version)
  );
}

function buildExpectedSemanticContract(table, localRow, draft, cloudRowsByTable, localSnapshot, cloudRow = null) {
  const customerIds = cloudIdByLegacyId(cloudRowsByTable.customers);
  const projectIds = cloudIdByLegacyId(cloudRowsByTable.projects);
  const estimateIds = cloudIdByLegacyId(cloudRowsByTable.estimates);
  const invoiceIds = cloudIdByLegacyId(cloudRowsByTable.invoices);
  const localEstimatesByLegacyId = new Map(
    (Array.isArray(localSnapshot?.estimates) ? localSnapshot.estimates : [])
      .map((estimate) => [asText(estimate?.id), estimate])
      .filter(([legacyId]) => Boolean(legacyId))
  );

  if (table === "customers") return buildCustomerContract(localRow);
  if (table === "projects") return buildProjectContract(localRow, customerIds);
  if (table === "estimates") return buildEstimateContract(localRow, customerIds, projectIds, localEstimatesByLegacyId);
  if (table === "invoices") return buildInvoiceContract(localRow, customerIds, projectIds, estimateIds, localEstimatesByLegacyId, cloudRow?.estimate_number);
  if (table === "invoice_payments") return buildInvoicePaymentContract(localRow, invoiceIds);
  return {};
}

function diffIdSets(localIds, cloudIds) {
  const missing = [...localIds].filter((id) => !cloudIds.has(id)).sort();
  const extra = [...cloudIds].filter((id) => !localIds.has(id)).sort();
  return { missing, extra };
}

async function readCloudRows(client, table, companyId, columns = "id, legacy_local_id") {
  try {
    const response = await client
      .from(table)
      .select(columns)
      .eq("company_id", companyId);

    if (response?.error) {
      return { rows: null, error: response.error };
    }
    return { rows: Array.isArray(response?.data) ? response.data : [], error: null };
  } catch (error) {
    return { rows: null, error };
  }
}

function buildUnavailableTableResult(table, localCount, error) {
  return {
    table,
    localCount,
    cloudCount: null,
    status: "unavailable",
    missingLegacyIds: [],
    extraLegacyIds: [],
    countOnly: false,
    error: asText(error?.message) || "Unable to read cloud rows.",
  };
}

function findResult(tableResults, table) {
  return tableResults.find((result) => result.table === table) || null;
}

// READ-ONLY classification of the cloud-only invoice children. A row is a proven
// repair candidate only when it is attached to a CURRENT invoice, deterministically
// identified under that invoice's own canonical parent segment, and carries no
// business content at all (see staleInvoiceLineItemProof). Anything else -- an
// unknown parent, an unparsable id, an ambiguous parent, or any real content --
// stays unresolved and keeps the mismatch un-repairable.
function classifyExtraInvoiceLineItems(extraRows, parentCloudRows, localParentLegacyIds) {
  const parentLegacyByCloudId = new Map(); const ambiguousCloudIds = new Set();
  (Array.isArray(parentCloudRows) ? parentCloudRows : []).forEach((row) => {
    const cloudId = asText(row?.id); const legacyId = asText(row?.legacy_local_id);
    if (!cloudId || !legacyId) return;
    if (parentLegacyByCloudId.has(cloudId) && parentLegacyByCloudId.get(cloudId) !== legacyId) ambiguousCloudIds.add(cloudId);
    else parentLegacyByCloudId.set(cloudId, legacyId);
  });

  const repairable = []; const unresolved = [];
  (Array.isArray(extraRows) ? extraRows : []).forEach((row) => {
    const rowId = asText(row?.id);
    const legacyId = asText(row?.legacy_local_id);
    const parsed = parseInvoiceChildLegacyId(legacyId);
    const cloudParentId = asText(row?.invoice_id);
    const parentLegacyId = ambiguousCloudIds.has(cloudParentId) ? "" : asText(parentLegacyByCloudId.get(cloudParentId));
    if (
      rowId
      && parsed
      && parentLegacyId
      && localParentLegacyIds.has(parentLegacyId)
      && parsed.parentSegment === sanitizeLineItemParentSegment(parentLegacyId)
      && isProvenEmptyInvoiceLineItemPlaceholder(row)
    ) {
      repairable.push({ rowId, legacyId });
      return;
    }
    unresolved.push(legacyId || "missing");
  });
  return { repairable, unresolved };
}

function buildBindingDiagnostics(companyId, draft, cloudRowsByTable) {
  const state = readCloudAssetBindings(companyId);
  const entityConfig = [
    ["customer", "customers", "customers"], ["project", "projects", "projects"],
    ["estimate", "estimates", "estimates"], ["invoice", "invoices", "invoices"],
    ["invoice_payment", "invoicePayments", "invoice_payments"],
  ];
  const out = { boundRecordsChecked: 0, bindingsConfirmed: 0, bindingsMissingCloudRow: 0, bindingConflicts: 0, unboundLocalRecords: 0, unboundCloudRecords: 0 };
  entityConfig.forEach(([entity, draftKey, table]) => {
    const bindings = state.bindings?.[entity] || {};
    const local = new Map((Array.isArray(draft?.[draftKey]) ? draft[draftKey] : []).map((row) => [asText(row?.legacy_local_id), row]));
    const cloud = Array.isArray(cloudRowsByTable[table]) ? cloudRowsByTable[table] : [];
    const byUuid = new Map(cloud.map((row) => [asText(row?.id), row]));
    const boundUuids = new Set();
    Object.keys(bindings).forEach((legacyId) => {
      out.boundRecordsChecked += 1;
      const binding = bindings[legacyId];
      const row = byUuid.get(asText(binding?.cloudUuid));
      if (!row) { out.bindingsMissingCloudRow += 1; return; }
      boundUuids.add(asText(binding?.cloudUuid));
      if (!local.has(legacyId) || asText(row?.legacy_local_id) !== legacyId) out.bindingConflicts += 1;
      else out.bindingsConfirmed += 1;
    });
    local.forEach((_, legacyId) => { if (!bindings[legacyId]) out.unboundLocalRecords += 1; });
    cloud.forEach((row) => { if (!boundUuids.has(asText(row?.id))) out.unboundCloudRecords += 1; });
  });
  return out;
}

// Cheap, read-only sanity check using counts already fetched above: flags an
// orphaned-looking child table (rows present in cloud) whose parent table has
// zero cloud rows for this company. No extra Supabase calls are made.
function collectRelationshipNotices(tableResults) {
  const notices = [];
  const checks = [
    ["invoice_payments", "invoices", "invoice_payments_orphaned", "Invoice payments exist in the cloud with no matching cloud invoices."],
    ["estimate_line_items", "estimates", "estimate_line_items_orphaned", "Estimate line items exist in the cloud with no matching cloud estimates."],
    ["invoice_line_items", "invoices", "invoice_line_items_orphaned", "Invoice line items exist in the cloud with no matching cloud invoices."],
  ];

  checks.forEach(([childTable, parentTable, code, message]) => {
    const child = findResult(tableResults, childTable);
    const parent = findResult(tableResults, parentTable);
    if (!child || !parent) return;
    if (Number(child.cloudCount || 0) > 0 && Number(parent.cloudCount || 0) === 0) {
      notices.push(buildNotice("warning", code, message));
    }
  });

  return notices;
}

export async function runSupabaseCloudVerification({
  storageSnapshot,
  configured = false,
  user = null,
  company = null,
  preservedSkippedEstimateLegacyIds = null,
} = {}) {
  const notices = [];
  const userId = asText(user?.id);
  const companyId = asText(company?.id);
  const companyName = asText(company?.name);
  const client = getSupabaseClient();

  const validations = {
    supabaseConfigured: Boolean(configured),
    signedIn: Boolean(userId),
    hasCompany: Boolean(companyId),
  };

  if (!configured || !client?.from) {
    notices.push(buildNotice("error", "supabase_not_configured", "Supabase is not configured."));
  }
  if (!userId) {
    notices.push(buildNotice("error", "not_signed_in", "No signed-in Supabase user found."));
  }
  if (!companyId) {
    notices.push(buildNotice("error", "company_missing", "No cloud workspace is linked to this account yet."));
  }

  if (notices.some((notice) => notice.level === "error")) {
    return {
      verificationVersion: SUPABASE_CLOUD_VERIFICATION_VERSION,
      generatedAt: new Date().toISOString(),
      ok: false,
      company: { id: companyId, name: companyName },
      validations,
      localCounts: null,
      tableResults: [],
      allMatched: false,
      notices,
      noWritesPerformed: true,
    };
  }

  const artifact = buildLocalStorageExportArtifact(storageSnapshot);
  const localSnapshot = buildLocalSnapshotFromArtifact(artifact);
  const draft = mapLocalSnapshotToBackendDraft(localSnapshot, { companyId, userId });
  const lineItemCounts = countLineItems(draft);
  const storedRecoveryStatus = readCloudPartialRecoveryStatus(storageSnapshot);
  const preservedSkippedIds = normalizeLegacyIds(
    Array.isArray(preservedSkippedEstimateLegacyIds) && preservedSkippedEstimateLegacyIds.length > 0
      ? preservedSkippedEstimateLegacyIds
      : storedRecoveryStatus?.skippedEstimateIds
  );
  const preservedSkippedIdSet = new Set(preservedSkippedIds);

  const localCounts = {
    customers: draft.customers.length,
    projects: draft.projects.length,
    estimates: draft.estimates.length,
    invoices: draft.invoices.length,
    invoicePayments: draft.invoicePayments.length,
    estimateLineItems: lineItemCounts.estimateLineItems,
    invoiceLineItems: lineItemCounts.invoiceLineItems,
  };

  const tableResults = [];
  const cloudRowsByTable = {};
  const availableRepairs = [];
  let invoiceLineItemRepairableOnly = false;
  let preservedSkippedCloudEstimateRowIds = new Set();
  let preservedOlderEstimatesMatched = false;

  for (const [table, key, columns] of ID_COMPARABLE_TABLES) {
    const { rows, error } = await readCloudRows(client, table, companyId, columns);
    if (error) {
      tableResults.push(buildUnavailableTableResult(table, localCounts[key], error));
      notices.push(buildNotice("error", `${table}_read_failed`, `Unable to read ${table} from Supabase.`));
      continue;
    }
    cloudRowsByTable[table] = rows;

    const localIds = buildLegacyIdSet(draft[key]);
    const cloudIds = buildLegacyIdSet(rows);
    const { missing, extra } = diffIdSets(localIds, cloudIds);
    const missingRestorePayloadLegacyIds = table === "estimates"
      ? (Array.isArray(rows) ? rows : [])
        .filter((row) => localIds.has(asText(row?.legacy_local_id)) && !hasValidEstimateRestorePayload(row))
        .map((row) => asText(row?.legacy_local_id))
        .filter(Boolean)
        .sort()
      : [];
    const oldDeviceRequiredMissingRestorePayloadLegacyIds = table === "estimates"
      ? (Array.isArray(rows) ? rows : [])
        .filter((row) => {
          const legacyLocalId = asText(row?.legacy_local_id);
          return legacyLocalId
            && !localIds.has(legacyLocalId)
            && !preservedSkippedIdSet.has(legacyLocalId)
            && !hasValidEstimateRestorePayload(row);
        })
        .map((row) => asText(row?.legacy_local_id))
        .filter(Boolean)
        .sort()
      : [];
    const preservedMissingRestorePayloadLegacyIds = table === "estimates"
      ? (Array.isArray(rows) ? rows : [])
        .filter((row) => {
          const legacyLocalId = asText(row?.legacy_local_id);
          return legacyLocalId
            && !localIds.has(legacyLocalId)
            && preservedSkippedIdSet.has(legacyLocalId)
            && !hasValidEstimateRestorePayload(row);
        })
        .map((row) => asText(row?.legacy_local_id))
        .filter(Boolean)
        .sort()
      : [];
    const preservedOlderEstimateSetMatched = table === "estimates"
      && preservedSkippedIdSet.size > 0
      && missing.length === 0
      && missingRestorePayloadLegacyIds.length === 0
      && extra.length === preservedSkippedIdSet.size
      && extra.every((legacyId) => preservedSkippedIdSet.has(legacyId));
    if (preservedOlderEstimateSetMatched) {
      preservedOlderEstimatesMatched = true;
      preservedSkippedCloudEstimateRowIds = new Set(
        rows
          .filter((row) => preservedSkippedIdSet.has(asText(row?.legacy_local_id)))
          .map((row) => asText(row?.id))
          .filter(Boolean)
      );
    }
    const cloudByLegacyId = new Map((Array.isArray(rows) ? rows : []).map((row) => [asText(row?.legacy_local_id), row]));
    const semanticMismatchLegacyIds = [];
    const semanticMismatchFields = new Set();
    (Array.isArray(draft?.[key]) ? draft[key] : []).forEach((localRow) => {
      const legacyLocalId = asText(localRow?.legacy_local_id);
      const cloudRow = cloudByLegacyId.get(legacyLocalId);
      if (!legacyLocalId || !cloudRow) return;
      const expected = buildExpectedSemanticContract(table, localRow, draft, cloudRowsByTable, localSnapshot, cloudRow);
      const mismatchedFields = compareSemanticContract(expected, cloudRow, SEMANTIC_FIELDS[table] || []);
      if (mismatchedFields.length === 0) return;
      semanticMismatchLegacyIds.push(legacyLocalId);
      mismatchedFields.forEach((field) => semanticMismatchFields.add(field));
    });
    const matched = (
      localCounts[key] === rows.length
      && missing.length === 0
      && extra.length === 0
      && missingRestorePayloadLegacyIds.length === 0
      && semanticMismatchLegacyIds.length === 0
    ) || (preservedOlderEstimateSetMatched && semanticMismatchLegacyIds.length === 0);

    tableResults.push({
      table,
      localCount: localCounts[key],
      cloudCount: rows.length,
      status: matched ? "matched" : "mismatch",
      missingLegacyIds: missing,
      extraLegacyIds: extra,
      missingRestorePayloadLegacyIds,
      oldDeviceRequiredMissingRestorePayloadLegacyIds,
      preservedMissingRestorePayloadLegacyIds,
      semanticMismatchLegacyIds: semanticMismatchLegacyIds.sort(),
      semanticMismatchCount: semanticMismatchLegacyIds.length,
      semanticMismatchFields: [...semanticMismatchFields].sort().slice(0, 24),
      countOnly: false,
      preservedExtraLegacyIds: preservedOlderEstimateSetMatched ? extra : [],
    });

    if (table === "estimates" && missingRestorePayloadLegacyIds.length > 0) {
      notices.push(buildNotice(
        "warning",
        "estimates_restore_payload_missing",
        "Cloud estimates are present but missing restore payloads needed for safe cross-device restore.",
        { missingLegacyIds: missingRestorePayloadLegacyIds }
      ));
    }
    if (table === "estimates" && oldDeviceRequiredMissingRestorePayloadLegacyIds.length > 0) {
      notices.push(buildNotice(
        "warning",
        "estimates_backup_protection_old_device_required",
        "Some older estimates need the original device to finish backup protection.",
        { missingLegacyIds: oldDeviceRequiredMissingRestorePayloadLegacyIds }
      ));
    }
  }

  for (const [table, key, parentTable, parentColumn, parentKey, includeLineRole] of CHILD_TABLES) {
    const columns = `id, legacy_local_id, ${parentColumn}, sort_order, description, quantity, unit, unit_price, total_price, metadata${includeLineRole ? ", line_role" : ""}`;
    const { rows, error } = await readCloudRows(client, table, companyId, columns);
    if (error) {
      tableResults.push(buildUnavailableTableResult(table, localCounts[key], error));
      notices.push(buildNotice("error", `${table}_read_failed`, `Unable to read ${table} from Supabase.`));
      continue;
    }

    const preservedEstimateLineItemsMatched = table === "estimate_line_items"
      && preservedOlderEstimatesMatched
      && preservedSkippedCloudEstimateRowIds.size > 0
      && Number(rows.length) >= Number(localCounts[key])
      && (Array.isArray(rows) ? rows : []).filter((row) => preservedSkippedCloudEstimateRowIds.has(asText(row?.estimate_id))).length
        === Number(rows.length) - Number(localCounts[key]);
    const comparableRows = preservedEstimateLineItemsMatched
      ? rows.filter((row) => !preservedSkippedCloudEstimateRowIds.has(asText(row?.[parentColumn])))
      : rows;
    const expected = expectedChildren(draft, parentKey, cloudRowsByTable[parentTable], parentColumn, parentKey === "estimates" ? "estimate" : "invoice", includeLineRole);
    const cloudByLegacyId = new Map();
    const duplicateCloudIds = [];
    comparableRows.forEach((row) => {
      const legacyId = asText(row?.legacy_local_id);
      if (!legacyId || cloudByLegacyId.has(legacyId)) duplicateCloudIds.push(legacyId || "missing");
      else cloudByLegacyId.set(legacyId, row);
    });
    const expectedByLegacyId = new Map(expected.rows.map((row) => [row.legacy_local_id, row]));
    const missing = expected.rows.filter((row) => !cloudByLegacyId.has(row.legacy_local_id)).map((row) => row.legacy_local_id).sort();
    const extraRows = comparableRows.filter((row) => !expectedByLegacyId.has(asText(row?.legacy_local_id)));
    const extra = extraRows.map((row) => asText(row?.legacy_local_id)).filter(Boolean).sort();
    const extraClassification = table === "invoice_line_items"
      ? classifyExtraInvoiceLineItems(
        extraRows,
        cloudRowsByTable[parentTable],
        new Set((Array.isArray(draft?.[parentKey]) ? draft[parentKey] : []).map((parent) => asText(parent?.legacy_local_id)).filter(Boolean))
      )
      : null;
    const semanticMismatchCount = expected.rows.filter((row) => {
      const cloud = cloudByLegacyId.get(row.legacy_local_id);
      return cloud && !sameChildContract(row, cloud, { parentColumn, includeLineRole });
    }).length;
    const matched = (localCounts[key] === comparableRows.length || preservedEstimateLineItemsMatched)
      && expected.duplicateIds.length === 0 && duplicateCloudIds.length === 0 && missing.length === 0 && extra.length === 0 && semanticMismatchCount === 0;
    tableResults.push({
      table,
      localCount: localCounts[key],
      cloudCount: rows.length,
      status: matched ? "matched" : "mismatch",
      missingLegacyIds: missing,
      extraLegacyIds: extra,
      countOnly: false,
      duplicateIdentityCount: expected.duplicateIds.length + duplicateCloudIds.length,
      semanticMismatchCount,
      preservedExtraLegacyIds: preservedEstimateLineItemsMatched ? preservedSkippedIds : [],
      ...(extraClassification
        ? {
          repairableExtraCount: extraClassification.repairable.length,
          unresolvedExtraCount: extraClassification.unresolved.length,
        }
        : {}),
    });

    if (extraClassification && extraClassification.repairable.length > 0) {
      availableRepairs.push({
        type: STALE_INVOICE_LINE_ITEM_PLACEHOLDER_REPAIR,
        table,
        count: extraClassification.repairable.length,
        rowIds: extraClassification.repairable.map((entry) => entry.rowId).sort(),
        legacyIds: extraClassification.repairable.map((entry) => entry.legacyId).sort(),
      });
    }
    // A table is repairable-only when its ENTIRE mismatch is the proven blank
    // placeholder class: nothing missing, no duplicate identities, no semantic
    // drift among expected rows, and every cloud-only extra proven repairable.
    if (extraClassification) {
      invoiceLineItemRepairableOnly = !matched
        && missing.length === 0
        && expected.duplicateIds.length === 0
        && duplicateCloudIds.length === 0
        && semanticMismatchCount === 0
        && extraClassification.unresolved.length === 0
        && extraClassification.repairable.length > 0;
    }
  }

  notices.push(...collectRelationshipNotices(tableResults));
  const bindingDiagnostics = buildBindingDiagnostics(companyId, draft, cloudRowsByTable);

  const allMatched = tableResults.length > 0 && tableResults.every((result) => result.status === "matched");

  // repairableMismatchOnly is the narrow verdict the automatic recovery flow acts
  // on: EVERY other table is matched, and the only thing wrong is the proven
  // blank invoice-child class. It never means "ignore the mismatch" -- allMatched
  // stays false until the repair has actually run and verification re-passes.
  const repairableMismatchOnly = !allMatched
    && invoiceLineItemRepairableOnly
    && availableRepairs.length > 0
    && tableResults.every((result) => result.table === "invoice_line_items" || result.status === "matched");

  if (preservedOlderEstimatesMatched) {
    notices.push(buildNotice(
      "info",
      "older_estimates_kept_in_cloud",
      "Older cloud estimates were intentionally kept in cloud because they could not be fully rebuilt on this device.",
      {
        skippedEstimateCount: preservedSkippedIds.length,
        skippedEstimateLegacyIds: preservedSkippedIds,
      }
    ));
  }

  if (allMatched) {
    notices.push(buildNotice(
      "info",
      "cloud_verification_passed",
      "Cloud verification passed. Supabase data matches local migration data."
    ));
  } else {
    notices.push(buildNotice(
      "warning",
      "cloud_verification_mismatch",
      "Cloud verification found mismatches between local and Supabase data."
    ));
  }

  return {
    verificationVersion: SUPABASE_CLOUD_VERIFICATION_VERSION,
    generatedAt: new Date().toISOString(),
    ok: true,
    company: { id: companyId, name: companyName },
    validations,
    localCounts,
    tableResults,
    allMatched,
    availableRepairs,
    repairableMismatchOnly,
    notices,
    bindingDiagnostics,
    noWritesPerformed: true,
  };
}

export default runSupabaseCloudVerification;
