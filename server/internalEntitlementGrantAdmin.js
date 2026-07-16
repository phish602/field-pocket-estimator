// Server-only internal grant administration. Do not import this module from
// React or any browser-delivered code.
//
// This is deliberately NOT an API route and never will be. Internal
// complimentary access is an out-of-band operator action requiring the
// service-role key, so no company owner or admin can grant it to themselves
// through the application.
//
// Every write requires an explicit apply flag, a matching company confirmation,
// and a human reason. Grants are revoked, never deleted.

const { createClient } = require("@supabase/supabase-js");

const GRANT_TABLE = "company_entitlement_grants";
const INTERNAL_GRANT_SOURCE = "internal_comp";
const GRANTABLE_PLANS = new Set(["solo", "pro", "business"]);
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

// Only ever expose non-sensitive fields. Never the reason, granted_by_user_id,
// revoke_reason or the raw row.
function safeGrantSummary(row, { includeGrantId = false } = {}) {
  if (!row) return null;
  return {
    ...(includeGrantId ? { grantId: text(row.id) } : {}),
    companyId: text(row.company_id),
    plan: text(row.plan),
    source: text(row.source),
    startsAt: row.starts_at ?? null,
    expiresAt: row.expires_at ?? null,
    revokedAt: row.revoked_at ?? null,
    active: !row.revoked_at,
  };
}

async function loadCompany({ client, companyId }) {
  const response = await client.from("companies").select("id, name").eq("id", text(companyId)).maybeSingle();
  if (response?.error) return { ok: false, error: "Unable to read company." };
  if (!response?.data) return { ok: false, error: "Company not found." };
  return { ok: true, company: response.data };
}

async function loadUnrevokedGrants({ client, companyId }) {
  const response = await client
    .from(GRANT_TABLE)
    .select("id, company_id, plan, source, starts_at, expires_at, revoked_at")
    .eq("company_id", text(companyId))
    .is("revoked_at", null);
  if (response?.error) return { ok: false, error: "Unable to read entitlement grants." };
  return { ok: true, rows: Array.isArray(response?.data) ? response.data : [] };
}

