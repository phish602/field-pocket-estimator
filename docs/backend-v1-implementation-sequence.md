# Backend V1 Implementation Sequence

This is a planning document only.

- No backend code is being added.
- No Supabase SQL is being added.
- No runtime sync is being wired.

## 1. V1 Backend Goal

The v1 backend goal is a safe company-scoped backend foundation with:

- migration preview before writes
- one-way local-to-backend migration before two-way sync
- no silent overwrite
- no destructive local cleanup

## 2. Ordered Implementation Phases

### Phase 0: Planning Baseline Complete

- Purpose: Confirm the planning layer is complete before implementation starts.
- Allowed work: docs review, contract review, preview review, risk review.
- Blocked work: backend writes, SQL, runtime sync, credentials, UI wiring.
- Exit criteria: Data contract, preview plan, schema proposal, ownership/RLS, role matrix, risk register, gate checklist, write strategy, rollback/retry, and offline conflict strategy are all reviewed.

### Phase 1: Supabase Schema Draft

- Purpose: Draft the backend table structure as a reviewed artifact.
- Allowed work: schema design, table naming, relationship mapping.
- Blocked work: runtime wiring, live writes, credentials, production migration.
- Exit criteria: Table names and relationships are aligned to mapper output.

### Phase 2: RLS Policy Draft

- Purpose: Define company membership and role-based access rules.
- Allowed work: policy design, role mapping, access rule review.
- Blocked work: deploying policies, runtime auth wiring, writes.
- Exit criteria: Ownership and role model are approved.

### Phase 3: Schema/RLS Tests or Review Checklist

- Purpose: Validate schema and policy intent before any runtime work.
- Allowed work: review checklists, policy walkthroughs, test planning.
- Blocked work: runtime sync, backend writes, migration execution.
- Exit criteria: Schema and RLS are approved against the planning docs.

### Phase 4: Backend Dry-Run UI Preview

- Purpose: Show the user/admin what local data would become.
- Allowed work: preview formatting, warning summary, report review.
- Blocked work: writes, credentials, automatic migration, conflict resolution.
- Exit criteria: Preview utility and dry-run report are approved.

### Phase 5: Migration Approval Gate

- Purpose: Require explicit approval before any future write path.
- Allowed work: approval UX design, typed confirmation definition.
- Blocked work: backend writes, destructive actions without approval.
- Exit criteria: Preview, blockers, and report are accepted and owners approve.

### Phase 6: Write Adapter Design

- Purpose: Define the safe write order and failure handling.
- Allowed work: write-order design, idempotency design, rollback/retry planning.
- Blocked work: actual backend writes, production migration, conflict automation.
- Exit criteria: Write strategy and rollback/retry strategy are approved.

### Phase 7: Non-Production Write Test

- Purpose: Prove the write path in a safe, non-production context.
- Allowed work: dry-run write validation, staging-only tests, rollback rehearsals.
- Blocked work: production writes, automatic conflict resolution.
- Exit criteria: Write tests and failure handling pass in a controlled environment.

### Phase 8: Production Migration Path

- Purpose: Execute the first safe production migration path.
- Allowed work: approved one-way migration with visible reporting.
- Blocked work: automatic two-way sync, silent overwrites, destructive cleanup.
- Exit criteria: Production migration can complete with traceable reports and no blocker violations.

### Phase 9: Post-Migration Read / Sync Strategy

- Purpose: Decide how future reads and sync should behave after migration.
- Allowed work: read model design, cache behavior, sync monitoring.
- Blocked work: broad two-way sync or auto-conflict resolution.
- Exit criteria: Post-migration read strategy is stable and reviewed.

### Phase 10: Future Two-Way Sync, Not V1

- Purpose: Keep bidirectional sync as a later phase only.
- Allowed work: planning only.
- Blocked work: implementation in v1.
- Exit criteria: Separate future approval after v1 stability is proven.

## 3. Explicit V1 Boundaries

V1 must remain bounded by these rules:

- One-way migration first.
- No automatic two-way sync.
- No auto-conflict resolver.
- No deleting local data after migration.
- No casual hard delete of financial records.
- No backend writes until preview and gate checks pass.

## 4. First Implementation Recommendation

Recommended first implementation step:

- Start with an SQL schema draft as a reviewed artifact.
- Do not wire app runtime yet.
- Do not add credentials yet.
- Validate table names and relationships against mapper output first.

## 5. Decision Checkpoints

Before moving from planning to implementation, confirm:

- Schema approved
- RLS approved
- Role matrix approved
- Write order approved
- Rollback/retry approach approved
- Offline conflict approach approved
- Preview UX approved

## 6. Stop Signs

Stop and do not proceed if any of the following remain unresolved:

- Missing ownership model
- Unclear company membership rules
- No document collision policy
- No payment linkage rules
- No rollback/retry decision
- No preview UI before write path
- Any source code change that bypasses preview

## 7. Non-Goals Right Now

Do not build any of the following yet:

- Supabase writes
- SQL implementation in this pass
- Migrations
- Runtime sync
- UI implementation
- Backend credentials
- Automatic conflict resolver

This document is intended to provide a safe ordered path for backend V1 without starting implementation prematurely.

