// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { buildLocalSnapshotFromStorage } from "./localDataIntegrity";
import { readCloudAssetBindings } from "./cloudAssetBindings";

export const CLOUD_SYNC_BASELINE_VERSION = 1;
export const CLOUD_SYNC_BASELINE_KEY = STORAGE_KEYS.CLOUD_SYNC_BASELINE;

const asText = (value) => String(value == null ? "" : value).trim();
const asArray = (value) => Array.isArray(value) ? value : [];

// A baseline is a COMPARISON record, never a data source: nothing ever reads a
// business value back out of it (the planner builds writes from local + cloud
// only). So an inline data URL -- a 1.6M-character logo, a 100K scope image --
// costs a full duplicate copy in localStorage while contributing nothing but
// "did this change?". Baselines keep a content-sensitive digest of those
// strings instead. The real images in company profile and scope templates are
// never touched, resized, recompressed, or rewritten.
export const CLOUD_SYNC_OPAQUE_MARKER = "__estipaidCloudSyncOpaque";
export const CLOUD_SYNC_OPAQUE_KIND = "data-url-v1";
export const CLOUD_SYNC_SNAPSHOT_ENCODING = "opaque-digest-v1";

export function isCloudSyncOpaqueString(value) {
  return typeof value === "string" && value.startsWith("data:");
}

function isCloudSyncOpaqueToken(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && value[CLOUD_SYNC_OPAQUE_MARKER] === CLOUD_SYNC_OPAQUE_KIND
    && Number.isFinite(Number(value.length)) && typeof value.digest === "string" && value.digest !== "";
}

// Two independent 32-bit lanes over the COMPLETE string -> 64 effective bits.
// Lane 1 is FNV-1a. Lane 2 mixes each character with its position and rotates,
// so transpositions and equal-length middle edits diverge. Deterministic and
// synchronous: a baseline capture cannot await anything.
export function digestCloudSyncOpaqueString(value) {
  const text = typeof value === "string" ? value : String(value == null ? "" : value);
  let h1 = 0x811c9dc5;
  let h2 = (0x01000193 ^ text.length) >>> 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
    h2 = Math.imul((h2 ^ (code + index)) >>> 0, 0x85ebca6b) >>> 0;
    h2 = ((h2 << 13) | (h2 >>> 19)) >>> 0;
  }
  h1 = (h1 ^ (h1 >>> 16)) >>> 0;
  h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  return `fnv1a64:${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

// The canonical compact representation of one persistent data URL.
export function projectCloudSyncBaselineValue(value) {
  if (isCloudSyncOpaqueToken(value)) {
    return { [CLOUD_SYNC_OPAQUE_MARKER]: CLOUD_SYNC_OPAQUE_KIND, length: Number(value.length), digest: String(value.digest) };
  }
  if (!isCloudSyncOpaqueString(value)) return null;
  return { [CLOUD_SYNC_OPAQUE_MARKER]: CLOUD_SYNC_OPAQUE_KIND, length: value.length, digest: digestCloudSyncOpaqueString(value) };
}

export function normalizeCloudSyncValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    // A raw data URL and its token normalize to the same thing, so an existing
    // full baseline holding raw data URLs still compares correctly.
    if (isCloudSyncOpaqueString(value)) return projectCloudSyncBaselineValue(value);
    const numeric = Number(value);
    if (value.trim() !== "" && Number.isFinite(numeric)) return numeric;
    const parsed = /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value.trim();
  }
  if (Array.isArray(value)) return value.map(normalizeCloudSyncValue);
  if (typeof value === "object") {
    if (isCloudSyncOpaqueToken(value)) return projectCloudSyncBaselineValue(value);
    return Object.keys(value).sort().reduce((out, key) => {
      const normalized = normalizeCloudSyncValue(value[key]);
      if (normalized !== null) out[key] = normalized;
      return out;
    }, {});
  }
  return value;
}

export function cloudSyncEqual(left, right) {
  return JSON.stringify(normalizeCloudSyncValue(left)) === JSON.stringify(normalizeCloudSyncValue(right));
}

export function stableCloudSyncHash(value) {
  const text = JSON.stringify(normalizeCloudSyncValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16)}`;
}

