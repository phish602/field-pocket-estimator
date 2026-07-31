import {
  IDBDatabase,
  IDBFactory,
  IDBObjectStore,
} from "fake-indexeddb";
import * as transitionModule from "./vaultTransitionControlRepository";
import {
  VAULT_REPOSITORY_ERROR_CODES,
} from "./vaultIndexedDbRepository";

const {
  VAULT_TRANSITION_CONTROL_DATABASE_NAME,
  VAULT_TRANSITION_CONTROL_DATABASE_VERSION,
  VAULT_TRANSITION_CONTROL_STORE,
  VAULT_TRANSITION_CONTROL_ACTIVE_KEY,
  createVaultTransitionControlRepository,
} = transitionModule;

const TRANSITION_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_TRANSITION_ID = "123e4567-e89b-42d3-b456-426614174001";
const WORKSPACE_TAG = "A".repeat(43);
const OTHER_WORKSPACE_TAG = "B".repeat(43);
const originalStructuredClone = globalThis.structuredClone;
const ERROR_MESSAGES = {
  INVALID_INPUT: "Invalid vault request.",
  UNSUPPORTED_ENVIRONMENT: "Secure local storage is unavailable.",
  DATABASE_NOT_FOUND: "Vault storage was not found.",
  DATABASE_BLOCKED: "Vault storage is busy.",
  DATABASE_VERSION_ERROR: "Vault storage version is unavailable.",
  TRANSACTION_ABORTED: "Vault storage operation did not complete.",
  CONFLICT: "Vault data changed. Retry required.",
  RECORD_CORRUPT: "Vault storage could not be verified.",
  QUOTA_EXCEEDED: "Secure local storage is full.",
  STORAGE_OPERATION_FAILED: "Vault storage operation failed.",
};

beforeAll(() => {
  globalThis.structuredClone = (value) => value;
});

afterAll(() => {
  if (originalStructuredClone === undefined) delete globalThis.structuredClone;
  else globalThis.structuredClone = originalStructuredClone;
});

function repository(factory, clock = () => Date.parse("2026-07-27T12:00:00.000Z")) {
  return createVaultTransitionControlRepository({ indexedDB: factory, clock });
}

function createInput(overrides = {}) {
  return { transitionId: TRANSITION_ID, workspaceTag: WORKSPACE_TAG, ...overrides };
}

function advanceInput(overrides = {}) {
  return { transitionId: TRANSITION_ID, workspaceTag: WORKSPACE_TAG, expectedPhase: "prepared", nextPhase: "guarded", ...overrides };
}

function deleteInput(overrides = {}) {
  return { transitionId: TRANSITION_ID, workspaceTag: WORKSPACE_TAG, expectedPhase: "authoritative", ...overrides };
}

function expectCode(promise, code) {
  return expect(promise).rejects.toEqual(expect.objectContaining({ name: "VaultRepositoryError", code, message: ERROR_MESSAGES[code] }));
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

function openDatabase(factory, name = VAULT_TRANSITION_CONTROL_DATABASE_NAME, version = VAULT_TRANSITION_CONTROL_DATABASE_VERSION, upgrade) {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, version);
    request.onupgradeneeded = () => upgrade?.(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("blocked"));
  });
}

async function deleteFactoryDatabases(factory) {
  const databases = await factory.databases();
  await Promise.all(databases.map((entry) => new Promise((resolve, reject) => {
    const request = factory.deleteDatabase(entry.name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  })));
}

async function readRaw(factory) {
  const database = await openDatabase(factory);
  try {
    return await requestResult(database.transaction(VAULT_TRANSITION_CONTROL_STORE).objectStore(VAULT_TRANSITION_CONTROL_STORE).get(VAULT_TRANSITION_CONTROL_ACTIVE_KEY));
  } finally {
    database.close();
  }
}

async function writeRaw(factory, value) {
  const database = await openDatabase(factory);
  try {
    const transaction = database.transaction(VAULT_TRANSITION_CONTROL_STORE, "readwrite");
    const completed = transactionComplete(transaction);
    transaction.objectStore(VAULT_TRANSITION_CONTROL_STORE).put(value, VAULT_TRANSITION_CONTROL_ACTIVE_KEY);
    await completed;
  } finally {
    database.close();
  }
}

function failedRequest(errorName = "UnknownError") {
  let onerror;
  const request = { error: { name: errorName } };
  Object.defineProperty(request, "onerror", {
    configurable: true,
    set(callback) {
      onerror = callback;
      queueMicrotask(() => onerror?.());
    },
  });
  return request;
}

function failNextObjectStoreRequest(method, errorName) {
  return jest.spyOn(IDBObjectStore.prototype, method).mockImplementation(() => failedRequest(errorName));
}

function abortNextWriteTransaction() {
  const original = IDBDatabase.prototype.transaction;
  let armed = true;
  return jest.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function transaction(...args) {
    const transaction = original.apply(this, args);
    if (armed && args[1] === "readwrite") {
      armed = false;
      queueMicrotask(() => {
        try { transaction.abort(); } catch (_) {}
      });
    }
    return transaction;
  });
}

