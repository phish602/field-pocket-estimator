# Supabase Backend V1 Env Safety Implementation Plan V1

## 1. Summary

This is a planning-only document.
It defines the safe implementation plan for repository and environment protection before any env files, Supabase client code, or runtime wiring are created.
No credentials, env files, runtime wiring, migration, or launch are approved in this pass.

## 2. Planning Status

- Credentials / env handling approval exists
- Production backend exists and has been verified
- No runtime wiring exists
- No credentials have been added to the repo
- No env files have been added

## 3. Current Production Backend Status

- Production Supabase project exists
- Production SQL package deployed successfully
- Production table creation verified
- RLS enabled on all EstiPaid tables verified
- Policies verified
- Authenticated grants verified
- Credentials / env handling approval record exists

## 4. Approved Planning Scope

- Verify `.gitignore` protects env files
- Create a sanitized `.env.example` later with placeholder-only values
- Define allowed public frontend runtime variable names
- Define blocked secret variable names
- Define local-only `.env.local` handling rules
- Define Vercel environment variable handling rules
- Define validation steps before runtime wiring
- Define hard stops before any Supabase client or runtime code is created

## 5. Explicit Exclusions

- No credentials or env files are created in this pass
- No Supabase client files are created in this pass
- No runtime wiring is added in this pass
- No migration code is added in this pass
- No launch approval is given in this pass

## 6. Allowed Future Frontend Runtime Variables

- `REACT_APP_SUPABASE_URL`
- `REACT_APP_SUPABASE_ANON_KEY`

These are public frontend runtime values only and must not be populated in this planning pass.

## 7. Permanently Blocked Secrets

- Supabase service-role key
- Database password
- Database connection string
- JWT secret
- Access tokens
- Refresh tokens
- Any secret-bearing auth token
- Any private key
- Any admin key

## 8. Future `.gitignore` Requirements

Future gitignore protection should cover:

- `.env`
- `.env.local`
- `.env.development.local`
- `.env.test.local`
- `.env.production.local`
- `.env*.local`
- Secret backup files such as `*.env.backup` or `*.secrets`

## 9. Future `.env.example` Requirements

The future `.env.example` may contain placeholder-only values such as:

```text
REACT_APP_SUPABASE_URL=replace_with_supabase_project_url
REACT_APP_SUPABASE_ANON_KEY=replace_with_supabase_anon_public_key
```

It must never contain:

- Real Supabase URL if treating the project URL as private during setup
- Real anon key
- Service-role key
- Database password
- Database connection string
- JWT secret
- Access token
- Refresh token
- Any private or admin key

## 10. Local `.env.local` Rules

- `.env.local` may be used later only after approval
- `.env.local` must remain local-only and uncommitted
- `.env.local` must never contain secrets that should not reach the frontend bundle
- `.env.local` must be protected by gitignore before use

## 11. Vercel Environment Variable Rules

- Vercel environment variables may be used later only after approval
- Vercel variables must be handled as controlled deployment-time configuration
- Vercel must not receive secret values in frontend-accessible form

## 12. Validation Checklist Before Runtime Wiring

- [ ] `.gitignore` protects env files
- [ ] `.env.example` contains placeholder-only values
- [ ] Only `REACT_APP_SUPABASE_URL` and `REACT_APP_SUPABASE_ANON_KEY` are defined for future frontend runtime use
- [ ] No blocked secrets are present in repo files
- [ ] No env file exists with real secrets
- [ ] No Supabase client code has been created
- [ ] Runtime wiring remains blocked until the env implementation gate is approved

## 13. Hard Stops

- Any secret committed to the repo
- Any `.env` file with real credentials
- Any Supabase client code before approval
- Any runtime wiring before env protection is implemented
- Any migration code introduced in this phase

## 14. Remaining Blocked Actions

- Adding credentials
- Adding env files
- Wiring EstiPaid runtime to Supabase
- Creating Supabase client code
- Running migration preview
- Running migration writes
- Moving real customer/project/estimate/invoice/payment data
- Launching production

## 15. Exact Next Gate

- After this planning document is created and saved, the next gate is env safety implementation approval
- That future gate may allow `.gitignore` review/update and sanitized `.env.example` creation only
- Runtime wiring remains blocked

