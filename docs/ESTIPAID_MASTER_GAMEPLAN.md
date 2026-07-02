# EstiPaid Master Gameplan

This document is the repo-level source of truth for EstiPaid execution order.

Future Claude, Codex, ChatGPT, or other engine work should read this file before proposing or implementing new lanes.

Do not reorder these phases unless Adrian explicitly reprioritizes them.

Do not restart settled work.
Do not reopen completed gates unless a regression proves they are broken.
Do not replace money-critical estimate/invoice logic casually.
Preserve existing EstimateForm and invoice behavior unless the task explicitly targets a proven bug.

## North Star

User saves work once.
EstiPaid protects it locally.
EstiPaid syncs it automatically.
Bad local state cannot destroy good cloud data.
The app must feel like a real contractor product, not a dev panel.

## Phase 1 — Finish Current Stabilization

Goal:
Get the current working app stable, committed cleanly, and safe to keep testing.

Includes:
- Cloud restore works
- Estimates restore/open/edit correctly
- Invoices restore/open/edit correctly
- Invoice opened total matches shell/card total
- Estimate to invoice scope carryover works
- Scope photos compress before save
- Scope photos preserve in templates
- Template save stays inside builder
- Create draft clears only after successful save
- Chambered draft survives opening/editing saved estimates/invoices
- StrictMode edit target cleanup race fixed
- Cloud Backup/Restore settings simplified
- Developer migration tools hidden from normal users
- Current WIP committed cleanly
- Final smoke pass

## Phase 2 — Legit Auth/Login UX

Goal:
Make login feel like a real app, not a dev setting.

Includes:
- Dedicated signed-out login screen
- Email and password in one clean card
- Magic link secondary, not confusing
- Forgot password/reset path
- Create account path if needed
- Session restore on app launch
- Settings only shows account management after sign-in
- Sign out in Settings
- Later passkey / Face ID / Touch ID style login
- No login buried inside Cloud Settings
- No split username/password cells

Production login model:
- Open app
- If signed out, show Auth screen
- If signed in, restore session and open dashboard
- Settings manages account after sign-in

## Phase 3 — Stripe/Payment Setup Completion

Goal:
Finish money flow before deeper sync/storage work.

Includes:
- Stripe Connect/status card finalized
- Connect / continue / refresh / disconnect flow clean
- Manual payment path preserved
- Invoice paid/partial/unpaid logic verified
- Payment records save correctly
- Invoice totals and balances remain correct
- No fake paid states
- Clear UI if Stripe is not connected

## Phase 4 — Data Integrity + Safe Cloud Sync Map

Goal:
Prepare automatic cloud sync without letting bad local state corrupt good cloud data.

Includes:
- No empty-device overwrite of cloud
- No blind last-write-wins
- No draft overwriting saved records
- No silent deletes
- Version/updatedAt checks
- Conflict detection
- Sync queue
- Last-good snapshots
- Clear Synced / Pending / Needs attention states
- Protected business records:
  - customers
  - projects
  - estimates
  - invoices
  - payments
  - templates
  - company profile
  - settings
  - photos/files

Core rule:
Auto-sync saved work.
Do not auto-sync corrupted drafts, blank restores, partial writes, or suspicious deletes.

## Phase 5 — Storage Architecture Hardening

Goal:
Stop localStorage from being the app’s file cabinet.

Final model:
- Supabase Postgres = business records
- Supabase Storage = photos/files/logos
- localStorage = tiny preferences/UI/session flags only
- IndexedDB/local cache = drafts/offline support if needed
- Photos stored once and referenced everywhere
- Estimates/templates/drafts reference photo assets instead of embedding duplicate base64 blobs

Protected data rule:
Never silently delete user-created templates, estimates, invoices, customers, projects, or photos referenced by them.

Disposable data:
- temporary drafts
- cache
- search state
- orphan unused photo assets after safe reference checks

## Phase 6 — Automatic Cloud Sync

Goal:
User saves once. EstiPaid handles cloud backup automatically.

Model:
- Draft typing/photos autosave locally
- Save/Update validates clean payload
- Save local last-good copy
- Queue cloud sync
- Supabase write happens in background
- UI shows Synced / Pending / Needs attention
- Manual Cloud Backup remains as fallback/repair, not the primary workflow

Do not sync every keystroke directly to Supabase.

Preferred flow:
Draft work stays local until meaningful save.
Save/Update creates clean payload.
Clean payload queues background sync.
Failed sync does not lose local saved work.
Cloud conflict stops and warns instead of overwriting blindly.

## Phase 7 — Production/App Store Polish

Goal:
Make EstiPaid feel like a contractor-ready product.

Includes:
- Normal users never see MIGRATE / RESTORE / PAYLOAD / BUNDLE typing junk
- Developer tools hidden
- Mobile UX pass
- Safer error messages
- Storage warnings
- Final backup/restore/sync polish
- Deploy/App Store prep

## Engine Rules

Before starting any future EstiPaid lane:
1. Read this file.
2. Identify the current phase.
3. Keep the task inside the requested lane.
4. Preserve current working estimate/invoice behavior.
5. Avoid redundant approval/document loops.
6. Do not restart settled context.
7. Ask before out-of-scope changes.
8. Report files changed and validation results.
9. Do not auto-commit unless explicitly told.

## Current Execution Priority

Immediate next order:
1. Finish/commit current stabilization WIP.
2. Final smoke pass.
3. Phase 2 — Legit Auth/Login UX.
4. Phase 3 — Stripe/payment setup completion.
5. Phase 4 — Data integrity + safe cloud sync map.
6. Phase 5 — Storage architecture hardening.
7. Phase 6 — Automatic cloud sync.
8. Phase 7 — Production/App Store polish.

Phase 3 payments happen before deep sync/storage implementation because invoice/payment records are money-critical and cloud sync should not be built around unfinished payment logic.

Phase 4 safety happens before Phase 6 automatic sync because bad local state must not be allowed to corrupt good cloud data.
