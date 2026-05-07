// @ts-nocheck
/* eslint-disable */

// Standalone deterministic sequence normalization for the Job Learning system.
// No imports. No runtime wiring. No persistence. No side effects.

const MAX_SEQUENCE_LENGTH  = 100;
const MAX_TOKEN_LENGTH     = 80;
const MAX_REGISTRY_ENTRIES = 1000;

// Threshold above which duplicate collapse is considered "heavy".
const HEAVY_COLLAPSE_THRESHOLD = 0.3;
// Threshold above which non-string removal is considered "large".
const LARGE_NONSTRING_THRESHOLD = 0.2;

// ── Private helpers ───────────────────────────────────────────────────────────

function isArray(value) {
  return Array.isArray(value);
}

// Collapse consecutive adjacent identical tokens to one occurrence.
function collapseAdjacentDuplicates(tokens) {
  if (!tokens.length) return tokens;
  const out = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    if (tokens[i] !== tokens[i - 1]) out.push(tokens[i]);
  }
  return out;
}

// Collapse runs of consecutive *_open tokens: keep only the first in each run.
// Collapse runs of consecutive *_close tokens: keep only the first in each run.
function collapseOpenCloseDuplicates(tokens) {
  if (!tokens.length) return tokens;
  const out = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    const prev = tokens[i - 1];
    const curr = tokens[i];
    const prevIsOpen  = typeof prev === "string" && prev.endsWith("_open");
    const currIsOpen  = typeof curr === "string" && curr.endsWith("_open");
    const prevIsClose = typeof prev === "string" && prev.endsWith("_close");
    const currIsClose = typeof curr === "string" && curr.endsWith("_close");
    if ((prevIsOpen && currIsOpen) || (prevIsClose && currIsClose)) continue;
    out.push(curr);
  }
  return out;
}

// Deterministic fingerprint from a normalized token array.
// Uses a simple polynomial rolling hash over character codes — no randomness,
// no timestamps, same input always yields same output.
function buildFingerprint(tokens) {
  if (!tokens.length) return "seq_empty";
  const joined = tokens.join("|");
  // FNV-1a 32-bit over the joined string, expressed as a zero-padded hex string.
  let hash = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    hash ^= joined.charCodeAt(i);
    // Unsigned 32-bit multiply by FNV prime 16777619.
    hash = (hash * 0x01000193) >>> 0;
  }
  const hex = hash.toString(16).padStart(8, "0");
  return "seq_" + hex + "_l" + tokens.length;
}

// Normalize a raw sequence array into a clean, deduplicated token list.
// Returns { valid, normalizedTokens, normalizationApplied, rejectionReason, removedNonString, removedDuplicates }.
function processSequence(sequence) {
  const FAIL = (rejectionReason) => ({
    valid: false, normalizedTokens: [], normalizationApplied: false,
    rejectionReason, removedNonString: 0, removedDuplicates: 0,
  });

  if (!isArray(sequence))              return FAIL("non_array_sequence");
  if (sequence.length === 0)           return FAIL("empty_sequence");
  if (sequence.length > MAX_SEQUENCE_LENGTH) return FAIL("sequence_oversized");

  // Phase 1: validate and filter tokens.
  let removedNonString = 0;
  const stringOnly = [];
  for (let i = 0; i < sequence.length; i++) {
    if (typeof sequence[i] !== "string") { removedNonString++; continue; }
    const trimmed = sequence[i].trim().toLowerCase();
    if (trimmed.length === 0) continue;           // removed by trim
    if (trimmed.length > MAX_TOKEN_LENGTH) {
      return FAIL("token_oversized");             // hard reject — not recoverable
    }
    stringOnly.push(trimmed);
  }

  if (stringOnly.length === 0) return FAIL("no_valid_tokens");

  // Phase 2: collapse duplicates.
  const beforeCollapse = stringOnly.length;
  const afterAdjacent  = collapseAdjacentDuplicates(stringOnly);
  const afterOpenClose = collapseOpenCloseDuplicates(afterAdjacent);
  const removedDuplicates = beforeCollapse - afterOpenClose.length;

  const normalizedTokens    = afterOpenClose;
  const normalizationApplied =
    removedNonString > 0
    || removedDuplicates > 0
    || sequence.some((t) => typeof t === "string" && (t !== t.trim() || t !== t.toLowerCase()));

  return {
    valid: true, normalizedTokens, normalizationApplied,
    rejectionReason: null, removedNonString, removedDuplicates,
  };
}

