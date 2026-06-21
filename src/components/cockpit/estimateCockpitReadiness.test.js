import { deriveEstimateCockpitReadiness } from "./estimateCockpitReadiness";
import { buildEstimateCockpitTotals } from "./estimateCockpitTotals";

describe("estimateCockpitReadiness", () => {
  it("marks a fresh draft as draft", () => {
    const state = {};
    const readiness = deriveEstimateCockpitReadiness(state, buildEstimateCockpitTotals(state));

    expect(readiness.status).toBe("draft");
    expect(readiness.missingRequired).toEqual(["Customer", "Non-zero total"]);
  });

  it("marks a priced estimate with customer and date as ready", () => {
    const state = {
      customer: { name: "Acme Plant", projectName: "Pump skid" },
      job: { date: "2026-06-20" },
      labor: {
        hazardPct: 0,
        riskPct: 0,
        multiplier: 1,
        lines: [{ id: "l1", role: "Welder", qty: 1, hours: 4, rate: 125 }],
      },
      ui: { docType: "estimate", materialsMode: "itemized" },
    };

    const readiness = deriveEstimateCockpitReadiness(state, buildEstimateCockpitTotals(state));

    expect(readiness.status).toBe("ready");
    expect(readiness.missingRequired).toEqual([]);
  });

  it("marks partial setup as incomplete", () => {
    const state = {
      customer: { name: "Acme Plant" },
      scopeNotes: "Repair welds at platform rail.",
    };

    const readiness = deriveEstimateCockpitReadiness(state, buildEstimateCockpitTotals(state));

    expect(readiness.status).toBe("incomplete");
    expect(readiness.missingRequired).toEqual(["Non-zero total"]);
  });
});
