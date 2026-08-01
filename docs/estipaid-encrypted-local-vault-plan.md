# EstiPaid Encrypted Local Vault — Design Plan

Status: **planned, not implemented.** This document describes the gate that must
land before EstiPaid can be approved for Production. It is documentation only —
nothing here runs.

## What ISO-14D actually delivered

ISO-14D gives every authenticated account its own local workspace namespace,
derived from immutable authenticated identity:

```
estipaid-workspace-v2:<user UUID>:<company UUID>:<logical key>
```

That is **containment, not encryption.**

- It stops one account from reading another account's records on a shared
  browser.
- It stops a new account from silently adopting pre-existing unscoped data.
- It does **not** protect anything from someone who has access to the device or
  the browser profile. Every value is still plaintext in local storage, readable
  from devtools in one command.

**Plaintext business storage cannot be approved for final Production.** The
containment boundary is a prerequisite for the vault, not a substitute for it.

## The next gate: an encrypted IndexedDB vault

The following gate replaces plaintext local storage for business data with an
encrypted vault in IndexedDB.

- Business records are stored as ciphertext blobs. Nothing readable is written
  outside the vault.
- The encryption key is derived from a **separate Local Data Password or
  passkey**, established by the account owner specifically for this device.
- Key derivation uses a memory-hard KDF with a per-workspace random salt. The
  derived key lives in memory for the session only and is never persisted.
- The vault is bound to the same immutable identity pair as the ISO-14D
  namespace (user UUID + company UUID).

### Why a separate password

**Supabase login passwords are never available to the app.** Authentication
happens against Supabase, which returns a session token — the password itself
never reaches EstiPaid's JavaScript in a form that could be used as key
material, and deliberately so. A local vault key therefore cannot be derived
from the login password. It requires its own secret:

- a Local Data Password chosen by the owner for this device, or
- a passkey / WebAuthn credential unlocking a stored key.

Any design that claims to encrypt local data using the Supabase login password
is incorrect. Do not implement a password field in an earlier gate to imply
protection that does not exist — a partial or decorative password prompt is
worse than none, because it invites the owner to trust it.

## Ownership identity

- The **immutable user UUID and company UUID** are the authenticated ownership
  identity. They determine both the ISO-14D namespace and the vault binding.
- **Username and email are display metadata only.** They are mutable, they are
  not authorization, and they must never appear in a storage key, a namespace,
  or a key-derivation input.
- Company name, access tokens, refresh tokens, Supabase URL, and Stripe
  identifiers are likewise excluded from all storage identity.

## Legacy unscoped data

Pre-existing unscoped keys (`estipaid-company-profile-v1`,
`estipaid-customers-v1`, `estipaid-estimates-v1`, and the rest) remain
**quarantined**: not read, not parsed, not counted, not copied, not backed up,
not deleted, and not reachable by any cloud or device worker.

They stay that way until a separately reviewed design provides both of:

1. **Verified original-account ownership** — proof that the account asking for
   the data is the account that created it, not merely an account that happens
   to be signed in on the same browser.
2. **Successful decryption** under the vault key belonging to that verified
   owner.

Absent both, unscoped data is never paired with an account. There is no
"adopt this data" affordance, and adding one requires its own review.

## Rollout rule

**No plaintext fallback is permitted after encrypted-vault rollout.** Once the
vault ships, a workspace that cannot open its vault fails closed — it does not
degrade to reading or writing plaintext local storage. A missing or unreadable
vault means no data, not old data.
