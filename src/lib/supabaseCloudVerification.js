import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { getSupabaseClient } from "./supabaseClient";
import { mapLocalSnapshotToBackendDraft } from "../utils/backendDataMapper";

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

// Line-item legacy ids are generated deterministically (parent local id +
// stable index) only inside the migration writer. That generation logic is
// intentionally not duplicated here, so these two tables are verified by
// count only, which is still enough to catch missing/extra rows.
const COUNT_ONLY_TABLES = [
  ["estimate_line_items", "estimateLineItems"],
  ["invoice_line_items", "invoiceLineItems"],
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

function diffIdSets(localIds, cloudIds) {
  const missing = [...localIds].filter((id) => !cloudIds.has(id)).sort();
  const extra = [...cloudIds].filter((id) => !localIds.has(id)).sort();
  return { missing, extra };
}

async function readCloudRows(client, table, companyId) {
  try {
    const response = await client
      .from(table)
      .select("id, legacy_local_id")
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

  for (const [table, key] of ID_COMPARABLE_TABLES) {
    const { rows, error } = await readCloudRows(client, table, companyId);
    if (error) {
      tableResults.push(buildUnavailableTableResult(table, localCounts[key], error));
      notices.push(buildNotice("error", `${table}_read_failed`, `Unable to read ${table} from Supabase.`));
      continue;
    }

    const localIds = buildLegacyIdSet(draft[key]);
    const cloudIds = buildLegacyIdSet(rows);
    const { missing, extra } = diffIdSets(localIds, cloudIds);
    const matched = localCounts[key] === rows.length && missing.length === 0 && extra.length === 0;

    tableResults.push({
      table,
      localCount: localCounts[key],
      cloudCount: rows.length,
      status: matched ? "matched" : "mismatch",
      missingLegacyIds: missing,
      extraLegacyIds: extra,
      countOnly: false,
    });
  }

  for (const [table, key] of COUNT_ONLY_TABLES) {
    const { rows, error } = await readCloudRows(client, table, companyId);
    if (error) {
      tableResults.push(buildUnavailableTableResult(table, localCounts[key], error));
      notices.push(buildNotice("error", `${table}_read_failed`, `Unable to read ${table} from Supabase.`));
      continue;
    }

    const matched = localCounts[key] === rows.length;
    tableResults.push({
      table,
      localCount: localCounts[key],
      cloudCount: rows.length,
      status: matched ? "matched" : "mismatch",
      missingLegacyIds: [],
      extraLegacyIds: [],
      countOnly: true,
    });
  }

  notices.push(...collectRelationshipNotices(tableResults));

  const allMatched = tableResults.length > 0 && tableResults.every((result) => result.status === "matched");

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
    noWritesPerformed: true,
  };
}

export default runSupabaseCloudVerification;
