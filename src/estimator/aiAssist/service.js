// @ts-nocheck
/* eslint-disable */

import { getAssistConfig, normalizeAssistSectionKey } from "./registry";

const AI_ASSIST_TIMEOUT_MS = 30000;
const AI_ASSIST_SCOPE_INITIAL_TIMEOUT_MS = 45000;
const AI_ASSIST_SCOPE_REFINE_TIMEOUT_MS = 65000;
const AI_ASSIST_BUSY_MESSAGE = "AI assist is temporarily busy. Please wait a few seconds and try again.";
const AI_ASSIST_GENERIC_MESSAGE = "AI assist couldn’t complete that request right now. Please try again.";

function normalizeScopeAssistMode(mode) {
  return String(mode || "").trim().toLowerCase() === "refine" ? "refine" : "initial";
}

function parseJsonSafe(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return null;
  try {
    return JSON.parse(normalized);
  } catch (_error) {
    return null;
  }
}

function looksLikeAssistRateLimitText(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return [
    /\b429\b/i,
    /\brate[_\s-]?limit\b/i,
    /\btoo many requests\b/i,
    /\bquota\b/i,
    /\bcapacity\b/i,
    /\btry again in\b/i,
    /\bplease try again later\b/i,
  ].some((pattern) => pattern.test(text));
}

function looksLikeUnsafeAssistText(value) {
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
    /\brate[_\s-]?limit\b/i,
    /\btoo many requests\b/i,
    /\bquota\b/i,
    /\btraceback\b/i,
    /\bstack\b/i,
    /\bexception\b/i,
    /\berror\b\s*:/i,
    /https?:\/\//i,
  ].some((pattern) => pattern.test(text));
}

// Pass 18 — failure classification for precise busy-vs-generic routing
// Exported for unit testing. Does NOT use _message/_error from _assistFailed payloads as a
// classification signal — those are already-sanitized user-facing strings, not raw signals.
export function classifyAssistFailure({ status = 0, payload = null, text = "", message = "" } = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  const assistFailedPayload = Boolean(source?._assistFailed);
  const rawCode = String(source?._errorCode || source?.errorCode || source?.code || "").trim().toLowerCase();
  // For _assistFailed server payloads: read _errorCode only, not the user-facing message text.
  // For external HTTP errors: read text/message from the response body.
  const rawText = assistFailedPayload
    ? ""
    : String(source?._message || source?._error || source?.message || source?.detail || text || message || "").trim();

  if (status === 429 || rawCode === "rate_limited" || looksLikeAssistRateLimitText(rawText)) return "busy_or_rate_limited";
  if (status === 408 || rawCode === "timeout") return "timeout";
  if (status === 502 || status === 503 || status === 504) return "busy_or_rate_limited";
  if (/\btemporar(?:y|ily)\b|\bbusy\b|\boverload(?:ed)?\b|\bunavailable\b|\bservice unavailable\b/i.test(rawText)) return "busy_or_rate_limited";
  if (/\btimeout\b|\btimed out\b/i.test(rawText)) return "timeout";
  if (/\btry again\b/i.test(rawText)) return "busy_or_rate_limited";
  if (rawCode === "parse_failed" || rawCode === "malformed_response") return "malformed_response";
  if (rawCode === "empty_scope_result") return "empty_scope_result";
  if (Boolean(source?._retryable || source?.retryable)) return "temporary_failure";
  return "request_failed";
}

