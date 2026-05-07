// @ts-nocheck
/* eslint-disable */

// Standalone deterministic review queue utility for the Job Learning system.
// No imports. No runtime wiring. No persistence. No side effects.

const MAX_REGISTRY_ENTRIES = 1000;
const MAX_TOKEN_LENGTH     = 80;
const MAX_SEQUENCE_LENGTH  = 100;
const MAX_REGISTRY_ID_LEN  = 120;

// Confidence tier thresholds.
const CONF_HIGH_CONFIDENCE = 0.8;
const CONF_STABLE          = 0.6;
const CONF_EMERGING        = 0.4;

// Adjacent-duplicate collapse ratio above which a sequence is "duplicate-heavy".
const HEAVY_COLLAPSE_THRESHOLD = 0.3;

const VALID_TIERS = new Set(["high_confidence", "stable", "emerging", "unstable"]);

// ── Private helpers ───────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// FNV-1a 32-bit — deterministic, no randomness, no timestamps.
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Return validated, normalized token array from an entry or null if unusable.
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

// Return confidence in [0,1] or -1 if invalid.
function readConfidence(entry) {
  const c = Number(entry.confidence);
  return Number.isFinite(c) && c >= 0 && c <= 1 ? c : -1;
}

// Return stored fingerprint if valid, or build one from tokens, or null.
function readFingerprint(entry) {
  if (
    isPlainObject(entry) &&
    typeof entry.fingerprint === "string" &&
    entry.fingerprint.startsWith("seq_")
  ) {
    return entry.fingerprint;
  }
  const tokens = readTokens(entry);
  if (!tokens) return null;
  return "seq_" + fnv1a32(tokens.join("|")) + "_l" + tokens.length;
}

// Infer scoring tier label from a valid confidence value.
function inferScoringTier(confidence) {
  if (confidence >= CONF_HIGH_CONFIDENCE) return "elite";
  if (confidence >= CONF_STABLE)          return "strong";
  if (confidence >= CONF_EMERGING)        return "moderate";
  if (confidence > 0)                     return "weak";
  return "rejected";
}

// Collapse adjacent identical tokens (single pass).
function collapseAdjacent(tokens) {
  if (!tokens.length) return tokens;
  const out = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] !== tokens[i - 1]) out.push(tokens[i]);
  }
  return out;
}

// True when adjacent-duplicate collapse removes >= HEAVY_COLLAPSE_THRESHOLD of tokens.
function isHeavyDuplicate(tokens) {
  if (!tokens || tokens.length === 0) return false;
  const collapsed = collapseAdjacent(tokens);
  return (tokens.length - collapsed.length) / tokens.length >= HEAVY_COLLAPSE_THRESHOLD;
}

// Deterministic review score in [0, 100]. Higher = more urgent to review.
function computeReviewScore(riskLevel, confidence, tokens, frequency) {
  const BASE = { critical: 80, high: 58, moderate: 32, low: 10 };
  let score = BASE[riskLevel] || 0;

  // Lower confidence → more urgent to review.
  if (Number.isFinite(confidence) && confidence >= 0 && confidence <= 1) {
    score += Math.round((1 - confidence) * 12);
  }

  // Higher frequency → more impactful to resolve.
  const freq = Number(frequency);
  if (Number.isFinite(freq) && freq > 0) {
    score += Math.min(5, Math.floor(freq / 5));
  }

  // Heavy duplicate burden adds marginal urgency.
  if (tokens && isHeavyDuplicate(tokens)) score += 3;

  return Math.min(100, Math.max(0, score));
}

// Map risk level + entry properties to a recommendation.
function deriveRecommendation(riskLevel, confidence) {
  if (riskLevel === "critical") return "reject";
  if (riskLevel === "high")     return "quarantine";
  if (riskLevel === "moderate") return "review";
  // low risk — promote only when truly high-confidence.
  return confidence >= CONF_HIGH_CONFIDENCE ? "promote_candidate" : "review";
}

// Build the sorted reasons array for a review item.
function buildReasons(entry, tokens, confidence, tier) {
  const reasons = [];

  if (entry.approvedForRuntime === true) reasons.push("approved_for_runtime_flag_set");

  if (entry.reusable === true && tier !== "high_confidence") {
    reasons.push("reusable_flag_unsafe_tier");
  }

  if (confidence < 0) {
    reasons.push("invalid_confidence");
  } else if (confidence < CONF_EMERGING) {
    reasons.push("low_confidence");
  }

  if (!tokens) {
    reasons.push("invalid_sequence");
  } else {
    if (!tokens.some((t) => t.endsWith("_save"))) reasons.push("missing_save_signal");
    if (isHeavyDuplicate(tokens)) reasons.push("duplicate_heavy_sequence");
  }

  if (
    typeof entry.fingerprint !== "string" ||
    !entry.fingerprint.startsWith("seq_")
  ) {
    reasons.push("missing_stored_fingerprint");
  }

  if (tier === "unstable") reasons.push("unstable_tier");
  if (tier === "emerging")  reasons.push("emerging_tier");

  if (reasons.length === 0) {
    reasons.push(confidence >= CONF_HIGH_CONFIDENCE
      ? "high_confidence_candidate"
      : "moderate_confidence_candidate");
  }

  return reasons.sort();
}

