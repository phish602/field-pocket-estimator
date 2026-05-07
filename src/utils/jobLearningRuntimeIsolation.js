// @ts-nocheck
/* eslint-disable */

// Standalone deterministic runtime isolation utility for Job Learning candidates.
// Safety wall between stored learning data and anything that could later be consumed
// by runtime behavior. No imports. No runtime wiring. No persistence. No side effects.

const MAX_CANDIDATES      = 1000;
const MAX_TOKEN_LENGTH    = 80;
const MAX_SEQUENCE_LENGTH = 100;

// Confidence tier thresholds (inline — no imports allowed).
const CONF_HIGH_CONFIDENCE = 0.8;
const CONF_STABLE          = 0.6;
const CONF_EMERGING        = 0.4;

const VALID_APPROVAL_STATES = new Set([
  "rejected",
  "quarantined",
  "needs_review",
  "review_ready",
  "approved_candidate",
  "runtime_blocked",
]);

// ── Private helpers ───────────────────────────────────────────────────────────

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isValidFingerprint(fp) {
  return typeof fp === "string" && fp.startsWith("seq_") && fp.length > 4;
}

function isValidConfidence(c) {
  const n = Number(c);
  return Number.isFinite(n) && n >= 0 && n <= 1;
}

// Returns trimmed token array or null if unusable.
function sanitizeSequence(seq) {
  if (!Array.isArray(seq) || seq.length === 0 || seq.length > MAX_SEQUENCE_LENGTH) return null;
  const out = [];
  for (let i = 0; i < seq.length; i++) {
    if (typeof seq[i] !== "string") return null;
    const t = seq[i].trim();
    if (!t || t.length > MAX_TOKEN_LENGTH) return null;
    out.push(t);
  }
  return out.length ? out : null;
}

// Returns fingerprint if valid, else "candidate:" + index.
function candidateId(raw, index) {
  if (isPlainObject(raw) && isValidFingerprint(raw.fingerprint)) return raw.fingerprint;
  return "candidate:" + index;
}

// Infer scoring tier from a valid confidence value.
function inferScoringTier(confidence) {
  if (confidence >= CONF_HIGH_CONFIDENCE) return "high_confidence";
  if (confidence >= CONF_STABLE)          return "stable";
  if (confidence >= CONF_EMERGING)        return "emerging";
  return "unstable";
}

// ── Public: getRuntimeApprovedCandidates ──────────────────────────────────────

/**
 * Return sanitized, frozen candidate objects that are safe for downstream consumption.
 * Only includes entries with approvalState === "approved_candidate" that pass all
 * governance checks. Returns [] for any malformed input. Never throws.
 *
 * Returned objects contain ONLY:
 *   fingerprint, workflowClass, workflowComplexity, tradeHint,
 *   confidence, scoringTier, sequence, saveCount, acceptedCount
 */
export function getRuntimeApprovedCandidates(candidates) {
  try {
    if (!Array.isArray(candidates)) return Object.freeze([]);

    const list   = candidates.slice(0, MAX_CANDIDATES);
    const result = [];

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];

      // Must be a plain object.
      if (!isPlainObject(raw)) continue;

      // Must be approved_candidate.
      if (raw.approvalState !== "approved_candidate") continue;

      // Governance flags must be absent / false.
      if (raw.approvedForRuntime === true) continue;
      if (raw.reusable === true) continue;

      // Fingerprint must be valid.
      if (!isValidFingerprint(raw.fingerprint)) continue;

      // Confidence must be valid.
      if (!isValidConfidence(raw.confidence)) continue;

      // Sequence must be sanitizable.
      const seq = sanitizeSequence(raw.sequence);
      if (!seq) continue;

      const confidence  = Number(raw.confidence);
      const scoringTier = inferScoringTier(confidence);

      // Build sanitized object — only allowed fields, no reference to original.
      const sanitized = Object.freeze({
        fingerprint:        raw.fingerprint,
        workflowClass:      typeof raw.workflowClass      === "string" ? raw.workflowClass      : "",
        workflowComplexity: typeof raw.workflowComplexity === "string" ? raw.workflowComplexity : "",
        tradeHint:          typeof raw.tradeHint           === "string" ? raw.tradeHint           : "",
        confidence,
        scoringTier,
        sequence:           Object.freeze(seq),
        saveCount:     typeof raw.saveCount    === "number" && raw.saveCount    >= 0 ? raw.saveCount    : 0,
        acceptedCount: typeof raw.acceptedCount === "number" && raw.acceptedCount >= 0 ? raw.acceptedCount : 0,
      });

      result.push(sanitized);
    }

    return Object.freeze(result);
  } catch {
    return Object.freeze([]);
  }
}

