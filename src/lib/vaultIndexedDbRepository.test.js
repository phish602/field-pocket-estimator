import {
  forceCloseDatabase,
  IDBFactory,
  IDBKeyRange,
} from "fake-indexeddb";
import {
  createVaultIndexedDbRepository,
  VaultRepositoryError,
  VAULT_REPOSITORY_ERROR_CODES,
  WORKSPACE_VAULT_DATABASE_PREFIX,
  WORKSPACE_VAULT_DATABASE_VERSION,
  WORKSPACE_VAULT_METADATA_STORE,
  WORKSPACE_VAULT_RECORDS_STORE,
  WORKSPACE_VAULT_MIGRATION_STORE,
} from "./vaultIndexedDbRepository";

let sequence = 0;
const originalStructuredClone = globalThis.structuredClone;

beforeAll(() => {
  // The test realm does not expose Node 24's native clone helper.
  // This isolated shim covers the values exercised by this backend readiness suite.
  globalThis.structuredClone = (value) => {
    if (value instanceof Uint8Array) return value.slice();
    if (value instanceof ArrayBuffer) return value.slice(0);
    return value;
  };
});

afterAll(() => {
  if (originalStructuredClone === undefined) delete globalThis.structuredClone;
  else globalThis.structuredClone = originalStructuredClone;
});

function databaseName(label) {
  sequence += 1;
  return `vault-indexeddb-readiness-${label}-${Date.now()}-${sequence}`;
}

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionComplete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("transaction aborted"));
    transaction.onerror = () => reject(transaction.error || new Error("transaction failed"));
  });
}

function transactionAbort(transaction) {
  return new Promise((resolve, reject) => {
    transaction.onabort = () => resolve();
    transaction.oncomplete = () => reject(new Error("transaction unexpectedly completed"));
    transaction.onerror = () => {};
  });
}

function openDatabase(factory, name, version, upgrade) {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = () => upgrade?.(request.result, request.transaction);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("database open was blocked"));
  });
}

function deleteDatabase(factory, name) {
  return new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("database deletion was blocked"));
  });
}

async function closeAndDelete(factory, database) {
  database.close();
  await deleteDatabase(factory, database.name);
}

test("fake-indexeddb provides an isolated IDBFactory", async () => {
  const firstFactory = new IDBFactory();
  const secondFactory = new IDBFactory();
  const name = databaseName("factory-isolation");
  let firstDatabase;
  let secondDatabase;

  try {
    expect(firstFactory).not.toBe(secondFactory);
    expect(IDBKeyRange).toBeDefined();

    firstDatabase = await openDatabase(firstFactory, name, 1, (database) => {
      database.createObjectStore("records");
    });
    const write = firstDatabase.transaction("records", "readwrite");
    const writeDone = transactionComplete(write);
    write.objectStore("records").put("first-factory-only", "record");
    await writeDone;

    secondDatabase = await openDatabase(secondFactory, name, 1);
    expect(Array.from(secondDatabase.objectStoreNames)).not.toContain("records");
  } finally {
    if (firstDatabase) await closeAndDelete(firstFactory, firstDatabase);
    if (secondDatabase) await closeAndDelete(secondFactory, secondDatabase);
  }
});

test("fake-indexeddb clones Uint8Array values across persistence", async () => {
  const factory = new IDBFactory();
  const name = databaseName("typed-array-clone");
  let database;

  try {
    database = await openDatabase(factory, name, 1, (db) => db.createObjectStore("records"));
    const input = new Uint8Array([1, 2, 3]);
    const write = database.transaction("records", "readwrite");
    const writeDone = transactionComplete(write);
    write.objectStore("records").put(input, "record");
    input[0] = 99;
    await writeDone;

    const firstRead = await requestResult(database.transaction("records").objectStore("records").get("record"));
    expect(Array.from(firstRead)).toEqual([1, 2, 3]);
    expect(firstRead).not.toBe(input);
    firstRead[1] = 88;

    const secondRead = await requestResult(database.transaction("records").objectStore("records").get("record"));
    expect(Array.from(secondRead)).toEqual([1, 2, 3]);
    expect(secondRead).not.toBe(firstRead);
  } finally {
    if (database) await closeAndDelete(factory, database);
  }
});

test("fake-indexeddb reports transaction completion after a successful write", async () => {
  const factory = new IDBFactory();
  const name = databaseName("transaction-completion");
  let database;

  try {
    database = await openDatabase(factory, name, 1, (db) => db.createObjectStore("records"));
    const transaction = database.transaction("records", "readwrite");
    let completed = false;
    const complete = transactionComplete(transaction).then(() => { completed = true; });
    const request = transaction.objectStore("records").put("saved", "record");
    await requestResult(request);
    expect(completed).toBe(false);
    await complete;
    expect(completed).toBe(true);
  } finally {
    if (database) await closeAndDelete(factory, database);
  }
});

test("fake-indexeddb reports transaction abort", async () => {
  const factory = new IDBFactory();
  const name = databaseName("transaction-abort");
  let database;

  try {
    database = await openDatabase(factory, name, 1, (db) => db.createObjectStore("records"));
    const transaction = database.transaction("records", "readwrite");
    const aborted = transactionAbort(transaction);
    transaction.objectStore("records").put("discarded", "record");
    transaction.abort();
    await aborted;
    await expect(requestResult(database.transaction("records").objectStore("records").get("record"))).resolves.toBeUndefined();
  } finally {
    if (database) await closeAndDelete(factory, database);
  }
});

test("fake-indexeddb rejects duplicate add operations", async () => {
  const factory = new IDBFactory();
  const name = databaseName("duplicate-add");
  let database;

  try {
    database = await openDatabase(factory, name, 1, (db) => db.createObjectStore("records"));
    const transaction = database.transaction("records", "readwrite");
    const complete = new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error("duplicate transaction aborted"));
      transaction.onerror = () => {};
    });
    const store = transaction.objectStore("records");
    store.add("first", "record");
    const duplicate = store.add("second", "record");
    const errorName = await new Promise((resolve) => {
      duplicate.onerror = (event) => {
        event.preventDefault();
        resolve(duplicate.error.name);
      };
    });
    expect(errorName).toBe("ConstraintError");
    await complete;
  } finally {
    if (database) await closeAndDelete(factory, database);
  }
});

test("fake-indexeddb supports key listing", async () => {
  const factory = new IDBFactory();
  const name = databaseName("key-listing");
  let database;

  try {
    database = await openDatabase(factory, name, 1, (db) => db.createObjectStore("records"));
    const write = database.transaction("records", "readwrite");
    const writeDone = transactionComplete(write);
    const store = write.objectStore("records");
    store.put("one", "key-1");
    store.put("two", "key-2");
    store.put("three", "key-3");
    await writeDone;
    const keys = await requestResult(database.transaction("records").objectStore("records").getAllKeys());
    expect(keys).toEqual(["key-1", "key-2", "key-3"]);
  } finally {
    if (database) await closeAndDelete(factory, database);
  }
});

