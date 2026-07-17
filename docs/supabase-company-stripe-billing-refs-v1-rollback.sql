-- EstiPaid Gate 17A.1 — company_stripe_billing_refs (rollback)
--
-- WARNING: dropping this table destroys the ONLY remaining copy of the Stripe
-- customer/subscription identifiers once the cleanup step has scrubbed
-- app_settings. Export them first if they still matter:
--
--   select company_id, stripe_customer_id, stripe_subscription_id
--   from public.company_stripe_billing_refs;
--
-- Losing them does not break entitlements (plan/status live in app_settings and
-- resolve normally), but Stripe checkout would create a NEW customer for an
-- existing subscriber rather than reusing theirs. Restore identifiers before
-- letting anyone re-subscribe.
--
-- Alters no other table.

begin;

revoke all on table public.company_stripe_billing_refs from service_role;

drop index if exists public.company_stripe_billing_refs_subscription_uniq_idx;
drop index if exists public.company_stripe_billing_refs_customer_uniq_idx;

drop table if exists public.company_stripe_billing_refs;

commit;
