// Server-only private Stripe billing references. Do not import from React or
// any browser-delivered code: it requires service-role credentials.
//
// WHY THIS EXISTS
// Stripe customer/subscription identifiers used to live inside
// app_settings.subscription_plan_state, which the browser can read under RLS
// (the RLS patch blocks writes only). They served no browser purpose but ended
// up in localStorage caches. They now live here, behind service_role, and
// app_settings keeps only safe billing facts (plan/status/source).
//
// A browser can never supply an identifier that is trusted: every read is keyed
// by a server-validated companyId, and nothing here accepts an id from a
// request body.

const { createClient } = require("@supabase/supabase-js");

const BILLING_REFS_TABLE = "company_stripe_billing_refs";

// Identifier fields that must never survive into browser-readable state, in
// every casing the legacy writers used.
const STRIPE_ID_FIELDS = Object.freeze([
  "stripeCustomerId",
  "stripe_customer_id",
  "stripeSubscriptionId",
  "stripe_subscription_id",
]);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function isUuid(value) {
  return UUID_RE.test(text(value));
}

function getAdminClient({ env = process.env, adminClient } = {}) {
  if (adminClient?.from) return adminClient;
  const url = text(env?.SUPABASE_URL);
  const serviceRoleKey = text(env?.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

// Strip every Stripe identifier from an object destined for app_settings.
// Pure: the caller's object is not mutated.
function stripStripeIdentifiers(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const out = { ...value };
  STRIPE_ID_FIELDS.forEach((field) => { delete out[field]; });
  return out;
}

// Read the private customer id for a company. Returns "" for every failure --
// a missing/unreadable ref must degrade to "create a new customer", never throw
// and never block checkout.
async function getPrivateStripeCustomerId({ companyId, env = process.env, adminClient } = {}) {
  if (!isUuid(companyId)) return { ok: false, customerId: "", code: "invalid_company" };
  const client = getAdminClient({ env, adminClient });
  if (!client) return { ok: false, customerId: "", code: "not_configured" };
  try {
    const response = await client
      .from(BILLING_REFS_TABLE)
      .select("company_id, stripe_customer_id")
      .eq("company_id", text(companyId))
      .maybeSingle();
    // A missing table (42P01) lands here too: fail safe, never fail open.
    if (response?.error) return { ok: false, customerId: "", code: "lookup_failed" };
    const row = response?.data || null;
    if (!row) return { ok: true, customerId: "", code: "no_ref" };
    const customerId = text(row.stripe_customer_id);
    if (!customerId) return { ok: true, customerId: "", code: "no_customer" };
    return { ok: true, customerId, code: "found" };
  } catch {
    return { ok: false, customerId: "", code: "lookup_failed" };
  }
}

// Upsert identifiers privately. Only ever called by trusted server code with
// values that came from Stripe itself (a verified webhook), never from a browser.
async function upsertPrivateStripeBillingRef({ companyId, stripeCustomerId, stripeSubscriptionId, env = process.env, adminClient } = {}) {
  if (!isUuid(companyId)) return { ok: false, code: "invalid_company" };
  const customerId = text(stripeCustomerId);
  const subscriptionId = text(stripeSubscriptionId);
  if (!customerId && !subscriptionId) return { ok: true, code: "nothing_to_store", written: false };

  const client = getAdminClient({ env, adminClient });
  if (!client) return { ok: false, code: "not_configured" };

  const payload = {
    company_id: text(companyId),
    ...(customerId ? { stripe_customer_id: customerId } : {}),
    ...(subscriptionId ? { stripe_subscription_id: subscriptionId } : {}),
    updated_at: new Date().toISOString(),
  };

  try {
    // onConflict on the PK: one row per company, refreshed in place. Never a
    // second row, so a company can never end up with two customer ids.
    const response = await client.from(BILLING_REFS_TABLE).upsert(payload, { onConflict: "company_id" }).select("company_id").maybeSingle();
    if (response?.error) return { ok: false, code: "write_failed" };
    return { ok: true, code: "stored", written: true };
  } catch {
    return { ok: false, code: "write_failed" };
  }
}

module.exports = {
  BILLING_REFS_TABLE,
  STRIPE_ID_FIELDS,
  stripStripeIdentifiers,
  getPrivateStripeCustomerId,
  upsertPrivateStripeBillingRef,
};
