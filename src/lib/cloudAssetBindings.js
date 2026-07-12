// @ts-nocheck
/* eslint-disable */

// Cloud Asset Identity bindings (Phase 1 sidecar).
//
// A local-only sidecar that remembers the durable Supabase row UUID for each
// company-owned business asset, keyed by the asset's local legacy id. It does
// NOT change any money-critical business record shape and does NOT replace the
// existing backup/reconciliation engine -- it is a first identity signal that
// still falls back to legacy-id matching + the existing reconciliation planner.
//
// The sidecar stores ONLY technical identifiers: entity type, local legacy id,
// cloud UUID, company id, source, and timestamps. It NEVER stores customer
// names, financial totals, notes, or payment details. Writing bindings never
// queues a business cloud backup.

import { STORAGE_KEYS } from "../constants/storageKeys";

export const CLOUD_ASSET_BINDINGS_VERSION = 1;
export const CLOUD_ASSET_BINDINGS_KEY = STORAGE_KEYS.CLOUD_ASSET_BINDINGS;

export const CLOUD_ASSET_ENTITY_TYPES = Object.freeze([
  "customer",
  "project",
  "estimate",
  "invoice",
  "invoice_payment",
]);
const ENTITY_TYPE_SET = new Set(CLOUD_ASSET_ENTITY_TYPES);

// Accepts any RFC-4122-shaped UUID (versions 1-8), case-insensitive.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asText(value) {
  return String(value == null ? "" : value).trim();
}

function nowTs() {
  return Date.now();
}

export function isValidCloudUuid(value) {
  return UUID_RE.test(asText(value));
}

export function isCloudAssetEntityType(value) {
  return ENTITY_TYPE_SET.has(asText(value));
}

function emptyBindingTables() {
  return { customer: {}, project: {}, estimate: {}, invoice: {}, invoice_payment: {} };
}

export function getDefaultCloudAssetBindings(companyId = "") {
  return {
    version: CLOUD_ASSET_BINDINGS_VERSION,
    companyId: asText(companyId),
    updatedAt: 0,
    bindings: emptyBindingTables(),
  };
}

function getStorage(storage) {
  if (storage) return storage;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

// Normalizes a single raw binding record. Returns null when any required
// identity field is missing/invalid, so malformed rows are dropped rather than
// trusted.
function normalizeBindingRecord(raw, { entityType, localLegacyId, companyId } = {}) {
  if (!raw || typeof raw !== "object") return null;
  const type = asText(entityType || raw.entityType);
  const legacy = asText(localLegacyId || raw.localLegacyId);
  const cloudUuid = asText(raw.cloudUuid);
  const company = asText(companyId || raw.companyId);
  if (!ENTITY_TYPE_SET.has(type)) return null;
  if (!legacy || !cloudUuid || !company) return null;
  if (!isValidCloudUuid(cloudUuid)) return null;
  const boundAt = Number(raw.boundAt);
  const lastConfirmedAt = Number(raw.lastConfirmedAt);
  return {
    entityType: type,
    localLegacyId: legacy,
    cloudUuid,
    companyId: company,
    source: asText(raw.source) || "unknown",
    boundAt: Number.isFinite(boundAt) && boundAt > 0 ? boundAt : nowTs(),
    lastConfirmedAt: Number.isFinite(lastConfirmedAt) && lastConfirmedAt > 0 ? lastConfirmedAt : nowTs(),
  };
}

// Validates a candidate binding for an operation, optionally against an
// expected company. Never throws.
export function validateCloudAssetBinding(binding, companyId = null) {
  const normalized = normalizeBindingRecord(binding);
  if (!normalized) return { ok: false, reason: "malformed_binding" };
  if (companyId != null && asText(companyId) && normalized.companyId !== asText(companyId)) {
    return { ok: false, reason: "company_mismatch" };
  }
  return { ok: true, binding: normalized };
}

// Reads and normalizes the whole stored state. Malformed storage fails closed
// to an empty safe structure.
function readRawState(storage) {
  try {
    const raw = getStorage(storage)?.getItem(CLOUD_ASSET_BINDINGS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const companyId = asText(parsed.companyId);
    const src = parsed.bindings && typeof parsed.bindings === "object" && !Array.isArray(parsed.bindings)
      ? parsed.bindings
      : {};
    const tables = emptyBindingTables();
    CLOUD_ASSET_ENTITY_TYPES.forEach((type) => {
      const table = src[type] && typeof src[type] === "object" && !Array.isArray(src[type]) ? src[type] : {};
      Object.keys(table).forEach((legacyId) => {
        const record = normalizeBindingRecord(table[legacyId], {
          entityType: type,
          localLegacyId: legacyId,
          companyId: asText(table[legacyId]?.companyId) || companyId,
        });
        // Only keep records that belong to the stored company scope.
        if (record && record.companyId === companyId) {
          tables[type][record.localLegacyId] = record;
        }
      });
    });
    return {
      version: CLOUD_ASSET_BINDINGS_VERSION,
      companyId,
      updatedAt: Number(parsed.updatedAt) > 0 ? Number(parsed.updatedAt) : 0,
      bindings: tables,
    };
  } catch {
    return null;
  }
}

// Company-scoped read. If the stored state belongs to a different company than
// the one requested, returns an empty structure (no cross-company leakage).
export function readCloudAssetBindings(companyId = "", storage) {
  const cid = asText(companyId);
  const state = readRawState(getStorage(storage));
  if (!state) return getDefaultCloudAssetBindings(cid);
  if (cid && state.companyId && state.companyId !== cid) return getDefaultCloudAssetBindings(cid);
  if (!state.companyId) return getDefaultCloudAssetBindings(cid);
  return state;
}

export function writeCloudAssetBindings(state, storage) {
  const target = getStorage(storage);
  if (!target?.setItem) return false;
  const next = {
    version: CLOUD_ASSET_BINDINGS_VERSION,
    companyId: asText(state?.companyId),
    updatedAt: nowTs(),
    bindings: state?.bindings && typeof state.bindings === "object" ? state.bindings : emptyBindingTables(),
  };
  try {
    const serialized = JSON.stringify(next);
    target.setItem(CLOUD_ASSET_BINDINGS_KEY, serialized);
    // Mirror the app's localStorage-write convention so listeners stay in sync.
    // This is a metadata write only -- it never marks the business backup queue.
    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", {
        detail: { key: CLOUD_ASSET_BINDINGS_KEY, value: serialized },
      }));
    } catch {}
    return true;
  } catch {
    return false;
  }
}