function readRaw(storage, key) {
  try { return storage?.getItem?.(key) ?? null; } catch { return null; }
}

export function readCloudSyncBaseline(companyId = "", storage = localStorage) {
  try {
    const raw = readRaw(storage, CLOUD_SYNC_BASELINE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CLOUD_SYNC_BASELINE_VERSION || asText(parsed.companyId) !== asText(companyId)) return null;
    if (!parsed.snapshots || typeof parsed.snapshots !== "object") return null;
    return parsed;
  } catch { return null; }
}

export function buildCloudSyncBaseline({ companyId, queueRevision = 0, localSnapshot, cloudSnapshot, bindings, verifiedAt = new Date().toISOString() } = {}) {
  const local = localSnapshot || {};
  const cloud = cloudSnapshot || {};
  return {
    version: CLOUD_SYNC_BASELINE_VERSION,
    companyId: asText(companyId),
    verifiedAt,
    queueRevision: Number(queueRevision || 0),
    // Declares that data URLs in `snapshots` are digest tokens. Older baselines
    // simply omit it and stay readable: normalizeCloudSyncValue collapses their
    // raw data URLs to the same tokens at comparison time.
    snapshotEncoding: CLOUD_SYNC_SNAPSHOT_ENCODING,
    snapshots: normalizeCloudSyncValue({
      companyProfile: local.companyProfile || cloud.companyProfile || null,
      settings: local.settings || cloud.settings || null,
      scopeTemplates: asArray(local.scopeTemplates || cloud.scopeTemplates),
      customers: asArray(local.customers), projects: asArray(local.projects), estimates: asArray(local.estimates), invoices: asArray(local.invoices),
      estimateLineItems: asArray(local.estimateLineItems), invoiceLineItems: asArray(local.invoiceLineItems), invoicePayments: asArray(local.invoicePayments),
      bindings: bindings || null,
    }),
    hashes: {
      local: stableCloudSyncHash(local), cloud: stableCloudSyncHash(cloud), bindings: stableCloudSyncHash(bindings || null),
    },
  };
}

// Browsers report a full localStorage as a DOMException named
// QuotaExceededError (legacy code 22), or NS_ERROR_DOM_QUOTA_REACHED (1014) on
// Firefox. Detected by safe name/code checks only -- never by message text.
function isQuotaError(error) {
  if (!error) return false;
  const name = String(error.name || "");
  const code = Number(error.code);
  return name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED" || code === 22 || code === 1014;
}

// The detailed writer. Collapsing every failure to `false` is what turned a
// diagnosable "the baseline does not fit" into an opaque baseline_write_failed.
export function writeCloudSyncBaselineDetailed(baseline, storage = localStorage) {
  if (!baseline?.companyId || !storage?.setItem) {
    return { ok: false, code: "baseline_storage_unavailable", errorName: "", serializedLength: 0, estimatedUtf16Bytes: 0 };
  }
  let value;
  try {
    value = JSON.stringify(baseline);
  } catch (error) {
    return { ok: false, code: "baseline_serialization_failed", errorName: String(error?.name || ""), serializedLength: 0, estimatedUtf16Bytes: 0 };
  }
  const serializedLength = value.length;
  const estimatedUtf16Bytes = serializedLength * 2;
  try {
    storage.setItem(CLOUD_SYNC_BASELINE_KEY, value);
  } catch (error) {
    return {
      ok: false,
      code: isQuotaError(error) ? "baseline_quota_exceeded" : "baseline_write_failed",
      errorName: String(error?.name || ""),
      serializedLength,
      estimatedUtf16Bytes,
    };
  }
  if (readRaw(storage, CLOUD_SYNC_BASELINE_KEY) !== value) {
    return { ok: false, code: "baseline_readback_mismatch", errorName: "", serializedLength, estimatedUtf16Bytes };
  }
  return { ok: true, serializedLength, estimatedUtf16Bytes };
}

