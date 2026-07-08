# Supabase Backend V1 Production Go / No-Go Runbook

## 1. Summary

This runbook defines the final approval gates required before production Supabase setup, credentials, runtime wiring, migration writes, or launch can proceed.
It is not approval to create production, wire the app, or approve migration execution.
Production remains blocked until explicit approval is documented.

## 2. Current Status

- Disposable Supabase backend V1 dry-run/security verification has passed
- Production setup remains blocked
- Credentials remain blocked
- Runtime wiring remains blocked
- Migration writes remain blocked
- Production launch remains blocked

## 3. Completed Dry-Run Evidence

Reference the completed dry-run evidence:

- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-dry-run-approval-gate-report.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-final-authenticated-grant-verification-result-v1.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-rls-final-write-deny-test-result-v1.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-clean-scratch-rerun-result-v1.md`

## 4. Required Documents Before Any Approval

- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-production-readiness-checklist.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-production-setup-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-backup-export-rollback-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-migration-preview-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-migration-write-execution-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-runtime-wiring-approval-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-app-behavior-regression-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-security-review-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-dry-run-approval-gate-report.md`

## 5. Go / No-Go Matrix

| Phase | Go condition | No-Go condition |
| --- | --- | --- |
| Production project setup | Production-readiness checklist reviewed and explicitly approved | Any missing approval or unresolved blocker |
| Production schema deployment | Approved SQL package and security review are complete | Schema/RLS/grants are unverified or unapproved |
| Credentials / env setup | Production project and schema/RLS/grants are verified | Missing or unapproved credentials handling |
| Runtime wiring | Credentials/env handling and runtime wiring approval are explicitly approved | Any unapproved code path or secret exposure |
| Migration preview | Backup/export and rollback/recovery gates are complete | Preview not reviewed or backup/rollback missing |
| Migration writes | Preview reviewed and explicit target-environment approval documented | No explicit migration write approval |
| App regression | Regression gates and smoke tests pass | Save/load, PDF, AI Assist, or fallback regressions |
| Security review | Security review is explicitly approved | Broad grants, missing RLS, or secret handling issues |
| Production launch | All prior gates are complete and explicitly approved | Any missing approval or failed verification |

## 6. Production Project Setup Approval Gate

- GO only after the production-readiness checklist is reviewed and explicitly approved
- Production approval must never be inferred from disposable dry-run success
- The production project must be separate from the disposable dry-run project

## 7. Production Schema Deployment Approval Gate

- GO only after schema/RLS/grant verification is complete and approved
- No production schema deployment without explicit approval
- Unverified schema, RLS, or grants are a hard stop

## 8. Credentials / Env Approval Gate

- NO-GO until the production project and schema/RLS/grants are verified
- Credentials must be handled only through approved env setup
- No secret, password, JWT, connection string, anon key, or service-role key may be committed

## 9. Runtime Wiring Approval Gate

- NO-GO until credentials/env handling and runtime wiring approval are explicitly approved
- Migration approval and runtime wiring approval are separate gates
- Runtime wiring must remain feature-flagged or reversible where applicable

## 10. Migration Preview Approval Gate

- NO-GO until backup/export and rollback/recovery gates are complete
- Preview must be reviewed before any write execution
- Preview approval does not approve writes

## 11. Migration Write Approval Gate

- NO-GO until migration preview is reviewed and explicit target-environment approval is documented
- Migration writes require a separate explicit approval
- Migration approval and runtime wiring approval are separate gates

## 12. App Regression Approval Gate

- NO-GO until app regression, save/load smoke tests, PDF/export, AI Assist, and fallback checks pass
- App launch can only proceed after regression evidence is complete

## 13. Security Review Approval Gate

- NO-GO until security review is explicitly approved
- Broad authenticated grants, missing RLS, or secret handling issues are hard stops
- Security approval is separate from setup, wiring, and migration approvals

## 14. Production Launch Approval Gate

- NO-GO until all prior gates are complete and explicitly approved
- Launch approval is separate from schema deployment, runtime wiring, and migration approval
- Production launch must be an explicit, documented go decision

## 15. Hard-Stop Conditions

- Any service-role key in frontend code
- Any database password or connection string committed
- Any anon key committed outside approved env handling
- Any JWT, session token, or auth token committed
- Missing RLS on any EstiPaid table
- Broad authenticated grants such as TRUNCATE, TRIGGER, or REFERENCES
- DELETE grants beyond `company_users`
- audit_events UPDATE or DELETE paths for authenticated
- Unverified production schema / RLS / grants
- Migration writes without backup/export, rollback, preview review, and explicit approval
- Runtime wiring without credential / env approval
- App regression failure after runtime wiring
- Financial mismatch after migration
- Production launch without explicit go / no-go approval

## 16. Approval Language Templates

### Production Project Setup Approval

```text
Target environment:
Date:
Approving person:
Approved scope:
Blocked exclusions:
Rollback requirement:
Validation requirement:
```

### Production Schema Deployment Approval

```text
Target environment:
Date:
Approving person:
Approved scope:
Blocked exclusions:
Rollback requirement:
Validation requirement:
```

### Credentials / Env Setup Approval

```text
Target environment:
Date:
Approving person:
Approved scope:
Blocked exclusions:
Rollback requirement:
Validation requirement:
```

### Runtime Wiring Approval

```text
Target environment:
Date:
Approving person:
Approved scope:
Blocked exclusions:
Rollback requirement:
Validation requirement:
```

### Migration Preview Approval

```text
Target environment:
Date:
Approving person:
Approved scope:
Blocked exclusions:
Rollback requirement:
Validation requirement:
```

### Migration Write Execution Approval

```text
Target environment:
Date:
Approving person:
Approved scope:
Blocked exclusions:
Rollback requirement:
Validation requirement:
```

### Production Launch Approval

```text
Target environment:
Date:
Approving person:
Approved scope:
Blocked exclusions:
Rollback requirement:
Validation requirement:
```

## 17. Non-Goals

- No production approval in this document
- No runtime auth implementation
- No UI permission gate implementation
- No backend writes
- No localStorage migration execution
- No secrets

## 18. Exact Next Step

- Keep production blocked until the required approvals are explicitly documented for each phase and then proceed only one gated step at a time

