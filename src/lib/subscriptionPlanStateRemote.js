import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  getDefaultSubscriptionPlanState,
  loadLocalSubscriptionPlanState,
  normalizeSubscriptionPlanState,
} from "./subscriptionPlanState";


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

// Gate 17A.1a: the browser's direct read of app_settings.subscription_plan_state
// is GONE, along with the cache writer that persisted its Stripe identifiers.
// Subscription authority and display both come from /api/entitlements/resolve
// (Gate 17A-R). Nothing in production may query that row from the browser again.
//
// What remains below is the cache READER only, still used by pdf.js because PDF
// generation is synchronous and cannot await the network. That is the protected-
// action problem Gate 17B exists to solve; this gate does not change PDF
// behavior. Any Stripe identifiers already sitting in that cache are stripped by
// src/lib/subscriptionCacheSanitation.js at startup.

// PDF generation must remain synchronous and never wait on the network. This
// cache is a display convenience, not a billing-security boundary.
export function loadBestAvailableSubscriptionPlanState({ storage, allowLocalFallback = true } = {}) {
  return loadCachedRemoteSubscriptionPlanState(storage)
    || (allowLocalFallback ? loadLocalSubscriptionPlanState(storage) : getDefaultSubscriptionPlanState());
}
