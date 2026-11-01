// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { runtimeCommitAtomicRecords, getVaultRuntimeStatus, isVaultRuntimeReady, runtimeGetItem } from "./vaultRuntimeStore";
import { getActiveAccountScopedStorage, getActiveAccountWorkspaceIdentity, isAuthoritativeVaultRuntimeInstalled } from "./accountScopedLocalStorage";
import { deriveWorkspaceVaultTag } from "./vaultSession";
import { isActiveCloudMutation } from "./cloudOperationOwnership";

export const CLOUD_MUTATION_LEDGER_SCHEMA_VERSION = "2.0.0";
export const CLOUD_MUTATION_ENTITY = Object.freeze({
  INVOICE: "invoice",
  ESTIMATE: "estimate",
  CUSTOMER: "customer",
  PROJECT: "project",
  APP_RESTORE_BUNDLE: "app_restore_bundle",
});
export const CLOUD_MUTATION_OPERATION = Object.freeze({
  UPSERT: "upsert",
  DELETE: "delete",
});
export const CLOUD_MUTATION_STATUS = Object.freeze({
  PENDING: "pending",
  SYNCING: "syncing",
  RETRY_WAIT: "retry_wait",
  NEEDS_ATTENTION: "needs_attention",
  ACKNOWLEDGED: "acknowledged",
  RETIRED: "retired",
});
export const CLOUD_MUTATION_MAX_RETRIES = 3;
export const CLOUD_MUTATION_AUTO_RECOVERY_COOLDOWN_MS = 30000;

let fallbackSequence = 0;
const nowTs = () => Date.now();
const asText = (value) => String(value || "").trim();
const clone = (value) => JSON.parse(JSON.stringify(value));

function mutationId() {
  try {
    if (typeof crypto?.randomUUID === "function") return `mutation_${crypto.randomUUID()}`;
  } catch {}
  fallbackSequence += 1;
  return `mutation_${Date.now()}_${fallbackSequence}`;
}

export function createEmptyCloudMutationLedger() {
  return {
    schemaVersion: CLOUD_MUTATION_LEDGER_SCHEMA_VERSION,
    nextRevision: 1,
    entries: [],
    lastAcknowledgedRevision: 0,
    lastVerifiedAt: null,
  };
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const revision = Number(entry.revision);
  const status = asText(entry.status);
  if (!asText(entry.mutationId) || !Number.isSafeInteger(revision) || revision < 1) return null;
  if (!Object.values(CLOUD_MUTATION_STATUS).includes(status)) return null;
  if (!Object.values(CLOUD_MUTATION_ENTITY).includes(entry.entityType)) return null;
  const operation = Object.values(CLOUD_MUTATION_OPERATION).includes(entry.operation)
    ? entry.operation
    : CLOUD_MUTATION_OPERATION.UPSERT;
  if (!asText(entry.documentId) || !entry.payload || typeof entry.payload !== "object" || Array.isArray(entry.payload)) return null;
  return {
    mutationId: asText(entry.mutationId),
    revision,
    companyId: asText(entry.companyId),
    entityType: entry.entityType,
    documentId: asText(entry.documentId),
    operation,
    reason: asText(entry.reason) || "invoice_data_saved",
    source: asText(entry.source) || "commitStoredInvoices",
    createdAt: Number(entry.createdAt) || 0,
    payload: clone(entry.payload),
    status,
    retryCount: Math.max(0, Number(entry.retryCount) || 0),
    nextRetryAt: Number(entry.nextRetryAt) > 0 ? Number(entry.nextRetryAt) : null,
    lastAttemptAt: Number(entry.lastAttemptAt) > 0 ? Number(entry.lastAttemptAt) : null,
    lastError: asText(entry.lastError),
    lastErrorCode: asText(entry.lastErrorCode),
    acknowledgedAt: Number(entry.acknowledgedAt) > 0 ? Number(entry.acknowledgedAt) : null,
    verifiedAt: Number(entry.verifiedAt) > 0 ? Number(entry.verifiedAt) : null,
    ...(entry.automaticRecoveryProof ? { automaticRecoveryProof: asText(entry.automaticRecoveryProof) } : {}),
    ...(entry.supersededByMutationId ? { supersededByMutationId: asText(entry.supersededByMutationId), supersededByRevision: Number(entry.supersededByRevision) } : {}),
    ...(entry.retirement ? { retirement: clone(entry.retirement) } : {}),
  };
}

