-- EstiPaid Gate 17A.1 — company_stripe_billing_refs (forward migration)
--
-- PURPOSE
-- Stripe customer/subscription identifiers are billing plumbing, not app data.
-- They currently live inside app_settings.subscription_plan_state, which the
-- browser CAN read under RLS (the earlier RLS patch blocks writes only), so
-- those identifiers end up in localStorage caches. They serve no browser
-- purpose. This table moves them behind service_role and leaves app_settings
-- holding only safe subscription facts (plan/status/source).
--
-- SECURITY (applying the Gate 17A-R lesson)
-- Supabase ships default privileges granting broad access on new public tables
-- to service_role, so an additive GRANT alone is NOT sufficient -- a fresh table
-- silently arrives with TRUNCATE/REFERENCES/TRIGGER. Every REVOKE below is
-- load-bearing.
--
-- Applies to: public.company_stripe_billing_refs only.
-- Step 1 of a staged rollout: this file only CREATES the table and COPIES the
-- identifiers. It does not scrub app_settings -- see the -cleanup file, which is
-- run only after the new code is live. That ordering guarantees no interval
-- where running code needs data that has already been removed.

begin;

create table if not exists public.company_stripe_billing_refs (
  company_id uuid primary key references public.companies(id) on delete cascade,
  stripe_customer_id text null,
  stripe_subscription_id text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Present means meaningful: never an empty string masquerading as an id.
  constraint company_stripe_billing_refs_customer_nonblank_check
    check (stripe_customer_id is null or btrim(stripe_customer_id) <> ''),
  constraint company_stripe_billing_refs_subscription_nonblank_check
    check (stripe_subscription_id is null or btrim(stripe_subscription_id) <> '')
);

-- One Stripe customer / subscription maps to at most one company. This is what
-- prevents a duplicate-customer bug: checkout looks the id up here, and the
-- database refuses to let two companies claim the same one.
create unique index if not exists company_stripe_billing_refs_customer_uniq_idx
  on public.company_stripe_billing_refs (stripe_customer_id)
  where stripe_customer_id is not null;

create unique index if not exists company_stripe_billing_refs_subscription_uniq_idx
  on public.company_stripe_billing_refs (stripe_subscription_id)
  where stripe_subscription_id is not null;

alter table public.company_stripe_billing_refs enable row level security;

-- No anon/authenticated policies are created. With RLS enabled and no policy,
-- browser clients are denied by default -- belt and braces alongside the
-- privilege revokes below.
revoke all on table public.company_stripe_billing_refs from anon;
revoke all on table public.company_stripe_billing_refs from authenticated;

-- REVOKE FIRST: strip Supabase's broad default grant, then re-add exactly the
-- three privileges the server needs. Without the revoke, service_role would
-- retain DELETE/TRUNCATE/REFERENCES/TRIGGER.
revoke all on table public.company_stripe_billing_refs from service_role;
grant select, insert, update on table public.company_stripe_billing_refs to service_role;

-- Copy existing identifiers out of the browser-readable subscription row.
-- Idempotent: re-running refreshes ids rather than duplicating rows. Only rows
-- that actually carry an identifier are copied.
insert into public.company_stripe_billing_refs (company_id, stripe_customer_id, stripe_subscription_id)
select
  s.company_id,
  nullif(btrim(coalesce(s.setting_value->>'stripeCustomerId', s.setting_value->>'stripe_customer_id', '')), ''),
  nullif(btrim(coalesce(s.setting_value->>'stripeSubscriptionId', s.setting_value->>'stripe_subscription_id', '')), '')
from public.app_settings s
where s.setting_scope = 'company'
  and s.setting_key = 'subscription_plan_state'
  and s.company_id is not null
  and (
    nullif(btrim(coalesce(s.setting_value->>'stripeCustomerId', s.setting_value->>'stripe_customer_id', '')), '') is not null
    or nullif(btrim(coalesce(s.setting_value->>'stripeSubscriptionId', s.setting_value->>'stripe_subscription_id', '')), '') is not null
  )
on conflict (company_id) do update
  set stripe_customer_id = coalesce(excluded.stripe_customer_id, public.company_stripe_billing_refs.stripe_customer_id),
      stripe_subscription_id = coalesce(excluded.stripe_subscription_id, public.company_stripe_billing_refs.stripe_subscription_id),
      updated_at = now();

commit;

-- NEXT STEPS (in this order):
--   1. Deploy the code that reads/writes identifiers here.
--   2. Run docs/supabase-company-stripe-billing-refs-v1-cleanup.sql to scrub the
--      identifiers out of app_settings.
--   3. Verify with docs/supabase-company-stripe-billing-refs-v1-verification.sql
