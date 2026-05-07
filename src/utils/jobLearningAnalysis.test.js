import {
  getLearningAcceptanceRates,
  getLearningEditSignals,
  getLearningEventStats,
  getLearningWorkflowSequences,
} from "./jobLearningAnalysis";

describe("jobLearningAnalysis", () => {
  test("stats aggregate by section, seam, mode, result, action, and save type", () => {
    const stats = getLearningEventStats([
      { sectionKey: "scope", seam: "assist_request", mode: "create", resultType: "unknown", acceptedAction: "none", saveType: "unknown", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_accept", mode: "create", resultType: "validated", acceptedAction: "apply", saveType: "estimate", timestamp: 2 },
      { sectionKey: "labor", seam: "document_save", mode: "edit", resultType: "writes", acceptedAction: "replace", saveType: "invoice", timestamp: 3 },
    ]);

    expect(stats.totalEvents).toBe(3);
    expect(stats.bySectionKey.scope).toBe(2);
    expect(stats.bySeam.assist_request).toBe(1);
    expect(stats.byMode.create).toBe(2);
    expect(stats.byResultType.validated).toBe(1);
    expect(stats.byAcceptedAction.apply).toBe(1);
    expect(stats.saveTypeCounts.invoice).toBe(1);
  });

  test("workflow sequences group by 5-minute proximity", () => {
    const sequences = getLearningWorkflowSequences([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1000 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2000 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 303001 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 304000 },
    ]);

    expect(sequences).toEqual([
      { sequence: ["scope_accept", "estimate_save"], count: 1 },
      { sequence: ["scope_request", "scope_result"], count: 1 },
    ]);
  });

  test("max sequence length is capped", () => {
    const events = Array.from({ length: 8 }, (_, index) => ({
      sectionKey: "scope",
      seam: "assist_request",
      timestamp: index + 1,
    }));
    const sequences = getLearningWorkflowSequences(events);
    expect(sequences[0].sequence).toHaveLength(6);
  });

  test("acceptance rates calculate safely", () => {
    const rates = getLearningAcceptanceRates([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 3 },
      { sectionKey: "scope", seam: "assist_result", hasValidationError: true, timestamp: 4 },
    ]);

    expect(rates.scope.requests).toBe(1);
    expect(rates.scope.results).toBe(2);
    expect(rates.scope.accepts).toBe(1);
    expect(rates.scope.validationFailures).toBe(1);
    expect(rates.scope.acceptanceRateFromRequests).toBe(1);
    expect(rates.scope.acceptanceRateFromResults).toBe(0.5);
  });

  test("malformed events are ignored", () => {
    const stats = getLearningEventStats([null, "bad", [], { timestamp: 1 }, { seam: "assist_request", sectionKey: "scope", timestamp: 2 }]);
    expect(stats.totalEvents).toBe(1);
    expect(stats.bySeam.assist_request).toBe(1);
  });

  test("non-array input returns safe defaults", () => {
    expect(getLearningEventStats(null)).toEqual({
      totalEvents: 0,
      bySectionKey: {},
      bySeam: {},
      byMode: {},
      byResultType: {},
      byAcceptedAction: {},
      saveTypeCounts: {},
    });
    expect(getLearningWorkflowSequences(null)).toEqual([]);
    expect(getLearningEditSignals(null).saveWithoutAcceptPatterns).toBe(0);
  });
});
