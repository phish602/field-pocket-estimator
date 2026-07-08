# Supabase Backend V1 Production Readiness Checklist

## 1. Summary

This checklist defines the required gates before any production Supabase project is created or configured, before credentials are added, before app wiring begins, and before any local-to-backend migration is approved.
Production remains blocked until this checklist is completed and explicitly approved.

## 2. Current Status

- Disposable Supabase backend V1 dry-run/security verification passed
- Production wiring remains blocked
- Production migration remains blocked
- Production launch remains blocked

## 3. Completed Dry-Run Evidence

Reference the completed dry-run evidence:

- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-dry-run-approval-gate-report.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-non-production-dry-run-result-attempt-2-v1.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-rls-final-write-deny-test-result-v1.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-final-authenticated-grant-verification-result-v1.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-clean-scratch-rerun-result-v1.md`

## 4. Production Supabase Project Creation Checklist

- [ ] Confirm the production Supabase project is separate from the disposable dry-run project
- [ ] Confirm the production project region before creation
- [ ] Confirm automatic exposure of new tables is disabled where applicable
- [ ] Confirm RLS is enabled immediately after schema creation or manually verified right after creation
- [ ] Confirm the production project uses the approved backend V1 schema plan

## 5. Credentials and Environment Safety Checklist

- [ ] Confirm no service-role key is used in frontend code
- [ ] Confirm the anon key is treated as public but still managed through env configuration
- [ ] Confirm any service-role key remains server-only if ever introduced
- [ ] Confirm no database password is committed
- [ ] Confirm no connection string is committed
- [ ] Confirm no JWT is committed
- [ ] Confirm no service-role key is committed
- [ ] Confirm no project secret is committed

## 6. Schema Deployment Checklist

- [ ] Confirm the production SQL package is reviewed before execution
- [ ] Confirm table creation succeeds in production
- [ ] Confirm RLS is enabled on all EstiPaid tables
- [ ] Confirm policies are visible
- [ ] Confirm authenticated grants match the least-privilege dry-run result
- [ ] Confirm DELETE exists only on `company_users`
- [ ] Confirm no TRUNCATE, TRIGGER, or REFERENCES grants exist for authenticated
- [ ] Confirm audit_events is SELECT/INSERT only
- [ ] Confirm business, financial, and migration records have no broad destructive authenticated grants

## 7. RLS and Grant Verification Checklist

- [ ] Confirm the production schema matches the reviewed schema draft
- [ ] Confirm the production RLS policy set matches the reviewed RLS draft
- [ ] Confirm the final authenticated grant set matches the least-privilege dry-run result
- [ ] Confirm helper function execute grants are explicit and limited to the approved public helper functions
- [ ] Confirm row-level behavior matches owner/admin/member/viewer/outsider expectations

## 8. Backup / Export Checklist

- [ ] Confirm a backup/export plan exists before migration
- [ ] Confirm a snapshot or export of current local data exists before migration
- [ ] Confirm the backup/export process is documented and reviewable

## 9. Rollback / Recovery Checklist

- [ ] Confirm a rollback/recovery plan exists before migration
- [ ] Confirm rollback ownership and approval are documented
- [ ] Confirm rollback does not depend on ad-hoc production patching

## 10. Local Data Migration Approval Checklist

- [ ] Confirm localStorage data export/snapshot plan exists before migration
- [ ] Confirm migration preview is reviewed before writes
- [ ] Confirm migration execution is explicitly approved
- [ ] Confirm a recovery path exists if migration fails

## 11. Runtime Wiring Checklist

- [ ] Confirm app runtime wiring is done only after schema and security gates pass
- [ ] Confirm the app is not wired to production Supabase before approvals
- [ ] Confirm runtime wiring does not introduce secrets into frontend code
- [ ] Confirm local save/load fallback behavior is intentionally defined before integration
- [ ] Confirm app wiring is staged only after production schema/RLS/grants are verified

## 12. App Behavior Regression Checklist

- [ ] Confirm PDF/export behavior is not changed by backend wiring
- [ ] Confirm AI Assist behavior is not changed by backend wiring
- [ ] Confirm project/customer/estimate/invoice/payment flows are smoke-tested after wiring
- [ ] Confirm no unexpected regression in save/load behavior

## 13. Security Review Checklist

- [ ] Confirm production approval is explicit and documented
- [ ] Confirm no secrets are committed during setup or wiring
- [ ] Confirm auth and grant behavior remain least-privilege in production
- [ ] Confirm cross-company isolation remains enforced
- [ ] Confirm production migration access is limited to approved roles only

## 14. Go / No-Go Approval Gates

- GO for production project setup only after this checklist is reviewed
- NO-GO for app wiring until production schema/RLS/grants are verified
- NO-GO for data migration until backup/export, rollback, migration preview, and explicit approval are complete
- NO-GO for production launch until runtime wiring and app smoke tests pass

## 15. Explicit Non-Goals

- No SQL execution
- No production deployment approval in this document
- No runtime auth implementation
- No UI permission gate implementation
- No backend writes
- No localStorage migration implementation
- No secrets

## 16. Exact Next Step

- Review this checklist, then proceed only with the smallest next production setup step that is explicitly approved

