/* global globalThis */

// ISO-16 -- the authoritative encrypted runtime.
//
// After migration reaches authority the workspace's plaintext no longer exists,
// so the application's synchronous storage calls must be served from a verified,
// module-private, in-memory cache whose every mutation is durably re-encrypted
// into the workspace vault.
//
// Invariants held here:
//   * the DEK is only ever borrowed inside runWithActiveVaultDek; it is never
//     returned, stored, serialized, logged, or placed on window;
//   * a mutation is applied to the cache synchronously (so read-after-write
//     matches localStorage) but is only reported DURABLE after its IndexedDB
//     transaction commits;
//   * the first durability failure blocks the runtime -- there is no plaintext
//     fallback and no last-write-wins;
//   * every operation is bound to one exact workspace identity and runtime
//     generation, so a stale async completion can never write into a new
//     identity or republish readiness.

import {
  VAULT_MIGRATION_LOGICAL_KEYS,
  createVaultIndexedDbRepository,
} from "./vaultIndexedDbRepository";
import { decryptBytes, encryptBytes, recordAad } from "./vaultCrypto";
import { deriveWorkspaceVaultTag, runWithActiveVaultDek } from "./vaultSession";
import { VAULT_MIGRATION_ERROR_CODES, verifyCompletedVaultMigrationAuthority } from "./vaultMigrationOrchestrator";
import {
  RUNTIME_SCHEMA_VERSION,
  VAULT_FORMAT_VERSION,
  VaultRuntimeCatalogError,
  buildRuntimeCatalog,
  decryptRuntimeCatalog,
  digestBytes,
  encryptRuntimeCatalog,
  randomBlobId,
  utf8Bytes,
} from "./vaultRuntimeCatalog";

export const VAULT_RUNTIME_ERROR_CODES = Object.freeze({
  NOT_READY: "NOT_READY",
  UNSUPPORTED_KEY: "UNSUPPORTED_KEY",
  CATALOG_ABSENT: "CATALOG_ABSENT",
  CATALOG_INVALID: "CATALOG_INVALID",
  RECORD_INVALID: "RECORD_INVALID",
  STALE_SESSION: "STALE_SESSION",
  MIGRATION_UNVERIFIED: "MIGRATION_UNVERIFIED",
  RECORD_MISSING: "RECORD_MISSING",
  RECORD_UNEXPECTED: "RECORD_UNEXPECTED",
  VAULT_LOCKED: "VAULT_LOCKED",
  DURABILITY_FAILED: "DURABILITY_FAILED",
  CONFLICT: "CONFLICT",
  STORAGE_OPERATION_FAILED: "STORAGE_OPERATION_FAILED",
});

const APPROVED = new Set(VAULT_MIGRATION_LOGICAL_KEYS);
const RECORD_SCHEMA_VERSION = 1;

// Module-private. Never exported, never serialized, never exposed on window.
let active = null;
let generationCounter = 0;

// ---------------------------------------------------------------------------
// Exact runtime-session ownership
//
// Identity equality is NOT enough. The same user and company can lock, idle
// lock, log out and back in, unlock again, or re-activate while an older
// operation is still in flight, and that older operation must not be able to
// publish, revoke, block, clear, or unfreeze whatever replaced it.
//
// So every long operation carries an OPAQUE token bound to the exact session it
// began from. The token is an empty frozen object: it carries no identity, no
// workspace tag, no key material, no plaintext, and no repository record. The
// binding lives here, in a WeakMap the token holder can never read.
// ---------------------------------------------------------------------------

const leaseSessions = new WeakMap();
let currentActivation = null;

function newToken() {
  return Object.freeze({});
}

function leaseOwnsActiveSession(lease) {
  return Boolean(lease && active && active.lease === lease && leaseSessions.get(lease) === active);
}

function activationIsCurrent(token) {
  return Boolean(token && token === currentActivation);
}

/**
 * Claims ownership of the NEXT runtime session for an initial activation. A
 * completion whose token is no longer current (lock, unmount, or a newer
 * activation) can never recreate a runtime.
 */
export function beginVaultRuntimeActivation() {
  currentActivation = newToken();
  return currentActivation;
}

/** True while a runtime session exists for this tab, frozen or not. */
export function hasVaultRuntimeSession() {
  return Boolean(active && !active.blocked);
}

