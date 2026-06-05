# Supabase Backend V1 App Behavior Regression Baseline Execution Approval V1

## 1. Summary
This document approves the next controlled execution phase for app behavior regression baseline work in EstiPaid. This current pass is documentation-only and does not execute baseline tests or inspections. It does not approve source/runtime behavior changes, migration preview, migration writes, real data movement, auth/session UX, onboarding UI, membership UI, or production launch.

## 2. Approval status
Approved as the next controlled execution phase only:
- Run the app behavior regression baseline.
- Use existing tests and focused inspection.
- Verify current post-integration behavior.
- Document the baseline result.
- Confirm localStorage remains default.
- Confirm localStorage fallback remains available.
- Confirm backend mode remains explicit opt-in only.
- Confirm no automatic localStorage migration exists.
- Confirm no automatic sync exists.
- Confirm no unguarded production reads/writes exist.
- Confirm PDF/export behavior remains unchanged.
- Confirm AI Assist behavior remains unchanged.
- Confirm estimate/invoice workflows remain unchanged.
- Confirm Spanish/bilingual behavior remains unchanged where testable.
- Confirm mobile/PWA behavior remains unchanged where testable.
- Confirm migration preview and migration writes remain absent.
- Confirm auth/session UX, onboarding UI, and membership UI remain absent.
- Confirm production launch remains blocked.

This pass does not execute baseline work.

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

## 8. Approved execution scope
Approved for the next execution pass only:
- Run npm test -- --watchAll=false.
- Run npm run build.
- Run git diff --check.
- Run git status.
- Inspect relevant files/tests for regression baseline evidence.
- Create one result document after execution.

Allowed future output file after execution:
- docs/supabase-backend-v1-app-behavior-regression-baseline-result-v1.md

Not approved in the execution phase:
- Source/runtime behavior modifications.
- New runtime features.
- Production data reads/writes.
- Migration behavior.
- Launch behavior.

## 9. Required baseline areas
- Company profile behavior
- Estimate creation behavior
- Invoice creation behavior
- History save/load behavior
- localStorage persistence behavior
- Controlled save/load switching guardrails
- PDF/export behavior
- AI Assist behavior
- Spanish/bilingual behavior
- Mobile/PWA behavior
- Supabase missing/unconfigured behavior
- Backend blocked/failure fallback behavior
- Migration/launch absence checks

## 10. Explicit exclusions
- Modifying source/runtime behavior.
- Changing save/load behavior.
- Replacing localStorage entirely.
- Removing localStorage fallback.
- Automatically syncing all local data.
- Automatically migrating localStorage history.
- Running unguarded production reads on app load.
- Running unguarded production writes from app workflows.
- Running migration preview.
- Running migration writes.
- Moving real customer/project/estimate/invoice/payment data.
- Creating auth/session UX.
- Creating onboarding UI.
- Creating company membership management UI.
- Launching production.

## 11. localStorage default/fallback validation rules
- Validate localStorage remains default.
- Validate localStorage fallback remains available.
- Validate existing save/load behavior remains backward compatible.
- Validate no automatic localStorage migration exists.
- Validate no automatic sync exists.

## 12. Backend mode guardrail validation rules
- Validate backend mode remains explicit opt-in only.
- Validate default flow does not activate backend mode.
- Validate unconfigured backend behavior is safe.
- Validate blocked/failure backend behavior is safe and preserves local data.
- Validate no unguarded production reads/writes exist.

## 13. App behavior preservation validation rules
- Validate estimate workflow behavior remains unchanged.
- Validate invoice workflow behavior remains unchanged.
- Validate company profile behavior remains unchanged.
- Validate history save/load behavior remains unchanged.
- Validate PDF/export behavior remains unchanged.
- Validate AI Assist behavior remains unchanged.
- Validate Spanish/bilingual behavior remains unchanged where testable.
- Validate mobile/PWA behavior remains unchanged where testable.

## 14. Production data safety rules
- Use tests/documentation evidence only.
- Do not create or move real production data.
- Do not use real customer/business data.
- Do not expose credentials or secrets.
- Do not create or edit any env files.

## 15. Migration and launch separation rules
- Baseline execution is separate from migration preview.
- Baseline execution is separate from migration writes.
- Baseline execution is separate from launch.
- Migration preview remains blocked.
- Migration writes remain blocked.
- Production launch remains blocked.

## 16. Validation commands for execution
- npm test -- --watchAll=false
- npm run build
- git diff --check
- git status

## 17. Hard stops
- Stop before executing baseline work in this docs-only approval pass.
- Stop before modifying source/runtime files.
- Stop before changing save/load behavior.
- Stop before migration preview.
- Stop before migration writes.
- Stop before real data movement.
- Stop before auth/session, onboarding, or membership UI work.
- Stop before production launch.

## 18. Remaining blocked actions
- Source/runtime behavior changes
- Save/load behavior changes
- Replacing localStorage entirely
- Removing localStorage fallback
- Automatic localStorage migration
- Automatic sync of all local data
- Unguarded production reads on app load
- Unguarded production writes from app workflows
- Migration preview execution
- Migration write execution
- Real customer/project/estimate/invoice/payment data movement
- Auth/session UX
- Onboarding UI
- Membership UI
- Production launch

## 19. Exact next gate
After this approval document is created and saved, the next gate is app behavior regression baseline execution. That future pass may run tests, inspect behavior evidence, and create the baseline result document only. Migration preview, migration writes, real data movement, auth/session UX, onboarding UI, membership UI, and production launch remain blocked unless separately approved.
