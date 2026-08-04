import {
  VAULT_REPOSITORY_ERROR_CODES,
  VaultRepositoryError,
} from "./vaultIndexedDbRepository";
import {
  VaultCryptoErrorCode,
  setTestArgon2Adapter,
  workspaceTag,
} from "./vaultCrypto";
import * as session from "./vaultSession";

const userA = "11111111-2222-4333-8444-555555555555";
const companyA = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const userB = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const companyB = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const PASSWORD = "local-data-password";
const salt = new Uint8Array(32).fill(7);

beforeAll(() => {
  if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto;
});
beforeEach(() => session.lockVault());
afterEach(() => session.lockVault());

const clone = (value) => value && {
  ...value,
  kdfParameters: value.kdfParameters && { ...value.kdfParameters },
  salt: value.salt && value.salt.slice(),
  wrappedDekCiphertext: value.wrappedDekCiphertext && value.wrappedDekCiphertext.slice(),
  wrappedDekIv: value.wrappedDekIv && value.wrappedDekIv.slice(),
  sentinelCiphertext: value.sentinelCiphertext && value.sentinelCiphertext.slice(),
  sentinelIv: value.sentinelIv && value.sentinelIv.slice(),
};

function memoryRepository() {
  const databases = new Set();
  const metadata = new Map();
  const records = new Map();
  const manifests = new Map();
  const writes = { metadata: 0, records: 0, manifests: 0 };
  const repository = {
    workspaceDatabaseExists: jest.fn(async ({ workspaceTag: tag }) => databases.has(tag)),
    readWorkspaceVaultMetadata: jest.fn(async ({ workspaceTag: tag }) => clone(metadata.get(tag) || null)),
    listEncryptedRecordKeys: jest.fn(async ({ workspaceTag: tag }) => [...(records.get(tag) || new Set())].sort()),
    readMigrationManifest: jest.fn(async ({ workspaceTag: tag }) => manifests.get(tag) ? { version: 1 } : null),
    createWorkspaceVaultMetadata: jest.fn(async (value) => {
      databases.add(value.workspaceTag);
      if (metadata.has(value.workspaceTag)) throw new VaultRepositoryError(VAULT_REPOSITORY_ERROR_CODES.CONFLICT);
      writes.metadata += 1;
      const stored = { ...clone(value), version: 1, revision: 1, createdAt: "2026-07-31T12:00:00.000Z", updatedAt: "2026-07-31T12:00:00.000Z" };
      metadata.set(value.workspaceTag, stored);
      return clone(stored);
    }),
  };
  return { repository, databases, metadata, records, manifests, writes };
}

function overrides(store, extra = {}) {
  return { repositoryFactory: () => store.repository, randomBytes: () => salt.slice(), ...extra };
}

async function fastKdf(callback, capture = null) {
  const restore = setTestArgon2Adapter(async (input) => {
    if (capture) capture.push(input.password);
    return new Uint8Array(32).fill(input.password.reduce((total, byte) => (total + byte) % 256, 0));
  });
  try { return await callback(); } finally { restore(); }
}

test("exports exactly the eight non-secret vault-session operations", () => {
  expect(Object.keys(session).sort()).toEqual([
    "deriveWorkspaceVaultTag",
    "getVaultCapability",
    "lockVault",
    "provisionReplacementVaultSession",
    "readVaultCapability",
    "runWithActiveVaultDek",
    "setupVault",
    "unlockVault",
  ]);
});

test("active DEK handoff is exact-workspace scoped and never returns a key", async () => {
  const store = memoryRepository();
  await fastKdf(() => session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store)));
  const tag = await workspaceTag(userA, companyA);
  await expect(session.runWithActiveVaultDek({ workspaceTag: "wrong", operation: jest.fn() })).resolves.toBeNull();
  await expect(session.runWithActiveVaultDek({ workspaceTag: tag, operation: (dek) => ({ type: dek.type, extractable: dek.extractable }) }))
    .resolves.toEqual({ type: "secret", extractable: false });
  expect(await session.runWithActiveVaultDek({ workspaceTag: tag })).toBeNull();
});

test("workspace tag delegates to the completed crypto contract and hides identity from capability", async () => {
  const store = memoryRepository();
  expect(await session.deriveWorkspaceVaultTag(userA, companyA)).toBe(await workspaceTag(userA, companyA));
  await expect(session.deriveWorkspaceVaultTag("invalid", companyA)).rejects.toMatchObject({ code: VaultCryptoErrorCode.INVALID_INPUT });
  const result = await session.readVaultCapability({ userId: userA, companyId: companyA }, overrides(store));
  expect(result).toEqual({ state: "setup_required", code: "", message: "" });
  expect(JSON.stringify(result)).not.toContain(userA);
  expect(JSON.stringify(result)).not.toContain(companyA);
});

