import fs from "fs";
import path from "path";
import * as policy from "./vaultBridgeBuildPolicy";

const SRC = path.resolve(__dirname, "..");

function collectSources(directory, accumulator = []) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "vaultBrowserRegression") return;
      collectSources(full, accumulator);
      return;
    }
    if (entry.name.endsWith(".js") && !entry.name.includes(".test.")) accumulator.push(full);
  });
  return accumulator;
}

test("bridge policy exposes only immutable compile-time values", () => {
  expect(Object.keys(policy).sort()).toEqual([
    "VAULT_BRIDGE_RELEASE", "VAULT_CREATION_ENABLED", "VAULT_MIGRATION_ENABLED", "getVaultBridgeBuildPolicy",
  ]);
  expect(policy.VAULT_BRIDGE_RELEASE).toBe(false);
  expect(policy.VAULT_CREATION_ENABLED).toBe(true);
  expect(policy.VAULT_MIGRATION_ENABLED).toBe(true);
  const result = policy.getVaultBridgeBuildPolicy();
  expect(result).toEqual({ bridgeRelease: false, vaultCreationEnabled: true, migrationEnabled: true });
  expect(Object.isFrozen(result)).toBe(true);
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});

test("bridge policy ignores storage, URL, messages, and runtime events", () => {
  localStorage.setItem("estipaid-vault-bridge-policy", JSON.stringify({ migrationEnabled: false }));
  sessionStorage.setItem("estipaid-vault-bridge-policy", JSON.stringify({ vaultCreationEnabled: false }));
  window.history.pushState({}, "", "/?migrationEnabled=false#vaultCreationEnabled=false");
  window.dispatchEvent(new MessageEvent("message", { data: { migrationEnabled: false } }));
  expect(policy.getVaultBridgeBuildPolicy()).toEqual({ bridgeRelease: false, vaultCreationEnabled: true, migrationEnabled: true });
});

function executableSource(file) {
  return fs.readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("//"))
    .join("\n");
}

test("the policy module reads no environment variable, query string, storage key, or hostname", () => {
  const source = executableSource(path.join(SRC, "lib", "vaultBridgeBuildPolicy.js"));
  [
    "process.env", "REACT_APP_", "import.meta",
    "window.location", "URLSearchParams", "searchParams",
    "localStorage", "sessionStorage", "document.cookie",
    "hostname", "fetch(", "navigator",
  ].forEach((token) => expect(source).not.toContain(token));
  expect(source).toMatch(/export const VAULT_BRIDGE_RELEASE = false;/);
  expect(source).toMatch(/export const VAULT_CREATION_ENABLED = true;/);
  expect(source).toMatch(/export const VAULT_MIGRATION_ENABLED = true;/);
});

test("no application source can override the build policy constants", () => {
  const offenders = [];
  collectSources(SRC).forEach((file) => {
    if (file.endsWith("vaultBridgeBuildPolicy.js")) return;
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(SRC, file);
    if (/VAULT_(BRIDGE_RELEASE|CREATION_ENABLED|MIGRATION_ENABLED)\s*=[^=]/.test(source)) offenders.push(`${relative}: assignment`);
    if (/REACT_APP_[A-Z_]*(VAULT|MIGRAT)/.test(source)) offenders.push(`${relative}: environment override`);
    if (/(searchParams|URLSearchParams)[^\n]*(vault|migrat)/i.test(source)) offenders.push(`${relative}: query-string override`);
    if (/localStorage\.getItem\(["'`][^"'`]*(vault-enable|migrat)/i.test(source)) offenders.push(`${relative}: storage override`);
  });
  expect(offenders).toEqual([]);
});

test("migration is reachable only from its own module and the controlled activation hook", () => {
  const referrers = [];
  collectSources(SRC).forEach((file) => {
    const source = fs.readFileSync(file, "utf8");
    if (/migrateActiveWorkspaceVault|createVaultMigrationOrchestrator/.test(source)) {
      referrers.push(path.relative(SRC, file));
    }
  });
  expect(referrers.sort()).toEqual(["lib/useVaultRuntimeActivation.js", "lib/vaultMigrationOrchestrator.js"]);
});

test("vault creation remains reachable only from the session hook and session module", () => {
  const referrers = [];
  collectSources(SRC).forEach((file) => {
    const source = fs.readFileSync(file, "utf8");
    if (/\bsetupVault\b/.test(source)) referrers.push(path.relative(SRC, file));
  });
  expect(referrers.sort()).toEqual(["lib/useVaultSession.js", "lib/vaultSession.js"]);
});

test("runtime sealing and hydration are reachable only from the runtime module and the activation hook", () => {
  const referrers = [];
  collectSources(SRC).forEach((file) => {
    const source = fs.readFileSync(file, "utf8");
    if (/\b(sealVaultRuntime|hydrateVaultRuntime)\b/.test(source)) referrers.push(path.relative(SRC, file));
  });
  expect(referrers.sort()).toEqual(["lib/useVaultRuntimeActivation.js", "lib/vaultRuntimeStore.js"]);
});

test("no screen invokes migration, sealing, or hydration directly", () => {
  const offenders = [];
  collectSources(path.join(SRC, "screens")).forEach((file) => {
    const source = fs.readFileSync(file, "utf8");
    if (/migrateActiveWorkspaceVault|createVaultMigrationOrchestrator|hydrateVaultRuntime|sealVaultRuntime/.test(source)) {
      offenders.push(path.relative(SRC, file));
    }
  });
  expect(offenders).toEqual([]);
});