// Safe label for violation and reason arrays.
function entryLabel(entry, index) {
  if (isPlainObject(entry) && typeof entry.registryId === "string" && entry.registryId.trim()) {
    return entry.registryId.trim().slice(0, MAX_REGISTRY_ID_LEN);
  }
  return "(index " + index + ")";
}

// ── Public: deriveReviewQueueRisk ─────────────────────────────────────────────

/**
 * Classify the review queue risk of a single raw registry entry.
 * Highest applicable level wins. Pure, deterministic, never throws.
 */
export function deriveReviewQueueRisk(entry) {
  try {
    // ── Critical ─────────────────────────────────────────────────────────────
    if (!isPlainObject(entry))              return "critical";
    if (entry.approvedForRuntime === true)  return "critical";

    const tier = typeof entry.tier === "string" ? entry.tier.trim().toLowerCase() : "";
    if (entry.reusable === true && tier !== "high_confidence") return "critical";

    const confidence = readConfidence(entry);
    if (confidence < 0) return "critical";

    // ── High ─────────────────────────────────────────────────────────────────
    const tokens = readTokens(entry);
    if (!tokens)                                          return "high"; // unusable sequence
    if (!tokens.some((t) => t.endsWith("_save")))        return "high";

    const scoringTier = inferScoringTier(confidence);
    if (scoringTier === "weak" || scoringTier === "rejected") return "high";
    if (tier === "unstable" || tier === "emerging")           return "high";

    // ── Moderate ─────────────────────────────────────────────────────────────
    const hasStoredFingerprint =
      typeof entry.fingerprint === "string" && entry.fingerprint.startsWith("seq_");
    if (!hasStoredFingerprint)            return "moderate";
    if (isHeavyDuplicate(tokens))         return "moderate";
    if (scoringTier === "moderate")       return "moderate";

    // ── Low ──────────────────────────────────────────────────────────────────
    return "low";
  } catch {
    return "critical";
  }
}

// ── Public: buildLearningReviewQueue ──────────────────────────────────────────

/**
 * Build a deterministically ordered review queue from a registry.
 * Sorted by reviewScore descending, then registryId ascending.
 * Never sets reusable or approvedForRuntime to true.
 * Pure, deterministic, never throws. No side effects.
 */
