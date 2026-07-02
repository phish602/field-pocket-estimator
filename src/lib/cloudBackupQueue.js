// @ts-nocheck
/* eslint-disable */

// Centralized "cloud backup dirty" marker. This is the trigger/queue
// foundation for automatic cloud backup: every conscious durable user edit
// calls markCloudBackupDirty() so a future background worker knows local
// data has changed and needs to be protected in the cloud. This module does
// not perform any network activity itself and must never block or throw
// into a caller's local save flow.

import { STORAGE_KEYS } from "../constants/storageKeys";

export const CLOUD_BACKUP_QUEUE_SCHEMA_VERSION = "1.0.0";

export const CLOUD_BACKUP_SEVERITY = {
  LOW: "low",
  NORMAL: "normal",
  MONEY_CRITICAL: "money_critical",
};

export const CLOUD_BACKUP_PRIORITY = {
  IMMEDIATE: "immediate",
  NORMAL: "normal",
  DEFERRED: "deferred",
};

export const CLOUD_BACKUP_STATUS = {
  PENDING: "pending",
  CURRENT: "current",
  FAILED: "failed",
};

const SEVERITY_RANK = {
  [CLOUD_BACKUP_SEVERITY.LOW]: 0,
  [CLOUD_BACKUP_SEVERITY.NORMAL]: 1,
  [CLOUD_BACKUP_SEVERITY.MONEY_CRITICAL]: 2,
};

const PRIORITY_RANK = {
  [CLOUD_BACKUP_PRIORITY.DEFERRED]: 0,
  [CLOUD_BACKUP_PRIORITY.NORMAL]: 1,
  [CLOUD_BACKUP_PRIORITY.IMMEDIATE]: 2,
};

const MAX_RECENT_REASONS = 20;
const MAX_DOMAINS = 30;

function canUseStorage() {
  try {
    return typeof localStorage !== "undefined" && !!localStorage;
  } catch {
    return false;
  }
}

function nowTs() {
  return Date.now();
}

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function dedupeStrings(list, max) {
  const seen = new Set();
  const out = [];
  for (const value of list) {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out.length > max ? out.slice(out.length - max) : out;
}

function normalizeSeverity(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SEVERITY_RANK, normalized)
    ? normalized
    : CLOUD_BACKUP_SEVERITY.NORMAL;
}

function higherSeverity(a, b) {
  const normalizedA = normalizeSeverity(a);
  const normalizedB = normalizeSeverity(b);
  return SEVERITY_RANK[normalizedA] >= SEVERITY_RANK[normalizedB] ? normalizedA : normalizedB;
}

function normalizePriority(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(PRIORITY_RANK, normalized) ? normalized : "";
}

function higherPriority(a, b) {
  const normalizedA = normalizePriority(a) || CLOUD_BACKUP_PRIORITY.DEFERRED;
  const normalizedB = normalizePriority(b) || CLOUD_BACKUP_PRIORITY.DEFERRED;
  return PRIORITY_RANK[normalizedA] >= PRIORITY_RANK[normalizedB] ? normalizedA : normalizedB;
}

function defaultPriorityForSeverity(severity) {
  return severity === CLOUD_BACKUP_SEVERITY.MONEY_CRITICAL
    ? CLOUD_BACKUP_PRIORITY.IMMEDIATE
    : CLOUD_BACKUP_PRIORITY.NORMAL;
}

function defaultQueueState() {
  return {
    schemaVersion: CLOUD_BACKUP_QUEUE_SCHEMA_VERSION,
    pending: false,
    status: CLOUD_BACKUP_STATUS.CURRENT,
    reasons: [],
    domains: [],
    severity: CLOUD_BACKUP_SEVERITY.LOW,
    priority: CLOUD_BACKUP_PRIORITY.DEFERRED,
    createdAt: null,
    updatedAt: null,
    attempts: 0,
    lastAttemptAt: null,
    lastError: "",
    lastSuccessfulBackupAt: null,
    source: "",
    documentId: "",
    // Reserved for a future local-fingerprint/hash engine that can prove
    // local data actually differs from the last known cloud state. Not
    // populated or required by this lane.
    localFingerprint: null,
  };
}

function isValidStatus(value) {
  return value === CLOUD_BACKUP_STATUS.PENDING
    || value === CLOUD_BACKUP_STATUS.CURRENT
    || value === CLOUD_BACKUP_STATUS.FAILED;
}

function normalizeQueueState(raw) {
  const base = defaultQueueState();
  if (!raw || typeof raw !== "object") return base;

  return {
    ...base,
    ...raw,
    schemaVersion: CLOUD_BACKUP_QUEUE_SCHEMA_VERSION,
    pending: Boolean(raw.pending),
    status: isValidStatus(raw.status) ? raw.status : base.status,
    reasons: dedupeStrings(asArray(raw.reasons), MAX_RECENT_REASONS),
    domains: dedupeStrings(asArray(raw.domains), MAX_DOMAINS),
    severity: normalizeSeverity(raw.severity),
    priority: normalizePriority(raw.priority) || base.priority,
    attempts: Number.isFinite(Number(raw.attempts)) && Number(raw.attempts) >= 0 ? Number(raw.attempts) : 0,
    source: String(raw.source || "").trim(),
    documentId: String(raw.documentId || "").trim(),
    lastError: String(raw.lastError || "").trim(),
  };
}

