// Gate 17A.1a: one-time browser cleanup of legacy subscription caches.
//
// Older builds read app_settings.subscription_plan_state directly in the
// browser (RLS permits SELECT; the earlier patch blocks writes only) and cached
// the normalized row -- Stripe customer/subscription identifiers included -- in
// localStorage. Those identifiers serve no browser purpose and are now stored
// server-side only.
//
// This module removes them from devices that already have them. It is
// deliberately narrow:
//   - it touches ONLY the two subscription cache keys;
//   - it never reads or writes business records, the logo, templates, or any
//     cloud key;
//   - it never changes plan/status/source, so entitlement state is unaffected
//     (and entitlements are server-resolved anyway);
//   - it is idempotent;
//   - it never returns or logs a raw value.

import { STORAGE_KEYS } from "../constants/storageKeys";

// Every casing the legacy writers used.
export const LEGACY_STRIPE_ID_FIELDS = Object.freeze([
  "stripeCustomerId",
  "stripe_customer_id",
  "stripeSubscriptionId",
  "stripe_subscription_id",
]);

// Only these two keys are ever touched.
const SUBSCRIPTION_CACHE_KEYS = Object.freeze([
  STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE,
  STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE,
]);

function stripIdsDeep(value) {
  if (Array.isArray(value)) return { value: value.map((v) => stripIdsDeep(v).value), removed: value.reduce((n, v) => n + stripIdsDeep(v).removed, 0) };
  if (!value || typeof value !== "object") return { value, removed: 0 };
  let removed = 0;
  const out = {};
  Object.keys(value).forEach((key) => {
    if (LEGACY_STRIPE_ID_FIELDS.includes(key)) { removed += 1; return; }
    // The remote cache nests the row under `state`, so recurse.
    const child = stripIdsDeep(value[key]);
    removed += child.removed;
    out[key] = child.value;
  });
  return { value: out, removed };
}

/**
 * Remove Stripe identifiers from the legacy subscription caches.
 * Returns counts only -- never a raw value.
 */
export function sanitizeLegacySubscriptionCaches(storage = localStorage) {
  const summary = { keysInspected: 0, keysRewritten: 0, keysRemoved: 0, identifiersRemoved: 0 };
  if (!storage?.getItem) return summary;

  SUBSCRIPTION_CACHE_KEYS.forEach((key) => {
    let raw = null;
    try { raw = storage.getItem(key); } catch { return; }
    if (raw === null) return;
    summary.keysInspected += 1;

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // Unparseable legacy junk cannot be sanitized field-by-field. It is a
      // cache, never authority, so dropping it is safe and leaves no residue.
      try { storage.removeItem(key); summary.keysRemoved += 1; } catch {}
      return;
    }

    const { value, removed } = stripIdsDeep(parsed);
    if (removed === 0) return; // Idempotent: already clean, leave byte-for-byte.

    try {
      storage.setItem(key, JSON.stringify(value));
      summary.keysRewritten += 1;
      summary.identifiersRemoved += removed;
    } catch {
      // If the rewrite fails, remove the key rather than leave identifiers behind.
      try { storage.removeItem(key); summary.keysRemoved += 1; summary.identifiersRemoved += removed; } catch {}
    }
  });

  return summary;
}

/**
 * True when any legacy cache still holds a Stripe identifier field.
 * Presence only -- never the value.
 */
export function hasLegacyStripeIdentifiers(storage = localStorage) {
  if (!storage?.getItem) return false;
  return SUBSCRIPTION_CACHE_KEYS.some((key) => {
    let raw = null;
    try { raw = storage.getItem(key); } catch { return false; }
    if (!raw) return false;
    try { return stripIdsDeep(JSON.parse(raw)).removed > 0; } catch { return false; }
  });
}
