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
  // PR19 containment posture: restore the normal bridge flow while the
  // passwordless device-key design is built and reviewed.
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

// Comments are stripped first: the invariant is about what the module EXECUTES,
// and the module's own comment legitimately names the mechanisms it refuses.
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
  // Plain constants only: no call can produce a different posture.
  expect(source).toMatch(/export const VAULT_BRIDGE_RELEASE = true;/);
  expect(source).toMatch(/export const VAULT_CREATION_ENABLED = false;/);
  expect(source).toMatch(/export const VAULT_MIGRATION_ENABLED = false;/);
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

// Any REFERENCE counts -- importing the symbol, calling it, or passing it by
// reference. That is stricter than matching a call shape and cannot be evaded by
// handing the function to a helper.
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

test("vault creation is reachable only from its own module and the password setup operation", () => {
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
