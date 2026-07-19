/** @jest-environment node */

const { processStripeSubscriptionWebhook } = require("../../server/stripeSubscriptionWebhook");

const ENV = {
  STRIPE_SOLO_PRICE_ID: "price_solo",
  STRIPE_PRO_PRICE_ID: "price_pro",
  STRIPE_BUSINESS_PRICE_ID: "price_business",
};

// Company ids that reach a real write must be valid UUIDs (R2.3A identity
// guard). These stand in for the mapped company across the fixtures.
const COMPANY_1 = "11111111-1111-4111-8111-111111111111";
const COMPANY_FROM_CUSTOMER = "22222222-2222-4222-8222-222222222222";
const COMPANY_FROM_CHECKOUT = "33333333-3333-4333-8333-333333333333";

function subscription({ companyId = COMPANY_1, priceId = "price_pro", status = "active", customer = { id: "cus_1" }, id = "sub_1" } = {}) {
  return {
    id,
    metadata: companyId ? { companyId } : {},
    customer,
    status,
    current_period_end: 1893456000,
    items: { data: [{ price: { id: priceId } }] },
  };
}

function stripeFor(event, { throwOnVerify = false, retrievedSubscription = null } = {}) {
  return {
    webhooks: {
      constructEvent: jest.fn(() => {
        if (throwOnVerify) throw new Error("bad signature");
        return event;
      }),
    },
    subscriptions: { retrieve: jest.fn(async () => retrievedSubscription) },
  };
}

async function process(event, options = {}) {
  const upsertPlanState = options.upsertPlanState || jest.fn(async () => ({ ok: true }));
  // Gate 17A.1a: identifiers are written to private service-role-only storage.
  const upsertBillingRef = options.upsertBillingRef || jest.fn(async () => ({ ok: true, code: "stored", written: true }));
  const result = await processStripeSubscriptionWebhook({
    rawBody: Buffer.from("signed payload"),
    signature: "sig_test",
    stripe: options.stripe || stripeFor(event),
    webhookSecret: "whsec_test",
    env: ENV,
    upsertPlanState,
    upsertBillingRef,
    logger: { warn: jest.fn(), error: jest.fn() },
  });
  return { result, upsertPlanState, upsertBillingRef };
}

