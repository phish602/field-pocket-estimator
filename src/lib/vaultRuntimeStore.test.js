/**
 * ISO-16 -- authoritative runtime hydration, synchronous cache, durability
 * queue, and revocation, exercised end to end against a real IndexedDB with a
 * real unlocked vault session.
 */
import { IDBFactory } from "fake-indexeddb";
import {
  VAULT_RUNTIME_ERROR_CODES,
  beginVaultRuntimeActivation,
  freezeVaultRuntimeMutations,
  hasVaultRuntimeSession,
  isVaultRuntimeFrozen,
  subscribeVaultRuntimeRevalidation,
  unfreezeVaultRuntimeMutations,
  describeVaultRuntime,
  flushVaultRuntime,
  getVaultRuntimeStatus,
  hydrateVaultRuntime,
  isVaultRuntimeReady,
  revokeVaultRuntime,
  runtimeClear,
  runtimeGetItem,
  runtimeLogicalKeys,
  runtimeRemoveItem,
  runtimeSetItem,
  sealVaultRuntime,
} from "./vaultRuntimeStore";
import { createVaultIndexedDbRepository } from "./vaultIndexedDbRepository";
import { lockVault, setupVault, deriveWorkspaceVaultTag, runWithActiveVaultDek } from "./vaultSession";
import { encryptBytes, migrationManifestAad, recordAad, setTestArgon2Adapter } from "./vaultCrypto";
import { VAULT_MIGRATION_LOGICAL_KEYS } from "./vaultIndexedDbRepository";
import { buildRuntimeCatalog, digestBytes, encryptRuntimeCatalog, randomBlobId, utf8Bytes } from "./vaultRuntimeCatalog";

const USER = "11111111-2222-4333-8444-555555555555";
const COMPANY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PASSWORD = "synthetic-runtime-test-password";
const originalStructuredClone = globalThis.structuredClone;
let restoreArgon;

beforeAll(() => {
  if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto;
  globalThis.structuredClone = (value) => {
    if (value instanceof Uint8Array) return value.slice();
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (Array.isArray(value)) return value.map((entry) => globalThis.structuredClone(entry));
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      const copy = {};
      Object.keys(value).forEach((key) => { copy[key] = globalThis.structuredClone(value[key]); });
      return copy;
    }
    return value;
  };
  // A deterministic, fast KDF stand-in. Real AES-GCM, real Web Crypto, real
  // IndexedDB are all still exercised; only the Argon2 cost is reduced.
  restoreArgon = setTestArgon2Adapter(async ({ password, salt }) => {
    const material = new Uint8Array(password.length + salt.length);
    material.set(password, 0);
    material.set(salt, password.length);
    return new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", material));
  });
});

afterAll(() => {
  if (restoreArgon) restoreArgon();
  if (originalStructuredClone === undefined) delete globalThis.structuredClone;
  else globalThis.structuredClone = originalStructuredClone;
});

let repository;

async function openWorkspace() {
  globalThis.indexedDB = new IDBFactory();
  repository = createVaultIndexedDbRepository({ indexedDB: globalThis.indexedDB, clock: Date.now });
  const capability = await setupVault({ userId: USER, companyId: COMPANY, password: PASSWORD });
  expect(capability.state).toBe("unlocked");
  return repository;
}

// Writes an encrypted record exactly as the migration orchestrator would, so the
// seal path can be exercised from a genuine post-migration record set.
const migrated = new Map();

async function writeMigratedRecord(logicalKey, value) {
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  await runWithActiveVaultDek({ workspaceTag, operation: async (dek) => {
    const plain = utf8Bytes(value);
    const blobId = randomBlobId();
    const envelope = await encryptBytes(dek, plain, recordAad({
      vaultFormatVersion: 1, userId: USER, companyId: COMPANY,
      logicalStorageKey: logicalKey, blobIdentifier: blobId, recordSchemaVersion: 1,
    }));
    await repository.createEncryptedRecord({
      workspaceTag, logicalKey, expectedRevision: null, blobId,
      recordSchemaVersion: 1, ciphertext: envelope.ciphertext, iv: envelope.iv,
    });
    migrated.set(logicalKey, { value, blobId, byteLength: plain.length, digest: await digestBytes(plain) });
    return true;
  } });
}

// The plaintext sources a completed migration has already removed.
const ABSENT_SOURCES = Object.freeze({ getItem: () => null, removeVaultMigrationItem: () => true });
const AUTHORITATIVE_GUARD = () => ({ state: "authoritative" });
const TRANSITION_ID = "123e4567-e89b-42d3-a456-426614174000";

// Writes the frozen, authenticated migration manifest the orchestrator would
// have written for exactly the records seeded above. Sealing consumes THIS, not
// a raw enumeration of the record store.
async function writeMigrationManifest({ transitionId = TRANSITION_ID, mutate = null } = {}) {
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  await runWithActiveVaultDek({ workspaceTag, operation: async (dek) => {
    const entries = VAULT_MIGRATION_LOGICAL_KEYS.map((key) => (migrated.has(key)
      ? { key, present: true, byteLength: migrated.get(key).byteLength, digest: migrated.get(key).digest, blobId: migrated.get(key).blobId }
      : { key, present: false, byteLength: null, digest: null, blobId: null }));
    const manifest = { version: 1, transitionId, entries };
    if (typeof mutate === "function") mutate(manifest);
    const plain = utf8Bytes(JSON.stringify(manifest));
    const envelope = await encryptBytes(dek, plain, migrationManifestAad({
      vaultFormatVersion: 1, userId: USER, companyId: COMPANY, transitionId, manifestSchemaVersion: 1,
    }));
    await repository.createMigrationManifest({
      workspaceTag, expectedRevision: null, transitionId, manifestSchemaVersion: 1,
      ciphertext: envelope.ciphertext, iv: envelope.iv,
    });
    return true;
  } });
}

// Seal from a genuine completed migration: manifest present, guard
// authoritative, plaintext sources gone.
async function sealMigratedWorkspace(options = {}) {
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  if (!await repository.readMigrationManifest({ workspaceTag })) await writeMigrationManifest();
  return sealVaultRuntime({
    userId: USER, companyId: COMPANY, repository,
    storage: ABSENT_SOURCES, readGuard: AUTHORITATIVE_GUARD,
    ...options,
  });
}

beforeEach(async () => {
  revokeVaultRuntime();
  lockVault();
  migrated.clear();
  await openWorkspace();
});

afterEach(() => {
  revokeVaultRuntime();
  lockVault();
});

