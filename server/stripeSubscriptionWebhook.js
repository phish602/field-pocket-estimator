// Server-only Stripe subscription webhook handling. Do not import from browser code.
const Stripe = require("stripe");
const { upsertCompanySubscriptionPlanState } = require("./subscriptionPlanStateAdmin");
const { upsertPrivateStripeBillingRef } = require("./companyStripeBillingRefs");

const SUPPORTED_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "checkout.session.completed",
]);

function text(value) {
  return String(value || "").trim();
}

function metadataCompanyId(value) {
  return text(value?.metadata?.companyId);
}

function companyIdFromSources(...sources) {
  for (const source of sources) {
    const companyId = metadataCompanyId(source);
    if (companyId) return companyId;
  }
  return "";
}

function configuredPriceIds(env = process.env) {
  return {
    solo: text(env.STRIPE_SOLO_PRICE_ID),
    pro: text(env.STRIPE_PRO_PRICE_ID),
    business: text(env.STRIPE_BUSINESS_PRICE_ID),
  };
}

function planFromSubscriptionPrices(subscription, env = process.env) {
  const priceIds = configuredPriceIds(env);
  const lineItems = Array.isArray(subscription?.items?.data) ? subscription.items.data : [];
  const matchedPlans = new Set();

  for (const lineItem of lineItems) {
    const priceId = text(lineItem?.price?.id || lineItem?.price);
    if (priceId && priceId === priceIds.solo) matchedPlans.add("solo");
    if (priceId && priceId === priceIds.pro) matchedPlans.add("pro");
    if (priceId && priceId === priceIds.business) matchedPlans.add("business");
  }

  return matchedPlans.size === 1 ? [...matchedPlans][0] : "free";
}

function statusFromSubscription(subscription, eventType) {
  if (eventType === "customer.subscription.deleted") return "canceled";
  const status = text(subscription?.status).toLowerCase();
  return new Set(["active", "trialing", "past_due", "canceled"]).has(status) ? status : "unknown";
}

function currentPeriodEndIso(subscription) {
  const seconds = Number(subscription?.current_period_end);
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return new Date(seconds * 1000).toISOString();
}

function buildPlanStateInput(subscription, eventType, env, mappedCompanyId = "") {
  const companyId = text(mappedCompanyId) || companyIdFromSources(subscription, subscription?.customer);
  if (!companyId) return null;

  const plan = planFromSubscriptionPrices(subscription, env);
  const status = plan === "free" ? "unknown" : statusFromSubscription(subscription, eventType);
  return {
    companyId,
    plan,
    status,
    source: "stripe",
    ...(text(subscription?.customer?.id || subscription?.customer) ? { stripeCustomerId: text(subscription?.customer?.id || subscription?.customer) } : {}),
    ...(text(subscription?.id) ? { stripeSubscriptionId: text(subscription.id) } : {}),
    ...(currentPeriodEndIso(subscription) ? { currentPeriodEnd: currentPeriodEndIso(subscription) } : {}),
  };
}

function logIgnored(logger, eventType, reason) {
  logger?.warn?.("[stripe_subscription_webhook] ignored", { eventType, reason });
}

function response(status, body) {
  return { status, body };
}

async function resolveCheckoutSubscription(session, stripe) {
  if (session?.subscription && typeof session.subscription === "object") return session.subscription;
  const subscriptionId = text(session?.subscription);
  if (!subscriptionId || typeof stripe?.subscriptions?.retrieve !== "function") return null;
  return stripe.subscriptions.retrieve(subscriptionId);
}

