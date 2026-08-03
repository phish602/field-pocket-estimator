import { IDBFactory } from "fake-indexeddb";
import {
  activateAccountScopedLocalStorage,
  deactivateAccountScopedLocalStorage,
  setActiveWorkspaceVaultCompatibility,
} from "./accountScopedLocalStorage";
import { createVaultIndexedDbRepository } from "./vaultIndexedDbRepository";
import { createVaultTransitionControlRepository } from "./vaultTransitionControlRepository";
import {
  VAULT_MIGRATION_ERROR_CODES,
  createVaultMigrationOrchestrator,
  verifyCompletedVaultMigrationAuthority,
} from "./vaultMigrationOrchestrator";
import { encryptBytes, migrationManifestAad, recordAad } from "./vaultCrypto";
import { VAULT_MIGRATION_LOGICAL_KEYS } from "./vaultIndexedDbRepository";
import { base64url, digestBytes, utf8Bytes } from "./vaultRuntimeCatalog";

const USER = "11111111-2222-4333-8444-555555555555";
const COMPANY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TAG = "A".repeat(43);
const OTHER_TAG = "B".repeat(43);
const TRANSITION_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_TRANSITION_ID = "123e4567-e89b-42d3-b456-426614174001";
const originalStructuredClone = globalThis.structuredClone;

