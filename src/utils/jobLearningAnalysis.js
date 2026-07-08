// @ts-nocheck
/* eslint-disable */

const MAX_EVENTS = 5000;
const MAX_SEQUENCE_LENGTH = 6;
const SEQUENCE_GAP_MS = 5 * 60 * 1000;
const DEFAULT_ACCEPTANCE_METRICS = {
  requests: 0,
  results: 0,
  accepts: 0,
  validationFailures: 0,
  acceptanceRateFromRequests: 0,
  acceptanceRateFromResults: 0,
};

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

function incrementCount(bucket, key) {
  const normalizedKey = safeString(key, "unknown");
  bucket[normalizedKey] = (Number(bucket[normalizedKey] || 0) || 0) + 1;
}

function normalizeLearningEvent(event, index = 0) {
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
    inputLength: Math.max(0, safeNumber(event.inputLength, 0)),
    scopeTextLength: Math.max(0, safeNumber(event.scopeTextLength, 0)),
    laborLineCount: Math.max(0, safeNumber(event.laborLineCount, 0)),
    materialItemCount: Math.max(0, safeNumber(event.materialItemCount, 0)),
    writeKeyCount: Math.max(0, safeNumber(event.writeKeyCount, 0)),
    success: safeBoolean(event.success),
    hasWrites: safeBoolean(event.hasWrites),
    validationValid: safeBoolean(event.validationValid),
    hasValidationError: safeBoolean(event.hasValidationError),
  };
}

function normalizeLearningEvents(events) {
  try {
    const list = Array.isArray(events) ? events.slice(0, MAX_EVENTS) : [];
    const normalized = list
      .map((event, index) => normalizeLearningEvent(event, index))
      .filter(Boolean);

    normalized.sort((a, b) => {
      const delta = a.timestamp - b.timestamp;
      if (delta !== 0) return delta;
      return a._index - b._index;
    });

    return normalized;
  } catch {
    return [];
  }
}

function createSequenceToken(event) {
  const seam = safeString(event?.seam);
  const sectionKey = safeString(event?.sectionKey);
  const saveType = safeString(event?.saveType || event?.docType);

  if (seam === "document_save") {
    return `${saveType || "document"}_save`;
  }
  if (seam === "assist_request" || seam === "assist_result" || seam === "assist_accept") {
    return `${sectionKey || "unknown"}_${seam.replace("assist_", "")}`;
  }
  return `${sectionKey || "unknown"}_${seam || "unknown"}`;
}

function finalizeSequenceGroup(groupedSequences, sequence) {
  if (!Array.isArray(sequence) || !sequence.length) return;
  const trimmed = sequence.slice(0, MAX_SEQUENCE_LENGTH);
  const key = JSON.stringify(trimmed);
  groupedSequences.set(key, (groupedSequences.get(key) || 0) + 1);
}

function roundRate(numerator, denominator) {
  if (!denominator) return 0;
  return Math.round((numerator / denominator) * 1000) / 1000;
}

function buildAcceptanceMetrics(events, sectionKey) {
  const relevant = events.filter((event) => event.sectionKey === sectionKey);
  const requests = relevant.filter((event) => event.seam === "assist_request").length;
  const results = relevant.filter((event) => event.seam === "assist_result").length;
  const accepts = relevant.filter((event) => event.seam === "assist_accept").length;
  const validationFailures = relevant.filter((event) => event.seam === "assist_result" && event.hasValidationError).length;

  return {
    requests,
    results,
    accepts,
    validationFailures,
    acceptanceRateFromRequests: roundRate(accepts, requests),
    acceptanceRateFromResults: roundRate(accepts, results),
  };
}

export function getLearningEventStats(events) {
  try {
    const normalized = normalizeLearningEvents(events);
    const stats = {
      totalEvents: normalized.length,
      bySectionKey: {},
      bySeam: {},
      byMode: {},
      byResultType: {},
      byAcceptedAction: {},
      saveTypeCounts: {},
    };

    for (const event of normalized) {
      incrementCount(stats.bySectionKey, event.sectionKey);
      incrementCount(stats.bySeam, event.seam);
      incrementCount(stats.byMode, event.mode);
      incrementCount(stats.byResultType, event.resultType);
      incrementCount(stats.byAcceptedAction, event.acceptedAction);
      incrementCount(stats.saveTypeCounts, event.saveType);
    }

    return stats;
  } catch {
    return {
      totalEvents: 0,
      bySectionKey: {},
      bySeam: {},
      byMode: {},
      byResultType: {},
      byAcceptedAction: {},
      saveTypeCounts: {},
    };
  }
}

