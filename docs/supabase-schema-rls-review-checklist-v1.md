# Supabase Schema and RLS Review Checklist V1

This is a review checklist only.

- No SQL is being added.
- No migration is being created.
- No Supabase deployment is happening.
- No runtime backend wiring is being added.

## 1. Schema Table Coverage

- Review question: Does the schema draft cover every required backend V1 table?
- Expected answer: Yes, the tables match the planned company-scoped model.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 2. Ownership Fields

- Review question: Do all company-owned tables include the correct ownership fields?
- Expected answer: Yes, every company-scoped table includes `company_id` and relevant actor fields.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 3. Relationship Integrity

- Review question: Are parent-child relationships explicit and safe?
- Expected answer: Yes, customers/projects/documents/line items/payments link without ambiguity.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 4. Document Numbering

- Review question: Are estimate and invoice number spaces separate and company-scoped?
- Expected answer: Yes, collisions are reviewable and legacy numbers are preserved.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 5. Status / Lifecycle Fields

- Review question: Do status fields match the intended lifecycle vocabulary?
- Expected answer: Yes, project/estimate/invoice/payment lifecycle fields are explicit and reviewable.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 6. Migration Traceability

- Review question: Are legacy identifiers and batch markers preserved for traceability?
- Expected answer: Yes, `legacy_local_id` and `migration_batch_id` are present where needed.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 7. Delete / Archive Safety

- Review question: Does the schema support safe archive/soft-delete behavior?
- Expected answer: Yes, hard delete remains restricted and archive/soft-delete paths are explicit.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 8. Payment Safety

- Review question: Can invoice payments remain linked and protected from orphaning?
- Expected answer: Yes, payment rows remain attached to invoices and mutation is constrained.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 9. Line Item Safety

- Review question: Can line items remain attached to their parent documents?
- Expected answer: Yes, estimate and invoice line items stay scoped to parent document rows.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 10. Audit Event Safety

- Review question: Are audit events append-only and traceable?
- Expected answer: Yes, audit events are immutable and company-scoped.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 11. RLS Read Policies

- Review question: Do read policies require active company membership?
- Expected answer: Yes, no cross-company reads are allowed.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 12. RLS Insert Policies

- Review question: Do insert policies require active membership and the right role?
- Expected answer: Yes, writes are limited to approved roles and membership.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 13. RLS Update Policies

- Review question: Are updates constrained by role and document lifecycle?
- Expected answer: Yes, stricter rules apply to sent/paid financial records and other sensitive records.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 14. RLS Delete / Archive Policies

- Review question: Are delete/archive policies conservative and role-gated?
- Expected answer: Yes, hard delete remains restricted and archive is preferred.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 15. Role Permissions Alignment

- Review question: Do schema/RLS rules match the approved owner/admin/member/viewer matrix?
- Expected answer: Yes, permissions align to the documented matrix.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 16. Migration Batch / Report Tables

- Review question: Do migration batch and write-result tables cover the required reporting fields?
- Expected answer: Yes, batch status, counts, failures, and eligibility are reviewable.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 17. Offline / Conflict Risk Alignment

- Review question: Do the schema and RLS plan align with the offline/conflict strategy?
- Expected answer: Yes, no silent overwrite, no auto-conflict resolution, and no cross-company exposure.
- Approval status: Not reviewed / Needs changes / Approved
- Notes: _

## 18. Mandatory Approval Gates

Before proceeding, confirm all of the following:

- Every company-scoped table has `company_id`.
- Every company-scoped read requires active membership.
- `viewer` role is read-only.
- Writes require active membership and proper role.
- Audit events are append-only.
- Invoice payments cannot become orphaned.
- Line items cannot become orphaned.
- Project hard delete remains restricted.
- Sent/paid financial documents have a stricter mutation path.
- Migration batches and write results are reviewable by owner/admin.
- `legacy_local_id` is preserved for migration traceability.

## 19. Blocker Checklist

Do not proceed if any of the following remain unresolved:

- Missing company ownership strategy
- Missing role permission rule
- Missing relationship constraint
- Missing payment linkage rule
- Missing document-number collision policy
- Missing archive/soft-delete decision
- Missing migration batch/report strategy
- Missing RLS coverage for any company-scoped table

## 20. Approved To Proceed Only When

Proceed only after all of the following are reviewed and approved:

- Schema draft approved
- RLS draft approved
- Role matrix approved
- Risk register reviewed
- Write strategy reviewed
- Rollback/retry reviewed
- Offline conflict strategy reviewed
- Implementation gate checklist reviewed

## 21. Non-Goals

Do not build any of the following yet:

- SQL
- Migration file
- Supabase deployment
- Runtime sync
- App wiring
- Backend credentials
- UI implementation

This checklist is intended to be used as the final review gate before any backend implementation work begins.

