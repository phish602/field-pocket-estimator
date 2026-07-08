# Backend Schema Proposal

This is a planning document only.

- No backend code is being added.
- No Supabase schema is being created yet.
- No runtime sync is being wired.

## 1. Proposed Core Tables

Recommended core tables for the first backend pass:

- `companies`
- `company_users`
- `customers`
- `projects`
- `estimates`
- `estimate_line_items`
- `invoices`
- `invoice_line_items`
- `invoice_payments`
- `scope_templates`
- `app_settings`
- `audit_events`

## 2. Ownership Model

Recommended ownership fields:

- `company_id` on all company-owned records
- `user_id` or `created_by` where actor ownership matters
- `legacy_local_id` to preserve migration traceability from localStorage data

Ownership goals:

- Keep the company as the business boundary.
- Keep the user as the actor boundary.
- Preserve local identifiers for import and support tracing.

## 3. Relationship Rules

Recommended relationship rules:

- A customer can have many projects.
- A project can have many estimates and invoices.
- Estimates and invoices can optionally link to a project.
- Invoices can optionally reference a source estimate.
- Invoice payments belong to invoices.
- Line items belong to their parent document.

## 4. Delete / Archive Rules

Recommended lifecycle rules:

- Projects should support archive/soft-delete.
- Hard delete should be blocked when real documents exist.
- Estimates and invoices should not be deleted casually after being sent, approved, paid, or otherwise finalized.
- Audit records should be preserved.

## 5. Document Numbering Strategy

Recommended numbering model:

- Estimate numbers and invoice numbers are separate.
- Uniqueness should likely be company-scoped.
- Legacy document numbers should be preserved during migration.
- Collisions should be flagged before migration.

## 6. Status / Lifecycle Fields

Recommended canonical lifecycle values:

- Projects: `draft`, `estimating`, `active`, `completed`, `archived`
- Estimates: `draft`, `pending`, `sent`, `approved`, `lost`, and related lifecycle states if later required
- Invoices: `draft`, `sent`, `partial`, `paid`, `overdue`, `void`, and related lifecycle states if later required

## 7. Migration Fields

Recommended migration traceability fields:

- `legacy_local_id`
- `legacy_project_id`
- `legacy_customer_id`
- `legacy_estimate_id`
- `legacy_invoice_id`
- `migration_batch_id`
- `migrated_at`

These fields are intended to preserve lineage between local records and future backend rows.

## 8. Safety Constraints

Migration and sync should obey these constraints:

- No silent overwrite.
- No orphaned payments.
- No orphaned line items.
- No missing ownership IDs.
- No destructive migration without preview approval.

## 9. Open Decisions

Before implementation, these items still need to be finalized:

- Exact Supabase table names
- RLS ownership model
- Company/user invite model
- Document-number collision policy
- Archive vs soft-delete fields
- Payment reconciliation behavior
- Offline/local-first sync strategy

## 10. Non-Goals Right Now

Do not build any of the following yet:

- Supabase migrations
- SQL
- RLS policies
- backend writes
- runtime sync
- UI implementation

This document is intended to stay ahead of implementation and define the schema direction before any backend code exists.

