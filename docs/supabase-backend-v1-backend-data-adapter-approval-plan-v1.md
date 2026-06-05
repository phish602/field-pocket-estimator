# Supabase Backend V1 Backend Data Adapter Approval Plan V1

## 1. Summary
This is planning-only for the future backend data adapter approval scope after browser-safe runtime wiring. It defines guardrails and required validations for a later implementation pass. It does not approve backend data adapter implementation in this pass and does not approve production reads/writes, migration preview, migration writes, real data movement, or production launch.

## 2. Planning Status
- Planning-only.
- Backend data adapter implementation is not approved in this pass.

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
- `@supabase/supabase-js` is installed.
- Missing or placeholder env values do not crash imports.
- Supabase client module performs no production reads or writes by itself.
- EstiPaid workflows are not switched to Supabase.
- localStorage persistence remains unchanged.
- PDF/export remains unchanged.
- AI Assist remains unchanged.
- Estimate/invoice workflows remain unchanged.

## 5. Future Backend Data Adapter Approval Scope
Future approval may allow tightly scoped implementation planning and code work for:
- Adding a backend data adapter layer.
- Keeping localStorage as the active save/load path until adapter implementation is explicitly approved.
- Creating adapter functions that map EstiPaid app entities to Supabase tables.
- Supporting these entity categories:
  - company profile
  - customers
  - projects
  - estimates
  - estimate line items
  - invoices
  - invoice line items
  - invoice payments
  - scope templates
  - app settings
  - audit events
  - migration batches
  - migration write results
- Preserving existing local data shape until migration strategy is separately approved.
- Keeping production reads/writes blocked until implementation approval.
- Keeping migration preview blocked.
- Keeping migration writes blocked.
- Keeping real customer/project/estimate/invoice/payment data movement blocked.
- Keeping production launch blocked.
- Defining validation required before backend data adapter implementation.

## 6. Explicit Exclusions
- Approving backend data adapter implementation in this pass.
- Modifying source/runtime/env files in this pass.
- Replacing localStorage save/load behavior.
- Reading production business data from Supabase.
- Writing production business data to Supabase.
- Running migration preview.
- Running migration writes.
- Moving real customer/project/estimate/invoice/payment data.
- Approving production launch.
- Adding credentials or secrets to repo files.

## 7. Future Adapter Principles
- Adapter code must use the existing browser-safe Supabase client only.
- Adapter code must never use service-role, secret, admin, database, JWT, token, or connection-string credentials.
- Adapter code must not bypass RLS.
- Adapter code must preserve company-scoped access assumptions.
- Adapter code must preserve existing UI behavior unless separately approved.
- Adapter code must not silently replace localStorage.
- Adapter code must support safe fallback behavior if Supabase is not configured.
- Adapter code must separate mapping logic from UI components.
- Adapter code must include focused tests where practical.
- Adapter code must not run real migration writes.
- Adapter code must not move real production data without a separate migration gate.

## 8. Allowed Future Source Categories
- `src/lib/**`
- `src/utils/**`
- Focused tests for adapter and mapper behavior

## 9. Blocked Source Behavior
- Connecting active UI save/load to Supabase.
- Replacing current localStorage history.
- Automatically syncing data.
- Running production reads on app load.
- Running production writes from app workflows.
- Creating auth/session UX.
- Creating user onboarding.
- Creating company membership management UI.
- Creating migration execution code.
- Launching production.

## 10. LocalStorage Preservation Rules
- localStorage remains the active save/load path until separately approved.
- Adapter planning must not modify localStorage behavior.
- Adapter planning must not remove local fallback behavior.
- Save/load behavior changes require a separate explicit implementation approval gate.

## 11. Production Data Safety Rules
- No production business data reads in planning scope.
- No production business data writes in planning scope.
- No real customer/project/estimate/invoice/payment data movement in planning scope.
- Only public frontend env variable names remain allowed in browser runtime context:
  - `REACT_APP_SUPABASE_URL`
  - `REACT_APP_SUPABASE_ANON_KEY`
- Service-role key, secret key, database credentials, JWTs, tokens, private keys, and admin keys remain permanently blocked.

## 12. Migration Safety Rules
- Migration preview remains blocked.
- Migration writes remain blocked.
- No migration execution code is approved in this planning pass.
- Migration strategy and movement of real data require separate gates.

## 13. Required Validation Before Implementation
- Confirm only public frontend env variables are used.
- Confirm no blocked secrets are referenced.
- Confirm adapter does not bypass RLS.
- Confirm no real Supabase values are committed.
- Confirm localStorage behavior remains active unless separately approved.
- Confirm no production data reads/writes are added without explicit implementation approval.
- Confirm no migration preview or migration writes are added.
- Confirm PDF/export behavior remains unchanged.
- Confirm AI Assist behavior remains unchanged.
- Confirm estimate/invoice workflows remain unchanged.
- Run `npm test -- --watchAll=false`.
- Run `npm run build`.
- Run `git diff --check`.

## 14. Hard Stops
- Stop before implementing backend data adapters.
- Stop before modifying save/load behavior.
- Stop before connecting active UI workflows to Supabase data.
- Stop before any production reads/writes.
- Stop before migration preview.
- Stop before migration writes.
- Stop before real data movement.
- Stop before launch.
- Stop before adding credentials or secrets.

## 15. Remaining Blocked Actions
- Backend data adapter implementation
- Replacing or modifying localStorage save/load behavior
- Reading production business data from Supabase
- Writing production business data to Supabase
- Running migration preview
- Running migration writes
- Moving real customer/project/estimate/invoice/payment data
- Launching production

## 16. Exact Next Gate
After this planning document is created and saved, the next gate is backend data adapter implementation approval. That future approval may allow tightly scoped source changes for adapter scaffolding and tests only. Active UI save/load switching, migration preview, migration writes, real data movement, and production launch remain blocked unless separately approved.
