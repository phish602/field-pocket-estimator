// @ts-nocheck
/* eslint-disable */

const MAX_REGISTRY_ENTRIES = 1000;
const MAX_WORKFLOW_SUMMARIES = 5;
const SECTION_KEYS = ["scope", "labor", "materials"];
const TIER_ORDER = {
  unstable: 0,
  emerging: 1,
  stable: 2,
  high_confidence: 3,
};

function safeString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function roundMetric(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.round(next * 1000) / 1000;
}

function normalizeSequence(sequence) {
  if (!Array.isArray(sequence)) return [];
  return sequence
    .map((item) => safeString(item))
    .filter(Boolean)
    .slice(0, 6);
}

function normalizeRegistryEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  return {
    registryId: safeString(entry.registryId),
    confidence: roundMetric(clamp(safeNumber(entry.confidence, 0))),
    frequency: Math.max(0, Math.floor(safeNumber(entry.frequency, 0))),
    tier: safeString(entry.tier, "unstable"),
    reusable: entry.reusable === true,
    approvedForRuntime: entry.approvedForRuntime === true,
    sequence: normalizeSequence(entry.sequence),
  };
}

function normalizeRegistry(registry) {
  try {
    const list = Array.isArray(registry) ? registry.slice(0, MAX_REGISTRY_ENTRIES) : [];
    return list.map(normalizeRegistryEntry).filter(Boolean);
  } catch {
    return [];
  }
}

function summarizeWorkflowEntry(entry) {
  return {
    registryId: safeString(entry?.registryId, "unknown"),
    confidence: roundMetric(safeNumber(entry?.confidence, 0)),
    frequency: Math.max(0, Math.floor(safeNumber(entry?.frequency, 0))),
    tier: safeString(entry?.tier, "unstable"),
    sequence: normalizeSequence(entry?.sequence),
  };
}

