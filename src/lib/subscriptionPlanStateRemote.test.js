// Gate 17A.1a: the browser's direct subscription-row read is gone.
//
// This module previously queried app_settings.subscription_plan_state from the
// browser and cached the row -- Stripe identifiers included. Both the query and
// the cache writer are removed. Only the cache READER survives, for pdf.js,
// whose synchronous protected-action problem belongs to Gate 17B.

import * as remote from "./subscriptionPlanStateRemote";
import { STORAGE_KEYS } from "../constants/storageKeys";

beforeEach(() => localStorage.clear());

describe("the browser can no longer read the subscription row", () => {
  test("no network read, cache writer, or resolver is exported", () => {
    expect(remote.loadRemoteSubscriptionPlanState).toBeUndefined();
    expect(remote.cacheRemoteSubscriptionPlanState).toBeUndefined();
    expect(remote.loadResolvedSubscriptionPlanState).toBeUndefined();
    expect(remote.resolveSubscriptionPlanStatePriority).toBeUndefined();
    // The setting-key constant existed only to build that query.
    expect(remote.SUBSCRIPTION_PLAN_STATE_REMOTE_KEY).toBeUndefined();
  });

  test("the module source contains no Supabase query and no subscription setting key", () => {
    const src = require("fs").readFileSync(require("path").join(__dirname, "subscriptionPlanStateRemote.js"), "utf8");
    // Strip comments before asserting: the explanation mentions the old path.
    const code = src.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    expect(code).not.toContain("subscription_plan_state");
    expect(code).not.toContain(".from(");
    expect(code).not.toContain("supabase");
  });

  test("only the cache reader survives (Gate 17B owns it)", () => {
    expect(remote.loadCachedRemoteSubscriptionPlanState).toBeInstanceOf(Function);
    expect(remote.loadBestAvailableSubscriptionPlanState).toBeInstanceOf(Function);
  });
});

describe("the surviving cache reader still serves pdf.js", () => {
  test("reads a cached state without contacting the network", () => {
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE, JSON.stringify({
      state: { plan: "pro", status: "active", source: "stripe" },
    }));
    expect(remote.loadCachedRemoteSubscriptionPlanState(localStorage))
      .toEqual(expect.objectContaining({ plan: "pro", status: "active" }));
  });

  test("an absent or unparseable cache resolves to null, never throwing", () => {
    expect(remote.loadCachedRemoteSubscriptionPlanState(localStorage)).toBeNull();
    localStorage.setItem(STORAGE_KEYS.SUBSCRIPTION_PLAN_REMOTE_CACHE, "{not json");
    expect(remote.loadCachedRemoteSubscriptionPlanState(localStorage)).toBeNull();
  });

  test("loadBestAvailable falls back to Free when nothing is cached and fallback is denied", () => {
    expect(remote.loadBestAvailableSubscriptionPlanState({ storage: localStorage, allowLocalFallback: false }))
      .toEqual(expect.objectContaining({ plan: "free" }));
  });
});
