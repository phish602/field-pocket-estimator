# Supabase Combined SQL/RLS Review V1

This is a review artifact only.

- SQL was not executed.
- RLS was not executed.
- Nothing was deployed.
- Nothing was moved into a migration folder.
- No runtime wiring is being added.
- No backend writes are being added.

This report determines whether the SQL/RLS drafts are ready for a future reviewed executable migration package or need revision first.

## 1. Combined Review Summary

- Overall status: Approved with conditions
- Reason: The SQL draft and RLS draft are aligned with the planning docs, schema draft, ownership/RLS decisions, and safety strategy docs, but they remain docs-only artifacts and must still be separately reviewed before any executable package is created.

## 2. Schema + RLS Alignment Review

### companies

- Status: pass
- Finding: The table exists in the SQL draft, and the RLS draft enables company-scoped membership-based read/update behavior.
- Required follow-up: Keep runtime wiring blocked until the executable package is separately reviewed.

### company_users

- Status: pass
- Finding: The table exists, and RLS intent supports membership visibility and owner/admin management.
- Required follow-up: Final helper/policy names remain review-only.

### customers

- Status: pass
- Finding: The table exists, company ownership is present, and membership-gated read/write intent is aligned.
- Required follow-up: Hard delete remains restricted in policy review.

### projects

- Status: pass
- Finding: The table exists, company ownership and customer linkage are present, and role-based archive/update intent is aligned.
- Required follow-up: Member archive edge cases remain future policy review items.

### estimates

- Status: pass
- Finding: The table exists, company/customer/project ownership is present, and stricter sent/approved handling is reflected in policy intent.
- Required follow-up: Final lifecycle-specific enforcement remains future review work.

### estimate_line_items

- Status: pass
- Finding: The table exists, parent estimate linkage is present, and company-scoped access intent is aligned.
- Required follow-up: Cascade behavior remains a later execution review item.

### invoices

- Status: pass
- Finding: The table exists, company/customer/project/estimate linkage is present, and stricter partial/paid/void handling is aligned.
- Required follow-up: Final update restrictions remain future policy review items.

### invoice_line_items

- Status: pass
- Finding: The table exists, parent invoice linkage is present, and company-scoped access intent is aligned.
- Required follow-up: Cascade behavior remains a later execution review item.

### invoice_payments

- Status: pass
- Finding: The table exists, invoice linkage and required amount are present, and payment safety intent is aligned.
- Required follow-up: Final payment mutation restrictions remain review-gated.

### scope_templates

- Status: pass
- Finding: The table exists, company ownership is present, and access intent is aligned.
- Required follow-up: Company-wide vs user-specific template scope remains a later policy choice only if needed.

### app_settings

- Status: pass
- Finding: The table exists with company/user scope support, and the RLS draft aligns with the app_settings scope decision.
- Required follow-up: Final setting-key classification remains a later review detail.

### audit_events

- Status: pass
- Finding: The table exists, company/actor identity is represented, and append-only intent is aligned.
- Required follow-up: Keep update/delete omitted or blocked in execution review.

### migration_batches

- Status: pass
- Finding: The table exists, review visibility is owner/admin controlled, and migration safety intent is aligned.
- Required follow-up: Final report retention and batch-format details remain review-only.

### migration_write_results

- Status: pass
- Finding: The table exists, batch linkage is present, and owner/admin-controlled result visibility is aligned.
- Required follow-up: Member/viewer write access remains blocked.

## 3. Ownership / Permissions Result

- company_users controls membership: pass
- active membership required for company-scoped reads: pass
- owner/admin can manage company/admin-sensitive records: pass
- owner/admin/member can write operational records where allowed: pass
- viewer remains read-only: pass
- migration approval/write behavior remains owner/admin controlled: pass

## 4. Document / Payment Safety Result

- Estimate numbers unique per company in estimates: pass
- Invoice numbers unique per company in invoices: pass
- Estimate and invoice number spaces remain separate: pass
- No shared document number table introduced: pass
- Sent/approved estimates remain future stricter app/RLS behavior: pass
- Paid/partial/void invoices remain future stricter app/RLS behavior: pass
- Invoice payments table exists and references invoices: pass
- Payment amount is required: pass
- Payment read/write policy intent is company-scoped: pass
- Payment update/delete remains stricter and review-gated: pass
- No casual payment deletion path is introduced: pass
- Audit events are append-only by design: pass
- Audit events are company-scoped: pass

## 5. App Settings / Migration Safety Result

- app_settings supports company_id: pass
- app_settings supports nullable user_id: pass
- app_settings supports setting_scope company/user behavior: pass
- company-scoped settings are member-readable and owner/admin-writable by default: pass
- user-scoped settings are readable/writable only by owning user within active company membership: pass
- migration/sync settings remain owner/admin controlled: pass
- migration_batches table exists: pass
- migration_write_results table exists: pass
- migration traceability remains preserved via `legacy_local_id` and `migration_batch_id`: pass
- member/viewer migration write access is not allowed: pass
- migration approval remains blocked from runtime: pass

## 6. Blockers Found

No blockers found.

## 7. Conditions Before Executable Migration Package Draft

The following conditions must remain true before any executable migration package is created:

- SQL/RLS remains docs-only.
- SQL/RLS is not executed.
- SQL/RLS is not deployed.
- SQL/RLS remains out of Supabase migration folders.
- The executable migration package must be created separately.
- The executable migration package must be reviewed separately before execution.
- Runtime wiring remains blocked.
- Credentials remain blocked.
- Production deployment remains blocked.

## 8. Recommended Next Step

- Status is approved with conditions, so the next step is a docs-only executable migration package plan if the remaining review conditions stay aligned.

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

This report is intended to show that the SQL and RLS drafts are aligned well enough for the next executable-package planning step, while keeping implementation blocked until the separate review steps are complete.

