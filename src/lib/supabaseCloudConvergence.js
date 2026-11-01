// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { AUDIT_STORE_SCHEMA_VERSION } from "../utils/auditStore";
import { normalizeAuditEvent } from "../utils/auditLog";
import { sanitizePhoneDigits } from "../utils/sanitize";
import { buildLocalSnapshotFromStorage, scanLocalDataIntegrity } from "./localDataIntegrity";
import { readCloudAssetBindings, setCloudAssetBindingsBatch } from "./cloudAssetBindings";
import { readCloudSyncBaseline, cloudSyncEqual, normalizeCloudSyncValue, captureVerifiedCloudSyncBaseline, stableCloudSyncHash, compactStoredCloudSyncBaseline } from "./cloudSyncBaseline";
import { readSupabaseCloudConvergenceSnapshot } from "./supabaseCloudRestore";
import { readCloudBackupQueueState, readPersistedCloudBackupQueueState, clearCloudBackupDirty, CLOUD_BACKUP_STATUS, LEGACY_CLOUD_BACKUP_QUEUE_SCHEMA_VERSION, migrateLegacyPersistedCloudBackupQueue, recoverVerifiedActiveDeviceTakeoverPause } from "./cloudBackupQueue";
import { ensureCurrentDeviceCanApplyLocalRestore, getOrCreateLocalDeviceId, operationFenceStillCurrent } from "./supabaseDeviceLock";
import { runSupabaseCloudVerification } from "./supabaseCloudVerification";
import { mapLocalEstimateToBackendEstimate, mapLocalInvoiceToBackendInvoice, mapLocalInvoicePaymentToBackendPayment } from "../utils/backendDataMapper";
import { buildParentLineItemContract } from "./cloudLineItemContract";
import { buildPersistedEstimateContract, PERSISTED_ESTIMATE_CONTRACT_FIELDS } from "./supabaseEstimatePersistenceContract";
import { ESTIMATE_RESTORE_PAYLOAD_SCHEMA, ESTIMATE_RESTORE_PAYLOAD_VERSION } from "./supabaseEstimateRestorePayload";
import { buildImmutableAppRestoreBundleMutation } from "./businessCloudMutationOwners";
import { appendCloudMutationsDurably, CLOUD_MUTATION_ENTITY, CLOUD_MUTATION_OPERATION } from "./cloudMutationLedger";
import { getHistoricalWorkspaceBaselineCandidates, buildWorkspaceBaselineRetiredLedger, normalizeCloudMutationLedger } from "./cloudMutationLedger";
import { isInactiveWorkspaceBaselineQueue, buildWorkspaceBaselineRetiredQueue, isLegacyCompatibilityQueue } from "./cloudBackupQueue";
import { isActiveCloudMutation, CLOUD_OPERATION_OWNER, CORE_BUSINESS_FAMILIES } from "./cloudOperationOwnership";
import { readCloudOperationRunLock } from "./cloudOperationRunLock";
import { getActiveAccountScopedStorage, getActiveAccountWorkspaceIdentity, isAuthoritativeVaultRuntimeInstalled } from "./accountScopedLocalStorage";
import { getVaultRuntimeStatus, isVaultRuntimeReady, isVaultRuntimeReadable, runtimeGetItem, runtimeCommitAtomicRecords } from "./vaultRuntimeStore";
import { deriveWorkspaceVaultTag } from "./vaultSession";
import { getBrowserSurfaceClaimToken, isBrowserSurfaceActive } from "./browserSurfaceAuthority";
import { withVaultDeviceRecoveryLease } from "./vaultDeviceRecoveryLease";
import { readVaultDeviceRecoveryCheckpoint } from "./vaultDeviceRecoveryCheckpoint";
import { SUPABASE_CLOUD_VERIFICATION_VERSION } from "./supabaseCloudVerification";

export const CLOUD_CONVERGENCE_VERSION = 1;
const JOURNAL_KEY = STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL;
const VAULT_KEY = STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT;
const FAMILY_KEYS = {
  customers: STORAGE_KEYS.CUSTOMERS, projects: STORAGE_KEYS.PROJECTS, estimates: STORAGE_KEYS.ESTIMATES,
  invoices: STORAGE_KEYS.INVOICES, companyProfile: STORAGE_KEYS.COMPANY_PROFILE,
  settings: STORAGE_KEYS.SETTINGS, scopeTemplates: STORAGE_KEYS.SCOPE_TEMPLATES,
};
const ENTITY_BINDING_TYPES = { customers: "customer", projects: "project", estimates: "estimate", invoices: "invoice" };
const CUSTOMER_PROTECTED_FIELDS = new Set(["id", "type", "displayName"]);
const PROJECT_PROTECTED_FIELDS = new Set(["id", "customerId", "projectNumber"]);

const asText = (value) => String(value == null ? "" : value).trim();
const asArray = (value) => Array.isArray(value) ? value : [];
const now = () => new Date().toISOString();
function readRaw(storage, key) { try { return storage?.getItem?.(key) ?? null; } catch { return null; } }

// READ-ONLY accessor for the conflict evidence this module already persisted.
//
// recordConflicts() writes record-level evidence into the encrypted conflict
// vault whenever a plan is unsafe, but VAULT_KEY was reachable only through the
// module-private readRaw above -- so nothing outside this file could inspect it.
// During a conflict the business shell is deliberately unmounted, which left the
// evidence with no legitimate viewer at all.
//
// This performs exactly one getItem through the caller's storage facade. It
// never writes, migrates, de-duplicates, reorders or repairs anything, and it
// never starts a convergence transaction. The stored shape is returned as-is
// (defensively cloned) so no second diagnostic schema is introduced.
export function readCloudSyncConflictVault(storage = localStorage) {
  const raw = readRaw(storage, VAULT_KEY);
  if (!raw) return { ok: true, present: false, version: 0, companyId: "", entries: [], error: "" };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, present: true, version: 0, companyId: "", entries: [], error: "conflict_vault_unreadable" };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, present: true, version: 0, companyId: "", entries: [], error: "conflict_vault_unreadable" };
  }
  let entries;
  try {
    // Defensive clone: a viewer must never be able to mutate stored evidence.
    entries = JSON.parse(JSON.stringify(asArray(parsed.entries)));
  } catch {
    return { ok: false, present: true, version: 0, companyId: "", entries: [], error: "conflict_vault_unreadable" };
  }
  return {
    ok: true,
    present: true,
    version: Number(parsed.version) || 0,
    companyId: asText(parsed.companyId),
    entries,
    error: "",
  };
}
function writeRaw(storage, key, value) { try { storage.setItem(key, value); return readRaw(storage, key) === value; } catch { return false; } }
function entityId(entity) { return asText(entity?.id); }
export function normalizeCustomerContract(customer = {}) {
  const type = asText(customer.type || customer.customerType || "residential").toLowerCase() === "commercial" ? "commercial" : "residential";
  return {
    id: entityId(customer), type,
    displayName: asText(type === "commercial" ? (customer.companyName || customer.name || customer.fullName) : (customer.fullName || customer.name || customer.displayName)),
    contactName: asText(customer.contactName || customer.attn), phone: asText(customer.phone || customer.comPhone || customer.resPhone),
    email: asText(customer.email || customer.comEmail || customer.resEmail), address: asText(customer.address), billingAddress: asText(customer.billingAddress),
    status: asText(customer.status), netTermsType: asText(customer.netTermsType), netTermsDays: Number.isFinite(Number(customer.netTermsDays)) ? Number(customer.netTermsDays) : null,
  };
}
export function normalizeProjectContract(project = {}) {
  return { id: entityId(project), customerId: asText(project.customerId || project.customer?.id), projectNumber: asText(project.projectNumber), projectName: asText(project.projectName || project.name), siteAddress: asText(project.siteAddress || project.projectAddress), status: asText(project.status || project.projectStatus), notes: asText(project.notes || project.projectNotes), scopeSummary: asText(project.scopeSummary || project.scopeNotes || project.additionalNotes) };
}
export function normalizeEstimateContract(estimate = {}) {
  const mapped = mapLocalEstimateToBackendEstimate(estimate, {});
  return {
    id: entityId(estimate), customerId: asText(estimate.customerId || estimate.customer?.id), projectId: asText(estimate.projectId || estimate.project?.id),
    convertedInvoiceId: asText(estimate.invoiceId || estimate.convertedInvoiceId || estimate.sourceInvoiceId || estimate.invoice?.id),
    persisted: mapped,
    // An estimate is a complete money-critical document. The payload object is
    // part of its contract; this catches estimator inputs the flattened row
    // cannot represent without inventing math during restore.
    document: { ...clone(estimate), id: "" },
  };
}
// The invoice columns the EXISTING writer actually persists (see
// mapInvoicePayloads in supabaseMigrationWriter). Everything the mapper also
// produces for display -- customer_name, project_name, project_number,
// work_title, timeline fields -- is dropped by the writer, so cloud can never
// return it and it must not participate in equality.
const PERSISTED_INVOICE_HEADER_FIELDS = Object.freeze([
  "legacy_local_id", "project_legacy_local_id", "customer_legacy_local_id", "source_estimate_legacy_local_id",
  "invoice_number", "estimate_number", "doc_type", "status", "payment_status",
  "invoice_date", "due_date", "total", "amount_paid", "balance_remaining", "notes", "terms",
]);

// The invoice_payments columns the writer persists: see the projection list in
// supabaseMigrationWriter ("legacy_local_id, invoice_id, amount, method, status,
// paid_at"). The local runtime payment additionally carries empty processor
// scaffolding (stripe*, cardBrand, receiptUrl, note, order, currency) that is
// never written, so it cannot be evidence of divergence.
const PERSISTED_PAYMENT_FIELDS = Object.freeze(["legacy_local_id", "amount", "method", "status", "paid_at"]);

function pickPersistedFields(source, fields) {
  const picked = {};
  fields.forEach((field) => {
    const value = source?.[field];
    // The mappers already delete "" and null, so an absent key means "not
    // persisted" on both sides and stays absent rather than becoming a value.
    if (value !== undefined) picked[field] = value;
  });
  return picked;
}

