# Supabase Non-Production Dry-Run Result Template V1

This is a report template only.
No SQL is being executed.
No SQL is being deployed.
No files are being moved into Supabase migration folders.
No runtime wiring is being added.
No backend writes are being added.
No credentials are being added.
This template is for recording future non-production dry-run results only.

## Dry-Run Metadata

- Dry-run date/time:
- Reviewer/executor:
- Non-production project identifier, without secrets:
- Package file/version reviewed:
- Source commit/tag:
- Environment notes:
- Confirmation no production data was used:
- Confirmation no production credentials were used:

## Execution Boundary Confirmation

- SQL executed only in non-production
- No production deployment
- No frontend runtime wiring
- No app deployment changes
- No localStorage migration
- No backend sync code
- No credentials committed

## Table Creation Result

For each table below, record a status and notes.

- `companies`
- `company_users`
- `customers`
- `projects`
- `estimates`
- `estimate_line_items`
- `invoices`
- `invoice_line_items`
- `invoice_payments`
- `scope_templates`
- `app_settings`
- `audit_events`
- `migration_batches`
- `migration_write_results`

Status: pass / needs review / fail

Notes:

## Constraints and Indexes Result

- Primary keys
- Foreign keys
- Status check constraints
- Role check constraints
- `app_settings` `setting_scope` check
- Estimate number uniqueness
- Invoice number uniqueness
- `app_settings` scope uniqueness
- Company / legacy / migration lookup indexes
- Relationship indexes
- Audit company/time indexes

Status: pass / needs review / fail

Notes:

## RLS Result

- RLS enabled on all required tables
- Helper functions exist
- Select policies
- Insert policies
- Update policies
- Delete / hard-delete blocked or omitted where required
- Migration write policies owner/admin controlled

Status: pass / needs review / fail

Notes:

## Role Scenario Result

- Owner behavior
- Admin behavior
- Member behavior
- Viewer behavior
- Company-scoped `app_settings` behavior
- User-scoped `app_settings` behavior
- Migration batch / write result access

Status: pass / needs review / fail

Notes:

## Safety Verification

- No casual hard-delete path for protected records
- Payment deletion blocked or not casually allowed
- Audit update/delete blocked or omitted
- Member/viewer cannot manage migration records
- Viewer cannot mutate company records
- Separate estimate/invoice number spaces preserved
- Archive/soft-delete fields present

Status: pass / needs review / fail

Notes:

## Failure Log

- Failed statement or check:
- Affected table / policy / function:
- Failure type:
- Severity: blocker / needs review / informational
- Suspected cause:
- Required fix:
- Retry required: yes / no

## Dry-Run Outcome

- Overall result: passed / passed with conditions / needs revision / blocked
- Blockers found:
- Needs-review items:
- Recommended next step:

## Production Blocker Confirmation

- Production execution remains blocked unless dry-run passes and is reviewed
- Runtime wiring remains blocked
- Credentials remain blocked
- Local data migration remains blocked
- Owner/admin approval gate remains required

## Sign-Off

- Reviewer notes:
- Approved for next review step: yes / no / with conditions
- Date:
- Reviewer:

## Recommended Next Step

- If dry-run passes later, create a docs-only dry-run review report
- If dry-run fails later, amend the package draft in docs first
- Do not production deploy from this template

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
