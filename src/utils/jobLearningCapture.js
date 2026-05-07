// @ts-nocheck
/* eslint-disable */

import { appendJobLearningEvent } from "./jobLearningStore";

const DEBUG_JOB_LEARNING_CAPTURE = false;
const MAX_STRING_LENGTH = 64;
const MAX_COUNT = 100000;

function sanitizeString(value, fallback = "") {
  const text = String(value ?? "").trim();
  if (!text) return fallback;
  return text.slice(0, MAX_STRING_LENGTH);
}

function sanitizeCount(value) {
  const next = Number(value);
  if (!Number.isFinite(next) || next < 0) return 0;
  return Math.min(MAX_COUNT, Math.floor(next));
}

function sanitizeBoolean(value) {
  return value === true;
}

function sanitizeLearningEvent(event = {}, seam = "") {
  const source = event && typeof event === "object" && !Array.isArray(event) ? event : {};
  const normalizedSeam = sanitizeString(source.seam || seam || source.source || "unknown");
  const normalizedDocType = sanitizeString(source.docType);
  const normalizedMode = sanitizeString(source.mode);
  const normalizedSectionKey = sanitizeString(source.sectionKey);
  const normalizedResultType = sanitizeString(
    source.resultType
      || (
        normalizedSeam === "assist_result"
          ? (source.validationValid === true
            ? "validated"
            : (source.hasWrites ? "writes" : (source.success ? "success" : "empty")))
          : ""
      )
  );
  const normalizedAcceptedAction = sanitizeString(source.acceptedAction || source.actionType);
  const normalizedSaveType = sanitizeString(source.saveType || (normalizedSeam === "document_save" ? normalizedDocType : ""));
  const normalizedSaveDocType = sanitizeString(source.saveDocType);
  const normalizedSaveMode = sanitizeString(source.saveMode);
  const normalizedProjectId = sanitizeString(source.projectId, null);
  const normalizedLinkedEstimateId = sanitizeString(source.linkedEstimateId, null);

  return {
    seam: normalizedSeam,
    source: normalizedSeam,
    timestamp: Date.now(),
    ...(normalizedSectionKey ? { sectionKey: normalizedSectionKey } : {}),
    ...(normalizedDocType ? { docType: normalizedDocType } : {}),
    ...(normalizedMode ? { mode: normalizedMode } : {}),
    ...(normalizedResultType ? { resultType: normalizedResultType } : {}),
    ...(normalizedAcceptedAction ? { acceptedAction: normalizedAcceptedAction } : {}),
    ...(normalizedSaveType ? { saveType: normalizedSaveType } : {}),
    ...(normalizedSaveDocType ? { saveDocType: normalizedSaveDocType } : {}),
    ...(normalizedSaveMode ? { saveMode: normalizedSaveMode } : {}),
    isEditMode: sanitizeBoolean(source.isEditMode),
    isProjectSeeded: sanitizeBoolean(source.isProjectSeeded),
    hasLinkedEstimate: sanitizeBoolean(source.hasLinkedEstimate),
    isInvoiceFromEstimate: sanitizeBoolean(source.isInvoiceFromEstimate),
    hasSourceEstimateSnapshot: sanitizeBoolean(source.hasSourceEstimateSnapshot),
    ...(normalizedProjectId !== null ? { projectId: normalizedProjectId } : {}),
    ...(normalizedLinkedEstimateId !== null ? { linkedEstimateId: normalizedLinkedEstimateId } : {}),
    inputLength: sanitizeCount(
      Object.prototype.hasOwnProperty.call(source, "inputLength")
        ? source.inputLength
        : String(source.rawInput || "").length
    ),
    scopeTextLength: sanitizeCount(source.scopeTextLength),
    laborLineCount: sanitizeCount(source.laborLineCount),
    materialItemCount: sanitizeCount(source.materialItemCount),
    writeKeyCount: sanitizeCount(
      Object.prototype.hasOwnProperty.call(source, "writeKeyCount")
        ? source.writeKeyCount
        : (Array.isArray(source.writeKeys)
          ? source.writeKeys.length
          : (Array.isArray(source.acceptedWriteKeys) ? source.acceptedWriteKeys.length : 0))
    ),
    success: sanitizeBoolean(source.success),
    hasWrites: sanitizeBoolean(
      Object.prototype.hasOwnProperty.call(source, "hasWrites")
        ? source.hasWrites
        : Array.isArray(source.writeKeys) || Array.isArray(source.acceptedWriteKeys)
    ),
    validationValid: sanitizeBoolean(source.validationValid),
    hasValidationError: sanitizeBoolean(Boolean(source.validationError)),
  };
}

function safeDebugLog(eventName, payload) {
  try {
    if (!DEBUG_JOB_LEARNING_CAPTURE || typeof console === "undefined" || typeof console.debug !== "function") {
      return;
    }
    const detail = payload && typeof payload === "object" ? { ...payload } : {};
    console.debug("[job-learning-capture]", eventName, {
      ...detail,
      capturedAt: Date.now(),
    });
  } catch {}
}

export function captureAssistRequest(event = {}) {
  try {
    const sanitized = sanitizeLearningEvent(event, "assist_request");
    appendJobLearningEvent(sanitized);
    safeDebugLog("assist_request", sanitized);
  } catch {}
  return undefined;
}

export function captureAssistResult(event = {}) {
  try {
    const sanitized = sanitizeLearningEvent(event, "assist_result");
    appendJobLearningEvent(sanitized);
    safeDebugLog("assist_result", sanitized);
  } catch {}
  return undefined;
}

export function captureAssistAccept(event = {}) {
  try {
    const sanitized = sanitizeLearningEvent(event, "assist_accept");
    appendJobLearningEvent(sanitized);
    safeDebugLog("assist_accept", sanitized);
  } catch {}
  return undefined;
}

export function captureDocumentSave(event = {}) {
  try {
    const sanitized = sanitizeLearningEvent(event, "document_save");
    appendJobLearningEvent(sanitized);
    safeDebugLog("document_save", sanitized);
  } catch {}
  return undefined;
}
