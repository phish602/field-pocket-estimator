// server/dev-ai.js
const { createHash } = require("crypto");
const http = require("http");
const express = require("express");
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
const SCOPE_ASSIST_IN_FLIGHT_REQUESTS = new Map();
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
  next = compressScopeSentenceForShorterFallback(next, 0)
    .replace(/[.!?]+$/g, "")
    .replace(/^(?:and|then)\s+/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!next) return "";
  return next.charAt(0).toUpperCase() + next.slice(1);
}

function splitDashFallbackClauseFragments(sentence = "") {
  const normalized = sanitizeScopeAssistText(sentence).replace(/[.!?]+$/g, "").trim();
  if (!normalized) return [];
  return normalized
    .split(/\s*[,;]\s*/g)
    .map((fragment) => normalizeDashFallbackLineText(fragment))
    .filter((fragment) => countScopeWords(fragment) >= 3);
}

function buildDashFallbackLineCandidates(sourceText = "") {
  const normalized = sanitizeScopeAssistText(sourceText);
  if (!normalized) return [];

  const candidates = [];
  const seen = new Set();
  const pushCandidate = (value = "") => {
    const candidate = normalizeDashFallbackLineText(value);
    const key = normalizeScopeComparisonText(candidate);
    if (!key || seen.has(key) || countScopeWords(candidate) < 2) return;
    seen.add(key);
    candidates.push(candidate);
  };

  splitScopeAssistSentences(normalized).forEach((sentence) => {
    pushCandidate(sentence);
    splitDashFallbackClauseFragments(sentence).forEach((fragment) => pushCandidate(fragment));
  });

  if (!candidates.length) pushCandidate(normalized);
  return candidates;
}

function buildDashFallbackSummaryParagraph(sourceText = "", dashLines = []) {
  const normalizedSource = sanitizeScopeAssistText(sourceText);
  if (!normalizedSource) return "";

  const shorterSummary = flattenShorterScopeToSingleParagraph(
    buildShorterScopeLocalFallback(normalizedSource) || normalizedSource
  );
  const summarySentences = splitScopeAssistSentences(shorterSummary);
  let summary = joinScopeParagraph(
    summarySentences.slice(0, countScopeWords(shorterSummary) > 42 ? 1 : 2)
  ) || shorterSummary;
  summary = flattenShorterScopeToSingleParagraph(summary);

  if (countScopeWords(summary) > 52) {
    summary = joinScopeParagraph(summarySentences.slice(0, 1)) || summary;
  }

  if (!summary) {
    const fallbackLineSummary = dashLines
      .map((line) => normalizeDashFallbackLineText(line))
      .filter(Boolean)
      .slice(0, 2)
      .join(", ")
      .trim();
    if (fallbackLineSummary) {
      summary = `${fallbackLineSummary.charAt(0).toUpperCase()}${fallbackLineSummary.slice(1)}.`;
    }
  }

  return sanitizeScopeAssistText(summary);
}

function formatDashScopeOutput(dashLines = [], summaryParagraph = "") {
  const normalizedLines = dashLines
    .map((line) => normalizeDashFallbackLineText(line))
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
      && dashOutputAccepted
      && scaffoldAssessment.accepted
      && !explicitScaffoldAssessment.matched
      && styleGuardrailAssessment.accepted
    ),
    reasonTag: !formatAssessment.accepted
      ? formatAssessment.reasonTag
      : !semanticAssessment.accepted
        ? (semanticAssessment.reasonTag || "dash_semantic_drift")
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
    preservedAnchorTerms: Array.isArray(semanticAssessment.preservedAnchorTerms) ? semanticAssessment.preservedAnchorTerms : [],
    missingAnchorTerms: Array.isArray(semanticAssessment.missingAnchorTerms) ? semanticAssessment.missingAnchorTerms : [],
    inventedExclusionLikeLanguage: Boolean(semanticAssessment.inventedExclusionLikeLanguage),
    inventedProcessDetailLikeLanguage: Boolean(semanticAssessment.inventedProcessDetailLikeLanguage),
    dashRejectedForSemanticDrift: Boolean(!semanticAssessment.accepted),
    dashSummaryWordCount: Math.max(0, Number(formatAssessment.dashSummaryWordCount || 0)),
    dashSummarySentenceCount: Math.max(0, Number(formatAssessment.dashSummarySentenceCount || 0)),
  };
}

