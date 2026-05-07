// @ts-nocheck
/* eslint-disable */

const MAX_REGISTRY_ENTRIES = 1000;
const MAX_SEQUENCE_LENGTH = 6;

// Tier thresholds must mirror jobPatternRegistry.classifyPatternTier exactly.
const CONFIDENCE_HIGH_CONFIDENCE = 0.8;
const CONFIDENCE_STABLE          = 0.6;
const CONFIDENCE_EMERGING        = 0.4;

const TIER_HIGH_CONFIDENCE = "high_confidence";
const TIER_STABLE          = "stable";
const TIER_EMERGING        = "emerging";
const TIER_UNSTABLE        = "unstable";

// Strict tier ordering used in promotion/risk comparisons.
const TIER_ORDER = {
  [TIER_UNSTABLE]:        0,
  [TIER_EMERGING]:        1,
  [TIER_STABLE]:          2,
  [TIER_HIGH_CONFIDENCE]: 3,
};
const VALID_TIERS = new Set([TIER_HIGH_CONFIDENCE, TIER_STABLE, TIER_EMERGING, TIER_UNSTABLE]);

const RISK_LOW      = "low";
const RISK_MODERATE = "moderate";
const RISK_HIGH     = "high";
const RISK_CRITICAL = "critical";

// ── Private helpers ───────────────────────────────────────────────────────────

function safeString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function roundMetric(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.round(next * 1000) / 1000;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

// Normalize a sequence array into clean string tokens, bounded by MAX_SEQUENCE_LENGTH.
function normalizeSequence(sequence) {
  if (!Array.isArray(sequence)) return [];
  return sequence
    .map((item) => safeString(item))
    .filter(Boolean)
    .slice(0, MAX_SEQUENCE_LENGTH);
}

// Validate the basic structural shape of a registry entry.
// Returns { valid, faults } where faults is an array of string labels.
function inspectEntryShape(entry) {
  const faults = [];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return { valid: false, faults: ["not_an_object"] };
  }

  const confidence = safeNumber(entry.confidence, -1);
  const tier       = safeString(entry.tier);
  const sequence   = normalizeSequence(entry.sequence);

  if (!safeString(entry.registryId)) faults.push("missing_registry_id");
  if (!sequence.length)              faults.push("empty_sequence");
  if (!(confidence >= 0 && confidence <= 1)) faults.push("invalid_confidence_range");
  if (!VALID_TIERS.has(tier))        faults.push("invalid_tier");

  // Governance invariant: these flags must never be true in a healthy registry.
  if (entry.reusable === true)            faults.push("reusable_flag_set");
  if (entry.approvedForRuntime === true)  faults.push("approved_for_runtime_flag_set");

  return { valid: faults.length === 0, faults };
}

// Derive the tier that the confidence value implies, independently of the stored tier field.
// Used to detect tier/confidence mismatches.
function inferTierFromConfidence(confidence) {
  const c = clamp(safeNumber(confidence, 0));
  if (c >= CONFIDENCE_HIGH_CONFIDENCE) return TIER_HIGH_CONFIDENCE;
  if (c >= CONFIDENCE_STABLE)          return TIER_STABLE;
  if (c >= CONFIDENCE_EMERGING)        return TIER_EMERGING;
  return TIER_UNSTABLE;
}

// True when the stored tier field and confidence value are inconsistent.
function hasTierConfidenceMismatch(entry) {
  const storedTier   = safeString(entry?.tier);
  const inferredTier = inferTierFromConfidence(entry?.confidence);
  return VALID_TIERS.has(storedTier) && storedTier !== inferredTier;
}

// True when no token in the sequence ends with "_save", meaning the workflow
// never reached a documented save step.
function sequenceLacksSave(sequence) {
  return !sequence.some((token) => token.endsWith("_save"));
}

// Normalize an entry for safe internal use without mutating the caller's object.
function normalizeEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const sequence = normalizeSequence(entry.sequence);
  if (!sequence.length && !safeString(entry.registryId)) return null;
  return {
    registryId:        safeString(entry.registryId, "unknown"),
    tier:              safeString(entry.tier, TIER_UNSTABLE),
    confidence:        roundMetric(clamp(safeNumber(entry.confidence, 0))),
    frequency:         Math.max(0, Math.floor(safeNumber(entry.frequency, 0))),
    reusable:          entry.reusable === true,
    approvedForRuntime: entry.approvedForRuntime === true,
    sequence,
  };
}

