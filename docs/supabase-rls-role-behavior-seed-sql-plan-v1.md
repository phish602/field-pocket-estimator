# Supabase RLS Role Behavior Seed SQL Plan V1

This is a planning/document-only artifact.
No SQL is being executed.
No SQL is being deployed.
No runtime wiring is being added.
No backend writes are being added.
No credentials are being added.
This plan is for the disposable non-production project only: `estipaid-backend-v1-dryrun`.
Project URL identifier only: `https://otdwufeqcblinzcvtbjc.supabase.co`

## 1. Summary

This plan defines placeholder-based seed SQL for manual role-behavior testing in the disposable Supabase dry-run project.
It supports owner, admin, member, viewer, and outsider verification plus cross-company isolation checks.
Production wiring remains blocked until the role-behavior tests pass.

## 2. Safety Rules

- Use placeholder UUIDs only
- Replace placeholders manually in Supabase SQL Editor before execution
- Do not commit real user IDs, passwords, JWTs, or secrets
- Do not commit production credentials
- Do not use this plan against production
- Do not wire EstiPaid to Supabase from this document
- Do not modify localStorage behavior
- Do not modify PDF/export behavior
- Do not modify AI Assist behavior
- Do not modify save/load flows
- Keep the seed project disposable and isolated

## 3. Required Manual Supabase Auth Users

- Owner test user
- Admin test user
- Member test user
- Viewer test user
- Outsider test user

## 4. Placeholder Values to Collect Locally Only

- `<OWNER_AUTH_USER_ID>`
- `<ADMIN_AUTH_USER_ID>`
- `<MEMBER_AUTH_USER_ID>`
- `<VIEWER_AUTH_USER_ID>`
- `<OUTSIDER_AUTH_USER_ID>`
- `<TEST_COMPANY_ID>`
- `<SECOND_COMPANY_ID>`
- `<OWNER_EMAIL_FAKE>`
- `<ADMIN_EMAIL_FAKE>`
- `<MEMBER_EMAIL_FAKE>`
- `<VIEWER_EMAIL_FAKE>`
- `<OUTSIDER_EMAIL_FAKE>`

## 5. Seed Order

1. Create test company
2. Create company_users role assignments
3. Seed customer
4. Seed project
5. Seed estimate
6. Seed estimate_line_item
7. Seed invoice
8. Seed invoice_line_item
9. Seed invoice_payment
10. Seed scope_template
11. Seed app_settings rows
12. Seed audit_event
13. Seed migration_batch
14. Seed migration_write_result
15. Seed second company for isolation checks

## 6. Company Seed SQL Template

```sql
-- Replace placeholders manually before execution in the disposable non-production project.
insert into public.companies (
  id,
  name,
  created_at,
  updated_at
) values (
  '<TEST_COMPANY_ID>',
  'EstiPaid Dry Run Test Company',
  now(),
  now()
);
```

## 7. company_users Role Assignment SQL Template

```sql
-- Replace placeholders manually before execution in the disposable non-production project.
insert into public.company_users (
  id,
  company_id,
  user_id,
  role,
  status,
  invited_at,
  joined_at,
  created_at,
  updated_at
) values
  (gen_random_uuid(), '<TEST_COMPANY_ID>', '<OWNER_AUTH_USER_ID>', 'owner', 'active', now(), now(), now(), now()),
  (gen_random_uuid(), '<TEST_COMPANY_ID>', '<ADMIN_AUTH_USER_ID>', 'admin', 'active', now(), now(), now(), now()),
  (gen_random_uuid(), '<TEST_COMPANY_ID>', '<MEMBER_AUTH_USER_ID>', 'member', 'active', now(), now(), now(), now()),
  (gen_random_uuid(), '<TEST_COMPANY_ID>', '<VIEWER_AUTH_USER_ID>', 'viewer', 'active', now(), now(), now(), now());

-- No company_users row is created for <OUTSIDER_AUTH_USER_ID>.
```

## 8. Business Record Seed SQL Template

