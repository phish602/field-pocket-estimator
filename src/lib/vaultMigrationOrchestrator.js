// ISO-15H -- implementation-only, headless plaintext-to-vault migration.
// This module is deliberately not imported by App, a hook, an event listener,
// or any cloud worker. It may only operate on the active ISO-14D facade.

import { getActiveAccountScopedStorage } from "./accountScopedLocalStorage";
import {
  decryptBytes,
  encryptBytes,
  migrationManifestAad,
  recordAad,
} from "./vaultCrypto";
import {
  VAULT_MIGRATION_LOGICAL_KEYS,
  createVaultIndexedDbRepository,
} from "./vaultIndexedDbRepository";
import { readVaultCompatibilityGuard } from "./vaultCompatibilityGuard";
import { writeVaultCompatibilityGuard } from "./vaultCompatibilityGuardWriter";
import { createVaultTransitionControlRepository } from "./vaultTransitionControlRepository";
import { deriveWorkspaceVaultTag, runWithActiveVaultDek } from "./vaultSession";

const MANIFEST_VERSION = 1;
const RECORD_SCHEMA_VERSION = 1;
const MANIFEST_SCHEMA_VERSION = 1;
const PHASES = Object.freeze(["prepared", "guarded", "copying", "verifying", "cleaning", "authoritative"]);

export const VAULT_MIGRATION_ERROR_CODES = Object.freeze({
  INVALID_REQUEST: "INVALID_REQUEST",
  STORAGE_UNAVAILABLE: "STORAGE_UNAVAILABLE",
  VAULT_LOCKED: "VAULT_LOCKED",
  GUARD_UNAVAILABLE: "GUARD_UNAVAILABLE",
  GUARD_RECOVERY_REQUIRED: "GUARD_RECOVERY_REQUIRED",
  OTHER_WORKSPACE_TRANSITION: "OTHER_WORKSPACE_TRANSITION",
  TRANSITION_CONFLICT: "TRANSITION_CONFLICT",
  MANIFEST_INVALID: "MANIFEST_INVALID",
  VERIFICATION_FAILED: "VERIFICATION_FAILED",
  SOURCE_CHANGED: "SOURCE_CHANGED",
  CLEANUP_PENDING: "CLEANUP_PENDING",
  STORAGE_OPERATION_FAILED: "STORAGE_OPERATION_FAILED",
  AUTHORITATIVE_WORKSPACE_UNVERIFIED: "AUTHORITATIVE_WORKSPACE_UNVERIFIED",
});

export class VaultMigrationError extends Error {
  constructor(code) {
    super("Vault migration could not be completed safely.");
    this.name = "VaultMigrationError";
    this.code = code;
  }
}

function result({ state, phase = "", code = "", resumable = false, authoritative = false, cleanupPending = false }) {
  return Object.freeze({ state, phase, code, resumable, authoritative, cleanupPending });
}

function fail(code, phase = "", { resumable = false, authoritative = false, cleanupPending = false } = {}) {
  return result({ state: "blocked", phase, code, resumable, authoritative, cleanupPending });
}

function transitionResult(phase, code = "") {
  return result({
    state: "transition",
    phase,
    code,
    resumable: true,
    authoritative: phase === "cleaning" || phase === "authoritative",
    cleanupPending: phase === "cleaning" || phase === "authoritative",
  });
}

function completed() {
  return result({ state: "authoritative", phase: "", code: "", resumable: false, authoritative: true, cleanupPending: false });
}

function bytesEqual(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) return false;
  let different = 0;
  for (let index = 0; index < left.length; index += 1) different |= left[index] ^ right[index];
  return different === 0;
}

function base64url(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let value = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    value += alphabet[a >> 2];
    value += alphabet[((a & 15) << 2) | (b >> 4)];
    if (index + 1 < bytes.length) value += alphabet[((b & 15) << 2) | (c >> 6)];
    if (index + 2 < bytes.length) value += alphabet[c & 63];
  }
  return value;
}

async function digest(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.STORAGE_OPERATION_FAILED);
  try {
    return base64url(new Uint8Array(await subtle.digest("SHA-256", bytes)));
  } catch {
    throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.STORAGE_OPERATION_FAILED);
  }
}

function randomBytes(length) {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.STORAGE_OPERATION_FAILED);
  const bytes = new Uint8Array(length);
  cryptoApi.getRandomValues(bytes);
  return bytes;
}

