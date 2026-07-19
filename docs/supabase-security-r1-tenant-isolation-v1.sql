-- EstiPaid Security Gate R1.1 — forward-only tenant isolation and least privilege.
-- Apply only after the separately completed Production integrity audit.
-- This migration intentionally fails on invalid data; it never repairs data.

begin;

do $$
declare
  required_table text;
begin
  foreach required_table in array array[
    'companies', 'company_users', 'customers', 'projects', 'estimates',
    'invoices', 'estimate_line_items', 'invoice_line_items', 'invoice_payments',
    'migration_batches', 'migration_write_results', 'app_settings', 'audit_events',
    'scope_templates', 'company_entitlement_grants', 'company_stripe_billing_refs'
  ] loop
    if to_regclass('public.' || required_table) is null then
      raise exception 'Security R1.1 precondition failed: public.% is missing', required_table;
    end if;
  end loop;

  if exists (
    select 1 from public.company_users
    group by company_id, user_id having count(*) > 1
  ) then
    raise exception 'Security R1.1 refused: duplicate company_users(company_id, user_id) rows exist; resolve them manually before retrying';
  end if;
end $$;

-- Composite keys make each child reference prove its parent belongs to the
-- same company. Existing single-column foreign keys remain untouched.
alter table public.company_users
  add constraint company_users_company_id_user_id_key unique (company_id, user_id);
alter table public.customers
  add constraint customers_company_id_id_key unique (company_id, id);
alter table public.projects
  add constraint projects_company_id_id_key unique (company_id, id);
alter table public.estimates
  add constraint estimates_company_id_id_key unique (company_id, id);
alter table public.invoices
  add constraint invoices_company_id_id_key unique (company_id, id);
alter table public.migration_batches
  add constraint migration_batches_company_id_id_key unique (company_id, id);

alter table public.projects
  add constraint projects_company_customer_fkey
  foreign key (company_id, customer_id) references public.customers (company_id, id)
  on update no action on delete set null (customer_id) not valid;
alter table public.estimates
  add constraint estimates_company_customer_fkey
  foreign key (company_id, customer_id) references public.customers (company_id, id)
  on update no action on delete set null (customer_id) not valid;
alter table public.estimates
  add constraint estimates_company_project_fkey
  foreign key (company_id, project_id) references public.projects (company_id, id)
  on update no action on delete set null (project_id) not valid;
alter table public.invoices
  add constraint invoices_company_customer_fkey
  foreign key (company_id, customer_id) references public.customers (company_id, id)
  on update no action on delete set null (customer_id) not valid;
alter table public.invoices
  add constraint invoices_company_project_fkey
  foreign key (company_id, project_id) references public.projects (company_id, id)
  on update no action on delete set null (project_id) not valid;
alter table public.invoices
  add constraint invoices_company_estimate_fkey
  foreign key (company_id, estimate_id) references public.estimates (company_id, id)
  on update no action on delete set null (estimate_id) not valid;
alter table public.estimate_line_items
  add constraint estimate_line_items_company_estimate_fkey
  foreign key (company_id, estimate_id) references public.estimates (company_id, id)
  on update no action on delete cascade not valid;
alter table public.invoice_line_items
  add constraint invoice_line_items_company_invoice_fkey
  foreign key (company_id, invoice_id) references public.invoices (company_id, id)
  on update no action on delete cascade not valid;
alter table public.invoice_payments
  add constraint invoice_payments_company_invoice_fkey
  foreign key (company_id, invoice_id) references public.invoices (company_id, id)
  on update no action on delete cascade not valid;
alter table public.migration_write_results
  add constraint migration_write_results_company_batch_fkey
  foreign key (company_id, migration_batch_id) references public.migration_batches (company_id, id)
  on update no action on delete cascade not valid;

