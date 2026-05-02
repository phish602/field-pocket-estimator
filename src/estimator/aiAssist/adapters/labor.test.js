import { laborAssistConfig } from "./labor";

function createState(overrides = {}) {
  const base = {
    tradeInsert: {
      key: "painting",
      text: "Painting",
    },
    scopeNotes: "Paint two offices and touch up trim.",
    customer: {
      name: "Acme Facilities",
      projectName: "Office Refresh",
      projectAddress: "123 Main St",
    },
    job: {
      location: "Suite 200",
    },
    additionalNotes: "Night work after tenant hours.",
    labor: {
      hazardPct: 15,
      riskPct: 10,
      multiplier: 1.35,
      lines: [
        {
          id: "l1",
          role: "foreman",
          label: "Foreman",
          hours: "8",
          rate: "62",
          qty: "2",
          markupPct: "25",
          trueRateInternal: "38",
          internalRate: "38",
        },
        {
          id: "l2",
          role: "",
          label: "",
          hours: "",
          rate: "",
          qty: "1",
          markupPct: "",
          trueRateInternal: "",
          internalRate: "",
        },
      ],
    },
  };

  return {
    ...base,
    ...overrides,
    tradeInsert: {
      ...base.tradeInsert,
      ...(overrides.tradeInsert || {}),
    },
    customer: {
      ...base.customer,
      ...(overrides.customer || {}),
    },
    job: {
      ...base.job,
      ...(overrides.job || {}),
    },
    labor: {
      ...base.labor,
      ...(overrides.labor || {}),
    },
  };
}

describe("labor assist adapter", () => {
  test("builds a compact, serializable labor-only context from meaningful state", () => {
    const context = laborAssistConfig.contextBuilder(createState());

    expect(context).toEqual({
      tradeKey: "painting",
      tradeLabel: "Painting",
      scopeNotes: "Paint two offices and touch up trim.",
      customerName: "Acme Facilities",
      projectName: "Office Refresh",
      projectAddress: "123 Main St",
      additionalNotes: "Night work after tenant hours.",
      existingLaborLines: [
        "1. Foreman | 8 hrs | $62/hr | qty 2 | markup 25% | internal $38/hr",
      ],
      laborPricingHints: [
        "row markup 25%",
        "row bill rate $62/hr",
        "row internal $38/hr",
      ],
      laborConditions: {
        hazardPct: 15,
        riskPct: 10,
        multiplier: 1.35,
      },
    });

    expect(context).not.toHaveProperty("labor");
    expect(context).not.toHaveProperty("customer");
    expect(context).not.toHaveProperty("job");
    expect(context).not.toHaveProperty("materials");
    expect(context).not.toHaveProperty("ui");
    expect(context.existingLaborLines.every((line) => typeof line === "string")).toBe(true);
    expect(context.laborPricingHints.every((line) => typeof line === "string")).toBe(true);
    expect(() => JSON.stringify(context)).not.toThrow();
  });

  test("omits absent or non-meaningful labor context and tolerates malformed state", () => {
    const context = laborAssistConfig.contextBuilder({
      tradeInsert: null,
      scopeNotes: null,
      customer: "bad data",
      job: null,
      additionalNotes: undefined,
      labor: {
        hazardPct: 0,
        riskPct: "bad",
        multiplier: 1,
        lines: [
          null,
          "oops",
          { qty: 1, markupPct: "", role: "", label: "", hours: "", rate: "", trueRateInternal: "" },
        ],
      },
    });

    expect(context).toEqual({
      tradeKey: "",
      tradeLabel: "",
      scopeNotes: "",
      customerName: "",
      projectName: "",
      projectAddress: "",
      additionalNotes: "",
      existingLaborLines: [],
      laborPricingHints: [],
      laborConditions: {},
    });
    expect(() => JSON.stringify(context)).not.toThrow();
  });

  test("preserves optional qty and headcount as qty while keeping qty optional", () => {
    const writes = laborAssistConfig.localAdapter({
      lines: [
        { role: "Foreman", hours: 8, rate: 65, qty: 2 },
        { role: "Helper", hours: 6, rate: 40, headcount: 3 },
        { role: "Technician", hours: 4.5, rate: 85 },
      ],
    });

    expect(writes?.laborLines).toHaveLength(3);
    expect(writes?.laborLines?.[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^ai_/),
        role: "foreman",
        label: "Foreman",
        hours: "8",
        rate: "65",
        qty: "2",
        trueRateInternal: "",
        internalRate: "",
      })
    );
    expect(writes?.laborLines?.[1]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^ai_/),
        role: "helper",
        label: "Helper",
        hours: "6",
        rate: "40",
        qty: "3",
      })
    );
    expect(writes?.laborLines?.[2]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^ai_/),
        role: "technician",
        label: "Technician",
        hours: "4.5",
        rate: "85",
      })
    );
    expect(writes?.laborLines?.[2]).not.toHaveProperty("qty");
    expect(laborAssistConfig.validationRules(writes)).toEqual({ valid: true });
  });

  test("rejects empty or malformed generated rows through existing validation behavior", () => {
    const writes = laborAssistConfig.localAdapter({
      lines: [
        { role: "Foreman", hours: 0, rate: 65 },
        { role: "", hours: 8, rate: 40 },
      ],
    });

    expect(writes).toBeNull();
    expect(laborAssistConfig.validationRules(writes)).toEqual({
      valid: false,
      error: "No labor lines were generated.",
    });
    expect(
      laborAssistConfig.validationRules({
        laborLines: [{ label: "Foreman", hours: "", rate: "65" }],
      })
    ).toEqual({
      valid: false,
      error: "Some lines are missing role, hours, or rate.",
    });
  });
});