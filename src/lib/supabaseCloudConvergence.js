// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { buildLocalSnapshotFromStorage } from "./localDataIntegrity";
import { readCloudAssetBindings, setCloudAssetBindingsBatch } from "./cloudAssetBindings";
import { readCloudSyncBaseline, cloudSyncEqual, captureVerifiedCloudSyncBaseline, stableCloudSyncHash } from "./cloudSyncBaseline";
import { readSupabaseCloudConvergenceSnapshot } from "./supabaseCloudRestore";
import { readCloudBackupQueueState, markCloudBackupDirty, clearCloudBackupDirty } from "./cloudBackupQueue";
import { ensureCurrentDeviceCanApplyLocalRestore, getOrCreateLocalDeviceId } from "./supabaseDeviceLock";
import { runSupabaseCloudVerification } from "./supabaseCloudVerification";
import { mapLocalEstimateToBackendEstimate, mapLocalInvoiceToBackendInvoice } from "../utils/backendDataMapper";
import { ESTIMATE_RESTORE_PAYLOAD_SCHEMA, ESTIMATE_RESTORE_PAYLOAD_VERSION } from "./supabaseEstimateRestorePayload";

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
export function normalizeInvoiceContract(invoice = {}) {
  return {
    id: entityId(invoice), customerId: asText(invoice.customerId || invoice.customer?.id), projectId: asText(invoice.projectId || invoice.project?.id),
    sourceEstimateId: asText(invoice.sourceEstimateId || invoice.sourceEstimateLegacyId || invoice.sourceEstimateSnapshot?.estimateId),
    persisted: mapLocalInvoiceToBackendInvoice(invoice, {}),
    // The complete local invoice is retained in the comparison contract so
    // line items and payments can never be independently merged or patched.
    document: { ...clone(invoice), id: "" },
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
  return [...Object.values(FAMILY_KEYS), STORAGE_KEYS.CLOUD_ASSET_BINDINGS, STORAGE_KEYS.CLOUD_SYNC_BASELINE, STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT, STORAGE_KEYS.CLOUD_BACKUP_QUEUE]
    .reduce((out, key) => ({ ...out, [key]: readRaw(storage, key) }), {});
}
function queueRevision() { return Number(readCloudBackupQueueState()?.localMutationRevision || 0); }

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
  asArray(snapshot.projects).forEach((row) => { if (!customers.has(asText(row?.customerId))) codes.push("project_customer_relationship"); });
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
    if (project && asText(row?.customerId) && asText(project?.customerId) !== asText(row?.customerId)) codes.push("invoice_project_customer_relationship");
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
  const persistedFields = ["legacy_local_id", "customer_legacy_local_id", "project_legacy_local_id", "estimate_number", "status", "total_amount", "approved_total", "notes", "terms", "converted_invoice_legacy_local_id"];
  if (persistedFields.some((field) => persisted[field] !== undefined && !cloudSyncEqual(persisted[field], mapped[field]))) return "estimate_restore_payload_persisted_mismatch";
  const expected = asArray(mapped.line_items).map((item, index) => ({
    legacy_local_id: `estimate:${id}:line:${Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index}`,
    sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : index,
    description: item?.description ?? null, quantity: item?.quantity ?? null, unit: item?.unit ?? null,
    unit_price: item?.unit_price ?? null, total_price: item?.total ?? null, metadata: item?.metadata ?? null, line_role: item?.kind ?? null,
  }));
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

function bindingResolutionForFamily({ family, local, cloud, cloudSnapshot, bindings, companyId }) {
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
      if (sameFamilyEntity(family, localRow, directCloud) && asText(cloudUuids[localId])) entries.push({ entityType, localLegacyId: localId, cloudUuid: asText(cloudUuids[localId]), companyId, source: "cloud_convergence" });
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

function paymentBindingResolution({ localInvoices, cloudInvoices, cloudSnapshot, bindings, companyId }) {
  const table = bindings.bindings?.invoice_payment || {}; const cloudUuids = cloudSnapshot?.uuidMaps?.invoicePayments || {};
  const codes = []; const entries = []; const uuidOwners = new Map();
  Object.entries(table).forEach(([legacyId, binding]) => { const uuid = asText(binding?.cloudUuid); if (!uuid) return; const owners = uuidOwners.get(uuid) || []; owners.push(legacyId); uuidOwners.set(uuid, owners); });
  [...uuidOwners.values()].forEach((owners) => { if (owners.length > 1) codes.push("invoice_payments:binding_uuid_reused"); });
  const cloudPaymentById = new Map(asArray(cloudInvoices).flatMap((invoice) => asArray(invoice?.payments).map((payment) => [entityId(payment), payment])));
  const localPaymentById = new Map(asArray(localInvoices).flatMap((invoice) => asArray(invoice?.payments).map((payment) => [entityId(payment), payment])));
  localPaymentById.forEach((payment, paymentId) => {
    const cloudPayment = cloudPaymentById.get(paymentId); const binding = table[paymentId]; const cloudUuid = asText(cloudUuids[paymentId]);
    if (binding && cloudPayment && cloudUuid && asText(binding.cloudUuid) !== cloudUuid) { codes.push("invoice_payments:binding_conflict"); return; }
    if (!binding && cloudPayment && cloudUuid && cloudSyncEqual(payment, cloudPayment)) entries.push({ entityType: "invoice_payment", localLegacyId: paymentId, cloudUuid, companyId, source: "cloud_convergence" });
  });
  return { codes: [...new Set(codes)], entries };
}

function operationForFamily(family, local, cloud, baseline, plan, bindingPairs = null) {
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
    if (classification === "cloud_only_addition") plan.additions[family].push(clone(cloudRow));
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
  operationForFamily("scopeTemplates", localTemplates, cloudTemplates, baseTemplates, plan);
}

export function buildCloudConvergencePlan({ local = {}, cloud = {}, baseline = null, cloudSnapshot = null, companyId = "", storage } = {}) {
  const plan = {
    version: CLOUD_CONVERGENCE_VERSION, safe: false, classifications: [], conflicts: [], additions: { customers: [], projects: [], estimates: [], invoices: [], scopeTemplates: [] },
    replacements: { customers: [], projects: [], estimates: [], invoices: [], scopeTemplates: [] }, supplemental: {}, localOnly: false, codes: [], bindingEntries: [],
  };
  // An already-local converted invoice may legitimately point at the
  // cloud-only estimate being added in this atomic plan. Final graph
  // validation below still rejects it unless that estimate is actually safe.
  const graphCodes = [...relationshipCodes(local).filter((code) => code !== "invoice_estimate_relationship"), ...relationshipCodes(cloud)];
  if (graphCodes.length) { plan.conflicts.push(...[...new Set(graphCodes)].map((code) => ({ family: "relationships", code }))); return plan; }
  const bindings = readCloudAssetBindings(companyId, storage);
  const customerBindings = cloudSnapshot?.uuidMaps ? bindingResolutionForFamily({ family: "customers", local: asArray(local.customers), cloud: asArray(cloud.customers), cloudSnapshot, bindings, companyId }) : null;
  const localCustomerIdByCloudId = new Map(customerBindings ? [...customerBindings.pairs.entries()].map(([localId, cloudId]) => [cloudId, localId]) : []);
  const cloudProjects = asArray(cloud.projects).map((project) => localCustomerIdByCloudId.has(asText(project?.customerId))
    ? { ...project, customerId: localCustomerIdByCloudId.get(asText(project.customerId)) }
    : project);
  const projectBindings = cloudSnapshot?.uuidMaps ? bindingResolutionForFamily({ family: "projects", local: asArray(local.projects), cloud: cloudProjects, cloudSnapshot, bindings, companyId }) : null;
  const localProjectIdByCloudId = new Map(projectBindings ? [...projectBindings.pairs.entries()].map(([localId, cloudId]) => [cloudId, localId]) : []);
  const cloudEstimates = asArray(cloud.estimates).map((estimate) => ({ ...estimate,
    ...(localCustomerIdByCloudId.has(asText(estimate?.customerId)) ? { customerId: localCustomerIdByCloudId.get(asText(estimate.customerId)) } : {}),
    ...(localProjectIdByCloudId.has(asText(estimate?.projectId)) ? { projectId: localProjectIdByCloudId.get(asText(estimate.projectId)) } : {}),
  }));
  const estimateBindings = cloudSnapshot?.uuidMaps ? bindingResolutionForFamily({ family: "estimates", local: asArray(local.estimates), cloud: cloudEstimates, cloudSnapshot, bindings, companyId }) : null;
  const localEstimateIdByCloudId = new Map(estimateBindings ? [...estimateBindings.pairs.entries()].map(([localId, cloudId]) => [cloudId, localId]) : []);
  const cloudInvoices = asArray(cloud.invoices).map((invoice) => ({ ...invoice,
    ...(localCustomerIdByCloudId.has(asText(invoice?.customerId)) ? { customerId: localCustomerIdByCloudId.get(asText(invoice.customerId)) } : {}),
    ...(localProjectIdByCloudId.has(asText(invoice?.projectId)) ? { projectId: localProjectIdByCloudId.get(asText(invoice.projectId)) } : {}),
    ...(localEstimateIdByCloudId.has(asText(invoice?.sourceEstimateId)) ? { sourceEstimateId: localEstimateIdByCloudId.get(asText(invoice.sourceEstimateId)) } : {}),
  }));
  const invoiceBindings = cloudSnapshot?.uuidMaps ? bindingResolutionForFamily({ family: "invoices", local: asArray(local.invoices), cloud: cloudInvoices, cloudSnapshot, bindings, companyId }) : null;
  const paymentBindings = cloudSnapshot?.uuidMaps ? paymentBindingResolution({ localInvoices: asArray(local.invoices), cloudInvoices, cloudSnapshot, bindings, companyId }) : null;
  const bindingCodes = [...(customerBindings?.codes || []), ...(projectBindings?.codes || []), ...(estimateBindings?.codes || []), ...(invoiceBindings?.codes || []), ...(paymentBindings?.codes || [])];
  if (bindingCodes.length) { plan.conflicts.push(...bindingCodes.map((code) => ({ family: "bindings", code }))); return plan; }
  if (customerBindings || projectBindings || estimateBindings || invoiceBindings || paymentBindings) plan.bindingEntries.push(...(customerBindings?.entries || []), ...(projectBindings?.entries || []), ...(estimateBindings?.entries || []), ...(invoiceBindings?.entries || []), ...(paymentBindings?.entries || []));
  operationForFamily("customers", asArray(local.customers), asArray(cloud.customers), asArray(baseline?.customers), plan, customerBindings?.pairs);
  operationForFamily("projects", asArray(local.projects), cloudProjects, asArray(baseline?.projects), plan, projectBindings?.pairs);
  operationForFamily("estimates", asArray(local.estimates), cloudEstimates, asArray(baseline?.estimates), plan, estimateBindings?.pairs);
  operationForFamily("invoices", asArray(local.invoices), cloudInvoices, asArray(baseline?.invoices), plan, invoiceBindings?.pairs);
  [...(plan.additions.estimates || []), ...(plan.replacements.estimates || [])].forEach((estimate) => {
    const code = estimateEvidenceCode(estimate, cloudSnapshot?.estimateEvidence?.[entityId(estimate)]);
    if (code) plan.conflicts.push({ family: "estimates", id: entityId(estimate), code });
  });
  planSupplemental(local, cloud, baseline, plan);
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

function verifyLocalApply({ before, writes, storage, localBefore, plan, expectedQueueRevision }) {
  if (Number(queueRevision()) !== Number(expectedQueueRevision)) return { ok: false, code: "queue_revision_changed" };
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
export function recoverInterruptedCloudConvergence({ storage = localStorage } = {}) {
  const journal = readJournal(storage);
  if (!journal) return { ok: true, recovered: false };
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
    return writeRaw(storage, VAULT_KEY, JSON.stringify({ version: CLOUD_CONVERGENCE_VERSION, companyId, entries }));
  } catch { return false; }
}

export async function runSupabaseCloudConvergence({ storage = localStorage, configured = false, user = null, company = null, cloudSnapshot = null, deviceAccess = null, completionDeviceAccess = null, verifyCloud = runSupabaseCloudVerification } = {}) {
  const companyId = asText(company?.id); const userId = asText(user?.id);
  if (!configured || !companyId || !userId) return { ok: false, status: "unavailable", code: "prerequisites_missing", noWritesPerformed: true };
  const recovered = recoverInterruptedCloudConvergence({ storage });
  if (!recovered.ok) return { ok: false, status: "critical", code: recovered.code, noWritesPerformed: true };
  const beforeValues = snapshotValues(storage); const beforeQueueRevision = queueRevision(); const local = localSnapshot(storage);
  const snapshot = cloudSnapshot || await readSupabaseCloudConvergenceSnapshot({ configured, user, company });
  if (!snapshot?.ok) return { ok: false, status: "unavailable", code: snapshot?.code || "cloud_snapshot_failed", noWritesPerformed: true };
  const baseline = readCloudSyncBaseline(companyId, storage);
  const plan = buildCloudConvergencePlan({ local, cloud: snapshot.mapped, baseline: baseline?.snapshots || null, cloudSnapshot: snapshot, companyId, storage });
  const attemptId = stableCloudSyncHash({ companyId, userId, queueRevision: beforeQueueRevision, local, cloud: snapshot.mapped, baseline: baseline?.version || 0 });
  if (!plan.safe) {
    const vaultJournal = { version: CLOUD_CONVERGENCE_VERSION, companyId, userId, attemptId, createdAt: now(), queueRevision: beforeQueueRevision, previous: { [VAULT_KEY]: beforeValues[VAULT_KEY] }, plannedFamilies: [VAULT_KEY] };
    if (!writeJournal(storage, vaultJournal)) return { ok: false, status: "critical", code: "journal_write_failed", noWritesPerformed: true };
    const recorded = recordConflicts({ storage, companyId, plan, baseline: baseline?.snapshots || null, local, cloud: snapshot.mapped, cloudSnapshot: snapshot, attemptId });
    if (!recorded) {
      const rollback = recoverInterruptedCloudConvergence({ storage });
      return { ok: false, status: rollback.ok ? "rolled_back" : "critical_local_recovery_required", code: rollback.ok ? "conflict_vault_write_failed" : rollback.code, noWritesPerformed: true };
    }
    storage.removeItem(JOURNAL_KEY);
    return { ok: false, status: "conflict", code: "data_mismatch", conflictCount: plan.conflicts.length, noWritesPerformed: true };
  }
  const writes = plannedStorageWrites(local, plan);
  const additionBindingEntries = Object.entries(ENTITY_BINDING_TYPES).flatMap(([family, entityType]) => (plan.additions[family] || [])
    .filter((row) => !["customers", "projects"].includes(family))
    .map((row) => ({ entityType, localLegacyId: entityId(row), cloudUuid: snapshot.uuidMaps?.[family]?.[entityId(row)], companyId, source: "cloud_convergence" })).filter((entry) => entry.cloudUuid));
  const bindingEntries = [...plan.bindingEntries, ...additionBindingEntries];
  if (Object.keys(writes).length === 0 && bindingEntries.length === 0) return { ok: true, status: "matched", noWritesPerformed: true, localOnly: plan.localOnly };
  const access = deviceAccess || await ensureCurrentDeviceCanApplyLocalRestore({ configured, user, company, storage, reason: "cloud_convergence" });
  if (!access?.ok) return { ok: false, status: "blocked", code: "device_not_active", noWritesPerformed: true };
  if (queueRevision() !== beforeQueueRevision || Object.entries(beforeValues).some(([key, value]) => readRaw(storage, key) !== value)) return { ok: false, status: "aborted", code: "local_changed_during_read", noWritesPerformed: true };
  const previous = beforeValues;
  const journal = { version: CLOUD_CONVERGENCE_VERSION, companyId, userId, deviceId: getOrCreateLocalDeviceId(storage), attemptId, createdAt: now(), queueRevision: beforeQueueRevision, previous, plannedFamilies: Object.keys(writes) };
  if (!writeJournal(storage, journal)) return { ok: false, status: "critical", code: "journal_write_failed", noWritesPerformed: true };
  try {
    if (bindingEntries.length) {
      const bindingWrite = setCloudAssetBindingsBatch(companyId, bindingEntries, { storage, reconciliationKeys: new Set(bindingEntries.filter((entry) => entry.reconciliation).map((entry) => `${entry.entityType}:${entry.localLegacyId}`)) });
      if (!bindingWrite.ok || bindingWrite.skipped?.length) throw new Error("binding_write_failed");
    }
    for (const [key, value] of Object.entries(writes)) { if (!writeRaw(storage, key, value)) throw new Error("local_write_failed"); }
    const localVerification = verifyLocalApply({ before: beforeValues, writes, storage, localBefore: local, plan, expectedQueueRevision: beforeQueueRevision });
    if (!localVerification.ok) throw new Error(localVerification.code);
    if (plan.localOnly) markCloudBackupDirty({ reason: "cloud_convergence_local_only", severity: "normal" });
    else {
      const verification = await verifyCloud({ storageSnapshot: storage, configured, user, company });
      const warning = Array.isArray(verification?.notices) && verification.notices.some((notice) => notice?.level === "warning" || notice?.level === "error");
      const blocker = Array.isArray(verification?.blockers) && verification.blockers.length > 0;
      const repairAvailable = Boolean(verification?.availableRepairs?.length || verification?.repairs?.length);
      if (!verification?.ok || !verification?.allMatched || warning || blocker || repairAvailable) throw new Error("cloud_verification_failed");
      const completionAccess = completionDeviceAccess || await ensureCurrentDeviceCanApplyLocalRestore({ configured, user, company, storage, reason: "before_convergence_complete" });
      if (!completionAccess?.ok || queueRevision() !== beforeQueueRevision) throw new Error("convergence_completion_guard_failed");
      const captured = captureVerifiedCloudSyncBaseline({ storage, companyId, queueRevision: beforeQueueRevision, cloudSnapshot: snapshot, verified: true, deviceAccess: access });
      if (!captured.ok) throw new Error("baseline_write_failed");
      clearCloudBackupDirty("cloud_convergence_verified", { expectedRevision: beforeQueueRevision });
    }
    storage.removeItem(JOURNAL_KEY);
    return { ok: true, status: "converged", imported: Object.values(plan.additions).reduce((count, rows) => count + rows.length, 0), localOnly: plan.localOnly, noCloudWritesPerformed: true };
  } catch (error) {
    const rollback = recoverInterruptedCloudConvergence({ storage });
    if (!rollback.ok) return { ok: false, status: "critical_local_recovery_required", code: rollback.code, noCloudWritesPerformed: true };
    return { ok: false, status: "rolled_back", code: asText(error?.message) || "convergence_failed", noCloudWritesPerformed: true };
  }
}
