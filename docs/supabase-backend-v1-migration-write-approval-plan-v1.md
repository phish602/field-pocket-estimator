# Supabase Backend V1 Migration Write Approval Plan V1

## 1. Summary
This document defines migration write approval planning only for EstiPaid backend V1. It plans a future controlled migration write approval gate after no-write preview and no-write backup/export/rollback verification evidence.

## 2. Planning status
Planning-only.

Migration write execution is not approved in this pass. Production launch, auth/session UX, onboarding UI, membership UI, source/runtime behavior changes, and real data movement remain blocked unless separately approved.

## 3. Current production backend status
- Production Supabase project exists.
- Production SQL package deployed successfully.
- Production table creation verified.
- RLS enabled on all EstiPaid tables verified.
- Policies verified.
- Authenticated grants verified.
- Public frontend env values were added to Vercel only.
- No real values were added to the repo.
- Migration preview passed as no-write/read-only.
- Backup/export/rollback verification passed as no-write/read-only.
- Migration writes have not run.
- Production launch remains blocked.

## 4. Current security review status
- Security review passed.
- Test/build/diff checks passed in prior approved evidence.
- Tracked env-file audit returned only .env.example.
- No committed real service-role/secret/admin/database/JWT/token/private-key credential values found in inspected tracked content.
- Runtime remains browser-safe and public-key-only.
- Backend adapter remains blocked/fallback-safe.
- localStorage remains default/fallback.

## 5. Current app behavior regression baseline status
- Regression baseline passed.
- localStorage remains default/fallback.
- Backend mode remains explicit opt-in only.
- Backend hydration remains gated.
- No automatic localStorage migration exists.
- No automatic sync exists.
- No unguarded production reads/writes were found.
- PDF/export behavior preserved.
- AI Assist behavior preserved.
- No auth/session UX, onboarding UI, or membership UI added.
- Production launch remains blocked.

## 6. Current migration preview status
- Migration preview passed for approved scope.
- Preview was controlled no-write/read-only.
- No migration writes executed.
- No production inserts/updates/deletes executed.
- No real data movement occurred.
- localStorage not mutated.
- No automatic localStorage migration.
- No automatic sync.
- Mapping readiness inspected.
- Warning collection readiness documented.
- No blockers found for no-write preview pass.
- Migration writes remain blocked.

## 7. Current backup/export/rollback verification status
- Backup/export/rollback verification passed for approved scope.
- Verification was controlled no-write/read-only.
- No migration writes executed.
- No production inserts/updates/deletes executed.
- No real data movement occurred.
- localStorage not mutated.
- No automatic localStorage migration.
- No automatic sync.
- Runbook alignment confirmed.
- Production schema backup readiness gate-defined/planned, not executed.
- Production rollback expectations documented.
- Local export readiness documented.
- No blockers found for no-write verification pass.
- Migration writes remain blocked.

## 8. Future migration write approval scope
Future separate approval may authorize a tightly controlled migration write execution gate only when prerequisites, explicit scope, rollback/stop criteria, post-write verification, and safety controls are explicitly approved.

Future approval scope must include:
- Explicit target environment and write boundaries.
- Explicit entity order and dependency handling.
- Explicit batching/reporting expectations.
- Explicit rollback/stop criteria.
- Explicit post-write verification checklist.
- Explicit launch separation and blocked UX scope.

## 9. Explicit exclusions
This planning document does not approve:
- Migration write execution.
- Production inserts.
- Production updates.
- Production deletes.
- Real customer/project/estimate/invoice/payment data movement.
- Source/runtime behavior changes.
- Save/load behavior changes.
- localStorage mutation.
- Automatic localStorage migration.
- Automatic sync.
- Replacing localStorage entirely.
- Removing localStorage fallback.
- Unguarded production reads/writes.
- Service-role/secret/admin key usage.
- Auth/session UX.
- Onboarding UI.
- Membership management UI.
- Production launch.

## 10. Write approval prerequisites
Before any future write approval:
- Backup/export/rollback verification must be passed and current.
- Migration preview must be passed and current.
- Security review must be passed and current.
- App behavior regression baseline must be passed and current.
- No unresolved hard blockers may exist.
- Write scope must be explicit and approved.
- Entity order must be explicit and approved.
- Rollback/stop criteria must be explicit and approved.
- Post-write verification must be explicit and approved.

## 11. Migration write areas to plan
- Write approval prerequisites
- Backup/export/rollback prerequisite
- Migration preview prerequisite
- Security review prerequisite
- App behavior regression prerequisite
- Entity write order
- Company/user ownership requirements
- Local ID preservation requirements
- Relationship integrity requirements
- Customer/project/estimate/invoice/payment write readiness
- Estimate/invoice line-item write readiness
- Document number handling
- Scope template/settings/audit event handling
- Migration batch/report handling
- Warning/blocker handling
- Production write scope boundaries
- Secret safety
- localStorage safety
- Runtime behavior separation
- Rollback/stop criteria
- Post-write verification requirements
- Launch separation

