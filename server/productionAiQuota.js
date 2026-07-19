// Server-only durable abuse protection for the active Production AI route.
// Do not import this module from React or any browser-delivered code: every
// function here assumes a service-role Supabase client.
//
// SCOPE (Security Gate R2.2): this protects every paid AI endpoint --
// POST /api/ai-assist and POST /api/guided-build.
//
// Guided Build has no reachable trigger in the current UI, but a dormant UI
// does not make a deployed endpoint unreachable: it still accepts direct
// authenticated requests. Removing it is deferred, so it is enrolled here
// instead. Both routes draw down ONE shared per-user and per-company budget --
// enrolling a second route must not hand a caller a second allowance.
//
// The authority model mirrors server/companyEntitlements.js: nothing the
// browser sends establishes identity, membership, or allowance. The only
// inputs that count are:
//
//   1. user_id from a server-side auth.getUser() result.
//   2. company_users membership, read from the database.
//   3. The atomic consume_ai_route_quota() function in canonical Postgres.
//
// Missing, ambiguous, invalid or unavailable authority fails closed. A quota
// store that cannot be reached must never fall through to the AI provider.

const AI_ASSIST_QUOTA_ROUTE = "/api/ai-assist";
const GUIDED_BUILD_QUOTA_ROUTE = "/api/guided-build";

// Every paid AI route admitted to the R2.2 durable quota.
const QUOTA_ENFORCED_ROUTES = new Set([AI_ASSIST_QUOTA_ROUTE, GUIDED_BUILD_QUOTA_ROUTE]);

// The single allowance every enrolled route draws down. Counters are keyed by
// this budget and never by route, so traffic split across the two endpoints
// contends for the same counters instead of doubling the caller's budget.
const PAID_AI_BUDGET = "paid_ai";

const QUOTA_CONSUME_FUNCTION = "consume_ai_route_quota";

// One quota unit is one admitted HTTP request. Limits are centralized here and
// are never read from the request; the browser cannot raise or lower them.
// Conservative on purpose -- a normal signed-in estimator stays far below them.
const AI_QUOTA_LIMITS = Object.freeze({
  shortWindowSeconds: 60,
  userShortWindow: 8,
  companyShortWindow: 20,
  dailyWindowSeconds: 86400,
  userDaily: 150,
  companyDaily: 400,
});

const MAX_RETRY_AFTER_SECONDS = AI_QUOTA_LIMITS.dailyWindowSeconds;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Every browser-visible failure is generic. Exact company-wide usage, other
// users' usage, internal table/function names and SQL errors stay server-side.
const MEMBERSHIP_DENIED = "AI assistance is not available for this account.";
const QUOTA_EXHAUSTED = "AI assistance limit reached. Please try again later.";
const QUOTA_UNAVAILABLE = "AI service is unavailable.";

function text(value) {
  return String(value == null ? "" : value).trim();
}

function isUuid(value) {
  return UUID_RE.test(text(value));
}

function isQuotaEnforcedRoute(route) {
  return QUOTA_ENFORCED_ROUTES.has(text(route));
}

function denied(status, error, headers) {
  return headers ? { ok: false, status, error, headers } : { ok: false, status, error };
}

function unavailable() {
  return denied(503, QUOTA_UNAVAILABLE);
}

// Resolve the caller's single active company from the database. The product
// supports one active company per user; more than one is ambiguous authority,
// so it is denied rather than resolved nondeterministically.
async function resolveActiveCompanyMembership({ client, userId } = {}) {
  const normalizedUserId = text(userId);
  if (!isUuid(normalizedUserId)) return denied(403, MEMBERSHIP_DENIED);
  if (!client?.from) return unavailable();

  let response;
  try {
    response = await client
      .from("company_users")
      .select("company_id")
      .eq("user_id", normalizedUserId)
      .eq("status", "active");
  } catch {
    return unavailable();
  }

  // A lookup that failed is unavailable authority; a lookup that succeeded and
  // returned nothing is absent authority. They are not the same outcome.
  if (response?.error) return unavailable();
  if (!Array.isArray(response?.data)) return unavailable();

  const companyIds = response.data.map((row) => text(row?.company_id));
  // A malformed row means the membership record itself is untrustworthy.
  if (companyIds.some((companyId) => !isUuid(companyId))) return denied(403, MEMBERSHIP_DENIED);

  const distinct = [...new Set(companyIds.map((companyId) => companyId.toLowerCase()))];
  if (distinct.length === 0) return denied(403, MEMBERSHIP_DENIED);
  if (distinct.length > 1) return denied(403, MEMBERSHIP_DENIED);

  return { ok: true, companyId: companyIds[0] };
}

