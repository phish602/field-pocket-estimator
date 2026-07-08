// @ts-nocheck
/* eslint-disable */

import { summarizeLearningPolicyHealth, detectLearningPolicyViolations } from "./jobLearningPolicyEngine";
import { summarizeApprovalWorkflowHealth, detectApprovalWorkflowViolations } from "./jobLearningApprovalWorkflow";
import { summarizeRuntimeIsolationHealth, detectRuntimeIsolationViolations, getRuntimeApprovedCandidates } from "./jobLearningRuntimeIsolation";
import { summarizePromotionHealth, rankPromotionCandidates, detectPromotionViolations } from "./jobLearningPromotionEvaluator";
import { summarizeConsolidationHealth, groupConsolidationCandidates, detectConsolidationViolations } from "./jobLearningConsolidation";

const ZERO_SNAPSHOT = Object.freeze({
  totalCandidates: 0,
  policyHealth: Object.freeze({}),
  approvalHealth: Object.freeze({}),
  runtimeHealth: Object.freeze({}),
  promotionHealth: Object.freeze({}),
  consolidationHealth: Object.freeze({}),
  runtimeApprovedCandidates: Object.freeze([]),
  promotionRanking: Object.freeze([]),
  consolidationGroups: Object.freeze([]),
  violations: Object.freeze({
    policy: Object.freeze({}),
    approval: Object.freeze({}),
    runtime: Object.freeze({}),
    promotion: Object.freeze({}),
    consolidation: Object.freeze({}),
  }),
});

const EMPTY_ARRAY = Object.freeze([]);

function normalizeCandidates(candidates) {
  return Array.isArray(candidates) ? candidates : EMPTY_ARRAY;
}

function safeFingerprint(value) {
  return typeof value === "string" ? value.trim() : "";
}

function buildFingerprintSet(items) {
  const set = new Set();
  for (let i = 0; i < items.length; i += 1) {
    const fingerprint = safeFingerprint(items[i] && items[i].fingerprint);
    if (fingerprint) set.add(fingerprint);
  }
  return set;
}

function buildPromotionMap(items) {
  const map = new Map();
  for (let i = 0; i < items.length; i += 1) {
    const row = items[i];
    const fingerprint = safeFingerprint(row && row.fingerprint);
    if (!fingerprint || map.has(fingerprint)) continue;
    map.set(fingerprint, row);
  }
  return map;
}

function buildConsolidationMap(groups) {
  const map = new Map();
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    if (!group || typeof group !== "object" || Array.isArray(group)) continue;
    const key = typeof group.consolidationKey === "string" ? group.consolidationKey : "";
    if (!key) continue;
    const candidateFingerprints = Array.isArray(group.candidateFingerprints) ? group.candidateFingerprints : EMPTY_ARRAY;
    const suppressedFingerprints = Array.isArray(group.suppressedFingerprints) ? group.suppressedFingerprints : EMPTY_ARRAY;
    const canonicalFingerprint = typeof group.canonicalFingerprint === "string" ? group.canonicalFingerprint : "";
    for (let j = 0; j < candidateFingerprints.length; j += 1) {
      const fingerprint = safeFingerprint(candidateFingerprints[j]);
      if (fingerprint) {
        map.set(fingerprint, {
          consolidationKey: key,
          canonicalFingerprint,
          suppressedFingerprints,
        });
      }
    }
  }
  return map;
}

function countPromotionReady(ranking) {
  let count = 0;
  for (let i = 0; i < ranking.length; i += 1) {
    if (ranking[i] && ranking[i].promotionState === "promotion_ready") count += 1;
  }
  return count;
}

function countRuntimeApproved(runtimeApprovedCandidates) {
  return Array.isArray(runtimeApprovedCandidates) ? runtimeApprovedCandidates.length : 0;
}

function totalViolations(violations) {
  if (!violations || typeof violations !== "object" || Array.isArray(violations)) return 0;
  return Object.values(violations).reduce((sum, value) => (
    sum + (value && typeof value === "object" && !Array.isArray(value) && typeof value.totalViolationCount === "number"
      ? value.totalViolationCount
      : 0)
  ), 0);
}

