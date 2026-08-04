import {
  VAULT_DEVICE_RECOVERY_EXECUTION_CODES,
  VAULT_DEVICE_RECOVERY_EXECUTION_STATES,
  executeVaultDeviceRecoveryReset,
} from "./vaultDeviceRecoveryExecutor";

const USER_ID = "user-1";
const COMPANY_ID = "company-1";
const WORKSPACE_TAG = "A".repeat(43);
const PROOF = "preview-proof-0123456789ABCDE";

function evidence(overrides = {}) {
  return {
    identity: {
      userId: USER_ID,
      companyId: COMPANY_ID,
      workspaceTag: WORKSPACE_TAG,
    },
    capability: {
      state: "reset_required",
      code: "DEVICE_KEY_MISSING",
    },
    cloudPreview: {
      status: "eligible",
      eligible: true,
      noWritesPerformed: true,
      blockers: [],
      proof: PROOF,
    },
    deviceOwnership: {
      ok: true,
      active: true,
      userId: USER_ID,
      companyId: COMPANY_ID,
      localDeviceId: "device-1",
      activeDeviceId: "device-1",
    },
    confirmation: {
      accepted: true,
      workspaceTag: WORKSPACE_TAG,
      proof: PROOF,
    },
    ...overrides,
  };
}

function dependencies(overrides = {}) {
  return {
    deriveWorkspaceTag: jest.fn().mockResolvedValue(WORKSPACE_TAG),
    lockVault: jest.fn(),
    deleteWorkspaceVault: jest.fn().mockResolvedValue({ deleted: true }),
    removeDeviceKey: jest.fn().mockResolvedValue(true),
    provisionReplacementVault: jest.fn().mockResolvedValue({ state: "unlocked" }),
    initializeRecoveryRuntime: jest.fn().mockResolvedValue({
      ok: true,
      state: "recovery-initialized",
    }),
    readCheckpoint: jest.fn().mockResolvedValue({
      ok: true,
      code: "",
      checkpoint: null,
    }),
    writeCheckpoint: jest.fn().mockResolvedValue({
      ok: true,
      code: "",
    }),
    clearCheckpoint: jest.fn().mockResolvedValue({
      ok: true,
      code: "",
    }),
    inspectLocalState: jest.fn().mockResolvedValue(null),
    verifyRecoveryReady: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

test("executes the exact local reset sequence and stops before cloud restore", async () => {
  const calls = [];

  const deps = dependencies({
    lockVault: jest.fn(() => calls.push("lock")),
    deleteWorkspaceVault: jest.fn(async () => {
      calls.push("delete-vault");
      return { deleted: true };
    }),
    removeDeviceKey: jest.fn(async () => {
      calls.push("remove-device-key");
      return true;
    }),
    provisionReplacementVault: jest.fn(async () => {
      calls.push("setup-vault");
      return { state: "unlocked" };
    }),
    initializeRecoveryRuntime: jest.fn(async () => {
      calls.push("initialize-runtime");
      return {
        ok: true,
        state: "recovery-initialized",
      };
    }),
  });

  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: deps,
  });

  expect(calls).toEqual([
    "lock",
    "delete-vault",
    "remove-device-key",
    "setup-vault",
    "initialize-runtime",
  ]);

  expect(result).toEqual({
    state: VAULT_DEVICE_RECOVERY_EXECUTION_STATES.READY_FOR_ACTIVATION,
    code: "",
    destructive: true,
    deleted: true,
    deviceKeyRemoved: true,
    vaultCreated: true,

    runtimeCatalogCreated: true,
  });

  expect(Object.isFrozen(result)).toBe(true);
});

test("does not invoke any destructive dependency when policy blocks", async () => {
  const input = evidence();
  input.confirmation.accepted = false;

  const deps = dependencies();

  const result = await executeVaultDeviceRecoveryReset({
    ...input,
    dependencies: deps,
  });

  expect(result.state).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_STATES.BLOCKED
  );

  expect(deps.lockVault).not.toHaveBeenCalled();
  expect(deps.deleteWorkspaceVault).not.toHaveBeenCalled();
  expect(deps.removeDeviceKey).not.toHaveBeenCalled();
  expect(deps.provisionReplacementVault).not.toHaveBeenCalled();
  expect(deps.initializeRecoveryRuntime).not.toHaveBeenCalled();
});

test("requires a complete executor dependency boundary", async () => {
  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: {},
  });

  expect(result).toEqual({
    state: VAULT_DEVICE_RECOVERY_EXECUTION_STATES.BLOCKED,
    code: VAULT_DEVICE_RECOVERY_EXECUTION_CODES.EXECUTOR_UNAVAILABLE,
    destructive: false,
    deleted: false,
    deviceKeyRemoved: false,
    vaultCreated: false,

    runtimeCatalogCreated: false,
  });
});