// THE INVOICE COMPARISON CONTRACT.
//
// This used to be `document: { ...clone(invoice), id: "" }` -- the entire local
// runtime object. A cloud-restored invoice is reconstructed from persisted
// columns only, so it can never carry the local computed/display containers
// (financials, totals, margins, customer, job, materials, labor,
// sourceEstimateSnapshot, ui, docType, invoiceType, local timestamps). Comparing
// them made two invoices with identical business state diverge on every field
// the cloud is not even allowed to store.
//
// The replacement is still ONE atomic financial document -- relationship
// identity, the persisted header, the canonical child rows and the persisted
// payments. Nothing here is independently mergeable; it is simply the invoice
// EstiPaid can actually write and read back.
export function normalizeInvoiceContract(invoice = {}) {
  const mapped = mapLocalInvoiceToBackendInvoice(invoice, {});
  const parentLegacyId = asText(mapped.legacy_local_id) || entityId(invoice);
  const payments = asArray(invoice?.payments)
    .map((payment) => pickPersistedFields(
      mapLocalInvoicePaymentToBackendPayment(payment, invoice, {}),
      PERSISTED_PAYMENT_FIELDS
    ))
    // The cloud payment table has no `order` column, so runtime array position
    // is not business state. Ordering by persisted identity keeps comparison
    // deterministic WITHOUT collapsing duplicates: a repeated legacy_local_id
    // still yields two rows here, and the existing duplicate-identity checks
    // continue to fail closed on it.
    .sort((left, right) => asText(left.legacy_local_id).localeCompare(asText(right.legacy_local_id)));

  return {
    id: entityId(invoice), customerId: asText(invoice.customerId || invoice.customer?.id), projectId: asText(invoice.projectId || invoice.project?.id),
    sourceEstimateId: asText(invoice.sourceEstimateId || invoice.sourceEstimateLegacyId || invoice.sourceEstimateSnapshot?.estimateId),
    persisted: pickPersistedFields(mapped, PERSISTED_INVOICE_HEADER_FIELDS),
    // The SAME canonical child contract the writer and verifier use, so
    // line-item economics stay strict and identity stays deterministic.
    lineItems: buildParentLineItemContract({
      entityType: "invoice",
      parentLegacyId,
      items: mapped.line_items,
    }).rows,
    payments,
  };
}
function normalizeFamilyEntity(family, value) {
  if (!value) return null;
  if (family === "customers") return normalizeCustomerContract(value);
  if (family === "projects") return normalizeProjectContract(value);
  if (family === "estimates") return normalizeEstimateContract(value);
  if (family === "invoices") return normalizeInvoiceContract(value);
  return value;
}
function normalizeFamilyEntityForId(family, value, canonicalId = "") {
  const normalized = normalizeFamilyEntity(family, value);
  return normalized && canonicalId ? { ...normalized, id: canonicalId } : normalized;
}
function sameFamilyEntity(family, left, right) {
  return cloudSyncEqual(normalizeFamilyEntity(family, left), normalizeFamilyEntity(family, right));
}
function sameFamilyIdentity(family, left, right) {
  const normalizedLeft = normalizeFamilyEntity(family, left); const normalizedRight = normalizeFamilyEntity(family, right);
  if (!normalizedLeft || !normalizedRight) return false;
  return cloudSyncEqual({ ...normalizedLeft, id: "" }, { ...normalizedRight, id: "" });
}
function familyProtectedFields(family) {
  return family === "customers" ? CUSTOMER_PROTECTED_FIELDS : family === "projects" ? PROJECT_PROTECTED_FIELDS : RELATIONSHIP_FIELDS;
}
function mapById(rows) {
  const map = new Map(); const duplicateIds = [];
  asArray(rows).forEach((row) => { const id = entityId(row); if (!id || map.has(id)) duplicateIds.push(id || "missing"); else map.set(id, row); });
  return { map, duplicateIds };
}
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function localSnapshot(storage) { return buildLocalSnapshotFromStorage(storage).snapshot; }
function snapshotValues(storage) {
  return [...Object.values(FAMILY_KEYS), STORAGE_KEYS.CLOUD_ASSET_BINDINGS, STORAGE_KEYS.CLOUD_SYNC_BASELINE, STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT, STORAGE_KEYS.CLOUD_BACKUP_QUEUE, STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE]
    .reduce((out, key) => ({ ...out, [key]: readRaw(storage, key) }), {});
}
// Gate 16H: exactly the keys one convergence transaction can mutate -- nothing
// else belongs in the persisted rollback journal. Unrelated families (company
// profile, settings, scope templates, customers, the conflict vault) are only
// listed when this plan actually writes them, which for an ordinary cloud
// import it does not.
export function buildConvergenceRollbackKeySet({ writes = {}, bindingEntries = [], willCaptureBaseline = false, willClearQueue = false, willAppendLedger = false, metadataRecovery = false } = {}) {
  const keys = new Set(Object.keys(writes || {}));
  if (asArray(bindingEntries).length) keys.add(STORAGE_KEYS.CLOUD_ASSET_BINDINGS);
  if (willCaptureBaseline) keys.add(STORAGE_KEYS.CLOUD_SYNC_BASELINE);
  if (willAppendLedger) keys.add(STORAGE_KEYS.CLOUD_MUTATION_LEDGER);
  // A verified completion clears the queue, and clearCloudBackupDirty also
  // clears the pause; a legacy migration rewrote both. Either way both keys are
  // in play and must be restorable.
  if (willClearQueue || metadataRecovery) {
    keys.add(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
    keys.add(STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE);
  }
  return [...keys];
}

// Gate 16G: the sync-metadata keys a recovery may touch. Captured before any
// migration so a failed attempt restores the device exactly as it was found.
const METADATA_KEYS = [STORAGE_KEYS.CLOUD_BACKUP_QUEUE, STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE];
function metadataValues(storage) {
  return METADATA_KEYS.reduce((out, key) => ({ ...out, [key]: readRaw(storage, key) }), {});
}
function metadataChanged(storage, previous) {
  return METADATA_KEYS.some((key) => readRaw(storage, key) !== previous[key]);
}
function restoreMetadata(storage, previous) {
  METADATA_KEYS.forEach((key) => {
    const value = previous[key];
    try { if (value === null) storage.removeItem(key); else storage.setItem(key, value); } catch {}
  });
}
function queueRevision(storage) {
  const persisted = readPersistedCloudBackupQueueState(storage);
  return Number((persisted.ok ? persisted.state : readCloudBackupQueueState())?.localMutationRevision || 0);
}

// Gate 16B: a single safe automatic-convergence result contract so status
// surfaces can react to EVERY outcome (not just success), similar to the
// restore-complete event pattern. The payload is deliberately non-sensitive:
// no names, numbers, descriptions, totals, payment details, payloads, or ids --
// only a timestamp, ok, status, a safe technical code, no-write flags,
// changed-family booleans, and safe counts.
export const CLOUD_CONVERGENCE_RESULT_EVENT = "estipaid:cloud-convergence-result";
// Gate 16C: an explicit request to run a fresh automatic-convergence attempt
// cycle (used by "Recheck Cloud Status" and the Home mismatch retry). It never
// invokes Restore/Replace -- it only asks the automatic hook to try again.
export const CLOUD_CONVERGENCE_REQUEST_EVENT = "estipaid:cloud-convergence-request";

export const CLOUD_CONVERGENCE_STAGES = [
  "eligibility", "journal_recovery", "run_lock", "cloud_snapshot", "planning", "device_access",
  "bindings", "local_apply", "verification", "completion_access", "baseline", "rollback", "completed",
];

let lastConvergenceResult = null;
export function getLastCloudConvergenceResult() { return lastConvergenceResult; }

// Infers the lifecycle stage for a convergence result when the caller did not
// set one explicitly (the automatic hook sets stages for its own skip outcomes).
function inferConvergenceStage(result) {
  const explicit = asText(result?.stage);
  if (explicit) return explicit;
  const status = asText(result?.status);
  const code = asText(result?.code);
  if (status === "converged" || status === "matched") return "completed";
  if (status === "conflict") return "planning";
  if (status === "mismatch") return "verification";
  if (status === "blocked") return "device_access";
  if (status === "aborted") return "local_apply";
  if (code === "cloud_verification_failed") return "verification";
  if (code === "convergence_completion_guard_failed") return "completion_access";
  if (code === "baseline_write_failed" || code === "baseline_quota_exceeded" || code === "baseline_readback_mismatch"
    || code === "baseline_serialization_failed" || code === "baseline_storage_unavailable") return "baseline";
  if (code === "binding_write_failed") return "bindings";
  if (code === "local_write_failed" || code === "local_write_mismatch" || code === "local_changed_during_read") return "local_apply";
  if (code === "cloud_snapshot_failed" || /_read_failed$/.test(code)) return "cloud_snapshot";
  if (code === "prerequisites_missing") return "eligibility";
  if (code === "journal_write_failed" || code === "journal_rollback_failed") return "journal_recovery";
  if (status === "rolled_back" || status === "critical" || status === "critical_local_recovery_required") return "rollback";
  return "";
}

// Bundle-proof evidence is limited to fixed enums/booleans, safe counts and
// the explicitly approved non-sensitive profile schema keys.
// Never forward cloud errors, values, identities or diff payloads. Only the
// explicit non-sensitive profile schema keys below may be named.
const PORTABLE_DIFFERENCE_FLAGS = ["localOnlyFields", "cloudOnlyFields", "differentValues", "orderingDifference", "localOnlyRecords", "cloudOnlyRecords", "serializationOnly", "phoneFormattingEquivalent", "collectionOrderEquivalent", "unsupportedShape", "identityIssue"];
// A strict allowlist also withholds unknown/user-created keys: a denylist alone
// could expose a secret or a business value used as an object property name.
// Tax/account identifiers and all credentials/encryption keys are excluded.
export const HISTORICAL_PROFILE_DIAGNOSTIC_FIELD_KEYS = Object.freeze([
  "companyName", "phone", "email", "address", "addressLine1", "addressLine2", "city", "state", "zip",
  "logoDataUrl", "attn", "website", "terms", "businessName", "legalName", "displayName", "name",
  "fullName", "ownerName", "contactName", "firstName", "lastName",
]);
function safeProfileDifferenceKeys(detail) {
  const fields = ["localOnlyFieldKeys", "cloudOnlyFieldKeys", "differingFieldKeys"];
  if (!fields.some(key => Array.isArray(detail?.[key]))) return {};
  const withheld = new Set(fields.flatMap(key => asArray(detail?.[key]))
    .filter(key => typeof key === "string" && !HISTORICAL_PROFILE_DIAGNOSTIC_FIELD_KEYS.includes(key)));
  const prior = Number.isSafeInteger(detail?.redactedFieldKeyCount) && detail.redactedFieldKeyCount >= 0 ? detail.redactedFieldKeyCount : 0;
  return { ...Object.fromEntries(fields.map(key => [key, [...new Set(asArray(detail?.[key])
    .filter(field => HISTORICAL_PROFILE_DIAGNOSTIC_FIELD_KEYS.includes(field)))].sort()])), redactedFieldKeyCount: prior + withheld.size };
}
function safePortableDifference(detail, profile = false) {
  const classifications = ["matched", "serialization_equivalent", "phone_format_equivalent", "collection_order_equivalent", "local_only_fields", "cloud_only_fields", "value_difference", "ordering_difference", "local_only_records", "cloud_only_records", "mixed_difference", "capture_difference", "unsupported_shape"];
  return {
    classification: classifications.includes(detail?.classification) ? detail.classification : "unavailable",
    ...Object.fromEntries(PORTABLE_DIFFERENCE_FLAGS.map(key => [key, typeof detail?.[key] === "boolean" ? detail[key] : null])),
    ...(profile ? safeProfileDifferenceKeys(detail) : {}),
  };
}

function safeTemplateCaptureProof(proof) {
  const select = (value, allowed) => allowed.includes(value) ? value : "unavailable";
  return {
    localStatus: select(proof?.localStatus, ["missing_source_storage", "malformed_stored_data", "unsupported_storage_shape", "unsupported_template_records", "read_unavailable", "captured_empty", "captured_records"]),
    cloudStatus: select(proof?.cloudStatus, ["snapshot_unavailable", "bundle_missing", "bundle_invalid", "bundle_read_unavailable", "bundle_selection_error", "bundle_read_or_selection_error", "uncaptured_null", "captured_empty", "captured_records", "unsupported_storage_shape", "unsupported_template_records"]),
    historicalNullReason: select(proof?.historicalNullReason, ["not_recorded_in_bundle", "not_applicable"]),
  };
}

function safeHistoricalBundleProof(proof) {
  const select = (value, allowed) => allowed.includes(value) ? value : "unavailable";
  const match = value => typeof value === "boolean" ? value : null;
  return {
    code: select(proof?.code, ["matched", "cloud_snapshot_unavailable", "app_restore_bundle_missing", "app_restore_bundle_invalid", "app_restore_bundle_error", "app_restore_bundle_unavailable", "company_profile_mismatch", "settings_mismatch", "scope_templates_mismatch"]),
    family: select(proof?.family, ["none", "company_profile", "settings", "scope_templates"]),
    snapshotAvailable: match(proof?.snapshotAvailable),
    supplementalStatus: select(proof?.supplementalStatus, ["available", "missing", "invalid", "error"]),
    companyProfileMatched: match(proof?.companyProfileMatched), settingsMatched: match(proof?.settingsMatched),
    scopeTemplatesMatched: match(proof?.scopeTemplatesMatched),
    localShape: select(proof?.localShape, ["object", "array", "null", "missing", "scalar"]),
    cloudShape: select(proof?.cloudShape, ["object", "array", "null", "missing", "scalar"]),
    ...(proof?.companyProfileDifference ? { companyProfileDifference: safePortableDifference(proof.companyProfileDifference, true) } : {}),
    ...(proof?.scopeTemplatesDifference ? { scopeTemplatesDifference: safePortableDifference(proof.scopeTemplatesDifference) } : {}),
    ...(proof?.scopeTemplateCapture ? { scopeTemplateCapture: safeTemplateCaptureProof(proof.scopeTemplateCapture) } : {}),
  };
}

export function buildSafeConvergenceResult(result) {
  const changed = result?.changedFamilies || {};
  return {
    at: Date.now(),
    ok: Boolean(result?.ok),
    status: asText(result?.status),
    code: asText(result?.code),
    stage: inferConvergenceStage(result),
    retryable: Boolean(result?.retryable),
    attempt: Number(result?.attempt || 0),
    noWritesPerformed: Boolean(result?.noWritesPerformed),
    noCloudWritesPerformed: Boolean(result?.noCloudWritesPerformed),
    changedFamilies: {
      customers: Boolean(changed.customers), projects: Boolean(changed.projects), estimates: Boolean(changed.estimates),
      invoices: Boolean(changed.invoices), scopeTemplates: Boolean(changed.scopeTemplates),
      companyProfile: Boolean(changed.companyProfile), settings: Boolean(changed.settings),
    },
    conflictCount: Number(result?.conflictCount || 0),
    conflictSummary: Array.isArray(result?.conflictSummary)
      ? result.conflictSummary.map((entry) => ({ family: asText(entry?.family), code: asText(entry?.code), count: Number(entry?.count || 0) })).filter((entry) => entry.family && entry.code && entry.count > 0)
      : [],
    bootstrapCode: asText(result?.bootstrapCode),
    // Gate 16G sync-metadata diagnostics. Every value is a fixed code, a schema
    // version string, or a boolean -- never a name, id, number, or payload.
    bootstrapDetailCode: asText(result?.bootstrapDetailCode),
    baselineCompacted: Boolean(result?.baselineCompacted),
    metadataRecoveryStage: asText(result?.metadataRecoveryStage),
    queueSchemaBefore: asText(result?.queueSchemaBefore),
    queueSchemaAfter: asText(result?.queueSchemaAfter),
    pauseReason: asText(result?.pauseReason),
    pauseRecovered: Boolean(result?.pauseRecovered),
    blockerCount: Number(result?.mismatch?.blockerCount || 0),
    ...(result?.historicalBundleProof ? { historicalBundleProof: safeHistoricalBundleProof(result.historicalBundleProof) } : {}),
  };
}

function safeConflictSummary(conflicts = []) {
  const counts = new Map();
  asArray(conflicts).forEach((conflict) => {
    const family = asText(conflict?.family); const code = asText(conflict?.code);
    if (!family || !code) return;
    const key = `${family}\u0000${code}`;
    counts.set(key, (counts.get(key) || 0) + Number(conflict?.count || 1));
  });
  return [...counts.entries()].map(([key, count]) => {
    const [family, code] = key.split("\u0000"); return { family, code, count };
  }).sort((a, b) => a.family.localeCompare(b.family) || a.code.localeCompare(b.code));
}

// Asks the automatic-convergence hook to start a fresh bounded attempt cycle.
// Safe to call from any status surface; it never performs a write itself.
export function requestCloudConvergence() {
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(CLOUD_CONVERGENCE_REQUEST_EVENT));
      return true;
    }
  } catch {}
  return false;
}

// Records the last result in memory and dispatches the safe result event for any
// status (converged, matched, conflict, mismatch, blocked, rolled_back,
// critical, unavailable, ...). Never throws.
export function recordCloudConvergenceResult(result) {
  const safe = buildSafeConvergenceResult(result);
  lastConvergenceResult = safe;
  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(new CustomEvent(CLOUD_CONVERGENCE_RESULT_EVENT, { detail: safe }));
    }
  } catch {}
  return safe;
}

export function classifyCloudConvergenceEntity({ local, cloud, baseline } = {}) {
  if (!baseline) {
    if (!local && cloud) return "cloud_only_addition";
    if (local && !cloud) return "local_only_addition";
    return cloudSyncEqual(local, cloud) ? "matched" : "both_added_different";
  }
  if (!local && baseline) return "local_missing_since_baseline";
  if (!cloud && baseline) return "cloud_missing_since_baseline";
  if (!local && cloud) return "cloud_only_addition";
  if (local && !cloud) return "local_only_addition";
  if (cloudSyncEqual(local, cloud)) return cloudSyncEqual(local, baseline) ? "matched" : "both_changed_same";
  if (cloudSyncEqual(local, baseline)) return "cloud_changed";
  if (cloudSyncEqual(cloud, baseline)) return "local_changed";
  return "both_changed_conflict";
}

function relationshipCodes(snapshot) {
  const customers = new Set(asArray(snapshot.customers).map(entityId));
  const projects = new Set(asArray(snapshot.projects).map(entityId));
  const estimates = new Set(asArray(snapshot.estimates).map(entityId));
  const codes = [];
  // An unassigned project (customerId null/empty) makes no customer claim and is
  // valid. Only a NONEMPTY customer reference that resolves to no customer is a
  // conflict -- consistent with the estimate/invoice customer checks below.
  asArray(snapshot.projects).forEach((row) => {
    const customerId = asText(row?.customerId);
    if (customerId && !customers.has(customerId)) codes.push("project_customer_relationship");
  });
  asArray(snapshot.estimates).forEach((row) => {
    if (asText(row?.customerId) && !customers.has(asText(row?.customerId))) codes.push("estimate_customer_relationship");
    if (asText(row?.projectId) && !projects.has(asText(row?.projectId))) codes.push("estimate_project_relationship");
    const invoiceId = asText(row?.invoiceId || row?.convertedInvoiceId || row?.sourceInvoiceId || row?.invoice?.id);
    if (invoiceId) {
      const invoice = asArray(snapshot.invoices).find((candidate) => entityId(candidate) === invoiceId);
      if (!invoice) codes.push("estimate_converted_invoice_relationship");
      else if (asText(invoice?.sourceEstimateId) !== entityId(row)) codes.push("estimate_converted_invoice_conflict");
    }
  });
  asArray(snapshot.invoices).forEach((row) => {
    if (asText(row?.customerId) && !customers.has(asText(row?.customerId))) codes.push("invoice_customer_relationship");
    if (asText(row?.projectId) && !projects.has(asText(row?.projectId))) codes.push("invoice_project_relationship");
    if (asText(row?.sourceEstimateId) && !estimates.has(asText(row?.sourceEstimateId))) codes.push("invoice_estimate_relationship");
    const project = asArray(snapshot.projects).find((candidate) => entityId(candidate) === asText(row?.projectId));
    // Only conflict when BOTH the project and the invoice claim a customer and
    // they differ. A blank project customer makes no claim and never conflicts;
    // the relationship is never guessed or copied from the document.
    if (project && asText(row?.customerId) && asText(project?.customerId) && asText(project?.customerId) !== asText(row?.customerId)) codes.push("invoice_project_customer_relationship");
    const sourceEstimate = asArray(snapshot.estimates).find((candidate) => entityId(candidate) === asText(row?.sourceEstimateId));
    if (sourceEstimate && asText(row?.customerId) && asText(sourceEstimate?.customerId) !== asText(row?.customerId)) codes.push("invoice_estimate_customer_relationship");
    const lineIds = new Set(); const paymentIds = new Set();
    if (asArray(row?.lineItems).some((child, index) => { const childId = asText(child?.id) || `index:${index}`; if (lineIds.has(childId)) return true; lineIds.add(childId); return false; })) codes.push("invoice_line_item_duplicate_identity");
    if (asArray(row?.payments).some((payment) => { const paymentId = asText(payment?.id); if (!paymentId || paymentIds.has(paymentId)) return true; paymentIds.add(paymentId); return false; })) codes.push("invoice_payment_duplicate_identity");
  });
  const invoiceNumbers = new Set();
  asArray(snapshot.invoices).forEach((row) => { const number = asText(row?.invoiceNumber); if (!number) return; if (invoiceNumbers.has(number)) codes.push("invoice_duplicate_number"); invoiceNumbers.add(number); });
  return [...new Set(codes)];
}

