import {
  buildMaterialsAssistPreflight,
  detectMaterialsAssistIntent,
  materialsAssistConfig,
} from "./materials";

function createState(overrides = {}) {
  return {
    ui: {
      materialsMode: "itemized",
    },
    tradeInsert: {
      key: "plumbing",
      text: "Plumbing",
    },
    scopeNotes: "Replace three toilets and connect new supply lines in two restrooms.",
    customer: {
      projectName: "Restroom Refresh",
      projectAddress: "123 Main St",
      address: "123 Main St",
    },
    materials: {
      blanketCost: "",
      materialsBlanketDescription: "",
      markupPct: "20",
      items: [
        { id: "m1", desc: "Toilet", qty: "1", priceEach: "280", unitCostInternal: "215", note: "" },
      ],
    },
    ...overrides,
  };
}

describe("materials assist adapter", () => {
  test("asks the user to choose a materials mode when none is set", () => {
    expect(buildMaterialsAssistPreflight({ userInput: "Wax rings and closet bolts", mode: "" })).toEqual(
      expect.objectContaining({
        responseType: "needs_mode",
      })
    );
  });

  test("detects itemized intent from non-paint material lists", () => {
    expect(detectMaterialsAssistIntent("3 toilets, wax rings, closet bolts, supply lines, caulk")).toBe("itemized");
  });

  test("flags clear mode mismatches without auto-switching", () => {
    expect(
      buildMaterialsAssistPreflight({
        userInput: "3 toilets, wax rings, closet bolts, supply lines, caulk",
        mode: "blanket",
      })
    ).toEqual(
      expect.objectContaining({
        responseType: "mode_mismatch",
        recommendedMode: "itemized",
      })
    );

    expect(
      buildMaterialsAssistPreflight({
        userInput: "Give me one rough materials allowance number",
        mode: "itemized",
      })
    ).toEqual(
      expect.objectContaining({
        responseType: "mode_mismatch",
        recommendedMode: "blanket",
      })
    );
  });

  test("normalizes blanket suggestions into a predictable allowance structure", () => {
    const writes = materialsAssistConfig.localAdapter(
      {
        responseType: "blanketSuggestion",
        suggestedAmount: 1325.5,
        assumptionsSummary: "Carry toilets, connection kits, sealants, trim-out supplies, delivery, and disposal.",
        includedCategories: ["Fixtures", "Connection kits", "Sealants", "Disposal"],
      },
      createState({
        ui: { materialsMode: "blanket" },
        materials: {
          blanketCost: "",
          materialsBlanketDescription: "",
          markupPct: "20",
          items: [],
        },
      })
    );

    expect(writes).toEqual({
      kind: "materials",
      mode: "blanket",
      blanketSuggestion: {
        suggestedAmount: 1325.5,
        assumptionsSummary: "Carry toilets, connection kits, sealants, trim-out supplies, delivery, and disposal.",
        includedCategories: ["Fixtures", "Connection kits", "Sealants", "Disposal"],
      },
    });
    expect(materialsAssistConfig.validationRules(writes)).toEqual({ valid: true });
  });

  test("normalizes itemized suggestions and filters duplicates against existing rows", () => {
    const writes = materialsAssistConfig.localAdapter(
      {
        responseType: "itemizedSuggestion",
        assumptionsSummary: "Draft rows based on a toilet replacement scope.",
        proposedLines: [
          { desc: "Toilet", qty: 3, priceEach: 295, unitCostInternal: 225, note: "ADA fixture" },
          { desc: "Wax Ring", qty: 3, priceEach: 8.5, unitCostInternal: 5.75 },
          { desc: "Wax Ring", qty: 3, priceEach: 8.5, unitCostInternal: 5.75 },
          { desc: "Supply Line", qty: 3, priceEach: 15, unitCostInternal: 9, unit: "each" },
        ],
      },
      createState()
    );

    expect(writes?.mode).toBe("itemized");
    expect(writes?.itemizedSuggestion?.proposedLines).toHaveLength(2);
    expect(writes?.itemizedSuggestion?.proposedLines[0]).toEqual(
      expect.objectContaining({
        desc: "Wax Ring",
        qty: "3",
        priceEach: "8.5",
        unitCostInternal: "5.75",
      })
    );
    expect(writes?.itemizedSuggestion?.proposedLines[1]).toEqual(
      expect.objectContaining({
        desc: "Supply Line",
        qty: "3",
        note: "Basis: each",
      })
    );
    expect(writes?.itemizedSuggestion?.duplicateWarnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Toilet"),
        expect.stringContaining("Wax Ring"),
      ])
    );
    expect(materialsAssistConfig.validationRules(writes)).toEqual({ valid: true });
  });
});
