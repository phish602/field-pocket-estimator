# Stripe subscription webhook setup

The verified subscription endpoint is `POST /api/stripe/subscription-webhook`. It is the only path that writes the company-scoped `subscription_plan_state` from Stripe events.

## Server configuration

Set these as server/runtime environment variables only. Do not prefix them with `REACT_APP_`, do not add them to browser configuration, and do not expose their values in source control.

- `STRIPE_SECRET_KEY` — Stripe secret API key used only to retrieve current subscription state after Checkout completion, subscription creation, and subscription update events.
- `STRIPE_WEBHOOK_SECRET` — signing secret for this endpoint from the Stripe Dashboard.
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — server-only credentials used by the subscription plan-state writer.
- `STRIPE_SOLO_PRICE_ID` — Stripe Price ID for Solo.
- `STRIPE_PRO_PRICE_ID` — Stripe Price ID for Pro.
- `STRIPE_BUSINESS_PRICE_ID` — Stripe Price ID for Business.

Normal browser clients may read this plan-state row but cannot insert or update it; apply [the subscription RLS patch](supabase-subscription-plan-state-rls-patch.sql) before enabling webhooks.

## Stripe metadata and event configuration

Free is the default demo tier and has no Stripe Price. Set `metadata.companyId` to the EstiPaid company ID on every Solo, Pro, or Business Stripe Subscription. When Stripe Checkout creates the subscription, also set the same value on the Checkout Session metadata as a fallback (and preferably on `subscription_data.metadata`). The webhook accepts only this trusted metadata key—never a company name, email address, or browser-provided field.

Configure the Stripe endpoint for these event types:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `checkout.session.completed`

The subscription events are authoritative. Checkout completion, subscription creation, and subscription updates retrieve and use the current subscription first; Checkout metadata is only a company-mapping fallback. A deleted subscription is not retrieved: its signed deletion event writes a terminal tombstone. Events with an invalid signature, no company mapping, or unsupported context do not write plan state. An unknown Stripe price writes the conservative Free/unknown state.

## R2.3B replay and ordering authority

The webhook sends valid mapped state to a service-role-only PostgreSQL RPC. The RPC atomically updates private billing references, safe browser-readable plan state, ordering state, and an applied-event ledger. Browser roles have no access to the replay/order tables, and they store no raw payload, Stripe signature, secret, or arbitrary event JSON.

`event.id` is used only for exact replay detection. `event.created` orders freshness only within one subscription ID; because current-subscription retrieval occurs before the database transaction, distinct equal-second non-deletion events cannot be deterministically ordered, so R2.3B applies only the first successful event at that timestamp and safely ignores later ambiguous ones. A deletion wins at an equal timestamp and creates a permanent tombstone, so no later-delivered non-deletion event can reactivate that subscription ID.

The authority serializes all webhook work for a company before subscription-level decisions. The private billing-reference subscription ID is the current company pointer. Across different subscription IDs, it uses the Stripe Subscription object's immutable `subscription.created` timestamp: only a strictly newer replacement can become current, and it permanently supersedes the prior subscription. Delayed events for a superseded or non-current subscription cannot overwrite company-wide billing or plan state; a non-current deletion records only that subscription's tombstone and applied event. Neither Stripe event IDs nor Stripe subscription IDs are sorted chronologically.

For an unmapped price, a non-deletion event applies `free`/`unknown`; a deletion applies `free`/`canceled`.

Deploy in this order: review SQL; separately authorize and execute the forward SQL; run read-only SQL verification; commit/push reviewed application code; merge/deploy; then run bounded Production verification. An ordinary application rollback leaves the additive authority in place. SQL rollback is destructive, requires separate authorization, and must follow removal of R2.3B application code.

## Local verification

Use Stripe CLI or the Stripe Dashboard to send signed test events to the server endpoint after setting the server-only variables. Never use a real production event merely as a smoke test.

Run the mocked regression suite with:

```bash
CI=true npm test -- --watchAll=false src/lib/stripeSubscriptionWebhook.test.js
```

The test suite performs no Stripe or Supabase network calls.
