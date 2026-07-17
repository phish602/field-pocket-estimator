// Gate 17A.1a: private Stripe billing references (server-only).
//
// All identifiers here are obviously fake.

const {
  stripStripeIdentifiers,
  getPrivateStripeCustomerId,
  upsertPrivateStripeBillingRef,
  STRIPE_ID_FIELDS,
} = require("../../server/companyStripeBillingRefs");

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const FAKE_CUS = "cus_FAKE000000000";
const FAKE_SUB = "sub_FAKE000000000";
const ENV = { SUPABASE_URL: "https://x.supabase.co" };

function createClientStub({ row = null, error = null, upsertError = null } = {}) {
  const calls = { upsert: [] };
  return {
    calls,
    from: jest.fn(() => {
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: row, error }),
        upsert: (payload, opts) => {
          calls.upsert.push({ payload, opts });
          const after = { select: () => after, maybeSingle: async () => (upsertError ? { data: null, error: upsertError } : { data: { company_id: payload.company_id }, error: null }) };
          return after;
        },
      };
      return chain;
    }),
  };
}

describe("stripStripeIdentifiers", () => {
  test("removes every casing and leaves safe billing facts intact", () => {
    const safe = stripStripeIdentifiers({
      plan: "solo", status: "canceled", source: "stripe", updatedAt: "2026-07-12T08:44:34.256Z",
      stripeCustomerId: FAKE_CUS, stripe_customer_id: FAKE_CUS,
      stripeSubscriptionId: FAKE_SUB, stripe_subscription_id: FAKE_SUB,
    });
    expect(safe).toEqual({ plan: "solo", status: "canceled", source: "stripe", updatedAt: "2026-07-12T08:44:34.256Z" });
    STRIPE_ID_FIELDS.forEach((f) => expect(safe[f]).toBeUndefined());
  });

  test("does not mutate the caller's object and tolerates junk", () => {
    const input = { plan: "pro", stripeCustomerId: FAKE_CUS };
    stripStripeIdentifiers(input);
    expect(input.stripeCustomerId).toBe(FAKE_CUS);
    [null, undefined, "x", 42, ["a"]].forEach((v) => expect(stripStripeIdentifiers(v)).toBe(v));
  });
});

describe("getPrivateStripeCustomerId", () => {
  test("returns the stored customer id", async () => {
    const stub = createClientStub({ row: { company_id: COMPANY_ID, stripe_customer_id: FAKE_CUS } });
    expect(await getPrivateStripeCustomerId({ companyId: COMPANY_ID, env: ENV, adminClient: stub }))
      .toEqual({ ok: true, customerId: FAKE_CUS, code: "found" });
  });

  test("no row / no customer resolves to empty without error", async () => {
    expect(await getPrivateStripeCustomerId({ companyId: COMPANY_ID, env: ENV, adminClient: createClientStub({ row: null }) }))
      .toEqual({ ok: true, customerId: "", code: "no_ref" });
    expect(await getPrivateStripeCustomerId({ companyId: COMPANY_ID, env: ENV, adminClient: createClientStub({ row: { stripe_customer_id: null } }) }))
      .toEqual({ ok: true, customerId: "", code: "no_customer" });
  });

  test("a missing table (42P01) or query error fails SAFE, never throws", async () => {
    const missingTable = createClientStub({ error: { code: "42P01", message: 'relation "company_stripe_billing_refs" does not exist' } });
    expect(await getPrivateStripeCustomerId({ companyId: COMPANY_ID, env: ENV, adminClient: missingTable }))
      .toEqual({ ok: false, customerId: "", code: "lookup_failed" });
  });

  test("missing service-role configuration fails closed", async () => {
    expect(await getPrivateStripeCustomerId({ companyId: COMPANY_ID, env: {} }))
      .toEqual({ ok: false, customerId: "", code: "not_configured" });
  });

  test("an invalid company id is rejected", async () => {
    expect((await getPrivateStripeCustomerId({ companyId: "nope", env: ENV, adminClient: createClientStub() })).code).toBe("invalid_company");
  });
});

describe("upsertPrivateStripeBillingRef", () => {
  test("upserts on the company primary key so a company never gets two customer ids", async () => {
    const stub = createClientStub();
    const r = await upsertPrivateStripeBillingRef({ companyId: COMPANY_ID, stripeCustomerId: FAKE_CUS, stripeSubscriptionId: FAKE_SUB, env: ENV, adminClient: stub });
    expect(r).toEqual(expect.objectContaining({ ok: true, code: "stored", written: true }));
    expect(stub.calls.upsert).toHaveLength(1);
    expect(stub.calls.upsert[0].opts).toEqual({ onConflict: "company_id" });
    expect(stub.calls.upsert[0].payload).toEqual(expect.objectContaining({
      company_id: COMPANY_ID, stripe_customer_id: FAKE_CUS, stripe_subscription_id: FAKE_SUB,
    }));
  });

  test("nothing to store is a no-op", async () => {
    const stub = createClientStub();
    expect(await upsertPrivateStripeBillingRef({ companyId: COMPANY_ID, env: ENV, adminClient: stub }))
      .toEqual({ ok: true, code: "nothing_to_store", written: false });
    expect(stub.calls.upsert).toHaveLength(0);
  });

  test("write failure and missing configuration both fail closed", async () => {
    expect((await upsertPrivateStripeBillingRef({ companyId: COMPANY_ID, stripeCustomerId: FAKE_CUS, env: ENV, adminClient: createClientStub({ upsertError: { message: "boom" } }) })).ok).toBe(false);
    expect((await upsertPrivateStripeBillingRef({ companyId: COMPANY_ID, stripeCustomerId: FAKE_CUS, env: {} })).code).toBe("not_configured");
  });

  test("an invalid company id writes nothing", async () => {
    const stub = createClientStub();
    expect((await upsertPrivateStripeBillingRef({ companyId: "nope", stripeCustomerId: FAKE_CUS, env: ENV, adminClient: stub })).code).toBe("invalid_company");
    expect(stub.calls.upsert).toHaveLength(0);
  });
});
