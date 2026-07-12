# Stripe subscription Checkout setup

Subscription upgrades begin at `POST /api/stripe/create-subscription-checkout`. The endpoint accepts only `solo`, `pro`, or `business`, validates the signed-in user as an active company owner or admin, and maps the request to a server-side Stripe Price ID.

## Server-only environment

Configure these runtime variables in Vercel (or the server host). Never use a `REACT_APP_` prefix and never place secret values in client code or source control.

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SOLO_PRICE_ID`
- `STRIPE_PRO_PRICE_ID`
- `STRIPE_BUSINESS_PRICE_ID`
- `APP_BASE_URL`, such as `https://app.example.com`; `VERCEL_URL` is used as a fallback on Vercel.

Free is the default demo tier and has no Stripe Price. `STRIPE_SOLO_PRICE_ID`, `STRIPE_PRO_PRICE_ID`, and `STRIPE_BUSINESS_PRICE_ID` map only to their matching paid tiers. The browser never supplies a Price ID.

## Metadata and Stripe configuration

The endpoint sends `companyId`, `requestedPlan`, and the verified `userId` (when available) in both Checkout Session metadata and `subscription_data.metadata`. This lets the verified webhook associate subscription events with the EstiPaid company.

Create the webhook at `POST /api/stripe/subscription-webhook` and configure these Stripe events:

- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `checkout.session.completed`

Checkout sends users back to `APP_BASE_URL/?subscriptionCheckout=success` or `...?subscriptionCheckout=cancel`. A success redirect is informational only: it never unlocks the app. The signed Stripe webhook writes `subscription_plan_state`; the app then reads that trusted state to unlock Solo, Pro, or Business behavior.

Apply [the subscription RLS patch](supabase-subscription-plan-state-rls-patch.sql) before enabling the flow. Browser clients can read subscription state but cannot insert or update it.

## Test-mode verification

Use Stripe test Price IDs, a test secret key, and a test webhook signing secret. Sign in as an owner/admin, open Company Profile, choose an upgrade, and confirm the returned Stripe test Checkout URL. Do not complete a paid flow unless explicitly approved. Until a signed webhook event writes the plan state, the Company Profile and PDFs remain Free.