function idle() {
  return Object.freeze({ state: "idle", generation: 0, pending: 0, code: "", entryCount: 0 });
}

function publicStatus() {
  if (!active) return idle();
  return Object.freeze({
    state: active.blocked ? "blocked" : (active.queue.length > 0 || active.draining ? "pending-writes" : "ready"),
    generation: active.generation,
    pending: active.queue.length + (active.draining ? 1 : 0),
    code: active.blockedCode || "",
    entryCount: active.cache.size,
  });
}

// Status changes are published to subscribers rather than polled. A timer would
// leave an open handle for the lifetime of every mounted app, which is both
// wasteful and a real hazard in a test environment.
const statusListeners = new Set();

function notifyStatus() {
  const status = publicStatus();
  statusListeners.forEach((listener) => {
    try { listener(status); } catch { /* a listener must never break the runtime */ }
  });
}

export function subscribeVaultRuntimeStatus(listener) {
  if (typeof listener !== "function") return () => {};
  statusListeners.add(listener);
  return () => { statusListeners.delete(listener); };
}

// ---------------------------------------------------------------------------
// Cross-tab propagation
//
// Revision compare-and-set in the repository is the FINAL authority: a stale tab
// can never overwrite a newer record, with or without any of this. What follows
// is freshness only -- it tells other tabs to re-read, it never authorizes a
// write. Nothing identifying is published: the message carries a workspace tag
// (a pseudonymous digest), a runtime generation, and a catalog revision. No
// plaintext, ciphertext, IV, key, identity, namespace, or token is ever sent.
// ---------------------------------------------------------------------------

const RUNTIME_CHANNEL_NAME = "estipaid-vault-runtime-v1";
const REVALIDATION_MESSAGE_FIELDS = ["catalogRevision", "runtimeGeneration", "type", "workspaceTag"];
const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;
let channel = null;
let revalidationListener = null;

// A channel message is attacker-influenced input: any page on this origin can
// post to a named BroadcastChannel. It is accepted only as an EXACT shape, and
// even then it can do nothing but ask this tab to re-read and re-verify.
function exactRevalidationMessage(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertySymbols(value).length > 0) return null;
  // getOwnPropertyNames, not keys: a non-enumerable own property is still an
  // own property, and every field must be a plain DATA property -- an accessor
  // could return a different value on each read.
  const names = Object.getOwnPropertyNames(value).sort();
  if (names.join(",") !== REVALIDATION_MESSAGE_FIELDS.join(",")) return null;
  for (const name of names) {
    const descriptor = Object.getOwnPropertyDescriptor(value, name);
    if (!descriptor || typeof descriptor.get === "function" || typeof descriptor.set === "function") return null;
    if (!Object.prototype.hasOwnProperty.call(descriptor, "value")) return null;
  }
  if (value.type !== "runtime-committed") return null;
  if (typeof value.workspaceTag !== "string" || !WORKSPACE_TAG.test(value.workspaceTag)) return null;
  if (!Number.isSafeInteger(value.runtimeGeneration) || value.runtimeGeneration < 1) return null;
  if (!Number.isSafeInteger(value.catalogRevision) || value.catalogRevision < 1) return null;
  return value;
}

// A constructor that exists is not proof of a usable transport: it can throw, or
// return an object that cannot carry a message. The focus/visibility fallback is
// chosen on what was ACTUALLY opened, never on the constructor's presence.
function usableChannel(candidate) {
  return Boolean(candidate)
    && typeof candidate === "object"
    && typeof candidate.postMessage === "function"
    && typeof candidate.close === "function";
}

function openChannel() {
  if (channel || typeof globalThis.BroadcastChannel !== "function") return channel;
  try {
    const opened = new globalThis.BroadcastChannel(RUNTIME_CHANNEL_NAME);
    if (!usableChannel(opened)) {
      try { if (opened && typeof opened.close === "function") opened.close(); } catch { /* nothing to close */ }
      channel = null;
      return null;
    }
    channel = opened;
    channel.onmessage = (event) => {
      const message = exactRevalidationMessage(event?.data);
      if (!message) return;
      if (!active || active.blocked) return;                                   // nothing to revalidate
      if (message.workspaceTag !== active.workspaceTag) return;                // another workspace
      if (message.runtimeGeneration !== active.runtimeGeneration) return;
      if (message.catalogRevision <= active.catalogRevision) return;           // not newer
      // Another tab committed a newer catalog. This tab must re-read and
      // re-verify rather than trust its cache.
      if (typeof revalidationListener === "function") revalidationListener();
    };
  } catch {
    channel = null;
  }
  return channel;
}

