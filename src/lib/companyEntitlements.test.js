// Gate 17A: server entitlement resolver.
//
// The resolver is THE authorization boundary. These tests prove that only
// server-held authority (a Stripe-sourced app_settings row written by the
// webhook, or a service-role-only grant row) can produce a paid plan, and that
// everything ambiguous, malformed or absent fails closed to Free.
//
// SCOPE: Gate 17A secures subscription authority and subscription-driven UI
// state. Browser-local paid work -- synchronous PDF generation in particular --
// is NOT made tamper-proof here; that is the later protected-action gate (17B).

const {
  resolveEffectiveCompanyEntitlements,
  resolveStripePlanAuthority,
  resolveInternalGrantAuthority,
  normalizeEntitlementPlan,
  rankEntitlementPlan,
  accessTokenFromAuthorization,
} = require("../../server/companyEntitlements");

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const GRANTER_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = "valid-access-token";

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString();

// A minimal Supabase-shaped stub: auth.getUser plus the two tables the resolver
// reads. Anything the browser sends is irrelevant here by construction.
function createClientStub({
  user = { id: USER_ID },
  userError = null,
  membership = { company_id: COMPANY_ID, user_id: USER_ID, role: "owner" },
  membershipError = null,
  subscriptionRows = [],
  subscriptionError = null,
  grantRows = [],
  grantError = null,
} = {}) {
  return {
    auth: { getUser: jest.fn(async () => ({ data: { user }, error: userError })) },
    from: jest.fn((table) => {
      if (table === "company_users") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          maybeSingle: async () => ({ data: membership, error: membershipError }),
        };
        return chain;
      }
      if (table === "app_settings") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          then: (resolve) => resolve({ data: subscriptionRows, error: subscriptionError }),
        };
        return chain;
      }
      if (table === "company_entitlement_grants") {
        const chain = {
          select: () => chain,
          eq: () => chain,
          is: () => chain,
          then: (resolve) => resolve({ data: grantRows, error: grantError }),
        };
        return chain;
      }
      throw new Error(`unexpected table ${table}`);
    }),
  };
}

const stripeRow = (plan, status, source = "stripe", extra = {}) => ({
  setting_value: { plan, status, source, stripeCustomerId: "cus_secret", stripeSubscriptionId: "sub_secret", ...extra },
});

const grantRow = (plan, overrides = {}) => ({
  id: "44444444-4444-4444-8444-444444444444",
  company_id: COMPANY_ID,
  plan,
  source: "internal_comp",
  starts_at: iso(-60000),
  expires_at: null,
  revoked_at: null,
  granted_by_user_id: GRANTER_ID,
  reason: "Founder demonstration workspace",
  ...overrides,
});

const resolve = (stub, extra = {}) =>
  resolveEffectiveCompanyEntitlements({
    accessToken: TOKEN,
    companyId: COMPANY_ID,
    adminClient: stub,
    logger: { warn: () => {} },
    ...extra,
  });

describe("plan normalization and ranking", () => {
  test.each([
    ["solo", "solo"], ["pro", "pro"], ["business", "business"], ["team", "business"],
    ["BUSINESS", "business"], ["", "free"], [null, "free"], ["enterprise", "free"], ["admin", "free"],
  ])("normalizes %s", (input, expected) => expect(normalizeEntitlementPlan(input)).toBe(expected));

  test("ranks free < solo < pro < business", () => {
    expect(rankEntitlementPlan("free")).toBeLessThan(rankEntitlementPlan("solo"));
    expect(rankEntitlementPlan("solo")).toBeLessThan(rankEntitlementPlan("pro"));
    expect(rankEntitlementPlan("pro")).toBeLessThan(rankEntitlementPlan("business"));
  });

  test("extracts a bearer token only from a well-formed header", () => {
    expect(accessTokenFromAuthorization("Bearer abc")).toBe("abc");
    expect(accessTokenFromAuthorization("bearer abc")).toBe("abc");
    expect(accessTokenFromAuthorization("abc")).toBe("");
    expect(accessTokenFromAuthorization("")).toBe("");
    expect(accessTokenFromAuthorization(undefined)).toBe("");
  });
});

