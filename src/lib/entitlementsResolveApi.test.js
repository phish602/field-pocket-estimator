// Gate 17A: POST /api/entitlements/resolve.
//
// The route must authenticate, enforce membership, ignore every browser-supplied
// authority field, never cache, and fail closed on any error.

const { createEntitlementsResolveApiHandler } = require("../../api/entitlements/resolve");

const COMPANY_ID = "11111111-1111-4111-8111-111111111111";

function createRes() {
  const res = {
    statusCode: null,
    body: null,
    headers: {},
    setHeader(key, value) { this.headers[key] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

const safeResult = {
  version: 1,
  companyId: COMPANY_ID,
  membershipRole: "owner",
  plan: "pro",
  status: "active",
  source: "stripe",
  resolvedAt: "2026-07-16T00:00:00.000Z",
  expiresAt: null,
  entitlements: { showPdfWatermark: false, canRemovePdfWatermark: true },
  diagnostics: { stripeAuthority: "stripe_active", internalGrantAuthority: "grant_missing" },
};

test("non-POST is rejected", async () => {
  const handler = createEntitlementsResolveApiHandler({ resolveEntitlements: jest.fn() });
  for (const method of ["GET", "PUT", "DELETE", "PATCH"]) {
    const res = createRes();
    await handler({ method, headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(405);
  }
});

test("always sets Cache-Control: no-store", async () => {
  const handler = createEntitlementsResolveApiHandler({ resolveEntitlements: async () => ({ ok: true, result: safeResult }) });
  const res = createRes();
  await handler({ method: "POST", headers: { authorization: "Bearer t" }, body: { companyId: COMPANY_ID } }, res);
  expect(res.headers["Cache-Control"]).toBe("no-store");
});

test("missing token propagates the resolver's 401", async () => {
  const resolveEntitlements = jest.fn(async () => ({ ok: false, status: 401, error: "Authentication required." }));
  const handler = createEntitlementsResolveApiHandler({ resolveEntitlements });
  const res = createRes();
  await handler({ method: "POST", headers: {}, body: { companyId: COMPANY_ID } }, res);
  expect(res.statusCode).toBe(401);
  expect(resolveEntitlements).toHaveBeenCalledWith(expect.objectContaining({ accessToken: "" }));
});

test("invalid token yields 401", async () => {
  const handler = createEntitlementsResolveApiHandler({ resolveEntitlements: async () => ({ ok: false, status: 401, error: "Authentication required." }) });
  const res = createRes();
  await handler({ method: "POST", headers: { authorization: "Bearer bad" }, body: { companyId: COMPANY_ID } }, res);
  expect(res.statusCode).toBe(401);
  expect(res.body).toEqual({ error: "Authentication required." });
});

test("missing company id yields 400", async () => {
  const handler = createEntitlementsResolveApiHandler({ resolveEntitlements: async () => ({ ok: false, status: 400, error: "Missing company context." }) });
  const res = createRes();
  await handler({ method: "POST", headers: { authorization: "Bearer t" }, body: {} }, res);
  expect(res.statusCode).toBe(400);
});

test("nonmember yields 403 and no entitlement data", async () => {
  const handler = createEntitlementsResolveApiHandler({ resolveEntitlements: async () => ({ ok: false, status: 403, error: "You are not authorized to view this company." }) });
  const res = createRes();
  await handler({ method: "POST", headers: { authorization: "Bearer t" }, body: { companyId: COMPANY_ID } }, res);
  expect(res.statusCode).toBe(403);
  expect(res.body.plan).toBeUndefined();
  expect(res.body.entitlements).toBeUndefined();
});

test("valid member receives the safe resolved object", async () => {
  const handler = createEntitlementsResolveApiHandler({ resolveEntitlements: async () => ({ ok: true, result: safeResult }) });
  const res = createRes();
  await handler({ method: "POST", headers: { authorization: "Bearer t" }, body: { companyId: COMPANY_ID } }, res);
  expect(res.statusCode).toBe(200);
  expect(res.body).toEqual(safeResult);
});

test("only the bearer token and companyId reach the resolver -- injected authority fields are ignored", async () => {
  const resolveEntitlements = jest.fn(async () => ({ ok: true, result: safeResult }));
  const handler = createEntitlementsResolveApiHandler({ resolveEntitlements });
  const res = createRes();
  await handler({
    method: "POST",
    headers: { authorization: "Bearer real-token" },
    body: {
      companyId: COMPANY_ID,
      // Everything below is attacker-controlled and must be dropped.
      plan: "business",
      status: "active",
      source: "internal_comp",
      role: "owner",
      entitlements: { canUseBusinessFeatures: true, canRemovePdfWatermark: true },
      membershipRole: "owner",
      diagnostics: { stripeAuthority: "stripe_active" },
    },
  }, res);

  expect(resolveEntitlements).toHaveBeenCalledTimes(1);
  const args = resolveEntitlements.mock.calls[0][0];
  expect(Object.keys(args).sort()).toEqual(["accessToken", "companyId"]);
  expect(args).toEqual({ accessToken: "real-token", companyId: COMPANY_ID });
  // The response is the server's, not the browser's claim.
  expect(res.body.plan).toBe("pro");
});

test("a non-object body is tolerated and fails closed on company id", async () => {
  const resolveEntitlements = jest.fn(async () => ({ ok: false, status: 400, error: "Missing company context." }));
  const handler = createEntitlementsResolveApiHandler({ resolveEntitlements });
  for (const body of [null, undefined, "business", ["business"], 42]) {
    const res = createRes();
    await handler({ method: "POST", headers: { authorization: "Bearer t" }, body }, res);
    expect(res.statusCode).toBe(400);
  }
});

test("a resolver exception fails closed with 503 and no stack trace", async () => {
  const handler = createEntitlementsResolveApiHandler({
    resolveEntitlements: async () => { throw new Error("connection string leaked here"); },
  });
  const res = createRes();
  await handler({ method: "POST", headers: { authorization: "Bearer t" }, body: { companyId: COMPANY_ID } }, res);
  expect(res.statusCode).toBe(503);
  expect(res.body).toEqual({ error: "Entitlements are unavailable." });
  expect(JSON.stringify(res.body)).not.toContain("connection string");
});

test("a resolver failure without a status defaults to 503", async () => {
  const handler = createEntitlementsResolveApiHandler({ resolveEntitlements: async () => ({ ok: false }) });
  const res = createRes();
  await handler({ method: "POST", headers: { authorization: "Bearer t" }, body: { companyId: COMPANY_ID } }, res);
  expect(res.statusCode).toBe(503);
});

test("the route performs no grant mutation", () => {
  const source = require("fs").readFileSync(require("path").join(__dirname, "../../api/entitlements/resolve.js"), "utf8");
  ["insert", "update", "delete", "grantInternalEntitlement", "revokeInternalEntitlement"].forEach((forbidden) => {
    expect(source).not.toContain(forbidden);
  });
});
