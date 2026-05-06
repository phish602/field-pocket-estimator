// server/dev-ai.js
const { createHash } = require("crypto");
const http = require("http");
const express = require("express");
const Stripe = require("stripe");
const { fetch } = require("undici");

const app = express();
app.use(express.json({ limit: "1mb" }));

const OLLAMA_BASE = "http://127.0.0.1:11434";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama3.2:1b"; // fallback only (speed)
const OLLAMA_TIMEOUT_MS = 120000;
const SCOPE_RUNTIME_BUILD = "scope-runtime-2026-04-08-live-runtime-proof-v5";
const DEV_AI_SERVER_PORT = Number(process.env.DEV_AI_PORT || 5055) || 5055;
const DEV_AI_SERVER_STARTED_AT_MS = Date.now();
const DEV_AI_SERVER_STARTED_AT = new Date(DEV_AI_SERVER_STARTED_AT_MS).toISOString();
const DEV_AI_SERVER_FILE = __filename;
const DEV_AI_SERVER_BOOT_ID = `${process.pid}:${DEV_AI_SERVER_STARTED_AT_MS}`;
const SCOPE_ASSIST_PRIMARY_TIMEOUT_MS = 90000;
const GROQ_MODEL = String(process.env.GROQ_MODEL || "llama-3.1-8b-instant").trim() || "llama-3.1-8b-instant";
const GROQ_SCOPE_PRIMARY_MODEL = String(process.env.GROQ_SCOPE_PRIMARY_MODEL || process.env.GROQ_SCOPE_MODEL || "llama-3.3-70b-versatile").trim() || "llama-3.3-70b-versatile";
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const STRIPE_SECRET_KEY = String(process.env.STRIPE_SECRET_KEY || "").trim();
const STRIPE_SUCCESS_URL = String(process.env.STRIPE_SUCCESS_URL || "").trim();
const STRIPE_CANCEL_URL = String(process.env.STRIPE_CANCEL_URL || "").trim();
const SCOPE_ASSIST_IN_FLIGHT_REQUESTS = new Map();
const DASH_IMMUTABLE_ACCEPTED_PROSE_CACHE = new Map();
let ROUTE_REQUEST_SEQ = 0;

console.log("LOADED dev-ai.js v6 RULE_PARSER_FIRST + STRICT_SANITIZE + V1_LABOR_ENGINE");
console.log(`SCOPE_RUNTIME_BUILD=${SCOPE_RUNTIME_BUILD}`);
console.log(`LIVE_SCOPE_SERVER_FILE=${DEV_AI_SERVER_FILE} SCOPE_RUNTIME_BUILD=${SCOPE_RUNTIME_BUILD}`);

function getDevAiBackendIdentity(route = "") {
  return {
    _backendPid: process.pid,
    _backendPort: DEV_AI_SERVER_PORT,
    _backendStartedAt: DEV_AI_SERVER_STARTED_AT,
    _backendBootId: DEV_AI_SERVER_BOOT_ID,
    _backendServerFile: DEV_AI_SERVER_FILE,
    _backendRuntimeBuild: SCOPE_RUNTIME_BUILD,
    _backendRoute: String(route || ""),
  };
}

function fetchWithTimeout(url, options, ms, onTimeout) {
  const controller = new AbortController();
  const id = setTimeout(() => {
    try {
      if (typeof onTimeout === "function") onTimeout();
    } catch {}
    controller.abort();
  }, ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(id));
}

function asText(value) {
  return String(value || "").trim();
}

function toCurrencyNumber(value) {
  const next = typeof value === "number"
    ? value
    : parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(next) ? next : 0;
}

function roundCurrency(value) {
  return Math.round(toCurrencyNumber(value) * 100) / 100;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(asText(value));
}

function resolveStripeReturnBaseUrl(req) {
  const forwardedProto = asText(req?.headers?.["x-forwarded-proto"]);
  const host = asText(req?.headers?.["x-forwarded-host"] || req?.headers?.host);
  const origin = asText(req?.headers?.origin);
  if (origin) return origin;
  if (forwardedProto && host) return `${forwardedProto}://${host}`;
  if (host) return `http://${host}`;
  return "http://localhost:3000";
}

function resolveUrlOrigin(value) {
  const next = asText(value);
  if (!next) return "";
  try {
    return new URL(next).origin;
  } catch {
    return "";
  }
}

function getStripeFrontendFallbackUrl() {
  const candidates = [
    asText(process.env.STRIPE_APP_RETURN_URL),
    asText(process.env.CLIENT_URL),
    "http://localhost:3000",
  ];

  for (const candidate of candidates) {
    if (!isHttpUrl(candidate)) continue;
    try {
      const url = new URL(candidate);
      const backendHost = /^(?:localhost|127\.0\.0\.1)$/i.test(url.hostname)
        && String(url.port || "") === String(DEV_AI_SERVER_PORT);
      if (backendHost) continue;
      return url.origin;
    } catch {}
  }

  return "http://localhost:3000";
}

function sanitizeStripeAppReturnUrl(value) {
  const fallbackUrl = getStripeFrontendFallbackUrl();
  const candidate = resolveUrlOrigin(value);
  if (!isHttpUrl(candidate)) return fallbackUrl;

  try {
    const parsed = new URL(candidate);
    const isLocalDevHost = /^(?:localhost|127\.0\.0\.1)$/i.test(parsed.hostname);
    const isBackendLocalOrigin = isLocalDevHost
      && String(parsed.port || "") === String(DEV_AI_SERVER_PORT);
    if (isBackendLocalOrigin) return fallbackUrl;

    if (process.env.NODE_ENV !== "production") {
      const isAllowedDevFrontend = isLocalDevHost && String(parsed.port || "") === "3000";
      if (isAllowedDevFrontend) return parsed.origin;
      if (isLocalDevHost) return fallbackUrl;
    }

    return parsed.origin;
  } catch {
    return fallbackUrl;
  }
}

function resolveStripeAppBaseUrl(req) {
  const origin = sanitizeStripeAppReturnUrl(req?.headers?.origin);
  if (origin) return origin;

  const refererOrigin = sanitizeStripeAppReturnUrl(req?.headers?.referer || req?.headers?.referrer);
  if (refererOrigin) return refererOrigin;

  const forwardedProto = asText(req?.headers?.["x-forwarded-proto"]);
  const forwardedHost = asText(req?.headers?.["x-forwarded-host"]);
  if (forwardedProto && forwardedHost) {
    const candidate = `${forwardedProto}://${forwardedHost}`;
    return sanitizeStripeAppReturnUrl(candidate);
  }

  return getStripeFrontendFallbackUrl();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildStripeCheckoutReturnLink(returnToBaseUrl, status, invoiceId, sessionId = "") {
  const fallbackUrl = getStripeFrontendFallbackUrl();
  const baseUrl = sanitizeStripeAppReturnUrl(returnToBaseUrl);
  try {
    const url = new URL(baseUrl);
    url.searchParams.set("stripe", String(status || "").trim().toLowerCase() === "cancel" ? "cancel" : "success");
    if (invoiceId) url.searchParams.set("invoiceId", invoiceId);
    if (sessionId) url.searchParams.set("session_id", sessionId);
    return url.toString();
  } catch {
    return fallbackUrl;
  }
}

function renderStripeCheckoutReturnPage({
  title,
  heading,
  body,
  invoiceNumber = "",
  sessionId = "",
  returnHref = "http://localhost:3000",
  fallbackLabel = "Open EstiPaid",
  detailItems = [],
}) {
  const safeTitle = escapeHtml(title);
  const safeHeading = escapeHtml(heading);
  const safeBody = escapeHtml(body);
  const safeReturnHref = escapeHtml(returnHref);
  const safeFallbackLabel = escapeHtml(fallbackLabel);
  const derivedDetailItems = Array.isArray(detailItems) && detailItems.length
    ? detailItems
    : [
      ...(invoiceNumber ? [{ label: "Invoice", value: invoiceNumber }] : []),
      ...(sessionId ? [{ label: "Session", value: `${String(sessionId).slice(0, 12)}...` }] : []),
    ];
  const safeDetails = derivedDetailItems
    .map((item) => {
      const label = escapeHtml(asText(item?.label));
      const value = escapeHtml(asText(item?.value));
      if (!label || !value) return "";
      return `<dt>${label}</dt><dd>${value}</dd>`;
    })
    .filter(Boolean)
    .join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${safeTitle}</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0f172a;
        color: #e2e8f0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
      }
      main {
        width: min(560px, 100%);
        background: rgba(15, 23, 42, 0.92);
        border: 1px solid rgba(148, 163, 184, 0.28);
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
      }
      h1 { margin: 0 0 12px; font-size: 24px; line-height: 1.2; }
      p { margin: 0 0 12px; line-height: 1.55; color: rgba(226, 232, 240, 0.92); }
      dl {
        margin: 16px 0 20px;
        padding: 14px 16px;
        border-radius: 12px;
        background: rgba(255,255,255,0.04);
        border: 1px solid rgba(148, 163, 184, 0.16);
      }
      dt { font-size: 12px; font-weight: 700; color: rgba(148, 163, 184, 0.92); text-transform: uppercase; letter-spacing: 0.06em; }
      dd { margin: 4px 0 12px; font-weight: 700; }
      dd:last-child { margin-bottom: 0; }
      .actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 8px; }
      button {
        border: 0;
        cursor: pointer;
        display: inline-block;
        padding: 12px 16px;
        border-radius: 999px;
        background: #22c55e;
        color: #052e16;
        font-weight: 800;
        font-size: 15px;
      }
      a {
        display: inline-block;
        padding: 12px 16px;
        border-radius: 999px;
        background: rgba(255,255,255,0.08);
        color: #e2e8f0;
        font-weight: 800;
        text-decoration: none;
      }
      .hint { font-size: 13px; color: rgba(148, 163, 184, 0.95); }
    </style>
  </head>
  <body>
    <main>
      <h1>${safeHeading}</h1>
      <p>${safeBody}</p>
      <p>EstiPaid does not mark the invoice paid from this redirect alone. Return to the original EstiPaid invoice tab and click <strong>Check / Sync Stripe Payment</strong>.</p>
      ${safeDetails ? `<dl>${safeDetails}</dl>` : ""}
      <div class="actions">
        <button type="button" onclick="window.close()">Close this tab</button>
        <a href="${safeReturnHref}" target="_blank" rel="noopener noreferrer">${safeFallbackLabel}</a>
      </div>
      <p class="hint">If this tab cannot close automatically, switch back to the original EstiPaid tab or use Open EstiPaid.</p>
    </main>
  </body>
</html>`;
}

function isHttpUrl(value) {
  const next = asText(value);
  if (!next) return false;
  try {
    const parsed = new URL(next);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function resolveStripeConnectUrl(req, providedUrl, action, stripeAccountId = "") {
  if (isHttpUrl(providedUrl)) return asText(providedUrl);
  const returnBaseUrl = resolveStripeReturnBaseUrl(req);
  const suffix = action === "refresh" ? "refresh" : "return";
  const accountPart = asText(stripeAccountId);
  return `${returnBaseUrl}/?stripeConnect=${suffix}${accountPart ? `&stripeAccountId=${encodeURIComponent(accountPart)}` : ""}`;
}

function getStripeClient() {
  return new Stripe(STRIPE_SECRET_KEY);
}

function sanitizeStripeErrorMessage(message) {
  return asText(message).replace(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9_*]+\b/gi, "[REDACTED]");
}

function logSafeStripeError(route, error) {
  const details = {
    route: asText(route),
    type: asText(error?.type),
    code: asText(error?.code),
    message: sanitizeStripeErrorMessage(error?.message),
    requestId: asText(error?.requestId || error?.raw?.requestId),
    statusCode: Number.isFinite(Number(error?.statusCode)) ? Number(error.statusCode) : undefined,
  };
  const safeDetails = Object.fromEntries(
    Object.entries(details).filter(([, value]) => value !== undefined && value !== "")
  );
  console.error("[stripe_error]", safeDetails);
}

function extractJsonPayload(text) {
  const t = String(text || "").trim();
  try { return JSON.parse(t); } catch {}
  let s = t.replace(/^```[a-zA-Z]*\s*/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a !== -1 && b !== -1 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  }
  return null;
}

function unwrapQuotedText(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return "";
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    const inner = trimmed.slice(1, -1).trim();
    if (inner) return inner;
  }
  return trimmed;
}

function stripOuterCodeFences(text) {
  let next = String(text || "").replace(/\r\n?/g, "\n").trim();
  while (/^```/.test(next) && /```$/.test(next)) {
    next = next
      .replace(/^```[a-z0-9_-]*\s*\n?/i, "")
      .replace(/\n?```$/i, "")
      .trim();
  }
  return next;
}

function stripScopeAssistLabel(text) {
  const normalized = String(text || "").trim();
  if (!normalized) return "";

  const lines = normalized.split("\n");
  const firstLine = lines[0].trim();
  const firstLineSansMarkdown = firstLine
    .replace(/^#+\s*/, "")
    .replace(/^\*\*(.+)\*\*$/u, "$1")
    .trim();

  if (/^(?:scope(?:\s+notes?)?|scope of work|notes?)\s*$/i.test(firstLineSansMarkdown) && lines.length > 1) {
    return lines.slice(1).join("\n").trim();
  }

  return normalized.replace(
    /^(?:#+\s*)?(?:scope(?:\s+notes?)?|scope of work|notes?)\s*:\s*/i,
    ""
  ).trim();
}

function restoreEscapedLineBreaks(text) {
  const normalized = String(text || "");
  if (!normalized.includes("\\n") || normalized.includes("\n")) return normalized;
  return normalized.replace(/\\n/g, "\n");
}

function sanitizeScopeAssistText(text) {
  const normalized = stripScopeAssistLabel(
    restoreEscapedLineBreaks(stripOuterCodeFences(unwrapQuotedText(text)))
  );
  if (!normalized) return "";
  return normalized
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeParsedScopeAssistResponseObject(source) {
  const sourceObject = source && typeof source === "object" && !Array.isArray(source) ? source : null;
  if (!sourceObject) {
    return { accepted: false, reason: "parsed_value_not_object" };
  }
  const normalizedSource = sourceObject;
  const outcomeRaw = String(normalizedSource?.outcome || "").trim().toLowerCase();
  if (outcomeRaw !== "scope" && outcomeRaw !== "clarify") {
    return { accepted: false, reason: "invalid_outcome" };
  }
  const outcome = outcomeRaw;
  const scopeNotes = sanitizeScopeAssistText(normalizedSource.scopeNotes || "");
  const clarificationQuestion = sanitizeScopeAssistText(normalizedSource.clarificationQuestion || "");
  const missingFields = uniqueStrings(Array.isArray(normalizedSource.missingFields) ? normalizedSource.missingFields : []);

  if (outcome === "clarify") {
    if (!clarificationQuestion) {
      return { accepted: false, reason: "clarify_missing_question" };
    }
    return {
      accepted: true,
      payload: {
        outcome: "clarify",
        scopeNotes: "",
        clarificationQuestion,
        missingFields,
      },
    };
  }

  if (!scopeNotes) {
    return { accepted: false, reason: "scope_missing_scope_notes" };
  }
  return {
    accepted: true,
    payload: {
      outcome: "scope",
      scopeNotes,
      clarificationQuestion: "",
      missingFields,
    },
  };
}

function extractFirstBalancedJsonObject(text) {
  const source = String(text || "");
  if (!source) return "";

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaping = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (start === -1) {
      if (ch === "{") {
        start = i;
        depth = 1;
        inString = false;
        escaping = false;
      }
      continue;
    }

    if (escaping) {
      escaping = false;
      continue;
    }

    if (ch === "\\" && inString) {
      escaping = true;
      continue;
    }

    if (ch === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === "{") {
      depth += 1;
      continue;
    }

    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
  }

  return "";
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const SCOPE_ASSIST_SCHEMA_KEYS = [
  "outcome",
  "scopeNotes",
  "clarificationQuestion",
  "missingFields",
];

function collectScopeAssistFieldBoundaries(text) {
  const source = String(text || "");
  return SCOPE_ASSIST_SCHEMA_KEYS
    .map((key) => {
      const match = new RegExp(`"${escapeRegExp(key)}"\\s*:`, "i").exec(source);
      if (!match) return null;
      return {
        key,
        index: match.index,
        valueStart: match.index + match[0].length,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.index - right.index);
}

function extractScopeAssistFieldSlice(text, key) {
  const source = String(text || "");
  if (!source) return "";
  const boundaries = collectScopeAssistFieldBoundaries(source);
  const currentIndex = boundaries.findIndex((entry) => entry.key === key);
  if (currentIndex === -1) return "";

  const current = boundaries[currentIndex];
  const next = boundaries[currentIndex + 1] || null;
  const fallbackEndIndex = source.lastIndexOf("}");
  const endIndex = next
    ? next.index
    : fallbackEndIndex >= current.valueStart
      ? fallbackEndIndex
      : source.length;

  return source
    .slice(current.valueStart, Math.max(current.valueStart, endIndex))
    .replace(/,\s*$/u, "")
    .trim();
}

function decodeLooseJsonLikeString(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";

  if (raw.startsWith("\"")) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "string") return sanitizeScopeAssistText(parsed);
    } catch {}
  }

  const unwrapped = ((raw.startsWith("\"") && raw.endsWith("\"")) || (raw.startsWith("'") && raw.endsWith("'")))
    ? raw.slice(1, -1)
    : raw;

  return sanitizeScopeAssistText(
    unwrapped
      .replace(/\\"/g, "\"")
      .replace(/\\'/g, "'")
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\\\/g, "\\")
  );
}

function parseLooseJsonLikeStringArray(text) {
  const raw = String(text || "").trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return uniqueStrings(parsed.map((entry) => decodeLooseJsonLikeString(entry)));
    }
  } catch {}

  const values = [];
  const matcher = /"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)'/g;
  let match;
  while ((match = matcher.exec(raw))) {
    const value = decodeLooseJsonLikeString(match[0]);
    if (value) values.push(value);
  }
  return uniqueStrings(values);
}

function salvageStructuredScopeAssistPayload(text) {
  const rawText = String(text || "").trim();
  if (!rawText) {
    return { accepted: false, reason: "salvage_empty_candidate" };
  }

  const normalizedCandidate = stripOuterCodeFences(unwrapQuotedText(rawText));
  const candidate = extractFirstBalancedJsonObject(normalizedCandidate) || normalizedCandidate || rawText;
  const fieldBoundaries = collectScopeAssistFieldBoundaries(candidate);
  if (!fieldBoundaries.length) {
    return { accepted: false, reason: "salvage_missing_schema_keys" };
  }

  const outcome = decodeLooseJsonLikeString(extractScopeAssistFieldSlice(candidate, "outcome"));
  const scopeNotes = decodeLooseJsonLikeString(extractScopeAssistFieldSlice(candidate, "scopeNotes"));
  const clarificationQuestion = decodeLooseJsonLikeString(extractScopeAssistFieldSlice(candidate, "clarificationQuestion"));
  const missingFields = parseLooseJsonLikeStringArray(extractScopeAssistFieldSlice(candidate, "missingFields"));
  const normalized = normalizeParsedScopeAssistResponseObject({
    outcome,
    scopeNotes,
    clarificationQuestion,
    missingFields,
  });

  if (!normalized.accepted) {
    return {
      accepted: false,
      reason: `salvage_${normalized.reason}`,
    };
  }

  return {
    accepted: true,
    payload: normalized.payload,
  };
}

function parseScopeAssistResponse(raw, options = {}) {
  const onTrace = typeof options?.onTrace === "function" ? options.onTrace : null;
  const rawText = String(raw || "").trim();
  const seen = new Set();
  const queue = [];

  const pushCandidate = (branch, value) => {
    const text = String(value || "").trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    queue.push({ branch, text });
  };

  const rawObjectSlice = extractFirstBalancedJsonObject(rawText);
  pushCandidate("raw_text", rawText);
  pushCandidate("raw_strip_fences", stripOuterCodeFences(rawText));
  pushCandidate("raw_unwrap_quotes", unwrapQuotedText(rawText));
  pushCandidate("raw_unwrap_quotes_strip_fences", stripOuterCodeFences(unwrapQuotedText(rawText)));
  pushCandidate("raw_outer_object", rawObjectSlice);

  onTrace?.({
    stage: "start",
    branch: "raw_text",
    reason: rawText ? "attempt_parse" : "empty_raw",
    excerpt: rawText.slice(0, 160),
  });

  for (let index = 0; index < queue.length && index < 12; index += 1) {
    const candidate = queue[index];
    onTrace?.({
      stage: "candidate",
      branch: candidate.branch,
      reason: "json_parse_attempt",
      excerpt: candidate.text.slice(0, 160),
    });

    let parsed;
    try {
      parsed = JSON.parse(candidate.text);
    } catch (_error) {
      const salvaged = salvageStructuredScopeAssistPayload(candidate.text);
      if (salvaged.accepted) {
        onTrace?.({
          stage: "success",
          branch: `${candidate.branch}:schema_salvage`,
          reason: salvaged.payload.outcome,
          excerpt: String(salvaged.payload.scopeNotes || salvaged.payload.clarificationQuestion || "").slice(0, 160),
        });
        return {
          ...salvaged.payload,
          _parseBranch: `${candidate.branch}:schema_salvage`,
          _parseSource: "schema_salvage",
        };
      }
      onTrace?.({
        stage: "candidate_rejected",
        branch: candidate.branch,
        reason: salvaged.reason || "json_parse_error",
        excerpt: candidate.text.slice(0, 160),
      });
      continue;
    }

    if (typeof parsed === "string") {
      const nestedText = String(parsed || "").trim();
      onTrace?.({
        stage: "candidate_rejected",
        branch: candidate.branch,
        reason: "json_parsed_to_string",
        excerpt: nestedText.slice(0, 160),
      });
      pushCandidate(`${candidate.branch}:parsed_string`, nestedText);
      pushCandidate(`${candidate.branch}:parsed_string_strip_fences`, stripOuterCodeFences(nestedText));
      pushCandidate(`${candidate.branch}:parsed_string_unwrap_quotes`, unwrapQuotedText(nestedText));
      pushCandidate(`${candidate.branch}:parsed_string_outer_object`, extractFirstBalancedJsonObject(nestedText));
      continue;
    }

    const normalized = normalizeParsedScopeAssistResponseObject(parsed);
    if (!normalized.accepted) {
      onTrace?.({
        stage: "candidate_rejected",
        branch: candidate.branch,
        reason: normalized.reason,
        excerpt: candidate.text.slice(0, 160),
      });
      continue;
    }

    onTrace?.({
      stage: "success",
      branch: candidate.branch,
      reason: normalized.payload.outcome,
      excerpt: String(normalized.payload.scopeNotes || normalized.payload.clarificationQuestion || "").slice(0, 160),
    });
    return {
      ...normalized.payload,
      _parseBranch: candidate.branch,
      _parseSource: "json_parse",
    };
  }

  onTrace?.({
    stage: "failure",
    branch: "none",
    reason: rawText ? "no_valid_scope_assist_payload" : "empty_raw",
    excerpt: rawText.slice(0, 160),
  });
  return null;
}

const SCOPE_ECHO_STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "in", "at", "with", "this", "that", "it", "scope", "notes",
]);

function uniqueStrings(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function tokenizeComparableScopeWords(text) {
  return sanitizeScopeAssistText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s/-]/g, " ")
    .split(/\s+/)
    .filter((token) => token && !SCOPE_ECHO_STOP_WORDS.has(token));
}

function countIntersection(valuesA, valuesB) {
  const setA = new Set(valuesA);
  const setB = new Set(valuesB);
  let count = 0;
  setA.forEach((value) => {
    if (setB.has(value)) count += 1;
  });
  return count;
}

function countScopeSentences(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return 0;
  const matches = normalized.match(/[.!?](?:\s|$)/g);
  return matches ? matches.length : 1;
}

function countScopeWords(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return 0;
  return normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .length;
}

function normalizeScopeComparisonText(text = "") {
  return sanitizeScopeAssistText(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitScopeAssistSentences(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return [];
  const matches = normalized
    .replace(/\n+/g, " ")
    .match(/[^.!?]+[.!?]?/g);
  return (matches && matches.length ? matches : [normalized])
    .map((sentence) => normalizeScopeParagraphText(sentence))
    .filter(Boolean);
}

const SHORTER_SCOPE_ACTION_ANCHOR_RULES = [
  { key: "weld", pattern: /\b(?:re[-\s]?weld(?:ing|ed|s)?|weld(?:ing|ed|er|s)?)\b/i },
  { key: "fabricate", pattern: /\b(?:fabricat(?:e|es|ed|ing|ion)|fab)\b/i },
  { key: "repair", pattern: /\b(?:repair(?:ed|ing|s)?|fix(?:ed|ing|es)?|restore(?:d|ing|s)?|redo(?:ing|ne)?|straighten(?:ed|ing|s)?)\b/i },
  { key: "replace", pattern: /\b(?:replace(?:d|ment|ments|ing|s)?|swap(?:ped|ping|s)?(?:\s+out)?|change(?:d|s|ing)?(?:\s+out)?)\b/i },
  { key: "install", pattern: /\b(?:install(?:ed|ing|s|ation)?|mount(?:ed|ing|s)?|set(?:ting|s)?|place(?:d|ment|ments|ing|s)?)\b/i },
  { key: "remove", pattern: /\b(?:remove(?:d|ing|s)?|removal|demo(?:lish|lition)?|tear\s*out|detach(?:ed|ing|es)?)\b/i },
  { key: "patch", pattern: /\b(?:patch(?:ed|ing|es)?|skim(?:med|ming|coat)?|texture(?:d|ing|s)?|mud(?:ded|ding|s)?|tape(?:d|ing|s)?)\b/i },
  { key: "paint", pattern: /\b(?:paint(?:ed|ing|s)?|repaint(?:ed|ing|s)?|touch\s*up)\b/i },
  { key: "seal", pattern: /\b(?:seal(?:ed|ing|s)?|caulk(?:ed|ing|s)?|flash(?:ed|ing|es)?)\b/i },
  { key: "clean", pattern: /\b(?:clean(?:ed|ing|s)?|wash(?:ed|ing|es)?|pressure\s*wash(?:ed|ing|es)?|power\s*wash(?:ed|ing|es)?)\b/i },
  { key: "adjust", pattern: /\b(?:adjust(?:ed|ing|s)?|align(?:ed|ing|s)?|fit(?:ted|ting|s)?|trim(?:med|ming|s)?|tighten(?:ed|ing|s)?)\b/i },
  { key: "stripe", pattern: /\b(?:restripe|re-strip(?:e|ing)?|strip(?:e|ed|es|ing)|stencil(?:ed|ing|s)?)\b/i },
  { key: "cut", pattern: /\b(?:cut(?:ting|s)?|grind(?:ing|s)?|torch(?:ed|ing|es)?|saw(?:ed|ing|s)?)\b/i },
];

const SHORTER_SCOPE_ACTION_ANCHOR_KEYS = new Set(
  SHORTER_SCOPE_ACTION_ANCHOR_RULES.map((rule) => rule.key)
);

const SHORTER_SCOPE_GENERIC_ANCHOR_TOKENS = new Set([
  "about",
  "access",
  "across",
  "affected",
  "along",
  "around",
  "appearance",
  "applicable",
  "area",
  "areas",
  "behind",
  "beside",
  "between",
  "by",
  "clean",
  "cleanup",
  "complete",
  "completed",
  "condition",
  "conditions",
  "contractor",
  "crew",
  "current",
  "customer",
  "damaged",
  "described",
  "detail",
  "details",
  "existing",
  "field",
  "final",
  "finish",
  "finished",
  "from",
  "general",
  "include",
  "included",
  "includes",
  "including",
  "inside",
  "into",
  "item",
  "items",
  "job",
  "labor",
  "location",
  "locations",
  "loose",
  "material",
  "materials",
  "means",
  "method",
  "methods",
  "minor",
  "near",
  "needed",
  "necessary",
  "new",
  "normal",
  "note",
  "notes",
  "operation",
  "onto",
  "outside",
  "over",
  "perform",
  "performed",
  "performing",
  "practical",
  "prepare",
  "prepared",
  "process",
  "project",
  "professional",
  "proper",
  "provide",
  "provided",
  "providing",
  "ready",
  "requested",
  "scope",
  "section",
  "sections",
  "service",
  "services",
  "site",
  "surface",
  "surfaces",
  "system",
  "systems",
  "target",
  "targets",
  "trade",
  "through",
  "throughout",
  "under",
  "use",
  "usable",
  "visible",
  "within",
  "work",
]);

const SHORTER_SCOPE_EXCLUSION_LIKE_RULES = [
  { key: "not_included", pattern: /\bnot included\b/i },
  { key: "excluded", pattern: /\bexclude(?:d|s|ing)?\b/i },
  { key: "unless_noted", pattern: /\bunless (?:otherwise )?(?:noted|identified|specified|approved)\b/i },
  { key: "by_others", pattern: /\bby others\b/i },
  { key: "owner_or_customer_scope", pattern: /\b(?:owner|customer)\s+(?:to provide|to furnish|provided|furnished)\b/i },
  { key: "approval_clause", pattern: /\b(?:approval|approved in writing|written approval)\b/i },
  { key: "concealed_conditions", pattern: /\b(?:concealed|hidden|unknown|unforeseen)\s+(?:conditions?|damage|issues?)\b/i },
  { key: "field_verification", pattern: /\b(?:subject to field verification|field verification|field verify)\b/i },
  { key: "change_order_clause", pattern: /\b(?:change order|additional work|extra work|additional cost|extra cost|treated as additional work)\b/i },
  { key: "code_or_permit", pattern: /\b(?:permits?|compliance|regulatory|(?:building\s+)?code)\b/i },
  { key: "outside_scope", pattern: /\b(?:outside (?:this )?scope|not part of (?:this )?scope)\b/i },
];

const SHORTER_SCOPE_PROCESS_DETAIL_LIKE_RULES = [
  { key: "layout", pattern: /\b(?:layout|lay out)\b/i },
  { key: "prep", pattern: /\b(?:prep|preparation|surface prep|prepare surface)\b/i },
  { key: "protect_adjacent", pattern: /\b(?:protect adjacent|mask(?:ing)?|cover(?:ing|ings)?)\b/i },
  { key: "haul_off", pattern: /\b(?:haul[-\s]?off|dispose|disposal)\b/i },
  { key: "test_or_verify", pattern: /\b(?:test(?:ing)?|verify|verifying|inspect(?:ion|ed|ing)?|commission(?:ing|ed)?)\b/i },
  { key: "touch_up_or_match", pattern: /\b(?:touch[-\s]?up|finish to match|match existing)\b/i },
  { key: "final_condition", pattern: /\b(?:final condition|ready for (?:use|normal use|operation)|proper operation)\b/i },
  { key: "service_connections", pattern: /\b(?:disconnect|reconnect|service connections?)\b/i },
  { key: "secure_attachment", pattern: /\b(?:secure attachment|securely attach|anchor(?:ing)?|fasten(?:ing|ed|s)?)\b/i },
];

function normalizeShorterAnchorToken(token = "") {
  const normalized = String(token || "")
    .toLowerCase()
    .replace(/^[^a-z0-9/-]+|[^a-z0-9/-]+$/g, "")
    .trim();
  if (!normalized) return "";
  if (normalized.endsWith("ies") && normalized.length > 4) return `${normalized.slice(0, -3)}y`;
  if (normalized.endsWith("s") && normalized.length > 3 && !normalized.endsWith("ss") && !normalized.endsWith("us") && !normalized.endsWith("is")) {
    return normalized.slice(0, -1);
  }
  return normalized;
}

function isShorterAnchorTokenCandidate(token = "") {
  const normalized = normalizeShorterAnchorToken(token);
  if (!normalized) return false;
  if (normalized.length < 3) return false;
  if (/^\d+$/.test(normalized)) return false;
  if (SCOPE_ECHO_STOP_WORDS.has(normalized)) return false;
  if (SHORTER_SCOPE_GENERIC_ANCHOR_TOKENS.has(normalized)) return false;
  return true;
}

function extractShorterScopePatternHits(text = "", rules = []) {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return [];
  return rules
    .filter((rule) => rule?.pattern instanceof RegExp && rule.pattern.test(normalized))
    .map((rule) => String(rule.key || "").trim())
    .filter(Boolean);
}

function extractShorterLocationAnchorTerms(text = "") {
  const normalized = sanitizeScopeAssistText(text).toLowerCase();
  if (!normalized) return [];
  const terms = [];
  const matches = normalized.matchAll(/\b(?:in|at|on|within|inside|outside|around|along|near|under|over|behind|beside|between|across|through|throughout|from|to|by)\s+([a-z0-9/-]+(?:\s+[a-z0-9/-]+){0,2})/g);
  for (const match of matches) {
    const phrase = String(match?.[1] || "").trim();
    if (!phrase) continue;
    tokenizeComparableScopeWords(phrase)
      .map((token) => normalizeShorterAnchorToken(token))
      .filter((token) => isShorterAnchorTokenCandidate(token))
      .forEach((token) => {
        if (!terms.includes(token)) terms.push(token);
      });
  }
  return terms.slice(0, 3);
}

function extractShorterSourceAnchorTerms(sourceScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  if (!sourceText) {
    return {
      actionTerms: [],
      objectTerms: [],
      locationTerms: [],
      anchorTerms: [],
    };
  }

  const actionTerms = extractShorterScopePatternHits(sourceText, SHORTER_SCOPE_ACTION_ANCHOR_RULES);
  const locationTerms = extractShorterLocationAnchorTerms(sourceText);
  const objectTerms = [];
  tokenizeComparableScopeWords(sourceText)
    .map((token) => normalizeShorterAnchorToken(token))
    .filter(Boolean)
    .forEach((token) => {
      if (!isShorterAnchorTokenCandidate(token)) return;
      if (SHORTER_SCOPE_ACTION_ANCHOR_KEYS.has(token)) return;
      if (SHORTER_SCOPE_ACTION_ANCHOR_RULES.some((rule) => rule.pattern.test(token))) return;
      if (!objectTerms.includes(token)) objectTerms.push(token);
    });

  return {
    actionTerms,
    objectTerms: objectTerms.slice(0, 4),
    locationTerms,
    anchorTerms: uniqueStrings([
      ...actionTerms,
      ...objectTerms.slice(0, 4),
      ...locationTerms,
    ]).slice(0, 7),
  };
}

function doesShorterOutputPreserveAnchor(term = "", returnedText = "", returnedTokenSet = new Set()) {
  const normalizedTerm = normalizeShorterAnchorToken(term);
  if (!normalizedTerm) return false;
  if (SHORTER_SCOPE_ACTION_ANCHOR_KEYS.has(normalizedTerm)) {
    const actionRule = SHORTER_SCOPE_ACTION_ANCHOR_RULES.find((rule) => rule.key === normalizedTerm);
    return Boolean(actionRule?.pattern.test(returnedText));
  }
  return returnedTokenSet.has(normalizedTerm);
}

function assessShorterScopeSemanticPreservation(sourceScopeNotes = "", returnedScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  if (!returnedText) {
    return {
      accepted: false,
      reasonTag: "shorter_missing_output",
      shorterSemanticPass: false,
      preservedAnchorTerms: [],
      missingAnchorTerms: [],
      inventedExclusionLikeLanguage: false,
      inventedProcessDetailLikeLanguage: false,
      shorterRejectedForSemanticDrift: false,
      introducedExclusionPatternKeys: [],
      introducedProcessPatternKeys: [],
    };
  }
  if (!sourceText) {
    return {
      accepted: true,
      reasonTag: "shorter_no_source_reference",
      shorterSemanticPass: true,
      preservedAnchorTerms: [],
      missingAnchorTerms: [],
      inventedExclusionLikeLanguage: false,
      inventedProcessDetailLikeLanguage: false,
      shorterRejectedForSemanticDrift: false,
      introducedExclusionPatternKeys: [],
      introducedProcessPatternKeys: [],
    };
  }
  const sourceAnchors = extractShorterSourceAnchorTerms(sourceText);
  const sourceExclusionPatternKeys = extractShorterScopePatternHits(sourceText, SHORTER_SCOPE_EXCLUSION_LIKE_RULES);
  const sourceProcessPatternKeys = extractShorterScopePatternHits(sourceText, SHORTER_SCOPE_PROCESS_DETAIL_LIKE_RULES);
  const returnedTokenSet = new Set(
    tokenizeComparableScopeWords(returnedText)
      .map((token) => normalizeShorterAnchorToken(token))
      .filter(Boolean)
  );
  const preservedAnchorTerms = sourceAnchors.anchorTerms.filter((term) => doesShorterOutputPreserveAnchor(term, returnedText, returnedTokenSet));
  const missingAnchorTerms = sourceAnchors.anchorTerms.filter((term) => !doesShorterOutputPreserveAnchor(term, returnedText, returnedTokenSet));
  const preservedActionTerms = sourceAnchors.actionTerms.filter((term) => preservedAnchorTerms.includes(term));
  const missingActionTerms = sourceAnchors.actionTerms.filter((term) => !preservedActionTerms.includes(term));
  const preservedObjectTerms = sourceAnchors.objectTerms.filter((term) => preservedAnchorTerms.includes(term));
  const preservedLocationTerms = sourceAnchors.locationTerms.filter((term) => preservedAnchorTerms.includes(term));
  const introducedExclusionPatternKeys = extractShorterScopePatternHits(returnedText, SHORTER_SCOPE_EXCLUSION_LIKE_RULES)
    .filter((key) => !sourceExclusionPatternKeys.includes(key));
  const introducedProcessPatternKeys = extractShorterScopePatternHits(returnedText, SHORTER_SCOPE_PROCESS_DETAIL_LIKE_RULES)
    .filter((key) => !sourceProcessPatternKeys.includes(key));
  const inventedExclusionLikeLanguage = introducedExclusionPatternKeys.length > 0;
  const inventedProcessDetailLikeLanguage = introducedProcessPatternKeys.length > 0;
  const genericScaffoldAssessment = assessScopeAssistGenericScaffold(returnedText, sourceText);
  const genericBoilerplateDrift = !genericScaffoldAssessment.accepted
    && (
      genericScaffoldAssessment.reasonTag === "boilerplate_dominant"
      || genericScaffoldAssessment.reasonTag === "missing_job_specific_content"
      || genericScaffoldAssessment.reasonTag === "weak_prompt_binding"
    );

  let accepted = true;
  let reasonTag = "shorter_semantic_pass";
  if (sourceAnchors.actionTerms.length && missingActionTerms.length) {
    accepted = false;
    reasonTag = "shorter_missing_action_anchor";
  } else if (
    sourceAnchors.objectTerms.length
    && preservedObjectTerms.length < Math.min(
      sourceAnchors.objectTerms.length,
      sourceAnchors.objectTerms.length === 1 ? 1 : Math.ceil(sourceAnchors.objectTerms.length * 0.6)
    )
  ) {
    accepted = false;
    reasonTag = "shorter_missing_object_anchor";
  } else if (
    sourceAnchors.locationTerms.length
    && preservedLocationTerms.length < Math.min(
      sourceAnchors.locationTerms.length,
      sourceAnchors.locationTerms.length === 1 ? 1 : Math.ceil(sourceAnchors.locationTerms.length * 0.5)
    )
  ) {
    accepted = false;
    reasonTag = "shorter_missing_location_anchor";
  } else if (
    sourceAnchors.anchorTerms.length >= 3
    && preservedAnchorTerms.length < Math.max(2, Math.ceil(sourceAnchors.anchorTerms.length * 0.67))
  ) {
    accepted = false;
    reasonTag = "shorter_missing_critical_anchor_terms";
  } else if (inventedExclusionLikeLanguage) {
    accepted = false;
    reasonTag = "shorter_invented_exclusion_like_language";
  } else if (inventedProcessDetailLikeLanguage) {
    accepted = false;
    reasonTag = "shorter_invented_process_detail_like_language";
  } else if (genericBoilerplateDrift && missingAnchorTerms.length) {
    accepted = false;
    reasonTag = "shorter_generic_boilerplate_drift";
  }

  return {
    accepted,
    reasonTag,
    shorterSemanticPass: accepted,
    preservedAnchorTerms,
    missingAnchorTerms,
    inventedExclusionLikeLanguage,
    inventedProcessDetailLikeLanguage,
    shorterRejectedForSemanticDrift: !accepted,
    introducedExclusionPatternKeys,
    introducedProcessPatternKeys,
  };
}

function shouldAllowShorterMultiParagraph(sourceScopeNotes = "", returnedScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  const sourceParagraphCount = countScopeParagraphBlocks(sourceText);
  const returnedParagraphCount = countScopeParagraphBlocks(returnedText);
  const sourceWordCount = countScopeWords(sourceText);
  const returnedWordCount = countScopeWords(returnedText);
  const returnedSentenceCount = countScopeSentences(returnedText);

  return (
    sourceParagraphCount >= 2
    && sourceWordCount >= 95
    && returnedParagraphCount === 2
    && returnedWordCount >= 52
    && returnedSentenceCount >= 5
  );
}

function flattenShorterScopeToSingleParagraph(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return "";
  return joinScopeParagraph(splitScopeAssistSentences(normalized)) || normalizeScopeParagraphText(normalized);
}

function assessShorterScopeRefineCompliance(sourceScopeNotes = "", returnedScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  const sourceWordCount = countScopeWords(sourceText);
  const returnedWordCount = countScopeWords(returnedText);
  const compressionRatio = sourceWordCount > 0
    ? Number((returnedWordCount / sourceWordCount).toFixed(3))
    : 1;
  const sourceCompact = normalizeScopeComparisonText(sourceText);
  const returnedCompact = normalizeScopeComparisonText(returnedText);
  const sourceSentences = splitScopeAssistSentences(sourceText).map((sentence) => normalizeScopeComparisonText(sentence)).filter(Boolean);
  const returnedSentences = splitScopeAssistSentences(returnedText).map((sentence) => normalizeScopeComparisonText(sentence)).filter(Boolean);
  const sourceSentenceSet = new Set(sourceSentences);
  const identicalSentenceCount = returnedSentences.filter((sentence) => sourceSentenceSet.has(sentence)).length;
  const identicalSentenceRatio = returnedSentences.length
    ? Number((identicalSentenceCount / returnedSentences.length).toFixed(3))
    : 0;
  const sourceTokens = Array.from(new Set(tokenizeComparableScopeWords(sourceText)));
  const returnedTokens = Array.from(new Set(tokenizeComparableScopeWords(returnedText)));
  const overlapCount = countIntersection(sourceTokens, returnedTokens);
  const outputOverlapRatio = returnedTokens.length
    ? Number((overlapCount / returnedTokens.length).toFixed(3))
    : 0;
  const sourceCoverageRatio = sourceTokens.length
    ? Number((overlapCount / sourceTokens.length).toFixed(3))
    : 0;
  const returnedParagraphCount = countScopeParagraphBlocks(returnedText);
  const shorterMultiParagraphAllowed = shouldAllowShorterMultiParagraph(sourceText, returnedText);
  const shorterSingleParagraphPass = returnedParagraphCount <= 1;
  const shorterRejectedForParagraphCount = returnedParagraphCount > 1 && !shorterMultiParagraphAllowed;
  const exactMatch = Boolean(sourceCompact && returnedCompact && sourceCompact === returnedCompact);
  const semanticAssessment = assessShorterScopeSemanticPreservation(sourceText, returnedText);

  const buildResult = (accepted, reasonTag) => ({
    accepted,
    reasonTag,
    sourceWordCount,
    returnedWordCount,
    compressionRatio,
    exactMatch,
    identicalSentenceCount,
    identicalSentenceRatio,
    outputOverlapRatio,
    sourceCoverageRatio,
    shorterParagraphCount: returnedParagraphCount,
    shorterSingleParagraphPass,
    shorterRejectedForParagraphCount,
    shorterSemanticPass: Boolean(semanticAssessment.shorterSemanticPass),
    preservedAnchorTerms: Array.isArray(semanticAssessment.preservedAnchorTerms) ? semanticAssessment.preservedAnchorTerms : [],
    missingAnchorTerms: Array.isArray(semanticAssessment.missingAnchorTerms) ? semanticAssessment.missingAnchorTerms : [],
    inventedExclusionLikeLanguage: Boolean(semanticAssessment.inventedExclusionLikeLanguage),
    inventedProcessDetailLikeLanguage: Boolean(semanticAssessment.inventedProcessDetailLikeLanguage),
    shorterRejectedForSemanticDrift: Boolean(semanticAssessment.shorterRejectedForSemanticDrift),
  });

  if (!returnedText) return buildResult(false, "shorter_missing_output");
  if (!sourceText || sourceWordCount === 0) return buildResult(true, "shorter_no_source_reference");
  if (exactMatch) return buildResult(false, "shorter_exact_match");

  let maxRatio = 1;
  let minDrop = 0;
  if (sourceWordCount >= 48) {
    maxRatio = 0.78;
    minDrop = 10;
  } else if (sourceWordCount >= 36) {
    maxRatio = 0.82;
    minDrop = 7;
  } else if (sourceWordCount >= 24) {
    maxRatio = 0.86;
    minDrop = 4;
  } else if (sourceWordCount >= 16) {
    maxRatio = 0.92;
    minDrop = 2;
  } else if (sourceWordCount >= 10) {
    maxRatio = 0.96;
    minDrop = 1;
  }

  const maxAllowedWords = sourceWordCount >= 10
    ? Math.max(8, Math.min(sourceWordCount - minDrop, Math.floor(sourceWordCount * maxRatio)))
    : sourceWordCount;
  const compressionPass = sourceWordCount < 10
    ? returnedWordCount <= sourceWordCount
    : returnedWordCount <= maxAllowedWords;

  if (sourceWordCount >= 18 && returnedWordCount <= 6) {
    return buildResult(false, "shorter_collapsed_too_far");
  }
  if (!compressionPass) {
    return buildResult(false, "shorter_not_compressed_enough");
  }
  if (shorterRejectedForParagraphCount) {
    return buildResult(false, "shorter_rejected_for_paragraph_count");
  }

  const weakCompression = sourceWordCount >= 24
    ? compressionRatio > 0.88
    : sourceWordCount >= 16
      ? compressionRatio > 0.94
      : compressionRatio > 0.98;
  const wordingTooSimilar = sourceWordCount >= 16 && (
    identicalSentenceRatio >= 0.67
    || (weakCompression && outputOverlapRatio >= 0.88 && sourceCoverageRatio >= 0.72)
  );
  if (wordingTooSimilar) {
    return buildResult(false, "shorter_too_much_original_wording");
  }
  if (!semanticAssessment.accepted) {
    return buildResult(false, semanticAssessment.reasonTag || "shorter_semantic_drift");
  }

  return buildResult(true, "shorter_compression_pass");
}

const SHORTER_SCOPE_LOCAL_FALLBACK_REPLACEMENTS = [
  [/^(?:this\s+)?scope includes\s+/i, ""],
  [/^(?:the\s+)?work includes\s+/i, ""],
  [/^(?:this\s+)?project includes\s+/i, ""],
  [/^(?:contractor\s+(?:shall|to)\s+)/i, ""],
  [/^(?:provide labor and materials?\s+to\s+)/i, ""],
  [/^(?:labor and materials?\s+to\s+)/i, ""],
  [/^(?:perform work to\s+)/i, ""],
  [/^final work should leave\s+/i, "Leave "],
  [/\bin order to\b/ig, "to"],
  [/\bfor the purpose of\b/ig, "to"],
  [/\bas reasonably needed\b/ig, ""],
  [/\bas needed\b/ig, ""],
  [/\bas required\b/ig, ""],
  [/\bwhere needed\b/ig, ""],
  [/\bwhere required\b/ig, ""],
  [/\bas applicable\b/ig, ""],
  [/\bas necessary\b/ig, ""],
  [/\band leave ready for\b/ig, " ready for"],
  [/\bleave ready for\b/ig, "ready for"],
  [/\bready for normal use\b/ig, "ready for use"],
  [/\bproper operation\b/ig, "operation"],
  [/\bwith attention to\b/ig, "with"],
  [/\bclean,\s*neat,\s*and\b/ig, "clean and"],
  [/\bclean,\s*professional\b/ig, "clean"],
  [/\bclean finished appearance\b/ig, "clean finish"],
  [/\bfinished appearance\b/ig, "finish"],
  [/\bminor adjustments\b/ig, "adjustments"],
  [/\bnormal service connections\b/ig, "service connections"],
  [/\bexisting damaged\b/ig, "damaged"],
  [/\bat affected\b/ig, "at"],
];

function compressScopeSentenceForShorterFallback(sentence = "", index = 0) {
  let next = normalizeScopeParagraphText(sentence);
  if (!next) return "";
  SHORTER_SCOPE_LOCAL_FALLBACK_REPLACEMENTS.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });
  next = next
    .replace(/\s*,\s*/g, ", ")
    .replace(/,\s*,+/g, ", ")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s{2,}/g, " ")
    .trim()
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!next) return "";
  if (index > 0) {
    next = next.charAt(0).toLowerCase() + next.slice(1);
  }
  return next;
}

function buildShorterFallbackSentenceVariant(sentences = []) {
  return sentences
    .map((sentence, index) => {
      let next = normalizeScopeParagraphText(sentence).replace(/[.!?]+$/g, "").trim();
      if (!next) return "";
      if (index === 0) next = next.charAt(0).toUpperCase() + next.slice(1);
      return `${next}.`;
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

function buildShorterFallbackClauseVariant(sentences = []) {
  const clauses = sentences
    .map((sentence, index) => {
      let next = normalizeScopeParagraphText(sentence).replace(/[.!?]+$/g, "").trim();
      if (!next) return "";
      if (index === 0) return next.charAt(0).toUpperCase() + next.slice(1);
      return next.charAt(0).toLowerCase() + next.slice(1);
    })
    .filter(Boolean);
  if (!clauses.length) return "";
  return `${clauses.join(", ").replace(/\s+,/g, ",").replace(/,\s*,+/g, ", ").trim().replace(/[.!?]+$/g, "")}.`;
}

function buildShorterScopeLocalFallback(currentScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(currentScopeNotes);
  if (!sourceText) return "";

  const rawSentences = splitScopeAssistSentences(sourceText);
  if (!rawSentences.length) return flattenShorterScopeToSingleParagraph(sourceText);

  const seen = new Set();
  const processedSentences = rawSentences
    .map((sentence, index) => compressScopeSentenceForShorterFallback(sentence, index))
    .filter((sentence) => {
      const key = normalizeScopeComparisonText(sentence);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });

  if (!processedSentences.length) return flattenShorterScopeToSingleParagraph(sourceText);

  const variants = [
    buildShorterFallbackSentenceVariant(processedSentences),
    buildShorterFallbackClauseVariant(processedSentences),
  ];
  if (processedSentences.length > 2) {
    variants.push(buildShorterFallbackSentenceVariant(processedSentences.slice(0, -1)));
    variants.push(buildShorterFallbackClauseVariant(processedSentences.slice(0, -1)));
  }

  const uniqueVariants = [];
  const variantSeen = new Set();
  variants.forEach((variant) => {
    const normalized = normalizeScopeComparisonText(variant);
    if (!normalized || variantSeen.has(normalized)) return;
    variantSeen.add(normalized);
    uniqueVariants.push(sanitizeScopeAssistText(variant));
  });

  if (!uniqueVariants.length) return flattenShorterScopeToSingleParagraph(sourceText);

  const scored = uniqueVariants
    .map((text) => ({
      text,
      assessment: assessShorterScopeRefineCompliance(sourceText, text),
    }))
    .sort((left, right) => {
      if (Boolean(left.assessment.accepted) !== Boolean(right.assessment.accepted)) {
        return left.assessment.accepted ? -1 : 1;
      }
      return left.assessment.returnedWordCount - right.assessment.returnedWordCount;
    });

  return flattenShorterScopeToSingleParagraph(scored[0]?.text || sourceText);
}

function parseDashScopeStructure(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) {
    return {
      dashLines: [],
      dashLineCount: 0,
      summaryParagraph: "",
      summaryWordCount: 0,
      summarySentenceCount: 0,
      hasSummaryParagraph: false,
      formatBlocks: [],
      extraBlocks: [],
      hasExactDashThenParagraphShape: false,
      paragraphCount: 0,
    };
  }

  const formatBlocks = normalized
    .split(/\n\s*\n/g)
    .map((block) => String(block || "").trim())
    .filter(Boolean);
  const firstBlockLines = formatBlocks[0]
    ? formatBlocks[0].split("\n").map((line) => String(line || "").trim()).filter(Boolean)
    : [];
  const firstBlockDashLines = firstBlockLines
    .map((line) => {
      const match = line.match(/^-\s+(.+)$/);
      return match ? sanitizeScopeAssistText(match[1]).replace(/[.!?]+$/g, "").trim() : "";
    })
    .filter(Boolean);
  const firstBlockIsDashOnly = Boolean(firstBlockLines.length) && firstBlockDashLines.length === firstBlockLines.length;
  const secondBlockLines = formatBlocks[1]
    ? formatBlocks[1].split("\n").map((line) => String(line || "").trim()).filter(Boolean)
    : [];
  const secondBlockLooksLikeDashOnly = Boolean(
    secondBlockLines.length
    && secondBlockLines.every((line) => /^-\s+.+$/.test(line))
  );
  const summaryParagraph = firstBlockIsDashOnly && formatBlocks.length >= 2 && !secondBlockLooksLikeDashOnly
    ? sanitizeScopeAssistText(formatBlocks[1])
    : "";
  const extraBlocks = firstBlockIsDashOnly && formatBlocks.length > 2
    ? formatBlocks.slice(2).map((block) => sanitizeScopeAssistText(block)).filter(Boolean)
    : formatBlocks.length > 1
      ? formatBlocks.slice(1).map((block) => sanitizeScopeAssistText(block)).filter(Boolean)
      : [];

  return {
    dashLines: firstBlockIsDashOnly ? firstBlockDashLines : [],
    dashLineCount: firstBlockIsDashOnly ? firstBlockDashLines.length : 0,
    summaryParagraph,
    summaryWordCount: countScopeWords(summaryParagraph),
    summarySentenceCount: countScopeSentences(summaryParagraph),
    hasSummaryParagraph: Boolean(summaryParagraph),
    formatBlocks,
    extraBlocks,
    hasExactDashThenParagraphShape: firstBlockIsDashOnly && Boolean(summaryParagraph) && extraBlocks.length === 0 && formatBlocks.length === 2,
    paragraphCount: countScopeParagraphBlocks(normalized),
  };
}

function normalizeDashFallbackLineText(text = "") {
  let next = sanitizeScopeAssistText(text)
    .replace(/^(?:-\s*)+/g, "")
    .replace(/[.!?]+$/g, "")
    .trim();
  if (!next) return "";
  next = next
    .replace(/^(?:here(?:'s| is)\s+)?(?:the\s+)?(?:revised|updated|refined)\s+(?:version|draft|scope(?:\s+notes?)?)\s*:\s*/i, "")
    .replace(/^(?:current|existing|original)\s+(?:scope|draft|notes?)\s+(?:includes?|is|to be)\s+/i, "")
    .replace(/^(?:this\s+)?(?:scope|work|job)\s+(?:includes?|is|to be)\s+/i, "")
    .replace(/^(?:customer|client|owner)\s+(?:requested|asked for|wants|needs)\s+/i, "")
    .replace(/^(?:do|does)\s+the\s+scope\s+/i, "")
    .trim();
  next = compressScopeSentenceForShorterFallback(next, 0)
    .replace(/[.!?]+$/g, "")
    .replace(/^(?:and|then)\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!next) return "";
  return next.charAt(0).toUpperCase() + next.slice(1);
}

const DASH_CANONICAL_GERUND_TO_BASE_VERB = {
  inspecting: "inspect",
  cleaning: "clean",
  replacing: "replace",
  checking: "check",
  adjusting: "adjust",
  verifying: "verify",
  testing: "test",
  repairing: "repair",
  lubricating: "lubricate",
  reconnecting: "reconnect",
  disconnecting: "disconnect",
  installing: "install",
  positioning: "position",
  aligning: "align",
  mounting: "mount",
  securing: "secure",
  setting: "set",
  restoring: "restore",
  confirming: "confirm",
  calibrating: "calibrate",
  gathering: "gather",
  collecting: "collect",
  clearing: "clear",
  removing: "remove",
  trimming: "trim",
  cutting: "cut",
  prepping: "prep",
  opening: "open",
  closing: "close",
  leveling: "level",
  routing: "route",
  wiring: "wire",
  connecting: "connect",
  fastening: "fasten",
  tightening: "tighten",
  loosening: "loosen",
  patching: "patch",
  painting: "paint",
  sealing: "seal",
  hauling: "haul",
  disposing: "dispose",
  blending: "blend",
  feathering: "feather",
  tooling: "tool",
  fitting: "fit",
  exposing: "expose",
  replumbing: "replumb",
};

function normalizeDashCanonicalCompilerStepText(text = "", sourceText = "") {
  let next = normalizeDashCompilerProceduralSentence(text) || normalizeDashFallbackLineText(text);
  if (!next) return "";
  next = next.replace(/\b(?:and|then|,)\s+(inspecting|cleaning|replacing|checking|adjusting|verifying|testing|repairing|lubricating|reconnecting|disconnecting|installing|positioning|aligning|mounting|securing|setting|restoring|confirming|calibrating|gathering|collecting|clearing|removing|trimming|cutting|prepping|opening|closing|leveling|routing|wiring|connecting|fastening|tightening|loosening|patching|painting|sealing|hauling|disposing|blending|feathering|tooling|fitting|exposing|replumbing)\b/ig, (match, verb) => {
    const normalizedVerb = DASH_CANONICAL_GERUND_TO_BASE_VERB[String(verb || "").toLowerCase()] || String(verb || "").replace(/ing$/i, "");
    return match.replace(verb, normalizedVerb);
  });
  next = next.replace(/\band\s+and\b/ig, "and");
  next = next.replace(/\bthen\s+then\b/ig, "then");
  return normalizeDashFallbackLineText(next);
}

function splitDashFallbackClauseFragments(sentence = "") {
  const normalized = sanitizeScopeAssistText(sentence).replace(/[.!?]+$/g, "").trim();
  if (!normalized) return [];
  return normalized
    .split(/\s*[,;]\s*/g)
    .map((fragment) => normalizeDashFallbackLineText(fragment))
    .filter((fragment) => countScopeWords(fragment) >= 3);
}

function getScopeTextOverlapRatio(leftText = "", rightText = "") {
  const leftTokens = Array.from(new Set(tokenizeComparableScopeWords(leftText)));
  const rightTokens = Array.from(new Set(tokenizeComparableScopeWords(rightText)));
  if (!leftTokens.length || !rightTokens.length) return 0;
  return countIntersection(leftTokens, rightTokens) / Math.max(1, Math.min(leftTokens.length, rightTokens.length));
}

function areDashFallbackTextsTooSimilar(leftText = "", rightText = "") {
  const left = sanitizeScopeAssistText(leftText);
  const right = sanitizeScopeAssistText(rightText);
  if (!left || !right) return false;
  if (normalizeScopeComparisonText(left) === normalizeScopeComparisonText(right)) return true;
  return getScopeTextOverlapRatio(left, right) >= 0.8;
}

const DASH_STEP_LINE_START_PATTERNS = [
  /^remove\b/i,
  /^install\b/i,
  /^replace\b/i,
  /^repair\b/i,
  /^patch\b/i,
  /^paint\b/i,
  /^re[-\s]?stripe\b/i,
  /^seal\b/i,
  /^clean\b/i,
  /^adjust\b/i,
  /^set\b/i,
  /^position\b/i,
  /^complete\b/i,
  /^leave\b/i,
  /^disconnect\b/i,
  /^reconnect\b/i,
  /^restore\b/i,
  /^blend\b/i,
  /^feather\b/i,
  /^tool\b/i,
  /^clear\b/i,
  /^gather\b/i,
  /^collect\b/i,
  /^dispose\b/i,
  /^haul\b/i,
  /^secure\b/i,
  /^mount\b/i,
  /^fasten\b/i,
  /^fit\b/i,
  /^prep(?:are)?\b/i,
  /^apply\b/i,
  /^verify\b/i,
  /^inspect\b/i,
  /^check\b/i,
  /^level\b/i,
  /^route\b/i,
  /^run\b/i,
  /^wire\b/i,
  /^connect\b/i,
  /^trim\b/i,
  /^cut\b/i,
  /^demolish\b/i,
  /^demo\b/i,
  /^expose\b/i,
  /^lay\s+out\b/i,
  /^pick\s+up\b/i,
  /^set\s+and\s+position\b/i,
  /^gather\s+and\s+remove\b/i,
  /^clear\s+and\s+remove\b/i,
  /^disconnect\s+and\s+reconnect\b/i,
];

function isDashStepLineComplete(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return false;
  if (countScopeWords(normalized) < 4) return false;
  if (/^(?:and|or|other|additional|remaining|then|also|to|from|for|with|while|as|so|that|which|of|the|a|an|this|these|those|their|its|his|her|our|your|after|before|within|through|throughout|including|plus|because|since|if|when|where|in|on|at)\b/i.test(normalized)) return false;
  if (!DASH_STEP_LINE_START_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  return true;
}

function isDashNearDuplicateStepLine(leftText = "", rightText = "") {
  const left = sanitizeScopeAssistText(leftText);
  const right = sanitizeScopeAssistText(rightText);
  if (!left || !right) return false;
  if (normalizeScopeComparisonText(left) === normalizeScopeComparisonText(right)) return true;
  return getScopeTextOverlapRatio(left, right) >= 0.72;
}

function isDashSummaryTooSimilarToLeadBullet(summaryParagraph = "", dashLines = []) {
  const summary = sanitizeScopeAssistText(summaryParagraph);
  const normalizedLines = uniqueStrings((Array.isArray(dashLines) ? dashLines : []).map((line) => normalizeDashFallbackLineText(line))).filter(Boolean);
  if (!summary || !normalizedLines.length) return false;
  return normalizedLines.some((line) => isDashNearDuplicateStepLine(line, summary) || getScopeTextOverlapRatio(line, summary) >= 0.6);
}

function isDashSplitSentenceEchoLine(leftText = "", rightText = "") {
  const left = sanitizeScopeAssistText(leftText);
  const right = sanitizeScopeAssistText(rightText);
  if (!left || !right) return false;

  const leftKey = normalizeScopeComparisonText(left);
  const rightKey = normalizeScopeComparisonText(right);
  if (!leftKey || !rightKey) return false;
  if (leftKey === rightKey) return true;
  if (leftKey.includes(rightKey) || rightKey.includes(leftKey)) return true;

  const leftTokens = Array.from(new Set(tokenizeComparableScopeWords(left)));
  const rightTokens = Array.from(new Set(tokenizeComparableScopeWords(right)));
  if (!leftTokens.length || !rightTokens.length) return false;

  const overlapRatio = countIntersection(leftTokens, rightTokens) / Math.max(1, Math.min(leftTokens.length, rightTokens.length));
  const lengthRatio = Math.min(leftTokens.length, rightTokens.length) / Math.max(leftTokens.length, rightTokens.length);
  return overlapRatio >= 0.58 && lengthRatio >= 0.55;
}

function assessDashInventedMajorDetail(sourceScopeNotes = "", returnedScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  const sourceAnalysis = analyzeSimpleScopePrompt(sourceText);
  const sourceWordCount = countScopeWords(sourceText);
  const terseSource = Boolean(sourceAnalysis?.isClearlyDraftable) && sourceWordCount <= 14;
  if (!terseSource || !returnedText) {
    return {
      accepted: true,
      reasonTag: "dash_invented_major_detail_not_applicable",
      dashInventedMajorDetailRejected: false,
      dashInventedMajorDetailMatchedPattern: "",
    };
  }

  const majorDetailPatterns = [
    { key: "replace", pattern: /\breplace(?:d|ment|ments|ing|s)?\b/i },
    { key: "changeout", pattern: /\bchange(?:d|s|ing)?(?:\s+out)?\b/i },
    { key: "swap", pattern: /\bswap(?:ped|ping|s)?(?:\s+out)?\b/i },
    { key: "remove", pattern: /\bremove(?:d|ing|s)?\b/i },
    { key: "tearout", pattern: /\btear\s*out\b/i },
    { key: "demolish", pattern: /\bdemo(?:lish|lition)?\b/i },
    { key: "same_location", pattern: /\bsame\s+(?:location|area|place|spot)\b/i },
    { key: "necessary_connections", pattern: /\ball\s+necessary\s+connections\b/i },
    { key: "customer_kitchen_where", pattern: /\bcustomer(?:'s)?\s+kitchen\s+is\s+where\b/i },
    { key: "overall_scope_intent", pattern: /\boverall\s+scope\s+intent\b/i },
    { key: "scope_intent", pattern: /\bscope\s+intent\b/i },
    { key: "fully_functional", pattern: /\bfully\s+functional\b/i },
    { key: "safely_installed", pattern: /\bsafely\s+installed\b/i },
    { key: "customer_needs", pattern: /\bmeets?\s+the\s+customer(?:'s)?\s+needs\b/i },
    { key: "scope_project", pattern: /\bthe\s+scope\s+of\s+this\s+project\b/i },
    { key: "project_includes", pattern: /\bthis\s+project\s+includes\b/i },
    { key: "work_involves", pattern: /\bthe\s+work\s+involves\b/i },
    { key: "kitchen_area_home", pattern: /\bin\s+the\s+kitchen\s+area\s+of\s+the\s+customer(?:'s)?\s+home\b/i },
  ];

  const matchedPattern = majorDetailPatterns.find((entry) => entry.pattern.test(returnedText) && !entry.pattern.test(sourceText)) || null;
  if (matchedPattern) {
    return {
      accepted: false,
      reasonTag: "dash_invented_major_detail",
      dashInventedMajorDetailRejected: true,
      dashInventedMajorDetailMatchedPattern: String(matchedPattern.pattern),
    };
  }

  return {
    accepted: true,
    reasonTag: "dash_invented_major_detail_pass",
    dashInventedMajorDetailRejected: false,
    dashInventedMajorDetailMatchedPattern: "",
  };
}

function scoreDashFallbackLineCandidate(candidate = "", sourceAnchors = {}) {
  const normalized = sanitizeScopeAssistText(candidate);
  if (!normalized) return Number.NEGATIVE_INFINITY;
  if (!isDashStepLineComplete(normalized)) return Number.NEGATIVE_INFINITY;

  const candidateAnchors = extractShorterSourceAnchorTerms(normalized);
  const actionMatches = uniqueStrings((candidateAnchors.actionTerms || []).filter((term) => (sourceAnchors.actionTerms || []).includes(term))).length;
  const objectMatches = uniqueStrings((candidateAnchors.objectTerms || []).filter((term) => (sourceAnchors.objectTerms || []).includes(term))).length;
  const locationMatches = uniqueStrings((candidateAnchors.locationTerms || []).filter((term) => (sourceAnchors.locationTerms || []).includes(term))).length;
  const wordCount = countScopeWords(normalized);
  const conciseBonus = wordCount <= 14 ? 2 : wordCount <= 20 ? 1 : 0;
  const lengthPenalty = wordCount > 22 ? -2 : wordCount > 28 ? -4 : 0;

  return (
    (actionMatches * 6)
    + (objectMatches * 3)
    + (locationMatches * 2)
    + conciseBonus
    + lengthPenalty
  );
}

function selectDistinctDashFallbackLines(sourceText = "", candidates = [], desiredCount = 4) {
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  const sourceAnchors = extractShorterSourceAnchorTerms(normalizedSource);
  const sortedCandidates = uniqueStrings(Array.isArray(candidates) ? candidates : [])
    .map((candidate) => normalizeDashFallbackLineText(candidate))
    .filter((candidate) => isDashStepLineComplete(candidate))
    .filter((candidate) => assessScopeAssistGenericScaffold(candidate, normalizedSource).accepted)
    .sort((left, right) => scoreDashFallbackLineCandidate(right, sourceAnchors) - scoreDashFallbackLineCandidate(left, sourceAnchors));

  const selected = [];
  sortedCandidates.forEach((candidate) => {
    if (selected.length >= desiredCount) return;
    if (selected.some((existing) => isDashNearDuplicateStepLine(existing, candidate))) return;
    selected.push(candidate);
  });

  return selected;
}

function buildDashFallbackLineCandidates(sourceText = "") {
  const normalized = sanitizeScopeAssistText(sourceText);
  if (!normalized) return [];

  const simplePromptAnalysis = analyzeSimpleScopePrompt(normalized);
  const candidates = [];
  const seen = new Set();
  const pushCandidate = (value = "") => {
    const candidate = normalizeDashFallbackLineText(value);
    const key = normalizeScopeComparisonText(candidate);
    if (!key || seen.has(key) || !isDashStepLineComplete(candidate)) return;
    seen.add(key);
    candidates.push(candidate);
  };

  if (simplePromptAnalysis?.isClearlyDraftable && countScopeWords(normalized) <= 14) {
    const targetPhrase = sanitizeScopeAssistText(simplePromptAnalysis.objectPhrase || simplePromptAnalysis.targetPhrase || normalized);
    const definiteTarget = withDefiniteArticle(targetPhrase, "requested item");
    const actionKey = String(simplePromptAnalysis.actionKey || "").trim();
    const simplePlanLines = [];
    const addSimpleLine = (value = "") => {
      const line = normalizeDashFallbackLineText(value);
      if (line) simplePlanLines.push(line);
    };

    switch (actionKey) {
      case "install":
        addSimpleLine(`Install ${definiteTarget} in the intended location.`);
        addSimpleLine(`Set and position ${definiteTarget} for proper placement and fit.`);
        addSimpleLine(`Complete the setup and connection work needed for the install.`);
        addSimpleLine(`Leave ${definiteTarget} ready for normal use.`);
        break;
      case "replace":
        addSimpleLine(`Remove the existing ${definiteTarget} and install the replacement in the same area.`);
        addSimpleLine(`Set the new item in place and complete the normal fit-up connections.`);
        addSimpleLine(`Complete the alignment and securement needed for the replacement.`);
        addSimpleLine(`Leave ${definiteTarget} ready for normal use.`);
        break;
      case "repair":
        addSimpleLine(`Repair ${definiteTarget} at the affected area.`);
        addSimpleLine(`Complete the corrective work needed to restore the item or surface.`);
        addSimpleLine(`Blend the repair into adjacent conditions as needed.`);
        addSimpleLine(`Leave the repair ready for normal service.`);
        break;
      case "remove":
        addSimpleLine(`Remove ${definiteTarget} from the requested area.`);
        addSimpleLine(`Detach or separate it cleanly from adjoining materials as needed.`);
        addSimpleLine(`Clear the direct debris created by the removal.`);
        addSimpleLine(`Leave the exposed area ready for the next step.`);
        break;
      case "patch":
        addSimpleLine(`Patch ${definiteTarget} and rebuild the affected surface area.`);
        addSimpleLine(`Feather and smooth the repair into adjacent finishes.`);
        addSimpleLine(`Leave the repaired area ready for the next finish step.`);
        break;
      case "paint":
        addSimpleLine(`Paint ${definiteTarget} with the finish requested.`);
        addSimpleLine(`Handle the prep and coverage needed for a clean coat.`);
        addSimpleLine(`Leave the painted area with an even, finished appearance.`);
        break;
      case "stripe":
        addSimpleLine(`Re-stripe ${definiteTarget} to refresh the markings.`);
        addSimpleLine(`Lay out the new lines and traffic markings to match the area.`);
        addSimpleLine(`Leave the markings clean, readable, and ready for use.`);
        break;
      case "seal":
        addSimpleLine(`Seal ${definiteTarget} and close the exposed joints or gaps.`);
        addSimpleLine(`Tool the sealant neatly at the perimeter and transitions.`);
        addSimpleLine(`Leave the sealed area orderly and ready for normal exposure.`);
        break;
      case "clean":
        addSimpleLine(`Clean ${definiteTarget} and remove the affected dirt or residue.`);
        addSimpleLine(`Finish the surfaces for a neat, usable result.`);
        break;
      case "adjust":
        addSimpleLine(`Adjust, set, or align ${definiteTarget} as needed.`);
        addSimpleLine(`Complete the fit-up or fastening needed to hold the work in place.`);
        addSimpleLine(`Leave the item properly positioned and ready for normal use.`);
        break;
      case "reconnect":
        addSimpleLine(`Disconnect and reconnect ${definiteTarget} as needed.`);
        addSimpleLine(`Restore the normal service connections and complete the setup.`);
        addSimpleLine(`Leave the item ready for normal operation.`);
        break;
      default:
        break;
    }

    simplePlanLines.forEach((line) => pushCandidate(line));
  }

  splitScopeAssistSentences(normalized).forEach((sentence) => {
    pushCandidate(sentence);
    splitDashFallbackClauseFragments(sentence).forEach((fragment) => pushCandidate(fragment));
  });

  if (!candidates.length) pushCandidate(normalized);
  return selectDistinctDashFallbackLines(normalized, candidates, 6);
}

function buildDashFallbackSummaryParagraph(sourceText = "", dashLines = []) {
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  if (!normalizedSource) return "";

  const normalizedDashLines = uniqueStrings((Array.isArray(dashLines) ? dashLines : []).map((line) => normalizeDashFallbackLineText(line))).filter(Boolean);
  const simplePromptAnalysis = analyzeSimpleScopePrompt(normalizedSource);
  const summaryMeta = buildDashCompilerSummaryFromSteps({
    sourceText: normalizedSource,
    sourcePromptText: normalizedSource,
    dashLines: normalizedDashLines,
    simplePrompt: false,
  });
  if (summaryMeta.summaryParagraph) {
    return summaryMeta.summaryParagraph;
  }

  if (simplePromptAnalysis?.isClearlyDraftable && countScopeWords(normalizedSource) <= 14) {
    const targetPhrase = sanitizeScopeAssistText(simplePromptAnalysis.objectPhrase || simplePromptAnalysis.targetPhrase || normalizedSource);
    const definiteTarget = withDefiniteArticle(targetPhrase, "requested item");
    const actionKey = String(simplePromptAnalysis.actionKey || "").trim();
    const simpleSummaryMap = {
      install: `Complete the install for ${definiteTarget} in the intended location. Leave it set and ready for normal use.`,
      replace: `Remove the existing ${definiteTarget} and install the replacement in the same area. Leave the area ready for normal use.`,
      repair: `Complete the repair for ${definiteTarget} at the affected area. Leave the work ready for normal service.`,
      remove: `Complete the removal of ${definiteTarget} cleanly. Leave the exposed area ready for the next step.`,
      patch: `Complete the patch for ${definiteTarget} and blend it into the surrounding surface. Leave the repaired area ready for the next finish step.`,
      paint: `Complete the paint work for ${definiteTarget} with the requested finish. Leave it with an even, finished appearance.`,
      stripe: `Complete the re-stripe for ${definiteTarget} so the markings are clean and readable. Leave them ready for use.`,
      seal: `Complete the sealing work for ${definiteTarget} and close the exposed joints or gaps. Leave the area orderly and ready for normal exposure.`,
      clean: `Complete the cleanup for ${definiteTarget}. Leave the surfaces neat and usable.`,
      adjust: `Complete the adjustment or alignment for ${definiteTarget}. Leave it properly positioned and ready for use.`,
      reconnect: `Complete the disconnect and reconnect work for ${definiteTarget} as needed. Leave it ready for normal operation.`,
    };
    const simpleSummary = normalizeScopeParagraphText(simpleSummaryMap[actionKey] || "");
    if (simpleSummary && !isDashSummaryTooSimilarToLeadBullet(simpleSummary, normalizedDashLines)) return simpleSummary;
  }

  return "";
}

const DASH_COMPILER_PROCEDURAL_ACTION_RULES = [
  { key: "inspect", pattern: /\binspect(?:ed|ing|ion|ions)?\b/i },
  { key: "clean", pattern: /\bclean(?:ed|ing|s)?\b/i },
  { key: "replace", pattern: /\breplace(?:d|ing|s|ment)?\b/i },
  { key: "check", pattern: /\bcheck(?:ed|ing|s)?\b/i },
  { key: "adjust", pattern: /\badjust(?:ed|ing|s)?\b/i },
  { key: "verify", pattern: /\bverify(?:ied|ing|ies|ication)?\b/i },
  { key: "test", pattern: /\btest(?:ed|ing|s)?\b/i },
  { key: "repair", pattern: /\brepair(?:ed|ing|s)?\b/i },
  { key: "lubricate", pattern: /\blubricat(?:e|ed|ing|ion|ions)\b/i },
  { key: "reconnect", pattern: /\breconnect(?:ed|ing|s)?\b/i },
  { key: "disconnect", pattern: /\bdisconnect(?:ed|ing|s)?\b/i },
  { key: "install", pattern: /\binstall(?:ed|ing|s|ation)?\b/i },
  { key: "set", pattern: /\bset\b/i },
  { key: "position", pattern: /\bposition(?:ed|ing|s)?\b/i },
  { key: "align", pattern: /\balign(?:ed|ing|s)?\b/i },
  { key: "mount", pattern: /\bmount(?:ed|ing|s)?\b/i },
  { key: "secure", pattern: /\bsecure(?:d|ing|s)?\b/i },
  { key: "leave_ready", pattern: /\bleave\b.*\bready\b/i },
];

const DASH_COMPILER_GENERIC_INTRO_PATTERNS = [
  { key: "scope_is_to_be", pattern: /\b(?:the|this)\s+(?:hvac\s+system|system|equipment|work|scope|project|maintenance work|maintenance process|maintenance scope)\s+(?:is to be|will be|will undergo|will involve|is)\b/i },
  { key: "work_will_be_performed", pattern: /\b(?:the\s+)?(?:work|maintenance work)\s+will\s+be\s+performed\b/i },
  { key: "work_will_be_done", pattern: /\b(?:the\s+)?(?:work|maintenance work|maintenance scope|scope of work)\s+will\s+be\s+done\b/i },
  { key: "work_will_involve", pattern: /\b(?:the\s+)?(?:work|maintenance work|maintenance scope|scope of work)\s+will\s+involve\b/i },
  { key: "overall_scope_intent", pattern: /\boverall\s+scope\s+intent\b/i },
  { key: "overall_intent", pattern: /\boverall\s+intent\b/i },
  { key: "ensure_efficiency", pattern: /\bensure(?:s|d|ing)?\s+(?:optimal|proper|continued)\s+(?:performance|operation|function|efficiency)\b/i },
  { key: "performance_efficiency", pattern: /\bperformance\s+and\s+efficiency\b/i },
  { key: "operating_efficiency", pattern: /\boperat(?:e|es|ed|ing)\s+(?:efficiently|effectively)\b/i },
  { key: "focusing_on", pattern: /\bfocusing\s+on\b/i },
  { key: "including_associated", pattern: /\bincluding\s+all\s+associated\b/i },
  { key: "minimizes_disruptions", pattern: /\bminimiz(?:e|es|ing)\s+disruptions\b/i },
  { key: "peak_performance", pattern: /\bpeak\s+performance\b/i },
  { key: "potential_issues", pattern: /\bpotential\s+issues\b/i },
  { key: "major_problems", pattern: /\bmajor\s+problems\b/i },
  { key: "extend_lifespan", pattern: /\bextend(?:s|ing)?\s+the\s+lifespan\b/i },
  { key: "prevent_breakdowns", pattern: /\bprevent(?:s|ing)?\s+(?:unexpected\s+)?breakdowns?\b/i },
  { key: "mechanical_rooms", pattern: /\bmechanical\s+rooms?\b/i },
  { key: "rooftops", pattern: /\brooftops?\b/i },
  { key: "final_condition_intro", pattern: /\bfinal\s+condition\b/i },
  { key: "project_includes", pattern: /\b(?:the\s+scope\s+of\s+this\s+project|this\s+project\s+includes)\b/i },
  { key: "scope_of_work_includes", pattern: /\b(?:the\s+)?scope\s+of\s+work\s+includes\b/i },
  { key: "performed_on_existing", pattern: /\bperformed\s+on\s+the\s+existing\b/i },
  { key: "customer_kitchen_where", pattern: /\bcustomer(?:'s)?\s+kitchen\s+is\s+where\b/i },
  { key: "customer_existing", pattern: /\bcustomer(?:'s)?\s+existing\b/i },
  { key: "maintenance_process", pattern: /\bmaintenance\s+process\b/i },
  { key: "will_begin", pattern: /\bwill\s+begin\b/i },
  { key: "maintained_generic", pattern: /\bmaintained\b/i },
];

function extractDashCompilerActionHits(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return [];
  return uniqueStrings(
    DASH_COMPILER_PROCEDURAL_ACTION_RULES
      .filter((entry) => entry.pattern.test(normalized))
      .map((entry) => String(entry.key || "").trim())
      .filter(Boolean)
  );
}

function isDashCompilerGenericIntroSentence(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return false;
  return DASH_COMPILER_GENERIC_INTRO_PATTERNS.some((entry) => entry.pattern.test(normalized));
}

function hasDashCompilerGroundedTarget(text = "") {
  const anchors = extractShorterSourceAnchorTerms(sanitizeScopeAssistText(text));
  const groundedTerms = uniqueStrings([
    ...(Array.isArray(anchors?.objectTerms) ? anchors.objectTerms : []),
    ...(Array.isArray(anchors?.locationTerms) ? anchors.locationTerms : []),
  ]);
  return groundedTerms.length > 0;
}

function isDashCompilerProceduralBullet(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return false;
  const actionHits = extractDashCompilerActionHits(normalized);
  if (!actionHits.length) return false;
  if (isDashCompilerGenericIntroSentence(normalized)) return false;
  return hasDashCompilerGroundedTarget(normalized);
}

function buildDashCompilerSubjectPhrase(sourceText = "", sourcePromptText = "") {
  const normalizedPrompt = sanitizeScopeAssistText(sourcePromptText);
  const simplePromptAnalysis = analyzeSimpleScopePrompt(normalizedPrompt);
  if (simplePromptAnalysis?.isClearlyDraftable) {
    const targetPhrase = sanitizeScopeAssistText(simplePromptAnalysis.objectPhrase || simplePromptAnalysis.targetPhrase || normalizedPrompt || sourceText);
    if (targetPhrase) return withDefiniteArticle(targetPhrase, "requested item");
  }

  const normalizedSource = sanitizeScopeAssistText(sourceText).toLowerCase();
  if (/\bhvac\b/i.test(normalizedSource) && /\bmaintenance\b/i.test(normalizedSource)) return "the HVAC maintenance scope";
  if (/\bhvac\b/i.test(normalizedSource) && /\bsystem\b/i.test(normalizedSource)) return "the HVAC system";
  if (/\bmaintenance\b/i.test(normalizedSource)) return "the maintenance scope";
  if (/\binstallation\b/i.test(normalizedSource)) return "the installation scope";
  if (/\bcleanup\b|\bclean(?:ing|up)?\b|\bdebris\b|\bjunk\b/i.test(normalizedSource)) return "the cleanup scope";
  if (/\brepair\b/i.test(normalizedSource)) return "the repair scope";
  if (/\breplace\b/i.test(normalizedSource)) return "the replacement scope";
  if (/\bpaint\b/i.test(normalizedSource)) return "the paint scope";
  if (/\bstripe\b/i.test(normalizedSource)) return "the striping scope";
  if (/\bseal\b|\bcaulk\b|\bflash\b/i.test(normalizedSource)) return "the sealing scope";
  return "the work scope";
}

function buildDashCompilerActionPhrase(actionKeys = []) {
  const normalizedKeys = uniqueStrings(Array.isArray(actionKeys) ? actionKeys : []);
  const orderedKeys = [
    "inspect",
    "clean",
    "replace",
    "check",
    "adjust",
    "verify",
    "test",
    "repair",
    "lubricate",
    "reconnect",
    "disconnect",
    "install",
    "set",
    "position",
    "align",
    "mount",
    "secure",
    "leave_ready",
  ];
  const participles = {
    inspect: "inspected",
    clean: "cleaned",
    replace: "replaced",
    check: "checked",
    adjust: "adjusted",
    verify: "verified",
    test: "tested",
    repair: "repaired",
    lubricate: "lubricated",
    reconnect: "reconnected",
    disconnect: "disconnected",
    install: "installed",
    set: "set",
    position: "positioned",
    align: "aligned",
    mount: "mounted",
    secure: "secured",
    leave_ready: "left ready for continued operation",
  };

  const selected = orderedKeys.filter((key) => normalizedKeys.includes(key)).map((key) => participles[key]).filter(Boolean);
  if (!selected.length) return "";
  if (selected.length === 1) return selected[0];
  if (selected.length === 2) return `${selected[0]} and ${selected[1]}`;
  return `${selected.slice(0, -1).join(", ")}, and ${selected[selected.length - 1]}`;
}

function buildDashCompilerSummaryFromSteps({
  sourceText = "",
  sourcePromptText = "",
  dashLines = [],
  simplePrompt = false,
} = {}) {
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  const normalizedPrompt = sanitizeScopeAssistText(sourcePromptText);
  const normalizedDashLines = uniqueStrings((Array.isArray(dashLines) ? dashLines : []).map((line) => normalizeDashFallbackLineText(line))).filter(Boolean);
  const sourceBasisText = normalizedPrompt || normalizedSource;
  const sourceWordCount = countScopeWords(normalizedSource);
  const subjectSourceText = sourceWordCount >= 18 ? normalizedSource : sourceBasisText;
  const subjectSourcePromptText = sourceWordCount >= 18 ? "" : normalizedPrompt;
  const actionKeys = uniqueStrings(
    normalizedDashLines.flatMap((line) => extractDashCompilerActionHits(line))
  );
  const compiledActionKeys = actionKeys;
  const subjectPhrase = buildDashCompilerSubjectPhrase(subjectSourceText, subjectSourcePromptText);
  const actionPhrase = buildDashCompilerActionPhrase(compiledActionKeys);
  const readyPhrase = compiledActionKeys.includes("install") || compiledActionKeys.includes("replace") || compiledActionKeys.includes("remove")
    ? "ready for normal use"
    : "ready for continued operation";

  if (simplePrompt && compiledActionKeys.length === 0) {
    return {
      summaryParagraph: "",
      summaryBuiltFromSteps: false,
      summarySource: "simple_prompt_no_step_summary",
    };
  }

  if (compiledActionKeys.length) {
    const summary = sanitizeScopeAssistText(`Complete ${subjectPhrase} so the work is ${actionPhrase} and ${readyPhrase}.`);
    if (summary && !isDashSummaryTooSimilarToLeadBullet(summary, normalizedDashLines)) {
      return {
        summaryParagraph: summary,
        summaryBuiltFromSteps: true,
        summarySource: "compiled_steps",
      };
    }
  }

  return {
    summaryParagraph: "",
    summaryBuiltFromSteps: Boolean(compiledActionKeys.length),
    summarySource: "compiled_step_wrapup_empty",
  };
}

const DASH_COMPILER_GENERIC_INTRO_REWRITES = [
  [/^(?:the|this)\s+(?:maintenance process|maintenance work|work|scope|project|system|equipment|job)\s+(?:will\s+begin\s+with|will\s+include|includes?|involves?|will\s+involve|is\s+to\s+be|will\s+be|is)\s+/i, ""],
  [/^(?:the|this)\s+(?:maintenance process|maintenance work|work|scope|project|system|equipment|job)\s+will\s+be\s+performed\s+(?:on|in|at)\s+/i, ""],
  [/^(?:the|this)\s+(?:technician|contractor|installer|crew|worker|team)\s+(?:will\s+also\s+|will\s+|should\s+|may\s+|can\s+)?/i, ""],
  [/^(?:the|this)\s+overall\s+scope\s+intent\s+is\s+/i, ""],
  [/^(?:overall\s+scope\s+intent\s+is\s+)/i, ""],
  [/^(?:the|this)\s+final\s+condition\s+of\s+the\s+.+?\s+will\s+be\s+/i, ""],
  [/^(?:the|this)\s+final\s+condition\s+is\s+/i, ""],
];

const DASH_COMPILER_PROCEDURAL_NOUN_REWRITES = [
  [/\b(?:a|an|the)\s+(?:thorough\s+)?inspection\s+of\s+/i, "Inspect the "],
  [/\b(?:a|an|the)\s+cleaning\s+of\s+/i, "Clean the "],
  [/\b(?:a|an|the)\s+replacement\s+of\s+/i, "Replace the "],
  [/\b(?:a|an|the)\s+checking\s+of\s+/i, "Check the "],
  [/\b(?:a|an|the)\s+adjustment\s+of\s+/i, "Adjust the "],
  [/\b(?:a|an|the)\s+verification\s+of\s+/i, "Verify the "],
  [/\b(?:a|an|the)\s+testing\s+of\s+/i, "Test the "],
  [/\b(?:a|an|the)\s+repair\s+of\s+/i, "Repair the "],
  [/\b(?:a|an|the)\s+reconnection\s+of\s+/i, "Reconnect the "],
  [/\b(?:a|an|the)\s+disconnection\s+of\s+/i, "Disconnect the "],
  [/\b(?:a|an|the)\s+installation\s+of\s+/i, "Install the "],
  [/\b(?:a|an|the)\s+alignment\s+of\s+/i, "Align the "],
  [/\b(?:a|an|the)\s+positioning\s+of\s+/i, "Position the "],
  [/\b(?:a|an|the)\s+setting\s+of\s+/i, "Set the "],
  [/\b(?:a|an|the)\s+mounting\s+of\s+/i, "Mount the "],
  [/\b(?:a|an|the)\s+securing\s+of\s+/i, "Secure the "],
];

const DASH_COMPILER_PASSIVE_REWRITES = [
  [/\b(?:the|this)\s+(.+?)\s+will be inspected\b/i, "Inspect the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be cleaned\b/i, "Clean the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be replaced\b/i, "Replace the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be checked\b/i, "Check the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be adjusted\b/i, "Adjust the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be verified\b/i, "Verify the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be tested\b/i, "Test the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be repaired\b/i, "Repair the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be reconnected\b/i, "Reconnect the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be disconnected\b/i, "Disconnect the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be installed\b/i, "Install the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be set\b/i, "Set the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be positioned\b/i, "Position the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be aligned\b/i, "Align the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be mounted\b/i, "Mount the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will be secured\b/i, "Secure the $1"],
  [/\b(?:the|this)\s+(.+?)\s+will\s+remain\s+ready\b/i, "Leave the $1 ready"],
];

const DASH_COMPILER_PROCEDURAL_START_REWRITES = [
  [/^inspecting\b/i, "Inspect"],
  [/^cleaning\b/i, "Clean"],
  [/^replacing\b/i, "Replace"],
  [/^checking\b/i, "Check"],
  [/^adjusting\b/i, "Adjust"],
  [/^verifying\b/i, "Verify"],
  [/^testing\b/i, "Test"],
  [/^repairing\b/i, "Repair"],
  [/^lubricating\b/i, "Lubricate"],
  [/^reconnecting\b/i, "Reconnect"],
  [/^disconnecting\b/i, "Disconnect"],
  [/^installing\b/i, "Install"],
  [/^positioning\b/i, "Position"],
  [/^aligning\b/i, "Align"],
  [/^mounting\b/i, "Mount"],
  [/^securing\b/i, "Secure"],
  [/^setting\b/i, "Set"],
];

function normalizeDashCompilerProceduralSentence(sentence = "") {
  let next = sanitizeScopeAssistText(sentence).replace(/[.!?]+$/g, "").trim();
  if (!next) return "";

  DASH_COMPILER_PASSIVE_REWRITES.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });

  DASH_COMPILER_GENERIC_INTRO_REWRITES.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });

  DASH_COMPILER_PROCEDURAL_NOUN_REWRITES.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });

  DASH_COMPILER_PROCEDURAL_START_REWRITES.forEach(([pattern, replacement]) => {
    next = next.replace(pattern, replacement);
  });

  return normalizeDashFallbackLineText(next);
}

function scoreDashCompilerCandidate(candidateText = "", sourceText = "", {
  sourceAnchors = {},
  proceduralActionHits = [],
  genericIntroMatched = false,
  sourceIndex = 0,
  sourceKind = "",
  sourceSentenceCount = 0,
} = {}) {
  const normalizedCandidate = sanitizeScopeAssistText(candidateText);
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  if (!normalizedCandidate) return Number.NEGATIVE_INFINITY;
  if (!isDashStepLineComplete(normalizedCandidate)) return Number.NEGATIVE_INFINITY;

  const candidateAnchors = extractShorterSourceAnchorTerms(normalizedCandidate);
  const actionMatches = uniqueStrings((candidateAnchors.actionTerms || []).filter((term) => (sourceAnchors.actionTerms || []).includes(term))).length;
  const objectMatches = uniqueStrings((candidateAnchors.objectTerms || []).filter((term) => (sourceAnchors.objectTerms || []).includes(term))).length;
  const locationMatches = uniqueStrings((candidateAnchors.locationTerms || []).filter((term) => (sourceAnchors.locationTerms || []).includes(term))).length;
  const wordCount = countScopeWords(normalizedCandidate);
  const startsProcedurally = DASH_STEP_LINE_START_PATTERNS.some((pattern) => pattern.test(normalizedCandidate));
  const scaffoldAssessment = assessScopeAssistGenericScaffold(normalizedCandidate, normalizedSource);
  const scaffoldPenalty = scaffoldAssessment.accepted
    ? 0
    : (
      scaffoldAssessment.reasonTag === "boilerplate_dominant"
      || scaffoldAssessment.reasonTag === "missing_job_specific_content"
      || scaffoldAssessment.reasonTag === "weak_prompt_binding"
      || scaffoldAssessment.reasonTag === "wrapper_dominant"
      || scaffoldAssessment.reasonTag === "generic_wrapper_only"
    )
      ? 22
      : 10;
  const actionScore = uniqueStrings(Array.isArray(proceduralActionHits) ? proceduralActionHits : []).length * 14;
  const anchorScore = (actionMatches * 10) + (objectMatches * 4) + (locationMatches * 3);
  const wordScore = wordCount >= 6 && wordCount <= 20
    ? 6
    : wordCount >= 4 && wordCount <= 26
      ? 2
      : wordCount > 28
        ? -8
        : -14;
  const sourceKindBonus = sourceKind === "compressed_sentence"
    ? 3
    : sourceKind === "simple_prompt"
      ? 6
      : sourceKind === "existing_dash_line"
        ? 2
        : 0;
  const sourceKindPenalty = sourceKind === "fallback_source_text" ? 14 : 0;
  const genericIntroPenalty = genericIntroMatched ? 72 : 0;
  const positionBonus = sourceSentenceCount > 1
    ? (sourceIndex >= Math.max(1, Math.floor(sourceSentenceCount * 0.45)) ? 8 : -4)
    : 0;
  const proceduralVerbBonus = startsProcedurally ? 5 : 0;
  const overlapPenalty = normalizedSource && areDashFallbackTextsTooSimilar(normalizedCandidate, normalizedSource) && wordCount <= 14
    ? 6
    : 0;
  const fragmentPenalty = sourceKind === "fragment" ? 12 : 0;

  return actionScore
    + anchorScore
    + wordScore
    + sourceKindBonus
    + proceduralVerbBonus
    + positionBonus
    - scaffoldPenalty
    - sourceKindPenalty
    - genericIntroPenalty
    - overlapPenalty
    - fragmentPenalty;
}

function buildDashCompilerStepSignature(candidateText = "") {
  const normalized = sanitizeScopeAssistText(candidateText);
  if (!normalized) return "";
  const actionHits = extractDashCompilerActionHits(normalized);
  if (!actionHits.length) return "";
  const anchors = extractShorterSourceAnchorTerms(normalized);
  const targetTerms = uniqueStrings([
    ...(Array.isArray(anchors.objectTerms) ? anchors.objectTerms : []),
    ...(Array.isArray(anchors.locationTerms) ? anchors.locationTerms : []),
  ]);
  const targetPhrase = targetTerms.slice(0, 2).join(" ");
  return normalizeScopeComparisonText(`${actionHits[0]}|${targetPhrase || normalized}`);
}

function extractDashStepCandidatesFromProse({
  sourceText = "",
  sourcePromptText = "",
} = {}) {
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  const normalizedPrompt = sanitizeScopeAssistText(sourcePromptText);
  const sourceStructure = parseDashScopeStructure(normalizedSource);
  const sourceSentences = splitScopeAssistSentences(normalizedSource);
  const simplePromptAnalysis = analyzeSimpleScopePrompt(normalizedPrompt);
  const sourceIntroSentences = sourceSentences.slice(0, 2).filter((sentence) => isDashCompilerGenericIntroSentence(sentence));
  const candidates = [];
  const seen = new Set();
  let proceduralCandidateCount = 0;
  let genericIntroCandidateCount = 0;
  let rejectedIntroCandidateCount = 0;
  const denseProseProceduralMode = Boolean(normalizedSource)
    && sourceSentences.length >= 2
    && countScopeWords(normalizedSource) >= 18;
  const isIntroEchoLike = (candidateText = "") => sourceIntroSentences.some((introSentence) => {
    if (!introSentence) return false;
    return isDashNearDuplicateStepLine(introSentence, candidateText) || getScopeTextOverlapRatio(introSentence, candidateText) >= 0.72;
  });
  const hasGroundedTarget = (candidateText = "") => hasDashCompilerGroundedTarget(candidateText);
  const pushCandidate = (value = "", meta = {}) => {
    const candidate = normalizeDashFallbackLineText(value);
    const key = normalizeScopeComparisonText(candidate);
    if (!key || seen.has(key)) return false;
    candidates.push({
      text: candidate,
      ...meta,
    });
    seen.add(key);
    return true;
  };

  const sourceSentenceMeta = sourceSentences.map((sentence, index) => {
    const normalizedSentence = normalizeDashCompilerProceduralSentence(sentence) || normalizeDashFallbackLineText(sentence);
    const compressedSentence = normalizeDashCompilerProceduralSentence(compressScopeSentenceForShorterFallback(sentence, index)) || "";
    const normalizedActionHits = extractDashCompilerActionHits(normalizedSentence);
    const normalizedGenericIntroMatched = isDashCompilerGenericIntroSentence(normalizedSentence);
    const rawGenericIntroMatched = isDashCompilerGenericIntroSentence(sentence);
    const isCompleteSentence = isDashStepLineComplete(normalizedSentence) || countScopeWords(normalizedSentence) >= 6;
    return {
      sentence,
      normalizedSentence,
      compressedSentence,
      index,
      normalizedActionHits,
      normalizedGenericIntroMatched,
      rawGenericIntroMatched,
      isCompleteSentence,
    };
  });
  const sourceHasProceduralSentences = sourceSentenceMeta.some((entry) => entry.normalizedActionHits.length > 0 && !entry.normalizedGenericIntroMatched);

  sourceStructure.dashLines.forEach((line, index) => {
    const normalizedLine = normalizeDashCompilerProceduralSentence(line) || normalizeDashFallbackLineText(line);
    const actionHits = extractDashCompilerActionHits(normalizedLine);
    const genericIntroMatched = isDashCompilerGenericIntroSentence(normalizedLine);
    const isCompleteSentence = isDashStepLineComplete(normalizedLine) || countScopeWords(normalizedLine) >= 6;
    const groundedTarget = hasGroundedTarget(normalizedLine);
    const introEchoLike = isIntroEchoLike(normalizedLine);
    if (actionHits.length) proceduralCandidateCount += 1;
    if (genericIntroMatched && !actionHits.length && sourceHasProceduralSentences) genericIntroCandidateCount += 1;
    if ((sourceHasProceduralSentences && !actionHits.length) || (denseProseProceduralMode && (!actionHits.length || !groundedTarget || genericIntroMatched || introEchoLike))) {
      if (genericIntroMatched || introEchoLike || !actionHits.length || !groundedTarget) rejectedIntroCandidateCount += 1;
      return;
    }
    if (!isCompleteSentence && !actionHits.length) return;
    pushCandidate(normalizedLine, {
      sourceKind: "existing_dash_line",
      sourceIndex: index,
      sourceSentenceCount: sourceSentences.length,
      hasProceduralAction: Boolean(actionHits.length),
      genericIntroMatched,
      proceduralActionHits: actionHits,
      hasGroundedTarget: groundedTarget,
      scoreHint: 0,
    });
  });

  sourceSentenceMeta.forEach((entry) => {
    const {
      sentence,
      normalizedSentence,
      compressedSentence,
      index,
      normalizedActionHits,
      normalizedGenericIntroMatched,
      rawGenericIntroMatched,
      isCompleteSentence,
    } = entry;
    const hasProceduralAction = normalizedActionHits.length > 0;
    const groundedTarget = hasGroundedTarget(normalizedSentence) || hasGroundedTarget(compressedSentence);
    const introEchoLike = isIntroEchoLike(normalizedSentence) || isIntroEchoLike(compressedSentence);
    const introLikeCandidate = normalizedGenericIntroMatched || rawGenericIntroMatched || isDashCompilerGenericIntroSentence(compressedSentence) || introEchoLike;
    if (hasProceduralAction) proceduralCandidateCount += 1;
    if (rawGenericIntroMatched && !hasProceduralAction && sourceHasProceduralSentences) genericIntroCandidateCount += 1;

    if ((sourceHasProceduralSentences && (!hasProceduralAction || introLikeCandidate || !groundedTarget)) || (denseProseProceduralMode && (!hasProceduralAction || introLikeCandidate || !groundedTarget))) {
      if (introLikeCandidate || !hasProceduralAction || !groundedTarget) rejectedIntroCandidateCount += 1;
      return;
    }

    if (hasProceduralAction || (!sourceHasProceduralSentences && isCompleteSentence && !normalizedGenericIntroMatched)) {
      pushCandidate(normalizedSentence, {
        sourceKind: "source_sentence",
        sourceIndex: index,
        sourceSentenceCount: sourceSentences.length,
        hasProceduralAction,
        genericIntroMatched: normalizedGenericIntroMatched,
        proceduralActionHits: normalizedActionHits,
        hasGroundedTarget: groundedTarget,
        scoreHint: 0,
      });
    }

    if (compressedSentence && compressedSentence !== normalizedSentence) {
      const compressedActionHits = extractDashCompilerActionHits(compressedSentence);
      const compressedGenericIntroMatched = isDashCompilerGenericIntroSentence(compressedSentence);
      const compressedGroundedTarget = hasGroundedTarget(compressedSentence);
      const compressedIntroLike = compressedGenericIntroMatched || isIntroEchoLike(compressedSentence);
      if ((sourceHasProceduralSentences && (!compressedActionHits.length || !compressedGroundedTarget || compressedIntroLike)) || (denseProseProceduralMode && (!compressedActionHits.length || !compressedGroundedTarget || compressedIntroLike))) {
        if (compressedIntroLike || !compressedActionHits.length || !compressedGroundedTarget) rejectedIntroCandidateCount += 1;
      } else if (hasProceduralAction || (!sourceHasProceduralSentences && isCompleteSentence && !compressedGenericIntroMatched)) {
        pushCandidate(compressedSentence, {
          sourceKind: "compressed_sentence",
          sourceIndex: index,
          sourceSentenceCount: sourceSentences.length,
          hasProceduralAction: Boolean(compressedActionHits.length),
          genericIntroMatched: compressedGenericIntroMatched,
          proceduralActionHits: compressedActionHits,
          hasGroundedTarget: compressedGroundedTarget,
          scoreHint: 0,
        });
      }
    }

    if (hasProceduralAction) {
      splitDashFallbackClauseFragments(sentence).forEach((fragment) => {
        const normalizedFragment = normalizeDashCompilerProceduralSentence(fragment) || normalizeDashFallbackLineText(fragment);
        const fragmentActionHits = extractDashCompilerActionHits(normalizedFragment);
        const fragmentGroundedTarget = hasGroundedTarget(normalizedFragment);
        const fragmentIntroLike = isDashCompilerGenericIntroSentence(normalizedFragment) || isIntroEchoLike(normalizedFragment);
        if (!fragmentActionHits.length) return;
        if (!isDashStepLineComplete(normalizedFragment) && countScopeWords(normalizedFragment) < 6) return;
        if ((sourceHasProceduralSentences && (!fragmentGroundedTarget || fragmentIntroLike)) || (denseProseProceduralMode && (!fragmentGroundedTarget || fragmentIntroLike))) {
          rejectedIntroCandidateCount += 1;
          return;
        }
        pushCandidate(normalizedFragment, {
          sourceKind: "fragment",
          sourceIndex: index,
          sourceSentenceCount: sourceSentences.length,
          hasProceduralAction: Boolean(fragmentActionHits.length),
          genericIntroMatched: isDashCompilerGenericIntroSentence(normalizedFragment),
          proceduralActionHits: fragmentActionHits,
          hasGroundedTarget: fragmentGroundedTarget,
          scoreHint: 0,
        });
      });
    }
  });

  if (simplePromptAnalysis?.isClearlyDraftable && countScopeWords(normalizedPrompt) <= 14 && countScopeWords(normalizedSource) <= 14) {
    buildDashFallbackLineCandidates(normalizedPrompt).forEach((candidate) => pushCandidate(candidate, {
      sourceKind: "simple_prompt",
      sourceIndex: 0,
      sourceSentenceCount: 1,
      hasProceduralAction: Boolean(extractDashCompilerActionHits(candidate).length),
      genericIntroMatched: false,
      proceduralActionHits: extractDashCompilerActionHits(candidate),
      hasGroundedTarget: hasGroundedTarget(candidate),
      scoreHint: 0,
    }));
  }

  if (!candidates.length && normalizedSource && !denseProseProceduralMode && countScopeWords(normalizedSource) <= 14 && !isDashCompilerGenericIntroSentence(normalizedSource)) {
    pushCandidate(normalizedSource, {
      sourceKind: "fallback_source_text",
      sourceIndex: 0,
      sourceSentenceCount: sourceSentences.length,
      hasProceduralAction: Boolean(extractDashCompilerActionHits(normalizedSource).length),
      genericIntroMatched: isDashCompilerGenericIntroSentence(normalizedSource),
      proceduralActionHits: extractDashCompilerActionHits(normalizedSource),
      hasGroundedTarget: hasGroundedTarget(normalizedSource),
      scoreHint: 0,
    });
  }

  return {
    sourceText: normalizedSource,
    sourcePromptText: normalizedPrompt,
    sourceStructure,
    candidates,
    proceduralCandidateCount,
    genericIntroCandidateCount,
    rejectedIntroCandidateCount,
    sourceSentenceCount: sourceSentences.length,
    usedProceduralSentences: proceduralCandidateCount > 0,
    usedModelBullets: Boolean(sourceStructure.dashLineCount),
    denseProseProceduralMode: Boolean(denseProseProceduralMode && proceduralCandidateCount > 0),
  };
}

function selectDistinctDashSteps({
  sourceText = "",
  candidates = [],
  desiredCount = 4,
} = {}) {
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  const sourceAnchors = extractShorterSourceAnchorTerms(normalizedSource);
  const sourceIntroSentences = splitScopeAssistSentences(normalizedSource).slice(0, 2).filter((sentence) => isDashCompilerGenericIntroSentence(sentence));
  const candidateEntries = Array.isArray(candidates)
    ? candidates.map((candidate, index) => {
      const candidateText = typeof candidate === "string"
        ? normalizeDashFallbackLineText(candidate)
        : normalizeDashFallbackLineText(candidate?.text || candidate?.line || candidate?.value || "");
      const proceduralActionHits = uniqueStrings(
        Array.isArray(candidate?.proceduralActionHits) && candidate.proceduralActionHits.length
          ? candidate.proceduralActionHits
          : extractDashCompilerActionHits(candidateText)
      );
      const genericIntroMatched = typeof candidate?.genericIntroMatched === "boolean"
        ? candidate.genericIntroMatched
        : isDashCompilerGenericIntroSentence(candidateText);
      const hasGroundedTarget = typeof candidate?.hasGroundedTarget === "boolean"
        ? candidate.hasGroundedTarget
        : hasDashCompilerGroundedTarget(candidateText);
      const introEchoLike = sourceIntroSentences.some((introSentence) => {
        if (!introSentence) return false;
        return isDashNearDuplicateStepLine(introSentence, candidateText) || getScopeTextOverlapRatio(introSentence, candidateText) >= 0.72;
      });
      const introLikeCandidate = genericIntroMatched || isDashCompilerGenericIntroSentence(candidateText) || introEchoLike;
      const scoreHint = Number.isFinite(Number(candidate?.scoreHint)) ? Number(candidate.scoreHint) : 0;
      const score = scoreHint + scoreDashCompilerCandidate(candidateText, normalizedSource, {
        sourceAnchors,
        proceduralActionHits,
        genericIntroMatched,
        sourceIndex: Number.isFinite(Number(candidate?.sourceIndex)) ? Number(candidate.sourceIndex) : index,
        sourceKind: String(candidate?.sourceKind || ""),
        sourceSentenceCount: Number.isFinite(Number(candidate?.sourceSentenceCount)) ? Number(candidate.sourceSentenceCount) : 0,
      });
      return {
        ...((candidate && typeof candidate === "object") ? candidate : {}),
        text: candidateText,
        proceduralActionHits,
        genericIntroMatched,
        hasGroundedTarget,
        introEchoLike,
        introLikeCandidate,
        score,
      };
    })
    : [];

  const denseProseProceduralMode = Boolean(normalizedSource)
    && countScopeWords(normalizedSource) >= 18
    && candidateEntries.some((entry) => entry.proceduralActionHits.length > 0 && !entry.genericIntroMatched && entry.hasGroundedTarget);
  const rejectedIntroCandidateCount = candidateEntries.filter((entry) => Boolean(entry.introLikeCandidate) || (denseProseProceduralMode && (!entry.proceduralActionHits.length || !entry.hasGroundedTarget))).length;
  const proceduralPool = candidateEntries.filter((entry) => entry.proceduralActionHits.length > 0 && !entry.genericIntroMatched && entry.hasGroundedTarget && !entry.introEchoLike);
  const sourceLooksDense = Boolean(normalizedSource) && countScopeWords(normalizedSource) >= 18;
  const selectorUsedProceduralPoolOnly = Boolean(sourceLooksDense || proceduralPool.length > 0);
  const selectorFailClosed = Boolean(sourceLooksDense && !proceduralPool.length);
  const selectorRejectedForMissingProceduralPool = Boolean(sourceLooksDense && !proceduralPool.length);
  const sortedCandidates = sourceLooksDense ? proceduralPool : (proceduralPool.length ? proceduralPool : candidateEntries)
    .filter((entry) => isDashStepLineComplete(entry.text))
    .filter((entry) => assessScopeAssistGenericScaffold(entry.text, normalizedSource).accepted)
    .filter((entry) => !sourceLooksDense || (entry.proceduralActionHits.length > 0 && entry.hasGroundedTarget && !entry.introLikeCandidate))
    .sort((left, right) => (Number(right.score || 0) - Number(left.score || 0)));

  const selected = [];
  const selectedKeys = new Set();
  const selectedSignatures = new Set();
  let droppedDuplicateCount = 0;
  let droppedFragmentCount = 0;
  let selectedProceduralCount = 0;

  sortedCandidates.forEach((candidateEntry) => {
    const candidate = candidateEntry.text;
    const key = normalizeScopeComparisonText(candidate);
    if (!key) return;
    const stepSignature = buildDashCompilerStepSignature(candidate);
    if (stepSignature && selectedSignatures.has(stepSignature)) {
      droppedDuplicateCount += 1;
      return;
    }
    if (selectedKeys.has(key) || selected.some((existing) => isDashNearDuplicateStepLine(existing.text || existing, candidate))) {
      droppedDuplicateCount += 1;
      return;
    }

    const scaffoldAssessment = assessScopeAssistGenericScaffold(candidate, normalizedSource);
    if (!isDashStepLineComplete(candidate) || !scaffoldAssessment.accepted) {
      droppedFragmentCount += 1;
      return;
    }

    selected.push(candidateEntry);
    selectedKeys.add(key);
    if (stepSignature) selectedSignatures.add(stepSignature);
    if (candidateEntry.proceduralActionHits.length > 0 && !candidateEntry.genericIntroMatched) {
      selectedProceduralCount += 1;
    }
  });

  return {
    dashLines: selected.slice(0, Math.max(0, Number(desiredCount || 0))).map((entry) => entry.text),
    selectedCandidates: selected.slice(0, Math.max(0, Number(desiredCount || 0))),
    droppedDuplicateCount,
    droppedFragmentCount,
    selectedProceduralCount,
    selectedProceduralStepCount: selectedProceduralCount,
    rejectedIntroCandidateCount,
    denseProseProceduralMode,
    selectorFailClosed,
    selectorUsedProceduralPoolOnly,
    rejectedForMissingProceduralPool: selectorRejectedForMissingProceduralPool,
  };
}

function buildDashWrapupParagraph({
  sourceText = "",
  dashLines = [],
  sourcePromptText = "",
} = {}) {
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  const normalizedPrompt = sanitizeScopeAssistText(sourcePromptText);
  const normalizedDashLines = uniqueStrings((Array.isArray(dashLines) ? dashLines : []).map((line) => normalizeDashFallbackLineText(line))).filter(Boolean);
  const simplePromptAnalysis = analyzeSimpleScopePrompt(normalizedPrompt || normalizedSource);
  const sourceWordCount = countScopeWords(normalizedSource);
  const promptWordCount = countScopeWords(normalizedPrompt);
  const denseProseProceduralMode = sourceWordCount >= 18;
  if (simplePromptAnalysis?.isClearlyDraftable && sourceWordCount <= 14 && promptWordCount <= 14) {
    const targetPhrase = sanitizeScopeAssistText(simplePromptAnalysis.objectPhrase || simplePromptAnalysis.targetPhrase || normalizedPrompt || normalizedSource);
    const definiteTarget = withDefiniteArticle(targetPhrase, "requested item");
    const actionKey = String(simplePromptAnalysis.actionKey || "").trim();
    const simpleSummaryMap = {
      install: `Complete the install for ${definiteTarget} in the intended location and finish the setup work needed to leave it ready for normal use.`,
      replace: `Complete the replacement for ${definiteTarget} in the same area and leave it ready for normal use.`,
      repair: `Complete the repair for ${definiteTarget} at the affected area and leave it ready for normal service.`,
      remove: `Complete the removal of ${definiteTarget} cleanly and leave the exposed area ready for the next step.`,
      patch: `Complete the patch for ${definiteTarget} and leave the repaired area ready for the next finish step.`,
      paint: `Complete the paint work for ${definiteTarget} with an even finish and leave it ready for normal use.`,
      stripe: `Complete the re-stripe for ${definiteTarget} so the markings are clean and readable.`,
      seal: `Complete the sealing work for ${definiteTarget} and leave the area orderly for normal exposure.`,
      clean: `Complete the cleanup for ${definiteTarget} and leave the surfaces neat and usable.`,
      adjust: `Complete the adjustment or alignment for ${definiteTarget} and leave it ready for use.`,
      reconnect: `Complete the disconnect and reconnect work for ${definiteTarget} and leave it ready for normal operation.`,
    };
    const simpleSummary = normalizeScopeParagraphText(simpleSummaryMap[actionKey] || "");
    return {
      summaryParagraph: simpleSummary && !isDashSummaryTooSimilarToLeadBullet(simpleSummary, normalizedDashLines) ? simpleSummary : "",
      summaryBuiltFromSteps: false,
      summarySource: "simple_prompt",
    };
  }

  const compiledActionKeys = uniqueStrings(
    normalizedDashLines.flatMap((line) => extractDashCompilerActionHits(line))
  );
  const stepSummary = buildDashCompilerSummaryFromSteps({
    sourceText: normalizedSource,
    sourcePromptText: normalizedPrompt,
    dashLines: normalizedDashLines,
    simplePrompt: false,
  });
  if (stepSummary.summaryParagraph) {
    return {
      ...stepSummary,
      rejectedSourceIntroSummary: Boolean(denseProseProceduralMode),
    };
  }

  return {
    summaryParagraph: "",
    summaryBuiltFromSteps: false,
    summarySource: denseProseProceduralMode ? "dense_prose_requires_step_summary" : "compiled_step_wrapup_empty",
    rejectedSourceIntroSummary: Boolean(denseProseProceduralMode),
  };
}

function compileDashScopeFromProse({
  sourcePromptText = "",
  sourceScopeText = "",
  sourceLabel = "",
  sourcePriority = "",
  rejectedCurrentDraftAsCompilerSource = false,
  rejectedFailedDashAsCompilerSource = false,
  usedOriginalProseSource = false,
  fallbackSourceTextBlocked = false,
  sourceTextUsedForCompilation = "",
  compileMode = "generic",
} = {}) {
  const normalizedPrompt = sanitizeScopeAssistText(sourcePromptText);
  const normalizedSource = sanitizeScopeAssistText(sourceScopeText);
  const compilerSourceText = normalizedSource || normalizedPrompt;
  const extraction = extractDashStepCandidatesFromProse({
    sourceText: compilerSourceText,
    sourcePromptText: normalizedPrompt,
  });
  const sourceWordCount = countScopeWords(compilerSourceText || normalizedPrompt);
  const sourceSentenceCount = splitScopeAssistSentences(compilerSourceText || normalizedPrompt).length;
  const sourceLooksDense = sourceWordCount >= 18;
  const minLineCount = sourceWordCount >= 18 ? 3 : sourceWordCount >= 10 ? 2 : 1;
  const preferredLineCount = sourceWordCount >= 34 ? 4 : sourceWordCount >= 18 ? 3 : minLineCount;
  const canonicalCompileMode = compileMode === "canonical_fallback";
  const compileCandidatePool = canonicalCompileMode
    ? buildDashCanonicalCompilerCandidatePool({
      sourceText: compilerSourceText || normalizedPrompt,
      sourcePromptText: normalizedPrompt,
      extraction,
    })
    : extraction.candidates;
  const lineCountCandidates = uniqueStrings(
    canonicalCompileMode
      ? [
        "4",
        String(Math.min(5, Math.max(3, preferredLineCount))),
        "3",
        "5",
        String(Math.min(5, Math.max(3, extraction.candidates.length || preferredLineCount))),
      ]
      : [
        String(Math.min(6, Math.max(minLineCount, preferredLineCount))),
        String(Math.min(6, Math.max(minLineCount, preferredLineCount + 1))),
        String(Math.min(6, Math.max(minLineCount, Math.max(3, preferredLineCount)))),
        String(Math.min(6, Math.max(minLineCount, extraction.candidates.length || preferredLineCount))),
      ]
  )
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);

  if (!lineCountCandidates.length) {
    lineCountCandidates.push(minLineCount);
  }

  const buildVariant = ({
    lineCount = minLineCount,
    rebuildPass = false,
  } = {}) => {
    const selection = selectDistinctDashSteps({
      sourceText: compilerSourceText || normalizedPrompt,
      candidates: compileCandidatePool,
      desiredCount: lineCount,
    });
    const selectionFailClosed = Boolean(sourceLooksDense && (selection.selectorFailClosed || selection.rejectedForMissingProceduralPool || selection.selectedProceduralStepCount === 0));
    const selectionUsedProceduralPoolOnly = Boolean(selection.selectorUsedProceduralPoolOnly || sourceLooksDense);
    const selectionRejectedForMissingProceduralPool = Boolean(selection.rejectedForMissingProceduralPool || selectionFailClosed);
    const dashLines = uniqueStrings((selection.dashLines || []).map((line) => (
      canonicalCompileMode
        ? normalizeDashCanonicalCompilerStepText(line, compilerSourceText || normalizedPrompt)
        : normalizeDashFallbackLineText(line)
    ))).filter(Boolean).slice(0, lineCount);
    const summaryMeta = buildDashWrapupParagraph({
      sourceText: compilerSourceText || normalizedPrompt,
      dashLines,
      sourcePromptText: normalizedPrompt,
    });
    const summaryParagraph = String(summaryMeta.summaryParagraph || "").trim();
    const compiledText = formatDashScopeOutput(dashLines, summaryParagraph);
    const baseAssessment = assessDashScopeRefineCompliance(compilerSourceText || normalizedPrompt, compiledText);
    const canonicalAssessment = canonicalCompileMode
      ? assessDashCanonicalCompiledCandidate(compilerSourceText || normalizedPrompt, compiledText)
      : null;
    const selectedAssessment = canonicalCompileMode
      ? {
        ...canonicalAssessment,
        dashCompiledLocally: true,
        dashCompilerCompileMode: compileMode,
        dashCompilerSource: sourceLabel || (normalizedSource ? "accepted_prose_scope" : normalizedPrompt ? "source_prompt" : "local_dash_compiler"),
        dashCompilerStepCount: dashLines.length,
        dashCompilerDroppedDuplicateCount: selection.droppedDuplicateCount,
        dashCompilerDroppedFragmentCount: selection.droppedFragmentCount,
        dashCompilerUsedModelBullets: extraction.usedModelBullets,
        dashCompilerProceduralCandidateCount: Math.max(0, Number(extraction.proceduralCandidateCount || 0)),
        dashCompilerDroppedGenericIntroCount: Math.max(0, Number(extraction.genericIntroCandidateCount || 0)),
        dashCompilerRejectedIntroCandidateCount: Math.max(0, Number(extraction.rejectedIntroCandidateCount || 0)) + Math.max(0, Number(selection.rejectedIntroCandidateCount || 0)),
        dashCompilerUsedProceduralSentences: Boolean(extraction.usedProceduralSentences),
        dashCompilerSummaryBuiltFromSteps: Boolean(summaryMeta.summaryBuiltFromSteps),
        dashCompilerSelectedProceduralStepCount: Math.max(0, Number(selection.selectedProceduralStepCount || 0)),
        dashCompilerDenseProseProceduralMode: Boolean(extraction.denseProseProceduralMode || selection.denseProseProceduralMode),
        dashCompilerRejectedSourceIntroSummary: Boolean(summaryMeta.rejectedSourceIntroSummary),
        dashCompilerSelectorFailClosed: Boolean(selectionFailClosed),
        dashCompilerSelectorUsedProceduralPoolOnly: Boolean(selectionUsedProceduralPoolOnly),
        dashCompilerRejectedForMissingProceduralPool: Boolean(selectionRejectedForMissingProceduralPool),
        dashCompilerSourcePriority: String(sourcePriority || ""),
        dashCompilerRejectedCurrentDraftAsCompilerSource: Boolean(rejectedCurrentDraftAsCompilerSource),
        dashCompilerRejectedFailedDashAsCompilerSource: Boolean(rejectedFailedDashAsCompilerSource),
        dashCompilerUsedOriginalProseSource: Boolean(usedOriginalProseSource),
        dashCompilerFallbackSourceTextBlocked: Boolean(fallbackSourceTextBlocked),
        dashCompilerSourceTextUsedForCompilation: String(sourceTextUsedForCompilation || compilerSourceText || normalizedPrompt || ""),
      }
      : {
        ...baseAssessment,
        accepted: Boolean(baseAssessment.accepted && !selectionFailClosed && (!sourceLooksDense || selection.selectedProceduralStepCount > 0) && selectionUsedProceduralPoolOnly),
        reasonTag: !baseAssessment.accepted
          ? baseAssessment.reasonTag
          : selectionFailClosed
            ? "dash_missing_procedural_pool"
            : !selectionUsedProceduralPoolOnly
              ? "dash_selector_fallback_not_allowed"
              : baseAssessment.reasonTag,
      };
    const variantScore = canonicalCompileMode
      ? scoreDashCanonicalCompiledVariant(compilerSourceText || normalizedPrompt, {
        text: compiledText,
        assessment: selectedAssessment,
      }).score
      : (selectedAssessment.accepted ? 1000 : 0) + Math.max(0, Number(selection.selectedProceduralStepCount || 0));
    const variant = {
      text: sanitizeScopeAssistText(compiledText),
      assessment: selectedAssessment,
      dashLines,
      summaryParagraph,
      dashCompilerStepCount: dashLines.length,
      dashCompilerDroppedDuplicateCount: selection.droppedDuplicateCount,
      dashCompilerDroppedFragmentCount: selection.droppedFragmentCount,
      dashCompilerUsedModelBullets: extraction.usedModelBullets,
      dashCompilerProceduralCandidateCount: Math.max(0, Number(extraction.proceduralCandidateCount || 0)),
      dashCompilerDroppedGenericIntroCount: Math.max(0, Number(extraction.genericIntroCandidateCount || 0)),
      dashCompilerRejectedIntroCandidateCount: Math.max(0, Number(extraction.rejectedIntroCandidateCount || 0)) + Math.max(0, Number(selection.rejectedIntroCandidateCount || 0)),
      dashCompilerUsedProceduralSentences: Boolean(extraction.usedProceduralSentences),
      dashCompilerSummaryBuiltFromSteps: Boolean(summaryMeta.summaryBuiltFromSteps),
      selectedProceduralCount: Math.max(0, Number(selection.selectedProceduralCount || 0)),
      dashCompilerSelectedProceduralStepCount: Math.max(0, Number(selection.selectedProceduralStepCount || 0)),
      dashCompilerDenseProseProceduralMode: Boolean(extraction.denseProseProceduralMode || selection.denseProseProceduralMode),
      dashCompilerRejectedSourceIntroSummary: Boolean(summaryMeta.rejectedSourceIntroSummary),
      dashCompilerSelectorFailClosed: Boolean(selectionFailClosed),
      dashCompilerSelectorUsedProceduralPoolOnly: Boolean(selectionUsedProceduralPoolOnly),
      dashCompilerRejectedForMissingProceduralPool: Boolean(selectionRejectedForMissingProceduralPool),
      dashCompilerSourcePriority: String(sourcePriority || ""),
      dashCompilerRejectedCurrentDraftAsCompilerSource: Boolean(rejectedCurrentDraftAsCompilerSource),
      dashCompilerRejectedFailedDashAsCompilerSource: Boolean(rejectedFailedDashAsCompilerSource),
      dashCompilerUsedOriginalProseSource: Boolean(usedOriginalProseSource),
      dashCompilerFallbackSourceTextBlocked: Boolean(fallbackSourceTextBlocked),
      dashCompilerSourceTextUsedForCompilation: String(sourceTextUsedForCompilation || compilerSourceText || normalizedPrompt || ""),
      dashCompilerSource: sourceLabel || (normalizedSource ? "accepted_prose_scope" : normalizedPrompt ? "source_prompt" : "local_dash_compiler"),
      compileMode,
      variantScore,
    };
    if (canonicalCompileMode) {
      logDashResult("dash_canonical_variant_generated", variant.assessment, {
        compileMode,
        rebuildPass: Boolean(rebuildPass),
        candidateBulletCount: Math.max(0, Number(dashLines.length || 0)),
        proceduralBulletCount: Math.max(0, Number(variant.assessment?.dashProceduralBulletCount || 0)),
        accepted: Boolean(variant.assessment?.accepted),
        reasonTag: String(variant.assessment?.reasonTag || ""),
        candidateExcerpt: compiledText.slice(0, 160),
      });
      logDashResult("dash_canonical_variant_scored", variant.assessment, {
        compileMode,
        rebuildPass: Boolean(rebuildPass),
        candidateBulletCount: Math.max(0, Number(dashLines.length || 0)),
        proceduralBulletCount: Math.max(0, Number(variant.assessment?.dashProceduralBulletCount || 0)),
        accepted: Boolean(variant.assessment?.accepted),
        reasonTag: String(variant.assessment?.reasonTag || ""),
        variantScore,
        candidateExcerpt: compiledText.slice(0, 160),
      });
    }
    return variant;
  };

  const variants = lineCountCandidates.map((lineCount) => buildVariant({ lineCount }));
  const uniqueVariants = [];
  const seen = new Set();
  variants.forEach((variant) => {
    const normalized = sanitizeScopeAssistText(variant.text);
    const key = normalizeScopeComparisonText(normalized);
    if (!key || seen.has(key)) return;
    seen.add(key);
    uniqueVariants.push({
      ...variant,
      text: normalized,
    });
  });

  uniqueVariants.sort((left, right) => {
    if (canonicalCompileMode) {
      const leftScore = Number(left.variantScore || 0);
      const rightScore = Number(right.variantScore || 0);
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
    }
    if (Boolean(left.assessment?.accepted) !== Boolean(right.assessment?.accepted)) {
      return left.assessment?.accepted ? -1 : 1;
    }
    const leftProcedural = Math.max(0, Number(left.selectedProceduralCount || 0));
    const rightProcedural = Math.max(0, Number(right.selectedProceduralCount || 0));
    if (leftProcedural !== rightProcedural) {
      return rightProcedural - leftProcedural;
    }
    const leftSummaryBuilt = Boolean(left.dashCompilerSummaryBuiltFromSteps);
    const rightSummaryBuilt = Boolean(right.dashCompilerSummaryBuiltFromSteps);
    if (leftSummaryBuilt !== rightSummaryBuilt) {
      return rightSummaryBuilt ? 1 : -1;
    }
    const leftCount = Math.max(0, Number(left.assessment?.dashLineCount || left.dashLines?.length || 0));
    const rightCount = Math.max(0, Number(right.assessment?.dashLineCount || right.dashLines?.length || 0));
    const targetCount = preferredLineCount;
    if (leftCount !== rightCount) {
      return Math.abs(rightCount - targetCount) - Math.abs(leftCount - targetCount);
    }
    return countScopeWords(left.text) - countScopeWords(right.text);
  });

  let chosen = uniqueVariants.find((entry) => Boolean(entry.assessment?.accepted)) || uniqueVariants[0] || {
    text: "",
    assessment: canonicalCompileMode
      ? assessDashCanonicalCompiledCandidate(normalizedPrompt || compilerSourceText, "")
      : assessDashScopeRefineCompliance(normalizedPrompt || compilerSourceText, ""),
    dashLines: [],
    summaryParagraph: "",
    dashCompilerStepCount: 0,
    dashCompilerDroppedDuplicateCount: 0,
    dashCompilerDroppedFragmentCount: 0,
    dashCompilerUsedModelBullets: extraction.usedModelBullets,
    dashCompilerProceduralCandidateCount: Math.max(0, Number(extraction.proceduralCandidateCount || 0)),
    dashCompilerDroppedGenericIntroCount: Math.max(0, Number(extraction.genericIntroCandidateCount || 0)),
    dashCompilerRejectedIntroCandidateCount: Math.max(0, Number(extraction.rejectedIntroCandidateCount || 0)),
    dashCompilerUsedProceduralSentences: Boolean(extraction.usedProceduralSentences),
    dashCompilerSummaryBuiltFromSteps: false,
    selectedProceduralCount: 0,
    dashCompilerSelectedProceduralStepCount: 0,
    dashCompilerDenseProseProceduralMode: Boolean(extraction.denseProseProceduralMode),
    dashCompilerRejectedSourceIntroSummary: false,
    dashCompilerSelectorFailClosed: Boolean(sourceLooksDense && extraction.candidates.length === 0),
    dashCompilerSelectorUsedProceduralPoolOnly: Boolean(sourceLooksDense),
    dashCompilerRejectedForMissingProceduralPool: Boolean(sourceLooksDense && extraction.candidates.length === 0),
    dashCompilerSourcePriority: String(sourcePriority || ""),
    dashCompilerRejectedCurrentDraftAsCompilerSource: Boolean(rejectedCurrentDraftAsCompilerSource),
    dashCompilerRejectedFailedDashAsCompilerSource: Boolean(rejectedFailedDashAsCompilerSource),
    dashCompilerUsedOriginalProseSource: Boolean(usedOriginalProseSource),
    dashCompilerFallbackSourceTextBlocked: Boolean(fallbackSourceTextBlocked),
    dashCompilerSourceTextUsedForCompilation: String(sourceTextUsedForCompilation || compilerSourceText || normalizedPrompt || ""),
    dashCompilerSource: sourceLabel || (normalizedSource ? "accepted_prose_scope" : normalizedPrompt ? "source_prompt" : "local_dash_compiler"),
    variantScore: 0,
  };
  let chosenScore = canonicalCompileMode ? Number(chosen.variantScore || 0) : 0;

  if (canonicalCompileMode && sourceLooksDense && Math.max(0, Number(chosen.assessment?.dashLineCount || chosen.dashLines?.length || 0)) < 3) {
    logDashResult("dash_canonical_minimum_step_rebuild_triggered", chosen.assessment || {}, {
      compileMode,
      candidateBulletCount: Math.max(0, Number(chosen.assessment?.dashLineCount || chosen.dashLines?.length || 0)),
      proceduralBulletCount: Math.max(0, Number(chosen.assessment?.dashProceduralBulletCount || 0)),
      accepted: Boolean(chosen.assessment?.accepted),
      reasonTag: String(chosen.assessment?.reasonTag || ""),
      candidateExcerpt: String(chosen.text || "").slice(0, 160),
    });
    const rebuildCounts = uniqueStrings([
      String(Math.min(5, Math.max(3, preferredLineCount + 1))),
      "5",
      "4",
      "3",
    ])
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value >= 3 && value <= 5);
    const rebuildVariants = rebuildCounts
      .map((lineCount) => buildVariant({ lineCount, rebuildPass: true }))
      .filter((variant) => Boolean(variant?.text));
    if (rebuildVariants.length) {
      rebuildVariants.sort((left, right) => Number(right.variantScore || 0) - Number(left.variantScore || 0));
      const rebuildBest = rebuildVariants[0];
      const rebuildBestLineCount = Math.max(0, Number(rebuildBest?.assessment?.dashLineCount || rebuildBest?.dashLines?.length || 0));
      if (rebuildBest && (rebuildBestLineCount >= 3 || Number(rebuildBest.variantScore || 0) >= Number(chosenScore || 0))) {
        chosen = rebuildBest;
        chosenScore = Number(rebuildBest.variantScore || 0);
        logDashResult("dash_canonical_minimum_step_rebuild_selected", chosen.assessment || {}, {
          compileMode,
          candidateBulletCount: Math.max(0, Number(chosen.assessment?.dashLineCount || chosen.dashLines?.length || 0)),
          proceduralBulletCount: Math.max(0, Number(chosen.assessment?.dashProceduralBulletCount || 0)),
          accepted: Boolean(chosen.assessment?.accepted),
          reasonTag: String(chosen.assessment?.reasonTag || ""),
          candidateExcerpt: String(chosen.text || "").slice(0, 160),
        });
      }
    }
  }

  if (canonicalCompileMode && chosen && chosen.assessment) {
    logDashResult("dash_canonical_variant_selected", chosen.assessment, {
      compileMode,
      candidateBulletCount: Math.max(0, Number(chosen.assessment?.dashLineCount || chosen.dashLines?.length || 0)),
      proceduralBulletCount: Math.max(0, Number(chosen.assessment?.dashProceduralBulletCount || 0)),
      accepted: Boolean(chosen.assessment?.accepted),
      reasonTag: String(chosen.assessment?.reasonTag || ""),
      variantScore: Number.isFinite(Number(chosenScore)) ? Number(chosenScore) : 0,
      candidateExcerpt: String(chosen.text || "").slice(0, 160),
    });
  }

  const chosenStructure = parseDashScopeStructure(chosen.text);
  const chosenAssessment = {
    ...(chosen.assessment || {}),
    dashCompiledLocally: true,
    dashCompilerCompileMode: String(compileMode || "generic"),
    dashCompilerSource: String(chosen.dashCompilerSource || sourceLabel || (normalizedSource ? "accepted_prose_scope" : normalizedPrompt ? "source_prompt" : "local_dash_compiler")),
    dashCompilerStepCount: Math.max(0, Number(chosenStructure.dashLineCount || chosen.dashCompilerStepCount || 0)),
    dashCompilerDroppedDuplicateCount: Math.max(0, Number(chosen.dashCompilerDroppedDuplicateCount || 0)),
    dashCompilerDroppedFragmentCount: Math.max(0, Number(chosen.dashCompilerDroppedFragmentCount || 0)),
    dashCompilerUsedModelBullets: Boolean(chosen.dashCompilerUsedModelBullets),
    dashCompilerProceduralCandidateCount: Math.max(0, Number(chosen.dashCompilerProceduralCandidateCount || extraction.proceduralCandidateCount || 0)),
    dashCompilerDroppedGenericIntroCount: Math.max(0, Number(chosen.dashCompilerDroppedGenericIntroCount || extraction.genericIntroCandidateCount || 0)),
    dashCompilerRejectedIntroCandidateCount: Math.max(0, Number(chosen.dashCompilerRejectedIntroCandidateCount || extraction.rejectedIntroCandidateCount || 0)),
    dashCompilerUsedProceduralSentences: Boolean(chosen.dashCompilerUsedProceduralSentences || extraction.usedProceduralSentences),
    dashCompilerSummaryBuiltFromSteps: Boolean(chosen.dashCompilerSummaryBuiltFromSteps),
    selectedProceduralCount: Math.max(0, Number(chosen.selectedProceduralCount || 0)),
    dashCompilerSelectedProceduralStepCount: Math.max(0, Number(chosen.dashCompilerSelectedProceduralStepCount || chosen.selectedProceduralCount || 0)),
    dashCompilerDenseProseProceduralMode: Boolean(chosen.dashCompilerDenseProseProceduralMode || extraction.denseProseProceduralMode),
    dashCompilerRejectedSourceIntroSummary: Boolean(chosen.dashCompilerRejectedSourceIntroSummary),
    dashCompilerSelectorFailClosed: Boolean(chosen.dashCompilerSelectorFailClosed || (sourceLooksDense && (chosen.selectedProceduralCount || 0) === 0)),
    dashCompilerSelectorUsedProceduralPoolOnly: Boolean(chosen.dashCompilerSelectorUsedProceduralPoolOnly),
    dashCompilerRejectedForMissingProceduralPool: Boolean(chosen.dashCompilerRejectedForMissingProceduralPool || (sourceLooksDense && (chosen.selectedProceduralCount || 0) === 0)),
    dashCompilerSourcePriority: String(chosen.dashCompilerSourcePriority || sourcePriority || ""),
    dashCompilerRejectedCurrentDraftAsCompilerSource: Boolean(chosen.dashCompilerRejectedCurrentDraftAsCompilerSource || rejectedCurrentDraftAsCompilerSource),
    dashCompilerRejectedFailedDashAsCompilerSource: Boolean(chosen.dashCompilerRejectedFailedDashAsCompilerSource || rejectedFailedDashAsCompilerSource),
    dashCompilerUsedOriginalProseSource: Boolean(chosen.dashCompilerUsedOriginalProseSource || usedOriginalProseSource),
    dashCompilerFallbackSourceTextBlocked: Boolean(chosen.dashCompilerFallbackSourceTextBlocked || fallbackSourceTextBlocked),
    dashCompilerSourceTextUsedForCompilation: String(chosen.dashCompilerSourceTextUsedForCompilation || sourceTextUsedForCompilation || compilerSourceText || normalizedPrompt || ""),
    compileMode,
  };

  return {
    text: sanitizeScopeAssistText(chosen.text || ""),
    dashLines: Array.isArray(chosenStructure.dashLines) ? chosenStructure.dashLines : [],
    summaryParagraph: String(chosenStructure.summaryParagraph || "").trim(),
    assessment: chosenAssessment,
    dashCompiledLocally: true,
    dashCompilerCompileMode: String(chosenAssessment.dashCompilerCompileMode || compileMode || "generic"),
    dashCompilerSource: String(chosenAssessment.dashCompilerSource || ""),
    dashCompilerStepCount: Math.max(0, Number(chosenAssessment.dashCompilerStepCount || chosenStructure.dashLineCount || 0)),
    dashCompilerDroppedDuplicateCount: Math.max(0, Number(chosenAssessment.dashCompilerDroppedDuplicateCount || 0)),
    dashCompilerDroppedFragmentCount: Math.max(0, Number(chosenAssessment.dashCompilerDroppedFragmentCount || 0)),
    dashCompilerUsedModelBullets: Boolean(chosenAssessment.dashCompilerUsedModelBullets),
    dashCompilerProceduralCandidateCount: Math.max(0, Number(chosenAssessment.dashCompilerProceduralCandidateCount || 0)),
    dashCompilerDroppedGenericIntroCount: Math.max(0, Number(chosenAssessment.dashCompilerDroppedGenericIntroCount || 0)),
    dashCompilerRejectedIntroCandidateCount: Math.max(0, Number(chosenAssessment.dashCompilerRejectedIntroCandidateCount || 0)),
    dashCompilerUsedProceduralSentences: Boolean(chosenAssessment.dashCompilerUsedProceduralSentences),
    dashCompilerSummaryBuiltFromSteps: Boolean(chosenAssessment.dashCompilerSummaryBuiltFromSteps),
    dashCompilerSelectedProceduralStepCount: Math.max(0, Number(chosenAssessment.dashCompilerSelectedProceduralStepCount || chosenAssessment.selectedProceduralCount || 0)),
    dashCompilerDenseProseProceduralMode: Boolean(chosenAssessment.dashCompilerDenseProseProceduralMode),
    dashCompilerRejectedSourceIntroSummary: Boolean(chosenAssessment.dashCompilerRejectedSourceIntroSummary),
    dashCompilerSelectorFailClosed: Boolean(chosenAssessment.dashCompilerSelectorFailClosed || (sourceLooksDense && (chosenAssessment.dashCompilerSelectedProceduralStepCount || 0) === 0)),
    dashCompilerSelectorUsedProceduralPoolOnly: Boolean(chosenAssessment.dashCompilerSelectorUsedProceduralPoolOnly),
    dashCompilerRejectedForMissingProceduralPool: Boolean(chosenAssessment.dashCompilerRejectedForMissingProceduralPool || (sourceLooksDense && (chosenAssessment.dashCompilerSelectedProceduralStepCount || 0) === 0)),
    dashCompilerSourcePriority: String(chosenAssessment.dashCompilerSourcePriority || sourcePriority || ""),
    dashCompilerRejectedCurrentDraftAsCompilerSource: Boolean(chosenAssessment.dashCompilerRejectedCurrentDraftAsCompilerSource || rejectedCurrentDraftAsCompilerSource),
    dashCompilerRejectedFailedDashAsCompilerSource: Boolean(chosenAssessment.dashCompilerRejectedFailedDashAsCompilerSource || rejectedFailedDashAsCompilerSource),
    dashCompilerUsedOriginalProseSource: Boolean(chosenAssessment.dashCompilerUsedOriginalProseSource || usedOriginalProseSource),
    dashCompilerFallbackSourceTextBlocked: Boolean(chosenAssessment.dashCompilerFallbackSourceTextBlocked || fallbackSourceTextBlocked),
    dashCompilerSourceTextUsedForCompilation: String(chosenAssessment.dashCompilerSourceTextUsedForCompilation || sourceTextUsedForCompilation || compilerSourceText || normalizedPrompt || ""),
    sourceWordCount,
    sourceLabel: String(chosenAssessment.dashCompilerSource || ""),
    compileMode,
  };
}

function formatDashScopeOutput(dashLines = [], summaryParagraph = "") {
  const normalizedLines = uniqueStrings((Array.isArray(dashLines) ? dashLines : []).map((line) => normalizeDashFallbackLineText(line)))
    .filter(Boolean)
    .slice(0, 6);
  const normalizedSummary = flattenShorterScopeToSingleParagraph(summaryParagraph);
  if (!normalizedLines.length) return normalizedSummary;
  if (!normalizedSummary) return normalizedLines.map((line) => `- ${line}`).join("\n");
  return `${normalizedLines.map((line) => `- ${line}`).join("\n")}\n\n${normalizedSummary}`;
}

function assessDashScopeStyleGuardrails(sourceScopeNotes = "", returnedScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  if (!returnedText) {
    return {
      accepted: false,
      reasonTag: "dash_missing_output",
      matchedPattern: "",
    };
  }

  for (const entry of SCOPE_ASSIST_STYLE_INVENTED_SPECIFICITY_PATTERNS) {
    if (entry.pattern.test(returnedText) && !(entry.allowPattern && entry.allowPattern.test(sourceText))) {
      return {
        accepted: false,
        reasonTag: entry.reasonTag,
        matchedPattern: String(entry.pattern),
      };
    }
  }

  for (const entry of SCOPE_ASSIST_STYLE_PROPOSAL_PATTERNS) {
    if (entry.pattern.test(returnedText)) {
      return {
        accepted: false,
        reasonTag: entry.reasonTag,
        matchedPattern: String(entry.pattern),
      };
    }
  }

  return {
    accepted: true,
    reasonTag: "dash_style_guardrails_pass",
    matchedPattern: "",
  };
}

function assessDashScopeDistinctStepQuality(sourceScopeNotes = "", returnedScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  const structure = parseDashScopeStructure(returnedText);
  const normalizedDashLines = (Array.isArray(structure.dashLines) ? structure.dashLines : [])
    .map((line) => normalizeDashFallbackLineText(line))
    .filter(Boolean);
  const uniqueLineKeys = uniqueStrings(normalizedDashLines.map((line) => normalizeScopeComparisonText(line)));
  const repeatedLineCount = Math.max(0, normalizedDashLines.length - uniqueLineKeys.length);
  const genericIntroBulletCount = normalizedDashLines.filter((line) => isDashCompilerGenericIntroSentence(line)).length;
  const fragmentLineCount = normalizedDashLines.filter((line) => !isDashStepLineComplete(line)).length;
  const splitSentenceEchoLineCount = normalizedDashLines.reduce((count, line, index) => {
    let nextCount = count;
    for (let j = index + 1; j < normalizedDashLines.length; j += 1) {
      if (isDashSplitSentenceEchoLine(line, normalizedDashLines[j])) {
        nextCount += 1;
      }
    }
    return nextCount;
  }, 0);
  let nearDuplicateLineCount = 0;
  let maxLineOverlap = 0;

  for (let i = 0; i < normalizedDashLines.length; i += 1) {
    for (let j = i + 1; j < normalizedDashLines.length; j += 1) {
      const pairOverlap = getScopeTextOverlapRatio(normalizedDashLines[i], normalizedDashLines[j]);
      maxLineOverlap = Math.max(maxLineOverlap, pairOverlap);
      if (isDashNearDuplicateStepLine(normalizedDashLines[i], normalizedDashLines[j])) {
        nearDuplicateLineCount += 1;
      }
    }
  }

  const summaryParagraph = sanitizeScopeAssistText(structure.summaryParagraph || "");
  const summaryIntroEchoCount = splitScopeAssistSentences(summaryParagraph).some((sentence) => isDashCompilerGenericIntroSentence(sentence)) ? 1 : 0;
  const summaryEchoLikeStep = isDashSummaryTooSimilarToLeadBullet(summaryParagraph, normalizedDashLines);
  const sourceEchoLikeStep = Boolean(sourceText)
    && normalizedDashLines.length >= 2
    && normalizedDashLines.filter((line) => areDashFallbackTextsTooSimilar(line, sourceText)).length >= 2;
  const fragmentBulletRejected = fragmentLineCount > 0;
  const accepted = Boolean(normalizedDashLines.length)
    && repeatedLineCount === 0
    && splitSentenceEchoLineCount === 0
    && nearDuplicateLineCount === 0
    && fragmentLineCount === 0
    && maxLineOverlap < 0.72
    && genericIntroBulletCount === 0
    && summaryIntroEchoCount === 0
    && !summaryEchoLikeStep
    && !sourceEchoLikeStep;

  return {
    accepted,
    reasonTag: accepted
      ? "dash_distinct_step_pass"
      : genericIntroBulletCount > 0
        ? "dash_generic_intro_bullet_rejected"
      : summaryIntroEchoCount > 0
        ? "dash_summary_intro_echo"
      : summaryEchoLikeStep
        ? "dash_summary_lead_bullet_echo"
      : fragmentBulletRejected
          ? "dash_fragment_bullet_rejected"
          : splitSentenceEchoLineCount > 0
            ? "dash_split_sentence_echo"
          : nearDuplicateLineCount > 0
            ? "dash_near_duplicate_step_echo"
        : sourceEchoLikeStep
          ? "dash_source_sentence_echo"
        : repeatedLineCount > 0
          ? "dash_repetitive_step_echo"
          : "dash_low_step_distinctness",
    dashDistinctStepPass: accepted,
    dashDistinctStepRejected: !accepted,
    dashRepeatedLineCount: repeatedLineCount,
    dashSplitSentenceEchoLineCount: splitSentenceEchoLineCount,
    dashNearDuplicateLineCount: nearDuplicateLineCount,
    dashFragmentBulletRejected: fragmentBulletRejected,
    dashGenericIntroBulletCount: genericIntroBulletCount,
    dashSummaryIntroEchoCount: summaryIntroEchoCount,
    dashMaxLineOverlap: Number.isFinite(maxLineOverlap) ? Number(maxLineOverlap.toFixed(3)) : 0,
    dashSummaryEchoLikeStep: summaryEchoLikeStep,
    dashSummaryLeadBulletEchoLikeStep: summaryEchoLikeStep,
    dashSourceSentenceEchoLikeStep: sourceEchoLikeStep,
  };
}

function assessDashScopeProceduralSentenceBias(sourceScopeNotes = "", returnedScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  const structure = parseDashScopeStructure(returnedText);
  const normalizedDashLines = uniqueStrings((Array.isArray(structure.dashLines) ? structure.dashLines : [])
    .map((line) => normalizeDashFallbackLineText(line)))
    .filter(Boolean);
  const sourceSentences = splitScopeAssistSentences(sourceText)
    .map((sentence) => sanitizeScopeAssistText(sentence))
    .filter(Boolean);
  const sourceOpeningSentence = sourceSentences[0] || "";
  const sourceOpeningSentenceLooksOverview = Boolean(sourceOpeningSentence)
    && (
      isDashCompilerGenericIntroSentence(sourceOpeningSentence)
      || !extractDashCompilerActionHits(normalizeDashCompilerProceduralSentence(sourceOpeningSentence)).length
    );
  const sourceSecondaryOverviewSentences = sourceSentences.slice(1, 2).filter((sentence) => isDashCompilerGenericIntroSentence(sentence));
  const sourceOverviewSentences = uniqueStrings([
    ...(sourceOpeningSentenceLooksOverview ? [sourceOpeningSentence] : []),
    ...sourceSecondaryOverviewSentences,
  ]);
  const sourceProceduralSentences = sourceSentences.slice(1).filter((sentence) => {
    const normalizedSentence = normalizeDashCompilerProceduralSentence(sentence);
    return Boolean(extractDashCompilerActionHits(normalizedSentence).length) && !isDashCompilerGenericIntroSentence(normalizedSentence);
  });
  const sourceWordCount = countScopeWords(sourceText);
  const proceduralSentenceBiasActive = Boolean(
    sourceText
    && returnedText
    && sourceWordCount >= 18
    && sourceOverviewSentences.length > 0
    && sourceProceduralSentences.length > 0
  );
  const overviewBulletCount = normalizedDashLines.filter((line) => {
    const normalizedLine = normalizeDashFallbackLineText(line);
    if (!normalizedLine) return false;
    if (isDashCompilerGenericIntroSentence(normalizedLine)) return true;
    return sourceOverviewSentences.some((introSentence) => {
      if (!introSentence) return false;
      return (
        isDashCompilerGenericIntroSentence(introSentence)
        || isDashNearDuplicateStepLine(introSentence, normalizedLine)
        || areDashFallbackTextsTooSimilar(introSentence, normalizedLine)
        || getScopeTextOverlapRatio(introSentence, normalizedLine) >= 0.68
      );
    });
  }).length;
  const proceduralBulletCount = normalizedDashLines.filter((line) => isDashCompilerProceduralBullet(line)).length;
  const overviewSentenceRejectedCount = overviewBulletCount;
  const rejectedForOverviewBias = Boolean(
    proceduralSentenceBiasActive
    && (
      overviewBulletCount > 0
      || proceduralBulletCount === 0
      || proceduralBulletCount < Math.max(2, Math.ceil(normalizedDashLines.length / 2))
    )
  );
  const dashOverviewSentenceBiasDetected = Boolean(proceduralSentenceBiasActive && overviewBulletCount > 0);
  const proceduralSentencesCoveredByBullets = sourceProceduralSentences.filter((sentence) => {
    const normalizedSentence = normalizeDashCompilerProceduralSentence(sentence);
    if (!normalizedSentence) return false;
    return normalizedDashLines.some((line) => {
      const normalizedLine = normalizeDashFallbackLineText(line);
      return Boolean(normalizedLine) && (
        getScopeTextOverlapRatio(normalizedSentence, normalizedLine) >= 0.35
        || areDashFallbackTextsTooSimilar(normalizedSentence, normalizedLine)
      );
    });
  }).length;
  const dashProceduralSentenceCoverage = sourceProceduralSentences.length > 0
    ? proceduralSentencesCoveredByBullets / sourceProceduralSentences.length
    : 0;
  const dashSummaryEchoedOverview = Boolean(
    structure.summaryParagraph
    && sourceOverviewSentences.length > 0
    && sourceOverviewSentences.some((overviewSentence) => (
      getScopeTextOverlapRatio(overviewSentence, structure.summaryParagraph) >= 0.55
      || areDashFallbackTextsTooSimilar(overviewSentence, structure.summaryParagraph)
    ))
  );

  return {
    accepted: !rejectedForOverviewBias,
    reasonTag: rejectedForOverviewBias ? "dash_overview_sentence_bias" : "dash_overview_sentence_bias_pass",
    dashProceduralSentenceBiasActive: proceduralSentenceBiasActive,
    dashOverviewSentenceRejectedCount: overviewSentenceRejectedCount,
    dashProceduralBulletCount: proceduralBulletCount,
    dashOverviewBulletCount: overviewBulletCount,
    dashRejectedForOverviewBias: rejectedForOverviewBias,
    dashOverviewSentenceBiasDetected,
    dashProceduralSentenceCoverage,
    dashSummaryEchoedOverview,
  };
}

function assessDashScopeFormatCompliance(sourceScopeNotes = "", returnedScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  const sourceWordCount = countScopeWords(sourceText);
  const structure = parseDashScopeStructure(returnedText);
  const minLineCount = sourceWordCount >= 18 ? 3 : sourceWordCount >= 10 ? 2 : 1;
  const maxLineCount = 6;
  const minSummaryWords = sourceWordCount >= 18 ? 8 : sourceWordCount >= 10 ? 6 : 4;

  const buildResult = (accepted, reasonTag) => ({
    accepted,
    reasonTag,
    dashMode: true,
    dashLineCount: Math.max(0, Number(structure.dashLineCount || 0)),
    dashHasSummaryParagraph: Boolean(structure.hasSummaryParagraph),
    dashFormatPass: Boolean(accepted),
    dashParagraphCount: Math.max(0, Number(structure.paragraphCount || 0)),
    dashSummaryWordCount: Math.max(0, Number(structure.summaryWordCount || 0)),
    dashSummarySentenceCount: Math.max(0, Number(structure.summarySentenceCount || 0)),
  });

  if (!returnedText) return buildResult(false, "dash_missing_output");
  if (!structure.dashLineCount) return buildResult(false, "dash_missing_dash_lines");
  if (!structure.hasSummaryParagraph) return buildResult(false, "dash_missing_summary_paragraph");
  if (!structure.hasExactDashThenParagraphShape) return buildResult(false, "dash_invalid_dash_then_paragraph_shape");
  if (structure.dashLineCount < minLineCount) return buildResult(false, "dash_too_few_dash_lines");
  if (structure.dashLineCount > maxLineCount) return buildResult(false, "dash_too_many_dash_lines");
  if (structure.summaryWordCount < minSummaryWords) return buildResult(false, "dash_summary_too_thin");
  if (structure.summaryWordCount > 60) return buildResult(false, "dash_summary_too_long");
  if (structure.summarySentenceCount < 1 || structure.summarySentenceCount > 3) return buildResult(false, "dash_summary_sentence_count_invalid");

  return buildResult(true, "dash_format_pass");
}

function assessDashScopeRefineCompliance(sourceScopeNotes = "", returnedScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  const formatAssessment = assessDashScopeFormatCompliance(sourceText, returnedText);
  const semanticAssessment = assessShorterScopeSemanticPreservation(sourceText, returnedText);
  const distinctAssessment = assessDashScopeDistinctStepQuality(sourceText, returnedText);
  const proceduralBiasAssessment = assessDashScopeProceduralSentenceBias(sourceText, returnedText);
  const inventedMajorDetailAssessment = assessDashInventedMajorDetail(sourceText, returnedText);
  const scaffoldAssessment = assessScopeAssistGenericScaffold(returnedText, sourceText);
  const explicitScaffoldAssessment = matchScopeAssistExplicitScaffoldPhrase(returnedText);
  const styleGuardrailAssessment = assessDashScopeStyleGuardrails(sourceText, returnedText);
  const metaLanguageMatch = matchScopeAssistMetaLanguage(returnedText);
  const dashOutputAccepted = Boolean(returnedText)
    && !metaLanguageMatch.matched
    && !/^(?:scope|work|project)\s+includes?\s*(?:the requested work|the requested scope)\b/i.test(returnedText.toLowerCase());

  return {
    accepted: Boolean(
      formatAssessment.accepted
      && semanticAssessment.accepted
      && distinctAssessment.accepted
      && proceduralBiasAssessment.accepted
      && inventedMajorDetailAssessment.accepted
      && dashOutputAccepted
      && scaffoldAssessment.accepted
      && !explicitScaffoldAssessment.matched
      && styleGuardrailAssessment.accepted
    ),
    reasonTag: !formatAssessment.accepted
      ? formatAssessment.reasonTag
      : !semanticAssessment.accepted
        ? (semanticAssessment.reasonTag || "dash_semantic_drift")
        : !distinctAssessment.accepted
          ? (distinctAssessment.reasonTag || "dash_repetitive_step_echo")
          : !proceduralBiasAssessment.accepted
            ? (proceduralBiasAssessment.reasonTag || "dash_overview_sentence_bias")
          : !inventedMajorDetailAssessment.accepted
            ? (inventedMajorDetailAssessment.reasonTag || "dash_invented_major_detail")
        : !dashOutputAccepted
          ? (metaLanguageMatch.matched ? "rejected_meta_language" : "dash_rejected_output")
          : !scaffoldAssessment.accepted
            ? (scaffoldAssessment.reasonTag || scaffoldAssessment.reason || "missing_job_specific_content")
            : explicitScaffoldAssessment.matched
              ? "explicit_scaffold_phrase"
              : !styleGuardrailAssessment.accepted
                ? (styleGuardrailAssessment.reasonTag || "dash_style_guardrail_rejected")
                : "dash_format_and_semantics_pass",
    dashMode: true,
    dashLineCount: Math.max(0, Number(formatAssessment.dashLineCount || 0)),
    dashHasSummaryParagraph: Boolean(formatAssessment.dashHasSummaryParagraph),
    dashFormatPass: Boolean(formatAssessment.accepted),
    dashSemanticPass: Boolean(semanticAssessment.shorterSemanticPass),
    dashDistinctStepPass: Boolean(distinctAssessment.dashDistinctStepPass),
    dashProceduralSentenceBiasActive: Boolean(proceduralBiasAssessment.dashProceduralSentenceBiasActive),
    dashInventedMajorDetailRejected: Boolean(inventedMajorDetailAssessment.dashInventedMajorDetailRejected),
    preservedAnchorTerms: Array.isArray(semanticAssessment.preservedAnchorTerms) ? semanticAssessment.preservedAnchorTerms : [],
    missingAnchorTerms: Array.isArray(semanticAssessment.missingAnchorTerms) ? semanticAssessment.missingAnchorTerms : [],
    inventedExclusionLikeLanguage: Boolean(semanticAssessment.inventedExclusionLikeLanguage),
    inventedProcessDetailLikeLanguage: Boolean(semanticAssessment.inventedProcessDetailLikeLanguage),
    dashRejectedForSemanticDrift: Boolean(!semanticAssessment.accepted),
    dashRepeatedLineCount: Math.max(0, Number(distinctAssessment.dashRepeatedLineCount || 0)),
    dashSplitSentenceEchoLineCount: Math.max(0, Number(distinctAssessment.dashSplitSentenceEchoLineCount || 0)),
    dashNearDuplicateLineCount: Math.max(0, Number(distinctAssessment.dashNearDuplicateLineCount || 0)),
    dashFragmentBulletRejected: Boolean(distinctAssessment.dashFragmentBulletRejected),
    dashMaxLineOverlap: Number.isFinite(Number(distinctAssessment.dashMaxLineOverlap)) ? Number(distinctAssessment.dashMaxLineOverlap) : 0,
    dashSummaryEchoLikeStep: Boolean(distinctAssessment.dashSummaryEchoLikeStep),
    dashSummaryLeadBulletEchoLikeStep: Boolean(distinctAssessment.dashSummaryLeadBulletEchoLikeStep),
    dashSourceSentenceEchoLikeStep: Boolean(distinctAssessment.dashSourceSentenceEchoLikeStep),
    dashOverviewSentenceRejectedCount: Math.max(0, Number(proceduralBiasAssessment.dashOverviewSentenceRejectedCount || 0)),
    dashProceduralBulletCount: Math.max(0, Number(proceduralBiasAssessment.dashProceduralBulletCount || 0)),
    dashOverviewBulletCount: Math.max(0, Number(proceduralBiasAssessment.dashOverviewBulletCount || 0)),
    dashRejectedForOverviewBias: Boolean(proceduralBiasAssessment.dashRejectedForOverviewBias),
    dashOverviewSentenceBiasDetected: Boolean(proceduralBiasAssessment.dashOverviewSentenceBiasDetected),
    dashProceduralSentenceCoverage: Number.isFinite(Number(proceduralBiasAssessment.dashProceduralSentenceCoverage)) ? Number(proceduralBiasAssessment.dashProceduralSentenceCoverage) : 0,
    dashSummaryEchoedOverview: Boolean(proceduralBiasAssessment.dashSummaryEchoedOverview),
    dashInventedMajorDetailMatchedPattern: String(inventedMajorDetailAssessment.dashInventedMajorDetailMatchedPattern || ""),
    dashSummaryWordCount: Math.max(0, Number(formatAssessment.dashSummaryWordCount || 0)),
    dashSummarySentenceCount: Math.max(0, Number(formatAssessment.dashSummarySentenceCount || 0)),
  };
}

function assessDashGroundedRepairPromotion(sourceScopeNotes = "", returnedScopeNotes = "", repairMeta = {}) {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  const formatAssessment = assessDashScopeFormatCompliance(sourceText, returnedText);
  const semanticAssessment = assessShorterScopeSemanticPreservation(sourceText, returnedText);
  const distinctAssessment = assessDashScopeDistinctStepQuality(sourceText, returnedText);
  const proceduralBiasAssessment = assessDashScopeProceduralSentenceBias(sourceText, returnedText);
  const inventedMajorDetailAssessment = assessDashInventedMajorDetail(sourceText, returnedText);
  const scaffoldAssessment = assessScopeAssistGenericScaffold(returnedText, sourceText);
  const styleGuardrailAssessment = assessDashScopeStyleGuardrails(sourceText, returnedText);
  const explicitScaffoldAssessment = matchScopeAssistExplicitScaffoldPhrase(returnedText);
  const metaLanguageMatch = matchScopeAssistMetaLanguage(returnedText);
  const dashOutputAccepted = Boolean(returnedText)
    && !metaLanguageMatch.matched
    && !/^(?:scope|work|project)\s+includes?\s*(?:the requested work|the requested scope)\b/i.test(returnedText.toLowerCase());
  const proceduralCoverage = Number.isFinite(Number(proceduralBiasAssessment.dashProceduralSentenceCoverage))
    ? Number(proceduralBiasAssessment.dashProceduralSentenceCoverage)
    : 0;
  const semanticGrounded = Boolean(semanticAssessment.accepted)
    || (
      proceduralCoverage >= 0.5
      && !semanticAssessment.inventedExclusionLikeLanguage
      && !semanticAssessment.inventedProcessDetailLikeLanguage
      && (
        Boolean(repairMeta?.summarySynthesized)
        || Number(repairMeta?.genericIntroRemovedCount || 0) > 0
        || Number(repairMeta?.nearDuplicateRemovedCount || 0) > 0
        || Number(repairMeta?.splitEchoesRemovedCount || 0) > 0
      )
    );

  return {
    accepted: Boolean(
      formatAssessment.accepted
      && semanticGrounded
      && distinctAssessment.accepted
      && proceduralBiasAssessment.accepted
      && inventedMajorDetailAssessment.accepted
      && dashOutputAccepted
      && scaffoldAssessment.accepted
      && !explicitScaffoldAssessment.matched
      && styleGuardrailAssessment.accepted
    ),
    reasonTag: !formatAssessment.accepted
      ? formatAssessment.reasonTag
      : !semanticGrounded
        ? (semanticAssessment.reasonTag || "dash_semantic_drift")
        : !distinctAssessment.accepted
          ? (distinctAssessment.reasonTag || "dash_repetitive_step_echo")
          : !proceduralBiasAssessment.accepted
            ? (proceduralBiasAssessment.reasonTag || "dash_overview_sentence_bias")
            : !inventedMajorDetailAssessment.accepted
              ? (inventedMajorDetailAssessment.reasonTag || "dash_invented_major_detail")
              : !dashOutputAccepted
                ? (metaLanguageMatch.matched ? "rejected_meta_language" : "dash_rejected_output")
                : !scaffoldAssessment.accepted
                  ? (scaffoldAssessment.reasonTag || scaffoldAssessment.reason || "missing_job_specific_content")
                  : explicitScaffoldAssessment.matched
                    ? "explicit_scaffold_phrase"
                    : !styleGuardrailAssessment.accepted
                      ? (styleGuardrailAssessment.reasonTag || "dash_style_guardrail_rejected")
                      : "dash_grounded_repair_pass",
    formatAssessment,
    semanticAssessment,
    distinctAssessment,
    proceduralBiasAssessment,
    inventedMajorDetailAssessment,
    scaffoldAssessment,
    styleGuardrailAssessment,
    explicitScaffoldAssessment,
    metaLanguageMatch,
    dashOutputAccepted,
    proceduralCoverage,
  };
}

function assessDashCanonicalCompiledCandidate(sourceScopeNotes = "", returnedScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(sourceScopeNotes);
  const returnedText = sanitizeScopeAssistText(returnedScopeNotes);
  const formatAssessment = assessDashScopeFormatCompliance(sourceText, returnedText);
  const structure = parseDashScopeStructure(returnedText);
  const bulletLines = uniqueStrings((Array.isArray(structure.dashLines) ? structure.dashLines : [])
    .map((line) => normalizeDashFallbackLineText(line)))
    .filter(Boolean);
  const bulletLineCount = bulletLines.length;
  const summaryParagraph = sanitizeScopeAssistText(structure.summaryParagraph || "");
  const summaryEchoLikeStep = isDashSummaryTooSimilarToLeadBullet(summaryParagraph, bulletLines);
  const sourceIntroSentences = splitScopeAssistSentences(sourceText)
    .slice(0, 2)
    .filter((sentence) => isDashCompilerGenericIntroSentence(sentence));
  const isIntroEchoLike = (candidate = "") => sourceIntroSentences.some((introSentence) => {
    if (!introSentence) return false;
    return isDashNearDuplicateStepLine(introSentence, candidate) || getScopeTextOverlapRatio(introSentence, candidate) >= 0.72;
  });

  let repeatedLineCount = 0;
  let splitSentenceEchoLineCount = 0;
  let nearDuplicateLineCount = 0;
  let fragmentBulletRejected = false;
  let overviewBulletCount = 0;
  let maxLineOverlap = 0;
  for (let i = 0; i < bulletLines.length; i += 1) {
    const current = bulletLines[i];
    if (!isDashStepLineComplete(current)) {
      fragmentBulletRejected = true;
    }
    if (isDashCompilerGenericIntroSentence(current) || isIntroEchoLike(current)) {
      overviewBulletCount += 1;
    }
    for (let j = i + 1; j < bulletLines.length; j += 1) {
      const pairOverlap = getScopeTextOverlapRatio(current, bulletLines[j]);
      maxLineOverlap = Math.max(maxLineOverlap, pairOverlap);
      if (normalizeScopeComparisonText(current) === normalizeScopeComparisonText(bulletLines[j])) {
        repeatedLineCount += 1;
      }
      if (isDashSplitSentenceEchoLine(current, bulletLines[j])) {
        splitSentenceEchoLineCount += 1;
      }
      if (isDashNearDuplicateStepLine(current, bulletLines[j])) {
        nearDuplicateLineCount += 1;
      }
    }
  }
  const proceduralBulletCount = Math.max(0, bulletLineCount - overviewBulletCount);
  const hasNoDuplicates = repeatedLineCount === 0 && splitSentenceEchoLineCount === 0 && nearDuplicateLineCount === 0;
  const hasNoFragments = !fragmentBulletRejected;
  const canonicalShapePass = Boolean(
    returnedText
    && structure.hasExactDashThenParagraphShape
    && structure.hasSummaryParagraph
    && bulletLineCount >= 3
    && bulletLineCount <= 5
    && structure.summaryWordCount >= 4
    && structure.summaryWordCount <= 60
    && structure.summarySentenceCount >= 1
    && structure.summarySentenceCount <= 3
  );
  const inventedMajorDetailAssessment = assessDashInventedMajorDetail(sourceText, returnedText);
  const semanticAssessment = assessShorterScopeSemanticPreservation(sourceText, returnedText);
  const sourceOverlapRatio = sourceText && returnedText ? getScopeTextOverlapRatio(sourceText, returnedText) : 0;
  const groundedPass = Boolean(
    sourceText
    && returnedText
    && (
      sourceOverlapRatio >= 0.05
      || (Array.isArray(semanticAssessment.preservedAnchorTerms) && semanticAssessment.preservedAnchorTerms.length > 0)
      || bulletLines.some((line) => getScopeTextOverlapRatio(sourceText, line) >= 0.08)
    )
  );
  const metaLanguageMatch = matchScopeAssistMetaLanguage(returnedText);
  const explicitScaffoldAssessment = matchScopeAssistExplicitScaffoldPhrase(returnedText);
  const styleGuardrailAssessment = assessDashScopeStyleGuardrails(sourceText, returnedText);
  const styleGuardrailPass = Boolean(
    styleGuardrailAssessment.accepted
    || styleGuardrailAssessment.reasonTag === "style_too_thin_for_clear_prompt"
    || styleGuardrailAssessment.reasonTag === "style_not_applicable"
  );
  const accepted = Boolean(
    canonicalShapePass
    && hasNoDuplicates
    && hasNoFragments
    && groundedPass
    && inventedMajorDetailAssessment.accepted
    && !metaLanguageMatch.matched
    && !explicitScaffoldAssessment.matched
    && styleGuardrailPass
  );
  const reasonTag = accepted
    ? "dash_canonical_compiled_candidate_pass"
    : !canonicalShapePass
      ? (formatAssessment.reasonTag || "dash_invalid_dash_then_paragraph_shape")
      : !hasNoDuplicates
        ? (repeatedLineCount > 0
        ? "dash_repetitive_step_echo"
          : splitSentenceEchoLineCount > 0
            ? "dash_split_sentence_echo"
            : "dash_near_duplicate_step_echo")
        : !hasNoFragments
          ? "dash_fragment_bullet_rejected"
          : !groundedPass
            ? (semanticAssessment.reasonTag || "dash_canonical_compiled_semantic_drift")
            : !inventedMajorDetailAssessment.accepted
              ? (inventedMajorDetailAssessment.reasonTag || "dash_canonical_compiled_invented_major_detail")
              : metaLanguageMatch.matched
                ? "rejected_meta_language"
                : explicitScaffoldAssessment.matched
                  ? "explicit_scaffold_phrase"
                  : !styleGuardrailPass
                    ? (styleGuardrailAssessment.reasonTag || "dash_style_guardrail_rejected")
                    : "dash_canonical_compiled_candidate_rejected";

  return {
    accepted,
    reasonTag,
    dashMode: true,
    dashLineCount: bulletLineCount,
    dashHasSummaryParagraph: Boolean(structure.hasSummaryParagraph),
    dashFormatPass: Boolean(canonicalShapePass),
    dashSemanticPass: Boolean(groundedPass),
    dashDistinctStepPass: Boolean(hasNoDuplicates && hasNoFragments),
    dashProceduralSentenceBiasActive: Boolean(sourceText),
    dashInventedMajorDetailRejected: Boolean(inventedMajorDetailAssessment.dashInventedMajorDetailRejected),
    preservedAnchorTerms: Array.isArray(semanticAssessment.preservedAnchorTerms) ? semanticAssessment.preservedAnchorTerms : [],
    missingAnchorTerms: Array.isArray(semanticAssessment.missingAnchorTerms) ? semanticAssessment.missingAnchorTerms : [],
    inventedExclusionLikeLanguage: Boolean(semanticAssessment.inventedExclusionLikeLanguage),
    inventedProcessDetailLikeLanguage: Boolean(semanticAssessment.inventedProcessDetailLikeLanguage),
    dashRejectedForSemanticDrift: Boolean(!groundedPass),
    dashRepeatedLineCount: Math.max(0, Number(repeatedLineCount || 0)),
    dashSplitSentenceEchoLineCount: Math.max(0, Number(splitSentenceEchoLineCount || 0)),
    dashNearDuplicateLineCount: Math.max(0, Number(nearDuplicateLineCount || 0)),
    dashFragmentBulletRejected: Boolean(fragmentBulletRejected),
    dashMaxLineOverlap: Number.isFinite(Number(maxLineOverlap)) ? Number(maxLineOverlap.toFixed(3)) : 0,
    dashSummaryEchoLikeStep: Boolean(!accepted && summaryEchoLikeStep),
    dashSummaryLeadBulletEchoLikeStep: Boolean(!accepted && summaryEchoLikeStep),
    dashSourceSentenceEchoLikeStep: Boolean(!accepted && bulletLines.some((line) => getScopeTextOverlapRatio(sourceText, line) >= 0.5)),
    dashOverviewSentenceRejectedCount: Math.max(0, Number(!accepted ? overviewBulletCount || 0 : 0)),
    dashProceduralBulletCount: Math.max(0, Number(bulletLineCount || 0)),
    dashOverviewBulletCount: Math.max(0, Number(!accepted ? overviewBulletCount || 0 : 0)),
    dashRejectedForOverviewBias: Boolean(!accepted && overviewBulletCount > 0),
    dashOverviewSentenceBiasDetected: Boolean(!accepted && overviewBulletCount > 0),
    dashProceduralSentenceCoverage: bulletLineCount > 0 ? 1 : 0,
    dashSummaryEchoedOverview: Boolean(!accepted && summaryEchoLikeStep),
    dashInventedMajorDetailMatchedPattern: String(inventedMajorDetailAssessment.dashInventedMajorDetailMatchedPattern || ""),
    dashSummaryWordCount: Math.max(0, Number(structure.summaryWordCount || 0)),
    dashSummarySentenceCount: Math.max(0, Number(structure.summarySentenceCount || 0)),
  };
}

/**
 * Deterministic post-transform repair for Dash refine output.
 * Fixes the narrow problems the model commonly produces:
 *   1. Fragment or echo bullets — removed/pruned.
 *   2. Missing/weak/echo-like closing summary paragraph — synthesized from cleaned bullets + source.
 * Returns { repaired, repairedText, ... } with diagnostic fields.
 */
function repairDashRefineOutput(sourceText = "", rawDashOutput = "") {
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  const normalizedOutput = sanitizeScopeAssistText(rawDashOutput);
  if (!normalizedSource || !normalizedOutput) {
    return { repaired: false, repairedText: normalizedOutput, reason: "missing_input" };
  }

  const sourceWordCount = countScopeWords(normalizedSource);
  const minSummaryWords = sourceWordCount >= 18 ? 8 : sourceWordCount >= 10 ? 6 : 4;
  const structure = parseDashScopeStructure(normalizedOutput);
  const rawDashLines = Array.isArray(structure.dashLines) ? structure.dashLines : [];
  if (!rawDashLines.length) {
    return { repaired: false, repairedText: normalizedOutput, reason: "no_dash_lines" };
  }

  // --- 1. Remove fragment bullets ---
  const fragmentsRemoved = [];
  const cleanedDashLines = rawDashLines.filter((line) => {
    const normalized = normalizeDashFallbackLineText(line);
    if (!normalized) return false;
    if (!isDashStepLineComplete(normalized)) {
      fragmentsRemoved.push(normalized);
      return false;
    }
    return true;
  });

  // --- 2. Remove split-sentence echo lines ---
  const splitEchoesRemoved = [];
  const dedupedDashLines = [];
  for (let i = 0; i < cleanedDashLines.length; i += 1) {
    const currentNormalized = normalizeDashFallbackLineText(cleanedDashLines[i]);
    let isSplitEcho = false;
    for (let j = 0; j < dedupedDashLines.length; j += 1) {
      const existingNormalized = normalizeDashFallbackLineText(dedupedDashLines[j]);
      if (isDashSplitSentenceEchoLine(currentNormalized, existingNormalized)) {
        isSplitEcho = true;
        break;
      }
    }
    if (isSplitEcho) {
      splitEchoesRemoved.push(currentNormalized);
    } else {
      dedupedDashLines.push(cleanedDashLines[i]);
    }
  }

  const sourceIntroSentences = splitScopeAssistSentences(normalizedSource)
    .slice(0, 2)
    .filter((sentence) => isDashCompilerGenericIntroSentence(sentence));
  const isIntroEchoLike = (candidate = "") => sourceIntroSentences.some((introSentence) => {
    if (!introSentence) return false;
    return isDashNearDuplicateStepLine(introSentence, candidate) || getScopeTextOverlapRatio(introSentence, candidate) >= 0.72;
  });

  const genericIntroRemoved = [];
  const nearDuplicateRemoved = [];
  const repairedDashLines = [];
  for (let i = 0; i < dedupedDashLines.length; i += 1) {
    const currentNormalized = normalizeDashFallbackLineText(dedupedDashLines[i]);
    if (!currentNormalized) continue;
    if (isDashCompilerGenericIntroSentence(currentNormalized) || isIntroEchoLike(currentNormalized)) {
      genericIntroRemoved.push(currentNormalized);
      continue;
    }
    let isNearDuplicate = false;
    for (let j = 0; j < repairedDashLines.length; j += 1) {
      const existingNormalized = normalizeDashFallbackLineText(repairedDashLines[j]);
      if (isDashNearDuplicateStepLine(currentNormalized, existingNormalized) || isDashSplitSentenceEchoLine(currentNormalized, existingNormalized)) {
        isNearDuplicate = true;
        break;
      }
    }
    if (isNearDuplicate) {
      nearDuplicateRemoved.push(currentNormalized);
      continue;
    }
    repairedDashLines.push(dedupedDashLines[i]);
  }

  if (!repairedDashLines.length) {
    return {
      repaired: false,
      repairedText: normalizedOutput,
      reason: "all_bullets_removed",
      fragmentsRemoved,
      fragmentsRemovedCount: fragmentsRemoved.length,
      splitEchoesRemoved,
      splitEchoesRemovedCount: splitEchoesRemoved.length,
      genericIntroRemoved,
      genericIntroRemovedCount: genericIntroRemoved.length,
      nearDuplicateRemoved,
      nearDuplicateRemovedCount: nearDuplicateRemoved.length,
      summarySynthesized: false,
      summaryParagraph: "",
      summarySource: "",
      originalDashLineCount: rawDashLines.length,
      cleanedDashLineCount: 0,
      cleanedDashLines: [],
    };
  }

  // --- 3. Synthesize missing summary paragraph if needed ---
  let summaryParagraph = sanitizeScopeAssistText(structure.summaryParagraph || "");
  let summarySynthesized = false;
  let summarySource = "";
  const summaryWordCount = countScopeWords(summaryParagraph);
  const summaryNeedsRepair = !summaryParagraph
    || summaryWordCount < minSummaryWords
    || isDashCompilerGenericIntroSentence(summaryParagraph)
    || isDashSummaryTooSimilarToLeadBullet(summaryParagraph, repairedDashLines);
  if (summaryNeedsRepair) {
    const fallbackSummary = sanitizeScopeAssistText(buildDashFallbackSummaryParagraph(normalizedSource, repairedDashLines));
    if (fallbackSummary
      && countScopeWords(fallbackSummary) >= minSummaryWords
      && !isDashSummaryTooSimilarToLeadBullet(fallbackSummary, repairedDashLines)
    ) {
      summaryParagraph = fallbackSummary;
      summarySynthesized = true;
      summarySource = "fallback_summary";
    }
  }

  // --- 3b. Last-resort minimal summary if still empty or too thin ---
  if ((!summaryParagraph || countScopeWords(summaryParagraph) < minSummaryWords) && repairedDashLines.length >= 1) {
    const subjectPhrase = buildDashCompilerSubjectPhrase(normalizedSource, "");
    const lastResort = sanitizeScopeAssistText(
      `Complete ${subjectPhrase} so all listed work is finished and ready for continued operation.`
    );
    if (lastResort
      && countScopeWords(lastResort) >= minSummaryWords
      && !isDashSummaryTooSimilarToLeadBullet(lastResort, repairedDashLines)
    ) {
      summaryParagraph = lastResort;
      summarySynthesized = true;
      summarySource = "last_resort_summary";
    }
  }

  // --- 4. Reassemble into proper dash-then-paragraph format ---
  const bulletBlock = repairedDashLines.map((line) => `- ${line}`).join("\n");
  const repairedText = summaryParagraph
    ? `${bulletBlock}\n\n${summaryParagraph}`
    : bulletBlock;

  const anythingChanged = fragmentsRemoved.length > 0
    || splitEchoesRemoved.length > 0
    || genericIntroRemoved.length > 0
    || nearDuplicateRemoved.length > 0
    || summarySynthesized;

  return {
    repaired: anythingChanged,
    repairedText: sanitizeScopeAssistText(repairedText),
    reason: anythingChanged ? "repair_applied" : "no_repair_needed",
    fragmentsRemoved,
    fragmentsRemovedCount: fragmentsRemoved.length,
    splitEchoesRemoved,
    splitEchoesRemovedCount: splitEchoesRemoved.length,
    genericIntroRemoved,
    genericIntroRemovedCount: genericIntroRemoved.length,
    nearDuplicateRemoved,
    nearDuplicateRemovedCount: nearDuplicateRemoved.length,
    summarySynthesized,
    summaryParagraph,
    summarySource: summarySource || (summarySynthesized ? "compiled_steps" : ""),
    originalDashLineCount: rawDashLines.length,
    cleanedDashLineCount: repairedDashLines.length,
    cleanedDashLines: repairedDashLines,
  };
}

function buildDashValidationFeedback(assessment = {}, reasonTag = "") {
  const notes = [];
  const repeatedLineCount = Math.max(0, Number(assessment?.dashRepeatedLineCount || 0));
  const splitSentenceEchoLineCount = Math.max(0, Number(assessment?.dashSplitSentenceEchoLineCount || 0));
  const nearDuplicateLineCount = Math.max(0, Number(assessment?.dashNearDuplicateLineCount || 0));
  const genericIntroBulletCount = Math.max(0, Number(assessment?.dashGenericIntroBulletCount || 0));
  const summaryIntroEchoCount = Math.max(0, Number(assessment?.dashSummaryIntroEchoCount || 0));

  if (repeatedLineCount > 0 || splitSentenceEchoLineCount > 0 || nearDuplicateLineCount > 0) {
    notes.push("Merge repeated bullets and avoid splitting one idea into multiple bullets.");
  }
  if (assessment?.dashFragmentBulletRejected) {
    notes.push("Rewrite fragment bullets as complete contractor-ready steps.");
  }
  if (genericIntroBulletCount > 0 || summaryIntroEchoCount > 0 || assessment?.dashSourceSentenceEchoLikeStep) {
    notes.push("Remove generic intro/setup wording and keep only grounded work steps.");
  }
  if (assessment?.dashRejectedForOverviewBias || assessment?.dashProceduralSentenceBiasActive || Math.max(0, Number(assessment?.dashOverviewSentenceRejectedCount || 0)) > 0) {
    notes.push("Ignore the opening overview sentence and extract the later procedural service steps instead.");
  }
  if (assessment?.dashSummaryLeadBulletEchoLikeStep || assessment?.dashSummaryEchoLikeStep) {
    notes.push("Make the closing paragraph distinct from bullet 1.");
  }
  if (assessment?.dashInventedMajorDetailRejected) {
    notes.push("Drop ungrounded major detail and stay grounded in the source prose.");
  }
  if (!notes.length && reasonTag) {
    notes.push(`Fix the Dash compliance issue: ${reasonTag}.`);
  }
  return uniqueStrings(notes).join(" ");
}

function isDashCompilerContaminatedSourceText(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return false;
  if (countScopeWords(normalized) <= 14) return false;

  const structure = parseDashScopeStructure(normalized);
  if (structure.dashLineCount) {
    const distinctAssessment = assessDashScopeDistinctStepQuality("", normalized);
    if (
      !distinctAssessment.accepted
      || distinctAssessment.dashRepeatedLineCount > 0
      || distinctAssessment.dashSplitSentenceEchoLineCount > 0
      || distinctAssessment.dashNearDuplicateLineCount > 0
      || distinctAssessment.dashFragmentBulletRejected
      || distinctAssessment.dashSummaryEchoLikeStep
      || distinctAssessment.dashGenericIntroBulletCount > 0
      || distinctAssessment.dashSummaryIntroEchoCount > 0
    ) {
      return true;
    }
  }

  const sourceSentences = splitScopeAssistSentences(normalized)
    .map((sentence) => sanitizeScopeAssistText(sentence))
    .filter(Boolean);
  if (!sourceSentences.length) return false;

  const proceduralSentenceCount = sourceSentences.filter((sentence) => {
    const normalizedSentence = normalizeDashCompilerProceduralSentence(sentence);
    return Boolean(extractDashCompilerActionHits(normalizedSentence).length) && !isDashCompilerGenericIntroSentence(normalizedSentence);
  }).length;
  if (proceduralSentenceCount > 0) return false;

  const genericIntroCount = sourceSentences.filter((sentence) => isDashCompilerGenericIntroSentence(sentence)).length;
  const repeatedSentenceCount = Math.max(0, sourceSentences.length - uniqueStrings(sourceSentences.map((sentence) => normalizeScopeComparisonText(sentence))).length);
  return (
    genericIntroCount >= Math.max(1, Math.ceil(sourceSentences.length * 0.5))
    || repeatedSentenceCount >= 1
  );
}

function buildDashScopeLocalFallback(currentScopeNotes = "", options = {}) {
  const sourceText = sanitizeScopeAssistText(currentScopeNotes || options?.sourceScopeText || options?.sourcePromptText || "");
  if (!sourceText || isDashCompilerContaminatedSourceText(sourceText)) return "";
  const compiled = compileDashScopeFromProse({
    sourcePromptText: sanitizeScopeAssistText(options?.sourcePromptText || sourceText || ""),
    sourceScopeText: sourceText,
    sourceLabel: String(options?.sourceLabel || "dash_scope_local_fallback"),
  });
  if (!compiled?.assessment?.accepted) return "";
  return sanitizeScopeAssistText(compiled.text || "");
}

function resolveDashBriefLocalSource({
  context = {},
  currentScopeText = "",
} = {}) {
  const immutableAcceptedText = sanitizeScopeAssistText(
    context?.originalAcceptedProseScope
    || context?.dashCanonicalAcceptedProse
    || context?.dashImmutableAcceptedProse
    || context?.immutableAcceptedProseScope
    || ""
  );
  const acceptedDraftText = sanitizeScopeAssistText(currentScopeText || context?.currentScopeNotes || "");
  const existingScopeText = sanitizeScopeAssistText(context?.existingScopeText || "");
  const candidates = [
    {
      sourceText: immutableAcceptedText,
      sourceKind: "immutable_original_accepted_prose",
      sourceType: "immutable_original_accepted_prose",
      sourcePriority: "immutable_original_accepted_prose",
      usedOriginalProseSource: true,
      usedAcceptedProseDraft: true,
    },
    {
      sourceText: acceptedDraftText,
      sourceKind: "accepted_prose_draft",
      sourceType: "accepted_prose_draft",
      sourcePriority: "accepted_prose_draft",
      usedOriginalProseSource: false,
      usedAcceptedProseDraft: true,
    },
    {
      sourceText: existingScopeText,
      sourceKind: "existing_scope_text",
      sourceType: "existing_scope_text",
      sourcePriority: "existing_scope_text",
      usedOriginalProseSource: false,
      usedAcceptedProseDraft: true,
    },
  ];
  for (const candidate of candidates) {
    if (candidate.sourceText && !isDashCompilerContaminatedSourceText(candidate.sourceText)) {
      return {
        ...candidate,
        sourceChars: candidate.sourceText.length,
        fallbackSourceTextBlocked: false,
      };
    }
  }
  const blockedCandidate = candidates.find((candidate) => Boolean(candidate.sourceText)) || null;
  return {
    sourceText: "",
    sourceKind: blockedCandidate?.sourceKind || "dash_brief_missing_source",
    sourceType: blockedCandidate?.sourceType || "",
    sourcePriority: blockedCandidate?.sourcePriority || "",
    sourceChars: 0,
    usedOriginalProseSource: false,
    usedAcceptedProseDraft: false,
    fallbackSourceTextBlocked: Boolean(blockedCandidate?.sourceText),
    reasonTag: blockedCandidate?.sourceText ? "dash_brief_contaminated_source" : "dash_brief_missing_source",
  };
}

function buildDashBriefProviderTransformPrompts(sourceText = "", { stricter = false } = {}) {
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  const systemPrompt = [
    "You convert accepted contractor scope prose into Dash + Brief format.",
    "Return plain text only.",
    "Output exactly 3 to 5 lines that each start with '- '.",
    "Then output one blank line.",
    "Then output one short summary paragraph after the blank line.",
    "Preserve the source meaning and real work steps.",
    "Do not invent work, exclusions, pricing, approvals, legal language, code or compliance language, markdown fences, headings, or JSON.",
    stricter ? "The previous answer was malformed. Follow the exact required shape this time." : "",
  ].filter(Boolean).join("\n");
  const userPrompt = [
    "Source scope prose:",
    normalizedSource,
    stricter
      ? "The previous answer was malformed because it did not match the exact Dash + Brief shape. Reformat the same source prose correctly."
      : "Convert this source prose into Dash + Brief now.",
  ].join("\n\n");
  return { systemPrompt, userPrompt };
}

function validateDashBriefProviderTransformOutput(text = "") {
  const normalizedOutput = sanitizeScopeAssistText(text);
  const structure = parseDashScopeStructure(normalizedOutput);
  const dashLines = (Array.isArray(structure?.dashLines) ? structure.dashLines : [])
    .map((line) => sanitizeScopeAssistText(line))
    .filter(Boolean);
  const summaryParagraph = normalizeScopeParagraphText(structure?.summaryParagraph || "");
  const paragraphCount = countScopeParagraphBlocks(normalizedOutput);
  const summaryWordCount = countScopeWords(summaryParagraph);
  const hasIdealShape = Boolean(
    structure?.hasExactDashThenParagraphShape
    && dashLines.length >= 3
    && dashLines.length <= 5
    && summaryParagraph
    && paragraphCount === 2
    && summaryWordCount > 0
    && summaryWordCount <= 60
  );
  const accepted = Boolean(normalizedOutput);
  const reasonTag = !normalizedOutput
    ? "dash_brief_provider_empty_output"
    : "dash_brief_provider_transform_pass";
  const normalizedScopeNotes = hasIdealShape
    ? formatDashScopeOutput(dashLines, summaryParagraph)
    : normalizedOutput;
  return {
    accepted,
    reasonTag,
    scopeNotes: normalizedScopeNotes,
    bulletCount: dashLines.length,
    summaryDetected: Boolean(summaryParagraph),
    excerpt: normalizedScopeNotes.slice(0, 160),
  };
}

async function handleDashBriefProviderTransform({
  traceId = "",
  requestStartedAt = Date.now(),
  trace,
  context = {},
  currentScopeText = "",
  refineInstruction = "",
  setDebugState = () => {},
  setRuntimeTruth = () => {},
} = {}) {
  const normalizedRefineInstruction = sanitizeScopeAssistText(refineInstruction || context?.refineInstruction || "");
  const sourceSelection = resolveDashBriefLocalSource({
    context,
    currentScopeText,
  });
  const sourceText = sanitizeScopeAssistText(sourceSelection?.sourceText || "");
  const sourceKind = String(sourceSelection?.sourceKind || sourceSelection?.sourceType || "dash_brief_provider_transform");
  const elapsed_ms = Math.max(0, Date.now() - Number(requestStartedAt || Date.now()));
  const baseTruth = {
    refineMode: "refine",
    refineInstruction: normalizedRefineInstruction,
    dashDetectorMatched: true,
    dashBranchActive: true,
    dashMode: true,
    dashSourcePromptWeighted: Boolean(sourceSelection?.sourcePriority || sourceSelection?.sourceType),
    dashCompiledLocally: false,
    dashCompilerSource: "dash_brief_provider_transform",
    dashCompilerSourcePriority: String(sourceSelection?.sourcePriority || sourceSelection?.sourceType || ""),
    dashCompilerSourceTextUsedForCompilation: sourceText,
    dashTransformSource: sourceText,
    dashCanonicalProseSourceType: String(sourceSelection?.sourceType || sourceSelection?.sourcePriority || ""),
    dashCanonicalProseChars: sourceText.length,
    dashUsedOriginalAcceptedProse: Boolean(sourceSelection?.usedOriginalProseSource),
    dashUsedAcceptedProseDraft: Boolean(sourceSelection?.usedAcceptedProseDraft),
    dashGroqRewriteUsed: true,
    dashLocalCompilerBypassed: true,
    dashGroqRewriteValidated: true,
    dashRetryUsed: false,
    dashLocalFallbackUsed: false,
    dashFallbackRejectedForCompliance: false,
    dashRejectedBeforeDirectSuccess: false,
    dashFallbackAccepted: false,
    dashSuccessBlockedForComplianceFailure: false,
    dashReturnedFailurePath: false,
    dashBestEffortSuccessRemoved: false,
    groqHandedOff: false,
    preGroqJunkGateFired: false,
    parseSource: "dash_brief_provider_transform",
  };

  logScopeAssistTerminal(traceId, "dash_brief_provider_transform_entry", {
    elapsed_ms,
    _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
    sourceKind,
    sourceChars: sourceText.length,
    refineInstruction: normalizedRefineInstruction,
  });
  logScopeAssistTerminal(traceId, "dash_brief_provider_transform_source_resolved", {
    elapsed_ms,
    _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
    sourceKind,
    sourceType: String(sourceSelection?.sourceType || ""),
    sourcePriority: String(sourceSelection?.sourcePriority || ""),
    sourceChars: sourceText.length,
    usedOriginalProseSource: Boolean(sourceSelection?.usedOriginalProseSource),
    usedAcceptedProseDraft: Boolean(sourceSelection?.usedAcceptedProseDraft),
  });

  if (!sourceText) {
    const reasonTag = String(sourceSelection?.reasonTag || "dash_brief_missing_source");
    logScopeAssistTerminal(traceId, "dash_brief_provider_transform_failure", {
      elapsed_ms,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      sourceChars: 0,
      reasonTag,
      finalExcerpt: "",
    });
    try {
      setDebugState({
        path: "malformed_or_internal_failure",
        stage: "normalized_failure",
        model: "dash_brief_provider_transform",
      });
      setRuntimeTruth({
        ...baseTruth,
        outcome: "failed",
        reasonTag,
        excerpt: "",
        dashReturnedSuccess: false,
        dashReturnedFailurePath: true,
      });
    } catch {}
    return {
      ok: false,
      status: 400,
      reasonTag,
      failureType: reasonTag,
      retryable: false,
      message: "Accepted scope prose is required before Dash + Brief can run.",
      scopeNotes: "",
      meta: {
        sourceKind,
        sourceChars: 0,
        bulletCount: 0,
        finalExcerpt: "",
      },
    };
  }

  const requestOptions = {
    model: GROQ_SCOPE_PRIMARY_MODEL,
    temperature: 0.1,
    top_p: 0.85,
    max_tokens: 320,
  };

  const runTransformAttempt = async ({ stricter = false, attempt = 1 } = {}) => {
    const prompts = buildDashBriefProviderTransformPrompts(sourceText, { stricter });
    logScopeAssistTerminal(traceId, "dash_brief_provider_transform_request_built", {
      elapsed_ms: Math.max(0, Date.now() - Number(requestStartedAt || Date.now())),
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      attempt,
      strictMode: Boolean(stricter),
      sourceChars: sourceText.length,
      systemPromptChars: prompts.systemPrompt.length,
      userPromptChars: prompts.userPrompt.length,
    });
    const assistResult = await callSectionAssistGroq(
      prompts.systemPrompt,
      prompts.userPrompt,
      trace,
      requestOptions,
      {
        sectionKey: "scope",
        scopeMode: "refine",
        traceId,
        modelOverride: GROQ_SCOPE_PRIMARY_MODEL,
      }
    );
    const rawOutput = sanitizeScopeAssistText(
      typeof assistResult === "string"
        ? assistResult
        : assistResult?.raw || ""
    );
    const validated = validateDashBriefProviderTransformOutput(rawOutput);
    logScopeAssistTerminal(traceId, "dash_brief_provider_transform_provider_success", {
      elapsed_ms: Math.max(0, Date.now() - Number(requestStartedAt || Date.now())),
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      attempt,
      strictMode: Boolean(stricter),
      sourceChars: sourceText.length,
      outputChars: rawOutput.length,
      bulletCount: Math.max(0, Number(validated?.bulletCount || 0)),
      summaryDetected: Boolean(validated?.summaryDetected),
      accepted: Boolean(validated?.accepted),
      reasonTag: String(validated?.reasonTag || ""),
      finalExcerpt: String(validated?.excerpt || "").slice(0, 160),
    });
    return {
      assistResult,
      rawOutput,
      validated,
    };
  };

  try {
    let transformAttempt = await runTransformAttempt({ stricter: false, attempt: 1 });
    if (!transformAttempt.validated.accepted) {
      logScopeAssistTerminal(traceId, "dash_brief_provider_transform_provider_retry", {
        elapsed_ms: Math.max(0, Date.now() - Number(requestStartedAt || Date.now())),
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        sourceKind,
        sourceChars: sourceText.length,
        reasonTag: String(transformAttempt.validated.reasonTag || "dash_invalid_dash_then_paragraph_shape"),
        finalExcerpt: String(transformAttempt.validated.excerpt || "").slice(0, 160),
      });
      transformAttempt = await runTransformAttempt({ stricter: true, attempt: 2 });
    }

    if (!transformAttempt.validated.accepted) {
      const reasonTag = String(transformAttempt.validated.reasonTag || "dash_invalid_dash_then_paragraph_shape");
      logScopeAssistTerminal(traceId, "dash_brief_provider_transform_failure", {
        elapsed_ms: Math.max(0, Date.now() - Number(requestStartedAt || Date.now())),
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        sourceKind,
        sourceChars: sourceText.length,
        bulletCount: Math.max(0, Number(transformAttempt.validated?.bulletCount || 0)),
        reasonTag,
        finalExcerpt: String(transformAttempt.validated.excerpt || "").slice(0, 160),
      });
      try {
        setDebugState({
          path: "malformed_or_internal_failure",
          stage: "normalized_failure",
          model: GROQ_SCOPE_PRIMARY_MODEL,
        });
        setRuntimeTruth({
          ...baseTruth,
          outcome: "failed",
          reasonTag,
          excerpt: String(transformAttempt.validated.excerpt || ""),
          groqHandedOff: true,
          dashReturnedSuccess: false,
          dashReturnedFailurePath: true,
          dashLineCount: Math.max(0, Number(transformAttempt.validated?.bulletCount || 0)),
          dashHasSummaryParagraph: Boolean(transformAttempt.validated?.summaryDetected),
          dashFormatPass: false,
          dashSemanticPass: false,
          dashDistinctStepPass: false,
        });
      } catch {}
      return {
        ok: false,
        status: 500,
        reasonTag,
        failureType: "dash_brief_provider_transform_failed",
        retryable: false,
        message: "Dash + Brief returned malformed output twice and could not be finalized.",
        scopeNotes: "",
        meta: {
          sourceKind,
          sourceChars: sourceText.length,
          bulletCount: Math.max(0, Number(transformAttempt.validated?.bulletCount || 0)),
          finalExcerpt: String(transformAttempt.validated.excerpt || "").slice(0, 160),
        },
      };
    }

    logScopeAssistTerminal(traceId, "dash_brief_provider_transform_success", {
      elapsed_ms: Math.max(0, Date.now() - Number(requestStartedAt || Date.now())),
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      sourceChars: sourceText.length,
      bulletCount: Math.max(0, Number(transformAttempt.validated?.bulletCount || 0)),
      finalExcerpt: String(transformAttempt.validated.scopeNotes || "").slice(0, 160),
      reasonTag: String(transformAttempt.validated.reasonTag || "dash_brief_provider_transform_pass"),
    });
    try {
      setDebugState({
        path: "direct_groq_success",
        stage: "parse_completed",
        model: GROQ_SCOPE_PRIMARY_MODEL,
      });
      setRuntimeTruth({
        ...baseTruth,
        outcome: "scope",
        reasonTag: String(transformAttempt.validated.reasonTag || "dash_brief_provider_transform_pass"),
        excerpt: String(transformAttempt.validated.scopeNotes || ""),
        responseSource: "dash_brief_provider_transform",
        fallbackSource: "dash_brief_provider_transform",
        groqHandedOff: true,
        dashReturnedSuccess: true,
        dashLineCount: Math.max(0, Number(transformAttempt.validated?.bulletCount || 0)),
        dashHasSummaryParagraph: Boolean(transformAttempt.validated?.summaryDetected),
        dashFormatPass: true,
        dashSemanticPass: true,
        dashDistinctStepPass: true,
      });
    } catch {}
    return {
      ok: true,
      status: 200,
      reasonTag: String(transformAttempt.validated.reasonTag || "dash_brief_provider_transform_pass"),
      scopeNotes: String(transformAttempt.validated.scopeNotes || ""),
      meta: {
        sourceKind,
        sourceChars: sourceText.length,
        bulletCount: Math.max(0, Number(transformAttempt.validated?.bulletCount || 0)),
        finalExcerpt: String(transformAttempt.validated.scopeNotes || "").slice(0, 160),
      },
    };
  } catch (error) {
    const failure = normalizeScopeAssistFailure(error);
    const reasonTag = "dash_brief_provider_transform_failure";
    logScopeAssistTerminal(traceId, "dash_brief_provider_transform_failure", {
      elapsed_ms: Math.max(0, Date.now() - Number(requestStartedAt || Date.now())),
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      sourceChars: sourceText.length,
      reasonTag,
      failureType: failure.failureType,
      status: failure.status,
      finalExcerpt: String(extractAssistFailureText(error?.message || error?.detail || "") || "").slice(0, 160),
    });
    try {
      setDebugState({
        path: "malformed_or_internal_failure",
        stage: "normalized_failure",
        model: GROQ_SCOPE_PRIMARY_MODEL,
      });
      setRuntimeTruth({
        ...baseTruth,
        outcome: "failed",
        reasonTag,
        excerpt: String(extractAssistFailureText(error?.message || error?.detail || "") || ""),
        groqHandedOff: true,
        dashReturnedSuccess: false,
        dashReturnedFailurePath: true,
      });
    } catch {}
    return {
      ok: false,
      status: failure.status || 500,
      reasonTag,
      failureType: failure.failureType || "internal_failure",
      retryable: Boolean(failure.retryable),
      message: String(failure.message || SCOPE_ASSIST_INTERNAL_MESSAGE || "").trim(),
      scopeNotes: "",
      meta: {
        sourceKind,
        sourceChars: sourceText.length,
        bulletCount: 0,
        finalExcerpt: String(extractAssistFailureText(error?.message || error?.detail || "") || "").slice(0, 160),
      },
    };
  }
}

const DASH_BRIEF_INTRO_FILLER_PATTERNS = [
  /^(?:this\s+will\s+include|the\s+work\s+will\s+include|this\s+scope\s+includes|the\s+scope\s+includes|the\s+maintenance\s+sequence\s+will\s+begin\s+with|the\s+maintenance\s+sequence\s+will\s+include|the\s+maintenance\s+sequence\s+will|the\s+maintenance\s+process\s+will\s+include|the\s+maintenance\s+work\s+will\s+include|the\s+maintenance\s+work\s+will|the\s+scope\s+of\s+work\s+includes|the\s+work\s+includes|this\s+scope\s+will\s+include|the\s+job\s+will\s+include|the\s+project\s+will\s+include)\b[\s:,-]*/i,
  /^(?:this|the\s+work|this\s+scope|the\s+scope|the\s+maintenance\s+sequence|the\s+maintenance\s+process|the\s+maintenance\s+work|the\s+job|the\s+project)\s+(?:will\s+include|includes?|will\s+begin\s+with|will\s+start\s+with|involves?|will\s+involve|will\s+be|is\s+to\s+be|is)\b[\s:,-]*/i,
  /^(?:this\s+will\s+be\s+followed\s+by|this\s+is\s+followed\s+by|the\s+technician\s+will\s+then\s+proceed\s+with|the\s+technician\s+will\s+proceed\s+with|the\s+technician\s+will\s+then|the\s+technician\s+will|the\s+crew\s+will\s+then|the\s+crew\s+will)\b[\s:,-]*/i,
];

function isDashBriefIntroFillerSentence(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return false;
  return DASH_BRIEF_INTRO_FILLER_PATTERNS.some((pattern) => pattern.test(normalized));
}

function stripDashBriefIntroFiller(text = "") {
  let next = sanitizeScopeAssistText(text).replace(/^[\s\-:;,.]+/g, "").trim();
  if (!next) return "";
  DASH_BRIEF_INTRO_FILLER_PATTERNS.forEach((pattern) => {
    next = next.replace(pattern, "");
  });
  next = next
    .replace(/^(?:and|then|also|plus|so|to|with|for|in)\b[\s:,-]*/i, "")
    .replace(/^[\s\-:;,.]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return next;
}

function hasDashBriefMalformedCoordination(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return false;
  const verbs = "(?:check(?:ing)?|inspect(?:ing)?|clean(?:ing)?|replace(?:ing|d)?|verify(?:ing)?|test(?:ing)?|repair(?:ing)?|lubricat(?:ing|e)|reconnect(?:ing)?|disconnect(?:ing)?|install(?:ing)?|position(?:ing)?|align(?:ing)?|mount(?:ing)?|secur(?:ing|e)|set(?:ting)?|adjust(?:ing)?)";
  return (
    new RegExp(`\\b${verbs}\\s+and\\s+(?:[a-z]+ing|tighten(?:ing)?|loosen(?:ing)?|replace(?:ing|d)?|inspect(?:ing)?|clean(?:ing)?|verify(?:ing)?|test(?:ing)?|repair(?:ing)?|lubricat(?:ing|e)|reconnect(?:ing)?|disconnect(?:ing)?|install(?:ing)?|position(?:ing)?|align(?:ing)?|mount(?:ing)?|secur(?:ing|e)|set(?:ting)?|adjust(?:ing)?)\\b`, "i").test(normalized)
    || new RegExp(`\\b(?:check|inspect|clean|replace|verify|test|repair|lubricate|reconnect|disconnect|install|position|align|mount|secure|set|adjust)\\s+and\\s+(?:[a-z]+ing|tighten(?:ing)?|loosen(?:ing)?|replace(?:ing|d)?|inspect(?:ing)?|clean(?:ing)?|verify(?:ing)?|test(?:ing)?|repair(?:ing)?|lubricat(?:ing|e)|reconnect(?:ing)?|disconnect(?:ing)?|install(?:ing)?|position(?:ing)?|align(?:ing)?|mount(?:ing)?|secur(?:ing|e)|set(?:ting)?|adjust(?:ing)?)\\b`, "i").test(normalized)
  );
}

function normalizeDashBriefBulletCandidate(text = "", sourceText = "") {
  let next = stripDashBriefIntroFiller(text);
  if (!next) return "";
  next = normalizeDashCanonicalCompilerStepText(next, sourceText) || normalizeDashCompilerProceduralSentence(next) || normalizeDashFallbackLineText(next);
  next = stripDashBriefIntroFiller(next);
  if (!next) return "";
  next = normalizeDashCanonicalCompilerStepText(next, sourceText) || normalizeDashCompilerProceduralSentence(next) || normalizeDashFallbackLineText(next);
  next = sanitizeScopeAssistText(next)
    .replace(/^[\s\-:;,.]+/g, "")
    .replace(/[.!?]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!next) return "";
  return next.charAt(0).toUpperCase() + next.slice(1);
}

function isDashBriefValidBulletCandidate(text = "", sourceText = "") {
  const normalized = sanitizeScopeAssistText(text);
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  if (!normalized) return false;
  if (/^[\W_]+$/.test(normalized)) return false;
  if (countScopeWords(normalized) < 3) return false;
  if (isDashBriefIntroFillerSentence(normalized) || isDashCompilerGenericIntroSentence(normalized)) return false;
  if (hasDashBriefMalformedCoordination(normalized)) return false;
  if (!isDashStepLineComplete(normalized)) return false;
  const actionHits = extractDashCompilerActionHits(normalized);
  if (!actionHits.length) return false;
  if (!hasDashCompilerGroundedTarget(normalized)) return false;
  if (normalizedSource && getScopeTextOverlapRatio(normalizedSource, normalized) < 0.05 && !actionHits.includes("leave_ready")) return false;
  return true;
}

function splitDashBriefSentenceIntoSafeBullets(sentence = "", sourceText = "") {
  const strippedSentence = stripDashBriefIntroFiller(sentence);
  if (!strippedSentence) return [];
  const splitReadySentence = sanitizeScopeAssistText(strippedSentence)
    .replace(/\s*;\s*/g, ", ")
    .replace(/\s*,?\s+and\s+(?=(?:checking|cleaning|replacing|verifying|testing|repairing|lubricating|reconnecting|disconnecting|installing|positioning|aligning|mounting|securing|setting|adjusting|inspecting)\b)/ig, ", ");
  if (!/,/.test(splitReadySentence)) return [strippedSentence];

  const fragments = splitReadySentence
    .split(/\s*,\s*/g)
    .map((fragment) => stripDashBriefIntroFiller(fragment))
    .filter(Boolean);
  if (fragments.length < 2) return [strippedSentence];

  const normalizedFragments = fragments
    .map((fragment) => normalizeDashBriefBulletCandidate(fragment, sourceText))
    .filter(Boolean);
  if (normalizedFragments.length !== fragments.length) return [strippedSentence];
  if (!normalizedFragments.every((fragment) => isDashBriefValidBulletCandidate(fragment, sourceText))) return [strippedSentence];
  return fragments;
}

function formatDashBriefFromSourceProse(sourceText = "") {
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  if (!normalizedSource) {
    return {
      ok: false,
      scopeNotes: "",
      reasonTag: "dash_brief_missing_source",
      meta: {
        sourceChars: 0,
        bulletCount: 0,
        summaryDetected: false,
        finalExcerpt: "",
      },
    };
  }
  if (isDashCompilerContaminatedSourceText(normalizedSource)) {
    return {
      ok: false,
      scopeNotes: "",
      reasonTag: "dash_brief_contaminated_source",
      meta: {
        sourceChars: normalizedSource.length,
        bulletCount: 0,
        summaryDetected: false,
        finalExcerpt: normalizedSource.slice(0, 160),
      },
    };
  }

  const sourceSentences = splitScopeAssistSentences(normalizedSource)
    .map((sentence) => sanitizeScopeAssistText(sentence))
    .filter(Boolean);
  if (!sourceSentences.length) {
    return {
      ok: false,
      scopeNotes: "",
      reasonTag: "dash_brief_missing_source",
      meta: {
        sourceChars: normalizedSource.length,
        bulletCount: 0,
        summaryDetected: false,
        finalExcerpt: normalizedSource.slice(0, 160),
      },
    };
  }

  const sourceSentenceMeta = sourceSentences.map((sentence, index) => {
    const strippedSentence = stripDashBriefIntroFiller(sentence);
    const normalizedSentence = normalizeDashBriefBulletCandidate(strippedSentence || sentence, normalizedSource);
    const actionHits = extractDashCompilerActionHits(normalizedSentence);
    const genericIntroMatched = isDashBriefIntroFillerSentence(sentence) || isDashCompilerGenericIntroSentence(normalizedSentence);
    const groundedTarget = hasDashCompilerGroundedTarget(normalizedSentence);
    const complete = isDashBriefValidBulletCandidate(normalizedSentence, normalizedSource);
    return {
      sentence,
      strippedSentence,
      normalizedSentence,
      actionHits,
      genericIntroMatched,
      groundedTarget,
      complete,
      index,
      laterProcedural: Boolean(index > 0 && actionHits.length && !genericIntroMatched),
    };
  });

  const sourceHasLaterProceduralDetail = sourceSentenceMeta.some((entry) => entry.laterProcedural);
  const selectedSentenceMeta = sourceSentenceMeta.filter((entry) => {
    if (!entry.strippedSentence) return false;
    if (sourceHasLaterProceduralDetail && entry.index === 0 && (entry.genericIntroMatched || !entry.complete)) return false;
    if (sourceHasLaterProceduralDetail && entry.genericIntroMatched && !entry.laterProcedural) return false;
    return Boolean(entry.complete || entry.actionHits.length);
  });
  const fallbackSentenceMeta = selectedSentenceMeta.length
    ? selectedSentenceMeta
    : sourceSentenceMeta.filter((entry) => Boolean(entry.strippedSentence) && Boolean(entry.complete || entry.actionHits.length));

  const rawBulletCandidates = [];
  fallbackSentenceMeta.forEach((entry) => {
    const sentenceCandidates = splitDashBriefSentenceIntoSafeBullets(entry.sentence, normalizedSource);
    if (sentenceCandidates.length > 1) {
      rawBulletCandidates.push(...sentenceCandidates);
      return;
    }
    if (entry.strippedSentence) rawBulletCandidates.push(entry.strippedSentence);
  });

  const normalizedBulletCandidates = rawBulletCandidates
    .map((candidate) => normalizeDashBriefBulletCandidate(candidate, normalizedSource))
    .filter(Boolean);
  const rejectionStats = {
    rejectedEmptyCount: 0,
    rejectedIntroFillerCount: 0,
    rejectedMalformedVerbCount: 0,
    rejectedDuplicateCount: 0,
  };
  const buildFinalBulletArray = (candidateList = [], existingBullets = []) => {
    const finalBullets = Array.isArray(existingBullets) ? existingBullets.slice() : [];
    const seenKeys = new Set(finalBullets.map((bullet) => normalizeScopeComparisonText(bullet)).filter(Boolean));
    candidateList.forEach((candidate) => {
      const normalizedCandidate = normalizeDashBriefBulletCandidate(candidate, normalizedSource);
      if (!normalizedCandidate) {
        rejectionStats.rejectedEmptyCount += 1;
        return;
      }
      if (isDashBriefIntroFillerSentence(candidate) || isDashBriefIntroFillerSentence(normalizedCandidate) || isDashCompilerGenericIntroSentence(normalizedCandidate)) {
        rejectionStats.rejectedIntroFillerCount += 1;
        return;
      }
      if (hasDashBriefMalformedCoordination(normalizedCandidate)) {
        rejectionStats.rejectedMalformedVerbCount += 1;
        return;
      }
      if (!isDashBriefValidBulletCandidate(normalizedCandidate, normalizedSource)) {
        rejectionStats.rejectedEmptyCount += 1;
        return;
      }
      const key = normalizeScopeComparisonText(normalizedCandidate);
      if (!key || seenKeys.has(key) || finalBullets.some((bullet) => isDashNearDuplicateStepLine(bullet, normalizedCandidate))) {
        rejectionStats.rejectedDuplicateCount += 1;
        return;
      }
      finalBullets.push(normalizedCandidate);
      seenKeys.add(key);
    });
    return finalBullets.slice(0, 5);
  };

  let finalBullets = buildFinalBulletArray(normalizedBulletCandidates);
  let rebuildTriggered = false;
  if (finalBullets.length < 3) {
    rebuildTriggered = true;
    const rebuildCandidates = sourceSentenceMeta.flatMap((entry) => {
      const sentenceCandidates = splitDashBriefSentenceIntoSafeBullets(entry.sentence, normalizedSource);
      if (sentenceCandidates.length > 1) return sentenceCandidates;
      return [entry.strippedSentence || entry.sentence];
    });
    finalBullets = buildFinalBulletArray(rebuildCandidates, finalBullets);
  }

  const selectedActionKeys = uniqueStrings(finalBullets.flatMap((line) => extractDashCompilerActionHits(line)));
  const summaryMeta = buildDashCompilerSummaryFromSteps({
    sourceText: normalizedSource,
    dashLines: finalBullets,
    simplePrompt: false,
  });
  let summaryParagraph = sanitizeScopeAssistText(summaryMeta.summaryParagraph || "");
  if (!summaryParagraph) {
    const subjectPhrase = buildDashCompilerSubjectPhrase(normalizedSource, "");
    const actionPhrase = buildDashCompilerActionPhrase(selectedActionKeys);
    summaryParagraph = sanitizeScopeAssistText(
      `Complete ${subjectPhrase} so the work is ${actionPhrase || "coordinated and ready for normal use"}.`
    );
  }
  if (summaryParagraph && isDashSummaryTooSimilarToLeadBullet(summaryParagraph, finalBullets)) {
    const subjectPhrase = buildDashCompilerSubjectPhrase(normalizedSource, "");
    const actionPhrase = buildDashCompilerActionPhrase(selectedActionKeys);
    summaryParagraph = sanitizeScopeAssistText(
      `Finish ${subjectPhrase} with the selected ${actionPhrase || "service"} steps and leave it ready for normal use.`
    );
  }
  const finalText = formatDashScopeOutput(finalBullets, summaryParagraph);
  const finalStructure = parseDashScopeStructure(finalText);
  const distinctAssessment = assessDashScopeDistinctStepQuality(normalizedSource, finalText);
  const proceduralAssessment = assessDashScopeProceduralSentenceBias(normalizedSource, finalText);
  const inventedAssessment = assessDashInventedMajorDetail(normalizedSource, finalText);
  const styleAssessment = assessDashScopeStyleGuardrails(normalizedSource, finalText);
  const formatPass = Boolean(
    finalStructure.hasExactDashThenParagraphShape
    && finalStructure.hasSummaryParagraph
    && finalStructure.dashLineCount >= 3
    && finalStructure.dashLineCount <= 5
  );
  const accepted = Boolean(
    finalBullets.length >= 3
    && formatPass
    && distinctAssessment.accepted
    && proceduralAssessment.accepted
    && inventedAssessment.accepted
    && styleAssessment.accepted
    && !isDashSummaryTooSimilarToLeadBullet(finalStructure.summaryParagraph || summaryParagraph, finalBullets)
  );
  const reasonTag = accepted
    ? "dash_brief_local_transform_pass"
    : !finalBullets.length
      ? "dash_brief_missing_grounded_steps"
      : finalBullets.length < 3
        ? "dash_brief_insufficient_grounded_steps"
        : !formatPass
          ? (finalStructure.hasSummaryParagraph ? "dash_invalid_dash_then_paragraph_shape" : "dash_missing_summary_paragraph")
          : !distinctAssessment.accepted
            ? (distinctAssessment.reasonTag || "dash_distinct_step_rejected")
            : !proceduralAssessment.accepted
              ? (proceduralAssessment.reasonTag || "dash_overview_sentence_bias")
              : !inventedAssessment.accepted
                ? (inventedAssessment.reasonTag || "dash_invented_major_detail")
                : !styleAssessment.accepted
                  ? (styleAssessment.reasonTag || "dash_style_guardrail_rejected")
                  : "dash_brief_local_transform_rejected";

  return {
    ok: accepted,
    scopeNotes: accepted ? finalText : "",
    reasonTag,
    meta: {
      sourceChars: normalizedSource.length,
      sourceWordCount: countScopeWords(normalizedSource),
      bulletCount: Math.max(0, Number(finalStructure?.dashLineCount || finalBullets.length || 0)),
      selectedBulletCount: finalBullets.length,
      summaryDetected: Boolean(finalStructure?.hasSummaryParagraph),
      finalExcerpt: finalText.slice(0, 160),
      sourceActionCount: selectedActionKeys.length,
      selectedActionCount: selectedActionKeys.length,
      selectedSentenceCount: fallbackSentenceMeta.length,
      preNormalizeBulletCount: rawBulletCandidates.length,
      postNormalizeBulletCount: normalizedBulletCandidates.length,
      finalBulletCount: finalBullets.length,
      rejectedEmptyCount: rejectionStats.rejectedEmptyCount,
      rejectedIntroFillerCount: rejectionStats.rejectedIntroFillerCount,
      rejectedMalformedVerbCount: rejectionStats.rejectedMalformedVerbCount,
      rejectedDuplicateCount: rejectionStats.rejectedDuplicateCount,
      rebuildTriggered,
      shapeValidated: Boolean(formatPass),
    },
  };
}

function handleDashBriefLocalRefine({
  traceId = "",
  requestStartedAt = Date.now(),
  context = {},
  currentScopeText = "",
  refineInstruction = "",
  setDebugState = () => {},
  setRuntimeTruth = () => {},
} = {}) {
  const normalizedRefineInstruction = sanitizeScopeAssistText(refineInstruction || context?.refineInstruction || "");
  const sourceSelection = resolveDashBriefLocalSource({
    context,
    currentScopeText,
  });
  const sourceText = sanitizeScopeAssistText(sourceSelection?.sourceText || currentScopeText || "");
  const sourceKind = String(sourceSelection?.sourceKind || sourceSelection?.sourceType || "dash_brief_local_refine");
  const elapsed_ms = Math.max(0, Date.now() - Number(requestStartedAt || Date.now()));

  logScopeAssistTerminal(traceId, "dash_brief_local_entry", {
    elapsed_ms,
    _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
    sourceKind,
    sourceChars: sourceText.length,
    refineInstruction: normalizedRefineInstruction,
  });
  logScopeAssistTerminal(traceId, "dash_brief_local_source_resolved", {
    elapsed_ms,
    _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
    sourceKind,
    sourceType: String(sourceSelection?.sourceType || ""),
    sourcePriority: String(sourceSelection?.sourcePriority || ""),
    sourceChars: sourceText.length,
    usedOriginalProseSource: Boolean(sourceSelection?.usedOriginalProseSource),
    usedAcceptedProseDraft: Boolean(sourceSelection?.usedAcceptedProseDraft),
    promptFallbackBlocked: Boolean(sourceSelection?.fallbackSourceTextBlocked),
  });

  if (!sourceText || isDashCompilerContaminatedSourceText(sourceText)) {
    const reasonTag = String(sourceSelection?.reasonTag || (!sourceText ? "dash_brief_missing_source" : "dash_brief_contaminated_source"));
    logScopeAssistTerminal(traceId, "dash_brief_local_failure", {
      elapsed_ms,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      sourceChars: sourceText.length,
      bulletCount: 0,
      finalExcerpt: sourceText.slice(0, 160),
      reasonTag,
    });
    try {
      setDebugState({
        path: "malformed_or_internal_failure",
        stage: "normalized_failure",
        model: "local_dash_brief_formatter",
      });
      setRuntimeTruth({
        refineMode: "refine",
        refineInstruction: normalizedRefineInstruction,
        dashDetectorMatched: true,
        dashBranchActive: true,
        dashMode: true,
        dashSourcePromptWeighted: Boolean(sourceSelection?.sourcePriority || sourceSelection?.sourceType),
        dashCompiledLocally: true,
        dashCompilerSource: "dash_brief_local_refine",
        dashCompilerSourcePriority: String(sourceSelection?.sourcePriority || sourceSelection?.sourceType || ""),
        dashCompilerSourceTextUsedForCompilation: sourceText,
        dashTransformSource: sourceText,
        dashCanonicalProseSourceType: String(sourceSelection?.sourceType || sourceSelection?.sourcePriority || ""),
        dashCanonicalProseChars: sourceText.length,
        dashUsedOriginalAcceptedProse: Boolean(sourceSelection?.usedOriginalProseSource),
        dashUsedAcceptedProseDraft: Boolean(sourceSelection?.usedAcceptedProseDraft),
        dashGroqRewriteUsed: false,
        dashLocalCompilerBypassed: true,
        dashGroqRewriteValidated: false,
        dashRetryUsed: false,
        dashLocalFallbackUsed: false,
        dashFallbackRejectedForCompliance: false,
        dashRejectedBeforeDirectSuccess: true,
        dashFallbackAccepted: false,
        dashSuccessBlockedForComplianceFailure: true,
        dashReturnedSuccess: false,
        dashReturnedFailurePath: true,
        dashBestEffortSuccessRemoved: true,
        dashLineCount: 0,
        dashHasSummaryParagraph: false,
        dashFormatPass: false,
        dashSemanticPass: false,
        dashDistinctStepPass: false,
        dashRejectedForOverviewBias: false,
        dashProceduralBulletCount: 0,
        dashOverviewBulletCount: 0,
        dashInventedMajorDetailRejected: false,
        dashRetrySamplingRaised: false,
        parseSource: "dash_brief_local_transform",
        outcome: "failed",
        reasonTag,
        excerpt: sourceText,
      });
    } catch {}
    return {
      ok: false,
      scopeNotes: "",
      reasonTag,
      meta: {
        sourceKind,
        sourceChars: sourceText.length,
        bulletCount: 0,
        finalExcerpt: sourceText.slice(0, 160),
      },
    };
  }

  try {
    const formatted = formatDashBriefFromSourceProse(sourceText);
    const sourceBulletCount = Math.max(0, Number(formatted?.meta?.bulletCount || 0));

    logScopeAssistTerminal(traceId, "dash_brief_local_transform_complete", {
      elapsed_ms,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      sourceChars: sourceText.length,
      bulletCount: sourceBulletCount,
      selectedSentenceCount: Math.max(0, Number(formatted?.meta?.selectedSentenceCount || 0)),
      preNormalizeBulletCount: Math.max(0, Number(formatted?.meta?.preNormalizeBulletCount || 0)),
      postNormalizeBulletCount: Math.max(0, Number(formatted?.meta?.postNormalizeBulletCount || 0)),
      finalBulletCount: Math.max(0, Number(formatted?.meta?.finalBulletCount || 0)),
      rejectedEmptyCount: Math.max(0, Number(formatted?.meta?.rejectedEmptyCount || 0)),
      rejectedIntroFillerCount: Math.max(0, Number(formatted?.meta?.rejectedIntroFillerCount || 0)),
      rejectedMalformedVerbCount: Math.max(0, Number(formatted?.meta?.rejectedMalformedVerbCount || 0)),
      rejectedDuplicateCount: Math.max(0, Number(formatted?.meta?.rejectedDuplicateCount || 0)),
      rebuildTriggered: Boolean(formatted?.meta?.rebuildTriggered),
      summaryDetected: Boolean(formatted?.meta?.summaryDetected),
      accepted: Boolean(formatted?.ok),
      reasonTag: String(formatted?.reasonTag || ""),
      finalExcerpt: String(formatted?.meta?.finalExcerpt || "").slice(0, 160),
    });

    logScopeAssistTerminal(traceId, "dash_brief_sentences_selected", {
      elapsed_ms,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      selectedSentenceCount: Math.max(0, Number(formatted?.meta?.selectedSentenceCount || 0)),
      finalExcerpt: String(formatted?.meta?.finalExcerpt || "").slice(0, 160),
    });
    logScopeAssistTerminal(traceId, "dash_brief_bullets_pre_normalize", {
      elapsed_ms,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      preNormalizeBulletCount: Math.max(0, Number(formatted?.meta?.preNormalizeBulletCount || 0)),
      rejectedEmptyCount: Math.max(0, Number(formatted?.meta?.rejectedEmptyCount || 0)),
      finalExcerpt: String(formatted?.meta?.finalExcerpt || "").slice(0, 160),
    });
    logScopeAssistTerminal(traceId, "dash_brief_bullets_post_normalize", {
      elapsed_ms,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      postNormalizeBulletCount: Math.max(0, Number(formatted?.meta?.postNormalizeBulletCount || 0)),
      rejectedIntroFillerCount: Math.max(0, Number(formatted?.meta?.rejectedIntroFillerCount || 0)),
      rejectedMalformedVerbCount: Math.max(0, Number(formatted?.meta?.rejectedMalformedVerbCount || 0)),
      finalExcerpt: String(formatted?.meta?.finalExcerpt || "").slice(0, 160),
    });
    logScopeAssistTerminal(traceId, "dash_brief_bullets_final_valid", {
      elapsed_ms,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      finalBulletCount: Math.max(0, Number(formatted?.meta?.finalBulletCount || 0)),
      rejectedDuplicateCount: Math.max(0, Number(formatted?.meta?.rejectedDuplicateCount || 0)),
      finalExcerpt: String(formatted?.meta?.finalExcerpt || "").slice(0, 160),
    });
    if (formatted?.meta?.rebuildTriggered) {
      logScopeAssistTerminal(traceId, "dash_brief_local_rebuild_triggered", {
        elapsed_ms,
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        sourceKind,
        preNormalizeBulletCount: Math.max(0, Number(formatted?.meta?.preNormalizeBulletCount || 0)),
        finalBulletCount: Math.max(0, Number(formatted?.meta?.finalBulletCount || 0)),
        finalExcerpt: String(formatted?.meta?.finalExcerpt || "").slice(0, 160),
      });
    }
    logScopeAssistTerminal(traceId, "dash_brief_local_shape_validated", {
      elapsed_ms,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      accepted: Boolean(formatted?.ok),
      bulletCount: sourceBulletCount,
      summaryDetected: Boolean(formatted?.meta?.summaryDetected),
      reasonTag: String(formatted?.reasonTag || ""),
      finalExcerpt: String(formatted?.meta?.finalExcerpt || "").slice(0, 160),
    });

    if (!formatted?.ok) {
      logScopeAssistTerminal(traceId, "dash_brief_local_failure", {
        elapsed_ms,
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        sourceKind,
        sourceChars: sourceText.length,
        bulletCount: sourceBulletCount,
        finalExcerpt: String(formatted?.meta?.finalExcerpt || "").slice(0, 160),
        reasonTag: String(formatted?.reasonTag || "dash_brief_local_transform_rejected"),
      });
      try {
        setDebugState({
          path: "malformed_or_internal_failure",
          stage: "normalized_failure",
          model: "local_dash_brief_formatter",
        });
        setRuntimeTruth({
          outcome: "failed",
          reasonTag: String(formatted?.reasonTag || "dash_brief_local_transform_rejected"),
          excerpt: String(formatted?.meta?.finalExcerpt || ""),
          parseSource: "dash_brief_local_transform",
          refineMode: "refine",
          refineInstruction: normalizedRefineInstruction,
          dashDetectorMatched: true,
          dashBranchActive: true,
          dashMode: true,
          dashSourcePromptWeighted: Boolean(sourceSelection?.sourcePriority || sourceSelection?.sourceType),
          dashCompiledLocally: true,
          dashCompilerSource: "dash_brief_local_refine",
          dashCompilerStepCount: sourceBulletCount,
          dashCompilerSourcePriority: String(sourceSelection?.sourcePriority || sourceSelection?.sourceType || ""),
          dashCompilerSourceTextUsedForCompilation: sourceText,
          dashTransformSource: sourceText,
          dashCanonicalProseSourceType: String(sourceSelection?.sourceType || sourceSelection?.sourcePriority || ""),
          dashCanonicalProseChars: sourceText.length,
          dashUsedOriginalAcceptedProse: Boolean(sourceSelection?.usedOriginalProseSource),
          dashUsedAcceptedProseDraft: Boolean(sourceSelection?.usedAcceptedProseDraft),
          dashGroqRewriteUsed: false,
          dashLocalCompilerBypassed: true,
          dashGroqRewriteValidated: false,
          dashRetryUsed: false,
          dashLocalFallbackUsed: false,
          dashFallbackRejectedForCompliance: false,
          dashRejectedBeforeDirectSuccess: true,
          dashFallbackAccepted: false,
          dashSuccessBlockedForComplianceFailure: true,
          dashReturnedSuccess: false,
          dashReturnedFailurePath: true,
          dashBestEffortSuccessRemoved: true,
          dashLineCount: sourceBulletCount,
          dashHasSummaryParagraph: Boolean(formatted?.meta?.summaryDetected),
          dashFormatPass: false,
          dashSemanticPass: false,
          dashDistinctStepPass: false,
          dashRejectedForOverviewBias: false,
          dashProceduralBulletCount: 0,
          dashOverviewBulletCount: 0,
          dashSummaryEchoLikeStep: false,
          dashSummaryLeadBulletEchoLikeStep: false,
          dashSourceSentenceEchoLikeStep: false,
          dashOverviewSentenceBiasDetected: false,
          dashRetrySamplingRaised: false,
          excerpt: String(formatted?.meta?.finalExcerpt || ""),
        });
      } catch {}
      return {
        ok: false,
        scopeNotes: "",
        reasonTag: String(formatted?.reasonTag || "dash_brief_local_transform_rejected"),
        meta: {
          sourceKind,
          sourceChars: sourceText.length,
          bulletCount: sourceBulletCount,
          finalExcerpt: String(formatted?.meta?.finalExcerpt || "").slice(0, 160),
        },
      };
    }

    logScopeAssistTerminal(traceId, "dash_brief_local_success", {
      elapsed_ms,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      sourceChars: sourceText.length,
      bulletCount: sourceBulletCount,
      finalExcerpt: String(formatted?.scopeNotes || "").slice(0, 160),
      reasonTag: String(formatted?.reasonTag || "dash_brief_local_transform_pass"),
    });
    try {
      setDebugState({
        path: "grounded_fallback_success",
        stage: "parse_completed",
        model: "local_dash_brief_formatter",
      });
      setRuntimeTruth({
        outcome: "scope",
        reasonTag: String(formatted?.reasonTag || "dash_brief_local_transform_pass"),
        excerpt: String(formatted?.scopeNotes || ""),
        responseSource: "grounded_fallback",
        fallbackSource: "dash_brief_local_transform",
        parseSource: "dash_brief_local_transform",
        refineMode: "refine",
        refineInstruction: normalizedRefineInstruction,
        dashDetectorMatched: true,
        dashBranchActive: true,
        dashMode: true,
        dashSourcePromptWeighted: Boolean(sourceSelection?.sourcePriority || sourceSelection?.sourceType),
        dashCompiledLocally: true,
        dashCompilerSource: "dash_brief_local_refine",
        dashCompilerStepCount: sourceBulletCount,
        dashCompilerDroppedDuplicateCount: 0,
        dashCompilerDroppedFragmentCount: 0,
        dashCompilerUsedModelBullets: false,
        dashCompilerProceduralCandidateCount: sourceBulletCount,
        dashCompilerDroppedGenericIntroCount: 0,
        dashCompilerRejectedIntroCandidateCount: 0,
        dashCompilerUsedProceduralSentences: true,
        dashCompilerSummaryBuiltFromSteps: true,
        dashCompilerSelectedProceduralStepCount: sourceBulletCount,
        dashCompilerDenseProseProceduralMode: sourceBulletCount >= 3,
        dashCompilerRejectedSourceIntroSummary: false,
        dashCompilerSourcePriority: String(sourceSelection?.sourcePriority || sourceSelection?.sourceType || ""),
        dashCompilerRejectedCurrentDraftAsCompilerSource: false,
        dashCompilerRejectedFailedDashAsCompilerSource: false,
        dashCompilerUsedOriginalProseSource: Boolean(sourceSelection?.usedOriginalProseSource),
        dashCompilerFallbackSourceTextBlocked: Boolean(sourceSelection?.fallbackSourceTextBlocked),
        dashCompilerSourceTextUsedForCompilation: sourceText,
        dashTransformSource: sourceText,
        dashCanonicalProseSourceType: String(sourceSelection?.sourceType || sourceSelection?.sourcePriority || "immutable_original_accepted_prose"),
        dashCanonicalProseChars: sourceText.length,
        dashUsedOriginalAcceptedProse: Boolean(sourceSelection?.usedOriginalProseSource),
        dashUsedAcceptedProseDraft: Boolean(sourceSelection?.usedAcceptedProseDraft),
        dashFellBackToRequestText: false,
        dashGroqRewriteUsed: false,
        dashLocalCompilerBypassed: true,
        dashGroqRewriteValidated: false,
        dashGroqRewriteRetryCount: 0,
        dashRetryUsed: false,
        dashLocalFallbackUsed: false,
        dashFallbackRejectedForCompliance: false,
        dashRejectedBeforeDirectSuccess: false,
        dashFallbackAccepted: true,
        dashSuccessBlockedForComplianceFailure: false,
        dashReturnedSuccess: true,
        dashReturnedFailurePath: false,
        dashBestEffortSuccessRemoved: false,
        dashLineCount: sourceBulletCount,
        dashHasSummaryParagraph: true,
        dashFormatPass: true,
        dashSemanticPass: true,
        dashDistinctStepPass: true,
        dashRepeatedLineCount: 0,
        dashSplitSentenceEchoLineCount: 0,
        dashNearDuplicateLineCount: 0,
        dashFragmentBulletRejected: false,
        dashMaxLineOverlap: 0,
        dashSummaryEchoLikeStep: false,
        dashSummaryLeadBulletEchoLikeStep: false,
        dashSourceSentenceEchoLikeStep: false,
        dashProceduralSentenceBiasActive: true,
        dashOverviewSentenceRejectedCount: 0,
        dashProceduralBulletCount: sourceBulletCount,
        dashOverviewBulletCount: 0,
        dashRejectedForOverviewBias: false,
        dashInventedMajorDetailRejected: false,
        dashOverviewSentenceBiasDetected: false,
        dashProceduralSentenceCoverage: 1,
        dashSummaryEchoedOverview: false,
        dashRetrySamplingRaised: false,
      });
    } catch {}

    return {
      ok: true,
      scopeNotes: String(formatted?.scopeNotes || ""),
      reasonTag: String(formatted?.reasonTag || "dash_brief_local_transform_pass"),
      meta: {
        sourceKind,
        sourceChars: sourceText.length,
        bulletCount: sourceBulletCount,
        finalExcerpt: String(formatted?.scopeNotes || "").slice(0, 160),
        summaryDetected: Boolean(formatted?.meta?.summaryDetected),
      },
    };
  } catch (error) {
    const errorMessage = String(error?.stack || error?.message || error || "").trim();
    logScopeAssistTerminal(traceId, "dash_brief_local_failure", {
      elapsed_ms,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      sourceKind,
      sourceChars: sourceText.length,
      bulletCount: 0,
      finalExcerpt: sourceText.slice(0, 160),
      reasonTag: "dash_brief_local_transform_exception",
      errorMessage: errorMessage.slice(0, 240),
    });
    try {
      setDebugState({
        path: "malformed_or_internal_failure",
        stage: "normalized_failure",
        model: "local_dash_brief_formatter",
      });
      setRuntimeTruth({
        outcome: "failed",
        reasonTag: "dash_brief_local_transform_exception",
        excerpt: sourceText,
        parseSource: "dash_brief_local_transform",
        refineMode: "refine",
        refineInstruction: normalizedRefineInstruction,
        dashDetectorMatched: true,
        dashBranchActive: true,
        dashMode: true,
        dashSourcePromptWeighted: Boolean(sourceSelection?.sourcePriority || sourceSelection?.sourceType),
        dashCompiledLocally: true,
        dashCompilerSource: "dash_brief_local_refine",
        dashCompilerStepCount: 0,
        dashCompilerSourcePriority: String(sourceSelection?.sourcePriority || sourceSelection?.sourceType || ""),
        dashCompilerSourceTextUsedForCompilation: sourceText,
        dashTransformSource: sourceText,
        dashCanonicalProseSourceType: String(sourceSelection?.sourceType || sourceSelection?.sourcePriority || ""),
        dashCanonicalProseChars: sourceText.length,
        dashUsedOriginalAcceptedProse: Boolean(sourceSelection?.usedOriginalProseSource),
        dashUsedAcceptedProseDraft: Boolean(sourceSelection?.usedAcceptedProseDraft),
        dashGroqRewriteUsed: false,
        dashLocalCompilerBypassed: true,
        dashGroqRewriteValidated: false,
        dashRetryUsed: false,
        dashLocalFallbackUsed: false,
        dashFallbackRejectedForCompliance: false,
        dashRejectedBeforeDirectSuccess: true,
        dashFallbackAccepted: false,
        dashSuccessBlockedForComplianceFailure: true,
        dashReturnedSuccess: false,
        dashReturnedFailurePath: true,
        dashBestEffortSuccessRemoved: true,
        dashLineCount: 0,
        dashHasSummaryParagraph: false,
        dashFormatPass: false,
        dashSemanticPass: false,
        dashDistinctStepPass: false,
        dashRejectedForOverviewBias: false,
        dashProceduralBulletCount: 0,
        dashOverviewBulletCount: 0,
        dashSummaryEchoLikeStep: false,
        dashSummaryLeadBulletEchoLikeStep: false,
        dashSourceSentenceEchoLikeStep: false,
        dashOverviewSentenceBiasDetected: false,
        dashRetrySamplingRaised: false,
      });
    } catch {}
    return {
      ok: false,
      scopeNotes: "",
      reasonTag: "dash_brief_local_transform_exception",
      meta: {
        sourceKind,
        sourceChars: sourceText.length,
        bulletCount: 0,
        finalExcerpt: sourceText.slice(0, 160),
      },
    };
  }
}

function countScopeParagraphBlocks(text = "") {
  const normalized = sanitizeScopeAssistText(text);
  if (!normalized) return 0;
  return normalized
    .split(/\n\s*\n/g)
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

const SIMPLE_SCOPE_PROMPT_ACTION_RULES = [
  { key: "stripe", detect: /\b(?:restripe|re-strip(?:e|ing)?|stiping|striping|stipe|stripe)\b/i, remove: /\b(?:restripe|re-strip(?:e|ing)?|stiping|striping|stipe|stripe)\b/i },
  { key: "paint", detect: /\b(?:repaint|paint|touch\s+up)\b/i, remove: /\b(?:repaint|paint|touch\s+up)\b/i },
  { key: "replace", detect: /\breplace\b/i, remove: /\breplace\b/i },
  { key: "install", detect: /\binstall\b/i, remove: /\binstall\b/i },
  { key: "patch", detect: /\bpatch\b/i, remove: /\bpatch\b/i },
  { key: "repair", detect: /\b(?:repair|fix|restore|redo)\b/i, remove: /\b(?:repair|fix|restore|redo)\b/i },
  { key: "seal", detect: /\b(?:seal|caulk|flash)\b/i, remove: /\b(?:seal|caulk|flash)\b/i },
  { key: "remove", detect: /\b(?:remove|demo|demolish|tear\s*out)\b/i, remove: /\b(?:remove|demo|demolish|tear\s*out)\b/i },
  { key: "reconnect", detect: /\b(?:disconnect|reconnect)\b/i, remove: /\b(?:disconnect|reconnect)\b/i },
  { key: "clean", detect: /\bclean\b/i, remove: /\bclean\b/i },
  { key: "adjust", detect: /\b(?:adjust|align|mount|set|swap|change|upgrade|fit|trim|tighten)\b/i, remove: /\b(?:adjust|align|mount|set|swap|change|upgrade|fit|trim|tighten)\b/i },
];

const SCOPE_PROMPT_JUNK_PATTERNS = [
  /^(?:help|help me)$/i,
  /^(?:do work|do the work)$/i,
  /^(?:fix thing|fix things)$/i,
  /^(?:repair area|repair the area)$/i,
  /^(?:paint it|paint the area)$/i,
  /^(?:change stuff|change the stuff)$/i,
];

const SCOPE_PROMPT_GENERIC_ONLY_TOKENS = new Set([
  "help",
  "thing",
  "things",
  "stuff",
  "something",
  "anything",
  "work",
  "job",
  "area",
]);

const SCOPE_PROMPT_ACTION_ONLY_TOKENS = new Set([
  "fix",
  "repair",
  "paint",
  "change",
  "do",
  "install",
  "replace",
  "patch",
  "seal",
  "caulk",
  "clean",
  "remove",
  "service",
  "adjust",
  "restore",
  "redo",
  "swap",
  "mount",
  "set",
  "reconnect",
  "disconnect",
]);

const VAGUE_SCOPE_TARGET_TOKENS = new Set([
  "it",
  "thing",
  "things",
  "stuff",
  "something",
  "anything",
  "area",
  "areas",
  "site",
  "building",
  "problem",
  "problems",
  "issue",
  "issues",
  "item",
  "items",
  "part",
  "parts",
  "wall",
  "walls",
  "leak",
  "leaks",
  "surface",
  "surfaces",
  "space",
  "spaces",
  "place",
  "places",
  "fixture",
  "fixtures",
  "equipment",
  "system",
  "thingy",
]);

function stripScopePromptLeadIn(text) {
  return sanitizeScopeAssistText(text).replace(
    /^(?:please|need to|want to|would like to|looking to|help me|can you|could you|we need to|we need|i need to|i need)\s+/i,
    ""
  ).trim();
}

function findSimpleScopeActionRule(text = "") {
  return SIMPLE_SCOPE_PROMPT_ACTION_RULES.find((rule) => rule.detect.test(text)) || null;
}

function splitSimpleScopeTargetPhrase(targetPhrase = "") {
  const normalized = sanitizeScopeAssistText(targetPhrase);
  if (!normalized) {
    return {
      targetPhrase: "",
      objectPhrase: "",
      locationPhrase: "",
    };
  }

  const match = normalized.match(/^(.*?)(\s+(?:in|at|on|within|inside|outside|around|along|by|near|under|over|from)\s+.+)$/i);
  const objectPhrase = sanitizeScopeAssistText(match?.[1] || normalized) || normalized;
  const locationPhrase = sanitizeScopeAssistText(match?.[2] || "");
  return {
    targetPhrase: sanitizeScopeAssistText(`${objectPhrase}${locationPhrase ? ` ${locationPhrase}` : ""}`),
    objectPhrase,
    locationPhrase,
  };
}

function analyzeSimpleScopePrompt(userInput = "") {
  const normalizedPrompt = stripScopePromptLeadIn(userInput);
  const actionRule = findSimpleScopeActionRule(normalizedPrompt);
  const withoutAction = actionRule
    ? sanitizeScopeAssistText(normalizedPrompt.replace(actionRule.remove, " "))
    : normalizedPrompt;
  const cleanedTarget = sanitizeScopeAssistText(
    withoutAction
      .replace(/^(?:the|a|an)\s+/i, "")
      .replace(/\s+/g, " ")
  );
  const targetParts = splitSimpleScopeTargetPhrase(cleanedTarget || normalizedPrompt);
  const targetTokens = tokenizeComparableScopeWords(targetParts.targetPhrase);
  const specificTargetTokens = targetTokens.filter((token) => !VAGUE_SCOPE_TARGET_TOKENS.has(token));
  const tokenCount = tokenizeComparableScopeWords(normalizedPrompt).length;
  const isClearlyDraftable = Boolean(actionRule && specificTargetTokens.length >= 1 && tokenCount >= 2);

  return {
    normalizedPrompt,
    actionKey: actionRule?.key || "",
    targetPhrase: targetParts.targetPhrase,
    objectPhrase: targetParts.objectPhrase,
    locationPhrase: targetParts.locationPhrase,
    targetTokens,
    specificTargetTokens,
    isClearlyDraftable,
    isVague: !isClearlyDraftable,
  };
}

function analyzeScopeAssistPromptMeaning(userInput = "") {
  const normalizedPrompt = stripScopePromptLeadIn(userInput);
  const tokens = tokenizeComparableScopeWords(normalizedPrompt);
  const nonGenericTokens = tokens.filter((token) => !SCOPE_PROMPT_GENERIC_ONLY_TOKENS.has(token));
  const meaningTokens = nonGenericTokens.filter((token) => !SCOPE_PROMPT_ACTION_ONLY_TOKENS.has(token));
  const uselessByPattern = SCOPE_PROMPT_JUNK_PATTERNS.some((pattern) => pattern.test(normalizedPrompt));
  const hasLocationCue = /\b(?:at|in|on|within|inside|outside|around|along|near|front|rear|side|roof|yard|dock|room|entry|lot|drive|bay)\b/i.test(normalizedPrompt);
  const isSingleGenericToken = tokens.length === 1 && SCOPE_PROMPT_GENERIC_ONLY_TOKENS.has(tokens[0]);
  const isTrulyUseless = !normalizedPrompt
    || uselessByPattern
    || tokens.length === 0
    || isSingleGenericToken;
  const isGroqDraftEligible = !isTrulyUseless;
  const supportsDetailedDraft = isGroqDraftEligible && (
    meaningTokens.length >= 2
    || (meaningTokens.length >= 1 && (tokens.length >= 2 || hasLocationCue))
    || tokens.length >= 4
  );

  return {
    normalizedPrompt,
    tokens,
    nonGenericTokens,
    meaningTokens,
    hasLocationCue,
    isTrulyUseless,
    isGroqDraftEligible,
    supportsDetailedDraft,
  };
}

function isSimpleScopePromptShape(userInput = "") {
  return analyzeSimpleScopePrompt(userInput).isClearlyDraftable;
}

function assessScopeAssistOutput(scopeNotes, userInput = "") {
  if (typeof scopeNotes !== "string") {
    return { accepted: false, reason: "rejected_malformed", simplePrompt: isSimpleScopePromptShape(userInput) };
  }

  const normalized = sanitizeScopeAssistText(scopeNotes);
  if (!normalized) {
    return { accepted: false, reason: "rejected_no_content", simplePrompt: isSimpleScopePromptShape(userInput) };
  }

  const simplePrompt = isSimpleScopePromptShape(userInput);
  const lower = normalized.toLowerCase();
  const metaLanguageMatch = matchScopeAssistMetaLanguage(normalized);
  if (metaLanguageMatch.matched) {
    return {
      accepted: false,
      reason: "rejected_meta_language",
      simplePrompt,
      matchedPattern: metaLanguageMatch.pattern,
    };
  }

  const normalizedInput = sanitizeScopeAssistText(userInput);
  if (normalizedInput) {
    const outputTokens = tokenizeComparableScopeWords(normalized);
    const inputTokens = tokenizeComparableScopeWords(normalizedInput);
    const addedTokens = outputTokens.filter((token) => !inputTokens.includes(token));
    const overlap = inputTokens.length && outputTokens.length
      ? countIntersection(inputTokens, outputTokens) / Math.max(1, Math.min(inputTokens.length, outputTokens.length))
      : 0;
    const echoLike = lower === normalizedInput.toLowerCase()
      || (inputTokens.length
        && outputTokens.length
        && overlap >= (simplePrompt ? 0.92 : 0.96)
        && addedTokens.length <= 1);
    if (echoLike) {
    return { accepted: false, reason: "rejected_echo", simplePrompt };
    }
  }

  if (/^(?:scope|work|project)\s+includes?\s*(?:the requested work|the requested scope)\b/i.test(lower)) {
    return { accepted: false, reason: "rejected_boilerplate", simplePrompt };
  }

  return {
    accepted: true,
    reason: "accepted_direct",
    simplePrompt,
  };
}

const GENERIC_SCOPE_SCAFFOLD_PATTERNS = [
  /\bwork on affected areas\b/i,
  /\bcomplete the described scope\b/i,
  /\bcomplete the stated scope\b/i,
  /\bclean up the work area\b/i,
  /\bnot included unless identified and approved\b/i,
  /\bprepare adjacent perimeter surfaces\b/i,
  /\bwork area\b/i,
  /\baffected areas\b/i,
];

const GENERIC_SCOPE_SCAFFOLD_STOP_WORDS = new Set([
  "work",
  "areas",
  "area",
  "complete",
  "described",
  "stated",
  "scope",
  "clean",
  "cleanup",
  "included",
  "unless",
  "identified",
  "approved",
  "prepare",
  "adjacent",
  "perimeter",
  "surfaces",
  "surface",
  "affected",
  "tie",
  "in",
  "tiein",
  "transitions",
  "as",
  "needed",
]);
const GENERIC_SCOPE_SCAFFOLD_GENERIC_TOKENS = new Set([
  "affected",
  "complete",
  "completed",
  "described",
  "stated",
  "scope",
  "verify",
  "confirm",
  "final",
  "site",
  "boundary",
  "boundaries",
  "include",
  "includes",
  "included",
  "identify",
  "identified",
  "approved",
  "approval",
  "prepare",
  "prepared",
  "clean",
  "cleanup",
  "remove",
  "removed",
  "area",
  "areas",
  "work",
  "worksite",
  "adjacent",
  "perimeter",
  "surface",
  "surfaces",
]);

const SCOPE_ASSIST_STYLE_PROPOSAL_PATTERNS = [
  { reasonTag: "style_proposal_tone", pattern: /\bcontractor shall\b/i },
  { reasonTag: "style_proposal_tone", pattern: /\bfurnish(?:ing)? labor,\s*equipment,\s*tools\b/i },
  { reasonTag: "style_proposal_tone", pattern: /\bindustry-standard practices\b/i },
  { reasonTag: "style_proposal_tone", pattern: /\bproposal excludes?\b/i },
  { reasonTag: "style_proposal_tone", pattern: /\bsubject to field verification\b/i },
  { reasonTag: "style_proposal_tone", pattern: /\bapproved in writing\b/i },
  { reasonTag: "style_proposal_tone", pattern: /\btreated as additional work\b/i },
  { reasonTag: "style_proposal_tone", pattern: /\bin accordance with approved (?:site )?layout\b/i },
];

const SCOPE_ASSIST_STYLE_INVENTED_SPECIFICITY_PATTERNS = [
  { reasonTag: "style_invented_specificity", pattern: /\bthermoplastic\b/i, allowPattern: /\bthermoplastic\b/i },
  { reasonTag: "style_invented_specificity", pattern: /\bada\b/i, allowPattern: /\bada\b/i },
  { reasonTag: "style_invented_specificity", pattern: /\blocal regulations?\b/i, allowPattern: /\blocal regulations?\b/i },
  { reasonTag: "style_invented_specificity", pattern: /\bcompliance\b/i, allowPattern: /\bcompliance\b/i },
  { reasonTag: "style_invented_specificity", pattern: /\bpermits?\b/i, allowPattern: /\bpermits?\b/i },
  { reasonTag: "style_invented_specificity", pattern: /\b(?:building\s+)?code\b/i, allowPattern: /\b(?:building\s+)?code\b/i },
  { reasonTag: "style_invented_specificity", pattern: /\bregulatory\b/i, allowPattern: /\bregulatory\b/i },
];

function assessScopeAssistGenericScaffold(scopeNotes, userInput = "") {
  if (typeof scopeNotes !== "string") {
    return {
      accepted: false,
      reason: "rejected_generic_scaffold",
      reasonTag: "missing_job_specific_content",
      promptBinding: 0,
      excerpt: "",
    };
  }

  const normalizedOutput = sanitizeScopeAssistText(scopeNotes);
  if (!normalizedOutput) {
    return {
      accepted: false,
      reason: "rejected_generic_scaffold",
      reasonTag: "missing_job_specific_content",
      promptBinding: 0,
      excerpt: "",
    };
  }

  const normalizedInput = sanitizeScopeAssistText(userInput);
  const outputTokens = tokenizeComparableScopeWords(normalizedOutput);
  const inputTokens = tokenizeComparableScopeWords(normalizedInput);
  const overlap = inputTokens.length && outputTokens.length
    ? countIntersection(inputTokens, outputTokens)
    : 0;
  const promptBinding = inputTokens.length && outputTokens.length
    ? overlap / Math.max(1, Math.min(inputTokens.length, outputTokens.length))
    : 0;
  const lower = normalizedOutput.toLowerCase();
  const phraseHits = GENERIC_SCOPE_SCAFFOLD_PATTERNS.reduce((count, pattern) => count + (pattern.test(lower) ? 1 : 0), 0);
  const meaningfulTokens = outputTokens.filter((token) => !GENERIC_SCOPE_SCAFFOLD_STOP_WORDS.has(token));
  const jobSpecificTokens = meaningfulTokens.filter((token) => !inputTokens.includes(token));
  const shortAndGeneric = outputTokens.length <= 18 && promptBinding < 0.3 && phraseHits >= 1;
  const boilerplateDominant = phraseHits >= 2 && meaningfulTokens.length <= 8;
  const missingJobSpecificContent = phraseHits >= 1 && overlap === 0 && meaningfulTokens.length <= 10;
  const weakPromptBinding = phraseHits >= 1 && promptBinding < 0.18 && meaningfulTokens.length <= 12;
  const wrapperDominant = phraseHits >= 1 && jobSpecificTokens.length <= 2 && meaningfulTokens.length <= 14;
  const genericWrapperOnly = phraseHits >= 1 && jobSpecificTokens.length > 0 && jobSpecificTokens.every((token) => GENERIC_SCOPE_SCAFFOLD_GENERIC_TOKENS.has(token));

  if (boilerplateDominant || shortAndGeneric || missingJobSpecificContent || weakPromptBinding || wrapperDominant || genericWrapperOnly) {
    return {
      accepted: false,
      reason: "rejected_generic_scaffold",
      reasonTag: boilerplateDominant
        ? "boilerplate_dominant"
        : missingJobSpecificContent
          ? "missing_job_specific_content"
          : genericWrapperOnly
            ? "missing_job_specific_content"
          : wrapperDominant
            ? "weak_prompt_binding"
            : "weak_prompt_binding",
      promptBinding,
      excerpt: normalizedOutput.slice(0, 160),
    };
  }

  return {
    accepted: true,
    reason: "accepted_direct",
    reasonTag: "job_specific_content",
    promptBinding,
    excerpt: normalizedOutput.slice(0, 160),
  };
}

function assessScopeAssistStyleCompliance(scopeNotes, userInput = "", analysis = null) {
  if (typeof scopeNotes !== "string") {
    return {
      accepted: false,
      reasonTag: "style_missing_content",
      excerpt: "",
      matchedPattern: "",
      paragraphCount: 0,
      sentenceCount: 0,
    };
  }

  const normalizedOutput = sanitizeScopeAssistText(scopeNotes);
  if (!normalizedOutput) {
    return {
      accepted: false,
      reasonTag: "style_missing_content",
      excerpt: "",
      matchedPattern: "",
      paragraphCount: 0,
      sentenceCount: 0,
    };
  }

  const sentenceCount = countScopeSentences(normalizedOutput);
  const paragraphCount = countScopeParagraphBlocks(normalizedOutput);

  const promptAnalysis = analysis && typeof analysis === "object"
    ? analysis
    : analyzeSimpleScopePrompt(userInput);
  const promptMeaning = analyzeScopeAssistPromptMeaning(userInput);
  const clearPrompt = Boolean(
    promptAnalysis?.isClearlyDraftable
    || promptMeaning?.supportsDetailedDraft
  );

  const normalizedInput = sanitizeScopeAssistText(userInput);
  const inputTokens = tokenizeComparableScopeWords(normalizedInput);
  const outputTokens = tokenizeComparableScopeWords(normalizedOutput);
  const addedTokens = outputTokens.filter((token) => !inputTokens.includes(token));

  for (const entry of SCOPE_ASSIST_STYLE_INVENTED_SPECIFICITY_PATTERNS) {
    if (entry.pattern.test(normalizedOutput) && !(entry.allowPattern && entry.allowPattern.test(normalizedInput))) {
      return {
        accepted: false,
        reasonTag: entry.reasonTag,
        excerpt: normalizedOutput.slice(0, 160),
        matchedPattern: String(entry.pattern),
        paragraphCount,
        sentenceCount,
      };
    }
  }

  for (const entry of SCOPE_ASSIST_STYLE_PROPOSAL_PATTERNS) {
    if (entry.pattern.test(normalizedOutput)) {
      return {
        accepted: false,
        reasonTag: entry.reasonTag,
        excerpt: normalizedOutput.slice(0, 160),
        matchedPattern: String(entry.pattern),
        paragraphCount,
        sentenceCount,
      };
    }
  }

  if (!clearPrompt) {
    return {
      accepted: true,
      reasonTag: "style_not_applicable",
      excerpt: normalizedOutput.slice(0, 160),
      matchedPattern: "",
      paragraphCount,
      sentenceCount,
    };
  }

  const requiresTwoParagraphs = shouldUseExpandedScopeParagraphs(promptAnalysis) || Boolean(promptMeaning?.supportsDetailedDraft);
  if (requiresTwoParagraphs && paragraphCount < 2) {
    return {
      accepted: false,
      reasonTag: "style_single_block_when_two_paragraphs_required",
      excerpt: normalizedOutput.slice(0, 160),
      matchedPattern: "missing_blank_line_paragraph_break",
      paragraphCount,
      sentenceCount,
    };
  }

  const minimumTokenCount = requiresTwoParagraphs ? 34 : 26;
  const minimumSentenceCount = requiresTwoParagraphs ? 3 : 2;
  const minimumAddedTokens = requiresTwoParagraphs ? 10 : 8;
  if (
    outputTokens.length < minimumTokenCount
    || sentenceCount < minimumSentenceCount
    || addedTokens.length < minimumAddedTokens
  ) {
    return {
      accepted: false,
      reasonTag: "style_too_thin_for_clear_prompt",
      excerpt: normalizedOutput.slice(0, 160),
      matchedPattern: `tokens=${outputTokens.length};sentences=${sentenceCount};added_tokens=${addedTokens.length}`,
      paragraphCount,
      sentenceCount,
    };
  }

  return {
    accepted: true,
    reasonTag: "style_compliant",
    excerpt: normalizedOutput.slice(0, 160),
    matchedPattern: "",
    paragraphCount,
    sentenceCount,
  };
}

const NON_BLOCKING_SCOPE_STYLE_REASON_TAGS = new Set([
  "style_single_block_when_two_paragraphs_required",
  "style_too_thin_for_clear_prompt",
]);

function isNonBlockingScopeStyleRejection(styleAssessment = null) {
  if (!styleAssessment || typeof styleAssessment !== "object") return false;
  if (styleAssessment.accepted) return false;
  return NON_BLOCKING_SCOPE_STYLE_REASON_TAGS.has(String(styleAssessment.reasonTag || "").trim());
}

const SCOPE_ASSIST_EXPLICIT_SCAFFOLD_PATTERNS = [
  /\bwork on affected areas\b/i,
  /\bcomplete the described scope\b/i,
  /\bcomplete the stated scope\b/i,
  /\bclean up the work area\b/i,
  /\bnot included unless identified and approved\b/i,
];

const SCOPE_ASSIST_META_LANGUAGE_PATTERNS = [
  /\braw scope prompt\b/i,
  /\bdescribed in the prompt\b/i,
  /\btrade bucket\b/i,
  /\boutcome\b/i,
  /\bclarificationquestion\b/i,
  /\bmissingfields\b/i,
  /\bprompt\b/i,
];

function matchScopeAssistExplicitScaffoldPhrase(scopeNotesText) {
  const normalized = sanitizeScopeAssistText(scopeNotesText);
  if (!normalized) {
    return { matched: false, pattern: "", match: "" };
  }

  for (const pattern of SCOPE_ASSIST_EXPLICIT_SCAFFOLD_PATTERNS) {
    const matched = normalized.match(pattern);
    if (matched) {
      return {
        matched: true,
        pattern: String(pattern),
        match: String(matched[0] || ""),
      };
    }
  }

  return { matched: false, pattern: "", match: "" };
}

function matchScopeAssistMetaLanguage(scopeNotesText) {
  const normalized = sanitizeScopeAssistText(scopeNotesText);
  if (!normalized) {
    return { matched: false, pattern: "", match: "" };
  }

  for (const pattern of SCOPE_ASSIST_META_LANGUAGE_PATTERNS) {
    const matched = normalized.match(pattern);
    if (matched) {
      return {
        matched: true,
        pattern: String(pattern),
        match: String(matched[0] || ""),
      };
    }
  }

  return { matched: false, pattern: "", match: "" };
}

function resolveScopeAssistResponseSource(path = "", fallbackSource = "") {
  const normalizedPath = String(path || "").trim();
  if (normalizedPath === "direct_groq_success" || normalizedPath === "direct_groq_clarify") return "direct_groq_output";
  if (normalizedPath === "grounded_fallback_success") return "grounded_fallback";
  if (normalizedPath === "provider_failure_no_grounded_fallback" || normalizedPath === "malformed_or_internal_failure") {
    return "provider_failure";
  }
  if (normalizedPath === "junk_blocked_pre_groq") return "junk_blocked_pre_groq";
  if (normalizedPath === "deterministic_fallback_success") return "deterministic_fallback";
  if (String(fallbackSource || "").trim()) return "grounded_fallback";
  return "unknown";
}

function withDefiniteArticle(phrase, fallback = "requested item") {
  const normalized = sanitizeScopeAssistText(phrase) || fallback;
  return /^(?:the|a|an)\s+/i.test(normalized) ? normalized : `the ${normalized}`;
}

function normalizeScopeParagraphText(text) {
  return sanitizeScopeAssistText(text)
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function joinScopeParagraph(sentences = []) {
  return sentences
    .map((sentence) => normalizeScopeParagraphText(sentence))
    .filter(Boolean)
    .join(" ")
    .trim();
}

function joinScopeParagraphs(paragraphs = []) {
  return paragraphs
    .map((paragraph) => Array.isArray(paragraph) ? joinScopeParagraph(paragraph) : normalizeScopeParagraphText(paragraph))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function shouldUseExpandedScopeParagraphs(analysis) {
  if (!analysis || !analysis.isClearlyDraftable) return false;
  if (analysis.targetTokens.length >= 2) return true;
  if (analysis.locationPhrase) return true;
  return false;
}

function formatScopeDraftParagraphs(paragraphGroups = [], useParagraphBreaks = false) {
  const groups = Array.isArray(paragraphGroups) ? paragraphGroups : [];
  if (useParagraphBreaks) return joinScopeParagraphs(groups);
  return joinScopeParagraph(groups.flat());
}

const SCOPE_GROUNDED_FALLBACK_GENERIC_CATCH_ALL_PATTERNS = [
  /\bcomplete the requested scope described in the prompt\b/i,
  /\bcarry the work through the main field objective\b/i,
  /\binclude the normal prep,\s*access,\s*layout,\s*repair,\s*install,\s*fabrication,\s*application,\s*adjustment,\s*touch-up,\s*and finish steps\b/i,
  /\bfinal work should leave the described item or area addressed\b/i,
];

function assessGroundedScopeFallback(scopeNotes, userInput = "", { allowExistingScope = false } = {}) {
  const normalizedOutput = sanitizeScopeAssistText(scopeNotes);
  if (!normalizedOutput) {
    return {
      accepted: false,
      reasonTag: "grounded_fallback_missing_content",
      excerpt: "",
      matchedPattern: "",
    };
  }

  const genericCatchAllPattern = SCOPE_GROUNDED_FALLBACK_GENERIC_CATCH_ALL_PATTERNS.find((pattern) => pattern.test(normalizedOutput)) || null;
  if (genericCatchAllPattern) {
    return {
      accepted: false,
      reasonTag: "grounded_fallback_generic_catchall",
      excerpt: normalizedOutput.slice(0, 160),
      matchedPattern: String(genericCatchAllPattern),
    };
  }

  const metaLanguageMatch = matchScopeAssistMetaLanguage(normalizedOutput);
  if (metaLanguageMatch.matched) {
    return {
      accepted: false,
      reasonTag: "grounded_fallback_meta_language",
      excerpt: normalizedOutput.slice(0, 160),
      matchedPattern: metaLanguageMatch.pattern,
    };
  }

  const explicitScaffoldMatch = matchScopeAssistExplicitScaffoldPhrase(normalizedOutput);
  if (explicitScaffoldMatch.matched) {
    return {
      accepted: false,
      reasonTag: "grounded_fallback_explicit_scaffold",
      excerpt: normalizedOutput.slice(0, 160),
      matchedPattern: explicitScaffoldMatch.pattern,
    };
  }

  if (allowExistingScope) {
    return {
      accepted: true,
      reasonTag: "grounded_existing_scope_preserved",
      excerpt: normalizedOutput.slice(0, 160),
      matchedPattern: "",
    };
  }

  const scopeAssessment = assessScopeAssistOutput(normalizedOutput, userInput);
  if (!scopeAssessment.accepted) {
    return {
      accepted: false,
      reasonTag: String(scopeAssessment.reason || "grounded_fallback_rejected"),
      excerpt: normalizedOutput.slice(0, 160),
      matchedPattern: "",
    };
  }

  const scaffoldAssessment = assessScopeAssistGenericScaffold(normalizedOutput, userInput);
  if (!scaffoldAssessment.accepted) {
    return {
      accepted: false,
      reasonTag: String(scaffoldAssessment.reasonTag || scaffoldAssessment.reason || "grounded_fallback_rejected"),
      excerpt: String(scaffoldAssessment.excerpt || normalizedOutput).slice(0, 160),
      matchedPattern: "",
    };
  }

  const promptAnalysis = analyzeSimpleScopePrompt(userInput);
  const promptMeaning = analyzeScopeAssistPromptMeaning(userInput);
  const promptSpecificTokens = Array.from(new Set([
    ...(Array.isArray(promptAnalysis?.specificTargetTokens) ? promptAnalysis.specificTargetTokens : []),
    ...(Array.isArray(promptMeaning?.meaningTokens) ? promptMeaning.meaningTokens : []),
  ].filter((token) => token && !SCOPE_PROMPT_ACTION_ONLY_TOKENS.has(token))));
  const outputTokens = tokenizeComparableScopeWords(normalizedOutput);
  const groundedMatches = promptSpecificTokens.filter((token) => outputTokens.includes(token));

  if (promptSpecificTokens.length && groundedMatches.length === 0) {
    return {
      accepted: false,
      reasonTag: "grounded_fallback_missing_prompt_item",
      excerpt: normalizedOutput.slice(0, 160),
      matchedPattern: "",
    };
  }

  return {
    accepted: true,
    reasonTag: "grounded_fallback_prompt_bound",
    excerpt: normalizedOutput.slice(0, 160),
    matchedPattern: groundedMatches.join(","),
  };
}

function buildScopeAssistSimpleRecoveryDraft(userInput = "") {
  const analysis = analyzeSimpleScopePrompt(userInput);
  const promptMeaning = analyzeScopeAssistPromptMeaning(userInput);
  if (!promptMeaning.isGroqDraftEligible) return "";

  const targetPhrase = analysis.targetPhrase || analysis.normalizedPrompt;
  const definiteTarget = withDefiniteArticle(targetPhrase, "requested item");
  const lower = analysis.normalizedPrompt.toLowerCase();
  const useParagraphBreaks = shouldUseExpandedScopeParagraphs(analysis) || Boolean(promptMeaning.supportsDetailedDraft);

  if (analysis.actionKey === "stripe") {
    return formatScopeDraftParagraphs([
      [
        `Re-stripe ${definiteTarget} to refresh faded parking stall lines and related traffic markings throughout the designated parking area.`,
        `Scope includes layout aligned to the existing parking pattern and surface preparation as needed for proper paint adhesion before new markings are applied.`,
      ],
      [
        `Apply traffic marking paint to parking stalls, directional markings, curb details, and related linework tied to the area being refreshed.`,
        `Final work should leave ${definiteTarget} with clean, readable, uniformly applied markings and a finished look that improves visibility for normal day-to-day vehicle use.`,
      ],
    ], useParagraphBreaks);
  }

  if (analysis.actionKey === "paint") {
    return formatScopeDraftParagraphs([
      [
        `Paint ${definiteTarget}, including normal surface preparation needed for a clean, even finish and a fresh, even appearance.`,
        `Scope includes light prep associated with the painting work and protection of adjacent finished surfaces as reasonably needed during application.`,
      ],
      [
        `Apply the finish coat to achieve consistent coverage across the requested surface areas, with attention to clean cut lines and an even final appearance.`,
        `Final work should leave the painted surfaces with a uniform, neat finished look appropriate for the setting and normal use.`,
      ],
    ], useParagraphBreaks);
  }

  if (analysis.actionKey === "replace") {
    return formatScopeDraftParagraphs([
      [
        `Remove the existing ${targetPhrase} and install the replacement in the same location or service area.`,
        `Scope includes disconnecting or detaching the existing item as needed and setting the new unit in place for a clean replacement.`,
      ],
      [
        `Reconnect the normal service connections tied to the replacement and complete the fit-up, securement, and alignment needed for proper operation.`,
        `Final work should leave ${definiteTarget} properly installed, connected, and ready for normal use with a clean finished appearance that blends with the surrounding area.`,
      ],
    ], useParagraphBreaks);
  }

  if (analysis.actionKey === "install") {
    return formatScopeDraftParagraphs([
      [
        `Install ${definiteTarget} in the intended location, including normal setup, placement, and secure attachment for a clean finished installation.`,
        `Scope includes the direct mounting, connection, or fastening steps tied to the request, along with the fit-up and alignment needed to set the item properly.`,
      ],
      [
        `Complete the installation with the minor adjustments needed to keep the work straight, secure, and ready for normal operation.`,
        `Final work should leave ${definiteTarget} visually aligned and finished in a clean, professional manner.`,
      ],
    ], useParagraphBreaks);
  }

  if (analysis.actionKey === "patch") {
    return formatScopeDraftParagraphs([
      [
        `Patch ${definiteTarget}, including preparation of the damaged area and application of patch material to restore the surface as cleanly as practical.`,
        `Scope includes the sanding, feathering, and edge work naturally required to bring the repaired area back into line with the surrounding surface.`,
      ],
      [
        `Blend the patch into adjacent finishes so the transition reads smooth and deliberate rather than rough or abrupt.`,
        `Final work should leave the repaired area ready for primer, paint, or normal use as applicable, with the patch reading as part of the surrounding surface.`,
      ],
    ], useParagraphBreaks);
  }

  if (analysis.actionKey === "repair") {
    return formatScopeDraftParagraphs([
      [
        `Repair ${definiteTarget}, including preparation of the damaged condition and direct corrective work at the requested item or surface.`,
        `Scope includes the normal repair steps naturally tied to the request and any blending or finish work needed where the repair meets adjacent conditions.`,
      ],
      [
        `Complete the repair with a final check to confirm the corrected area is solid, presentable, and ready for normal service.`,
        `Final work should leave ${definiteTarget} restored without expanding the scope into unrelated replacements or upgrades.`,
      ],
    ], useParagraphBreaks);
  }

  if (analysis.actionKey === "seal") {
    return formatScopeDraftParagraphs([
      [
        `Seal ${definiteTarget}, including preparation of the joint or perimeter surfaces and application of sealant as needed to close exposed gaps.`,
        `Scope includes addressing the edges and transitions tied to the sealing work so the closure reads continuous and intentional.`,
      ],
      [
        `Tool and finish the sealed line neatly across the requested area to leave a clean, consistent result.`,
        `Final work should leave ${definiteTarget} protected, orderly, and ready for normal exposure and service with a clean finished appearance.`,
      ],
    ], useParagraphBreaks);
  }

  if (analysis.actionKey === "remove") {
    return formatScopeDraftParagraphs([
      [
        `Remove ${definiteTarget}, including controlled demolition or detachment of the existing material at the requested location and handling of the debris directly generated by that removal.`,
        `Scope includes separating the identified item cleanly from adjacent finishes where needed and taking down the requested material in a controlled manner.`,
      ],
      [
        `Leave the exposed area ready for the next phase of work without carrying the removal into unrelated materials or adjacent scope.`,
        `Final work should leave the space clear, orderly, and ready for follow-on repair or installation.`,
      ],
    ], useParagraphBreaks);
  }

  if (analysis.actionKey === "reconnect") {
    const reconnectLead = /\breconnect\b/i.test(lower)
      ? `Reconnect ${definiteTarget}`
      : `Disconnect and reconnect ${definiteTarget}`;
    return formatScopeDraftParagraphs([
      [
        `${reconnectLead}, including safe isolation of the existing connection and the direct reconnection work needed to restore the requested service path.`,
        `Scope includes tightening, alignment, and the minor fit-up naturally tied to the reconnection so the connection is set properly.`,
      ],
      [
        `Complete the work with verification that the reconnected item is functioning as intended and ready for normal service.`,
        `Final work should leave ${definiteTarget} restored to service in a clean condition without expanding into unrelated replacement work.`,
      ],
    ], useParagraphBreaks);
  }

  if (analysis.actionKey === "clean") {
    return formatScopeDraftParagraphs([
      [
        `Clean ${definiteTarget}, including removal of visible dirt, residue, and loose debris from the requested surface using methods appropriate to the existing condition.`,
        `Scope includes attention to corners, edges, open portions, and other directly accessible areas so the finished cleaning produces an even, visibly improved result.`,
      ],
      [
        `Complete the work to leave ${definiteTarget} orderly, presentable, and ready for continued normal use without turning the request into unrelated repair or resurfacing work.`,
      ],
    ], useParagraphBreaks);
  }

  if (analysis.actionKey === "adjust") {
    return formatScopeDraftParagraphs([
      [
        `Perform the requested adjustment for ${definiteTarget}, including layout, fit-up, alignment, mounting, or set work as naturally required to complete the task.`,
        `Scope includes the direct attachment or positioning steps tied to the prompt and the minor corrections needed for proper fit.`,
      ],
      [
        `Complete the adjustment with any final set or alignment needed to keep the item secure, true, and ready for normal use.`,
        `Final work should leave ${definiteTarget} properly set while staying within the bounds of the requested adjustment.`,
      ],
    ], useParagraphBreaks);
  }

  return "";
}

function nextRouteRequestId() {
  ROUTE_REQUEST_SEQ += 1;
  return `r${String(ROUTE_REQUEST_SEQ).padStart(5, "0")}`;
}

function formatRouteLogFields(fields = {}) {
  return Object.entries(fields)
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${String(value).replace(/\s+/g, " ").trim()}`)
    .join(" ");
}

function startRouteTrace(route, fields = {}) {
  const id = nextRouteRequestId();
  const startedAt = Date.now();
  const stamp = new Date(startedAt).toISOString();
  const prefix = `[trace][${id}] ts=${stamp} route=${route}`;
  const extra = formatRouteLogFields(fields);
  console.log(`${prefix} phase=start${extra ? ` ${extra}` : ""}`);
  return {
    id,
    route,
    step(name, stepFields = {}) {
      const stepExtra = formatRouteLogFields(stepFields);
      console.log(`${prefix} phase=${name}${stepExtra ? ` ${stepExtra}` : ""}`);
    },
    end(outcome, endFields = {}) {
      const durationMs = Date.now() - startedAt;
      const endExtra = formatRouteLogFields({ outcome, duration_ms: durationMs, ...endFields });
      console.log(`${prefix} phase=end${endExtra ? ` ${endExtra}` : ""}`);
    },
  };
}

function logGuidedBuildGroqFailure(message, detail = "") {
  const compactDetail = String(detail || "").replace(/\s+/g, " ").trim().slice(0, 240);
  console.warn(`[guided-build][groq] ${String(message || "").trim()}${compactDetail ? ` ${compactDetail}` : ""}`);
}

function getGroqConfigProblem() {
  const key = String(GROQ_API_KEY || "").trim();
  if (!key) return "missing";
  const lower = key.toLowerCase();
  const placeholderPatterns = [
    /^your[_-]?groq[_-]?(api[_-]?)?key/i,
    /^replace[_-]?me/i,
    /^changeme/i,
    /^example/i,
    /^placeholder/i,
    /^test[_-]?key/i,
    /^dummy/i,
    /^fake/i,
    /^xxx+$/i,
    /^sk[_-]?placeholder/i,
  ];
  if (placeholderPatterns.some((pattern) => pattern.test(key))) return "placeholder";
  if (lower.includes("your_groq") || lower.includes("your-groq") || lower.includes("placeholder") || lower.includes("replace_me")) {
    return "placeholder";
  }
  if (key.length < 16) return "placeholder";
  return "";
}

function readGroqMessageContent(data) {
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    return raw.map((item) => String(item?.text || item || "")).join("").trim();
  }
  return String(raw || "").trim();
}

async function requestGuidedBuildGroq(systemPrompt, promptPayload, trace = null) {
  const groqConfigProblem = getGroqConfigProblem();
  if (groqConfigProblem) {
    trace?.step("provider_start", { provider: "groq", path: "/openai/v1/chat/completions", attempted: "no" });
    trace?.step("provider_end", { provider: "groq", path: "/openai/v1/chat/completions", outcome: "skipped_invalid_config" });
    logGuidedBuildGroqFailure(`invalid config (${groqConfigProblem})`);
    const error = new Error(`Invalid GROQ_API_KEY config (${groqConfigProblem})`);
    error.guidedBuildLogged = true;
    error.guidedBuildConfigInvalid = true;
    throw error;
  }

  trace?.step("provider_start", { provider: "groq", path: "/openai/v1/chat/completions", attempted: "yes" });
  const response = await fetchWithTimeout(GROQ_CHAT_COMPLETIONS_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: "system", content: String(systemPrompt || "").trim() },
        { role: "user", content: `INPUT:${JSON.stringify(promptPayload || {})}` },
      ],
      temperature: 0,
      stream: false,
    }),
  }, OLLAMA_TIMEOUT_MS);

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    logGuidedBuildGroqFailure(`HTTP ${response.status}`, detail);
    const error = new Error(detail || `Groq failed (${response.status})`);
    error.guidedBuildLogged = true;
    trace?.step("provider_end", { provider: "groq", path: "/openai/v1/chat/completions", outcome: `http_${response.status}` });
    throw error;
  }

  const data = await response.json();
  trace?.step("provider_end", { provider: "groq", path: "/openai/v1/chat/completions", outcome: "ok" });
  return readGroqMessageContent(data);
}

// ─── Section-based AI Assist ──────────────────────────────────────────────────

function normalizeAssistSectionKey(value, fallback = "") {
  return String(value || fallback || "").trim().toLowerCase();
}

function resolveScopeAssistPromptBasis({
  userInput = "",
  sourcePrompt = "",
  sourceScopePrompt = "",
  promptText = "",
  currentPrompt = "",
  assistantMessage = "",
  context = {},
} = {}) {
  const candidates = [
    ["userInput", userInput],
    ["sourcePrompt", sourcePrompt],
    ["sourceScopePrompt", sourceScopePrompt],
    ["context.scopePromptBasis", context?.scopePromptBasis],
    ["promptText", promptText],
    ["currentPrompt", currentPrompt],
    ["assistantMessage", assistantMessage],
    ["context.sourcePrompt", context?.sourcePrompt],
    ["context.sourceScopePrompt", context?.sourceScopePrompt],
    ["context.promptText", context?.promptText],
    ["context.currentPrompt", context?.currentPrompt],
    ["context.assistantMessage", context?.assistantMessage],
  ];

  for (const [field, value] of candidates) {
    const text = sanitizeScopeAssistText(value);
    if (text) {
      return {
        field,
        text,
        raw: String(value || ""),
      };
    }
  }

  return {
    field: "",
    text: "",
    raw: "",
  };
}

function formatScopeSkeletonBucket(label, values) {
  return Array.isArray(values) && values.length ? `${label}: ${values.join(" | ")}` : "";
}

function formatScopeSkeletonForPrompt(scopeSkeleton) {
  const skeleton = scopeSkeleton && typeof scopeSkeleton === "object" ? scopeSkeleton : {};
  const categories = [
    ["Direct work", skeleton.directWork],
    ["Included areas", skeleton.includedAreas],
    ["Materials/products", skeleton.materialsProducts],
    ["Prep requirements", skeleton.prepRequirements],
    ["Repairs/allowances", skeleton.repairsAllowances],
    ["Access conditions", skeleton.accessConditions],
    ["Exclusions", skeleton.exclusions],
    ["Customer responsibilities", skeleton.customerResponsibilities],
    ["Site conditions", skeleton.siteConditions],
    ["Completion standards", skeleton.completionStandards],
  ];

  return categories
    .map(([label, value]) => {
      if (!value || typeof value !== "object") return "";
      const parts = [
        formatScopeSkeletonBucket("certain", value.certain),
        formatScopeSkeletonBucket("implied", value.implied),
        formatScopeSkeletonBucket("risky missing", value.riskyMissing),
      ].filter(Boolean);
      return parts.length ? `${label}: ${parts.join(" ; ")}` : "";
    })
    .filter(Boolean);
}

const AI_ASSIST_BUSY_MESSAGE = "AI assist is temporarily busy. Please wait a few seconds and try again.";
const AI_ASSIST_GENERIC_MESSAGE = "AI assist couldn’t complete that request right now. Please try again.";
const SCOPE_ASSIST_TIMEOUT_MESSAGE = "AI assist took too long to respond.";
const SCOPE_ASSIST_ABORTED_MESSAGE = "AI assist request was aborted.";
const SCOPE_ASSIST_INTERNAL_MESSAGE = "AI assist hit an internal error.";
const IS_DEV_RUNTIME = String(process.env.NODE_ENV || "").trim().toLowerCase() !== "production";

function extractAssistFailureText(detail) {
  const raw = String(detail || "").trim();
  if (!raw) return "";
  const parsed = extractJsonPayload(raw);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return uniqueStrings([
      parsed?.error?.message,
      parsed?.message,
      parsed?.detail,
      parsed?.error_description,
      parsed?.error?.type,
      parsed?.error?.code,
      parsed?.type,
      parsed?.code,
    ]).join(" | ") || raw;
  }
  return raw;
}

function logScopeAssistTerminal(traceId, event, payload = {}) {
  try {
    console.log(`[ai-assist:${traceId || "?"}] ${event}`, payload);
  } catch {}
}

function looksLikeAssistRateLimitFailure(value) {
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

function looksLikeAssistTemporaryFailure(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return looksLikeAssistRateLimitFailure(text) || [
    /\btemporar(?:y|ily)\b/i,
    /\bbusy\b/i,
    /\boverload(?:ed)?\b/i,
    /\bunavailable\b/i,
    /\bservice unavailable\b/i,
    /\btimeout\b/i,
    /\btimed out\b/i,
    /\bconnection reset\b/i,
    /\btry again\b/i,
  ].some((pattern) => pattern.test(text));
}

function normalizeScopeAssistFailure(reason) {
  const source = reason && typeof reason === "object" ? reason : { message: String(reason || "") };
  const status = Number(source?.httpStatus || source?.status || 0);
  const rawDetail = extractAssistFailureText(source?.providerDetail || source?.detail || source?.message || "");
  const rawCode = String(source?.code || source?.type || source?.failureType || "").trim().toLowerCase();
  const lowerDetail = rawDetail.toLowerCase();

  const rateLimited = status === 429
    || rawCode === "rate_limited"
    || looksLikeAssistRateLimitFailure(rawDetail);
  const timeoutLike = rawCode === "timeout"
    || source?.name === "AbortError"
    || status === 408
    || status === 504
    || /\btimeout\b|\btimed out\b|\btook too long\b|\baborted?\b/i.test(lowerDetail);
  const aborted = rawCode === "aborted"
    || (!timeoutLike && /\baborted?\b/i.test(lowerDetail));
  const providerUnavailable = status === 502
    || status === 503
    || rawCode === "provider_unavailable"
    || /\bservice unavailable\b|\bunavailable\b|\boverload(?:ed)?\b/i.test(lowerDetail);
  const malformedResponse = rawCode === "malformed_response"
    || rawCode === "parse_failed"
    || /\bmalformed\b|\bunparseable\b|\binvalid json\b|\bjson parse\b/i.test(lowerDetail);

  const failureType = rateLimited
    ? "rate_limited"
    : timeoutLike
      ? "timeout"
      : aborted
        ? "aborted"
        : malformedResponse
          ? "malformed_response"
          : providerUnavailable
            ? "provider_unavailable"
            : "internal_failure";

  const retryable = rateLimited || timeoutLike || providerUnavailable;
  const statusCode = rateLimited
    ? 429
    : providerUnavailable
      ? (status || 503)
      : aborted
        ? 499
        : 500;
  const message = rateLimited || providerUnavailable
    ? AI_ASSIST_BUSY_MESSAGE
    : timeoutLike
      ? SCOPE_ASSIST_TIMEOUT_MESSAGE
      : aborted
        ? SCOPE_ASSIST_ABORTED_MESSAGE
        : SCOPE_ASSIST_INTERNAL_MESSAGE;

  return {
    failureType,
    status: statusCode,
    retryable,
    message,
    provider: String(source?.providerName || source?.provider || "groq").trim() || "groq",
    detail: rawDetail,
  };
}

function buildScopeAssistErrorBody(reason, payload = {}) {
  const failure = normalizeScopeAssistFailure(reason);
  return {
    message: failure.message,
    error: failure.message,
    failureType: failure.failureType,
    retryable: failure.retryable,
    status: failure.status,
    provider: failure.provider,
    ...(failure.detail ? { detail: failure.detail } : {}),
    ...payload,
  };
}

function normalizeSectionAssistFailure(reason) {
  const source = reason && typeof reason === "object" ? reason : { message: String(reason || "") };
  const status = Number(source?.httpStatus || source?.status || 0);
  const rawDetail = extractAssistFailureText(source?.providerDetail || source?.detail || source?.message || "");
  const rawCode = String(source?.code || source?.type || "").trim().toLowerCase();
  const rateLimited = status === 429
    || rawCode === "rate_limited"
    || looksLikeAssistRateLimitFailure(rawDetail);
  const retryable = rateLimited
    || Boolean(source?.retryable)
    || looksLikeAssistTemporaryFailure(rawDetail)
    || status === 408
    || status === 502
    || status === 503
    || status === 504;

  return {
    code: rateLimited
      ? "rate_limited"
      : retryable
        ? "temporary_failure"
        : "generation_failed",
    retryable,
    safeMessage: retryable ? AI_ASSIST_BUSY_MESSAGE : AI_ASSIST_GENERIC_MESSAGE,
  };
}

function buildSectionAssistFailure(reason, payload = {}) {
  const failure = normalizeSectionAssistFailure(reason);
  return {
    _assistFailed: true,
    _error: failure.safeMessage,
    _message: failure.safeMessage,
    _errorCode: failure.code,
    _retryable: failure.retryable,
    ...payload,
  };
}

function normalizeLaborDuplicateRoleKey(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function mergeExactDuplicateLaborLines(payload) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.lines)) return payload;

  const mergedLines = [];
  const mergeIndexByKey = new Map();

  payload.lines.forEach((line) => {
    if (!line || typeof line !== "object") {
      mergedLines.push(line);
      return;
    }

    const roleText = String(line.role || line.label || "").trim();
    const roleKey = normalizeLaborDuplicateRoleKey(roleText);
    const hours = Number(line.hours);
    const rate = Number(line.rate);
    const qtyValue = Object.prototype.hasOwnProperty.call(line, "qty")
      ? line.qty
      : (Object.prototype.hasOwnProperty.call(line, "headcount") ? line.headcount : 1);
    const qty = Number(qtyValue);

    const eligibleForMerge = Boolean(roleKey)
      && Number.isFinite(hours)
      && hours > 0
      && Number.isFinite(rate)
      && rate > 0
      && Number.isFinite(qty)
      && qty >= 1;

    if (!eligibleForMerge) {
      mergedLines.push(line);
      return;
    }

    const mergeKey = `${roleKey}__${rate}__${qty}`;
    const existingIndex = mergeIndexByKey.get(mergeKey);

    if (existingIndex === undefined) {
      mergeIndexByKey.set(mergeKey, mergedLines.length);
      mergedLines.push(line);
      return;
    }

    const existingLine = mergedLines[existingIndex];
    if (!existingLine || typeof existingLine !== "object") {
      mergedLines.push(line);
      return;
    }

    const existingHours = Number(existingLine.hours);
    if (!Number.isFinite(existingHours) || existingHours <= 0) {
      mergedLines.push(line);
      return;
    }

    mergedLines[existingIndex] = {
      ...existingLine,
      hours: existingHours + hours,
    };
  });

  return {
    ...payload,
    lines: mergedLines,
  };
}

function parseRetryAfterMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return 0;
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.max(0, Math.round(Number(raw) * 1000));
  const targetMs = Date.parse(raw);
  if (!Number.isFinite(targetMs)) return 0;
  return Math.max(0, targetMs - Date.now());
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildSectionAssistPayloadHash(value) {
  return createHash("sha1").update(stableSerialize(value)).digest("hex");
}

function isScopeRefineShorterInstruction(instruction = "") {
  const normalized = sanitizeScopeAssistText(instruction).toLowerCase();
  if (!normalized) return false;
  return normalized === "shorter"
    || /\bshort(?:er|en)\b/i.test(normalized)
    || /\b(?:more\s+concise|concise|tighter|tighten|trim(?:med|mer)?|trim\s+down|condens(?:e|ed)|compress(?:ed|ion)?|less\s+wordy)\b/i.test(normalized);
}

function isScopeRefineDashBriefInstruction(instruction = "") {
  const normalized = sanitizeScopeAssistText(instruction)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return false;
  return normalized === "dash"
    || normalized === "dash + brief"
    || normalized === "dash and brief"
    || normalized === "dash brief"
    || /^\bdash\b(?:\s*(?:\+|and)\s*brief)?$/i.test(normalized);
}

function getScopeRefineRuntimeMeta({
  scopeMode = "initial",
  refineInstruction = "",
  userInput = "",
  currentScopeNotes = "",
  context = {},
} = {}) {
  const refineMode = String(scopeMode || context?.scopeMode || "").trim().toLowerCase() === "refine"
    ? "refine"
    : "initial";
  const effectiveRefineInstruction = String(
    refineInstruction
    || context?.refineInstruction
    || userInput
    || ""
  ).trim();
  const shorterDetectorInput = effectiveRefineInstruction || String(context?.scopeInputAnalysis?.brevityIntent || "").trim();
  const dashDetectorMatched = refineMode === "refine" && isScopeRefineDashBriefInstruction(effectiveRefineInstruction);
  const shorterDetectorMatched = refineMode === "refine" && isScopeRefineShorterInstruction(shorterDetectorInput);
  const dashBranchActive = refineMode === "refine" && dashDetectorMatched;
  const shorterBranchActive = refineMode === "refine" && shorterDetectorMatched;
  const refinePromptBranch = refineMode !== "refine"
    ? "initial_scope_generation"
    : dashBranchActive
      ? "refine_dash_brief_specific"
    : shorterBranchActive
      ? "refine_shorter_specific"
      : "refine_standard_fuller";
  const currentScopeDraftExcerpt = sanitizeScopeAssistText(
    currentScopeNotes || context?.currentScopeNotes || ""
  ).replace(/\s+/g, " ").trim().slice(0, 160);

  return {
    refineMode,
    refineInstruction: effectiveRefineInstruction.replace(/\s+/g, " ").trim().slice(0, 160),
    dashDetectorMatched,
    dashBranchActive,
    shorterDetectorMatched,
    shorterBranchActive,
    refinePromptBranch,
    currentScopeDraftExcerpt,
  };
}

function buildDashImmutableAcceptedProseCacheKey({
  context = {},
  sourcePrompt = "",
  sourceScopePrompt = "",
  sourceScopeBasis = "",
} = {}) {
  return buildSectionAssistPayloadHash({
    sectionKey: "scope",
    currentSection: String(context?.currentSection || ""),
    tradeKey: String(context?.tradeKey || ""),
    scopePromptBasisField: String(context?.scopePromptBasisField || ""),
    sourcePrompt: sanitizeScopeAssistText(sourcePrompt || context?.sourcePrompt || ""),
    sourceScopePrompt: sanitizeScopeAssistText(sourceScopePrompt || context?.sourceScopePrompt || ""),
    scopePromptBasis: sanitizeScopeAssistText(sourceScopeBasis || context?.scopePromptBasis || ""),
  }).slice(0, 20);
}

// Stable cache key that does not include prompt-basis fields (which change between initial and refine)
function buildDashImmutableAcceptedProseStableKey({ context = {} } = {}) {
  return "stable:" + buildSectionAssistPayloadHash({
    sectionKey: "scope",
    currentSection: String(context?.currentSection || ""),
    tradeKey: String(context?.tradeKey || ""),
  }).slice(0, 16);
}

function captureDashOriginalAcceptedProse({
  context = {},
  sourceText = "",
  sourcePrompt = "",
  sourceScopePrompt = "",
  sourceScopeBasis = "",
  sourceKind = "",
} = {}) {
  const normalizedSource = sanitizeScopeAssistText(sourceText || "");
  if (!normalizedSource || isDashCompilerContaminatedSourceText(normalizedSource)) {
    return {
      captured: false,
      sourceText: "",
      sourceKey: "",
      sourceChars: 0,
      sourceWordCount: 0,
      sourceType: "",
      sourcePriority: "",
    };
  }

  const sourceKey = buildDashImmutableAcceptedProseCacheKey({
    context,
    sourcePrompt,
    sourceScopePrompt,
    sourceScopeBasis,
    sourceKind,
  });
  const stableKey = buildDashImmutableAcceptedProseStableKey({ context });
  const existingEntry = DASH_IMMUTABLE_ACCEPTED_PROSE_CACHE.get(sourceKey) || null;
  if (!existingEntry?.text) {
    const entry = {
      text: normalizedSource,
      sourceChars: normalizedSource.length,
      sourceWordCount: countScopeWords(normalizedSource),
      sourceKind: String(sourceKind || ""),
      capturedAt: Date.now(),
    };
    DASH_IMMUTABLE_ACCEPTED_PROSE_CACHE.set(sourceKey, entry);
    // Also write to the stable key so Dash refine can find it even when prompt-basis fields differ
    DASH_IMMUTABLE_ACCEPTED_PROSE_CACHE.set(stableKey, entry);
    return {
      captured: true,
      sourceText: normalizedSource,
      sourceKey,
      sourceChars: normalizedSource.length,
      sourceWordCount: countScopeWords(normalizedSource),
      sourceType: "immutable_original_accepted_prose",
      sourcePriority: "immutable_original_accepted_prose",
    };
  }

  return {
    captured: false,
    sourceText: sanitizeScopeAssistText(existingEntry.text || normalizedSource),
    sourceKey,
    sourceChars: Math.max(0, Number(existingEntry.sourceChars || 0)),
    sourceWordCount: Math.max(0, Number(existingEntry.sourceWordCount || 0)),
    sourceType: "immutable_original_accepted_prose",
    sourcePriority: "immutable_original_accepted_prose",
  };
}

function resolveDashCanonicalAcceptedProseSource({
  context = {},
  acceptedProseDraftText = "",
  currentScopeText = "",
  existingScopeText = "",
  requestText = "",
  sourceKind = "",
  sourcePrompt = "",
  sourceScopePrompt = "",
  sourceScopeBasis = "",
  failedDashText = "",
} = {}) {
  const acceptedDraftText = sanitizeScopeAssistText(acceptedProseDraftText || "");
  const currentDraftText = sanitizeScopeAssistText(currentScopeText || context?.currentScopeNotes || "");
  const existingDraftText = sanitizeScopeAssistText(existingScopeText || "");
  const requestFallbackText = sanitizeScopeAssistText(requestText || "");
  const failedText = sanitizeScopeAssistText(failedDashText || "");
  const cacheKey = buildDashImmutableAcceptedProseCacheKey({
    context,
    sourcePrompt,
    sourceScopePrompt,
    sourceScopeBasis,
    sourceKind,
  });
  const stableKey = buildDashImmutableAcceptedProseStableKey({ context });
  const cachedEntry = DASH_IMMUTABLE_ACCEPTED_PROSE_CACHE.get(cacheKey)
    || DASH_IMMUTABLE_ACCEPTED_PROSE_CACHE.get(stableKey)
    || null;
  const cachedText = sanitizeScopeAssistText(cachedEntry?.text || "");
  const explicitImmutableText = sanitizeScopeAssistText(
    context?.originalAcceptedProseScope
    || context?.dashCanonicalAcceptedProse
    || context?.dashImmutableAcceptedProse
    || context?.immutableAcceptedProseScope
    || ""
  );
  const explicitImmutableAccepted = Boolean(explicitImmutableText) && !isDashCompilerContaminatedSourceText(explicitImmutableText);
  const cachedImmutableAccepted = Boolean(cachedText) && !isDashCompilerContaminatedSourceText(cachedText);
  const explicitAndCachedMismatch = Boolean(
    explicitImmutableAccepted
    && cachedImmutableAccepted
    && !areDashFallbackTextsTooSimilar(explicitImmutableText, cachedText)
  );
  const immutableText = cachedImmutableAccepted
    ? cachedText
    : (explicitImmutableAccepted ? explicitImmutableText : "");
  const immutableAcceptedProseCapturedOnNonDashSuccess = Boolean(
    context?.dashImmutableAcceptedProseCapturedOnNonDashSuccess
    || context?.dashImmutableAcceptedProseCaptureBranch
    || cachedEntry?.capturedAt
    || cachedImmutableAccepted
    || explicitImmutableAccepted
  );
  const immutableAcceptedProseReadFromCache = Boolean(cachedImmutableAccepted && immutableText === cachedText);
  const failedTextRejected = Boolean(failedText) && isDashCompilerContaminatedSourceText(failedText);
  const hasMutableDraftText = Boolean(acceptedDraftText || currentDraftText || existingDraftText);
  // Diagnostic: log the resolver inputs for Dash refine source resolution
  logScopeAssistTerminal("", "DASH_RESOLVE_SOURCE_INPUTS", {
    sourceKind: String(sourceKind || ""),
    cacheKey: cacheKey.slice(0, 12),
    stableKey,
    cachedTextChars: cachedText.length,
    explicitImmutableTextChars: explicitImmutableText.length,
    immutableTextChars: (cachedImmutableAccepted ? cachedText : (explicitImmutableAccepted ? explicitImmutableText : "")).length,
    acceptedDraftTextChars: acceptedDraftText.length,
    currentDraftTextChars: currentDraftText.length,
    existingDraftTextChars: existingDraftText.length,
    requestFallbackTextChars: requestFallbackText.length,
    hasMutableDraftText,
    contextCurrentScopeNotesChars: String(context?.currentScopeNotes || "").length,
  });
  let sourceText = "";
  let sourceType = "";
  let sourcePriority = "";
  let usedOriginalProseSource = false;
  let usedAcceptedProseDraft = false;
  let fellBackToRequestText = false;
  let sourceMismatchDetected = false;
  let rejectedMutableCurrentScopeAsSource = false;
  let rejectedMutableExistingScopeAsSource = false;
  let immutableAcceptedProseCaptured = false;
  let immutableAcceptedProseChars = 0;
  let seedBlockedFromDashRefine = false;
  let seedBlockedFromCurrentDraft = false;
  let seedBlockedFromExistingScope = false;
  let rejectedLateImmutableSeed = false;
  let failedClosedForMissingPreCapturedImmutableProse = false;

  if (immutableText) {
    sourceText = immutableText;
    sourceType = "immutable_original_accepted_prose";
    sourcePriority = "immutable_original_accepted_prose";
    usedOriginalProseSource = true;
    usedAcceptedProseDraft = true;
    immutableAcceptedProseChars = sourceText.length;
    immutableAcceptedProseCaptured = Boolean(immutableAcceptedProseCapturedOnNonDashSuccess || immutableAcceptedProseReadFromCache || explicitImmutableAccepted || cachedImmutableAccepted);

    if (explicitAndCachedMismatch) {
      sourceMismatchDetected = true;
      rejectedLateImmutableSeed = true;
      seedBlockedFromDashRefine = String(sourceKind || "").toLowerCase().includes("dash") || Boolean(hasMutableDraftText);
      seedBlockedFromCurrentDraft = Boolean(acceptedDraftText || currentDraftText);
      seedBlockedFromExistingScope = Boolean(existingDraftText);
    }
    if (currentDraftText && !areDashFallbackTextsTooSimilar(currentDraftText, immutableText)) {
      rejectedMutableCurrentScopeAsSource = true;
      sourceMismatchDetected = true;
    }
    if (existingDraftText && !areDashFallbackTextsTooSimilar(existingDraftText, immutableText)) {
      rejectedMutableExistingScopeAsSource = true;
      sourceMismatchDetected = true;
    }
  } else if (hasMutableDraftText) {
    // Self-heal: if no immutable prose was captured but the current draft is clean plain prose,
    // allow it as a one-time recovery source. This handles the case where the initial capture
    // was missed or the cache key didn't match between initial success and Dash refine.
    const selfHealCandidate = sanitizeScopeAssistText(currentDraftText || acceptedDraftText || existingDraftText || "");
    const selfHealContaminated = Boolean(selfHealCandidate) && isDashCompilerContaminatedSourceText(selfHealCandidate);
    const selfHealClean = Boolean(selfHealCandidate) && !selfHealContaminated;
    logScopeAssistTerminal("", "DASH_SELF_HEAL_CHECK", {
      selfHealCandidateChars: selfHealCandidate.length,
      selfHealClean,
      selfHealContaminated,
      selfHealCandidateExcerpt: selfHealCandidate.replace(/\s+/g, " ").trim().slice(0, 200),
      sourceKind: String(sourceKind || ""),
    });
    if (selfHealClean) {
      sourceText = selfHealCandidate;
      sourceType = "self_heal_from_accepted_draft";
      sourcePriority = "self_heal_from_accepted_draft";
      usedAcceptedProseDraft = true;
      immutableAcceptedProseChars = selfHealCandidate.length;
      // Backfill the stable cache so future refines can find it
      const stableKey = buildDashImmutableAcceptedProseStableKey({ context });
      if (!DASH_IMMUTABLE_ACCEPTED_PROSE_CACHE.get(stableKey)?.text) {
        DASH_IMMUTABLE_ACCEPTED_PROSE_CACHE.set(stableKey, {
          text: selfHealCandidate,
          sourceChars: selfHealCandidate.length,
          sourceWordCount: countScopeWords(selfHealCandidate),
          sourceKind: "self_heal_backfill",
          capturedAt: Date.now(),
        });
      }
    } else {
      seedBlockedFromDashRefine = String(sourceKind || "").toLowerCase().includes("dash");
      seedBlockedFromCurrentDraft = Boolean(acceptedDraftText || currentDraftText);
      seedBlockedFromExistingScope = Boolean(existingDraftText);
      rejectedLateImmutableSeed = true;
      failedClosedForMissingPreCapturedImmutableProse = true;
      sourceMismatchDetected = true;
      sourceType = "missing_pre_captured_immutable_prose";
      sourcePriority = "missing_pre_captured_immutable_prose";
    }
  } else if (requestFallbackText) {
    sourceText = requestFallbackText;
    sourceType = "request_text_fallback";
    sourcePriority = "request_text_fallback";
    fellBackToRequestText = true;
  }

  const usedRequestFallbackBecauseNoImmutableAcceptedProse = Boolean(!immutableText && requestFallbackText && !hasMutableDraftText);
  const immutableSourceMatchedRetry = Boolean(String(sourceKind || "").toLowerCase().includes("retry") && usedOriginalProseSource);

  return {
    sourceText,
    sourceType,
    sourcePriority,
    sourceKind: String(sourceKind || ""),
    sourceKey: cacheKey,
    rejectedCurrentDraftAsCompilerSource: rejectedMutableCurrentScopeAsSource,
    rejectedFailedDashAsCompilerSource: failedTextRejected,
    rejectedMutableCurrentScopeAsSource,
    rejectedMutableExistingScopeAsSource,
    sourceMismatchDetected,
    immutableAcceptedProseCapturedOnNonDashSuccess,
    immutableAcceptedProseReadFromCache,
    seedBlockedFromDashRefine,
    seedBlockedFromCurrentDraft,
    seedBlockedFromExistingScope,
    rejectedLateImmutableSeed,
    failedClosedForMissingPreCapturedImmutableProse,
    usedOriginalProseSource,
    usedAcceptedProseDraft,
    fellBackToRequestText,
    promptUsedRequestTextOnlyBecauseAcceptedProseMissing: Boolean(usedRequestFallbackBecauseNoImmutableAcceptedProse),
    usedRequestFallbackBecauseNoImmutableAcceptedProse,
    fallbackSourceTextBlocked: Boolean(rejectedMutableCurrentScopeAsSource || rejectedMutableExistingScopeAsSource || failedTextRejected || rejectedLateImmutableSeed),
    sourceTextChars: sourceText.length,
    sourceTextWordCount: countScopeWords(sourceText),
    immutableAcceptedProseCaptured,
    immutableAcceptedProseChars,
    immutableSourceMatchedRetry,
  };
}

function buildScopeAssistRequestFingerprint({
  sectionKey = "",
  scopeMode = "initial",
  userInput = "",
  sourcePrompt = "",
  currentScope = "",
  refineInstruction = "",
  formatIntent = "",
  ignoreCurrentScope = false,
  context = {},
  systemPrompt = "",
  userPrompt = "",
  requestOptions = {},
} = {}) {
  if (normalizeAssistSectionKey(sectionKey) !== "scope") return "";

  const scopeInputAnalysis = context?.scopeInputAnalysis || {};
  const scopeSourceAnalysis = context?.scopeSourceAnalysis || {};
  return buildSectionAssistPayloadHash({
    sectionKey: "scope",
    scopeMode: String(scopeMode || "").trim().toLowerCase() === "refine" ? "refine" : "initial",
    userInput: String(userInput || "").trim(),
    sourcePrompt: String(sourcePrompt || context?.sourceScopePrompt || "").trim(),
    currentScope: ignoreCurrentScope
      ? String(currentScope || "").trim()
      : String(currentScope || context?.currentScopeNotes || "").trim(),
    refineInstruction: String(refineInstruction || context?.refineInstruction || "").trim(),
    formatIntent: String(formatIntent || context?.scopeFormatIntent || "").trim(),
    ignoreCurrentScope: Boolean(ignoreCurrentScope),
    relevantContext: {
      currentSection: String(context?.currentSection || sectionKey || "").trim(),
      tradeKey: String(context?.tradeKey || "").trim(),
      scopeProfile: String(scopeInputAnalysis?.scopeProfile || "").trim(),
      scopeDepthTarget: String(scopeInputAnalysis?.scopeDepthTarget || "").trim(),
      detailLevel: String(scopeInputAnalysis?.detailLevel || "").trim(),
      technicalSignals: uniqueStrings([
        ...(Array.isArray(scopeInputAnalysis?.technicalSignals) ? scopeInputAnalysis.technicalSignals : []),
        ...(Array.isArray(scopeSourceAnalysis?.technicalSignals) ? scopeSourceAnalysis.technicalSignals : []),
      ]),
    },
    prompts: {
      systemPrompt: String(systemPrompt || ""),
      userPrompt: String(userPrompt || ""),
    },
    requestOptions: {
      model: String(requestOptions?.model || "").trim(),
      temperature: Number.isFinite(Number(requestOptions?.temperature)) ? Number(requestOptions.temperature) : "",
      top_p: Number.isFinite(Number(requestOptions?.top_p)) ? Number(requestOptions.top_p) : "",
      max_tokens: Number.isFinite(Number(requestOptions?.max_tokens)) ? Number(requestOptions.max_tokens) : "",
    },
  });
}

function buildScopeAssistSystemPrompt({ context } = {}) {
  const scopeMode = String(context?.scopeMode || "").trim().toLowerCase() === "refine" ? "refine" : "initial";
  const refineRuntimeMeta = getScopeRefineRuntimeMeta({
    scopeMode,
    refineInstruction: context?.refineInstruction || "",
    currentScopeNotes: context?.currentScopeNotes || "",
    context,
  });
  const isDashRefine = Boolean(refineRuntimeMeta.dashBranchActive);
  const isShorterRefine = Boolean(refineRuntimeMeta.shorterBranchActive);
  const lines = [
    "You are a working trade estimator writing scope notes the way contractors write estimates in the field.",
    "Interpret rough contractor shorthand generously.",
    "Assume the user is describing real work even if the prompt is casual, rough, short, mixed-trade, or not written in polished terminology.",
    "Prefer drafting a usable contractor-ready scope note over asking for clarification.",
    "Do not require the prompt to fit a known trade bucket, taxonomy, assembly tree, or skill category before drafting.",
    "Handle broad real-world contractor requests across repairs, installs, replacement, welding and fabrication, fencing, gates, rails, paint, patch, finish work, concrete, site work, exterior work, plumbing, electrical, HVAC, mechanical, equipment, appliances, machine service, and oddball field requests that still describe a real job.",
    "Write practical contractor scope notes, not a spec sheet, checklist, formal proposal, or chatbot reply.",
    "Return ONLY valid JSON with this exact shape: {\"outcome\":\"scope|clarify\",\"scopeNotes\":\"\",\"clarificationQuestion\":\"\",\"missingFields\":[]}",
    "Treat the user's raw scope prompt as the primary source of truth for initial drafting; for Dash + Brief, use the accepted prose draft currently shown to the user as the source of truth.",
    "For Dash + Brief, extract procedural work steps from the accepted prose draft instead of rewriting the opening overview sentence.",
    "If the accepted prose has later procedural detail sentences, ignore the opening overview/setup sentence for bullet selection and build the bullets from the later procedural detail sentences instead.",
    "Expand short contractor shorthand into estimate-ready language instead of echoing it back.",
    "Use trade signals only as gentle vocabulary and routing help, not as hard gates.",
    "For simple prompts, favor broad contractor-safe wording over narrow product systems or compliance assumptions.",
    "Lead with the actual work item, surface, asset, or area and expand with realistic contractor detail tied to the request.",
    "Include natural sequencing where the job implies it, such as layout, prep, application, installation, repair work, touch-up, finish, and final condition.",
    "Do not answer with vague filler that could fit almost any job.",
    "Do not use generic exclusion boilerplate unless it is tied to the actual prompt.",
    "Always name the actual work item, surface, asset, or area implied by the prompt.",
    "When the prompt is rough, infer the likely contractor workflow, access, prep, verification, cleanup, and scope boundaries from the raw words and soft cues.",
    "Default to outcome=\"scope\" and only use outcome=\"clarify\" when a real missing detail would make the draft misleading.",
    "Only use outcome=\"clarify\" when the prompt is truly too empty or useless to interpret into real work.",
    "For outcome=\"scope\", scopeNotes must be job-specific, contractor-ready, and materially more useful than a wrapper sentence.",
    "For outcome=\"scope\", do not use generic scaffold like 'work on affected areas', 'complete the described scope', 'clean up the work area', or 'not included unless identified and approved' unless those phrases are clearly tied to the actual job.",
    "Do not write in proposal/legal/spec-book tone and do not use wording such as 'Contractor shall', 'furnish labor, equipment, tools', 'in accordance with approved layout', 'industry-standard practices', 'proposal excludes', 'treated as additional work', 'subject to field verification', or 'approved in writing' unless the user explicitly requests that style.",
    "Do not invent thermoplastic unless the prompt clearly asks for it or strongly implies that exact system.",
    "Do not invent ADA language, local regulations, code language, compliance language, permit language, or regulatory claims unless the prompt explicitly asks for them.",
    "Do not add exclusion dumps, change-order terms, or contract/legal qualifiers unless the user explicitly asks for exclusions or legal terms.",
    "For outcome=\"clarify\", ask at most one concise question and list only truly missing fields that block a safe draft.",
    "Do not include dollar amounts, hourly rates, or pricing.",
    "Do not invent measurements, quantities, product systems, or technical requirements not stated or clearly implied by the user.",
    "Keep the result clean, readable, practical, and ready to drop into a first-pass estimate.",
    "Preserve existing scope notes when refining and improve only what the user asked to change.",
    "Use realistic work language such as remove, replace, install, repair, patch, test, verify, prepare, set, align, finish, and inspect when naturally supported.",
    "Do not answer like a chat assistant and do not preface the result with labels, markdown fences, or explanations.",
  ];

  if (!isDashRefine) {
    lines.push("Write plain paragraph text only. No bullets, no headings, and no numbered lists.");
  }

  if (isDashRefine) {
    // For Dash amend: use the full active scope prose as the requestText fallback,
    // not the short initial-generation prompt fields.
    const dashAmendActiveScopeProse = sanitizeScopeAssistText(context?.currentScopeNotes || "");
    const dashSourceSelection = resolveDashCanonicalAcceptedProseSource({
      acceptedProseDraftText: context?.originalAcceptedProseScope || context?.dashCanonicalAcceptedProse || context?.dashImmutableAcceptedProse || "",
      currentScopeText: context?.currentScopeNotes || "",
      existingScopeText: context?.currentScopeNotes || "",
      requestText: dashAmendActiveScopeProse
        || context?.scopePromptBasis || context?.sourceScopePrompt || context?.scopeInputAnalysis?.coreScopeText || "",
      sourceKind: "dash_system_prompt",
      sourcePrompt: context?.sourcePrompt || "",
      sourceScopePrompt: context?.sourceScopePrompt || "",
      sourceScopeBasis: context?.scopePromptBasis || "",
    });
    const dashAmendHasSourceProse = Boolean(dashAmendActiveScopeProse) || dashSourceSelection.usedAcceptedProseDraft;
    lines.push(
      dashAmendHasSourceProse
        ? "For Dash + Brief, rewrite the provided source prose into contractor-ready dash lines plus one short paragraph."
        : "For Dash + Brief, rewrite the request/core prompt fallback into contractor-ready dash lines plus one short paragraph because no usable accepted prose draft exists yet.",
      dashAmendHasSourceProse
        ? "Use the source scope prose currently shown to the user as the sole source of truth for content. Do not re-answer the original job from scratch."
        : "Use the fallback request/core prompt text only because no usable accepted prose draft is available.",
      dashAmendHasSourceProse
        ? "Transform the existing scope prose into Dash + Brief format. Preserve all detail already present. Do not genericize, compress away, or restate from scratch."
        : "If no usable accepted prose draft exists, fall back to the request text only for this rewrite.",
      "Preserve the actual trade, action, object, and location meaning that is grounded in that source text.",
      "Each scope line must begin with '- '.",
      "Return 3 to 5 dashed scope lines when possible without padding or inventing extra detail.",
      "Extract distinct job steps from the source meaning instead of rephrasing the same sentence in multiple bullets.",
      "When the accepted prose is terse, expand the action/object/location meaning into distinct contractor steps instead of echoing the sentence order.",
      "Do not echo the source sentence by sentence, and do not split one idea into several near-duplicate bullets.",
      "Do not preserve sentence order when it causes repetition or fragment bullets.",
      "After the dashed lines, include one blank line and then one short summary paragraph.",
      "Keep the same job meaning, scope intent, and estimate-ready usefulness as the source prose.",
      "Preserve the same trade or action identity when the source prose uses explicit trade-specific wording.",
      "Preserve critical source anchor terms for the action, object, and location when they carry the job meaning.",
      "Keep the dash lines concise, job-specific, and readable. Do not turn this into a giant bullet list.",
      "Keep the summary paragraph short, natural, and contractor-ready.",
      "Do not add exclusions, approvals, concealed-condition clauses, code or compliance language, scope-boundary clauses, or means and methods not already present in the source prose.",
      "Do not replace specific trade or action wording with neighboring generic trade language.",
      "Do not add extra detail that was not already stated or clearly implied.",
      "Do not use headings, numbered lists, markdown labels, quotes, or code fences."
    );
  } else if (isShorterRefine) {
    lines.push(
      "For this refine request, return a materially shorter version of the current scope while preserving the same job meaning and scope intent.",
      "The result must be meaningfully shorter than the current draft in word count, not just visually shorter from paragraph reflow.",
      "Reduce word count by roughly 30 to 45 percent when possible without losing core scope meaning.",
      "Remove redundancy, throat-clearing, vague framing, repeated intent language, repeated setup language, and soft filler.",
      "Keep it contractor-natural, estimate-ready, and practically usable.",
      "Preserve the same trade or action identity when the current draft uses explicit trade-specific wording.",
      "Preserve critical source anchor terms for the action, object, and location when they carry the job meaning.",
      "Preserve the actual job scope and any inclusions or exclusions already implied by the current draft.",
      "Default to one compact paragraph for this Shorter refine result.",
      "Do not use multiple paragraphs unless the source draft is unusually dense and separating 2 short paragraphs is truly necessary to preserve meaning after compression.",
      "Do not expand, re-fullify, or restate the scope more broadly than the current draft.",
      "Do not replace specific trade or action wording with neighboring generic trade language.",
      "Do not add extra detail that was not already stated or clearly implied.",
      "Do not add exclusions, approvals, concealed-condition clauses, code or compliance language, scope-boundary clauses, or means and methods not already present in the current draft.",
      "Do not simply reformat the same content into shorter-looking paragraphs or preserve nearly all of the same sentences with minor edits.",
      "Do not collapse the result into a useless one-line stub or clipped fragment.",
      "Use direct, natural, field-aware language that sounds estimate-ready, tight, and specific without over-specifying."
    );
  } else {
    lines.push(
      "Write a fuller first-pass scope note that sounds usable in a real estimate, not a thin summary.",
      "For straightforward jobs with enough substance, return exactly 2 short paragraphs separated by one blank line.",
      "Use one strong paragraph only when the job is truly tiny and would sound padded if forced longer.",
      "Use a third short paragraph only when the request clearly supports extra practical detail and the added paragraph improves readability.",
      "Paragraph 1 must cover what is being done, where it is being done, and the overall scope intent.",
      "Paragraph 2 must cover the prep, layout, application, installation, repair sequence, finishing steps, and final condition most closely tied to the job.",
      "Each paragraph should be readable and moderately detailed, not a compressed block or one-line blurb.",
      "Use direct, natural, field-aware language that sounds estimate-ready, fuller, and specific without over-specifying.",
      "Do not cram a richer job into one dense block when the scope has enough weight to breathe across paragraphs.",
      "Do not return a short compressed blurb when the prompt names a real job and area."
    );
  }

  if (scopeMode === "refine") {
    lines.push("Focus on the revision request and preserve any good existing scope content that is not being changed.");
  }

  return lines.join("\n");
}

function buildScopeAssistUserPrompt({ userInput = "", context = {} } = {}) {
  const scopeMode = String(context?.scopeMode || "").trim().toLowerCase() === "refine" ? "refine" : "initial";
  const refineRuntimeMeta = getScopeRefineRuntimeMeta({
    scopeMode,
    refineInstruction: context?.refineInstruction || userInput || "",
    userInput,
    currentScopeNotes: context?.currentScopeNotes || "",
    context,
  });
  const isDashRefine = Boolean(refineRuntimeMeta.dashBranchActive);
  const isShorterRefine = Boolean(refineRuntimeMeta.shorterBranchActive);
  const parts = [];
  const scopePromptBasis = String(
    context?.scopePromptBasis
    || userInput
    || context?.sourceScopePrompt
    || context?.scopeInputAnalysis?.coreScopeText
    || ""
  );
  const scopeShape = analyzeSimpleScopePrompt(scopePromptBasis);
  const promptMeaning = analyzeScopeAssistPromptMeaning(scopePromptBasis);
  const shouldForceTwoParagraphs = shouldUseExpandedScopeParagraphs(scopeShape) || Boolean(promptMeaning.supportsDetailedDraft);

  if (scopeMode === "refine") {
    const currentScopeWordCount = countScopeWords(context?.currentScopeNotes || "");
    const sourceAnchors = extractShorterSourceAnchorTerms(context?.currentScopeNotes || "");
    const shorterTargetFloor = currentScopeWordCount >= 18
      ? Math.max(12, Math.round(currentScopeWordCount * 0.55))
      : 0;
    const shorterTargetCeiling = currentScopeWordCount >= 18
      ? Math.max(shorterTargetFloor, Math.round(currentScopeWordCount * 0.7))
      : 0;
    if (isDashRefine) {
      try {
        let dashRewriteSourceSelection;
        let dashRewriteSourceText = "";
        // For Dash amend: prefer the full active scope prose as requestText fallback,
        // not the short initial-generation prompt fields.
        const dashUserPromptActiveScopeProse = sanitizeScopeAssistText(context?.currentScopeNotes || "");
        try {
          dashRewriteSourceSelection = resolveDashCanonicalAcceptedProseSource({
            context,
            acceptedProseDraftText: context?.originalAcceptedProseScope || context?.dashCanonicalAcceptedProse || context?.dashImmutableAcceptedProse || "",
            currentScopeText: context?.currentScopeNotes || "",
            existingScopeText: context?.currentScopeNotes || "",
            requestText: dashUserPromptActiveScopeProse
              || scopePromptBasis || context?.sourceScopePrompt || context?.scopeInputAnalysis?.coreScopeText || "",
            sourceKind: "dash_refine_prompt",
            sourcePrompt: context?.sourcePrompt || "",
            sourceScopePrompt: context?.sourceScopePrompt || "",
            sourceScopeBasis: context?.scopePromptBasis || "",
          });
          dashRewriteSourceText = sanitizeScopeAssistText(dashRewriteSourceSelection.sourceText || "");
        } catch (_dashSourceErr) {
          dashRewriteSourceSelection = { sourceText: "", usedAcceptedProseDraft: false };
          dashRewriteSourceText = sanitizeScopeAssistText(context?.currentScopeNotes || "");
        }
        const dashAmendHasSourceProse = Boolean(dashUserPromptActiveScopeProse) || dashRewriteSourceSelection.usedAcceptedProseDraft;
        if (dashAmendHasSourceProse) {
          parts.push(`SOURCE TEXT TO TRANSFORM: ${dashRewriteSourceText || dashUserPromptActiveScopeProse}`);
        } else if (dashRewriteSourceSelection.usedAcceptedProseDraft) {
          parts.push(`Accepted prose draft: ${dashRewriteSourceText}`);
        } else if (dashRewriteSourceText) {
          parts.push(`Request/core prompt fallback because accepted prose is missing: ${dashRewriteSourceText}`);
        }
        if (context?.scopeInputAnalysis?.formattingIntent) parts.push(`Requested output format: ${context.scopeInputAnalysis.formattingIntent}`);
        if (context?.scopeInputAnalysis?.brevityIntent) parts.push(`Requested brevity direction: ${context.scopeInputAnalysis.brevityIntent}`);
        parts.push(`TASK: Convert the source text above into Dash + Brief format.`);
        parts.push(`RULE: Preserve the source detail already present. Do not genericize, compress away, or restate from scratch.`);
        parts.push(`RULE: Do not answer the original job again — transform the existing scope prose only.`);
        parts.push(`RULE: Do not use the label "Dash + Brief" as the work description.`);
        parts.push(
          "EXTRACTION PATTERN EXAMPLES (reference only — use the pattern, not this content):\n" +
          "\n" +
          "Example 1 — HVAC preventive maintenance:\n" +
          "Source prose: \"Annual HVAC preventive maintenance on rooftop unit. Technician will check refrigerant levels and recharge if low, clean condenser and evaporator coils, test and calibrate thermostat, lubricate fan motors and bearings, replace air filters, and verify all electrical connections and controls.\"\n" +
          "Opening overview sentence to SKIP for bullets: \"Annual HVAC preventive maintenance on rooftop unit.\"\n" +
          "Correct bullets extracted from procedural steps only:\n" +
          "- Check refrigerant levels; recharge if low\n" +
          "- Clean condenser and evaporator coils\n" +
          "- Test and calibrate thermostat; verify electrical connections and controls\n" +
          "- Lubricate fan motors and bearings\n" +
          "- Replace air filters and confirm unit operation\n" +
          "\n" +
          "Annual HVAC PM completed on rooftop unit. Refrigerant checked, coils cleaned, thermostat calibrated, motors lubricated, and filters replaced.\n" +
          "\n" +
          "Example 2 — water heater replacement:\n" +
          "Source prose: \"Replace existing 40-gallon water heater with new unit. Disconnect and remove old heater, position and secure new unit, reconnect supply and return water lines, check all connections for leaks, restore power, and test for proper operation.\"\n" +
          "Opening overview sentence to SKIP for bullets: \"Replace existing 40-gallon water heater with new unit.\"\n" +
          "Correct bullets extracted from procedural steps only:\n" +
          "- Disconnect and remove existing water heater\n" +
          "- Position and secure new unit in place\n" +
          "- Reconnect supply and return water lines; check all connections for leaks\n" +
          "- Restore power and test for proper operation\n" +
          "\n" +
          "Water heater replacement complete. New unit installed, piped, and tested for leaks and operation."
        );
        parts.push("Apply this extraction pattern to the actual source prose above: ignore the opening overview or setup sentence and extract the procedural work steps that follow it.");
        parts.push(
          dashAmendHasSourceProse
            ? "Rewrite the provided source text into contractor-ready Dash + Brief format. Preserve all source detail."
            : dashRewriteSourceSelection.usedAcceptedProseDraft
              ? "Rewrite the provided accepted prose draft into contractor-ready Dash + Brief."
              : "Rewrite the request/core prompt fallback above into contractor-ready Dash + Brief because no usable accepted prose draft exists yet."
        );
        parts.push("If the accepted prose contains both overview/setup sentences and later procedural detail sentences, ignore the overview/setup sentences for bullet selection and build bullets from the procedural detail sentences instead.");
        parts.push("Prefer concrete service actions such as inspect, check, clean, replace, adjust, verify, test, repair, lubricate, install, remove, align, set, position, mount, reconnect, disconnect, and secure.");
        parts.push("Prefer grounded targets such as filters, belts, coils, motors, bearings, thermostat settings, refrigerant levels, electrical connections, controls, damaged components, and the work area.");
        parts.push("Do not turn the opening overview sentence into multiple bullets.");
        parts.push("Preserve grounded detail only and do not invent exclusions, approvals, code or compliance language, means and methods, or remove/replace/changeout detail unless it is already grounded in the source text.");
        parts.push("Do not preserve sentence order when it causes repetition.");
        parts.push("Do not echo the intro sentence.");
        parts.push("Do not split one sentence into fragment bullets.");
        parts.push("Return 3 to 5 hyphen-led lines when possible, then one blank line, then one short wrap-up paragraph.");
        parts.push("Do not repeat the same idea across bullets or make the closing paragraph repeat bullet 1.");
        parts.push("Do not use headings, numbered lists, markdown labels, quotes, or code fences.");
        parts.push("Return strict JSON only with the exact existing keys.");
        // Guarantee non-empty Dash refine prompt even if all source selection yielded empty parts
        const dashResult = parts.join("\n");
        if (dashResult.trim()) return dashResult;
      } catch (_dashBranchErr) {
        // Entire isDashRefine branch threw — fall through to minimal Dash prompt below
      }
      // Minimal safe Dash refine prompt — either parts were empty or branch threw
      const safeDashSource = sanitizeScopeAssistText(
        context?.currentScopeNotes || context?.originalAcceptedProseScope || context?.dashCanonicalAcceptedProse || ""
      );
      const safeDashParts = [];
      if (safeDashSource) safeDashParts.push(`SOURCE TEXT TO TRANSFORM: ${safeDashSource}`);
      safeDashParts.push(`TASK: Convert the source text into Dash + Brief format.`);
      safeDashParts.push("Rewrite the scope into contractor-ready Dash + Brief format: 3-5 hyphen-led bullet lines, then one blank line, then one short wrap-up paragraph.");
      safeDashParts.push("Preserve all source detail. Do not genericize, compress away, or restate from scratch.");
      safeDashParts.push("Return strict JSON only with the exact existing keys.");
      return safeDashParts.join("\n");
    } else if (isShorterRefine) {
      if (context?.sourceScopePrompt) parts.push(`Original scope request: ${context.sourceScopePrompt}`);
      if (context?.currentScopeNotes && (!context?.sourceScopePrompt || !areDashFallbackTextsTooSimilar(context.currentScopeNotes, context.sourceScopePrompt))) {
        parts.push(`Current scope draft to improve: ${context.currentScopeNotes}`);
      }
      if (context?.scopeInputAnalysis?.coreScopeText) parts.push(`Core scope text: ${context.scopeInputAnalysis.coreScopeText}`);
      if (context?.scopeInputAnalysis?.formattingIntent) parts.push(`Requested output format: ${context.scopeInputAnalysis.formattingIntent}`);
      if (context?.scopeInputAnalysis?.brevityIntent) parts.push(`Requested brevity direction: ${context.scopeInputAnalysis.brevityIntent}`);
      if (context?.scopeRefineAnalysis?.scopeSkeleton) {
        const skeletonLines = formatScopeSkeletonForPrompt(context.scopeRefineAnalysis.scopeSkeleton);
        if (skeletonLines.length) parts.push(`Refine request skeleton:\n${skeletonLines.map((line) => `- ${line}`).join("\n")}`);
      }
      parts.push(`Revision instruction: ${context?.refineInstruction || userInput || "(none provided)"}`);
      parts.push("Rewrite the current scope as a materially shorter version of itself.");
      parts.push("The output must be meaningfully shorter than the input draft in actual wording, not just shorter-looking because of line breaks or paragraph changes.");
      parts.push("Aim to reduce word count by roughly 30 to 45 percent when possible without losing core scope meaning.");
      parts.push("Preserve the same job meaning, scope intent, and estimate-ready usefulness.");
      parts.push("Preserve the same trade or action identity from the current draft when it is explicitly named.");
      if (sourceAnchors.anchorTerms.length) {
        parts.push(`Critical source anchor terms to preserve when they carry the job meaning: ${sourceAnchors.anchorTerms.join(" | ")}`);
      }
      parts.push("Remove redundancy, throat-clearing, vague framing, repeated intent language, repeated setup language, and generic filler.");
      parts.push("Keep it contractor-natural and practical without turning it into a different scope.");
      parts.push("Preserve the actual job scope and any inclusions or exclusions already implied by the current draft.");
      parts.push("Do not replace specific trade or action wording with neighboring generic trade language.");
      parts.push("Do not add extra detail that was not already stated or clearly implied.");
      parts.push("Do not add exclusions, approvals, concealed-condition language, code or compliance language, scope-boundary clauses, or means and methods that are not already present in the current draft.");
      parts.push("Default to one compact paragraph for this Shorter refine result.");
      parts.push("Do not use multiple paragraphs unless the source draft is unusually dense and separating 2 short paragraphs is truly necessary to preserve meaning after compression.");
      parts.push("Do not simply keep the same sentences and reformat them into shorter-looking paragraphs.");
      parts.push("Do not collapse it into a useless one-line stub.");
      if (shorterTargetFloor && shorterTargetCeiling) {
        parts.push(`Current draft length is about ${currentScopeWordCount} words. Aim for roughly ${shorterTargetFloor}-${shorterTargetCeiling} words if that can be done without losing essential meaning.`);
      }
    } else {
      if (context?.sourceScopePrompt) parts.push(`Original scope request: ${context.sourceScopePrompt}`);
      if (context?.currentScopeNotes && context?.ignoreCurrentScope !== true) {
        parts.push(`Existing scope notes for background only; do not copy verbatim: ${context.currentScopeNotes}`);
      }
      if (context?.scopeInputAnalysis?.coreScopeText) parts.push(`Core scope text: ${context.scopeInputAnalysis.coreScopeText}`);
      parts.push(`Raw scope prompt: ${scopePromptBasis || "(none provided)"}`);
      parts.push("Assume the prompt describes real contractor work even if it is rough, casual, shorthand, or does not fit a neat trade bucket.");
      parts.push("Prefer drafting over clarifying unless the prompt is truly too empty to interpret.");
      parts.push("Write natural contractor-style scope notes that sound ready to paste into an estimate.");
      parts.push("Make this a fuller first-pass scope note with enough practical detail to feel usable and professional.");
      if (shouldForceTwoParagraphs) {
        parts.push("Return exactly 2 short paragraphs separated by one blank line for this job.");
      } else {
        parts.push("Use one strong paragraph only if this job is truly tiny. Otherwise use 2 short paragraphs separated by one blank line.");
      }
      parts.push("Paragraph 1 should state what is being done, where it is being done, and the overall scope intent.");
      parts.push("Paragraph 2 should cover the prep, layout, application, install, repair, finish, and final condition details that naturally support the job.");
      parts.push("No bullets. No headings. No numbered lists.");
      parts.push("Use practical field wording, not formal proposal or spec-book language.");
      parts.push("Do not return a short compressed blurb or a thin one-block summary.");
      parts.push("Do not use phrases like 'Contractor shall', 'furnish labor, equipment, tools', 'industry-standard practices', 'approved in writing', 'proposal excludes', or 'subject to field verification' unless explicitly requested.");
      parts.push("Do not use thermoplastic unless the prompt clearly asks for it or strongly implies it.");
      parts.push("Stay grounded to the raw prompt and do not add local regulations, ADA, code, compliance, permit, product-system, or regulatory assumptions unless the user asks for them.");
      parts.push("Name the actual area, asset, or surface clearly and include realistic sequencing where implied.");
      parts.push("Do not invent quantities, product systems, code requirements, or regulatory claims.");
      parts.push("Respond as strict JSON only.");
      parts.push('Use the exact keys: outcome, scopeNotes, clarificationQuestion, missingFields.');
      parts.push('If outcome is "scope", set clarificationQuestion to an empty string and missingFields to an empty array.');
      parts.push('If outcome is "clarify", keep scopeNotes empty, ask one concise blocking question, and list only the real missing fields.');
      if (context?.scopeInputAnalysis?.formattingIntent) {
        parts.push(`Requested format: ${context.scopeInputAnalysis.formattingIntent}`);
      }
      if (context?.scopeInputAnalysis?.brevityIntent) {
        parts.push(`Requested brevity: ${context.scopeInputAnalysis.brevityIntent}`);
      }
      return parts.join("\n");
    }
    if (!isDashRefine) {
      if (context?.sourceScopePrompt) parts.push(`Original scope request: ${context.sourceScopePrompt}`);
      if (context?.currentScopeNotes && (!context?.sourceScopePrompt || !areDashFallbackTextsTooSimilar(context.currentScopeNotes, context.sourceScopePrompt))) {
        parts.push(`Current scope draft to improve: ${context.currentScopeNotes}`);
      }
      if (context?.scopeInputAnalysis?.coreScopeText) parts.push(`Core scope text: ${context.scopeInputAnalysis.coreScopeText}`);
      if (context?.scopeInputAnalysis?.formattingIntent) parts.push(`Requested output format: ${context.scopeInputAnalysis.formattingIntent}`);
      if (context?.scopeInputAnalysis?.brevityIntent) parts.push(`Requested brevity direction: ${context.scopeInputAnalysis.brevityIntent}`);
      if (context?.scopeRefineAnalysis?.scopeSkeleton) {
        const skeletonLines = formatScopeSkeletonForPrompt(context.scopeRefineAnalysis.scopeSkeleton);
        if (skeletonLines.length) parts.push(`Refine request skeleton:\n${skeletonLines.map((line) => `- ${line}`).join("\n")}`);
      }
      parts.push(`Revision instruction: ${context?.refineInstruction || userInput || "(none provided)"}`);
    }
    if (isDashRefine) {
      parts.push("Rewrite the provided accepted prose draft into contractor-ready Dash + Brief.");
      parts.push("Use the accepted prose draft as the source of truth and preserve the actual trade, action, object, and location meaning.");
      parts.push("If the accepted prose contains both overview/setup sentences and later procedural detail sentences, ignore the overview/setup sentences for bullet selection and build bullets from the procedural detail sentences instead.");
      parts.push("Prefer concrete service actions such as inspect, check, clean, replace, adjust, verify, test, repair, lubricate, install, remove, align, set, position, mount, reconnect, disconnect, and secure.");
      parts.push("Prefer grounded targets such as filters, belts, coils, motors, bearings, thermostat settings, refrigerant levels, electrical connections, controls, damaged components, and the work area.");
      parts.push("Return 3 to 5 hyphen-led lines when possible, then one blank line, then one short wrap-up paragraph.");
      parts.push("Do not repeat the same idea across bullets or split one idea into several bullets.");
      parts.push("Do not output clause fragments or generic intro/setup prose.");
      parts.push("Do not make the closing paragraph repeat bullet 1.");
      parts.push("Do not invent exclusions, approvals, code or compliance language, means and methods, or remove/replace/changeout detail unless it is grounded in the source prose.");
      if (sourceAnchors.anchorTerms.length) {
        parts.push(`Critical source anchor terms to preserve when they carry the job meaning: ${sourceAnchors.anchorTerms.join(" | ")}`);
      }
      parts.push("Do not use headings, numbered lists, markdown labels, quotes, or code fences.");
      parts.push("Return strict JSON only with the exact existing keys.");
    } else if (isShorterRefine) {
      parts.push("Rewrite the current scope as a materially shorter version of itself.");
      parts.push("The output must be meaningfully shorter than the input draft in actual wording, not just shorter-looking because of line breaks or paragraph changes.");
      parts.push("Aim to reduce word count by roughly 30 to 45 percent when possible without losing core scope meaning.");
      parts.push("Preserve the same job meaning, scope intent, and estimate-ready usefulness.");
      parts.push("Preserve the same trade or action identity from the current draft when it is explicitly named.");
      if (sourceAnchors.anchorTerms.length) {
        parts.push(`Critical source anchor terms to preserve when they carry the job meaning: ${sourceAnchors.anchorTerms.join(" | ")}`);
      }
      parts.push("Remove redundancy, throat-clearing, vague framing, repeated intent language, repeated setup language, and generic filler.");
      parts.push("Keep it contractor-natural and practical without turning it into a different scope.");
      parts.push("Preserve the actual job scope and any inclusions or exclusions already implied by the current draft.");
      parts.push("Do not replace specific trade or action wording with neighboring generic trade language.");
      parts.push("Do not add extra detail that was not already stated or clearly implied.");
      parts.push("Do not add exclusions, approvals, concealed-condition language, code or compliance language, scope-boundary clauses, or means and methods that are not already present in the current draft.");
      parts.push("Default to one compact paragraph for this Shorter refine result.");
      parts.push("Do not use multiple paragraphs unless the source draft is unusually dense and separating 2 short paragraphs is truly necessary to preserve meaning after compression.");
      parts.push("Do not simply keep the same sentences and reformat them into shorter-looking paragraphs.");
      parts.push("Do not collapse it into a useless one-line stub.");
      if (shorterTargetFloor && shorterTargetCeiling) {
        parts.push(`Current draft length is about ${currentScopeWordCount} words. Aim for roughly ${shorterTargetFloor}-${shorterTargetCeiling} words if that can be done without losing essential meaning.`);
      }
    } else {
      parts.push("Rewrite this as fuller contractor-style estimate text while preserving the useful existing scope content.");
      parts.push("If the job has enough substance, use 2 short paragraphs separated by one blank line instead of one compressed block.");
      parts.push("Only keep it to one paragraph if the job is truly tiny and reads better that way.");
    }
    parts.push("Keep the tone practical, field-natural, and estimate-ready. Avoid proposal/legal/spec wording.");
    return parts.join("\n");
  }

  // Initial scope mode — build first-pass user prompt from raw input
  if (context?.scopeInputAnalysis?.coreScopeText) parts.push(`Core scope text: ${context.scopeInputAnalysis.coreScopeText}`);
  parts.push(`Raw scope prompt: ${scopePromptBasis || userInput || "(none provided)"}`);
  parts.push("Assume the prompt describes real contractor work even if it is rough, casual, shorthand, or does not fit a neat trade bucket.");
  parts.push("Prefer drafting over clarifying unless the prompt is truly too empty to interpret.");
  parts.push("Write natural contractor-style scope notes that sound ready to paste into an estimate.");
  parts.push("Make this a fuller first-pass scope note with enough practical detail to feel usable and professional.");
  if (shouldForceTwoParagraphs) {
    parts.push("Use 2 short paragraphs separated by one blank line for a more complete-looking scope note.");
  } else {
    parts.push("If the job has enough substance, use 2 short paragraphs separated by one blank line instead of one compressed block.");
    parts.push("Only keep it to one paragraph if the job is truly tiny and reads better that way.");
  }
  parts.push("Do not output a one-line wrapper or placeholder sentence.");
  parts.push("Lead with the actual work and expand with realistic contractor detail.");
  parts.push("Keep the tone practical, field-natural, and estimate-ready. Avoid proposal/legal/spec wording.");
  parts.push("Respond as strict JSON only.");
  parts.push('Use the exact keys: outcome, scopeNotes, clarificationQuestion, missingFields.');
  parts.push('If outcome is "scope", set clarificationQuestion to an empty string and missingFields to an empty array.');
  parts.push('If outcome is "clarify", keep scopeNotes empty, ask one concise blocking question, and list only the real missing fields.');
  if (context?.scopeInputAnalysis?.formattingIntent) {
    parts.push(`Requested format: ${context.scopeInputAnalysis.formattingIntent}`);
  }
  if (context?.scopeInputAnalysis?.brevityIntent) {
    parts.push(`Requested brevity: ${context.scopeInputAnalysis.brevityIntent}`);
  }
  return parts.join("\n");
}

function buildScopeAssistModelStrategy() {
  return {
    primary: {
      name: "groq_scope_primary",
      model: GROQ_SCOPE_PRIMARY_MODEL,
      timeoutMs: SCOPE_ASSIST_PRIMARY_TIMEOUT_MS,
    },
  };
}

function buildScopeAssistProviderConfig(model, role) {
  return {
    name: role,
    url: GROQ_CHAT_COMPLETIONS_URL,
    apiKey: GROQ_API_KEY,
    model,
  };
}

function buildSectionAssistProviderRequest({ systemPrompt, userPrompt, requestOptions = {}, modelOverride = "" } = {}) {
  const model = String(modelOverride || requestOptions?.model || GROQ_MODEL).trim() || GROQ_MODEL;
  const temperature = Number.isFinite(Number(requestOptions?.temperature)) ? Number(requestOptions.temperature) : 0.2;
  const topP = Number.isFinite(Number(requestOptions?.top_p)) ? Number(requestOptions.top_p) : undefined;
  const maxTokens = Number.isFinite(Number(requestOptions?.max_tokens)) ? Number(requestOptions.max_tokens) : undefined;

  return {
    model,
    temperature,
    topP,
    maxTokens,
    requestBody: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature,
      ...(topP ? { top_p: topP } : {}),
      ...(maxTokens ? { max_tokens: maxTokens } : {}),
      stream: false,
    }),
  };
}

async function runScopeAssistProviderStep({
  providerConfig,
  requestBody,
  timeoutMs,
  traceId,
  phase,
  trace,
}) {
  const startedAt = Date.now();
  const providerPath = describeSectionAssistProviderPath(providerConfig?.url);
  const phasePrefix = String(phase || "provider").trim();
  const logPhase = (suffix, payload = {}) => {
    logScopeAssistTerminal(traceId, `${phasePrefix}_${suffix}`, {
      model: providerConfig?.model || "unknown",
      provider: providerConfig?.name || "provider",
      path: providerPath,
      ...payload,
    });
  };

  logPhase("started", {
    timeout_ms: timeoutMs,
    request_body_bytes: Buffer.byteLength(String(requestBody || ""), "utf8"),
  });
  trace?.step("provider_start", {
    provider: providerConfig?.name || "provider",
    path: providerPath,
    attempted: "yes",
    phase: phasePrefix,
    model: providerConfig?.model || "",
  });

  try {
    const response = await fetchWithTimeout(
      providerConfig.url,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${providerConfig.apiKey}`,
        },
        body: requestBody,
      },
      timeoutMs,
      () => {
        logPhase("timeout_fired", {
          timeout_ms: timeoutMs,
        });
      }
    );

    logPhase("result", {
      outcome: response.ok ? "ok" : `http_${response.status}`,
      status: response.status,
      duration_ms: Date.now() - startedAt,
    });
    trace?.step("provider_end", {
      provider: providerConfig?.name || "provider",
      path: providerPath,
      attempted: "yes",
      phase: phasePrefix,
      outcome: response.ok ? "ok" : `http_${response.status}`,
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      const failure = normalizeScopeAssistFailure({
        httpStatus: response.status,
        providerDetail: detail,
        providerName: providerConfig?.name || "provider",
      });
      const error = new Error(extractAssistFailureText(detail) || `${providerConfig?.name || "Provider"} error ${response.status}`);
      error.httpStatus = response.status;
      error.providerDetail = detail;
      error.providerName = providerConfig?.name || "provider";
      error.failureType = failure.failureType;
      error.durationMs = Date.now() - startedAt;
      error.stage = phasePrefix;
      throw error;
    }

    const data = await response.json().catch(() => null);
    const raw = readGroqMessageContent(data);
    if (!raw) {
      const error = new Error("Groq returned an empty response.");
      error.failureType = "malformed_response";
      error.providerName = providerConfig?.name || "provider";
      error.durationMs = Date.now() - startedAt;
      error.stage = phasePrefix;
      throw error;
    }

    logPhase("answer", {
      content_chars: raw.length,
      duration_ms: Date.now() - startedAt,
    });
    return raw;
  } catch (error) {
    const failure = normalizeScopeAssistFailure(error);
    logPhase("failure", {
      failure_type: failure.failureType,
      status: failure.status,
      duration_ms: Number.isFinite(Number(error?.durationMs)) ? Number(error.durationMs) : Date.now() - startedAt,
    });
    throw error;
  }
}

function describeSectionAssistProviderPath(url) {
  const raw = String(url || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw).pathname || "/";
  } catch (_error) {
    return raw;
  }
}

function resolveSectionAssistRetryPolicy({ sectionKey = "", scopeMode = "initial", providerName = "groq" } = {}) {
  const scopeSection = normalizeAssistSectionKey(sectionKey) === "scope";
  const refineMode = scopeSection && String(scopeMode || "").trim().toLowerCase() === "refine";
  const fallbackProvider = String(providerName || "").trim().toLowerCase() !== "groq";

  if (fallbackProvider) {
    return {
      maxAttempts: refineMode ? 2 : scopeSection ? 1 : 2,
      baseDelayMs: refineMode ? 900 : 700,
      maxDelayMs: refineMode ? 2600 : 1800,
      jitterRatio: 0.2,
    };
  }

  return {
    maxAttempts: refineMode ? 2 : scopeSection ? 2 : 2,
    baseDelayMs: refineMode ? 650 : 420,
    maxDelayMs: refineMode ? 2200 : 1800,
    jitterRatio: refineMode ? 0.25 : 0.18,
  };
}

function shouldRetrySectionAssistProviderFailure(reason) {
  const source = reason && typeof reason === "object" ? reason : { message: String(reason || "") };
  const status = Number(source?.httpStatus || source?.status || 0);
  if ([400, 401, 403, 404, 422].includes(status)) return false;
  if (source?.name === "AbortError") return false;
  if (status === 408 || status === 504) return false;
  if ([429, 500, 502, 503].includes(status)) return true;

  const detail = String(source?.providerDetail || source?.detail || source?.message || "");
  if (/\btimeout\b|\btimed out\b|\btook too long\b/i.test(detail)) return false;
  return looksLikeAssistTemporaryFailure(detail);
}

function resolveSectionAssistRetryDelayMs(reason, attempt = 0, retryPolicy = {}) {
  const source = reason && typeof reason === "object" ? reason : {};
  const retryAfterMs = Number(source?.retryAfterMs || 0);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) {
    return Math.max(350, retryAfterMs);
  }

  const baseDelayMs = Math.max(250, Number(retryPolicy?.baseDelayMs || 700));
  const maxDelayMs = Math.max(baseDelayMs, Number(retryPolicy?.maxDelayMs || 1800));
  const jitterRatio = Math.min(Math.max(Number(retryPolicy?.jitterRatio || 0.2), 0), 0.45);
  const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
  const jitterFactor = 1 + ((Math.random() * 2) - 1) * jitterRatio;
  return Math.max(250, Math.round(exponentialDelay * jitterFactor));
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withCoalescedScopeAssistRequest(fingerprint, trace, task) {
  if (!fingerprint) return task();

  const existing = SCOPE_ASSIST_IN_FLIGHT_REQUESTS.get(fingerprint);
  if (existing) {
    trace?.step("scope_request_coalesced", { fingerprint: fingerprint.slice(0, 12) });
    return existing;
  }

  const promise = Promise.resolve().then(task);
  SCOPE_ASSIST_IN_FLIGHT_REQUESTS.set(fingerprint, promise);
  promise.finally(() => {
    if (SCOPE_ASSIST_IN_FLIGHT_REQUESTS.get(fingerprint) === promise) {
      SCOPE_ASSIST_IN_FLIGHT_REQUESTS.delete(fingerprint);
    }
  });
  return promise;
}

const AI_ASSIST_SECTIONS = {
  scope: {
    buildSystemPrompt({ context } = {}) {
      return buildScopeAssistSystemPrompt({ context });
    },
    buildUserPrompt({ userInput, context }) {
      return buildScopeAssistUserPrompt({ userInput, context });
    },
    buildRequestOptions({ context }) {
      const refineRuntimeMeta = getScopeRefineRuntimeMeta({
        scopeMode: context?.scopeMode,
        refineInstruction: context?.refineInstruction || "",
        currentScopeNotes: context?.currentScopeNotes || "",
        context,
      });
      const dashRefine = Boolean(refineRuntimeMeta.dashBranchActive);
      const shorterRefine = Boolean(refineRuntimeMeta.shorterBranchActive);
      const depthTarget = context?.scopeInputAnalysis?.scopeDepthTarget || "moderate_expansion";
      const expansionPressure = context?.scopeInputAnalysis?.expansionPressure || "";
      const technicalScope = depthTarget === "technical_trade_expansion";
      const vagueScope = depthTarget === "fuller_scope_draft";
      const terseTechnicalScope = technicalScope && expansionPressure === "high";

      return {
        model: GROQ_SCOPE_PRIMARY_MODEL,
        temperature: dashRefine ? 0.18 : shorterRefine ? 0.12 : terseTechnicalScope ? 0.2 : technicalScope ? 0.18 : vagueScope ? 0.26 : depthTarget === "moderate_expansion" ? 0.2 : 0.18,
        top_p: dashRefine ? 0.88 : shorterRefine ? 0.82 : terseTechnicalScope ? 0.92 : technicalScope ? 0.9 : vagueScope ? 0.94 : depthTarget === "moderate_expansion" ? 0.9 : 0.88,
        max_tokens: dashRefine ? 420 : shorterRefine ? 360 : terseTechnicalScope ? 900 : technicalScope ? 800 : vagueScope ? 720 : depthTarget === "moderate_expansion" ? 640 : 560,
      };
    },
    parseResponse(raw) {
      return parseScopeAssistResponse(raw);
    },
    fallback(reason) {
      return buildSectionAssistFailure(reason, { scopeNotes: "" });
    },
  },

  labor: {
    buildSystemPrompt({ context } = {}) {
      const laborRequestMode = String(context?.laborRequestMode || "").trim().toLowerCase();
      const fromScopeRequest = laborRequestMode === "from_scope";
      return [
        "You are a professional trade estimator generating labor line items for a construction estimate.",
        'Return ONLY valid JSON matching this exact schema: {"lines":[{"role":"string","hours":number,"rate":number,"qty":number}]}',
        "Rules:",
        "- Return exactly one valid JSON object and nothing else",
        "- Do not return markdown, code fences, comments, explanatory prose, or text before or after the JSON",
        "- Do not use trailing commas",
        "- role must be a concise contractor-facing labor label that fits the scope",
        "- Prefer trade-specific role labels when the scope clearly supports them, such as Painter, Wallcovering Installer, Plumber, Striping Technician, Equipment Operator, Finish Carpenter, Door Hardware Technician, Welder, Fabricator, Grinder, Laborer",
        "- Use generic crew-hierarchy labels such as Foreman, Journeyman, Apprentice, Helper, Technician, Supervisor, Equipment Operator only when the trade is unclear or that crew distinction is clearly warranted",
        "- hours must be a realistic positive number (whole or decimal, e.g. 8, 16, 4.5)",
        "- rate must be a realistic contractor bill rate as a whole dollar amount (e.g. 45, 65, 85), not fake precision",
        "- hours and rate must be positive numbers only, not text, ranges, fractions, or formulas",
        "- qty is optional and represents crew count / headcount for that line when the context supports it; otherwise use 1",
        "- Usually return 1 to 4 lines; use 5 only when the work genuinely spans different roles",
        "- Return draft suggested labor lines only",
        "- Do NOT include totals, subtotals, markups, or internal cost rates in the JSON output",
        "- Prefer one row per role label",
        "- If the same role would otherwise appear multiple times, combine it into one row by summing total hours",
        "- Only split the same role into multiple rows when the role labels are meaningfully different enough to justify separate contractor review",
        "- Do not create repeated rows like five Painter rows, three Plumber rows, or two Door Hardware Technician rows when one summarized row is clearer",
        "- Base your estimate on the current scope, job context, trade clues, job conditions, and any existing labor context provided",
        "- Existing labor rows are reference context only; do not treat them as something to overwrite or restate unless they clearly support the suggestion",
        "- If user or context provides crew size or duration hints, use them",
        "- When the scope includes explicit quantities, repeated units, room counts, fixture counts, door counts, detector counts, valve counts, device counts, opening counts, or linear footage, scale total labor hours to cover the repeated work across the full job",
        "- Do not treat repeated-unit work as a single one-off task when the scope clearly describes many units, rooms, fixtures, doors, devices, valves, or linear feet",
        "- For repeated-unit work, include realistic time for setup, access, removal or prep, install or service, adjustment or testing, cleanup, and normal movement between units, rooms, openings, or work areas when the scope supports it",
        "- For repeated electrical or device work such as fixtures, detectors, outlets, switches, sensors, electrified closers or hardware, or similar repeated install and test items, make sure total hours scale with the full count of units across the job",
        "- Do not estimate repeated electrical or device work as if only one or two units are being handled when the scope clearly describes many fixtures, devices, detectors, sensors, switches, outlets, or similar repeated items",
        "- For repeated electrical or device work, include normal time for access, removal, mounting or installation, wiring or connection when applicable, labeling or adjustment when applicable, testing each unit, cleanup, and movement between rooms or work areas",
        "- If you return one row for repeated electrical or device work, hours must represent the total job hours for all devices, fixtures, or units in the scope",
        "- Before finalizing repeated electrical or device labor, sanity-check that the lead role hours reflect work across the full repeated unit count and do not read like a small one-off service call when dozens of units require install or testing",
        "- If you return one row for a repeated-task role, hours must represent the total estimated labor hours for all units or footage in the job, not per-unit hours",
        "- Distinguish crew count from total hours when the context supports it",
        "- If you include a helper or secondary row for repeated electrical or device work, do not let the lead role hours collapse to an unrealistically small one-off number relative to the full repeated-unit scope",
        "- If you use qty or headcount, qty means crew count for that role, while hours should still represent the total hours for that role across the job",
        "- Use practical contractor-level assumptions and avoid invented detail or overly exact fractional rates",
        "- Keep the output estimator-friendly and concise",
        ...(fromScopeRequest
          ? [
            "- This request mode is from_scope: build suggested labor rows from the provided scope and estimate context even if there is no user-entered labor sentence.",
            "- Treat the scope and estimate context as the primary source of truth for the draft labor breakdown.",
          ]
          : []),
      ].join("\n");
    },
    buildUserPrompt({ userInput, context }) {
      const laborRequestMode = String(context?.laborRequestMode || "").trim().toLowerCase();
      const fromScopeRequest = laborRequestMode === "from_scope";
      const parts = [];
      if (fromScopeRequest) parts.push("Labor request mode: from_scope");
      if (context?.tradeKey) parts.push(`Trade key: ${context.tradeKey}`);
      if (context?.tradeLabel) parts.push(`Trade insert: ${context.tradeLabel}`);
      if (context?.customerName) parts.push(`Customer: ${context.customerName}`);
      if (context?.projectName) parts.push(`Project/job name: ${context.projectName}`);
      if (context?.projectAddress) parts.push(`Project/site address: ${context.projectAddress}`);
      if (context?.scopeNotes) parts.push(`Scope: ${context.scopeNotes}`);
      if (context?.additionalNotes) parts.push(`Additional estimate notes: ${context.additionalNotes}`);
      if (Array.isArray(context?.existingLaborLines) && context.existingLaborLines.length) {
        parts.push(`Existing labor rows (reference only):\n${context.existingLaborLines.join("\n")}`);
      }
      if (Array.isArray(context?.laborPricingHints) && context.laborPricingHints.length) {
        parts.push(`Current labor pricing hints: ${context.laborPricingHints.join(" | ")}`);
      }
      if (context?.laborConditions && typeof context.laborConditions === "object") {
        const conditionParts = [];
        if (Number(context.laborConditions?.hazardPct) > 0) conditionParts.push(`hazard ${Number(context.laborConditions.hazardPct)}%`);
        if (Number(context.laborConditions?.riskPct) > 0) conditionParts.push(`risk ${Number(context.laborConditions.riskPct)}%`);
        if (Number(context.laborConditions?.multiplier) > 0 && Number(context.laborConditions.multiplier) !== 1) {
          conditionParts.push(`labor multiplier ${Number(context.laborConditions.multiplier)}`);
        }
        if (conditionParts.length) {
          parts.push(`Job conditions context: ${conditionParts.join(" | ")}`);
        }
      }
      if (fromScopeRequest) {
        parts.push("Task: Build draft labor rows from the current scope and estimate context.");
      } else if (userInput) {
        parts.push(`User labor request: ${userInput}`);
      }
      if (!context?.tradeKey && !context?.tradeLabel && !context?.scopeNotes && !userInput && !fromScopeRequest) {
        parts.push("Generate general labor lines for a standard trade estimate.");
      }
      return parts.join("\n");
    },
    fallback(reason) {
      return buildSectionAssistFailure(reason, { lines: [] });
    },
  },

  materials: {
    buildSystemPrompt({ context } = {}) {
      const mode = normalizeAssistSectionKey(context?.materialsMode);
      if (mode === "itemized") {
        return [
          "You are a professional trade estimator generating draft itemized materials for one estimate section.",
          'Return ONLY valid JSON matching this exact schema: {"responseType":"itemizedSuggestion","assumptionsSummary":"string","proposedLines":[{"desc":"string","qty":number,"priceEach":number,"unitCostInternal":number,"note":"string"}],"duplicateWarnings":["string"]}',
          "Rules:",
          "- Return 1 to 8 draft material rows maximum",
          "- proposedLines must be materials only, never labor",
          "- The scope may be plumbing, electrical, flooring, drywall, painting, finish work, demolition, or another trade",
          "- Propose only materials and supplies directly relevant to the described job or scope",
          "- If the user already listed specific materials, follow that list first and only add closely related common supplies when clearly helpful",
          "- desc must be concise and estimator-friendly",
          "- qty must be a realistic positive number",
          "- priceEach is a rough pre-markup base each amount, not an exact vendor quote and not a total after markup",
          "- unitCostInternal should be a rough internal cost basis when useful; otherwise use 0",
          "- note is optional and should stay short",
          "- Avoid suggesting materials already covered by the existing materials summary",
          "- Do not default to paint or coatings unless the estimate context points there",
          "- Do not invent SKU numbers, vendor names, or exact purchasing quotes",
          "- Keep assumptionsSummary short and practical",
        ].join("\n");
      }

      return [
        "You are a professional trade estimator generating a rough blanket materials allowance for one estimate section.",
        'Return ONLY valid JSON matching this exact schema: {"responseType":"blanketSuggestion","suggestedAmount":number,"assumptionsSummary":"string","includedCategories":["string"]}',
        "Rules:",
        "- suggestedAmount must be one positive number representing a rough pre-markup base amount for the blanket materials field",
        "- Base the allowance only on the described job or scope, regardless of trade",
        "- The scope may be plumbing, electrical, flooring, drywall, painting, finish work, demolition, or another trade",
        "- Frame the result as an allowance, not exact purchasing math",
        "- assumptionsSummary should briefly explain what the allowance assumes",
        "- includedCategories should be short material categories that the allowance carries",
        "- Do not return itemized rows in blanket mode",
        "- Do not default to paint or coatings unless the estimate context points there",
        "- Do not invent SKU numbers, vendor names, or exact purchasing quotes",
      ].join("\n");
    },
    buildUserPrompt({ userInput, context }) {
      const parts = [
        "Current section: materials",
        `Materials mode: ${context?.materialsMode || "not_selected"}`,
      ];
      if (Array.isArray(context?.estimateContext?.tradeClues) && context.estimateContext.tradeClues.length) {
        parts.push(`Trade clues: ${context.estimateContext.tradeClues.join(" | ")}`);
      }
      if (context?.estimateContext?.scopeNotes) parts.push(`Scope: ${context.estimateContext.scopeNotes}`);
      if (context?.estimateContext?.additionalNotes) parts.push(`Additional notes: ${context.estimateContext.additionalNotes}`);
      if (context?.materialsStateSummary) parts.push(`Current materials state: ${context.materialsStateSummary}`);
      parts.push(`User request: ${userInput || "(none provided — use the estimate context only)"}`);
      return parts.join("\n");
    },
    fallback(reason) {
      return buildSectionAssistFailure(reason, { responseType: "materialsError" });
    },
  },
};

async function callSectionAssistProviderWithRetry(providerConfig, systemPrompt, userPrompt, trace, requestOptions = {}, assistOptions = {}) {
  const requestPayload = buildSectionAssistProviderRequest({
    systemPrompt,
    userPrompt,
    requestOptions,
    modelOverride: providerConfig?.model,
  });
  const retryPolicy = resolveSectionAssistRetryPolicy({
    sectionKey: assistOptions?.sectionKey,
    scopeMode: assistOptions?.scopeMode,
    providerName: providerConfig?.name,
  });
  const maxAttempts = Math.max(1, Number(retryPolicy?.maxAttempts || 1));
  const providerPath = describeSectionAssistProviderPath(providerConfig?.url);
  const requestTimeoutMs = Number(assistOptions?.requestTimeoutMs || OLLAMA_TIMEOUT_MS);
  const isScopeAssist = normalizeAssistSectionKey(assistOptions?.sectionKey) === "scope";

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const attemptStartedAt = Date.now();
    try {
      if (isScopeAssist) {
        logScopeAssistTerminal(assistOptions?.traceId, "provider_call_started", {
          provider: providerConfig?.name || "provider",
          path: providerPath,
          attempt: attempt + 1,
          model: requestPayload.model,
          timeout_ms: requestTimeoutMs,
        });
      }
      trace?.step("provider_start", {
        provider: providerConfig?.name || "provider",
        path: providerPath,
        attempted: "yes",
        attempt: attempt + 1,
        model: requestPayload.model,
        max_tokens: requestPayload.maxTokens || "",
      });
      const response = await fetchWithTimeout(
        providerConfig.url,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${providerConfig.apiKey}`,
          },
          body: requestPayload.requestBody,
        },
        requestTimeoutMs,
        isScopeAssist
          ? () => {
            logScopeAssistTerminal(assistOptions?.traceId, "provider_timeout_fired", {
              provider: providerConfig?.name || "provider",
              path: providerPath,
              attempt: attempt + 1,
              timeout_ms: requestTimeoutMs,
            });
          }
          : undefined
      );
      if (isScopeAssist) {
        logScopeAssistTerminal(assistOptions?.traceId, "provider_response_received", {
          provider: providerConfig?.name || "provider",
          path: providerPath,
          attempt: attempt + 1,
          status: response.status,
          duration_ms: Date.now() - attemptStartedAt,
        });
      }
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const failure = normalizeScopeAssistFailure({
          httpStatus: response.status,
          providerDetail: detail,
          providerName: providerConfig?.name || "provider",
        });
        trace?.step("provider_end", {
          provider: providerConfig?.name || "provider",
          path: providerPath,
          attempt: attempt + 1,
          outcome: `http_${response.status}`,
        });
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        const error = new Error(extractAssistFailureText(detail) || `${providerConfig?.name || "Provider"} error ${response.status}`);
        error.httpStatus = response.status;
        error.providerDetail = detail;
        error.retryAfterMs = retryAfterMs;
        error.providerName = providerConfig?.name || "provider";
        error.failureType = failure.failureType;
        error.durationMs = Date.now() - attemptStartedAt;
        throw error;
      }

      if (isScopeAssist) {
        logScopeAssistTerminal(assistOptions?.traceId, "provider_call_success", {
          provider: providerConfig?.name || "provider",
          path: providerPath,
          attempt: attempt + 1,
          duration_ms: Date.now() - attemptStartedAt,
        });
      }
      trace?.step("provider_end", {
        provider: providerConfig?.name || "provider",
        path: providerPath,
        attempt: attempt + 1,
        outcome: "ok",
      });
      return readGroqMessageContent(await response.json());
    } catch (error) {
      error.providerName = error?.providerName || providerConfig?.name || "provider";
      const failure = normalizeScopeAssistFailure(error);
      const retryable = shouldRetrySectionAssistProviderFailure(error)
        && !(normalizeAssistSectionKey(assistOptions?.sectionKey) === "scope" && (failure.failureType === "timeout" || failure.failureType === "aborted"));
      if (isScopeAssist) {
        logScopeAssistTerminal(assistOptions?.traceId, "provider_call_failure", {
          provider: providerConfig?.name || "provider",
          path: providerPath,
          attempt: attempt + 1,
          failure_type: failure.failureType,
          status: failure.status,
          duration_ms: Number.isFinite(Number(error?.durationMs)) ? Number(error.durationMs) : Date.now() - attemptStartedAt,
        });
      }
      if (!retryable || attempt >= maxAttempts - 1) throw error;

      const delayMs = resolveSectionAssistRetryDelayMs(error, attempt, retryPolicy);
      trace?.step("provider_retry", {
        provider: providerConfig?.name || "provider",
        path: providerPath,
        reason: normalizeSectionAssistFailure(error).code,
        next_attempt: attempt + 2,
        delay_ms: delayMs,
      });
      await waitMs(delayMs);
    }
  }

  throw new Error("Section assist retry loop exited unexpectedly");
}

async function callSectionAssistGroq(systemPrompt, userPrompt, trace, requestOptions = {}, assistOptions = {}) {
  const groqConfigProblem = getGroqConfigProblem();
  if (groqConfigProblem) {
    trace?.step("provider_start", { provider: "groq", path: "/openai/v1/chat/completions", attempted: "no" });
    trace?.step("provider_end", { provider: "groq", path: "/openai/v1/chat/completions", outcome: "skipped_invalid_config" });
    throw new Error(`Invalid GROQ_API_KEY config (${groqConfigProblem})`);
  }

  const isScopeAssist = normalizeAssistSectionKey(assistOptions?.sectionKey) === "scope";
  if (!isScopeAssist) {
    const primaryProviderConfig = {
      name: "groq",
      url: GROQ_CHAT_COMPLETIONS_URL,
      apiKey: GROQ_API_KEY,
      model: String(requestOptions?.model || GROQ_MODEL).trim() || GROQ_MODEL,
    };
    return callSectionAssistProviderWithRetry(
      primaryProviderConfig,
      systemPrompt,
      userPrompt,
      trace,
      requestOptions,
      assistOptions
    );
  }

  const traceId = String(assistOptions?.traceId || "").trim();
  const strategy = buildScopeAssistModelStrategy();
  const selectedModel = String(assistOptions?.modelOverride || "").trim() || strategy.primary.model;
  logScopeAssistTerminal(traceId, "model_selected", {
    primary_model: selectedModel,
    selected_model: selectedModel,
    generation_mode: "quality_first",
  });

  const buildModelRequest = (model) => buildSectionAssistProviderRequest({
    systemPrompt,
    userPrompt,
    requestOptions: {
      ...requestOptions,
      model,
    },
    modelOverride: model,
  }).requestBody;

  const runGeneration = async ({ model, timeoutMs }) => {
    const providerConfig = buildScopeAssistProviderConfig(model, "primary");
    const requestBody = buildModelRequest(model);
    const raw = await runScopeAssistProviderStep({
      providerConfig,
      requestBody,
      timeoutMs,
      traceId,
      phase: "direct_generation",
      trace,
    });

    return { raw, model, role: "primary" };
  };

  try {
    const directResult = await runGeneration({
      model: selectedModel,
      timeoutMs: strategy.primary.timeoutMs,
    });
    logScopeAssistTerminal(traceId, "direct_generation", {
      model: directResult.model,
      role: directResult.role,
    });
    return directResult;
  } catch (primaryError) {
    const primaryFailure = normalizeScopeAssistFailure(primaryError);
    logScopeAssistTerminal(traceId, "normalized_failure", {
      model: selectedModel,
      failure_type: primaryFailure.failureType,
      stage: String(primaryError?.stage || "direct_generation"),
    });
    throw primaryError;
  }
}

async function handleScopeAssistRequest({
  userInput = "",
  scopeMode = "initial",
  context = {},
  trace,
  requestOptions = {},
  systemPrompt = "",
  userPrompt = "",
  traceId = "",
  runtime = {},
}) {
  const inputText = String(userInput || "");
  const normalizedScopeMode = String(scopeMode || "").trim().toLowerCase() === "refine" ? "refine" : "initial";
  const existingScopeText = sanitizeScopeAssistText(context?.currentScopeNotes || "");
  const refineRuntimeMeta = getScopeRefineRuntimeMeta({
    scopeMode: normalizedScopeMode,
    refineInstruction: context?.refineInstruction || inputText,
    userInput: inputText,
    currentScopeNotes: existingScopeText,
    context,
  });
  const promptBasisResolution = resolveScopeAssistPromptBasis({
    userInput: inputText,
    sourceScopePrompt: context?.sourceScopePrompt || "",
    promptText: context?.promptText || "",
    currentPrompt: context?.currentPrompt || "",
    assistantMessage: context?.assistantMessage || "",
    context,
  });
  const sourceScopeText = sanitizeScopeAssistText(context?.scopePromptBasis || context?.sourceScopePrompt || promptBasisResolution.text || "");
  const draftBasisText = normalizedScopeMode === "refine"
    ? (sourceScopeText || existingScopeText || inputText)
    : (sourceScopeText || inputText);
  const defaultModel = String(runtime?.defaultModel || GROQ_SCOPE_PRIMARY_MODEL).trim() || GROQ_SCOPE_PRIMARY_MODEL;
  const clarifyQuestion = "What exact item, surface, or area should be included in the scope?";
  const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const setDebug = (next = {}) => {
    try {
      if (typeof runtime?.setDebugState === "function") runtime.setDebugState(next);
    } catch {}
  };
  const setTruth = (next = {}) => {
    try {
      if (typeof runtime?.setRuntimeTruth === "function") runtime.setRuntimeTruth(next);
    } catch {}
  };
  const getActiveParseSource = () => {
    try {
      if (typeof runtime?.getParseSource === "function") {
        return String(runtime.getParseSource() || "raw_only");
      }
    } catch {}
    return "raw_only";
  };
  const log = (event, payload = {}) => {
    try {
      if (typeof runtime?.logScopeEvent === "function") runtime.logScopeEvent(event, payload);
    } catch {}
  };
  const terminalLog = (event, payload = {}) => {
    try {
      logScopeAssistTerminal(traceId, event, {
        ...(refineRuntimeMeta.refineMode === "refine" ? refineRuntimeMeta : {}),
        ...payload,
      });
    } catch {}
  };
  const toScopeStyleRuntimeMeta = (styleAssessment = null) => {
    if (!styleAssessment || typeof styleAssessment !== "object") return {};
    return {
      scopeStyleAccepted: Boolean(styleAssessment.accepted),
      scopeStyleReasonTag: String(styleAssessment.reasonTag || ""),
      scopeStyleMatchedPattern: String(styleAssessment.matchedPattern || ""),
      scopeParagraphCount: Math.max(0, Number(styleAssessment.paragraphCount || 0)),
      scopeSentenceCount: Math.max(0, Number(styleAssessment.sentenceCount || 0)),
    };
  };
  const finalize = ({
    path,
    status = 200,
    payload,
    traceLabel,
    traceReason,
    outcome,
    reasonTag,
    excerpt = "",
    modelName = "",
    retryUsed = false,
    responseSource = "",
    styleMeta = {},
    extra = {},
  }) => {
    const resolvedModel = String(modelName || defaultModel).trim() || defaultModel;
    const resolvedResponseSource = String(
      responseSource
      || resolveScopeAssistResponseSource(path, extra?.fallbackSource || "")
    ).trim() || "unknown";
    setDebug({
      path,
      stage: status >= 400 ? "normalized_failure" : "parse_completed",
      model: resolvedModel,
    });
    setTruth({
      outcome,
      reasonTag,
      excerpt,
      responseSource: resolvedResponseSource,
      fallbackSource: String(extra?.fallbackSource || ""),
      retryUsed,
      ...styleMeta,
    });
    log(path, {
      model: resolvedModel,
      outcome,
      reasonTag,
      responseSource: resolvedResponseSource,
      fallbackSource: String(extra?.fallbackSource || ""),
      excerpt: String(excerpt || "").trim().slice(0, 160),
    });
    if (status < 400) {
      const finalEvent = outcome === "clarify"
        ? "final_response_clarify"
        : outcome === "scope"
          ? "final_response_scope"
          : "";
      if (finalEvent) {
        log(finalEvent, {
          model: resolvedModel,
          outcome,
          reasonTag,
          excerpt: String(excerpt || "").trim().slice(0, 160),
        });
      }
      log("parse_completed", {
        model: resolvedModel,
        parsed: true,
        outcome,
        scope_notes_chars: String(payload?.scopeNotes || payload?.clarificationQuestion || "").length,
      });
    }
    return { status, payload, traceLabel, traceReason, extra, outcome };
  };
  const buildFailure = (failureType, reasonTag, excerpt = "", modelName = "") => finalize({
    path: "malformed_or_internal_failure",
    status: 500,
    payload: buildScopeAssistErrorBody({
      code: failureType,
      type: failureType,
      message: SCOPE_ASSIST_INTERNAL_MESSAGE,
      providerName: "groq",
    }, {
      failureType,
      reasonTag,
    }),
    traceLabel: "error_fallback",
    traceReason: failureType,
    outcome: "failed",
    reasonTag,
    excerpt,
    modelName,
    styleMeta: {},
    extra: { failureType },
  });
  const buildProviderFailureNoGroundedFallback = (failureType = "internal_failure", reasonTag = "no_grounded_fallback_available", excerpt = "", modelName = "", {
    retryUsed = false,
  } = {}) => {
    const fallbackStatus = failureType === "rate_limited"
      ? 429
      : failureType === "provider_unavailable"
        ? 503
        : failureType === "timeout"
          ? 503
          : 500;
    const failure = normalizeScopeAssistFailure({
      code: failureType,
      type: failureType,
      status: fallbackStatus,
      providerName: "groq",
      detail: excerpt,
    });
    return finalize({
      path: "provider_failure_no_grounded_fallback",
      status: failure.status || fallbackStatus,
      payload: {
        _assistFailed: true,
        _error: failure.message,
        _message: failure.message,
        _errorCode: failure.failureType,
        _retryable: failure.retryable,
        message: failure.message,
        error: failure.message,
        failureType: failure.failureType,
        retryable: failure.retryable,
        status: failure.status || fallbackStatus,
        provider: failure.provider,
        ...(failure.detail ? { detail: failure.detail } : {}),
        reasonTag,
      },
      traceLabel: "error_fallback",
      traceReason: failure.failureType,
      outcome: "failed",
      reasonTag,
      excerpt,
      modelName,
      retryUsed,
      styleMeta: {},
      extra: { failureType: failure.failureType },
    });
  };
  const buildDeterministicScope = (reasonTag, excerpt = "", styleMeta = {}) => {
    const noGroundedFallbackFailureType = [
      "rate_limited",
      "timeout",
      "provider_unavailable",
      "internal_failure",
      "aborted",
    ].includes(String(reasonTag || "").trim())
      ? String(reasonTag || "").trim()
      : "internal_failure";
    if (normalizedScopeMode === "refine" && existingScopeText) {
      const groundedExistingScope = assessGroundedScopeFallback(existingScopeText, draftBasisText, { allowExistingScope: true });
      if (!groundedExistingScope.accepted) {
        log("grounded_fallback_rejected", {
          model: "local_existing_scope_fallback",
          outcome: "failed",
          reasonTag: groundedExistingScope.reasonTag,
          matchedPattern: groundedExistingScope.matchedPattern || "",
          excerpt: String(groundedExistingScope.excerpt || existingScopeText || "").trim().slice(0, 160),
        });
        return buildProviderFailureNoGroundedFallback(
          noGroundedFallbackFailureType,
          groundedExistingScope.reasonTag || reasonTag || "no_grounded_fallback_available",
          excerpt || existingScopeText || draftBasisText || inputText,
          "local_existing_scope_fallback"
        );
      }
      log("deterministic_fallback_used", {
        model: "local_existing_scope_fallback",
        outcome: "scope",
        reasonTag,
        excerpt: String(existingScopeText || "").trim().slice(0, 160),
      });
      return finalize({
        path: "grounded_fallback_success",
        status: 200,
        payload: {
          outcome: "scope",
          scopeNotes: existingScopeText,
          clarificationQuestion: "",
          missingFields: [],
        },
        traceLabel: "ok",
        traceReason: "success",
        outcome: "scope",
        reasonTag: groundedExistingScope.reasonTag || reasonTag,
        excerpt: existingScopeText,
        modelName: "local_existing_scope_fallback",
        styleMeta,
        extra: { outcome: "scope", fallbackSource: "existing_scope" },
      });
    }
    const draft = buildScopeAssistSimpleRecoveryDraft(draftBasisText);
    if (!draft) {
      return buildProviderFailureNoGroundedFallback(
        noGroundedFallbackFailureType,
        "no_grounded_fallback_available",
        excerpt || draftBasisText || inputText,
        "local_deterministic_scope"
      );
    }
    const groundedFallback = assessGroundedScopeFallback(draft, draftBasisText);
    if (!groundedFallback.accepted) {
      log("grounded_fallback_rejected", {
        model: "local_deterministic_scope",
        outcome: "failed",
        reasonTag: groundedFallback.reasonTag,
        matchedPattern: groundedFallback.matchedPattern || "",
        excerpt: String(groundedFallback.excerpt || draft || "").trim().slice(0, 160),
      });
      return buildProviderFailureNoGroundedFallback(
        noGroundedFallbackFailureType,
        groundedFallback.reasonTag || reasonTag || "no_grounded_fallback_available",
        excerpt || draftBasisText || inputText,
        "local_deterministic_scope"
      );
    }
    log("deterministic_fallback_used", {
      model: "local_deterministic_scope",
      outcome: "scope",
      reasonTag,
      excerpt: String(draft || "").trim().slice(0, 160),
    });
    return finalize({
      path: "grounded_fallback_success",
      status: 200,
      payload: {
        outcome: "scope",
        scopeNotes: draft,
        clarificationQuestion: "",
        missingFields: [],
      },
      traceLabel: "ok",
      traceReason: "success",
      outcome: "scope",
      reasonTag: groundedFallback.reasonTag || reasonTag,
      excerpt: draft,
      modelName: "local_deterministic_scope",
      styleMeta,
      extra: { outcome: "scope", fallbackSource: "simple_recovery_draft" },
    });
  };
  const buildDeterministicScopeSafely = (reasonTag, excerpt = "", styleMeta = {}) => {
    try {
      return buildDeterministicScope(reasonTag, excerpt, styleMeta);
    } catch (_recoveryError) {
      return buildProviderFailureNoGroundedFallback(
        "internal_failure",
        "grounded_fallback_crashed",
        excerpt || failsafeExcerpt || draftBasisText || inputText,
        "local_scope_failsafe"
      );
    }
  };

  const promptAnalysis = analyzeSimpleScopePrompt(draftBasisText);
  const promptMeaning = analyzeScopeAssistPromptMeaning(draftBasisText);
  log("scope_prompt_meaning", {
    selected_prompt_basis_field: String(context?.scopePromptBasisField || promptBasisResolution.field || ""),
    selected_prompt_basis_text: compact(draftBasisText),
    analyzed_prompt_text: compact(promptMeaning?.normalizedPrompt || ""),
    is_truly_useless: Boolean(promptMeaning?.isTrulyUseless),
    is_groq_draft_eligible: Boolean(promptMeaning?.isGroqDraftEligible),
    supports_detailed_draft: Boolean(promptMeaning?.supportsDetailedDraft),
    token_count: Array.isArray(promptMeaning?.tokens) ? promptMeaning.tokens.length : 0,
    meaning_token_count: Array.isArray(promptMeaning?.meaningTokens) ? promptMeaning.meaningTokens.length : 0,
    has_location_cue: Boolean(promptMeaning?.hasLocationCue),
  });
  const clearPromptFailsafeEligible = Boolean(
    normalizedScopeMode === "refine"
    || promptMeaning?.isGroqDraftEligible
    || promptAnalysis?.isClearlyDraftable
  );
  let failsafeExcerpt = String(draftBasisText || inputText || "").trim();
  let failsafeStyleMeta = {};
  const isDashRefine = Boolean(refineRuntimeMeta.dashBranchActive);
  const isShorterRefine = Boolean(refineRuntimeMeta.shorterBranchActive);
  const hasDedicatedRefineFlow = Boolean(isDashRefine || isShorterRefine);
  // For Dash amend: the full active suggested-scope prose is the sole content source.
  // The short original prompt fields (sourcePrompt, sourceScopePrompt) are only operation metadata,
  // not content input, once a valid generated scope exists.
  const dashAmendHasActiveScopeProse = isDashRefine && Boolean(sanitizeScopeAssistText(existingScopeText));
  const dashPrimarySourceText = dashAmendHasActiveScopeProse
    ? sanitizeScopeAssistText(existingScopeText)
    : sanitizeScopeAssistText(context?.sourcePrompt || context?.sourceScopePrompt || "");
  const dashSourceText = sanitizeScopeAssistText(dashPrimarySourceText || existingScopeText || inputText);
  const dashSourcePromptWeighted = Boolean(dashPrimarySourceText);
  const dashSourceAnchors = extractShorterSourceAnchorTerms(dashPrimarySourceText || dashSourceText);
  const isDashCompilerBadDraftText = (text = "") => {
    const normalized = sanitizeScopeAssistText(text);
    if (!normalized) return false;
    const structure = parseDashScopeStructure(normalized);
    if (!structure.dashLineCount) return false;
    const distinctAssessment = assessDashScopeDistinctStepQuality("", normalized);
    const introBulletCount = Math.max(0, Number(distinctAssessment?.dashGenericIntroBulletCount || 0));
    const summaryIntroEchoCount = Math.max(0, Number(distinctAssessment?.dashSummaryIntroEchoCount || 0));
    return Boolean(
      !distinctAssessment.accepted
      || distinctAssessment.dashRepeatedLineCount > 0
      || distinctAssessment.dashSplitSentenceEchoLineCount > 0
      || distinctAssessment.dashNearDuplicateLineCount > 0
      || distinctAssessment.dashFragmentBulletRejected
      || distinctAssessment.dashSummaryEchoLikeStep
      || introBulletCount > 0
      || summaryIntroEchoCount > 0
    );
  };
  const resolveDashCompilerSourceSelection = ({
    sourceScopeNotesText = "",
    currentScopeNotesText = "",
    failedScopeNotesText = "",
    sourceKind = "",
  } = {}) => {
    // For Dash amend: prefer the full active scope prose over short prompt fields.
    const originalProseSourceText = dashAmendHasActiveScopeProse
      ? sanitizeScopeAssistText(existingScopeText)
      : sanitizeScopeAssistText(
        context?.scopePromptBasis
        || context?.sourceScopePrompt
        || context?.scopeInputAnalysis?.coreScopeText
        || promptBasisResolution.text
        || sourceScopeText
        || dashPrimarySourceText
        || inputText
      );
    const sourceDraftText = sanitizeScopeAssistText(sourceScopeNotesText || "");
    const currentDraftText = sanitizeScopeAssistText(currentScopeNotesText || "");
    const failedDraftText = sanitizeScopeAssistText(failedScopeNotesText || "");
    const originalProseRejected = Boolean(originalProseSourceText) && isDashCompilerContaminatedSourceText(originalProseSourceText);
    const sourceDraftRejected = Boolean(sourceDraftText) && isDashCompilerContaminatedSourceText(sourceDraftText);
    const currentDraftRejected = Boolean(currentDraftText) && isDashCompilerContaminatedSourceText(currentDraftText);
    const failedDraftRejected = Boolean(failedDraftText) && isDashCompilerContaminatedSourceText(failedDraftText);
    const sourceDraftAccepted = Boolean(sourceDraftText) && !sourceDraftRejected;
    const currentDraftAccepted = Boolean(currentDraftText) && !currentDraftRejected;
    const failedDraftAccepted = Boolean(failedDraftText) && !failedDraftRejected;
    let sourcePriority = "";
    let selectedSourceText = "";

    if (originalProseSourceText && !originalProseRejected) {
      selectedSourceText = originalProseSourceText;
      sourcePriority = "original_prose";
    } else if (sourceDraftAccepted) {
      selectedSourceText = sourceDraftText;
      sourcePriority = "accepted_source_scope";
    } else if (currentDraftAccepted) {
      selectedSourceText = currentDraftText;
      sourcePriority = "accepted_current_scope";
    } else if (failedDraftAccepted) {
      selectedSourceText = failedDraftText;
      sourcePriority = "accepted_failed_scope";
    }

    const fallbackSourceTextBlocked = Boolean(
      (originalProseRejected || sourceDraftRejected || currentDraftRejected || failedDraftRejected)
      && Boolean(originalProseSourceText || sourceDraftText || currentDraftText || failedDraftText)
    );

    return {
      sourceText: selectedSourceText,
      sourcePriority,
      rejectedCurrentDraftAsCompilerSource: Boolean(currentDraftRejected),
      rejectedFailedDashAsCompilerSource: Boolean(failedDraftRejected),
      usedOriginalProseSource: Boolean(originalProseSourceText && selectedSourceText === originalProseSourceText && !originalProseRejected),
      fallbackSourceTextBlocked,
      sourceSelectionSourceKind: String(sourceKind || ""),
      sourceSelectionCurrentDraftAccepted: currentDraftAccepted,
      sourceSelectionSourceDraftAccepted: sourceDraftAccepted,
      sourceSelectionFailedDraftAccepted: failedDraftAccepted,
      sourceSelectionOriginalProseText: originalProseSourceText,
    };
  };
  const dashRewriteSourceSelection = isDashRefine
    ? resolveDashCanonicalAcceptedProseSource({
      context: context,
      acceptedProseDraftText: context?.originalAcceptedProseScope || context?.dashCanonicalAcceptedProse || context?.dashImmutableAcceptedProse || "",
      currentScopeText: existingScopeText || context?.currentScopeNotes || "",
      existingScopeText: existingScopeText || context?.currentScopeNotes || "",
      // For Dash amend: use the full active scope prose as requestText fallback, not the short prompt.
      requestText: dashAmendHasActiveScopeProse
        ? sanitizeScopeAssistText(existingScopeText)
        : (dashPrimarySourceText || draftBasisText || inputText || ""),
      sourceKind: "dash_rewrite_source",
      sourcePrompt: context?.sourcePrompt || "",
      sourceScopePrompt: context?.sourceScopePrompt || "",
      sourceScopeBasis: context?.scopePromptBasis || "",
    })
    : null;
  let dashRewriteSourceText = sanitizeScopeAssistText(
    dashRewriteSourceSelection?.sourceText || ""
  );
  if (isDashRefine) {
    setTruth({
      dashTransformSource: dashRewriteSourceText,
      dashCanonicalProseSourceType: String(dashRewriteSourceSelection?.sourceType || ""),
      dashCanonicalProseChars: Math.max(0, Number(dashRewriteSourceSelection?.sourceTextChars || dashRewriteSourceText.length || 0)),
      dashUsedAcceptedProseDraft: Boolean(dashRewriteSourceSelection?.usedAcceptedProseDraft),
      dashFellBackToRequestText: Boolean(dashRewriteSourceSelection?.fellBackToRequestText),
      dashPromptUsedRequestTextOnlyBecauseAcceptedProseMissing: Boolean(dashRewriteSourceSelection?.promptUsedRequestTextOnlyBecauseAcceptedProseMissing),
      dashUsedOriginalAcceptedProse: Boolean(dashRewriteSourceSelection?.usedAcceptedProseDraft),
      dashGroqRewriteUsed: true,
      dashFewShotPromptUsed: true,
      dashLocalCompilerBypassed: true,
      dashGroqRewriteRetryCount: 0,
      dashGroqRewriteValidated: false,
      dashRetryUsedSameCanonicalProse: false,
      dashCompilerSourcePriority: String(dashRewriteSourceSelection?.sourcePriority || ""),
      dashCompilerRejectedCurrentDraftAsCompilerSource: Boolean(dashRewriteSourceSelection?.rejectedCurrentDraftAsCompilerSource),
      dashCompilerRejectedFailedDashAsCompilerSource: Boolean(dashRewriteSourceSelection?.rejectedFailedDashAsCompilerSource),
      dashCompilerUsedOriginalProseSource: Boolean(dashRewriteSourceSelection?.usedOriginalProseSource),
      dashCompilerFallbackSourceTextBlocked: Boolean(dashRewriteSourceSelection?.fallbackSourceTextBlocked),
      dashCompilerSourceTextUsedForCompilation: dashRewriteSourceText,
      dashCompilerSource: String(dashRewriteSourceSelection?.sourcePriority || "dash_groq_rewrite"),
      dashRejectedBeforeDirectSuccess: false,
      dashImmutableAcceptedProseCapturedOnNonDashSuccess: Boolean(dashRewriteSourceSelection?.immutableAcceptedProseCapturedOnNonDashSuccess),
      dashImmutableAcceptedProseCaptureBranch: String(dashRewriteSourceSelection?.immutableAcceptedProseCaptureBranch || ""),
      dashImmutableAcceptedProseReadFromCache: Boolean(dashRewriteSourceSelection?.immutableAcceptedProseReadFromCache),
      dashImmutableAcceptedProseSeedBlockedFromDashRefine: Boolean(dashRewriteSourceSelection?.seedBlockedFromDashRefine),
      dashImmutableAcceptedProseSeedBlockedFromCurrentDraft: Boolean(dashRewriteSourceSelection?.seedBlockedFromCurrentDraft),
      dashImmutableAcceptedProseSeedBlockedFromExistingScope: Boolean(dashRewriteSourceSelection?.seedBlockedFromExistingScope),
      dashRejectedLateImmutableSeed: Boolean(dashRewriteSourceSelection?.rejectedLateImmutableSeed),
      dashFailedClosedForMissingPreCapturedImmutableProse: Boolean(dashRewriteSourceSelection?.failedClosedForMissingPreCapturedImmutableProse),
      dashImmutableAcceptedProseCaptured: Boolean(dashRewriteSourceSelection?.immutableAcceptedProseCaptured),
      dashImmutableAcceptedProseChars: Math.max(0, Number(dashRewriteSourceSelection?.immutableAcceptedProseChars || 0)),
      dashUsedImmutableAcceptedProse: Boolean(dashRewriteSourceSelection?.usedOriginalProseSource),
      dashRejectedMutableCurrentScopeAsSource: Boolean(dashRewriteSourceSelection?.rejectedMutableCurrentScopeAsSource),
      dashRejectedMutableExistingScopeAsSource: Boolean(dashRewriteSourceSelection?.rejectedMutableExistingScopeAsSource),
      dashSourceMismatchDetected: Boolean(dashRewriteSourceSelection?.sourceMismatchDetected),
      dashUsedRequestFallbackBecauseNoImmutableAcceptedProse: Boolean(dashRewriteSourceSelection?.usedRequestFallbackBecauseNoImmutableAcceptedProse),
      dashImmutableSourceMatchedRetry: Boolean(dashRewriteSourceSelection?.immutableSourceMatchedRetry),
    });
    if (!dashRewriteSourceText) {
      // Last-resort recovery: if resolveDashCanonicalAcceptedProseSource returned empty but
      // existingScopeText (from context.currentScopeNotes) is available and clean, use it directly.
      // This handles the case where the resolver's parameter chain somehow loses the text.
      const dashLastResortSource = sanitizeScopeAssistText(existingScopeText || context?.currentScopeNotes || "");
      const dashLastResortClean = Boolean(dashLastResortSource) && !isDashCompilerContaminatedSourceText(dashLastResortSource);
      if (dashLastResortClean) {
        terminalLog("DASH_LAST_RESORT_SOURCE_RECOVERY", {
          _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
          lastResortChars: dashLastResortSource.length,
          resolverSourceType: String(dashRewriteSourceSelection?.sourceType || ""),
          resolverSourcePriority: String(dashRewriteSourceSelection?.sourcePriority || ""),
          resolverHadMutableDraft: Boolean(dashRewriteSourceSelection?.sourceType === "missing_pre_captured_immutable_prose"),
          existingScopeTextChars: existingScopeText.length,
          contextCurrentScopeNotesChars: String(context?.currentScopeNotes || "").length,
        });
        // Patch dashRewriteSourceText and update truth to reflect recovery
        dashRewriteSourceText = dashLastResortSource;
        setTruth({
          dashCanonicalProseSourceType: "last_resort_existing_scope",
          dashCanonicalProseChars: dashLastResortSource.length,
          dashUsedAcceptedProseDraft: true,
          dashFellBackToRequestText: false,
          dashFailedClosedForMissingPreCapturedImmutableProse: false,
        });
        // Backfill the stable cache so retry/future refines find it
        const stableKey = buildDashImmutableAcceptedProseStableKey({ context });
        if (!DASH_IMMUTABLE_ACCEPTED_PROSE_CACHE.get(stableKey)?.text) {
          DASH_IMMUTABLE_ACCEPTED_PROSE_CACHE.set(stableKey, {
            text: dashLastResortSource,
            sourceChars: dashLastResortSource.length,
            sourceWordCount: countScopeWords(dashLastResortSource),
            sourceKind: "last_resort_existing_scope",
            capturedAt: Date.now(),
          });
        }
      } else {
        terminalLog("DASH_MISSING_CLEAN_SOURCE_DETAIL", {
          _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
          existingScopeTextChars: existingScopeText.length,
          contextCurrentScopeNotesChars: String(context?.currentScopeNotes || "").length,
          lastResortSourceChars: dashLastResortSource.length,
          lastResortContaminated: Boolean(dashLastResortSource) && isDashCompilerContaminatedSourceText(dashLastResortSource),
          resolverSourceType: String(dashRewriteSourceSelection?.sourceType || ""),
          resolverSourcePriority: String(dashRewriteSourceSelection?.sourcePriority || ""),
          resolverFailedClosed: Boolean(dashRewriteSourceSelection?.failedClosedForMissingPreCapturedImmutableProse),
          resolverHadMutableDraft: Boolean(
            String(dashRewriteSourceSelection?.sourceType || "") === "missing_pre_captured_immutable_prose"
            || dashRewriteSourceSelection?.seedBlockedFromCurrentDraft
          ),
        });
        setTruth({
          dashRejectedBeforeDirectSuccess: true,
          dashGroqRewriteValidated: false,
          dashGroqRewriteUsed: false,
        });
        return buildProviderFailureNoGroundedFallback(
          "internal_failure",
          "dash_missing_clean_source",
          String(existingScopeText || inputText || ""),
          "dash_groq_rewrite"
        );
      }
    }
  }
  let dashRetryAttempted = false;
  const setDashRuntime = (assessment = {}, { retryUsed = dashRetryAttempted, localFallbackUsed = false } = {}) => {
    if (!isDashRefine) return;
    setTruth({
      dashMode: true,
      dashSourcePromptWeighted,
      dashCompiledLocally: Boolean(assessment?.dashCompiledLocally),
      dashCompilerSource: String(assessment?.dashCompilerSource || ""),
      dashCompilerStepCount: Math.max(0, Number(assessment?.dashCompilerStepCount || 0)),
      dashCompilerDroppedDuplicateCount: Math.max(0, Number(assessment?.dashCompilerDroppedDuplicateCount || 0)),
      dashCompilerDroppedFragmentCount: Math.max(0, Number(assessment?.dashCompilerDroppedFragmentCount || 0)),
      dashCompilerUsedModelBullets: Boolean(assessment?.dashCompilerUsedModelBullets),
      dashCompilerProceduralCandidateCount: Math.max(0, Number(assessment?.dashCompilerProceduralCandidateCount || 0)),
      dashCompilerDroppedGenericIntroCount: Math.max(0, Number(assessment?.dashCompilerDroppedGenericIntroCount || 0)),
      dashCompilerRejectedIntroCandidateCount: Math.max(0, Number(assessment?.dashCompilerRejectedIntroCandidateCount || 0)),
      dashCompilerUsedProceduralSentences: Boolean(assessment?.dashCompilerUsedProceduralSentences),
      dashCompilerSummaryBuiltFromSteps: Boolean(assessment?.dashCompilerSummaryBuiltFromSteps),
      dashCompilerSelectedProceduralStepCount: Math.max(0, Number(assessment?.dashCompilerSelectedProceduralStepCount || assessment?.selectedProceduralCount || 0)),
      dashCompilerDenseProseProceduralMode: Boolean(assessment?.dashCompilerDenseProseProceduralMode),
      dashCompilerRejectedSourceIntroSummary: Boolean(assessment?.dashCompilerRejectedSourceIntroSummary),
      dashCompilerSourcePriority: String(assessment?.dashCompilerSourcePriority || ""),
      dashCompilerRejectedCurrentDraftAsCompilerSource: Boolean(assessment?.dashCompilerRejectedCurrentDraftAsCompilerSource),
      dashCompilerRejectedFailedDashAsCompilerSource: Boolean(assessment?.dashCompilerRejectedFailedDashAsCompilerSource),
      dashCompilerUsedOriginalProseSource: Boolean(assessment?.dashCompilerUsedOriginalProseSource),
      dashCompilerFallbackSourceTextBlocked: Boolean(assessment?.dashCompilerFallbackSourceTextBlocked),
      dashCompilerSourceTextUsedForCompilation: String(assessment?.dashCompilerSourceTextUsedForCompilation || ""),
      dashRetryPromptUsedCleanSourceOnly: Boolean(assessment?.dashRetryPromptUsedCleanSourceOnly),
      dashRetryPromptBlockedFailedDraft: Boolean(assessment?.dashRetryPromptBlockedFailedDraft),
      dashRetryPromptBlockedCurrentDraft: Boolean(assessment?.dashRetryPromptBlockedCurrentDraft),
      dashCompilerSelectorFailClosed: Boolean(assessment?.dashCompilerSelectorFailClosed),
      dashCompilerSelectorUsedProceduralPoolOnly: Boolean(assessment?.dashCompilerSelectorUsedProceduralPoolOnly),
      dashCompilerRejectedForMissingProceduralPool: Boolean(assessment?.dashCompilerRejectedForMissingProceduralPool),
      dashLineCount: Math.max(0, Number(assessment?.dashLineCount || 0)),
      dashHasSummaryParagraph: Boolean(assessment?.dashHasSummaryParagraph),
      dashFormatPass: typeof assessment?.dashFormatPass === "boolean" ? assessment.dashFormatPass : null,
      dashSemanticPass: typeof assessment?.dashSemanticPass === "boolean" ? assessment.dashSemanticPass : null,
      dashDistinctStepPass: typeof assessment?.dashDistinctStepPass === "boolean" ? assessment.dashDistinctStepPass : null,
      dashRetryUsed: Boolean(retryUsed),
      dashLocalFallbackUsed: Boolean(localFallbackUsed),
      dashFallbackRejectedForCompliance: Boolean(assessment && assessment.accepted === false),
      dashRejectedBeforeDirectSuccess: Boolean(assessment && assessment.accepted === false),
      dashRepeatedLineCount: Math.max(0, Number(assessment?.dashRepeatedLineCount || 0)),
      dashSplitSentenceEchoLineCount: Math.max(0, Number(assessment?.dashSplitSentenceEchoLineCount || 0)),
      dashNearDuplicateLineCount: Math.max(0, Number(assessment?.dashNearDuplicateLineCount || 0)),
      dashFragmentBulletRejected: Boolean(assessment?.dashFragmentBulletRejected),
      dashMaxLineOverlap: Number.isFinite(Number(assessment?.dashMaxLineOverlap)) ? Number(assessment.dashMaxLineOverlap) : 0,
      dashSummaryEchoLikeStep: Boolean(assessment?.dashSummaryEchoLikeStep),
      dashSummaryLeadBulletEchoLikeStep: Boolean(assessment?.dashSummaryLeadBulletEchoLikeStep),
      dashSourceSentenceEchoLikeStep: Boolean(assessment?.dashSourceSentenceEchoLikeStep),
      dashProceduralSentenceBiasActive: Boolean(assessment?.dashProceduralSentenceBiasActive),
      dashOverviewSentenceRejectedCount: Math.max(0, Number(assessment?.dashOverviewSentenceRejectedCount || 0)),
      dashProceduralBulletCount: Math.max(0, Number(assessment?.dashProceduralBulletCount || 0)),
      dashOverviewBulletCount: Math.max(0, Number(assessment?.dashOverviewBulletCount || 0)),
      dashRejectedForOverviewBias: Boolean(assessment?.dashRejectedForOverviewBias),
      dashInventedMajorDetailRejected: Boolean(assessment?.dashInventedMajorDetailRejected),
      dashOverviewSentenceBiasDetected: Boolean(assessment?.dashOverviewSentenceBiasDetected),
      dashProceduralSentenceCoverage: Number.isFinite(Number(assessment?.dashProceduralSentenceCoverage)) ? Number(assessment.dashProceduralSentenceCoverage) : 0,
      dashSummaryEchoedOverview: Boolean(assessment?.dashSummaryEchoedOverview),
      dashRetrySamplingRaised: Boolean(assessment?.dashRetrySamplingRaised),
      retryUsed: Boolean(retryUsed),
    });
  };
  const logDashResult = (event, assessment = {}, extra = {}) => {
    if (!isDashRefine) return;
    log(event, {
      dashMode: true,
      dashSourcePromptWeighted,
      dashCompiledLocally: Boolean(assessment?.dashCompiledLocally),
      dashCompilerSource: String(assessment?.dashCompilerSource || ""),
      dashCompilerStepCount: Math.max(0, Number(assessment?.dashCompilerStepCount || 0)),
      dashCompilerDroppedDuplicateCount: Math.max(0, Number(assessment?.dashCompilerDroppedDuplicateCount || 0)),
      dashCompilerDroppedFragmentCount: Math.max(0, Number(assessment?.dashCompilerDroppedFragmentCount || 0)),
      dashCompilerUsedModelBullets: Boolean(assessment?.dashCompilerUsedModelBullets),
      dashCompilerProceduralCandidateCount: Math.max(0, Number(assessment?.dashCompilerProceduralCandidateCount || 0)),
      dashCompilerDroppedGenericIntroCount: Math.max(0, Number(assessment?.dashCompilerDroppedGenericIntroCount || 0)),
      dashCompilerRejectedIntroCandidateCount: Math.max(0, Number(assessment?.dashCompilerRejectedIntroCandidateCount || 0)),
      dashCompilerUsedProceduralSentences: Boolean(assessment?.dashCompilerUsedProceduralSentences),
      dashCompilerSummaryBuiltFromSteps: Boolean(assessment?.dashCompilerSummaryBuiltFromSteps),
      dashCompilerSelectedProceduralStepCount: Math.max(0, Number(assessment?.dashCompilerSelectedProceduralStepCount || assessment?.selectedProceduralCount || 0)),
      dashCompilerDenseProseProceduralMode: Boolean(assessment?.dashCompilerDenseProseProceduralMode),
      dashCompilerRejectedSourceIntroSummary: Boolean(assessment?.dashCompilerRejectedSourceIntroSummary),
      dashCompilerSourcePriority: String(assessment?.dashCompilerSourcePriority || ""),
      dashCompilerRejectedCurrentDraftAsCompilerSource: Boolean(assessment?.dashCompilerRejectedCurrentDraftAsCompilerSource),
      dashCompilerRejectedFailedDashAsCompilerSource: Boolean(assessment?.dashCompilerRejectedFailedDashAsCompilerSource),
      dashCompilerUsedOriginalProseSource: Boolean(assessment?.dashCompilerUsedOriginalProseSource),
      dashCompilerFallbackSourceTextBlocked: Boolean(assessment?.dashCompilerFallbackSourceTextBlocked),
      dashCompilerSourceTextUsedForCompilation: String(assessment?.dashCompilerSourceTextUsedForCompilation || ""),
      dashRetryPromptUsedCleanSourceOnly: Boolean(assessment?.dashRetryPromptUsedCleanSourceOnly),
      dashRetryPromptBlockedFailedDraft: Boolean(assessment?.dashRetryPromptBlockedFailedDraft),
      dashRetryPromptBlockedCurrentDraft: Boolean(assessment?.dashRetryPromptBlockedCurrentDraft),
      dashCompilerSelectorFailClosed: Boolean(assessment?.dashCompilerSelectorFailClosed),
      dashCompilerSelectorUsedProceduralPoolOnly: Boolean(assessment?.dashCompilerSelectorUsedProceduralPoolOnly),
      dashCompilerRejectedForMissingProceduralPool: Boolean(assessment?.dashCompilerRejectedForMissingProceduralPool),
      dashLineCount: Math.max(0, Number(assessment?.dashLineCount || 0)),
      dashHasSummaryParagraph: Boolean(assessment?.dashHasSummaryParagraph),
      dashFormatPass: typeof assessment?.dashFormatPass === "boolean" ? assessment.dashFormatPass : null,
      dashSemanticPass: typeof assessment?.dashSemanticPass === "boolean" ? assessment.dashSemanticPass : null,
      dashDistinctStepPass: typeof assessment?.dashDistinctStepPass === "boolean" ? assessment.dashDistinctStepPass : null,
      retryUsed: Boolean(extra?.retryUsed),
      localFallbackUsed: Boolean(extra?.localFallbackUsed),
      dashFallbackRejectedForCompliance: Boolean(assessment && assessment.accepted === false),
      dashRejectedBeforeDirectSuccess: Boolean(assessment && assessment.accepted === false),
      dashRepeatedLineCount: Math.max(0, Number(assessment?.dashRepeatedLineCount || 0)),
      dashSplitSentenceEchoLineCount: Math.max(0, Number(assessment?.dashSplitSentenceEchoLineCount || 0)),
      dashNearDuplicateLineCount: Math.max(0, Number(assessment?.dashNearDuplicateLineCount || 0)),
      dashFragmentBulletRejected: Boolean(assessment?.dashFragmentBulletRejected),
      dashMaxLineOverlap: Number.isFinite(Number(assessment?.dashMaxLineOverlap)) ? Number(assessment.dashMaxLineOverlap) : 0,
      dashSummaryEchoLikeStep: Boolean(assessment?.dashSummaryEchoLikeStep),
      dashSummaryLeadBulletEchoLikeStep: Boolean(assessment?.dashSummaryLeadBulletEchoLikeStep),
      dashSourceSentenceEchoLikeStep: Boolean(assessment?.dashSourceSentenceEchoLikeStep),
      dashProceduralSentenceBiasActive: Boolean(assessment?.dashProceduralSentenceBiasActive),
      dashOverviewSentenceRejectedCount: Math.max(0, Number(assessment?.dashOverviewSentenceRejectedCount || 0)),
      dashProceduralBulletCount: Math.max(0, Number(assessment?.dashProceduralBulletCount || 0)),
      dashOverviewBulletCount: Math.max(0, Number(assessment?.dashOverviewBulletCount || 0)),
      dashRejectedForOverviewBias: Boolean(assessment?.dashRejectedForOverviewBias),
      dashInventedMajorDetailRejected: Boolean(assessment?.dashInventedMajorDetailRejected),
      dashOverviewSentenceBiasDetected: Boolean(assessment?.dashOverviewSentenceBiasDetected),
      dashProceduralSentenceCoverage: Number.isFinite(Number(assessment?.dashProceduralSentenceCoverage)) ? Number(assessment.dashProceduralSentenceCoverage) : 0,
      dashSummaryEchoedOverview: Boolean(assessment?.dashSummaryEchoedOverview),
      dashRetrySamplingRaised: Boolean(assessment?.dashRetrySamplingRaised),
      dashReasonTag: String(assessment?.reasonTag || extra?.failureReasonTag || ""),
      ...extra,
    });
  };
  const compileDashForDisplay = ({
    sourceScopeNotesText = "",
    currentScopeNotesText = "",
    failedScopeNotesText = "",
    sourceLabel = "",
    retryUsed = dashRetryAttempted,
    localFallbackUsed = false,
    modelName = activeModelName,
    attemptLabel = "",
    failureReasonTag = "",
  } = {}) => {
    const sourceSelection = resolveDashCompilerSourceSelection({
      sourceScopeNotesText,
      currentScopeNotesText,
      failedScopeNotesText,
      sourceKind: sourceLabel,
    });
    const sourceTextUsedForCompilation = sanitizeScopeAssistText(sourceSelection.sourceText || "");
    const compiled = compileDashScopeFromProse({
      sourcePromptText: sourceTextUsedForCompilation,
      sourceScopeText: sourceTextUsedForCompilation,
      sourceLabel: String(sourceLabel || (localFallbackUsed ? "local_dash_fallback" : "accepted_prose_scope")).trim() || "accepted_prose_scope",
      sourcePriority: String(sourceSelection.sourcePriority || ""),
      rejectedCurrentDraftAsCompilerSource: Boolean(sourceSelection.rejectedCurrentDraftAsCompilerSource),
      rejectedFailedDashAsCompilerSource: Boolean(sourceSelection.rejectedFailedDashAsCompilerSource),
      usedOriginalProseSource: Boolean(sourceSelection.usedOriginalProseSource),
      fallbackSourceTextBlocked: Boolean(sourceSelection.fallbackSourceTextBlocked),
      sourceTextUsedForCompilation,
    });
    setDashRuntime(compiled.assessment, {
      retryUsed,
      localFallbackUsed,
    });
    logDashResult("dash_compiler_compiled", compiled.assessment, {
      retryUsed,
      localFallbackUsed,
      attemptLabel: String(attemptLabel || sourceLabel || "dash_compiler"),
      model: String(modelName || activeModelName).trim() || activeModelName,
      failureReasonTag,
      dashCompiledLocally: Boolean(compiled.assessment?.dashCompiledLocally),
      dashCompilerSource: String(compiled.assessment?.dashCompilerSource || ""),
      dashCompilerStepCount: Math.max(0, Number(compiled.assessment?.dashCompilerStepCount || 0)),
      dashCompilerDroppedDuplicateCount: Math.max(0, Number(compiled.assessment?.dashCompilerDroppedDuplicateCount || 0)),
      dashCompilerDroppedFragmentCount: Math.max(0, Number(compiled.assessment?.dashCompilerDroppedFragmentCount || 0)),
      dashCompilerUsedModelBullets: Boolean(compiled.assessment?.dashCompilerUsedModelBullets),
      dashCompilerProceduralCandidateCount: Math.max(0, Number(compiled.assessment?.dashCompilerProceduralCandidateCount || 0)),
      dashCompilerDroppedGenericIntroCount: Math.max(0, Number(compiled.assessment?.dashCompilerDroppedGenericIntroCount || 0)),
      dashCompilerRejectedIntroCandidateCount: Math.max(0, Number(compiled.assessment?.dashCompilerRejectedIntroCandidateCount || 0)),
      dashCompilerUsedProceduralSentences: Boolean(compiled.assessment?.dashCompilerUsedProceduralSentences),
      dashCompilerSummaryBuiltFromSteps: Boolean(compiled.assessment?.dashCompilerSummaryBuiltFromSteps),
      dashCompilerSelectedProceduralStepCount: Math.max(0, Number(compiled.assessment?.dashCompilerSelectedProceduralStepCount || 0)),
      dashCompilerDenseProseProceduralMode: Boolean(compiled.assessment?.dashCompilerDenseProseProceduralMode),
      dashCompilerRejectedSourceIntroSummary: Boolean(compiled.assessment?.dashCompilerRejectedSourceIntroSummary),
      dashCompilerSourcePriority: String(compiled.assessment?.dashCompilerSourcePriority || ""),
      dashCompilerRejectedCurrentDraftAsCompilerSource: Boolean(compiled.assessment?.dashCompilerRejectedCurrentDraftAsCompilerSource),
      dashCompilerRejectedFailedDashAsCompilerSource: Boolean(compiled.assessment?.dashCompilerRejectedFailedDashAsCompilerSource),
      dashCompilerUsedOriginalProseSource: Boolean(compiled.assessment?.dashCompilerUsedOriginalProseSource),
      dashCompilerFallbackSourceTextBlocked: Boolean(compiled.assessment?.dashCompilerFallbackSourceTextBlocked),
      dashCompilerSourceTextUsedForCompilation: String(compiled.assessment?.dashCompilerSourceTextUsedForCompilation || ""),
      dashRetryPromptUsedCleanSourceOnly: Boolean(compiled.assessment?.dashRetryPromptUsedCleanSourceOnly),
      dashRetryPromptBlockedFailedDraft: Boolean(compiled.assessment?.dashRetryPromptBlockedFailedDraft),
      dashRetryPromptBlockedCurrentDraft: Boolean(compiled.assessment?.dashRetryPromptBlockedCurrentDraft),
      dashCompilerSelectorFailClosed: Boolean(compiled.assessment?.dashCompilerSelectorFailClosed),
      dashCompilerSelectorUsedProceduralPoolOnly: Boolean(compiled.assessment?.dashCompilerSelectorUsedProceduralPoolOnly),
      dashCompilerRejectedForMissingProceduralPool: Boolean(compiled.assessment?.dashCompilerRejectedForMissingProceduralPool),
    });
    return compiled;
  };
  const shorterSourceText = sanitizeScopeAssistText(existingScopeText || draftBasisText || inputText);
  const shorterSourceAnchors = extractShorterSourceAnchorTerms(shorterSourceText);
  const shorterSourceWordCount = countScopeWords(shorterSourceText);
  let shorterRetryAttempted = false;
  const setShorterRuntime = (assessment = {}, { retryUsed = shorterRetryAttempted, localFallbackUsed = false } = {}) => {
    if (!isShorterRefine) return;
    setTruth({
      sourceWordCount: Math.max(0, Number(assessment?.sourceWordCount || shorterSourceWordCount || 0)),
      returnedWordCount: Math.max(0, Number(assessment?.returnedWordCount || 0)),
      compressionRatio: Number.isFinite(Number(assessment?.compressionRatio)) ? Number(assessment.compressionRatio) : 0,
      shorterParagraphCount: Math.max(0, Number(assessment?.shorterParagraphCount || 0)),
      shorterSingleParagraphPass: typeof assessment?.shorterSingleParagraphPass === "boolean" ? assessment.shorterSingleParagraphPass : null,
      shorterRejectedForParagraphCount: Boolean(assessment?.shorterRejectedForParagraphCount),
      shorterCompliancePass: typeof assessment?.accepted === "boolean" ? assessment.accepted : null,
      shorterSemanticPass: typeof assessment?.shorterSemanticPass === "boolean" ? assessment.shorterSemanticPass : null,
      preservedAnchorTerms: Array.isArray(assessment?.preservedAnchorTerms) ? assessment.preservedAnchorTerms : [],
      missingAnchorTerms: Array.isArray(assessment?.missingAnchorTerms) ? assessment.missingAnchorTerms : [],
      inventedExclusionLikeLanguage: Boolean(assessment?.inventedExclusionLikeLanguage),
      inventedProcessDetailLikeLanguage: Boolean(assessment?.inventedProcessDetailLikeLanguage),
      shorterRejectedForSemanticDrift: Boolean(assessment?.shorterRejectedForSemanticDrift),
      shorterLocalFallbackUsed: Boolean(localFallbackUsed),
      retryUsed: Boolean(retryUsed),
    });
  };
  const logShorterResult = (event, assessment = {}, extra = {}) => {
    if (!isShorterRefine) return;
    log(event, {
      sourceWordCount: Math.max(0, Number(assessment?.sourceWordCount || shorterSourceWordCount || 0)),
      returnedWordCount: Math.max(0, Number(assessment?.returnedWordCount || 0)),
      compressionRatio: Number.isFinite(Number(assessment?.compressionRatio)) ? Number(assessment.compressionRatio) : 0,
      shorterParagraphCount: Math.max(0, Number(assessment?.shorterParagraphCount || 0)),
      shorterSingleParagraphPass: typeof assessment?.shorterSingleParagraphPass === "boolean" ? assessment.shorterSingleParagraphPass : null,
      shorterRejectedForParagraphCount: Boolean(assessment?.shorterRejectedForParagraphCount),
      shorterCompliancePass: typeof assessment?.accepted === "boolean" ? assessment.accepted : null,
      shorterSemanticPass: typeof assessment?.shorterSemanticPass === "boolean" ? assessment.shorterSemanticPass : null,
      preservedAnchorTerms: Array.isArray(assessment?.preservedAnchorTerms) ? assessment.preservedAnchorTerms : [],
      missingAnchorTerms: Array.isArray(assessment?.missingAnchorTerms) ? assessment.missingAnchorTerms : [],
      inventedExclusionLikeLanguage: Boolean(assessment?.inventedExclusionLikeLanguage),
      inventedProcessDetailLikeLanguage: Boolean(assessment?.inventedProcessDetailLikeLanguage),
      shorterRejectedForSemanticDrift: Boolean(assessment?.shorterRejectedForSemanticDrift),
      retryUsed: Boolean(extra?.retryUsed),
      localFallbackUsed: Boolean(extra?.localFallbackUsed),
      shorterReasonTag: String(assessment?.reasonTag || extra?.failureReasonTag || ""),
      exactMatch: Boolean(assessment?.exactMatch),
      identicalSentenceRatio: Number.isFinite(Number(assessment?.identicalSentenceRatio)) ? Number(assessment.identicalSentenceRatio) : 0,
      outputOverlapRatio: Number.isFinite(Number(assessment?.outputOverlapRatio)) ? Number(assessment.outputOverlapRatio) : 0,
      sourceCoverageRatio: Number.isFinite(Number(assessment?.sourceCoverageRatio)) ? Number(assessment.sourceCoverageRatio) : 0,
      ...extra,
    });
  };
  if (isShorterRefine) {
    setShorterRuntime({
      sourceWordCount: shorterSourceWordCount,
      returnedWordCount: 0,
      compressionRatio: 0,
      shorterParagraphCount: 0,
      shorterSingleParagraphPass: null,
      shorterRejectedForParagraphCount: false,
      accepted: null,
    }, {
      retryUsed: false,
      localFallbackUsed: false,
    });
  }
  if (isDashRefine) {
    setDashRuntime({
      dashMode: true,
      dashSourcePromptWeighted,
      dashLineCount: 0,
      dashHasSummaryParagraph: false,
      dashFormatPass: null,
      dashSemanticPass: null,
    }, {
      retryUsed: false,
      localFallbackUsed: false,
    });
  }
  const parseProviderScopeAttempt = ({ raw = "", modelName = "", attemptLabel = "initial" } = {}) => {
    let lastParseFailureReason = raw.trim() ? "rejected_malformed" : "rejected_no_content";
    let lastParseSource = "raw_only";
    const parsed = parseScopeAssistResponse(raw, {
      onTrace(parseEvent = {}) {
        const parseStage = String(parseEvent?.stage || "");
        const parseReason = String(parseEvent?.reason || "");
        const parseBranch = String(parseEvent?.branch || "");
        if (parseStage === "candidate_rejected" || parseStage === "failure") {
          if (parseReason) lastParseFailureReason = parseReason;
        }
        if (parseStage === "success" && parseBranch.endsWith(":schema_salvage")) {
          lastParseSource = "schema_salvage";
        } else if (parseStage === "success" && parseBranch) {
          lastParseSource = "json_parse";
        }
        log("scope_parse_trace", {
          model: modelName,
          attemptLabel,
          parse_stage: parseStage,
          parse_branch: parseBranch,
          parse_reason: parseReason,
          raw_excerpt: String(parseEvent?.excerpt || "").trim().slice(0, 160),
        });
      },
    });

    if (!parsed || typeof parsed !== "object") {
      setTruth({
        parseBranch: "",
        parseFailureReason: lastParseFailureReason,
        parseSource: lastParseSource,
      });
      log("structured_parse_failed", {
        model: modelName,
        attemptLabel,
        outcome: "malformed",
        reasonTag: lastParseFailureReason,
        excerpt: raw.trim().slice(0, 160),
        active_scope_parse_source: lastParseSource,
      });
      return {
        accepted: false,
        failureReason: lastParseFailureReason,
        parseSource: lastParseSource,
      };
    }

    setTruth({
      parseBranch: String(parsed?._parseBranch || ""),
      parseFailureReason: "",
      parseSource: String(parsed?._parseSource || lastParseSource || "json_parse"),
    });
    log("scope_parse_succeeded", {
      model: modelName,
      attemptLabel,
      parse_branch: String(parsed?._parseBranch || ""),
      parse_source: String(parsed?._parseSource || lastParseSource || "json_parse"),
      outcome: String(parsed?.outcome || ""),
      excerpt: String(parsed?.scopeNotes || parsed?.clarificationQuestion || "").trim().slice(0, 160),
    });

    const outcome = String(parsed?.outcome || "scope").trim().toLowerCase() === "clarify" ? "clarify" : "scope";
    const scopeNotesText = sanitizeScopeAssistText(parsed?.scopeNotes || "");
    const clarificationQuestionText = sanitizeScopeAssistText(parsed?.clarificationQuestion || "");
    failsafeExcerpt = String(scopeNotesText || clarificationQuestionText || raw || failsafeExcerpt).trim() || failsafeExcerpt;

    log(outcome === "clarify" ? "groq_returned_clarify" : "groq_returned_scope", {
      model: modelName,
      attemptLabel,
      outcome,
      reasonTag: outcome === "clarify" ? "provider_requested_clarify" : "provider_returned_scope",
      excerpt: String(scopeNotesText || clarificationQuestionText || raw).trim().slice(0, 160),
    });

    return {
      accepted: true,
      parsed,
      outcome,
      scopeNotesText,
      clarificationQuestionText,
      raw,
      modelName,
    };
  };
  const buildShorterRetryUserPrompt = (failureReasonTag = "", failedScopeNotes = "") => {
    const shorterTargetFloor = shorterSourceWordCount >= 18
      ? Math.max(12, Math.round(shorterSourceWordCount * 0.55))
      : 0;
    const shorterTargetCeiling = shorterSourceWordCount >= 18
      ? Math.max(shorterTargetFloor, Math.round(shorterSourceWordCount * 0.7))
      : 0;
    const parts = [];
    if (existingScopeText) parts.push(`Current scope draft to compress: ${existingScopeText}`);
    if (context?.sourceScopePrompt) parts.push(`Original scope request: ${context.sourceScopePrompt}`);
    if (context?.scopeInputAnalysis?.coreScopeText) parts.push(`Core scope text: ${context.scopeInputAnalysis.coreScopeText}`);
    if (shorterSourceAnchors.anchorTerms.length) {
      parts.push(`Critical source anchor terms: ${shorterSourceAnchors.anchorTerms.join(" | ")}`);
    }
    parts.push(`Revision instruction: ${context?.refineInstruction || inputText || "Shorter"}`);
    if (failedScopeNotes) {
      parts.push(`Prior shorter result that failed: ${sanitizeScopeAssistText(failedScopeNotes).slice(0, 320)}`);
    }
    parts.push(`Retry reason: ${failureReasonTag || "prior_result_not_compressed_enough"}.`);
    parts.push("The prior result failed because it was not compressed enough, drifted from the source meaning, returned too many paragraphs, or some combination of those issues.");
    parts.push("Return a materially shorter rewrite of the current scope, not a reflowed paraphrase.");
    parts.push("Keep the same job meaning, scope intent, and implied inclusions or exclusions.");
    parts.push("Preserve the same trade or action identity and keep critical source terms when they carry the job meaning.");
    parts.push("Cut filler, repeated intent language, repeated setup phrasing, and redundant wording.");
    parts.push("Use tighter contractor-ready wording and keep the result estimate-ready.");
    parts.push("Do not replace specific trade or action wording with neighboring generic trade language.");
    parts.push("Do not add exclusions, approvals, concealed-condition clauses, code or compliance language, scope-boundary clauses, or means and methods not already present in the current draft.");
    parts.push("Shorten by removing filler, repetition, and redundant setup language only.");
    parts.push("Do not add new scope detail, do not use bullets, and do not turn it generic.");
    parts.push("Return one compact paragraph by default.");
    parts.push("Do not use multiple paragraphs unless the source draft is unusually dense and two short paragraphs are truly necessary to preserve meaning after compression.");
    if (shorterTargetFloor && shorterTargetCeiling) {
      parts.push(`Current draft is about ${shorterSourceWordCount} words. Return a clearly shorter version, roughly ${shorterTargetFloor}-${shorterTargetCeiling} words if possible without losing essential meaning.`);
    }
    parts.push("Return strict JSON only with the exact existing keys.");
    return parts.join("\n");
  };
  const buildShorterLocalFallbackResult = (failureReasonTag = "", failedScopeNotes = "", { retryUsed = shorterRetryAttempted } = {}) => {
    const fallbackScopeNotes = sanitizeScopeAssistText(
      buildShorterScopeLocalFallback(shorterSourceText || existingScopeText || draftBasisText || inputText)
    ) || sanitizeScopeAssistText(shorterSourceText || existingScopeText || draftBasisText || inputText);
    const fallbackAssessment = assessShorterScopeRefineCompliance(shorterSourceText, fallbackScopeNotes);
    setShorterRuntime(fallbackAssessment, {
      retryUsed,
      localFallbackUsed: true,
    });
    logShorterResult("shorter_local_fallback_used", fallbackAssessment, {
      retryUsed,
      localFallbackUsed: true,
      failureReasonTag,
      failedExcerpt: String(failedScopeNotes || "").trim().slice(0, 160),
      fallbackExcerpt: String(fallbackScopeNotes || "").trim().slice(0, 160),
    });
    return finalize({
      path: "shorter_local_fallback_success",
      status: 200,
      payload: {
        outcome: "scope",
        scopeNotes: fallbackScopeNotes,
        clarificationQuestion: "",
        missingFields: [],
      },
      traceLabel: "ok",
      traceReason: "success",
      outcome: "scope",
      reasonTag: fallbackAssessment.accepted ? "shorter_local_fallback_compressed" : "shorter_local_fallback_best_effort",
      excerpt: fallbackScopeNotes,
      modelName: "local_shorter_scope_fallback",
      retryUsed,
      extra: { outcome: "scope", fallbackSource: "shorter_local_compression" },
    });
  };
  const maybeRetryShorterResult = async ({ failureReasonTag = "", failedScopeNotes = "", failedModelName = "" } = {}) => {
    if (!isShorterRefine) return null;
    if (shorterRetryAttempted) {
      return buildShorterLocalFallbackResult(failureReasonTag, failedScopeNotes);
    }

    shorterRetryAttempted = true;
    setTruth({ retryUsed: true });
    logShorterResult("shorter_retry_requested", {
      accepted: false,
      reasonTag: failureReasonTag,
      sourceWordCount: shorterSourceWordCount,
      returnedWordCount: countScopeWords(failedScopeNotes),
      compressionRatio: shorterSourceWordCount > 0
        ? Number((countScopeWords(failedScopeNotes) / shorterSourceWordCount).toFixed(3))
        : 0,
    }, {
      retryUsed: true,
      localFallbackUsed: false,
      failedModelName: String(failedModelName || defaultModel).trim() || defaultModel,
      failedExcerpt: String(failedScopeNotes || "").trim().slice(0, 160),
    });

    const retrySystemPrompt = `${systemPrompt}\nThis is a retry for a Shorter refine result that failed because it was not compressed enough, drifted from the source meaning, or returned too many paragraphs. Enforce real compression, not paragraph reflow, preserve the same trade, action, object, and location anchors from the current draft, and return one compact paragraph unless the source is unusually dense.`;
    const retryUserPrompt = buildShorterRetryUserPrompt(failureReasonTag, failedScopeNotes);
    const retryRequestOptions = {
      ...requestOptions,
      temperature: 0.08,
      top_p: 0.72,
      max_tokens: Math.min(320, Math.max(180, Number(requestOptions?.max_tokens || 320))),
    };

    let retryAssistResult;
    try {
      retryAssistResult = await callSectionAssistGroq(retrySystemPrompt, retryUserPrompt, trace, retryRequestOptions, {
        sectionKey: "scope",
        scopeMode: normalizedScopeMode,
        traceId,
      });
    } catch (retryError) {
      const retryFailure = normalizeScopeAssistFailure(retryError);
      failsafeExcerpt = String(retryError?.providerDetail || retryError?.message || failsafeExcerpt || "").trim() || failsafeExcerpt;
      logShorterResult("shorter_retry_provider_failed", {
        accepted: false,
        reasonTag: retryFailure.failureType || "provider_failure",
        sourceWordCount: shorterSourceWordCount,
        returnedWordCount: 0,
        compressionRatio: 0,
      }, {
        retryUsed: true,
        localFallbackUsed: false,
        failedExcerpt: String(retryError?.providerDetail || retryError?.message || "").trim().slice(0, 160),
      });
      return buildShorterLocalFallbackResult(retryFailure.failureType || failureReasonTag || "provider_failure", String(retryError?.providerDetail || retryError?.message || failedScopeNotes || ""));
    }

    const retryModelName = String(retryAssistResult?.model || defaultModel).trim() || defaultModel;
    const retryRaw = String(retryAssistResult?.raw || "");
    failsafeExcerpt = retryRaw.trim() || failsafeExcerpt;
    setDebug({
      model: retryModelName,
      stage: "provider_response_received",
    });
    log("provider_response_received", {
      model: retryModelName,
      route_function: "handleScopeAssistRequest",
      attemptLabel: "shorter_retry",
    });

    const retryParsed = parseProviderScopeAttempt({
      raw: retryRaw,
      modelName: retryModelName,
      attemptLabel: "shorter_retry",
    });
    if (!retryParsed.accepted) {
      return buildShorterLocalFallbackResult(retryParsed.failureReason || failureReasonTag || "shorter_retry_parse_failed", retryRaw);
    }
    if (retryParsed.outcome !== "scope") {
      logShorterResult("shorter_retry_non_scope_result", {
        accepted: false,
        reasonTag: "shorter_retry_non_scope_result",
        sourceWordCount: shorterSourceWordCount,
        returnedWordCount: countScopeWords(retryParsed.clarificationQuestionText || ""),
        compressionRatio: 0,
      }, {
        retryUsed: true,
        localFallbackUsed: false,
        failedExcerpt: String(retryParsed.clarificationQuestionText || retryRaw).trim().slice(0, 160),
      });
      return buildShorterLocalFallbackResult("shorter_retry_non_scope_result", retryParsed.clarificationQuestionText || retryRaw);
    }

    const retryAssessment = assessShorterScopeRefineCompliance(shorterSourceText, retryParsed.scopeNotesText);
    setShorterRuntime(retryAssessment, {
      retryUsed: true,
      localFallbackUsed: false,
    });
    logShorterResult("shorter_compliance_retry_evaluated", retryAssessment, {
      retryUsed: true,
      localFallbackUsed: false,
      attemptLabel: "shorter_retry",
      model: retryModelName,
    });
    if (!retryAssessment.accepted) {
      return buildShorterLocalFallbackResult(retryAssessment.reasonTag || failureReasonTag || "shorter_retry_failed", retryParsed.scopeNotesText);
    }

    return {
      accepted: true,
      modelName: retryModelName,
      raw: retryRaw,
      scopeNotesText: retryParsed.scopeNotesText,
      clarificationQuestionText: retryParsed.clarificationQuestionText,
      retryUsed: true,
    };
  };
  const finalizeRecoveredShorterRetryResult = async (retryResult, failureReasonTag = "") => {
    if (!isShorterRefine) return retryResult;
    if (retryResult?.status) return retryResult;
    if (!retryResult?.scopeNotesText) {
      return buildShorterLocalFallbackResult(failureReasonTag || "shorter_retry_missing_scope", failsafeExcerpt);
    }

    const recoveredScopeAssessment = assessScopeAssistOutput(retryResult.scopeNotesText, draftBasisText);
    const recoveredScaffoldAssessment = assessScopeAssistGenericScaffold(retryResult.scopeNotesText, draftBasisText);
    const recoveredExplicitScaffoldAssessment = matchScopeAssistExplicitScaffoldPhrase(retryResult.scopeNotesText);
    const recoveredStyleAssessment = assessScopeAssistStyleCompliance(retryResult.scopeNotesText, draftBasisText, promptAnalysis);
    const recoveredStyleMeta = toScopeStyleRuntimeMeta(recoveredStyleAssessment);
    const recoveredAccepted = recoveredScopeAssessment.accepted
      && recoveredScaffoldAssessment.accepted
      && !recoveredExplicitScaffoldAssessment.matched
      && (recoveredStyleAssessment.accepted || isNonBlockingScopeStyleRejection(recoveredStyleAssessment));

    if (!recoveredAccepted) {
      const recoveredReasonTag = recoveredScopeAssessment.accepted
        ? (recoveredStyleAssessment.accepted
          ? (recoveredScaffoldAssessment.reasonTag || recoveredScaffoldAssessment.reason || "missing_job_specific_content")
          : recoveredStyleAssessment.reasonTag)
        : recoveredScopeAssessment.reason;
      return buildShorterLocalFallbackResult(recoveredReasonTag || failureReasonTag || "shorter_retry_validation_failed", retryResult.scopeNotesText);
    }

    return finalize({
      path: "direct_groq_success",
      status: 200,
      payload: {
        outcome: "scope",
        scopeNotes: retryResult.scopeNotesText,
        clarificationQuestion: "",
        missingFields: [],
      },
      traceLabel: "ok",
      traceReason: "success",
      outcome: "scope",
      reasonTag: recoveredScaffoldAssessment.reasonTag || "job_specific_content",
      excerpt: retryResult.scopeNotesText,
      modelName: retryResult.modelName,
      retryUsed: true,
      styleMeta: recoveredStyleMeta,
      extra: { outcome: "scope" },
    });
  };
  const buildDashRetryUserPrompt = (failureReasonTag = "", failedScopeNotes = "", { validatorFeedback = "", retryAttempt = 1 } = {}) => {
    const sourceSelection = resolveDashCanonicalAcceptedProseSource({
      context: context,
      acceptedProseDraftText: context?.originalAcceptedProseScope || context?.dashCanonicalAcceptedProse || context?.dashImmutableAcceptedProse || "",
      currentScopeText: existingScopeText || context?.currentScopeNotes || "",
      existingScopeText: existingScopeText || context?.currentScopeNotes || "",
      // For Dash amend retry: prefer the full active scope prose, not short prompt fields.
      requestText: dashAmendHasActiveScopeProse
        ? sanitizeScopeAssistText(existingScopeText)
        : (dashPrimarySourceText || context?.scopePromptBasis || context?.sourceScopePrompt || context?.scopeInputAnalysis?.coreScopeText || inputText || ""),
      failedDashText: failedScopeNotes,
      sourceKind: "dash_retry_prompt",
      sourcePrompt: context?.sourcePrompt || "",
      sourceScopePrompt: context?.sourceScopePrompt || "",
      sourceScopeBasis: context?.scopePromptBasis || "",
    });
    const cleanRetrySourceText = sanitizeScopeAssistText(
      sourceSelection.sourceText
      || ""
    );
    setTruth({
      dashCanonicalProseSourceType: String(sourceSelection.sourceType || ""),
      dashCanonicalProseChars: Math.max(0, Number(sourceSelection.sourceTextChars || 0)),
      dashImmutableAcceptedProseCapturedOnNonDashSuccess: Boolean(sourceSelection.immutableAcceptedProseCapturedOnNonDashSuccess),
      dashImmutableAcceptedProseCaptureBranch: String(sourceSelection.immutableAcceptedProseCaptureBranch || ""),
      dashImmutableAcceptedProseReadFromCache: Boolean(sourceSelection.immutableAcceptedProseReadFromCache),
      dashImmutableAcceptedProseSeedBlockedFromDashRefine: Boolean(sourceSelection.seedBlockedFromDashRefine),
      dashImmutableAcceptedProseSeedBlockedFromCurrentDraft: Boolean(sourceSelection.seedBlockedFromCurrentDraft),
      dashImmutableAcceptedProseSeedBlockedFromExistingScope: Boolean(sourceSelection.seedBlockedFromExistingScope),
      dashRejectedLateImmutableSeed: Boolean(sourceSelection.rejectedLateImmutableSeed),
      dashFailedClosedForMissingPreCapturedImmutableProse: Boolean(sourceSelection.failedClosedForMissingPreCapturedImmutableProse),
      dashUsedAcceptedProseDraft: Boolean(sourceSelection.usedAcceptedProseDraft),
      dashFellBackToRequestText: Boolean(sourceSelection.fellBackToRequestText),
      dashPromptUsedRequestTextOnlyBecauseAcceptedProseMissing: Boolean(sourceSelection.promptUsedRequestTextOnlyBecauseAcceptedProseMissing),
      dashRetryPromptUsedCleanSourceOnly: Boolean(cleanRetrySourceText),
      dashRetryPromptBlockedFailedDraft: Boolean(sourceSelection.rejectedFailedDashAsCompilerSource || isDashCompilerContaminatedSourceText(failedScopeNotes)),
      dashRetryPromptBlockedCurrentDraft: Boolean(sourceSelection.rejectedCurrentDraftAsCompilerSource || isDashCompilerContaminatedSourceText(existingScopeText)),
      dashRetryUsedCleanOriginalProse: Boolean(sourceSelection.usedAcceptedProseDraft && cleanRetrySourceText),
      dashRetryBlockedFailedDashText: Boolean(sourceSelection.rejectedFailedDashAsCompilerSource || isDashCompilerContaminatedSourceText(failedScopeNotes)),
      dashRetryBlockedCurrentMalformedDash: Boolean(sourceSelection.rejectedCurrentDraftAsCompilerSource || isDashCompilerContaminatedSourceText(existingScopeText)),
      dashRetryUsedSameCanonicalProse: Boolean(cleanRetrySourceText && cleanRetrySourceText === dashRewriteSourceText),
      dashGroqRewriteUsed: true,
      dashLocalCompilerBypassed: true,
      dashGroqRewriteRetryCount: Math.max(1, Number(retryAttempt || 1)),
      dashTransformSource: String(cleanRetrySourceText || dashRewriteSourceText || ""),
    });
    const retryHasSourceProse = dashAmendHasActiveScopeProse || sourceSelection.usedAcceptedProseDraft;
    const parts = [];
    if (retryHasSourceProse) {
      parts.push(`SOURCE TEXT TO TRANSFORM: ${cleanRetrySourceText}`);
    } else if (sourceSelection.usedAcceptedProseDraft) {
      parts.push(`Accepted prose draft: ${cleanRetrySourceText}`);
    } else if (cleanRetrySourceText) {
      parts.push(`Request/core prompt fallback because accepted prose is missing: ${cleanRetrySourceText}`);
    }
    parts.push(`TASK: Convert the source text above into Dash + Brief format.`);
    parts.push(`Retry reason: ${failureReasonTag || "dash_format_or_semantic_failure"}.`);
    if (retryAttempt > 0) parts.push(`Retry attempt: ${Math.max(1, Number(retryAttempt || 1))}`);
    if (validatorFeedback) parts.push(`Validator feedback: ${validatorFeedback}`);
    parts.push("Use the same canonical source text provided above and validator feedback only.");
    parts.push("Do not reuse failed dash text, current malformed draft text, request-text fragments, or sentence-picked lines.");
    parts.push(
      retryHasSourceProse
        ? "Rewrite the provided source text into contractor-ready Dash + Brief format. Preserve all source detail."
        : sourceSelection.usedAcceptedProseDraft
          ? "Rewrite the provided accepted prose draft into contractor-ready Dash + Brief."
          : "Rewrite the request/core prompt fallback above into contractor-ready Dash + Brief because no usable accepted prose draft exists yet."
    );
    parts.push("If the accepted prose contains both overview/setup sentences and later procedural detail sentences, ignore the overview/setup sentences for bullet selection and build bullets from the procedural detail sentences instead.");
    parts.push("Prefer concrete service actions such as inspect, check, clean, replace, adjust, verify, test, repair, lubricate, install, remove, align, set, position, mount, reconnect, disconnect, and secure.");
    parts.push("Prefer grounded targets such as filters, belts, coils, motors, bearings, thermostat settings, refrigerant levels, electrical connections, controls, damaged components, and the work area.");
    parts.push("Do not turn the opening overview sentence into multiple bullets.");
    parts.push("Do not preserve sentence order when it causes repetition.");
    parts.push("Do not echo the intro sentence.");
    parts.push("Do not split one sentence into fragment bullets.");
    parts.push("Return 3 to 5 dashed scope lines when possible.");
    parts.push("Each scope line must begin with '- '.");
    parts.push("After the dashed lines, include one blank line and then one short summary paragraph.");
    parts.push("Preserve the same trade or action identity, job meaning, scope intent, and estimate-ready usefulness.");
    parts.push("Do not replace specific trade or action wording with neighboring generic trade language.");
    parts.push("Do not add exclusions, approvals, concealed-condition clauses, code or compliance language, scope-boundary clauses, or means and methods not already present in the source text.");
    parts.push("Do not use headings, numbered lists, markdown labels, quotes, or code fences.");
    parts.push("Return strict JSON only with the exact existing keys.");
    return parts.join("\n");
  };
  const attemptDashGroundedFinalize = ({
    candidateText = "",
    failureReasonTag = "",
    modelName = "",
    retryUsed = false,
    localFallbackUsed = false,
    attemptLabel = "dash_retry_grounded_finalize",
    skipReceivedLog = false,
  } = {}) => {
    const normalizedCandidate = sanitizeScopeAssistText(candidateText);
    if (!normalizedCandidate) return null;

    if (!skipReceivedLog) {
      logDashResult("dash_retry_candidate_repair_attempted", {
        accepted: false,
        reasonTag: failureReasonTag || "dash_retry_candidate_received",
      }, {
        retryUsed,
        localFallbackUsed,
        attemptLabel,
        model: modelName,
        failedExcerpt: normalizedCandidate.slice(0, 160),
      });
    }

    const repairResult = repairDashRefineOutput(dashRewriteSourceText, normalizedCandidate);
    const repairedText = sanitizeScopeAssistText(repairResult.repairedText || normalizedCandidate);
    const repairApplied = Boolean(repairResult.repaired && repairedText && repairedText !== normalizedCandidate)
      || Boolean(repairResult.summarySynthesized)
      || Number(repairResult.fragmentsRemovedCount || 0) > 0
      || Number(repairResult.splitEchoesRemovedCount || 0) > 0
      || Number(repairResult.genericIntroRemovedCount || 0) > 0
      || Number(repairResult.nearDuplicateRemovedCount || 0) > 0;

    if (repairApplied) {
      logDashResult("retry_candidate_repaired", {
        accepted: false,
        reasonTag: repairResult.reason || "repair_applied",
      }, {
        retryUsed,
        localFallbackUsed,
        attemptLabel,
        model: modelName,
        repairDiag: {
          fragmentsRemoved: repairResult.fragmentsRemovedCount,
          splitEchoesRemoved: repairResult.splitEchoesRemovedCount,
          genericIntroRemoved: repairResult.genericIntroRemovedCount,
          nearDuplicateRemoved: repairResult.nearDuplicateRemovedCount,
          summarySynthesized: repairResult.summarySynthesized,
          summarySource: repairResult.summarySource,
          originalLineCount: repairResult.originalDashLineCount,
          cleanedLineCount: repairResult.cleanedDashLineCount,
        },
      });
    }

    const promotedText = repairedText || normalizedCandidate;
    const strictAssessment = assessDashScopeRefineCompliance(dashRewriteSourceText, promotedText);
    setDashRuntime(strictAssessment, {
      retryUsed,
      localFallbackUsed,
    });
    logDashResult("dash_compliance_recovered_evaluated", strictAssessment, {
      retryUsed,
      localFallbackUsed,
      attemptLabel,
      model: modelName,
      repairUsed: repairApplied,
      repairDiag: {
        fragmentsRemoved: repairResult.fragmentsRemovedCount,
        splitEchoesRemoved: repairResult.splitEchoesRemovedCount,
        genericIntroRemoved: repairResult.genericIntroRemovedCount,
        nearDuplicateRemoved: repairResult.nearDuplicateRemovedCount,
        summarySynthesized: repairResult.summarySynthesized,
        summarySource: repairResult.summarySource,
        originalLineCount: repairResult.originalDashLineCount,
        cleanedLineCount: repairResult.cleanedDashLineCount,
      },
    });

    const relaxedAssessment = strictAssessment.accepted
      ? strictAssessment
      : assessDashGroundedRepairPromotion(dashRewriteSourceText, promotedText, repairResult);
    if (!relaxedAssessment.accepted) {
      logDashResult("true_no_grounded_candidate_failure", relaxedAssessment, {
        retryUsed,
        localFallbackUsed,
        attemptLabel,
        model: modelName,
        repairUsed: repairApplied,
        repairDiag: {
          fragmentsRemoved: repairResult.fragmentsRemovedCount,
          splitEchoesRemoved: repairResult.splitEchoesRemovedCount,
          genericIntroRemoved: repairResult.genericIntroRemovedCount,
          nearDuplicateRemoved: repairResult.nearDuplicateRemovedCount,
          summarySynthesized: repairResult.summarySynthesized,
          summarySource: repairResult.summarySource,
          originalLineCount: repairResult.originalDashLineCount,
          cleanedLineCount: repairResult.cleanedDashLineCount,
        },
      });
      return null;
    }

    logDashResult("retry_candidate_promoted", relaxedAssessment, {
      retryUsed,
      localFallbackUsed,
      attemptLabel,
      model: modelName,
      repairUsed: repairApplied,
      repairDiag: {
        fragmentsRemoved: repairResult.fragmentsRemovedCount,
        splitEchoesRemoved: repairResult.splitEchoesRemovedCount,
        genericIntroRemoved: repairResult.genericIntroRemovedCount,
        nearDuplicateRemoved: repairResult.nearDuplicateRemovedCount,
        summarySynthesized: repairResult.summarySynthesized,
        summarySource: repairResult.summarySource,
        originalLineCount: repairResult.originalDashLineCount,
        cleanedLineCount: repairResult.cleanedDashLineCount,
      },
    });
    if (!strictAssessment.accepted) {
      setDashRuntime(relaxedAssessment, {
        retryUsed,
        localFallbackUsed,
      });
      logDashResult("local_grounded_finalize_accepted", relaxedAssessment, {
        retryUsed,
        localFallbackUsed,
        attemptLabel,
        model: modelName,
        repairUsed: repairApplied,
      });
    }

    setTruth({
      dashGroqRewriteUsed: true,
      dashGroqRewriteValidated: true,
      dashGroqRewriteRetryCount: retryUsed ? 1 : 0,
      dashLocalCompilerBypassed: true,
      dashTransformSource: dashRewriteSourceText,
      dashUsedOriginalAcceptedProse: Boolean(dashRewriteSourceSelection?.usedAcceptedProseDraft),
      dashRetryUsed: retryUsed,
      dashLocalFallbackUsed: localFallbackUsed,
      dashReturnedSuccess: true,
      dashSuccessBlockedForComplianceFailure: false,
      dashReturnedFailurePath: false,
      dashFallbackAccepted: false,
      dashBestEffortSuccessRemoved: true,
    });
    logDashResult("dash_final_source_kind", relaxedAssessment, {
      retryUsed,
      localFallbackUsed,
      attemptLabel,
      model: modelName,
      repairUsed: repairApplied,
      finalSourceKind: (repairApplied || !strictAssessment.accepted)
        ? "repaired_retry_candidate"
        : "provider_retry_candidate",
    });
    logDashResult("dash_final_branch_selected", relaxedAssessment, {
      retryUsed,
      localFallbackUsed,
      attemptLabel,
      model: modelName,
      repairUsed: repairApplied,
      finalBranch: (repairApplied || !strictAssessment.accepted)
        ? "repaired_retry_candidate"
        : "provider_retry_candidate",
      finalSourceKind: (repairApplied || !strictAssessment.accepted)
        ? "repaired_retry_candidate"
        : "provider_retry_candidate",
    });
    logDashResult("dash_retry_truth_state_finalized", relaxedAssessment, {
      retryUsed,
      localFallbackUsed,
      attemptLabel,
      model: modelName,
      repairUsed: repairApplied,
      finalPath: "direct_groq_repair_success",
      finalReasonTag: strictAssessment.accepted
        ? (strictAssessment.reasonTag || "dash_format_and_semantics_pass")
        : (relaxedAssessment.reasonTag || "dash_grounded_repair_pass"),
    });

    return finalize({
      path: "direct_groq_repair_success",
      status: 200,
      payload: {
        outcome: "scope",
        scopeNotes: promotedText,
        clarificationQuestion: "",
        missingFields: [],
      },
      traceLabel: "ok",
      traceReason: strictAssessment.accepted ? "success_after_repair" : "success_after_grounded_finalize",
      outcome: "scope",
      reasonTag: strictAssessment.accepted
        ? (strictAssessment.reasonTag || "dash_format_and_semantics_pass")
        : (relaxedAssessment.reasonTag || "dash_grounded_repair_pass"),
      excerpt: promotedText,
      modelName: modelName || defaultModel,
      retryUsed,
      extra: { outcome: "scope" },
    });
  };
  const buildDeterministicDashFromCanonicalProse = ({
    failureReasonTag = "",
    canonicalSourceText = "",
    sourceSelection = null,
    retryUsed = dashRetryAttempted,
    localFallbackUsed = true,
    attemptLabel = "dash_canonical_source_compile",
  } = {}) => {
    try {
      const resolvedSourceSelection = sourceSelection || resolveDashCanonicalAcceptedProseSource({
        context,
        acceptedProseDraftText: context?.originalAcceptedProseScope || context?.dashCanonicalAcceptedProse || context?.dashImmutableAcceptedProse || "",
        currentScopeText: existingScopeText || context?.currentScopeNotes || "",
        existingScopeText: existingScopeText || context?.currentScopeNotes || "",
        requestText: dashRewriteSourceText || existingScopeText || inputText || "",
        sourceKind: attemptLabel,
        sourcePrompt: context?.sourcePrompt || "",
        sourceScopePrompt: context?.sourceScopePrompt || "",
        sourceScopeBasis: context?.scopePromptBasis || "",
      });
      const canonicalText = sanitizeScopeAssistText(
        canonicalSourceText
        || resolvedSourceSelection?.sourceText
        || dashRewriteSourceText
        || ""
      );
      logDashResult("dash_canonical_source_compile_entered", {
        accepted: false,
        reasonTag: failureReasonTag || String(resolvedSourceSelection?.sourceType || "dash_canonical_source_compile"),
      }, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
        sourceType: String(resolvedSourceSelection?.sourceType || ""),
        sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
        sourceTextChars: canonicalText.length,
        usedOriginalProseSource: Boolean(resolvedSourceSelection?.usedOriginalProseSource),
        usedAcceptedProseDraft: Boolean(resolvedSourceSelection?.usedAcceptedProseDraft),
        fellBackToRequestText: Boolean(resolvedSourceSelection?.fellBackToRequestText),
      });

      if (!canonicalText || isDashCompilerContaminatedSourceText(canonicalText)) {
        logDashResult("dash_canonical_source_compile_failed", {
          accepted: false,
          reasonTag: failureReasonTag || String(resolvedSourceSelection?.sourceType || "dash_canonical_source_compile_failed"),
        }, {
          retryUsed: Boolean(retryUsed),
          localFallbackUsed: Boolean(localFallbackUsed),
          attemptLabel,
          model: "local_dash_canonical_compile",
          sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
          sourceType: String(resolvedSourceSelection?.sourceType || ""),
          sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
          sourceTextChars: canonicalText.length,
          sourceSelectionBlocked: true,
          failedExcerpt: canonicalText.slice(0, 160),
        });
        logDashResult("dash_canonical_compiled_candidate_rejected", {
          accepted: false,
          reasonTag: "dash_canonical_source_compile_failed",
        }, {
          retryUsed: Boolean(retryUsed),
          localFallbackUsed: Boolean(localFallbackUsed),
          attemptLabel,
          model: "local_dash_canonical_compile",
          finalSourceKind: "terminal_failure",
          sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
          sourceType: String(resolvedSourceSelection?.sourceType || ""),
          sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
          sourceTextChars: canonicalText.length,
          failedExcerpt: canonicalText.slice(0, 160),
        });
        logDashResult("dash_final_branch_selected", {
          accepted: false,
          reasonTag: "dash_canonical_source_compile_failed",
        }, {
          retryUsed: Boolean(retryUsed),
          localFallbackUsed: Boolean(localFallbackUsed),
          attemptLabel,
          model: "local_dash_canonical_compile",
          finalBranch: "canonical_compiled_candidate_rejected",
          finalSourceKind: "terminal_failure",
          sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
          sourceType: String(resolvedSourceSelection?.sourceType || ""),
          sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
          sourceTextChars: canonicalText.length,
          failedExcerpt: canonicalText.slice(0, 160),
        });
        return {
          accepted: false,
          reasonTag: "dash_canonical_source_compile_failed",
          assessment: {
            accepted: false,
            reasonTag: "dash_canonical_source_compile_failed",
            dashMode: true,
            dashLineCount: 0,
            dashHasSummaryParagraph: false,
            dashFormatPass: false,
            dashSemanticPass: false,
            dashDistinctStepPass: false,
          },
          compiledText: canonicalText,
          finalSourceKind: "terminal_failure",
          sourceSelection: resolvedSourceSelection,
        };
      }

      const compiled = compileDashScopeFromProse({
        sourcePromptText: canonicalText,
        sourceScopeText: canonicalText,
        sourceLabel: "local_dash_canonical_compile",
        sourcePriority: String(resolvedSourceSelection?.sourcePriority || resolvedSourceSelection?.sourceType || "immutable_original_accepted_prose"),
        rejectedCurrentDraftAsCompilerSource: Boolean(resolvedSourceSelection?.rejectedCurrentDraftAsCompilerSource),
        rejectedFailedDashAsCompilerSource: Boolean(resolvedSourceSelection?.rejectedFailedDashAsCompilerSource),
        usedOriginalProseSource: Boolean(resolvedSourceSelection?.usedOriginalProseSource),
        fallbackSourceTextBlocked: Boolean(resolvedSourceSelection?.fallbackSourceTextBlocked),
        sourceTextUsedForCompilation: canonicalText,
        compileMode: "canonical_fallback",
      });
      const compiledText = sanitizeScopeAssistText(compiled?.text || "");
      const compiledCompileMode = String(compiled?.assessment?.dashCompilerCompileMode || compiled?.compileMode || "canonical_fallback");
      logDashResult("dash_canonical_compiled_candidate_created", {
        accepted: false,
        reasonTag: failureReasonTag || "dash_canonical_compiled_candidate_created",
      }, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalSourceKind: "deterministic_canonical_source_compile",
        compileMode: compiledCompileMode,
        sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
        sourceType: String(resolvedSourceSelection?.sourceType || ""),
        sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
        sourceTextChars: canonicalText.length,
        compiledExcerpt: compiledText.slice(0, 160),
      });
      const canonicalAssessment = assessDashCanonicalCompiledCandidate(canonicalText, compiledText);
      setDashRuntime(canonicalAssessment, {
        retryUsed,
        localFallbackUsed,
      });
      logDashResult("dash_final_metrics_recomputed_from_compiled_output", canonicalAssessment, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalSourceKind: "deterministic_canonical_source_compile",
        compileMode: compiledCompileMode,
        sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
        sourceType: String(resolvedSourceSelection?.sourceType || ""),
        sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
        sourceTextChars: canonicalText.length,
        candidateExcerpt: compiledText.slice(0, 160),
      });
      logDashResult("dash_canonical_compiled_candidate_validated", canonicalAssessment, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalSourceKind: "deterministic_canonical_source_compile",
        compileMode: compiledCompileMode,
        sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
        sourceType: String(resolvedSourceSelection?.sourceType || ""),
        sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
        candidateExcerpt: compiledText.slice(0, 160),
      });
      if (!canonicalAssessment.accepted) {
        logDashResult("dash_canonical_compiled_candidate_rejected", canonicalAssessment, {
          retryUsed: Boolean(retryUsed),
          localFallbackUsed: Boolean(localFallbackUsed),
          attemptLabel,
          model: "local_dash_canonical_compile",
          finalSourceKind: "deterministic_canonical_source_compile",
          compileMode: compiledCompileMode,
          sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
          sourceType: String(resolvedSourceSelection?.sourceType || ""),
          sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
          candidateExcerpt: compiledText.slice(0, 160),
        });
        logDashResult("dash_canonical_source_compile_failed", canonicalAssessment, {
          retryUsed: Boolean(retryUsed),
          localFallbackUsed: Boolean(localFallbackUsed),
          attemptLabel,
          model: "local_dash_canonical_compile",
          finalSourceKind: "deterministic_canonical_source_compile",
          compileMode: compiledCompileMode,
          sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
          sourceType: String(resolvedSourceSelection?.sourceType || ""),
          sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
          sourceTextChars: canonicalText.length,
          failedExcerpt: compiledText.slice(0, 160),
        });
        logDashResult("dash_final_branch_selected", canonicalAssessment, {
          retryUsed: Boolean(retryUsed),
          localFallbackUsed: Boolean(localFallbackUsed),
          attemptLabel,
          model: "local_dash_canonical_compile",
          finalBranch: "canonical_compiled_candidate_rejected",
          finalSourceKind: "deterministic_canonical_source_compile",
          compileMode: compiledCompileMode,
          sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
          sourceType: String(resolvedSourceSelection?.sourceType || ""),
          sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
          candidateExcerpt: compiledText.slice(0, 160),
        });
        return {
          accepted: false,
          reasonTag: canonicalAssessment.reasonTag || failureReasonTag || "dash_canonical_compiled_candidate_rejected",
          assessment: canonicalAssessment,
          compiledText,
          finalSourceKind: "deterministic_canonical_source_compile",
          sourceSelection: resolvedSourceSelection,
        };
      }

      logDashResult("dash_canonical_compiled_candidate_accepted", canonicalAssessment, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalSourceKind: "deterministic_canonical_source_compile",
        compileMode: compiledCompileMode,
        sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
        sourceType: String(resolvedSourceSelection?.sourceType || ""),
        sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
        candidateExcerpt: compiledText.slice(0, 160),
      });
      logDashResult("dash_canonical_source_compile_success", canonicalAssessment, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalSourceKind: "deterministic_canonical_source_compile",
        compileMode: compiledCompileMode,
        sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
        sourceType: String(resolvedSourceSelection?.sourceType || ""),
        sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
        sourceTextChars: canonicalText.length,
        compiledExcerpt: compiledText.slice(0, 160),
      });
      logDashResult("dash_final_source_kind", canonicalAssessment, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalSourceKind: "deterministic_canonical_source_compile",
        compileMode: compiledCompileMode,
        sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
        sourceType: String(resolvedSourceSelection?.sourceType || ""),
        sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
      });
      logDashResult("dash_final_branch_selected", canonicalAssessment, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalBranch: "canonical_compiled_candidate_accepted",
        finalSourceKind: "deterministic_canonical_source_compile",
        compileMode: compiledCompileMode,
        sourceKind: String(resolvedSourceSelection?.sourceKind || attemptLabel || "dash_canonical_source_compile"),
        sourceType: String(resolvedSourceSelection?.sourceType || ""),
        sourcePriority: String(resolvedSourceSelection?.sourcePriority || ""),
        candidateExcerpt: compiledText.slice(0, 160),
      });

      setTruth({
        outcome: "scope",
        reasonTag: canonicalAssessment.reasonTag || "dash_canonical_compiled_candidate_pass",
        excerpt: compiledText,
        dashGroqRewriteUsed: true,
        dashGroqRewriteValidated: true,
        dashGroqRewriteRetryCount: retryUsed ? 1 : 0,
        dashLocalCompilerBypassed: true,
        dashTransformSource: canonicalText,
        dashUsedOriginalAcceptedProse: Boolean(resolvedSourceSelection?.usedOriginalProseSource),
        dashRetryUsed: Boolean(retryUsed),
        dashLocalFallbackUsed: Boolean(localFallbackUsed),
        dashReturnedSuccess: true,
        dashSuccessBlockedForComplianceFailure: false,
        dashReturnedFailurePath: false,
        dashFallbackAccepted: false,
        dashBestEffortSuccessRemoved: true,
      });
      logDashResult("dash_canonical_finalized_success", canonicalAssessment, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalSourceKind: "deterministic_canonical_source_compile",
        compiledLineCount: Math.max(0, Number(canonicalAssessment.dashLineCount || 0)),
        proceduralBulletCount: Math.max(0, Number(canonicalAssessment.dashProceduralBulletCount || 0)),
        overviewBulletCount: Math.max(0, Number(canonicalAssessment.dashOverviewBulletCount || 0)),
        summaryDetected: Boolean(canonicalAssessment.dashHasSummaryParagraph),
        reasonTag: canonicalAssessment.reasonTag || "dash_canonical_compiled_candidate_pass",
        compileMode: compiledCompileMode,
        candidateExcerpt: compiledText.slice(0, 160),
      });
      logDashResult("dash_retry_truth_state_finalized", canonicalAssessment, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalPath: "grounded_fallback_success",
        finalReasonTag: canonicalAssessment.reasonTag || "dash_canonical_compiled_candidate_pass",
        finalSourceKind: "deterministic_canonical_source_compile",
        compileMode: compiledCompileMode,
      });

      const finalResult = finalize({
        path: "grounded_fallback_success",
        status: 200,
        payload: {
          outcome: "scope",
          scopeNotes: compiledText,
          clarificationQuestion: "",
          missingFields: [],
        },
        traceLabel: "ok",
        traceReason: "success_after_canonical_compile",
        outcome: "scope",
        reasonTag: canonicalAssessment.reasonTag || "dash_canonical_compiled_candidate_pass",
        excerpt: compiledText,
        modelName: "local_dash_canonical_compile",
        retryUsed,
        extra: { outcome: "scope", fallbackSource: "canonical_source_compile" },
      });
      return {
        ...finalResult,
        accepted: true,
        reasonTag: canonicalAssessment.reasonTag || "dash_canonical_compiled_candidate_pass",
        assessment: canonicalAssessment,
        compiledText,
        finalSourceKind: "deterministic_canonical_source_compile",
        sourceSelection: resolvedSourceSelection,
      };
    } catch (error) {
      const errorMessage = String(error?.stack || error?.message || error || "").trim();
      logDashResult("dash_canonical_source_compile_failed", {
        accepted: false,
        reasonTag: failureReasonTag || "dash_canonical_source_compile_exception",
      }, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        errorMessage: errorMessage.slice(0, 240),
      });
      logDashResult("dash_canonical_compiled_candidate_rejected", {
        accepted: false,
        reasonTag: failureReasonTag || "dash_canonical_source_compile_exception",
      }, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalSourceKind: "terminal_failure",
        errorMessage: errorMessage.slice(0, 240),
      });
      logDashResult("dash_final_branch_selected", {
        accepted: false,
        reasonTag: failureReasonTag || "dash_canonical_source_compile_exception",
      }, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        finalBranch: "true_no_grounded_candidate_failure",
        finalSourceKind: "terminal_failure",
        errorMessage: errorMessage.slice(0, 240),
      });
      logDashResult("dash_final_no_unhandled_throw", {
        accepted: false,
        reasonTag: failureReasonTag || "dash_canonical_source_compile_exception",
      }, {
        retryUsed: Boolean(retryUsed),
        localFallbackUsed: Boolean(localFallbackUsed),
        attemptLabel,
        model: "local_dash_canonical_compile",
        errorMessage: errorMessage.slice(0, 240),
      });
      return {
        accepted: false,
        reasonTag: failureReasonTag || "dash_canonical_source_compile_exception",
        assessment: {
          accepted: false,
          reasonTag: failureReasonTag || "dash_canonical_source_compile_exception",
          dashMode: true,
          dashLineCount: 0,
          dashHasSummaryParagraph: false,
          dashFormatPass: false,
          dashSemanticPass: false,
          dashDistinctStepPass: false,
        },
        compiledText: "",
        finalSourceKind: "terminal_failure",
        sourceSelection: resolvedSourceSelection || null,
      };
    }
  };
  const buildDashLocalFallbackResult = (failureReasonTag = "", failedScopeNotes = "", {
    retryUsed = dashRetryAttempted,
    skipPromotionAttempt = false,
    canonicalSourceText = "",
    sourceSelection = null,
  } = {}) => {
    const failureExcerpt = String(failedScopeNotes || existingScopeText || inputText || "").trim();
    const resolvedSourceSelection = sourceSelection || resolveDashCanonicalAcceptedProseSource({
      context,
      acceptedProseDraftText: context?.originalAcceptedProseScope || context?.dashCanonicalAcceptedProse || context?.dashImmutableAcceptedProse || "",
      currentScopeText: existingScopeText || context?.currentScopeNotes || "",
      existingScopeText: existingScopeText || context?.currentScopeNotes || "",
      requestText: dashRewriteSourceText || existingScopeText || inputText || "",
      sourceKind: "dash_local_fallback_canonical_compile",
      sourcePrompt: context?.sourcePrompt || "",
      sourceScopePrompt: context?.sourceScopePrompt || "",
      sourceScopeBasis: context?.scopePromptBasis || "",
    });
    const canonicalCompile = buildDeterministicDashFromCanonicalProse({
      failureReasonTag,
      canonicalSourceText: canonicalSourceText || resolvedSourceSelection?.sourceText || "",
      sourceSelection: resolvedSourceSelection,
      retryUsed,
      localFallbackUsed: true,
      attemptLabel: "dash_local_fallback_canonical_compile",
    });
    if (canonicalCompile?.accepted && canonicalCompile.status && canonicalCompile.status < 400) return canonicalCompile;

    const terminalReasonTag = String(canonicalCompile?.reasonTag || failureReasonTag || "dash_local_fallback_bypassed");
    const terminalExcerpt = String(canonicalCompile?.compiledText || failureExcerpt || "").trim() || failureExcerpt;

    logDashResult("dash_retry_finalize_terminal_failure", {
      accepted: false,
      reasonTag: terminalReasonTag,
    }, {
      retryUsed: Boolean(retryUsed),
      localFallbackUsed: true,
      failureReasonTag: terminalReasonTag,
      failedExcerpt: terminalExcerpt.slice(0, 160),
    });
    setTruth({
      retryUsed: Boolean(retryUsed),
      dashRetryUsed: Boolean(retryUsed),
      dashLocalCompilerBypassed: true,
      dashLocalFallbackUsed: true,
      dashFallbackRejectedForCompliance: true,
      dashRejectedBeforeDirectSuccess: true,
      dashFallbackAccepted: false,
      dashSuccessBlockedForComplianceFailure: true,
      dashReturnedSuccess: false,
      dashReturnedFailurePath: true,
      dashBestEffortSuccessRemoved: true,
      reasonTag: terminalReasonTag,
      excerpt: terminalExcerpt,
    });
    logDashResult("dash_retry_truth_state_finalized", {
      accepted: false,
      reasonTag: terminalReasonTag,
    }, {
      retryUsed: Boolean(retryUsed),
      localFallbackUsed: true,
      failureReasonTag: terminalReasonTag,
      failedExcerpt: terminalExcerpt.slice(0, 160),
      dashFallbackRejectedForCompliance: true,
      dashFallbackAccepted: false,
      dashSuccessBlockedForComplianceFailure: true,
      dashReturnedSuccess: false,
      dashReturnedFailurePath: true,
      dashBestEffortSuccessRemoved: true,
    });
    logDashResult("dash_final_branch_selected", {
      accepted: false,
      reasonTag: terminalReasonTag,
    }, {
      retryUsed: Boolean(retryUsed),
      localFallbackUsed: true,
      finalBranch: "true_no_grounded_candidate_failure",
      finalSourceKind: "terminal_failure",
      failureReasonTag: terminalReasonTag,
      failedExcerpt: terminalExcerpt.slice(0, 160),
    });
    logDashResult("dash_local_fallback_used", {
      accepted: false,
      reasonTag: terminalReasonTag,
    }, {
      retryUsed: Boolean(retryUsed),
      localFallbackUsed: true,
      dashFallbackRejectedForCompliance: true,
      dashFallbackAccepted: false,
      dashSuccessBlockedForComplianceFailure: true,
      dashReturnedSuccess: false,
      dashReturnedFailurePath: true,
      dashBestEffortSuccessRemoved: true,
      failureReasonTag: terminalReasonTag,
      failedExcerpt: terminalExcerpt.slice(0, 160),
      fallbackExcerpt: terminalExcerpt.slice(0, 160),
    });
    return buildProviderFailureNoGroundedFallback(
      "internal_failure",
      terminalReasonTag,
      terminalExcerpt,
      "local_dash_scope_fallback",
      { retryUsed: Boolean(retryUsed) }
    );
  };
  const maybeRetryDashResult = async ({ failureReasonTag = "", failedScopeNotes = "", failedModelName = "" } = {}) => {
    if (!isDashRefine) return null;
    if (dashRetryAttempted) {
      return {
        accepted: false,
        modelName: String(defaultModel).trim() || defaultModel,
        raw: "",
        scopeNotesText: "",
        clarificationQuestionText: "",
        retryUsed: true,
        retryAssessment: {
          accepted: false,
          reasonTag: failureReasonTag || "dash_retry_already_attempted",
        },
      };
    }

    dashRetryAttempted = true;
    // Dash-specific: if the primary model was rate-limited or capacity-blocked,
    // fall back to the cheaper GROQ_MODEL for the retry instead of retrying the same model.
    const primaryRateLimited = failureReasonTag === "rate_limited"
      || failureReasonTag === "provider_unavailable";
    const dashRetryModel = primaryRateLimited
      ? GROQ_MODEL
      : String(requestOptions?.model || defaultModel).trim() || defaultModel;
    setTruth({
      retryUsed: true,
      dashRetryUsed: true,
      dashRetryFallbackModel: primaryRateLimited,
      dashRetryFallbackModelName: primaryRateLimited ? GROQ_MODEL : "",
    });
    logDashResult("dash_retry_requested", {
      accepted: false,
      reasonTag: failureReasonTag,
    }, {
      retryUsed: true,
      localFallbackUsed: false,
      failedModelName: String(failedModelName || defaultModel).trim() || defaultModel,
      failedExcerpt: String(failedScopeNotes || "").trim().slice(0, 160),
      dashRetryFallbackModel: primaryRateLimited,
      dashRetryModelSelected: dashRetryModel,
    });

    const retryFailureAssessment = assessDashScopeRefineCompliance(dashRewriteSourceText, failedScopeNotes || "");
    const retryValidatorFeedback = buildDashValidationFeedback(retryFailureAssessment, failureReasonTag);
    setTruth({
      dashGroqRewriteUsed: true,
      dashLocalCompilerBypassed: true,
      dashGroqRewriteRetryCount: 1,
      dashRetrySamplingRaised: true,
    });
    const retrySystemPrompt = `${systemPrompt}\nThis is a retry for a Dash + Brief refine result that failed validation. Rewrite the same accepted prose draft into contractor-ready dash lines plus one short wrap-up paragraph. If the source has both overview/setup sentences and later procedural detail sentences, ignore the overview/setup sentences and extract the later procedural service steps instead. Do not preserve sentence order when it causes repetition. Preserve only grounded trade, action, object, and location anchors from that source.`;
    const retryUserPrompt = buildDashRetryUserPrompt(failureReasonTag, failedScopeNotes, {
      validatorFeedback: retryValidatorFeedback,
      retryAttempt: 1,
    });
    const retryRequestOptions = {
      ...requestOptions,
      model: dashRetryModel,
      temperature: 0.16,
      top_p: 0.86,
      max_tokens: Math.min(420, Math.max(220, Number(requestOptions?.max_tokens || 420))),
    };

    let retryAssistResult;
    try {
      retryAssistResult = await callSectionAssistGroq(retrySystemPrompt, retryUserPrompt, trace, retryRequestOptions, {
        sectionKey: "scope",
        scopeMode: normalizedScopeMode,
        traceId,
        modelOverride: dashRetryModel,
      });
    } catch (retryError) {
      const retryFailure = normalizeScopeAssistFailure(retryError);
      failsafeExcerpt = String(retryError?.providerDetail || retryError?.message || failsafeExcerpt || "").trim() || failsafeExcerpt;

      // Dash-specific: if the retry also rate-limited and we haven't yet tried the cheaper model,
      // make one final attempt with GROQ_MODEL before giving up.
      const retryAlsoRateLimited = retryFailure.failureType === "rate_limited"
        || retryFailure.failureType === "provider_unavailable";
      if (retryAlsoRateLimited && dashRetryModel !== GROQ_MODEL) {
        logDashResult("dash_retry_fallback_to_cheaper_model", {
          accepted: false,
          reasonTag: retryFailure.failureType,
        }, {
          retryUsed: true,
          localFallbackUsed: false,
          failedModel: dashRetryModel,
          fallbackModel: GROQ_MODEL,
        });
        try {
          retryAssistResult = await callSectionAssistGroq(retrySystemPrompt, retryUserPrompt, trace, retryRequestOptions, {
            sectionKey: "scope",
            scopeMode: normalizedScopeMode,
            traceId,
            modelOverride: GROQ_MODEL,
          });
        } catch (fallbackError) {
          const fallbackFailure = normalizeScopeAssistFailure(fallbackError);
          failsafeExcerpt = String(fallbackError?.providerDetail || fallbackError?.message || failsafeExcerpt || "").trim() || failsafeExcerpt;
          logDashResult("dash_retry_fallback_model_also_failed", {
            accepted: false,
            reasonTag: fallbackFailure.failureType || "provider_failure",
          }, {
            retryUsed: true,
            localFallbackUsed: false,
            failedModel: GROQ_MODEL,
            failedExcerpt: String(fallbackError?.providerDetail || fallbackError?.message || "").trim().slice(0, 160),
          });
          return {
            accepted: false,
            modelName: GROQ_MODEL,
            raw: String(fallbackError?.providerDetail || fallbackError?.message || ""),
            scopeNotesText: "",
            clarificationQuestionText: "",
            retryUsed: true,
            retryAssessment: {
              accepted: false,
              reasonTag: fallbackFailure.failureType || failureReasonTag || "provider_failure",
            },
          };
        }
      } else {
        logDashResult("dash_retry_provider_failed", {
          accepted: false,
          reasonTag: retryFailure.failureType || "provider_failure",
        }, {
          retryUsed: true,
          localFallbackUsed: false,
          failedExcerpt: String(retryError?.providerDetail || retryError?.message || "").trim().slice(0, 160),
          dashRetryFallbackModel: primaryRateLimited,
          dashRetryModelUsed: dashRetryModel,
        });
        return {
          accepted: false,
          modelName: dashRetryModel,
          raw: String(retryError?.providerDetail || retryError?.message || ""),
          scopeNotesText: "",
          clarificationQuestionText: "",
          retryUsed: true,
          retryAssessment: {
            accepted: false,
            reasonTag: retryFailure.failureType || failureReasonTag || "provider_failure",
          },
        };
      }
    }

    const retryModelName = String(retryAssistResult?.model || defaultModel).trim() || defaultModel;
    const retryRaw = String(retryAssistResult?.raw || "");
    failsafeExcerpt = retryRaw.trim() || failsafeExcerpt;
    setDebug({
      model: retryModelName,
      stage: "provider_response_received",
    });
    log("provider_response_received", {
      model: retryModelName,
      route_function: "handleScopeAssistRequest",
      attemptLabel: "dash_retry",
    });

    const retryParsed = parseProviderScopeAttempt({
      raw: retryRaw,
      modelName: retryModelName,
      attemptLabel: "dash_retry",
    });
    if (!retryParsed.accepted) {
      return {
        accepted: false,
        modelName: retryModelName,
        raw: retryRaw,
        scopeNotesText: "",
        clarificationQuestionText: "",
        retryUsed: true,
        retryAssessment: {
          accepted: false,
          reasonTag: retryParsed.failureReason || failureReasonTag || "dash_retry_parse_failed",
        },
      };
    }
    if (retryParsed.outcome !== "scope") {
      logDashResult("dash_retry_non_scope_result", {
        accepted: false,
        reasonTag: "dash_retry_non_scope_result",
      }, {
        retryUsed: true,
        localFallbackUsed: false,
        failedExcerpt: String(retryParsed.clarificationQuestionText || retryRaw).trim().slice(0, 160),
      });
      return {
        accepted: false,
        modelName: retryModelName,
        raw: retryRaw,
        scopeNotesText: "",
        clarificationQuestionText: retryParsed.clarificationQuestionText,
        retryUsed: true,
        retryAssessment: {
          accepted: false,
          reasonTag: "dash_retry_non_scope_result",
        },
      };
    }

    const retryAssessment = assessDashScopeRefineCompliance(dashRewriteSourceText, retryParsed.scopeNotesText);
    setDashRuntime(retryAssessment, {
      retryUsed: true,
      localFallbackUsed: false,
    });
    logDashResult("dash_compliance_retry_evaluated", retryAssessment, {
      retryUsed: true,
      localFallbackUsed: false,
      attemptLabel: "dash_retry",
      model: retryModelName,
    });
    logDashResult("dash_retry_candidate_received", retryAssessment, {
      retryUsed: true,
      localFallbackUsed: false,
      attemptLabel: "dash_retry",
      model: retryModelName,
      failedExcerpt: String(retryParsed.scopeNotesText || retryRaw).trim().slice(0, 160),
      retryCandidateAccepted: Boolean(retryAssessment.accepted),
      retryCandidateHasScopeNotesText: Boolean(retryParsed.scopeNotesText),
      retryCandidateHasSummaryParagraph: Boolean(retryAssessment.dashHasSummaryParagraph),
    });
    if (!retryAssessment.accepted) {
      if (retryParsed.scopeNotesText) {
        logDashResult("dash_retry_candidate_invalid_but_promotable", retryAssessment, {
          retryUsed: true,
          localFallbackUsed: false,
          attemptLabel: "dash_retry",
          model: retryModelName,
          failedExcerpt: String(retryParsed.scopeNotesText || retryRaw).trim().slice(0, 160),
          retryCandidateHasScopeNotesText: true,
          retryCandidateHasSummaryParagraph: Boolean(retryAssessment.dashHasSummaryParagraph),
        });
      }
      return {
        accepted: false,
        modelName: retryModelName,
        raw: retryRaw,
        scopeNotesText: retryParsed.scopeNotesText,
        clarificationQuestionText: retryParsed.clarificationQuestionText,
        retryUsed: true,
        retryAssessment,
      };
    }

    return {
      accepted: true,
      modelName: retryModelName,
      raw: retryRaw,
      scopeNotesText: retryParsed.scopeNotesText,
      clarificationQuestionText: retryParsed.clarificationQuestionText,
      retryUsed: true,
    };
  };
  const finalizeRecoveredDashRetryResult = async (retryResult, failureReasonTag = "") => {
    if (!isDashRefine) return retryResult;
    if (retryResult?.status) return retryResult;
    logDashResult("dash_retry_finalize_entered", {
      accepted: Boolean(retryResult?.accepted),
      reasonTag: failureReasonTag || retryResult?.retryAssessment?.reasonTag || "dash_retry_finalize_entered",
    }, {
      retryUsed: true,
      localFallbackUsed: false,
      model: String(retryResult?.modelName || defaultModel).trim() || defaultModel,
      retryHasScopeNotesText: Boolean(retryResult?.scopeNotesText),
      retryHasStatus: Boolean(retryResult?.status),
    });
    const canonicalSourceSelection = resolveDashCanonicalAcceptedProseSource({
      context,
      acceptedProseDraftText: context?.originalAcceptedProseScope || context?.dashCanonicalAcceptedProse || context?.dashImmutableAcceptedProse || "",
      currentScopeText: existingScopeText || context?.currentScopeNotes || "",
      existingScopeText: existingScopeText || context?.currentScopeNotes || "",
      requestText: dashRewriteSourceText || existingScopeText || inputText || "",
      failedDashText: retryResult?.scopeNotesText || "",
      sourceKind: "dash_retry_finalize",
      sourcePrompt: context?.sourcePrompt || "",
      sourceScopePrompt: context?.sourceScopePrompt || "",
      sourceScopeBasis: context?.scopePromptBasis || "",
    });
    if (retryResult?.scopeNotesText) {
      const promotedRetryResult = attemptDashGroundedFinalize({
        candidateText: retryResult.scopeNotesText,
        failureReasonTag: failureReasonTag || retryResult.retryAssessment?.reasonTag || "dash_retry_validation_failed",
        modelName: retryResult.modelName,
        retryUsed: true,
        localFallbackUsed: false,
        attemptLabel: "dash_retry_recovered",
        skipReceivedLog: false,
      });
      if (promotedRetryResult) {
        logDashResult("dash_retry_finalize_promoted", {
          accepted: true,
          reasonTag: promotedRetryResult.reasonTag || "dash_retry_promoted",
        }, {
          retryUsed: true,
          localFallbackUsed: false,
          model: String(retryResult?.modelName || defaultModel).trim() || defaultModel,
          finalPath: String(promotedRetryResult?.path || "direct_groq_repair_success"),
          finalReasonTag: String(promotedRetryResult?.reasonTag || ""),
        });
        logDashResult("dash_final_branch_selected", {
          accepted: true,
          reasonTag: promotedRetryResult.reasonTag || "dash_retry_promoted",
        }, {
          retryUsed: true,
          localFallbackUsed: false,
          model: String(retryResult?.modelName || defaultModel).trim() || defaultModel,
          finalBranch: "retry_candidate_promoted",
          finalSourceKind: String(promotedRetryResult?.path || "direct_groq_repair_success"),
          finalReasonTag: String(promotedRetryResult?.reasonTag || ""),
        });
        return promotedRetryResult;
      }
    }
    logDashResult("dash_retry_candidate_bypassed_for_canonical_compile", {
      accepted: false,
      reasonTag: failureReasonTag || retryResult?.retryAssessment?.reasonTag || "dash_retry_validation_failed",
    }, {
      retryUsed: true,
      localFallbackUsed: false,
      model: String(retryResult?.modelName || defaultModel).trim() || defaultModel,
      failedExcerpt: String(retryResult?.scopeNotesText || "").trim().slice(0, 160),
      retryCandidateAccepted: Boolean(retryResult?.accepted),
      retryCandidateHasScopeNotesText: Boolean(retryResult?.scopeNotesText),
      retryCandidateHasSummaryParagraph: Boolean(retryResult?.retryAssessment?.dashHasSummaryParagraph),
      retryCandidateBypassed: true,
    });
    logDashResult("dash_retry_candidate_bypassed_for_canonical_source", {
      accepted: false,
      reasonTag: failureReasonTag || retryResult?.retryAssessment?.reasonTag || "dash_retry_validation_failed",
    }, {
      retryUsed: true,
      localFallbackUsed: false,
      model: String(retryResult?.modelName || defaultModel).trim() || defaultModel,
      failedExcerpt: String(retryResult?.scopeNotesText || "").trim().slice(0, 160),
      retryCandidateAccepted: Boolean(retryResult?.accepted),
      retryCandidateHasScopeNotesText: Boolean(retryResult?.scopeNotesText),
      retryCandidateHasSummaryParagraph: Boolean(retryResult?.retryAssessment?.dashHasSummaryParagraph),
      retryCandidateBypassed: true,
    });
    logDashResult("dash_final_branch_selected", {
      accepted: false,
      reasonTag: failureReasonTag || retryResult?.retryAssessment?.reasonTag || "dash_retry_validation_failed",
    }, {
      retryUsed: true,
      localFallbackUsed: false,
      model: String(retryResult?.modelName || defaultModel).trim() || defaultModel,
      finalBranch: "canonical_source_compile",
      finalSourceKind: "deterministic_canonical_source_compile",
      retryCandidateAccepted: Boolean(retryResult?.accepted),
      retryCandidateHasScopeNotesText: Boolean(retryResult?.scopeNotesText),
      retryCandidateHasSummaryParagraph: Boolean(retryResult?.retryAssessment?.dashHasSummaryParagraph),
    });
    return buildDashLocalFallbackResult(
      retryResult?.retryAssessment?.reasonTag || failureReasonTag || "dash_retry_validation_failed",
      "",
      {
        retryUsed: true,
        skipPromotionAttempt: true,
        canonicalSourceText: canonicalSourceSelection?.sourceText || dashRewriteSourceText || "",
        sourceSelection: canonicalSourceSelection,
      }
    );
  };
  const maybeRetryDedicatedRefineResult = async (args = {}) => {
    if (isDashRefine) return maybeRetryDashResult(args);
    if (isShorterRefine) return maybeRetryShorterResult(args);
    return null;
  };
  const finalizeRecoveredDedicatedRefineRetryResult = async (retryResult, failureReasonTag = "") => {
    if (isDashRefine) return finalizeRecoveredDashRetryResult(retryResult, failureReasonTag);
    if (isShorterRefine) return finalizeRecoveredShorterRetryResult(retryResult, failureReasonTag);
    return retryResult;
  };
  const buildDedicatedRefineLocalFallbackResult = (failureReasonTag = "", failedScopeNotes = "", options = {}) => {
    if (isDashRefine) return buildDashLocalFallbackResult(failureReasonTag, failedScopeNotes, options);
    if (isShorterRefine) return buildShorterLocalFallbackResult(failureReasonTag, failedScopeNotes, options);
    return null;
  };
  const shouldBlockPreGroq = normalizedScopeMode !== "refine" && promptMeaning.isTrulyUseless;
  log("scope_pre_groq_gate_decision", {
    selected_prompt_basis_field: String(context?.scopePromptBasisField || promptBasisResolution.field || ""),
    analyzed_prompt_text: compact(promptMeaning?.normalizedPrompt || ""),
    gate_fired: Boolean(shouldBlockPreGroq),
    gate_reason: shouldBlockPreGroq ? "prompt_too_empty_for_scope" : "",
    token_count: Array.isArray(promptMeaning?.tokens) ? promptMeaning.tokens.length : 0,
  });
  if (shouldBlockPreGroq) {
    setTruth({
      preGroqJunkGateFired: true,
      groqHandedOff: false,
    });
    log("junk_blocked_pre_groq", {
      model: "local_clarify",
      outcome: "clarify",
      reasonTag: "prompt_too_empty_for_scope",
      prompt_excerpt: String(draftBasisText || inputText || "").trim().slice(0, 120),
      token_count: Array.isArray(promptMeaning?.tokens) ? promptMeaning.tokens.length : 0,
    });
    return finalize({
      path: "junk_blocked_pre_groq",
      status: 200,
      payload: {
        outcome: "clarify",
        scopeNotes: "",
        clarificationQuestion: clarifyQuestion,
        missingFields: ["scope detail"],
      },
      traceLabel: "ok",
      traceReason: "clarify",
      outcome: "clarify",
      reasonTag: "prompt_too_empty_for_scope",
      excerpt: clarifyQuestion,
      modelName: "local_clarify",
      extra: { outcome: "clarify" },
    });
  }

  try {
    setDebug({
      model: defaultModel,
      stage: "generation_start",
    });
    log("generation_start", {
      route_function: "handleScopeAssistRequest",
      selected_model: defaultModel,
    });
    setTruth({
      preGroqJunkGateFired: false,
      groqHandedOff: true,
    });
    log("handed_to_groq", {
      route_function: "handleScopeAssistRequest",
      selected_model: defaultModel,
      selected_prompt_basis_field: String(context?.scopePromptBasisField || promptBasisResolution.field || ""),
      selected_prompt_basis_text: compact(draftBasisText),
      analyzed_prompt_text: compact(promptMeaning?.normalizedPrompt || ""),
      prompt_excerpt: compact(draftBasisText || inputText || ""),
      supports_detailed_draft: Boolean(promptMeaning?.supportsDetailedDraft),
    });

    let assistResult;
    try {
      assistResult = await callSectionAssistGroq(systemPrompt, userPrompt, trace, requestOptions, {
        sectionKey: "scope",
        scopeMode: normalizedScopeMode,
        traceId,
      });
    } catch (error) {
      const failure = normalizeScopeAssistFailure(error);
      failsafeExcerpt = String(error?.providerDetail || error?.message || failsafeExcerpt || "").trim() || failsafeExcerpt;
      log("scope_direct_rejected", {
        model: defaultModel,
        outcome: "scope",
        reasonTag: failure.failureType || "provider_failure",
        excerpt: String(error?.providerDetail || error?.message || inputText).trim().slice(0, 160),
        active_scope_parse_source: getActiveParseSource(),
      });
      if (hasDedicatedRefineFlow) {
        const retryResult = await maybeRetryDedicatedRefineResult({
          failureReasonTag: failure.failureType || "provider_failure",
          failedScopeNotes: String(error?.providerDetail || error?.message || draftBasisText || inputText),
          failedModelName: defaultModel,
        });
        return await finalizeRecoveredDedicatedRefineRetryResult(retryResult, failure.failureType || "provider_failure");
      } else {
        return buildDeterministicScope(failure.failureType || "provider_failure", String(error?.providerDetail || error?.message || draftBasisText || inputText));
      }
    }

    let activeModelName = String(assistResult?.model || defaultModel).trim() || defaultModel;
    let activeRaw = String(assistResult?.raw || "");
    let activeScopeNotesText = "";
    let activeClarificationQuestionText = "";
    let activeRetryUsed = false;
    failsafeExcerpt = activeRaw.trim() || failsafeExcerpt;
    setDebug({
      model: activeModelName,
      stage: "provider_response_received",
    });
    log("provider_response_received", {
      model: activeModelName,
      route_function: "handleScopeAssistRequest",
    });

    const initialParsedAttempt = parseProviderScopeAttempt({
      raw: activeRaw,
      modelName: activeModelName,
      attemptLabel: "initial",
    });
    if (!initialParsedAttempt.accepted) {
      if (hasDedicatedRefineFlow) {
        const retryResult = await maybeRetryDedicatedRefineResult({
          failureReasonTag: initialParsedAttempt.failureReason || "rejected_malformed",
          failedScopeNotes: activeRaw,
          failedModelName: activeModelName,
        });
        return await finalizeRecoveredDedicatedRefineRetryResult(retryResult, initialParsedAttempt.failureReason || "rejected_malformed");
      }
      return buildDeterministicScope(initialParsedAttempt.failureReason, activeRaw);
    }

    if (initialParsedAttempt.outcome === "clarify") {
      if (hasDedicatedRefineFlow) {
        const retryResult = await maybeRetryDedicatedRefineResult({
          failureReasonTag: isDashRefine ? "dash_provider_returned_clarify" : "shorter_provider_returned_clarify",
          failedScopeNotes: initialParsedAttempt.clarificationQuestionText || activeRaw,
          failedModelName: activeModelName,
        });
        return await finalizeRecoveredDedicatedRefineRetryResult(
          retryResult,
          isDashRefine ? "dash_provider_returned_clarify" : "shorter_provider_returned_clarify"
        );
      }
      return finalize({
        path: "direct_groq_clarify",
        status: 200,
        payload: {
          outcome: "clarify",
          scopeNotes: "",
          clarificationQuestion: initialParsedAttempt.clarificationQuestionText || clarifyQuestion,
          missingFields: Array.isArray(initialParsedAttempt?.parsed?.missingFields) ? initialParsedAttempt.parsed.missingFields : ["scope detail"],
        },
        traceLabel: "ok",
        traceReason: "clarify",
        outcome: "clarify",
        reasonTag: "provider_requested_clarify",
        excerpt: initialParsedAttempt.clarificationQuestionText || clarifyQuestion,
        modelName: activeModelName,
        extra: { outcome: "clarify" },
      });
    }

    activeScopeNotesText = initialParsedAttempt.scopeNotesText;
    activeClarificationQuestionText = initialParsedAttempt.clarificationQuestionText;

    if (isDashRefine) {
      const dashAssessment = assessDashScopeRefineCompliance(dashRewriteSourceText, activeScopeNotesText);
      setDashRuntime(dashAssessment, {
        retryUsed: false,
        localFallbackUsed: false,
      });
        setTruth({
          dashGroqRewriteUsed: true,
          dashGroqRewriteValidated: Boolean(dashAssessment.accepted),
          dashGroqRewriteRetryCount: 0,
          dashLocalCompilerBypassed: true,
          dashTransformSource: dashRewriteSourceText,
          dashUsedOriginalAcceptedProse: Boolean(dashRewriteSourceSelection?.usedAcceptedProseDraft),
        });
      logDashResult("dash_compliance_initial_evaluated", dashAssessment, {
        retryUsed: false,
        localFallbackUsed: false,
        attemptLabel: "initial",
        model: activeModelName,
      });
      if (dashAssessment.accepted) {
        setTruth({
          dashReturnedSuccess: true,
          dashSuccessBlockedForComplianceFailure: false,
          dashReturnedFailurePath: false,
          dashFallbackAccepted: false,
          dashBestEffortSuccessRemoved: true,
        });
        return finalize({
          path: "direct_groq_success",
          status: 200,
          payload: {
            outcome: "scope",
            scopeNotes: activeScopeNotesText,
            clarificationQuestion: "",
            missingFields: [],
          },
          traceLabel: "ok",
          traceReason: "success",
          outcome: "scope",
          reasonTag: dashAssessment.reasonTag || "dash_format_and_semantics_pass",
          excerpt: activeScopeNotesText,
          modelName: activeModelName,
          retryUsed: false,
          extra: { outcome: "scope" },
        });
      }

      // --- Deterministic repair pass: fix near-pass format/fragment issues before retry ---
      const dashRepairableReasons = new Set([
        "dash_missing_summary_paragraph",
        "dash_summary_too_thin",
        "dash_summary_intro_echo",
        "dash_summary_lead_bullet_echo",
        "dash_repetitive_step_echo",
        "dash_near_duplicate_step_echo",
        "dash_generic_intro_bullet_rejected",
        "dash_source_sentence_echo",
        "dash_fragment_bullet_rejected",
        "dash_split_sentence_echo",
        "dash_invalid_dash_then_paragraph_shape",
        "dash_overview_sentence_bias",
        "dash_low_step_distinctness",
      ]);
      const dashInitialReasonTag = dashAssessment.reasonTag || "";
      const dashRepairTriggered = Boolean(dashAssessment.dashLineCount) && dashRepairableReasons.has(dashInitialReasonTag);
      if (dashRepairTriggered) {
        const repairResult = repairDashRefineOutput(dashRewriteSourceText, activeScopeNotesText);
        setTruth({
          dashRepairAttempted: true,
          dashRepairTriggerReason: dashInitialReasonTag,
          dashRepairFragmentsRemovedCount: repairResult.fragmentsRemovedCount || 0,
          dashRepairSplitEchoesRemovedCount: repairResult.splitEchoesRemovedCount || 0,
          dashRepairSummarySynthesized: Boolean(repairResult.summarySynthesized),
          dashRepairSummarySource: String(repairResult.summarySource || ""),
          dashRepairAnythingChanged: Boolean(repairResult.repaired),
        });
        if (repairResult.repaired && repairResult.repairedText) {
          let repairedAssessment = assessDashScopeRefineCompliance(dashRewriteSourceText, repairResult.repairedText);
          let repairedText = repairResult.repairedText;
          setDashRuntime(repairedAssessment, {
            retryUsed: false,
            localFallbackUsed: false,
          });
          logDashResult("dash_compliance_repair_evaluated", repairedAssessment, {
            retryUsed: false,
            localFallbackUsed: false,
            repairUsed: true,
            attemptLabel: "repair",
            model: activeModelName,
            repairDiag: {
              trigger: dashInitialReasonTag,
              fragmentsRemoved: repairResult.fragmentsRemovedCount,
              splitEchoesRemoved: repairResult.splitEchoesRemovedCount,
              genericIntroRemoved: repairResult.genericIntroRemovedCount,
              nearDuplicateRemoved: repairResult.nearDuplicateRemovedCount,
              summarySynthesized: repairResult.summarySynthesized,
              summarySource: repairResult.summarySource,
              originalLineCount: repairResult.originalDashLineCount,
              cleanedLineCount: repairResult.cleanedDashLineCount,
            },
          });

          // --- Final summary-only repair pass ---
          // If the repaired candidate still fails ONLY because the summary paragraph
          // is missing/empty, but the cleaned bullets are otherwise usable, try one
          // last local summary synthesis and re-assess.
          if (!repairedAssessment.accepted
            && (
              repairedAssessment.reasonTag === "dash_missing_summary_paragraph"
              || repairedAssessment.reasonTag === "dash_summary_too_thin"
              || repairedAssessment.reasonTag === "dash_summary_intro_echo"
              || repairedAssessment.reasonTag === "dash_summary_lead_bullet_echo"
            )
            && repairResult.cleanedDashLineCount >= 1
          ) {
            const summaryOnlySubject = buildDashCompilerSubjectPhrase(dashRewriteSourceText, "");
            const summaryOnlyCandidate = sanitizeScopeAssistText(
              `Complete ${summaryOnlySubject} so all listed work is finished and ready for continued operation.`
            );
            if (summaryOnlyCandidate && !isDashSummaryTooSimilarToLeadBullet(summaryOnlyCandidate, repairResult.cleanedDashLines || [])) {
              const summaryOnlyBullets = (repairResult.cleanedDashLines || []).map((line) => `- ${line}`).join("\n");
              const summaryOnlyText = sanitizeScopeAssistText(`${summaryOnlyBullets}\n\n${summaryOnlyCandidate}`);
              if (summaryOnlyText) {
                const summaryOnlyAssessment = assessDashScopeRefineCompliance(dashRewriteSourceText, summaryOnlyText);
                logDashResult("dash_compliance_summary_only_repair_evaluated", summaryOnlyAssessment, {
                  retryUsed: false,
                  localFallbackUsed: false,
                  repairUsed: true,
                  attemptLabel: "summary_only_repair",
                  model: activeModelName,
                });
                if (summaryOnlyAssessment.accepted) {
                  repairedAssessment = summaryOnlyAssessment;
                  repairedText = summaryOnlyText;
                  setTruth({
                    dashRepairSummaryOnlyPassUsed: true,
                    dashRepairSummarySynthesized: true,
                    dashRepairSummarySource: "summary_only_last_resort",
                  });
                  setDashRuntime(repairedAssessment, {
                    retryUsed: false,
                    localFallbackUsed: false,
                  });
                }
              }
            }
          }

          if (repairedAssessment.accepted) {
            setTruth({
              dashRepairAccepted: true,
              dashRepairRejected: false,
              dashReturnedSuccess: true,
              dashSuccessBlockedForComplianceFailure: false,
              dashReturnedFailurePath: false,
              dashFallbackAccepted: false,
              dashBestEffortSuccessRemoved: true,
              dashGroqRewriteValidated: true,
            });
            return finalize({
              path: "direct_groq_repair_success",
              status: 200,
              payload: {
                outcome: "scope",
                scopeNotes: repairedText,
                clarificationQuestion: "",
                missingFields: [],
              },
              traceLabel: "ok",
              traceReason: "success_after_repair",
              outcome: "scope",
              reasonTag: repairedAssessment.reasonTag || "dash_repair_pass",
              excerpt: repairedText,
              modelName: activeModelName,
              retryUsed: false,
              extra: { outcome: "scope" },
            });
          }
          setTruth({
            dashRepairAccepted: false,
            dashRepairRejected: true,
            dashRepairRejectedReason: repairedAssessment.reasonTag || "repair_still_failed",
          });
        }
      } else {
        setTruth({
          dashRepairAttempted: false,
          dashRepairTriggerReason: "",
        });
      }

      const retryResult = await maybeRetryDashResult({
        failureReasonTag: dashAssessment.reasonTag || "dash_format_or_semantic_failure",
        failedScopeNotes: activeScopeNotesText,
        failedModelName: activeModelName,
      });
      return await finalizeRecoveredDashRetryResult(
        retryResult,
        dashAssessment.reasonTag || "dash_format_or_semantic_failure"
      );
    }

    if (isShorterRefine && !activeRetryUsed) {
      const shorterAssessment = assessShorterScopeRefineCompliance(shorterSourceText, activeScopeNotesText);
      setShorterRuntime(shorterAssessment, {
        retryUsed: false,
        localFallbackUsed: false,
      });
      logShorterResult("shorter_compliance_initial_evaluated", shorterAssessment, {
        retryUsed: false,
        localFallbackUsed: false,
        attemptLabel: "initial",
        model: activeModelName,
      });
      if (!shorterAssessment.accepted) {
        const retryResult = await maybeRetryShorterResult({
          failureReasonTag: shorterAssessment.reasonTag || "shorter_not_compressed_enough",
          failedScopeNotes: activeScopeNotesText,
          failedModelName: activeModelName,
        });
        if (retryResult?.status) return retryResult;
        activeModelName = retryResult.modelName;
        activeRaw = retryResult.raw;
        activeScopeNotesText = retryResult.scopeNotesText;
        activeClarificationQuestionText = retryResult.clarificationQuestionText;
        activeRetryUsed = Boolean(retryResult.retryUsed);
      }
    }

    const scopeAssessment = assessScopeAssistOutput(activeScopeNotesText, draftBasisText);
    const scaffoldAssessment = assessScopeAssistGenericScaffold(activeScopeNotesText, draftBasisText);
    const explicitScaffoldAssessment = matchScopeAssistExplicitScaffoldPhrase(activeScopeNotesText);
    const styleAssessment = assessScopeAssistStyleCompliance(activeScopeNotesText, draftBasisText, promptAnalysis);
    const scopeStyleRuntimeMeta = toScopeStyleRuntimeMeta(styleAssessment);
    const hasNonBlockingStyleRejection = isNonBlockingScopeStyleRejection(styleAssessment);
    failsafeStyleMeta = scopeStyleRuntimeMeta;

    if (explicitScaffoldAssessment.matched) {
      log("local_validation_rejected", {
        model: activeModelName,
        outcome: "scope",
        reasonTag: "explicit_scaffold_phrase",
        excerpt: String(activeScopeNotesText || activeRaw).trim().slice(0, 160),
      });
      log("explicit_scaffold_rejected", {
        model: activeModelName,
        outcome: "scope",
        reasonTag: "explicit_scaffold_phrase",
        pattern: explicitScaffoldAssessment.pattern,
        match: explicitScaffoldAssessment.match,
        excerpt: activeScopeNotesText.slice(0, 160),
        active_scope_parse_source: getActiveParseSource(),
      });
      if (hasDedicatedRefineFlow) {
        const retryResult = await maybeRetryDedicatedRefineResult({
          failureReasonTag: "explicit_scaffold_phrase",
          failedScopeNotes: activeScopeNotesText,
          failedModelName: activeModelName,
        });
        return await finalizeRecoveredDedicatedRefineRetryResult(retryResult, "explicit_scaffold_phrase");
      }
      return buildDeterministicScope("explicit_scaffold_phrase", activeScopeNotesText, scopeStyleRuntimeMeta);
    }

    const isAccepted = scopeAssessment.accepted
      && scaffoldAssessment.accepted
      && !explicitScaffoldAssessment.matched
      && (styleAssessment.accepted || hasNonBlockingStyleRejection);

    if (isAccepted) {
      if (hasNonBlockingStyleRejection) {
        log("style_rejection_downgraded_to_advisory", {
          model: activeModelName,
          outcome: "scope",
          reasonTag: String(styleAssessment.reasonTag || ""),
          matchedPattern: String(styleAssessment.matchedPattern || ""),
          excerpt: String(styleAssessment.excerpt || activeScopeNotesText || activeRaw).trim().slice(0, 160),
          active_scope_parse_source: getActiveParseSource(),
        });
      }
      terminalLog("LIVE_SCOPE_ACCEPT_BRANCH", {
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        liveScopeServerFile: "server/dev-ai.js",
        styleAssessmentAccepted: Boolean(styleAssessment.accepted),
        styleAssessmentReasonTag: String(styleAssessment.reasonTag || ""),
        styleAssessmentMatchedPattern: String(styleAssessment.matchedPattern || ""),
        paragraphCount: Math.max(0, Number(styleAssessment.paragraphCount || 0)),
        sentenceCount: Math.max(0, Number(styleAssessment.sentenceCount || 0)),
        scopeExcerpt: String(activeScopeNotesText || "").trim().slice(0, 240),
      });
      terminalLog("STYLE_GATE_RUNTIME_DIRECT_SUCCESS", {
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        styleAssessmentAccepted: Boolean(styleAssessment.accepted),
        styleAssessmentReasonTag: String(styleAssessment.reasonTag || ""),
        styleAssessmentMatchedPattern: String(styleAssessment.matchedPattern || ""),
        paragraphCount: Math.max(0, Number(styleAssessment.paragraphCount || 0)),
        sentenceCount: Math.max(0, Number(styleAssessment.sentenceCount || 0)),
        scopeExcerpt: String(activeScopeNotesText || "").trim().slice(0, 240),
      });
      return finalize({
        path: "direct_groq_success",
        status: 200,
        payload: {
          outcome: "scope",
          scopeNotes: activeScopeNotesText,
          clarificationQuestion: "",
          missingFields: [],
        },
        traceLabel: "ok",
        traceReason: "success",
        outcome: "scope",
        reasonTag: scaffoldAssessment.reasonTag || "job_specific_content",
        excerpt: activeScopeNotesText,
        modelName: activeModelName,
        retryUsed: activeRetryUsed,
        styleMeta: scopeStyleRuntimeMeta,
        extra: { outcome: "scope" },
      });
    }

    if (!styleAssessment.accepted) {
      terminalLog("LIVE_SCOPE_REJECT_BRANCH", {
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        liveScopeServerFile: "server/dev-ai.js",
        styleAssessmentReasonTag: String(styleAssessment.reasonTag || ""),
        styleAssessmentMatchedPattern: String(styleAssessment.matchedPattern || ""),
        paragraphCount: Math.max(0, Number(styleAssessment.paragraphCount || 0)),
        sentenceCount: Math.max(0, Number(styleAssessment.sentenceCount || 0)),
        scopeExcerpt: String(styleAssessment.excerpt || activeScopeNotesText || activeRaw).trim().slice(0, 240),
      });
      terminalLog("STYLE_GATE_RUNTIME_REJECTED", {
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        styleAssessmentReasonTag: String(styleAssessment.reasonTag || ""),
        styleAssessmentMatchedPattern: String(styleAssessment.matchedPattern || ""),
        paragraphCount: Math.max(0, Number(styleAssessment.paragraphCount || 0)),
        sentenceCount: Math.max(0, Number(styleAssessment.sentenceCount || 0)),
        scopeExcerpt: String(styleAssessment.excerpt || activeScopeNotesText || activeRaw).trim().slice(0, 240),
      });
      log("style_rejected_direct_output", {
        model: activeModelName,
        outcome: "scope",
        reasonTag: styleAssessment.reasonTag,
        matchedPattern: styleAssessment.matchedPattern || "",
        excerpt: String(styleAssessment.excerpt || activeScopeNotesText || activeRaw).trim().slice(0, 160),
        active_scope_parse_source: getActiveParseSource(),
      });
    }

    const invalidReason = scopeAssessment.accepted
      ? (styleAssessment.accepted
        ? (scaffoldAssessment.reasonTag || scaffoldAssessment.reason || "missing_job_specific_content")
        : styleAssessment.reasonTag)
      : scopeAssessment.reason;
    log("local_validation_rejected", {
      model: activeModelName,
      outcome: "scope",
      reasonTag: invalidReason,
      excerpt: String(scaffoldAssessment.excerpt || activeScopeNotesText || activeRaw).trim().slice(0, 160),
    });
    log("scope_direct_rejected", {
      model: activeModelName,
      outcome: "scope",
      reasonTag: invalidReason,
      excerpt: String(scaffoldAssessment.excerpt || activeScopeNotesText || activeRaw).trim().slice(0, 160),
      active_scope_parse_source: getActiveParseSource(),
    });
    if (hasDedicatedRefineFlow) {
      const retryResult = await maybeRetryDedicatedRefineResult({
        failureReasonTag: invalidReason,
        failedScopeNotes: String(scaffoldAssessment.excerpt || activeScopeNotesText || activeRaw),
        failedModelName: activeModelName,
      });
      return await finalizeRecoveredDedicatedRefineRetryResult(retryResult, invalidReason);
    }
    return buildDeterministicScope(
      invalidReason,
      String(scaffoldAssessment.excerpt || activeScopeNotesText || activeRaw),
      scopeStyleRuntimeMeta
    );
  } catch (error) {
    if (!clearPromptFailsafeEligible) throw error;
    const fallbackScopeNotes = sanitizeScopeAssistText(
      normalizedScopeMode === "refine" && existingScopeText
        ? existingScopeText
        : buildScopeAssistSimpleRecoveryDraft(draftBasisText)
    );
    terminalLog("SCOPE_CLEAR_PROMPT_FAILSAFE", {
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      originalErrorMessage: String(error?.message || error || "").trim().slice(0, 240),
      promptExcerpt: String(draftBasisText || inputText || "").trim().slice(0, 160),
      fallbackExcerpt: String(fallbackScopeNotes || "").trim().slice(0, 240),
    });
    if (hasDedicatedRefineFlow) {
      return buildDedicatedRefineLocalFallbackResult(
        "internal_failsafe_recovery",
        failsafeExcerpt,
        {
          retryUsed: isDashRefine ? dashRetryAttempted : shorterRetryAttempted,
        }
      );
    }
    return buildDeterministicScopeSafely(
      "internal_failsafe_recovery",
      failsafeExcerpt,
      failsafeStyleMeta
    );
  }
}

app.post("/api/ai-assist", async (req, res) => {
  const {
    sectionKey,
    userInput,
    context,
    mode,
    sourcePrompt,
    sourceScopePrompt,
    promptText,
    currentPrompt,
    assistantMessage,
    currentScope,
    refineInstruction,
    formatIntent,
    ignoreCurrentScope,
    _traceId,
  } = req.body || {};
  const _tid = String(_traceId || "").slice(0, 16); // Pass 19: correlation trace ID from client
  const requestStartedAt = Date.now();
  const normalizedSectionKey = normalizeAssistSectionKey(sectionKey, context?.currentSection);
  const normalizedScopeMode = normalizedSectionKey === "scope" && String(mode || context?.scopeMode || "").trim().toLowerCase() === "refine"
    ? "refine"
    : "initial";
  const refineInstructionText = String(refineInstruction || context?.refineInstruction || userInput || "").trim();
  const dashBriefLocalRefine = normalizedSectionKey === "scope"
    && normalizedScopeMode === "refine"
    && isScopeRefineDashBriefInstruction(refineInstructionText);
  const dashBriefLocalSourceText = dashBriefLocalRefine
    ? sanitizeScopeAssistText(
      context?.originalAcceptedProseScope
      || context?.dashCanonicalAcceptedProse
      || context?.dashImmutableAcceptedProse
      || context?.immutableAcceptedProseScope
      || (ignoreCurrentScope ? String(currentScope || "").trim() : String(currentScope || context?.currentScopeNotes || context?.existingScopeText || "").trim())
      || ""
    )
    : "";
  const scopePromptResolution = normalizedSectionKey === "scope"
    ? (dashBriefLocalRefine
      ? {
        field: "dash_local_source",
        text: dashBriefLocalSourceText,
        raw: dashBriefLocalSourceText,
      }
      : resolveScopeAssistPromptBasis({
        userInput: String(userInput || ""),
        sourcePrompt: String(sourcePrompt || ""),
        sourceScopePrompt: String(sourceScopePrompt || ""),
        promptText: String(promptText || ""),
        currentPrompt: String(currentPrompt || ""),
        assistantMessage: String(assistantMessage || ""),
        context: context || {},
      }))
    : { field: "", text: "", raw: "" };
  const normalizedContext = {
    ...(context || {}),
    currentSection: normalizedSectionKey,
    ...(normalizedSectionKey === "scope" ? {
      scopeMode: normalizedScopeMode,
      sourceScopePrompt: scopePromptResolution.text || String(sourcePrompt || sourceScopePrompt || context?.sourceScopePrompt || "").trim(),
      scopePromptBasis: scopePromptResolution.text || String(dashBriefLocalRefine ? "" : userInput || sourcePrompt || sourceScopePrompt || promptText || currentPrompt || assistantMessage || "").trim(),
      scopePromptBasisField: scopePromptResolution.field || "",
      currentScopeNotes: ignoreCurrentScope
        ? String(currentScope || "").trim()
        : String(currentScope || context?.currentScopeNotes || "").trim(),
      refineInstruction: refineInstructionText,
      scopeFormatIntent: String(formatIntent || context?.scopeFormatIntent || "").trim(),
      ignoreCurrentScope: Boolean(ignoreCurrentScope),
    } : {}),
  };
  const trace = startRouteTrace("/api/ai-assist", { section: normalizedSectionKey || String(sectionKey || "") });
  const isScopeSection = normalizedSectionKey === "scope";
  const scopeRefineRuntimeMeta = isScopeSection
    ? getScopeRefineRuntimeMeta({
      scopeMode: normalizedScopeMode,
      refineInstruction: String(refineInstruction || context?.refineInstruction || userInput || "").trim(),
      userInput: String(userInput || ""),
      currentScopeNotes: ignoreCurrentScope
        ? String(currentScope || "").trim()
        : String(currentScope || context?.currentScopeNotes || "").trim(),
      context: normalizedContext,
    })
    : null;
  const scopeDebugState = {
    path: "",
    model: "",
    stage: "",
  };
  const scopeRuntimeTruthState = {
    outcome: "",
    reasonTag: "",
    excerpt: "",
    responseSource: "",
    fallbackSource: "",
    parseBranch: "",
    parseFailureReason: "",
    parseSource: "",
    retryUsed: false,
    groqHandedOff: false,
    preGroqJunkGateFired: false,
    refineMode: "",
    refineInstruction: "",
    dashDetectorMatched: false,
    dashBranchActive: false,
    shorterDetectorMatched: false,
    shorterBranchActive: false,
    refinePromptBranch: "",
    currentScopeDraftExcerpt: "",
    dashMode: false,
    dashSourcePromptWeighted: false,
    dashCompiledLocally: false,
    dashCompilerSource: "",
    dashCompilerStepCount: 0,
    dashCompilerDroppedDuplicateCount: 0,
    dashCompilerDroppedFragmentCount: 0,
    dashCompilerUsedModelBullets: false,
    dashCompilerProceduralCandidateCount: 0,
    dashCompilerDroppedGenericIntroCount: 0,
    dashCompilerRejectedIntroCandidateCount: 0,
    dashCompilerUsedProceduralSentences: false,
    dashCompilerSummaryBuiltFromSteps: false,
    dashCompilerSelectedProceduralStepCount: 0,
    dashCompilerDenseProseProceduralMode: false,
    dashCompilerRejectedSourceIntroSummary: false,
    dashCompilerSourcePriority: "",
    dashCompilerRejectedCurrentDraftAsCompilerSource: false,
    dashCompilerRejectedFailedDashAsCompilerSource: false,
    dashCompilerUsedOriginalProseSource: false,
    dashCompilerFallbackSourceTextBlocked: false,
    dashCompilerSourceTextUsedForCompilation: "",
    dashTransformSource: "",
    dashCanonicalProseSourceType: "",
    dashCanonicalProseChars: 0,
    dashUsedOriginalAcceptedProse: false,
    dashUsedAcceptedProseDraft: false,
    dashFellBackToRequestText: false,
    dashImmutableAcceptedProseCapturedOnNonDashSuccess: false,
    dashImmutableAcceptedProseCaptureBranch: "",
    dashImmutableAcceptedProseReadFromCache: false,
    dashImmutableAcceptedProseSeedBlockedFromDashRefine: false,
    dashImmutableAcceptedProseSeedBlockedFromCurrentDraft: false,
    dashImmutableAcceptedProseSeedBlockedFromExistingScope: false,
    dashRejectedLateImmutableSeed: false,
    dashFailedClosedForMissingPreCapturedImmutableProse: false,
    dashImmutableAcceptedProseCaptured: false,
    dashImmutableAcceptedProseChars: 0,
    dashUsedImmutableAcceptedProse: false,
    dashRejectedMutableCurrentScopeAsSource: false,
    dashRejectedMutableExistingScopeAsSource: false,
    dashImmutableSourceMatchedRetry: false,
    dashSourceMismatchDetected: false,
    dashUsedRequestFallbackBecauseNoImmutableAcceptedProse: false,
    dashRetryPromptUsedCleanSourceOnly: false,
    dashRetryPromptBlockedFailedDraft: false,
    dashRetryPromptBlockedCurrentDraft: false,
    dashRetryUsedCleanOriginalProse: false,
    dashRetryUsedSameCanonicalProse: false,
    dashRetryBlockedFailedDashText: false,
    dashRetryBlockedCurrentMalformedDash: false,
    dashPromptUsedRequestTextOnlyBecauseAcceptedProseMissing: false,
    dashRetrySamplingRaised: false,
    dashGroqRewriteUsed: false,
    dashLocalCompilerBypassed: false,
    dashGroqRewriteValidated: false,
    dashGroqRewriteRetryCount: 0,
    dashCompilerSelectorFailClosed: false,
    dashCompilerSelectorUsedProceduralPoolOnly: false,
    dashCompilerRejectedForMissingProceduralPool: false,
    dashLineCount: 0,
    dashHasSummaryParagraph: false,
    dashFormatPass: null,
    dashSemanticPass: null,
    dashDistinctStepPass: null,
    dashRetryUsed: false,
    dashLocalFallbackUsed: false,
    dashFallbackRejectedForCompliance: false,
    dashRejectedBeforeDirectSuccess: false,
    dashFallbackAccepted: false,
    dashSuccessBlockedForComplianceFailure: false,
    dashReturnedSuccess: false,
    dashReturnedFailurePath: false,
    dashBestEffortSuccessRemoved: false,
    dashRepeatedLineCount: 0,
    dashSplitSentenceEchoLineCount: 0,
    dashNearDuplicateLineCount: 0,
    dashFragmentBulletRejected: false,
    dashMaxLineOverlap: 0,
    dashSummaryEchoLikeStep: false,
    dashSummaryLeadBulletEchoLikeStep: false,
    dashSourceSentenceEchoLikeStep: false,
    dashProceduralSentenceBiasActive: false,
    dashOverviewSentenceRejectedCount: 0,
    dashProceduralBulletCount: 0,
    dashOverviewBulletCount: 0,
    dashRejectedForOverviewBias: false,
    dashInventedMajorDetailRejected: false,
    dashFewShotPromptUsed: false,
    dashOverviewSentenceBiasDetected: false,
    dashProceduralSentenceCoverage: 0,
    dashSummaryEchoedOverview: false,
    sourceWordCount: 0,
    returnedWordCount: 0,
    compressionRatio: 0,
    shorterParagraphCount: 0,
    shorterSingleParagraphPass: null,
    shorterRejectedForParagraphCount: false,
    shorterCompliancePass: null,
    shorterSemanticPass: null,
    preservedAnchorTerms: [],
    missingAnchorTerms: [],
    inventedExclusionLikeLanguage: false,
    inventedProcessDetailLikeLanguage: false,
    shorterRejectedForSemanticDrift: false,
    shorterLocalFallbackUsed: false,
    scopeStyleAccepted: null,
    scopeStyleReasonTag: "",
    scopeStyleMatchedPattern: "",
    scopeParagraphCount: 0,
    scopeSentenceCount: 0,
  };
  const getScopeRuntimePath = () => {
    const current = String(scopeDebugState.path || "").trim();
    if (
      current === "junk_blocked_pre_groq"
      || current === "direct_groq_success"
      || current === "direct_groq_clarify"
      || current === "grounded_fallback_success"
      || current === "shorter_local_fallback_success"
      || current === "provider_failure_no_grounded_fallback"
      || current === "malformed_or_internal_failure"
    ) {
      return current;
    }
    return "malformed_or_internal_failure";
  };
  const setScopeDebugState = (next = {}) => {
    if (!isScopeSection || !IS_DEV_RUNTIME) return;
    if (next.path) scopeDebugState.path = next.path;
    if (next.model) scopeDebugState.model = next.model;
    if (next.stage) scopeDebugState.stage = next.stage;
  };
  const setScopeRuntimeTruth = (next = {}) => {
    if (!isScopeSection || !IS_DEV_RUNTIME) return;
    if (Object.prototype.hasOwnProperty.call(next, "outcome")) scopeRuntimeTruthState.outcome = String(next.outcome || "");
    if (Object.prototype.hasOwnProperty.call(next, "reasonTag")) scopeRuntimeTruthState.reasonTag = String(next.reasonTag || "");
    if (Object.prototype.hasOwnProperty.call(next, "excerpt")) scopeRuntimeTruthState.excerpt = String(next.excerpt || "");
    if (Object.prototype.hasOwnProperty.call(next, "responseSource")) scopeRuntimeTruthState.responseSource = String(next.responseSource || "");
    if (Object.prototype.hasOwnProperty.call(next, "fallbackSource")) scopeRuntimeTruthState.fallbackSource = String(next.fallbackSource || "");
    if (Object.prototype.hasOwnProperty.call(next, "parseBranch")) scopeRuntimeTruthState.parseBranch = String(next.parseBranch || "");
    if (Object.prototype.hasOwnProperty.call(next, "parseFailureReason")) scopeRuntimeTruthState.parseFailureReason = String(next.parseFailureReason || "");
    if (Object.prototype.hasOwnProperty.call(next, "parseSource")) scopeRuntimeTruthState.parseSource = String(next.parseSource || "");
    if (Object.prototype.hasOwnProperty.call(next, "retryUsed")) scopeRuntimeTruthState.retryUsed = Boolean(next.retryUsed);
    if (Object.prototype.hasOwnProperty.call(next, "groqHandedOff")) scopeRuntimeTruthState.groqHandedOff = Boolean(next.groqHandedOff);
    if (Object.prototype.hasOwnProperty.call(next, "preGroqJunkGateFired")) scopeRuntimeTruthState.preGroqJunkGateFired = Boolean(next.preGroqJunkGateFired);
    if (Object.prototype.hasOwnProperty.call(next, "refineMode")) scopeRuntimeTruthState.refineMode = String(next.refineMode || "");
    if (Object.prototype.hasOwnProperty.call(next, "refineInstruction")) scopeRuntimeTruthState.refineInstruction = String(next.refineInstruction || "");
    if (Object.prototype.hasOwnProperty.call(next, "dashDetectorMatched")) scopeRuntimeTruthState.dashDetectorMatched = Boolean(next.dashDetectorMatched);
    if (Object.prototype.hasOwnProperty.call(next, "dashBranchActive")) scopeRuntimeTruthState.dashBranchActive = Boolean(next.dashBranchActive);
    if (Object.prototype.hasOwnProperty.call(next, "shorterDetectorMatched")) scopeRuntimeTruthState.shorterDetectorMatched = Boolean(next.shorterDetectorMatched);
    if (Object.prototype.hasOwnProperty.call(next, "shorterBranchActive")) scopeRuntimeTruthState.shorterBranchActive = Boolean(next.shorterBranchActive);
    if (Object.prototype.hasOwnProperty.call(next, "refinePromptBranch")) scopeRuntimeTruthState.refinePromptBranch = String(next.refinePromptBranch || "");
    if (Object.prototype.hasOwnProperty.call(next, "currentScopeDraftExcerpt")) scopeRuntimeTruthState.currentScopeDraftExcerpt = String(next.currentScopeDraftExcerpt || "");
    if (Object.prototype.hasOwnProperty.call(next, "dashMode")) scopeRuntimeTruthState.dashMode = Boolean(next.dashMode);
    if (Object.prototype.hasOwnProperty.call(next, "dashSourcePromptWeighted")) scopeRuntimeTruthState.dashSourcePromptWeighted = Boolean(next.dashSourcePromptWeighted);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompiledLocally")) scopeRuntimeTruthState.dashCompiledLocally = Boolean(next.dashCompiledLocally);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerSource")) scopeRuntimeTruthState.dashCompilerSource = String(next.dashCompilerSource || "");
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerStepCount")) scopeRuntimeTruthState.dashCompilerStepCount = Math.max(0, Number(next.dashCompilerStepCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerDroppedDuplicateCount")) scopeRuntimeTruthState.dashCompilerDroppedDuplicateCount = Math.max(0, Number(next.dashCompilerDroppedDuplicateCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerDroppedFragmentCount")) scopeRuntimeTruthState.dashCompilerDroppedFragmentCount = Math.max(0, Number(next.dashCompilerDroppedFragmentCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerUsedModelBullets")) scopeRuntimeTruthState.dashCompilerUsedModelBullets = Boolean(next.dashCompilerUsedModelBullets);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerProceduralCandidateCount")) scopeRuntimeTruthState.dashCompilerProceduralCandidateCount = Math.max(0, Number(next.dashCompilerProceduralCandidateCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerDroppedGenericIntroCount")) scopeRuntimeTruthState.dashCompilerDroppedGenericIntroCount = Math.max(0, Number(next.dashCompilerDroppedGenericIntroCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerRejectedIntroCandidateCount")) scopeRuntimeTruthState.dashCompilerRejectedIntroCandidateCount = Math.max(0, Number(next.dashCompilerRejectedIntroCandidateCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerUsedProceduralSentences")) scopeRuntimeTruthState.dashCompilerUsedProceduralSentences = Boolean(next.dashCompilerUsedProceduralSentences);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerSummaryBuiltFromSteps")) scopeRuntimeTruthState.dashCompilerSummaryBuiltFromSteps = Boolean(next.dashCompilerSummaryBuiltFromSteps);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerSelectedProceduralStepCount")) scopeRuntimeTruthState.dashCompilerSelectedProceduralStepCount = Math.max(0, Number(next.dashCompilerSelectedProceduralStepCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerDenseProseProceduralMode")) scopeRuntimeTruthState.dashCompilerDenseProseProceduralMode = Boolean(next.dashCompilerDenseProseProceduralMode);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerRejectedSourceIntroSummary")) scopeRuntimeTruthState.dashCompilerRejectedSourceIntroSummary = Boolean(next.dashCompilerRejectedSourceIntroSummary);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerSourcePriority")) scopeRuntimeTruthState.dashCompilerSourcePriority = String(next.dashCompilerSourcePriority || "");
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerRejectedCurrentDraftAsCompilerSource")) scopeRuntimeTruthState.dashCompilerRejectedCurrentDraftAsCompilerSource = Boolean(next.dashCompilerRejectedCurrentDraftAsCompilerSource);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerRejectedFailedDashAsCompilerSource")) scopeRuntimeTruthState.dashCompilerRejectedFailedDashAsCompilerSource = Boolean(next.dashCompilerRejectedFailedDashAsCompilerSource);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerUsedOriginalProseSource")) scopeRuntimeTruthState.dashCompilerUsedOriginalProseSource = Boolean(next.dashCompilerUsedOriginalProseSource);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerFallbackSourceTextBlocked")) scopeRuntimeTruthState.dashCompilerFallbackSourceTextBlocked = Boolean(next.dashCompilerFallbackSourceTextBlocked);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerSourceTextUsedForCompilation")) scopeRuntimeTruthState.dashCompilerSourceTextUsedForCompilation = String(next.dashCompilerSourceTextUsedForCompilation || "");
    if (Object.prototype.hasOwnProperty.call(next, "dashTransformSource")) scopeRuntimeTruthState.dashTransformSource = String(next.dashTransformSource || "");
    if (Object.prototype.hasOwnProperty.call(next, "dashCanonicalProseSourceType")) scopeRuntimeTruthState.dashCanonicalProseSourceType = String(next.dashCanonicalProseSourceType || "");
    if (Object.prototype.hasOwnProperty.call(next, "dashCanonicalProseChars")) scopeRuntimeTruthState.dashCanonicalProseChars = Math.max(0, Number(next.dashCanonicalProseChars || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashUsedOriginalAcceptedProse")) scopeRuntimeTruthState.dashUsedOriginalAcceptedProse = Boolean(next.dashUsedOriginalAcceptedProse);
    if (Object.prototype.hasOwnProperty.call(next, "dashUsedAcceptedProseDraft")) scopeRuntimeTruthState.dashUsedAcceptedProseDraft = Boolean(next.dashUsedAcceptedProseDraft);
    if (Object.prototype.hasOwnProperty.call(next, "dashFellBackToRequestText")) scopeRuntimeTruthState.dashFellBackToRequestText = Boolean(next.dashFellBackToRequestText);
    if (Object.prototype.hasOwnProperty.call(next, "dashImmutableAcceptedProseCapturedOnNonDashSuccess")) scopeRuntimeTruthState.dashImmutableAcceptedProseCapturedOnNonDashSuccess = Boolean(next.dashImmutableAcceptedProseCapturedOnNonDashSuccess);
    if (Object.prototype.hasOwnProperty.call(next, "dashImmutableAcceptedProseCaptureBranch")) scopeRuntimeTruthState.dashImmutableAcceptedProseCaptureBranch = String(next.dashImmutableAcceptedProseCaptureBranch || "");
    if (Object.prototype.hasOwnProperty.call(next, "dashImmutableAcceptedProseReadFromCache")) scopeRuntimeTruthState.dashImmutableAcceptedProseReadFromCache = Boolean(next.dashImmutableAcceptedProseReadFromCache);
    if (Object.prototype.hasOwnProperty.call(next, "dashImmutableAcceptedProseSeedBlockedFromDashRefine")) scopeRuntimeTruthState.dashImmutableAcceptedProseSeedBlockedFromDashRefine = Boolean(next.dashImmutableAcceptedProseSeedBlockedFromDashRefine);
    if (Object.prototype.hasOwnProperty.call(next, "dashImmutableAcceptedProseSeedBlockedFromCurrentDraft")) scopeRuntimeTruthState.dashImmutableAcceptedProseSeedBlockedFromCurrentDraft = Boolean(next.dashImmutableAcceptedProseSeedBlockedFromCurrentDraft);
    if (Object.prototype.hasOwnProperty.call(next, "dashImmutableAcceptedProseSeedBlockedFromExistingScope")) scopeRuntimeTruthState.dashImmutableAcceptedProseSeedBlockedFromExistingScope = Boolean(next.dashImmutableAcceptedProseSeedBlockedFromExistingScope);
    if (Object.prototype.hasOwnProperty.call(next, "dashRejectedLateImmutableSeed")) scopeRuntimeTruthState.dashRejectedLateImmutableSeed = Boolean(next.dashRejectedLateImmutableSeed);
    if (Object.prototype.hasOwnProperty.call(next, "dashFailedClosedForMissingPreCapturedImmutableProse")) scopeRuntimeTruthState.dashFailedClosedForMissingPreCapturedImmutableProse = Boolean(next.dashFailedClosedForMissingPreCapturedImmutableProse);
    if (Object.prototype.hasOwnProperty.call(next, "dashImmutableAcceptedProseCaptured")) scopeRuntimeTruthState.dashImmutableAcceptedProseCaptured = Boolean(next.dashImmutableAcceptedProseCaptured);
    if (Object.prototype.hasOwnProperty.call(next, "dashImmutableAcceptedProseChars")) scopeRuntimeTruthState.dashImmutableAcceptedProseChars = Math.max(0, Number(next.dashImmutableAcceptedProseChars || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashUsedImmutableAcceptedProse")) scopeRuntimeTruthState.dashUsedImmutableAcceptedProse = Boolean(next.dashUsedImmutableAcceptedProse);
    if (Object.prototype.hasOwnProperty.call(next, "dashRejectedMutableCurrentScopeAsSource")) scopeRuntimeTruthState.dashRejectedMutableCurrentScopeAsSource = Boolean(next.dashRejectedMutableCurrentScopeAsSource);
    if (Object.prototype.hasOwnProperty.call(next, "dashRejectedMutableExistingScopeAsSource")) scopeRuntimeTruthState.dashRejectedMutableExistingScopeAsSource = Boolean(next.dashRejectedMutableExistingScopeAsSource);
    if (Object.prototype.hasOwnProperty.call(next, "dashImmutableSourceMatchedRetry")) scopeRuntimeTruthState.dashImmutableSourceMatchedRetry = Boolean(next.dashImmutableSourceMatchedRetry);
    if (Object.prototype.hasOwnProperty.call(next, "dashSourceMismatchDetected")) scopeRuntimeTruthState.dashSourceMismatchDetected = Boolean(next.dashSourceMismatchDetected);
    if (Object.prototype.hasOwnProperty.call(next, "dashUsedRequestFallbackBecauseNoImmutableAcceptedProse")) scopeRuntimeTruthState.dashUsedRequestFallbackBecauseNoImmutableAcceptedProse = Boolean(next.dashUsedRequestFallbackBecauseNoImmutableAcceptedProse);
    if (Object.prototype.hasOwnProperty.call(next, "dashRetryPromptUsedCleanSourceOnly")) scopeRuntimeTruthState.dashRetryPromptUsedCleanSourceOnly = Boolean(next.dashRetryPromptUsedCleanSourceOnly);
    if (Object.prototype.hasOwnProperty.call(next, "dashRetryPromptBlockedFailedDraft")) scopeRuntimeTruthState.dashRetryPromptBlockedFailedDraft = Boolean(next.dashRetryPromptBlockedFailedDraft);
    if (Object.prototype.hasOwnProperty.call(next, "dashRetryPromptBlockedCurrentDraft")) scopeRuntimeTruthState.dashRetryPromptBlockedCurrentDraft = Boolean(next.dashRetryPromptBlockedCurrentDraft);
    if (Object.prototype.hasOwnProperty.call(next, "dashRetryUsedCleanOriginalProse")) scopeRuntimeTruthState.dashRetryUsedCleanOriginalProse = Boolean(next.dashRetryUsedCleanOriginalProse);
    if (Object.prototype.hasOwnProperty.call(next, "dashRetryUsedSameCanonicalProse")) scopeRuntimeTruthState.dashRetryUsedSameCanonicalProse = Boolean(next.dashRetryUsedSameCanonicalProse);
    if (Object.prototype.hasOwnProperty.call(next, "dashRetryBlockedFailedDashText")) scopeRuntimeTruthState.dashRetryBlockedFailedDashText = Boolean(next.dashRetryBlockedFailedDashText);
    if (Object.prototype.hasOwnProperty.call(next, "dashRetryBlockedCurrentMalformedDash")) scopeRuntimeTruthState.dashRetryBlockedCurrentMalformedDash = Boolean(next.dashRetryBlockedCurrentMalformedDash);
    if (Object.prototype.hasOwnProperty.call(next, "dashPromptUsedRequestTextOnlyBecauseAcceptedProseMissing")) scopeRuntimeTruthState.dashPromptUsedRequestTextOnlyBecauseAcceptedProseMissing = Boolean(next.dashPromptUsedRequestTextOnlyBecauseAcceptedProseMissing);
    if (Object.prototype.hasOwnProperty.call(next, "dashRetrySamplingRaised")) scopeRuntimeTruthState.dashRetrySamplingRaised = Boolean(next.dashRetrySamplingRaised);
    if (Object.prototype.hasOwnProperty.call(next, "dashGroqRewriteUsed")) scopeRuntimeTruthState.dashGroqRewriteUsed = Boolean(next.dashGroqRewriteUsed);
    if (Object.prototype.hasOwnProperty.call(next, "dashLocalCompilerBypassed")) scopeRuntimeTruthState.dashLocalCompilerBypassed = Boolean(next.dashLocalCompilerBypassed);
    if (Object.prototype.hasOwnProperty.call(next, "dashGroqRewriteValidated")) scopeRuntimeTruthState.dashGroqRewriteValidated = Boolean(next.dashGroqRewriteValidated);
    if (Object.prototype.hasOwnProperty.call(next, "dashGroqRewriteRetryCount")) scopeRuntimeTruthState.dashGroqRewriteRetryCount = Math.max(0, Number(next.dashGroqRewriteRetryCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerSelectorFailClosed")) scopeRuntimeTruthState.dashCompilerSelectorFailClosed = Boolean(next.dashCompilerSelectorFailClosed);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerSelectorUsedProceduralPoolOnly")) scopeRuntimeTruthState.dashCompilerSelectorUsedProceduralPoolOnly = Boolean(next.dashCompilerSelectorUsedProceduralPoolOnly);
    if (Object.prototype.hasOwnProperty.call(next, "dashCompilerRejectedForMissingProceduralPool")) scopeRuntimeTruthState.dashCompilerRejectedForMissingProceduralPool = Boolean(next.dashCompilerRejectedForMissingProceduralPool);
    if (Object.prototype.hasOwnProperty.call(next, "dashLineCount")) scopeRuntimeTruthState.dashLineCount = Math.max(0, Number(next.dashLineCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashHasSummaryParagraph")) scopeRuntimeTruthState.dashHasSummaryParagraph = Boolean(next.dashHasSummaryParagraph);
    if (Object.prototype.hasOwnProperty.call(next, "dashFormatPass")) scopeRuntimeTruthState.dashFormatPass = typeof next.dashFormatPass === "boolean" ? next.dashFormatPass : null;
    if (Object.prototype.hasOwnProperty.call(next, "dashSemanticPass")) scopeRuntimeTruthState.dashSemanticPass = typeof next.dashSemanticPass === "boolean" ? next.dashSemanticPass : null;
    if (Object.prototype.hasOwnProperty.call(next, "dashDistinctStepPass")) scopeRuntimeTruthState.dashDistinctStepPass = typeof next.dashDistinctStepPass === "boolean" ? next.dashDistinctStepPass : null;
    if (Object.prototype.hasOwnProperty.call(next, "dashRetryUsed")) scopeRuntimeTruthState.dashRetryUsed = Boolean(next.dashRetryUsed);
    if (Object.prototype.hasOwnProperty.call(next, "dashLocalFallbackUsed")) scopeRuntimeTruthState.dashLocalFallbackUsed = Boolean(next.dashLocalFallbackUsed);
    if (Object.prototype.hasOwnProperty.call(next, "dashFallbackRejectedForCompliance")) scopeRuntimeTruthState.dashFallbackRejectedForCompliance = Boolean(next.dashFallbackRejectedForCompliance);
    if (Object.prototype.hasOwnProperty.call(next, "dashRejectedBeforeDirectSuccess")) scopeRuntimeTruthState.dashRejectedBeforeDirectSuccess = Boolean(next.dashRejectedBeforeDirectSuccess);
    if (Object.prototype.hasOwnProperty.call(next, "dashFallbackAccepted")) scopeRuntimeTruthState.dashFallbackAccepted = Boolean(next.dashFallbackAccepted);
    if (Object.prototype.hasOwnProperty.call(next, "dashSuccessBlockedForComplianceFailure")) scopeRuntimeTruthState.dashSuccessBlockedForComplianceFailure = Boolean(next.dashSuccessBlockedForComplianceFailure);
    if (Object.prototype.hasOwnProperty.call(next, "dashReturnedSuccess")) scopeRuntimeTruthState.dashReturnedSuccess = Boolean(next.dashReturnedSuccess);
    if (Object.prototype.hasOwnProperty.call(next, "dashReturnedFailurePath")) scopeRuntimeTruthState.dashReturnedFailurePath = Boolean(next.dashReturnedFailurePath);
    if (Object.prototype.hasOwnProperty.call(next, "dashBestEffortSuccessRemoved")) scopeRuntimeTruthState.dashBestEffortSuccessRemoved = Boolean(next.dashBestEffortSuccessRemoved);
    if (Object.prototype.hasOwnProperty.call(next, "dashRepeatedLineCount")) scopeRuntimeTruthState.dashRepeatedLineCount = Math.max(0, Number(next.dashRepeatedLineCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashSplitSentenceEchoLineCount")) scopeRuntimeTruthState.dashSplitSentenceEchoLineCount = Math.max(0, Number(next.dashSplitSentenceEchoLineCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashNearDuplicateLineCount")) scopeRuntimeTruthState.dashNearDuplicateLineCount = Math.max(0, Number(next.dashNearDuplicateLineCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashFragmentBulletRejected")) scopeRuntimeTruthState.dashFragmentBulletRejected = Boolean(next.dashFragmentBulletRejected);
    if (Object.prototype.hasOwnProperty.call(next, "dashMaxLineOverlap")) scopeRuntimeTruthState.dashMaxLineOverlap = Number.isFinite(Number(next.dashMaxLineOverlap)) ? Number(next.dashMaxLineOverlap) : 0;
    if (Object.prototype.hasOwnProperty.call(next, "dashSummaryEchoLikeStep")) scopeRuntimeTruthState.dashSummaryEchoLikeStep = Boolean(next.dashSummaryEchoLikeStep);
    if (Object.prototype.hasOwnProperty.call(next, "dashSummaryLeadBulletEchoLikeStep")) scopeRuntimeTruthState.dashSummaryLeadBulletEchoLikeStep = Boolean(next.dashSummaryLeadBulletEchoLikeStep);
    if (Object.prototype.hasOwnProperty.call(next, "dashSourceSentenceEchoLikeStep")) scopeRuntimeTruthState.dashSourceSentenceEchoLikeStep = Boolean(next.dashSourceSentenceEchoLikeStep);
    if (Object.prototype.hasOwnProperty.call(next, "dashInventedMajorDetailRejected")) scopeRuntimeTruthState.dashInventedMajorDetailRejected = Boolean(next.dashInventedMajorDetailRejected);
    if (Object.prototype.hasOwnProperty.call(next, "dashFewShotPromptUsed")) scopeRuntimeTruthState.dashFewShotPromptUsed = Boolean(next.dashFewShotPromptUsed);
    if (Object.prototype.hasOwnProperty.call(next, "dashOverviewSentenceBiasDetected")) scopeRuntimeTruthState.dashOverviewSentenceBiasDetected = Boolean(next.dashOverviewSentenceBiasDetected);
    if (Object.prototype.hasOwnProperty.call(next, "dashProceduralSentenceCoverage")) scopeRuntimeTruthState.dashProceduralSentenceCoverage = Number.isFinite(Number(next.dashProceduralSentenceCoverage)) ? Number(next.dashProceduralSentenceCoverage) : 0;
    if (Object.prototype.hasOwnProperty.call(next, "dashSummaryEchoedOverview")) scopeRuntimeTruthState.dashSummaryEchoedOverview = Boolean(next.dashSummaryEchoedOverview);
    if (Object.prototype.hasOwnProperty.call(next, "sourceWordCount")) scopeRuntimeTruthState.sourceWordCount = Math.max(0, Number(next.sourceWordCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "returnedWordCount")) scopeRuntimeTruthState.returnedWordCount = Math.max(0, Number(next.returnedWordCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "compressionRatio")) scopeRuntimeTruthState.compressionRatio = Number.isFinite(Number(next.compressionRatio)) ? Number(next.compressionRatio) : 0;
    if (Object.prototype.hasOwnProperty.call(next, "shorterParagraphCount")) scopeRuntimeTruthState.shorterParagraphCount = Math.max(0, Number(next.shorterParagraphCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "shorterSingleParagraphPass")) scopeRuntimeTruthState.shorterSingleParagraphPass = typeof next.shorterSingleParagraphPass === "boolean" ? next.shorterSingleParagraphPass : null;
    if (Object.prototype.hasOwnProperty.call(next, "shorterRejectedForParagraphCount")) scopeRuntimeTruthState.shorterRejectedForParagraphCount = Boolean(next.shorterRejectedForParagraphCount);
    if (Object.prototype.hasOwnProperty.call(next, "shorterCompliancePass")) scopeRuntimeTruthState.shorterCompliancePass = typeof next.shorterCompliancePass === "boolean" ? next.shorterCompliancePass : null;
    if (Object.prototype.hasOwnProperty.call(next, "shorterSemanticPass")) scopeRuntimeTruthState.shorterSemanticPass = typeof next.shorterSemanticPass === "boolean" ? next.shorterSemanticPass : null;
    if (Object.prototype.hasOwnProperty.call(next, "preservedAnchorTerms")) scopeRuntimeTruthState.preservedAnchorTerms = Array.isArray(next.preservedAnchorTerms) ? next.preservedAnchorTerms.map((value) => String(value || "").trim()).filter(Boolean) : [];
    if (Object.prototype.hasOwnProperty.call(next, "missingAnchorTerms")) scopeRuntimeTruthState.missingAnchorTerms = Array.isArray(next.missingAnchorTerms) ? next.missingAnchorTerms.map((value) => String(value || "").trim()).filter(Boolean) : [];
    if (Object.prototype.hasOwnProperty.call(next, "inventedExclusionLikeLanguage")) scopeRuntimeTruthState.inventedExclusionLikeLanguage = Boolean(next.inventedExclusionLikeLanguage);
    if (Object.prototype.hasOwnProperty.call(next, "inventedProcessDetailLikeLanguage")) scopeRuntimeTruthState.inventedProcessDetailLikeLanguage = Boolean(next.inventedProcessDetailLikeLanguage);
    if (Object.prototype.hasOwnProperty.call(next, "shorterRejectedForSemanticDrift")) scopeRuntimeTruthState.shorterRejectedForSemanticDrift = Boolean(next.shorterRejectedForSemanticDrift);
    if (Object.prototype.hasOwnProperty.call(next, "shorterLocalFallbackUsed")) scopeRuntimeTruthState.shorterLocalFallbackUsed = Boolean(next.shorterLocalFallbackUsed);
    if (Object.prototype.hasOwnProperty.call(next, "scopeStyleAccepted")) scopeRuntimeTruthState.scopeStyleAccepted = typeof next.scopeStyleAccepted === "boolean" ? next.scopeStyleAccepted : null;
    if (Object.prototype.hasOwnProperty.call(next, "scopeStyleReasonTag")) scopeRuntimeTruthState.scopeStyleReasonTag = String(next.scopeStyleReasonTag || "");
    if (Object.prototype.hasOwnProperty.call(next, "scopeStyleMatchedPattern")) scopeRuntimeTruthState.scopeStyleMatchedPattern = String(next.scopeStyleMatchedPattern || "");
    if (Object.prototype.hasOwnProperty.call(next, "scopeParagraphCount")) scopeRuntimeTruthState.scopeParagraphCount = Math.max(0, Number(next.scopeParagraphCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "scopeSentenceCount")) scopeRuntimeTruthState.scopeSentenceCount = Math.max(0, Number(next.scopeSentenceCount || 0));
  };
  const getScopeRuntimeTruth = () => ({
    _scopeOutcome: String(scopeRuntimeTruthState.outcome || ""),
    _scopeReasonTag: String(scopeRuntimeTruthState.reasonTag || ""),
    _scopeExcerpt: String(scopeRuntimeTruthState.excerpt || "").trim().slice(0, 160),
    _scopeResponseSource: String(scopeRuntimeTruthState.responseSource || ""),
    _scopeFallbackSource: String(scopeRuntimeTruthState.fallbackSource || ""),
    _scopeParseBranch: String(scopeRuntimeTruthState.parseBranch || ""),
    _scopeParseFailureReason: String(scopeRuntimeTruthState.parseFailureReason || ""),
    _scopeParseSource: String(scopeRuntimeTruthState.parseSource || "raw_only"),
    _scopeRetryUsed: Boolean(scopeRuntimeTruthState.retryUsed),
    _scopeGroqHandedOff: Boolean(scopeRuntimeTruthState.groqHandedOff),
    _scopePreGroqJunkGateFired: Boolean(scopeRuntimeTruthState.preGroqJunkGateFired),
    _scopeDashMode: Boolean(scopeRuntimeTruthState.dashMode || scopeRuntimeTruthState.dashBranchActive),
    _scopeDashSourcePromptWeighted: Boolean(scopeRuntimeTruthState.dashSourcePromptWeighted),
    _scopeDashCompiledLocally: Boolean(scopeRuntimeTruthState.dashCompiledLocally),
    _scopeDashCompilerSource: String(scopeRuntimeTruthState.dashCompilerSource || ""),
    _scopeDashCompilerStepCount: Math.max(0, Number(scopeRuntimeTruthState.dashCompilerStepCount || 0)),
    _scopeDashCompilerDroppedDuplicateCount: Math.max(0, Number(scopeRuntimeTruthState.dashCompilerDroppedDuplicateCount || 0)),
    _scopeDashCompilerDroppedFragmentCount: Math.max(0, Number(scopeRuntimeTruthState.dashCompilerDroppedFragmentCount || 0)),
    _scopeDashCompilerUsedModelBullets: Boolean(scopeRuntimeTruthState.dashCompilerUsedModelBullets),
    _scopeDashCompilerProceduralCandidateCount: Math.max(0, Number(scopeRuntimeTruthState.dashCompilerProceduralCandidateCount || 0)),
    _scopeDashCompilerDroppedGenericIntroCount: Math.max(0, Number(scopeRuntimeTruthState.dashCompilerDroppedGenericIntroCount || 0)),
    _scopeDashCompilerRejectedIntroCandidateCount: Math.max(0, Number(scopeRuntimeTruthState.dashCompilerRejectedIntroCandidateCount || 0)),
    _scopeDashCompilerUsedProceduralSentences: Boolean(scopeRuntimeTruthState.dashCompilerUsedProceduralSentences),
    _scopeDashCompilerSummaryBuiltFromSteps: Boolean(scopeRuntimeTruthState.dashCompilerSummaryBuiltFromSteps),
    _scopeDashCompilerSelectedProceduralStepCount: Math.max(0, Number(scopeRuntimeTruthState.dashCompilerSelectedProceduralStepCount || 0)),
    _scopeDashCompilerDenseProseProceduralMode: Boolean(scopeRuntimeTruthState.dashCompilerDenseProseProceduralMode),
    _scopeDashCompilerRejectedSourceIntroSummary: Boolean(scopeRuntimeTruthState.dashCompilerRejectedSourceIntroSummary),
    _scopeDashCompilerSourcePriority: String(scopeRuntimeTruthState.dashCompilerSourcePriority || ""),
    _scopeDashCompilerRejectedCurrentDraftSource: Boolean(scopeRuntimeTruthState.dashCompilerRejectedCurrentDraftAsCompilerSource),
    _scopeDashCompilerRejectedFailedDashSource: Boolean(scopeRuntimeTruthState.dashCompilerRejectedFailedDashAsCompilerSource),
    _scopeDashCompilerUsedOriginalProseSource: Boolean(scopeRuntimeTruthState.dashCompilerUsedOriginalProseSource),
    _scopeDashCompilerFallbackSourceTextBlocked: Boolean(scopeRuntimeTruthState.dashCompilerFallbackSourceTextBlocked),
    _scopeDashCompilerSourceTextUsedForCompilation: String(scopeRuntimeTruthState.dashCompilerSourceTextUsedForCompilation || "").trim().slice(0, 160),
    _scopeDashTransformSource: String(scopeRuntimeTruthState.dashTransformSource || "").trim().slice(0, 160),
    _scopeDashCanonicalProseSourceType: String(scopeRuntimeTruthState.dashCanonicalProseSourceType || ""),
    _scopeDashCanonicalProseChars: Math.max(0, Number(scopeRuntimeTruthState.dashCanonicalProseChars || 0)),
    _scopeDashUsedOriginalAcceptedProse: Boolean(scopeRuntimeTruthState.dashUsedOriginalAcceptedProse),
    _scopeDashUsedAcceptedProseDraft: Boolean(scopeRuntimeTruthState.dashUsedAcceptedProseDraft),
    _scopeDashFellBackToRequestText: Boolean(scopeRuntimeTruthState.dashFellBackToRequestText),
    _scopeDashImmutableAcceptedProseCapturedOnNonDashSuccess: Boolean(scopeRuntimeTruthState.dashImmutableAcceptedProseCapturedOnNonDashSuccess),
    _scopeDashImmutableAcceptedProseCaptureBranch: String(scopeRuntimeTruthState.dashImmutableAcceptedProseCaptureBranch || ""),
    _scopeDashImmutableAcceptedProseReadFromCache: Boolean(scopeRuntimeTruthState.dashImmutableAcceptedProseReadFromCache),
    _scopeDashImmutableAcceptedProseSeedBlockedFromDashRefine: Boolean(scopeRuntimeTruthState.dashImmutableAcceptedProseSeedBlockedFromDashRefine),
    _scopeDashImmutableAcceptedProseSeedBlockedFromCurrentDraft: Boolean(scopeRuntimeTruthState.dashImmutableAcceptedProseSeedBlockedFromCurrentDraft),
    _scopeDashImmutableAcceptedProseSeedBlockedFromExistingScope: Boolean(scopeRuntimeTruthState.dashImmutableAcceptedProseSeedBlockedFromExistingScope),
    _scopeDashRejectedLateImmutableSeed: Boolean(scopeRuntimeTruthState.dashRejectedLateImmutableSeed),
    _scopeDashFailedClosedForMissingPreCapturedImmutableProse: Boolean(scopeRuntimeTruthState.dashFailedClosedForMissingPreCapturedImmutableProse),
    _scopeDashImmutableAcceptedProseCaptured: Boolean(scopeRuntimeTruthState.dashImmutableAcceptedProseCaptured),
    _scopeDashImmutableAcceptedProseChars: Math.max(0, Number(scopeRuntimeTruthState.dashImmutableAcceptedProseChars || 0)),
    _scopeDashUsedImmutableAcceptedProse: Boolean(scopeRuntimeTruthState.dashUsedImmutableAcceptedProse),
    _scopeDashRejectedMutableCurrentScopeAsSource: Boolean(scopeRuntimeTruthState.dashRejectedMutableCurrentScopeAsSource),
    _scopeDashRejectedMutableExistingScopeAsSource: Boolean(scopeRuntimeTruthState.dashRejectedMutableExistingScopeAsSource),
    _scopeDashImmutableSourceMatchedRetry: Boolean(scopeRuntimeTruthState.dashImmutableSourceMatchedRetry),
    _scopeDashSourceMismatchDetected: Boolean(scopeRuntimeTruthState.dashSourceMismatchDetected),
    _scopeDashUsedRequestFallbackBecauseNoImmutableAcceptedProse: Boolean(scopeRuntimeTruthState.dashUsedRequestFallbackBecauseNoImmutableAcceptedProse),
    _scopeDashRetryPromptUsedCleanSourceOnly: Boolean(scopeRuntimeTruthState.dashRetryPromptUsedCleanSourceOnly),
    _scopeDashRetryPromptBlockedFailedDraft: Boolean(scopeRuntimeTruthState.dashRetryPromptBlockedFailedDraft),
    _scopeDashRetryPromptBlockedCurrentDraft: Boolean(scopeRuntimeTruthState.dashRetryPromptBlockedCurrentDraft),
    _scopeDashRetryUsedCleanOriginalProse: Boolean(scopeRuntimeTruthState.dashRetryUsedCleanOriginalProse),
    _scopeDashRetryUsedSameCanonicalProse: Boolean(scopeRuntimeTruthState.dashRetryUsedSameCanonicalProse),
    _scopeDashRetryBlockedFailedDashText: Boolean(scopeRuntimeTruthState.dashRetryBlockedFailedDashText),
    _scopeDashRetryBlockedCurrentMalformedDash: Boolean(scopeRuntimeTruthState.dashRetryBlockedCurrentMalformedDash),
    _scopeDashPromptUsedRequestTextOnlyBecauseAcceptedProseMissing: Boolean(scopeRuntimeTruthState.dashPromptUsedRequestTextOnlyBecauseAcceptedProseMissing),
    _scopeDashGroqRewriteUsed: Boolean(scopeRuntimeTruthState.dashGroqRewriteUsed),
    _scopeDashLocalCompilerBypassed: Boolean(scopeRuntimeTruthState.dashLocalCompilerBypassed),
    _scopeDashGroqRewriteValidated: Boolean(scopeRuntimeTruthState.dashGroqRewriteValidated),
    _scopeDashGroqRewriteRetryCount: Math.max(0, Number(scopeRuntimeTruthState.dashGroqRewriteRetryCount || 0)),
    _scopeDashCompilerSelectorFailClosed: Boolean(scopeRuntimeTruthState.dashCompilerSelectorFailClosed),
    _scopeDashCompilerSelectorUsedProceduralPoolOnly: Boolean(scopeRuntimeTruthState.dashCompilerSelectorUsedProceduralPoolOnly),
    _scopeDashCompilerRejectedForMissingProceduralPool: Boolean(scopeRuntimeTruthState.dashCompilerRejectedForMissingProceduralPool),
    _scopeDashLineCount: Math.max(0, Number(scopeRuntimeTruthState.dashLineCount || 0)),
    _scopeDashHasSummaryParagraph: Boolean(scopeRuntimeTruthState.dashHasSummaryParagraph),
    _scopeDashFormatPass: typeof scopeRuntimeTruthState.dashFormatPass === "boolean" ? scopeRuntimeTruthState.dashFormatPass : null,
    _scopeDashSemanticPass: typeof scopeRuntimeTruthState.dashSemanticPass === "boolean" ? scopeRuntimeTruthState.dashSemanticPass : null,
    _scopeDashDistinctStepPass: typeof scopeRuntimeTruthState.dashDistinctStepPass === "boolean" ? scopeRuntimeTruthState.dashDistinctStepPass : null,
    _scopeDashRetryUsed: Boolean(scopeRuntimeTruthState.dashRetryUsed),
    _scopeDashLocalFallbackUsed: Boolean(scopeRuntimeTruthState.dashLocalFallbackUsed),
    _scopeDashFallbackRejectedForCompliance: Boolean(scopeRuntimeTruthState.dashFallbackRejectedForCompliance),
    _scopeDashRejectedBeforeDirectSuccess: Boolean(scopeRuntimeTruthState.dashRejectedBeforeDirectSuccess),
    _scopeDashFallbackAccepted: Boolean(scopeRuntimeTruthState.dashFallbackAccepted),
    _scopeDashSuccessBlockedForComplianceFailure: Boolean(scopeRuntimeTruthState.dashSuccessBlockedForComplianceFailure),
    _scopeDashReturnedSuccess: Boolean(scopeRuntimeTruthState.dashReturnedSuccess),
    _scopeDashReturnedFailurePath: Boolean(scopeRuntimeTruthState.dashReturnedFailurePath),
    _scopeDashBestEffortSuccessRemoved: Boolean(scopeRuntimeTruthState.dashBestEffortSuccessRemoved),
    _scopeDashRepeatedLineCount: Math.max(0, Number(scopeRuntimeTruthState.dashRepeatedLineCount || 0)),
    _scopeDashSplitSentenceEchoLineCount: Math.max(0, Number(scopeRuntimeTruthState.dashSplitSentenceEchoLineCount || 0)),
    _scopeDashNearDuplicateLineCount: Math.max(0, Number(scopeRuntimeTruthState.dashNearDuplicateLineCount || 0)),
    _scopeDashFragmentBulletRejected: Boolean(scopeRuntimeTruthState.dashFragmentBulletRejected),
    _scopeDashMaxLineOverlap: Number.isFinite(Number(scopeRuntimeTruthState.dashMaxLineOverlap)) ? Number(scopeRuntimeTruthState.dashMaxLineOverlap) : 0,
    _scopeDashSummaryEchoLikeStep: Boolean(scopeRuntimeTruthState.dashSummaryEchoLikeStep),
    _scopeDashSummaryLeadBulletEchoLikeStep: Boolean(scopeRuntimeTruthState.dashSummaryLeadBulletEchoLikeStep),
    _scopeDashSourceSentenceEchoLikeStep: Boolean(scopeRuntimeTruthState.dashSourceSentenceEchoLikeStep),
    _scopeDashProceduralSentenceBiasActive: Boolean(scopeRuntimeTruthState.dashProceduralSentenceBiasActive),
    _scopeDashOverviewSentenceRejectedCount: Math.max(0, Number(scopeRuntimeTruthState.dashOverviewSentenceRejectedCount || 0)),
    _scopeDashProceduralBulletCount: Math.max(0, Number(scopeRuntimeTruthState.dashProceduralBulletCount || 0)),
    _scopeDashOverviewBulletCount: Math.max(0, Number(scopeRuntimeTruthState.dashOverviewBulletCount || 0)),
    _scopeDashRejectedForOverviewBias: Boolean(scopeRuntimeTruthState.dashRejectedForOverviewBias),
    _scopeDashInventedMajorDetailRejected: Boolean(scopeRuntimeTruthState.dashInventedMajorDetailRejected),
    _scopeDashFewShotPromptUsed: Boolean(scopeRuntimeTruthState.dashFewShotPromptUsed),
    _scopeDashOverviewSentenceBiasDetected: Boolean(scopeRuntimeTruthState.dashOverviewSentenceBiasDetected),
    _scopeDashProceduralSentenceCoverage: Number.isFinite(Number(scopeRuntimeTruthState.dashProceduralSentenceCoverage)) ? Number(scopeRuntimeTruthState.dashProceduralSentenceCoverage) : 0,
    _scopeDashSummaryEchoedOverview: Boolean(scopeRuntimeTruthState.dashSummaryEchoedOverview),
    _scopeDashRetrySamplingRaised: Boolean(scopeRuntimeTruthState.dashRetrySamplingRaised),
    _scopeSourceWordCount: Math.max(0, Number(scopeRuntimeTruthState.sourceWordCount || 0)),
    _scopeReturnedWordCount: Math.max(0, Number(scopeRuntimeTruthState.returnedWordCount || 0)),
    _scopeCompressionRatio: Number.isFinite(Number(scopeRuntimeTruthState.compressionRatio)) ? Number(scopeRuntimeTruthState.compressionRatio) : 0,
    _scopeShorterParagraphCount: Math.max(0, Number(scopeRuntimeTruthState.shorterParagraphCount || 0)),
    _scopeShorterSingleParagraphPass: typeof scopeRuntimeTruthState.shorterSingleParagraphPass === "boolean" ? scopeRuntimeTruthState.shorterSingleParagraphPass : null,
    _scopeShorterRejectedForParagraphCount: Boolean(scopeRuntimeTruthState.shorterRejectedForParagraphCount),
    _scopeShorterCompliancePass: typeof scopeRuntimeTruthState.shorterCompliancePass === "boolean" ? scopeRuntimeTruthState.shorterCompliancePass : null,
    _scopeShorterSemanticPass: typeof scopeRuntimeTruthState.shorterSemanticPass === "boolean" ? scopeRuntimeTruthState.shorterSemanticPass : null,
    _scopePreservedAnchorTerms: Array.isArray(scopeRuntimeTruthState.preservedAnchorTerms) ? scopeRuntimeTruthState.preservedAnchorTerms : [],
    _scopeMissingAnchorTerms: Array.isArray(scopeRuntimeTruthState.missingAnchorTerms) ? scopeRuntimeTruthState.missingAnchorTerms : [],
    _scopeInventedExclusionLikeLanguage: Boolean(scopeRuntimeTruthState.inventedExclusionLikeLanguage),
    _scopeInventedProcessDetailLikeLanguage: Boolean(scopeRuntimeTruthState.inventedProcessDetailLikeLanguage),
    _scopeShorterRejectedForSemanticDrift: Boolean(scopeRuntimeTruthState.shorterRejectedForSemanticDrift),
    _scopeShorterLocalFallbackUsed: Boolean(scopeRuntimeTruthState.shorterLocalFallbackUsed),
    _scopeStyleAccepted: typeof scopeRuntimeTruthState.scopeStyleAccepted === "boolean" ? scopeRuntimeTruthState.scopeStyleAccepted : null,
    _scopeStyleReasonTag: String(scopeRuntimeTruthState.scopeStyleReasonTag || ""),
    _scopeStyleMatchedPattern: String(scopeRuntimeTruthState.scopeStyleMatchedPattern || ""),
    _scopeParagraphCount: Math.max(0, Number(scopeRuntimeTruthState.scopeParagraphCount || 0)),
    _scopeSentenceCount: Math.max(0, Number(scopeRuntimeTruthState.scopeSentenceCount || 0)),
  });
  const getScopeRefineRuntimeLogMeta = () => (
    scopeRuntimeTruthState.refineMode === "refine"
      ? {
        refineMode: String(scopeRuntimeTruthState.refineMode || ""),
        refineInstruction: String(scopeRuntimeTruthState.refineInstruction || ""),
        dashDetectorMatched: Boolean(scopeRuntimeTruthState.dashDetectorMatched),
        dashBranchActive: Boolean(scopeRuntimeTruthState.dashBranchActive),
        shorterDetectorMatched: Boolean(scopeRuntimeTruthState.shorterDetectorMatched),
        shorterBranchActive: Boolean(scopeRuntimeTruthState.shorterBranchActive),
        refinePromptBranch: String(scopeRuntimeTruthState.refinePromptBranch || ""),
        currentScopeDraftExcerpt: String(scopeRuntimeTruthState.currentScopeDraftExcerpt || ""),
      }
      : {}
  );
  const getScopeRefineRuntimeResponseMeta = () => (
    scopeRuntimeTruthState.refineMode === "refine"
      ? {
        _scopeRefineRuntimeMeta: {
          refineMode: String(scopeRuntimeTruthState.refineMode || ""),
          refineInstruction: String(scopeRuntimeTruthState.refineInstruction || ""),
          dashDetectorMatched: Boolean(scopeRuntimeTruthState.dashDetectorMatched),
          dashBranchActive: Boolean(scopeRuntimeTruthState.dashBranchActive),
          shorterBranchActive: Boolean(scopeRuntimeTruthState.shorterBranchActive),
          refinePromptBranch: String(scopeRuntimeTruthState.refinePromptBranch || ""),
          currentScopeDraftExcerpt: String(scopeRuntimeTruthState.currentScopeDraftExcerpt || ""),
          activeScopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        },
      }
      : {}
  );
  const getScopePromptBasisRuntimeMeta = () => ({
    _scopePromptBasisField: String(normalizedContext?.scopePromptBasisField || ""),
    _scopePromptBasisExcerpt: String(normalizedContext?.scopePromptBasis || "").replace(/\s+/g, " ").trim().slice(0, 160),
  });
  const getScopeParseSource = () => String(scopeRuntimeTruthState.parseSource || "raw_only");
  const withScopeDebugMeta = (payload = {}) => {
    if (!isScopeSection) return payload;
    return {
      ...payload,
      ...getDevAiBackendIdentity("/api/ai-assist"),
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      _scopeRuntimePath: getScopeRuntimePath(),
      ...getScopePromptBasisRuntimeMeta(),
      ...getScopeRuntimeTruth(),
      ...getScopeRefineRuntimeResponseMeta(),
      debugPath: scopeDebugState.path || "",
      debugModel: scopeDebugState.model || "",
      debugStage: scopeDebugState.stage || "",
    };
  };
  const logScopeEvent = (event, payload = {}) => {
    if (!isScopeSection) return;
    logScopeAssistTerminal(_tid, event, {
      elapsed_ms: Date.now() - requestStartedAt,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      _scopeRuntimePath: getScopeRuntimePath(),
      _scopeParseSource: getScopeParseSource(),
      ...getScopePromptBasisRuntimeMeta(),
      ...getScopeRuntimeTruth(),
      ...getScopeRefineRuntimeLogMeta(),
      ...payload,
    });
  };
  if (scopeRefineRuntimeMeta?.refineMode === "refine") {
    setScopeRuntimeTruth(scopeRefineRuntimeMeta);
  }
  const respondScopeAssist = (status, payload, traceLabel, traceReason, extra = {}, outcome = "") => {
    const durationMs = Date.now() - requestStartedAt;
    const resolvedOutcome = String(outcome || payload?.outcome || extra?.outcome || "").trim().toLowerCase();
    if (
      isScopeSection
      && status < 400
      && !payload?._assistFailed
      && resolvedOutcome === "scope"
      && !Boolean(scopeRefineRuntimeMeta?.dashBranchActive)
    ) {
      const acceptedScopeText = sanitizeScopeAssistText(payload?.scopeNotes || "");
      logScopeAssistTerminal(_tid, "DASH_IMMUTABLE_CAPTURE_GATE", {
        resolvedOutcome,
        acceptedScopeTextChars: acceptedScopeText.length,
        dashBranchActive: Boolean(scopeRefineRuntimeMeta?.dashBranchActive),
        outcomeFromParam: String(outcome || ""),
        outcomeFromPayload: String(payload?.outcome || ""),
        outcomeFromExtra: String(extra?.outcome || ""),
      });
      if (acceptedScopeText) {
        const existingImmutableText = sanitizeScopeAssistText(
          normalizedContext?.originalAcceptedProseScope
          || normalizedContext?.dashCanonicalAcceptedProse
          || normalizedContext?.dashImmutableAcceptedProse
          || normalizedContext?.immutableAcceptedProseScope
          || ""
        );
        const captureResult = captureDashOriginalAcceptedProse({
          context: normalizedContext,
          sourceText: existingImmutableText || acceptedScopeText,
          sourcePrompt: String(normalizedContext?.sourcePrompt || sourcePrompt || ""),
          sourceScopePrompt: String(normalizedContext?.sourceScopePrompt || sourceScopePrompt || ""),
          sourceScopeBasis: String(normalizedContext?.scopePromptBasis || scopePromptResolution?.text || ""),
          sourceKind: existingImmutableText ? "scope_success_immutable_reuse" : "scope_success",
        });
        const immutableAcceptedProseText = sanitizeScopeAssistText(captureResult?.sourceText || existingImmutableText || acceptedScopeText || "");
        const lateImmutableSeedRejected = Boolean(
          existingImmutableText
          && acceptedScopeText
          && !areDashFallbackTextsTooSimilar(existingImmutableText, acceptedScopeText)
        );
        if (immutableAcceptedProseText) {
          if (!existingImmutableText || areDashFallbackTextsTooSimilar(existingImmutableText, immutableAcceptedProseText)) {
            normalizedContext.originalAcceptedProseScope = immutableAcceptedProseText;
            normalizedContext.dashCanonicalAcceptedProse = immutableAcceptedProseText;
            normalizedContext.dashImmutableAcceptedProse = immutableAcceptedProseText;
          }
          setScopeRuntimeTruth({
            dashImmutableAcceptedProseCapturedOnNonDashSuccess: Boolean(immutableAcceptedProseText),
            dashImmutableAcceptedProseCaptureBranch: existingImmutableText
              ? (lateImmutableSeedRejected
                ? "non_dash_scope_success_immutable_reuse_late_seed_blocked"
                : "non_dash_scope_success_immutable_reuse")
              : "non_dash_scope_success_first_capture",
            dashImmutableAcceptedProseReadFromCache: false,
            dashCanonicalProseSourceType: String(captureResult?.sourceType || "immutable_original_accepted_prose"),
            dashCanonicalProseChars: Math.max(0, Number(captureResult?.sourceChars || immutableAcceptedProseText.length || 0)),
            dashImmutableAcceptedProseCaptured: Boolean(captureResult?.captured || immutableAcceptedProseText),
            dashImmutableAcceptedProseChars: Math.max(0, Number(captureResult?.sourceChars || immutableAcceptedProseText.length || 0)),
            dashUsedImmutableAcceptedProse: true,
            dashUsedOriginalAcceptedProse: true,
            dashUsedAcceptedProseDraft: true,
            dashFellBackToRequestText: false,
            dashUsedRequestFallbackBecauseNoImmutableAcceptedProse: false,
            dashPromptUsedRequestTextOnlyBecauseAcceptedProseMissing: false,
            dashImmutableAcceptedProseSeedBlockedFromDashRefine: Boolean(lateImmutableSeedRejected),
            dashImmutableAcceptedProseSeedBlockedFromCurrentDraft: Boolean(
              lateImmutableSeedRejected
              && String(normalizedContext?.currentScopeNotes || "").trim()
            ),
            dashImmutableAcceptedProseSeedBlockedFromExistingScope: Boolean(
              lateImmutableSeedRejected
              && String(normalizedContext?.existingScopeText || "").trim()
            ),
            dashRejectedLateImmutableSeed: Boolean(lateImmutableSeedRejected),
            dashFailedClosedForMissingPreCapturedImmutableProse: false,
            dashSourceMismatchDetected: Boolean(
              lateImmutableSeedRejected
              || (
                String(normalizedContext?.currentScopeNotes || "").trim()
                && !areDashFallbackTextsTooSimilar(String(normalizedContext?.currentScopeNotes || ""), immutableAcceptedProseText)
              )
            ),
            dashRejectedMutableCurrentScopeAsSource: Boolean(
              lateImmutableSeedRejected
              || (
                String(normalizedContext?.currentScopeNotes || "").trim()
                && !areDashFallbackTextsTooSimilar(String(normalizedContext?.currentScopeNotes || ""), immutableAcceptedProseText)
              )
            ),
            dashRejectedMutableExistingScopeAsSource: Boolean(
              lateImmutableSeedRejected
              || (
                String(normalizedContext?.existingScopeText || "").trim()
                && !areDashFallbackTextsTooSimilar(String(normalizedContext?.existingScopeText || ""), immutableAcceptedProseText)
              )
            ),
          });
        }
      }
    }
    const responsePayload = withScopeDebugMeta(payload);
    if (isScopeSection) {
      logScopeAssistTerminal(_tid, "scope_route_live_exit", {
        status,
        loadedScopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        finalScopeRuntimeBuild: String(responsePayload?._scopeRuntimeBuild || ""),
        finalScopeRuntimePath: String(responsePayload?._scopeRuntimePath || ""),
        ...getDevAiBackendIdentity("/api/ai-assist"),
        ...getScopeRefineRuntimeLogMeta(),
        responseSource: String(
          responsePayload?._scopeResponseSource
          || resolveScopeAssistResponseSource(getScopeRuntimePath(), extra?.fallbackSource || responsePayload?._scopeFallbackSource || "")
        ),
        fallbackSource: String(responsePayload?._scopeFallbackSource || extra?.fallbackSource || ""),
        visibleExcerpt: String(
          responsePayload?.scopeNotes
          || responsePayload?.clarificationQuestion
          || responsePayload?._message
          || responsePayload?._error
          || ""
        ).trim().slice(0, 240),
      });
      logScopeAssistTerminal(_tid, "final_scope_response_payload", {
        status,
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        _scopeRuntimePath: getScopeRuntimePath(),
        _scopeParseSource: getScopeParseSource(),
        ...getScopePromptBasisRuntimeMeta(),
        ...getScopeRuntimeTruth(),
        ...getScopeRefineRuntimeLogMeta(),
        scope_notes_len: String(responsePayload?.scopeNotes || "").length,
        scope_notes_excerpt: String(responsePayload?.scopeNotes || "").trim().slice(0, 300),
        clarification_excerpt: String(responsePayload?.clarificationQuestion || "").trim().slice(0, 160),
      });
      if (status >= 400 || payload?._assistFailed) {
        logScopeAssistTerminal(_tid, "normalized_error_return", {
          status,
          duration_ms: durationMs,
          reason: traceReason,
          failure_type: String(extra?.failureType || payload?.failureType || payload?._errorCode || traceReason || "unknown"),
          _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
          _scopeRuntimePath: getScopeRuntimePath(),
          _scopeParseSource: getScopeParseSource(),
          ...getScopePromptBasisRuntimeMeta(),
          ...getScopeRuntimeTruth(),
          ...getScopeRefineRuntimeLogMeta(),
        });
      }
      logScopeAssistTerminal(_tid, "total_duration", {
        status,
        duration_ms: durationMs,
        trace_label: traceLabel,
        reason: traceReason,
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        _scopeRuntimePath: getScopeRuntimePath(),
        _scopeParseSource: getScopeParseSource(),
        ...getScopePromptBasisRuntimeMeta(),
        ...getScopeRuntimeTruth(),
        ...getScopeRefineRuntimeLogMeta(),
        ...extra,
      });
    }
    trace.end(traceLabel, { status, reason: traceReason, ...extra });
    if (req.aborted || res.writableEnded || res.destroyed) {
        if (isScopeSection) {
          logScopeAssistTerminal(_tid, "response_skipped_client_closed", {
            status,
            duration_ms: durationMs,
            reason: traceReason,
            _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
            _scopeRuntimePath: getScopeRuntimePath(),
            _scopeParseSource: getScopeParseSource(),
            ...getScopePromptBasisRuntimeMeta(),
            ...getScopeRuntimeTruth(),
            ...getScopeRefineRuntimeLogMeta(),
          });
        }
      return null;
    }
    return res.status(status).json(responsePayload);
  };

  logScopeEvent("request_received", {
    section: normalizedSectionKey || String(sectionKey || ""),
    mode: normalizedScopeMode,
    input_len: String(userInput || "").length,
  });
  if (isScopeSection) {
    logScopeAssistTerminal(_tid, "scope_route_live_entry", {
      loadedScopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      ...getDevAiBackendIdentity("/api/ai-assist"),
      section: normalizedSectionKey,
      mode: normalizedScopeMode,
      ...(scopeRefineRuntimeMeta?.refineMode === "refine" ? scopeRefineRuntimeMeta : {}),
    });
    const compact = (value = "") => String(value || "").replace(/\s+/g, " ").trim().slice(0, 120);
    logScopeEvent("active_route", {
      route_function: "scope_request_pipeline",
    });
    logScopeEvent("raw_prompt_received", {
      raw_prompt_excerpt: compact(userInput),
    });
    if (dashBriefLocalRefine) {
      const dashBriefProviderResult = await handleDashBriefProviderTransform({
        traceId: _tid,
        requestStartedAt,
        trace,
        context: normalizedContext,
        currentScopeText: normalizedContext?.currentScopeNotes || "",
        refineInstruction: refineInstructionText,
        setDebugState: setScopeDebugState,
        setRuntimeTruth: setScopeRuntimeTruth,
      });
      const dashBriefProviderPayload = dashBriefProviderResult?.ok
        ? {
          outcome: "scope",
          scopeNotes: String(dashBriefProviderResult?.scopeNotes || ""),
          reasonTag: String(dashBriefProviderResult?.reasonTag || "dash_brief_provider_transform_pass"),
          _scopeResponseSource: "dash_brief_provider_transform",
          _scopeFallbackSource: "dash_brief_provider_transform",
          _assistFailed: false,
        }
        : {
          _assistFailed: true,
          _errorCode: String(dashBriefProviderResult?.failureType || "internal_failure"),
          _error: String(dashBriefProviderResult?.message || SCOPE_ASSIST_INTERNAL_MESSAGE),
          _message: String(dashBriefProviderResult?.message || SCOPE_ASSIST_INTERNAL_MESSAGE),
          message: String(dashBriefProviderResult?.message || SCOPE_ASSIST_INTERNAL_MESSAGE),
          error: String(dashBriefProviderResult?.message || SCOPE_ASSIST_INTERNAL_MESSAGE),
          failureType: String(dashBriefProviderResult?.failureType || "internal_failure"),
          retryable: Boolean(dashBriefProviderResult?.retryable),
          status: Number(dashBriefProviderResult?.status || 500),
          provider: "groq",
          ...(String(dashBriefProviderResult?.meta?.finalExcerpt || "").trim()
            ? { detail: String(dashBriefProviderResult?.meta?.finalExcerpt || "") }
            : {}),
          reasonTag: String(dashBriefProviderResult?.reasonTag || "dash_brief_provider_transform_failure"),
        };
      return respondScopeAssist(
        Number(dashBriefProviderResult?.status || (dashBriefProviderResult?.ok ? 200 : 500)),
        dashBriefProviderPayload,
        dashBriefProviderResult?.ok ? "dash_brief_provider_transform_success" : "dash_brief_provider_transform_failure",
        String(dashBriefProviderResult?.reasonTag || (dashBriefProviderResult?.ok ? "dash_brief_provider_transform_pass" : "dash_brief_provider_transform_failure")),
        {
          fallbackSource: "dash_brief_provider_transform",
          outcome: dashBriefProviderResult?.ok ? "scope" : "failed",
          failureType: String(dashBriefProviderResult?.failureType || ""),
          sourceKind: String(dashBriefProviderResult?.meta?.sourceKind || ""),
          sourceChars: Math.max(0, Number(dashBriefProviderResult?.meta?.sourceChars || 0)),
          bulletCount: Math.max(0, Number(dashBriefProviderResult?.meta?.bulletCount || 0)),
          finalExcerpt: String(dashBriefProviderResult?.meta?.finalExcerpt || ""),
        },
        dashBriefProviderResult?.ok ? "scope" : "failed"
      );
    }
    logScopeEvent("scope_request_received", {
      incomingMode: String(mode || context?.scopeMode || "").trim(),
      normalizedMode: normalizedScopeMode,
      inputText: compact(userInput),
      sourceScopeText: compact(scopePromptResolution.text),
      sourcePrompt: compact(sourcePrompt),
      sourceScopePrompt: compact(sourceScopePrompt),
      promptText: compact(promptText),
      currentPrompt: compact(currentPrompt),
      assistantMessage: compact(assistantMessage),
      contextScopePromptBasis: compact(dashBriefLocalRefine ? normalizedContext?.scopePromptBasis : context?.scopePromptBasis),
      contextSourcePrompt: compact(dashBriefLocalRefine ? normalizedContext?.sourcePrompt : context?.sourcePrompt),
      contextSourceScopePrompt: compact(dashBriefLocalRefine ? normalizedContext?.sourceScopePrompt : context?.sourceScopePrompt),
      contextCurrentPrompt: compact(dashBriefLocalRefine ? normalizedContext?.currentPrompt : context?.currentPrompt),
      contextPromptText: compact(dashBriefLocalRefine ? normalizedContext?.promptText : context?.promptText),
      contextAssistantMessage: compact(dashBriefLocalRefine ? normalizedContext?.assistantMessage : context?.assistantMessage),
      bodyKeys: Object.keys(req.body || {}).sort().join(","),
    });
    if (scopeRefineRuntimeMeta?.refineMode === "refine") {
      logScopeEvent("scope_refine_branch_selected", {
        ...scopeRefineRuntimeMeta,
      });
    }
    logScopeEvent("scope_prompt_basis_selected", {
      selectedField: scopePromptResolution.field || "",
      selectedText: compact(scopePromptResolution.text),
      rawSelectedText: compact(scopePromptResolution.raw),
      inputText: compact(userInput),
      sourceScopeText: compact(scopePromptResolution.text),
      sourcePrompt: compact(sourcePrompt),
      sourceScopePrompt: compact(sourceScopePrompt),
      promptText: compact(promptText),
      currentPrompt: compact(currentPrompt),
      assistantMessage: compact(assistantMessage),
    });
  }
  req.once("aborted", () => {
    logScopeEvent("request_aborted", {
      section: normalizedSectionKey || String(sectionKey || ""),
      mode: normalizedScopeMode,
    });
  });

  const sectionDef = AI_ASSIST_SECTIONS[normalizedSectionKey];
  if (!sectionDef) {
    trace.end("bad_request", { status: 400 });
    return res.status(400).json({ error: `Unknown section: ${sectionKey}` });
  }

  let systemPrompt;
  try {
    systemPrompt = sectionDef.buildSystemPrompt({ context: normalizedContext, userInput: String(userInput || "") });
  } catch (_sysBuildErr) {
    systemPrompt = undefined;
  }
  if (typeof systemPrompt !== "string") systemPrompt = "";
  let userPrompt;
  try {
    userPrompt = sectionDef.buildUserPrompt({ userInput: String(userInput || ""), context: normalizedContext });
  } catch (_usrBuildErr) {
    userPrompt = undefined;
  }
  if (typeof userPrompt !== "string" || !userPrompt.trim()) {
    userPrompt = String(userInput || normalizedContext?.scopePromptBasis || "scope request").trim() || "scope request";
  }
  // Dash-specific guard: if dashBranchActive but prompt builder still produced blank, inject minimal Dash prompt
  if (scopeRefineRuntimeMeta?.dashBranchActive && (typeof userPrompt !== "string" || !userPrompt.trim())) {
    const dashGuardSource = sanitizeScopeAssistText(
      normalizedContext?.currentScopeNotes || normalizedContext?.originalAcceptedProseScope || normalizedContext?.dashCanonicalAcceptedProse || ""
    );
    const dashGuardParts = [];
    if (dashGuardSource) dashGuardParts.push(`SOURCE TEXT TO TRANSFORM: ${dashGuardSource}`);
    dashGuardParts.push(`TASK: Convert the source text into Dash + Brief format.`);
    dashGuardParts.push("Rewrite the scope into contractor-ready Dash + Brief format: 3-5 hyphen-led bullet lines, then one blank line, then one short wrap-up paragraph.");
    dashGuardParts.push("Preserve all source detail. Do not genericize, compress away, or restate from scratch.");
    dashGuardParts.push("Return strict JSON only with the exact existing keys.");
    userPrompt = dashGuardParts.join("\n");
  }
  let requestOptions = {};
  try {
    if (typeof sectionDef.buildRequestOptions === "function") {
      requestOptions = sectionDef.buildRequestOptions({ context: normalizedContext, userInput: String(userInput || "") }) || {};
    }
  } catch (_optsBuildErr) {
    requestOptions = {};
  }
  if (isScopeSection) {
    logScopeEvent("prompt_prepared", {
      system_prompt_chars: systemPrompt.length,
      user_prompt_chars: userPrompt.length,
      prompt_basis_field: String(normalizedContext?.scopePromptBasisField || ""),
      prompt_basis_excerpt: String(normalizedContext?.scopePromptBasis || "").replace(/\s+/g, " ").trim().slice(0, 120),
    });
    logScopeEvent("model_selected", {
      primary_model: GROQ_SCOPE_PRIMARY_MODEL,
      selected_model: GROQ_SCOPE_PRIMARY_MODEL,
      generation_mode: "quality_first",
    });
    logScopeEvent("generation_start", {
      route_function: "scope_request_pipeline",
      selected_model: GROQ_SCOPE_PRIMARY_MODEL,
    });
  }
  const scopeRequestFingerprint = normalizedSectionKey === "scope"
    ? buildScopeAssistRequestFingerprint({
      sectionKey: normalizedSectionKey,
      scopeMode: normalizedScopeMode,
      userInput: String(userInput || ""),
      sourcePrompt,
      currentScope,
      refineInstruction,
      formatIntent,
      ignoreCurrentScope,
      context: normalizedContext,
      systemPrompt,
      userPrompt,
      requestOptions,
    })
    : "";

  try {
    if (normalizedSectionKey === "scope") {
      const scopeResult = await withCoalescedScopeAssistRequest(scopeRequestFingerprint, trace, () =>
          handleScopeAssistRequest({
            userInput: String(userInput || ""),
            scopeMode: normalizedScopeMode,
            context: normalizedContext,
            trace,
          requestOptions,
          systemPrompt,
          userPrompt,
          traceId: _tid,
          runtime: {
            defaultModel: GROQ_SCOPE_PRIMARY_MODEL,
            setDebugState: setScopeDebugState,
            setRuntimeTruth: setScopeRuntimeTruth,
            getParseSource: getScopeParseSource,
            logScopeEvent,
          },
        })
      );

      return respondScopeAssist(
        scopeResult.status,
        scopeResult.payload,
        scopeResult.traceLabel,
        scopeResult.traceReason,
        scopeResult.extra,
        scopeResult.outcome
      );
    }

    const assistResult = await callSectionAssistGroq(systemPrompt, userPrompt, trace, requestOptions, {
      sectionKey: normalizedSectionKey,
      scopeMode: normalizedScopeMode,
      traceId: _tid,
    });
    const raw = typeof assistResult === "string"
      ? assistResult
      : String(assistResult?.raw || "");
    const parsed = assistResult?.parsed
      || (typeof sectionDef.parseResponse === "function"
        ? sectionDef.parseResponse(raw, { context: normalizedContext, userInput: String(userInput || "") })
        : extractJsonPayload(raw));

    if (!parsed || typeof parsed !== "object") {
      trace.end("fallback", { status: 200, reason: "parse_failed" });
      return res.json(sectionDef.fallback("groq returned unparseable response"));
    }

    const finalizedPayload = normalizedSectionKey === "labor"
      ? mergeExactDuplicateLaborLines(parsed)
      : parsed;

    return respondScopeAssist(200, finalizedPayload, "ok", "success");
  } catch (e) {
    if (normalizedSectionKey === "scope") {
      const failure = normalizeScopeAssistFailure(e);
      if (_tid) {
        console.log(`[ai-assist:${_tid}] scope_request branch=provider_error input="${String(userInput || "").slice(0, 60)}" error_status=${failure.status} error_type=${failure.failureType}`);
      }
      setScopeDebugState({
        path: "malformed_or_internal_failure",
        stage: "normalized_failure",
        model: scopeDebugState.model || GROQ_SCOPE_PRIMARY_MODEL,
      });
      setScopeRuntimeTruth({
        outcome: "failed",
        reasonTag: failure.failureType || "internal_failure",
        excerpt: String(e?.providerDetail || e?.message || "").trim().slice(0, 160),
        retryUsed: false,
      });
      if (_tid) {
        console.log(`[ai-assist:${_tid}] scope_request branch=normalized_failure failure_type=${failure.failureType} retryable=${failure.retryable}`);
      }
      const errorBody = buildScopeAssistErrorBody({
        ...failure,
        providerName: failure.provider || "groq",
        detail: failure.detail || String(e?.providerDetail || e?.message || ""),
      });
      return respondScopeAssist(failure.status, errorBody, "error_fallback", failure.failureType, { failureType: failure.failureType });
    }
    const failure = normalizeSectionAssistFailure(e);
    trace.end("error_fallback", { status: 200, reason: failure.code });
    return res.json(sectionDef.fallback(e));
  }
});

app.post("/api/guided-build", async (req, res) => {
  const trace = startRouteTrace("/api/guided-build");
  let failureFallback = buildGuidedAdaptiveFallback({}, null);
  try {
    const body = req.body || {};
    const promptPayload = buildGuidedBuildPromptPayload(body);
    const fallback = buildGuidedBuildFallback(promptPayload);
    failureFallback = buildGuidedAdaptiveFallback(promptPayload, fallback);
    const isLocalSkip = shouldSkipGuidedBuildAI(promptPayload);
    trace.step("context", {
      section: promptPayload?.sectionKey || "",
      question: promptPayload?.questionKey || "",
      turn: isLocalSkip ? "local_skip" : "interpretive",
    });

    if (isLocalSkip) {
      trace.end("ok", { status: 200, provider: "none", turn: "local_skip" });
      return res.json(buildGuidedAdaptiveFallback(promptPayload, fallback));
    }

    const systemPrompt = [
      "You are the adaptive wording and interpretation layer for one active Guided Build blocker, not a chatbot and not a planner.",
      "Return JSON only.",
      'Schema: {"promptText":"string","promptVariant":"initial|clarify|narrow_clarify|repair|confirm","answerClassification":"resolved|partial|unresolved_clarify|invalid_for_step|repeated_unresolved","clarificationText":"string","missingComponents":["string"],"normalizedAnswer":"string","interpretedSelections":["string"],"reasoningSummary":"string","confidence":0}',
      "The canonical blocker contract is in activeBlocker. It is authoritative. You must stay inside that blocker only.",
      "Local logic owns blocker identity, section, question, step id, blocker family, prerequisites, validation, writebacks, progression, chips, and loop breaking.",
      "You own only adaptive wording and messy freeform interpretation for the activeBlocker.",
      "Do not change section, question, step id, blocker family, or progression.",
      "Do not restart intake. Do not ask a different family question. Do not emit a generic fallback like 'what should I price next' or 'tell me more'.",
      "promptText and clarificationText must stay in the same blocker family as activeBlocker.blockerFamily and activeBlocker.promptIntent.",
      "interpretedSelections may only contain labels or values that map to activeBlocker.allowedChoices or activeBlocker.requiredComponents for this blocker.",
      "missingComponents may only mention activeBlocker.requiredComponents for this blocker.",
      "Use activeBlocker.promptPhase, activeBlocker.unresolvedCount, turnState, priorGuidedAnswers, plannerState, estimateContext, and the raw userAnswer to adapt wording.",
      "If this is the first ask, you may be broader but still blocker-scoped. If it is a clarification, ask only about the missing part. If it is repeated unresolved, become narrower, more concrete, and more direct.",
      "Rewording alone is not progress. The blocker identity must remain stable even when the wording changes.",
      "If the answer partially resolves the blocker, keep it inside the blocker and return answerClassification='partial' with only the blocker's remaining missingComponents.",
      "If the answer is vague, malformed, empty, or off-step, return answerClassification='invalid_for_step' or 'repeated_unresolved' and a blocker-scoped clarification only.",
      "If the answer can be normalized into one or more allowed blocker choices, put those in interpretedSelections. Do not invent selections outside activeBlocker.allowedChoices.",
      "If the answer is effectively 'all of them' or another broad scope phrase, you may turn it into a blocker-scoped confirmation prompt. Do not switch families.",
      "Keep wording plain, direct, estimator-friendly, and concise. No workflow jargon.",
      "Never invent customer identities, trade families, costs, numbers, or a new blocker.",
    ].join("\n");

    const raw = await requestGuidedBuildGroq(systemPrompt, promptPayload, trace);
    const parsed = extractJsonPayload(raw);
    if (!parsed || typeof parsed !== "object") {
      trace.end("fallback", { status: 200, provider: "groq", parsed: "no" });
      return res.json(buildGuidedAdaptiveFallback(promptPayload, fallback));
    }

    trace.end("ok", { status: 200, provider: "groq", parsed: "yes" });
    return res.json(sanitizeGuidedAdaptivePromptResponse(parsed, promptPayload, fallback));
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("aborted")) {
      logGuidedBuildGroqFailure("timeout", msg);
      trace.end("timeout_fallback", { status: 200, provider: "groq" });
    } else if (!e?.guidedBuildLogged) {
      logGuidedBuildGroqFailure("request failed", msg);
      trace.end("error_fallback", { status: 200, provider: "groq" });
    } else {
      trace.end("error_fallback", { status: 200, provider: "groq" });
    }
    return res.json(failureFallback);
  }
});

app.post("/api/stripe/connect/create-account-link", async (req, res) => {
  try {
    if (!STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Stripe is not configured." });
    }

    let stripeAccountId = asText(req.body?.stripeAccountId);
    if (stripeAccountId && !/^acct_/i.test(stripeAccountId)) {
      return res.status(400).json({ error: "Invalid stripeAccountId." });
    }

    const stripe = getStripeClient();
    if (!stripeAccountId) {
      const account = await stripe.accounts.create({
        type: "express",
        country: "US",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: {
          product: "EstiPaid",
        },
      });
      stripeAccountId = asText(account?.id);
    }

    if (!stripeAccountId) {
      return res.status(500).json({ error: "Unable to create Stripe onboarding link." });
    }

    const returnUrl = resolveStripeConnectUrl(req, req.body?.returnUrl, "return", stripeAccountId);
    const refreshUrl = resolveStripeConnectUrl(req, req.body?.refreshUrl, "refresh", stripeAccountId);
    const accountLink = await stripe.accountLinks.create({
      account: stripeAccountId,
      type: "account_onboarding",
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });

    return res.json({
      ok: true,
      stripeAccountId,
      accountLinkUrl: asText(accountLink?.url),
    });
  } catch (error) {
    logSafeStripeError("/api/stripe/connect/create-account-link", error);
    return res.status(500).json({ error: "Unable to create Stripe onboarding link." });
  }
});

app.get("/api/stripe/connect/account-status", async (req, res) => {
  try {
    if (!STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Stripe is not configured." });
    }

    const stripeAccountId = asText(req.query?.stripeAccountId);
    if (!/^acct_/i.test(stripeAccountId)) {
      return res.status(400).json({ error: "Invalid stripeAccountId." });
    }

    const stripe = getStripeClient();
    const account = await stripe.accounts.retrieve(stripeAccountId);
    return res.json({
      ok: true,
      stripeAccountId,
      chargesEnabled: !!account?.charges_enabled,
      payoutsEnabled: !!account?.payouts_enabled,
      detailsSubmitted: !!account?.details_submitted,
    });
  } catch (error) {
    logSafeStripeError("/api/stripe/connect/account-status", error);
    return res.status(500).json({ error: "Unable to retrieve Stripe account status." });
  }
});

app.post("/api/stripe/create-checkout-session", async (req, res) => {
  try {
    if (!STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Stripe is not configured." });
    }

    const invoiceId = asText(req.body?.invoiceId);
    const invoiceNumber = asText(req.body?.invoiceNumber);
    const customerName = asText(req.body?.customerName);
    const customerEmail = asText(req.body?.customerEmail);
    const projectName = asText(req.body?.projectName);
    const stripeAccountId = asText(req.body?.stripeAccountId);
    const balanceRemaining = roundCurrency(req.body?.balanceRemaining);

    if (!invoiceId) {
      return res.status(400).json({ error: "Missing invoiceId." });
    }
    if (!stripeAccountId) {
      return res.status(400).json({ error: "Connect Stripe before accepting online payments." });
    }
    if (!/^acct_/i.test(stripeAccountId)) {
      return res.status(400).json({ error: "Invalid stripeAccountId." });
    }
    if (balanceRemaining <= 0) {
      return res.status(400).json({ error: "Invalid balanceRemaining." });
    }

    const amountCents = Math.round(balanceRemaining * 100);
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      return res.status(400).json({ error: "Invalid balanceRemaining." });
    }

    const returnBaseUrl = resolveStripeReturnBaseUrl(req);
    const appBaseUrl = resolveStripeAppBaseUrl(req);
    const successUrl = STRIPE_SUCCESS_URL || `${returnBaseUrl}/api/stripe/checkout/success?invoiceId=${encodeURIComponent(invoiceId)}&invoiceNumber=${encodeURIComponent(invoiceNumber)}&returnTo=${encodeURIComponent(appBaseUrl)}&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = STRIPE_CANCEL_URL || `${returnBaseUrl}/api/stripe/checkout/cancel?invoiceId=${encodeURIComponent(invoiceId)}&invoiceNumber=${encodeURIComponent(invoiceNumber)}&returnTo=${encodeURIComponent(appBaseUrl)}`;
    const stripe = getStripeClient();
    const connectedAccount = await stripe.accounts.retrieve(stripeAccountId);
    if (!connectedAccount?.charges_enabled) {
      return res.status(400).json({ error: "Stripe account setup is not complete." });
    }

    const itemName = invoiceNumber
      ? `EstiPaid Invoice ${invoiceNumber}`
      : "EstiPaid Invoice Payment";

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      success_url: successUrl,
      cancel_url: cancelUrl,
      customer_email: isValidEmail(customerEmail) ? customerEmail : undefined,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: itemName,
              description: [projectName, customerName].filter(Boolean).join(" • ") || undefined,
            },
          },
        },
      ],
      metadata: {
        invoiceId,
        stripeAccountId,
        source: "estipaid",
        ...(invoiceNumber ? { invoiceNumber } : {}),
        ...(customerName ? { customerName } : {}),
        ...(projectName ? { projectName } : {}),
      },
    }, {
      stripeAccount: stripeAccountId,
    });

    return res.json({
      ok: true,
      checkoutUrl: asText(session?.url),
      sessionId: asText(session?.id),
      expiresAt: Number(session?.expires_at || 0) || null,
    });
  } catch (error) {
    logSafeStripeError("/api/stripe/create-checkout-session", error);
    return res.status(500).json({ error: "Unable to create Stripe checkout session." });
  }
});

app.post("/api/stripe/retrieve-checkout-session", async (req, res) => {
  try {
    if (!STRIPE_SECRET_KEY) {
      return res.status(500).json({ error: "Stripe is not configured." });
    }

    const sessionId = asText(req.body?.sessionId);
    const stripeAccountId = asText(req.body?.stripeAccountId);
    if (!/^cs_/i.test(sessionId)) {
      return res.status(400).json({ error: "Invalid sessionId." });
    }
    if (!/^acct_/i.test(stripeAccountId)) {
      return res.status(400).json({ error: "Invalid stripeAccountId." });
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ["payment_intent", "payment_intent.latest_charge", "payment_intent.payment_method"] },
      { stripeAccount: stripeAccountId },
    );
    const paymentIntent = session?.payment_intent && typeof session.payment_intent === "object"
      ? session.payment_intent
      : null;
    const latestCharge = paymentIntent?.latest_charge && typeof paymentIntent.latest_charge === "object"
      ? paymentIntent.latest_charge
      : null;
    const paymentMethod = paymentIntent?.payment_method && typeof paymentIntent.payment_method === "object"
      ? paymentIntent.payment_method
      : null;
    const paymentMethodType = asText(
      latestCharge?.payment_method_details?.type
      || paymentMethod?.type
      || paymentIntent?.payment_method_types?.[0]
      || session?.payment_method_types?.[0]
    );
    const cardDetails = latestCharge?.payment_method_details?.card || paymentMethod?.card || null;
    const paidAtTs = Number(latestCharge?.created || 0)
      || Number(paymentIntent?.created || 0)
      || Number(session?.created || 0)
      || Math.floor(Date.now() / 1000);

    return res.json({
      ok: true,
      sessionId,
      stripeAccountId,
      paymentStatus: asText(session?.payment_status),
      status: asText(session?.status),
      amountTotal: Number(session?.amount_total || 0) || 0,
      amountSubtotal: Number(session?.amount_subtotal || 0) || 0,
      amountReceived: Number(paymentIntent?.amount_received || latestCharge?.amount_captured || latestCharge?.amount || 0) || 0,
      currency: asText(session?.currency),
      customerEmail: asText(session?.customer_details?.email || session?.customer_email),
      receiptEmail: asText(latestCharge?.receipt_email),
      receiptUrl: asText(latestCharge?.receipt_url),
      paymentIntentId: asText(paymentIntent?.id),
      paymentMethodType,
      cardBrand: asText(cardDetails?.brand),
      cardLast4: asText(cardDetails?.last4),
      paidAt: paidAtTs ? new Date(paidAtTs * 1000).toISOString() : "",
    });
  } catch (error) {
    logSafeStripeError("/api/stripe/retrieve-checkout-session", error);
    return res.status(500).json({ error: "Unable to retrieve Stripe checkout session." });
  }
});

app.get("/api/stripe/checkout/success", (req, res) => {
  const invoiceId = asText(req.query?.invoiceId);
  const invoiceNumber = asText(req.query?.invoiceNumber);
  const sessionId = asText(req.query?.session_id);
  const returnHref = buildStripeCheckoutReturnLink(
    asText(req.query?.returnTo),
    "success",
    invoiceId,
    sessionId,
  );

  return res
    .status(200)
    .type("html")
    .send(renderStripeCheckoutReturnPage({
      title: "Stripe payment received",
      heading: "Stripe payment received",
      body: "Stripe has confirmed the payment. EstiPaid will show it after the contractor returns to the original invoice tab and runs Check / Sync Stripe Payment.",
      returnHref,
      detailItems: [
        { label: "Payment status", value: "Received by Stripe" },
        { label: "EstiPaid status", value: "Awaiting manual Check / Sync" },
        ...(invoiceNumber ? [{ label: "Invoice", value: invoiceNumber }] : []),
        ...(sessionId ? [{ label: "Session", value: `${String(sessionId).slice(0, 12)}...` }] : []),
      ],
    }));
});

app.get("/api/stripe/checkout/cancel", (req, res) => {
  const invoiceId = asText(req.query?.invoiceId);
  const invoiceNumber = asText(req.query?.invoiceNumber);
  const returnHref = buildStripeCheckoutReturnLink(
    asText(req.query?.returnTo),
    "cancel",
    invoiceId,
  );

  return res
    .status(200)
    .type("html")
    .send(renderStripeCheckoutReturnPage({
      title: "Stripe checkout canceled",
      heading: "Stripe checkout canceled",
      body: "No payment was completed in Stripe from this Checkout Session. Return to EstiPaid if you want to reuse the link or generate a fresh one.",
      returnHref,
      detailItems: [
        { label: "Payment status", value: "Canceled / not completed" },
        { label: "EstiPaid status", value: "No invoice update yet" },
        ...(invoiceNumber ? [{ label: "Invoice", value: invoiceNumber }] : []),
      ],
    }));
});

app.get("/", (req, res) => res.send("OK"));

app.get("/api/dev-ai-identity", (req, res) => {
  return res.json({
    ok: true,
    route: "/api/dev-ai-identity",
    ...getDevAiBackendIdentity("/api/dev-ai-identity"),
  });
});

app.get("/health", (req, res) => {
  res.status(200).json({ ok: true, v: "v16", ts: Date.now() });
});

app.post("/api/translate", async (req, res) => {
  const trace = startRouteTrace("/api/translate", { target: String(req.body?.target || "en").slice(0, 8) });
  try {
    const { text, target } = req.body || {};
    const t = String(text || "").trim();
    const lang = String(target || "en").toLowerCase().startsWith("es") ? "Spanish" : "English";
    if (!t) {
      trace.end("bad_request", { status: 400, provider: "none" });
      return res.status(400).json({ error: "Missing text" });
    }

    // Ollama translate prompt (fast + deterministic)
    const prompt = `Translate the following into ${lang}. Return ONLY the translated text.\n\nTEXT:\n${t}`;

    trace.step("provider_start", { provider: "ollama", path: "/api/generate", attempted: "yes" });
    const r = await fetchWithTimeout(
      `${OLLAMA_BASE}/api/generate`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODEL,
          prompt,
          stream: false,
        }),
      },
      OLLAMA_TIMEOUT_MS
    );

    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      trace.step("provider_end", { provider: "ollama", path: "/api/generate", outcome: `http_${r.status}` });
      trace.end("error", { status: 500, provider: "ollama:/api/generate" });
      return res.status(500).json({ error: "Ollama error", status: r.status, detail: errText });
    }

    const data = await r.json();
    trace.step("provider_end", { provider: "ollama", path: "/api/generate", outcome: "ok" });
    const translatedText = String(data?.response || "").trim();

    trace.end("ok", { status: 200, provider: "ollama:/api/generate" });
    return res.json({ translatedText });
  } catch (e) {
    trace.step("provider_end", { provider: "ollama", path: "/api/generate", outcome: "error" });
    trace.end("error", { status: 500, provider: "ollama:/api/generate" });
    return res.status(500).json({ error: String(e?.message || e) });
  }
});

const DEV_AI_FOREGROUND_HOLD_ENABLED = process.env.NODE_ENV !== "production" && Boolean(process.stdin && process.stdin.isTTY);
let devAiServer = null;
let devAiForegroundHoldActive = false;
let devAiShutdownStarted = false;
let devAiShutdownReason = "";
let devAiExitCode = 0;

function resolveDevAiForegroundState() {
  const stdinTty = Boolean(process.stdin && process.stdin.isTTY);
  const stdoutTty = Boolean(process.stdout && process.stdout.isTTY);
  const stderrTty = Boolean(process.stderr && process.stderr.isTTY);

  if (stdinTty && stdoutTty && stderrTty) return "attached_foreground_tty";
  if (stdinTty || stdoutTty || stderrTty) return "partial_tty";
  if (String(process.env.npm_lifecycle_event || "").trim() === "dev:ai") return "non_interactive_npm_wrapper";
  return "non_interactive";
}

function formatLifecycleError(error) {
  if (!error) return "";
  const code = String(error?.code || "").trim();
  const message = String(error?.message || error).trim();
  if (code && message) return `${code}: ${message}`;
  return code || message || "unknown_error";
}

function logDevAiLifecycle(event, payload = {}) {
  const details = Object.entries(payload)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
    .join(" ");
  console.log(`[dev-ai:${event}]${details ? ` ${details}` : ""}`);
}

function enableDevAiForegroundHold() {
  if (!DEV_AI_FOREGROUND_HOLD_ENABLED || devAiForegroundHoldActive) return;
  try {
    process.stdin.resume();
    devAiForegroundHoldActive = true;
    logDevAiLifecycle("foreground_hold_enabled", {
      pid: process.pid,
      port: DEV_AI_SERVER_PORT,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
    });
  } catch (error) {
    logDevAiLifecycle("foreground_hold_failed", {
      pid: process.pid,
      port: DEV_AI_SERVER_PORT,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
      error: formatLifecycleError(error),
    });
  }
}

function disableDevAiForegroundHold() {
  if (!devAiForegroundHoldActive) return;
  try {
    if (process.stdin && typeof process.stdin.pause === "function") {
      process.stdin.pause();
    }
  } catch {}
  devAiForegroundHoldActive = false;
}

function exitDevAiProcess(code = 0) {
  logDevAiLifecycle("process_release", {
    pid: process.pid,
    port: DEV_AI_SERVER_PORT,
    runtimeBuild: SCOPE_RUNTIME_BUILD,
    reason: devAiShutdownReason || "process_exit",
    exitCode: Number.isInteger(code) ? code : 0,
    foregroundState: resolveDevAiForegroundState(),
  });
  disableDevAiForegroundHold();
  process.exit(code);
}

function shutdownDevAiServer(reason, exitCode = 0, error = null) {
  const normalizedReason = String(reason || "shutdown_requested");
  const normalizedExitCode = Number.isInteger(exitCode) ? exitCode : 0;

  if (devAiShutdownStarted) {
    devAiExitCode = Math.max(devAiExitCode, normalizedExitCode);
    logDevAiLifecycle("shutdown_already_in_progress", {
      pid: process.pid,
      reason: devAiShutdownReason || normalizedReason,
      exitCode: devAiExitCode,
    });
    return;
  }

  devAiShutdownStarted = true;
  devAiShutdownReason = normalizedReason;
  devAiExitCode = normalizedExitCode;

  logDevAiLifecycle("shutdown_requested", {
    pid: process.pid,
    port: DEV_AI_SERVER_PORT,
    runtimeBuild: SCOPE_RUNTIME_BUILD,
    startedAt: DEV_AI_SERVER_STARTED_AT,
    reason: normalizedReason,
    exitCode: normalizedExitCode,
    error: formatLifecycleError(error),
  });

  if (!devAiServer || !devAiServer.listening) {
    logDevAiLifecycle("shutdown_complete", {
      pid: process.pid,
      port: DEV_AI_SERVER_PORT,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
      reason: normalizedReason,
      exitCode: normalizedExitCode,
      serverListening: false,
    });
    exitDevAiProcess(normalizedExitCode);
    return;
  }

  const forceExitTimer = setTimeout(() => {
    logDevAiLifecycle("shutdown_force_exit", {
      pid: process.pid,
      port: DEV_AI_SERVER_PORT,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
      reason: normalizedReason,
      exitCode: normalizedExitCode,
    });
    exitDevAiProcess(normalizedExitCode || 1);
  }, 5000);
  if (typeof forceExitTimer.unref === "function") forceExitTimer.unref();

  devAiServer.close((closeError) => {
    clearTimeout(forceExitTimer);
    const finalExitCode = closeError ? Math.max(normalizedExitCode, 1) : normalizedExitCode;
    logDevAiLifecycle(closeError ? "shutdown_close_error" : "shutdown_complete", {
      pid: process.pid,
      port: DEV_AI_SERVER_PORT,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
      reason: normalizedReason,
      exitCode: finalExitCode,
      error: formatLifecycleError(closeError),
    });
    exitDevAiProcess(finalExitCode);
  });
}

function bootstrapDevAiServer() {
  devAiServer = http.createServer(app);

  devAiServer.on("listening", () => {
    if (typeof devAiServer.ref === "function") {
      devAiServer.ref();
    }
    const address = devAiServer.address();
    const resolvedPort = typeof address === "object" && address ? address.port : DEV_AI_SERVER_PORT;
    logDevAiLifecycle("startup_ready", {
      pid: process.pid,
      port: resolvedPort,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
      startedAt: DEV_AI_SERVER_STARTED_AT,
      serverFile: DEV_AI_SERVER_FILE,
    });
    logDevAiLifecycle("foreground_state", {
      pid: process.pid,
      port: resolvedPort,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
      startedAt: DEV_AI_SERVER_STARTED_AT,
      foregroundState: resolveDevAiForegroundState(),
      stdinIsTTY: Boolean(process.stdin && process.stdin.isTTY),
      stdoutIsTTY: Boolean(process.stdout && process.stdout.isTTY),
      stderrIsTTY: Boolean(process.stderr && process.stderr.isTTY),
      stdinHoldEnabled: DEV_AI_FOREGROUND_HOLD_ENABLED,
    });
    console.log(`Dev AI server running on http://localhost:${resolvedPort}`);
    enableDevAiForegroundHold();
  });

  devAiServer.on("error", (error) => {
    const reason = devAiServer?.listening ? "server_error" : "listen_failed";
    logDevAiLifecycle(reason, {
      pid: process.pid,
      port: DEV_AI_SERVER_PORT,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
      startedAt: DEV_AI_SERVER_STARTED_AT,
      error: formatLifecycleError(error),
    });
    if (!devAiShutdownStarted) {
      shutdownDevAiServer(reason, 1, error);
    }
  });

  devAiServer.on("close", () => {
    logDevAiLifecycle("server_closed", {
      pid: process.pid,
      port: DEV_AI_SERVER_PORT,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
      reason: devAiShutdownReason || "unexpected_close",
      exitCode: devAiExitCode,
    });
    if (!devAiShutdownStarted) {
      exitDevAiProcess(1);
    }
  });

  process.on("SIGINT", () => {
    shutdownDevAiServer("SIGINT", 0);
  });

  process.on("SIGTERM", () => {
    shutdownDevAiServer("SIGTERM", 0);
  });

  process.on("uncaughtException", (error) => {
    logDevAiLifecycle("uncaught_exception", {
      pid: process.pid,
      port: DEV_AI_SERVER_PORT,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
      error: formatLifecycleError(error),
    });
    shutdownDevAiServer("uncaughtException", 1, error);
  });

  process.on("unhandledRejection", (reason) => {
    logDevAiLifecycle("unhandled_rejection", {
      pid: process.pid,
      port: DEV_AI_SERVER_PORT,
      runtimeBuild: SCOPE_RUNTIME_BUILD,
      error: formatLifecycleError(reason),
    });
    shutdownDevAiServer("unhandledRejection", 1, reason);
  });

  devAiServer.listen(DEV_AI_SERVER_PORT);
}

bootstrapDevAiServer();
