// server/dev-ai.js
const { createHash } = require("crypto");
const express = require("express");
const { fetch } = require("undici");

const app = express();
app.use(express.json({ limit: "1mb" }));

const OLLAMA_BASE = "http://127.0.0.1:11434";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODEL = "llama3.2:1b"; // fallback only (speed)
const OLLAMA_TIMEOUT_MS = 120000;
const SCOPE_RUNTIME_BUILD = "scope-runtime-2026-04-07-clear-prompt-failsafe-v1";
const SCOPE_ASSIST_PRIMARY_TIMEOUT_MS = 90000;
const GROQ_MODEL = String(process.env.GROQ_MODEL || "llama-3.1-8b-instant").trim() || "llama-3.1-8b-instant";
const GROQ_SCOPE_PRIMARY_MODEL = String(process.env.GROQ_SCOPE_PRIMARY_MODEL || process.env.GROQ_SCOPE_MODEL || "llama-3.3-70b-versatile").trim() || "llama-3.3-70b-versatile";
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const SCOPE_ASSIST_IN_FLIGHT_REQUESTS = new Map();
let ROUTE_REQUEST_SEQ = 0;

console.log("LOADED dev-ai.js v6 RULE_PARSER_FIRST + STRICT_SANITIZE + V1_LABOR_ENGINE");
console.log(`SCOPE_RUNTIME_BUILD=${SCOPE_RUNTIME_BUILD}`);
console.log(`LIVE_SCOPE_SERVER_FILE=server/dev-ai.js SCOPE_RUNTIME_BUILD=${SCOPE_RUNTIME_BUILD}`);

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