function normalizeAssistFailure({ status = 0, payload = null, text = "", message = "" } = {}) {
  const source = payload && typeof payload === "object" ? payload : {};
  // Pass 19: mirror classifyAssistFailure — suppress rawText for _assistFailed server payloads.
  // The server echoes its user-facing message ("AI assist is temporarily busy...") into _message.
  // Without suppression the P18 safeMessage ternary:
  //   !rawText || looksLikeUnsafe || trulySaturated ? safeMessage : rawText.slice(0, 220)
  // evaluates to false for temporary_failure and falls through to rawText.slice(0, 220),
  // returning the busy string as safeMessage even when trulySaturated = false.
  const assistFailedPayload = Boolean(source?._assistFailed);
  const rawText = assistFailedPayload
    ? ""
    : String(
        source?._message
        || source?._error
        || source?.message
        || source?.detail
        || text
        || message
        || ""
      ).trim();
  const rawCode = String(source?._errorCode || source?.errorCode || source?.code || "").trim().toLowerCase();
  const rateLimited = status === 429 || rawCode === "rate_limited" || looksLikeAssistRateLimitText(rawText);
  const retryable = rateLimited
    || Boolean(source?._retryable || source?.retryable)
    || status === 408
    || status === 429
    || status === 502
    || status === 503
    || status === 504
    || /\btemporar(?:y|ily)\b|\bbusy\b|\boverload(?:ed)?\b|\bunavailable\b|\bservice unavailable\b|\btimeout\b|\btimed out\b|\btry again\b/i.test(rawText);

  // Pass 18: busy banner only fires for true overload conditions.
  // _retryable:true from an _assistFailed payload is NOT sufficient — the server echoes the
  // busy message string into _message, which would re-match text patterns and incorrectly lock
  // all provider failures into the busy banner. Use classifyAssistFailure for the authoritative class.
  const failureClass = classifyAssistFailure({ status, payload, text, message });
  const trulySaturated = failureClass === "busy_or_rate_limited" || failureClass === "timeout";

  const safeMessage = trulySaturated
    ? AI_ASSIST_BUSY_MESSAGE
    : AI_ASSIST_GENERIC_MESSAGE;

  return {
    code: rateLimited
      ? "rate_limited"
      : retryable
        ? "temporary_failure"
        : "request_failed",
    failureClass,
    retryable,
    safeMessage: !rawText || looksLikeUnsafeAssistText(rawText) || trulySaturated
      ? safeMessage
      : rawText.slice(0, 220),
  };
}

function createAssistError(failure) {
  const normalized = failure && typeof failure === "object" ? failure : normalizeAssistFailure({ message: String(failure || "") });
  const error = new Error(normalized.safeMessage || AI_ASSIST_GENERIC_MESSAGE);
  error.assistSafeMessage = normalized.safeMessage || AI_ASSIST_GENERIC_MESSAGE;
  error.assistErrorCode = normalized.code || "request_failed";
  error.assistRetryable = Boolean(normalized.retryable);
  error.assistFailureClass = normalized.failureClass || "request_failed";
  return error;
}

function resolveAssistTimeoutMs(sectionKey, mode) {
  const normalizedSectionKey = normalizeAssistSectionKey(sectionKey);
  if (normalizedSectionKey !== "scope") return AI_ASSIST_TIMEOUT_MS;
  return normalizeScopeAssistMode(mode) === "refine"
    ? AI_ASSIST_SCOPE_REFINE_TIMEOUT_MS
    : AI_ASSIST_SCOPE_INITIAL_TIMEOUT_MS;
}

export function buildScopeAssistRequestKey({
  sectionKey,
  userInput,
  state,
  mode = "initial",
  sourcePrompt = "",
  currentScope = "",
  refineInstruction = "",
  formatIntent = "",
}) {
  const normalizedSectionKey = normalizeAssistSectionKey(sectionKey);
  if (normalizedSectionKey !== "scope") return "";

  const normalizedMode = normalizeScopeAssistMode(mode);
  const normalizedSourcePrompt = String(sourcePrompt || "").trim();
  const normalizedCurrentScope = String(currentScope || state?.scopeNotes || "").trim();
  const normalizedRefineInstruction = String(refineInstruction || "").trim();
  const normalizedFormatIntent = String(formatIntent || "").trim();
  const normalizedUserInput = String(
    normalizedMode === "refine"
      ? (normalizedRefineInstruction || userInput || "")
      : (userInput || "")
  ).trim();

  return JSON.stringify({
    sectionKey: normalizedSectionKey,
    mode: normalizedMode,
    userInput: normalizedUserInput,
    sourcePrompt: normalizedSourcePrompt,
    currentScope: normalizedCurrentScope,
    refineInstruction: normalizedRefineInstruction,
    formatIntent: normalizedFormatIntent,
  });
}

