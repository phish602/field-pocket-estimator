-- EstiPaid Security R2.3B — DESTRUCTIVE rollback.
-- Execute only with separate destructive authorization after R2.3B application
-- code has been removed. This drops replay history and stale/deletion barriers;
-- never use it for an ordinary application rollback.
-- It alters no R2.3A billing table, app_settings, companies, or R2.2 quota object.

begin;

drop function if exists public.apply_stripe_subscription_webhook_event(text, timestamptz, timestamptz, text, uuid, text, text, text, text, timestamptz);
drop table if exists public.stripe_subscription_webhook_events;
drop table if exists public.stripe_subscription_webhook_ordering;

commit;
