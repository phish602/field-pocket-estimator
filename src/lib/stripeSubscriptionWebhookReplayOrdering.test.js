/** @jest-environment node */

const { applyStripeSubscriptionWebhookEvent } = require("../../server/stripeSubscriptionWebhookReplayOrdering");

const VALID = {
  stripeEventId: "evt_FAKE", eventCreatedAt: "2030-01-01T00:00:00.000Z", stripeSubscriptionCreatedAt: "2029-01-01T00:00:00.000Z", eventType: "customer.subscription.updated",
  companyId: "11111111-1111-4111-8111-111111111111", stripeCustomerId: "cus_FAKE", stripeSubscriptionId: "sub_FAKE",
  plan: "pro", status: "active", currentPeriodEnd: "2030-02-01T00:00:00.000Z",
};

function client(response = { data: [{ result_category: "applied" }], error: null }) {
  return { rpc: jest.fn(async () => response) };
}

describe("Stripe webhook replay/order RPC caller", () => {
  test("missing configuration fails closed", async () => {
    expect(await applyStripeSubscriptionWebhookEvent({ ...VALID, env: {} })).toEqual({ ok: false, code: "not_configured" });
  });

  test.each([
    ["blank event", { stripeEventId: " " }], ["invalid company", { companyId: "nope" }], ["blank subscription", { stripeSubscriptionId: "" }],
    ["unsupported event", { eventType: "invoice.created" }], ["invalid plan", { plan: "enterprise" }], ["invalid status", { status: "mystery" }],
    ["invalid event timestamp", { eventCreatedAt: "not-a-date" }], ["missing subscription creation timestamp", { stripeSubscriptionCreatedAt: "" }],
    ["invalid subscription creation timestamp", { stripeSubscriptionCreatedAt: "not-a-date" }],
  ])("%s input prevents RPC work", async (_name, patch) => {
    const adminClient = client();
    expect((await applyStripeSubscriptionWebhookEvent({ ...VALID, ...patch, adminClient })).code).toBe("invalid_input");
    expect(adminClient.rpc).not.toHaveBeenCalled();
  });

  test("valid input maps exact RPC parameters and permits nullable optional fields", async () => {
    const adminClient = client();
    await expect(applyStripeSubscriptionWebhookEvent({ ...VALID, stripeCustomerId: null, currentPeriodEnd: null, adminClient }))
      .resolves.toEqual({ ok: true, category: "applied" });
    expect(adminClient.rpc).toHaveBeenCalledWith("apply_stripe_subscription_webhook_event", {
      p_stripe_event_id: "evt_FAKE", p_event_created_at: "2030-01-01T00:00:00.000Z", p_subscription_created_at: "2029-01-01T00:00:00.000Z", p_event_type: "customer.subscription.updated",
      p_company_id: VALID.companyId, p_stripe_customer_id: null, p_stripe_subscription_id: "sub_FAKE",
      p_plan: "pro", p_status: "active", p_current_period_end: null,
    });
  });

  test("keeps event and subscription creation timestamps in their distinct RPC fields", async () => {
    const adminClient = client();
    await applyStripeSubscriptionWebhookEvent({ ...VALID, eventCreatedAt: "2031-01-01T00:00:00.000Z", stripeSubscriptionCreatedAt: "2028-01-01T00:00:00.000Z", adminClient });
    const params = adminClient.rpc.mock.calls[0][1];
    expect(params.p_event_created_at).toBe("2031-01-01T00:00:00.000Z");
    expect(params.p_subscription_created_at).toBe("2028-01-01T00:00:00.000Z");
  });

  test.each(["applied", "duplicate", "stale"])('normalizes the %s result', async (result_category) => {
    expect(await applyStripeSubscriptionWebhookEvent({ ...VALID, adminClient: client({ data: [{ result_category }], error: null }) }))
      .toEqual({ ok: true, category: result_category });
  });

  test.each([
    ["RPC error", { data: null, error: { message: "private database error" } }, "rpc_failed"],
    ["empty data", { data: [], error: null }, "invalid_result"],
    ["multiple rows", { data: [{ result_category: "applied" }, { result_category: "duplicate" }], error: null }, "invalid_result"],
    ["malformed row", { data: [{}], error: null }, "invalid_result"],
    ["unknown category", { data: [{ result_category: "surprise" }], error: null }, "invalid_result"],
  ])("%s fails closed and never returns database details", async (_name, response, code) => {
    const result = await applyStripeSubscriptionWebhookEvent({ ...VALID, adminClient: client(response) });
    expect(result).toEqual({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain("private database error");
  });

  test("does not log identifiers", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await applyStripeSubscriptionWebhookEvent({ ...VALID, adminClient: client({ data: null, error: { message: "private" } }) });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