function buildDashScopeLocalFallback(currentScopeNotes = "") {
  const sourceText = sanitizeScopeAssistText(currentScopeNotes);
  if (!sourceText) return "";

  const sourceWordCount = countScopeWords(sourceText);
  const lineCandidates = buildDashFallbackLineCandidates(sourceText);
  const minLineCount = sourceWordCount >= 18 ? 3 : sourceWordCount >= 10 ? 2 : 1;
  const preferredLineCount = sourceWordCount >= 34 ? 4 : sourceWordCount >= 18 ? 3 : minLineCount;
  const preferredCountCandidates = uniqueStrings([
    String(Math.min(6, Math.max(minLineCount, preferredLineCount))),
    String(Math.min(6, Math.max(minLineCount, preferredLineCount + 1))),
    String(Math.min(6, Math.max(minLineCount, lineCandidates.length || preferredLineCount))),
  ])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0);
  const summaryCandidates = uniqueStrings([
    buildDashFallbackSummaryParagraph(sourceText, lineCandidates),
    joinScopeParagraph(splitScopeAssistSentences(buildShorterScopeLocalFallback(sourceText)).slice(0, 1)),
    joinScopeParagraph(splitScopeAssistSentences(sourceText).slice(0, 1)),
  ]).filter(Boolean);

  const variants = [];
  preferredCountCandidates.forEach((lineCount) => {
    const dashLines = lineCandidates.slice(0, lineCount);
    summaryCandidates.forEach((summary) => {
      variants.push(formatDashScopeOutput(dashLines, summary));
    });
  });

  const uniqueVariants = [];
  const variantSeen = new Set();
  variants.forEach((variant) => {
    const normalized = sanitizeScopeAssistText(variant);
    const key = normalizeScopeComparisonText(normalized);
    if (!key || variantSeen.has(key)) return;
    variantSeen.add(key);
    uniqueVariants.push(normalized);
  });

  if (!uniqueVariants.length) {
    const fallbackLines = lineCandidates.slice(0, Math.max(1, Math.min(6, preferredLineCount)));
    return formatDashScopeOutput(fallbackLines, buildDashFallbackSummaryParagraph(sourceText, fallbackLines));
  }

  const scored = uniqueVariants
    .map((text) => ({
      text,
      assessment: assessDashScopeRefineCompliance(sourceText, text),
    }))
    .sort((left, right) => {
      if (Boolean(left.assessment.accepted) !== Boolean(right.assessment.accepted)) {
        return left.assessment.accepted ? -1 : 1;
      }
      if (left.assessment.dashLineCount !== right.assessment.dashLineCount) {
        return Math.abs(left.assessment.dashLineCount - preferredLineCount) - Math.abs(right.assessment.dashLineCount - preferredLineCount);
      }
      return countScopeWords(left.text) - countScopeWords(right.text);
    });

  return sanitizeScopeAssistText(scored[0]?.text || uniqueVariants[0] || sourceText);
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
  if (normalizedPath === "dash_local_fallback_success") return "grounded_fallback";
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
    "Treat the user's raw scope prompt as the primary source of truth.",
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
    lines.push(
      "For this refine request, return plain text using concise hyphen-led scope lines followed by one short contractor-ready summary paragraph.",
      "Each scope line must begin with '- '.",
      "Return 3 to 6 dashed scope lines when possible without padding or inventing extra detail.",
      "After the dashed lines, include one blank line and then one short summary paragraph.",
      "Keep the same job meaning, scope intent, and estimate-ready usefulness as the current draft.",
      "Preserve the same trade or action identity when the current draft uses explicit trade-specific wording.",
      "Preserve critical source anchor terms for the action, object, and location when they carry the job meaning.",
      "Keep the dash lines concise, job-specific, and readable. Do not turn this into a giant bullet list.",
      "Keep the summary paragraph short, natural, and contractor-ready.",
      "Do not add exclusions, approvals, concealed-condition clauses, code or compliance language, scope-boundary clauses, or means and methods not already present in the current draft.",
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
    if (context?.currentScopeNotes) parts.push(`Current scope draft to improve: ${context.currentScopeNotes}`);
    if (context?.sourceScopePrompt) parts.push(`Original scope request: ${context.sourceScopePrompt}`);
    if (context?.scopeInputAnalysis?.coreScopeText) parts.push(`Core scope text: ${context.scopeInputAnalysis.coreScopeText}`);
    if (context?.scopeInputAnalysis?.formattingIntent) parts.push(`Requested output format: ${context.scopeInputAnalysis.formattingIntent}`);
    if (context?.scopeInputAnalysis?.brevityIntent) parts.push(`Requested brevity direction: ${context.scopeInputAnalysis.brevityIntent}`);
    if (context?.scopeRefineAnalysis?.scopeSkeleton) {
      const skeletonLines = formatScopeSkeletonForPrompt(context.scopeRefineAnalysis.scopeSkeleton);
      if (skeletonLines.length) parts.push(`Refine request skeleton:\n${skeletonLines.map((line) => `- ${line}`).join("\n")}`);
    }
    parts.push(`Revision instruction: ${context?.refineInstruction || userInput || "(none provided)"}`);
    if (isDashRefine) {
      parts.push("Reformat the current scope into concise dash-led scope lines followed by one short summary paragraph.");
      parts.push("The output must contain 3 to 6 dashed scope lines when possible, then one blank line, then one short contractor-ready paragraph.");
      parts.push("Each scope line must begin with '- '.");
      parts.push("Keep the same job meaning, scope intent, and estimate-ready usefulness.");
      parts.push("Preserve the same trade or action identity from the current draft when it is explicitly named.");
      if (sourceAnchors.anchorTerms.length) {
        parts.push(`Critical source anchor terms to preserve when they carry the job meaning: ${sourceAnchors.anchorTerms.join(" | ")}`);
      }
      parts.push("Keep the dash lines concise, job-specific, and readable. Do not turn them into a giant bullet list.");
      parts.push("Keep the summary paragraph short, natural, and contractor-ready.");
      parts.push("Do not replace specific trade or action wording with neighboring generic trade language.");
      parts.push("Do not add extra detail that was not already stated or clearly implied.");
      parts.push("Do not add exclusions, approvals, concealed-condition language, code or compliance language, scope-boundary clauses, or means and methods that are not already present in the current draft.");
      parts.push("Do not use headings, numbered lists, markdown labels, quotes, or code fences.");
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
        temperature: dashRefine ? 0.1 : shorterRefine ? 0.12 : terseTechnicalScope ? 0.2 : technicalScope ? 0.18 : vagueScope ? 0.26 : depthTarget === "moderate_expansion" ? 0.2 : 0.18,
        top_p: dashRefine ? 0.78 : shorterRefine ? 0.82 : terseTechnicalScope ? 0.92 : technicalScope ? 0.9 : vagueScope ? 0.94 : depthTarget === "moderate_expansion" ? 0.9 : 0.88,
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
    buildSystemPrompt() {
      return [
        "You are a professional trade estimator generating labor line items for a construction estimate.",
        'Return ONLY valid JSON matching this exact schema: {"lines":[{"role":"string","hours":number,"rate":number}]}',
        "Rules:",
        "- role must be exactly one of: Foreman, Journeyman, Apprentice, General Laborer, Supervisor, Helper, Technician, Equipment Operator",
        "- hours must be a realistic positive number (whole or decimal, e.g. 8, 16, 4.5)",
        "- rate must be a market hourly rate as a whole dollar amount (e.g. 45, 65, 85)",
        "- Return 1 to 5 lines maximum",
        "- Do NOT include totals, subtotals, markups, or internal cost rates",
        "- Do NOT use roles not in the list above",
        "- Base your estimate on the scope description and trade type",
        "- If user provides crew size or duration hints, use them",
      ].join("\n");
    },
    buildUserPrompt({ userInput, context }) {
      const parts = [];
      if (context?.tradeKey) parts.push(`Trade: ${context.tradeKey}`);
      if (context?.scopeNotes) parts.push(`Scope: ${context.scopeNotes}`);
      if (userInput) parts.push(`Additional notes: ${userInput}`);
      if (!context?.tradeKey && !context?.scopeNotes && !userInput) {
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
  const selectedModel = strategy.primary.model;
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
    return { status, payload, traceLabel, traceReason, extra };
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
  const buildProviderFailureNoGroundedFallback = (failureType = "internal_failure", reasonTag = "no_grounded_fallback_available", excerpt = "", modelName = "") => {
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
  const dashSourceText = sanitizeScopeAssistText(existingScopeText || draftBasisText || inputText);
  const dashSourceAnchors = extractShorterSourceAnchorTerms(dashSourceText);
  let dashRetryAttempted = false;
  const setDashRuntime = (assessment = {}, { retryUsed = dashRetryAttempted, localFallbackUsed = false } = {}) => {
    if (!isDashRefine) return;
    setTruth({
      dashMode: true,
      dashLineCount: Math.max(0, Number(assessment?.dashLineCount || 0)),
      dashHasSummaryParagraph: Boolean(assessment?.dashHasSummaryParagraph),
      dashFormatPass: typeof assessment?.dashFormatPass === "boolean" ? assessment.dashFormatPass : null,
      dashSemanticPass: typeof assessment?.dashSemanticPass === "boolean" ? assessment.dashSemanticPass : null,
      dashRetryUsed: Boolean(retryUsed),
      dashLocalFallbackUsed: Boolean(localFallbackUsed),
      retryUsed: Boolean(retryUsed),
    });
  };
  const logDashResult = (event, assessment = {}, extra = {}) => {
    if (!isDashRefine) return;
    log(event, {
      dashMode: true,
      dashLineCount: Math.max(0, Number(assessment?.dashLineCount || 0)),
      dashHasSummaryParagraph: Boolean(assessment?.dashHasSummaryParagraph),
      dashFormatPass: typeof assessment?.dashFormatPass === "boolean" ? assessment.dashFormatPass : null,
      dashSemanticPass: typeof assessment?.dashSemanticPass === "boolean" ? assessment.dashSemanticPass : null,
      retryUsed: Boolean(extra?.retryUsed),
      localFallbackUsed: Boolean(extra?.localFallbackUsed),
      dashReasonTag: String(assessment?.reasonTag || extra?.failureReasonTag || ""),
      ...extra,
    });
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
  const buildDashRetryUserPrompt = (failureReasonTag = "", failedScopeNotes = "") => {
    const parts = [];
    if (existingScopeText) parts.push(`Current scope draft to reformat: ${existingScopeText}`);
    if (context?.sourceScopePrompt) parts.push(`Original scope request: ${context.sourceScopePrompt}`);
    if (context?.scopeInputAnalysis?.coreScopeText) parts.push(`Core scope text: ${context.scopeInputAnalysis.coreScopeText}`);
    if (dashSourceAnchors.anchorTerms.length) {
      parts.push(`Critical source anchor terms: ${dashSourceAnchors.anchorTerms.join(" | ")}`);
    }
    parts.push(`Revision instruction: ${context?.refineInstruction || inputText || "Dash + Brief"}`);
    if (failedScopeNotes) {
      parts.push(`Prior Dash result that failed: ${sanitizeScopeAssistText(failedScopeNotes).slice(0, 320)}`);
    }
    parts.push(`Retry reason: ${failureReasonTag || "dash_format_or_semantic_failure"}.`);
    parts.push("The prior result failed because it did not follow the dash-plus-brief format closely enough, drifted from the source meaning, or added detail that was not in the source.");
    parts.push("Reformat the current scope into concise dash-led scope lines followed by one short contractor-ready paragraph.");
    parts.push("Return 3 to 6 dashed scope lines when possible.");
    parts.push("Each scope line must begin with '- '.");
    parts.push("After the dashed lines, include one blank line and then one short summary paragraph.");
    parts.push("Preserve the same trade or action identity, job meaning, scope intent, and estimate-ready usefulness.");
    parts.push("Preserve critical source terms when they carry the job meaning.");
    parts.push("Do not replace specific trade or action wording with neighboring generic trade language.");
    parts.push("Do not add exclusions, approvals, concealed-condition clauses, code or compliance language, scope-boundary clauses, or means and methods not already present in the current draft.");
    parts.push("Do not add new scope detail. Reformat and tighten the source wording only.");
    parts.push("Do not use headings, numbered lists, markdown labels, quotes, or code fences.");
    parts.push("Return strict JSON only with the exact existing keys.");
    return parts.join("\n");
  };
  const buildDashLocalFallbackResult = (failureReasonTag = "", failedScopeNotes = "", { retryUsed = dashRetryAttempted } = {}) => {
    const fallbackScopeNotes = sanitizeScopeAssistText(
      buildDashScopeLocalFallback(dashSourceText || existingScopeText || draftBasisText || inputText)
    ) || sanitizeScopeAssistText(dashSourceText || existingScopeText || draftBasisText || inputText);
    const fallbackAssessment = assessDashScopeRefineCompliance(dashSourceText, fallbackScopeNotes);
    setDashRuntime(fallbackAssessment, {
      retryUsed,
      localFallbackUsed: true,
    });
    logDashResult("dash_local_fallback_used", fallbackAssessment, {
      retryUsed,
      localFallbackUsed: true,
      failureReasonTag,
      failedExcerpt: String(failedScopeNotes || "").trim().slice(0, 160),
      fallbackExcerpt: String(fallbackScopeNotes || "").trim().slice(0, 160),
    });
    return finalize({
      path: "dash_local_fallback_success",
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
      reasonTag: fallbackAssessment.accepted ? "dash_local_fallback_formatted" : "dash_local_fallback_best_effort",
      excerpt: fallbackScopeNotes,
      modelName: "local_dash_scope_fallback",
      retryUsed,
      extra: { outcome: "scope", fallbackSource: "dash_local_reformat" },
    });
  };
  const maybeRetryDashResult = async ({ failureReasonTag = "", failedScopeNotes = "", failedModelName = "" } = {}) => {
    if (!isDashRefine) return null;
    if (dashRetryAttempted) {
      return buildDashLocalFallbackResult(failureReasonTag, failedScopeNotes);
    }

    dashRetryAttempted = true;
    setTruth({
      retryUsed: true,
      dashRetryUsed: true,
    });
    logDashResult("dash_retry_requested", {
      accepted: false,
      reasonTag: failureReasonTag,
    }, {
      retryUsed: true,
      localFallbackUsed: false,
      failedModelName: String(failedModelName || defaultModel).trim() || defaultModel,
      failedExcerpt: String(failedScopeNotes || "").trim().slice(0, 160),
    });

    const retrySystemPrompt = `${systemPrompt}\nThis is a retry for a Dash + Brief refine result that failed because it did not follow the required dash-lines-plus-brief-paragraph format, drifted from the source meaning, or added details not present in the source. Preserve the same trade, action, object, and location anchors from the current draft, keep the wording source-faithful, return concise dash lines, and end with one short paragraph.`;
    const retryUserPrompt = buildDashRetryUserPrompt(failureReasonTag, failedScopeNotes);
    const retryRequestOptions = {
      ...requestOptions,
      temperature: 0.06,
      top_p: 0.68,
      max_tokens: Math.min(420, Math.max(220, Number(requestOptions?.max_tokens || 420))),
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
      logDashResult("dash_retry_provider_failed", {
        accepted: false,
        reasonTag: retryFailure.failureType || "provider_failure",
      }, {
        retryUsed: true,
        localFallbackUsed: false,
        failedExcerpt: String(retryError?.providerDetail || retryError?.message || "").trim().slice(0, 160),
      });
      return buildDashLocalFallbackResult(retryFailure.failureType || failureReasonTag || "provider_failure", String(retryError?.providerDetail || retryError?.message || failedScopeNotes || ""));
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
      return buildDashLocalFallbackResult(retryParsed.failureReason || failureReasonTag || "dash_retry_parse_failed", retryRaw);
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
      return buildDashLocalFallbackResult("dash_retry_non_scope_result", retryParsed.clarificationQuestionText || retryRaw);
    }

    const retryAssessment = assessDashScopeRefineCompliance(dashSourceText, retryParsed.scopeNotesText);
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
    if (!retryAssessment.accepted) {
      return buildDashLocalFallbackResult(retryAssessment.reasonTag || failureReasonTag || "dash_retry_failed", retryParsed.scopeNotesText);
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
    if (!retryResult?.scopeNotesText) {
      return buildDashLocalFallbackResult(failureReasonTag || "dash_retry_missing_scope", failsafeExcerpt);
    }

    const recoveredDashAssessment = assessDashScopeRefineCompliance(dashSourceText, retryResult.scopeNotesText);
    setDashRuntime(recoveredDashAssessment, {
      retryUsed: true,
      localFallbackUsed: false,
    });
    logDashResult("dash_compliance_recovered_evaluated", recoveredDashAssessment, {
      retryUsed: true,
      localFallbackUsed: false,
      attemptLabel: "dash_retry_recovered",
      model: retryResult.modelName,
    });

    if (!recoveredDashAssessment.accepted) {
      return buildDashLocalFallbackResult(recoveredDashAssessment.reasonTag || failureReasonTag || "dash_retry_validation_failed", retryResult.scopeNotesText);
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
      reasonTag: recoveredDashAssessment.reasonTag || "dash_format_and_semantics_pass",
      excerpt: retryResult.scopeNotesText,
      modelName: retryResult.modelName,
      retryUsed: true,
      extra: { outcome: "scope" },
    });
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
      const dashAssessment = assessDashScopeRefineCompliance(dashSourceText, activeScopeNotesText);
      setDashRuntime(dashAssessment, {
        retryUsed: false,
        localFallbackUsed: false,
      });
      logDashResult("dash_compliance_initial_evaluated", dashAssessment, {
        retryUsed: false,
        localFallbackUsed: false,
        attemptLabel: "initial",
        model: activeModelName,
      });
      if (!dashAssessment.accepted) {
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
  const scopePromptResolution = normalizedSectionKey === "scope"
    ? resolveScopeAssistPromptBasis({
      userInput: String(userInput || ""),
      sourcePrompt: String(sourcePrompt || ""),
      sourceScopePrompt: String(sourceScopePrompt || ""),
      promptText: String(promptText || ""),
      currentPrompt: String(currentPrompt || ""),
      assistantMessage: String(assistantMessage || ""),
      context: context || {},
    })
    : { field: "", text: "", raw: "" };
  const normalizedContext = {
    ...(context || {}),
    currentSection: normalizedSectionKey,
    ...(normalizedSectionKey === "scope" ? {
      scopeMode: normalizedScopeMode,
      sourceScopePrompt: scopePromptResolution.text || String(sourcePrompt || sourceScopePrompt || context?.sourceScopePrompt || "").trim(),
      scopePromptBasis: scopePromptResolution.text || String(userInput || sourcePrompt || sourceScopePrompt || promptText || currentPrompt || assistantMessage || "").trim(),
      scopePromptBasisField: scopePromptResolution.field || "",
      currentScopeNotes: ignoreCurrentScope
        ? String(currentScope || "").trim()
        : String(currentScope || context?.currentScopeNotes || "").trim(),
      refineInstruction: String(refineInstruction || context?.refineInstruction || userInput || "").trim(),
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
    dashLineCount: 0,
    dashHasSummaryParagraph: false,
    dashFormatPass: null,
    dashSemanticPass: null,
    dashRetryUsed: false,
    dashLocalFallbackUsed: false,
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
      || current === "dash_local_fallback_success"
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
    if (Object.prototype.hasOwnProperty.call(next, "dashLineCount")) scopeRuntimeTruthState.dashLineCount = Math.max(0, Number(next.dashLineCount || 0));
    if (Object.prototype.hasOwnProperty.call(next, "dashHasSummaryParagraph")) scopeRuntimeTruthState.dashHasSummaryParagraph = Boolean(next.dashHasSummaryParagraph);
    if (Object.prototype.hasOwnProperty.call(next, "dashFormatPass")) scopeRuntimeTruthState.dashFormatPass = typeof next.dashFormatPass === "boolean" ? next.dashFormatPass : null;
    if (Object.prototype.hasOwnProperty.call(next, "dashSemanticPass")) scopeRuntimeTruthState.dashSemanticPass = typeof next.dashSemanticPass === "boolean" ? next.dashSemanticPass : null;
    if (Object.prototype.hasOwnProperty.call(next, "dashRetryUsed")) scopeRuntimeTruthState.dashRetryUsed = Boolean(next.dashRetryUsed);
    if (Object.prototype.hasOwnProperty.call(next, "dashLocalFallbackUsed")) scopeRuntimeTruthState.dashLocalFallbackUsed = Boolean(next.dashLocalFallbackUsed);
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
    _scopeDashLineCount: Math.max(0, Number(scopeRuntimeTruthState.dashLineCount || 0)),
    _scopeDashHasSummaryParagraph: Boolean(scopeRuntimeTruthState.dashHasSummaryParagraph),
    _scopeDashFormatPass: typeof scopeRuntimeTruthState.dashFormatPass === "boolean" ? scopeRuntimeTruthState.dashFormatPass : null,
    _scopeDashSemanticPass: typeof scopeRuntimeTruthState.dashSemanticPass === "boolean" ? scopeRuntimeTruthState.dashSemanticPass : null,
    _scopeDashRetryUsed: Boolean(scopeRuntimeTruthState.dashRetryUsed),
    _scopeDashLocalFallbackUsed: Boolean(scopeRuntimeTruthState.dashLocalFallbackUsed),
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
  const respondScopeAssist = (status, payload, traceLabel, traceReason, extra = {}) => {
    const durationMs = Date.now() - requestStartedAt;
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
      contextScopePromptBasis: compact(context?.scopePromptBasis),
      contextSourcePrompt: compact(context?.sourcePrompt),
      contextSourceScopePrompt: compact(context?.sourceScopePrompt),
      contextCurrentPrompt: compact(context?.currentPrompt),
      contextPromptText: compact(context?.promptText),
      contextAssistantMessage: compact(context?.assistantMessage),
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

  let systemPrompt = sectionDef.buildSystemPrompt({ context: normalizedContext, userInput: String(userInput || "") });
  let userPrompt = sectionDef.buildUserPrompt({ userInput: String(userInput || ""), context: normalizedContext });
  const requestOptions = typeof sectionDef.buildRequestOptions === "function"
    ? (sectionDef.buildRequestOptions({ context: normalizedContext, userInput: String(userInput || "") }) || {})
    : {};
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
        scopeResult.extra
      );
    }

    const assistResult = await callSectionAssistGroq(systemPrompt, userPrompt, trace, requestOptions, {
      sectionKey: normalizedSectionKey,
      scopeMode: normalizedScopeMode,
      traceId: _tid,
    });
    const raw = String(assistResult?.raw || "");
    const parsed = assistResult?.parsed
      || (typeof sectionDef.parseResponse === "function"
        ? sectionDef.parseResponse(raw, { context: normalizedContext, userInput: String(userInput || "") })
        : extractJsonPayload(raw));

    if (!parsed || typeof parsed !== "object") {
      trace.end("fallback", { status: 200, reason: "parse_failed" });
      return res.json(sectionDef.fallback("groq returned unparseable response"));
    }

    return respondScopeAssist(200, parsed, "ok", "success");
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
