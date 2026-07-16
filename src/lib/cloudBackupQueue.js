// @ts-nocheck
/* eslint-disable */

// Centralized "cloud backup dirty" marker. This is the trigger/queue
// foundation for automatic cloud backup: every conscious durable user edit
// calls markCloudBackupDirty() so a future background worker knows local
// data has changed and needs to be protected in the cloud. This module does
// not perform any network activity itself and must never block or throw
// into a caller's local save flow.

import { STORAGE_KEYS } from "../constants/storageKeys";

export const CLOUD_BACKUP_QUEUE_SCHEMA_VERSION = "2.0.0";

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
  CLEAN: "clean",
  PENDING: "pending",
  SYNCING: "syncing",
  OFFLINE_PENDING: "offline_pending",
  RETRY_WAIT: "retry_wait",
  NEEDS_ATTENTION: "needs_attention",
  REMOTE_CHANGED: "remote_changed",
  CONFLICT: "conflict",
  // Compatibility value for queue snapshots written before the sync model.
  CURRENT: "clean",
  FAILED: "retry_wait",
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
    status: CLOUD_BACKUP_STATUS.CLEAN,
    reasons: [],
    domains: [],
    severity: CLOUD_BACKUP_SEVERITY.LOW,
    priority: CLOUD_BACKUP_PRIORITY.DEFERRED,
    createdAt: null,
    updatedAt: null,
    attempts: 0,
    lastError: "",
    lastSuccessfulBackupAt: null,
    lastVerifiedAt: null,
    lastQueuedAt: null,
    lastAttemptAt: null,
    nextRetryAt: null,
    retryCount: 0,
    localMutationRevision: 0,
    syncingRevision: null,
    companyId: "",
    activeDeviceId: "",
    lastErrorCode: "",
    source: "",
    documentId: "",
    // Reserved for a future local-fingerprint/hash engine that can prove
    // local data actually differs from the last known cloud state. Not
    // populated or required by this lane.
    localFingerprint: null,
  };
}

function isValidStatus(value) {
  return Object.values(CLOUD_BACKUP_STATUS).includes(value);
}

function normalizeQueueState(raw) {
  const base = defaultQueueState();
  if (!raw || typeof raw !== "object") return base;

  return {
    ...base,
    ...raw,
    schemaVersion: CLOUD_BACKUP_QUEUE_SCHEMA_VERSION,
    pending: Boolean(raw.pending),
    status: raw.status === "current"
      ? CLOUD_BACKUP_STATUS.CLEAN
      : raw.status === "failed"
        ? CLOUD_BACKUP_STATUS.NEEDS_ATTENTION
        : isValidStatus(raw.status) ? raw.status : base.status,
    reasons: dedupeStrings(asArray(raw.reasons), MAX_RECENT_REASONS),
    domains: dedupeStrings(asArray(raw.domains), MAX_DOMAINS),
    severity: normalizeSeverity(raw.severity),
    priority: normalizePriority(raw.priority) || base.priority,
    attempts: Number.isFinite(Number(raw.attempts)) && Number(raw.attempts) >= 0 ? Number(raw.attempts) : 0,
    retryCount: Number.isFinite(Number(raw.retryCount)) && Number(raw.retryCount) >= 0 ? Number(raw.retryCount) : Number(raw.attempts || 0),
    localMutationRevision: Number.isFinite(Number(raw.localMutationRevision)) && Number(raw.localMutationRevision) >= 0 ? Number(raw.localMutationRevision) : 0,
    syncingRevision: raw.syncingRevision === null || raw.syncingRevision === undefined || raw.syncingRevision === ""
      ? null
      : Number.isFinite(Number(raw.syncingRevision)) ? Number(raw.syncingRevision) : null,
    companyId: String(raw.companyId || "").trim(),
    activeDeviceId: String(raw.activeDeviceId || "").trim(),
    lastErrorCode: String(raw.lastErrorCode || "").trim(),
    source: String(raw.source || "").trim(),
    documentId: String(raw.documentId || "").trim(),
    lastError: String(raw.lastError || "").trim(),
  };
}

