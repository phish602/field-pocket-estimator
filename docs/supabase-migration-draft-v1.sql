-- REVIEW ARTIFACT ONLY
-- NOT DEPLOYED
-- NOT A MIGRATION TO RUN
-- DO NOT EXECUTE WITHOUT SEPARATE REVIEW
-- No runtime wiring. No backend writes. No Supabase deployment.

-- Draft-only SQL for backend V1 review. This file documents the intended
-- schema shape, relationships, constraints, and lookup indexes before any
-- real migration is created.

-- NOTE: A real deployment would need pgcrypto for gen_random_uuid().

create table if not exists companies (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  display_name text,
  phone text,
  email text,
  address text,
  stripe_account_id text,
  created_by uuid,
  updated_by uuid,
  legacy_local_id text,
  migration_batch_id text,
  migrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

comment on table companies is
  'Draft-only backend company boundary. Review artifact only; no runtime wiring.';
comment on column companies.legacy_local_id is
  'Preserves localStorage traceability for migration review.';
comment on column companies.archived_at is
  'Soft-delete/archive intent. Prefer archive over hard delete.';

create table if not exists company_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  user_id uuid not null,
  role text not null,
  status text not null default 'active',
  invited_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  migration_batch_id text,
  legacy_local_id text
);

alter table company_users
  add constraint company_users_role_check
  check (role in ('owner', 'admin', 'member', 'viewer'));

comment on table company_users is
  'Company membership and role control. Draft-only review artifact.';

create unique index if not exists company_users_company_id_user_id_key
  on company_users (company_id, user_id);
create index if not exists company_users_company_id_idx
  on company_users (company_id);
create index if not exists company_users_user_id_idx
  on company_users (user_id);

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  display_name text,
  company_name text,
  contact_name text,
  phone text,
  email text,
  address text,
  billing_address text,
  customer_type text,
  status text,
  net_terms_type text,
  net_terms_days integer,
  created_by uuid,
  updated_by uuid,
  legacy_local_id text,
  migration_batch_id text,
  migrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid
);

create index if not exists customers_company_id_idx on customers (company_id);
create index if not exists customers_legacy_local_id_idx on customers (legacy_local_id);
create index if not exists customers_migration_batch_id_idx on customers (migration_batch_id);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  project_number text,
  project_name text,
  site_address text,
  notes text,
  scope_summary text,
  status text not null default 'draft',
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  legacy_local_id text,
  migration_batch_id text,
  migrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table projects
  add constraint projects_status_check
  check (status in ('draft', 'active', 'completed', 'archived'));

comment on table projects is
  'Projects should prefer archive/soft-delete over hard delete when real documents exist.';

create index if not exists projects_company_id_idx on projects (company_id);
create index if not exists projects_customer_id_idx on projects (customer_id);
create index if not exists projects_legacy_local_id_idx on projects (legacy_local_id);
create index if not exists projects_migration_batch_id_idx on projects (migration_batch_id);

create table if not exists estimates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  estimate_number text,
  status text not null default 'draft',
  customer_name text,
  project_name text,
  project_number text,
  work_title text,
  doc_type text not null default 'estimate',
  converted_invoice_id uuid,
  converted_invoice_number text,
  total numeric(14,2),
  total_cost numeric(14,2),
  gross_profit numeric(14,2),
  gross_margin numeric(14,2),
  gross_margin_pct numeric(10,4),
  approved_total numeric(14,2),
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  legacy_local_id text,
  migration_batch_id text,
  migrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table estimates
  add constraint estimates_status_check
  check (status in ('draft', 'pending', 'sent', 'approved', 'lost'));

comment on table estimates is
  'Estimate numbers stay in a company-scoped space separate from invoices.';

create index if not exists estimates_company_id_idx on estimates (company_id);
create index if not exists estimates_customer_id_idx on estimates (customer_id);
create index if not exists estimates_project_id_idx on estimates (project_id);
create index if not exists estimates_legacy_local_id_idx on estimates (legacy_local_id);
create index if not exists estimates_migration_batch_id_idx on estimates (migration_batch_id);
create unique index if not exists estimates_company_estimate_number_key
  on estimates (company_id, estimate_number);

create table if not exists estimate_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  estimate_id uuid not null references estimates(id) on delete cascade,
  description text,
  quantity numeric(14,4),
  unit_price numeric(14,2),
  unit_cost numeric(14,2),
  total numeric(14,2),
  sort_order integer,
  created_by uuid,
  updated_by uuid,
  legacy_local_id text,
  migration_batch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists estimate_line_items_company_id_idx on estimate_line_items (company_id);
create index if not exists estimate_line_items_estimate_id_idx on estimate_line_items (estimate_id);
create index if not exists estimate_line_items_legacy_local_id_idx on estimate_line_items (legacy_local_id);
create index if not exists estimate_line_items_migration_batch_id_idx on estimate_line_items (migration_batch_id);

