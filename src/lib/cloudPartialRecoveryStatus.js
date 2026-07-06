// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";

export const PARTIAL_CLOUD_RECOVERY_MODE = "partial_cloud_recovery";
export const PARTIAL_CLOUD_RECOVERY_STATUS = "finished_with_older_estimates_kept";
export const PARTIAL_CLOUD_RECOVERY_SKIPPED_REASON = "missing_full_estimate_details";

function asText(value) {
  return String(value || "").trim();
}

function asPositiveCount(value) {
  const count = Number(value || 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function normalizeSkippedEstimateIds(values) {
  return [...new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => asText(value))
      .filter(Boolean)
  )].sort();
}

export function readCloudPartialRecoveryStatus(storage = null) {
  const source = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!source?.getItem) return null;

  try {
    const raw = source.getItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (asText(parsed.recoveryMode) !== PARTIAL_CLOUD_RECOVERY_MODE) return null;
    if (asText(parsed.status) !== PARTIAL_CLOUD_RECOVERY_STATUS) return null;
    if (!parsed.olderEstimatesKeptInCloud) return null;

    const skippedEstimateIds = normalizeSkippedEstimateIds(parsed.skippedEstimateIds);
    const skippedEstimateCount = Math.max(
      asPositiveCount(parsed.skippedEstimateCount),
      skippedEstimateIds.length
    );
    if (skippedEstimateCount <= 0) return null;

    const normalized = {
      recoveryMode: PARTIAL_CLOUD_RECOVERY_MODE,
      status: PARTIAL_CLOUD_RECOVERY_STATUS,
      skippedEstimateCount,
      skippedReason: PARTIAL_CLOUD_RECOVERY_SKIPPED_REASON,
      recoveredAt: asText(parsed.recoveredAt) || "",
      olderEstimatesKeptInCloud: true,
    };
    if (skippedEstimateIds.length > 0) normalized.skippedEstimateIds = skippedEstimateIds;
    return normalized;
  } catch {
    return null;
  }
}

export function writeCloudPartialRecoveryStatus(storage = null, options = {}) {
  const target = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!target?.setItem) return null;

  const skippedEstimateIds = normalizeSkippedEstimateIds(options?.skippedEstimateIds);
  const skippedEstimateCount = Math.max(
    asPositiveCount(options?.skippedEstimateCount),
    skippedEstimateIds.length
  );
  if (skippedEstimateCount <= 0) return null;

  const payload = {
    recoveryMode: PARTIAL_CLOUD_RECOVERY_MODE,
    status: PARTIAL_CLOUD_RECOVERY_STATUS,
    skippedEstimateCount,
    skippedReason: PARTIAL_CLOUD_RECOVERY_SKIPPED_REASON,
    recoveredAt: asText(options?.recoveredAt) || new Date().toISOString(),
    olderEstimatesKeptInCloud: true,
  };
  if (skippedEstimateIds.length > 0) payload.skippedEstimateIds = skippedEstimateIds;

  try {
    target.setItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS, JSON.stringify(payload));
    return payload;
  } catch {
    return null;
  }
}

export function clearCloudPartialRecoveryStatus(storage = null) {
  const target = storage || (typeof localStorage !== "undefined" ? localStorage : null);
  if (!target) return;
  try {
    if (typeof target.removeItem === "function") {
      target.removeItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS);
      return;
    }
    if (typeof target.setItem === "function") {
      target.setItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS, "");
    }
  } catch {}
}