test("re-derives and verifies the workspace tag before locking or deleting", async () => {
  const deps = dependencies({
    deriveWorkspaceTag: jest.fn().mockResolvedValue("B".repeat(43)),
  });

  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: deps,
  });

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_CODES.WORKSPACE_TAG_MISMATCH
  );

  expect(deps.lockVault).not.toHaveBeenCalled();
  expect(deps.deleteWorkspaceVault).not.toHaveBeenCalled();
});

test("passes only the verified active workspace to deletion", async () => {
  const deps = dependencies();

  await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: deps,
  });

  expect(deps.deleteWorkspaceVault).toHaveBeenCalledTimes(1);
  expect(deps.deleteWorkspaceVault).toHaveBeenCalledWith({
    workspaceTag: WORKSPACE_TAG,
  });

  expect(deps.removeDeviceKey).toHaveBeenCalledWith({
    workspaceTag: WORKSPACE_TAG,
  });
});

test("stops immediately when workspace deletion throws", async () => {
  const deps = dependencies({
    deleteWorkspaceVault: jest.fn().mockRejectedValue(new Error("blocked")),
  });

  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: deps,
  });

  expect(result).toEqual({
    state: VAULT_DEVICE_RECOVERY_EXECUTION_STATES.RESET_INCOMPLETE,
    code: VAULT_DEVICE_RECOVERY_EXECUTION_CODES.VAULT_DELETE_FAILED,
    destructive: true,
    deleted: false,
    deviceKeyRemoved: false,
    vaultCreated: false,

    runtimeCatalogCreated: false,
  });

  expect(deps.removeDeviceKey).not.toHaveBeenCalled();
  expect(deps.provisionReplacementVault).not.toHaveBeenCalled();
  expect(deps.initializeRecoveryRuntime).not.toHaveBeenCalled();
});

test("stops when deletion does not return an explicit deleted result", async () => {
  const deps = dependencies({
    deleteWorkspaceVault: jest.fn().mockResolvedValue(null),
  });

  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: deps,
  });

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_CODES.VAULT_DELETE_FAILED
  );

  expect(deps.removeDeviceKey).not.toHaveBeenCalled();
});

test("reports the exact destructive progress when device-key removal fails", async () => {
  const deps = dependencies({
    removeDeviceKey: jest.fn().mockRejectedValue(new Error("failure")),
  });

  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: deps,
  });

  expect(result).toEqual({
    state: VAULT_DEVICE_RECOVERY_EXECUTION_STATES.RESET_INCOMPLETE,
    code: VAULT_DEVICE_RECOVERY_EXECUTION_CODES.DEVICE_KEY_REMOVE_FAILED,
    destructive: true,
    deleted: true,
    deviceKeyRemoved: false,
    vaultCreated: false,

    runtimeCatalogCreated: false,
  });

  expect(deps.provisionReplacementVault).not.toHaveBeenCalled();
  expect(deps.initializeRecoveryRuntime).not.toHaveBeenCalled();
});

test("reports setup failure after both old local stores were removed", async () => {
  const deps = dependencies({
    provisionReplacementVault: jest.fn().mockRejectedValue(new Error("setup failed")),
  });

  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: deps,
  });

  expect(result).toEqual({
    state: VAULT_DEVICE_RECOVERY_EXECUTION_STATES.RESET_INCOMPLETE,
    code: VAULT_DEVICE_RECOVERY_EXECUTION_CODES.VAULT_SETUP_FAILED,
    destructive: true,
    deleted: true,
    deviceKeyRemoved: true,
    vaultCreated: false,

    runtimeCatalogCreated: false,
  });
});

test("requires the replacement vault to finish unlocked", async () => {
  const deps = dependencies({
    provisionReplacementVault: jest.fn().mockResolvedValue({
      state: "locked",
      code: "STORAGE_OPERATION_FAILED",
    }),
  });

  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: deps,
  });

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_CODES.VAULT_SETUP_NOT_UNLOCKED
  );

  expect(result.deleted).toBe(true);
  expect(result.deviceKeyRemoved).toBe(true);
  expect(result.vaultCreated).toBe(false);
});

test("supports device-key mismatch recovery through the same executor", async () => {
  const input = evidence();
  input.capability.code = "DEVICE_KEY_MISMATCH";

  const result = await executeVaultDeviceRecoveryReset({
    ...input,
    dependencies: dependencies(),
  });

  expect(result.state).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_STATES.READY_FOR_ACTIVATION
  );
});

