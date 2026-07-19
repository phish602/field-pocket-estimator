-- EstiPaid Security Gate R1.2 — remove the obsolete browser-facing audit policy.
-- Forward-only. Run only after reviewing the Production policy inventory.

begin;

do $$
declare
  policy_row record;
begin
  if to_regclass('public.audit_events') is null then
    raise exception 'Security R1.2 precondition failed: public.audit_events is missing';
  end if;

  if not exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'audit_events'
      and c.relrowsecurity
  ) then
    raise exception 'Security R1.2 precondition failed: RLS is not enabled on public.audit_events';
  end if;

  select * into policy_row
  from pg_policies
  where schemaname = 'public'
    and tablename = 'audit_events'
    and policyname = 'audit_events_select_members';

  if not found then
    raise exception 'Security R1.2 precondition failed: audit_events_select_members is missing';
  end if;

  if policy_row.permissive <> 'PERMISSIVE'
    or policy_row.cmd <> 'SELECT'
    or policy_row.roles <> array['public'::name]
    or policy_row.qual <> 'is_company_member(company_id)' then
    raise exception 'Security R1.2 precondition failed: audit_events_select_members differs from the reviewed permissive PUBLIC membership SELECT policy';
  end if;

  if has_table_privilege('anon', 'public.audit_events', 'SELECT')
    or has_table_privilege('anon', 'public.audit_events', 'INSERT')
    or has_table_privilege('anon', 'public.audit_events', 'UPDATE')
    or has_table_privilege('anon', 'public.audit_events', 'DELETE')
    or has_table_privilege('anon', 'public.audit_events', 'TRUNCATE')
    or has_table_privilege('anon', 'public.audit_events', 'REFERENCES')
    or has_table_privilege('anon', 'public.audit_events', 'TRIGGER') then
    raise exception 'Security R1.2 precondition failed: anon retains privileges on public.audit_events';
  end if;

  if has_table_privilege('authenticated', 'public.audit_events', 'SELECT')
    or has_table_privilege('authenticated', 'public.audit_events', 'INSERT')
    or has_table_privilege('authenticated', 'public.audit_events', 'UPDATE')
    or has_table_privilege('authenticated', 'public.audit_events', 'DELETE')
    or has_table_privilege('authenticated', 'public.audit_events', 'TRUNCATE')
    or has_table_privilege('authenticated', 'public.audit_events', 'REFERENCES')
    or has_table_privilege('authenticated', 'public.audit_events', 'TRIGGER') then
    raise exception 'Security R1.2 precondition failed: authenticated retains privileges on public.audit_events';
  end if;
end $$;

drop policy audit_events_select_members on public.audit_events;

commit;