test("sealing a migrated record set creates the first catalog without touching the manifest", async () => {
  await writeMigratedRecord("estipaid-customers-v1", '{"note":"synthetic"}');
  await writeMigratedRecord("estipaid-settings-v1", "");
  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: true, state: "sealed", entryCount: 2 });

  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  const catalog = await repository.readRuntimeCatalog({ workspaceTag });
  expect(catalog.revision).toBe(1);
  expect(catalog.runtimeGeneration).toBe(1);
  // The frozen manifest is read, never rewritten: same transition, same revision.
  const manifest = await repository.readMigrationManifest({ workspaceTag });
  expect(manifest.transitionId).toBe(TRANSITION_ID);
  expect(manifest.revision).toBe(1);
});

test("sealing twice is idempotent", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await sealMigratedWorkspace();
  const again = await sealMigratedWorkspace();
  expect(again).toMatchObject({ ok: true, state: "already-sealed" });
});

test("hydration verifies every record and publishes a synchronous cache", async () => {
  await writeMigratedRecord("estipaid-customers-v1", '{"note":"synthetic"}');
  await writeMigratedRecord("estipaid-settings-v1", "");
  await sealMigratedWorkspace();

  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated).toMatchObject({ ok: true, state: "ready", entryCount: 2 });
  expect(runtimeGetItem("estipaid-customers-v1")).toBe('{"note":"synthetic"}');
  // Present-empty survives as an empty string, distinct from an absent key.
  expect(runtimeGetItem("estipaid-settings-v1")).toBe("");
  expect(runtimeGetItem("estipaid-projects-v1")).toBeNull();
  expect(runtimeLogicalKeys().sort()).toEqual(["estipaid-customers-v1", "estipaid-settings-v1"]);
});

test("hydration without a catalog fails closed", async () => {
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.CATALOG_ABSENT });
  expect(isVaultRuntimeReady()).toBe(false);
});

test("hydration with a locked vault fails closed and publishes nothing", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await sealMigratedWorkspace();
  lockVault();
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.VAULT_LOCKED });
  expect(runtimeGetItem("estipaid-customers-v1")).toBeNull();
});

test("an unexpected encrypted record blocks hydration", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await sealMigratedWorkspace();
  await writeMigratedRecord("estipaid-projects-v1", "surprise");
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated.ok).toBe(false);
  expect([VAULT_RUNTIME_ERROR_CODES.RECORD_UNEXPECTED, VAULT_RUNTIME_ERROR_CODES.RECORD_MISSING]).toContain(hydrated.code);
});

test("a missing encrypted record blocks hydration", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await writeMigratedRecord("estipaid-projects-v1", "y");
  await sealMigratedWorkspace();
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  const record = await repository.readEncryptedRecord({ workspaceTag, logicalKey: "estipaid-projects-v1" });
  await repository.deleteEncryptedRecord({ workspaceTag, logicalKey: "estipaid-projects-v1", expectedRevision: record.revision });
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated.ok).toBe(false);
  expect(hydrated.code).toBe(VAULT_RUNTIME_ERROR_CODES.RECORD_MISSING);
});

test("set, replace, and remove are durable and survive a fresh hydration", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  expect(runtimeSetItem("estipaid-customers-v1", "replaced")).toBe(true);
  expect(runtimeSetItem("estipaid-projects-v1", '{"note":"new"}')).toBe(true);
  // Read-after-write is immediate, exactly like localStorage.
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("replaced");
  expect(runtimeGetItem("estipaid-projects-v1")).toBe('{"note":"new"}');

  const status = await flushVaultRuntime();
  expect(status.state).toBe("ready");

  revokeVaultRuntime();
  const rehydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(rehydrated).toMatchObject({ ok: true, entryCount: 2 });
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("replaced");
  expect(runtimeGetItem("estipaid-projects-v1")).toBe('{"note":"new"}');

  expect(runtimeRemoveItem("estipaid-projects-v1")).toBe(true);
  expect(runtimeGetItem("estipaid-projects-v1")).toBeNull();
  await flushVaultRuntime();
  revokeVaultRuntime();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(runtimeGetItem("estipaid-projects-v1")).toBeNull();
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("replaced");
});

test("exact UTF-8 bytes survive a durable round trip", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "seed");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  const values = {
    "estipaid-customers-v1": "acentuación · Кириллица · 日本語",
    "estipaid-projects-v1": "é à ñ ô ü Å ç",
    "estipaid-invoices-v1": "🧰🚧🏗️👷🏽‍♀️ 𠜎𠜱𠝹 🇪🇸",
    "estipaid-estimates-v1": JSON.stringify({ body: "x".repeat(32 * 1024) }),
    "estipaid-settings-v1": "",
  };
  Object.entries(values).forEach(([key, value]) => expect(runtimeSetItem(key, value)).toBe(true));
  await flushVaultRuntime();
  revokeVaultRuntime();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  Object.entries(values).forEach(([key, value]) => {
    expect(runtimeGetItem(key)).toBe(value);
    expect(utf8Bytes(runtimeGetItem(key)).length).toBe(utf8Bytes(value).length);
  });
});

test("rapid repeated writes and set/remove/set ordering are applied in order", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "seed");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  for (let index = 0; index < 12; index += 1) runtimeSetItem("estipaid-customers-v1", `value-${index}`);
  runtimeRemoveItem("estipaid-customers-v1");
  runtimeSetItem("estipaid-customers-v1", "final");
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("final");
  const status = await flushVaultRuntime();
  expect(status.state).toBe("ready");

  revokeVaultRuntime();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("final");
});

test("clear removes every approved record and leaves the catalog empty", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await writeMigratedRecord("estipaid-projects-v1", "b");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  expect(runtimeClear()).toBe(true);
  expect(runtimeLogicalKeys()).toEqual([]);
  await flushVaultRuntime();

  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  expect(await repository.listEncryptedRecordKeys({ workspaceTag })).toEqual([]);
  // Vault metadata survives a clear.
  expect(await repository.readWorkspaceVaultMetadata({ workspaceTag })).not.toBeNull();
  revokeVaultRuntime();
  const rehydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(rehydrated).toMatchObject({ ok: true, entryCount: 0 });
});

test("an unapproved key is refused for read and write and never persists", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  expect(runtimeSetItem("estipaid-brand-new-key-v1", "value")).toBe(false);
  expect(runtimeGetItem("estipaid-brand-new-key-v1")).toBeNull();
  expect(runtimeRemoveItem("estipaid-brand-new-key-v1")).toBe(false);
  await flushVaultRuntime();
  expect(runtimeLogicalKeys()).toEqual(["estipaid-customers-v1"]);
});

