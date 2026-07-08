// @ts-nocheck
/* eslint-disable */

const MAX_EVENTS = 5000;
const MAX_SEQUENCE_LENGTH = 6;
const MIN_PATTERN_FREQUENCY = 2;
const HIGH_CONFIDENCE_THRESHOLD = 0.75;
const STABLE_WORKFLOW_THRESHOLD = 0.6;
const SEQUENCE_GAP_MS = 5 * 60 * 1000;
const SECTION_KEYS = ["scope", "labor", "materials"];

function safeString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function safeBoolean(value) {
  return value === true;
}

function roundMetric(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.round(next * 1000) / 1000;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalizeEvent(event, index = 0) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const seam = safeString(event.seam || event.source);
  if (!seam) return null;

  return {
    _index: index,
    seam,
    source: safeString(event.source || seam),
    sectionKey: safeString(event.sectionKey, "unknown"),
    mode: safeString(event.mode, "unknown"),
    docType: safeString(event.docType, "unknown"),
    resultType: safeString(event.resultType, "unknown"),
    acceptedAction: safeString(event.acceptedAction, "none"),
    saveType: safeString(event.saveType || event.docType, "unknown"),
    timestamp: Math.max(0, safeNumber(event.timestamp, 0)),
    success: safeBoolean(event.success),
    hasWrites: safeBoolean(event.hasWrites),
    validationValid: safeBoolean(event.validationValid),
    hasValidationError: safeBoolean(event.hasValidationError),
  };
}

function normalizeEvents(events) {
  try {
    const list = Array.isArray(events) ? events.slice(0, MAX_EVENTS) : [];
    const malformedEventsIgnored = Math.max(0, list.length - list.filter((item) => item && typeof item === "object" && !Array.isArray(item)).length);
    const normalized = list
      .map((event, index) => normalizeEvent(event, index))
      .filter(Boolean);

    normalized.sort((a, b) => {
      const delta = a.timestamp - b.timestamp;
      if (delta !== 0) return delta;
      return a._index - b._index;
    });

    return {
      normalized,
      malformedEventsIgnored: malformedEventsIgnored + Math.max(0, list.filter((item) => item && typeof item === "object" && !Array.isArray(item)).length - normalized.length),
    };
  } catch {
    return { normalized: [], malformedEventsIgnored: 0 };
  }
}

function createSequenceToken(event) {
  const seam = safeString(event?.seam);
  const sectionKey = safeString(event?.sectionKey);
  const saveType = safeString(event?.saveType || event?.docType);

  if (seam === "document_save") return `${saveType || "document"}_save`;
  if (seam === "assist_request" || seam === "assist_result" || seam === "assist_accept") {
    return `${sectionKey || "unknown"}_${seam.replace("assist_", "")}`;
  }
  return `${sectionKey || "unknown"}_${seam || "unknown"}`;
}

function groupEventSequences(events) {
  const groups = [];
  let currentGroup = [];
  let previousTimestamp = 0;

  for (const event of events) {
    const gapExceeded = previousTimestamp > 0 && event.timestamp > 0 && (event.timestamp - previousTimestamp) > SEQUENCE_GAP_MS;
    const maxReached = currentGroup.length >= MAX_SEQUENCE_LENGTH;

    if ((gapExceeded || maxReached) && currentGroup.length) {
      groups.push(currentGroup);
      currentGroup = [];
    }

    currentGroup.push(event);
    previousTimestamp = event.timestamp || previousTimestamp;
  }

  if (currentGroup.length) groups.push(currentGroup);
  return groups;
}

function buildPatternId(sequence) {
  const arr = Array.isArray(sequence) ? sequence : [];
  const filtered = arr.filter(Boolean).slice(0, MAX_SEQUENCE_LENGTH);
  if (!filtered.length) return "unknown_pattern";

  const core = filtered
    .map((token) => safeString(token).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase())
    .filter(Boolean)
    .join("_");

  return core || "unknown_pattern";
}

