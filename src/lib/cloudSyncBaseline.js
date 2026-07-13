// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { buildLocalSnapshotFromStorage } from "./localDataIntegrity";
import { readCloudAssetBindings } from "./cloudAssetBindings";

export const CLOUD_SYNC_BASELINE_VERSION = 1;
export const CLOUD_SYNC_BASELINE_KEY = STORAGE_KEYS.CLOUD_SYNC_BASELINE;

const asText = (value) => String(value == null ? "" : value).trim();
const asArray = (value) => Array.isArray(value) ? value : [];

export function normalizeCloudSyncValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const numeric = Number(value);
    if (value.trim() !== "" && Number.isFinite(numeric)) return numeric;
    const parsed = /^\d{4}-\d{2}-\d{2}T/.test(value) ? Date.parse(value) : NaN;
    return Number.isFinite(parsed) ? new Date(parsed).toISOString() : value.trim();
  }
  if (Array.isArray(value)) return value.map(normalizeCloudSyncValue);
  if (typeof value === "object") return Object.keys(value).sort().reduce((out, key) => {
    const normalized = normalizeCloudSyncValue(value[key]);
    if (normalized !== null) out[key] = normalized;
    return out;
  }, {});
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

export function writeCloudSyncBaseline(baseline, storage = localStorage) {
  if (!baseline?.companyId || !storage?.setItem) return false;
  try {
    const value = JSON.stringify(baseline);
    storage.setItem(CLOUD_SYNC_BASELINE_KEY, value);
    return readRaw(storage, CLOUD_SYNC_BASELINE_KEY) === value;
  } catch { return false; }
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
  return writeCloudSyncBaseline(baseline, storage) ? { ok: true, baseline } : { ok: false, code: "baseline_write_failed" };
}