export function getLearningWorkflowSequences(events) {
  try {
    const normalized = normalizeLearningEvents(events);
    if (!normalized.length) return [];

    const groupedSequences = new Map();
    let currentSequence = [];
    let previousTimestamp = 0;

    for (const event of normalized) {
      const timestamp = event.timestamp;
      const token = createSequenceToken(event);
      const gapExceeded = previousTimestamp > 0 && timestamp > 0 && (timestamp - previousTimestamp) > SEQUENCE_GAP_MS;
      const reachedMaxLength = currentSequence.length >= MAX_SEQUENCE_LENGTH;

      if (gapExceeded || reachedMaxLength) {
        finalizeSequenceGroup(groupedSequences, currentSequence);
        currentSequence = [];
      }

      currentSequence.push(token);
      previousTimestamp = timestamp || previousTimestamp;
    }

    finalizeSequenceGroup(groupedSequences, currentSequence);

    return [...groupedSequences.entries()]
      .map(([key, count]) => ({
        sequence: JSON.parse(key),
        count,
      }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        return JSON.stringify(a.sequence).localeCompare(JSON.stringify(b.sequence));
      });
  } catch {
    return [];
  }
}

export function getLearningAcceptanceRates(events) {
  try {
    const normalized = normalizeLearningEvents(events);
    return {
      scope: buildAcceptanceMetrics(normalized, "scope"),
      labor: buildAcceptanceMetrics(normalized, "labor"),
      materials: buildAcceptanceMetrics(normalized, "materials"),
    };
  } catch {
    return {
      scope: { ...DEFAULT_ACCEPTANCE_METRICS },
      labor: { ...DEFAULT_ACCEPTANCE_METRICS },
      materials: { ...DEFAULT_ACCEPTANCE_METRICS },
    };
  }
}

export function getLearningEditSignals(events) {
  try {
    const normalized = normalizeLearningEvents(events);
    const laborAccepts = normalized.filter((event) => event.sectionKey === "labor" && event.seam === "assist_accept").length;
    const materialsAccepts = normalized.filter((event) => event.sectionKey === "materials" && event.seam === "assist_accept").length;
    const saveEvents = normalized.filter((event) => event.seam === "document_save").length;
    const repeatedValidationFailures = normalized.filter((event) => event.seam === "assist_result" && event.hasValidationError).length;

    const sequenceGroups = [];
    let currentGroup = [];
    let previousTimestamp = 0;

    for (const event of normalized) {
      const gapExceeded = previousTimestamp > 0 && event.timestamp > 0 && (event.timestamp - previousTimestamp) > SEQUENCE_GAP_MS;
      if (gapExceeded) {
        if (currentGroup.length) sequenceGroups.push(currentGroup);
        currentGroup = [];
      }
      currentGroup.push(event);
      previousTimestamp = event.timestamp || previousTimestamp;
    }
    if (currentGroup.length) sequenceGroups.push(currentGroup);

    const saveWithoutAcceptPatterns = sequenceGroups.reduce((count, group) => {
      const hasSave = group.some((event) => event.seam === "document_save");
      const hasAccept = group.some((event) => event.seam === "assist_accept");
      return count + (hasSave && !hasAccept ? 1 : 0);
    }, 0);

    return {
      highLaborRewriteFrequency: laborAccepts >= Math.max(3, saveEvents),
      highMaterialsRewriteFrequency: materialsAccepts >= Math.max(3, saveEvents),
      repeatedValidationFailures: repeatedValidationFailures >= 3,
      saveWithoutAcceptPatterns,
      counts: {
        laborAccepts,
        materialsAccepts,
        validationFailures: repeatedValidationFailures,
        saveEvents,
      },
    };
  } catch {
    return {
      highLaborRewriteFrequency: false,
      highMaterialsRewriteFrequency: false,
      repeatedValidationFailures: false,
      saveWithoutAcceptPatterns: 0,
      counts: {
        laborAccepts: 0,
        materialsAccepts: 0,
        validationFailures: 0,
        saveEvents: 0,
      },
    };
  }
}
