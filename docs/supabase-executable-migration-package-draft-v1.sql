-- REVIEW ARTIFACT ONLY
-- NOT DEPLOYED
-- NOT RUN
-- NOT IN SUPABASE MIGRATIONS
-- DO NOT EXECUTE WITHOUT SEPARATE REVIEW AND APPROVAL
--
-- This package combines the reviewed schema SQL draft and reviewed RLS SQL draft
-- into one docs-only package for future review. No runtime wiring is included.
-- No credentials are included.

-- Extensions if needed
create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  legacy_local_id text,
  name text not null,
  phone text,
  email text,
  address jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

create table if not exists public.company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  user_id uuid not null,
  role text not null,
  status text not null default 'active',
  invited_at timestamptz,
  joined_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint company_users_role_check check (role in ('owner', 'admin', 'member', 'viewer'))
);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  legacy_local_id text,
  display_name text,
  company_name text,
  contact_name text,
  phone text,
  email text,
  billing_address jsonb,
  customer_type text,
  customer_status text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  legacy_local_id text,
  project_number text,
  project_name text,
  site_address jsonb,
  status text not null default 'draft',
  notes text,
  scope_summary text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint projects_status_check check (status in ('draft', 'active', 'completed', 'archived'))
);

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  legacy_local_id text,
  estimate_number text not null,
  status text not null default 'draft',
  document_type text not null default 'estimate',
  estimate_date date,
  due_date date,
  total_amount numeric(12,2),
  subtotal_amount numeric(12,2),
  tax_amount numeric(12,2),
  discount_amount numeric(12,2),
  notes text,
  terms text,
  converted_invoice_id uuid,
  converted_invoice_legacy_id text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint estimates_status_check check (status in ('draft', 'pending', 'sent', 'approved', 'lost'))
);

create table if not exists public.estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  estimate_id uuid not null references public.estimates(id) on delete restrict,
  legacy_local_id text,
  sort_order integer not null default 0,
  description text,
  quantity numeric(12,2),
  unit text,
  unit_price numeric(12,2),
  total_price numeric(12,2),
  line_role text,
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete restrict,
  project_id uuid references public.projects(id) on delete restrict,
  estimate_id uuid references public.estimates(id) on delete restrict,
  source_estimate_legacy_id text,
  legacy_local_id text,
  invoice_number text not null,
  estimate_number text,
  status text not null default 'draft',
  payment_status text,
  invoice_date date,
  due_date date,
  total_amount numeric(12,2),
  amount_paid numeric(12,2) not null default 0,
  balance_remaining numeric(12,2),
  notes text,
  terms text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint invoices_status_check check (status in ('draft', 'sent', 'partial', 'paid', 'overdue', 'void'))
);

create table if not exists public.invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  legacy_local_id text,
  sort_order integer not null default 0,
  description text,
  quantity numeric(12,2),
  unit text,
  unit_price numeric(12,2),
  total_price numeric(12,2),
  metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  legacy_local_id text,
  amount numeric(12,2) not null,
  method text,
  status text,
  paid_at timestamptz,
  payment_reference text,
  notes text,
  actor_id uuid,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

create table if not exists public.scope_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  legacy_local_id text,
  name text not null,
  scope_text text,
  template_type text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

create table if not exists public.app_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  user_id uuid,
  setting_scope text not null,
  setting_key text not null,
  setting_value jsonb,
  legacy_local_id text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint app_settings_scope_check check (setting_scope in ('company', 'user'))
);

create table if not exists public.audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  actor_id uuid,
  legacy_local_id text,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.migration_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  migration_batch_id text not null,
  status text not null default 'draft',
  started_at timestamptz,
  completed_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  notes text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint migration_batches_status_check check (status in ('draft', 'previewed', 'approved', 'running', 'completed', 'failed', 'rolled_back'))
);

create table if not exists public.migration_write_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  migration_batch_id uuid not null references public.migration_batches(id) on delete restrict,
  entity_type text not null,
  legacy_local_id text,
  backend_id uuid,
  action text not null,
  status text not null,
  error_reason text,
  attempted_payload jsonb,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Constraints
-- -----------------------------------------------------------------------------