test("a durability failure blocks the runtime and refuses further mutations", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  const failing = {
    ...repository,
    commitRuntimeRecordSet: async () => { const error = new Error("boom"); error.code = "STORAGE_OPERATION_FAILED"; throw error; },
  };
  revokeVaultRuntime();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: failing });

  expect(runtimeSetItem("estipaid-customers-v1", "doomed")).toBe(true);
  const status = await flushVaultRuntime();
  expect(status.state).toBe("blocked");
  expect(status.code).toBe(VAULT_RUNTIME_ERROR_CODES.DURABILITY_FAILED);
  // Once blocked, no further business mutation is accepted.
  expect(runtimeSetItem("estipaid-customers-v1", "again")).toBe(false);
  expect(runtimeRemoveItem("estipaid-customers-v1")).toBe(false);
  expect(runtimeClear()).toBe(false);
  expect(isVaultRuntimeReady()).toBe(false);

  // The last durable state is intact: the failed write never reached the vault.
  revokeVaultRuntime();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("a");
});

test("a revision conflict blocks rather than falling back to last-write-wins", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  const conflicting = {
    ...repository,
    commitRuntimeRecordSet: async () => { const error = new Error("conflict"); error.code = "CONFLICT"; throw error; },
  };
  revokeVaultRuntime();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: conflicting });
  runtimeSetItem("estipaid-customers-v1", "stale");
  const status = await flushVaultRuntime();
  expect(status.state).toBe("blocked");
  expect(status.code).toBe(VAULT_RUNTIME_ERROR_CODES.CONFLICT);
});

test("revocation clears the cache synchronously and discards queued work", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  runtimeSetItem("estipaid-customers-v1", "pending");
  revokeVaultRuntime();
  // Synchronously inaccessible -- no await, no tick.
  expect(runtimeGetItem("estipaid-customers-v1")).toBeNull();
  expect(runtimeLogicalKeys()).toEqual([]);
  expect(isVaultRuntimeReady()).toBe(false);
  expect(describeVaultRuntime()).toEqual({ active: false });
  expect(runtimeSetItem("estipaid-customers-v1", "after")).toBe(false);
});

test("the public status never exposes identity or crypto material", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "synthetic-secret");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  const serialized = JSON.stringify({ status: getVaultRuntimeStatus(), described: describeVaultRuntime() });
  expect(serialized).not.toContain(USER);
  expect(serialized).not.toContain(COMPANY);
  expect(serialized).not.toContain(PASSWORD);
  expect(serialized).not.toContain("synthetic-secret");
  expect(serialized).not.toMatch(/[A-Za-z0-9_-]{43}/);
  expect(Object.keys(getVaultRuntimeStatus()).sort()).toEqual(["code", "entryCount", "generation", "pending", "state"]);
});

test("hydration recomputes digests, so a tampered record cannot hydrate", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await sealMigratedWorkspace();
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);

  // Re-encrypt DIFFERENT content correctly under the same key and blob identity.
  await runWithActiveVaultDek({ workspaceTag, operation: async (dek) => {
    const record = await repository.readEncryptedRecord({ workspaceTag, logicalKey: "estipaid-customers-v1" });
    const plain = utf8Bytes("tampered");
    const envelope = await encryptBytes(dek, plain, recordAad({
      vaultFormatVersion: 1, userId: USER, companyId: COMPANY,
      logicalStorageKey: "estipaid-customers-v1", blobIdentifier: record.blobId, recordSchemaVersion: 1,
    }));
    const database = await new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(`estipaid-vault-v1-${workspaceTag}`);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise((resolve) => {
      const transaction = database.transaction("records", "readwrite");
      const store = transaction.objectStore("records");
      const get = store.get("estipaid-customers-v1");
      get.onsuccess = () => { store.put({ ...get.result, ciphertext: envelope.ciphertext, iv: envelope.iv }); };
      transaction.oncomplete = resolve;
    });
    database.close();
    return true;
  } });

  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.RECORD_INVALID });
  expect(runtimeGetItem("estipaid-customers-v1")).toBeNull();
  const digest = await digestBytes(utf8Bytes("original"));
  expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- the seal consumes VERIFIED completed-migration authority.
//
// Before this fix the first catalog was built by enumerating whatever encrypted
// records happened to be in IndexedDB. A record injected before the first seal
// therefore became authoritative content. The seal now adopts only what the
// frozen, authenticated migration manifest proves, with the compatibility guard
// authoritative and the plaintext sources gone.
// ---------------------------------------------------------------------------

test("sealing without a migration manifest fails closed and creates no catalog", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  const sealed = await sealVaultRuntime({
    userId: USER, companyId: COMPANY, repository,
    storage: ABSENT_SOURCES, readGuard: AUTHORITATIVE_GUARD,
  });
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  expect(await repository.readRuntimeCatalog({ workspaceTag })).toBeNull();
});

