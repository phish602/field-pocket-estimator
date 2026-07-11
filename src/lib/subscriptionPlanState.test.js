import {
  SUBSCRIPTION_STATUSES,
  getDefaultSubscriptionPlanState,
  getEntitlementsFromSubscriptionState,
  getSubscriptionPlanLabel,
  getSubscriptionStatusLabel,
  normalizeSubscriptionPlanState,
  resolvePlanFromSubscriptionState,
  shouldTreatSubscriptionAsPaid,
} from "./subscriptionPlanState";

describe("subscription plan state", () => {
  test("missing state defaults to Free", () => {
    expect(getDefaultSubscriptionPlanState()).toMatchObject({ plan: "free", status: "free", source: "default" });
    expect(resolvePlanFromSubscriptionState()).toBe("free");
  });

  test("unknown plans and statuses resolve conservatively", () => {
    expect(normalizeSubscriptionPlanState({ plan: "enterprise", status: "active" }).plan).toBe("free");
    expect(resolvePlanFromSubscriptionState({ plan: "pro", status: "mystery" })).toBe("free");
    expect(shouldTreatSubscriptionAsPaid({ plan: "pro", status: "mystery" })).toBe(false);
  });

  test("active Pro and Team resolve to their paid entitlements", () => {
    expect(getEntitlementsFromSubscriptionState({ plan: "pro", status: "active" })).toMatchObject({ plan: "pro", canRemovePdfWatermark: true });
    expect(getEntitlementsFromSubscriptionState({ plan: "team", status: "active" })).toMatchObject({ plan: "team", canUseTeamFeatures: true });
  });

  test("canceled and past-due paid plans fall back to Free entitlements", () => {
    expect(getEntitlementsFromSubscriptionState({ plan: "pro", status: "canceled" }).plan).toBe("free");
    expect(getEntitlementsFromSubscriptionState({ plan: "pro", status: "past_due" }).plan).toBe("free");
  });

  test("trialing Pro remains paid for the trial", () => {
    expect(resolvePlanFromSubscriptionState({ plan: "pro", status: SUBSCRIPTION_STATUSES.TRIALING })).toBe("pro");
  });

  test("Company Profile plan-shaped data is not an authority", () => {
    expect(resolvePlanFromSubscriptionState({ companyProfile: { plan: "team" }, status: "active" })).toBe("free");
  });

  test("labels reflect the resolved plan and normalized status", () => {
    const activePro = { plan: "pro", status: "active" };
    expect(getSubscriptionPlanLabel(activePro)).toBe("Pro");
    expect(getSubscriptionStatusLabel(activePro)).toBe("Active");
    expect(getSubscriptionPlanLabel({ plan: "pro", status: "canceled" })).toBe("Free");
    expect(getSubscriptionStatusLabel({ plan: "pro", status: "canceled" })).toBe("Canceled");
  });
});