beforeAll(() => {
  if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto;
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

async function testKey() {
  return globalThis.crypto.subtle.importKey("raw", new Uint8Array(32).fill(7), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

function guard(state) {
  return Object.freeze({ state, code: "", message: "" });
}

function memoryFacade(seed = {}) {
  const values = new Map(Object.entries(seed));
  let guardState = "absent";
  let failCleanup = false;
  let failNextRead = false;
  let cleanupSuccessesBeforeFailure = null;
  const facade = {
    getItem(key) {
      if (key === "estipaid-vault-guard-v1") {
        if (guardState === "absent") return null;
        return `{\"version\":1,\"state\":\"${guardState}\"}`;
      }
      if (failNextRead) {
        failNextRead = false;
        throw new Error("interrupted facade read");
      }
      return values.has(key) ? values.get(key) : null;
    },
    setValue(key, value) { values.set(key, value); },
    setVaultCompatibilityGuardValue: jest.fn((raw) => {
      if (raw === '{"version":1,"state":"transition"}') guardState = "transition";
      else if (raw === '{"version":1,"state":"authoritative"}') guardState = "authoritative";
      else return null;
      return raw;
    }),
    removeVaultMigrationItem(key) {
      if (guardState !== "authoritative" || failCleanup) return false;
      if (cleanupSuccessesBeforeFailure === 0) return false;
      if (cleanupSuccessesBeforeFailure !== null) cleanupSuccessesBeforeFailure -= 1;
      values.delete(key);
      return true;
    },
    setCleanupFailure(value) { failCleanup = value; },
    interruptNextRead() { failNextRead = true; },
    failCleanupAfter(successes) { cleanupSuccessesBeforeFailure = successes; },
    setGuardState(state) { guardState = state; },
    guardState: () => guardState,
    values,
  };
  return facade;
}

function memoryTransition(initial = null) {
  let active = initial;
  const next = { prepared: "guarded", guarded: "copying", copying: "verifying", verifying: "cleaning", cleaning: "authoritative" };
  return {
    readActiveTransition: jest.fn(async () => active && { ...active }),
    createActiveTransition: jest.fn(async ({ transitionId, workspaceTag }) => {
      if (active) throw new Error("conflict");
      active = { transitionId, workspaceTag, phase: "prepared" };
      return { ...active };
    }),
    advanceActiveTransition: jest.fn(async ({ transitionId, workspaceTag, expectedPhase, nextPhase }) => {
      if (!active || active.transitionId !== transitionId || active.workspaceTag !== workspaceTag || active.phase !== expectedPhase || next[expectedPhase] !== nextPhase) throw new Error("conflict");
      active = { ...active, phase: nextPhase };
      return { ...active };
    }),
    deleteActiveTransition: jest.fn(async ({ transitionId, workspaceTag, expectedPhase }) => {
      if (!active || active.transitionId !== transitionId || active.workspaceTag !== workspaceTag || active.phase !== expectedPhase) throw new Error("conflict");
      active = null;
      return true;
    }),
    active: () => active && { ...active },
  };
}

function memoryVault({ onCreateRecord } = {}) {
  let manifest = null;
  const records = new Map();
  return {
    workspaceDatabaseExists: jest.fn(async () => true),
    readMigrationManifest: jest.fn(async () => manifest && { ...manifest, ciphertext: manifest.ciphertext.slice(), iv: manifest.iv.slice() }),
    createMigrationManifest: jest.fn(async (value) => {
      if (manifest) throw new Error("conflict");
      manifest = { ...value, version: 1, revision: 1, ciphertext: value.ciphertext.slice(), iv: value.iv.slice() };
      return { ...manifest, ciphertext: manifest.ciphertext.slice(), iv: manifest.iv.slice() };
    }),
    listEncryptedRecordKeys: jest.fn(async () => [...records.keys()].sort()),
    readEncryptedRecord: jest.fn(async ({ logicalKey }) => {
      const value = records.get(logicalKey);
      return value && { ...value, ciphertext: value.ciphertext.slice(), iv: value.iv.slice() };
    }),
    createEncryptedRecord: jest.fn(async (value) => {
      if (records.has(value.logicalKey)) throw new Error("conflict");
      const stored = { ...value, version: 1, revision: 1, ciphertext: value.ciphertext.slice(), iv: value.iv.slice() };
      records.set(value.logicalKey, stored);
      if (onCreateRecord) await onCreateRecord(value);
      return { ...stored, ciphertext: stored.ciphertext.slice(), iv: stored.iv.slice() };
    }),
    records,
    manifest: () => manifest,
  };
}

async function runner({ storage = memoryFacade(), vault = memoryVault(), transition = memoryTransition() } = {}) {
  const dek = await testKey();
  return {
    storage, vault, transition,
    orchestrator: createVaultMigrationOrchestrator({
      storage,
      vaultRepository: vault,
      transitionRepository: transition,
      deriveTag: async () => TAG,
      withActiveDek: async ({ workspaceTag, operation }) => workspaceTag === TAG ? operation(dek) : null,
      readGuard: () => guard(storage.guardState()),
      writeGuard: ({ state, storage: target }) => target.setVaultCompatibilityGuardValue(`{\"version\":1,\"state\":\"${state}\"}`) !== null,
      newTransitionId: () => TRANSITION_ID,
    }),
  };
}

test("empty workspace reaches authoritative state without creating business records", async () => {
  const setup = await runner();
  const migration = await setup.orchestrator.run({ userId: USER, companyId: COMPANY });
  expect(setup.vault.createMigrationManifest).toHaveBeenCalled();
  expect(migration).toEqual({
    state: "authoritative", phase: "", code: "", resumable: false, authoritative: true, cleanupPending: false,
  });
  expect(setup.vault.records.size).toBe(0);
  expect(setup.storage.guardState()).toBe("authoritative");
  expect(setup.transition.active()).toBeNull();
});

test("populated workspace preserves exact bytes, distinguishes absent and empty, and encrypts its manifest", async () => {
  const storage = memoryFacade({ "estipaid-customers-v1": '[{"name":"private"}]', "estipaid-settings-v1": "" });
  const setup = await runner({ storage });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });
  expect(setup.vault.records.get("estipaid-customers-v1").ciphertext).not.toEqual(new TextEncoder().encode('[{"name":"private"}]'));
  expect(setup.vault.records.has("estipaid-settings-v1")).toBe(true);
  expect(setup.vault.records.has("estipaid-projects-v1")).toBe(false);
  expect(new TextDecoder().decode(setup.vault.manifest().ciphertext)).not.toContain("private");
  expect(storage.values.has("estipaid-customers-v1")).toBe(false);
  expect(storage.values.has("estipaid-settings-v1")).toBe(false);
});

test("post-inventory source addition fails closed before authority", async () => {
  const storage = memoryFacade({ "estipaid-customers-v1": "customer" });
  const vault = memoryVault({ onCreateRecord: async () => storage.setValue("estipaid-projects-v1", "late") });
  const setup = await runner({ storage, vault });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({
    state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.SOURCE_CHANGED, phase: "verifying", resumable: true, authoritative: false,
  });
  expect(storage.guardState()).toBe("transition");
  expect(setup.transition.active().phase).toBe("verifying");
});

test("corrupted ciphertext, a foreign transition, and a locked vault each fail closed", async () => {
  const corrupted = await runner({ storage: memoryFacade({ "estipaid-customers-v1": "customer" }) });
  const original = corrupted.vault.readEncryptedRecord;
  corrupted.vault.readEncryptedRecord = jest.fn(async (input) => {
    const value = await original(input);
    if (value) value.ciphertext[0] ^= 1;
    return value;
  });
  await expect(corrupted.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.VERIFICATION_FAILED });

  const other = await runner({ transition: memoryTransition({ transitionId: OTHER_TRANSITION_ID, workspaceTag: OTHER_TAG, phase: "copying" }) });
  await expect(other.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.OTHER_WORKSPACE_TRANSITION });

  const locked = createVaultMigrationOrchestrator({ storage: memoryFacade(), vaultRepository: memoryVault(), transitionRepository: memoryTransition(), deriveTag: async () => TAG, withActiveDek: async () => null });
  await expect(locked.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.VAULT_LOCKED });
});

