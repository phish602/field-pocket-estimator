# Supabase RLS Final Write / Deny Test Result V1

## Summary

- Result status: Passed
- Final RLS write/deny behavior passed for the tested matrix in the disposable non-production project.
- Production wiring remains blocked until all approval gates are explicitly cleared.

## Environment

- Project type: disposable / non-production Supabase dry-run project
- Project name: `estipaid-backend-v1-dryrun`
- Project URL identifier only: `https://otdwufeqcblinzcvtbjc.supabase.co`
- Execution method: manual Supabase SQL Editor
- Final test name: EstiPaid final RLS main write / deny behavior test

## Preconditions

- Seed status before final test: verified
- schema dry-run and RLS behavior testing passed in disposable non-production project

## Seed Verification Result

- primary_company: 1
- second_company: 1
- primary_company_roles: admin=1, member=1, owner=1, viewer=1
- second_company_roles: owner=1
- customers: 1
- projects: 1
- estimates: 1
- estimate_line_items: 1
- invoices: 1
- invoice_line_items: 1
- invoice_payments: 1
- scope_templates: 1
- app_settings: 2
- audit_events: 1
- migration_batches: 1
- migration_write_results: 1

## Final Write / Deny Test Result

### OWNER

- company_users DELETE ALLOW PASS affected_rows=1
- company_users UPDATE ALLOW PASS affected_rows=6
- customers DELETE DENY PASS permission denied for table customers
- customers INSERT ALLOW PASS affected_rows=1
- customers UPDATE ALLOW PASS affected_rows=1
- invoice_payments UPDATE ALLOW PASS affected_rows=1
- migration_batches UPDATE ALLOW PASS affected_rows=1

### ADMIN

- company_users DELETE ALLOW PASS affected_rows=1
- company_users UPDATE ALLOW PASS affected_rows=5
- customers DELETE DENY PASS permission denied for table customers
- customers INSERT ALLOW PASS affected_rows=1
- customers UPDATE ALLOW PASS affected_rows=1
- invoice_payments UPDATE ALLOW PASS affected_rows=1
- migration_batches UPDATE ALLOW PASS affected_rows=1

### MEMBER

- company_users UPDATE DENY PASS affected_rows=0
- customers DELETE DENY PASS permission denied for table customers
- customers INSERT ALLOW PASS affected_rows=1
- customers UPDATE ALLOW PASS affected_rows=1
- invoice_payments INSERT ALLOW PASS affected_rows=1
- invoice_payments UPDATE DENY PASS affected_rows=0
- migration_batches UPDATE DENY PASS affected_rows=0

### VIEWER

- company_users UPDATE DENY PASS affected_rows=0
- customers DELETE DENY PASS permission denied for table customers
- customers INSERT DENY PASS new row violates row-level security policy for table customers
- customers UPDATE DENY PASS affected_rows=0
- invoice_payments INSERT DENY PASS new row violates row-level security policy for table invoice_payments
- invoice_payments UPDATE DENY PASS affected_rows=0
- migration_batches UPDATE DENY PASS affected_rows=0

### OUTSIDER

- company_users UPDATE_PRIMARY_COMPANY DENY PASS affected_rows=0
- customers DELETE_PRIMARY_COMPANY DENY PASS permission denied for table customers
- customers INSERT_PRIMARY_COMPANY DENY PASS new row violates row-level security policy for table customers
- customers UPDATE_PRIMARY_COMPANY DENY PASS affected_rows=0
- invoice_payments UPDATE_PRIMARY_COMPANY DENY PASS affected_rows=0
- migration_batches UPDATE_PRIMARY_COMPANY DENY PASS affected_rows=0

## Role Behavior Summary

- Owner/admin operational write paths passed.
- Owner/admin company_users management passed.
- Member operational insert/update paths passed where expected.
- Member was blocked from company_users updates, invoice_payments updates, and migration batch updates.
- Viewer was read-only/deny for tested write paths.
- Outsider was denied against the primary company.

## Delete Safety Conclusion

- Customer hard delete was blocked for every tested role.
- Only `company_users` delete was allowed for owner/admin as designed.
- Protected business, financial, migration, and audit records do not have casual app-user hard-delete paths under RLS.

## Cross-Company Isolation Conclusion

- Outsider access against the primary company was denied.
- Cross-company protection behaved as expected for the tested matrix.

## Grant / RLS Conclusion

- The least-privilege grants and tightened audit_events insert policy supported the final tested behavior.
- The final RLS write/deny behavior result is passed for the tested matrix.

## Remaining Production Blockers

- Production Supabase project has not been created/configured from this dry-run result.
- EstiPaid app is not wired to Supabase.
- Credentials/env handling has not been implemented.
- Local-to-backend migration execution has not been approved.
- Runtime backend client integration has not been tested.
- Production approval must still be explicit before wiring or data migration.

## Non-Goals

- No source/runtime file changes
- No production deployment
- No production credentials
- No runtime auth wiring
- No backend writes
- No localStorage migration
- No UI changes

## Approval Recommendation

- Recommended status: Passed
- Recommendation: keep production blocked until the production project, credentials, runtime integration, and migration approval are separately completed

## Exact Next Step

- Keep production blocked until the production environment is explicitly approved and the app wiring/migration path is separately implemented and tested
