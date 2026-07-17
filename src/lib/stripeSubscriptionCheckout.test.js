/** @jest-environment node */

const {
  createSubscriptionCheckoutSession,
  validateAuthenticatedCompanyUser,
} = require("../../server/stripeSubscriptionCheckout");

const ENV = {
  STRIPE_SECRET_KEY: "sk_test_server_only",
  STRIPE_SOLO_PRICE_ID: "price_solo",
  STRIPE_PRO_PRICE_ID: "price_pro",
  STRIPE_BUSINESS_PRICE_ID: "price_business",
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

function adminClient({ user = { id: "verified_user", email: "owner@example.test" }, userError = null, membership = null, membershipError = null } = {}) {
  const maybeSingle = jest.fn(async () => ({ data: membership, error: membershipError }));
  const userEq = jest.fn(() => ({ maybeSingle }));
  const companyEq = jest.fn(() => ({ eq: userEq }));
  const select = jest.fn(() => ({ eq: companyEq }));
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user }, error: userError })) },
    from: jest.fn(() => ({ select })),
    select,
    companyEq,
    userEq,
    maybeSingle,
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

  test.each([
    ["solo", "price_solo"],
    ["pro", "price_pro"],
    ["business", "price_business"],
  ])("maps %s to its server price and writes required metadata only to Stripe Checkout", async (plan, price) => {
    const stripe = stripeClient();
    const result = await createSubscriptionCheckoutSession({
      plan, companyId: "company_1", accessToken: "access_1", env: ENV, stripeClient: stripe, validateCompanyUser: validatedUser(),
    });
    expect(result).toEqual({ ok: true, checkoutUrl: "https://checkout.stripe.test/session", sessionId: "cs_test_1" });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      mode: "subscription",
      line_items: [{ price, quantity: 1 }],
      success_url: "https://app.estipaid.test/?subscriptionCheckout=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://app.estipaid.test/?subscriptionCheckout=cancel",
      customer_email: "owner@example.test",
      metadata: { companyId: "company_1", requestedPlan: plan, userId: "user_1" },
      subscription_data: { metadata: { companyId: "company_1", requestedPlan: plan, userId: "user_1" } },
    }));
  });

  test("rejects Free and ignores a browser price ID", async () => {
    const stripe = stripeClient();
    const free = await createSubscriptionCheckoutSession({
      plan: "free", companyId: "company_1", accessToken: "access_1", env: ENV, stripeClient: stripe, validateCompanyUser: validatedUser(),
    });
    expect(free).toMatchObject({ ok: false, status: 400 });
    await createSubscriptionCheckoutSession({
      plan: "business", companyId: "company_1", accessToken: "access_1", env: ENV, stripeClient: stripe, validateCompanyUser: validatedUser(), priceId: "price_browser_attempt",
    });
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({ line_items: [{ price: "price_business", quantity: 1 }] }));
  });

  test("returns a safe error when Stripe fails without exposing server secrets", async () => {
    const result = await createSubscriptionCheckoutSession({
      plan: "pro", companyId: "company_1", accessToken: "access_1", env: ENV, stripeClient: stripeClient({ error: "sk_test_server_only failed" }), validateCompanyUser: validatedUser(),
    });
    expect(result).toEqual({ ok: false, status: 500, error: "Unable to start subscription checkout." });
    expect(JSON.stringify(result)).not.toContain(ENV.STRIPE_SECRET_KEY);
  });

  test.each(["owner", "admin"])("a verified %s can create checkout from a service-role membership lookup", async (role) => {
    const client = adminClient({ membership: { company_id: "company_1", user_id: "verified_user", role } });
    const stripe = stripeClient();
    const result = await createSubscriptionCheckoutSession({
      plan: "solo", companyId: "company_1", accessToken: "opaque_access_token", userId: "frontend_user_attempt", env: ENV, adminClient: client, stripeClient: stripe,
    });
    expect(result.ok).toBe(true);
    expect(client.auth.getUser).toHaveBeenCalledWith("opaque_access_token");
    expect(client.select).toHaveBeenCalledWith("company_id, user_id, role");
    expect(client.companyEq).toHaveBeenCalledWith("company_id", "company_1");
    expect(client.userEq).toHaveBeenCalledWith("user_id", "verified_user");
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ companyId: "company_1", requestedPlan: "solo", userId: "verified_user" }),
    }));
  });

  test.each(["member", "viewer", null])("rejects a verified non-manager role (%s)", async (role) => {
    const result = await validateAuthenticatedCompanyUser({
      accessToken: "opaque_access_token", companyId: "company_1", adminClient: adminClient({ membership: { role } }), logger: { warn: jest.fn() },
    });
    expect(result).toMatchObject({ ok: false, status: 403 });
  });

  test("rejects missing membership, missing authorization, and an invalid token", async () => {
    const missingMembership = await validateAuthenticatedCompanyUser({ accessToken: "opaque_access_token", companyId: "company_1", adminClient: adminClient(), logger: { warn: jest.fn() } });
    const missingAuthorization = await validateAuthenticatedCompanyUser({ companyId: "company_1", adminClient: adminClient(), logger: { warn: jest.fn() } });
    const invalidToken = await validateAuthenticatedCompanyUser({ accessToken: "bad_token", companyId: "company_1", adminClient: adminClient({ user: null, userError: { message: "invalid jwt" } }), logger: { warn: jest.fn() } });
    expect(missingMembership).toMatchObject({ ok: false, status: 403 });
    expect(missingAuthorization).toMatchObject({ ok: false, status: 400 });
    expect(invalidToken).toMatchObject({ ok: false, status: 400 });
  });

  test("authorizes the reported owner/company pairing without an obsolete status filter", async () => {
    const companyId = "0ccc675b-ec4f-44c4-a8ec-e4d642bb8b15";
    const verifiedUserId = "ec4143e4-2525-44b2-acd2-65a086e85f08";
    const client = adminClient({ user: { id: verifiedUserId, email: "owner@example.test" }, membership: { company_id: companyId, user_id: verifiedUserId, role: "owner" } });
    const stripe = stripeClient();
    const result = await createSubscriptionCheckoutSession({
      plan: "solo", companyId, accessToken: "opaque_access_token", env: ENV, adminClient: client, stripeClient: stripe,
    });
    expect(result.ok).toBe(true);
    expect(client.userEq).toHaveBeenCalledWith("user_id", verifiedUserId);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ companyId, requestedPlan: "solo", userId: verifiedUserId }),
    }));
  });
});