describe("Stripe subscription webhook", () => {
  test("rejects an invalid signature without any Stripe retrieve or write", async () => {
    const upsertPlanState = jest.fn();
    const upsertBillingRef = jest.fn();
    const stripe = stripeFor({}, { throwOnVerify: true });
    const result = await processStripeSubscriptionWebhook({
      rawBody: Buffer.from("tampered"), signature: "bad", stripe, webhookSecret: "whsec_test", env: ENV, upsertPlanState, upsertBillingRef,
    });
    expect(result).toEqual({ status: 400, body: { error: "Invalid Stripe webhook signature." } });
    // A failed signature must terminate before any privileged or provider work.
    expect(upsertPlanState).not.toHaveBeenCalled();
    expect(upsertBillingRef).not.toHaveBeenCalled();
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
  });

  test("writes a normalized active Pro state from a verified subscription", async () => {
    const { result, upsertPlanState } = await process({ type: "customer.subscription.updated", data: { object: subscription() } });
    expect(result.status).toBe(200);
    expect(upsertPlanState).toHaveBeenCalledWith({
      companyId: COMPANY_1, plan: "pro", status: "active", source: "stripe", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", currentPeriodEnd: "2030-01-01T00:00:00.000Z",
    });
  });

  test("maps Solo, Pro, Business, past_due, and deleted subscriptions conservatively", async () => {
    const trialingSolo = await process({ type: "customer.subscription.created", data: { object: subscription({ priceId: "price_solo", status: "trialing" }) } });
    expect(trialingSolo.upsertPlanState).toHaveBeenCalledWith(expect.objectContaining({ plan: "solo", status: "trialing" }));
    const activeBusiness = await process({ type: "customer.subscription.updated", data: { object: subscription({ priceId: "price_business", status: "active" }) } });
    expect(activeBusiness.upsertPlanState).toHaveBeenCalledWith(expect.objectContaining({ plan: "business", status: "active" }));

    const pastDue = await process({ type: "customer.subscription.updated", data: { object: subscription({ status: "past_due" }) } });
    expect(pastDue.upsertPlanState).toHaveBeenCalledWith(expect.objectContaining({ plan: "pro", status: "past_due" }));

    const deleted = await process({ type: "customer.subscription.deleted", data: { object: subscription({ status: "active" }) } });
    expect(deleted.upsertPlanState).toHaveBeenCalledWith(expect.objectContaining({ plan: "pro", status: "canceled" }));
  });

  test("does not write when a verified event has no trusted company mapping", async () => {
    const { result, upsertPlanState } = await process({ type: "customer.subscription.updated", data: { object: subscription({ companyId: "", customer: "cus_1" }) } });
    expect(result).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(upsertPlanState).not.toHaveBeenCalled();
  });

  test("uses Free and unknown status for an unmapped subscription price", async () => {
    const { result, upsertPlanState } = await process({ type: "customer.subscription.updated", data: { object: subscription({ priceId: "price_other" }) } });
    expect(result.status).toBe(200);
    expect(upsertPlanState).toHaveBeenCalledWith(expect.objectContaining({ plan: "free", status: "unknown" }));
  });

  test("does not write checkout completion without trusted metadata", async () => {
    const checkoutSubscription = subscription({ companyId: "", customer: "cus_1" });
    const stripe = stripeFor({
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", subscription: "sub_1", metadata: {}, customer: "cus_1" } },
    }, { retrievedSubscription: checkoutSubscription });
    const { result, upsertPlanState } = await process(null, { stripe });
    expect(result).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(upsertPlanState).not.toHaveBeenCalled();
  });

  test("uses Checkout metadata before customer metadata for a retrieved subscription", async () => {
    const checkoutSubscription = subscription({
      companyId: "",
      customer: { id: "cus_1", metadata: { companyId: COMPANY_FROM_CUSTOMER } },
    });
    const stripe = stripeFor({
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", subscription: "sub_1", metadata: { companyId: COMPANY_FROM_CHECKOUT } } },
    }, { retrievedSubscription: checkoutSubscription });
    const { result, upsertPlanState } = await process(null, { stripe });
    expect(result.status).toBe(200);
    expect(upsertPlanState).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY_FROM_CHECKOUT }));
  });
});

// ---------------------------------------------------------------------------
// R2.3A: a mapped company id must be a valid UUID before any write. A non-UUID
// (or missing) mapping is ignored with 200 -- never 500, which Stripe would
// retry forever -- and never produces a billing-ref or plan-state write. The
// identifier value is never echoed back or logged.
// ---------------------------------------------------------------------------
describe("R2.3A webhook company identity guard", () => {
  const event = (sub) => ({ type: "customer.subscription.updated", data: { object: sub } });

  test.each([
    ["a non-UUID metadata company id", "company_1"],
    ["an almost-UUID company id", "11111111-1111-4111-8111-11111111111"],
    ["an empty company id", ""],
  ])("ignores %s with 200 and performs zero writes", async (_name, companyId) => {
    const { result, upsertPlanState, upsertBillingRef } = await process(event(subscription({ companyId })));
    expect(result).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(upsertPlanState).not.toHaveBeenCalled();
    expect(upsertBillingRef).not.toHaveBeenCalled();
  });

  test("ignores a non-UUID checkout mapping with zero writes", async () => {
    const checkoutSubscription = subscription({ companyId: "" });
    const stripe = stripeFor({
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", subscription: "sub_1", metadata: { companyId: "not-a-uuid" } } },
    }, { retrievedSubscription: checkoutSubscription });
    const { result, upsertPlanState, upsertBillingRef } = await process(null, { stripe });
    expect(result).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(upsertPlanState).not.toHaveBeenCalled();
    expect(upsertBillingRef).not.toHaveBeenCalled();
  });

  test("never logs or returns the rejected identifier", async () => {
    const secret = "company-SECRET-not-a-uuid";
    const logger = { warn: jest.fn(), error: jest.fn() };
    const result = await processStripeSubscriptionWebhook({
      rawBody: Buffer.from("signed payload"),
      signature: "sig_test",
      stripe: stripeFor(event(subscription({ companyId: secret }))),
      webhookSecret: "whsec_test",
      env: ENV,
      upsertPlanState: jest.fn(),
      upsertBillingRef: jest.fn(),
      logger,
    });
    expect(result.status).toBe(200);
    const surfaced = JSON.stringify([result.body, logger.warn.mock.calls, logger.error.mock.calls]);
    expect(surfaced).not.toContain(secret);
  });

  test("a valid UUID mapping still writes normally", async () => {
    const { result, upsertPlanState, upsertBillingRef } = await process(event(subscription({ companyId: COMPANY_1 })));
    expect(result.status).toBe(200);
    expect(upsertBillingRef).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY_1 }));
    expect(upsertPlanState).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY_1 }));
  });
});

