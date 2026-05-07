// @ts-nocheck
/* eslint-disable */

// Standalone deterministic snapshot/audit utility for the Job Learning system.
// No imports. No runtime wiring. No persistence. No side effects.

const MAX_REGISTRY_ENTRIES = 1000;
const MIN_ENTRIES_FOR_SIGNAL = 3;

// Drift thresholds (fingerprint churn ratio).
const DRIFT_LOW_THRESHOLD      = 0.05;
const DRIFT_MODERATE_THRESHOLD = 0.15;
const DRIFT_HIGH_THRESHOLD     = 0.30;

// ── Private helpers ───────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
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

// Normalize tokens from an entry's sequence field.
function readTokens(entry) {
  if (!isPlainObject(entry) || !Array.isArray(entry.sequence)) return null;
  const out = [];
  for (let i = 0; i < entry.sequence.length; i++) {
    if (typeof entry.sequence[i] !== "string") return null;
    const t = entry.sequence[i].trim().toLowerCase();
    if (!t) return null;
    out.push(t);
  }
  return out.length ? out : null;
}

// Infer workflow class from token sequence (mirrors classification module logic).
function inferWorkflowClass(tokens) {
  if (!tokens || !tokens.length) return "unknown";
  const hasInvoiceSave  = tokens.some((t) => t === "invoice_save");
  const hasEstimateSave = tokens.some((t) => t === "estimate_save");
  const hasScope     = tokens.some((t) => t.startsWith("scope_"));
  const hasLabor     = tokens.some((t) => t.startsWith("labor_"));
  const hasMaterials = tokens.some((t) => t.startsWith("materials_"));
  const hasSave      = tokens.some((t) => t.endsWith("_save"));
  if (hasInvoiceSave  && hasScope)                        return "invoice_flow";
  if (hasEstimateSave && hasScope && (hasLabor || hasMaterials)) return "full_estimate_flow";
  if (hasScope && hasLabor     && hasSave)                return "scope_labor_save";
  if (hasScope && hasMaterials && hasSave)                return "scope_materials_save";
  if (hasScope && hasSave)                                return "scope_to_save";
  if (hasScope)                                           return "scope_only";
  return "unknown";
}

// Coarse scoring tier from raw confidence.
function inferScoringTier(confidence) {
  const c = Number(confidence);
  if (!Number.isFinite(c) || c < 0 || c > 1) return "rejected";
  if (c >= 0.8) return "elite";
  if (c >= 0.6) return "strong";
  if (c >= 0.4) return "moderate";
  if (c >  0)   return "weak";
  return "rejected";
}

// Coarse risk level for a single entry (no external imports).
function inferRiskLevel(entry) {
  if (!isPlainObject(entry)) return "critical";
  const conf = Number(entry.confidence);
  if (!Number.isFinite(conf) || conf < 0 || conf > 1) return "critical";
  const tokens = readTokens(entry);
  if (!tokens) return "critical";
  if (!tokens.some((t) => t.endsWith("_save"))) return "high";
  let dups = 0;
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] === tokens[i - 1]) dups++;
  }
  if (tokens.length > 1 && dups / (tokens.length - 1) >= 0.5) return "high";
  if (conf < 0.4) return "moderate";
  if (inferWorkflowClass(tokens) === "unknown") return "moderate";
  return "low";
}

// Read or build a deterministic fingerprint for a registry entry.
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

// Build a deterministic snapshotId from fingerprint counts and valid entry count.
function buildSnapshotId(fingerprintCounts, validCount) {
  const keys = Object.keys(fingerprintCounts).sort();
  const parts = [String(validCount)];
  for (let i = 0; i < keys.length; i++) {
    parts.push(keys[i] + ":" + fingerprintCounts[keys[i]]);
  }
  return "snap_" + fnv1a32(parts.join("|")) + "_e" + validCount;
}

// Increment a key in a plain count map.
function inc(map, key) {
  const k = String(key);
  map[k] = (map[k] || 0) + 1;
}

// Build a delta map: keys present in either map with non-zero difference.
function countMapDelta(prev, curr) {
  const delta   = {};
  const allKeys = new Set([...Object.keys(prev || {}), ...Object.keys(curr || {})]);
  for (const k of allKeys) {
    const d = (curr[k] || 0) - (prev[k] || 0);
    if (d !== 0) delta[k] = d;
  }
  return delta;
}