function countSequences(sequenceGroups) {
  const map = new Map();
  for (const group of sequenceGroups) {
    const sequence = (Array.isArray(group) ? group : []).map(createSequenceToken).filter(Boolean).slice(0, MAX_SEQUENCE_LENGTH);
    if (!sequence.length) continue;
    const key = JSON.stringify(sequence);
    map.set(key, (map.get(key) || 0) + 1);
  }
  return map;
}

function computePatternConfidence(sequence, frequency, totalGroups, events) {
  const seq = Array.isArray(sequence) ? sequence : [];
  const eventList = Array.isArray(events) ? events : [];
  const hasAccept = seq.some((token) => /_accept$/.test(token));
  const hasSave = seq.some((token) => /_save$/.test(token));
  const acceptEvents = eventList.filter((event) => event.seam === "assist_accept").length;
  const validationFailures = eventList.filter((event) => event.seam === "assist_result" && event.hasValidationError).length;
  const resultEvents = eventList.filter((event) => event.seam === "assist_result").length;
  const rewriteEvents = eventList.filter((event) => event.seam === "assist_accept" && SECTION_KEYS.includes(event.sectionKey)).length;

  const frequencyScore = clamp(frequency / Math.max(MIN_PATTERN_FREQUENCY + 2, totalGroups || 1));
  const acceptanceScore = hasAccept ? 1 : acceptEvents > 0 ? 0.35 : 0;
  const saveScore = hasSave ? 1 : 0;
  const validationPenalty = resultEvents > 0 ? clamp(validationFailures / resultEvents) : 0;
  const rewritePenalty = eventList.length > 0 ? clamp(rewriteEvents / Math.max(eventList.length, 1)) : 0;

  const weighted = (
    (frequencyScore * 0.38)
    + (acceptanceScore * 0.24)
    + (saveScore * 0.24)
    + ((1 - validationPenalty) * 0.09)
    + ((1 - rewritePenalty) * 0.05)
  );

  return roundMetric(clamp(weighted));
}

function buildSectionStability(events, sectionKey) {
  const relevant = events.filter((event) => event.sectionKey === sectionKey);
  const requests = relevant.filter((event) => event.seam === "assist_request").length;
  const results = relevant.filter((event) => event.seam === "assist_result").length;
  const accepts = relevant.filter((event) => event.seam === "assist_accept").length;
  const validationFailures = relevant.filter((event) => event.seam === "assist_result" && event.hasValidationError).length;
  const saveAfterAccept = groupEventSequences(events).filter((group) => {
    const hasSectionAccept = group.some((event) => event.sectionKey === sectionKey && event.seam === "assist_accept");
    const hasSave = group.some((event) => event.seam === "document_save");
    return hasSectionAccept && hasSave;
  }).length;

  const acceptanceRate = requests > 0 ? accepts / requests : 0;
  const validationFailureRate = results > 0 ? validationFailures / results : 0;
  const rewriteSignalStrength = accepts > 1 ? clamp((accepts - 1) / Math.max(requests || accepts, 1)) : 0;
  const saveCompletionRate = accepts > 0 ? saveAfterAccept / accepts : 0;
  const confidenceScore = clamp(
    (acceptanceRate * 0.45)
    + ((1 - validationFailureRate) * 0.25)
    + ((1 - rewriteSignalStrength) * 0.15)
    + (saveCompletionRate * 0.15)
  );

  return {
    acceptanceRate: roundMetric(acceptanceRate),
    validationFailureRate: roundMetric(validationFailureRate),
    rewriteSignalStrength: roundMetric(rewriteSignalStrength),
    saveCompletionRate: roundMetric(saveCompletionRate),
    confidenceScore: roundMetric(confidenceScore),
  };
}

