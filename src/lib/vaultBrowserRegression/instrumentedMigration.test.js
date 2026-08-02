import { createCheckpointController, HarnessInterrupt, middleStep } from "./crashBoundaries";
import { instrumentDependencies } from "./instrumentedMigration";
import { VAULT_COMPATIBILITY_GUARD_KEY } from "../vaultCompatibilityGuard";
import { VAULT_MIGRATION_LOGICAL_KEYS } from "../vaultIndexedDbRepository";

const KEY_COUNT = VAULT_MIGRATION_LOGICAL_KEYS.length;

function harness({ crashAt = null, presentRecordCount = 8 } = {}) {
  const calls = [];
  const controller = createCheckpointController({ crashAt, suspend: () => new Promise(() => {}) });
  const storage = {
    getItem: (key) => { calls.push(`getItem:${key}`); return "value"; },
    removeVaultMigrationItem: (key) => { calls.push(`remove:${key}`); return true; },
    setVaultCompatibilityGuardValue: (raw) => { calls.push("setGuard"); return raw; },
  };
  const vaultRepository = {
    workspaceDatabaseExists: async () => { calls.push("exists"); return true; },
    readMigrationManifest: async () => { calls.push("readManifest"); return null; },
    createMigrationManifest: async () => { calls.push("createManifest"); return { revision: 1 }; },
    listEncryptedRecordKeys: async () => { calls.push("listKeys"); return []; },
    readEncryptedRecord: async () => { calls.push("readRecord"); return null; },
    createEncryptedRecord: async () => { calls.push("createRecord"); return { revision: 1 }; },
  };
  const transitionRepository = {
    readActiveTransition: async () => { calls.push("readTransition"); return null; },
    createActiveTransition: async ({ transitionId, workspaceTag }) => { calls.push("createTransition"); return { transitionId, workspaceTag, phase: "prepared" }; },
    advanceActiveTransition: async ({ nextPhase }) => { calls.push(`advance:${nextPhase}`); return { phase: nextPhase }; },
    deleteActiveTransition: async () => { calls.push("deleteTransition"); return true; },
  };
  const instrumented = instrumentDependencies({
    storage,
    vaultRepository,
    transitionRepository,
    readGuard: () => { calls.push("readGuard"); return { state: "absent" }; },
    writeGuard: ({ state, storage: target }) => { target.setVaultCompatibilityGuardValue(`{"version":1,"state":"${state}"}`); return true; },
    controller,
    presentRecordCount,
  });
  return { calls, controller, instrumented };
}

function pending(promise) {
  return Promise.race([promise.then(() => "settled"), Promise.resolve("pending")]);
}

test("without an armed boundary every call is delegated unchanged", async () => {
  const { calls, instrumented } = harness();
  expect(instrumented.storage.getItem("estipaid-customers-v1")).toBe("value");
  expect(await instrumented.vaultRepository.createMigrationManifest({})).toEqual({ revision: 1 });
  expect(await instrumented.transitionRepository.advanceActiveTransition({ expectedPhase: "prepared", nextPhase: "guarded" })).toEqual({ phase: "guarded" });
  expect(calls).toEqual(["getItem:estipaid-customers-v1", "createManifest", "advance:guarded"]);
});

test("guard-key reads never advance the business-inventory counter", () => {
  const { instrumented, controller } = harness({ crashAt: "during-source-inventory" });
  controller.setStage("guarded");
  for (let index = 0; index < KEY_COUNT * 2; index += 1) {
    instrumented.storage.getItem(VAULT_COMPATIBILITY_GUARD_KEY);
  }
  expect(controller.isLatched()).toBe(false);
});

test("the inventory boundary trips at the middle approved key and latches every later call", () => {
  const { instrumented, controller } = harness({ crashAt: "during-source-inventory" });
  controller.setStage("guarded");
  const middle = middleStep(KEY_COUNT);
  for (let index = 1; index < middle; index += 1) {
    expect(instrumented.storage.getItem(`key-${index}`)).toBe("value");
  }
  expect(() => instrumented.storage.getItem(`key-${middle}`)).toThrow(HarnessInterrupt);
  expect(controller.trippedAt()).toBe("during-source-inventory");
  expect(() => instrumented.storage.removeVaultMigrationItem("estipaid-customers-v1")).toThrow(HarnessInterrupt);
});

test("a latched controller suspends every later asynchronous dependency call", async () => {
  const { instrumented, controller } = harness({ crashAt: "during-source-inventory" });
  controller.setStage("guarded");
  expect(() => {
    for (let index = 1; index <= KEY_COUNT; index += 1) instrumented.storage.getItem(`key-${index}`);
  }).toThrow(HarnessInterrupt);
  expect(await pending(instrumented.vaultRepository.createEncryptedRecord({}))).toBe("pending");
  expect(await pending(instrumented.transitionRepository.advanceActiveTransition({ expectedPhase: "copying", nextPhase: "verifying" }))).toBe("pending");
});