// ── Public: deriveRuntimeIsolationRisk ────────────────────────────────────────

/**
 * Classify the overall isolation risk of a candidates array.
 * Highest applicable level wins. Pure, deterministic, never throws.
 */
export function deriveRuntimeIsolationRisk(candidates) {
  try {
    // Not an array at all.
    if (!Array.isArray(candidates)) return "critical";

    const list = candidates.slice(0, MAX_CANDIDATES);
    if (!list.length) return "low";

    let hasHighRisk     = false;
    let hasModerateRisk = false;

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];

      if (!isPlainObject(raw)) {
        hasHighRisk = true;
        continue;
      }

      // Critical: governance flags set on any entry.
      if (raw.approvedForRuntime === true) return "critical";
      if (raw.reusable === true)           return "critical";

      const fpValid   = isValidFingerprint(raw.fingerprint);
      const confValid = isValidConfidence(raw.confidence);
      const seqValid  = sanitizeSequence(raw.sequence) !== null;

      // High: malformed fingerprint / sequence / confidence on any entry.
      if (!fpValid || !confValid || !seqValid) {
        hasHighRisk = true;
        continue;
      }

      // High: invalid approvalState.
      const stateStr = typeof raw.approvalState === "string" ? raw.approvalState : "";
      if (!VALID_APPROVAL_STATES.has(stateStr)) {
        hasHighRisk = true;
        continue;
      }

      // Moderate: non-approved_candidate entries present.
      if (raw.approvalState !== "approved_candidate") {
        hasModerateRisk = true;
        continue;
      }

      // Moderate: approved_candidate missing saveCount.
      if (typeof raw.saveCount !== "number" || raw.saveCount < 0) {
        hasModerateRisk = true;
      }
    }

    if (hasHighRisk)     return "high";
    if (hasModerateRisk) return "moderate";
    return "low";
  } catch {
    return "critical";
  }
}

// ── Public: summarizeRuntimeIsolationHealth ───────────────────────────────────

/**
 * Summarize the isolation health of a candidates array.
 * Pure, deterministic, never throws. No side effects.
 */
export function summarizeRuntimeIsolationHealth(candidates) {
  const EMPTY = Object.freeze({
    total:            0,
    approvedEligible: 0,
    blocked:          0,
    blockedRate:      0,
    eligibleRate:     0,
  });

  try {
    if (!Array.isArray(candidates)) return EMPTY;

    const list  = candidates.slice(0, MAX_CANDIDATES);
    const total = list.length;
    if (!total) return EMPTY;

    const approvedEligible = getRuntimeApprovedCandidates(list).length;
    const blocked          = total - approvedEligible;

    const blockedRate  = Math.round((blocked          / total) * 1000) / 1000;
    const eligibleRate = Math.round((approvedEligible / total) * 1000) / 1000;

    return Object.freeze({
      total,
      approvedEligible,
      blocked,
      blockedRate,
      eligibleRate,
    });
  } catch {
    return EMPTY;
  }
}

// ── Public: detectRuntimeIsolationViolations ──────────────────────────────────

/**
 * Scan a candidates array for isolation violations.
 * Pure, deterministic, never throws. No side effects. No mutations.
 *
 * IDs: fingerprint if valid (starts "seq_"), else "candidate:N"
 */