export function normalizeCloudMutationLedger(value) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const entries = (Array.isArray(source.entries) ? source.entries : [])
    .map(normalizeEntry)
    .filter(Boolean)
    .sort((left, right) => left.revision - right.revision);
  const highest = entries.reduce((max, entry) => Math.max(max, entry.revision), 0);
  return {
    schemaVersion: CLOUD_MUTATION_LEDGER_SCHEMA_VERSION,
    nextRevision: Math.max(highest + 1, Number(source.nextRevision) || 1),
    entries,
    lastAcknowledgedRevision: Math.max(0, Number(source.lastAcknowledgedRevision) || 0),
    lastVerifiedAt: Number(source.lastVerifiedAt) > 0 ? Number(source.lastVerifiedAt) : null,
  };
}

export function readCloudMutationLedger(storage = localStorage) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEYS.CLOUD_MUTATION_LEDGER);
    return normalizeCloudMutationLedger(raw ? JSON.parse(raw) : null);
  } catch {
    return createEmptyCloudMutationLedger();
  }
}

export async function appendCloudMutationsDurably(mutationInputs = [], { storage = localStorage } = {}) {
  const appended = appendCloudMutationRecords(readCloudMutationLedger(storage), mutationInputs);
  if (!appended.appended.length) return { ok: true, ledger: appended.ledger, appended: [] };
  await runtimeCommitAtomicRecords([{
    logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER,
    value: JSON.stringify(appended.ledger),
  }]);
  return { ok: true, ledger: appended.ledger, appended: appended.appended };
}

export function appendCloudMutationRecords(currentLedger, mutationInputs = [], { now = nowTs() } = {}) {
  const ledger = normalizeCloudMutationLedger(currentLedger);
  let revision = ledger.nextRevision;
  const appended = (Array.isArray(mutationInputs) ? mutationInputs : []).map((input) => {
    const payload = clone(input?.payload);
    const documentId = asText(input?.documentId || payload?.id);
    const entityType = input?.entityType;
    const operation = input?.operation || CLOUD_MUTATION_OPERATION.UPSERT;
    if (!Object.values(CLOUD_MUTATION_ENTITY).includes(entityType)
      || !Object.values(CLOUD_MUTATION_OPERATION).includes(operation)) {
      throw new Error("unsupported_cloud_mutation");
    }
    if (!documentId || !payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("invalid_cloud_mutation");
    const entry = {
      mutationId: mutationId(),
      revision,
      companyId: asText(input?.companyId),
      entityType,
      documentId,
      operation,
      reason: asText(input?.reason) || `${entityType}_data_saved`,
      source: asText(input?.source) || `commitStored${entityType}`,
      createdAt: Number(input?.createdAt) > 0 ? Number(input.createdAt) : now,
      payload,
      status: CLOUD_MUTATION_STATUS.PENDING,
      retryCount: 0,
      nextRetryAt: null,
      lastAttemptAt: null,
      lastError: "",
      lastErrorCode: "",
      acknowledgedAt: null,
      verifiedAt: null,
    };
    revision += 1;
    return entry;
  });
  return {
    ledger: {
      ...ledger,
      nextRevision: revision,
      entries: [...ledger.entries, ...appended],
    },
    appended,
  };
}

function eligible(entry, now) {
  if (entry.status === CLOUD_MUTATION_STATUS.PENDING || entry.status === CLOUD_MUTATION_STATUS.SYNCING) return true;
  return entry.status === CLOUD_MUTATION_STATUS.RETRY_WAIT && (!entry.nextRetryAt || entry.nextRetryAt <= now);
}

export function getNextCloudMutation(ledger = readCloudMutationLedger(), { now = nowTs() } = {}) {
  return normalizeCloudMutationLedger(ledger).entries.find((entry) => eligible(entry, now)) || null;
}

export function getCloudMutationLedgerSummary(ledger = readCloudMutationLedger()) {
  const normalized = normalizeCloudMutationLedger(ledger);
  const active = normalized.entries.filter(isActiveCloudMutation);
  const failed = active.find((entry) => entry.status === CLOUD_MUTATION_STATUS.NEEDS_ATTENTION) || null;
  const syncing = active.find((entry) => entry.status === CLOUD_MUTATION_STATUS.SYNCING) || null;
  const pending = active.find((entry) => entry.status === CLOUD_MUTATION_STATUS.PENDING || entry.status === CLOUD_MUTATION_STATUS.RETRY_WAIT) || null;
  return {
    activeCount: active.length,
    failed,
    syncing,
    pending,
    hasUnacknowledged: active.length > 0,
    lastVerifiedAt: normalized.lastVerifiedAt,
    lastAcknowledgedRevision: normalized.lastAcknowledgedRevision,
  };
}

async function commitTransition(mutationIdValue, revisionValue, transition) {
  const ledger = readCloudMutationLedger();
  const index = ledger.entries.findIndex((entry) => entry.mutationId === mutationIdValue && entry.revision === Number(revisionValue));
  if (index < 0) return { ok: false, code: "mutation_not_found", ledger };
  const current = ledger.entries[index];
  const result = transition(current, ledger);
  if (!result?.entry) return { ok: false, code: result?.code || "mutation_transition_refused", ledger, ...result };
  const next = { ...ledger, ...(result.ledgerPatch || {}), entries: ledger.entries.map((entry, entryIndex) => entryIndex === index ? result.entry : entry) };
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER, value: JSON.stringify(next) }]);
  return { ok: true, mutation: result.entry, ledger: next };
}

