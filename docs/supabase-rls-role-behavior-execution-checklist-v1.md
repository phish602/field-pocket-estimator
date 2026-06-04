# Supabase RLS Role Behavior Execution Checklist V1

This checklist is for manual execution against the already-created non-production schema.
No secrets are included.
No runtime wiring is being added.
No production wiring is approved here.
Production wiring remains blocked until all required checks pass.

## 1. Safety Pre-Checks

- Confirm the project is the disposable non-production Supabase dry-run project
- Confirm the project is not production
- Confirm no production credentials are being used
- Confirm no frontend runtime wiring exists
- Confirm localStorage migration is not being attempted
- Confirm PDF/export behavior is not being modified
- Confirm AI Assist behavior is not being modified
- Confirm save/load flows are not being modified
- Confirm the schema dry-run previously passed with conditions
- Confirm the authenticated role behavior test plan is available

## 2. Test-User Creation Checklist

- [ ] Create owner test user
- [ ] Create admin test user
- [ ] Create member test user
- [ ] Create viewer test user
- [ ] Create outsider test user with no company membership

## 3. Seed Company Checklist

- [ ] Create one test company
- [ ] Record the company identifier in a safe placeholder format
- [ ] Confirm the company is isolated from any production data

## 4. Seed `company_users` Role Assignments

- [ ] Insert owner role row
- [ ] Insert admin role row
- [ ] Insert member role row
- [ ] Insert viewer role row
- [ ] Confirm each row is `active`
- [ ] Confirm outsider has no membership row

## 5. Seed Business Records Checklist

- [ ] Seed one customer
- [ ] Seed one project
- [ ] Seed one estimate
- [ ] Seed one estimate line item
- [ ] Seed one invoice
- [ ] Seed one invoice line item
- [ ] Seed one invoice payment
- [ ] Seed one scope template
- [ ] Seed one company-scoped app_settings row
- [ ] Seed one user-scoped app_settings row
- [ ] Seed one audit event
- [ ] Seed one migration batch
- [ ] Seed one migration write result

## 6. Owner Test Cases

| Test | Action | Expected | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| Owner reads company record | Select company row | Pass |  |  |
| Owner updates company record | Update company row | Pass |  |  |
| Owner reads customers | Select customer row | Pass |  |  |
| Owner updates operational record | Update project / estimate / invoice | Pass |  |  |
| Owner manages company_users | Insert / update / delete membership row | Pass |  |  |
| Owner manages migration records | Read / insert / update migration batch/result | Pass |  |  |
| Owner reads app_settings company scope | Select company-scoped settings | Pass |  |  |
| Owner writes app_settings company scope | Update company-scoped settings | Pass |  |  |
| Owner writes own app_settings user scope | Update own user-scoped settings | Pass |  |  |

## 7. Admin Test Cases

| Test | Action | Expected | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| Admin reads company record | Select company row | Pass |  |  |
| Admin updates company record | Update company row | Pass |  |  |
| Admin updates operational record | Update project / estimate / invoice | Pass |  |  |
| Admin manages company_users | Insert / update / delete membership row | Pass |  |  |
| Admin manages migration records | Read / insert / update migration batch/result | Pass |  |  |
| Admin reads app_settings company scope | Select company-scoped settings | Pass |  |  |
| Admin writes app_settings company scope | Update company-scoped settings | Pass |  |  |
| Admin writes own app_settings user scope | Update own user-scoped settings | Pass |  |  |

## 8. Member Test Cases

| Test | Action | Expected | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| Member reads company record | Select company row | Pass |  |  |
| Member reads customers | Select customer row | Pass |  |  |
| Member writes allowed operational records | Insert / update customer, project, estimate, invoice, line items, payment where policy allows | Pass |  |  |
| Member manages company_users | Insert / update / delete membership row | Fail |  |  |
| Member manages migration records | Read / insert / update migration batch/result | Fail |  |  |
| Member reads app_settings company scope | Select company-scoped settings | Pass |  |  |
| Member writes app_settings company scope | Update company-scoped settings | Fail by default |  |  |
| Member writes own app_settings user scope | Update own user-scoped settings | Pass, if allowed by policy |  |  |

