import * as policy from "./vaultBridgeBuildPolicy";

test("bridge policy exposes only immutable compile-time values", () => {
  expect(Object.keys(policy).sort()).toEqual([
    "VAULT_BRIDGE_RELEASE", "VAULT_CREATION_ENABLED", "VAULT_MIGRATION_ENABLED", "getVaultBridgeBuildPolicy",
  ]);
  expect(policy.VAULT_BRIDGE_RELEASE).toBe(true);
  expect(policy.VAULT_CREATION_ENABLED).toBe(false);
  expect(policy.VAULT_MIGRATION_ENABLED).toBe(false);
  const result = policy.getVaultBridgeBuildPolicy();
  expect(result).toEqual({ bridgeRelease: true, vaultCreationEnabled: false, migrationEnabled: false });
  expect(Object.isFrozen(result)).toBe(true);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});

test("bridge policy ignores storage, URL, messages, and runtime events", () => {
  localStorage.setItem("estipaid-vault-bridge-policy", JSON.stringify({ migrationEnabled: true }));
  sessionStorage.setItem("estipaid-vault-bridge-policy", JSON.stringify({ vaultCreationEnabled: true }));
  window.history.pushState({}, "", "/?migrationEnabled=true#vaultCreationEnabled=true");
  window.dispatchEvent(new MessageEvent("message", { data: { migrationEnabled: true } }));
  expect(policy.getVaultBridgeBuildPolicy()).toEqual({ bridgeRelease: true, vaultCreationEnabled: false, migrationEnabled: false });
});
