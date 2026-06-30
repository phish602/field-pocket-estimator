import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { getSupabaseClient } from "./supabaseClient";
import { collectBackendMappingWarnings, mapLocalSnapshotToBackendDraft } from "../utils/backendDataMapper";

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
const ESTIMATE_LINE_ITEM_SCHEMA_BLOCKER =
  "Estimate line items remain blocked because the documented schema has no unique idempotent upsert path on company_id + legacy_local_id or estimate_id + legacy_local_id.";
const INVOICE_LINE_ITEM_SCHEMA_BLOCKER =
  "Invoice line items remain blocked because the documented schema has no unique idempotent upsert path on company_id + legacy_local_id or invoice_id + legacy_local_id.";

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
  const response = await client
    .from("customers")
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
      notices.push(buildNotice(
        "error",
        `estimate_number_missing:${index}`,
        "Estimate is missing an estimate number required by the cloud schema.",
      ));
    }
  });

  (Array.isArray(draft?.invoices) ? draft.invoices : []).forEach((invoice, index) => {
    if (!asText(invoice?.invoice_number)) {
      notices.push(buildNotice(
        "error",
        `invoice_number_missing:${index}`,
        "Invoice is missing an invoice number required by the cloud schema.",
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
    if (severity === "error") return true;
    if (code.startsWith("project_customer_ref_missing:")) return true;
    if (code.startsWith("invoice_source_estimate_missing:")) return true;
    if (code.startsWith("document_number_collision:")) return true;
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
    created_by: userId,
    updated_by: userId,
  }));
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

function buildLegacyIdMap(rows) {
  return new Map((Array.isArray(rows) ? rows : []).map((row) => [asText(row?.legacy_local_id), asText(row?.id)]));
}

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

function isFullMigrationAlreadyPresent(localCounts, cloudCounts) {
  return (
    Number(cloudCounts?.customers || 0) === Number(localCounts?.customers || 0) &&
    Number(cloudCounts?.projects || 0) === Number(localCounts?.projects || 0) &&
    Number(cloudCounts?.estimates || 0) === Number(localCounts?.estimates || 0) &&
    Number(cloudCounts?.invoices || 0) === Number(localCounts?.invoices || 0) &&
    Number(cloudCounts?.invoicePayments || 0) === Number(localCounts?.invoicePayments || 0)
  );
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

function collectLineItemSchemaBlockers(localLineItemCounts) {
  const notices = [];

  if (Number(localLineItemCounts?.estimateLineItems || 0) > 0) {
    notices.push(buildNotice("warning", "estimate_line_items_schema_blocked", ESTIMATE_LINE_ITEM_SCHEMA_BLOCKER));
  }
  if (Number(localLineItemCounts?.invoiceLineItems || 0) > 0) {
    notices.push(buildNotice("warning", "invoice_line_items_schema_blocked", INVOICE_LINE_ITEM_SCHEMA_BLOCKER));
  }

  return notices;
}

function hasPendingLineItemCoverage(localLineItemCounts) {
  return (
    Number(localLineItemCounts?.estimateLineItems || 0) > 0 ||
    Number(localLineItemCounts?.invoiceLineItems || 0) > 0
  );
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
  const localSnapshot = buildLocalSnapshotFromArtifact(artifact);
  const draft = mapLocalSnapshotToBackendDraft(localSnapshot, {
    companyId,
    userId,
  });
  const normalizedProjectStatuses = collectProjectStatusNormalization(localSnapshot);
  const localLineItemCounts = countDraftLineItems(draft);

  tableResults[3] = buildTableResult("estimate_line_items", "Estimate line items", localLineItemCounts.estimateLineItems, "skipped", {
    skipped: localLineItemCounts.estimateLineItems,
    reason: localLineItemCounts.estimateLineItems > 0
      ? ESTIMATE_LINE_ITEM_SCHEMA_BLOCKER
      : "No local estimate line items were found for migration.",
  });
  tableResults[5] = buildTableResult("invoice_line_items", "Invoice line items", localLineItemCounts.invoiceLineItems, "skipped", {
    skipped: localLineItemCounts.invoiceLineItems,
    reason: localLineItemCounts.invoiceLineItems > 0
      ? INVOICE_LINE_ITEM_SCHEMA_BLOCKER
      : "No local invoice line items were found for migration.",
  });
  if (localLineItemCounts.estimateLineItems > 0) {
    tableResults[3] = { ...tableResults[3], status: "blocked" };
  }
  if (localLineItemCounts.invoiceLineItems > 0) {
    tableResults[5] = { ...tableResults[5], status: "blocked" };
  }

  notices.push(...classifyMappingWarnings(collectBackendMappingWarnings(localSnapshot, { companyId, userId })));
  notices.push(...collectDocumentIdentifierIssues(draft));
  notices.push(...collectInvoicePaymentValidationIssues(draft));
  notices.push(...normalizedProjectStatuses.issues);
  notices.push(...collectLineItemSchemaBlockers(localLineItemCounts));
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
      tableResults,
      noLocalDeletes: true,
    };
  }

  const cloudCounts = await readCloudCounts(client, companyId);
  const localCounts = preview?.localCounts || {};

  if (isFullMigrationAlreadyPresent(localCounts, cloudCounts)) {
    if (hasPendingLineItemCoverage(localLineItemCounts)) {
      return {
        ok: false,
        blocked: true,
        reason: "Top-level migration is complete, but line item migration remains blocked by missing schema idempotency constraints.",
        notices: [
          buildNotice(
            "warning",
            "core_tables_already_migrated",
            "Top-level business tables already match the local migration counts.",
            { cloudCounts }
          ),
          ...collectLineItemSchemaBlockers(localLineItemCounts),
        ],
        cloudCountsBefore: cloudCounts,
        tableResults,
        noLocalDeletes: true,
      };
    }
    return {
      ok: false,
      blocked: true,
      reason: "Cloud business tables already match the local migration counts.",
      notices: [
        buildNotice(
          "warning",
          "already_migrated",
          "Cloud business tables already match the local migration counts.",
          { cloudCounts }
        ),
      ],
      cloudCountsBefore: cloudCounts,
      tableResults,
      noLocalDeletes: true,
    };
  }

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
      return {
        ok: false,
        blocked: true,
        reason: "Cloud business tables already contain records. Migration is blocked without an override path.",
        notices: [
          buildNotice(
            "error",
            "cloud_tables_not_empty",
            "Cloud business tables already contain records. Migration is blocked without an override path.",
            { cloudCounts }
          ),
        ],
        cloudCountsBefore: cloudCounts,
        tableResults,
        noLocalDeletes: true,
      };
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
    notices: [
      buildNotice("info", "prevalidation_complete", "Prevalidation completed before any migration writes started."),
      ...notices,
    ],
    tableResults,
  };
}

export default runSupabaseMigrationWrite;
