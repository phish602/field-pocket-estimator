-- EstiPaid Gate 17A.1 — scrub Stripe identifiers from browser-readable state
--
-- STEP 2 of the staged rollout. Run this ONLY after:
--   1. docs/supabase-company-stripe-billing-refs-v1.sql has been applied
--      (identifiers copied to the private table), AND
--   2. the code that reads identifiers from the private table is live in
--      production.
--
-- Running it earlier would remove identifiers the old code still depends on.
-- Running it later is harmless. This ordering means there is never an interval
-- where live code needs data that has already been deleted.
--
-- WHAT IT DOES
-- Removes ONLY the Stripe identifier fields from
-- app_settings.subscription_plan_state. Every safe field (plan, status, source,
-- updatedAt, currentPeriodEnd) is preserved untouched, so effective plan and
-- billing status do not change. No other setting_key is affected.

begin;

-- Safety net: refuse to scrub anything that was not copied first.
do $$
declare
  unmigrated int;
begin
  select count(*) into unmigrated
  from public.app_settings s
  where s.setting_scope = 'company'
    and s.setting_key = 'subscription_plan_state'
    and (
      nullif(btrim(coalesce(s.setting_value->>'stripeCustomerId', s.setting_value->>'stripe_customer_id', '')), '') is not null
      or nullif(btrim(coalesce(s.setting_value->>'stripeSubscriptionId', s.setting_value->>'stripe_subscription_id', '')), '') is not null
    )
    and not exists (
      select 1 from public.company_stripe_billing_refs r where r.company_id = s.company_id
    );
  if unmigrated > 0 then
    raise exception 'Refusing to scrub: % subscription row(s) still hold identifiers with no private copy. Run the forward migration first.', unmigrated;
  end if;
end $$;

update public.app_settings s
set setting_value = (s.setting_value
      - 'stripeCustomerId'
      - 'stripe_customer_id'
      - 'stripeSubscriptionId'
      - 'stripe_subscription_id'),
    updated_at = now()
where s.setting_scope = 'company'
  and s.setting_key = 'subscription_plan_state'
  and (
    s.setting_value ? 'stripeCustomerId'
    or s.setting_value ? 'stripe_customer_id'
    or s.setting_value ? 'stripeSubscriptionId'
    or s.setting_value ? 'stripe_subscription_id'
  );

commit;
