import {
  VaultRepositoryError,
  VAULT_REPOSITORY_ERROR_CODES,
} from "./vaultIndexedDbRepository";
import { setTestArgon2Adapter, workspaceTag } from "./vaultCrypto";
import * as session from "./vaultSession";

const userId = "11111111-2222-4333-8444-555555555555";
const companyId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const salt = new Uint8Array(32).fill(4);

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
  const repository = {
    workspaceDatabaseExists: jest.fn(async ({ workspaceTag: tag }) => databases.has(tag)),
    readWorkspaceVaultMetadata: jest.fn(async ({ workspaceTag: tag }) => clone(metadata.get(tag) || null)),
    listEncryptedRecordKeys: jest.fn(async ({ workspaceTag: tag }) => [...(records.get(tag) || new Set())]),
    readMigrationManifest: jest.fn(async ({ workspaceTag: tag }) => manifests.get(tag) || null),
    createWorkspaceVaultMetadata: jest.fn(async (value) => {
      databases.add(value.workspaceTag);
      if (metadata.has(value.workspaceTag)) throw new VaultRepositoryError(VAULT_REPOSITORY_ERROR_CODES.CONFLICT);
      const stored = {
        ...clone(value),
        version: 1,
        revision: 1,
        createdAt: "2026-08-03T20:00:00.000Z",
        updatedAt: "2026-08-03T20:00:00.000Z",
      };
      metadata.set(value.workspaceTag, stored);
      return clone(stored);
    }),
  };
  return { repository, metadata };
}

async function generateKey() {
  return globalThis.crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function deviceStore(initialKey = null) {
  let key = initialKey;
  return {
    read: jest.fn(async () => key),
    getOrCreate: jest.fn(async () => {
      if (!key) key = await generateKey();
      return key;
    }),
    remove: jest.fn(async () => { key = null; return true; }),
  };
}

function overrides(store, keys) {
  return {
    repositoryFactory: () => store.repository,
    deviceKeyStoreFactory: () => keys,
    randomBytes: () => salt.slice(),
  };
}

test("passwordless setup creates metadata and unlocks without running Argon2", async () => {
  const store = memoryRepository();
  const keys = deviceStore();
  const restore = setTestArgon2Adapter(async () => { throw new Error("Argon2 must not run"); });
  try {
    await expect(session.setupVault({ userId, companyId }, overrides(store, keys))).resolves.toEqual({
      state: "unlocked", code: "", message: "",
    });
  } finally {
    restore();
  }

  const tag = await workspaceTag(userId, companyId);
  expect(keys.getOrCreate).toHaveBeenCalledWith({ workspaceTag: tag });
  expect(store.repository.createWorkspaceVaultMetadata).toHaveBeenCalledTimes(1);
  expect(store.metadata.get(tag).wrappedDekCiphertext).toHaveLength(48);
  expect(store.metadata.get(tag).sentinelCiphertext).toHaveLength(32);
});

test("the persisted device key reopens the exact workspace with no password", async () => {
  const store = memoryRepository();
  const keys = deviceStore();
  await session.setupVault({ userId, companyId }, overrides(store, keys));
  session.lockVault();

  await expect(session.unlockVault({ userId, companyId }, overrides(store, keys))).resolves.toEqual({
    state: "unlocked", code: "", message: "",
  });
  expect(keys.read).toHaveBeenCalledWith({ workspaceTag: await workspaceTag(userId, companyId) });
});

test("missing device key fails closed with recovery required", async () => {
  const store = memoryRepository();
  const setupKeys = deviceStore();
  await session.setupVault({ userId, companyId }, overrides(store, setupKeys));
  session.lockVault();

  const missingKeys = deviceStore(null);
  missingKeys.read.mockResolvedValue(null);
  await expect(session.unlockVault({ userId, companyId }, overrides(store, missingKeys))).resolves.toEqual(
    expect.objectContaining({ state: "reset_required", code: "DEVICE_KEY_MISSING" })
  );
  expect(session.getVaultCapability().state).toBe("locked");
});

test("a different device key cannot open the vault and never falls back to plaintext", async () => {
  const store = memoryRepository();
  const setupKeys = deviceStore();
  await session.setupVault({ userId, companyId }, overrides(store, setupKeys));
  session.lockVault();

  const wrongKeys = deviceStore(await generateKey());
  await expect(session.unlockVault({ userId, companyId }, overrides(store, wrongKeys))).resolves.toEqual(
    expect.objectContaining({ state: "reset_required", code: "DEVICE_KEY_MISMATCH" })
  );
  expect(session.getVaultCapability().state).toBe("locked");
});