test("sealing with an absent guard fails closed", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await writeMigrationManifest();
  const sealed = await sealMigratedWorkspace({ readGuard: () => ({ state: "absent" }) });
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("sealing with a mid-transition guard fails closed", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await writeMigrationManifest();
  const sealed = await sealMigratedWorkspace({ readGuard: () => ({ state: "transition" }) });
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("sealing with a blocked guard fails closed", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await writeMigrationManifest();
  const sealed = await sealMigratedWorkspace({ readGuard: () => ({ state: "blocked", code: "INVALID_GUARD" }) });
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("sealing when the guard cannot be read at all fails closed", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await writeMigrationManifest();
  const sealed = await sealMigratedWorkspace({ readGuard: () => { throw new Error("no storage"); } });
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("an encrypted record injected before the seal is never adopted as authority", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "genuine");
  await writeMigrationManifest();
  // The manifest is frozen; this record is not in it.
  migrated.delete("estipaid-projects-v1");
  await writeMigratedRecord("estipaid-projects-v1", "injected");

  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  expect(await repository.readRuntimeCatalog({ workspaceTag })).toBeNull();
  // And nothing was published to the synchronous cache.
  expect(runtimeGetItem("estipaid-projects-v1")).toBeNull();
  expect(isVaultRuntimeReady()).toBe(false);
});

test("a record the manifest names but that is missing blocks the seal", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await writeMigratedRecord("estipaid-projects-v1", "b");
  await writeMigrationManifest();
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  const record = await repository.readEncryptedRecord({ workspaceTag, logicalKey: "estipaid-projects-v1" });
  await repository.deleteEncryptedRecord({ workspaceTag, logicalKey: "estipaid-projects-v1", expectedRevision: record.revision });

  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("a manifest naming a different blob identity blocks the seal", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await writeMigrationManifest({ mutate: (manifest) => {
    const entry = manifest.entries.find((candidate) => candidate.key === "estipaid-customers-v1");
    entry.blobId = randomBlobId();
  } });
  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("a manifest whose digest does not match the record blocks the seal", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await writeMigrationManifest({ mutate: (manifest) => {
    const entry = manifest.entries.find((candidate) => candidate.key === "estipaid-customers-v1");
    entry.digest = "A".repeat(43);
  } });
  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("a manifest whose byte length does not match the record blocks the seal", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "abc");
  await writeMigrationManifest({ mutate: (manifest) => {
    const entry = manifest.entries.find((candidate) => candidate.key === "estipaid-customers-v1");
    entry.byteLength = 99;
  } });
  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("a manifest missing an approved key entirely blocks the seal", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await writeMigrationManifest({ mutate: (manifest) => { manifest.entries.pop(); } });
  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("a manifest carrying an unapproved key blocks the seal", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await writeMigrationManifest({ mutate: (manifest) => {
    manifest.entries[manifest.entries.length - 1] = {
      key: "estipaid-not-approved-v1", present: false, byteLength: null, digest: null, blobId: null,
    };
  } });
  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("a plaintext source that still exists blocks the seal", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await writeMigrationManifest();
  const sealed = await sealMigratedWorkspace({
    storage: { getItem: (key) => (key === "estipaid-customers-v1" ? "a" : null), removeVaultMigrationItem: () => true },
  });
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("an unusable storage facade blocks the seal", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await writeMigrationManifest();
  const sealed = await sealMigratedWorkspace({ storage: { getItem: () => null } });
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.MIGRATION_UNVERIFIED });
});

test("sealing with a locked vault fails closed as locked, not unverified", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await writeMigrationManifest();
  lockVault();
  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.VAULT_LOCKED });
});

test("the sealed catalog contains exactly the manifest's present entries", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await writeMigratedRecord("estipaid-settings-v1", "");
  await writeMigratedRecord("estipaid-projects-v1", "c");
  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: true, entryCount: 3 });

  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(runtimeLogicalKeys().sort()).toEqual(["estipaid-customers-v1", "estipaid-projects-v1", "estipaid-settings-v1"]);
});

test("a workspace whose migration moved nothing seals to an empty catalog", async () => {
  const sealed = await sealMigratedWorkspace();
  expect(sealed).toMatchObject({ ok: true, entryCount: 0 });
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated).toMatchObject({ ok: true, entryCount: 0 });
});

test("a blocked seal leaves hydration failing closed with no catalog", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  const sealed = await sealVaultRuntime({
    userId: USER, companyId: COMPANY, repository,
    storage: ABSENT_SOURCES, readGuard: AUTHORITATIVE_GUARD,
  });
  expect(sealed.ok).toBe(false);
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.CATALOG_ABSENT });
});

test("the first catalog is persisted at revision 1 and advances one revision per commit", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(describeVaultRuntime().catalogRevision).toBe(1);

  runtimeSetItem("estipaid-customers-v1", "b");
  await flushVaultRuntime();
  expect(describeVaultRuntime().catalogRevision).toBe(2);

  runtimeRemoveItem("estipaid-customers-v1");
  await flushVaultRuntime();
  expect(describeVaultRuntime().catalogRevision).toBe(3);

  // The persisted wrapper agrees, and the runtime rehydrates from it.
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  expect((await repository.readRuntimeCatalog({ workspaceTag })).revision).toBe(3);
  revokeVaultRuntime();
  const rehydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(rehydrated.ok).toBe(true);
  expect(describeVaultRuntime().catalogRevision).toBe(3);
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- cross-tab channel lifecycle and message validation.
//
// The channel belongs to the SUBSCRIPTION. Revoking the runtime cache (which
// every hydration does) must not close it, or a tab stops hearing other tabs
// after its first rehydration. Incoming messages are attacker-influenced input
// from any page on this origin and are accepted only as an exact shape; they
// can do nothing except ask this tab to re-read and re-verify.
// ---------------------------------------------------------------------------

const channels = new Set();

class FakeBroadcastChannel {
  constructor(name) {
    this.name = name;
    this.onmessage = null;
    this.closed = false;
    channels.add(this);
  }

  postMessage(data) {
    if (this.closed) throw new Error("closed channel");
    channels.forEach((peer) => {
      if (peer === this || peer.closed || peer.name !== this.name) return;
      if (typeof peer.onmessage === "function") peer.onmessage({ data });
    });
  }

  close() {
    this.closed = true;
    channels.delete(this);
  }
}

function openChannels() {
  return [...channels].filter((entry) => !entry.closed);
}

async function readyRuntime() {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await sealMigratedWorkspace();
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated.ok).toBe(true);
  return describeVaultRuntime();
}

function remoteMessage(overrides = {}) {
  const described = describeVaultRuntime();
  return {
    type: "runtime-committed",
    workspaceTag: TAG_FOR_TEST,
    runtimeGeneration: described.runtimeGeneration,
    catalogRevision: described.catalogRevision + 1,
    ...overrides,
  };
}

let TAG_FOR_TEST = "";

