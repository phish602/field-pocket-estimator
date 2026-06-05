# Supabase Backend V1 Runtime Wiring Approval Plan V1

## 1. Summary
This is planning-only approval scope for the future runtime wiring phase of EstiPaid. It defines what must be approved before a browser-safe Supabase client can be implemented later. Runtime wiring is not implemented or approved in this pass.

## 2. Planning Status
Planning-only. Runtime wiring is not approved in this pass.

## 3. Current Production Backend Status
- Production Supabase project exists.
- Production SQL package deployed successfully.
- Production table creation verified.
- RLS enabled on all EstiPaid tables verified.
- Policies verified.
- Authenticated grants verified.
- Public frontend env values were added to Vercel only.
- No real values were added to the repo.
- No runtime wiring exists.
- No migration preview has run.
- No migration writes have run.
- Production launch remains blocked.

## 4. Current Env Status
- `.gitignore` protects env files and secret backup files.
- `.env.example` exists with placeholders only.
- Vercel has `REACT_APP_SUPABASE_URL`.
- Vercel has `REACT_APP_SUPABASE_ANON_KEY`.
- Local `.env.local` has not been created.
- No real env values are committed.

## 5. Future Runtime Wiring Approval Scope
- Read `REACT_APP_SUPABASE_URL` from runtime env.
- Read `REACT_APP_SUPABASE_ANON_KEY` from runtime env.
- Create a browser-safe Supabase client later.
- Ensure only public frontend values are used.
- Keep service-role keys and backend secrets permanently blocked.
- Preserve localStorage behavior until backend save/load is explicitly implemented.
- Preserve PDF/export behavior.
- Preserve AI Assist behavior.
- Preserve existing estimate/invoice workflows.
- Add safe runtime guards if env values are missing.
- Keep migration preview and migration writes blocked.
- Define validation required before any wiring execution.

## 6. Explicit Exclusions
- Creating Supabase client code in this pass
- Modifying app behavior in this pass
- Running migration preview in this pass
- Running migration writes in this pass
- Launching production in this pass
- Exposing privileged credentials in browser code
- Replacing localStorage save/load without a separate approved backend data adapter

## 7. Allowed Frontend Runtime Variables
- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`

## 8. Permanently Blocked Secrets
- Supabase service-role key
- Supabase secret key
- Database password
- Database connection string
- JWT secret
- Access tokens
- Refresh tokens
- Any secret-bearing auth token
- Any private key
- Any admin key

## 9. Future Browser-Safe Client Rules
- Browser code may only use the public project URL and anon/publishable key.
- Runtime wiring must not expose privileged credentials.
- Runtime wiring must not replace localStorage save/load until a separate backend data adapter implementation is approved.
- Runtime wiring must include safe failure behavior if env values are missing.
- Runtime wiring must not create production data migration writes.
- Runtime wiring must not change invoice/estimate PDF output.
- Runtime wiring must not change AI Assist behavior.
- Runtime wiring must not launch production.

## 10. LocalStorage Preservation Rules
- Keep current localStorage behavior until separately approved.
- Do not remove localStorage fallback in the wiring approval phase.
- Do not migrate existing local data as part of runtime wiring approval.
- Do not couple runtime wiring approval to migration execution.

## 11. App Behavior Preservation Rules
- Preserve PDF/export behavior.
- Preserve AI Assist behavior.
- Preserve save/load flows.
- Preserve existing estimate/invoice workflows.
- Do not change user-visible workflow behavior before wiring execution is approved.

## 12. Required Validation Before Implementation
- Verify `.env.example` remains placeholder-only.
- Verify `.gitignore` continues to protect env and secret backup files.
- Verify no real values are committed.
- Verify no secrets are added anywhere in the repo.
- Verify runtime wiring remains blocked until execution approval is granted.

## 13. Hard Stops
- Stop before adding credentials.
- Stop before creating Supabase client code.
- Stop before modifying runtime behavior.
- Stop before replacing localStorage save/load.
- Stop before migration preview.
- Stop before migration writes.
- Stop before launch.

## 14. Remaining Blocked Actions
- Creating Supabase client code
- Modifying app behavior
- Running migration preview
- Running migration writes
- Moving real customer/project/estimate/invoice/payment data
- Launching production

## 15. Exact Next Gate
After this planning document is created and saved, the next gate is runtime wiring implementation approval. That future approval may allow tightly scoped source changes for a browser-safe Supabase client and runtime env validation only. Backend data adapter, migration preview, migration writes, and launch must remain blocked unless separately approved.
