-- EstiPaid Security R2.3B replay/order authority verification.
-- READ-ONLY: this query performs no DDL or DML and does not print identifiers.

with
tables as (
  select c.relname, c.relrowsecurity, pg_get_userbyid(c.relowner) as owner, c.oid
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in ('stripe_subscription_webhook_ordering', 'stripe_subscription_webhook_events')
),
policies as (
  select tablename from pg_policies where schemaname = 'public'
    and tablename in ('stripe_subscription_webhook_ordering', 'stripe_subscription_webhook_events')
),
function_info as (
  select p.oid, pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig
    from pg_proc p
   where p.oid = 'public.apply_stripe_subscription_webhook_event(text,timestamp with time zone,timestamp with time zone,text,uuid,text,text,text,text,timestamp with time zone)'::regprocedure
),
ordering_columns as (
  select column_name, data_type, is_nullable, column_default
    from information_schema.columns
   where table_schema = 'public' and table_name = 'stripe_subscription_webhook_ordering'
),
state_duplicates as (
  select company_id from public.app_settings
   where setting_scope = 'company' and setting_key = 'subscription_plan_state'
   group by company_id having count(*) > 1
),
results as (
  select 1 as seq, 'both R2.3B tables exist' as check_name,
    case when (select count(*) from tables) = 2 then 'PASS' else 'FAIL' end as result
  union all select 2, 'R2.3B table owners are postgres',
    case when (select count(*) from tables where owner = 'postgres') = 2 then 'PASS' else 'FAIL' end
  union all select 3, 'RLS is enabled on both tables',
    case when (select count(*) from tables where relrowsecurity) = 2 then 'PASS' else 'FAIL' end
  union all select 4, 'R2.3B tables have no policies',
    case when not exists (select 1 from policies) then 'PASS' else 'FAIL' end
  union all select 5, 'no effective anon/authenticated/service_role table privileges',
    case when not exists (
      select 1 from tables t cross join unnest(array['anon','authenticated','service_role']) r(role)
       where has_table_privilege(r.role, t.oid, 'SELECT') or has_table_privilege(r.role, t.oid, 'INSERT')
          or has_table_privilege(r.role, t.oid, 'UPDATE') or has_table_privilege(r.role, t.oid, 'DELETE')
          or has_table_privilege(r.role, t.oid, 'TRUNCATE') or has_table_privilege(r.role, t.oid, 'REFERENCES')
          or has_table_privilege(r.role, t.oid, 'TRIGGER')
    ) then 'PASS' else 'FAIL' end
  union all select 6, 'PUBLIC has no replay/order table ACL',
    case when not exists (
      select 1 from tables t cross join lateral aclexplode(coalesce((select relacl from pg_class where oid=t.oid), acldefault('r', 'postgres'::regrole))) a
       where a.grantee = 0
    ) then 'PASS' else 'FAIL' end
  union all select 7, 'RPC exists, is postgres SECURITY DEFINER, and fixes search_path',
    case when exists (select 1 from function_info where owner = 'postgres' and prosecdef
      and coalesce(proconfig, array[]::text[]) @> array['search_path=pg_catalog, public']) then 'PASS' else 'FAIL' end
  union all select 8, 'only service_role executes the RPC',
    case when has_function_privilege('service_role', 'public.apply_stripe_subscription_webhook_event(text,timestamp with time zone,timestamp with time zone,text,uuid,text,text,text,text,timestamp with time zone)', 'EXECUTE')
      and not has_function_privilege('anon', 'public.apply_stripe_subscription_webhook_event(text,timestamp with time zone,timestamp with time zone,text,uuid,text,text,text,text,timestamp with time zone)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.apply_stripe_subscription_webhook_event(text,timestamp with time zone,timestamp with time zone,text,uuid,text,text,text,text,timestamp with time zone)', 'EXECUTE')
      then 'PASS' else 'FAIL' end
  union all select 9, 'required primary, unique, foreign-key, check, and index objects exist',
    case when (select count(*) from pg_constraint where conname in (
      'stripe_subscription_webhook_ordering_pkey', 'stripe_subscription_webhook_ordering_subscription_key',
      'stripe_subscription_webhook_ordering_subscription_nonblank_check', 'stripe_subscription_webhook_ordering_created_at_check', 'stripe_subscription_webhook_events_pkey',
      'stripe_subscription_webhook_events_ordering_fkey', 'stripe_subscription_webhook_events_event_nonblank_check',
      'stripe_subscription_webhook_events_subscription_nonblank_check', 'stripe_subscription_webhook_events_type_check')) = 9
      and exists (select 1 from pg_indexes where schemaname='public' and indexname='stripe_subscription_webhook_ordering_company_updated_idx')
      and exists (select 1 from pg_indexes where schemaname='public' and indexname='stripe_subscription_webhook_events_company_subscription_created_idx')
      and exists (select 1 from pg_indexes where schemaname='public' and indexname='stripe_subscription_webhook_events_applied_at_idx')
      then 'PASS' else 'FAIL' end
  union all select 10, 'is_superseded is nonnull and defaults false',
    case when exists (
      select 1 from ordering_columns
       where column_name = 'is_superseded' and is_nullable = 'NO'
         and column_default like 'false%'
    ) then 'PASS' else 'FAIL' end
  union all select 11, 'no event payload, signature, header, secret, JSON, or customer PII column exists',
    case when not exists (
      select 1 from information_schema.columns
       where table_schema='public' and table_name in ('stripe_subscription_webhook_ordering','stripe_subscription_webhook_events')
         and (data_type in ('json','jsonb') or column_name ~* '(payload|signature|header|secret|customer_name|email|address|payment)')
    ) then 'PASS' else 'FAIL' end
  union all select 12, 'subscription creation timestamp is nullable timestamptz only for superseded barriers',
    case when exists (
      select 1 from ordering_columns
       where column_name = 'stripe_subscription_created_at'
         and data_type = 'timestamp with time zone' and is_nullable = 'YES'
    ) and exists (
      select 1 from pg_constraint
       where conname = 'stripe_subscription_webhook_ordering_created_at_check'
         and pg_get_constraintdef(oid, true) ~* 'stripe_subscription_created_at[[:space:]]+is[[:space:]]+not[[:space:]]+null[()[:space:]]*or[[:space:]]+is_superseded'
    ) then 'PASS' else 'FAIL' end
  union all select 13, 'existing app_settings uniqueness target remains present',
    case when exists (
      select 1 from pg_index i join pg_class c on c.oid=i.indexrelid
       where i.indrelid='public.app_settings'::regclass and i.indisunique
         and c.relname='app_settings_company_setting_key_uniq'
         and pg_get_expr(i.indpred, i.indrelid) = '(setting_scope = ''company''::text)'
    ) then 'PASS' else 'FAIL' end
  union all select 14, 'no duplicate company subscription_plan_state row exists',
    case when not exists (select 1 from state_duplicates) then 'PASS' else 'FAIL' end
)
select seq, check_name, result from results order by seq;