test("fake-indexeddb supports indexedDB.databases", async () => {
  const factory = new IDBFactory();
  const name = databaseName("databases");
  let database;

  try {
    database = await openDatabase(factory, name, 1, (db) => db.createObjectStore("records"));
    expect(await factory.databases()).toEqual(expect.arrayContaining([expect.objectContaining({ name })]));
    database.close();
    database = null;
    await deleteDatabase(factory, name);
    expect(await factory.databases()).not.toEqual(expect.arrayContaining([expect.objectContaining({ name })]));
  } finally {
    if (database) await closeAndDelete(factory, database);
  }
});

test("forceCloseDatabase closes an open test database", async () => {
  const factory = new IDBFactory();
  const name = databaseName("force-close");
  let database;

  try {
    database = await openDatabase(factory, name, 1, (db) => db.createObjectStore("records"));
    forceCloseDatabase(database);
    database = null;
    await deleteDatabase(factory, name);
  } finally {
    if (database) await closeAndDelete(factory, database);
  }
});

test("fake-indexeddb operations require no runtime network access", async () => {
  const factory = new IDBFactory();
  const name = databaseName("no-network");
  const originalFetch = globalThis.fetch;
  const fetchMock = jest.fn(() => { throw new Error("network access is forbidden"); });
  let database;

  globalThis.fetch = fetchMock;
  try {
    database = await openDatabase(factory, name, 1, (db) => db.createObjectStore("records"));
    const write = database.transaction("records", "readwrite");
    const writeDone = transactionComplete(write);
    write.objectStore("records").put("offline", "record");
    await writeDone;
    await expect(requestResult(database.transaction("records").objectStore("records").get("record"))).resolves.toBe("offline");
    database.close();
    database = null;
    await deleteDatabase(factory, name);
    expect(fetchMock).not.toHaveBeenCalled();
  } finally {
    if (database) await closeAndDelete(factory, database);
    if (originalFetch === undefined) delete globalThis.fetch;
    else globalThis.fetch = originalFetch;
  }
});

const WORKSPACE_TAG = "A".repeat(43);
const OTHER_WORKSPACE_TAG = "B".repeat(43);
const ERROR_MESSAGES = {
  INVALID_INPUT: "Invalid vault request.",
  INVALID_SCHEMA: "Invalid vault data.",
  UNSUPPORTED_ENVIRONMENT: "Secure local storage is unavailable.",
  DATABASE_NOT_FOUND: "Vault storage was not found.",
  DATABASE_BLOCKED: "Vault storage is busy.",
  DATABASE_VERSION_ERROR: "Vault storage version is unavailable.",
  TRANSACTION_ABORTED: "Vault storage operation did not complete.",
  CONFLICT: "Vault data changed. Retry required.",
  RECORD_CORRUPT: "Vault storage could not be verified.",
  REVISION_OVERFLOW: "Vault data cannot be updated.",
  QUOTA_EXCEEDED: "Secure local storage is full.",
  STORAGE_OPERATION_FAILED: "Vault storage operation failed.",
};

function metadataInput(overrides = {}) {
  return {
    workspaceTag: WORKSPACE_TAG,
    expectedRevision: null,
    kdfVersion: 1,
    kdfParameters: {
      algorithm: "argon2id",
      memorySize: 65536,
      iterations: 3,
      parallelism: 1,
      hashLength: 32,
      outputType: "binary",
    },
    salt: new Uint8Array(32).fill(1),
    wrappedDekCiphertext: new Uint8Array(48).fill(2),
    wrappedDekIv: new Uint8Array(12).fill(3),
    sentinelSchemaVersion: 1,
    sentinelCiphertext: new Uint8Array(32).fill(4),
    sentinelIv: new Uint8Array(12).fill(5),
    ...overrides,
  };
}

function repository(factory, clock = () => Date.parse("2026-07-27T12:00:00.000Z")) {
  return createVaultIndexedDbRepository({ indexedDB: factory, clock });
}

function vaultDatabaseName(tag = WORKSPACE_TAG) {
  return `${WORKSPACE_VAULT_DATABASE_PREFIX}${tag}`;
}

async function deleteFactoryDatabases(factory) {
  const databases = await factory.databases();
  await Promise.all(databases.map((entry) => deleteDatabase(factory, entry.name)));
}

async function readRawMetadata(factory, tag = WORKSPACE_TAG) {
  const database = await openDatabase(factory, vaultDatabaseName(tag), WORKSPACE_VAULT_DATABASE_VERSION);
  try {
    return await requestResult(database.transaction(WORKSPACE_VAULT_METADATA_STORE).objectStore(WORKSPACE_VAULT_METADATA_STORE).get("vault"));
  } finally {
    database.close();
  }
}