function compareWorkflowStrength(a, b) {
  const tierDelta = (TIER_ORDER[safeString(b?.tier, "unstable")] || 0) - (TIER_ORDER[safeString(a?.tier, "unstable")] || 0);
  if (tierDelta !== 0) return tierDelta;
  const confidenceDelta = safeNumber(b?.confidence, 0) - safeNumber(a?.confidence, 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  const frequencyDelta = safeNumber(b?.frequency, 0) - safeNumber(a?.frequency, 0);
  if (frequencyDelta !== 0) return frequencyDelta;
  return safeString(a?.registryId).localeCompare(safeString(b?.registryId));
}

function compareWorkflowWeakness(a, b) {
  const tierDelta = (TIER_ORDER[safeString(a?.tier, "unstable")] || 0) - (TIER_ORDER[safeString(b?.tier, "unstable")] || 0);
  if (tierDelta !== 0) return tierDelta;
  const confidenceDelta = safeNumber(a?.confidence, 0) - safeNumber(b?.confidence, 0);
  if (confidenceDelta !== 0) return confidenceDelta;
  const frequencyDelta = safeNumber(a?.frequency, 0) - safeNumber(b?.frequency, 0);
  if (frequencyDelta !== 0) return frequencyDelta;
  return safeString(a?.registryId).localeCompare(safeString(b?.registryId));
}

function normalizeSectionMetrics(section) {
  const source = section && typeof section === "object" && !Array.isArray(section) ? section : {};
  return {
    acceptanceRate: roundMetric(clamp(safeNumber(source.acceptanceRate, 0))),
    validationFailureRate: roundMetric(clamp(safeNumber(source.validationFailureRate, 0))),
    rewriteSignalStrength: roundMetric(clamp(safeNumber(source.rewriteSignalStrength, 0))),
    saveCompletionRate: roundMetric(clamp(safeNumber(source.saveCompletionRate, 0))),
    confidenceScore: roundMetric(clamp(safeNumber(source.confidenceScore, 0))),
  };
}

export function summarizeWorkflowStrength(registry) {
  try {
    const normalized = normalizeRegistry(registry);
    const strongest = normalized
      .slice()
      .sort(compareWorkflowStrength)
      .slice(0, MAX_WORKFLOW_SUMMARIES)
      .map(summarizeWorkflowEntry);
    const weakest = normalized
      .slice()
      .sort(compareWorkflowWeakness)
      .slice(0, MAX_WORKFLOW_SUMMARIES)
      .map(summarizeWorkflowEntry);

    return {
      strongestWorkflows: strongest,
      weakestWorkflows: weakest,
      stableWorkflowCount: normalized.filter((entry) => entry.tier === "stable").length,
      highConfidenceWorkflowCount: normalized.filter((entry) => entry.tier === "high_confidence").length,
      unstableWorkflowCount: normalized.filter((entry) => entry.tier === "unstable").length,
    };
  } catch {
    return {
      strongestWorkflows: [],
      weakestWorkflows: [],
      stableWorkflowCount: 0,
      highConfidenceWorkflowCount: 0,
      unstableWorkflowCount: 0,
    };
  }
}

export function summarizeSectionHealth(stabilitySignals) {
  try {
    const signals = stabilitySignals && typeof stabilitySignals === "object" && !Array.isArray(stabilitySignals)
      ? stabilitySignals
      : {};
    const normalizedSections = SECTION_KEYS.map((key) => ({
      sectionKey: key,
      ...normalizeSectionMetrics(signals[key]),
    }));

    const healthiest = normalizedSections
      .slice()
      .sort((a, b) => {
        const confidenceDelta = b.confidenceScore - a.confidenceScore;
        if (confidenceDelta !== 0) return confidenceDelta;
        return a.sectionKey.localeCompare(b.sectionKey);
      })[0] || { sectionKey: "scope", ...normalizeSectionMetrics(null) };

    const weakest = normalizedSections
      .slice()
      .sort((a, b) => {
        const confidenceDelta = a.confidenceScore - b.confidenceScore;
        if (confidenceDelta !== 0) return confidenceDelta;
        return a.sectionKey.localeCompare(b.sectionKey);
      })[0] || { sectionKey: "scope", ...normalizeSectionMetrics(null) };

    return {
      healthiestSection: healthiest,
      weakestSection: weakest,
      validationRiskIndicators: normalizedSections.map((section) => ({
        sectionKey: section.sectionKey,
        validationFailureRate: section.validationFailureRate,
        atRisk: section.validationFailureRate >= 0.25,
      })),
      rewritePressureIndicators: normalizedSections.map((section) => ({
        sectionKey: section.sectionKey,
        rewriteSignalStrength: section.rewriteSignalStrength,
        elevated: section.rewriteSignalStrength >= 0.4,
      })),
      saveCompletionIndicators: normalizedSections.map((section) => ({
        sectionKey: section.sectionKey,
        saveCompletionRate: section.saveCompletionRate,
        healthy: section.saveCompletionRate >= 0.5,
      })),
    };
  } catch {
    return {
      healthiestSection: { sectionKey: "scope", ...normalizeSectionMetrics(null) },
      weakestSection: { sectionKey: "scope", ...normalizeSectionMetrics(null) },
      validationRiskIndicators: [],
      rewritePressureIndicators: [],
      saveCompletionIndicators: [],
    };
  }
}

export function summarizeCandidateReadiness(registry) {
  try {
    const normalized = normalizeRegistry(registry);
    return {
      totalCandidates: normalized.length,
      reusableEnabledCount: normalized.filter((entry) => entry.reusable).length,
      runtimeApprovedCount: normalized.filter((entry) => entry.approvedForRuntime).length,
      quarantinedCount: normalized.filter((entry) => entry.tier === "unstable" && !entry.reusable && !entry.approvedForRuntime).length,
      stableButNotApprovedCount: normalized.filter((entry) => entry.tier === "stable" && !entry.approvedForRuntime).length,
      highConfidenceButNotApprovedCount: normalized.filter((entry) => entry.tier === "high_confidence" && !entry.approvedForRuntime).length,
    };
  } catch {
    return {
      totalCandidates: 0,
      reusableEnabledCount: 0,
      runtimeApprovedCount: 0,
      quarantinedCount: 0,
      stableButNotApprovedCount: 0,
      highConfidenceButNotApprovedCount: 0,
    };
  }
}

export function detectRegistryAnomalies(registry) {
  try {
    const list = Array.isArray(registry) ? registry.slice(0, MAX_REGISTRY_ENTRIES) : [];
    const seenIds = new Set();
    const duplicateRegistryIds = new Set();
    const invalidConfidenceRanges = [];
    const emptySequences = [];
    const unstableMarkedReusable = [];
    const runtimeApprovedBelowStableTier = [];

    for (const rawEntry of list) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry)) continue;

      const registryId = safeString(rawEntry.registryId);
      const confidence = safeNumber(rawEntry.confidence, 0);
      const tier = safeString(rawEntry.tier, "unstable");
      const reusable = rawEntry.reusable === true;
      const approvedForRuntime = rawEntry.approvedForRuntime === true;
      const sequence = normalizeSequence(rawEntry.sequence);

      if (registryId) {
        if (seenIds.has(registryId)) duplicateRegistryIds.add(registryId);
        seenIds.add(registryId);
      }

      if (!(confidence >= 0 && confidence <= 1)) {
        invalidConfidenceRanges.push(registryId || "unknown");
      }

      if (!sequence.length) {
        emptySequences.push(registryId || "unknown");
      }

      if (tier === "unstable" && reusable) {
        unstableMarkedReusable.push(registryId || "unknown");
      }

      if (approvedForRuntime && (TIER_ORDER[tier] || 0) < TIER_ORDER.stable) {
        runtimeApprovedBelowStableTier.push(registryId || "unknown");
      }
    }

    return {
      duplicateRegistryIds: [...duplicateRegistryIds].sort(),
      invalidConfidenceRanges: invalidConfidenceRanges.sort(),
      emptySequences: emptySequences.sort(),
      unstablePatternsMarkedReusable: unstableMarkedReusable.sort(),
      runtimeApprovedBelowStableTier: runtimeApprovedBelowStableTier.sort(),
    };
  } catch {
    return {
      duplicateRegistryIds: [],
      invalidConfidenceRanges: [],
      emptySequences: [],
      unstablePatternsMarkedReusable: [],
      runtimeApprovedBelowStableTier: [],
    };
  }
}
