// @ts-nocheck
/* eslint-disable */

// Standalone deterministic explainability utility for the Job Learning system.
// No imports. No runtime wiring. No persistence. No side effects.
// All output strings are static mappings — no AI, no fuzzy generation.

const MAX_FACTORS  = 10;
const MAX_WARNINGS = 10;
const MAX_TOKEN_LENGTH    = 80;
const MAX_SEQUENCE_LENGTH = 100;
const MAX_REGISTRY_ID_LEN = 120;

// Confidence tier thresholds (mirrors other modules).
const CONF_HIGH     = 0.8;
const CONF_STABLE   = 0.6;
const CONF_EMERGING = 0.4;

// Adjacent-duplicate collapse threshold.
const HEAVY_COLLAPSE_THRESHOLD = 0.3;

// ── Static text maps ──────────────────────────────────────────────────────────

const REASON_TEXT = Object.freeze({
  approved_for_runtime_flag_set: "Governance violation: approvedForRuntime flag is set to true.",
  reusable_flag_unsafe_tier:     "Governance violation: reusable flag is set to true but tier is not high_confidence.",
  invalid_confidence:            "Confidence value is invalid or outside the required [0, 1] range.",
  low_confidence:                "Confidence is below the emerging threshold (0.4); pattern has insufficient signal.",
  missing_save_signal:           "No save token found in sequence; workflow end is not confirmed.",
  duplicate_heavy_sequence:      "Sequence contains excessive adjacent duplicate tokens; normalization is required.",
  missing_stored_fingerprint:    "No pre-computed fingerprint is stored; entry lacks deduplication indexing.",
  invalid_sequence:              "Sequence is missing, empty, or contains invalid tokens.",
  unstable_tier:                 "Tier is unstable; pattern does not meet the emerging confidence threshold.",
  emerging_tier:                 "Tier is emerging; pattern is in early accumulation and not yet ready for promotion.",
  high_confidence_candidate:     "Entry meets the high-confidence threshold; all quality checks passed.",
  moderate_confidence_candidate: "Entry meets a moderate confidence level; suitable for further review.",
});

const PRIORITY_TEXT = Object.freeze({
  critical: "Priority CRITICAL — entry has a governance or structural violation and must not advance.",
  high:     "Priority HIGH — entry has a significant quality issue requiring immediate attention.",
  moderate: "Priority MODERATE — entry has recoverable issues warranting manual review.",
  low:      "Priority LOW — entry meets baseline quality standards and is a candidate for evaluation.",
});

const RECOMMENDATION_TEXT = Object.freeze({
  reject:            "Recommendation REJECT — entry has a disqualifying defect and should be removed from the registry.",
  quarantine:        "Recommendation QUARANTINE — entry is blocked from promotion but may be revisited if defects are resolved.",
  review:            "Recommendation REVIEW — entry should be manually inspected before any promotion decision.",
  promote_candidate: "Recommendation PROMOTE CANDIDATE — entry passes all quality checks and is eligible for promotion consideration.",
});

