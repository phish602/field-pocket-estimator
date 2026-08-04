import {
  VAULT_DEVICE_RECOVERY_ACTIONS,
  resolveVaultDeviceRecoveryPlan,
} from "./vaultDeviceRecoveryPolicy";
import {
  VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES,
} from "./vaultDeviceRecoveryCheckpoint";

export const VAULT_DEVICE_RECOVERY_EXECUTION_STATES = Object.freeze({
  BLOCKED: "blocked",
  RESETTING: "resetting",
  READY_FOR_ACTIVATION: "ready_for_activation",
  RESET_INCOMPLETE: "reset_incomplete",
});

export const VAULT_DEVICE_RECOVERY_EXECUTION_CODES = Object.freeze({
  WORKSPACE_TAG_MISMATCH: "WORKSPACE_TAG_MISMATCH",
  VAULT_DELETE_FAILED: "VAULT_DELETE_FAILED",
  DEVICE_KEY_REMOVE_FAILED: "DEVICE_KEY_REMOVE_FAILED",
  VAULT_SETUP_FAILED: "VAULT_SETUP_FAILED",
  VAULT_SETUP_NOT_UNLOCKED: "VAULT_SETUP_NOT_UNLOCKED",
  RUNTIME_BOOTSTRAP_FAILED: "RUNTIME_BOOTSTRAP_FAILED",
  EXECUTOR_UNAVAILABLE: "EXECUTOR_UNAVAILABLE",
  CHECKPOINT_INVALID: "RECOVERY_CHECKPOINT_INVALID",
  CHECKPOINT_MISMATCH: "RECOVERY_CHECKPOINT_MISMATCH",
  CHECKPOINT_WRITE_FAILED: "RECOVERY_CHECKPOINT_WRITE_FAILED",
  RECOVERY_VERIFICATION_FAILED: "RECOVERY_VERIFICATION_FAILED",
});

const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;

function asText(value) {
  return String(value || "").trim();
}

function frozenResult({
  state,
  code = "",
  destructive = false,
  deleted = false,
  deviceKeyRemoved = false,
  vaultCreated = false,
  runtimeCatalogCreated = false,
} = {}) {
  return Object.freeze({
    state,
    code,
    destructive,
    deleted,
    deviceKeyRemoved,
    vaultCreated,
    runtimeCatalogCreated,
  });
}

function blocked(code) {
  return frozenResult({
    state: VAULT_DEVICE_RECOVERY_EXECUTION_STATES.BLOCKED,
    code,
  });
}

function incomplete(code, progress = {}) {
  return frozenResult({
    state: VAULT_DEVICE_RECOVERY_EXECUTION_STATES.RESET_INCOMPLETE,
    code,
    destructive: true,
    ...progress,
  });
}

function validDependencies(dependencies) {
  return Boolean(
    dependencies
    && typeof dependencies.deriveWorkspaceTag === "function"
    && typeof dependencies.lockVault === "function"
    && typeof dependencies.deleteWorkspaceVault === "function"
    && typeof dependencies.removeDeviceKey === "function"
    && typeof dependencies.provisionReplacementVault === "function"
    && typeof dependencies.initializeRecoveryRuntime === "function"
    && typeof dependencies.readCheckpoint === "function"
    && typeof dependencies.writeCheckpoint === "function"
    && typeof dependencies.clearCheckpoint === "function"
    && typeof dependencies.inspectLocalState === "function"
    && typeof dependencies.verifyRecoveryReady === "function"
  );
}

const PHASES = Object.freeze([
  "vault_deleted",
  "device_key_removed",
  "replacement_vault_provisioned",
  "runtime_initialized",
]);

function progressFor(index) {
  return {
    deleted: index >= 0,
    deviceKeyRemoved: index >= 1,
    vaultCreated: index >= 2,
    runtimeCatalogCreated: index >= 3,
  };
}

function localPhase(state) {
  if (!state || typeof state !== "object" || typeof state.vaultExists !== "boolean"
    || typeof state.deviceKeyPresent !== "boolean"
    || typeof state.runtimeCatalogExists !== "boolean"
    || !Number.isSafeInteger(state.encryptedRecordCount)
    || state.encryptedRecordCount < 0) return -2;
  if (!state.vaultExists && state.deviceKeyPresent && !state.runtimeCatalogExists) return 0;
  if (!state.vaultExists && !state.deviceKeyPresent && !state.runtimeCatalogExists) return 1;
  if (state.vaultExists && state.deviceKeyPresent && !state.runtimeCatalogExists) return 2;
  if (state.vaultExists && state.deviceKeyPresent && state.runtimeCatalogExists
    && state.encryptedRecordCount === 0) return 3;
  return -2;
}

/**
 * Executes only the local destructive half of device-loss recovery.
 *
 * It deliberately does not:
 * - read or write Supabase;
 * - claim a device;
 * - restore cloud records;
 * - navigate;
 * - dispatch UI events;
 * - expose vault or key material.
 *
 * Callers must run a fresh cloud preview and ownership check immediately
 * before invoking this function. The supplied evidence is re-authorized here
 * at the destructive boundary.
 */
