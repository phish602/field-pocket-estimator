# Backend Role Permissions Matrix

This is a planning document only.

- No RLS code is being added.
- No Supabase SQL is being added.
- No runtime permission enforcement is being wired yet.

## 1. Roles

Recommended roles:

- `owner`
- `admin`
- `member`
- `viewer`

## 2. Permissions Matrix

Permission labels:

- `full`
- `manage`
- `create/edit`
- `read`
- `none`

| Area | owner | admin | member | viewer |
|---|---|---|---|---|
| company profile | full | manage | read | read |
| company users | full | manage | none | none |
| customers | full | manage | create/edit | read |
| projects | full | manage | create/edit | read |
| estimates | full | manage | create/edit | read |
| invoices | full | manage | create/edit | read |
| invoice payments | full | manage | create/edit | read |
| scope templates | full | manage | create/edit | read |
| app settings | full | manage | read | read |
| audit events | read | read | read | read |
| exports/PDFs | full | full | create/edit | read |
| migration preview | full | manage | read | read |
| backend sync approval | full | manage | none | none |

## 3. Recommended Permission Direction

- `owner`
  - Full access to company, users, billing/admin decisions, migration approval, records, and exports.
- `admin`
  - Manage operational records and users, with limited billing/company ownership control.
- `member`
  - Create and edit customers, projects, estimates, invoices, payments, and templates; export PDFs; no user/admin/billing control.
- `viewer`
  - Read-only access with PDF export if allowed; no mutations.

## 4. Mutation Rules

Recommended stricter rules:

- Sent estimates require stricter edits.
- Approved estimates require caution.
- Paid or partial invoices require stricter edits.
- Payments should not be casually deleted.
- Audit events should be append-only/read-only.
- Archived projects can be restored by owner/admin, and possibly member depending on the final policy.

## 5. Dangerous Action Rules

Recommended restrictions:

- Hard delete project only for empty projects.
- Hard delete should be blocked when linked documents or payments exist.
- Destructive actions should require typed confirmation.
- Migration approval should require owner/admin only.
- Backend sync approval should not be available to viewer or member.

## 6. RLS Translation Notes

This matrix is intended to drive future RLS policies.

- Company membership should be required for every company-scoped read.
- Role should be required for writes.
- Viewer should map to read-only policies.
- Audit events should resist mutation.

## 7. Open Decisions

The following items still need final policy decisions:

- Can viewers export PDFs?
- Can members archive projects?
- Can admins manage billing?
- Can admins invite or remove other admins?
- Can members edit sent estimates?
- Can members record payments?
- Who can approve backend migration?
- Who can permanently delete empty or test records?

## 8. Non-Goals Right Now

Do not build any of the following yet:

- SQL
- Supabase policies
- runtime auth
- UI permission gates
- backend writes
- schema changes

This matrix is intended to stay ahead of implementation and define the role policy direction before enforcement exists.

