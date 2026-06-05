# Supabase Backend V1 Active Save/Load Switching Approval Plan V1

## 1. Summary
This is planning-only for the future approval scope to safely switch active EstiPaid save/load behavior from localStorage-only to controlled Supabase-backed behavior after backend data adapter scaffolding. This pass does not approve implementation and does not approve production reads/writes, migration preview, migration writes, real data movement, or production launch.

## 2. Planning Status
- Planning-only.
- Active UI save/load switching is not approved in this pass.

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

## 6. Future Active Save/Load Switching Approval Scope
Future approval planning may allow tightly scoped implementation for:
- Deciding whether Supabase-backed save/load is enabled behind a controlled feature flag.
- Preserving localStorage fallback behavior.
- Preventing silent data loss during save/load switching.
- Avoiding automatic production writes before explicit approval.
- Avoiding automatic migration of existing localStorage data.
- Separating runtime save/load switching from migration preview.
- Separating runtime save/load switching from migration writes.
- Keeping PDF/export behavior unchanged.
- Keeping AI Assist behavior unchanged.
- Keeping estimate/invoice workflows visually unchanged unless separately approved.
- Defining validation required before active save/load switching implementation.

## 7. Explicit Exclusions
- Implementing active save/load switching in this pass.
- Replacing localStorage.
- Automatically syncing data.
- Automatically migrating localStorage history.
- Running production reads on app load.
- Running production writes from app workflows.
- Creating auth/session UX.
- Creating user onboarding.
- Creating company membership management UI.
- Running migration preview.
- Running migration writes.
- Moving real customer/project/estimate/invoice/payment data.
- Launching production.

## 8. Future Save/Load Switching Principles
- localStorage must remain available as fallback.
- Supabase save/load must not silently overwrite local data.
- Supabase save/load must not migrate existing localStorage records automatically.
- Supabase save/load must not write real production data until explicitly approved.
- Any backend write behavior must be scoped, tested, and reversible.
- Any backend read behavior must be scoped, tested, and safe when Supabase is unconfigured.
- App must behave safely if Supabase env values are missing.
- App must behave safely if Supabase request fails.
- Existing PDF/export output must remain unchanged.
- Existing AI Assist behavior must remain unchanged.
- Existing estimate/invoice workflows must remain unchanged unless separately approved.
- Migration preview and migration writes must remain separate gates.
- Production launch must remain blocked.

## 9. LocalStorage Fallback Rules
- localStorage remains the active save/load path until separately approved.
- localStorage fallback must remain available even when Supabase-backed paths are introduced later.
- No silent fallback removal is allowed.
- No automatic localStorage migration is approved.
- Any fallback behavior change requires separate explicit approval.

## 10. Production Data Safety Rules
- No production reads are approved in this planning pass.
- No production writes are approved in this planning pass.
- No real customer/project/estimate/invoice/payment data movement is approved.
- No real credentials or secrets may be committed.
- Service-role key, secret key, database credentials, JWTs, tokens, private keys, and admin keys remain permanently blocked.

## 11. Migration Separation Rules
- Runtime save/load switching remains separate from migration preview.
- Runtime save/load switching remains separate from migration writes.
- Migration preview remains blocked in this scope.
- Migration writes remain blocked in this scope.
- Any migration activity requires separate gate approval.

## 12. App Behavior Preservation Rules
- PDF/export behavior must remain unchanged unless separately approved.
- AI Assist behavior must remain unchanged unless separately approved.
- Estimate/invoice workflow behavior must remain unchanged unless separately approved.
- No user-visible workflow changes are approved in this planning pass.

## 13. Required Validation Before Implementation
Before future implementation approval/execution:
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

## 14. Hard Stops
- Stop before implementing active UI save/load switching.
- Stop before replacing localStorage save/load.
- Stop before production reads/writes from app workflows.
- Stop before migration preview.
- Stop before migration writes.
- Stop before real data movement.
- Stop before auth/session, onboarding, or membership UI work.
- Stop before launch.
- Stop before adding credentials or secrets.

## 15. Remaining Blocked Actions
- Active UI save/load switching implementation
- Replacing localStorage save/load
- Production reads/writes from app workflows
- Migration preview
- Migration writes
- Real customer/project/estimate/invoice/payment data movement
- Auth/session UX implementation
- User onboarding UI implementation
- Company membership management UI implementation
- Production launch

## 16. Exact Next Gate
After this planning document is created and saved, the next gate is active UI save/load switching implementation approval. That future approval may allow tightly scoped source/test changes for controlled save/load switching only. Migration preview, migration writes, real data movement, auth/onboarding, membership UI, and production launch remain blocked unless separately approved.
