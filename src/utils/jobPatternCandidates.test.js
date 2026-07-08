import {
  deriveLearningHealthSummary,
  deriveSectionStabilitySignals,
  deriveWorkflowPatternCandidates,
} from "./jobPatternCandidates";

describe("jobPatternCandidates", () => {
  test("repeated workflows become candidates only after minimum frequency threshold", () => {
    const single = deriveWorkflowPatternCandidates([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
    ]);
    expect(single).toEqual([]);

    const repeated = deriveWorkflowPatternCandidates([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
      { sectionKey: "scope", seam: "assist_request", timestamp: 400000 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 400001 },
    ]);
    expect(repeated).toHaveLength(1);
    expect(repeated[0].frequency).toBe(2);
  });

  test("confidence increases with accept/save presence", () => {
    const withoutAcceptSave = deriveWorkflowPatternCandidates([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
      { sectionKey: "scope", seam: "assist_request", timestamp: 400000 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 400001 },
    ])[0];

    const withAcceptSave = deriveWorkflowPatternCandidates([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 3 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 4 },
      { sectionKey: "scope", seam: "assist_request", timestamp: 400000 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 400001 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 400002 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 400003 },
    ])[0];

    expect(withAcceptSave.confidence).toBeGreaterThan(withoutAcceptSave.confidence);
  });

  test("validation failures and rewrite pressure lower confidence", () => {
    const clean = deriveWorkflowPatternCandidates([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 3 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 4 },
      { sectionKey: "scope", seam: "assist_request", timestamp: 400000 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 400001 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 400002 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 400003 },
    ])[0];

    const noisy = deriveWorkflowPatternCandidates([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 3 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 4 },
      { sectionKey: "scope", seam: "assist_request", timestamp: 400000 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 400001 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 400002 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 400003 },
      { sectionKey: "scope", seam: "assist_result", hasValidationError: true, timestamp: 800000 },
      { sectionKey: "scope", seam: "assist_result", hasValidationError: true, timestamp: 800001 },
      { sectionKey: "labor", seam: "assist_accept", timestamp: 900000 },
      { sectionKey: "materials", seam: "assist_accept", timestamp: 950000 },
    ])[0];

    expect(noisy.confidence).toBeLessThan(clean.confidence);
  });

  test("section stability signals return scope labor and materials", () => {
    const signals = deriveSectionStabilitySignals([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 2 },
      { sectionKey: "labor", seam: "assist_request", timestamp: 3 },
      { sectionKey: "materials", seam: "assist_request", timestamp: 4 },
    ]);

    expect(signals).toHaveProperty("scope");
    expect(signals).toHaveProperty("labor");
    expect(signals).toHaveProperty("materials");
  });

  test("health summary counts high low stable and unstable candidates safely", () => {
    const summary = deriveLearningHealthSummary([
      { sectionKey: "scope", seam: "assist_request", timestamp: 1 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 2 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 3 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 4 },
      { sectionKey: "scope", seam: "assist_request", timestamp: 400000 },
      { sectionKey: "scope", seam: "assist_result", timestamp: 400001 },
      { sectionKey: "scope", seam: "assist_accept", timestamp: 400002 },
      { seam: "document_save", saveType: "estimate", docType: "estimate", timestamp: 400003 },
      null,
    ]);

    expect(summary.totalUsableEvents).toBeGreaterThan(0);
    expect(summary.stableWorkflowCount + summary.unstableWorkflowCount).toBeGreaterThan(0);
    expect(summary.highConfidenceCandidateCount + summary.lowConfidenceCandidateCount).toBeGreaterThan(0);
  });
});
