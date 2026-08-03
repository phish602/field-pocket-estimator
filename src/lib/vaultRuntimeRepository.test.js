/**
 * ISO-16 -- atomic authoritative runtime mutations against a real IndexedDB.
 *
 * Every assertion here is about ATOMICITY and COMPARE-AND-SET: a record must
 * never be persisted without its catalog, a catalog must never be persisted
 * without its record, and a stale revision must never win.
 */
import { IDBFactory } from "fake-indexeddb";
import {
  VAULT_REPOSITORY_ERROR_CODES,
  createVaultIndexedDbRepository,
} from "./vaultIndexedDbRepository";

const TAG = "A".repeat(43);
const originalStructuredClone = globalThis.structuredClone;

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
});

afterAll(() => {
  if (originalStructuredClone === undefined) delete globalThis.structuredClone;
  else globalThis.structuredClone = originalStructuredClone;
});

let indexedDB;
let repository;
let now;

function bytes(length, fill) { return new Uint8Array(length).fill(fill); }

async function createVault() {
  await repository.createWorkspaceVaultMetadata({
    workspaceTag: TAG,
    expectedRevision: null,
    kdfVersion: 1,
    kdfParameters: { algorithm: "argon2id", memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: "binary" },
    salt: bytes(32, 1),
    wrappedDekCiphertext: bytes(48, 2),
    wrappedDekIv: bytes(12, 3),
    sentinelSchemaVersion: 1,
    sentinelCiphertext: bytes(32, 4),
    sentinelIv: bytes(12, 5),
  });
}

async function seedCatalog() {
  return repository.createRuntimeCatalog({
    workspaceTag: TAG,
    expectedRevision: null,
    runtimeGeneration: 1,
    runtimeSchemaVersion: 1,
    ciphertext: bytes(64, 7),
    iv: bytes(12, 8),
  });
}

function setInput(overrides = {}) {
  return {
    workspaceTag: TAG,
    logicalKey: "estipaid-customers-v1",
    expectedRecordRevision: null,
    expectedCatalogRevision: 1,
    blobId: "A".repeat(22),
    recordSchemaVersion: 1,
    ciphertext: bytes(32, 9),
    iv: bytes(12, 10),
    catalogCiphertext: bytes(64, 11),
    catalogIv: bytes(12, 12),
    runtimeGeneration: 1,
    runtimeSchemaVersion: 1,
    ...overrides,
  };
}

beforeEach(async () => {
  indexedDB = new IDBFactory();
  now = 1767225600000;
  repository = createVaultIndexedDbRepository({ indexedDB, clock: () => (now += 1) });
  await createVault();
});

test("a runtime catalog is created once and read back exactly", async () => {
  expect(await repository.readRuntimeCatalog({ workspaceTag: TAG })).toBeNull();
  const created = await seedCatalog();
  expect(created.revision).toBe(1);
  expect(created.runtimeGeneration).toBe(1);
  const read = await repository.readRuntimeCatalog({ workspaceTag: TAG });
  expect(read.revision).toBe(1);
  expect(Array.from(read.ciphertext)).toEqual(Array.from(bytes(64, 7)));
  await expect(seedCatalog()).rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.CONFLICT });
});

test("a set commits the record and the catalog together and advances both revisions", async () => {
  await seedCatalog();
  const committed = await repository.commitRuntimeRecordSet(setInput());
  expect(committed.record.revision).toBe(1);
  expect(committed.catalog.revision).toBe(2);
  const record = await repository.readEncryptedRecord({ workspaceTag: TAG, logicalKey: "estipaid-customers-v1" });
  expect(record.blobId).toBe("A".repeat(22));
  expect((await repository.readRuntimeCatalog({ workspaceTag: TAG })).revision).toBe(2);
});

test("a replace requires the exact record revision and advances it", async () => {
  await seedCatalog();
  await repository.commitRuntimeRecordSet(setInput());
  const replaced = await repository.commitRuntimeRecordSet(setInput({
    expectedRecordRevision: 1, expectedCatalogRevision: 2, blobId: "B".repeat(22),
  }));
  expect(replaced.record.revision).toBe(2);
  expect(replaced.catalog.revision).toBe(3);
});