// Unlike readCloudBackupQueueState(), this reader never invents a default
// queue. It is for safety gates that must distinguish an actually persisted,
// schema-v2 verified backup from a fresh device that merely looks clean.
export function readPersistedCloudBackupQueueState(storage) {
  try {
    const target = storage || (canUseStorage() ? localStorage : null);
    const raw = target?.getItem?.(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
    if (raw === null || raw === undefined || raw === "") return { ok: false, exists: false, code: "queue_missing", state: null };
    const parsed = JSON.parse(raw);
    const schemaValid = parsed && typeof parsed === "object" && !Array.isArray(parsed)
      && parsed.schemaVersion === CLOUD_BACKUP_QUEUE_SCHEMA_VERSION
      && typeof parsed.pending === "boolean" && isValidStatus(parsed.status)
      && Array.isArray(parsed.reasons) && Array.isArray(parsed.domains)
      && Number.isFinite(Number(parsed.localMutationRevision)) && Number(parsed.localMutationRevision) >= 0
      && (parsed.syncingRevision === null || Number.isFinite(Number(parsed.syncingRevision)))
      && typeof parsed.companyId === "string";
    if (!schemaValid) {
      return { ok: false, exists: true, code: "queue_unverified", state: null };
    }
    return { ok: true, exists: true, raw, state: normalizeQueueState(parsed) };
  } catch {
    return { ok: false, exists: true, code: "queue_unverified", state: null };
  }
}

function readAutoBackupPauseSnapshot() {
  if (!canUseStorage()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      paused: Boolean(parsed.paused),
      reason: String(parsed.reason || "").trim(),
      pausedAt: Number.isFinite(Number(parsed.pausedAt)) && Number(parsed.pausedAt) > 0
        ? Number(parsed.pausedAt)
        : null,
    };
  } catch {
    return null;
  }
}

function writeAutoBackupPauseSnapshot(snapshot) {
  if (!canUseStorage()) return snapshot;
  try {
    if (!snapshot?.paused) {
      localStorage.removeItem(STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE);
      try {
        window.dispatchEvent(new CustomEvent("pe-localstorage", {
          detail: { key: STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, value: null },
        }));
      } catch {}
      return null;
    }

    const serialized = JSON.stringify(snapshot);
    localStorage.setItem(STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, serialized);
    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", {
        detail: { key: STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, value: serialized },
      }));
    } catch {}
    return snapshot;
  } catch {
    return snapshot;
  }
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

export function readCloudAutoBackupPauseState() {
  const snapshot = readAutoBackupPauseSnapshot();
  return {
    paused: Boolean(snapshot?.paused),
    reason: String(snapshot?.reason || "").trim(),
    pausedAt: snapshot?.pausedAt || null,
  };
}