test("record-write boundaries trip after the underlying durable write has committed", async () => {
  const first = harness({ crashAt: "during-first-record-write", presentRecordCount: 8 });
  expect(await pending(first.instrumented.vaultRepository.createEncryptedRecord({}))).toBe("pending");
  expect(first.calls).toEqual(["createRecord"]);

  const middle = harness({ crashAt: "during-middle-record-write", presentRecordCount: 8 });
  for (let index = 1; index < middleStep(8); index += 1) {
    await middle.instrumented.vaultRepository.createEncryptedRecord({});
  }
  expect(await pending(middle.instrumented.vaultRepository.createEncryptedRecord({}))).toBe("pending");
  expect(middle.calls.filter((entry) => entry === "createRecord")).toHaveLength(middleStep(8));
});

test("pre-write boundaries trip before the underlying durable write is attempted", async () => {
  const before = harness({ crashAt: "before-manifest-commit" });
  expect(await pending(before.instrumented.vaultRepository.createMigrationManifest({}))).toBe("pending");
  expect(before.calls).toEqual([]);

  const deletion = harness({ crashAt: "before-first-plaintext-deletion" });
  expect(() => deletion.instrumented.storage.removeVaultMigrationItem("estipaid-customers-v1")).toThrow(HarnessInterrupt);
  expect(deletion.calls).toEqual([]);
});

test("the middle plaintext deletion trips only after that deletion has committed", () => {
  const { calls, instrumented } = harness({ crashAt: "during-middle-plaintext-deletion" });
  const middle = middleStep(KEY_COUNT);
  for (let index = 1; index < middle; index += 1) {
    expect(instrumented.storage.removeVaultMigrationItem(`key-${index}`)).toBe(true);
  }
  expect(() => instrumented.storage.removeVaultMigrationItem(`key-${middle}`)).toThrow(HarnessInterrupt);
  expect(calls.filter((entry) => entry.startsWith("remove:"))).toHaveLength(middle);
});

test("guard-write boundaries trip after the guard value is durably written", () => {
  const transitionWrite = harness({ crashAt: "during-transition-guard-write" });
  expect(() => transitionWrite.instrumented.writeGuard({ state: "transition" })).toThrow(HarnessInterrupt);
  expect(transitionWrite.calls).toEqual(["setGuard"]);

  const authoritativeWrite = harness({ crashAt: "during-authoritative-guard-write" });
  authoritativeWrite.controller.setStage("cleaning");
  expect(() => authoritativeWrite.instrumented.writeGuard({ state: "authoritative" })).toThrow(HarnessInterrupt);
  expect(authoritativeWrite.calls).toEqual(["setGuard"]);
});

test("a resumed run reports a distinct stage so no fresh-run boundary is re-armed", async () => {
  const { instrumented, controller, calls } = harness({ crashAt: "during-source-inventory" });
  instrumented.transitionRepository.readActiveTransition = async () => ({ phase: "guarded", workspaceTag: "tag" });
  const resumed = instrumentDependencies({
    storage: { getItem: () => "value", removeVaultMigrationItem: () => true, setVaultCompatibilityGuardValue: (raw) => raw },
    vaultRepository: { readMigrationManifest: async () => null },
    transitionRepository: { readActiveTransition: async () => ({ phase: "guarded", workspaceTag: "tag" }) },
    readGuard: () => ({ state: "absent" }),
    writeGuard: () => true,
    controller,
    presentRecordCount: 8,
  });
  await resumed.transitionRepository.readActiveTransition({});
  expect(controller.currentStage()).toBe("resumed-guarded");
  for (let index = 1; index <= KEY_COUNT; index += 1) resumed.storage.getItem(`key-${index}`);
  expect(controller.isLatched()).toBe(false);
  expect(calls).toEqual([]);
});

test("the source-recheck boundaries are distinguished from the inventory boundary by stage", () => {
  const recheckStart = harness({ crashAt: "after-verification-before-source-recheck" });
  recheckStart.controller.setStage("guarded");
  for (let index = 1; index <= KEY_COUNT; index += 1) recheckStart.instrumented.storage.getItem(`key-${index}`);
  expect(recheckStart.controller.isLatched()).toBe(false);
  recheckStart.controller.setStage("verifying");
  expect(() => recheckStart.instrumented.storage.getItem("key-1")).toThrow(HarnessInterrupt);

  const cleanup = harness({ crashAt: "after-deletions-before-cleanup-verification" });
  cleanup.controller.setStage("verifying");
  for (let index = 1; index <= KEY_COUNT; index += 1) cleanup.instrumented.storage.getItem(`key-${index}`);
  expect(cleanup.controller.isLatched()).toBe(false);
  cleanup.controller.setStage("cleaning");
  expect(() => cleanup.instrumented.storage.getItem("key-1")).toThrow(HarnessInterrupt);
});