// ---------------------------------------------------------------------------
// Gate 17A.1a: checkout reads the Stripe customer id ONLY from private,
// service-role-only storage -- never from the browser, never from the
// browser-readable settings row. All identifiers below are fake.
// ---------------------------------------------------------------------------
describe("Gate 17A.1a private customer reuse", () => {
  const FAKE_CUS = "cus_FAKE000000000";

  function stripeStub() {
    const create = jest.fn(async () => ({ url: "https://checkout.test/session", id: "cs_test_1" }));
    return { checkout: { sessions: { create } } };
  }

  test("an existing private customer id is reused, preventing a duplicate Stripe customer", async () => {
    const stripe = stripeStub();
    const result = await createSubscriptionCheckoutSession({
      plan: "pro", companyId: "company_1", accessToken: "access_1", env: ENV,
      stripeClient: stripe, validateCompanyUser: validatedUser(),
      lookupPrivateCustomerId: async () => ({ ok: true, customerId: FAKE_CUS, code: "found" }),
    });
    expect(result.ok).toBe(true);
    const args = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(args.customer).toBe(FAKE_CUS);
    // Stripe rejects customer + customer_email together.
    expect(args.customer_email).toBeUndefined();
  });

  test("no private customer falls back to customer_email (prior behavior)", async () => {
    const stripe = stripeStub();
    await createSubscriptionCheckoutSession({
      plan: "pro", companyId: "company_1", accessToken: "access_1", env: ENV,
      stripeClient: stripe, validateCompanyUser: validatedUser(),
      lookupPrivateCustomerId: async () => ({ ok: true, customerId: "", code: "no_ref" }),
    });
    const args = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(args.customer).toBeUndefined();
    expect(args.customer_email).toBe("owner@example.test");
  });

  test("a failed private lookup fails SAFE: checkout still works via email", async () => {
    const stripe = stripeStub();
    const result = await createSubscriptionCheckoutSession({
      plan: "pro", companyId: "company_1", accessToken: "access_1", env: ENV,
      stripeClient: stripe, validateCompanyUser: validatedUser(),
      // e.g. the private table does not exist yet during a staged rollout.
      lookupPrivateCustomerId: async () => ({ ok: false, customerId: "", code: "lookup_failed" }),
    });
    expect(result.ok).toBe(true);
    expect(stripe.checkout.sessions.create.mock.calls[0][0].customer).toBeUndefined();
  });

  test("a browser-supplied customer/subscription id is ignored entirely", async () => {
    const stripe = stripeStub();
    const lookup = jest.fn(async () => ({ ok: true, customerId: "", code: "no_ref" }));
    await createSubscriptionCheckoutSession({
      // Attacker-controlled fields that must never be honored.
      plan: "pro", companyId: "company_1", accessToken: "access_1", env: ENV,
      stripeCustomerId: "cus_ATTACKER", stripeSubscriptionId: "sub_ATTACKER",
      customer: "cus_ATTACKER", customer_email: "attacker@example.test",
      stripeClient: stripe, validateCompanyUser: validatedUser(), lookupPrivateCustomerId: lookup,
    });
    const args = stripe.checkout.sessions.create.mock.calls[0][0];
    expect(JSON.stringify(args)).not.toContain("ATTACKER");
    // The id can only come from the private lookup, keyed by the validated company.
    expect(lookup).toHaveBeenCalledWith(expect.objectContaining({ companyId: "company_1" }));
  });

  test("the private lookup is keyed by the server-validated company, not the request", async () => {
    const lookup = jest.fn(async () => ({ ok: true, customerId: "", code: "no_ref" }));
    await createSubscriptionCheckoutSession({
      plan: "pro", companyId: "company_1", accessToken: "access_1", env: ENV,
      stripeClient: stripeStub(), validateCompanyUser: validatedUser(), lookupPrivateCustomerId: lookup,
    });
    expect(lookup.mock.calls[0][0].companyId).toBe("company_1");
  });
});
