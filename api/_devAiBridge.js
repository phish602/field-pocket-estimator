const app = require("../server/dev-ai");
const { createProductionAiRequestGuard } = require("../server/productionAiRequestGuard");

function getQueryString(req) {
  const rawUrl = String(req.url || "");
  const index = rawUrl.indexOf("?");
  return index >= 0 ? rawUrl.slice(index) : "";
}

function reject(res, result) {
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
    guard: options.guard || createProductionAiRequestGuard(),
  });
}

module.exports = createDevAiBridge;
module.exports.createDevAiBridge = createDevAiBridge;
module.exports.createGuardedDevAiBridge = createGuardedDevAiBridge;