create table if not exists invoices (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  customer_id uuid references customers(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  source_estimate_id uuid references estimates(id) on delete set null,
  invoice_number text,
  estimate_number text,
  status text not null default 'draft',
  payment_status text not null default 'unpaid',
  total numeric(14,2),
  amount_paid numeric(14,2),
  balance_remaining numeric(14,2),
  due_date date,
  invoice_date date,
  customer_name text,
  project_name text,
  project_number text,
  work_title text,
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  legacy_local_id text,
  migration_batch_id text,
  migrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table invoices
  add constraint invoices_status_check
  check (status in ('draft', 'sent', 'partial', 'paid', 'overdue', 'void'));

comment on table invoices is
  'Invoice numbers stay in a company-scoped space separate from estimates.';

create index if not exists invoices_company_id_idx on invoices (company_id);
create index if not exists invoices_customer_id_idx on invoices (customer_id);
create index if not exists invoices_project_id_idx on invoices (project_id);
create index if not exists invoices_source_estimate_id_idx on invoices (source_estimate_id);
create index if not exists invoices_legacy_local_id_idx on invoices (legacy_local_id);
create index if not exists invoices_migration_batch_id_idx on invoices (migration_batch_id);
create unique index if not exists invoices_company_invoice_number_key
  on invoices (company_id, invoice_number);

create table if not exists invoice_line_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  description text,
  quantity numeric(14,4),
  unit_price numeric(14,2),
  unit_cost numeric(14,2),
  total numeric(14,2),
  sort_order integer,
  created_by uuid,
  updated_by uuid,
  legacy_local_id text,
  migration_batch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists invoice_line_items_company_id_idx on invoice_line_items (company_id);
create index if not exists invoice_line_items_invoice_id_idx on invoice_line_items (invoice_id);
create index if not exists invoice_line_items_legacy_local_id_idx on invoice_line_items (legacy_local_id);
create index if not exists invoice_line_items_migration_batch_id_idx on invoice_line_items (migration_batch_id);

create table if not exists invoice_payments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  invoice_id uuid not null references invoices(id) on delete cascade,
  amount numeric(14,2) not null,
  method text,
  status text,
  paid_at timestamptz,
  created_by uuid,
  updated_by uuid,
  legacy_local_id text,
  migration_batch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table invoice_payments is
  'Payment rows belong to invoices. Avoid casual deletion; leave stricter runtime behavior for later review.';

create index if not exists invoice_payments_company_id_idx on invoice_payments (company_id);
create index if not exists invoice_payments_invoice_id_idx on invoice_payments (invoice_id);
create index if not exists invoice_payments_legacy_local_id_idx on invoice_payments (legacy_local_id);
create index if not exists invoice_payments_migration_batch_id_idx on invoice_payments (migration_batch_id);

create table if not exists scope_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  name text,
  scope_text text,
  created_by uuid,
  updated_by uuid,
  archived_at timestamptz,
  archived_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  legacy_local_id text,
  migration_batch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table scope_templates is
  'Template scope text is company-scoped in the first draft; keep attachment/photo runtime behavior untouched.';

create index if not exists scope_templates_company_id_idx on scope_templates (company_id);
create index if not exists scope_templates_legacy_local_id_idx on scope_templates (legacy_local_id);
create index if not exists scope_templates_migration_batch_id_idx on scope_templates (migration_batch_id);

create table if not exists app_settings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  user_id uuid,
  setting_scope text not null default 'company',
  settings jsonb not null default '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  legacy_local_id text,
  migration_batch_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table app_settings is
  'Settings may be company-wide or user-specific in later review; keep scope flexible in the first draft.';

create index if not exists app_settings_company_id_idx on app_settings (company_id);
create index if not exists app_settings_user_id_idx on app_settings (user_id);
create index if not exists app_settings_legacy_local_id_idx on app_settings (legacy_local_id);
create index if not exists app_settings_migration_batch_id_idx on app_settings (migration_batch_id);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  actor_user_id uuid,
  type text not null,
  target_type text,
  target_id text,
  related_ids text[],
  source text,
  reason text,
  before_hash text,
  after_hash text,
  metadata jsonb not null default '{}'::jsonb,
  legacy_local_id text,
  migration_batch_id text,
  created_at timestamptz not null default now()
);

comment on table audit_events is
  'Append-only by design notes. Avoid casual update/delete behavior in the first draft.';

create index if not exists audit_events_company_created_at_idx
  on audit_events (company_id, created_at desc);
create index if not exists audit_events_company_id_idx
  on audit_events (company_id);
create index if not exists audit_events_actor_user_id_idx
  on audit_events (actor_user_id);
create index if not exists audit_events_migration_batch_id_idx
  on audit_events (migration_batch_id);

create table if not exists migration_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  created_by uuid,
  migration_batch_id text not null,
  status text not null default 'queued',
  started_at timestamptz,
  completed_at timestamptz,
  attempted_count integer not null default 0,
  successful_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists migration_batches_migration_batch_id_key
  on migration_batches (migration_batch_id);
create index if not exists migration_batches_company_id_idx
  on migration_batches (company_id);

create table if not exists migration_write_results (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  migration_batch_id uuid not null references migration_batches(id) on delete cascade,
  entity_type text not null,
  entity_id text,
  legacy_local_id text,
  result_status text not null,
  failure_reason text,
  retry_eligible boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table migration_write_results is
  'Per-entity write results for a migration batch. Keep this review-only until separate execution approval.';

create index if not exists migration_write_results_company_id_idx
  on migration_write_results (company_id);
create index if not exists migration_write_results_batch_id_idx
  on migration_write_results (migration_batch_id);
create index if not exists migration_write_results_entity_type_idx
  on migration_write_results (entity_type);
create index if not exists migration_write_results_legacy_local_id_idx
  on migration_write_results (legacy_local_id);

-- Draft-only SQL should not include RLS policies, grants, triggers, seed data,
-- or runtime client wiring. Those remain separate review steps.