export function markCloudMutationSyncing(mutation) {
  const at = nowTs();
  return commitTransition(mutation?.mutationId, mutation?.revision, (current) => {
    if (!isActiveCloudMutation(current) || current.status === CLOUD_MUTATION_STATUS.NEEDS_ATTENTION) return { code: "mutation_not_pending" };
    return { entry: { ...current, status: CLOUD_MUTATION_STATUS.SYNCING, lastAttemptAt: at, nextRetryAt: null } };
  });
}

export function recordCloudMutationFailure(mutation, { error = "", errorCode = "", retryDelayMs = 0 } = {}) {
  const at = nowTs();
  return commitTransition(mutation?.mutationId, mutation?.revision, (current) => {
    if (current.status === CLOUD_MUTATION_STATUS.ACKNOWLEDGED) return { code: "mutation_already_acknowledged" };
    if (current.status === CLOUD_MUTATION_STATUS.RETIRED) return { code: "mutation_retired" };
    if (current.status === CLOUD_MUTATION_STATUS.NEEDS_ATTENTION) return { code: "mutation_not_pending" };
    const retryCount = current.retryCount + 1;
    const terminal = retryCount >= CLOUD_MUTATION_MAX_RETRIES;
    return { entry: { ...current, status: terminal ? CLOUD_MUTATION_STATUS.NEEDS_ATTENTION : CLOUD_MUTATION_STATUS.RETRY_WAIT, retryCount, nextRetryAt: terminal ? null : at + Math.max(0, Number(retryDelayMs) || 0), lastAttemptAt: at, lastError: asText(error) || "cloud_mutation_failed", lastErrorCode: asText(errorCode) || "cloud_mutation_failed" } };
  });
}

// Manual Retry Sync does not execute cloud work here. It only makes the exact
// failed durable mutation eligible for the existing ledger-first worker again.
// Payload, revision, identity and failure evidence remain unchanged.
export function requeueCloudMutationForManualRetry(mutation) {
  return commitTransition(mutation?.mutationId, mutation?.revision, (current) => {
    if (current.status !== CLOUD_MUTATION_STATUS.NEEDS_ATTENTION) return { code: "mutation_not_retryable" };
    return {
      entry: {
        ...current,
        status: CLOUD_MUTATION_STATUS.PENDING,
        retryCount: 0,
        nextRetryAt: null,
      },
    };
  });
}

