# Supabase Clean Scratch Rerun Checklist V1

## 1. Summary

This checklist is for a clean scratch rerun of the corrected Supabase executable migration package in a disposable non-production project.
It documents the manual steps needed to prove the corrected package works from zero without ad-hoc patches.
Production wiring remains blocked until this clean rerun passes.

## 2. Why This Rerun Is Required

- The earlier disposable dry-run passed with conditions but required a manual grant patch
- The audit_events insert policy was tightened after the earlier dry-run
- This rerun must prove the corrected package works cleanly from scratch
- This rerun must prove no manual grant patch is needed
- This rerun must prove viewer can no longer insert audit_events

## 3. Safety Rules

- Use a disposable non-production Supabase project only
- Prefer a brand-new disposable project for the clean scratch rerun
- Do not use production data
- Do not use production credentials
- Do not wire EstiPaid to Supabase
- Do not modify localStorage behavior
- Do not modify PDF/export behavior
- Do not modify AI Assist behavior
- Do not modify save/load flows
- Do not add secrets to repo files
- Do not commit dummy auth user UUIDs

## 4. Recommended Environment

- Brand-new disposable non-production Supabase project preferred
- If reusing the existing dry-run project, clearly warn that reset SQL is destructive and only allowed in the disposable project
- Manual SQL Editor execution only
- No frontend app connection
- No production deployment path

## 5. Reset Strategy

- Prefer a fresh disposable project instead of destructive reset
- If a reset is required in a reused disposable project, it must be treated as disposable-only and never used in production
- Do not include destructive reset SQL here unless it is clearly labeled disposable-only
- Do not use any reset SQL outside the disposable non-production project

## 6. Corrected Package Execution

- Run `docs/supabase-executable-migration-package-draft-v1.sql` as-is
- Do not add a manual grant patch during execution
- Do not edit the SQL package before the rerun
- Confirm the corrected package includes authenticated grants
- Confirm the corrected audit_events insert policy is present

## 7. Schema Verification Queries

- Confirm all required tables exist
- Confirm primary keys exist
- Confirm foreign keys exist
- Confirm status check constraints exist
- Confirm role check constraints exist
- Confirm app_settings scope check exists
- Confirm estimate and invoice number uniqueness exists
- Confirm app_settings scope uniqueness exists
- Confirm lookup indexes exist

## 8. Authenticated Grants Verification

- Confirm `grant usage on schema public to authenticated` exists
- Confirm table grants for authenticated exist on the corrected package
- Confirm `grant execute on all functions in schema public to authenticated` exists
- Confirm authenticated read/write access is available only through the corrected package’s grants and RLS
- Confirm no manual grant patch is needed

## 9. Audit Policy Verification

- Confirm audit_events insert requires `public.can_write_company_records(company_id)`
- Confirm audit_events insert requires `actor_id = auth.uid()`
- Confirm viewer cannot insert audit_events
- Confirm outsider cannot insert audit_events for another company
- Confirm audit_events remains append-only from the app perspective

## 10. Seed Data Requirement

- Seed one primary company
- Seed one second company for cross-company isolation checks
- Seed owner, admin, member, and viewer role rows for the primary company
- Seed the required business records
- Do not commit real emails, passwords, JWTs, or auth UUIDs

## 11. Read Visibility Retest

- Owner sees primary company records
- Admin sees primary company records
- Member sees primary company records
- Viewer sees primary company records according to membership behavior
- Member and viewer see 0 `migration_batches` and 0 `migration_write_results`
- Outsider sees only the second company and its own membership row
- Outsider sees 0 primary-company business records

## 12. Write / Deny Retest

- Owner can insert/update operational records and manage company_users and migration records
- Admin can insert/update operational records and manage company_users and migration records
- Member can insert/update operational records where allowed
- Member cannot manage company_users or migration admin records
- Viewer cannot insert/update operational records
- Outsider cannot insert/update primary-company records
- Customer DELETE is denied for owner, admin, member, viewer, and outsider
- company_users DELETE is allowed only for owner/admin

## 13. Supplemental Write / Deny Retest

- Owner update allowed for projects, estimates, estimate_line_items, invoices, invoice_line_items, scope_templates, app_settings, migration_write_results, and audit_events insert
- Member update allowed for projects, estimates, invoices, scope_templates, and audit_events insert
- Member denied for migration_write_results update
- Viewer denied for projects, estimates, invoices, scope_templates, and app_settings updates
- Outsider denied for primary-company projects, estimates, invoices, scope_templates, app_settings, and audit_events insert

## 14. Audit Patch Regression Check

- Owner audit_events insert allowed
- Member audit_events insert allowed
- Viewer audit_events insert denied
- Outsider audit_events insert against the primary company denied
- Verify the corrected audit policy is still enforced after a clean rerun

## 15. Pass/Fail Recording Template

- Step:
- Role:
- Table:
- Action attempted:
- Expected result:
- Actual result:
- Pass / fail:
- Notes:

## 16. Production Blocker Status

- Production wiring remains blocked until the clean scratch rerun passes
- Production deployment remains blocked
- Runtime wiring remains blocked
- Credentials remain blocked
- Local data migration remains blocked

## 17. Approval Recommendation

- Recommended status: Passed only after the clean scratch rerun passes without ad-hoc patches
- Recommendation: do not promote until the corrected package is proven clean from scratch in disposable non-production

## 18. Non-Goals

- No source/runtime file changes
- No SQL execution in this document
- No Supabase deployment
- No credentials
- No runtime auth wiring
- No localStorage migration
- No backend writes
- No UI changes

## 19. Exact Next Step

- Perform the clean scratch rerun in a brand-new disposable Supabase project if practical, or in a reset disposable project if necessary, and record results using the role-behavior result format