function failNextWriteTransaction() {
  const original = IDBDatabase.prototype.transaction;
  let armed = true;
  return jest.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function transaction(...args) {
    const transaction = original.apply(this, args);
    if (armed && args[1] === "readwrite") {
      armed = false;
      queueMicrotask(() => transaction.onerror?.());
    }
    return transaction;
  });
}

function deferNextWriteTransactionCompletion() {
  const original = IDBDatabase.prototype.transaction;
  let armed = true;
  let release;
  let completeSeen;
  const completed = new Promise((resolve) => { completeSeen = resolve; });
  const spy = jest.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function transaction(...args) {
    const nativeTransaction = original.apply(this, args);
    if (!armed || args[1] !== "readwrite") return nativeTransaction;
    armed = false;
    return new Proxy(nativeTransaction, {
      get(target, property) {
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
      set(target, property, value) {
        if (property === "oncomplete") {
          target.oncomplete = (...event) => {
            release = () => value(...event);
            completeSeen();
          };
          return true;
        }
        return Reflect.set(target, property, value, target);
      },
    });
  });
  return { completed, release: () => release(), restore: () => spy.mockRestore() };
}

test("module exports and repository surface are exact", () => {
  expect(Object.keys(transitionModule).sort()).toEqual([
    "VAULT_TRANSITION_CONTROL_ACTIVE_KEY",
    "VAULT_TRANSITION_CONTROL_DATABASE_NAME",
    "VAULT_TRANSITION_CONTROL_DATABASE_VERSION",
    "VAULT_TRANSITION_CONTROL_STORE",
    "createVaultTransitionControlRepository",
  ]);
  expect(Object.keys(repository(new IDBFactory())).sort()).toEqual([
    "advanceActiveTransition",
    "createActiveTransition",
    "deleteActiveTransition",
    "readActiveTransition",
  ]);
});

test.each([
  ["missing constructor", undefined, "INVALID_INPUT"],
  ["missing databases", { indexedDB: { open() {} }, clock: Date.now }, "UNSUPPORTED_ENVIRONMENT"],
  ["missing open", { indexedDB: { databases() {} }, clock: Date.now }, "UNSUPPORTED_ENVIRONMENT"],
  ["invalid clock", { indexedDB: new IDBFactory(), clock: "now" }, "INVALID_INPUT"],
  ["unknown field", { indexedDB: new IDBFactory(), clock: Date.now, extra: true }, "INVALID_INPUT"],
  ["null prototype", Object.assign(Object.create(null), { indexedDB: new IDBFactory(), clock: Date.now }), "INVALID_INPUT"],
])("constructor rejects %s", (_, options, code) => {
  expect(() => createVaultTransitionControlRepository(options)).toThrow(expect.objectContaining({ code }));
});