describe("cross-tab revalidation transport", () => {
  let unsubscribe = null;
  let remote = null;
  let signals = 0;

  beforeEach(async () => {
    globalThis.BroadcastChannel = FakeBroadcastChannel;
    channels.clear();
    signals = 0;
    TAG_FOR_TEST = await deriveWorkspaceVaultTag(USER, COMPANY);
    await readyRuntime();
    unsubscribe = subscribeVaultRuntimeRevalidation(() => { signals += 1; });
    remote = new FakeBroadcastChannel("estipaid-vault-runtime-v1");
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    channels.forEach((entry) => entry.close());
    channels.clear();
    delete globalThis.BroadcastChannel;
  });

  test("a newer remote catalog revision revalidates", () => {
    remote.postMessage(remoteMessage());
    expect(signals).toBe(1);
  });

  test("the second and third remote commits still revalidate", async () => {
    remote.postMessage(remoteMessage());
    // Each rehydration revokes the cache first; the channel must survive it.
    await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
    remote.postMessage(remoteMessage());
    await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
    remote.postMessage(remoteMessage());
    expect(signals).toBe(3);
  });

  test("revoking the runtime cache does not close the channel", async () => {
    const before = openChannels().length;
    revokeVaultRuntime();
    expect(openChannels().length).toBe(before);
    // With no active runtime there is nothing to revalidate, but the transport
    // is still alive: a fresh hydration starts hearing remote commits again.
    remote.postMessage(remoteMessage());
    expect(signals).toBe(0);
    await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
    remote.postMessage(remoteMessage());
    expect(signals).toBe(1);
  });

  test("only one runtime channel is ever open", async () => {
    await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
    remote.postMessage(remoteMessage());
    const runtimeChannels = openChannels().filter((entry) => entry !== remote);
    expect(runtimeChannels).toHaveLength(1);
  });

  test("unsubscribing closes the channel and stops delivery", () => {
    unsubscribe();
    unsubscribe = null;
    const runtimeChannels = openChannels().filter((entry) => entry !== remote);
    expect(runtimeChannels).toHaveLength(0);
    remote.postMessage(remoteMessage());
    expect(signals).toBe(0);
  });

  test("resubscribing after cleanup opens exactly one new channel", () => {
    unsubscribe();
    unsubscribe = subscribeVaultRuntimeRevalidation(() => { signals += 1; });
    const runtimeChannels = openChannels().filter((entry) => entry !== remote);
    expect(runtimeChannels).toHaveLength(1);
    remote.postMessage(remoteMessage());
    expect(signals).toBe(1);
  });

  test("a message for another workspace is ignored", () => {
    remote.postMessage(remoteMessage({ workspaceTag: "B".repeat(43) }));
    expect(signals).toBe(0);
  });

  test("a stale or equal catalog revision is ignored", () => {
    const described = describeVaultRuntime();
    remote.postMessage(remoteMessage({ catalogRevision: described.catalogRevision }));
    remote.postMessage(remoteMessage({ catalogRevision: described.catalogRevision - 1 || 1 }));
    expect(signals).toBe(0);
  });

  test("a mismatched runtime generation is ignored", () => {
    remote.postMessage(remoteMessage({ runtimeGeneration: 99 }));
    expect(signals).toBe(0);
  });

  test("malformed messages never trigger revalidation", () => {
    const described = describeVaultRuntime();
    const malformed = [
      null,
      undefined,
      "runtime-committed",
      42,
      [],
      { ...remoteMessage(), extra: true },                                  // extra property
      { type: "runtime-committed", workspaceTag: TAG_FOR_TEST },            // missing fields
      { ...remoteMessage(), type: "something-else" },
      { ...remoteMessage(), workspaceTag: "short" },
      { ...remoteMessage(), runtimeGeneration: 0 },
      { ...remoteMessage(), runtimeGeneration: 1.5 },
      { ...remoteMessage(), catalogRevision: "2" },
      { ...remoteMessage(), catalogRevision: Number.POSITIVE_INFINITY },
    ];
    malformed.forEach((message) => remote.postMessage(message));

    // An accessor-bearing object: reading it must not be treated as a value.
    const accessor = { type: "runtime-committed", workspaceTag: TAG_FOR_TEST, runtimeGeneration: described.runtimeGeneration };
    Object.defineProperty(accessor, "catalogRevision", { get: () => described.catalogRevision + 1, enumerable: true });
    Object.defineProperty(accessor, Symbol("hidden"), { value: 1 });
    remote.postMessage(accessor);

    // A class instance is not a plain object.
    class Message {}
    const instance = Object.assign(new Message(), remoteMessage());
    remote.postMessage(instance);

    expect(signals).toBe(0);
  });

  test("a valid message never mutates the cache by itself", () => {
    remote.postMessage(remoteMessage());
    expect(runtimeGetItem("estipaid-customers-v1")).toBe("a");
    expect(signals).toBe(1);
  });

  test("the published message carries no identity or crypto material", () => {
    let captured = null;
    remote.onmessage = (event) => { captured = event.data; };
    runtimeSetItem("estipaid-customers-v1", "b");
    return flushVaultRuntime().then(() => {
      expect(captured).not.toBeNull();
      expect(Object.keys(captured).sort()).toEqual(["catalogRevision", "runtimeGeneration", "type", "workspaceTag"]);
      const serialized = JSON.stringify(captured);
      expect(serialized).not.toContain(USER);
      expect(serialized).not.toContain(COMPANY);
      expect(serialized).not.toContain(PASSWORD);
      expect(serialized).not.toContain("estipaid-customers-v1");
    });
  });
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- focus/visibility fallback.
//
// Where BroadcastChannel is unavailable, focus and visibility are the only
// freshness signals. A visibilitychange that HIDES the tab is not one of them.
// ---------------------------------------------------------------------------

describe("focus and visibility fallback", () => {
  let unsubscribe = null;
  let signals = 0;
  let visibility = "visible";

  beforeEach(async () => {
    delete globalThis.BroadcastChannel;
    signals = 0;
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    await readyRuntime();
    unsubscribe = subscribeVaultRuntimeRevalidation(() => { signals += 1; });
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    delete document.visibilityState;
  });

  test("a hidden visibilitychange does nothing", () => {
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(signals).toBe(0);
  });

  test("a visible visibilitychange revalidates", () => {
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(signals).toBe(1);
  });

  test("regaining focus revalidates", () => {
    window.dispatchEvent(new Event("focus"));
    expect(signals).toBe(1);
  });

  test("cleanup removes the fallback listeners", () => {
    unsubscribe();
    unsubscribe = null;
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(signals).toBe(0);
  });

  test("the fallback is not installed when BroadcastChannel exists", () => {
    unsubscribe();
    globalThis.BroadcastChannel = FakeBroadcastChannel;
    unsubscribe = subscribeVaultRuntimeRevalidation(() => { signals += 1; });
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(signals).toBe(0);
    channels.forEach((entry) => entry.close());
    channels.clear();
    delete globalThis.BroadcastChannel;
  });
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- ATOMIC hydration.
//
// Hydration used to revoke the active runtime before it had verified anything,
// leaving a window in which the hook could still report ready while the cache
// was already gone: reads looked empty and writes were refused for no visible
// reason. The previous verified runtime now stays active for the whole of
// verification and is replaced in one step, only after the entire candidate
// verifies.
// ---------------------------------------------------------------------------

// A repository whose record reads can be paused mid-hydration.
function gatedRepository(base, { pauseOnKey }) {
  let release = null;
  const paused = new Promise((resolve) => { release = resolve; });
  let armed = true;
  return {
    repository: {
      ...base,
      readEncryptedRecord: async (options) => {
        if (armed && options.logicalKey === pauseOnKey) {
          armed = false;
          await paused;
        }
        return base.readEncryptedRecord(options);
      },
    },
    release: () => release(),
  };
}

test("the previous runtime stays readable and ready throughout verification", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await writeMigratedRecord("estipaid-projects-v1", "second");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  const firstGeneration = describeVaultRuntime().generation;

  const gated = gatedRepository(repository, { pauseOnKey: "estipaid-projects-v1" });
  const hydrating = hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: gated.repository });
  await Promise.resolve();

  // Mid-verification: the last verified cache is still serving, still ready, and
  // still on the same generation.
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("original");
  expect(runtimeGetItem("estipaid-projects-v1")).toBe("second");
  expect(isVaultRuntimeReady()).toBe(true);
  expect(describeVaultRuntime().generation).toBe(firstGeneration);

  gated.release();
  const hydrated = await hydrating;
  expect(hydrated.ok).toBe(true);
  // Replacement is a single step onto a NEW generation.
  expect(describeVaultRuntime().generation).toBe(firstGeneration + 1);
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("original");
});

test("a candidate that fails verification never partially replaces the runtime", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  const generation = describeVaultRuntime().generation;

  const failing = {
    ...repository,
    readEncryptedRecord: async () => null,                                   // record vanished
  };
  const observed = [];
  const hydrating = hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: failing });
  observed.push(runtimeGetItem("estipaid-customers-v1"));
  const hydrated = await hydrating;

  expect(hydrated.ok).toBe(false);
  expect(hydrated.code).toBe(VAULT_RUNTIME_ERROR_CODES.RECORD_MISSING);
  // During verification the old value was still served ...
  expect(observed).toEqual(["original"]);
  // ... and after a failed candidate the runtime is fail-closed, not partial.
  expect(isVaultRuntimeReady()).toBe(false);
  expect(runtimeGetItem("estipaid-customers-v1")).toBeNull();
  expect(describeVaultRuntime()).toEqual({ active: false });
  expect(generation).toBeGreaterThan(0);
});

