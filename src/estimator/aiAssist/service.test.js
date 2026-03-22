// @ts-nocheck
/* eslint-disable */

import { classifyAssistFailure, _resolveAssistFailureSafeMessage } from "./service";
import { analyzeScopeAssistInput, buildSpecialtyLocalFallbackNote } from "./adapters/scope";

describe("Pass 18 — submit-path failure classification", () => {
  // ─── busy_or_rate_limited ───────────────────────────────────────────────────
  describe("busy_or_rate_limited cases", () => {
    test("429 HTTP status → busy_or_rate_limited", () => {
      expect(classifyAssistFailure({ status: 429 })).toBe("busy_or_rate_limited");
    });

    test("502 HTTP status → busy_or_rate_limited", () => {
      expect(classifyAssistFailure({ status: 502 })).toBe("busy_or_rate_limited");
    });

    test("503 HTTP status → busy_or_rate_limited", () => {
      expect(classifyAssistFailure({ status: 503 })).toBe("busy_or_rate_limited");
    });

    test("504 HTTP status → busy_or_rate_limited", () => {
      expect(classifyAssistFailure({ status: 504 })).toBe("busy_or_rate_limited");
    });

    test("_errorCode rate_limited → busy_or_rate_limited", () => {
      expect(classifyAssistFailure({ payload: { _errorCode: "rate_limited" } })).toBe("busy_or_rate_limited");
    });

    test("rate limit text in external response → busy_or_rate_limited", () => {
      expect(classifyAssistFailure({ text: "Rate limit exceeded. Too many requests." })).toBe("busy_or_rate_limited");
    });

    test("temporarily unavailable text in external response → busy_or_rate_limited", () => {
      expect(classifyAssistFailure({ text: "Service is temporarily unavailable." })).toBe("busy_or_rate_limited");
    });

    test("busy text in external response → busy_or_rate_limited", () => {
      expect(classifyAssistFailure({ text: "The server is busy. Please try again." })).toBe("busy_or_rate_limited");
    });

    test("_assistFailed payload with _errorCode rate_limited → busy_or_rate_limited (explicit code wins)", () => {
      expect(classifyAssistFailure({
        status: 200,
        payload: { _assistFailed: true, _errorCode: "rate_limited", _retryable: true, _message: "Rate limit exceeded." },
      })).toBe("busy_or_rate_limited");
    });
  });

  // ─── timeout ────────────────────────────────────────────────────────────────
  describe("timeout cases", () => {
    test("408 HTTP status → timeout", () => {
      expect(classifyAssistFailure({ status: 408 })).toBe("timeout");
    });

    test("_errorCode timeout → timeout", () => {
      expect(classifyAssistFailure({ payload: { _errorCode: "timeout" } })).toBe("timeout");
    });

    test("_assistFailed payload with _errorCode timeout → timeout", () => {
      expect(classifyAssistFailure({
        status: 200,
        payload: { _assistFailed: true, _errorCode: "timeout", _retryable: true, _message: "AI assist is temporarily busy. Please wait a few seconds and try again." },
      })).toBe("timeout");
    });

    test("timeout text in external response → timeout", () => {
      expect(classifyAssistFailure({ text: "Request timed out." })).toBe("timeout");
    });
  });

  // ─── temporary_failure (NOT busy) ───────────────────────────────────────────
  describe("temporary_failure cases — must NOT map to busy_or_rate_limited", () => {
    test("_assistFailed payload with temporary_failure code → temporary_failure", () => {
      expect(classifyAssistFailure({
        status: 200,
        payload: { _assistFailed: true, _retryable: true, _errorCode: "temporary_failure", _message: "AI assist is temporarily busy. Please wait a few seconds and try again." },
      })).toBe("temporary_failure");
    });

    test("_assistFailed payload with busy message text is NOT re-parsed as busy (double-collapse prevention)", () => {
      // Core P18 fix: the server echoes the user-facing busy message into _message.
      // The client must not re-parse that string as a classification signal.
      const result = classifyAssistFailure({
        status: 200,
        payload: {
          _assistFailed: true,
          _retryable: true,
          _errorCode: "temporary_failure",
          _message: "AI assist is temporarily busy. Please wait a few seconds and try again.",
          scopeNotes: "",
        },
      });
      expect(result).toBe("temporary_failure");
      expect(result).not.toBe("busy_or_rate_limited");
    });

    test("_retryable:true from server without specific busy signal → temporary_failure", () => {
      expect(classifyAssistFailure({ payload: { _retryable: true } })).toBe("temporary_failure");
    });

    test("_assistFailed with request_failed code → temporary_failure (via _retryable)", () => {
      expect(classifyAssistFailure({
        status: 200,
        payload: { _assistFailed: true, _retryable: true, _errorCode: "request_failed" },
      })).toBe("temporary_failure");
    });
  });

  // ─── malformed / empty ──────────────────────────────────────────────────────
  describe("malformed_response and empty_scope_result cases", () => {
    test("_errorCode parse_failed → malformed_response", () => {
      expect(classifyAssistFailure({ payload: { _errorCode: "parse_failed" } })).toBe("malformed_response");
    });

    test("_errorCode malformed_response → malformed_response", () => {
      expect(classifyAssistFailure({ payload: { _errorCode: "malformed_response" } })).toBe("malformed_response");
    });

    test("_errorCode empty_scope_result → empty_scope_result", () => {
      expect(classifyAssistFailure({ payload: { _errorCode: "empty_scope_result" } })).toBe("empty_scope_result");
    });

    test("no signals → request_failed", () => {
      expect(classifyAssistFailure({})).toBe("request_failed");
    });

    test("empty call → request_failed", () => {
      expect(classifyAssistFailure()).toBe("request_failed");
    });
  });

  // ─── non-regression: busy banner still fires for real conditions ─────────────
  describe("non-regression: 200 + valid scope note must not be affected by classification logic", () => {
    test("classification does not affect 200 OK with no _assistFailed — clean success path", () => {
      // classifyAssistFailure is only called when an error path runs; a clean 200 with scopeNotes
      // never reaches normalizeAssistFailure. Verify that a well-formed payload classifies as request_failed.
      const result = classifyAssistFailure({
        status: 200,
        payload: { scopeNotes: "Orbital TIG welding — weld line connections." },
      });
      // No _retryable, no _assistFailed → request_failed (but this path never throws in service.js)
      expect(result).toBe("request_failed");
    });

    test("429 still maps to busy_or_rate_limited regardless of any payload", () => {
      expect(classifyAssistFailure({ status: 429, payload: { scopeNotes: "some text" } })).toBe("busy_or_rate_limited");
    });

    test("AbortError path (408) maps to timeout", () => {
      expect(classifyAssistFailure({ status: 408, message: "AI assist request timed out." })).toBe("timeout");
    });

    test("503 maps to busy_or_rate_limited (server unavailable is a saturated condition)", () => {
      expect(classifyAssistFailure({ status: 503 })).toBe("busy_or_rate_limited");
    });
  });
});

