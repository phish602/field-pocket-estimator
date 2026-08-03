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

import { EXCLUDED_FROM_MIGRATION } from "../constants/vaultStorageExclusions";

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
  // ISO-16 -- the authoritative runtime catalog's AAD domain separator. Like
  // every separator above it is a cryptographic constant, never a stored key.
  "estipaid-vault-runtime-catalog-v1",
  // ISO-16 -- the cross-tab BroadcastChannel name. A channel identifier, never
  // a stored value: it carries only a workspace tag, a runtime generation, and a
  // catalog revision, and it can never authorize a write.
  "estipaid-vault-runtime-v1",
]);

// Deliberately NOT migrated, with the reason each exclusion is safe.
//
// ISO-16 -- the list itself now lives in a leaf constants module so the
// account-scoped facade can enforce the SAME classification at runtime without
// creating an import cycle through this review module.
export { EXCLUDED_FROM_MIGRATION };

export function classifyLogicalKey(logicalKey, { migrationAllowlist = [], deviceGlobal = [], quarantined = [] } = {}) {
  if (typeof logicalKey !== "string" || !logicalKey) return "invalid";
  if (STRUCTURAL_IDENTIFIERS.includes(logicalKey)) return "structural-identifier";
  if (quarantined.includes(logicalKey) || logicalKey.startsWith("field-pocket-")) return "quarantined-legacy";
  if (deviceGlobal.includes(logicalKey)) return "device-global";
  if (migrationAllowlist.includes(logicalKey)) return "migrated-workspace-business";
  if (Object.prototype.hasOwnProperty.call(EXCLUDED_FROM_MIGRATION, logicalKey)) return "excluded-non-business";
  return "unclassified";
}