// ---------------------------------------------------------------------------
// Gate 17A.1a: Stripe identifiers are written ONLY to private service-role
// storage. The browser-readable app_settings row keeps safe facts alone.
// Identifiers in these fixtures are fake.
// ---------------------------------------------------------------------------
describe("Gate 17A.1a private identifier storage", () => {
  const event = (sub) => ({ type: "customer.subscription.updated", data: { object: sub } });

  test("identifiers go to private storage, keyed by the mapped company", async () => {
    const sub = subscription({ companyId: COMPANY_1, customer: { id: "cus_FAKE1" }, id: "sub_FAKE1" });
    const { result, upsertBillingRef } = await process(event(sub));

    expect(result.status).toBe(200);
    expect(upsertBillingRef).toHaveBeenCalledTimes(1);
    expect(upsertBillingRef).toHaveBeenCalledWith(expect.objectContaining({
      companyId: COMPANY_1, stripeCustomerId: "cus_FAKE1", stripeSubscriptionId: "sub_FAKE1",
    }));
  });

  test("the private write happens BEFORE the plan-state write", async () => {
    const order = [];
    const upsertBillingRef = jest.fn(async () => { order.push("ref"); return { ok: true }; });
    const upsertPlanState = jest.fn(async () => { order.push("plan"); return { ok: true }; });
    await process(event(subscription()), { upsertBillingRef, upsertPlanState });
    // Ordering matters: a later failure must never drop the customer id.
    expect(order).toEqual(["ref", "plan"]);
  });

  test("a failed private write aborts before the plan row is touched", async () => {
    const upsertPlanState = jest.fn();
    const { result } = await process(event(subscription()), {
      upsertBillingRef: jest.fn(async () => ({ ok: false, code: "write_failed" })),
      upsertPlanState,
    });
    expect(result.status).toBe(500);
    expect(upsertPlanState).not.toHaveBeenCalled();
  });

  test("a subscription with no identifiers skips the private write entirely", async () => {
    const sub = subscription({ customer: null, id: "" });
    const { upsertBillingRef } = await process(event(sub));
    expect(upsertBillingRef).not.toHaveBeenCalled();
  });

  test("the private write failure is logged without the identifier values", async () => {
    const logger = { warn: jest.fn(), error: jest.fn() };
    await processStripeSubscriptionWebhook({
      rawBody: Buffer.from("signed payload"),
      signature: "sig_test",
      stripe: stripeFor(event(subscription({ customer: { id: "cus_FAKE_SECRET" }, id: "sub_FAKE_SECRET" }))),
      webhookSecret: "whsec_test",
      env: ENV,
      upsertBillingRef: jest.fn(async () => ({ ok: false, code: "write_failed" })),
      upsertPlanState: jest.fn(async () => ({ ok: true })),
      logger,
    });
    const logged = JSON.stringify(logger.error.mock.calls);
    expect(logged).not.toContain("cus_FAKE_SECRET");
    expect(logged).not.toContain("sub_FAKE_SECRET");
  });
});