// Fingerprint churn ratio: changed / union-of-unique-fingerprints.
function computeChurn(added, removed, changed, prevUnique) {
  const union = Math.max(1, prevUnique + added);
  return clamp((added + removed + changed) / union, 0, 1);
}

// ── Public: createLearningRegistrySnapshot ────────────────────────────────────

/**
 * Build an immutable, deterministic snapshot of a registry's aggregate learning state.
 * snapshotId is a pure FNV-1a hash of sorted fingerprint counts — no Date/randomness.
 * Pure, deterministic, never throws. No side effects.
 */
export function createLearningRegistrySnapshot(registry) {
  const FAIL = (rejectionReason) => Object.freeze({
    valid:               false,
    snapshotId:          "snap_rejected",
    totalEntries:        0,
    fingerprintCounts:   Object.freeze({}),
    workflowClassCounts: Object.freeze({}),
    scoringTierCounts:   Object.freeze({}),
    riskLevelCounts:     Object.freeze({}),
    saveSignalCoverage:  0,
    malformedCount:      0,
    rejectionReason,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return FAIL("empty_registry");

    const fingerprintCounts   = {};
    const workflowClassCounts = {};
    const scoringTierCounts   = {};
    const riskLevelCounts     = {};
    let malformedCount  = 0;
    let saveSignalCount = 0;
    let validCount      = 0;

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      if (!isPlainObject(raw)) { malformedCount++; continue; }

      const tokens = readTokens(raw);
      if (!tokens) { malformedCount++; continue; }

      validCount++;

      const fp = readFingerprint(raw) || "seq_unknown";

      const workflowClass =
        typeof raw.workflowClass === "string" && raw.workflowClass.trim()
          ? raw.workflowClass.trim()
          : inferWorkflowClass(tokens);

      const scoringTier =
        typeof raw.scoringTier === "string" && raw.scoringTier.trim()
          ? raw.scoringTier.trim()
          : inferScoringTier(raw.confidence);

      const riskLevel =
        typeof raw.riskLevel === "string" && raw.riskLevel.trim()
          ? raw.riskLevel.trim()
          : inferRiskLevel(raw);

      inc(fingerprintCounts, fp);
      inc(workflowClassCounts, workflowClass);
      inc(scoringTierCounts, scoringTier);
      inc(riskLevelCounts, riskLevel);

      if (tokens.some((t) => t.endsWith("_save"))) saveSignalCount++;
    }

    const totalEntries      = validCount + malformedCount;
    const saveSignalCoverage = validCount > 0
      ? Math.round((saveSignalCount / validCount) * 1000) / 1000
      : 0;
    const snapshotId = buildSnapshotId(fingerprintCounts, validCount);

    return Object.freeze({
      valid:               true,
      snapshotId,
      totalEntries,
      fingerprintCounts:   Object.freeze(fingerprintCounts),
      workflowClassCounts: Object.freeze(workflowClassCounts),
      scoringTierCounts:   Object.freeze(scoringTierCounts),
      riskLevelCounts:     Object.freeze(riskLevelCounts),
      saveSignalCoverage,
      malformedCount,
      rejectionReason:     null,
    });
  } catch {
    return FAIL("snapshot_error");
  }
}

// ── Public: compareLearningRegistrySnapshots ──────────────────────────────────

/**
 * Compare two registry snapshots and report fingerprint drift and distribution deltas.
 * driftLevel is derived from fingerprint churn ratio relative to previous snapshot.
 * Pure, deterministic, never throws. No side effects.
 */