function publishCommit(session) {
  const bus = openChannel();
  if (!bus) return;
  try {
    bus.postMessage({
      type: "runtime-committed",
      workspaceTag: session.workspaceTag,
      runtimeGeneration: session.runtimeGeneration,
      catalogRevision: session.catalogRevision,
    });
  } catch { /* freshness only; CAS remains the authority */ }
}

function closeChannel() {
  if (!channel) return;
  try { channel.close(); } catch { /* already closed */ }
  channel = null;
}

/**
 * Registers the callback used when another tab commits a newer catalog, or when
 * this tab regains focus. Returns an unsubscribe function.
 */
export function subscribeVaultRuntimeRevalidation(listener) {
  revalidationListener = typeof listener === "function" ? listener : null;
  const bus = openChannel();
  // Where BroadcastChannel is unavailable, focus and visibility are the
  // fallback revalidation signals. Revision CAS still rejects stale writes.
  // A visibilitychange that HIDES the tab is not a freshness signal: revalidating
  // a backgrounded tab churns the runtime for a view nobody is looking at.
  const onFocus = () => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    if (typeof revalidationListener === "function") revalidationListener();
  };
  // Exactly one pair of fallback listeners, and only when the transport is
  // genuinely unavailable (missing constructor, throwing constructor, or an
  // object that cannot carry a message).
  const fallbackInstalled = !bus
    && typeof window !== "undefined"
    && typeof window.addEventListener === "function";
  if (fallbackInstalled) {
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
  }
  return () => {
    revalidationListener = null;
    if (fallbackInstalled && typeof window !== "undefined" && typeof window.removeEventListener === "function") {
      window.removeEventListener("focus", onFocus);
      try { document.removeEventListener("visibilitychange", onFocus); } catch { /* jsdom teardown */ }
    }
    closeChannel();
  };
}

// After a verified rehydration, tell the application which LOGICAL keys changed
// using the same event the app already listens to for same-tab writes. Only the
// logical key and its value travel; no physical key, namespace, or identity.
function dispatchChangedLogicalKeys(previousCache, nextCache) {
  if (!previousCache || typeof window === "undefined" || typeof window.dispatchEvent !== "function") return;
  const keys = new Set([...previousCache.keys(), ...nextCache.keys()]);
  keys.forEach((logicalKey) => {
    const before = previousCache.has(logicalKey) ? previousCache.get(logicalKey) : null;
    const after = nextCache.has(logicalKey) ? nextCache.get(logicalKey) : null;
    if (before === after) return;
    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", {
        detail: { key: logicalKey, value: after, oldValue: before, crossTab: true },
      }));
    } catch { /* a listener that throws must not break the runtime */ }
  });
}

export function getVaultRuntimeStatus() {
  return publicStatus();
}

/**
 * Readable: the last VERIFIED cache can still answer approved reads, including
 * while mutations are frozen for a revalidation. This is deliberately separate
 * from readiness -- a facade that treats "temporarily not mutation-ready" as "no
 * authoritative runtime" would fall back to scoped plaintext.
 */
export function isVaultRuntimeReadable(generation) {
  return Boolean(active && !active.blocked
    && (generation === undefined || active.generation === generation));
}

export function isVaultRuntimeReady(generation) {
  // A frozen runtime is mid-revalidation: its cache is still the last verified
  // one, but it is not "ready", so the facade fails closed rather than letting a
  // write land in a session that is about to be replaced.
  return Boolean(active && !active.blocked && !active.frozen
    && (generation === undefined || active.generation === generation));
}

/**
 * Freeze mutations for a same-identity revalidation. Reads keep serving the last
 * VERIFIED cache; every new approved mutation gets a definite refusal instead of
 * being accepted into a session that is about to be replaced.
 */