export function requeueCloudMutationForAutomaticRetry(mutation, {
  now = nowTs(),
  cooldownMs = CLOUD_MUTATION_AUTO_RECOVERY_COOLDOWN_MS,
  trigger = "lifecycle",
  recoveryContext = null,
} = {}) {
  const at = Number(now) > 0 ? Number(now) : nowTs();
  const minimumCooldown = Math.max(0, Number(cooldownMs) || 0);
  return commitTransition(mutation?.mutationId, mutation?.revision, (current, ledger) => {
    if (current.status !== CLOUD_MUTATION_STATUS.NEEDS_ATTENTION) return { code: "mutation_not_retryable" };
    const proof = getCloudMutationAutomaticRecoveryProof(current, ledger, recoveryContext);
    if (!proof) return { code: "mutation_recovery_evidence_unchanged" };
    const retryAt = Number(current.lastAttemptAt || 0) + minimumCooldown;
    if (retryAt > at) return { code: "mutation_recovery_cooldown", retryAt };
    return {
      entry: {
        ...current,
        status: CLOUD_MUTATION_STATUS.PENDING,
        nextRetryAt: null,
        automaticRecoveryProof: proof,
      },
    };
  });
}

function isParentMissingEstimate(entry) {
  return entry?.entityType === CLOUD_MUTATION_ENTITY.ESTIMATE
    && entry.operation === CLOUD_MUTATION_OPERATION.UPSERT
    && entry.status === CLOUD_MUTATION_STATUS.NEEDS_ATTENTION
    && entry.lastErrorCode === "projects_parent_missing"
    && entry.documentId === asText(entry.payload?.id);
}

// Eligibility is not proof. Only the convergence owner may use these candidates
// after a NEW strict match of the unchanged authoritative workspace. Any other
// active entry (especially a delete) keeps the entire operation fail closed.
// This shape is BASELINE-ONLY. The parent-retry/same-document recovery predicate
// above remains unchanged; these extra errors must never unlock automatic replay.
function isWorkspaceBaselineFailure(entry) {
  return entry.operation === CLOUD_MUTATION_OPERATION.UPSERT
    && entry.status === CLOUD_MUTATION_STATUS.NEEDS_ATTENTION
    && entry.documentId === asText(entry.payload?.id)
    && ((entry.entityType === CLOUD_MUTATION_ENTITY.ESTIMATE
      && ["projects_parent_missing", "estimate_write_failed"].includes(entry.lastErrorCode))
      || (entry.entityType === CLOUD_MUTATION_ENTITY.INVOICE && entry.lastErrorCode === "estimates_parent_missing"));
}

function baselineEntryBelongsToCompany(entry, companyId) {
  return (!entry.companyId || entry.companyId === companyId)
    && ![entry.payload?.companyId, entry.payload?.company_id].some(value => asText(value) && asText(value) !== companyId);
}

export function getHistoricalWorkspaceBaselineCandidates(ledger, { companyId, before } = {}) {
  if (!Array.isArray(ledger?.entries)) return [];
  if (ledger.entries.filter(isActiveCloudMutation).some(entry => entry.operation !== CLOUD_MUTATION_OPERATION.UPSERT)) return [];
  const normalized = normalizeCloudMutationLedger(ledger);
  if (normalized.entries.length !== ledger.entries.length) return [];
  // Retirement addresses immutable entries by identity. Ambiguous persisted
  // identities must not retire an unrelated record or choose a revision proof.
  if (new Set(normalized.entries.map(entry => entry.mutationId)).size !== normalized.entries.length
    || new Set(normalized.entries.map(entry => entry.revision)).size !== normalized.entries.length) return [];
  const active = normalized.entries.filter(isActiveCloudMutation);
  if (!companyId || !active.length || !active.every(entry => isWorkspaceBaselineFailure(entry)
    && baselineEntryBelongsToCompany(entry, companyId)
    && entry.createdAt > 0 && entry.lastAttemptAt >= entry.createdAt && entry.lastAttemptAt < before
    && entry.nextRetryAt == null && entry.retryCount >= CLOUD_MUTATION_MAX_RETRIES)) return [];
  return active;
}

