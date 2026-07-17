-- EstiPaid Gate 17A.1a — company_stripe_billing_refs verification
--
-- READ-ONLY. No DDL, no DML, nothing destructive. Returns labeled PASS/FAIL
-- rows only. Identifier VALUES are never printed -- only counts, null checks,
-- and masked presence.
--
-- Run against production project: aioxfciaflmqiizbzsde
--
-- Rows 1-11 are meaningful immediately after the schema/copy migration.
-- Rows 12-15 are only expected to PASS after the cleanup migration has run.

with
t as (
  select c.oid, c.relrowsecurity
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'company_stripe_billing_refs'
),
cols as (
  select column_name, data_type, is_nullable
  from information_schema.columns
  where table_schema = 'public' and table_name = 'company_stripe_billing_refs'
),
cons as (
  select conname, contype, pg_get_constraintdef(oid) as def
  from pg_constraint where conrelid = (select oid from t)
),
idx as (
  select indexname, indexdef from pg_indexes
  where schemaname = 'public' and tablename = 'company_stripe_billing_refs'
),
privs as (
  select grantee, privilege_type from information_schema.role_table_grants
  where table_schema = 'public' and table_name = 'company_stripe_billing_refs'
),
pol as (
  select policyname, roles::text as roles from pg_policies
  where schemaname = 'public' and tablename = 'company_stripe_billing_refs'
),
-- Companies whose subscription row still carries an identifier (camelCase or snake_case).
sub_with_ids as (
  select s.company_id,
    nullif(btrim(coalesce(s.setting_value->>'stripeCustomerId', s.setting_value->>'stripe_customer_id', '')), '') as cus,
    nullif(btrim(coalesce(s.setting_value->>'stripeSubscriptionId', s.setting_value->>'stripe_subscription_id', '')), '') as sub
  from public.app_settings s
  where s.setting_scope = 'company' and s.setting_key = 'subscription_plan_state'
),
results as (
  select 1 as seq, 'table exists' as check_name,
    case when exists (select 1 from t) then 'PASS' else 'FAIL' end as result,
    coalesce((select 'found' from t limit 1), 'missing') as detail

  union all select 2, 'RLS enabled',
    case when (select relrowsecurity from t) then 'PASS' else 'FAIL' end,
    coalesce((select relrowsecurity::text from t), 'n/a')

  union all select 3, 'columns match expected shape',
    case when (select count(*) from (values
        ('company_id','uuid','NO'), ('stripe_customer_id','text','YES'),
        ('stripe_subscription_id','text','YES'),
        ('created_at','timestamp with time zone','NO'),
        ('updated_at','timestamp with time zone','NO')
      ) as e(name,typ,nullable)
      join cols c on c.column_name=e.name and c.data_type=e.typ and c.is_nullable=e.nullable) = 5
      then 'PASS' else 'FAIL' end,
    (select count(*)::text || ' of 5 matched' from (values
        ('company_id','uuid','NO'), ('stripe_customer_id','text','YES'),
        ('stripe_subscription_id','text','YES'),
        ('created_at','timestamp with time zone','NO'),
        ('updated_at','timestamp with time zone','NO')
      ) as e(name,typ,nullable)
      join cols c on c.column_name=e.name and c.data_type=e.typ and c.is_nullable=e.nullable)

  union all select 4, 'primary key on company_id',
    case when exists (select 1 from cons where contype='p' and def ilike '%company_id%') then 'PASS' else 'FAIL' end,
    coalesce((select conname from cons where contype='p' limit 1), 'missing')

  union all select 5, 'companies FK on delete cascade',
    case when exists (select 1 from cons where contype='f'
      and def ilike '%REFERENCES companies(id)%' and def ilike '%ON DELETE CASCADE%') then 'PASS' else 'FAIL' end,
    coalesce((select def from cons where contype='f' limit 1), 'missing')

  union all select 6, 'nonblank identifier checks exist',
    case when (select count(*) from cons where contype='c' and conname in (
        'company_stripe_billing_refs_customer_nonblank_check',
        'company_stripe_billing_refs_subscription_nonblank_check')) = 2
      then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(conname, ', ' order by conname) from cons where contype='c'), 'none')

  union all select 7, 'customer id unique when present (partial unique index)',
    case when exists (select 1 from idx
      where indexname='company_stripe_billing_refs_customer_uniq_idx'
        and indexdef ilike '%CREATE UNIQUE INDEX%' and indexdef ilike '%WHERE (stripe_customer_id IS NOT NULL)%')
      then 'PASS' else 'FAIL' end,
    coalesce((select indexdef from idx where indexname='company_stripe_billing_refs_customer_uniq_idx'), 'missing')

  union all select 8, 'subscription id unique when present (partial unique index)',
    case when exists (select 1 from idx
      where indexname='company_stripe_billing_refs_subscription_uniq_idx'
        and indexdef ilike '%CREATE UNIQUE INDEX%' and indexdef ilike '%WHERE (stripe_subscription_id IS NOT NULL)%')
      then 'PASS' else 'FAIL' end,
    coalesce((select indexdef from idx where indexname='company_stripe_billing_refs_subscription_uniq_idx'), 'missing')

  union all select 9, 'anon and authenticated have no privileges',
    case when not exists (select 1 from privs where grantee in ('anon','authenticated')) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(grantee||':'||privilege_type, ', ') from privs where grantee in ('anon','authenticated')), 'none')

  union all select 10, 'service_role has exactly SELECT, INSERT, UPDATE',
    case when (select count(distinct privilege_type) from privs
        where grantee='service_role' and privilege_type in ('SELECT','INSERT','UPDATE')) = 3
      and not exists (select 1 from privs where grantee='service_role'
        and privilege_type in ('DELETE','TRUNCATE','REFERENCES','TRIGGER'))
      then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(distinct privilege_type, ', ' order by privilege_type) from privs where grantee='service_role'), 'none')

  union all select 11, 'service_role lacks DELETE/TRUNCATE/REFERENCES/TRIGGER',
    case when not exists (select 1 from privs where grantee='service_role'
      and privilege_type in ('DELETE','TRUNCATE','REFERENCES','TRIGGER')) then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(privilege_type, ', ') from privs where grantee='service_role'
      and privilege_type in ('DELETE','TRUNCATE','REFERENCES','TRIGGER')), 'none')

  union all select 12, 'no policy grants anon/authenticated access',
    case when not exists (select 1 from pol
      where roles ilike '%anon%' or roles ilike '%authenticated%' or roles='{public}') then 'PASS' else 'FAIL' end,
    coalesce((select string_agg(policyname||' -> '||roles, ', ') from pol), 'no policies')

  -- 11. Every identifier-bearing subscription row has a private copy. Counts only.
  union all select 13, 'every identifier-bearing company was copied privately',
    case when not exists (
      select 1 from sub_with_ids s
      where (s.cus is not null or s.sub is not null)
        and not exists (select 1 from public.company_stripe_billing_refs r where r.company_id = s.company_id)
    ) then 'PASS' else 'FAIL' end,
    (select count(*)::text || ' private row(s); ' ||
       (select count(*)::text from sub_with_ids where cus is not null or sub is not null) || ' subscription row(s) still holding ids'
     from public.company_stripe_billing_refs)

  -- 12. Post-cleanup: app_settings must hold no identifiers. Presence only.
  union all select 14, 'app_settings holds no Stripe identifiers (expect PASS only after cleanup)',
    case when not exists (select 1 from sub_with_ids where cus is not null or sub is not null)
      then 'PASS' else 'PENDING_CLEANUP' end,
    (select count(*)::text || ' subscription row(s) still carrying an identifier' from sub_with_ids where cus is not null or sub is not null)

  -- 13. Billing facts must be untouched by any of this.
  union all select 15, 'billing plan/status preserved in app_settings',
    'INFO',
    coalesce((select string_agg(distinct coalesce(setting_value->>'plan','?')||'/'||coalesce(setting_value->>'status','?')||'/'||coalesce(setting_value->>'source','?'), ', ')
      from public.app_settings
      where setting_scope='company' and setting_key='subscription_plan_state'), 'no subscription rows')

  -- 14/15. Entitlement grants must be untouched; BVW must hold none.
  union all select 16, 'entitlement grant count unchanged (expect 0 for this gate)',
    case when (select count(*) from public.company_entitlement_grants) = 0 then 'PASS' else 'REVIEW' end,
    (select count(*)::text || ' grant row(s)' from public.company_entitlement_grants)

  union all select 17, 'company count unchanged (no new company in this gate)',
    'INFO',
    (select count(*)::text || ' company row(s)' from public.companies)
)
select seq, check_name, result, detail from results order by seq;