function stableRelationshipIdentity(family, value) {
  if (family === "customers" || family === "scopeTemplates") return { id: entityId(value) };
  if (family === "projects") return { id: entityId(value), customerId: asText(value?.customerId || value?.customer?.id) };
  if (family === "estimates") return { id: entityId(value), customerId: asText(value?.customerId || value?.customer?.id), projectId: asText(value?.projectId || value?.project?.id), convertedInvoiceId: asText(value?.invoiceId || value?.convertedInvoiceId || value?.sourceInvoiceId || value?.invoice?.id) };
  if (family === "invoices") return { id: entityId(value), customerId: asText(value?.customerId || value?.customer?.id), projectId: asText(value?.projectId || value?.project?.id), sourceEstimateId: asText(value?.sourceEstimateId || value?.sourceEstimateLegacyId || value?.sourceEstimateSnapshot?.estimateId) };
  return { id: entityId(value) };
}

function validQueueTimestamp(value) {
  const numeric = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(numeric) && numeric > 0;
}

function identitySetsAgree(local, cloud) {
  for (const family of ["customers", "projects", "estimates", "invoices", "scopeTemplates"]) {
    const localMap = mapById(local?.[family]); const cloudMap = mapById(cloud?.[family]);
    if (localMap.duplicateIds.length || cloudMap.duplicateIds.length) return { ok: false, code: "baseline_bootstrap_evidence_invalid" };
    for (const [id, localRow] of localMap.map.entries()) {
      const cloudRow = cloudMap.map.get(id);
      if (!cloudRow) return { ok: false, code: "baseline_bootstrap_local_only_records" };
      if (!cloudSyncEqual(stableRelationshipIdentity(family, localRow), stableRelationshipIdentity(family, cloudRow))) return { ok: false, code: "baseline_bootstrap_relationship_conflict" };
    }
  }
  return { ok: true };
}

// Gate 16G safe diagnostics. These classify METADATA only: every value is a
// fixed code from a closed set, never a name, id, number, total or payload.
const TAKEOVER_PAUSE_REASON = "device_takeover";
function legacyQueueDetailCode(storage) {
  const raw = readRaw(storage, STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
  if (!raw) return "baseline_bootstrap_queue_missing";
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "baseline_bootstrap_queue_legacy_invalid";
    if (asText(parsed.schemaVersion) !== LEGACY_CLOUD_BACKUP_QUEUE_SCHEMA_VERSION) return "baseline_bootstrap_queue_legacy_invalid";
    // A released v1 record that still looks settled and clean is exactly what
    // migrateLegacyPersistedCloudBackupQueue can upgrade.
    if (parsed.pending === true) return "baseline_bootstrap_queue_pending";
    return "baseline_bootstrap_queue_legacy_migration_required";
  } catch {
    return "baseline_bootstrap_queue_legacy_invalid";
  }
}
function pauseDetailCode(pauseRaw) {
  try {
    const parsed = JSON.parse(pauseRaw);
    if (!parsed || typeof parsed !== "object") return "baseline_bootstrap_pause_unknown";
    const reason = asText(parsed.reason);
    if (!reason) return "baseline_bootstrap_pause_unknown";
    // Only a self-inflicted takeover pause is recoverable; every genuine
    // safety pause reports as an active lock and is left alone.
    return reason === TAKEOVER_PAUSE_REASON ? "baseline_bootstrap_pause_stale_takeover" : "baseline_bootstrap_pause_active_safety_lock";
  } catch {
    return "baseline_bootstrap_pause_unknown";
  }
}

// A deliberately narrow proof for one-time clean-replica repair. It accepts a
// storage object explicitly, never reads unrelated global storage, and is not a
// conflict resolver: any uncertainty fails closed before a planner can write.
export function buildCleanReplicaBootstrapProof({ storage, companyId = "", local = {}, cloud = {}, cloudSnapshot = null, baseline = null } = {}) {
  if (baseline) return { ok: false, code: "baseline_bootstrap_baseline_present" };
  const queueRead = readPersistedCloudBackupQueueState(storage);
  if (!queueRead.exists) return { ok: false, code: "baseline_bootstrap_queue_missing" };
  // Gate 16G: keep the top-level code stable for existing callers, but say WHY
  // the queue was refused. A legacy record this app itself wrote is a migration
  // opportunity; an unknown shape is not. Codes only -- never record detail.
  if (!queueRead.ok) return { ok: false, code: "baseline_bootstrap_queue_unverified", detailCode: legacyQueueDetailCode(storage) };
  const queue = queueRead.state;
  if (queue.pending || queue.status !== CLOUD_BACKUP_STATUS.CLEAN || queue.syncingRevision !== null) return { ok: false, code: "baseline_bootstrap_local_pending", detailCode: "baseline_bootstrap_queue_pending" };
  if (queue.companyId !== asText(companyId)) return { ok: false, code: "baseline_bootstrap_queue_unverified", detailCode: "baseline_bootstrap_queue_company_mismatch" };
  if (!validQueueTimestamp(queue.lastSuccessfulBackupAt) || !validQueueTimestamp(queue.lastVerifiedAt)
    || Number(queue.retryCount || 0) !== 0 || queue.nextRetryAt != null || asText(queue.lastError) || asText(queue.lastErrorCode)) return { ok: false, code: "baseline_bootstrap_queue_unverified", detailCode: "baseline_bootstrap_queue_unverified" };
  const pauseRaw = readRaw(storage, STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE);
  const journalRaw = readRaw(storage, JOURNAL_KEY);
  if (journalRaw) return { ok: false, code: "baseline_bootstrap_queue_unverified", detailCode: "baseline_bootstrap_journal_present" };
  if (pauseRaw) return { ok: false, code: "baseline_bootstrap_queue_unverified", detailCode: pauseDetailCode(pauseRaw) };
  const identities = identitySetsAgree(local, cloud);
  if (!identities.ok) return identities;
  if (relationshipCodes(local).length || relationshipCodes(cloud).length) return { ok: false, code: "baseline_bootstrap_relationship_conflict" };
  const raw = cloudSnapshot?.raw;
  if (!raw || !Array.isArray(raw.estimates) || !Array.isArray(raw.invoices) || !Array.isArray(raw.invoice_line_items) || !Array.isArray(raw.invoice_payments)
    || raw.estimates.length !== asArray(cloud.estimates).length || raw.invoices.length !== asArray(cloud.invoices).length) return { ok: false, code: "baseline_bootstrap_evidence_invalid" };
  const estimateEvidence = cloudSnapshot?.estimateEvidence || {};
  if (asArray(cloud.estimates).some((row) => estimateEvidenceCode(row, estimateEvidence[entityId(row)]))) return { ok: false, code: "baseline_bootstrap_evidence_invalid" };
  const rawInvoiceByLegacyId = new Map(asArray(raw.invoices).map((row) => [asText(row?.legacy_local_id), row]));
  const rawInvoiceIds = new Set(asArray(raw.invoices).map((row) => asText(row?.id)).filter(Boolean));
  const childIds = new Set(); const paymentIds = new Set();
  if (asArray(cloud.invoices).some((invoice) => {
    const rawInvoice = rawInvoiceByLegacyId.get(entityId(invoice));
    if (!rawInvoice || !asText(rawInvoice?.id)) return true;
    const childCount = asArray(raw.invoice_line_items).filter((row) => asText(row?.invoice_id) === asText(rawInvoice.id)).length;
    const paymentCount = asArray(raw.invoice_payments).filter((row) => asText(row?.invoice_id) === asText(rawInvoice.id)).length;
    return childCount !== asArray(invoice?.lineItems).length || paymentCount !== asArray(invoice?.payments).length;
  }) || asArray(raw.invoice_line_items).some((row) => {
    const id = asText(row?.legacy_local_id); if (!id || childIds.has(id) || !rawInvoiceIds.has(asText(row?.invoice_id))) return true; childIds.add(id); return false;
  }) || asArray(raw.invoice_payments).some((row) => {
    const id = asText(row?.legacy_local_id); if (!id || paymentIds.has(id) || !rawInvoiceIds.has(asText(row?.invoice_id))) return true; paymentIds.add(id); return false;
  })) return { ok: false, code: "baseline_bootstrap_evidence_invalid" };
  return { ok: true, bootstrap: true, bootstrapReason: "verified_clean_replica", queueRevision: Number(queue.localMutationRevision || 0) };
}

function normalizedChildValue(value) {
  if (value == null || value === "") return null;
  if (typeof value !== "object" && Number.isFinite(Number(value))) return Number(value);
  if (Array.isArray(value)) return value.map(normalizedChildValue);
  if (typeof value === "object") return Object.keys(value).sort().reduce((out, key) => ({ ...out, [key]: normalizedChildValue(value[key]) }), {});
  return value;
}
function estimateEvidenceCode(estimate, evidence) {
  const id = entityId(estimate); const payload = evidence?.restorePayload;
  if (!evidence || !payload) return "estimate_restore_payload_missing";
  if (asText(payload.schema) !== ESTIMATE_RESTORE_PAYLOAD_SCHEMA || String(payload.version) !== String(ESTIMATE_RESTORE_PAYLOAD_VERSION)) return "estimate_restore_payload_invalid";
  if (asText(payload.legacyLocalId) !== id || entityId(payload.estimate) !== id || !cloudSyncEqual(payload.estimate, estimate)) return "estimate_restore_payload_identity_mismatch";
  const persisted = evidence.persisted || {};
  const mapped = mapLocalEstimateToBackendEstimate(payload.estimate, {});
  // The raw row is the writer's TABLE projection, not the backend draft: it
  // collapses approved_total/grand_total/total into total_amount and carries no
  // approved_total column. Comparing it against the draft asserted a
  // total_amount the draft never has and demanded an approved_total the writer
  // never writes, so every estimate with a real total was falsely flagged.
  // Both sides now project through the one shared persistence contract. A
  // historical approved_total column is not writer-owned, so it is ignored --
  // it can never override or stand in for total_amount.
  const contract = buildPersistedEstimateContract(mapped);
  if (PERSISTED_ESTIMATE_CONTRACT_FIELDS.some((field) => persisted[field] !== undefined && !cloudSyncEqual(persisted[field], contract[field]))) return "estimate_restore_payload_persisted_mismatch";
  // Expected child rows use the SHARED line-item contract, so convergence
  // evidence, the verifier, and the writer all agree on identity, sort_order,
  // and metadata (metadata.unit_cost for estimates; kind lives in line_role).
  const expected = buildParentLineItemContract({ entityType: "estimate", parentLegacyId: id, parentColumn: "estimate_id", items: mapped.line_items }).rows;
  const children = asArray(evidence.lineItems); const childById = new Map();
  if (children.some((child) => { const childId = asText(child?.legacy_local_id); if (!childId || childById.has(childId)) return true; childById.set(childId, child); return false; })) return "estimate_line_item_duplicate_identity";
  if (expected.length !== children.length) return "estimate_line_item_mismatch";
  const fields = ["sort_order", "description", "quantity", "unit", "unit_price", "total_price", "metadata", "line_role"];
  if (expected.some((row) => !childById.has(row.legacy_local_id) || fields.some((field) => !cloudSyncEqual(normalizedChildValue(row[field]), normalizedChildValue(childById.get(row.legacy_local_id)?.[field]))))) return "estimate_line_item_mismatch";
  return "";
}

const METADATA_MERGE_FAMILIES = new Set(["customers", "projects"]);
const RELATIONSHIP_FIELDS = new Set(["id", "customerId", "projectId", "sourceEstimateId", "invoiceId", "convertedInvoiceId", "convertedInvoiceNumber"]);
function changedFields(base, next) {
  const keys = new Set([...Object.keys(base || {}), ...Object.keys(next || {})]);
  return [...keys].filter((key) => !cloudSyncEqual(base?.[key], next?.[key]));
}
export function mergeNonOverlappingCloudMetadata({ baseline, local, cloud, family } = {}) {
  if (!METADATA_MERGE_FAMILIES.has(family) || !baseline || !local || !cloud) return null;
  const localFields = changedFields(baseline, local); const cloudFields = changedFields(baseline, cloud);
  const protectedFields = familyProtectedFields(family);
  if (localFields.some((field) => protectedFields.has(field)) || cloudFields.some((field) => protectedFields.has(field))) return null;
  if (localFields.some((field) => cloudFields.includes(field))) return null;
  return { ...cloud, ...localFields.reduce((out, field) => ({ ...out, [field]: local[field] }), {}) };
}

