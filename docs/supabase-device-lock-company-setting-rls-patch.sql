-- Narrow runtime patch for the shared active-device lock row.
-- Purpose:
-- - Keep using public.app_settings as the company-scoped storage location.
-- - Allow active company members (not just owner/admin) to claim/take over
--   the single shared active-device row used by the frontend.
-- - Limit the broader write expansion strictly to setting_key =
--   'active_device_lock' so other company-scoped settings remain unchanged.

create policy app_settings_insert_company_scope_device_lock_members
on public.app_settings
for insert
with check (
  setting_scope = 'company'
  and company_id is not null
  and user_id is null
  and setting_key = 'active_device_lock'
  and can_write_company_records(company_id)
);

create policy app_settings_update_company_scope_device_lock_members
on public.app_settings
for update
using (
  setting_scope = 'company'
  and company_id is not null
  and user_id is null
  and setting_key = 'active_device_lock'
  and can_write_company_records(company_id)
)
with check (
  setting_scope = 'company'
  and company_id is not null
  and user_id is null
  and setting_key = 'active_device_lock'
  and can_write_company_records(company_id)
);
