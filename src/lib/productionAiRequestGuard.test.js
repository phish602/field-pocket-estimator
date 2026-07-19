/** @jest-environment node */

const {
  MAX_PRODUCTION_AI_BODY_BYTES,
  createProductionAiRequestGuard,
} = require("../../server/productionAiRequestGuard");
const { AI_ASSIST_QUOTA_ROUTE, GUIDED_BUILD_QUOTA_ROUTE } = require("../../server/productionAiQuota");

const PAID_AI_ROUTES = [AI_ASSIST_QUOTA_ROUTE, GUIDED_BUILD_QUOTA_ROUTE];

function request(overrides = {}) {
  return {
    method: "POST",
    headers: { authorization: "Bearer verified-token" },
    body: { sectionKey: "scope", userInput: "Paint the wall" },
    ...overrides,
  };
}

function verifiedClient(getUser = jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }))) {
  return { auth: { getUser } };
}

describe("Production AI request guard", () => {
  test.each([
    ["missing", {}],
    ["blank", { authorization: "Bearer   " }],
    ["malformed", { authorization: "Token verified-token" }],
    ["multi-value", { authorization: ["Bearer one", "Bearer two"] }],
  ])("rejects %s authorization before Supabase or dispatch", async (_name, headers) => {
    const getUser = jest.fn();
    const guard = createProductionAiRequestGuard({ getAdminClient: () => verifiedClient(getUser) });
    const result = await guard(request({ headers }));
    expect(result).toEqual({ ok: false, status: 401, body: { error: "Authentication required." } });
    expect(getUser).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("verified-token");
  });

  test("rejects an invalid token before dispatch", async () => {
    const getUser = jest.fn(async () => ({ data: { user: null }, error: { message: "invalid" } }));
    const result = await createProductionAiRequestGuard({ getAdminClient: () => verifiedClient(getUser) })(request());
    expect(result.status).toBe(401);
    expect(getUser).toHaveBeenCalledWith("verified-token");
  });

  test("fails closed when server Supabase configuration is unavailable", async () => {
    const result = await createProductionAiRequestGuard({ getAdminClient: () => null })(request());
    expect(result).toEqual({ ok: false, status: 503, body: { error: "AI service is unavailable." } });
  });

  test("rejects unsupported methods before authentication", async () => {
    const getUser = jest.fn();
    const result = await createProductionAiRequestGuard({ getAdminClient: () => verifiedClient(getUser) })(request({ method: "GET" }));
    expect(result.status).toBe(405);
    expect(getUser).not.toHaveBeenCalled();
  });

  test("rejects a declared oversized body before authentication", async () => {
    const getUser = jest.fn();
    const result = await createProductionAiRequestGuard({ getAdminClient: () => verifiedClient(getUser) })(request({
      headers: { authorization: "Bearer verified-token", "content-length": String(MAX_PRODUCTION_AI_BODY_BYTES + 1) },
    }));
    expect(result.status).toBe(413);
    expect(getUser).not.toHaveBeenCalled();
  });

  test("rejects an actual oversized parsed body without Content-Length", async () => {
    const getUser = jest.fn();
    const result = await createProductionAiRequestGuard({ getAdminClient: () => verifiedClient(getUser) })(request({
      headers: { authorization: "Bearer verified-token" },
      body: "a".repeat(MAX_PRODUCTION_AI_BODY_BYTES + 1),
    }));
    expect(result.status).toBe(413);
    expect(getUser).not.toHaveBeenCalled();
  });

  test("accepts a body exactly at the serialized boundary after verified authentication", async () => {
    const getUser = jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));
    const body = "a".repeat(MAX_PRODUCTION_AI_BODY_BYTES);
    const result = await createProductionAiRequestGuard({ getAdminClient: () => verifiedClient(getUser) })(request({ body }));
    expect(result).toEqual({ ok: true, status: 200 });
    expect(getUser).toHaveBeenCalledTimes(1);
  });
});

