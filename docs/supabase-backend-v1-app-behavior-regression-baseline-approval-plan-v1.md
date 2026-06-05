# Supabase Backend V1 App Behavior Regression Baseline Approval Plan V1

## 1. Summary
This is a planning-only document for a future app behavior regression baseline approval gate after controlled app workflow integration. This pass does not approve baseline execution and does not approve implementation changes. It does not approve changes to source/runtime files, app workflows, localStorage behavior, PDF/export behavior, AI Assist behavior, migration preview, migration writes, real data movement, auth/session UX, onboarding UI, membership UI, or production launch.

## 2. Planning status
Planning-only.

Not approved in this pass:
- App behavior regression baseline execution.
- Any source/runtime implementation changes.
- Any migration or launch execution.

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

## 4. Current runtime wiring status
- Browser-safe Supabase env helper exists.
- Browser-safe Supabase client module exists.
- @supabase/supabase-js is installed.
- Missing or placeholder env values do not crash imports.
- Supabase client module performs no production reads or writes by itself.

## 5. Current backend data adapter status
- Backend data adapter scaffolding exists.
- Adapter imports safely.
- Adapter status/fallback behavior exists.
- Adapter reuses backend data mapper utilities.
- Adapter exposes dormant scaffolding methods.
- Adapter blocked read/write methods return controlled blocked results when explicitly called.
- Adapter performs no automatic production reads/writes.

## 6. Current save/load switching status
- Save/load mode helper exists.
- Save/load switching service exists.
- localStorage is the default active mode.
- localStorage fallback remains available.
- Backend mode is explicit and guarded.
- Backend unconfigured/blocked/failed behavior returns controlled fallback results.
- No automatic localStorage migration exists.
- No automatic sync exists.
- No production reads/writes were added on app load.

## 7. Current controlled app workflow integration status
- Narrow opt-in bridge exists in estimator draft persistence.
- Integration is limited to src/estimator/useEstimatorState.js.
- localStorage remains the default active path.
- Existing calls continue to work without new required options.
- Backend read hydration is separately gated by explicit allowBackendReadForInitialHydration.
- No broad app/root workflow rewrites were made.
- PDF/export unchanged.
- AI Assist unchanged.
- Auth/session UX not added.
- Onboarding UI not added.
- Membership UI not added.
- Migration execution not added.
- Production launch behavior not added.

## 8. Future regression baseline approval scope
Future approval planning may allow a controlled regression-baseline execution pass using tests and documentation only to capture and validate current post-integration behavior, including:
- Capturing current post-integration app behavior baseline.
- Verifying estimate creation behavior.
- Verifying invoice creation behavior.
- Verifying company profile behavior.
- Verifying customer/project behavior where applicable.
- Verifying history save/load behavior.
- Verifying localStorage default/fallback behavior.
- Verifying backend mode remains explicit opt-in only.
- Verifying PDF/export behavior.
- Verifying AI Assist behavior.
- Verifying Spanish/bilingual behavior.
- Verifying mobile/PWA behavior.
- Verifying Supabase unconfigured/failure behavior remains safe.
- Verifying no automatic localStorage migration exists.
- Verifying no automatic sync exists.
- Verifying no unguarded production reads/writes exist.
- Verifying no migration preview or migration writes exist.
- Verifying no production launch behavior exists.
- Defining validation required before further backend data movement gates.

## 9. Explicit exclusions
- Approving baseline execution in this pass.
- Modifying source/runtime files.
- Changing save/load behavior.
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

## 10. Regression areas to baseline
- Company profile
- Estimate creation
- Invoice creation
- History save/load
- localStorage persistence
- Controlled save/load switching guardrails
- PDF/export
- AI Assist
- Spanish/bilingual behavior
- Mobile/PWA behavior
- Supabase missing/unconfigured behavior
- Backend blocked/failure fallback behavior
- Migration/launch absence checks