export function buildLearningReviewQueue(registry) {
  const EMPTY = Object.freeze({
    reviewItems:          Object.freeze([]),
    candidateCount:       0,
    rejectedCount:        0,
    priorityCounts:       Object.freeze({ critical: 0, high: 0, moderate: 0, low: 0 }),
    recommendationCounts: Object.freeze({ reject: 0, quarantine: 0, review: 0, promote_candidate: 0 }),
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const items = [];
    const priorityCounts      = { critical: 0, high: 0, moderate: 0, low: 0 };
    const recommendationCounts = { reject: 0, quarantine: 0, review: 0, promote_candidate: 0 };
    let candidateCount = 0;
    let rejectedCount  = 0;

    for (let i = 0; i < list.length; i++) {
      const raw        = list[i];
      const validEntry = isPlainObject(raw);

      const riskLevel  = deriveReviewQueueRisk(raw);
      const tokens     = validEntry ? readTokens(raw) : null;
      const confidence = validEntry ? readConfidence(raw) : -1;
      const tier       = validEntry && typeof raw.tier === "string"
        ? raw.tier.trim().toLowerCase()
        : "";

      const registryId = validEntry && typeof raw.registryId === "string" && raw.registryId.trim()
        ? raw.registryId.trim().slice(0, MAX_REGISTRY_ID_LEN)
        : "(index " + i + ")";

      const fp             = readFingerprint(raw) || "seq_unknown";
      const recommendation = deriveRecommendation(riskLevel, confidence);
      const reviewScore    = computeReviewScore(riskLevel, confidence, tokens, validEntry ? raw.frequency : undefined);
      const reasons        = buildReasons(validEntry ? raw : {}, tokens, confidence, tier);

      items.push({
        registryId,
        fingerprint:    fp,
        priority:       riskLevel,
        recommendation,
        reviewScore,
        reasons:        Object.freeze(reasons),
      });

      if (riskLevel in priorityCounts) priorityCounts[riskLevel]++;
      if (recommendation in recommendationCounts) recommendationCounts[recommendation]++;
      if (recommendation === "reject") rejectedCount++;
      else candidateCount++;
    }

    // Stable deterministic sort: reviewScore desc, registryId asc.
    items.sort((a, b) => {
      if (b.reviewScore !== a.reviewScore) return b.reviewScore - a.reviewScore;
      return a.registryId < b.registryId ? -1 : a.registryId > b.registryId ? 1 : 0;
    });

    return Object.freeze({
      reviewItems:          Object.freeze(items.map((item) => Object.freeze(item))),
      candidateCount,
      rejectedCount,
      priorityCounts:       Object.freeze(priorityCounts),
      recommendationCounts: Object.freeze(recommendationCounts),
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: summarizeReviewQueueHealth ───────────────────────────────────────

/**
 * Aggregate review queue health metrics across a registry.
 * All rates bounded to [0, 1]. Pure, deterministic, never throws. No side effects.
 */
export function summarizeReviewQueueHealth(registry) {
  const EMPTY = Object.freeze({
    totalEntries:           0,
    reviewableEntries:      0,
    rejectedEntries:        0,
    promoteCandidateCount:  0,
    quarantineCount:        0,
    rejectionRate:          0,
    promotionCandidateRate: 0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const result = buildLearningReviewQueue(list);

    const totalEntries         = result.reviewItems.length;
    const rejectedEntries      = result.rejectedCount;
    const reviewableEntries    = result.candidateCount;
    const promoteCandidateCount = result.recommendationCounts.promote_candidate || 0;
    const quarantineCount      = result.recommendationCounts.quarantine || 0;

    const rejectionRate = totalEntries > 0
      ? Math.round((rejectedEntries / totalEntries) * 1000) / 1000
      : 0;
    const promotionCandidateRate = reviewableEntries > 0
      ? Math.round((promoteCandidateCount / reviewableEntries) * 1000) / 1000
      : 0;

    return Object.freeze({
      totalEntries,
      reviewableEntries,
      rejectedEntries,
      promoteCandidateCount,
      quarantineCount,
      rejectionRate,
      promotionCandidateRate,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: detectReviewQueueViolations ───────────────────────────────────────

/**
 * Scan a registry for entries that violate review queue preconditions.
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectReviewQueueViolations(registry) {
  const EMPTY = Object.freeze({
    malformedEntries:          Object.freeze([]),
    runtimeApprovedEntries:    Object.freeze([]),
    reusableUnsafeEntries:     Object.freeze([]),
    invalidConfidenceEntries:  Object.freeze([]),
    missingFingerprintEntries: Object.freeze([]),
    weakCandidateEntries:      Object.freeze([]),
    totalViolationCount:       0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const malformedEntries         = [];
    const runtimeApprovedEntries   = [];
    const reusableUnsafeEntries    = [];
    const invalidConfidenceEntries = [];
    const missingFingerprintEntries = [];
    const weakCandidateEntries     = [];

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const id  = entryLabel(raw, i);

      if (!isPlainObject(raw)) {
        malformedEntries.push(id);
        continue;
      }

      // Structural validity check.
      const hasValidId  = typeof raw.registryId === "string" && raw.registryId.trim().length > 0;
      const hasValidSeq = Array.isArray(raw.sequence) && raw.sequence.length > 0;
      const hasValidTier = typeof raw.tier === "string" && VALID_TIERS.has(raw.tier.trim().toLowerCase());
      if (!hasValidId || !hasValidSeq || !hasValidTier) {
        malformedEntries.push(id);
      }

      // Governance flag violations.
      if (raw.approvedForRuntime === true) runtimeApprovedEntries.push(id);

      const tier = typeof raw.tier === "string" ? raw.tier.trim().toLowerCase() : "";
      if (raw.reusable === true && tier !== "high_confidence") reusableUnsafeEntries.push(id);

      // Confidence validity.
      const confidence = readConfidence(raw);
      if (confidence < 0) invalidConfidenceEntries.push(id);

      // Stored fingerprint presence.
      const hasStoredFp =
        typeof raw.fingerprint === "string" && raw.fingerprint.startsWith("seq_");
      if (!hasStoredFp) missingFingerprintEntries.push(id);

      // Weak or rejected scoring tier.
      if (confidence >= 0) {
        const scoringTier = inferScoringTier(confidence);
        if (scoringTier === "weak" || scoringTier === "rejected") {
          weakCandidateEntries.push(id);
        }
      }
    }

    const totalViolationCount =
      malformedEntries.length
      + runtimeApprovedEntries.length
      + reusableUnsafeEntries.length
      + invalidConfidenceEntries.length
      + missingFingerprintEntries.length
      + weakCandidateEntries.length;

    return Object.freeze({
      malformedEntries:          Object.freeze(malformedEntries.sort()),
      runtimeApprovedEntries:    Object.freeze(runtimeApprovedEntries.sort()),
      reusableUnsafeEntries:     Object.freeze(reusableUnsafeEntries.sort()),
      invalidConfidenceEntries:  Object.freeze(invalidConfidenceEntries.sort()),
      missingFingerprintEntries: Object.freeze(missingFingerprintEntries.sort()),
      weakCandidateEntries:      Object.freeze(weakCandidateEntries.sort()),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
