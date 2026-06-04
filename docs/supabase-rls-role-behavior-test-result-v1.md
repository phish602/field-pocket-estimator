# Supabase RLS Role Behavior Test Result V1

## Summary

- Result status: Passed with conditions
- Main condition: authenticated role behavior is now proven in the disposable dry-run project, but production is still blocked until the corrected package is reviewed, rerun cleanly from scratch in disposable non-production, and approved

## Environment

- Project name: `estipaid-backend-v1-dryrun`
- Project URL identifier only: `https://otdwufeqcblinzcvtbjc.supabase.co`
- Project type: disposable non-production Supabase dry-run project
- Execution method: manual Supabase SQL Editor

## Test Method

- Seeded the disposable project with placeholder-based test data
- Verified schema, tables, constraints, indexes, helper functions, and initial RLS state
- Performed authenticated role checks for owner, admin, member, viewer, and outsider
- Applied the required SQL/doc corrections in the disposable dry-run context
- Retested the corrected audit insert behavior

## Seed Verification Result

- primary_company = 1
- second_company = 1
- primary_company_roles = owner=1, admin=1, member=1, viewer=1
- second_company_roles = owner=1
- customers/projects/estimates/estimate_line_items/invoices/invoice_line_items/invoice_payments/scope_templates/audit_events/migration_batches/migration_write_results = 1
- app_settings = 2

## Read Visibility Result

- Owner, admin, member, and viewer saw primary company records according to expected membership behavior
- Member and viewer saw 0 `migration_batches` and 0 `migration_write_results`
- Outsider saw only the second isolation company and its own `company_users` row
- Outsider saw 0 primary-company business records

## Main Write / Deny Result

- Owner and admin can insert and update operational records and manage `company_users` and migration records
- Member can insert and update operational records where allowed
- Member cannot update `company_users`, existing `invoice_payments`, or `migration_batches`
- Viewer cannot insert or update operational records
- Outsider cannot insert or update primary-company records
- Customer DELETE denied for owner, admin, member, viewer, and outsider
- `company_users` DELETE allowed only for owner and admin

## Supplemental Write / Deny Result

- Owner update allowed for projects, estimates, estimate_line_items, invoices, invoice_line_items, scope_templates, app_settings, migration_write_results, and audit_events insert
- Member update allowed for projects, estimates, invoices, scope_templates, and audit_events insert after correction
- Member denied for `migration_write_results` update
- Viewer denied for projects, estimates, invoices, scope_templates, and app_settings updates
- Outsider denied for primary-company projects, estimates, invoices, scope_templates, app_settings, and audit_events insert
- Initial viewer audit_events insert unexpectedly succeeded and was marked fail before the fix

## Finding: Missing Authenticated Grants

- Initial authenticated RLS read testing failed before the grants patch with permission denied for `companies`
- The executable migration package was missing authenticated grants for the `authenticated` role
- That missing grants section prevented authenticated role testing from starting cleanly

## Finding: audit_events Insert Policy Too Loose

- The original audit_events insert policy allowed a viewer to insert audit events
- That behavior was too loose because audit inserts should be limited to authenticated write roles and require `actor_id = auth.uid()`

## Patch Applied in Disposable Dry-Run

- Added authenticated grants for schema usage, table access, and function execution in the executable package draft
- Tightened the audit_events insert policy to require `public.can_write_company_records(company_id)` and `actor_id = auth.uid()`
- Updated the RLS policy draft markdown to match the corrected audit behavior

## Patch Retest Result

- Owner audit_events insert allowed
- Member audit_events insert allowed
- Viewer audit_events insert denied
- Outsider audit_events insert against the primary company denied
- Authenticated read visibility passed after the grants correction

## Required Repo SQL Corrections

- Keep authenticated grants in the executable migration package draft
- Keep equivalent grant expectations in the RLS draft
- Keep the corrected audit_events insert policy:
  - requires `public.can_write_company_records(company_id)`
  - requires `actor_id = auth.uid()`
  - is limited to authenticated role behavior
- Keep the RLS policy markdown aligned with the corrected audit behavior

## Remaining Production Blockers

- Production wiring remains blocked
- Production deployment remains blocked
- The corrected package must be reviewed again
- The corrected package must be rerun cleanly from scratch in disposable non-production
- Final approval is still required before any production path

## Approval Recommendation

- Recommended status: Passed with conditions
- Recommendation: keep production blocked until the corrected package is reviewed and rerun cleanly from scratch in disposable non-production

## Non-Goals

- No source/runtime file changes
- No production deployment
- No production credentials
- No runtime auth wiring
- No backend writes
- No localStorage migration
- No UI changes

## Exact Next Step

- Review the corrected package, rerun the authenticated role behavior checks cleanly from scratch in disposable non-production, and then decide whether production wiring may proceed
