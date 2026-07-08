// @ts-nocheck
/* eslint-disable */

const EMPTY_ARRAY = Object.freeze([]);
const EMPTY_OBJECT = Object.freeze({});
const ALLOWED_SEAMS = Object.freeze({
  assist_request: true,
  assist_result: true,
  assist_accept: true,
  document_save: true,
});

function safeString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeCount(value) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return 0;
  return Math.floor(next);
}

function isPlainEvent(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeEvent(event, index) {
  if (!isPlainEvent(event)) {
    return {
      kind: "malformed",
      label: `event:${index}`,
      reason: "malformed_event",
      index,
    };
  }

  const seam = safeString(event.seam || event.source);
  if (!seam || !ALLOWED_SEAMS[seam]) {
    return {
      kind: "malformed",
      label: `event:${index}`,
      reason: seam ? "unsupported_event_type" : "missing_event_type",
      index,
    };
  }

  const assistTraceId = safeString(event.assistTraceId);
  const assistSectionKey = safeString(event.assistSectionKey || event.sectionKey);
  const assistDocType = safeString(event.assistDocType || event.docType);
  const assistMode = safeString(event.assistMode || event.mode);

  return {
    kind: "event",
    index,
    seam,
    label: assistTraceId || `event:${index}`,
    assistTraceId,
    assistSectionKey,
    assistDocType,
    assistMode,
    sectionKey: safeString(event.sectionKey),
    docType: safeString(event.docType),
    mode: safeString(event.mode),
    success: event.success === true,
    hasWrites: event.hasWrites === true,
    resultType: safeString(event.resultType),
    writeKeyCount: safeCount(event.writeKeyCount),
    saveDocType: safeString(event.saveDocType || event.docType),
    saveMode: safeString(event.saveMode),
    isProjectSeeded: event.isProjectSeeded === true,
    isInvoiceFromEstimate: event.isInvoiceFromEstimate === true,
    tradeHint: safeString(event.tradeHint),
  };
}

function sortStrings(a, b) {
  return String(a).localeCompare(String(b));
}

function sortQuarantine(a, b) {
  const labelDelta = String(a?.label || "").localeCompare(String(b?.label || ""));
  if (labelDelta !== 0) return labelDelta;
  return String(a?.reason || "").localeCompare(String(b?.reason || ""));
}

function sortTraceIds(a, b) {
  return String(a).localeCompare(String(b));
}

function getTraceState() {
  return {
    events: [],
    requestCount: 0,
    resultCount: 0,
    acceptCount: 0,
    requestEvent: null,
    resultEvent: null,
    acceptEvent: null,
    assistSectionKey: "",
    assistDocType: "",
    assistMode: "",
    traceIssues: EMPTY_ARRAY,
  };
}

function recordTraceEvent(traceState, normalizedEvent) {
  traceState.events.push(normalizedEvent);
  if (normalizedEvent.seam === "assist_request") {
    traceState.requestCount += 1;
    traceState.requestEvent = traceState.requestEvent || normalizedEvent;
  } else if (normalizedEvent.seam === "assist_result") {
    traceState.resultCount += 1;
    traceState.resultEvent = traceState.resultEvent || normalizedEvent;
  } else if (normalizedEvent.seam === "assist_accept") {
    traceState.acceptCount += 1;
    traceState.acceptEvent = traceState.acceptEvent || normalizedEvent;
  }

  const sectionKey = normalizedEvent.assistSectionKey;
  const docType = normalizedEvent.assistDocType;
  const mode = normalizedEvent.assistMode;
  if (sectionKey) {
    if (!traceState.assistSectionKey) traceState.assistSectionKey = sectionKey;
    else if (traceState.assistSectionKey !== sectionKey) traceState.traceIssues = traceState.traceIssues.concat("conflict_section");
  }
  if (docType) {
    if (!traceState.assistDocType) traceState.assistDocType = docType;
    else if (traceState.assistDocType !== docType) traceState.traceIssues = traceState.traceIssues.concat("conflict_doc");
  }
  if (mode) {
    if (!traceState.assistMode) traceState.assistMode = mode;
    else if (traceState.assistMode !== mode) traceState.traceIssues = traceState.traceIssues.concat("conflict_mode");
  }
}

function findMatchingSaveEvent(events, assistDocType, assistSectionKey) {
  const matches = [];
  for (let i = 0; i < events.length; i += 1) {
    const ev = events[i];
    if (!ev || ev.kind !== "event" || ev.seam !== "document_save") continue;
    if (assistDocType && safeString(ev.saveDocType || ev.docType) !== assistDocType) continue;
    matches.push(ev);
  }

  if (matches.length === 0) {
    return { matched: null, duplicate: false };
  }

  if (matches.length > 1) {
    return { matched: null, duplicate: true };
  }

  return { matched: matches[0], duplicate: false };
}

function buildCandidateDraft(traceId, traceState, saveEvent) {
  const assistSectionKey = safeString(traceState.assistSectionKey, "unknown");
  const assistDocType = safeString(traceState.assistDocType, "unknown");
  const assistMode = safeString(traceState.assistMode, "unknown");
  const documentSaveSeen = !!saveEvent;
  const confidence = documentSaveSeen ? 0.8 : 0.75;
  const tradeHint = (() => {
    for (let i = 0; i < traceState.events.length; i += 1) {
      const hint = safeString(traceState.events[i] && traceState.events[i].tradeHint);
      if (hint) return hint;
    }
    return "unknown";
  })();
  const saveDocType = documentSaveSeen ? safeString(saveEvent.saveDocType || saveEvent.docType, null) : null;
  const saveMode = documentSaveSeen ? safeString(saveEvent.saveMode, null) : null;

  return Object.freeze({
    fingerprint: `cand:${traceId}:${assistSectionKey}:${assistDocType}:${assistMode}`,
    approvalState: "needs_review",
    confidence,
    scoringTier: documentSaveSeen ? "stable" : "emerging",
    sequence: Object.freeze(documentSaveSeen
      ? ["assist_request", "assist_result", "assist_accept", "document_save"]
      : ["assist_request", "assist_result", "assist_accept"]),
    saveCount: documentSaveSeen ? 1 : 0,
    acceptedCount: 1,
    workflowClass: assistSectionKey === "scope"
      ? (documentSaveSeen ? "scope_to_save" : "scope_only")
      : "unknown",
    workflowComplexity: documentSaveSeen ? "moderate" : "simple",
    tradeHint,
    assistTraceId: traceId,
    assistSectionKey,
    assistDocType,
    assistMode,
    evidence: Object.freeze({
      requestSeen: true,
      resultSeen: true,
      acceptSeen: true,
      documentSaveSeen,
      resultType: safeString(traceState.resultEvent && traceState.resultEvent.resultType, ""),
      writeKeyCount: safeCount(traceState.resultEvent && traceState.resultEvent.writeKeyCount),
      saveDocType,
      saveMode,
      isProjectSeeded: documentSaveSeen ? !!saveEvent.isProjectSeeded : false,
      isInvoiceFromEstimate: documentSaveSeen ? !!saveEvent.isInvoiceFromEstimate : false,
    }),
  });
}

function buildTraceGroupIndex(events) {
  const traceMap = new Map();
  const quarantineRecords = [];
  const warnings = new Set();
  const nonTraceDocumentSaves = [];

  for (let i = 0; i < events.length; i += 1) {
    const rawEvent = events[i];
    const normalizedEvent = normalizeEvent(rawEvent, i);

    if (normalizedEvent.kind === "malformed") {
      quarantineRecords.push({
        label: normalizedEvent.label,
        reason: normalizedEvent.reason,
      });
      warnings.add(normalizedEvent.reason);
      continue;
    }

    if (normalizedEvent.seam === "document_save") {
      nonTraceDocumentSaves.push(normalizedEvent);
      continue;
    }

    if (!normalizedEvent.assistTraceId) {
      quarantineRecords.push({
        label: normalizedEvent.label,
        reason: "missing_assist_trace_id",
      });
      warnings.add("missing_assist_trace_id");
      continue;
    }

    if (!traceMap.has(normalizedEvent.assistTraceId)) {
      traceMap.set(normalizedEvent.assistTraceId, getTraceState());
    }
    recordTraceEvent(traceMap.get(normalizedEvent.assistTraceId), normalizedEvent);
  }

  return { traceMap, quarantineRecords, warnings, nonTraceDocumentSaves };
}

function finalizeTraceDrafts(traceMap, documentSaves, quarantineRecords, warnings) {
  const candidateDrafts = [];
  const quarantinedEvents = quarantineRecords.slice();
  const traceIds = Array.from(traceMap.keys()).sort(sortTraceIds);
  let completeTraceCount = 0;
  let incompleteTraceCount = 0;
  let duplicateTraceCount = 0;

  for (let i = 0; i < traceIds.length; i += 1) {
    const traceId = traceIds[i];
    const traceState = traceMap.get(traceId) || getTraceState();
    const hasRequest = traceState.requestCount === 1;
    const hasResult = traceState.resultCount === 1;
    const hasAccept = traceState.acceptCount === 1;
    const hasMetadata = !!(traceState.assistSectionKey && traceState.assistDocType && traceState.assistMode);
    const conflictingMetadata = traceState.traceIssues.length > 0;
    const duplicate = traceState.requestCount > 1 || traceState.resultCount > 1 || traceState.acceptCount > 1;
    const incomplete = !hasRequest || !hasResult || !hasAccept || !hasMetadata;
    const resultEvent = traceState.resultEvent;
    const acceptedResult = hasResult && resultEvent && resultEvent.success === true;

    if (duplicate || conflictingMetadata) {
      duplicateTraceCount += 1;
      quarantinedEvents.push({
        label: `trace:${traceId}`,
        reason: duplicate ? "duplicate_trace" : "conflicting_metadata",
      });
      warnings.add(duplicate ? `duplicate_trace:${traceId}` : `conflicting_metadata:${traceId}`);
      continue;
    }

    if (incomplete || !acceptedResult) {
      incompleteTraceCount += 1;
      quarantinedEvents.push({
        label: `trace:${traceId}`,
        reason: !acceptedResult ? "unaccepted_or_failed_result" : "incomplete_trace",
      });
      warnings.add(`incomplete_trace:${traceId}`);
      continue;
    }

    const saveMatch = findMatchingSaveEvent(documentSaves, traceState.assistDocType, traceState.assistSectionKey);
    if (saveMatch.duplicate) {
      duplicateTraceCount += 1;
      quarantinedEvents.push({
        label: `trace:${traceId}`,
        reason: "ambiguous_document_save_context",
      });
      warnings.add(`ambiguous_document_save_context:${traceId}`);
      continue;
    }

    const draft = buildCandidateDraft(traceId, traceState, saveMatch.matched);
    candidateDrafts.push(draft);
    completeTraceCount += 1;
  }

  candidateDrafts.sort((a, b) => String(a.assistTraceId).localeCompare(String(b.assistTraceId)) || String(a.fingerprint).localeCompare(String(b.fingerprint)));
  quarantinedEvents.sort(sortQuarantine);

  const assemblyWarnings = Array.from(warnings).sort(sortStrings);

  return {
    candidateDrafts,
    quarantinedEvents,
    assemblyWarnings,
    completeTraceCount,
    incompleteTraceCount,
    duplicateTraceCount,
  };
}

export function assembleJobLearningCandidateDrafts(events) {
  if (!Array.isArray(events)) {
    return Object.freeze({
      candidateDrafts: EMPTY_ARRAY,
      quarantinedEvents: EMPTY_ARRAY,
      assemblyWarnings: Object.freeze(["malformed_events_input"]),
    });
  }

  const { traceMap, quarantineRecords, warnings, nonTraceDocumentSaves } = buildTraceGroupIndex(events);
  const finalized = finalizeTraceDrafts(traceMap, nonTraceDocumentSaves, quarantineRecords, warnings);

  return Object.freeze({
    candidateDrafts: finalized.candidateDrafts,
    quarantinedEvents: finalized.quarantinedEvents,
    assemblyWarnings: finalized.assemblyWarnings,
  });
}

export function summarizeCandidateAssembly(events) {
  if (!Array.isArray(events)) {
    return Object.freeze({
      totalEvents: 0,
      candidateDraftCount: 0,
      quarantinedEventCount: 0,
      warningCount: 1,
      completeTraceCount: 0,
      incompleteTraceCount: 0,
      duplicateTraceCount: 0,
    });
  }

  const assembly = assembleJobLearningCandidateDrafts(events);
  const analysis = buildTraceGroupIndex(events);
  const finalized = finalizeTraceDrafts(
    analysis.traceMap,
    analysis.nonTraceDocumentSaves,
    analysis.quarantineRecords,
    analysis.warnings
  );

  return Object.freeze({
    totalEvents: events.length,
    candidateDraftCount: assembly.candidateDrafts.length,
    quarantinedEventCount: assembly.quarantinedEvents.length,
    warningCount: assembly.assemblyWarnings.length,
    completeTraceCount: finalized.completeTraceCount,
    incompleteTraceCount: finalized.incompleteTraceCount,
    duplicateTraceCount: finalized.duplicateTraceCount,
  });
}

export function detectCandidateAssemblyIssues(events) {
  if (!Array.isArray(events)) {
    return Object.freeze({
      malformedEvents: Object.freeze([]),
      missingTraceEvents: Object.freeze([]),
      incompleteTraces: Object.freeze([]),
      duplicateTraces: Object.freeze([]),
      conflictingMetadataTraces: Object.freeze([]),
      totalIssueCount: 0,
    });
  }

  const malformedEvents = [];
  const missingTraceEvents = [];
  const traceMap = new Map();
  const traceMalformed = new Map();

  for (let i = 0; i < events.length; i += 1) {
    const normalizedEvent = normalizeEvent(events[i], i);
    if (normalizedEvent.kind === "malformed") {
      malformedEvents.push(normalizedEvent.label);
      continue;
    }

    if (!normalizedEvent.assistTraceId) {
      if (normalizedEvent.seam !== "document_save") {
        missingTraceEvents.push(normalizedEvent.label);
      }
      continue;
    }

    if (!traceMap.has(normalizedEvent.assistTraceId)) {
      traceMap.set(normalizedEvent.assistTraceId, getTraceState());
    }
    const traceState = traceMap.get(normalizedEvent.assistTraceId);
    recordTraceEvent(traceState, normalizedEvent);
    if (traceState.traceIssues.length > 0) {
      traceMalformed.set(normalizedEvent.assistTraceId, traceState.traceIssues.slice());
    }
  }

  const incompleteTraces = [];
  const duplicateTraces = [];
  const conflictingMetadataTraces = [];

  Array.from(traceMap.keys()).sort(sortTraceIds).forEach((traceId) => {
    const traceState = traceMap.get(traceId) || getTraceState();
    const hasRequest = traceState.requestCount === 1;
    const hasResult = traceState.resultCount === 1;
    const hasAccept = traceState.acceptCount === 1;
    const missingMetadata = !traceState.assistSectionKey || !traceState.assistDocType || !traceState.assistMode;
    const isIncomplete = !hasRequest || !hasResult || !hasAccept || (traceState.resultEvent && traceState.resultEvent.success !== true) || missingMetadata;
    if (isIncomplete) {
      incompleteTraces.push(traceId);
    }
    if (traceState.requestCount > 1 || traceState.resultCount > 1 || traceState.acceptCount > 1) {
      duplicateTraces.push(traceId);
    }
    if ((traceMalformed.get(traceId) || EMPTY_ARRAY).length > 0) {
      conflictingMetadataTraces.push(traceId);
    }
  });

  malformedEvents.sort(sortStrings);
  missingTraceEvents.sort(sortStrings);
  incompleteTraces.sort(sortStrings);
  duplicateTraces.sort(sortStrings);
  conflictingMetadataTraces.sort(sortStrings);

  return Object.freeze({
    malformedEvents: Object.freeze(malformedEvents),
    missingTraceEvents: Object.freeze(missingTraceEvents),
    incompleteTraces: Object.freeze(incompleteTraces),
    duplicateTraces: Object.freeze(duplicateTraces),
    conflictingMetadataTraces: Object.freeze(conflictingMetadataTraces),
    totalIssueCount:
      malformedEvents.length
      + missingTraceEvents.length
      + incompleteTraces.length
      + duplicateTraces.length
      + conflictingMetadataTraces.length,
  });
}
