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

// ---------------------------------------------------------------------------
// Gate 16G: legacy queue migration and stale takeover-pause recovery.
//
// readPersistedCloudBackupQueueState deliberately refuses to invent proof: it
// rejects anything that is not a current schema-v2 record. That is correct for
// an unknown shape, but it also rejects a queue this app itself wrote and that
// provably represents a verified-clean backup. Released schema v1 (commit
// 1190910) wrote exactly:
//
//   schemaVersion, pending, status, reasons, domains, severity, priority,
//   createdAt, updatedAt, attempts, lastAttemptAt, lastError,
//   lastSuccessfulBackupAt, source, documentId, localFingerprint
//
// and nothing else -- no companyId, no lastVerifiedAt, no localMutationRevision,
// no syncingRevision, no retryCount/nextRetryAt/lastErrorCode, no
// activeDeviceId. Those absences are proven by history, not assumed.
// ---------------------------------------------------------------------------

export const LEGACY_CLOUD_BACKUP_QUEUE_SCHEMA_VERSION = "1.0.0";
// v1's only clean status. v2 renamed it to "clean"; the raw string "current" is
// not a valid v2 status, which is why the persisted reader rejects it before
// normalizeQueueState would have converted it.
const LEGACY_CLEAN_STATUS = "current";
const TAKEOVER_PAUSE_REASON = "device_takeover";

function readRawFrom(storage, key) {
  try {
    const target = storage || (canUseStorage() ? localStorage : null);
    return target?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function writeRawTo(storage, key, value) {
  try {
    const target = storage || (canUseStorage() ? localStorage : null);
    if (!target) return false;
    if (value === null) target.removeItem(key);
    else target.setItem(key, value);
    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key, value } }));
    } catch {}
    return readRawFrom(storage, key) === value;
  } catch {
    return false;
  }
}

function validHistoricalTimestamp(value) {
  const numeric = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(numeric) && numeric > 0;
}

// A real, resolved, active-device verification for THIS browser. Never a
// caller-asserted boolean: the local device id must equal the active cloud
// device id, and the lock must be resolved and unheld.
function verifiedActiveDevice(deviceAccess, companyId, activeDeviceId) {
  if (!deviceAccess?.ok || deviceAccess.deviceLockLost) return false;
  const access = deviceAccess.access;
  if (!access || access.ready !== true || access.isLocked === true || access.isActive !== true) return false;
  const localDeviceId = String(access.localDeviceId || "").trim();
  const cloudActiveDeviceId = String(access.activeDeviceState?.activeDeviceId || "").trim();
  if (!localDeviceId || !cloudActiveDeviceId || localDeviceId !== cloudActiveDeviceId) return false;
  if (String(activeDeviceId || "").trim() && String(activeDeviceId).trim() !== cloudActiveDeviceId) return false;
  return Boolean(String(companyId || "").trim());
}

function journalPresent(storage) {
  return Boolean(readRawFrom(storage, STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL));
}

