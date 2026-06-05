# Supabase Backend V1 Controlled App Workflow Integration Implementation Approval V1

## 1. Summary
This is a docs-only approval record for the next controlled implementation phase of narrowly wiring existing save/load switching scaffolding into active EstiPaid workflow paths while keeping localStorage as default and fallback. It does not execute implementation in this pass and does not approve automatic localStorage migration, automatic sync, unguarded production reads/writes, migration preview, migration writes, real data movement, auth/session UX, onboarding UI, membership UI, or production launch.

## 2. Approval Status
Approved as the next controlled implementation phase only:
- Identify the smallest active app workflow integration points.
- Wire the existing save/load switching service into active save/load paths only where needed.
- Keep localStorage as the default active path.
- Keep localStorage fallback available.
- Preserve current history persistence behavior through the localStorage-default switching layer.
- Keep backend mode explicit, guarded, reversible, and test-covered.
- Keep backend mode disabled unless explicitly requested through approved code paths.
- Add or update focused tests for controlled integration behavior.
- Add safe handling for missing Supabase configuration.
- Add safe handling for backend blocked/failure results.
- Preserve estimate creation behavior.
- Preserve invoice creation behavior.
- Preserve PDF/export behavior.
- Preserve AI Assist behavior.
- Preserve Spanish/bilingual behavior.
- Preserve mobile/PWA behavior.
- Keep migration preview blocked.
- Keep migration writes blocked.
- Keep real data movement blocked.
- Keep auth/session UX blocked.
- Keep onboarding UI blocked.
- Keep company membership management UI blocked.
- Keep production launch blocked.

## 3. Current Production Backend Status
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

## 4. Current Runtime Wiring Status
- Browser-safe Supabase env helper exists.
- Browser-safe Supabase client module exists.
- @supabase/supabase-js is installed.
- Missing or placeholder env values do not crash imports.
- Supabase client module performs no production reads or writes by itself.
- EstiPaid workflows are not switched to Supabase.
- localStorage persistence remains unchanged.
- PDF/export remains unchanged.
- AI Assist remains unchanged.
- Estimate/invoice workflows remain unchanged.

## 5. Current Backend Data Adapter Status
- Backend data adapter scaffolding exists.
- Adapter imports safely.
- Adapter status/fallback behavior exists.
- Adapter reuses backend data mapper utilities.
- Adapter exposes dormant scaffolding methods.
- Adapter blocked read/write methods return controlled blocked results when explicitly called.
- Adapter is not imported into active UI workflows.
- Adapter performs no automatic production reads/writes.
- localStorage remains active and unchanged.

## 6. Current Save/Load Switching Status
- Save/load mode helper exists.
- Save/load switching service exists.
- localStorage is the default active mode.
- localStorage fallback remains available.
- Backend mode is explicit and guarded.
- Backend mode requires explicit requested mode, backend enablement, and configured backend.
- Backend unconfigured/blocked/failed behavior returns controlled fallback results.
- Switching service is not wired into active app workflows.
- No automatic localStorage migration exists.
- No automatic sync exists.
- No production reads/writes were added on app load.

## 7. Approved Implementation Scope
- Source changes may integrate createSaveLoadSwitchingService into existing save/load helpers or workflow paths only if localStorage remains default.
- Source changes may add a small controlled wrapper around existing localStorage save/load functions.
- Source changes may route current save/load calls through a localStorage-default switching layer.
- Source changes may add diagnostics/status helpers if they do not expose secrets or alter user-visible behavior.
- Source changes may add focused tests for integration behavior.
- Source changes must preserve current localStorage behavior by default.
- Source changes must preserve localStorage fallback.
- Source changes must not enable automatic backend sync.
- Source changes must not automatically migrate localStorage records.
- Source changes must not perform unguarded production reads/writes.
- Source changes must not add launch behavior.

