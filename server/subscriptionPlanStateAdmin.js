// Server-only scaffold. Do not import this module from React/browser code.
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

const SUBSCRIPTION_PLAN_STATE_KEY = "subscription_plan_state";
const VALID_PLANS = new Set(["free", "pro", "team"]);
const VALID_STATUSES = new Set(["free", "trialing", "active", "past_due", "canceled", "unknown"]);
const VALID_SOURCES = new Set(["stripe", "supabase", "admin"]);

function text(value) {
  return String(value || "").trim();
}

function normalizeRequired(value) {
  return text(value).toLowerCase();
}

function buildRowId() {
  return randomUUID();
}

function getAdminClient({ env = process.env, adminClient } = {}) {
  if (adminClient?.from) return adminClient;
  const url = text(env?.SUPABASE_URL);
  const serviceRoleKey = text(env?.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function validateInput(input = {}) {
  const companyId = text(input.companyId);
  const plan = normalizeRequired(input.plan);
  const status = normalizeRequired(input.status);
  const source = normalizeRequired(input.source || "stripe");
  if (!companyId) return { ok: false, error: "Missing companyId." };
  if (!VALID_PLANS.has(plan)) return { ok: false, error: "Invalid subscription plan." };
  if (!VALID_STATUSES.has(status)) return { ok: false, error: "Invalid subscription status." };
  if (!VALID_SOURCES.has(source)) return { ok: false, error: "Invalid subscription source." };
  return { ok: true, companyId, plan, status, source };
}

async function findExistingRows(client, companyId) {
  const response = await client
    .from("app_settings")
    .select("id")
    .eq("company_id", companyId)
    .eq("setting_scope", "company")
    .eq("setting_key", SUBSCRIPTION_PLAN_STATE_KEY);
  if (response?.error) throw new Error("Unable to read subscription plan state.");
  return Array.isArray(response?.data) ? response.data : [];
}

async function upsertCompanySubscriptionPlanState(input = {}) {
  const validated = validateInput(input);
  if (!validated.ok) return validated;
  const client = getAdminClient(input);
  if (!client?.from) return { ok: false, error: "Server Supabase service-role credentials are unavailable." };

  const updatedAt = new Date().toISOString();
  const payload = {
    plan: validated.plan,
    status: validated.status,
    source: validated.source,
    ...(text(input.stripeCustomerId) ? { stripeCustomerId: text(input.stripeCustomerId) } : {}),
    ...(text(input.stripeSubscriptionId) ? { stripeSubscriptionId: text(input.stripeSubscriptionId) } : {}),
    ...(text(input.currentPeriodEnd) ? { currentPeriodEnd: text(input.currentPeriodEnd) } : {}),
    updatedAt,
  };

  try {
    const rows = await findExistingRows(client, validated.companyId);
    if (rows.length > 1) return { ok: false, error: "Duplicate subscription plan state rows require manual cleanup." };
    if (rows.length === 1) {
      const response = await client.from("app_settings").update({ setting_value: payload, updated_at: updatedAt }).eq("id", rows[0].id).select("id, setting_value");
      if (response?.error) return { ok: false, error: "Unable to update subscription plan state." };
      return { ok: true, action: "updated", state: payload };
    }

    const response = await client.from("app_settings").insert({
      id: buildRowId(),
      company_id: validated.companyId,
      user_id: null,
      setting_scope: "company",
      setting_key: SUBSCRIPTION_PLAN_STATE_KEY,
      setting_value: payload,
      legacy_local_id: SUBSCRIPTION_PLAN_STATE_KEY,
      created_at: updatedAt,
      updated_at: updatedAt,
    }).select("id, setting_value");
    if (response?.error) return { ok: false, error: "Unable to create subscription plan state." };
    return { ok: true, action: "inserted", state: payload };
  } catch {
    return { ok: false, error: "Unable to write subscription plan state." };
  }
}

module.exports = { SUBSCRIPTION_PLAN_STATE_KEY, upsertCompanySubscriptionPlanState };