// Boolean wrapper kept for existing callers.
export function writeCloudSyncBaseline(baseline, storage = localStorage) {
  return writeCloudSyncBaselineDetailed(baseline, storage).ok;
}

// Gate 16H: a baseline written by an older build holds full inline data URLs
// (the live Mac's was 2,136,696 chars). That record is not just wasted space --
// it becomes the `previous` value inside the rollback journal, so a transaction
// that must be able to restore it has to hold a SECOND copy. Compacting it
// first is information-preserving: normalizeCloudSyncValue collapses a raw data
// URL and its token to the same value, so the compacted baseline compares
// exactly as the original did. Idempotent, and never touches business data.
export function compactStoredCloudSyncBaseline({ storage = localStorage, companyId = "" } = {}) {
  const raw = readRaw(storage, CLOUD_SYNC_BASELINE_KEY);
  if (!raw) return { ok: true, migrated: false, code: "baseline_absent", beforeLength: 0, afterLength: 0 };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, migrated: false, code: "baseline_unreadable", beforeLength: raw.length, afterLength: raw.length };
  }
  if (!parsed || typeof parsed !== "object" || !parsed.snapshots || typeof parsed.snapshots !== "object") {
    return { ok: false, migrated: false, code: "baseline_unreadable", beforeLength: raw.length, afterLength: raw.length };
  }
  // Never adopt another workspace's baseline.
  if (asText(companyId) && asText(parsed.companyId) !== asText(companyId)) {
    return { ok: false, migrated: false, code: "baseline_company_mismatch", beforeLength: raw.length, afterLength: raw.length };
  }
  if (asText(parsed.snapshotEncoding) === CLOUD_SYNC_SNAPSHOT_ENCODING) {
    return { ok: true, migrated: false, code: "baseline_already_compact", beforeLength: raw.length, afterLength: raw.length };
  }
  const compact = { ...parsed, snapshotEncoding: CLOUD_SYNC_SNAPSHOT_ENCODING, snapshots: normalizeCloudSyncValue(parsed.snapshots) };
  // Refuse to replace a baseline with one that does not still mean the same
  // thing -- the whole point is that this rewrite changes nothing but size.
  if (!cloudSyncEqual(parsed.snapshots, compact.snapshots)) {
    return { ok: false, migrated: false, code: "baseline_compaction_unsafe", beforeLength: raw.length, afterLength: raw.length };
  }
  const write = writeCloudSyncBaselineDetailed(compact, storage);
  if (!write.ok) return { ok: false, migrated: false, code: write.code, beforeLength: raw.length, afterLength: raw.length };
  return { ok: true, migrated: true, code: "", beforeLength: raw.length, afterLength: write.serializedLength };
}

export function captureVerifiedCloudSyncBaseline({ storage = localStorage, companyId = "", queueRevision = 0, cloudSnapshot = null, verified = false, deviceAccess = null } = {}) {
  if (!verified || deviceAccess?.ok === false || !cloudSnapshot?.ok) return { ok: false, code: "baseline_capture_not_verified" };
  const local = buildLocalSnapshotFromStorage(storage).snapshot;
  const baseline = buildCloudSyncBaseline({
    companyId,
    queueRevision,
    localSnapshot: local,
    cloudSnapshot: cloudSnapshot.mapped,
    bindings: readCloudAssetBindings(companyId, storage),
  });
  const write = writeCloudSyncBaselineDetailed(baseline, storage);
  // Preserve the precise reason so convergence can report baseline_quota_exceeded
  // rather than collapsing everything into baseline_write_failed.
  return write.ok
    ? { ok: true, baseline, serializedLength: write.serializedLength, estimatedUtf16Bytes: write.estimatedUtf16Bytes }
    : { ok: false, code: write.code, errorName: write.errorName, serializedLength: write.serializedLength, estimatedUtf16Bytes: write.estimatedUtf16Bytes };
}
