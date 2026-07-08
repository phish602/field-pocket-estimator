// @ts-nocheck
/* eslint-disable */

const MAX_CANDIDATES = 1000;
const MAX_SEQUENCE_LENGTH = 6;

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
    .slice(0, MAX_SEQUENCE_LENGTH);
}

function normalizeCandidate(candidate) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const sequence = normalizeSequence(candidate.sequence);
  if (!sequence.length) return null;

  return {
    patternId: safeString(candidate.patternId),
    sequence,
    frequency: Math.max(0, Math.floor(safeNumber(candidate.frequency, 0))),
    confidence: roundMetric(clamp(safeNumber(candidate.confidence, 0))),
  };
}

function buildSequenceKey(sequence) {
  return JSON.stringify(normalizeSequence(sequence));
}

function buildRegistryId(sequence) {
  const normalized = normalizeSequence(sequence);
  const core = normalized
    .map((item) => safeString(item).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase())
    .filter(Boolean)
    .join("_");
  return `workflow_${core || "unknown"}_v1`;
}

export function classifyPatternTier(candidate) {
  try {
    const confidence = clamp(safeNumber(candidate?.confidence, 0));
    if (confidence >= 0.8) return "high_confidence";
    if (confidence >= 0.6) return "stable";
    if (confidence >= 0.4) return "emerging";
    return "unstable";
  } catch {
    return "unstable";
  }
}

export function dedupeWorkflowCandidates(candidates) {
  try {
    const list = Array.isArray(candidates) ? candidates.slice(0, MAX_CANDIDATES) : [];
    const deduped = new Map();

    for (const rawCandidate of list) {
      const candidate = normalizeCandidate(rawCandidate);
      if (!candidate) continue;

      const key = buildSequenceKey(candidate.sequence);
      const existing = deduped.get(key);
      if (!existing) {
        deduped.set(key, { ...candidate });
        continue;
      }

      deduped.set(key, {
        patternId: safeString(existing.patternId || candidate.patternId),
        sequence: candidate.sequence.slice(),
        frequency: Math.max(0, existing.frequency + candidate.frequency),
        confidence: Math.max(existing.confidence, candidate.confidence),
      });
    }

    return [...deduped.values()].sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return buildRegistryId(a.sequence).localeCompare(buildRegistryId(b.sequence));
    });
  } catch {
    return [];
  }
}

export function createJobPatternRegistry(candidates) {
  try {
    const deduped = dedupeWorkflowCandidates(candidates);
    return deduped.map((candidate) => ({
      registryId: buildRegistryId(candidate.sequence),
      type: "workflow_sequence",
      tier: classifyPatternTier(candidate),
      confidence: roundMetric(clamp(candidate.confidence)),
      frequency: Math.max(0, Math.floor(safeNumber(candidate.frequency, 0))),
      reusable: false,
      approvedForRuntime: false,
      sequence: candidate.sequence.slice(0, MAX_SEQUENCE_LENGTH),
    })).sort((a, b) => {
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      if (b.frequency !== a.frequency) return b.frequency - a.frequency;
      return a.registryId.localeCompare(b.registryId);
    });
  } catch {
    return [];
  }
}

export function summarizeRegistryHealth(registry) {
  try {
    const list = Array.isArray(registry) ? registry : [];
    const normalized = list
      .filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
      .map((entry) => ({
        tier: safeString(entry.tier, "unstable"),
        reusable: entry.reusable === true,
        approvedForRuntime: entry.approvedForRuntime === true,
      }));

    return {
      totalRegistryEntries: normalized.length,
      stableCount: normalized.filter((entry) => entry.tier === "stable").length,
      highConfidenceCount: normalized.filter((entry) => entry.tier === "high_confidence").length,
      unstableCount: normalized.filter((entry) => entry.tier === "unstable").length,
      reusableEnabledCount: normalized.filter((entry) => entry.reusable).length,
      runtimeApprovedCount: normalized.filter((entry) => entry.approvedForRuntime).length,
    };
  } catch {
    return {
      totalRegistryEntries: 0,
      stableCount: 0,
      highConfidenceCount: 0,
      unstableCount: 0,
      reusableEnabledCount: 0,
      runtimeApprovedCount: 0,
    };
  }
}
