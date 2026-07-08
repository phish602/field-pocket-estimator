# Supabase RLS Draft Review V1

This is a review artifact only.

- RLS SQL was not executed.
- RLS SQL was not deployed.
- RLS SQL was not moved into a migration folder.
- No runtime wiring is being added.
- No backend writes are being added.

This report determines whether the RLS draft is ready for a future combined SQL/RLS review or needs revision first.

## 1. Review Summary

- Overall status: Approved with conditions
- Reason: The helper functions and table policy intent align with the ownership and permissions docs, but this remains a docs-only draft and should be reviewed together with the SQL draft before any execution path exists.

## 2. Reviewed Helper Functions

- `is_company_member(company_id uuid)`: pass
  - Purpose is clear: active company membership check against `auth.uid()`.
  - Company-scoped behavior is clear.
  - `auth.uid()` membership intent is clear.
  - Role behavior is aligned to read gating.
  - Viewer remains read-only.
  - Helper name aligns with the final decision doc.

- `company_role(company_id uuid)`: pass
  - Purpose is clear: returns the active role for the authenticated user in the company.
  - Company-scoped behavior is clear.
  - `auth.uid()` membership intent is clear.
  - Role behavior is aligned to owner/admin/member/viewer separation.
  - Viewer remains read-only.
  - Helper name aligns with the final decision doc.

- `can_manage_company(company_id uuid)`: pass
  - Purpose is clear: owner/admin management gate.
  - Company-scoped behavior is clear.
  - `auth.uid()` membership intent is clear.
  - Role behavior is aligned to elevated control only.
  - Viewer remains read-only.
  - Helper name aligns with the final decision doc.

- `can_write_company_records(company_id uuid)`: pass
  - Purpose is clear: owner/admin/member write gate for operational records.
  - Company-scoped behavior is clear.
  - `auth.uid()` membership intent is clear.
  - Role behavior is aligned to write access only for approved roles.
  - Viewer remains read-only.
  - Helper name aligns with the final decision doc.

## 3. Table Policy Coverage Review

### companies

- Status: pass
- Finding: Read and owner/admin update intent are present; cross-company access is blocked by membership checks.
- Required follow-up: Final helper-function wiring should be reviewed together with the SQL draft.

### company_users

- Status: pass
- Finding: Read, insert, update, and delete intent are restricted to owner/admin or membership visibility as intended.
- Required follow-up: Final self-elevation and membership-transition behavior should remain review-gated.

### customers

- Status: pass
- Finding: Read/insert/update/delete policy intent aligns with company membership and write roles.
- Required follow-up: Hard delete should remain restricted in later review.

### projects

- Status: pass
- Finding: Read/write/archive/delete intent matches company membership and role gating.
- Required follow-up: Member archive edge cases remain a later policy question, not a blocker here.

### estimates

- Status: pass
- Finding: Read/write/archive/delete intent is present and stricter lifecycle handling is implied for sent/approved estimates.
- Required follow-up: Future app/RLS rules should refine sent/approved update strictness.

### estimate_line_items

- Status: pass
- Finding: Parent-document scoping is present for read/write/delete behavior.
- Required follow-up: Cascade expectations should remain aligned with parent estimate policies.

### invoices

- Status: pass
- Finding: Read/write/archive/delete intent is present with stricter handling implied for partial/paid/void states.
- Required follow-up: Future stricter update handling should be reviewed with app logic.

### invoice_line_items

- Status: pass
- Finding: Parent-document scoping is present for read/write/delete behavior.
- Required follow-up: Cascade expectations should remain aligned with parent invoice policies.

### invoice_payments

- Status: pass
- Finding: Read access and stricter mutation policy intent are clear, with payment deletion treated conservatively.
- Required follow-up: Later policy tightening for payment updates/deletes remains appropriate.

### scope_templates

- Status: pass
- Finding: Read/write/delete intent is company-scoped and consistent with the docs.
- Required follow-up: Company-wide vs user-specific scope can still be revisited later if needed.

### app_settings

- Status: pass
- Finding: The company-scoped and user-scoped policies align with the app_settings scope decision.
- Required follow-up: The exact setting-key classification remains a later policy detail.

### audit_events

- Status: pass
- Finding: Read access is company-scoped and mutation is append-only by design notes.
- Required follow-up: Keep update/delete omitted or blocked in the final review.

### migration_batches

- Status: pass
- Finding: Read/write/delete intent is owner/admin controlled, matching migration safety docs.
- Required follow-up: Review-only visibility for non-admin roles remains intentionally limited.

### migration_write_results

- Status: pass
- Finding: Read/write/delete intent is owner/admin controlled and tied to the migration batch.
- Required follow-up: Keep member/viewer write access blocked.

## 4. App Settings RLS Review

- Company-scoped settings are readable by active company members: pass
- Company-scoped settings are writable by owner/admin by default: pass
- User-scoped settings are readable/writable only by owning user within active company membership: pass
- Migration/sync settings remain owner/admin controlled: pass
- `setting_scope` behavior aligns with the app settings scope decision: pass

## 5. Payment / Audit / Migration Safety Review

- Invoice payments are readable by active company members: pass
- Payment insert behavior is limited to appropriate write roles: pass
- Payment update/delete remains stricter and review-gated: pass
- Policies do not encourage silent payment deletion: pass
- Paid/partial/void invoice risk remains protected for future stricter app/RLS behavior: pass
- Audit events are append-only by design: pass
- Audit event read behavior is company-scoped: pass
- Audit event update/delete behavior is blocked or omitted: pass
- Audit event insert behavior is clearly review-only or trusted-app-path future behavior: pass
- Migration batches write behavior is owner/admin controlled: pass
- Migration write results write behavior is owner/admin controlled: pass
- Migration traceability remains readable for allowed review roles: pass
- Member/viewer migration write access is not allowed: pass
- Migration approval remains blocked from runtime: pass

## 6. Blockers Found

No blockers found.

## 7. Conditions Before Combined SQL/RLS Review

The following conditions must remain true before a combined SQL/RLS review is considered complete:

- RLS remains docs-only.
- RLS is not executed.
- RLS is not deployed.
- RLS remains out of Supabase migration folders.
- Combined SQL/RLS review must happen separately.
- Runtime wiring remains blocked.
- Credentials remain blocked.
- Production deployment remains blocked.

## 8. Recommended Next Step

- Status is approved with conditions, so the next step is a docs-only combined SQL/RLS review report if the remaining future policy wording is kept aligned.

## 9. Non-Goals

Do not build any of the following yet:

- SQL execution
- Supabase deployment
- Migration folder changes
- Runtime auth
- UI permission gates
- Backend writes
- Schema deployment
- Credentials

This report is intended to show that the RLS draft is structurally aligned and ready for the next combined review step, while keeping implementation blocked until the separate review steps are complete.

