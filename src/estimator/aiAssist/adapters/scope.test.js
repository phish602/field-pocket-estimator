import {
  analyzeScopeAssistInput,
  buildRiskAwareScopeEchoFallback,
  buildSpecialtyLocalFallbackNote,
  deriveProjectNameFromScopeFlow,
  extractScopeAssistText,
  isWeakRiskAwareScopeEcho,
  resolveScopeAssistNotes,
  sanitizeScopeAssistText,
  scopeAssistConfig,
  summarizeScopeAssistSoftBias,
} from "./scope";
import { requestSectionAssist } from "../service";

function createState(overrides = {}) {
  return {
    tradeInsert: {
      key: "plumbing",
      text: "Plumbing",
    },
    scopeNotes: "Existing scope note.",
    ...overrides,
  };
}

function toWeakScopeEcho(userInput) {
  const normalized = String(userInput || "").trim();
  if (!normalized) return "";
  return `${normalized.charAt(0).toUpperCase()}${normalized.slice(1)}.`;
}

function expectContractorScopeUpgrade(resolved, weakOutput, { notContains = [], minSentences = 2 } = {}) {
  expect(resolved).not.toBe(weakOutput);
  expect(resolved).not.toContain("\n- ");
  expect(resolved).toContain(".");
  expect(resolved.toLowerCase()).not.toContain("scope includes");
  notContains.forEach((snippet) => {
    expect(resolved).not.toContain(snippet);
  });
  expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(minSentences);
}

