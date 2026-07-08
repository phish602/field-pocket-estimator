# Backend Implementation Gate Checklist

This is a pre-implementation checklist.

- No backend code is being added.
- No Supabase SQL is being added.
- No runtime sync is being wired.

## 1. Data Contract Approved

- Required condition: The backend data contract is reviewed and accepted as the canonical company-scoped model.
- Why it matters: Prevents schema drift and ensures local data maps to the intended backend shape.
- Evidence/check: Contract document reviewed and marked ready.
- Status placeholder: Not started / In review / Approved / Blocked

## 2. Schema Proposal Approved

- Required condition: The schema proposal is reviewed and accepted before any table work begins.
- Why it matters: Locks table direction before migrations or writes exist.
- Evidence/check: Schema proposal document reviewed and approved.
- Status placeholder: Not started / In review / Approved / Blocked

## 3. Ownership/RLS Model Approved

- Required condition: Company ownership, membership, and access rules are approved.
- Why it matters: Prevents cross-company exposure and unclear write permissions.
- Evidence/check: Ownership/RLS decisions document reviewed and approved.
- Status placeholder: Not started / In review / Approved / Blocked

## 4. Role Permissions Approved

- Required condition: Owner/admin/member/viewer permissions are explicitly approved.
- Why it matters: Ensures the backend access model matches the intended operational workflow.
- Evidence/check: Role permissions matrix reviewed and approved.
- Status placeholder: Not started / In review / Approved / Blocked

## 5. Risk Register Reviewed

- Required condition: Migration and sync risks are reviewed and accepted or mitigated.
- Why it matters: Reduces the chance of data loss, bad relationships, or permission mistakes.
- Evidence/check: Sync risk register reviewed with blockers identified.
- Status placeholder: Not started / In review / Approved / Blocked

## 6. Migration Preview Utilities Passing

- Required condition: Pure preview utilities and formatter tests pass.
- Why it matters: Proves local data can be inspected safely before any write path exists.
- Evidence/check: Backend migration preview, report formatter, and flow tests pass.
- Status placeholder: Not started / In review / Approved / Blocked

## 7. Dry-Run Report Available

- Required condition: A readable dry-run report exists and is validated on realistic snapshot data.
- Why it matters: Supports human review before any migration or sync action.
- Evidence/check: Preview report formatter and end-to-end flow test pass.
- Status placeholder: Not started / In review / Approved / Blocked

## 8. UI Preview Plan Approved

- Required condition: The preview UX and approval flow are agreed before writing any backend data.
- Why it matters: Prevents accidental migrations and makes blockers visible.
- Evidence/check: Migration preview plan reviewed and approved.
- Status placeholder: Not started / In review / Approved / Blocked

## 9. Write Strategy Approved

- Required condition: Write ordering, record lineage, and data ownership rules are finalized.
- Why it matters: Prevents partial writes and silent overwrites.
- Evidence/check: Write strategy documented with explicit data boundaries.
- Status placeholder: Not started / In review / Approved / Blocked

## 10. Rollback / Retry Strategy Approved

- Required condition: Rollback, retry, and partial-write handling are defined before writes exist.
- Why it matters: Prevents half-migrated data from becoming the default state.
- Evidence/check: Rollback and retry strategy documented and reviewed.
- Status placeholder: Not started / In review / Approved / Blocked

## 11. Test Strategy Approved

- Required condition: Write-path tests and migration validation tests are planned before implementation.
- Why it matters: Ensures backend work is guarded by repeatable validation.
- Evidence/check: Test strategy documented with write and preview coverage.
- Status placeholder: Not started / In review / Approved / Blocked

## 12. Do Not Proceed If

Do not proceed if any of the following remain unresolved:

- Missing `company_id` / `user_id` strategy
- Unclear RLS ownership model
- No document-number collision policy
- No migration preview approval flow
- No rollback / retry plan
- No test coverage for writes
- No decision on archive / soft-delete
- No payment linkage rules
- No conflict strategy for offline / local-first data

## 13. Allowed Before Gate Approval

Allowed before gate approval:

- Docs
- Pure utilities
- Pure tests
- Dry-run formatting
- Schema planning
- No-op preview logic

## 14. Blocked Before Gate Approval

Blocked before gate approval:

- Supabase writes
- Production migrations
- Runtime sync
- Automatic uploads
- Destructive cleanup tools
- RLS SQL deployment
- Backend credentials in app code

## 15. Final Approval Checklist

Before implementation starts, confirm:

- Schema reviewed
- RLS reviewed
- Role matrix reviewed
- Migration preview reviewed
- Dry-run report reviewed
- Risk register reviewed
- Rollback plan reviewed
- Write tests planned
- Owner/admin approval path decided

This checklist is intended to stay ahead of implementation and prevent backend work from starting before the safety gates are satisfied.

