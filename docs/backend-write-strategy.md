# Backend Write Strategy

This is a planning document only.

- No backend writes are being added.
- No Supabase SQL is being added.
- No runtime sync is being wired.

## 1. Write Principles

Recommended principles for the future write path:

- Run a dry-run preview before any write.
- Never silently overwrite existing backend records.
- Never perform a destructive write without confirmation.
- Require company ownership for company-scoped writes.
- Preserve `legacy_local_id` for traceability.
- Write in safe dependency order.
- Collect and report failures.
- Keep local data untouched during the first migration write attempts.

## 2. Future Write Order

Recommended write order:

1. company
2. company users / memberships
3. customers
4. projects
5. estimates
6. estimate line items
7. invoices
8. invoice line items
9. invoice payments
10. scope templates
11. app settings
12. audit events

## 3. Dependency Rules

Recommended dependency order rules:

- A company must exist before company-owned records.
- Customers must exist before linked projects or documents.
- Projects must exist before linked estimates or invoices when project-linked.
- Documents must exist before line items.
- Invoices must exist before invoice payments.
- Source-estimate references must be resolved safely.

## 4. Conflict Rules

Recommended conflict handling:

- Duplicate `legacy_local_id` values should not silently overwrite backend records.
- Document-number collisions should be reviewed before write.
- Missing ownership IDs should block write.
- Broken required relationships should block write.
- Broken optional relationships may write only if explicitly reviewed.

## 5. Failure Handling

Recommended failure behavior:

- Stop on blocker failures.
- Capture failed entity type and id.
- Capture the error reason.
- Do not continue dependent writes after a parent failure.
- Produce a write result report.
- Never delete local data because a backend write failed.

## 6. Rollback / Retry Direction

Recommended rollback and retry direction:

- The first implementation should prefer an idempotent upsert strategy only after schema approval.
- Retry should be safe by `migration_batch_id` and `legacy_local_id`.
- Rollback strategy must be decided before production migration.
- Partial migration must be visible in the report.

## 7. Confirmation Gates

Recommended approval gates before write execution:

- Preview reviewed
- Blockers resolved
- Dry-run report accepted
- Typed confirmation for irreversible or destructive actions
- Owner/admin approval for migration execution

## 8. Non-Goals Right Now

Do not build any of the following yet:

- Supabase writes
- SQL
- Migrations
- Runtime sync
- UI
- Backend credentials
- Automatic conflict resolution

## 9. Open Decisions

The following items still need final decisions:

- Insert vs upsert strategy
- `migration_batch_id` format
- Rollback method
- Retry method
- Partial write handling
- Backend uniqueness constraints
- Source-estimate to invoice linkage behavior
- Attachment/photo storage strategy later

This document should remain a practical guide for safe future write execution, not an implementation spec.