describe("Stripe billing authority", () => {
  test("1. valid active Stripe Solo resolves Solo", async () => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("solo", "active")] }));
    expect(r.result).toEqual(expect.objectContaining({ plan: "solo", source: "stripe", status: "active" }));
    expect(r.result.diagnostics.stripeAuthority).toBe("stripe_active");
  });

  test("2. valid active Stripe Pro resolves Pro", async () => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("pro", "active")] }));
    expect(r.result).toEqual(expect.objectContaining({ plan: "pro", source: "stripe" }));
    expect(r.result.entitlements.canUseReporting).toBe(true);
    expect(r.result.entitlements.canUseBusinessFeatures).toBe(false);
  });

  test("3. valid trialing Stripe Business resolves Business", async () => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("business", "trialing")] }));
    expect(r.result).toEqual(expect.objectContaining({ plan: "business", source: "stripe", status: "trialing" }));
    expect(r.result.entitlements.canUseBusinessFeatures).toBe(true);
  });

  test.each([
    ["4. past_due", "past_due", "stripe_inactive"],
    ["5. canceled", "canceled", "stripe_inactive"],
    ["6. unknown", "unknown", "stripe_inactive"],
  ])("%s resolves Free without a grant", async (_label, status, code) => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("business", status)] }));
    expect(r.result.plan).toBe("free");
    expect(r.result.source).toBe("none");
    expect(r.result.diagnostics.stripeAuthority).toBe(code);
  });

  test.each([
    ["7. source admin", "admin"],
    ["8. source supabase", "supabase"],
    ["source internal_comp masquerading in app_settings", "internal_comp"],
  ])("%s does not establish paid Stripe authority", async (_label, source) => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("business", "active", source)] }));
    expect(r.result.plan).toBe("free");
    expect(r.result.diagnostics.stripeAuthority).toBe("stripe_invalid");
  });

  test("9. malformed plan resolves Free", async () => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("enterprise", "active")] }));
    expect(r.result.plan).toBe("free");
    expect(r.result.diagnostics.stripeAuthority).toBe("stripe_invalid");
  });

  test("10. duplicate subscription rows invalidate Stripe authority", async () => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("business", "active"), stripeRow("business", "active")] }));
    expect(r.result.plan).toBe("free");
    expect(r.result.diagnostics.stripeAuthority).toBe("stripe_duplicate");
  });

  test("missing row and query error both fail closed", async () => {
    const missing = await resolve(createClientStub({ subscriptionRows: [] }));
    expect(missing.result.diagnostics.stripeAuthority).toBe("stripe_missing");
    const errored = await resolve(createClientStub({ subscriptionError: { message: "boom" } }));
    expect(errored.result.plan).toBe("free");
    expect(errored.result.diagnostics.stripeAuthority).toBe("stripe_invalid");
  });

  test("non-object and array setting_value fail closed", async () => {
    for (const value of [null, "business", 42, ["business"]]) {
      const r = await resolve(createClientStub({ subscriptionRows: [{ setting_value: value }] }));
      expect(r.result.plan).toBe("free");
    }
  });
});

