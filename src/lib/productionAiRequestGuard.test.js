/** @jest-environment node */

const {
  MAX_PRODUCTION_AI_BODY_BYTES,
  createProductionAiRequestGuard,
} = require("../../server/productionAiRequestGuard");

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