function bindingResolutionForFamily({ family, local, cloud, cloudSnapshot, bindings, companyId, bootstrap = false }) {
  const entityType = ENTITY_BINDING_TYPES[family];
  const localMap = mapById(local); const cloudMap = mapById(cloud);
  const cloudUuids = cloudSnapshot?.uuidMaps?.[family] || {};
  const bindingTable = bindings.bindings?.[entityType] || {};
  const byUuid = new Map();
  Object.entries(cloudUuids).forEach(([legacyId, uuid]) => {
    if (!cloudMap.map.has(legacyId) || !asText(uuid)) return;
    const list = byUuid.get(asText(uuid)) || [];
    list.push(legacyId); byUuid.set(asText(uuid), list);
  });
  const pairs = new Map(); const entries = []; const codes = [];
  const bindingUuidOwners = new Map();
  Object.entries(bindingTable).forEach(([legacyId, binding]) => {
    const uuid = asText(binding?.cloudUuid); if (!uuid) return;
    const owners = bindingUuidOwners.get(uuid) || []; owners.push(legacyId); bindingUuidOwners.set(uuid, owners);
  });
  [...bindingUuidOwners.values()].forEach((owners) => { if (owners.length > 1) codes.push(`${family}:binding_uuid_reused`); });

  localMap.map.forEach((localRow, localId) => {
    const binding = bindingTable[localId];
    const directCloud = cloudMap.map.get(localId);
    const boundUuid = asText(binding?.cloudUuid);
    if (binding && directCloud && boundUuid && boundUuid !== asText(cloudUuids[localId])) {
      codes.push(`${family}:binding_conflict`); return;
    }
    if (binding && directCloud) { pairs.set(localId, localId); return; }
    const exactCandidates = [...cloudMap.map.entries()]
      .filter(([cloudId, cloudRow]) => cloudId !== localId && sameFamilyIdentity(family, localRow, cloudRow))
      .map(([cloudId]) => cloudId);
    if (binding) {
      const boundCandidates = byUuid.get(boundUuid) || [];
      if (boundCandidates.length > 1) { codes.push(`${family}:binding_ambiguous_candidate`); return; }
      if (boundCandidates.length === 1) {
        const cloudId = boundCandidates[0];
        if (!sameFamilyIdentity(family, localRow, cloudMap.map.get(cloudId))) { codes.push(`${family}:binding_conflict`); return; }
        pairs.set(localId, cloudId); return;
      }
      if (exactCandidates.length !== 1) { codes.push(`${family}:${exactCandidates.length ? "binding_ambiguous_candidate" : "binding_missing_cloud_row"}`); return; }
      const cloudId = exactCandidates[0]; const cloudUuid = asText(cloudUuids[cloudId]);
      if (!cloudUuid) { codes.push(`${family}:binding_missing_cloud_row`); return; }
      pairs.set(localId, cloudId);
      entries.push({ entityType, localLegacyId: localId, cloudUuid, companyId, source: "cloud_convergence", reconciliation: true });
      return;
    }
    if (directCloud) {
      pairs.set(localId, localId);
      if ((bootstrap ? cloudSyncEqual(stableRelationshipIdentity(family, localRow), stableRelationshipIdentity(family, directCloud)) : sameFamilyEntity(family, localRow, directCloud)) && asText(cloudUuids[localId])) entries.push({ entityType, localLegacyId: localId, cloudUuid: asText(cloudUuids[localId]), companyId, source: "cloud_convergence" });
      return;
    }
    if (exactCandidates.length > 1) { codes.push(`${family}:binding_ambiguous_candidate`); return; }
    if (exactCandidates.length === 1) {
      const cloudId = exactCandidates[0]; const cloudUuid = asText(cloudUuids[cloudId]);
      if (!cloudUuid) { codes.push(`${family}:binding_missing_cloud_row`); return; }
      pairs.set(localId, cloudId);
      entries.push({ entityType, localLegacyId: localId, cloudUuid, companyId, source: "cloud_convergence" });
    }
  });
  const pairedCloudIds = new Set();
  pairs.forEach((cloudId) => {
    if (pairedCloudIds.has(cloudId)) codes.push(`${family}:binding_uuid_reused`);
    pairedCloudIds.add(cloudId);
  });
  return { pairs, entries, codes: [...new Set(codes)] };
}

function paymentBindingResolution({ localInvoices, cloudInvoices, cloudSnapshot, bindings, companyId, bootstrap = false }) {
  const table = bindings.bindings?.invoice_payment || {}; const cloudUuids = cloudSnapshot?.uuidMaps?.invoicePayments || {};
  const codes = []; const entries = []; const uuidOwners = new Map();
  Object.entries(table).forEach(([legacyId, binding]) => { const uuid = asText(binding?.cloudUuid); if (!uuid) return; const owners = uuidOwners.get(uuid) || []; owners.push(legacyId); uuidOwners.set(uuid, owners); });
  [...uuidOwners.values()].forEach((owners) => { if (owners.length > 1) codes.push("invoice_payments:binding_uuid_reused"); });
  const cloudPaymentById = new Map(asArray(cloudInvoices).flatMap((invoice) => asArray(invoice?.payments).map((payment) => [entityId(payment), payment])));
  const localPaymentById = new Map(asArray(localInvoices).flatMap((invoice) => asArray(invoice?.payments).map((payment) => [entityId(payment), payment])));
  localPaymentById.forEach((payment, paymentId) => {
    const cloudPayment = cloudPaymentById.get(paymentId); const binding = table[paymentId]; const cloudUuid = asText(cloudUuids[paymentId]);
    if (binding && cloudPayment && cloudUuid && asText(binding.cloudUuid) !== cloudUuid) { codes.push("invoice_payments:binding_conflict"); return; }
    if (!binding && cloudPayment && cloudUuid && (bootstrap || cloudSyncEqual(payment, cloudPayment))) entries.push({ entityType: "invoice_payment", localLegacyId: paymentId, cloudUuid, companyId, source: "cloud_convergence" });
  });
  return { codes: [...new Set(codes)], entries };
}

function operationForFamily(family, local, cloud, baseline, plan, bindingPairs = null, bootstrap = false) {
  const localMap = mapById(local); const cloudMap = mapById(cloud); const baselineMap = mapById(baseline);
  if (localMap.duplicateIds.length || cloudMap.duplicateIds.length || baselineMap.duplicateIds.length) {
    plan.conflicts.push({ family, code: "duplicate_identity", count: 1 }); return;
  }
  const pairedCloudIds = new Set(bindingPairs ? [...bindingPairs.values()] : []);
  const ids = new Set([...localMap.map.keys(), ...cloudMap.map.keys(), ...baselineMap.map.keys()]);
  ids.forEach((id) => {
    const cloudId = bindingPairs?.get(id) || id;
    if (!localMap.map.has(id) && pairedCloudIds.has(id)) return;
    const localRow = localMap.map.has(id) ? localMap.map.get(id) : null;
    const cloudRow = cloudMap.map.has(cloudId) ? cloudMap.map.get(cloudId) : null;
    const baselineRow = baselineMap.map.has(id) ? baselineMap.map.get(id) : (baselineMap.map.has(cloudId) ? baselineMap.map.get(cloudId) : null);
    let classification = classifyCloudConvergenceEntity({ local: normalizeFamilyEntityForId(family, localRow, id), cloud: normalizeFamilyEntityForId(family, cloudRow, id), baseline: normalizeFamilyEntityForId(family, baselineRow, id) });
    if (family === "projects" && baselineRow && localRow && cloudRow) {
      const baseCustomerId = normalizeProjectContract(baselineRow).customerId;
      if (normalizeProjectContract(localRow).customerId !== baseCustomerId || normalizeProjectContract(cloudRow).customerId !== baseCustomerId) {
        plan.conflicts.push({ family, id, code: "project_customer_relationship" }); return;
      }
    }
    const classificationEntry = { family, id, classification }; plan.classifications.push(classificationEntry);
    if (bootstrap && localRow && cloudRow) {
      if (!cloudSyncEqual(stableRelationshipIdentity(family, localRow), stableRelationshipIdentity(family, cloudRow))) {
        plan.conflicts.push({ family, id, code: "baseline_bootstrap_relationship_conflict" });
      } else if (!sameFamilyEntity(family, localRow, cloudRow)) {
        plan.replacements[family].push(clone(cloudRow));
      }
    } else if (classification === "cloud_only_addition") plan.additions[family].push(clone(cloudRow));
    else if (classification === "local_only_addition" || classification === "local_changed") plan.localOnly = true;
    else if (classification === "cloud_changed") plan.replacements[family].push(clone(cloudRow));
    else if (classification === "both_changed_conflict") {
      const merged = mergeNonOverlappingCloudMetadata({ baseline: baselineRow, local: localRow, cloud: cloudRow, family });
      if (merged) { classificationEntry.classification = "both_changed_non_overlapping"; plan.replacements[family].push(merged); }
      else plan.conflicts.push({ family, id, code: classification });
    } else if (["both_added_different", "local_missing_since_baseline", "cloud_missing_since_baseline"].includes(classification)) {
      plan.conflicts.push({ family, id, code: classification });
    }
  });
}

function isSupplementalRecord(value) { return value != null && typeof value === "object" && !Array.isArray(value); }
function supplementalValue(value) { return isSupplementalRecord(value) && Object.keys(value).length === 0 ? null : value || null; }
function planSupplemental(local, cloud, baseline, plan) {
  ["companyProfile", "settings"].forEach((family) => {
    const localValue = supplementalValue(local[family]); const cloudValue = supplementalValue(cloud[family]); const base = supplementalValue(baseline?.[family]);
    if (cloudValue && !isSupplementalRecord(cloudValue)) { plan.conflicts.push({ family, id: family, code: "malformed_supplemental_record" }); return; }
    const classification = classifyCloudConvergenceEntity({ local: localValue, cloud: cloudValue, baseline: base });
    plan.classifications.push({ family, id: family, classification });
    if (!localValue && cloudValue) plan.supplemental[family] = clone(cloudValue);
    else if (classification === "cloud_changed") plan.supplemental[family] = clone(cloudValue);
    else if (classification === "local_changed" || classification === "local_only_addition") plan.localOnly = true;
    else if (classification === "both_changed_conflict") {
      plan.conflicts.push({ family, id: family, code: classification });
    } else if (["both_added_different", "local_missing_since_baseline", "cloud_missing_since_baseline"].includes(classification)) plan.conflicts.push({ family, id: family, code: classification });
  });
  const localTemplates = asArray(local.scopeTemplates); const cloudTemplates = asArray(cloud.scopeTemplates); const baseTemplates = asArray(baseline?.scopeTemplates);
  operationForFamily("scopeTemplates", localTemplates, cloudTemplates, baseTemplates, plan, null, plan.bootstrap);
}

function invoicesWithMatchedLegacyEstimateNumbers(snapshot = {}, cloudInvoices = []) {
  const estimatesById = new Map(asArray(snapshot.estimates).map((estimate) => [entityId(estimate), estimate]));
  const cloudById = new Map(asArray(cloudInvoices).map((invoice) => [entityId(invoice), invoice]));
  const invoices = asArray(snapshot.invoices).map((invoice) => {
    if (asText(invoice?.estimateNumber)) return invoice;
    const cloudInvoice = cloudById.get(entityId(invoice));
    const cloudEstimateNumber = asText(cloudInvoice?.estimateNumber);
    if (!cloudEstimateNumber) return invoice;
    const linkedEstimate = estimatesById.get(asText(invoice?.sourceEstimateId || invoice?.sourceEstimateLegacyId));
    const estimateNumber = linkedEstimate ? asText(buildPersistedEstimateContract(mapLocalEstimateToBackendEstimate(linkedEstimate, {})).estimate_number) : "";
    return estimateNumber === cloudEstimateNumber ? { ...invoice, estimateNumber } : invoice;
  });
  return { ...snapshot, invoices };
}

export function buildCloudConvergencePlan({ local = {}, cloud = {}, baseline = null, cloudSnapshot = null, companyId = "", storage } = {}) {
  const plan = {
    version: CLOUD_CONVERGENCE_VERSION, safe: false, classifications: [], conflicts: [], additions: { customers: [], projects: [], estimates: [], invoices: [], scopeTemplates: [] },
    replacements: { customers: [], projects: [], estimates: [], invoices: [], scopeTemplates: [] }, supplemental: {}, localOnly: false, codes: [], bindingEntries: [], bootstrap: false, bootstrapReason: "", bootstrapProof: null,
  };
  // Keep all ordinary three-way/no-baseline behavior intact unless this exact
  // storage-backed proof passes. The proof itself does no writes.
  const bootstrapProof = !baseline ? buildCleanReplicaBootstrapProof({ storage, companyId, local, cloud, cloudSnapshot, baseline }) : null;
  if (bootstrapProof?.ok) { plan.bootstrap = true; plan.bootstrapReason = bootstrapProof.bootstrapReason; }
  plan.bootstrapProof = bootstrapProof;
  // An already-local converted invoice may legitimately point at the
  // cloud-only estimate being added in this atomic plan. Final graph
  // validation below still rejects it unless that estimate is actually safe.
  const graphCodes = [...relationshipCodes(local).filter((code) => code !== "invoice_estimate_relationship"), ...relationshipCodes(cloud)];
  if (graphCodes.length) { plan.conflicts.push(...[...new Set(graphCodes)].map((code) => ({ family: "relationships", code }))); return plan; }
  const bindings = readCloudAssetBindings(companyId, storage);
  const customerBindings = cloudSnapshot?.uuidMaps ? bindingResolutionForFamily({ family: "customers", local: asArray(local.customers), cloud: asArray(cloud.customers), cloudSnapshot, bindings, companyId, bootstrap: plan.bootstrap }) : null;
  const localCustomerIdByCloudId = new Map(customerBindings ? [...customerBindings.pairs.entries()].map(([localId, cloudId]) => [cloudId, localId]) : []);
  const cloudProjects = asArray(cloud.projects).map((project) => localCustomerIdByCloudId.has(asText(project?.customerId))
    ? { ...project, customerId: localCustomerIdByCloudId.get(asText(project.customerId)) }
    : project);
  const projectBindings = cloudSnapshot?.uuidMaps ? bindingResolutionForFamily({ family: "projects", local: asArray(local.projects), cloud: cloudProjects, cloudSnapshot, bindings, companyId, bootstrap: plan.bootstrap }) : null;
  const localProjectIdByCloudId = new Map(projectBindings ? [...projectBindings.pairs.entries()].map(([localId, cloudId]) => [cloudId, localId]) : []);
  const cloudEstimates = asArray(cloud.estimates).map((estimate) => ({ ...estimate,
    ...(localCustomerIdByCloudId.has(asText(estimate?.customerId)) ? { customerId: localCustomerIdByCloudId.get(asText(estimate.customerId)) } : {}),
    ...(localProjectIdByCloudId.has(asText(estimate?.projectId)) ? { projectId: localProjectIdByCloudId.get(asText(estimate.projectId)) } : {}),
  }));
  const estimateBindings = cloudSnapshot?.uuidMaps ? bindingResolutionForFamily({ family: "estimates", local: asArray(local.estimates), cloud: cloudEstimates, cloudSnapshot, bindings, companyId, bootstrap: plan.bootstrap }) : null;
  const localEstimateIdByCloudId = new Map(estimateBindings ? [...estimateBindings.pairs.entries()].map(([localId, cloudId]) => [cloudId, localId]) : []);
  const cloudInvoices = asArray(cloud.invoices).map((invoice) => ({ ...invoice,
    ...(localCustomerIdByCloudId.has(asText(invoice?.customerId)) ? { customerId: localCustomerIdByCloudId.get(asText(invoice.customerId)) } : {}),
    ...(localProjectIdByCloudId.has(asText(invoice?.projectId)) ? { projectId: localProjectIdByCloudId.get(asText(invoice.projectId)) } : {}),
    ...(localEstimateIdByCloudId.has(asText(invoice?.sourceEstimateId)) ? { sourceEstimateId: localEstimateIdByCloudId.get(asText(invoice.sourceEstimateId)) } : {}),
  }));
  const localForInvoiceComparison = invoicesWithMatchedLegacyEstimateNumbers(local, cloudInvoices);
  const baselineForInvoiceComparison = baseline ? invoicesWithMatchedLegacyEstimateNumbers(baseline, cloudInvoices) : null;
  const invoiceBindings = cloudSnapshot?.uuidMaps ? bindingResolutionForFamily({ family: "invoices", local: asArray(localForInvoiceComparison.invoices), cloud: cloudInvoices, cloudSnapshot, bindings, companyId, bootstrap: plan.bootstrap }) : null;
  const paymentBindings = cloudSnapshot?.uuidMaps ? paymentBindingResolution({ localInvoices: asArray(localForInvoiceComparison.invoices), cloudInvoices, cloudSnapshot, bindings, companyId, bootstrap: plan.bootstrap }) : null;
  const bindingCodes = [...(customerBindings?.codes || []), ...(projectBindings?.codes || []), ...(estimateBindings?.codes || []), ...(invoiceBindings?.codes || []), ...(paymentBindings?.codes || [])];
  if (bindingCodes.length) { plan.conflicts.push(...bindingCodes.map((code) => ({ family: "bindings", code: plan.bootstrap ? "baseline_bootstrap_binding_conflict" : code }))); return plan; }
  if (customerBindings || projectBindings || estimateBindings || invoiceBindings || paymentBindings) plan.bindingEntries.push(...(customerBindings?.entries || []), ...(projectBindings?.entries || []), ...(estimateBindings?.entries || []), ...(invoiceBindings?.entries || []), ...(paymentBindings?.entries || []));
  operationForFamily("customers", asArray(local.customers), asArray(cloud.customers), asArray(baseline?.customers), plan, customerBindings?.pairs, plan.bootstrap);
  operationForFamily("projects", asArray(local.projects), cloudProjects, asArray(baseline?.projects), plan, projectBindings?.pairs, plan.bootstrap);
  operationForFamily("estimates", asArray(local.estimates), cloudEstimates, asArray(baseline?.estimates), plan, estimateBindings?.pairs, plan.bootstrap);
  operationForFamily("invoices", asArray(localForInvoiceComparison.invoices), cloudInvoices, asArray(baselineForInvoiceComparison?.invoices), plan, invoiceBindings?.pairs, plan.bootstrap);
  // Additions and replacements must always prove restore-payload + child evidence.
  [...(plan.additions.estimates || []), ...(plan.replacements.estimates || [])].forEach((estimate) => {
    const code = estimateEvidenceCode(estimate, cloudSnapshot?.estimateEvidence?.[entityId(estimate)]);
    if (code) plan.conflicts.push({ family: "estimates", id: entityId(estimate), code });
  });
  // A matched estimate header can still hide diverged, duplicated, or missing
  // cloud child rows, so every OTHER cloud estimate that participates in the
  // final graph is proven too -- not just additions/replacements. Gated on the
  // evidence map being present (production always provides it) so evidence-
  // agnostic planner unit cases are unaffected.
  if (cloudSnapshot?.estimateEvidence) {
    const alreadyChecked = new Set([...(plan.additions.estimates || []), ...(plan.replacements.estimates || [])].map((estimate) => entityId(estimate)));
    const conflictedEstimateIds = new Set(plan.conflicts.filter((conflict) => conflict.family === "estimates" && conflict.id).map((conflict) => conflict.id));
    asArray(cloudEstimates).forEach((estimate) => {
      const id = entityId(estimate);
      if (!id || alreadyChecked.has(id) || conflictedEstimateIds.has(id)) return;
      const code = estimateEvidenceCode(estimate, cloudSnapshot.estimateEvidence[id]);
      if (code) { plan.conflicts.push({ family: "estimates", id, code }); conflictedEstimateIds.add(id); }
    });
  }
  planSupplemental(local, cloud, baseline, plan);
  if (plan.bootstrap && plan.conflicts.some((conflict) => conflict.code === "both_added_different")) {
    // Bootstrap applies to business arrays only; supplemental records retain
    // their usual conflict protection instead of being silently overwritten.
    plan.conflicts = plan.conflicts.map((conflict) => conflict.code === "both_added_different"
      ? { ...conflict, code: "baseline_bootstrap_relationship_conflict" }
      : conflict);
  }
  const planned = { ...local, customers: applyFamilyPlan(local.customers, plan, "customers"), projects: applyFamilyPlan(local.projects, plan, "projects"), estimates: applyFamilyPlan(local.estimates, plan, "estimates"), invoices: applyFamilyPlan(local.invoices, plan, "invoices") };
  const finalRelationshipCodes = relationshipCodes(planned);
  if (finalRelationshipCodes.length) plan.conflicts.push(...finalRelationshipCodes.map((code) => ({ family: "relationships", code })));
  if (cloudSnapshot?.supplemental?.status === "error" || cloudSnapshot?.supplemental?.status === "invalid") plan.codes.push("supplemental_skipped");
  plan.safe = plan.conflicts.length === 0;
  return plan;
}