## 9. Viewer Test Cases

| Test | Action | Expected | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| Viewer reads company record | Select company row | Pass |  |  |
| Viewer reads customers | Select customer row | Pass |  |  |
| Viewer reads app_settings company scope | Select company-scoped settings | Pass |  |  |
| Viewer reads own app_settings user scope | Select own user-scoped settings | Pass, if allowed by policy |  |  |
| Viewer inserts operational records | Insert customer / project / estimate / invoice | Fail |  |  |
| Viewer updates operational records | Update customer / project / estimate / invoice | Fail |  |  |
| Viewer deletes operational records | Delete customer / project / estimate / invoice | Fail |  |  |
| Viewer manages company_users | Insert / update / delete membership row | Fail |  |  |
| Viewer manages migration records | Read / insert / update migration batch/result | Fail |  |  |

## 10. Outsider Test Cases

| Test | Action | Expected | Pass/Fail | Notes |
| --- | --- | --- | --- | --- |
| Outsider reads company row | Select company row | Fail |  |  |
| Outsider reads customer row | Select customer row | Fail |  |  |
| Outsider inserts company-scoped record | Insert customer / project / estimate / invoice | Fail |  |  |
| Outsider updates company-scoped record | Update customer / project / estimate / invoice | Fail |  |  |
| Outsider deletes company-scoped record | Delete customer / project / estimate / invoice | Fail |  |  |
| Outsider reads app_settings company scope | Select company-scoped settings | Fail |  |  |
| Outsider reads app_settings user scope | Select user-scoped settings | Fail |  |  |
| Outsider manages migration records | Read / insert / update migration batch/result | Fail |  |  |

## 11. DELETE Denial Checks

- [ ] `company_users` DELETE allowed only for owner/admin policy
- [ ] `customers` DELETE rejected through app-user RLS path
- [ ] `projects` DELETE rejected through app-user RLS path
- [ ] `estimates` DELETE rejected through app-user RLS path
- [ ] `invoices` DELETE rejected through app-user RLS path
- [ ] `invoice_payments` DELETE rejected through app-user RLS path
- [ ] `audit_events` DELETE rejected through app-user RLS path
- [ ] `migration_batches` DELETE rejected through app-user RLS path
- [ ] `migration_write_results` DELETE rejected through app-user RLS path

## 12. Cross-Company Isolation Checks

- [ ] Create a second company or outsider-owned company if practical
- [ ] Verify owner/admin/member from company A cannot read company B records
- [ ] Verify owner/admin/member from company A cannot modify company B records
- [ ] Verify outsider cannot read or modify any company-scoped records
- [ ] Verify app_settings do not leak across companies

## 13. App Behavior Mapping Checks

- [ ] Customer removal maps to `archived_at` / `archived_by`
- [ ] Project archive maps to `status = archived` plus `archived_at` / `archived_by`
- [ ] Estimate cancellation maps to `status = lost` plus optional archive fields
- [ ] Invoice cancellation maps to `status = void` plus optional archive fields
- [ ] Payment correction preserves the original record and uses correction/reversal later
- [ ] Audit events remain append-only from the app perspective

## 14. Failure Recording Format

- Test case:
- Role:
- Table:
- Action attempted:
- Expected result:
- Actual result:
- Pass / fail:
- Notes:

## 15. Pass/Fail Summary Table

| Area | Result | Notes |
| --- | --- | --- |
| Safety pre-checks |  |  |
| Owner tests |  |  |
| Admin tests |  |  |
| Member tests |  |  |
| Viewer tests |  |  |
| Outsider tests |  |  |
| DELETE denial checks |  |  |
| Cross-company isolation |  |  |
| App behavior mapping |  |  |

## 16. Production Approval Gate

- Production wiring remains blocked until all required checks pass
- This checklist does not approve production deployment
- Authenticated RLS behavior must pass for all required roles before production wiring is allowed

## 17. Exact Next Step After Execution

- Record the results in a dry-run role-behavior report and then decide whether production wiring may proceed

## Non-Goals

- No source/runtime file changes
- No SQL execution in this document
- No Supabase deployment
- No credentials
- No runtime auth wiring
- No localStorage migration
- No backend writes
- No UI changes
