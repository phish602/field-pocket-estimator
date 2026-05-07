// @ts-nocheck
/* eslint-disable */

// Standalone deterministic approval workflow utility for the Job Learning system.
// No imports. No runtime wiring. No persistence. No side effects.

const MAX_CANDIDATES      = 1000;
const MAX_TOKEN_LENGTH    = 80;
const MAX_SEQUENCE_LENGTH = 100;
const MAX_REGISTRY_ID_LEN = 120;

// Confidence thresholds.
const CONF_PROMOTE  = 0.9;
const CONF_HIGH     = 0.8;
const CONF_STABLE   = 0.6;
const CONF_EMERGING = 0.4;

// Elite score threshold (mirrors jobLearningScoring TIER_ELITE).
const ELITE_TOTAL_SCORE = 85;

// Adjacent-duplicate collapse ratio for heavy-sequence detection.
const HEAVY_COLLAPSE_THRESHOLD = 0.3;

// All valid approval states (order is significant for blocked-transition computation).
const ALL_APPROVAL_STATES = Object.freeze([
  "rejected",
  "quarantined",
  "needs_review",
  "review_ready",
  "approved_candidate",
  "runtime_blocked",
]);

const VALID_APPROVAL_STATES = new Set(ALL_APPROVAL_STATES);

// Deterministic forward-transition map — static, no randomness.
const ALLOWED_TRANSITIONS = Object.freeze({
  rejected:           Object.freeze([]),
  quarantined:        Object.freeze(["needs_review"]),
  needs_review:       Object.freeze(["review_ready", "quarantined"]),
  review_ready:       Object.freeze(["approved_candidate", "needs_review"]),
  approved_candidate: Object.freeze([]),
  runtime_blocked:    Object.freeze([]),
});

// ── Private helpers ───────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function readConfidence(entry) {
  const c = Number(entry.confidence);
  return Number.isFinite(c) && c >= 0 && c <= 1 ? c : -1;
}

function readTokens(entry) {
  if (!isPlainObject(entry) || !Array.isArray(entry.sequence)) return null;
  if (entry.sequence.length === 0 || entry.sequence.length > MAX_SEQUENCE_LENGTH) return null;
  const out = [];
  for (let i = 0; i < entry.sequence.length; i++) {
    if (typeof entry.sequence[i] !== "string") return null;
    const t = entry.sequence[i].trim().toLowerCase();
    if (!t || t.length > MAX_TOKEN_LENGTH) return null;
    out.push(t);
  }
  return out.length ? out : null;
}

function hasFp(entry) {
  return (
    isPlainObject(entry) &&
    typeof entry.fingerprint === "string" &&
    entry.fingerprint.startsWith("seq_")
  );
}

function inferRegistryTier(confidence) {
  if (confidence >= CONF_HIGH)     return "high_confidence";
  if (confidence >= CONF_STABLE)   return "stable";
  if (confidence >= CONF_EMERGING) return "emerging";
  return "unstable";
}

function inferScoringTier(confidence) {
  if (confidence >= CONF_HIGH)     return "elite";
  if (confidence >= CONF_STABLE)   return "strong";
  if (confidence >= CONF_EMERGING) return "moderate";
  if (confidence > 0)              return "weak";
  return "rejected";
}

function resolveScoringTier(entry, confidence) {
  if (
    isPlainObject(entry) &&
    typeof entry.scoringTier === "string" &&
    entry.scoringTier.trim()
  ) {
    return entry.scoringTier.trim();
  }
  return confidence >= 0 ? inferScoringTier(confidence) : "rejected";
}

function resolveStoredTier(entry) {
  return isPlainObject(entry) && typeof entry.tier === "string"
    ? entry.tier.trim().toLowerCase()
    : "";
}

function collapseAdjacent(tokens) {
  if (!tokens.length) return tokens;
  const out = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] !== tokens[i - 1]) out.push(tokens[i]);
  }
  return out;
}