function randomTransitionId() {
  const value = globalThis.crypto?.randomUUID?.();
  if (typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) return value.toLowerCase();
  throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.STORAGE_OPERATION_FAILED);
}

function safePhase(value) {
  return PHASES.includes(value) ? value : "";
}

function validTransitionId(value) {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validWorkspaceTag(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

function metadataForPhase(phase) {
  const authoritative = phase === "cleaning" || phase === "authoritative";
  return { resumable: Boolean(phase), authoritative, cleanupPending: authoritative };
}

function metadataForFailure(code, phase) {
  const metadata = metadataForPhase(phase);
  if (code === VAULT_MIGRATION_ERROR_CODES.MANIFEST_INVALID || code === VAULT_MIGRATION_ERROR_CODES.VERIFICATION_FAILED) {
    return { ...metadata, resumable: false };
  }
  return metadata;
}

function exactManifest(value, transitionId) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  if (value.version !== MANIFEST_VERSION || value.transitionId !== transitionId || !Array.isArray(value.entries)) return null;
  if (Object.keys(value).sort().join(",") !== "entries,transitionId,version") return null;
  if (value.entries.length !== VAULT_MIGRATION_LOGICAL_KEYS.length) return null;
  const seen = new Set();
  const entries = [];
  for (const entry of value.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.getPrototypeOf(entry) !== Object.prototype) return null;
    if (Object.keys(entry).sort().join(",") !== "blobId,byteLength,digest,key,present") return null;
    if (!VAULT_MIGRATION_LOGICAL_KEYS.includes(entry.key) || seen.has(entry.key) || typeof entry.present !== "boolean") return null;
    if (entry.present) {
      if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0 || typeof entry.digest !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(entry.digest) || typeof entry.blobId !== "string" || !/^[A-Za-z0-9_-]{22}$/.test(entry.blobId)) return null;
    } else if (entry.byteLength !== null || entry.digest !== null || entry.blobId !== null) return null;
    seen.add(entry.key);
    entries.push(Object.freeze({ ...entry }));
  }
  if (seen.size !== VAULT_MIGRATION_LOGICAL_KEYS.length) return null;
  entries.sort((left, right) => left.key.localeCompare(right.key));
  return Object.freeze({ version: MANIFEST_VERSION, transitionId, entries: Object.freeze(entries) });
}

function assertFacade(storage) {
  if (!storage || typeof storage.getItem !== "function" || typeof storage.removeVaultMigrationItem !== "function") {
    throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.STORAGE_UNAVAILABLE);
  }
  return storage;
}

async function readEntry(storage, key, { blobId = null } = {}) {
  let rawValue = null;
  let bytes = null;
  try {
    rawValue = storage.getItem(key);
    if (rawValue === null) return Object.freeze({ key, present: false, byteLength: null, digest: null, blobId: null });
    if (typeof rawValue !== "string") throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.STORAGE_UNAVAILABLE);
    bytes = new Uint8Array(new TextEncoder().encode(rawValue));
    return Object.freeze({ key, present: true, byteLength: bytes.length, digest: await digest(bytes), blobId: blobId || base64url(randomBytes(16)) });
  } finally {
    if (bytes) bytes.fill(0);
    bytes = null;
    rawValue = null;
  }
}

async function captureManifest(storage, transitionId) {
  const entries = [];
  for (const key of VAULT_MIGRATION_LOGICAL_KEYS) entries.push(await readEntry(storage, key));
  return Object.freeze({ version: MANIFEST_VERSION, transitionId, entries: Object.freeze(entries.sort((a, b) => a.key.localeCompare(b.key))) });
}

async function matchesEntry(storage, entry) {
  const live = await readEntry(storage, entry.key, { blobId: entry.blobId });
  return live.present === entry.present
    && live.byteLength === entry.byteLength
    && live.digest === entry.digest;
}

async function decodeManifest({ repository, workspaceTag, transitionId, dek, userId, companyId }) {
  const stored = await repository.readMigrationManifest({ workspaceTag });
  if (!stored || stored.transitionId !== transitionId) throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.MANIFEST_INVALID);
  let plain = null;
  try {
    plain = await decryptBytes(dek, stored.ciphertext, stored.iv, migrationManifestAad({
      vaultFormatVersion: 1, userId, companyId, transitionId, manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    }));
    return exactManifest(JSON.parse(new TextDecoder().decode(plain)), transitionId)
      || (() => { throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.MANIFEST_INVALID); })();
  } catch (error) {
    if (error instanceof VaultMigrationError) throw error;
    throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.MANIFEST_INVALID);
  } finally {
    if (plain) plain.fill(0);
    plain = null;
  }
}