export function buildWorkspaceBaselineRetiredLedger(ledger, { companyId, startedAt, verifiedAt, coversPayload, ...binding } = {}) {
  const candidates = getHistoricalWorkspaceBaselineCandidates(ledger, { companyId, before: startedAt });
  if (!candidates.length || !(verifiedAt >= startedAt) || typeof coversPayload !== "function") return null;
  const entries = normalizeCloudMutationLedger(ledger).entries;
  const coverage = new Map();
  for (const failed of candidates) {
    let proof = failed;
    if (coversPayload(failed) !== true) {
      // A newer timestamp/current document is not supersession. Require the
      // latest same-document immutable ledger intent to have its own verified
      // acknowledgement, AND cover today's freshly verified canonical state.
      proof = [...entries].reverse().find(entry => entry.entityType === failed.entityType
        && entry.documentId === failed.documentId && entry.revision > failed.revision);
      if (!hasVerifiedAcknowledgement(proof) || proof.operation !== CLOUD_MUTATION_OPERATION.UPSERT
        || proof.documentId !== asText(proof.payload?.id) || !baselineEntryBelongsToCompany(proof, companyId)
        || proof.createdAt >= startedAt || Number(proof.lastAttemptAt || 0) >= startedAt
        || proof.verifiedAt > verifiedAt || proof.acknowledgedAt > verifiedAt || coversPayload(proof) !== true) return null;
    }
    coverage.set(failed.mutationId, { kind: proof === failed ? "immutable_payload" : "verified_same_document_supersession",
      mutationId: proof.mutationId, revision: proof.revision });
  }
  return { ...ledger, entries: ledger.entries.map(entry => coverage.has(entry.mutationId)
    ? { ...entry, status: CLOUD_MUTATION_STATUS.RETIRED,
      retirement: { reason: "verified_workspace_baseline_superseded", companyId, verifiedAt, ...binding, coverage: coverage.get(entry.mutationId) } }
    : entry) };
}

// An account marker alone is insufficient. Bind the exact installed facade to
// the user/company-derived encrypted vault tag, current generation and actual
// runtime ledger. No UI selection, legacy plaintext or caller-supplied company
// can provide historical identity on its own.
function historicalContextIsCurrent(context) {
  if (!context) return false;
  try {
    const identity = getActiveAccountWorkspaceIdentity();
    return identity.userId === context.userId && identity.companyId === context.companyId
      && getActiveAccountScopedStorage() === context.storage && localStorage === context.storage
      && isAuthoritativeVaultRuntimeInstalled(context.workspaceTag)
      && getVaultRuntimeStatus().generation === context.generation
      && isVaultRuntimeReady(context.generation)
      && context.storage.getItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER) !== null
      && context.storage.getItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER) === runtimeGetItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER);
  } catch { return false; }
}

export async function getHistoricalMutationRecoveryContext({ userId, companyId } = {}) {
  try {
    const identity = getActiveAccountWorkspaceIdentity();
    if (!identity.userId || !identity.companyId || identity.userId !== userId || identity.companyId !== companyId) return null;
    const storage = getActiveAccountScopedStorage();
    if (!storage || localStorage !== storage) return null;
    const generation = getVaultRuntimeStatus().generation;
    const workspaceTag = await deriveWorkspaceVaultTag(identity.userId, identity.companyId);
    const context = Object.freeze({ ...identity, storage, generation, workspaceTag });
    return historicalContextIsCurrent(context) ? context : null;
  } catch { return null; }
}

export function deriveParentMissingEstimateRecoveryIdentity(entry, recoveryContext = null) {
  if (!isParentMissingEstimate(entry)) return null;
  const documentId = asText(entry.payload.id);
  const projectId = asText(entry.payload.projectId);
  if (entry.companyId) return { companyId: entry.companyId, documentId, projectId };
  if (!historicalContextIsCurrent(recoveryContext)) return null;
  // Payload identity is never rewritten. Explicit conflicting payload company
  // metadata must not be laundered through the enclosing vault namespace.
  if ([entry.payload.companyId, entry.payload.company_id].some(value => asText(value) && asText(value) !== recoveryContext.companyId)) return null;
  return { companyId: recoveryContext.companyId, documentId, projectId };
}

function recoveryEntryCompanyId(entry, recoveryContext) {
  if (entry.companyId) return entry.companyId;
  if (!historicalContextIsCurrent(recoveryContext)) return "";
  if ([entry.payload?.companyId, entry.payload?.company_id].some(value => asText(value) && asText(value) !== recoveryContext.companyId)) return "";
  return recoveryContext.companyId;
}

function hasVerifiedAcknowledgement(entry) {
  return entry?.status === CLOUD_MUTATION_STATUS.ACKNOWLEDGED
    && Number(entry.acknowledgedAt) > 0 && Number(entry.verifiedAt) > 0
    && !entry.supersededByMutationId;
}

