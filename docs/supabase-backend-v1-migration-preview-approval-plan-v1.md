# Supabase Backend V1 Migration Preview Approval Plan V1

## 1. Summary
This document defines migration preview approval planning only for EstiPaid backend V1. It plans a future, controlled, no-write migration preview gate after the completed security review and existing regression/runtime evidence. This document does not approve migration preview execution.

## 2. Planning status
Planning-only.

Migration preview execution is not approved in this pass. Migration writes, real data movement, source/runtime behavior changes, and production launch remain blocked unless separately approved.

## 3. Current production backend status
- Production Supabase project exists.
- Production SQL package deployment is documented as successful.
- Production table creation is documented as verified.
- RLS on all EstiPaid tables is documented as verified.
- Policies are documented as verified.
- Authenticated grants are documented as verified.
- Public frontend env values were added in Vercel only.
- No real values were added to repository files.
- Migration preview has not run.
- Migration writes have not run.
- Production launch remains blocked.

## 4. Current security review status
- Security review passed.
- Test/build/diff hygiene evidence passed.
- Tracked env-file audit reported only .env.example.
- No committed real service-role/secret/admin/database/JWT/token/private-key credential values were found in inspected tracked repository content.
- Runtime remains browser-safe and public-key-only.
- Supabase client remains non-auto-read/write by itself and null when unconfigured.
- Backend adapter remains blocked/fallback-safe.
- localStorage remains default/fallback.
- No migration preview, migration writes, real data movement, or launch occurred.

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
- Estimate/invoice behavior preserved.
- No auth/session UX, onboarding UI, or membership UI was added.
- Production launch remains blocked.

## 6. Current runtime wiring status
- Runtime wiring is documented and guarded.
- Public frontend env handling is documented.
- Backend access remains explicitly gated and fallback-safe.
- No approval is granted here for runtime rewiring or broad behavioral change.

## 7. Current backend data adapter status
- Backend adapter scaffolding is documented.
- Adapter remains blocked/fallback-safe unless explicit conditions are met.
- This planning pass does not approve adapter behavior changes.

## 8. Current save/load switching status
- Save/load switching is documented as explicit opt-in.
- localStorage remains default.
- This planning pass does not approve save/load behavior changes.

## 9. Current controlled app workflow integration status
- Controlled integration evidence is documented.
- Guardrails remain in place for initial hydration and fallback behavior.
- This planning pass does not approve expanding workflow scope.

## 10. Future migration preview approval scope
Future separate approval may authorize one controlled migration preview execution pass that is:
- Read-only and no-write.
- Evidence-driven using existing mapper/adapter/runbook references.
- Focused on mapping readiness, warning collection, and documentation.
- Limited to preview validation and preview result documentation.

Future preview execution may include:
- Entity mapping order validation.
- Company-scoped ownership validation.
- Local source assumptions validation.
- Warning capture and blocker identification.
- Creation of a migration preview result document.

## 11. Explicit exclusions
This planning document does not approve:
- Migration preview execution.
- Migration writes.
- Real customer/project/estimate/invoice/payment data movement.
- Source/runtime behavior changes.
- Save/load behavior changes.
- localStorage replacement or fallback removal.
- Automatic localStorage migration.
- Automatic sync.
- Unguarded production reads/writes.
- Auth/session UX work.
- Onboarding UI work.
- Membership management UI work.
- Production launch.

## 12. Migration preview areas to validate
Future preview execution must validate at minimum:
- Source data assumptions.
- Entity mapping order.
- Company ownership fields.
- User ownership fields.
- Local ID preservation.
- Relationship integrity.
- Customer/project/estimate/invoice/payment relationships.
- Estimate line-item readiness.
- Invoice line-item readiness.
- Payment readiness.
- Document number readiness.
- Scope template readiness.
- Settings readiness.
- Audit event readiness.
- Migration batch/report readiness.
- Warning collection completeness.
- No-write production safety.
- Secret safety.
- Backup/export/rollback alignment.
- Migration-write separation.
- Launch separation.

## 13. Source data safety rules
Future preview execution must:
- Treat localStorage/export as source assumptions only.
- Use read-only inspection for source readiness.
- Avoid mutating localStorage.
- Avoid writing transformed data to production.
- Use fake/redacted examples only when examples are needed.
- Avoid placing real customer/business data in docs.