// ── Public: evaluateRegistryPromotionEligibility ──────────────────────────────

/**
 * Determine whether a registry entry is theoretically eligible for future runtime review.
 *
 * This function is ADVISORY ONLY. A true result does not promote the entry,
 * enable reuse, or modify any estimator behavior. It records whether the entry
 * meets the minimum bar for a human governance review.
 *
 * Pure, deterministic, never throws. No side effects.
 */
export function evaluateRegistryPromotionEligibility(entry) {
  const INELIGIBLE = (reason, tier = TIER_UNSTABLE, confidence = 0) => ({
    eligible: false,
    reason,
    tier,
    confidence: roundMetric(clamp(safeNumber(confidence, 0))),
  });

  try {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return INELIGIBLE("malformed_entry");
    }

    const normalized = normalizeEntry(entry);
    if (!normalized) return INELIGIBLE("malformed_entry");

    const { tier, confidence, sequence, reusable, approvedForRuntime } = normalized;

    // Governance invariant violations block eligibility immediately.
    // These flags must always be false; if set, treat as a policy breach.
    if (approvedForRuntime) {
      return INELIGIBLE("already_approved_for_runtime", tier, confidence);
    }
    if (reusable) {
      return INELIGIBLE("already_reusable", tier, confidence);
    }

    // Structural requirements.
    const { faults } = inspectEntryShape(entry);
    const structuralFaults = faults.filter(
      (f) => f !== "reusable_flag_set" && f !== "approved_for_runtime_flag_set"
    );
    if (structuralFaults.includes("empty_sequence")) {
      return INELIGIBLE("empty_sequence", tier, confidence);
    }
    if (structuralFaults.includes("invalid_confidence_range")) {
      return INELIGIBLE("invalid_confidence_range", tier, confidence);
    }
    if (structuralFaults.includes("invalid_tier")) {
      return INELIGIBLE("invalid_tier", tier, confidence);
    }

    // Only high_confidence tier entries reach the eligibility threshold.
    if (tier !== TIER_HIGH_CONFIDENCE) {
      return INELIGIBLE("tier_below_high_confidence", tier, confidence);
    }

    // Confidence must genuinely exceed the high_confidence boundary,
    // not merely claim the tier label from a stale or mismatched entry.
    if (confidence < CONFIDENCE_HIGH_CONFIDENCE) {
      return INELIGIBLE("confidence_below_high_confidence_threshold", tier, confidence);
    }

    return {
      eligible: true,
      reason: "eligible_for_review",
      tier,
      confidence,
    };
  } catch {
    return INELIGIBLE("evaluation_error");
  }
}

// ── Public: deriveGovernanceRisk ─────────────────────────────────────────────

/**
 * Derive the governance risk level for a single registry entry.
 *
 * Risk levels (highest wins):
 *   critical — entry has governance-violating flags or is completely malformed
 *   high     — entry is structurally invalid or dangerously low confidence
 *   moderate — entry has known weak signals that require monitoring
 *   low      — entry is clean and well-formed
 *
 * Pure, deterministic, never throws. No side effects.
 */