// Only the exact required project can unlock a retry. Persist the proof on the
// failed entry so remounts, clocks, triggers and another failed attempt cannot
// reuse it. A parent verified before the failure is not changed evidence.
export function getCloudMutationAutomaticRecoveryProof(current, ledger, recoveryContext = null) {
  const identity = deriveParentMissingEstimateRecoveryIdentity(current, recoveryContext);
  if (!identity) return null;
  const { projectId, companyId } = identity;
  if (!projectId || !Number(current.lastAttemptAt)) return null;
  const parent = [...(ledger?.entries || [])].reverse().find(entry =>
    recoveryEntryCompanyId(entry, current.companyId ? null : recoveryContext) === companyId && entry.entityType === CLOUD_MUTATION_ENTITY.PROJECT
    && entry.documentId === projectId);
  if (!hasVerifiedAcknowledgement(parent) || parent.operation !== CLOUD_MUTATION_OPERATION.UPSERT
    || asText(parent.payload?.id) !== projectId
    || Number(parent.verifiedAt) <= Number(current.lastAttemptAt)) return null;
  const proof = `${parent.mutationId}:${parent.revision}:${parent.verifiedAt}`;
  return current.automaticRecoveryProof === proof ? null : proof;
}

// Immutable targeted estimate upserts contain the complete estimate contract;
// exact-target verified deletes prove absence. Neither a global high-water mark
// nor an app-restore bundle proves that this targeted estimate was persisted.
export async function reconcileSupersededParentMissingMutations({ recoveryContext = null } = {}) {
  const failures = readCloudMutationLedger().entries.filter(isParentMissingEstimate);
  let retiredCount = 0;
  for (const failed of failures) {
    const result = await commitTransition(failed.mutationId, failed.revision, (current, ledger) => {
      const identity = deriveParentMissingEstimateRecoveryIdentity(current, recoveryContext);
      if (!identity) return { code: "mutation_not_retryable" };
      const proof = [...ledger.entries].reverse().find(entry =>
        recoveryEntryCompanyId(entry, current.companyId ? null : recoveryContext) === identity.companyId && entry.entityType === current.entityType
        && entry.documentId === current.documentId && entry.revision > current.revision);
      if (!hasVerifiedAcknowledgement(proof) || asText(proof.payload?.id) !== current.documentId
        || ![CLOUD_MUTATION_OPERATION.UPSERT, CLOUD_MUTATION_OPERATION.DELETE].includes(proof.operation)) {
        return { code: "no_verified_supersession" };
      }
      // Preserve payload/error/retry history and both ledger clocks. This is
      // coverage by an existing proof, not a new cloud write or verification.
      return { entry: { ...current, status: CLOUD_MUTATION_STATUS.ACKNOWLEDGED,
        acknowledgedAt: proof.acknowledgedAt, nextRetryAt: null,
        supersededByMutationId: proof.mutationId, supersededByRevision: proof.revision } };
    });
    if (result.ok) retiredCount += 1;
  }
  return { ok: true, retiredCount };
}

const SUPERSEDED_QUEUE_STATUSES = new Set([
  "conflict",
  "remote_changed",
  "needs_attention",
  "failed",
]);

function readRawQueue(storage = localStorage) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function expectedQueueDomain(entityType) {
  if (entityType === CLOUD_MUTATION_ENTITY.ESTIMATE) return "estimates";
  if (entityType === CLOUD_MUTATION_ENTITY.INVOICE) return "invoices";
  return "";
}

export function canVerifiedMutationSupersedeCloudBackupQueue(queueState, mutation) {
  const queue = queueState && typeof queueState === "object" && !Array.isArray(queueState) ? queueState : null;
  const expectedDomain = expectedQueueDomain(mutation?.entityType);
  if (!queue || !expectedDomain || !queue.pending) return false;
  if (!SUPERSEDED_QUEUE_STATUSES.has(asText(queue.status).toLowerCase())) return false;
  if (asText(queue.documentId) !== asText(mutation?.documentId)) return false;
  const queueCompanyId = asText(queue.companyId);
  const mutationCompanyId = asText(mutation?.companyId);
  if (queueCompanyId && queueCompanyId !== mutationCompanyId) return false;
  const domains = [...new Set((Array.isArray(queue.domains) ? queue.domains : []).map(asText).filter(Boolean))];
  if (domains.length !== 1 || domains[0] !== expectedDomain) return false;
  const lastQueuedAt = Number(queue.lastQueuedAt || 0);
  const mutationCreatedAt = Number(mutation?.createdAt || 0);
  if (!(lastQueuedAt > 0) || !(mutationCreatedAt > 0) || lastQueuedAt > mutationCreatedAt) return false;
  return true;
}

