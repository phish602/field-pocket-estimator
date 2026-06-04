# Supabase Backend V1 Backup / Export / Rollback Runbook

## 1. Summary

This runbook defines the required backup, export, rollback, and recovery gates before any future local-to-Supabase migration.
It is not approval to migrate data.
Production wiring remains blocked.
Real customer, project, estimate, invoice, and payment data must not be moved until explicitly approved.

## 2. Current Status

- Disposable Supabase backend V1 dry-run/security verification has passed
- Production setup remains blocked
- Data migration remains blocked
- Backup/export, rollback/recovery, migration preview, and explicit approval gates must be completed before migration can be considered

## 3. Required Approval Before Using This Runbook

- Production readiness checklist must be reviewed and approved first
- Migration preview must be reviewed and approved first
- This runbook does not approve migration execution

## 4. Backup / Export Scope

Back up and export the following from local EstiPaid before any migration attempt:

- Company profile
- Customers
- Projects
- Estimates
- Invoices
- Invoice payments
- Scope templates
- App settings
- Audit / migration metadata if available

## 5. LocalStorage Data Preservation Checklist

- [ ] Capture a pre-migration localStorage snapshot/export
- [ ] Preserve a copy outside the repo
- [ ] Do not commit customer or business data backups to Git
- [ ] Confirm backup copy is stored in a disposable non-repo location

## 6. Manual Export Procedure

1. Export local EstiPaid data from the current app state
2. Save a snapshot outside the repository
3. Verify the snapshot contains the required export scope
4. Do not use the snapshot as a production backup

## 7. Backup File Naming Convention

- Use a clear date-stamped name
- Include `estipaid`
- Include `local-backup` or `export`
- Include the environment or run label
- Do not include secrets, passwords, or customer data in the filename

## 8. Backup Storage Rules

- Store backups outside the repository
- Do not commit backups to Git
- Do not store production data in the repo
- Do not store secrets in filenames or metadata

## 9. Migration Preview Gate

- Migration preview must be run before any write execution
- Review record counts before migration writes
- Review warnings and errors before migration writes
- Review sample mappings before migration writes
- Explicit approval is required before migration writes

## 10. Migration Execution Hard Stop

- Stop before any migration write execution if backup/export is incomplete
- Stop before any migration write execution if rollback/recovery is not approved
- Stop before any migration write execution if migration preview is not reviewed
- Stop before any migration write execution if explicit approval is missing

## 11. Post-Migration Verification Checklist

- [ ] Verify record counts after migration
- [ ] Compare sample records after migration
- [ ] Verify invoice and payment integrity after migration
- [ ] Verify relationships between customers, projects, estimates, and invoices
- [ ] Verify payment totals and balances after migration
- [ ] Verify audit / migration metadata if included in scope

## 12. Rollback Decision Triggers

Rollback should be considered if any of the following fail:

- Counts mismatch
- Relationships mismatch
- Totals mismatch
- Payment records mismatch
- Sample record comparison fails
- Required records are missing

## 13. Rollback Procedure

1. Stop all migration activity
2. Document the failure
3. Use the approved rollback/recovery plan
4. Do not patch production ad hoc
5. Restore the prior known-good state only in the approved environment
6. Record the rollback outcome

## 14. Recovery Verification Checklist

- [ ] Verify counts match the pre-migration export where expected
- [ ] Verify relationships are restored or preserved
- [ ] Verify payment integrity after recovery
- [ ] Verify sample records after recovery
- [ ] Verify the rollback outcome is documented

## 15. Data Integrity Checklist

- [ ] Verify customer count
- [ ] Verify project count
- [ ] Verify estimate count
- [ ] Verify invoice count
- [ ] Verify invoice payment count
- [ ] Verify totals and balances
- [ ] Verify relationship integrity
- [ ] Verify no accidental truncation or duplication

## 16. Go / No-Go Checkpoints

- GO for preview only after backup/export is complete
- NO-GO for migration writes until preview, rollback, and explicit approval are complete
- NO-GO for data migration until post-migration verification is defined
- NO-GO for production launch until recovery behavior is proven

## 17. Non-Goals

- No migration approval in this document
- No runtime auth implementation
- No UI permission gate implementation
- No backend writes
- No localStorage migration execution
- No secrets

## 18. Exact Next Step

- Complete backup/export planning, then review migration preview and rollback recovery gates before any future migration consideration