## 12. Entity order and relationship rules
Future write approval must require explicit order and relationship controls:
- company_profile before dependent entities where required
- customers before projects referencing customers
- projects before estimates/invoices referencing projects
- estimates before linked invoice dependencies where applicable
- invoices before invoice_payments and invoice_line_items relationships
- scope_templates/settings/audit/migration metadata in approved order
- parent-child and cross-entity reference integrity must be verified pre/post write

## 13. Ownership and local ID rules
Future write approval must require:
- company ownership fields validated for all write targets
- user ownership fields validated where required
- local ID preservation strategy defined and verified
- duplicate/missing ID handling defined as warnings or blockers
- unresolved ownership/local-id integrity issues treated as blockers

## 14. Warning and blocker rules
Future write approval must require:
- explicit review of mapping warnings and blocker candidates
- documented criteria for warning vs hard blocker
- hard blockers to halt write execution, real data movement, and launch
- documented remediation expectation before re-approval

## 15. Production write safety rules
Future write approval must require:
- tightly scoped write boundaries
- controlled batching/reporting and traceability
- no writes outside approved entity/environment scope
- explicit verification checkpoints during and after writes
- immediate stop behavior on destructive/anomalous outcomes

## 16. Secret safety rules
Future write approval must require:
- no service-role/secret/admin key exposure in repo/frontend
- no database passwords, connection strings, JWTs, tokens, private keys, or admin keys in repo/docs/terminal/chat
- no real frontend env values committed to repo
- continued placeholder-only tracked env pattern

## 17. localStorage safety rules
Future write approval must require:
- no automatic localStorage migration in browser
- no automatic sync of all local data
- no localStorage mutation unless separately approved
- localStorage fallback/default behavior not changed unless separately approved

## 18. Runtime behavior separation rules
Future write approval must require:
- no automatic runtime mode switching
- no implicit app workflow rewiring
- no unguarded production reads/writes from app workflows
- runtime wiring/behavior changes handled as separate gate approvals

## 19. Backup/export/rollback prerequisite rules
Future write approval must require:
- backup/export completeness and out-of-repo storage evidence
- rollback strategy, ownership, and stop/recovery paths explicitly approved
- rollback triggers defined (counts/relationships/financial mismatches/errors)
- unresolved backup/export/rollback gaps treated as hard blockers

## 20. Post-write verification rules
Future write approval must require explicit post-write checks:
- record-count comparison by entity
- relationship integrity verification
- line-item parent linkage verification
- invoice/payment financial integrity checks
- migration batch/report completeness checks
- no unexpected destructive behavior
- documented acceptance/no-go decision

## 21. Rollback and stop criteria
Future write approval must define stop criteria including at minimum:
- count mismatch beyond approved tolerance
- relationship mismatch or orphaning
- financial mismatch in invoice/payment totals
- permission/RLS anomalies
- unexpected hard deletes/destructive outcomes
- secret/safety violation
- any unresolved critical blocker

## 22. Production launch separation rules
- Migration write approval is not production launch approval.
- Launch remains blocked until separate explicit go/no-go approval.
- Write success does not imply launch approval.

## 23. Required validation before migration write execution approval
- Run npm test -- --watchAll=false
- Run npm run build
- Run git diff --check
- Run git status --short
- Confirm backup/export/rollback verification passed
- Confirm migration preview passed
- Confirm security review passed
- Confirm app behavior regression baseline passed
- Confirm no unresolved hard blockers
- Confirm no real credentials/secrets are committed or documented
- Confirm no service-role/secret/admin key is used in repo/frontend
- Confirm write scope explicitly defined
- Confirm entity order explicitly defined
- Confirm rollback/stop criteria explicitly defined
- Confirm post-write verification explicitly defined
- Confirm production launch remains blocked
- Confirm auth/session UX, onboarding UI, and membership UI remain blocked

## 24. Hard stops
Immediate no-go conditions for any future write approval:
- unresolved hard blockers
- unresolved backup/export/rollback gaps
- unresolved security/secret-safety gaps
- undefined write scope or entity order
- undefined rollback/stop criteria
- undefined post-write verification
- attempt to combine write approval with launch approval
- attempt to include blocked UX/runtime scope without separate approvals

## 25. Remaining blocked actions
- Migration write execution
- Production inserts/updates/deletes
- Real customer/project/estimate/invoice/payment data movement
- localStorage mutation
- Automatic localStorage migration
- Automatic sync
- Source/runtime behavior changes unless separately approved
- Save/load behavior changes unless separately approved
- Replacing localStorage entirely
- Removing localStorage fallback
- Unguarded production reads on app load
- Unguarded production writes from app workflows
- Service-role/secret/admin key usage
- Auth/session UX
- Onboarding UI
- Membership management UI
- Production launch

## 26. Exact next gate
After this planning document is created and saved, the next gate is migration write execution approval. That future approval may allow a controlled migration write execution pass only if write scope, rollback/stop criteria, post-write verification, secret safety, and production data safety are explicitly approved. Production launch, auth/session UX, onboarding UI, and membership UI remain blocked unless separately approved.