// ─── Pass 19 — rawText suppression regression ────────────────────────────────
// The P18 fix added trulySaturated but normalizeAssistFailure still read rawText from _message.
// When the server echoes its user-facing busy string into _message, the safeMessage ternary
//   !rawText || looksLikeUnsafe || trulySaturated ? safeMessage : rawText.slice(0, 220)
// evaluated to false for temporary_failure and returned the busy string as safeMessage.
// Fix: suppress rawText for _assistFailed payloads in normalizeAssistFailure (same as classifyAssistFailure).
// _resolveAssistFailureSafeMessage is a thin test-only export of normalizeAssistFailure.safeMessage.
// Use content checks instead of exact-string toBe to avoid apostrophe encoding mismatches
// between the test file's local constants and service.js's module-scoped constants.
const BUSY_SIGNAL = "temporarily busy";
const WAIT_SIGNAL = "Please wait";

describe("Pass 19 — rawText suppression in normalizeAssistFailure (exact-path regression)", () => {
  const SERVER_ECHOED_BUSY_TEXT = "AI assist is temporarily busy. Please wait a few seconds and try again.";

  describe("_assistFailed temporary_failure — safeMessage must be generic, not busy", () => {
    test("exact orbital-weld-lines live failure: _assistFailed + _retryable + temporary_failure code + busy _message → generic safeMessage", () => {
      // This is the exact payload shape the server returns when Groq fails and specialty fallback is null.
      // Pre-P19: rawText = _message = "AI assist is temporarily busy..." → safeMessage = busy string (BUG)
      // Post-P19: rawText = "" (suppressed for _assistFailed) → !rawText=true → safeMessage = GENERIC
      const safeMsg = _resolveAssistFailureSafeMessage({
        status: 200,
        payload: {
          _assistFailed: true,
          _retryable: true,
          _errorCode: "temporary_failure",
          _message: SERVER_ECHOED_BUSY_TEXT,
          _error: SERVER_ECHOED_BUSY_TEXT,
          scopeNotes: "",
        },
      });
      expect(safeMsg).not.toContain(BUSY_SIGNAL);
      expect(safeMsg).not.toContain(WAIT_SIGNAL);
    });

    test("_assistFailed request_failed + _retryable + busy _message → generic safeMessage", () => {
      const safeMsg = _resolveAssistFailureSafeMessage({
        status: 200,
        payload: {
          _assistFailed: true,
          _retryable: true,
          _errorCode: "request_failed",
          _message: SERVER_ECHOED_BUSY_TEXT,
          scopeNotes: "",
        },
      });
      expect(safeMsg).not.toContain(BUSY_SIGNAL);
      expect(safeMsg).not.toContain(WAIT_SIGNAL);
    });

    test("_assistFailed no _errorCode + _retryable + busy _message → generic safeMessage", () => {
      // Edge case: server returns _assistFailed without _errorCode, but echoes busy message
      const safeMsg = _resolveAssistFailureSafeMessage({
        status: 200,
        payload: {
          _assistFailed: true,
          _retryable: true,
          _message: SERVER_ECHOED_BUSY_TEXT,
        },
      });
      expect(safeMsg).not.toContain(BUSY_SIGNAL);
      expect(safeMsg).not.toContain(WAIT_SIGNAL);
    });
  });

  describe("_assistFailed rate_limited — safeMessage must still be busy", () => {
    test("_assistFailed + _errorCode rate_limited → busy safeMessage preserved", () => {
      const safeMsg = _resolveAssistFailureSafeMessage({
        status: 200,
        payload: {
          _assistFailed: true,
          _retryable: true,
          _errorCode: "rate_limited",
          _message: "Rate limit exceeded.",
        },
      });
      expect(safeMsg).toContain(BUSY_SIGNAL);
    });

    test("_assistFailed + _errorCode timeout → busy safeMessage preserved", () => {
      const safeMsg = _resolveAssistFailureSafeMessage({
        status: 200,
        payload: {
          _assistFailed: true,
          _retryable: true,
          _errorCode: "timeout",
          _message: SERVER_ECHOED_BUSY_TEXT,
        },
      });
      expect(safeMsg).toContain(BUSY_SIGNAL);
    });
  });

  describe("non-_assistFailed failures — external text still applies", () => {
    test("429 HTTP → busy safeMessage", () => {
      const safeMsg = _resolveAssistFailureSafeMessage({ status: 429 });
      expect(safeMsg).toContain(BUSY_SIGNAL);
    });

    test("408 timeout → busy safeMessage", () => {
      const safeMsg = _resolveAssistFailureSafeMessage({ status: 408 });
      expect(safeMsg).toContain(BUSY_SIGNAL);
    });

    test("503 server unavailable → busy safeMessage", () => {
      const safeMsg = _resolveAssistFailureSafeMessage({ status: 503 });
      expect(safeMsg).toContain(BUSY_SIGNAL);
    });

    test("external response with busy text (no _assistFailed) → busy safeMessage", () => {
      const safeMsg = _resolveAssistFailureSafeMessage({
        message: "Service is temporarily unavailable.",
      });
      expect(safeMsg).toContain(BUSY_SIGNAL);
    });
  });
});