export function deriveWorkflowPatternCandidates(events) {
  try {
    const { normalized } = normalizeEvents(events);
    const sequenceGroups = groupEventSequences(normalized);
    const counted = countSequences(sequenceGroups);

    return [...counted.entries()]
      .map(([key, frequency]) => ({
        sequence: JSON.parse(key),
        frequency,
      }))
      .filter((entry) => Array.isArray(entry.sequence) && entry.sequence.length > 0 && entry.frequency >= MIN_PATTERN_FREQUENCY)
      .map((entry) => ({
        patternId: buildPatternId(entry.sequence),
        sequence: entry.sequence.slice(0, MAX_SEQUENCE_LENGTH),
        frequency: entry.frequency,
        confidence: computePatternConfidence(entry.sequence, entry.frequency, sequenceGroups.length, normalized),
      }))
      .sort((a, b) => {
        if (b.confidence !== a.confidence) return b.confidence - a.confidence;
        if (b.frequency !== a.frequency) return b.frequency - a.frequency;
        return a.patternId.localeCompare(b.patternId);
      });
  } catch {
    return [];
  }
}

export function deriveSectionStabilitySignals(events) {
  try {
    const { normalized } = normalizeEvents(events);
    return {
      scope: buildSectionStability(normalized, "scope"),
      labor: buildSectionStability(normalized, "labor"),
      materials: buildSectionStability(normalized, "materials"),
    };
  } catch {
    return {
      scope: buildSectionStability([], "scope"),
      labor: buildSectionStability([], "labor"),
      materials: buildSectionStability([], "materials"),
    };
  }
}

export function deriveSaveCompletionPatterns(events) {
  try {
    const { normalized } = normalizeEvents(events);
    const groups = groupEventSequences(normalized);
    const summary = {
      estimateSaveFlows: 0,
      invoiceSaveFlows: 0,
      saveAfterAccept: 0,
      saveWithoutAccept: 0,
    };

    for (const group of groups) {
      const hasEstimateSave = group.some((event) => event.seam === "document_save" && event.saveType === "estimate");
      const hasInvoiceSave = group.some((event) => event.seam === "document_save" && event.saveType === "invoice");
      const hasAccept = group.some((event) => event.seam === "assist_accept");
      const hasSave = hasEstimateSave || hasInvoiceSave;

      if (hasEstimateSave) summary.estimateSaveFlows += 1;
      if (hasInvoiceSave) summary.invoiceSaveFlows += 1;
      if (hasSave && hasAccept) summary.saveAfterAccept += 1;
      if (hasSave && !hasAccept) summary.saveWithoutAccept += 1;
    }

    return summary;
  } catch {
    return {
      estimateSaveFlows: 0,
      invoiceSaveFlows: 0,
      saveAfterAccept: 0,
      saveWithoutAccept: 0,
    };
  }
}

export function deriveLearningHealthSummary(events) {
  try {
    const { normalized, malformedEventsIgnored } = normalizeEvents(events);
    const candidates = deriveWorkflowPatternCandidates(normalized);
    const stability = deriveSectionStabilitySignals(normalized);

    const stableWorkflowCount = candidates.filter((candidate) => candidate.confidence >= STABLE_WORKFLOW_THRESHOLD).length;
    const unstableWorkflowCount = Math.max(0, candidates.length - stableWorkflowCount);
    const highConfidenceCandidateCount = candidates.filter((candidate) => candidate.confidence >= HIGH_CONFIDENCE_THRESHOLD).length;
    const lowConfidenceCandidateCount = Math.max(0, candidates.length - highConfidenceCandidateCount);
    const sectionConfidenceAverage = roundMetric(
      (
        safeNumber(stability.scope?.confidenceScore, 0)
        + safeNumber(stability.labor?.confidenceScore, 0)
        + safeNumber(stability.materials?.confidenceScore, 0)
      ) / SECTION_KEYS.length
    );

    return {
      totalUsableEvents: normalized.length,
      malformedEventsIgnored,
      stableWorkflowCount,
      unstableWorkflowCount,
      highConfidenceCandidateCount,
      lowConfidenceCandidateCount,
      sectionConfidenceAverage,
    };
  } catch {
    return {
      totalUsableEvents: 0,
      malformedEventsIgnored: 0,
      stableWorkflowCount: 0,
      unstableWorkflowCount: 0,
      highConfidenceCandidateCount: 0,
      lowConfidenceCandidateCount: 0,
      sectionConfidenceAverage: 0,
    };
  }
}
