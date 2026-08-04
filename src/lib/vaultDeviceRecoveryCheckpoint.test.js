import {
  VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES,
  clearVaultDeviceRecoveryCheckpoint,
  readVaultDeviceRecoveryCheckpoint,
  writeVaultDeviceRecoveryCheckpoint,
} from "./vaultDeviceRecoveryCheckpoint";

const TAG = "A".repeat(43);

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    values,
  };
}

test("persists only a strict forward-only opaque recovery phase", () => {
  const local = storage();
  expect(writeVaultDeviceRecoveryCheckpoint({
    storage: local, workspaceTag: TAG, phase: "vault_deleted",
  }).ok).toBe(true);
  expect(writeVaultDeviceRecoveryCheckpoint({
    storage: local, workspaceTag: TAG, phase: "runtime_initialized",
  }).code).toBe(VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES.CONFLICT);
  expect(writeVaultDeviceRecoveryCheckpoint({
    storage: local, workspaceTag: TAG, phase: "device_key_removed",
  }).ok).toBe(true);

  const serialized = [...local.values.values()].join("");
  ["userId", "companyId", "proof", "ciphertext", "wrappedKey", "dek", "kek"].forEach((field) => {
    expect(serialized).not.toContain(field);
  });
  expect(readVaultDeviceRecoveryCheckpoint({ storage: local, workspaceTag: TAG }).checkpoint).toEqual({
    version: 1, workspaceTag: TAG, phase: "device_key_removed",
  });
  expect(clearVaultDeviceRecoveryCheckpoint({ storage: local, workspaceTag: TAG }).ok).toBe(true);
});

test("rejects malformed, forged, unknown, and prototype-polluting checkpoints", () => {
  const local = storage();
  const key = `estipaid-vault-device-recovery-v1:${TAG}`;
  [
    "{",
    JSON.stringify({ version: 2, workspaceTag: TAG, phase: "vault_deleted" }),
    JSON.stringify({ version: 1, workspaceTag: TAG, phase: "unknown" }),
    '{"version":1,"workspaceTag":"' + TAG + '","phase":"vault_deleted","extra":true}',
    '{"version":1,"workspaceTag":"' + TAG + '","phase":"vault_deleted","__proto__":{}}',
  ].forEach((raw) => {
    local.setItem(key, raw);
    expect(readVaultDeviceRecoveryCheckpoint({ storage: local, workspaceTag: TAG }).code)
      .toBe(VAULT_DEVICE_RECOVERY_CHECKPOINT_CODES.INVALID);
  });
});
