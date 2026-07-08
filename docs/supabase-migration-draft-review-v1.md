# Supabase Migration Draft Review V1

This is a review artifact only.

- SQL was not executed.
- SQL was not deployed.
- SQL was not moved into a migration folder.
- No runtime wiring is being added.
- No backend writes are being added.

This report determines whether the SQL draft is ready for a future RLS SQL draft or needs revision first.

## 1. Review Summary

- Overall status: Approved with conditions
- Reason: The SQL draft is structurally aligned to the approved schema, ownership, role, and safety docs, but it still remains a docs-only draft and must stay separately reviewed before any RLS draft or future execution path.

## 2. Reviewed Table Coverage

- `companies`: pass
- `company_users`: pass
- `customers`: pass
- `projects`: pass
- `estimates`: pass
- `estimate_line_items`: pass
- `invoices`: pass
- `invoice_line_items`: pass
- `invoice_payments`: pass
- `scope_templates`: pass
- `app_settings`: pass
- `audit_events`: pass
- `migration_batches`: pass
- `migration_write_results`: pass

## 3. Table Review Findings

### companies

- Status: pass
- Finding: Purpose, primary key, ownership fields, traceability fields, and archive intent are present.
- Required follow-up: Confirm final runtime-independent field names only when RLS drafting begins.

### company_users

- Status: pass
- Finding: Purpose, primary key, ownership fields, and role check are present.
- Required follow-up: Final RLS behavior and helper naming remain a separate review step.

### customers

- Status: pass
- Finding: Purpose, primary key, ownership fields, traceability fields, and archive intent are present.
- Required follow-up: Confirm final archive field semantics in the RLS draft.

### projects

- Status: pass
- Finding: Purpose, primary key, ownership fields, relationship fields, traceability fields, status check, and archive intent are present.
- Required follow-up: Confirm any future hard-delete restrictions in policy review.

### estimates

- Status: pass
- Finding: Purpose, primary key, ownership fields, relationship fields, traceability fields, status check, and separate number-space direction are present.
- Required follow-up: Final invoice-conversion linkage wording may still be refined later.

### estimate_line_items

- Status: pass
- Finding: Purpose, parent relationship, ownership fields, traceability fields, and ordering intent are present.
- Required follow-up: Confirm cascade expectations during later RLS review.

### invoices

- Status: pass
- Finding: Purpose, primary key, ownership fields, relationship fields, traceability fields, status check, and payment lifecycle direction are present.
- Required follow-up: Confirm stricter paid/partial/void policy behavior in RLS and runtime phases.

### invoice_line_items

- Status: pass
- Finding: Purpose, parent relationship, ownership fields, traceability fields, and ordering intent are present.
- Required follow-up: Confirm cascade expectations during later RLS review.

### invoice_payments

- Status: pass
- Finding: Purpose, parent relationship, required amount, and migration traceability are present.
- Required follow-up: Confirm final payment mutation restrictions in the RLS draft.

### scope_templates

- Status: pass
- Finding: Purpose, ownership, traceability, and archive intent are present.
- Required follow-up: Decide whether templates remain company-scoped or gain a user-scoped path later.

### app_settings

- Status: needs review
- Finding: The draft keeps settings flexible, but company-wide vs user-specific behavior is still open.
- Required follow-up: Finalize scope semantics before SQL drafting.

### audit_events

- Status: pass
- Finding: Purpose, ownership, actor fields, metadata, and append-only intent are present.
- Required follow-up: Keep append-only behavior explicit in the final RLS draft.

### migration_batches

- Status: pass
- Finding: Purpose, ownership, traceability, and status/report fields are present.
- Required follow-up: Confirm the final `migration_batch_id` format and report retention later.

### migration_write_results

- Status: pass
- Finding: Purpose, ownership, batch linkage, result fields, and retry flags are present.
- Required follow-up: Confirm future result retention and rollback/retry visibility rules.

## 4. Constraints Review

- Project status check constraint exists and matches V1 values: pass
- Estimate status check constraint exists and matches V1 values: pass
- Invoice status check constraint exists and matches V1 values: pass
- Company user role check constraint exists and matches V1 values: pass
- Estimate numbers unique per company within estimates: pass
- Invoice numbers unique per company within invoices: pass
- Estimate and invoice number spaces remain separate: pass

## 5. Relationship Review

- `company_users` references `companies`: pass
- `customers` reference `companies`: pass
- `projects` reference `companies` and optionally `customers`: pass
- `estimates` reference `companies` and optionally `customers/projects`: pass
- `invoices` reference `companies` and optionally `customers/projects/estimates`: pass
- Line items reference parent documents: pass
- Invoice payments reference invoices: pass
- Audit events reference company and actor when available: pass
- Migration write results reference migration batches: pass

## 6. Safety Alignment Review

- No hard-delete-first design: pass
- Archive / soft-delete fields present where appropriate: pass
- Payments are not treated as casual delete records: pass
- Audit events are append-only by design/comment: pass
- Migration traceability is preserved: pass
- `legacy_local_id` is preserved where appropriate: pass
- `migration_batch_id` is preserved where appropriate: pass
- No storage bucket / photo implementation accidentally introduced: pass
- No credentials or runtime code introduced: pass

## 7. Index Review

- Company lookup indexes: pass
- `legacy_local_id` lookup indexes: pass
- `migration_batch_id` lookup indexes: pass
- Customer/project relationship indexes: pass
- Document-number uniqueness indexes: pass
- Invoice payment lookup indexes: pass
- Audit event company/time lookup indexes: pass

## 8. Findings by Severity

- Pass: most schema tables, constraints, relationships, safety notes, and indexes align with the planning docs.
- Needs review: `app_settings` scope semantics remain open.
- Blocker: none.

## 9. Blocker Summary

No blockers found.

## 10. Conditions Before RLS SQL Draft

The following conditions must remain true before an RLS SQL draft is created:

- SQL remains docs-only.
- SQL is not executed.
- SQL is not deployed.
- SQL remains out of Supabase migration folders.
- RLS draft must be created separately.
- RLS draft must be reviewed separately.
- Runtime wiring remains blocked.
- Credentials remain blocked.
- Production deployment remains blocked.

## 11. Recommended Next Step

- Status is approved with conditions, so the next step is a docs-only RLS SQL draft review if the remaining open settings-scope question is handled to the intended policy.

## 12. Non-Goals

Do not build any of the following yet:

- SQL execution
- Supabase deployment
- Migration folder changes
- RLS implementation in this pass
- Runtime auth
- UI permission gates
- Backend writes
- Schema deployment
- Credentials

This report is intended to show that the SQL draft is structurally aligned and ready for the next RLS drafting step, while keeping implementation blocked until the separate review steps are complete.

