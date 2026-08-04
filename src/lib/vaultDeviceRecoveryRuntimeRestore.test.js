import { IDBFactory } from "fake-indexeddb";
import {
  createVaultIndexedDbRepository,
} from "./vaultIndexedDbRepository";
import {
  compileVaultDeviceRecoveryRestoreSnapshot,
} from "./vaultDeviceRecoveryRestoreSnapshot";
import {
  VAULT_RUNTIME_ERROR_CODES,
  beginVaultRuntimeActivation,
  commitVaultDeviceRecoveryRestoreSnapshot,
  describeVaultRuntime,
  flushVaultRuntime,
  getVaultRuntimeStatus,
  hydrateVaultRuntime,
  initializeEmptyRecoveryRuntimeCatalog,
  isVaultRuntimeFrozen,
  revokeVaultRuntime,
  runtimeGetItem,
  runtimeLogicalKeys,
  runtimeSetItem,
} from "./vaultRuntimeStore";
import * as session from "./vaultSession";

const USER_ID =
  "11111111-2222-4333-8444-555555555555";

const COMPANY_ID =
  "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const originalStructuredClone =
  globalThis.structuredClone;

let repository;
let keyStore;

beforeAll(() => {
  if (!globalThis.crypto?.subtle) {
    globalThis.crypto =
      require("crypto").webcrypto;
  }

  globalThis.structuredClone = (value) => {
    if (value instanceof Uint8Array) {
      return value.slice();
    }

    if (value instanceof ArrayBuffer) {
      return value.slice(0);
    }

    if (Array.isArray(value)) {
      return value.map(
        (entry) =>
          globalThis.structuredClone(entry)
      );
    }

    if (
      value
      && typeof value === "object"
      && Object.getPrototypeOf(value)
        === Object.prototype
    ) {
      const clone = {};

      Object.keys(value).forEach((key) => {
        clone[key] =
          globalThis.structuredClone(
            value[key]
          );
      });

      return clone;
    }

    return value;
  };
});

afterAll(() => {
  if (originalStructuredClone === undefined) {
    delete globalThis.structuredClone;
  } else {
    globalThis.structuredClone =
      originalStructuredClone;
  }
});

beforeEach(() => {
  revokeVaultRuntime();
  session.lockVault();

  globalThis.indexedDB = new IDBFactory();

  repository =
    createVaultIndexedDbRepository({
      indexedDB: globalThis.indexedDB,
      clock: Date.now,
    });

  keyStore = createMemoryDeviceKeyStore();
});

afterEach(() => {
  revokeVaultRuntime();
  session.lockVault();
});

function createMemoryDeviceKeyStore() {
  let key = null;

  return {
    read: jest.fn(async () => key),

    getOrCreate: jest.fn(async () => {
      if (!key) {
        key =
          await globalThis.crypto.subtle
            .generateKey(
              {
                name: "AES-GCM",
                length: 256,
              },
              false,
              [
                "encrypt",
                "decrypt",
              ]
            );
      }

      return key;
    }),

    remove: jest.fn(async () => {
      key = null;
      return true;
    }),
  };
}

function cloudSnapshot(overrides = {}) {
  return {
    ok: true,
    status: "ready",
    noWritesPerformed: true,
    mapped: {
      customers: [
        {
          id: "customer-1",
          fullName: "Synthetic Customer",
        },
      ],
      projects: [
        {
          id: "project-1",
          customerId: "customer-1",
          projectName: "Synthetic Project",
        },
      ],
      estimates: [
        {
          id: "estimate-1",
          total: 125,
        },
      ],
      invoices: [
        {
          id: "invoice-1",
          invoiceTotal: 125,
        },
      ],
      companyProfile: {
        companyName: "Synthetic Company",
      },
      settings: {
        language: "en",
      },
      scopeTemplates: [
        {
          id: "template-1",
          name: "Synthetic Template",
        },
      ],
    },
    ...overrides,
  };
}

