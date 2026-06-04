# Supabase Executable Migration Package Plan V1

This is a planning artifact only.
No executable migration is being created.
No SQL is being executed.
No SQL is being deployed.
No files are being moved into Supabase migration folders.
No runtime wiring is being added.
No backend writes are being added.
No credentials are being added.

## Package Goal

This plan defines how a future executable migration package should be assembled from the reviewed docs-only schema SQL and RLS SQL.
The goal is to preserve review gates, keep schema creation, RLS enablement, policies, indexes, and comments auditable, and prevent accidental deployment or runtime wiring.

## Future Package Contents

- Schema SQL
- RLS helper functions
- RLS enablement
- RLS policies
- Indexes
- Constraints
- Table comments and safety comments
- Optional verification queries
- Rollback notes, not automatic destructive rollback

## Required Package Order

1. Extensions, if needed
2. Tables
3. Constraints
4. Indexes
5. Helper functions
6. Enable RLS
7. Policies
8. Comments
9. Verification queries

## Blocked Package Contents

- Seed data
- Production credentials
- Runtime client code
- UI permission gates
- Supabase storage buckets
- Automatic destructive rollback
- localStorage migration writes
- Backend sync code
- Payment/Stripe code

## Review Gates Before Executable Package Creation

- Combined SQL/RLS review committed
- No blockers open
- `app_settings` scope resolved
- Document numbering reviewed
- Payment safety reviewed
- Audit safety reviewed
- Migration traceability reviewed
- Rollback/retry strategy reviewed
- Offline conflict strategy reviewed

## Review Gates After Executable Package Creation

- SQL syntax review
- RLS policy review
- Table relationship review
- Index/constraint review
- Destructive-action review
- Test database dry-run review
- Rollback/retry review
- No production execution until approved

## Dry-Run Expectations

The executable package must be tested against a non-production Supabase project first.

The dry-run must verify:

- Table creation
- RLS enabled
- Owner/admin/member/viewer behavior
- `app_settings` company/user scope behavior
- Migration batch/report table behavior
- No casual hard delete path for protected records
- Payment and audit protections

## Rollback And Retry Expectations

- No automatic destructive rollback in V1
- Failed dry-run must produce notes
- Retry should be based on a corrected migration package
- Production rollback strategy must be separately approved
- Local data must never be deleted because backend migration fails

## Production Execution Blockers

- No credentials in frontend code
- No runtime sync before schema/RLS are approved
- No production execution before dry-run passes
- No production execution before RLS behavior is verified
- No production execution before migration preview/write strategy is approved
- No production execution without owner/admin approval gate

## Recommended Next Step

After this plan is committed, create a docs-only executable migration package review checklist.
Do not create the executable migration yet unless explicitly requested after that checklist.

## Non-Goals

- No executable SQL migration
- No SQL execution
- No Supabase deployment
- No migration folder changes
- No runtime auth
- No UI permission gates
- No backend writes
- No schema deployment
- No credentials
