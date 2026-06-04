# Supabase Non-Production Dry-Run Plan V1

This is a planning artifact only.
No SQL is being executed.
No SQL is being deployed.
No files are being moved into Supabase migration folders.
No runtime wiring is being added.
No backend writes are being added.
No credentials are being added.
Dry-run must happen only in a non-production Supabase project later.

## Dry-Run Goal

- Verify the executable migration package draft safely before production consideration
- Confirm schema creation
- Confirm RLS behavior
- Confirm role permissions
- Confirm `app_settings` company/user scope
- Confirm payment, audit, and migration protections
- Confirm no accidental destructive path exists

## Environment Requirements

- Non-production Supabase project only
- Disposable or isolated test project preferred
- No production data
- No production credentials
- No frontend runtime wiring
- No app deployment changes
- No real customer/project/invoice data
- Dry-run results must be documented before any next step

## Preparation Checklist

- Confirm package draft is committed
- Confirm package review report is committed
- Confirm no blockers are open
- Confirm `app_settings` scope decision is committed
- Confirm rollback/retry strategy is committed
- Confirm offline conflict strategy is committed
- Confirm no runtime/backend code changes are included
- Confirm SQL package is copied only into a temporary non-production dry-run context later, not this pass

## Execution Boundary

- This document does not execute the dry-run
- Future dry-run execution must be explicitly requested
- Future dry-run execution must identify the non-production project
- Future dry-run execution must not use production credentials
- Future dry-run execution must not wire the React app to Supabase
- Future dry-run execution must not migrate localStorage data

## Dry-Run Verification Areas

- Table creation
- Constraints
- Indexes
- RLS enabled
- Helper functions
- RLS policies
- Owner/admin/member/viewer behavior
- `app_settings` company/user scope
- Document numbering uniqueness
- Invoice payment safety
- Audit append-only behavior
- Migration batch/write result behavior
- Archive/soft-delete fields
- Blocked hard-delete paths

## Suggested Verification Checks

- Tables exist
- Primary keys exist
- Required `company_id` fields exist
- Required foreign keys exist
- Status check constraints exist
- Unique indexes for estimate/invoice numbers exist
- `app_settings` scope uniqueness exists
- RLS is enabled on every required table
- Helper functions exist
- Viewer cannot write
- Member cannot manage users or migration records
- Owner/admin can manage admin-sensitive records
- Audit update/delete is blocked or omitted
- Payment deletion is blocked or not casually allowed

## Test Role Scenarios

- Owner can read/write company operational data and manage users/migration records
- Admin can manage operational/admin-sensitive records as allowed
- Member can write operational records but cannot manage users or migration approval
- Viewer can read allowed records but cannot mutate records
- User-scoped `app_settings` can only be read/written by owning user
- Company-scoped `app_settings` can be read by members and written by owner/admin

## Failure Handling

- Document failed statements
- Document failed policies
- Document RLS mismatches
- Document constraint/index problems
- Do not patch production
- Do not wire runtime as workaround
- Fix package draft in docs first
- Rerun only in non-production after review

## Dry-Run Result Report Requirements

- Project/environment name or identifier, without secrets
- Date/time of dry-run
- Package version/file reviewed
- Table creation result
- RLS result
- Role behavior result
- `app_settings` result
- Payment/audit/migration safety result
- Blockers found
- Required fixes
- Recommendation for next step

## Production Blockers

- No production execution until dry-run passes
- No production execution until dry-run report is reviewed
- No runtime wiring until schema/RLS and write strategy are separately approved
- No credentials in frontend code
- No local data migration until migration preview/write approval
- No owner/admin approval gate bypass

## Recommended Next Step

After this plan is committed, create a docs-only dry-run result report template.
Do not execute SQL unless explicitly requested later and only against a non-production Supabase project.

## Non-Goals

- No SQL execution
- No Supabase deployment
- No migration folder changes
- No runtime auth
- No UI permission gates
- No backend writes
- No schema deployment
- No credentials
- No localStorage migration
- No production dry-run
