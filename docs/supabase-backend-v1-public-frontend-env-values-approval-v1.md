# Supabase Backend V1 Public Frontend Env Values Approval V1

## 1. Summary
This is a docs-only approval record for the next controlled phase of handling EstiPaid's real public frontend Supabase values outside the repo. It approves only the safe handling path for the production Supabase project URL and anon public key as public frontend runtime values. It does not approve runtime wiring, migration work, or launch.

## 2. Approval Status
Approved as the next controlled phase only.

## 3. Current Production Backend Status
- Production Supabase project exists.
- Production SQL package deployed successfully.
- Production table creation verified.
- RLS enabled on all EstiPaid tables verified.
- Policies verified.
- Authenticated grants verified.
- Env safety implementation completed.
- `.gitignore` protects env files.
- `.env.example` exists with placeholders only.
- No runtime wiring exists.
- No real credentials or env values have been added to the repo.

## 4. Approved Public Frontend Env Value Handling Scope
- Locate the production Supabase project URL in the Supabase dashboard.
- Locate the production Supabase anon public key in the Supabase dashboard.
- Treat both as public frontend runtime values, not backend secrets.
- Store real values only outside the git repo.
- Use Vercel environment variables later only after implementation execution is approved.
- Use a local uncommitted `.env.local` later only after implementation execution is approved.
- Verify `.env.local` remains ignored before any local real values are created.
- Verify `.env.example` remains placeholder-only.
- Verify runtime wiring remains blocked.

## 5. Allowed Public Frontend Runtime Variables
- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`

## 6. Approved Future Storage Locations
- Vercel project environment variables
- Local uncommitted `.env.local`

## 7. Explicit Exclusions
- Committing the real Supabase URL to the repo
- Committing the real anon key to the repo
- Putting real values in `.env.example`
- Putting real values in docs
- Pasting real values into Codex prompts
- Pasting real values into chat
- Adding a service-role key anywhere in frontend/runtime
- Adding a database password anywhere in frontend/runtime
- Adding a database connection string anywhere in frontend/runtime
- Adding a JWT secret anywhere in frontend/runtime
- Adding access tokens anywhere in frontend/runtime

## 8. Permanently Blocked Secrets
- Supabase service-role key
- Database password
- Database connection string
- JWT secret
- Access tokens
- Refresh tokens
- Any secret-bearing auth token
- Any private key
- Any admin key

## 9. Local `.env.local` Rules
- `.env.local` may only be used later after implementation execution is approved.
- `.env.local` must remain uncommitted.
- `.env.local` must stay ignored by `.gitignore`.
- `.env.local` must not contain any secret-bearing values.
- `.env.local` must not be used to bypass runtime wiring approval.

## 10. Vercel Environment Variable Rules
- Vercel environment variables may only hold the two approved public frontend runtime values.
- Vercel values must be treated as public runtime configuration, not backend secrets.
- Vercel setup must not be used to approve runtime wiring.
- Vercel values must not include any blocked secret material.

## 11. Repo Safety Rules
- Do not commit real public frontend values to the repo.
- Keep `.env.example` placeholder-only.
- Keep `.gitignore` protections intact for env and secret backup files.
- Do not add `.env`, `.env.local`, `.env.production`, or any real env file.
- Do not add Supabase client code.
- Do not modify storage adapters, save/load logic, or migration code.

## 12. Validation Requirements
- Confirm `.env.example` remains placeholder-only.
- Confirm `.gitignore` continues to protect env and secret backup files.
- Confirm no real values are committed.
- Confirm no secrets are added anywhere in the repo.
- Confirm runtime wiring remains blocked.

## 13. Hard Stops
- Stop before adding credentials.
- Stop before creating env files with real values.
- Stop before wiring EstiPaid runtime to Supabase.
- Stop before creating Supabase client code.
- Stop before migration preview.
- Stop before migration writes.
- Stop before launch.

## 14. Remaining Blocked Actions
- Adding real credentials
- Creating env files with real values
- Wiring EstiPaid runtime to Supabase
- Creating Supabase client code
- Running migration preview
- Running migration writes
- Moving real customer/project/estimate/invoice/payment data
- Launching production

## 15. Exact Next Gate
After this document is created and saved, the next gate is public frontend env values implementation execution. That future pass may guide storing real public values in Vercel and/or a local uncommitted `.env.local`, but must not wire runtime code yet. Runtime wiring remains blocked.
