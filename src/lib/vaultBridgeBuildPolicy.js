// The vault posture is a compile-time policy, never runtime input.
//
// PASSWORDLESS DEVICE-KEY ACTIVATION. EstiPaid now creates and opens the local
// encrypted vault with a non-extractable AES-256 key stored by the browser for
// the exact signed-in workspace. Users keep their normal EstiPaid login and are
// never asked to create or remember a second password.
//
// There is no environment variable, query string, localStorage key, hostname
// check, remote flag, or percentage rollout that can change this posture. The
// only way to change it is reviewed source code.
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