function applyFamilyPlan(rows, plan, family) {
  const replacementMap = new Map((plan.replacements[family] || []).map((row) => [entityId(row), row]));
  return asArray(rows).map((row) => replacementMap.get(entityId(row)) || row).concat(plan.additions[family] || []);
}

// Which local families a converged plan actually wrote, so the caller dispatches
// change events only for those (never for unchanged families).
function convergenceChangedFamilies(writes, plan) {
  return {
    customers: Boolean(writes[FAMILY_KEYS.customers]),
    projects: Boolean(writes[FAMILY_KEYS.projects]),
    estimates: Boolean(writes[FAMILY_KEYS.estimates]),
    invoices: Boolean(writes[FAMILY_KEYS.invoices]),
    scopeTemplates: Boolean(writes[FAMILY_KEYS.scopeTemplates]),
    companyProfile: Boolean(plan?.supplemental?.companyProfile),
    settings: Boolean(plan?.supplemental?.settings),
  };
}

function plannedStorageWrites(local, plan) {
  const writes = {};
  ["customers", "projects", "estimates", "invoices", "scopeTemplates"].forEach((family) => {
    const additions = plan.additions[family] || []; const replacements = plan.replacements[family] || [];
    if (!additions.length && !replacements.length) return;
    const current = asArray(local[family]); const replacementMap = new Map(replacements.map((row) => [entityId(row), row]));
    const next = current.map((row) => replacementMap.get(entityId(row)) || row).concat(additions.slice().sort((a, b) => entityId(a).localeCompare(entityId(b))));
    writes[FAMILY_KEYS[family]] = JSON.stringify(next);
  });
  if (plan.supplemental.companyProfile) writes[STORAGE_KEYS.COMPANY_PROFILE] = JSON.stringify(plan.supplemental.companyProfile);
  if (plan.supplemental.settings) writes[STORAGE_KEYS.SETTINGS] = JSON.stringify(plan.supplemental.settings);
  return writes;
}

function buildConvergenceLocalOnlyMutations({ plan, snapshot, companyId }) {
  const entityByFamily = {
    customers: CLOUD_MUTATION_ENTITY.CUSTOMER,
    projects: CLOUD_MUTATION_ENTITY.PROJECT,
    estimates: CLOUD_MUTATION_ENTITY.ESTIMATE,
    invoices: CLOUD_MUTATION_ENTITY.INVOICE,
  };
  const mutations = [];
  let appBundleChanged = false;
  asArray(plan?.classifications).forEach((entry) => {
    if (!["local_only_addition", "local_changed"].includes(entry?.classification)) return;
    if (["companyProfile", "settings", "scopeTemplates"].includes(entry?.family)) {
      appBundleChanged = true;
      return;
    }
    const entityType = entityByFamily[entry?.family];
    if (!entityType) return;
    const record = asArray(snapshot?.[entry.family]).find((candidate) => entityId(candidate) === asText(entry?.id));
    if (!record) return;
    mutations.push({
      companyId,
      entityType,
      documentId: asText(entry.id),
      operation: CLOUD_MUTATION_OPERATION.UPSERT,
      reason: "cloud_convergence_local_change",
      source: "runSupabaseCloudConvergence",
      payload: clone(record),
    });
  });
  if (appBundleChanged) {
    mutations.push(buildImmutableAppRestoreBundleMutation({
      companyId,
      reason: "cloud_convergence_local_app_bundle_change",
      source: "runSupabaseCloudConvergence",
    }));
  }
  return mutations;
}

function verifyLocalApply({ before, writes, storage, localBefore, plan, expectedQueueRevision }) {
  if (Number(queueRevision(storage)) !== Number(expectedQueueRevision)) return { ok: false, code: "queue_revision_changed" };
  if (!Object.entries(writes).every(([key, value]) => readRaw(storage, key) === value)) return { ok: false, code: "local_write_mismatch" };
  const after = localSnapshot(storage);
  if (relationshipCodes(after).length) return { ok: false, code: "relationship_verification_failed" };
  ["customers", "projects", "estimates", "invoices", "scopeTemplates"].forEach((family) => {
    const beforeRows = asArray(localBefore[family]); const afterRows = asArray(after[family]); const ids = afterRows.map(entityId);
    if (new Set(ids).size !== ids.length || ids.some((id) => !id)) return { ok: false, code: `duplicate_${family}` };
    const replacementIds = new Set((plan.replacements[family] || []).map(entityId));
    beforeRows.forEach((row) => {
      const afterRow = afterRows.find((candidate) => entityId(candidate) === entityId(row));
      if (!afterRow) return { ok: false, code: `missing_${family}` };
      if (!replacementIds.has(entityId(row)) && JSON.stringify(row) !== JSON.stringify(afterRow)) return { ok: false, code: `unexpected_${family}_change` };
    });
  });
  const protectedKeys = [STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT];
  if (protectedKeys.some((key) => before[key] !== readRaw(storage, key))) return { ok: false, code: "unexpected_vault_change" };
  return { ok: true };
}

