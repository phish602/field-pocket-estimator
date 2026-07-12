const { upsertCompanySubscriptionPlanState } = require("../../server/subscriptionPlanStateAdmin");

function createAdminClient({ rows = [], readError = null, writeError = null } = {}) {
  const selectAfterUpdate = jest.fn(async () => ({ data: [], error: writeError }));
  const updateEq = jest.fn(() => ({ select: selectAfterUpdate }));
  const update = jest.fn(() => ({ eq: updateEq }));
  const insertSelect = jest.fn(async () => ({ data: [], error: writeError }));
  const insert = jest.fn(() => ({ select: insertSelect }));
  const readEqThird = jest.fn(async () => ({ data: rows, error: readError }));
  const readEqSecond = jest.fn(() => ({ eq: readEqThird }));
  const readEqFirst = jest.fn(() => ({ eq: readEqSecond }));
  const select = jest.fn(() => ({ eq: readEqFirst }));
  return { from: jest.fn(() => ({ select, update, insert })), insert, update };
}

describe("server subscription plan writer scaffold", () => {
  test("rejects missing companyId and invalid plan/status before contacting Supabase", async () => {
    expect(await upsertCompanySubscriptionPlanState({ plan: "pro", status: "active" })).toMatchObject({ ok: false, error: "Missing companyId." });
    expect(await upsertCompanySubscriptionPlanState({ companyId: "company_1", plan: "enterprise", status: "active" })).toMatchObject({ ok: false, error: "Invalid subscription plan." });
    expect(await upsertCompanySubscriptionPlanState({ companyId: "company_1", plan: "pro", status: "mystery" })).toMatchObject({ ok: false, error: "Invalid subscription status." });
  });

  test("inserts a normalized company-scoped payload with a server timestamp", async () => {
    const adminClient = createAdminClient();
    const result = await upsertCompanySubscriptionPlanState({
      adminClient, companyId: "company_1", plan: "pro", status: "active", source: "stripe", stripeCustomerId: "cus_1",
    });
    expect(result).toMatchObject({ ok: true, action: "inserted", state: { plan: "pro", status: "active", source: "stripe" } });
    expect(adminClient.insert).toHaveBeenCalledWith(expect.objectContaining({
      company_id: "company_1", setting_scope: "company", setting_key: "subscription_plan_state",
      setting_value: expect.objectContaining({ updatedAt: expect.any(String), stripeCustomerId: "cus_1" }),
    }));
  });

  test("updates an existing row without any browser credential dependency", async () => {
    const adminClient = createAdminClient({ rows: [{ id: "setting_1" }] });
    const result = await upsertCompanySubscriptionPlanState({ adminClient, companyId: "company_1", plan: "business", status: "trialing", source: "admin" });
    expect(result).toMatchObject({ ok: true, action: "updated", state: { plan: "business", status: "trialing" } });
    expect(adminClient.update).toHaveBeenCalledWith(expect.objectContaining({ setting_value: expect.objectContaining({ updatedAt: expect.any(String) }) }));
  });
});