// Retry-After must be a positive integer number of seconds. Anything outside
// the representable window means the store returned something we do not trust.
function normalizeRetryAfterSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  const rounded = Math.ceil(seconds);
  if (rounded < 1) return null;
  return Math.min(rounded, MAX_RETRY_AFTER_SECONDS);
}

// Consume exactly one unit. The database does the whole check-and-increment
// atomically under row locks, so concurrent Vercel instances cannot together
// exceed either the per-user or the per-company limit.
async function consumeProductionAiQuota({ client, userId, companyId, route = AI_ASSIST_QUOTA_ROUTE, limits = AI_QUOTA_LIMITS } = {}) {
  const normalizedUserId = text(userId);
  const normalizedCompanyId = text(companyId);
  if (!isUuid(normalizedUserId) || !isUuid(normalizedCompanyId)) return unavailable();
  if (!isQuotaEnforcedRoute(route)) return unavailable();
  if (!client?.rpc) return unavailable();

  let response;
  try {
    response = await client.rpc(QUOTA_CONSUME_FUNCTION, {
      p_user_id: normalizedUserId,
      p_company_id: normalizedCompanyId,
      // A budget, not a route: both paid routes contend for the same counters.
      p_budget: PAID_AI_BUDGET,
      p_user_short_limit: limits.userShortWindow,
      p_company_short_limit: limits.companyShortWindow,
      p_user_daily_limit: limits.userDaily,
      p_company_daily_limit: limits.companyDaily,
    });
  } catch {
    return unavailable();
  }

  if (response?.error) return unavailable();

  const rows = response?.data;
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row || typeof row !== "object" || Array.isArray(row)) return unavailable();

  // Only an explicit boolean is a decision. Anything else is malformed, and a
  // malformed result fails closed instead of admitting the request.
  if (row.allowed === true) return { ok: true };
  if (row.allowed !== false) return unavailable();

  const retryAfter = normalizeRetryAfterSeconds(row.retry_after_seconds);
  // A denial without a usable retry window is itself an invalid result.
  if (retryAfter == null) return unavailable();

  return denied(429, QUOTA_EXHAUSTED, { "Retry-After": String(retryAfter) });
}

// Steps 5 and 6 of the Production request order, run only after auth.getUser()
// has already established the user id.
async function authorizeProductionAiQuota({ client, userId, route, limits = AI_QUOTA_LIMITS } = {}) {
  const membership = await resolveActiveCompanyMembership({ client, userId });
  if (!membership.ok) return membership;

  const quota = await consumeProductionAiQuota({ client, userId, companyId: membership.companyId, route, limits });
  if (!quota.ok) return quota;

  return { ok: true, companyId: membership.companyId };
}

module.exports = {
  AI_ASSIST_QUOTA_ROUTE,
  AI_QUOTA_LIMITS,
  GUIDED_BUILD_QUOTA_ROUTE,
  MEMBERSHIP_DENIED,
  PAID_AI_BUDGET,
  QUOTA_CONSUME_FUNCTION,
  QUOTA_ENFORCED_ROUTES,
  QUOTA_EXHAUSTED,
  QUOTA_UNAVAILABLE,
  authorizeProductionAiQuota,
  consumeProductionAiQuota,
  isQuotaEnforcedRoute,
  normalizeRetryAfterSeconds,
  resolveActiveCompanyMembership,
};
