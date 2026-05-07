// @ts-nocheck
/* eslint-disable */

import { useCallback, useRef, useState } from "react";
import { buildScopeAssistRequestKey, requestSectionAssist } from "./service";
import {
  captureAssistRequest as captureJobLearningAssistRequest,
  captureAssistResult as captureJobLearningAssistResult,
} from "../../utils/jobLearningCapture";

// Phase machine: idle → open → requesting → review | error → idle
const IDLE = { phase: "idle" };
const DEV = process.env.NODE_ENV === "development";
const AI_ASSIST_BUSY_MESSAGE = "AI assist is temporarily busy. Please wait a few seconds and try again.";
const AI_ASSIST_GENERIC_MESSAGE = "AI assist couldn’t complete that request right now. Please try again.";
const LABOR_AI_ASSIST_GUIDANCE_MESSAGE = "I could not build labor rows from that. Add the trade, crew role, hours, or rate and try again.";

export function captureAiAssistRequest(event = {}) {
  captureJobLearningAssistRequest(event);
}

export function captureAiAssistResult(event = {}) {
  captureJobLearningAssistResult(event);
}

function resolveAssistCaptureContext(sectionKey, state, captureMeta = {}, sequenceIndex = 0) {
  const normalizedSectionKey = String(sectionKey || "").trim();
  const normalizedDocType = String(captureMeta?.docType || state?.ui?.docType || "estimate").trim().toLowerCase() === "invoice"
    ? "invoice"
    : "estimate";
  const normalizedMode = String(captureMeta?.mode || "").trim().toLowerCase() || "create";
  const assistSequenceIndex = Math.max(0, Math.floor(Number(sequenceIndex) || 0));
  const assistTraceId = [normalizedSectionKey || "unknown", normalizedDocType, normalizedMode, String(assistSequenceIndex)].join(":");
  return {
    sectionKey: normalizedSectionKey,
    docType: normalizedDocType,
    mode: normalizedMode,
    assistTraceId,
    assistSequenceIndex,
    assistSectionKey: normalizedSectionKey,
    assistDocType: normalizedDocType,
    assistMode: normalizedMode,
    scopeTextLength: String(state?.scopeNotes || "").length,
    laborLineCount: Array.isArray(state?.labor?.lines) ? state.labor.lines.length : 0,
    materialItemCount: Array.isArray(state?.materials?.items) ? state.materials.items.length : 0,
  };
}

function buildAiAssistRequestCapturePayload(sectionKey, userInput, state, captureMeta) {
  const context = resolveAssistCaptureContext(sectionKey, state, captureMeta, captureMeta?.assistSequenceIndex);
  return {
    sectionKey: context.sectionKey,
    docType: context.docType,
    mode: context.mode,
    assistTraceId: context.assistTraceId,
    assistSequenceIndex: context.assistSequenceIndex,
    assistSectionKey: context.assistSectionKey,
    assistDocType: context.assistDocType,
    assistMode: context.assistMode,
    rawInput: String(userInput || ""),
    scopeTextLength: context.scopeTextLength,
    laborLineCount: context.laborLineCount,
    materialItemCount: context.materialItemCount,
  };
}

function buildAiAssistResultCapturePayload(sectionKey, userInput, state, captureMeta, result) {
  const context = resolveAssistCaptureContext(sectionKey, state, captureMeta, captureMeta?.assistSequenceIndex);
  return {
    sectionKey: context.sectionKey,
    docType: context.docType,
    mode: context.mode,
    assistTraceId: context.assistTraceId,
    assistSequenceIndex: context.assistSequenceIndex,
    assistSectionKey: context.assistSectionKey,
    assistDocType: context.assistDocType,
    assistMode: context.assistMode,
    rawInput: String(userInput || ""),
    scopeTextLength: context.scopeTextLength,
    laborLineCount: context.laborLineCount,
    materialItemCount: context.materialItemCount,
    success: !!result,
    hasWrites: !!result?.writes,
    writeKeys: Object.keys(result?.writes || {}),
    validationValid: result?.validation?.valid === true,
    validationError: result?.validation?.valid === false ? String(result?.validation?.error || "").trim() : "",
  };
}

