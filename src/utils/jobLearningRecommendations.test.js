import {
  getJobLearningRecommendations,
  summarizeJobLearningRecommendations,
} from "./jobLearningRecommendations";

function createSnapshot(overrides = {}) {
  return {
    stats: { totalEvents: 8 },
    anomalies: {
      duplicateRegistryIds: [],
      invalidConfidenceRanges: [],
      emptySequences: [],
      unstableMarkedReusable: [],
      runtimeApprovedBelowStableTier: [],
    },
    candidateReadiness: {
      highConfidenceButNotApprovedCount: 0,
      stableButNotApprovedCount: 0,
    },
    healthSummary: {
      highConfidenceCandidateCount: 0,
    },
    sectionStabilitySignals: {
      scope: {
        confidenceScore: 0.25,
        rewriteSignalStrength: 0.55,
        validationFailureRate: 0.4,
      },
      labor: {
        confidenceScore: 0.82,
        rewriteSignalStrength: 0.05,
        validationFailureRate: 0,
      },
      materials: {
        confidenceScore: 0.6,
        rewriteSignalStrength: 0.1,
        validationFailureRate: 0.05,
      },
    },
    ...overrides,
  };
}

describe("jobLearningRecommendations", () => {
  test("empty null snapshot returns no-data recommendation", () => {
    const recommendations = getJobLearningRecommendations(null);

    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]).toMatchObject({
      id: "system-no-data",
      level: "info",
      area: "system",
      runtimeActionAllowed: false,
    });
  });

  test("anomalies produce blocked recommendation", () => {
    const recommendations = getJobLearningRecommendations(createSnapshot({
      anomalies: {
        duplicateRegistryIds: ["workflow_a_v1"],
        invalidConfidenceRanges: [],
        emptySequences: [],
        unstableMarkedReusable: [],
        runtimeApprovedBelowStableTier: [],
      },
    }));

    expect(recommendations.some((item) => item.level === "blocked" && item.area === "registry")).toBe(true);
    expect(recommendations.every((item) => item.runtimeActionAllowed === false)).toBe(true);
  });

  test("high-confidence unapproved candidates produce advisory but runtimeActionAllowed stays false", () => {
    const recommendations = getJobLearningRecommendations(createSnapshot({
      candidateReadiness: {
        highConfidenceButNotApprovedCount: 2,
        stableButNotApprovedCount: 0,
      },
      healthSummary: {
        highConfidenceCandidateCount: 2,
      },
      sectionStabilitySignals: {
        scope: { confidenceScore: 0.7, rewriteSignalStrength: 0.1, validationFailureRate: 0.05 },
        labor: { confidenceScore: 0.8, rewriteSignalStrength: 0.05, validationFailureRate: 0.02 },
        materials: { confidenceScore: 0.76, rewriteSignalStrength: 0.08, validationFailureRate: 0.01 },
      },
    }));

    expect(recommendations.some((item) => item.id === "workflow-high-confidence-unapproved" && (item.level === "ready" || item.level === "watch"))).toBe(true);
    expect(recommendations.every((item) => item.runtimeActionAllowed === false)).toBe(true);
  });

  test("weak section health produces watch recommendation", () => {
    const recommendations = getJobLearningRecommendations(createSnapshot());

    expect(recommendations.some((item) => item.id === "scope-rewrite-pressure" && item.level === "watch")).toBe(true);
  });

  test("strong section stability produces info or ready recommendation", () => {
    const recommendations = getJobLearningRecommendations(createSnapshot({
      sectionStabilitySignals: {
        scope: { confidenceScore: 0.72, rewriteSignalStrength: 0.1, validationFailureRate: 0.05 },
        labor: { confidenceScore: 0.88, rewriteSignalStrength: 0.04, validationFailureRate: 0.01 },
        materials: { confidenceScore: 0.65, rewriteSignalStrength: 0.08, validationFailureRate: 0.03 },
      },
    }));

    const strongSection = recommendations.find((item) => item.id === "labor-strong-stability");
    expect(strongSection).toBeTruthy();
    expect(["info", "ready"]).toContain(strongSection.level);
  });

  test("summary aggregates levels and areas correctly", () => {
    const summary = summarizeJobLearningRecommendations([
      { level: "ready", area: "workflow" },
      { level: "watch", area: "scope" },
      { level: "blocked", area: "registry" },
      { level: "watch", area: "workflow" },
    ]);

    expect(summary.total).toBe(4);
    expect(summary.byLevel.ready).toBe(1);
    expect(summary.byLevel.watch).toBe(2);
    expect(summary.byLevel.blocked).toBe(1);
    expect(summary.byArea.workflow).toBe(2);
    expect(summary.byArea.scope).toBe(1);
    expect(summary.byArea.registry).toBe(1);
    expect(summary.readyCount).toBe(1);
    expect(summary.blockedCount).toBe(1);
    expect(summary.watchCount).toBe(2);
  });

  test("malformed recommendation input fails closed safely", () => {
    const summary = summarizeJobLearningRecommendations([null, "bad", [], { level: "oops", area: "elsewhere" }]);

    expect(summary.total).toBe(1);
    expect(summary.byLevel.info).toBe(1);
    expect(summary.byArea.system).toBe(1);
    expect(summary.readyCount).toBe(0);
    expect(summary.blockedCount).toBe(0);
    expect(summary.watchCount).toBe(0);
  });
});
