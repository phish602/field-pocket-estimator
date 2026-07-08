import { buildGuidedAudit } from "./registry";
import { applyGuidedWrites } from "./writeback";

function createBaseState() {
  return {
    ui: {
      docType: "estimate",
      materialsMode: "blanket",
    },
    customer: {
      id: "",
      name: "",
      projectSameAsCustomer: true,
      projectName: "",
      projectNumber: "",
      projectAddress: "",
      city: "",
      state: "",
      zip: "",
    },
    job: {
      date: "2026-03-12",
      due: "",
      poNumber: "",
      location: "",
      docNumber: "",
    },
    scopeNotes: "",
    tradeInsert: { key: "", text: "" },
    labor: {
      multiplier: 1,
      hazardPct: 0,
      riskPct: 0,
      lines: [{ id: "l1", role: "", label: "", qty: 1, hours: "", rate: "", markupPct: "0", trueRateInternal: "" }],
    },
    materials: {
      blanketCost: "",
      blanketInternalCost: "",
      materialsBlanketDescription: "",
      markupPct: "0",
      items: [{ id: "m1", desc: "", qty: "", priceEach: "", unitCostInternal: "" }],
    },
    additionalNotes: "",
  };
}

describe("guided writeback", () => {
  test("maps a guided customer write to a saved customer selection", () => {
    const state = createBaseState();
    const customers = [
      {
        id: "cust-1",
        type: "commercial",
        companyName: "Acme Facilities",
        contactName: "Sam Lead",
        comPhone: "602-555-0101",
        comEmail: "sam@acme.test",
        jobsite: { street: "123 Main St", city: "Phoenix", state: "AZ", zip: "85001" },
        billing: { street: "123 Main St", city: "Phoenix", state: "AZ", zip: "85001" },
      },
    ];

    const result = applyGuidedWrites({
      state,
      writes: {
        extractedFieldValues: [{ key: "customer.id", value: "Acme Facilities", source: "user_input", confidence: 0.95 }],
      },
      context: {
        customers,
      },
    });

    expect(result.blocked).toHaveLength(0);
    expect(result.confirmations).toHaveLength(0);
    expect(result.applied).toEqual([
      expect.objectContaining({ kind: "selectCustomer", customerId: "cust-1", fieldKey: "customer.id" }),
    ]);
  });

  test("requires confirmation before switching materials branches when itemized data already exists", () => {
    const state = createBaseState();
    state.ui.materialsMode = "itemized";
    state.materials.items = [
      { id: "m1", desc: "Paint", qty: "10", priceEach: "45", unitCostInternal: "30" },
    ];

    const result = applyGuidedWrites({
      state,
      writes: {
        extractedFieldValues: [{ key: "ui.materialsMode", value: "blanket", source: "ai", confidence: 0.94 }],
      },
      context: {},
    });

    expect(result.applied).toHaveLength(0);
    expect(result.confirmations).toHaveLength(1);
    expect(result.confirmations[0]).toEqual(
      expect.objectContaining({
        fieldKey: "ui.materialsMode",
      })
    );
  });
});

describe("guided audit", () => {
  test("marks high-confidence AI writes as inferred while keeping required coverage satisfied", () => {
    const state = createBaseState();
    state.customer.id = "cust-1";
    state.customer.name = "Acme Facilities";
    state.scopeNotes = "Paint and patch the lobby walls and ceilings.";
    state.labor.lines = [
      { id: "l1", role: "journeyman", label: "Journeyman", qty: "2", hours: "8", rate: "65", markupPct: "10", trueRateInternal: "40" },
    ];
    state.materials.blanketCost = "1200";

    const audit = buildGuidedAudit({
      mode: "estimate",
      state,
      guidedMeta: {
        scopeNotes: { source: "ai", confidence: 0.88, confirmed: false, pendingConfirmation: false },
      },
      context: {
        selectedCustomer: null,
      },
    });

    const scopeEntry = audit.fields.find((entry) => entry.key === "scopeNotes");
    expect(scopeEntry?.status).toBe("inferred");
    expect(audit.counts.missing).toBe(0);
  });
});