function compiledSnapshot() {
  const result =
    compileVaultDeviceRecoveryRestoreSnapshot({
      cloudSnapshot: cloudSnapshot(),
    });

  expect(result.state).toBe("ready");

  return result;
}

async function createReplacementRuntime(
  runtimeRepository = repository
) {
  const setup =
    await session.setupVault(
      {
        userId: USER_ID,
        companyId: COMPANY_ID,
      },
      {
        repositoryFactory:
          () => repository,
        deviceKeyStoreFactory:
          () => keyStore,
        randomBytes:
          () => new Uint8Array(32).fill(7),
      }
    );

  expect(setup.state).toBe("unlocked");

  const initialized =
    await initializeEmptyRecoveryRuntimeCatalog({
      userId: USER_ID,
      companyId: COMPANY_ID,
      repository,
      readGuard: () => ({
        state: "authoritative",
        code: "",
        message: "",
      }),
    });

  expect(initialized.ok).toBe(true);

  const activation =
    beginVaultRuntimeActivation();

  const hydrated =
    await hydrateVaultRuntime({
      userId: USER_ID,
      companyId: COMPANY_ID,
      repository: runtimeRepository,
      activation,
    });

  expect(hydrated).toMatchObject({
    ok: true,
    state: "ready",
    entryCount: 0,
  });
}

function wrappedRepository(overrides = {}) {
  return Object.freeze({
    ...repository,
    ...overrides,
  });
}

test(
  "encrypts, commits, publishes, and rehydrates the complete snapshot",
  async () => {
    await createReplacementRuntime();

    const snapshot = compiledSnapshot();

    const result =
      await commitVaultDeviceRecoveryRestoreSnapshot({
        userId: USER_ID,
        companyId: COMPANY_ID,
        snapshot,
      });

    expect(result).toEqual({
      ok: true,
      state: "restored",
      code: "",
      committed: true,
      entryCount: snapshot.entryCount,
      generation: expect.any(Number),
    });

    expect(result.generation).toBeGreaterThan(0);

    expect(describeVaultRuntime()).toMatchObject({
      active: true,
      catalogRevision: 2,
      entryCount: snapshot.entryCount,
      pending: 0,
      blocked: false,
    });

    expect(runtimeLogicalKeys().sort()).toEqual(
      snapshot.entries
        .map((entry) => entry.logicalKey)
        .sort()
    );

    snapshot.entries.forEach((entry) => {
      expect(
        runtimeGetItem(entry.logicalKey)
      ).toBe(entry.value);
    });

    const workspaceTag =
      await session.deriveWorkspaceVaultTag(
        USER_ID,
        COMPANY_ID
      );

    expect(
      await repository.listEncryptedRecordKeys({
        workspaceTag,
      })
    ).toEqual(
      snapshot.entries
        .map((entry) => entry.logicalKey)
        .sort()
    );

    expect(
      (
        await repository.readRuntimeCatalog({
          workspaceTag,
        })
      ).revision
    ).toBe(2);

    revokeVaultRuntime();

    const activation =
      beginVaultRuntimeActivation();

    const rehydrated =
      await hydrateVaultRuntime({
        userId: USER_ID,
        companyId: COMPANY_ID,
        repository,
        activation,
      });

    expect(rehydrated).toMatchObject({
      ok: true,
      state: "ready",
      entryCount: snapshot.entryCount,
    });

    snapshot.entries.forEach((entry) => {
      expect(
        runtimeGetItem(entry.logicalKey)
      ).toBe(entry.value);
    });
  }
);

