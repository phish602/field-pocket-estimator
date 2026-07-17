-- EstiPaid Gate 17A-R — company_entitlement_grants structural verification
--
-- READ-ONLY. This file contains no DDL, no DML, and no destructive statement.
-- It only queries the catalog and returns labeled PASS/FAIL rows.
--
-- Run against production project: aioxfciaflmqiizbzsde
-- Expected: every row reports PASS. Row 13 reports the current grant count,
-- which must be 0 unless a legitimate grant was created outside this gate.

with
-- 1. Table exists and 2. RLS is enabled.
t as (
  select c.oid, c.relrowsecurity
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'company_entitlement_grants'
),
-- 3. Columns: name -> type + nullability.
cols as (
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'company_entitlement_grants'
),
-- 4/5. Constraints, including the foreign key's target and delete rule.
cons as (
  select conname, contype, pg_get_constraintdef(oid) as def
  from pg_constraint
  where conrelid = (select oid from t)
),
-- 6/7. Indexes and their definitions (partiality is visible in the def).
idx as (
  select indexname, indexdef from pg_indexes
  where schemaname = 'public' and tablename = 'company_entitlement_grants'
),
-- 8/9/10/11. Role privileges actually granted on the table.
privs as (
  select grantee, privilege_type
  from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'company_entitlement_grants'
),
-- 12. Any RLS policy and the roles it applies to.
pol as (
  select policyname, roles::text as roles from pg_policies
  where schemaname = 'public' and tablename = 'company_entitlement_grants'
),
results as (
  select 1 as seq, 'table exists' as check_name,
    case when exists (select 1 from t) then 'PASS' else 'FAIL' end as result,
    coalesce((select 'found' from t limit 1), 'missing') as detail

  union all
  select 2, 'RLS enabled',
    case when (select relrowsecurity from t) then 'PASS' else 'FAIL' end,
    coalesce((select relrowsecurity::text from t), 'n/a')

  -- 3. Each column must exist with the expected type and nullability.
  union all
  select 3, 'columns match expected shape',
    case when (
      select count(*) from (values
        ('id','uuid','NO'), ('company_id','uuid','NO'), ('plan','text','NO'),
        ('source','text','NO'), ('starts_at','timestamp with time zone','NO'),
        ('expires_at','timestamp with time zone','YES'),
        ('revoked_at','timestamp with time zone','YES'),
        ('granted_by_user_id','uuid','NO'), ('reason','text','NO'),
        ('revoked_by_user_id','uuid','YES'), ('revoke_reason','text','YES'),
        ('created_at','timestamp with time zone','NO'),
        ('updated_at','timestamp with time zone','NO')
      ) as e(name, typ, nullable)
      join cols c on c.column_name = e.name and c.data_type = e.typ and c.is_nullable = e.nullable
    ) = 13 then 'PASS' else 'FAIL' end,
    (select count(*)::text || ' of 13 expected columns matched' from (values
        ('id','uuid','NO'), ('company_id','uuid','NO'), ('plan','text','NO'),
        ('source','text','NO'), ('starts_at','timestamp with time zone','NO'),
        ('expires_at','timestamp with time zone','YES'),
        ('revoked_at','timestamp with time zone','YES'),
        ('granted_by_user_id','uuid','NO'), ('reason','text','NO'),
        ('revoked_by_user_id','uuid','YES'), ('revoke_reason','text','YES'),
        ('created_at','timestamp with time zone','NO'),
        ('updated_at','timestamp with time zone','NO')
      ) as e(name, typ, nullable)
      join cols c on c.column_name = e.name and c.data_type = e.typ and c.is_nullable = e.nullable)

  union all
  select 4, 'primary key exists',
    case when exists (select 1 from cons where contype = 'p') then 'PASS' else 'FAIL' end,
    coalesce((select conname from cons where contype = 'p' limit 1), 'missing')

  -- 5. FK must target public.companies(id) with ON DELETE CASCADE.
  union all
  select 5, 'companies FK on delete cascade',
    case when exists (
      select 1 from cons where contype = 'f'
        and def ilike '%REFERENCES companies(id)%' and def ilike '%ON DELETE CASCADE%'
    ) then 'PASS' else 'FAIL' end,
    coalesce((select def from cons where contype = 'f' limit 1), 'missing')

  -- 4 (checks). Each named check constraint must be present.
  union all
  select 6, 'all six check constraints exist',
    case when (
      select count(*) from cons where contype = 'c' and conname in (
        'company_entitlement_grants_plan_check',
        'company_entitlement_grants_source_check',
        'company_entitlement_grants_reason_check',
        'company_entitlement_grants_expires_after_starts_check',
        'company_entitlement_grants_revoked_after_starts_check',
        'company_entitlement_grants_revoke_reason_check'
      )) = 6 then 'PASS' else 'FAIL' end,
    (select string_agg(conname, ', ' order by conname) from cons where contype = 'c')

  union all
  select 7, 'plan check restricts to solo/pro/business',
    case when exists (
      select 1 from cons where conname = 'company_entitlement_grants_plan_check'
        and def ilike '%solo%' and def ilike '%pro%' and def ilike '%business%'
    ) then 'PASS' else 'FAIL' end,
    coalesce((select def from cons where conname = 'company_entitlement_grants_plan_check'), 'missing')

  union all
  select 8, 'source check pins internal_comp',
    case when exists (
      select 1 from cons where conname = 'company_entitlement_grants_source_check' and def ilike '%internal_comp%'
    ) then 'PASS' else 'FAIL' end,
    coalesce((select def from cons where conname = 'company_entitlement_grants_source_check'), 'missing')

  -- 6. All three indexes present.
  union all
  select 9, 'all three indexes exist',
    case when (
      select count(*) from idx where indexname in (
        'company_entitlement_grants_company_id_idx',
        'company_entitlement_grants_active_idx',
        'company_entitlement_grants_one_active_per_company_idx'
      )) = 3 then 'PASS' else 'FAIL' end,
    (select string_agg(indexname, ', ' order by indexname) from idx)

  -- 7. The unique index must be UNIQUE and partial on revoked_at is null.
  union all
  select 10, 'one-active-per-company index is unique and partial',
    case when exists (
      select 1 from idx
      where indexname = 'company_entitlement_grants_one_active_per_company_idx'
        and indexdef ilike '%CREATE UNIQUE INDEX%'
        and indexdef ilike '%WHERE (revoked_at IS NULL)%'
    ) then 'PASS' else 'FAIL' end,
    coalesce((select indexdef from idx where indexname = 'company_entitlement_grants_one_active_per_company_idx'), 'missing')

  -- 8/9. Browser roles must hold no privileges at all.
  union all
  select 11, 'anon and authenticated have no privileges',
    case when not exists (select 1 from privs where grantee in ('anon', 'authenticated'))
      then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(grantee || ':' || privilege_type, ', ') from privs where grantee in ('anon','authenticated')), 'none')

  -- 10. service_role must hold exactly SELECT/INSERT/UPDATE.
  union all
  select 12, 'service_role has SELECT, INSERT, UPDATE',
    case when (
      select count(distinct privilege_type) from privs
      where grantee = 'service_role' and privilege_type in ('SELECT','INSERT','UPDATE')
    ) = 3 then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(distinct privilege_type, ', ' order by privilege_type) from privs where grantee = 'service_role'), 'none')

  -- 11. service_role must NOT hold destructive privileges.
  union all
  select 13, 'service_role lacks DELETE/TRUNCATE/REFERENCES/TRIGGER',
    case when not exists (
      select 1 from privs where grantee = 'service_role'
        and privilege_type in ('DELETE','TRUNCATE','REFERENCES','TRIGGER')
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(privilege_type, ', ') from privs
      where grantee = 'service_role' and privilege_type in ('DELETE','TRUNCATE','REFERENCES','TRIGGER')), 'none')

  -- 12. No policy may expose the table to browser roles.
  union all
  select 14, 'no policy grants anon/authenticated access',
    case when not exists (
      select 1 from pol where roles ilike '%anon%' or roles ilike '%authenticated%' or roles = '{public}'
    ) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(policyname || ' -> ' || roles, ', ') from pol), 'no policies')

  -- 13. Row count (informational: must be 0 unless a grant was legitimately made).
  union all
  select 15, 'grant row count (expect 0 for this gate)',
    case when (select count(*) from public.company_entitlement_grants) = 0 then 'PASS' else 'REVIEW' end,
    (select count(*)::text || ' row(s)' from public.company_entitlement_grants)
)
select seq, check_name, result, detail from results order by seq;
