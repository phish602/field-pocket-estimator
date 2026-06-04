# Supabase Executable Migration Package Review Checklist V1

This checklist artifact only.
No executable migration is being created.
No SQL is being executed.
No SQL is being deployed.
No files are being moved into Supabase migration folders.
No runtime wiring is being added.
No backend writes are being added.
No credentials are being added.

## Checklist Purpose

- Verify future executable migration package readiness
- Prevent accidental deployment
- Confirm schema and RLS remain aligned
- Confirm safety rules before any dry-run
- Confirm production execution remains blocked until separate approval

## Pre-Package Checklist

- Combined SQL/RLS review committed
- No blockers open
- `app_settings` scope resolved
- Document numbering reviewed
- Payment safety reviewed
- Audit safety reviewed
- Migration traceability reviewed
- Rollback/retry strategy reviewed
- Offline conflict strategy reviewed
- Production execution blockers understood

## Package Assembly Checklist

- Schema SQL included
- RLS helper functions included
- RLS enablement included
- RLS policies included
- Constraints included
- Indexes included
- Comments and safety notes included
- Verification queries included if appropriate
- Rollback notes included without automatic destructive rollback

## Ordering Checklist

1. Extensions if needed
2. Tables
3. Constraints
4. Indexes
5. Helper functions
6. Enable RLS
7. Policies
8. Comments
9. Verification queries

## Schema Checklist

- All required tables present
- UUID primary keys present
- `company_id` ownership fields present where required
- `user` / `actor` fields present where identity matters
- `legacy_local_id` preserved where appropriate
- `migration_batch_id` preserved where appropriate
- `archived_at` / `archived_by` fields present where applicable
- `deleted_at` / `deleted_by` reserved for future soft-delete/trash behavior

## RLS Checklist

- RLS enabled on all required tables
- Helper functions reviewed
- Active company membership required for company-scoped reads
- Owner/admin controls admin-sensitive records
- Owner/admin/member can write operational records where allowed
- Viewer remains read-only
- Migration writes remain owner/admin controlled

## App Settings Checklist

- `setting_scope` supports company/user
- Company-scoped settings are member-readable
- Company-scoped settings are owner/admin-writable by default
- User-scoped settings are readable/writable only by owning user within active company membership
- Migration/sync settings remain owner/admin controlled
- Uniqueness rules match company/user scope semantics

## Document Safety Checklist

- Estimate numbers unique per company within estimates
- Invoice numbers unique per company within invoices
- Estimate and invoice number spaces remain separate
- No shared document number table introduced
- Sent/approved estimate stricter behavior remains future app/RLS work
- Paid/partial/void invoice stricter behavior remains future app/RLS work

## Payment Safety Checklist

- `invoice_payments` table exists
- Payments reference invoices
- Payment amount is required
- Payment read/write is company-scoped
- Payment update/delete remains stricter and review-gated
- No casual payment deletion path exists

## Audit Safety Checklist

- `audit_events` table exists
- Audit events are company-scoped
- Audit events are append-only by design intent
- Update/delete is blocked, omitted, or not casually allowed
- Actor identity represented where available

## Migration Safety Checklist

- `migration_batches` table exists
- `migration_write_results` table exists
- Migration traceability fields exist
- Owner/admin controls migration writes
- Member/viewer cannot approve or write migration batches/results
- Dry-run must happen in non-production first
- Production execution requires separate approval

## Dry-Run Checklist

- Non-production Supabase project only
- Table creation verified
- RLS enabled verified
- Owner/admin/member/viewer behavior verified
- `app_settings` company/user scope verified
- Migration batch/report behavior verified
- Protected records do not have casual hard-delete path
- Payment/audit protections verified
- Dry-run result documented before production consideration

## Blocked Contents Checklist

- No seed data
- No production credentials
- No runtime client code
- No UI permission gates
- No Supabase storage buckets
- No automatic destructive rollback
- No localStorage migration writes
- No backend sync code
- No payment/Stripe code

## Production Blockers Checklist

- No production execution before dry-run passes
- No production execution before RLS behavior is verified
- No production execution before migration preview/write strategy is approved
- No production execution without owner/admin approval gate
- No credentials in frontend code
- No runtime sync before schema/RLS approval

## Approval Outcome

- Ready for executable migration package draft: yes / no / yes with conditions
- Leave status as checklist-driven unless all items are verifiably satisfied
- Include space for reviewer notes

## Recommended Next Step

After this checklist is committed, create the executable migration package draft only if explicitly requested.
Keep the package out of Supabase migration folders until review approves it.

## Non-Goals

- No executable SQL migration
- No SQL execution
- No Supabase deployment
- No migration folder changes
- No runtime auth
- No UI permission gates
- No backend writes
- No schema deployment
- No credentials
