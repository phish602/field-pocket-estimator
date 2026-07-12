/** @jest-environment node */

const { processStripeSubscriptionWebhook } = require("../../server/stripeSubscriptionWebhook");

const ENV = {
  STRIPE_SOLO_PRICE_ID: "price_solo",
  STRIPE_PRO_PRICE_ID: "price_pro",
  STRIPE_BUSINESS_PRICE_ID: "price_business",
};

function subscription({ companyId = "company_1", priceId = "price_pro", status = "active", customer = { id: "cus_1" }, id = "sub_1" } = {}) {
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
  const result = await processStripeSubscriptionWebhook({
    rawBody: Buffer.from("signed payload"),
    signature: "sig_test",
    stripe: options.stripe || stripeFor(event),
    webhookSecret: "whsec_test",
    env: ENV,
    upsertPlanState,
    logger: { warn: jest.fn(), error: jest.fn() },
  });
  return { result, upsertPlanState };
}

describe("Stripe subscription webhook", () => {
  test("rejects an invalid signature without writing plan state", async () => {
    const upsertPlanState = jest.fn();
    const result = await processStripeSubscriptionWebhook({
      rawBody: Buffer.from("tampered"), signature: "bad", stripe: stripeFor({}, { throwOnVerify: true }), webhookSecret: "whsec_test", env: ENV, upsertPlanState,
    });
    expect(result).toEqual({ status: 400, body: { error: "Invalid Stripe webhook signature." } });
    expect(upsertPlanState).not.toHaveBeenCalled();
  });

  test("writes a normalized active Pro state from a verified subscription", async () => {
    const { result, upsertPlanState } = await process({ type: "customer.subscription.updated", data: { object: subscription() } });
    expect(result.status).toBe(200);
    expect(upsertPlanState).toHaveBeenCalledWith({
      companyId: "company_1", plan: "pro", status: "active", source: "stripe", stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", currentPeriodEnd: "2030-01-01T00:00:00.000Z",
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
      customer: { id: "cus_1", metadata: { companyId: "company_from_customer" } },
    });
    const stripe = stripeFor({
      type: "checkout.session.completed",
      data: { object: { mode: "subscription", subscription: "sub_1", metadata: { companyId: "company_from_checkout" } } },
    }, { retrievedSubscription: checkoutSubscription });
    const { result, upsertPlanState } = await process(null, { stripe });
    expect(result.status).toBe(200);
    expect(upsertPlanState).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company_from_checkout" }));
  });
});