export function compareLearningRegistrySnapshots(previousSnapshot, currentSnapshot) {
  const FAIL = (rejectionReason) => Object.freeze({
    valid:                   false,
    addedFingerprints:       Object.freeze([]),
    removedFingerprints:     Object.freeze([]),
    changedFingerprints:     Object.freeze([]),
    workflowClassDelta:      Object.freeze({}),
    scoringTierDelta:        Object.freeze({}),
    riskLevelDelta:          Object.freeze({}),
    saveSignalCoverageDelta: 0,
    driftLevel:              "none",
    rejectionReason,
  });

  try {
    if (!isPlainObject(previousSnapshot) || !previousSnapshot.valid) return FAIL("invalid_previous_snapshot");
    if (!isPlainObject(currentSnapshot)  || !currentSnapshot.valid)  return FAIL("invalid_current_snapshot");

    const prevFp = isPlainObject(previousSnapshot.fingerprintCounts) ? previousSnapshot.fingerprintCounts : {};
    const currFp = isPlainObject(currentSnapshot.fingerprintCounts)  ? currentSnapshot.fingerprintCounts  : {};

    const prevKeys = new Set(Object.keys(prevFp));
    const currKeys = new Set(Object.keys(currFp));

    const addedFingerprints   = [];
    const removedFingerprints = [];
    const changedFingerprints = [];

    for (const k of currKeys) {
      if (!prevKeys.has(k)) addedFingerprints.push(k);
      else if (currFp[k] !== prevFp[k]) changedFingerprints.push(k);
    }
    for (const k of prevKeys) {
      if (!currKeys.has(k)) removedFingerprints.push(k);
    }

    addedFingerprints.sort();
    removedFingerprints.sort();
    changedFingerprints.sort();

    const workflowClassDelta = countMapDelta(
      isPlainObject(previousSnapshot.workflowClassCounts) ? previousSnapshot.workflowClassCounts : {},
      isPlainObject(currentSnapshot.workflowClassCounts)  ? currentSnapshot.workflowClassCounts  : {},
    );
    const scoringTierDelta = countMapDelta(
      isPlainObject(previousSnapshot.scoringTierCounts) ? previousSnapshot.scoringTierCounts : {},
      isPlainObject(currentSnapshot.scoringTierCounts)  ? currentSnapshot.scoringTierCounts  : {},
    );
    const riskLevelDelta = countMapDelta(
      isPlainObject(previousSnapshot.riskLevelCounts) ? previousSnapshot.riskLevelCounts : {},
      isPlainObject(currentSnapshot.riskLevelCounts)  ? currentSnapshot.riskLevelCounts  : {},
    );

    const saveSignalCoverageDelta = Math.round(
      ((Number(currentSnapshot.saveSignalCoverage) || 0) - (Number(previousSnapshot.saveSignalCoverage) || 0)) * 1000
    ) / 1000;

    const prevUnique = prevKeys.size;
    const churn = computeChurn(
      addedFingerprints.length,
      removedFingerprints.length,
      changedFingerprints.length,
      prevUnique,
    );

    let driftLevel;
    if (
      churn === 0 &&
      saveSignalCoverageDelta === 0 &&
      Object.keys(workflowClassDelta).length === 0
    ) {
      driftLevel = "none";
    } else if (churn < DRIFT_LOW_THRESHOLD) {
      driftLevel = "low";
    } else if (churn < DRIFT_MODERATE_THRESHOLD) {
      driftLevel = "moderate";
    } else if (churn < DRIFT_HIGH_THRESHOLD) {
      driftLevel = "high";
    } else {
      driftLevel = "critical";
    }

    return Object.freeze({
      valid:                   true,
      addedFingerprints:       Object.freeze(addedFingerprints),
      removedFingerprints:     Object.freeze(removedFingerprints),
      changedFingerprints:     Object.freeze(changedFingerprints),
      workflowClassDelta:      Object.freeze(workflowClassDelta),
      scoringTierDelta:        Object.freeze(scoringTierDelta),
      riskLevelDelta:          Object.freeze(riskLevelDelta),
      saveSignalCoverageDelta,
      driftLevel,
      rejectionReason:         null,
    });
  } catch {
    return FAIL("comparison_error");
  }
}

// ── Public: deriveLearningAuditSignal ─────────────────────────────────────────

/**
 * Derive an advisory audit signal from two registry snapshots.
 * Signal priority (highest first): risk_spike > workflow_fragmentation >
 *   quality_regression > positive_quality_trend > stable_learning_profile.
 * Pure, deterministic, never throws. No side effects.
 */
