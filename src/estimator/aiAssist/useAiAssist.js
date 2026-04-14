// @ts-nocheck
/* eslint-disable */

import { useCallback, useRef, useState } from "react";
import { buildScopeAssistRequestKey, requestSectionAssist } from "./service";

// Phase machine: idle → open → requesting → review | error → idle
const IDLE = { phase: "idle" };
const DEV = process.env.NODE_ENV === "development";
const AI_ASSIST_BUSY_MESSAGE = "AI assist is temporarily busy. Please wait a few seconds and try again.";
const AI_ASSIST_GENERIC_MESSAGE = "AI assist couldn’t complete that request right now. Please try again.";

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

export function useAiAssist(sectionKey, state) {
  const [assistState, setAssistState] = useState(IDLE);
  const inFlightScopeRefineRequestRef = useRef(null);
  const submitSeqRef = useRef(0); // Pass 18: stale-request guard

  const open = useCallback((openOptions = null) => {
    const options = openOptions && typeof openOptions === "object" ? openOptions : {};
    setAssistState({ phase: "open", input: "", ...options });
  }, []);

  const close = useCallback(() => {
    setAssistState(IDLE);
  }, []);

  const submit = useCallback(
    async (userInput, serviceOptions = {}) => {
      const mySeq = ++submitSeqRef.current; // Pass 18: capture sequence before async work
      const traceId = DEV ? Math.random().toString(36).slice(2, 7) : ""; // Pass 19: per-submit correlation ID
      const normalizedMode = String(serviceOptions?.mode || "").trim().toLowerCase() === "refine" ? "refine" : "initial";
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
          const result = await requestSectionAssist({ sectionKey, userInput, state, ...serviceOptions, _traceId: traceId });
          // Pass 18: discard stale response — a newer submit already owns the state
          if (submitSeqRef.current !== mySeq) {
            if (DEV) console.log(`[ai-assist:${traceId}] stale_discarded`, { seq: mySeq, current: submitSeqRef.current });
            return;
          }
          if (!result.validation.valid) {
            if (sectionKey === "scope" && typeof result?.writes?.scopeNotes === "string" && String(result.writes.scopeNotes || "").trim()) {
              if (DEV) console.log(`[ai-assist:${traceId}] scope_validation_ignored`, { seq: mySeq, error: result.validation.error });
              setAssistState({ phase: "review", input: userInput, result });
              return;
            }
            if (DEV) console.log(`[ai-assist:${traceId}] validation_failed`, { seq: mySeq, error: result.validation.error });
            setAssistState({
              phase: "error",
              input: userInput,
              error: toSafeAssistErrorMessage(
                { message: result.validation.error || "" },
                "Could not generate a result. Try adding more detail."
              ),
            });
            return;
          }
          if (DEV) console.log(`[ai-assist:${traceId}] success`, { seq: mySeq, writeKeys: Object.keys(result.writes || {}) });
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
            error: toSafeAssistErrorMessage(e),
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
    [sectionKey, state]
  );

  return { assistState, open, close, submit };
}
