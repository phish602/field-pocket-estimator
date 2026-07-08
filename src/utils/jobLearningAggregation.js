// @ts-nocheck
/* eslint-disable */

// Standalone deterministic registry aggregation for the Job Learning system.
// No imports. No runtime wiring. No persistence. No side effects.

const MAX_REGISTRY_ENTRIES = 1000;
const MAX_TOP_FINGERPRINTS = 25;
const MAX_SEQUENCE_LENGTH  = 100;
const MAX_TOKEN_LENGTH     = 80;

// Known workflow classes (mirrors jobLearningClassification constants).
const WORKFLOW_CLASSES = [
  "invoice_flow", "full_estimate_flow", "scope_labor_save",
  "scope_materials_save", "scope_to_save", "scope_only", "unknown",
];

// Known scoring tiers (mirrors jobLearningScoring).
const SCORING_TIERS = ["elite", "strong", "moderate", "weak", "rejected"];

// Known risk levels (mirrors governance/scoring risk).
const RISK_LEVELS = ["low", "moderate", "high", "critical"];

// Section prefixes and signal suffixes for token inspection.
const SECTION_PREFIXES = ["scope_", "labor_", "materials_"];
const ASSIST_SUFFIXES  = ["_request", "_result", "_accept"];

// Confidence thresholds mirroring jobPatternRegistry.classifyPatternTier.
const CONF_HIGH    = 0.8;
const CONF_STABLE  = 0.6;

// Trend signal thresholds.
const MIN_ENTRIES_FOR_TREND    = 5;
const HIGH_RISK_RATE_THRESHOLD = 0.4;
const FRAGMENTED_THRESHOLD     = 0.6;  // >60% unknown/scope_only = fragmented
const REPEAT_SUCCESS_THRESHOLD = 0.5;  // >50% elite/strong = repeated success

// ── Private helpers ───────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function safeString(v, fallback) {
  const s = String(v ?? "").trim();
  return s || (fallback !== undefined ? fallback : "");
}