// Commits a record + catalog exactly as ANOTHER TAB's runtime would, without
// touching this tab's in-memory cache. That is the only way to produce the real
// cross-tab situation: durable state ahead of the live cache.
async function commitBehindTheRuntime(logicalKey, value) {
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  await runWithActiveVaultDek({ workspaceTag, operation: async (dek) => {
    const storedCatalog = await repository.readRuntimeCatalog({ workspaceTag });
    const existing = await repository.readEncryptedRecord({ workspaceTag, logicalKey });
    const plain = utf8Bytes(value);
    const blobId = randomBlobId();
    const envelope = await encryptBytes(dek, plain, recordAad({
      vaultFormatVersion: 1, userId: USER, companyId: COMPANY,
      logicalStorageKey: logicalKey, blobIdentifier: blobId, recordSchemaVersion: 1,
    }));
    const keys = await repository.listEncryptedRecordKeys({ workspaceTag });
    const entries = [];
    for (const key of keys) {
      if (key === logicalKey) continue;
      const record = await repository.readEncryptedRecord({ workspaceTag, logicalKey: key });
      const bytes = await decryptBytes(dek, record.ciphertext, record.iv, recordAad({
        vaultFormatVersion: 1, userId: USER, companyId: COMPANY,
        logicalStorageKey: key, blobIdentifier: record.blobId, recordSchemaVersion: 1,
      }));
      entries.push({ key, blobId: record.blobId, byteLength: bytes.length, digest: await digestBytes(bytes), revision: record.revision });
      bytes.fill(0);
    }
    entries.push({
      key: logicalKey, blobId, byteLength: plain.length,
      digest: await digestBytes(plain), revision: existing ? existing.revision + 1 : 1,
    });
    const catalog = buildRuntimeCatalog({
      runtimeGeneration: storedCatalog.runtimeGeneration,
      catalogRevision: storedCatalog.revision + 1,
      entries,
    });
    const catalogEnvelope = await encryptRuntimeCatalog({ dek, userId: USER, companyId: COMPANY, catalog });
    await repository.commitRuntimeRecordSet({
      workspaceTag,
      logicalKey,
      expectedRecordRevision: existing ? existing.revision : null,
      expectedCatalogRevision: storedCatalog.revision,
      blobId,
      recordSchemaVersion: 1,
      ciphertext: envelope.ciphertext,
      iv: envelope.iv,
      catalogCiphertext: catalogEnvelope.ciphertext,
      catalogIv: catalogEnvelope.iv,
      runtimeGeneration: storedCatalog.runtimeGeneration,
      runtimeSchemaVersion: 1,
    });
    plain.fill(0);
    return true;
  } });
}

test("logical change events fire only after the atomic replacement", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  // Another tab commits a newer value; this tab's cache is now stale.
  await commitBehindTheRuntime("estipaid-customers-v1", "committed-elsewhere");
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("original");

  const seen = [];
  const listener = (event) => {
    // A listener that reads back synchronously must see the NEW cache.
    seen.push({ detail: event.detail.value, readBack: runtimeGetItem(event.detail.key), ready: isVaultRuntimeReady() });
  };
  window.addEventListener("pe-localstorage", listener);
  try {
    const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
    expect(hydrated.ok).toBe(true);
  } finally {
    window.removeEventListener("pe-localstorage", listener);
  }
  expect(seen).toHaveLength(1);
  seen.forEach((entry) => {
    expect(entry.detail).toBe("committed-elsewhere");
    // The listener read back the NEW cache, from a ready runtime: the event
    // cannot be observed before the atomic replacement.
    expect(entry.readBack).toBe("committed-elsewhere");
    expect(entry.ready).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- frozen mutations during revalidation.
// ---------------------------------------------------------------------------

test("a frozen runtime keeps serving reads and definitively refuses writes", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  const frozen = freezeVaultRuntimeMutations();
  expect(frozen).toMatchObject({ frozen: true, pending: 0 });
  // The lease is opaque: an empty frozen object carrying nothing at all.
  expect(Object.keys(frozen.lease)).toEqual([]);
  expect(Object.isFrozen(frozen.lease)).toBe(true);
  expect(isVaultRuntimeFrozen()).toBe(true);
  // Reads still serve the last verified cache.
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("original");
  expect(runtimeLogicalKeys()).toEqual(["estipaid-customers-v1"]);
  // The adapter is not ready, so the facade fails closed rather than writing.
  expect(isVaultRuntimeReady()).toBe(false);
  // Every mutation gets a definite refusal -- never silent acceptance.
  expect(runtimeSetItem("estipaid-customers-v1", "while-frozen")).toBe(false);
  expect(runtimeRemoveItem("estipaid-customers-v1")).toBe(false);
  expect(runtimeClear()).toBe(false);
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("original");
  expect(getVaultRuntimeStatus().pending).toBe(0);

  // Only the exact lease reopens mutations.
  expect(unfreezeVaultRuntimeMutations()).toMatchObject({ stale: true });
  expect(unfreezeVaultRuntimeMutations(Object.freeze({}))).toMatchObject({ stale: true });
  expect(isVaultRuntimeFrozen()).toBe(true);
  unfreezeVaultRuntimeMutations(frozen.lease);
  expect(isVaultRuntimeFrozen()).toBe(false);
  expect(isVaultRuntimeReady()).toBe(true);
  expect(runtimeSetItem("estipaid-customers-v1", "after-unfreeze")).toBe(true);
  const status = await flushVaultRuntime();
  expect(status.state).toBe("ready");
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("after-unfreeze");
});

test("an atomic replacement clears the freeze", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  freezeVaultRuntimeMutations();
  expect(isVaultRuntimeReady()).toBe(false);

  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated.ok).toBe(true);
  expect(isVaultRuntimeFrozen()).toBe(false);
  expect(isVaultRuntimeReady()).toBe(true);
});

