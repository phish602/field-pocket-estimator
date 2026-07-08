import {
  assembleJobLearningCandidateDrafts,
  summarizeCandidateAssembly,
  detectCandidateAssemblyIssues,
} from "./jobLearningCandidateAssembler";

function makeCompleteTrace(traceId, overrides = {}) {
  const base = {
    assistTraceId: traceId,
    assistSectionKey: "scope",
    assistDocType: "estimate",
    assistMode: "create",
    sectionKey: "scope",
    docType: "estimate",
    mode: "create",
  };

  return [
    {
      seam: "assist_request",
      ...base,
      ...overrides.request,
    },
    {
      seam: "assist_result",
      ...base,
      success: true,
      hasWrites: true,
      resultType: "validated",
      writeKeyCount: 2,
      ...overrides.result,
    },
    {
      seam: "assist_accept",
      ...base,
      ...overrides.accept,
    },
  ];
}

describe("jobLearningCandidateAssembler", () => {
  test("assembles one complete accepted span into a conservative candidate draft", () => {
    const events = makeCompleteTrace("trace-1");

    const assembled = assembleJobLearningCandidateDrafts(events);

    expect(assembled.candidateDrafts).toHaveLength(1);
    expect(assembled.quarantinedEvents).toHaveLength(0);

    const draft = assembled.candidateDrafts[0];
    expect(draft.approvalState).toBe("needs_review");
    expect(draft.sequence).toEqual(["assist_request", "assist_result", "assist_accept"]);
    expect(draft.acceptedCount).toBe(1);
    expect(draft.saveCount).toBe(0);
    expect(draft.confidence).toBe(0.75);
    expect(draft.scoringTier).toBe("emerging");
    expect(draft.evidence).toEqual({
      requestSeen: true,
      resultSeen: true,
      acceptSeen: true,
      documentSaveSeen: false,
      resultType: "validated",
      writeKeyCount: 2,
      saveDocType: null,
      saveMode: null,
      isProjectSeeded: false,
      isInvoiceFromEstimate: false,
    });
  });

  test("appends document_save context when matching save metadata exists", () => {
    const events = [
      ...makeCompleteTrace("trace-2"),
      {
        seam: "document_save",
        docType: "estimate",
        saveDocType: "estimate",
        saveMode: "create",
        isProjectSeeded: true,
        isInvoiceFromEstimate: false,
        sectionKey: "scope",
      },
    ];

    const assembled = assembleJobLearningCandidateDrafts(events);
    const draft = assembled.candidateDrafts[0];

    expect(assembled.candidateDrafts).toHaveLength(1);
    expect(draft.sequence).toEqual(["assist_request", "assist_result", "assist_accept", "document_save"]);
    expect(draft.saveCount).toBe(1);
    expect(draft.confidence).toBe(0.8);
    expect(draft.scoringTier).toBe("stable");
    expect(draft.evidence.documentSaveSeen).toBe(true);
    expect(draft.evidence.saveDocType).toBe("estimate");
    expect(draft.evidence.saveMode).toBe("create");
    expect(draft.evidence.isProjectSeeded).toBe(true);
  });

  test("fails closed for incomplete traces", () => {
    const missingAccept = [
      {
        seam: "assist_request",
        assistTraceId: "trace-3",
        assistSectionKey: "scope",
        assistDocType: "estimate",
        assistMode: "create",
      },
      {
        seam: "assist_result",
        assistTraceId: "trace-3",
        assistSectionKey: "scope",
        assistDocType: "estimate",
        assistMode: "create",
        success: true,
        hasWrites: true,
      },
    ];
    const missingSuccess = [
      {
        seam: "assist_request",
        assistTraceId: "trace-4",
        assistSectionKey: "scope",
        assistDocType: "estimate",
        assistMode: "create",
      },
      {
        seam: "assist_result",
        assistTraceId: "trace-4",
        assistSectionKey: "scope",
        assistDocType: "estimate",
        assistMode: "create",
        success: false,
        hasWrites: true,
      },
      {
        seam: "assist_accept",
        assistTraceId: "trace-4",
        assistSectionKey: "scope",
        assistDocType: "estimate",
        assistMode: "create",
      },
    ];

    const assembledA = assembleJobLearningCandidateDrafts(missingAccept);
    const assembledB = assembleJobLearningCandidateDrafts(missingSuccess);
    const issuesA = detectCandidateAssemblyIssues(missingAccept);
    const issuesB = detectCandidateAssemblyIssues(missingSuccess);

    expect(assembledA.candidateDrafts).toHaveLength(0);
    expect(assembledB.candidateDrafts).toHaveLength(0);
    expect(assembledA.quarantinedEvents.some((entry) => String(entry.label).includes("trace-3"))).toBe(true);
    expect(assembledB.quarantinedEvents.some((entry) => String(entry.label).includes("trace-4"))).toBe(true);
    expect(issuesA.incompleteTraces).toContain("trace-3");
    expect(issuesB.incompleteTraces).toContain("trace-4");
  });

  test("fails closed for duplicate trace events", () => {
    const duplicateResult = makeCompleteTrace("trace-5");
    duplicateResult.splice(2, 0, {
      seam: "assist_result",
      assistTraceId: "trace-5",
      assistSectionKey: "scope",
      assistDocType: "estimate",
      assistMode: "create",
      success: true,
      hasWrites: true,
    });

    const duplicateAccept = makeCompleteTrace("trace-6");
    duplicateAccept.push({
      seam: "assist_accept",
      assistTraceId: "trace-6",
      assistSectionKey: "scope",
      assistDocType: "estimate",
      assistMode: "create",
    });

    const assembledA = assembleJobLearningCandidateDrafts(duplicateResult);
    const assembledB = assembleJobLearningCandidateDrafts(duplicateAccept);
    const issuesA = detectCandidateAssemblyIssues(duplicateResult);
    const issuesB = detectCandidateAssemblyIssues(duplicateAccept);

    expect(assembledA.candidateDrafts).toHaveLength(0);
    expect(assembledB.candidateDrafts).toHaveLength(0);
    expect(issuesA.duplicateTraces).toContain("trace-5");
    expect(issuesB.duplicateTraces).toContain("trace-6");
  });

  test("fails closed for conflicting metadata and malformed events", () => {
    const events = [
      null,
      {
        seam: "assist_request",
        assistTraceId: "trace-7",
        assistSectionKey: "scope",
        assistDocType: "estimate",
        assistMode: "create",
      },
      {
        seam: "assist_result",
        assistTraceId: "trace-7",
        assistSectionKey: "labor",
        assistDocType: "estimate",
        assistMode: "create",
        success: true,
        hasWrites: true,
      },
      {
        seam: "assist_accept",
        assistTraceId: "trace-7",
        assistSectionKey: "scope",
        assistDocType: "invoice",
        assistMode: "create",
      },
      {
        seam: "assist_request",
        assistSectionKey: "scope",
        assistDocType: "estimate",
        assistMode: "create",
      },
    ];

    const assembled = assembleJobLearningCandidateDrafts(events);
    const issues = detectCandidateAssemblyIssues(events);

    expect(assembled.candidateDrafts).toHaveLength(0);
    expect(issues.malformedEvents).toContain("event:0");
    expect(issues.missingTraceEvents).toContain("event:4");
    expect(issues.conflictingMetadataTraces).toContain("trace-7");
  });

  test("summarizes mixed complete and incomplete assembly deterministically", () => {
    const events = [
      ...makeCompleteTrace("trace-8"),
      ...makeCompleteTrace("trace-9", {
        result: { success: false, hasWrites: true, resultType: "empty" },
      }),
      ...makeCompleteTrace("trace-10", {
        result: { success: true, hasWrites: true },
      }),
      {
        seam: "assist_request",
        assistTraceId: "trace-11",
        assistSectionKey: "scope",
        assistDocType: "estimate",
        assistMode: "create",
      },
    ];

    const summary = summarizeCandidateAssembly(events);

    expect(summary.totalEvents).toBe(events.length);
    expect(summary.candidateDraftCount).toBe(2);
    expect(summary.completeTraceCount).toBe(2);
    expect(summary.incompleteTraceCount).toBe(2);
    expect(summary.duplicateTraceCount).toBe(0);
    expect(summary.quarantinedEventCount).toBeGreaterThan(0);
    expect(summary.warningCount).toBeGreaterThan(0);
  });
});
