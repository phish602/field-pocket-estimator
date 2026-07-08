# Supabase Backend V1 Security Review Runbook

## 1. Summary

This runbook defines the security review gates required before production Supabase setup, credentials, runtime wiring, migration writes, or launch can be approved.
Security review is required before production approval.
Production setup, credentials, runtime wiring, migration writes, and launch remain blocked.

## 2. Current Status

- Disposable Supabase backend V1 dry-run/security verification has passed
- Production setup remains blocked
- Credentials remain blocked
- Runtime wiring remains blocked
- Migration writes remain blocked
- Production launch remains blocked

## 3. Required Approvals Before Using This Runbook

- Production readiness checklist must be reviewed and approved first
- Production setup runbook must be reviewed and approved first
- Runtime wiring approval runbook must be reviewed and approved first
- Backup/export and rollback/recovery gates must be complete
- Migration preview and migration write execution gates must be complete
- Explicit security review approval must be documented

## 4. Security Review Scope

- Schema security
- RLS policy security
- Authenticated grant security
- Role behavior security
- Delete / destructive action security
- Credentials and secrets security
- Runtime wiring security
- Migration security
- Data privacy
- Audit / logging
- Backup / rollback security
- Production environment checks

## 5. Completed Dry-Run Evidence

Reference the completed dry-run evidence:

- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-dry-run-approval-gate-report.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-final-authenticated-grant-verification-result-v1.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-rls-final-write-deny-test-result-v1.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-clean-scratch-rerun-result-v1.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-non-production-dry-run-result-attempt-2-v1.md`

## 6. Schema Security Checklist

- [ ] All EstiPaid tables have RLS enabled
- [ ] All app tables have visible policies
- [ ] Primary keys exist across required tables
- [ ] Company ownership fields exist where required
- [ ] Relationship foreign keys exist where required

## 7. RLS Policy Checklist

- [ ] RLS is enabled on every EstiPaid table
- [ ] Policies are visible for all app tables
- [ ] Owner/admin/member/viewer behavior matches the reviewed policy model
- [ ] Outsider access to primary company records is denied
- [ ] audit_events remains append-only by policy intent

## 8. Authenticated Grant Checklist

- [ ] Authenticated grants remain least-privilege
- [ ] No TRUNCATE grants exist for authenticated
- [ ] No TRIGGER grants exist for authenticated
- [ ] No REFERENCES grants exist for authenticated
- [ ] DELETE exists only on `company_users`
- [ ] `audit_events` is limited to SELECT and INSERT
- [ ] Business, financial, migration, and audit records have no casual hard-delete app-user paths

## 9. Role Behavior Checklist

- [ ] Owner write paths are limited to approved behavior
- [ ] Admin write paths are limited to approved behavior
- [ ] Member write paths are limited to approved operational behavior
- [ ] Viewer tested write paths are denied
- [ ] Outsider access to the primary company is denied

## 10. Delete / Destructive Action Checklist

- [ ] No broad authenticated destructive grants exist
- [ ] Only `company_users` has DELETE for authenticated
- [ ] Audit UPDATE / DELETE paths do not exist for authenticated
- [ ] Hard delete is not casually allowed for protected business records

## 11. Credentials / Secrets Checklist

- [ ] Service-role key is never used in frontend code
- [ ] Database password is never committed
- [ ] Connection strings are never committed
- [ ] Anon key is handled through approved env setup only
- [ ] No JWT or auth token is committed
- [ ] Dummy auth UUIDs are not committed to future docs

## 12. Runtime Wiring Security Checklist

- [ ] Runtime wiring is feature-flagged or reversible before merge
- [ ] No Supabase client is created outside approved files
- [ ] Save/load logic remains unchanged until explicit approval
- [ ] Storage adapters are not modified without approval

## 13. Migration Security Checklist

- [ ] Migration preview is read-only
- [ ] Migration writes require explicit target-environment approval
- [ ] Migration write execution logs attempted, successful, failed, and skipped writes
- [ ] Migration writes are blocked until backup/export and rollback approval are complete

## 14. Data Privacy Checklist

- [ ] Local customer/business data backups are not committed to Git
- [ ] Backup/export copy exists outside the repo before migration
- [ ] No real customer or business data is placed in docs

## 15. Audit / Logging Checklist

- [ ] Audit events are SELECT/INSERT only
- [ ] Migration actions are logged if applicable
- [ ] Failed, blocked, or skipped actions are documented
- [ ] Production review can audit who approved what and when

## 16. Backup / Rollback Security Checklist

- [ ] Backup/export path exists before migration
- [ ] Rollback/recovery path exists before migration
- [ ] Rollback ownership and approval are documented
- [ ] Rollback does not depend on ad-hoc patching

## 17. Production Environment Checklist

- [ ] Production project is separate from the disposable dry-run project
- [ ] Production region is confirmed before creation
- [ ] Automatic exposure of new tables is disabled where applicable
- [ ] RLS is verified immediately after schema creation
- [ ] Production approval is explicit before launch

## 18. Security Hard-Stop Conditions

- Any service-role key in frontend code
- Any database password or connection string committed
- Any broad authenticated grant such as TRUNCATE, TRIGGER, or REFERENCES
- DELETE grants beyond `company_users`
- audit_events UPDATE or DELETE paths for authenticated
- Missing RLS on any EstiPaid table
- Unverified production schema / RLS / grants
- Migration writes without backup/export and rollback approval
- Runtime wiring without credential / env approval
- Production launch without explicit go/no-go approval

## 19. Go / No-Go Approval Gates

- GO for production setup only after explicit security review approval
- NO-GO for credentials until security review gates pass
- NO-GO for runtime wiring until credentials, env handling, and security gates pass
- NO-GO for migration writes until backup/export, rollback, preview, and explicit approval are complete
- NO-GO for production launch until smoke tests and security review pass

## 20. Non-Goals

- No production approval in this document
- No runtime auth implementation
- No UI permission gate implementation
- No backend writes
- No localStorage migration execution
- No secrets

## 21. Exact Next Step

- Complete the security review checklist, then require explicit approval before any production setup or wiring step is attempted

