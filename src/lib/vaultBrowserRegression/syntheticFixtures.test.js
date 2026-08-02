import {
  BARE_LEGACY_ESTIPAID_KEYS,
  FIXTURE_CATEGORIES,
  SYNTHETIC_ACTIVE_IDENTITY,
  SYNTHETIC_FOREIGN_IDENTITY,
  SYNTHETIC_THIRD_IDENTITY,
  buildPopulatedWorkspaceValues,
  describeFixtureKeyRoles,
  describeFixtureManifest,
  seedPhysicalLocalStorage,
} from "./syntheticFixtures";
import {
  QUARANTINED_LEGACY_LOGICAL_KEYS,
  buildAccountWorkspaceNamespace,
} from "../accountScopedLocalStorage";
import { VAULT_MIGRATION_LOGICAL_KEYS } from "../vaultIndexedDbRepository";
import { categorizePhysicalKey } from "./integritySnapshot";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function memoryStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

test("the three synthetic identities are distinct disposable UUID pairs", () => {
  [SYNTHETIC_ACTIVE_IDENTITY, SYNTHETIC_FOREIGN_IDENTITY, SYNTHETIC_THIRD_IDENTITY].forEach((identity) => {
    expect(identity.userId).toMatch(UUID);
    expect(identity.companyId).toMatch(UUID);
  });
  const namespaces = [SYNTHETIC_ACTIVE_IDENTITY, SYNTHETIC_FOREIGN_IDENTITY, SYNTHETIC_THIRD_IDENTITY]
    .map((identity) => buildAccountWorkspaceNamespace(identity));
  expect(new Set(namespaces).size).toBe(3);
});

test("the populated workspace covers present-empty, absent, unicode, combining, emoji, and large values", () => {
  const values = buildPopulatedWorkspaceValues();
  const present = Object.keys(values);
  const absent = VAULT_MIGRATION_LOGICAL_KEYS.filter((key) => !present.includes(key));

  expect(present.every((key) => VAULT_MIGRATION_LOGICAL_KEYS.includes(key))).toBe(true);
  expect(absent.length).toBeGreaterThan(0);
  expect(Object.values(values).some((value) => value === "")).toBe(true);
  expect(Object.values(values).some((value) => /[á-ü]/.test(value))).toBe(true);
  expect(Object.values(values).some((value) => /\u{1F9F0}/u.test(value))).toBe(true);
  expect(Object.values(values).some((value) => /[\u{20000}-\u{2A6DF}]/u.test(value))).toBe(true);

  const large = values["estipaid-audit-events-v1"];
  expect(new TextEncoder().encode(large).length).toBeGreaterThan(64 * 1024);
  // Every value must stay inside the repository's 1 MiB ciphertext ceiling.
  Object.values(values).forEach((value) => {
    expect(new TextEncoder().encode(value).length).toBeLessThan(1048576 - 16);
  });
});

test("fixture key roles partition the approved allowlist exactly once", () => {
  const roles = describeFixtureKeyRoles();
  const combined = [...roles.presentNonEmpty, ...roles.presentEmpty, ...roles.absent].sort();
  expect(combined).toEqual([...VAULT_MIGRATION_LOGICAL_KEYS].sort());
  expect(new Set(combined).size).toBe(VAULT_MIGRATION_LOGICAL_KEYS.length);
  expect(roles.presentNonEmpty.length).toBeGreaterThan(0);
  expect(roles.presentEmpty.length).toBeGreaterThan(0);
  expect(roles.absent.length).toBeGreaterThan(0);

  const values = buildPopulatedWorkspaceValues();
  roles.presentNonEmpty.forEach((key) => expect(values[key].length).toBeGreaterThan(0));
  roles.presentEmpty.forEach((key) => expect(values[key]).toBe(""));
  roles.absent.forEach((key) => expect(Object.prototype.hasOwnProperty.call(values, key)).toBe(false));
});

test("seeding writes every required fixture category to the correct physical namespace", () => {
  const storage = memoryStorage();
  const seeded = seedPhysicalLocalStorage({ storage, populated: true });
  const activeNamespace = buildAccountWorkspaceNamespace(SYNTHETIC_ACTIVE_IDENTITY);

  const categories = new Set(
    [...storage.values.keys()].map((key) => categorizePhysicalKey(key, { activeNamespace })),
  );
  expect(categories).toEqual(new Set([
    "active-scoped", "foreign-scoped", "legacy-bare-estipaid",
    "quarantined-field-pocket", "device-global", "auth-shaped", "unrelated",
  ]));
  // Seeding writes business fixtures only; markers appear at activation.
  expect(categories.has("workspace-marker")).toBe(false);

  expect(seeded.activeScoped).toBe(Object.keys(buildPopulatedWorkspaceValues()).length);
  expect(seeded.bareLegacy).toBe(BARE_LEGACY_ESTIPAID_KEYS.length);
  expect(seeded.quarantined).toBe(QUARANTINED_LEGACY_LOGICAL_KEYS.length);
  expect(seeded.deviceGlobal).toBe(2);
});

test("an empty active workspace seeds no approved business key but keeps every other category", () => {
  const storage = memoryStorage();
  const seeded = seedPhysicalLocalStorage({ storage, populated: false });
  const activeNamespace = buildAccountWorkspaceNamespace(SYNTHETIC_ACTIVE_IDENTITY);
  expect(seeded.activeScoped).toBe(0);
  expect([...storage.values.keys()].some((key) => key.startsWith(`${activeNamespace}:`))).toBe(false);
  expect(seeded.foreignScoped).toBeGreaterThan(0);
  expect(seeded.quarantined).toBeGreaterThan(0);
});

test("the fixture manifest enumerates categories A through R without any plaintext value", () => {
  const manifest = describeFixtureManifest({ populated: true });
  expect(manifest.map((entry) => entry.code)).toEqual(
    "ABCDEFGHIJKLMNOPQR".split(""),
  );
  manifest.forEach((entry) => {
    expect(Object.keys(entry).sort()).toEqual(["category", "code", "keyCount", "present"]);
    expect(Object.values(FIXTURE_CATEGORIES)).toContain(entry.category);
  });
  const serialized = JSON.stringify(manifest);
  expect(serialized).not.toContain(SYNTHETIC_ACTIVE_IDENTITY.userId);
  expect(serialized).not.toContain(SYNTHETIC_ACTIVE_IDENTITY.password);
  expect(serialized).not.toContain("🧰");
});

test("no fixture password is ever exported inside the manifest or the value builders", () => {
  const serialized = JSON.stringify({
    manifest: describeFixtureManifest({}),
    values: buildPopulatedWorkspaceValues(),
  });
  [SYNTHETIC_ACTIVE_IDENTITY, SYNTHETIC_FOREIGN_IDENTITY, SYNTHETIC_THIRD_IDENTITY].forEach((identity) => {
    expect(serialized).not.toContain(identity.password);
    expect(serialized).not.toContain(identity.userId);
    expect(serialized).not.toContain(identity.companyId);
  });
});
