// Server-only entitlement resolver. Do not import this module from React or
// any browser-delivered code: it requires service-role credentials.
//
// This is THE authorization boundary for subscription plan. Everything the
// browser holds -- localStorage, the remote cache, company profile fields, the
// request body -- is untrusted input. The only inputs that establish authority
// are:
//
//   1. A Supabase access token, validated server-side via auth.getUser().
//   2. company_users membership, read from the database (never the request).
//   3. app_settings subscription_plan_state written by the Stripe webhook.
//   4. company_entitlement_grants rows, writable only by service_role.
//
// Anything missing, malformed, duplicated, unavailable or contradictory fails
// closed to Free.
//
// SCOPE (Gate 17A): this secures subscription authority and the subscription
// state the UI presents. It does NOT make browser-local paid operations
// tamper-proof -- local PDF generation in particular remains enforceable only
// client-side until the later protected-action gate (17B). Do not read this
// module as a claim that every paid feature is secure.

const { createClient } = require("@supabase/supabase-js");

const PLAN_FREE = "free";
const PLAN_SOLO = "solo";
const PLAN_PRO = "pro";
const PLAN_BUSINESS = "business";

const SUBSCRIPTION_PLAN_STATE_KEY = "subscription_plan_state";
const INTERNAL_GRANT_SOURCE = "internal_comp";
const STRIPE_SOURCE = "stripe";

// Only a Stripe-sourced row establishes paid BILLING authority. "admin" and
// "supabase" rows exist in app_settings for legacy/manual reasons and are
// deliberately not honored here -- internal access must go through the grant
// table, where it is revocable and auditable.
const PAID_STRIPE_STATUSES = new Set(["active", "trialing"]);
const PAID_PLANS = new Set([PLAN_SOLO, PLAN_PRO, PLAN_BUSINESS]);

