/**
 * ISO-16 -- atomic authoritative runtime mutations against a real IndexedDB.
 *
 * Every assertion here is about ATOMICITY and COMPARE-AND-SET: a record must
 * never be persisted without its catalog, a catalog must never be persisted
 * without its record, and a stale revision must never win.
 */
import {
  IDBFactory,
  IDBObjectStore,
} from "fake-indexeddb";
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


function restoreBatchInput(overrides = {}) {
  return {
    workspaceTag: TAG,
    expectedCatalogRevision: 1,
    runtimeGeneration: 1,
    runtimeSchemaVersion: 1,
    records: [
      {
        logicalKey: "estipaid-customers-v1",
        blobId: "R".repeat(22),
        recordSchemaVersion: 1,
        ciphertext: bytes(32, 21),
        iv: bytes(12, 22),
      },
      {
        logicalKey: "estipaid-projects-v1",
        blobId: "S".repeat(22),
        recordSchemaVersion: 1,
        ciphertext: bytes(32, 23),
        iv: bytes(12, 24),
      },
      {
        logicalKey: "estipaid-invoices-v1",
        blobId: "T".repeat(22),
        recordSchemaVersion: 1,
        ciphertext: bytes(32, 25),
        iv: bytes(12, 26),
      },
    ],
    catalogCiphertext: bytes(96, 27),
    catalogIv: bytes(12, 28),
    ...overrides,
  };
}

test(
  "a recovery batch commits every record and catalog together",
  async () => {
    await seedCatalog();

    const committed =
      await repository.commitRuntimeRestoreBatch(
        restoreBatchInput()
      );

    expect(committed.catalog.revision).toBe(2);
    expect(committed.catalog.runtimeGeneration).toBe(1);
    expect(committed.records).toHaveLength(3);

    expect(Object.isFrozen(committed)).toBe(true);
    expect(Object.isFrozen(committed.records)).toBe(true);
    expect(Object.isFrozen(committed.catalog)).toBe(true);

    expect(
      await repository.listEncryptedRecordKeys({
        workspaceTag: TAG,
      })
    ).toEqual([
      "estipaid-customers-v1",
      "estipaid-invoices-v1",
      "estipaid-projects-v1",
    ]);

    for (const record of committed.records) {
      expect(record.revision).toBe(1);
      expect(record.createdAt).toBe(record.updatedAt);

      const stored =
        await repository.readEncryptedRecord({
          workspaceTag: TAG,
          logicalKey: record.logicalKey,
        });

      expect(stored).toEqual(record);
    }

    expect(
      (
        await repository.readRuntimeCatalog({
          workspaceTag: TAG,
        })
      ).revision
    ).toBe(2);
  }
);

test(
  "a stale recovery catalog revision writes no record",
  async () => {
    await seedCatalog();

    await expect(
      repository.commitRuntimeRestoreBatch(
        restoreBatchInput({
          expectedCatalogRevision: 2,
        })
      )
    ).rejects.toMatchObject({
      code: VAULT_REPOSITORY_ERROR_CODES.CONFLICT,
    });

    expect(
      await repository.listEncryptedRecordKeys({
        workspaceTag: TAG,
      })
    ).toEqual([]);

    expect(
      (
        await repository.readRuntimeCatalog({
          workspaceTag: TAG,
        })
      ).revision
    ).toBe(1);
  }
);

test(
  "a recovery batch refuses every nonempty record store",
  async () => {
    await seedCatalog();

    await repository.commitRuntimeRecordSet(
      setInput()
    );

    await expect(
      repository.commitRuntimeRestoreBatch(
        restoreBatchInput({
          expectedCatalogRevision: 2,
          records: [
            {
              logicalKey: "estipaid-projects-v1",
              blobId: "U".repeat(22),
              recordSchemaVersion: 1,
              ciphertext: bytes(32, 29),
              iv: bytes(12, 30),
            },
          ],
        })
      )
    ).rejects.toMatchObject({
      code: VAULT_REPOSITORY_ERROR_CODES.CONFLICT,
    });

    expect(
      await repository.listEncryptedRecordKeys({
        workspaceTag: TAG,
      })
    ).toEqual([
      "estipaid-customers-v1",
    ]);

    expect(
      (
        await repository.readRuntimeCatalog({
          workspaceTag: TAG,
        })
      ).revision
    ).toBe(2);
  }
);

test(
  "duplicate recovery logical keys fail before persistence",
  async () => {
    await seedCatalog();

    const duplicate = restoreBatchInput();
    duplicate.records[1] = {
      ...duplicate.records[0],
      blobId: "V".repeat(22),
    };

    await expect(
      repository.commitRuntimeRestoreBatch(duplicate)
    ).rejects.toMatchObject({
      code:
        VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT,
    });

    expect(
      await repository.listEncryptedRecordKeys({
        workspaceTag: TAG,
      })
    ).toEqual([]);

    expect(
      (
        await repository.readRuntimeCatalog({
          workspaceTag: TAG,
        })
      ).revision
    ).toBe(1);
  }
);

test(
  "one malformed recovery envelope rejects the entire batch",
  async () => {
    await seedCatalog();

    const malformed = restoreBatchInput();
    malformed.records[1] = {
      ...malformed.records[1],
      iv: bytes(11, 31),
    };

    await expect(
      repository.commitRuntimeRestoreBatch(malformed)
    ).rejects.toMatchObject({
      code:
        VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA,
    });

    expect(
      await repository.listEncryptedRecordKeys({
        workspaceTag: TAG,
      })
    ).toEqual([]);

    expect(
      (
        await repository.readRuntimeCatalog({
          workspaceTag: TAG,
        })
      ).revision
    ).toBe(1);
  }
);

test(
  "a native catalog-write failure rolls back all added recovery records",
  async () => {
    await seedCatalog();

    const originalPut =
      IDBObjectStore.prototype.put;

    const putSpy = jest
      .spyOn(IDBObjectStore.prototype, "put")
      .mockImplementation(function patchedPut(
        value,
        key
      ) {
        if (
          this.name === "migration"
          && key === "runtime"
        ) {
          throw new Error(
            "synthetic catalog write failure"
          );
        }

        return originalPut.call(this, value, key);
      });

    try {
      await expect(
        repository.commitRuntimeRestoreBatch(
          restoreBatchInput()
        )
      ).rejects.toMatchObject({
        code:
          VAULT_REPOSITORY_ERROR_CODES
            .TRANSACTION_ABORTED,
      });
    } finally {
      putSpy.mockRestore();
    }

    expect(
      await repository.listEncryptedRecordKeys({
        workspaceTag: TAG,
      })
    ).toEqual([]);

    expect(
      (
        await repository.readRuntimeCatalog({
          workspaceTag: TAG,
        })
      ).revision
    ).toBe(1);
  }
);

test(
  "recovery batch inputs and returned byte arrays are cloned",
  async () => {
    await seedCatalog();

    const input = restoreBatchInput();

    const committed =
      await repository.commitRuntimeRestoreBatch(input);

    input.records[0].ciphertext[0] = 99;
    input.catalogCiphertext[0] = 98;
    committed.records[0].ciphertext[0] = 97;
    committed.catalog.ciphertext[0] = 96;

    const storedRecord =
      await repository.readEncryptedRecord({
        workspaceTag: TAG,
        logicalKey: "estipaid-customers-v1",
      });

    const storedCatalog =
      await repository.readRuntimeCatalog({
        workspaceTag: TAG,
      });

    expect(storedRecord.ciphertext[0]).toBe(21);
    expect(storedCatalog.ciphertext[0]).toBe(27);
  }
);