export function freezeVaultRuntimeMutations() {
  if (!active || active.blocked) return Object.freeze({ frozen: false, generation: 0, pending: 0, lease: null });
  const lease = newToken();
  active.frozen = true;
  active.lease = lease;
  leaseSessions.set(lease, active);
  notifyStatus();
  return Object.freeze({ frozen: true, generation: active.generation, pending: active.queue.length, lease });
}

/**
 * Reopen mutations when a revalidation ends without replacing the runtime. Only
 * the EXACT lease that froze the session may reopen it: a stale lease, a lease
 * from a replaced session or another generation, and no lease at all all leave
 * the current runtime untouched.
 */
export function unfreezeVaultRuntimeMutations(lease) {
  if (!leaseOwnsActiveSession(lease)) {
    return Object.freeze({ frozen: Boolean(active && active.frozen), generation: active ? active.generation : 0, stale: true });
  }
  active.frozen = false;
  active.lease = null;
  notifyStatus();
  return Object.freeze({ frozen: false, generation: active.generation, stale: false });
}

export function isVaultRuntimeFrozen() {
  return Boolean(active && active.frozen);
}

function recordAadFor({ userId, companyId, logicalKey, blobId }) {
  return recordAad({
    vaultFormatVersion: VAULT_FORMAT_VERSION,
    userId,
    companyId,
    logicalStorageKey: logicalKey,
    blobIdentifier: blobId,
    recordSchemaVersion: RECORD_SCHEMA_VERSION,
  });
}

// ---------------------------------------------------------------------------
// Hydration
// ---------------------------------------------------------------------------

function failureResult(code) {
  return Object.freeze({ ok: false, state: "blocked", code, entryCount: 0, generation: 0 });
}

function staleResult() {
  // A superseded operation reports itself stale and changes nothing at all.
  return Object.freeze({ ok: false, state: "stale", code: VAULT_RUNTIME_ERROR_CODES.STALE_SESSION, entryCount: 0, generation: 0 });
}

// A failed candidate is fail-closed for the EXACT session it was verifying: that
// session is revoked rather than left serving unverifiable durable state. A
// failure whose lease or activation claim is no longer current changes nothing,
// so a late failure can never tear down the runtime that replaced it.
function hydrationFailureFor({ lease, activation, userId, companyId }) {
  return (code) => {
    // Ownership is BOTH the exact token and the exact identity. A token proves
    // the session has not been replaced; the identity check proves this failure
    // belongs to that session's workspace at all. Without a token (an internal
    // or test-only hydration) the identity check alone still applies.
    const sameIdentity = !active || (active.userId === userId && active.companyId === companyId);
    const tokenCurrent = lease
      ? leaseOwnsActiveSession(lease)
      : (activation ? activationIsCurrent(activation) : true);
    if (!tokenCurrent || !sameIdentity) return staleResult();
    revokeVaultRuntime();
    return failureResult(code);
  };
}

/**
 * Verify the encrypted runtime catalog and every record it names, then publish a
 * synchronous cache. Nothing is published unless the ENTIRE set verifies.
 */
