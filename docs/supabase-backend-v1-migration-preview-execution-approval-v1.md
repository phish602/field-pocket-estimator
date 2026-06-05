# Supabase Backend V1 Migration Preview Execution Approval V1

## 1. Summary
This document approves the next controlled execution phase for a no-write migration preview only. This current pass is documentation-only and does not execute migration preview.

## 2. Approval status
Approved for next controlled execution phase only:
- Run a no-write/read-only migration preview execution pass.
- Use validation, mapping inspection, warning collection, blocker documentation, and result documentation only.
- Keep migration writes, real data movement, and production launch blocked.

Not approved in this pass:
- Running migration preview now.
- Any source/runtime behavior changes.

## 3. Current production backend status
- Production Supabase project exists.
- Production SQL package deployed successfully.
- Production table creation verified.
- RLS enabled on all EstiPaid tables verified.
- Policies verified.
- Authenticated grants verified.
- Public frontend env values were added to Vercel only.
- No real values were added to the repo.
- Migration preview has not run.
- Migration writes have not run.
- Production launch remains blocked.

## 4. Current security review status
- Security review passed.
- npm test -- --watchAll=false passed.
- 60 test suites passed.
- 1737 tests passed.
- npm run build passed.
- git diff --check passed.
- Tracked env-file audit returned only .env.example.
- No committed real service-role/secret/admin/database/JWT/token/private-key credential values were found in inspected tracked repository content.
- Runtime wiring remains browser-safe and public-key-only.
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

## 6. Current backend mapping status
- Backend mapping logic and tests are documented and available for inspection.
- Mapping readiness must be validated in preview execution through inspection and warning capture.
- No mapping code changes are approved in this document.

## 7. Current backend adapter status
- Backend adapter scaffolding is documented.
- Adapter remains guarded and fallback-safe in current state.
- No adapter behavior changes are approved in this document.

## 8. Approved execution scope
Future execution pass is approved to:
- Run npm test -- --watchAll=false.
- Run npm run build.
- Run git diff --check.
- Run git status --short.
- Inspect backend mapper and adapter behavior.
- Inspect migration preview runbook requirements.
- Inspect backup/export/rollback alignment.
- Inspect warning collection behavior.
- Inspect mapping order and ownership fields.
- Use fake/redacted examples only if examples are needed.
- Create one result document after execution: docs/supabase-backend-v1-migration-preview-result-v1.md.

## 9. Required migration preview areas
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
- Warning collection.
- No-write production safety.
- Secret safety.
- Rollback/backup gate alignment.
- Migration-write separation.
- Launch separation.

## 10. Explicit exclusions
This approval does not approve:
- Migration writes.
- Production inserts.
- Production updates.
- Production deletes.
- Real data movement.
- localStorage mutation.
- Automatic localStorage migration.
- Automatic sync.
- Source/runtime behavior changes.
- Save/load behavior changes.
- Replacing localStorage entirely.
- Removing localStorage fallback.
- Unguarded production reads on app load.
- Unguarded production writes from app workflows.
- Service-role/secret/admin key usage.
- Auth/session UX.
- Onboarding UI.
- Membership management UI.
- Production launch.

## 11. Source data safety rules
Execution pass must:
- Treat localStorage/export as read-only input assumptions.
- Not mutate localStorage.
- Not move real customer/business data.
- Use fake/redacted examples only when needed.
- Keep preview analysis/documentation free of sensitive real values.

## 12. Mapping readiness validation rules
Execution pass must validate and document:
- Entity mapping order.
- Company and user ownership requirements.
- Local ID preservation behavior.
- Relationship integrity across customer/project/estimate/invoice/payment.
- Estimate and invoice line-item readiness.
- Payment readiness.
- Document number readiness and collision risks.
- Scope template, settings, and audit event readiness.
- Migration batch/report shape readiness.

## 13. Warning and blocker rules
Execution pass must:
- Collect warnings comprehensively.
- Document warnings honestly with clear impact.
- Classify blockers explicitly.
- Treat unresolved blockers as stop conditions for writes, real data movement, and launch.

## 14. Production no-write safety rules
Execution pass must be read-only/no-write:
- No migration writes.
- No production inserts.
- No production updates.
- No production deletes.
- No real data movement.
- No localStorage mutation.
- No automatic localStorage migration.
- No automatic sync.

## 15. Secret safety rules
Execution pass must:
- Use no service-role/secret/admin keys.
- Use no database passwords, connection strings, JWTs, access tokens, refresh tokens, auth tokens, private keys, or admin keys.
- Add no real Supabase URL or real anon/publishable key to repo files.
- Expose no real credentials in repo, docs, terminal output, or chat.

## 16. Backup/export/rollback alignment rules
Execution pass must align with backup/export/rollback runbook controls:
- Preserve no-write behavior.
- Identify dependencies and blockers that would affect any future write gate.
- Keep write approval separated until backup/export/rollback conditions are satisfied.

## 17. Migration write separation rules
- Migration preview execution approval is not migration write approval.
- Migration writes remain blocked unless separately approved.
- Preview findings must not be interpreted as write authorization.

## 18. Production launch separation rules
- Migration preview execution approval is not launch approval.
- Production launch remains blocked unless separately approved through go/no-go gates.

## 19. Validation commands for execution
Required commands in future execution pass:
- npm test -- --watchAll=false
- npm run build
- git diff --check
- git status --short

## 20. Hard stops
Immediate no-go conditions:
- Any migration write attempt.
- Any production insert/update/delete attempt.
- Any real data movement.
- Any localStorage mutation or automatic migration/sync behavior.
- Any secret-safety violation.
- Any unapproved source/runtime behavior change.
- Any auth/session UX, onboarding UI, or membership UI addition in execution scope.
- Any attempt to treat preview as launch approval.

## 21. Remaining blocked actions
- Migration writes.
- Production inserts/updates/deletes.
- Real data movement.
- localStorage mutation.
- Automatic localStorage migration.
- Automatic sync.
- Source/runtime behavior changes.
- Save/load behavior changes.
- Replacing localStorage entirely.
- Removing localStorage fallback.
- Unguarded production reads/writes.
- Service-role/secret/admin key usage.
- Auth/session UX.
- Onboarding UI.
- Membership management UI.
- Production launch.

## 22. Exact next gate
After this approval document is created and saved, the next gate is migration preview execution. That future pass may run a controlled no-write migration preview using validation, mapping inspection, warning collection, blocker documentation, and create docs/supabase-backend-v1-migration-preview-result-v1.md only. Migration writes, real data movement, auth/session UX, onboarding UI, membership UI, and production launch remain blocked unless separately approved.