export function deriveLearningAuditSignal(previousSnapshot, currentSnapshot) {
  const INSUFFICIENT = Object.freeze({
    signal:     "insufficient_data",
    confidence: 0,
    reason:     "invalid_or_missing_snapshots",
  });

  try {
    if (!isPlainObject(previousSnapshot) || !previousSnapshot.valid) return INSUFFICIENT;
    if (!isPlainObject(currentSnapshot)  || !currentSnapshot.valid)  return INSUFFICIENT;

    const prevTotal = Number(previousSnapshot.totalEntries) || 0;
    const currTotal = Number(currentSnapshot.totalEntries)  || 0;
    if (prevTotal < MIN_ENTRIES_FOR_SIGNAL || currTotal < MIN_ENTRIES_FOR_SIGNAL) {
      return Object.freeze({ signal: "insufficient_data", confidence: 0.3, reason: "too_few_entries" });
    }

    const comparison = compareLearningRegistrySnapshots(previousSnapshot, currentSnapshot);
    if (!comparison.valid) return INSUFFICIENT;

    const currRisk  = isPlainObject(currentSnapshot.riskLevelCounts)   ? currentSnapshot.riskLevelCounts   : {};
    const prevRisk  = isPlainObject(previousSnapshot.riskLevelCounts)  ? previousSnapshot.riskLevelCounts  : {};
    const currTier  = isPlainObject(currentSnapshot.scoringTierCounts) ? currentSnapshot.scoringTierCounts : {};
    const prevTier  = isPlainObject(previousSnapshot.scoringTierCounts)? previousSnapshot.scoringTierCounts: {};
    const currClass = isPlainObject(currentSnapshot.workflowClassCounts)? currentSnapshot.workflowClassCounts: {};

    const currCriticalRisk = (currRisk.critical || 0) + (currRisk.high || 0);
    const prevCriticalRisk = (prevRisk.critical  || 0) + (prevRisk.high  || 0);
    const currElite        = (currTier.elite || 0) + (currTier.strong || 0);
    const prevElite        = (prevTier.elite || 0) + (prevTier.strong || 0);

    const currClassTotal  = Object.values(currClass).reduce((a, b) => a + b, 0) || 1;
    const currUnknown     = (currClass.unknown || 0) + (currClass.scope_only || 0);
    const fragmentedRate  = currUnknown / currClassTotal;
    const highRiskRate    = currTotal > 0 ? currCriticalRisk / currTotal : 0;

    // ── Signal priority ──────────────────────────────────────────────────────

    if (highRiskRate >= 0.4 && currCriticalRisk > prevCriticalRisk) {
      return Object.freeze({
        signal:     "risk_spike",
        confidence: clamp(0.5 + highRiskRate * 0.4, 0, 0.95),
        reason:     "critical_and_high_risk_rate_elevated",
      });
    }

    if (fragmentedRate >= 0.6) {
      return Object.freeze({
        signal:     "workflow_fragmentation",
        confidence: clamp(0.4 + fragmentedRate * 0.4, 0, 0.95),
        reason:     "high_unknown_workflow_proportion",
      });
    }

    if (currElite < prevElite && currCriticalRisk > prevCriticalRisk) {
      return Object.freeze({
        signal:     "quality_regression",
        confidence: 0.65,
        reason:     "elite_strong_count_down_risk_count_up",
      });
    }

    if (currElite > prevElite && currCriticalRisk <= prevCriticalRisk) {
      return Object.freeze({
        signal:     "positive_quality_trend",
        confidence: clamp(0.5 + (currElite - prevElite) / Math.max(1, currTotal) * 2, 0, 0.9),
        reason:     "elite_strong_count_grew",
      });
    }

    if (comparison.driftLevel === "none" || comparison.driftLevel === "low") {
      return Object.freeze({
        signal:     "stable_learning_profile",
        confidence: 0.75,
        reason:     "low_drift_stable_distribution",
      });
    }

    return Object.freeze({
      signal:     "stable_learning_profile",
      confidence: 0.5,
      reason:     "no_dominant_signal",
    });
  } catch {
    return INSUFFICIENT;
  }
}

// ── Public: detectLearningSnapshotViolations ──────────────────────────────────

