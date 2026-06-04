# Supabase Backend V1 App Behavior Regression Runbook

## 1. Summary

This runbook defines the app smoke and regression checks required before and after any future Supabase runtime wiring.
It preserves the current app experience and is not approval to wire the app.
Runtime wiring remains blocked.

## 2. Current Status

- Disposable Supabase backend V1 dry-run/security verification has passed
- Production setup remains blocked
- Credentials remain blocked
- Runtime wiring remains blocked
- Migration writes remain blocked

## 3. Required Approvals Before Using This Runbook

- Production readiness checklist must be reviewed and approved first
- Runtime wiring approval runbook must be reviewed and approved first
- Backup/export and rollback/recovery gates must be complete
- Migration preview and migration write execution gates must be complete
- Explicit runtime wiring approval must be documented

## 4. Regression Scope

- Company profile
- Customer workflow
- Project workflow
- Estimate workflow
- Invoice workflow
- Payment workflow
- Scope templates
- Save/load/history
- localStorage fallback
- PDF/export
- AI Assist
- Spanish/bilingual behavior
- Mobile/PWA behavior
- Supabase failure behavior
- Delete/archive UI behavior

## 5. Pre-Wiring Baseline Capture

- [ ] Capture baseline screenshots or notes before wiring
- [ ] Capture current save/load behavior before wiring
- [ ] Capture PDF export behavior before wiring
- [ ] Capture AI Assist behavior before wiring
- [ ] Capture mobile layout behavior before wiring
- [ ] Capture localStorage fallback expectations before wiring

## 6. Company Profile Checklist

- [ ] Company profile loads
- [ ] Company profile saves
- [ ] Company logo behavior is unchanged
- [ ] Company fields remain editable as expected

## 7. Customer Workflow Checklist

- [ ] Customer create works
- [ ] Customer edit works
- [ ] Customer load works
- [ ] Customer delete/archive UI behavior matches approved backend safety model

## 8. Project Workflow Checklist

- [ ] Project create works
- [ ] Project edit works
- [ ] Project load works
- [ ] Project delete/archive UI behavior matches approved backend safety model

## 9. Estimate Workflow Checklist

- [ ] Estimate create works
- [ ] Estimate edit works
- [ ] Estimate load works
- [ ] Document numbers remain stable
- [ ] Totals calculate correctly
- [ ] Materials markup remains correct
- [ ] Labor quantity and duplicate/decrement behavior remain correct
- [ ] Hazard, risk, and contingency behavior remain correct

## 10. Invoice Workflow Checklist

- [ ] Invoice create works
- [ ] Invoice edit works
- [ ] Invoice load works
- [ ] Document numbers remain stable
- [ ] Totals calculate correctly
- [ ] Customer/project linkage remains correct

## 11. Payment Workflow Checklist

- [ ] Invoice payment recording works
- [ ] Payment totals and balances remain correct
- [ ] Payment behavior remains aligned with approved backend safety model

## 12. Scope Templates Checklist

- [ ] Scope templates and trade inserts still work
- [ ] Template selection behavior is unchanged
- [ ] Template content remains intact

## 13. Save / Load / History Checklist

- [ ] Saved history loads expected records
- [ ] Existing save/load behavior remains intact
- [ ] History entries remain readable after wiring

## 14. localStorage Fallback Checklist

- [ ] localStorage fallback behavior is intentionally defined before cutover
- [ ] App can recover if Supabase request fails
- [ ] User-facing fallback behavior is acceptable
- [ ] Fallback does not silently destroy local work

## 15. PDF / Export Checklist

- [ ] PDF export layout is unchanged
- [ ] PDF export totals are unchanged
- [ ] PDF behavior remains unchanged

## 16. AI Assist Checklist

- [ ] AI Assist output flow is unchanged
- [ ] AI Assist behavior remains unchanged after wiring

## 17. Spanish / Bilingual Behavior Checklist

- [ ] Spanish UI behavior is unchanged
- [ ] Spanish export behavior is unchanged
- [ ] Bilingual output remains correct

## 18. Mobile / PWA Behavior Checklist

- [ ] Mobile layout remains usable
- [ ] PWA/offline expectations are documented
- [ ] Mobile interactions remain usable after wiring

## 19. Supabase Failure Behavior Checklist

- [ ] Failed Supabase requests do not silently destroy local work
- [ ] User-facing error behavior is acceptable
- [ ] Fallback behavior is acceptable
- [ ] Error handling is clear and recoverable

## 20. Post-Wiring Comparison Checklist

- [ ] Compare baseline vs post-wiring screenshots or notes
- [ ] Compare save/load behavior before and after wiring
- [ ] Compare PDF export before and after wiring
- [ ] Compare AI Assist behavior before and after wiring
- [ ] Compare mobile behavior before and after wiring
- [ ] Compare error/fallback behavior before and after wiring

## 21. Rollback Trigger Checklist

- [ ] Save/load regression appears
- [ ] PDF regression appears
- [ ] AI Assist regression appears
- [ ] Mobile regression appears
- [ ] Fallback behavior is not acceptable
- [ ] Data appears to be silently lost or overwritten

## 22. Non-Goals

- No runtime wiring approval in this document
- No production deployment authorization
- No backend writes
- No localStorage migration implementation
- No secrets
- No UI implementation

## 23. Exact Next Step

- Keep runtime wiring blocked until this regression runbook has been completed alongside the other required gates and explicitly approved

