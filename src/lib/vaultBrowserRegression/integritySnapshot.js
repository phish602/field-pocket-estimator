// ISO-15I -- TEST-ONLY sanitized integrity snapshots for the real-browser vault
// regression harness.
//
// This module is never imported by App.js, index.js, a screen, a hook, an event
// listener, a service worker, or a cloud worker. It has no production entry and
// is statically absent from the normal build graph.
//
// Everything this module emits is sanitized by construction: it records category
// labels, presence booleans, byte counts, and SHA-256 digests. It never returns
// a plaintext value, a UUID, a workspace tag, a namespace, ciphertext, an IV, a
// salt, a wrapped key, or a token.

import {
  DEVICE_GLOBAL_LOGICAL_KEYS,
  QUARANTINED_LEGACY_LOGICAL_KEYS,
  WORKSPACE_MARKER_LOGICAL_KEY,
  WORKSPACE_NAMESPACE_PREFIX,
  isWorkspaceScopedLogicalKey,
} from "../accountScopedLocalStorage";
import { VAULT_COMPATIBILITY_GUARD_KEY } from "../vaultCompatibilityGuard";
import { WORKSPACE_VAULT_DATABASE_PREFIX } from "../vaultIndexedDbRepository";
import { VAULT_TRANSITION_CONTROL_DATABASE_NAME } from "../vaultTransitionControlRepository";

// Harness bookkeeping lives under this prefix. It is deliberately not an
// EstiPaid key, not a Field Pocket key, and not an auth-shaped key, so it can be
// excluded from every integrity category without perturbing a fixture set.
export const HARNESS_CONTROL_PREFIX = "iso15ij-harness-";

export const LOCAL_STORAGE_CATEGORIES = Object.freeze([
  "active-scoped",
  "foreign-scoped",
  // Workspace markers are rewritten by design on every activation (the marker
  // read-back is what proves a namespace belongs to the identity that opened
  // it). They are tracked apart so `active-scoped` and `foreign-scoped` stay
  // genuine byte-identity assertions over business data alone.
  "workspace-marker",
  "legacy-bare-estipaid",
  "quarantined-field-pocket",
  "device-global",
  // The compatibility guard is device-global by design AND is the one
  // device-global key migration is required to write. It is tracked separately
  // so `device-global` preservation stays a genuine byte-identity assertion for
  // the device language and the device identifier.
  "vault-guard",
  "auth-shaped",
  "unrelated",
  "harness-control",
]);

export const INDEXED_DB_CATEGORIES = Object.freeze([
  "active-workspace-vault",
  "other-workspace-vault",
  "transition-control",
  "unrelated",
  "harness-control",
]);

const NAMESPACE_PREFIX_WITH_SEPARATOR = `${WORKSPACE_NAMESPACE_PREFIX}:`;

function base64url(bytes) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let value = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    value += alphabet[a >> 2];
    value += alphabet[((a & 3) << 4) | (b >> 4)];
    if (index + 1 < bytes.length) value += alphabet[((b & 15) << 2) | (c >> 6)];
    if (index + 2 < bytes.length) value += alphabet[c & 63];
  }
  return value;
}

export function utf8Bytes(value) {
  return new Uint8Array(new TextEncoder().encode(value));
}

export async function digestBytes(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") throw new Error("SUBTLE_DIGEST_UNAVAILABLE");
  return base64url(new Uint8Array(await subtle.digest("SHA-256", bytes)));
}

// A value is described only as presence, byte count, and digest. The value
// itself never leaves this function.
export async function describeValue(rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return Object.freeze({ present: false, byteLength: null, digest: null });
  }
  const bytes = utf8Bytes(String(rawValue));
  return Object.freeze({ present: true, byteLength: bytes.length, digest: await digestBytes(bytes) });
}

// Classification is purely structural: nothing about the key's own text is
// returned, only which integrity category it belongs to.
export function categorizePhysicalKey(physicalKey, { activeNamespace = "" } = {}) {
  if (typeof physicalKey !== "string") return "unrelated";
  if (physicalKey.startsWith(HARNESS_CONTROL_PREFIX)) return "harness-control";
  if (physicalKey.startsWith(NAMESPACE_PREFIX_WITH_SEPARATOR) && physicalKey.endsWith(`:${WORKSPACE_MARKER_LOGICAL_KEY}`)) {
    return "workspace-marker";
  }
  if (activeNamespace && physicalKey.startsWith(`${activeNamespace}:`)) return "active-scoped";
  if (physicalKey.startsWith(NAMESPACE_PREFIX_WITH_SEPARATOR)) return "foreign-scoped";
  if (QUARANTINED_LEGACY_LOGICAL_KEYS.includes(physicalKey)) return "quarantined-field-pocket";
  if (physicalKey.startsWith("field-pocket-")) return "quarantined-field-pocket";
  if (physicalKey === VAULT_COMPATIBILITY_GUARD_KEY) return "vault-guard";
  if (DEVICE_GLOBAL_LOGICAL_KEYS.includes(physicalKey)) return "device-global";
  if (isWorkspaceScopedLogicalKey(physicalKey)) return "legacy-bare-estipaid";
  if (/^sb-.*-auth-token(\.\d+)?$/.test(physicalKey)) return "auth-shaped";
  return "unrelated";
}

