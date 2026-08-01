// ISO-15F1 -- bridge release is a compile-time policy, never runtime input.
export const VAULT_BRIDGE_RELEASE = true;
export const VAULT_CREATION_ENABLED = false;
export const VAULT_MIGRATION_ENABLED = false;

const POLICY = Object.freeze({
  bridgeRelease: VAULT_BRIDGE_RELEASE,
  vaultCreationEnabled: VAULT_CREATION_ENABLED,
  migrationEnabled: VAULT_MIGRATION_ENABLED,
});

export function getVaultBridgeBuildPolicy() {
  return POLICY;
}
