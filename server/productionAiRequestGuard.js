const { createClient } = require("@supabase/supabase-js");

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

function decision(ok, status = 200, error = "") {
  return ok ? { ok: true, status } : { ok: false, status, body: { error } };
}

function createProductionAiRequestGuard({ getAdminClient = getServerAuthClient, maxBodyBytes = MAX_PRODUCTION_AI_BODY_BYTES } = {}) {
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

    try {
      const result = await client.auth.getUser(token);
      if (result?.error || !text(result?.data?.user?.id)) {
        return decision(false, 401, "Authentication required.");
      }
    } catch {
      return decision(false, 503, "AI service is unavailable.");
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
