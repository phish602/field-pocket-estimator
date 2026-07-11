-- Subscription plan state RLS hardening
-- Purpose:
-- Normal browser clients may read company-scoped subscription_plan_state,
-- but they must not insert/update it. Paid plan state must be written by
-- server-side/service-role logic only.

begin;

drop policy if exists app_settings_insert_company_scope on public.app_settings;

create policy app_settings_insert_company_scope
on public.app_settings
for insert
with check (
  setting_scope = 'company'
  and user_id is null
  and can_manage_company(company_id)
  and setting_key is distinct from 'subscription_plan_state'
);

drop policy if exists app_settings_update_company_scope on public.app_settings;

create policy app_settings_update_company_scope
on public.app_settings
for update
using (
  setting_scope = 'company'
  and user_id is null
  and can_manage_company(company_id)
  and setting_key is distinct from 'subscription_plan_state'
)
with check (
  setting_scope = 'company'
  and user_id is null
  and can_manage_company(company_id)
  and setting_key is distinct from 'subscription_plan_state'
);

commit;
