import {
  detectRegistryAnomalies,
  summarizeCandidateReadiness,
  summarizeSectionHealth,
  summarizeWorkflowStrength,
} from "./jobPatternDiagnostics";

describe("jobPatternDiagnostics", () => {
  test("workflow strength reports strongest and weakest deterministically", () => {
    const summary = summarizeWorkflowStrength([
      { registryId: "b", confidence: 0.82, frequency: 4, tier: "high_confidence", sequence: ["scope_request"] },
      { registryId: "a", confidence: 0.82, frequency: 4, tier: "high_confidence", sequence: ["labor_request"] },
      { registryId: "c", confidence: 0.1, frequency: 1, tier: "unstable", sequence: ["materials_request"] },
    ]);

    expect(summary.strongestWorkflows[0].registryId).toBe("a");
    expect(summary.weakestWorkflows[0].registryId).toBe("c");
    expect(summary.highConfidenceWorkflowCount).toBe(2);
    expect(summary.unstableWorkflowCount).toBe(1);
  });

  test("section health identifies healthiest and weakest section", () => {
    const summary = summarizeSectionHealth({
      scope: { confidenceScore: 0.8, validationFailureRate: 0.1, rewriteSignalStrength: 0.2, saveCompletionRate: 0.9 },
      labor: { confidenceScore: 0.4, validationFailureRate: 0.3, rewriteSignalStrength: 0.5, saveCompletionRate: 0.4 },
      materials: { confidenceScore: 0.6, validationFailureRate: 0.2, rewriteSignalStrength: 0.1, saveCompletionRate: 0.6 },
    });

    expect(summary.healthiestSection.sectionKey).toBe("scope");
    expect(summary.weakestSection.sectionKey).toBe("labor");
    expect(summary.validationRiskIndicators.find((entry) => entry.sectionKey === "labor").atRisk).toBe(true);
  });

  test("readiness summary counts quarantined stable and high-confidence unapproved", () => {
    const summary = summarizeCandidateReadiness([
      { registryId: "a", tier: "unstable", reusable: false, approvedForRuntime: false, sequence: ["scope_request"] },
      { registryId: "b", tier: "stable", reusable: false, approvedForRuntime: false, sequence: ["scope_accept"] },
      { registryId: "c", tier: "high_confidence", reusable: false, approvedForRuntime: false, sequence: ["estimate_save"] },
      { registryId: "d", tier: "stable", reusable: true, approvedForRuntime: true, sequence: ["labor_accept"] },
    ]);

    expect(summary.totalCandidates).toBe(4);
    expect(summary.quarantinedCount).toBe(1);
    expect(summary.stableButNotApprovedCount).toBe(1);
    expect(summary.highConfidenceButNotApprovedCount).toBe(1);
  });

  test("anomaly detection flags duplicate ids invalid confidence empty sequences unstable reusable and runtime-approved below stable tier", () => {
    const anomalies = detectRegistryAnomalies([
      { registryId: "dup", confidence: 0.5, tier: "stable", reusable: false, approvedForRuntime: false, sequence: ["scope_request"] },
      { registryId: "dup", confidence: 0.5, tier: "stable", reusable: false, approvedForRuntime: false, sequence: ["scope_result"] },
      { registryId: "bad-confidence", confidence: 2, tier: "stable", reusable: false, approvedForRuntime: false, sequence: ["scope_accept"] },
      { registryId: "empty-seq", confidence: 0.3, tier: "unstable", reusable: false, approvedForRuntime: false, sequence: [] },
      { registryId: "unstable-reusable", confidence: 0.2, tier: "unstable", reusable: true, approvedForRuntime: false, sequence: ["labor_request"] },
      { registryId: "approved-too-low", confidence: 0.5, tier: "emerging", reusable: false, approvedForRuntime: true, sequence: ["estimate_save"] },
    ]);

    expect(anomalies.duplicateRegistryIds).toEqual(["dup"]);
    expect(anomalies.invalidConfidenceRanges).toEqual(["bad-confidence"]);
    expect(anomalies.emptySequences).toEqual(["empty-seq"]);
    expect(anomalies.unstablePatternsMarkedReusable).toEqual(["unstable-reusable"]);
    expect(anomalies.runtimeApprovedBelowStableTier).toEqual(["approved-too-low"]);
  });
});
