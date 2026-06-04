# Supabase RLS Policy Draft V1

This is a review artifact only.

- Not deployed SQL.
- Not a migration.
- Not wired into runtime.
- No backend writes are being added.

## 1. RLS Foundation

Recommended RLS foundation:

- `company_users` controls company membership.
- `company_id` scopes company-owned records.
- Active membership is required for company-scoped reads.
- Role controls write permissions.
- `viewer` is read-only.
- `owner` and `admin` have elevated control.
- `member` can create and edit operational records within limits.

## 2. Role Assumptions

Recommended roles:

- `owner`
- `admin`
- `member`
- `viewer`

## 3. Table-by-Table RLS Intent

### companies

- Read rule: active company members can read their company record.
- Insert rule: owner/admin creation only.
- Update rule: owner/admin only.
- Delete/archive rule: restricted; prefer archive or soft-delete.
- Special restrictions: prevent cross-company access.

### company_users

- Read rule: members can read their own membership; owner/admin can read company membership list.
- Insert rule: owner/admin only.
- Update rule: owner/admin only for role or status changes.
- Delete/archive rule: restricted; prefer membership status changes.
- Special restrictions: prevent self-elevation without approval rules.

### customers

- Read rule: active company members can read.
- Insert rule: member/admin/owner allowed.
- Update rule: member/admin/owner allowed within company.
- Delete/archive rule: owner/admin preferred; archive over hard delete.
- Special restrictions: no cross-company access.

### projects

- Read rule: active company members can read.
- Insert rule: member/admin/owner allowed.
- Update rule: member/admin/owner allowed within company.
- Delete/archive rule: prefer archive; hard delete only in narrow empty-record cases later.
- Special restrictions: project hard delete should remain tightly restricted.

### estimates

- Read rule: active company members can read.
- Insert rule: member/admin/owner allowed.
- Update rule: member/admin/owner allowed, with stricter rules later for sent/approved estimates.
- Delete/archive rule: restricted; prefer archive.
- Special restrictions: sent/approved records should have stricter edits later.

### estimate_line_items

- Read rule: active company members can read through parent estimate access.
- Insert rule: member/admin/owner allowed only with parent estimate access.
- Update rule: member/admin/owner allowed only with parent estimate access.
- Delete/archive rule: restricted through parent estimate policy.
- Special restrictions: line items must not escape parent document scope.

### invoices

- Read rule: active company members can read.
- Insert rule: member/admin/owner allowed.
- Update rule: member/admin/owner allowed, with stricter rules later for partial/paid/void documents.
- Delete/archive rule: restricted; prefer archive or void logic.
- Special restrictions: paid or partial invoices should have stricter edits later.

### invoice_line_items

- Read rule: active company members can read through parent invoice access.
- Insert rule: member/admin/owner allowed only with parent invoice access.
- Update rule: member/admin/owner allowed only with parent invoice access.
- Delete/archive rule: restricted through parent invoice policy.
- Special restrictions: line items must not escape parent document scope.

### invoice_payments

- Read rule: active company members can read.
- Insert rule: member/admin/owner allowed only under stricter payment rules.
- Update rule: restricted; payment edits should be limited and audited.
- Delete/archive rule: highly restricted; payment deletion should be exceptional.
- Special restrictions: payments require stricter mutation rules later.

### scope_templates

- Read rule: active company members can read.
- Insert rule: member/admin/owner allowed if template scope is approved.
- Update rule: member/admin/owner allowed.
- Delete/archive rule: preferred archive over delete.
- Special restrictions: preserve template history where possible.

### app_settings

- Read rule: active company members can read settings relevant to the company.
- Insert rule: owner/admin preferred; member only if the setting scope allows it.
- Update rule: owner/admin preferred; member only for safe operational settings if later approved.
- Delete/archive rule: restricted; prefer updates over delete.
- Special restrictions: company-wide vs user-specific scope must be decided first.

### audit_events

- Read rule: owner/admin and possibly member read access; viewer read access if allowed by policy.
- Insert rule: owner/admin/member can insert audit events for their company where `actor_id = auth.uid()`.
- Viewer cannot insert audit events.
- Outsider cannot insert audit events for another company.
- Update rule: none; audit events should be append-only.
- Delete/archive rule: do not delete casually.
- Special restrictions: audit_events should resist mutation.

### migration_batches

- Read rule: owner/admin only.
- Insert rule: approved backend migration process only.
- Update rule: owner/admin or backend process only.
- Delete/archive rule: restricted; prefer status updates.
- Special restrictions: migration reports should be owner/admin visible.

### migration_write_results

- Read rule: owner/admin only.
- Insert rule: approved backend migration process only.
- Update rule: owner/admin or backend process only.
- Delete/archive rule: restricted; prefer status updates.
- Special restrictions: write results should be owned by the migration batch and visible only to trusted roles.

## 4. Required Safety Rules

- No cross-company reads.
- No cross-company writes.
- No writes without active membership.
- Viewers cannot mutate records.
- Invoice payments require stricter mutation rules.
- Sent or approved estimates require stricter edits later.
- Paid or partial invoices require stricter edits later.
- Audit events should be append-only.
- Migration reports should be owner/admin visible.
- Hard delete should remain restricted.

## 5. Dangerous Action Policy Notes

- Project hard delete only for empty projects.
- Hard delete blocked when linked documents or payments exist.
- Payment deletion should be restricted.
- Migration approval should be owner/admin only.
- Destructive actions should require typed confirmation in UI.

## 6. Open RLS Decisions

The following items still need final policy decisions:

- Exact SQL policy names
- Exact helper functions
- Owner vs admin differences
- Whether members can archive projects
- Whether viewers can export PDFs
- Whether members can record payments
- Whether `app_settings` are company-wide or user-specific
- Whether `scope_templates` are company-wide, user-specific, or both

## 7. Non-Goals

Do not build any of the following yet:

- SQL implementation
- Supabase migration
- RLS deployment
- Runtime permission enforcement
- UI permission gates
- Backend credentials
- Backend writes

This draft is intended to review the future RLS direction before any policy code exists.
