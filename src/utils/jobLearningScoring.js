// @ts-nocheck
/* eslint-disable */

// Standalone deterministic learning scoring for the Job Learning system.
// No imports. No runtime wiring. No persistence. No side effects.

const MAX_SEQUENCE_LENGTH  = 100;
const MAX_REGISTRY_ENTRIES = 1000;

// Scoring weights — must sum to 100.
const W_CONFIDENCE = 30;
const W_SEQUENCE   = 25;
const W_COVERAGE   = 20;
const W_SAVE       = 15;
const W_CLEAN      = 10;

// Tier thresholds (totalScore out of 100).
const TIER_ELITE    = 85;
const TIER_STRONG   = 65;
const TIER_MODERATE = 40;
const TIER_WEAK     = 1;

// Confidence thresholds that mirror jobPatternRegistry.classifyPatternTier.
const CONF_HIGH = 0.8;
const CONF_STABLE   = 0.6;
const CONF_EMERGING = 0.4;

// Known section prefixes and seam suffixes used to gauge coverage breadth.
const SECTION_PREFIXES = ["scope_", "labor_", "materials_"];
const ASSIST_SUFFIXES  = ["_request", "_result", "_accept"];

// ── Private helpers ───────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
}

function round2(v) {
  return Math.round(v * 100) / 100;
}

// Returns the confidence value from an entry, or -1 if invalid.
function readConfidence(entry) {
  const c = Number(entry.confidence);
  return Number.isFinite(c) && c >= 0 && c <= 1 ? c : -1;
}

// Returns a clean token array from an entry's sequence, or null if unusable.
function readSequence(entry) {
  if (!Array.isArray(entry.sequence)) return null;
  const tokens = entry.sequence
    .filter((t) => typeof t === "string" && t.trim().length > 0)
    .map((t) => t.trim().toLowerCase())
    .slice(0, MAX_SEQUENCE_LENGTH);
  return tokens.length ? tokens : null;
}

// ── Scoring sub-components (each returns 0–1) ─────────────────────────────────

function scoreConfidence(confidence) {
  // Linear scale within each tier band.
  if (confidence >= CONF_HIGH)    return 0.75 + 0.25 * ((confidence - CONF_HIGH)    / (1 - CONF_HIGH));
  if (confidence >= CONF_STABLE)  return 0.45 + 0.30 * ((confidence - CONF_STABLE)  / (CONF_HIGH - CONF_STABLE));
  if (confidence >= CONF_EMERGING) return 0.15 + 0.30 * ((confidence - CONF_EMERGING) / (CONF_STABLE - CONF_EMERGING));
  return 0.05 * (confidence / CONF_EMERGING);
}

function scoreSequenceQuality(tokens) {
  // Penalise very short sequences; reward longer up to a ceiling.
  const length = tokens.length;
  if (length === 0) return 0;
  if (length === 1) return 0.15;
  if (length <= 3)  return 0.40 + 0.10 * (length - 2);
  if (length <= 6)  return 0.60 + 0.06 * (length - 3);
  // Longer than 6 is good, but diminishing returns.
  return clamp(0.78 + 0.02 * (length - 6), 0, 1);
}

function scoreWorkflowCoverage(tokens) {
  // How many of the three known sections appear?
  const sectionsPresent = SECTION_PREFIXES.filter((p) => tokens.some((t) => t.startsWith(p))).length;
  // How many assist seam types appear?
  const assistPresent   = ASSIST_SUFFIXES.filter((s) => tokens.some((t) => t.endsWith(s))).length;

  const sectionScore = sectionsPresent / SECTION_PREFIXES.length; // 0–1
  const assistScore  = assistPresent   / ASSIST_SUFFIXES.length;  // 0–1
  return clamp((sectionScore * 0.65) + (assistScore * 0.35), 0, 1);
}

function scoreSaveSignal(tokens) {
  const saveTokens = tokens.filter((t) => t.endsWith("_save")).length;
  if (saveTokens === 0) return 0;
  if (saveTokens === 1) return 0.80;
  // Multiple save signals are fine but not substantially better.
  return clamp(0.80 + 0.10 * (saveTokens - 1), 0, 1);
}

