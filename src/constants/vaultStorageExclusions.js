// ISO-16 -- workspace-scoped keys that are deliberately NOT vaulted, with the
// reason each exclusion is safe.
//
// This is a leaf module with no imports so both the account-scoped facade and
// the storage-classification review can share one list without an import cycle.
//
// A key here is scoped to the account namespace but stays in plaintext local
// storage. That is only ever acceptable for NON-BUSINESS state, and every entry
// must justify itself.

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

export function isDocumentedStorageExclusion(logicalKey) {
  return Object.prototype.hasOwnProperty.call(EXCLUDED_FROM_MIGRATION, logicalKey);
}