export function detectRuntimeIsolationViolations(candidates) {
  const EMPTY = Object.freeze({
    runtimeGovernanceViolations: Object.freeze([]),
    malformedApprovedCandidates: Object.freeze([]),
    invalidApprovalStates:       Object.freeze([]),
    unsafeReusableCandidates:    Object.freeze([]),
    unsafeRuntimeFlags:          Object.freeze([]),
    malformedFingerprints:       Object.freeze([]),
    malformedSequences:          Object.freeze([]),
    malformedConfidence:         Object.freeze([]),
    totalViolationCount:         0,
  });

  try {
    if (!Array.isArray(candidates)) return EMPTY;

    const list = candidates.slice(0, MAX_CANDIDATES);
    if (!list.length) return EMPTY;

    const runtimeGovernanceViolations = [];
    const malformedApprovedCandidates = [];
    const invalidApprovalStates       = [];
    const unsafeReusableCandidates    = [];
    const unsafeRuntimeFlags          = [];
    const malformedFingerprints       = [];
    const malformedSequences          = [];
    const malformedConfidenceArr      = [];

    for (let i = 0; i < list.length; i++) {
      const raw = list[i];
      const id  = candidateId(raw, i);

      // Non-objects: governance violation.
      if (!isPlainObject(raw)) {
        runtimeGovernanceViolations.push(id);
        continue;
      }

      // Unsafe governance flags.
      if (raw.approvedForRuntime === true) {
        unsafeRuntimeFlags.push(id);
        runtimeGovernanceViolations.push(id);
      }
      if (raw.reusable === true) {
        unsafeReusableCandidates.push(id);
        runtimeGovernanceViolations.push(id);
      }

      // approvalState validity.
      const stateStr = typeof raw.approvalState === "string" ? raw.approvalState : "";
      if (!VALID_APPROVAL_STATES.has(stateStr)) invalidApprovalStates.push(id);

      // Fingerprint validity.
      if (!isValidFingerprint(raw.fingerprint)) malformedFingerprints.push(id);

      // Sequence validity.
      if (sanitizeSequence(raw.sequence) === null) malformedSequences.push(id);

      // Confidence validity.
      if (!isValidConfidence(raw.confidence)) malformedConfidenceArr.push(id);

      // Malformed approved_candidate: state is approved_candidate but fails a structural check.
      if (
        raw.approvalState === "approved_candidate" &&
        (
          !isValidFingerprint(raw.fingerprint)  ||
          sanitizeSequence(raw.sequence) === null ||
          !isValidConfidence(raw.confidence)    ||
          raw.approvedForRuntime === true        ||
          raw.reusable === true
        )
      ) {
        malformedApprovedCandidates.push(id);
      }
    }

    const totalViolationCount =
      runtimeGovernanceViolations.length
      + malformedApprovedCandidates.length
      + invalidApprovalStates.length
      + unsafeReusableCandidates.length
      + unsafeRuntimeFlags.length
      + malformedFingerprints.length
      + malformedSequences.length
      + malformedConfidenceArr.length;

    return Object.freeze({
      runtimeGovernanceViolations: Object.freeze(runtimeGovernanceViolations.sort()),
      malformedApprovedCandidates: Object.freeze(malformedApprovedCandidates.sort()),
      invalidApprovalStates:       Object.freeze(invalidApprovalStates.sort()),
      unsafeReusableCandidates:    Object.freeze(unsafeReusableCandidates.sort()),
      unsafeRuntimeFlags:          Object.freeze(unsafeRuntimeFlags.sort()),
      malformedFingerprints:       Object.freeze(malformedFingerprints.sort()),
      malformedSequences:          Object.freeze(malformedSequences.sort()),
      malformedConfidence:         Object.freeze(malformedConfidenceArr.sort()),
      totalViolationCount,
    });
  } catch {
    return EMPTY;
  }
}