function clamp01(v) {
  const n = Number(v);
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

function round3(v) {
  return Math.round(Number(v) * 1000) / 1000;
}

// Normalize sequence tokens from an entry; returns null if unusable.
function readTokens(entry) {
  if (!Array.isArray(entry.sequence) || entry.sequence.length === 0) return null;
  const out = [];
  for (let i = 0; i < entry.sequence.length && out.length < MAX_SEQUENCE_LENGTH; i++) {
    if (typeof entry.sequence[i] !== "string") return null;
    const t = entry.sequence[i].trim().toLowerCase();
    if (!t || t.length > MAX_TOKEN_LENGTH) return null;
    out.push(t);
  }
  return out.length ? out : null;
}

// Infer workflow class from sequence tokens (deterministic, mirrors classification module).
function inferWorkflowClass(tokens) {
  if (!tokens || !tokens.length) return "unknown";
  const hasScope     = tokens.some((t) => t.startsWith("scope_"));
  const hasLabor     = tokens.some((t) => t.startsWith("labor_"));
  const hasMaterials = tokens.some((t) => t.startsWith("materials_"));
  const hasInvoice   = tokens.includes("invoice_save");
  const hasSave      = hasInvoice || tokens.some((t) => t.endsWith("_save"));
  if (hasInvoice)                                        return "invoice_flow";
  if (hasScope && hasLabor && hasMaterials && hasSave)   return "full_estimate_flow";
  if (hasScope && hasLabor && hasSave && !hasMaterials)  return "scope_labor_save";
  if (hasScope && hasMaterials && hasSave && !hasLabor)  return "scope_materials_save";
  if (hasScope && hasSave && !hasLabor && !hasMaterials) return "scope_to_save";
  if (hasScope && !hasSave)                              return "scope_only";
  return "unknown";
}

// Infer scoring tier from confidence (coarse, avoids full scoring pipeline).
function inferScoringTierFromConf(confidence) {
  if (!Number.isFinite(confidence) || confidence < 0) return "rejected";
  if (confidence >= CONF_HIGH)   return "elite";
  if (confidence >= CONF_STABLE) return "strong";
  if (confidence >= 0.4)         return "moderate";
  if (confidence >= 0)           return "weak";
  return "rejected";
}

// Infer risk level from tier and flags (coarse).
function inferRiskLevel(tier, reusable, approvedForRuntime) {
  if (reusable === true || approvedForRuntime === true) return "critical";
  if (tier === "unstable" || !WORKFLOW_CLASSES.includes(safeString(tier))) return "high";
  return "low";
}

// FNV-1a 32-bit — same implementation as sequence normalizer for consistency.
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function buildFingerprint(tokens) {
  if (!tokens || !tokens.length) return "seq_empty";
  return "seq_" + fnv1a32(tokens.join("|")) + "_l" + tokens.length;
}

// Increment a counter in a plain count map.
function inc(map, key) {
  map[key] = (map[key] || 0) + 1;
}

// Return the key with the highest count in a map; tie-breaks alphabetically.
function dominant(map) {
  let best = null;
  let bestCount = -1;
  for (const [k, v] of Object.entries(map)) {
    if (v > bestCount || (v === bestCount && (best === null || k < best))) {
      best = k; bestCount = v;
    }
  }
  return best || "unknown";
}

// ── Public: aggregateWorkflowRegistry ────────────────────────────────────────

/**
 * Aggregate registry entries into a structured analytics summary.
 * Ignores malformed entries safely. Deterministic, stable ordering.
 * Pure, never throws. No side effects.
 */
export function aggregateWorkflowRegistry(registry) {
  const EMPTY = Object.freeze({
    totalEntries:        0,
    workflowClassCounts: Object.freeze(Object.fromEntries(WORKFLOW_CLASSES.map((c) => [c, 0]))),
    scoringTierCounts:   Object.freeze(Object.fromEntries(SCORING_TIERS.map((t) => [t, 0]))),
    riskLevelCounts:     Object.freeze(Object.fromEntries(RISK_LEVELS.map((r) => [r, 0]))),
    saveSignalCount:     0,
    assistSignalCount:   0,
    sectionCounts:       Object.freeze({ scope: 0, labor: 0, materials: 0 }),
    topFingerprints:     Object.freeze([]),
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const workflowClassCounts = Object.fromEntries(WORKFLOW_CLASSES.map((c) => [c, 0]));
    const scoringTierCounts   = Object.fromEntries(SCORING_TIERS.map((t) => [t, 0]));
    const riskLevelCounts     = Object.fromEntries(RISK_LEVELS.map((r) => [r, 0]));
    const sectionCounts       = { scope: 0, labor: 0, materials: 0 };
    const fingerprintFreq     = new Map(); // fingerprint → { fingerprint, count, tier }
    let saveSignalCount   = 0;
    let assistSignalCount = 0;

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      if (!isPlainObject(raw)) continue;

      const tokens     = readTokens(raw);
      const confidence = Number(raw.confidence);
      const confValid  = Number.isFinite(confidence) && confidence >= 0 && confidence <= 1;
      const tier       = safeString(raw.tier, "unstable");

      // Workflow class — from stored field or inferred from tokens.
      const storedClass = safeString(raw.workflowClass);
      const wfClass = WORKFLOW_CLASSES.includes(storedClass)
        ? storedClass
        : (tokens ? inferWorkflowClass(tokens) : "unknown");
      inc(workflowClassCounts, wfClass);

      // Scoring tier — from stored field or inferred from confidence.
      const storedTier = safeString(raw.scoringTier);
      const sTier = SCORING_TIERS.includes(storedTier)
        ? storedTier
        : (confValid ? inferScoringTierFromConf(confidence) : "rejected");
      inc(scoringTierCounts, sTier);

      // Risk level — from stored field or inferred from governance flags.
      const storedRisk = safeString(raw.riskLevel);
      const rLevel = RISK_LEVELS.includes(storedRisk)
        ? storedRisk
        : inferRiskLevel(tier, raw.reusable, raw.approvedForRuntime);
      inc(riskLevelCounts, rLevel);

      if (tokens) {
        // Save signal.
        if (tokens.some((t) => t.endsWith("_save"))) saveSignalCount += 1;

        // Assist signal: any assist seam token present.
        if (ASSIST_SUFFIXES.some((s) => tokens.some((t) => t.endsWith(s)))) assistSignalCount += 1;

        // Section coverage.
        if (tokens.some((t) => t.startsWith("scope_")))     sectionCounts.scope     += 1;
        if (tokens.some((t) => t.startsWith("labor_")))     sectionCounts.labor     += 1;
        if (tokens.some((t) => t.startsWith("materials_"))) sectionCounts.materials += 1;

        // Fingerprint frequency.
        const fp = typeof raw.fingerprint === "string" && raw.fingerprint.startsWith("seq_")
          ? raw.fingerprint
          : buildFingerprint(tokens);

        if (!fingerprintFreq.has(fp)) {
          fingerprintFreq.set(fp, { fingerprint: fp, count: 0, tier: sTier });
        }
        fingerprintFreq.get(fp).count += 1;
      }
    }

    // Top fingerprints: sorted descending by count, then ascending by fingerprint string.
    const topFingerprints = [...fingerprintFreq.values()]
      .sort((a, b) => b.count !== a.count ? b.count - a.count : a.fingerprint.localeCompare(b.fingerprint))
      .slice(0, MAX_TOP_FINGERPRINTS)
      .map((f) => Object.freeze({ fingerprint: f.fingerprint, count: f.count, tier: f.tier }));

    return Object.freeze({
      totalEntries:        list.length,
      workflowClassCounts: Object.freeze(workflowClassCounts),
      scoringTierCounts:   Object.freeze(scoringTierCounts),
      riskLevelCounts:     Object.freeze(riskLevelCounts),
      saveSignalCount,
      assistSignalCount,
      sectionCounts:       Object.freeze(sectionCounts),
      topFingerprints:     Object.freeze(topFingerprints),
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: deriveRegistryTrendSignal ─────────────────────────────────────────

/**
 * Derive a trend signal from aggregated registry data.
 * Deterministic thresholds only. No AI/fuzzy logic.
 * Pure, never throws. No side effects.
 */
export function deriveRegistryTrendSignal(registry) {
  const EMPTY = Object.freeze({ signal: "insufficient_data", confidence: 0, reason: "no_entries" });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const agg = aggregateWorkflowRegistry(list);
    if (agg.totalEntries < MIN_ENTRIES_FOR_TREND) {
      return Object.freeze({ signal: "insufficient_data", confidence: 0, reason: "below_minimum_entries" });
    }

    const total = agg.totalEntries;

    // High risk: many critical/high-risk entries.
    const highRiskEntries = (agg.riskLevelCounts.critical || 0) + (agg.riskLevelCounts.high || 0);
    const highRiskRate    = highRiskEntries / total;
    if (highRiskRate >= HIGH_RISK_RATE_THRESHOLD) {
      return Object.freeze({
        signal:     "high_risk_registry",
        confidence: round3(clamp01(highRiskRate)),
        reason:     "high_or_critical_risk_rate_exceeds_threshold",
      });
    }

    // Fragmented: most entries are unknown or scope_only (no meaningful coverage).
    const fragmentedEntries = (agg.workflowClassCounts.unknown || 0) + (agg.workflowClassCounts.scope_only || 0);
    const fragmentedRate    = fragmentedEntries / total;
    if (fragmentedRate >= FRAGMENTED_THRESHOLD) {
      return Object.freeze({
        signal:     "fragmented_workflows",
        confidence: round3(clamp01(fragmentedRate)),
        reason:     "unknown_or_scope_only_rate_exceeds_threshold",
      });
    }

    // Repeated success: majority elite/strong scoring.
    const successEntries = (agg.scoringTierCounts.elite || 0) + (agg.scoringTierCounts.strong || 0);
    const successRate    = successEntries / total;
    if (successRate >= REPEAT_SUCCESS_THRESHOLD) {
      return Object.freeze({
        signal:     "repeated_success_pattern",
        confidence: round3(clamp01(successRate)),
        reason:     "elite_or_strong_tier_rate_exceeds_threshold",
      });
    }

    // Healthy: save signal coverage ≥ 50% and low risk.
    const saveRate = total > 0 ? agg.saveSignalCount / total : 0;
    if (saveRate >= 0.5 && highRiskRate < 0.2) {
      return Object.freeze({
        signal:     "healthy_registry",
        confidence: round3(clamp01((saveRate + (1 - highRiskRate)) / 2)),
        reason:     "adequate_save_coverage_and_low_risk",
      });
    }

    // Default: insufficient signal to determine a clear trend.
    return Object.freeze({
      signal:     "insufficient_data",
      confidence: round3(clamp01(successRate + saveRate) / 2),
      reason:     "no_dominant_trend_detected",
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: summarizeRegistryAggregationHealth ────────────────────────────────

/**
 * Summarize registry aggregation health in a single normalized view.
 * Pure, never throws. No side effects.
 */
export function summarizeRegistryAggregationHealth(registry) {
  const EMPTY = Object.freeze({
    totalEntries:          0,
    analyzedEntries:       0,
    malformedEntries:      0,
    dominantWorkflowClass: "unknown",
    dominantScoringTier:   "rejected",
    dominantRiskLevel:     "high",
    saveSignalCoverage:    0,
    assistSignalCoverage:  0,
    sectionCoverage:       Object.freeze({ scope: 0, labor: 0, materials: 0 }),
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const malformedEntries = list.filter((e) => !isPlainObject(e)).length;
    const analyzedEntries  = list.length - malformedEntries;

    const agg = aggregateWorkflowRegistry(list);
    const total = analyzedEntries || 1; // avoid divide-by-zero

    const saveSignalCoverage   = round3(clamp01(agg.saveSignalCount   / total));
    const assistSignalCoverage = round3(clamp01(agg.assistSignalCount / total));
    const sectionCoverage      = Object.freeze({
      scope:     round3(clamp01(agg.sectionCounts.scope     / total)),
      labor:     round3(clamp01(agg.sectionCounts.labor     / total)),
      materials: round3(clamp01(agg.sectionCounts.materials / total)),
    });

    return Object.freeze({
      totalEntries:          list.length,
      analyzedEntries,
      malformedEntries,
      dominantWorkflowClass: dominant(agg.workflowClassCounts),
      dominantScoringTier:   dominant(agg.scoringTierCounts),
      dominantRiskLevel:     dominant(agg.riskLevelCounts),
      saveSignalCoverage,
      assistSignalCoverage,
      sectionCoverage,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: detectRegistryAggregationViolations ───────────────────────────────

/**
 * Scan a registry for entries missing fields required for clean aggregation.
 * Pure, never throws. No side effects. No mutations.
 */
export function detectRegistryAggregationViolations(registry) {
  const EMPTY = Object.freeze({
    malformedEntries:           [],
    missingFingerprintEntries:  [],
    missingSequenceEntries:     [],
    missingWorkflowClassEntries: [],
    missingScoringTierEntries:  [],
    missingRiskLevelEntries:    [],
    totalViolationCount:        0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const malformedEntries            = [];
    const missingFingerprintEntries   = [];
    const missingSequenceEntries      = [];
    const missingWorkflowClassEntries = [];
    const missingScoringTierEntries   = [];
    const missingRiskLevelEntries     = [];

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const id  = (isPlainObject(raw) && typeof raw.registryId === "string" && raw.registryId.trim())
        ? raw.registryId.trim().slice(0, 120)
        : "(index " + i + ")";

      if (!isPlainObject(raw)) {
        malformedEntries.push(id);
        continue;
      }

      if (!(typeof raw.fingerprint === "string" && raw.fingerprint.startsWith("seq_"))) {
        missingFingerprintEntries.push(id);
      }

      if (!Array.isArray(raw.sequence) || raw.sequence.length === 0) {
        missingSequenceEntries.push(id);
      }

      if (!WORKFLOW_CLASSES.includes(safeString(raw.workflowClass))) {
        missingWorkflowClassEntries.push(id);
      }

      if (!SCORING_TIERS.includes(safeString(raw.scoringTier))) {
        missingScoringTierEntries.push(id);
      }

      if (!RISK_LEVELS.includes(safeString(raw.riskLevel))) {
        missingRiskLevelEntries.push(id);
      }
    }

    const totalViolationCount =
      malformedEntries.length
      + missingFingerprintEntries.length
      + missingSequenceEntries.length
      + missingWorkflowClassEntries.length
      + missingScoringTierEntries.length
      + missingRiskLevelEntries.length;

    return Object.freeze({
      malformedEntries:            malformedEntries.sort(),
      missingFingerprintEntries:   missingFingerprintEntries.sort(),
      missingSequenceEntries:      missingSequenceEntries.sort(),
      missingWorkflowClassEntries: missingWorkflowClassEntries.sort(),
      missingScoringTierEntries:   missingScoringTierEntries.sort(),
      missingRiskLevelEntries:     missingRiskLevelEntries.sort(),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