test.each([
  ["no database", (store, tag) => {}],
  ["an empty database without metadata", (store, tag) => store.databases.add(tag)],
])("%s is safely setup_required", async (_, prepare) => {
  const store = memoryRepository(); const tag = await workspaceTag(userA, companyA);
  prepare(store, tag);
  await expect(session.readVaultCapability({ userId: userA, companyId: companyA }, overrides(store))).resolves.toMatchObject({ state: "setup_required" });
});

test.each([
  ["encrypted records", (store, tag) => { store.databases.add(tag); store.records.set(tag, new Set(["estipaid-customers-v1"])); }],
  ["a migration manifest", (store, tag) => { store.databases.add(tag); store.manifests.set(tag, true); }],
])("missing metadata with %s is damaged", async (_, prepare) => {
  const store = memoryRepository(); const tag = await workspaceTag(userA, companyA);
  prepare(store, tag);
  await expect(session.readVaultCapability({ userId: userA, companyId: companyA }, overrides(store))).resolves.toEqual({ state: "damaged", code: "RECORD_CORRUPT", message: "The local vault is damaged." });
});

test("malformed metadata is damaged before any decrypt or password work", async () => {
  const repository = {
    workspaceDatabaseExists: jest.fn(async () => true),
    readWorkspaceVaultMetadata: jest.fn(async () => { throw new VaultRepositoryError(VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT); }),
    listEncryptedRecordKeys: jest.fn(), readMigrationManifest: jest.fn(),
  };
  const result = await session.unlockVault({ userId: userA, companyId: companyA, password: PASSWORD }, { repositoryFactory: () => repository });
  expect(result).toEqual({ state: "damaged", code: "RECORD_CORRUPT", message: "The local vault is damaged." });
  expect(repository.listEncryptedRecordKeys).not.toHaveBeenCalled();
});

test("setup uses a deterministic 32-byte salt, Production KDF, correct AAD, read-back verification, and returns only capability", async () => {
  const store = memoryRepository();
  await fastKdf(async () => {
    const result = await session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store));
    const tag = await workspaceTag(userA, companyA);
    const metadata = store.metadata.get(tag);
    expect(result).toEqual({ state: "unlocked", code: "", message: "" });
    expect(metadata.salt).toEqual(salt);
    expect(metadata.kdfParameters).toEqual({ algorithm: "argon2id", memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: "binary" });
    expect(metadata.wrappedDekCiphertext).toHaveLength(48);
    expect(metadata.wrappedDekIv).toHaveLength(12);
    expect(metadata.sentinelIv).toHaveLength(12);
    expect(store.repository.createWorkspaceVaultMetadata).toHaveBeenCalledTimes(1);
    expect(store.repository.readWorkspaceVaultMetadata).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain(PASSWORD);
    expect(JSON.stringify(result)).not.toContain("CryptoKey");
  });
});

test("existing valid metadata is locked, duplicate setup is conflict, and existing data is never overwritten", async () => {
  const store = memoryRepository();
  await fastKdf(async () => {
    await session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store));
    const tag = await workspaceTag(userA, companyA); const before = clone(store.metadata.get(tag));
    session.lockVault();
    await expect(session.readVaultCapability({ userId: userA, companyId: companyA }, overrides(store))).resolves.toMatchObject({ state: "locked" });
    await expect(session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store))).resolves.toMatchObject({ state: "locked", code: "CONFLICT" });
    expect(store.metadata.get(tag)).toEqual(before);
  });
});

test("successful unlock is single-workspace and session replacement drops the previous workspace", async () => {
  const store = memoryRepository();
  await fastKdf(async () => {
    await session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store));
    await session.setupVault({ userId: userB, companyId: companyB, password: PASSWORD }, overrides(store));
    session.lockVault();
    await expect(session.unlockVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store))).resolves.toMatchObject({ state: "unlocked" });
    await expect(session.unlockVault({ userId: userB, companyId: companyB, password: PASSWORD }, overrides(store))).resolves.toMatchObject({ state: "unlocked" });
    await expect(session.readVaultCapability({ userId: userA, companyId: companyA }, overrides(store))).resolves.toMatchObject({ state: "locked" });
    expect(session.getVaultCapability()).toEqual({ state: "unlocked", code: "", message: "" });
  });
});

async function initializedStore() {
  const store = memoryRepository();
  await fastKdf(() => session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store)));
  session.lockVault();
  return store;
}