function isHeavyDuplicate(tokens) {
  if (!tokens || tokens.length === 0) return false;
  const collapsed = collapseAdjacent(tokens);
  return (tokens.length - collapsed.length) / tokens.length >= HEAVY_COLLAPSE_THRESHOLD;
}

function tierMismatch(storedTier, confidence) {
  if (!storedTier || confidence < 0) return false;
  return storedTier !== inferRegistryTier(confidence);
}

function meetsEliteCriteria(entry, confidence) {
  const stored = typeof entry.totalScore === "number" ? entry.totalScore : -1;
  if (stored >= ELITE_TOTAL_SCORE) return true;
  return resolveScoringTier(entry, confidence) === "elite";
}

// Inline policy decision — mirrors jobLearningPolicyEngine without importing it.
// Returns: "reject" | "quarantine" | "review" | "promote_candidate"
function deriveInlinePolicyDecision(candidate) {
  if (!isPlainObject(candidate)) return "reject";
  const confidence = readConfidence(candidate);
  if (confidence < 0) return "reject";
  const tokens = readTokens(candidate);
  if (!tokens) return "reject";
  if (candidate.approvedForRuntime === true) return "reject";
  const tier = resolveStoredTier(candidate);
  if (candidate.reusable === true && tier !== "high_confidence") return "reject";

  // Quarantine conditions.
  if (tier === "unstable" || tier === "emerging") return "quarantine";
  if (!tokens.some((t) => t.endsWith("_save")))  return "quarantine";
  if (!hasFp(candidate))                          return "quarantine";
  if (tierMismatch(tier, confidence))             return "quarantine";
  if (isHeavyDuplicate(tokens))                   return "quarantine";

  // Promote candidate.
  if (
    tier === "high_confidence" &&
    confidence >= CONF_PROMOTE &&
    meetsEliteCriteria(candidate, confidence) &&
    candidate.reusable !== true &&
    candidate.approvedForRuntime !== true
  ) return "promote_candidate";

  // Review.
  if (
    (tier === "stable" || tier === "high_confidence") &&
    candidate.reusable !== true &&
    candidate.approvedForRuntime !== true
  ) return "review";

  return "quarantine"; // fallback
}

// Map a policy decision to an approval state.
// "review" splits into needs_review (stable) or review_ready (high_confidence).
function policyDecisionToState(policyDecision, tier) {
  if (policyDecision === "reject")            return "rejected";
  if (policyDecision === "quarantine")        return "quarantined";
  if (policyDecision === "promote_candidate") return "approved_candidate";
  if (policyDecision === "review") {
    return tier === "high_confidence" ? "review_ready" : "needs_review";
  }
  return "rejected";
}

// Compute blocked transitions: all states except the current state and allowed transitions.
function computeBlockedTransitions(state, allowed) {
  const allowedSet = new Set(allowed);
  return Object.freeze(ALL_APPROVAL_STATES.filter((s) => s !== state && !allowedSet.has(s)));
}

// Build the reasons array for a given approval state.
function buildStateReasons(state, candidate, tokens, confidence, tier) {
  const reasons = [];
  switch (state) {
    case "rejected":
      if (!isPlainObject(candidate))         reasons.push("malformed_candidate");
      else if (readConfidence(candidate) < 0) reasons.push("invalid_confidence");
      else if (!readTokens(candidate))        reasons.push("invalid_or_empty_sequence");
      else                                   reasons.push("policy_rejected");
      break;
    case "quarantined":
      if (tier === "unstable" || tier === "emerging") reasons.push("tier_below_promotion_threshold");
      if (tokens && !tokens.some((t) => t.endsWith("_save"))) reasons.push("missing_save_signal");
      if (!hasFp(candidate))                reasons.push("missing_stored_fingerprint");
      if (tierMismatch(tier, confidence))   reasons.push("tier_confidence_mismatch");
      if (tokens && isHeavyDuplicate(tokens)) reasons.push("duplicate_heavy_sequence");
      if (!reasons.length)                  reasons.push("policy_quarantined");
      break;
    case "needs_review":
      reasons.push("manual_review_required_before_advancement");
      reasons.push("stable_tier_pending_formal_review");
      break;
    case "review_ready":
      reasons.push("high_confidence_tier_qualifies_for_formal_review");
      reasons.push("promote_candidate_threshold_not_yet_met");
      break;
    case "approved_candidate":
      reasons.push("all_policy_criteria_met");
      reasons.push("eligible_for_promotion_consideration");
      break;
    case "runtime_blocked":
      if (candidate.approvedForRuntime === true) reasons.push("approved_for_runtime_flag_is_true");
      if (candidate.reusable === true)           reasons.push("reusable_flag_is_true");
      if (!reasons.length)                       reasons.push("runtime_governance_violation");
      break;
    default:
      reasons.push("unknown_approval_state");
  }
  return reasons.sort();
}

