// ISO-15I -- TEST-ONLY instrumentation for the real-browser vault regression
// harness. Statically unreachable from App.js, index.js, every screen, every
// hook, every listener, every worker, and every Production build entry.
//
// The wrappers below OBSERVE and INTERRUPT. They never substitute behaviour:
// every call is delegated to the real account-scoped facade, the real vault
// IndexedDB repository, the real transition-control repository, and the real
// compatibility guard reader/writer. Production module contracts are unchanged.

import { VAULT_COMPATIBILITY_GUARD_KEY } from "../vaultCompatibilityGuard";
import { VAULT_MIGRATION_LOGICAL_KEYS } from "../vaultIndexedDbRepository";
import { HarnessInterrupt, middleStep } from "./crashBoundaries";

const LOGICAL_KEY_COUNT = VAULT_MIGRATION_LOGICAL_KEYS.length;

function assertNotLatchedSync(controller) {
  if (controller.isLatched()) throw new HarnessInterrupt(controller.trippedAt());
}

export function instrumentDependencies({
  storage,
  vaultRepository,
  transitionRepository,
  readGuard,
  writeGuard,
  controller,
  presentRecordCount = 0,
}) {
  const recordMiddle = middleStep(presentRecordCount || 1);
  const keyMiddle = middleStep(LOGICAL_KEY_COUNT);

  // ---- storage facade -----------------------------------------------------
  const wrappedStorage = {
    getItem(key) {
      assertNotLatchedSync(controller);
      // Guard reads belong to the guard writer, not to business inventory, and
      // must not shift the business-read counters.
      if (key === VAULT_COMPATIBILITY_GUARD_KEY) return storage.getItem(key);
      const stage = controller.currentStage();
      const count = controller.count("getItem");
      if (stage === "guarded" && count === keyMiddle && controller.armed("during-source-inventory")) {
        controller.tripSync("during-source-inventory");
      }
      if (stage === "verifying" && count === 1 && controller.armed("after-verification-before-source-recheck")) {
        controller.tripSync("after-verification-before-source-recheck");
      }
      if (stage === "verifying" && count === keyMiddle && controller.armed("during-live-source-recheck")) {
        controller.tripSync("during-live-source-recheck");
      }
      if (stage === "cleaning" && count === 1 && controller.armed("after-deletions-before-cleanup-verification")) {
        controller.tripSync("after-deletions-before-cleanup-verification");
      }
      return storage.getItem(key);
    },
    removeVaultMigrationItem(key) {
      assertNotLatchedSync(controller);
      const count = controller.count("removeVaultMigrationItem");
      if (count === 1 && controller.armed("before-first-plaintext-deletion")) {
        controller.tripSync("before-first-plaintext-deletion");
      }
      const outcome = storage.removeVaultMigrationItem(key);
      if (count === keyMiddle && controller.armed("during-middle-plaintext-deletion")) {
        controller.tripSync("during-middle-plaintext-deletion");
      }
      return outcome;
    },
    setVaultCompatibilityGuardValue(rawValue) {
      assertNotLatchedSync(controller);
      const outcome = storage.setVaultCompatibilityGuardValue(rawValue);
      const stage = controller.currentStage();
      if (rawValue.includes('"transition"') && controller.armed("during-transition-guard-write")) {
        controller.tripSync("during-transition-guard-write");
      }
      if (stage === "cleaning" && rawValue.includes('"authoritative"') && controller.armed("during-authoritative-guard-write")) {
        controller.tripSync("during-authoritative-guard-write");
      }
      return outcome;
    },
  };

  // ---- compatibility guard ------------------------------------------------
  const wrappedReadGuard = () => {
    assertNotLatchedSync(controller);
    const stage = controller.currentStage();
    const count = controller.count("readGuard");
    const guard = readGuard();
    if (stage === "prepared" && count === 1 && controller.armed("after-transition-guard-readback")) {
      controller.tripSync("after-transition-guard-readback");
    }
    if (stage === "cleaning" && count === 1 && controller.armed("after-authoritative-guard-verification")) {
      controller.tripSync("after-authoritative-guard-verification");
    }
    return guard;
  };

  const wrappedWriteGuard = (input) => {
    assertNotLatchedSync(controller);
    return writeGuard({ ...input, storage: wrappedStorage });
  };

  // ---- transition-control repository --------------------------------------
  const wrappedTransitionRepository = {
    async readActiveTransition(input) {
      if (controller.isLatched()) return controller.latchedSuspend();
      const active = await transitionRepository.readActiveTransition(input);
      // A resumed run reports its durable phase distinctly so a resume never
      // re-arms a boundary that belongs to a fresh run.
      if (active) controller.setStage(`resumed-${active.phase}`);
      return active;
    },
    async createActiveTransition(input) {
      if (controller.isLatched()) return controller.latchedSuspend();
      if (controller.armed("before-prepared-created")) return controller.tripAsync("before-prepared-created");
      const created = await transitionRepository.createActiveTransition(input);
      controller.setStage("prepared");
      if (controller.armed("after-prepared-created")) return controller.tripAsync("after-prepared-created");
      return created;
    },
    async advanceActiveTransition(input) {
      if (controller.isLatched()) return controller.latchedSuspend();
      const { expectedPhase, nextPhase } = input;
      if (expectedPhase === "copying" && controller.armed("before-copying-to-verifying")) {
        return controller.tripAsync("before-copying-to-verifying");
      }
      if (expectedPhase === "verifying" && controller.armed("before-verifying-to-cleaning")) {
        return controller.tripAsync("before-verifying-to-cleaning");
      }
      if (expectedPhase === "cleaning" && controller.armed("after-cleanup-verification-before-cleaning-to-authoritative")) {
        return controller.tripAsync("after-cleanup-verification-before-cleaning-to-authoritative");
      }
      const advanced = await transitionRepository.advanceActiveTransition(input);
      controller.setStage(nextPhase);
      if (nextPhase === "guarded" && controller.armed("after-prepared-to-guarded")) {
        return controller.tripAsync("after-prepared-to-guarded");
      }
      if (nextPhase === "cleaning" && controller.armed("after-verifying-to-cleaning")) {
        return controller.tripAsync("after-verifying-to-cleaning");
      }
      if (nextPhase === "authoritative" && controller.armed("after-cleaning-to-authoritative")) {
        return controller.tripAsync("after-cleaning-to-authoritative");
      }
      return advanced;
    },
    async deleteActiveTransition(input) {
      if (controller.isLatched()) return controller.latchedSuspend();
      if (controller.armed("before-transition-deletion")) return controller.tripAsync("before-transition-deletion");
      const deleted = await transitionRepository.deleteActiveTransition(input);
      if (controller.armed("after-transition-deletion")) return controller.tripAsync("after-transition-deletion");
      return deleted;
    },
  };

  // ---- workspace vault repository -----------------------------------------
  const wrappedVaultRepository = {
    async workspaceDatabaseExists(input) {
      if (controller.isLatched()) return controller.latchedSuspend();
      return vaultRepository.workspaceDatabaseExists(input);
    },
    async readMigrationManifest(input) {
      if (controller.isLatched()) return controller.latchedSuspend();
      return vaultRepository.readMigrationManifest(input);
    },
    async createMigrationManifest(input) {
      if (controller.isLatched()) return controller.latchedSuspend();
      if (controller.armed("before-manifest-commit")) return controller.tripAsync("before-manifest-commit");
      const created = await vaultRepository.createMigrationManifest(input);
      if (controller.armed("after-manifest-commit")) return controller.tripAsync("after-manifest-commit");
      return created;
    },
    async listEncryptedRecordKeys(input) {
      if (controller.isLatched()) return controller.latchedSuspend();
      return vaultRepository.listEncryptedRecordKeys(input);
    },
    async readEncryptedRecord(input) {
      if (controller.isLatched()) return controller.latchedSuspend();
      const stage = controller.currentStage();
      const count = controller.count("readEncryptedRecord");
      if (stage === "verifying" && count === recordMiddle && controller.armed("during-encrypted-verification")) {
        return controller.tripAsync("during-encrypted-verification");
      }
      return vaultRepository.readEncryptedRecord(input);
    },
    async createEncryptedRecord(input) {
      if (controller.isLatched()) return controller.latchedSuspend();
      const count = controller.count("createEncryptedRecord");
      const created = await vaultRepository.createEncryptedRecord(input);
      if (count === 1 && controller.armed("during-first-record-write")) {
        return controller.tripAsync("during-first-record-write");
      }
      if (count === recordMiddle && controller.armed("during-middle-record-write")) {
        return controller.tripAsync("during-middle-record-write");
      }
      return created;
    },
  };

  return Object.freeze({
    storage: wrappedStorage,
    vaultRepository: wrappedVaultRepository,
    transitionRepository: wrappedTransitionRepository,
    readGuard: wrappedReadGuard,
    writeGuard: wrappedWriteGuard,
  });
}
