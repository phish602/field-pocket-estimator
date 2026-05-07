// @ts-nocheck
/* eslint-disable */

const EMPTY_ARRAY = Object.freeze([]);
const APPROVED_REVIEW_STATE = "approved";
const REJECTED_REVIEW_STATE = "rejected";
const NEEDS_CHANGES_REVIEW_STATE = "needs_changes";
const REQUIRED_DRAFT_FIELDS = Object.freeze([
  "fingerprint",
  "confidence",
  "scoringTier",
  "sequence",
  "saveCount",
  "acceptedCount",
  "workflowClass",
  "workflowComplexity",
  "tradeHint",
]);

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function safeString(value) {
  return String(value ?? "").trim();
}

function safeFingerprint(value) {
  const text = safeString(value);
  return text || "";
}

function clonePlain(value) {
  if (!isPlainObject(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function cloneArray(value) {
  if (!Array.isArray(value)) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return null;
  }
}

function isValidReviewState(value) {
  const state = safeString(value);
  return state === APPROVED_REVIEW_STATE || state === REJECTED_REVIEW_STATE || state === NEEDS_CHANGES_REVIEW_STATE;
}

function isValidSequence(sequence) {
  if (!Array.isArray(sequence) || sequence.length === 0) return false;
  for (let i = 0; i < sequence.length; i += 1) {
    if (safeString(sequence[i]).length === 0) return false;
  }
  return true;
}

function isValidCount(value) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0;
}

function isValidConfidence(value) {
  const next = Number(value);
  return Number.isFinite(next) && next >= 0 && next <= 1;
}

function isValidSnapshotShape(snapshot) {
  if (!isPlainObject(snapshot)) return false;
  for (let i = 0; i < REQUIRED_DRAFT_FIELDS.length; i += 1) {
    const key = REQUIRED_DRAFT_FIELDS[i];
    if (typeof snapshot[key] === "undefined") return false;
  }
  if (!safeFingerprint(snapshot.fingerprint)) return false;
  if (!isValidConfidence(snapshot.confidence)) return false;
  if (!safeString(snapshot.scoringTier)) return false;
  if (!isValidSequence(snapshot.sequence)) return false;
  if (!isValidCount(snapshot.saveCount)) return false;
  if (!isValidCount(snapshot.acceptedCount)) return false;
  if (!safeString(snapshot.workflowClass)) return false;
  if (!safeString(snapshot.workflowComplexity)) return false;
  if (!safeString(snapshot.tradeHint)) return false;
  return true;
}

function normalizeSnapshot(value) {
  const cloned = clonePlain(value);
  if (!cloned) return null;
  if (!isValidSnapshotShape(cloned)) return null;
  return Object.freeze({
    fingerprint: safeFingerprint(cloned.fingerprint),
    confidence: Number(cloned.confidence),
    scoringTier: safeString(cloned.scoringTier),
    sequence: Object.freeze(cloneArray(cloned.sequence) || EMPTY_ARRAY),
    saveCount: Math.floor(Number(cloned.saveCount)),
    acceptedCount: Math.floor(Number(cloned.acceptedCount)),
    workflowClass: safeString(cloned.workflowClass),
    workflowComplexity: safeString(cloned.workflowComplexity),
    tradeHint: safeString(cloned.tradeHint),
  });
}

function normalizeEvidence(value) {
  const cloned = clonePlain(value);
  if (!cloned) return null;
  return Object.freeze(cloned);
}

function normalizeReviewedRecord(record, index) {
  if (!isPlainObject(record)) {
    return {
      kind: "malformed",
      label: `reviewed:${index}`,
      reasons: Object.freeze(["malformed_reviewed_record"]),
    };
  }

  const candidateFingerprint = safeFingerprint(record.candidateFingerprint || record.fingerprint);
  const assistTraceId = safeString(record.assistTraceId);
  const reviewState = safeString(record.reviewState);
  const candidateDraftSnapshot = normalizeSnapshot(record.candidateDraftSnapshot || record.candidateDraft || record.snapshot);
  const sourceEvidence = normalizeEvidence(record.sourceEvidence || record.evidence);
  const reviewNotes = safeString(record.reviewNotes);
  const label = candidateFingerprint || `reviewed:${index}`;
  const reasons = [];

  if (record.approvedForRuntime === true) reasons.push("approved_for_runtime_true");
  if (record.reusable === true) reasons.push("reusable_true");
  if (!candidateFingerprint) reasons.push("missing_candidateFingerprint");
  if (!assistTraceId) reasons.push("missing_assistTraceId");
  if (!isValidReviewState(reviewState)) reasons.push("invalid_reviewState");
  if (!candidateDraftSnapshot) reasons.push("invalid_candidateDraftSnapshot");
  if (!sourceEvidence) reasons.push("invalid_sourceEvidence");

  return Object.freeze({
    kind: "reviewed",
    index,
    label,
    candidateFingerprint,
    assistTraceId,
    reviewState,
    candidateDraftSnapshot,
    sourceEvidence,
    reviewNotes,
    reasons: Object.freeze(reasons),
  });
}

function sortStrings(a, b) {
  return String(a).localeCompare(String(b));
}

function sortQuarantine(a, b) {
  const labelDelta = String(a.label || "").localeCompare(String(b.label || ""));
  if (labelDelta !== 0) return labelDelta;
  const stateDelta = String(a.reviewState || "").localeCompare(String(b.reviewState || ""));
  if (stateDelta !== 0) return stateDelta;
  return String(a.reason || "").localeCompare(String(b.reason || ""));
}

function sortRegistryCandidates(a, b) {
  return String(a.fingerprint).localeCompare(String(b.fingerprint));
}

function uniqueSorted(values) {
  return Array.from(new Set(values)).sort(sortStrings);
}

function buildQuarantineRecord(reviewed, reasons) {
  return Object.freeze({
    reviewedLabel: reviewed.label,
    candidateFingerprint: reviewed.candidateFingerprint,
    assistTraceId: reviewed.assistTraceId,
    reviewState: reviewed.reviewState,
    candidateDraftSnapshot: reviewed.candidateDraftSnapshot,
    sourceEvidence: reviewed.sourceEvidence,
    reviewNotes: reviewed.reviewNotes,
    reasons: Object.freeze(uniqueSorted(reasons)),
  });
}

function isRequiredFieldMissing(reviewed) {
  return !reviewed.candidateFingerprint
    || !reviewed.assistTraceId
    || !reviewed.candidateDraftSnapshot
    || !reviewed.sourceEvidence
    || !isValidReviewState(reviewed.reviewState);
}

function hasUnsafeFlags(reviewed) {
  return reviewed && reviewed.kind === "reviewed" && (reviewed.reasons.indexOf("approved_for_runtime_true") >= 0 || reviewed.reasons.indexOf("reusable_true") >= 0);
}

function buildApprovedCandidate(reviewed) {
  const snapshot = reviewed.candidateDraftSnapshot;
  return Object.freeze({
    fingerprint: snapshot.fingerprint,
    approvalState: "review_ready",
    confidence: snapshot.confidence,
    scoringTier: snapshot.scoringTier,
    sequence: Object.freeze(cloneArray(snapshot.sequence) || EMPTY_ARRAY),
    saveCount: snapshot.saveCount,
    acceptedCount: snapshot.acceptedCount,
    workflowClass: snapshot.workflowClass,
    workflowComplexity: snapshot.workflowComplexity,
    tradeHint: snapshot.tradeHint,
  });
}

function buildIndices(reviewedRecords) {
  const records = [];
  const fingerprintCounts = new Map();
  const traceCounts = new Map();

  for (let i = 0; i < reviewedRecords.length; i += 1) {
    const reviewed = normalizeReviewedRecord(reviewedRecords[i], i);
    records.push(reviewed);
    if (reviewed.kind !== "reviewed") continue;

    if (reviewed.candidateFingerprint) {
      fingerprintCounts.set(reviewed.candidateFingerprint, (fingerprintCounts.get(reviewed.candidateFingerprint) || 0) + 1);
    }
    if (reviewed.assistTraceId) {
      traceCounts.set(reviewed.assistTraceId, (traceCounts.get(reviewed.assistTraceId) || 0) + 1);
    }
  }

  return { records, fingerprintCounts, traceCounts };
}

function buildDuplicateFingerprintSet(fingerprintCounts) {
  const duplicates = [];
  fingerprintCounts.forEach((count, fingerprint) => {
    if (count > 1) duplicates.push(fingerprint);
  });
  return uniqueSorted(duplicates);
}

function buildIssueLists(records, fingerprintCounts) {
  const malformedReviewedRecords = [];
  const nonApprovedReviewedRecords = [];
  const unsafeRuntimeFlags = [];
  const unsafeReusableFlags = [];
  const missingRequiredFields = [];
  const malformedCandidateSnapshots = [];
  const duplicateFingerprints = buildDuplicateFingerprintSet(fingerprintCounts);

  for (let i = 0; i < records.length; i += 1) {
    const reviewed = records[i];
    if (reviewed.kind === "malformed") {
      malformedReviewedRecords.push(reviewed.label);
      continue;
    }

    const label = reviewed.candidateFingerprint || reviewed.label;
    if (reviewed.reviewState === REJECTED_REVIEW_STATE || reviewed.reviewState === NEEDS_CHANGES_REVIEW_STATE) {
      nonApprovedReviewedRecords.push(label);
    }
    if (reviewed.reasons.indexOf("approved_for_runtime_true") >= 0) {
      unsafeRuntimeFlags.push(label);
    }
    if (reviewed.reasons.indexOf("reusable_true") >= 0) {
      unsafeReusableFlags.push(label);
    }
    if (isRequiredFieldMissing(reviewed)) {
      missingRequiredFields.push(label);
    }
    if (!reviewed.candidateDraftSnapshot || !reviewed.sourceEvidence) {
      malformedCandidateSnapshots.push(label);
    }
  }

  return {
    malformedReviewedRecords: uniqueSorted(malformedReviewedRecords),
    nonApprovedReviewedRecords: uniqueSorted(nonApprovedReviewedRecords),
    unsafeRuntimeFlags: uniqueSorted(unsafeRuntimeFlags),
    unsafeReusableFlags: uniqueSorted(unsafeReusableFlags),
    missingRequiredFields: uniqueSorted(missingRequiredFields),
    malformedCandidateSnapshots: uniqueSorted(malformedCandidateSnapshots),
    duplicateFingerprints,
  };
}

export function buildReviewedRegistryCandidates(reviewedRecords) {
  if (!Array.isArray(reviewedRecords)) {
    return Object.freeze({
      registryCandidates: EMPTY_ARRAY,
      quarantinedReviewedRecords: EMPTY_ARRAY,
      reviewWarnings: Object.freeze(["malformed_reviewed_records_input"]),
    });
  }

  const { records, fingerprintCounts } = buildIndices(reviewedRecords);
  const duplicateFingerprints = buildDuplicateFingerprintSet(fingerprintCounts);
  const duplicateSet = new Set(duplicateFingerprints);
  const registryCandidates = [];
  const quarantinedReviewedRecords = [];
  const reviewWarnings = [];

  if (duplicateFingerprints.length > 0) reviewWarnings.push("duplicate_fingerprints");

  for (let i = 0; i < records.length; i += 1) {
    const reviewed = records[i];
    if (reviewed.kind === "malformed") {
      quarantinedReviewedRecords.push(buildQuarantineRecord(reviewed, reviewed.reasons));
      continue;
    }

    const reasons = reviewed.reasons.slice();
    if (duplicateSet.has(reviewed.candidateFingerprint)) reasons.push("duplicate_fingerprint");

    if (reviewed.reviewState !== APPROVED_REVIEW_STATE) {
      reasons.push("non_approved_review_state");
    }

    if (isRequiredFieldMissing(reviewed)) {
      reasons.push("missing_required_fields");
    }

    if (duplicateSet.has(reviewed.candidateFingerprint)) {
      reasons.push("duplicate_fingerprint_quarantined");
    }

    if (reviewed.reviewState === APPROVED_REVIEW_STATE && reasons.length === 0) {
      registryCandidates.push(buildApprovedCandidate(reviewed));
    } else {
      quarantinedReviewedRecords.push(buildQuarantineRecord(reviewed, reasons));
    }
  }

  registryCandidates.sort(sortRegistryCandidates);
  quarantinedReviewedRecords.sort(sortQuarantine);

  return Object.freeze({
    registryCandidates: Object.freeze(registryCandidates),
    quarantinedReviewedRecords: Object.freeze(quarantinedReviewedRecords),
    reviewWarnings: Object.freeze(uniqueSorted(reviewWarnings)),
  });
}

export function summarizeReviewedRegistryCandidates(reviewedRecords) {
  if (!Array.isArray(reviewedRecords)) {
    return Object.freeze({
      totalReviewed: 0,
      emittedCandidateCount: 0,
      quarantinedReviewedCount: 0,
      approvedReviewedCount: 0,
      rejectedReviewedCount: 0,
      needsChangesReviewedCount: 0,
      warningCount: 1,
    });
  }

  const bridge = buildReviewedRegistryCandidates(reviewedRecords);
  let approvedReviewedCount = 0;
  let rejectedReviewedCount = 0;
  let needsChangesReviewedCount = 0;

  for (let i = 0; i < reviewedRecords.length; i += 1) {
    const record = isPlainObject(reviewedRecords[i]) ? reviewedRecords[i] : null;
    const state = record ? safeString(record.reviewState) : "";
    if (state === APPROVED_REVIEW_STATE) approvedReviewedCount += 1;
    else if (state === REJECTED_REVIEW_STATE) rejectedReviewedCount += 1;
    else if (state === NEEDS_CHANGES_REVIEW_STATE) needsChangesReviewedCount += 1;
  }

  return Object.freeze({
    totalReviewed: reviewedRecords.length,
    emittedCandidateCount: bridge.registryCandidates.length,
    quarantinedReviewedCount: bridge.quarantinedReviewedRecords.length,
    approvedReviewedCount,
    rejectedReviewedCount,
    needsChangesReviewedCount,
    warningCount: bridge.reviewWarnings.length,
  });
}

export function detectReviewedRegistryIssues(reviewedRecords) {
  if (!Array.isArray(reviewedRecords)) {
    return Object.freeze({
      malformedReviewedRecords: EMPTY_ARRAY,
      nonApprovedReviewedRecords: EMPTY_ARRAY,
      unsafeRuntimeFlags: EMPTY_ARRAY,
      unsafeReusableFlags: EMPTY_ARRAY,
      missingRequiredFields: EMPTY_ARRAY,
      malformedCandidateSnapshots: EMPTY_ARRAY,
      duplicateFingerprints: EMPTY_ARRAY,
      totalIssueCount: 0,
    });
  }

  const { records, fingerprintCounts } = buildIndices(reviewedRecords);
  const issues = buildIssueLists(records, fingerprintCounts);

  return Object.freeze({
    malformedReviewedRecords: Object.freeze(issues.malformedReviewedRecords),
    nonApprovedReviewedRecords: Object.freeze(issues.nonApprovedReviewedRecords),
    unsafeRuntimeFlags: Object.freeze(issues.unsafeRuntimeFlags),
    unsafeReusableFlags: Object.freeze(issues.unsafeReusableFlags),
    missingRequiredFields: Object.freeze(issues.missingRequiredFields),
    malformedCandidateSnapshots: Object.freeze(issues.malformedCandidateSnapshots),
    duplicateFingerprints: Object.freeze(issues.duplicateFingerprints),
    totalIssueCount:
      issues.malformedReviewedRecords.length
      + issues.nonApprovedReviewedRecords.length
      + issues.unsafeRuntimeFlags.length
      + issues.unsafeReusableFlags.length
      + issues.missingRequiredFields.length
      + issues.malformedCandidateSnapshots.length
      + issues.duplicateFingerprints.length,
  });
}

