import {
  VAULT_RUNTIME_ERROR_CODES,
  initializeEmptyRecoveryRuntimeCatalog,
} from "./vaultRuntimeStore";
import {
  VaultRepositoryError,
  VAULT_REPOSITORY_ERROR_CODES,
} from "./vaultIndexedDbRepository";
import * as session from "./vaultSession";

const USER_ID =
  "11111111-2222-4333-8444-555555555555";

const COMPANY_ID =
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const NOW = "2026-08-04T00:00:00.000Z";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    globalThis.crypto =
      require("crypto").webcrypto;
  }
});

beforeEach(() => {
  session.lockVault();
});

afterEach(() => {
  session.lockVault();
});

function cloneBytes(value) {
  return value instanceof Uint8Array
    ? value.slice()
    : value;
}

function cloneMetadata(value) {
  if (!value) return null;

  return {
    ...value,
    salt: cloneBytes(value.salt),
    wrappedDekCiphertext:
      cloneBytes(value.wrappedDekCiphertext),
    wrappedDekIv:
      cloneBytes(value.wrappedDekIv),
    sentinelCiphertext:
      cloneBytes(value.sentinelCiphertext),
    sentinelIv:
      cloneBytes(value.sentinelIv),
    kdfParameters: value.kdfParameters
      ? { ...value.kdfParameters }
      : value.kdfParameters,
  };
}

function cloneCatalog(value) {
  if (!value) return null;

  return {
    ...value,
    ciphertext: cloneBytes(value.ciphertext),
    iv: cloneBytes(value.iv),
  };
}

function memoryRepository() {
  const databases = new Set();
  const metadata = new Map();
  const records = new Map();

  let runtimeCatalog = null;
  let migrationManifest = null;

  const repository = {
    workspaceDatabaseExists: jest.fn(
      async ({ workspaceTag }) => (
        databases.has(workspaceTag)
      )
    ),

    readWorkspaceVaultMetadata: jest.fn(
      async ({ workspaceTag }) => (
        cloneMetadata(
          metadata.get(workspaceTag) || null
        )
      )
    ),

    createWorkspaceVaultMetadata: jest.fn(
      async (value) => {
        databases.add(value.workspaceTag);

        if (metadata.has(value.workspaceTag)) {
          throw new VaultRepositoryError(
            VAULT_REPOSITORY_ERROR_CODES.CONFLICT
          );
        }

        const stored = {
          ...cloneMetadata(value),
          version: 1,
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
        };

        metadata.set(
          value.workspaceTag,
          stored
        );

        return cloneMetadata(stored);
      }
    ),

    readRuntimeCatalog: jest.fn(
      async () => cloneCatalog(runtimeCatalog)
    ),

    createRuntimeCatalog: jest.fn(
      async (value) => {
        if (runtimeCatalog) {
          throw new VaultRepositoryError(
            VAULT_REPOSITORY_ERROR_CODES.CONFLICT
          );
        }

        runtimeCatalog = {
          ...cloneCatalog(value),
          version: 1,
          revision: 1,
          createdAt: NOW,
          updatedAt: NOW,
        };

        return cloneCatalog(runtimeCatalog);
      }
    ),

    listEncryptedRecordKeys: jest.fn(
      async () => [...records.keys()]
    ),

    readMigrationManifest: jest.fn(
      async () => migrationManifest
    ),
  };

  return {
    repository,

    addRecord(logicalKey) {
      records.set(logicalKey, true);
    },

    setMigrationManifest(value) {
      migrationManifest = value;
    },

    readStoredCatalog() {
      return cloneCatalog(runtimeCatalog);
    },
  };
}

async function generateDeviceKey() {
  return globalThis.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    false,
    ["encrypt", "decrypt"]
  );
}

function deviceKeyStore() {
  let key = null;

  return {
    read: jest.fn(async () => key),

    getOrCreate: jest.fn(async () => {
      if (!key) {
        key = await generateDeviceKey();
      }

      return key;
    }),

    remove: jest.fn(async () => {
      key = null;
      return true;
    }),
  };
}