function readJournal(storage) { try { const raw = readRaw(storage, JOURNAL_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; } }
function writeJournal(storage, journal) { const value = JSON.stringify(journal); return writeRaw(storage, JOURNAL_KEY, value); }
function journalRecoveryMismatchCode({ journal, storage, companyId, userId, deviceId }) {
  if (!asText(companyId) || !asText(userId) || !asText(deviceId)) return "journal_recovery_context_missing";
  if (!asText(journal?.companyId) || !asText(journal?.userId) || !asText(journal?.deviceId)) return "journal_identity_missing";
  if (asText(journal.companyId) !== asText(companyId)) return "journal_company_mismatch";
  if (asText(journal.userId) !== asText(userId)) return "journal_user_mismatch";
  if (asText(journal.deviceId) !== asText(deviceId)) return "journal_device_mismatch";
  if (!Number.isFinite(Number(journal?.queueRevision)) || queueRevision(storage) !== Number(journal.queueRevision)) return "journal_revision_mismatch";
  return "";
}

const RETIRABLE_JOURNAL_MISMATCH_CODES = new Set([
  "journal_company_mismatch",
  "journal_user_mismatch",
  "journal_device_mismatch",
  "journal_revision_mismatch",
]);

function retireInapplicableJournal({ storage, journal, companyId, userId, deviceId, code }) {
  // A conclusively stale journal cannot authorize rollback, but its complete
  // contents remain valuable recovery evidence. Archive it in the existing
  // conflict vault before releasing the active transaction slot.
  try {
    const current = JSON.parse(readRaw(storage, VAULT_KEY) || "{\"version\":1,\"companyId\":\"\",\"entries\":[]}");
    if (!current || typeof current !== "object" || Array.isArray(current)) return false;
    if (current.companyId && asText(current.companyId) !== asText(companyId)) return false;
    const key = stableCloudSyncHash({ journal, code });
    const retiredJournals = asArray(current.retiredJournals);
    if (!retiredJournals.some((candidate) => candidate?.key === key)) {
      retiredJournals.push({
        key,
        classificationCode: code,
        detectedAt: now(),
        journalVersion: journal?.version ?? null,
        attemptId: asText(journal?.attemptId),
        journalCompanyId: asText(journal?.companyId),
        journalUserId: asText(journal?.userId),
        journalDeviceId: asText(journal?.deviceId),
        journalQueueRevision: Number(journal?.queueRevision),
        currentCompanyId: asText(companyId),
        currentUserId: asText(userId),
        currentDeviceId: asText(deviceId),
        currentQueueRevision: queueRevision(storage),
        journal,
      });
    }
    const nextVault = {
      ...current,
      version: CLOUD_CONVERGENCE_VERSION,
      companyId: asText(companyId),
      entries: asArray(current.entries),
      retiredJournals,
    };
    if (!writeRaw(storage, VAULT_KEY, JSON.stringify(nextVault))) return false;
    const persistedVault = JSON.parse(readRaw(storage, VAULT_KEY) || "{}");
    if (!asArray(persistedVault?.retiredJournals).some((candidate) => candidate?.key === key && candidate?.journal && candidate?.classificationCode === code)) return false;
    storage.removeItem(JOURNAL_KEY);
    return readRaw(storage, JOURNAL_KEY) === null;
  } catch {
    return false;
  }
}

export function recoverInterruptedCloudConvergence({ storage = localStorage, companyId = "", userId = "", deviceId = "" } = {}) {
  const journal = readJournal(storage);
  if (!journal) return { ok: true, recovered: false };
  const mismatchCode = journalRecoveryMismatchCode({ journal, storage, companyId, userId, deviceId });
  // Only an identity or queue-revision mismatch proves this record cannot be
  // the current rollback transaction. Ambiguous/malformed journals remain
  // active and blocking rather than being guessed away.
  if (mismatchCode) {
    if (!RETIRABLE_JOURNAL_MISMATCH_CODES.has(mismatchCode)) return { ok: false, recovered: false, code: mismatchCode };
    const retired = retireInapplicableJournal({ storage, journal, companyId, userId, deviceId, code: mismatchCode });
    return retired
      ? { ok: true, recovered: false, retired: true, code: mismatchCode }
      : { ok: false, recovered: false, code: "journal_retirement_failed" };
  }
  try {
    Object.entries(journal.previous || {}).forEach(([key, value]) => { if (value === null) storage.removeItem(key); else storage.setItem(key, value); });
    const valid = Object.entries(journal.previous || {}).every(([key, value]) => readRaw(storage, key) === value);
    if (!valid) return { ok: false, code: "journal_rollback_failed" };
    storage.removeItem(JOURNAL_KEY);
    return { ok: true, recovered: true };
  } catch { return { ok: false, code: "journal_rollback_failed" }; }
}

function familySnapshotForVault(snapshot, family, id) {
  if (!id || !snapshot) return null;
  if (["companyProfile", "settings"].includes(family)) return isSupplementalRecord(snapshot[family]) ? clone(snapshot[family]) : null;
  if (!["customers", "projects", "estimates", "invoices", "scopeTemplates"].includes(family)) return null;
  return normalizeFamilyEntity(family, asArray(snapshot[family]).find((row) => entityId(row) === id) || null);
}
function conflictVaultEntry({ companyId, conflict, baseline, local, cloud, cloudSnapshot, attemptId }) {
  const family = conflict.family; const id = asText(conflict.id);
  const baselineSnapshot = familySnapshotForVault(baseline, family, id);
  const localSnapshot = familySnapshotForVault(local, family, id);
  const cloudSnapshotValue = familySnapshotForVault(cloud, family, id);
  const cloudUuid = asText(cloudSnapshot?.uuidMaps?.[family]?.[id]);
  const evidence = { family, id, code: conflict.code, baselineSnapshot, localSnapshot, cloudSnapshot: cloudSnapshotValue, cloudUuid };
  return {
    key: `${companyId}:${family}:${id || asText(conflict.code)}:${stableCloudSyncHash(evidence)}`,
    entityFamily: family, stableIdentity: id || asText(conflict.code), classificationCode: asText(conflict.code),
    baselineSnapshot, baselineHash: stableCloudSyncHash(baselineSnapshot), localSnapshot, cloudSnapshot: cloudSnapshotValue,
    cloudUuid: cloudUuid || null, attemptId, detectedAt: now(),
  };
}
function recordConflicts({ storage, companyId, plan, baseline, local, cloud, cloudSnapshot, attemptId }) {
  if (!plan.conflicts.length) return true;
  try {
    const current = JSON.parse(readRaw(storage, VAULT_KEY) || "{\"version\":1,\"companyId\":\"\",\"entries\":[]}");
    if (current.companyId && asText(current.companyId) !== companyId) return false;
    const entries = asArray(current.entries);
    plan.conflicts.forEach((conflict) => {
      if (!["customers", "projects", "estimates", "invoices", "scopeTemplates", "companyProfile", "settings"].includes(conflict.family) || !conflict.id) return;
      const entry = conflictVaultEntry({ companyId, conflict, baseline, local, cloud, cloudSnapshot, attemptId });
      if (!entries.some((candidate) => candidate.key === entry.key)) entries.push(entry);
    });
    // Conflict recording is additive: preserve existing recovery evidence and
    // any future vault metadata while replacing only the de-duplicated entries.
    return writeRaw(storage, VAULT_KEY, JSON.stringify({
      ...current,
      version: CLOUD_CONVERGENCE_VERSION,
      companyId,
      entries,
    }));
  } catch { return false; }
}

// Gate 16G: a device carrying a released legacy queue and/or the self-inflicted
// takeover pause can never reach a verified state on its own. Recover that
// metadata -- and ONLY that metadata -- after proving this browser really is the
// active device. Scoped to the bootstrap situation (no baseline yet) so an
// ordinary three-way run never touches the device lock or the queue.
async function recoverCloudSyncMetadata({ storage, configured, user, company, companyId, deviceAccess }) {
  const stage = { attempted: false, queueSchemaBefore: "", queueSchemaAfter: "", queueMigrated: false, pauseReason: "", pauseRecovered: false, code: "", stageName: "not_required" };
  if (readCloudSyncBaseline(companyId, storage)) return stage;
  const queueRaw = readRaw(storage, STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
  const pauseRaw = readRaw(storage, STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE);
  const queueRead = readPersistedCloudBackupQueueState(storage);
  const legacyQueuePresent = Boolean(queueRaw) && !queueRead.ok;
  const takeoverPausePresent = Boolean(pauseRaw) && pauseDetailCode(pauseRaw) === "baseline_bootstrap_pause_stale_takeover";
  if (!legacyQueuePresent && !takeoverPausePresent) return stage;

  stage.attempted = true;
  stage.stageName = "device_verification";
  // Real ownership proof first: nothing below may run on a device that is not
  // demonstrably the active one.
  const access = deviceAccess || await ensureCurrentDeviceCanApplyLocalRestore({ configured, user, company, storage, reason: "cloud_sync_metadata_recovery" });
  if (!access?.ok) { stage.code = "metadata_device_unverified"; return stage; }
  const activeDeviceId = asText(access.access?.activeDeviceState?.activeDeviceId) || getOrCreateLocalDeviceId(storage);

  if (legacyQueuePresent) {
    stage.stageName = "queue_migration";
    const migration = migrateLegacyPersistedCloudBackupQueue({ storage, companyId, activeDeviceId, deviceAccess: access });
    stage.queueSchemaBefore = asText(migration.schemaBefore);
    stage.queueSchemaAfter = asText(migration.schemaAfter);
    stage.queueMigrated = Boolean(migration.migrated);
    if (!migration.ok) { stage.code = asText(migration.code); return stage; }
  }
  if (takeoverPausePresent) {
    stage.stageName = "pause_recovery";
    const recovery = recoverVerifiedActiveDeviceTakeoverPause({ storage, companyId, activeDeviceId, deviceAccess: access });
    stage.pauseReason = asText(recovery.pauseReason);
    stage.pauseRecovered = Boolean(recovery.recovered);
    if (!recovery.ok) { stage.code = asText(recovery.code); return stage; }
  }
  stage.stageName = "completed";
  return stage;
}

export async function runSupabaseCloudConvergence(options = {}) {
  const storage = options.storage || localStorage;
  if (options.reconcileHistoricalResidueOnly === true) {
    return runVerifiedHistoricalWorkspaceRemediation({ ...options, storage });
  }
  // Metadata recovery participates in the convergence attempt's rollback: any
  // outcome short of verified success puts the queue and pause back byte-for-
  // byte, so a device is never left half-migrated or prematurely resumed.
  const preMetadata = metadataValues(storage);
  const result = await runCloudConvergenceAttempt({ ...options, storage });
  if (!result?.ok && metadataChanged(storage, preMetadata)) restoreMetadata(storage, preMetadata);
  return result;
}

// The audit writer persists a versioned envelope; legacy device import also
// stores bare arrays. The general export artifact only recognizes arrays. Give
// its existing parser/verifier a read-only array view for this ONE known format.
// Do not call readStoredAuditEvents/trimAuditEvents: those filter, dedupe, sort
// and enforce retention, which would lose evidence needed for this proof.
function historicalAuditStorageSnapshot(storage) {
  const raw = storage.getItem(STORAGE_KEYS.AUDIT_EVENTS);
  if (raw == null) return storage;
  let value;
  try { value = JSON.parse(raw); } catch { return storage; } // Existing artifact reports invalid JSON.
  const envelope = value && !Array.isArray(value) && typeof value === "object"
    && value.schemaVersion === AUDIT_STORE_SCHEMA_VERSION && Array.isArray(value.events)
    && typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt) && value.updatedAt > 0
    && Object.keys(value).every(key => ["schemaVersion", "events", "updatedAt"].includes(key));
  const events = Array.isArray(value) ? value : envelope ? value.events : null;
  if (!events) return storage; // Unknown envelopes/scalars remain unsupported.
  const ids = new Set();
  if (!events.every(event => {
    if (!event || typeof event !== "object" || Array.isArray(event)
      || typeof event.id !== "string" || typeof event.type !== "string") return false;
    const normalized = normalizeAuditEvent(event);
    if (!normalized.id || !normalized.type || !(normalized.createdAt > 0) || ids.has(normalized.id)) return false;
    // Versioned writer output is already canonical. Refuse an envelope whose
    // events the normalizer would alter or drop fields from; no implicit repair.
    const fields = Object.keys(normalized).sort();
    if (envelope && (Object.keys(event).length !== fields.length
      || JSON.stringify(fields.map(key => event[key])) !== JSON.stringify(fields.map(key => normalized[key])))) return false;
    ids.add(normalized.id);
    return true;
  })) return null;
  if (!envelope) return storage;
  const arrayView = JSON.stringify(events);
  return Object.freeze({ getItem: key => key === STORAGE_KEYS.AUDIT_EVENTS ? arrayView : storage.getItem(key) });
}

// These reads never normalize/migrate persisted state. Eligibility only permits
// a NEW read-only comparison; neither a cached UI verdict nor the global ledger
// high-water mark can authorize the retirement transaction below.
function historicalWorkspaceResidue(storage, companyId, startedAt, reject = () => null) {
  const ledger = JSON.parse(storage.getItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER));
  const queue = JSON.parse(storage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE));
  if (!Array.isArray(ledger?.entries) || normalizeCloudMutationLedger(ledger).entries.length !== ledger.entries.length) return reject("invalid_mutation_ledger");
  const candidates = getHistoricalWorkspaceBaselineCandidates(ledger, { companyId, before: startedAt });
  const active = ledger.entries.filter(isActiveCloudMutation);
  if (active.length !== candidates.length || (!active.length && !isLegacyCompatibilityQueue(queue))) return reject("active_work_not_historical");
  if (!isInactiveWorkspaceBaselineQueue(queue, { companyId, before: startedAt })) return reject("queue_not_inactive");
  if (storage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)) return reject("convergence_journal_present");
  if (storage.getItem(STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE)) return reject("cloud_auto_backup_pause_present");
  const partialRecovery = storage.getItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS);
  if (partialRecovery != null && partialRecovery !== "" && partialRecovery !== "null") return reject("partial_recovery_status_present");
  const verificationStorage = historicalAuditStorageSnapshot(storage);
  if (!verificationStorage) return reject("workspace_artifact_unsupported_shape", "audit_events");
  const { snapshot, artifact } = buildLocalSnapshotFromStorage(verificationStorage);
  if (!CORE_BUSINESS_FAMILIES.every(family => Array.isArray(snapshot[family]))) return reject("invalid_core_business_snapshot");
  if (!CORE_BUSINESS_FAMILIES.some(family => snapshot[family].length > 0)) return reject("empty_core_business_snapshot");
  const warning = artifact.parseWarnings.find(warning => warning.severity === "error" || warning.code.startsWith("unsupported_shape:"));
  if (warning) {
    // Only a fixed record-family enum may leave this read-only classifier.
    // Export-artifact warnings also cover audit events, separately from the
    // integrity scanner; never expose a warning's text or stored value.
    const family = ["CUSTOMERS", "PROJECTS", "ESTIMATES", "INVOICES", "COMPANY_PROFILE", "SETTINGS", "SCOPE_TEMPLATES", "AUDIT_EVENTS"]
      .find(name => STORAGE_KEYS[name] === warning.key)?.toLowerCase() || "unavailable";
    return reject(warning.severity === "error" ? "workspace_artifact_parse_error" : "workspace_artifact_unsupported_shape", family);
  }
  if (scanLocalDataIntegrity(snapshot).blockers.length > 0) return reject("local_integrity_blocker");
  return { ledger, queue, candidates, snapshot, verificationStorage };
}

// Shares every predicate with the real proof owner. No writes, normalization
// persistence, verification, payloads or identities are returned to diagnostics.
export function getHistoricalWorkspaceBaselineEligibility({ storage = localStorage, companyId = "" } = {}) {
  if (!companyId) return { eligible: false, code: "company_identity_missing", family: "none" };
  try {
    let rejection = { eligible: false, code: "historical_workspace_read_failed", family: "none" };
    const residue = historicalWorkspaceResidue(storage, companyId, Date.now(), (code, family = "none") => {
      rejection = { eligible: false, code, family };
      return null;
    });
    return residue ? { eligible: true, code: "eligible", family: "none" } : rejection;
  } catch { return { eligible: false, code: "historical_workspace_read_failed", family: "none" }; }
}

export function canVerifyHistoricalWorkspaceResidue(options = {}) {
  return getHistoricalWorkspaceBaselineEligibility(options).eligible;
}

// Prove the ORIGINAL mutation's named relationships, not the verifier's nullable
// FK projection. No missing parent may turn into an acceptable null, and no
// different current relationship may silently supersede the requested one.
function historicalMutationParentsMatch(entry, local, cloud, companyId) {
  const family = entry.entityType === CLOUD_MUTATION_ENTITY.ESTIMATE ? "estimates" : "invoices";
  const mapper = family === "estimates" ? mapLocalEstimateToBackendEstimate : mapLocalInvoiceToBackendInvoice;
  const current = asArray(local[family]).filter(row => entityId(row) === entry.documentId);
  const targets = asArray(cloud.raw?.[family]).filter(row => asText(row.legacy_local_id) === entry.documentId && asText(row.company_id) === companyId);
  if (current.length !== 1 || targets.length !== 1) return false;
  const intended = mapper(entry.payload, {}), canonical = mapper(current[0], {}), target = targets[0];
  const parents = [["customers", "customer_legacy_local_id", "customer_id"], ["projects", "project_legacy_local_id", "project_id"]];
  if (family === "invoices") {
    if (!asText(intended.source_estimate_legacy_local_id)) return false;
    parents.push(["estimates", "source_estimate_legacy_local_id", "estimate_id"]);
    if (asText(target.source_estimate_legacy_id) !== asText(intended.source_estimate_legacy_local_id)) return false;
  } else if (entry.lastErrorCode === "projects_parent_missing" && !asText(intended.project_legacy_local_id)) return false;
  return parents.every(([parentFamily, key, column]) => {
    const reference = asText(intended[key]);
    if (asText(canonical[key]) !== reference) return false;
    if (!reference) return !asText(target[column]);
    const localParents = asArray(local[parentFamily]).filter(row => entityId(row) === reference);
    const cloudParents = asArray(cloud.raw?.[parentFamily]).filter(row => asText(row.legacy_local_id) === reference && asText(row.company_id) === companyId);
    return localParents.length === 1 && cloudParents.length === 1 && asText(cloudParents[0].id)
      && asText(target[column]) === asText(cloudParents[0].id);
  });
}

function historicalPayloadMatchesCanonical(entry, local) {
  const family = entry.entityType === CLOUD_MUTATION_ENTITY.ESTIMATE ? "estimates" : "invoices";
  const current = asArray(local[family]).filter(row => entityId(row) === entry.documentId);
  return current.length === 1 && sameFamilyEntity(family, entry.payload, current[0]);
}

// No wholesale profile/template normalizer is safe here: those can discard
// fields, add defaults/identities, sort children, filter and deduplicate records.
// Only phone punctuation is ignored under normalizeCompanyProfile's existing
// digits contract, with an explicit guard against truncation or extensions.
function historicalProfilePhoneEquivalent(left, right) {
  const digits = value => {
    if (typeof value !== "string" || !/^[0-9+().\-\s]+$/.test(value)) return null;
    const raw = value.replace(/\D/g, "");
    return raw.length > 0 && raw.length <= 11 ? sanitizePhoneDigits(value, 11) : null;
  };
  if (!isSupplementalRecord(left) || !isSupplementalRecord(right)) return false;
  const phone = digits(left.phone);
  return phone !== null && phone === digits(right.phone)
    && cloudSyncEqual({ ...left, phone }, { ...right, phone });
}

function historicalTemplateIndex(records) {
  if (!Array.isArray(records) || records.some(row => !isSupplementalRecord(row)
    || typeof row.id !== "string" || !row.id.trim() || row.id !== row.id.trim())) return null;
  const indexed = mapById(records);
  return indexed.duplicateIds.length ? null : indexed.map;
}

// This reads the CURRENT source record without calling the template normalizer,
// which can synthesize ids/defaults. A failed read is never reported as missing.
export function readHistoricalTemplateCaptureStatus({ storage = localStorage } = {}) {
  let raw;
  try { raw = storage.getItem(STORAGE_KEYS.SCOPE_TEMPLATES); } catch { return "read_unavailable"; }
  if (raw == null) return "missing_source_storage";
  let value;
  try { value = JSON.parse(raw); } catch { return "malformed_stored_data"; }
  if (!Array.isArray(value)) return "unsupported_storage_shape";
  if (!historicalTemplateIndex(value)) return "unsupported_template_records";
  return value.length ? "captured_records" : "captured_empty";
}

