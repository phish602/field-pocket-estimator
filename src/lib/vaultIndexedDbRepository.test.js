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
    "createWorkspaceVaultMetadata",
    "readWorkspaceVaultMetadata",
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
