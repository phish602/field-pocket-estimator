# Supabase Backend V1 Migration Preview Runbook

## 1. Summary

This runbook defines the safe, preview-only process for reviewing local EstiPaid data before any migration write is approved.
It is read-only and does not approve writes.
Migration writes remain blocked until backup/export, rollback/recovery, preview review, and explicit approval are complete.

## 2. Current Status

- Disposable Supabase backend V1 dry-run/security verification has passed
- Production setup remains blocked
- Local-to-backend data migration remains blocked
- Migration preview is read-only and does not write to Supabase
- Runtime app wiring remains blocked until production schema/RLS/grants and app behavior gates are complete

## 3. Required Approvals Before Using This Runbook

- Production readiness checklist must be reviewed and approved first
- Backup/export and rollback/recovery gates must be complete
- Preview review must be complete
- This runbook does not approve writes

## 4. Migration Preview Scope

- Company profile
- Customers
- Projects
- Estimates
- Estimate line items
- Invoices
- Invoice line items
- Invoice payments
- Scope templates
- App settings
- Migration metadata

## 5. Required Backup / Export Before Preview

- Confirm localStorage snapshot/export exists before preview
- Confirm backup copy is stored outside the repo
- Confirm no real customer/business data is committed to Git

## 6. Local Data Sources to Inspect

- Local company profile data
- Local customer records
- Local project records
- Local estimate records
- Local estimate line item records
- Local invoice records
- Local invoice line item records
- Local invoice payment records
- Local scope template records
- Local app settings data
- Local audit / migration metadata if present

## 7. Preview-Only Mapping Review

- Confirm preview is read-only and does not write to Supabase
- Confirm source record counts are captured before mapping
- Confirm mapped record counts match expected entities
- Confirm skipped records are explained
- Confirm warnings and errors are captured

## 8. Record Count Checklist

- [ ] Source counts captured
- [ ] Mapped counts captured
- [ ] Skipped records captured
- [ ] Expected entity counts reviewed

## 9. Relationship Integrity Checklist

- [ ] Missing company references are reported
- [ ] Missing customer references are reported
- [ ] Missing project references are reported
- [ ] Missing estimate references are reported
- [ ] Missing invoice references are reported
- [ ] Estimate line items map to the correct parent estimate
- [ ] Invoice line items map to the correct parent invoice
- [ ] Payment records map to the correct invoice

## 10. Financial Integrity Checklist

- [ ] Invoice totals are reviewed
- [ ] Amount paid is reviewed
- [ ] Balance remaining is reviewed
- [ ] Payment records are reviewed against the correct invoice
- [ ] Totals and balances are consistent with source data

## 11. Warning / Error Review Checklist

- [ ] Warnings are reviewed before any write migration
- [ ] Errors are reviewed before any write migration
- [ ] Failed or blocked records are listed before write migration
- [ ] Missing relationships are listed before write migration
- [ ] Duplicate legacy local IDs are listed before write migration
- [ ] Document number collisions are listed before write migration

## 12. Duplicate / Collision Review Checklist

- [ ] Duplicate legacy local IDs are reported
- [ ] Document number collisions are reported
- [ ] Relationship collisions are reported
- [ ] Financial collisions are reported

## 13. Dry-Run Preview Output Requirements

- Source counts
- Mapped counts
- Skipped records
- Warnings
- Errors
- Duplicate / collision report
- Relationship issue report
- Financial totals comparison
- Approval recommendation

## 14. Migration Write Hard Stop

- Preview does not approve writes
- Migration writes remain blocked until backup/export, rollback/recovery, preview review, and explicit approval are complete
- Do not move from preview to write execution without explicit approval

## 15. Approval Gate Before Writes

- Confirm preview review is complete
- Confirm backup/export is complete
- Confirm rollback/recovery is complete
- Confirm explicit approval is documented
- Confirm write migration remains blocked until those gates pass

## 16. Non-Goals

- No SQL execution
- No Supabase deployment
- No migration write execution
- No runtime auth wiring
- No UI permission gate implementation
- No backend writes
- No secrets

## 17. Exact Next Step

- Complete the preview review, then stop and wait for explicit approval before any write migration is considered

