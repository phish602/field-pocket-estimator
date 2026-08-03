// ISO-15F1 -- bridge release is a compile-time policy, never runtime input.
//
// PR19 CONTAINMENT. The encrypted runtime implementation remains in the codebase,
// but the user-facing password setup/unlock path is disabled while EstiPaid moves
// to a passwordless device-key design. There is no environment variable, query
// string, localStorage key, hostname check, remote flag, or percentage rollout
// that can change this posture: changing it requires reviewed source code.
//
// The compatibility bridge temporarily owns the normal application lifecycle.
// Vault creation and migration are dormant, so users are not asked to create or
// remember a second Local Data Password and no new encrypted migration starts.
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