export async function hydrateVaultRuntime({ userId, companyId, repository = null, lease = null, activation = null } = {}) {
  // The previously verified runtime stays ACTIVE for the whole of verification.
  // Revoking first left a window in which the hook could still report ready
  // while the authoritative cache was already gone: reads looked empty and
  // writes were refused with no explanation. Everything below is built into a
  // local CANDIDATE and only becomes active in one atomic step at the end.
  const previous = active && !active.blocked ? active : null;
  const previousCache = previous ? new Map(previous.cache) : null;
  const hydrationFailure = hydrationFailureFor({ lease, activation, userId, companyId });
  // A revalidation must present a lease that still owns the exact active
  // session; an initial activation must present the current activation claim.
  // Anything else is already superseded and stops here.
  if (lease && !leaseOwnsActiveSession(lease)) return staleResult();
  if (!lease && activation && !activationIsCurrent(activation)) return staleResult();
  let workspaceTag;
  try {
    workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
  } catch {
    return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
  }
  const vaultRepository = repository || createVaultIndexedDbRepository();

  const outcome = await runWithActiveVaultDek({
    workspaceTag,
    operation: async (dek) => {
      let stored;
      try {
        stored = await vaultRepository.readRuntimeCatalog({ workspaceTag });
      } catch {
        return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
      }
      if (!stored) return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.CATALOG_ABSENT);

      let catalog;
      try {
        catalog = await decryptRuntimeCatalog({ dek, userId, companyId, stored });
      } catch (error) {
        return hydrationFailure(error instanceof VaultRuntimeCatalogError ? VAULT_RUNTIME_ERROR_CODES.CATALOG_INVALID : VAULT_RUNTIME_ERROR_CODES.CATALOG_INVALID);
      }

      // The catalog and the record store must agree EXACTLY.
      let recordKeys;
      try {
        recordKeys = await vaultRepository.listEncryptedRecordKeys({ workspaceTag });
      } catch {
        return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
      }
      const cataloged = catalog.entries.map((entry) => entry.key).sort();
      const persisted = [...recordKeys].sort();
      if (cataloged.length !== persisted.length || cataloged.some((key, index) => key !== persisted[index])) {
        return hydrationFailure(cataloged.length < persisted.length
          ? VAULT_RUNTIME_ERROR_CODES.RECORD_UNEXPECTED
          : VAULT_RUNTIME_ERROR_CODES.RECORD_MISSING);
      }

      // Candidate state. Nothing here is reachable from runtimeGetItem,
      // runtimeSetItem, the status surface, or the installed adapter until the
      // atomic replacement below succeeds.
      const candidateCache = new Map();
      const candidateMeta = new Map();
      for (const entry of catalog.entries) {
        let record;
        try {
          record = await vaultRepository.readEncryptedRecord({ workspaceTag, logicalKey: entry.key });
        } catch {
          return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
        }
        if (!record) return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.RECORD_MISSING);
        if (record.blobId !== entry.blobId
          || record.revision !== entry.revision
          || record.recordSchemaVersion !== RECORD_SCHEMA_VERSION
          || record.logicalKey !== entry.key) {
          return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.RECORD_INVALID);
        }
        let bytes = null;
        try {
          bytes = await decryptBytes(dek, record.ciphertext, record.iv,
            recordAadFor({ userId, companyId, logicalKey: entry.key, blobId: entry.blobId }));
          if (bytes.length !== entry.byteLength) return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.RECORD_INVALID);
          if (await digestBytes(bytes) !== entry.digest) return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.RECORD_INVALID);
          candidateCache.set(entry.key, new TextDecoder().decode(bytes));
          candidateMeta.set(entry.key, { blobId: entry.blobId, revision: entry.revision, byteLength: entry.byteLength, digest: entry.digest });
        } catch {
          return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.RECORD_INVALID);
        } finally {
          if (bytes) bytes.fill(0);
          bytes = null;
        }
      }

      // ---- atomic replacement ------------------------------------------
      // The entire candidate verified. Retire the outgoing session and publish
      // the new one in one synchronous step, so no observer can ever see a
      // half-replaced runtime.
      generationCounter += 1;
      const candidate = {
        generation: generationCounter,
        workspaceTag,
        userId,
        companyId,
        repository: vaultRepository,
        cache: candidateCache,
        meta: candidateMeta,
        catalogRevision: stored.revision,
        runtimeGeneration: stored.runtimeGeneration,
        queue: [],
        draining: false,
        blocked: false,
        blockedCode: "",
        frozen: false,
        lease: null,
      };
      // Ownership is re-checked at the LAST possible moment. Between the start
      // of verification and here the runtime may have been locked, revoked,
      // replaced by a newer same-identity activation, or unmounted -- in every
      // one of those cases this candidate is stale and must be discarded.
      const stillOwns = lease ? leaseOwnsActiveSession(lease) : activationIsCurrent(activation);
      if ((lease || activation) && !stillOwns) {
        candidateCache.clear();
        candidateMeta.clear();
        return staleResult();
      }
      if (active && active !== previous && (active.userId !== userId || active.companyId !== companyId)) {
        // A different identity took over while this candidate was verifying.
        // Publishing here would hand one workspace's cache to another.
        candidateCache.clear();
        candidateMeta.clear();
        return failureResult(VAULT_RUNTIME_ERROR_CODES.CONFLICT);
      }
      if (previous && active === previous) {
        // The outgoing session is retired, not merely dropped: any late async
        // completion bound to it can still see that it is no longer current.
        previous.queue.length = 0;
        previous.cache.clear();
        previous.meta.clear();
        previous.blocked = true;
        previous.blockedCode = "REPLACED";
      }
      active = candidate;
      notifyStatus();
      // Events are emitted only AFTER replacement, so a listener that reads back
      // synchronously sees the new cache, never the candidate or the old one.
      dispatchChangedLogicalKeys(previousCache, candidate.cache);
      if (previousCache) previousCache.clear();
      return Object.freeze({ ok: true, state: "ready", code: "", entryCount: candidate.cache.size, generation: candidate.generation });
    },
  });

  return outcome || hydrationFailure(VAULT_RUNTIME_ERROR_CODES.VAULT_LOCKED);
}

