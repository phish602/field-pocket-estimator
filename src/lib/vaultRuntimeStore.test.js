/**
 * ISO-16 -- authoritative runtime hydration, synchronous cache, durability
 * queue, and revocation, exercised end to end against a real IndexedDB with a
 * real unlocked vault session.
 */
import { IDBFactory } from "fake-indexeddb";
import {
  VAULT_RUNTIME_ERROR_CODES,
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
import { encryptBytes, recordAad, setTestArgon2Adapter } from "./vaultCrypto";
import { digestBytes, randomBlobId, utf8Bytes } from "./vaultRuntimeCatalog";

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
    return true;
  } });
}

beforeEach(async () => {
  revokeVaultRuntime();
  lockVault();
  await openWorkspace();
});

afterEach(() => {
  revokeVaultRuntime();
  lockVault();
});

test("sealing a migrated record set creates the first catalog without touching the manifest", async () => {
  await writeMigratedRecord("estipaid-customers-v1", '{"note":"synthetic"}');
  await writeMigratedRecord("estipaid-settings-v1", "");
  const sealed = await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(sealed).toMatchObject({ ok: true, state: "sealed", entryCount: 2 });

  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  const catalog = await repository.readRuntimeCatalog({ workspaceTag });
  expect(catalog.revision).toBe(1);
  expect(catalog.runtimeGeneration).toBe(1);
  // No migration manifest was created, and sealing did not invent one.
  expect(await repository.readMigrationManifest({ workspaceTag })).toBeNull();
});

test("sealing twice is idempotent", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  const again = await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(again).toMatchObject({ ok: true, state: "already-sealed" });
});

test("hydration verifies every record and publishes a synchronous cache", async () => {
  await writeMigratedRecord("estipaid-customers-v1", '{"note":"synthetic"}');
  await writeMigratedRecord("estipaid-settings-v1", "");
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });

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
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  lockVault();
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated).toMatchObject({ ok: false, code: VAULT_RUNTIME_ERROR_CODES.VAULT_LOCKED });
  expect(runtimeGetItem("estipaid-customers-v1")).toBeNull();
});

test("an unexpected encrypted record blocks hydration", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  await writeMigratedRecord("estipaid-projects-v1", "surprise");
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated.ok).toBe(false);
  expect([VAULT_RUNTIME_ERROR_CODES.RECORD_UNEXPECTED, VAULT_RUNTIME_ERROR_CODES.RECORD_MISSING]).toContain(hydrated.code);
});

test("a missing encrypted record blocks hydration", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "x");
  await writeMigratedRecord("estipaid-projects-v1", "y");
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  const workspaceTag = await deriveWorkspaceVaultTag(USER, COMPANY);
  const record = await repository.readEncryptedRecord({ workspaceTag, logicalKey: "estipaid-projects-v1" });
  await repository.deleteEncryptedRecord({ workspaceTag, logicalKey: "estipaid-projects-v1", expectedRevision: record.revision });
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  expect(hydrated.ok).toBe(false);
  expect(hydrated.code).toBe(VAULT_RUNTIME_ERROR_CODES.RECORD_MISSING);
});

test("set, replace, and remove are durable and survive a fresh hydration", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "original");
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
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
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
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
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
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
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
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
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository });

  expect(runtimeSetItem("estipaid-brand-new-key-v1", "value")).toBe(false);
  expect(runtimeGetItem("estipaid-brand-new-key-v1")).toBeNull();
  expect(runtimeRemoveItem("estipaid-brand-new-key-v1")).toBe(false);
  await flushVaultRuntime();
  expect(runtimeLogicalKeys()).toEqual(["estipaid-customers-v1"]);
});

test("a durability failure blocks the runtime and refuses further mutations", async () => {
  await writeMigratedRecord("estipaid-customers-v1", "a");
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
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
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
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
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
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
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
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
  await sealVaultRuntime({ userId: USER, companyId: COMPANY, repository });
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
