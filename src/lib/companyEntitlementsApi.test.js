// Gate 17A: client entitlement loader + tamper resistance.
//
// The browser holds several plan-shaped values (SUBSCRIPTION_PLAN_STATE, the
// remote cache, company profile fields). None of them are authority. These
// tests prove that writing any of them cannot upgrade the resolved plan, and
// that every failure path lands on Free.
//
// SCOPE: this covers subscription authority and the state the UI presents.
// Browser-local PDF generation is NOT protected by Gate 17A -- see Gate 17B.

import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  resolveCompanyEntitlements,
  normalizeServerEntitlementState,
  getFreeEntitlementState,
  getLoadingEntitlementState,
  ENTITLEMENTS_RESOLVE_PATH,
} from "./companyEntitlementsApi";
import { allowLocalEntitlementFallback } from "./useCompanyEntitlements";

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "session-access-token";

const jsonResponse = (payload, status = 200) => ({
  status,
  json: async () => payload,
});

const serverBusiness = {
  version: 1,
  companyId: COMPANY_ID,
  membershipRole: "owner",
  plan: "business",
  status: "active",
  source: "internal_comp",
  resolvedAt: "2026-07-16T00:00:00.000Z",
  expiresAt: null,
  entitlements: { canUseBusinessFeatures: true },
  diagnostics: { stripeAuthority: "stripe_missing", internalGrantAuthority: "grant_active" },
};

const serverFree = { ...serverBusiness, plan: "free", status: "free", source: "none", entitlements: {} };

beforeEach(() => localStorage.clear());

describe("the browser cannot upgrade a server Free result", () => {
  // The exact payload a tamperer would write.
  const writeLocalBusiness = () => localStorage.setItem(
    STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE,
    JSON.stringify({ plan: "business", status: "active", source: "admin", updatedAt: new Date().toISOString() }),
  );

  test("1. local SUBSCRIPTION_PLAN_STATE business/active/admin does not upgrade a server Free result", async () => {
    writeLocalBusiness();
    const fetchImpl = jest.fn(async () => jsonResponse(serverFree));
    const result = await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl });
    expect(result.plan).toBe("free");
    expect(result.entitlements.canRemovePdfWatermark).toBe(false);
    expect(result.entitlements.canUseBusinessFeatures).toBe(false);
    // The tampered value is still sitting in storage -- it simply has no effect.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE)).plan).toBe("business");
  });

  test("2. local remote cache set to Business does not upgrade a server Free result", async () => {
    localStorage.setItem(
      STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE,
      JSON.stringify({ plan: "business", status: "active", source: "stripe", updatedAt: new Date().toISOString() }),
    );
    const fetchImpl = jest.fn(async () => jsonResponse(serverFree));
    const result = await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl });
    expect(result.plan).toBe("free");
  });

  test("3. company profile plan Business does not upgrade a server Free result", async () => {
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ companyName: "X", plan: "business", subscriptionPlan: "business" }));
    const fetchImpl = jest.fn(async () => jsonResponse(serverFree));
    const result = await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl });
    expect(result.plan).toBe("free");
  });

  test("all three tampered sources at once still resolve Free", async () => {
    writeLocalBusiness();
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE, JSON.stringify({ plan: "business", status: "active", source: "stripe" }));
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ plan: "business" }));
    const fetchImpl = jest.fn(async () => jsonResponse(serverFree));
    expect((await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl })).plan).toBe("free");
  });

  test("the loader never reads localStorage at all", async () => {
    writeLocalBusiness();
    const getItem = jest.spyOn(Storage.prototype, "getItem");
    const fetchImpl = jest.fn(async () => jsonResponse(serverFree));
    await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl });
    expect(getItem).not.toHaveBeenCalled();
    getItem.mockRestore();
  });
});

describe("4. browser request-body fields are never sent as authority", () => {
  test("only companyId is transmitted", async () => {
    const fetchImpl = jest.fn(async () => jsonResponse(serverFree));
    await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(ENTITLEMENTS_RESOLVE_PATH);
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init.body)).toEqual({ companyId: COMPANY_ID });
    expect(init.cache).toBe("no-store");
  });
});

