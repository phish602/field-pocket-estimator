import {
  PLAN_FREE,
  PLAN_SOLO,
  PLAN_PRO,
  PLAN_BUSINESS,
  getEntitlementsForPlan,
  getPlanLabel,
  normalizePlan,
} from "./entitlements";
import { STORAGE_KEYS } from "../constants/storageKeys";

export const SUBSCRIPTION_STATUSES = Object.freeze({
  FREE: "free",
  TRIALING: "trialing",
  ACTIVE: "active",
  PAST_DUE: "past_due",
  CANCELED: "canceled",
  UNKNOWN: "unknown",
});

const KNOWN_STATUSES = new Set(Object.values(SUBSCRIPTION_STATUSES));
const TRUSTED_LOCAL_SOURCES = new Set(["local_dev", "stripe", "supabase", "admin"]);

export function normalizeSubscriptionStatus(status) {
  const value = String(status == null ? "" : status).trim().toLowerCase();
  return KNOWN_STATUSES.has(value) ? value : SUBSCRIPTION_STATUSES.UNKNOWN;
}

export function getDefaultSubscriptionPlanState() {
  return {
    plan: PLAN_FREE,
    status: SUBSCRIPTION_STATUSES.FREE,
    source: "default",
    updatedAt: "",
  };
}

export function normalizeSubscriptionPlanState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return getDefaultSubscriptionPlanState();
  }

  const plan = normalizePlan(raw.plan);
  const status = normalizeSubscriptionStatus(raw.status);
  return {
    plan,
    status,
    source: String(raw.source || "default").trim().toLowerCase() || "default",
    ...(raw.stripeCustomerId ? { stripeCustomerId: String(raw.stripeCustomerId) } : {}),
    ...(raw.stripeSubscriptionId ? { stripeSubscriptionId: String(raw.stripeSubscriptionId) } : {}),
    ...(raw.currentPeriodEnd ? { currentPeriodEnd: String(raw.currentPeriodEnd) } : {}),
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : "",
  };
}

export function shouldTreatSubscriptionAsPaid(raw) {
  const state = normalizeSubscriptionPlanState(raw);
  const paidPlan = state.plan === PLAN_SOLO || state.plan === PLAN_PRO || state.plan === PLAN_BUSINESS;
  return paidPlan && (
    state.status === SUBSCRIPTION_STATUSES.ACTIVE
    || state.status === SUBSCRIPTION_STATUSES.TRIALING
  );
}

export function resolvePlanFromSubscriptionState(raw) {
  const state = normalizeSubscriptionPlanState(raw);
  return shouldTreatSubscriptionAsPaid(state) ? state.plan : PLAN_FREE;
}

export function getEntitlementsFromSubscriptionState(raw) {
  return getEntitlementsForPlan(resolvePlanFromSubscriptionState(raw));
}

export function getSubscriptionPlanLabel(raw) {
  return getPlanLabel(resolvePlanFromSubscriptionState(raw));
}

export function getSubscriptionStatusLabel(raw) {
  const status = normalizeSubscriptionPlanState(raw).status;
  const labels = {
    [SUBSCRIPTION_STATUSES.FREE]: "Free",
    [SUBSCRIPTION_STATUSES.TRIALING]: "Trialing",
    [SUBSCRIPTION_STATUSES.ACTIVE]: "Active",
    [SUBSCRIPTION_STATUSES.PAST_DUE]: "Past due",
    [SUBSCRIPTION_STATUSES.CANCELED]: "Canceled",
    [SUBSCRIPTION_STATUSES.UNKNOWN]: "Unknown",
  };
  return labels[status] || labels[SUBSCRIPTION_STATUSES.UNKNOWN];
}

function getBrowserStorage(storage) {
  if (storage) return storage;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

export function loadLocalSubscriptionPlanState(storage) {
  try {
    const raw = getBrowserStorage(storage)?.getItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE);
    return normalizeSubscriptionPlanState(raw ? JSON.parse(raw) : null);
  } catch {
    return getDefaultSubscriptionPlanState();
  }
}

// This is intentionally not exposed through normal product UI. It provides a
// stable local seam for tests, development, and a future trusted server sync.
export function saveLocalSubscriptionPlanStateForTrustedSourceOnly(raw, storage) {
  const state = normalizeSubscriptionPlanState(raw);
  if (!TRUSTED_LOCAL_SOURCES.has(state.source)) return false;
  const targetStorage = getBrowserStorage(storage);
  if (!targetStorage?.setItem) return false;
  const next = { ...state, updatedAt: state.updatedAt || new Date().toISOString() };
  try {
    targetStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, JSON.stringify(next));
    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", {
        detail: { key: STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE, value: JSON.stringify(next) },
      }));
    } catch {}
    return true;
  } catch {
    return false;
  }
}
