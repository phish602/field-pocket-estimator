# Supabase Backend V1 Runtime Wiring Approval Runbook

## 1. Summary

This runbook defines the approvals and safeguards required before EstiPaid runtime code can be connected to Supabase.
It is not approval to wire the app.
Runtime wiring remains blocked until explicit approval is documented.
Production runtime wiring must never be inferred from dry-run success.

## 2. Current Status

- Disposable Supabase backend V1 dry-run/security verification has passed
- Production setup remains blocked
- Migration approval and runtime wiring approval are separate gates
- Runtime wiring remains blocked
- Credentials/env handling must be approved before any code changes

## 3. Required Approvals Before Using This Runbook

- Production readiness checklist must be reviewed and approved first
- Production setup runbook must be reviewed and approved first
- Backup/export and rollback/recovery gates must be complete
- Migration preview and migration write execution gates must be complete
- Explicit runtime wiring approval must be documented

## 4. Required Completed Documents

- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-production-readiness-checklist.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-production-setup-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-backup-export-rollback-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-migration-preview-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-migration-write-execution-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-dry-run-approval-gate-report.md`

## 5. Runtime Wiring Scope

- Define the smallest approved set of runtime changes
- Keep runtime wiring isolated to approved files only
- Keep data access behind a backend adapter layer
- Keep localStorage behavior intact until explicit cutover approval
- Keep save/load flows intact until explicit cutover approval

## 6. Environment Variable Approval Gate

- Confirm target environment is identified: disposable dry-run, staging, or production
- Confirm Supabase project URL and anon key are handled through approved env setup
- Confirm no database password is committed
- Confirm no connection string is committed
- Confirm no service-role key is committed
- Confirm no JWT is committed
- Confirm no auth token is committed
- Confirm no secret is committed

## 7. Supabase Client Creation Gate

- Confirm Supabase client creation is isolated to approved files only
- Confirm client initialization uses approved env handling
- Confirm service-role keys are never used in frontend code
- Confirm anon key is treated as public-facing but managed through env configuration

## 8. Authentication / Session Gate

- Confirm auth/session handling is explicitly approved before wiring
- Confirm production runtime wiring is not inferred from dry-run success
- Confirm target environment is documented before any auth code change
- Confirm no secret-bearing auth values are committed

## 9. Backend Data Adapter Gate

- Confirm data access remains behind a backend adapter layer
- Confirm adapter changes are reviewed before wiring
- Confirm the adapter preserves current data behavior until cutover approval
- Confirm adapter changes do not bypass save/load flows

## 10. Save / Load Behavior Gate

- Confirm existing local save/load flows are preserved until explicit cutover approval
- Confirm new runtime code does not break customer, project, estimate, invoice, or payment flows
- Confirm save/load behavior remains smoke-testable after wiring

## 11. localStorage Fallback Gate

- Confirm localStorage fallback behavior is intentionally defined before integration
- Confirm the app can recover if Supabase request fails
- Confirm fallback behavior is documented before any wiring merge

## 12. PDF / Export Regression Gate

- Confirm PDF export remains unchanged
- Confirm runtime wiring does not change export behavior
- Confirm export remains smoke-tested after wiring

## 13. AI Assist Regression Gate

- Confirm AI Assist remains unchanged
- Confirm runtime wiring does not alter AI Assist behavior
- Confirm AI Assist remains smoke-testable after wiring

## 14. Migration Dependency Gate

- Confirm migration approval and runtime wiring approval are separate gates
- Confirm local-to-backend migration is not implied by runtime wiring approval
- Confirm runtime wiring does not unblock data migration by itself

## 15. Smoke Test Checklist

- [ ] Create customer
- [ ] Create project
- [ ] Create estimate
- [ ] Create invoice
- [ ] Record payment
- [ ] Load saved estimate/invoice
- [ ] Export PDF
- [ ] Use AI Assist
- [ ] Refresh app and verify persisted state
- [ ] Simulate Supabase request failure
- [ ] Verify local fallback or user-facing error behavior

## 16. Failure Handling Checklist

- [ ] Stop on unexpected save/load failures
- [ ] Stop on unexpected PDF/export regressions
- [ ] Stop on unexpected AI Assist regressions
- [ ] Stop on unexpected permission or session errors
- [ ] Document failures before any further wiring
- [ ] Do not patch production ad hoc

## 17. Rollback Plan for Runtime Wiring

- Confirm a rollback plan exists before merging wiring changes
- Confirm wiring changes can be reverted without breaking current save/load behavior
- Confirm rollback ownership and approval are documented
- Confirm runtime rollback does not imply production data migration rollback

## 18. Go / No-Go Checkpoints

- GO for runtime wiring only after explicit approval is documented
- NO-GO for runtime wiring until credentials/env handling is approved
- NO-GO for runtime wiring until adapter, fallback, and smoke-test gates are defined
- NO-GO for production launch until runtime wiring and app smoke tests pass

## 19. Non-Goals

- No approval to wire the app
- No production deployment authorization
- No backend writes
- No localStorage migration implementation
- No secrets
- No client files created here

## 20. Exact Next Step

- Keep runtime wiring blocked until explicit approval is documented, then implement only the smallest approved adapter/client changes

