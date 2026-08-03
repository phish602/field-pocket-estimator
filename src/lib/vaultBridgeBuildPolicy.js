// ISO-15F1 -- bridge release is a compile-time policy, never runtime input.
//
// ISO-16 ACTIVATION. These are plain module constants on purpose. There is no
// environment variable, query string, localStorage key, hostname check, remote
// flag, or percentage rollout that can change them: the only way to change the
// posture is to change this file and ship it through review.
//
// The bridge is now retired. Vault creation and migration are enabled, and the
// authoritative encrypted runtime (useVaultRuntimeActivation) owns the whole
// post-unlock lifecycle.
export const VAULT_BRIDGE_RELEASE = false;
export const VAULT_CREATION_ENABLED = true;
export const VAULT_MIGRATION_ENABLED = true;

const POLICY = Object.freeze({
  bridgeRelease: VAULT_BRIDGE_RELEASE,
  vaultCreationEnabled: VAULT_CREATION_ENABLED,
  migrationEnabled: VAULT_MIGRATION_ENABLED,
});

export function getVaultBridgeBuildPolicy() {
  return POLICY;
}