```sql
-- Replace placeholders manually before execution in the disposable non-production project.
insert into public.customers (
  id, company_id, display_name, company_name, contact_name, phone, email, customer_type, customer_status, created_at, updated_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  'Dry Run Customer',
  'Dry Run Customer LLC',
  'Test Contact',
  '555-0100',
  'dryrun-customer@example.com',
  'commercial',
  'active',
  now(),
  now()
);

insert into public.projects (
  id, company_id, customer_id, project_number, project_name, status, created_at, updated_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  (select id from public.customers where company_id = '<TEST_COMPANY_ID>' limit 1),
  'PRJ-1001',
  'Dry Run Project',
  'draft',
  now(),
  now()
);

insert into public.estimates (
  id, company_id, customer_id, project_id, estimate_number, status, document_type, created_at, updated_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  (select id from public.customers where company_id = '<TEST_COMPANY_ID>' limit 1),
  (select id from public.projects where company_id = '<TEST_COMPANY_ID>' limit 1),
  'EST-1001',
  'draft',
  'estimate',
  now(),
  now()
);

insert into public.estimate_line_items (
  id, company_id, estimate_id, sort_order, description, quantity, unit, unit_price, total_price, created_at, updated_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  (select id from public.estimates where company_id = '<TEST_COMPANY_ID>' limit 1),
  1,
  'Dry run estimate line item',
  1,
  'each',
  100.00,
  100.00,
  now(),
  now()
);

insert into public.invoices (
  id, company_id, customer_id, project_id, estimate_id, invoice_number, status, payment_status, invoice_date, total_amount, amount_paid, balance_remaining, created_at, updated_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  (select id from public.customers where company_id = '<TEST_COMPANY_ID>' limit 1),
  (select id from public.projects where company_id = '<TEST_COMPANY_ID>' limit 1),
  (select id from public.estimates where company_id = '<TEST_COMPANY_ID>' limit 1),
  'INV-1001',
  'draft',
  'unpaid',
  current_date,
  100.00,
  0.00,
  100.00,
  now(),
  now()
);

insert into public.invoice_line_items (
  id, company_id, invoice_id, sort_order, description, quantity, unit, unit_price, total_price, created_at, updated_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  (select id from public.invoices where company_id = '<TEST_COMPANY_ID>' limit 1),
  1,
  'Dry run invoice line item',
  1,
  'each',
  100.00,
  100.00,
  now(),
  now()
);

insert into public.invoice_payments (
  id, company_id, invoice_id, amount, method, status, paid_at, payment_reference, notes, created_at, updated_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  (select id from public.invoices where company_id = '<TEST_COMPANY_ID>' limit 1),
  25.00,
  'cash',
  'recorded',
  now(),
  'PAY-1001',
  'Dry run payment',
  now(),
  now()
);

insert into public.scope_templates (
  id, company_id, name, scope_text, template_type, created_at, updated_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  'Dry Run Scope Template',
  'This is a fake scope template for role-behavior testing.',
  'company',
  now(),
  now()
);
```

## 9. App Settings Seed SQL Template

```sql
-- Replace placeholders manually before execution in the disposable non-production project.
insert into public.app_settings (
  id, company_id, user_id, setting_scope, setting_key, setting_value, created_at, updated_at
) values
  (gen_random_uuid(), '<TEST_COMPANY_ID>', null, 'company', 'default_invoice_terms', to_jsonb('Net 30'::text), now(), now()),
  (gen_random_uuid(), '<TEST_COMPANY_ID>', '<MEMBER_AUTH_USER_ID>', 'user', 'sidebar_state', to_jsonb('collapsed'::text), now(), now());
```

## 10. Audit / Migration Seed SQL Template

```sql
-- Replace placeholders manually before execution in the disposable non-production project.
insert into public.audit_events (
  id, company_id, actor_id, event_type, entity_type, entity_id, payload, created_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  '<OWNER_AUTH_USER_ID>',
  'dry_run_seeded',
  'company',
  '<TEST_COMPANY_ID>',
  jsonb_build_object('note', 'Dry run audit event'),
  now()
);

insert into public.migration_batches (
  id, company_id, migration_batch_id, status, started_at, completed_at, notes, created_at, updated_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  'mig_20260604_120000_test',
  'previewed',
  now(),
  now(),
  'Dry run migration batch',
  now(),
  now()
);

insert into public.migration_write_results (
  id, company_id, migration_batch_id, entity_type, legacy_local_id, backend_id, action, status, error_reason, attempted_payload, created_at
) values (
  gen_random_uuid(),
  '<TEST_COMPANY_ID>',
  (select id from public.migration_batches where company_id = '<TEST_COMPANY_ID>' limit 1),
  'customer',
  'legacy-customer-1',
  (select id from public.customers where company_id = '<TEST_COMPANY_ID>' limit 1),
  'insert',
  'success',
  null,
  jsonb_build_object('note', 'Dry run migration result'),
  now()
);
```

## 11. Second-Company Isolation Seed SQL Template

```sql
-- Replace placeholders manually before execution in the disposable non-production project.
insert into public.companies (
  id,
  name,
  created_at,
  updated_at
) values (
  '<SECOND_COMPANY_ID>',
  'EstiPaid Dry Run Second Company',
  now(),
  now()
);

-- Assign a separate owner to the second company if needed.
-- Do not reuse <OWNER_AUTH_USER_ID> unless cross-company membership testing is intentional.
```

## 12. Cleanup / Reset Notes for Disposable Project Only

- Treat this project as disposable
- Drop or truncate only in the disposable non-production project if a reset is needed
- Do not run cleanup against production
- Do not commit cleanup credentials or scripts
- Recreate seed data from this plan if the disposable project is reset

## 13. What Not to Commit

- Real user IDs
- Real passwords
- Real JWTs
- Real API keys
- Real connection strings
- Real project secrets
- Production identifiers
- App wiring code
- LocalStorage migration code

## 14. How This Supports the Role Execution Checklist

This seed SQL plan provides the placeholder-based inserts needed by the manual role-behavior execution checklist.
It prepares data for owner, admin, member, viewer, and outsider verification plus cross-company isolation checks.

## 15. Production Approval Gate

- Production wiring remains blocked until role-behavior tests pass
- This document does not approve production deployment
- Replace placeholders manually before any non-production execution

## 16. Exact Next Step

- Use this plan only in the disposable non-production project after manually replacing placeholders in Supabase SQL Editor

