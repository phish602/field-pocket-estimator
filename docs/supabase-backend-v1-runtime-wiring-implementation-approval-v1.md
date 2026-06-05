# Supabase Backend V1 Runtime Wiring Implementation Approval V1

## 1. Summary
This is a docs-only approval record for the next controlled implementation phase of EstiPaid browser-safe Supabase runtime wiring. It approves only the future scope needed to add a browser-safe Supabase client and runtime env validation. It does not implement code in this pass and does not approve backend data adapter work, migration preview, migration writes, real data movement, or production launch.

## 2. Approval Status
Approved as the next controlled implementation phase only.

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

## 5. Approved Implementation Scope
- Add browser-safe Supabase client setup using public frontend runtime env values.
- Read only `REACT_APP_SUPABASE_URL`.
- Read only `REACT_APP_SUPABASE_ANON_KEY`.
- Use only the public project URL and anon/publishable key.
- Add runtime-safe validation/guard behavior if env values are missing.
- Add `@supabase/supabase-js` dependency only if required and not already present.
- Keep localStorage save/load behavior unchanged.
- Keep PDF/export behavior unchanged.
- Keep AI Assist behavior unchanged.
- Keep existing estimate/invoice workflows unchanged.
- Keep backend data adapter work blocked.
- Keep migration preview blocked.
- Keep migration writes blocked.
- Keep launch blocked.

## 6. Approved Future Files/Categories
- Browser-safe Supabase client module
- Small env validation helper
- Package file updates only if `@supabase/supabase-js` must be installed and is not already present

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

## 9. Explicit Exclusions
- Adding real env values to repo files
- Creating `.env.local`
- Creating `.env.production`
- Adding service-role key
- Adding secret key
- Adding database password
- Adding database connection string
- Adding JWT secret
- Adding tokens
- Replacing localStorage save/load
- Creating backend data adapters
- Reading production business data from Supabase
- Writing production business data to Supabase
- Running migration preview
- Running migration writes
- Moving real customer/project/estimate/invoice/payment data
- Launching production

## 10. App Behavior Preservation Rules
- Preserve localStorage save/load behavior.
- Preserve PDF/export behavior.
- Preserve AI Assist behavior.
- Preserve existing estimate/invoice workflows.
- Do not change user-visible workflow behavior beyond the approved browser-safe client and env validation scope.

## 11. Validation Requirements for Future Implementation
- Confirm only allowed public frontend env variable names are used.
- Confirm no real env values are committed.
- Confirm no service-role/secret/admin credentials are referenced.
- Confirm localStorage save/load behavior remains unchanged.
- Confirm PDF/export behavior remains unchanged.
- Confirm AI Assist behavior remains unchanged.
- Confirm no migration preview or migration writes are added.
- Confirm no production data reads/writes are added.
- Run `npm test -- --watchAll=false` if tests exist and are runnable.
- Run `npm run build`.
- Run `git diff --check`.

## 12. Hard Stops
- Stop before adding credentials.
- Stop before creating Supabase client code outside the approved scope.
- Stop before modifying runtime behavior beyond browser-safe client/env validation.
- Stop before replacing localStorage save/load.
- Stop before migration preview.
- Stop before migration writes.
- Stop before launch.

## 13. Remaining Blocked Actions
- Creating backend data adapters
- Modifying save/load behavior beyond the approved scope
- Running migration preview
- Running migration writes
- Moving real customer/project/estimate/invoice/payment data
- Launching production

## 14. Exact Next Gate
After this document is created and saved, the next gate is runtime wiring implementation execution. That future pass may make tightly scoped code/package changes for browser-safe Supabase client setup and env validation only. Backend data adapter, migration preview, migration writes, real data movement, and launch remain blocked.