describe("every failure path resolves Free", () => {
  test("5. API failure (500) resolves Free", async () => {
    const result = await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => jsonResponse({ error: "boom" }, 500) });
    expect(result).toEqual(expect.objectContaining({ plan: "free", ok: false, code: "server_error" }));
  });

  test("401 and 403 resolve Free with distinct safe codes", async () => {
    expect((await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => jsonResponse({}, 401) })).code).toBe("unauthenticated");
    expect((await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => jsonResponse({}, 403) })).code).toBe("forbidden");
  });

  test("6. malformed API payload resolves Free", async () => {
    for (const payload of [null, "business", ["business"], 42, {}]) {
      const result = await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => jsonResponse(payload) });
      expect(result.plan).toBe("free");
      expect(result.ok).toBe(false);
    }
  });

  test("unparseable JSON resolves Free", async () => {
    const result = await resolveCompanyEntitlements({
      accessToken: TOKEN, companyId: COMPANY_ID,
      fetchImpl: async () => ({ status: 200, json: async () => { throw new Error("bad json"); } }),
    });
    expect(result).toEqual(expect.objectContaining({ plan: "free", code: "malformed_payload" }));
  });

  test("7. unknown plan/status/source resolve Free", async () => {
    expect((await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => jsonResponse({ ...serverBusiness, plan: "enterprise" }) })).code).toBe("unknown_plan");
    expect((await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => jsonResponse({ ...serverBusiness, status: "past_due" }) })).code).toBe("unknown_status");
    expect((await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => jsonResponse({ ...serverBusiness, source: "admin" }) })).code).toBe("unknown_source");
  });

  test("network rejection resolves Free", async () => {
    const result = await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => { throw new Error("offline"); } });
    expect(result).toEqual(expect.objectContaining({ plan: "free", code: "network_error" }));
  });

  test("missing token or company resolves Free without calling the API", async () => {
    const fetchImpl = jest.fn();
    expect((await resolveCompanyEntitlements({ accessToken: "", companyId: COMPANY_ID, fetchImpl })).plan).toBe("free");
    expect((await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: "", fetchImpl })).plan).toBe("free");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  test("the loading state presents as Free", () => {
    const loading = getLoadingEntitlementState();
    expect(loading).toEqual(expect.objectContaining({ plan: "free", loading: true, ok: false }));
    expect(loading.entitlements.canRemovePdfWatermark).toBe(false);
  });
});

describe("8. a successful server Business resolves Business", () => {
  test("plan, source and capabilities follow the server", async () => {
    const result = await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => jsonResponse(serverBusiness) });
    expect(result).toEqual(expect.objectContaining({ plan: "business", status: "active", source: "internal_comp", ok: true }));
    expect(result.entitlements.canUseBusinessFeatures).toBe(true);
    expect(result.entitlements.canRemovePdfWatermark).toBe(true);
  });

  test("capabilities are derived from the server PLAN, not from server-sent booleans", async () => {
    // A compromised/incorrect server capability map must not widen access
    // beyond what the plan itself allows.
    const contradictory = { ...serverBusiness, plan: "free", status: "free", source: "none", entitlements: { canUseBusinessFeatures: true, canRemovePdfWatermark: true } };
    const result = await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => jsonResponse(contradictory) });
    expect(result.plan).toBe("free");
    expect(result.entitlements.canUseBusinessFeatures).toBe(false);
    expect(result.entitlements.canRemovePdfWatermark).toBe(false);
  });
});

describe("9. mutating the cached response afterwards changes nothing", () => {
  test("the resolved object is independent of the payload object", async () => {
    const payload = { ...serverFree };
    const result = await resolveCompanyEntitlements({ accessToken: TOKEN, companyId: COMPANY_ID, fetchImpl: async () => jsonResponse(payload) });
    expect(result.plan).toBe("free");

    // Tamper with the source payload and any cache-shaped storage afterwards.
    payload.plan = "business";
    payload.entitlements = { canUseBusinessFeatures: true };
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE, JSON.stringify({ plan: "business", status: "active", source: "stripe" }));

    expect(result.plan).toBe("free");
    expect(result.entitlements.canUseBusinessFeatures).toBe(false);
  });
});

describe("10. a production host can never enable local fallback", () => {
  test.each([
    ["www.estipaid.com", "production"],
    ["www.estipaid.com", "development"],
    ["estipaid.com", "development"],
    ["field-pocket-estimator-abc123.vercel.app", "development"],
    ["some-preview.vercel.app", "test"],
  ])("host %s with NODE_ENV=%s refuses fallback", (hostname, nodeEnv) => {
    expect(allowLocalEntitlementFallback({ nodeEnv, hostname })).toBe(false);
  });

  test.each([
    ["localhost", "development", true],
    ["127.0.0.1", "development", true],
    ["localhost", "production", false],
  ])("local host %s with NODE_ENV=%s -> %s", (hostname, nodeEnv, expected) => {
    expect(allowLocalEntitlementFallback({ nodeEnv, hostname })).toBe(expected);
  });
});

describe("normalizeServerEntitlementState", () => {
  test("free/none is a valid server answer, not a malformed one", () => {
    const state = normalizeServerEntitlementState(serverFree);
    expect(state).toEqual(expect.objectContaining({ plan: "free", source: "none", ok: true }));
  });

  test("getFreeEntitlementState is fully Free", () => {
    const free = getFreeEntitlementState();
    expect(free.plan).toBe("free");
    expect(free.entitlements.showPdfWatermark).toBe(true);
    expect(free.entitlements.canUseBusinessFeatures).toBe(false);
  });
});