function historicalTemplateCaptureProof(snapshot, storage) {
  let cloudStatus = "snapshot_unavailable";
  const supplemental = snapshot?.supplemental;
  if (snapshot?.ok) {
    if (supplemental?.status === "missing") cloudStatus = "bundle_missing";
    else if (supplemental?.status === "invalid") cloudStatus = "bundle_invalid";
    else if (supplemental?.status === "error") {
      const codes = asArray(supplemental.codes);
      cloudStatus = codes.includes("app_restore_bundle_read_failed") ? "bundle_read_unavailable"
        : codes.includes("app_restore_bundle_duplicate_rows") ? "bundle_selection_error" : "bundle_read_or_selection_error";
    } else if (supplemental?.status === "available") {
      const value = supplemental.bundle?.scopeTemplates;
      cloudStatus = value === null ? "uncaptured_null" : !Array.isArray(value) ? "unsupported_storage_shape"
        : !historicalTemplateIndex(value) ? "unsupported_template_records" : value.length ? "captured_records" : "captured_empty";
    }
  }
  // The existing writer stores the bundle, not its capture notices. It maps
  // missing, invalid JSON and unsupported source shapes to the SAME null. That
  // historical reason is irrecoverable from null; never infer [] or its origin.
  return { localStatus: readHistoricalTemplateCaptureStatus({ storage }), cloudStatus,
    historicalNullReason: cloudStatus === "uncaptured_null" ? "not_recorded_in_bundle" : "not_applicable" };
}

// readStoredScopeTemplates orders the library for display; normal convergence
// compares its complete records by stable id. Outer library order has no saved
// business meaning. Every record field and ALL inner array ordering stay strict.
function historicalTemplateCollectionEquivalent(left, right) {
  const local = historicalTemplateIndex(left), cloud = historicalTemplateIndex(right);
  return Boolean(local && cloud && local.size === cloud.size
    && [...local].every(([id, record]) => cloud.has(id) && cloudSyncEqual(record, cloud.get(id))));
}

// Independent classifications for BOTH families. Profile key candidates are
// scrubbed by safeHistoricalBundleProof before leaving this owner; arbitrary
// key names, identities, values and records never enter its public diagnostics.
function historicalPortableDifference(family, left, right) {
  const detail = Object.fromEntries(PORTABLE_DIFFERENCE_FLAGS.map(key => [key, false]));
  const canonicalLeft = normalizeCloudSyncValue(left), canonicalRight = normalizeCloudSyncValue(right);
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const matched = equal(canonicalLeft, canonicalRight);
  detail.serializationOnly = matched && !equal(left, right);
  if (family === "companyProfile") {
    const localFields = isSupplementalRecord(canonicalLeft) ? canonicalLeft : {};
    const cloudFields = isSupplementalRecord(canonicalRight) ? canonicalRight : {};
    detail.localOnlyFieldKeys = Object.keys(localFields).filter(key => !Object.prototype.hasOwnProperty.call(cloudFields, key));
    detail.cloudOnlyFieldKeys = Object.keys(cloudFields).filter(key => !Object.prototype.hasOwnProperty.call(localFields, key));
    detail.differingFieldKeys = Object.keys(localFields).filter(key => Object.prototype.hasOwnProperty.call(cloudFields, key)
      && !equal(localFields[key], cloudFields[key]));
    detail.unsupportedShape = [left, right].some(value => value != null && !isSupplementalRecord(value));
    detail.phoneFormattingEquivalent = !matched && historicalProfilePhoneEquivalent(left, right);
  } else {
    detail.unsupportedShape = [left, right].some(value => value != null && !Array.isArray(value));
    detail.identityIssue = [left, right].some(value => Array.isArray(value) && !historicalTemplateIndex(value));
    detail.unsupportedShape ||= detail.identityIssue;
    detail.collectionOrderEquivalent = !matched && historicalTemplateCollectionEquivalent(left, right);
  }
  const walk = (local, cloud) => {
    if (equal(local, cloud)) return;
    if (Array.isArray(local) && Array.isArray(cloud)) {
      if (equal(local.map(row => JSON.stringify(row)).sort(), cloud.map(row => JSON.stringify(row)).sort())) {
        detail.orderingDifference = true; return;
      }
      const lm = historicalTemplateIndex(local), cm = historicalTemplateIndex(cloud);
      if (lm && cm) {
        const localOrder = [...lm.keys()].filter(id => cm.has(id));
        const cloudOrder = [...cm.keys()].filter(id => lm.has(id));
        detail.orderingDifference ||= !equal(localOrder, cloudOrder);
        detail.localOnlyRecords ||= [...lm.keys()].some(id => !cm.has(id));
        detail.cloudOnlyRecords ||= [...cm.keys()].some(id => !lm.has(id));
        lm.forEach((row, id) => { if (cm.has(id)) walk(row, cm.get(id)); });
      } else {
        if (local.length !== cloud.length) detail.differentValues = true;
        local.slice(0, Math.min(local.length, cloud.length)).forEach((row, index) => walk(row, cloud[index]));
      }
    } else if (isSupplementalRecord(local) && isSupplementalRecord(cloud)) {
      detail.localOnlyFields ||= Object.keys(local).some(key => !Object.prototype.hasOwnProperty.call(cloud, key));
      detail.cloudOnlyFields ||= Object.keys(cloud).some(key => !Object.prototype.hasOwnProperty.call(local, key));
      Object.keys(local).forEach(key => { if (Object.prototype.hasOwnProperty.call(cloud, key)) walk(local[key], cloud[key]); });
    } else detail.differentValues = true;
  };
  walk(canonicalLeft, canonicalRight);
  if (detail.phoneFormattingEquivalent) detail.differentValues = false;
  const differences = ["localOnlyFields", "cloudOnlyFields", "differentValues", "orderingDifference", "localOnlyRecords", "cloudOnlyRecords"];
  const codes = ["local_only_fields", "cloud_only_fields", "value_difference", "ordering_difference", "local_only_records", "cloud_only_records"];
  const active = differences.map((key, i) => detail[key] ? codes[i] : null).filter(Boolean);
  detail.classification = detail.unsupportedShape ? "unsupported_shape"
    : matched ? detail.serializationOnly ? "serialization_equivalent" : "matched"
    : detail.phoneFormattingEquivalent ? "phone_format_equivalent"
    : detail.collectionOrderEquivalent ? "collection_order_equivalent"
    : left == null || right == null ? "capture_difference"
    : active.length === 1 ? active[0] : "mixed_difference";
  return detail;
}

function historicalWorkspaceBundleProof(local, snapshot, storage) {
  const available = Boolean(snapshot?.ok) && snapshot.supplemental?.status === "available";
  const families = ["companyProfile", "settings", "scopeTemplates"];
  const companyProfileDifference = available ? historicalPortableDifference("companyProfile", supplementalValue(local.companyProfile), supplementalValue(snapshot.mapped?.companyProfile)) : null;
  const scopeTemplatesDifference = available ? historicalPortableDifference("scopeTemplates", local.scopeTemplates, snapshot.mapped?.scopeTemplates) : null;
  const matches = families.map(family => available ? cloudSyncEqual(
    family === "scopeTemplates" ? local[family] : supplementalValue(local[family]),
    family === "scopeTemplates" ? snapshot.mapped?.[family] : supplementalValue(snapshot.mapped?.[family])) : null);
  if (available) {
    matches[0] = !companyProfileDifference.unsupportedShape && (matches[0] || companyProfileDifference.phoneFormattingEquivalent);
    matches[2] = !scopeTemplatesDifference.unsupportedShape && (matches[2] || scopeTemplatesDifference.collectionOrderEquivalent);
  }
  const failed = available ? matches.indexOf(false) : -1;
  const family = families[failed];
  const status = snapshot?.supplemental?.status;
  const shape = value => value === undefined ? "missing" : value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "object" : "scalar";
  return safeHistoricalBundleProof({
    code: !snapshot?.ok ? "cloud_snapshot_unavailable" : status !== "available"
      ? ({ missing: "app_restore_bundle_missing", invalid: "app_restore_bundle_invalid", error: "app_restore_bundle_error" }[status] || "app_restore_bundle_unavailable")
      : failed >= 0 ? ["company_profile_mismatch", "settings_mismatch", "scope_templates_mismatch"][failed] : "matched",
    family: failed >= 0 ? ["company_profile", "settings", "scope_templates"][failed] : "none",
    snapshotAvailable: Boolean(snapshot?.ok), supplementalStatus: status,
    companyProfileMatched: matches[0], settingsMatched: matches[1], scopeTemplatesMatched: matches[2],
    scopeTemplateCapture: historicalTemplateCaptureProof(snapshot, storage),
    ...(companyProfileDifference ? { companyProfileDifference } : {}),
    ...(scopeTemplatesDifference ? { scopeTemplatesDifference } : {}),
    localShape: family ? shape(local[family]) : "unavailable", cloudShape: family ? shape(snapshot.mapped?.[family]) : "unavailable",
  });
}

async function runVerifiedHistoricalWorkspaceRemediation({ storage, configured, user, company, verifyCloud = runSupabaseCloudVerification }) {
  const refused = (code, details = {}) => ({ ok: false, status: "skipped", code, noWritesPerformed: true, noCloudWritesPerformed: true, ...details });
  const userId = asText(user?.id), companyId = asText(company?.id);
  if (!configured || !userId || !companyId) return refused("prerequisites_missing");
  const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
  // Reuse the recovery owner's exclusive lease, rather than racing an active
  // reset or inventing another recovery marker. No lease means no remediation.
  const leased = await withVaultDeviceRecoveryLease({ workspaceTag, operation: async () => {
    const startedAt = Date.now();
    const initial = historicalWorkspaceResidue(storage, companyId, startedAt);
    if (!initial) return refused("no_historical_workspace_residue");
    const generation = getVaultRuntimeStatus().generation;
    const browserClaim = getBrowserSurfaceClaimToken();
    const lock = readCloudOperationRunLock();
    // Audit history is local evidence, not one of the cloud comparison tables.
    // Bind its complete original envelope/array bytes (including metadata and
    // ordering) to the same hash, generation and before-commit CAS guards.
    const before = [...Object.values(FAMILY_KEYS), STORAGE_KEYS.AUDIT_EVENTS, STORAGE_KEYS.CLOUD_MUTATION_LEDGER, STORAGE_KEYS.CLOUD_BACKUP_QUEUE,
      STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL, STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS,
      STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, STORAGE_KEYS.CLOUD_SYNC_BASELINE, STORAGE_KEYS.CLOUD_ASSET_BINDINGS,
      STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT].map(key => [key, storage.getItem(key)]);
    const contextCurrent = (committing = false) => {
      const identity = getActiveAccountWorkspaceIdentity();
      const currentLock = readCloudOperationRunLock();
      const checkpoint = readVaultDeviceRecoveryCheckpoint({ storage, workspaceTag });
      return identity.userId === userId && identity.companyId === companyId
        && storage === localStorage && storage === getActiveAccountScopedStorage()
        && isAuthoritativeVaultRuntimeInstalled(workspaceTag)
        && getVaultRuntimeStatus().generation === generation && getVaultRuntimeStatus().pending === 0
        && (committing ? isVaultRuntimeReadable(generation) : isVaultRuntimeReady(generation))
        && browserClaim && isBrowserSurfaceActive() && getBrowserSurfaceClaimToken() === browserClaim
        && lock.locked && lock.owner === CLOUD_OPERATION_OWNER.CONVERGENCE
        && currentLock.leaseId === lock.leaseId && currentLock.owner === lock.owner
        && checkpoint.ok && !checkpoint.checkpoint
        && before.every(([key, value]) => storage.getItem(key) === value && runtimeGetItem(key) === value);
    };
    if (!contextCurrent()) return refused("historical_workspace_context_changed");
    const startAccess = await ensureCurrentDeviceCanApplyLocalRestore({ storage, configured, user, company, reason: "historical_workspace_verification" });
    if (!startAccess?.ok || !contextCurrent()) return refused("device_not_active");
    const startFence = startAccess.access?.fence;
    // Always execute fresh reads here. Never accept a caller's cloudSnapshot,
    // lastConvergenceResult, verifiedCurrent or previously cached verification.
    const snapshot = await readSupabaseCloudConvergenceSnapshot({ configured, user, company });
    // Separate a changed authoritative context from a genuine bundle mismatch.
    if (!contextCurrent()) return refused("historical_workspace_context_changed");
    const historicalBundleProof = historicalWorkspaceBundleProof(initial.snapshot, snapshot, initial.verificationStorage);
    if (historicalBundleProof.code !== "matched") return refused("workspace_bundle_not_matched", { historicalBundleProof });
    if (relationshipCodes(initial.snapshot).length || relationshipCodes(snapshot.mapped).length
      || !initial.candidates.every(entry => historicalMutationParentsMatch(entry, initial.snapshot, snapshot, companyId))) {
      return refused("historical_required_parent_unresolved");
    }
    const verification = await verifyCloud({ storageSnapshot: initial.verificationStorage, configured, user, company });
    const verifiedAt = Date.parse(verification?.generatedAt);
    const tables = ["customers", "projects", "estimates", "invoices", "invoice_payments", "estimate_line_items", "invoice_line_items"];
    if (!verification?.ok || verification.allMatched !== true
      || verification.verificationVersion !== SUPABASE_CLOUD_VERIFICATION_VERSION || verification.company?.id !== companyId
      || !["supabaseConfigured", "signedIn", "hasCompany"].every(key => verification.validations?.[key] === true)
      || !(verifiedAt >= startedAt && verifiedAt <= Date.now())
      || verification.tableResults?.length !== tables.length
      || !tables.every(table => verification.tableResults.filter(row => row.table === table && row.status === "matched").length === 1)
      || asArray(verification.notices).some(notice => ["warning", "error"].includes(notice.level) || notice.code === "older_estimates_kept_in_cloud")
      || asArray(verification.blockers).length || asArray(verification.availableRepairs).length || asArray(verification.repairs).length) return refused("strict_workspace_match_required");
    if (!contextCurrent()) return refused("historical_workspace_context_changed");
    const proof = { userId, companyId, workspaceTag, generation, startedAt, verifiedAt,
      snapshotHash: stableCloudSyncHash(before) };
    const ledger = initial.candidates.length ? buildWorkspaceBaselineRetiredLedger(initial.ledger, {
      ...proof, coversPayload: entry => historicalPayloadMatchesCanonical(entry, initial.snapshot),
    }) : initial.ledger;
    if (!ledger) return refused("historical_mutation_intent_uncovered");
    const queue = buildWorkspaceBaselineRetiredQueue(initial.queue, proof);
    if (!ledger || !queue) return refused("historical_workspace_proof_stale");
    const records = [];
    if (initial.candidates.length) records.push({ logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER, value: JSON.stringify(ledger) });
    if (queue !== initial.queue) records.push({ logicalKey: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: JSON.stringify(queue) });
    await runtimeCommitAtomicRecords(records, { beforeCommit: async () => {
      if (!contextCurrent(true)) return false;
      const access = await ensureCurrentDeviceCanApplyLocalRestore({ storage, configured, user, company, reason: "before_historical_workspace_retirement" });
      return operationFenceStillCurrent({ startFence, completionAccess: access }) && contextCurrent(true);
    } });
    return { ok: true, status: "matched", retiredCount: initial.candidates.length,
      queueRetired: queue !== initial.queue, noWritesPerformed: false, noCloudWritesPerformed: true, historicalBundleProof };
  } });
  return leased.acquired ? leased.value : refused("recovery_busy_or_unavailable");
}

