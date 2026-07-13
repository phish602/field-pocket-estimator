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
function normalizeFamilyEntity(family, value) {
  if (!value) return null;
  if (family === "customers") return normalizeCustomerContract(value);
  if (family === "projects") return normalizeProjectContract(value);
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
  });
  asArray(snapshot.invoices).forEach((row) => {
    if (asText(row?.customerId) && !customers.has(asText(row?.customerId))) codes.push("invoice_customer_relationship");
    if (asText(row?.projectId) && !projects.has(asText(row?.projectId))) codes.push("invoice_project_relationship");
    if (asText(row?.sourceEstimateId) && !estimates.has(asText(row?.sourceEstimateId))) codes.push("invoice_estimate_relationship");
  });
  return [...new Set(codes)];
}

const METADATA_MERGE_FAMILIES = new Set(["customers", "projects", "scopeTemplates", "companyProfile", "settings"]);
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

function planSupplemental(local, cloud, baseline, plan) {
  ["companyProfile", "settings"].forEach((family) => {
    const localValue = local[family] || null; const cloudValue = cloud[family] || null; const base = baseline?.[family] || null;
    if (!cloudValue) return;
    const classification = classifyCloudConvergenceEntity({ local: localValue, cloud: cloudValue, baseline: base });
    plan.classifications.push({ family, id: family, classification });
    if (!localValue && cloudValue) plan.supplemental[family] = clone(cloudValue);
    else if (classification === "cloud_changed") plan.supplemental[family] = clone(cloudValue);
    else if (classification === "local_changed") plan.localOnly = true;
    else if (classification === "both_changed_conflict") {
      const merged = mergeNonOverlappingCloudMetadata({ baseline: base, local: localValue, cloud: cloudValue, family });
      if (merged) plan.supplemental[family] = merged;
      else plan.conflicts.push({ family, id: family, code: classification });
    } else if (classification === "both_added_different") plan.conflicts.push({ family, id: family, code: classification });
  });
  const localTemplates = asArray(local.scopeTemplates); const cloudTemplates = asArray(cloud.scopeTemplates); const baseTemplates = asArray(baseline?.scopeTemplates);
  operationForFamily("scopeTemplates", localTemplates, cloudTemplates, baseTemplates, plan);
}

export function buildCloudConvergencePlan({ local = {}, cloud = {}, baseline = null, cloudSnapshot = null, companyId = "", storage } = {}) {
  const plan = {
    version: CLOUD_CONVERGENCE_VERSION, safe: false, classifications: [], conflicts: [], additions: { customers: [], projects: [], estimates: [], invoices: [], scopeTemplates: [] },
    replacements: { customers: [], projects: [], estimates: [], invoices: [], scopeTemplates: [] }, supplemental: {}, localOnly: false, codes: [], bindingEntries: [],
  };
  const graphCodes = [...relationshipCodes(local), ...relationshipCodes(cloud)];
  if (graphCodes.length) { plan.conflicts.push(...[...new Set(graphCodes)].map((code) => ({ family: "relationships", code }))); return plan; }
  const bindings = readCloudAssetBindings(companyId, storage);
  const customerBindings = cloudSnapshot?.uuidMaps ? bindingResolutionForFamily({ family: "customers", local: asArray(local.customers), cloud: asArray(cloud.customers), cloudSnapshot, bindings, companyId }) : null;
  const localCustomerIdByCloudId = new Map(customerBindings ? [...customerBindings.pairs.entries()].map(([localId, cloudId]) => [cloudId, localId]) : []);
  const cloudProjects = asArray(cloud.projects).map((project) => localCustomerIdByCloudId.has(asText(project?.customerId))
    ? { ...project, customerId: localCustomerIdByCloudId.get(asText(project.customerId)) }
    : project);
  const projectBindings = cloudSnapshot?.uuidMaps ? bindingResolutionForFamily({ family: "projects", local: asArray(local.projects), cloud: cloudProjects, cloudSnapshot, bindings, companyId }) : null;
  const bindingCodes = [...(customerBindings?.codes || []), ...(projectBindings?.codes || [])];
  if (bindingCodes.length) { plan.conflicts.push(...bindingCodes.map((code) => ({ family: "bindings", code }))); return plan; }
  if (customerBindings || projectBindings) plan.bindingEntries.push(...(customerBindings?.entries || []), ...(projectBindings?.entries || []));
  operationForFamily("customers", asArray(local.customers), asArray(cloud.customers), asArray(baseline?.customers), plan, customerBindings?.pairs);
  operationForFamily("projects", asArray(local.projects), cloudProjects, asArray(baseline?.projects), plan, projectBindings?.pairs);
  ["estimates", "invoices"].forEach((family) => operationForFamily(family, asArray(local[family]), asArray(cloud[family]), asArray(baseline?.[family]), plan));
  planSupplemental(local, cloud, baseline, plan);
  const planned = { ...local, customers: applyFamilyPlan(local.customers, plan, "customers"), projects: applyFamilyPlan(local.projects, plan, "projects") };
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
  if (!id || !snapshot || !["customers", "projects"].includes(family)) return null;
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
      if (!["customers", "projects"].includes(conflict.family) || !conflict.id) return;
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