function scoreNormalizationClean(tokens) {
  if (!tokens.length) return 0;
  // Check for adjacent duplicate runs (already collapsed = cleaner).
  let duplicateRuns = 0;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 1]) duplicateRuns++;
  }
  const dupRatio = duplicateRuns / tokens.length;
  // Perfect = no duplicate runs; worst case = all duplicates.
  return clamp(1 - dupRatio * 2, 0, 1);
}

function deriveTier(totalScore) {
  if (totalScore >= TIER_ELITE)    return "elite";
  if (totalScore >= TIER_STRONG)   return "strong";
  if (totalScore >= TIER_MODERATE) return "moderate";
  if (totalScore >= TIER_WEAK)     return "weak";
  return "rejected";
}

// ── Public: scoreWorkflowLearningEntry ───────────────────────────────────────

/**
 * Score a single registry entry across five weighted dimensions.
 * All scores are bounded 0–100. Same input always produces same output.
 * Pure, deterministic, never throws. No side effects.
 */
export function scoreWorkflowLearningEntry(entry) {
  const FAIL = (rejectionReason) => Object.freeze({
    valid: false,
    totalScore: 0,
    confidenceScore: 0,
    sequenceQualityScore: 0,
    workflowCoverageScore: 0,
    saveSignalScore: 0,
    normalizationScore: 0,
    scoringTier: "rejected",
    rejectionReason,
  });

  try {
    if (!isPlainObject(entry))          return FAIL("malformed_entry");

    const confidence = readConfidence(entry);
    if (confidence < 0)                 return FAIL("invalid_confidence");

    const tokens = readSequence(entry);
    if (!tokens)                        return FAIL("empty_sequence");

    // Compute sub-scores (each 0–1).
    const cs = clamp(scoreConfidence(confidence), 0, 1);
    const qs = clamp(scoreSequenceQuality(tokens), 0, 1);
    const ws = clamp(scoreWorkflowCoverage(tokens), 0, 1);
    const ss = clamp(scoreSaveSignal(tokens), 0, 1);
    const ns = clamp(scoreNormalizationClean(tokens), 0, 1);

    // Weighted total, scaled to 0–100.
    const total = round2(
      cs * W_CONFIDENCE
      + qs * W_SEQUENCE
      + ws * W_COVERAGE
      + ss * W_SAVE
      + ns * W_CLEAN
    );
    const totalScore = clamp(total, 0, 100);

    return Object.freeze({
      valid: true,
      totalScore,
      confidenceScore:       round2(cs * 100),
      sequenceQualityScore:  round2(qs * 100),
      workflowCoverageScore: round2(ws * 100),
      saveSignalScore:       round2(ss * 100),
      normalizationScore:    round2(ns * 100),
      scoringTier:           deriveTier(totalScore),
      rejectionReason:       null,
    });
  } catch {
    return FAIL("scoring_error");
  }
}

// ── Public: deriveWorkflowScoringRisk ────────────────────────────────────────

/**
 * Classify the scoring risk of a raw entry without fully scoring it.
 * Highest applicable level wins. Pure, deterministic, never throws.
 */
export function deriveWorkflowScoringRisk(entry) {
  try {
    // ── Critical ─────────────────────────────────────────────────────────────
    if (!isPlainObject(entry))          return "critical";
    if (readConfidence(entry) < 0)      return "critical";
    const tokens = readSequence(entry);
    if (!tokens)                        return "critical";

    // ── High ─────────────────────────────────────────────────────────────────
    if (!tokens.some((t) => t.endsWith("_save"))) return "high";

    // Severe duplicate repetition: more than half the tokens are adjacent dups.
    let dups = 0;
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i] === tokens[i - 1]) dups++;
    }
    if (tokens.length > 1 && dups / (tokens.length - 1) >= 0.5) return "high";

    // ── Moderate ─────────────────────────────────────────────────────────────
    // Weak coverage: fewer than two known sections.
    const sections = SECTION_PREFIXES.filter((p) => tokens.some((t) => t.startsWith(p))).length;
    if (sections < 2) return "moderate";

    // Normalization cleanup required: tokens not already trimmed/lowercased.
    if (Array.isArray(entry.sequence)) {
      for (let i = 0; i < entry.sequence.length; i++) {
        const t = entry.sequence[i];
        if (typeof t === "string" && (t !== t.trim() || t !== t.toLowerCase())) {
          return "moderate";
        }
      }
    }

    // ── Low ──────────────────────────────────────────────────────────────────
    return "low";
  } catch {
    return "critical";
  }
}

