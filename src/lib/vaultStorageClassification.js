// ISO-15J -- the complete classification of every EstiPaid logical storage key.
//
// The ISO-14D facade decides what is workspace-scoped from the key's SHAPE:
// anything starting with `estipaid-` that is not device-global is routed into
// the active account namespace. That rule is deliberately broad, which means a
// new key becomes account-scoped business data the moment it is written --
// including keys declared as module-local constants inside a screen rather than
// in src/constants/storageKeys.js.
//
// The migration allowlist, by contrast, is an explicit enumeration. Any scoped
// business key missing from it stays in PLAINTEXT after migration claims
// authority, because cleanup only removes what the manifest enumerated.
//
// This module closes that gap: every `estipaid-*` key present in application
// source must appear in exactly one bucket below, and
// vaultStorageClassification.test.js fails the build if a new one appears
// unclassified. This module is data only. It is not imported by App.js,
// index.js, any screen, any hook, any listener, or any worker, so it adds
// nothing to the Production bundle.

// Structural identifiers: namespace prefixes, database names, and cryptographic
// domain separators. These are never a stored workspace value.
export const STRUCTURAL_IDENTIFIERS = Object.freeze([
  "estipaid-workspace-v2",
  "estipaid-workspace-marker-v1",
  "estipaid-vault-v1-",
  "estipaid-vault-control-v1",
  "estipaid-vault-workspace-v1",
  "estipaid-vault-record-v1",
  "estipaid-vault-key-wrap-v1",
  "estipaid-vault-sentinel-v1",
  "estipaid-vault-migration-manifest-v1",
]);

// Deliberately NOT migrated, with the reason each exclusion is safe.
export const EXCLUDED_FROM_MIGRATION = Object.freeze({
  "estipaid-lang": "device-global: a device keeps its language across accounts",
  "estipaid-device-id-v1": "device-global: stable device identity, not workspace data",
  "estipaid-vault-guard-v1": "device-global compatibility guard; migration writes it, never migrates it",
  "estipaid-vault-idle-lock-minutes":
    "vault UI preference that must stay readable while the vault is LOCKED; encrypting it would make it unreadable exactly when it is needed. Documented as non-secret and identity-free.",
  "estipaid-storage-migrated-v1": "bookkeeping flag from the pre-ISO-14D storage migration; carries no business content",
  "estipaid-home-restore-prompt-dismissed-v1": "UI dismissal flag; boolean only",
  "estipaid-dev-cloud-tools-v1": "developer tool flag; not business data and not present in normal use",
  "estipaid-dev-sample-registry-v1": "developer sample-data bookkeeping; not business data",
});

export function classifyLogicalKey(logicalKey, { migrationAllowlist = [], deviceGlobal = [], quarantined = [] } = {}) {
  if (typeof logicalKey !== "string" || !logicalKey) return "invalid";
  if (STRUCTURAL_IDENTIFIERS.includes(logicalKey)) return "structural-identifier";
  if (quarantined.includes(logicalKey) || logicalKey.startsWith("field-pocket-")) return "quarantined-legacy";
  if (deviceGlobal.includes(logicalKey)) return "device-global";
  if (migrationAllowlist.includes(logicalKey)) return "migrated-workspace-business";
  if (Object.prototype.hasOwnProperty.call(EXCLUDED_FROM_MIGRATION, logicalKey)) return "excluded-non-business";
  return "unclassified";
}
