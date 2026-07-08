// @ts-nocheck
/* eslint-disable */

// Standalone deterministic workflow deduplication for the Job Learning system.
// No imports. No runtime wiring. No persistence. No side effects.

const MAX_REGISTRY_ENTRIES   = 1000;
const MAX_GROUP_SIZE_WARNING = 25;
const MAX_SEQUENCE_LENGTH    = 100;
const MAX_TOKEN_LENGTH       = 80;

// Uniqueness ratio below which a sequence is considered "low uniqueness".
const LOW_UNIQUENESS_THRESHOLD = 0.5;

// ── Private helpers ───────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Normalize a sequence to clean lowercase trimmed tokens, bounded.
// Returns null when the sequence is unusable.
function normalizeTokens(sequence) {
  if (!Array.isArray(sequence) || sequence.length === 0) return null;
  const out = [];
  for (let i = 0; i < sequence.length && out.length < MAX_SEQUENCE_LENGTH; i++) {
    if (typeof sequence[i] !== "string") return null; // hard reject on non-string
    const t = sequence[i].trim().toLowerCase();
    if (!t || t.length > MAX_TOKEN_LENGTH) return null;
    out.push(t);
  }
  return out.length ? out : null;
}

// FNV-1a 32-bit hash — deterministic, no randomness, no timestamps.
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// Build a fingerprint from normalized tokens (mirrors sequence normalizer format).
function buildFingerprint(tokens) {
  if (!tokens || !tokens.length) return "seq_empty";
  return "seq_" + fnv1a32(tokens.join("|")) + "_l" + tokens.length;
}

// Build a secondary token signature: sorted unique tokens joined, for grouping
// entries whose tokens are the same set regardless of order.
function buildTokenSignature(tokens) {
  if (!tokens || !tokens.length) return "sig_empty";
  const unique = [];
  const seen   = new Set();
  for (let i = 0; i < tokens.length; i++) {
    if (!seen.has(tokens[i])) { seen.add(tokens[i]); unique.push(tokens[i]); }
  }
  unique.sort();
  return "sig_" + fnv1a32(unique.join("|")) + "_u" + unique.length;
}

// Uniqueness ratio of a token array: distinct tokens / total tokens.
function uniquenessRatio(tokens) {
  if (!tokens || !tokens.length) return 0;
  const distinct = new Set(tokens).size;
  return distinct / tokens.length;
}

// Safe string from an entry for reporting (registryId or fallback).
function entryLabel(entry, index) {
  if (isPlainObject(entry) && typeof entry.registryId === "string" && entry.registryId.trim()) {
    return entry.registryId.trim().slice(0, 120);
  }
  return "(index " + index + ")";
}

// ── Public: detectWorkflowDuplicates ─────────────────────────────────────────

/**
 * Group registry entries by fingerprint (primary) then by token signature (secondary).
 * Groups containing more than one entry are duplicates.
 * Original order within each group is preserved.
 * Pure, deterministic, never throws. No side effects.
 */