export function getCloudAssetBinding(entityType, localLegacyId, companyId = "", storage) {
  const type = asText(entityType);
  const legacy = asText(localLegacyId);
  if (!ENTITY_TYPE_SET.has(type) || !legacy) return null;
  const state = readCloudAssetBindings(companyId, storage);
  return state.bindings[type]?.[legacy] || null;
}

// Loads the state for a company, resetting to a fresh company scope if the
// stored state belongs to a different company.
function loadScopedStateForWrite(companyId, storage) {
  const cid = asText(companyId);
  const state = readRawState(getStorage(storage));
  if (!state || !state.companyId || state.companyId !== cid) {
    return getDefaultCloudAssetBindings(cid);
  }
  return state;
}

// Applies one binding to an in-memory state, enforcing the identity guards.
// Returns { ok, reason }. `reconciliation: true` authorizes an explicit,
// proven rebind (a stale local-id binding may be replaced, and a cloud UUID
// may move to the current local id).
function applyBindingToState(state, rawBinding, { reconciliation = false } = {}) {
  const validated = validateCloudAssetBinding({ ...rawBinding, companyId: rawBinding.companyId || state.companyId }, state.companyId);
  if (!validated.ok) return { ok: false, reason: validated.reason };
  const binding = validated.binding;
  const table = state.bindings[binding.entityType];

  // Guard 6: this local record already binds to a DIFFERENT cloud UUID.
  const existingForLocal = table[binding.localLegacyId];
  if (existingForLocal && existingForLocal.cloudUuid !== binding.cloudUuid && !reconciliation) {
    return { ok: false, reason: "local_rebind_conflict" };
  }

  // Guard 5: this cloud UUID already binds to a DIFFERENT local record of the
  // same entity type.
  const collidingLocalId = Object.keys(table).find(
    (legacyId) => table[legacyId]?.cloudUuid === binding.cloudUuid && legacyId !== binding.localLegacyId
  );
  if (collidingLocalId && !reconciliation) {
    return { ok: false, reason: "uuid_reused" };
  }

  // A proven reconciliation replaces any stale binding on that cloud UUID.
  if (collidingLocalId && reconciliation) {
    delete table[collidingLocalId];
  }

  table[binding.localLegacyId] = {
    ...binding,
    boundAt: existingForLocal?.boundAt && existingForLocal.cloudUuid === binding.cloudUuid
      ? existingForLocal.boundAt
      : binding.boundAt,
    lastConfirmedAt: nowTs(),
  };
  return { ok: true };
}

