# Supabase Clean Scratch Rerun Result V1

## Summary

- Result status: Failed on least-privilege grants
- The final clean scratch rerun still produced broad authenticated privileges for `authenticated` on the corrected package.
- Production remains blocked until the SQL correction is reviewed and the package is rerun cleanly from scratch.

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

- Authenticated grants were present but too broad in the final clean scratch rerun
- Broad unwanted privileges observed:
  - TRUNCATE
  - TRIGGER
  - REFERENCES
- The package still produced these broad privileges for `authenticated`

## SQL Correction Applied After the Failure

- Added a defensive revoke/reset before explicit grants in the executable package draft
- Added matching revoke/reset guidance in the RLS draft
- Replaced any broad authenticated function execution behavior with explicit helper function grants only

## Patch Verification

- No TRUNCATE: not yet proven in a fresh rerun after this correction
- No TRIGGER: not yet proven in a fresh rerun after this correction
- No REFERENCES: not yet proven in a fresh rerun after this correction
- DELETE only on `company_users`: not yet proven in a fresh rerun after this correction
- SELECT / INSERT / UPDATE on expected app tables: not yet proven in a fresh rerun after this correction
- Explicit execute grants only on the four public helper functions: not yet proven in a fresh rerun after this correction

## Retest Result

- A fresh clean-scratch rerun is still required after this SQL correction
- RLS and policy behavior were not revalidated after the latest correction
- viewer behavior remains expected by policy, but the corrected package still needs a fresh from-scratch rerun

## Required Repo SQL Corrections

- Keep the defensive revoke/reset before explicit grants in `docs/supabase-executable-migration-package-draft-v1.sql`
- Keep the defensive revoke/reset before explicit grants in `docs/supabase-rls-draft-v1.sql`
- Keep explicit least-privilege table grants only
- Keep explicit helper function execute grants only
- Keep the human-readable RLS policy doc aligned with the corrected grant behavior
- Keep `audit_events` insert limited to `can_write_company_records(company_id)` and `actor_id = auth.uid()`

## Remaining Production Blockers

- Production wiring remains blocked
- Production deployment remains blocked
- The SQL correction must be reviewed again
- The corrected package must be rerun cleanly from scratch before any production consideration

## Approval Recommendation

- Recommended status: Failed on least-privilege grants
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

- Review the SQL correction, rerun the corrected package cleanly from scratch in disposable non-production, and then decide whether production wiring may proceed
