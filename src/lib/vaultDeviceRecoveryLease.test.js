import {
  VAULT_DEVICE_RECOVERY_LEASE_CODES,
  withVaultDeviceRecoveryLease,
} from "./vaultDeviceRecoveryLease";

const TAG = "A".repeat(43);

function lockManager() {
  let held = false;
  return {
    request: jest.fn(async (name, options, callback) => {
      if (held && options.ifAvailable) return callback(null);
      held = true;
      try {
        return await callback({ name });
      } finally {
        held = false;
      }
    }),
  };
}

test("excludes a concurrent recovery and releases for a retry", async () => {
  const locks = lockManager();
  let release;
  const entered = new Promise((resolve) => { release = resolve; });
  const first = withVaultDeviceRecoveryLease({
    workspaceTag: TAG,
    lockManager: locks,
    operation: async () => {
      await entered;
      return "first";
    },
  });
  await Promise.resolve();

  const busy = await withVaultDeviceRecoveryLease({
    workspaceTag: TAG,
    lockManager: locks,
    operation: async () => "must-not-run",
  });
  expect(busy).toEqual({
    acquired: false,
    code: VAULT_DEVICE_RECOVERY_LEASE_CODES.BUSY,
    value: null,
  });

  release();
  expect((await first).value).toBe("first");
  expect((await withVaultDeviceRecoveryLease({
    workspaceTag: TAG,
    lockManager: locks,
    operation: async () => "retry",
  })).value).toBe("retry");
});

test("fails closed when Web Locks is unavailable or acquisition throws", async () => {
  expect(await withVaultDeviceRecoveryLease({
    workspaceTag: TAG,
    lockManager: null,
    operation: async () => "never",
  })).toEqual({
    acquired: false,
    code: VAULT_DEVICE_RECOVERY_LEASE_CODES.UNAVAILABLE,
    value: null,
  });

  expect(await withVaultDeviceRecoveryLease({
    workspaceTag: TAG,
    lockManager: { request: async () => { throw new Error("synthetic"); } },
    operation: async () => "never",
  })).toEqual({
    acquired: false,
    code: VAULT_DEVICE_RECOVERY_LEASE_CODES.UNAVAILABLE,
    value: null,
  });
});