describe("internal grant authority", () => {
  test("11. active internal Solo grant resolves Solo", async () => {
    const r = await resolve(createClientStub({ grantRows: [grantRow("solo")] }));
    expect(r.result).toEqual(expect.objectContaining({ plan: "solo", source: "internal_comp", status: "active" }));
    expect(r.result.diagnostics.internalGrantAuthority).toBe("grant_active");
  });

  test("12. active internal Business grant resolves Business", async () => {
    const r = await resolve(createClientStub({ grantRows: [grantRow("business")] }));
    expect(r.result).toEqual(expect.objectContaining({ plan: "business", source: "internal_comp" }));
    expect(r.result.entitlements.canUseBusinessFeatures).toBe(true);
  });

  test("13. future grant is ignored", async () => {
    const r = await resolve(createClientStub({ grantRows: [grantRow("business", { starts_at: iso(60 * 60 * 1000) })] }));
    expect(r.result.plan).toBe("free");
    expect(r.result.diagnostics.internalGrantAuthority).toBe("grant_future");
  });

  test("14. expired grant is ignored", async () => {
    const r = await resolve(createClientStub({ grantRows: [grantRow("business", { starts_at: iso(-7200000), expires_at: iso(-3600000) })] }));
    expect(r.result.plan).toBe("free");
    expect(r.result.diagnostics.internalGrantAuthority).toBe("grant_expired");
  });

  test("15. revoked grant is ignored", async () => {
    // The resolver filters on revoked_at is null, but must also refuse a row
    // that carries revoked_at even if a query ever returned one.
    const r = await resolve(createClientStub({ grantRows: [grantRow("business", { revoked_at: iso(-1000) })] }));
    expect(r.result.plan).toBe("free");
    expect(r.result.diagnostics.internalGrantAuthority).toBe("grant_revoked");
  });

  test.each([
    ["wrong source", { source: "stripe" }],
    ["blank reason", { reason: "   " }],
    ["missing reason", { reason: null }],
    ["invalid granter", { granted_by_user_id: "not-a-uuid" }],
    ["missing granter", { granted_by_user_id: null }],
    ["free plan", { plan: "free" }],
    ["unknown plan", { plan: "enterprise" }],
    ["invalid starts_at", { starts_at: "nonsense" }],
    ["invalid expires_at", { expires_at: "nonsense" }],
  ])("16. malformed grant (%s) is ignored", async (_label, overrides) => {
    const r = await resolve(createClientStub({ grantRows: [grantRow("business", overrides)] }));
    expect(r.result.plan).toBe("free");
    expect(r.result.diagnostics.internalGrantAuthority).toBe("grant_invalid");
  });

  test("17. duplicate unrevoked grants do not elevate access", async () => {
    const r = await resolve(createClientStub({ grantRows: [grantRow("business"), grantRow("pro", { id: "55555555-5555-4555-8555-555555555555" })] }));
    expect(r.result.plan).toBe("free");
    expect(r.result.diagnostics.internalGrantAuthority).toBe("grant_duplicate");
  });

  test("grant query error fails closed", async () => {
    const r = await resolve(createClientStub({ grantError: { message: "boom" } }));
    expect(r.result.plan).toBe("free");
    expect(r.result.diagnostics.internalGrantAuthority).toBe("grant_invalid");
  });

  test("a grant with a future expiry reports that expiry", async () => {
    const expires = iso(3600000);
    const r = await resolve(createClientStub({ grantRows: [grantRow("business", { expires_at: expires })] }));
    expect(r.result.plan).toBe("business");
    expect(r.result.expiresAt).toBe(new Date(expires).toISOString());
  });
});

describe("effective plan precedence", () => {
  test("18. Stripe Pro plus grant Business resolves Business/internal_comp", async () => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("pro", "active")], grantRows: [grantRow("business")] }));
    expect(r.result).toEqual(expect.objectContaining({ plan: "business", source: "internal_comp" }));
  });

  test("19. Stripe Business plus grant Pro resolves Business/stripe", async () => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("business", "active")], grantRows: [grantRow("pro")] }));
    expect(r.result).toEqual(expect.objectContaining({ plan: "business", source: "stripe" }));
  });

  test("20. Stripe Business plus grant Business resolves Business/stripe (tie goes to real billing)", async () => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("business", "active")], grantRows: [grantRow("business")] }));
    expect(r.result).toEqual(expect.objectContaining({ plan: "business", source: "stripe" }));
  });

  test("21. malformed Stripe state plus valid Business grant resolves Business/internal_comp", async () => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("enterprise", "active")], grantRows: [grantRow("business")] }));
    expect(r.result).toEqual(expect.objectContaining({ plan: "business", source: "internal_comp" }));
    expect(r.result.diagnostics).toEqual({ stripeAuthority: "stripe_invalid", internalGrantAuthority: "grant_active" });
  });

  test("duplicate Stripe rows do not invalidate a valid grant", async () => {
    const r = await resolve(createClientStub({ subscriptionRows: [stripeRow("business", "active"), stripeRow("pro", "active")], grantRows: [grantRow("solo")] }));
    expect(r.result).toEqual(expect.objectContaining({ plan: "solo", source: "internal_comp" }));
  });

  test("expired Stripe plus expired grant resolves Free", async () => {
    const r = await resolve(createClientStub({
      subscriptionRows: [stripeRow("business", "canceled")],
      grantRows: [grantRow("business", { starts_at: iso(-7200000), expires_at: iso(-3600000) })],
    }));
    expect(r.result.plan).toBe("free");
  });

  test("22. no authority resolves Free", async () => {
    const r = await resolve(createClientStub());
    expect(r.result).toEqual(expect.objectContaining({ plan: "free", status: "free", source: "none" }));
    expect(r.result.entitlements.showPdfWatermark).toBe(true);
    expect(r.result.entitlements.canRemovePdfWatermark).toBe(false);
    expect(r.result.diagnostics).toEqual({ stripeAuthority: "stripe_missing", internalGrantAuthority: "grant_missing" });
  });
});