export function deriveGovernanceRisk(entry) {
  try {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return RISK_CRITICAL;

    const normalized = normalizeEntry(entry);
    if (!normalized) return RISK_CRITICAL;

    const { tier, confidence, sequence, reusable, approvedForRuntime } = normalized;

    // ── Critical risk ────────────────────────────────────────────────────────
    // Any runtime-approval flag set is an immediate governance violation
    // regardless of tier, because these flags must always be false.
    if (reusable && approvedForRuntime)   return RISK_CRITICAL;
    if (approvedForRuntime)               return RISK_CRITICAL;

    // Structural failures that make the entry uninterpretable are critical.
    const { faults } = inspectEntryShape(entry);
    const hasInvalidConfidence = faults.includes("invalid_confidence_range");
    const hasInvalidTier       = faults.includes("invalid_tier");
    if (hasInvalidConfidence && hasInvalidTier) return RISK_CRITICAL;

    // ── High risk ────────────────────────────────────────────────────────────
    // reusable flag set (governance violation — should always be false).
    if (reusable) return RISK_HIGH;

    // Unstable tier indicates the pattern has not demonstrated sufficient stability.
    if (tier === TIER_UNSTABLE) return RISK_HIGH;

    // Invalid confidence or tier alone still blocks meaningful governance.
    if (hasInvalidConfidence) return RISK_HIGH;
    if (hasInvalidTier)       return RISK_HIGH;

    // Empty sequence: no workflow structure to evaluate.
    if (!sequence.length) return RISK_HIGH;

    // ── Moderate risk ────────────────────────────────────────────────────────
    // Emerging tier: pattern has some signal but not enough to trust.
    if (tier === TIER_EMERGING) return RISK_MODERATE;

    // Tier/confidence mismatch: the stored tier label disagrees with what
    // the confidence value implies. This suggests a stale or corrupted entry.
    if (hasTierConfidenceMismatch(entry)) return RISK_MODERATE;

    // Stable tier with no save token: the workflow was never confirmed by a save.
    // Sequence may represent an incomplete or abandoned flow.
    if (tier === TIER_STABLE && sequenceLacksSave(sequence)) return RISK_MODERATE;

    // ── Low risk ─────────────────────────────────────────────────────────────
    return RISK_LOW;
  } catch {
    return RISK_CRITICAL;
  }
}

// ── Public: summarizeGovernanceHealth ────────────────────────────────────────

/**
 * Summarize the overall governance health across a registry.
 * Input: array of registry entry objects.
 * Output: aggregated eligibility counts and risk distribution.
 * Pure, deterministic, never throws. No side effects.
 */
export function summarizeGovernanceHealth(registry) {
  const EMPTY = {
    totalEntries: 0,
    eligibleCandidateCount: 0,
    quarantinedCount: 0,
    rejectedCount: 0,
    riskCounts: {
      [RISK_LOW]:      0,
      [RISK_MODERATE]: 0,
      [RISK_HIGH]:     0,
      [RISK_CRITICAL]: 0,
    },
    stableEligibilityRate: 0,
    highConfidenceEligibilityRate: 0,
  };

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    let eligibleCandidateCount    = 0;
    let quarantinedCount          = 0;
    let rejectedCount             = 0;
    let stableEntries             = 0;
    let highConfidenceEntries     = 0;
    let stableEligibleCount       = 0;
    let highConfidenceEligible    = 0;

    const riskCounts = {
      [RISK_LOW]:      0,
      [RISK_MODERATE]: 0,
      [RISK_HIGH]:     0,
      [RISK_CRITICAL]: 0,
    };

    for (const rawEntry of list) {
      const eligibility = evaluateRegistryPromotionEligibility(rawEntry);
      const risk        = deriveGovernanceRisk(rawEntry);

      riskCounts[risk] = (riskCounts[risk] || 0) + 1;

      if (eligibility.eligible) {
        eligibleCandidateCount += 1;
      }

      const normalized = normalizeEntry(rawEntry);
      if (!normalized) {
        rejectedCount += 1;
        continue;
      }

      const { tier } = normalized;

      // Quarantined: unstable or emerging, not eligible, no governance flags set.
      const isViolating = normalized.reusable || normalized.approvedForRuntime;
      if (!eligibility.eligible && !isViolating && (tier === TIER_UNSTABLE || tier === TIER_EMERGING)) {
        quarantinedCount += 1;
      }

      // Rejected: structural failure or governance violation.
      if (isViolating || !safeString(normalized.registryId) || !normalized.sequence.length) {
        rejectedCount += 1;
      }

      // Eligibility rate denominators.
      if (tier === TIER_STABLE) {
        stableEntries += 1;
        if (eligibility.eligible) stableEligibleCount += 1;
      }
      if (tier === TIER_HIGH_CONFIDENCE) {
        highConfidenceEntries += 1;
        if (eligibility.eligible) highConfidenceEligible += 1;
      }
    }

    const stableEligibilityRate = stableEntries > 0
      ? roundMetric(clamp(stableEligibleCount / stableEntries))
      : 0;
    const highConfidenceEligibilityRate = highConfidenceEntries > 0
      ? roundMetric(clamp(highConfidenceEligible / highConfidenceEntries))
      : 0;

    return {
      totalEntries: list.length,
      eligibleCandidateCount,
      quarantinedCount,
      rejectedCount,
      riskCounts,
      stableEligibilityRate,
      highConfidenceEligibilityRate,
    };
  } catch {
    return EMPTY;
  }
}

