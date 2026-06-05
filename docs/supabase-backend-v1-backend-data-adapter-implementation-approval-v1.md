# Supabase Backend V1 Backend Data Adapter Implementation Approval V1

## 1. Summary
This is a docs-only approval record for the next controlled implementation phase of backend data adapter scaffolding for EstiPaid. It approves only tightly scoped adapter scaffolding and tests. It does not execute implementation in this pass and does not approve active UI save/load switching, production reads/writes from app workflows, migration preview, migration writes, real data movement, or production launch.

## 2. Approval Status
Approved as the next controlled implementation phase only:
- Add backend data adapter scaffolding.
- Add adapter and mapping functions under source files only as needed.
- Use the existing browser-safe Supabase client only.
- Add safe guards when Supabase is not configured.
- Keep localStorage as the active save/load path.
- Keep app workflows unchanged.
- Add focused tests for adapter behavior and mapping behavior.
- Do not connect active UI save/load to Supabase.
- Do not perform production reads/writes from app workflows.
- Do not run migration preview.
- Do not run migration writes.
- Do not move real data.
- Do not launch production.

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

## 5. Approved Implementation Scope
- Create adapter scaffolding under src/lib and/or src/utils.
- Add adapter behavior tests.
- Add mapping behavior tests where practical.
- Use fake/mock Supabase client behavior in tests.
- Support safe unconfigured fallback behavior.
- Keep adapter functions callable but not wired into active UI workflows.
- Keep production data operations dormant unless explicitly invoked by future approved gates.

## 6. Approved Future Source Categories
- src/lib/**
- src/utils/**
- tests for adapter and mapper behavior

## 7. Future Adapter Entity Coverage
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

## 8. Explicit Exclusions
- Replacing localStorage save/load.
- Connecting active UI save/load to Supabase.
- Automatically syncing data.
- Running production reads on app load.
- Running production writes from app workflows.
- Creating auth/session UX.
- Creating user onboarding.
- Creating company membership management UI.
- Running migration preview.
- Running migration writes.
- Moving real customer/project/estimate/invoice/payment data.
- Launching production.

## 9. LocalStorage Preservation Rules
- localStorage remains the active save/load path.
- This approval does not allow replacing or modifying active localStorage workflow behavior.
- Adapter scaffolding must not silently switch save/load behavior.
- Any save/load switching requires a separate explicit approval gate.

## 10. Production Data Safety Rules
- Adapter scaffolding must use only browser-safe client patterns.
- No service-role, secret, admin, database, JWT, token, private key, or connection-string credentials are allowed.
- No real production business data reads are approved in this scope.
- No real production business data writes are approved in this scope.
- No real customer/business data movement is approved in this scope.
- No real credentials or secrets may be committed.

## 11. Migration Safety Rules
- Migration preview remains blocked.
- Migration writes remain blocked.
- No migration execution behavior is approved in this scope.
- Real data movement through migration remains blocked until separate approvals.

## 12. Testing Requirements
- Tests must use fake/mock data only.
- Tests must not require real Supabase credentials.
- Tests must not require production Supabase network calls.
- Tests must verify safe behavior when Supabase is not configured.
- Tests must verify adapter scaffolding does not throw on import.
- Tests must verify no active UI workflow behavior is changed where practical.

## 13. Validation Requirements
For the future implementation execution pass:
- Run npm test -- --watchAll=false.
- Run npm run build.
- Run git diff --check.
- Confirm no real credentials or secrets are committed.
- Confirm no active UI save/load switching was added.
- Confirm no migration preview or migration writes were added.
- Confirm no production data movement was added.

## 14. Hard Stops
- Stop before replacing localStorage save/load.
- Stop before connecting active UI workflows to Supabase save/load.
- Stop before any production reads/writes from app workflows.
- Stop before migration preview.
- Stop before migration writes.
- Stop before real data movement.
- Stop before launch.
- Stop before adding credentials or secrets.

## 15. Remaining Blocked Actions
- Active UI save/load switching to Supabase
- Replacing or modifying localStorage save/load behavior
- Production business data reads from app workflows
- Production business data writes from app workflows
- Migration preview execution
- Migration write execution
- Real customer/project/estimate/invoice/payment data movement
- Production launch

## 16. Exact Next Gate
After this document is created and saved, the next gate is backend data adapter implementation execution. That future pass may make tightly scoped source/test changes for adapter scaffolding only. Active UI save/load switching, migration preview, migration writes, real data movement, and production launch remain blocked unless separately approved.