test("authority survives cleanup failure and resumes idempotently without returning to plaintext", async () => {
  const storage = memoryFacade({ "estipaid-customers-v1": "customer" });
  storage.setCleanupFailure(true);
  const setup = await runner({ storage });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({
    state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.CLEANUP_PENDING, authoritative: true, cleanupPending: true,
  });
  expect(storage.guardState()).toBe("authoritative");
  expect(setup.transition.active().phase).toBe("cleaning");
  storage.setCleanupFailure(false);
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });
  expect(storage.values.has("estipaid-customers-v1")).toBe(false);
});

test("guard-write rejection leaves a prepared transition and plaintext authority unchanged", async () => {
  const storage = memoryFacade({ "estipaid-customers-v1": "customer" });
  const blockedTransition = memoryTransition();
  const blocked = createVaultMigrationOrchestrator({
    storage, vaultRepository: memoryVault(), transitionRepository: blockedTransition, deriveTag: async () => TAG,
    withActiveDek: async ({ operation }) => operation(await testKey()), readGuard: () => guard(storage.guardState()),
    writeGuard: () => false, newTransitionId: () => TRANSITION_ID,
  });
  await expect(blocked.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({
    state: "blocked", phase: "prepared", code: VAULT_MIGRATION_ERROR_CODES.GUARD_UNAVAILABLE, resumable: true, authoritative: false,
  });
  expect(storage.guardState()).toBe("absent");
  expect(blockedTransition.active()).toMatchObject({ phase: "prepared" });
});

test("interruption boundaries resume from durable state without returning to legacy-safe", async () => {
  const scenarios = [
    {
      name: "before durable prepared transition",
      install: (setup) => setup.transition.createActiveTransition.mockRejectedValueOnce(new Error("interrupted")),
      guardMayBeAbsent: true,
    },
    {
      name: "after transition record before manifest",
      install: (setup) => setup.vault.readMigrationManifest.mockRejectedValueOnce(new Error("interrupted")),
    },
    {
      name: "during source inventory",
      install: (setup) => setup.storage.interruptNextRead(),
    },
    {
      name: "after encrypted manifest commit",
      install: (setup) => {
        const advance = setup.transition.advanceActiveTransition.getMockImplementation();
        setup.transition.advanceActiveTransition.mockImplementation(async (input) => {
          if (input.expectedPhase === "guarded") {
            setup.transition.advanceActiveTransition.mockImplementation(advance);
            throw new Error("interrupted");
          }
          return advance(input);
        });
      },
    },
    {
      name: "during encrypted record writes",
      install: (setup) => setup.vault.createEncryptedRecord.mockRejectedValueOnce(new Error("interrupted")),
    },
    {
      name: "after encrypted writes before verification phase",
      install: (setup) => {
        const advance = setup.transition.advanceActiveTransition.getMockImplementation();
        setup.transition.advanceActiveTransition.mockImplementation(async (input) => {
          if (input.expectedPhase === "copying") {
            setup.transition.advanceActiveTransition.mockImplementation(advance);
            throw new Error("interrupted");
          }
          return advance(input);
        });
      },
    },
    {
      name: "after cleanup before transition finalization",
      install: (setup) => setup.transition.deleteActiveTransition.mockRejectedValueOnce(new Error("interrupted")),
    },
  ];

  for (const scenario of scenarios) {
    const setup = await runner({ storage: memoryFacade({ "estipaid-customers-v1": "customer" }) });
    scenario.install(setup);
    const first = await setup.orchestrator.run({ userId: USER, companyId: COMPANY });
    expect(first.state).toBe("blocked");
    if (!scenario.guardMayBeAbsent) expect(setup.storage.guardState()).not.toBe("absent");
    await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });
  }
});

test("verification mismatch, source removal, and partial cleanup all remain fail closed until restart succeeds", async () => {
  const corrupted = await runner({ storage: memoryFacade({ "estipaid-customers-v1": "customer" }) });
  const readRecord = corrupted.vault.readEncryptedRecord.getMockImplementation();
  corrupted.vault.readEncryptedRecord.mockImplementation(async (input) => {
    const value = await readRecord(input);
    if (value) value.ciphertext[0] ^= 1;
    return value;
  });
  await expect(corrupted.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({
    state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.VERIFICATION_FAILED, resumable: false,
  });
  corrupted.vault.readEncryptedRecord.mockImplementation(readRecord);
  await expect(corrupted.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });

  const changedStorage = memoryFacade({ "estipaid-customers-v1": "customer" });
  const changedVault = memoryVault({ onCreateRecord: async () => changedStorage.values.delete("estipaid-customers-v1") });
  const changed = await runner({ storage: changedStorage, vault: changedVault });
  await expect(changed.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({
    state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.SOURCE_CHANGED, resumable: true,
  });
  changedStorage.setValue("estipaid-customers-v1", "customer");
  await expect(changed.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });

  const cleanupStorage = memoryFacade({ "estipaid-customers-v1": "customer", "estipaid-projects-v1": "project" });
  cleanupStorage.failCleanupAfter(1);
  const cleanup = await runner({ storage: cleanupStorage });
  await expect(cleanup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({
    state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.CLEANUP_PENDING, authoritative: true, cleanupPending: true,
  });
  expect(cleanupStorage.guardState()).toBe("authoritative");
  cleanupStorage.failCleanupAfter(null);
  await expect(cleanup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });
});

