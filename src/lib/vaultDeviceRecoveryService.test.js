import {
  VAULT_DEVICE_RECOVERY_EXECUTION_CODES,
  VAULT_DEVICE_RECOVERY_EXECUTION_STATES,
} from "./vaultDeviceRecoveryExecutor";
import {
  executeCurrentDeviceRecoveryReset,
} from "./vaultDeviceRecoveryService";

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

function localOverrides(overrides = {}) {
  const calls = [];

  const repository = {
    deleteWorkspaceVaultDatabase: jest.fn(async (input) => {
      calls.push(["delete-vault", input]);
      return { deleted: true };
    }),
  };

  const deviceKeyStore = {
    remove: jest.fn(async (input) => {
      calls.push(["remove-device-key", input]);
      return true;
    }),
  };

  const result = {
    calls,
    repository,
    deviceKeyStore,

    deriveWorkspaceTag: jest.fn(async (input) => {
      calls.push(["derive-workspace", input]);
      return WORKSPACE_TAG;
    }),

    lockVault: jest.fn(() => {
      calls.push(["lock"]);
    }),

    provisionReplacementVaultSession: jest.fn(async (input) => {
      calls.push(["provision-replacement", input]);
      return {
        state: "unlocked",
        code: "",
        message: "",
      };
    }),

    initializeRecoveryRuntime: jest.fn(async (input) => {
      calls.push(["initialize-runtime", input]);
      return {
        ok: true,
        state: "recovery-initialized",
      };
    }),
    readCheckpoint: jest.fn(async () => ({
      ok: true,
      code: "",
      checkpoint: null,
    })),
    writeCheckpoint: jest.fn(async () => ({
      ok: true,
      code: "",
    })),
    clearCheckpoint: jest.fn(async () => ({
      ok: true,
      code: "",
    })),
    inspectLocalState: jest.fn(async () => null),
    verifyRecoveryReady: jest.fn(async () => true),

    ...overrides,
  };

  return result;
}

test("wires the executor to the exact local recovery primitives", async () => {
  const local = localOverrides();

  const result = await executeCurrentDeviceRecoveryReset(
    evidence(),
    local
  );

  expect(result).toEqual({
    state: VAULT_DEVICE_RECOVERY_EXECUTION_STATES.READY_FOR_ACTIVATION,
    code: "",
    destructive: true,
    deleted: true,
    deviceKeyRemoved: true,
    vaultCreated: true,

    runtimeCatalogCreated: true,
  });

  expect(local.calls).toEqual([
    [
      "derive-workspace",
      {
        userId: USER_ID,
        companyId: COMPANY_ID,
      },
    ],
    ["lock"],
    [
      "delete-vault",
      {
        workspaceTag: WORKSPACE_TAG,
      },
    ],
    [
      "remove-device-key",
      {
        workspaceTag: WORKSPACE_TAG,
      },
    ],
    [
      "provision-replacement",
      {
        userId: USER_ID,
        companyId: COMPANY_ID,
      },
    ],
    [
      "initialize-runtime",
      {
        userId: USER_ID,
        companyId: COMPANY_ID,
        repository: local.repository,
      },
    ],
  ]);
});

test("caller-supplied destructive dependencies are always ignored", async () => {
  const injectedDelete = jest.fn();
  const injectedRemove = jest.fn();
  const injectedProvision = jest.fn();
  const local = localOverrides();

  const input = evidence({
    dependencies: {
      deriveWorkspaceTag: jest.fn(),
      lockVault: jest.fn(),
      deleteWorkspaceVault: injectedDelete,
      removeDeviceKey: injectedRemove,
      provisionReplacementVault: injectedProvision,
    },
  });

  const result = await executeCurrentDeviceRecoveryReset(
    input,
    local
  );

  expect(result.state).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_STATES.READY_FOR_ACTIVATION
  );

  expect(injectedDelete).not.toHaveBeenCalled();
  expect(injectedRemove).not.toHaveBeenCalled();
  expect(injectedProvision).not.toHaveBeenCalled();

  expect(
    local.repository.deleteWorkspaceVaultDatabase
  ).toHaveBeenCalledTimes(1);

  expect(local.deviceKeyStore.remove).toHaveBeenCalledTimes(1);
});

test("invalid local primitives fail closed before deletion", async () => {
  const local = localOverrides({
    repository: null,
  });

  const result = await executeCurrentDeviceRecoveryReset(
    evidence(),
    local
  );

  expect(result).toEqual({
    state: VAULT_DEVICE_RECOVERY_EXECUTION_STATES.BLOCKED,
    code: VAULT_DEVICE_RECOVERY_EXECUTION_CODES.EXECUTOR_UNAVAILABLE,
    destructive: false,
    deleted: false,
    deviceKeyRemoved: false,
    vaultCreated: false,

    runtimeCatalogCreated: false,
  });

  expect(local.deviceKeyStore.remove).not.toHaveBeenCalled();
  expect(
    local.provisionReplacementVaultSession
  ).not.toHaveBeenCalled();

  expect(
    local.initializeRecoveryRuntime
  ).not.toHaveBeenCalled();
});

test("policy rejection performs no local recovery operation", async () => {
  const local = localOverrides();
  const input = evidence();

  input.confirmation.accepted = false;

  const result = await executeCurrentDeviceRecoveryReset(
    input,
    local
  );

  expect(result.state).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_STATES.BLOCKED
  );

  expect(local.deriveWorkspaceTag).not.toHaveBeenCalled();
  expect(local.lockVault).not.toHaveBeenCalled();

  expect(
    local.repository.deleteWorkspaceVaultDatabase
  ).not.toHaveBeenCalled();

  expect(local.deviceKeyStore.remove).not.toHaveBeenCalled();

  expect(
    local.provisionReplacementVaultSession
  ).not.toHaveBeenCalled();

  expect(
    local.initializeRecoveryRuntime
  ).not.toHaveBeenCalled();
});

test("service results contain no identity or cryptographic material", async () => {
  const result = await executeCurrentDeviceRecoveryReset(
    evidence(),
    localOverrides()
  );

  const serialized = JSON.stringify(result);

  expect(serialized).not.toContain(USER_ID);
  expect(serialized).not.toContain(COMPANY_ID);
  expect(serialized).not.toContain(WORKSPACE_TAG);
  expect(serialized).not.toContain(PROOF);

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


test("fails closed when the replacement encrypted runtime cannot be initialized", async () => {
  const local = localOverrides({
    initializeRecoveryRuntime: jest.fn().mockResolvedValue({
      ok: false,
      state: "blocked",
      code: "RECOVERY_BOOTSTRAP_INVALID",
    }),
  });

  const result = await executeCurrentDeviceRecoveryReset(
    evidence(),
    local
  );

  expect(result.state).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_STATES.RESET_INCOMPLETE
  );

  expect(result.code).toBe(
    VAULT_DEVICE_RECOVERY_EXECUTION_CODES
      .RUNTIME_BOOTSTRAP_FAILED
  );

  expect(result.vaultCreated).toBe(true);
  expect(result.runtimeCatalogCreated).toBe(false);
});