function buildRow(candidate, runtimeApprovedSet, promotionMap, consolidationMap) {
  const fingerprint = safeFingerprint(candidate && candidate.fingerprint);
  const promotion = promotionMap.get(fingerprint) || {};
  const consolidation = consolidationMap.get(fingerprint) || null;
  const suppressedFingerprints = consolidation && Array.isArray(consolidation.suppressedFingerprints)
    ? consolidation.suppressedFingerprints
    : EMPTY_ARRAY;

  return Object.freeze({
    fingerprint,
    approvalState: typeof candidate.approvalState === "string" ? candidate.approvalState.trim() : "",
    promotionState: typeof promotion.promotionState === "string" ? promotion.promotionState : "blocked",
    promotionScore: typeof promotion.promotionScore === "number" ? promotion.promotionScore : 0,
    runtimeEligible: runtimeApprovedSet.has(fingerprint),
    consolidationKey: consolidation ? consolidation.consolidationKey : null,
    isCanonical: consolidation ? consolidation.canonicalFingerprint === fingerprint : false,
    isSuppressed: suppressedFingerprints.indexOf(fingerprint) >= 0,
  });
}

function sortAuditRows(a, b) {
  if (a.runtimeEligible !== b.runtimeEligible) return a.runtimeEligible ? -1 : 1;
  if (b.promotionScore !== a.promotionScore) return b.promotionScore - a.promotionScore;
  if (a.isCanonical !== b.isCanonical) return a.isCanonical ? -1 : 1;
  if (a.isSuppressed !== b.isSuppressed) return a.isSuppressed ? 1 : -1;
  return a.fingerprint.localeCompare(b.fingerprint);
}

export function buildJobLearningRegistrySnapshot(candidates) {
  try {
    const normalizedCandidates = normalizeCandidates(candidates);

    const policyHealth = summarizeLearningPolicyHealth(normalizedCandidates);
    const approvalHealth = summarizeApprovalWorkflowHealth(normalizedCandidates);
    const runtimeHealth = summarizeRuntimeIsolationHealth(normalizedCandidates);
    const promotionHealth = summarizePromotionHealth(normalizedCandidates);
    const consolidationHealth = summarizeConsolidationHealth(normalizedCandidates);
    const runtimeApprovedCandidates = getRuntimeApprovedCandidates(normalizedCandidates);
    const promotionRanking = rankPromotionCandidates(normalizedCandidates);
    const consolidationGroups = groupConsolidationCandidates(normalizedCandidates);

    const violations = Object.freeze({
      policy: detectLearningPolicyViolations(normalizedCandidates),
      approval: detectApprovalWorkflowViolations(normalizedCandidates),
      runtime: detectRuntimeIsolationViolations(normalizedCandidates),
      promotion: detectPromotionViolations(normalizedCandidates),
      consolidation: detectConsolidationViolations(normalizedCandidates),
    });

    return Object.freeze({
      totalCandidates: normalizedCandidates.length,
      policyHealth,
      approvalHealth,
      runtimeHealth,
      promotionHealth,
      consolidationHealth,
      runtimeApprovedCandidates,
      promotionRanking,
      consolidationGroups,
      violations,
    });
  } catch {
    return ZERO_SNAPSHOT;
  }
}

