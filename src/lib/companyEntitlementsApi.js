// Client loader for server-resolved entitlements.
//
// This module deliberately CANNOT read localStorage, the remote plan cache, or
// company profile fields. The server is the only authority; anything else in
// the browser is untrusted. Every failure path -- network error, non-2xx,
// timeout, malformed payload, unknown plan -- resolves to Free.
//
// SCOPE (Gate 17A): this secures the plan the app *presents* and the state
// subscription UI consumes. Browser-local paid work (notably synchronous PDF
// generation in pdf.js) is not made tamper-proof by this gate; that is the
// later protected-action gate (17B).

import { PLAN_FREE, PLAN_SOLO, PLAN_PRO, PLAN_BUSINESS, getEntitlementsForPlan } from "./entitlements";

export const ENTITLEMENTS_RESOLVE_PATH = "/api/entitlements/resolve";
const DEFAULT_TIMEOUT_MS = 10000;

const KNOWN_PLANS = new Set([PLAN_FREE, PLAN_SOLO, PLAN_PRO, PLAN_BUSINESS]);
const KNOWN_SOURCES = new Set(["stripe", "internal_comp", "none"]);
const KNOWN_STATUSES = new Set(["free", "active", "trialing"]);
// Billing FACTS the server may safely report. Wider than the effective-status
// set because a real subscription can be canceled or past_due -- states the UI
// should show even though they entitle nothing.
const KNOWN_BILLING_STATUSES = new Set(["free", "trialing", "active", "past_due", "canceled", "unknown"]);
const KNOWN_BILLING_SOURCES = new Set(["stripe", "none"]);

const FREE_BILLING = Object.freeze({ plan: PLAN_FREE, status: "free", source: "none" });

const text = (value) => String(value == null ? "" : value).trim();

// A billing block we do not fully understand is reported as "no billing" -- it
// must never widen access, and it is only ever display detail.
function normalizeBilling(billing) {
  if (!billing || typeof billing !== "object" || Array.isArray(billing)) return { ...FREE_BILLING };
  const plan = text(billing.plan).toLowerCase();
  const status = text(billing.status).toLowerCase();
  const source = text(billing.source).toLowerCase();
  if (!KNOWN_PLANS.has(plan) || !KNOWN_BILLING_STATUSES.has(status) || !KNOWN_BILLING_SOURCES.has(source)) {
    return { ...FREE_BILLING };
  }
  return { plan, status, source };
}



// The single fail-closed answer. Every error path returns exactly this.
export function getFreeEntitlementState(extra = {}) {
  return {
    version: 1,
    plan: PLAN_FREE,
    status: "free",
    source: "none",
    resolvedAt: "",
    expiresAt: null,
    entitlements: getEntitlementsForPlan(PLAN_FREE),
    // No server answer means no billing facts to show either.
    billing: { ...FREE_BILLING },
    loading: false,
    ok: false,
    ...extra,
  };
}

export function getLoadingEntitlementState() {
  // While loading, the app must behave as Free -- never as the last known plan.
  return getFreeEntitlementState({ loading: true, code: "loading" });
}

// Validate the server payload. A response we do not fully understand is not
// authority: it resolves Free.
export function normalizeServerEntitlementState(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return getFreeEntitlementState({ code: "malformed_payload" });

  const plan = text(payload.plan).toLowerCase();
  const status = text(payload.status).toLowerCase();
  const source = text(payload.source).toLowerCase();
  if (!KNOWN_PLANS.has(plan)) return getFreeEntitlementState({ code: "unknown_plan" });
  if (!KNOWN_STATUSES.has(status)) return getFreeEntitlementState({ code: "unknown_status" });
  if (!KNOWN_SOURCES.has(source)) return getFreeEntitlementState({ code: "unknown_source" });

  return {
    version: 1,
    // Effective access.
    plan,
    status,
    source,
    resolvedAt: text(payload.resolvedAt),
    expiresAt: payload.expiresAt ? text(payload.expiresAt) : null,
    // Derived locally from the server-resolved PLAN rather than trusting the
    // server's capability booleans verbatim; the plan is the authority. Note
    // billing is deliberately NOT an input here -- a canceled Pro record
    // entitles nothing.
    entitlements: getEntitlementsForPlan(plan),
    // Display-only billing facts.
    billing: normalizeBilling(payload.billing),
    membershipRole: text(payload.membershipRole),
    loading: false,
    ok: true,
    code: "resolved",
  };
}

export async function resolveCompanyEntitlements({
  accessToken,
  companyId,
  fetchImpl,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const token = text(accessToken);
  const company = text(companyId);
  if (!token || !company) return getFreeEntitlementState({ code: "missing_context" });

  const doFetch = fetchImpl || (typeof fetch === "function" ? fetch : null);
  if (!doFetch) return getFreeEntitlementState({ code: "fetch_unavailable" });

  let timer = null;
  try {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    if (controller && timeoutMs > 0) timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await doFetch(ENTITLEMENTS_RESOLVE_PATH, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      // Only companyId is ever sent. The server ignores everything else anyway,
      // but there is no reason to imply otherwise.
      body: JSON.stringify({ companyId: company }),
      cache: "no-store",
      ...(controller ? { signal: controller.signal } : {}),
    });

    if (!response || typeof response.status !== "number") return getFreeEntitlementState({ code: "invalid_response" });
    if (response.status === 401) return getFreeEntitlementState({ code: "unauthenticated" });
    if (response.status === 403) return getFreeEntitlementState({ code: "forbidden" });
    if (response.status < 200 || response.status >= 300) return getFreeEntitlementState({ code: "server_error" });

    let payload = null;
    try {
      payload = await response.json();
    } catch {
      return getFreeEntitlementState({ code: "malformed_payload" });
    }
    return normalizeServerEntitlementState(payload);
  } catch {
    // Network failure, abort/timeout, anything else: Free.
    return getFreeEntitlementState({ code: "network_error" });
  } finally {
    if (timer) clearTimeout(timer);
  }
}
