/** @jest-environment node */

const fs = require("fs");
const http = require("http");
const path = require("path");
jest.mock("undici", () => ({
  fetch: jest.fn(async () => { throw new Error("provider fetch is disabled in this test"); }),
}));

const { createDevAiBridge } = require("../../api/_devAiBridge");
const {
  AI_ASSIST_QUOTA_ROUTE,
  GUIDED_BUILD_QUOTA_ROUTE,
  isQuotaEnforcedRoute,
} = require("../../server/productionAiQuota");

const PAID_AI_ROUTES = [AI_ASSIST_QUOTA_ROUTE, GUIDED_BUILD_QUOTA_ROUTE];
const identityHandler = require("../../api/dev-ai-identity");
const devAiApp = require("../../server/dev-ai");
const { sanitizeLogPayload } = devAiApp;

function response() {
  const res = { statusCode: 0, body: null, headers: {} };
  res.status = jest.fn((code) => { res.statusCode = code; return res; });
  res.json = jest.fn((body) => { res.body = body; return res; });
  res.setHeader = jest.fn((name, value) => { res.headers[name] = value; return res; });
  return res;
}

function requestJson(server, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const address = server.address();
    const req = http.request({
      hostname: "127.0.0.1",
      port: address.port,
      path,
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, (res) => {
      let raw = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { raw += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    });
    req.on("error", reject);
    req.end(payload);
  });
}

function withIsolatedEntrypoint(modulePath, callback) {
  const appHandler = jest.fn();
  const guard = jest.fn(async () => ({ ok: false, status: 401, body: { error: "Authentication required." } }));
  let handler;
  jest.isolateModules(() => {
    jest.doMock("../../server/dev-ai", () => appHandler);
    jest.doMock("../../server/productionAiRequestGuard", () => ({
      createProductionAiRequestGuard: () => guard,
    }));
    handler = require(modulePath);
  });
  return callback({ handler, appHandler, guard });
}

