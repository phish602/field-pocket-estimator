# Supabase Backend V1 Migration Write Execution Runbook

## 1. Summary

This runbook defines the controlled approval and execution gates required before any migration write is allowed.
It is not approval to execute migration writes.
Migration writes remain blocked until explicit approval is documented.
Approval must be specific to the target environment.
Production migration approval must never be inferred from dry-run success.
Runtime app wiring remains blocked unless separately approved.

## 2. Current Status

- Disposable Supabase backend V1 dry-run/security verification has passed
- Production setup remains blocked
- Migration preview is read-only
- Migration writes remain blocked until backup/export, rollback/recovery, preview review, and explicit approval are complete

## 3. Required Approvals Before Using This Runbook

- Production readiness checklist must be reviewed and approved first
- Production setup runbook must be reviewed and approved first
- Backup/export and rollback/recovery gates must be complete
- Migration preview must be reviewed and approved first
- Explicit migration write approval must be documented for the target environment

## 4. Required Completed Documents

- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-production-readiness-checklist.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-production-setup-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-backup-export-rollback-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-migration-preview-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-dry-run-approval-gate-report.md`

## 5. Pre-Write Backup / Export Gate

- [ ] Backup/export exists before migration writes
- [ ] Backup copy is stored outside the repo
- [ ] No customer or business data backups are committed to Git

## 6. Pre-Write Rollback / Recovery Gate

- [ ] Rollback/recovery path is documented before migration writes
- [ ] Rollback ownership and approval are defined
- [ ] Rollback does not depend on ad-hoc production patching

## 7. Pre-Write Migration Preview Gate

- [ ] Preview output was reviewed before migration writes
- [ ] Source counts were captured
- [ ] Mapped counts were reviewed
- [ ] Skipped records were reviewed
- [ ] Warnings and errors were reviewed
- [ ] Duplicate/collision report was reviewed
- [ ] Relationship issues were reviewed
- [ ] Financial totals comparison was reviewed

## 8. Pre-Write Production Schema / RLS / Grant Gate

- [ ] If the target is production, production schema was deployed from the approved SQL package
- [ ] If the target is production, RLS is enabled
- [ ] If the target is production, policies are visible
- [ ] If the target is production, authenticated grants match least-privilege expectations
- [ ] No TRUNCATE grants exist for authenticated
- [ ] No TRIGGER grants exist for authenticated
- [ ] No REFERENCES grants exist for authenticated
- [ ] DELETE exists only on `company_users`
- [ ] `audit_events` is SELECT/INSERT only

## 9. Explicit Migration Write Approval Gate

- [ ] Migration write execution has explicit approval before starting
- [ ] Approval identifies the target environment
- [ ] Approval states whether the target is disposable dry-run, staging, or production
- [ ] Approval is specific and documented
- [ ] Approval is not inferred from dry-run success

## 10. Migration Write Execution Controls

- Require a migration batch ID
- Require logging migration start time
- Require logging migration end time
- Require recording attempted writes
- Require recording successful writes
- Require recording failed writes
- Require recording skipped writes
- Require preserving `legacy_local_id` mappings
- Require preserving parent-child relationships
- Stop on unexpected destructive behavior
- Stop on unexpected permission or RLS errors
- Stop on financial mismatch

## 11. Write Monitoring Checklist

- [ ] Migration batch ID recorded
- [ ] Start time recorded
- [ ] End time recorded
- [ ] Attempted writes recorded
- [ ] Successful writes recorded
- [ ] Failed writes recorded
- [ ] Skipped writes recorded
- [ ] Legacy mapping preserved
- [ ] Parent-child relationships preserved

## 12. Post-Write Verification Checklist

- [ ] Compare source counts to backend counts
- [ ] Compare customer, project, estimate, invoice, and payment counts
- [ ] Verify estimate line items attach to the correct estimates
- [ ] Verify invoice line items attach to the correct invoices
- [ ] Verify payments attach to the correct invoices
- [ ] Verify invoice totals, amount paid, and balance remaining
- [ ] Verify `migration_write_results` records exist for attempted writes
- [ ] Verify audit_events exist for migration actions if applicable
- [ ] Verify no unexpected hard deletes occurred
- [ ] Verify app runtime remains unchanged unless wiring was separately approved

## 13. Failure Handling Checklist

- [ ] Stop if destructive behavior appears unexpectedly
- [ ] Stop if permission or RLS errors appear unexpectedly
- [ ] Stop if financial totals mismatch
- [ ] Document the failure
- [ ] Do not patch production ad hoc
- [ ] Use the approved recovery path only

## 14. Rollback Trigger Checklist

- [ ] Counts mismatch
- [ ] Relationships mismatch
- [ ] Totals mismatch
- [ ] Payment records mismatch
- [ ] Unexpected hard deletes
- [ ] Unexpected permission or RLS errors

## 15. Post-Rollback Verification Checklist

- [ ] Verify rollback outcome is documented
- [ ] Verify counts match the expected pre-migration state where appropriate
- [ ] Verify relationships are restored or preserved
- [ ] Verify payment integrity after rollback

## 16. Final Migration Acceptance Checklist

- [ ] Backup/export complete
- [ ] Rollback/recovery complete
- [ ] Preview reviewed
- [ ] Explicit approval documented
- [ ] Write execution controls followed
- [ ] Post-write verification passed
- [ ] No unexpected hard deletes

## 17. Non-Goals

- No SQL execution approval in this document
- No runtime auth implementation
- No UI permission gate implementation
- No backend writes
- No localStorage migration execution
- No secrets

## 18. Exact Next Step

- Keep migration writes blocked until the required approvals are explicitly documented for the target environment and all pre-write gates are complete