test("first create builds the exact singleton schema", async () => {
  const factory = new IDBFactory();
  try {
    const created = await repository(factory).createActiveTransition(createInput());
    expect(created).toEqual({ version: 1, transitionId: TRANSITION_ID, workspaceTag: WORKSPACE_TAG, phase: "prepared", createdAt: created.createdAt, updatedAt: created.updatedAt });
    expect(created.createdAt).toBe(created.updatedAt);
    expect(await readRaw(factory)).toEqual(created);
    const database = await openDatabase(factory);
    try {
      expect(Array.from(database.objectStoreNames)).toEqual([VAULT_TRANSITION_CONTROL_STORE]);
      const store = database.transaction(VAULT_TRANSITION_CONTROL_STORE).objectStore(VAULT_TRANSITION_CONTROL_STORE);
      expect(store.keyPath).toBeNull();
      expect(store.autoIncrement).toBe(false);
      expect(store.indexNames.length).toBe(0);
    } finally {
      database.close();
    }
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("create enforces singleton semantics and validates existing corruption", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createActiveTransition(createInput());
    await expectCode(repo.createActiveTransition(createInput()), "CONFLICT");
    const raw = await readRaw(factory);
    raw.phase = "bad";
    await writeRaw(factory, raw);
    await expectCode(repo.createActiveTransition(createInput()), "RECORD_CORRUPT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("read returns null without creating a database and returns independent records", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await expect(repo.readActiveTransition({})).resolves.toBeNull();
    expect(await factory.databases()).toEqual([]);
    await repo.createActiveTransition(createInput());
    const first = await repo.readActiveTransition({});
    const second = await repo.readActiveTransition({});
    first.phase = "bad";
    expect(second).not.toBe(first);
    expect((await repo.readActiveTransition({})).phase).toBe("prepared");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["unknown field", (value) => { value.extra = true; }],
  ["missing field", (value) => { delete value.phase; }],
  ["bad transition ID", (value) => { value.transitionId = "bad"; }],
  ["bad workspace tag", (value) => { value.workspaceTag = "bad"; }],
  ["bad phase", (value) => { value.phase = "bad"; }],
  ["bad timestamp", (value) => { value.updatedAt = "bad"; }],
  ["reversed timestamps", (value) => { value.createdAt = "2026-07-28T00:00:00.000Z"; }],
  ["invalid prototype", (value) => Object.setPrototypeOf(value, null)],
])("read maps persisted %s to corruption", async (_, mutate) => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createActiveTransition(createInput());
    const raw = await readRaw(factory);
    mutate(raw);
    await writeRaw(factory, raw);
    await expectCode(repo.readActiveTransition({}), "RECORD_CORRUPT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("phase machine permits only ordered monotonic advances", async () => {
  const factory = new IDBFactory();
  const ticks = Array(6).fill(Date.parse("2026-07-27T12:00:00.000Z"));
  const repo = repository(factory, () => ticks.shift());
  try {
    const created = await repo.createActiveTransition(createInput());
    const guarded = await repo.advanceActiveTransition(advanceInput());
    expect(guarded).toEqual(expect.objectContaining({ phase: "guarded", createdAt: created.createdAt }));
    expect(Date.parse(guarded.updatedAt)).toBe(Date.parse(created.updatedAt) + 1);
    await expectCode(repo.advanceActiveTransition(advanceInput({ expectedPhase: "guarded", nextPhase: "verifying" })), "INVALID_INPUT");
    let current = guarded;
    for (const [expectedPhase, nextPhase] of [["guarded", "copying"], ["copying", "verifying"], ["verifying", "cleaning"], ["cleaning", "authoritative"]]) {
      current = await repo.advanceActiveTransition(advanceInput({ expectedPhase, nextPhase }));
      expect(current).toEqual(expect.objectContaining({ phase: nextPhase, transitionId: TRANSITION_ID, workspaceTag: WORKSPACE_TAG, createdAt: created.createdAt }));
    }
    expect(current.phase).toBe("authoritative");
    await expectCode(repo.advanceActiveTransition(advanceInput({ expectedPhase: "authoritative", nextPhase: "authoritative" })), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("advance rejects missing transitions and detects identity, phase, and corruption conflicts", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await expectCode(repo.advanceActiveTransition(advanceInput()), "DATABASE_NOT_FOUND");
    expect(await factory.databases()).toEqual([]);
    await repo.createActiveTransition(createInput());
    await expectCode(repo.advanceActiveTransition(advanceInput({ transitionId: OTHER_TRANSITION_ID })), "CONFLICT");
    await expectCode(repo.advanceActiveTransition(advanceInput({ workspaceTag: OTHER_WORKSPACE_TAG })), "CONFLICT");
    await expectCode(repo.advanceActiveTransition(advanceInput({ expectedPhase: "guarded", nextPhase: "copying" })), "CONFLICT");
    const raw = await readRaw(factory);
    raw.phase = "bad";
    await writeRaw(factory, raw);
    await expectCode(repo.advanceActiveTransition(advanceInput({ transitionId: OTHER_TRANSITION_ID })), "RECORD_CORRUPT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("delete requires authoritative phase and removes only the active record", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await expectCode(repo.deleteActiveTransition(deleteInput()), "DATABASE_NOT_FOUND");
    await repo.createActiveTransition(createInput());
    for (const phase of ["prepared", "guarded", "copying", "verifying", "cleaning"]) {
      await expectCode(repo.deleteActiveTransition(deleteInput()), "CONFLICT");
      if (phase !== "cleaning") {
        const next = { prepared: "guarded", guarded: "copying", copying: "verifying", verifying: "cleaning" }[phase];
        await repo.advanceActiveTransition(advanceInput({ expectedPhase: phase, nextPhase: next }));
      }
    }
    await expectCode(repo.deleteActiveTransition(deleteInput({ expectedPhase: "cleaning" })), "INVALID_INPUT");
    await repo.advanceActiveTransition(advanceInput({ expectedPhase: "cleaning", nextPhase: "authoritative" }));
    await expect(repo.deleteActiveTransition(deleteInput())).resolves.toBe(true);
    await expect(repo.readActiveTransition({})).resolves.toBeNull();
    expect((await factory.databases()).some((entry) => entry.name === VAULT_TRANSITION_CONTROL_DATABASE_NAME)).toBe(true);
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("phase machine rejects every skipped, backward, and repeated advancement", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  const phases = ["prepared", "guarded", "copying", "verifying", "cleaning", "authoritative"];
  try {
    await repo.createActiveTransition(createInput());
    for (let currentIndex = 0; currentIndex < phases.length - 1; currentIndex += 1) {
      const current = phases[currentIndex];
      const validNext = phases[currentIndex + 1];
      for (const invalidNext of phases.filter((phase, index) => index !== currentIndex + 1)) {
        await expectCode(repo.advanceActiveTransition(advanceInput({ expectedPhase: current, nextPhase: invalidNext })), "INVALID_INPUT");
      }
      await repo.advanceActiveTransition(advanceInput({ expectedPhase: current, nextPhase: validNext }));
      await expectCode(repo.advanceActiveTransition(advanceInput({ expectedPhase: current, nextPhase: validNext })), "CONFLICT");
    }
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("repository instances share one device-global active transition and no workspace vault database", async () => {
  const factory = new IDBFactory();
  const first = repository(factory);
  const second = repository(factory);
  try {
    const created = await first.createActiveTransition(createInput());
    expect(await second.readActiveTransition({})).toEqual(created);
    expect((await factory.databases()).map((entry) => entry.name)).toEqual([VAULT_TRANSITION_CONTROL_DATABASE_NAME]);
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("read fails closed when its IndexedDB request fails", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createActiveTransition(createInput());
    const spy = failNextObjectStoreRequest("get");
    await expectCode(repo.readActiveTransition({}), "STORAGE_OPERATION_FAILED");
    spy.mockRestore();
    await expect(repo.readActiveTransition({})).resolves.toEqual(expect.objectContaining({ phase: "prepared" }));
  } finally {
    jest.restoreAllMocks();
    await deleteFactoryDatabases(factory);
  }
});

test("create request failure leaves no active transition", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    const spy = failNextObjectStoreRequest("get");
    await expectCode(repo.createActiveTransition(createInput()), "STORAGE_OPERATION_FAILED");
    spy.mockRestore();
    await expect(repo.readActiveTransition({})).resolves.toBeNull();
  } finally {
    jest.restoreAllMocks();
    await deleteFactoryDatabases(factory);
  }
});

test("advance read and write request failures preserve the prepared transition", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createActiveTransition(createInput());
    let spy = failNextObjectStoreRequest("get");
    await expectCode(repo.advanceActiveTransition(advanceInput()), "STORAGE_OPERATION_FAILED");
    spy.mockRestore();
    expect((await repo.readActiveTransition({})).phase).toBe("prepared");
    spy = failNextObjectStoreRequest("put");
    await expectCode(repo.advanceActiveTransition(advanceInput()), "STORAGE_OPERATION_FAILED");
    spy.mockRestore();
    expect((await repo.readActiveTransition({})).phase).toBe("prepared");
  } finally {
    jest.restoreAllMocks();
    await deleteFactoryDatabases(factory);
  }
});

test("delete request failure preserves the authoritative transition", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createActiveTransition(createInput());
    for (const [expectedPhase, nextPhase] of [["prepared", "guarded"], ["guarded", "copying"], ["copying", "verifying"], ["verifying", "cleaning"], ["cleaning", "authoritative"]]) {
      await repo.advanceActiveTransition(advanceInput({ expectedPhase, nextPhase }));
    }
    const spy = failNextObjectStoreRequest("get");
    await expectCode(repo.deleteActiveTransition(deleteInput()), "STORAGE_OPERATION_FAILED");
    spy.mockRestore();
    expect((await repo.readActiveTransition({})).phase).toBe("authoritative");
  } finally {
    jest.restoreAllMocks();
    await deleteFactoryDatabases(factory);
  }
});

test("transaction abort during create leaves no active transition", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    const spy = abortNextWriteTransaction();
    await expectCode(repo.createActiveTransition(createInput()), "TRANSACTION_ABORTED");
    spy.mockRestore();
    await expect(repo.readActiveTransition({})).resolves.toBeNull();
  } finally {
    jest.restoreAllMocks();
    await deleteFactoryDatabases(factory);
  }
});

test("transaction abort during advance preserves the prepared transition", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createActiveTransition(createInput());
    const spy = abortNextWriteTransaction();
    await expectCode(repo.advanceActiveTransition(advanceInput()), "TRANSACTION_ABORTED");
    spy.mockRestore();
    expect((await repo.readActiveTransition({})).phase).toBe("prepared");
  } finally {
    jest.restoreAllMocks();
    await deleteFactoryDatabases(factory);
  }
});

test("transaction abort during delete preserves the authoritative transition", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    await repo.createActiveTransition(createInput());
    for (const [expectedPhase, nextPhase] of [["prepared", "guarded"], ["guarded", "copying"], ["copying", "verifying"], ["verifying", "cleaning"], ["cleaning", "authoritative"]]) {
      await repo.advanceActiveTransition(advanceInput({ expectedPhase, nextPhase }));
    }
    const spy = abortNextWriteTransaction();
    await expectCode(repo.deleteActiveTransition(deleteInput()), "TRANSACTION_ABORTED");
    spy.mockRestore();
    expect((await repo.readActiveTransition({})).phase).toBe("authoritative");
  } finally {
    jest.restoreAllMocks();
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["create", async (repo) => repo.createActiveTransition(createInput())],
  ["advance", async (repo) => repo.advanceActiveTransition(advanceInput())],
  ["delete", async (repo) => repo.deleteActiveTransition(deleteInput())],
])("transaction error during %s fails closed", async (operation, run) => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  try {
    if (operation !== "create") {
      await repo.createActiveTransition(createInput());
      if (operation === "delete") {
        for (const [expectedPhase, nextPhase] of [["prepared", "guarded"], ["guarded", "copying"], ["copying", "verifying"], ["verifying", "cleaning"], ["cleaning", "authoritative"]]) {
          await repo.advanceActiveTransition(advanceInput({ expectedPhase, nextPhase }));
        }
      }
    }
    const spy = failNextWriteTransaction();
    await expectCode(run(repo), "TRANSACTION_ABORTED");
    spy.mockRestore();
    const active = await repo.readActiveTransition({});
    expect(active?.phase ?? null).toBe(operation === "create" ? null : operation === "advance" ? "prepared" : "authoritative");
  } finally {
    jest.restoreAllMocks();
    await deleteFactoryDatabases(factory);
  }
});

