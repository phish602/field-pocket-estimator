import {
  VAULT_DEVICE_RECOVERY_ACTIVATION_CODES,
  VAULT_DEVICE_RECOVERY_ACTIVATION_STATES,
  resolveVaultDeviceRecoveryActivationPlan,
} from "./vaultDeviceRecoveryActivationPolicy";

const USER_ID = "user-1";
const COMPANY_ID = "company-1";
const WORKSPACE_TAG = "A".repeat(43);

function identity(overrides = {}) {
  return {
    userId: USER_ID,
    companyId: COMPANY_ID,
    workspaceTag: WORKSPACE_TAG,
    ...overrides,
  };
}

function resetResult(overrides = {}) {
  return {
    state: "ready_for_activation",
    code: "",
    destructive: true,
    deleted: true,
    deviceKeyRemoved: true,
    vaultCreated: true,
    runtimeCatalogCreated: true,
    ...overrides,
  };
}

function runtime(overrides = {}) {
  return {
    state: "ready",
    ready: true,
    vaultUnlocked: true,
    authoritativeAdapterInstalled: true,
    workspaceTag: WORKSPACE_TAG,
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    identity: identity(),
    resetResult: resetResult(),
    runtime: runtime(),
    ...overrides,
  };
}

function expectBlocked(result, code) {
  expect(result).toEqual({
    state:
      VAULT_DEVICE_RECOVERY_ACTIVATION_STATES.BLOCKED,
    code,
    restoreAllowed: false,
    destructive: false,
  });

  expect(Object.isFrozen(result)).toBe(true);
}

function expectWaiting(result, code) {
  expect(result).toEqual({
    state:
      VAULT_DEVICE_RECOVERY_ACTIVATION_STATES
        .WAITING_FOR_ACTIVATION,
    code,
    restoreAllowed: false,
    destructive: false,
  });

  expect(Object.isFrozen(result)).toBe(true);
}

test("allows restore only after exact runtime activation", () => {
  const result =
    resolveVaultDeviceRecoveryActivationPlan(input());

  expect(result).toEqual({
    state:
      VAULT_DEVICE_RECOVERY_ACTIVATION_STATES
        .READY_FOR_RESTORE,
    code: "",
    restoreAllowed: true,
    destructive: false,
  });

  expect(Object.isFrozen(result)).toBe(true);
});

test("blocks invalid workspace identity", () => {
  expectBlocked(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        identity: identity({
          workspaceTag: "invalid",
        }),
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .IDENTITY_UNAVAILABLE
  );
});

test("requires an explicit reset result", () => {
  expectBlocked(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        resetResult: null,
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .RESET_RESULT_REQUIRED
  );
});

test("blocks a reset that did not delete the unreadable vault", () => {
  expectBlocked(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        resetResult: resetResult({
          deleted: false,
        }),
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .RESET_INCOMPLETE
  );
});

test("blocks a reset that did not remove the lost device key", () => {
  expectBlocked(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        resetResult: resetResult({
          deviceKeyRemoved: false,
        }),
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .RESET_INCOMPLETE
  );
});

test("blocks a reset without replacement vault metadata", () => {
  expectBlocked(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        resetResult: resetResult({
          vaultCreated: false,
        }),
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .RESET_INCOMPLETE
  );
});

test("blocks a reset without the empty encrypted runtime catalog", () => {
  expectBlocked(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        resetResult: resetResult({
          runtimeCatalogCreated: false,
        }),
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .RESET_INCOMPLETE
  );
});

test("waits when runtime evidence is not available yet", () => {
  expectWaiting(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        runtime: null,
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .RUNTIME_EVIDENCE_REQUIRED
  );
});

test("blocks runtime activation for another workspace", () => {
  expectBlocked(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        runtime: runtime({
          workspaceTag: "B".repeat(43),
        }),
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .RUNTIME_WORKSPACE_MISMATCH
  );
});

test("waits while the replacement vault is locked", () => {
  expectWaiting(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        runtime: runtime({
          vaultUnlocked: false,
        }),
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .VAULT_NOT_UNLOCKED
  );
});

test("waits until the authoritative adapter is installed", () => {
  expectWaiting(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        runtime: runtime({
          authoritativeAdapterInstalled: false,
        }),
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .ADAPTER_NOT_INSTALLED
  );
});

test("waits while runtime hydration is still in progress", () => {
  expectWaiting(
    resolveVaultDeviceRecoveryActivationPlan(
      input({
        runtime: runtime({
          state: "hydrating",
          ready: false,
        }),
      })
    ),
    VAULT_DEVICE_RECOVERY_ACTIVATION_CODES
      .RUNTIME_NOT_READY
  );
});

test("does not mutate supplied recovery or runtime evidence", () => {
  const supplied = input();
  const before = JSON.stringify(supplied);

  resolveVaultDeviceRecoveryActivationPlan(supplied);

  expect(JSON.stringify(supplied)).toBe(before);
});

test("public results expose no identity or workspace data", () => {
  const result =
    resolveVaultDeviceRecoveryActivationPlan(input());

  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain(USER_ID);
  expect(serialized).not.toContain(COMPANY_ID);
  expect(serialized).not.toContain(WORKSPACE_TAG);
});
