# Backend Rollback and Retry Strategy

This is a planning document only.

- No backend writes are being added.
- No Supabase SQL is being added.
- No runtime sync is being wired.

## 1. Core Safety Principles

Recommended safety principles:

- Local data is never deleted because a backend write fails.
- Preview happens before write.
- `migration_batch_id` groups write attempts.
- `legacy_local_id` preserves traceability.
- Failed writes must be visible.
- Retries must be idempotent.
- Destructive rollback must not run automatically.

## 2. Partial Write Handling

Recommended partial-write handling:

- Every write attempt should produce a result report.
- Successful writes should be recorded by entity type and id.
- Failed writes should record entity type, id, and reason.
- Dependent child writes should stop if the parent write fails.
- Partial migrations must be visible to owner/admin before retry.

## 3. Retry Strategy

Recommended retry direction:

- Retry by `migration_batch_id`.
- Retry by `legacy_local_id`.
- Skip already-confirmed successful records.
- Retry failed records only after blockers are resolved.
- Never duplicate records because a retry was run.
- Preserve backend IDs once created.

## 4. Rollback Direction

Recommended rollback direction:

- The first production approach should avoid automatic destructive rollback.
- Prefer a visible partial migration report plus safe retry.
- Rollback may be allowed only for `migration_batch_id` records that have no live user edits after migration.
- Rollback should never delete local records.
- Rollback should require owner/admin approval.
- Destructive rollback should require typed confirmation.

## 5. Failure Categories

Recommended failure categories:

- Ownership failure
- Relationship failure
- Uniqueness conflict
- Network/backend failure
- Permission/RLS failure
- Validation/schema failure
- Partial dependency failure

## 6. Retry / Rollback Decision Rules

Recommended decision rules:

- Ownership failure = block until fixed.
- Relationship failure = review/fix mapping before retry.
- Document-number collision = review policy before retry.
- Network failure = safe retry possible.
- RLS failure = fix permissions/policies before retry.
- Schema validation failure = fix schema or mapper before retry.

## 7. Reporting Requirements

Recommended report fields:

- Migration batch id
- `started_at` / `completed_at`
- Attempted record counts
- Successful record counts
- Failed record counts
- Skipped record counts
- Failure reasons
- Retry eligibility
- Rollback eligibility

## 8. Non-Goals Right Now

Do not build any of the following yet:

- Supabase writes
- SQL
- Migrations
- Runtime sync
- UI
- Backend credentials
- Automatic rollback
- Destructive cleanup tool

## 9. Open Decisions

The following items still need final decisions:

- Exact `migration_batch_id` format
- Where write result reports are stored
- Whether rollback is supported in v1
- How long migration reports are retained
- Whether failed batches block future sync
- How to handle backend records edited after migration
- Retry UI location
- Typed confirmation wording

This document is intended to define a conservative failure-handling path before any backend write or migration execution code exists.