function buildSupersededQueueState(queue, mutation, verifiedAt) {
  return {
    ...queue,
    pending: false,
    status: "clean",
    reasons: [],
    domains: [],
    severity: "low",
    priority: "deferred",
    syncingRevision: null,
    updatedAt: verifiedAt,
    lastVerifiedAt: verifiedAt,
    nextRetryAt: null,
    retryCount: 0,
    lastError: "",
    lastErrorCode: "",
    reviewOrigin: "",
    source: "verified_target_mutation_supersession",
    supersededCompatibilityFailure: {
      status: asText(queue.status),
      lastErrorCode: asText(queue.lastErrorCode),
      documentId: asText(queue.documentId),
      companyId: asText(queue.companyId),
      domains: Array.isArray(queue.domains) ? [...queue.domains] : [],
      lastQueuedAt: Number(queue.lastQueuedAt || 0) || null,
      supersededAt: verifiedAt,
      mutationId: asText(mutation?.mutationId),
      mutationRevision: Number(mutation?.revision || 0),
      mutationEntityType: mutation?.entityType,
    },
  };
}

export function acknowledgeCloudMutation(mutation, { verifiedAt = nowTs() } = {}) {
  const at = Number(verifiedAt) > 0 ? Number(verifiedAt) : nowTs();
  return (async () => {
    const ledger = readCloudMutationLedger();
    const index = ledger.entries.findIndex((entry) => entry.mutationId === asText(mutation?.mutationId) && entry.revision === Number(mutation?.revision));
    if (index < 0) return { ok: false, code: "mutation_not_found", ledger };
    const current = ledger.entries[index];
    if (current.status === CLOUD_MUTATION_STATUS.ACKNOWLEDGED) return { ok: false, code: "mutation_already_acknowledged", ledger };
    if (current.status === CLOUD_MUTATION_STATUS.RETIRED) return { ok: false, code: "mutation_retired", ledger };
    const acknowledged = {
      ...current,
      status: CLOUD_MUTATION_STATUS.ACKNOWLEDGED,
      acknowledgedAt: at,
      verifiedAt: at,
      nextRetryAt: null,
      lastError: "",
      lastErrorCode: "",
    };
    const nextLedger = {
      ...ledger,
      entries: ledger.entries.map((entry, entryIndex) => entryIndex === index ? acknowledged : entry),
      lastAcknowledgedRevision: Math.max(ledger.lastAcknowledgedRevision, current.revision),
      lastVerifiedAt: at,
    };
    const queue = readRawQueue();
    const queueRetired = canVerifiedMutationSupersedeCloudBackupQueue(queue, current);
    const records = [{ logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER, value: JSON.stringify(nextLedger) }];
    const retiredQueue = queueRetired ? buildSupersededQueueState(queue, current, at) : null;
    if (retiredQueue) records.push({ logicalKey: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: JSON.stringify(retiredQueue) });
    await runtimeCommitAtomicRecords(records);
    return { ok: true, mutation: acknowledged, ledger: nextLedger, queueRetired, queue: retiredQueue || queue };
  })();
}

export async function reconcileSupersededCloudBackupQueueFromAcknowledgedMutations() {
  const queue = readRawQueue();
  if (!queue?.pending) return { ok: true, repaired: false, code: "queue_not_pending", queue };
  const ledger = readCloudMutationLedger();
  const proof = [...ledger.entries]
    .filter((entry) => entry.status === CLOUD_MUTATION_STATUS.ACKNOWLEDGED && Number(entry.verifiedAt || 0) > 0 && Number(entry.acknowledgedAt || 0) > 0)
    .sort((left, right) => Number(right.revision || 0) - Number(left.revision || 0))
    .find((entry) => canVerifiedMutationSupersedeCloudBackupQueue(queue, entry));
  if (!proof) return { ok: true, repaired: false, code: "no_verified_supersession", queue };
  const retiredQueue = buildSupersededQueueState(queue, proof, Number(proof.verifiedAt));
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: JSON.stringify(retiredQueue) }]);
  return { ok: true, repaired: true, proof, queue: retiredQueue };
}