async function persistManifest({ repository, workspaceTag, transitionId, dek, userId, companyId, manifest }) {
  let plain = null;
  try {
    plain = new Uint8Array(new TextEncoder().encode(JSON.stringify(manifest)));
    const envelope = await encryptBytes(dek, plain, migrationManifestAad({
      vaultFormatVersion: 1, userId, companyId, transitionId, manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
    }));
    return repository.createMigrationManifest({
      workspaceTag, expectedRevision: null, transitionId, manifestSchemaVersion: MANIFEST_SCHEMA_VERSION,
      ciphertext: envelope.ciphertext, iv: envelope.iv,
    });
  } finally {
    if (plain) plain.fill(0);
    plain = null;
  }
}

function recordAssociatedData({ userId, companyId, entry }) {
  return recordAad({
    vaultFormatVersion: 1, userId, companyId, logicalStorageKey: entry.key,
    blobIdentifier: entry.blobId, recordSchemaVersion: RECORD_SCHEMA_VERSION,
  });
}

async function verifyRecords({ repository, workspaceTag, dek, userId, companyId, manifest }) {
  const expected = manifest.entries.filter((entry) => entry.present).map((entry) => entry.key).sort();
  const actual = await repository.listEncryptedRecordKeys({ workspaceTag });
  if (expected.length !== actual.length || expected.some((key, index) => key !== actual[index])) return false;
  for (const entry of manifest.entries) {
    if (!entry.present) continue;
    const record = await repository.readEncryptedRecord({ workspaceTag, logicalKey: entry.key });
    if (!record || record.blobId !== entry.blobId || record.recordSchemaVersion !== RECORD_SCHEMA_VERSION) return false;
    let bytes = null;
    try {
      bytes = await decryptBytes(dek, record.ciphertext, record.iv, recordAssociatedData({ userId, companyId, entry }));
      if (bytes.length !== entry.byteLength || await digest(bytes) !== entry.digest) return false;
    } catch {
      return false;
    } finally {
      if (bytes) bytes.fill(0);
      bytes = null;
    }
  }
  return true;
}

async function writeRecords({ repository, storage, workspaceTag, dek, userId, companyId, manifest }) {
  for (const entry of manifest.entries) {
    if (!entry.present) continue;
    const existing = await repository.readEncryptedRecord({ workspaceTag, logicalKey: entry.key });
    if (existing) continue;
    let rawValue = null;
    let plain = null;
    try {
      rawValue = storage.getItem(entry.key);
      if (typeof rawValue !== "string") throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.SOURCE_CHANGED);
      plain = new Uint8Array(new TextEncoder().encode(rawValue));
      if (plain.length !== entry.byteLength || await digest(plain) !== entry.digest) throw new VaultMigrationError(VAULT_MIGRATION_ERROR_CODES.SOURCE_CHANGED);
      const envelope = await encryptBytes(dek, plain, recordAssociatedData({ userId, companyId, entry }));
      await repository.createEncryptedRecord({
        workspaceTag, logicalKey: entry.key, expectedRevision: null, blobId: entry.blobId,
        recordSchemaVersion: RECORD_SCHEMA_VERSION, ciphertext: envelope.ciphertext, iv: envelope.iv,
      });
    } finally {
      if (plain) plain.fill(0);
      plain = null;
      rawValue = null;
    }
  }
}

async function sourceMatches(storage, manifest) {
  for (const entry of manifest.entries) if (!await matchesEntry(storage, entry)) return false;
  return true;
}

async function sourcesAreAbsent(storage, manifest) {
  const absentManifest = Object.freeze({
    ...manifest,
    entries: Object.freeze(manifest.entries.map((entry) => Object.freeze({
      ...entry, present: false, byteLength: null, digest: null, blobId: null,
    }))),
  });
  return sourceMatches(storage, absentManifest);
}

