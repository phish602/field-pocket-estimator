// @ts-nocheck
/* eslint-disable */

// Standalone registry sanitization boundary for the Job Learning system.
// No imports. No runtime wiring. No persistence. No side effects.
// This module is the last line of defence before any entry could theoretically
// advance toward reuse — it ensures malformed or unsafe entries are always
// fail-closed before evaluation by governance or isolation utilities.

const MAX_REGISTRY_ENTRIES = 1000;
const MAX_SEQUENCE_TOKENS  = 50;
const MAX_REGISTRY_ID_LEN  = 120;
const MAX_TOKEN_LEN        = 80;
const CONFIDENCE_DECIMALS  = 4;

const VALID_TIERS = new Set(["high_confidence", "stable", "emerging", "unstable"]);

// ── Private helpers ───────────────────────────────────────────────────────────

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function roundConfidence(value) {
  const factor = Math.pow(10, CONFIDENCE_DECIMALS);
  return Math.round(value * factor) / factor;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

// ── Public: sanitizeRegistryEntry ────────────────────────────────────────────

/**
 * Validate and sanitize a single registry entry.
 * Enforces all structural constraints and hard-resets governance flags to false.
 * Returns a frozen accepted entry or a rejection with the first failing reason.
 * Pure, deterministic, never throws. No side effects.
 */
export function sanitizeRegistryEntry(entry) {
  const REJECT = (reason) => Object.freeze({ accepted: false, sanitizedEntry: null, rejectionReason: reason });

  try {
    // ── Structural gate ──────────────────────────────────────────────────────
    if (!isPlainObject(entry))          return REJECT("non_object_entry");

    const rawId = entry.registryId;
    if (rawId === undefined || rawId === null) return REJECT("missing_registry_id");
    if (typeof rawId !== "string")      return REJECT("registry_id_not_string");

    const trimmedId = rawId.trim();
    if (!trimmedId)                     return REJECT("empty_registry_id");
    if (trimmedId.length > MAX_REGISTRY_ID_LEN) return REJECT("registry_id_oversized");

    // ── Sequence gate ────────────────────────────────────────────────────────
    const rawSequence = entry.sequence;
    if (!Array.isArray(rawSequence))    return REJECT("sequence_not_array");
    if (rawSequence.length === 0)       return REJECT("empty_sequence");
    if (rawSequence.length > MAX_SEQUENCE_TOKENS) return REJECT("sequence_oversized");

    for (let i = 0; i < rawSequence.length; i++) {
      const token = rawSequence[i];
      if (typeof token !== "string")    return REJECT("non_string_token");
      if (token.trim().length === 0)    return REJECT("empty_token");
      if (token.length > MAX_TOKEN_LEN) return REJECT("token_oversized");
    }

    // ── Confidence gate ──────────────────────────────────────────────────────
    const rawConfidence = entry.confidence;
    const confidence    = Number(rawConfidence);
    if (!Number.isFinite(confidence))   return REJECT("invalid_confidence");
    if (confidence < 0 || confidence > 1) return REJECT("confidence_out_of_range");

    // ── Tier gate ────────────────────────────────────────────────────────────
    const rawTier = entry.tier;
    if (typeof rawTier !== "string")    return REJECT("tier_not_string");
    const normalizedTier = rawTier.trim().toLowerCase();
    if (!VALID_TIERS.has(normalizedTier)) return REJECT("invalid_tier");

    // ── Sanitize and freeze ──────────────────────────────────────────────────
    // Governance flags are ALWAYS forced false regardless of what the caller
    // attempted. This is the key invariant of this boundary.
    const sanitizedEntry = Object.freeze({
      registryId:         trimmedId,
      tier:               normalizedTier,
      confidence:         roundConfidence(clamp01(confidence)),
      frequency:          Math.max(0, Math.floor(Number.isFinite(Number(entry.frequency)) ? Number(entry.frequency) : 0)),
      reusable:           false,  // forced — never true from this boundary
      approvedForRuntime: false,  // forced — never true from this boundary
      sequence:           Object.freeze(rawSequence.map((t) => t.trim())),
    });

    return Object.freeze({ accepted: true, sanitizedEntry, rejectionReason: null });
  } catch {
    return Object.freeze({ accepted: false, sanitizedEntry: null, rejectionReason: "sanitization_error" });
  }
}

// ── Public: sanitizeRegistryBatch ────────────────────────────────────────────

/**
 * Sanitize an entire registry array, returning accepted and rejected entry sets.
 * Hard cap: MAX_REGISTRY_ENTRIES = 1000.
 * Pure, deterministic, never throws. No side effects.
 */
export function sanitizeRegistryBatch(registry) {
  const EMPTY = Object.freeze({
    acceptedEntries: Object.freeze([]),
    rejectedEntries: Object.freeze([]),
    acceptedCount:   0,
    rejectedCount:   0,
    rejectionRate:   0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const acceptedEntries = [];
    const rejectedEntries = [];

    for (let i = 0; i < list.length; i++) {
      const result = sanitizeRegistryEntry(list[i]);
      if (result.accepted) {
        acceptedEntries.push(result.sanitizedEntry);
      } else {
        rejectedEntries.push(Object.freeze({
          index:           i,
          rejectionReason: result.rejectionReason,
          rawRegistryId:   isPlainObject(list[i]) && typeof list[i].registryId === "string"
            ? list[i].registryId.trim().slice(0, MAX_REGISTRY_ID_LEN) || "(empty)"
            : "(non-object)",
        }));
      }
    }

    const acceptedCount = acceptedEntries.length;
    const rejectedCount = rejectedEntries.length;
    const total         = acceptedCount + rejectedCount;
    const rejectionRate = total > 0
      ? Math.round((rejectedCount / total) * 1000) / 1000
      : 0;

    return Object.freeze({
      acceptedEntries: Object.freeze(acceptedEntries),
      rejectedEntries: Object.freeze(rejectedEntries),
      acceptedCount,
      rejectedCount,
      rejectionRate,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: deriveSanitizationRisk ───────────────────────────────────────────

/**
 * Classify the sanitization risk of a single raw entry.
 * Does not sanitize — evaluates raw input to characterize what would fail.
 * Highest applicable level wins. Pure, deterministic, never throws.
 */
export function deriveSanitizationRisk(entry) {
  try {
    // ── Critical ─────────────────────────────────────────────────────────────
    if (!isPlainObject(entry)) return "critical";

    const rawConfidence = Number(entry.confidence);
    if (!Number.isFinite(rawConfidence) || rawConfidence < 0 || rawConfidence > 1) {
      return "critical";
    }

    const rawTier = entry.tier;
    if (typeof rawTier !== "string" || !VALID_TIERS.has(rawTier.trim().toLowerCase())) {
      return "critical";
    }

    const rawId = entry.registryId;
    if (typeof rawId !== "string" || rawId.trim().length > MAX_REGISTRY_ID_LEN) {
      return "critical";
    }

    const rawSequence = entry.sequence;
    if (!Array.isArray(rawSequence) || rawSequence.length > MAX_SEQUENCE_TOKENS) {
      return "critical";
    }

    // ── High ─────────────────────────────────────────────────────────────────
    // Attempted governance flag violations.
    if (entry.reusable === true || entry.approvedForRuntime === true) {
      return "high";
    }

    // Invalid token types or oversized tokens.
    for (let i = 0; i < rawSequence.length; i++) {
      const token = rawSequence[i];
      if (typeof token !== "string") return "high";
      if (token.length > MAX_TOKEN_LEN) return "high";
    }

    // ── Moderate ─────────────────────────────────────────────────────────────
    // Empty tokens or values requiring normalization.
    for (let i = 0; i < rawSequence.length; i++) {
      if (rawSequence[i].trim().length === 0) return "moderate";
      if (rawSequence[i] !== rawSequence[i].trim()) return "moderate";
    }

    if (typeof rawId === "string" && rawId !== rawId.trim()) return "moderate";
    if (typeof rawTier === "string" && rawTier !== rawTier.trim().toLowerCase()) return "moderate";

    const normalizedConfidence = roundConfidence(clamp01(rawConfidence));
    if (normalizedConfidence !== rawConfidence) return "moderate";

    // ── Low ──────────────────────────────────────────────────────────────────
    return "low";
  } catch {
    return "critical";
  }
}

// ── Public: detectRegistrySanitizationViolations ──────────────────────────────

/**
 * Scan a raw registry for entries that would violate sanitization invariants.
 * Reports every category of violation without sanitizing or mutating anything.
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectRegistrySanitizationViolations(registry) {
  const EMPTY = Object.freeze({
    reusableFlagAttempts:      [],
    runtimeApprovalAttempts:   [],
    malformedEntries:          [],
    oversizedEntries:          [],
    invalidTokenEntries:       [],
    invalidConfidenceEntries:  [],
    totalViolationCount:       0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const reusableFlagAttempts     = [];
    const runtimeApprovalAttempts  = [];
    const malformedEntries         = [];
    const oversizedEntries         = [];
    const invalidTokenEntries      = [];
    const invalidConfidenceEntries = [];

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];

      if (!isPlainObject(raw)) {
        malformedEntries.push(`(index ${i}: non-object)`);
        continue;
      }

      const id = (typeof raw.registryId === "string" && raw.registryId.trim())
        ? raw.registryId.trim().slice(0, MAX_REGISTRY_ID_LEN)
        : `(index ${i}: missing id)`;

      // Governance flag attempts.
      if (raw.reusable === true)            reusableFlagAttempts.push(id);
      if (raw.approvedForRuntime === true)  runtimeApprovalAttempts.push(id);

      // Structural malformation.
      const hasInvalidId       = typeof raw.registryId !== "string" || !raw.registryId.trim();
      const hasInvalidSequence = !Array.isArray(raw.sequence) || raw.sequence.length === 0;
      const hasInvalidTier     = typeof raw.tier !== "string" || !VALID_TIERS.has(raw.tier.trim().toLowerCase());
      if (hasInvalidId || hasInvalidSequence || hasInvalidTier) {
        malformedEntries.push(id);
      }

      // Confidence violations.
      const conf = Number(raw.confidence);
      if (!Number.isFinite(conf) || conf < 0 || conf > 1) {
        invalidConfidenceEntries.push(id);
      }

      // Oversized fields.
      const idTooLong  = typeof raw.registryId === "string" && raw.registryId.trim().length > MAX_REGISTRY_ID_LEN;
      const seqTooLong = Array.isArray(raw.sequence) && raw.sequence.length > MAX_SEQUENCE_TOKENS;
      if (idTooLong || seqTooLong) {
        oversizedEntries.push(id);
      }

      // Token-level violations.
      if (Array.isArray(raw.sequence)) {
        let tokenViolation = false;
        for (let j = 0; j < raw.sequence.length && !tokenViolation; j++) {
          const token = raw.sequence[j];
          if (typeof token !== "string" || token.trim().length === 0 || token.length > MAX_TOKEN_LEN) {
            tokenViolation = true;
          }
        }
        if (tokenViolation) invalidTokenEntries.push(id);
      }
    }

    const totalViolationCount =
      reusableFlagAttempts.length
      + runtimeApprovalAttempts.length
      + malformedEntries.length
      + oversizedEntries.length
      + invalidTokenEntries.length
      + invalidConfidenceEntries.length;

    return Object.freeze({
      reusableFlagAttempts:     reusableFlagAttempts.sort(),
      runtimeApprovalAttempts:  runtimeApprovalAttempts.sort(),
      malformedEntries:         malformedEntries.sort(),
      oversizedEntries:         oversizedEntries.sort(),
      invalidTokenEntries:      invalidTokenEntries.sort(),
      invalidConfidenceEntries: invalidConfidenceEntries.sort(),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