test("freezing an absent or blocked runtime reports no freeze", async () => {
  expect(freezeVaultRuntimeMutations()).toEqual({ frozen: false, generation: 0, pending: 0, lease: null });
  expect(unfreezeVaultRuntimeMutations()).toEqual({ frozen: false, generation: 0, stale: true });
  expect(isVaultRuntimeFrozen()).toBe(false);
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- fallback selection follows the ACTUAL transport.
//
// A constructor that merely exists is not proof of a usable channel: it can
// throw, or hand back an object that cannot carry a message. The focus/
// visibility fallback is chosen on what was really opened.
// ---------------------------------------------------------------------------

describe("transport-aware focus fallback", () => {
  let unsubscribe = null;
  let signals = 0;
  let visibility = "visible";

  beforeEach(async () => {
    signals = 0;
    visibility = "visible";
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
    channels.clear();
    await readyRuntime();
  });

  afterEach(() => {
    if (unsubscribe) unsubscribe();
    unsubscribe = null;
    channels.forEach((entry) => entry.close());
    channels.clear();
    delete globalThis.BroadcastChannel;
    delete document.visibilityState;
  });

  function subscribe() {
    unsubscribe = subscribeVaultRuntimeRevalidation(() => { signals += 1; });
  }

  test("a usable channel means no focus fallback", () => {
    globalThis.BroadcastChannel = FakeBroadcastChannel;
    subscribe();
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(signals).toBe(0);
    // ... and the real transport still delivers.
    const remote = new FakeBroadcastChannel("estipaid-vault-runtime-v1");
    const described = describeVaultRuntime();
    remote.postMessage({
      type: "runtime-committed",
      workspaceTag: TAG_FOR_TEST,
      runtimeGeneration: described.runtimeGeneration,
      catalogRevision: described.catalogRevision + 1,
    });
    expect(signals).toBe(1);
    remote.close();
  });

  test("a missing constructor installs the fallback", () => {
    delete globalThis.BroadcastChannel;
    subscribe();
    window.dispatchEvent(new Event("focus"));
    expect(signals).toBe(1);
  });

  test("a constructor that throws installs the fallback", () => {
    globalThis.BroadcastChannel = function ThrowingChannel() { throw new Error("blocked by policy"); };
    subscribe();
    window.dispatchEvent(new Event("focus"));
    expect(signals).toBe(1);
  });

  test("a constructor returning an unusable object installs the fallback", () => {
    globalThis.BroadcastChannel = function UnusableChannel() { return { name: "unusable" }; };
    subscribe();
    window.dispatchEvent(new Event("focus"));
    expect(signals).toBe(1);
  });

  test("the fallback ignores hidden visibility and hidden focus", () => {
    delete globalThis.BroadcastChannel;
    subscribe();
    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
    expect(signals).toBe(0);
    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(signals).toBe(1);
  });

  test("cleanup removes the fallback listeners exactly once", () => {
    delete globalThis.BroadcastChannel;
    subscribe();
    window.dispatchEvent(new Event("focus"));
    expect(signals).toBe(1);
    unsubscribe();
    unsubscribe = null;
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    expect(signals).toBe(1);
  });

  test("resubscribing does not install duplicate fallback listeners", () => {
    delete globalThis.BroadcastChannel;
    subscribe();
    unsubscribe();
    subscribe();
    window.dispatchEvent(new Event("focus"));
    // One listener, one signal -- not two.
    expect(signals).toBe(1);
  });
});

test("a failed hydration for another identity never revokes the active runtime", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "mine");
  await sealMigratedWorkspace();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  const generation = describeVaultRuntime().generation;

  // A late hydration belonging to a DIFFERENT workspace fails; the runtime that
  // replaced it must be untouched.
  const foreign = await hydrateVaultRuntime({
    userId: "99999999-8888-4777-8666-555555555555",
    companyId: COMPANY,
    repository,
  });
  expect(foreign.ok).toBe(false);
  expect(isVaultRuntimeReady()).toBe(true);
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("mine");
  expect(describeVaultRuntime().generation).toBe(generation);
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- EXACT runtime-session lease.
//
// Identity equality is not enough: the same user and company can lock, idle
// lock, log out and back in, unlock, or re-activate while an older operation is
// still verifying. Every long operation now carries an opaque token bound to
// the exact session it began from, and a superseded operation may not publish,
// revoke, block, clear, or unfreeze whatever replaced it.
// ---------------------------------------------------------------------------

// Pauses hydration at a chosen record so a lock or a re-activation can happen
// while the candidate is mid-flight.
function pausedRepository(base, { pauseOnKey }) {
  let release = null;
  const paused = new Promise((resolve) => { release = resolve; });
  let armed = true;
  let reached = null;
  const reachedPause = new Promise((resolve) => { reached = resolve; });
  return {
    repository: {
      ...base,
      readEncryptedRecord: async (options) => {
        if (armed && options.logicalKey === pauseOnKey) {
          armed = false;
          reached();
          await paused;
        }
        return base.readEncryptedRecord(options);
      },
    },
    reachedPause,
    release: () => release(),
  };
}

async function readyTwoKeyRuntime() {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await writeMigratedRecord("estipaid-projects-v1", "second");
  await sealMigratedWorkspace();
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated.ok).toBe(true);
}

test("the lease is opaque and reports an active session even while frozen", async () => {
  await readyTwoKeyRuntime();
  expect(hasVaultRuntimeSession()).toBe(true);
  const { lease } = freezeVaultRuntimeMutations();
  // Frozen is deliberately NOT ready, but the session still exists -- which is
  // what a repeated refresh must key off.
  expect(isVaultRuntimeReady()).toBe(false);
  expect(hasVaultRuntimeSession()).toBe(true);
  expect(JSON.stringify(lease)).toBe("{}");
  expect(Object.getOwnPropertyNames(lease)).toEqual([]);
  expect(Object.getOwnPropertySymbols(lease)).toEqual([]);
  unfreezeVaultRuntimeMutations(lease);
});

test("a candidate whose runtime locked mid-flight publishes nothing", async () => {
  await readyTwoKeyRuntime();
  const { lease } = freezeVaultRuntimeMutations();
  const paused = pausedRepository(repository, { pauseOnKey: "estipaid-projects-v1" });
  const hydrating = hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: paused.repository, lease });
  await paused.reachedPause;

  // A manual or idle lock revokes the runtime while the candidate is paused.
  revokeVaultRuntime();
  paused.release();
  const outcome = await hydrating;

  expect(outcome).toMatchObject({ ok: false, state: "stale", code: VAULT_RUNTIME_ERROR_CODES.STALE_SESSION });
  // Nothing was recreated behind the lock.
  expect(hasVaultRuntimeSession()).toBe(false);
  expect(isVaultRuntimeReady()).toBe(false);
  expect(runtimeGetItem("estipaid-customers-v1")).toBeNull();
  expect(describeVaultRuntime()).toEqual({ active: false });
});

