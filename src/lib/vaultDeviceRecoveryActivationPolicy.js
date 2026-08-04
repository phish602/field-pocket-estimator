export const VAULT_DEVICE_RECOVERY_ACTIVATION_STATES =
  Object.freeze({
    BLOCKED: "blocked",
    WAITING_FOR_ACTIVATION: "waiting_for_activation",
    READY_FOR_RESTORE: "ready_for_restore",
  });

export const VAULT_DEVICE_RECOVERY_ACTIVATION_CODES =
  Object.freeze({
    IDENTITY_UNAVAILABLE: "IDENTITY_UNAVAILABLE",
    RESET_RESULT_REQUIRED: "RESET_RESULT_REQUIRED",
    RESET_INCOMPLETE: "RESET_INCOMPLETE",
    RUNTIME_EVIDENCE_REQUIRED: "RUNTIME_EVIDENCE_REQUIRED",
    RUNTIME_WORKSPACE_MISMATCH:
      "RUNTIME_WORKSPACE_MISMATCH",
    VAULT_NOT_UNLOCKED: "VAULT_NOT_UNLOCKED",
    ADAPTER_NOT_INSTALLED: "ADAPTER_NOT_INSTALLED",
    RUNTIME_NOT_READY: "RUNTIME_NOT_READY",
  });

const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;

function asText(value) {
  return String(value || "").trim();
}

function result(state, code = "") {
  return Object.freeze({
    state,
    code,
    restoreAllowed:
      state
      === VAULT_DEVICE_RECOVERY_ACTIVATION_STATES
        .READY_FOR_RESTORE,
    destructive: false,
  });
}

function blocked(code) {
  return result(
    VAULT_DEVICE_RECOVERY_ACTIVATION_STATES.BLOCKED,
    code
  );
}

function waiting(code) {
  return result(
    VAULT_DEVICE_RECOVERY_ACTIVATION_STATES
      .WAITING_FOR_ACTIVATION,
    code
  );
}

function validIdentity(identity) {
  return Boolean(
    asText(identity?.userId)
    && asText(identity?.companyId)
    && WORKSPACE_TAG.test(
      asText(identity?.workspaceTag)
    )
  );
}

function completedReset(resetResult) {
  return Boolean(
    resetResult
    && typeof resetResult === "object"
    && resetResult.state === "ready_for_activation"
    && resetResult.destructive === true
    && resetResult.deleted === true
    && resetResult.deviceKeyRemoved === true
    && resetResult.vaultCreated === true
    && resetResult.runtimeCatalogCreated === true
  );
}

/**
 * Pure policy for the boundary between destructive local reset and
 * authenticated cloud restore.
 *
 * It performs no reads, writes, activation, navigation, deletion,
 * cloud access, key operations, or event dispatch.
 */
export function resolveVaultDeviceRecoveryActivationPlan({
  identity = null,
  resetResult = null,
  runtime = null,
} = {}) {
  if (!validIdentity(identity)) {
    return blocked(
      VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
        .IDENTITY_UNAVAILABLE
    );
  }

  if (
    !resetResult
    || typeof resetResult !== "object"
  ) {
    return blocked(
      VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
        .RESET_RESULT_REQUIRED
    );
  }

  if (!completedReset(resetResult)) {
    return blocked(
      VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
        .RESET_INCOMPLETE
    );
  }

  if (!runtime || typeof runtime !== "object") {
    return waiting(
      VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
        .RUNTIME_EVIDENCE_REQUIRED
    );
  }

  const runtimeWorkspaceTag = asText(
    runtime.workspaceTag
  );

  if (
    !WORKSPACE_TAG.test(runtimeWorkspaceTag)
    || runtimeWorkspaceTag
      !== asText(identity.workspaceTag)
  ) {
    return blocked(
      VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
        .RUNTIME_WORKSPACE_MISMATCH
    );
  }

  if (runtime.vaultUnlocked !== true) {
    return waiting(
      VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
        .VAULT_NOT_UNLOCKED
    );
  }

  if (
    runtime.authoritativeAdapterInstalled !== true
  ) {
    return waiting(
      VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
        .ADAPTER_NOT_INSTALLED
    );
  }

  if (
    runtime.ready !== true
    || asText(runtime.state) !== "ready"
  ) {
    return waiting(
      VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
        .RUNTIME_NOT_READY
    );
  }

  return result(
    VAULT_DEVICE_RECOVERY_ACTIVATION_STATES
      .READY_FOR_RESTORE
  );
}
