# Backend Offline Conflict Strategy

This is a planning document only.

- No backend writes are being added.
- No Supabase SQL is being added.
- No runtime sync is being wired.

## 1. Core Principles

Recommended principles:

- Local data must not be silently overwritten.
- Backend data must not be silently overwritten.
- `legacy_local_id` preserves traceability.
- `updated_at` / `created_at` timestamps matter, but are not enough alone.
- Financial records need stricter conflict handling.
- Preview and report before first migration.
- User/admin review is required for risky conflicts.

## 2. Conflict Categories

Recommended conflict categories:

- Same `legacy_local_id` changed locally and remotely
- Same document number but different record
- Local project/customer relationship differs from backend
- Invoice payment mismatch
- Estimate/invoice status mismatch
- Deleted or archived locally but active remotely
- Active locally but archived or deleted remotely
- Local record missing backend owner/company
- Backend record missing legacy mapping
- Attachment/photo payload mismatch

## 3. Recommended Resolution Direction

Recommended resolution direction:

- Company/profile settings: manual review if both changed.
- Customers/projects: prefer newest only when relationship is unchanged.
- Estimates/invoices: require manual review for status, total, or payment conflicts.
- Invoice payments: never auto-delete or overwrite payment records.
- Audit events: append-only, never overwrite.
- Scope templates/settings: allow merge only when safe.

## 4. Sync Modes

Recommended sync modes:

- Dry-run only
- Preview and report
- Manual approval
- One-way migration
- Future two-way sync, not v1

## 5. First Backend Version Recommendation

Recommended first version:

- Start with one-way migration from local to backend after preview approval.
- Do not ship full automatic two-way sync first.
- Do not auto-resolve financial conflicts.
- Do not delete local data after migration.

## 6. Conflict Report Requirements

Recommended report fields:

- Entity type
- Local id
- Backend id, if known
- Conflict type
- Local value
- Backend value
- Recommended action
- Severity
- Requires owner/admin review

## 7. Blocked Automatic Actions

Recommended blocked actions:

- Auto-overwrite paid invoices
- Auto-delete payments
- Auto-merge customers with different IDs
- Auto-reassign documents across customers/projects
- Auto-delete archived or deleted records
- Auto-resolve document-number collisions

## 8. Open Decisions

The following items still need final decisions:

- Final sync direction
- Whether offline-first remains primary after backend launch
- Whether localStorage remains a cache after auth
- Backend conflict table/report storage
- User-facing conflict review UI
- Exact timestamp/version fields
- Attachment/photo backend storage strategy

## 9. Non-Goals Right Now

Do not build any of the following yet:

- Supabase writes
- SQL
- Migrations
- Runtime sync
- UI
- Backend credentials
- Automatic conflict resolver

This document is intended to keep the future sync model conservative, visible, and safe for contractor data.