test("a successful stale candidate never disturbs a newer same-identity session", async () => {
  await readyTwoKeyRuntime();
  const { lease } = freezeVaultRuntimeMutations();
  const paused = pausedRepository(repository, { pauseOnKey: "estipaid-projects-v1" });
  const hydrating = hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: paused.repository, lease });
  await paused.reachedPause;

  // Lock, then unlock and re-activate the SAME identity: generation B.
  revokeVaultRuntime();
  const activation = beginVaultRuntimeActivation();
  const reactivated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository, activation });
  expect(reactivated.ok).toBe(true);
  const generationB = describeVaultRuntime().generation;
  runtimeSetItem("estipaid-customers-v1", "written-by-b");
  await flushVaultRuntime();

  paused.release();
  const outcome = await hydrating;

  expect(outcome).toMatchObject({ ok: false, state: "stale" });
  // Generation B is untouched: same generation, same cache, still ready, queue
  // intact, not frozen, not blocked.
  expect(describeVaultRuntime().generation).toBe(generationB);
  expect(isVaultRuntimeReady()).toBe(true);
  expect(isVaultRuntimeFrozen()).toBe(false);
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("written-by-b");
  expect(getVaultRuntimeStatus().state).toBe("ready");
});

test("a FAILED stale candidate never revokes or blocks the newer session", async () => {
  await readyTwoKeyRuntime();
  const { lease } = freezeVaultRuntimeMutations();
  const failingPaused = pausedRepository({
    ...repository,
    readEncryptedRecord: async (options) => (options.logicalKey === "estipaid-projects-v1"
      ? null                                                                  // the record vanished
      : repository.readEncryptedRecord(options)),
  }, { pauseOnKey: "estipaid-projects-v1" });
  const hydrating = hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: failingPaused.repository, lease });
  await failingPaused.reachedPause;

  revokeVaultRuntime();
  const activation = beginVaultRuntimeActivation();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository, activation });
  const generationB = describeVaultRuntime().generation;

  failingPaused.release();
  const outcome = await hydrating;

  expect(outcome).toMatchObject({ ok: false, state: "stale" });
  expect(describeVaultRuntime().generation).toBe(generationB);
  expect(isVaultRuntimeReady()).toBe(true);
  expect(getVaultRuntimeStatus().state).toBe("ready");
  expect(getVaultRuntimeStatus().code).toBe("");
  expect(runtimeGetItem("estipaid-customers-v1")).toBe("original");
});

test("a stale lease cannot unfreeze, freeze, or clear the newer session", async () => {
  await readyTwoKeyRuntime();
  const stale = freezeVaultRuntimeMutations();
  revokeVaultRuntime();
  const activation = beginVaultRuntimeActivation();
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository, activation });
  const generationB = describeVaultRuntime().generation;
  const fresh = freezeVaultRuntimeMutations();
  expect(isVaultRuntimeFrozen()).toBe(true);

  // The old operation reaching its `finally` must not reopen generation B.
  expect(unfreezeVaultRuntimeMutations(stale.lease)).toMatchObject({ stale: true });
  expect(isVaultRuntimeFrozen()).toBe(true);
  expect(isVaultRuntimeReady()).toBe(false);
  expect(describeVaultRuntime().generation).toBe(generationB);

  // Only the exact current lease reopens it.
  expect(unfreezeVaultRuntimeMutations(fresh.lease)).toMatchObject({ stale: false });
  expect(isVaultRuntimeFrozen()).toBe(false);
  expect(isVaultRuntimeReady()).toBe(true);
});

test("a candidate cannot publish into a different workspace identity", async () => {
  await readyTwoKeyRuntime();
  const { lease } = freezeVaultRuntimeMutations();
  const paused = pausedRepository(repository, { pauseOnKey: "estipaid-projects-v1" });
  const hydrating = hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: paused.repository, lease });
  await paused.reachedPause;

  // The workspace switched to another identity entirely.
  revokeVaultRuntime();
  paused.release();
  const outcome = await hydrating;
  expect(outcome).toMatchObject({ ok: false, state: "stale" });
  expect(hasVaultRuntimeSession()).toBe(false);
});

test("an activation candidate that completes after a lock recreates nothing", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await writeMigratedRecord("estipaid-projects-v1", "second");
  await sealMigratedWorkspace();

  const activation = beginVaultRuntimeActivation();
  const paused = pausedRepository(repository, { pauseOnKey: "estipaid-projects-v1" });
  const hydrating = hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: paused.repository, activation });
  await paused.reachedPause;

  // Unmount / lock while the initial candidate is still verifying.
  revokeVaultRuntime();
  paused.release();
  const outcome = await hydrating;

  expect(outcome).toMatchObject({ ok: false, state: "stale" });
  expect(hasVaultRuntimeSession()).toBe(false);
  expect(runtimeGetItem("estipaid-customers-v1")).toBeNull();
});

test("a superseded activation token cannot publish over a newer activation", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await writeMigratedRecord("estipaid-projects-v1", "second");
  await sealMigratedWorkspace();

  const first = beginVaultRuntimeActivation();
  const paused = pausedRepository(repository, { pauseOnKey: "estipaid-projects-v1" });
  const hydrating = hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: paused.repository, activation: first });
  await paused.reachedPause;

  // A newer activation claims the session and completes first.
  const second = beginVaultRuntimeActivation();
  const newer = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository, activation: second });
  expect(newer.ok).toBe(true);
  const generationB = describeVaultRuntime().generation;

  paused.release();
  expect(await hydrating).toMatchObject({ ok: false, state: "stale" });
  expect(describeVaultRuntime().generation).toBe(generationB);
  expect(isVaultRuntimeReady()).toBe(true);
});