async function writeRawMetadata(factory, value, tag = WORKSPACE_TAG) {
  const database = await openDatabase(factory, vaultDatabaseName(tag), WORKSPACE_VAULT_DATABASE_VERSION);
  try {
    const transaction = database.transaction(WORKSPACE_VAULT_METADATA_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(WORKSPACE_VAULT_METADATA_STORE).put(value, "vault");
    await completed;
  } finally {
    database.close();
  }
}

async function readRawRecord(factory, logicalKey = RECORD_KEY, tag = WORKSPACE_TAG) {
  const database = await openDatabase(factory, vaultDatabaseName(tag), WORKSPACE_VAULT_DATABASE_VERSION);
  try {
    return await requestResult(database.transaction(WORKSPACE_VAULT_RECORDS_STORE).objectStore(WORKSPACE_VAULT_RECORDS_STORE).get(logicalKey));
  } finally {
    database.close();
  }
}

async function writeRawRecord(factory, value, tag = WORKSPACE_TAG) {
  const database = await openDatabase(factory, vaultDatabaseName(tag), WORKSPACE_VAULT_DATABASE_VERSION);
  try {
    const transaction = database.transaction(WORKSPACE_VAULT_RECORDS_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(WORKSPACE_VAULT_RECORDS_STORE).put(value);
    await completed;
  } finally {
    database.close();
  }
}

async function readRawManifest(factory, tag = WORKSPACE_TAG) {
  const database = await openDatabase(factory, vaultDatabaseName(tag), WORKSPACE_VAULT_DATABASE_VERSION);
  try {
    return await requestResult(database.transaction(WORKSPACE_VAULT_MIGRATION_STORE).objectStore(WORKSPACE_VAULT_MIGRATION_STORE).get("manifest"));
  } finally {
    database.close();
  }
}

async function writeRawManifest(factory, value, tag = WORKSPACE_TAG) {
  const database = await openDatabase(factory, vaultDatabaseName(tag), WORKSPACE_VAULT_DATABASE_VERSION);
  try {
    const transaction = database.transaction(WORKSPACE_VAULT_MIGRATION_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(WORKSPACE_VAULT_MIGRATION_STORE).put(value, "manifest");
    await completed;
  } finally {
    database.close();
  }
}

function expectCode(promise, code) {
  return expect(promise).rejects.toEqual(expect.objectContaining({ name: "VaultRepositoryError", code, message: ERROR_MESSAGES[code] }));
}

test("repository error foundation has the exact public contract", () => {
  expect(Object.keys(VAULT_REPOSITORY_ERROR_CODES)).toEqual(Object.keys(ERROR_MESSAGES));
  Object.entries(VAULT_REPOSITORY_ERROR_CODES).forEach(([key, code]) => {
    const error = new VaultRepositoryError(code);
    expect(error.name).toBe("VaultRepositoryError");
    expect(error.code).toBe(code);
    expect(error.message).toBe(ERROR_MESSAGES[key]);
    expect(Object.prototype.hasOwnProperty.call(error, "cause")).toBe(false);
  });
  expect(() => new VaultRepositoryError("UNKNOWN")).toThrow();
});

test("repository constructor validates strict injections", () => {
  const factory = new IDBFactory();
  expect(Object.keys(repository(factory)).sort()).toEqual([
    "createEncryptedRecord",
    "createMigrationManifest",
    "createWorkspaceVaultMetadata",
    "deleteEncryptedRecord",
    "deleteMigrationManifest",
    "listEncryptedRecordKeys",
    "readEncryptedRecord",
    "readMigrationManifest",
    "readWorkspaceVaultMetadata",
    "replaceEncryptedRecord",
    "replaceMigrationManifest",
    "replaceWorkspaceVaultMetadata",
    "workspaceDatabaseExists",
  ]);
  expect(() => createVaultIndexedDbRepository({ indexedDB: factory, unknown: true })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  expect(() => createVaultIndexedDbRepository({ indexedDB: factory, clock: 1 })).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  expect(() => createVaultIndexedDbRepository({ indexedDB: { open() {}, deleteDatabase() {} } })).toThrow(expect.objectContaining({ code: "UNSUPPORTED_ENVIRONMENT" }));
  const accessor = { indexedDB: factory };
  Object.defineProperty(accessor, "clock", { enumerable: true, get: () => Date.now });
  expect(() => createVaultIndexedDbRepository(accessor)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  const symbolOption = { indexedDB: factory };
  symbolOption[Symbol("x")] = true;
  expect(() => createVaultIndexedDbRepository(symbolOption)).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
  expect(() => createVaultIndexedDbRepository(Object.assign(Object.create(null), { indexedDB: factory }))).toThrow(expect.objectContaining({ code: "INVALID_INPUT" }));
});

test("workspace existence checks use databases only", async () => {
  const factory = new IDBFactory();
  const spy = jest.spyOn(factory, "open");
  const repo = repository(factory);
  try {
    await expect(repo.workspaceDatabaseExists({ workspaceTag: WORKSPACE_TAG })).resolves.toBe(false);
    expect(spy).not.toHaveBeenCalled();
    await repo.createWorkspaceVaultMetadata(metadataInput());
    await expect(repo.workspaceDatabaseExists({ workspaceTag: WORKSPACE_TAG })).resolves.toBe(true);
    await expect(repo.workspaceDatabaseExists({ workspaceTag: "bad" })).rejects.toEqual(expect.objectContaining({ code: "INVALID_INPUT" }));
  } finally {
    spy.mockRestore();
    await deleteFactoryDatabases(factory);
  }
});

test("workspace existence maps malformed or rejected discovery", async () => {
  const factory = new IDBFactory();
  const malformed = { databases: () => Promise.resolve({}), open: factory.open.bind(factory), deleteDatabase: factory.deleteDatabase.bind(factory) };
  const rejected = { databases: () => Promise.reject(new Error("hidden")), open: factory.open.bind(factory), deleteDatabase: factory.deleteDatabase.bind(factory) };
  await expectCode(repository(malformed).workspaceDatabaseExists({ workspaceTag: WORKSPACE_TAG }), "STORAGE_OPERATION_FAILED");
  await expectCode(repository(rejected).workspaceDatabaseExists({ workspaceTag: WORKSPACE_TAG }), "STORAGE_OPERATION_FAILED");
});

test("metadata creation creates the exact v1 schema", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    const created = await repo.createWorkspaceVaultMetadata(metadataInput());
    expect(created).toEqual(expect.objectContaining({ version: 1, revision: 1, workspaceTag: WORKSPACE_TAG }));
    expect(created.createdAt).toBe(created.updatedAt);
    const database = await openDatabase(factory, vaultDatabaseName(), 1);
    try {
      expect(Array.from(database.objectStoreNames).sort()).toEqual(["metadata", "migration", "records"]);
      const metadata = database.transaction("metadata").objectStore("metadata");
      const records = database.transaction("records").objectStore("records");
      const migration = database.transaction("migration").objectStore("migration");
      expect(metadata.keyPath).toBeNull();
      expect(records.keyPath).toBe("logicalKey");
      expect(migration.keyPath).toBeNull();
      expect(metadata.indexNames.length + records.indexNames.length + migration.indexNames.length).toBe(0);
    } finally {
      database.close();
    }
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("metadata create rejects collisions and invalid expected revisions", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createWorkspaceVaultMetadata(metadataInput());
    await expectCode(repo.createWorkspaceVaultMetadata(metadataInput()), "CONFLICT");
    await expectCode(repo.createWorkspaceVaultMetadata(metadataInput({ expectedRevision: 1 })), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("metadata caller inputs and returned values are cloned", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  const input = metadataInput();
  try {
    const created = await repo.createWorkspaceVaultMetadata(input);
    input.salt[0] = 99;
    created.wrappedDekCiphertext[0] = 88;
    const first = await repo.readWorkspaceVaultMetadata({ workspaceTag: WORKSPACE_TAG });
    first.sentinelIv[0] = 77;
    const second = await repo.readWorkspaceVaultMetadata({ workspaceTag: WORKSPACE_TAG });
    expect(second.salt[0]).toBe(1);
    expect(second.wrappedDekCiphertext[0]).toBe(2);
    expect(second.sentinelIv[0]).toBe(5);
    expect(first.salt).not.toBe(second.salt);
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("frozen valid metadata input is accepted", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  const input = metadataInput();
  Object.freeze(input.kdfParameters);
  Object.freeze(input);
  try {
    await expect(repo.createWorkspaceVaultMetadata(input)).resolves.toEqual(expect.objectContaining({ revision: 1 }));
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("metadata read distinguishes absent database, absent metadata, and corrupt data", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await expectCode(repo.readWorkspaceVaultMetadata({ workspaceTag: WORKSPACE_TAG }), "DATABASE_NOT_FOUND");
    const database = await openDatabase(factory, vaultDatabaseName(), 1, (db) => {
      db.createObjectStore(WORKSPACE_VAULT_METADATA_STORE);
      db.createObjectStore(WORKSPACE_VAULT_RECORDS_STORE, { keyPath: "logicalKey" });
      db.createObjectStore(WORKSPACE_VAULT_MIGRATION_STORE);
    });
    database.close();
    await expect(repo.readWorkspaceVaultMetadata({ workspaceTag: WORKSPACE_TAG })).resolves.toBeNull();
    await repo.createWorkspaceVaultMetadata(metadataInput()).catch(() => {});
    const raw = await readRawMetadata(factory);
    raw.workspaceTag = OTHER_WORKSPACE_TAG;
    await writeRawMetadata(factory, raw);
    await expectCode(repo.readWorkspaceVaultMetadata({ workspaceTag: WORKSPACE_TAG }), "RECORD_CORRUPT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("metadata read rejects malformed persisted fields", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createWorkspaceVaultMetadata(metadataInput());
    const cases = [
      (value) => { value.updatedAt = "bad"; },
      (value) => { value.updatedAt = "2026-07-26T00:00:00.000Z"; value.createdAt = "2026-07-27T00:00:00.000Z"; },
      (value) => { value.revision = 0; },
      (value) => { value.kdfParameters.algorithm = "bad"; },
      (value) => { value.salt = new Uint8Array(31); },
      (value) => { value.extra = true; },
    ];
    for (const mutate of cases) {
      const raw = await readRawMetadata(factory);
      mutate(raw);
      await writeRawMetadata(factory, raw);
      await expectCode(repo.readWorkspaceVaultMetadata({ workspaceTag: WORKSPACE_TAG }), "RECORD_CORRUPT");
      await deleteFactoryDatabases(factory);
      await repo.createWorkspaceVaultMetadata(metadataInput());
    }
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("metadata replacement is monotonic and uses revision CAS", async () => {
  const factory = new IDBFactory();
  const values = [Date.parse("2026-07-27T12:00:00.000Z"), Date.parse("2026-07-27T12:00:00.000Z"), Date.parse("2026-07-27T11:00:00.000Z")];
  const repo = repository(factory, () => values.shift());
  try {
    const created = await repo.createWorkspaceVaultMetadata(metadataInput());
    const replacement = await repo.replaceWorkspaceVaultMetadata(metadataInput({ expectedRevision: 1, salt: new Uint8Array(32).fill(9) }));
    expect(replacement.revision).toBe(2);
    expect(replacement.createdAt).toBe(created.createdAt);
    expect(Date.parse(replacement.updatedAt)).toBe(Date.parse(created.updatedAt) + 1);
    await expectCode(repo.replaceWorkspaceVaultMetadata(metadataInput({ expectedRevision: 1 })), "CONFLICT");
    await expectCode(repo.replaceWorkspaceVaultMetadata(metadataInput({ expectedRevision: 0 })), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("metadata replacement returns null for an empty existing metadata store", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  let database;
  try {
    database = await openDatabase(factory, vaultDatabaseName(), 1, (db) => {
      db.createObjectStore(WORKSPACE_VAULT_METADATA_STORE);
      db.createObjectStore(WORKSPACE_VAULT_RECORDS_STORE, { keyPath: "logicalKey" });
      db.createObjectStore(WORKSPACE_VAULT_MIGRATION_STORE);
    });
    database.close();
    database = null;
    await expect(repo.replaceWorkspaceVaultMetadata(metadataInput({ expectedRevision: 1 }))).resolves.toBeNull();
  } finally {
    if (database) database.close();
    await deleteFactoryDatabases(factory);
  }
});

test("metadata validation rejects strict-shape, KDF, binary, and clock defects", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  const cases = [
    metadataInput({ unknown: true }),
    (() => { const value = metadataInput(); delete value.salt; return value; })(),
    metadataInput({ salt: undefined }),
    metadataInput({ salt: new Uint8Array(31) }),
    metadataInput({ wrappedDekCiphertext: new ArrayBuffer(48) }),
    metadataInput({ wrappedDekIv: new DataView(new ArrayBuffer(12)) }),
    metadataInput({ sentinelCiphertext: new Uint16Array(16) }),
    metadataInput({ kdfParameters: { ...metadataInput().kdfParameters, testOnly: true } }),
    metadataInput({ kdfParameters: { ...metadataInput().kdfParameters, memorySize: 1 } }),
  ];
  try {
    for (const input of cases) await expectCode(repo.createWorkspaceVaultMetadata(input), input.unknown || !Object.prototype.hasOwnProperty.call(input, "salt") ? "INVALID_INPUT" : "INVALID_SCHEMA");
    const invalidClockRepo = repository(factory, () => Number.NaN);
    await expectCode(invalidClockRepo.createWorkspaceVaultMetadata(metadataInput()), "STORAGE_OPERATION_FAILED");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["algorithm", { algorithm: "argon2" }],
  ["memory below range", { memorySize: 65535 }],
  ["memory above range", { memorySize: 131073 }],
  ["iterations below range", { iterations: 2 }],
  ["iterations above range", { iterations: 11 }],
  ["parallelism", { parallelism: 2 }],
  ["hash length", { hashLength: 31 }],
  ["output type", { outputType: "hex" }],
  ["unknown KDF field", { unknown: true }],
])("metadata create rejects invalid KDF %s", async (_, change) => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await expectCode(repo.createWorkspaceVaultMetadata(metadataInput({ kdfParameters: { ...metadataInput().kdfParameters, ...change } })), "INVALID_SCHEMA");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["salt", "salt", new Uint8Array(31)],
  ["wrapped ciphertext", "wrappedDekCiphertext", new Uint8Array(47)],
  ["wrapped IV", "wrappedDekIv", new Uint8Array(11)],
  ["sentinel ciphertext", "sentinelCiphertext", new Uint8Array(31)],
  ["sentinel IV", "sentinelIv", new Uint8Array(11)],
  ["array buffer", "salt", new ArrayBuffer(32)],
  ["data view", "salt", new DataView(new ArrayBuffer(32))],
  ["wrong typed array", "salt", new Uint16Array(16)],
  ["plain array", "salt", new Array(32).fill(1)],
])("metadata create rejects invalid binary %s", async (_, field, value) => {
  const factory = new IDBFactory();
  try {
    await expectCode(repository(factory).createWorkspaceVaultMetadata(metadataInput({ [field]: value })), "INVALID_SCHEMA");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["non-number", () => "now"],
  ["non-finite", () => Infinity],
  ["unsafe", () => Number.MAX_SAFE_INTEGER + 1],
  ["unrepresentable", () => 9_000_000_000_000_000],
])("metadata create rejects %s clock output", async (_, clock) => {
  const factory = new IDBFactory();
  try {
    await expectCode(repository(factory, clock).createWorkspaceVaultMetadata(metadataInput()), "STORAGE_OPERATION_FAILED");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("metadata input shape rejects accessors, symbols, inherited fields, non-enumerables, arrays, and null prototypes", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  const accessor = metadataInput();
  Object.defineProperty(accessor, "salt", { enumerable: true, get: () => new Uint8Array(32) });
  const symbol = metadataInput();
  symbol[Symbol("x")] = true;
  const inherited = Object.create({ inherited: true });
  Object.assign(inherited, metadataInput());
  const nonEnumerable = metadataInput();
  Object.defineProperty(nonEnumerable, "extra", { value: true });
  const nullPrototype = Object.assign(Object.create(null), metadataInput());
  try {
    for (const value of [accessor, symbol, inherited, nonEnumerable, [], nullPrototype]) {
      await expectCode(repo.createWorkspaceVaultMetadata(value), "INVALID_INPUT");
    }
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("metadata replacement detects revision overflow and preserves persisted data on conflict", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createWorkspaceVaultMetadata(metadataInput());
    const raw = await readRawMetadata(factory);
    raw.revision = Number.MAX_SAFE_INTEGER;
    await writeRawMetadata(factory, raw);
    await expectCode(repo.replaceWorkspaceVaultMetadata(metadataInput({ expectedRevision: Number.MAX_SAFE_INTEGER })), "REVISION_OVERFLOW");
    const after = await readRawMetadata(factory);
    expect(after.revision).toBe(Number.MAX_SAFE_INTEGER);
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each(Object.entries(VAULT_REPOSITORY_ERROR_CODES))("repository error %s has its exact public message", (key, code) => {
  expect(new VaultRepositoryError(code).message).toBe(ERROR_MESSAGES[key]);
});

test.each([
  ["missing KDF field", (value) => { delete value.kdfParameters.iterations; }],
  ["test-only KDF field", (value) => { value.kdfParameters.testOnly = true; }],
  ["accessor KDF field", (value) => { Object.defineProperty(value.kdfParameters, "iterations", { enumerable: true, get: () => 3 }); }],
  ["null-prototype KDF", (value) => { value.kdfParameters = Object.assign(Object.create(null), value.kdfParameters); }],
  ["fractional KDF memory", (value) => { value.kdfParameters.memorySize = 65536.5; }],
])("metadata create rejects %s", async (_, mutate) => {
  const factory = new IDBFactory();
  const value = metadataInput();
  mutate(value);
  try {
    await expectCode(repository(factory).createWorkspaceVaultMetadata(value), "INVALID_SCHEMA");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["bad timestamp", (value) => { value.createdAt = "invalid"; }],
  ["reversed timestamps", (value) => { value.createdAt = "2026-07-28T00:00:00.000Z"; value.updatedAt = "2026-07-27T00:00:00.000Z"; }],
  ["bad revision", (value) => { value.revision = Number.MAX_SAFE_INTEGER + 1; }],
  ["bad KDF", (value) => { value.kdfParameters.outputType = "text"; }],
  ["bad salt", (value) => { value.salt = new Uint8Array(1); }],
  ["unknown metadata field", (value) => { value.extra = true; }],
  ["missing metadata field", (value) => { delete value.sentinelIv; }],
])("metadata read maps persisted %s to corruption", async (_, mutate) => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createWorkspaceVaultMetadata(metadataInput());
    const raw = await readRawMetadata(factory);
    mutate(raw);
    await writeRawMetadata(factory, raw);
    await expectCode(repo.readWorkspaceVaultMetadata({ workspaceTag: WORKSPACE_TAG }), "RECORD_CORRUPT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["accessor", () => {
    const value = metadataInput();
    Object.defineProperty(value, "salt", { enumerable: true, get: () => new Uint8Array(32) });
    return value;
  }],
  ["symbol", () => {
    const value = metadataInput();
    value[Symbol("x")] = true;
    return value;
  }],
  ["inherited field", () => Object.assign(Object.create({ inherited: true }), metadataInput())],
  ["non-enumerable extra field", () => {
    const value = metadataInput();
    Object.defineProperty(value, "extra", { value: true });
    return value;
  }],
  ["array", () => []],
  ["null prototype", () => Object.assign(Object.create(null), metadataInput())],
])("metadata create rejects %s input object", async (_, makeValue) => {
  const factory = new IDBFactory();
  try {
    await expectCode(repository(factory).createWorkspaceVaultMetadata(makeValue()), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("future persisted timestamps remain valid", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory, () => Date.parse("2020-01-01T00:00:00.000Z"));
  try {
    await repo.createWorkspaceVaultMetadata(metadataInput());
    const raw = await readRawMetadata(factory);
    raw.createdAt = "2030-01-01T00:00:00.000Z";
    raw.updatedAt = "2030-01-01T00:00:00.000Z";
    await writeRawMetadata(factory, raw);
    await expect(repo.readWorkspaceVaultMetadata({ workspaceTag: WORKSPACE_TAG })).resolves.toEqual(expect.objectContaining({ createdAt: "2030-01-01T00:00:00.000Z" }));
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("incompatible existing schemas fail closed", async () => {
  const factory = new IDBFactory();
  let database;
  try {
    database = await openDatabase(factory, vaultDatabaseName(), 1, (db) => db.createObjectStore("wrong"));
    database.close();
    database = null;
    await expectCode(repository(factory).createWorkspaceVaultMetadata(metadataInput()), "DATABASE_VERSION_ERROR");
  } finally {
    if (database) database.close();
    await deleteFactoryDatabases(factory);
  }
});

test("blocked open closes a later successful database result", async () => {
  const request = {};
  const close = jest.fn();
  const factory = {
    databases: jest.fn(() => Promise.resolve([])),
    open: jest.fn(() => request),
    deleteDatabase: jest.fn(),
  };
  const pending = repository(factory).createWorkspaceVaultMetadata(metadataInput());
  const rejection = expectCode(pending, "DATABASE_BLOCKED");

  request.onblocked();
  await rejection;

  request.result = { close };
  request.onsuccess();

  expect(close).toHaveBeenCalledTimes(1);
  expect(factory.open).toHaveBeenCalledTimes(1);
});

const RECORD_KEY = "estipaid-customers-v1";
const SECOND_RECORD_KEY = "estipaid-settings-v1";
const BLOB_ID = "A".repeat(22);
const NEXT_BLOB_ID = "B".repeat(22);

function recordInput(overrides = {}) {
  return {
    workspaceTag: WORKSPACE_TAG,
    logicalKey: RECORD_KEY,
    expectedRevision: null,
    blobId: BLOB_ID,
    recordSchemaVersion: 1,
    ciphertext: new Uint8Array(16).fill(7),
    iv: new Uint8Array(12).fill(8),
    ...overrides,
  };
}

async function createRecordWorkspace(factory, clock) {
  const repo = repository(factory, clock);
  await repo.createWorkspaceVaultMetadata(metadataInput());
  return repo;
}

test("every approved logical key creates one encrypted record", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  const keys = [
    "estipaid-settings-v1", "estipaid-estimator-v1", "estipaid-estimate-draft-v1", "estipaid-estimates-v1",
    "estipaid-projects-v1", "estipaid-invoices-v1", "estipaid-pending-customer-use-v1", "estipaid-pending-customer-create-v1",
    "estipaid-pending-customer-edit-v1", "estipaid-customer-edit-target-v1", "estipaid-restore-draft-on-create-v1", "estipaid-selectedCustomerId-v1",
    "estipaid-selectedCustomerSnap-v1", "estipaid-customers-v1", "estipaid-customer-recent-v1", "estipaid-company-profile-v1",
    "estipaid-subscription-plan-state-v1", "estipaid-subscription-plan-remote-cache-v1", "estipaid-audit-events-v1", "estipaid-stripe-checkout-sessions-v1",
    "estipaid-stripe-checkout-create-locks-v1", "estipaid-scope-templates-v1", "estipaid-custom-labor-roles-v1", "estipaid-job-learning-reviewed-candidates-v1",
    "estipaid-cloud-backup-queue-v1", "estipaid-cloud-auto-backup-pause-v1", "estipaid-cloud-partial-recovery-status-v1", "estipaid-cloud-asset-bindings-v1",
    "estipaid-cloud-sync-baseline-v1", "estipaid-cloud-sync-conflict-vault-v1", "estipaid-cloud-convergence-journal-v1", "estipaid-job-learning-events-v1",
  ];
  try {
    for (const [index, logicalKey] of keys.entries()) {
      const blobId = `${String.fromCharCode(65 + (index % 26))}${"A".repeat(21)}`;
      await repo.createEncryptedRecord(recordInput({ logicalKey, blobId }));
    }
    await expect(repo.listEncryptedRecordKeys({ workspaceTag: WORKSPACE_TAG })).resolves.toEqual([...keys].sort());
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("encrypted record create and read preserve the locked schema with clones", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  const input = recordInput();
  try {
    const created = await repo.createEncryptedRecord(input);
    expect(created).toEqual(expect.objectContaining({ version: 1, logicalKey: RECORD_KEY, blobId: BLOB_ID, revision: 1, recordSchemaVersion: 1 }));
    expect(created.createdAt).toBe(created.updatedAt);
    input.ciphertext[0] = 99;
    created.iv[0] = 99;
    const first = await repo.readEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY });
    const second = await repo.readEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY });
    expect(first.ciphertext[0]).toBe(7);
    expect(second.iv[0]).toBe(8);
    expect(first).not.toBe(second);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("encrypted record create rejects collisions, absent workspaces, and invalid inputs", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await repo.createEncryptedRecord(recordInput());
    await expectCode(repo.createEncryptedRecord(recordInput()), "CONFLICT");
    await expectCode(repo.createEncryptedRecord(recordInput({ expectedRevision: 1 })), "INVALID_INPUT");
    await expectCode(repo.createEncryptedRecord(recordInput({ logicalKey: "estipaid-lang" })), "INVALID_INPUT");
    await expectCode(repo.createEncryptedRecord(recordInput({ blobId: "short" })), "INVALID_INPUT");
    await expectCode(repo.createEncryptedRecord(recordInput({ ciphertext: new Uint8Array(15) })), "INVALID_SCHEMA");
    await expectCode(repository(factory).createEncryptedRecord(recordInput({ workspaceTag: OTHER_WORKSPACE_TAG })), "DATABASE_NOT_FOUND");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("encrypted record list is sorted and exposes keys only", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expect(repo.listEncryptedRecordKeys({ workspaceTag: WORKSPACE_TAG })).resolves.toEqual([]);
    await repo.createEncryptedRecord(recordInput({ logicalKey: RECORD_KEY }));
    await repo.createEncryptedRecord(recordInput({ logicalKey: SECOND_RECORD_KEY, blobId: NEXT_BLOB_ID }));
    const keys = await repo.listEncryptedRecordKeys({ workspaceTag: WORKSPACE_TAG });
    expect(keys).toEqual([RECORD_KEY, SECOND_RECORD_KEY]);
    expect(keys.every((key) => typeof key === "string")).toBe(true);
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("encrypted record replacement uses CAS, rotates caller blobId, and preserves creation time", async () => {
  const factory = new IDBFactory();
  const ticks = [Date.parse("2026-07-27T12:00:00.000Z"), Date.parse("2026-07-27T12:00:00.000Z"), Date.parse("2026-07-27T12:00:00.000Z")];
  const repo = await createRecordWorkspace(factory, () => ticks.shift());
  try {
    const created = await repo.createEncryptedRecord(recordInput());
    const replaced = await repo.replaceEncryptedRecord(recordInput({ expectedRevision: 1, blobId: NEXT_BLOB_ID, ciphertext: new Uint8Array(16).fill(9) }));
    expect(replaced).toEqual(expect.objectContaining({ revision: 2, blobId: NEXT_BLOB_ID, createdAt: created.createdAt }));
    expect(Date.parse(replaced.updatedAt)).toBe(Date.parse(created.updatedAt) + 1);
    await expectCode(repo.replaceEncryptedRecord(recordInput({ expectedRevision: 2, blobId: NEXT_BLOB_ID })), "INVALID_INPUT");
    await expectCode(repo.replaceEncryptedRecord(recordInput({ expectedRevision: 1, blobId: "C".repeat(22) })), "CONFLICT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("encrypted record replacement and delete return null when absent", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expect(repo.replaceEncryptedRecord(recordInput({ expectedRevision: 1, blobId: NEXT_BLOB_ID }))).resolves.toBeNull();
    await expect(repo.deleteEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY, expectedRevision: 1 })).resolves.toBeNull();
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("encrypted record delete uses revision CAS and commits before returning", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await repo.createEncryptedRecord(recordInput());
    await expectCode(repo.deleteEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY, expectedRevision: 2 }), "CONFLICT");
    await expect(repo.deleteEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY, expectedRevision: 1 })).resolves.toBe(true);
    await expect(repo.readEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY })).resolves.toBeNull();
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  "estipaid-lang",
  "estipaid-device-id-v1",
  "field-pocket-language",
  "field-pocket-theme",
  "field-pocket-show-costs",
  "field-pocket-profile",
  "field-pocket-profile-v1",
  "field-pocket-customers-v1",
  "field-pocket-estimates",
  "field-pocket-invoices-v1",
  "ESTIPAID-CUSTOMERS-V1",
  "",
  1,
])("encrypted record APIs reject unallowlisted logical key %p", async (logicalKey) => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expectCode(repo.createEncryptedRecord(recordInput({ logicalKey })), "INVALID_INPUT");
    await expectCode(repo.readEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey }), "INVALID_INPUT");
    await expectCode(repo.replaceEncryptedRecord(recordInput({ logicalKey, expectedRevision: 1, blobId: NEXT_BLOB_ID })), "INVALID_INPUT");
    await expectCode(repo.deleteEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey, expectedRevision: 1 }), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["twenty-one characters", "A".repeat(21)],
  ["twenty-three characters", "A".repeat(23)],
  ["padding", `${"A".repeat(21)}=`],
  ["whitespace", `${"A".repeat(21)} `],
  ["unicode", `${"A".repeat(21)}é`],
  ["non-string", 1],
])("encrypted record create rejects invalid blob ID: %s", async (_, blobId) => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expectCode(repo.createEncryptedRecord(recordInput({ blobId })), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["too-short ciphertext", "ciphertext", new Uint8Array(15)],
  ["too-long ciphertext", "ciphertext", new Uint8Array(1048577)],
  ["wrong IV length", "iv", new Uint8Array(11)],
  ["array buffer", "ciphertext", new ArrayBuffer(16)],
  ["data view", "ciphertext", new DataView(new ArrayBuffer(16))],
  ["wrong typed array", "ciphertext", new Uint16Array(8)],
  ["plain array", "ciphertext", new Array(16).fill(0)],
])("encrypted record create rejects invalid bytes: %s", async (_, field, value) => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expectCode(repo.createEncryptedRecord(recordInput({ [field]: value })), "INVALID_SCHEMA");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("encrypted record accepts frozen input and ciphertext boundary lengths", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  const input = recordInput();
  Object.freeze(input);
  try {
    await expect(repo.createEncryptedRecord(input)).resolves.toEqual(expect.objectContaining({ ciphertext: expect.any(Uint8Array) }));
    await expect(repo.createEncryptedRecord(recordInput({ logicalKey: SECOND_RECORD_KEY, blobId: NEXT_BLOB_ID, ciphertext: new Uint8Array(1048576) }))).resolves.toEqual(expect.objectContaining({ ciphertext: expect.any(Uint8Array) }));
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["unknown field", () => recordInput({ unknown: true })],
  ["missing field", () => { const value = recordInput(); delete value.iv; return value; }],
  ["undefined field", () => recordInput({ iv: undefined })],
  ["accessor", () => { const value = recordInput(); Object.defineProperty(value, "iv", { enumerable: true, get: () => { throw new Error("must not run"); } }); return value; }],
  ["symbol", () => { const value = recordInput(); value[Symbol("x")] = true; return value; }],
  ["inherited field", () => Object.assign(Object.create({ inherited: true }), recordInput())],
  ["non-enumerable extra", () => { const value = recordInput(); Object.defineProperty(value, "extra", { value: true }); return value; }],
  ["null prototype", () => Object.assign(Object.create(null), recordInput())],
])("encrypted record create rejects strict shape: %s", async (_, makeValue) => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expectCode(repo.createEncryptedRecord(makeValue()), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("encrypted record read, list, replace, and delete enforce exact shapes", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expectCode(repo.readEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY, extra: true }), "INVALID_INPUT");
    await expectCode(repo.listEncryptedRecordKeys({ workspaceTag: WORKSPACE_TAG, extra: true }), "INVALID_INPUT");
    await expectCode(repo.replaceEncryptedRecord(recordInput({ expectedRevision: undefined, blobId: NEXT_BLOB_ID })), "INVALID_INPUT");
    await expectCode(repo.deleteEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY, expectedRevision: 1, blobId: BLOB_ID }), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["invalid blob ID", (value) => { value.blobId = "short"; }],
  ["invalid revision", (value) => { value.revision = 0; }],
  ["invalid record schema", (value) => { value.recordSchemaVersion = 2; }],
  ["invalid ciphertext", (value) => { value.ciphertext = new Uint8Array(15); }],
  ["invalid IV", (value) => { value.iv = new Uint8Array(11); }],
  ["invalid timestamp", (value) => { value.updatedAt = "bad"; }],
  ["reversed timestamps", (value) => { value.createdAt = "2026-07-28T00:00:00.000Z"; }],
  ["unknown field", (value) => { value.extra = true; }],
  ["missing field", (value) => { delete value.iv; }],
  ["invalid prototype", (value) => Object.setPrototypeOf(value, null)],
])("encrypted record read maps persisted %s to corruption", async (_, mutate) => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await repo.createEncryptedRecord(recordInput());
    const raw = await readRawRecord(factory);
    mutate(raw);
    await writeRawRecord(factory, raw);
    await expectCode(repo.readEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY }), "RECORD_CORRUPT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("encrypted record replacement detects overflow and preserves failed writes", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await repo.createEncryptedRecord(recordInput());
    const before = await repo.readEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY });
    await expectCode(repo.replaceEncryptedRecord(recordInput({ expectedRevision: 2, blobId: NEXT_BLOB_ID })), "CONFLICT");
    await expect(repo.readEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY })).resolves.toEqual(before);
    const raw = await readRawRecord(factory);
    raw.revision = Number.MAX_SAFE_INTEGER;
    await writeRawRecord(factory, raw);
    await expectCode(repo.replaceEncryptedRecord(recordInput({ expectedRevision: Number.MAX_SAFE_INTEGER, blobId: NEXT_BLOB_ID })), "REVISION_OVERFLOW");
    await expect(repo.readEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY })).resolves.toEqual(expect.objectContaining({ revision: Number.MAX_SAFE_INTEGER, blobId: BLOB_ID }));
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("encrypted record delete rejects corruption and preserves the record", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await repo.createEncryptedRecord(recordInput());
    const raw = await readRawRecord(factory);
    raw.ciphertext = new Uint8Array(15);
    await writeRawRecord(factory, raw);
    await expectCode(repo.deleteEncryptedRecord({ workspaceTag: WORKSPACE_TAG, logicalKey: RECORD_KEY, expectedRevision: 1 }), "RECORD_CORRUPT");
    await expect(readRawRecord(factory)).resolves.toEqual(expect.objectContaining({ logicalKey: RECORD_KEY }));
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

const TRANSITION_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_TRANSITION_ID = "123e4567-e89b-42d3-b456-426614174001";

function manifestInput(overrides = {}) {
  return {
    workspaceTag: WORKSPACE_TAG,
    expectedRevision: null,
    transitionId: TRANSITION_ID,
    manifestSchemaVersion: 1,
    ciphertext: new Uint8Array(16).fill(6),
    iv: new Uint8Array(12).fill(5),
    ...overrides,
  };
}

test("migration manifest create and read preserve the strict envelope with clones", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  const input = manifestInput();
  try {
    const created = await repo.createMigrationManifest(input);
    expect(created).toEqual(expect.objectContaining({ version: 1, transitionId: TRANSITION_ID, revision: 1, manifestSchemaVersion: 1 }));
    expect(created.createdAt).toBe(created.updatedAt);
    input.ciphertext[0] = 99;
    created.iv[0] = 99;
    const first = await repo.readMigrationManifest({ workspaceTag: WORKSPACE_TAG });
    const second = await repo.readMigrationManifest({ workspaceTag: WORKSPACE_TAG });
    expect(first.ciphertext[0]).toBe(6);
    expect(second.iv[0]).toBe(5);
    expect(first).not.toBe(second);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("migration manifest create rejects collisions, absent workspaces, and invalid expected revisions", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await repo.createMigrationManifest(manifestInput());
    await expectCode(repo.createMigrationManifest(manifestInput()), "CONFLICT");
    await expectCode(repo.createMigrationManifest(manifestInput({ expectedRevision: 1 })), "INVALID_INPUT");
    await expectCode(repository(factory).createMigrationManifest(manifestInput({ workspaceTag: OTHER_WORKSPACE_TAG })), "DATABASE_NOT_FOUND");
    await expect(repo.readMigrationManifest({ workspaceTag: WORKSPACE_TAG })).resolves.toEqual(expect.objectContaining({ transitionId: TRANSITION_ID }));
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("migration manifest read returns null for an empty existing migration store", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expect(repo.readMigrationManifest({ workspaceTag: WORKSPACE_TAG })).resolves.toBeNull();
    await expectCode(repo.readMigrationManifest({ workspaceTag: OTHER_WORKSPACE_TAG }), "DATABASE_NOT_FOUND");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("migration manifest replacement uses ordered CAS and keeps the transition ID", async () => {
  const factory = new IDBFactory();
  const ticks = [Date.parse("2026-07-27T12:00:00.000Z"), Date.parse("2026-07-27T12:00:00.000Z"), Date.parse("2026-07-27T11:00:00.000Z")];
  const repo = await createRecordWorkspace(factory, () => ticks.shift());
  try {
    const created = await repo.createMigrationManifest(manifestInput());
    const replaced = await repo.replaceMigrationManifest(manifestInput({ expectedRevision: 1, ciphertext: new Uint8Array(16).fill(4) }));
    expect(replaced).toEqual(expect.objectContaining({ transitionId: TRANSITION_ID, revision: 2, createdAt: created.createdAt }));
    expect(Date.parse(replaced.updatedAt)).toBe(Date.parse(created.updatedAt) + 1);
    await expectCode(repo.replaceMigrationManifest(manifestInput({ expectedRevision: 2, transitionId: OTHER_TRANSITION_ID })), "CONFLICT");
    await expectCode(repo.replaceMigrationManifest(manifestInput({ expectedRevision: 1 })), "CONFLICT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("migration manifest replacement handles absence, overflow, and preserves failed writes", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expect(repo.replaceMigrationManifest(manifestInput({ expectedRevision: 1 }))).resolves.toBeNull();
    await repo.createMigrationManifest(manifestInput());
    const raw = await readRawManifest(factory);
    raw.revision = Number.MAX_SAFE_INTEGER;
    await writeRawManifest(factory, raw);
    await expectCode(repo.replaceMigrationManifest(manifestInput({ expectedRevision: Number.MAX_SAFE_INTEGER })), "REVISION_OVERFLOW");
    await expect(repo.readMigrationManifest({ workspaceTag: WORKSPACE_TAG })).resolves.toEqual(expect.objectContaining({ revision: Number.MAX_SAFE_INTEGER, transitionId: TRANSITION_ID }));
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("migration manifest deletion uses CAS and never deletes corruption", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expect(repo.deleteMigrationManifest({ workspaceTag: WORKSPACE_TAG, expectedRevision: 1 })).resolves.toBeNull();
    await repo.createMigrationManifest(manifestInput());
    await expectCode(repo.deleteMigrationManifest({ workspaceTag: WORKSPACE_TAG, expectedRevision: 2 }), "CONFLICT");
    const raw = await readRawManifest(factory);
    raw.ciphertext = new Uint8Array(15);
    await writeRawManifest(factory, raw);
    await expectCode(repo.deleteMigrationManifest({ workspaceTag: WORKSPACE_TAG, expectedRevision: 1 }), "RECORD_CORRUPT");
    await expect(readRawManifest(factory)).resolves.toEqual(expect.objectContaining({ transitionId: TRANSITION_ID }));
    raw.ciphertext = new Uint8Array(16).fill(6);
    await writeRawManifest(factory, raw);
    await expect(repo.deleteMigrationManifest({ workspaceTag: WORKSPACE_TAG, expectedRevision: 1 })).resolves.toBe(true);
    await expect(repo.readMigrationManifest({ workspaceTag: WORKSPACE_TAG })).resolves.toBeNull();
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["uppercase", TRANSITION_ID.toUpperCase()],
  ["UUIDv1", "123e4567-e89b-12d3-a456-426614174000"],
  ["UUIDv3", "123e4567-e89b-32d3-a456-426614174000"],
  ["UUIDv5", "123e4567-e89b-52d3-a456-426614174000"],
  ["nil", "00000000-0000-0000-0000-000000000000"],
  ["missing hyphens", "123e4567e89b42d3a456426614174000"],
  ["braced", `{${TRANSITION_ID}}`],
  ["whitespace", ` ${TRANSITION_ID}`],
  ["non-string", 1],
])("migration manifest create rejects invalid transition ID: %s", async (_, transitionId) => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expectCode(repo.createMigrationManifest(manifestInput({ transitionId })), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["too-short ciphertext", "ciphertext", new Uint8Array(15)],
  ["too-long ciphertext", "ciphertext", new Uint8Array(1048577)],
  ["wrong IV length", "iv", new Uint8Array(11)],
  ["array buffer", "ciphertext", new ArrayBuffer(16)],
  ["data view", "ciphertext", new DataView(new ArrayBuffer(16))],
  ["wrong typed array", "ciphertext", new Uint16Array(8)],
  ["plain array", "ciphertext", new Array(16).fill(0)],
])("migration manifest create rejects invalid bytes: %s", async (_, field, value) => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expectCode(repo.createMigrationManifest(manifestInput({ [field]: value })), "INVALID_SCHEMA");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("migration manifest accepts frozen input and ciphertext boundary lengths", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  const input = manifestInput();
  Object.freeze(input);
  try {
    await expect(repo.createMigrationManifest(input)).resolves.toEqual(expect.objectContaining({ ciphertext: expect.any(Uint8Array) }));
    await expect(repo.replaceMigrationManifest(manifestInput({ expectedRevision: 1, ciphertext: new Uint8Array(1048576) }))).resolves.toEqual(expect.objectContaining({ ciphertext: expect.any(Uint8Array) }));
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["unknown field", () => manifestInput({ unknown: true })],
  ["missing field", () => { const value = manifestInput(); delete value.iv; return value; }],
  ["undefined field", () => manifestInput({ iv: undefined })],
  ["accessor", () => { const value = manifestInput(); Object.defineProperty(value, "iv", { enumerable: true, get: () => { throw new Error("must not run"); } }); return value; }],
  ["symbol", () => { const value = manifestInput(); value[Symbol("x")] = true; return value; }],
  ["inherited field", () => Object.assign(Object.create({ inherited: true }), manifestInput())],
  ["non-enumerable extra", () => { const value = manifestInput(); Object.defineProperty(value, "extra", { value: true }); return value; }],
  ["null prototype", () => Object.assign(Object.create(null), manifestInput())],
])("migration manifest create rejects strict shape: %s", async (_, makeValue) => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expectCode(repo.createMigrationManifest(makeValue()), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("migration manifest read, replace, and delete enforce exact shapes", async () => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await expectCode(repo.readMigrationManifest({ workspaceTag: WORKSPACE_TAG, extra: true }), "INVALID_INPUT");
    await expectCode(repo.replaceMigrationManifest(manifestInput({ expectedRevision: undefined })), "INVALID_INPUT");
    await expectCode(repo.deleteMigrationManifest({ workspaceTag: WORKSPACE_TAG, expectedRevision: 1, transitionId: TRANSITION_ID }), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["invalid transition ID", (value) => { value.transitionId = "bad"; }],
  ["invalid revision", (value) => { value.revision = 0; }],
  ["invalid schema", (value) => { value.manifestSchemaVersion = 2; }],
  ["invalid ciphertext", (value) => { value.ciphertext = new Uint8Array(15); }],
  ["invalid IV", (value) => { value.iv = new Uint8Array(11); }],
  ["invalid timestamp", (value) => { value.updatedAt = "bad"; }],
  ["reversed timestamps", (value) => { value.createdAt = "2026-07-28T00:00:00.000Z"; }],
  ["workspace tag field", (value) => { value.workspaceTag = WORKSPACE_TAG; }],
  ["unknown field", (value) => { value.extra = true; }],
  ["missing field", (value) => { delete value.iv; }],
  ["invalid prototype", (value) => Object.setPrototypeOf(value, null)],
])("migration manifest read maps persisted %s to corruption", async (_, mutate) => {
  const factory = new IDBFactory();
  const repo = await createRecordWorkspace(factory);
  try {
    await repo.createMigrationManifest(manifestInput());
    const raw = await readRawManifest(factory);
    mutate(raw);
    await writeRawManifest(factory, raw);
    await expectCode(repo.readMigrationManifest({ workspaceTag: WORKSPACE_TAG }), "RECORD_CORRUPT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});