async function runCloudConvergenceAttempt({ storage = localStorage, configured = false, user = null, company = null, cloudSnapshot = null, deviceAccess = null, completionDeviceAccess = null, verifyCloud = runSupabaseCloudVerification } = {}) {
  const companyId = asText(company?.id); const userId = asText(user?.id);
  if (!configured || !companyId || !userId) return { ok: false, status: "unavailable", code: "prerequisites_missing", noWritesPerformed: true };
  const deviceId = getOrCreateLocalDeviceId(storage);
  const journalContext = { storage, companyId, userId, deviceId };
  const recovered = recoverInterruptedCloudConvergence(journalContext);
  if (!recovered.ok) return { ok: false, status: "critical", code: recovered.code, noWritesPerformed: true };
  const local = localSnapshot(storage);
  const snapshot = cloudSnapshot || await readSupabaseCloudConvergenceSnapshot({ configured, user, company });
  if (!snapshot?.ok) return { ok: false, status: "unavailable", code: snapshot?.code || "cloud_snapshot_failed", noWritesPerformed: true };
  // Gate 16H: compact a legacy full baseline BEFORE anything captures storage
  // values. Left alone it lands in the rollback journal as a multi-megabyte
  // `previous` value, so the transaction would have to hold two copies of it
  // and could not fit. The rewrite is information-preserving and idempotent.
  const baselineCompaction = compactStoredCloudSyncBaseline({ storage, companyId });
  const metadataStage = await recoverCloudSyncMetadata({ storage, configured, user, company, companyId, deviceAccess });
  const metadataReport = {
    baselineCompacted: Boolean(baselineCompaction.migrated),
    metadataRecoveryStage: metadataStage.stageName,
    queueSchemaBefore: metadataStage.queueSchemaBefore,
    queueSchemaAfter: metadataStage.queueSchemaAfter,
    pauseReason: metadataStage.pauseReason,
    pauseRecovered: metadataStage.pauseRecovered,
  };
  // Re-read every metadata-derived value AFTER recovery so the proof, the plan
  // and the change-detection guard all agree on one post-recovery view.
  // queueRevision() may normalize an older persisted queue or add missing
  // review provenance. Perform that metadata-only migration before capturing
  // the byte-for-byte rollback/change-detection snapshot.
  const beforeQueueRevision = queueRevision(storage); const beforeValues = snapshotValues(storage);
  const baseline = readCloudSyncBaseline(companyId, storage);
  const plan = buildCloudConvergencePlan({ local, cloud: snapshot.mapped, baseline: baseline?.snapshots || null, cloudSnapshot: snapshot, companyId, storage });
  const attemptId = stableCloudSyncHash({ companyId, userId, queueRevision: beforeQueueRevision, local, cloud: snapshot.mapped, baseline: baseline?.version || 0 });
  if (!plan.safe) {
    const vaultJournal = { version: CLOUD_CONVERGENCE_VERSION, companyId, userId, deviceId, attemptId, createdAt: now(), queueRevision: beforeQueueRevision, previous: { [VAULT_KEY]: beforeValues[VAULT_KEY] }, plannedFamilies: [VAULT_KEY] };
    if (!writeJournal(storage, vaultJournal)) return { ok: false, status: "critical", code: "journal_write_failed", noWritesPerformed: true };
    const recorded = recordConflicts({ storage, companyId, plan, baseline: baseline?.snapshots || null, local, cloud: snapshot.mapped, cloudSnapshot: snapshot, attemptId });
    if (!recorded) {
      const rollback = recoverInterruptedCloudConvergence(journalContext);
      return { ok: false, status: rollback.ok ? "rolled_back" : "critical_local_recovery_required", code: rollback.ok ? "conflict_vault_write_failed" : rollback.code, noWritesPerformed: true };
    }
    storage.removeItem(JOURNAL_KEY);
    return {
      ok: false, status: "conflict", code: "data_mismatch", conflictCount: plan.conflicts.length,
      conflictSummary: safeConflictSummary(plan.conflicts), bootstrapCode: !baseline ? asText(plan.bootstrapProof?.code) : "",
      bootstrapDetailCode: !baseline ? asText(plan.bootstrapProof?.detailCode) : "",
      ...metadataReport,
      noWritesPerformed: true,
    };
  }
  const writes = plannedStorageWrites(local, plan);
  const additionBindingEntries = Object.entries(ENTITY_BINDING_TYPES).flatMap(([family, entityType]) => (plan.additions[family] || [])
    .map((row) => ({ entityType, localLegacyId: entityId(row), cloudUuid: snapshot.uuidMaps?.[family]?.[entityId(row)], companyId, source: "cloud_convergence" })).filter((entry) => entry.cloudUuid));
  const addedPaymentBindingEntries = (plan.additions.invoices || []).flatMap((invoice) => asArray(invoice?.payments).map((payment) => ({
    entityType: "invoice_payment", localLegacyId: entityId(payment), cloudUuid: snapshot.uuidMaps?.invoicePayments?.[entityId(payment)], companyId, source: "cloud_convergence",
  })).filter((entry) => entry.localLegacyId && entry.cloudUuid));
  const bindingEntries = [...plan.bindingEntries, ...additionBindingEntries, ...addedPaymentBindingEntries];
  const queueBefore = readPersistedCloudBackupQueueState(storage)?.state;
  const pendingReviewQueue = Boolean(
    queueBefore?.pending
    && (queueBefore?.status === CLOUD_BACKUP_STATUS.REMOTE_CHANGED || queueBefore?.status === CLOUD_BACKUP_STATUS.CONFLICT)
  );
  // A historical review queue must use the existing journaled, fenced, strict
  // verification completion below even when the planner finds no local writes.
  // Only that path may acknowledge the exact queue revision as clean.
  if (Object.keys(writes).length === 0 && bindingEntries.length === 0 && !pendingReviewQueue) {
    // Local-only differences stay local and keep the backup pending; they must
    // not require strict allMatched before the backup worker runs.
    if (plan.localOnly) return { ok: true, status: "matched", noWritesPerformed: true, localOnly: true };
    // Nothing to import, but a "matched" verdict must not be trusted on the
    // planner's document comparison alone: a stale device can look matched while
    // the cloud holds extra flattened children under the shared identity
    // contract. Require strict shared verification before reporting matched.
    const verification = await verifyCloud({ storageSnapshot: storage, configured, user, company });
    const warning = Array.isArray(verification?.notices) && verification.notices.some((notice) => notice?.level === "warning" || notice?.level === "error");
    const blocker = Array.isArray(verification?.blockers) && verification.blockers.length > 0;
    const repairAvailable = Boolean(verification?.availableRepairs?.length || verification?.repairs?.length);
    if (!verification?.ok || !verification?.allMatched || warning || blocker || repairAvailable) {
      // Safe mismatch: expose only non-sensitive counts/codes, write no local
      // business data, and never report a successful matched state.
      return {
        ok: false, status: "mismatch", code: "verification_mismatch", noWritesPerformed: true, noCloudWritesPerformed: true, localOnly: false,
        mismatch: {
          verificationOk: Boolean(verification?.ok),
          allMatched: Boolean(verification?.allMatched),
          blockerCount: Array.isArray(verification?.blockers) ? verification.blockers.length : 0,
          repairAvailable,
          // Narrow, non-sensitive plumbing so the automatic recovery hook can hand
          // a PROVEN-repairable mismatch to the existing backup worker. Convergence
          // itself still performs no cloud writes and still reports a mismatch.
          repairableMismatchOnly: Boolean(verification?.repairableMismatchOnly),
          repairTypes: Array.isArray(verification?.availableRepairs)
            ? [...new Set(verification.availableRepairs.map((repair) => asText(repair?.type)).filter(Boolean))]
            : [],
          repairRowCount: Array.isArray(verification?.availableRepairs)
            ? verification.availableRepairs.reduce((sum, repair) => sum + (Number(repair?.count) || 0), 0)
            : 0,
          repairDocumentIds: Array.isArray(verification?.availableRepairs)
            ? [...new Set(verification.availableRepairs.flatMap((repair) => Array.isArray(repair?.parentLegacyIds) ? repair.parentLegacyIds : []).map(asText).filter(Boolean))]
            : [],
          noticeCodes: Array.isArray(verification?.notices)
            ? [...new Set(verification.notices.filter((notice) => notice?.level === "warning" || notice?.level === "error").map((notice) => asText(notice?.code)).filter(Boolean))]
            : [],
        },
      };
    }
    return { ok: true, status: "matched", noWritesPerformed: true, localOnly: false };
  }
  const access = deviceAccess || await ensureCurrentDeviceCanApplyLocalRestore({ configured, user, company, storage, reason: "cloud_convergence" });
  if (!access?.ok) return { ok: false, status: "blocked", code: "device_not_active", noWritesPerformed: true };
  // Immutable for this transaction. Strict cloud verification below is awaited,
  // so ownership can change underneath it; proving the device is merely ACTIVE at
  // completion would accept A/v5 -> B/v6 -> A/v7 and let a stale transaction
  // capture a baseline, clear the queue and remove the journal.
  const startFence = access?.access?.fence || null;
  if (plan.bootstrap) {
    const recheckedProof = buildCleanReplicaBootstrapProof({ storage, companyId, local, cloud: snapshot.mapped, cloudSnapshot: snapshot, baseline: null });
    if (!recheckedProof.ok || Number(recheckedProof.queueRevision) !== Number(beforeQueueRevision)) return { ok: false, status: "aborted", code: recheckedProof.code || "baseline_bootstrap_local_pending", noWritesPerformed: true };
  }
  if (queueRevision(storage) !== beforeQueueRevision || Object.entries(beforeValues).some(([key, value]) => readRaw(storage, key) !== value)) return { ok: false, status: "aborted", code: "local_changed_during_read", noWritesPerformed: true };
  // Gate 16H: the journal is a ROLLBACK record, so it only needs the keys this
  // transaction can actually mutate. Serializing every family duplicated the
  // 1.6M-character logo and the scope images into localStorage for the whole
  // write window -- on top of the baseline copy -- which is what exhausted the
  // per-origin quota. beforeValues stays broad IN MEMORY for planning and the
  // change-detection guard; only the mutable subset is persisted.
  const rollbackKeys = buildConvergenceRollbackKeySet({
    writes,
    bindingEntries,
    willCaptureBaseline: !plan.localOnly,
    willClearQueue: !plan.localOnly,
    willAppendLedger: plan.localOnly,
    metadataRecovery: metadataStage.attempted,
  });
  const previous = rollbackKeys.reduce((out, key) => ({ ...out, [key]: beforeValues[key] ?? readRaw(storage, key) }), {});
  const journal = { version: CLOUD_CONVERGENCE_VERSION, companyId, userId, deviceId, attemptId, createdAt: now(), queueRevision: beforeQueueRevision, previous, plannedFamilies: Object.keys(writes) };
  if (!writeJournal(storage, journal)) return { ok: false, status: "critical", code: "journal_write_failed", noWritesPerformed: true };
  try {
    if (bindingEntries.length) {
      const bindingWrite = setCloudAssetBindingsBatch(companyId, bindingEntries, { storage, reconciliationKeys: new Set(bindingEntries.filter((entry) => entry.reconciliation).map((entry) => `${entry.entityType}:${entry.localLegacyId}`)) });
      if (!bindingWrite.ok || bindingWrite.skipped?.length) throw new Error("binding_write_failed");
    }
    for (const [key, value] of Object.entries(writes)) { if (!writeRaw(storage, key, value)) throw new Error("local_write_failed"); }
    const localVerification = verifyLocalApply({ before: beforeValues, writes, storage, localBefore: local, plan, expectedQueueRevision: beforeQueueRevision });
    if (!localVerification.ok) throw new Error(localVerification.code);
    if (plan.localOnly) {
      const mutations = buildConvergenceLocalOnlyMutations({
        plan,
        snapshot: buildLocalSnapshotFromStorage(storage).snapshot,
        companyId,
      });
      await appendCloudMutationsDurably(mutations, { storage });
    }
    else {
      const verification = await verifyCloud({ storageSnapshot: storage, configured, user, company });
      const warning = Array.isArray(verification?.notices) && verification.notices.some((notice) => notice?.level === "warning" || notice?.level === "error");
      const blocker = Array.isArray(verification?.blockers) && verification.blockers.length > 0;
      const repairAvailable = Boolean(verification?.availableRepairs?.length || verification?.repairs?.length);
      if (!verification?.ok || !verification?.allMatched || warning || blocker || repairAvailable) throw new Error("cloud_verification_failed");
      const completionAccess = completionDeviceAccess || await ensureCurrentDeviceCanApplyLocalRestore({ configured, user, company, storage, reason: "before_convergence_complete" });
      if (!completionAccess?.ok || queueRevision(storage) !== beforeQueueRevision) throw new Error("convergence_completion_guard_failed");
      // Same GENERATION, not merely the same device.
      if (!operationFenceStillCurrent({ startFence, completionAccess })) throw new Error("convergence_completion_guard_failed");
      const captured = captureVerifiedCloudSyncBaseline({ storage, companyId, queueRevision: beforeQueueRevision, cloudSnapshot: snapshot, verified: true, deviceAccess: access });
      // Preserve the precise reason (e.g. baseline_quota_exceeded) instead of
      // collapsing every baseline failure into one opaque code.
      if (!captured.ok) throw new Error(asText(captured.code) || "baseline_write_failed");
      const readBackBaseline = readCloudSyncBaseline(companyId, storage);
      if (!readBackBaseline || !cloudSyncEqual(readBackBaseline.snapshots, captured.baseline?.snapshots)) throw new Error("baseline_readback_mismatch");
      clearCloudBackupDirty("cloud_convergence_verified", { expectedRevision: beforeQueueRevision });
      const clearedQueue = readPersistedCloudBackupQueueState(storage)?.state;
      if (!clearedQueue || clearedQueue.pending || clearedQueue.status !== CLOUD_BACKUP_STATUS.CLEAN || Number(clearedQueue.localMutationRevision || 0) !== Number(beforeQueueRevision)) throw new Error("queue_clear_failed");
    }
    storage.removeItem(JOURNAL_KEY);
    // Only after the journal is removed (success is final) do we report which
    // local families actually changed, so the caller can refresh exactly those
    // screens without a full reload. Never returned on a rolled-back path.
    return { ok: true, status: "converged", imported: Object.values(plan.additions).reduce((count, rows) => count + rows.length, 0), localOnly: plan.localOnly, bootstrap: plan.bootstrap, bootstrapReason: plan.bootstrapReason || "", noCloudWritesPerformed: true, changedFamilies: convergenceChangedFamilies(writes, plan), ...metadataReport };
  } catch (error) {
    const rollback = recoverInterruptedCloudConvergence(journalContext);
    if (!rollback.ok) return { ok: false, status: "critical_local_recovery_required", code: rollback.code, noCloudWritesPerformed: true };
    return { ok: false, status: "rolled_back", code: asText(error?.message) || "convergence_failed", noCloudWritesPerformed: true };
  }
}