export function isCloudAutoBackupPaused() {
  return Boolean(readAutoBackupPauseSnapshot()?.paused);
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
      localMutationRevision: Number(current.localMutationRevision || 0) + 1,
      syncingRevision: null,
      reasons: dedupeStrings([...current.reasons, normalizedEvent.reason], MAX_RECENT_REASONS),
      domains: dedupeStrings([...current.domains, ...normalizedEvent.domains], MAX_DOMAINS),
      severity: higherSeverity(current.severity, normalizedEvent.severity),
      priority: higherPriority(current.priority, normalizedEvent.priority),
      createdAt: current.pending && current.createdAt ? current.createdAt : ts,
      updatedAt: ts,
      lastQueuedAt: ts,
      nextRetryAt: null,
      retryCount: 0,
      lastErrorCode: "",
      companyId: String(normalizedEvent.companyId || current.companyId || "").trim(),
      activeDeviceId: String(normalizedEvent.activeDeviceId || current.activeDeviceId || "").trim(),
      source: normalizedEvent.source || current.source,
      documentId: normalizedEvent.documentId || current.documentId,
    };

    writeAutoBackupPauseSnapshot(null);
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
export function clearCloudBackupDirty(reason, { expectedRevision = null } = {}) {
  try {
    const current = readCloudBackupQueueState();
    const ts = nowTs();
    const normalizedReason = String(reason || "").trim();
    const revisionChanged = expectedRevision !== null
      && Number(current.localMutationRevision || 0) !== Number(expectedRevision);

    if (revisionChanged) {
      return writeQueueState({
        ...current,
        pending: true,
        status: CLOUD_BACKUP_STATUS.PENDING,
        syncingRevision: null,
        updatedAt: ts,
        lastSuccessfulBackupAt: ts,
        lastVerifiedAt: ts,
        lastError: "",
        lastErrorCode: "",
      });
    }

    const next = {
      ...current,
      pending: false,
      status: CLOUD_BACKUP_STATUS.CLEAN,
      reasons: [],
      domains: [],
      severity: CLOUD_BACKUP_SEVERITY.LOW,
      priority: CLOUD_BACKUP_PRIORITY.DEFERRED,
      updatedAt: ts,
      lastSuccessfulBackupAt: ts,
      lastVerifiedAt: ts,
      retryCount: 0,
      nextRetryAt: null,
      syncingRevision: null,
      lastError: "",
      lastErrorCode: "",
      source: normalizedReason || current.source,
    };

    writeAutoBackupPauseSnapshot(null);
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
export function markCloudBackupSyncing({ companyId = "", activeDeviceId = "" } = {}) {
  try {
    const current = readCloudBackupQueueState();
    if (!current.pending) return current;
    return writeQueueState({
      ...current,
      status: CLOUD_BACKUP_STATUS.SYNCING,
      syncingRevision: Number(current.localMutationRevision || 0),
      companyId: String(companyId || current.companyId || "").trim(),
      activeDeviceId: String(activeDeviceId || current.activeDeviceId || "").trim(),
      lastAttemptAt: nowTs(),
      updatedAt: nowTs(),
    });
  } catch {
    return readCloudBackupQueueState();
  }
}

export function markCloudBackupOfflinePending() {
  try {
    const current = readCloudBackupQueueState();
    if (!current.pending) return current;
    return writeQueueState({ ...current, status: CLOUD_BACKUP_STATUS.OFFLINE_PENDING, syncingRevision: null, updatedAt: nowTs() });
  } catch {
    return readCloudBackupQueueState();
  }
}

export function recordCloudBackupAttemptFailure(errorMessage, { retryDelayMs = 0, errorCode = "" } = {}) {
  try {
    const current = readCloudBackupQueueState();
    const ts = nowTs();

    const next = {
      ...current,
      status: current.pending
        ? (Number(current.retryCount || 0) + 1 >= 3 ? CLOUD_BACKUP_STATUS.NEEDS_ATTENTION : CLOUD_BACKUP_STATUS.RETRY_WAIT)
        : current.status,
      attempts: current.attempts + 1,
      retryCount: Number(current.retryCount || 0) + 1,
      lastAttemptAt: ts,
      lastError: String(errorMessage || "").trim(),
      lastErrorCode: String(errorCode || "").trim(),
      nextRetryAt: retryDelayMs > 0 ? ts + Number(retryDelayMs) : null,
      syncingRevision: null,
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

// Identity ambiguity and protected remote financial history cannot be fixed
// by retrying the same upload. Keep the local mutation pending for review,
// but take it out of the automatic retry loop.
export function markCloudBackupReviewRequired(reason, {
  status = CLOUD_BACKUP_STATUS.REMOTE_CHANGED,
  errorCode = "identity_review_required",
} = {}) {
  try {
    const current = readCloudBackupQueueState();
    const nextStatus = status === CLOUD_BACKUP_STATUS.CONFLICT
      ? CLOUD_BACKUP_STATUS.CONFLICT
      : CLOUD_BACKUP_STATUS.REMOTE_CHANGED;
    return writeQueueState({
      ...current,
      pending: true,
      status: nextStatus,
      syncingRevision: null,
      nextRetryAt: null,
      lastError: String(reason || "").trim(),
      lastErrorCode: String(errorCode || "identity_review_required").trim(),
      updatedAt: nowTs(),
    });
  } catch {
    return readCloudBackupQueueState();
  }
}

// The cloud backup result status that means "verified success". Kept as a
// literal here (rather than importing from supabaseCloudOnboarding) because
// that module imports this one; a reverse import would create a cycle.
export const CLOUD_BACKUP_RESULT_COMPLETED_STATUS = "backup_completed";
export const CLOUD_BACKUP_MAX_RETRY_DELAY_MS = 60000;

// Exponential backoff shared by the automatic worker and manual Retry Sync so
// both use the identical retry cadence.
export function computeCloudBackupRetryDelayMs(retryCount) {
  const exponent = Math.max(0, Math.min(6, Number(retryCount || 0) - 1));
  return Math.min(CLOUD_BACKUP_MAX_RETRY_DELAY_MS, 1500 * (2 ** exponent));
}

// Single source of truth for turning a cloud backup RESULT into exactly one
// queue transition. Used by BOTH the automatic background worker and the manual
// "Retry Sync" button so the persisted queue can never disagree with the result
// the user is shown (e.g. "retrying" while the result is "cloud changed").
//
// Exactly one transition is applied, in priority order:
//   device lock lost  -> leave pending, never clean, never retry-schedule
//   permanent review  -> remote_changed / conflict, no retry timer
//   verified success  -> clear the uploaded generation (clean)
//   transient failure -> retry_wait / needs_attention with backoff
export function applyCloudBackupResultToQueue(result, { queueGeneration = null } = {}) {
  if (result?.deviceLockLost) {
    return { transition: "device_lock_lost", state: readCloudBackupQueueState() };
  }
  if (result?.permanentIdentityConflict) {
    const state = markCloudBackupReviewRequired(result?.error || result?.reason, {
      status: result?.syncReviewState,
      errorCode: "identity_review_required",
    });
    return { transition: "review_required", state };
  }
  if (result?.status === CLOUD_BACKUP_RESULT_COMPLETED_STATUS) {
    const state = clearCloudBackupDirty(
      "backup_verified",
      queueGeneration !== null && queueGeneration !== undefined ? { expectedRevision: queueGeneration } : {}
    );
    return { transition: "cleared", state };
  }
  const current = readCloudBackupQueueState();
  const state = recordCloudBackupAttemptFailure(
    result?.error || result?.status || "backup_incomplete",
    {
      retryDelayMs: computeCloudBackupRetryDelayMs(Number(current.retryCount || 0) + 1),
      errorCode: result?.status || "backup_incomplete",
    }
  );
  return { transition: "retry", state };
}

export function pauseCloudAutoBackup(reason = "manual_pause") {
  return writeAutoBackupPauseSnapshot({
    paused: true,
    reason: String(reason || "").trim() || "manual_pause",
    pausedAt: nowTs(),
  });
}
