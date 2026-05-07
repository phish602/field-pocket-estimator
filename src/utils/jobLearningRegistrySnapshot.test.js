import {
  buildJobLearningRegistrySnapshot,
  summarizeJobLearningRegistrySnapshot,
  detectJobLearningRegistryDrift,
  getJobLearningRegistryAuditRows,
} from "./jobLearningRegistrySnapshot";

function candidate(overrides) {
  return {
    fingerprint: "seq_base",
    approvalState: "approved_candidate",
    confidence: 0.9,
    scoringTier: "high_confidence",
    sequence: ["scope_request", "scope_accept", "estimate_save"],
    saveCount: 3,
    acceptedCount: 3,
    workflowClass: "scope_only",
    workflowComplexity: "simple",
    tradeHint: "painting",
    ...overrides,
  };
}

describe("jobLearningRegistrySnapshot", () => {
  test("composes runtime isolation through snapshot", () => {
    const candidates = [
      candidate({ fingerprint: "seq_clean" }),
      candidate({ fingerprint: "seq_review_ready", approvalState: "review_ready" }),
      candidate({ fingerprint: "seq_runtime_flag", approvedForRuntime: true }),
      candidate({ fingerprint: "seq_reusable_flag", reusable: true }),
      candidate({ fingerprint: "seq_bad_sequence", sequence: [] }),
    ];

    const snapshot = buildJobLearningRegistrySnapshot(candidates);

    expect(snapshot.runtimeApprovedCandidates).toHaveLength(1);
    expect(snapshot.runtimeApprovedCandidates[0]).toEqual(
      expect.objectContaining({
        fingerprint: "seq_clean",
        workflowClass: "scope_only",
        workflowComplexity: "simple",
        tradeHint: "painting",
        confidence: 0.9,
        scoringTier: "high_confidence",
        sequence: ["scope_request", "scope_accept", "estimate_save"],
        saveCount: 3,
        acceptedCount: 3,
      })
    );
    expect(Object.keys(snapshot.runtimeApprovedCandidates[0]).sort()).toEqual(
      [
        "acceptedCount",
        "confidence",
        "fingerprint",
        "saveCount",
        "scoringTier",
        "sequence",
        "tradeHint",
        "workflowClass",
        "workflowComplexity",
      ].sort()
    );
  });

  test("ranks promotions and consolidates equivalent candidates deterministically", () => {
    const candidates = [
      candidate({
        fingerprint: "seq_promotion_ready",
        approvalState: "approved_candidate",
        confidence: 0.9,
        scoringTier: "high_confidence",
        saveCount: 3,
        acceptedCount: 3,
        sequence: ["alpha", "beta", "gamma", "delta"],
      }),
      candidate({
        fingerprint: "seq_b",
        approvalState: "approved_candidate",
        confidence: 0.9,
        scoringTier: "high_confidence",
        saveCount: 1,
        acceptedCount: 1,
        sequence: ["echo", "foxtrot", "golf", "hotel"],
      }),
      candidate({
        fingerprint: "seq_a",
        approvalState: "approved_candidate",
        confidence: 0.9,
        scoringTier: "high_confidence",
        saveCount: 1,
        acceptedCount: 1,
        sequence: ["alpha", "bravo", "charlie", "delta"],
      }),
      candidate({
        fingerprint: "seq_review_strong",
        approvalState: "review_ready",
        confidence: 0.9,
        scoringTier: "high_confidence",
        saveCount: 2,
        acceptedCount: 2,
        sequence: ["india", "juliet", "kilo", "lima"],
      }),
      candidate({
        fingerprint: "seq_review_candidate",
        approvalState: "review_ready",
        confidence: 0.8,
        scoringTier: "stable",
        saveCount: 2,
        acceptedCount: 2,
        tradeHint: "",
        sequence: ["mike", "november", "oscar", "papa"],
      }),
      candidate({
        fingerprint: "seq_dup_winner",
        approvalState: "review_ready",
        confidence: 0.9,
        scoringTier: "high_confidence",
        saveCount: 2,
        acceptedCount: 2,
        workflowClass: "labor",
        workflowComplexity: "moderate",
        tradeHint: "drywall",
        sequence: [" Paint ", "paint", "paint", "prep"],
      }),
      candidate({
        fingerprint: "seq_dup_loser",
        approvalState: "needs_review",
        confidence: 0.7,
        scoringTier: "stable",
        saveCount: 1,
        acceptedCount: 1,
        workflowClass: "labor",
        workflowComplexity: "moderate",
        tradeHint: "drywall",
        sequence: ["paint", "prep"],
      }),
    ];

    const snapshot = buildJobLearningRegistrySnapshot(candidates);

    expect(snapshot.promotionRanking.map((row) => row.fingerprint)).toEqual([
      "seq_promotion_ready",
      "seq_dup_winner",
      "seq_review_strong",
      "seq_a",
      "seq_b",
      "seq_review_candidate",
      "seq_dup_loser",
    ]);
    expect(snapshot.promotionRanking[0].promotionState).toBe("promotion_ready");
    expect(snapshot.promotionRanking.find((row) => row.fingerprint === "seq_review_strong")).toEqual(
      expect.objectContaining({
        approvalState: "review_ready",
        promotionState: "strong_candidate",
      })
    );
    expect(snapshot.promotionRanking.find((row) => row.fingerprint === "seq_review_candidate")).toEqual(
      expect.objectContaining({
        approvalState: "review_ready",
        promotionState: "review_candidate",
      })
    );
    const duplicateGroups = snapshot.consolidationGroups.filter((group) => group.duplicateCount > 0);

    expect(duplicateGroups).toHaveLength(1);
    expect(duplicateGroups[0]).toEqual(
      expect.objectContaining({
        consolidationKey: "labor|moderate|drywall|paint>prep",
        canonicalFingerprint: "seq_dup_winner",
        duplicateCount: 1,
        suppressedFingerprints: ["seq_dup_loser"],
      })
    );
  });

  test("summarizes drift and registry health deterministically", () => {
    const candidates = [
      candidate({
        fingerprint: "seq_runtime_flag",
        approvedForRuntime: true,
        workflowClass: "labor",
        workflowComplexity: "moderate",
        tradeHint: "painting",
        sequence: ["runtime", "flag", "one"],
      }),
      candidate({
        fingerprint: "seq_policy_flag",
        reusable: true,
        confidence: 0.5,
        scoringTier: "stable",
        workflowClass: "labor",
        workflowComplexity: "moderate",
        tradeHint: "painting",
        sequence: ["policy", "flag", "two"],
      }),
      candidate({
        fingerprint: "seq_dup_a",
        approvalState: "needs_review",
        confidence: 0.7,
        scoringTier: "stable",
        workflowClass: "labor",
        workflowComplexity: "moderate",
        tradeHint: "drywall",
        sequence: ["Paint ", "paint", "prep"],
      }),
      candidate({
        fingerprint: "seq_dup_b",
        approvalState: "review_ready",
        confidence: 0.7,
        scoringTier: "stable",
        workflowClass: "labor",
        workflowComplexity: "moderate",
        tradeHint: "drywall",
        sequence: ["paint", "prep"],
      }),
    ];

    const summary = summarizeJobLearningRegistrySnapshot(candidates);
    const drift = detectJobLearningRegistryDrift(candidates);

    expect(summary).toEqual(
      expect.objectContaining({
        totalCandidates: 4,
        approvedRuntimeCount: 0,
        promotionReadyCount: 0,
        blockedRuntimeCount: 4,
        duplicateGroupCount: 1,
        suppressedCandidateCount: 1,
        overallRisk: "critical",
      })
    );
    expect(drift).toEqual({
      hasDrift: true,
      driftReasons: [
        "runtime_violations",
        "approval_violations",
        "policy_violations",
        "promotion_violations",
        "consolidation_duplicates",
        "runtime_blocked_candidates",
        "no_runtime_approved_candidates",
      ],
    });
  });

  test("returns stable audit rows for valid fingerprints only", () => {
    const candidates = [
      candidate({
        fingerprint: "seq_clean",
        workflowClass: "scope_only",
        workflowComplexity: "simple",
        tradeHint: "painting",
        sequence: ["scope_clean", "scope_accept", "estimate_save", "cleanup"],
      }),
      candidate({
        fingerprint: "seq_dup_winner",
        approvalState: "review_ready",
        confidence: 0.9,
        scoringTier: "high_confidence",
        saveCount: 2,
        acceptedCount: 2,
        workflowClass: "labor",
        workflowComplexity: "moderate",
        tradeHint: "drywall",
        sequence: [" Paint ", "paint", "paint", "prep"],
      }),
      candidate({
        fingerprint: "seq_dup_loser",
        approvalState: "needs_review",
        confidence: 0.7,
        scoringTier: "stable",
        saveCount: 1,
        acceptedCount: 1,
        workflowClass: "labor",
        workflowComplexity: "moderate",
        tradeHint: "drywall",
        sequence: ["paint", "prep"],
      }),
      candidate({
        fingerprint: "seq_review_strong",
        approvalState: "review_ready",
        confidence: 0.9,
        scoringTier: "high_confidence",
        saveCount: 2,
        acceptedCount: 2,
        sequence: ["quebec", "romeo", "sierra", "tango"],
      }),
      candidate({
        fingerprint: "  ",
        approvalState: "review_ready",
        sequence: ["scope_request"],
      }),
    ];

    const rows = getJobLearningRegistryAuditRows(candidates);

    expect(rows).toHaveLength(4);
    expect(rows.map((row) => row.fingerprint)).toEqual([
      "seq_clean",
      "seq_dup_winner",
      "seq_review_strong",
      "seq_dup_loser",
    ]);
    expect(rows[0]).toEqual(
      expect.objectContaining({
        runtimeEligible: true,
        isCanonical: true,
        isSuppressed: false,
        promotionState: "promotion_ready",
      })
    );
    expect(rows[1]).toEqual(
      expect.objectContaining({
        consolidationKey: "labor|moderate|drywall|paint>prep",
        isCanonical: true,
        isSuppressed: false,
      })
    );
    expect(rows[3]).toEqual(
      expect.objectContaining({
        consolidationKey: "labor|moderate|drywall|paint>prep",
        isCanonical: false,
        isSuppressed: true,
      })
    );
    expect(rows.every((row) => row.runtimeEligible === (row.fingerprint === "seq_clean"))).toBe(true);
  });
});
