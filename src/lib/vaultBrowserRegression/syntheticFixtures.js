// ISO-15I -- TEST-ONLY synthetic fixture set for the real-browser vault
// regression harness.
//
// Statically unreachable from App.js, index.js, any screen, any hook, any
// listener, any worker, and any Production build entry.
//
// EVERY value here is synthetic and disposable. There is no real user id, no
// real company id, no real company name, and no real customer, project,
// estimate, invoice, or payment data. The identities below are fixed synthetic
// UUIDs used only to derive a disposable local namespace inside an isolated
// browser profile.

import {
  QUARANTINED_LEGACY_LOGICAL_KEYS,
  buildAccountWorkspaceNamespace,
} from "../accountScopedLocalStorage";
import { VAULT_MIGRATION_LOGICAL_KEYS } from "../vaultIndexedDbRepository";

export const SYNTHETIC_ACTIVE_IDENTITY = Object.freeze({
  userId: "00000000-0000-4000-8000-000000000001",
  companyId: "00000000-0000-4000-8000-0000000000a1",
  password: "synthetic-harness-local-data-password-1",
});

export const SYNTHETIC_FOREIGN_IDENTITY = Object.freeze({
  userId: "00000000-0000-4000-8000-000000000002",
  companyId: "00000000-0000-4000-8000-0000000000a2",
  password: "synthetic-harness-local-data-password-2",
});

export const SYNTHETIC_THIRD_IDENTITY = Object.freeze({
  userId: "00000000-0000-4000-8000-000000000003",
  companyId: "00000000-0000-4000-8000-0000000000a3",
  password: "synthetic-harness-local-data-password-3",
});

// Fixture categories A..R from the ISO-15I fixture requirement.
export const FIXTURE_CATEGORIES = Object.freeze({
  A: "empty-active-workspace",
  B: "mixed-presence-active-workspace",
  ALL_APPROVED: "all-approved-active-workspace",
  C: "present-empty-string-values",
  D: "absent-values",
  E: "unicode-multibyte-utf8",
  F: "combining-characters",
  G: "emoji-supplementary-plane",
  H: "large-repository-valid-value",
  I: "foreign-account-scoped-namespace",
  J: "bare-unscoped-estipaid-legacy",
  K: "field-pocket-quarantined-legacy",
  L: "device-global-language",
  M: "device-global-identifier",
  N: "synthetic-supabase-shaped-auth-keys",
  O: "unrelated-third-party-local-storage",
  P: "unrelated-indexeddb-database",
  Q: "second-workspace-vault",
  R: "unrelated-transition-free-vault-database",
});

export const UNRELATED_INDEXED_DB_NAME = "synthetic-unrelated-store-v1";

// Deliberately shaped like a Supabase auth key without being one: the value is a
// fixed synthetic string, never a token, and never parsed by anything.
export const SYNTHETIC_AUTH_SHAPED_KEYS = Object.freeze([
  "sb-synthetic-local-auth-token",
  "sb-synthetic-local-auth-token.0",
]);

export const UNRELATED_LOCAL_STORAGE_KEYS = Object.freeze([
  "synthetic-third-party-preference",
  "synthetic-analytics-optout",
]);

export const BARE_LEGACY_ESTIPAID_KEYS = Object.freeze([
  "estipaid-customers-v1",
  "estipaid-company-profile-v1",
  "estipaid-estimates-v1",
]);

const UNICODE_VALUE = '{"note":"acentuación española · ünïcödé · Ελληνικά · Кириллица · 日本語テキスト"}';
const COMBINING_VALUE = '{"note":"é à ñ ô ü · Å · ç · combining sequence"}';
const EMOJI_VALUE = '{"note":"🧰🚧🏗️👷🏽‍♀️ · 𝔘𝔫𝔦𝔠𝔬𝔡𝔢 · 𠜎𠜱𠝹 · 🇪🇸"}';

// 64 KiB of repository-valid content: well under the 1 MiB ciphertext ceiling
// enforced by the vault record contract, but far beyond a trivial payload.
function largeValue() {
  return JSON.stringify({ note: "synthetic-large-fixture", body: "x".repeat(64 * 1024) });
}

// The approved business keys, assigned deterministic synthetic shapes so that
// present-empty (C), absent (D), unicode (E), combining (F), emoji (G), and
// large (H) are all represented inside the migration allowlist itself.
export function buildMixedPresenceWorkspaceValues() {
  const values = {};
  VAULT_MIGRATION_LOGICAL_KEYS.forEach((logicalKey, index) => {
    const slot = index % 6;
    if (slot === 0) values[logicalKey] = "";                                   // C present-empty
    else if (slot === 1) return;                                               // D absent
    else if (slot === 2) values[logicalKey] = UNICODE_VALUE;                   // E
    else if (slot === 3) values[logicalKey] = COMBINING_VALUE;                 // F
    else if (slot === 4) values[logicalKey] = EMOJI_VALUE;                     // G
    else values[logicalKey] = JSON.stringify({ note: "synthetic", index });
  });
  // H -- exactly one large value, on a stable approved key.
  values["estipaid-audit-events-v1"] = largeValue();
  return Object.freeze(values);
}