describe.each(PAID_AI_ROUTES)("Security R2.2 quota ordering on %s", (route) => {
  function quotaGuard(authorizeQuota, getUser = jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }))) {
    return {
      getUser,
      authorizeQuota,
      guard: createProductionAiRequestGuard({
        route,
        getAdminClient: () => verifiedClient(getUser),
        authorizeQuota,
      }),
    };
  }

  test.each([
    ["an unsupported method", { method: "GET" }, 405],
    ["an oversized declared body", { headers: { authorization: "Bearer verified-token", "content-length": String(MAX_PRODUCTION_AI_BODY_BYTES + 1) } }, 413],
    ["a missing bearer token", { headers: {} }, 401],
  ])("consumes no quota for %s", async (_name, overrides, status) => {
    const authorizeQuota = jest.fn();
    const { guard, getUser } = quotaGuard(authorizeQuota);
    expect((await guard(request(overrides))).status).toBe(status);
    expect(authorizeQuota).not.toHaveBeenCalled();
    expect(getUser).not.toHaveBeenCalled();
  });

  test("consumes no quota when the token is rejected", async () => {
    const authorizeQuota = jest.fn();
    const getUser = jest.fn(async () => ({ data: { user: null }, error: { message: "invalid" } }));
    const { guard } = quotaGuard(authorizeQuota, getUser);
    expect((await guard(request())).status).toBe(401);
    expect(authorizeQuota).not.toHaveBeenCalled();
  });

  test("passes only the verified auth user id and route to the quota authority", async () => {
    const authorizeQuota = jest.fn(async () => ({ ok: true, companyId: "company-1" }));
    const getUser = jest.fn(async () => ({ data: { user: { id: "verified-user" } }, error: null }));
    const { guard } = quotaGuard(authorizeQuota, getUser);

    // Hostile body: a spoofed identity, company and usage count must be ignored.
    const result = await guard(request({
      body: { sectionKey: "scope", userId: "attacker", company_id: "attacker-co", role: "owner", quotaRemaining: 9999 },
    }));

    expect(result).toEqual({ ok: true, status: 200 });
    expect(authorizeQuota).toHaveBeenCalledTimes(1);
    const call = authorizeQuota.mock.calls[0][0];
    expect(call.userId).toBe("verified-user");
    expect(call.route).toBe(route);
    expect(JSON.stringify(Object.keys(call))).not.toMatch(/body|req|quotaRemaining/);
  });

  test("returns 429 with the quota Retry-After header", async () => {
    const authorizeQuota = jest.fn(async () => ({
      ok: false, status: 429, error: "AI assistance limit reached. Please try again later.",
      headers: { "Retry-After": "42" },
    }));
    const { guard } = quotaGuard(authorizeQuota);
    const result = await guard(request());
    expect(result).toEqual({
      ok: false,
      status: 429,
      body: { error: "AI assistance limit reached. Please try again later." },
      headers: { "Retry-After": "42" },
    });
  });

  test("returns 503 without a Retry-After when the quota authority is unavailable", async () => {
    const authorizeQuota = jest.fn(async () => ({ ok: false, status: 503, error: "AI service is unavailable." }));
    const { guard } = quotaGuard(authorizeQuota);
    const result = await guard(request());
    expect(result).toEqual({ ok: false, status: 503, body: { error: "AI service is unavailable." } });
    expect(result.headers).toBeUndefined();
  });

  test("fails closed when the quota authority returns nothing usable", async () => {
    const { guard } = quotaGuard(jest.fn(async () => undefined));
    expect((await guard(request()))).toEqual({ ok: false, status: 503, body: { error: "AI service is unavailable." } });
  });

  test("denies a rejected membership without admitting the request", async () => {
    const authorizeQuota = jest.fn(async () => ({ ok: false, status: 403, error: "AI assistance is not available for this account." }));
    const { guard } = quotaGuard(authorizeQuota);
    expect((await guard(request())).status).toBe(403);
  });

  test("still verifies the bearer token before consuming any quota", async () => {
    const order = [];
    const getUser = jest.fn(async () => { order.push("getUser"); return { data: { user: { id: "user-1" } }, error: null }; });
    const authorizeQuota = jest.fn(async () => { order.push("quota"); return { ok: true }; });
    const { guard } = quotaGuard(authorizeQuota, getUser);
    await guard(request());
    expect(order).toEqual(["getUser", "quota"]);
  });
});

describe("Security R2.2 route enrollment at the guard", () => {
  const verifiedUser = () => jest.fn(async () => ({ data: { user: { id: "user-1" } }, error: null }));

  test.each(PAID_AI_ROUTES)("%s is quota-enforced", async (route) => {
    const authorizeQuota = jest.fn(async () => ({ ok: true }));
    const guard = createProductionAiRequestGuard({ route, getAdminClient: () => verifiedClient(verifiedUser()), authorizeQuota });
    expect(await guard(request())).toEqual({ ok: true, status: 200 });
    expect(authorizeQuota).toHaveBeenCalledTimes(1);
  });

  test("an unlabelled or unpaid route keeps plain R2.1 behavior", async () => {
    const authorizeQuota = jest.fn();
    const getUser = verifiedUser();
    // /api/translate is unguarded in Production; an unlabelled guard is simply
    // the safe default and must not invent a quota for a route we never enrolled.
    for (const route of ["", "/api/translate"]) {
      const guard = createProductionAiRequestGuard({ route, getAdminClient: () => verifiedClient(getUser), authorizeQuota });
      expect(await guard(request())).toEqual({ ok: true, status: 200 });
    }
    expect(authorizeQuota).not.toHaveBeenCalled();
  });
});