test("no active transition plus authoritative guard does not automatically complete an unrelated workspace", async () => {
  const storage = memoryFacade();
  storage.setGuardState("authoritative");
  const setup = await runner({ storage });
  const migration = await setup.orchestrator.run({ userId: USER, companyId: COMPANY });
  expect(migration).toEqual(expect.objectContaining({
    state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED,
    resumable: false, authoritative: false,
  }));
  expect(Object.isFrozen(migration)).toBe(true);
  expect(setup.transition.createActiveTransition).not.toHaveBeenCalled();
});

test("no active transition plus authoritative guard completes only after current workspace integrity verification", async () => {
  const setup = await runner({ storage: memoryFacade({ "estipaid-customers-v1": "customer" }) });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });
  const manifestReadsBeforeVerification = setup.vault.readMigrationManifest.mock.calls.length;
  const recordReadsBeforeVerification = setup.vault.readEncryptedRecord.mock.calls.length;
  const verified = await setup.orchestrator.run({ userId: USER, companyId: COMPANY });
  expect(verified).toEqual({
    state: "authoritative", phase: "", code: "", resumable: false, authoritative: true, cleanupPending: false,
  });
  expect(setup.vault.readMigrationManifest.mock.calls.length).toBeGreaterThan(manifestReadsBeforeVerification);
  expect(setup.vault.readEncryptedRecord.mock.calls.length).toBeGreaterThan(recordReadsBeforeVerification);
  expect(setup.storage.values.has("estipaid-customers-v1")).toBe(false);
});

test("transition guard plus no active transition returns GUARD_RECOVERY_REQUIRED and creates no transition", async () => {
  const storage = memoryFacade();
  storage.setGuardState("transition");
  const setup = await runner({ storage });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toEqual(expect.objectContaining({
    state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.GUARD_RECOVERY_REQUIRED, resumable: false,
  }));
  expect(setup.transition.createActiveTransition).not.toHaveBeenCalled();
});

test("a second workspace cannot claim an orphaned transition guard", async () => {
  const storage = memoryFacade();
  storage.setGuardState("transition");
  const transition = memoryTransition();
  const key = await testKey();
  const orchestrator = createVaultMigrationOrchestrator({
    storage, vaultRepository: memoryVault(), transitionRepository: transition, deriveTag: async () => OTHER_TAG,
    withActiveDek: async ({ operation }) => operation(key), readGuard: () => guard(storage.guardState()),
    writeGuard: ({ state, storage: target }) => target.setVaultCompatibilityGuardValue(`{\"version\":1,\"state\":\"${state}\"}`) !== null,
    newTransitionId: () => OTHER_TRANSITION_ID,
  });
  await expect(orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({
    state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.GUARD_RECOVERY_REQUIRED,
  });
  expect(transition.createActiveTransition).not.toHaveBeenCalled();
});

test("prepared transition is created before transition guard writing", async () => {
  const setup = await runner();
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });
  expect(setup.transition.createActiveTransition.mock.invocationCallOrder[0])
    .toBeLessThan(setup.storage.setVaultCompatibilityGuardValue.mock.invocationCallOrder[0]);
});

test("successful transition guard verification occurs before prepared to guarded", async () => {
  const setup = await runner();
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });
  expect(setup.storage.setVaultCompatibilityGuardValue.mock.invocationCallOrder[0])
    .toBeLessThan(setup.transition.advanceActiveTransition.mock.invocationCallOrder[0]);
  expect(setup.transition.advanceActiveTransition.mock.calls[0]).toMatchObject([{ expectedPhase: "prepared", nextPhase: "guarded" }]);
});

