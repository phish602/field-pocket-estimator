# Supabase SQL Draft Decisions V1

This is a planning / decision artifact only.

- Not deployed SQL.
- Not a migration.
- Not runtime wiring.
- No backend writes are being added.

This document resolves the remaining decisions needed before a future SQL migration draft is created.

## 1. Decision Summary

- Ready for SQL migration draft: yes with conditions
- Reason: The schema/RLS planning docs are sufficiently aligned to draft SQL structure, but a few implementation details still remain intentionally open and must stay review-gated before any execution path exists.

## 2. Decisions Resolved or Explicitly Pending

- Exact UUID/default strategy: resolved for draft purposes - use UUID primary keys in the SQL draft; preserve local legacy IDs in dedicated trace fields.
- Final enum/check constraint names: pending - use check constraints first in the draft unless enum rigidity is explicitly chosen later.
- Exact archive/soft-delete field names: pending - keep archive/soft-delete as reviewed draft behavior, but final field names remain open.
- Exact RLS helper function names, if any: pending - helper naming should be finalized during SQL drafting, not before.
- Whether viewers can export PDFs: pending - keep aligned with the permissions matrix and decide in the SQL/RLS draft review.
- Whether members can archive projects: pending - preserve as an open policy decision.
- Whether admins can manage billing/users: resolved for draft purposes - admins may manage users and limited company operations, but billing/company ownership control remains owner-first.
- Attachment/photo storage strategy: pending - reserve metadata-only or future-table handling in the first SQL draft rather than full implementation.
- Final `migration_batch_id` format: pending - the draft should include a stable batch identifier, but exact format remains open.
- Where migration reports are stored: pending - the draft should support report persistence, but the final storage location remains open.

## 3. Document Numbering Decision

- Estimates and invoices use separate company-scoped number spaces.
- Document numbers must not collide within their own type and company.
- The SQL draft should support collision detection or uniqueness constraints.
- Estimate and invoice number spaces should not be merged unless explicitly decided later.

## 4. Status / Lifecycle Decision

- Projects should support `draft` / `estimating` / `active` / `completed` / `archived`, or the current app-equivalent values.
- Estimates should support `draft` / `pending` / `sent` / `approved` / `lost`, or the current app-equivalent values.
- Invoices should support `draft` / `sent` / `partial` / `paid` / `overdue` / `void`, or the current app-equivalent values.
- The first SQL draft may use check constraints before enums, unless enum rigidity is intentionally chosen later.
- Paid, partial, and void invoice states require stricter update handling later.

## 5. Ownership / Identity Decision

- `company_id` is required on company-scoped records.
- `company_users` controls membership.
- `user_id` should be present where creator or actor identity matters.
- `legacy_local_id` must be preserved for migrated local records.
- `migration_batch_id` must be preserved for migration traceability.

## 6. Archive / Delete Decision

- Archive / soft-delete should be preferred over hard delete for real records.
- Hard delete should be blocked for projects and documents with linked records or payments.
- Audit events should be append-only.
- Payments should not be casually deleted.

## 7. Attachment / Photo Decision

- Do not include full attachment or photo storage implementation in the first SQL draft unless required.
- The SQL draft may reserve metadata fields or a future attachment-table decision.
- Scope photo runtime and PDF behavior remain untouched.

## 8. Approval Gate

- The SQL migration draft may be created only if this document says ready or ready with conditions.
- Runtime wiring remains blocked.
- Credentials remain blocked.
- Production deployment remains blocked.
- SQL and RLS drafts must still be separately reviewed before execution.

## 9. Non-Goals

Do not build any of the following yet:

- SQL
- Supabase policies
- Migrations
- Runtime auth
- UI permission gates
- Backend writes
- Schema deployment
- Credentials

This document is intended to settle the remaining SQL-drafting decisions without starting implementation.