async function setupReplacementVault(store) {
  const keys = deviceKeyStore();

  const result = await session.setupVault(
    {
      userId: USER_ID,
      companyId: COMPANY_ID,
    },
    {
      repositoryFactory: () =>
        store.repository,

      deviceKeyStoreFactory: () => keys,

      randomBytes: () =>
        new Uint8Array(32).fill(7),
    }
  );

  expect(result).toEqual({
    state: "unlocked",
    code: "",
    message: "",
  });

  return keys;
}

function authoritativeGuard() {
  return {
    state: "authoritative",
    code: "",
    message: "",
  };
}

test(
  "creates the first empty encrypted runtime catalog",
  async () => {
    const store = memoryRepository();

    await setupReplacementVault(store);

    const result =
      await initializeEmptyRecoveryRuntimeCatalog({
        userId: USER_ID,
        companyId: COMPANY_ID,
        repository: store.repository,
        readGuard: authoritativeGuard,
      });

    expect(result).toEqual({
      ok: true,
      state: "recovery-initialized",
      code: "",
      entryCount: 0,
      generation: 0,
    });

    const stored = store.readStoredCatalog();

    expect(stored).toEqual(
      expect.objectContaining({
        runtimeGeneration: 1,
        runtimeSchemaVersion: 1,
        revision: 1,
      })
    );

    expect(stored.ciphertext).toBeInstanceOf(
      Uint8Array
    );

    expect(stored.iv).toBeInstanceOf(
      Uint8Array
    );

    expect(
      store.repository.createRuntimeCatalog
    ).toHaveBeenCalledTimes(1);
  }
);

test(
  "accepts an exact previously initialized empty catalog",
  async () => {
    const store = memoryRepository();

    await setupReplacementVault(store);

    await initializeEmptyRecoveryRuntimeCatalog({
      userId: USER_ID,
      companyId: COMPANY_ID,
      repository: store.repository,
      readGuard: authoritativeGuard,
    });

    const result =
      await initializeEmptyRecoveryRuntimeCatalog({
        userId: USER_ID,
        companyId: COMPANY_ID,
        repository: store.repository,
        readGuard: authoritativeGuard,
      });

    expect(result).toEqual({
      ok: true,
      state: "already-initialized",
      code: "",
      entryCount: 0,
      generation: 0,
    });

    expect(
      store.repository.createRuntimeCatalog
    ).toHaveBeenCalledTimes(1);
  }
);

test(
  "refuses bootstrap unless the device guard remains authoritative",
  async () => {
    const store = memoryRepository();

    await setupReplacementVault(store);

    const result =
      await initializeEmptyRecoveryRuntimeCatalog({
        userId: USER_ID,
        companyId: COMPANY_ID,
        repository: store.repository,
        readGuard: () => ({
          state: "absent",
          code: "",
          message: "",
        }),
      });

    expect(result.code).toBe(
      VAULT_RUNTIME_ERROR_CODES
        .RECOVERY_BOOTSTRAP_INVALID
    );

    expect(
      store.repository.createRuntimeCatalog
    ).not.toHaveBeenCalled();
  }
);

test(
  "refuses to bless an existing migration manifest",
  async () => {
    const store = memoryRepository();

    await setupReplacementVault(store);

    store.setMigrationManifest({
      version: 1,
      state: "completed",
    });

    const result =
      await initializeEmptyRecoveryRuntimeCatalog({
        userId: USER_ID,
        companyId: COMPANY_ID,
        repository: store.repository,
        readGuard: authoritativeGuard,
      });

    expect(result.code).toBe(
      VAULT_RUNTIME_ERROR_CODES
        .RECOVERY_BOOTSTRAP_INVALID
    );

    expect(
      store.repository.createRuntimeCatalog
    ).not.toHaveBeenCalled();
  }
);

test(
  "refuses to bless any pre-existing encrypted business record",
  async () => {
    const store = memoryRepository();

    await setupReplacementVault(store);

    store.addRecord(
      "estipaid-customers-v1"
    );

    const result =
      await initializeEmptyRecoveryRuntimeCatalog({
        userId: USER_ID,
        companyId: COMPANY_ID,
        repository: store.repository,
        readGuard: authoritativeGuard,
      });

    expect(result.code).toBe(
      VAULT_RUNTIME_ERROR_CODES
        .RECOVERY_BOOTSTRAP_INVALID
    );

    expect(
      store.repository.createRuntimeCatalog
    ).not.toHaveBeenCalled();
  }
);