// ── Public: summarizeWorkflowScoringHealth ────────────────────────────────────

/**
 * Aggregate scoring health across a registry.
 * Pure, deterministic, never throws. No side effects.
 */
export function summarizeWorkflowScoringHealth(registry) {
  const EMPTY = Object.freeze({
    totalEntries:    0,
    scoredEntries:   0,
    rejectedEntries: 0,
    averageScore:    0,
    eliteCount:      0,
    strongCount:     0,
    moderateCount:   0,
    weakCount:       0,
    rejectionRate:   0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    let scoredEntries   = 0;
    let rejectedEntries = 0;
    let scoreSum        = 0;
    let eliteCount      = 0;
    let strongCount     = 0;
    let moderateCount   = 0;
    let weakCount       = 0;

    for (let i = 0; i < list.length; i++) {
      const result = scoreWorkflowLearningEntry(list[i]);
      if (!result.valid) {
        rejectedEntries += 1;
        continue;
      }
      scoredEntries += 1;
      scoreSum      += result.totalScore;
      if (result.scoringTier === "elite")    eliteCount    += 1;
      else if (result.scoringTier === "strong")   strongCount   += 1;
      else if (result.scoringTier === "moderate") moderateCount += 1;
      else                                        weakCount     += 1;
    }

    const total         = scoredEntries + rejectedEntries;
    const averageScore  = scoredEntries > 0
      ? Math.round((scoreSum / scoredEntries) * 100) / 100
      : 0;
    const rejectionRate = total > 0
      ? Math.round((rejectedEntries / total) * 1000) / 1000
      : 0;

    return Object.freeze({
      totalEntries: total,
      scoredEntries,
      rejectedEntries,
      averageScore,
      eliteCount,
      strongCount,
      moderateCount,
      weakCount,
      rejectionRate,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: detectWorkflowScoringViolations ───────────────────────────────────

/**
 * Scan a registry for entries that violate scoring preconditions.
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectWorkflowScoringViolations(registry) {
  const EMPTY = Object.freeze({
    malformedEntries:          [],
    invalidConfidenceEntries:  [],
    emptySequenceEntries:      [],
    saveMissingEntries:        [],
    lowQualitySequences:       [],
    totalViolationCount:       0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const malformedEntries         = [];
    const invalidConfidenceEntries = [];
    const emptySequenceEntries     = [];
    const saveMissingEntries       = [];
    const lowQualitySequences      = [];

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const id  = (isPlainObject(raw) && typeof raw.registryId === "string" && raw.registryId.trim())
        ? raw.registryId.trim().slice(0, 120)
        : `(index ${i})`;

      if (!isPlainObject(raw)) {
        malformedEntries.push(id);
        continue;
      }

      if (readConfidence(raw) < 0)    invalidConfidenceEntries.push(id);

      const tokens = readSequence(raw);
      if (!tokens) {
        emptySequenceEntries.push(id);
        continue;
      }

      if (!tokens.some((t) => t.endsWith("_save"))) saveMissingEntries.push(id);

      // Low quality: score below the weak threshold.
      const result = scoreWorkflowLearningEntry(raw);
      if (result.valid && result.totalScore < TIER_WEAK) {
        lowQualitySequences.push(id);
      }
    }

    const totalViolationCount =
      malformedEntries.length
      + invalidConfidenceEntries.length
      + emptySequenceEntries.length
      + saveMissingEntries.length
      + lowQualitySequences.length;

    return Object.freeze({
      malformedEntries:          malformedEntries.sort(),
      invalidConfidenceEntries:  invalidConfidenceEntries.sort(),
      emptySequenceEntries:      emptySequenceEntries.sort(),
      saveMissingEntries:        saveMissingEntries.sort(),
      lowQualitySequences:       lowQualitySequences.sort(),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
