/** @jest-environment node */

const { createSubscriptionCheckoutApiHandler } = require("../../api/stripe/create-subscription-checkout");

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
});