test("never includes identity, proof, or key material in public results", async () => {
  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: dependencies(),
  });

  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain(USER_ID);
  expect(serialized).not.toContain(COMPANY_ID);
  expect(serialized).not.toContain(WORKSPACE_TAG);
  expect(serialized).not.toContain(PROOF);
  expect(Object.keys(result).sort()).toEqual([
    "code",
    "deleted",
    "destructive",
    "deviceKeyRemoved",
    "runtimeCatalogCreated",
    "state",
    "vaultCreated",
  ]);

  for (const forbiddenProperty of [
    "key",
    "kek",
    "dek",
    "rawKey",
    "wrappedKey",
    "ciphertext",
    "iv",
    "proof",
    "userId",
    "companyId",
    "workspaceTag",
  ]) {
    expect(result).not.toHaveProperty(forbiddenProperty);
  }
});

test("does not mutate evidence or dependency objects", async () => {
  const input = evidence();
  const deps = dependencies();
  const beforeInput = JSON.stringify(input);
  const beforeDependencyKeys = Object.keys(deps);

  await executeVaultDeviceRecoveryReset({
    ...input,
    dependencies: deps,
  });

  expect(JSON.stringify(input)).toBe(beforeInput);
  expect(Object.keys(deps)).toEqual(beforeDependencyKeys);
});


test("reports replacement-runtime bootstrap failure after the new vault exists", async () => {
  const deps = dependencies({
    initializeRecoveryRuntime: jest.fn().mockResolvedValue({
      ok: false,
      state: "blocked",
      code: "RECOVERY_BOOTSTRAP_INVALID",
    }),
  });

  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: deps,
  });

  expect(result).toEqual({
    state:
      VAULT_DEVICE_RECOVERY_EXECUTION_STATES.RESET_INCOMPLETE,
    code:
      VAULT_DEVICE_RECOVERY_EXECUTION_CODES
        .RUNTIME_BOOTSTRAP_FAILED,
    destructive: true,
    deleted: true,
    deviceKeyRemoved: true,
    vaultCreated: true,
    runtimeCatalogCreated: false,
  });

  expect(
    deps.initializeRecoveryRuntime
  ).toHaveBeenCalledTimes(1);
});

test.each([
  ["vault_deleted", 0, ["removeDeviceKey", "provisionReplacementVault", "initializeRecoveryRuntime"]],
  ["device_key_removed", 1, ["provisionReplacementVault", "initializeRecoveryRuntime"]],
  ["replacement_vault_provisioned", 2, ["initializeRecoveryRuntime"]],
  ["runtime_initialized", 3, []],
])(
  "resumes from %s without repeating completed destructive phases",
  async (phase, phaseIndex, expectedCalls) => {
    const checkpoint = { version: 1, workspaceTag: WORKSPACE_TAG, phase };
    const deps = dependencies({
      readCheckpoint: jest.fn().mockResolvedValue({
        ok: true,
        code: "",
        checkpoint,
      }),
      inspectLocalState: jest.fn().mockResolvedValue({
        vaultExists: phaseIndex >= 2,
        deviceKeyPresent: phaseIndex === 0 || phaseIndex >= 2,
        runtimeCatalogExists: phaseIndex === 3,
        encryptedRecordCount: 0,
      }),
    });

    const result = await executeVaultDeviceRecoveryReset({
      ...evidence(),
      dependencies: deps,
    });
    expect(result.state).toBe(
      VAULT_DEVICE_RECOVERY_EXECUTION_STATES.READY_FOR_ACTIVATION
    );
    expect(deps.deleteWorkspaceVault).toHaveBeenCalledTimes(0);
    ["removeDeviceKey", "provisionReplacementVault", "initializeRecoveryRuntime"]
      .forEach((name) => {
        expect(deps[name]).toHaveBeenCalledTimes(expectedCalls.includes(name) ? 1 : 0);
      });
    expect(deps.clearCheckpoint).not.toHaveBeenCalled();
  }
);

test("fails closed when checkpoint state conflicts with actual local state", async () => {
  const deps = dependencies({
    readCheckpoint: jest.fn().mockResolvedValue({
      ok: true,
      code: "",
      checkpoint: {
        version: 1,
        workspaceTag: WORKSPACE_TAG,
        phase: "device_key_removed",
      },
    }),
    inspectLocalState: jest.fn().mockResolvedValue({
      vaultExists: false,
      deviceKeyPresent: true,
      runtimeCatalogExists: false,
      encryptedRecordCount: 0,
    }),
  });
  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    dependencies: deps,
  });
  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_MISMATCH
  );
  expect(deps.deleteWorkspaceVault).not.toHaveBeenCalled();
});

test("continuation cannot authorize the initial vault deletion without a checkpoint", async () => {
  const deps = dependencies();
  const result = await executeVaultDeviceRecoveryReset({
    ...evidence(),
    continuation: true,
    dependencies: deps,
  });
  expect(result.state).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_STATES.BLOCKED
  );
  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_CODES.CHECKPOINT_MISMATCH
  );
  expect(deps.deleteWorkspaceVault).not.toHaveBeenCalled();
});
