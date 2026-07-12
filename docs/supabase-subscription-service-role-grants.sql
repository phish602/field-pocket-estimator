-- EstiPaid subscription service-role grants
-- Required for server-side Stripe checkout authorization and webhook plan-state sync.
-- These grants do not expose access to browser/anon users.
-- They allow trusted server-side Supabase service_role operations only.

grant usage on schema public to service_role;

-- Stripe checkout authorization checks whether the verified Supabase user
-- is an owner/admin member of the requested company.
grant select on table public.company_users to service_role;

-- Stripe subscription webhooks write the server-authoritative subscription state.
grant select, insert, update on table public.app_settings to service_role;