// Safe label for violation arrays.
function candidateLabel(candidate, index) {
  if (isPlainObject(candidate) && typeof candidate.registryId === "string" && candidate.registryId.trim()) {
    return candidate.registryId.trim().slice(0, MAX_REGISTRY_ID_LEN);
  }
  return "(index " + index + ")";
}

// ── Public: evaluateApprovalWorkflowState ─────────────────────────────────────

/**
 * Determine the approval workflow state of a candidate and its valid transitions.
 * Priority: malformed → runtime_blocked (flag violations) → inline policy → state.
 * Transitions are deterministic static maps — no randomness, no timestamps.
 * allowed is only true when approvalState is review_ready or approved_candidate.
 * Pure, deterministic, never throws. No side effects.
 */
export function evaluateApprovalWorkflowState(candidate) {
  const FAIL = (rejectionReason) => Object.freeze({
    valid:              false,
    approvalState:      "rejected",
    allowedTransitions: Object.freeze([]),
    blockedTransitions: Object.freeze(ALL_APPROVAL_STATES.filter((s) => s !== "rejected")),
    reasons:            Object.freeze([rejectionReason]),
    rejectionReason,
  });

  try {
    // 1. Malformed check.
    if (!isPlainObject(candidate)) return FAIL("malformed_candidate");

    // 2. approvedForRuntime flag → runtime_blocked (highest-priority flag check).
    if (candidate.approvedForRuntime === true) {
      const state   = "runtime_blocked";
      const allowed = ALLOWED_TRANSITIONS[state];
      return Object.freeze({
        valid:              true,
        approvalState:      state,
        allowedTransitions: allowed,
        blockedTransitions: computeBlockedTransitions(state, allowed),
        reasons:            Object.freeze(["approved_for_runtime_flag_is_true"]),
        rejectionReason:    null,
      });
    }

    // 3. reusable flag → runtime_blocked (cannot reach approved_candidate with this flag set).
    if (candidate.reusable === true) {
      const state   = "runtime_blocked";
      const allowed = ALLOWED_TRANSITIONS[state];
      return Object.freeze({
        valid:              true,
        approvalState:      state,
        allowedTransitions: allowed,
        blockedTransitions: computeBlockedTransitions(state, allowed),
        reasons:            Object.freeze(["reusable_flag_is_true"]),
        rejectionReason:    null,
      });
    }

    // 4. Inline policy evaluation → approval state.
    const confidence     = readConfidence(candidate);
    const tokens         = readTokens(candidate);
    const tier           = resolveStoredTier(candidate);
    const policyDecision = deriveInlinePolicyDecision(candidate);
    const approvalState  = policyDecisionToState(policyDecision, tier);
    const allowed        = ALLOWED_TRANSITIONS[approvalState] || Object.freeze([]);
    const blocked        = computeBlockedTransitions(approvalState, allowed);
    const reasons        = buildStateReasons(approvalState, candidate, tokens, confidence, tier);

    return Object.freeze({
      valid:              true,
      approvalState,
      allowedTransitions: allowed,
      blockedTransitions: blocked,
      reasons:            Object.freeze(reasons),
      rejectionReason:    null,
    });
  } catch {
    return FAIL("workflow_evaluation_error");
  }
}

