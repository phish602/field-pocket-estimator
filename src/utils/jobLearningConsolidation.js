// @ts-nocheck
/* eslint-disable */

const EMPTY_ARRAY = Object.freeze([]);

const APPROVAL_PRIORITY = Object.freeze({
  approved_candidate: 6,
  review_ready: 5,
  needs_review: 4,
  quarantined: 3,
  rejected: 2,
  runtime_blocked: 1,
  unknown: 0,
});

const SCORING_PRIORITY = Object.freeze({
  high_confidence: 4,
  stable: 3,
  emerging: 2,
  weak: 1,
  unknown: 0,
});

const ZERO_HEALTH = Object.freeze({
  total: 0,
  groupedCandidates: 0,
  groupCount: 0,
  duplicateGroups: 0,
  suppressedCount: 0,
  consolidationRate: 0,
});

const ZERO_VIOLATIONS = Object.freeze({
  malformedCandidates: EMPTY_ARRAY,
  missingFingerprints: EMPTY_ARRAY,
  malformedSequences: EMPTY_ARRAY,
  duplicateGroups: EMPTY_ARRAY,
  suppressedCandidates: EMPTY_ARRAY,
  totalViolationCount: 0,
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeTrimmedString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeToken(value) {
  return safeTrimmedString(value).toLowerCase();
}

function isValidFingerprint(value) {
  return safeTrimmedString(value).length > 0;
}

function isValidSequence(sequence) {
  if (!Array.isArray(sequence) || sequence.length === 0) return false;
  for (let i = 0; i < sequence.length; i += 1) {
    if (safeTrimmedString(sequence[i]).length === 0) return false;
  }
  return true;
}

function normalizeSequence(sequence) {
  if (!isValidSequence(sequence)) return null;
  const out = [];
  for (let i = 0; i < sequence.length; i += 1) {
    const token = normalizeToken(sequence[i]);
    if (!token) return null;
    if (out.length === 0 || out[out.length - 1] !== token) {
      out.push(token);
    }
  }
  return out.length ? out : null;
}

function normalizeConfidence(value) {
  const confidence = Number(value);
  return Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : -1;
}

function normalizeCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 0) return 0;
  return Math.floor(count);
}

function normalizeApprovalState(value) {
  const state = safeTrimmedString(value);
  return state || "unknown";
}

function normalizeScoringTier(value) {
  const tier = safeTrimmedString(value);
  return tier || "unknown";
}

function normalizeWorkflowClass(value) {
  const workflowClass = safeTrimmedString(value);
  return workflowClass || "unknown";
}

function normalizeWorkflowComplexity(value) {
  const workflowComplexity = safeTrimmedString(value);
  return workflowComplexity || "unknown";
}

function normalizeTradeHint(value) {
  const tradeHint = safeTrimmedString(value);
  return tradeHint || "unknown";
}

function candidateLabel(candidate, index) {
  if (isPlainObject(candidate) && isValidFingerprint(candidate.fingerprint)) {
    return safeTrimmedString(candidate.fingerprint);
  }
  return "candidate:" + index;
}

function hasValidCandidateShape(candidate) {
  return isPlainObject(candidate) && isValidSequence(candidate.sequence);
}

function getCandidateSortVector(candidate) {
  return {
    approvalPriority: APPROVAL_PRIORITY[normalizeApprovalState(candidate.approvalState)] ?? APPROVAL_PRIORITY.unknown,
    scoringPriority: SCORING_PRIORITY[normalizeScoringTier(candidate.scoringTier)] ?? SCORING_PRIORITY.unknown,
    confidence: normalizeConfidence(candidate.confidence),
    saveCount: normalizeCount(candidate.saveCount),
    acceptedCount: normalizeCount(candidate.acceptedCount),
    fingerprint: isValidFingerprint(candidate.fingerprint) ? safeTrimmedString(candidate.fingerprint) : "",
    fingerprintIsValid: isValidFingerprint(candidate.fingerprint),
  };
}

function compareCandidatesForCanonicalWinner(a, b) {
  if (b.approvalPriority !== a.approvalPriority) return b.approvalPriority - a.approvalPriority;
  if (b.scoringPriority !== a.scoringPriority) return b.scoringPriority - a.scoringPriority;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  if (b.saveCount !== a.saveCount) return b.saveCount - a.saveCount;
  if (b.acceptedCount !== a.acceptedCount) return b.acceptedCount - a.acceptedCount;
  if (a.fingerprintIsValid !== b.fingerprintIsValid) return a.fingerprintIsValid ? -1 : 1;
  return a.fingerprint.localeCompare(b.fingerprint);
}

function roundRate(value) {
  const bounded = Math.max(0, Math.min(1, Number(value) || 0));
  return Math.round(bounded * 1000) / 1000;
}

function freezeGroup(group) {
  return Object.freeze(group);
}

function getConsolidationKey(candidate) {
  const sequence = normalizeSequence(candidate.sequence);
  if (!sequence) return null;
  const workflowClass = normalizeWorkflowClass(candidate.workflowClass);
  const workflowComplexity = normalizeWorkflowComplexity(candidate.workflowComplexity);
  const tradeHint = normalizeTradeHint(candidate.tradeHint);
  return workflowClass + "|" + workflowComplexity + "|" + tradeHint + "|" + sequence.join(">");
}

function createGroupedCandidateRecord(candidate, index, consolidationKey) {
  return {
    consolidationKey,
    label: candidateLabel(candidate, index),
    sortVector: getCandidateSortVector(candidate),
  };
}

