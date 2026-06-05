# Supabase Backend V1 Production Project Setup Approval V1

## 1. Summary

This document records that production project setup is approved as the next controlled phase only.
It does not approve credentials, runtime wiring, migration preview, migration writes, or production launch.

## 2. Approval Status

- Production project setup: Approved as the next controlled phase only
- Credentials: Not approved
- Runtime wiring: Not approved
- Migration preview: Not approved
- Migration writes: Not approved
- Production launch: Not approved

## 3. Approved Scope

- Create and configure a real production Supabase project for EstiPaid backend V1
- Use the production setup runbook as the controlling process
- Deploy the approved SQL package to the production project after project creation
- Verify production schema, RLS, policies, and authenticated grants after deployment

## 4. Explicit Exclusions

- Adding credentials to the repo
- Adding env files
- Wiring EstiPaid runtime to Supabase
- Creating Supabase client code
- Running local-to-backend migration preview
- Running local-to-backend migration writes
- Moving real customer/project/estimate/invoice/payment data
- Launching production

## 5. Required Controlling Documents

- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-production-readiness-index.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-production-go-no-go-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-production-setup-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-security-review-runbook.md`
- `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-backend-v1-dry-run-approval-gate-report.md`

## 6. Production Setup Requirements

- Production project must be separate from the disposable dry-run project
- Confirm production region before project creation
- Do not connect GitHub unless explicitly approved later
- Data API may be enabled
- Automatic table exposure should be disabled where applicable
- RLS must be enabled and verified immediately after schema creation
- SQL must be copied only from `/Users/adrianvalenzuela/field-pocket-estimator/docs/supabase-executable-migration-package-draft-v1.sql`
- Do not use old Supabase SQL history

## 7. Post-Setup Verification Requirements

- Verify table creation
- Verify RLS enabled
- Verify policies visible
- Verify authenticated grants
- Confirm no TRUNCATE, TRIGGER, or REFERENCES grants exist for authenticated
- Confirm DELETE exists only on `company_users`
- Confirm `audit_events` is SELECT/INSERT only
- Confirm production schema, RLS, and grants match the dry-run expectations

## 8. Hard Stops After Project Setup

- Stop before adding credentials
- Stop before env setup
- Stop before runtime wiring
- Stop before migration preview
- Stop before migration writes
- Stop before launch

## 9. Remaining Blocked Actions

- Adding credentials
- Runtime wiring
- Migration preview
- Migration writes
- Launching production

## 10. Exact Next Step

- Complete production project setup using the production setup runbook, then stop at the hard stops until the next explicit approval is given