export function setCloudAssetBinding(rawBinding, { reconciliation = false, storage } = {}) {
  const companyId = asText(rawBinding?.companyId);
  const state = loadScopedStateForWrite(companyId, storage);
  const applied = applyBindingToState(state, rawBinding, { reconciliation });
  if (!applied.ok) return { ok: false, reason: applied.reason };
  const written = writeCloudAssetBindings(state, storage);
  return written ? { ok: true, binding: state.bindings[asText(rawBinding.entityType)][asText(rawBinding.localLegacyId)] } : { ok: false, reason: "write_failed" };
}

// Batch apply. `reconciliationKeys` is a Set/array of `${entityType}:${localLegacyId}`
// that are proven reconciliations and may rebind. Returns a non-sensitive
// summary of what was written vs skipped.
export function setCloudAssetBindingsBatch(companyId, entries, { reconciliationKeys = null, storage } = {}) {
  const cid = asText(companyId);
  const state = loadScopedStateForWrite(cid, storage);
  const reconSet = reconciliationKeys instanceof Set
    ? reconciliationKeys
    : new Set(Array.isArray(reconciliationKeys) ? reconciliationKeys.map((k) => asText(k)) : []);
  const list = Array.isArray(entries) ? entries : [];
  let written = 0;
  const skipped = [];
  list.forEach((entry) => {
    const type = asText(entry?.entityType);
    const legacy = asText(entry?.localLegacyId);
    const reconciliation = reconSet.has(`${type}:${legacy}`) || Boolean(entry?.reconciliation);
    const applied = applyBindingToState(state, { ...entry, companyId: entry?.companyId || cid }, { reconciliation });
    if (applied.ok) written += 1;
    else skipped.push({ entityType: type, localLegacyId: legacy, reason: applied.reason });
  });
  const ok = written > 0 || list.length === 0 ? writeCloudAssetBindings(state, storage) : true;
  return { ok, written, skipped, total: list.length };
}

// Removes one binding. Operates on whatever company scope is currently stored,
// so callers that only know the local record id (e.g. a hard-delete handler)
// do not need the company id. When a companyId is given that does not match the
// stored scope, nothing is removed.
export function removeCloudAssetBinding(entityType, localLegacyId, companyId = "", storage) {
  const type = asText(entityType);
  const legacy = asText(localLegacyId);
  if (!ENTITY_TYPE_SET.has(type) || !legacy) return { ok: false, reason: "invalid_key" };
  const state = readRawState(getStorage(storage));
  if (!state || !state.companyId) return { ok: true, removed: false };
  if (asText(companyId) && state.companyId !== asText(companyId)) return { ok: true, removed: false };
  if (!state.bindings[type]?.[legacy]) return { ok: true, removed: false };
  delete state.bindings[type][legacy];
  const written = writeCloudAssetBindings(state, storage);
  return written ? { ok: true, removed: true } : { ok: false, reason: "write_failed" };
}

export function clearCloudAssetBindingsForCompany(companyId = "", storage) {
  const cid = asText(companyId);
  const state = readRawState(getStorage(storage));
  // Only clear when the stored scope matches (or is empty); never wipe a
  // different company's bindings from here.
  if (state && state.companyId && cid && state.companyId !== cid) {
    return { ok: true, cleared: false };
  }
  return writeCloudAssetBindings(getDefaultCloudAssetBindings(cid), storage)
    ? { ok: true, cleared: true }
    : { ok: false, reason: "write_failed" };
}

function bindingTimestamp(record) {
  return Math.max(Number(record?.lastConfirmedAt) || 0, Number(record?.boundAt) || 0);
}