alter table public.projects validate constraint projects_company_customer_fkey;
alter table public.estimates validate constraint estimates_company_customer_fkey;
alter table public.estimates validate constraint estimates_company_project_fkey;
alter table public.invoices validate constraint invoices_company_customer_fkey;
alter table public.invoices validate constraint invoices_company_project_fkey;
alter table public.invoices validate constraint invoices_company_estimate_fkey;
alter table public.estimate_line_items validate constraint estimate_line_items_company_estimate_fkey;
alter table public.invoice_line_items validate constraint invoice_line_items_company_invoice_fkey;
alter table public.invoice_payments validate constraint invoice_payments_company_invoice_fkey;
alter table public.migration_write_results validate constraint migration_write_results_company_batch_fkey;

-- Remove public and anonymous table access. Revoke authenticated first, then
-- restore only browser DML already required by repository callers. No grants
-- to service_role are changed by this migration.
revoke all privileges on table
  public.app_settings, public.audit_events, public.companies,
  public.company_entitlement_grants, public.company_stripe_billing_refs,
  public.company_users, public.customers, public.estimate_line_items,
  public.estimates, public.invoice_line_items, public.invoice_payments,
  public.invoices, public.migration_batches, public.migration_write_results,
  public.projects, public.scope_templates
from anon;

revoke all privileges on table
  public.app_settings, public.audit_events, public.companies,
  public.company_entitlement_grants, public.company_stripe_billing_refs,
  public.company_users, public.customers, public.estimate_line_items,
  public.estimates, public.invoice_line_items, public.invoice_payments,
  public.invoices, public.migration_batches, public.migration_write_results,
  public.projects, public.scope_templates
from authenticated;

grant select, insert, update on table public.companies to authenticated;
grant select, insert, update, delete on table public.company_users to authenticated;
grant select, insert, update on table public.customers to authenticated;
grant select, insert, update on table public.projects to authenticated;
grant select, insert, update on table public.estimates to authenticated;
grant select, insert, update, delete on table public.estimate_line_items to authenticated;
grant select, insert, update on table public.invoices to authenticated;
grant select, insert, update, delete on table public.invoice_line_items to authenticated;
grant select, insert, update on table public.invoice_payments to authenticated;
grant select, insert, update on table public.migration_batches to authenticated;
grant select, insert, update on table public.migration_write_results to authenticated;
grant select, insert, update on table public.scope_templates to authenticated;
grant select, insert, update on table public.app_settings to authenticated;

-- These relations are server-only: do not grant any browser privilege.
revoke all privileges on table public.audit_events from authenticated;
revoke all privileges on table public.company_entitlement_grants from authenticated;
revoke all privileges on table public.company_stripe_billing_refs from authenticated;

-- RLS helper execution is only needed in authenticated policy evaluation.
revoke execute on function public.is_company_member(uuid) from public, anon;
revoke execute on function public.company_role(uuid) from public, anon;
revoke execute on function public.can_manage_company(uuid) from public, anon;
revoke execute on function public.can_write_company_records(uuid) from public, anon;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.company_role(uuid) to authenticated;
grant execute on function public.can_manage_company(uuid) to authenticated;
grant execute on function public.can_write_company_records(uuid) to authenticated;

-- Event-trigger helper remains owned/used by postgres; no role may call it.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated, service_role;

do $$
declare
  policy_row record;
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'ensure_rls') then
    raise exception 'Security R1.1 precondition failed: ensure_rls event trigger is missing';
  end if;

  -- ALTER POLICY TO changes only its target roles; USING/WITH CHECK text stays
  -- untouched. Process only policies still targeted at PUBLIC.
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in (
        'app_settings', 'companies', 'company_users', 'customers', 'projects',
        'estimates', 'estimate_line_items', 'invoices', 'invoice_line_items',
        'invoice_payments', 'migration_batches', 'migration_write_results',
        'scope_templates'
      )
      and roles @> array['public'::name]
  loop
    execute format('alter policy %I on %I.%I to authenticated',
      policy_row.policyname, policy_row.schemaname, policy_row.tablename);
  end loop;
end $$;

commit;
