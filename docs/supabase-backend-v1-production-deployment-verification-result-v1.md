# Supabase Backend V1 Production Deployment Verification Result V1

## 1. Summary

- Production deployment verification passed
- The approved SQL package was deployed to the real production Supabase project
- Production table creation, RLS, policies, and authenticated grants were verified

## 2. Production Deployment Status

- Status: Passed
- Supabase SQL Editor returned success with no rows returned

## 3. Production Project

- Project name: `estipaid-backend-v1-production`
- Environment: Production
- GitHub connection: Not connected
- Credentials: Not documented, not committed, not added to repo

## 4. SQL Package Deployed

- File deployed: `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-executable-migration-package-draft-v1.sql`

## 5. Table Verification Result

Tables verified in the public schema:

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

## 6. RLS Verification Result

RLS was verified as enabled on all 14 public tables:

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

## 7. Policy Verification Result

Policies verified:

- `app_settings_insert_company_scope`
- `app_settings_insert_user_scope`
- `app_settings_select_company_scope`
- `app_settings_select_user_scope`
- `app_settings_update_company_scope`
- `app_settings_update_user_scope`
- `audit_events_insert_member_path`
- `audit_events_select_members`
- `companies_insert_authenticated`
- `companies_select_active_members`
- `companies_update_owner_admin`
- `company_users_delete_owner_admin`
- `company_users_insert_owner_admin`
- `company_users_select_active_members`
- `company_users_update_owner_admin`
- `customers_insert_operational`
- `customers_select_members`
- `customers_update_operational`
- `estimate_line_items_insert_operational`
- `estimate_line_items_select_members`
- `estimate_line_items_update_operational`
- `estimates_insert_operational`
- `estimates_select_members`
- `estimates_update_operational`
- `invoice_line_items_insert_operational`
- `invoice_line_items_select_members`
- `invoice_line_items_update_operational`
- `invoice_payments_insert_operational`
- `invoice_payments_select_members`
- `invoice_payments_update_owner_admin`
- `invoices_insert_operational`
- `invoices_select_members`
- `invoices_update_operational`
- `migration_batches_insert_owner_admin`
- `migration_batches_select_owner_admin`
- `migration_batches_update_owner_admin`
- `migration_write_results_insert_owner_admin`
- `migration_write_results_select_owner_admin`
- `migration_write_results_update_owner_admin`
- `projects_insert_operational`
- `projects_select_members`
- `projects_update_operational`
- `scope_templates_insert_operational`
- `scope_templates_select_members`
- `scope_templates_update_operational`

## 8. Authenticated Grant Verification Result

Authenticated grants verified:

- app_settings: INSERT, SELECT, UPDATE
- audit_events: INSERT, SELECT
- companies: INSERT, SELECT, UPDATE
- company_users: DELETE, INSERT, SELECT, UPDATE
- customers: INSERT, SELECT, UPDATE
- estimate_line_items: INSERT, SELECT, UPDATE
- estimates: INSERT, SELECT, UPDATE
- invoice_line_items: INSERT, SELECT, UPDATE
- invoice_payments: INSERT, SELECT, UPDATE
- invoices: INSERT, SELECT, UPDATE
- migration_batches: INSERT, SELECT, UPDATE
- migration_write_results: INSERT, SELECT, UPDATE
- projects: INSERT, SELECT, UPDATE
- scope_templates: INSERT, SELECT, UPDATE

## 9. Security Conclusions

- No TRUNCATE grants for authenticated.
- No TRIGGER grants for authenticated.
- No REFERENCES grants for authenticated.
- DELETE grant exists only on `company_users`.
- `audit_events` has only INSERT and SELECT.
- Business records do not have authenticated DELETE grants.
- Financial records do not have authenticated DELETE grants.
- Migration tracking records do not have authenticated DELETE grants.

## 10. Remaining Blocked Actions

- Adding credentials to the repo
- Adding env files
- Wiring EstiPaid runtime to Supabase
- Creating Supabase client code
- Running local-to-backend migration preview
- Running local-to-backend migration writes
- Moving real customer/project/estimate/invoice/payment data
- Launching production

## 11. Exact Next Gate

- Credentials / env handling approval remains the next gate
- Runtime wiring remains blocked until credentials / env handling is explicitly approved and documented

