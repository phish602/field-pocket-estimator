# Supabase Clean Scratch Rerun Result V1

## Summary

- Result status: Passed with grant correction required
- The corrected package reran cleanly from scratch in the disposable project after a manual least-privilege grant patch was applied in the disposable context.
- Production remains blocked until this least-privilege grant correction is reviewed and rerun cleanly from scratch.

## Environment

- Disposable project: `estipaid-backend-v1-dryrun`
- Project URL identifier only: `https://otdwufeqcblinzcvtbjc.supabase.co`
- Execution method: manual Supabase SQL Editor
- Package rerun: `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-executable-migration-package-draft-v1.sql`

## Corrected Package Result

- Tables created: pass
- RLS enabled on all EstiPaid tables: pass
- Policies created: pass
- Helper functions exist: pass
- audit_events policy check: pass
- audit_events insert policy with_check: `can_write_company_records(company_id) AND actor_id = auth.uid()`

## Finding: Authenticated Grants Too Broad

- Authenticated grants were present but too broad in the first clean scratch rerun
- Broad unwanted privileges observed:
  - TRUNCATE
  - TRIGGER
  - REFERENCES
- A manual disposable-project patch was applied to remove the broad behavior and reapply least-privilege grants

## Patch Verification

- No TRUNCATE: pass
- No TRIGGER: pass
- No REFERENCES: pass
- DELETE only on `company_users`: pass
- SELECT / INSERT / UPDATE on expected app tables: pass
- Explicit execute grants only on the four public helper functions: pass

## Retest Result

- The corrected package reran cleanly from scratch after the grant correction
- RLS and policy behavior remained intact after the grant correction
- viewer remains read-only
- owner/admin/member behavior remained aligned with the documented policy model

## Required Repo SQL Corrections

- Keep explicit least-privilege grants in `docs/supabase-executable-migration-package-draft-v1.sql`
- Keep equivalent least-privilege grants in `docs/supabase-rls-draft-v1.sql`
- Keep the human-readable RLS policy doc aligned with the corrected grant behavior
- Keep `audit_events` insert limited to `can_write_company_records(company_id)` and `actor_id = auth.uid()`

## Remaining Production Blockers

- Production wiring remains blocked
- Production deployment remains blocked
- The least-privilege grant correction must be reviewed again
- The corrected package must be rerun cleanly from scratch before any production consideration

## Approval Recommendation

- Recommended status: Passed with grant correction required
- Recommendation: do not promote to production until the corrected least-privilege package is reviewed and rerun cleanly from scratch in disposable non-production

## Non-Goals

- No source/runtime file changes
- No production deployment
- No production credentials
- No runtime auth wiring
- No backend writes
- No localStorage migration
- No UI changes

## Exact Next Step

- Review the least-privilege correction, rerun the corrected package cleanly from scratch in disposable non-production, and then decide whether production wiring may proceed
