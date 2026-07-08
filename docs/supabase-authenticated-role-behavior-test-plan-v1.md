# Supabase Authenticated Role Behavior Test Plan V1

## Summary

- Project: `estipaid-backend-v1-dryrun`
- Project URL identifier only: `https://otdwufeqcblinzcvtbjc.supabase.co`
- Status before this test: schema dry-run passed with conditions
- Remaining blocker: actual authenticated role behavior is not yet proven
- Production wiring remains blocked until this test passes

## Why This Test Is Required

The non-production schema dry-run confirmed the SQL package structure, but it did not prove how authenticated users behave under RLS.
This test is required to verify owner, admin, member, viewer, and outsider access before any production wiring is considered.

## Test Environment Safety Rules

- Use the disposable non-production Supabase project only
- Do not use production data
- Do not use production credentials
- Do not wire the React app to Supabase
- Do not modify localStorage behavior
- Do not change save/load flows
- Do not add secrets to repo files
- Do not treat this plan as production approval

## Required Test Users

- Owner test user
- Admin test user
- Member test user
- Viewer test user
- Outsider test user with no company membership

## Required Seed Data

- One test company
- `company_users` records assigning owner/admin/member/viewer roles
- One customer
- One project
- One estimate
- One estimate line item
- One invoice
- One invoice line item
- One invoice payment
- One scope template
- One `app_settings` company-scoped row
- One `app_settings` user-scoped row
- One audit event
- One migration batch
- One migration write result

## Role Behavior Matrix

| Role | Read company records | Write operational records | Manage company users | Manage migration records | Read app_settings company scope | Write app_settings company scope | Read app_settings user scope | Write app_settings user scope |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Owner | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes, for own user-scoped rows |
| Admin | Yes | Yes | Yes | Yes | Yes | Yes | Yes | Yes, for own user-scoped rows |
| Member | Yes | Yes, where policies allow | No | No | Yes | No by default | Yes, for own rows | Yes, for own rows |
| Viewer | Yes | No | No | No | Yes | No | Yes, for own rows if allowed | No |
| Outsider | No | No | No | No | No | No | No | No |

## Table-by-Table Expectations

- `companies`
  - Owner/admin can read and update company-level fields
  - Member can read
  - Viewer can read
  - Outsider cannot read or write

- `company_users`
  - Owner/admin can read, insert, update, and delete membership rows
  - Member and viewer can read company membership only if allowed by RLS
  - Outsider cannot read or write

- `customers`
  - Owner/admin/member can read
  - Owner/admin/member can create and update where policies allow
  - Viewer can read only
  - Outsider cannot read or write

- `projects`
  - Owner/admin/member can read
  - Owner/admin/member can create and update where policies allow
  - Viewer can read only
  - Outsider cannot read or write

- `estimates`
  - Owner/admin/member can read
  - Owner/admin/member can create and update where policies allow
  - Viewer can read only
  - Outsider cannot read or write

- `estimate_line_items`
  - Owner/admin/member can read
  - Owner/admin/member can create and update where policies allow
  - Viewer can read only
  - Outsider cannot read or write

- `invoices`
  - Owner/admin/member can read
  - Owner/admin/member can create and update where policies allow
  - Viewer can read only
  - Outsider cannot read or write

- `invoice_line_items`
  - Owner/admin/member can read
  - Owner/admin/member can create and update where policies allow
  - Viewer can read only
  - Outsider cannot read or write

- `invoice_payment`
  - Owner/admin/member can read
  - Owner/admin/member can create where policies allow
  - Update/delete remains stricter
  - Viewer can read only
  - Outsider cannot read or write

- `scope_template`
  - Owner/admin/member can read
  - Owner/admin/member can create and update where policies allow
  - Viewer can read only
  - Outsider cannot read or write

- `app_settings`
  - Company-scoped row readable by company members
  - Company-scoped row writable by owner/admin by default
  - User-scoped row readable/writable by owning user within active membership
  - Viewer cannot mutate another user’s settings
  - Outsider cannot read or write

- `audit_event`
  - Owner/admin/member can read company-scoped events
  - Insert path may be allowed only if the app path is trusted
  - Update/delete should not be allowed casually
  - Viewer can read only
  - Outsider cannot read or write

- `migration_batch`
  - Owner/admin can read and manage
  - Member and viewer cannot manage
  - Outsider cannot read or write

- `migration_write_result`
  - Owner/admin can read and manage
  - Member and viewer cannot manage
  - Outsider cannot read or write

## Denied-Action Expectations

- Viewer cannot insert or update operational records
- Member cannot manage company_users
- Member cannot manage migration admin records
- Outsider cannot read company-scoped rows
- Outsider cannot insert, update, or delete company-scoped rows
- Payment update/delete should remain stricter than ordinary operational updates
- Audit update/delete should remain blocked or omitted

## Hard-Delete Expectations

- Only `company_users` should have a DELETE policy
- `customers`, `projects`, `estimates`, `invoices`, `invoice_payment`, `audit_event`, `migration_batch`, and `migration_write_result` should not allow app-user DELETE
- Business records should use archive/status behavior instead of hard-delete

## Safe App Behavior

- Customer removal maps to `archived_at` / `archived_by`
- Project archive maps to `status = archived` plus `archived_at` / `archived_by`
- Estimate cancellation maps to `status = lost` plus optional `archived_at` / `archived_by`
- Invoice cancellation maps to `status = void` plus optional `archived_at` / `archived_by`
- Payment correction should preserve the original record and use correction/reversal behavior later
- Audit events are append-only from the app perspective

## Pass/Fail Recording Template

- Test case:
- Role:
- Table:
- Action attempted:
- Expected result:
- Actual result:
- Pass / fail:
- Notes:

## Production Approval Gate

- Production wiring remains blocked until this test passes
- This test plan does not approve production deployment
- Authenticated RLS behavior must be verified with real test users before production wiring is allowed

## Non-Goals

- No source/runtime file changes
- No SQL execution
- No Supabase deployment
- No credentials
- No runtime auth wiring
- No localStorage migration
- No backend writes
- No UI changes

## Exact Next Step After This Document

- Run the authenticated role behavior verification manually in the disposable non-production Supabase project and record results using a pass/fail checklist