export function categorizeDatabaseName(databaseName, { activeVaultDatabaseName = "" } = {}) {
  if (typeof databaseName !== "string") return "unrelated";
  if (databaseName.startsWith(HARNESS_CONTROL_PREFIX)) return "harness-control";
  if (databaseName === VAULT_TRANSITION_CONTROL_DATABASE_NAME) return "transition-control";
  if (activeVaultDatabaseName && databaseName === activeVaultDatabaseName) return "active-workspace-vault";
  if (databaseName.startsWith(WORKSPACE_VAULT_DATABASE_PREFIX)) return "other-workspace-vault";
  return "unrelated";
}

function emptyCategoryTotals(categories) {
  const totals = {};
  categories.forEach((category) => { totals[category] = { keyCount: 0, byteLength: 0, digest: "" }; });
  return totals;
}

// The per-category digest is order-independent in the sense that entries are
// sorted before folding, so two byte-identical stores always produce the same
// aggregate digest regardless of insertion order.
async function foldCategory(entries) {
  const parts = entries.map((entry) => [entry.slot, entry.byteLength, entry.digest].join("|")).sort();
  return digestBytes(utf8Bytes(parts.join("\n")));
}

// `slot` is a stable label. For scoped, legacy, and device-global business keys
// it is the logical key name, which is public source-level vocabulary. A foreign
// namespace contributes only its logical key name behind a `foreign:` marker, so
// the namespace -- and therefore the account identity -- never appears. Workspace
// markers and unrelated third-party keys get an ordinal only.
function slotFor(physicalKey, category, activeNamespace, ordinal) {
  if (category === "active-scoped") return physicalKey.slice(activeNamespace.length + 1);
  if (category === "foreign-scoped") {
    const segments = physicalKey.split(":");
    return segments.length === 4 ? `foreign:${segments[3]}` : `#${ordinal}`;
  }
  if (category === "legacy-bare-estipaid" || category === "quarantined-field-pocket"
    || category === "device-global" || category === "vault-guard") {
    return physicalKey;
  }
  return `#${ordinal}`;
}

export async function snapshotLocalStorage({ storage, activeNamespace = "" } = {}) {
  if (!storage || typeof storage.key !== "function") throw new Error("STORAGE_UNAVAILABLE");
  const totals = emptyCategoryTotals(LOCAL_STORAGE_CATEGORIES);
  const buckets = {};
  LOCAL_STORAGE_CATEGORIES.forEach((category) => { buckets[category] = []; });
  const ordinals = {};
  LOCAL_STORAGE_CATEGORIES.forEach((category) => { ordinals[category] = 0; });

  const physicalKeys = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (typeof key === "string") physicalKeys.push(key);
  }
  physicalKeys.sort();

  for (const physicalKey of physicalKeys) {
    const category = categorizePhysicalKey(physicalKey, { activeNamespace });
    const described = await describeValue(storage.getItem(physicalKey));
    const slot = slotFor(physicalKey, category, activeNamespace, (ordinals[category] += 1));
    buckets[category].push({ slot, byteLength: described.byteLength ?? 0, digest: described.digest ?? "" });
    totals[category].keyCount += 1;
    totals[category].byteLength += described.byteLength ?? 0;
  }

  for (const category of LOCAL_STORAGE_CATEGORIES) {
    totals[category].digest = await foldCategory(buckets[category]);
  }
  return Object.freeze({ categories: totals, entries: buckets });
}

export async function snapshotIndexedDbNames({ indexedDb, activeVaultDatabaseName = "" } = {}) {
  const factory = indexedDb || globalThis.indexedDB;
  if (!factory || typeof factory.databases !== "function") throw new Error("INDEXEDDB_UNAVAILABLE");
  const databases = await factory.databases();
  const totals = {};
  INDEXED_DB_CATEGORIES.forEach((category) => { totals[category] = 0; });
  databases.forEach((entry) => {
    const category = categorizeDatabaseName(entry?.name, { activeVaultDatabaseName });
    totals[category] += 1;
  });
  return Object.freeze({ databaseCount: databases.length, categories: totals });
}

// Compares two snapshots for the categories that must never change. Returns a
// sanitized verdict: category label, expected/actual counts and digests only.
export function compareCategories(baseline, current, categories) {
  const findings = [];
  categories.forEach((category) => {
    const before = baseline?.categories?.[category];
    const after = current?.categories?.[category];
    const identical = Boolean(before) && Boolean(after)
      && before.keyCount === after.keyCount
      && before.byteLength === after.byteLength
      && before.digest === after.digest;
    findings.push(Object.freeze({
      category,
      identical,
      baselineKeyCount: before?.keyCount ?? null,
      currentKeyCount: after?.keyCount ?? null,
      baselineByteLength: before?.byteLength ?? null,
      currentByteLength: after?.byteLength ?? null,
      digestMatches: (before?.digest ?? null) === (after?.digest ?? null),
    }));
  });
  return Object.freeze({
    allIdentical: findings.every((finding) => finding.identical),
    findings: Object.freeze(findings),
  });
}