// ── Public: deriveApprovalWorkflowRisk ───────────────────────────────────────

/**
 * Classify the approval workflow risk of a single candidate.
 * Highest applicable level wins. Pure, deterministic, never throws.
 */
export function deriveApprovalWorkflowRisk(candidate) {
  try {
    // ── Critical ─────────────────────────────────────────────────────────────
    if (!isPlainObject(candidate))             return "critical";
    if (candidate.approvedForRuntime === true) return "critical";

    const tier = resolveStoredTier(candidate);
    if (candidate.reusable === true && tier !== "high_confidence") return "critical";

    const confidence = readConfidence(candidate);
    if (confidence < 0) return "critical";

    // Invalid stored approvalState (if the field exists on the candidate).
    if (
      typeof candidate.approvalState === "string" &&
      candidate.approvalState.trim() &&
      !VALID_APPROVAL_STATES.has(candidate.approvalState.trim())
    ) return "critical";

    // ── High ─────────────────────────────────────────────────────────────────
    const policyDecision = deriveInlinePolicyDecision(candidate);
    if (policyDecision === "reject" || policyDecision === "quarantine") return "high";

    const tokens = readTokens(candidate);
    if (!tokens || !tokens.some((t) => t.endsWith("_save"))) return "high";
    if (!hasFp(candidate)) return "high";

    // ── Moderate ─────────────────────────────────────────────────────────────
    const approvalState = policyDecisionToState(policyDecision, tier);
    if (approvalState === "needs_review")    return "moderate";
    if (tierMismatch(tier, confidence))     return "moderate";

    const scoringTier = resolveScoringTier(candidate, confidence);
    if (
      scoringTier === "weak" ||
      scoringTier === "moderate" ||
      scoringTier === "rejected"
    ) return "moderate";

    // ── Low ──────────────────────────────────────────────────────────────────
    return "low";
  } catch {
    return "critical";
  }
}

// ── Public: summarizeApprovalWorkflowHealth ───────────────────────────────────

/**
 * Aggregate approval workflow state counts across a list of candidates.
 * approvalReadinessRate = (review_ready + approved_candidate) / total.
 * blockedRate = (rejected + quarantined + runtime_blocked) / total.
 * All rates bounded [0, 1] at 3 decimal places. Pure, deterministic, never throws.
 */