export function summarizeJobLearningRegistrySnapshot(candidates) {
  try {
    const snapshot = buildJobLearningRegistrySnapshot(candidates);
    const blockedRuntimeCount = snapshot.runtimeHealth && typeof snapshot.runtimeHealth.blocked === "number"
      ? snapshot.runtimeHealth.blocked
      : 0;
    const runtimeApprovedCount = countRuntimeApproved(snapshot.runtimeApprovedCandidates);
    const promotionReadyCount = countPromotionReady(snapshot.promotionRanking);
    const duplicateGroupCount = snapshot.consolidationHealth && typeof snapshot.consolidationHealth.duplicateGroups === "number"
      ? snapshot.consolidationHealth.duplicateGroups
      : 0;
    const suppressedCandidateCount = snapshot.consolidationHealth && typeof snapshot.consolidationHealth.suppressedCount === "number"
      ? snapshot.consolidationHealth.suppressedCount
      : 0;
    const runtimeViolations = snapshot.violations && snapshot.violations.runtime ? snapshot.violations.runtime.totalViolationCount : 0;
    const approvalViolations = snapshot.violations && snapshot.violations.approval ? snapshot.violations.approval.totalViolationCount : 0;
    const policyViolations = snapshot.violations && snapshot.violations.policy ? snapshot.violations.policy.totalViolationCount : 0;
    const promotionViolations = snapshot.violations && snapshot.violations.promotion ? snapshot.violations.promotion.totalViolationCount : 0;
    let overallRisk = "low";

    if (runtimeViolations > 0) {
      overallRisk = "critical";
    } else if (approvalViolations > 0 && (snapshot.runtimeHealth && snapshot.runtimeHealth.approvedEligible > 0)) {
      overallRisk = "critical";
    } else if (policyViolations > 0) {
      overallRisk = "high";
    } else if (promotionViolations > 0) {
      overallRisk = "high";
    } else if (duplicateGroupCount > 0) {
      overallRisk = "moderate";
    } else if (blockedRuntimeCount > 0) {
      overallRisk = "moderate";
    }

    return Object.freeze({
      totalCandidates: snapshot.totalCandidates,
      approvedRuntimeCount: runtimeApprovedCount,
      promotionReadyCount,
      blockedRuntimeCount,
      duplicateGroupCount,
      suppressedCandidateCount,
      overallRisk,
    });
  } catch {
    return Object.freeze({
      totalCandidates: 0,
      approvedRuntimeCount: 0,
      promotionReadyCount: 0,
      blockedRuntimeCount: 0,
      duplicateGroupCount: 0,
      suppressedCandidateCount: 0,
      overallRisk: "low",
    });
  }
}

export function detectJobLearningRegistryDrift(candidates) {
  try {
    const snapshot = buildJobLearningRegistrySnapshot(candidates);
    const driftReasons = [];

    if (snapshot.violations.runtime.totalViolationCount > 0) driftReasons.push("runtime_violations");
    if (snapshot.violations.approval.totalViolationCount > 0) driftReasons.push("approval_violations");
    if (snapshot.violations.policy.totalViolationCount > 0) driftReasons.push("policy_violations");
    if (snapshot.violations.promotion.totalViolationCount > 0) driftReasons.push("promotion_violations");
    if (snapshot.consolidationHealth.duplicateGroups > 0) driftReasons.push("consolidation_duplicates");
    if (snapshot.runtimeHealth.blocked > 0) driftReasons.push("runtime_blocked_candidates");
    if (snapshot.totalCandidates > 0 && countRuntimeApproved(snapshot.runtimeApprovedCandidates) === 0) {
      driftReasons.push("no_runtime_approved_candidates");
    }

    return Object.freeze({
      hasDrift: driftReasons.length > 0,
      driftReasons: Object.freeze(driftReasons),
    });
  } catch {
    return Object.freeze({
      hasDrift: false,
      driftReasons: Object.freeze([]),
    });
  }
}

export function getJobLearningRegistryAuditRows(candidates) {
  try {
    if (!Array.isArray(candidates)) return EMPTY_ARRAY;

    const snapshot = buildJobLearningRegistrySnapshot(candidates);
    const runtimeApprovedSet = buildFingerprintSet(snapshot.runtimeApprovedCandidates);
    const promotionMap = buildPromotionMap(snapshot.promotionRanking);
    const consolidationMap = buildConsolidationMap(snapshot.consolidationGroups);
    const rows = [];

    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i];
      const fingerprint = safeFingerprint(candidate && candidate.fingerprint);
      if (!fingerprint) continue;
      rows.push(buildRow(candidate, runtimeApprovedSet, promotionMap, consolidationMap));
    }

    return rows.sort(sortAuditRows);
  } catch {
    return EMPTY_ARRAY;
  }
}