export async function executeVaultDeviceRecoveryReset({
  identity = null,
  capability = null,
  cloudPreview = null,
  deviceOwnership = null,
  confirmation = null,
  continuation = false,
  dependencies = null,
} = {}) {
  const plan = resolveVaultDeviceRecoveryPlan({
    identity,
    capability,
    cloudPreview,
    deviceOwnership,
    confirmation,
  });

  if (plan.action !== VAULT_DEVICE_RECOVERY_ACTIONS.RESET_LOCAL_VAULT) {
    return blocked(plan.code);
  }

  if (!validDependencies(dependencies)) {
    return blocked(
      VAULT_DEVICE_RECOVERY_EXECUTION_CODES.EXECUTOR_UNAVAILABLE
    );
  }

  let derivedWorkspaceTag;

  try {
    derivedWorkspaceTag = await dependencies.deriveWorkspaceTag({
      userId: asText(identity?.userId),
      companyId: asText(identity?.companyId),
    });
  } catch {
    return blocked(
      VAULT_DEVICE_RECOVERY_EXECUTION_CODES.WORKSPACE_TAG_MISMATCH
    );
  }

  if (
    !WORKSPACE_TAG.test(asText(derivedWorkspaceTag))
    || asText(derivedWorkspaceTag) !== asText(identity?.workspaceTag)
  ) {
    return blocked(
      VAULT_DEVICE_RECOVERY_EXECUTION_CODES.WORKSPACE_TAG_MISMATCH
    );
  }

  let checkpoint;
  let actualIndex = -1;
  try {
    const read = await dependencies.readCheckpoint({
      workspaceTag: derivedWorkspaceTag,
    });
    if (!read?.ok) {
      return incomplete(
        read?.code === VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES.INVALID
          ? VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_INVALID
          : VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_WRITE_FAILED
      );
    }
    checkpoint = read.checkpoint;
    if (continuation === true && !checkpoint) {
      return blocked(
        VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_MISMATCH
      );
    }
    if (checkpoint && checkpoint.workspaceTag !== derivedWorkspaceTag) {
      return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_MISMATCH);
    }
    if (checkpoint) {
      const inspected = await dependencies.inspectLocalState({
        workspaceTag: derivedWorkspaceTag,
      });
      actualIndex = localPhase(inspected);
      const checkpointIndex = PHASES.indexOf(checkpoint.phase);
      if (actualIndex < checkpointIndex || actualIndex === -2) {
        return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_MISMATCH);
      }
    }
  } catch {
    return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_INVALID);
  }

  dependencies.lockVault();

  let phaseIndex = checkpoint
    ? Math.max(PHASES.indexOf(checkpoint.phase), actualIndex)
    : -1;

  const checkpointPhase = async (index) => {
    const result = await dependencies.writeCheckpoint({
      workspaceTag: derivedWorkspaceTag,
      phase: PHASES[index],
    });
    return result?.ok === true;
  };

  if (phaseIndex < 0) {
    try {
    const deleteResult = await dependencies.deleteWorkspaceVault({
      workspaceTag: derivedWorkspaceTag,
    });

    if (deleteResult?.deleted !== true) {
      return incomplete(
        VAULT_DEVICE_RECOVERY_EXECUTION_CODES.VAULT_DELETE_FAILED
      );
    }
    if (!await checkpointPhase(0)) {
      return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_WRITE_FAILED);
    }
    phaseIndex = 0;
    } catch {
      return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.VAULT_DELETE_FAILED);
    }
  }

  if (phaseIndex < 1) {
    try {
    const removeResult = await dependencies.removeDeviceKey({
      workspaceTag: derivedWorkspaceTag,
    });

    if (removeResult !== true) {
      return incomplete(
        VAULT_DEVICE_RECOVERY_EXECUTION_CODES.DEVICE_KEY_REMOVE_FAILED,
        progressFor(phaseIndex)
      );
    }
    if (!await checkpointPhase(1)) {
      return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_WRITE_FAILED, progressFor(0));
    }
    phaseIndex = 1;
    } catch {
      return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.DEVICE_KEY_REMOVE_FAILED, progressFor(phaseIndex));
    }
  }

  if (phaseIndex < 2) {
    let setupResult;
    try {
      setupResult = await dependencies.provisionReplacementVault({
      userId: asText(identity?.userId),
      companyId: asText(identity?.companyId),
    });

      if (asText(setupResult?.state) !== "unlocked") {
        return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.VAULT_SETUP_NOT_UNLOCKED, progressFor(phaseIndex));
      }
      if (!await checkpointPhase(2)) {
        return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_WRITE_FAILED, progressFor(1));
      }
      phaseIndex = 2;
    } catch {
      return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.VAULT_SETUP_FAILED, progressFor(phaseIndex));
    }
  }

  if (phaseIndex < 3) {
    let runtimeResult;
    try {
      runtimeResult = await dependencies.initializeRecoveryRuntime({
      userId: asText(identity?.userId),
      companyId: asText(identity?.companyId),
    });

      if (runtimeResult?.ok !== true || !["recovery-initialized", "already-initialized"].includes(asText(runtimeResult?.state))) {
        return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.RUNTIME_BOOTSTRAP_FAILED, progressFor(phaseIndex));
      }
      if (!await checkpointPhase(3)) {
        return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_WRITE_FAILED, progressFor(2));
      }
      phaseIndex = 3;
    } catch {
      return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.RUNTIME_BOOTSTRAP_FAILED, progressFor(phaseIndex));
    }
  }

  try {
    if (await dependencies.verifyRecoveryReady({
      workspaceTag: derivedWorkspaceTag,
      userId: asText(identity?.userId),
      companyId: asText(identity?.companyId),
    }) !== true) {
      return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.RECOVERY_VERIFICATION_FAILED, progressFor(phaseIndex));
    }
    if ((await dependencies.clearCheckpoint({ workspaceTag: derivedWorkspaceTag }))?.ok !== true) {
      return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_WRITE_FAILED, progressFor(phaseIndex));
    }
  } catch {
    return incomplete(VAULT_DEVICE_RECOVERY_EXECUTION_CODES.RECOVERY_VERIFICATION_FAILED, progressFor(phaseIndex));
  }

  return frozenResult({
    state: VAULT_DEVICE_RECOVERY_EXECUTION_STATES.READY_FOR_ACTIVATION,
    destructive: true,
    ...progressFor(3),
  });
}
