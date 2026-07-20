// Server-only Stripe webhook replay/order authority client. Do not import from browser code.
const { createClient } = require("@supabase/supabase-js");

const RPC_NAME = "apply_stripe_subscription_webhook_event";
const EVENT_TYPES = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);
const PLANS = new Set(["free", "solo", "pro", "business"]);
const STATUSES = new Set(["free", "trialing", "active", "past_due", "canceled", "unknown"]);
const CATEGORIES = new Set(["applied", "duplicate", "stale"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function validTimestamp(value) {
  const date = new Date(text(value));
  return Number.isFinite(date.getTime());
}

function getAdminClient({ env = process.env, adminClient } = {}) {
  if (adminClient?.rpc) return adminClient;
  const url = text(env?.SUPABASE_URL);
  const serviceRoleKey = text(env?.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function validInput(input = {}) {
  const eventId = text(input.stripeEventId);
  const subscriptionCreatedAt = text(input.stripeSubscriptionCreatedAt);
  const eventType = text(input.eventType);
  const companyId = text(input.companyId);
  const subscriptionId = text(input.stripeSubscriptionId);
  const plan = text(input.plan).toLowerCase();
  const status = text(input.status).toLowerCase();
  if (!eventId || !UUID_RE.test(companyId) || !subscriptionId || !EVENT_TYPES.has(eventType)
    || !PLANS.has(plan) || !STATUSES.has(status) || !validTimestamp(input.eventCreatedAt) || !validTimestamp(subscriptionCreatedAt)) {
    return null;
  }
  return {
    p_stripe_event_id: eventId,
    p_event_created_at: new Date(text(input.eventCreatedAt)).toISOString(),
    p_subscription_created_at: new Date(subscriptionCreatedAt).toISOString(),
    p_event_type: eventType,
    p_company_id: companyId,
    p_stripe_customer_id: text(input.stripeCustomerId) || null,
    p_stripe_subscription_id: subscriptionId,
    p_plan: plan,
    p_status: status,
    p_current_period_end: text(input.currentPeriodEnd) || null,
  };
}

async function applyStripeSubscriptionWebhookEvent(input = {}) {
  const params = validInput(input);
  if (!params) return { ok: false, code: "invalid_input" };
  const client = getAdminClient(input);
  if (!client) return { ok: false, code: "not_configured" };

  let response;
  try {
    response = await client.rpc(RPC_NAME, params);
  } catch {
    return { ok: false, code: "rpc_failed" };
  }
  if (response?.error) return { ok: false, code: "rpc_failed" };
  if (!Array.isArray(response?.data) || response.data.length !== 1) return { ok: false, code: "invalid_result" };
  const row = response.data[0];
  if (!row || typeof row !== "object" || Array.isArray(row) || !CATEGORIES.has(row.result_category)) {
    return { ok: false, code: "invalid_result" };
  }
  return { ok: true, category: row.result_category };
}

module.exports = {
  RPC_NAME,
  applyStripeSubscriptionWebhookEvent,
};