// The all-approved baseline is intentionally separate from the mixed fixture:
// it proves the migration handles every current allowlisted key, including a
// deterministic present-empty value, without conflating that claim with absent
// value coverage.
export function buildAllApprovedWorkspaceValues() {
  const values = {};
  VAULT_MIGRATION_LOGICAL_KEYS.forEach((logicalKey, index) => {
    const slot = index % 6;
    if (slot === 0) values[logicalKey] = "";
    else if (slot === 1) values[logicalKey] = UNICODE_VALUE;
    else if (slot === 2) values[logicalKey] = COMBINING_VALUE;
    else if (slot === 3) values[logicalKey] = EMOJI_VALUE;
    else values[logicalKey] = JSON.stringify({ note: "synthetic-all-approved", index });
  });
  values["estipaid-audit-events-v1"] = largeValue();
  if (Object.keys(values).length !== VAULT_MIGRATION_LOGICAL_KEYS.length) throw new Error("FIXTURE_ALLOWLIST_MISMATCH");
  return Object.freeze(values);
}

// Which approved logical keys the populated fixture leaves present-non-empty,
// present-empty, and absent. Only key NAMES are returned -- they are public
// source vocabulary -- so a regression scenario can target the exact state it
// claims to test instead of assuming one.
export function describeFixtureKeyRoles({ mode = "mixed" } = {}) {
  const values = mode === "all-approved" ? buildAllApprovedWorkspaceValues() : buildMixedPresenceWorkspaceValues();
  const presentNonEmpty = [];
  const presentEmpty = [];
  const absent = [];
  VAULT_MIGRATION_LOGICAL_KEYS.forEach((logicalKey) => {
    if (!Object.prototype.hasOwnProperty.call(values, logicalKey)) absent.push(logicalKey);
    else if (values[logicalKey] === "") presentEmpty.push(logicalKey);
    else presentNonEmpty.push(logicalKey);
  });
  return Object.freeze({
    presentNonEmpty: Object.freeze(presentNonEmpty),
    presentEmpty: Object.freeze(presentEmpty),
    absent: Object.freeze(absent),
  });
}

export function buildForeignWorkspaceValues() {
  return Object.freeze({
    "estipaid-customers-v1": '{"note":"synthetic-foreign-namespace-value"}',
    "estipaid-settings-v1": '{"note":"synthetic-foreign-settings"}',
    "estipaid-invoices-v1": "",
  });
}

export function buildDeviceGlobalValues() {
  return Object.freeze({
    "estipaid-lang": "es",
    "estipaid-device-id-v1": "synthetic-device-identifier-0001",
  });
}

export function buildQuarantinedLegacyValues() {
  const values = {};
  QUARANTINED_LEGACY_LOGICAL_KEYS.forEach((key, index) => {
    values[key] = JSON.stringify({ note: "synthetic-field-pocket-legacy", index });
  });
  return Object.freeze(values);
}

export function buildBareLegacyValues() {
  const values = {};
  BARE_LEGACY_ESTIPAID_KEYS.forEach((key, index) => {
    values[key] = JSON.stringify({ note: "synthetic-bare-unscoped-legacy", index });
  });
  return Object.freeze(values);
}

export function buildAuthShapedValues() {
  const values = {};
  SYNTHETIC_AUTH_SHAPED_KEYS.forEach((key, index) => {
    values[key] = JSON.stringify({ note: "synthetic-auth-shaped-placeholder", index });
  });
  return Object.freeze(values);
}

export function buildUnrelatedValues() {
  const values = {};
  UNRELATED_LOCAL_STORAGE_KEYS.forEach((key, index) => {
    values[key] = JSON.stringify({ note: "synthetic-unrelated", index });
  });
  return Object.freeze(values);
}