test("a stale catalog revision is rejected and nothing is written", async () => {
  await seedCatalog();
  await repository.commitRuntimeRecordSet(setInput());
  await expect(repository.commitRuntimeRecordSet(setInput({
    logicalKey: "estipaid-projects-v1", expectedCatalogRevision: 1, blobId: "C".repeat(22),
  }))).rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.CONFLICT });

  // Atomicity: the losing write left NO record and did not advance the catalog.
  expect(await repository.readEncryptedRecord({ workspaceTag: TAG, logicalKey: "estipaid-projects-v1" })).toBeNull();
  expect((await repository.readRuntimeCatalog({ workspaceTag: TAG })).revision).toBe(2);
});

test("a stale record revision is rejected and the catalog does not advance", async () => {
  await seedCatalog();
  await repository.commitRuntimeRecordSet(setInput());
  await expect(repository.commitRuntimeRecordSet(setInput({
    expectedRecordRevision: 99, expectedCatalogRevision: 2, blobId: "D".repeat(22),
  }))).rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.CONFLICT });
  const record = await repository.readEncryptedRecord({ workspaceTag: TAG, logicalKey: "estipaid-customers-v1" });
  expect(record.revision).toBe(1);
  expect((await repository.readRuntimeCatalog({ workspaceTag: TAG })).revision).toBe(2);
});

test("creating a record that already exists is rejected", async () => {
  await seedCatalog();
  await repository.commitRuntimeRecordSet(setInput());
  await expect(repository.commitRuntimeRecordSet(setInput({
    expectedRecordRevision: null, expectedCatalogRevision: 2, blobId: "E".repeat(22),
  }))).rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.CONFLICT });
});

test("a mismatched runtime generation is rejected", async () => {
  await seedCatalog();
  await expect(repository.commitRuntimeRecordSet(setInput({ runtimeGeneration: 2 })))
    .rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.CONFLICT });
  expect(await repository.listEncryptedRecordKeys({ workspaceTag: TAG })).toEqual([]);
});

test("a remove deletes the record and advances the catalog atomically", async () => {
  await seedCatalog();
  await repository.commitRuntimeRecordSet(setInput());
  const removed = await repository.commitRuntimeRecordRemove({
    workspaceTag: TAG,
    logicalKey: "estipaid-customers-v1",
    expectedRecordRevision: 1,
    expectedCatalogRevision: 2,
    catalogCiphertext: bytes(64, 13),
    catalogIv: bytes(12, 14),
    runtimeGeneration: 1,
    runtimeSchemaVersion: 1,
  });
  expect(removed.catalog.revision).toBe(3);
  expect(await repository.readEncryptedRecord({ workspaceTag: TAG, logicalKey: "estipaid-customers-v1" })).toBeNull();
});

test("a remove with a stale revision leaves the record intact", async () => {
  await seedCatalog();
  await repository.commitRuntimeRecordSet(setInput());
  await expect(repository.commitRuntimeRecordRemove({
    workspaceTag: TAG,
    logicalKey: "estipaid-customers-v1",
    expectedRecordRevision: 99,
    expectedCatalogRevision: 2,
    catalogCiphertext: bytes(64, 13),
    catalogIv: bytes(12, 14),
    runtimeGeneration: 1,
    runtimeSchemaVersion: 1,
  })).rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.CONFLICT });
  expect(await repository.readEncryptedRecord({ workspaceTag: TAG, logicalKey: "estipaid-customers-v1" })).not.toBeNull();
  expect((await repository.readRuntimeCatalog({ workspaceTag: TAG })).revision).toBe(2);
});