alter table public.customers
  add constraint customers_company_legacy_local_id_uniq unique (company_id, legacy_local_id);

alter table public.projects
  add constraint projects_company_legacy_local_id_uniq unique (company_id, legacy_local_id);

alter table public.projects
  add constraint projects_company_project_number_uniq unique (company_id, project_number);

alter table public.estimates
  add constraint estimates_company_legacy_local_id_uniq unique (company_id, legacy_local_id);

alter table public.estimates
  add constraint estimates_company_estimate_number_uniq unique (company_id, estimate_number);

alter table public.invoices
  add constraint invoices_company_legacy_local_id_uniq unique (company_id, legacy_local_id);

alter table public.invoices
  add constraint invoices_company_invoice_number_uniq unique (company_id, invoice_number);

alter table public.invoice_payments
  add constraint invoice_payments_company_legacy_local_id_uniq unique (company_id, legacy_local_id);

alter table public.scope_templates
  add constraint scope_templates_company_legacy_local_id_uniq unique (company_id, legacy_local_id);

alter table public.app_settings
  add constraint app_settings_company_legacy_local_id_uniq unique (company_id, legacy_local_id);

alter table public.migration_batches
  add constraint migration_batches_company_migration_batch_id_uniq unique (company_id, migration_batch_id);

alter table public.migration_write_results
  add constraint migration_write_results_company_legacy_local_id_uniq unique (company_id, legacy_local_id);

create unique index if not exists app_settings_company_setting_key_uniq
  on public.app_settings (company_id, setting_key)
  where setting_scope = 'company';

create unique index if not exists app_settings_user_setting_key_uniq
  on public.app_settings (company_id, user_id, setting_key)
  where setting_scope = 'user';

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------

create index if not exists companies_legacy_local_id_idx on public.companies (legacy_local_id);
create index if not exists company_users_company_id_idx on public.company_users (company_id);
create index if not exists company_users_user_id_idx on public.company_users (user_id);
create index if not exists customers_company_id_idx on public.customers (company_id);
create index if not exists customers_legacy_local_id_idx on public.customers (company_id, legacy_local_id);
create index if not exists projects_company_id_idx on public.projects (company_id);
create index if not exists projects_customer_id_idx on public.projects (customer_id);
create index if not exists projects_legacy_local_id_idx on public.projects (company_id, legacy_local_id);
create index if not exists estimates_company_id_idx on public.estimates (company_id);
create index if not exists estimates_customer_id_idx on public.estimates (customer_id);
create index if not exists estimates_project_id_idx on public.estimates (project_id);
create index if not exists estimates_legacy_local_id_idx on public.estimates (company_id, legacy_local_id);
create index if not exists estimates_estimate_number_idx on public.estimates (company_id, estimate_number);
create index if not exists estimate_line_items_estimate_id_idx on public.estimate_line_items (estimate_id);
create index if not exists estimate_line_items_company_id_idx on public.estimate_line_items (company_id);
create index if not exists invoices_company_id_idx on public.invoices (company_id);
create index if not exists invoices_customer_id_idx on public.invoices (customer_id);
create index if not exists invoices_project_id_idx on public.invoices (project_id);
create index if not exists invoices_estimate_id_idx on public.invoices (estimate_id);
create index if not exists invoices_legacy_local_id_idx on public.invoices (company_id, legacy_local_id);
create index if not exists invoices_invoice_number_idx on public.invoices (company_id, invoice_number);
create index if not exists invoice_line_items_invoice_id_idx on public.invoice_line_items (invoice_id);
create index if not exists invoice_line_items_company_id_idx on public.invoice_line_items (company_id);
create index if not exists invoice_payments_invoice_id_idx on public.invoice_payments (invoice_id);
create index if not exists invoice_payments_company_id_idx on public.invoice_payments (company_id);
create index if not exists invoice_payments_legacy_local_id_idx on public.invoice_payments (company_id, legacy_local_id);
create index if not exists scope_templates_company_id_idx on public.scope_templates (company_id);
create index if not exists scope_templates_legacy_local_id_idx on public.scope_templates (company_id, legacy_local_id);
create index if not exists app_settings_company_id_idx on public.app_settings (company_id);
create index if not exists app_settings_user_id_idx on public.app_settings (user_id);
create index if not exists app_settings_scope_lookup_idx on public.app_settings (company_id, setting_scope, setting_key);
create index if not exists app_settings_legacy_local_id_idx on public.app_settings (company_id, legacy_local_id);
create index if not exists audit_events_company_created_at_idx on public.audit_events (company_id, created_at desc);
create index if not exists audit_events_actor_id_idx on public.audit_events (actor_id);
create index if not exists audit_events_legacy_local_id_idx on public.audit_events (company_id, legacy_local_id);
create index if not exists migration_batches_company_id_idx on public.migration_batches (company_id);
create index if not exists migration_batches_migration_batch_id_idx on public.migration_batches (company_id, migration_batch_id);
create index if not exists migration_write_results_batch_id_idx on public.migration_write_results (migration_batch_id);
create index if not exists migration_write_results_company_id_idx on public.migration_write_results (company_id);
create index if not exists migration_write_results_legacy_local_id_idx on public.migration_write_results (company_id, legacy_local_id);

