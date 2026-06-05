# Supabase Backend V1 Credentials / Env Handling Approval V1

## 1. Summary

This document records that credentials/env handling is approved as the next controlled phase only.
It does not add credentials, env files, Supabase client code, runtime wiring, migration preview, migration writes, or launch approval.

## 2. Approval Status

- Credentials / env handling: Approved as the next controlled phase only
- Runtime wiring: Not approved
- Migration preview: Not approved
- Migration writes: Not approved
- Production launch: Not approved

## 3. Current Production Backend Status

- Production Supabase project exists
- Production SQL package deployed successfully
- Production table creation verified
- RLS enabled on all EstiPaid tables verified
- Policies verified
- Authenticated grants verified
- No runtime wiring exists
- No credentials have been added to the repo

## 4. Approved Credentials / Env Handling Scope

- Define how production Supabase credentials will be handled safely
- Define which credentials are allowed for frontend/runtime use
- Define where allowed public runtime variables may eventually be stored
- Define which credentials are permanently blocked from frontend/runtime use
- Define hard stops before any env files or runtime wiring are created

## 5. Explicit Exclusions

- Adding credentials to the repo
- Adding env files
- Wiring EstiPaid runtime to Supabase
- Creating Supabase client code
- Running migration preview
- Running migration writes
- Moving real customer/project/estimate/invoice/payment data
- Launching production

## 6. Allowed Future Frontend Runtime Values

- Supabase project URL may be considered for frontend runtime configuration later
- Supabase anon public key may be considered for frontend runtime configuration later
- Even public runtime values must not be added until the env implementation gate is explicitly approved

## 7. Permanently Blocked Secrets

- Production database password
- Production database connection string
- Service-role key
- JWT secret
- Access tokens
- Any secret-bearing auth token

These values must never be committed, and the service-role key must never be used in frontend/browser code.

## 8. Storage Rules

- No `.env`, `.env.local`, `.env.production`, or `.env.example` files are to be created yet
- Any future env files must be treated as controlled assets and kept out of git history
- `.gitignore` must protect env files before any env files are created

## 9. Git / Repo Safety Rules

- Do not commit production credentials
- Do not commit public runtime variables until the env implementation gate is explicitly approved
- Do not create Supabase client files
- Do not add secrets to docs or source
- Do not use production values in repo files

## 10. Vercel Environment Variable Rules

- Vercel environment variables may be used later only after approval
- Vercel variables must not be introduced until the env implementation gate is approved
- Vercel must not receive any secret values in frontend-accessible context

## 11. Local Development Environment Rules

- Local `.env.local` may be used later only after approval
- Local env handling must be defined before any env files are created
- Local env handling must not expose secrets to the frontend bundle

## 12. Hard Stops Before Implementation

- Stop before creating any env file
- Stop before adding any credentials
- Stop before adding any Supabase client code
- Stop before wiring runtime code
- Stop before migration preview
- Stop before migration writes
- Stop before launch

## 13. Remaining Blocked Actions

- Adding credentials
- Adding env files
- Wiring EstiPaid runtime to Supabase
- Creating Supabase client code
- Running migration preview
- Running migration writes
- Moving real customer/project/estimate/invoice/payment data
- Launching production

## 14. Exact Next Gate

- After this document is created and saved, the next gate is env safety implementation planning
- Runtime wiring remains blocked until env safety implementation is approved and completed

