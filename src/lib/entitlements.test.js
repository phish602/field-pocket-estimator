import {
  PLAN_FREE,
  PLAN_PRO,
  PLAN_TEAM,
  normalizePlan,
  getPlanFromCompanyProfile,
  getEntitlementsForPlan,
  canRemovePdfWatermark,
  canUseCustomPdfBranding,
  canUseStripePayments,
  canUseTeamFeatures,
  shouldShowPdfWatermark,
  getPlanLabel,
} from "./entitlements";

describe("entitlements plan normalization", () => {
  test("missing plan defaults to Free", () => {
    expect(normalizePlan(undefined)).toBe(PLAN_FREE);
    expect(normalizePlan(null)).toBe(PLAN_FREE);
    expect(normalizePlan("")).toBe(PLAN_FREE);
    expect(getPlanFromCompanyProfile({})).toBe(PLAN_FREE);
    expect(getPlanFromCompanyProfile(undefined)).toBe(PLAN_FREE);
  });

  test("unknown plan defaults to Free", () => {
    expect(normalizePlan("enterprise")).toBe(PLAN_FREE);
    expect(normalizePlan("premium")).toBe(PLAN_FREE);
    expect(getPlanFromCompanyProfile({ plan: "wat" })).toBe(PLAN_FREE);
  });

  test("normalization handles common values and casing", () => {
    expect(normalizePlan("free")).toBe(PLAN_FREE);
    expect(normalizePlan("FREE")).toBe(PLAN_FREE);
    expect(normalizePlan("pro")).toBe(PLAN_PRO);
    expect(normalizePlan("Pro")).toBe(PLAN_PRO);
    expect(normalizePlan("  TEAM  ")).toBe(PLAN_TEAM);
    expect(normalizePlan("team")).toBe(PLAN_TEAM);
  });

  test("plan can be read from several profile shapes or a bare string", () => {
    expect(getPlanFromCompanyProfile("pro")).toBe(PLAN_PRO);
    expect(getPlanFromCompanyProfile({ plan: "pro" })).toBe(PLAN_PRO);
    expect(getPlanFromCompanyProfile({ subscriptionPlan: "team" })).toBe(PLAN_TEAM);
    expect(getPlanFromCompanyProfile({ subscription: { plan: "pro" } })).toBe(PLAN_PRO);
    expect(getPlanFromCompanyProfile({ subscription: { tier: "team" } })).toBe(PLAN_TEAM);
    expect(getPlanFromCompanyProfile({ tier: "pro" })).toBe(PLAN_PRO);
  });
});

describe("entitlements PDF watermark / branding", () => {
  test("Free shows the PDF watermark and cannot remove it or use custom branding", () => {
    expect(shouldShowPdfWatermark(PLAN_FREE)).toBe(true);
    expect(shouldShowPdfWatermark({})).toBe(true);
    expect(canRemovePdfWatermark(PLAN_FREE)).toBe(false);
    expect(canUseCustomPdfBranding(PLAN_FREE)).toBe(false);
  });

  test("Pro removes the watermark and can use custom PDF branding", () => {
    expect(shouldShowPdfWatermark(PLAN_PRO)).toBe(false);
    expect(canRemovePdfWatermark(PLAN_PRO)).toBe(true);
    expect(canUseCustomPdfBranding(PLAN_PRO)).toBe(true);
    // via a profile object
    expect(shouldShowPdfWatermark({ plan: "pro" })).toBe(false);
    expect(canRemovePdfWatermark({ plan: "pro" })).toBe(true);
  });

  test("Team inherits Pro-level branding (no watermark, custom branding)", () => {
    expect(shouldShowPdfWatermark(PLAN_TEAM)).toBe(false);
    expect(canRemovePdfWatermark(PLAN_TEAM)).toBe(true);
    expect(canUseCustomPdfBranding(PLAN_TEAM)).toBe(true);
  });
});

describe("entitlements payments / team features", () => {
  test("Stripe payment entitlement is Pro/Team only (helper only, not wired to billing)", () => {
    expect(canUseStripePayments(PLAN_FREE)).toBe(false);
    expect(canUseStripePayments(PLAN_PRO)).toBe(true);
    expect(canUseStripePayments(PLAN_TEAM)).toBe(true);
  });

  test("Team features are Team-only; Pro does not get team features", () => {
    expect(canUseTeamFeatures(PLAN_FREE)).toBe(false);
    expect(canUseTeamFeatures(PLAN_PRO)).toBe(false);
    expect(canUseTeamFeatures(PLAN_TEAM)).toBe(true);
  });
});

describe("entitlements bundle + labels", () => {
  test("getEntitlementsForPlan returns a coherent set for each plan", () => {
    expect(getEntitlementsForPlan(undefined)).toMatchObject({
      plan: PLAN_FREE,
      label: "Free",
      showPdfWatermark: true,
      canRemovePdfWatermark: false,
      canUseCustomPdfBranding: false,
      canUseStripePayments: false,
      canUseTeamFeatures: false,
    });
    expect(getEntitlementsForPlan("pro")).toMatchObject({
      plan: PLAN_PRO,
      label: "Pro",
      showPdfWatermark: false,
      canUseTeamFeatures: false,
    });
    expect(getEntitlementsForPlan("team")).toMatchObject({
      plan: PLAN_TEAM,
      label: "Team",
      canUseTeamFeatures: true,
    });
  });

  test("getPlanLabel maps plans to display labels and defaults to Free", () => {
    expect(getPlanLabel(undefined)).toBe("Free");
    expect(getPlanLabel({ plan: "pro" })).toBe("Pro");
    expect(getPlanLabel("team")).toBe("Team");
  });
});