export async function requestSectionAssist({
  sectionKey,
  userInput,
  state,
  mode = "initial",
  sourcePrompt = "",
  currentScope = "",
  refineInstruction = "",
  formatIntent = "",
  _traceId = "", // Pass 19: correlation trace ID — generated per-submit in useAiAssist.js
}) {
  const normalizedSectionKey = normalizeAssistSectionKey(sectionKey);
  const config = getAssistConfig(normalizedSectionKey);
  if (!config) throw new Error(`No AI Assist config for section: ${normalizedSectionKey || sectionKey}`);

  const scopeSection = normalizedSectionKey === "scope";
  const normalizedMode = scopeSection ? normalizeScopeAssistMode(mode) : "initial";
  const normalizedSourcePrompt = scopeSection ? String(sourcePrompt || "").trim() : "";
  const normalizedCurrentScope = scopeSection
    ? String(currentScope || state?.scopeNotes || "").trim()
    : "";
  const normalizedRefineInstruction = scopeSection ? String(refineInstruction || "").trim() : "";
  const normalizedFormatIntent = scopeSection ? String(formatIntent || "").trim() : "";
  const normalizedUserInput = String(
    scopeSection && normalizedMode === "refine"
      ? (normalizedRefineInstruction || userInput || "")
      : (userInput || "")
  ).trim();

  if (scopeSection && normalizedMode === "refine" && !normalizedCurrentScope) {
    throw new Error("Scope refine requires an existing scope draft.");
  }

  const contextOptions = scopeSection
    ? {
      userInput: normalizedUserInput,
      mode: normalizedMode,
      sourcePrompt: normalizedSourcePrompt,
      currentScope: normalizedCurrentScope,
      refineInstruction: normalizedRefineInstruction,
      formatIntent: normalizedFormatIntent,
    }
    : { userInput: normalizedUserInput };
  const context = config.contextBuilder(state, contextOptions);

  // Pass 19: trace the normalization state at request time (dev only)
  if (process.env.NODE_ENV === "development" && _traceId && normalizedSectionKey === "scope") {
    const _sa = context?.scopeInputAnalysis || {};
    console.log(`[ai-assist:${_traceId}] context_analysis`, {
      weldingBaseProcess: _sa.weldingBaseProcess || "none",
      weldingConfidence: _sa.weldingConfidence || "none",
      weldingSecondaryTags: (_sa.weldingSecondaryTags || []).join(",") || "none",
      weldingMaterialContext: (_sa.weldingMaterialContext || []).join(",") || "none",
      ironworkTradeFamily: _sa.ironworkTradeFamily || "none",
      ironworkConfidence: _sa.ironworkConfidence || "none",
      carpentryTradeFamily: _sa.carpentryTradeFamily || "none",
      carpentryConfidence: _sa.carpentryConfidence || "none",
    });
  }

  const preflight = typeof config.preflight === "function"
    ? config.preflight({ userInput: normalizedUserInput, state, context })
    : null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), resolveAssistTimeoutMs(normalizedSectionKey, normalizedMode));

  let raw = preflight;
  try {
    if (!raw) {
      const response = await fetch("/api/ai-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionKey: normalizedSectionKey,
          userInput: normalizedUserInput,
          ...(scopeSection ? {
            mode: normalizedMode,
            sourcePrompt: normalizedSourcePrompt,
            currentScope: normalizedCurrentScope,
            refineInstruction: normalizedRefineInstruction,
            formatIntent: normalizedFormatIntent,
          } : {}),
          context: {
            ...(context || {}),
            currentSection: normalizedSectionKey || context?.currentSection || "",
          },
          _traceId: _traceId || "",
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw createAssistError(
          normalizeAssistFailure({
            status: response.status,
            payload: parseJsonSafe(body),
            text: body,
          })
        );
      }
      raw = await response.json();
    }
  } catch (error) {
    // Pass 20: before routing to busy, try client-side specialty fallback using the pre-computed analysis.
    // This covers: AbortError (client timeout fires before server specialty fallback responds),
    // _assistFailed + rate_limited (server truly busy but local analysis is strong),
    // and any other failure where the local welding/ironwork/carpentry analysis is eligible.
    // config.localFallback is set only on the scope section; returns { writes, validation } or null.
    if (typeof config.localFallback === "function") {
      try {
        const localResult = config.localFallback({ userInput: normalizedUserInput, state, context });
        if (localResult) {
          if (process.env.NODE_ENV === "development") {
            console.log(`[ai-assist:${_traceId || "?"}] branch=client_specialty_fallback input="${String(normalizedUserInput || "").slice(0, 40)}" error_class=${error?.assistFailureClass || error?.name || "unknown"}`);
          }
          return localResult;
        }
      } catch (_fallbackErr) {
        // localFallback must not mask the original error
      }
    }
    if (process.env.NODE_ENV === "development") {
      console.log(`[ai-assist:${_traceId || "?"}] branch=${error?.name === "AbortError" ? "failure_timeout" : error?.assistFailureClass === "busy_or_rate_limited" ? "failure_busy" : error?.assistFailureClass === "temporary_failure" ? "failure_temporary" : error?.assistFailureClass === "malformed_response" ? "failure_malformed" : error?.assistFailureClass === "empty_scope_result" ? "failure_empty" : "failure_request_failed"} error_class=${error?.assistFailureClass || error?.name || "unknown"}`);
    }
    if (error?.assistSafeMessage) throw error;
    if (error?.name === "AbortError") {
      throw createAssistError(normalizeAssistFailure({ status: 408, message: "AI assist request timed out." }));
    }
    throw createAssistError(normalizeAssistFailure({ message: error?.message || String(error || "") }));
  } finally {
    clearTimeout(timeoutId);
  }

  // Dev diagnostics — response shape before processing
  if (process.env.NODE_ENV === "development" && raw && typeof raw === "object") {
    const _srcField = raw.scopeNotes ? "scopeNotes" : raw.text ? "text" : raw.content ? "content" : raw.notes ? "notes" : raw.result ? "result" : "none";
    const _tid = _traceId || "?";
    console.log(`[ai-assist:${_tid}] response_shape`, {
      section: normalizedSectionKey,
      _assistFailed: Boolean(raw._assistFailed),
      _errorCode: String(raw._errorCode || ""),
      _retryable: Boolean(raw._retryable),
      failureClass: raw._assistFailed ? classifyAssistFailure({ payload: raw }) : "n/a",
      scopeTextSource: _srcField,
      noteLength: String(raw[_srcField] || "").length,
    });
  }

  // Server signals a generation failure (e.g. Groq not configured or Groq error)
  if (raw?._assistFailed) {
    // Pass 20: before routing to busy, try client-side specialty fallback.
    // _assistFailed + rate_limited is the exact path the live "Orbital weld lines" bug hits:
    //   server is truly rate-limited, specialty fallback fires on server and returns HTTP 200
    //   with specialty note — BUT that path only works if the server fallback fires first.
    //   If the specialty retry chain exhausted and sectionDef.fallback was called instead,
    //   the payload has _assistFailed: true + _errorCode: rate_limited → busy banner.
    //   The client-side fallback intercepts that here using the pre-computed analysis.
    if (typeof config.localFallback === "function") {
      try {
        const localResult = config.localFallback({ userInput: normalizedUserInput, state, context });
        if (localResult) {
          if (process.env.NODE_ENV === "development") {
            const _fc = classifyAssistFailure({ payload: raw });
            console.log(`[ai-assist:${_traceId || "?"}] branch=client_specialty_fallback_from_assisted_failed input="${String(normalizedUserInput || "").slice(0, 40)}" server_error_code=${raw._errorCode || "none"} server_failure_class=${_fc}`);
          }
          return localResult;
        }
      } catch (_fallbackErr) {
        // localFallback must not mask the original error
      }
    }
    if (process.env.NODE_ENV === "development") {
      const _fc = classifyAssistFailure({ payload: raw });
      console.log(`[ai-assist:${_traceId || "?"}] branch=${_fc === "busy_or_rate_limited" ? "failure_busy" : _fc === "timeout" ? "failure_timeout" : _fc === "temporary_failure" ? "failure_temporary" : _fc === "malformed_response" ? "failure_malformed" : _fc === "empty_scope_result" ? "failure_empty" : "failure_request_failed"} server_error_code=${raw._errorCode || "none"} server_failure_class=${_fc} local_fallback=none`);
    }
    throw createAssistError(normalizeAssistFailure({ payload: raw }));
  }

  const writes = config.localAdapter(raw, state, {
    userInput: normalizedUserInput,
    context,
    mode: normalizedMode,
    sourcePrompt: normalizedSourcePrompt,
    currentScope: normalizedCurrentScope,
    refineInstruction: normalizedRefineInstruction,
    formatIntent: normalizedFormatIntent,
  });
  const validation = config.validationRules(writes, state);

  // Dev diagnostics — adapter/validation outcome
  if (process.env.NODE_ENV === "development") {
    const _tid = _traceId || "?";
    if (writes === null) {
      console.log(`[ai-assist:${_tid}] adapter_null — scope text not accepted from response`);
    } else if (!validation.valid) {
      console.log(`[ai-assist:${_tid}] validation_failed`, { error: validation.error });
    } else {
      const _note = typeof writes?.scopeNotes === "string" ? writes.scopeNotes : "";
      console.log(`[ai-assist:${_tid}] accepted`, { noteLength: _note.length, preview: _note.slice(0, 60) });
    }
  }

  return { writes, validation };
}

// Pass 19: test-only export — exposes normalizeAssistFailure.safeMessage for regression coverage.
// Verifies that rawText suppression prevents the server-echoed busy string from leaking into
// the returned safeMessage when failureClass = "temporary_failure".
// Do not use in application code.
export function _resolveAssistFailureSafeMessage(params) {
  return normalizeAssistFailure(params).safeMessage;
}
