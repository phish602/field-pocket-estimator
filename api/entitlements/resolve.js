// POST /api/entitlements/resolve
//
// Returns the server-resolved effective entitlement for one authenticated,
// company-scoped caller. The ONLY inputs honored are the bearer access token
// and companyId. Any plan/status/source/role/entitlements fields the browser
// puts in the body are ignored outright -- they are not read here or below.
//
// This endpoint never mutates anything. Internal grants are created and revoked
// exclusively through the service-role CLI, never over HTTP.

const {
  accessTokenFromAuthorization,
  resolveEffectiveCompanyEntitlements,
} = require("../../server/companyEntitlements");

function createEntitlementsResolveApiHandler({ resolveEntitlements = resolveEffectiveCompanyEntitlements } = {}) {
  return async function entitlementsResolveApi(req, res) {
    // Never cache an authorization result.
    res.setHeader?.("Cache-Control", "no-store");

    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};

    let result;
    try {
      result = await resolveEntitlements({
        // Only these two values. Reading any other body field would defeat the
        // entire boundary.
        accessToken: accessTokenFromAuthorization(req.headers?.authorization),
        companyId: body.companyId,
      });
    } catch {
      // Never leak a stack trace or database error; fail closed.
      return res.status(503).json({ error: "Entitlements are unavailable." });
    }

    if (!result?.ok) {
      return res.status(result?.status || 503).json({ error: result?.error || "Entitlements are unavailable." });
    }
    return res.status(200).json(result.result);
  };
}

module.exports = createEntitlementsResolveApiHandler();
module.exports.createEntitlementsResolveApiHandler = createEntitlementsResolveApiHandler;
