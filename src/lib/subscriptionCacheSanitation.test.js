// Gate 17A.1a: startup sanitation of legacy subscription caches.
//
// Pre-Gate-17A builds cached the browser-read subscription row, Stripe
// identifiers included. These tests use obviously fake identifiers.

import { sanitizeLegacySubscriptionCaches, hasLegacyStripeIdentifiers } from "./subscriptionCacheSanitation";
import { STORAGE_KEYS } from "../constants/storageKeys";

// Fake, clearly-not-real identifiers.
const FAKE_CUS = "cus_FAKE000000000";
const FAKE_SUB = "sub_FAKE000000000";

const K_CACHE = STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE;
const K_STATE = STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE;

beforeEach(() => localStorage.clear());

test("removes camelCase identifiers from the nested remote cache", () => {
  localStorage.setItem(K_CACHE, JSON.stringify({
    state: { plan: "solo", status: "canceled", source: "stripe", stripeCustomerId: FAKE_CUS, stripeSubscriptionId: FAKE_SUB, updatedAt: "2026-07-12T08:44:34.256Z" },
    resolvedAt: "2026-07-16T23:29:07.657Z",
  }));

  const summary = sanitizeLegacySubscriptionCaches(localStorage);

  expect(summary.identifiersRemoved).toBe(2);
  const after = JSON.parse(localStorage.getItem(K_CACHE));
  expect(after.state.stripeCustomerId).toBeUndefined();
  expect(after.state.stripeSubscriptionId).toBeUndefined();
  // Billing facts survive untouched -- entitlement state must not move.
  expect(after.state).toEqual(expect.objectContaining({ plan: "solo", status: "canceled", source: "stripe", updatedAt: "2026-07-12T08:44:34.256Z" }));
  expect(after.resolvedAt).toBe("2026-07-16T23:29:07.657Z");
  expect(localStorage.getItem(K_CACHE)).not.toContain(FAKE_CUS);
  expect(localStorage.getItem(K_CACHE)).not.toContain(FAKE_SUB);
});

test("removes snake_case identifiers", () => {
  localStorage.setItem(K_STATE, JSON.stringify({
    plan: "pro", status: "active", source: "stripe", stripe_customer_id: FAKE_CUS, stripe_subscription_id: FAKE_SUB,
  }));

  const summary = sanitizeLegacySubscriptionCaches(localStorage);

  expect(summary.identifiersRemoved).toBe(2);
  const after = JSON.parse(localStorage.getItem(K_STATE));
  expect(after.stripe_customer_id).toBeUndefined();
  expect(after.stripe_subscription_id).toBeUndefined();
  expect(after).toEqual({ plan: "pro", status: "active", source: "stripe" });
});

test("removes mixed casings across both keys at once", () => {
  localStorage.setItem(K_STATE, JSON.stringify({ plan: "solo", stripeCustomerId: FAKE_CUS }));
  localStorage.setItem(K_CACHE, JSON.stringify({ state: { plan: "solo", stripe_subscription_id: FAKE_SUB } }));

  const summary = sanitizeLegacySubscriptionCaches(localStorage);

  expect(summary.identifiersRemoved).toBe(2);
  expect(summary.keysRewritten).toBe(2);
  expect(localStorage.getItem(K_STATE)).not.toContain(FAKE_CUS);
  expect(localStorage.getItem(K_CACHE)).not.toContain(FAKE_SUB);
});

test("is idempotent: a clean cache is left byte-for-byte and a second pass is a no-op", () => {
  const clean = JSON.stringify({ state: { plan: "solo", status: "canceled", source: "stripe" } });
  localStorage.setItem(K_CACHE, clean);

  const first = sanitizeLegacySubscriptionCaches(localStorage);
  expect(first.identifiersRemoved).toBe(0);
  expect(first.keysRewritten).toBe(0);
  expect(localStorage.getItem(K_CACHE)).toBe(clean); // untouched, not re-serialized

  const second = sanitizeLegacySubscriptionCaches(localStorage);
  expect(second.identifiersRemoved).toBe(0);
  expect(localStorage.getItem(K_CACHE)).toBe(clean);
});

