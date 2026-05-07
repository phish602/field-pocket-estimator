// @ts-nocheck
/* eslint-disable */

// Standalone runtime isolation gate for the Job Learning system.
// No imports. No runtime wiring. Advisory/quarantine layer only.
// This utility MUST remain inert — it evaluates entries but never activates them.

const MAX_REGISTRY_ENTRIES = 1000;
const MAX_SEQUENCE_LENGTH  = 6;

// Confidence threshold for runtime eligibility is deliberately stricter than
// the governance module's promotion threshold (0.9 vs 0.8).
const CONFIDENCE_RUNTIME_THRESHOLD = 0.9;
const TIER_HIGH_CONFIDENCE = "high_confidence";

// Isolation reasons, in evaluation priority order.
const REASON_MALFORMED          = "malformed_entry";
const REASON_REUSABLE_DISABLED  = "reusable_disabled";
const REASON_NOT_APPROVED       = "runtime_not_approved";
const REASON_INSUFFICIENT_TIER  = "insufficient_tier";
const REASON_LOW_CONFIDENCE     = "insufficient_confidence";
const REASON_EMPTY_SEQUENCE     = "empty_sequence";
const REASON_NO_SAVE_SIGNAL     = "missing_save_signal";
const REASON_ELIGIBLE           = "runtime_eligible";

// ── Private helpers ───────────────────────────────────────────────────────────

function safeString(value, fallback) {
  const text = String(value ?? "").trim();
  return text || (fallback !== undefined ? fallback : "");
}

function safeNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : (fallback !== undefined ? fallback : 0);
}

function roundMetric(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 1000) / 1000;
}

function clamp(value, min, max) {
  const lo = min !== undefined ? min : 0;
  const hi = max !== undefined ? max : 1;
  return Math.min(hi, Math.max(lo, Number.isFinite(value) ? value : lo));
}

// Returns a bounded, cleaned copy of a sequence array. Never throws.
function normalizeSequence(sequence) {
  if (!Array.isArray(sequence)) return [];
  const out = [];
  for (let i = 0; i < sequence.length && out.length < MAX_SEQUENCE_LENGTH; i++) {
    const token = safeString(sequence[i]);
    if (token) out.push(token);
  }
  return out;
}

// True when at least one token in the sequence ends with "_save".
function sequenceHasSaveSignal(sequence) {
  for (let i = 0; i < sequence.length; i++) {
    if (sequence[i].endsWith("_save")) return true;
  }
  return false;
}

// Returns a frozen, normalized read-only copy of an entry for evaluation.
// Returns null when the raw entry is structurally unusable.
function freezeEntry(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const sequence = normalizeSequence(raw.sequence);
  return Object.freeze({
    registryId:         safeString(raw.registryId, "unknown"),
    tier:               safeString(raw.tier, "unstable"),
    confidence:         roundMetric(clamp(safeNumber(raw.confidence, 0))),
    frequency:          Math.max(0, Math.floor(safeNumber(raw.frequency, 0))),
    reusable:           raw.reusable === true,
    approvedForRuntime: raw.approvedForRuntime === true,
    sequence:           Object.freeze(sequence),
  });
}

// ── Public: canRuntimeUseRegistryEntry ───────────────────────────────────────

/**
 * Single authoritative gate: may this registry entry affect runtime behavior?
 *
 * Returns true ONLY when ALL seven conditions hold simultaneously.
 * Fails closed on every malformed, partial, or borderline input.
 * Pure, deterministic, never throws. No side effects.
 */
export function canRuntimeUseRegistryEntry(entry) {
  try {
    const e = freezeEntry(entry);
    if (!e) return false;
    return (
      e.reusable           === true
      && e.approvedForRuntime === true
      && e.tier              === TIER_HIGH_CONFIDENCE
      && e.confidence        >= CONFIDENCE_RUNTIME_THRESHOLD
      && e.sequence.length   > 0
      && sequenceHasSaveSignal(e.sequence)
    );
  } catch {
    return false;
  }
}

// ── Public: deriveRuntimeIsolationState ──────────────────────────────────────

/**
 * Explain why an entry is isolated (or the single path to eligibility).
 * Checks run in strict priority order — first failure wins.
 * isolated=true for every reason except "runtime_eligible".
 * Pure, deterministic, never throws. No side effects.
 */
export function deriveRuntimeIsolationState(entry) {
  const ISOLATED = (reason) => Object.freeze({ isolated: true,  reason });
  const ELIGIBLE  =           Object.freeze({ isolated: false, reason: REASON_ELIGIBLE });

  try {
    const e = freezeEntry(entry);
    if (!e)                                          return ISOLATED(REASON_MALFORMED);
    if (!e.reusable)                                 return ISOLATED(REASON_REUSABLE_DISABLED);
    if (!e.approvedForRuntime)                       return ISOLATED(REASON_NOT_APPROVED);
    if (e.tier !== TIER_HIGH_CONFIDENCE)             return ISOLATED(REASON_INSUFFICIENT_TIER);
    if (e.confidence < CONFIDENCE_RUNTIME_THRESHOLD) return ISOLATED(REASON_LOW_CONFIDENCE);
    if (e.sequence.length === 0)                     return ISOLATED(REASON_EMPTY_SEQUENCE);
    if (!sequenceHasSaveSignal(e.sequence))          return ISOLATED(REASON_NO_SAVE_SIGNAL);
    return ELIGIBLE;
  } catch {
    return ISOLATED(REASON_MALFORMED);
  }
}

