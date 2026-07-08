# Backend Ownership and RLS Decisions

This is a planning document only.

- No Supabase code is being added.
- No SQL policies are being created yet.
- No runtime sync is being wired.

## 1. Ownership Model

Recommended ownership model:

- Company-owned app data should use `company_id`.
- User identity should use `user_id` or `auth_user_id` where useful.
- User membership should control access to company records.
- Migrated records should preserve `legacy_local_id` for traceability.

Ownership goal:

- Keep company scope strict.
- Keep actor identity separate from business ownership.
- Preserve migration lineage without changing current local behavior.

## 2. Proposed Membership Table

Recommended membership table: `company_users`

Suggested fields:

- `company_id`
- `user_id`
- `role`
- `status`
- `invited_at`
- `joined_at`
- `created_at`
- `updated_at`

## 3. Proposed Roles

Recommended roles:

- `owner`
- `admin`
- `member`
- `viewer`

## 4. Role Intent

Recommended role intent:

- `owner`: full control, billing/company/admin access
- `admin`: manage records and users, limited billing/company control
- `member`: create and edit operational records
- `viewer`: read-only access

## 5. Company-Scoped Records

The following records should be company-scoped:

- customers
- projects
- estimates
- estimate line items
- invoices
- invoice line items
- invoice payments
- scope templates
- app settings
- audit events

## 6. RLS Policy Intent

Recommended RLS intent:

- Users can only read company records where they are active members.
- Write access depends on role.
- Viewers cannot mutate records.
- Deleted or archived records should remain available in audit history.
- Payments and sent/paid documents should have stricter mutation rules later.

## 7. Record Ownership Fields

Recommended ownership and traceability fields:

- `company_id`
- `created_by`
- `updated_by`
- `archived_by`
- `deleted_by` if soft-delete is used
- `migration_batch_id` for migrated records

## 8. Soft-Delete / Archive Direction

Recommended lifecycle direction:

- Projects should prefer `archived_at` / `archived_by` over hard delete.
- Hard delete should be blocked when real documents exist.
- Estimates and invoices should avoid hard delete after sent or paid states.
- Audit events should not be deleted casually.

## 9. RLS Safety Rules

Recommended safety rules:

- No record should be readable without company membership.
- No write should happen without active membership.
- No cross-company customer/project/document access.
- No orphaned invoice payments.
- No orphaned line items.
- No missing `company_id` on company-owned records.

## 10. Migration Implications

Migration and preview should account for:

- Missing `companyId` / `userId` should block migration.
- `company_id` should be assigned consistently.
- Legacy IDs should be retained for traceability.
- Migration should not silently merge users or companies.

## 11. Open Decisions

The following items still need final decisions:

- Exact role permissions
- Whether one user can own multiple companies
- Invite flow
- Company transfer flow
- Billing owner vs operational owner
- Whether `app_settings` are company-wide or user-specific
- Whether scope templates can be company-wide, user-specific, or both
- Exact Supabase RLS SQL policy names
- Soft-delete field naming

## 12. Non-Goals Right Now

Do not build any of the following yet:

- SQL
- Supabase migrations
- RLS policies
- backend writes
- runtime sync
- UI implementation
- auth implementation

This document is intended to lock the ownership and access-control direction before implementation work starts.

