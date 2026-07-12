import {
  PLAN_FREE,
  PLAN_SOLO,
  PLAN_PRO,
  PLAN_BUSINESS,
  normalizePlan,
  getPlanFromCompanyProfile,
  getEntitlementsForPlan,
  canRemovePdfWatermark,
  canUseCustomPdfBranding,
  canUseBusinessFeatures,
  canUseFinancialSnapshot,
  canUseReporting,
  canUseSwipePayments,
  canUseStripePayments,
  canUseTeamFeatures,
  shouldShowPdfWatermark,
  getPlanLabel,
} from "./entitlements";

describe("entitlements plan normalization", () => {
  test("missing and unknown plans default to Free", () => {
    expect(normalizePlan(undefined)).toBe(PLAN_FREE);
    expect(normalizePlan(null)).toBe(PLAN_FREE);
    expect(normalizePlan("enterprise")).toBe(PLAN_FREE);
    expect(getPlanFromCompanyProfile({})).toBe(PLAN_FREE);
  });

  test("normalizes Solo, Pro, Business, and legacy Team to Business", () => {
    expect(normalizePlan("solo")).toBe(PLAN_SOLO);
    expect(normalizePlan("Pro")).toBe(PLAN_PRO);
    expect(normalizePlan(" BUSINESS ")).toBe(PLAN_BUSINESS);
    expect(normalizePlan("team")).toBe(PLAN_BUSINESS);
    expect(getPlanFromCompanyProfile({ subscription: { tier: "team" } })).toBe(PLAN_BUSINESS);
  });
});

describe("entitlements tiers", () => {
  test("Free retains the PDF watermark", () => {
    expect(shouldShowPdfWatermark(PLAN_FREE)).toBe(true);
    expect(canRemovePdfWatermark(PLAN_FREE)).toBe(false);
  });

  test.each([PLAN_SOLO, PLAN_PRO, PLAN_BUSINESS])("%s removes the PDF watermark", (plan) => {
    expect(shouldShowPdfWatermark(plan)).toBe(false);
    expect(canRemovePdfWatermark(plan)).toBe(true);
    expect(canUseCustomPdfBranding(plan)).toBe(true);
  });

  test("Pro and Business have payments, reporting, and Financial Snapshot capabilities", () => {
    expect(canUseStripePayments(PLAN_SOLO)).toBe(false);
    expect(canUseSwipePayments(PLAN_SOLO)).toBe(false);
    expect(canUseFinancialSnapshot(PLAN_PRO)).toBe(true);
    expect(canUseReporting(PLAN_PRO)).toBe(true);
    expect(canUseSwipePayments(PLAN_PRO)).toBe(true);
    expect(canUseStripePayments(PLAN_BUSINESS)).toBe(true);
  });

  test("Business alone has company/team capabilities, with the old helper as an alias", () => {
    expect(canUseBusinessFeatures(PLAN_PRO)).toBe(false);
    expect(canUseBusinessFeatures(PLAN_BUSINESS)).toBe(true);
    expect(canUseTeamFeatures(PLAN_BUSINESS)).toBe(true);
  });

  test("the entitlement bundle and labels are customer-facing Solo/Pro/Business", () => {
    expect(getEntitlementsForPlan("solo")).toMatchObject({ plan: PLAN_SOLO, label: "Solo", canUseFinancialSnapshot: false });
    expect(getEntitlementsForPlan("pro")).toMatchObject({ plan: PLAN_PRO, label: "Pro", canUseReporting: true, canUseBusinessFeatures: false });
    expect(getEntitlementsForPlan("business")).toMatchObject({ plan: PLAN_BUSINESS, label: "Business", canUseBusinessFeatures: true });
    expect(getPlanLabel("team")).toBe("Business");
  });
});