test.each([
  ["wrong password", async (store) => session.unlockVault({ userId: userA, companyId: companyA, password: "incorrect" }, overrides(store))],
  ["tampered wrapped DEK ciphertext", async (store, metadata) => { metadata.wrappedDekCiphertext[0] ^= 1; return session.unlockVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store)); }],
  ["tampered wrapped DEK IV", async (store, metadata) => { metadata.wrappedDekIv[0] ^= 1; return session.unlockVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store)); }],
  ["tampered sentinel ciphertext", async (store, metadata) => { metadata.sentinelCiphertext[0] ^= 1; return session.unlockVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store)); }],
  ["tampered sentinel IV", async (store, metadata) => { metadata.sentinelIv[0] ^= 1; return session.unlockVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store)); }],
])("%s produces one indistinguishable authentication failure", async (_, attempt) => {
  await fastKdf(async () => {
    const store = await initializedStore(); const metadata = store.metadata.get(await workspaceTag(userA, companyA));
    await expect(attempt(store, metadata)).resolves.toEqual({ state: "locked", code: "AUTHENTICATION_FAILED", message: "The Local Data Password is incorrect or the local vault is damaged." });
  });
});

test.each([
  ["unsupported environment", VAULT_REPOSITORY_ERROR_CODES.UNSUPPORTED_ENVIRONMENT, "unsupported"],
  ["database blocked", VAULT_REPOSITORY_ERROR_CODES.DATABASE_BLOCKED, "locked"],
  ["quota", VAULT_REPOSITORY_ERROR_CODES.QUOTA_EXCEEDED, "locked"],
  ["storage failure", VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED, "locked"],
  ["transaction abort", VAULT_REPOSITORY_ERROR_CODES.TRANSACTION_ABORTED, "locked"],
])("%s remains distinct from authentication", async (_, code, state) => {
  const repository = { workspaceDatabaseExists: async () => { throw new VaultRepositoryError(code); } };
  await expect(session.readVaultCapability({ userId: userA, companyId: companyA }, { repositoryFactory: () => repository })).resolves.toMatchObject({ state, code });
});

test("KDF initialization failure remains distinct from authentication", async () => {
  const store = await initializedStore();
  const restore = setTestArgon2Adapter(async () => { throw new Error("KDF unavailable"); });
  try {
    await expect(session.unlockVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store))).resolves.toMatchObject({ state: "locked", code: "CRYPTO_OPERATION_FAILED" });
  } finally { restore(); }
});

test.each([
  ["successful setup", async (store) => session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store))],
  ["authentication failure", async (store) => { await session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store)); session.lockVault(); return session.unlockVault({ userId: userA, companyId: companyA, password: "wrong" }, overrides(store)); }],
  ["repository failure", async (store) => { store.repository.createWorkspaceVaultMetadata = async () => { throw new VaultRepositoryError(VAULT_REPOSITORY_ERROR_CODES.QUOTA_EXCEEDED); }; return session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store)); }],
])("password byte buffers are zeroed after %s", async (_, operation) => {
  const captured = []; const store = memoryRepository();
  await fastKdf(() => operation(store), captured);
  expect(captured.length).toBeGreaterThan(0);
  captured.forEach((bytes) => expect([...bytes].every((byte) => byte === 0)).toBe(true));
});

test("lockVault is synchronous, idempotent, non-writing, and capability objects cannot mutate session state", async () => {
  const store = memoryRepository();
  await fastKdf(async () => {
    await session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store));
    const writes = store.repository.createWorkspaceVaultMetadata.mock.calls.length;
    expect(session.lockVault()).toEqual({ state: "locked", code: "", message: "" });
    expect(session.lockVault()).toEqual({ state: "locked", code: "", message: "" });
    const publicState = session.getVaultCapability();
    expect(Object.isFrozen(publicState)).toBe(true);
    try { publicState.state = "unlocked"; } catch (_) {}
    expect(session.getVaultCapability()).toEqual({ state: "locked", code: "", message: "" });
    expect(store.repository.createWorkspaceVaultMetadata).toHaveBeenCalledTimes(writes);
  });
});

test("runtime never uses browser storage, events, messaging, network, or transition control", async () => {
  const store = memoryRepository(); const forbidden = jest.fn(() => { throw new Error("forbidden"); });
  const oldFetch = globalThis.fetch; const oldPostMessage = globalThis.postMessage;
  globalThis.fetch = forbidden; globalThis.postMessage = forbidden;
  try {
    await fastKdf(async () => {
      await session.setupVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store));
      session.lockVault(); await session.unlockVault({ userId: userA, companyId: companyA, password: PASSWORD }, overrides(store)); session.lockVault();
      expect(forbidden).not.toHaveBeenCalled();
      expect(store.writes).toEqual({ metadata: 1, records: 0, manifests: 0 });
    });
  } finally {
    if (oldFetch === undefined) delete globalThis.fetch; else globalThis.fetch = oldFetch;
    if (oldPostMessage === undefined) delete globalThis.postMessage; else globalThis.postMessage = oldPostMessage;
  }
});