-- -----------------------------------------------------------------------------
-- Helper Functions
-- -----------------------------------------------------------------------------

create or replace function public.is_company_member(company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.company_users cu
    where cu.company_id = $1
      and cu.user_id = auth.uid()
      and cu.status = 'active'
  );
$$;

create or replace function public.company_role(company_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select cu.role
  from public.company_users cu
  where cu.company_id = $1
    and cu.user_id = auth.uid()
    and cu.status = 'active'
  order by cu.updated_at desc
  limit 1;
$$;

create or replace function public.can_manage_company(company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.company_role($1) in ('owner', 'admin');
$$;

create or replace function public.can_write_company_records(company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.company_role($1) in ('owner', 'admin', 'member');
$$;

-- -----------------------------------------------------------------------------
-- Enable RLS
-- -----------------------------------------------------------------------------

alter table public.companies enable row level security;
alter table public.company_users enable row level security;
alter table public.customers enable row level security;
alter table public.projects enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_line_items enable row level security;
alter table public.invoices enable row level security;
alter table public.invoice_line_items enable row level security;
alter table public.invoice_payments enable row level security;
alter table public.scope_templates enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_events enable row level security;
alter table public.migration_batches enable row level security;
alter table public.migration_write_results enable row level security;

-- -----------------------------------------------------------------------------
-- RLS Policies
-- -----------------------------------------------------------------------------

-- companies
create policy companies_select_active_members
on public.companies
for select
using (public.is_company_member(id));

create policy companies_insert_authenticated
on public.companies
for insert
with check (auth.uid() is not null and created_by = auth.uid());

create policy companies_update_owner_admin
on public.companies
for update
using (public.can_manage_company(id))
with check (public.can_manage_company(id));

-- company_users
create policy company_users_select_active_members
on public.company_users
for select
using (public.is_company_member(company_id));

create policy company_users_insert_owner_admin
on public.company_users
for insert
with check (public.can_manage_company(company_id));

create policy company_users_update_owner_admin
on public.company_users
for update
using (public.can_manage_company(company_id))
with check (public.can_manage_company(company_id));

create policy company_users_delete_owner_admin
on public.company_users
for delete
using (public.can_manage_company(company_id));

-- customers
create policy customers_select_members
on public.customers
for select
using (public.is_company_member(company_id));

create policy customers_insert_operational
on public.customers
for insert
with check (public.can_write_company_records(company_id));

create policy customers_update_operational
on public.customers
for update
using (public.can_write_company_records(company_id))
with check (public.can_write_company_records(company_id));

-- projects
create policy projects_select_members
on public.projects
for select
using (public.is_company_member(company_id));

create policy projects_insert_operational
on public.projects
for insert
with check (public.can_write_company_records(company_id));

create policy projects_update_operational
on public.projects
for update
using (public.can_write_company_records(company_id))
with check (public.can_write_company_records(company_id));

-- estimates
create policy estimates_select_members
on public.estimates
for select
using (public.is_company_member(company_id));

create policy estimates_insert_operational
on public.estimates
for insert
with check (public.can_write_company_records(company_id));

create policy estimates_update_operational
on public.estimates
for update
using (public.can_write_company_records(company_id))
with check (public.can_write_company_records(company_id));

-- estimate_line_items
create policy estimate_line_items_select_members
on public.estimate_line_items
for select
using (public.is_company_member(company_id));

create policy estimate_line_items_insert_operational
on public.estimate_line_items
for insert
with check (public.can_write_company_records(company_id));

create policy estimate_line_items_update_operational
on public.estimate_line_items
for update
using (public.can_write_company_records(company_id))
with check (public.can_write_company_records(company_id));

-- invoices
create policy invoices_select_members
on public.invoices
for select
using (public.is_company_member(company_id));

create policy invoices_insert_operational
on public.invoices
for insert
with check (public.can_write_company_records(company_id));

create policy invoices_update_operational
on public.invoices
for update
using (public.can_write_company_records(company_id))
with check (public.can_write_company_records(company_id));

-- invoice_line_items
create policy invoice_line_items_select_members
on public.invoice_line_items
for select
using (public.is_company_member(company_id));

create policy invoice_line_items_insert_operational
on public.invoice_line_items
for insert
with check (public.can_write_company_records(company_id));

create policy invoice_line_items_update_operational
on public.invoice_line_items
for update
using (public.can_write_company_records(company_id))
with check (public.can_write_company_records(company_id));

-- invoice_payments
create policy invoice_payments_select_members
on public.invoice_payments
for select
using (public.is_company_member(company_id));

create policy invoice_payments_insert_operational
on public.invoice_payments
for insert
with check (public.can_write_company_records(company_id));

create policy invoice_payments_update_owner_admin
on public.invoice_payments
for update
using (public.can_manage_company(company_id))
with check (public.can_manage_company(company_id));

-- scope_templates
create policy scope_templates_select_members
on public.scope_templates
for select
using (public.is_company_member(company_id));

create policy scope_templates_insert_operational
on public.scope_templates
for insert
with check (public.can_write_company_records(company_id));

create policy scope_templates_update_operational
on public.scope_templates
for update
using (public.can_write_company_records(company_id))
with check (public.can_write_company_records(company_id));

-- app_settings
create policy app_settings_select_company_scope
on public.app_settings
for select
using (
  setting_scope = 'company'
  and user_id is null
  and public.is_company_member(company_id)
);

create policy app_settings_select_user_scope
on public.app_settings
for select
using (
  setting_scope = 'user'
  and user_id = auth.uid()
  and public.is_company_member(company_id)
);

create policy app_settings_insert_company_scope
on public.app_settings
for insert
with check (
  setting_scope = 'company'
  and user_id is null
  and public.can_manage_company(company_id)
);

create policy app_settings_insert_user_scope
on public.app_settings
for insert
with check (
  setting_scope = 'user'
  and user_id = auth.uid()
  and public.is_company_member(company_id)
);

create policy app_settings_update_company_scope
on public.app_settings
for update
using (
  setting_scope = 'company'
  and user_id is null
  and public.can_manage_company(company_id)
)
with check (
  setting_scope = 'company'
  and user_id is null
  and public.can_manage_company(company_id)
);

create policy app_settings_update_user_scope
on public.app_settings
for update
using (
  setting_scope = 'user'
  and user_id = auth.uid()
  and public.is_company_member(company_id)
)
with check (
  setting_scope = 'user'
  and user_id = auth.uid()
  and public.is_company_member(company_id)
);

-- audit_events
create policy audit_events_select_members
on public.audit_events
for select
using (public.is_company_member(company_id));

create policy audit_events_insert_member_path
on public.audit_events
for insert
to authenticated
with check (
  public.can_write_company_records(company_id)
  and actor_id = auth.uid()
);

-- migration_batches
create policy migration_batches_select_owner_admin
on public.migration_batches
for select
using (public.can_manage_company(company_id));

create policy migration_batches_insert_owner_admin
on public.migration_batches
for insert
with check (public.can_manage_company(company_id));

create policy migration_batches_update_owner_admin
on public.migration_batches
for update
using (public.can_manage_company(company_id))
with check (public.can_manage_company(company_id));

-- migration_write_results
create policy migration_write_results_select_owner_admin
on public.migration_write_results
for select
using (public.can_manage_company(company_id));

create policy migration_write_results_insert_owner_admin
on public.migration_write_results
for insert
with check (public.can_manage_company(company_id));

create policy migration_write_results_update_owner_admin
on public.migration_write_results
for update
using (public.can_manage_company(company_id))
with check (public.can_manage_company(company_id));

-- -----------------------------------------------------------------------------
-- Authenticated Grants
-- -----------------------------------------------------------------------------

revoke all privileges on all tables in schema public from authenticated;
revoke all privileges on all functions in schema public from authenticated;

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

-- -----------------------------------------------------------------------------
-- Comments / Safety Notes
-- -----------------------------------------------------------------------------

comment on table public.companies is
  'REVIEW ARTIFACT ONLY. Not deployed. No runtime wiring. Company-owned records use company_id.';

comment on table public.company_users is
  'Membership table. Owner/admin manage membership; viewer remains read-only.';

comment on table public.customers is
  'Archive/soft-delete preferred. Hard delete should remain restricted when linked records exist.';

comment on table public.projects is
  'Archive/soft-delete preferred. Hard delete should remain restricted when linked records exist.';

comment on table public.estimates is
  'Separate estimate number space per company. Future stricter handling required for sent/approved records.';

comment on table public.invoices is
  'Separate invoice number space per company. Future stricter handling required for paid/partial/void records.';

comment on table public.invoice_payments is
  'Payment safety: do not encourage casual deletion or silent replacement.';

comment on table public.scope_templates is
  'Company-scoped templates by default. Future user-specific scoping is not introduced here.';

comment on table public.app_settings is
  'App settings scope behavior: company settings default for shared/company behavior; user settings for personal UI preferences.';

comment on table public.audit_events is
  'Append-only by design. Audit rows are company-scoped and should not be casually updated or deleted.';

comment on table public.migration_batches is
  'Migration traceability table. Owner/admin only. Production execution remains blocked until separate approval.';

comment on table public.migration_write_results is
  'Migration traceability table. Owner/admin only. Production execution remains blocked until separate approval.';

comment on function public.is_company_member(uuid) is
  'RLS helper: active company membership based on auth.uid().';

comment on function public.company_role(uuid) is
  'RLS helper: returns the active role for auth.uid() within a company.';

comment on function public.can_manage_company(uuid) is
  'RLS helper: owner/admin only.';

comment on function public.can_write_company_records(uuid) is
  'RLS helper: owner/admin/member can write operational records where allowed.';

-- -----------------------------------------------------------------------------
-- Optional verification queries (commented examples only; do not execute here)
-- -----------------------------------------------------------------------------

-- select table_name
-- from information_schema.tables
-- where table_schema = 'public'
--   and table_name in (
--     'companies','company_users','customers','projects','estimates',
--     'estimate_line_items','invoices','invoice_line_items','invoice_payments',
--     'scope_templates','app_settings','audit_events','migration_batches',
--     'migration_write_results'
--   );

-- select tablename, rowsecurity
-- from pg_tables
-- where schemaname = 'public'
--   and tablename in (
--     'companies','company_users','customers','projects','estimates',
--     'estimate_line_items','invoices','invoice_line_items','invoice_payments',
--     'scope_templates','app_settings','audit_events','migration_batches',
--     'migration_write_results'
--   );

-- select schemaname, tablename, policyname
-- from pg_policies
-- where schemaname = 'public'
--   and tablename in (
--     'companies','company_users','customers','projects','estimates',
--     'estimate_line_items','invoices','invoice_line_items','invoice_payments',
--     'scope_templates','app_settings','audit_events','migration_batches',
--     'migration_write_results'
--   );

-- select indexname, tablename
-- from pg_indexes
-- where schemaname = 'public'
--   and tablename in (
--     'companies','company_users','customers','projects','estimates',
--     'estimate_line_items','invoices','invoice_line_items','invoice_payments',
--     'scope_templates','app_settings','audit_events','migration_batches',
--     'migration_write_results'
--   );