test("a clear removes only approved business records and preserves vault metadata and migration evidence", async () => {
  await seedCatalog();
  await repository.commitRuntimeRecordSet(setInput());
  await repository.commitRuntimeRecordSet(setInput({
    logicalKey: "estipaid-projects-v1", expectedCatalogRevision: 2, blobId: "F".repeat(22),
  }));
  await repository.createMigrationManifest({
    workspaceTag: TAG, expectedRevision: null, transitionId: "123e4567-e89b-42d3-a456-426614174000",
    manifestSchemaVersion: 1, ciphertext: bytes(64, 20), iv: bytes(12, 21),
  });

  const cleared = await repository.commitRuntimeClear({
    workspaceTag: TAG,
    expectedCatalogRevision: 3,
    catalogCiphertext: bytes(64, 15),
    catalogIv: bytes(12, 16),
    runtimeGeneration: 1,
    runtimeSchemaVersion: 1,
  });
  expect(cleared.removed).toBe(2);
  expect(cleared.catalog.revision).toBe(4);
  expect(await repository.listEncryptedRecordKeys({ workspaceTag: TAG })).toEqual([]);
  // Vault metadata and the FROZEN migration manifest both survive.
  expect(await repository.readWorkspaceVaultMetadata({ workspaceTag: TAG })).not.toBeNull();
  const manifest = await repository.readMigrationManifest({ workspaceTag: TAG });
  expect(manifest.transitionId).toBe("123e4567-e89b-42d3-a456-426614174000");
  expect(Array.from(manifest.ciphertext)).toEqual(Array.from(bytes(64, 20)));
});

test("runtime operations never touch the frozen migration manifest", async () => {
  await seedCatalog();
  await repository.createMigrationManifest({
    workspaceTag: TAG, expectedRevision: null, transitionId: "123e4567-e89b-42d3-a456-426614174000",
    manifestSchemaVersion: 1, ciphertext: bytes(64, 20), iv: bytes(12, 21),
  });
  const before = await repository.readMigrationManifest({ workspaceTag: TAG });
  await repository.commitRuntimeRecordSet(setInput());
  await repository.commitRuntimeRecordSet(setInput({ expectedRecordRevision: 1, expectedCatalogRevision: 2, blobId: "G".repeat(22) }));
  const after = await repository.readMigrationManifest({ workspaceTag: TAG });
  expect(after).toEqual(before);
});

test("an unapproved logical key is refused by every runtime operation", async () => {
  await seedCatalog();
  await expect(repository.commitRuntimeRecordSet(setInput({ logicalKey: "estipaid-not-approved-v1" })))
    .rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT });
  await expect(repository.commitRuntimeRecordRemove({
    workspaceTag: TAG, logicalKey: "estipaid-not-approved-v1", expectedRecordRevision: 1,
    expectedCatalogRevision: 1, catalogCiphertext: bytes(64, 1), catalogIv: bytes(12, 1),
    runtimeGeneration: 1, runtimeSchemaVersion: 1,
  })).rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT });
});

test("exact input shapes are enforced", async () => {
  await seedCatalog();
  await expect(repository.commitRuntimeRecordSet({ ...setInput(), extra: 1 }))
    .rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT });
  const missing = setInput();
  delete missing.blobId;
  await expect(repository.commitRuntimeRecordSet(missing))
    .rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT });
  await expect(repository.commitRuntimeRecordSet(setInput({ iv: bytes(11, 1) })))
    .rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA });
});

test("a set against a workspace with no runtime catalog fails closed", async () => {
  await expect(repository.commitRuntimeRecordSet(setInput()))
    .rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.DATABASE_NOT_FOUND });
  expect(await repository.listEncryptedRecordKeys({ workspaceTag: TAG })).toEqual([]);
});

test("persisted byte arrays are cloned, so a caller cannot mutate stored state", async () => {
  await seedCatalog();
  const input = setInput();
  await repository.commitRuntimeRecordSet(input);
  input.ciphertext.fill(0xff);
  const record = await repository.readEncryptedRecord({ workspaceTag: TAG, logicalKey: "estipaid-customers-v1" });
  expect(Array.from(record.ciphertext)).toEqual(Array.from(bytes(32, 9)));
});

test("a corrupted persisted catalog is reported as corrupt rather than parsed", async () => {
  await seedCatalog();
  const database = await new Promise((resolve, reject) => {
    const request = indexedDB.open(`estipaid-vault-v1-${TAG}`);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve) => {
    const transaction = database.transaction("migration", "readwrite");
    transaction.objectStore("migration").put({ version: 1, revision: 1 }, "runtime");
    transaction.oncomplete = resolve;
  });
  database.close();
  await expect(repository.readRuntimeCatalog({ workspaceTag: TAG }))
    .rejects.toMatchObject({ code: VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT });
});
