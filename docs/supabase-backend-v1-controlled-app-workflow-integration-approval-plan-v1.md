# Supabase Backend V1 Controlled App Workflow Integration Approval Plan V1

## 1. Summary
This is planning-only for the future approval scope to safely integrate existing save/load switching scaffolding into active EstiPaid app workflows while keeping localStorage as the default and fallback behavior. This pass does not approve implementation and does not approve migration preview, migration writes, real data movement, auth/session UX, onboarding UI, membership UI, or production launch.

## 2. Planning Status
- Planning-only.
- Controlled app workflow integration is not approved in this pass.

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

## 7. Future Controlled App Workflow Integration Approval Scope
Future approval planning may allow tightly scoped implementation for:
- Identifying the smallest required app workflow integration points.
- Integrating save/load switching service only where necessary.
- Keeping localStorage as the default active path.
- Keeping localStorage fallback available.
- Avoiding automatic localStorage migration.
- Avoiding automatic sync.
- Avoiding unguarded production reads on app load.
- Avoiding unguarded production writes from normal app workflows.
- Preserving estimate creation behavior.
- Preserving invoice creation behavior.
- Preserving history persistence behavior unless routed through a controlled localStorage-default switching layer.
- Preserving PDF/export behavior.
- Preserving AI Assist behavior.
- Preserving Spanish/bilingual behavior.
- Preserving mobile/PWA behavior.
- Keeping migration preview and migration writes separate.
- Keeping real data movement blocked.
- Keeping auth/session UX, onboarding UI, and membership UI blocked.
- Keeping production launch blocked.

## 8. Explicit Exclusions
- Implementing controlled app workflow integration in this pass.
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

## 9. Future Integration Principles
- localStorage must remain default.
- localStorage fallback must remain available.
- Backend mode must remain explicit, guarded, reversible, and test-covered.
- Backend mode must not silently overwrite local data.
- Backend mode must not automatically migrate localStorage history.
- Backend mode must not automatically sync all records.
- Backend mode must not run production reads on app load unless separately approved.
- Backend mode must not run production writes from normal app workflows unless separately approved.
- App must behave safely if Supabase env values are missing.
- App must behave safely if backend adapter returns blocked results.
- App must behave safely if backend requests fail.
- Existing PDF/export output must remain unchanged.
- Existing AI Assist behavior must remain unchanged.
- Existing estimate/invoice workflow behavior must remain visually unchanged unless separately approved.
- Migration preview and migration writes remain separate gates.
- Production launch remains a separate gate.

## 10. LocalStorage Default/Fallback Rules
- localStorage remains the default active path.
- localStorage fallback remains available at all times.
- No silent fallback removal is approved.
- No automatic localStorage migration is approved.
- No automatic sync is approved.
- Any localStorage behavior change requires separate explicit approval.

## 11. Production Data Safety Rules
- No unguarded production reads on app load are approved.
- No unguarded production writes from app workflows are approved.
- No real customer/project/estimate/invoice/payment data movement is approved.
- No real credentials or secrets may be committed.
- Service-role key, secret key, database credentials, JWTs, tokens, private keys, and admin keys remain permanently blocked.
- Production launch behavior remains blocked.

## 12. Migration Separation Rules
- Controlled app workflow integration remains separate from migration preview.
- Controlled app workflow integration remains separate from migration writes.
- Migration preview remains blocked.
- Migration writes remain blocked.
- Migration actions require separate gate approvals.

## 13. App Behavior Preservation Rules
- Estimate creation behavior must remain unchanged unless separately approved.
- Invoice creation behavior must remain unchanged unless separately approved.
- History persistence behavior must remain unchanged unless routed through approved controlled switching with localStorage default.
- PDF/export behavior must remain unchanged unless separately approved.
- AI Assist behavior must remain unchanged unless separately approved.
- Spanish/bilingual behavior must remain unchanged unless separately approved.
- Mobile/PWA behavior must remain unchanged unless separately approved.
- Workflow integration changes must be narrowly scoped and reversible.

## 14. Allowed Future Source Categories
- src/lib/**
- src/utils/**
- Focused tests for integration behavior
- Narrowly scoped app workflow files only if required for controlled localStorage-default switching

## 15. Required Validation Before Implementation
Before future implementation approval/execution:
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

## 16. Hard Stops
- Stop before implementing controlled app workflow integration in this pass.
- Stop before modifying source/runtime files in this pass.
- Stop before wiring save/load switching service into app workflows in this pass.
- Stop before replacing localStorage entirely.
- Stop before removing localStorage fallback.
- Stop before automatic localStorage migration or automatic sync.
- Stop before unguarded production reads/writes.
- Stop before auth/session, onboarding, or membership UI work.
- Stop before migration preview or migration writes.
- Stop before real data movement.
- Stop before launch.

## 17. Remaining Blocked Actions
- Controlled app workflow integration implementation
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

## 18. Exact Next Gate
After this planning document is created and saved, the next gate is controlled app workflow integration implementation approval. That future approval may allow tightly scoped source/test changes to wire the save/load switching service into active app workflows while keeping localStorage as default/fallback. Automatic localStorage migration, migration preview, migration writes, real data movement, auth/session UX, onboarding UI, membership UI, and production launch remain blocked unless separately approved.