// ── Public: normalizeWorkflowSequence ────────────────────────────────────────

/**
 * Normalize a raw workflow sequence into a canonical, deduplicated form.
 * Generates a deterministic fingerprint from the normalized result.
 * Pure, deterministic, never throws. No side effects.
 */
export function normalizeWorkflowSequence(sequence) {
  const FAIL = (rejectionReason) => Object.freeze({
    valid: false,
    normalizedSequence: Object.freeze([]),
    fingerprint: "seq_rejected",
    normalizationApplied: false,
    rejectionReason,
  });

  try {
    const result = processSequence(sequence);
    if (!result.valid) return FAIL(result.rejectionReason);

    const { normalizedTokens, normalizationApplied } = result;
    const fingerprint = buildFingerprint(normalizedTokens);

    return Object.freeze({
      valid: true,
      normalizedSequence: Object.freeze(normalizedTokens),
      fingerprint,
      normalizationApplied,
      rejectionReason: null,
    });
  } catch {
    return FAIL("normalization_error");
  }
}

// ── Public: deriveSequenceNormalizationRisk ───────────────────────────────────

/**
 * Classify the normalization risk of a raw sequence without normalizing it.
 * Highest applicable level wins. Pure, deterministic, never throws.
 */
export function deriveSequenceNormalizationRisk(sequence) {
  try {
    // ── Critical ─────────────────────────────────────────────────────────────
    if (!isArray(sequence) || sequence.length === 0) return "critical";
    if (sequence.length > MAX_SEQUENCE_LENGTH)        return "critical";

    // Hard-reject oversized token check.
    for (let i = 0; i < sequence.length; i++) {
      if (typeof sequence[i] === "string" && sequence[i].length > MAX_TOKEN_LENGTH) {
        return "critical";
      }
    }

    // ── High ─────────────────────────────────────────────────────────────────
    // Large proportion of non-string entries.
    const nonStringCount = sequence.filter((t) => typeof t !== "string").length;
    if (sequence.length > 0 && nonStringCount / sequence.length >= LARGE_NONSTRING_THRESHOLD) {
      return "high";
    }

    // Heavy duplicate collapse: simulate it to measure reduction.
    const stringTokens = sequence
      .filter((t) => typeof t === "string")
      .map((t) => t.trim().toLowerCase())
      .filter((t) => t.length > 0 && t.length <= MAX_TOKEN_LENGTH);

    if (stringTokens.length > 0) {
      const afterAdjacent  = collapseAdjacentDuplicates(stringTokens);
      const afterOpenClose = collapseOpenCloseDuplicates(afterAdjacent);
      const collapseRatio  = (stringTokens.length - afterOpenClose.length) / stringTokens.length;
      if (collapseRatio >= HEAVY_COLLAPSE_THRESHOLD) return "high";
    }

    // ── Moderate ─────────────────────────────────────────────────────────────
    // Any whitespace cleanup or casing normalization needed.
    for (let i = 0; i < sequence.length; i++) {
      const t = sequence[i];
      if (typeof t !== "string") continue;
      if (t !== t.trim() || t !== t.toLowerCase()) return "moderate";
    }

    // ── Low ──────────────────────────────────────────────────────────────────
    return "low";
  } catch {
    return "critical";
  }
}

// ── Public: summarizeSequenceNormalizationHealth ──────────────────────────────

/**
 * Aggregate normalization health across a registry of entries with sequences.
 * Accepts either raw sequence arrays or registry entry objects with a .sequence field.
 * Pure, deterministic, never throws. No side effects.
 */
