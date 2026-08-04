const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;

export const VAULT_DEVICE_RECOVERY_LEASE_CODES = Object.freeze({
  BUSY: "RECOVERY_BUSY",
  UNAVAILABLE: "RECOVERY_LOCK_UNAVAILABLE",
});

function lockName(workspaceTag) {
  return `estipaid-vault-device-recovery-v1:${workspaceTag}`;
}

function unavailable() {
  return Object.freeze({
    acquired: false,
    code: VAULT_DEVICE_RECOVERY_LEASE_CODES.UNAVAILABLE,
    value: null,
  });
}

/**
 * Runs an operation exclusively for one opaque workspace tag. Production uses
 * Web Locks; tests may supply a lock manager through their existing test-only
 * dependency override boundary.
 */
export async function withVaultDeviceRecoveryLease({
  workspaceTag = "",
  operation = null,
  lockManager = globalThis?.navigator?.locks,
} = {}) {
  if (!WORKSPACE_TAG.test(workspaceTag) || typeof operation !== "function") {
    return unavailable();
  }

  if (!lockManager || typeof lockManager.request !== "function") {
    return unavailable();
  }

  try {
    return await lockManager.request(
      lockName(workspaceTag),
      { ifAvailable: true, mode: "exclusive" },
      async (lock) => {
        if (!lock) {
          return Object.freeze({
            acquired: false,
            code: VAULT_DEVICE_RECOVERY_LEASE_CODES.BUSY,
            value: null,
          });
        }

        return Object.freeze({
          acquired: true,
          code: "",
          value: await operation(),
        });
      }
    );
  } catch {
    return unavailable();
  }
}