function parseRaw(raw) {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Upgrades a provably-clean released schema-v1 queue to the current schema.
 * Runs only for a verified active device, never invents a backup or
 * verification event, and is idempotent: an already-valid schema-v2 queue is
 * left byte-for-byte untouched.
 */
export function migrateLegacyPersistedCloudBackupQueue({ storage = localStorage, companyId = "", activeDeviceId = "", deviceAccess = null } = {}) {
  const raw = readRawFrom(storage, STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
  if (raw === null || raw === "") return { ok: false, migrated: false, code: "queue_missing", schemaBefore: "", schemaAfter: "", previousRaw: raw };

  const parsed = parseRaw(raw);
  if (!parsed) return { ok: false, migrated: false, code: "queue_legacy_invalid", schemaBefore: "", schemaAfter: "", previousRaw: raw };
  const schemaBefore = String(parsed.schemaVersion || "").trim();

  // Idempotent: a queue already valid under the current schema is never rewritten.
  if (schemaBefore === CLOUD_BACKUP_QUEUE_SCHEMA_VERSION) {
    const current = readPersistedCloudBackupQueueState(storage);
    return current.ok
      ? { ok: true, migrated: false, code: "queue_already_current", schemaBefore, schemaAfter: schemaBefore, previousRaw: raw }
      : { ok: false, migrated: false, code: "queue_legacy_invalid", schemaBefore, schemaAfter: schemaBefore, previousRaw: raw };
  }
  if (schemaBefore !== LEGACY_CLOUD_BACKUP_QUEUE_SCHEMA_VERSION) {
    return { ok: false, migrated: false, code: "queue_legacy_unsupported", schemaBefore, schemaAfter: schemaBefore, previousRaw: raw };
  }

  const fail = (code) => ({ ok: false, migrated: false, code, schemaBefore, schemaAfter: schemaBefore, previousRaw: raw });

  // Only a queue that already claims a settled, successful, error-free state
  // may be upgraded. Anything else keeps its legacy shape and stays blocked.
  if (typeof parsed.pending !== "boolean" || parsed.pending === true) return fail("queue_legacy_pending");
  if (parsed.status !== LEGACY_CLEAN_STATUS) return fail("queue_legacy_not_clean");
  if (!validHistoricalTimestamp(parsed.lastSuccessfulBackupAt)) return fail("queue_legacy_invalid");
  // v1 never wrote these; a v1 record carrying them is not a shape we released.
  if (parsed.syncingRevision !== null && parsed.syncingRevision !== undefined && parsed.syncingRevision !== "") return fail("queue_legacy_syncing");
  if (parsed.nextRetryAt !== null && parsed.nextRetryAt !== undefined) return fail("queue_legacy_retry_scheduled");
  if (Number(parsed.retryCount || 0) !== 0) return fail("queue_legacy_retry_scheduled");
  if (String(parsed.lastError || "").trim() || String(parsed.lastErrorCode || "").trim()) return fail("queue_legacy_error");
  // v1 had no revision field; any value it does carry must be a real revision,
  // and a nonzero revision means unprotected local work.
  const revisionRaw = parsed.localMutationRevision;
  const revision = revisionRaw === undefined || revisionRaw === null ? 0 : Number(revisionRaw);
  if (!Number.isFinite(revision) || revision < 0) return fail("queue_legacy_invalid");
  // Git history proves v1 did not store companyId, so an absent workspace is
  // expected and is scoped to the verified current company below. A workspace
  // that contradicts the current company is never adopted.
  const legacyCompanyId = String(parsed.companyId || "").trim();
  if (legacyCompanyId && legacyCompanyId !== String(companyId || "").trim()) return fail("queue_legacy_company_mismatch");
  if (journalPresent(storage)) return fail("queue_legacy_journal_present");
  if (!verifiedActiveDevice(deviceAccess, companyId, activeDeviceId)) return fail("queue_legacy_device_unverified");

  const legacySuccessAt = typeof parsed.lastSuccessfulBackupAt === "number"
    ? parsed.lastSuccessfulBackupAt
    : Date.parse(parsed.lastSuccessfulBackupAt);

  const migrated = {
    ...defaultQueueState(),
    schemaVersion: CLOUD_BACKUP_QUEUE_SCHEMA_VERSION,
    pending: false,
    status: CLOUD_BACKUP_STATUS.CLEAN,
    reasons: [],
    domains: [],
    severity: CLOUD_BACKUP_SEVERITY.LOW,
    priority: CLOUD_BACKUP_PRIORITY.DEFERRED,
    createdAt: parsed.createdAt ?? null,
    updatedAt: parsed.updatedAt ?? null,
    attempts: Number.isFinite(Number(parsed.attempts)) && Number(parsed.attempts) >= 0 ? Number(parsed.attempts) : 0,
    lastAttemptAt: parsed.lastAttemptAt ?? null,
    // Preserved exactly: the migration must never claim a NEW backup happened.
    lastSuccessfulBackupAt: legacySuccessAt,
    // Not invented. In v1 the ONLY writer of status "current" +
    // lastSuccessfulBackupAt was clearCloudBackupDirty, and its only callers
    // were supabaseCloudOnboarding (which called it strictly after
    // runSupabaseCloudVerification returned ok && allMatched) and
    // supabaseCloudRestore (after a restore made local equal to cloud). So this
    // timestamp already IS the moment strict verification passed -- the same
    // verifier used today. Reusing it records when that proof happened rather
    // than back-dating or fabricating a fresh one.
    lastVerifiedAt: legacySuccessAt,
    lastQueuedAt: null,
    nextRetryAt: null,
    retryCount: 0,
    localMutationRevision: revision,
    syncingRevision: null,
    companyId: String(companyId || "").trim(),
    activeDeviceId: String(activeDeviceId || "").trim(),
    lastError: "",
    lastErrorCode: "",
    source: String(parsed.source || "").trim(),
    documentId: String(parsed.documentId || "").trim(),
    localFingerprint: parsed.localFingerprint ?? null,
  };

  if (!writeRawTo(storage, STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify(migrated))) {
    return fail("queue_legacy_write_failed");
  }
  // Never report success on a record the real reader still refuses.
  const verify = readPersistedCloudBackupQueueState(storage);
  if (!verify.ok) {
    writeRawTo(storage, STORAGE_KEYS.CLOUD_BACKUP_QUEUE, raw);
    return fail("queue_legacy_write_failed");
  }
  return { ok: true, migrated: true, code: "", schemaBefore, schemaAfter: CLOUD_BACKUP_QUEUE_SCHEMA_VERSION, previousRaw: raw, state: verify.state };
}

/**
 * Clears a device_takeover pause that this browser wrote onto ITSELF when its
 * own forced claim succeeded. Only ever clears that exact reason, and only for
 * a verified active device with a clean, settled queue. Every genuine safety
 * pause (manual or device-lock-loss) is left untouched.
 */
export function recoverVerifiedActiveDeviceTakeoverPause({ storage = localStorage, companyId = "", activeDeviceId = "", deviceAccess = null } = {}) {
  const raw = readRawFrom(storage, STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE);
  if (raw === null || raw === "") return { ok: true, recovered: false, code: "pause_absent", pauseReason: "", previousRaw: raw };

  const parsed = parseRaw(raw);
  if (!parsed) return { ok: false, recovered: false, code: "pause_invalid", pauseReason: "", previousRaw: raw };
  const pauseReason = String(parsed.reason || "").trim();
  if (!parsed.paused) return { ok: true, recovered: false, code: "pause_inactive", pauseReason, previousRaw: raw };

  const refuse = (code) => ({ ok: false, recovered: false, code, pauseReason, previousRaw: raw });
  // Exact-match only. A manual pause, any device-lock-loss safety pause, or an
  // unrecognized reason is never auto-cleared.
  if (pauseReason !== TAKEOVER_PAUSE_REASON) {
    return refuse(pauseReason ? "pause_active_safety_lock" : "pause_unknown");
  }
  if (!verifiedActiveDevice(deviceAccess, companyId, activeDeviceId)) return refuse("pause_device_unverified");
  if (journalPresent(storage)) return refuse("pause_journal_present");

  // The queue must already be settled and clean (after any legacy migration):
  // a takeover pause must never mask real pending local work.
  const queue = readPersistedCloudBackupQueueState(storage);
  if (!queue.ok) return refuse("pause_queue_unverified");
  const state = queue.state;
  if (state.pending || state.status !== CLOUD_BACKUP_STATUS.CLEAN) return refuse("pause_queue_pending");
  if (state.syncingRevision !== null) return refuse("pause_queue_syncing");
  if (Number(state.retryCount || 0) !== 0 || state.nextRetryAt != null) return refuse("pause_queue_retry_scheduled");
  if (String(state.lastError || "").trim() || String(state.lastErrorCode || "").trim()) return refuse("pause_queue_error");
  if (String(state.companyId || "").trim() !== String(companyId || "").trim()) return refuse("pause_queue_company_mismatch");

  if (!writeRawTo(storage, STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, null)) return refuse("pause_clear_failed");
  return { ok: true, recovered: true, code: "", pauseReason, previousRaw: raw };
}