function looksLikeBusyAssistError(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return [
    /\b429\b/i,
    /\brate[_\s-]?limit\b/i,
    /\btoo many requests\b/i,
    /\btemporar(?:y|ily)\b/i,
    /\bbusy\b/i,
    /\boverload(?:ed)?\b/i,
    /\bunavailable\b/i,
    /\btimeout\b/i,
    /\btimed out\b/i,
    /\btry again\b/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikeUnsafeAssistError(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if ((text.startsWith("{") || text.startsWith("[")) && /"?(error|detail|message|type|code)"?\s*:/i.test(text)) return true;
  return [
    /\bgroq\b/i,
    /\bopenai\b/i,
    /\bprovider\b/i,
    /\bapi[_\s-]?key\b/i,
    /\bbilling\b/i,
    /\btoken(?:s)?\b/i,
    /\bmodel\b/i,
    /\bhttp\s*\d{3}\b/i,
    /\bstatus\s*\d{3}\b/i,
    /\berror\b\s*:/i,
    /https?:\/\//i,
  ].some((pattern) => pattern.test(text));
}

function toSafeAssistErrorMessage(error, fallbackMessage = AI_ASSIST_GENERIC_MESSAGE) {
  const explicit = String(error?.assistSafeMessage || "").trim();
  if (explicit) return explicit;

  const rawMessage = String(error?.message || error || "").trim();
  if (!rawMessage) return fallbackMessage;
  if (looksLikeBusyAssistError(rawMessage)) return AI_ASSIST_BUSY_MESSAGE;
  if (looksLikeUnsafeAssistError(rawMessage)) return fallbackMessage;
  return rawMessage.length > 220 ? `${rawMessage.slice(0, 219)}...` : rawMessage;
}

function resolveLaborAssistErrorMessage(error, fallbackMessage = LABOR_AI_ASSIST_GUIDANCE_MESSAGE) {
  const rawMessage = String(error?.message || error || "").trim();
  if (looksLikeBusyAssistError(rawMessage)) {
    return toSafeAssistErrorMessage(error, AI_ASSIST_BUSY_MESSAGE);
  }
  if (looksLikeUnsafeAssistError(rawMessage)) {
    return fallbackMessage;
  }
  if (
    !rawMessage
    || /no labor lines were generated/i.test(rawMessage)
    || /some lines are missing role, hours, or rate/i.test(rawMessage)
    || /could not generate a result/i.test(rawMessage)
  ) {
    return fallbackMessage;
  }
  return toSafeAssistErrorMessage(error, fallbackMessage);
}

export function useAiAssist(sectionKey, state, captureMeta = {}) {
  const [assistState, setAssistState] = useState(IDLE);
  const inFlightScopeRefineRequestRef = useRef(null);
  const submitSeqRef = useRef(0); // Pass 18: stale-request guard
  const latestAssistCaptureMetaRef = useRef(null);

  const open = useCallback((openOptions = null) => {
    const options = openOptions && typeof openOptions === "object" ? openOptions : {};
    setAssistState({ phase: "open", input: "", ...options });
  }, []);

  const close = useCallback(() => {
    submitSeqRef.current += 1;
    inFlightScopeRefineRequestRef.current = null;
    latestAssistCaptureMetaRef.current = null;
    setAssistState(IDLE);
  }, []);

  const submit = useCallback(
    async (userInput, serviceOptions = {}) => {
      const mySeq = ++submitSeqRef.current; // Pass 18: capture sequence before async work
      const normalizedMode = String(serviceOptions?.mode || "").trim().toLowerCase() === "refine" ? "refine" : "initial";
      const assistCaptureMeta = resolveAssistCaptureContext(sectionKey, state, captureMeta, mySeq);
      const traceId = assistCaptureMeta.assistTraceId;
      const scopeRefineRequest = sectionKey === "scope" && normalizedMode === "refine";
      const scopeRefineRequestKey = scopeRefineRequest
        ? buildScopeAssistRequestKey({ sectionKey, userInput, state, ...serviceOptions })
        : "";
      if (scopeRefineRequest && inFlightScopeRefineRequestRef.current?.promise) {
        return inFlightScopeRefineRequestRef.current.promise;
      }

      const requestPromise = (async () => {
        if (DEV && sectionKey === "scope" && normalizedMode === "refine") console.log("[SCOPE_AMEND_SUBMIT_ENTER_USE_AI_ASSIST]", { section: sectionKey, mode: normalizedMode, chip: userInput, seq: mySeq, ts: Date.now() });
        setAssistState({ phase: "requesting", input: userInput });
        if (DEV) console.log(`[ai-assist:${traceId}] submit_start`, { section: sectionKey, seq: mySeq, inputLen: String(userInput || "").length });
        try {
          captureAiAssistRequest(buildAiAssistRequestCapturePayload(sectionKey, userInput, state, assistCaptureMeta));
          const result = await requestSectionAssist({ sectionKey, userInput, state, ...serviceOptions, _traceId: traceId });
          // Pass 18: discard stale response — a newer submit already owns the state
          if (submitSeqRef.current !== mySeq) {
            if (DEV) console.log(`[ai-assist:${traceId}] stale_discarded`, { seq: mySeq, current: submitSeqRef.current });
            return;
          }
          captureAiAssistResult(buildAiAssistResultCapturePayload(sectionKey, userInput, state, assistCaptureMeta, result));
          if (!result.validation.valid) {
            if (DEV) console.log(`[ai-assist:${traceId}] validation_failed`, { seq: mySeq, error: result.validation.error });
            setAssistState({
              phase: "error",
              input: userInput,
              error: sectionKey === "labor"
                ? resolveLaborAssistErrorMessage(
                    { message: result.validation.error || "" },
                    LABOR_AI_ASSIST_GUIDANCE_MESSAGE
                  )
                : toSafeAssistErrorMessage(
                    { message: result.validation.error || "" },
                    "Could not generate a result. Try adding more detail."
                  ),
            });
            return;
          }
          if (DEV) console.log(`[ai-assist:${traceId}] success`, { seq: mySeq, writeKeys: Object.keys(result.writes || {}) });
          latestAssistCaptureMetaRef.current = assistCaptureMeta;
          setAssistState({ phase: "review", input: userInput, result });
        } catch (e) {
          // Pass 18: discard stale error — newer request owns the state
          if (submitSeqRef.current !== mySeq) {
            if (DEV) console.log(`[ai-assist:${traceId}] stale_error_discarded`, { seq: mySeq, current: submitSeqRef.current });
            return;
          }
          if (DEV) console.log(`[ai-assist:${traceId}] error`, { seq: mySeq, code: e?.assistErrorCode, class: e?.assistFailureClass, msg: String(e?.assistSafeMessage || "").slice(0, 80) });
          setAssistState({
            phase: "error",
            input: userInput,
            error: sectionKey === "labor"
              ? resolveLaborAssistErrorMessage(e, LABOR_AI_ASSIST_GUIDANCE_MESSAGE)
              : toSafeAssistErrorMessage(e),
          });
        }
      })();

      if (scopeRefineRequest) {
        inFlightScopeRefineRequestRef.current = {
          key: scopeRefineRequestKey,
          promise: requestPromise,
        };
        requestPromise.finally(() => {
          if (inFlightScopeRefineRequestRef.current?.promise === requestPromise) {
            inFlightScopeRefineRequestRef.current = null;
          }
        });
      }

      return requestPromise;
    },
    [sectionKey, state, captureMeta]
  );

  return { assistState, open, close, submit, assistCaptureMeta: latestAssistCaptureMetaRef.current };
}