describe("Production dev-AI bridge", () => {
  test("does not dispatch the AI handler when guard authentication fails", async () => {
    const appHandler = jest.fn();
    const guard = jest.fn(async () => ({ ok: false, status: 401, body: { error: "Authentication required." } }));
    const handler = createDevAiBridge("/api/ai-assist", { appHandler, guard });
    const res = response();
    await handler({ method: "POST", headers: {}, body: {} }, res);
    expect(guard).toHaveBeenCalledTimes(1);
    expect(appHandler).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  test("dispatches exactly once after a verified guard result", async () => {
    const appHandler = jest.fn();
    const guard = jest.fn(async () => ({ ok: true, status: 200 }));
    const handler = createDevAiBridge("/api/guided-build", { appHandler, guard });
    const req = { method: "POST", url: "/?trace=1", headers: {}, body: {} };
    await handler(req, response());
    expect(appHandler).toHaveBeenCalledTimes(1);
    expect(req.url).toBe("/api/guided-build?trace=1");
  });

  test("an unguarded bridge remains available for the unchanged translate route", async () => {
    const appHandler = jest.fn();
    const handler = createDevAiBridge("/api/translate", { appHandler });
    await handler({ method: "POST", url: "/", headers: {}, body: {} }, response());
    expect(appHandler).toHaveBeenCalledTimes(1);
  });

  test("Production dev-AI identity is a fixed safe 404 without server dispatch", () => {
    const res = response();
    identityHandler({}, res);
    expect(res.statusCode).toBe(404);
    expect(res.body).toEqual({ error: "Not found." });
    expect(JSON.stringify(res.body)).not.toMatch(/pid|port|runtime|server/i);
  });

  test("server AI logs retain metadata but remove authorization and prompt content", () => {
    const safe = sanitizeLogPayload({
      route: "/api/ai-assist",
      provider: "groq",
      promptExcerpt: "customer-entered scope text",
      context: "project context",
      authorization: "Bearer never-log-this",
      finalExcerpt: "provider response",
    });
    expect(safe).toMatchObject({ route: "/api/ai-assist", provider: "groq" });
    expect(JSON.stringify(safe)).not.toMatch(/customer-entered|project context|never-log-this|provider response/);
  });

  test.each([
    ["../../api/ai-assist", "/api/ai-assist"],
    ["../../api/guided-build", "/api/guided-build"],
  ])("real Production entrypoint %s fails closed before dispatch", async (modulePath, routePath) => {
    await withIsolatedEntrypoint(modulePath, async ({ handler, appHandler, guard }) => {
      const res = response();
      await handler({ method: "POST", url: "/", headers: {}, body: {} }, res);
      expect(guard).toHaveBeenCalledTimes(1);
      expect(appHandler).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(401);

      guard.mockResolvedValueOnce({ ok: true, status: 200 });
      const verifiedRequest = { method: "POST", url: "/?check=1", headers: {}, body: {} };
      await handler(verifiedRequest, response());
      expect(appHandler).toHaveBeenCalledTimes(1);
      expect(verifiedRequest.url).toBe(`${routePath}?check=1`);
    });
  });

  test("a quota rejection returns 429 with Retry-After and never dispatches", async () => {
    const appHandler = jest.fn();
    const guard = jest.fn(async () => ({
      ok: false, status: 429,
      body: { error: "AI assistance limit reached. Please try again later." },
      headers: { "Retry-After": "37" },
    }));
    const handler = createDevAiBridge("/api/ai-assist", { appHandler, guard });
    const res = response();
    await handler({ method: "POST", url: "/", headers: {}, body: {} }, res);

    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("37");
    expect(Number(res.headers["Retry-After"])).toBeGreaterThan(0);
    // Zero provider dispatch on a rejection.
    expect(appHandler).not.toHaveBeenCalled();
  });

  test("a rejection without headers sets none and still fails closed", async () => {
    const appHandler = jest.fn();
    const guard = jest.fn(async () => ({ ok: false, status: 503, body: { error: "AI service is unavailable." } }));
    const res = response();
    await createDevAiBridge("/api/ai-assist", { appHandler, guard })({ method: "POST", url: "/", headers: {}, body: {} }, res);
    expect(res.statusCode).toBe(503);
    expect(res.setHeader).not.toHaveBeenCalled();
    expect(appHandler).not.toHaveBeenCalled();
  });

  test("both paid entrypoints are labelled for the shared R2.2 quota", async () => {
    const routes = {};
    jest.isolateModules(() => {
      jest.doMock("../../server/dev-ai", () => jest.fn());
      jest.doMock("../../server/productionAiRequestGuard", () => ({
        createProductionAiRequestGuard: jest.fn((options) => {
          routes[options.route] = (routes[options.route] || 0) + 1;
          return jest.fn(async () => ({ ok: true, status: 200 }));
        }),
      }));
      require("../../api/ai-assist");
      require("../../api/guided-build");
    });
    expect(routes).toEqual({ "/api/ai-assist": 1, "/api/guided-build": 1 });
    PAID_AI_ROUTES.forEach((route) => expect(isQuotaEnforcedRoute(route)).toBe(true));
  });

  test("the Guided Build entrypoint is enrolled without editing its source", () => {
    const source = fs.readFileSync(path.resolve(process.cwd(), "api/guided-build.js"), "utf8");
    // Enrollment came entirely from the shared bridge, so the endpoint file --
    // and every other Guided Build file -- stayed untouched.
    expect(source.trim()).toBe(
      'module.exports = require("./_devAiBridge").createGuardedDevAiBridge("/api/guided-build");'
    );
    expect(isQuotaEnforcedRoute("/api/guided-build")).toBe(true);
  });

  test.each(PAID_AI_ROUTES)("%s makes zero provider calls on every rejection status", async (route) => {
    for (const [status, headers] of [
      [401, null], [403, null], [413, null],
      [429, { "Retry-After": "37" }], [503, null],
    ]) {
      const appHandler = jest.fn();
      const guard = jest.fn(async () => ({
        ok: false, status, body: { error: "denied" }, ...(headers ? { headers } : {}),
      }));
      const res = response();
      await createDevAiBridge(route, { appHandler, guard })({ method: "POST", url: "/", headers: {}, body: {} }, res);

      expect(res.statusCode).toBe(status);
      expect(appHandler).not.toHaveBeenCalled();
      if (headers) expect(Number(res.headers["Retry-After"])).toBeGreaterThan(0);
      else expect(res.headers["Retry-After"]).toBeUndefined();
    }
  });

  test.each(PAID_AI_ROUTES)("%s dispatches exactly once when admitted", async (route) => {
    const appHandler = jest.fn();
    const guard = jest.fn(async () => ({ ok: true, status: 200 }));
    const req = { method: "POST", url: "/?trace=1", headers: {}, body: {} };
    await createDevAiBridge(route, { appHandler, guard })(req, response());
    expect(appHandler).toHaveBeenCalledTimes(1);
    expect(req.url).toBe(`${route}?trace=1`);
  });

  test("the real translate entrypoint remains outside the Production guard", async () => {
    const appHandler = jest.fn();
    const guardFactory = jest.fn();
    let handler;
    jest.isolateModules(() => {
      jest.doMock("../../server/dev-ai", () => appHandler);
      jest.doMock("../../server/productionAiRequestGuard", () => ({ createProductionAiRequestGuard: guardFactory }));
      handler = require("../../api/translate");
    });
    await handler({ method: "POST", url: "/", headers: {}, body: {} }, response());
    expect(guardFactory).not.toHaveBeenCalled();
    expect(appHandler).toHaveBeenCalledTimes(1);
  });

  test("scope diagnostic metadata excludes backend identity and all sentinel content", async () => {
    const sentinel = "CUSTOMER_SENTINEL_9d4b6a3a";
    const originalLog = console.log;
    console.log = jest.fn();
    const server = http.createServer(devAiApp);
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const result = await requestJson(server, "/api/ai-assist", {
        sectionKey: "scope",
        userInput: sentinel,
        context: {
          scopePromptBasis: sentinel,
          sourcePrompt: sentinel,
          currentScopeNotes: sentinel,
          originalAcceptedProseScope: sentinel,
        },
      });
      expect([200, 400, 500, 503]).toContain(result.status);
      const diagnostics = Object.fromEntries(Object.entries(result.body).filter(([key]) => key.startsWith("_") || key.startsWith("debug")));
      expect(JSON.stringify(diagnostics)).not.toContain(sentinel);
      ["_backendPid", "_backendPort", "_backendStartedAt", "_backendBootId", "_backendServerFile"].forEach((field) => {
        expect(diagnostics[field]).toBeUndefined();
      });
      expect(diagnostics._scopeDashCompilerSourceTextUsedForCompilation).toBe("");
      expect(diagnostics._scopeDashTransformSource).toBe("");
      expect(diagnostics._scopePreservedAnchorTerms).toEqual([]);
      expect(diagnostics._scopeMissingAnchorTerms).toEqual([]);
    } finally {
      console.log = originalLog;
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
