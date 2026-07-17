// Gate 17A-R: the obsolete local plan-authority seam is gone.
//
// subscriptionPlanState.js once exported
// saveLocalSubscriptionPlanStateForTrustedSourceOnly, which accepted sources
// "admin"/"stripe"/"supabase" and wrote a paid-looking state into localStorage.
// It had no production or test callers -- it was pure attack surface. These
// tests prove it cannot come back silently.

const fs = require("fs");
const path = require("path");
const planState = require("./subscriptionPlanState");
const { allowLocalEntitlementFallback } = require("./useCompanyEntitlements");

const SRC = path.join(__dirname, "..");

function walk(dir, hits, predicate) {
  fs.readdirSync(dir, { withFileTypes: true }).forEach((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, hits, predicate);
    if (!/\.(js|jsx)$/.test(entry.name)) return;
    if (/\.test\.jsx?$/.test(entry.name)) return; // this guard file names the symbol
    if (predicate(fs.readFileSync(full, "utf8"))) hits.push(full);
  });
  return hits;
}

describe("1/2. no production module exports or uses a local plan-state save seam", () => {
  test("the module no longer exports the trusted-source setter", () => {
    expect(planState.saveLocalSubscriptionPlanStateForTrustedSourceOnly).toBeUndefined();
    expect(Object.keys(planState).some((k) => /^save/i.test(k))).toBe(false);
  });

  test("no browser-delivered source references the seam or a trusted-source list", () => {
    expect(walk(SRC, [], (c) => c.includes("saveLocalSubscriptionPlanStateForTrustedSourceOnly"))).toEqual([]);
    expect(walk(SRC, [], (c) => c.includes("TRUSTED_LOCAL_SOURCES"))).toEqual([]);
  });

  test("the source file itself carries no trusted-source concept", () => {
    const src = fs.readFileSync(path.join(__dirname, "subscriptionPlanState.js"), "utf8");
    expect(src).not.toContain("TRUSTED_LOCAL_SOURCES");
    expect(src).not.toContain("saveLocalSubscriptionPlanStateForTrustedSourceOnly");
    // No writer of any kind remains in this module.
    expect(src).not.toMatch(/setItem\s*\(\s*STORAGE_KEYS\.SUBSCRIPTION_PLAN_STATE/);
  });

  test("pure normalization helpers still work for legacy display code", () => {
    expect(planState.normalizeSubscriptionPlanState({ plan: "pro", status: "active", source: "admin" }))
      .toEqual(expect.objectContaining({ plan: "pro", status: "active", source: "admin" }));
    expect(planState.getDefaultSubscriptionPlanState()).toEqual(expect.objectContaining({ plan: "free", status: "free" }));
    expect(planState.loadLocalSubscriptionPlanState).toBeInstanceOf(Function);
  });
});

describe("3. local fixtures can never run on a production host", () => {
  test.each([
    ["www.estipaid.com", "production"],
    ["www.estipaid.com", "development"],
    ["www.estipaid.com", "test"],
    ["estipaid.com", "development"],
    ["estipaid.com", "test"],
    ["field-pocket-estimator-abc123.vercel.app", "development"],
    ["field-pocket-estimator-mqrsupkb0-adrians-projects-1cc7cf12.vercel.app", "test"],
    ["some.other.host", "development"],
  ])("%s (NODE_ENV=%s) refuses local fallback", (hostname, nodeEnv) => {
    expect(allowLocalEntitlementFallback({ nodeEnv, hostname })).toBe(false);
  });

  test.each([
    ["localhost", "development", true],
    ["127.0.0.1", "test", true],
    ["localhost", "production", false],
  ])("local host %s (NODE_ENV=%s) -> %s", (hostname, nodeEnv, expected) => {
    expect(allowLocalEntitlementFallback({ nodeEnv, hostname })).toBe(expected);
  });
});

describe("4. a forged local admin/Business value stays non-authoritative", () => {
  test("normalization echoes the forgery but grants nothing by itself", () => {
    // normalizeSubscriptionPlanState is a pure shaper, not an authority: it may
    // faithfully report source "admin" -- what matters is that nothing in
    // production consults it for access.
    const forged = planState.normalizeSubscriptionPlanState({ plan: "business", status: "active", source: "admin" });
    expect(forged.plan).toBe("business");
    // There is no exported way to persist it as trusted.
    expect(planState.saveLocalSubscriptionPlanStateForTrustedSourceOnly).toBeUndefined();
  });

  test("the subscription presentation consumers resolve only through the server API", () => {
    // App.js and CompanyProfileScreen.js are the entitlement-presentation
    // consumers. Each may still touch local plan state, but ONLY behind
    // allowLocalEntitlementFallback(), which is false on every production host.
    ["App.js", "screens/CompanyProfileScreen.js"].forEach((rel) => {
      const src = fs.readFileSync(path.join(SRC, rel), "utf8");
      expect(src).toContain("resolveCompanyEntitlements");
      if (src.includes("loadLocalSubscriptionPlanState")) {
        expect(src).toContain("allowLocalEntitlementFallback");
      }
      // The pre-Gate-17A browser-Supabase plan read must be gone.
      expect(src).not.toContain("loadResolvedSubscriptionPlanState");
    });
  });

  // KNOWN, OUT OF SCOPE: src/pdf.js still reads
  // loadBestAvailableSubscriptionPlanState (the display cache) because PDF
  // generation is synchronous and cannot await the network. That is precisely
  // the protected-action problem Gate 17B exists to solve; Gate 17A-R does not
  // claim to fix it, and deliberately does not touch pdf.js.
  test("pdf.js remains the only local-cache entitlement consumer (Gate 17B scope)", () => {
    const consumers = walk(SRC, [], (c) => c.includes("loadBestAvailableSubscriptionPlanState"))
      .map((f) => path.relative(SRC, f))
      // subscriptionPlanStateRemote.js defines the helper; it is not a consumer.
      .filter((f) => f !== "lib/subscriptionPlanStateRemote.js");
    expect(consumers).toEqual(["pdf.js"]);
  });
});