/**
 * Seal a verified completed migration into the FIRST runtime catalog. The frozen
 * migration manifest is read but never modified.
 */
export async function sealVaultRuntime({ userId, companyId, repository = null, storage = undefined, readGuard = undefined } = {}) {
  let workspaceTag;
  try {
    workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
  } catch {
    return failureResult(VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
  }
  const vaultRepository = repository || createVaultIndexedDbRepository();

  const outcome = await runWithActiveVaultDek({
    workspaceTag,
    operation: async (dek) => {
      let existing;
      try {
        existing = await vaultRepository.readRuntimeCatalog({ workspaceTag });
      } catch {
        return failureResult(VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
      }
      if (existing) return Object.freeze({ ok: true, state: "already-sealed", code: "", entryCount: 0, generation: 0 });

      // The seal adopts ONLY what the completed migration proved. Enumerating
      // the record store here instead would let a record injected into
      // IndexedDB before the first seal become authoritative content, because
      // nothing else in the runtime ever re-checks the migration manifest.
      const authority = await verifyCompletedVaultMigrationAuthority({
        workspaceTag, dek, userId, companyId, vaultRepository, storage, readGuard,
      });
      if (!authority.ok) {
        return failureResult(authority.code === VAULT_MIGRATION_ERROR_CODES.VAULT_LOCKED
          ? VAULT_RUNTIME_ERROR_CODES.VAULT_LOCKED
          : VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED);
      }

      // The manifest is authenticated but the runtime catalog is a separate
      // contract, so each verified entry is re-checked against the approved
      // key list before it can enter the catalog.
      const entries = [];
      for (const entry of authority.entries) {
        if (!APPROVED.has(entry.key)) return failureResult(VAULT_RUNTIME_ERROR_CODES.RECORD_UNEXPECTED);
        entries.push({
          key: entry.key,
          blobId: entry.blobId,
          byteLength: entry.byteLength,
          digest: entry.digest,
          revision: entry.revision,
        });
      }

      try {
        // A freshly created catalog is persisted at wrapper revision 1, so the
        // authenticated plaintext must claim exactly 1.
        const catalog = buildRuntimeCatalog({ runtimeGeneration: 1, catalogRevision: 1, entries });
        const envelope = await encryptRuntimeCatalog({ dek, userId, companyId, catalog });
        const created = await vaultRepository.createRuntimeCatalog({
          workspaceTag,
          expectedRevision: null,
          runtimeGeneration: 1,
          runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
          ciphertext: envelope.ciphertext,
          iv: envelope.iv,
        });
        if (!created) return failureResult(VAULT_RUNTIME_ERROR_CODES.CONFLICT);
        return Object.freeze({ ok: true, state: "sealed", code: "", entryCount: entries.length, generation: 0 });
      } catch (error) {
        return failureResult(error?.code === "CONFLICT" ? VAULT_RUNTIME_ERROR_CODES.CONFLICT : VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
      }
    },
  });

  return outcome || failureResult(VAULT_RUNTIME_ERROR_CODES.VAULT_LOCKED);
}

// ---------------------------------------------------------------------------
// Synchronous cache surface
// ---------------------------------------------------------------------------

export function runtimeHasKey(logicalKey) {
  return Boolean(active && !active.blocked && active.cache.has(logicalKey));
}

export function runtimeGetItem(logicalKey) {
  if (!active || active.blocked) return null;
  if (!APPROVED.has(logicalKey)) return null;
  return active.cache.has(logicalKey) ? active.cache.get(logicalKey) : null;
}

export function runtimeLogicalKeys() {
  if (!active || active.blocked) return [];
  return [...active.cache.keys()];
}

function enqueue(operation) {
  active.queue.push(operation);
  notifyStatus();
  if (!active.draining) drain();
}

export function runtimeSetItem(logicalKey, value) {
  if (!active || active.blocked || active.frozen) return false;
  if (!APPROVED.has(logicalKey)) return false;
  const next = String(value);
  // Synchronous cache update keeps read-after-write identical to localStorage.
  active.cache.set(logicalKey, next);
  enqueue({ kind: "set", logicalKey, value: next, generation: active.generation });
  return true;
}

export function runtimeRemoveItem(logicalKey) {
  if (!active || active.blocked || active.frozen) return false;
  if (!APPROVED.has(logicalKey)) return false;
  if (!active.cache.has(logicalKey)) return true;
  active.cache.delete(logicalKey);
  enqueue({ kind: "remove", logicalKey, generation: active.generation });
  return true;
}

export function runtimeClear() {
  if (!active || active.blocked || active.frozen) return false;
  if (active.cache.size === 0) return true;
  active.cache.clear();
  enqueue({ kind: "clear", generation: active.generation });
  return true;
}

// ---------------------------------------------------------------------------
// Durability queue
// ---------------------------------------------------------------------------

function block(code) {
  if (!active) return;
  active.blocked = true;
  active.blockedCode = code;
  active.queue.length = 0;
  notifyStatus();
}

async function commitSet(session, dek, operation) {
  const plain = utf8Bytes(operation.value);
  try {
    const blobId = randomBlobId();
    const envelope = await encryptBytes(dek, plain,
      recordAadFor({ userId: session.userId, companyId: session.companyId, logicalKey: operation.logicalKey, blobId }));
    const previous = session.meta.get(operation.logicalKey) || null;
    const nextEntries = [...session.meta.entries()]
      .filter(([key]) => key !== operation.logicalKey)
      .map(([key, value]) => ({ key, ...value }));
    nextEntries.push({
      key: operation.logicalKey,
      blobId,
      byteLength: plain.length,
      digest: await digestBytes(plain),
      revision: previous ? previous.revision + 1 : 1,
    });
    // Every commit CASes on session.catalogRevision, so the revision the store
    // will observe after a successful commit is exactly one higher. Binding it
    // into the plaintext before encryption means an envelope written for one
    // revision can never be replayed under another.
    const catalog = buildRuntimeCatalog({ runtimeGeneration: session.runtimeGeneration, catalogRevision: session.catalogRevision + 1, entries: nextEntries });
    const catalogEnvelope = await encryptRuntimeCatalog({ dek, userId: session.userId, companyId: session.companyId, catalog });
    const committed = await session.repository.commitRuntimeRecordSet({
      workspaceTag: session.workspaceTag,
      logicalKey: operation.logicalKey,
      expectedRecordRevision: previous ? previous.revision : null,
      expectedCatalogRevision: session.catalogRevision,
      blobId,
      recordSchemaVersion: RECORD_SCHEMA_VERSION,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      catalogCiphertext: catalogEnvelope.ciphertext,
      catalogIv: catalogEnvelope.iv,
      runtimeGeneration: session.runtimeGeneration,
      runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
    });
    if (!committed) throw new Error("COMMIT_REJECTED");
    session.catalogRevision = committed.catalog.revision;
    session.meta.set(operation.logicalKey, {
      blobId,
      revision: committed.record.revision,
      byteLength: plain.length,
      digest: nextEntries[nextEntries.length - 1].digest,
    });
  } finally {
    plain.fill(0);
  }
}

async function commitRemove(session, dek, operation) {
  const previous = session.meta.get(operation.logicalKey);
  if (!previous) return;
  const nextEntries = [...session.meta.entries()]
    .filter(([key]) => key !== operation.logicalKey)
    .map(([key, value]) => ({ key, ...value }));
  const catalog = buildRuntimeCatalog({ runtimeGeneration: session.runtimeGeneration, catalogRevision: session.catalogRevision + 1, entries: nextEntries });
  const catalogEnvelope = await encryptRuntimeCatalog({ dek, userId: session.userId, companyId: session.companyId, catalog });
  const committed = await session.repository.commitRuntimeRecordRemove({
    workspaceTag: session.workspaceTag,
    logicalKey: operation.logicalKey,
    expectedRecordRevision: previous.revision,
    expectedCatalogRevision: session.catalogRevision,
    catalogCiphertext: catalogEnvelope.ciphertext,
    catalogIv: catalogEnvelope.iv,
    runtimeGeneration: session.runtimeGeneration,
    runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
  });
  if (!committed) throw new Error("COMMIT_REJECTED");
  session.catalogRevision = committed.catalog.revision;
  session.meta.delete(operation.logicalKey);
}

async function commitClear(session, dek) {
  const catalog = buildRuntimeCatalog({ runtimeGeneration: session.runtimeGeneration, catalogRevision: session.catalogRevision + 1, entries: [] });
  const catalogEnvelope = await encryptRuntimeCatalog({ dek, userId: session.userId, companyId: session.companyId, catalog });
  const committed = await session.repository.commitRuntimeClear({
    workspaceTag: session.workspaceTag,
    expectedCatalogRevision: session.catalogRevision,
    catalogCiphertext: catalogEnvelope.ciphertext,
    catalogIv: catalogEnvelope.iv,
    runtimeGeneration: session.runtimeGeneration,
    runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
  });
  if (!committed) throw new Error("COMMIT_REJECTED");
  session.catalogRevision = committed.catalog.revision;
  session.meta.clear();
}

let drainPromise = null;

function drain() {
  if (!active || active.draining) return drainPromise || Promise.resolve();
  const session = active;
  session.draining = true;
  drainPromise = (async () => {
    while (session.queue.length > 0) {
      if (active !== session || session.blocked) break;
      const operation = session.queue.shift();
      // A queued operation from a revoked generation is discarded, never applied.
      if (operation.generation !== session.generation) continue;
      try {
        const applied = await runWithActiveVaultDek({
          workspaceTag: session.workspaceTag,
          operation: async (dek) => {
            if (operation.kind === "set") await commitSet(session, dek, operation);
            else if (operation.kind === "remove") await commitRemove(session, dek, operation);
            else if (operation.kind === "clear") await commitClear(session, dek);
            return true;
          },
        });
        if (applied !== true) {
          if (active === session) block(VAULT_RUNTIME_ERROR_CODES.VAULT_LOCKED);
          break;
        }
        // Durably committed: tell other tabs to re-read. CAS, not this message,
        // is what prevents a stale tab from overwriting newer data.
        publishCommit(session);
      } catch (error) {
        if (active === session) {
          block(error?.code === "CONFLICT" ? VAULT_RUNTIME_ERROR_CODES.CONFLICT : VAULT_RUNTIME_ERROR_CODES.DURABILITY_FAILED);
        }
        break;
      }
    }
    session.draining = false;
    if (active === session) notifyStatus();
  })();
  return drainPromise;
}

/** Await every accepted mutation. Resolves with the sanitized runtime status. */
export async function flushVaultRuntime() {
  if (!active) return idle();
  const session = active;
  while ((session.queue.length > 0 || session.draining) && active === session && !session.blocked) {
    // eslint-disable-next-line no-await-in-loop
    await (drainPromise || drain());
  }
  return publicStatus();
}

/** Immediate, synchronous revocation. Nothing survives an identity change. */
export function revokeVaultRuntime() {
  // A revocation (lock, idle lock, logout, identity switch, unmount) ends any
  // activation claim FIRST, and does so even when no session exists yet: an
  // initial activation that completes after the lock must not recreate a
  // runtime behind the gate.
  currentActivation = null;
  if (!active) return;
  const session = active;
  session.queue.length = 0;
  session.cache.clear();
  session.meta.clear();
  session.blocked = true;
  session.blockedCode = "REVOKED";
  active = null;
  // The channel deliberately stays open: it belongs to the subscription, and a
  // still-mounted subscriber must keep hearing other tabs after a revocation.
  notifyStatus();
}

/** Test-only inspection of sanitized runtime metadata. */
export function describeVaultRuntime() {
  if (!active) return Object.freeze({ active: false });
  return Object.freeze({
    active: true,
    generation: active.generation,
    runtimeGeneration: active.runtimeGeneration,
    catalogRevision: active.catalogRevision,
    entryCount: active.cache.size,
    pending: active.queue.length,
    blocked: active.blocked,
    code: active.blockedCode || "",
  });
}
