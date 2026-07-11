const {
  accessTokenFromAuthorization,
  createSubscriptionCheckoutSession,
} = require("../../server/stripeSubscriptionCheckout");

function createSubscriptionCheckoutApiHandler({ createCheckout = createSubscriptionCheckoutSession } = {}) {
  return async function subscriptionCheckoutApi(req, res) {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed." });
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