async function processStripeSubscriptionWebhook({
  rawBody,
  signature,
  stripe,
  webhookSecret,
  env = process.env,
  upsertPlanState = upsertCompanySubscriptionPlanState,
  upsertBillingRef = upsertPrivateStripeBillingRef,
  logger = console,
} = {}) {
  if (!text(webhookSecret)) {
    logger?.error?.("[stripe_subscription_webhook] configuration unavailable");
    return response(500, { error: "Webhook is not configured." });
  }

  let event;
  try {
    event = stripe?.webhooks?.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return response(400, { error: "Invalid Stripe webhook signature." });
  }

  const eventType = text(event?.type);
  if (!SUPPORTED_EVENT_TYPES.has(eventType)) {
    return response(200, { received: true, ignored: true });
  }

  try {
    let subscription = null;
    let input = null;

    if (eventType === "checkout.session.completed") {
      const session = event?.data?.object;
      if (text(session?.mode) !== "subscription") {
        logIgnored(logger, eventType, "not_subscription_mode");
        return response(200, { received: true, ignored: true });
      }
      subscription = await resolveCheckoutSubscription(session, stripe);
      if (!subscription) {
        logIgnored(logger, eventType, "missing_subscription_source");
        return response(200, { received: true, ignored: true });
      }
      const checkoutCompanyId = companyIdFromSources(subscription, session, subscription?.customer, session?.customer);
      if (!checkoutCompanyId) {
        logIgnored(logger, eventType, "missing_company_mapping");
        return response(200, { received: true, ignored: true });
      }
      input = buildPlanStateInput(subscription, eventType, env, checkoutCompanyId);
    } else {
      subscription = event?.data?.object;
      input = buildPlanStateInput(subscription, eventType, env);
    }

    if (!input?.companyId) {
      logIgnored(logger, eventType, "missing_company_mapping");
      return response(200, { received: true, ignored: true });
    }

    // Gate 17A.1a: identifiers go to service-role-only private storage FIRST,
    // so a later failure can never leave a subscription whose customer id was
    // dropped. The plan-state row itself carries safe facts only.
    if (text(input.stripeCustomerId) || text(input.stripeSubscriptionId)) {
      const refResult = await upsertBillingRef({
        companyId: input.companyId,
        stripeCustomerId: input.stripeCustomerId,
        stripeSubscriptionId: input.stripeSubscriptionId,
        env,
      });
      if (!refResult?.ok) {
        // Never log the identifiers themselves -- only that the write failed.
        logger?.error?.("[stripe_subscription_webhook] billing ref write failed", { eventType, code: refResult?.code });
        return response(500, { error: "Unable to update subscription billing reference." });
      }
    }

    const result = await upsertPlanState(input);
    if (!result?.ok) {
      logger?.error?.("[stripe_subscription_webhook] plan write failed", { eventType });
      return response(500, { error: "Unable to update subscription plan state." });
    }
    return response(200, { received: true });
  } catch {
    logger?.error?.("[stripe_subscription_webhook] processing failed", { eventType });
    return response(500, { error: "Unable to process Stripe webhook." });
  }
}

function createConfiguredWebhookProcessor({ env = process.env, StripeConstructor = Stripe, upsertPlanState, upsertBillingRef, logger } = {}) {
  return async ({ rawBody, signature }) => {
    const webhookSecret = text(env.STRIPE_WEBHOOK_SECRET);
    const stripeSecretKey = text(env.STRIPE_SECRET_KEY);
    if (!stripeSecretKey) {
      logger?.error?.("[stripe_subscription_webhook] Stripe configuration unavailable");
      return response(500, { error: "Webhook is not configured." });
    }
    const stripe = new StripeConstructor(stripeSecretKey);
    return processStripeSubscriptionWebhook({ rawBody, signature, stripe, webhookSecret, env, upsertPlanState, upsertBillingRef, logger });
  };
}

function createExpressStripeSubscriptionWebhookHandler(options = {}) {
  const processWebhook = createConfiguredWebhookProcessor(options);
  return async function stripeSubscriptionWebhookHandler(req, res) {
    const result = await processWebhook({
      rawBody: req.body,
      signature: req.headers?.["stripe-signature"],
    });
    return res.status(result.status).json(result.body);
  };
}

module.exports = {
  buildPlanStateInput,
  createConfiguredWebhookProcessor,
  createExpressStripeSubscriptionWebhookHandler,
  planFromSubscriptionPrices,
  processStripeSubscriptionWebhook,
  statusFromSubscription,
};