// ── Public: detectGovernanceViolations ───────────────────────────────────────

/**
 * Scan a registry for entries that violate governance invariants.
 *
 * This module enforces that reusable and approvedForRuntime ALWAYS remain false.
 * Any entry that has either flag set is an anomaly that must be surfaced.
 *
 * Also flags: unstable/emerging tier mismatches, tier/confidence inconsistencies,
 * and malformed entry structure.
 *
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectGovernanceViolations(registry) {
  const EMPTY = {
    reusableEntries: [],
    approvedForRuntimeEntries: [],
    unstableReusableCandidates: [],
    runtimeApprovedUnstableCandidates: [],
    invalidTierConfidenceCombinations: [],
    malformedRegistryEntries: [],
    totalViolationCount: 0,
  };

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const reusableEntries                    = [];
    const approvedForRuntimeEntries          = [];
    const unstableReusableCandidates         = [];
    const runtimeApprovedUnstableCandidates  = [];
    const invalidTierConfidenceCombinations  = [];
    const malformedRegistryEntries           = [];

    for (const rawEntry of list) {
      // Malformed: anything that cannot be normalized into a usable entry shape.
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) {
        malformedRegistryEntries.push("(non-object entry)");
        continue;
      }

      const { faults } = inspectEntryShape(rawEntry);
      const id = safeString(rawEntry.registryId, "(missing id)");

      // Structural faults that are not governance-flag faults = malformed.
      const structuralFaults = faults.filter(
        (f) => f !== "reusable_flag_set" && f !== "approved_for_runtime_flag_set"
      );
      if (structuralFaults.length) {
        malformedRegistryEntries.push(id);
      }

      const tier              = safeString(rawEntry.tier, TIER_UNSTABLE);
      const reusable          = rawEntry.reusable === true;
      const approvedForRuntime = rawEntry.approvedForRuntime === true;

      // Governance flag violations — these must NEVER be true.
      if (reusable) {
        reusableEntries.push(id);
      }
      if (approvedForRuntime) {
        approvedForRuntimeEntries.push(id);
      }

      // Compound violations.
      if (reusable && (tier === TIER_UNSTABLE || tier === TIER_EMERGING)) {
        unstableReusableCandidates.push(id);
      }
      if (approvedForRuntime && (tier === TIER_UNSTABLE || tier === TIER_EMERGING)) {
        runtimeApprovedUnstableCandidates.push(id);
      }

      // Tier/confidence mismatch: stored tier label does not match what
      // the confidence value implies according to established thresholds.
      if (VALID_TIERS.has(tier) && hasTierConfidenceMismatch(rawEntry)) {
        invalidTierConfidenceCombinations.push(id);
      }
    }

    const totalViolationCount =
      reusableEntries.length
      + approvedForRuntimeEntries.length
      + unstableReusableCandidates.length
      + runtimeApprovedUnstableCandidates.length
      + invalidTierConfidenceCombinations.length
      + malformedRegistryEntries.length;

    return {
      reusableEntries:                   reusableEntries.sort(),
      approvedForRuntimeEntries:         approvedForRuntimeEntries.sort(),
      unstableReusableCandidates:        unstableReusableCandidates.sort(),
      runtimeApprovedUnstableCandidates: runtimeApprovedUnstableCandidates.sort(),
      invalidTierConfidenceCombinations: invalidTierConfidenceCombinations.sort(),
      malformedRegistryEntries:          malformedRegistryEntries.sort(),
      totalViolationCount,
    };
  } catch {
    return EMPTY;
  }
}
