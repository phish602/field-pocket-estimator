// Subscription entitlement foundation.
//
// A small, PURE feature-gate layer that any part of the app can ask
// "is this allowed on the current plan?" without knowing about Stripe or
// Supabase. This intentionally contains:
//   - no Supabase / network calls
//   - no Stripe calls
//   - no localStorage reads or writes
//   - no React hooks
//   - no business-record mutations
//
// This module only maps a known plan to capabilities. Subscription authority
// lives in subscriptionPlanState; unknown/missing plans resolve to Free.

export const PLAN_FREE = "free";
export const PLAN_PRO = "pro";
export const PLAN_TEAM = "team";

export const PLAN_LABELS = {
  [PLAN_FREE]: "Free",
  [PLAN_PRO]: "Pro",
  [PLAN_TEAM]: "Team",
};

// Normalize any raw plan value to a known plan id. Missing / unknown / null /
// undefined all fall back to Free.
export function normalizePlan(plan) {
  const raw = String(plan == null ? "" : plan).trim().toLowerCase();
  if (raw === PLAN_PRO) return PLAN_PRO;
  if (raw === PLAN_TEAM) return PLAN_TEAM;
  return PLAN_FREE;
}

// Read the plan from a company-profile-like object. Accepts a few likely field
// shapes so the caller doesn't have to care where the plan is stored. A bare
// plan string is also accepted for convenience.
export function getPlanFromCompanyProfile(profile) {
  if (profile == null) return PLAN_FREE;
  if (typeof profile === "string") return normalizePlan(profile);
  const candidate = profile.plan
    ?? profile.subscriptionPlan
    ?? profile.subscription?.plan
    ?? profile.subscription?.tier
    ?? profile.planTier
    ?? profile.tier;
  return normalizePlan(candidate);
}

// Internal: resolve either a plan string or a profile object to a plan id.
function resolvePlan(profileOrPlan) {
  if (typeof profileOrPlan === "string") return normalizePlan(profileOrPlan);
  return getPlanFromCompanyProfile(profileOrPlan);
}

// The full entitlement set for a plan. Team inherits everything Pro has.
export function getEntitlementsForPlan(profileOrPlan) {
  const plan = resolvePlan(profileOrPlan);
  const isPro = plan === PLAN_PRO || plan === PLAN_TEAM;
  const isTeam = plan === PLAN_TEAM;
  return {
    plan,
    label: PLAN_LABELS[plan] || PLAN_LABELS[PLAN_FREE],
    // PDF / white-label
    showPdfWatermark: !isPro,
    canRemovePdfWatermark: isPro,
    canUseCustomPdfBranding: isPro,
    // Payments (helper only -- not wired into billing behavior in this lane)
    canUseStripePayments: isPro,
    // Team / multi-user (future)
    canUseTeamFeatures: isTeam,
  };
}

export function canRemovePdfWatermark(profileOrPlan) {
  return getEntitlementsForPlan(profileOrPlan).canRemovePdfWatermark;
}

export function canUseCustomPdfBranding(profileOrPlan) {
  return getEntitlementsForPlan(profileOrPlan).canUseCustomPdfBranding;
}

export function canUseStripePayments(profileOrPlan) {
  return getEntitlementsForPlan(profileOrPlan).canUseStripePayments;
}

export function canUseTeamFeatures(profileOrPlan) {
  return getEntitlementsForPlan(profileOrPlan).canUseTeamFeatures;
}

export function shouldShowPdfWatermark(profileOrPlan) {
  return getEntitlementsForPlan(profileOrPlan).showPdfWatermark;
}

export function getPlanLabel(profileOrPlan) {
  return getEntitlementsForPlan(profileOrPlan).label;
}
