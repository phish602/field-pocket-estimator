# Backend Migration Preview Plan

This is a planning document only.

- No backend sync is being implemented.
- No data writes are being added.
- No Supabase, schema, or migration files are being created.

## 1. Purpose

The goal of the preview flow is to let a user or admin inspect what local EstiPaid data would become before any backend migration or sync occurs.

The preview should:

- read the current local snapshot
- run the pure backend mapper
- collect backend-ready draft entities
- collect warnings before any write happens
- prevent silent data loss
- protect estimates, invoices, customers, projects, payments, settings, scope templates, and audit records

## 2. Future Preview Flow

The intended preview flow is:

1. Read the local snapshot.
2. Run the pure backend mapper.
3. Collect backend-ready draft entities.
4. Collect warnings.
5. Show summary counts by entity type.
6. Separate blocking issues from non-blocking issues.
7. Require explicit confirmation before any future sync or migration.

Preview must be repeatable and must not mutate the source data.

## 3. Preview Summary Sections

The preview should summarize:

- company profile
- customers
- projects
- estimates
- invoices
- payments
- scope templates
- settings
- audit events
- warnings
- unmapped or unknown data, if discovered later

## 4. Warning Severity Levels

The preview should use three severity levels:

- `blocker`
- `needs review`
- `informational`

Suggested mapping:

- Missing `companyId` or `userId` is a blocker.
- Duplicate local IDs are blockers.
- Broken customer/project/estimate/invoice relationships are `needs review` or blockers, depending on the final schema constraint.
- Missing invoice payment amount is `needs review`.
- Document-number collisions are `needs review`.
- Missing optional display fields are informational.

## 5. Safe UX Rules

The preview UI should follow these rules:

- Never auto-migrate without confirmation.
- Never hide warnings.
- Never delete local data during preview.
- Never mutate `localStorage` during preview.
- Keep preview repeatable.
- Make the preview exportable later as a report.
- Block migration if critical ownership or identity issues exist.

## 6. Approve Migration Gate

Any future migration flow should include an explicit approval step after review.

That gate should:

- show the final record count to write
- show all unresolved blockers
- allow cancel with no side effects
- require typed confirmation for destructive or irreversible actions later

## 7. Non-Goals Right Now

Do not build any of the following yet:

- Supabase writes
- schema creation
- migrations
- network calls
- runtime sync
- localStorage mutations
- UI implementation
- backend credentials

## 8. Future Implementation Checklist

Before implementing the preview UI or any write flow, confirm:

- Final Supabase schema and table names are approved.
- Backend draft entity names are mapped to final tables.
- Ownership model is decided.
- Project/customer relationship constraints are decided.
- Document-number uniqueness rules are decided.
- Archive/delete/soft-delete strategy is decided.
- Payment linkage strategy is decided.
- Preview UI is added only after schema approval.
- Write tests are added only after preview and schema approval.

## 9. Relationship to the Backend Contract

This preview plan depends on the canonical backend data contract and the pure backend mapper outputs.

- The backend contract defines the intended company-scoped entity model.
- The backend mapper turns local data into backend-ready drafts.
- The preview plan defines how those drafts should be reviewed before any future write.

