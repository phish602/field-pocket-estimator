// @ts-nocheck
/* eslint-disable */

// Standalone deterministic policy engine for the Job Learning system.
// No imports. No runtime wiring. No persistence. No side effects.

const MAX_REGISTRY_ENTRIES = 1000;
const MAX_TOKEN_LENGTH     = 80;
const MAX_SEQUENCE_LENGTH  = 100;
const MAX_REGISTRY_ID_LEN  = 120;

// Confidence thresholds.
const CONF_PROMOTE  = 0.9;   // minimum for promote_candidate
const CONF_HIGH     = 0.8;   // high_confidence tier boundary
const CONF_STABLE   = 0.6;   // stable tier boundary
const CONF_EMERGING = 0.4;   // emerging tier boundary

// Minimum total score qualifying as "elite" (mirrors jobLearningScoring TIER_ELITE).
const ELITE_TOTAL_SCORE = 85;

// Adjacent-duplicate collapse ratio above which a sequence is considered heavy.
const HEAVY_COLLAPSE_THRESHOLD = 0.3;

const VALID_TIERS = new Set(["high_confidence", "stable", "emerging", "unstable"]);

// ── Private helpers ───────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Return confidence in [0, 1] or -1 if invalid.
function readConfidence(entry) {
  const c = Number(entry.confidence);
  return Number.isFinite(c) && c >= 0 && c <= 1 ? c : -1;
}

// Return normalized token array or null if sequence is unusable.
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

// True when a valid stored fingerprint is present.
function hasFp(entry) {
  return (
    isPlainObject(entry) &&
    typeof entry.fingerprint === "string" &&
    entry.fingerprint.startsWith("seq_")
  );
}

// Infer the registry tier label a confidence value implies.
function inferRegistryTier(confidence) {
  if (confidence >= CONF_HIGH)    return "high_confidence";
  if (confidence >= CONF_STABLE)  return "stable";
  if (confidence >= CONF_EMERGING) return "emerging";
  return "unstable";
}

// Infer a scoring tier label from confidence (mirrors scoring module).
function inferScoringTier(confidence) {
  if (confidence >= CONF_HIGH)    return "elite";
  if (confidence >= CONF_STABLE)  return "strong";
  if (confidence >= CONF_EMERGING) return "moderate";
  if (confidence > 0)             return "weak";
  return "rejected";
}

// Use the stored scoringTier if present; fall back to confidence inference.
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

// Read the stored registry tier, normalized.
function resolveStoredTier(entry) {
  return isPlainObject(entry) && typeof entry.tier === "string"
    ? entry.tier.trim().toLowerCase()
    : "";
}

// Collapse adjacent identical tokens (single-pass).
function collapseAdjacent(tokens) {
  if (!tokens.length) return tokens;
  const out = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] !== tokens[i - 1]) out.push(tokens[i]);
  }
  return out;
}

// True when adjacent-duplicate collapse removes >= threshold of tokens.
function isHeavyDuplicate(tokens) {
  if (!tokens || tokens.length === 0) return false;
  const collapsed = collapseAdjacent(tokens);
  return (tokens.length - collapsed.length) / tokens.length >= HEAVY_COLLAPSE_THRESHOLD;
}

// True when the stored tier does not match what the confidence implies.
function tierMismatch(storedTier, confidence) {
  if (!storedTier || confidence < 0) return false;
  return storedTier !== inferRegistryTier(confidence);
}

// True when the stored total score (if present) or inferred scoring tier meets elite.
function meetsEliteCriteria(entry, confidence) {
  const stored = typeof entry.totalScore === "number" ? entry.totalScore : -1;
  if (stored >= ELITE_TOTAL_SCORE) return true;
  return resolveScoringTier(entry, confidence) === "elite";
}

// Safe label for violation arrays.
function entryLabel(entry, index) {
  if (isPlainObject(entry) && typeof entry.registryId === "string" && entry.registryId.trim()) {
    return entry.registryId.trim().slice(0, MAX_REGISTRY_ID_LEN);
  }
  return "(index " + index + ")";
}

// ── Public: evaluateLearningPolicy ────────────────────────────────────────────

/**
 * Evaluate a single registry entry against all fixed safety and promotion policies.
 * allowed is true ONLY when decision is "review" or "promote_candidate".
 * Decision order: reject (blocked) → quarantine (restricted) → promote_candidate (candidate) → review (review_required).
 * Pure, deterministic, never throws. No side effects. Never sets runtime flags to true.
 */