test("guard-write failure leaves the transition prepared and never reaches the point of no return", async () => {
  const storage = memoryFacade({ "estipaid-customers-v1": "customer" });
  const transition = memoryTransition();
  const blocked = createVaultMigrationOrchestrator({
    storage, vaultRepository: memoryVault(), transitionRepository: transition, deriveTag: async () => TAG,
    withActiveDek: async ({ operation }) => operation(await testKey()), readGuard: () => guard(storage.guardState()),
    writeGuard: () => false, newTransitionId: () => TRANSITION_ID,
  });
  await expect(blocked.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({
    state: "blocked", phase: "prepared", resumable: true, authoritative: false,
  });
  expect(transition.active()).toMatchObject({ phase: "prepared" });
  expect(transition.advanceActiveTransition).not.toHaveBeenCalled();
});

test("restart from matching prepared plus absent guard safely writes the guard and continues", async () => {
  const transition = memoryTransition({ transitionId: TRANSITION_ID, workspaceTag: TAG, phase: "prepared" });
  const setup = await runner({ storage: memoryFacade(), transition });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });
  expect(setup.storage.guardState()).toBe("authoritative");
  expect(transition.advanceActiveTransition.mock.calls[0]).toMatchObject([{ expectedPhase: "prepared", nextPhase: "guarded" }]);
});

test("restart from matching prepared plus transition guard safely advances and continues", async () => {
  const storage = memoryFacade();
  storage.setGuardState("transition");
  const transition = memoryTransition({ transitionId: TRANSITION_ID, workspaceTag: TAG, phase: "prepared" });
  const setup = await runner({ storage, transition });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });
  expect(transition.advanceActiveTransition.mock.calls[0]).toMatchObject([{ expectedPhase: "prepared", nextPhase: "guarded" }]);
});

test("authoritative guard plus prepared fails closed", async () => {
  const storage = memoryFacade();
  storage.setGuardState("authoritative");
  const setup = await runner({ storage, transition: memoryTransition({ transitionId: TRANSITION_ID, workspaceTag: TAG, phase: "prepared" }) });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "blocked", phase: "prepared", code: VAULT_MIGRATION_ERROR_CODES.TRANSITION_CONFLICT });
});

test("authoritative guard plus guarded fails closed", async () => {
  const storage = memoryFacade();
  storage.setGuardState("authoritative");
  const setup = await runner({ storage, transition: memoryTransition({ transitionId: TRANSITION_ID, workspaceTag: TAG, phase: "guarded" }) });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "blocked", phase: "guarded", code: VAULT_MIGRATION_ERROR_CODES.TRANSITION_CONFLICT });
});

test("authoritative guard plus copying fails closed", async () => {
  const storage = memoryFacade();
  storage.setGuardState("authoritative");
  const setup = await runner({ storage, transition: memoryTransition({ transitionId: TRANSITION_ID, workspaceTag: TAG, phase: "copying" }) });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "blocked", phase: "copying", code: VAULT_MIGRATION_ERROR_CODES.TRANSITION_CONFLICT });
});

test("authoritative guard plus verifying fails closed", async () => {
  const storage = memoryFacade();
  storage.setGuardState("authoritative");
  const setup = await runner({ storage, transition: memoryTransition({ transitionId: TRANSITION_ID, workspaceTag: TAG, phase: "verifying" }) });
  await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "blocked", phase: "verifying", code: VAULT_MIGRATION_ERROR_CODES.TRANSITION_CONFLICT });
});

