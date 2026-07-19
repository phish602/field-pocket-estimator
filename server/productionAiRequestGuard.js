const { createClient } = require("@supabase/supabase-js");
const {
  authorizeProductionAiQuota,
  isQuotaEnforcedRoute,
} = require("./productionAiQuota");

const MAX_PRODUCTION_AI_BODY_BYTES = 128 * 1024;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function getServerAuthClient({ env = process.env, adminClient } = {}) {
  if (adminClient?.auth?.getUser) return adminClient;
  const url = text(env?.SUPABASE_URL);
  const serviceRoleKey = text(env?.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function bearerTokenFromAuthorization(authorization) {
  if (Array.isArray(authorization) || typeof authorization !== "string") return "";
  const match = /^Bearer[ \t]+([^\s,]+)$/i.exec(authorization.trim());
  return match ? text(match[1]) : "";
}

function declaredContentLength(headers = {}) {
  const value = headers["content-length"] ?? headers["Content-Length"];
  if (Array.isArray(value)) return null;
  const raw = text(value);
  if (!raw || !/^\d+$/.test(raw)) return null;
  const length = Number(raw);
  return Number.isSafeInteger(length) ? length : null;
}

function serializedBodySize(body) {
  if (Buffer.isBuffer(body)) return body.length;
  if (typeof body === "string") return Buffer.byteLength(body, "utf8");
  try {
    return Buffer.byteLength(JSON.stringify(body == null ? {} : body), "utf8");
  } catch {
    return Infinity;
  }
}

function decision(ok, status = 200, error = "", headers = null) {
  if (ok) return { ok: true, status };
  const rejection = { ok: false, status, body: { error } };
  if (headers) rejection.headers = headers;
  return rejection;
}

// `route` opts a route into the R2.2 durable quota. Both paid AI endpoints --
// /api/ai-assist and /api/guided-build -- are enrolled, and both draw down the
// same shared paid_ai budget rather than one allowance each. It defaults to
// none, so an unlabelled guard keeps plain R2.1 behavior for any route we have
// not deliberately enrolled.
function createProductionAiRequestGuard({ route = "", getAdminClient = getServerAuthClient, maxBodyBytes = MAX_PRODUCTION_AI_BODY_BYTES, authorizeQuota = authorizeProductionAiQuota } = {}) {
  return async function guardProductionAiRequest(req = {}) {
    if (req.method !== "POST") return decision(false, 405, "Method not allowed.");

    const declaredLength = declaredContentLength(req.headers || {});
    if (declaredLength != null && declaredLength > maxBodyBytes) {
      return decision(false, 413, "Request body is too large.");
    }
    if (serializedBodySize(req.body) > maxBodyBytes) {
      return decision(false, 413, "Request body is too large.");
    }

    const token = bearerTokenFromAuthorization(req.headers?.authorization ?? req.headers?.Authorization);
    if (!token) return decision(false, 401, "Authentication required.");

    const client = getAdminClient({ env: process.env });
    if (!client?.auth?.getUser) return decision(false, 503, "AI service is unavailable.");

    let userId = "";
    try {
      const result = await client.auth.getUser(token);
      if (result?.error || !text(result?.data?.user?.id)) {
        return decision(false, 401, "Authentication required.");
      }
      // Identity comes from the verified auth result and nowhere else. Any
      // user_id, company_id, role or usage count in the request body is ignored.
      userId = text(result.data.user.id);
    } catch {
      return decision(false, 503, "AI service is unavailable.");
    }

    if (!isQuotaEnforcedRoute(route)) return decision(true);

    const authorization = await authorizeQuota({ client, userId, route });
    if (!authorization?.ok) {
      const status = Number.isInteger(authorization?.status) ? authorization.status : 503;
      const error = text(authorization?.error) || "AI service is unavailable.";
      return decision(false, status, error, authorization?.headers || null);
    }

    return decision(true);
  };
}

module.exports = {
  MAX_PRODUCTION_AI_BODY_BYTES,
  bearerTokenFromAuthorization,
  createProductionAiRequestGuard,
  declaredContentLength,
  getServerAuthClient,
  serializedBodySize,
};
