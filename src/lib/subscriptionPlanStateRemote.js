import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  getDefaultSubscriptionPlanState,
  loadLocalSubscriptionPlanState,
  normalizeSubscriptionPlanState,
} from "./subscriptionPlanState";

export const SUBSCRIPTION_PLAN_STATE_REMOTE_KEY = "subscription_plan_state";

function asCompanyId(value) {
  return String(value || "").trim();
}

function getStorage(storage) {
  if (storage) return storage;
  try {
    return localStorage;
  } catch {
    return null;
  }
}

function readCachedRemoteState(storage) {
  try {
    const raw = storage?.getItem?.(STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed?.state && typeof parsed.state === "object"
      ? normalizeSubscriptionPlanState(parsed.state)
      : null;
  } catch {
    return null;
  }
}

export function loadCachedRemoteSubscriptionPlanState(storage) {
  try {
    return readCachedRemoteState(getStorage(storage));
  } catch {
    return null;
  }
}

export function cacheRemoteSubscriptionPlanState(state, storage) {
  try {
    getStorage(storage)?.setItem?.(STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE, JSON.stringify({
      state: normalizeSubscriptionPlanState(state),
      resolvedAt: new Date().toISOString(),
    }));
    return true;
  } catch {
    return false;
  }
}

// Browser reads are intentionally limited to one company-scoped row. They
// never write billing state; service-role code owns future Stripe updates.
export async function loadRemoteSubscriptionPlanState({ supabase, companyId } = {}) {
  const normalizedCompanyId = asCompanyId(companyId);
  if (!supabase?.from || !normalizedCompanyId) {
    return { availability: "unavailable", state: getDefaultSubscriptionPlanState() };
  }

  try {
    const response = await supabase
      .from("app_settings")
      .select("id, setting_value")
      .eq("company_id", normalizedCompanyId)
      .eq("setting_scope", "company")
      .eq("setting_key", SUBSCRIPTION_PLAN_STATE_REMOTE_KEY);

    if (response?.error) {
      return { availability: "unavailable", state: getDefaultSubscriptionPlanState() };
    }

    const rows = Array.isArray(response?.data)
      ? response.data
      : (response?.data ? [response.data] : []);
    if (rows.length !== 1) {
      return { availability: rows.length > 1 ? "invalid" : "missing", state: getDefaultSubscriptionPlanState() };
    }

    return {
      availability: "available",
      state: normalizeSubscriptionPlanState(rows[0]?.setting_value),
    };
  } catch {
    return { availability: "unavailable", state: getDefaultSubscriptionPlanState() };
  }
}

export function resolveSubscriptionPlanStatePriority({
  remoteState = null,
  remoteAvailable = false,
  localState = null,
  allowLocalFallback = false,
} = {}) {
  // A present remote row wins even when malformed: malformed remote data fails
  // closed to Free rather than allowing a local browser value to upgrade access.
  if (remoteAvailable) return normalizeSubscriptionPlanState(remoteState);
  if (allowLocalFallback) return normalizeSubscriptionPlanState(localState);
  return getDefaultSubscriptionPlanState();
}

export async function loadResolvedSubscriptionPlanState({
  supabase,
  companyId,
  allowLocalFallback = false,
  storage,
} = {}) {
  const remote = await loadRemoteSubscriptionPlanState({ supabase, companyId });
  const state = resolveSubscriptionPlanStatePriority({
    remoteState: remote.state,
    remoteAvailable: remote.availability === "available" || remote.availability === "invalid",
    localState: loadLocalSubscriptionPlanState(storage),
    allowLocalFallback,
  });

  if (remote.availability === "available") cacheRemoteSubscriptionPlanState(state, storage);
  return { ...remote, state };
}

// PDF generation must remain synchronous and never wait on the network. This
// cache is a display convenience, not a billing-security boundary.
export function loadBestAvailableSubscriptionPlanState({ storage, allowLocalFallback = true } = {}) {
  return loadCachedRemoteSubscriptionPlanState(storage)
    || (allowLocalFallback ? loadLocalSubscriptionPlanState(storage) : getDefaultSubscriptionPlanState());
}
