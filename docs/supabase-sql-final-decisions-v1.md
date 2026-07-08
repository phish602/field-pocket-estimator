# Supabase SQL Final Decisions V1

This is a planning / decision artifact only.

- Not deployed SQL.
- Not a migration.
- Not runtime wiring.
- No backend writes are being added.

This document resolves the final naming and policy choices needed before a future SQL migration draft is created.

## 1. Final Decision Summary

- Ready for SQL migration draft: yes with conditions
- Reason: The remaining pending items are now reduced to final SQL draft wording and later implementation review, while the core naming and policy direction is settled.

## 2. Final Naming and Policy Decisions

- Final enum/check constraint naming direction: use check constraints first instead of rigid Postgres enums unless a later review chooses enums.
- Exact archive/soft-delete field names: `archived_at`, `archived_by`, `deleted_at`, `deleted_by`.
- Exact RLS helper function naming direction: `is_company_member(company_id)`, `company_role(company_id)`, `can_manage_company(company_id)`, `can_write_company_records(company_id)`.
- Whether viewers can export PDFs: yes, if PDF export is treated as read-only output of records they can already read.
- Whether members can archive projects: yes only if policy allows it and the project has no paid/partial invoice risk; otherwise owner/admin only.
- Final `migration_batch_id` format direction: `mig_YYYYMMDD_HHMMSS_<short-random>`.
- Where migration reports are stored: `migration_batches` and `migration_write_results`.

## 3. Required V1 Decisions

- Use check constraints first instead of rigid Postgres enums for statuses unless a later review chooses enums.
- Use clear check constraint names following a predictable pattern: `table_column_check`.
- Example direction: `projects_status_check`, `estimates_status_check`, `invoices_status_check`.
- Use `archived_at` for normal user-facing archive behavior.
- Reserve `deleted_at` / `deleted_by` for future trash behavior, not casual deletion.
- Do not use hard delete for records with linked documents or payments.
- Viewers may read records but should not mutate records.
- Members may create and edit operational records.
- Owner/admin remain required for migration approval and dangerous actions.
- `migration_batch_id` should follow the `mig_YYYYMMDD_HHMMSS_<short-random>` direction.
- Migration reports should be stored in `migration_batches` and `migration_write_results`.

## 4. Document Numbering Final Decision

- Estimate numbers are unique per company within estimates.
- Invoice numbers are unique per company within invoices.
- Estimate and invoice number spaces stay separate.
- The SQL draft should not enforce a shared document-number table unless explicitly decided later.

## 5. Status / Lifecycle Final Decision

- Projects: `draft`, `active`, `completed`, `archived`
- Estimates: `draft`, `pending`, `sent`, `approved`, `lost`
- Invoices: `draft`, `sent`, `partial`, `paid`, `overdue`, `void`
- Paid, partial, and void invoice updates must be treated as stricter future application/RLS behavior.
- Status values should align with current app-equivalent values where possible.

## 6. SQL Draft Permission Boundary

The SQL draft may include:

- Helper function drafts
- Policy drafts
- Table/check/index drafts

The SQL draft must not:

- Be executed
- Add runtime client wiring
- Add credentials
- Add UI permission gates

## 7. Unresolved / Future Decisions

The following items remain for later review:

- Exact paid / partial invoice edit restrictions
- Exact member project archive policy
- Exact viewer export toggle if product wants to restrict exports
- Attachment / photo storage implementation
- Backend storage bucket names
- Future trash / restore UI
- Future billing / admin role separation

## 8. Approval Gate

- The SQL migration draft may be created after this document if status is ready or ready with conditions.
- The SQL/RLS draft must still be separately reviewed before execution.
- Runtime wiring remains blocked.
- Credentials remain blocked.
- Production deployment remains blocked.

## 9. Non-Goals

Do not build any of the following yet:

- SQL
- Supabase policies
- Migrations
- Runtime auth
- UI permission gates
- Backend writes
- Schema deployment
- Credentials

This document locks the final SQL/RLS naming and policy direction while keeping implementation blocked until the draft is separately reviewed.