## 14. Mapping readiness validation rules
Future preview execution must verify:
- Mapping order preserves parent-child dependency order.
- company_id and ownership expectations are satisfied per entity.
- User ownership fields are validated for allowed/required patterns.
- legacy local IDs are preserved where required.
- Missing IDs and duplicate IDs are detected and reported.
- Broken local references are detected and reported.
- Document-number collision risk is detected and reported.
- Invoice/payment amount mismatch risk is detected and reported.
- Line-item mapping warnings are detected and reported.
- Migration batch/report structure readiness is verified.

## 15. Warning and blocker rules
Future preview execution must:
- Record all warnings explicitly.
- Distinguish warning vs blocker with clear criteria.
- Treat unresolved ownership, relationship, collision, or financial-integrity failures as blockers.
- Treat any no-write or secret-safety violation as blocker.
- State blockers that halt migration writes and launch.

## 16. Production no-write safety rules
Future preview execution must:
- Be read-only/no-write.
- Perform no insert/update/delete in production.
- Perform no migration write operations.
- Perform no real data movement.
- Perform no localStorage mutation.
- Perform no automatic localStorage migration.
- Perform no automatic sync.

## 17. Secret safety rules
Future preview execution must:
- Use no service-role, secret, or admin keys.
- Use no database passwords, connection strings, JWT secrets, access tokens, refresh tokens, auth tokens, private keys, or admin keys.
- Expose no real credentials in repository files, docs, terminal output, or chat.
- Add no real frontend env values to repository files.
- Keep env-file handling unchanged in repository.

## 18. Backup/export/rollback alignment rules
Future preview approval and execution must align with backup/export/rollback runbook controls:
- Preview remains no-write and reversible by design.
- Any later write approval must remain contingent on backup/export/rollback gate completion.
- Preview findings must clearly identify pre-write dependencies and unresolved rollback risks.

## 19. Migration write separation rules
Migration preview and migration write approvals are separate gates:
- Preview approval does not approve writes.
- Preview execution does not permit writes.
- Any future write execution requires separate explicit approval and runbook alignment.

## 20. Production launch separation rules
Migration preview does not approve launch:
- Launch remains blocked pending all required prior gates and explicit go/no-go approval.
- Any unresolved blocker from preview keeps launch blocked.

## 21. Required validation before migration preview execution
Before any future preview execution approval, run and confirm:
- npm test -- --watchAll=false.
- npm run build.
- git diff --check.
- git status --short.
- Only approved preview result documentation is created during preview execution unless separately approved.
- No source/runtime/env files are changed.
- No migration writes are executed.
- No production inserts/updates/deletes are executed.
- No real data movement occurs.
- localStorage is not mutated.
- No automatic localStorage migration occurs.
- No automatic sync occurs.
- No service-role/secret/admin key is used.
- No real credentials/secrets are committed or documented.
- Mapping warnings are collected and documented.
- Blockers are documented.
- Migration writes remain blocked after preview unless separately approved.
- Production launch remains blocked.

## 22. Hard stops
Any of the following is an immediate no-go:
- Any production write action during preview.
- Any migration write execution.
- Any real data movement.
- Any source/runtime behavior change in unapproved scope.
- Any localStorage mutation, automatic migration, or automatic sync.
- Any use/exposure of blocked secret classes.
- Any addition of auth/session UX, onboarding UI, or membership UI in preview scope.
- Any attempt to infer launch approval from preview planning or preview execution.

## 23. Remaining blocked actions
- Migration preview execution until separately approved.
- Migration writes.
- Real data movement.
- Source/runtime behavior changes.
- Save/load behavior changes.
- localStorage replacement.
- localStorage fallback removal.
- Automatic localStorage migration.
- Automatic sync.
- Unguarded production reads/writes.
- Auth/session UX.
- Onboarding UI.
- Membership management UI.
- Production launch.

## 24. Exact next gate
After this planning document is created and saved, the next gate is migration preview execution approval. That future approval may allow one controlled no-write migration preview execution pass using validation, mapping inspection, warning collection, and documentation only. Migration writes, real data movement, auth/session UX, onboarding UI, membership UI, and production launch remain blocked unless separately approved.
