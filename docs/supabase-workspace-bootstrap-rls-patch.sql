-- Supabase workspace bootstrap RLS patch
--
-- Purpose:
-- Allow the first authenticated workspace bootstrap to:
-- 1. insert a company row it owns
-- 2. read that just-created company row back during insert().select()
-- 3. insert its own initial owner membership
--
-- Scope:
-- - Keeps RLS enabled
-- - Avoids service-role usage in the browser
-- - Does not grant customer/project/estimate/invoice access
--
-- Rollback:
-- - Drop policy companies_insert_authenticated on public.companies
-- - Drop policy company_users_insert_bootstrap_owner on public.company_users
-- - Recreate the previous companies_select_active_members policy without "created_by = auth.uid()"

begin;

alter table public.companies enable row level security;
alter table public.company_users enable row level security;

drop policy if exists companies_select_active_members on public.companies;
create policy companies_select_active_members
on public.companies
for select
using (
  public.is_company_member(id)
  or created_by = auth.uid()
);

drop policy if exists companies_insert_authenticated on public.companies;
create policy companies_insert_authenticated
on public.companies
for insert
with check (
  auth.uid() is not null
  and created_by = auth.uid()
  and updated_by = auth.uid()
);

drop policy if exists company_users_insert_bootstrap_owner on public.company_users;
create policy company_users_insert_bootstrap_owner
on public.company_users
for insert
with check (
  auth.uid() is not null
  and user_id = auth.uid()
  and role = 'owner'
  and created_by = auth.uid()
  and updated_by = auth.uid()
  and exists (
    select 1
    from public.companies c
    where c.id = company_id
      and c.created_by = auth.uid()
  )
);

commit;