test(
  "freezes ordinary runtime mutations until the atomic transaction completes",
  async () => {
    let entered;
    let release;

    const transactionEntered =
      new Promise((resolve) => {
        entered = resolve;
      });

    const transactionRelease =
      new Promise((resolve) => {
        release = resolve;
      });

    const originalCommit =
      repository.commitRuntimeRestoreBatch;

    const runtimeRepository =
      wrappedRepository({
        commitRuntimeRestoreBatch:
          jest.fn(async (input) => {
            entered();
            await transactionRelease;
            return originalCommit(input);
          }),
      });

    await createReplacementRuntime(
      runtimeRepository
    );

    const pending =
      commitVaultDeviceRecoveryRestoreSnapshot({
        userId: USER_ID,
        companyId: COMPANY_ID,
        snapshot: compiledSnapshot(),
      });

    await transactionEntered;

    expect(isVaultRuntimeFrozen()).toBe(true);

    expect(
      runtimeSetItem(
        "estipaid-customers-v1",
        "must-not-enter"
      )
    ).toBe(false);

    expect(
      runtimeGetItem(
        "estipaid-customers-v1"
      )
    ).toBeNull();

    release();

    const result = await pending;

    expect(result.state).toBe("restored");
    expect(isVaultRuntimeFrozen()).toBe(false);
    expect(getVaultRuntimeStatus().state)
      .toBe("ready");
  }
);

test(
  "a failed repository transaction leaves the empty runtime ready for retry",
  async () => {
    const runtimeRepository =
      wrappedRepository({
        commitRuntimeRestoreBatch:
          jest.fn(async () => {
            const error = new Error(
              "synthetic transaction failure"
            );

            error.code =
              "TRANSACTION_ABORTED";

            throw error;
          }),
      });

    await createReplacementRuntime(
      runtimeRepository
    );

    const result =
      await commitVaultDeviceRecoveryRestoreSnapshot({
        userId: USER_ID,
        companyId: COMPANY_ID,
        snapshot: compiledSnapshot(),
      });

    expect(result).toEqual({
      ok: false,
      state: "blocked",
      code:
        VAULT_RUNTIME_ERROR_CODES
          .DURABILITY_FAILED,
      committed: false,
      entryCount: 0,
      generation: 0,
    });

    expect(isVaultRuntimeFrozen()).toBe(false);
    expect(runtimeLogicalKeys()).toEqual([]);

    expect(describeVaultRuntime()).toMatchObject({
      active: true,
      catalogRevision: 1,
      entryCount: 0,
      blocked: false,
    });
  }
);

test(
  "rejects forged or mutable snapshot objects before encryption",
  async () => {
    await createReplacementRuntime();

    const valid = compiledSnapshot();

    const forged = {
      ...valid,
      entries: valid.entries,
    };

    const result =
      await commitVaultDeviceRecoveryRestoreSnapshot({
        userId: USER_ID,
        companyId: COMPANY_ID,
        snapshot: forged,
      });

    expect(result.code).toBe(
      VAULT_RUNTIME_ERROR_CODES
        .RECOVERY_RESTORE_INVALID
    );

    expect(runtimeLogicalKeys()).toEqual([]);
    expect(describeVaultRuntime().catalogRevision)
      .toBe(1);
  }
);

test(
  "rejects copied, cloned, and JSON-round-tripped compiler snapshots",
  async () => {
    await createReplacementRuntime();
    const compiled = compiledSnapshot();
    const variants = [
      Object.freeze({ ...compiled, entries: compiled.entries }),
      globalThis.structuredClone(compiled),
      JSON.parse(JSON.stringify(compiled)),
    ];

    for (const candidate of variants) {
      const result = await commitVaultDeviceRecoveryRestoreSnapshot({
        userId: USER_ID,
        companyId: COMPANY_ID,
        snapshot: candidate,
      });
      expect(result.code).toBe(
        VAULT_RUNTIME_ERROR_CODES.RECOVERY_RESTORE_INVALID
      );
    }
  }
);

test(
  "rejects a different authenticated identity",
  async () => {
    await createReplacementRuntime();

    const result =
      await commitVaultDeviceRecoveryRestoreSnapshot({
        userId:
          "99999999-2222-4333-8444-555555555555",
        companyId: COMPANY_ID,
        snapshot: compiledSnapshot(),
      });

    expect(result.code).toBe(
      VAULT_RUNTIME_ERROR_CODES.NOT_READY
    );

    expect(runtimeLogicalKeys()).toEqual([]);
  }
);