test("a write reports success only after its IndexedDB transaction completes", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  const control = deferNextWriteTransactionCompletion();
  try {
    let settled = false;
    const pending = repo.createActiveTransition(createInput()).then((result) => {
      settled = true;
      return result;
    });
    await control.completed;
    expect(settled).toBe(false);
    control.release();
    await expect(pending).resolves.toEqual(expect.objectContaining({ phase: "prepared" }));
  } finally {
    control.restore();
    await deleteFactoryDatabases(factory);
  }
});

test("open and upgrade failures are normalized without creating an active record", async () => {
  const openErrorFactory = {
    databases: jest.fn(() => Promise.resolve([])),
    open: jest.fn(() => { throw { name: "UnknownError" }; }),
  };
  await expectCode(repository(openErrorFactory).createActiveTransition(createInput()), "STORAGE_OPERATION_FAILED");

  const request = {};
  const upgradeErrorFactory = { databases: jest.fn(() => Promise.resolve([])), open: jest.fn(() => request) };
  const pending = repository(upgradeErrorFactory).createActiveTransition(createInput());
  request.result = { createObjectStore: jest.fn(() => { throw { name: "UnknownError" }; }), close: jest.fn() };
  request.transaction = { abort: jest.fn() };
  request.onupgradeneeded({ oldVersion: 0 });
  request.onerror();
  await expectCode(pending, "STORAGE_OPERATION_FAILED");
  expect(request.transaction.abort).toHaveBeenCalledTimes(1);
  expect(request.result.close).toHaveBeenCalled();
});