## 11. localStorage default/fallback validation rules
- Baseline must prove localStorage remains default.
- Baseline must prove localStorage fallback remains available.
- Baseline must verify existing localStorage key behavior remains compatible.
- Baseline must verify existing save/load behavior remains backward compatible.
- Baseline must verify no automatic localStorage migration exists.
- Baseline must verify no automatic sync exists.

## 12. Backend mode guardrail validation rules
- Baseline must prove backend mode is explicit opt-in only.
- Baseline must verify default flow does not auto-activate backend mode.
- Baseline must verify backend unconfigured behavior remains safe.
- Baseline must verify backend blocked/failure behavior remains safe and preserves local data.
- Baseline must verify no unguarded production reads on app load.
- Baseline must verify no unguarded production writes from app workflows.

## 13. App behavior preservation validation rules
- Baseline must verify estimate creation behavior remains unchanged.
- Baseline must verify invoice creation behavior remains unchanged.
- Baseline must verify company profile behavior remains unchanged.
- Baseline must verify history save/load behavior remains unchanged.
- Baseline must verify PDF/export behavior remains unchanged.
- Baseline must verify AI Assist behavior remains unchanged.
- Baseline must verify Spanish/bilingual behavior remains unchanged.
- Baseline must verify mobile/PWA behavior remains unchanged.
- Any regression failures must be documented as blockers before moving forward.

## 14. Production data safety rules
- Baseline must not create or move real production data.
- Baseline must use fake/mock data only.
- Baseline must not require real customer/business data.
- Baseline must not expose credentials or secrets.
- No real Supabase URL/key, service-role key, secret key, JWTs, passwords, connection strings, tokens, private keys, or admin keys are allowed.
- No env files may be created or modified.

## 15. Migration and launch separation rules
- Regression baseline work remains separate from migration preview.
- Regression baseline work remains separate from migration writes.
- Regression baseline work remains separate from production launch.
- Migration preview remains blocked.
- Migration writes remain blocked.
- Production launch remains blocked.

## 16. Required validation before baseline execution
- Run npm test -- --watchAll=false.
- Run npm run build.
- Run git diff --check.
- Confirm localStorage remains default.
- Confirm localStorage fallback remains available.
- Confirm existing save/load behavior remains backward compatible.
- Confirm no automatic localStorage migration exists.
- Confirm no automatic sync exists.
- Confirm no unguarded production reads on app load exist.
- Confirm no unguarded production writes from app workflows exist.
- Confirm no real credentials or secrets are committed.
- Confirm no migration preview or migration writes exist.
- Confirm no production launch behavior exists.
- Confirm PDF/export behavior remains unchanged.
- Confirm AI Assist behavior remains unchanged.
- Confirm estimate/invoice workflow behavior remains unchanged.
- Confirm Supabase unconfigured/failure behavior is safe.

## 17. Hard stops
- Stop before baseline execution in this pass.
- Stop before modifying source/runtime files in this pass.
- Stop before changing save/load behavior.
- Stop before replacing localStorage entirely.
- Stop before removing localStorage fallback.
- Stop before automatic localStorage migration or automatic sync.
- Stop before unguarded production reads/writes.
- Stop before auth/session, onboarding, or membership UI work.
- Stop before migration preview.
- Stop before migration writes.
- Stop before real data movement.
- Stop before launch.

## 18. Remaining blocked actions
- App behavior regression baseline execution in this pass
- Replacing localStorage entirely
- Removing localStorage fallback
- Automatic migration of localStorage history
- Automatic sync of all local data
- Unguarded production reads on app load
- Unguarded production writes from app workflows
- Migration preview execution
- Migration write execution
- Real customer/project/estimate/invoice/payment data movement
- Auth/session UX
- Onboarding UI
- Membership management UI
- Production launch

## 19. Exact next gate
After this planning document is created and saved, the next gate is app behavior regression baseline execution approval. That future approval may allow a controlled regression-baseline execution pass using tests and documentation only. Migration preview, migration writes, real data movement, auth/session UX, onboarding UI, membership UI, and production launch remain blocked unless separately approved.
