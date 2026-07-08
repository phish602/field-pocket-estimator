// @ts-nocheck
/* eslint-disable */

const EMPTY_ARRAY = Object.freeze([]);

const BLOCKED_STATES = Object.freeze([
  "rejected",
  "quarantined",
  "runtime_blocked",
]);

const PROMOTION_STATE_PRIORITY = Object.freeze({
  promotion_ready: 5,
  strong_candidate: 4,
  review_candidate: 3,
  not_ready: 2,
  blocked: 1,
});

const KNOWN_COMPLEXITIES = Object.freeze({
  simple: true,
  moderate: true,
  complex: true,
});

const ZERO_SUMMARY = Object.freeze({
  total: 0,
  promotionReady: 0,
  strongCandidates: 0,
  reviewCandidates: 0,
  notReady: 0,
  blocked: 0,
  readinessRate: 0,
  blockedRate: 0,
});

const ZERO_VIOLATIONS = Object.freeze({
  malformedCandidates: EMPTY_ARRAY,
  unsafeRuntimeFlags: EMPTY_ARRAY,
  unsafeReusableCandidates: EMPTY_ARRAY,
  blockedApprovalStates: EMPTY_ARRAY,
  malformedFingerprints: EMPTY_ARRAY,
  malformedSequences: EMPTY_ARRAY,
  malformedConfidence: EMPTY_ARRAY,
  duplicateHeavyCandidates: EMPTY_ARRAY,
  totalViolationCount: 0,
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidFingerprint(value) {
  return safeTrimmedString(value).length > 0;
}

function normalizeFingerprint(value) {
  return isValidFingerprint(value) ? safeTrimmedString(value) : "";
}

function isValidSequence(sequence) {
  if (!Array.isArray(sequence) || sequence.length === 0) return false;
  for (let i = 0; i < sequence.length; i += 1) {
    if (safeTrimmedString(sequence[i]).length === 0) return false;
  }
  return true;
}

function normalizeSequence(sequence) {
  if (!isValidSequence(sequence)) return null;
  return sequence.map((token) => safeTrimmedString(token));
}

function isValidConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
}

function normalizeConfidence(value) {
  return isValidConfidence(value) ? Number(value) : -1;
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
}

function hasKnownWorkflowClass(value) {
  const workflowClass = safeTrimmedString(value);
  return workflowClass.length > 0 && workflowClass !== "unknown";
}

function hasKnownWorkflowComplexity(value) {
  const workflowComplexity = safeTrimmedString(value);
  return KNOWN_COMPLEXITIES[workflowComplexity] === true;
}

function hasTradeHint(value) {
  return safeTrimmedString(value).length > 0;
}

function hasHeavyDuplication(sequence) {
  if (!Array.isArray(sequence) || sequence.length < 4) return false;
  const normalized = normalizeSequence(sequence);
  if (!normalized) return false;
  const uniqueCount = new Set(normalized).size;
  return uniqueCount <= (normalized.length / 2);
}

function clampScore(score) {
  return Math.max(0, Math.min(100, Math.round(Number(score) || 0)));
}

function roundRate(value) {
  const bounded = Math.max(0, Math.min(1, Number(value) || 0));
  return Math.round(bounded * 1000) / 1000;
}

function candidateLabel(candidate, index) {
  if (isPlainObject(candidate) && isValidFingerprint(candidate.fingerprint)) {
    return normalizeFingerprint(candidate.fingerprint);
  }
  return "candidate:" + index;
}

function isBlockedApprovalState(value) {
  return BLOCKED_STATES.indexOf(safeTrimmedString(value)) >= 0;
}

function buildBlockedResult(reasons) {
  return Object.freeze({
    promotionState: "blocked",
    promotionScore: 0,
    reasons: Object.freeze(reasons.slice()),
  });
}

function collectBlockingReasons(candidate) {
  const reasons = [];

  if (!isPlainObject(candidate)) {
    reasons.push("malformed_candidate");
    return reasons;
  }

  if (candidate.approvedForRuntime === true) reasons.push("approved_for_runtime_true");
  if (candidate.reusable === true) reasons.push("reusable_true");
  if (isBlockedApprovalState(candidate.approvalState)) {
    reasons.push("blocked_approval_state:" + safeTrimmedString(candidate.approvalState));
  }
  if (!isValidFingerprint(candidate.fingerprint)) reasons.push("malformed_fingerprint");
  if (!isValidSequence(candidate.sequence)) reasons.push("malformed_sequence");
  if (!isValidConfidence(candidate.confidence)) reasons.push("malformed_confidence");

  return reasons;
}

function buildScoringReasons(candidate, normalized) {
  const reasons = [];

  if (safeTrimmedString(candidate.approvalState) === "approved_candidate") {
    reasons.push("approval_state_approved_candidate");
  } else if (safeTrimmedString(candidate.approvalState) === "review_ready") {
    reasons.push("approval_state_review_ready");
  } else if (safeTrimmedString(candidate.approvalState) === "needs_review") {
    reasons.push("approval_state_needs_review");
  }

  if (safeTrimmedString(candidate.scoringTier) === "high_confidence") {
    reasons.push("scoring_tier_high_confidence");
  } else if (safeTrimmedString(candidate.scoringTier) === "stable") {
    reasons.push("scoring_tier_stable");
  } else if (["weak", "moderate", "unknown"].indexOf(safeTrimmedString(candidate.scoringTier)) >= 0) {
    reasons.push("scoring_tier_penalized:" + safeTrimmedString(candidate.scoringTier));
  }

  if (normalized.confidence >= 0.9) {
    reasons.push("confidence_ge_0_9");
  } else if (normalized.confidence >= 0.8) {
    reasons.push("confidence_ge_0_8");
  } else if (normalized.confidence < 0.75) {
    reasons.push("confidence_below_0_75");
  }

  if (normalized.saveCount >= 3) {
    reasons.push("save_count_ge_3");
  } else if (normalized.saveCount === 2) {
    reasons.push("save_count_eq_2");
  } else if (normalized.saveCount === 1) {
    reasons.push("save_count_eq_1");
  } else {
    reasons.push("save_count_missing_or_zero");
  }

  if (normalized.acceptedCount >= 3) {
    reasons.push("accepted_count_ge_3");
  } else if (normalized.acceptedCount === 2) {
    reasons.push("accepted_count_eq_2");
  } else if (normalized.acceptedCount === 1) {
    reasons.push("accepted_count_eq_1");
  } else {
    reasons.push("accepted_count_missing_or_zero");
  }

  if (normalized.sequenceLength >= 4) reasons.push("sequence_length_ge_4");
  if (normalized.knownWorkflowClass) reasons.push("known_workflow_class");
  if (normalized.knownWorkflowComplexity) reasons.push("known_workflow_complexity");
  if (normalized.hasTradeHint) reasons.push("trade_hint_present");
  if (normalized.duplicateHeavy) reasons.push("duplicate_heavy_sequence");

  return reasons;
}

function normalizeCandidateMetrics(candidate) {
  const sequence = normalizeSequence(candidate.sequence);
  const confidence = normalizeConfidence(candidate.confidence);
  const saveCount = normalizeCount(candidate.saveCount);
  const acceptedCount = normalizeCount(candidate.acceptedCount);

  return Object.freeze({
    fingerprint: normalizeFingerprint(candidate.fingerprint),
    confidence,
    saveCount,
    acceptedCount,
    sequenceLength: sequence ? sequence.length : 0,
    duplicateHeavy: hasHeavyDuplication(sequence),
    knownWorkflowClass: hasKnownWorkflowClass(candidate.workflowClass),
    knownWorkflowComplexity: hasKnownWorkflowComplexity(candidate.workflowComplexity),
    hasTradeHint: hasTradeHint(candidate.tradeHint),
  });
}

export function evaluatePromotionReadiness(candidate) {
  try {
    const blockingReasons = collectBlockingReasons(candidate);
    if (blockingReasons.length > 0) return buildBlockedResult(blockingReasons);

    const normalized = normalizeCandidateMetrics(candidate);
    let score = 0;

    if (safeTrimmedString(candidate.approvalState) === "approved_candidate") score += 25;
    if (safeTrimmedString(candidate.approvalState) === "review_ready") score += 20;
    if (safeTrimmedString(candidate.approvalState) === "needs_review") score += 10;

    if (safeTrimmedString(candidate.scoringTier) === "high_confidence") score += 20;
    if (safeTrimmedString(candidate.scoringTier) === "stable") score += 12;

    if (normalized.confidence >= 0.9) score += 10;
    if (normalized.confidence >= 0.8 && normalized.confidence < 0.9) score += 6;

    if (normalized.saveCount >= 3) score += 12;
    if (normalized.saveCount === 2) score += 8;
    if (normalized.saveCount === 1) score += 4;

    if (normalized.acceptedCount >= 3) score += 12;
    if (normalized.acceptedCount === 2) score += 8;
    if (normalized.acceptedCount === 1) score += 4;

    if (normalized.sequenceLength >= 4) score += 6;
    if (normalized.knownWorkflowClass) score += 4;
    if (normalized.knownWorkflowComplexity) score += 4;
    if (normalized.hasTradeHint) score += 3;

    if (normalized.duplicateHeavy) score -= 20;
    if (normalized.saveCount === 0) score -= 12;
    if (normalized.acceptedCount === 0) score -= 12;
    if (["weak", "moderate", "unknown"].indexOf(safeTrimmedString(candidate.scoringTier)) >= 0) score -= 10;
    if (normalized.confidence < 0.75) score -= 8;

    const promotionScore = clampScore(score);
    let promotionState = "not_ready";

    if (promotionScore >= 85 && safeTrimmedString(candidate.approvalState) === "approved_candidate") {
      promotionState = "promotion_ready";
    } else if (promotionScore >= 75) {
      promotionState = "strong_candidate";
    } else if (promotionScore >= 55) {
      promotionState = "review_candidate";
    }

    return Object.freeze({
      promotionState,
      promotionScore,
      reasons: Object.freeze(buildScoringReasons(candidate, normalized)),
    });
  } catch {
    return buildBlockedResult(["malformed_candidate"]);
  }
}

export function rankPromotionCandidates(candidates) {
  try {
    if (!Array.isArray(candidates)) return [];

    const ranked = candidates.reduce((accumulator, candidate) => {
      if (!isPlainObject(candidate) && !isValidFingerprint(candidate && candidate.fingerprint)) {
        return accumulator;
      }

      const evaluation = evaluatePromotionReadiness(candidate);
      const fingerprint = normalizeFingerprint(candidate && candidate.fingerprint);
      if (!fingerprint) return accumulator;

      return accumulator.concat(Object.freeze({
        fingerprint,
        promotionState: evaluation.promotionState,
        promotionScore: evaluation.promotionScore,
        reasons: evaluation.reasons,
        approvalState: safeTrimmedString(candidate.approvalState),
        scoringTier: safeTrimmedString(candidate.scoringTier),
        workflowClass: safeTrimmedString(candidate.workflowClass),
        workflowComplexity: safeTrimmedString(candidate.workflowComplexity),
        tradeHint: safeTrimmedString(candidate.tradeHint),
        _confidence: normalizeConfidence(candidate.confidence),
        _saveCount: normalizeCount(candidate.saveCount),
        _acceptedCount: normalizeCount(candidate.acceptedCount),
      }));
    }, []);

    return ranked
      .slice()
      .sort((a, b) => {
        if (b.promotionScore !== a.promotionScore) return b.promotionScore - a.promotionScore;
        if (PROMOTION_STATE_PRIORITY[b.promotionState] !== PROMOTION_STATE_PRIORITY[a.promotionState]) {
          return PROMOTION_STATE_PRIORITY[b.promotionState] - PROMOTION_STATE_PRIORITY[a.promotionState];
        }
        if (b._confidence !== a._confidence) return b._confidence - a._confidence;
        if (b._saveCount !== a._saveCount) return b._saveCount - a._saveCount;
        if (b._acceptedCount !== a._acceptedCount) return b._acceptedCount - a._acceptedCount;
        return a.fingerprint.localeCompare(b.fingerprint);
      })
      .map((item) => Object.freeze({
        fingerprint: item.fingerprint,
        promotionState: item.promotionState,
        promotionScore: item.promotionScore,
        reasons: item.reasons,
        approvalState: item.approvalState,
        scoringTier: item.scoringTier,
        workflowClass: item.workflowClass,
        workflowComplexity: item.workflowComplexity,
        tradeHint: item.tradeHint,
      }));
  } catch {
    return [];
  }
}

export function summarizePromotionHealth(candidates) {
  try {
    if (!Array.isArray(candidates)) return ZERO_SUMMARY;

    const ranked = rankPromotionCandidates(candidates);
    const total = ranked.length;
    if (total === 0) return ZERO_SUMMARY;

    let promotionReady = 0;
    let strongCandidates = 0;
    let reviewCandidates = 0;
    let notReady = 0;
    let blocked = 0;

    for (let i = 0; i < ranked.length; i += 1) {
      if (ranked[i].promotionState === "promotion_ready") promotionReady += 1;
      else if (ranked[i].promotionState === "strong_candidate") strongCandidates += 1;
      else if (ranked[i].promotionState === "review_candidate") reviewCandidates += 1;
      else if (ranked[i].promotionState === "not_ready") notReady += 1;
      else blocked += 1;
    }

    return Object.freeze({
      total,
      promotionReady,
      strongCandidates,
      reviewCandidates,
      notReady,
      blocked,
      readinessRate: roundRate((promotionReady + strongCandidates) / total),
      blockedRate: roundRate(blocked / total),
    });
  } catch {
    return ZERO_SUMMARY;
  }
}

export function detectPromotionViolations(candidates) {
  try {
    if (!Array.isArray(candidates)) return ZERO_VIOLATIONS;

    const malformedCandidates = [];
    const unsafeRuntimeFlags = [];
    const unsafeReusableCandidates = [];
    const blockedApprovalStates = [];
    const malformedFingerprints = [];
    const malformedSequences = [];
    const malformedConfidence = [];
    const duplicateHeavyCandidates = [];

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const id = candidateLabel(candidate, i);

      if (!isPlainObject(candidate)) {
        malformedCandidates.push(id);
        malformedFingerprints.push(id);
        malformedSequences.push(id);
        malformedConfidence.push(id);
        continue;
      }

      let malformed = false;

      if (candidate.approvedForRuntime === true) unsafeRuntimeFlags.push(id);
      if (candidate.reusable === true) unsafeReusableCandidates.push(id);
      if (isBlockedApprovalState(candidate.approvalState)) blockedApprovalStates.push(id);

      if (!isValidFingerprint(candidate.fingerprint)) {
        malformedFingerprints.push(id);
        malformed = true;
      }
      if (!isValidSequence(candidate.sequence)) {
        malformedSequences.push(id);
        malformed = true;
      }
      if (!isValidConfidence(candidate.confidence)) {
        malformedConfidence.push(id);
        malformed = true;
      }
      if (hasHeavyDuplication(candidate.sequence)) duplicateHeavyCandidates.push(id);
      if (malformed) malformedCandidates.push(id);
    }

    const sortedMalformedCandidates = Object.freeze(malformedCandidates.slice().sort());
    const sortedUnsafeRuntimeFlags = Object.freeze(unsafeRuntimeFlags.slice().sort());
    const sortedUnsafeReusableCandidates = Object.freeze(unsafeReusableCandidates.slice().sort());
    const sortedBlockedApprovalStates = Object.freeze(blockedApprovalStates.slice().sort());
    const sortedMalformedFingerprints = Object.freeze(malformedFingerprints.slice().sort());
    const sortedMalformedSequences = Object.freeze(malformedSequences.slice().sort());
    const sortedMalformedConfidence = Object.freeze(malformedConfidence.slice().sort());
    const sortedDuplicateHeavyCandidates = Object.freeze(duplicateHeavyCandidates.slice().sort());

    return Object.freeze({
      malformedCandidates: sortedMalformedCandidates,
      unsafeRuntimeFlags: sortedUnsafeRuntimeFlags,
      unsafeReusableCandidates: sortedUnsafeReusableCandidates,
      blockedApprovalStates: sortedBlockedApprovalStates,
      malformedFingerprints: sortedMalformedFingerprints,
      malformedSequences: sortedMalformedSequences,
      malformedConfidence: sortedMalformedConfidence,
      duplicateHeavyCandidates: sortedDuplicateHeavyCandidates,
      totalViolationCount:
        sortedMalformedCandidates.length +
        sortedUnsafeRuntimeFlags.length +
        sortedUnsafeReusableCandidates.length +
        sortedBlockedApprovalStates.length +
        sortedMalformedFingerprints.length +
        sortedMalformedSequences.length +
        sortedMalformedConfidence.length +
        sortedDuplicateHeavyCandidates.length,
    });
  } catch {
    return ZERO_VIOLATIONS;
  }
}
