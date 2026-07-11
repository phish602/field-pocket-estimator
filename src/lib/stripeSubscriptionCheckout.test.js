/** @jest-environment node */

const {
  createSubscriptionCheckoutSession,
} = require("../../server/stripeSubscriptionCheckout");

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_server_only",
  STRIPE_PRO_PRICE_ID: "price_pro",
  STRIPE_TEAM_PRICE_ID: "price_team",
  APP_BASE_URL: "https://app.estipaid.test",
};

function validatedUser() {
  return jest.fn(async () => ({ ok: true, user: { id: "user_1", email: "owner@example.test" } }));
}

function stripeClient(options = {}) {
  return {
    checkout: {
      sessions: {
        create: jest.fn(async () => {
          if (options.error) throw new Error(options.error);
          return { id: "cs_test_1", url: "https://checkout.stripe.test/session" };
        }),
      },
    },
  };
}

describe("Stripe subscription Checkout creation", () => {
  test("rejects an invalid plan and missing company context", async () => {
    const validateCompanyUser = validatedUser();
    expect(await createSubscriptionCheckoutSession({ plan: "enterprise", companyId: "company_1", validateCompanyUser, env: ENV })).toMatchObject({ ok: false, status: 400 });
    expect(await createSubscriptionCheckoutSession({ plan: "pro", companyId: "", validateCompanyUser, env: ENV })).toMatchObject({ ok: false, status: 400 });
    expect(validateCompanyUser).not.toHaveBeenCalled();
  });

  test("rejects a selected plan whose server price ID is missing", async () => {
    const validateCompanyUser = validatedUser();
    const stripe = stripeClient();
    const result = await createSubscriptionCheckoutSession({
      plan: "pro", companyId: "company_1", accessToken: "access_1", env: { ...ENV, STRIPE_PRO_PRICE_ID: "" }, stripeClient: stripe, validateCompanyUser,
    });
    expect(result).toMatchObject({ ok: false, status: 500, error: "The selected subscription plan is not configured." });
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  });

  test("maps Pro to its server price and writes required metadata only to Stripe Checkout", async () => {
    const stripe = stripeClient();
    const result = await createSubscriptionCheckoutSession({
      plan: "pro", companyId: "company_1", accessToken: "access_1", env: ENV, stripeClient: stripe, validateCompanyUser: validatedUser(),
    });
    expect(result).toEqual({ ok: true, checkoutUrl: "https://checkout.stripe.test/session", sessionId: "cs_test_1" });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith({
      mode: "subscription",
      line_items: [{ price: "price_pro", quantity: 1 }],
      success_url: "https://app.estipaid.test/?subscriptionCheckout=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://app.estipaid.test/?subscriptionCheckout=cancel",
      customer_email: "owner@example.test",
      metadata: { companyId: "company_1", requestedPlan: "pro", userId: "user_1" },
      subscription_data: { metadata: { companyId: "company_1", requestedPlan: "pro", userId: "user_1" } },
    });
  });

  test("maps Team to its server price without accepting a browser price", async () => {
    const stripe = stripeClient();
    await createSubscriptionCheckoutSession({
      plan: "team", companyId: "company_1", accessToken: "access_1", env: ENV, stripeClient: stripe, validateCompanyUser: validatedUser(), priceId: "price_browser_attempt",
    });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ line_items: [{ price: "price_team", quantity: 1 }] }));
  });

  test("returns a safe error when Stripe fails without exposing server secrets", async () => {
    const result = await createSubscriptionCheckoutSession({
      plan: "pro", companyId: "company_1", accessToken: "access_1", env: ENV, stripeClient: stripeClient({ error: "sk_test_server_only failed" }), validateCompanyUser: validatedUser(),
    });
    expect(result).toEqual({ ok: false, status: 500, error: "Unable to start subscription checkout." });
    expect(JSON.stringify(result)).not.toContain(ENV.STRIPE_SECRET_KEY);
  });
});