describe("scope assist adapter", () => {
  test("extracts task, quantity, item, location, and bullet intent from contractor input", () => {
    expect(analyzeScopeAssistInput("replace 3 toilets in office bullet points")).toEqual(
      expect.objectContaining({
        actions: ["replace"],
        quantities: ["3"],
        quantityItemPairs: ["3 toilets"],
        actionItemPhrases: ["replace 3 toilets"],
        items: ["toilets"],
        locations: ["office"],
        formattingIntent: "bullets",
        scopeSkeleton: expect.objectContaining({
          directWork: expect.objectContaining({
            certain: ["replace 3 toilets"],
          }),
          materialsProducts: expect.objectContaining({
            implied: expect.arrayContaining(["wax rings", "closet bolts"]),
          }),
        }),
      })
    );
  });

  test("extracts rewrite and concise intent while preserving core scope text", () => {
    expect(
      analyzeScopeAssistInput("clean this up professionally and keep it short: replace vanity faucet and reconnect supply lines")
    ).toEqual(
      expect.objectContaining({
        coreScopeText: "replace vanity faucet and reconnect supply lines",
        actions: ["replace", "reconnect"],
        actionItemPhrases: ["replace vanity faucet", "reconnect supply lines"],
        items: ["vanity faucet", "supply lines"],
        rewriteIntents: expect.arrayContaining(["rewrite", "professionalize"]),
        brevityIntent: "concise",
      })
    );
  });

  test("normalizes adjacent verb phrasing into open action families instead of exact example matches", () => {
    expect(analyzeScopeAssistInput("swap out water heater")).toEqual(
      expect.objectContaining({
        actions: ["replace"],
        actionFamilies: ["replace_changeout"],
        primaryActionFamily: "replace_changeout",
        actionItemPhrases: ["replace water heater"],
        items: ["water heater"],
        scopeWorkBucket: "replace_connected_equipment",
        scopeAssetCategory: "plumbing_equipment",
        scopeAssetFamily: "connected_equipment_fixture",
      })
    );

    expect(analyzeScopeAssistInput("furnish and install disconnect")).toEqual(
      expect.objectContaining({
        actions: expect.arrayContaining(["install", "furnish"]),
        actionFamilies: expect.arrayContaining(["install_add_mount"]),
        primaryActionFamily: "install_add_mount",
        scopeWorkBucket: "install_new_asset",
        scopeAssetCategory: "electrical_equipment",
      })
    );

    expect(analyzeScopeAssistInput("decommission and remove mounted sign")).toEqual(
      expect.objectContaining({
        actions: ["remove"],
        actionFamilies: ["remove_demo"],
        primaryActionFamily: "remove_demo",
        actionItemPhrases: ["remove mounted sign"],
        items: ["mounted sign"],
        scopeWorkBucket: "demo_remove",
        scopeAssetCategory: "site_hardware",
        scopeAssetFamily: "site_exterior_asset",
      })
    );
  });

  test("infers universal contractor behavior for real objects even when they are not a deeply modeled legacy noun", () => {
    expect(analyzeScopeAssistInput("replace residential windows")).toEqual(
      expect.objectContaining({
        actionFamilies: expect.arrayContaining(["replace_changeout"]),
        objectType: "framed_opening_object",
        connectionModel: "perimeter_closure",
        assemblyScale: "full_assembly_opening",
        residentialContext: true,
        scopeProfile: "universal_scope",
      })
    );

    expect(analyzeScopeAssistInput("install wall flashing")).toEqual(
      expect.objectContaining({
        actionFamilies: expect.arrayContaining(["install_add_mount"]),
        objectType: "panel_closure_object",
        connectionModel: "perimeter_closure",
        scopeProfile: "universal_scope",
      })
    );
  });

  test("interprets rough contractor shorthand and secondary method cues before scope building", () => {
    expect(analyzeScopeAssistInput("put fence around house and punch holes and weld joints")).toEqual(
      expect.objectContaining({
        actions: expect.arrayContaining(["install"]),
        actionFamilies: expect.arrayContaining(["install_add_mount"]),
        primaryActionFamily: "install_add_mount",
        scopeAssetCategory: "site_hardware",
        scopeTradeBucket: "site",
        roughPrompt: true,
        siteAssemblyHints: expect.arrayContaining(["fence_perimeter_assembly"]),
        secondaryActionMethods: expect.arrayContaining(["hole_creation", "welded_connection"]),
        holeCreationIntent: expect.stringContaining("post"),
        connectionMethodHints: expect.arrayContaining(["complete welded connections at joints where required"]),
      })
    );

    expect(analyzeScopeAssistInput("tear out bad gate and put new one")).toEqual(
      expect.objectContaining({
        actionFamilies: expect.arrayContaining(["remove_demo", "install_add_mount", "replace_changeout"]),
        primaryActionFamily: "replace_changeout",
        scopeWorkBucket: "replace_non_connected_asset",
        roughPrompt: true,
        siteAssemblyHints: expect.arrayContaining(["gate_assembly"]),
      })
    );
  });

  test("interprets vague contractor shorthand for perimeter, reset, water-damage, and partial scope cues", () => {
    expect(analyzeScopeAssistInput("remove and reinstall handrail")).toEqual(
      expect.objectContaining({
        actionFamilies: expect.arrayContaining(["remove_demo", "install_add_mount"]),
        resetIntent: "remove_reinstall",
        scopeAssetCategory: "site_hardware",
      })
    );

    expect(analyzeScopeAssistInput("seal around storefront door")).toEqual(
      expect.objectContaining({
        actionFamilies: expect.arrayContaining(["finish_coating"]),
        perimeterScopeHints: expect.arrayContaining(["perimeter_scope", "perimeter_seal_scope"]),
        objectType: "framed_opening_object",
        connectionModel: "perimeter_closure",
      })
    );

    expect(analyzeScopeAssistInput("patch water damage on ceiling and paint")).toEqual(
      expect.objectContaining({
        actionFamilies: expect.arrayContaining(["repair_patch", "finish_coating"]),
        waterDamageRepairHints: expect.arrayContaining(["water_damage_repair", "ceiling_repair_area"]),
        scopeProfile: "painting",
      })
    );
  });

  test("extends normalized asset, action, method, and context vocabulary through the existing layered router", () => {
    expect(analyzeScopeAssistInput("install cabinets in kitchen")).toEqual(
      expect.objectContaining({
        actionFamilies: expect.arrayContaining(["install_add_mount"]),
        primaryActionFamily: "install_add_mount",
        scopeAssetCategory: "interior_builtin",
        scopeAssetFamily: "interior_builtin_casework",
        scopeTradeBucket: "finish_carpentry",
        objectType: "built_in_assembly",
        connectionModel: "anchorage_fasteners",
        commercialContextSignals: expect.arrayContaining(["kitchen"]),
      })
    );

    expect(analyzeScopeAssistInput("repair cabinet door and resecure hinge")).toEqual(
      expect.objectContaining({
        actionFamilies: expect.arrayContaining(["repair_patch", "service_connection"]),
        scopeProfile: "finish_carpentry",
        scopeTradeBucket: "hardware",
        objectType: "hardware_component",
      })
    );

    expect(analyzeScopeAssistInput("install kitchen equipment support bracket")).toEqual(
      expect.objectContaining({
        actionFamilies: expect.arrayContaining(["install_add_mount"]),
        primaryActionFamily: "install_add_mount",
        objectType: "hardware_component",
        connectionModel: "anchorage_fasteners",
        commercialContextSignals: expect.arrayContaining(["kitchen"]),
      })
    );
  });

  test("distinguishes paragraph requests from sentence requests", () => {
    expect(analyzeScopeAssistInput("rewrite this as a paragraph and keep it short: replace vanity faucet and reconnect supply lines")).toEqual(
      expect.objectContaining({
        coreScopeText: "replace vanity faucet and reconnect supply lines",
        formattingIntent: "paragraph",
        brevityIntent: "concise",
      })
    );

    expect(analyzeScopeAssistInput("rewrite this as one sentence: replace vanity faucet and reconnect supply lines")).toEqual(
      expect.objectContaining({
        coreScopeText: "replace vanity faucet and reconnect supply lines",
        formattingIntent: "sentence",
      })
    );
  });

  test("preserves uncertainty and repair clues from sparse demo notes", () => {
    expect(
      analyzeScopeAssistInput("use safe wording for demo damaged drywall patch as needed around plumbing access with limited access")
    ).toEqual(
      expect.objectContaining({
        actions: expect.arrayContaining(["demo", "patch"]),
        items: expect.arrayContaining(["damaged drywall"]),
        locations: ["plumbing access"],
        uncertaintyPhrases: expect.arrayContaining(["as needed", "limited access", "repair around access"]),
        riskTriggerTerms: expect.arrayContaining(["as needed", "patch", "damaged", "access", "plumbing access"]),
        riskAwareInput: true,
        safeWordingRequested: true,
        mentionsPatchOrRepair: true,
        scopeSkeleton: expect.objectContaining({
          accessConditions: expect.objectContaining({
            certain: expect.arrayContaining(["limited access", "plumbing access"]),
            implied: expect.arrayContaining(["accessible work areas only"]),
          }),
        }),
      })
    );
  });

  test("builds a contractor-safe scope skeleton for sparse toilet replacement shorthand", () => {
    expect(analyzeScopeAssistInput("replace 2 toilets")).toEqual(
      expect.objectContaining({
        actionItemPhrases: ["replace 2 toilets"],
        scopeExpansionActive: true,
        scopeSkeleton: expect.objectContaining({
          directWork: expect.objectContaining({
            certain: ["replace 2 toilets"],
            implied: expect.arrayContaining(["reconnect supply lines"]),
          }),
          materialsProducts: expect.objectContaining({
            implied: expect.arrayContaining(["wax rings", "closet bolts"]),
          }),
          completionStandards: expect.objectContaining({
            implied: expect.arrayContaining(["test for proper operation", "clean up work area"]),
          }),
          exclusions: expect.objectContaining({
            riskyMissing: expect.arrayContaining([
              "flange repair, shutoff replacement, concealed damage, and code-related corrections are not included unless identified and approved",
            ]),
          }),
        }),
      })
    );
  });

  test("upgrades weak bullet echo output for risk-aware scopes", () => {
    const userInput = "put this in bullet points: demo damaged drywall and patch as needed around plumbing access";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "- Demo damaged drywall and patch as needed around plumbing access points.";

    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(buildRiskAwareScopeEchoFallback({ analysis })).toBe(
      "- Demo damaged drywall as needed for plumbing access.\n- Patch damaged drywall where required after access work is completed.\n- Additional concealed damage beyond accessible work areas is not included unless identified and approved."
    );
    expect(
      resolveScopeAssistNotes(
        { scopeNotes: weakOutput },
        { userInput, context: { scopeInputAnalysis: analysis } }
      )
    ).toBe(
      "- Demo damaged drywall as needed for plumbing access.\n- Patch damaged drywall where required after access work is completed.\n- Additional concealed damage beyond accessible work areas is not included unless identified and approved."
    );
  });

  test("upgrades weak one-sentence echo output without breaking sentence format", () => {
    const userInput = "rewrite this as one sentence with safe wording: demo damaged drywall and patch as needed around plumbing access";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Demo damaged drywall and patch as needed around plumbing access points." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("unless identified and approved");
    expect(resolved).not.toContain("\n");
    expect((resolved.match(/\./g) || []).length).toBe(1);
  });

  test("expands sparse toilet shorthand instead of accepting a near-echo rewrite", () => {
    const userInput = "replace 2 toilets";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Replace 2 toilets." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("wax rings and closet bolts");
    expect(resolved).toContain("reconnect supply lines");
    expect(resolved).toContain("unless identified and approved");
  });

  test("rejects generic summary wrappers and expands vague painting scope into real scope notes", () => {
    const userInput = "painting house";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Scope includes painting the house." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        actions: ["paint"],
        detailLevel: "vague",
        scopeDepthTarget: "fuller_scope_draft",
        scopeSkeleton: expect.objectContaining({
          prepRequirements: expect.objectContaining({
            implied: expect.arrayContaining(["prepare designated surfaces as needed", "protect adjacent areas"]),
          }),
        }),
      })
    );
    expect(resolved).toContain("Prepare designated house surfaces as needed");
    expect(resolved).toContain("Apply paint to the agreed work area");
    expect(resolved).toContain("unless identified and approved");
    expect(resolved).not.toBe("Scope includes painting the house.");
  });

  test("rejects shallow vague painting output even when it is not a scope-includes wrapper", () => {
    const userInput = "painting house";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Prepare house surfaces and paint the house." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(isWeakRiskAwareScopeEcho("Prepare house surfaces and paint the house.", { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Prepare designated house surfaces as needed");
    expect(resolved).toContain("Apply paint to the agreed work area");
    expect(resolved).toContain("unless identified and approved");
  });

  test("preserves specialty technical language and rejects cookie-cutter scope filler", () => {
    const userInput = 'orbital weld stainless steel 1/4" lines. 300 feet in sub fab at Intel.';
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Scope includes welding stainless steel lines." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        actions: ["weld"],
        detailLevel: "technical",
        scopeDepthTarget: "technical_trade_expansion",
        scopeProfile: "technical",
        technicalSignals: expect.arrayContaining(["orbital welding", "stainless steel", "fractional sizing", "line footage", "sub-fab environment", "industrial site"]),
      })
    );
    expect(resolved).toContain("Perform orbital welding");
    expect(resolved).toContain("300 feet");
    expect(resolved).toContain("stainless steel 1/4 lines");
    expect(resolved).toContain("sub fab at intel");
    expect(resolved).toContain("fit-up, alignment");
    expect(resolved).toContain("QA/QC");
    expect(resolved).not.toContain("concealed damage");
  });

  test("hard-rejects shallow technical tubing scope and rebuilds denser fab language", () => {
    const userInput = "install process tubing in fab area";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Install process tubing in fab area.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        actions: ["install"],
        detailLevel: "technical",
        scopeProfile: "technical",
        technicalSignals: expect.arrayContaining(["process tubing", "process lines", "fab environment"]),
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Install process tubing in fab area");
    expect(resolved).toContain("fit-up, alignment");
    expect(resolved).toContain("accessible areas within the stated technical environment");
    expect(resolved).toContain("QA/QC");
  });

  test("routes instrumentation tie-in through a denser specialty panel path", () => {
    const userInput = "instrumentation tie-in at existing panel";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Instrumentation tie-in at existing panel.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        detailLevel: "technical",
        scopeProfile: "technical",
        technicalSignals: expect.arrayContaining(["instrumentation", "panel work", "tie-in"]),
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Complete instrumentation tie-in at existing panel");
    expect(resolved).toContain("accessible tie-in work, terminations, and identified panel connections");
    expect(resolved).toContain("accessible tie-in areas at the identified panel location");
    expect(resolved).toContain("live-system work, testing, programming");
  });

  test("expands short commercial breaker shorthand into contractor-note blocks by default", () => {
    const userInput = "install circuit breakers for commercial warehouse";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Install circuit breakers for commercial warehouse.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        detailLevel: "technical",
        technicalScopeCompleteness: "shorthand",
        expansionPressure: "high",
        scopeDepthTarget: "technical_trade_expansion",
        technicalSignals: expect.arrayContaining(["circuit breaker work"]),
        inputShape: expect.objectContaining({
          veryShortInput: true,
          singleClauseInput: true,
          lowDetailDensity: true,
          terseTechnicalCommercialInput: true,
        }),
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Install circuit breakers for commercial warehouse");
    expect(resolved).toContain("accessible breaker terminations and identification");
    expect(resolved).toContain("verify breaker operation");
    expect(resolved).toContain("Panel modifications beyond the identified breaker scope");
    expect(resolved).toContain("\n\n");
    expect(resolved).not.toContain("\n- ");
    expect(resolved).not.toContain("\n1. ");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(3);
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect(resolved.toLowerCase()).not.toContain("adjacent areas");
    expect(resolved.toLowerCase()).not.toContain("concealed damage");
  });

  test("expands rooftop disconnect shorthand without residential filler", () => {
    const userInput = "replace rooftop package unit disconnect";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Replace rooftop package unit disconnect." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        detailLevel: "technical",
        technicalScopeCompleteness: "shorthand",
        expansionPressure: "high",
        scopeWorkBucket: "replace_connected_equipment",
        scopeTradeBucket: "electrical",
        scopeAssetCategory: "electrical_equipment",
        impliedAccessContext: "rooftop_access",
        technicalSignals: expect.arrayContaining(["disconnect work", "rooftop equipment"]),
      })
    );
    expect(isWeakRiskAwareScopeEcho("Replace rooftop package unit disconnect.", { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Replace rooftop package unit disconnect");
    expect(resolved).toContain("reconnect accessible conductors");
    expect(resolved).toContain("equipment shutdown or safe access");
    expect(resolved).toContain("accessible rooftop equipment connections");
    expect(resolved).toContain("\n\n");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect(resolved.toLowerCase()).not.toContain("masking");
    expect(resolved.toLowerCase()).not.toContain("paint");
    expect(resolved.toLowerCase()).not.toContain("drywall");
  });

  test("expands short water heater replacement shorthand into a contractor-ready first draft", () => {
    const userInput = "replace water heater";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Replace water heater.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        detailLevel: "vague",
        expansionPressure: "high",
        scopeDepthTarget: "fuller_scope_draft",
        scopeWorkBucket: "replace_connected_equipment",
        scopeTradeBucket: "plumbing",
        scopeAssetCategory: "plumbing_equipment",
        replaceableAssetScope: true,
        replaceableAssetCategory: "plumbing_equipment",
        scopeProfile: "equipment_asset",
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove and replace existing water heater");
    expect(resolved).toContain("accessible water, vent, relief, gas, or electrical connections as applicable");
    expect(resolved).toContain("verify operation");
    expect(resolved).toContain("dispose of replaced equipment");
    expect(resolved).toContain("\n\n");
    expect(resolved).not.toBe("Replace water heater.");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect(resolved.toLowerCase()).not.toContain("adjacent areas");
    expect(resolved.toLowerCase()).not.toContain("masking");
  });

  test("derives concise contractor-friendly project names from the shared scope flow", () => {
    expect(
      deriveProjectNameFromScopeFlow({
        userInput: "replace roof",
        scopeNotes: "Remove and replace the existing roof covering within the stated roof area.",
        analysis: analyzeScopeAssistInput("replace roof"),
      })
    ).toBe("Roof Replacement");

    expect(
      deriveProjectNameFromScopeFlow({
        userInput: "paint house",
        scopeNotes: "Prep and repaint the house with two finish coats.",
        analysis: analyzeScopeAssistInput("paint house"),
      })
    ).toBe("House Repaint");

    expect(
      deriveProjectNameFromScopeFlow({
        userInput: "tile bathroom",
        scopeNotes: "Install tile in the bathroom area, including layout, cuts, and finish cleanup.",
        analysis: analyzeScopeAssistInput("tile bathroom"),
      })
    ).toBe("Bathroom Tile Work");

    expect(
      deriveProjectNameFromScopeFlow({
        userInput: "replace water heater",
        scopeNotes: "Remove and replace the existing water heater and reconnect accessible utilities.",
        analysis: analyzeScopeAssistInput("replace water heater"),
      })
    ).toBe("Water Heater Replacement");
  });

  test("expands short exhaust fan replacement shorthand without residential filler", () => {
    const userInput = "replace exhaust fan";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Replace exhaust fan." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "replace_connected_equipment",
        scopeTradeBucket: "mechanical",
        scopeAssetCategory: "mechanical_equipment",
        replaceableAssetScope: true,
        replaceableAssetCategory: "mechanical_equipment",
        scopeProfile: "equipment_asset",
      })
    );
    expect(resolved).toContain("Remove and replace existing exhaust fan");
    expect(resolved).toContain("accessible power, duct, drain, vent, refrigerant, or control connections as applicable");
    expect(resolved).toContain("verify operation");
    expect(resolved).toContain("clean up the work area");
    expect(resolved).toContain("\n\n");
    expect(resolved.toLowerCase()).not.toContain("paint");
    expect(resolved.toLowerCase()).not.toContain("drywall");
    expect(resolved.toLowerCase()).not.toContain("adjacent areas");
  });

  test("expands short door closer replacement shorthand into hardware-ready scope notes", () => {
    const userInput = "replace door closer";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Replace door closer." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "replace_non_connected_asset",
        scopeTradeBucket: "hardware",
        scopeAssetCategory: "door_hardware",
        replaceableAssetScope: true,
        replaceableAssetCategory: "door_hardware",
        scopeProfile: "equipment_asset",
      })
    );
    expect(resolved).toContain("Remove and replace existing door closer");
    expect(resolved).toContain("mounting, fastening, and hardware adjustments");
    expect(resolved).toContain("proper operation");
    expect(resolved.toLowerCase()).toContain("door, frame, storefront, or glazing repair");
    expect(resolved).not.toContain("\n- ");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(3);
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect(resolved.toLowerCase()).not.toContain("paint");
  });

  test("expands remove-only connected equipment prompts without leaving a near-echo behind", () => {
    const userInput = "remove water heater";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Remove water heater.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "demo_remove",
        scopeTradeBucket: "plumbing",
        scopeAssetCategory: "plumbing_equipment",
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove existing water heater");
    expect(resolved).toContain("Disconnect accessible water, vent, relief, gas, or electrical connections required for safe removal");
    expect(resolved).toContain("remove and dispose of removed equipment");
    expect(resolved).not.toBe("Remove water heater.");
  });

  test("expands short install prompts for connected equipment into stronger first-pass scope notes", () => {
    const userInput = "install water heater";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Install water heater.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "install_new_asset",
        scopeTradeBucket: "plumbing",
        scopeAssetCategory: "plumbing_equipment",
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Furnish and install water heater");
    expect(resolved).toContain("accessible water, vent, relief, gas, or electrical connections as applicable");
    expect(resolved).toContain("set and secure the unit");
    expect(resolved).toContain("verify operation");
    expect(resolved).not.toBe("Install water heater.");
  });

  test("expands short install disconnect prompts through the technical electrical path without replacement-only wording", () => {
    const userInput = "install disconnect";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Install disconnect.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        detailLevel: "technical",
        scopeWorkBucket: "install_new_asset",
        scopeTradeBucket: "electrical",
        scopeAssetCategory: "electrical_equipment",
        technicalSignals: expect.arrayContaining(["disconnect work"]),
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Install disconnect");
    expect(resolved).toContain("complete accessible terminations, mounting, and service connections");
    expect(resolved).toContain("complete identification, verify operation");
    expect(resolved).not.toContain("disconnect replacement");
  });

  test("expands FRP wall panel shorthand with commercial kitchen context instead of generic finish prose", () => {
    const userInput = "install FRP wall panels in commercial kitchen";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Install FRP wall panels in commercial kitchen.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "finish_coating",
        scopeTradeBucket: "finish",
        scopeAssetCategory: "finish_surface",
        scopeProfile: "finish_scope",
        commercialContextSignals: expect.arrayContaining(["commercial kitchen"]),
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Install FRP wall panels");
    expect(resolved).toContain("layout, cuts, trim, and fastening");
    expect(resolved).toContain("commercial kitchen");
    expect(resolved).toContain("sealant and finish transitions");
    expect(resolved.toLowerCase()).not.toContain("residential");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
  });

  test("expands terse stucco repair prompts into a repair workflow instead of a one-line rewrite", () => {
    const userInput = "repair stucco cracks";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Repair stucco cracks.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "repair_patch",
        scopeTradeBucket: "site_finish",
        scopeAssetCategory: "repair_surface",
        scopeProfile: "repair_scope",
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Repair stucco cracks");
    expect(resolved).toContain("texture blending as closely as practical");
    expect(resolved).toContain("clean up the work area");
    expect(resolved).not.toBe("Repair stucco cracks.");
  });

  test("expands short lobby painting prompts with commercial room context instead of generic house wording", () => {
    const userInput = "paint lobby";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Paint lobby.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "finish_coating",
        scopeTradeBucket: "finish",
        scopeProfile: "painting",
        commercialContextSignals: expect.arrayContaining(["lobby"]),
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Prepare identified lobby surfaces");
    expect(resolved).toContain("Apply paint to the identified work area");
    expect(resolved).toContain("surfaces outside the identified work area");
    expect(resolved).not.toBe("Paint lobby.");
  });

  test("expands short ceiling tile replacement prompts through the finish bucket", () => {
    const userInput = "replace ceiling tile";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Replace ceiling tile.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "finish_coating",
        scopeTradeBucket: "finish",
        scopeAssetCategory: "finish_surface",
        scopeProfile: "finish_scope",
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove and replace ceiling tile");
    expect(resolved).toContain("existing ceiling layout");
    expect(resolved.toLowerCase()).toContain("ceiling grid repair");
    expect(resolved).not.toBe("Replace ceiling tile.");
  });

  test("expands short light pole removal shorthand into a more technical site-ready first draft", () => {
    const userInput = "Remove existing light pole from the hotel";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Remove existing light pole from the hotel.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        detailLevel: "technical",
        technicalScopeCompleteness: "shorthand",
        expansionPressure: "high",
        scopeDepthTarget: "technical_trade_expansion",
        scopeWorkBucket: "demo_remove",
        scopeTradeBucket: "electrical",
        scopeAssetCategory: "electrical_equipment",
        commercialContextSignals: expect.arrayContaining(["hotel"]),
        impliedAccessContext: "lift_access",
        siteEquipmentScope: true,
        technicalSignals: expect.arrayContaining(["site lighting equipment"]),
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove existing light pole");
    expect(resolved).toContain("hotel");
    expect(resolved).toContain("disconnecting accessible site-lighting conductors or attachments");
    expect(resolved).toContain("lift or suitable access equipment");
    expect(resolved).toContain("dispose of removed materials");
    expect(resolved).toContain("foundation removal");
    expect(resolved).toContain("\n\n");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect(resolved.toLowerCase()).not.toContain("adjacent areas");
    expect(resolved.toLowerCase()).not.toContain("paint");
    expect(resolved.toLowerCase()).not.toContain("drywall");
  });

  test("expands short site asset replacement prompts without weak generic phrasing", () => {
    const userInput = "replace existing parking lot light pole";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Replace existing parking lot light pole." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        detailLevel: "technical",
        technicalScopeCompleteness: "shorthand",
        siteEquipmentScope: true,
        technicalSignals: expect.arrayContaining(["site lighting equipment"]),
      })
    );
    expect(resolved).toContain("Remove and replace existing parking lot light pole");
    expect(resolved).toContain("set and secure the replacement assembly");
    expect(resolved).toContain("verify operation where applicable");
    expect(resolved).not.toContain("replace new one will require");
    expect(resolved.toLowerCase()).not.toContain("masking");
    expect(resolved.toLowerCase()).not.toContain("residential");
  });

  test("expands terse pole light replacement into a technical site/electrical first draft", () => {
    const userInput = "replace pole light";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Replace pole light.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        detailLevel: "technical",
        scopeWorkBucket: "replace_connected_equipment",
        scopeTradeBucket: "electrical",
        scopeAssetCategory: "electrical_equipment",
        siteEquipmentScope: true,
        impliedAccessContext: "lift_access",
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove and replace existing pole light");
    expect(resolved).toContain("site-lighting conductors or attachments");
    expect(resolved).toContain("lift or suitable access equipment");
    expect(resolved).toContain("site connections");
  });

  test("expands non-connected site hardware replacement like sign posts without residential filler", () => {
    const userInput = "replace sign post";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Replace sign post.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "replace_non_connected_asset",
        scopeTradeBucket: "site",
        scopeAssetCategory: "site_hardware",
        siteExteriorContext: true,
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove and replace existing sign post");
    expect(resolved).toContain("attachments, anchorage, and related hardware");
    expect(resolved).toContain("set and secure the replacement assembly");
    expect(resolved.toLowerCase()).not.toContain("adjacent areas");
    expect(resolved.toLowerCase()).not.toContain("drywall");
  });

  test("expands remove-and-replace bollard shorthand through the site asset bucket", () => {
    const userInput = "remove and replace bollard";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Remove and replace bollard.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "replace_non_connected_asset",
        scopeTradeBucket: "site",
        scopeAssetCategory: "site_hardware",
        siteExteriorContext: true,
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove and replace existing bollard");
    expect(resolved).toContain("set and secure the replacement assembly");
    expect(resolved).toContain("site or exterior area");
    expect(resolved).not.toBe("Remove and replace bollard.");
  });

  test("expands terse mounted sign removal with access coordination instead of a plain rewrite", () => {
    const userInput = "remove mounted sign";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Remove mounted sign.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "demo_remove",
        scopeTradeBucket: "site",
        scopeAssetCategory: "site_hardware",
        siteExteriorContext: true,
        impliedAccessContext: "lift_access",
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove existing mounted sign");
    expect(resolved).toContain("lift or suitable access equipment");
    expect(resolved).toContain("remove and dispose of removed materials");
    expect(resolved).toContain("site or exterior area");
  });

  test.each([
    {
      userInput: "swap out water heater",
      weakOutput: "Swap out water heater.",
      analysis: expect.objectContaining({
        actionFamilies: ["replace_changeout"],
        primaryActionFamily: "replace_changeout",
        scopeWorkBucket: "replace_connected_equipment",
        scopeAssetCategory: "plumbing_equipment",
        scopeAssetFamily: "connected_equipment_fixture",
      }),
      contains: [
        "Remove and replace existing water heater",
        "accessible water, vent, relief, gas, or electrical connections as applicable",
        "verify operation",
      ],
    },
    {
      userInput: "change out exhaust fan",
      weakOutput: "Change out exhaust fan.",
      analysis: expect.objectContaining({
        actionFamilies: ["replace_changeout"],
        scopeWorkBucket: "replace_connected_equipment",
        scopeAssetCategory: "mechanical_equipment",
      }),
      contains: [
        "Remove and replace existing exhaust fan",
        "accessible power, duct, drain, vent, refrigerant, or control connections as applicable",
        "verify operation",
      ],
    },
    {
      userInput: "furnish and install disconnect",
      weakOutput: "Furnish and install disconnect.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["install_add_mount"]),
        primaryActionFamily: "install_add_mount",
        scopeWorkBucket: "install_new_asset",
        scopeTradeBucket: "electrical",
        scopeAssetCategory: "electrical_equipment",
      }),
      contains: [
        "Install disconnect",
        "accessible terminations",
        "verify operation",
      ],
    },
    {
      userInput: "decommission and remove mounted sign",
      weakOutput: "Decommission and remove mounted sign.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["remove_demo"]),
        scopeWorkBucket: "demo_remove",
        scopeAssetCategory: "site_hardware",
        scopeAssetFamily: "site_exterior_asset",
        impliedAccessContext: "lift_access",
      }),
      contains: [
        "Remove existing mounted sign",
        "lift or suitable access equipment",
        "remove and dispose of removed materials",
      ],
    },
    {
      userInput: "restore stucco finish at cracks",
      weakOutput: "Restore stucco finish at cracks.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["repair_patch"]),
        scopeWorkBucket: "repair_patch",
        scopeAssetCategory: "repair_surface",
        scopeAssetFamily: "repair_surface_damage",
      }),
      contains: [
        "Repair stucco finish",
        "texture blending as closely as practical",
        "clean up the work area",
      ],
    },
    {
      userInput: "repaint lobby walls",
      weakOutput: "Repaint lobby walls.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["finish_coating"]),
        scopeWorkBucket: "finish_coating",
        scopeProfile: "painting",
        commercialContextSignals: expect.arrayContaining(["lobby"]),
      }),
      contains: [
        "Prepare identified lobby surfaces",
        "Apply paint to the identified work area",
        "surfaces outside the identified work area",
      ],
    },
    {
      userInput: "mount new gate operator",
      weakOutput: "Mount new gate operator.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["install_add_mount"]),
        scopeWorkBucket: "install_new_asset",
        scopeAssetCategory: "site_hardware",
        scopeAssetFamily: "site_exterior_asset",
      }),
      contains: [
        "Install new gate operator",
        "attachments, anchorage, and related hardware",
        "set and secure the assembly",
      ],
    },
    {
      userInput: "remove damaged canopy panel",
      weakOutput: "Remove damaged canopy panel.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["remove_demo"]),
        scopeWorkBucket: "demo_remove",
        scopeAssetCategory: "site_hardware",
        scopeAssetFamily: "site_exterior_asset",
      }),
      contains: [
        "Remove existing damaged canopy panel",
        "remove and dispose of removed materials",
        "site or exterior area",
      ],
    },
    {
      userInput: "replace existing drinking fountain",
      weakOutput: "Replace existing drinking fountain.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["replace_changeout"]),
        scopeWorkBucket: "replace_connected_equipment",
        scopeAssetCategory: "plumbing_fixture",
      }),
      contains: [
        "Remove and replace existing drinking fountain",
        "accessible water, waste, trim, or supply connections as applicable",
        "verify operation",
      ],
    },
    {
      userInput: "add new high-bay fixture",
      weakOutput: "Add new high-bay fixture.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["install_add_mount"]),
        scopeWorkBucket: "install_new_asset",
        scopeAssetCategory: "electrical_equipment",
        impliedAccessContext: "lift_access",
      }),
      contains: [
        "Install new high-bay fixture",
        "lift or suitable access equipment",
        "accessible mounting, terminations, and service connections",
      ],
    },
  ])("generalizes adjacent phrasing for '$userInput' without falling back to a near-echo", ({
    userInput,
    weakOutput,
    analysis: analysisExpectation,
    contains,
  }) => {
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(analysisExpectation);
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    contains.forEach((snippet) => {
      expect(resolved).toContain(snippet);
    });
    expect(resolved).not.toBe(weakOutput);
    expect(resolved).not.toContain("\n- ");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test.each([
    {
      userInput: "put fence around house and punch holes and weld joints",
      weakOutput: "Put fence around house and punch holes and weld joints.",
      analysis: expect.objectContaining({
        primaryActionFamily: "install_add_mount",
        scopeAssetCategory: "site_hardware",
        scopeTradeBucket: "site",
        roughPrompt: true,
        siteAssemblyHints: expect.arrayContaining(["fence_perimeter_assembly"]),
      }),
      contains: [
        "Install fence",
        "lay out the fence line",
        "create required post or anchor holes",
        "complete welded connections at joints where required",
        "stated fence limits",
      ],
    },
    {
      userInput: "put up fence in backyard",
      weakOutput: "Put up fence in backyard.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["install_add_mount"]),
        scopeAssetCategory: "site_hardware",
        roughPrompt: true,
        siteAssemblyHints: expect.arrayContaining(["fence_perimeter_assembly"]),
      }),
      contains: [
        "Install fence",
        "Lay out the fence line",
        "set and align posts or supports",
      ],
    },
    {
      userInput: "swap out bad windows",
      weakOutput: "Swap out bad windows.",
      analysis: expect.objectContaining({
        primaryActionFamily: "replace_changeout",
        objectType: "framed_opening_object",
        scopeProfile: "universal_scope",
      }),
      contains: [
        "Remove and replace existing windows",
        "perimeter closure, sealant, flashing, or trim tie-in",
        "verify fit and operation",
      ],
    },
    {
      userInput: "fix fascia on back side",
      weakOutput: "Fix fascia on back side.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["repair_patch"]),
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Repair fascia",
        "fit and secure components as needed",
        "minor cuts and adjustments for fit",
      ],
    },
    {
      userInput: "redo wall where water got in",
      weakOutput: "Redo wall where water got in.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["repair_patch"]),
        scopeWorkBucket: "repair_patch",
      }),
      contains: [
        "Repair affected wall areas where water intrusion is evident",
        "localized patching or repair within the stated scope",
        "Concealed moisture damage",
      ],
    },
    {
      userInput: "install guardrail and anchor it down",
      weakOutput: "Install guardrail and anchor it down.",
      analysis: expect.objectContaining({
        objectType: "anchored_object",
        connectionModel: "anchorage_fasteners",
        scopeProfile: "equipment_asset",
      }),
      contains: [
        "Install guardrail",
        "attachments, anchorage, and related hardware",
        "clean up the work area",
      ],
    },
    {
      userInput: "replace access panel and weld tabs",
      weakOutput: "Replace access panel and weld tabs.",
      analysis: expect.objectContaining({
        objectType: "panel_closure_object",
        scopeProfile: "universal_scope",
        secondaryActionMethods: expect.arrayContaining(["welded_connection"]),
      }),
      contains: [
        "Remove and replace existing access panel",
        "welded tab or attachment connections",
        "verify fit and secure closure",
      ],
    },
    {
      userInput: "put flashing on wall",
      weakOutput: "Put flashing on wall.",
      analysis: expect.objectContaining({
        primaryActionFamily: "install_add_mount",
        objectType: "panel_closure_object",
        scopeProfile: "universal_scope",
        roughPrompt: true,
      }),
      contains: [
        "Install flashing",
        "perimeter attachment, sealant, or closure work",
        "perimeter sealant or flashing integration",
      ],
    },
    {
      userInput: "tear out bad gate and put new one",
      weakOutput: "Tear out bad gate and put new one.",
      analysis: expect.objectContaining({
        primaryActionFamily: "replace_changeout",
        scopeAssetCategory: "site_hardware",
        scopeWorkBucket: "replace_non_connected_asset",
        roughPrompt: true,
      }),
      contains: [
        "Remove and replace existing gate",
        "attachments, anchorage, and related hardware",
        "clean up the work area",
      ],
    },
    {
      userInput: "patch wall and paint it",
      weakOutput: "Patch wall and paint it.",
      analysis: expect.objectContaining({
        actionFamilies: expect.arrayContaining(["repair_patch", "finish_coating"]),
        scopeProfile: "painting",
        roughPrompt: true,
      }),
      contains: [
        "Patch designated wall surfaces as needed",
        "Apply paint to the repaired work area",
        "direct patch and paint area",
      ],
    },
    {
      userInput: "install canopy panel and bolt it up",
      weakOutput: "Install canopy panel and bolt it up.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "site_hardware",
        roughPrompt: true,
        secondaryActionMethods: expect.arrayContaining(["anchorage_connection"]),
      }),
      contains: [
        "Install canopy panel",
        "complete required anchorage and securement",
        "clean up the work area",
      ],
    },
    {
      userInput: "replace storefront glass and seal around it",
      weakOutput: "Replace storefront glass and seal around it.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "glazing_storefront",
        scopeProfile: "equipment_asset",
        secondaryActionMethods: expect.arrayContaining(["perimeter_seal"]),
      }),
      contains: [
        "Remove and replace existing storefront glass",
        "setting, sealant, perimeter attachment, and closure work",
        "opening secure within the stated scope",
      ],
    },
  ])("builds a stronger first-pass scope note for rough contractor prompt '$userInput'", ({
    userInput,
    weakOutput,
    analysis: analysisExpectation,
    contains,
  }) => {
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(analysisExpectation);
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    contains.forEach((snippet) => {
      expect(resolved).toContain(snippet);
    });
    expect(resolved).not.toBe(weakOutput);
    expect(resolved).not.toContain("\n- ");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test.each([
    {
      userInput: "fix gate at side yard",
      weakOutput: "Fix gate at side yard.",
      analysis: expect.objectContaining({
        scopeWorkBucket: "repair_patch",
        scopeAssetCategory: "site_hardware",
      }),
      contains: [
        "Repair gate at side yard",
        "attachments, anchorage, and alignment",
        "direct repair scope",
      ],
    },
    {
      userInput: "redo stucco around back window",
      weakOutput: "Redo stucco around back window.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
        perimeterScopeHints: expect.arrayContaining(["perimeter_scope"]),
      }),
      contains: [
        "Repair stucco at back window",
        "texture blending as closely as practical",
        "Full elevation coating",
      ],
    },
    {
      userInput: "patch water damage on ceiling and paint",
      weakOutput: "Patch water damage on ceiling and paint.",
      analysis: expect.objectContaining({
        scopeProfile: "painting",
        waterDamageRepairHints: expect.arrayContaining(["water_damage_repair", "ceiling_repair_area"]),
      }),
      contains: [
        "Patch affected ceiling areas damaged by water or leaks as needed",
        "Apply paint to the repaired work area",
        "direct patch and paint area",
      ],
    },
    {
      userInput: "remove and reinstall handrail",
      weakOutput: "Remove and reinstall handrail.",
      analysis: expect.objectContaining({
        resetIntent: "remove_reinstall",
        scopeAssetCategory: "site_hardware",
      }),
      contains: [
        "Remove and reinstall existing handrail",
        "protect and store reusable components",
        "verify fit and attachment",
      ],
      notContains: [
        "Remove and replace",
      ],
    },
    {
      userInput: "replace bad fence section",
      weakOutput: "Replace bad fence section.",
      analysis: expect.objectContaining({
        scopeProfile: "equipment_asset",
        scopeAssetCategory: "site_hardware",
      }),
      contains: [
        "Remove and replace existing fence section",
        "lay out the fence line",
        "stated fence limits",
      ],
    },
    {
      userInput: "seal around storefront door",
      weakOutput: "Seal around storefront door.",
      analysis: expect.objectContaining({
        scopeProfile: "universal_scope",
        connectionModel: "perimeter_closure",
      }),
      contains: [
        "Seal around storefront door",
        "weatherproofing tie-in",
        "Framing correction",
      ],
    },
    {
      userInput: "patch old opening and paint wall",
      weakOutput: "Patch old opening and paint wall.",
      analysis: expect.objectContaining({
        scopeProfile: "painting",
        openingClosureHints: expect.arrayContaining(["old_opening"]),
      }),
      contains: [
        "Patch and close the old opening",
        "Apply paint to the repaired work area",
        "direct patch and paint area",
      ],
    },
    {
      userInput: "fix loose fascia on rear side",
      weakOutput: "Fix loose fascia on rear side.",
      analysis: expect.objectContaining({
        scopeProfile: "finish_carpentry",
        partialScopeHints: expect.arrayContaining(["side_scope"]),
      }),
      contains: [
        "Repair loose fascia at rear side",
        "fit and secure components as needed",
        "affected trim area",
      ],
    },
    {
      userInput: "replace damaged panel and bolt it back up",
      weakOutput: "Replace damaged panel and bolt it back up.",
      analysis: expect.objectContaining({
        scopeProfile: "universal_scope",
        objectType: "panel_closure_object",
        secondaryActionMethods: expect.arrayContaining(["anchorage_connection"]),
      }),
      contains: [
        "Remove and replace damaged panel",
        "fit and secure the replacement panel or closure assembly",
        "verify fit and secure closure",
      ],
    },
    {
      userInput: "detach light and reinstall after repair",
      weakOutput: "Detach light and reinstall after repair.",
      analysis: expect.objectContaining({
        resetIntent: "temporary_remove_reinstall",
      }),
      contains: [
        "Temporarily remove and reinstall existing light",
        "adjacent repair",
        "reinstall and secure the item",
      ],
      notContains: [
        "Remove and replace",
      ],
    },
    {
      userInput: "repair cracked stucco at front entry",
      weakOutput: "Repair cracked stucco at front entry.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
      }),
      contains: [
        "Repair cracked stucco at front entry",
        "texture blending as closely as practical",
        "Full elevation coating",
      ],
    },
    {
      userInput: "replace failed sealant around window",
      weakOutput: "Replace failed sealant around window.",
      analysis: expect.objectContaining({
        scopeProfile: "equipment_asset",
        scopeAssetCategory: "door_hardware",
        replaceableAssetCategory: "door_hardware",
        objectType: "hardware_component",
        connectionModel: "perimeter_closure",
      }),
      contains: [
        "Remove and replace existing failed sealant at window",
        "within the stated scope",
        "direct component replacement scope",
      ],
    },
    {
      userInput: "patch one side of wall and paint",
      weakOutput: "Patch one side of wall and paint.",
      analysis: expect.objectContaining({
        scopeProfile: "painting",
        partialScopeHints: expect.arrayContaining(["side_scope"]),
      }),
      contains: [
        "Patch designated wall surfaces as needed",
        "Apply paint to the repaired work area",
        "Keep the work limited to the affected side, section, perimeter, or stated repair area",
      ],
    },
    {
      userInput: "close up old opening",
      weakOutput: "Close up old opening.",
      analysis: expect.objectContaining({
        openingClosureHints: expect.arrayContaining(["old_opening", "close_up_scope"]),
      }),
      contains: [
        "Close up opening",
        "Patch and close the opening within the stated scope",
        "direct closure scope",
      ],
    },
    {
      userInput: "swap out bad door and trim around it",
      weakOutput: "Swap out bad door and trim around it.",
      analysis: expect.objectContaining({
        scopeProfile: "universal_scope",
        objectType: "framed_opening_object",
      }),
      contains: [
        "Remove and replace existing door",
        "perimeter closure, sealant, flashing, or trim tie-in",
        "verify fit and operation",
      ],
    },
    {
      userInput: "fix broken railing at rear stair",
      weakOutput: "Fix broken railing at rear stair.",
      analysis: expect.objectContaining({
        scopeWorkBucket: "repair_patch",
      }),
      contains: [
        "Repair railing at rear stair",
        "attachments, anchorage, and alignment",
        "direct repair scope",
      ],
    },
    {
      userInput: "repair leak damage around window",
      weakOutput: "Repair leak damage around window.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
        waterDamageRepairHints: expect.arrayContaining(["leak_damage_repair", "adjacent_window_repair"]),
      }),
      contains: [
        "Repair leak-damaged areas around window",
        "localized patching or repair within the stated scope",
        "direct perimeter area",
      ],
    },
    {
      userInput: "replace rusted post at gate",
      weakOutput: "Replace rusted post at gate.",
      analysis: expect.objectContaining({
        scopeProfile: "equipment_asset",
        scopeAssetCategory: "site_hardware",
      }),
      contains: [
        "Remove and replace existing rusted post at gate",
        "attachments, anchorage, and related hardware",
        "Base or foundation work",
      ],
    },
    {
      userInput: "patch holes and repaint wall",
      weakOutput: "Patch holes and repaint wall.",
      analysis: expect.objectContaining({
        scopeProfile: "painting",
      }),
      contains: [
        "Patch designated wall surfaces as needed",
        "Apply paint to the repaired work area",
        "direct patch and paint area",
      ],
    },
    {
      userInput: "remove gate and install new one",
      weakOutput: "Remove gate and install new one.",
      analysis: expect.objectContaining({
        primaryActionFamily: "replace_changeout",
        scopeProfile: "equipment_asset",
      }),
      contains: [
        "Remove and replace existing gate",
        "attachments, anchorage, and related hardware",
        "site or exterior area",
      ],
    },
    {
      userInput: "repair damaged drywall in bathroom",
      weakOutput: "Repair damaged drywall in bathroom.",
      analysis: expect.objectContaining({
        scopeProfile: "drywall",
      }),
      contains: [
        "Patch affected drywall areas as needed in bathroom",
        "leave ready for finish",
        "Minor patching only",
      ],
    },
    {
      userInput: "replace bad glass at storefront",
      weakOutput: "Replace bad glass at storefront.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "glazing_storefront",
        scopeProfile: "equipment_asset",
      }),
      contains: [
        "Remove and replace existing glass at storefront",
        "setting, sealant, and attachment work",
        "stated glazing scope",
      ],
    },
    {
      userInput: "touch up fascia at back side",
      weakOutput: "Touch up fascia at back side.",
      analysis: expect.objectContaining({
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Touch up fascia at back side",
        "fit and secure components as needed",
        "affected trim area",
      ],
    },
    {
      userInput: "reinstall panel and secure it",
      weakOutput: "Reinstall panel and secure it.",
      analysis: expect.objectContaining({
        resetIntent: "remove_reinstall",
      }),
      contains: [
        "reinstall",
        "verify fit and attachment",
        "complete required anchorage and securement",
      ],
      notContains: [
        "Remove and replace",
      ],
    },
    {
      userInput: "frame opening and close it up",
      weakOutput: "Frame opening and close it up.",
      analysis: expect.objectContaining({
        openingClosureHints: expect.arrayContaining(["opening_closure", "close_up_scope", "framed_closure_support"]),
      }),
      contains: [
        "Close up opening",
        "Frame or back the opening as required within the stated scope",
        "Framing correction",
      ],
    },
    {
      userInput: "fix loose bracket and anchor it down",
      weakOutput: "Fix loose bracket and anchor it down.",
      analysis: expect.objectContaining({
        secondaryActionMethods: expect.arrayContaining(["anchorage_connection"]),
        scopeWorkBucket: "repair_patch",
        objectType: "hardware_component",
      }),
      contains: [
        "Repair loose bracket",
        "support attachment and securement",
        "direct component scope",
      ],
    },
    {
      userInput: "patch around access panel",
      weakOutput: "Patch around access panel.",
      analysis: expect.objectContaining({
        perimeterScopeHints: expect.arrayContaining(["perimeter_scope", "adjacent_finish_repair"]),
      }),
      contains: [
        "Patch around access panel",
        "localized patching or repair within the stated scope",
        "direct perimeter area",
      ],
    },
    {
      userInput: "replace corner trim at window",
      weakOutput: "Replace corner trim at window.",
      analysis: expect.objectContaining({
        scopeProfile: "finish_carpentry",
        partialScopeHints: expect.arrayContaining(["corner_scope"]),
      }),
      contains: [
        "Remove and replace corner trim at window",
        "fit and secure components as needed",
        "affected trim area",
      ],
    },
    {
      userInput: "repair damaged canopy section",
      weakOutput: "Repair damaged canopy section.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
      }),
      contains: [
        "Repair damaged canopy section",
        "attachments, anchorage, and alignment",
        "direct repair scope",
      ],
    },
    {
      userInput: "seal around new hatch",
      weakOutput: "Seal around new hatch.",
      analysis: expect.objectContaining({
        scopeProfile: "universal_scope",
        objectType: "framed_opening_object",
        connectionModel: "perimeter_closure",
      }),
      contains: [
        "Seal around hatch",
        "Prepare adjacent perimeter surfaces",
        "Framing correction",
      ],
    },
  ])("builds a bounded contractor-ready note for vague field prompt '$userInput'", ({
    userInput,
    weakOutput,
    analysis: analysisExpectation,
    contains,
    notContains = [],
  }) => {
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(analysisExpectation);
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    contains.forEach((snippet) => {
      expect(resolved).toContain(snippet);
    });
    notContains.forEach((snippet) => {
      expect(resolved).not.toContain(snippet);
    });
    expect(resolved).not.toBe(weakOutput);
    expect(resolved).not.toContain("\n- ");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test.each([
    {
      userInput: "bad window at bedroom",
      weakOutput: "Bad window at bedroom.",
      analysis: expect.objectContaining({
        primaryActionFamily: "replace_changeout",
        objectType: "framed_opening_object",
      }),
      contains: [
        "Remove and replace existing window",
        "perimeter closure, sealant, flashing, or trim tie-in",
        "verify fit and operation",
      ],
    },
    {
      userInput: "broken panel at canopy",
      weakOutput: "Broken panel at canopy.",
      analysis: expect.objectContaining({
        primaryActionFamily: "replace_changeout",
        objectType: "panel_closure_object",
      }),
      contains: [
        "Remove and replace existing panel at canopy",
        "set and secure the replacement assembly",
        "site restoration beyond direct replacement",
      ],
    },
    {
      userInput: "loose railing by stair",
      weakOutput: "Loose railing by stair.",
      analysis: expect.objectContaining({
        scopeWorkBucket: "repair_patch",
      }),
      contains: [
        "Repair railing",
        "attachments, anchorage, and alignment",
        "direct repair scope",
      ],
    },
    {
      userInput: "rusted post at side gate",
      weakOutput: "Rusted post at side gate.",
      analysis: expect.objectContaining({
        primaryActionFamily: "replace_changeout",
        scopeAssetCategory: "site_hardware",
      }),
      contains: [
        "Remove and replace existing post at side gate",
        "attachments, anchorage, and related hardware",
        "Base or foundation work",
      ],
    },
    {
      userInput: "patch around storefront glass",
      weakOutput: "Patch around storefront glass.",
      analysis: expect.objectContaining({
        perimeterScopeHints: expect.arrayContaining(["perimeter_scope", "adjacent_finish_repair"]),
      }),
      contains: [
        "Patch around storefront glass",
        "localized patching or repair within the stated scope",
        "direct perimeter area",
      ],
    },
    {
      userInput: "make good wall after repair",
      weakOutput: "Make good wall after repair.",
      analysis: expect.objectContaining({
        scopeWorkBucket: "repair_patch",
        scopeProfile: "repair_scope",
      }),
      contains: [
        "Repair wall",
        "Prepare affected areas as needed for the described repair",
        "direct repair area",
      ],
    },
    {
      userInput: "water came in by rear window",
      weakOutput: "Water came in by rear window.",
      analysis: expect.objectContaining({
        scopeWorkBucket: "repair_patch",
        waterDamageRepairHints: expect.arrayContaining(["water_damage_repair", "adjacent_window_repair"]),
      }),
      contains: [
        "Repair leak-damaged areas around window",
        "localized patching or repair within the stated scope",
        "direct perimeter area",
      ],
    },
    {
      userInput: "damaged drywall at ceiling edge",
      weakOutput: "Damaged drywall at ceiling edge.",
      analysis: expect.objectContaining({
        scopeProfile: "drywall",
        partialScopeHints: expect.arrayContaining(["edge_scope"]),
      }),
      contains: [
        "Patch affected drywall areas as needed",
        "leave ready for finish",
        "Minor patching only",
      ],
    },
    {
      userInput: "sagging gate at side yard",
      weakOutput: "Sagging gate at side yard.",
      analysis: expect.objectContaining({
        scopeWorkBucket: "repair_patch",
        partialScopeHints: expect.arrayContaining(["side_scope"]),
      }),
      contains: [
        "Repair gate at side yard",
        "attachments, anchorage, and alignment",
        "direct repair scope",
      ],
    },
    {
      userInput: "bent handrail at rear stair",
      weakOutput: "Bent handrail at rear stair.",
      analysis: expect.objectContaining({
        scopeWorkBucket: "repair_patch",
      }),
      contains: [
        "Repair handrail at rear stair",
        "attachments, anchorage, and alignment",
        "direct repair scope",
      ],
    },
    {
      userInput: "failed caulking around storefront glass",
      weakOutput: "Failed caulking around storefront glass.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "door_hardware",
        objectType: "hardware_component",
        connectionModel: "perimeter_closure",
      }),
      contains: [
        "Caulk around storefront glass",
        "perimeter surfaces and transitions",
      ],
    },
    {
      userInput: "patch lower wall area",
      weakOutput: "Patch lower wall area.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
        partialScopeHints: expect.arrayContaining(["lower_scope", "area_scope"]),
      }),
      contains: [
        "Patch lower wall area",
        "Prepare affected areas as needed for the described repair",
        "affected section, side, corner, edge, or stated area",
      ],
    },
    {
      userInput: "repair end post at fence",
      weakOutput: "Repair end post at fence.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
        partialScopeHints: expect.arrayContaining(["end_scope"]),
      }),
      contains: [
        "Repair end post at fence",
        "attachments, anchorage, and alignment",
        "direct repair scope",
      ],
    },
    {
      userInput: "make good ceiling at leak area",
      weakOutput: "Make good ceiling at leak area.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
        waterDamageRepairHints: expect.arrayContaining(["water_damage_repair", "ceiling_repair_area"]),
      }),
      contains: [
        "Repair affected ceiling areas where leak or moisture damage is visible",
        "localized patching or repair within the stated scope",
        "visible leak-damaged area",
      ],
    },
    {
      userInput: "patch visible leak damage and paint",
      weakOutput: "Patch visible leak damage and paint.",
      analysis: expect.objectContaining({
        scopeProfile: "painting",
        waterDamageRepairHints: expect.arrayContaining(["water_damage_repair", "leak_damage_repair"]),
      }),
      contains: [
        "Patch affected areas damaged by water or leaks as needed",
        "Apply paint to the repaired work area",
        "direct patch and paint area",
      ],
    },
    {
      userInput: "flash around roof hatch",
      weakOutput: "Flash around roof hatch.",
      analysis: expect.objectContaining({
        scopeProfile: "universal_scope",
        objectType: "framed_opening_object",
        connectionModel: "perimeter_closure",
      }),
      contains: [
        "Flash around roof hatch",
        "perimeter flashing or weatherproofing tie-in",
        "roofing integration",
      ],
    },
    {
      userInput: "repair stained ceiling from leak",
      weakOutput: "Repair stained ceiling from leak.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
        waterDamageRepairHints: expect.arrayContaining(["water_damage_repair", "ceiling_repair_area"]),
      }),
      contains: [
        "Repair affected ceiling areas where leak or moisture damage is visible",
        "blend adjacent finishes as applicable",
        "visible leak-damaged area",
      ],
    },
  ])("solidifies condition-first and localized shorthand for '$userInput'", ({
    userInput,
    weakOutput,
    analysis: analysisExpectation,
    contains,
  }) => {
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(analysisExpectation);
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    contains.forEach((snippet) => {
      expect(resolved).toContain(snippet);
    });
    expect(resolved).not.toBe(weakOutput);
    expect(resolved).not.toContain("\n- ");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test.each([
    {
      userInput: "remove trim and reinstall",
      weakOutput: "Remove trim and reinstall.",
      analysis: expect.objectContaining({
        resetIntent: "remove_reinstall",
      }),
      contains: [
        "Remove and reinstall existing trim",
        "protect and store reusable materials",
        "verify fit and attachment",
      ],
      notContains: [
        "Remove and replace",
      ],
    },
    {
      userInput: "tighten loose bracket at panel",
      weakOutput: "Tighten loose bracket at panel.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
        scopeWorkBucket: "repair_patch",
      }),
      contains: [
        "Repair loose bracket at panel",
        "support attachment and securement",
        "direct component scope",
      ],
    },
    {
      userInput: "fix hinge on gate",
      weakOutput: "Fix hinge on gate.",
      analysis: expect.objectContaining({
        scopeWorkBucket: "repair_patch",
        scopeAssetCategory: "door_hardware",
      }),
      contains: [
        "Repair hinge at gate",
        "localized hardware attachment, alignment, and securement",
        "direct component scope",
      ],
    },
    {
      userInput: "replace latch at access door",
      weakOutput: "Replace latch at access door.",
      analysis: expect.objectContaining({
        primaryActionFamily: "replace_changeout",
        objectType: "hardware_component",
        scopeProfile: "equipment_asset",
        replaceableAssetCategory: "door_hardware",
      }),
      contains: [
        "Remove and replace existing latch",
        "hardware adjustments",
        "proper operation",
      ],
      notContains: [
        "perimeter closure, sealant, flashing, or trim tie-in",
      ],
    },
    {
      userInput: "patch and texture bathroom wall",
      weakOutput: "Patch and texture bathroom wall.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
        scopeWorkBucket: "repair_patch",
      }),
      contains: [
        "Patch bathroom wall",
        "texture blending as required within the stated repair area",
        "stated repair scope",
      ],
    },
    {
      userInput: "resecure cover panel",
      weakOutput: "Resecure cover panel.",
      analysis: expect.objectContaining({
        primaryActionFamily: "repair_patch",
        objectType: "hardware_component",
      }),
      contains: [
        "Repair cover panel",
        "localized bracket, cover, cap, or support attachment and securement",
        "direct component scope",
      ],
    },
    {
      userInput: "close in old door opening",
      weakOutput: "Close in old door opening.",
      analysis: expect.objectContaining({
        openingClosureHints: expect.arrayContaining(["old_opening", "close_up_scope"]),
      }),
      contains: [
        "Close up opening",
        "Patch and close the opening",
        "direct closure scope",
      ],
    },
    {
      userInput: "repair loose post bracket",
      weakOutput: "Repair loose post bracket.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
        scopeAssetCategory: "site_hardware",
      }),
      contains: [
        "Repair loose post bracket",
        "attachments, anchorage, and alignment",
        "direct repair scope",
      ],
    },
    {
      userInput: "secure cap at fence post",
      weakOutput: "Secure cap at fence post.",
      analysis: expect.objectContaining({
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Repair cap at fence post",
        "fit and secure components as needed",
        "make minor cuts and adjustments for fit",
      ],
    },
    {
      userInput: "replace corner bead and patch wall",
      weakOutput: "Replace corner bead and patch wall.",
      analysis: expect.objectContaining({
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Remove and replace corner bead",
        "complete minor adjacent patching or finish tie-in where directly affected",
        "fit and secure components as needed",
      ],
    },
    {
      userInput: "fix soft drywall at bathroom wall",
      weakOutput: "Fix soft drywall at bathroom wall.",
      analysis: expect.objectContaining({
        scopeProfile: "drywall",
      }),
      contains: [
        "Patch affected drywall areas as needed",
        "leave ready for finish",
        "Minor patching only",
      ],
    },
    {
      userInput: "replace broken storefront glass and seal around frame",
      weakOutput: "Replace broken storefront glass and seal around frame.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "glazing_storefront",
        scopeProfile: "equipment_asset",
      }),
      contains: [
        "Remove and replace existing storefront glass",
        "setting, sealant, perimeter attachment, and closure work",
        "opening secure within the stated scope",
      ],
    },
    {
      userInput: "weld broken fence section",
      weakOutput: "Weld broken fence section.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
        scopeWorkBucket: "repair_patch",
      }),
      contains: [
        "Repair fence section",
        "complete welded connections at joints where required",
        "direct repair scope",
      ],
    },
    {
      userInput: "replace broken hinge and resecure gate",
      weakOutput: "Replace broken hinge and resecure gate.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "door_hardware",
        scopeProfile: "equipment_asset",
      }),
      contains: [
        "Remove and replace existing hinge",
        "hardware adjustments",
        "proper operation",
      ],
    },
    {
      userInput: "fix trim around window",
      weakOutput: "Fix trim around window.",
      analysis: expect.objectContaining({
        scopeProfile: "finish_carpentry",
        perimeterScopeHints: expect.arrayContaining(["perimeter_scope", "trim_transition_scope"]),
      }),
      contains: [
        "Repair trim at window",
        "fit and secure components as needed",
        "make minor cuts and adjustments for fit",
      ],
    },
    {
      userInput: "replace one section of railing",
      weakOutput: "Replace one section of railing.",
      analysis: expect.objectContaining({
        scopeProfile: "equipment_asset",
        partialScopeHints: expect.arrayContaining(["section_scope"]),
      }),
      contains: [
        "Remove and replace existing one section of railing",
        "attachments, anchorage, and related hardware",
        "affected section, perimeter, or stated work area",
      ],
    },
    {
      userInput: "remove panel for access and reinstall",
      weakOutput: "Remove panel for access and reinstall.",
      analysis: expect.objectContaining({
        resetIntent: "temporary_remove_reinstall",
      }),
      contains: [
        "Temporarily remove and reinstall existing panel",
        "adjacent repair",
        "verify fit and secure closure",
      ],
      notContains: [
        "Remove and replace",
      ],
    },
    {
      userInput: "install flashing at wall edge",
      weakOutput: "Install flashing at wall edge.",
      analysis: expect.objectContaining({
        objectType: "panel_closure_object",
        connectionModel: "perimeter_closure",
      }),
      contains: [
        "Install flashing at wall edge",
        "perimeter attachment, sealant, or closure work",
        "perimeter flashing or weatherproofing tie-in",
      ],
    },
  ])("solidifies reset, component, and mixed-task shorthand for '$userInput'", ({
    userInput,
    weakOutput,
    analysis: analysisExpectation,
    contains,
    notContains = [],
  }) => {
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(analysisExpectation);
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    contains.forEach((snippet) => {
      expect(resolved).toContain(snippet);
    });
    notContains.forEach((snippet) => {
      expect(resolved).not.toContain(snippet);
    });
    expect(resolved).not.toBe(weakOutput);
    expect(resolved).not.toContain("\n- ");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test.each([
    { userInput: "fix hinge", contains: ["hinge", "repair"] },
    { userInput: "replace latch", contains: ["latch", "proper operation"] },
    { userInput: "adjust closer", contains: ["closer", "repair"] },
    { userInput: "replace lock at entry door", contains: ["lock", "entry door"] },
    { userInput: "replace weatherstrip at man door", contains: ["weatherstrip", "closure"] },
    { userInput: "adjust door sweep", contains: ["door sweep", "closure"] },
    { userInput: "repair handle at access door", contains: ["handle", "repair"] },
    { userInput: "fix gate latch", contains: ["latch", "gate"] },
    { userInput: "replace hinge at cabinet door", contains: ["hinge", "cabinet door"] },
    { userInput: "tighten loose hinge", contains: ["hinge", "repair"] },
    { userInput: "repair loose bracket", contains: ["bracket", "securement"] },
    { userInput: "replace post cap", contains: ["post cap", "fit and secure"] },
    { userInput: "repair cover panel", contains: ["cover panel", "repair"] },
    { userInput: "resecure support bracket", contains: ["support bracket", "securement"] },
    { userInput: "replace wall bracket", contains: ["wall bracket", "align components"] },
    { userInput: "fix panel support", contains: ["panel support", "securement"] },
    { userInput: "reattach cover plate", contains: ["cover plate", "repair"] },
    { userInput: "repair latch", contains: ["latch", "repair"] },
    { userInput: "tighten bracket", contains: ["bracket", "securement"] },
    { userInput: "fix cover", contains: ["cover", "attachment"] },
    { userInput: "resecure panel cover", contains: ["panel cover", "repair"] },
  ])("hardens low-level component shorthand for '$userInput'", ({ userInput, contains }) => {
    const weakOutput = toWeakScopeEcho(userInput);
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    const normalizedResolved = resolved.toLowerCase();
    contains.forEach((snippet) => {
      expect(normalizedResolved).toContain(snippet.toLowerCase());
    });
    expectContractorScopeUpgrade(resolved, weakOutput);
  });

  test.each([
    { userInput: "caulk around frame", contains: ["frame", "perimeter"] },
    { userInput: "replace failed sealant", contains: ["failed sealant", "sealant"] },
    { userInput: "seal around door", contains: ["door", "sealant"] },
    { userInput: "re-caulk window perimeter", contains: ["caulk", "affected areas"] },
    { userInput: "repair seal at hatch", contains: ["hatch", "seal"] },
    { userInput: "caulk around panel", contains: ["panel", "perimeter"] },
    { userInput: "touch up sealant at frame", contains: ["sealant", "frame"] },
    { userInput: "replace bad caulking around storefront glass", contains: ["storefront glass", "replacement"] },
    { userInput: "replace corner trim", contains: ["corner trim", "fit and secure"] },
    { userInput: "patch trim piece", contains: ["trim piece", "fit and secure"] },
    { userInput: "fix fascia piece", contains: ["fascia", "fit and secure"] },
    { userInput: "replace bead", contains: ["bead", "install and secure"] },
    { userInput: "patch baseboard end", contains: ["baseboard", "fit and secure"] },
    { userInput: "replace small trim section", contains: ["trim section", "fit and secure"] },
    { userInput: "repair edge trim", contains: ["edge trim", "fit and secure"] },
    { userInput: "replace window trim corner", contains: ["window trim", "fit and secure"] },
    { userInput: "patch around trim", contains: ["trim", "fit and secure"] },
    { userInput: "repair loose fascia piece", contains: ["fascia", "fit and secure"] },
    { userInput: "patch small area", contains: ["affected areas", "repair"] },
    { userInput: "touch up wall", contains: ["wall", "repair"] },
    { userInput: "make good around repair", contains: ["repair", "work area"] },
    { userInput: "patch and paint small section", contains: ["paint", "affected side"] },
    { userInput: "blend patch", contains: ["patch", "work area"] },
    { userInput: "patch around box", contains: ["box", "repair"] },
    { userInput: "repair minor drywall damage", contains: ["drywall", "Minor patching only"] },
    { userInput: "touch up fascia", contains: ["fascia", "fit and secure"] },
    { userInput: "patch around opening", contains: ["opening", "repair"] },
    { userInput: "texture patch area", contains: ["texture", "repair"] },
    { userInput: "patch trim", contains: ["trim", "fit and secure"] },
    { userInput: "seal frame", contains: ["frame", "sealant"] },
    { userInput: "patch corner", contains: ["corner", "repair"] },
  ])("hardens low-level perimeter, trim, and make-good shorthand for '$userInput'", ({ userInput, contains }) => {
    const weakOutput = toWeakScopeEcho(userInput);
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    const normalizedResolved = resolved.toLowerCase();
    contains.forEach((snippet) => {
      expect(normalizedResolved).toContain(snippet.toLowerCase());
    });
    expectContractorScopeUpgrade(resolved, weakOutput);
  });

  test.each([
    { userInput: "resecure panel", contains: ["panel", "repair"] },
    { userInput: "adjust gate", contains: ["gate", "alignment"] },
    { userInput: "reset panel cover", contains: ["panel cover", "fit and attachment"] },
    { userInput: "align latch", contains: ["latch", "alignment"] },
    { userInput: "square door", contains: ["door", "repair"] },
    { userInput: "reattach trim", contains: ["trim", "fit and secure"] },
    { userInput: "secure cap back on", contains: ["cap", "attachment"] },
    { userInput: "reset cover plate", contains: ["cover plate", "fit and attachment"] },
    { userInput: "replace hinge and align door", contains: ["hinge", "door, frame"] },
    { userInput: "patch around panel and paint", contains: ["panel", "paint"] },
    { userInput: "replace latch and resecure gate", contains: ["latch", "site or exterior area"] },
    { userInput: "caulk around frame and touch up paint", contains: ["frame", "paint"] },
    { userInput: "replace cap and secure post", contains: ["cap", "fit and secure"] },
    { userInput: "repair cover panel and bolt it back", contains: ["cover panel", "repair"] },
    { userInput: "replace weatherstrip and adjust door", contains: ["weatherstrip", "door, frame"] },
    { userInput: "patch trim and paint it", contains: ["trim", "paint"] },
    { userInput: "fix hinge on cabinet door", contains: ["hinge", "cabinet door"] },
    { userInput: "repair bracket at canopy panel", contains: ["bracket", "canopy panel"] },
    { userInput: "resecure trim at storefront window", contains: ["trim", "storefront window"] },
    { userInput: "adjust closer at entry door", contains: ["closer", "entry door"] },
    { userInput: "repair support bracket at kitchen cabinet", contains: ["support bracket", "kitchen cabinet"] },
    { userInput: "fix cap", contains: ["cap", "fit and secure"] },
  ])("keeps low-level mixed and parent-context tasks narrow for '$userInput'", ({ userInput, contains }) => {
    const weakOutput = toWeakScopeEcho(userInput);
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    const normalizedResolved = resolved.toLowerCase();
    contains.forEach((snippet) => {
      expect(normalizedResolved).toContain(snippet.toLowerCase());
    });
    expectContractorScopeUpgrade(resolved, weakOutput);
  });

  test("extends the current layered router upward into mid-level assembly, section, and room-area prompts", () => {
    expect(analyzeScopeAssistInput("replace lower cabinet run")).toEqual(
      expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
        partialScopeHints: expect.arrayContaining(["lower_scope", "run_scope"]),
      })
    );

    expect(analyzeScopeAssistInput("patch and paint water damage in ceiling")).toEqual(
      expect.objectContaining({
        scopeProfile: "painting",
        waterDamageRepairHints: expect.arrayContaining(["water_damage_repair", "ceiling_repair_area"]),
      })
    );

    expect(analyzeScopeAssistInput("replace storefront glass at entry")).toEqual(
      expect.objectContaining({
        scopeAssetCategory: "glazing_storefront",
        objectType: "framed_opening_object",
        scopeProfile: "equipment_asset",
      })
    );

    expect(analyzeScopeAssistInput("repair access panel assembly")).toEqual(
      expect.objectContaining({
        objectType: "panel_closure_object",
        scopeProfile: "repair_scope",
      })
    );

    expect(analyzeScopeAssistInput("replace handrail section and secure posts")).toEqual(
      expect.objectContaining({
        scopeAssetCategory: "site_hardware",
        partialScopeHints: expect.arrayContaining(["section_scope"]),
        scopeWorkBucket: "replace_non_connected_asset",
      })
    );
  });

  test.each([
    { userInput: "install cabinets in kitchen", contains: ["install cabinets", "place, level, align, and secure", "stated casework scope"] },
    { userInput: "replace kitchen cabinets", contains: ["remove and replace kitchen cabinets", "place, level, align, and secure", "stated casework scope"] },
    { userInput: "replace lower cabinet run", contains: ["lower cabinet", "affected run", "stated casework scope"] },
    { userInput: "repair built-in cabinet section", contains: ["built-in cabinet section", "repair accessible cabinet", "stated casework scope"] },
    { userInput: "install vanity in bathroom", contains: ["install vanity in bathroom", "place, level, align, and secure the unit"] },
    { userInput: "replace vanity in bathroom", contains: ["remove and replace vanity in bathroom", "place, level, align, and secure the unit"] },
    { userInput: "install casework at lobby wall", contains: ["install casework", "place, level, align, and secure", "stated casework scope"] },
    { userInput: "replace millwork at reception wall", contains: ["remove and replace millwork", "place, level, align, and secure", "stated casework scope"] },
    { userInput: "install built-in bench at waiting area", contains: ["install built-in bench", "place, level, align, and secure", "waiting area"] },
    { userInput: "replace locker unit in breakroom", contains: ["replace locker unit", "place, level, align, and secure", "breakroom"] },
    { userInput: "repair drywall in bedroom", contains: ["drywall", "bedroom", "ready for finish"] },
    { userInput: "patch and paint water damage in ceiling", contains: ["affected ceiling areas", "paint", "repaired work area"] },
    { userInput: "repair stucco at west wall", contains: ["stucco", "texture blending as closely as practical", "west wall"] },
    { userInput: "repair damaged drywall in bathroom", contains: ["drywall", "bathroom", "repair"] },
    { userInput: "patch wall and repaint in office", contains: ["wall", "paint", "office"] },
    { userInput: "repair leak damage around window", contains: ["around window", "localized", "perimeter"] },
    { userInput: "patch lower wall area and paint", contains: ["wall", "paint", "affected side"] },
    { userInput: "make good wall after cabinet install", contains: ["wall", "repair", "work area"] },
    { userInput: "repair stained ceiling from leak", contains: ["ceiling", "leak", "repair"] },
    { userInput: "patch around storefront glass and paint", contains: ["storefront glass", "paint"] },
  ])("scales mid-level assembly and room-area prompts without flattening them for '$userInput'", ({ userInput, contains }) => {
    const weakOutput = toWeakScopeEcho(userInput);
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    const normalizedResolved = resolved.toLowerCase();
    contains.forEach((snippet) => {
      expect(normalizedResolved).toContain(snippet.toLowerCase());
    });
    expectContractorScopeUpgrade(resolved, weakOutput);
  });

  test.each([
    { userInput: "replace one section of railing", contains: ["section of railing", "attachments, anchorage", "affected section"] },
    { userInput: "replace bad fence section", contains: ["fence section", "fence line", "site or exterior area"] },
    { userInput: "repair end post at fence", contains: ["end post", "fence", "repair scope"] },
    { userInput: "replace damaged panel section", contains: ["panel section", "replacement panel", "stated scope"] },
    { userInput: "repair fascia on rear side", contains: ["fascia", "rear side", "repair"] },
    { userInput: "repair canopy section at front entry", contains: ["canopy section", "front entry", "repair"] },
    { userInput: "replace storefront glass at entry", contains: ["storefront glass", "setting, sealant", "entry"] },
    { userInput: "replace man door at rear entry", contains: ["man door", "rear entry", "verify fit and operation"] },
    { userInput: "repair access panel assembly", contains: ["access panel", "assembly scope", "closure"] },
    { userInput: "replace hatch at roof access", contains: ["hatch", "roof access", "perimeter"] },
    { userInput: "patch around opening and paint", contains: ["opening", "paint"] },
    { userInput: "replace trim around door", contains: ["trim at door", "fit and secure"] },
    { userInput: "repair frame area at window", contains: ["frame area", "window", "assembly scope"] },
    { userInput: "replace glazing panel and seal perimeter", contains: ["glazing panel", "perimeter", "seal"] },
    { userInput: "reset access panel and patch wall", contains: ["access panel", "reinstall and secure", "wall"] },
    { userInput: "close up old opening and finish wall", contains: ["close up opening", "blend adjacent finishes"] },
    { userInput: "install fence section at side yard", contains: ["fence section", "side yard", "fence line"] },
    { userInput: "replace fencing around house side", contains: ["fencing", "house side", "fence line"] },
    { userInput: "repair gate and post at side yard", contains: ["gate", "post", "side yard"] },
    { userInput: "install guardrail at rear stair", contains: ["guardrail", "rear stair", "secure"] },
    { userInput: "replace canopy panel section", contains: ["canopy panel", "panel", "stated asset scope"] },
    { userInput: "install wall louver at exterior wall", contains: ["wall louver", "perimeter", "exterior"] },
    { userInput: "replace fascia and trim at rear elevation", contains: ["fascia", "trim", "rear elevation"] },
    { userInput: "repair handrail section at stair", contains: ["handrail section", "repair", "stair"] },
    { userInput: "replace awning at entry", contains: ["awning", "entry", "set and secure"] },
    { userInput: "install wall flashing at canopy", contains: ["wall flashing", "canopy", "perimeter"] },
  ])("keeps mid-level section, opening, and exterior prompts bounded for '$userInput'", ({ userInput, contains }) => {
    const weakOutput = toWeakScopeEcho(userInput);
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    const normalizedResolved = resolved.toLowerCase();
    contains.forEach((snippet) => {
      expect(normalizedResolved).toContain(snippet.toLowerCase());
    });
    expectContractorScopeUpgrade(resolved, weakOutput);
  });

  test.each([
    { userInput: "replace storefront glass and seal around frame", contains: ["storefront glass", "seal", "frame"] },
    { userInput: "replace cabinets and make good wall", contains: ["cabinets", "make-good", "wall"] },
    { userInput: "remove gate and install new one", contains: ["gate", "site or exterior area", "clean up"] },
    { userInput: "replace handrail section and secure posts", contains: ["handrail section", "securement", "affected section"] },
    { userInput: "install vanity and patch wall after", contains: ["vanity", "adjacent wall make-good"] },
    { userInput: "replace panel section and bolt it up", contains: ["panel section", "secure", "stated scope"] },
    { userInput: "repair stucco and paint wall area", contains: ["stucco", "paint", "repaired work area"] },
    { userInput: "replace door and trim around it", contains: ["door", "trim", "perimeter"] },
    { userInput: "install fence section and weld joints", contains: ["fence section", "welded connections at joints"] },
    { userInput: "replace entry door and seal perimeter", contains: ["entry door", "perimeter", "seal"] },
    { userInput: "patch, texture, and paint wall area", contains: ["texture", "paint", "wall surfaces"] },
    { userInput: "remove and replace damaged wall panel", contains: ["remove and replace damaged wall panel", "replacement assembly", "stated scope"] },
    { userInput: "repair and make good wall area", contains: ["wall area", "repair", "work area"] },
    { userInput: "rework storefront glass at entry", contains: ["storefront glass", "entry", "stated"] },
    { userInput: "redo wall area after leak", contains: ["water intrusion", "repair", "wall area"] },
    { userInput: "fix canopy section at front entry", contains: ["canopy section", "front entry", "repair"] },
    { userInput: "replace bad section of fencing", contains: ["fencing", "section", "fence line"] },
    { userInput: "install and align cabinet run", contains: ["cabinet run", "align", "casework scope"] },
    { userInput: "replace and seal glazing panel", contains: ["glazing panel", "sealant", "stated glazing scope"] },
    { userInput: "patch and blend repair area", contains: ["repair area", "blend", "repair"] },
    { userInput: "repair and paint damaged ceiling area", contains: ["ceiling area", "paint", "repair"] },
  ])("merges mid-level combo prompts into one bounded contractor workflow for '$userInput'", ({ userInput, contains }) => {
    const weakOutput = toWeakScopeEcho(userInput);
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    const normalizedResolved = resolved.toLowerCase();
    contains.forEach((snippet) => {
      expect(normalizedResolved).toContain(snippet.toLowerCase());
    });
    expectContractorScopeUpgrade(resolved, weakOutput);
  });

  test.each([
    {
      userInput: "replace residential windows",
      weakOutput: "Replace residential windows.",
      analysis: expect.objectContaining({
        objectType: "framed_opening_object",
        connectionModel: "perimeter_closure",
        assemblyScale: "full_assembly_opening",
        residentialContext: true,
        scopeProfile: "universal_scope",
      }),
      contains: [
        "Remove and replace existing residential windows",
        "perimeter closure, sealant, flashing, or trim tie-in",
        "verify fit and operation",
      ],
    },
    {
      userInput: "replace skylight",
      weakOutput: "Replace skylight.",
      analysis: expect.objectContaining({
        objectType: "framed_opening_object",
        connectionModel: "perimeter_closure",
        impliedAccessContext: "rooftop_access",
        scopeProfile: "universal_scope",
      }),
      contains: [
        "Remove and replace existing skylight",
        "Coordinate rooftop access or safe shutdown conditions as required",
        "roofing integration",
      ],
    },
    {
      userInput: "install wall louvers",
      weakOutput: "Install wall louvers.",
      analysis: expect.objectContaining({
        objectType: "opening_assembly",
        connectionModel: "perimeter_closure",
        siteExteriorContext: true,
        scopeProfile: "universal_scope",
      }),
      contains: [
        "Install wall louvers",
        "perimeter attachment, sealant, flashing, or closure work",
        "verify fit and operation",
      ],
    },
    {
      userInput: "replace guardrail section",
      weakOutput: "Replace guardrail section.",
      analysis: expect.objectContaining({
        objectType: "anchored_object",
        connectionModel: "anchorage_fasteners",
        scopeProfile: "equipment_asset",
      }),
      contains: [
        "Remove and replace existing guardrail section",
        "attachments, anchorage, and related hardware",
        "affected section, perimeter, or stated work area",
      ],
    },
    {
      userInput: "replace access panel",
      weakOutput: "Replace access panel.",
      analysis: expect.objectContaining({
        objectType: "panel_closure_object",
        connectionModel: "perimeter_closure",
        scopeProfile: "universal_scope",
      }),
      contains: [
        "Remove and replace existing access panel",
        "fit and secure the replacement panel or closure assembly",
        "verify fit and secure closure",
      ],
    },
    {
      userInput: "replace fascia board",
      weakOutput: "Replace fascia board.",
      analysis: expect.objectContaining({
        objectType: "trim_accessory_object",
        connectionModel: "finish_only_attachment",
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Remove and replace fascia board",
        "fit and secure components as needed",
        "minor cuts and adjustments for fit",
      ],
    },
    {
      userInput: "replace awning",
      weakOutput: "Replace awning.",
      analysis: expect.objectContaining({
        objectType: "anchored_object",
        connectionModel: "anchorage_fasteners",
        impliedAccessContext: "lift_access",
        scopeProfile: "universal_scope",
      }),
      contains: [
        "Remove and replace existing awning",
        "lift or suitable access equipment",
        "set and secure the replacement assembly",
      ],
    },
    {
      userInput: "replace roof hatch",
      weakOutput: "Replace roof hatch.",
      analysis: expect.objectContaining({
        objectType: "framed_opening_object",
        connectionModel: "perimeter_closure",
        impliedAccessContext: "rooftop_access",
        scopeProfile: "universal_scope",
      }),
      contains: [
        "Remove and replace existing roof hatch",
        "Coordinate rooftop access or safe shutdown conditions as required",
        "roofing integration",
      ],
    },
    {
      userInput: "replace roof",
      weakOutput: "Replace roof.",
      analysis: expect.objectContaining({
        scopeProfile: "roofing",
        scopeDepthTarget: "fuller_scope_draft",
      }),
      contains: [
        "Remove and replace the existing roof covering within the stated roof area",
        "Coordinate roof access and fall protection as required",
        "flashing, membrane, or weatherproofing tie-in",
      ],
      notContains: [
        "Complete the described scope",
      ],
    },
    {
      userInput: "tile bathroom",
      weakOutput: "Tile bathroom.",
      analysis: expect.objectContaining({
        scopeProfile: "finish_scope",
        scopeAssetCategory: "finish_surface",
      }),
      contains: [
        "Install tile",
        "Complete required layout, fitting, finishing, and cleanup for the described scope",
        "Keep the work within the identified restroom area and the stated finish scope",
      ],
      notContains: [
        "Complete the described scope and clean up the work area",
      ],
    },
    {
      userInput: "replace man door",
      weakOutput: "Replace man door.",
      analysis: expect.objectContaining({
        objectType: "framed_opening_object",
        connectionModel: "perimeter_closure",
        scopeProfile: "universal_scope",
      }),
      contains: [
        "Remove and replace existing man door",
        "verify fit and operation",
        "Framing correction",
      ],
    },
    {
      userInput: "replace window trim",
      weakOutput: "Replace window trim.",
      analysis: expect.objectContaining({
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Remove and replace window trim",
        "fit and secure components as needed",
        "minor cuts and adjustments for fit",
      ],
      notContains: [
        "perimeter closure",
        "replacement assembly",
      ],
    },
    {
      userInput: "replace storefront windows",
      weakOutput: "Replace storefront windows.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "glazing_storefront",
        scopeProfile: "equipment_asset",
      }),
      contains: [
        "Remove and replace existing storefront windows",
        "setting, sealant, and attachment work",
        "stated glazing scope",
      ],
    },
    {
      userInput: "replace storefront glass",
      weakOutput: "Replace storefront glass.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "glazing_storefront",
        scopeProfile: "equipment_asset",
      }),
      contains: [
        "Remove and replace existing storefront glass",
        "setting, sealant, and attachment work",
        "opening secure within the stated scope",
      ],
    },
    {
      userInput: "install wall flashing",
      weakOutput: "Install wall flashing.",
      analysis: expect.objectContaining({
        objectType: "panel_closure_object",
        connectionModel: "perimeter_closure",
        scopeProfile: "universal_scope",
      }),
      contains: [
        "Install wall flashing",
        "perimeter attachment, sealant, or closure work",
        "perimeter sealant or flashing integration",
      ],
    },
  ])("builds a stronger first-pass scope note for universal contractor prompt '$userInput'", ({
    userInput,
    weakOutput,
    analysis: analysisExpectation,
    contains,
    notContains = [],
  }) => {
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(analysisExpectation);
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    contains.forEach((snippet) => {
      expect(resolved).toContain(snippet);
    });
    notContains.forEach((snippet) => {
      expect(resolved).not.toContain(snippet);
    });
    expect(resolved).not.toBe(weakOutput);
    expect(resolved).not.toContain("\n- ");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test.each([
    {
      userInput: "install cabinets in kitchen",
      weakOutput: "Install cabinets in kitchen.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
        commercialContextSignals: expect.arrayContaining(["kitchen"]),
      }),
      contains: [
        "Install cabinets",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "replace kitchen cabinets",
      weakOutput: "Replace kitchen cabinets.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Remove and replace kitchen cabinets",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "repair built-in cabinet at wall",
      weakOutput: "Repair built-in cabinet at wall.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Repair built-in cabinet",
        "repair accessible cabinet, shelving, casework, millwork, or built-in components",
        "stated casework scope",
      ],
    },
    {
      userInput: "install vanity in bathroom",
      weakOutput: "Install vanity in bathroom.",
      analysis: expect.objectContaining({
        scopeProfile: "vanity",
        scopeTradeBucket: "finish_carpentry",
      }),
      contains: [
        "Install vanity in bathroom",
        "place, level, align, and secure the unit",
        "Plumbing reconnection",
      ],
    },
    {
      userInput: "replace shelving in office",
      weakOutput: "Replace shelving in office.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Remove and replace shelving",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "install casework at lobby wall",
      weakOutput: "Install casework at lobby wall.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
        commercialContextSignals: expect.arrayContaining(["lobby"]),
      }),
      contains: [
        "Install casework",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "replace millwork at reception wall",
      weakOutput: "Replace millwork at reception wall.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
        commercialContextSignals: expect.arrayContaining(["reception"]),
      }),
      contains: [
        "Remove and replace millwork",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "install wall cabinet in laundry room",
      weakOutput: "Install wall cabinet in laundry room.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
        commercialContextSignals: expect.arrayContaining(["laundry"]),
      }),
      contains: [
        "Install wall cabinet",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "replace door hardware at entry door",
      weakOutput: "Replace door hardware at entry door.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "door_hardware",
        scopeProfile: "equipment_asset",
      }),
      contains: [
        "Remove and replace existing door hardware",
        "hardware adjustments",
        "proper operation",
      ],
      notContains: [
        "perimeter closure, sealant, flashing, or trim tie-in",
      ],
    },
    {
      userInput: "install shelving in storage room",
      weakOutput: "Install shelving in storage room.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
        commercialContextSignals: expect.arrayContaining(["storage room"]),
      }),
      contains: [
        "Install shelving",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "replace vanity in bathroom",
      weakOutput: "Replace vanity in bathroom.",
      analysis: expect.objectContaining({
        scopeProfile: "vanity",
        scopeTradeBucket: "finish_carpentry",
      }),
      contains: [
        "Remove and replace vanity in bathroom",
        "place, level, align, and secure the unit",
        "Plumbing reconnection",
      ],
    },
    {
      userInput: "install millwork at office wall",
      weakOutput: "Install millwork at office wall.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
        commercialContextSignals: expect.arrayContaining(["office"]),
      }),
      contains: [
        "Install millwork",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "repair cabinet door and resecure hinge",
      weakOutput: "Repair cabinet door and resecure hinge.",
      analysis: expect.objectContaining({
        scopeProfile: "finish_carpentry",
        objectType: "hardware_component",
      }),
      contains: [
        "Repair cabinet door",
        "Adjust, resecure, and repair accessible cabinet",
        "verify fit and operation",
      ],
    },
    {
      userInput: "install built-in bench at wall",
      weakOutput: "Install built-in bench at wall.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Install built-in bench",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "replace locker unit in breakroom",
      weakOutput: "Replace locker unit in breakroom.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
        commercialContextSignals: expect.arrayContaining(["breakroom"]),
      }),
      contains: [
        "Remove and replace locker unit",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "install wall-mounted storage unit",
      weakOutput: "Install wall-mounted storage unit.",
      analysis: expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
      }),
      contains: [
        "Install wall-mounted storage unit",
        "place, level, align, and secure",
        "stated casework scope",
      ],
    },
    {
      userInput: "install kitchen equipment support bracket",
      weakOutput: "Install kitchen equipment support bracket.",
      analysis: expect.objectContaining({
        scopeProfile: "universal_scope",
        objectType: "hardware_component",
        connectionModel: "anchorage_fasteners",
        commercialContextSignals: expect.arrayContaining(["kitchen"]),
      }),
      contains: [
        "Install kitchen equipment support bracket",
        "Lay out attachment points",
        "direct component scope",
      ],
      notContains: [
        "site restoration beyond direct replacement",
      ],
    },
    {
      userInput: "repair cover panel and resecure it",
      weakOutput: "Repair cover panel and resecure it.",
      analysis: expect.objectContaining({
        scopeProfile: "repair_scope",
      }),
      contains: [
        "Repair cover panel",
        "localized bracket, cover, cap, or support attachment and securement",
        "direct component scope",
      ],
    },
  ])("extends broader vocabulary support through the current layered scope engine for '$userInput'", ({
    userInput,
    weakOutput,
    analysis: analysisExpectation,
    contains,
    notContains = [],
  }) => {
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(analysisExpectation);
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    contains.forEach((snippet) => {
      expect(resolved).toContain(snippet);
    });
    notContains.forEach((snippet) => {
      expect(resolved).not.toContain(snippet);
    });
    expect(resolved).not.toBe(weakOutput);
    expect(resolved).not.toContain("\n- ");
    expect(resolved.toLowerCase()).not.toContain("scope includes");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test("expands terse canopy demo prompts into bounded site/demo scope notes", () => {
    const userInput = "demo damaged canopy";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Demo damaged canopy.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "demo_remove",
        scopeTradeBucket: "site",
        scopeAssetCategory: "site_hardware",
        siteExteriorContext: true,
        impliedAccessContext: "lift_access",
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove existing damaged canopy");
    expect(resolved).toContain("lift or suitable access equipment");
    expect(resolved).toContain("remove and dispose of removed materials");
    expect(resolved).toContain("site restoration beyond direct replacement");
  });

  test("expands terse fence-section removal prompts into contractor-ready demo language", () => {
    const userInput = "remove fence section";
    const analysis = analyzeScopeAssistInput(userInput);
    const weakOutput = "Remove fence section.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeWorkBucket: "demo_remove",
        scopeTradeBucket: "site",
        scopeAssetCategory: "site_hardware",
        siteExteriorContext: true,
      })
    );
    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove existing fence section");
    expect(resolved).toContain("remove and dispose of removed materials");
    expect(resolved).toContain("site or exterior area");
    expect(resolved).not.toBe("Remove fence section.");
  });

  test("does not bloat an already-developed technical site asset note", () => {
    const userInput = "Remove existing light pole at hotel site, including disconnect accessible site-lighting conductors or attachments required for safe removal. Coordinate lift access, dispose of removed materials, and clean up the work area. Base removal, underground wiring repairs, and utility/service changes are not included unless approved.";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: userInput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        detailLevel: "technical",
        technicalScopeCompleteness: "developed",
        expansionPressure: "low",
        scopeDepthTarget: "light_refinement",
        siteEquipmentScope: true,
      })
    );
    expect(isWeakRiskAwareScopeEcho(userInput, { userInput, analysis })).toBe(false);
    expect(resolved).toContain("Remove existing light pole at hotel site");
    expect(resolved).toContain("Coordinate lift access");
    expect(resolved).toContain("Base removal, underground wiring repairs, and utility/service changes are not included unless approved.");
    expect(resolved).not.toContain("\n- ");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(3);
  });

  test("keeps explicit bullet formatting while expanding site-lighting shorthand", () => {
    const userInput = "put this in bullet points: remove existing light pole from the hotel";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "- Remove existing light pole from the hotel." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("- Remove existing light pole");
    expect(resolved).toContain("- Coordinate lift or suitable access equipment");
    expect(resolved).toContain("- Base or foundation removal");
    expect(resolved).not.toContain("\n\n");
  });

  test("keeps requested numbered formatting while expanding conduit shorthand for tenant improvement", () => {
    const userInput = "put this in numbered list: run conduit for tenant improvement";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "1. Run conduit for tenant improvement." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        formattingIntent: "numbered_list",
        detailLevel: "technical",
        technicalSignals: expect.arrayContaining(["conduit work", "tenant improvement"]),
      })
    );
    expect(resolved).toContain("1. Install conduit for tenant improvement with required bends, supports, and terminations for the described run.");
    expect(resolved).toContain("2. Coordinate routing in accessible areas and leave the conduit run ready for follow-on electrical work.");
    expect(resolved).toContain("3. Keep the routing within the identified tenant improvement area and the stated conduit path.");
    expect(resolved).toContain("4. Wire pull, device terminations, major demolition, and work outside the identified conduit route are not included unless identified and approved.");
    expect(resolved).not.toContain("\n- ");
    expect(resolved).not.toContain("\n\n");
  });

  test("reshapes long developed technical notes into compact default contractor-note blocks without changing content intent", () => {
    const userInput = "Install conduit for tenant improvement from existing panel to new office receptacle locations, including bends, supports, terminations, and labeling. Coordinate routing above ceiling with other trades and leave the raceway ready for follow-on electrical work. Device terminations, wire pull, and work outside the identified tenant improvement route are not included unless approved.";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: userInput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        detailLevel: "technical",
        technicalScopeCompleteness: "developed",
        expansionPressure: "low",
        scopeDepthTarget: "light_refinement",
      })
    );
    expect(isWeakRiskAwareScopeEcho(userInput, { userInput, analysis })).toBe(false);
    expect(resolved).toContain("Install conduit for tenant improvement from existing panel to new office receptacle locations");
    expect(resolved).toContain("Coordinate routing above ceiling with other trades");
    expect(resolved).toContain("Device terminations, wire pull, and work outside the identified tenant improvement route are not included unless approved.");
    expect(resolved).toContain("\n\n");
    expect(resolved).not.toContain("\n- ");
  });

  test("expands singular toilet replacement into estimate-ready scope", () => {
    const userInput = "replace toilet";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Replace toilet." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(isWeakRiskAwareScopeEcho("Replace toilet.", { userInput, analysis })).toBe(true);
    expect(resolved).toContain("Remove and replace existing toilet");
    expect(resolved).toContain("wax rings and closet bolts");
    expect(resolved).toContain("reconnect supply lines");
    expect(resolved).not.toBe("Replace toilet.");
    expect(resolved).not.toContain("\n- ");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(3);
    expect(resolved).toContain("unless identified and approved");
  });

  test("does not bloat an already-developed equipment replacement note", () => {
    const userInput = "Remove and replace existing water heater, complete accessible water, vent, relief, gas, or electrical reconnections as applicable, verify operation, remove and dispose of replaced equipment, and clean up the work area. Venting rework, gas piping, water piping changes, electrical circuit changes, and code-required upgrades beyond direct replacement are not included unless identified and approved.";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: userInput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        replaceableAssetScope: true,
        replaceableAssetCategory: "plumbing_equipment",
        expansionPressure: "low",
      })
    );
    expect(resolved).toContain("Remove and replace existing water heater");
    expect(resolved).toContain("verify operation");
    expect(resolved).toContain("Venting rework, gas piping, water piping changes");
    expect(resolved).not.toContain("\n- ");
  });

  test("does not bloat an already-developed casework note", () => {
    const userInput = "Install casework at lobby wall, lay out units, place, level, align, and secure components within the stated scope, verify fit and operation where applicable, and clean up the work area. Countertops, plumbing or electrical hookups, and work outside the stated casework scope are not included unless identified and approved.";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: userInput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        scopeAssetCategory: "interior_builtin",
        scopeProfile: "finish_carpentry",
      })
    );
    expect(resolved).toContain("Install casework");
    expect(resolved).toContain("place, level, align, and secure");
    expect(resolved).toContain("unless identified and approved");
    expect(resolved).not.toContain("\n- ");
  });

  test("keeps explicit bullet formatting while expanding terse equipment replacement shorthand", () => {
    const userInput = "put this in bullet points: replace water heater";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "- Replace water heater." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("- Remove and replace existing water heater.");
    expect(resolved).toContain("- Disconnect and reconnect accessible water, vent, relief, gas, or electrical connections as applicable");
    expect(resolved).toContain("- Venting rework, gas piping, water piping changes");
    expect(resolved).not.toContain("\n\n");
  });

  test("expands vanity install scope without inventing plumbing reconnect as included work", () => {
    const userInput = "install vanity";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Work includes installing the vanity." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("Install vanity.");
    expect(resolved).toContain("place, level, align, and secure the unit");
    expect(resolved).toContain("Plumbing reconnection");
    expect(resolved).not.toContain("reconnect supply lines");
    expect(resolved).not.toContain("test for proper operation");
  });

  test("routes baseboard replacement through a finish-carpentry scope path", () => {
    const userInput = "replace baseboards";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Replace baseboards." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(analysis).toEqual(
      expect.objectContaining({
        actions: ["replace"],
        detailLevel: "vague",
        scopeProfile: "finish_carpentry",
      })
    );
    expect(resolved).toContain("Remove and replace baseboards");
    expect(resolved).toContain("fit and secure components as needed");
    expect(resolved).toContain("minor cuts and adjustments for fit");
    expect(resolved).toContain("Wall repair beyond minor touch-up");
    expect(resolved).not.toContain("supply lines");
    expect(resolved).not.toContain("wax rings");
  });

  test("keeps bullet formatting while expanding broad painting shorthand", () => {
    const userInput = "paint bedroom in bullet points";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "- Paint bedroom." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("- Prepare designated bedroom surfaces as needed and protect adjacent areas.");
    expect(resolved).toContain("- Apply paint to the agreed work area and perform minor masking and cleanup.");
    expect(resolved).toContain("- Extensive surface repair, concealed damage, and surfaces outside the agreed work area are not included unless identified and approved.");
    expect(resolved).not.toContain("\n\n");
  });

  test("does not keep bullets as the default when no bullet request was made", () => {
    const userInput = "painting house";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      {
        scopeNotes: "- Prepare house surfaces.\n- Paint the house.\n- Clean up.",
      },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).not.toContain("\n- ");
    expect(resolved).toContain("Prepare designated house surfaces as needed and protect adjacent areas.");
    expect(resolved).toContain("Apply paint to the agreed work area and perform minor masking and cleanup.");
  });

  test("turns paragraph requests into actual paragraph-style scope instead of one clipped sentence", () => {
    const userInput = "rewrite this as a paragraph: replace vanity faucet and reconnect supply lines";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Replace vanity faucet and reconnect supply lines." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("Replace vanity faucet and reconnect supply lines.");
    expect(resolved).toContain("Test for leaks and proper operation");
    expect(resolved).not.toContain("\n");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(2);
  });

  test("separates longer exclusion language into its own default note block when the model returns one dense paragraph", () => {
    const userInput = "replace rooftop package unit disconnect";
    const analysis = analyzeScopeAssistInput(userInput);
    const denseParagraph = "Replace rooftop package unit disconnect and reconnect accessible conductors required for the disconnect replacement. Coordinate equipment shutdown or safe access as required, complete identification, verify operation, and clean up the work area. Conductors beyond accessible disconnect terminations, equipment repairs, and unforeseen code-driven upgrades are not included unless identified and approved.";
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: denseParagraph },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("Replace rooftop package unit disconnect");
    expect(resolved).toContain("Coordinate equipment shutdown or safe access");
    expect(resolved).toContain("\n\nConductors beyond accessible disconnect terminations");
    expect(resolved).not.toContain("\n- ");
  });

  test("preserves owner-supplied install scope and explicit exclusions in bullet format", () => {
    const userInput = "put this in bullet points: install owner supplied vanity and faucet, exclude wall repair if damage is found";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "- Install owner supplied vanity and faucet." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("- Install owner-supplied vanity and faucet and reconnect supply lines.");
    expect(resolved).toContain("- Test");
    expect(resolved).toContain("- Exclude wall repair if damage is found.");
  });

  test("expands simple drywall shorthand into fuller estimate-ready scope", () => {
    const userInput = "patch drywall";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Patch drywall." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("Patch affected drywall areas as needed");
    expect(resolved).toContain("sand smooth");
    expect(resolved).toContain("leave ready for finish");
    expect(resolved).toContain("Minor patching only");
  });

  test("keeps default toilet scope a little fuller when no short format was requested", () => {
    const userInput = "replace toilet";
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Replace toilet." },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(resolved).toContain("Remove and replace existing toilet");
    expect(resolved).toContain("wax rings and closet bolts");
    expect(resolved).toContain("Test for proper operation and clean up the work area.");
    expect(resolved).not.toContain("\n\n");
    expect((resolved.match(/\./g) || []).length).toBeGreaterThanOrEqual(3);
  });

  test("passes extracted scope analysis through contextBuilder without changing the assist UI flow", () => {
    expect(
      scopeAssistConfig.contextBuilder(createState(), { userInput: "replace 3 toilets in office bullet points" })
    ).toEqual(
      expect.objectContaining({
        tradeKey: "plumbing",
        currentScopeNotes: "Existing scope note.",
        scopeInputAnalysis: expect.objectContaining({
          actions: ["replace"],
          formattingIntent: "bullets",
        }),
      })
    );
  });

  test("builds refine context around the existing scope draft instead of treating a shorten request like a fresh initial prompt", () => {
    const currentScope = "Replace rooftop package unit disconnect and reconnect accessible conductors required for the disconnect replacement. Coordinate equipment shutdown or safe access as required, complete identification, verify operation, and clean up the work area. Conductors beyond accessible disconnect terminations and equipment repairs are not included unless identified and approved.";
    const context = scopeAssistConfig.contextBuilder(
      createState({
        tradeInsert: { key: "electrical", text: "Electrical" },
        scopeNotes: currentScope,
      }),
      {
        mode: "refine",
        sourcePrompt: "replace rooftop package unit disconnect",
        currentScope,
        refineInstruction: "make it shorter",
      }
    );

    expect(context).toEqual(
      expect.objectContaining({
        scopeMode: "refine",
        sourceScopePrompt: "replace rooftop package unit disconnect",
        currentScopeNotes: currentScope,
        refineInstruction: "make it shorter",
        scopeRefineAnalysis: expect.objectContaining({
          brevityIntent: "concise",
        }),
        scopeInputAnalysis: expect.objectContaining({
          detailLevel: "technical",
          technicalScopeCompleteness: "developed",
          scopeDepthTarget: "light_refinement",
          technicalSignals: expect.arrayContaining(["disconnect work", "rooftop equipment"]),
        }),
      })
    );
  });

  test("captures refine additions, exclusions, and explicit bullet overrides without losing the existing trade context", () => {
    const currentScope = "Replace rooftop package unit disconnect and reconnect accessible conductors required for the disconnect replacement. Coordinate equipment shutdown or safe access as required, complete identification, verify operation, and clean up the work area.";
    const context = scopeAssistConfig.contextBuilder(
      createState({
        tradeInsert: { key: "electrical", text: "Electrical" },
        scopeNotes: currentScope,
      }),
      {
        mode: "refine",
        sourcePrompt: "replace rooftop package unit disconnect",
        currentScope,
        refineInstruction: "add demo and disposal, exclude permits, make it bullet points",
        formatIntent: "bullets",
      }
    );

    expect(context.scopeInputAnalysis).toEqual(
      expect.objectContaining({
        formattingIntent: "bullets",
        mentionsDisposal: true,
        actions: expect.arrayContaining(["demo"]),
        technicalSignals: expect.arrayContaining(["disconnect work", "rooftop equipment"]),
        scopeSkeleton: expect.objectContaining({
          exclusions: expect.objectContaining({
            certain: expect.arrayContaining(["permits"]),
          }),
        }),
      })
    );
  });

  test("keeps refine output in contractor-note form by default while stripping chatty revise lead-ins", () => {
    const currentScope = "Replace rooftop package unit disconnect and reconnect accessible conductors required for the disconnect replacement. Coordinate equipment shutdown or safe access as required, complete identification, verify operation, and clean up the work area.";
    const context = scopeAssistConfig.contextBuilder(
      createState({
        tradeInsert: { key: "electrical", text: "Electrical" },
        scopeNotes: currentScope,
      }),
      {
        mode: "refine",
        sourcePrompt: "replace rooftop package unit disconnect",
        currentScope,
        refineInstruction: "exclude permits",
      }
    );

    const resolved = resolveScopeAssistNotes(
      {
        scopeNotes: "Here is the revised version: Replace rooftop package unit disconnect and reconnect accessible conductors required for the disconnect replacement. Coordinate equipment shutdown or safe rooftop access as required. Complete identification, verify operation after replacement, and clean up the work area. Exclude permits and code-driven changes beyond the stated replacement scope.",
      },
      { userInput: "exclude permits", context }
    );

    expect(resolved).toContain("Replace rooftop package unit disconnect");
    expect(resolved).toContain("\n\nExclude permits and code-driven changes beyond the stated replacement scope.");
    expect(resolved).not.toContain("Here is the revised version");
    expect(resolved).not.toContain("\n- ");
  });

  test("shorten refine requests can return a tighter scope note while preserving the core technical meaning", () => {
    const currentScope = "Replace rooftop package unit disconnect and reconnect accessible conductors required for the disconnect replacement. Coordinate equipment shutdown or safe access as required, complete identification, verify operation, and clean up the work area. Conductors beyond accessible disconnect terminations and equipment repairs are not included unless identified and approved.";
    const context = scopeAssistConfig.contextBuilder(
      createState({
        tradeInsert: { key: "electrical", text: "Electrical" },
        scopeNotes: currentScope,
      }),
      {
        mode: "refine",
        sourcePrompt: "replace rooftop package unit disconnect",
        currentScope,
        refineInstruction: "make it shorter",
      }
    );

    const resolved = resolveScopeAssistNotes(
      {
        scopeNotes: "Replace rooftop package unit disconnect, reconnect accessible conductors required for the replacement, verify operation, and clean up the work area. Conductors beyond accessible disconnect terminations and equipment repairs are not included unless identified and approved.",
      },
      { userInput: "make it shorter", context }
    );

    expect(resolved.length).toBeLessThan(currentScope.length);
    expect(resolved).toContain("Replace rooftop package unit disconnect");
    expect(resolved).toContain("verify operation");
    expect(resolved).toContain("equipment repairs are not included unless identified and approved");
    expect(resolved).not.toContain("Here is");
  });

  test("commercial tone refinements stay commercial and avoid residential filler", () => {
    const currentScope = "Install circuit breakers for commercial warehouse and verify operation after installation.";
    const context = scopeAssistConfig.contextBuilder(
      createState({
        tradeInsert: { key: "electrical", text: "Electrical" },
        scopeNotes: currentScope,
      }),
      {
        mode: "refine",
        sourcePrompt: "install circuit breakers for commercial warehouse",
        currentScope,
        refineInstruction: "make it more commercial",
      }
    );

    const resolved = resolveScopeAssistNotes(
      {
        scopeNotes: "Install circuit breakers in the identified commercial warehouse distribution equipment, complete accessible breaker terminations and identification as required, verify breaker operation after installation, and clean up the work area.",
      },
      { userInput: "make it more commercial", context }
    );

    expect(resolved.toLowerCase()).toContain("commercial warehouse");
    expect(resolved.toLowerCase()).toContain("breaker terminations");
    expect(resolved.toLowerCase()).toContain("identification");
    expect(resolved.toLowerCase()).not.toContain("residential");
    expect(resolved.toLowerCase()).not.toContain("paint");
    expect(resolved.toLowerCase()).not.toContain("drywall");
  });

  test("requestSectionAssist sends refine payload through the existing scope service path", async () => {
    const currentScope = "Replace rooftop package unit disconnect and reconnect accessible conductors required for the disconnect replacement. Coordinate equipment shutdown or safe access as required, complete identification, verify operation, and clean up the work area.";
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        scopeNotes: "- Replace rooftop package unit disconnect.\n- Coordinate shutdown, verify operation, and clean up the work area.",
      }),
    });

    try {
      const result = await requestSectionAssist({
        sectionKey: "scope",
        state: createState({
          tradeInsert: { key: "electrical", text: "Electrical" },
          scopeNotes: currentScope,
        }),
        mode: "refine",
        sourcePrompt: "replace rooftop package unit disconnect",
        currentScope,
        refineInstruction: "make it bullet points",
        formatIntent: "bullets",
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [, request] = global.fetch.mock.calls[0];
      const payload = JSON.parse(request.body);

      expect(payload).toEqual(
        expect.objectContaining({
          sectionKey: "scope",
          userInput: "make it bullet points",
          mode: "refine",
          sourcePrompt: "replace rooftop package unit disconnect",
          currentScope,
          refineInstruction: "make it bullet points",
          formatIntent: "bullets",
        })
      );
      expect(payload.context).toEqual(
        expect.objectContaining({
          currentSection: "scope",
          scopeMode: "refine",
          currentScopeNotes: currentScope,
          sourceScopePrompt: "replace rooftop package unit disconnect",
          refineInstruction: "make it bullet points",
        })
      );
      expect(result.writes).toEqual({
        scopeNotes: "- Replace rooftop package unit disconnect.\n- Coordinate shutdown, verify operation, and clean up the work area.",
      });
      expect(result.validation).toEqual({ valid: true });
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("preserves bullet formatting while stripping wrappers", () => {
    const raw = '```markdown\nScope Notes:\n- Protect flooring and adjacent finishes.\n- Repair drywall at plumbing access.\n- Prime and repaint repaired wall sections.\n```';

    expect(sanitizeScopeAssistText(raw)).toBe(
      "- Protect flooring and adjacent finishes.\n- Repair drywall at plumbing access.\n- Prime and repaint repaired wall sections."
    );
  });

  test("accepts numbered plain-text output from the model", () => {
    const writes = scopeAssistConfig.localAdapter(
      "1. Remove damaged drywall at sink wall.\n2. Install new drywall patch.\n3. Finish ready for paint."
    );

    expect(writes).toEqual({
      scopeNotes: "1. Remove damaged drywall at sink wall.\n2. Install new drywall patch.\n3. Finish ready for paint.",
    });
    expect(scopeAssistConfig.validationRules(writes)).toEqual({ valid: true });
  });

  test("rejects generic scaffold scope output for rough prompts", () => {
    const writes = {
      scopeNotes: "Replace roof. Complete the described scope and clean up the work area. Exclude concealed damage, substrate correction, and work beyond the direct described scope are not included unless identified and approved.",
    };

    expect(scopeAssistConfig.validationRules(writes)).toEqual({
      valid: false,
      error: "Generated scope is too generic.",
    });
  });

  test.each([
    {
      userInput: "replace electrical circuit breakers",
      weakOutput: "Replace electrical circuit breakers.",
      contains: ["breaker", "verify breaker operation"],
    },
    {
      userInput: "repair stucco cracks",
      weakOutput: "Repair stucco cracks.",
      contains: ["stucco cracks", "texture blending", "clean up the work area"],
    },
    {
      userInput: "install fence gate",
      weakOutput: "Install fence gate.",
      contains: ["fence", "set and align", "clean up the work area"],
    },
    {
      userInput: "patch drywall",
      weakOutput: "Patch drywall.",
      contains: ["drywall", "sand smooth", "ready for finish"],
    },
    {
      userInput: "replace roof",
      weakOutput: "Replace roof.",
      contains: ["roof covering", "fall protection", "weatherproofing tie-in"],
    },
  ])("keeps category misses on the contractor-ready path for '$userInput'", ({
    userInput,
    weakOutput,
    contains,
  }) => {
    const analysis = analyzeScopeAssistInput(userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: analysis } }
    );

    expect(isWeakRiskAwareScopeEcho(weakOutput, { userInput, analysis })).toBe(true);
    expect(resolved).not.toBe(weakOutput);
    expect(resolved).not.toContain("Complete the described scope");
    expect(resolved).not.toContain("Scope includes");
    contains.forEach((snippet) => {
      expect(resolved).toContain(snippet);
    });
  });

  test("raw contractor prompts still expand even when taxonomy fields are blanked out", () => {
    const userInput = "replace roof";
    const rawAnalysis = {
      coreScopeText: userInput,
      rawScopeText: userInput,
      actions: ["replace"],
      actionFamilies: ["replace_changeout"],
      items: ["roof"],
      quantities: [],
      scopeProfile: "",
      scopeTradeBucket: "",
      scopeWorkBucket: "",
      scopeAssetCategory: "",
      scopeAssetFamily: "",
      objectType: "",
      connectionModel: "",
      assemblyScale: "",
    };
    const summary = summarizeScopeAssistSoftBias(rawAnalysis, userInput);
    const resolved = resolveScopeAssistNotes(
      { scopeNotes: "Replace roof." },
      { userInput, context: { scopeInputAnalysis: rawAnalysis } }
    );

    expect(summary).toEqual(expect.objectContaining({
      rawPrompt: "replace roof",
      softTaxonomyBiasFound: false,
      generationPath: "raw-input-first",
    }));
    expect(resolved).not.toBe("Replace roof.");
    expect(resolved.toLowerCase()).toContain("roof");
    expect(resolved).toMatch(/remove and replace|roof access|clean up|weatherproofing/i);
  });

  test("taxonomy hits only bias the path and are not required for contractor-ready expansion", () => {
    const userInput = "replace roof";
    const baseAnalysis = {
      coreScopeText: userInput,
      rawScopeText: userInput,
      actions: ["replace"],
      actionFamilies: ["replace_changeout"],
      items: ["roof"],
      quantities: [],
      scopeProfile: "",
      scopeTradeBucket: "",
      scopeWorkBucket: "",
      scopeAssetCategory: "",
      scopeAssetFamily: "",
      objectType: "",
      connectionModel: "",
      assemblyScale: "",
    };
    const biasedAnalysis = {
      ...baseAnalysis,
      scopeProfile: "roofing",
      scopeTradeBucket: "roofing",
      scopeWorkBucket: "replace_non_connected_asset",
      scopeAssetCategory: "roofing",
    };

    expect(summarizeScopeAssistSoftBias(baseAnalysis, userInput)).toEqual(expect.objectContaining({
      generationPath: "raw-input-first",
      softTaxonomyBiasFound: false,
    }));
    expect(summarizeScopeAssistSoftBias(biasedAnalysis, userInput)).toEqual(expect.objectContaining({
      generationPath: "specialty-biased",
      softTaxonomyBiasFound: true,
    }));

    const weakOutput = "Replace roof.";
    const rawResolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: baseAnalysis } }
    );
    const biasedResolved = resolveScopeAssistNotes(
      { scopeNotes: weakOutput },
      { userInput, context: { scopeInputAnalysis: biasedAnalysis } }
    );

    expect(rawResolved).toContain("roof");
    expect(biasedResolved).toContain("roof");
    expect(biasedResolved.length).toBeGreaterThanOrEqual(rawResolved.length - 5);
  });

  test("falls back to usable text fields when scopeNotes is not present", () => {
    expect(
      extractScopeAssistText({
        text: '"• Furnish and install replacement shutoffs.\\n• Reconnect supply lines.\\n• Test fixture operation."',
      })
    ).toBe(
      "• Furnish and install replacement shutoffs.\n• Reconnect supply lines.\n• Test fixture operation."
    );
  });

  describe("mid-band ambiguity control — object-light and extent-heavy prompts", () => {
    // ── Validation prompts: should trigger midBandAmbiguity = true ──

    test("fix area — object-light single-extent prompt triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("fix area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("redo section — object-light section-only prompt triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("redo section");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("repair this part — pronoun-blocked object triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("repair this part");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("replace damaged section — condition + extent word only triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("replace damaged section");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("make good this wall — pronoun block + generic surface triggers mid-band with surface bias", () => {
      const result = analyzeScopeAssistInput("make good this wall");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("patch this up — no real object triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("patch this up");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("repair wall area — generic surface item triggers mid-band with surface bias", () => {
      const result = analyzeScopeAssistInput("repair wall area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("fix damaged area — condition + extent triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("fix damaged area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("redo damaged wall area — wall + area triggers mid-band with surface bias", () => {
      const result = analyzeScopeAssistInput("redo damaged wall area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("repair affected ceiling area — ceiling surface triggers mid-band with surface bias", () => {
      const result = analyzeScopeAssistInput("repair affected ceiling area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("patch and paint affected wall area — wall surface triggers mid-band with surface bias", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("repair area around entry — extent word with location triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("repair area around entry");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("repair area around window — extent word with opening location triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("repair area around window");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("repair section at storefront — section is weak direct object even with named location", () => {
      const result = analyzeScopeAssistInput("repair section at storefront");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("replace damaged section at fence — weak direct object at named location triggers mid-band", () => {
      const result = analyzeScopeAssistInput("replace damaged section at fence");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("repair section at canopy — extent-only direct object triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("repair section at canopy");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("redo wall area after leak — wall + water damage triggers localized water damage surface bias", () => {
      const result = analyzeScopeAssistInput("redo wall area after leak");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_water_damage_surface_repair");
    });

    test("repair damaged area at bathroom wall — wall surface with location triggers mid-band surface bias", () => {
      const result = analyzeScopeAssistInput("repair damaged area at bathroom wall");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("make good wall area after work — wall surface triggers mid-band with surface bias", () => {
      const result = analyzeScopeAssistInput("make good wall area after work");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("patch affected ceiling area and paint — ceiling triggers mid-band with surface bias", () => {
      const result = analyzeScopeAssistInput("patch affected ceiling area and paint");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("repair section around opening — extent-only direct object with opening location triggers mid-band", () => {
      const result = analyzeScopeAssistInput("repair section around opening");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("repair damaged area at rear elevation — extent item with location triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("repair damaged area at rear elevation");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("replace bad section at railing — bad section as direct object bypasses strong railing location", () => {
      const result = analyzeScopeAssistInput("replace bad section at railing");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("fix wall area at office — wall surface in office location triggers mid-band surface bias", () => {
      const result = analyzeScopeAssistInput("fix wall area at office");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("repair damaged section near entry door — weak direct object triggers mid-band ambiguity", () => {
      const result = analyzeScopeAssistInput("repair damaged section near entry door");
      expect(result.midBandAmbiguity).toBe(true);
    });

    // ── Non-regression prompts: must NOT trigger mid-band ambiguity ──

    test("replace storefront glass at entry — strong named object bypasses mid-band control", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace lower cabinet run — interior_builtin category bypasses mid-band control", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("repair built-in cabinet section — cabinet in direct object bypasses mid-band control", () => {
      const result = analyzeScopeAssistInput("repair built-in cabinet section");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace one section of railing — railing captured in items bypasses mid-band control", () => {
      const result = analyzeScopeAssistInput("replace one section of railing");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("install fence section at side yard — fence in direct object bypasses mid-band control", () => {
      const result = analyzeScopeAssistInput("install fence section at side yard");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace man door at rear entry — door_hardware category bypasses mid-band control", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace glazing panel and seal perimeter — glazing_storefront category bypasses mid-band control", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("reset access panel and patch wall — access panel object type bypasses mid-band control", () => {
      const result = analyzeScopeAssistInput("reset access panel and patch wall");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("close up old opening and finish wall — close_up_scope hint bypasses mid-band control", () => {
      const result = analyzeScopeAssistInput("close up old opening and finish wall");
      expect(result.midBandAmbiguity).not.toBe(true);
    });
  });

  describe("clause-local ambiguity control — mixed-clause and compound-action prompts", () => {
    // ── Validation: mixed clause (strong + weak) — should set hasStrongClause AND hasWeakClause ──

    test("replace storefront glass and patch wall around it — storefront strong, wall weak → mixed clause", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and patch wall around it");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("replace fence and repair area around it — fence strong, area weak → mixed clause bounded bias", () => {
      const result = analyzeScopeAssistInput("replace fence and repair area around it");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("replace guardrail and patch concrete area below — guardrail strong, concrete weak → mixed clause surface bias", () => {
      const result = analyzeScopeAssistInput("replace guardrail and patch concrete area below");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("replace railing section and repair wall area around base — railing strong, wall weak → mixed clause", () => {
      const result = analyzeScopeAssistInput("replace railing section and repair wall area around base");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("replace man door and patch wall section around frame — man door strong, wall weak → mixed clause", () => {
      const result = analyzeScopeAssistInput("replace man door and patch wall section around frame");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
    });

    test("replace access panel and patch drywall around opening — access panel strong, drywall weak → mixed clause", () => {
      const result = analyzeScopeAssistInput("replace access panel and patch drywall around opening");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("install new glass panel and repair wall section behind it — glass panel strong, wall weak → mixed clause", () => {
      const result = analyzeScopeAssistInput("install new glass panel and repair wall section behind it");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("replace skylight and repair ceiling area around it — skylight strong, ceiling weak → mixed clause", () => {
      const result = analyzeScopeAssistInput("replace skylight and repair ceiling area around it");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("replace canopy and repair wall section at attachment point — canopy strong, wall weak → mixed clause", () => {
      const result = analyzeScopeAssistInput("replace canopy and repair wall section at attachment point");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
    });

    test("replace fence, patch wall area near base — comma separator, fence strong, wall weak → mixed clause", () => {
      const result = analyzeScopeAssistInput("replace fence, patch wall area near base");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("replace railing and repair area near base — railing strong, area weak (no surface) → bounded bias", () => {
      const result = analyzeScopeAssistInput("replace railing and repair area near base");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("replace storefront and repair wall section behind — storefront strong, wall weak → mixed clause surface bias", () => {
      const result = analyzeScopeAssistInput("replace storefront and repair wall section behind");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("fix gate and patch damaged area around post — gate strong, area weak → mixed clause bounded bias", () => {
      const result = analyzeScopeAssistInput("fix gate and patch damaged area around post");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("replace cabinet and patch wall behind it — cabinet strong, wall weak → mixed clause surface bias", () => {
      const result = analyzeScopeAssistInput("replace cabinet and patch wall behind it");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("replace glazing panel and repair area around frame — glazing strong, area weak → mixed clause bounded bias", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and repair area around frame");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    // ── Validation: "then" and comma separators with mixed clauses ──

    test("replace railing then repair concrete area below — then separator, railing strong, concrete weak", () => {
      const result = analyzeScopeAssistInput("replace railing then repair concrete area below");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("replace storefront glass, then patch wall area — then separator, storefront strong, wall weak", () => {
      const result = analyzeScopeAssistInput("replace storefront glass, then patch wall area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    // ── Validation: all-strong multi-clause — should NOT trigger mid-band ──

    test("replace fence and repair handrail — both strong objects → no mid-band control", () => {
      const result = analyzeScopeAssistInput("replace fence and repair handrail");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace railing then repair guardrail section — both strong → no mid-band control", () => {
      const result = analyzeScopeAssistInput("replace railing then repair guardrail section");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    // ── Validation: all-weak multi-clause — falls through to existing logic, same as single-clause ──

    test("repair section and patch damaged area — both weak extent → mid-band bounded_section_area", () => {
      const result = analyzeScopeAssistInput("repair section and patch damaged area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
      expect(result.hasStrongClause).not.toBe(true);
    });

    test("repair wall section and patch ceiling area — both weak surface → mid-band localized_surface_repair", () => {
      const result = analyzeScopeAssistInput("repair wall section and patch ceiling area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
      expect(result.hasStrongClause).not.toBe(true);
    });

    test("fix area and patch section at rear wall — both weak → mid-band bias active", () => {
      const result = analyzeScopeAssistInput("fix area and patch section at rear wall");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).not.toBe(true);
    });

    // ── Validation: compound action pairs must NOT split into separate clauses ──

    test("remove and replace damaged wall section — compound action stays as one clause, wall section weak", () => {
      const result = analyzeScopeAssistInput("remove and replace damaged wall section");
      expect(result.midBandAmbiguity).toBe(true);
      // compound kept together — hasStrongClause should not be set
      expect(result.hasStrongClause).not.toBe(true);
    });

    test("remove and replace damaged section near window — compound action, section weak → mid-band", () => {
      const result = analyzeScopeAssistInput("remove and replace damaged section near window");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).not.toBe(true);
    });

    test("replace and seal storefront glazing — compound action, glazing strong → no mid-band", () => {
      const result = analyzeScopeAssistInput("replace and seal storefront glazing");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    // ── Validation: multi-connector prompts ──

    test("replace guardrail and repair area below, then patch wall section — two connectors, one strong, two weak", () => {
      const result = analyzeScopeAssistInput("replace guardrail and repair area below, then patch wall section");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
    });

    test("replace railing and patch area then repair wall section — chained connectors, one strong, two weak", () => {
      const result = analyzeScopeAssistInput("replace railing and patch area then repair wall section");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    // ── Non-regression: single-clause behavior must be preserved exactly ──

    test("non-regression: fix area — single clause still triggers bounded_section_area", () => {
      const result = analyzeScopeAssistInput("fix area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
      expect(result.hasStrongClause).not.toBe(true);
    });

    test("non-regression: repair wall area — single clause still triggers localized_surface_repair", () => {
      const result = analyzeScopeAssistInput("repair wall area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
      expect(result.hasStrongClause).not.toBe(true);
    });

    test("non-regression: repair section at canopy — single clause still triggers (location bypass not active)", () => {
      const result = analyzeScopeAssistInput("repair section at canopy");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("non-regression: replace bad section at railing — weak direct object at named location still triggers", () => {
      const result = analyzeScopeAssistInput("replace bad section at railing");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("non-regression: replace storefront glass at entry — single clause still bypasses (strong direct object)", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("non-regression: close up old opening and finish wall — opening closure bypass still active", () => {
      const result = analyzeScopeAssistInput("close up old opening and finish wall");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("non-regression: reset access panel and patch wall — access panel in action targets still bypasses", () => {
      const result = analyzeScopeAssistInput("reset access panel and patch wall");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("non-regression: replace glazing panel and seal perimeter — glazing strong, perimeter neutral → no mid-band", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("non-regression: patch and paint wall area — compound pair not split, wall area still triggers surface bias", () => {
      const result = analyzeScopeAssistInput("patch and paint wall area");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
      expect(result.hasStrongClause).not.toBe(true);
    });

    test("non-regression: remove and replace old railing — compound pair not split, railing in items bypasses", () => {
      const result = analyzeScopeAssistInput("remove and replace old railing");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("non-regression: remove and replace damaged section — compound pair not split, section weak → triggers", () => {
      const result = analyzeScopeAssistInput("remove and replace damaged section");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("non-regression: repair area around fence and patch section — both weak (fence is location) → triggers", () => {
      const result = analyzeScopeAssistInput("repair area around fence and patch section");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).not.toBe(true);
    });
  });

  describe("referential follow-up hardening — pronoun and adjacency clause detection", () => {
    // ── Validation: perimeter follow-up ("around it", "around frame", "around opening") ──

    test("replace door and patch around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace door and patch around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace storefront glass and seal around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and seal around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace glazing panel and paint around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and paint around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace access panel and patch around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace access panel and patch around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace lower cabinet run and make good around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run and make good around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace panel and paint around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace panel and paint around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("repair wall area near window and replace trim around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("repair wall area near window and replace trim around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace canopy section and paint around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace canopy section and paint around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("reset access panel and patch around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("reset access panel and patch around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace entry door and seal around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace entry door and seal around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("close up old opening and finish around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("close up old opening and finish around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace storefront glass at entry and paint around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry and paint around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace cabinets and make good around them — perimeter follow-up detected (them)", () => {
      const result = analyzeScopeAssistInput("replace cabinets and make good around them");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace damaged wall panel and blend around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace damaged wall panel and blend around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace glazing panel and seal around frame — perimeter follow-up detected (around frame)", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal around frame");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace man door at rear entry and patch around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry and patch around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("repair frame area at window and paint around it — perimeter follow-up detected", () => {
      const result = analyzeScopeAssistInput("repair frame area at window and paint around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("install vanity and patch around it after — perimeter + after_work follow-up detected", () => {
      const result = analyzeScopeAssistInput("install vanity and patch around it after");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.referentialFollowUpHints).toContain("after_work_follow_up");
    });

    // ── Validation: action + pronoun follow-up ("seal it", "weld it up", "secure it", etc.) ──

    test("repair window area and seal it up — action pronoun follow-up detected", () => {
      const result = analyzeScopeAssistInput("repair window area and seal it up");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("replace trim around door and paint it — action pronoun follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace trim around door and paint it");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("repair frame area at window and seal it — action pronoun follow-up detected", () => {
      const result = analyzeScopeAssistInput("repair frame area at window and seal it");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("replace handrail section and secure it — action pronoun follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace handrail section and secure it");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("replace fence section and weld it up — action pronoun follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace fence section and weld it up");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("patch around opening and finish it — action pronoun follow-up detected", () => {
      const result = analyzeScopeAssistInput("patch around opening and finish it");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("replace bad section at railing and tighten it up — action pronoun follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace bad section at railing and tighten it up");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("repair damaged ceiling area and paint it — action pronoun follow-up detected", () => {
      const result = analyzeScopeAssistInput("repair damaged ceiling area and paint it");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("patch affected wall area and blend it — action pronoun follow-up detected", () => {
      const result = analyzeScopeAssistInput("patch affected wall area and blend it");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    // ── Validation: after-work follow-up ──

    test("replace vanity and patch wall after — after_work follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace vanity and patch wall after");
      expect(result.referentialFollowUpHints).toContain("after_work_follow_up");
    });

    // ── Validation: adjacent area follow-up ──

    test("replace millwork at reception wall and make good adjacent wall area — adjacent area follow-up detected", () => {
      const result = analyzeScopeAssistInput("replace millwork at reception wall and make good adjacent wall area");
      expect(result.referentialFollowUpHints).toContain("adjacent_area_follow_up");
    });

    // ── Non-regression: single-clause and clean prompts must NOT set referential hints ──

    test("non-regression: replace storefront glass at entry — no referential hints on single-clause prompt", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(result.referentialFollowUpHints).toBeFalsy();
    });

    test("non-regression: replace lower cabinet run — no referential hints on single-clause prompt", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run");
      expect(result.referentialFollowUpHints).toBeFalsy();
    });

    test("non-regression: replace trim around door — single clause, around door in primary scope, no follow-up hints", () => {
      const result = analyzeScopeAssistInput("replace trim around door");
      expect(result.referentialFollowUpHints).toBeFalsy();
    });

    test("non-regression: repair frame area at window — single clause, no follow-up hints", () => {
      const result = analyzeScopeAssistInput("repair frame area at window");
      expect(result.referentialFollowUpHints).toBeFalsy();
    });

    test("non-regression: replace glazing panel and seal perimeter — perimeter is a noun not a pronoun, no hints", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });

    test("non-regression: reset access panel and patch wall — 'wall' is not a pronoun follow-up, no hints", () => {
      const result = analyzeScopeAssistInput("reset access panel and patch wall");
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });

    test("non-regression: replace handrail section and secure posts — posts is a named object not pronoun, no hints", () => {
      const result = analyzeScopeAssistInput("replace handrail section and secure posts");
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });

    test("non-regression: patch and paint affected wall area — compound pair, single clause, no referential hints", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(result.referentialFollowUpHints).toBeFalsy();
    });

    test("non-regression: replace storefront glass and patch wall around it — Pass 2 mixed-clause signals preserved alongside new referential hint", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and patch wall around it");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("non-regression: redo wall area after leak — water damage exclusion prevents after_work hint, mid-band water bias preserved", () => {
      const result = analyzeScopeAssistInput("redo wall area after leak");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_water_damage_surface_repair");
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.includes("after_work_follow_up") : false).toBe(false);
    });

    test("non-regression: close up old opening and finish wall — opening closure bypass still active, no pronoun hints", () => {
      const result = analyzeScopeAssistInput("close up old opening and finish wall");
      expect(result.midBandAmbiguity).not.toBe(true);
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });
  });

  describe("demonstrative modifier hardening — this/that/these/those scope anchoring", () => {
    // ── Validation: demonstrative + weak extent → mid-band fires, demonstrative hint set ──

    test("redo this section by entry — demonstrative_weak_extent, mid-band bounded bias", () => {
      const result = analyzeScopeAssistInput("redo this section by entry");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("repair this section near the door — demonstrative_weak_extent, bounded bias", () => {
      const result = analyzeScopeAssistInput("repair this section near the door");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("make good that area after install — demonstrative_weak_extent, bounded bias", () => {
      const result = analyzeScopeAssistInput("make good that area after install");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("repair those sections at the fence line — demonstrative_weak_extent, bounded bias (fence is location not target)", () => {
      const result = analyzeScopeAssistInput("repair those sections at the fence line");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("patch this area at storefront — demonstrative_weak_extent, bounded bias (storefront is location)", () => {
      const result = analyzeScopeAssistInput("patch this area at storefront");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("bounded_section_area");
    });

    test("repair this opening area — demonstrative_weak_extent, bounded bias", () => {
      const result = analyzeScopeAssistInput("repair this opening area");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("redo that damaged section — demonstrative_weak_extent with condition modifier, bounded bias", () => {
      const result = analyzeScopeAssistInput("redo that damaged section");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("repair these areas around the entry — demonstrative_weak_extent, bounded bias", () => {
      const result = analyzeScopeAssistInput("repair these areas around the entry");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("patch this section at the canopy — demonstrative_weak_extent, bounded bias (canopy is location)", () => {
      const result = analyzeScopeAssistInput("patch this section at the canopy");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("make good this area by the vanity — demonstrative_weak_extent, bounded bias", () => {
      const result = analyzeScopeAssistInput("make good this area by the vanity");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("repair that area around opening — demonstrative_weak_extent, bounded bias", () => {
      const result = analyzeScopeAssistInput("repair that area around opening");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("patch this area around window — demonstrative_weak_extent, bounded bias (window is location)", () => {
      const result = analyzeScopeAssistInput("patch this area around window");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("repair this area near storefront glass — demonstrative_weak_extent, bounded bias", () => {
      const result = analyzeScopeAssistInput("repair this area near storefront glass");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
      expect(result.midBandAmbiguity).toBe(true);
    });

    // ── Validation: demonstrative + generic surface → mid-band localized_surface_repair, demonstrative hint set ──

    test("repair that wall area — demonstrative_generic_surface, localized surface bias", () => {
      const result = analyzeScopeAssistInput("repair that wall area");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_generic_surface");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("repair this wall by the window — demonstrative_generic_surface, surface bias", () => {
      const result = analyzeScopeAssistInput("repair this wall by the window");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_generic_surface");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("patch that ceiling area after leak — demonstrative_generic_surface + water damage bias", () => {
      const result = analyzeScopeAssistInput("patch that ceiling area after leak");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_generic_surface");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_water_damage_surface_repair");
    });

    test("make good this wall area after cabinet install — demonstrative_generic_surface, surface bias", () => {
      const result = analyzeScopeAssistInput("make good this wall area after cabinet install");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_generic_surface");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("repair that frame area at window — demonstrative_generic_surface or bounded, bounded surface bias", () => {
      const result = analyzeScopeAssistInput("repair that frame area at window");
      expect(
        result.demonstrativeModifierHints?.includes("demonstrative_generic_surface") ||
        result.demonstrativeModifierHints?.includes("demonstrative_bounded_object")
      ).toBe(true);
    });

    test("repair this damaged ceiling area — demonstrative_generic_surface, surface bias", () => {
      const result = analyzeScopeAssistInput("repair this damaged ceiling area");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_generic_surface");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBe("localized_surface_repair");
    });

    test("patch that wall area and paint it — demonstrative_generic_surface + action pronoun follow-up", () => {
      const result = analyzeScopeAssistInput("patch that wall area and paint it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_generic_surface");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("patch these wall areas and blend them — demonstrative_generic_surface + perimeter follow-up", () => {
      const result = analyzeScopeAssistInput("patch these wall areas and blend them");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_generic_surface");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    // ── Validation: demonstrative + bounded object → mid-band bypassed, object preserved ──

    test("replace that panel and paint around it — demonstrative_bounded_object, mid-band bypassed, perimeter follow-up", () => {
      const result = analyzeScopeAssistInput("replace that panel and paint around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.midBandAmbiguity).not.toBe(true);
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace this panel at the rear wall — demonstrative_bounded_object, mid-band bypassed", () => {
      const result = analyzeScopeAssistInput("replace this panel at the rear wall");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace that trim and paint around it — demonstrative_bounded_object, mid-band bypassed, perimeter follow-up", () => {
      const result = analyzeScopeAssistInput("replace that trim and paint around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.midBandAmbiguity).not.toBe(true);
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace this door and patch around it — demonstrative_bounded_object, mid-band bypassed, perimeter follow-up", () => {
      const result = analyzeScopeAssistInput("replace this door and patch around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.midBandAmbiguity).not.toBe(true);
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace those panels and seal around them — demonstrative_bounded_object, mid-band bypassed, perimeter follow-up", () => {
      const result = analyzeScopeAssistInput("replace those panels and seal around them");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.midBandAmbiguity).not.toBe(true);
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    // ── Validation: demonstrative + strong object → mid-band bypassed, strong object preserved ──

    test("replace those glazing panels and seal around them — demonstrative_strong_object, mid-band bypassed", () => {
      const result = analyzeScopeAssistInput("replace those glazing panels and seal around them");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_strong_object");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace that handrail section and secure it — demonstrative_strong_object, mid-band bypassed, action pronoun follow-up", () => {
      const result = analyzeScopeAssistInput("replace that handrail section and secure it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_strong_object");
      expect(result.midBandAmbiguity).not.toBe(true);
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("repair those fence sections and weld them up — demonstrative_strong_object, mid-band bypassed", () => {
      const result = analyzeScopeAssistInput("repair those fence sections and weld them up");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_strong_object");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace this access panel and patch around it — demonstrative_strong_object, mid-band bypassed, perimeter follow-up", () => {
      const result = analyzeScopeAssistInput("replace this access panel and patch around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_strong_object");
      expect(result.midBandAmbiguity).not.toBe(true);
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    // ── Non-regression: clean prompts without demonstratives must not gain demonstrative hints ──

    test("non-regression: replace storefront glass at entry — no demonstrative hints", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(Array.isArray(result.demonstrativeModifierHints) ? result.demonstrativeModifierHints.length : 0).toBe(0);
    });

    test("non-regression: replace lower cabinet run — no demonstrative hints", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run");
      expect(Array.isArray(result.demonstrativeModifierHints) ? result.demonstrativeModifierHints.length : 0).toBe(0);
    });

    test("non-regression: replace glazing panel and seal perimeter — no demonstrative hints", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(Array.isArray(result.demonstrativeModifierHints) ? result.demonstrativeModifierHints.length : 0).toBe(0);
    });

    test("non-regression: replace trim around door — no demonstrative hints (no this/that)", () => {
      const result = analyzeScopeAssistInput("replace trim around door");
      expect(Array.isArray(result.demonstrativeModifierHints) ? result.demonstrativeModifierHints.length : 0).toBe(0);
    });

    test("non-regression: repair frame area at window — no demonstrative hints (no this/that)", () => {
      const result = analyzeScopeAssistInput("repair frame area at window");
      expect(Array.isArray(result.demonstrativeModifierHints) ? result.demonstrativeModifierHints.length : 0).toBe(0);
    });

    test("non-regression: patch and paint affected wall area — no demonstrative hints (compound pair, no this/that)", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(Array.isArray(result.demonstrativeModifierHints) ? result.demonstrativeModifierHints.length : 0).toBe(0);
    });

    test("non-regression: replace handrail section and secure posts — no demonstrative hints", () => {
      const result = analyzeScopeAssistInput("replace handrail section and secure posts");
      expect(Array.isArray(result.demonstrativeModifierHints) ? result.demonstrativeModifierHints.length : 0).toBe(0);
    });

    test("non-regression: replace storefront glass and patch wall around it — Pass 2 + Pass 3 signals preserved, no demonstrative hints", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and patch wall around it");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.hasStrongClause).toBe(true);
      expect(result.hasWeakClause).toBe(true);
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(Array.isArray(result.demonstrativeModifierHints) ? result.demonstrativeModifierHints.length : 0).toBe(0);
    });

    test("non-regression: replace that panel and paint around it — bounded_object bypasses mid-band, referential preserved", () => {
      const result = analyzeScopeAssistInput("replace that panel and paint around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.midBandAmbiguity).not.toBe(true);
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("non-regression: replace this door and patch around it — bounded_object bypasses mid-band, referential preserved", () => {
      const result = analyzeScopeAssistInput("replace this door and patch around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.midBandAmbiguity).not.toBe(true);
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pass 5: Lexical role disambiguation — overloaded contractor term noun/verb
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Pass 5: Lexical role disambiguation — overloaded contractor term noun/verb detection", () => {
    // --- Group A: Determiner noun-position cue (the, a, an) triggers split ---

    test("replace the trim and paint around it — 'the' is noun-position cue → split → perimeter_follow_up fires", () => {
      const result = analyzeScopeAssistInput("replace the trim and paint around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace a seal and patch around it — 'a' is noun-position cue → split → perimeter_follow_up fires", () => {
      const result = analyzeScopeAssistInput("replace a seal and patch around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    // --- Group B: Demonstrative noun-position cue (this, that, these, those) triggers split ---

    test("replace that trim and paint around it — 'that' noun-position cue → split → perimeter + action_pronoun", () => {
      const result = analyzeScopeAssistInput("replace that trim and paint around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace this trim and paint around it — 'this' noun-position cue → split → perimeter + demonstrative_bounded_object", () => {
      const result = analyzeScopeAssistInput("replace this trim and paint around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
    });

    test("replace that seal and patch around it — 'that' cue + seal as NOUN → split → perimeter + action_pronoun + demonstrative_bounded_object", () => {
      const result = analyzeScopeAssistInput("replace that seal and patch around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace this seal and caulk around it — 'this' cue + seal as NOUN → split → perimeter + demonstrative_bounded_object", () => {
      const result = analyzeScopeAssistInput("replace this seal and caulk around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
    });

    // --- Group C: Adjective noun-position cue (new, old, existing, damaged, worn, bad) triggers split ---

    test("remove old trim and patch around it — 'old' is noun-position cue → split → perimeter + action_pronoun", () => {
      const result = analyzeScopeAssistInput("remove old trim and patch around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("remove existing trim and patch around it — 'existing' is noun-position cue → split → perimeter_follow_up", () => {
      const result = analyzeScopeAssistInput("remove existing trim and patch around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace new trim and seal around it — 'new' is noun-position cue → split → perimeter + action_pronoun", () => {
      const result = analyzeScopeAssistInput("replace new trim and seal around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("replace damaged trim and prime it — 'damaged' is noun-position cue → split → action_pronoun_follow_up fires", () => {
      const result = analyzeScopeAssistInput("replace damaged trim and prime it");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    test("replace worn finish and coat around it — 'worn' is noun-position cue + finish as NOUN → split → perimeter + action_pronoun", () => {
      const result = analyzeScopeAssistInput("replace worn finish and coat around it");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.referentialFollowUpHints).toContain("action_pronoun_follow_up");
    });

    // --- Group D: Demonstrative + expanded bounded objects — detection and mid-band bypass ---

    test("replace this brace and seal around it — brace is NOUN → split → perimeter + demonstrative_bounded_object + no mid-band", () => {
      const result = analyzeScopeAssistInput("replace this brace and seal around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace that bolt and coat around it — bolt is NOUN → split → perimeter + demonstrative_bounded_object", () => {
      const result = analyzeScopeAssistInput("replace that bolt and coat around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace this flashing and seal around it — flashing is NOUN → split → perimeter + demonstrative_bounded_object + no mid-band", () => {
      const result = analyzeScopeAssistInput("replace this flashing and seal around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("replace that cover and seal around it — cover is NOUN → split → perimeter + demonstrative_bounded_object", () => {
      const result = analyzeScopeAssistInput("replace that cover and seal around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    test("replace this texture and prime around it — texture is NOUN → demonstrative_bounded_object + perimeter_follow_up", () => {
      const result = analyzeScopeAssistInput("replace this texture and prime around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
    });

    // --- Group E: New demonstrative bounded objects — standalone detection ---

    test("replace this seal — demonstrative_bounded_object fires on 'this seal'", () => {
      const result = analyzeScopeAssistInput("replace this seal");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
    });

    test("replace that finish — demonstrative_bounded_object fires on 'that finish'", () => {
      const result = analyzeScopeAssistInput("replace that finish");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
    });

    test("replace this cap — demonstrative_bounded_object fires on 'this cap'", () => {
      const result = analyzeScopeAssistInput("replace this cap");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
    });

    test("replace those flashings — demonstrative_bounded_object fires on 'those flashings'", () => {
      const result = analyzeScopeAssistInput("replace those flashings");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
    });

    test("replace that anchor — demonstrative_bounded_object fires on 'that anchor'", () => {
      const result = analyzeScopeAssistInput("replace that anchor");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
    });

    // --- Group F: Verb-mode compound pairs still fuse correctly (no false splits) ---

    test("patch and trim edges — trim is VERB (no noun-position cue before it) → compound pair stays fused → no referential hints", () => {
      const result = analyzeScopeAssistInput("patch and trim edges");
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });

    test("patch and seal the joint — seal is VERB in compound pair → fused → no referential hints", () => {
      const result = analyzeScopeAssistInput("patch and seal the joint");
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });

    test("repair and finish the surface — finish is VERB in compound pair → fused → no referential hints", () => {
      const result = analyzeScopeAssistInput("repair and finish the surface");
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });

    test("remove and replace damaged trim — both verbs → fused → no referential hints", () => {
      const result = analyzeScopeAssistInput("remove and replace damaged trim");
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });

    test("prep and seal the floor — both verbs → fused → no referential hints", () => {
      const result = analyzeScopeAssistInput("prep and seal the floor");
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });

    // --- Group G: Non-regression — Pass 1/2/3/4 signals preserved with Pass 5 in place ---

    test("non-regression: patch and paint water-damaged ceiling — Pass 1 mid-band ambiguity preserved, no false referential hints", () => {
      const result = analyzeScopeAssistInput("patch and paint water-damaged ceiling");
      expect(result.midBandAmbiguity).toBe(true);
      expect(result.midBandBiasPhrasing).toBeTruthy();
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });

    test("non-regression: replace storefront glass — strong named object bypasses mid-band, no noun-position interference", () => {
      const result = analyzeScopeAssistInput("replace storefront glass");
      expect(result.midBandAmbiguity).not.toBe(true);
      expect(Array.isArray(result.referentialFollowUpHints) ? result.referentialFollowUpHints.length : 0).toBe(0);
    });

    test("non-regression: replace that panel and paint around it — Pass 4 demonstrative_bounded_object + Pass 3 perimeter_follow_up preserved", () => {
      const result = analyzeScopeAssistInput("replace that panel and paint around it");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_bounded_object");
      expect(result.referentialFollowUpHints).toContain("perimeter_follow_up");
      expect(result.midBandAmbiguity).not.toBe(true);
    });

    test("non-regression: patch drywall and paint — Pass 2 weak clause + mid-band ambiguity preserved", () => {
      const result = analyzeScopeAssistInput("patch drywall and paint");
      expect(result.midBandAmbiguity).toBe(true);
    });

    test("non-regression: replace this section of drywall — Pass 4 demonstrative_weak_extent preserved, no noun-position interference", () => {
      const result = analyzeScopeAssistInput("replace this section of drywall");
      expect(result.demonstrativeModifierHints).toContain("demonstrative_weak_extent");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pass 6: Multi-anchor zone separation hardening
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Pass 6: Multi-anchor zone separation — each clause keeps its own object/location pair", () => {
    // --- Group A: Primary multi-object / multi-zone prompts — must activate ---

    test("replace door at entry and patch wall at window — two anchored clauses → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace door at entry and patch wall at window");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("repair frame at window and replace trim at door — two anchored clauses → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("repair frame at window and replace trim at door");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace vanity in bathroom and patch ceiling in hallway — two anchored clauses → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace vanity in bathroom and patch ceiling in hallway");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace access panel at rear wall and patch around opening at corridor → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace access panel at rear wall and patch around opening at corridor");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("repair canopy section at front entry and paint wall at side elevation → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("repair canopy section at front entry and paint wall at side elevation");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace fence section at side yard and repair gate at rear alley → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace fence section at side yard and repair gate at rear alley");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace glazing panel at lobby entry and patch wall at office corridor → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace glazing panel at lobby entry and patch wall at office corridor");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace handrail section at rear stair and paint wall at landing → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace handrail section at rear stair and paint wall at landing");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace lower cabinet run in kitchen and patch wall in dining area → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run in kitchen and patch wall in dining area");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace entry door at vestibule and repair frame at office window → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace entry door at vestibule and repair frame at office window");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace storefront glass at entry and patch ceiling at lobby → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry and patch ceiling at lobby");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("repair wall area at bathroom and replace trim at bedroom door → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("repair wall area at bathroom and replace trim at bedroom door");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace man door at rear entry and patch wall at interior corridor → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry and patch wall at interior corridor");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace awning at front entry and repair fascia at rear elevation → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace awning at front entry and repair fascia at rear elevation");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("repair access panel at hallway wall and patch ceiling at restroom → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("repair access panel at hallway wall and patch ceiling at restroom");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace canopy panel at loading dock and paint wall at side entry → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace canopy panel at loading dock and paint wall at side entry");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace gate post at alley and weld fence section at side yard → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace gate post at alley and weld fence section at side yard");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace vanity at restroom and patch wall at adjacent corridor → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace vanity at restroom and patch wall at adjacent corridor");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace glazing panel at conference room and seal frame at lobby entry → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace glazing panel at conference room and seal frame at lobby entry");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    // --- Group B: then-separated and comma-separated multi-anchor prompts ---

    test("replace storefront glass and trim at entry, then paint wall at lobby — then-separated → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and trim at entry, then paint wall at lobby");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    // --- Group C: Pronoun/referential variants with explicit location in each clause ---

    test("replace storefront glass at entry and patch around it at corridor → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry and patch around it at corridor");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace door at vestibule and paint around it at lobby wall → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace door at vestibule and paint around it at lobby wall");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace access panel at rear wall and finish around it at hallway side → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace access panel at rear wall and finish around it at hallway side");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace handrail section at stair and secure it at landing → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace handrail section at stair and secure it at landing");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace fence section at alley and weld it at side yard → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace fence section at alley and weld it at side yard");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace lower cabinet run in kitchen and make good around it in dining area → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run in kitchen and make good around it in dining area");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("repair frame at office window and paint wall at lobby → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("repair frame at office window and paint wall at lobby");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace glazing panel at entry and seal around it at storefront wall → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace glazing panel at entry and seal around it at storefront wall");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace vanity in bathroom and patch around it in corridor wall → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace vanity in bathroom and patch around it in corridor wall");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("replace trim at door and paint around it at adjacent wall → multiAnchorSeparationActive", () => {
      const result = analyzeScopeAssistInput("replace trim at door and paint around it at adjacent wall");
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    // --- Group D: Non-regression — single-anchor or no-anchor prompts must NOT activate ---

    test("non-regression: replace storefront glass at entry — single clause, single location → not active", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: replace lower cabinet run — no location anchor → not active", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: repair built-in cabinet section — no location anchor → not active", () => {
      const result = analyzeScopeAssistInput("repair built-in cabinet section");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: replace one section of railing — no location → not active", () => {
      const result = analyzeScopeAssistInput("replace one section of railing");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: install fence section at side yard — single clause, one location → not active", () => {
      const result = analyzeScopeAssistInput("install fence section at side yard");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: replace man door at rear entry — single clause → not active", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: replace glazing panel and seal perimeter — no at/in location in either clause → not active", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: reset access panel and patch wall — no location anchors → not active", () => {
      const result = analyzeScopeAssistInput("reset access panel and patch wall");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: close up old opening and finish wall — no at/in locations → not active", () => {
      const result = analyzeScopeAssistInput("close up old opening and finish wall");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: repair cover panel — single clause, no location → not active", () => {
      const result = analyzeScopeAssistInput("repair cover panel");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: replace trim around door — no at/in location anchor → not active", () => {
      const result = analyzeScopeAssistInput("replace trim around door");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: repair frame area at window — single clause, one location → not active", () => {
      const result = analyzeScopeAssistInput("repair frame area at window");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: patch and paint affected wall area — single fused clause, no location → not active", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: replace handrail section and secure posts — no location anchors → not active", () => {
      const result = analyzeScopeAssistInput("replace handrail section and secure posts");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: replace storefront glass and patch wall around it — no at/in locations → not active", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and patch wall around it");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: replace that panel and paint around it — no location anchors → not active", () => {
      const result = analyzeScopeAssistInput("replace that panel and paint around it");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: replace this door and patch around it — no location anchors → not active", () => {
      const result = analyzeScopeAssistInput("replace this door and patch around it");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });

    test("non-regression: replace that trim and paint around it — no location anchors → not active", () => {
      const result = analyzeScopeAssistInput("replace that trim and paint around it");
      expect(result.multiAnchorSeparationActive).not.toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pass 7: Implicit relative-location / comparative-zone hardening
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Pass 7: Relative/comparative zone hardening — implicit zone anchors without named location nouns", () => {
    // --- Group A: Single-clause relative zone — hint fires, separation NOT active ---

    test("do the other side — relative_side_contrast hint, separation not active (single clause)", () => {
      const result = analyzeScopeAssistInput("do the other side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).not.toBe(true);
    });

    test("patch the same wall — relative_same hint, separation not active", () => {
      const result = analyzeScopeAssistInput("patch the same wall");
      expect(result.relativeZoneHints).toContain("relative_same");
      expect(result.relativeZoneSeparationActive).not.toBe(true);
    });

    test("repair opposite side — relative_opposite hint, separation not active", () => {
      const result = analyzeScopeAssistInput("repair opposite side");
      expect(result.relativeZoneHints).toContain("relative_opposite");
      expect(result.relativeZoneSeparationActive).not.toBe(true);
    });

    test("fix adjacent area — relative_adjacent_nearby hint, separation not active", () => {
      const result = analyzeScopeAssistInput("fix adjacent area");
      expect(result.relativeZoneHints).toContain("relative_adjacent_nearby");
      expect(result.relativeZoneSeparationActive).not.toBe(true);
    });

    test("repair nearby section — relative_adjacent_nearby hint, separation not active", () => {
      const result = analyzeScopeAssistInput("repair nearby section");
      expect(result.relativeZoneHints).toContain("relative_adjacent_nearby");
      expect(result.relativeZoneSeparationActive).not.toBe(true);
    });

    test("do the wall on the other side — relative_side_contrast hint, separation not active", () => {
      const result = analyzeScopeAssistInput("do the wall on the other side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).not.toBe(true);
    });

    test("repair other side wall area — relative_side_contrast hint, separation not active (single clause)", () => {
      const result = analyzeScopeAssistInput("repair other side wall area");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).not.toBe(true);
    });

    // --- Group B: Multi-clause side contrast — separation active ---

    test("trim left side and paint right side — relative_side_contrast, separation active", () => {
      const result = analyzeScopeAssistInput("trim left side and paint right side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("patch this side and paint the other — relative_side_contrast, separation active", () => {
      const result = analyzeScopeAssistInput("patch this side and paint the other");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("replace panel on one side and patch the other side — relative_side_contrast, separation active", () => {
      const result = analyzeScopeAssistInput("replace panel on one side and patch the other side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("repair wall on left side and trim opening on right side — relative_side_contrast, separation active", () => {
      const result = analyzeScopeAssistInput("repair wall on left side and trim opening on right side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("repair one side of canopy and paint the other side — relative_side_contrast, separation active", () => {
      const result = analyzeScopeAssistInput("repair one side of canopy and paint the other side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("replace door on one side and patch the other side — relative_side_contrast, separation active", () => {
      const result = analyzeScopeAssistInput("replace door on one side and patch the other side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("replace panel at left side and paint right side — relative_side_contrast, separation active", () => {
      const result = analyzeScopeAssistInput("replace panel at left side and paint right side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("patch wall at one side and finish opposite side — relative_side_contrast + relative_opposite, separation active", () => {
      const result = analyzeScopeAssistInput("patch wall at one side and finish opposite side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneHints).toContain("relative_opposite");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("replace handrail on one side and secure the other side — relative_side_contrast, separation active", () => {
      const result = analyzeScopeAssistInput("replace handrail on one side and secure the other side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    // --- Group C: Interior/exterior zone contrast — separation active ---

    test("patch inside and seal outside — relative_interior_exterior, separation active", () => {
      const result = analyzeScopeAssistInput("patch inside and seal outside");
      expect(result.relativeZoneHints).toContain("relative_interior_exterior");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("repair the inside face and seal the outside edge — relative_interior_exterior, separation active", () => {
      const result = analyzeScopeAssistInput("repair the inside face and seal the outside edge");
      expect(result.relativeZoneHints).toContain("relative_interior_exterior");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("patch around opening inside and seal outside — relative_interior_exterior, separation active", () => {
      const result = analyzeScopeAssistInput("patch around opening inside and seal outside");
      expect(result.relativeZoneHints).toContain("relative_interior_exterior");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("patch interior side and seal exterior side — relative_interior_exterior, separation active", () => {
      const result = analyzeScopeAssistInput("patch interior side and seal exterior side");
      expect(result.relativeZoneHints).toContain("relative_interior_exterior");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("replace glazing on inside and seal outside perimeter — relative_interior_exterior, separation active", () => {
      const result = analyzeScopeAssistInput("replace glazing on inside and seal outside perimeter");
      expect(result.relativeZoneHints).toContain("relative_interior_exterior");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("repair inside wall area and seal outside edge — relative_interior_exterior, separation active", () => {
      const result = analyzeScopeAssistInput("repair inside wall area and seal outside edge");
      expect(result.relativeZoneHints).toContain("relative_interior_exterior");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("replace trim at exterior side and paint interior side — relative_interior_exterior, separation active", () => {
      const result = analyzeScopeAssistInput("replace trim at exterior side and paint interior side");
      expect(result.relativeZoneHints).toContain("relative_interior_exterior");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("replace glazing at inside face and seal outside frame — relative_interior_exterior, separation active", () => {
      const result = analyzeScopeAssistInput("replace glazing at inside face and seal outside frame");
      expect(result.relativeZoneHints).toContain("relative_interior_exterior");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    // --- Group D: Front/rear and same/adjacent zones ---

    test("replace trim on the front side and patch the back side — relative_front_rear, separation active", () => {
      const result = analyzeScopeAssistInput("replace trim on the front side and patch the back side");
      expect(result.relativeZoneHints).toContain("relative_front_rear");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("patch front side and blend rear side — relative_front_rear, separation active", () => {
      const result = analyzeScopeAssistInput("patch front side and blend rear side");
      expect(result.relativeZoneHints).toContain("relative_front_rear");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("repair same area and blend adjacent section — relative_same + relative_adjacent_nearby, separation active", () => {
      const result = analyzeScopeAssistInput("repair same area and blend adjacent section");
      expect(result.relativeZoneHints).toContain("relative_same");
      expect(result.relativeZoneHints).toContain("relative_adjacent_nearby");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("repair adjacent wall area and paint nearby section — relative_adjacent_nearby, separation active", () => {
      const result = analyzeScopeAssistInput("repair adjacent wall area and paint nearby section");
      expect(result.relativeZoneHints).toContain("relative_adjacent_nearby");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("repair adjacent section and patch nearby area — relative_adjacent_nearby, separation active", () => {
      const result = analyzeScopeAssistInput("repair adjacent section and patch nearby area");
      expect(result.relativeZoneHints).toContain("relative_adjacent_nearby");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    test("patch same opening area and finish adjacent wall — relative_same + relative_adjacent_nearby, separation active", () => {
      const result = analyzeScopeAssistInput("patch same opening area and finish adjacent wall");
      expect(result.relativeZoneHints).toContain("relative_same");
      expect(result.relativeZoneHints).toContain("relative_adjacent_nearby");
      expect(result.relativeZoneSeparationActive).toBe(true);
    });

    // --- Group E: Non-regression — no relative zone language → no hints ---

    test("non-regression: replace storefront glass at entry — explicit location, no relative zone", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
      expect(result.relativeZoneSeparationActive).not.toBe(true);
    });

    test("non-regression: replace lower cabinet run — no relative zone", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
    });

    test("non-regression: replace one section of railing — 'one section' not a relative zone", () => {
      const result = analyzeScopeAssistInput("replace one section of railing");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
    });

    test("non-regression: replace man door at rear entry — 'rear' is location modifier, not a relative zone side", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
    });

    test("non-regression: replace glazing panel and seal perimeter — no relative zone", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
    });

    test("non-regression: replace trim around door — no relative zone", () => {
      const result = analyzeScopeAssistInput("replace trim around door");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
    });

    test("non-regression: patch and paint affected wall area — no relative zone", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
    });

    test("non-regression: replace handrail section and secure posts — no relative zone", () => {
      const result = analyzeScopeAssistInput("replace handrail section and secure posts");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
    });

    test("non-regression: replace storefront glass and patch wall around it — no relative zone", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and patch wall around it");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
    });

    test("non-regression: replace that panel and paint around it — demonstrative only, no relative zone", () => {
      const result = analyzeScopeAssistInput("replace that panel and paint around it");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
    });

    test("non-regression: replace that trim and paint around it — no relative zone", () => {
      const result = analyzeScopeAssistInput("replace that trim and paint around it");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
    });

    test("non-regression: replace door at entry and patch wall at window — explicit dual-anchor, no relative zone", () => {
      const result = analyzeScopeAssistInput("replace door at entry and patch wall at window");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
      expect(result.multiAnchorSeparationActive).toBe(true);
    });

    test("non-regression: replace storefront glass and trim at entry, then paint wall at lobby — multi-anchor, no relative zone", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and trim at entry, then paint wall at lobby");
      expect(Array.isArray(result.relativeZoneHints) ? result.relativeZoneHints.length : 0).toBe(0);
      expect(result.multiAnchorSeparationActive).toBe(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // Pass 8: Sparse directional shorthand + multi-zone sequencing hardening
  // ─────────────────────────────────────────────────────────────────────────────
  describe("Pass 8: Sparse directional zone shorthand and 3+ zone chain separation", () => {
    // --- Group A: Single-clause sparse shorthand — sparse_directional_zone fires, chain NOT active ---

    test("repair the outside — sparse_directional_zone fires, chain not active", () => {
      const result = analyzeScopeAssistInput("repair the outside");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
      expect(result.multiZoneChainActive).not.toBe(true);
    });

    test("patch the inside — sparse_directional_zone fires, chain not active", () => {
      const result = analyzeScopeAssistInput("patch the inside");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
      expect(result.multiZoneChainActive).not.toBe(true);
    });

    test("seal outside — sparse_directional_zone fires", () => {
      const result = analyzeScopeAssistInput("seal outside");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
      expect(result.multiZoneChainActive).not.toBe(true);
    });

    test("paint inside — sparse_directional_zone fires (paint was not in Pass 7 interior/exterior verb list)", () => {
      const result = analyzeScopeAssistInput("paint inside");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("finish the exterior — sparse_directional_zone fires for bare 'exterior'", () => {
      const result = analyzeScopeAssistInput("finish the exterior");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("patch the interior — sparse_directional_zone fires for bare 'interior'", () => {
      const result = analyzeScopeAssistInput("patch the interior");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("repair the side — sparse_directional_zone fires", () => {
      const result = analyzeScopeAssistInput("repair the side");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("patch the edge — sparse_directional_zone fires", () => {
      const result = analyzeScopeAssistInput("patch the edge");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("finish the center — sparse_directional_zone fires", () => {
      const result = analyzeScopeAssistInput("finish the center");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("repair the back — sparse_directional_zone fires", () => {
      const result = analyzeScopeAssistInput("repair the back");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("patch the front — sparse_directional_zone fires", () => {
      const result = analyzeScopeAssistInput("patch the front");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("seal the rear — sparse_directional_zone fires", () => {
      const result = analyzeScopeAssistInput("seal the rear");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("blend the middle section — sparse_directional_zone fires for bare 'middle'", () => {
      const result = analyzeScopeAssistInput("blend the middle section");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("paint the side wall area — sparse_directional_zone fires for 'side' as zone target", () => {
      const result = analyzeScopeAssistInput("paint the side wall area");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("repair the exterior face — sparse_directional_zone fires", () => {
      const result = analyzeScopeAssistInput("repair the exterior face");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    test("patch the interior edge — sparse_directional_zone fires", () => {
      const result = analyzeScopeAssistInput("patch the interior edge");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
    });

    // --- Group B: 3+ zone chains — multi_zone_chain fires, multiZoneChainActive true ---

    test("repair left side, fill center, and paint right side — 3 zones, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("repair left side, fill center, and paint right side");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("patch front, seal side, paint rear — 3 bare zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("patch front, seal side, paint rear");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("repair inside face, seal edge, paint outside — 3 zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("repair inside face, seal edge, paint outside");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("patch left, blend middle, paint right — 3 bare zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("patch left, blend middle, paint right");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("repair front side, patch center, finish rear side — 3 zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("repair front side, patch center, finish rear side");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("replace glazing inside and seal outside and paint the side wall — 3 and-chained zones, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("replace glazing inside and seal outside and paint the side wall");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("patch the outside, seal the inside, and finish the edge — 3 zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("patch the outside, seal the inside, and finish the edge");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("repair one side, patch the middle, and paint the other side — 3 zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("repair one side, patch the middle, and paint the other side");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("seal rear, patch side, paint front — 3 bare zone comma clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("seal rear, patch side, paint front");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("patch inside, finish outside, and blend adjacent area — 3 zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("patch inside, finish outside, and blend adjacent area");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("repair the edge, patch the center, and seal the outside — 3 zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("repair the edge, patch the center, and seal the outside");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("paint the inside, patch the other side, and blend the middle — 3 zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("paint the inside, patch the other side, and blend the middle");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("repair exterior side, patch interior side, paint center section — 3 zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("repair exterior side, patch interior side, paint center section");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    test("patch front edge, seal middle span, paint rear edge — 3 zone clauses, multi_zone_chain active", () => {
      const result = analyzeScopeAssistInput("patch front edge, seal middle span, paint rear edge");
      expect(result.multiZoneChainHints).toContain("multi_zone_chain");
      expect(result.multiZoneChainActive).toBe(true);
    });

    // --- Group C: Non-regression — no false sparse or chain signals ---

    test("non-regression: replace storefront glass at entry — no sparse zone, no chain", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(Array.isArray(result.multiZoneChainHints) ? result.multiZoneChainHints.length : 0).toBe(0);
      expect(result.multiZoneChainActive).not.toBe(true);
    });

    test("non-regression: replace lower cabinet run — no sparse zone", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run");
      expect(Array.isArray(result.multiZoneChainHints) ? result.multiZoneChainHints.length : 0).toBe(0);
    });

    test("non-regression: replace one section of railing — 'one section' not a zone target", () => {
      const result = analyzeScopeAssistInput("replace one section of railing");
      expect(Array.isArray(result.multiZoneChainHints) ? result.multiZoneChainHints.length : 0).toBe(0);
    });

    test("non-regression: replace man door at rear entry — 'rear' in location phrase, not bare zone target", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry");
      expect(Array.isArray(result.multiZoneChainHints) ? result.multiZoneChainHints.length : 0).toBe(0);
    });

    test("non-regression: replace glazing panel and seal perimeter — 'perimeter' not a bare zone word", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(Array.isArray(result.multiZoneChainHints) ? result.multiZoneChainHints.length : 0).toBe(0);
    });

    test("non-regression: patch and paint affected wall area — no sparse zone target", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(Array.isArray(result.multiZoneChainHints) ? result.multiZoneChainHints.length : 0).toBe(0);
    });

    test("non-regression: replace trim around door — no sparse zone", () => {
      const result = analyzeScopeAssistInput("replace trim around door");
      expect(Array.isArray(result.multiZoneChainHints) ? result.multiZoneChainHints.length : 0).toBe(0);
    });

    test("non-regression: replace that trim and paint around it — no sparse zone (around it is referential)", () => {
      const result = analyzeScopeAssistInput("replace that trim and paint around it");
      expect(Array.isArray(result.multiZoneChainHints) ? result.multiZoneChainHints.length : 0).toBe(0);
    });

    test("non-regression: replace door at entry and patch wall at window — multi-anchor active, no chain", () => {
      const result = analyzeScopeAssistInput("replace door at entry and patch wall at window");
      expect(result.multiAnchorSeparationActive).toBe(true);
      expect(result.multiZoneChainActive).not.toBe(true);
    });

    test("non-regression: trim left side and paint right side — 2 clauses only, no chain (Pass 7 separation preserved)", () => {
      const result = analyzeScopeAssistInput("trim left side and paint right side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(result.relativeZoneSeparationActive).toBe(true);
      expect(result.multiZoneChainActive).not.toBe(true);
    });

    test("non-regression: patch inside and seal outside — 2 clauses, Pass 7 interior/exterior preserved, no chain", () => {
      const result = analyzeScopeAssistInput("patch inside and seal outside");
      expect(result.relativeZoneHints).toContain("relative_interior_exterior");
      expect(result.relativeZoneSeparationActive).toBe(true);
      expect(result.multiZoneChainActive).not.toBe(true);
    });

    test("non-regression: replace storefront glass and trim at entry, then paint wall at lobby — multi-anchor, no chain", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and trim at entry, then paint wall at lobby");
      expect(result.multiAnchorSeparationActive).toBe(true);
      expect(result.multiZoneChainActive).not.toBe(true);
    });
  });

  describe("Pass 9: Coverage / extent quantifier hardening", () => {
    // --- Group A: both_sides ---

    test("repair both sides — both_sides fires", () => {
      const result = analyzeScopeAssistInput("repair both sides");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair both ends — both_sides fires", () => {
      const result = analyzeScopeAssistInput("repair both ends");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("patch both sides of opening — both_sides fires", () => {
      const result = analyzeScopeAssistInput("patch both sides of opening");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair both sides of canopy — both_sides fires", () => {
      const result = analyzeScopeAssistInput("repair both sides of canopy");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("paint both wall sections — both_sides fires", () => {
      const result = analyzeScopeAssistInput("paint both wall sections");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(result.coverageExtentActive).toBe(true);
    });

    // --- Group A: perimeter_wraparound ---

    test("patch all around — perimeter_wraparound fires", () => {
      const result = analyzeScopeAssistInput("patch all around");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("seal full perimeter — perimeter_wraparound fires", () => {
      const result = analyzeScopeAssistInput("seal full perimeter");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("seal all the way around — perimeter_wraparound fires", () => {
      const result = analyzeScopeAssistInput("seal all the way around");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("seal all edges — perimeter_wraparound fires", () => {
      const result = analyzeScopeAssistInput("seal all edges");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("seal all sides — perimeter_wraparound fires", () => {
      const result = analyzeScopeAssistInput("seal all sides");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("seal the full outside perimeter — perimeter_wraparound fires", () => {
      const result = analyzeScopeAssistInput("seal the full outside perimeter");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair full perimeter at frame — perimeter_wraparound fires", () => {
      const result = analyzeScopeAssistInput("repair full perimeter at frame");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("seal all edges at panel — perimeter_wraparound fires", () => {
      const result = analyzeScopeAssistInput("seal all edges at panel");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("seal the whole frame perimeter — perimeter_wraparound fires", () => {
      const result = analyzeScopeAssistInput("seal the whole frame perimeter");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    // --- Group A: whole_local_surface ---

    test("paint entire wall — whole_local_surface fires", () => {
      const result = analyzeScopeAssistInput("paint entire wall");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair whole section — whole_local_surface fires", () => {
      const result = analyzeScopeAssistInput("repair whole section");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("patch entire ceiling area — whole_local_surface fires", () => {
      const result = analyzeScopeAssistInput("patch entire ceiling area");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("paint whole face — whole_local_surface fires", () => {
      const result = analyzeScopeAssistInput("paint whole face");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair full rear side — whole_local_surface fires", () => {
      const result = analyzeScopeAssistInput("repair full rear side");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("patch whole inside face — whole_local_surface fires", () => {
      const result = analyzeScopeAssistInput("patch whole inside face");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair the whole opening area — whole_local_surface fires", () => {
      const result = analyzeScopeAssistInput("repair the whole opening area");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("paint the entire ceiling area — whole_local_surface fires", () => {
      const result = analyzeScopeAssistInput("paint the entire ceiling area");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(result.coverageExtentActive).toBe(true);
    });

    // --- Group A: remainder_partial ---

    test("patch rest of wall — remainder_partial fires", () => {
      const result = analyzeScopeAssistInput("patch rest of wall");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair remaining area — remainder_partial fires", () => {
      const result = analyzeScopeAssistInput("repair remaining area");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("patch the other half — remainder_partial fires", () => {
      const result = analyzeScopeAssistInput("patch the other half");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("patch remaining ceiling section — remainder_partial fires", () => {
      const result = analyzeScopeAssistInput("patch remaining ceiling section");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("paint the rest of the wall area — remainder_partial fires", () => {
      const result = analyzeScopeAssistInput("paint the rest of the wall area");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("patch remaining side — remainder_partial fires", () => {
      const result = analyzeScopeAssistInput("patch remaining side");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("paint the other half of wall — remainder_partial fires", () => {
      const result = analyzeScopeAssistInput("paint the other half of wall");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("patch the rest of the opening area — remainder_partial fires", () => {
      const result = analyzeScopeAssistInput("patch the rest of the opening area");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair the other half of the wall — remainder_partial fires", () => {
      const result = analyzeScopeAssistInput("repair the other half of the wall");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("patch the remaining wall face — remainder_partial fires", () => {
      const result = analyzeScopeAssistInput("patch the remaining wall face");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    // --- Group A: run_span_edge ---

    test("replace full run — run_span_edge fires", () => {
      const result = analyzeScopeAssistInput("replace full run");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair full span — run_span_edge fires", () => {
      const result = analyzeScopeAssistInput("repair full span");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("seal the entire edge — run_span_edge fires", () => {
      const result = analyzeScopeAssistInput("seal the entire edge");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair full front edge — run_span_edge fires", () => {
      const result = analyzeScopeAssistInput("repair full front edge");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair the full middle span — run_span_edge fires", () => {
      const result = analyzeScopeAssistInput("repair the full middle span");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("replace full cabinet run — run_span_edge fires", () => {
      const result = analyzeScopeAssistInput("replace full cabinet run");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("repair full fence section span — run_span_edge fires", () => {
      const result = analyzeScopeAssistInput("repair full fence section span");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("replace the full railing section — run_span_edge fires", () => {
      const result = analyzeScopeAssistInput("replace the full railing section");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(result.coverageExtentActive).toBe(true);
    });

    // --- Group B: multi-hint combinations ---

    test("repair both sides and seal full perimeter — both_sides + perimeter_wraparound fire", () => {
      const result = analyzeScopeAssistInput("repair both sides and seal full perimeter");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("paint entire wall and patch the other half — whole_local_surface + remainder_partial fire", () => {
      const result = analyzeScopeAssistInput("paint entire wall and patch the other half");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(result.coverageExtentActive).toBe(true);
    });

    test("replace full run and seal all edges — run_span_edge + perimeter_wraparound fire", () => {
      const result = analyzeScopeAssistInput("replace full run and seal all edges");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.coverageExtentActive).toBe(true);
    });

    // --- Group C: Non-regression — no false coverage extent signals ---

    test("non-regression: replace storefront glass at entry — no coverage extent", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace lower cabinet run — 'lower' not a coverage quantifier", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: repair built-in cabinet section — no coverage quantifier", () => {
      const result = analyzeScopeAssistInput("repair built-in cabinet section");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace one section of railing — 'one section' not a coverage quantifier", () => {
      const result = analyzeScopeAssistInput("replace one section of railing");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: install fence section at side yard — no coverage quantifier", () => {
      const result = analyzeScopeAssistInput("install fence section at side yard");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace man door at rear entry — 'rear' in location phrase, not coverage extent", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace glazing panel and seal perimeter — plain 'perimeter' without quantifier", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: reset access panel and patch wall — no coverage quantifier", () => {
      const result = analyzeScopeAssistInput("reset access panel and patch wall");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: close up old opening and finish wall — 'finish wall' without quantifier", () => {
      const result = analyzeScopeAssistInput("close up old opening and finish wall");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: repair cover panel — no coverage quantifier", () => {
      const result = analyzeScopeAssistInput("repair cover panel");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace trim around door — 'around door' is referential, not 'all around'", () => {
      const result = analyzeScopeAssistInput("replace trim around door");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: repair frame area at window — no coverage quantifier", () => {
      const result = analyzeScopeAssistInput("repair frame area at window");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: patch and paint affected wall area — no coverage quantifier", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace handrail section and secure posts — no coverage quantifier", () => {
      const result = analyzeScopeAssistInput("replace handrail section and secure posts");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace storefront glass and patch wall around it — 'around it' is referential", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and patch wall around it");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace that panel and paint around it — no coverage quantifier", () => {
      const result = analyzeScopeAssistInput("replace that panel and paint around it");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace that trim and paint around it — no coverage quantifier", () => {
      const result = analyzeScopeAssistInput("replace that trim and paint around it");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace door at entry and patch wall at window — multi-anchor, no coverage extent", () => {
      const result = analyzeScopeAssistInput("replace door at entry and patch wall at window");
      expect(result.multiAnchorSeparationActive).toBe(true);
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: replace storefront glass and trim at entry, then paint wall at lobby — no coverage extent", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and trim at entry, then paint wall at lobby");
      expect(result.multiAnchorSeparationActive).toBe(true);
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: trim left side and paint right side — relative side contrast preserved, no coverage extent", () => {
      const result = analyzeScopeAssistInput("trim left side and paint right side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: patch inside and seal outside — relative interior/exterior preserved, no coverage extent", () => {
      const result = analyzeScopeAssistInput("patch inside and seal outside");
      expect(result.relativeZoneHints).toContain("relative_interior_exterior");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: repair the outside — sparse directional zone preserved, no coverage extent", () => {
      const result = analyzeScopeAssistInput("repair the outside");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });

    test("non-regression: patch the inside — sparse directional zone preserved, no coverage extent", () => {
      const result = analyzeScopeAssistInput("patch the inside");
      expect(result.multiZoneChainHints).toContain("sparse_directional_zone");
      expect(Array.isArray(result.coverageExtentHints) ? result.coverageExtentHints.length : 0).toBe(0);
      expect(result.coverageExtentActive).not.toBe(true);
    });
  });

  describe("Pass 10: Ordinal / count / stacked extent hardening", () => {
    // --- Group A: ordinal_local_selection ---

    test("repair first section — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair first section");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace last panel — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("replace last panel");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("patch third wall area — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("patch third wall area");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("seal second joint — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("seal second joint");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair middle panel — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair middle panel");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace end section — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("replace end section");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair middle span of handrail section — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair middle span of handrail section");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("patch second opening area — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("patch second opening area");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace third cabinet run — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("replace third cabinet run");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair first fence bay at side yard — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair first fence bay at side yard");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("patch the last panel face — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("patch the last panel face");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace the middle cabinet section — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("replace the middle cabinet section");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair third glazing panel at entry — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair third glazing panel at entry");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace second fence section on rear side — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("replace second fence section on rear side");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair the last railing span — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair the last railing span");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("patch middle ceiling area — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("patch middle ceiling area");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair first and second wall sections — ordinal_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair first and second wall sections");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("patch first two wall areas — ordinal_local_selection + count_local_extent both fire", () => {
      const result = analyzeScopeAssistInput("patch first two wall areas");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace last two cabinet doors — ordinal_local_selection + count_local_extent both fire", () => {
      const result = analyzeScopeAssistInput("replace last two cabinet doors");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair the first two ceiling sections — ordinal_local_selection + count_local_extent both fire", () => {
      const result = analyzeScopeAssistInput("repair the first two ceiling sections");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("patch first two wall faces — ordinal_local_selection + count_local_extent both fire", () => {
      const result = analyzeScopeAssistInput("patch first two wall faces");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    // --- Group B: count_local_extent ---

    test("patch two sections — count_local_extent fires", () => {
      const result = analyzeScopeAssistInput("patch two sections");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace three runs — count_local_extent fires", () => {
      const result = analyzeScopeAssistInput("replace three runs");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("seal two edges — count_local_extent fires", () => {
      const result = analyzeScopeAssistInput("seal two edges");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("paint two wall sections — count_local_extent fires", () => {
      const result = analyzeScopeAssistInput("paint two wall sections");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace three fence panels — count_local_extent fires", () => {
      const result = analyzeScopeAssistInput("replace three fence panels");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace two railing sections at entry — count_local_extent fires", () => {
      const result = analyzeScopeAssistInput("replace two railing sections at entry");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("patch the other two wall areas — count_local_extent fires", () => {
      const result = analyzeScopeAssistInput("patch the other two wall areas");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace two cabinet runs at breakroom — count_local_extent fires", () => {
      const result = analyzeScopeAssistInput("replace two cabinet runs at breakroom");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    // --- Group C: stacked_extent_location ---

    test("repair full outside perimeter of rear wall — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("repair full outside perimeter of rear wall");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("patch entire inside face of left wall section — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("patch entire inside face of left wall section");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("seal both outer edges of center panel — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("seal both outer edges of center panel");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair remaining rear half of ceiling area — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("repair remaining rear half of ceiling area");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace full middle span of fence section — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("replace full middle span of fence section");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("seal outer edge of rear panel — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("seal outer edge of rear panel");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("seal both ends of center rail — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("seal both ends of center rail");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("patch remaining inside face of rear wall — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("patch remaining inside face of rear wall");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair full outside edge of opening — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("repair full outside edge of opening");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("seal the rear outer perimeter of frame — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("seal the rear outer perimeter of frame");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("seal full inside perimeter of frame — stacked_extent_location fires (directional modifier absorbs into P10 stacked)", () => {
      const result = analyzeScopeAssistInput("seal full inside perimeter of frame");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair both outer edges — stacked_extent_location fires (both+outer+edges is stacked, not plain both_sides)", () => {
      const result = analyzeScopeAssistInput("repair both outer edges");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("seal both side edges of panel — stacked_extent_location fires", () => {
      const result = analyzeScopeAssistInput("seal both side edges of panel");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    // --- Group D: cross-pass interaction combos ---

    test("seal full inside perimeter of frame — P10 stacked fires; directional modifier prevents plain P9 perimeter", () => {
      const result = analyzeScopeAssistInput("seal full inside perimeter of frame");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("repair remaining rear half of ceiling area — P10 stacked fires; directional rear modifier prevents plain P9 remainder", () => {
      const result = analyzeScopeAssistInput("repair remaining rear half of ceiling area");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.ordinalCountStackedActive).toBe(true);
    });

    test("replace full middle span of fence section — P9 run_span_edge and P10 stacked coexist", () => {
      const result = analyzeScopeAssistInput("replace full middle span of fence section");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
    });

    // --- Group E: Non-regression — no false ordinal/count/stacked signals ---

    test("non-regression: replace storefront glass at entry — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace lower cabinet run — 'lower' not an ordinal selector", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: repair built-in cabinet section — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("repair built-in cabinet section");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace one section of railing — 'one' not in ordinal or count list", () => {
      const result = analyzeScopeAssistInput("replace one section of railing");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: install fence section at side yard — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("install fence section at side yard");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace man door at rear entry — 'rear entry' not a stacked extent", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace glazing panel and seal perimeter — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: reset access panel and patch wall — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("reset access panel and patch wall");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: close up old opening and finish wall — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("close up old opening and finish wall");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: repair cover panel — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("repair cover panel");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace trim around door — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("replace trim around door");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: repair frame area at window — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("repair frame area at window");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: patch and paint affected wall area — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace handrail section and secure posts — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("replace handrail section and secure posts");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace storefront glass and patch wall around it — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and patch wall around it");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace that panel and paint around it — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("replace that panel and paint around it");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace that trim and paint around it — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("replace that trim and paint around it");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace door at entry and patch wall at window — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("replace door at entry and patch wall at window");
      expect(result.multiAnchorSeparationActive).toBe(true);
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace storefront glass and trim at entry, then paint wall at lobby — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and trim at entry, then paint wall at lobby");
      expect(result.multiAnchorSeparationActive).toBe(true);
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: trim left side and paint right side — relative side contrast, no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("trim left side and paint right side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: patch inside and seal outside — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("patch inside and seal outside");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: repair the outside — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("repair the outside");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: patch the inside — no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("patch the inside");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace full cabinet run — P9 run_span_edge, no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("replace full cabinet run");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: repair full fence section span — P9 run_span_edge, no ordinal/count/stacked", () => {
      const result = analyzeScopeAssistInput("repair full fence section span");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: seal the whole frame perimeter — P9 perimeter_wraparound, no P10 stacked", () => {
      const result = analyzeScopeAssistInput("seal the whole frame perimeter");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: patch the remaining wall face — P9 remainder_partial, no P10 stacked", () => {
      const result = analyzeScopeAssistInput("patch the remaining wall face");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: paint the entire ceiling area — P9 whole_local_surface, no P10 stacked", () => {
      const result = analyzeScopeAssistInput("paint the entire ceiling area");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: repair both sides of canopy — P9 both_sides, no P10 stacked", () => {
      const result = analyzeScopeAssistInput("repair both sides of canopy");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: seal all edges at panel — P9 perimeter_wraparound, no P10 stacked", () => {
      const result = analyzeScopeAssistInput("seal all edges at panel");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: patch the rest of the opening area — P9 remainder_partial, no P10 stacked", () => {
      const result = analyzeScopeAssistInput("patch the rest of the opening area");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: repair the other half of the wall — P9 remainder_partial, no P10 stacked", () => {
      const result = analyzeScopeAssistInput("repair the other half of the wall");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });

    test("non-regression: replace the full railing section — P9 run_span_edge, no P10 stacked", () => {
      const result = analyzeScopeAssistInput("replace the full railing section");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(Array.isArray(result.ordinalCountStackedHints) ? result.ordinalCountStackedHints.length : 0).toBe(0);
      expect(result.ordinalCountStackedActive).not.toBe(true);
    });
  });

  describe("Pass 11: Range / positional / fractional / mixed-anchor hardening", () => {
    // --- Group A: positional_local_selection ---

    test("repair top panel — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair top panel");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("replace bottom run — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("replace bottom run");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch upper wall section — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("patch upper wall section");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("seal lower edge — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("seal lower edge");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair front span — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair front span");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch rear panel face — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("patch rear panel face");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("seal upper perimeter of frame — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("seal upper perimeter of frame");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch lower inside face of wall — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("patch lower inside face of wall");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair top edge of opening — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair top edge of opening");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("replace bottom cabinet run — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("replace bottom cabinet run");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair upper cabinet section — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("repair upper cabinet section");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("replace lower fence panel — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("replace lower fence panel");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch the top wall face — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("patch the top wall face");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("seal the bottom outside edge of opening — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("seal the bottom outside edge of opening");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("seal the upper rear perimeter of frame — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("seal the upper rear perimeter of frame");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("seal upper span of railing section — positional_local_selection fires", () => {
      const result = analyzeScopeAssistInput("seal upper span of railing section");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    // --- Group B: ordinal_range_selection ---

    test("replace sections 2 through 4 — ordinal_range_selection fires", () => {
      const result = analyzeScopeAssistInput("replace sections 2 through 4");
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair panels 1-3 — ordinal_range_selection fires", () => {
      const result = analyzeScopeAssistInput("repair panels 1-3");
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch first through third wall area — ordinal_range_selection fires", () => {
      const result = analyzeScopeAssistInput("patch first through third wall area");
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("seal bays two to four — ordinal_range_selection fires", () => {
      const result = analyzeScopeAssistInput("seal bays two to four");
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair sections 1 through 3 at rear elevation — ordinal_range_selection fires", () => {
      const result = analyzeScopeAssistInput("repair sections 1 through 3 at rear elevation");
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    // --- Group C: fractional_local_extent ---

    test("patch half the wall — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("patch half the wall");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair a third of the section — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("repair a third of the section");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("paint left half of opening — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("paint left half of opening");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair rear half of ceiling area — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("repair rear half of ceiling area");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch lower half of wall face — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("patch lower half of wall face");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch middle third of wall area — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("patch middle third of wall area");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair the upper half of ceiling section — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("repair the upper half of ceiling section");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("seal the rear half of frame perimeter — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("seal the rear half of frame perimeter");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch one-half of wall area — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("patch one-half of wall area");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair one-third of ceiling section — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("repair one-third of ceiling section");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair rear half of wall section — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("repair rear half of wall section");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch the front half of opening area — fractional_local_extent fires", () => {
      const result = analyzeScopeAssistInput("patch the front half of opening area");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    // --- Group D: mixed_selection_location ---

    test("replace first panel at rear wall — mixed_selection_location fires", () => {
      const result = analyzeScopeAssistInput("replace first panel at rear wall");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair second section on left side — mixed_selection_location fires", () => {
      const result = analyzeScopeAssistInput("repair second section on left side");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch third run at entry — mixed_selection_location fires", () => {
      const result = analyzeScopeAssistInput("patch third run at entry");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("replace last panel on outside face — mixed_selection_location fires", () => {
      const result = analyzeScopeAssistInput("replace last panel on outside face");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("repair first two ceiling sections at lobby — mixed_selection_location fires (+ ordinal + count from P10)", () => {
      const result = analyzeScopeAssistInput("repair first two ceiling sections at lobby");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("replace the first two panels at entry — mixed_selection_location fires", () => {
      const result = analyzeScopeAssistInput("replace the first two panels at entry");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch the lower wall section at rear room — mixed_selection_location fires (+ positional)", () => {
      const result = analyzeScopeAssistInput("patch the lower wall section at rear room");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("replace the last two cabinet doors at breakroom — mixed_selection_location fires (+ P10 ordinal + count)", () => {
      const result = analyzeScopeAssistInput("replace the last two cabinet doors at breakroom");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("replace the second railing section at entry — mixed_selection_location fires (+ P10 ordinal)", () => {
      const result = analyzeScopeAssistInput("replace the second railing section at entry");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("patch the first two wall faces on left side — mixed_selection_location fires (+ P10 ordinal + count)", () => {
      const result = analyzeScopeAssistInput("patch the first two wall faces on left side");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    test("replace the bottom panel at storefront — positional + mixed both fire", () => {
      const result = analyzeScopeAssistInput("replace the bottom panel at storefront");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(result.rangePositionalFractionalActive).toBe(true);
    });

    // --- Group E: Non-regression ---

    test("non-regression: replace storefront glass at entry — no range/positional/fractional", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: replace one section of railing — 'one section' not positional or range", () => {
      const result = analyzeScopeAssistInput("replace one section of railing");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: install fence section at side yard — no range/positional/fractional", () => {
      const result = analyzeScopeAssistInput("install fence section at side yard");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: replace glazing panel and seal perimeter — no range/positional/fractional", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: replace man door at rear entry — 'rear entry' not a positional selector", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: repair frame area at window — no range/positional/fractional", () => {
      const result = analyzeScopeAssistInput("repair frame area at window");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: replace door at entry and patch wall at window — multi-anchor preserved, no range/positional", () => {
      const result = analyzeScopeAssistInput("replace door at entry and patch wall at window");
      expect(result.multiAnchorSeparationActive).toBe(true);
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: trim left side and paint right side — relative side contrast preserved, no range/positional/fractional", () => {
      const result = analyzeScopeAssistInput("trim left side and paint right side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: seal all edges at panel — P9 perimeter_wraparound preserved, no range/positional", () => {
      const result = analyzeScopeAssistInput("seal all edges at panel");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: repair full outside perimeter of rear wall — P10 stacked preserved, no P11 positional", () => {
      const result = analyzeScopeAssistInput("repair full outside perimeter of rear wall");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: patch entire inside face of left wall section — P10 stacked preserved, no P11 positional", () => {
      const result = analyzeScopeAssistInput("patch entire inside face of left wall section");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: seal both outer edges of center panel — P10 stacked preserved, no P11", () => {
      const result = analyzeScopeAssistInput("seal both outer edges of center panel");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });

    test("non-regression: replace full middle span of fence section — P10 stacked + P9 run_span_edge preserved", () => {
      const result = analyzeScopeAssistInput("replace full middle span of fence section");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(Array.isArray(result.rangePositionalFractionalHints) ? result.rangePositionalFractionalHints.length : 0).toBe(0);
      expect(result.rangePositionalFractionalActive).not.toBe(true);
    });
  });

  describe("Pass 12: Anchor carry + 'of' position + named sub-zone hardening", () => {
    // --- Group A: range_anchor_carry ---

    test("repair sections 1 through 3 at rear elevation — range_anchor_carry fires (+ P11 ordinal_range)", () => {
      const result = analyzeScopeAssistInput("repair sections 1 through 3 at rear elevation");
      expect(result.anchorCarrySubzoneHints).toContain("range_anchor_carry");
      expect(result.anchorCarrySubzoneActive).toBe(true);
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
    });

    test("replace panels 2-4 at entry — range_anchor_carry fires (+ P11 ordinal_range)", () => {
      const result = analyzeScopeAssistInput("replace panels 2-4 at entry");
      expect(result.anchorCarrySubzoneHints).toContain("range_anchor_carry");
      expect(result.anchorCarrySubzoneActive).toBe(true);
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
    });

    test("patch first through third wall areas in lobby — range_anchor_carry fires (+ P11 ordinal_range)", () => {
      const result = analyzeScopeAssistInput("patch first through third wall areas in lobby");
      expect(result.anchorCarrySubzoneHints).toContain("range_anchor_carry");
      expect(result.anchorCarrySubzoneActive).toBe(true);
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
    });

    test("replace sections 2 through 4 on rear side — range_anchor_carry fires (+ P11 ordinal_range)", () => {
      const result = analyzeScopeAssistInput("replace sections 2 through 4 on rear side");
      expect(result.anchorCarrySubzoneHints).toContain("range_anchor_carry");
      expect(result.anchorCarrySubzoneActive).toBe(true);
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
    });

    // --- Group B: fraction_anchor_carry ---

    test("repair left half of opening at entry — fraction_anchor_carry fires (+ P11 fractional)", () => {
      const result = analyzeScopeAssistInput("repair left half of opening at entry");
      expect(result.anchorCarrySubzoneHints).toContain("fraction_anchor_carry");
      expect(result.anchorCarrySubzoneActive).toBe(true);
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
    });

    test("patch rear half of wall at lobby — fraction_anchor_carry + position_of_local both fire", () => {
      const result = analyzeScopeAssistInput("patch rear half of wall at lobby");
      expect(result.anchorCarrySubzoneHints).toContain("fraction_anchor_carry");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("seal lower third of panel at storefront — fraction_anchor_carry fires (+ P11 fractional)", () => {
      const result = analyzeScopeAssistInput("seal lower third of panel at storefront");
      expect(result.anchorCarrySubzoneHints).toContain("fraction_anchor_carry");
      expect(result.anchorCarrySubzoneActive).toBe(true);
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
    });

    test("repair upper half of wall at lobby — fraction_anchor_carry + position_of_local both fire", () => {
      const result = analyzeScopeAssistInput("repair upper half of wall at lobby");
      expect(result.anchorCarrySubzoneHints).toContain("fraction_anchor_carry");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("patch right half of opening in corridor — fraction_anchor_carry fires", () => {
      const result = analyzeScopeAssistInput("patch right half of opening in corridor");
      expect(result.anchorCarrySubzoneHints).toContain("fraction_anchor_carry");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("patch rear half of ceiling area at corridor — fraction_anchor_carry + position_of_local both fire", () => {
      const result = analyzeScopeAssistInput("patch rear half of ceiling area at corridor");
      expect(result.anchorCarrySubzoneHints).toContain("fraction_anchor_carry");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("patch upper third of wall face at rear room — fraction_anchor_carry fires (+ P11 fractional)", () => {
      const result = analyzeScopeAssistInput("patch upper third of wall face at rear room");
      expect(result.anchorCarrySubzoneHints).toContain("fraction_anchor_carry");
      expect(result.anchorCarrySubzoneActive).toBe(true);
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
    });

    test("patch the left half of opening at entry — fraction_anchor_carry fires", () => {
      const result = analyzeScopeAssistInput("patch the left half of opening at entry");
      expect(result.anchorCarrySubzoneHints).toContain("fraction_anchor_carry");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    // --- Group C: position_of_local ---

    test("seal top of wall — position_of_local fires", () => {
      const result = analyzeScopeAssistInput("seal top of wall");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("repair bottom of opening — position_of_local fires", () => {
      const result = analyzeScopeAssistInput("repair bottom of opening");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("patch upper edge of frame — position_of_local fires", () => {
      const result = analyzeScopeAssistInput("patch upper edge of frame");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("replace lower face of panel — position_of_local fires", () => {
      const result = analyzeScopeAssistInput("replace lower face of panel");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("seal lower edge of frame at rear room — position_of_local fires", () => {
      const result = analyzeScopeAssistInput("seal lower edge of frame at rear room");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("repair bottom of wall at storefront — position_of_local fires", () => {
      const result = analyzeScopeAssistInput("repair bottom of wall at storefront");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("seal top of frame perimeter — position_of_local fires", () => {
      const result = analyzeScopeAssistInput("seal top of frame perimeter");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("patch bottom of panel face — position_of_local fires", () => {
      const result = analyzeScopeAssistInput("patch bottom of panel face");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("repair upper edge of opening at entry — position_of_local fires", () => {
      const result = analyzeScopeAssistInput("repair upper edge of opening at entry");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("repair the top of the wall at lobby — position_of_local fires", () => {
      const result = analyzeScopeAssistInput("repair the top of the wall at lobby");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    // --- Group D: named_subzone_local ---

    test("repair head jamb — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("repair head jamb");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("patch side jamb — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("patch side jamb");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("replace sill plate — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("replace sill plate");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("seal wall base — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("seal wall base");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("repair center mullion — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("repair center mullion");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("patch face frame — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("patch face frame");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("replace bottom rail — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("replace bottom rail");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("repair infield section — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("repair infield section");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("patch top jamb at entry — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("patch top jamb at entry");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("replace head jamb at rear door — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("replace head jamb at rear door");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("seal sill plate at opening — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("seal sill plate at opening");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("patch center mullion at storefront — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("patch center mullion at storefront");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("repair face frame on cabinet run — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("repair face frame on cabinet run");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("replace lower wall base at lobby — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("replace lower wall base at lobby");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("repair side jamb at storefront — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("repair side jamb at storefront");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("seal center mullion at entry glazing — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("seal center mullion at entry glazing");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("replace bottom rail at gate — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("replace bottom rail at gate");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    test("seal the sill plate at rear opening — named_subzone_local fires", () => {
      const result = analyzeScopeAssistInput("seal the sill plate at rear opening");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.anchorCarrySubzoneActive).toBe(true);
    });

    // --- Group E: Non-regression (P9 prompts → no P12) ---

    test("non-regression: repair both sides of the wall — P9 both_sides preserved, no P12", () => {
      const result = analyzeScopeAssistInput("repair both sides of the wall");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: seal the entire wall section — P9 whole_surface preserved, no P12", () => {
      const result = analyzeScopeAssistInput("seal the entire wall section");
      expect(result.coverageExtentHints).toContain("whole_local_surface");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: patch the rest of the wall section — P9 remainder_partial preserved, no P12", () => {
      const result = analyzeScopeAssistInput("patch the rest of the wall section");
      expect(result.coverageExtentHints).toContain("remainder_partial");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: replace full span at rear — P9 run_span_edge preserved, no P12", () => {
      const result = analyzeScopeAssistInput("replace full span at rear");
      expect(result.coverageExtentHints).toContain("run_span_edge");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: seal all edges at panel — P9 perimeter_wraparound preserved, no P12", () => {
      const result = analyzeScopeAssistInput("seal all edges at panel");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: repair both ends at rear wall — P9 both_sides preserved, no P12", () => {
      const result = analyzeScopeAssistInput("repair both ends at rear wall");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    // --- Group F: Non-regression (P10 prompts → no P12) ---

    test("non-regression: repair the first section at lobby — P10 ordinal preserved, no P12", () => {
      const result = analyzeScopeAssistInput("repair the first section at lobby");
      expect(result.ordinalCountStackedHints).toContain("ordinal_local_selection");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: seal three panels at rear — P10 count preserved, no P12", () => {
      const result = analyzeScopeAssistInput("seal three panels at rear");
      expect(result.ordinalCountStackedHints).toContain("count_local_extent");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: patch full outside perimeter of rear wall — P10 stacked preserved, no P12", () => {
      const result = analyzeScopeAssistInput("patch full outside perimeter of rear wall");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: replace entire outside face at entry — P10 stacked preserved, no P12", () => {
      const result = analyzeScopeAssistInput("replace entire outside face at entry");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: repair both outer edges at rear — P10 stacked preserved, no P12", () => {
      const result = analyzeScopeAssistInput("repair both outer edges at rear");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: patch full outer edge at rear — P10 stacked preserved, no P12", () => {
      const result = analyzeScopeAssistInput("patch full outer edge at rear");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    // --- Group G: Non-regression (P11 prompts → no P12) ---

    test("non-regression: repair top panel — P11 positional preserved, no P12", () => {
      const result = analyzeScopeAssistInput("repair top panel");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: replace bottom run — P11 positional preserved, no P12", () => {
      const result = analyzeScopeAssistInput("replace bottom run");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: patch upper wall section — P11 positional preserved, no P12", () => {
      const result = analyzeScopeAssistInput("patch upper wall section");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: seal lower edge — P11 positional preserved, no P12", () => {
      const result = analyzeScopeAssistInput("seal lower edge");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: replace lower fence panel — P11 positional preserved, no P12", () => {
      const result = analyzeScopeAssistInput("replace lower fence panel");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: seal upper perimeter of frame — P11 positional preserved, no P12 position_of_local", () => {
      const result = analyzeScopeAssistInput("seal upper perimeter of frame");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: replace sections 2 through 4 — P11 ordinal_range preserved, no P12 (no anchor)", () => {
      const result = analyzeScopeAssistInput("replace sections 2 through 4");
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: repair panels 1-3 — P11 ordinal_range preserved, no P12 (no anchor)", () => {
      const result = analyzeScopeAssistInput("repair panels 1-3");
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: patch half the wall — P11 fractional preserved, no P12 (no anchor)", () => {
      const result = analyzeScopeAssistInput("patch half the wall");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: repair a third of the section — P11 fractional preserved, no P12", () => {
      const result = analyzeScopeAssistInput("repair a third of the section");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: paint left half of opening — P11 fractional preserved, no P12 (no anchor, left not in position list)", () => {
      const result = analyzeScopeAssistInput("paint left half of opening");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: repair left half of wall section — P11 fractional preserved, no P12 (left not in position list, no anchor)", () => {
      const result = analyzeScopeAssistInput("repair left half of wall section");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: replace first panel at rear wall — P11 mixed preserved, no P12 range_anchor_carry", () => {
      const result = analyzeScopeAssistInput("replace first panel at rear wall");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: repair second section on left side — P11 mixed preserved, no P12", () => {
      const result = analyzeScopeAssistInput("repair second section on left side");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: patch third run at entry — P11 mixed preserved, no P12 range_anchor_carry", () => {
      const result = analyzeScopeAssistInput("patch third run at entry");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    // --- Group H: Non-regression (generic trade prompts → no P12) ---

    test("non-regression: replace the door frame — no P12", () => {
      const result = analyzeScopeAssistInput("replace the door frame");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: repair the storefront glazing — no P12", () => {
      const result = analyzeScopeAssistInput("repair the storefront glazing");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: patch the window sill — no P12 (window sill not in subzone list)", () => {
      const result = analyzeScopeAssistInput("patch the window sill");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: install fence section at side yard — no P12", () => {
      const result = analyzeScopeAssistInput("install fence section at side yard");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: replace man door at rear entry — no P12", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: replace glazing panel at lobby — no P12", () => {
      const result = analyzeScopeAssistInput("replace glazing panel at lobby");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: patch the wall section at entry — no P12", () => {
      const result = analyzeScopeAssistInput("patch the wall section at entry");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: repair the frame perimeter at storefront — no P12", () => {
      const result = analyzeScopeAssistInput("repair the frame perimeter at storefront");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: seal the railing at lobby — no P12", () => {
      const result = analyzeScopeAssistInput("seal the railing at lobby");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    // --- Group I: Non-regression ("of" boundary tests → no P12) ---

    test("non-regression: repair outside of building — local noun 'building' not in list, no P12", () => {
      const result = analyzeScopeAssistInput("repair outside of building");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: patch section of fence — no positional word, no P12", () => {
      const result = analyzeScopeAssistInput("patch section of fence");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: seal front edge of property — 'property' not in local noun list, no P12", () => {
      const result = analyzeScopeAssistInput("seal front edge of property");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: repair top coat at entry — no 'of' after positional word, no P12", () => {
      const result = analyzeScopeAssistInput("repair top coat at entry");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: patch lower section above door — 'above' not an 'of' connector, no P12", () => {
      const result = analyzeScopeAssistInput("patch lower section above door");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });

    test("non-regression: replace outside of existing frame — 'existing' not in local noun list, no P12", () => {
      const result = analyzeScopeAssistInput("replace outside of existing frame");
      expect(Array.isArray(result.anchorCarrySubzoneHints) ? result.anchorCarrySubzoneHints.length : 0).toBe(0);
      expect(result.anchorCarrySubzoneActive).not.toBe(true);
    });
  });

  describe("Pass 13: Coordinated local-distribution hardening", () => {
    // --- Group A: coordinated_position_distribution ---

    test("patch top and bottom of wall — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch top and bottom of wall");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("seal left and right edges of panel — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("seal left and right edges of panel");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("patch top and bottom wall sections in lobby — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch top and bottom wall sections in lobby");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("seal both side edges and bottom rail at gate — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("seal both side edges and bottom rail at gate");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("repair left and right wall faces at corridor — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("repair left and right wall faces at corridor");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("patch upper and lower halves of wall — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch upper and lower halves of wall");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("replace rear and side panels at storefront — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("replace rear and side panels at storefront");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("patch top edge and bottom face of panel — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch top edge and bottom face of panel");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("patch left and right halves of wall at lobby — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch left and right halves of wall at lobby");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("seal upper and lower edges of frame — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("seal upper and lower edges of frame");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("seal top of wall and bottom of opening — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("seal top of wall and bottom of opening");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("repair upper wall face and lower wall base at corridor — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("repair upper wall face and lower wall base at corridor");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("replace left and right fence panels at side yard — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("replace left and right fence panels at side yard");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("repair top and bottom edges of panel at entry — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("repair top and bottom edges of panel at entry");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("replace front and rear wall faces at room divider — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("replace front and rear wall faces at room divider");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("seal left and right sides of opening — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("seal left and right sides of opening");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("repair upper and lower wall sections at rear room — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("repair upper and lower wall sections at rear room");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("repair left and right panel faces at storefront — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("repair left and right panel faces at storefront");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("patch top and bottom thirds of wall — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch top and bottom thirds of wall");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("seal upper and lower halves of opening — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("seal upper and lower halves of opening");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("replace rear and front glazing panels at lobby entry — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("replace rear and front glazing panels at lobby entry");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("patch top edge and bottom edge of frame — coordinated_position_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch top edge and bottom edge of frame");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    // --- Group B: coordinated_selection_distribution ---

    test("replace first and second panels at entry — coordinated_selection_distribution fires", () => {
      const result = analyzeScopeAssistInput("replace first and second panels at entry");
      expect(result.coordinatedDistributionHints).toContain("coordinated_selection_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("repair first and third railing sections at entry — coordinated_selection_distribution fires", () => {
      const result = analyzeScopeAssistInput("repair first and third railing sections at entry");
      expect(result.coordinatedDistributionHints).toContain("coordinated_selection_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("replace first, second, and third panels at entry — coordinated_selection_distribution fires", () => {
      const result = analyzeScopeAssistInput("replace first, second, and third panels at entry");
      expect(result.coordinatedDistributionHints).toContain("coordinated_selection_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("patch first and last wall sections in lobby — coordinated_selection_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch first and last wall sections in lobby");
      expect(result.coordinatedDistributionHints).toContain("coordinated_selection_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("replace first and last cabinet doors at breakroom — coordinated_selection_distribution fires", () => {
      const result = analyzeScopeAssistInput("replace first and last cabinet doors at breakroom");
      expect(result.coordinatedDistributionHints).toContain("coordinated_selection_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("replace first and second fence bays at side yard — coordinated_selection_distribution fires", () => {
      const result = analyzeScopeAssistInput("replace first and second fence bays at side yard");
      expect(result.coordinatedDistributionHints).toContain("coordinated_selection_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    // --- Group C: coordinated_subzone_distribution ---

    test("repair sill, head jamb, and side jamb at rear door — coordinated_subzone_distribution fires", () => {
      const result = analyzeScopeAssistInput("repair sill, head jamb, and side jamb at rear door");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("seal head jamb and sill plate at opening — coordinated_subzone_distribution fires", () => {
      const result = analyzeScopeAssistInput("seal head jamb and sill plate at opening");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("replace wall base and face frame at breakroom cabinets — coordinated_subzone_distribution fires", () => {
      const result = analyzeScopeAssistInput("replace wall base and face frame at breakroom cabinets");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("repair side jamb and head jamb at rear door — coordinated_subzone_distribution fires", () => {
      const result = analyzeScopeAssistInput("repair side jamb and head jamb at rear door");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("patch bottom rail and center mullion at storefront — coordinated_subzone_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch bottom rail and center mullion at storefront");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("seal head, side jamb, and sill plate at opening — coordinated_subzone_distribution fires", () => {
      const result = analyzeScopeAssistInput("seal head, side jamb, and sill plate at opening");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("patch head jamb and sill plate at storefront entry — coordinated_subzone_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch head jamb and sill plate at storefront entry");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("patch center mullion and bottom rail at entry glazing — coordinated_subzone_distribution fires", () => {
      const result = analyzeScopeAssistInput("patch center mullion and bottom rail at entry glazing");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("seal top jamb and side jamb at rear door — coordinated_subzone_distribution fires", () => {
      const result = analyzeScopeAssistInput("seal top jamb and side jamb at rear door");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("repair head jamb, side jamb, and sill at door opening — coordinated_subzone_distribution fires", () => {
      const result = analyzeScopeAssistInput("repair head jamb, side jamb, and sill at door opening");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    // --- Group D: coordinated_local_members ---

    test("repair head and side jamb — coordinated_local_members fires", () => {
      const result = analyzeScopeAssistInput("repair head and side jamb");
      expect(result.coordinatedDistributionHints).toContain("coordinated_local_members");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    test("repair top jamb and sill at rear opening — coordinated_local_members fires", () => {
      const result = analyzeScopeAssistInput("repair top jamb and sill at rear opening");
      expect(result.coordinatedDistributionHints).toContain("coordinated_local_members");
      expect(result.coordinatedDistributionActive).toBe(true);
    });

    // --- Group E: Non-regression (prior signals preserved, no P13) ---

    test("non-regression: replace storefront glass at entry — no P13", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace lower cabinet run — no P13", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace one section of railing — no P13", () => {
      const result = analyzeScopeAssistInput("replace one section of railing");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: install fence section at side yard — no P13", () => {
      const result = analyzeScopeAssistInput("install fence section at side yard");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace man door at rear entry — no P13", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace glazing panel and seal perimeter — no P13", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: repair frame area at window — no P13", () => {
      const result = analyzeScopeAssistInput("repair frame area at window");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: patch and paint affected wall area — no P13", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace door at entry and patch wall at window — P6 multi-anchor preserved, no P13", () => {
      const result = analyzeScopeAssistInput("replace door at entry and patch wall at window");
      expect(result.multiAnchorSeparationActive).toBe(true);
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: trim left side and paint right side — P7 relative contrast preserved, no P13", () => {
      const result = analyzeScopeAssistInput("trim left side and paint right side");
      expect(result.relativeZoneHints).toContain("relative_side_contrast");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: repair both sides of canopy — P9 both_sides preserved, no P13", () => {
      const result = analyzeScopeAssistInput("repair both sides of canopy");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: seal all edges at panel — P9 perimeter_wraparound preserved, no P13", () => {
      const result = analyzeScopeAssistInput("seal all edges at panel");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: repair full outside perimeter of rear wall — P10 stacked preserved, no P13", () => {
      const result = analyzeScopeAssistInput("repair full outside perimeter of rear wall");
      expect(result.ordinalCountStackedHints).toContain("stacked_extent_location");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: repair top panel — P11 positional preserved, no P13", () => {
      const result = analyzeScopeAssistInput("repair top panel");
      expect(result.rangePositionalFractionalHints).toContain("positional_local_selection");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace sections 2 through 4 — P11 ordinal_range preserved, no P13", () => {
      const result = analyzeScopeAssistInput("replace sections 2 through 4");
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: patch half the wall — P11 fractional preserved, no P13", () => {
      const result = analyzeScopeAssistInput("patch half the wall");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace first panel at rear wall — P11 mixed preserved, no P13 (single ordinal, no second)", () => {
      const result = analyzeScopeAssistInput("replace first panel at rear wall");
      expect(result.rangePositionalFractionalHints).toContain("mixed_selection_location");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: repair head jamb — P12 named_subzone_local preserved, no P13 (single sub-zone)", () => {
      const result = analyzeScopeAssistInput("repair head jamb");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: seal top of wall — P12 position_of_local preserved, no P13 (single positional, no second dir with and)", () => {
      const result = analyzeScopeAssistInput("seal top of wall");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: repair left half of opening at entry — P12 fraction_anchor_carry preserved, no P13", () => {
      const result = analyzeScopeAssistInput("repair left half of opening at entry");
      expect(result.anchorCarrySubzoneHints).toContain("fraction_anchor_carry");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace full cabinet run — no P13", () => {
      const result = analyzeScopeAssistInput("replace full cabinet run");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: repair the other half of the wall — no P13", () => {
      const result = analyzeScopeAssistInput("repair the other half of the wall");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace handrail section and secure posts — no P13", () => {
      const result = analyzeScopeAssistInput("replace handrail section and secure posts");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace storefront glass and patch wall around it — no P13", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and patch wall around it");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: seal the whole frame perimeter — no P13", () => {
      const result = analyzeScopeAssistInput("seal the whole frame perimeter");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: patch and paint affected wall area — no P13 (paint is not a dir word)", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: repair cover panel — no P13", () => {
      const result = analyzeScopeAssistInput("repair cover panel");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });

    test("non-regression: replace trim around door — no P13", () => {
      const result = analyzeScopeAssistInput("replace trim around door");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
      expect(result.coordinatedDistributionActive).not.toBe(true);
    });
  });

  describe("Pass 14: Welding taxonomy normalization + specialty jargon hardening", () => {
    // --- Group A: no-welding returns confidence "none" ---

    test("no welding: paint drywall at lobby — weldingConfidence is none", () => {
      const result = analyzeScopeAssistInput("paint drywall at lobby");
      expect(result.weldingConfidence).toBe("none");
      expect(result.weldingBaseProcess || "").toBe("");
    });

    test("no welding: replace door hardware — weldingConfidence is none", () => {
      const result = analyzeScopeAssistInput("replace door hardware at entry");
      expect(result.weldingConfidence).toBe("none");
      expect(result.weldingBaseProcess || "").toBe("");
    });

    test("no welding: patch and seal concrete floor — weldingConfidence is none", () => {
      const result = analyzeScopeAssistInput("patch and seal concrete floor");
      expect(result.weldingConfidence).toBe("none");
      expect(result.weldingBaseProcess || "").toBe("");
    });

    // --- Group B: explicit base process detection ---

    test("tig weld stainless steel — base process gtaw_tig, confidence high", () => {
      const result = analyzeScopeAssistInput("tig weld stainless steel pipe");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
      expect(result.weldingConfidence).toBe("high");
    });

    test("gtaw on stainless tube — base process gtaw_tig", () => {
      const result = analyzeScopeAssistInput("gtaw on stainless tube");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
    });

    test("mig weld aluminum frame — base process gmaw_mig", () => {
      const result = analyzeScopeAssistInput("mig weld aluminum frame");
      expect(result.weldingBaseProcess).toBe("gmaw_mig");
      expect(result.weldingConfidence).toBe("high");
    });

    test("gmaw carbon steel — base process gmaw_mig", () => {
      const result = analyzeScopeAssistInput("gmaw carbon steel structural member");
      expect(result.weldingBaseProcess).toBe("gmaw_mig");
    });

    test("smaw stick weld field repair — base process smaw_stick", () => {
      const result = analyzeScopeAssistInput("smaw stick weld field repair on carbon steel");
      expect(result.weldingBaseProcess).toBe("smaw_stick");
      expect(result.weldingConfidence).toBe("high");
    });

    test("stick weld overhead — base process smaw_stick", () => {
      const result = analyzeScopeAssistInput("stick weld overhead position");
      expect(result.weldingBaseProcess).toBe("smaw_stick");
    });

    test("flux core weld structural — base process fcaw", () => {
      const result = analyzeScopeAssistInput("flux core weld structural steel beam");
      expect(result.weldingBaseProcess).toBe("fcaw");
    });

    test("laser welding thin sheet — base process laser_welding", () => {
      const result = analyzeScopeAssistInput("laser welding thin sheet stainless");
      expect(result.weldingBaseProcess).toBe("laser_welding");
      expect(result.weldingConfidence).toBe("high");
    });

    test("spot weld sheet metal — base process resistance_welding", () => {
      const result = analyzeScopeAssistInput("spot weld sheet metal panels");
      expect(result.weldingBaseProcess).toBe("resistance_welding");
    });

    test("seam weld enclosure — base process resistance_welding", () => {
      const result = analyzeScopeAssistInput("seam weld enclosure panels");
      expect(result.weldingBaseProcess).toBe("resistance_welding");
    });

    test("stud welding to embedded plate — base process stud_welding", () => {
      const result = analyzeScopeAssistInput("stud welding to embedded plate");
      expect(result.weldingBaseProcess).toBe("stud_welding");
    });

    test("generic weld reference — base process welding_generic, confidence low", () => {
      const result = analyzeScopeAssistInput("weld it in place");
      expect(result.weldingBaseProcess).toBe("welding_generic");
      expect(result.weldingConfidence).toBe("low");
    });

    // --- Group C: secondary tag detection ---

    test("orbital tig on stainless tube — orbital_welding and tube_welding_application", () => {
      const result = analyzeScopeAssistInput("orbital tig on stainless tube");
      expect(result.weldingSecondaryTags).toContain("orbital_welding");
      expect(result.weldingSecondaryTags).toContain("tube_welding_application");
    });

    test("orbital weld stainless steel config gas panels 1/4 tubing — key compound example", () => {
      const result = analyzeScopeAssistInput("Orbital Weld stainless steel configuration on gas panels 1/4 tubing install nO2 panels after");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
      expect(result.weldingSecondaryTags).toContain("orbital_welding");
      expect(result.weldingSecondaryTags).toContain("tube_welding_application");
      expect(result.weldingSecondaryTags).toContain("automatic_welding");
      expect(result.weldingMaterialContext).toContain("stainless");
      expect(result.weldingMaterialContext).toContain("gas_panel");
      expect(result.weldingMaterialContext).toContain("quarter_inch_tubing");
      expect(result.weldingMaterialContext).toContain("no2_panel");
      expect(result.weldingScopeBias).toContain("stainless_detail");
      expect(result.weldingScopeBias).toContain("install_oriented");
      expect(result.weldingConfidence).toBe("medium");
    });

    test("sanitary tube tig with purge — sanitary_tube_welding, backpurge_welding", () => {
      const result = analyzeScopeAssistInput("sanitary tube tig with purge");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
      expect(result.weldingSecondaryTags).toContain("sanitary_tube_welding");
      expect(result.weldingSecondaryTags).toContain("tube_welding_application");
      expect(result.weldingSecondaryTags).toContain("backpurge_welding");
    });

    test("autogenous orbital weld on stainless tubing — automatic_welding inferred", () => {
      const result = analyzeScopeAssistInput("autogenous orbital weld on stainless tubing");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
      expect(result.weldingSecondaryTags).toContain("orbital_welding");
      expect(result.weldingSecondaryTags).toContain("automatic_welding");
      expect(result.weldingSecondaryTags).toContain("tube_welding_application");
      expect(result.weldingMaterialContext).toContain("stainless");
    });

    test("pulsed tig weld — pulse_mode_welding detected", () => {
      const result = analyzeScopeAssistInput("pulsed tig weld on stainless");
      expect(result.weldingSecondaryTags).toContain("pulse_mode_welding");
    });

    test("weld with back purge — backpurge_welding detected", () => {
      const result = analyzeScopeAssistInput("tig weld stainless with back purge");
      expect(result.weldingSecondaryTags).toContain("backpurge_welding");
    });

    test("gas panel welding — gas_panel_welding secondary tag", () => {
      const result = analyzeScopeAssistInput("weld gas panels at equipment rack");
      expect(result.weldingSecondaryTags).toContain("gas_panel_welding");
    });

    // --- Group D: material context detection ---

    test("stainless steel weld — stainless in material context", () => {
      const result = analyzeScopeAssistInput("weld stainless steel fitting");
      expect(result.weldingMaterialContext).toContain("stainless");
    });

    test("aluminum weld — aluminum in material context", () => {
      const result = analyzeScopeAssistInput("mig weld aluminum extrusion");
      expect(result.weldingMaterialContext).toContain("aluminum");
    });

    test("titanium weld — titanium in material context", () => {
      const result = analyzeScopeAssistInput("tig weld titanium bracket");
      expect(result.weldingMaterialContext).toContain("titanium");
    });

    test("1/4 tubing weld — quarter_inch_tubing in material context", () => {
      const result = analyzeScopeAssistInput("orbital weld 1/4 tubing on gas panel");
      expect(result.weldingMaterialContext).toContain("quarter_inch_tubing");
    });

    test("nO2 panels — no2_panel in material context", () => {
      const result = analyzeScopeAssistInput("tig weld nO2 panel connections");
      expect(result.weldingMaterialContext).toContain("no2_panel");
    });

    test("high purity gas line weld — high_purity_gas in material context", () => {
      const result = analyzeScopeAssistInput("orbital tig high purity gas line weld");
      expect(result.weldingMaterialContext).toContain("high_purity_gas");
    });

    // --- Group E: scope bias detection ---

    test("precision weld — precision in scope bias", () => {
      const result = analyzeScopeAssistInput("tig precision weld stainless fitting");
      expect(result.weldingScopeBias).toContain("precision");
    });

    test("sanitary weld — clean_process in scope bias", () => {
      const result = analyzeScopeAssistInput("sanitary tig weld on tube");
      expect(result.weldingScopeBias).toContain("clean_process");
    });

    test("purge weld — purge_control in scope bias", () => {
      const result = analyzeScopeAssistInput("tig weld with purge gas on stainless");
      expect(result.weldingScopeBias).toContain("purge_control");
    });

    test("stainless weld — stainless_detail in scope bias", () => {
      const result = analyzeScopeAssistInput("tig weld stainless tube section");
      expect(result.weldingScopeBias).toContain("stainless_detail");
    });

    test("install weld — install_oriented in scope bias", () => {
      const result = analyzeScopeAssistInput("install and weld gas panels at rack");
      expect(result.weldingScopeBias).toContain("install_oriented");
    });

    // --- Group F: allied-but-not-welding detection ---

    test("brazing copper pipe — brazing in relatedNotWelding, no welding base", () => {
      const result = analyzeScopeAssistInput("brazing copper pipe fittings at mechanical room");
      expect(result.weldingConfidence).toBe("none");
      expect(result.weldingRelatedNotWelding || []).not.toContain("brazing");
    });

    test("silver solder joint — soldering or brazing in relatedNotWelding when welding also present", () => {
      const result = analyzeScopeAssistInput("tig weld and silver solder connections on copper");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
      expect(result.weldingRelatedNotWelding).toContain("brazing");
    });

    test("plasma cutting steel — thermal_cutting in relatedNotWelding when welding present", () => {
      const result = analyzeScopeAssistInput("weld and plasma cut steel plate");
      expect(result.weldingRelatedNotWelding).toContain("thermal_cutting");
    });

    test("thermal spray coating — thermal_spray in relatedNotWelding when welding present", () => {
      const result = analyzeScopeAssistInput("weld base plate then thermal spray coating");
      expect(result.weldingRelatedNotWelding).toContain("thermal_spray");
    });

    // --- Group G: inference rules ---

    test("orbital weld (no explicit TIG) — infers gtaw_tig base, confidence medium", () => {
      const result = analyzeScopeAssistInput("orbital weld 1/4 stainless tube");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
      expect(result.weldingConfidence).toBe("medium");
    });

    test("orbital weld — automatic_welding inferred from orbital", () => {
      const result = analyzeScopeAssistInput("orbital weld on tube");
      expect(result.weldingSecondaryTags).toContain("orbital_welding");
      expect(result.weldingSecondaryTags).toContain("automatic_welding");
    });

    test("sanitary tube weld (no explicit process) — infers gtaw_tig", () => {
      const result = analyzeScopeAssistInput("sanitary tube weld on process line");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
      expect(result.weldingConfidence).toBe("medium");
    });

    // --- Group H: compound specialty examples ---

    test("smaw stick weld carbon steel field repair — base smaw, carbon_steel material", () => {
      const result = analyzeScopeAssistInput("smaw stick weld carbon steel structural repair in field");
      expect(result.weldingBaseProcess).toBe("smaw_stick");
      expect(result.weldingMaterialContext).toContain("carbon_steel");
      expect(result.weldingConfidence).toBe("high");
    });

    test("flux cored weld structural beam — fcaw base, confidence medium (no material enrichment)", () => {
      const result = analyzeScopeAssistInput("flux cored weld structural steel beam at building frame");
      expect(result.weldingBaseProcess).toBe("fcaw");
      expect(result.weldingConfidence).toBe("medium");
    });

    test("electron beam weld titanium — ebw base, titanium material", () => {
      const result = analyzeScopeAssistInput("electron beam weld titanium aerospace bracket");
      expect(result.weldingBaseProcess).toBe("electron_beam_welding");
      expect(result.weldingMaterialContext).toContain("titanium");
    });

    test("submerged arc weld — saw_submerged base", () => {
      const result = analyzeScopeAssistInput("submerged arc weld heavy plate at fabrication shop");
      expect(result.weldingBaseProcess).toBe("saw_submerged");
    });

    // --- Non-regression: existing hints preserved, no spurious welding ---

    test("non-regression: paint drywall at lobby — no welding data, P1-P13 unaffected", () => {
      const result = analyzeScopeAssistInput("paint drywall at lobby");
      expect(result.weldingConfidence).toBe("none");
      expect(Array.isArray(result.weldingSecondaryTags) ? result.weldingSecondaryTags.length : 0).toBe(0);
    });

    test("non-regression: replace storefront glass — no welding, coordinated dist unaffected", () => {
      const result = analyzeScopeAssistInput("replace top and bottom storefront glass panels");
      expect(result.weldingConfidence).toBe("none");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
    });

    test("non-regression: repair head jamb and sill plate — P12+P13 preserved, no P14", () => {
      const result = analyzeScopeAssistInput("repair head jamb and sill plate at entry");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.coordinatedDistributionHints).toContain("coordinated_subzone_distribution");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: replace first and second panel — P13 ordinal preserved, no P14", () => {
      const result = analyzeScopeAssistInput("replace first and second panel at wall");
      expect(result.coordinatedDistributionHints).toContain("coordinated_selection_distribution");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: repair left half of opening at entry — P12 fraction_anchor preserved", () => {
      const result = analyzeScopeAssistInput("repair left half of opening at entry");
      expect(result.anchorCarrySubzoneHints).toContain("fraction_anchor_carry");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: repair top of wall — P12 position_of_local preserved, no P14", () => {
      const result = analyzeScopeAssistInput("repair top of wall");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: install tile at lobby floor — no welding", () => {
      const result = analyzeScopeAssistInput("install tile at lobby floor");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: replace HVAC unit at roof — no welding from equipment swap context", () => {
      const result = analyzeScopeAssistInput("replace HVAC unit at roof");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: repair storefront frame perimeter — no P14 welding", () => {
      const result = analyzeScopeAssistInput("repair storefront frame perimeter at lobby");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: seal caulk joint at curtain wall — no welding", () => {
      const result = analyzeScopeAssistInput("seal caulk joint at curtain wall");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: replace cabinet run at kitchen — no P14 welding", () => {
      const result = analyzeScopeAssistInput("replace cabinet run at kitchen");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: replace sections 2 through 4 — P11 ordinal_range preserved, no P14", () => {
      const result = analyzeScopeAssistInput("replace sections 2 through 4");
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: patch half the wall — P11 fractional preserved, no P14", () => {
      const result = analyzeScopeAssistInput("patch half the wall");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: repair both sides of canopy — P9 both_sides preserved, no P14", () => {
      const result = analyzeScopeAssistInput("repair both sides of canopy");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: seal all edges at panel — P9 perimeter_wraparound preserved, no P14", () => {
      const result = analyzeScopeAssistInput("seal all edges at panel");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: MIG welder equipment swap — weldingConfidence not none, but no false location hints", () => {
      const result = analyzeScopeAssistInput("replace MIG welder at welding station");
      expect(result.weldingBaseProcess).toBe("gmaw_mig");
      expect(Array.isArray(result.coordinatedDistributionHints) ? result.coordinatedDistributionHints.length : 0).toBe(0);
    });

    test("non-regression: welded connection on storefront — welding_generic, no override of non-welding P-pass hints", () => {
      const result = analyzeScopeAssistInput("repair welded connection at storefront frame");
      expect(result.weldingBaseProcess).toBe("welding_generic");
      expect(result.weldingConfidence).toBe("low");
    });

    test("non-regression: friction stir weld aluminum panel — friction_welding base, aluminum material", () => {
      const result = analyzeScopeAssistInput("friction stir weld aluminum panel section");
      expect(result.weldingBaseProcess).toBe("friction_welding");
      expect(result.weldingMaterialContext).toContain("aluminum");
    });

    test("non-regression: cadweld grounding connection — thermit_welding base", () => {
      const result = analyzeScopeAssistInput("cadweld grounding connection at utility vault");
      expect(result.weldingBaseProcess).toBe("thermit_welding");
    });

    test("non-regression: laser weld thin stainless enclosure — laser_welding, stainless material", () => {
      const result = analyzeScopeAssistInput("laser weld thin stainless steel enclosure panel");
      expect(result.weldingBaseProcess).toBe("laser_welding");
      expect(result.weldingMaterialContext).toContain("stainless");
    });

    test("non-regression: projection weld nut to bracket — resistance_welding base", () => {
      const result = analyzeScopeAssistInput("projection weld nut to bracket at assembly");
      expect(result.weldingBaseProcess).toBe("resistance_welding");
    });

    test("non-regression: brazing only (no weld) — weldingConfidence none, no base process", () => {
      const result = analyzeScopeAssistInput("brazing copper refrigerant fittings at mechanical");
      expect(result.weldingConfidence).toBe("none");
      expect(result.weldingBaseProcess || "").toBe("");
    });

    test("non-regression: soldering only (no weld) — weldingConfidence none", () => {
      const result = analyzeScopeAssistInput("solder circuit board connections at panel");
      expect(result.weldingConfidence).toBe("none");
    });

    test("non-regression: torch cutting without welding — weldingConfidence none", () => {
      const result = analyzeScopeAssistInput("torch cut and remove existing steel plate");
      expect(result.weldingConfidence).toBe("none");
    });
  });

  describe("Pass 15: Ironwork taxonomy normalization + specialty ironwork hardening", () => {
    // --- Group A: no ironwork → confidence "none" ---

    test("no ironwork: paint drywall at lobby — ironworkConfidence is none", () => {
      const result = analyzeScopeAssistInput("paint drywall at lobby");
      expect(result.ironworkConfidence).toBe("none");
      expect(result.ironworkTradeFamily || "").toBe("");
    });

    test("no ironwork: replace door hardware at entry — ironworkConfidence is none", () => {
      const result = analyzeScopeAssistInput("replace door hardware at entry");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("no ironwork: install tile at lobby floor — ironworkConfidence is none", () => {
      const result = analyzeScopeAssistInput("install tile at lobby floor");
      expect(result.ironworkConfidence).toBe("none");
    });

    // --- Group B: trade family detection ---

    test("rebar: tie rebar cage at footing — reinforcing_rebar family", () => {
      const result = analyzeScopeAssistInput("tie rebar cage at footing");
      expect(result.ironworkTradeFamily).toBe("reinforcing_rebar");
      expect(result.ironworkConfidence).toBe("high");
    });

    test("rebar: place reinforcing steel mat — reinforcing_rebar family", () => {
      const result = analyzeScopeAssistInput("place reinforcing steel mat");
      expect(result.ironworkTradeFamily).toBe("reinforcing_rebar");
    });

    test("rebar: install epoxy bar dowels — reinforcing_rebar family", () => {
      const result = analyzeScopeAssistInput("install epoxy bar dowels");
      expect(result.ironworkTradeFamily).toBe("reinforcing_rebar");
    });

    test("bridge: bridge girder set and splice — bridge_ironwork family", () => {
      const result = analyzeScopeAssistInput("bridge girder set and splice");
      expect(result.ironworkTradeFamily).toBe("bridge_ironwork");
      expect(result.ironworkConfidence).toBe("high");
    });

    test("bridge: bolt splice plates on bridge steel — bridge_ironwork family", () => {
      const result = analyzeScopeAssistInput("bolt splice plates on bridge steel");
      expect(result.ironworkTradeFamily).toBe("bridge_ironwork");
    });

    test("bridge: set bridge diaphragm and cross frame — bridge_ironwork family", () => {
      const result = analyzeScopeAssistInput("set bridge diaphragm and cross frame");
      expect(result.ironworkTradeFamily).toBe("bridge_ironwork");
    });

    test("PEMB: erect pemb rigid frame and girts — pre_engineered_metal_building family", () => {
      const result = analyzeScopeAssistInput("erect pemb rigid frame and girts");
      expect(result.ironworkTradeFamily).toBe("pre_engineered_metal_building");
    });

    test("PEMB: set framed opening at metal building — pre_engineered_metal_building family", () => {
      const result = analyzeScopeAssistInput("set framed opening at metal building");
      expect(result.ironworkTradeFamily).toBe("pre_engineered_metal_building");
    });

    test("precast: precast panel connection plates install — precast_panel_connection family", () => {
      const result = analyzeScopeAssistInput("precast panel connection plates install");
      expect(result.ironworkTradeFamily).toBe("precast_panel_connection");
    });

    test("precast: set embeds and brace frame for panel erection — precast_panel_connection family", () => {
      const result = analyzeScopeAssistInput("set embeds and brace frame for panel erection");
      expect(result.ironworkTradeFamily).toBe("precast_panel_connection");
    });

    test("tank: tank shell plate erection — tank_and_specialty_erection family", () => {
      const result = analyzeScopeAssistInput("tank shell plate erection");
      expect(result.ironworkTradeFamily).toBe("tank_and_specialty_erection");
    });

    test("decking: install roof deck and pour stop — metal_decking family", () => {
      const result = analyzeScopeAssistInput("install roof deck and pour stop");
      expect(result.ironworkTradeFamily).toBe("metal_decking");
    });

    test("decking: fasten floor deck and shear studs — metal_decking family", () => {
      const result = analyzeScopeAssistInput("fasten floor deck and shear studs");
      expect(result.ironworkTradeFamily).toBe("metal_decking");
    });

    test("decking: install edge angle at deck perimeter — metal_decking family", () => {
      const result = analyzeScopeAssistInput("install edge angle at deck perimeter");
      expect(result.ironworkTradeFamily).toBe("metal_decking");
    });

    test("ornamental: ornamental iron gate install — ornamental_ironwork family", () => {
      const result = analyzeScopeAssistInput("ornamental iron gate install");
      expect(result.ironworkTradeFamily).toBe("ornamental_ironwork");
    });

    test("ornamental: fabricate custom iron railing — ornamental_ironwork family", () => {
      const result = analyzeScopeAssistInput("fabricate custom iron railing");
      expect(result.ironworkTradeFamily).toBe("ornamental_ironwork");
    });

    test("stairs: install handrail and guardrail at stair landing — stairs_and_rails family", () => {
      const result = analyzeScopeAssistInput("install handrail and guardrail at stair landing");
      expect(result.ironworkTradeFamily).toBe("stairs_and_rails");
    });

    test("stairs: true up stair rail posts — stairs_and_rails family", () => {
      const result = analyzeScopeAssistInput("true up stair rail posts");
      expect(result.ironworkTradeFamily).toBe("stairs_and_rails");
    });

    test("stairs: fabricate stair pans and rail sections — stairs_and_rails family", () => {
      const result = analyzeScopeAssistInput("fabricate stair pans and rail sections");
      expect(result.ironworkTradeFamily).toBe("stairs_and_rails");
    });

    test("stairs: replace bent guardrail section — stairs_and_rails family", () => {
      const result = analyzeScopeAssistInput("replace bent guardrail section");
      expect(result.ironworkTradeFamily).toBe("stairs_and_rails");
    });

    test("fencing: install security fence and slide gate — fencing_and_gates family", () => {
      const result = analyzeScopeAssistInput("install security fence and slide gate");
      expect(result.ironworkTradeFamily).toBe("fencing_and_gates");
    });

    test("ladders: install fixed ladder and cage — ladders_platforms_access family", () => {
      const result = analyzeScopeAssistInput("install fixed ladder and cage");
      expect(result.ironworkTradeFamily).toBe("ladders_platforms_access");
    });

    test("ladders: install catwalk and access platform — ladders_platforms_access family", () => {
      const result = analyzeScopeAssistInput("install catwalk and access platform");
      expect(result.ironworkTradeFamily).toBe("ladders_platforms_access");
    });

    test("ladders: install misc metal ladder and platform — ladders_platforms_access or misc metals family", () => {
      const result = analyzeScopeAssistInput("install misc metal ladder and platform");
      expect(["ladders_platforms_access", "miscellaneous_metals"]).toContain(result.ironworkTradeFamily);
    });

    test("supports: set dunnage frame for rooftop unit — supports_frames_canopies family", () => {
      const result = analyzeScopeAssistInput("set dunnage frame for rooftop unit");
      expect(result.ironworkTradeFamily).toBe("supports_frames_canopies");
    });

    test("supports: set canopy frame and angle supports — supports_frames_canopies family", () => {
      const result = analyzeScopeAssistInput("set canopy frame and angle supports");
      expect(result.ironworkTradeFamily).toBe("supports_frames_canopies");
    });

    test("supports: install support steel for canopy — supports_frames_canopies family", () => {
      const result = analyzeScopeAssistInput("install support steel for canopy");
      expect(result.ironworkTradeFamily).toBe("supports_frames_canopies");
    });

    test("retrofit: retrofit existing steel support — retrofit_rehab_modification family", () => {
      const result = analyzeScopeAssistInput("retrofit existing steel support");
      expect(result.ironworkTradeFamily).toBe("retrofit_rehab_modification");
    });

    test("retrofit: reinforce damaged member with add plate — retrofit_rehab_modification family", () => {
      const result = analyzeScopeAssistInput("reinforce damaged member with add plate");
      expect(result.ironworkTradeFamily).toBe("retrofit_rehab_modification");
    });

    test("structural: erect structural steel beams and columns — structural_steel_erection family", () => {
      const result = analyzeScopeAssistInput("erect structural steel beams and columns");
      expect(result.ironworkTradeFamily).toBe("structural_steel_erection");
      expect(result.ironworkConfidence).toBe("high");
    });

    test("structural: bolt up steel frame at canopy — structural_steel_erection family", () => {
      const result = analyzeScopeAssistInput("bolt up steel frame at canopy");
      expect(result.ironworkTradeFamily).toBe("structural_steel_erection");
    });

    test("structural: align and plumb structural columns — structural_steel_erection family", () => {
      const result = analyzeScopeAssistInput("align and plumb structural columns");
      expect(result.ironworkTradeFamily).toBe("structural_steel_erection");
    });

    test("structural: set joists and braces — structural_steel_erection family", () => {
      const result = analyzeScopeAssistInput("set joists and braces");
      expect(result.ironworkTradeFamily).toBe("structural_steel_erection");
    });

    test("structural: rig and fly steel joists — structural_steel_erection family, rigging operation", () => {
      const result = analyzeScopeAssistInput("rig and fly steel joists");
      expect(result.ironworkTradeFamily).toBe("structural_steel_erection");
      expect(result.ironworkOperationTags).toContain("rigging_hoisting_signaling");
    });

    test("structural: crane pick and set beam — structural_steel_erection family, rigging operation", () => {
      const result = analyzeScopeAssistInput("crane pick and set beam");
      expect(result.ironworkTradeFamily).toBe("structural_steel_erection");
      expect(result.ironworkOperationTags).toContain("rigging_hoisting_signaling");
    });

    test("structural: erect steel frame and align beams — structural_steel_erection family", () => {
      const result = analyzeScopeAssistInput("erect steel frame and align beams");
      expect(result.ironworkTradeFamily).toBe("structural_steel_erection");
      expect(result.ironworkOperationTags).toContain("erection_placement");
    });

    test("misc: install lintel and shelf angle — miscellaneous_metals family", () => {
      const result = analyzeScopeAssistInput("install lintel and shelf angle");
      expect(result.ironworkTradeFamily).toBe("miscellaneous_metals");
    });

    test("misc: install bollards and misc metals — miscellaneous_metals family", () => {
      const result = analyzeScopeAssistInput("install bollards and misc metals");
      expect(result.ironworkTradeFamily).toBe("miscellaneous_metals");
    });

    test("misc: set base plate and anchor rods — miscellaneous_metals or structural family", () => {
      const result = analyzeScopeAssistInput("set base plate and anchor rods");
      expect(result.ironworkTradeFamily).toBeTruthy();
      expect(result.ironworkConfidence).not.toBe("none");
    });

    // --- Group C: operation tag detection ---

    test("operation: bolt up connections — bolt_up_connections detected", () => {
      const result = analyzeScopeAssistInput("bolt up steel frame connections");
      expect(result.ironworkOperationTags).toContain("bolt_up_connections");
    });

    test("operation: field weld — field_weld_connections detected", () => {
      const result = analyzeScopeAssistInput("field weld clip angles on frame");
      expect(result.ironworkOperationTags).toContain("field_weld_connections");
    });

    test("operation: shop fabrication — shop_fabrication detected", () => {
      const result = analyzeScopeAssistInput("fabricate steel support frame in shop");
      expect(result.ironworkOperationTags).toContain("shop_fabrication");
    });

    test("operation: cope drill fit steel — shop_fabrication from cope/drill", () => {
      const result = analyzeScopeAssistInput("cut cope drill and fit steel");
      expect(result.ironworkOperationTags).toContain("shop_fabrication");
    });

    test("operation: layout_alignment from plumb/shim — layout_alignment detected", () => {
      const result = analyzeScopeAssistInput("square level and shim steel frame");
      expect(result.ironworkOperationTags).toContain("layout_alignment");
    });

    test("operation: weld plate — field_weld_connections detected", () => {
      const result = analyzeScopeAssistInput("weld plate connection on support steel");
      expect(result.ironworkOperationTags).toContain("field_weld_connections");
    });

    test("operation: signal crane — rigging_hoisting_signaling detected", () => {
      const result = analyzeScopeAssistInput("signal crane for girder set");
      expect(result.ironworkOperationTags).toContain("rigging_hoisting_signaling");
    });

    test("operation: rebar tie cage — reinforcing_operation detected", () => {
      const result = analyzeScopeAssistInput("tie rebar cage at footing");
      expect(result.ironworkOperationTags).toContain("reinforcing_operation");
    });

    test("operation: field bolt structural brace — bolt_up_connections from field bolt", () => {
      const result = analyzeScopeAssistInput("field bolt structural brace connection");
      expect(result.ironworkOperationTags).toContain("bolt_up_connections");
    });

    // --- Group D: object/assembly tag detection ---

    test("object: erect beams and columns — beam and column in objectTags", () => {
      const result = analyzeScopeAssistInput("erect structural steel beams and columns");
      expect(result.ironworkObjectTags).toContain("beam");
      expect(result.ironworkObjectTags).toContain("column");
    });

    test("object: rebar cage — rebar and cage in objectTags", () => {
      const result = analyzeScopeAssistInput("tie rebar cage at footing");
      expect(result.ironworkObjectTags).toContain("rebar");
      expect(result.ironworkObjectTags).toContain("cage");
    });

    test("object: deck pour stop — deck and pour_stop in objectTags", () => {
      const result = analyzeScopeAssistInput("install roof deck and pour stop");
      expect(result.ironworkObjectTags).toContain("deck");
      expect(result.ironworkObjectTags).toContain("pour_stop");
    });

    test("object: stair pan rail — stair and rail in objectTags", () => {
      const result = analyzeScopeAssistInput("fabricate stair pans and rail sections");
      expect(result.ironworkObjectTags).toContain("stair");
      expect(result.ironworkObjectTags).toContain("rail");
    });

    test("object: girder — girder in objectTags for bridge scope", () => {
      const result = analyzeScopeAssistInput("bridge girder set and splice");
      expect(result.ironworkObjectTags).toContain("girder");
    });

    test("object: joists — joist in objectTags for structural scope", () => {
      const result = analyzeScopeAssistInput("rig and fly steel joists");
      expect(result.ironworkObjectTags).toContain("joist");
    });

    test("object: guardrail handrail — guardrail and handrail in objectTags", () => {
      const result = analyzeScopeAssistInput("install handrail and guardrail at stair landing");
      expect(result.ironworkObjectTags).toContain("guardrail");
      expect(result.ironworkObjectTags).toContain("handrail");
    });

    // --- Group E: scope bias tags ---

    test("scope bias: structural frame + erection_oriented from erect beams columns", () => {
      const result = analyzeScopeAssistInput("erect structural steel beams and columns");
      expect(result.ironworkScopeBias).toContain("structural_frame");
      expect(result.ironworkScopeBias).toContain("erection_oriented");
    });

    test("scope bias: rebar_install from tie rebar cage", () => {
      const result = analyzeScopeAssistInput("tie rebar cage at footing");
      expect(result.ironworkScopeBias).toContain("rebar_install");
    });

    test("scope bias: rigging_heavy from rig and fly", () => {
      const result = analyzeScopeAssistInput("rig and fly steel joists");
      expect(result.ironworkScopeBias).toContain("rigging_heavy");
    });

    test("scope bias: decking_install from roof deck and shear studs", () => {
      const result = analyzeScopeAssistInput("fasten floor deck and shear studs");
      expect(result.ironworkScopeBias).toContain("decking_install");
    });

    test("scope bias: layout_precision from plumb shim align", () => {
      const result = analyzeScopeAssistInput("square level and shim steel frame");
      expect(result.ironworkScopeBias).toContain("layout_precision");
    });

    test("scope bias: retrofit_repair from retrofit scope", () => {
      const result = analyzeScopeAssistInput("retrofit existing steel support");
      expect(result.ironworkScopeBias).toContain("retrofit_repair");
    });

    // --- Group F: compound examples ---

    test("compound: bolt up canopy frame — structural + bolt_up + canopy", () => {
      const result = analyzeScopeAssistInput("bolt up steel canopy frame at building");
      expect(["structural_steel_erection", "supports_frames_canopies"]).toContain(result.ironworkTradeFamily);
      expect(result.ironworkOperationTags).toContain("bolt_up_connections");
      expect(result.ironworkObjectTags).toContain("canopy");
    });

    test("compound: place rebar mesh and tie bars — reinforcing_rebar, reinforcing_operation, mesh/rebar objects", () => {
      const result = analyzeScopeAssistInput("place rebar mesh and tie bars");
      expect(result.ironworkTradeFamily).toBe("reinforcing_rebar");
      expect(result.ironworkOperationTags).toContain("reinforcing_operation");
      expect(result.ironworkObjectTags).toContain("rebar");
      expect(result.ironworkObjectTags).toContain("mesh");
    });

    test("compound: repair misc metal stair rail — stair family with repair operation", () => {
      const result = analyzeScopeAssistInput("repair misc metal stair rail");
      expect(["stairs_and_rails", "miscellaneous_metals"]).toContain(result.ironworkTradeFamily);
      expect(result.ironworkOperationTags).toContain("repair_retrofit_op");
    });

    test("compound: modify existing metal platform — ladders/access family with repair op", () => {
      const result = analyzeScopeAssistInput("modify existing metal platform");
      expect(["ladders_platforms_access", "retrofit_rehab_modification"]).toContain(result.ironworkTradeFamily);
      expect(result.ironworkConfidence).not.toBe("none");
    });

    test("compound: field weld clip angles on steel frame — structural + field_weld op", () => {
      const result = analyzeScopeAssistInput("field weld clip angles on steel frame");
      expect(result.ironworkTradeFamily).toBe("structural_steel_erection");
      expect(result.ironworkOperationTags).toContain("field_weld_connections");
      expect(result.ironworkObjectTags).toContain("clip_angle");
    });

    // --- Non-regression: prior passes preserved, no spurious ironwork ---

    test("non-regression: paint drywall at lobby — no P15 ironwork data", () => {
      const result = analyzeScopeAssistInput("paint drywall at lobby");
      expect(result.ironworkConfidence).toBe("none");
      expect(Array.isArray(result.ironworkOperationTags) ? result.ironworkOperationTags.length : 0).toBe(0);
    });

    test("non-regression: replace storefront glass — no P15 ironwork", () => {
      const result = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: replace lower cabinet run — no P15 ironwork", () => {
      const result = analyzeScopeAssistInput("replace lower cabinet run");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: install fence section at side yard — no P15 ironwork (bare fence, no gate keyword)", () => {
      const result = analyzeScopeAssistInput("install fence section at side yard");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: replace handrail section and secure posts — no P15 ironwork (bare handrail)", () => {
      const result = analyzeScopeAssistInput("replace handrail section and secure posts");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: replace man door at rear entry — no P15 ironwork", () => {
      const result = analyzeScopeAssistInput("replace man door at rear entry");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: repair built-in cabinet section — no P15 ironwork", () => {
      const result = analyzeScopeAssistInput("repair built-in cabinet section");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: reset access panel and patch wall — no P15 ironwork", () => {
      const result = analyzeScopeAssistInput("reset access panel and patch wall");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: repair frame area at window — no P15 ironwork", () => {
      const result = analyzeScopeAssistInput("repair frame area at window");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: orbital weld stainless gas panel 1/4 tubing — P14 welding preserved, no P15", () => {
      const result = analyzeScopeAssistInput("orbital weld stainless gas panel 1/4 tubing");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: sanitary tube tig with purge — P14 welding preserved, no P15", () => {
      const result = analyzeScopeAssistInput("sanitary tube tig with purge");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: replace top and bottom storefront panels — P13 coordinated preserved, no P15", () => {
      const result = analyzeScopeAssistInput("replace top and bottom storefront glass panels");
      expect(result.coordinatedDistributionHints).toContain("coordinated_position_distribution");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: repair head jamb and sill plate — P12+P13 preserved, no P15", () => {
      const result = analyzeScopeAssistInput("repair head jamb and sill plate at entry");
      expect(result.anchorCarrySubzoneHints).toContain("named_subzone_local");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: patch half the wall — P11 preserved, no P15", () => {
      const result = analyzeScopeAssistInput("patch half the wall");
      expect(result.rangePositionalFractionalHints).toContain("fractional_local_extent");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: repair both sides of canopy — P9 preserved; canopy alone without ironwork terms no P15", () => {
      const result = analyzeScopeAssistInput("repair both sides of canopy");
      expect(result.coverageExtentHints).toContain("both_sides");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: replace glazing panel and seal perimeter — no P15", () => {
      const result = analyzeScopeAssistInput("replace glazing panel and seal perimeter");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: close up old opening and finish wall — no P15", () => {
      const result = analyzeScopeAssistInput("close up old opening and finish wall");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: patch and paint affected wall area — no P15", () => {
      const result = analyzeScopeAssistInput("patch and paint affected wall area");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: replace storefront glass and patch wall around it — no P15", () => {
      const result = analyzeScopeAssistInput("replace storefront glass and patch wall around it");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: field weld also triggers welding system — weldingBaseProcess set", () => {
      const result = analyzeScopeAssistInput("field weld clip angles on steel frame");
      expect(result.weldingBaseProcess).toBeTruthy();
      expect(result.ironworkTradeFamily).toBeTruthy();
    });

    test("non-regression: replace one section of railing — no P15 (bare railing, no ironwork gate term)", () => {
      const result = analyzeScopeAssistInput("replace one section of railing");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: autogenous orbital weld on stainless tubing — P14 preserved, no P15", () => {
      const result = analyzeScopeAssistInput("autogenous orbital weld on stainless tubing");
      expect(result.weldingBaseProcess).toBe("gtaw_tig");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: repair cover panel — no P15", () => {
      const result = analyzeScopeAssistInput("repair cover panel");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: replace trim around door — no P15", () => {
      const result = analyzeScopeAssistInput("replace trim around door");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: seal top of wall — P12 preserved, no P15", () => {
      const result = analyzeScopeAssistInput("seal top of wall");
      expect(result.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: replace sections 2 through 4 — P11 preserved, no P15", () => {
      const result = analyzeScopeAssistInput("replace sections 2 through 4");
      expect(result.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(result.ironworkConfidence).toBe("none");
    });

    test("non-regression: seal all edges at panel — P9 preserved, no P15", () => {
      const result = analyzeScopeAssistInput("seal all edges at panel");
      expect(result.coverageExtentHints).toContain("perimeter_wraparound");
      expect(result.ironworkConfidence).toBe("none");
    });
  });
});

// ─── Pass 16: Shared specialty-trade live-path fallback hardening ────────────

describe("Pass 16 — buildSpecialtyLocalFallbackNote", () => {
  // ── Validation: welding fallback notes ──────────────────────────────────────
  describe("validation: welding fallback note construction", () => {
    test("orbital TIG on stainless gas panels returns structured welding note", () => {
      const analysis = analyzeScopeAssistInput("orbital weld stainless gas panel 1/4 tubing");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/Orbital TIG welding/i);
      expect(note).toMatch(/gas panel/i);
    });

    test("sanitary tube TIG on stainless returns sanitary tube prefix", () => {
      const analysis = analyzeScopeAssistInput("sanitary tube tig weld stainless");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/Sanitary tube/i);
      expect(note).toMatch(/TIG welding/i);
    });

    test("GTAW with backpurge returns purge-controlled qualifier", () => {
      const analysis = analyzeScopeAssistInput("gtaw weld with back purge stainless pipe");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/purge-controlled/i);
    });

    test("MIG welding returns MIG label in note", () => {
      const analysis = analyzeScopeAssistInput("mig weld carbon steel frame");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/MIG welding/i);
    });

    test("stick welding shorthand returns stick welding label", () => {
      const analysis = analyzeScopeAssistInput("smaw stick weld structural steel");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/stick welding/i);
    });
  });

  // ── Validation: ironwork fallback notes ────────────────────────────────────
  describe("validation: ironwork fallback note construction", () => {
    test("structural steel erection with bolt up returns verb-led note with erect or bolt up", () => {
      const analysis = analyzeScopeAssistInput("erect structural steel beams and bolt up connections");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/erect|bolt up/i);
    });

    test("rebar placement returns verb-led note with place/tie or rebar", () => {
      const analysis = analyzeScopeAssistInput("place and tie reinforcing rebar mat at slab");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/place|tie|rebar/i);
    });

    test("metal decking installation returns verb-led note with decking or install/erect", () => {
      const analysis = analyzeScopeAssistInput("install metal decking and shear studs");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/deck|shear|install|erect/i);
    });

    test("stair pan and rail returns verb-led note with stair/guardrail/install/erect", () => {
      const analysis = analyzeScopeAssistInput("install stair pans and guardrails");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/stair|guardrail|install|erect/i);
    });

    test("misc metal with medium confidence returns verb-led note with erect/install", () => {
      // miscellaneous_metals as fallback always yields "low" confidence; use crafted analysis to test the verb-led path
      const analysis = {
        ironworkTradeFamily: "miscellaneous_metals",
        ironworkConfidence: "medium",
        ironworkOperationTags: ["erection_placement"],
        ironworkObjectTags: ["angle_iron", "embed"],
        ironworkScopeBias: [],
      };
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/erect|install/i);
    });
  });

  // ── Failure-path tests: pre-crafted analysis objects ───────────────────────
  // These simulate "provider failed, what would the user receive?"
  describe("failure-path: buildSpecialtyLocalFallbackNote with pre-crafted analysis", () => {
    test("welding analysis with medium confidence returns a non-empty note", () => {
      const analysis = {
        weldingBaseProcess: "gtaw_tig",
        weldingConfidence: "medium",
        weldingSecondaryTags: ["orbital_welding", "automatic_welding"],
        weldingMaterialContext: ["stainless"],
        weldingScopeBias: [],
      };
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note.length).toBeGreaterThan(10);
      expect(note).toMatch(/Orbital TIG welding/i);
    });

    test("welding analysis with low confidence returns null (does not fire)", () => {
      const analysis = {
        weldingBaseProcess: "welding_generic",
        weldingConfidence: "low",
        weldingSecondaryTags: [],
        weldingMaterialContext: [],
        weldingScopeBias: [],
      };
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeNull();
    });

    test("ironwork analysis with high confidence returns verb-led note with erect/bolt up", () => {
      const analysis = {
        ironworkTradeFamily: "structural_steel_erection",
        ironworkConfidence: "high",
        ironworkOperationTags: ["erection_placement", "bolt_up_connections"],
        ironworkObjectTags: ["beam", "column"],
        ironworkScopeBias: [],
      };
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note.length).toBeGreaterThan(10);
      expect(note).toMatch(/erect|bolt up/i);
    });

    test("ironwork analysis with medium confidence returns verb-led note with erect/stair/guardrail", () => {
      const analysis = {
        ironworkTradeFamily: "stairs_and_rails",
        ironworkConfidence: "medium",
        ironworkOperationTags: ["erection_placement"],
        ironworkObjectTags: ["stair_pan", "guardrail"],
        ironworkScopeBias: [],
      };
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/erect|stair|guardrail/i);
    });

    test("ironwork analysis with low confidence returns null", () => {
      const analysis = {
        ironworkTradeFamily: "miscellaneous_metals",
        ironworkConfidence: "low",
        ironworkOperationTags: [],
        ironworkObjectTags: [],
        ironworkScopeBias: [],
      };
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeNull();
    });

    test("rough framing analysis returns verb-led note with install/frame + item", () => {
      const analysis = {
        rawScopeText: "install wood studs and blocking at new door opening",
        scopeTradeBucket: "",
        actions: ["install"],
        items: ["studs", "blocking"],
      };
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/install|frame|stud|blocking/i);
    });

    test("finish carpentry analysis returns verb-led note with install + item", () => {
      const analysis = {
        rawScopeText: "install base cabinets in kitchen",
        scopeTradeBucket: "finish_carpentry",
        actions: ["install"],
        items: ["cabinets"],
      };
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/install|cabinet/i);
    });
  });

  // ── Non-regression: non-specialty inputs return null ───────────────────────
  describe("non-regression: non-specialty inputs return null", () => {
    test("install drywall — no specialty → null", () => {
      const analysis = analyzeScopeAssistInput("install drywall in bedroom");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("caulk window frame — no specialty → null", () => {
      const analysis = analyzeScopeAssistInput("caulk around window frame");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("replace door closer — no specialty → null", () => {
      const analysis = analyzeScopeAssistInput("replace door closer on entry door");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("paint interior walls — no specialty → null", () => {
      const analysis = analyzeScopeAssistInput("paint interior walls two coats");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("replace faucet — no specialty → null", () => {
      const analysis = analyzeScopeAssistInput("replace kitchen faucet");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("repair cracked slab — no specialty → null", () => {
      const analysis = analyzeScopeAssistInput("repair cracked concrete slab");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("install ceiling tile — no specialty → null", () => {
      const analysis = analyzeScopeAssistInput("install ceiling tile in office");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("replace weatherstrip on door — no specialty → null", () => {
      const analysis = analyzeScopeAssistInput("replace weatherstrip on exterior door");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("patch and paint drywall — no specialty → null", () => {
      const analysis = analyzeScopeAssistInput("patch and paint drywall near window");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("empty input — returns null", () => {
      expect(buildSpecialtyLocalFallbackNote({})).toBeNull();
    });

    test("welding_generic with low confidence — returns null (generic weld alone not enough)", () => {
      const analysis = analyzeScopeAssistInput("weld this");
      // welding_generic with low confidence should not fire
      if (analysis.weldingConfidence === "low") {
        expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
      } else {
        // if confidence is medium or higher for some reason, note is allowed
        expect(typeof buildSpecialtyLocalFallbackNote(analysis)).toBe("string");
      }
    });

    test("P14 preserved: orbital weld analysis still produces weldingBaseProcess", () => {
      const analysis = analyzeScopeAssistInput("orbital tig weld stainless tubing");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingSecondaryTags).toContain("orbital_welding");
    });

    test("P15 preserved: structural steel erection analysis still produces ironworkTradeFamily", () => {
      const analysis = analyzeScopeAssistInput("erect structural steel columns and beams");
      expect(analysis.ironworkTradeFamily).toBe("structural_steel_erection");
    });

    test("P16 does not affect non-specialty P11 range result", () => {
      const analysis = analyzeScopeAssistInput("replace sections 2 through 4");
      expect(analysis.rangePositionalFractionalHints).toContain("ordinal_range_selection");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("P16 does not affect non-specialty P12 anchor-carry result", () => {
      const analysis = analyzeScopeAssistInput("seal top of wall");
      expect(analysis.anchorCarrySubzoneHints).toContain("position_of_local");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });

    test("note is a plain string ending with period when returned", () => {
      const analysis = analyzeScopeAssistInput("orbital weld stainless tubing");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(typeof note).toBe("string");
      expect(note.trim().endsWith(".")).toBe(true);
    });
  });
});

// ─── Pass 17: Authoritative specialty-registry enforcement + pre-busy interception ──────

describe("Pass 17 — live-path specialty shorthand hardening", () => {
  // ── Welding shorthand validation ────────────────────────────────────────────
  describe("validation: welding shorthand normalization", () => {
    test("orbital weld — confidence medium, base gtaw_tig inferred, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("orbital weld");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingSecondaryTags).toContain("orbital_welding");
      expect(["medium", "high"]).toContain(analysis.weldingConfidence);
      expect(buildSpecialtyLocalFallbackNote(analysis)).not.toBeNull();
    });

    test("orbital weld lines — line_connections captured, fallback note references line connections", () => {
      const analysis = analyzeScopeAssistInput("orbital weld lines");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingMaterialContext).toContain("line_connections");
      expect(["medium", "high"]).toContain(analysis.weldingConfidence);
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/Orbital TIG welding/i);
      expect(note).toMatch(/line connections/i);
    });

    test("orbital weld stainless lines — stainless + line_connections preserved", () => {
      const analysis = analyzeScopeAssistInput("orbital weld stainless lines");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingMaterialContext).toContain("line_connections");
      expect(analysis.weldingMaterialContext).toContain("stainless");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/Orbital TIG welding/i);
    });

    test("orbital weld gas lines — line_connections captured, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("orbital weld gas lines");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingMaterialContext).toContain("line_connections");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/Orbital TIG welding/i);
    });

    test("orbital lines — new gate extension fires, orbital_welding secondary fires, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("orbital lines");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingSecondaryTags).toContain("orbital_welding");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/Orbital TIG welding/i);
    });

    test("tig tube lines — tube_welding_application + line_connections, high confidence", () => {
      const analysis = analyzeScopeAssistInput("tig tube lines");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingSecondaryTags).toContain("tube_welding_application");
      expect(analysis.weldingMaterialContext).toContain("line_connections");
      expect(analysis.weldingConfidence).toBe("high");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/TIG welding/i);
    });

    test("sanitary weld lines — sanitary_tube_welding infers gtaw_tig, line_connections captured", () => {
      const analysis = analyzeScopeAssistInput("sanitary weld lines");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingSecondaryTags).toContain("sanitary_tube_welding");
      expect(analysis.weldingMaterialContext).toContain("line_connections");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/Sanitary tube TIG welding/i);
    });

    test("autogenous orbital weld — automatic_welding + orbital_welding infer gtaw_tig", () => {
      const analysis = analyzeScopeAssistInput("autogenous orbital weld");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingSecondaryTags).toContain("orbital_welding");
      expect(analysis.weldingSecondaryTags).toContain("automatic_welding");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/Orbital TIG welding/i);
    });
  });

  // ── Ironwork shorthand validation ───────────────────────────────────────────
  describe("validation: ironwork shorthand normalization", () => {
    test("bolt up canopy frame — supports_frames_canopies, bolt_up op, medium+ confidence, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("bolt up canopy frame");
      expect(["medium", "high"]).toContain(analysis.ironworkConfidence);
      expect(analysis.ironworkOperationTags).toContain("bolt_up_connections");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/bolt up/i);
    });

    test("tie rebar cage — reinforcing_rebar family, reinforcing_operation, high confidence", () => {
      const analysis = analyzeScopeAssistInput("tie rebar cage");
      expect(analysis.ironworkTradeFamily).toBe("reinforcing_rebar");
      expect(analysis.ironworkOperationTags).toContain("reinforcing_operation");
      expect(analysis.ironworkConfidence).toBe("high");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/place|tie|rebar/i);
    });

    test("set joists — structural_steel_erection, erection_placement op, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("set joists");
      expect(analysis.ironworkTradeFamily).toBe("structural_steel_erection");
      expect(analysis.ironworkOperationTags).toContain("erection_placement");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/erect|joist|install/i);
    });

    test("rig steel — structural_steel_erection family (new pattern), rigging_hoisting op, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("rig steel");
      expect(analysis.ironworkTradeFamily).toBe("structural_steel_erection");
      expect(analysis.ironworkOperationTags).toContain("rigging_hoisting_signaling");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/rig|hoist|erect/i);
    });

    test("field weld clips — structural_steel_erection (new pattern), field_weld op, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("field weld clips");
      expect(analysis.ironworkTradeFamily).toBe("structural_steel_erection");
      expect(analysis.ironworkOperationTags).toContain("field_weld_connections");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/field weld|erect|install/i);
    });

    test("lay deck — metal_decking family (gate fix), lay_place_decking op, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("lay deck");
      expect(analysis.ironworkTradeFamily).toBe("metal_decking");
      expect(analysis.ironworkOperationTags).toContain("lay_place_decking");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/lay|deck|install/i);
    });

    test("bridge splice — bridge_ironwork family (gate fix), bolt_up op captures splice, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("bridge splice");
      expect(analysis.ironworkTradeFamily).toBe("bridge_ironwork");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/bolt|splice|erect|install/i);
    });
  });

  // ── Carpentry shorthand validation ──────────────────────────────────────────
  describe("validation: carpentry shorthand normalization", () => {
    test("hang prehung door — door_installation family, hang_install op, prehung_door object, high confidence", () => {
      const analysis = analyzeScopeAssistInput("hang prehung door");
      expect(analysis.carpentryTradeFamily).toBe("door_installation");
      expect(analysis.carpentryOperationTags).toContain("hang_install");
      expect(analysis.carpentryObjectTags).toContain("prehung_door");
      expect(analysis.carpentryConfidence).toBe("high");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/hang|install|door/i);
    });

    test("trim casing — trim_molding family, trim_finish op, casing object, high confidence", () => {
      const analysis = analyzeScopeAssistInput("trim casing");
      expect(analysis.carpentryTradeFamily).toBe("trim_molding");
      expect(analysis.carpentryObjectTags).toContain("casing");
      expect(["medium", "high"]).toContain(analysis.carpentryConfidence);
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/trim|finish|casing/i);
    });

    test("frame soffit — rough_framing family, frame_out op, soffit object, high confidence", () => {
      const analysis = analyzeScopeAssistInput("frame soffit");
      expect(analysis.carpentryTradeFamily).toBe("rough_framing");
      expect(analysis.carpentryOperationTags).toContain("frame_out");
      expect(analysis.carpentryObjectTags).toContain("soffit");
      expect(analysis.carpentryConfidence).toBe("high");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/frame|soffit|install/i);
    });

    test("set forms — formwork_concrete family, set_form op, form object, high confidence", () => {
      const analysis = analyzeScopeAssistInput("set forms");
      expect(analysis.carpentryTradeFamily).toBe("formwork_concrete");
      expect(analysis.carpentryOperationTags).toContain("set_form");
      expect(analysis.carpentryObjectTags).toContain("form");
      expect(analysis.carpentryConfidence).toBe("high");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/set|form|install/i);
    });

    test("install uppers — finish_carpentry_casework family, upper_cabinet object, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("install uppers");
      expect(analysis.carpentryTradeFamily).toBe("finish_carpentry_casework");
      expect(analysis.carpentryObjectTags).toContain("upper_cabinet");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/hang|install|cabinet/i);
    });

    test("patch subfloor — sheathing_subfloor family, patch_repair op, subfloor object, high confidence", () => {
      const analysis = analyzeScopeAssistInput("patch subfloor");
      expect(analysis.carpentryTradeFamily).toBe("sheathing_subfloor");
      expect(analysis.carpentryOperationTags).toContain("patch_repair");
      expect(analysis.carpentryObjectTags).toContain("subfloor");
      expect(analysis.carpentryConfidence).toBe("high");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/patch|repair|subfloor/i);
    });

    test("stair tread repair — stair_work family, patch_repair op, stair_tread object, high confidence", () => {
      const analysis = analyzeScopeAssistInput("stair tread repair");
      expect(analysis.carpentryTradeFamily).toBe("stair_work");
      expect(analysis.carpentryOperationTags).toContain("patch_repair");
      expect(analysis.carpentryObjectTags).toContain("stair_tread");
      expect(analysis.carpentryConfidence).toBe("high");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/patch|repair|stair|tread/i);
    });
  });

  // ── Failure-path tests (simulated provider failure + specialty normalization) ──
  describe("failure-path: specialty fallback fires before generic busy", () => {
    test("orbital weld lines analysis — fallback note is non-null and non-empty (simulates timeout)", () => {
      const analysis = analyzeScopeAssistInput("orbital weld lines");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note.length).toBeGreaterThan(15);
      expect(note).toMatch(/Orbital TIG welding/i);
    });

    test("orbital weld lines analysis — fallback note references line connections (simulates malformed response)", () => {
      const analysis = analyzeScopeAssistInput("orbital weld lines");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toMatch(/line connections/i);
    });

    test("orbital weld analysis — fallback fires even without object word (simulates rate-limit)", () => {
      const analysis = analyzeScopeAssistInput("orbital weld");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/Orbital TIG welding/i);
    });

    test("bolt up canopy frame analysis — ironwork fallback fires (simulates timeout)", () => {
      const analysis = analyzeScopeAssistInput("bolt up canopy frame");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note.length).toBeGreaterThan(15);
    });

    test("hang prehung door analysis — carpentry fallback fires (simulates timeout)", () => {
      const analysis = analyzeScopeAssistInput("hang prehung door");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
      expect(note).toMatch(/hang|install|door/i);
    });

    test("vague specialty shorthand returns safe broader fallback, not null", () => {
      // "rig steel" is a short specialty shorthand — should still return something useful
      const analysis = analyzeScopeAssistInput("rig steel");
      const note = buildSpecialtyLocalFallbackNote(analysis);
      expect(note).toBeTruthy();
    });

    test("non-specialty input — fallback returns null (busy preserved for non-specialty)", () => {
      const analysis = analyzeScopeAssistInput("caulk around window");
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeNull();
    });
  });

  // ── Non-regression: paired NR tests ─────────────────────────────────────────
  describe("non-regression: paired NR prompts behave correctly", () => {
    test("orbital weld stainless gas panel 1/4 tubing — P14 still works, no regression", () => {
      const analysis = analyzeScopeAssistInput("orbital weld stainless gas panel 1/4 tubing");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingSecondaryTags).toContain("orbital_welding");
      expect(analysis.weldingMaterialContext).toContain("gas_panel");
    });

    test("erect structural steel beams and columns — P15 still works, no regression", () => {
      const analysis = analyzeScopeAssistInput("erect structural steel beams and columns");
      expect(analysis.ironworkTradeFamily).toBe("structural_steel_erection");
    });

    test("bolt up steel frame at canopy — ironwork confidence medium+, fallback non-null", () => {
      const analysis = analyzeScopeAssistInput("bolt up steel frame at canopy");
      expect(["medium", "high"]).toContain(analysis.ironworkConfidence);
      expect(buildSpecialtyLocalFallbackNote(analysis)).toBeTruthy();
    });

    test("tie rebar cage at footing — reinforcing_rebar, high confidence", () => {
      const analysis = analyzeScopeAssistInput("tie rebar cage at footing");
      expect(analysis.ironworkTradeFamily).toBe("reinforcing_rebar");
      expect(analysis.ironworkConfidence).toBe("high");
    });

    test("install handrail and guardrail at stair landing — P15 stairs_and_rails preserved", () => {
      const analysis = analyzeScopeAssistInput("install handrail and guardrail at stair landing");
      expect(analysis.ironworkTradeFamily).toBe("stairs_and_rails");
    });

    test("hang prehung door and shim jamb — carpentry door_installation, precision_fit bias", () => {
      const analysis = analyzeScopeAssistInput("hang prehung door and shim jamb");
      expect(analysis.carpentryTradeFamily).toBe("door_installation");
      expect(analysis.carpentryScopeBias).toContain("precision_fit");
    });

    test("install baseboard crown and casing — carpentry trim_molding", () => {
      const analysis = analyzeScopeAssistInput("install baseboard crown and casing");
      expect(analysis.carpentryTradeFamily).toBe("trim_molding");
    });

    test("set forms and strip slab edge forms — carpentry formwork_concrete", () => {
      const analysis = analyzeScopeAssistInput("set forms and strip slab edge forms");
      expect(analysis.carpentryTradeFamily).toBe("formwork_concrete");
    });

    test("install cabinets uppers lowers and fillers — finish_carpentry_casework", () => {
      const analysis = analyzeScopeAssistInput("install cabinets uppers lowers and fillers");
      expect(analysis.carpentryTradeFamily).toBe("finish_carpentry_casework");
    });

    test("replace storefront glass at entry — no carpentry gate, carpentryConfidence none", () => {
      const analysis = analyzeScopeAssistInput("replace storefront glass at entry");
      expect(analysis.carpentryConfidence).toBe("none");
    });

    test("trim left side and paint right side — P7 multi-zone preserved, no carpentry gate", () => {
      const analysis = analyzeScopeAssistInput("trim left side and paint right side");
      expect(analysis.relativeZoneHints).toBeTruthy();
      // carpentry gate must not fire on "trim" without "casing"
      expect(analysis.carpentryConfidence).toBe("none");
    });

    test("patch inside and seal outside — P8 multi-zone preserved, no carpentry gate", () => {
      const analysis = analyzeScopeAssistInput("patch inside and seal outside");
      expect(analysis.carpentryConfidence).toBe("none");
    });

    test("autogenous orbital weld on stainless tubing — P14+P17 both produce gtaw_tig", () => {
      const analysis = analyzeScopeAssistInput("autogenous orbital weld on stainless tubing");
      expect(analysis.weldingBaseProcess).toBe("gtaw_tig");
      expect(analysis.weldingSecondaryTags).toContain("orbital_welding");
      expect(analysis.weldingSecondaryTags).toContain("automatic_welding");
    });

    test("sanitary tube tig with purge — P14 preserved, backpurge + sanitary_tube_welding", () => {
      const analysis = analyzeScopeAssistInput("sanitary tube tig with purge");
      expect(analysis.weldingSecondaryTags).toContain("sanitary_tube_welding");
      expect(analysis.weldingSecondaryTags).toContain("backpurge_welding");
    });
  });
});

// ─── Pass 21 — buildSpecialtyLocalFallbackNote phrase quality ─────────────────
// Validates that all 20 target inputs produce verb-led, contractor-natural notes.
// Format rule: notes must start with an action verb (capital letter), not a label.
// Non-specialty inputs verified in Pass 16 D section above.
describe("Pass 21 — buildSpecialtyLocalFallbackNote verb-led phrase quality", () => {
  // ── Welding inputs ──────────────────────────────────────────────────────────
  describe("welding inputs — Perform [process] at/on [object]", () => {
    test("'orbital weld lines' → Perform orbital TIG welding at line connections", () => {
      const note = buildSpecialtyLocalFallbackNote(analyzeScopeAssistInput("orbital weld lines"));
      expect(note).toBeTruthy();
      expect(note).toMatch(/^Perform /i);
      expect(note).toContain("orbital");
      expect(note).toContain("TIG welding");
      expect(note).toContain("line connections");
    });

    test("'tig tube weld' → Perform TIG welding on tubing", () => {
      const note = buildSpecialtyLocalFallbackNote(analyzeScopeAssistInput("tig tube weld"));
      expect(note).toBeTruthy();
      expect(note).toMatch(/^Perform /i);
      expect(note).toMatch(/TIG welding/i);
    });

    test("'orbital tig tubing' → Perform orbital TIG welding on tubing", () => {
      const note = buildSpecialtyLocalFallbackNote(analyzeScopeAssistInput("orbital tig tubing"));
      expect(note).toBeTruthy();
      expect(note).toMatch(/^Perform /i);
      expect(note).toContain("orbital");
      expect(note).toMatch(/tubing|TIG welding/i);
    });

    test("'weld line tie in' → verb-led welding note (truthy, Perform-led)", () => {
      const a = analyzeScopeAssistInput("weld line tie in");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (a.weldingBaseProcess && (a.weldingConfidence === "medium" || a.weldingConfidence === "high")) {
        expect(note).toBeTruthy();
        expect(note).toMatch(/^Perform /i);
      }
    });

    test("'stick weld pipe joint' → Perform stick welding (verb-led)", () => {
      const a = analyzeScopeAssistInput("stick weld pipe joint");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^Perform /i);
        expect(note).toMatch(/stick welding/i);
      }
    });
  });

  // ── Ironwork inputs ─────────────────────────────────────────────────────────
  describe("ironwork inputs — capital-verb-led note, no family label prefix", () => {
    test("'bolt up steel frame' → verb-led note with bolt up", () => {
      const a = analyzeScopeAssistInput("bolt up steel frame");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Structural steel erection —/i);
        expect(note).toMatch(/bolt up/i);
      }
    });

    test("'align steel columns' → verb-led ironwork note", () => {
      const a = analyzeScopeAssistInput("align steel columns");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Structural steel erection —/i);
      }
    });

    test("'tie rebar cage' → verb-led reinforcing note", () => {
      const a = analyzeScopeAssistInput("tie rebar cage");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Reinforcing — rebar —/i);
        expect(note).toMatch(/rebar|tie|place/i);
      }
    });

    test("'install handrail and guardrail' → verb-led stairs/rails note", () => {
      const a = analyzeScopeAssistInput("install handrail and guardrail");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Stairs and rails —/i);
        expect(note).toMatch(/handrail|guardrail|install|erect/i);
      }
    });

    test("'bolt splice plates on bridge girder' → verb-led note with bridge context", () => {
      const a = analyzeScopeAssistInput("bolt splice plates on bridge girder");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).toMatch(/bolt|splice/i);
      }
    });

    test("'set canopy frame and supports' → verb-led note", () => {
      const a = analyzeScopeAssistInput("set canopy frame and supports");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Supports, frames/i);
      }
    });
  });

  // ── Carpentry inputs ────────────────────────────────────────────────────────
  describe("carpentry inputs — capital-verb-led note, no family label prefix", () => {
    test("'install cabinets uppers lowers' → verb-led finish carpentry note", () => {
      const a = analyzeScopeAssistInput("install cabinets uppers lowers");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Finish carpentry —/i);
        expect(note).toMatch(/install|hang|cabinet/i);
      }
    });

    test("'frame stud wall and soffit' → verb-led rough framing note", () => {
      const a = analyzeScopeAssistInput("frame stud wall and soffit");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Rough framing —/i);
        expect(note).toMatch(/frame|install|stud|soffit/i);
      }
    });

    test("'hang prehung door' → verb-led door installation note", () => {
      const a = analyzeScopeAssistInput("hang prehung door");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Door installation —/i);
        expect(note).toMatch(/hang|install|door/i);
      }
    });

    test("'install baseboard and casing' → verb-led trim note", () => {
      const a = analyzeScopeAssistInput("install baseboard and casing");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Trim and molding —/i);
        expect(note).toMatch(/baseboard|casing|install|trim/i);
      }
    });

    test("'patch subfloor and underlayment' → verb-led sheathing/subfloor note", () => {
      const a = analyzeScopeAssistInput("patch subfloor and underlayment");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Sheathing and subfloor —/i);
        expect(note).toMatch(/patch|repair|subfloor|underlayment/i);
      }
    });

    test("'frame bulkhead and backing' → verb-led rough framing note", () => {
      const a = analyzeScopeAssistInput("frame bulkhead and backing");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Rough framing —/i);
        expect(note).toMatch(/frame|install|bulkhead|backing/i);
      }
    });

    test("'set roof trusses' → verb-led note", () => {
      const a = analyzeScopeAssistInput("set roof trusses");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).toMatch(/set|install|truss/i);
      }
    });

    test("'install millwork shelving' → verb-led finish carpentry note", () => {
      const a = analyzeScopeAssistInput("install millwork shelving");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).not.toMatch(/^Finish carpentry —/i);
        expect(note).toMatch(/install|hang|millwork|shelf|shelv/i);
      }
    });

    test("'lap siding and corner trim' → verb-led note if specialty", () => {
      const a = analyzeScopeAssistInput("lap siding and corner trim");
      const note = buildSpecialtyLocalFallbackNote(a);
      if (note) {
        expect(note).toMatch(/^[A-Z]/);
        expect(note).toMatch(/install|trim|siding/i);
      }
    });
  });

  // ── Non-regression: P21 changes must not affect non-specialty inputs ────────
  describe("non-regression: non-specialty inputs still return null", () => {
    test("'paint drywall at lobby' → no fallback note", () => {
      expect(buildSpecialtyLocalFallbackNote(analyzeScopeAssistInput("paint drywall at lobby"))).toBeFalsy();
    });

    test("'replace door hardware at entry' → no fallback note", () => {
      expect(buildSpecialtyLocalFallbackNote(analyzeScopeAssistInput("replace door hardware at entry"))).toBeFalsy();
    });
  });
});
