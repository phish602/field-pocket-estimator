import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { getSupabaseClient } from "./supabaseClient";
import { mapLocalSnapshotToBackendDraft } from "../utils/backendDataMapper";
import { readCloudPartialRecoveryStatus } from "./cloudPartialRecoveryStatus";
import { readCloudAssetBindings } from "./cloudAssetBindings";

export const SUPABASE_CLOUD_VERIFICATION_VERSION = "supabase-cloud-verification-v1";

// These tables carry a direct local legacy_local_id, so local vs cloud rows
// can be diffed 1:1 by id, not just by count.
const ID_COMPARABLE_TABLES = [
  ["customers", "customers"],
  ["projects", "projects"],
  ["estimates", "estimates"],
  ["invoices", "invoices"],
  ["invoice_payments", "invoicePayments"],
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

function sameChildContract(expected, cloud, { parentColumn, includeLineRole }) {
  const fields = [parentColumn, "sort_order", "description", "quantity", "unit", "unit_price", "total_price", "metadata"];
  if (includeLineRole) fields.push("line_role");
  return JSON.stringify(fields.map((field) => normalizedChildValue(expected?.[field])))
    === JSON.stringify(fields.map((field) => normalizedChildValue(cloud?.[field])));
}

function expectedChildren(draft, parentKey, parentCloudRows, parentColumn, prefix, includeLineRole) {
  const parentCloudId = new Map((Array.isArray(parentCloudRows) ? parentCloudRows : []).map((row) => [asText(row?.legacy_local_id), asText(row?.id)]));
  const out = []; const duplicateIds = [];
  (Array.isArray(draft?.[parentKey]) ? draft[parentKey] : []).forEach((parent) => {
    const parentLegacyId = asText(parent?.legacy_local_id);
    const parentId = parentCloudId.get(parentLegacyId) || "";
    (Array.isArray(parent?.line_items) ? parent.line_items : []).forEach((item, index) => {
      const sortOrder = Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index;
      const legacyId = `${prefix}:${parentLegacyId}:line:${sortOrder}`;
      if (out.some((row) => row.legacy_local_id === legacyId)) duplicateIds.push(legacyId);
      out.push({
        legacy_local_id: legacyId,
        [parentColumn]: parentId,
        sort_order: sortOrder,
        description: item?.description ?? null,
        quantity: item?.quantity ?? null,
        unit: item?.unit ?? null,
        unit_price: item?.unit_price ?? null,
        total_price: item?.total ?? null,
        metadata: item?.metadata ?? null,
        ...(includeLineRole ? { line_role: item?.kind ?? null } : {}),
      });
    });
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
  let preservedSkippedCloudEstimateRowIds = new Set();
  let preservedOlderEstimatesMatched = false;

  for (const [table, key] of ID_COMPARABLE_TABLES) {
    const columns = table === "estimates"
      ? "id, legacy_local_id, restore_payload, restore_payload_version"
      : "id, legacy_local_id";
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
    const matched = (
      localCounts[key] === rows.length
      && missing.length === 0
      && extra.length === 0
      && missingRestorePayloadLegacyIds.length === 0
    ) || preservedOlderEstimateSetMatched;

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
    const extra = comparableRows.filter((row) => !expectedByLegacyId.has(asText(row?.legacy_local_id))).map((row) => asText(row?.legacy_local_id)).filter(Boolean).sort();
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
    });
  }

  notices.push(...collectRelationshipNotices(tableResults));
  const bindingDiagnostics = buildBindingDiagnostics(companyId, draft, cloudRowsByTable);

  const allMatched = tableResults.length > 0 && tableResults.every((result) => result.status === "matched");

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
    notices,
    bindingDiagnostics,
    noWritesPerformed: true,
  };
}

export default runSupabaseCloudVerification;