export function createVaultMigrationOrchestrator({
  storage = getActiveAccountScopedStorage(),
  vaultRepository = createVaultIndexedDbRepository(),
  transitionRepository = createVaultTransitionControlRepository({ indexedDB: globalThis.indexedDB, clock: Date.now }),
  deriveTag = deriveWorkspaceVaultTag,
  withActiveDek = runWithActiveVaultDek,
  readGuard = readVaultCompatibilityGuard,
  writeGuard = writeVaultCompatibilityGuard,
  newTransitionId = randomTransitionId,
} = {}) {
  async function run({ userId, companyId } = {}) {
    if (typeof userId !== "string" || typeof companyId !== "string") return fail(VAULT_MIGRATION_ERROR_CODES.INVALID_REQUEST);
    let workspaceTag = null;
    let active = null;
    try {
      workspaceTag = await deriveTag(userId, companyId);
      if (!validWorkspaceTag(workspaceTag)) return fail(VAULT_MIGRATION_ERROR_CODES.INVALID_REQUEST);
      assertFacade(storage);
      const outcome = await withActiveDek({ workspaceTag, operation: async (dek) => {
        try {
          if (!await vaultRepository.workspaceDatabaseExists({ workspaceTag })) return fail(VAULT_MIGRATION_ERROR_CODES.VAULT_LOCKED);

          active = await transitionRepository.readActiveTransition({});
          const guard = readGuard();
          if (!guard || guard.state === "blocked") return fail(VAULT_MIGRATION_ERROR_CODES.GUARD_UNAVAILABLE, safePhase(active?.phase), metadataForPhase(safePhase(active?.phase)));
          if (active && active.workspaceTag !== workspaceTag) return fail(VAULT_MIGRATION_ERROR_CODES.OTHER_WORKSPACE_TRANSITION, safePhase(active.phase), { resumable: true });

          if (!active) {
            if (guard.state === "transition") return fail(VAULT_MIGRATION_ERROR_CODES.GUARD_RECOVERY_REQUIRED);
            if (guard.state === "authoritative") {
              const stored = await vaultRepository.readMigrationManifest({ workspaceTag });
              if (!stored || !validTransitionId(stored.transitionId)) return fail(VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED);
              const manifest = await decodeManifest({ repository: vaultRepository, workspaceTag, transitionId: stored.transitionId, dek, userId, companyId });
              if (!await verifyRecords({ repository: vaultRepository, workspaceTag, dek, userId, companyId, manifest }) || !await sourcesAreAbsent(storage, manifest)) {
                return fail(VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED);
              }
              return completed();
            }
            if (guard.state !== "absent") return fail(VAULT_MIGRATION_ERROR_CODES.GUARD_UNAVAILABLE);
            active = await transitionRepository.createActiveTransition({ transitionId: newTransitionId(), workspaceTag });
          }

          let phase = safePhase(active.phase);
          if (!phase || !validTransitionId(active.transitionId)) return fail(VAULT_MIGRATION_ERROR_CODES.TRANSITION_CONFLICT, "", { resumable: true });

          if (phase === "prepared") {
            if (guard.state === "authoritative") return fail(VAULT_MIGRATION_ERROR_CODES.TRANSITION_CONFLICT, phase, metadataForPhase(phase));
            if (guard.state === "absent" && !writeGuard({ state: "transition", storage })) {
              return fail(VAULT_MIGRATION_ERROR_CODES.GUARD_UNAVAILABLE, phase, metadataForPhase(phase));
            }
            const verifiedGuard = readGuard();
            if (!verifiedGuard || verifiedGuard.state !== "transition") return fail(VAULT_MIGRATION_ERROR_CODES.GUARD_UNAVAILABLE, phase, metadataForPhase(phase));
            active = await transitionRepository.advanceActiveTransition({ transitionId: active.transitionId, workspaceTag, expectedPhase: "prepared", nextPhase: "guarded" });
            phase = "guarded";
          } else if (["guarded", "copying", "verifying"].includes(phase)) {
            if (guard.state !== "transition") return fail(VAULT_MIGRATION_ERROR_CODES.TRANSITION_CONFLICT, phase, metadataForPhase(phase));
          } else if (phase === "cleaning") {
            if (guard.state !== "transition" && guard.state !== "authoritative") return fail(VAULT_MIGRATION_ERROR_CODES.TRANSITION_CONFLICT, phase, metadataForPhase(phase));
          } else if (phase === "authoritative" && guard.state !== "authoritative") {
            return fail(VAULT_MIGRATION_ERROR_CODES.TRANSITION_CONFLICT, phase, metadataForPhase(phase));
          }

        let manifest;
        if (phase === "guarded") {
          const stored = await vaultRepository.readMigrationManifest({ workspaceTag });
          if (stored === null) {
            manifest = await captureManifest(storage, active.transitionId);
            await persistManifest({ repository: vaultRepository, workspaceTag, transitionId: active.transitionId, dek, userId, companyId, manifest });
          } else {
            manifest = await decodeManifest({ repository: vaultRepository, workspaceTag, transitionId: active.transitionId, dek, userId, companyId });
          }
          active = await transitionRepository.advanceActiveTransition({ transitionId: active.transitionId, workspaceTag, expectedPhase: "guarded", nextPhase: "copying" });
          phase = "copying";
        }

        if (!manifest) manifest = await decodeManifest({ repository: vaultRepository, workspaceTag, transitionId: active.transitionId, dek, userId, companyId });
        if (phase === "copying") {
          await writeRecords({ repository: vaultRepository, storage, workspaceTag, dek, userId, companyId, manifest });
          active = await transitionRepository.advanceActiveTransition({ transitionId: active.transitionId, workspaceTag, expectedPhase: "copying", nextPhase: "verifying" });
          phase = "verifying";
        }

        if (phase === "verifying") {
          if (!await verifyRecords({ repository: vaultRepository, workspaceTag, dek, userId, companyId, manifest })) {
            return fail(VAULT_MIGRATION_ERROR_CODES.VERIFICATION_FAILED, phase, metadataForFailure(VAULT_MIGRATION_ERROR_CODES.VERIFICATION_FAILED, phase));
          }
          if (!await sourceMatches(storage, manifest)) return fail(VAULT_MIGRATION_ERROR_CODES.SOURCE_CHANGED, phase, { resumable: true });
          // `cleaning` is the durable vault-authority point. Nothing may start
          // cleanup until this CAS transition has committed.
          active = await transitionRepository.advanceActiveTransition({ transitionId: active.transitionId, workspaceTag, expectedPhase: "verifying", nextPhase: "cleaning" });
          phase = "cleaning";
        }

        if (phase === "cleaning") {
          if (!writeGuard({ state: "authoritative", storage }) || readGuard()?.state !== "authoritative") {
            return fail(VAULT_MIGRATION_ERROR_CODES.GUARD_UNAVAILABLE, phase, { resumable: true, authoritative: true, cleanupPending: true });
          }
          for (const entry of manifest.entries) {
            if (!storage.removeVaultMigrationItem(entry.key)) {
              return fail(VAULT_MIGRATION_ERROR_CODES.CLEANUP_PENDING, phase, { resumable: true, authoritative: true, cleanupPending: true });
            }
          }
          if (!await sourceMatches(storage, Object.freeze({ ...manifest, entries: Object.freeze(manifest.entries.map((entry) => Object.freeze({ ...entry, present: false, byteLength: null, digest: null, blobId: null }))) }))) {
            return fail(VAULT_MIGRATION_ERROR_CODES.CLEANUP_PENDING, phase, { resumable: true, authoritative: true, cleanupPending: true });
          }
          active = await transitionRepository.advanceActiveTransition({ transitionId: active.transitionId, workspaceTag, expectedPhase: "cleaning", nextPhase: "authoritative" });
          phase = "authoritative";
        }

        if (phase === "authoritative") {
          if (!writeGuard({ state: "authoritative", storage })) return fail(VAULT_MIGRATION_ERROR_CODES.CLEANUP_PENDING, phase, { resumable: true, authoritative: true, cleanupPending: true });
          await transitionRepository.deleteActiveTransition({ transitionId: active.transitionId, workspaceTag, expectedPhase: "authoritative" });
          return completed();
        }
        return transitionResult(phase);
        } catch (error) {
          const phase = safePhase(active?.phase);
          if (error instanceof VaultMigrationError) return fail(error.code, phase, metadataForFailure(error.code, phase));
          return fail(VAULT_MIGRATION_ERROR_CODES.STORAGE_OPERATION_FAILED, phase, metadataForPhase(phase));
        }
      } });
      return outcome || fail(VAULT_MIGRATION_ERROR_CODES.VAULT_LOCKED);
    } catch (error) {
      const phase = safePhase(active?.phase);
      if (error instanceof VaultMigrationError) return fail(error.code, phase, metadataForPhase(phase));
      return fail(VAULT_MIGRATION_ERROR_CODES.STORAGE_OPERATION_FAILED, phase, metadataForPhase(phase));
    }
  }
  return Object.freeze({ run });
}

export async function migrateActiveWorkspaceVault(input) {
  return createVaultMigrationOrchestrator().run(input);
}