test("absent guard with guarded or later pre-authority phases fails closed", async () => {
  for (const phase of ["guarded", "copying", "verifying"]) {
    const setup = await runner({ transition: memoryTransition({ transitionId: TRANSITION_ID, workspaceTag: TAG, phase }) });
    await expect(setup.orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({
      state: "blocked", phase, code: VAULT_MIGRATION_ERROR_CODES.TRANSITION_CONFLICT,
    });
  }
});

test("readActiveTransition rejection returns a frozen blocked result", async () => {
  const transition = memoryTransition();
  transition.readActiveTransition.mockRejectedValueOnce(new Error("read failed"));
  const setup = await runner({ transition });
  const migration = await setup.orchestrator.run({ userId: USER, companyId: COMPANY });
  expect(migration).toMatchObject({ state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.STORAGE_OPERATION_FAILED });
  expect(Object.isFrozen(migration)).toBe(true);
});

test("initial guard-read failure returns a frozen blocked result", async () => {
  const key = await testKey();
  const migration = await createVaultMigrationOrchestrator({
    storage: memoryFacade(), vaultRepository: memoryVault(), transitionRepository: memoryTransition(), deriveTag: async () => TAG,
    withActiveDek: async ({ operation }) => operation(key), readGuard: () => { throw new Error("guard read failed"); },
  }).run({ userId: USER, companyId: COMPANY });
  expect(migration).toMatchObject({ state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.STORAGE_OPERATION_FAILED });
  expect(Object.isFrozen(migration)).toBe(true);
});

test("active-DEK wrapper rejection returns a frozen blocked result", async () => {
  const migration = await createVaultMigrationOrchestrator({
    storage: memoryFacade(), vaultRepository: memoryVault(), transitionRepository: memoryTransition(), deriveTag: async () => TAG,
    withActiveDek: async () => { throw new Error("session failed"); }, readGuard: () => guard("absent"),
  }).run({ userId: USER, companyId: COMPANY });
  expect(migration).toMatchObject({ state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.STORAGE_OPERATION_FAILED });
  expect(Object.isFrozen(migration)).toBe(true);
});

test("persistent ciphertext corruption remains blocked and is not claimed resumable by an unchanged rerun", async () => {
  const setup = await runner({ storage: memoryFacade({ "estipaid-customers-v1": "customer" }) });
  const original = setup.vault.readEncryptedRecord.getMockImplementation();
  setup.vault.readEncryptedRecord.mockImplementation(async (input) => {
    const value = await original(input);
    if (value) value.ciphertext[0] ^= 1;
    return value;
  });
  const first = await setup.orchestrator.run({ userId: USER, companyId: COMPANY });
  const second = await setup.orchestrator.run({ userId: USER, companyId: COMPANY });
  expect(first).toMatchObject({ state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.VERIFICATION_FAILED, resumable: false });
  expect(second).toMatchObject({ state: "blocked", code: VAULT_MIGRATION_ERROR_CODES.VERIFICATION_FAILED, resumable: false });
  expect(Object.isFrozen(second)).toBe(true);
});

test("real fake-indexeddb repositories migrate the active account facade only", async () => {
  const factory = new IDBFactory();
  const vault = createVaultIndexedDbRepository({ indexedDB: factory });
  const transition = createVaultTransitionControlRepository({ indexedDB: factory, clock: Date.now });
  const key = await testKey();
  localStorage.clear();
  localStorage.setItem("estipaid-customers-v1", "legacy-must-stay");
  localStorage.setItem("sb-test-auth-token", "auth-must-stay");
  const opened = activateAccountScopedLocalStorage({ storage: localStorage, userId: USER, companyId: COMPANY });
  setActiveWorkspaceVaultCompatibility({ workspaceTag: TAG, state: "legacy-safe", generation: 1 });
  opened.storage.setItem("estipaid-customers-v1", "active-customer");
  await vault.createWorkspaceVaultMetadata({
    workspaceTag: TAG, expectedRevision: null, kdfVersion: 1,
    kdfParameters: { algorithm: "argon2id", memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: "binary" },
    salt: new Uint8Array(32), wrappedDekCiphertext: new Uint8Array(48), wrappedDekIv: new Uint8Array(12),
    sentinelSchemaVersion: 1, sentinelCiphertext: new Uint8Array(32), sentinelIv: new Uint8Array(12),
  });
  const orchestrator = createVaultMigrationOrchestrator({
    storage: opened.storage, vaultRepository: vault, transitionRepository: transition,
    deriveTag: async () => TAG, withActiveDek: async ({ operation }) => operation(key),
    newTransitionId: () => TRANSITION_ID,
  });
  try {
    await expect(orchestrator.run({ userId: USER, companyId: COMPANY })).resolves.toMatchObject({ state: "authoritative" });
    expect(await vault.listEncryptedRecordKeys({ workspaceTag: TAG })).toEqual(["estipaid-customers-v1"]);
    deactivateAccountScopedLocalStorage();
    expect(localStorage.getItem("estipaid-customers-v1")).toBe("legacy-must-stay");
    expect(localStorage.getItem("sb-test-auth-token")).toBe("auth-must-stay");
  } finally {
    deactivateAccountScopedLocalStorage();
    localStorage.clear();
  }
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- completed-migration authority.
//
// The runtime seal must consume THIS verification rather than enumerating the
// record store, so every way a record set can disagree with the frozen manifest
// is exercised here, at the single source of truth.
// ---------------------------------------------------------------------------

function randomBlob() {
  return base64url(globalThis.crypto.getRandomValues(new Uint8Array(16)));
}

// Builds a completed post-migration workspace directly: encrypted records, a
// frozen encrypted manifest, an authoritative guard, and no plaintext sources.
async function completedWorkspace({
  values = { "estipaid-customers-v1": "customer-value" },
  transitionId = TRANSITION_ID,
  manifestTransitionId = null,
  mutateManifest = null,
  extraRecords = {},
  omitRecords = [],
  recordAadKey = null,
  omitManifest = false,
} = {}) {
  const dek = await testKey();
  const vault = memoryVault();
  const blobs = new Map();

  const writeRecord = async (logicalKey, value, aadKey) => {
    const plain = utf8Bytes(value);
    const blobId = randomBlob();
    blobs.set(logicalKey, { blobId, byteLength: plain.length, digest: await digestBytes(plain) });
    const envelope = await encryptBytes(dek, plain, recordAad({
      vaultFormatVersion: 1, userId: USER, companyId: COMPANY,
      logicalStorageKey: aadKey || logicalKey, blobIdentifier: blobId, recordSchemaVersion: 1,
    }));
    await vault.createEncryptedRecord({
      workspaceTag: TAG, logicalKey, expectedRevision: null, blobId,
      recordSchemaVersion: 1, ciphertext: envelope.ciphertext, iv: envelope.iv,
    });
  };

  for (const [logicalKey, value] of Object.entries(values)) {
    await writeRecord(logicalKey, value, recordAadKey === logicalKey ? "estipaid-projects-v1" : null);
  }

  const manifest = {
    version: 1,
    transitionId: manifestTransitionId || transitionId,
    entries: VAULT_MIGRATION_LOGICAL_KEYS.map((key) => (blobs.has(key)
      ? { key, present: true, byteLength: blobs.get(key).byteLength, digest: blobs.get(key).digest, blobId: blobs.get(key).blobId }
      : { key, present: false, byteLength: null, digest: null, blobId: null })),
  };
  if (typeof mutateManifest === "function") mutateManifest(manifest);

  if (!omitManifest) {
    const plain = utf8Bytes(JSON.stringify(manifest));
    const envelope = await encryptBytes(dek, plain, migrationManifestAad({
      vaultFormatVersion: 1, userId: USER, companyId: COMPANY, transitionId, manifestSchemaVersion: 1,
    }));
    await vault.createMigrationManifest({
      workspaceTag: TAG, expectedRevision: null, transitionId, manifestSchemaVersion: 1,
      ciphertext: envelope.ciphertext, iv: envelope.iv,
    });
  }

  // Records written AFTER the manifest was frozen.
  for (const [logicalKey, value] of Object.entries(extraRecords)) await writeRecord(logicalKey, value, null);
  for (const logicalKey of omitRecords) vault.records.delete(logicalKey);

  const storage = memoryFacade();
  storage.setGuardState("authoritative");
  return { dek, vault, storage };
}

async function verifyWorkspace(setup, overrides = {}) {
  return verifyCompletedVaultMigrationAuthority({
    workspaceTag: TAG,
    dek: setup.dek,
    userId: USER,
    companyId: COMPANY,
    vaultRepository: setup.vault,
    storage: setup.storage,
    readGuard: () => guard(setup.storage.guardState()),
    ...overrides,
  });
}

test("a completed migration verifies and returns only sanitized catalog inputs", async () => {
  const setup = await completedWorkspace({ values: { "estipaid-customers-v1": "customer-value", "estipaid-settings-v1": "" } });
  const verified = await verifyWorkspace(setup);
  expect(verified.ok).toBe(true);
  expect(verified.entries.map((entry) => entry.key).sort()).toEqual(["estipaid-customers-v1", "estipaid-settings-v1"]);
  verified.entries.forEach((entry) => {
    expect(Object.keys(entry).sort()).toEqual(["blobId", "byteLength", "digest", "key", "revision"]);
    expect(entry.revision).toBe(1);
  });
  const serialized = JSON.stringify(verified.entries);
  expect(serialized).not.toContain("customer-value");
  expect(serialized).not.toContain(USER);
  expect(serialized).not.toContain(COMPANY);
  expect(serialized).not.toContain(TAG);
  expect(serialized).not.toContain(TRANSITION_ID);
});

test("an empty completed migration verifies with no entries", async () => {
  const setup = await completedWorkspace({ values: {} });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({ ok: true, entries: [] });
});

test("a missing manifest is never treated as authority", async () => {
  const setup = await completedWorkspace({ omitManifest: true });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED,
  });
});

test("a non-authoritative guard is never treated as authority", async () => {
  const setup = await completedWorkspace();
  for (const state of ["absent", "transition", "blocked"]) {
    // eslint-disable-next-line no-await-in-loop
    await expect(verifyWorkspace(setup, { readGuard: () => guard(state) })).resolves.toMatchObject({
      ok: false, code: VAULT_MIGRATION_ERROR_CODES.GUARD_UNAVAILABLE,
    });
  }
  await expect(verifyWorkspace(setup, { readGuard: () => null })).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.GUARD_UNAVAILABLE,
  });
  await expect(verifyWorkspace(setup, { readGuard: () => { throw new Error("unreadable"); } })).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.GUARD_UNAVAILABLE,
  });
});

