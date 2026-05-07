import {
  classifyPatternTier,
  createJobPatternRegistry,
  dedupeWorkflowCandidates,
} from "./jobPatternRegistry";

describe("jobPatternRegistry", () => {
  test("duplicate workflow candidates merge by sequence and aggregate frequency", () => {
    const deduped = dedupeWorkflowCandidates([
      { patternId: "a", sequence: ["scope_request", "scope_result"], frequency: 2, confidence: 0.4 },
      { patternId: "b", sequence: ["scope_request", "scope_result"], frequency: 3, confidence: 0.8 },
    ]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0].frequency).toBe(5);
    expect(deduped[0].confidence).toBe(0.8);
  });

  test("tier thresholds classify correctly", () => {
    expect(classifyPatternTier({ confidence: 0.39 })).toBe("unstable");
    expect(classifyPatternTier({ confidence: 0.4 })).toBe("emerging");
    expect(classifyPatternTier({ confidence: 0.6 })).toBe("stable");
    expect(classifyPatternTier({ confidence: 0.8 })).toBe("high_confidence");
  });

  test("registry entries default reusable false and approvedForRuntime false", () => {
    const registry = createJobPatternRegistry([
      { sequence: ["scope_request", "scope_result", "scope_accept"], frequency: 4, confidence: 0.81 },
    ]);

    expect(registry[0].reusable).toBe(false);
    expect(registry[0].approvedForRuntime).toBe(false);
  });

  test("malformed candidates are ignored", () => {
    const registry = createJobPatternRegistry([
      null,
      "bad",
      { frequency: 2, confidence: 0.8 },
      { sequence: ["scope_request"], frequency: 1, confidence: 0.2 },
    ]);

    expect(registry).toHaveLength(1);
    expect(registry[0].registryId).toMatch(/^workflow_/);
  });
});