/**
 * Inspect a snapshot object for structural and invariant violations.
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectLearningSnapshotViolations(snapshot) {
  const EMPTY = Object.freeze({
    malformedSnapshot:      Object.freeze([]),
    missingSnapshotId:      Object.freeze([]),
    invalidCountMaps:       Object.freeze([]),
    invalidCoverageMetrics: Object.freeze([]),
    suspiciousRuntimeFlags: Object.freeze([]),
    totalViolationCount:    0,
  });

  try {
    if (!isPlainObject(snapshot)) {
      return Object.freeze({
        malformedSnapshot:      Object.freeze(["non_object_snapshot"]),
        missingSnapshotId:      Object.freeze([]),
        invalidCountMaps:       Object.freeze([]),
        invalidCoverageMetrics: Object.freeze([]),
        suspiciousRuntimeFlags: Object.freeze([]),
        totalViolationCount:    1,
      });
    }

    const malformedSnapshot      = [];
    const missingSnapshotId      = [];
    const invalidCountMaps       = [];
    const invalidCoverageMetrics = [];
    const suspiciousRuntimeFlags = [];

    // Structural fields.
    if (snapshot.valid !== true && snapshot.valid !== false) {
      malformedSnapshot.push("missing_valid_field");
    }
    if (
      typeof snapshot.totalEntries !== "number" ||
      !Number.isFinite(snapshot.totalEntries) ||
      snapshot.totalEntries < 0
    ) {
      malformedSnapshot.push("invalid_total_entries");
    }
    if (
      typeof snapshot.malformedCount !== "number" ||
      !Number.isFinite(snapshot.malformedCount) ||
      snapshot.malformedCount < 0
    ) {
      malformedSnapshot.push("invalid_malformed_count");
    }

    // snapshotId.
    if (
      typeof snapshot.snapshotId !== "string" ||
      !snapshot.snapshotId.startsWith("snap_")
    ) {
      missingSnapshotId.push("invalid_snapshot_id_format");
    }

    // Count maps — must be plain objects with non-negative integer values.
    const COUNT_MAP_FIELDS = ["fingerprintCounts", "workflowClassCounts", "scoringTierCounts", "riskLevelCounts"];
    for (let i = 0; i < COUNT_MAP_FIELDS.length; i++) {
      const field = COUNT_MAP_FIELDS[i];
      const v = snapshot[field];
      if (!isPlainObject(v)) {
        invalidCountMaps.push(field + "_not_object");
        continue;
      }
      const vals = Object.values(v);
      let nonInteger = false;
      for (let j = 0; j < vals.length; j++) {
        if (!Number.isFinite(vals[j]) || vals[j] < 0 || Math.floor(vals[j]) !== vals[j]) {
          nonInteger = true;
          break;
        }
      }
      if (nonInteger) invalidCountMaps.push(field + "_non_integer_value");
    }

    // Coverage metrics.
    const cov = snapshot.saveSignalCoverage;
    if (typeof cov !== "number" || !Number.isFinite(cov) || cov < 0 || cov > 1) {
      invalidCoverageMetrics.push("save_signal_coverage_out_of_range");
    }

    // Runtime flags must never appear on a snapshot object.
    if ("reusable" in snapshot) {
      suspiciousRuntimeFlags.push(
        snapshot.reusable === true
          ? "reusable_flag_set_true"
          : "reusable_field_present_on_snapshot",
      );
    }
    if ("approvedForRuntime" in snapshot) {
      suspiciousRuntimeFlags.push(
        snapshot.approvedForRuntime === true
          ? "approved_for_runtime_flag_set_true"
          : "approved_for_runtime_field_present_on_snapshot",
      );
    }

    const totalViolationCount =
      malformedSnapshot.length
      + missingSnapshotId.length
      + invalidCountMaps.length
      + invalidCoverageMetrics.length
      + suspiciousRuntimeFlags.length;

    return Object.freeze({
      malformedSnapshot:      Object.freeze(malformedSnapshot.sort()),
      missingSnapshotId:      Object.freeze(missingSnapshotId.sort()),
      invalidCountMaps:       Object.freeze(invalidCountMaps.sort()),
      invalidCoverageMetrics: Object.freeze(invalidCoverageMetrics.sort()),
      suspiciousRuntimeFlags: Object.freeze(suspiciousRuntimeFlags.sort()),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