export function summarizeApprovalWorkflowHealth(candidates) {
  const EMPTY = Object.freeze({
    totalCandidates:        0,
    rejectedCount:          0,
    quarantinedCount:       0,
    needsReviewCount:       0,
    reviewReadyCount:       0,
    approvedCandidateCount: 0,
    runtimeBlockedCount:    0,
    approvalReadinessRate:  0,
    blockedRate:            0,
  });

  try {
    const list = Array.isArray(candidates)
      ? candidates.slice(0, MAX_CANDIDATES)
      : [];
    if (!list.length) return EMPTY;

    let rejectedCount          = 0;
    let quarantinedCount       = 0;
    let needsReviewCount       = 0;
    let reviewReadyCount       = 0;
    let approvedCandidateCount = 0;
    let runtimeBlockedCount    = 0;

    for (let i = 0; i < list.length; i++) {
      const result = evaluateApprovalWorkflowState(list[i]);
      switch (result.approvalState) {
        case "rejected":           rejectedCount++;          break;
        case "quarantined":        quarantinedCount++;       break;
        case "needs_review":       needsReviewCount++;       break;
        case "review_ready":       reviewReadyCount++;       break;
        case "approved_candidate": approvedCandidateCount++; break;
        case "runtime_blocked":    runtimeBlockedCount++;    break;
        default:                   rejectedCount++;          break;
      }
    }

    const totalCandidates = list.length;
    const round3 = (v) => Math.round(v * 1000) / 1000;

    const approvalReadinessRate = totalCandidates > 0
      ? round3((reviewReadyCount + approvedCandidateCount) / totalCandidates)
      : 0;
    const blockedRate = totalCandidates > 0
      ? round3((rejectedCount + quarantinedCount + runtimeBlockedCount) / totalCandidates)
      : 0;

    return Object.freeze({
      totalCandidates,
      rejectedCount,
      quarantinedCount,
      needsReviewCount,
      reviewReadyCount,
      approvedCandidateCount,
      runtimeBlockedCount,
      approvalReadinessRate,
      blockedRate,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: detectApprovalWorkflowViolations ──────────────────────────────────

/**
 * Scan a list of candidates for approval workflow precondition violations.
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectApprovalWorkflowViolations(candidates) {
  const EMPTY = Object.freeze({
    malformedCandidates:            Object.freeze([]),
    runtimeApprovedCandidates:      Object.freeze([]),
    unsafeReusableCandidates:       Object.freeze([]),
    invalidApprovalStateCandidates: Object.freeze([]),
    missingFingerprintCandidates:   Object.freeze([]),
    saveMissingCandidates:          Object.freeze([]),
    totalViolationCount:            0,
  });

  try {
    const list = Array.isArray(candidates)
      ? candidates.slice(0, MAX_CANDIDATES)
      : [];
    if (!list.length) return EMPTY;

    const malformedCandidates            = [];
    const runtimeApprovedCandidates      = [];
    const unsafeReusableCandidates       = [];
    const invalidApprovalStateCandidates = [];
    const missingFingerprintCandidates   = [];
    const saveMissingCandidates          = [];

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const id  = candidateLabel(raw, i);

      if (!isPlainObject(raw)) {
        malformedCandidates.push(id);
        continue;
      }

      // Structural validity.
      const hasValidId  = typeof raw.registryId === "string" && raw.registryId.trim().length > 0;
      const hasValidSeq = Array.isArray(raw.sequence) && raw.sequence.length > 0;
      if (!hasValidId || !hasValidSeq) {
        malformedCandidates.push(id);
      }

      // Governance flag violations.
      if (raw.approvedForRuntime === true) runtimeApprovedCandidates.push(id);

      const tier = typeof raw.tier === "string" ? raw.tier.trim().toLowerCase() : "";
      if (raw.reusable === true && tier !== "high_confidence") unsafeReusableCandidates.push(id);

      // Invalid stored approvalState (if present).
      if (
        typeof raw.approvalState === "string" &&
        raw.approvalState.trim() &&
        !VALID_APPROVAL_STATES.has(raw.approvalState.trim())
      ) {
        invalidApprovalStateCandidates.push(id);
      }

      // Fingerprint presence.
      if (!hasFp(raw)) missingFingerprintCandidates.push(id);

      // Save signal presence.
      const tokens = readTokens(raw);
      if (!tokens || !tokens.some((t) => t.endsWith("_save"))) saveMissingCandidates.push(id);
    }

    const totalViolationCount =
      malformedCandidates.length
      + runtimeApprovedCandidates.length
      + unsafeReusableCandidates.length
      + invalidApprovalStateCandidates.length
      + missingFingerprintCandidates.length
      + saveMissingCandidates.length;

    return Object.freeze({
      malformedCandidates:            Object.freeze(malformedCandidates.sort()),
      runtimeApprovedCandidates:      Object.freeze(runtimeApprovedCandidates.sort()),
      unsafeReusableCandidates:       Object.freeze(unsafeReusableCandidates.sort()),
      invalidApprovalStateCandidates: Object.freeze(invalidApprovalStateCandidates.sort()),
      missingFingerprintCandidates:   Object.freeze(missingFingerprintCandidates.sort()),
      saveMissingCandidates:          Object.freeze(saveMissingCandidates.sort()),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