// ─── Pass 20 — client-side specialty fallback regression ─────────────────────
// The P18+P19 fixes covered classification and rawText suppression.
// P20 identifies the shared live branch: "Orbital weld lines" hits
//   _assistFailed + rate_limited OR AbortError (client timeout before server specialty fallback).
// In both cases the local welding analysis is already computed (context.scopeInputAnalysis)
//   and buildSpecialtyLocalFallbackNote should produce "Orbital TIG welding — weld line connections."
// The fix wires config.localFallback into service.js (both catch block and _assistFailed block)
//   so the specialty note is returned before the busy error is thrown.
//
// These tests cover the two proof points:
//   A. The analysis for the live input IS eligible for specialty fallback
//   B. The fallback note is the expected specialty text (not busy, not generic)

describe("Pass 20 — Orbital weld lines specialty fallback proof (client-side)", () => {
  describe("A. analysis eligibility — weld fields must be eligible", () => {
    test("'Orbital weld lines' → weldingBaseProcess gtaw_tig, confidence medium (weldEligible = true)", () => {
      const a = analyzeScopeAssistInput("Orbital weld lines");
      expect(a.weldingBaseProcess).toBe("gtaw_tig");
      expect(a.weldingConfidence).toBe("medium");
    });

    test("'Orbital weld lines' → orbital_welding secondary tag fires", () => {
      const a = analyzeScopeAssistInput("Orbital weld lines");
      expect(a.weldingSecondaryTags).toContain("orbital_welding");
    });

    test("'Orbital weld lines' → line_connections material context fires", () => {
      const a = analyzeScopeAssistInput("Orbital weld lines");
      expect(a.weldingMaterialContext).toContain("line_connections");
    });
  });

  describe("B. fallback note correctness — must be specialty text, not busy", () => {
    test("buildSpecialtyLocalFallbackNote for 'Orbital weld lines' analysis → usable note produced", () => {
      const a = analyzeScopeAssistInput("Orbital weld lines");
      const note = buildSpecialtyLocalFallbackNote(a);
      expect(note).toBeTruthy();
      expect(note).not.toContain(BUSY_SIGNAL);
      expect(note).not.toContain(WAIT_SIGNAL);
    });

    test("fallback note for 'Orbital weld lines' → contains orbital TIG welding (case-insensitive)", () => {
      const a = analyzeScopeAssistInput("Orbital weld lines");
      const note = buildSpecialtyLocalFallbackNote(a);
      expect(note).toMatch(/orbital/i);
      expect(note).toContain("TIG welding");
    });

    test("fallback note for 'Orbital weld lines' → contains line connections object phrase", () => {
      const a = analyzeScopeAssistInput("Orbital weld lines");
      const note = buildSpecialtyLocalFallbackNote(a);
      expect(note).toContain("line connections");
    });
  });

  describe("C. _assistFailed + rate_limited classification — busy is correct classification when no fallback", () => {
    test("_assistFailed + rate_limited → classified as busy_or_rate_limited (correct — upstream truly rate-limited)", () => {
      expect(classifyAssistFailure({
        status: 200,
        payload: { _assistFailed: true, _retryable: true, _errorCode: "rate_limited", _message: "AI assist is temporarily busy. Please wait a few seconds and try again." },
      })).toBe("busy_or_rate_limited");
    });

    test("_assistFailed + rate_limited → safeMessage is busy (correct — no local fallback in this path)", () => {
      const safeMsg = _resolveAssistFailureSafeMessage({
        status: 200,
        payload: { _assistFailed: true, _retryable: true, _errorCode: "rate_limited", _message: "Rate limit exceeded." },
      });
      expect(safeMsg).toContain(BUSY_SIGNAL);
    });
  });

  describe("D. shorthand specialty inputs not matched by analysis — buildSpecialtyLocalFallbackNote returns null", () => {
    test("non-specialty input 'paint drywall at lobby' → no fallback note", () => {
      const a = analyzeScopeAssistInput("paint drywall at lobby");
      const note = buildSpecialtyLocalFallbackNote(a);
      expect(note).toBeFalsy();
    });

    test("non-specialty input 'replace door hardware' → no fallback note", () => {
      const a = analyzeScopeAssistInput("replace door hardware at entry");
      const note = buildSpecialtyLocalFallbackNote(a);
      expect(note).toBeFalsy();
    });
  });
});
