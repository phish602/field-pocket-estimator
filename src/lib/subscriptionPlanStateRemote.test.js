import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  SUBSCRIPTION_PLAN_STATE_REMOTE_KEY,
  loadRemoteSubscriptionPlanState,
  loadResolvedSubscriptionPlanState,
  loadBestAvailableSubscriptionPlanState,
  resolveSubscriptionPlanStatePriority,
} from "./subscriptionPlanStateRemote";
import { getEntitlementsFromSubscriptionState } from "./subscriptionPlanState";

function createReadClient({ data = [], error = null } = {}) {
  const eqThird = jest.fn(async () => ({ data, error }));
  const eqSecond = jest.fn(() => ({ eq: eqThird }));
  const eqFirst = jest.fn(() => ({ eq: eqSecond }));
  const select = jest.fn(() => ({ eq: eqFirst }));
  return { from: jest.fn(() => ({ select })), select, eqFirst, eqSecond, eqThird };
}

describe("remote subscription plan state", () => {
  beforeEach(() => localStorage.clear());

  test("returns Free/default when the company setting row is missing", async () => {
    const result = await loadRemoteSubscriptionPlanState({ supabase: createReadClient(), companyId: "company_1" });
    expect(result).toMatchObject({ availability: "missing", state: { plan: "free", status: "free" } });
  });

  test("normalizes a valid company-scoped app_settings row", async () => {
    const client = createReadClient({ data: [{ id: "setting_1", setting_value: { plan: "pro", status: "active", source: "stripe" } }] });
    const result = await loadRemoteSubscriptionPlanState({ supabase: client, companyId: "company_1" });
    expect(result).toMatchObject({ availability: "available", state: { plan: "pro", status: "active" } });
    expect(client.eqThird).toHaveBeenCalledWith("setting_key", SUBSCRIPTION_PLAN_STATE_REMOTE_KEY);
  });

  test("fails closed on a Supabase read error", async () => {
    const result = await loadRemoteSubscriptionPlanState({ supabase: createReadClient({ error: { message: "denied" } }), companyId: "company_1" });
    expect(result).toMatchObject({ availability: "unavailable", state: { plan: "free" } });
  });

  test("remote state beats local dev state, including malformed remote data", () => {
    expect(resolveSubscriptionPlanStatePriority({
      remoteState: { plan: "business", status: "active" },
      remoteAvailable: true,
      localState: { plan: "pro", status: "active" },
      allowLocalFallback: true,
    })).toMatchObject({ plan: "business", status: "active" });
    expect(resolveSubscriptionPlanStatePriority({
      remoteState: { plan: "invalid", status: "active" },
      remoteAvailable: true,
      localState: { plan: "pro", status: "active" },
      allowLocalFallback: true,
    }).plan).toBe("free");
  });

  test("uses local dev state only when remote is missing/unavailable and explicitly allowed", async () => {
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, JSON.stringify({ plan: "pro", status: "active", source: "local_dev" }));
    const missing = await loadResolvedSubscriptionPlanState({
      supabase: createReadClient(), companyId: "company_1", allowLocalFallback: true,
    });
    expect(missing.state.plan).toBe("pro");

    const noFallback = await loadResolvedSubscriptionPlanState({
      supabase: createReadClient(), companyId: "company_1", allowLocalFallback: false,
    });
    expect(noFallback.state.plan).toBe("free");
    expect(loadBestAvailableSubscriptionPlanState({ allowLocalFallback: false }).plan).toBe("free");
  });

  test("active/trialing remote paid states remain paid while past_due resolves Free entitlements", () => {
    expect(getEntitlementsFromSubscriptionState(resolveSubscriptionPlanStatePriority({ remoteState: { plan: "pro", status: "active" }, remoteAvailable: true })).plan).toBe("pro");
    expect(getEntitlementsFromSubscriptionState(resolveSubscriptionPlanStatePriority({ remoteState: { plan: "pro", status: "trialing" }, remoteAvailable: true })).plan).toBe("pro");
    expect(getEntitlementsFromSubscriptionState(resolveSubscriptionPlanStatePriority({ remoteState: { plan: "pro", status: "past_due" }, remoteAvailable: true })).plan).toBe("free");
  });
});