test(
  "refuses restore after any ordinary runtime content exists",
  async () => {
    await createReplacementRuntime();

    expect(
      runtimeSetItem(
        "estipaid-customers-v1",
        "[]"
      )
    ).toBe(true);

    const flushed =
      await flushVaultRuntime();

    expect(flushed.state).toBe("ready");

    const result =
      await commitVaultDeviceRecoveryRestoreSnapshot({
        userId: USER_ID,
        companyId: COMPANY_ID,
        snapshot: compiledSnapshot(),
      });

    expect(result.code).toBe(
      VAULT_RUNTIME_ERROR_CODES
        .RECOVERY_RESTORE_NOT_EMPTY
    );
  }
);

test(
  "a second recovery restore cannot overwrite the first",
  async () => {
    await createReplacementRuntime();

    const snapshot = compiledSnapshot();

    const first =
      await commitVaultDeviceRecoveryRestoreSnapshot({
        userId: USER_ID,
        companyId: COMPANY_ID,
        snapshot,
      });

    expect(first.state).toBe("restored");

    const second =
      await commitVaultDeviceRecoveryRestoreSnapshot({
        userId: USER_ID,
        companyId: COMPANY_ID,
        snapshot,
      });

    expect(second.code).toBe(
      VAULT_RUNTIME_ERROR_CODES
        .RECOVERY_RESTORE_NOT_EMPTY
    );
  }
);

test(
  "a durable commit whose runtime is revoked is recovered by rehydration",
  async () => {
    const originalCommit =
      repository.commitRuntimeRestoreBatch;

    const runtimeRepository =
      wrappedRepository({
        commitRuntimeRestoreBatch:
          jest.fn(async (input) => {
            const result =
              await originalCommit(input);

            revokeVaultRuntime();

            return result;
          }),
      });

    await createReplacementRuntime(
      runtimeRepository
    );

    const snapshot = compiledSnapshot();

    const result =
      await commitVaultDeviceRecoveryRestoreSnapshot({
        userId: USER_ID,
        companyId: COMPANY_ID,
        snapshot,
      });

    expect(result).toEqual({
      ok: true,
      state: "committed-stale",
      code:
        VAULT_RUNTIME_ERROR_CODES
          .STALE_SESSION,
      committed: true,
      entryCount: snapshot.entryCount,
      generation: 0,
    });

    expect(runtimeGetItem(
      "estipaid-customers-v1"
    )).toBeNull();

    const activation =
      beginVaultRuntimeActivation();

    const rehydrated =
      await hydrateVaultRuntime({
        userId: USER_ID,
        companyId: COMPANY_ID,
        repository,
        activation,
      });

    expect(rehydrated).toMatchObject({
      ok: true,
      state: "ready",
      entryCount: snapshot.entryCount,
    });

    snapshot.entries.forEach((entry) => {
      expect(
        runtimeGetItem(entry.logicalKey)
      ).toBe(entry.value);
    });
  }
);

test(
  "public results expose no identity, plaintext, ciphertext, or key material",
  async () => {
    await createReplacementRuntime();

    const result =
      await commitVaultDeviceRecoveryRestoreSnapshot({
        userId: USER_ID,
        companyId: COMPANY_ID,
        snapshot: compiledSnapshot(),
      });

    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain(USER_ID);
    expect(serialized).not.toContain(COMPANY_ID);
    expect(serialized).not.toContain(
      "Synthetic Customer"
    );

    for (const property of [
      "userId",
      "companyId",
      "workspaceTag",
      "snapshot",
      "entries",
      "value",
      "ciphertext",
      "iv",
      "blobId",
      "digest",
      "key",
      "dek",
      "kek",
    ]) {
      expect(result).not.toHaveProperty(property);
    }
  }
);
