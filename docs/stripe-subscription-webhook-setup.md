# Stripe subscription webhook setup

The verified subscription endpoint is `POST /api/stripe/subscription-webhook`. It is the only path that writes the company-scoped `subscription_plan_state` from Stripe events.

## Server configuration

Set these as server/runtime environment variables only. Do not prefix them with `REACT_APP_`, do not add them to browser configuration, and do not expose their values in source control.

- `STRIPE_SECRET_KEY` — Stripe secret API key used only to retrieve the subscription after a Checkout completion event.
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

The subscription events are authoritative. For Checkout completion, the handler retrieves and uses the subscription first; Checkout metadata is only a company-mapping fallback. Events with an invalid signature, no company mapping, or unsupported context do not write plan state. An unknown Stripe price writes the conservative Free/unknown state.

## Local verification

Use Stripe CLI or the Stripe Dashboard to send signed test events to the server endpoint after setting the server-only variables. Never use a real production event merely as a smoke test.

Run the mocked regression suite with:

```bash
CI=true npm test -- --watchAll=false src/lib/stripeSubscriptionWebhook.test.js
```

The test suite performs no Stripe or Supabase network calls.