function buildGroups(candidates) {
  const grouped = new Map();

  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!hasValidCandidateShape(candidate)) continue;

    const consolidationKey = getConsolidationKey(candidate);
    if (!consolidationKey) continue;

    const record = createGroupedCandidateRecord(candidate, i, consolidationKey);
    const bucket = grouped.get(consolidationKey);
    if (bucket) {
      bucket.push(record);
    } else {
      grouped.set(consolidationKey, [record]);
    }
  }

  const groups = [];
  const keys = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));

  for (let i = 0; i < keys.length; i += 1) {
    const consolidationKey = keys[i];
    const entries = grouped.get(consolidationKey) || EMPTY_ARRAY;
    const sortedEntries = entries
      .slice()
      .sort((a, b) => compareCandidatesForCanonicalWinner(a.sortVector, b.sortVector));
    const candidateFingerprints = sortedEntries.map((entry) => entry.label).sort((a, b) => a.localeCompare(b));
    const canonicalFingerprint = sortedEntries.length ? sortedEntries[0].label : "";
    const suppressedFingerprints = candidateFingerprints.slice();
    const canonicalIndex = suppressedFingerprints.indexOf(canonicalFingerprint);
    if (canonicalIndex >= 0) suppressedFingerprints.splice(canonicalIndex, 1);

    groups.push(freezeGroup({
      consolidationKey,
      canonicalFingerprint,
      candidateFingerprints: Object.freeze(candidateFingerprints),
      duplicateCount: Math.max(0, candidateFingerprints.length - 1),
      suppressedFingerprints: Object.freeze(suppressedFingerprints),
    }));
  }

  return groups;
}

export function deriveConsolidationKey(candidate) {
  try {
    if (!hasValidCandidateShape(candidate)) return null;
    return getConsolidationKey(candidate);
  } catch {
    return null;
  }
}

export function groupConsolidationCandidates(candidates) {
  try {
    if (!Array.isArray(candidates)) return [];
    return buildGroups(candidates);
  } catch {
    return [];
  }
}

export function summarizeConsolidationHealth(candidates) {
  try {
    if (!Array.isArray(candidates)) return ZERO_HEALTH;

    const groups = buildGroups(candidates);
    const total = candidates.length;

    let groupedCandidates = 0;
    let duplicateGroups = 0;
    let suppressedCount = 0;

    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      groupedCandidates += group.candidateFingerprints.length;
      if (group.duplicateCount > 0) duplicateGroups += 1;
      suppressedCount += group.suppressedFingerprints.length;
    }

    return Object.freeze({
      total,
      groupedCandidates,
      groupCount: groups.length,
      duplicateGroups,
      suppressedCount,
      consolidationRate: groupedCandidates > 0 ? roundRate(suppressedCount / groupedCandidates) : 0,
    });
  } catch {
    return ZERO_HEALTH;
  }
}

export function detectConsolidationViolations(candidates) {
  try {
    if (!Array.isArray(candidates)) return ZERO_VIOLATIONS;

    const malformedCandidates = [];
    const missingFingerprints = [];
    const malformedSequences = [];
    const grouped = new Map();

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const label = candidateLabel(candidate, i);

      if (!isPlainObject(candidate)) {
        malformedCandidates.push(label);
        missingFingerprints.push(label);
        malformedSequences.push(label);
        continue;
      }

      if (!isValidFingerprint(candidate.fingerprint)) {
        missingFingerprints.push(label);
      }
      if (!isValidSequence(candidate.sequence)) {
        malformedSequences.push(label);
      }

      const consolidationKey = getConsolidationKey(candidate);
      if (!consolidationKey) continue;

      const bucket = grouped.get(consolidationKey);
      if (bucket) {
        bucket.push(label);
      } else {
        grouped.set(consolidationKey, [label]);
      }
    }

    const duplicateGroups = [];
    const suppressedCandidates = [];
    const keys = Array.from(grouped.keys()).sort((a, b) => a.localeCompare(b));

    for (let i = 0; i < keys.length; i += 1) {
      const consolidationKey = keys[i];
      const labels = (grouped.get(consolidationKey) || EMPTY_ARRAY).slice().sort((a, b) => a.localeCompare(b));
      if (labels.length > 1) {
        duplicateGroups.push(consolidationKey);
        for (let j = 1; j < labels.length; j += 1) {
          suppressedCandidates.push(labels[j]);
        }
      }
    }

    const sortedMalformedCandidates = Object.freeze(malformedCandidates.slice().sort((a, b) => a.localeCompare(b)));
    const sortedMissingFingerprints = Object.freeze(missingFingerprints.slice().sort((a, b) => a.localeCompare(b)));
    const sortedMalformedSequences = Object.freeze(malformedSequences.slice().sort((a, b) => a.localeCompare(b)));
    const sortedDuplicateGroups = Object.freeze(duplicateGroups.slice().sort((a, b) => a.localeCompare(b)));
    const sortedSuppressedCandidates = Object.freeze(suppressedCandidates.slice().sort((a, b) => a.localeCompare(b)));

    return Object.freeze({
      malformedCandidates: sortedMalformedCandidates,
      missingFingerprints: sortedMissingFingerprints,
      malformedSequences: sortedMalformedSequences,
      duplicateGroups: sortedDuplicateGroups,
      suppressedCandidates: sortedSuppressedCandidates,
      totalViolationCount:
        sortedMalformedCandidates.length +
        sortedMissingFingerprints.length +
        sortedMalformedSequences.length +
        sortedDuplicateGroups.length +
        sortedSuppressedCandidates.length,
    });
  } catch {
    return ZERO_VIOLATIONS;
  }
}
