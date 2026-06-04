# Supabase Non-Production Dry-Run Result Attempt 2 V1

## Summary

- Result status: Passed with conditions
- Main condition: authenticated role behavior still needs test-user verification before production use

## Environment

- Project type: disposable / non-production Supabase dry-run project
- Project name: estipaid-backend-v1-dryrun
- Project URL identifier only: https://otdwufeqcblinzcvtbjc.supabase.co
- Execution method: manual Supabase SQL Editor

## SQL Package Used

- Package file: `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-executable-migration-package-draft-v1.sql`

## Verification Results

### Verified table creation

- app_settings
- audit_events
- companies
- company_users
- customers
- estimate_line_items
- estimates
- invoice_line_items
- invoice_payments
- invoices
- migration_batches
- migration_write_results
- projects
- scope_templates

### Verified RLS enabled

- app_settings: true
- audit_events: true
- companies: true
- company_users: true
- customers: true
- estimate_line_items: true
- estimates: true
- invoice_line_items: true
- invoice_payments: true
- invoices: true
- migration_batches: true
- migration_write_results: true
- projects: true
- scope_templates: true

### Verified policies created

- `app_settings_insert_company_scope` INSERT
- `app_settings_insert_user_scope` INSERT
- `app_settings_select_company_scope` SELECT
- `app_settings_select_user_scope` SELECT
- `app_settings_update_company_scope` UPDATE
- `app_settings_update_user_scope` UPDATE
- `audit_events_insert_member_path` INSERT
- `audit_events_select_members` SELECT
- `companies_insert_authenticated` INSERT
- `companies_select_active_members` SELECT
- `companies_update_owner_admin` UPDATE
- `company_users_delete_owner_admin` DELETE
- `company_users_insert_owner_admin` INSERT
- `company_users_select_active_members` SELECT
- `company_users_update_owner_admin` UPDATE
- `customers_insert_operational` INSERT
- `customers_select_members` SELECT
- `customers_update_operational` UPDATE
- `estimate_line_items_insert_operational` INSERT
- `estimate_line_items_select_members` SELECT
- `estimate_line_items_update_operational` UPDATE
- `estimates_insert_operational` INSERT
- `estimates_select_members` SELECT
- `estimates_update_operational` UPDATE
- `invoice_line_items_insert_operational` INSERT
- `invoice_line_items_select_members` SELECT
- `invoice_line_items_update_operational` UPDATE
- `invoice_payments_insert_operational` INSERT
- `invoice_payments_select_members` SELECT
- `invoice_payments_update_owner_admin` UPDATE
- `invoices_insert_operational` INSERT
- `invoices_select_members` SELECT
- `invoices_update_operational` UPDATE
- `migration_batches_insert_owner_admin` INSERT
- `migration_batches_select_owner_admin` SELECT
- `migration_batches_update_owner_admin` UPDATE
- `migration_write_results_insert_owner_admin` INSERT
- `migration_write_results_select_owner_admin` SELECT
- `migration_write_results_update_owner_admin` UPDATE
- `projects_insert_operational` INSERT
- `projects_select_members` SELECT
- `projects_update_operational` UPDATE
- `scope_templates_insert_operational` INSERT
- `scope_templates_select_members` SELECT
- `scope_templates_update_operational` UPDATE

### Verified constraints

- Primary keys exist across created tables.
- Foreign keys exist for company/customer/project/estimate/invoice/payment relationships.
- Unique constraints exist for legacy local IDs where expected.
- Unique constraints exist for company-scoped estimate numbers, invoice numbers, project numbers, and migration batch IDs.
- Check constraints exist for app_settings scope, company user roles, estimate status, invoice status, migration batch status, and project status.

### Verified allowed statuses

- company_users.role: owner, admin, member, viewer
- app_settings.setting_scope: company, user
- projects.status: draft, active, completed, archived
- estimates.status: draft, pending, sent, approved, lost
- invoices.status: draft, sent, partial, paid, overdue, void
- migration_batches.status: draft, previewed, approved, running, completed, failed, rolled_back

### Verified indexes

- Company lookup indexes exist.
- legacy_local_id indexes exist.
- Relationship indexes exist for customer/project/estimate/invoice/payment paths.
- Migration batch indexes exist.
- app_settings scope and company/user uniqueness indexes exist.
- Audit company/time lookup index exists.

### Verified helper functions

- `can_manage_company`
- `can_write_company_records`
- `company_role`
- `is_company_member`

## Passed Checks

- All required tables were created in the non-production project.
- RLS was enabled on all required tables.
- The documented policies were created.
- The documented constraints were present.
- The documented indexes were present.
- The documented helper functions were present.
- No production data was used.
- No production credentials were used.

## Conditional / Not Yet Proven

- Authenticated role behavior still needs test-user verification before production use.
- Production readiness is not established yet.

## Delete Safety Conclusion

- Only DELETE policy found: `company_users_delete_owner_admin`
- No DELETE policies found for customers, projects, estimates, invoices, invoice_payments, audit_events, migration_batches, or migration_write_results.
- This is a pass because protected business, financial, migration, and audit records do not have casual app-user hard-delete paths under RLS.

## Safe Status / Archive Behavior

- Customer removal should map to `archived_at` / `archived_by`, not hard delete.
- Project archive should map to `status = archived` plus `archived_at` / `archived_by`.
- Estimate cancellation should map to `status = lost` plus optional `archived_at` / `archived_by` if hidden.
- Invoice cancellation should map to `status = void` plus optional `archived_at` / `archived_by`.
- Payment correction should not hard-delete payment records.
- Audit events should never be app-deleted.

## Production Blocker List

- Authenticated role behavior still needs test-user verification
- Production deployment remains blocked
- Runtime wiring remains blocked
- Credentials remain blocked
- Local data migration remains blocked

## Approval Recommendation

- Recommended status: Passed with conditions
- Recommendation: do not promote to production until authenticated role behavior is verified with real test users

## Non-Goals

- No source/runtime file changes
- No SQL execution beyond the disposable non-production dry-run already completed
- No Supabase production deployment
- No runtime auth wiring
- No credentials
- No backend writes
- No localStorage migration

## Exact Next Step

- Verify authenticated role behavior with real test users in the non-production project before any production consideration