const DRIFT_TEXT = Object.freeze({
  none:     "Drift level NONE — registry content is identical to the previous snapshot.",
  low:      "Drift level LOW — minor changes detected; registry is stable with small additions or adjustments.",
  moderate: "Drift level MODERATE — notable changes detected; registry has shifted meaningfully since the last snapshot.",
  high:     "Drift level HIGH — significant changes detected; a large portion of fingerprints have changed.",
  critical: "Drift level CRITICAL — extreme divergence detected; the registry has substantially changed from the previous snapshot.",
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

function readStoredFingerprint(entry) {
  return isPlainObject(entry) &&
    typeof entry.fingerprint === "string" &&
    entry.fingerprint.startsWith("seq_")
    ? entry.fingerprint
    : null;
}

// Plain-language label for a confidence value.
function confTierLabel(confidence) {
  if (confidence >= CONF_HIGH)    return "high_confidence";
  if (confidence >= CONF_STABLE)  return "stable";
  if (confidence >= CONF_EMERGING) return "emerging";
  if (confidence > 0)             return "weak";
  return "zero";
}

// Resolve a reason code to its plain-language explanation.
function reasonToText(code) {
  return REASON_TEXT[code] || "Reason: " + String(code).slice(0, 80) + ".";
}

// Plain-language urgency label for a review score.
function scoreUrgencyLabel(score) {
  if (score >= 80) return "critical urgency";
  if (score >= 58) return "high urgency";
  if (score >= 32) return "moderate urgency";
  return "low urgency";
}

// Derive explanation level from entry properties.
function deriveExplanationLevel(confidence, tier, tokens, flags) {
  if (flags.approvedForRuntime || flags.reusable) return "invalid";
  if (confidence < 0) return "invalid";
  if (!tokens) return "insufficient";
  if (
    confidence >= CONF_HIGH &&
    tier === "high_confidence" &&
    tokens.some((t) => t.endsWith("_save"))
  ) return "sufficient";
  if (confidence >= CONF_EMERGING && tokens.some((t) => t.endsWith("_save"))) return "partial";
  return "insufficient";
}

// Build deterministic summary string for an entry.
function buildEntrySummary(registryId, confidence, tier, explanationLevel) {
  const idPart = registryId ? "'" + registryId.slice(0, 60) + "'" : "(unnamed)";
  if (explanationLevel === "invalid") {
    return "Entry " + idPart + " is invalid and cannot advance — governance or structural violations are present.";
  }
  if (explanationLevel === "insufficient") {
    const pct = confidence >= 0 ? Math.round(confidence * 100) + "%" : "unknown";
    return "Entry " + idPart + " has insufficient signal (confidence " + pct + ", tier " + (tier || "unknown") + ") — not ready for promotion.";
  }
  if (explanationLevel === "partial") {
    return "Entry " + idPart + " shows partial signal (confidence " + Math.round(confidence * 100) + "%, tier " + tier + ") — review recommended before promotion.";
  }
  return "Entry " + idPart + " is a strong candidate (confidence " + Math.round(confidence * 100) + "%, tier " + tier + ") — all baseline checks passed.";
}

// Build deterministic factors array for an entry explanation.
function buildEntryFactors(entry, tokens, confidence, tier) {
  const factors = [];

  // 1. Confidence
  if (confidence < 0) {
    factors.push("Confidence: invalid — value is missing or outside the required [0, 1] range.");
  } else {
    const label = confTierLabel(confidence);
    const pct   = Math.round(confidence * 100) + "%";
    if (label === "high_confidence") {
      factors.push("Confidence: " + pct + " (high_confidence) — pattern is well-established and meets the promotion threshold.");
    } else if (label === "stable") {
      factors.push("Confidence: " + pct + " (stable) — pattern shows consistent signal but has not yet reached the high-confidence threshold.");
    } else if (label === "emerging") {
      factors.push("Confidence: " + pct + " (emerging) — pattern is in early accumulation; more observations are needed before promotion.");
    } else if (label === "weak") {
      factors.push("Confidence: " + pct + " (weak) — pattern has very low signal; likely noise or insufficient data.");
    } else {
      factors.push("Confidence: 0% — entry has not accumulated any signal.");
    }
  }

  // 2. Tier
  if (tier === "high_confidence") {
    factors.push("Tier: high_confidence — entry meets the highest promotion eligibility threshold.");
  } else if (tier === "stable") {
    factors.push("Tier: stable — entry is consistent but below the high-confidence threshold.");
  } else if (tier === "emerging") {
    factors.push("Tier: emerging — entry is in early accumulation and not yet ready for promotion.");
  } else if (tier === "unstable") {
    factors.push("Tier: unstable — entry shows inconsistent or insufficient signal.");
  } else {
    factors.push("Tier: missing or unrecognized — a valid tier label (high_confidence, stable, emerging, unstable) is required.");
  }

  // 3. Save signal
  if (!tokens) {
    factors.push("Save signal: unable to evaluate — sequence could not be parsed.");
  } else if (tokens.some((t) => t.endsWith("_save"))) {
    factors.push("Save signal: present — sequence includes a document save event, confirming end-to-end workflow capture.");
  } else {
    factors.push("Save signal: absent — sequence does not include a document save event; workflow capture may be incomplete.");
  }

  // 4. Sequence quality
  if (!tokens) {
    factors.push("Sequence quality: invalid — sequence could not be normalized.");
  } else {
    const len = tokens.length;
    if (len === 1) {
      factors.push("Sequence quality: minimal (1 token) — very limited workflow context.");
    } else if (len <= 3) {
      factors.push("Sequence quality: short (" + len + " tokens) — limited workflow context.");
    } else if (len <= 6) {
      factors.push("Sequence quality: moderate (" + len + " tokens) — reasonable workflow context.");
    } else {
      factors.push("Sequence quality: good (" + len + " tokens) — sufficient workflow context captured.");
    }
    if (isHeavyDuplicate(tokens)) {
      factors.push("Sequence normalization: heavy adjacent-duplicate runs detected; normalization must be applied before evaluation.");
    }
  }

  // 5. Fingerprint
  const storedFp = readStoredFingerprint(entry);
  if (storedFp) {
    factors.push("Fingerprint: stored (" + storedFp.slice(0, 32) + ") — entry is indexed and can be matched for deduplication.");
  } else {
    factors.push("Fingerprint: not stored — a fingerprint will need to be derived at evaluation time.");
  }

  // 6. Runtime governance flags
  const rFlag = entry.reusable === true;
  const aFlag = entry.approvedForRuntime === true;
  if (rFlag && aFlag) {
    factors.push("Governance flags: BOTH reusable and approvedForRuntime are true — critical double violation; neither flag may be true at this stage.");
  } else if (rFlag) {
    factors.push("Governance flags: reusable is true — violation; this flag must remain false until all governance gates pass.");
  } else if (aFlag) {
    factors.push("Governance flags: approvedForRuntime is true — violation; this flag must remain false until authorized.");
  } else {
    factors.push("Governance flags: correct — both reusable and approvedForRuntime are false.");
  }

  // 7. Frequency (informational, if present)
  const freq = Number(entry.frequency);
  if (Number.isFinite(freq) && freq > 0) {
    factors.push("Frequency: " + freq + " — pattern has been observed this many times in captured sessions.");
  }

  return factors.slice(0, MAX_FACTORS);
}

// Build deterministic warnings array for an entry explanation.
function buildEntryWarnings(entry, tokens, confidence, tier) {
  const warnings = [];

  if (entry.approvedForRuntime === true) {
    warnings.push("CRITICAL: approvedForRuntime is true — runtime activation is unauthorized at this stage.");
  }
  if (entry.reusable === true) {
    warnings.push("CRITICAL: reusable is true — reuse flag must remain false until all governance gates have passed.");
  }
  if (confidence >= 0 && tier) {
    if (confidence >= CONF_HIGH && tier !== "high_confidence") {
      warnings.push(
        "Tier mismatch: confidence (" + Math.round(confidence * 100) + "%) implies high_confidence but stored tier is '" + tier + "'."
      );
    }
    if (tier === "high_confidence" && confidence < CONF_HIGH) {
      warnings.push(
        "Tier mismatch: stored tier is high_confidence but confidence (" + Math.round(confidence * 100) + "%) is below the 80% threshold."
      );
    }
  }
  if (tokens && isHeavyDuplicate(tokens)) {
    warnings.push("Sequence contains heavy adjacent-duplicate runs; normalization must be applied before registry evaluation.");
  }
  if (
    !tokens &&
    isPlainObject(entry) &&
    Array.isArray(entry.sequence) &&
    entry.sequence.length > MAX_SEQUENCE_LENGTH
  ) {
    warnings.push("Sequence exceeds the maximum allowed length (" + MAX_SEQUENCE_LENGTH + " tokens) and will be rejected by normalizers.");
  }

  return warnings.slice(0, MAX_WARNINGS);
}

// ── Public: explainLearningRegistryEntry ─────────────────────────────────────

/**
 * Produce a deterministic plain-language explanation for a single registry entry.
 * Explains confidence, tier, save signal, sequence quality, runtime flags, fingerprint.
 * Succeeds (valid:true) even for entries with violations — those appear in factors/warnings.
 * Pure, deterministic, never throws. No side effects.
 */
export function explainLearningRegistryEntry(entry) {
  const FAIL = (rejectionReason) => Object.freeze({
    valid:            false,
    registryId:       null,
    fingerprint:      null,
    explanationLevel: "invalid",
    summary:          "Entry could not be explained: " + rejectionReason + ".",
    factors:          Object.freeze([]),
    warnings:         Object.freeze([]),
    rejectionReason,
  });

  try {
    if (!isPlainObject(entry)) return FAIL("malformed_entry");

    const confidence  = readConfidence(entry);
    const tokens      = readTokens(entry);
    const tier        = typeof entry.tier === "string" ? entry.tier.trim().toLowerCase() : "";
    const registryId  = typeof entry.registryId === "string" && entry.registryId.trim()
      ? entry.registryId.trim().slice(0, MAX_REGISTRY_ID_LEN)
      : null;
    const fingerprint = readStoredFingerprint(entry);

    const flags = {
      reusable:           entry.reusable === true,
      approvedForRuntime: entry.approvedForRuntime === true,
    };

    const explanationLevel = deriveExplanationLevel(confidence, tier, tokens, flags);
    const summary          = buildEntrySummary(registryId, confidence, tier, explanationLevel);
    const factors          = buildEntryFactors(entry, tokens, confidence, tier);
    const warnings         = buildEntryWarnings(entry, tokens, confidence, tier);

    return Object.freeze({
      valid:            true,
      registryId:       registryId || null,
      fingerprint:      fingerprint || null,
      explanationLevel,
      summary,
      factors:          Object.freeze(factors),
      warnings:         Object.freeze(warnings),
      rejectionReason:  null,
    });
  } catch {
    return FAIL("explanation_error");
  }
}

// ── Public: explainReviewQueueItem ────────────────────────────────────────────

/**
 * Produce a deterministic plain-language explanation for a review queue item.
 * Maps priority, recommendation, reviewScore, and reason codes to plain text.
 * Never infers beyond the fields present on the item.
 * Pure, deterministic, never throws. No side effects.
 */
export function explainReviewQueueItem(item) {
  const FAIL = (rejectionReason) => Object.freeze({
    valid:                     false,
    registryId:                null,
    priorityExplanation:       null,
    recommendationExplanation: null,
    scoreExplanation:          null,
    reasons:                   Object.freeze([]),
    warnings:                  Object.freeze([]),
    rejectionReason,
  });

  try {
    if (!isPlainObject(item)) return FAIL("malformed_item");

    const registryId = typeof item.registryId === "string" && item.registryId.trim()
      ? item.registryId.trim().slice(0, MAX_REGISTRY_ID_LEN)
      : null;

    const priority       = typeof item.priority === "string"       ? item.priority.trim().toLowerCase()       : "";
    const recommendation = typeof item.recommendation === "string" ? item.recommendation.trim().toLowerCase() : "";
    const reviewScore    = Number(item.reviewScore);

    const priorityExplanation = PRIORITY_TEXT[priority]
      || "Priority '" + String(priority).slice(0, 40) + "' is not a recognized priority level.";

    const recommendationExplanation = RECOMMENDATION_TEXT[recommendation]
      || "Recommendation '" + String(recommendation).slice(0, 40) + "' is not recognized.";

    let scoreExplanation;
    if (Number.isFinite(reviewScore) && reviewScore >= 0 && reviewScore <= 100) {
      const urgency = scoreUrgencyLabel(reviewScore);
      const action  =
        reviewScore >= 80 ? "requires immediate action." :
        reviewScore >= 58 ? "should be addressed soon." :
        reviewScore >= 32 ? "can be queued for scheduled review." :
                            "is in good standing.";
      scoreExplanation = "Review score " + reviewScore + "/100 (" + urgency + ") — " + action;
    } else {
      scoreExplanation = "Review score is missing or invalid.";
    }

    const reasons  = [];
    const warnings = [];

    if (Array.isArray(item.reasons)) {
      for (let i = 0; i < item.reasons.length && i < MAX_FACTORS; i++) {
        reasons.push(reasonToText(item.reasons[i]));
      }
    } else {
      warnings.push("Item is missing a reasons array; reason codes cannot be explained.");
    }

    if (!registryId) {
      warnings.push("Item is missing a valid registryId; traceability is reduced.");
    }

    if (
      typeof item.fingerprint !== "string" ||
      !item.fingerprint.startsWith("seq_")
    ) {
      warnings.push("Item fingerprint is absent or has an invalid format; deduplication traceability is unavailable.");
    }

    if (priority && !PRIORITY_TEXT[priority]) {
      warnings.push("Unrecognized priority '" + String(priority).slice(0, 40) + "'; priority explanation is a fallback.");
    }

    if (recommendation && !RECOMMENDATION_TEXT[recommendation]) {
      warnings.push("Unrecognized recommendation '" + String(recommendation).slice(0, 40) + "'; recommendation explanation is a fallback.");
    }

    return Object.freeze({
      valid:                     true,
      registryId:                registryId || null,
      priorityExplanation,
      recommendationExplanation,
      scoreExplanation,
      reasons:                   Object.freeze(reasons),
      warnings:                  Object.freeze(warnings.slice(0, MAX_WARNINGS)),
      rejectionReason:           null,
    });
  } catch {
    return FAIL("explanation_error");
  }
}

// ── Public: explainSnapshotComparison ─────────────────────────────────────────

/**
 * Produce a deterministic plain-language explanation of two snapshot states and their diff.
 * Explains driftLevel, fingerprint changes, and scoring/risk/save-signal deltas.
 * Pure, deterministic, never throws. No side effects.
 */
export function explainSnapshotComparison(previousSnapshot, currentSnapshot, comparison) {
  const FAIL = (rejectionReason) => Object.freeze({
    valid:                        false,
    summary:                      "Snapshot comparison could not be explained: " + rejectionReason + ".",
    driftExplanation:             null,
    qualityTrendExplanation:      null,
    fingerprintChangeExplanation: null,
    warnings:                     Object.freeze([]),
    rejectionReason,
  });

  try {
    if (!isPlainObject(previousSnapshot) || !previousSnapshot.valid) return FAIL("invalid_previous_snapshot");
    if (!isPlainObject(currentSnapshot)  || !currentSnapshot.valid)  return FAIL("invalid_current_snapshot");
    if (!isPlainObject(comparison)       || !comparison.valid)       return FAIL("invalid_comparison");

    const warnings = [];

    // Drift explanation.
    const driftLevel = typeof comparison.driftLevel === "string"
      ? comparison.driftLevel.trim().toLowerCase()
      : "";
    const driftExplanation = DRIFT_TEXT[driftLevel]
      || "Drift level '" + String(driftLevel).slice(0, 40) + "' is not recognized.";

    if (driftLevel === "high" || driftLevel === "critical") {
      warnings.push(
        "Drift level " + driftLevel.toUpperCase() + " — significant registry churn detected; manual inspection is recommended."
      );
    }

    // Fingerprint change explanation.
    const added   = Array.isArray(comparison.addedFingerprints)   ? comparison.addedFingerprints.length   : 0;
    const removed = Array.isArray(comparison.removedFingerprints) ? comparison.removedFingerprints.length : 0;
    const changed = Array.isArray(comparison.changedFingerprints) ? comparison.changedFingerprints.length : 0;

    const fpParts = [];
    if (added > 0)   fpParts.push(added   + " fingerprint" + (added   !== 1 ? "s" : "") + " added");
    if (removed > 0) fpParts.push(removed + " fingerprint" + (removed !== 1 ? "s" : "") + " removed");
    if (changed > 0) fpParts.push(changed + " fingerprint" + (changed !== 1 ? "s" : "") + " updated in frequency");

    const fingerprintChangeExplanation = fpParts.length
      ? fpParts.join(", ") + " since the previous snapshot."
      : "No fingerprint changes detected between snapshots.";

    if (removed > 3 && removed > added * 2) {
      warnings.push(removed + " fingerprints were removed — net registry coverage declined; review for unintended data loss.");
    }

    // Quality trend explanation.
    const tierDelta = isPlainObject(comparison.scoringTierDelta) ? comparison.scoringTierDelta : {};
    const riskDelta = isPlainObject(comparison.riskLevelDelta)   ? comparison.riskLevelDelta   : {};
    const saveDelta = typeof comparison.saveSignalCoverageDelta === "number"
      ? comparison.saveSignalCoverageDelta
      : 0;

    const trendParts = [];

    const eliteDelta    = (tierDelta.elite  || 0) + (tierDelta.strong    || 0);
    const weakDelta     = (tierDelta.weak   || 0) + (tierDelta.rejected  || 0);
    const critRiskDelta = (riskDelta.critical || 0) + (riskDelta.high    || 0);

    if (eliteDelta > 0) {
      trendParts.push("elite/strong entries increased by " + eliteDelta);
    } else if (eliteDelta < 0) {
      trendParts.push("elite/strong entries decreased by " + Math.abs(eliteDelta));
      warnings.push("Quality regression: " + Math.abs(eliteDelta) + " elite/strong entries were lost since the previous snapshot.");
    }

    if (weakDelta > 0) {
      trendParts.push("weak/rejected entries increased by " + weakDelta);
    }

    if (critRiskDelta > 0) {
      trendParts.push("critical/high-risk entries increased by " + critRiskDelta);
      warnings.push("Risk increase: " + critRiskDelta + " additional critical or high-risk entries detected.");
    } else if (critRiskDelta < 0) {
      trendParts.push("critical/high-risk entries decreased by " + Math.abs(critRiskDelta));
    }

    if (saveDelta > 0) {
      trendParts.push("save-signal coverage improved by " + Math.round(saveDelta * 100) + " percentage points");
    } else if (saveDelta < 0) {
      trendParts.push("save-signal coverage declined by " + Math.round(Math.abs(saveDelta) * 100) + " percentage points");
      warnings.push("Save-signal coverage declined — more sequences are missing a document save event.");
    }

    const qualityTrendExplanation = trendParts.length
      ? trendParts.join("; ") + "."
      : "No significant quality trend detected between snapshots.";

    // Overall summary.
    const prevTotal = Number(previousSnapshot.totalEntries) || 0;
    const currTotal = Number(currentSnapshot.totalEntries)  || 0;
    const summary = "Registry moved from " + prevTotal + " to " + currTotal + " total entries. " + driftExplanation;

    return Object.freeze({
      valid:                        true,
      summary,
      driftExplanation,
      qualityTrendExplanation,
      fingerprintChangeExplanation,
      warnings:                     Object.freeze(warnings.slice(0, MAX_WARNINGS)),
      rejectionReason:              null,
    });
  } catch {
    return FAIL("explanation_error");
  }
}

// ── Public: detectExplainabilityViolations ────────────────────────────────────

/**
 * Inspect an explainability output object for structural violations.
 * Works for any of the three explanation types (entry, queue item, snapshot comparison).
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectExplainabilityViolations(input) {
  const EMPTY = Object.freeze({
    malformedInputs:          Object.freeze([]),
    missingRegistryId:        Object.freeze([]),
    missingFingerprint:       Object.freeze([]),
    missingExplanationFields: Object.freeze([]),
    excessiveFactors:         Object.freeze([]),
    excessiveWarnings:        Object.freeze([]),
    totalViolationCount:      0,
  });

  try {
    if (!isPlainObject(input)) {
      return Object.freeze({
        malformedInputs:          Object.freeze(["non_object_input"]),
        missingRegistryId:        Object.freeze([]),
        missingFingerprint:       Object.freeze([]),
        missingExplanationFields: Object.freeze([]),
        excessiveFactors:         Object.freeze([]),
        excessiveWarnings:        Object.freeze([]),
        totalViolationCount:      1,
      });
    }

    const malformedInputs          = [];
    const missingRegistryId        = [];
    const missingFingerprint       = [];
    const missingExplanationFields = [];
    const excessiveFactors         = [];
    const excessiveWarnings        = [];

    // Structural: valid flag.
    if (input.valid !== true && input.valid !== false) {
      malformedInputs.push("missing_valid_field");
    }

    // Explanation type detection (duck-typed by distinctive fields).
    const isEntryExplanation    = typeof input.explanationLevel === "string";
    const isQueueItemExplanation = typeof input.priorityExplanation === "string";
    const isSnapshotExplanation  = typeof input.driftExplanation === "string";

    if (input.valid === true) {
      if (isEntryExplanation) {
        if (typeof input.summary !== "string" || !input.summary.trim()) {
          missingExplanationFields.push("entry_summary_missing");
        }
        if (!Array.isArray(input.factors)) {
          missingExplanationFields.push("entry_factors_not_array");
        }
        if (!Array.isArray(input.warnings)) {
          missingExplanationFields.push("entry_warnings_not_array");
        }
      } else if (isQueueItemExplanation) {
        if (typeof input.recommendationExplanation !== "string" || !input.recommendationExplanation.trim()) {
          missingExplanationFields.push("queue_recommendation_explanation_missing");
        }
        if (typeof input.scoreExplanation !== "string" || !input.scoreExplanation.trim()) {
          missingExplanationFields.push("queue_score_explanation_missing");
        }
        if (!Array.isArray(input.reasons)) {
          missingExplanationFields.push("queue_reasons_not_array");
        }
      } else if (isSnapshotExplanation) {
        if (typeof input.qualityTrendExplanation !== "string" || !input.qualityTrendExplanation.trim()) {
          missingExplanationFields.push("snapshot_quality_trend_explanation_missing");
        }
        if (typeof input.fingerprintChangeExplanation !== "string" || !input.fingerprintChangeExplanation.trim()) {
          missingExplanationFields.push("snapshot_fingerprint_change_explanation_missing");
        }
        if (typeof input.summary !== "string" || !input.summary.trim()) {
          missingExplanationFields.push("snapshot_summary_missing");
        }
      } else {
        missingExplanationFields.push("unrecognized_explanation_type");
      }
    }

    // registryId check — applies when the field is present.
    if ("registryId" in input) {
      if (typeof input.registryId !== "string" || !input.registryId.trim()) {
        missingRegistryId.push("registryId_empty_or_invalid");
      }
    }

    // fingerprint check — applies when the field is present and non-null.
    if ("fingerprint" in input && input.fingerprint !== null) {
      if (typeof input.fingerprint !== "string" || !input.fingerprint.startsWith("seq_")) {
        missingFingerprint.push("fingerprint_invalid_format");
      }
    }

    // Excessive factors.
    if (Array.isArray(input.factors) && input.factors.length > MAX_FACTORS) {
      excessiveFactors.push(
        "factors_count_" + input.factors.length + "_exceeds_max_" + MAX_FACTORS
      );
    }

    // Excessive warnings.
    if (Array.isArray(input.warnings) && input.warnings.length > MAX_WARNINGS) {
      excessiveWarnings.push(
        "warnings_count_" + input.warnings.length + "_exceeds_max_" + MAX_WARNINGS
      );
    }

    const totalViolationCount =
      malformedInputs.length
      + missingRegistryId.length
      + missingFingerprint.length
      + missingExplanationFields.length
      + excessiveFactors.length
      + excessiveWarnings.length;

    return Object.freeze({
      malformedInputs:          Object.freeze(malformedInputs.sort()),
      missingRegistryId:        Object.freeze(missingRegistryId.sort()),
      missingFingerprint:       Object.freeze(missingFingerprint.sort()),
      missingExplanationFields: Object.freeze(missingExplanationFields.sort()),
      excessiveFactors:         Object.freeze(excessiveFactors.sort()),
      excessiveWarnings:        Object.freeze(excessiveWarnings.sort()),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
