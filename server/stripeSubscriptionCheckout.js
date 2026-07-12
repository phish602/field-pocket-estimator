// Server-only subscription Checkout creation. The webhook remains the sole plan-state writer.
const Stripe = require("stripe");
const { createClient } = require("@supabase/supabase-js");

const ALLOWED_PLANS = new Set(["solo", "pro", "business"]);
const MANAGEABLE_ROLES = new Set(["owner", "admin"]);

function text(value) {
  return String(value || "").trim();
}

function normalizePlan(value) {
  const plan = text(value).toLowerCase();
  return ALLOWED_PLANS.has(plan) ? plan : "";
}

function priceIdForPlan(plan, env = process.env) {
  if (plan === "solo") return text(env.STRIPE_SOLO_PRICE_ID);
  if (plan === "pro") return text(env.STRIPE_PRO_PRICE_ID);
  if (plan === "business") return text(env.STRIPE_BUSINESS_PRICE_ID);
  return "";
}

function appBaseUrl(env = process.env) {
  const configured = text(env.APP_BASE_URL);
  if (/^https?:\/\//i.test(configured)) return configured.replace(/\/$/, "");

  const vercelUrl = text(env.VERCEL_URL);
  if (vercelUrl) return `https://${vercelUrl.replace(/^https?:\/\//i, "").replace(/\/$/, "")}`;

  if (text(env.NODE_ENV) !== "production") return "http://localhost:3000";
  return "";
}

function subscriptionReturnUrls(env = process.env) {
  const baseUrl = appBaseUrl(env);
  if (!baseUrl) return null;
  return {
    successUrl: `${baseUrl}/?subscriptionCheckout=success&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${baseUrl}/?subscriptionCheckout=cancel`,
  };
}

function getAdminClient({ env = process.env, adminClient } = {}) {
  if (adminClient?.from && adminClient?.auth?.getUser) return adminClient;
  const url = text(env.SUPABASE_URL);
  const serviceRoleKey = text(env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function logAuthorizationRejection(logger, { companyId, userId = "", reason, membership = null, error = null } = {}) {
  logger?.warn?.("[stripe_subscription_checkout] authorization rejected", {
    companyId: text(companyId),
    userId: text(userId),
    reason: text(reason),
    membershipFound: Boolean(membership),
    role: text(membership?.role),
    errorCode: text(error?.code),
    errorMessage: text(error?.message),
  });
}

async function validateAuthenticatedCompanyUser({ accessToken, companyId, env = process.env, adminClient, logger = console } = {}) {
  const token = text(accessToken);
  const normalizedCompanyId = text(companyId);
  if (!token) return { ok: false, status: 400, error: "Sign in is required to start an upgrade." };
  if (!normalizedCompanyId) return { ok: false, status: 400, error: "Missing company context." };

  const client = getAdminClient({ env, adminClient });
  if (!client) return { ok: false, status: 500, error: "Subscription checkout is not configured." };

  try {
    const userResponse = await client.auth.getUser(token);
    const user = userResponse?.data?.user || null;
    if (userResponse?.error || !text(user?.id)) {
      logAuthorizationRejection(logger, { companyId: normalizedCompanyId, reason: "invalid_token", error: userResponse?.error });
      return { ok: false, status: 400, error: "Sign in is required to start an upgrade." };
    }

    const membershipResponse = await client
      .from("company_users")
      .select("company_id, user_id, role")
      .eq("company_id", normalizedCompanyId)
      .eq("user_id", text(user.id))
      .maybeSingle();
    const membership = membershipResponse?.data || null;
    if (membershipResponse?.error || !membership) {
      logAuthorizationRejection(logger, {
        companyId: normalizedCompanyId,
        userId: user.id,
        reason: "missing_membership",
        membership,
        error: membershipResponse?.error,
      });
      return { ok: false, status: 403, error: "You are not authorized to upgrade this company." };
    }
    if (!MANAGEABLE_ROLES.has(text(membership.role).toLowerCase())) {
      logAuthorizationRejection(logger, { companyId: normalizedCompanyId, userId: user.id, reason: "insufficient_role", membership });
      return { ok: false, status: 403, error: "Only a company owner or admin can start an upgrade." };
    }
    return { ok: true, user: { id: text(user.id), email: text(user.email) } };
  } catch {
    logAuthorizationRejection(logger, { companyId: normalizedCompanyId, reason: "lookup_exception" });
    return { ok: false, status: 500, error: "Unable to verify your company access." };
  }
}

async function createSubscriptionCheckoutSession({
  plan,
  companyId,
  accessToken,
  env = process.env,
  adminClient,
  stripeClient,
  StripeConstructor = Stripe,
  validateCompanyUser = validateAuthenticatedCompanyUser,
  logger,
} = {}) {
  const normalizedPlan = normalizePlan(plan);
  const normalizedCompanyId = text(companyId);
  if (!normalizedPlan) return { ok: false, status: 400, error: "Choose Solo, Pro, or Business." };
  if (!normalizedCompanyId) return { ok: false, status: 400, error: "Missing company context." };

  const access = await validateCompanyUser({ accessToken, companyId: normalizedCompanyId, env, adminClient, logger });
  if (!access?.ok) return access || { ok: false, status: 500, error: "Unable to verify your company access." };

  const priceId = priceIdForPlan(normalizedPlan, env);
  if (!priceId) return { ok: false, status: 500, error: "The selected subscription plan is not configured." };
  const returnUrls = subscriptionReturnUrls(env);
  if (!returnUrls) return { ok: false, status: 500, error: "Subscription return URLs are not configured." };

  const stripeSecretKey = text(env.STRIPE_SECRET_KEY);
  if (!stripeClient && !stripeSecretKey) return { ok: false, status: 500, error: "Subscription checkout is not configured." };

  const metadata = {
    companyId: normalizedCompanyId,
    requestedPlan: normalizedPlan,
    ...(text(access.user?.id) ? { userId: text(access.user.id) } : {}),
  };
  const stripe = stripeClient || new StripeConstructor(stripeSecretKey);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: returnUrls.successUrl,
      cancel_url: returnUrls.cancelUrl,
      ...(text(access.user?.email) ? { customer_email: text(access.user.email) } : {}),
      metadata,
      subscription_data: { metadata },
    });
    const checkoutUrl = text(session?.url);
    if (!checkoutUrl) return { ok: false, status: 500, error: "Unable to start subscription checkout." };
    return { ok: true, checkoutUrl, sessionId: text(session?.id) };
  } catch {
    return { ok: false, status: 500, error: "Unable to start subscription checkout." };
  }
}

function accessTokenFromAuthorization(value) {
  const match = /^Bearer\s+(.+)$/i.exec(text(value));
  return match ? text(match[1]) : "";
}

function createExpressSubscriptionCheckoutHandler(options = {}) {
  return async function subscriptionCheckoutHandler(req, res) {
    const result = await createSubscriptionCheckoutSession({
      plan: req.body?.plan,
      companyId: req.body?.companyId,
      accessToken: accessTokenFromAuthorization(req.headers?.authorization),
      ...options,
    });
    if (!result?.ok) return res.status(result?.status || 500).json({ error: result?.error || "Unable to start subscription checkout." });
    return res.status(200).json({ checkoutUrl: result.checkoutUrl, sessionId: result.sessionId });
  };
}

module.exports = {
  accessTokenFromAuthorization,
  appBaseUrl,
  createExpressSubscriptionCheckoutHandler,
  createSubscriptionCheckoutSession,
  normalizePlan,
  priceIdForPlan,
  subscriptionReturnUrls,
  validateAuthenticatedCompanyUser,
};