test("a corrupted manifest envelope blocks", async () => {
  const setup = await completedWorkspace();
  const stored = await setup.vault.readMigrationManifest({ workspaceTag: TAG });
  stored.ciphertext[0] ^= 0xff;
  setup.vault.readMigrationManifest.mockImplementation(async () => ({ ...stored, ciphertext: stored.ciphertext.slice(), iv: stored.iv.slice() }));
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.MANIFEST_INVALID,
  });
});

test("a duplicated manifest key blocks", async () => {
  const setup = await completedWorkspace({ mutateManifest: (manifest) => {
    manifest.entries[1] = { ...manifest.entries[0] };
  } });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.MANIFEST_INVALID,
  });
});

test("a missing manifest key blocks", async () => {
  const setup = await completedWorkspace({ mutateManifest: (manifest) => { manifest.entries.pop(); } });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.MANIFEST_INVALID,
  });
});

test("an unknown manifest key blocks", async () => {
  const setup = await completedWorkspace({ mutateManifest: (manifest) => {
    manifest.entries[manifest.entries.length - 1] = {
      key: "estipaid-unknown-key-v1", present: false, byteLength: null, digest: null, blobId: null,
    };
  } });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.MANIFEST_INVALID,
  });
});

test("a semantically invalid but validly encrypted manifest blocks", async () => {
  const setup = await completedWorkspace({ mutateManifest: (manifest) => {
    const entry = manifest.entries.find((candidate) => candidate.key === "estipaid-customers-v1");
    entry.present = false;                                                   // present data with an absent flag
  } });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.MANIFEST_INVALID,
  });
});

