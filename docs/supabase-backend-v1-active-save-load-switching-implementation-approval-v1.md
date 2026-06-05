# Supabase Backend V1 Active UI Save/Load Switching Implementation Approval V1

## 1. Summary
This is a docs-only approval record for the next controlled implementation phase of active UI save/load switching scaffolding for EstiPaid. It approves tightly scoped feature-flagged switching scaffolding and tests only. It does not execute implementation in this pass and does not approve production launch, migration preview, migration writes, automatic localStorage migration, real data movement, auth/session UX, onboarding UI, or company membership management UI.

## 2. Approval Status
Approved as the next controlled implementation phase only:
- Add controlled save/load switching scaffolding.
- Add a safe backend save/load service layer if needed.
- Add feature-flag or mode-gated behavior so localStorage remains the default active path unless explicitly enabled.
- Preserve localStorage fallback.
- Preserve current history persistence unless explicitly routed through the approved switching layer.
- Add safe unconfigured Supabase behavior.
- Add safe failed-request fallback behavior.
- Add tests for localStorage default behavior.
- Add tests for backend-unconfigured fallback behavior.
- Add tests for no automatic localStorage migration.
- Add tests for no production launch behavior.
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

## 6. Approved Implementation Scope
- Source changes may add a save/load switching layer.
- Source changes may add tests for save/load switching behavior.
- Source changes may add controlled integration between existing save/load helpers and backend adapter scaffolding.
- Source changes may add a safe backend mode resolver.
- Source changes may add a no-op or disabled-by-default backend mode.
- Source changes may verify Supabase configured status before backend path use.
- Source changes must keep localStorage fallback available.
- Source changes must not silently migrate existing localStorage data.
- Source changes must not automatically sync data.
- Source changes must not write production data unless the backend mode is explicitly enabled through approved code paths.
- Source changes must not add auth/session UX.
- Source changes must not launch production.

## 7. Allowed Future Source Categories
- src/lib/**
- src/utils/**
- Focused tests for save/load switching behavior
- App workflow integration files only if required for controlled switching, and only within the approved scope

## 8. Future Save/Load Switching Principles
- localStorage remains the safest fallback.
- Backend mode must be explicit, testable, and reversible.
- Missing Supabase env values must not crash the app.
- Supabase request failure must not destroy local data.
- Existing localStorage history must not be automatically migrated.
- Existing localStorage history must not be silently overwritten.
- Backend writes must be scoped and guarded.
- Backend reads must be scoped and guarded.
- PDF/export output must remain unchanged.
- AI Assist behavior must remain unchanged.
- Estimate/invoice workflow behavior must remain visually unchanged unless separately approved.
- Migration preview and migration writes remain separate gates.
- Production launch remains a separate gate.

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

## 10. LocalStorage Fallback Rules
- localStorage must remain available as fallback.
- localStorage remains the default active save/load path unless explicitly switched by approved, controlled code.
- No silent fallback removal is allowed.
- No automatic localStorage migration is approved.
- Any fallback behavior change requires separate explicit approval.

## 11. Production Data Safety Rules
- No production launch behavior is approved.
- No unguarded production reads are approved.
- No unguarded production writes are approved.
- No real customer/project/estimate/invoice/payment data movement is approved.
- No real credentials or secrets may be committed.
- Service-role key, secret key, database credentials, JWTs, tokens, private keys, and admin keys remain permanently blocked.

## 12. Migration Separation Rules
- Save/load switching remains separate from migration preview.
- Save/load switching remains separate from migration writes.
- Migration preview remains blocked.
- Migration writes remains blocked.
- Any migration operation requires separate gate approval.

## 13. App Behavior Preservation Rules
- PDF/export behavior must remain unchanged unless separately approved.
- AI Assist behavior must remain unchanged unless separately approved.
- Estimate/invoice workflow behavior must remain unchanged unless separately approved.
- No visual workflow changes are approved outside controlled switching scope.

## 14. Testing Requirements
- Tests must use fake/mock data only.
- Tests must not require real Supabase credentials.
- Tests must not require production Supabase network calls.
- Tests must verify localStorage remains default/fallback.
- Tests must verify missing Supabase env values are safe.
- Tests must verify failed backend behavior does not destroy local data.
- Tests must verify no automatic localStorage migration is performed.
- Tests must verify PDF/export behavior remains unaffected where practical.
- Tests must verify AI Assist behavior remains unaffected where practical.
- Tests must verify no migration preview or migration writes are added.

## 15. Validation Requirements
For the future implementation execution pass:
- Run npm test -- --watchAll=false.
- Run npm run build.
- Run git diff --check.
- Confirm no real credentials or secrets are committed.
- Confirm localStorage fallback remains available.
- Confirm no automatic localStorage migration is added.
- Confirm no migration preview or migration writes are added.
- Confirm no production launch behavior is added.
- Confirm PDF/export behavior remains unchanged.
- Confirm AI Assist behavior remains unchanged.
- Confirm estimate/invoice workflow behavior remains unchanged unless explicitly approved.
- Confirm Supabase unconfigured/failure behavior is safe.

## 16. Hard Stops
- Stop before implementing active save/load switching in this pass.
- Stop before modifying source/runtime files in this pass.
- Stop before connecting active UI workflows to Supabase in this pass.
- Stop before replacing localStorage save/load in this pass.
- Stop before modifying current history persistence in this pass.
- Stop before running production reads on app load.
- Stop before running production writes from app workflows.
- Stop before creating auth/session UX.
- Stop before creating onboarding UI.
- Stop before creating company membership management UI.
- Stop before running migration preview.
- Stop before running migration writes.
- Stop before moving real customer/project/estimate/invoice/payment data.
- Stop before approving launch.

## 17. Remaining Blocked Actions
- Active UI save/load switching implementation in this pass
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
- Onboarding UI
- Company membership management UI
- Production launch

## 18. Exact Next Gate
After this document is created and saved, the next gate is active UI save/load switching implementation execution. That future pass may make tightly scoped source/test changes for controlled save/load switching only. Migration preview, migration writes, automatic localStorage migration, real data movement, auth/session UX, onboarding UI, membership UI, and production launch remain blocked unless separately approved.
