/**
 * ISO-15J -- storage-boundary regression.
 *
 * This test walks the real application source and requires that EVERY
 * `estipaid-*` and `field-pocket-*` logical key it finds is classified. A key
 * that is account-scoped by the ISO-14D facade but missing from the migration
 * allowlist would survive a completed migration as PLAINTEXT, so an
 * unclassified key fails the suite rather than shipping silently.
 */
import fs from "fs";
import path from "path";
import {
  EXCLUDED_FROM_MIGRATION,
  STRUCTURAL_IDENTIFIERS,
  classifyLogicalKey,
} from "./vaultStorageClassification";
import {
  DEVICE_GLOBAL_LOGICAL_KEYS,
  QUARANTINED_LEGACY_LOGICAL_KEYS,
  isWorkspaceScopedLogicalKey,
} from "./accountScopedLocalStorage";
import { VAULT_MIGRATION_LOGICAL_KEYS } from "./vaultIndexedDbRepository";

const SRC = path.resolve(__dirname, "..");

function collectSourceFiles(directory, accumulator = []) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      // The browser-regression harness is test-only and generates synthetic
      // fixtures for the allowlist itself, so it is not an authority on which
      // keys the application uses.
      if (entry.name === "vaultBrowserRegression") return;
      collectSourceFiles(full, accumulator);
      return;
    }
    if (entry.name.endsWith(".js") && !entry.name.includes(".test.")) accumulator.push(full);
  });
  return accumulator;
}

function discoverLogicalKeys() {
  const found = new Map();
  collectSourceFiles(SRC).forEach((file) => {
    const text = fs.readFileSync(file, "utf8");
    const matches = [
      ...text.matchAll(/["'`](estipaid-[a-zA-Z0-9_-]+)["'`]/g),
      ...text.matchAll(/["'`](field-pocket-[a-zA-Z0-9_-]+)["'`]/g),
    ];
    matches.forEach((match) => {
      const key = match[1];
      if (!found.has(key)) found.set(key, path.relative(SRC, file));
    });
  });
  return found;
}

const options = {
  migrationAllowlist: VAULT_MIGRATION_LOGICAL_KEYS,
  deviceGlobal: DEVICE_GLOBAL_LOGICAL_KEYS,
  quarantined: QUARANTINED_LEGACY_LOGICAL_KEYS,
};

test("every logical storage key in application source is classified", () => {
  const discovered = discoverLogicalKeys();
  const unclassified = [];
  discovered.forEach((file, key) => {
    if (classifyLogicalKey(key, options) === "unclassified") unclassified.push(`${key} (${file})`);
  });
  expect(unclassified).toEqual([]);
  expect(discovered.size).toBeGreaterThan(40);
});

test("no workspace-scoped business key is missing from the migration allowlist", () => {
  const discovered = discoverLogicalKeys();
  const missing = [];
  discovered.forEach((file, key) => {
    if (!isWorkspaceScopedLogicalKey(key)) return;
    if (STRUCTURAL_IDENTIFIERS.includes(key)) return;
    if (Object.prototype.hasOwnProperty.call(EXCLUDED_FROM_MIGRATION, key)) return;
    if (QUARANTINED_LEGACY_LOGICAL_KEYS.includes(key)) return;
    if (!VAULT_MIGRATION_LOGICAL_KEYS.includes(key)) missing.push(`${key} (${file})`);
  });
  // A scoped business key outside the allowlist survives migration in plaintext.
  expect(missing).toEqual([]);
});

test("the live-draft edit stash is migrated alongside the draft it copies", () => {
  // The stash holds a verbatim copy of the estimate draft. Encrypting one and
  // not the other would leave the same content in plaintext on disk.
  expect(VAULT_MIGRATION_LOGICAL_KEYS).toContain("estipaid-estimate-draft-v1");
  expect(VAULT_MIGRATION_LOGICAL_KEYS).toContain("estipaid-live-draft-edit-stash-v1");
});

test("the migration allowlist excludes every device-global and quarantined key", () => {
  DEVICE_GLOBAL_LOGICAL_KEYS.forEach((key) => {
    expect(VAULT_MIGRATION_LOGICAL_KEYS).not.toContain(key);
  });
  QUARANTINED_LEGACY_LOGICAL_KEYS.forEach((key) => {
    expect(VAULT_MIGRATION_LOGICAL_KEYS).not.toContain(key);
  });
});

test("the migration allowlist contains no duplicate and only workspace-scoped keys", () => {
  expect(new Set(VAULT_MIGRATION_LOGICAL_KEYS).size).toBe(VAULT_MIGRATION_LOGICAL_KEYS.length);
  VAULT_MIGRATION_LOGICAL_KEYS.forEach((key) => {
    expect(isWorkspaceScopedLogicalKey(key)).toBe(true);
  });
});

test("the vault idle-lock preference stays outside the vault so it is readable while locked", () => {
  expect(VAULT_MIGRATION_LOGICAL_KEYS).not.toContain("estipaid-vault-idle-lock-minutes");
  expect(EXCLUDED_FROM_MIGRATION["estipaid-vault-idle-lock-minutes"]).toMatch(/LOCKED/);
});

test("every documented exclusion is a real, non-migrated key", () => {
  Object.entries(EXCLUDED_FROM_MIGRATION).forEach(([key, reason]) => {
    expect(VAULT_MIGRATION_LOGICAL_KEYS).not.toContain(key);
    expect(typeof reason).toBe("string");
    expect(reason.length).toBeGreaterThan(10);
  });
});

test("classification is exhaustive and mutually exclusive for known keys", () => {
  expect(classifyLogicalKey("estipaid-customers-v1", options)).toBe("migrated-workspace-business");
  expect(classifyLogicalKey("estipaid-lang", options)).toBe("device-global");
  expect(classifyLogicalKey("estipaid-vault-guard-v1", options)).toBe("device-global");
  expect(classifyLogicalKey("field-pocket-customers-v1", options)).toBe("quarantined-legacy");
  expect(classifyLogicalKey("estipaid-workspace-v2", options)).toBe("structural-identifier");
  expect(classifyLogicalKey("estipaid-vault-idle-lock-minutes", options)).toBe("excluded-non-business");
  expect(classifyLogicalKey("estipaid-brand-new-key-v1", options)).toBe("unclassified");
  expect(classifyLogicalKey("", options)).toBe("invalid");
});
