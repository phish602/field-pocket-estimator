import {
  forceCloseDatabase,
  IDBFactory,
  IDBKeyRange,
} from "fake-indexeddb";

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