/**
 * Reads the persisted cloud-backup queue state. Always returns a
 * fully-shaped object, even if nothing has been written yet or localStorage
 * is unavailable.
 */
export function readCloudBackupQueueState() {
  if (!canUseStorage()) return defaultQueueState();
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
    if (!raw) return defaultQueueState();
    return normalizeQueueState(JSON.parse(raw));
  } catch {
    return defaultQueueState();
  }
}

function writeQueueState(state) {
  if (!canUseStorage()) return state;
  try {
    const serialized = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, serialized);
    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", {
        detail: { key: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: serialized },
      }));
    } catch {}
  } catch {}
  return state;
}

/**
 * Normalizes a raw mutation-event input into the shape stored/merged by the
 * queue. Metadata only — never pass raw document payloads here.
 */
export function buildBackupDirtyEvent(input = {}) {
  const severity = normalizeSeverity(input?.severity);
  const priority = normalizePriority(input?.priority) || defaultPriorityForSeverity(severity);
  const createdAtCandidate = Number(input?.createdAt);

  return {
    reason: String(input?.reason || "").trim() || "unspecified_mutation",
    domains: dedupeStrings(asArray(input?.domains), MAX_DOMAINS),
    severity,
    priority,
    source: String(input?.source || "").trim(),
    documentId: String(input?.documentId || "").trim(),
    createdAt: Number.isFinite(createdAtCandidate) && createdAtCandidate > 0 ? createdAtCandidate : nowTs(),
  };
}

/**
 * Marks the local cloud-backup queue dirty/pending. Safe to call from any
 * conscious durable save/update/delete/status-change path. Never throws,
 * never blocks, and never stores raw user document data — metadata only.
 */
export function markCloudBackupDirty(event) {
  try {
    const normalizedEvent = buildBackupDirtyEvent(event);
    const current = readCloudBackupQueueState();
    const ts = nowTs();

    const next = {
      ...current,
      pending: true,
      status: CLOUD_BACKUP_STATUS.PENDING,
      reasons: dedupeStrings([...current.reasons, normalizedEvent.reason], MAX_RECENT_REASONS),
      domains: dedupeStrings([...current.domains, ...normalizedEvent.domains], MAX_DOMAINS),
      severity: higherSeverity(current.severity, normalizedEvent.severity),
      priority: higherPriority(current.priority, normalizedEvent.priority),
      createdAt: current.pending && current.createdAt ? current.createdAt : ts,
      updatedAt: ts,
      source: normalizedEvent.source || current.source,
      documentId: normalizedEvent.documentId || current.documentId,
    };

    return writeQueueState(next);
  } catch {
    // A queue-marking failure must never interrupt the caller's local save.
    try {
      return readCloudBackupQueueState();
    } catch {
      return defaultQueueState();
    }
  }
}

/**
 * Clears the pending/dirty state, marking the queue current. Used after a
 * confirmed successful backup, or after a cloud restore that made local data
 * equal to cloud (so nothing is actually dirty relative to the cloud).
 */
export function clearCloudBackupDirty(reason) {
  try {
    const current = readCloudBackupQueueState();
    const ts = nowTs();
    const normalizedReason = String(reason || "").trim();

    const next = {
      ...current,
      pending: false,
      status: CLOUD_BACKUP_STATUS.CURRENT,
      reasons: [],
      domains: [],
      severity: CLOUD_BACKUP_SEVERITY.LOW,
      priority: CLOUD_BACKUP_PRIORITY.DEFERRED,
      updatedAt: ts,
      lastSuccessfulBackupAt: ts,
      lastError: "",
      source: normalizedReason || current.source,
    };

    return writeQueueState(next);
  } catch {
    try {
      return readCloudBackupQueueState();
    } catch {
      return defaultQueueState();
    }
  }
}

/**
 * Records a failed backup attempt without clearing the pending state. Not
 * required by any wired-in caller yet (the upload worker itself is a future
 * gate), but kept small and safe so that worker can adopt it directly.
 */
export function recordCloudBackupAttemptFailure(errorMessage) {
  try {
    const current = readCloudBackupQueueState();
    const ts = nowTs();

    const next = {
      ...current,
      status: current.pending ? CLOUD_BACKUP_STATUS.FAILED : current.status,
      attempts: current.attempts + 1,
      lastAttemptAt: ts,
      lastError: String(errorMessage || "").trim(),
      updatedAt: ts,
    };

    return writeQueueState(next);
  } catch {
    try {
      return readCloudBackupQueueState();
    } catch {
      return defaultQueueState();
    }
  }
}
