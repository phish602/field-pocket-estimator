-- EstiPaid Gate 17A — company_entitlement_grants (rollback)
--
-- Reverses docs/supabase-company-entitlement-grants-v1.sql.
--
-- WARNING: dropping this table destroys internal complimentary grant history,
-- including revocation audit fields. Any company relying on an active internal
-- grant silently falls back to its Stripe plan, or to Free when it has none.
-- That is a fail-closed outcome (never an escalation), but it is not reversible
-- from the application side -- export the rows first if the history matters:
--
--   select * from public.company_entitlement_grants;
--
-- Alters no existing table, policy, or business record.

begin;

revoke all on table public.company_entitlement_grants from service_role;

drop index if exists public.company_entitlement_grants_one_active_per_company_idx;
drop index if exists public.company_entitlement_grants_active_idx;
drop index if exists public.company_entitlement_grants_company_id_idx;

drop table if exists public.company_entitlement_grants;

commit;