## 8. Allowed Future Source Categories
- src/lib/**
- src/utils/**
- focused tests for integration behavior
- narrowly scoped app workflow files only if required for controlled localStorage-default integration

## 9. Explicit Exclusions
- Replacing localStorage entirely.
- Removing localStorage fallback.
- Automatically syncing all local data.
- Automatically migrating localStorage history.
- Running unguarded production reads on app load.
- Running unguarded production writes from app workflows.
- Creating auth/session UX.
- Creating user onboarding.
- Creating company membership management UI.
- Running migration preview.
- Running migration writes.
- Moving real customer/project/estimate/invoice/payment data.
- Launching production.

## 10. LocalStorage Default/Fallback Rules
- localStorage must remain the default active path.
- localStorage fallback must remain available.
- No silent fallback removal is approved.
- No automatic localStorage migration is approved.
- No automatic sync is approved.
- Any localStorage behavior change requires separate explicit approval.

## 11. Backend Mode Guardrails
- Backend mode must remain explicit and guarded.
- Backend mode must remain reversible.
- Backend mode must remain test-covered.
- Backend mode must not silently overwrite local data.
- Backend mode must not automatically migrate localStorage history.
- Backend mode must not automatically sync records.
- Backend mode must not run unguarded production reads on app load.
- Backend mode must not run unguarded production writes from normal app workflows.
- Missing Supabase config must remain safe.
- Blocked/failure backend results must remain safe and preserve local data.

## 12. Production Data Safety Rules
- No unguarded production reads on app load are approved.
- No unguarded production writes from app workflows are approved.
- No real customer/project/estimate/invoice/payment data movement is approved.
- No real credentials or secrets may be committed.
- Service-role key, secret key, database credentials, JWTs, tokens, private keys, and admin keys remain permanently blocked.
- Production launch behavior remains blocked.

## 13. Migration Separation Rules
- Controlled app workflow integration remains separate from migration preview.
- Controlled app workflow integration remains separate from migration writes.
- Migration preview remains blocked.
- Migration writes remains blocked.
- Migration actions require separate gate approvals.

## 14. App Behavior Preservation Rules
- Estimate creation behavior must remain unchanged unless separately approved.
- Invoice creation behavior must remain unchanged unless separately approved.
- PDF/export behavior must remain unchanged unless separately approved.
- AI Assist behavior must remain unchanged unless separately approved.
- Spanish/bilingual behavior must remain unchanged unless separately approved.
- Mobile/PWA behavior must remain unchanged unless separately approved.
- Current save/load behavior must be preserved by default.
- Integration must be narrowly scoped and reversible.

## 15. Testing Requirements
- Tests must use fake/mock data only.
- Tests must not require real Supabase credentials.
- Tests must not require production Supabase network calls.
- Tests must verify localStorage remains default.
- Tests must verify localStorage fallback remains available.
- Tests must verify current save/load behavior is preserved by default.
- Tests must verify missing Supabase config is safe.
- Tests must verify backend blocked/failure behavior does not destroy local data.
- Tests must verify no automatic localStorage migration occurs.
- Tests must verify no automatic sync occurs.
- Tests must verify PDF/export behavior remains unaffected where practical.
- Tests must verify AI Assist behavior remains unaffected where practical.
- Tests must verify no migration preview or migration writes are added.
- Tests must verify no auth/onboarding/membership UI behavior is added.

## 16. Validation Requirements
For future implementation execution:
- Run npm test -- --watchAll=false.
- Run npm run build.
- Run git diff --check.
- Confirm localStorage remains default.
- Confirm localStorage fallback remains available.
- Confirm no automatic localStorage migration is added.
- Confirm no automatic sync is added.
- Confirm no unguarded production reads on app load are added.
- Confirm no unguarded production writes from app workflows are added.
- Confirm no real credentials or secrets are committed.
- Confirm no migration preview or migration writes are added.
- Confirm no production launch behavior is added.
- Confirm PDF/export behavior remains unchanged.
- Confirm AI Assist behavior remains unchanged.
- Confirm estimate/invoice workflow behavior remains unchanged unless explicitly approved.
- Confirm Supabase unconfigured/failure behavior is safe.
- Confirm app workflow integration is narrowly scoped and reversible.

## 17. Hard Stops
- Stop before implementing controlled app workflow integration in this pass.
- Stop before modifying source/runtime files in this pass.
- Stop before wiring save/load switching service into app workflows in this pass.
- Stop before replacing localStorage entirely.
- Stop before removing localStorage fallback.
- Stop before automatic localStorage migration or automatic sync.
- Stop before unguarded production reads/writes.
- Stop before auth/session, onboarding, or membership UI work.
- Stop before migration preview.
- Stop before migration writes.
- Stop before real data movement.
- Stop before launch.

## 18. Remaining Blocked Actions
- Controlled app workflow integration implementation in this pass
- Replacing localStorage entirely
- Removing localStorage fallback
- Automatically syncing all local data
- Automatically migrating localStorage history
- Running unguarded production reads on app load
- Running unguarded production writes from app workflows
- Migration preview
- Migration writes
- Real customer/project/estimate/invoice/payment data movement
- Auth/session UX
- User onboarding UI
- Company membership management UI
- Production launch

## 19. Exact Next Gate
After this document is created and saved, the next gate is controlled app workflow integration implementation execution. That future pass may make tightly scoped source/test changes to wire the save/load switching service into active app workflows while keeping localStorage as default/fallback. Automatic localStorage migration, automatic sync, migration preview, migration writes, real data movement, auth/session UX, onboarding UI, membership UI, and production launch remain blocked unless separately approved.