// ── Public: summarizeRuntimeIsolationHealth ───────────────────────────────────

/**
 * Aggregate isolation metrics across an entire registry.
 * All rates are in [0, 1], rounded to 3 decimal places.
 * Pure, deterministic, never throws. No side effects.
 */
export function summarizeRuntimeIsolationHealth(registry) {
  const EMPTY = Object.freeze({
    totalEntries:          0,
    isolatedEntries:       0,
    runtimeEligibleEntries: 0,
    approvalRate:          0,
    isolationRate:         0,
    saveSignalCoverage:    0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    let isolatedEntries        = 0;
    let runtimeEligibleEntries = 0;
    let entriesWithSaveSignal  = 0;
    let validEntries           = 0;

    for (let i = 0; i < list.length; i++) {
      const e = freezeEntry(list[i]);
      if (!e) continue;
      validEntries += 1;

      const state = deriveRuntimeIsolationState(list[i]);
      if (state.isolated) {
        isolatedEntries += 1;
      } else {
        runtimeEligibleEntries += 1;
      }

      if (e.sequence.length > 0 && sequenceHasSaveSignal(e.sequence)) {
        entriesWithSaveSignal += 1;
      }
    }

    const total = validEntries;
    return Object.freeze({
      totalEntries:           total,
      isolatedEntries,
      runtimeEligibleEntries,
      approvalRate:     total > 0 ? roundMetric(clamp(runtimeEligibleEntries / total)) : 0,
      isolationRate:    total > 0 ? roundMetric(clamp(isolatedEntries        / total)) : 0,
      saveSignalCoverage: total > 0 ? roundMetric(clamp(entriesWithSaveSignal  / total)) : 0,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: detectRuntimeIsolationViolations ──────────────────────────────────

/**
 * Scan a registry for entries that violate runtime isolation invariants.
 *
 * Invariants (all must hold for a clean registry):
 *   - reusable=true implies approvedForRuntime=true (and vice versa)
 *   - approvedForRuntime=true requires tier=high_confidence
 *   - high_confidence entries should carry a save signal
 *   - no structurally malformed entries
 *
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectRuntimeIsolationViolations(registry) {
  const EMPTY = Object.freeze({
    runtimeApprovedWithoutReusable:      [],
    reusableWithoutRuntimeApproval:      [],
    highConfidenceWithoutSaveSignal:     [],
    runtimeApprovedWithoutHighConfidence: [],
    malformedRuntimeCandidates:          [],
    totalViolationCount:                 0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const runtimeApprovedWithoutReusable       = [];
    const reusableWithoutRuntimeApproval       = [];
    const highConfidenceWithoutSaveSignal      = [];
    const runtimeApprovedWithoutHighConfidence = [];
    const malformedRuntimeCandidates           = [];

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const e   = freezeEntry(raw);

      if (!e) {
        malformedRuntimeCandidates.push("(non-object entry)");
        continue;
      }

      const id = safeString(e.registryId, "(missing id)");

      // Structural failures that make the entry uninterpretable.
      const hasNoSequence       = e.sequence.length === 0;
      const hasInvalidConfidence = !(safeNumber(raw.confidence, -1) >= 0 && safeNumber(raw.confidence, -1) <= 1);
      if (hasNoSequence || hasInvalidConfidence) {
        malformedRuntimeCandidates.push(id);
      }

      // Asymmetric approval flags — both must be set together or neither.
      if (e.approvedForRuntime && !e.reusable) {
        runtimeApprovedWithoutReusable.push(id);
      }
      if (e.reusable && !e.approvedForRuntime) {
        reusableWithoutRuntimeApproval.push(id);
      }

      // Runtime approval requires high_confidence tier.
      if (e.approvedForRuntime && e.tier !== TIER_HIGH_CONFIDENCE) {
        runtimeApprovedWithoutHighConfidence.push(id);
      }

      // high_confidence entries with no save signal cannot be meaningfully trusted.
      if (e.tier === TIER_HIGH_CONFIDENCE && e.sequence.length > 0 && !sequenceHasSaveSignal(e.sequence)) {
        highConfidenceWithoutSaveSignal.push(id);
      }
    }

    const totalViolationCount =
      runtimeApprovedWithoutReusable.length
      + reusableWithoutRuntimeApproval.length
      + highConfidenceWithoutSaveSignal.length
      + runtimeApprovedWithoutHighConfidence.length
      + malformedRuntimeCandidates.length;

    return Object.freeze({
      runtimeApprovedWithoutReusable:       runtimeApprovedWithoutReusable.sort(),
      reusableWithoutRuntimeApproval:       reusableWithoutRuntimeApproval.sort(),
      highConfidenceWithoutSaveSignal:      highConfidenceWithoutSaveSignal.sort(),
      runtimeApprovedWithoutHighConfidence: runtimeApprovedWithoutHighConfidence.sort(),
      malformedRuntimeCandidates:           malformedRuntimeCandidates.sort(),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
