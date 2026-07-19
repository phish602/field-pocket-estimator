const app = require("../server/dev-ai");
const { createProductionAiRequestGuard } = require("../server/productionAiRequestGuard");

function getQueryString(req) {
  const rawUrl = String(req.url || "");
  const index = rawUrl.indexOf("?");
  return index >= 0 ? rawUrl.slice(index) : "";
}

function reject(res, result) {
  // Rejections may carry response headers (Retry-After on a quota denial).
  // Never carries a body beyond the generic error the guard already built.
  const headers = result?.headers;
  if (headers && typeof res?.setHeader === "function") {
    Object.entries(headers).forEach(([name, value]) => res.setHeader(name, value));
  }
  return res.status(result.status).json(result.body);
}

function createDevAiBridge(routePath, { appHandler = app, guard = null } = {}) {
  return async function devAiBridgeHandler(req, res) {
    if (guard) {
      const result = await guard(req);
      if (!result?.ok) return reject(res, result || { status: 503, body: { error: "AI service is unavailable." } });
    }
    req.url = `${routePath}${getQueryString(req)}`;
    return appHandler(req, res);
  };
}

function createGuardedDevAiBridge(routePath, options = {}) {
  return createDevAiBridge(routePath, {
    ...options,
    // The route label lets the guard decide whether the R2.2 durable quota
    // applies. Both paid AI endpoints -- /api/ai-assist and /api/guided-build --
    // are enrolled and share one paid_ai budget, so splitting traffic between
    // them cannot buy a caller a second allowance.
    guard: options.guard || createProductionAiRequestGuard({ route: routePath }),
  });
}

module.exports = createDevAiBridge;
module.exports.createDevAiBridge = createDevAiBridge;
module.exports.createGuardedDevAiBridge = createGuardedDevAiBridge;