async function inspectEntitlementGrants({ companyId, env = process.env, adminClient } = {}) {
  if (!isUuid(companyId)) return { ok: false, error: "A valid --company-id is required." };
  const client = getAdminClient({ env, adminClient });
  if (!client) return { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." };

  const company = await loadCompany({ client, companyId });
  if (!company.ok) return company;

  const grants = await loadUnrevokedGrants({ client, companyId });
  if (!grants.ok) return grants;

  return {
    ok: true,
    action: "inspect",
    companyId: text(companyId),
    companyName: text(company.company?.name),
    activeGrants: grants.rows.map((row) => safeGrantSummary(row, { includeGrantId: true })),
  };
}

async function grantInternalEntitlement({
  companyId,
  confirmCompanyId,
  plan,
  grantedByUserId,
  reason,
  startsAt = null,
  expiresAt = null,
  apply = false,
  env = process.env,
  adminClient,
} = {}) {
  const normalizedPlan = text(plan).toLowerCase();

  if (!isUuid(companyId)) return { ok: false, error: "A valid --company-id is required." };
  // Typing the id twice is the guard against granting the wrong workspace.
  if (text(companyId) !== text(confirmCompanyId)) return { ok: false, error: "--confirm-company-id must exactly match --company-id." };
  if (!GRANTABLE_PLANS.has(normalizedPlan)) return { ok: false, error: "--plan must be solo, pro, or business." };
  if (!isUuid(grantedByUserId)) return { ok: false, error: "A valid --granted-by-user-id is required." };
  if (!text(reason)) return { ok: false, error: "A nonblank --reason is required." };

  if (startsAt && !Number.isFinite(Date.parse(text(startsAt)))) return { ok: false, error: "--starts-at must be a valid timestamp." };
  if (expiresAt && !Number.isFinite(Date.parse(text(expiresAt)))) return { ok: false, error: "--expires-at must be a valid timestamp." };
  if (startsAt && expiresAt && Date.parse(text(expiresAt)) <= Date.parse(text(startsAt))) {
    return { ok: false, error: "--expires-at must be later than --starts-at." };
  }

  const client = getAdminClient({ env, adminClient });
  if (!client) return { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." };

  const company = await loadCompany({ client, companyId });
  if (!company.ok) return company;

  const existing = await loadUnrevokedGrants({ client, companyId });
  if (!existing.ok) return existing;
  if (existing.rows.length > 0) {
    // Includes expired-but-unrevoked rows: they are historical records and must
    // be revoked explicitly rather than silently replaced.
    return {
      ok: false,
      error: "This company already has an unrevoked grant. Revoke it first (an expired grant still counts until revoked).",
      activeGrants: existing.rows.map((row) => safeGrantSummary(row, { includeGrantId: true })),
    };
  }

  const payload = {
    company_id: text(companyId),
    plan: normalizedPlan,
    source: INTERNAL_GRANT_SOURCE,
    granted_by_user_id: text(grantedByUserId),
    reason: text(reason),
    ...(startsAt ? { starts_at: new Date(text(startsAt)).toISOString() } : {}),
    ...(expiresAt ? { expires_at: new Date(text(expiresAt)).toISOString() } : {}),
  };

  if (!apply) {
    return {
      ok: true,
      applied: false,
      action: "grant",
      dryRun: true,
      companyId: text(companyId),
      companyName: text(company.company?.name),
      plan: normalizedPlan,
      source: INTERNAL_GRANT_SOURCE,
      startsAt: payload.starts_at ?? "(now)",
      expiresAt: payload.expires_at ?? null,
      message: "Dry run only. Nothing was written. Re-run with --apply to create this grant.",
    };
  }

  const response = await client.from(GRANT_TABLE).insert(payload).select("id, company_id, plan, source, starts_at, expires_at, revoked_at").maybeSingle();
  if (response?.error || !response?.data) return { ok: false, error: "Unable to create the entitlement grant." };

  return {
    ok: true,
    applied: true,
    action: "grant",
    companyName: text(company.company?.name),
    ...safeGrantSummary(response.data, { includeGrantId: true }),
  };
}

async function revokeInternalEntitlement({
  companyId,
  confirmCompanyId,
  grantId,
  revokedByUserId,
  reason,
  apply = false,
  env = process.env,
  adminClient,
  now = new Date(),
} = {}) {
  if (!isUuid(companyId)) return { ok: false, error: "A valid --company-id is required." };
  if (text(companyId) !== text(confirmCompanyId)) return { ok: false, error: "--confirm-company-id must exactly match --company-id." };
  if (!isUuid(grantId)) return { ok: false, error: "A valid --grant-id is required." };
  if (!isUuid(revokedByUserId)) return { ok: false, error: "A valid --revoked-by-user-id is required." };
  if (!text(reason)) return { ok: false, error: "A nonblank --reason is required." };

  const client = getAdminClient({ env, adminClient });
  if (!client) return { ok: false, error: "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY." };

  const lookup = await client
    .from(GRANT_TABLE)
    .select("id, company_id, plan, source, starts_at, expires_at, revoked_at")
    .eq("id", text(grantId))
    .eq("company_id", text(companyId))
    .maybeSingle();
  if (lookup?.error) return { ok: false, error: "Unable to read the entitlement grant." };
  if (!lookup?.data) return { ok: false, error: "Grant not found for this company." };
  if (lookup.data.revoked_at) return { ok: false, error: "That grant is already revoked." };

  if (!apply) {
    return {
      ok: true,
      applied: false,
      action: "revoke",
      dryRun: true,
      ...safeGrantSummary(lookup.data, { includeGrantId: true }),
      message: "Dry run only. Nothing was written. Re-run with --apply to revoke this grant.",
    };
  }

  const revokedAt = (now instanceof Date ? now : new Date()).toISOString();
  // Update, never delete: grant history is immutable.
  const response = await client
    .from(GRANT_TABLE)
    .update({
      revoked_at: revokedAt,
      revoked_by_user_id: text(revokedByUserId),
      revoke_reason: text(reason),
      updated_at: revokedAt,
    })
    .eq("id", text(grantId))
    .eq("company_id", text(companyId))
    .is("revoked_at", null)
    .select("id, company_id, plan, source, starts_at, expires_at, revoked_at")
    .maybeSingle();
  if (response?.error || !response?.data) return { ok: false, error: "Unable to revoke the entitlement grant." };

  return { ok: true, applied: true, action: "revoke", ...safeGrantSummary(response.data, { includeGrantId: true }) };
}

module.exports = {
  GRANT_TABLE,
  INTERNAL_GRANT_SOURCE,
  safeGrantSummary,
  inspectEntitlementGrants,
  grantInternalEntitlement,
  revokeInternalEntitlement,
};