export function evaluateLearningPolicy(entry) {
  const FAIL = (rejectionReason) => Object.freeze({
    allowed:         false,
    decision:        "reject",
    policyLevel:     "blocked",
    reasons:         Object.freeze([]),
    restrictions:    Object.freeze([]),
    rejectionReason,
  });

  try {
    // ── Phase 1: Reject / Blocked ────────────────────────────────────────────
    if (!isPlainObject(entry))             return FAIL("malformed_entry");

    const confidence = readConfidence(entry);
    if (confidence < 0)                   return FAIL("invalid_confidence");

    const tokens = readTokens(entry);
    if (!tokens)                          return FAIL("empty_or_invalid_sequence");

    if (entry.approvedForRuntime === true) return FAIL("approved_for_runtime_flag_set");

    const storedTier = resolveStoredTier(entry);
    if (entry.reusable === true && storedTier !== "high_confidence") return FAIL("reusable_flag_unsafe");

    // ── Phase 2: Quarantine / Restricted ────────────────────────────────────
    const restrictions = [];

    if (storedTier === "unstable" || storedTier === "emerging") {
      restrictions.push("tier_below_promotion_threshold");
    }
    if (!tokens.some((t) => t.endsWith("_save"))) {
      restrictions.push("missing_save_signal");
    }
    if (!hasFp(entry)) {
      restrictions.push("missing_stored_fingerprint");
    }
    if (tierMismatch(storedTier, confidence)) {
      restrictions.push("tier_confidence_mismatch");
    }
    if (isHeavyDuplicate(tokens)) {
      restrictions.push("duplicate_heavy_sequence");
    }

    if (restrictions.length > 0) {
      return Object.freeze({
        allowed:         false,
        decision:        "quarantine",
        policyLevel:     "restricted",
        reasons:         Object.freeze([]),
        restrictions:    Object.freeze(restrictions.sort()),
        rejectionReason: null,
      });
    }

    // Phase 2 passed: storedTier is stable or high_confidence; entry has save signal,
    // stored fingerprint, no tier mismatch, no heavy duplicates.

    // ── Phase 3: Promote Candidate ───────────────────────────────────────────
    if (
      storedTier === "high_confidence" &&
      confidence >= CONF_PROMOTE &&
      meetsEliteCriteria(entry, confidence) &&
      entry.reusable !== true &&
      entry.approvedForRuntime !== true
    ) {
      return Object.freeze({
        allowed:         true,
        decision:        "promote_candidate",
        policyLevel:     "candidate",
        reasons:         Object.freeze([
          "high_confidence_tier",
          "confidence_threshold_met",
          "save_signal_confirmed",
          "fingerprint_indexed",
          "elite_scoring_tier",
        ]),
        restrictions:    Object.freeze([]),
        rejectionReason: null,
      });
    }

    // ── Phase 4: Review Required ─────────────────────────────────────────────
    if (
      (storedTier === "stable" || storedTier === "high_confidence") &&
      entry.reusable !== true &&
      entry.approvedForRuntime !== true
    ) {
      return Object.freeze({
        allowed:         true,
        decision:        "review",
        policyLevel:     "review_required",
        reasons:         Object.freeze([
          "valid_tier",
          "save_signal_confirmed",
          "governance_flags_clear",
        ]),
        restrictions:    Object.freeze([]),
        rejectionReason: null,
      });
    }

    // ── Fallback: Quarantine ─────────────────────────────────────────────────
    // Reached when the entry is structurally valid but does not satisfy the
    // review_required conditions (e.g., governance flag blocks despite valid tier).
    const fallback = [];
    if (entry.reusable === true)                                     fallback.push("reusable_flag_prevents_review");
    if (storedTier !== "stable" && storedTier !== "high_confidence") fallback.push("tier_below_review_threshold");

    return Object.freeze({
      allowed:         false,
      decision:        "quarantine",
      policyLevel:     "restricted",
      reasons:         Object.freeze([]),
      restrictions:    Object.freeze(fallback.length ? fallback.sort() : ["policy_requirements_not_met"]),
      rejectionReason: null,
    });
  } catch {
    return FAIL("policy_evaluation_error");
  }
}

// ── Public: deriveLearningPolicyRisk ─────────────────────────────────────────

/**
 * Classify the policy risk of a single raw registry entry.
 * Highest applicable level wins. Pure, deterministic, never throws.
 */
export function deriveLearningPolicyRisk(entry) {
  try {
    // ── Critical ─────────────────────────────────────────────────────────────
    if (!isPlainObject(entry))             return "critical";
    if (entry.approvedForRuntime === true) return "critical";

    const confidence = readConfidence(entry);
    if (confidence < 0) return "critical";

    const storedTier = resolveStoredTier(entry);
    if (entry.reusable === true && storedTier !== "high_confidence") return "critical";

    // ── High ─────────────────────────────────────────────────────────────────
    if (storedTier === "unstable" || storedTier === "emerging") return "high";

    const tokens = readTokens(entry);
    if (!tokens || !tokens.some((t) => t.endsWith("_save")))   return "high";
    if (!hasFp(entry))                                          return "high";

    // ── Moderate ─────────────────────────────────────────────────────────────
    if (tierMismatch(storedTier, confidence))   return "moderate";
    if (isHeavyDuplicate(tokens))               return "moderate";

    const scoringTier = resolveScoringTier(entry, confidence);
    if (scoringTier === "weak" || scoringTier === "rejected" || scoringTier === "moderate") {
      return "moderate";
    }

    // ── Low ──────────────────────────────────────────────────────────────────
    return "low";
  } catch {
    return "critical";
  }
}

// ── Public: summarizeLearningPolicyHealth ─────────────────────────────────────