test("a present manifest entry with no record blocks", async () => {
  const setup = await completedWorkspace({ omitRecords: ["estipaid-customers-v1"] });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED,
  });
});

test("an absent manifest entry that has a record blocks", async () => {
  const setup = await completedWorkspace({ extraRecords: { "estipaid-projects-v1": "injected" } });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED,
  });
});

test("a record blob identifier mismatch blocks", async () => {
  const setup = await completedWorkspace({ mutateManifest: (manifest) => {
    const entry = manifest.entries.find((candidate) => candidate.key === "estipaid-customers-v1");
    entry.blobId = randomBlob();
  } });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED,
  });
});

test("a byte-length mismatch blocks", async () => {
  const setup = await completedWorkspace({ mutateManifest: (manifest) => {
    const entry = manifest.entries.find((candidate) => candidate.key === "estipaid-customers-v1");
    entry.byteLength = entry.byteLength + 1;
  } });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED,
  });
});

test("a digest mismatch blocks", async () => {
  const setup = await completedWorkspace({ mutateManifest: (manifest) => {
    const entry = manifest.entries.find((candidate) => candidate.key === "estipaid-customers-v1");
    entry.digest = "A".repeat(43);
  } });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED,
  });
});

test("a record encrypted under the wrong logical-key AAD blocks", async () => {
  const setup = await completedWorkspace({ recordAadKey: "estipaid-customers-v1" });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED,
  });
});

test("a manifest whose bound transition identity differs blocks", async () => {
  const setup = await completedWorkspace({ manifestTransitionId: OTHER_TRANSITION_ID });
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.MANIFEST_INVALID,
  });
});

test("a manifest stored with an invalid transition identity blocks", async () => {
  const setup = await completedWorkspace();
  const stored = await setup.vault.readMigrationManifest({ workspaceTag: TAG });
  setup.vault.readMigrationManifest.mockImplementation(async () => ({ ...stored, transitionId: "not-a-uuid" }));
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED,
  });
});

test("a workspace whose plaintext sources still exist blocks", async () => {
  const setup = await completedWorkspace();
  setup.storage.setValue("estipaid-customers-v1", "customer-value");
  await expect(verifyWorkspace(setup)).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.AUTHORITATIVE_WORKSPACE_UNVERIFIED,
  });
});

test("a locked vault, unusable facade, or invalid request never verifies", async () => {
  const setup = await completedWorkspace();
  await expect(verifyWorkspace(setup, { dek: null })).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.VAULT_LOCKED,
  });
  await expect(verifyWorkspace(setup, { workspaceTag: "short" })).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.INVALID_REQUEST,
  });
  await expect(verifyWorkspace(setup, { userId: "" })).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.INVALID_REQUEST,
  });
  await expect(verifyWorkspace(setup, { storage: { getItem: () => null } })).resolves.toMatchObject({
    ok: false, code: VAULT_MIGRATION_ERROR_CODES.STORAGE_UNAVAILABLE,
  });
});

test("verification never rewrites the frozen manifest", async () => {
  const setup = await completedWorkspace();
  const before = await setup.vault.readMigrationManifest({ workspaceTag: TAG });
  const verified = await verifyWorkspace(setup);
  expect(verified.ok).toBe(true);
  const after = await setup.vault.readMigrationManifest({ workspaceTag: TAG });
  expect(Array.from(after.ciphertext)).toEqual(Array.from(before.ciphertext));
  expect(Array.from(after.iv)).toEqual(Array.from(before.iv));
  expect(after.revision).toBe(before.revision);
  expect(after.transitionId).toBe(before.transitionId);
  expect(setup.vault.createMigrationManifest.mock.calls).toHaveLength(1);
});