const PLAN_RANK = { [PLAN_FREE]: 0, [PLAN_SOLO]: 1, [PLAN_PRO]: 2, [PLAN_BUSINESS]: 3 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function isUuid(value) {
  return UUID_RE.test(text(value));
}

function normalizeEntitlementPlan(plan) {
  const raw = text(plan).toLowerCase();
  if (raw === PLAN_SOLO) return PLAN_SOLO;
  if (raw === PLAN_PRO) return PLAN_PRO;
  if (raw === PLAN_BUSINESS || raw === "team") return PLAN_BUSINESS;
  return PLAN_FREE;
}

function rankEntitlementPlan(plan) {
  return PLAN_RANK[normalizeEntitlementPlan(plan)] ?? 0;
}

// Mirrors src/lib/entitlements.js capability mapping. Kept as a plain server
// function so the API never has to import browser code.
function entitlementsForPlan(plan) {
  const normalized = normalizeEntitlementPlan(plan);
  const isPaid = PAID_PLANS.has(normalized);
  const hasPro = normalized === PLAN_PRO || normalized === PLAN_BUSINESS;
  const hasBusiness = normalized === PLAN_BUSINESS;
  return {
    showPdfWatermark: !isPaid,
    canRemovePdfWatermark: isPaid,
    canUseCustomPdfBranding: isPaid,
    canUseStripePayments: hasPro,
    canUseSwipePayments: hasPro,
    canUseFinancialSnapshot: hasPro,
    canUseReporting: hasPro,
    canUseBusinessFeatures: hasBusiness,
    canUseTeamFeatures: hasBusiness,
  };
}

function getAdminClient({ env = process.env, adminClient } = {}) {
  if (adminClient?.from && adminClient?.auth?.getUser) return adminClient;
  const url = text(env?.SUPABASE_URL);
  const serviceRoleKey = text(env?.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !serviceRoleKey) return null;
  return createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

function accessTokenFromAuthorization(authorization) {
  const raw = text(authorization);
  if (!raw) return "";
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match ? text(match[1]) : "";
}

// Authenticate the caller and prove membership from the DATABASE. The role is
// never taken from the request body: a browser claiming role "owner" changes
// nothing. Any valid member may READ their company's effective entitlement;
// owner/admin restrictions remain on subscription management (checkout), not
// on reading.
async function validateAuthenticatedCompanyMember({ accessToken, companyId, env = process.env, adminClient, logger = console } = {}) {
  const token = text(accessToken);
  const normalizedCompanyId = text(companyId);
  if (!token) return { ok: false, status: 401, error: "Authentication required." };
  if (!normalizedCompanyId || !isUuid(normalizedCompanyId)) return { ok: false, status: 400, error: "Missing company context." };

  const client = getAdminClient({ env, adminClient });
  // Misconfiguration must never silently grant access.
  if (!client) return { ok: false, status: 503, error: "Entitlements are unavailable." };

  try {
    const userResponse = await client.auth.getUser(token);
    const user = userResponse?.data?.user || null;
    if (userResponse?.error || !text(user?.id)) {
      logger?.warn?.("[company_entitlements] authentication rejected", { companyId: normalizedCompanyId, reason: "invalid_token" });
      return { ok: false, status: 401, error: "Authentication required." };
    }

    const membershipResponse = await client
      .from("company_users")
      .select("company_id, user_id, role")
      .eq("company_id", normalizedCompanyId)
      .eq("user_id", text(user.id))
      .maybeSingle();
    const membership = membershipResponse?.data || null;
    if (membershipResponse?.error || !membership) {
      logger?.warn?.("[company_entitlements] membership rejected", { companyId: normalizedCompanyId, userId: text(user.id), reason: "missing_membership" });
      return { ok: false, status: 403, error: "You are not authorized to view this company." };
    }
    return { ok: true, client, userId: text(user.id), membershipRole: text(membership.role).toLowerCase() };
  } catch {
    logger?.warn?.("[company_entitlements] authorization lookup failed", { companyId: normalizedCompanyId, reason: "lookup_exception" });
    return { ok: false, status: 503, error: "Entitlements are unavailable." };
  }
}

// Stripe billing authority from the webhook-written app_settings row.
// Returns { plan, code }. A non-paid outcome always yields plan free.
async function resolveStripePlanAuthority({ client, companyId } = {}) {
  try {
    const response = await client
      .from("app_settings")
      .select("setting_value")
      .eq("company_id", text(companyId))
      .eq("setting_scope", "company")
      .eq("setting_key", SUBSCRIPTION_PLAN_STATE_KEY);
    if (response?.error) return { plan: PLAN_FREE, code: "stripe_invalid" };

    const rows = Array.isArray(response?.data) ? response.data : [];
    if (rows.length === 0) return { plan: PLAN_FREE, code: "stripe_missing" };
    // Ambiguous authority is no authority.
    if (rows.length > 1) return { plan: PLAN_FREE, code: "stripe_duplicate" };

    const value = rows[0]?.setting_value;
    if (!value || typeof value !== "object" || Array.isArray(value)) return { plan: PLAN_FREE, code: "stripe_invalid" };

    // Only a genuinely Stripe-sourced row is billing authority.
    if (text(value.source).toLowerCase() !== STRIPE_SOURCE) return { plan: PLAN_FREE, code: "stripe_invalid" };

    const plan = normalizeEntitlementPlan(value.plan);
    const status = text(value.status).toLowerCase();
    if (!PAID_PLANS.has(plan)) return { plan: PLAN_FREE, code: "stripe_invalid" };
    if (!PAID_STRIPE_STATUSES.has(status)) return { plan: PLAN_FREE, code: "stripe_inactive" };

    return { plan, status, code: "stripe_active" };
  } catch {
    return { plan: PLAN_FREE, code: "stripe_invalid" };
  }
}

// Internal complimentary authority from the dedicated grant table.
async function resolveInternalGrantAuthority({ client, companyId, now = new Date() } = {}) {
  try {
    const response = await client
      .from("company_entitlement_grants")
      .select("id, company_id, plan, source, starts_at, expires_at, revoked_at, granted_by_user_id, reason")
      .eq("company_id", text(companyId))
      .is("revoked_at", null);
    if (response?.error) return { plan: PLAN_FREE, code: "grant_invalid" };

    const rows = Array.isArray(response?.data) ? response.data : [];
    if (rows.length === 0) return { plan: PLAN_FREE, code: "grant_missing" };
    // The partial unique index should make this impossible; if it ever happens
    // the authority is ambiguous, so it grants nothing.
    if (rows.length > 1) return { plan: PLAN_FREE, code: "grant_duplicate" };

    const row = rows[0];
    if (text(row?.source).toLowerCase() !== INTERNAL_GRANT_SOURCE) return { plan: PLAN_FREE, code: "grant_invalid" };
    if (!text(row?.reason)) return { plan: PLAN_FREE, code: "grant_invalid" };
    if (!isUuid(row?.granted_by_user_id)) return { plan: PLAN_FREE, code: "grant_invalid" };
    if (row?.revoked_at) return { plan: PLAN_FREE, code: "grant_revoked" };

    const plan = normalizeEntitlementPlan(row?.plan);
    if (!PAID_PLANS.has(plan)) return { plan: PLAN_FREE, code: "grant_invalid" };

    const startsAt = Date.parse(text(row?.starts_at));
    if (!Number.isFinite(startsAt)) return { plan: PLAN_FREE, code: "grant_invalid" };
    const resolvedAt = now instanceof Date ? now.getTime() : Date.parse(text(now));
    if (!Number.isFinite(resolvedAt)) return { plan: PLAN_FREE, code: "grant_invalid" };
    if (startsAt > resolvedAt) return { plan: PLAN_FREE, code: "grant_future" };

    const rawExpires = text(row?.expires_at);
    if (rawExpires) {
      const expiresAt = Date.parse(rawExpires);
      if (!Number.isFinite(expiresAt)) return { plan: PLAN_FREE, code: "grant_invalid" };
      if (expiresAt <= resolvedAt) return { plan: PLAN_FREE, code: "grant_expired" };
      return { plan, code: "grant_active", expiresAt: new Date(expiresAt).toISOString() };
    }
    return { plan, code: "grant_active", expiresAt: null };
  } catch {
    return { plan: PLAN_FREE, code: "grant_invalid" };
  }
}

function buildFreeResult({ companyId, membershipRole, resolvedAt, diagnostics }) {
  return {
    version: 1,
    companyId: text(companyId),
    membershipRole: text(membershipRole),
    plan: PLAN_FREE,
    status: PLAN_FREE,
    source: "none",
    resolvedAt,
    expiresAt: null,
    entitlements: entitlementsForPlan(PLAN_FREE),
    diagnostics,
  };
}

// Effective plan = the higher of the two authorities.
// Ties go to Stripe (real billing is the more meaningful provenance), so a
// grant only ever reports internal_comp when it genuinely raises the plan.
// A malformed Stripe row must never invalidate a valid internal grant.
async function resolveEffectiveCompanyEntitlements({ accessToken, companyId, env = process.env, adminClient, logger = console, now = new Date() } = {}) {
  const access = await validateAuthenticatedCompanyMember({ accessToken, companyId, env, adminClient, logger });
  if (!access.ok) return { ok: false, status: access.status, error: access.error };

  const { client, membershipRole } = access;
  const resolvedAt = (now instanceof Date ? now : new Date()).toISOString();

  const stripe = await resolveStripePlanAuthority({ client, companyId });
  const grant = await resolveInternalGrantAuthority({ client, companyId, now });
  const diagnostics = { stripeAuthority: stripe.code, internalGrantAuthority: grant.code };

  const stripeRank = rankEntitlementPlan(stripe.plan);
  const grantRank = rankEntitlementPlan(grant.plan);

  if (stripeRank === 0 && grantRank === 0) {
    return { ok: true, status: 200, result: buildFreeResult({ companyId, membershipRole, resolvedAt, diagnostics }) };
  }

  const useGrant = grantRank > stripeRank;
  const plan = useGrant ? grant.plan : stripe.plan;
  return {
    ok: true,
    status: 200,
    result: {
      version: 1,
      companyId: text(companyId),
      membershipRole: text(membershipRole),
      plan,
      status: useGrant ? "active" : text(stripe.status || "active"),
      source: useGrant ? INTERNAL_GRANT_SOURCE : STRIPE_SOURCE,
      resolvedAt,
      // Only an internal grant carries an expiry the browser may see; Stripe
      // period ends are billing details and stay server-side.
      expiresAt: useGrant ? (grant.expiresAt ?? null) : null,
      entitlements: entitlementsForPlan(plan),
      diagnostics,
    },
  };
}

module.exports = {
  PLAN_FREE,
  PLAN_SOLO,
  PLAN_PRO,
  PLAN_BUSINESS,
  INTERNAL_GRANT_SOURCE,
  SUBSCRIPTION_PLAN_STATE_KEY,
  accessTokenFromAuthorization,
  normalizeEntitlementPlan,
  rankEntitlementPlan,
  entitlementsForPlan,
  validateAuthenticatedCompanyMember,
  resolveStripePlanAuthority,
  resolveInternalGrantAuthority,
  resolveEffectiveCompanyEntitlements,
};