// Physical seeding. The fixtures are written straight to the real Storage
// object, never through the compatibility facade, because a facade write is
// exactly one of the behaviours under test.
export function seedPhysicalLocalStorage({ storage, populated = true, fixtureMode = "mixed" } = {}) {
  if (!storage || typeof storage.setItem !== "function") throw new Error("STORAGE_UNAVAILABLE");

  const activeNamespace = buildAccountWorkspaceNamespace(SYNTHETIC_ACTIVE_IDENTITY);
  const foreignNamespace = buildAccountWorkspaceNamespace(SYNTHETIC_FOREIGN_IDENTITY);
  if (!activeNamespace || !foreignNamespace) throw new Error("NAMESPACE_UNAVAILABLE");

  const seeded = { activeScoped: 0, foreignScoped: 0, bareLegacy: 0, quarantined: 0, deviceGlobal: 0, authShaped: 0, unrelated: 0 };

  if (populated) {
    const values = fixtureMode === "all-approved" ? buildAllApprovedWorkspaceValues() : buildMixedPresenceWorkspaceValues();
    Object.entries(values).forEach(([logicalKey, value]) => {
      storage.setItem(`${activeNamespace}:${logicalKey}`, value);
      seeded.activeScoped += 1;
    });
  }

  Object.entries(buildForeignWorkspaceValues()).forEach(([logicalKey, value]) => {
    storage.setItem(`${foreignNamespace}:${logicalKey}`, value);
    seeded.foreignScoped += 1;
  });
  Object.entries(buildBareLegacyValues()).forEach(([key, value]) => {
    storage.setItem(key, value);
    seeded.bareLegacy += 1;
  });
  Object.entries(buildQuarantinedLegacyValues()).forEach(([key, value]) => {
    storage.setItem(key, value);
    seeded.quarantined += 1;
  });
  Object.entries(buildDeviceGlobalValues()).forEach(([key, value]) => {
    storage.setItem(key, value);
    seeded.deviceGlobal += 1;
  });
  Object.entries(buildAuthShapedValues()).forEach(([key, value]) => {
    storage.setItem(key, value);
    seeded.authShaped += 1;
  });
  Object.entries(buildUnrelatedValues()).forEach(([key, value]) => {
    storage.setItem(key, value);
    seeded.unrelated += 1;
  });

  return Object.freeze(seeded);
}

// Fixture manifest for evidence. Category label, presence, and counts only --
// no plaintext, no namespace, no UUID.
export function describeFixtureManifest({ populated = true, fixtureMode = "mixed" } = {}) {
  const populatedValues = fixtureMode === "all-approved" ? buildAllApprovedWorkspaceValues() : buildMixedPresenceWorkspaceValues();
  const presentApproved = Object.keys(populatedValues).length;
  return Object.freeze([
    Object.freeze({ code: "A", category: FIXTURE_CATEGORIES.A, present: !populated, keyCount: populated ? 0 : 0 }),
    Object.freeze({ code: "B", category: fixtureMode === "all-approved" ? "all-approved-active-workspace" : "mixed-presence-active-workspace", present: populated, keyCount: populated ? presentApproved : 0 }),
    Object.freeze({ code: "C", category: FIXTURE_CATEGORIES.C, present: populated, keyCount: populated ? Object.values(populatedValues).filter((value) => value === "").length : 0 }),
    Object.freeze({ code: "D", category: FIXTURE_CATEGORIES.D, present: populated, keyCount: populated ? VAULT_MIGRATION_LOGICAL_KEYS.length - presentApproved : VAULT_MIGRATION_LOGICAL_KEYS.length }),
    Object.freeze({ code: "E", category: FIXTURE_CATEGORIES.E, present: populated, keyCount: populated ? Object.values(populatedValues).filter((value) => value === UNICODE_VALUE).length : 0 }),
    Object.freeze({ code: "F", category: FIXTURE_CATEGORIES.F, present: populated, keyCount: populated ? Object.values(populatedValues).filter((value) => value === COMBINING_VALUE).length : 0 }),
    Object.freeze({ code: "G", category: FIXTURE_CATEGORIES.G, present: populated, keyCount: populated ? Object.values(populatedValues).filter((value) => value === EMOJI_VALUE).length : 0 }),
    Object.freeze({ code: "H", category: FIXTURE_CATEGORIES.H, present: populated, keyCount: populated ? 1 : 0 }),
    Object.freeze({ code: "I", category: FIXTURE_CATEGORIES.I, present: true, keyCount: Object.keys(buildForeignWorkspaceValues()).length }),
    Object.freeze({ code: "J", category: FIXTURE_CATEGORIES.J, present: true, keyCount: BARE_LEGACY_ESTIPAID_KEYS.length }),
    Object.freeze({ code: "K", category: FIXTURE_CATEGORIES.K, present: true, keyCount: QUARANTINED_LEGACY_LOGICAL_KEYS.length }),
    Object.freeze({ code: "L", category: FIXTURE_CATEGORIES.L, present: true, keyCount: 1 }),
    Object.freeze({ code: "M", category: FIXTURE_CATEGORIES.M, present: true, keyCount: 1 }),
    Object.freeze({ code: "N", category: FIXTURE_CATEGORIES.N, present: true, keyCount: SYNTHETIC_AUTH_SHAPED_KEYS.length }),
    Object.freeze({ code: "O", category: FIXTURE_CATEGORIES.O, present: true, keyCount: UNRELATED_LOCAL_STORAGE_KEYS.length }),
    Object.freeze({ code: "P", category: FIXTURE_CATEGORIES.P, present: true, keyCount: 1 }),
    Object.freeze({ code: "Q", category: FIXTURE_CATEGORIES.Q, present: true, keyCount: 1 }),
    Object.freeze({ code: "R", category: FIXTURE_CATEGORIES.R, present: true, keyCount: 1 }),
  ]);
}
