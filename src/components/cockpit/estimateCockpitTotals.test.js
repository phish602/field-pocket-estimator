import { buildEstimateCockpitTotals, hasMeaningfulEstimateDraft } from "./estimateCockpitTotals";

describe("estimateCockpitTotals", () => {
  it("reuses engine totals for live cockpit money", () => {
    const state = {
      customer: { name: "Acme Plant" },
      job: { date: "2026-06-20", location: "Phoenix" },
      labor: {
        hazardPct: 0,
        riskPct: 0,
        multiplier: 1,
        lines: [{ id: "l1", role: "Welder", qty: 2, hours: 3, rate: 50, trueRateInternal: 25 }],
      },
      materials: {
        items: [{ id: "m1", desc: "Steel plate", qty: 2, priceEach: 30, unitCostInternal: 10 }],
      },
      ui: { docType: "estimate", materialsMode: "itemized" },
    };

    const totals = buildEstimateCockpitTotals(state);

    expect(totals.grandTotal).toBe(360);
    expect(totals.laborTotal).toBe(300);
    expect(totals.materialsTotal).toBe(60);
    expect(totals.laborLineCount).toBe(1);
    expect(totals.materialLineCount).toBe(1);
    expect(hasMeaningfulEstimateDraft(state, totals)).toBe(true);
  });

  it("treats a fresh default draft as empty", () => {
    const totals = buildEstimateCockpitTotals({});

    expect(totals.grandTotal).toBe(0);
    expect(totals.laborLineCount).toBe(0);
    expect(totals.materialLineCount).toBe(0);
    expect(hasMeaningfulEstimateDraft({}, totals)).toBe(false);
  });
});