/**
 * Aggregate policy evaluation outcomes across a registry.
 * All rates are bounded to [0, 1] and rounded to 3 decimal places.
 * Pure, deterministic, never throws. No side effects.
 */
export function summarizeLearningPolicyHealth(registry) {
  const EMPTY = Object.freeze({
    totalEntries:         0,
    rejectedCount:        0,
    quarantinedCount:     0,
    reviewRequiredCount:  0,
    promoteCandidateCount: 0,
    blockedRate:          0,
    candidateRate:        0,
    allowedRate:          0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    let rejectedCount        = 0;
    let quarantinedCount     = 0;
    let reviewRequiredCount  = 0;
    let promoteCandidateCount = 0;

    for (let i = 0; i < list.length; i++) {
      const result = evaluateLearningPolicy(list[i]);
      if (result.decision === "reject")            rejectedCount++;
      else if (result.decision === "quarantine")   quarantinedCount++;
      else if (result.decision === "review")       reviewRequiredCount++;
      else if (result.decision === "promote_candidate") promoteCandidateCount++;
    }

    const totalEntries = rejectedCount + quarantinedCount + reviewRequiredCount + promoteCandidateCount;
    const round3 = (v) => Math.round(v * 1000) / 1000;

    const blockedRate   = totalEntries > 0 ? round3((rejectedCount + quarantinedCount) / totalEntries)              : 0;
    const candidateRate = totalEntries > 0 ? round3(promoteCandidateCount / totalEntries)                           : 0;
    const allowedRate   = totalEntries > 0 ? round3((reviewRequiredCount + promoteCandidateCount) / totalEntries)   : 0;

    return Object.freeze({
      totalEntries,
      rejectedCount,
      quarantinedCount,
      reviewRequiredCount,
      promoteCandidateCount,
      blockedRate,
      candidateRate,
      allowedRate,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: detectLearningPolicyViolations ────────────────────────────────────

/**
 * Scan a registry for entries that violate learning policy preconditions.
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectLearningPolicyViolations(registry) {
  const EMPTY = Object.freeze({
    malformedEntries:          Object.freeze([]),
    runtimeApprovedEntries:    Object.freeze([]),
    unsafeReusableEntries:     Object.freeze([]),
    invalidConfidenceEntries:  Object.freeze([]),
    saveMissingEntries:        Object.freeze([]),
    missingFingerprintEntries: Object.freeze([]),
    scoreTierMismatchEntries:  Object.freeze([]),
    totalViolationCount:       0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const malformedEntries         = [];
    const runtimeApprovedEntries   = [];
    const unsafeReusableEntries    = [];
    const invalidConfidenceEntries = [];
    const saveMissingEntries       = [];
    const missingFingerprintEntries = [];
    const scoreTierMismatchEntries  = [];

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const id  = entryLabel(raw, i);

      if (!isPlainObject(raw)) {
        malformedEntries.push(id);
        continue;
      }

      // Structural validity.
      const hasValidId  = typeof raw.registryId === "string" && raw.registryId.trim().length > 0;
      const hasValidSeq = Array.isArray(raw.sequence) && raw.sequence.length > 0;
      const hasValidTier = typeof raw.tier === "string" && VALID_TIERS.has(raw.tier.trim().toLowerCase());
      if (!hasValidId || !hasValidSeq || !hasValidTier) {
        malformedEntries.push(id);
      }

      // Governance flag violations.
      if (raw.approvedForRuntime === true) runtimeApprovedEntries.push(id);

      const tier = typeof raw.tier === "string" ? raw.tier.trim().toLowerCase() : "";
      if (raw.reusable === true && tier !== "high_confidence") unsafeReusableEntries.push(id);

      // Confidence.
      const confidence = readConfidence(raw);
      if (confidence < 0) {
        invalidConfidenceEntries.push(id);
      }

      // Save signal.
      const tokens = readTokens(raw);
      if (!tokens || !tokens.some((t) => t.endsWith("_save"))) {
        saveMissingEntries.push(id);
      }

      // Stored fingerprint.
      if (!hasFp(raw)) {
        missingFingerprintEntries.push(id);
      }

      // Tier / confidence mismatch.
      if (confidence >= 0 && tier && tierMismatch(tier, confidence)) {
        scoreTierMismatchEntries.push(id);
      }
    }

    const totalViolationCount =
      malformedEntries.length
      + runtimeApprovedEntries.length
      + unsafeReusableEntries.length
      + invalidConfidenceEntries.length
      + saveMissingEntries.length
      + missingFingerprintEntries.length
      + scoreTierMismatchEntries.length;

    return Object.freeze({
      malformedEntries:          Object.freeze(malformedEntries.sort()),
      runtimeApprovedEntries:    Object.freeze(runtimeApprovedEntries.sort()),
      unsafeReusableEntries:     Object.freeze(unsafeReusableEntries.sort()),
      invalidConfidenceEntries:  Object.freeze(invalidConfidenceEntries.sort()),
      saveMissingEntries:        Object.freeze(saveMissingEntries.sort()),
      missingFingerprintEntries: Object.freeze(missingFingerprintEntries.sort()),
      scoreTierMismatchEntries:  Object.freeze(scoreTierMismatchEntries.sort()),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