describe("authentication and membership", () => {
  test("23. nonmember is denied with 403", async () => {
    const r = await resolve(createClientStub({ membership: null, subscriptionRows: [stripeRow("business", "active")] }));
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 403 }));
    expect(r.result).toBeUndefined();
  });

  test("missing membership row error is denied", async () => {
    const r = await resolve(createClientStub({ membership: null, membershipError: { message: "boom" } }));
    expect(r.status).toBe(403);
  });

  test("24. member role comes from the database, not the request body", async () => {
    const stub = createClientStub({ membership: { company_id: COMPANY_ID, user_id: USER_ID, role: "member" } });
    const r = await resolveEffectiveCompanyEntitlements({
      accessToken: TOKEN,
      companyId: COMPANY_ID,
      adminClient: stub,
      logger: { warn: () => {} },
      // A browser could send anything here; the resolver must not read it.
      role: "owner",
      plan: "business",
      status: "active",
      source: "internal_comp",
      entitlements: { canUseBusinessFeatures: true },
    });
    expect(r.result.membershipRole).toBe("member");
    expect(r.result.plan).toBe("free");
    expect(r.result.entitlements.canUseBusinessFeatures).toBe(false);
  });

  test("any valid member (not just owner/admin) may read entitlements", async () => {
    const r = await resolve(createClientStub({
      membership: { company_id: COMPANY_ID, user_id: USER_ID, role: "member" },
      subscriptionRows: [stripeRow("pro", "active")],
    }));
    expect(r.ok).toBe(true);
    expect(r.result.plan).toBe("pro");
  });

  test("missing token is 401; invalid token is 401", async () => {
    const missing = await resolve(createClientStub(), { accessToken: "" });
    expect(missing).toEqual(expect.objectContaining({ ok: false, status: 401 }));
    const invalid = await resolve(createClientStub({ user: null, userError: { message: "bad jwt" } }));
    expect(invalid).toEqual(expect.objectContaining({ ok: false, status: 401 }));
  });

  test("missing or malformed company id is 400", async () => {
    const missing = await resolve(createClientStub(), { companyId: "" });
    expect(missing.status).toBe(400);
    const malformed = await resolve(createClientStub(), { companyId: "not-a-uuid" });
    expect(malformed.status).toBe(400);
  });

  test("26. service-role configuration failure fails closed with 503", async () => {
    const r = await resolveEffectiveCompanyEntitlements({
      accessToken: TOKEN,
      companyId: COMPANY_ID,
      env: {},
      logger: { warn: () => {} },
    });
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 503 }));
    expect(r.result).toBeUndefined();
  });

  test("an auth exception fails closed", async () => {
    const stub = createClientStub();
    stub.auth.getUser = jest.fn(async () => { throw new Error("network"); });
    const r = await resolve(stub);
    expect(r).toEqual(expect.objectContaining({ ok: false, status: 503 }));
  });
});

describe("25. the response never exposes protected fields", () => {
  test("no tokens, Stripe ids, grant ids, reasons or raw rows", async () => {
    const r = await resolve(createClientStub({
      subscriptionRows: [stripeRow("pro", "active")],
      grantRows: [grantRow("business")],
    }));
    const serialized = JSON.stringify(r.result);
    [
      "cus_secret", "sub_secret", TOKEN,
      "Founder demonstration workspace", GRANTER_ID,
      "44444444-4444-4444-8444-444444444444",
      "stripeCustomerId", "stripeSubscriptionId", "granted_by_user_id",
      "revoke_reason", "setting_value", "reason",
    ].forEach((secret) => expect(serialized).not.toContain(secret));

    expect(Object.keys(r.result).sort()).toEqual([
      "companyId", "diagnostics", "entitlements", "expiresAt", "membershipRole",
      "plan", "resolvedAt", "source", "status", "version",
    ]);
    expect(Object.keys(r.result.diagnostics).sort()).toEqual(["internalGrantAuthority", "stripeAuthority"]);
  });
});

describe("unit-level authority helpers", () => {
  test("resolveStripePlanAuthority and resolveInternalGrantAuthority are independently usable", async () => {
    const stub = createClientStub({ subscriptionRows: [stripeRow("solo", "active")], grantRows: [grantRow("pro")] });
    expect(await resolveStripePlanAuthority({ client: stub, companyId: COMPANY_ID })).toEqual(expect.objectContaining({ plan: "solo", code: "stripe_active" }));
    expect(await resolveInternalGrantAuthority({ client: stub, companyId: COMPANY_ID })).toEqual(expect.objectContaining({ plan: "pro", code: "grant_active" }));
  });
});