export function summarizeSequenceNormalizationHealth(registry) {
  const EMPTY = Object.freeze({
    totalSequences:       0,
    validSequences:       0,
    rejectedSequences:    0,
    normalizedSequences:  0,
    normalizationRate:    0,
    rejectionRate:        0,
    duplicateCollapseRate: 0,
  });

  try {
    const list = isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    let validSequences       = 0;
    let rejectedSequences    = 0;
    let normalizedSequences  = 0;
    let totalCollapsedTokens = 0;
    let totalOriginalTokens  = 0;

    for (let i = 0; i < list.length; i++) {
      // Accept raw arrays or objects with a .sequence field.
      const raw = isArray(list[i])
        ? list[i]
        : (list[i] && typeof list[i] === "object" && !isArray(list[i]) ? list[i].sequence : list[i]);

      const result = processSequence(raw);

      if (!result.valid) {
        rejectedSequences += 1;
        continue;
      }

      validSequences += 1;
      if (result.normalizationApplied) normalizedSequences += 1;

      // Count for duplicate collapse rate: how many tokens were removed.
      const originalStringCount = isArray(raw)
        ? raw.filter((t) => typeof t === "string" && t.trim().length > 0 && t.length <= MAX_TOKEN_LENGTH).length
        : 0;
      totalOriginalTokens  += originalStringCount;
      totalCollapsedTokens += result.removedDuplicates;
    }

    const total = validSequences + rejectedSequences;
    const round3 = (v) => Math.round(v * 1000) / 1000;

    return Object.freeze({
      totalSequences:       total,
      validSequences,
      rejectedSequences,
      normalizedSequences,
      normalizationRate:    validSequences > 0 ? round3(normalizedSequences / validSequences) : 0,
      rejectionRate:        total > 0         ? round3(rejectedSequences    / total)           : 0,
      duplicateCollapseRate: totalOriginalTokens > 0 ? round3(totalCollapsedTokens / totalOriginalTokens) : 0,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: detectSequenceNormalizationViolations ─────────────────────────────

/**
 * Scan a registry for sequences that violate normalization invariants.
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectSequenceNormalizationViolations(registry) {
  const EMPTY = Object.freeze({
    malformedSequences:      [],
    oversizedSequences:      [],
    oversizedTokens:         [],
    duplicateHeavySequences: [],
    invalidTokenSequences:   [],
    totalViolationCount:     0,
  });

  try {
    const list = isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const malformedSequences      = [];
    const oversizedSequences      = [];
    const oversizedTokens         = [];
    const duplicateHeavySequences = [];
    const invalidTokenSequences   = [];

    for (let i = 0; i < list.length; i++) {
      const raw = isArray(list[i])
        ? list[i]
        : (list[i] && typeof list[i] === "object" && !isArray(list[i]) ? list[i].sequence : list[i]);

      const label = (list[i] && typeof list[i] === "object" && !isArray(list[i]) && typeof list[i].registryId === "string")
        ? list[i].registryId.trim().slice(0, 120) || `(index ${i})`
        : `(index ${i})`;

      if (!isArray(raw) || raw.length === 0) {
        malformedSequences.push(label);
        continue;
      }

      if (raw.length > MAX_SEQUENCE_LENGTH) {
        oversizedSequences.push(label);
        continue;
      }

      let hasNonString      = false;
      let hasOversizedToken = false;

      for (let j = 0; j < raw.length; j++) {
        if (typeof raw[j] !== "string") { hasNonString = true; break; }
        if (raw[j].length > MAX_TOKEN_LENGTH) { hasOversizedToken = true; break; }
      }

      if (hasNonString)      invalidTokenSequences.push(label);
      if (hasOversizedToken) oversizedTokens.push(label);

      // Duplicate-heavy: check collapse ratio on valid string tokens only.
      if (!hasNonString && !hasOversizedToken) {
        const stringTokens = raw
          .map((t) => t.trim().toLowerCase())
          .filter((t) => t.length > 0);
        if (stringTokens.length > 0) {
          const afterAdjacent  = collapseAdjacentDuplicates(stringTokens);
          const afterOpenClose = collapseOpenCloseDuplicates(afterAdjacent);
          const ratio = (stringTokens.length - afterOpenClose.length) / stringTokens.length;
          if (ratio >= HEAVY_COLLAPSE_THRESHOLD) duplicateHeavySequences.push(label);
        }
      }
    }

    const totalViolationCount =
      malformedSequences.length
      + oversizedSequences.length
      + oversizedTokens.length
      + duplicateHeavySequences.length
      + invalidTokenSequences.length;

    return Object.freeze({
      malformedSequences:      malformedSequences.sort(),
      oversizedSequences:      oversizedSequences.sort(),
      oversizedTokens:         oversizedTokens.sort(),
      duplicateHeavySequences: duplicateHeavySequences.sort(),
      invalidTokenSequences:   invalidTokenSequences.sort(),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