test("running twice over a dirty cache leaves it clean and stable", () => {
  localStorage.setItem(K_CACHE, JSON.stringify({ state: { plan: "solo", stripeCustomerId: FAKE_CUS } }));
  sanitizeLegacySubscriptionCaches(localStorage);
  const afterFirst = localStorage.getItem(K_CACHE);
  sanitizeLegacySubscriptionCaches(localStorage);
  expect(localStorage.getItem(K_CACHE)).toBe(afterFirst);
  expect(hasLegacyStripeIdentifiers(localStorage)).toBe(false);
});

test("preserves unrelated storage byte-for-byte", () => {
  const invoices = JSON.stringify([{ id: "inv-1", total: 100 }]);
  const profile = JSON.stringify({ companyName: "BVW", logoDataUrl: "data:image/png;base64,AAAA" });
  const baseline = JSON.stringify({ version: 1, snapshots: {} });
  localStorage.setItem(STORAGE_KEYS.INVOICES, invoices);
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, profile);
  localStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE, baseline);
  localStorage.setItem(K_CACHE, JSON.stringify({ state: { plan: "solo", stripeCustomerId: FAKE_CUS } }));

  sanitizeLegacySubscriptionCaches(localStorage);

  expect(localStorage.getItem(STORAGE_KEYS.INVOICES)).toBe(invoices);
  expect(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE)).toBe(profile);
  expect(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).toBe(baseline);
});

test("an unparseable cache is dropped rather than left holding identifiers", () => {
  localStorage.setItem(K_CACHE, `{"state":{"stripeCustomerId":"${FAKE_CUS}"` ); // truncated JSON
  const summary = sanitizeLegacySubscriptionCaches(localStorage);
  expect(summary.keysRemoved).toBe(1);
  expect(localStorage.getItem(K_CACHE)).toBeNull();
});

test("absent keys are a no-op", () => {
  const summary = sanitizeLegacySubscriptionCaches(localStorage);
  expect(summary).toEqual({ keysInspected: 0, keysRewritten: 0, keysRemoved: 0, identifiersRemoved: 0 });
});

test("hasLegacyStripeIdentifiers detects presence without returning values", () => {
  expect(hasLegacyStripeIdentifiers(localStorage)).toBe(false);
  localStorage.setItem(K_CACHE, JSON.stringify({ state: { stripeCustomerId: FAKE_CUS } }));
  expect(hasLegacyStripeIdentifiers(localStorage)).toBe(true);
  sanitizeLegacySubscriptionCaches(localStorage);
  expect(hasLegacyStripeIdentifiers(localStorage)).toBe(false);
});

test("the summary never contains an identifier value", () => {
  localStorage.setItem(K_CACHE, JSON.stringify({ state: { stripeCustomerId: FAKE_CUS, stripeSubscriptionId: FAKE_SUB } }));
  const summary = sanitizeLegacySubscriptionCaches(localStorage);
  const serialized = JSON.stringify(summary);
  expect(serialized).not.toContain(FAKE_CUS);
  expect(serialized).not.toContain(FAKE_SUB);
  expect(serialized).not.toContain("cus_");
  expect(serialized).not.toContain("sub_");
});

// ---------------------------------------------------------------------------
// Defense in depth: even if a legacy identifier reaches normalization from an
// old cache, it is dropped rather than carried forward.
// ---------------------------------------------------------------------------
describe("normalization no longer carries Stripe identifiers", () => {
  const { normalizeSubscriptionPlanState } = require("./subscriptionPlanState");

  test("identifiers present in raw input are dropped; safe facts survive", () => {
    const normalized = normalizeSubscriptionPlanState({
      plan: "solo", status: "canceled", source: "stripe", currentPeriodEnd: "2026-08-01T00:00:00.000Z",
      stripeCustomerId: FAKE_CUS, stripeSubscriptionId: FAKE_SUB,
      stripe_customer_id: FAKE_CUS, stripe_subscription_id: FAKE_SUB,
    });
    expect(normalized).toEqual(expect.objectContaining({ plan: "solo", status: "canceled", source: "stripe", currentPeriodEnd: "2026-08-01T00:00:00.000Z" }));
    const serialized = JSON.stringify(normalized);
    expect(serialized).not.toContain("cus_");
    expect(serialized).not.toContain("sub_");
    expect(Object.keys(normalized).sort()).toEqual(["currentPeriodEnd", "plan", "source", "status", "updatedAt"]);
  });

  test("the production source file retains no identifier pass-through", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "subscriptionPlanState.js"), "utf8");
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toContain("stripeCustomerId");
    expect(code).not.toContain("stripeSubscriptionId");
  });
});
