# Supabase Schema/RLS Approval Report V1

This is a review artifact only.

- Not deployed SQL.
- Not a migration.
- Not runtime wiring.
- No backend writes are being added.

This report determines whether the reviewed drafts are ready for a future SQL migration draft.

## 1. Approval Summary

- Overall status: Approved with conditions
- Reason: The schema draft, RLS draft, role/ownership docs, and checklist are internally consistent and ready for the next drafting step, but several open decisions still need to be finalized before SQL is created.

## 2. Reviewed Sources

Reviewed documents:

- `docs/supabase-schema-draft-v1.md`
- `docs/supabase-rls-policy-draft-v1.md`
- `docs/supabase-schema-rls-review-checklist-v1.md`
- `docs/backend-ownership-rls-decisions.md`
- `docs/backend-role-permissions-matrix.md`
- `docs/backend-schema-proposal.md`
- `docs/backend-data-contract.md`
- `docs/backend-migration-preview-plan.md`
- `docs/backend-write-strategy.md`
- `docs/backend-rollback-retry-strategy.md`
- `docs/backend-offline-conflict-strategy.md`
- `docs/backend-v1-implementation-sequence.md`
- `docs/backend-implementation-gate-checklist.md`
- `docs/backend-sync-risk-register.md`

Source code was not modified.

## 3. Checklist Review Results

### Schema table coverage

- Status: pass
- Finding: The draft includes the required company, membership, customer, project, estimate, line item, invoice, payment, template, settings, audit, batch, and write-result tables.
- Required follow-up: Final table names should still be confirmed before SQL is written.

### Ownership fields

- Status: pass
- Finding: The drafts consistently call for `company_id` plus actor trace fields and `legacy_local_id` preservation.
- Required follow-up: Final ownership columns must be locked in the SQL draft.

### Relationship integrity

- Status: pass
- Finding: The document relationships are coherent and align with the mapper outputs.
- Required follow-up: Confirm exact foreign key names and constraints in the SQL draft.

### Document numbering

- Status: needs review
- Finding: The docs clearly require company-scoped number spaces and collision review, but exact constraint behavior is still undecided.
- Required follow-up: Finalize uniqueness constraints and collision handling before SQL.

### Status/lifecycle fields

- Status: needs review
- Finding: Core lifecycle values are documented, but some exact enum/check-constraint names remain open.
- Required follow-up: Finalize exact status values and constraints.

### Migration traceability

- Status: pass
- Finding: `legacy_local_id` and `migration_batch_id` are consistently planned across the drafts.
- Required follow-up: Confirm final batch field naming in the SQL draft.

### Delete/archive safety

- Status: pass
- Finding: The docs consistently prefer archive/soft-delete and restrict hard delete for real data.
- Required follow-up: Final field names for archive/deleted markers still need approval.

### Payment safety

- Status: pass
- Finding: Payment linkage and mutation restrictions are documented conservatively.
- Required follow-up: Confirm exact payment reconciliation rules before writes.

### Line item safety

- Status: pass
- Finding: Line items are consistently modeled as child records of their parent documents.
- Required follow-up: Confirm parent key names and cascade behavior in SQL.

### Audit event safety

- Status: pass
- Finding: Audit events are consistently treated as append-only and company-scoped.
- Required follow-up: Confirm immutability implementation details in SQL.

### RLS read policies

- Status: pass
- Finding: Active company membership is the read gate across the drafts.
- Required follow-up: Final helper function names and policy names remain open.

### RLS insert policies

- Status: pass
- Finding: Writes are scoped by role and membership, consistent with the role matrix.
- Required follow-up: Confirm exact insert-policy helper functions.

### RLS update policies

- Status: pass
- Finding: The drafts consistently call for stricter rules on sent/paid/approved records.
- Required follow-up: Final lifecycle-specific policy names remain open.

### RLS delete/archive policies

- Status: pass
- Finding: Delete is deliberately restricted and archive is preferred.
- Required follow-up: Confirm archive/soft-delete fields and policy behavior.

### Role permissions alignment

- Status: pass
- Finding: The schema/RLS drafts match the owner/admin/member/viewer matrix direction.
- Required follow-up: Resolve the remaining open role decisions before SQL.

### Migration batch/report tables

- Status: pass
- Finding: The batch and result tables cover status, counts, failure reasons, and retry/rollback visibility.
- Required follow-up: Confirm storage/retention strategy for migration reports.

### Offline/conflict risk alignment

- Status: pass
- Finding: The schema/RLS direction aligns with the offline-first conflict strategy and avoids silent overwrite.
- Required follow-up: Finalize conflict-report storage and user review UX.

### Mandatory approval gates

- Status: pass
- Finding: The approval checklist captures the required ownership, membership, and safety gates.
- Required follow-up: Gate completion should be verified before SQL drafting begins.

### Blocker checklist

- Status: pass
- Finding: The docs identify the main stop conditions, and none are unresolved in the reviewed planning docs.
- Required follow-up: No blockers found in the reviewed docs.

### Approved to proceed only when

- Status: needs review
- Finding: The sequence is clear, but the remaining open decisions must still be resolved before the next step is considered ready for SQL drafting.
- Required follow-up: Finish the listed approvals before moving to SQL draft creation.

### Non-goals

- Status: pass
- Finding: The docs consistently exclude SQL, migration deployment, runtime sync, UI wiring, and credentials from this phase.
- Required follow-up: Keep these out until the drafts are separately approved.

## 4. Blockers Found

No blockers found in the reviewed docs.

## 5. Conditions Before SQL Migration Draft

The following conditions must remain true before any SQL draft is created:

- No runtime wiring.
- No credentials in app code.
- No backend writes.
- No UI implementation.
- No migrations executed yet.
- Schema/RLS review remains separate from runtime work.
- SQL draft must be reviewed after the remaining open decisions are resolved.

## 6. Open Decisions

The following decisions still need to be finalized:

- Exact UUID/default strategy
- Final enum/check constraint names
- Exact archive/soft-delete field names
- Exact RLS helper function names, if any
- Whether viewers can export PDFs
- Whether members can archive projects
- Whether admins can manage billing/users
- Attachment/photo storage strategy
- Final `migration_batch_id` format
- Where migration reports are stored

## 7. Approval Gate

- The SQL migration draft may be created only after this report says Approved or Approved with conditions.
- Runtime wiring remains blocked even after the SQL draft exists.
- Production deployment remains blocked until SQL and RLS are separately tested and reviewed.

## 8. Non-Goals

Do not build any of the following yet:

- SQL
- Supabase policies
- Migrations
- Runtime auth
- UI permission gates
- Backend writes
- Schema deployment
- Credentials

This report is intended to certify the reviewed planning docs as ready for the next SQL drafting step, while keeping implementation blocked until the remaining decisions are finalized.