function parseScopeAssistResponse(raw) {
  const parsed = extractJsonPayload(raw);
  const source = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  if (!source) return null;

  const outcomeRaw = String(source?.outcome || "").trim().toLowerCase();
  if (outcomeRaw !== "scope" && outcomeRaw !== "clarify") return null;
  const outcome = outcomeRaw;
  const scopeNotes = sanitizeScopeAssistText(source.scopeNotes || "");
  const clarificationQuestion = sanitizeScopeAssistText(source.clarificationQuestion || "");
  const missingFields = uniqueStrings(Array.isArray(source.missingFields) ? source.missingFields : []);

  if (outcome === "clarify") {
    if (!clarificationQuestion) return null;
    return {
      outcome: "clarify",
      scopeNotes: "",
      clarificationQuestion,
      missingFields,
    };
  }

  if (!scopeNotes) return null;
  return {
    outcome: "scope",
    scopeNotes,
    clarificationQuestion: "",
    missingFields,
  };
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
  const clearPrompt = Boolean(promptAnalysis?.isClearlyDraftable);
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

  const normalizedInput = sanitizeScopeAssistText(userInput);
  const inputTokens = tokenizeComparableScopeWords(normalizedInput);
  const outputTokens = tokenizeComparableScopeWords(normalizedOutput);
  const addedTokens = outputTokens.filter((token) => !inputTokens.includes(token));
  const requiresTwoParagraphs = shouldUseExpandedScopeParagraphs(promptAnalysis);

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

const SCOPE_ASSIST_EXPLICIT_SCAFFOLD_PATTERNS = [
  /\bwork on affected areas\b/i,
  /\bcomplete the described scope\b/i,
  /\bcomplete the stated scope\b/i,
  /\bclean up the work area\b/i,
  /\bnot included unless identified and approved\b/i,
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

function buildScopeAssistSimpleRecoveryDraft(userInput = "") {
  const analysis = analyzeSimpleScopePrompt(userInput);
  if (!analysis.isClearlyDraftable) return "";

  const targetPhrase = analysis.targetPhrase || analysis.normalizedPrompt;
  const definiteTarget = withDefiniteArticle(targetPhrase, "requested item");
  const lower = analysis.normalizedPrompt.toLowerCase();
  const useParagraphBreaks = shouldUseExpandedScopeParagraphs(analysis);

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

  return formatScopeDraftParagraphs([
    [
      `Perform the requested work for ${definiteTarget}, including the direct task called for by the prompt and the normal setup or access needed to complete it cleanly.`,
      `Scope includes any minor prep, fit-up, or alignment naturally tied to the job along with the hands-on work itself.`,
    ],
    [
      `Complete the work with the final check needed to confirm the result is usable and complete.`,
      `Final work should leave ${definiteTarget} in a clean, serviceable condition while staying focused on the requested item without adding unrelated assumptions.`,
    ],
  ], useParagraphBreaks);
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
  const lines = [
    "You are a working trade estimator writing scope notes the way contractors write estimates in the field.",
    "Write practical contractor scope notes, not a spec sheet, checklist, formal proposal, or chatbot reply.",
    "Write a fuller first-pass scope note that sounds usable in a real estimate, not a thin summary.",
    "For straightforward jobs with enough substance, return exactly 2 short paragraphs separated by one blank line.",
    "Use one strong paragraph only when the job is truly tiny and would sound padded if forced longer.",
    "Use a third short paragraph only when the request clearly supports extra practical detail and the added paragraph improves readability.",
    "Paragraph 1 must cover what is being done, where it is being done, and the overall scope intent.",
    "Paragraph 2 must cover the prep, layout, application, installation, repair sequence, finishing steps, and final condition most closely tied to the job.",
    "Each paragraph should be readable and moderately detailed, not a compressed block or one-line blurb.",
    "Write plain paragraph text only. No bullets, no headings, and no numbered lists.",
    "Return ONLY valid JSON with this exact shape: {\"outcome\":\"scope|clarify\",\"scopeNotes\":\"\",\"clarificationQuestion\":\"\",\"missingFields\":[]}",
    "Treat the user's raw scope prompt as the primary source of truth.",
    "Expand short contractor shorthand into estimate-ready language instead of echoing it back.",
    "Use trade signals only as gentle vocabulary and routing help, not as hard gates.",
    "For simple prompts, favor broad contractor-safe wording over narrow product systems or compliance assumptions.",
    "Use direct, natural, field-aware language that sounds estimate-ready, fuller, and specific without over-specifying.",
    "Lead with the actual work item, surface, asset, or area and expand with realistic contractor detail tied to the request.",
    "Include natural sequencing where the job implies it, such as layout, prep, application, installation, repair work, touch-up, finish, and final condition.",
    "Do not cram a richer job into one dense block when the scope has enough weight to breathe across paragraphs.",
    "Do not return a short compressed blurb when the prompt names a real job and area.",
    "Do not answer with vague filler that could fit almost any job.",
    "Do not use generic exclusion boilerplate unless it is tied to the actual prompt.",
    "Always name the actual work item, surface, asset, or area implied by the prompt.",
    "When the prompt is rough, infer the likely contractor workflow, access, prep, verification, cleanup, and scope boundaries from the raw words and soft cues.",
    "Default to outcome=\"scope\" and only use outcome=\"clarify\" when a real missing detail would make the draft misleading.",
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

  if (scopeMode === "refine") {
    lines.push("Focus on the revision request and preserve any good existing scope content that is not being changed.");
  }

  return lines.join("\n");
}

function buildScopeAssistUserPrompt({ userInput = "", context = {} } = {}) {
  const scopeMode = String(context?.scopeMode || "").trim().toLowerCase() === "refine" ? "refine" : "initial";
  const parts = [];
  const scopePromptBasis = String(
    userInput
    || context?.sourceScopePrompt
    || context?.scopeInputAnalysis?.coreScopeText
    || ""
  );
  const scopeShape = analyzeSimpleScopePrompt(scopePromptBasis);
  const shouldForceTwoParagraphs = shouldUseExpandedScopeParagraphs(scopeShape);

  if (scopeMode === "refine") {
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
    parts.push("Rewrite this as fuller contractor-style estimate text while preserving the useful existing scope content.");
    parts.push("If the job has enough substance, use 2 short paragraphs separated by one blank line instead of one compressed block.");
    parts.push("Only keep it to one paragraph if the job is truly tiny and reads better that way.");
    parts.push("Keep the tone practical, field-natural, and estimate-ready. Avoid proposal/legal/spec wording.");
    return parts.join("\n");
  }

  if (context?.currentScopeNotes && context?.ignoreCurrentScope !== true) {
    parts.push(`Existing scope notes for background only; do not copy verbatim: ${context.currentScopeNotes}`);
  }
  if (context?.scopeInputAnalysis?.coreScopeText) parts.push(`Core scope text: ${context.scopeInputAnalysis.coreScopeText}`);
  parts.push(`Raw scope prompt: ${userInput || "(none provided)"}`);
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
      const depthTarget = context?.scopeInputAnalysis?.scopeDepthTarget || "moderate_expansion";
      const expansionPressure = context?.scopeInputAnalysis?.expansionPressure || "";
      const technicalScope = depthTarget === "technical_trade_expansion";
      const vagueScope = depthTarget === "fuller_scope_draft";
      const terseTechnicalScope = technicalScope && expansionPressure === "high";

      return {
        model: GROQ_SCOPE_PRIMARY_MODEL,
        temperature: terseTechnicalScope ? 0.2 : technicalScope ? 0.18 : vagueScope ? 0.26 : depthTarget === "moderate_expansion" ? 0.2 : 0.18,
        top_p: terseTechnicalScope ? 0.92 : technicalScope ? 0.9 : vagueScope ? 0.94 : depthTarget === "moderate_expansion" ? 0.9 : 0.88,
        max_tokens: terseTechnicalScope ? 900 : technicalScope ? 800 : vagueScope ? 720 : depthTarget === "moderate_expansion" ? 640 : 560,
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
  const sourceScopeText = sanitizeScopeAssistText(context?.sourceScopePrompt || "");
  const draftBasisText = normalizedScopeMode === "refine"
    ? (sourceScopeText || existingScopeText || inputText)
    : inputText;
  const defaultModel = String(runtime?.defaultModel || GROQ_SCOPE_PRIMARY_MODEL).trim() || GROQ_SCOPE_PRIMARY_MODEL;
  const clarifyQuestion = "What exact item, surface, or area should be included in the scope?";
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
  const log = (event, payload = {}) => {
    try {
      if (typeof runtime?.logScopeEvent === "function") runtime.logScopeEvent(event, payload);
    } catch {}
  };
  const terminalLog = (event, payload = {}) => {
    try {
      logScopeAssistTerminal(traceId, event, payload);
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
    styleMeta = {},
    extra = {},
  }) => {
    const resolvedModel = String(modelName || defaultModel).trim() || defaultModel;
    setDebug({
      path,
      stage: status >= 400 ? "normalized_failure" : "parse_completed",
      model: resolvedModel,
    });
    setTruth({
      outcome,
      reasonTag,
      excerpt,
      retryUsed,
      ...styleMeta,
    });
    log(path, {
      model: resolvedModel,
      outcome,
      reasonTag,
      excerpt: String(excerpt || "").trim().slice(0, 160),
    });
    if (status < 400) {
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
  const buildDeterministicScope = (reasonTag, excerpt = "", styleMeta = {}) => {
    if (normalizedScopeMode === "refine" && existingScopeText) {
      return finalize({
        path: "deterministic_fallback_success",
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
        reasonTag,
        excerpt: existingScopeText,
        modelName: "local_existing_scope_fallback",
        styleMeta,
        extra: { outcome: "scope" },
      });
    }
    const draft = buildScopeAssistSimpleRecoveryDraft(draftBasisText);
    if (!draft) {
      return buildFailure("internal_failure", "deterministic_fallback_unavailable", excerpt || draftBasisText || inputText, "local_deterministic_scope");
    }
    return finalize({
      path: "deterministic_fallback_success",
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
      reasonTag,
      excerpt: draft,
      modelName: "local_deterministic_scope",
      styleMeta,
      extra: { outcome: "scope" },
    });
  };
  const buildDeterministicScopeSafely = (reasonTag, excerpt = "", styleMeta = {}) => {
    try {
      return buildDeterministicScope(reasonTag, excerpt, styleMeta);
    } catch (_recoveryError) {
      const fallbackScopeNotes = sanitizeScopeAssistText(
        normalizedScopeMode === "refine" && existingScopeText
          ? existingScopeText
          : buildScopeAssistSimpleRecoveryDraft(draftBasisText)
      );
      const safeScopeNotes = fallbackScopeNotes || sanitizeScopeAssistText(excerpt || draftBasisText || inputText);
      const safeModelName = normalizedScopeMode === "refine" && existingScopeText
        ? "local_existing_scope_fallback"
        : fallbackScopeNotes
          ? "local_deterministic_scope"
          : "local_scope_failsafe";
      const payload = {
        outcome: "scope",
        scopeNotes: safeScopeNotes,
        clarificationQuestion: "",
        missingFields: [],
      };

      setDebug({
        path: "deterministic_fallback_success",
        stage: "parse_completed",
        model: safeModelName,
      });
      setTruth({
        outcome: "scope",
        reasonTag,
        excerpt: safeScopeNotes,
        retryUsed: false,
        ...styleMeta,
      });
      log("deterministic_fallback_success", {
        model: safeModelName,
        outcome: "scope",
        reasonTag,
        excerpt: String(safeScopeNotes || "").trim().slice(0, 160),
      });
      log("parse_completed", {
        model: safeModelName,
        parsed: true,
        outcome: "scope",
        scope_notes_chars: String(payload.scopeNotes || "").length,
      });

      return {
        status: 200,
        payload,
        traceLabel: "ok",
        traceReason: "success",
        extra: { outcome: "scope" },
      };
    }
  };

  const promptAnalysis = analyzeSimpleScopePrompt(draftBasisText);
  const clearPromptFailsafeEligible = Boolean(promptAnalysis?.isClearlyDraftable);
  let failsafeExcerpt = String(draftBasisText || inputText || "").trim();
  let failsafeStyleMeta = {};
  if (normalizedScopeMode !== "refine" && promptAnalysis.isVague) {
    return finalize({
      path: "direct_groq_clarify",
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
      reasonTag: "prompt_too_vague",
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
        active_scope_parse_source: "raw_only",
      });
      return buildDeterministicScope(failure.failureType || "provider_failure", String(error?.providerDetail || error?.message || draftBasisText || inputText));
    }

    const modelName = String(assistResult?.model || defaultModel).trim() || defaultModel;
    const raw = String(assistResult?.raw || "");
    failsafeExcerpt = raw.trim() || failsafeExcerpt;
    setDebug({
      model: modelName,
      stage: "provider_response_received",
    });
    log("provider_response_received", {
      model: modelName,
      route_function: "handleScopeAssistRequest",
    });

    const parsed = parseScopeAssistResponse(raw);
    if (!parsed || typeof parsed !== "object") {
      const malformedReason = raw.trim() ? "rejected_malformed" : "rejected_no_content";
      log("structured_parse_failed", {
        model: modelName,
        outcome: "malformed",
        reasonTag: malformedReason,
        excerpt: raw.trim().slice(0, 160),
        active_scope_parse_source: "raw_only",
      });
      return buildDeterministicScope(malformedReason, raw);
    }

    const outcome = String(parsed?.outcome || "scope").trim().toLowerCase() === "clarify" ? "clarify" : "scope";
    const scopeNotesText = sanitizeScopeAssistText(parsed?.scopeNotes || "");
    const clarificationQuestionText = sanitizeScopeAssistText(parsed?.clarificationQuestion || "");
    failsafeExcerpt = String(scopeNotesText || clarificationQuestionText || raw || failsafeExcerpt).trim() || failsafeExcerpt;

    if (outcome === "clarify") {
      return buildDeterministicScope("clarify_for_clear_prompt", clarificationQuestionText || raw);
    }

    const scopeAssessment = assessScopeAssistOutput(scopeNotesText, draftBasisText);
    const scaffoldAssessment = assessScopeAssistGenericScaffold(scopeNotesText, draftBasisText);
    const explicitScaffoldAssessment = matchScopeAssistExplicitScaffoldPhrase(scopeNotesText);
    const styleAssessment = assessScopeAssistStyleCompliance(scopeNotesText, draftBasisText, promptAnalysis);
    const scopeStyleRuntimeMeta = toScopeStyleRuntimeMeta(styleAssessment);
    failsafeStyleMeta = scopeStyleRuntimeMeta;

    if (explicitScaffoldAssessment.matched) {
      log("explicit_scaffold_rejected", {
        model: modelName,
        outcome: "scope",
        reasonTag: "explicit_scaffold_phrase",
        pattern: explicitScaffoldAssessment.pattern,
        match: explicitScaffoldAssessment.match,
        excerpt: scopeNotesText.slice(0, 160),
        active_scope_parse_source: "raw_only",
      });
      return buildDeterministicScope("explicit_scaffold_phrase", scopeNotesText, scopeStyleRuntimeMeta);
    }

    const isAccepted = scopeAssessment.accepted
      && scaffoldAssessment.accepted
      && !explicitScaffoldAssessment.matched
      && styleAssessment.accepted;

    if (isAccepted) {
      terminalLog("LIVE_SCOPE_ACCEPT_BRANCH", {
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        liveScopeServerFile: "server/dev-ai.js",
        styleAssessmentAccepted: Boolean(styleAssessment.accepted),
        styleAssessmentReasonTag: String(styleAssessment.reasonTag || ""),
        styleAssessmentMatchedPattern: String(styleAssessment.matchedPattern || ""),
        paragraphCount: Math.max(0, Number(styleAssessment.paragraphCount || 0)),
        sentenceCount: Math.max(0, Number(styleAssessment.sentenceCount || 0)),
        scopeExcerpt: String(scopeNotesText || "").trim().slice(0, 240),
      });
      terminalLog("STYLE_GATE_RUNTIME_DIRECT_SUCCESS", {
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        styleAssessmentAccepted: Boolean(styleAssessment.accepted),
        styleAssessmentReasonTag: String(styleAssessment.reasonTag || ""),
        styleAssessmentMatchedPattern: String(styleAssessment.matchedPattern || ""),
        paragraphCount: Math.max(0, Number(styleAssessment.paragraphCount || 0)),
        sentenceCount: Math.max(0, Number(styleAssessment.sentenceCount || 0)),
        scopeExcerpt: String(scopeNotesText || "").trim().slice(0, 240),
      });
      return finalize({
        path: "direct_groq_success",
        status: 200,
        payload: {
          outcome: "scope",
          scopeNotes: scopeNotesText,
          clarificationQuestion: "",
          missingFields: [],
        },
        traceLabel: "ok",
        traceReason: "success",
        outcome: "scope",
        reasonTag: scaffoldAssessment.reasonTag || "job_specific_content",
        excerpt: scopeNotesText,
        modelName,
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
        scopeExcerpt: String(styleAssessment.excerpt || scopeNotesText || raw).trim().slice(0, 240),
      });
      terminalLog("STYLE_GATE_RUNTIME_REJECTED", {
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        styleAssessmentReasonTag: String(styleAssessment.reasonTag || ""),
        styleAssessmentMatchedPattern: String(styleAssessment.matchedPattern || ""),
        paragraphCount: Math.max(0, Number(styleAssessment.paragraphCount || 0)),
        sentenceCount: Math.max(0, Number(styleAssessment.sentenceCount || 0)),
        scopeExcerpt: String(styleAssessment.excerpt || scopeNotesText || raw).trim().slice(0, 240),
      });
      log("style_rejected_direct_output", {
        model: modelName,
        outcome: "scope",
        reasonTag: styleAssessment.reasonTag,
        matchedPattern: styleAssessment.matchedPattern || "",
        excerpt: String(styleAssessment.excerpt || scopeNotesText || raw).trim().slice(0, 160),
        active_scope_parse_source: "raw_only",
      });
    }

    const invalidReason = scopeAssessment.accepted
      ? (styleAssessment.accepted
        ? (scaffoldAssessment.reasonTag || scaffoldAssessment.reason || "missing_job_specific_content")
        : styleAssessment.reasonTag)
      : scopeAssessment.reason;
    log("scope_direct_rejected", {
      model: modelName,
      outcome: "scope",
      reasonTag: invalidReason,
      excerpt: String(scaffoldAssessment.excerpt || scopeNotesText || raw).trim().slice(0, 160),
      active_scope_parse_source: "raw_only",
    });
    return buildDeterministicScope(
      invalidReason,
      String(scaffoldAssessment.excerpt || scopeNotesText || raw),
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
  const normalizedContext = {
    ...(context || {}),
    currentSection: normalizedSectionKey,
    ...(normalizedSectionKey === "scope" ? {
      scopeMode: normalizedScopeMode,
      sourceScopePrompt: String(sourcePrompt || context?.sourceScopePrompt || "").trim(),
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
  const scopeDebugState = {
    path: "",
    model: "",
    stage: "",
  };
  const scopeRuntimeTruthState = {
    outcome: "",
    reasonTag: "",
    excerpt: "",
    retryUsed: false,
    scopeStyleAccepted: null,
    scopeStyleReasonTag: "",
    scopeStyleMatchedPattern: "",
    scopeParagraphCount: 0,
    scopeSentenceCount: 0,
  };
  const getScopeRuntimePath = () => {
    const current = String(scopeDebugState.path || "").trim();
    if (
      current === "direct_groq_success"
      || current === "direct_groq_clarify"
      || current === "deterministic_fallback_success"
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
    if (Object.prototype.hasOwnProperty.call(next, "retryUsed")) scopeRuntimeTruthState.retryUsed = Boolean(next.retryUsed);
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
    _scopeRetryUsed: Boolean(scopeRuntimeTruthState.retryUsed),
    _scopeStyleAccepted: typeof scopeRuntimeTruthState.scopeStyleAccepted === "boolean" ? scopeRuntimeTruthState.scopeStyleAccepted : null,
    _scopeStyleReasonTag: String(scopeRuntimeTruthState.scopeStyleReasonTag || ""),
    _scopeStyleMatchedPattern: String(scopeRuntimeTruthState.scopeStyleMatchedPattern || ""),
    _scopeParagraphCount: Math.max(0, Number(scopeRuntimeTruthState.scopeParagraphCount || 0)),
    _scopeSentenceCount: Math.max(0, Number(scopeRuntimeTruthState.scopeSentenceCount || 0)),
  });
  const withScopeDebugMeta = (payload = {}) => {
    if (!isScopeSection || !IS_DEV_RUNTIME) return payload;
    return {
      ...payload,
      _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
      _scopeRuntimePath: getScopeRuntimePath(),
      _scopeParseSource: "raw_only",
      ...getScopeRuntimeTruth(),
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
      _scopeParseSource: "raw_only",
      ...getScopeRuntimeTruth(),
      ...payload,
    });
  };
  const respondScopeAssist = (status, payload, traceLabel, traceReason, extra = {}) => {
    const durationMs = Date.now() - requestStartedAt;
    const responsePayload = withScopeDebugMeta(payload);
    if (isScopeSection) {
      logScopeAssistTerminal(_tid, "final_scope_response_payload", {
        status,
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        _scopeRuntimePath: getScopeRuntimePath(),
        _scopeParseSource: "raw_only",
        ...getScopeRuntimeTruth(),
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
          _scopeParseSource: "raw_only",
          ...getScopeRuntimeTruth(),
        });
      }
      logScopeAssistTerminal(_tid, "total_duration", {
        status,
        duration_ms: durationMs,
        trace_label: traceLabel,
        reason: traceReason,
        _scopeRuntimeBuild: SCOPE_RUNTIME_BUILD,
        _scopeRuntimePath: getScopeRuntimePath(),
        _scopeParseSource: "raw_only",
        ...getScopeRuntimeTruth(),
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
            _scopeParseSource: "raw_only",
            ...getScopeRuntimeTruth(),
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
    logScopeEvent("active_route", {
      route_function: "scope_request_pipeline",
    });
    logScopeEvent("raw_prompt_received", {
      raw_prompt_excerpt: String(userInput || "").trim().slice(0, 120),
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

app.listen(5055, () => {
  console.log("Dev AI server running on http://localhost:5055");
});
