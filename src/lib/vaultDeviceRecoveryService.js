import { createVaultDeviceKeyStore } from "./vaultDeviceKeyStore";
import {
  executeVaultDeviceRecoveryReset,
} from "./vaultDeviceRecoveryExecutor";
import { createVaultIndexedDbRepository } from "./vaultIndexedDbRepository";
import {
  deriveWorkspaceVaultTag,
  lockVault,
  provisionReplacementVaultSession,
  unlockVault,
} from "./vaultSession";
import {
  initializeEmptyRecoveryRuntimeCatalog,
} from "./vaultRuntimeStore";
import {
  clearVaultDeviceRecoveryCheckpoint,
  readVaultDeviceRecoveryCheckpoint,
  writeVaultDeviceRecoveryCheckpoint,
} from "./vaultDeviceRecoveryCheckpoint";

function isTestOverrides(value) {
  return process.env.NODE_ENV === "test"
    && value
    && typeof value === "object"
    && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function buildLocalDependencies(overrides) {
  const test = isTestOverrides(overrides) ? overrides : null;

  const repository = test && hasOwn(test, "repository")
    ? test.repository
    : createVaultIndexedDbRepository();

  const deviceKeyStore = test && hasOwn(test, "deviceKeyStore")
    ? test.deviceKeyStore
    : createVaultDeviceKeyStore();

  const deriveWorkspaceTag = test
    && typeof test.deriveWorkspaceTag === "function"
    ? test.deriveWorkspaceTag
    : ({ userId, companyId }) => (
      deriveWorkspaceVaultTag(userId, companyId)
    );

  const lock = test && typeof test.lockVault === "function"
    ? test.lockVault
    : lockVault;

  const provision = test
    && typeof test.provisionReplacementVaultSession === "function"
    ? test.provisionReplacementVaultSession
    : provisionReplacementVaultSession;

  const initializeRecoveryRuntime = test
    && typeof test.initializeRecoveryRuntime === "function"
    ? test.initializeRecoveryRuntime
    : initializeEmptyRecoveryRuntimeCatalog;
  const checkpointStorage = test && hasOwn(test, "checkpointStorage")
    ? test.checkpointStorage
    : (typeof localStorage !== "undefined" ? localStorage : null);

  if (
    !repository
    || typeof repository.deleteWorkspaceVaultDatabase !== "function"
    || !deviceKeyStore
    || typeof deviceKeyStore.remove !== "function"
    || typeof deriveWorkspaceTag !== "function"
    || typeof lock !== "function"
    || typeof provision !== "function"
    || typeof initializeRecoveryRuntime !== "function"
    || !checkpointStorage
  ) {
    throw new TypeError("Recovery dependencies are unavailable.");
  }

  return Object.freeze({
    deriveWorkspaceTag: ({ userId, companyId }) => (
      deriveWorkspaceTag({ userId, companyId })
    ),

    lockVault: () => lock(),

    deleteWorkspaceVault: ({ workspaceTag }) => (
      repository.deleteWorkspaceVaultDatabase({ workspaceTag })
    ),

    removeDeviceKey: ({ workspaceTag }) => (
      deviceKeyStore.remove({ workspaceTag })
    ),

    provisionReplacementVault: ({ userId, companyId }) => (
      provision({ userId, companyId })
    ),

    initializeRecoveryRuntime: ({ userId, companyId }) => (
      initializeRecoveryRuntime({
        userId,
        companyId,
        repository,
      })
    ),

    readCheckpoint: test && typeof test.readCheckpoint === "function"
      ? test.readCheckpoint
      : ({ workspaceTag }) => (
        readVaultDeviceRecoveryCheckpoint({
        storage: checkpointStorage,
        workspaceTag,
        })
      ),

    writeCheckpoint: test && typeof test.writeCheckpoint === "function"
      ? test.writeCheckpoint
      : ({ workspaceTag, phase }) => (
        writeVaultDeviceRecoveryCheckpoint({
        storage: checkpointStorage,
        workspaceTag,
        phase,
        })
      ),

    clearCheckpoint: test && typeof test.clearCheckpoint === "function"
      ? test.clearCheckpoint
      : ({ workspaceTag }) => (
        clearVaultDeviceRecoveryCheckpoint({
        storage: checkpointStorage,
        workspaceTag,
        })
      ),

    inspectLocalState: test && typeof test.inspectLocalState === "function"
      ? test.inspectLocalState
      : async ({ workspaceTag }) => {
      const metadata = await repository.readWorkspaceVaultMetadata({
        workspaceTag,
      });
      const deviceKey = await deviceKeyStore.read({ workspaceTag });
      if (!metadata) {
        return Object.freeze({
          vaultExists: false,
          deviceKeyPresent: Boolean(deviceKey),
          runtimeCatalogExists: false,
          encryptedRecordCount: 0,
        });
      }
      const [runtimeCatalog, recordKeys] = await Promise.all([
        repository.readRuntimeCatalog({ workspaceTag }),
        repository.listEncryptedRecordKeys({ workspaceTag }),
      ]);
      return Object.freeze({
        vaultExists: true,
        deviceKeyPresent: Boolean(deviceKey),
        runtimeCatalogExists: Boolean(runtimeCatalog),
        encryptedRecordCount: Array.isArray(recordKeys) ? recordKeys.length : -1,
      });
      },

    verifyRecoveryReady: test && typeof test.verifyRecoveryReady === "function"
      ? test.verifyRecoveryReady
      : async ({ workspaceTag, userId, companyId }) => {
      const state = await (async () => {
        const metadata = await repository.readWorkspaceVaultMetadata({ workspaceTag });
        const key = await deviceKeyStore.read({ workspaceTag });
        const [runtimeCatalog, recordKeys] = metadata
          ? await Promise.all([
            repository.readRuntimeCatalog({ workspaceTag }),
            repository.listEncryptedRecordKeys({ workspaceTag }),
          ])
          : [null, null];
        return {
          metadata,
          key,
          runtimeCatalog,
          recordKeys,
        };
      })();
      if (!state.metadata || !state.key || !state.runtimeCatalog
        || !Array.isArray(state.recordKeys) || state.recordKeys.length !== 0) return false;
      const capability = await unlockVault({ userId, companyId });
        return capability?.state === "unlocked";
      },
  });
}

/**
 * Production-facing local half of device-key-loss recovery.
 *
 * This service:
 * - reuses the executor's evidence authorization;
 * - derives the workspace identity again;
 * - deletes only that workspace's unreadable IndexedDB vault;
 * - removes only that workspace's browser-bound device key;
 * - asks vaultSession.js to create the replacement local vault;
 * - creates its first empty encrypted runtime catalog.
 *
 * It does not contact Supabase, claim a device, restore cloud records,
 * navigate, dispatch UI events, or expose cryptographic material.
 */
export async function executeCurrentDeviceRecoveryReset(
  input = {},
  overrides
) {
  const safeInput = input
    && typeof input === "object"
    && !Array.isArray(input)
    ? input
    : {};

  let dependencies = null;

  try {
    dependencies = buildLocalDependencies(overrides);
  } catch {
    dependencies = null;
  }

  return executeVaultDeviceRecoveryReset({
    ...safeInput,

    // Always overwrite any caller-supplied dependency field. Production
    // callers can provide evidence only, never destructive implementations.
    dependencies,
  });
}
