// Server-only Stripe subscription webhook handling. Do not import from browser code.
const Stripe = require("stripe");
const { applyStripeSubscriptionWebhookEvent } = require("./stripeSubscriptionWebhookReplayOrdering");

const SUPPORTED_EVENT_TYPES = new Set([
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "checkout.session.completed",
]);

// Centralized raw-body ceiling for the webhook entrypoint. Stripe subscription
// events are well under this; the bound exists so an unauthenticated caller
// cannot force unbounded buffering before signature verification.
const MAX_WEBHOOK_RAW_BODY_BYTES = 64 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return String(value || "").trim();
}

function isUuid(value) {
  return UUID_RE.test(text(value));
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
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function subscriptionCreatedAtIso(subscription) {
  const seconds = subscription?.created;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return "";
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function eventCreatedAtIso(event) {
  const seconds = event?.created;
  if (!Number.isSafeInteger(seconds) || seconds <= 0) return "";
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function buildPlanStateInput(subscription, eventType, env, mappedCompanyId = "") {
  const companyId = text(mappedCompanyId) || companyIdFromSources(subscription, subscription?.customer);
  if (!companyId) return null;

  const plan = planFromSubscriptionPrices(subscription, env);
  const status = eventType === "customer.subscription.deleted"
    ? "canceled"
    : (plan === "free" ? "unknown" : statusFromSubscription(subscription, eventType));
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

function isConfirmedStripeSubscriptionNotFound(error) {
  return error?.type === "StripeInvalidRequestError"
    && error?.code === "resource_missing"
    && error?.statusCode === 404;
}

function subscriptionIdFromReference(value) {
  return value && typeof value === "object" ? text(value.id) : text(value);
}

async function retrieveCurrentSubscription(stripe, subscriptionId) {
  if (!text(subscriptionId) || typeof stripe?.subscriptions?.retrieve !== "function") {
    return { ok: false, notFound: false };
  }
  try {
    const subscription = await stripe.subscriptions.retrieve(text(subscriptionId));
    return subscription && typeof subscription === "object"
      ? { ok: true, subscription }
      : { ok: false, notFound: false };
  } catch (error) {
    return { ok: false, notFound: isConfirmedStripeSubscriptionNotFound(error) };
  }
}

async function processStripeSubscriptionWebhook({
  rawBody,
  signature,
  stripe,
  webhookSecret,
  env = process.env,
  applyReplayOrdering = applyStripeSubscriptionWebhookEvent,
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

  const stripeEventId = text(event?.id);
  const eventCreatedAt = eventCreatedAtIso(event);
  if (!stripeEventId || !eventCreatedAt) {
    logIgnored(logger, eventType, "invalid_event");
    return response(400, { error: "Invalid Stripe webhook event." });
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
      const subscriptionId = subscriptionIdFromReference(session?.subscription);
      if (!subscriptionId) {
        logIgnored(logger, eventType, "invalid_event");
        return response(400, { error: "Invalid Stripe webhook event." });
      }
      const retrieval = await retrieveCurrentSubscription(stripe, subscriptionId);
      if (!retrieval.ok) {
        if (retrieval.notFound) {
          logIgnored(logger, eventType, "subscription_not_found");
          return response(200, { received: true, ignored: true });
        }
        logger?.error?.("[stripe_subscription_webhook] subscription retrieval failed", { eventType, reason: "subscription_retrieval_failed" });
        return response(500, { error: "Unable to process Stripe webhook." });
      }
      subscription = retrieval.subscription;
      const checkoutCompanyId = companyIdFromSources(subscription, session, subscription?.customer, session?.customer);
      if (!checkoutCompanyId) {
        logIgnored(logger, eventType, "missing_company_mapping");
        return response(200, { received: true, ignored: true });
      }
      input = buildPlanStateInput(subscription, eventType, env, checkoutCompanyId);
    } else {
      const signedSubscription = event?.data?.object;
      const signedSubscriptionId = text(signedSubscription?.id);
      if (!signedSubscriptionId) {
        logIgnored(logger, eventType, "invalid_event");
        return response(400, { error: "Invalid Stripe webhook event." });
      }
      const signedCompanyId = companyIdFromSources(signedSubscription, signedSubscription?.customer);
      if (!signedCompanyId || !isUuid(signedCompanyId)) {
        logIgnored(logger, eventType, signedCompanyId ? "invalid_company_mapping" : "missing_company_mapping");
        return response(200, { received: true, ignored: true });
      }
      if (eventType === "customer.subscription.deleted") {
        subscription = signedSubscription;
        input = buildPlanStateInput(subscription, eventType, env, signedCompanyId);
      } else {
        const retrieval = await retrieveCurrentSubscription(stripe, signedSubscriptionId);
        if (!retrieval.ok) {
          if (retrieval.notFound) {
            logIgnored(logger, eventType, "subscription_not_found");
            return response(200, { received: true, ignored: true });
          }
          logger?.error?.("[stripe_subscription_webhook] subscription retrieval failed", { eventType, reason: "subscription_retrieval_failed" });
          return response(500, { error: "Unable to process Stripe webhook." });
        }
        subscription = retrieval.subscription;
        input = buildPlanStateInput(subscription, eventType, env, signedCompanyId);
      }
    }

    // The mapped company id must be a real UUID before it can key any write. A
    // non-UUID cannot address a company row, so it is ignored (200) rather than
    // returned as 500 -- a 500 would put Stripe into a permanent retry loop for
    // an event that can never succeed. The identifier value is never logged.
    if (!input?.companyId || !isUuid(input.companyId)) {
      logIgnored(logger, eventType, input?.companyId ? "invalid_company_mapping" : "missing_company_mapping");
      return response(200, { received: true, ignored: true });
    }
    const stripeSubscriptionCreatedAt = subscriptionCreatedAtIso(subscription);
    if (!stripeSubscriptionCreatedAt) {
      logIgnored(logger, eventType, "invalid_event");
      return response(400, { error: "Invalid Stripe webhook event." });
    }

    const result = await applyReplayOrdering({
      stripeEventId,
      eventCreatedAt,
      stripeSubscriptionCreatedAt,
      eventType,
      companyId: input.companyId,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      plan: input.plan,
      status: input.status,
      currentPeriodEnd: input.currentPeriodEnd || null,
      env,
    });
    if (!result?.ok) {
      logger?.error?.("[stripe_subscription_webhook] replay authority failed", { eventType, reason: "replay_authority_failed" });
      return response(500, { error: "Unable to process Stripe webhook." });
    }
    if (result.category === "applied") return response(200, { received: true });
    if (result.category === "duplicate" || result.category === "stale") {
      logger?.warn?.("[stripe_subscription_webhook] ignored", { eventType, reason: result.category });
      return response(200, { received: true, ignored: true });
    }
    logger?.error?.("[stripe_subscription_webhook] replay authority failed", { eventType, reason: "replay_authority_failed" });
    return response(500, { error: "Unable to process Stripe webhook." });
  } catch {
    logger?.error?.("[stripe_subscription_webhook] processing failed", { eventType });
    return response(500, { error: "Unable to process Stripe webhook." });
  }
}

function createConfiguredWebhookProcessor({ env = process.env, StripeConstructor = Stripe, applyReplayOrdering, logger } = {}) {
  return async ({ rawBody, signature }) => {
    const webhookSecret = text(env.STRIPE_WEBHOOK_SECRET);
    const stripeSecretKey = text(env.STRIPE_SECRET_KEY);
    if (!stripeSecretKey) {
      logger?.error?.("[stripe_subscription_webhook] Stripe configuration unavailable");
      return response(500, { error: "Webhook is not configured." });
    }
    const stripe = new StripeConstructor(stripeSecretKey);
    return processStripeSubscriptionWebhook({ rawBody, signature, stripe, webhookSecret, env, applyReplayOrdering, logger });
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
  MAX_WEBHOOK_RAW_BODY_BYTES,
  buildPlanStateInput,
  createConfiguredWebhookProcessor,
  createExpressStripeSubscriptionWebhookHandler,
  planFromSubscriptionPrices,
  processStripeSubscriptionWebhook,
  statusFromSubscription,
};
