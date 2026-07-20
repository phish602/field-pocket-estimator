/** @jest-environment node */

const { processStripeSubscriptionWebhook } = require("../../server/stripeSubscriptionWebhook");

const ENV = { STRIPE_SOLO_PRICE_ID: "price_solo", STRIPE_PRO_PRICE_ID: "price_pro", STRIPE_BUSINESS_PRICE_ID: "price_business" };
const COMPANY = "11111111-1111-4111-8111-111111111111";
const SESSION_COMPANY = "22222222-2222-4222-8222-222222222222";

function subscription(options = {}) {
  const {
    id = "sub_FAKE", companyId = COMPANY, customer = { id: "cus_FAKE" }, priceId = "price_pro",
    status = "active", period = 1893456000, created,
  } = options;
  const subscriptionCreated = Object.prototype.hasOwnProperty.call(options, "created") ? created : 1880000000;
  return { id, metadata: companyId ? { companyId } : {}, customer, status, current_period_end: period, created: subscriptionCreated, items: { data: [{ price: { id: priceId } }] } };
}

function event(type, object, overrides = {}) {
  return { id: "evt_FAKE", created: 1890000000, type, data: { object }, ...overrides };
}

function stripeFor(signedEvent, { current = null, error = null, verifyError = null } = {}) {
  return {
    webhooks: { constructEvent: jest.fn(() => { if (verifyError) throw verifyError; return signedEvent; }) },
    subscriptions: { retrieve: jest.fn(async () => { if (error) throw error; return current; }) },
  };
}

async function process(signedEvent, options = {}) {
  const applyReplayOrdering = options.applyReplayOrdering || jest.fn(async () => ({ ok: true, category: "applied" }));
  const stripe = options.stripe || stripeFor(signedEvent, { current: options.current || subscription() });
  const logger = options.logger || { warn: jest.fn(), error: jest.fn() };
  const result = await processStripeSubscriptionWebhook({
    rawBody: Buffer.from("signed payload"), signature: "sig_FAKE", stripe, webhookSecret: "whsec_FAKE",
    env: ENV, applyReplayOrdering, logger,
  });
  return { result, stripe, applyReplayOrdering, logger };
}