test.each([
  ["uppercase UUID", "transitionId", TRANSITION_ID.toUpperCase()],
  ["UUIDv1", "transitionId", "123e4567-e89b-12d3-a456-426614174000"],
  ["UUIDv5", "transitionId", "123e4567-e89b-52d3-a456-426614174000"],
  ["nil UUID", "transitionId", "00000000-0000-0000-0000-000000000000"],
  ["missing UUID hyphens", "transitionId", "123e4567e89b42d3a456426614174000"],
  ["short workspace", "workspaceTag", "A".repeat(42)],
  ["long workspace", "workspaceTag", "A".repeat(44)],
  ["padded workspace", "workspaceTag", `${"A".repeat(42)}=`],
  ["unicode workspace", "workspaceTag", `${"A".repeat(42)}é`],
  ["non-string workspace", "workspaceTag", 1],
])("create rejects invalid identifier: %s", async (_, field, value) => {
  const factory = new IDBFactory();
  try {
    await expectCode(repository(factory).createActiveTransition(createInput({ [field]: value })), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test.each([
  ["unknown", () => createInput({ extra: true })],
  ["missing", () => ({ transitionId: TRANSITION_ID })],
  ["undefined", () => createInput({ workspaceTag: undefined })],
  ["accessor", () => { const value = createInput(); Object.defineProperty(value, "workspaceTag", { enumerable: true, get: () => { throw new Error("must not run"); } }); return value; }],
  ["symbol", () => { const value = createInput(); value[Symbol("x")] = true; return value; }],
  ["inherited", () => Object.assign(Object.create({ inherited: true }), createInput())],
  ["non-enumerable", () => { const value = createInput(); Object.defineProperty(value, "extra", { value: true }); return value; }],
  ["null prototype", () => Object.assign(Object.create(null), createInput())],
])("create rejects strict shape: %s", async (_, makeValue) => {
  const factory = new IDBFactory();
  try {
    await expectCode(repository(factory).createActiveTransition(makeValue()), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("read, advance, and delete enforce strict inputs while frozen valid input is accepted", async () => {
  const factory = new IDBFactory();
  const repo = repository(factory);
  const input = createInput();
  Object.freeze(input);
  try {
    await expect(repo.createActiveTransition(input)).resolves.toEqual(expect.objectContaining({ phase: "prepared" }));
    await expectCode(repo.readActiveTransition({ extra: true }), "INVALID_INPUT");
    await expectCode(repo.advanceActiveTransition(advanceInput({ nextPhase: undefined })), "INVALID_INPUT");
    await expectCode(repo.deleteActiveTransition(deleteInput({ transitionId: undefined })), "INVALID_INPUT");
  } finally {
    await deleteFactoryDatabases(factory);
  }
});

test("blocked open closes a late successful database result", async () => {
  const request = {};
  const close = jest.fn();
  const factory = { databases: jest.fn(() => Promise.resolve([])), open: jest.fn(() => request) };
  const pending = createVaultTransitionControlRepository({ indexedDB: factory, clock: Date.now }).createActiveTransition(createInput());
  request.onblocked();
  await expectCode(pending, "DATABASE_BLOCKED");
  request.result = { close };
  request.onsuccess();
  expect(close).toHaveBeenCalledTimes(1);
});
