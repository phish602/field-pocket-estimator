/** @jest-environment node */

const {
  createSubscriptionCheckoutApiHandler,
  MAX_CHECKOUT_BODY_BYTES,
} = require("../../api/stripe/create-subscription-checkout");

function response() {
  const res = { statusCode: 0, body: null };
  res.status = jest.fn((statusCode) => { res.statusCode = statusCode; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  return res;
}

describe("subscription Checkout API", () => {
  test("requires POST", async () => {
    const createCheckout = jest.fn();
    const res = response();
    await createSubscriptionCheckoutApiHandler({ createCheckout })({ method: "GET", headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(405);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  test("returns safe validation errors", async () => {
    const createCheckout = jest.fn(async () => ({ ok: false, status: 400, error: "Choose Solo, Pro, or Business." }));
    const res = response();
    await createSubscriptionCheckoutApiHandler({ createCheckout })({ method: "POST", headers: {}, body: { plan: "bad" } }, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ error: "Choose Solo, Pro, or Business." });
  });

  test("forwards only plan, company context, and bearer token; it ignores a raw price ID", async () => {
    const createCheckout = jest.fn(async () => ({ ok: true, checkoutUrl: "https://checkout.stripe.test/session", sessionId: "cs_1" }));
    const res = response();
    await createSubscriptionCheckoutApiHandler({ createCheckout })({
      method: "POST",
      headers: { authorization: "Bearer token_1" },
      body: { plan: "pro", companyId: "company_1", priceId: "price_browser_attempt" },
    }, res);
    expect(createCheckout).toHaveBeenCalledWith({ plan: "pro", companyId: "company_1", accessToken: "token_1" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ checkoutUrl: "https://checkout.stripe.test/session", sessionId: "cs_1" });
  });

  test("centralizes a 16 KiB checkout-body limit", () => {
    expect(MAX_CHECKOUT_BODY_BYTES).toBe(16 * 1024);
  });

  test("checks the method before the body size", async () => {
    const createCheckout = jest.fn();
    const res = response();
    await createSubscriptionCheckoutApiHandler({ createCheckout })({
      method: "GET",
      headers: { "content-length": String(MAX_CHECKOUT_BODY_BYTES + 1) },
      body: {},
    }, res);
    expect(res.statusCode).toBe(405);
    expect(createCheckout).not.toHaveBeenCalled();
  });

  test("rejects an oversized declared Content-Length with 413 and no checkout work", async () => {
    const createCheckout = jest.fn();
    const res = response();
    await createSubscriptionCheckoutApiHandler({ createCheckout })({
      method: "POST",
      headers: { authorization: "Bearer token_1", "content-length": String(MAX_CHECKOUT_BODY_BYTES + 1) },
      body: { plan: "pro", companyId: "company_1" },
    }, res);
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: "Request body is too large." });
    expect(createCheckout).not.toHaveBeenCalled();
  });

  test("rejects an oversized parsed body with 413 even without Content-Length", async () => {
    const createCheckout = jest.fn();
    const res = response();
    await createSubscriptionCheckoutApiHandler({ createCheckout })({
      method: "POST",
      headers: { authorization: "Bearer token_1" },
      body: { plan: "pro", companyId: "company_1", padding: "a".repeat(MAX_CHECKOUT_BODY_BYTES + 1) },
    }, res);
    expect(res.statusCode).toBe(413);
    expect(res.body).toEqual({ error: "Request body is too large." });
    expect(createCheckout).not.toHaveBeenCalled();
  });

  test("admits a body at the limit and forwards it to checkout", async () => {
    const createCheckout = jest.fn(async () => ({ ok: true, checkoutUrl: "https://checkout.stripe.test/session", sessionId: "cs_1" }));
    const res = response();
    // Pad the body to just under the ceiling; the field is ignored by checkout.
    const padding = "a".repeat(MAX_CHECKOUT_BODY_BYTES - 128);
    await createSubscriptionCheckoutApiHandler({ createCheckout })({
      method: "POST",
      headers: { authorization: "Bearer token_1" },
      body: { plan: "pro", companyId: "company_1", padding },
    }, res);
    expect(res.statusCode).toBe(200);
    expect(createCheckout).toHaveBeenCalledWith({ plan: "pro", companyId: "company_1", accessToken: "token_1" });
  });
});