describe("R2.3B Stripe subscription webhook", () => {
  test("invalid signature returns 400 before retrieval or RPC", async () => {
    const applyReplayOrdering = jest.fn();
    const stripe = stripeFor(null, { verifyError: new Error("bad signature") });
    const { result } = await process(null, { stripe, applyReplayOrdering });
    expect(result).toEqual({ status: 400, body: { error: "Invalid Stripe webhook signature." } });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(applyReplayOrdering).not.toHaveBeenCalled();
  });

  test("unsupported signed event is ignored without retrieval or RPC", async () => {
    const { result, stripe, applyReplayOrdering } = await process(event("invoice.created", {}));
    expect(result).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(applyReplayOrdering).not.toHaveBeenCalled();
  });

  test.each([
    ["missing id", { id: undefined }], ["blank id", { id: "   " }], ["missing created", { created: undefined }],
    ["zero created", { created: 0 }], ["negative created", { created: -1 }], ["fractional created", { created: 1.5 }],
    ["invalid date", { created: Number.MAX_SAFE_INTEGER }],
  ])("rejects %s supported envelope before RPC", async (_name, overrides) => {
    const { result, applyReplayOrdering } = await process(event("customer.subscription.updated", subscription(), overrides));
    expect(result).toEqual({ status: 400, body: { error: "Invalid Stripe webhook event." } });
    expect(applyReplayOrdering).not.toHaveBeenCalled();
  });

  test("created and updated validate signed mapping then retrieve current state", async () => {
    for (const type of ["customer.subscription.created", "customer.subscription.updated"]) {
      const current = subscription({ id: "sub_CURRENT", customer: { id: "cus_CURRENT" }, priceId: "price_business", status: "trialing" });
      const { result, stripe, applyReplayOrdering } = await process(event(type, subscription({ id: "sub_SIGNED" })), { current });
      expect(result.status).toBe(200);
      expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_SIGNED");
      expect(applyReplayOrdering).toHaveBeenCalledWith(expect.objectContaining({
        stripeSubscriptionId: "sub_CURRENT", stripeCustomerId: "cus_CURRENT", plan: "business", status: "trialing",
        eventCreatedAt: "2029-11-22T00:00:00.000Z", stripeSubscriptionCreatedAt: "2029-07-29T06:13:20.000Z",
      }));
    }
  });

  test.each(["", "not-a-uuid"])('lifecycle mapping %p is ignored before retrieval and RPC', async (companyId) => {
    const { result, stripe, applyReplayOrdering } = await process(event("customer.subscription.updated", subscription({ companyId })));
    expect(result).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(applyReplayOrdering).not.toHaveBeenCalled();
  });

  test("checkout retrieves current subscription and retains mapping precedence", async () => {
    const current = subscription({ companyId: COMPANY, customer: { id: "cus_CURRENT", metadata: { companyId: SESSION_COMPANY } } });
    const session = { mode: "subscription", subscription: { id: "sub_CHECKOUT" }, metadata: { companyId: SESSION_COMPANY } };
    const { result, stripe, applyReplayOrdering } = await process(event("checkout.session.completed", session), { current });
    expect(result.status).toBe(200);
    expect(stripe.subscriptions.retrieve).toHaveBeenCalledWith("sub_CHECKOUT");
    expect(applyReplayOrdering).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY }));
  });

  test("checkout uses session then expanded customer mapping fallbacks", async () => {
    const session = { mode: "subscription", subscription: "sub_CHECKOUT", metadata: { companyId: SESSION_COMPANY } };
    const current = subscription({ companyId: "", customer: { id: "cus_CURRENT", metadata: { companyId: COMPANY } } });
    const first = await process(event("checkout.session.completed", session), { current });
    expect(first.applyReplayOrdering).toHaveBeenCalledWith(expect.objectContaining({ companyId: SESSION_COMPANY }));

    const second = await process(event("checkout.session.completed", { ...session, metadata: {} }), { current });
    expect(second.applyReplayOrdering).toHaveBeenCalledWith(expect.objectContaining({ companyId: COMPANY }));
  });

  test("checkout non-subscription mode is ignored and missing subscription is invalid", async () => {
    const nonSubscription = await process(event("checkout.session.completed", { mode: "payment", subscription: "sub_FAKE" }));
    expect(nonSubscription.result).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(nonSubscription.stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    const missing = await process(event("checkout.session.completed", { mode: "subscription" }));
    expect(missing.result).toEqual({ status: 400, body: { error: "Invalid Stripe webhook event." } });
    expect(missing.applyReplayOrdering).not.toHaveBeenCalled();
    const malformedExpanded = await process(event("checkout.session.completed", { mode: "subscription", subscription: {} }));
    expect(malformedExpanded.result).toEqual({ status: 400, body: { error: "Invalid Stripe webhook event." } });
  });

  test("checkout missing mapping is ignored with zero RPC", async () => {
    const { result, applyReplayOrdering } = await process(event("checkout.session.completed", { mode: "subscription", subscription: "sub_FAKE", metadata: {} }), {
      current: subscription({ companyId: "", customer: "cus_FAKE" }),
    });
    expect(result).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(applyReplayOrdering).not.toHaveBeenCalled();
  });

  test("deleted uses the signed snapshot without retrieval and forces canceled", async () => {
    const signed = subscription({ status: "active", priceId: "price_solo" });
    const { result, stripe, applyReplayOrdering } = await process(event("customer.subscription.deleted", signed));
    expect(result.status).toBe(200);
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(applyReplayOrdering).toHaveBeenCalledWith(expect.objectContaining({ plan: "solo", status: "canceled", stripeSubscriptionId: "sub_FAKE", stripeSubscriptionCreatedAt: "2029-07-29T06:13:20.000Z" }));
  });

  test("checkout uses the retrieved subscription creation timestamp", async () => {
    const current = subscription({ created: 1870000000 });
    const { applyReplayOrdering } = await process(event("checkout.session.completed", { mode: "subscription", subscription: "sub_CHECKOUT", metadata: { companyId: COMPANY } }), { current });
    expect(applyReplayOrdering).toHaveBeenCalledWith(expect.objectContaining({ stripeSubscriptionCreatedAt: "2029-04-04T12:26:40.000Z" }));
  });

  test.each([
    ["missing", undefined], ["zero", 0], ["negative", -1], ["fractional", 1.5], ["invalid date", Number.MAX_SAFE_INTEGER],
  ])("invalid subscription.created %s returns 400 without RPC", async (_name, created) => {
    const { result, applyReplayOrdering } = await process(event("customer.subscription.updated", subscription()), {
      current: subscription({ created }),
    });
    expect(result).toEqual({ status: 400, body: { error: "Invalid Stripe webhook event." } });
    expect(applyReplayOrdering).not.toHaveBeenCalled();
  });

  test("deleted event with an unmapped price is free/canceled, never unknown, and succeeds", async () => {
    const { result, stripe, applyReplayOrdering } = await process(event("customer.subscription.deleted", subscription({ priceId: "price_REMOVED" })));
    expect(result).toEqual({ status: 200, body: { received: true } });
    expect(stripe.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(applyReplayOrdering).toHaveBeenCalledTimes(1);
    expect(applyReplayOrdering).toHaveBeenCalledWith(expect.objectContaining({ plan: "free", status: "canceled" }));
    expect(applyReplayOrdering.mock.calls[0][0].status).not.toBe("unknown");
  });

  test("unmapped prices remain conservative free/unknown", async () => {
    const { applyReplayOrdering } = await process(event("customer.subscription.updated", subscription()), {
      current: subscription({ priceId: "price_OTHER", status: "active" }),
    });
    expect(applyReplayOrdering).toHaveBeenCalledWith(expect.objectContaining({ plan: "free", status: "unknown" }));
  });

  test("confirmed Stripe resource-not-found is ignored but other retrieval failures are retryable", async () => {
    const notFound = { type: "StripeInvalidRequestError", code: "resource_missing", statusCode: 404, message: "private" };
    const ignored = await process(event("customer.subscription.updated", subscription()), { stripe: stripeFor(event("customer.subscription.updated", subscription()), { error: notFound }) });
    expect(ignored.result).toEqual({ status: 200, body: { received: true, ignored: true } });
    expect(ignored.applyReplayOrdering).not.toHaveBeenCalled();
    const failed = await process(event("customer.subscription.updated", subscription()), { stripe: stripeFor(event("customer.subscription.updated", subscription()), { error: new Error("private") }) });
    expect(failed.result).toEqual({ status: 500, body: { error: "Unable to process Stripe webhook." } });
    expect(failed.applyReplayOrdering).not.toHaveBeenCalled();
    expect(JSON.stringify(failed.logger.error.mock.calls)).not.toContain("private");
  });

  test.each(["applied", "duplicate", "stale"])('maps RPC %s without direct helper fallback', async (category) => {
    const applyReplayOrdering = jest.fn(async () => ({ ok: true, category }));
    const { result } = await process(event("customer.subscription.updated", subscription()), { applyReplayOrdering });
    expect(result).toEqual(category === "applied"
      ? { status: 200, body: { received: true } }
      : { status: 200, body: { received: true, ignored: true } });
    expect(applyReplayOrdering).toHaveBeenCalledTimes(1);
  });

  test("RPC failure or malformed outcome returns generic 500 without sensitive output", async () => {
    const secret = "cus_NOT_LOGGED";
    const logger = { warn: jest.fn(), error: jest.fn() };
    const { result } = await process(event("customer.subscription.updated", subscription({ customer: { id: secret } })), {
      applyReplayOrdering: jest.fn(async () => ({ ok: false, code: "rpc_failed" })), logger,
    });
    expect(result).toEqual({ status: 500, body: { error: "Unable to process Stripe webhook." } });
    expect(JSON.stringify([result.body, logger.warn.mock.calls, logger.error.mock.calls])).not.toContain(secret);
    const malformed = await process(event("customer.subscription.updated", subscription()), {
      applyReplayOrdering: jest.fn(async () => ({ ok: true, category: "unexpected" })),
    });
    expect(malformed.result).toEqual({ status: 500, body: { error: "Unable to process Stripe webhook." } });
  });
});
