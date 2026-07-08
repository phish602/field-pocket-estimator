const app = require("../server/dev-ai");

function getQueryString(req) {
  const rawUrl = String(req.url || "");
  const index = rawUrl.indexOf("?");
  return index >= 0 ? rawUrl.slice(index) : "";
}

module.exports = function createDevAiBridge(routePath) {
  return function devAiBridgeHandler(req, res) {
    req.url = `${routePath}${getQueryString(req)}`;
    return app(req, res);
  };
};