export function detectWorkflowDuplicates(registry) {
  const EMPTY = Object.freeze({
    duplicateGroups:  Object.freeze([]),
    uniqueEntries:    Object.freeze([]),
    duplicateEntries: Object.freeze([]),
    duplicateRate:    0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    // Phase 1: compute fingerprint + signature for each valid entry, in order.
    const resolved = [];
    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      if (!isPlainObject(raw)) continue;

      // Prefer an already-computed fingerprint on the entry (from sequence normalizer).
      // Fall back to building it from the sequence.
      let fingerprint = typeof raw.fingerprint === "string" && raw.fingerprint.startsWith("seq_")
        ? raw.fingerprint
        : null;

      const tokens = normalizeTokens(raw.sequence);
      if (!tokens) continue; // skip malformed

      if (!fingerprint) fingerprint = buildFingerprint(tokens);
      const signature = buildTokenSignature(tokens);

      resolved.push({ raw, fingerprint, signature, index: i });
    }

    // Phase 2: primary grouping by fingerprint.
    const fpMap = new Map();
    for (let i = 0; i < resolved.length; i++) {
      const { fingerprint, signature, raw } = resolved[i];
      if (!fpMap.has(fingerprint)) {
        fpMap.set(fingerprint, { fingerprint, signature, entries: [] });
      }
      fpMap.get(fingerprint).entries.push(raw);
    }

    // Phase 3: within fingerprint-unique groups, secondary grouping by signature.
    // (Fingerprint already encodes order, so this primarily handles pre-normalised
    // entries that share the same token set but different ordering.)
    const allGroups      = [];
    const uniqueEntries  = [];
    const duplicateEntries = [];

    for (const fpGroup of fpMap.values()) {
      if (fpGroup.entries.length === 1) {
        // Unique by fingerprint — also unique by signature trivially.
        uniqueEntries.push(fpGroup.entries[0]);
        continue;
      }

      // Multiple entries share the same fingerprint: sub-group by signature.
      const sigMap = new Map();
      for (let i = 0; i < fpGroup.entries.length; i++) {
        const e       = fpGroup.entries[i];
        const tokens  = normalizeTokens(e.sequence);
        const sig     = tokens ? buildTokenSignature(tokens) : fpGroup.signature;
        if (!sigMap.has(sig)) sigMap.set(sig, { fingerprint: fpGroup.fingerprint, signature: sig, entries: [] });
        sigMap.get(sig).entries.push(e);
      }

      for (const sigGroup of sigMap.values()) {
        allGroups.push(Object.freeze({
          fingerprint: sigGroup.fingerprint,
          signature:   sigGroup.signature,
          entries:     Object.freeze(sigGroup.entries),
          count:       sigGroup.entries.length,
        }));
        // First entry in each duplicate group is the "canonical" — the rest are duplicates.
        uniqueEntries.push(sigGroup.entries[0]);
        for (let i = 1; i < sigGroup.entries.length; i++) {
          duplicateEntries.push(sigGroup.entries[i]);
        }
      }
    }

    const total         = uniqueEntries.length + duplicateEntries.length;
    const duplicateRate = total > 0
      ? Math.round((duplicateEntries.length / total) * 1000) / 1000
      : 0;

    return Object.freeze({
      duplicateGroups:  Object.freeze(allGroups),
      uniqueEntries:    Object.freeze(uniqueEntries),
      duplicateEntries: Object.freeze(duplicateEntries),
      duplicateRate,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: deriveWorkflowDeduplicationRisk ───────────────────────────────────

/**
 * Classify the deduplication risk of a single raw entry.
 * Highest applicable level wins. Pure, deterministic, never throws.
 */
export function deriveWorkflowDeduplicationRisk(entry) {
  try {
    // ── Critical ─────────────────────────────────────────────────────────────
    if (!isPlainObject(entry)) return "critical";

    const hasFp = typeof entry.fingerprint === "string" && entry.fingerprint.startsWith("seq_");
    if (!hasFp && !Array.isArray(entry.sequence)) return "critical";

    const tokens = normalizeTokens(entry.sequence);
    if (!tokens && !hasFp) return "critical";

    // If the fingerprint says "rejected" this entry failed normalisation.
    if (typeof entry.fingerprint === "string" && entry.fingerprint === "seq_rejected") {
      return "critical";
    }

    // ── High ─────────────────────────────────────────────────────────────────
    if (tokens) {
      // Excessive adjacent duplicate repetition (> 50% of transitions are duplicates).
      let dups = 0;
      for (let i = 1; i < tokens.length; i++) {
        if (tokens[i] === tokens[i - 1]) dups++;
      }
      if (tokens.length > 1 && dups / (tokens.length - 1) >= 0.5) return "high";
    }

    // ── Moderate ─────────────────────────────────────────────────────────────
    if (tokens) {
      // Low uniqueness: many repeated tokens relative to total.
      if (uniquenessRatio(tokens) < LOW_UNIQUENESS_THRESHOLD) return "moderate";

      // Any adjacent duplicates at all.
      for (let i = 1; i < tokens.length; i++) {
        if (tokens[i] === tokens[i - 1]) return "moderate";
      }
    }

    // ── Low ──────────────────────────────────────────────────────────────────
    return "low";
  } catch {
    return "critical";
  }
}

// ── Public: summarizeWorkflowDeduplicationHealth ──────────────────────────────

/**
 * Aggregate deduplication health metrics across a registry.
 * Pure, deterministic, never throws. No side effects.
 */
export function summarizeWorkflowDeduplicationHealth(registry) {
  const EMPTY = Object.freeze({
    totalEntries:            0,
    uniqueEntryCount:        0,
    duplicateEntryCount:     0,
    duplicateGroupCount:     0,
    duplicateRate:           0,
    largestDuplicateGroup:   0,
    averageDuplicateGroupSize: 0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const result = detectWorkflowDuplicates(list);

    const duplicateGroupCount   = result.duplicateGroups.length;
    const uniqueEntryCount      = result.uniqueEntries.length;
    const duplicateEntryCount   = result.duplicateEntries.length;
    const totalEntries          = uniqueEntryCount + duplicateEntryCount;

    let largestDuplicateGroup   = 0;
    let groupSizeSum            = 0;
    for (let i = 0; i < result.duplicateGroups.length; i++) {
      const sz = result.duplicateGroups[i].count;
      if (sz > largestDuplicateGroup) largestDuplicateGroup = sz;
      groupSizeSum += sz;
    }

    const averageDuplicateGroupSize = duplicateGroupCount > 0
      ? Math.round((groupSizeSum / duplicateGroupCount) * 100) / 100
      : 0;

    return Object.freeze({
      totalEntries,
      uniqueEntryCount,
      duplicateEntryCount,
      duplicateGroupCount,
      duplicateRate:             result.duplicateRate,
      largestDuplicateGroup,
      averageDuplicateGroupSize,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: detectWorkflowDeduplicationViolations ────────────────────────────

/**
 * Scan a registry for entries that violate deduplication invariants.
 * Pure, deterministic, never throws. No side effects. No mutations.
 */
export function detectWorkflowDeduplicationViolations(registry) {
  const EMPTY = Object.freeze({
    malformedEntries:         [],
    missingFingerprintEntries: [],
    invalidSequenceEntries:   [],
    excessiveDuplicateGroups: [],
    lowUniquenessEntries:     [],
    totalViolationCount:      0,
  });

  try {
    const list = Array.isArray(registry)
      ? registry.slice(0, MAX_REGISTRY_ENTRIES)
      : [];
    if (!list.length) return EMPTY;

    const malformedEntries          = [];
    const missingFingerprintEntries = [];
    const invalidSequenceEntries    = [];
    const lowUniquenessEntries      = [];

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const id  = entryLabel(raw, i);

      if (!isPlainObject(raw)) {
        malformedEntries.push(id);
        continue;
      }

      const hasFp = typeof raw.fingerprint === "string" && raw.fingerprint.startsWith("seq_");
      if (!hasFp) missingFingerprintEntries.push(id);

      const tokens = normalizeTokens(raw.sequence);
      if (!tokens) {
        invalidSequenceEntries.push(id);
        continue;
      }

      if (uniquenessRatio(tokens) < LOW_UNIQUENESS_THRESHOLD) {
        lowUniquenessEntries.push(id);
      }
    }

    // Identify duplicate groups whose size exceeds the warning threshold.
    const dedupeResult          = detectWorkflowDuplicates(list);
    const excessiveDuplicateGroups = [];
    for (let i = 0; i < dedupeResult.duplicateGroups.length; i++) {
      const g = dedupeResult.duplicateGroups[i];
      if (g.count > MAX_GROUP_SIZE_WARNING) {
        excessiveDuplicateGroups.push(g.fingerprint);
      }
    }

    const totalViolationCount =
      malformedEntries.length
      + missingFingerprintEntries.length
      + invalidSequenceEntries.length
      + excessiveDuplicateGroups.length
      + lowUniquenessEntries.length;

    return Object.freeze({
      malformedEntries:          malformedEntries.sort(),
      missingFingerprintEntries: missingFingerprintEntries.sort(),
      invalidSequenceEntries:    invalidSequenceEntries.sort(),
      excessiveDuplicateGroups:  excessiveDuplicateGroups.sort(),
      lowUniquenessEntries:      lowUniquenessEntries.sort(),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
