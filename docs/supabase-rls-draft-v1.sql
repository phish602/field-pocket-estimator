-- REVIEW ARTIFACT ONLY
-- NOT DEPLOYED
-- NOT A MIGRATION TO RUN
-- DO NOT EXECUTE WITHOUT SEPARATE REVIEW
-- No runtime wiring. No backend writes. No Supabase deployment.

-- Draft-only RLS SQL for backend V1 review. This file documents the intended
-- access-control shape before any real migration is created.

-- Helper function intent:
-- - is_company_member(company_id) returns true only for active company_users rows tied to auth.uid()
-- - company_role(company_id) returns the active user role for the company
-- - can_manage_company(company_id) returns true for owner/admin
-- - can_write_company_records(company_id) returns true for owner/admin/member

create or replace function is_company_member(company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from company_users cu
    where cu.company_id = $1
      and cu.user_id = auth.uid()
      and cu.status = 'active'
  );
$$;

create or replace function company_role(company_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select cu.role
  from company_users cu
  where cu.company_id = $1
    and cu.user_id = auth.uid()
    and cu.status = 'active'
  order by cu.updated_at desc nulls last, cu.created_at desc nulls last
  limit 1;
$$;

create or replace function can_manage_company(company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(company_role($1) in ('owner', 'admin'), false);
$$;

create or replace function can_write_company_records(company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(company_role($1) in ('owner', 'admin', 'member'), false);
$$;

-- Companies
alter table companies enable row level security;

create policy companies_select_active_members
on companies
for select
using (is_company_member(id));

create policy companies_update_owner_admin
on companies
for update
using (can_manage_company(id))
with check (can_manage_company(id));

-- Company users
alter table company_users enable row level security;

create policy company_users_select_members_or_manage
on company_users
for select
using (is_company_member(company_id) or can_manage_company(company_id));

create policy company_users_insert_owner_admin
on company_users
for insert
with check (can_manage_company(company_id));

create policy company_users_update_owner_admin
on company_users
for update
using (can_manage_company(company_id))
with check (can_manage_company(company_id));

create policy company_users_delete_owner_admin
on company_users
for delete
using (can_manage_company(company_id));

-- Customers
alter table customers enable row level security;

create policy customers_select_members
on customers
for select
using (is_company_member(company_id));

create policy customers_insert_write_roles
on customers
for insert
with check (can_write_company_records(company_id));

create policy customers_update_write_roles
on customers
for update
using (can_write_company_records(company_id))
with check (can_write_company_records(company_id));

create policy customers_delete_owner_admin
on customers
for delete
using (can_manage_company(company_id));

-- Projects
alter table projects enable row level security;

create policy projects_select_members
on projects
for select
using (is_company_member(company_id));

create policy projects_insert_write_roles
on projects
for insert
with check (can_write_company_records(company_id));

create policy projects_update_write_roles
on projects
for update
using (can_write_company_records(company_id))
with check (can_write_company_records(company_id));

create policy projects_archive_owner_admin_or_safe_member
on projects
for update
using (can_write_company_records(company_id))
with check (
  can_manage_company(company_id)
  or (
    company_role(company_id) = 'member'
    and archived_at is not null
  )
);

create policy projects_delete_owner_admin_empty_only
on projects
for delete
using (can_manage_company(company_id));

-- Estimates
alter table estimates enable row level security;

create policy estimates_select_members
on estimates
for select
using (is_company_member(company_id));

create policy estimates_insert_write_roles
on estimates
for insert
with check (can_write_company_records(company_id));

create policy estimates_update_write_roles
on estimates
for update
using (can_write_company_records(company_id))
with check (can_write_company_records(company_id));

create policy estimates_archive_owner_admin
on estimates
for update
using (can_write_company_records(company_id))
with check (can_manage_company(company_id) or archived_at is not null);

create policy estimates_delete_owner_admin
on estimates
for delete
using (can_manage_company(company_id));

-- Estimate line items
alter table estimate_line_items enable row level security;

create policy estimate_line_items_select_members
on estimate_line_items
for select
using (
  exists (
    select 1
    from estimates e
    where e.id = estimate_line_items.estimate_id
      and is_company_member(e.company_id)
  )
);

create policy estimate_line_items_insert_write_roles
on estimate_line_items
for insert
with check (
  exists (
    select 1
    from estimates e
    where e.id = estimate_line_items.estimate_id
      and can_write_company_records(e.company_id)
  )
);

create policy estimate_line_items_update_write_roles
on estimate_line_items
for update
using (
  exists (
    select 1
    from estimates e
    where e.id = estimate_line_items.estimate_id
      and can_write_company_records(e.company_id)
  )
)
with check (
  exists (
    select 1
    from estimates e
    where e.id = estimate_line_items.estimate_id
      and can_write_company_records(e.company_id)
  )
);

create policy estimate_line_items_delete_owner_admin
on estimate_line_items
for delete
using (
  exists (
    select 1
    from estimates e
    where e.id = estimate_line_items.estimate_id
      and can_manage_company(e.company_id)
  )
);

-- Invoices
alter table invoices enable row level security;

create policy invoices_select_members
on invoices
for select
using (is_company_member(company_id));

create policy invoices_insert_write_roles
on invoices
for insert
with check (can_write_company_records(company_id));

create policy invoices_update_write_roles
on invoices
for update
using (can_write_company_records(company_id))
with check (can_write_company_records(company_id));

create policy invoices_archive_owner_admin
on invoices
for update
using (can_write_company_records(company_id))
with check (can_manage_company(company_id) or archived_at is not null);

create policy invoices_delete_owner_admin
on invoices
for delete
using (can_manage_company(company_id));

-- Invoice line items
alter table invoice_line_items enable row level security;

create policy invoice_line_items_select_members
on invoice_line_items
for select
using (
  exists (
    select 1
    from invoices i
    where i.id = invoice_line_items.invoice_id
      and is_company_member(i.company_id)
  )
);

create policy invoice_line_items_insert_write_roles
on invoice_line_items
for insert
with check (
  exists (
    select 1
    from invoices i
    where i.id = invoice_line_items.invoice_id
      and can_write_company_records(i.company_id)
  )
);

create policy invoice_line_items_update_write_roles
on invoice_line_items
for update
using (
  exists (
    select 1
    from invoices i
    where i.id = invoice_line_items.invoice_id
      and can_write_company_records(i.company_id)
  )
)
with check (
  exists (
    select 1
    from invoices i
    where i.id = invoice_line_items.invoice_id
      and can_write_company_records(i.company_id)
  )
);

create policy invoice_line_items_delete_owner_admin
on invoice_line_items
for delete
using (
  exists (
    select 1
    from invoices i
    where i.id = invoice_line_items.invoice_id
      and can_manage_company(i.company_id)
  )
);

-- Invoice payments
alter table invoice_payments enable row level security;

create policy invoice_payments_select_members
on invoice_payments
for select
using (is_company_member(company_id));

create policy invoice_payments_insert_write_roles
on invoice_payments
for insert
with check (can_write_company_records(company_id));

create policy invoice_payments_update_restricted
on invoice_payments
for update
using (can_manage_company(company_id))
with check (can_manage_company(company_id));

create policy invoice_payments_delete_owner_admin_only
on invoice_payments
for delete
using (can_manage_company(company_id));

-- Scope templates
alter table scope_templates enable row level security;

create policy scope_templates_select_members
on scope_templates
for select
using (is_company_member(company_id));

create policy scope_templates_insert_write_roles
on scope_templates
for insert
with check (can_write_company_records(company_id));

create policy scope_templates_update_write_roles
on scope_templates
for update
using (can_write_company_records(company_id))
with check (can_write_company_records(company_id));

create policy scope_templates_delete_owner_admin
on scope_templates
for delete
using (can_manage_company(company_id));

-- App settings
alter table app_settings enable row level security;

-- company settings: setting_scope = 'company', company_id required, user_id null.
create policy app_settings_select_company_scope
on app_settings
for select
using (
  setting_scope = 'company'
  and company_id is not null
  and user_id is null
  and is_company_member(company_id)
);

create policy app_settings_select_user_scope
on app_settings
for select
using (
  setting_scope = 'user'
  and company_id is not null
  and user_id = auth.uid()
  and is_company_member(company_id)
);

create policy app_settings_insert_company_scope_owner_admin
on app_settings
for insert
with check (
  setting_scope = 'company'
  and company_id is not null
  and user_id is null
  and can_manage_company(company_id)
);

create policy app_settings_insert_user_scope_own
on app_settings
for insert
with check (
  setting_scope = 'user'
  and company_id is not null
  and user_id = auth.uid()
  and is_company_member(company_id)
);

create policy app_settings_update_company_scope_owner_admin
on app_settings
for update
using (
  setting_scope = 'company'
  and company_id is not null
  and user_id is null
  and can_manage_company(company_id)
)
with check (
  setting_scope = 'company'
  and company_id is not null
  and user_id is null
  and can_manage_company(company_id)
);

create policy app_settings_update_user_scope_own
on app_settings
for update
using (
  setting_scope = 'user'
  and company_id is not null
  and user_id = auth.uid()
  and is_company_member(company_id)
)
with check (
  setting_scope = 'user'
  and company_id is not null
  and user_id = auth.uid()
  and is_company_member(company_id)
);

create policy app_settings_delete_owner_admin
on app_settings
for delete
using (can_manage_company(company_id));

-- Audit events
alter table audit_events enable row level security;

create policy audit_events_select_members
on audit_events
for select
using (is_company_member(company_id));

create policy audit_events_insert_append_only_draft
on audit_events
for insert
to authenticated
with check (
  can_write_company_records(company_id)
  and actor_id = auth.uid()
);

-- No update/delete policies for audit_events in the draft; append-only by design.

-- Migration batches
alter table migration_batches enable row level security;

create policy migration_batches_select_owner_admin
on migration_batches
for select
using (can_manage_company(company_id));

create policy migration_batches_insert_owner_admin
on migration_batches
for insert
with check (can_manage_company(company_id));

create policy migration_batches_update_owner_admin
on migration_batches
for update
using (can_manage_company(company_id))
with check (can_manage_company(company_id));

create policy migration_batches_delete_owner_admin
on migration_batches
for delete
using (can_manage_company(company_id));

-- Migration write results
alter table migration_write_results enable row level security;

create policy migration_write_results_select_owner_admin
on migration_write_results
for select
using (can_manage_company(company_id));

create policy migration_write_results_insert_owner_admin
on migration_write_results
for insert
with check (can_manage_company(company_id));

create policy migration_write_results_update_owner_admin
on migration_write_results
for update
using (can_manage_company(company_id))
with check (can_manage_company(company_id));

create policy migration_write_results_delete_owner_admin
on migration_write_results
for delete
using (can_manage_company(company_id));

-- Authenticated grants
grant usage on schema public to authenticated;
grant select, insert, update on table public.companies to authenticated;
grant select, insert, update, delete on table public.company_users to authenticated;
grant select, insert, update on table public.customers to authenticated;
grant select, insert, update on table public.projects to authenticated;
grant select, insert, update on table public.estimates to authenticated;
grant select, insert, update on table public.estimate_line_items to authenticated;
grant select, insert, update on table public.invoices to authenticated;
grant select, insert, update on table public.invoice_line_items to authenticated;
grant select, insert, update on table public.invoice_payments to authenticated;
grant select, insert, update on table public.scope_templates to authenticated;
grant select, insert, update on table public.app_settings to authenticated;
grant select, insert on table public.audit_events to authenticated;
grant select, insert, update on table public.migration_batches to authenticated;
grant select, insert, update on table public.migration_write_results to authenticated;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.company_role(uuid) to authenticated;
grant execute on function public.can_manage_company(uuid) to authenticated;
grant execute on function public.can_write_company_records(uuid) to authenticated;

-- Draft-only notes:
-- - viewer remains read-only.
-- - sent/approved estimates and paid/partial/void invoices should receive stricter runtime handling later.
-- - payment deletion should not be encouraged by future UI or policy work.
-- - migration approvals remain owner/admin controlled.
-- - runtime wiring remains blocked.