// Imports bindings from a This-Device backup artifact (or a raw sidecar state).
// Read-only with respect to business data: it only writes binding rows, only for
// the current company scope, skips anything invalid, and preserves a newer local
// binding over an older imported one. It never force-rebinds a conflicting UUID.
export function importCloudAssetBindingsFromArtifact(artifact, { companyId = "", storage } = {}) {
  const cid = asText(companyId);
  const sidecar = artifact && typeof artifact === "object" && artifact.cloudAssetBindings !== undefined
    ? artifact.cloudAssetBindings
    : artifact;
  const summary = { ok: true, imported: 0, skipped: [], companyScopeMismatch: false };

  if (!sidecar || typeof sidecar !== "object" || Array.isArray(sidecar)) {
    return summary; // Nothing to import.
  }
  const sidecarCompany = asText(sidecar.companyId);
  // Company-scope guard: never import another company's bindings.
  if (!cid || !sidecarCompany || sidecarCompany !== cid) {
    return { ...summary, ok: false, companyScopeMismatch: true };
  }

  const state = loadScopedStateForWrite(cid, storage);
  const src = sidecar.bindings && typeof sidecar.bindings === "object" && !Array.isArray(sidecar.bindings)
    ? sidecar.bindings
    : {};

  CLOUD_ASSET_ENTITY_TYPES.forEach((type) => {
    const table = src[type] && typeof src[type] === "object" && !Array.isArray(src[type]) ? src[type] : {};
    Object.keys(table).forEach((legacyId) => {
      const incoming = table[legacyId];
      const validated = validateCloudAssetBinding({ ...incoming, entityType: type, localLegacyId: legacyId, companyId: cid }, cid);
      if (!validated.ok) {
        summary.skipped.push({ entityType: type, localLegacyId: legacyId, reason: validated.reason || "invalid" });
        return;
      }
      // Preserve a newer existing local binding over an older imported one.
      const existing = state.bindings[type]?.[legacyId];
      if (existing && bindingTimestamp(existing) >= bindingTimestamp(validated.binding)) {
        summary.skipped.push({ entityType: type, localLegacyId: legacyId, reason: "local_binding_newer" });
        return;
      }
      // Merge without force-rebind: a conflicting UUID must not silently win.
      const applied = applyBindingToState(state, { ...validated.binding }, { reconciliation: false });
      if (applied.ok) summary.imported += 1;
      else summary.skipped.push({ entityType: type, localLegacyId: legacyId, reason: applied.reason });
    });
  });

  const written = writeCloudAssetBindings(state, storage);
  return { ...summary, ok: written };
}

// Flattens the stored bindings into the shape the identity planner consumes:
// { customer: { [localLegacyId]: cloudUuid }, project: {...}, ... }. Company
// scoped and read-only.
export function getCloudAssetBindingUuidMap(companyId = "", storage) {
  const state = readCloudAssetBindings(companyId, storage);
  const out = {};
  CLOUD_ASSET_ENTITY_TYPES.forEach((type) => {
    const table = state.bindings[type] || {};
    const flat = {};
    Object.keys(table).forEach((legacyId) => {
      const uuid = asText(table[legacyId]?.cloudUuid);
      if (uuid) flat[legacyId] = uuid;
    });
    out[type] = flat;
  });
  return out;
}

// Inverts the bindings into a cloud-UUID -> { entityType, localLegacyId } map,
// used to detect two local records claiming the same UUID.
export function invertCloudAssetBindingsByUuid(companyId = "", storage) {
  const state = readCloudAssetBindings(companyId, storage);
  const byUuid = {};
  CLOUD_ASSET_ENTITY_TYPES.forEach((type) => {
    const table = state.bindings[type] || {};
    Object.keys(table).forEach((legacyId) => {
      const uuid = asText(table[legacyId]?.cloudUuid);
      if (!uuid) return;
      const key = `${type}:${uuid}`;
      if (!byUuid[key]) byUuid[key] = [];
      byUuid[key].push({ entityType: type, localLegacyId: legacyId, cloudUuid: uuid });
    });
  });
  return byUuid;
}

// Non-sensitive diagnostic summary: counts only, never identifiers or business
// content. Safe to log or surface in developer diagnostics.
export function exportCloudAssetBindingsDiagnosticSummary(companyId = "", storage) {
  const state = readCloudAssetBindings(companyId, storage);
  const perEntity = {};
  let total = 0;
  CLOUD_ASSET_ENTITY_TYPES.forEach((type) => {
    const count = Object.keys(state.bindings[type] || {}).length;
    perEntity[type] = count;
    total += count;
  });
  return {
    version: state.version,
    hasCompanyScope: Boolean(state.companyId),
    updatedAt: state.updatedAt,
    totalBindings: total,
    perEntity,
  };
}
