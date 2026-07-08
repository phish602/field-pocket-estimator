-- Supabase Gate 7A
-- This patch only enables safe line-item migration idempotency for:
--   - public.estimate_line_items
--   - public.invoice_line_items
-- It does not migrate data, delete data, weaken RLS, or modify other business tables.
--
-- Run the duplicate diagnostics first.
-- If either diagnostic query returns rows, stop and resolve those duplicates before running the transaction block.

-- Duplicate diagnostics: estimate_line_items
select
  company_id,
  legacy_local_id,
  count(*) as duplicate_count
from public.estimate_line_items
where legacy_local_id is not null
group by company_id, legacy_local_id
having count(*) > 1
order by duplicate_count desc, company_id, legacy_local_id;

-- Duplicate diagnostics: invoice_line_items
select
  company_id,
  legacy_local_id,
  count(*) as duplicate_count
from public.invoice_line_items
where legacy_local_id is not null
group by company_id, legacy_local_id
having count(*) > 1
order by duplicate_count desc, company_id, legacy_local_id;

begin;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'estimate_line_items_company_legacy_local_id_key'
      and conrelid = 'public.estimate_line_items'::regclass
  ) then
    alter table public.estimate_line_items
      add constraint estimate_line_items_company_legacy_local_id_key
      unique (company_id, legacy_local_id);
  end if;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoice_line_items_company_legacy_local_id_key'
      and conrelid = 'public.invoice_line_items'::regclass
  ) then
    alter table public.invoice_line_items
      add constraint invoice_line_items_company_legacy_local_id_key
      unique (company_id, legacy_local_id);
  end if;
end
$$;

commit;

-- Verification: confirm the resulting unique constraints exist.
select
  n.nspname as schema_name,
  c.relname as table_name,
  con.conname as constraint_name,
  pg_get_constraintdef(con.oid) as constraint_definition
from pg_constraint con
join pg_class c
  on c.oid = con.conrelid
join pg_namespace n
  on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('estimate_line_items', 'invoice_line_items')
  and con.conname in (
    'estimate_line_items_company_legacy_local_id_key',
    'invoice_line_items_company_legacy_local_id_key'
  )
order by c.relname, con.conname;

-- Verification: confirm the backing unique indexes exist.
select
  schemaname,
  tablename,
  indexname,
  indexdef
from pg_indexes
where schemaname = 'public'
  and tablename in ('estimate_line_items', 'invoice_line_items')
  and indexname in (
    'estimate_line_items_company_legacy_local_id_key',
    'invoice_line_items_company_legacy_local_id_key'
  )
order by tablename, indexname;

-- Rollback if needed:
-- alter table public.estimate_line_items
--   drop constraint if exists estimate_line_items_company_legacy_local_id_key;
--
-- alter table public.invoice_line_items
--   drop constraint if exists invoice_line_items_company_legacy_local_id_key;
