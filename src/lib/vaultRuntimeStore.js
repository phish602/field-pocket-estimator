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
let channel = null;
let revalidationListener = null;

function openChannel() {
  if (channel || typeof globalThis.BroadcastChannel !== "function") return channel;
  try {
    channel = new globalThis.BroadcastChannel(RUNTIME_CHANNEL_NAME);
    channel.onmessage = (event) => {
      const message = event?.data;
      if (!message || typeof message !== "object") return;
      if (message.type !== "runtime-committed") return;
      if (!active || message.workspaceTag !== active.workspaceTag) return;      // another workspace
      if (message.runtimeGeneration !== active.runtimeGeneration) return;
      if (message.catalogRevision <= active.catalogRevision) return;            // not newer
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
  openChannel();
  // Where BroadcastChannel is unavailable, focus and visibility are the
  // fallback revalidation signals. Revision CAS still rejects stale writes.
  const onFocus = () => { if (typeof revalidationListener === "function") revalidationListener(); };
  if (typeof window !== "undefined" && typeof window.addEventListener === "function"
    && typeof globalThis.BroadcastChannel !== "function") {
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
  }
  return () => {
    revalidationListener = null;
    if (typeof window !== "undefined" && typeof window.removeEventListener === "function") {
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

export function isVaultRuntimeReady(generation) {
  return Boolean(active && !active.blocked && (generation === undefined || active.generation === generation));
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

function hydrationFailure(code) {
  return Object.freeze({ ok: false, state: "blocked", code, entryCount: 0, generation: 0 });
}

/**
 * Verify the encrypted runtime catalog and every record it names, then publish a
 * synchronous cache. Nothing is published unless the ENTIRE set verifies.
 */
export async function hydrateVaultRuntime({ userId, companyId, repository = null } = {}) {
  // Snapshot the outgoing cache: after the NEW set verifies, the application is
  // told exactly which logical keys changed. Events are never emitted from
  // unverified state.
  const previousCache = active && !active.blocked ? new Map(active.cache) : null;
  revokeVaultRuntime();
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

      const cache = new Map();
      const meta = new Map();
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
          cache.set(entry.key, new TextDecoder().decode(bytes));
          meta.set(entry.key, { blobId: entry.blobId, revision: entry.revision, byteLength: entry.byteLength, digest: entry.digest });
        } catch {
          return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.RECORD_INVALID);
        } finally {
          if (bytes) bytes.fill(0);
          bytes = null;
        }
      }

      generationCounter += 1;
      active = {
        generation: generationCounter,
        workspaceTag,
        userId,
        companyId,
        repository: vaultRepository,
        cache,
        meta,
        catalogRevision: stored.revision,
        runtimeGeneration: stored.runtimeGeneration,
        queue: [],
        draining: false,
        blocked: false,
        blockedCode: "",
      };
      notifyStatus();
      dispatchChangedLogicalKeys(previousCache, cache);
      return Object.freeze({ ok: true, state: "ready", code: "", entryCount: cache.size, generation: active.generation });
    },
  });

  return outcome || hydrationFailure(VAULT_RUNTIME_ERROR_CODES.VAULT_LOCKED);
}

/**
 * Seal a verified completed migration into the FIRST runtime catalog. The frozen
 * migration manifest is read but never modified.
 */
export async function sealVaultRuntime({ userId, companyId, repository = null } = {}) {
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
      let existing;
      try {
        existing = await vaultRepository.readRuntimeCatalog({ workspaceTag });
      } catch {
        return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
      }
      if (existing) return Object.freeze({ ok: true, state: "already-sealed", code: "", entryCount: 0, generation: 0 });

      let recordKeys;
      try {
        recordKeys = await vaultRepository.listEncryptedRecordKeys({ workspaceTag });
      } catch {
        return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
      }

      // The seal derives its entries from the ACTUAL verified encrypted records,
      // decrypting each one to recompute its exact byte length and digest.
      const entries = [];
      for (const logicalKey of [...recordKeys].sort()) {
        if (!APPROVED.has(logicalKey)) return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.RECORD_UNEXPECTED);
        let record;
        try {
          record = await vaultRepository.readEncryptedRecord({ workspaceTag, logicalKey });
        } catch {
          return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
        }
        if (!record) return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.RECORD_MISSING);
        let bytes = null;
        try {
          bytes = await decryptBytes(dek, record.ciphertext, record.iv,
            recordAadFor({ userId, companyId, logicalKey, blobId: record.blobId }));
          entries.push({
            key: logicalKey,
            blobId: record.blobId,
            byteLength: bytes.length,
            digest: await digestBytes(bytes),
            revision: record.revision,
          });
        } catch {
          return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.RECORD_INVALID);
        } finally {
          if (bytes) bytes.fill(0);
          bytes = null;
        }
      }

      try {
        const catalog = buildRuntimeCatalog({ runtimeGeneration: 1, entries });
        const envelope = await encryptRuntimeCatalog({ dek, userId, companyId, catalog });
        const created = await vaultRepository.createRuntimeCatalog({
          workspaceTag,
          expectedRevision: null,
          runtimeGeneration: 1,
          runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
          ciphertext: envelope.ciphertext,
          iv: envelope.iv,
        });
        if (!created) return hydrationFailure(VAULT_RUNTIME_ERROR_CODES.CONFLICT);
        return Object.freeze({ ok: true, state: "sealed", code: "", entryCount: entries.length, generation: 0 });
      } catch (error) {
        return hydrationFailure(error?.code === "CONFLICT" ? VAULT_RUNTIME_ERROR_CODES.CONFLICT : VAULT_RUNTIME_ERROR_CODES.STORAGE_OPERATION_FAILED);
      }
    },
  });

  return outcome || hydrationFailure(VAULT_RUNTIME_ERROR_CODES.VAULT_LOCKED);
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
  if (!active || active.blocked) return false;
  if (!APPROVED.has(logicalKey)) return false;
  const next = String(value);
  // Synchronous cache update keeps read-after-write identical to localStorage.
  active.cache.set(logicalKey, next);
  enqueue({ kind: "set", logicalKey, value: next, generation: active.generation });
  return true;
}

export function runtimeRemoveItem(logicalKey) {
  if (!active || active.blocked) return false;
  if (!APPROVED.has(logicalKey)) return false;
  if (!active.cache.has(logicalKey)) return true;
  active.cache.delete(logicalKey);
  enqueue({ kind: "remove", logicalKey, generation: active.generation });
  return true;
}

export function runtimeClear() {
  if (!active || active.blocked) return false;
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
    const catalog = buildRuntimeCatalog({ runtimeGeneration: session.runtimeGeneration, entries: nextEntries });
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
  const catalog = buildRuntimeCatalog({ runtimeGeneration: session.runtimeGeneration, entries: nextEntries });
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
  const catalog = buildRuntimeCatalog({ runtimeGeneration: session.runtimeGeneration, entries: [] });
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
  if (!active) return;
  const session = active;
  session.queue.length = 0;
  session.cache.clear();
  session.meta.clear();
  session.blocked = true;
  session.blockedCode = "REVOKED";
  active = null;
  closeChannel();
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
