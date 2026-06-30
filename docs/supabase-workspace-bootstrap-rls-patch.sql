-- Supabase workspace bootstrap RLS patch
--
-- This patch fixes first-workspace bootstrap only.
-- Do not rerun full Supabase migration SQL.
-- No customer/project/estimate/invoice migration is included.
--
-- Rollback:
-- - Drop policy companies_insert_authenticated on public.companies
-- - Drop policy company_users_insert_bootstrap_owner on public.company_users
-- - Drop policy company_users_select_active_members on public.company_users
-- - Recreate the previous select policies if needed

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
  and exists (
    select 1
    from public.companies c
    where c.id = company_id
      and c.created_by = auth.uid()
  )
);

drop policy if exists company_users_select_active_members on public.company_users;
create policy company_users_select_active_members
on public.company_users
for select
using (
  public.is_company_member(company_id)
  or user_id = auth.uid()
);

commit;
