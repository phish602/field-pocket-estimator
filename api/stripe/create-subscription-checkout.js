const {
  accessTokenFromAuthorization,
  createSubscriptionCheckoutSession,
} = require("../../server/stripeSubscriptionCheckout");

// Centralized checkout-body ceiling. The checkout body carries only a plan and
// a company id, so this is generous; it exists to reject abusive payloads
// before any authentication, Supabase, or Stripe work is attempted.
const MAX_CHECKOUT_BODY_BYTES = 16 * 1024;

function declaredContentLength(headers = {}) {
  const value = headers["content-length"] ?? headers["Content-Length"];
  if (Array.isArray(value)) return null;
  const raw = String(value == null ? "" : value).trim();
  if (!raw || !/^\d+$/.test(raw)) return null;
  const length = Number(raw);
  return Number.isSafeInteger(length) ? length : null;
}

// Size of the already-parsed JSON body. An unserializable body is treated as
// oversized (fails closed) rather than being waved through.
function measuredBodySize(body) {
  try {
    return Buffer.byteLength(JSON.stringify(body == null ? {} : body), "utf8");
  } catch {
    return Infinity;
  }
}

function createSubscriptionCheckoutApiHandler({
  createCheckout = createSubscriptionCheckoutSession,
  maxBodyBytes = MAX_CHECKOUT_BODY_BYTES,
} = {}) {
  return async function subscriptionCheckoutApi(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });

    const declaredLength = declaredContentLength(req.headers || {});
    if (declaredLength != null && declaredLength > maxBodyBytes) {
      return res.status(413).json({ error: "Request body is too large." });
    }
    if (measuredBodySize(req.body) > maxBodyBytes) {
      return res.status(413).json({ error: "Request body is too large." });
    }

    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    const result = await createCheckout({
      plan: body.plan,
      companyId: body.companyId,
      accessToken: accessTokenFromAuthorization(req.headers?.authorization),
    });
    if (!result?.ok) return res.status(result?.status || 500).json({ error: result?.error || "Unable to start subscription checkout." });
    return res.status(200).json({ checkoutUrl: result.checkoutUrl, sessionId: result.sessionId });
  };
}

module.exports = createSubscriptionCheckoutApiHandler();
module.exports.createSubscriptionCheckoutApiHandler = createSubscriptionCheckoutApiHandler;
module.exports.MAX_CHECKOUT_BODY_BYTES = MAX_CHECKOUT_BODY_BYTES;
