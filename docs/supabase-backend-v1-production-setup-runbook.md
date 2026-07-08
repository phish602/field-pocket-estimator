# Supabase Backend V1 Production Setup Runbook

## 1. Summary

This runbook defines the future manual setup sequence for a production Supabase project after explicit approval.
It is not approval to create production.
Production Supabase setup remains blocked until explicitly approved.

## 2. Current Status

- Disposable Supabase backend V1 dry-run/security verification has passed
- Production remains blocked
- Production wiring remains blocked after schema deployment until schema/RLS/grants are verified in production
- Local-to-backend migration remains blocked until backup/export, rollback, migration preview, and explicit approval are complete

## 3. Required Approval Before Using This Runbook

- Production readiness checklist must be reviewed and approved first
- This runbook may only be used after explicit approval
- This runbook is a future setup sequence, not an approval record

## 4. Production Project Creation Sequence

1. Create a brand-new production Supabase project separate from the disposable dry-run project
2. Confirm the production region before creation
3. Do not connect GitHub unless explicitly approved
4. Data API may be enabled
5. Disable automatic table exposure where applicable
6. Confirm RLS will be enabled and verified immediately after schema creation

## 5. Production Project Configuration Checklist

- Confirm the production project is separate from the disposable dry-run project
- Confirm the production region before creation
- Confirm automatic table exposure is disabled where applicable
- Confirm RLS is enabled or manually verified immediately after schema creation
- Confirm the production project will use only approved SQL/doc artifacts

## 6. SQL Package Deployment Sequence

1. Copy SQL only from `docs/supabase-executable-migration-package-draft-v1.sql`
2. Do not use old Supabase SQL history
3. Review the SQL package before execution
4. Execute schema and RLS SQL only after approval
5. Do not wire the app during schema deployment

## 7. Post-Deployment Verification Queries

Run these checks after schema deployment:

```sql
select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'companies','company_users','customers','projects','estimates',
    'estimate_line_items','invoices','invoice_line_items','invoice_payments',
    'scope_templates','app_settings','audit_events','migration_batches',
    'migration_write_results'
  )
order by table_name;
```

```sql
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in (
    'companies','company_users','customers','projects','estimates',
    'estimate_line_items','invoices','invoice_line_items','invoice_payments',
    'scope_templates','app_settings','audit_events','migration_batches',
    'migration_write_results'
  )
order by tablename;
```

```sql
select schemaname, tablename, policyname
from pg_policies
where schemaname = 'public'
  and tablename in (
    'companies','company_users','customers','projects','estimates',
    'estimate_line_items','invoices','invoice_line_items','invoice_payments',
    'scope_templates','app_settings','audit_events','migration_batches',
    'migration_write_results'
  )
order by tablename, policyname;
```

```sql
select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'authenticated'
  and table_schema = 'public'
order by table_name, privilege_type;
```

## 8. Authenticated Grant Verification

Expected authenticated grant conclusion:

- no TRUNCATE
- no TRIGGER
- no REFERENCES
- DELETE only on `company_users`
- `audit_events` limited to SELECT and INSERT

## 9. RLS Verification

- Confirm RLS is enabled on all EstiPaid tables
- Confirm policies are visible
- Confirm row-level behavior matches the reviewed schema/RLS docs

## 10. Credentials Handling Rules

- Add credentials only after schema, RLS, and grant verification are explicitly approved
- Use server-only handling for any future service-role key
- Do not commit passwords, tokens, JWTs, connection strings, or service-role keys

## 11. Runtime Wiring Hard Stop

- Stop after production schema/grant verification before app credentials are added
- Do not wire the React app until schema/RLS/grants are verified in production
- Do not add frontend runtime wiring from this runbook step

## 12. Data Migration Hard Stop

- Stop before any local data migration
- Do not migrate localStorage data until backup/export, rollback, migration preview, and explicit approval are complete

## 13. Backup / Export Hard Stop

- Do not begin any production migration until a backup/export plan is in place and approved

## 14. Rollback / Recovery Hard Stop

- Do not begin any production migration until a rollback/recovery plan is approved and documented

## 15. Go / No-Go Checkpoints

- Go for production project setup only after explicit approval
- No-go for app wiring until production schema/RLS/grants are verified
- No-go for data migration until backup/export, rollback, migration preview, and explicit approval are complete
- No-go for production launch until runtime wiring and app smoke tests pass

## 16. Non-Goals

- No approval to create production
- No production deployment authorization
- No runtime auth implementation
- No UI permission gate implementation
- No backend writes
- No localStorage migration implementation
- No secrets

## 17. Exact Next Step

- Keep production blocked until the production readiness checklist is explicitly approved, then follow this runbook one step at a time
