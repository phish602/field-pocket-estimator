// server/dev-ai.js
const { createHash } = require("crypto");
const express = require("express");
const { fetch } = require("undici");

const app = express();
app.use(express.json({ limit: "1mb" }));

const OLLAMA_BASE = "http://127.0.0.1:11434";
const GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENAI_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "llama3.2:1b"; // fallback only (speed)
const OLLAMA_TIMEOUT_MS = 120000;
const GROQ_MODEL = String(process.env.GROQ_MODEL || "llama-3.1-8b-instant").trim() || "llama-3.1-8b-instant";
const GROQ_SCOPE_MODEL = String(process.env.GROQ_SCOPE_MODEL || "").trim();
const GROQ_API_KEY = String(process.env.GROQ_API_KEY || "").trim();
const SCOPE_ASSIST_IN_FLIGHT_REQUESTS = new Map();
let ROUTE_REQUEST_SEQ = 0;

console.log("LOADED dev-ai.js v6 RULE_PARSER_FIRST + STRICT_SANITIZE + V1_LABOR_ENGINE");

function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
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
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const scopeNotes = sanitizeScopeAssistText(
      parsed.scopeNotes || parsed.text || parsed.content || parsed.notes || parsed.result || ""
    );
    if (scopeNotes) return { scopeNotes };
  }

  if (typeof parsed === "string") {
    const scopeNotes = sanitizeScopeAssistText(parsed);
    if (scopeNotes) return { scopeNotes };
  }

  const scopeNotes = sanitizeScopeAssistText(raw);
  return scopeNotes ? { scopeNotes } : null;
}

const TECHNICAL_RETRY_SIGNAL_CHECKS = [
  { label: "orbital welding", regex: /\borbital\b|\bweld(?:ing)?\b/i },
  { label: "welding", regex: /\bweld(?:ing)?\b/i },
  { label: "stainless steel", regex: /\bstainless\b/i },
  { label: "instrumentation", regex: /\binstrument(?:ation)?\b/i },
  { label: "controls", regex: /\bcontrols?\b/i },
  { label: "panel work", regex: /\bpanel\b/i },
  { label: "tie-in", regex: /\btie(?:-| )?in(?:s)?\b/i },
  { label: "circuit breaker work", regex: /\bcircuit breakers?\b|\bbreakers?\b/i },
  { label: "disconnect work", regex: /\bdisconnect(?:s)?\b/i },
  { label: "conduit work", regex: /\bconduit\b|\bemt\b|\bimc\b|\brigid\b|\braceway\b/i },
  { label: "process tubing", regex: /\bprocess tubing\b|\btubing\b/i },
  { label: "fractional sizing", regex: /\b\d+\/\d+\b/ },
  { label: "line footage", regex: /\b\d+(?:\.\d+)?\s*(?:feet|foot|ft)\b/i },
  { label: "process lines", regex: /\blines?\b|\btubing\b|\btube\b|\bpiping\b/i },
  { label: "rooftop equipment", regex: /\brooftop\b|\bpackage unit\b|\brtu\b/i },
  { label: "tenant improvement", regex: /\btenant improvement\b|\bti\b/i },
  { label: "site lighting equipment", regex: /\blight poles?\b|\bpole lights?\b|\blight standards?\b|\bsite lighting\b|\bparking lot lighting\b|\bparking lot lights?\b|\barea lights?\b/i },
  { label: "site asset work", regex: /\bmounted asset\b|\bexterior equipment\b|\bsite equipment\b|\bsite asset\b|\bsign poles?\b|\bbollards?\b|\bpole-mounted\b/i },
  { label: "sub-fab environment", regex: /\bsub[ -]?fab\b/i },
  { label: "fab environment", regex: /\bfab\b/i },
  { label: "cleanroom environment", regex: /\bcleanroom\b/i },
  { label: "industrial site", regex: /\bintel\b|\bplant\b|\bfacility\b/i },
];

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

function countScopeSentences(text) {
  const matches = sanitizeScopeAssistText(text).match(/[.!?](?:\s|$)/g);
  return matches ? matches.length : 0;
}

function countStructuredScopeLines(text, format) {
  const lines = sanitizeScopeAssistText(text).split("\n").map((line) => line.trim()).filter(Boolean);
  if (format === "bullets") return lines.filter((line) => /^[-*•]\s+/.test(line)).length;
  if (format === "numbered_list") return lines.filter((line) => /^\d+\.\s+/.test(line)).length;
  return lines.length;
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

function countSpecialtySignalCoverage(scopeNotes, technicalSignals = []) {
  const normalized = sanitizeScopeAssistText(scopeNotes).toLowerCase();
  const signals = uniqueStrings(technicalSignals);
  return TECHNICAL_RETRY_SIGNAL_CHECKS
    .filter((entry) => signals.includes(entry.label))
    .filter((entry) => entry.regex.test(normalized))
    .length;
}

function countSpecialtyScopeComponents(scopeNotes) {
  const normalized = sanitizeScopeAssistText(scopeNotes);
  const checks = [
    /\borbital\b|\bweld\b|\bstainless\b|\btub(?:e|ing)\b|\bpiping\b|\blines?\b|\binstrument(?:ation)?\b|\bpanel\b|\bbreakers?\b|\bdisconnect\b|\bconduit\b|\bpackage unit\b|\brtu\b|\blight poles?\b|\bpole lights?\b|\blight standards?\b|\bsite lighting\b|\bmounted asset\b|\bexterior equipment\b|\bsite equipment\b|\bsite asset\b|\bsign poles?\b|\bbollards?\b/i,
    /\bfit-up\b|\balignment\b|\btie(?:-| )?in\b|\bterminations?\b|\baccessible runs?\b|\bwork area\b|\blabel(?:ing)?\b|\bidentification\b|\bsupports?\b|\bbends?\b|\breconnect\b|\brouting\b|\blift\b|\bcrane\b|\baccess equipment\b|\bsite-lighting conductors?\b|\bset and secure\b|\bremove debris\b|\bdispose of removed materials\b/i,
    /\bsub[ -]?fab\b|\bfab\b|\bcleanroom\b|\bintel\b|\bplant\b|\bfacility\b|\bpanel\b|\brooftop\b|\bwarehouse\b|\btenant improvement\b|\bcommercial\b|\bhotel\b|\bparking lot\b|\bcampus\b|\bproperty\b|\boutdoor\b|\bexterior\b/i,
    /\bqa\b|\bqc\b|\btesting\b|\bshutdown\b|\bprogramming\b|\blive-system\b|\bverify\b|\bfollow-on electrical work\b|\bverify operation where applicable\b/i,
    /\bstated limits\b|\bunless\b|\bnot included\b|\bwork outside\b|\bfeeder\b|\bcode-driven\b|\bwire pull\b|\bmajor demolition\b|\bfoundation\b|\bunderground wiring\b|\butility\/service changes\b|\baccessible disconnect points?\b|\bsite connections?\b/i,
  ];
  return checks.filter((regex) => regex.test(normalized)).length;
}

function hasSpecialtyExecutionCoverage(scopeNotes) {
  return /\bfit-up\b|\balignment\b|\btie(?:-| )?in\b|\bterminations?\b|\baccessible runs?\b|\broute\b|\brouting\b|\binstall\b|\bweld\b|\btubing\b|\bpiping\b|\bpanel\b|\bbreakers?\b|\bdisconnect\b|\bconduit\b|\blabel(?:ing)?\b|\bidentification\b|\bsupports?\b|\bbends?\b|\breconnect\b|\blift\b|\bcrane\b|\baccess equipment\b|\bsite-lighting conductors?\b|\bset and secure\b|\bdispose of removed materials\b/i.test(
    sanitizeScopeAssistText(scopeNotes)
  );
}

function hasSpecialtyBoundaryCoverage(scopeNotes) {
  return /\bqa\b|\bqc\b|\btesting\b|\bshutdown\b|\bprogramming\b|\blive-system\b|\bstated limits?\b|\bunless specifically identified and approved\b|\bwork outside\b|\bfoundation\b|\bunderground wiring\b|\butility\/service changes\b|\bdisconnect points?\b|\bsite connections?\b/i.test(
    sanitizeScopeAssistText(scopeNotes)
  );
}

function requiresSpecialtyEnvironment(context = {}) {
  const analysis = context?.scopeInputAnalysis || {};
  return Boolean(
    (Array.isArray(analysis.locations) && analysis.locations.length > 0)
    || (Array.isArray(analysis.technicalSignals) && analysis.technicalSignals.some((signal) =>
      ["sub-fab environment", "fab environment", "cleanroom environment", "industrial site", "panel work", "rooftop equipment", "tenant improvement", "site lighting equipment", "site asset work"].includes(signal)
    ))
    || analysis?.siteEquipmentScope
  );
}

function hasSpecialtyEnvironmentCoverage(scopeNotes, context = {}) {
  const normalized = sanitizeScopeAssistText(scopeNotes);
  const analysis = context?.scopeInputAnalysis || {};
  if (!requiresSpecialtyEnvironment(context)) return true;

  if (Array.isArray(analysis.locations) && analysis.locations.some((location) => {
    const escaped = String(location || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return escaped && new RegExp(`\\b${escaped}\\b`, "i").test(normalized);
  })) {
    return true;
  }

  return /\bsub[ -]?fab\b|\bfab\b|\bcleanroom\b|\bintel\b|\bplant\b|\bfacility\b|\bpanel\b|\brooftop\b|\bwarehouse\b|\btenant improvement\b|\bcommercial\b|\bhotel\b|\bparking lot\b|\bcampus\b|\bproperty\b|\boutdoor\b|\bexterior\b/i.test(normalized);
}

function hasSpecialtyResidentialBoilerplate(scopeNotes) {
  return /\bdesignated surfaces?\b|\badjacent areas?\b|\bmask(?:ing)?\b|\bpaint\b|\bdrywall\b|\bconcealed damage\b|\bwall repair\b/i.test(
    sanitizeScopeAssistText(scopeNotes)
  );
}

function getSpecialtyRetryReasons(scopeNotes, { userInput = "", context = {} } = {}) {
  const analysis = context?.scopeInputAnalysis || {};
  if (analysis?.scopeDepthTarget !== "technical_trade_expansion") return [];

  const normalized = sanitizeScopeAssistText(scopeNotes);
  if (!normalized) return ["empty specialty output"];

  const format = analysis?.formattingIntent || "";
  const tokenCount = tokenizeComparableScopeWords(normalized).length;
  const sentenceCount = countScopeSentences(normalized);
  const structuredLines = countStructuredScopeLines(normalized, format);
  const inputTokens = tokenizeComparableScopeWords(analysis?.coreScopeText || userInput);
  const outputTokens = tokenizeComparableScopeWords(normalized);
  const overlap = inputTokens.length && outputTokens.length
    ? countIntersection(inputTokens, outputTokens) / Math.max(1, Math.min(inputTokens.length, outputTokens.length))
    : 0;
  const technicalSignals = uniqueStrings(analysis?.technicalSignals || []);
  const expansionPressure = String(analysis?.expansionPressure || "").trim().toLowerCase();
  const shorthandTechnical = analysis?.technicalScopeCompleteness === "shorthand" || expansionPressure === "high";
  const coverageCount = countSpecialtySignalCoverage(normalized, technicalSignals);
  const requiredCoverage = technicalSignals.length >= 7 ? 3 : technicalSignals.length >= 3 ? 2 : 1;
  const componentCount = countSpecialtyScopeComponents(normalized);
  const reasons = [];

  if (/^(?:scope|work|this project)\s+includes?\b/i.test(normalized) && countScopeSentences(normalized) <= 1) {
    reasons.push("generic summary wrapper");
  }

  if (format === "sentence") {
    if (tokenCount < 22) reasons.push("too short for specialty sentence depth");
  } else if (format === "bullets" || format === "numbered_list") {
    if (structuredLines < (shorthandTechnical ? 4 : 3)) reasons.push("not enough specialty structured lines");
  } else if (format === "paragraph") {
    if (sentenceCount < 3 || tokenCount < (shorthandTechnical ? 40 : 34)) reasons.push("paragraph too thin for specialty route");
  } else if (sentenceCount < 3 || tokenCount < (shorthandTechnical ? 36 : 30)) {
    reasons.push("specialty scope too thin");
  }

  if (coverageCount < requiredCoverage) reasons.push("missing technical signal coverage");
  if (componentCount < (shorthandTechnical ? 5 : 4)) reasons.push("missing specialty scope density");
  if (!hasSpecialtyExecutionCoverage(normalized)) reasons.push("missing specialty execution detail");
  if (!hasSpecialtyBoundaryCoverage(normalized)) reasons.push("missing specialty boundary language");
  if (!hasSpecialtyEnvironmentCoverage(normalized, context)) reasons.push("missing technical environment detail");
  if (hasSpecialtyResidentialBoilerplate(normalized)) reasons.push("contains residential boilerplate");
  if (shorthandTechnical && sentenceCount < 3 && format !== "sentence") reasons.push("technical shorthand not developed");
  if (overlap >= (shorthandTechnical ? 0.62 : 0.7) && outputTokens.length <= inputTokens.length + (shorthandTechnical ? 14 : 10)) {
    reasons.push("near-echo specialty rewrite");
  }

  return uniqueStrings(reasons);
}

function buildSpecialtyRetryPrompts(systemPrompt, userPrompt, { context = {}, reasons = [] } = {}) {
  const technicalSignals = uniqueStrings(context?.scopeInputAnalysis?.technicalSignals || []);
  const retrySystemPrompt = [
    systemPrompt,
    "",
    "SPECIALTY TECHNICAL RETRY RULES:",
    "- The previous specialty draft was too thin or too generic.",
    "- Short technical or commercial scope prompts are usually estimator shorthand, not finished estimate notes.",
    "- Preserve the user's technical wording, quantities, sizes, and environment details.",
    "- Infer a realistic professional work sequence from short technical shorthand while staying within the described trade and without inventing exotic specifics.",
    "- Add denser specialty scope with direct execution detail, specialty process detail, environment-aware wording when provided, and specialty boundary or coordination language.",
    "- Expand with trade-appropriate operations such as terminations, routing, supports, accessible reconnection, labeling, testing, verification, startup checks, cleanup, or shutdown/access coordination when naturally applicable.",
    "- For site asset or exterior equipment scopes, lean into realistic field operations such as safe disconnect/handling, lift or access-equipment coordination, disposal of removed materials, set/securement, verification, and cleanup when those are naturally implied.",
    "- Keep the added detail flexible and trade-specific, not formulaic boilerplate.",
    "- Avoid residential or remodeling filler such as adjacent surfaces, concealed damage, masking, paint-prep language, wall repair, or generic contractor boilerplate unless the user clearly requested it.",
    "- Use specialty-only estimate scope language, not a polished paraphrase of the source text.",
    "- If no format was requested, prefer 3 to 4 purposeful specialty scope sentences.",
    "- If bullets are requested, prefer 3 to 4 meaningful specialty bullets.",
    "- Return scope-note text only.",
  ].join("\n");

  const retryUserPrompt = [
    userPrompt,
    "",
    "Specialty retry focus:",
    `- Keep these specialty signals active: ${technicalSignals.join(" | ") || "technical route"}`,
    `- Retry reasons: ${uniqueStrings(reasons).join(" | ") || "specialty draft too thin"}`,
    "- Make the scope denser and more deliberate without turning it into commentary or fluff.",
    "- Include trade-specific execution/process detail and specialty-appropriate boundaries for the described work.",
  ].join("\n");

  return { systemPrompt: retrySystemPrompt, userPrompt: retryUserPrompt };
}

function buildSpecialtyRetryOptions(requestOptions = {}, { context = {} } = {}) {
  const baseTemperature = Number.isFinite(Number(requestOptions?.temperature)) ? Number(requestOptions.temperature) : 0.16;
  const baseTopP = Number.isFinite(Number(requestOptions?.top_p)) ? Number(requestOptions.top_p) : 0.82;
  const baseMaxTokens = Number.isFinite(Number(requestOptions?.max_tokens)) ? Number(requestOptions.max_tokens) : 520;
  const analysis = context?.scopeInputAnalysis || {};
  const shorthandTechnical = analysis?.technicalScopeCompleteness === "shorthand" || analysis?.expansionPressure === "high";

  return {
    ...requestOptions,
    temperature: shorthandTechnical ? Math.min(Math.max(baseTemperature, 0.16), 0.2) : Math.min(baseTemperature, 0.14),
    top_p: shorthandTechnical ? Math.min(Math.max(baseTopP, 0.82), 0.9) : Math.min(baseTopP, 0.78),
    max_tokens: Math.max(baseMaxTokens, shorthandTechnical ? 720 : 620),
  };
}

// Pass 16/17 — Shared specialty-trade live-path fallback hardening
const SPECIALTY_LOCAL_FALLBACK_WELDING_LABELS = {
  gtaw_tig: "TIG welding",
  gmaw_mig: "MIG welding",
  smaw_stick: "stick welding",
  fcaw: "flux-core welding",
  saw_submerged: "submerged arc welding",
  laser_welding: "laser welding",
  electron_beam_welding: "electron beam welding",
  resistance_welding: "resistance welding",
  plasma_arc_welding: "plasma arc welding",
  thermit_welding: "thermit welding",
  stud_welding: "stud welding",
  friction_welding: "friction welding",
  ultrasonic_welding: "ultrasonic welding",
  welding_generic: "welding",
};
const SPECIALTY_LOCAL_FALLBACK_IRONWORK_FAMILY_LABELS = {
  structural_steel_erection: "Structural steel erection",
  miscellaneous_metals: "Miscellaneous metals",
  reinforcing_rebar: "Reinforcing — rebar",
  bridge_ironwork: "Bridge ironwork",
  pre_engineered_metal_building: "Pre-engineered metal building",
  precast_panel_connection: "Precast panel connections",
  tank_and_specialty_erection: "Tank and specialty erection",
  metal_decking: "Metal decking",
  ornamental_ironwork: "Ornamental ironwork",
  stairs_and_rails: "Stairs and rails",
  fencing_and_gates: "Fencing and gates",
  ladders_platforms_access: "Ladders, platforms, and access",
  retrofit_rehab_modification: "Retrofit and rehabilitation",
  supports_frames_canopies: "Supports, frames, and canopies",
};
const SPECIALTY_LOCAL_FALLBACK_IRONWORK_OP_VERBS = {
  erection_placement: "erect",
  bolt_up_connections: "bolt up",
  field_weld_connections: "field weld",
  lay_place_decking: "lay",
  rigging_hoisting_signaling: "rig and hoist",
  layout_alignment: "lay out",
  shop_fabrication: "fabricate",
  reinforcing_operation: "place and tie",
  repair_retrofit_op: "repair and retrofit",
};
const SPECIALTY_LOCAL_FALLBACK_CARPENTRY_FAMILY_LABELS = {
  door_installation: "Door installation",
  formwork_concrete: "Concrete formwork",
  stair_work: "Stair work",
  sheathing_subfloor: "Sheathing and subfloor",
  rough_framing: "Rough framing",
  trim_molding: "Trim and molding",
  finish_carpentry_casework: "Finish carpentry",
  general_carpentry: "General carpentry",
};
const SPECIALTY_LOCAL_FALLBACK_CARPENTRY_OP_VERBS = {
  hang_install: "hang and install",
  frame_out: "frame out",
  trim_finish: "trim and finish",
  patch_repair: "patch and repair",
  strip_form: "strip",
  set_form: "set",
  shim_align: "shim and align",
  replace_changeout: "replace",
};
const SPECIALTY_LOCAL_FALLBACK_ROUGH_FRAMING_REGEX = /\b(?:studs?|blocking|headers?|rafters?|nailers?|ledger|rough\s+fram(?:e|ing)|wood\s+fram(?:e|ing)|lumber|cripples?|trimmers?|top\s+plate|bottom\s+plate)\b/i;

function buildSpecialtyLocalFallback(normalizedContext, rawUserInput = "") {
  const analysis = normalizedContext?.scopeInputAnalysis || {};
  const rawInput = String(rawUserInput || "").trim().slice(0, 120);

  // — Welding path —
  const weldBase = analysis?.weldingBaseProcess;
  const weldConf = analysis?.weldingConfidence;
  const weldEligible = Boolean(weldBase && (weldConf === "medium" || weldConf === "high"));
  if (weldEligible) {
    const secondary = analysis?.weldingSecondaryTags || [];
    const material = analysis?.weldingMaterialContext || [];
    const bias = analysis?.weldingScopeBias || [];
    const baseLabel = SPECIALTY_LOCAL_FALLBACK_WELDING_LABELS[weldBase] || weldBase.replace(/_/g, " ");
    const prefix = secondary.includes("orbital_welding")
      ? "Orbital "
      : secondary.includes("sanitary_tube_welding")
        ? "Sanitary tube "
        : "";
    const header = `${prefix}${baseLabel}`;

    const bodyParts = [];
    const objectParts = [];
    if (material.includes("gas_panel") || secondary.includes("gas_panel_welding")) objectParts.push("gas panels");
    if (material.includes("quarter_inch_tubing")) objectParts.push("1/4-inch tubing");
    else if (secondary.includes("tube_welding_application") && !objectParts.length) objectParts.push("tubing");
    // Preserve generic context words (e.g. "lines") rather than dropping them
    if (material.includes("line_connections") && !objectParts.length) objectParts.push("line connections");
    if (objectParts.length) {
      const actionVerb = bias.includes("install_oriented") ? "install" : bias.includes("configure") ? "configure" : "weld";
      bodyParts.push(`${actionVerb} ${objectParts.join(", ")}`);
    } else {
      bodyParts.push(`perform ${header.toLowerCase()} work`);
    }
    if (material.includes("stainless") && !objectParts.some((p) => p.includes("stainless"))) bodyParts.push("stainless material");
    if (secondary.includes("backpurge_welding")) bodyParts.push("purge-controlled process");
    else if (secondary.includes("pulse_mode_welding")) bodyParts.push("pulse mode");
    console.log(`[specialty_local_fallback] trade=welding input="${rawInput}" base=${weldBase} conf=${weldConf} secondary=[${secondary.join(",")}] material=[${material.join(",")}] fallback_used=true`);
    return { scopeNotes: `${header} — ${bodyParts.join("; ")}.` };
  }

  // — Ironwork path —
  const iwFamily = analysis?.ironworkTradeFamily;
  const iwConf = analysis?.ironworkConfidence;
  const iwEligible = Boolean(iwFamily && (iwConf === "medium" || iwConf === "high"));
  if (iwEligible) {
    const ops = analysis?.ironworkOperationTags || [];
    const objs = analysis?.ironworkObjectTags || [];
    const bias = analysis?.ironworkScopeBias || [];
    const familyLabel = SPECIALTY_LOCAL_FALLBACK_IRONWORK_FAMILY_LABELS[iwFamily] || iwFamily.replace(/_/g, " ");
    const opVerbs = ops.slice(0, 2).map((op) => SPECIALTY_LOCAL_FALLBACK_IRONWORK_OP_VERBS[op] || op.replace(/_/g, " ")).filter(Boolean);
    const objPhrase = objs.slice(0, 3).map((o) => o.replace(/_/g, " ")).join(", ");
    const bodyParts = [];
    if (opVerbs.length && objPhrase) bodyParts.push(`${opVerbs.join(" and ")} ${objPhrase}`);
    else if (opVerbs.length) bodyParts.push(opVerbs.join(" and "));
    else if (objPhrase) bodyParts.push(`install ${objPhrase}`);
    if (bias.includes("canopy_context") && !objPhrase.includes("canopy")) bodyParts.push("at canopy frame");
    else if (bias.includes("bridge_heavy")) bodyParts.push("at bridge structure");
    else if (bias.includes("tank_context")) bodyParts.push("at tank shell");
    const noteText = bodyParts.length
      ? `${familyLabel} — ${bodyParts.join("; ")}.`
      : `${familyLabel} — complete ironwork scope as described.`;
    console.log(`[specialty_local_fallback] trade=ironwork input="${rawInput}" family=${iwFamily} conf=${iwConf} ops=[${ops.join(",")}] objs=[${objs.join(",")}] fallback_used=true`);
    return { scopeNotes: noteText };
  }

  // — Carpentry path (normalized) —
  const carpFamily = analysis?.carpentryTradeFamily;
  const carpConf = analysis?.carpentryConfidence;
  const carpEligible = Boolean(carpFamily && (carpConf === "medium" || carpConf === "high"));
  if (carpEligible) {
    const ops = analysis?.carpentryOperationTags || [];
    const objs = analysis?.carpentryObjectTags || [];
    const familyLabel = SPECIALTY_LOCAL_FALLBACK_CARPENTRY_FAMILY_LABELS[carpFamily] || carpFamily.replace(/_/g, " ");
    const opVerbs = ops.slice(0, 2).map((op) => SPECIALTY_LOCAL_FALLBACK_CARPENTRY_OP_VERBS[op] || op.replace(/_/g, " ")).filter(Boolean);
    const objPhrase = objs.slice(0, 3).map((o) => o.replace(/_/g, " ")).join(", ");
    const bodyParts = [];
    if (opVerbs.length && objPhrase) bodyParts.push(`${opVerbs.join(" and ")} ${objPhrase}`);
    else if (opVerbs.length) bodyParts.push(opVerbs.join(" and "));
    else if (objPhrase) bodyParts.push(`install ${objPhrase}`);
    const noteText = bodyParts.length
      ? `${familyLabel} — ${bodyParts.join("; ")}.`
      : `${familyLabel} — complete carpentry scope as described.`;
    console.log(`[specialty_local_fallback] trade=carpentry input="${rawInput}" family=${carpFamily} conf=${carpConf} ops=[${ops.join(",")}] objs=[${objs.join(",")}] fallback_used=true`);
    return { scopeNotes: noteText };
  }

  // — Carpentry lightweight path (raw text scan for rough framing without normalized gate) —
  const rawText = analysis?.rawScopeText || rawUserInput;
  const tradeBucket = analysis?.scopeTradeBucket || "";
  if (SPECIALTY_LOCAL_FALLBACK_ROUGH_FRAMING_REGEX.test(rawText)) {
    const actions = analysis?.actions || [];
    const items = analysis?.items || [];
    const carpItems = items.filter((i) => SPECIALTY_LOCAL_FALLBACK_ROUGH_FRAMING_REGEX.test(i)).slice(0, 3);
    const actionVerb = actions.includes("install") ? "install" : actions[0] || "install";
    const bodyPhrase = carpItems.length ? `${actionVerb} ${carpItems.join(", ")}` : `${actionVerb} required framing components`;
    console.log(`[specialty_local_fallback] trade=carpentry/lightweight input="${rawInput}" fallback_used=true`);
    return { scopeNotes: `Rough framing — ${bodyPhrase}.` };
  }
  if (tradeBucket === "finish_carpentry") {
    const actions = analysis?.actions || [];
    const items = analysis?.items || [];
    const actionVerb = actions.includes("install") ? "install" : actions.includes("replace") ? "replace" : actions[0] || "install";
    const objectPhrase = items.slice(0, 3).join(", ") || "finish carpentry components";
    console.log(`[specialty_local_fallback] trade=finish-carpentry/lightweight input="${rawInput}" fallback_used=true`);
    return { scopeNotes: `Finish carpentry — ${actionVerb} ${objectPhrase}.` };
  }

  // Pass 20: raw-text scan when scopeInputAnalysis is absent/incomplete.
  // Guards against the case where normalizedContext.scopeInputAnalysis was not serialized
  // from the client (e.g. large context pruned) but rawUserInput still carries the signal.
  // Only fires when the analysis-based checks above all returned false.
  if (rawInput && !weldEligible && !iwEligible && !carpEligible) {
    const rawLower = rawInput.toLowerCase();
    // Orbital weld / TIG weld shorthand — "orbital weld", "orbital weld lines", "orbital tig"
    if (/\borbital\s+(?:weld(?:ing)?|tig|gtaw|lines?|head)\b/i.test(rawInput)
      || (/\borbital\b/i.test(rawInput) && /\bweld(?:ing)?\b/i.test(rawInput))) {
      const hasLines = /\blines?\b/i.test(rawInput);
      const hasStainless = /\bstainless\b/i.test(rawInput);
      const objectPhrase = hasLines ? "line connections" : hasStainless ? "stainless material" : null;
      const body = objectPhrase ? `weld ${objectPhrase}` : "perform orbital TIG welding work";
      const note = `Orbital TIG welding — ${body}.`;
      console.log(`[specialty_local_fallback] trade=welding_raw_scan branch=orbital_weld input="${rawInput}" note_len=${note.length} fallback_used=true`);
      return { scopeNotes: note };
    }
    // Generic weld with material signal — at least a weld verb + a recognizable material
    if (/\bweld(?:ing|ed)?\b/i.test(rawInput) && /\bstainless\b|\bcarbon\s+steel\b|\bchrome\s+moly\b|\btitanium\b|\btubing\b|\bpipe\b/i.test(rawInput)) {
      const note = "Welding — weld identified material per trade scope.";
      console.log(`[specialty_local_fallback] trade=welding_raw_scan branch=generic_weld_with_material input="${rawInput}" note_len=${note.length} fallback_used=true`);
      return { scopeNotes: note };
    }
  }

  console.log(`[specialty_local_fallback] no_specialty_match input="${rawInput}" weld_eligible=${weldEligible} ironwork_eligible=${iwEligible} carpentry_eligible=${carpEligible} fallback_used=false`);
  return null;
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

function toNumOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBoolOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v;
  const s = String(v).trim().toLowerCase();
  if (["true","yes","y","yeah","yep","si"].includes(s)) return true;
  if (["false","no","n","nah","nope"].includes(s)) return false;
  return null;
}

function roundUpToQuarterHour(hours) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.ceil(h * 4) / 4;
}
function ceil(n) {
  const x = Number(n);
  if (!Number.isFinite(x) || x <= 0) return 0;
  return Math.ceil(x);
}

/**
 * Hard sanitize to our schema no matter what:
 * trade, scopeType, rooms, sqft, stories, ceilingHeightFt, coats, prep,
 * includeCeilings, includeTrimDoors, needForeman
 */
function sanitizeState(raw) {
  const p = raw && typeof raw === "object" ? raw : {};

  const out = {
    trade: "painting",
    scopeType: null,
    scopeBasis: null, // "rooms" | "sqft" (interior only)
    rooms: null,
    sqft: null,
    stories: null,
    ceilingHeightFt: null,
    coats: null,
    prep: null,
    includeCeilings: null,
    includeTrimDoors: null,
    needForeman: null,
  };

  if (typeof p.scopeType === "string") {
    const s = p.scopeType.trim().toLowerCase();
    out.scopeType = (s === "interior" || s === "exterior") ? s : null;
  }

if (typeof p.scopeBasis === "string") {
  const b = p.scopeBasis.trim().toLowerCase();
  out.scopeBasis = (b === "rooms" || b === "sqft") ? b : null;
}


  // rooms MUST be number or null (never array/object)
  const rn = toNumOrNull(p.rooms);
  out.rooms = rn && rn > 0 ? rn : null;

  out.sqft = toNumOrNull(p.sqft);
  out.stories = toNumOrNull(p.stories);
  out.ceilingHeightFt = toNumOrNull(p.ceilingHeightFt);
  out.coats = toNumOrNull(p.coats);

  if (typeof p.prep === "string") {
    const pr = p.prep.trim().toLowerCase();
    out.prep = ["light","medium","heavy"].includes(pr) ? pr : null;
  }

  out.includeCeilings = toBoolOrNull(p.includeCeilings);
  out.includeTrimDoors = toBoolOrNull(p.includeTrimDoors);
  out.needForeman = toBoolOrNull(p.needForeman);

  return out;
}

function mergePatch(base, patch) {
  const out = { ...(base || {}) };
  for (const k of Object.keys(patch || {})) {
    const v = patch[k];
    if (v !== null && v !== undefined && v !== "") out[k] = v;
  }
  return out;
}


function isVagueStarterMessage(message) {
  const s = String(message || "").trim().toLowerCase();
  if (!s) return true;
  // Very short or generic prompts that should trigger onboarding instead of guardrail interrogation.
  if (s.length <= 8) return true;
  return (
    s === "help" ||
    s === "start" ||
    s === "hi" ||
    s === "hello" ||
    s === "yo" ||
    s === "sup" ||
    s.includes("what do i do") ||
    s.includes("what should i do") ||
    s.includes("how do i start") ||
    s.includes("where do i start")
  );
}

function onboardingQuestion(lang) {
  const language = lang === "es" ? "es" : "en";
  return language === "es"
    ? "Dime qué quieres estimar y un dato de tamaño. Ejemplos: \"pintura interior 3 cuartos\" o \"casa exterior 2000 sqft\". (También puedo hacer solo paredes o paredes+techos)."
    : "Tell me what you’re estimating and one size clue. Examples: \"interior paint 3 rooms\" or \"exterior house 2000 sqft\". (I can do walls only or walls+ceilings.)";
}

function describeValue(key, val, lang) {
  const language = lang === "es" ? "es" : "en";
  if (val === null || val === undefined || val === "") return "";
  const v = val;
  const num = toNumOrNull(v);
  if (key === "scopeType") return language === "es" ? (v === "interior" ? "interior" : "exterior") : v;
  if (key === "rooms" && num !== null) return language === "es" ? `${num} cuartos` : `${num} room${num === 1 ? "" : "s"}`;
  if (key === "sqft" && num !== null) return language === "es" ? `${num} sqft aprox.` : `~${num} sqft`;
  if (key === "stories" && num !== null) return language === "es" ? `${num} piso${num === 1 ? "" : "s"}` : `${num} stor${num === 1 ? "y" : "ies"}`;
  if (key === "coats" && num !== null) return language === "es" ? `${num} capa${num === 1 ? "" : "s"}` : `${num} coat${num === 1 ? "" : "s"}`;
  if (key === "ceilingHeightFt" && num !== null) return language === "es" ? `${num} ft de altura` : `${num}ft ceilings`;
  if (key === "prep" && typeof v === "string") return language === "es" ? `prep ${v}` : `${v} prep`;
  if (key === "includeCeilings" && typeof v === "boolean") return language === "es" ? (v ? "incluye techos" : "sin techos") : (v ? "including ceilings" : "no ceilings");
  if (key === "includeTrimDoors" && typeof v === "boolean") return language === "es" ? (v ? "incluye molduras/puertas" : "sin molduras/puertas") : (v ? "including trim/doors" : "no trim/doors");
  if (key === "needForeman" && typeof v === "boolean") return language === "es" ? (v ? "con capataz" : "sin capataz") : (v ? "with foreman" : "no foreman");
  if (key === "scopeBasis" && typeof v === "string") return language === "es" ? `usar ${v}` : `use ${v}`;
  return String(v);
}

function humanAsk(key, state, lang) {
  const language = lang === "es" ? "es" : "en";
  const s = sanitizeState(state || {});
  // Short, non-scripted prompts with examples.
  if (key === "scopeType") return onboardingQuestion(lang);
  if (key === "scopeBasis") {
    return language === "es"
      ? "Tengo cuartos y pies cuadrados. ¿Cuál prefieres usar para calcular? Responde: rooms o sqft."
      : "I’ve got rooms and square feet. Which should I use to calculate? Reply: rooms or sqft.";
  }
  if (key === "rooms") {
    return language === "es"
      ? "¿Cuántos cuartos/habitaciones vas a pintar? (ej: 3)"
      : "How many rooms are you painting? (ex: 3)";
  }
  if (key === "sqft") {
    return language === "es"
      ? "¿Aproximadamente cuántos pies cuadrados? (un número rápido está bien)"
      : "Roughly how many square feet? (a quick number is fine)";
  }
  if (key === "stories") {
    return language === "es" ? "¿Cuántos pisos? (1, 2, 3+)" : "How many stories? (1, 2, 3+)";
  }
  if (key === "ceilingHeightFt") {
    return language === "es" ? "¿Altura del techo en pies? (8, 9, 10)" : "Ceiling height in feet? (8, 9, 10)";
  }
  if (key === "coats") {
    return language === "es" ? "¿Cuántas capas/manos? (1, 2, 3)" : "How many coats? (1, 2, 3)";
  }
  if (key === "prep") {
    return language === "es"
      ? "¿Qué nivel de preparación? (light / medium / heavy)"
      : "Prep level? (light / medium / heavy)";
  }
  if (key === "includeCeilings") {
    return language === "es" ? "¿Incluimos techos? (sí/no)" : "Include ceilings? (yes/no)";
  }
  if (key === "includeTrimDoors") {
    return language === "es" ? "¿Incluimos molduras y puertas? (sí/no)" : "Include trim and doors? (yes/no)";
  }
  if (key === "needForeman") {
    return language === "es" ? "¿Quieres capataz/foreman en este trabajo? (sí/no)" : "Do you want a foreman on this job? (yes/no)";
  }
  return language === "es" ? "Dame un poco más de detalle." : "Give me a bit more detail.";
}

function withAck(nextQuestion, filledKey, filledVal, lang) {
  const language = lang === "es" ? "es" : "en";
  if (!nextQuestion) return "";
  if (!filledKey) return nextQuestion;
  const dv = describeValue(filledKey, filledVal, lang);
  if (!dv) return nextQuestion;
  const ack = language === "es" ? `Perfecto — ${dv}. ` : `Got it — ${dv}. `;
  return ack + nextQuestion;
}


function isUnsure(message) {
  const s = String(message || "").trim().toLowerCase();
  return (
    s === "idk" || s === "i dunno" || s === "dont know" || s === "don't know" ||
    s === "not sure" || s === "unsure" || s === "no idea" || s === "whatever" ||
    s === "you decide" || s === "up to you"
  );
}

function soften(question, lang) {
  const language = lang === "es" ? "es" : "en";
  if (!question) return "";
  // Make it feel like a person, not a checklist.
  if (language === "es") {
    return `Ok — ${question}`;
  }
  return `Alright — ${question}`;
}

function oneLinerStatus(state, lang) {
  const language = lang === "es" ? "es" : "en";
  const s = sanitizeState(state || {});
  const bits = [];
  if (s.scopeType) bits.push(s.scopeType);
  if (s.scopeBasis) bits.push(`basis ${s.scopeBasis}`);
  if (s.rooms) bits.push(`${s.rooms} rooms`);
  if (s.sqft) bits.push(`~${s.sqft} sqft`);
  if (s.stories) bits.push(`${s.stories} stories`);
  if (s.coats) bits.push(`${s.coats} coats`);
  if (s.prep) bits.push(`${s.prep} prep`);
  if (typeof s.includeCeilings === "boolean") bits.push(s.includeCeilings ? "ceilings" : "no ceilings");
  if (typeof s.includeTrimDoors === "boolean") bits.push(s.includeTrimDoors ? "trim/doors" : "no trim/doors");
  if (typeof s.needForeman === "boolean") bits.push(s.needForeman ? "foreman" : "no foreman");
  if (!bits.length) return "";
  if (language === "es") return `Lo que tengo: ${bits.join(" • ")}.`;
  return `What I have: ${bits.join(" • ")}.`;
}

function defaultForMissing(key, lang) {
  const language = lang === "es" ? "es" : "en";
  // Safe-ish defaults used ONLY when user says "idk / not sure".
  if (key === "coats") return 2;
  if (key === "prep") return "light";
  if (key === "includeCeilings") return false;
  if (key === "includeTrimDoors") return true;
  if (key === "needForeman") return false;
  if (key === "ceilingHeightFt") return 8;
  if (key === "stories") return 1;
  // sqft/rooms should not be defaulted silently
  return null;
}

function applyUnsureDefault(state, missingKey, lang) {
  const s = sanitizeState(state || {});
  const d = defaultForMissing(missingKey, lang);
  if (d === null || d === undefined) return { state: s, applied: false };
  s[missingKey] = d;
  return { state: s, applied: true };
}


/**
 * FAST RULE PARSER (instant, no model):
 * Pulls out common estimate phrases.
 */
function ruleParseMessage(message, currentState) {
  const msg = String(message || "").toLowerCase();
  const rawTrim = String(message || "").trim();
  const patch = {};

  const cur = sanitizeState(currentState || {});
  const numOnly = rawTrim.match(/^\s*(\d+(?:\.\d+)?)\s*$/);
  const numVal = numOnly ? Number(numOnly[1]) : null;

  // =========================================================
  // ZERO-AMBIGUITY NUMERIC REPLIES (context-aware)
  // If the user replies with ONLY a number, treat it as the
  // next required field (first missing key) whenever possible.
  // =========================================================
  if (numVal !== null && Number.isFinite(numVal)) {
    try {
      const guarded = applyGuardrailsAndNextQuestion(cur, "en");
      const missing = Array.isArray(guarded?.missing) ? guarded.missing : [];
      const targetField = missing.length ? String(missing[0]) : "";

      // Only map numeric-only replies to numeric fields.
      if (targetField === "rooms" && numVal > 0) {
        patch.rooms = numVal;
      } else if (targetField === "sqft" && numVal > 0) {
        patch.sqft = numVal;
      } else if (targetField === "stories" && numVal > 0) {
        patch.stories = numVal;
      } else if (targetField === "coats" && numVal > 0) {
        patch.coats = numVal;
      } else if (targetField === "ceilingHeightFt" && numVal > 0) {
        patch.ceilingHeightFt = numVal;
      }

      if (Object.keys(patch).length) {
        patch.trade = "painting";
        return sanitizeState(patch);
      }
    } catch {
      // ignore
    }
  }

  // ============================
  // NORMAL RULE PARSER
  // ============================

  if (/\bexterior\b/.test(msg) || /\boutside\b/.test(msg)) patch.scopeType = "exterior";
  if (/\binterior\b/.test(msg) || /\binside\b/.test(msg)) patch.scopeType = "interior";

  // Basis preference when both rooms + sqft exist (interior): user can force which to use.
  if (/\b(use|prefer|basis)\s+(rooms?)\b/.test(msg) || /\brooms?\s+(only|basis)\b/.test(msg)) patch.scopeBasis = "rooms";
  if (msg.trim() === "rooms" || msg.trim() === "room") patch.scopeBasis = "rooms";

  if (/\b(use|prefer|basis)\s+(sq\s*ft|sqft|sf|square\s*feet)\b/.test(msg) || /\b(sq\s*ft|sqft|sf|square\s*feet)\s+(only|basis)\b/.test(msg)) patch.scopeBasis = "sqft";
  if (["sqft","sf","square feet","squarefeet","sq ft"].includes(msg.trim())) patch.scopeBasis = "sqft";

  const sqftMatch = msg.match(/(\d{1,3}(?:,\d{3})+|\d+)\s*(sq\s*ft|sqft|square\s*feet|sf)\b/);
  if (sqftMatch) patch.sqft = Number(String(sqftMatch[1]).replace(/,/g, ""));

  const storyMatch = msg.match(/(\d+)\s*(story|stories)\b/);
  if (storyMatch) patch.stories = Number(storyMatch[1]);
  if (!patch.stories) {
    if (/\bone[-\s]?story\b/.test(msg)) patch.stories = 1;
    if (/\btwo[-\s]?story\b/.test(msg)) patch.stories = 2;
    if (/\bthree[-\s]?story\b/.test(msg)) patch.stories = 3;
  }

  const coatMatch = msg.match(/(\d+)\s*(coat|coats)\b/);
  if (coatMatch) patch.coats = Number(coatMatch[1]);
  if (!patch.coats) {
    if (/\bone\s+coat\b/.test(msg)) patch.coats = 1;
    if (/\btwo\s+coats\b/.test(msg)) patch.coats = 2;
    if (/\bthree\s+coats\b/.test(msg)) patch.coats = 3;
  }

  if (/\blight\s+prep\b/.test(msg) || /\bminor\s+prep\b/.test(msg)) patch.prep = "light";
  if (/\bmedium\s+prep\b/.test(msg) || /\bmoderate\s+prep\b/.test(msg)) patch.prep = "medium";
  if (/\bheavy\s+prep\b/.test(msg) || /\bmajor\s+prep\b/.test(msg)) patch.prep = "heavy";

  if (/\b(include|with)\s+(trim|doors|trim\s*and\s*doors)\b/.test(msg)) patch.includeTrimDoors = true;
  if (/\b(no|exclude|without)\s+(trim|doors|trim\s*and\s*doors)\b/.test(msg)) patch.includeTrimDoors = false;

  // Foreman detection (handles: "foreman no", "foreman: yes", "foreman = no", "no foreman", etc.)
  const fm = msg.match(/\bforeman\s*(?:[:=]|\s)\s*(yes|no)\b/);
  if (fm) patch.needForeman = fm[1] === "yes";

  if (/\bneed\s+a\s+foreman\b/.test(msg) || /\bwith\s+foreman\b/.test(msg)) patch.needForeman = true;
  if (/\bno\s+foreman\b/.test(msg) || /\bwithout\s+foreman\b/.test(msg)) patch.needForeman = false;

  const roomsMatch = msg.match(/(\d+)\s*(rooms|room|bedrooms|bedroom)\b/);
  if (roomsMatch) patch.rooms = Number(roomsMatch[1]);

  if (/\b(include|with)\s+ceilings?\b/.test(msg)) patch.includeCeilings = true;
  if (/\b(no|exclude|without)\s+ceilings?\b/.test(msg)) patch.includeCeilings = false;

  const ch = msg.match(/(\d+(?:\.\d+)?)\s*(ft|feet)\s*(ceiling|ceilings)\b/);
  if (ch) patch.ceilingHeightFt = Number(ch[1]);

  patch.trade = "painting";
  return sanitizeState(patch);
}

function applyGuardrailsAndNextQuestion(state, lang) {
  const language = lang === "es" ? "es" : "en";
  const s = sanitizeState(state);

  if (!s.scopeType) {
    return {
      state: s,
      missing: ["scopeType"],
      nextQuestion: humanAsk("scopeType", current, lang),
    };
  }

  if (s.scopeType === "exterior") {
    s.rooms = null;
    s.includeCeilings = null;
    s.ceilingHeightFt = null;

    if (!s.stories) {
  return {
    state: s,
    missing: ["stories"],
    nextQuestion: humanAsk("stories", s, lang),
  };
}
if (!s.sqft) {
  return {
    state: s,
    missing: ["sqft"],
    nextQuestion: humanAsk("sqft", s, lang),
  };
}

    if (!s.coats) {
      return {
        state: s,
        missing: ["coats"],
        nextQuestion: humanAsk("coats", s, lang),
      };
    }
    if (!s.prep) {
      return {
        state: s,
        missing: ["prep"],
        nextQuestion: humanAsk("prep", s, lang),
      };
    }
    if (s.includeTrimDoors === null) {
      return {
        state: s,
        missing: ["includeTrimDoors"],
        nextQuestion: humanAsk("includeTrimDoors", s, lang),
      };
    }
    if (s.needForeman === null) {
      return {
        state: s,
        missing: ["needForeman"],
        nextQuestion: humanAsk("needForeman", s, lang),
      };
    }
    return { state: s, missing: [], nextQuestion: "" };
  }

  const hasRooms = !!s.rooms;
  const hasSqft = !!s.sqft;

if (s.scopeType === "interior" && hasRooms && hasSqft && !s.scopeBasis) {
  return {
    state: s,
    missing: ["scopeBasis"],
    nextQuestion: humanAsk("scopeBasis", s, lang),
  };
}

  if (!hasRooms && !hasSqft) {
    return {
      state: s,
      missing: ["rooms"],
      nextQuestion: humanAsk("rooms", s, lang),
    };
  }
  if (!s.coats) {
    return {
      state: s,
      missing: ["coats"],
      nextQuestion: language === "es" ? "¿Cuántas manos/capas? (1, 2, 3)" : "How many coats? (1, 2, 3)",
    };
  }
  if (!s.prep) {
    return {
      state: s,
      missing: ["prep"],
      nextQuestion: language === "es"
        ? "¿Preparación: ligera, media o pesada?"
        : "Prep level: light, medium, or heavy?",
    };
  }
  if (s.includeCeilings === null) {
    return {
      state: s,
      missing: ["includeCeilings"],
      nextQuestion: humanAsk("includeCeilings", s, lang),
    };
  }
  if (hasRooms && !s.ceilingHeightFt) {
    return {
      state: s,
      missing: ["ceilingHeightFt"],
      nextQuestion: humanAsk("ceilingHeightFt", s, lang),
    };
  }
  if (s.includeTrimDoors === null) {
    return {
      state: s,
      missing: ["includeTrimDoors"],
      nextQuestion: language === "es" ? "¿Incluir molduras/puertas? (sí/no)" : "Include trim and doors? (yes/no)",
    };
  }
  if (s.needForeman === null) {
    return {
      state: s,
      missing: ["needForeman"],
      nextQuestion: language === "es"
        ? "¿Necesitas capataz/foreman? (sí/no)"
        : "Do you need a foreman on this job? (yes/no)",
    };
  }

  return { state: s, missing: [], nextQuestion: "" };
}

function computePaintingDraftPlan(state) {
  const s = sanitizeState(state);

  const scope = s.scopeType;
  const coats = toNumOrNull(s.coats) || 1;
  const stories = toNumOrNull(s.stories) || 1;
  const prep = s.prep || "light";

  const prepMultMap = { light: 1.0, medium: 1.25, heavy: 1.55 };
  const prepMult = prepMultMap[prep] || 1.0;
  const coatMult = 1 + 0.75 * (coats - 1);

  let effectiveSqft = null;
  let trimHours = 0;
  let ceilingAddon = 0;
  let baseRate = 0;
  let storyMult = 1.0;

  const notes = [];

  if (scope === "interior") {
    const sqft = toNumOrNull(s.sqft);
    const rooms = toNumOrNull(s.rooms);
    const includeCeilings = s.includeCeilings === true;
    const ceilingHeightFt = toNumOrNull(s.ceilingHeightFt);
// Interior effective sqft selection:
// - If scopeBasis is set, honor it.
// - Otherwise: rooms -> sqft (legacy).
if (s.scopeBasis === "sqft" && sqft) {
  effectiveSqft = sqft;
} else if ((s.scopeBasis === "rooms" || !s.scopeBasis) && rooms) {
  const sqftPerRoomWalls = 400;
  const ceilingSqftPerRoom = 150;
  const heightFactor = ceilingHeightFt && ceilingHeightFt > 0 ? ceilingHeightFt / 8 : 1;

  const wallsSqft = rooms * sqftPerRoomWalls * heightFactor;
  const ceilingsSqft = includeCeilings ? rooms * ceilingSqftPerRoom : 0;
  effectiveSqft = wallsSqft + ceilingsSqft;

  notes.push("Interior sqft estimated from rooms (v1 defaults).");
  if (!ceilingHeightFt) notes.push("Ceiling height not provided; assumed 8ft for room-to-sqft conversion.");
} else if (sqft) {
  effectiveSqft = sqft;
}


    baseRate = 160;

    if (s.includeTrimDoors === true) {
      if (rooms) trimHours = rooms * 0.75;
      else trimHours = Math.max(2, (effectiveSqft || 0) / 1000 * 2.5);
    }

    if (includeCeilings) ceilingAddon = rooms ? rooms * 0.25 : Math.max(0.5, (effectiveSqft || 0) / 2000);

  } else if (scope === "exterior") {
    effectiveSqft = toNumOrNull(s.sqft);
    baseRate = 120;

    if (stories === 1) storyMult = 1.0;
    else if (stories === 2) storyMult = 1.2;
    else if (stories >= 3) storyMult = 1.35;

    if (s.includeTrimDoors === true) {
      trimHours = Math.max(2, (effectiveSqft || 0) / 1000 * 3.0);
    }
  } else {
    return null;
  }

  if (!effectiveSqft || !Number.isFinite(effectiveSqft) || effectiveSqft <= 0) return null;

  let painterHours = (effectiveSqft / baseRate) * coatMult * prepMult;
  if (scope === "exterior") painterHours *= storyMult;
  painterHours += trimHours + ceilingAddon;
  painterHours = roundUpToQuarterHour(painterHours);

  let foremanHours = 0;
  if (s.needForeman === true) {
    foremanHours = Math.max(4, painterHours * 0.15);
    foremanHours = roundUpToQuarterHour(foremanHours);
  }

  const COVERAGE = 350;
  const WASTE = 1.15;

  const paintGallons = ceil((effectiveSqft * coats) / COVERAGE * WASTE);

  let primerGallons = 0;
  if (prep === "medium" || prep === "heavy") {
    primerGallons = ceil((effectiveSqft * 0.6) / COVERAGE * WASTE);
  }

  let consumables = effectiveSqft * 0.08;
  if (prep === "medium") consumables *= 1.15;
  if (prep === "heavy") consumables *= 1.3;
  consumables = Math.round(consumables);

  return {
    effectiveSqft: Math.round(effectiveSqft),
    labor: [
      { role: "Painter", hours: painterHours },
      ...(foremanHours > 0 ? [{ role: "Foreman", hours: foremanHours }] : []),
    ],
    materials: [
      { name: "Paint", qty: paintGallons, unit: "gallon" },
      ...(primerGallons > 0 ? [{ name: "Primer", qty: primerGallons, unit: "gallon" }] : []),
      { name: "Consumables allowance", qty: consumables, unit: "USD" },
    ],
    notes,
  };
}



function planToFpeDraft(draftPlan, patch, lang) {
  if (!draftPlan || typeof draftPlan !== "object") return null;

  // Match FPE's exact line shapes:
  // newLaborLine(): { label:"", hours:"", rate:"", internalRate:"", qty: 1 }
  // newMaterialItem(): { desc:"", qty: 1, cost:"", charge:"" }

  const laborLines = Array.isArray(draftPlan.labor)
    ? draftPlan.labor.map((l) => {
        const role = String(l?.role || "").trim();
        const hoursNum = toNumOrNull(l?.hours);
        return {
          label: role,
          hours: hoursNum === null ? "" : String(hoursNum),
          rate: "",
          internalRate: "",
          qty: 1,
        };
      })
    : [];

  const materialLines = Array.isArray(draftPlan.materials)
    ? draftPlan.materials.map((m) => {
        const name = String(m?.name || "").trim();
        const qtyNum = toNumOrNull(m?.qty);

        // If this is an allowance in USD, set charge to the allowance amount (qty is 1).
        const unit = String(m?.unit || "").trim();
        if (unit.toUpperCase() === "USD") {
          return {
            desc: name,
            qty: 1,
            cost: "",
            charge: qtyNum === null ? "" : String(qtyNum),
          };
        }

        return {
          desc: name,
          qty: qtyNum === null ? 1 : qtyNum,
          cost: "",
          charge: "",
        };
      })
    : [];

  const language = lang === "es" ? "es" : "en";
  const planMeta = {
    trade: patch?.trade || "painting",
    scopeType: patch?.scopeType || null,
    effectiveSqft: toNumOrNull(draftPlan.effectiveSqft) || null,
  };

  const summaryText =
    language === "es"
      ? `Borrador AI: ${planMeta.trade} ${planMeta.scopeType || ""} — ${planMeta.effectiveSqft || ""} sqft aprox.`
      : `AI draft: ${planMeta.trade} ${planMeta.scopeType || ""} — ~${planMeta.effectiveSqft || ""} sqft.`;

  return {
    meta: planMeta,
    summaryText,
    laborLines,
    materialLines,
    notes: Array.isArray(draftPlan.notes) ? draftPlan.notes : [],
  };
}

async function llmFallback(message, state, lang, missingHint, trace = null) {
  const language = lang === "es" ? "es" : "en";

  const system = `You extract estimate fields for PAINTING.
Return ONLY JSON with exact shape:
{"patch":{"trade":"painting","scopeType":null,"scopeBasis":null,"rooms":null,"sqft":null,"stories":null,"ceilingHeightFt":null,"coats":null,"prep":null,"includeCeilings":null,"includeTrimDoors":null,"needForeman":null}}
No other keys. rooms must be a NUMBER or null (never array/object).`;

  const prompt = `${system}
Lang:${language}
Missing:${JSON.stringify(missingHint || [])}
  Current:${JSON.stringify(state || {})}
User:${String(message || "")}
`;
  try {
    trace?.step("provider_start", { provider: "ollama", path: "/api/generate", attempted: "yes" });
    const r = await fetchWithTimeout(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      format: "json",
      stream: false,
      keep_alive: "10m",
      options: { temperature: 0, num_predict: 70, num_ctx: 512 },
      stop: ["\n\n"],
    }),
  }, OLLAMA_TIMEOUT_MS);

    if (!r.ok) {
      trace?.step("provider_end", { provider: "ollama", path: "/api/generate", outcome: `http_${r.status}` });
      return null;
    }
  const data = await r.json();
  trace?.step("provider_end", { provider: "ollama", path: "/api/generate", outcome: "ok" });
  const raw = String(data?.response || "").trim();
  const parsed = extractJsonPayload(raw);
  if (!parsed || typeof parsed !== "object") return null;

  const patch = sanitizeState(parsed.patch || parsed);
  return { patch, _raw: raw };
  } catch (e) {
    trace?.step("provider_end", { provider: "ollama", path: "/api/generate", outcome: "error" });
    return null;
  }
}

function normalizeLooseGuidedText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countGuidedWords(value) {
  return normalizeLooseGuidedText(value).split(" ").filter(Boolean).length;
}

function guidedTextHasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function guidedTextHasCommercialSignal(text) {
  return guidedTextHasAny(text, [
    /\boffice\b/,
    /\bsuite\b/,
    /\bhallway\b/,
    /\btenant improvement\b/,
    /\bti cleanup\b/,
    /\bwarehouse\b/,
    /\bcommercial\b/,
    /\bbuild[-\s]?out\b/,
  ]);
}

function guidedTextHasWarehouseSignal(text) {
  return guidedTextHasAny(text, [
    /\bwarehouse\b/,
    /\bdistribution\b/,
    /\bstorage\b/,
    /\blogistics\b/,
    /\bdock\b/,
  ]);
}

function guidedTextHasOfficeSuiteSignal(text) {
  return guidedTextHasAny(text, [
    /\boffice\b/,
    /\bsuite\b/,
    /\bhallway\b/,
    /\btenant improvement\b/,
    /\bti cleanup\b/,
    /\bbuild[-\s]?out\b/,
  ]);
}

function guidedTextHasFlooringSignal(text) {
  return guidedTextHasAny(text, [
    /\bfloor(?:ing|s)?\b/,
    /\blvp\b/,
    /\blvt\b/,
    /\bvinyl plank\b/,
    /\bluxury vinyl\b/,
    /\blaminate\b/,
    /\btile\b/,
    /\bcarpet\b/,
    /\btransitions?\b/,
    /\bsubfloor\b/,
  ]);
}

function guidedTextHasDrywallSignal(text) {
  return guidedTextHasAny(text, [
    /\bdrywall\b/,
    /\bsheetrock\b/,
    /\btexture\b/,
    /\bopened walls?\b/,
    /\bcut open\b/,
    /\bplumbing opened\b/,
    /\bmud\b/,
    /\btape\b/,
    /\bpatch(?:ing|es)?\b/,
  ]);
}

function guidedTextHasExteriorAccessSignal(text) {
  return guidedTextHasAny(text, [
    /\btwo story\b/,
    /\b2 story\b/,
    /\bladder\b/,
    /\blift\b/,
    /\bscaffold\b/,
    /\bboom\b/,
    /\bstucco\b/,
    /\bfront of house\b/,
  ]);
}

function guidedTextHasQuantitySignal(text) {
  return guidedTextHasAny(text, [
    /\b\d+(?:\.\d+)?\s*(?:sq\s*ft|sqft|sf|square feet)\b/,
    /\b(?:about|around|approx(?:imately)?|roughly|~)\s*\d+(?:\.\d+)?(?:\s*(?:sq\s*ft|sqft|sf|square feet))?(?:\s+or\s+so)?\b/,
    /\b\d+\s*(?:bed(?:room)?s?|rooms?|units?|patches?|spots?|sections?|openings?)\b/,
  ]);
}

function guidedTextHasAllowanceSignal(text) {
  return guidedTextHasAny(text, [
    /\ballowance\b/,
    /\blabor only\b/,
    /\blabor\b.*\ballowance\b/,
    /\bcarry materials as\b/,
    /\bmaterials?\s+as\s+allowance\b/,
  ]);
}

function getGuidedCommercialEnvironment(text) {
  if (guidedTextHasWarehouseSignal(text)) return "warehouse";
  if (guidedTextHasOfficeSuiteSignal(text)) return "office_suite";
  if (guidedTextHasCommercialSignal(text)) return "commercial";
  return "";
}

function buildCommercialExtentQuestion(environment = "") {
  if (environment === "warehouse") {
    return "About how much warehouse area am I carrying: a few sections, most of the floor, or a larger area?";
  }
  if (environment === "office_suite") {
    return "About how much space am I carrying here: a few rooms, a full suite, or a larger area?";
  }
  return "About how much commercial area am I carrying here: a smaller section, most of the area, or a larger scope?";
}

function buildCommercialExtentChoices(environment = "") {
  if (environment === "warehouse") {
    return [
      buildGuidedChoice("A few warehouse sections", "scopeNotes", "Carry a limited warehouse area."),
      buildGuidedChoice("Most of the warehouse floor", "scopeNotes", "Carry most of the occupied floor area."),
      buildGuidedChoice("Large warehouse area", "scopeNotes", "Carry a broader warehouse repaint scope."),
    ];
  }
  if (environment === "office_suite") {
    return [
      buildGuidedChoice("A few rooms + hallway", "scopeNotes", "Carry a smaller suite area."),
      buildGuidedChoice("Full suite", "scopeNotes", "Carry the whole suite."),
      buildGuidedChoice("Larger area", "scopeNotes", "Carry a broader office area."),
    ];
  }
  return [
    buildGuidedChoice("Smaller commercial area", "scopeNotes", "Carry a limited commercial area."),
    buildGuidedChoice("Most of the area", "scopeNotes", "Carry most of the commercial area."),
    buildGuidedChoice("Larger commercial area", "scopeNotes", "Carry a broader commercial scope."),
  ];
}

function buildCommercialAccessQuestion(environment = "") {
  if (environment === "warehouse") {
    return "Will this be worked around active warehouse operations, open access, or after-hours work?";
  }
  if (environment === "office_suite") {
    return "Will this be worked around occupied offices, a vacant suite, or after-hours access?";
  }
  return "Will this be worked around occupied operations, open access, or after-hours work?";
}

function buildCommercialAccessChoices(environment = "") {
  if (environment === "warehouse") {
    return [
      buildGuidedChoice("Active warehouse operations", "scopeNotes", "Carry protection and phased access around operations."),
      buildGuidedChoice("Open warehouse access", "scopeNotes", "Open access with fewer production constraints."),
      buildGuidedChoice("After-hours work", "scopeNotes", "Carry off-shift or after-hours work."),
    ];
  }
  if (environment === "office_suite") {
    return [
      buildGuidedChoice("Occupied offices", "scopeNotes", "Carry protection and phased access."),
      buildGuidedChoice("Vacant suite", "scopeNotes", "Vacant suite with open access."),
      buildGuidedChoice("After-hours access", "scopeNotes", "Carry after-hours or off-shift work."),
    ];
  }
  return [
    buildGuidedChoice("Occupied operations", "scopeNotes", "Carry protection and phased access."),
    buildGuidedChoice("Open access", "scopeNotes", "Open access with fewer constraints."),
    buildGuidedChoice("After-hours work", "scopeNotes", "Carry off-shift or after-hours work."),
  ];
}

function looksLikeRichScopeAnswer(value) {
  const text = normalizeLooseGuidedText(value);
  const wordCount = countGuidedWords(text);
  if (!text || wordCount < 2) return false;
  let signals = 0;
  if (guidedTextHasAny(text, [
    /\bpaint(?:ing|ed)?\b/,
    /\brepaint\b/,
    /\bbedrooms?\b/,
    /\brooms?\b/,
    /\bhouse\b/,
    /\bhome\b/,
    /\bresidential\b/,
    /\bcommercial\b/,
    /\binterior\b/,
    /\bexterior\b/,
    /\bwalls?\b/,
    /\bceilings?\b/,
    /\btrim\b/,
    /\bdoors?\b/,
    /\bclosets?\b/,
    /\bbaseboards?\b/,
    /\bprep\b/,
    /\bpatch(?:ing)?\b/,
    /\brepairs?\b/,
    /\boccupied\b/,
    /\bvacant\b/,
    /\bcoat(?:s)?\b/,
    /\bcolor\b/,
    /\bfloor(?:ing|s)?\b/,
    /\blvp\b/,
    /\blvt\b/,
    /\bvinyl\b/,
    /\bdrywall\b/,
    /\bsheetrock\b/,
    /\btexture\b/,
    /\bstucco\b/,
    /\bcracks?\b/,
    /\boffice\b/,
    /\bsuite\b/,
    /\bhallway\b/,
    /\bwarehouse\b/,
    /\btenant improvement\b/,
    /\bladder\b/,
    /\blift\b/,
  ])) signals += 1;
  if (/\b\d+\s*(?:bedrooms?|rooms?|walls?|doors?|closets?|windows?|areas?|patches?|spots?|sections?|openings?)\b/.test(text)) signals += 1;
  if (guidedTextHasQuantitySignal(text)) signals += 1;
  if (/\b(?:one|two|1|2)\s+coats?\b/.test(text)) signals += 1;
  return signals >= 2 || (wordCount >= 5 && signals >= 1);
}

function buildScopeFollowUpQuestion(userAnswer) {
  const text = normalizeLooseGuidedText(userAnswer);
  const paintingJob = guidedTextHasAny(text, [/\bpaint(?:ing|ed)?\b/, /\brepaint\b/]);
  const flooringJob = guidedTextHasFlooringSignal(text);
  const drywallJob = guidedTextHasDrywallSignal(text);
  const roomWork = guidedTextHasAny(text, [/\bbedrooms?\b/, /\brooms?\b/, /\bhouse\b/, /\bhome\b/]);
  const commercialEnvironment = getGuidedCommercialEnvironment(text);

  if (flooringJob && !guidedTextHasQuantitySignal(text)) {
    return "About how much floor area are we covering?";
  }
  if (flooringJob && !guidedTextHasAny(text, [/\bdemo\b/, /\bremove\b/, /\bremoval\b/, /\btear\s*out\b/, /\binstall over\b/])) {
    return "Is existing flooring staying, or do I need to include demo and removal?";
  }
  if (flooringJob && !guidedTextHasAny(text, [/\btransitions?\b/, /\bstairs?\b/, /\bbase(?:board)?s?\b/, /\bthresholds?\b/])) {
    return "Any stairs, base removal, or tricky transitions to account for?";
  }
  if (drywallJob && !guidedTextHasAny(text, [/\ba few\b/, /\bfew\b/, /\bspots?\b/, /\bareas?\b/, /\bsections?\b/, /\bopenings?\b/])) {
    return "How many repair areas are we dealing with?";
  }
  if (drywallJob && !guidedTextHasAny(text, [/\bsmall patches?\b/, /\blarger sections?\b/, /\breplacement\b/, /\bpatch and finish\b/])) {
    return "Are these small patches, or larger drywall sections that need replacement?";
  }
  if (drywallJob && !guidedTextHasAny(text, [/\btexture\b/, /\bsmooth\b/, /\bready for paint\b/, /\blevel 4\b/, /\blevel 5\b/])) {
    return "Does the finish need texture match, smooth finish, or just ready for paint?";
  }
  if (paintingJob && /\bstucco\b/.test(text) && /\bcracks?\b/.test(text) && !guidedTextHasQuantitySignal(text)) {
    return "Am I carrying isolated crack repairs with touch-up paint, or a larger stucco repair and repaint area?";
  }
  if (paintingJob && commercialEnvironment && !guidedTextHasAny(text, [/\bwalls?\b/, /\bceilings?\b/, /\btrim\b/, /\bdoors?\b/, /\bclosets?\b/, /\bbaseboards?\b/, /\bsurfaces?\b/, /\bareas?\b/])) {
    return "Which surfaces or areas are included in the price?";
  }
  if (paintingJob && commercialEnvironment && !guidedTextHasQuantitySignal(text)) {
    return buildCommercialExtentQuestion(commercialEnvironment);
  }
  if (paintingJob && commercialEnvironment && !guidedTextHasAny(text, [/\boccupied\b/, /\bvacant\b/, /\bafter hours\b/, /\btenant(?:ed)?\b/, /\boperations?\b/, /\bopen access\b/])) {
    return buildCommercialAccessQuestion(commercialEnvironment);
  }
  if (paintingJob && roomWork && !guidedTextHasAny(text, [/\bwalls?\b/, /\bceilings?\b/, /\btrim\b/, /\bdoors?\b/, /\bclosets?\b/, /\bbaseboards?\b/])) {
    return "For those rooms, am I carrying walls only, or walls, ceilings, trim, doors, and closets too?";
  }
  if (paintingJob && !guidedTextHasAny(text, [/\bone coat\b/, /\btwo coats?\b/, /\bcolor change\b/, /\bsame color\b/])) {
    return "Should I price one coat or two, and is it staying the same color or changing?";
  }
  if (paintingJob && !guidedTextHasAny(text, [/\boccupied\b/, /\bvacant\b/, /\bfurnished\b/, /\bempty\b/])) {
    return "Will the space be occupied, furnished, or vacant while the work is being done?";
  }
  if (paintingJob && !guidedTextHasAny(text, [/\bprep\b/, /\bpatch(?:ing)?\b/, /\brepair\b/, /\bsand(?:ing)?\b/, /\bcaulk\b/, /\bprime(?:r)?\b/])) {
    return "Do you want standard prep only, minor patching, or heavier repairs in the price?";
  }
  if (paintingJob && guidedTextHasExteriorAccessSignal(text) && !guidedTextHasAny(text, [/\bladder\b/, /\blift\b/, /\bscaffold\b/, /\bboom\b/])) {
    return "Should I carry straightforward ladder access, or do I need to allow for lift or scaffold setup?";
  }
  if (!guidedTextHasAny(text, [/\binterior\b/, /\bexterior\b/, /\binside\b/, /\boutside\b/])) {
    return "Is this inside work, outside work, or both?";
  }
  if (!guidedTextHasAny(text, [/\bwalls?\b/, /\bceilings?\b/, /\btrim\b/, /\bdoors?\b/, /\brooms?\b/, /\bsiding\b/, /\bfence\b/, /\bcabinets?\b/, /\bsurfaces?\b/, /\bareas?\b/])) {
    return "Which surfaces or areas are included in the price?";
  }
  if (!guidedTextHasAny(text, [/\bflat\b/, /\beggshell\b/, /\bsatin\b/, /\bsemi\b/, /\bgloss\b/, /\bfinish\b/, /\bmaterial\b/, /\bquality\b/])) {
    return "What finish should I assume?";
  }
  if (!paintingJob && !flooringJob && !drywallJob && !/\bstucco\b/.test(text)) {
    return "What kind of work is this?";
  }
  return "What work are you doing there?";
}

function buildGuidedChoice(label, fieldKey, description = "", value = undefined) {
  const trimmedLabel = String(label || "").trim();
  if (!trimmedLabel) return null;
  const choice = {
    id: `${fieldKey || "choice"}:${normalizeLooseGuidedText(trimmedLabel).replace(/\s+/g, "-") || "choice"}`,
    label: trimmedLabel,
    description: trimGuidedText(description, 120),
    fieldKey,
  };
  if (value !== undefined) choice.value = value;
  return choice;
}

function dedupeGuidedChoices(choices, max = 3) {
  const seen = new Set();
  const out = [];
  for (const choice of Array.isArray(choices) ? choices : []) {
    const label = String(choice?.label || "").trim();
    const fieldKey = String(choice?.fieldKey || "").trim();
    if (!label || !fieldKey) continue;
    const key = `${fieldKey}:${normalizeLooseGuidedText(label)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(choice);
    if (out.length >= max) break;
  }
  return out;
}

function detectGuidedPromptFocus(questionKey, sectionKey, promptText) {
  const prompt = normalizeLooseGuidedText(promptText);
  const notesPrompt = questionKey === "additionalNotes" || sectionKey === "notes";
  const scopePrompt = questionKey === "scopeNotes" || questionKey === "tradeInsert.key" || sectionKey === "scope";
  return {
    notesPrompt,
    scopePrompt,
    notesGeneral: notesPrompt || guidedTextHasAny(prompt, [/\bexclude(?:d|s|ing)?\b/, /\bexclusions?\b/, /\bassumption(?:s)?\b/, /\bnotes?\b/]),
    notesAccess: guidedTextHasAny(prompt, [/\baccess\b/, /\bschedule\b/, /\boccupied\b/, /\bvacant\b/, /\bconstraints?\b/, /\blimits?\b/]),
    notesMaterials: guidedTextHasAny(prompt, [/\bcustomer[-\s]?supplied\b/, /\bowner[-\s]?supplied\b/, /\bmaterials?\b/, /\bpaint\b/]),
    notesFurniture: guidedTextHasAny(prompt, [/\bfurniture\b/, /\bmove(?:d|ing)?\b/, /\bclear(?:ed|ing)?\b/]),
    scopePrep: scopePrompt && guidedTextHasAny(prompt, [/\bprep\b/, /\bpatch(?:ing)?\b/, /\brepair(?:s|ing)?\b/, /\bsand(?:ing)?\b/, /\bcaulk(?:ing)?\b/, /\bprime(?:r|ing)?\b/]),
  };
}

function looksLikeGuidedNegativeAnswer(answer) {
  const text = normalizeLooseGuidedText(answer);
  if (!text) return false;
  if (countGuidedWords(text) > 10 && !/^no\b/.test(text) && !/\bnot applicable\b/.test(text)) return false;
  if (/\bnot applicable\b/.test(text) || /\bnothing special\b/.test(text)) return true;
  return guidedTextHasAny(text, [
    /^(?:no|none|nope|nah|n a|not applicable|nothing|nothing special|nothing else|no issues?|no problem(?:s)?|no concerns?)$/,
    /^no\s+(?:exclusions?|assumptions?|special\s+notes?|notes?|access(?:\s+issues|\s+limitations?)?|schedule\s+issues?|customer[-\s]?supplied\s+(?:materials?|paint)|owner[-\s]?supplied\s+(?:materials?|paint)|repairs?|patch(?:ing)?|prep|prep work|furniture(?:\s+moving|\s+handling)?|materials?)$/,
    /^no\s+exclusions?\s+or\s+assumptions?$/,
  ]);
}

function resolveGuidedNegativeAnswer({ sectionKey = "", questionKey = "", promptText = "", answer = "" } = {}) {
  const normalizedAnswer = normalizeLooseGuidedText(answer);
  if (!looksLikeGuidedNegativeAnswer(answer)) return null;
  const focus = detectGuidedPromptFocus(questionKey, sectionKey, promptText);
  const genericNone = /^(?:no|none|nope|nah|n a|not applicable|nothing|nothing special|nothing else)$/i.test(normalizedAnswer);
  const normalizedPrompt = normalizeLooseGuidedText(promptText);
  const mentionsExclusions = /\bexclude(?:d|s|ing)?\b|\bexclusions?\b|\bassumption(?:s)?\b/.test(normalizedAnswer);
  const mentionsAccess = /\baccess\b|\bschedule\b|\blimits?\b|\bconstraints?\b|\bissues?\b/.test(normalizedAnswer);
  const mentionsMaterials = /\bcustomer[-\s]?supplied\b|\bowner[-\s]?supplied\b|\bmaterials?\b|\bpaint\b/.test(normalizedAnswer);
  const mentionsFurniture = /\bfurniture\b|\bmove(?:d|ing)?\b|\bclear(?:ed|ing)?\b/.test(normalizedAnswer);
  const mentionsPrep = /\bprep\b|\bpatch(?:ing)?\b|\brepair(?:s|ing)?\b/.test(normalizedAnswer);

  if (focus.scopePrep || (questionKey === "scopeNotes" && /\bprep\b|\bpatch(?:ing)?\b|\brepair(?:s|ing)?\b/.test(normalizedPrompt))) {
    return {
      resolved: true,
      kind: "scope_prep_negative_completion",
      normalizedMeaning: "No repairs or patching beyond standard prep were stated.",
      markers: { prepKnown: true },
      tags: ["resolved_negative", "scope_prep_none"],
    };
  }

  if (focus.notesPrompt || focus.notesGeneral || focus.notesAccess || focus.notesMaterials || focus.notesFurniture) {
    const genericNotesNegative = genericNone || (!mentionsPrep && !mentionsExclusions && !mentionsAccess && !mentionsMaterials && !mentionsFurniture);
    return {
      resolved: true,
      kind: "notes_negative_completion",
      normalizedMeaning: mentionsMaterials && !genericNotesNegative
        ? "No customer-supplied materials were stated."
        : (mentionsAccess && !genericNotesNegative
          ? "No access or schedule limitations were stated."
          : "No exclusions or special assumptions were stated."),
      markers: {
        notesResolved: true,
        exclusionsKnown: genericNotesNegative || mentionsExclusions,
        scheduleKnown: genericNotesNegative || mentionsAccess,
        suppliedMaterialsKnown: genericNotesNegative || mentionsMaterials,
        furnitureKnown: genericNotesNegative || mentionsFurniture,
      },
      tags: [
        "resolved_negative",
        "notes_complete",
        (genericNotesNegative || mentionsExclusions) ? "notes_no_exclusions" : "",
        (genericNotesNegative || mentionsAccess) ? "notes_no_access_limits" : "",
        (genericNotesNegative || mentionsMaterials) ? "notes_no_customer_materials" : "",
      ].filter(Boolean),
    };
  }

  return null;
}

function mergeGuidedResolutionMarkers(base, next) {
  return {
    notesResolved: base?.notesResolved || next?.notesResolved || false,
    exclusionsKnown: base?.exclusionsKnown || next?.exclusionsKnown || false,
    scheduleKnown: base?.scheduleKnown || next?.scheduleKnown || false,
    suppliedMaterialsKnown: base?.suppliedMaterialsKnown || next?.suppliedMaterialsKnown || false,
    furnitureKnown: base?.furnitureKnown || next?.furnitureKnown || false,
    prepKnown: base?.prepKnown || next?.prepKnown || false,
  };
}

function summarizeGuidedHistory(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => trimGuidedText(entry?.answer, 120))
    .filter(Boolean)
    .join(" ");
}

function deriveGuidedFallbackContext(body, nextField) {
  const plannerState = slimGuidedPlannerState(body?.plannerState);
  const questionKey = String(body?.questionKey || nextField || "").trim();
  const sectionKey = String(body?.sectionKey || "").trim();
  const currentNegativeResolution = resolveGuidedNegativeAnswer({
    sectionKey,
    questionKey,
    promptText: body?.currentPrompt || body?.sectionRules?.questionPrompt,
    answer: body?.userAnswer,
  });
  const resolvedMarkers = (Array.isArray(body?.priorGuidedAnswers) ? body.priorGuidedAnswers : []).reduce((acc, entry) => {
    const resolution = resolveGuidedNegativeAnswer({
      sectionKey: entry?.sectionKey,
      questionKey: entry?.questionKey,
      promptText: entry?.prompt,
      answer: entry?.answer,
    });
    return mergeGuidedResolutionMarkers(acc, resolution?.markers);
  }, mergeGuidedResolutionMarkers({}, currentNegativeResolution?.markers));
  const text = normalizeLooseGuidedText([
    body?.userAnswer,
    summarizeGuidedHistory(body?.priorGuidedAnswers),
    body?.sectionRules?.aiPromptFraming,
    plannerState?.tradeKey,
  ].filter(Boolean).join(" "));
  const painting = plannerState?.painting === true
    || guidedTextHasAny(text, [/\bpaint(?:ing|ed)?\b/, /\brepaint\b/, /\btrim\b/, /\bceilings?\b/, /\bbaseboards?\b/, /\bstucco\b/]);
  const flooring = plannerState?.flooring === true || guidedTextHasFlooringSignal(text);
  const drywallRepair = plannerState?.drywallRepair === true || guidedTextHasDrywallSignal(text);
  const commercialContext = plannerState?.commercialContext === true || guidedTextHasCommercialSignal(text);
  const commercialEnvironment = getGuidedCommercialEnvironment(text);
  const warehouseContext = commercialEnvironment === "warehouse";
  const officeSuiteContext = commercialEnvironment === "office_suite";
  const exteriorAccess = plannerState?.exteriorAccess === true || guidedTextHasExteriorAccessSignal(text);
  const stuccoRepair = plannerState?.stuccoRepair === true || (/\bstucco\b/.test(text) && /\bcracks?\b|\brepair(?:s|ing)?\b|\bpaint(?:ing|ed)?\b/.test(text));
  const roomWork = guidedTextHasAny(text, [/\bbedrooms?\b/, /\brooms?\b/, /\bhouse\b/, /\bhome\b/]);
  const coverageKnown = plannerState?.coverageKnown === true || guidedTextHasAny(text, [/\bwalls?\s+only\b/, /\bwalls?\b/, /\bceilings?\b/, /\btrim\b/, /\bdoors?\b/, /\bclosets?\b/, /\bbaseboards?\b/, /\bstucco\b/, /\bfloor(?:ing|s)?\b/]);
  const occupancyKnown = plannerState?.occupancyKnown === true || guidedTextHasAny(text, [/\boccupied\b/, /\bvacant\b/, /\bfurnished\b/, /\bempty\b/, /\btenant(?:ed)?\b/]);
  const prepKnown = plannerState?.prepKnown === true || guidedTextHasAny(text, [/\bprep\b/, /\bpatch(?:ing)?\b/, /\brepair(?:s|ing)?\b/, /\bsand(?:ing)?\b/, /\bcaulk(?:ing)?\b/, /\bprime(?:r|ing)?\b/]);
  const colorKnown = plannerState?.colorKnown === true || guidedTextHasAny(text, [/\bsame color\b/, /\bcolor change\b/, /\baccent\b/, /\bone color\b/, /\bmultiple colors?\b/]);
  const coatsKnown = plannerState?.coatsKnown === true || guidedTextHasAny(text, [/\bone coat\b/, /\btwo coats?\b/, /\b1 coat\b/, /\b2 coats?\b/, /\bsingle coat\b/]);
  const finishKnown = plannerState?.finishKnown === true || guidedTextHasAny(text, [/\bfinish(?:es)?\b/, /\bflat\b/, /\beggshell\b/, /\bsatin\b/, /\bsemi[\s-]?gloss\b/, /\bgloss\b/, /\bsheen\b/]);
  const interiorExteriorKnown = roomWork || guidedTextHasAny(text, [/\binterior\b/, /\bexterior\b/, /\binside\b/, /\boutside\b/]);
  const furnitureKnown = plannerState?.furnitureKnown === true || guidedTextHasAny(text, [/\bfurniture\b/, /\bmove(?:d|ing)?\b/, /\bclear(?:ed|ing)?\b/]);
  const scheduleKnown = plannerState?.scheduleKnown === true || guidedTextHasAny(text, [/\bschedule\b/, /\bafter hours\b/, /\bweekend\b/, /\bweekday\b/, /\baccess\b/]);
  const suppliedMaterialsKnown = plannerState?.suppliedMaterialsKnown === true || guidedTextHasAny(text, [/\bcustomer[-\s]?supplied\b/, /\bowner[-\s]?supplied\b/, /\bmaterials?\s+provided\b/, /\bpaint\s+provided\b/]);
  const exclusionsKnown = plannerState?.exclusionsKnown === true || guidedTextHasAny(text, [/\bexclude(?:d|s|ing)?\b/, /\bexclusions?\b/, /\bnot included\b/, /\bassumptions?\b/]);
  const quantityBasisKnown = plannerState?.quantityBasisKnown === true
    || guidedTextHasQuantitySignal(text);
  const accessSetupKnown = plannerState?.accessSetupKnown === true || guidedTextHasAny(text, [
    /\bladder\b/,
    /\blift\b/,
    /\bscaffold\b/,
    /\bboom\b/,
    /\bafter hours\b/,
    /\bnight work\b/,
    /\blimited access\b/,
    /\btwo story\b/,
    /\b2 story\b/,
  ]);
  const demoKnown = plannerState?.demoKnown === true || guidedTextHasAny(text, [
    /\bdemo\b/,
    /\bdemolition\b/,
    /\bremove\b/,
    /\bremoval\b/,
    /\btear\s*out\b/,
    /\binstall over\b/,
    /\bexisting flooring staying\b/,
  ]);
  const transitionsKnown = plannerState?.transitionsKnown === true || guidedTextHasAny(text, [
    /\btransitions?\b/,
    /\bthresholds?\b/,
    /\bstairs?\b/,
    /\bbase(?:board)?s?\b/,
    /\bshoe\b/,
  ]);
  const repairCountKnown = plannerState?.repairCountKnown === true
    || guidedTextHasAny(text, [/\ba few\b/, /\bfew\b/, /\bcouple\b/, /\bspots?\b/, /\bpatches?\b/, /\bareas?\b/, /\bsections?\b/, /\bopenings?\b/])
    || guidedTextHasQuantitySignal(text);
  const patchVsReplaceKnown = plannerState?.patchVsReplaceKnown === true || guidedTextHasAny(text, [
    /\bsmall patches?\b/,
    /\bpatch and finish\b/,
    /\blarger sections?\b/,
    /\bboard replacement\b/,
    /\bsection replacement\b/,
    /\breplace(?:ment)?\b/,
    /\bcut out and replace\b/,
  ]);
  const textureKnown = plannerState?.textureKnown === true || guidedTextHasAny(text, [
    /\btexture\b/,
    /\bsmooth\b/,
    /\blevel 4\b/,
    /\blevel 5\b/,
    /\bready for paint\b/,
  ]);
  const paintTouchupKnown = plannerState?.paintTouchupKnown === true || guidedTextHasAny(text, [
    /\bpaint touch(?:-?up)?\b/,
    /\bpaint match\b/,
    /\bdrywall repair only\b/,
    /\bready for paint\b/,
  ]);
  const materialsAllowanceIntent = plannerState?.materialsAllowanceIntent === true || guidedTextHasAllowanceSignal(text);
  const materialsPathKnown = plannerState?.materialsPathKnown === true || guidedTextHasAny(text, [/\bitemized\b/, /\bblanket\b/, /\bmaterials mode\b/]);
  const scopeDriverCount = [
    coverageKnown,
    quantityBasisKnown,
    prepKnown || resolvedMarkers.prepKnown,
    occupancyKnown,
    colorKnown,
    coatsKnown,
    finishKnown,
    accessSetupKnown,
    demoKnown,
    transitionsKnown,
    repairCountKnown,
    patchVsReplaceKnown,
    textureKnown,
  ].filter(Boolean).length;
  const scopePromotionThreshold = commercialContext && (!coverageKnown || !quantityBasisKnown) ? 4 : 3;

  return {
    sectionKey,
    questionKey,
    nextField,
    painting,
    flooring,
    drywallRepair,
    commercialContext,
    commercialEnvironment,
    warehouseContext,
    officeSuiteContext,
    exteriorAccess,
    stuccoRepair,
    coverageKnown,
    quantityBasisKnown,
    occupancyKnown,
    prepKnown: prepKnown || resolvedMarkers.prepKnown,
    accessSetupKnown,
    demoKnown,
    transitionsKnown,
    repairCountKnown,
    patchVsReplaceKnown,
    textureKnown,
    paintTouchupKnown,
    materialsAllowanceIntent,
    materialsPathKnown,
    colorKnown,
    coatsKnown,
    finishKnown,
    interiorExteriorKnown,
    furnitureKnown: furnitureKnown || resolvedMarkers.furnitureKnown,
    scheduleKnown: scheduleKnown || resolvedMarkers.scheduleKnown,
    suppliedMaterialsKnown: suppliedMaterialsKnown || resolvedMarkers.suppliedMaterialsKnown,
    exclusionsKnown: exclusionsKnown || resolvedMarkers.exclusionsKnown,
    notesFieldActive: nextField === "additionalNotes" || questionKey === "additionalNotes",
    scopeFieldActive: nextField === "scopeNotes" || questionKey === "scopeNotes" || questionKey === "tradeInsert.key",
    notesResolved: resolvedMarkers.notesResolved || plannerState?.notesResolved === true,
    currentNegativeResolution,
    scopeDriverCount,
    scopeReadyForNotes: plannerState?.scopeReadyForNotes === true
      || (scopeDriverCount >= scopePromotionThreshold && (materialsPathKnown || accessSetupKnown || occupancyKnown || scheduleKnown || finishKnown || textureKnown)),
  };
}

function buildGuidedMaterialsPathFallbackPlan() {
  return {
    missingContext: ["materials path"],
    nextBestQuestion: {
      fieldKey: "ui.materialsMode",
      sectionKey: "materials",
      question: "Do you want me to carry materials as an allowance, itemize them, or leave this labor only for now?",
    },
    suggestedChoices: dedupeGuidedChoices([
      buildGuidedChoice("Carry materials allowance", "ui.materialsMode", "Use one materials allowance line.", "blanket"),
      buildGuidedChoice("Itemize materials", "ui.materialsMode", "List materials line by line.", "itemized"),
      buildGuidedChoice("Labor only for now", "ui.materialsMode", "Carry labor first and keep materials separate."),
    ]),
  };
}

function buildPaintingScopeFallbackPlan(context) {
  const missingContext = [];
  let question = buildScopeFollowUpQuestion("");
  let suggestedChoices = [];

  if (context.stuccoRepair && !context.quantityBasisKnown) {
    missingContext.push("stucco repair extent");
    if (!suggestedChoices.length) {
      question = "Am I carrying isolated crack repairs with touch-up paint, or a larger stucco repair and repaint area?";
      suggestedChoices = [
        buildGuidedChoice("Spot crack repairs only", "scopeNotes", "Carry localized crack repair with paint touch-up."),
        buildGuidedChoice("Front elevation repair + paint", "scopeNotes", "Carry broader stucco repair and repaint at the front."),
        buildGuidedChoice("Larger exterior repair area", "scopeNotes", "Carry a wider repair and repaint scope."),
      ];
    }
  }
  if (!context.coverageKnown) {
    missingContext.push("surfaces included");
    if (!suggestedChoices.length) {
      question = "Which surfaces are included: walls only, walls + ceilings, or walls + ceilings + trim, doors, and closets?";
      suggestedChoices = [
        buildGuidedChoice("Walls only", "scopeNotes", "Carry wall surfaces only."),
        buildGuidedChoice("Walls + ceilings", "scopeNotes", "Carry walls and ceilings."),
        buildGuidedChoice("Walls + ceilings + trim", "scopeNotes", "Carry walls, ceilings, trim, doors, and closets."),
      ];
    }
  }
  if (!context.quantityBasisKnown && (context.commercialContext || context.stuccoRepair)) {
    missingContext.push("size or quantity basis");
    if (!suggestedChoices.length) {
      question = context.commercialContext
        ? buildCommercialExtentQuestion(context.commercialEnvironment)
        : "Is this just the front area, or a larger portion of the exterior?";
      suggestedChoices = context.commercialContext
        ? buildCommercialExtentChoices(context.commercialEnvironment)
        : [
          buildGuidedChoice("Front area only", "scopeNotes", "Carry the front only."),
          buildGuidedChoice("Larger exterior area", "scopeNotes", "Carry more than one exterior area."),
          buildGuidedChoice("Touch-up only", "scopeNotes", "Carry only localized repair and touch-up."),
        ];
    }
  }
  if (context.commercialContext && !context.occupancyKnown) {
    missingContext.push("commercial access timing");
    if (!suggestedChoices.length) {
      question = buildCommercialAccessQuestion(context.commercialEnvironment);
      suggestedChoices = buildCommercialAccessChoices(context.commercialEnvironment);
    }
  }
  if (!context.interiorExteriorKnown) {
    missingContext.push("interior or exterior");
    if (!suggestedChoices.length) {
      question = "Is this inside work, outside work, or both?";
      suggestedChoices = [
        buildGuidedChoice("Interior", "scopeNotes", "Carry interior surfaces only."),
        buildGuidedChoice("Exterior", "scopeNotes", "Carry exterior surfaces only."),
        buildGuidedChoice("Interior + exterior", "scopeNotes", "Carry both interior and exterior scope."),
      ];
    }
  }
  if (context.exteriorAccess && !context.accessSetupKnown) {
    missingContext.push("access setup");
    if (!suggestedChoices.length) {
      question = "Should I carry straightforward ladder access, or do I need to allow for lift or scaffold setup?";
      suggestedChoices = [
        buildGuidedChoice("Ladder access only", "scopeNotes", "Carry straightforward ladder setup."),
        buildGuidedChoice("Lift access", "scopeNotes", "Carry lift or boom access."),
        buildGuidedChoice("Scaffold setup", "scopeNotes", "Carry scaffold setup."),
      ];
    }
  }
  if (!context.coatsKnown || !context.colorKnown) {
    missingContext.push("coat count and color change");
    if (!suggestedChoices.length) {
      question = "Should I price one coat or two, and is it staying the same color or changing?";
      suggestedChoices = [
        buildGuidedChoice("Same color, one coat", "scopeNotes", "Light production impact."),
        buildGuidedChoice("Same color, two coats", "scopeNotes", "Carry two coats at the same color."),
        buildGuidedChoice("Color change, two coats", "scopeNotes", "Carry full color-change coverage."),
      ];
    }
  }
  if (!context.occupancyKnown) {
    missingContext.push("occupancy status");
    if (!suggestedChoices.length) {
      question = "Will the work be done in an occupied space, a furnished space, or a vacant one?";
      suggestedChoices = [
        buildGuidedChoice("Occupied", "scopeNotes", "Carry protection and daily cleanup."),
        buildGuidedChoice("Vacant", "scopeNotes", "Vacant or empty space."),
        buildGuidedChoice("Occupied with furniture", "scopeNotes", "Carry furniture moving and protection."),
      ];
    }
  }
  if (!context.prepKnown) {
    missingContext.push("prep or patching");
    if (!suggestedChoices.length) {
      question = "Do you want standard prep only, minor patching, or heavier repairs in the price?";
      suggestedChoices = [
        buildGuidedChoice("Standard prep only", "scopeNotes", "No repair scope beyond normal prep."),
        buildGuidedChoice("Minor patching included", "scopeNotes", "Carry light patching and prep."),
        buildGuidedChoice("Heavy prep / repairs included", "scopeNotes", "Carry significant prep and repair time."),
      ];
    }
  }
  if (context.materialsAllowanceIntent && !context.materialsPathKnown) {
    return buildGuidedMaterialsPathFallbackPlan();
  }
  if (!context.finishKnown) {
    missingContext.push("finish level");
    if (!suggestedChoices.length) {
      question = "What finish should I assume for the walls and trim?";
      suggestedChoices = [
        buildGuidedChoice("Flat walls", "scopeNotes", "Standard flat wall finish."),
        buildGuidedChoice("Eggshell walls", "scopeNotes", "Carry eggshell on the walls."),
        buildGuidedChoice("Satin / semi-gloss trim", "scopeNotes", "Carry a typical trim finish."),
      ];
    }
  }

  return {
    missingContext,
    nextBestQuestion: {
      fieldKey: "scopeNotes",
      sectionKey: "scope",
      question,
    },
    suggestedChoices: dedupeGuidedChoices(suggestedChoices),
  };
}

function buildFlooringFallbackPlan(context) {
  const missingContext = [];
  let question = "About how much floor area are we covering?";
  let suggestedChoices = [];

  if (!context.quantityBasisKnown) {
    missingContext.push("floor area basis");
    suggestedChoices = [
      buildGuidedChoice("A few connected rooms", "scopeNotes", "Carry connected living areas."),
      buildGuidedChoice("Most of downstairs", "scopeNotes", "Carry a larger downstairs footprint."),
      buildGuidedChoice("Whole level / full area", "scopeNotes", "Carry the full level or broad area."),
    ];
  } else if (!context.demoKnown) {
    missingContext.push("demo or removal");
    question = "Is existing flooring staying, or do I need to include demo and removal?";
    suggestedChoices = [
      buildGuidedChoice("Existing floor stays", "scopeNotes", "Install over a ready surface."),
      buildGuidedChoice("Include demo / removal", "scopeNotes", "Carry tear-out and disposal."),
      buildGuidedChoice("Minor floor prep only", "scopeNotes", "Carry light prep without full demo."),
    ];
  } else if (!context.transitionsKnown) {
    missingContext.push("stairs or transitions");
    question = "Any stairs, base removal, or tricky transitions to account for?";
    suggestedChoices = [
      buildGuidedChoice("No stairs or major transitions", "scopeNotes", "Straight run with standard transitions."),
      buildGuidedChoice("Base removal included", "scopeNotes", "Carry base removal and reset."),
      buildGuidedChoice("Stairs / transitions included", "scopeNotes", "Carry extra transition or stair work."),
    ];
  } else if (!context.materialsPathKnown) {
    return buildGuidedMaterialsPathFallbackPlan();
  } else if (!context.prepKnown) {
    missingContext.push("subfloor or prep");
    question = "Any subfloor prep, patching, or moisture issues I should carry?";
    suggestedChoices = [
      buildGuidedChoice("Standard prep only", "scopeNotes", "No unusual floor prep."),
      buildGuidedChoice("Minor floor prep", "scopeNotes", "Carry light patching or leveling."),
      buildGuidedChoice("Moisture / leveling concerns", "scopeNotes", "Carry heavier prep or moisture mitigation."),
    ];
  }

  return {
    missingContext,
    nextBestQuestion: {
      fieldKey: question === "Do you want me to carry materials as an allowance, itemize them, or leave this labor only for now?" ? "ui.materialsMode" : "scopeNotes",
      sectionKey: question === "Do you want me to carry materials as an allowance, itemize them, or leave this labor only for now?" ? "materials" : "scope",
      question,
    },
    suggestedChoices: dedupeGuidedChoices(suggestedChoices),
  };
}

function buildDrywallFallbackPlan(context) {
  const missingContext = [];
  let question = "How many repair areas are we dealing with?";
  let suggestedChoices = [];

  if (!context.repairCountKnown) {
    missingContext.push("repair area count");
    suggestedChoices = [
      buildGuidedChoice("One or two areas", "scopeNotes", "Carry a small repair count."),
      buildGuidedChoice("A few areas", "scopeNotes", "Carry several repair spots."),
      buildGuidedChoice("Several sections / rooms", "scopeNotes", "Carry a broader repair scope."),
    ];
  } else if (!context.patchVsReplaceKnown) {
    missingContext.push("patch or replacement");
    question = "Are these small patches, or larger drywall sections that need replacement?";
    suggestedChoices = [
      buildGuidedChoice("Small patches only", "scopeNotes", "Carry patch-and-finish work."),
      buildGuidedChoice("Mixed patches + some replacement", "scopeNotes", "Carry patching with a little board replacement."),
      buildGuidedChoice("Larger section replacement", "scopeNotes", "Carry broader drywall replacement."),
    ];
  } else if (!context.textureKnown) {
    missingContext.push("finish level");
    question = "Does the finish need texture match, smooth finish, or just ready for paint?";
    suggestedChoices = [
      buildGuidedChoice("Texture match", "scopeNotes", "Carry texture match after repair."),
      buildGuidedChoice("Smooth finish", "scopeNotes", "Carry a smooth repair finish."),
      buildGuidedChoice("Ready for paint", "scopeNotes", "Finish ready for paint without texture match."),
    ];
  } else if (!context.paintTouchupKnown) {
    missingContext.push("paint scope");
    question = "Should I include paint touch-up, or leave this as drywall repair only?";
    suggestedChoices = [
      buildGuidedChoice("Drywall repair only", "scopeNotes", "Leave paint out of the scope."),
      buildGuidedChoice("Include paint touch-up", "scopeNotes", "Carry paint touch-up with the repairs."),
      buildGuidedChoice("Ready for painter", "scopeNotes", "Finish for paint but do not include coating."),
    ];
  }

  return {
    missingContext,
    nextBestQuestion: {
      fieldKey: "scopeNotes",
      sectionKey: "scope",
      question,
    },
    suggestedChoices: dedupeGuidedChoices(suggestedChoices),
  };
}

function buildGuidedNotesFallbackPlan() {
  return {
    missingContext: [
      "exclusions or assumptions",
      "furniture moving responsibility",
      "access or schedule constraints",
    ],
    nextBestQuestion: {
      fieldKey: "additionalNotes",
      sectionKey: "notes",
      question: "Any assumptions or exclusions I should carry, like owner-moved furniture, customer-supplied paint, or limited access?",
    },
    suggestedChoices: dedupeGuidedChoices([
      buildGuidedChoice("Owner moves furniture", "additionalNotes", "Owner clears and moves furniture before work."),
      buildGuidedChoice("Customer supplies paint", "additionalNotes", "Customer provides coatings/materials."),
      buildGuidedChoice("Limited access / schedule window", "additionalNotes", "Carry access or schedule constraints."),
    ]),
  };
}

function buildGuidedFallbackPlan(body, nextField) {
  const context = deriveGuidedFallbackContext(body, nextField);
  if (context.notesFieldActive) {
    if (context.currentNegativeResolution?.resolved || context.notesResolved) {
      const scopePlan = context.painting ? buildPaintingScopeFallbackPlan(context) : null;
      return scopePlan?.nextBestQuestion?.question ? scopePlan : null;
    }
    return buildGuidedNotesFallbackPlan(context);
  }
  if (context.flooring && context.scopeFieldActive) {
    return buildFlooringFallbackPlan(context);
  }
  if (context.drywallRepair && context.scopeFieldActive) {
    return buildDrywallFallbackPlan(context);
  }
  if (context.painting && context.scopeFieldActive) {
    return buildPaintingScopeFallbackPlan(context);
  }
  if (context.materialsAllowanceIntent && !context.materialsPathKnown) {
    return buildGuidedMaterialsPathFallbackPlan();
  }
  return null;
}

function buildGuidedBuildAssistantMessage(body, nextField, activeFields) {
  const prompt = String(body?.sectionRules?.questionPrompt || "").trim();
  const label = String(activeFields.find((field) => String(field?.key || "").trim() === nextField)?.label || nextField || "").trim();

  if (nextField === "scopeNotes") return buildScopeFollowUpQuestion(body?.userAnswer);
  if (nextField === "tradeInsert.key") return "What kind of job is this?";
  if (nextField === "labor.lines") return "About what crew should I carry for this job?";
  if (nextField === "ui.materialsMode") return "Do you want me to carry materials as an allowance, itemize them, or leave this labor only for now?";
  if (nextField === "materials.items") return "What materials should I list, and about how many units of each?";
  if (nextField === "additionalNotes") return "Any prep, repairs, access issues, exclusions, or customer responsibilities I should call out?";
  if (prompt) return prompt;
  if (label) return `What should I carry for ${label.toLowerCase()}?`;
  return "What should I price next?";
}

function normalizeGuidedFallbackChoices(rawChoices = [], fallbackFieldKey = "") {
  return (Array.isArray(rawChoices) ? rawChoices : [])
    .map((choice, index) => ({
      id: String(choice?.id || `${choice?.fieldKey || fallbackFieldKey || "choice"}:${choice?.value ?? index}`),
      label: String(choice?.label || choice?.title || choice?.value || "").trim(),
      description: String(choice?.description || "").trim(),
      value: choice?.value,
      fieldKey: String(choice?.fieldKey || fallbackFieldKey || "").trim(),
    }))
    .filter((choice) => choice.label);
}

function buildGuidedFallbackChoice(label, fieldKey, description = "", value = undefined) {
  return {
    id: `${fieldKey}:${String((value ?? label) || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    label,
    description,
    value,
    fieldKey,
  };
}

function looksLikeWeakGuidedFallbackPrompt(value = "") {
  const text = normalizeLooseGuidedText(value);
  if (!text) return true;
  return [
    /\bwhat should i price next\b/,
    /\bwhat should i carry next\b/,
    /\bwhat should i fill in next\b/,
    /\btell me more\b/,
    /\bplease provide more details\b/,
    /\bcurrent step\b/,
    /\bcoverage\b/,
    /\bmissing field\b/,
  ].some((pattern) => pattern.test(text));
}

function buildGuidedStepClarificationFallback(body, nextField) {
  const activeStep = body?.activeStep && typeof body.activeStep === "object" ? body.activeStep : {};
  const fieldKey = String(activeStep?.fieldKey || nextField || body?.questionKey || "").trim();
  const sectionKey = String(activeStep?.sectionKey || body?.sectionKey || "").trim() || "scope";
  const promptIntent = String(activeStep?.promptIntent || "").trim();
  const expectedAnswerMode = String(activeStep?.expectedAnswerMode || "").trim();
  const promptText = String(activeStep?.promptText || body?.currentPrompt || "").trim();
  const promptSeed = normalizeLooseGuidedText([
    promptText,
    body?.userAnswer,
    body?.estimateContext?.scope,
  ].filter(Boolean).join(" "));
  const environment = getGuidedCommercialEnvironment(promptSeed);
  const suggestedChoices = normalizeGuidedFallbackChoices(activeStep?.suggestedChoices, fieldKey);

  if (!fieldKey) return null;

  if (promptIntent === "painting_surfaces" || promptIntent === "scope_surfaces") {
    return {
      nextBestQuestion: {
        fieldKey,
        sectionKey,
        question: "For this step, tell me which surfaces are included: walls, ceilings, trim, doors, or closets.",
      },
      suggestedChoices: suggestedChoices.length ? suggestedChoices : [
        buildGuidedFallbackChoice("Walls only", fieldKey, "Carry wall surfaces only."),
        buildGuidedFallbackChoice("Walls + ceilings", fieldKey, "Carry walls and ceilings."),
        buildGuidedFallbackChoice("Walls + ceilings + trim", fieldKey, "Carry walls, ceilings, and trim."),
      ],
    };
  }
  if (promptIntent === "painting_occupancy") {
    return {
      nextBestQuestion: {
        fieldKey,
        sectionKey,
        question: "For this step, tell me whether the space is occupied, occupied with furniture, or vacant.",
      },
      suggestedChoices: suggestedChoices.length ? suggestedChoices : [
        buildGuidedFallbackChoice("Occupied", fieldKey, "Carry protection and daily cleanup."),
        buildGuidedFallbackChoice("Vacant", fieldKey, "Carry open access in an empty space."),
        buildGuidedFallbackChoice("Occupied with furniture", fieldKey, "Carry furniture moving and protection."),
      ],
    };
  }
  if (promptIntent === "commercial_access") {
    const question = environment === "warehouse"
      ? "For this step, tell me whether this is active warehouse work, open access, or after-hours work."
      : (environment === "office_suite"
        ? "For this step, tell me whether this is occupied offices, a vacant suite, or after-hours access."
        : "For this step, tell me whether this is occupied work, open access, or after-hours work.");
    return {
      nextBestQuestion: { fieldKey, sectionKey, question },
      suggestedChoices,
    };
  }
  if (promptIntent === "flooring_quantity") {
    return {
      nextBestQuestion: {
        fieldKey,
        sectionKey,
        question: "For this step, tell me about how much floor area we are covering.",
      },
      suggestedChoices,
    };
  }
  if (promptIntent === "drywall_repair_count") {
    return {
      nextBestQuestion: {
        fieldKey,
        sectionKey,
        question: "For this step, tell me how many repair areas or openings need drywall work.",
      },
      suggestedChoices,
    };
  }
  if (promptIntent === "materials_path") {
    return {
      nextBestQuestion: {
        fieldKey: "ui.materialsMode",
        sectionKey: "materials",
        question: "For this step, tell me whether I should carry materials as an allowance, itemize them, or keep this labor only.",
      },
      suggestedChoices: suggestedChoices.length ? suggestedChoices : [
        buildGuidedFallbackChoice("Carry materials allowance", "ui.materialsMode", "Use one materials allowance line.", "blanket"),
        buildGuidedFallbackChoice("Itemize materials", "ui.materialsMode", "List materials line by line.", "itemized"),
        buildGuidedFallbackChoice("Labor only for now", "ui.materialsMode", "Carry labor first and keep materials separate."),
      ],
    };
  }
  if (promptIntent === "trade_definition") {
    return {
      nextBestQuestion: {
        fieldKey,
        sectionKey,
        question: "For this step, tell me what kind of job this is: painting, drywall repair, flooring, stucco repair, or something else.",
      },
      suggestedChoices,
    };
  }
  if (promptIntent === "scope_clarification") {
    return {
      nextBestQuestion: {
        fieldKey,
        sectionKey,
        question: "For this step, tell me the main work I should carry for this job.",
      },
      suggestedChoices,
    };
  }
  if (expectedAnswerMode === "quantity_extent") {
    return {
      nextBestQuestion: {
        fieldKey,
        sectionKey,
        question: "For this step, give me the best size read you have: about how much area, how many rooms, or how many repair areas?",
      },
      suggestedChoices,
    };
  }
  if (expectedAnswerMode === "single_select") {
    return {
      nextBestQuestion: {
        fieldKey,
        sectionKey,
        question: "For this item, tell me which option fits best.",
      },
      suggestedChoices,
    };
  }

  return {
    nextBestQuestion: {
      fieldKey,
      sectionKey,
      question: looksLikeWeakGuidedFallbackPrompt(promptText)
        ? buildGuidedBuildAssistantMessage(body, fieldKey, Array.isArray(body?.fieldRegistryMetadata) ? body.fieldRegistryMetadata : [])
        : promptText,
    },
    suggestedChoices,
  };
}

function sanitizeGuidedBuildResponse(raw, fallback) {
  const src = raw && typeof raw === "object" ? raw : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const safeAssistantMessage = "I couldn’t complete that AI step right now. You can keep filling the builder manually and nothing you already entered will be lost.";
  const safeFieldKeyPattern = /^[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*$/i;
  const safeTagPattern = /^[a-z0-9:_-]{1,48}$/i;

  function looksLikeUnsafeGuidedText(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    if ((text.startsWith("{") || text.startsWith("[")) && /"?(error|detail|message|type|code)"?\s*:/i.test(text)) return true;
    return [
      /\binvalid[_\s-]?api[_\s-]?key\b/i,
      /\bapi[_\s-]?key\b/i,
      /\bunauthorized\b/i,
      /\bforbidden\b/i,
      /\brate[_\s-]?limit\b/i,
      /\bprovider\b/i,
      /\bgroq\b/i,
      /\bollama\b/i,
      /\bhttp\s*\d{3}\b/i,
      /\bstatus\s*\d{3}\b/i,
      /\b(fetch failed|request failed|connection reset|socket hang up|timed out|timeout)\b/i,
      /\btraceback\b/i,
      /\bstack\b/i,
      /\bexception\b/i,
      /\berror\b\s*:/i,
      /"type"\s*:\s*"[^"]+"/i,
      /"code"\s*:\s*"[^"]+"/i,
    ].some((pattern) => pattern.test(text));
  }

  function sanitizeVisibleText(value, fallbackValue = "", max = 280) {
    const text = String(value || "").trim();
    if (!text) return String(fallbackValue || "").trim();
    if (looksLikeUnsafeGuidedText(text)) return String(fallbackValue || "").trim();
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  }

  function toSentenceCase(value) {
    const text = String(value || "").trim();
    if (!text) return "";
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
  }

  function stripGuidedSpeakerLead(value) {
    return String(value || "")
      .trim()
      .replace(/^(?:i am|i'm|im|we are|we're)\s+/i, "")
      .replace(/^(?:need(?:s|ed)?\s+to|need|want(?:s|ed)?\s+to|looking\s+to)\s+/i, "")
      .replace(/^(?:pricing|estimating|quoting)\s+/i, "");
  }

  function sanitizeGuidedPublishText(fieldKey, value, fallbackValue = "", max = 220) {
    if (typeof value !== "string") return value;
    const safeText = sanitizeVisibleText(value, fallbackValue, max);
    if (!safeText) return safeText;
    if (typeof safeText !== "string") return safeText;
    let text = stripGuidedSpeakerLead(safeText)
      .replace(/\s+/g, " ")
      .replace(/\s+,/g, ",")
      .replace(/\s+\./g, ".")
      .replace(/\s*;\s*/g, "; ")
      .trim();
    if (!text) return "";
    if (fieldKey === "scopeNotes" || fieldKey === "tradeInsert.text" || fieldKey === "additionalNotes" || fieldKey === "__intentSummary") {
      text = toSentenceCase(text);
      if (fieldKey !== "__intentSummary" && !/[.!?]$/.test(text)) text = `${text}.`;
    }
    return text.length > max ? `${text.slice(0, max - 1)}...` : text;
  }

  function sanitizeFieldKeys(values, fallbackValues = []) {
    const source = Array.isArray(values) ? values : fallbackValues;
    return source
      .map((value) => String(value || "").trim())
      .filter((value) => safeFieldKeyPattern.test(value));
  }

  function sanitizeReasoningTags(values, fallbackValues = []) {
    const source = Array.isArray(values) ? values : fallbackValues;
    return source
      .map((value) => String(value || "").trim())
      .filter((value) => safeTagPattern.test(value) && !looksLikeUnsafeGuidedText(value));
  }

  function sanitizeSuggestedChoices(values, fallbackValues = []) {
    const source = Array.isArray(values) ? values : fallbackValues;
    return source
      .map((choice, index) => ({
        id: String(choice?.id || `${choice?.fieldKey || "choice"}:${choice?.value ?? index}`),
        label: sanitizeVisibleText(choice?.label || choice?.title || choice?.value || "", ""),
        description: sanitizeVisibleText(choice?.description || "", "", 160),
        value: choice?.value,
        fieldKey: sanitizeFieldKeys([choice?.fieldKey], [])[0] || "",
      }))
      .filter((choice) => choice.label && choice.fieldKey)
      .slice(0, 3);
  }

  function sanitizeExtractedFieldValues(values, fallbackValues = []) {
    const source = Array.isArray(values) ? values : fallbackValues;
    return source
      .map((entry) => ({
        key: sanitizeFieldKeys([entry?.key], [])[0] || "",
        value: sanitizeGuidedPublishText(
          sanitizeFieldKeys([entry?.key], [])[0] || "",
          entry?.value,
          entry?.value,
          220
        ),
        confidence: Number(entry?.confidence || 0),
        source: String(entry?.source || "ai").trim() || "ai",
        reason: sanitizeVisibleText(entry?.reason || "", "", 160),
      }))
      .filter((entry) => entry.key);
  }

  function sanitizeInterpretedIntent(value, fallbackValue = null) {
    const source = value && typeof value === "object"
      ? value
      : (fallbackValue && typeof fallbackValue === "object" ? fallbackValue : { kind: String(value || "").trim() });
    return compactGuidedObject({
      kind: sanitizeVisibleText(source?.kind || source?.type || "", "", 48).toLowerCase(),
      summary: sanitizeGuidedPublishText("__intentSummary", source?.summary || source?.description || "", "", 160),
      targetField: sanitizeFieldKeys([source?.targetField || source?.fieldKey], [])[0] || "",
      tradeKey: sanitizeVisibleText(source?.tradeKey || source?.matchedTradeKey || "", "", 48),
    });
  }

  function sanitizeMissingContext(values, fallbackValues = []) {
    const source = Array.isArray(values) ? values : fallbackValues;
    return source
      .map((entry) => {
        if (entry && typeof entry === "object") {
          return sanitizeVisibleText(entry?.question || entry?.label || entry?.key || entry?.fieldKey || "", "", 140);
        }
        return sanitizeVisibleText(entry, "", 140);
      })
      .filter(Boolean)
      .slice(0, 4);
  }

  function sanitizeNextBestQuestion(value, fallbackValue = null, fallbackFieldKey = "", fallbackQuestion = "") {
    const source = value && typeof value === "object"
      ? value
      : (fallbackValue && typeof fallbackValue === "object"
        ? fallbackValue
        : { question: value, fieldKey: fallbackFieldKey });
    return compactGuidedObject({
      fieldKey: sanitizeFieldKeys([source?.fieldKey || source?.key], [fallbackFieldKey])[0] || "",
      sectionKey: sanitizeFieldKeys([source?.sectionKey], [])[0] || "",
      question: sanitizeVisibleText(source?.question || source?.assistantMessage || fallbackQuestion || "", "", 180),
    });
  }

  function sanitizeStepResolution(value, fallbackValue = null) {
    const source = value && typeof value === "object"
      ? value
      : (fallbackValue && typeof fallbackValue === "object" ? fallbackValue : {});
    return compactGuidedObject({
      status: sanitizeVisibleText(source?.status || "", "", 48).toLowerCase(),
      answeredComponents: sanitizeFieldKeys(source?.answeredComponents, []).slice(0, 6),
      missingComponents: sanitizeFieldKeys(source?.missingComponents, []).slice(0, 6),
      invalidReason: sanitizeVisibleText(source?.invalidReason || "", "", 140),
      markers: slimGuidedPlannerState(source?.markers),
    });
  }

  function mergeConfidenceByField(baseMap, writes) {
    const next = baseMap && typeof baseMap === "object" ? { ...baseMap } : {};
    for (const write of Array.isArray(writes) ? writes : []) {
      if (!write?.key) continue;
      next[write.key] = Number(write?.confidence || 0);
    }
    return next;
  }

  function isEchoLikeGuidedWrite(userAnswer, proposedValue) {
    if (typeof proposedValue !== "string") return false;
    const answer = normalizeLooseGuidedText(userAnswer);
    const value = normalizeLooseGuidedText(proposedValue);
    if (!answer || !value) return false;
    if (answer === value) return true;
    if (countGuidedWords(answer) < 4 || countGuidedWords(value) < 4) return false;
    return answer.includes(value) || value.includes(answer);
  }

  function isScopeIntentKind(kind) {
    const value = String(kind || "").trim().toLowerCase();
    return value.includes("scope") || value.includes("painting") || value.includes("trade");
  }

  function isNotesIntentKind(kind) {
    const value = String(kind || "").trim().toLowerCase();
    return value.includes("note") || value.includes("exclusion") || value.includes("payment") || value.includes("warranty");
  }

  function isAllowedGuidedWrite(questionKey, entry, interpretedIntent, userAnswer) {
    const writeKey = String(entry?.key || "").trim();
    const confidence = Number(entry?.confidence || 0);
    const intentKind = String(interpretedIntent?.kind || "").trim().toLowerCase();
    if (!writeKey) return false;

    if (questionKey === "scopeNotes") {
      if (writeKey === "tradeInsert.key") return confidence >= 0.86 && isScopeIntentKind(intentKind);
      if (writeKey === "scopeNotes") return confidence >= 0.9 && isScopeIntentKind(intentKind) && !isEchoLikeGuidedWrite(userAnswer, entry?.value);
      return false;
    }

    if (questionKey === "tradeInsert.key") {
      return writeKey === "tradeInsert.key" && confidence >= 0.84;
    }

    if (questionKey === "additionalNotes") {
      return writeKey === "additionalNotes" && confidence >= 0.88 && isNotesIntentKind(intentKind) && !isEchoLikeGuidedWrite(userAnswer, entry?.value);
    }

    return true;
  }

  const suggestedChoices = sanitizeSuggestedChoices(src.suggestedChoices, base.suggestedChoices || []);
  const proposedFieldWrites = sanitizeExtractedFieldValues(
    src.proposedFieldWrites || src.extractedFieldValues,
    base.proposedFieldWrites || base.extractedFieldValues || []
  );
  const currentQuestionKey = sanitizeFieldKeys([src.questionKey], [base.questionKey || ""])[0] || "";
  const currentUserAnswer = sanitizeVisibleText(src.userAnswer, base.userAnswer || "", 280);
  const interpretedIntent = sanitizeInterpretedIntent(src.interpretedIntent, base.interpretedIntent);
  const stepResolution = sanitizeStepResolution(src.stepResolution, base.stepResolution);
  const nextBestQuestion = sanitizeNextBestQuestion(
    src.nextBestQuestion,
    base.nextBestQuestion,
    sanitizeFieldKeys([src.recommendedNextQuestion], [base.recommendedNextQuestion || currentQuestionKey])[0] || "",
    sanitizeVisibleText(src.assistantMessage, base.assistantMessage || "")
  );
  const shouldAutoApplyRequested = src.shouldAutoApply === true || base.shouldAutoApply === true;
  const shouldAskFollowUp = src.shouldAskFollowUp === true
    || base.shouldAskFollowUp === true
    || (!shouldAutoApplyRequested && !!nextBestQuestion.question);
  const extractedFieldValues = shouldAutoApplyRequested
    ? proposedFieldWrites.filter((entry) => isAllowedGuidedWrite(currentQuestionKey, entry, interpretedIntent, currentUserAnswer))
    : [];
  const confidenceByField = mergeConfidenceByField(
    src.confidenceByField && typeof src.confidenceByField === "object"
      ? src.confidenceByField
      : (base.confidenceByField || {}),
    proposedFieldWrites
  );
  const assistantMessage = shouldAskFollowUp && nextBestQuestion.question
    ? nextBestQuestion.question
    : sanitizeVisibleText(
      src.assistantMessage,
      sanitizeVisibleText(base.assistantMessage, safeAssistantMessage)
        || safeAssistantMessage
        || "Let’s keep filling the builder."
    );
  const unresolvedFields = Array.from(new Set([
    ...sanitizeFieldKeys(src.unresolvedFields, base.unresolvedFields || []),
    ...((shouldAskFollowUp && nextBestQuestion.fieldKey) ? [nextBestQuestion.fieldKey] : []),
  ]));

  return {
    assistantMessage,
    interpretedIntent,
    proposedFieldWrites,
    suggestedChoices,
    extractedFieldValues,
    confidenceByField,
    missingContext: sanitizeMissingContext(src.missingContext, base.missingContext || []),
    nextBestQuestion,
    stepResolution,
    shouldAutoApply: shouldAutoApplyRequested && extractedFieldValues.length > 0,
    shouldAskFollowUp,
    fieldsNeedingConfirmation: sanitizeFieldKeys(src.fieldsNeedingConfirmation, base.fieldsNeedingConfirmation || []),
    unresolvedFields,
    recommendedNextSection: sanitizeFieldKeys([src.recommendedNextSection], [base.recommendedNextSection || nextBestQuestion.sectionKey || ""])[0] || "",
    recommendedNextQuestion: sanitizeFieldKeys([src.recommendedNextQuestion], [base.recommendedNextQuestion || nextBestQuestion.fieldKey || ""])[0] || "",
    reasoningTags: sanitizeReasoningTags(src.reasoningTags, base.reasoningTags || []),
    warnings: (Array.isArray(src.warnings) ? src.warnings : (base.warnings || []))
      .map((value) => sanitizeVisibleText(value, "", 160))
      .filter(Boolean),
  };
}

function buildGuidedBuildFallback(body) {
  const mode = body?.mode === "invoice" ? "invoice" : "estimate";
  const unresolvedFields = Array.isArray(body?.unresolvedFields)
    ? body.unresolvedFields.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const activeFields = Array.isArray(body?.fieldRegistryMetadata) ? body.fieldRegistryMetadata.filter(Boolean) : [];
  const currentQuestionKey = String(body?.questionKey || activeFields?.[0]?.key || "").trim();
  const nextField = unresolvedFields[0] || currentQuestionKey;
  const nextSection = String(body?.sectionKey || body?.recommendedNextSection || activeFields?.[0]?.section || "customer").trim();
  const optionsMap = body?.availableOptionsByField && typeof body.availableOptionsByField === "object"
    ? body.availableOptionsByField
    : {};
  const rawChoices = Array.isArray(optionsMap?.[nextField]) ? optionsMap[nextField] : [];
  const stepClarificationPlan = buildGuidedStepClarificationFallback(body, currentQuestionKey || nextField);
  const fallbackPlan = stepClarificationPlan || buildGuidedFallbackPlan(body, nextField);
  const suggestedChoices = (fallbackPlan?.suggestedChoices?.length
    ? fallbackPlan.suggestedChoices
    : rawChoices.slice(0, 3).map((choice, index) => ({
      id: String(choice?.id || `${nextField}:${choice?.value ?? index}`),
      label: String(choice?.label || choice?.value || "").trim(),
      description: String(choice?.description || "").trim(),
      value: choice?.value,
      fieldKey: nextField,
    })).filter((choice) => choice.label));
  const followUp = fallbackPlan?.nextBestQuestion?.question
    || buildGuidedBuildAssistantMessage(body, nextField, activeFields)
    || `What should I carry next for this ${mode === "invoice" ? "invoice" : "estimate"}?`;
  const recommendedField = String(fallbackPlan?.nextBestQuestion?.fieldKey || nextField || "").trim();
  const recommendedSection = String(fallbackPlan?.nextBestQuestion?.sectionKey || nextSection || "review").trim();

  return {
    questionKey: currentQuestionKey,
    userAnswer: String(body?.userAnswer || "").trim(),
    assistantMessage: followUp,
    interpretedIntent: {
      kind: recommendedField === "scopeNotes" && looksLikeRichScopeAnswer(body?.userAnswer) ? "scope_description" : "follow_up",
      targetField: recommendedField,
    },
    proposedFieldWrites: [],
    suggestedChoices,
    extractedFieldValues: [],
    confidenceByField: {},
    missingContext: fallbackPlan?.missingContext || [],
    nextBestQuestion: {
      fieldKey: recommendedField,
      sectionKey: recommendedSection || "review",
      question: followUp,
    },
    shouldAutoApply: false,
    shouldAskFollowUp: true,
    fieldsNeedingConfirmation: [],
    unresolvedFields: recommendedField ? [recommendedField] : [],
    recommendedNextSection: recommendedSection || "review",
    recommendedNextQuestion: recommendedField,
    reasoningTags: ["fallback", recommendedField ? `field:${recommendedField}` : ""].filter(Boolean),
    warnings: [],
  };
}

function buildGuidedBuildFailureFallback(fallback) {
  const base = fallback && typeof fallback === "object" ? fallback : {};
  return sanitizeGuidedBuildResponse({
    ...base,
    assistantMessage: "I couldn’t complete that AI step right now. You can keep filling the builder manually and nothing you already entered will be lost.",
    warnings: [],
  }, base);
}

const GUIDED_BUILD_MAX_FIELDS = 4;
const GUIDED_BUILD_MAX_PRIOR_ANSWERS = 3;
const GUIDED_BUILD_MAX_TEXT = 160;

function trimGuidedText(value, max = GUIDED_BUILD_MAX_TEXT) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.length > max ? `${raw.slice(0, max - 1)}...` : raw;
}

function compactGuidedObject(source) {
  const out = {};
  for (const [key, value] of Object.entries(source || {})) {
    if (value === null || value === undefined) continue;
    if (Array.isArray(value)) {
      if (!value.length) continue;
      out[key] = value;
      continue;
    }
    if (typeof value === "object") {
      const nested = compactGuidedObject(value);
      if (!Object.keys(nested).length) continue;
      out[key] = nested;
      continue;
    }
    if (typeof value === "string" && !value.trim()) continue;
    out[key] = value;
  }
  return out;
}

function isGuidedFieldComplete(field) {
  return String(field?.status || "").trim().toLowerCase() === "complete";
}

function slimGuidedFieldMetadata(rawFields, questionKey) {
  const fields = Array.isArray(rawFields) ? rawFields.filter(Boolean) : [];
  const picked = [];
  const seen = new Set();

  function push(field) {
    const key = String(field?.key || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    picked.push(field);
  }

  if (questionKey) push(fields.find((field) => String(field?.key || "").trim() === questionKey));
  fields.filter((field) => !isGuidedFieldComplete(field)).forEach(push);
  fields.forEach(push);

  return picked.slice(0, GUIDED_BUILD_MAX_FIELDS).map((field) => compactGuidedObject({
    key: String(field?.key || "").trim(),
    label: trimGuidedText(field?.label, 80),
    inputType: String(field?.inputType || "").trim(),
    valueType: String(field?.valueType || "").trim(),
    required: field?.required === true ? true : undefined,
    allowCustom: field?.allowCustom === true ? true : undefined,
    confirmationRequired: field?.confirmationRequired === true ? true : undefined,
    status: String(field?.status || "").trim(),
  })).filter((field) => field.key);
}

function slimGuidedCurrentValues(formSnapshot, fieldKeys) {
  const source = formSnapshot?.currentFieldValues && typeof formSnapshot.currentFieldValues === "object"
    ? formSnapshot.currentFieldValues
    : (formSnapshot?.activeFieldValues && typeof formSnapshot.activeFieldValues === "object"
      ? formSnapshot.activeFieldValues
      : null);
  if (!source) return {};
  return fieldKeys.reduce((acc, key) => {
    const raw = source[key];
    const value = trimGuidedText(raw, 120);
    if (value) acc[key] = value;
    return acc;
  }, {});
}

function slimGuidedOptionsMap(optionsMap, fieldKeys) {
  const source = optionsMap && typeof optionsMap === "object" ? optionsMap : {};
  const out = {};
  for (const key of fieldKeys) {
    const raw = Array.isArray(source[key]) ? source[key] : [];
    if (!raw.length) continue;
    let limit = 12;
    if (key === "customer.state") limit = 50;
    if (key === "labor.lines") limit = 8;
    const trimmed = raw.slice(0, limit).map((option) => compactGuidedObject({
      value: option?.value,
      label: trimGuidedText(option?.label || option?.value, 80),
      description: trimGuidedText(option?.description, 120),
    })).filter((option) => String(option?.label || option?.value || "").trim());
    if (trimmed.length) out[key] = trimmed;
  }
  return out;
}

function shouldIncludeGuidedSelectedCustomer(sectionKey, questionKey, fields) {
  const keys = [questionKey, ...fields.map((field) => String(field?.key || "").trim())]
    .filter(Boolean);
  return sectionKey === "customer"
    || keys.includes("job.due")
    || keys.some((key) => key.startsWith("customer."));
}

function slimGuidedSelectedCustomer(rawCustomer) {
  const customer = rawCustomer && typeof rawCustomer === "object" ? rawCustomer : null;
  if (!customer) return null;
  return compactGuidedObject({
    id: String(customer?.id || "").trim(),
    name: trimGuidedText(customer?.name || customer?.displayName || customer?.fullName || customer?.companyName, 80),
    type: String(customer?.type || "").trim(),
    netTermsLabel: trimGuidedText(customer?.netTermsLabel || customer?.netTerms, 40),
    hasBillingAddress: customer?.hasBillingAddress || customer?.billingAddress ? true : undefined,
    hasProjectAddress: customer?.hasProjectAddress || customer?.projectAddress ? true : undefined,
  });
}

function slimGuidedPriorAnswers(entries) {
  const items = Array.isArray(entries) ? entries.filter(Boolean) : [];
  return items.slice(-GUIDED_BUILD_MAX_PRIOR_ANSWERS).map((entry) => compactGuidedObject({
    sectionKey: String(entry?.sectionKey || "").trim(),
    questionKey: String(entry?.questionKey || "").trim(),
    prompt: trimGuidedText(entry?.prompt, 140),
    answer: trimGuidedText(entry?.answer, 120),
  })).filter((entry) => Object.keys(entry).length);
}

function slimGuidedUnresolvedFields(body, activeFields, questionKey) {
  const ordered = [
    questionKey,
    ...(Array.isArray(body?.unresolvedFields) ? body.unresolvedFields : []),
    ...activeFields.filter((field) => !isGuidedFieldComplete(field)).map((field) => field.key),
  ];
  return Array.from(new Set(ordered.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, GUIDED_BUILD_MAX_FIELDS);
}

function slimGuidedSectionRules(sectionRules, sectionKey) {
  const source = sectionRules && typeof sectionRules === "object" ? sectionRules : {};
  return compactGuidedObject({
    key: String(source?.key || sectionKey || "").trim(),
    title: trimGuidedText(source?.title || source?.label, 80),
    questionPrompt: trimGuidedText(source?.questionPrompt || source?.prompt, 140),
    aiPromptFraming: trimGuidedText(source?.aiPromptFraming, 160),
    extractionRules: (Array.isArray(source?.extractionRules) ? source.extractionRules : [])
      .map((rule) => trimGuidedText(rule, 120))
      .filter(Boolean)
      .slice(0, 3),
    writebackRules: (Array.isArray(source?.writebackRules) ? source.writebackRules : [])
      .map((rule) => trimGuidedText(rule, 120))
      .filter(Boolean)
      .slice(0, 3),
  });
}

function slimGuidedPlannerState(plannerState) {
  const source = plannerState && typeof plannerState === "object" ? plannerState : {};
  return compactGuidedObject({
    tradeRecognized: source?.tradeRecognized === true ? true : undefined,
    tradeKey: trimGuidedText(source?.tradeKey, 48),
    painting: source?.painting === true ? true : undefined,
    flooring: source?.flooring === true ? true : undefined,
    drywallRepair: source?.drywallRepair === true ? true : undefined,
    commercialContext: source?.commercialContext === true ? true : undefined,
    exteriorAccess: source?.exteriorAccess === true ? true : undefined,
    stuccoRepair: source?.stuccoRepair === true ? true : undefined,
    scopeCaptured: source?.scopeCaptured === true ? true : undefined,
    coverageKnown: source?.coverageKnown === true ? true : undefined,
    quantityBasisKnown: source?.quantityBasisKnown === true ? true : undefined,
    occupancyKnown: source?.occupancyKnown === true ? true : undefined,
    accessSetupKnown: source?.accessSetupKnown === true ? true : undefined,
    prepKnown: source?.prepKnown === true ? true : undefined,
    demoKnown: source?.demoKnown === true ? true : undefined,
    transitionsKnown: source?.transitionsKnown === true ? true : undefined,
    repairCountKnown: source?.repairCountKnown === true ? true : undefined,
    patchVsReplaceKnown: source?.patchVsReplaceKnown === true ? true : undefined,
    textureKnown: source?.textureKnown === true ? true : undefined,
    paintTouchupKnown: source?.paintTouchupKnown === true ? true : undefined,
    interiorExteriorKnown: source?.interiorExteriorKnown === true ? true : undefined,
    colorKnown: source?.colorKnown === true ? true : undefined,
    coatsKnown: source?.coatsKnown === true ? true : undefined,
    finishKnown: source?.finishKnown === true ? true : undefined,
    materialsAllowanceIntent: source?.materialsAllowanceIntent === true ? true : undefined,
    materialsPathKnown: source?.materialsPathKnown === true ? true : undefined,
    notesResolved: source?.notesResolved === true ? true : undefined,
    exclusionsKnown: source?.exclusionsKnown === true ? true : undefined,
    scheduleKnown: source?.scheduleKnown === true ? true : undefined,
    suppliedMaterialsKnown: source?.suppliedMaterialsKnown === true ? true : undefined,
    furnitureKnown: source?.furnitureKnown === true ? true : undefined,
    scopeReadyForNotes: source?.scopeReadyForNotes === true ? true : undefined,
    nextQuestionReason: trimGuidedText(source?.nextQuestionReason, 80),
    activeFieldKey: trimGuidedText(source?.activeFieldKey, 80),
    activeSectionKey: trimGuidedText(source?.activeSectionKey, 80),
    lastAnsweredFieldKey: trimGuidedText(source?.lastAnsweredFieldKey, 80),
    lastResolutionSource: trimGuidedText(source?.lastResolutionSource, 40),
  });
}

function slimGuidedStepComponents(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => trimGuidedText(value, 48))
      .filter(Boolean)
  )).slice(0, 6);
}

function slimGuidedActiveStep(activeStep, questionKey, sectionKey) {
  const source = activeStep && typeof activeStep === "object" ? activeStep : {};
  return compactGuidedObject({
    canonicalStepId: trimGuidedText(source?.canonicalStepId || source?.activeStepId, 120),
    fieldKey: trimGuidedText(source?.fieldKey || questionKey, 80),
    sectionKey: trimGuidedText(source?.sectionKey || sectionKey, 48),
    promptText: trimGuidedText(source?.promptText || source?.prompt, 180),
    promptIntent: trimGuidedText(source?.promptIntent, 64),
    expectedAnswerMode: trimGuidedText(source?.expectedAnswerMode, 48),
    expectedComponents: slimGuidedStepComponents(source?.expectedComponents),
    resolvedComponents: slimGuidedStepComponents(source?.resolvedComponents),
    missingComponents: slimGuidedStepComponents(source?.missingComponents),
    repeatedUnresolvedCount: Number(source?.repeatedUnresolvedCount || 0) || undefined,
    turnDiagnosis: trimGuidedText(source?.turnDiagnosis, 48),
    suggestedChoices: slimGuidedOptionsMap({ active: Array.isArray(source?.suggestedChoices) ? source.suggestedChoices : [] }, ["active"]).active,
    plannerState: slimGuidedPlannerState(source?.plannerState),
  });
}

function slimGuidedActiveBlocker(activeBlocker, activeStep, questionKey, sectionKey) {
  const source = activeBlocker && typeof activeBlocker === "object" ? activeBlocker : {};
  const fallback = activeStep && typeof activeStep === "object" ? activeStep : {};
  const allowedChoices = Array.isArray(source?.allowedChoices)
    ? source.allowedChoices
    : (Array.isArray(fallback?.suggestedChoices) ? fallback.suggestedChoices : []);
  const promptPhase = String(source?.promptPhase || "").trim().toLowerCase();
  return compactGuidedObject({
    activeSectionKey: trimGuidedText(source?.activeSectionKey || fallback?.sectionKey || sectionKey, 48),
    activeQuestionKey: trimGuidedText(source?.activeQuestionKey || fallback?.fieldKey || questionKey, 80),
    activeStepId: trimGuidedText(source?.activeStepId || fallback?.canonicalStepId || fallback?.activeStepId, 120),
    blockerFamily: trimGuidedText(source?.blockerFamily, 48),
    promptIntent: trimGuidedText(source?.promptIntent || fallback?.promptIntent, 64),
    expectedAnswerShape: trimGuidedText(source?.expectedAnswerShape || fallback?.expectedAnswerMode, 48),
    allowedChoices: allowedChoices
      .slice(0, 6)
      .map((choice) => compactGuidedObject({
        id: String(choice?.id || "").trim(),
        label: trimGuidedText(choice?.label || choice?.value, 80),
        description: trimGuidedText(choice?.description, 120),
        value: choice?.value,
        fieldKey: trimGuidedText(choice?.fieldKey, 80),
      }))
      .filter((choice) => String(choice?.label || choice?.value || "").trim()),
    requiredComponents: slimGuidedStepComponents(source?.requiredComponents || fallback?.expectedComponents),
    missingComponents: slimGuidedStepComponents(source?.missingComponents || fallback?.missingComponents),
    resolvedComponents: slimGuidedStepComponents(source?.resolvedComponents || fallback?.resolvedComponents),
    unresolvedCount: Number(source?.unresolvedCount || fallback?.repeatedUnresolvedCount || 0) || undefined,
    promptPhase: ["initial", "clarify", "narrow_clarify", "repair", "confirm"].includes(promptPhase) ? promptPhase : undefined,
    promptText: trimGuidedText(source?.promptText || fallback?.promptText || fallback?.prompt, 180),
    liveDraftContext: compactGuidedObject(source?.liveDraftContext),
  });
}

function slimGuidedTurnState(turnState) {
  const source = turnState && typeof turnState === "object" ? turnState : {};
  return compactGuidedObject({
    repeatedUnresolvedCount: Number(source?.repeatedUnresolvedCount || 0) || undefined,
    turnDiagnosis: trimGuidedText(source?.turnDiagnosis, 48),
  });
}

function slimGuidedEstimateContext(estimateContext) {
  const source = estimateContext && typeof estimateContext === "object" ? estimateContext : {};
  return compactGuidedObject({
    trade: trimGuidedText(source?.trade, 80),
    scope: trimGuidedText(source?.scope, 180),
    materialsPath: trimGuidedText(source?.materialsPath, 80),
    notes: trimGuidedText(source?.notes, 180),
  });
}

function buildGuidedBuildPromptPayload(body) {
  const mode = body?.mode === "invoice" ? "invoice" : "estimate";
  const sectionKey = String(body?.sectionKey || "").trim() || "customer";
  const questionKey = String(body?.questionKey || "").trim();
  const activeFields = slimGuidedFieldMetadata(body?.fieldRegistryMetadata, questionKey);
  const fieldKeys = activeFields.map((field) => field.key);
  const slimActiveStep = slimGuidedActiveStep(body?.activeStep, questionKey, sectionKey);
  const selectedCustomer = shouldIncludeGuidedSelectedCustomer(sectionKey, questionKey, activeFields)
    ? slimGuidedSelectedCustomer(body?.selectedCustomer || body?.context?.selectedCustomerSummary)
    : null;
  const currentFieldValues = slimGuidedCurrentValues(body?.formSnapshot, fieldKeys);

  return compactGuidedObject({
    mode,
    sectionKey,
    questionKey,
    currentPrompt: trimGuidedText(body?.currentPrompt, 180),
    userAnswer: trimGuidedText(body?.userAnswer, 280),
    sectionRules: slimGuidedSectionRules(body?.sectionRules, sectionKey),
    fieldRegistryMetadata: activeFields,
    formSnapshot: Object.keys(currentFieldValues).length ? { currentFieldValues } : undefined,
    selectedCustomer,
    availableOptionsByField: slimGuidedOptionsMap(body?.availableOptionsByField, fieldKeys),
    priorGuidedAnswers: slimGuidedPriorAnswers(body?.priorGuidedAnswers),
    unresolvedFields: slimGuidedUnresolvedFields(body, activeFields, questionKey),
    plannerState: slimGuidedPlannerState(body?.plannerState),
    activeStep: slimActiveStep,
    activeBlocker: slimGuidedActiveBlocker(body?.activeBlocker, slimActiveStep, questionKey, sectionKey),
    turnState: slimGuidedTurnState(body?.turnState),
    estimateContext: slimGuidedEstimateContext(body?.estimateContext),
  });
}

const GUIDED_ADAPTIVE_PROMPT_VARIANTS = new Set(["initial", "clarify", "narrow_clarify", "repair", "confirm"]);
const GUIDED_ADAPTIVE_ANSWER_CLASSIFICATIONS = new Set(["resolved", "partial", "unresolved_clarify", "invalid_for_step", "repeated_unresolved"]);

function buildGuidedAdaptiveFallback(promptPayload, fallback) {
  const blocker = promptPayload?.activeBlocker || {};
  const fallbackQuestion = trimGuidedText(
    fallback?.nextBestQuestion?.question
      || fallback?.assistantMessage
      || blocker?.promptText
      || promptPayload?.currentPrompt,
    180
  );
  const promptPhase = String(blocker?.promptPhase || "").trim().toLowerCase();
  return {
    adaptivePrompt: compactGuidedObject({
      promptText: fallbackQuestion,
      promptVariant: GUIDED_ADAPTIVE_PROMPT_VARIANTS.has(promptPhase)
        ? promptPhase
        : (Number(blocker?.unresolvedCount || 0) > 0 ? "narrow_clarify" : "clarify"),
      answerClassification: Number(blocker?.unresolvedCount || 0) > 0 ? "repeated_unresolved" : "unresolved_clarify",
      clarificationText: fallbackQuestion,
      missingComponents: slimGuidedStepComponents(blocker?.missingComponents || blocker?.requiredComponents),
      normalizedAnswer: "",
      interpretedSelections: [],
      reasoningSummary: "Local blocker-scoped adaptive fallback.",
      confidence: 0,
    }),
  };
}

function sanitizeGuidedAdaptivePromptResponse(raw, promptPayload, fallback) {
  const source = raw && typeof raw === "object"
    ? (raw?.adaptivePrompt && typeof raw.adaptivePrompt === "object" ? raw.adaptivePrompt : raw)
    : {};
  const blocker = promptPayload?.activeBlocker || {};
  const fallbackResponse = buildGuidedAdaptiveFallback(promptPayload, fallback);
  const fallbackPrompt = fallbackResponse.adaptivePrompt || {};
  const promptVariant = String(source?.promptVariant || "").trim().toLowerCase();
  const answerClassification = String(source?.answerClassification || "").trim().toLowerCase();
  const promptText = trimGuidedText(source?.promptText, 180);
  const clarificationText = trimGuidedText(source?.clarificationText, 180);
  const interpretedSelections = Array.isArray(source?.interpretedSelections)
    ? source.interpretedSelections.map((value) => trimGuidedText(value, 80)).filter(Boolean).slice(0, 6)
    : [];
  const missingComponents = slimGuidedStepComponents(source?.missingComponents || blocker?.missingComponents);

  if (!GUIDED_ADAPTIVE_ANSWER_CLASSIFICATIONS.has(answerClassification)) {
    return fallbackResponse;
  }

  if (answerClassification !== "resolved" && !promptText && !clarificationText) {
    return fallbackResponse;
  }

  return {
    adaptivePrompt: compactGuidedObject({
      promptText: promptText || clarificationText || fallbackPrompt.promptText,
      promptVariant: GUIDED_ADAPTIVE_PROMPT_VARIANTS.has(promptVariant) ? promptVariant : fallbackPrompt.promptVariant,
      answerClassification,
      clarificationText: clarificationText || promptText || fallbackPrompt.clarificationText,
      missingComponents: missingComponents.length ? missingComponents : fallbackPrompt.missingComponents,
      normalizedAnswer: trimGuidedText(source?.normalizedAnswer, 220),
      interpretedSelections,
      reasoningSummary: trimGuidedText(source?.reasoningSummary, 180),
      confidence: Number.isFinite(Number(source?.confidence)) ? Math.max(0, Math.min(1, Number(source.confidence))) : fallbackPrompt.confidence,
    }),
  };
}

function shouldSkipGuidedBuildAI(promptPayload) {
  const sectionKey = String(promptPayload?.sectionKey || "").trim();
  const questionKey = String(promptPayload?.questionKey || "").trim();
  const userAnswer = String(promptPayload?.userAnswer || "").trim();
  if (!questionKey) return true;
  if (!userAnswer) return true;
  const negativeResolution = resolveGuidedNegativeAnswer({
    sectionKey,
    questionKey,
    promptText: promptPayload?.currentPrompt || promptPayload?.sectionRules?.questionPrompt,
    answer: userAnswer,
  });
  if (negativeResolution?.resolved) return true;
  return sectionKey === "review";
}

app.post("/api/ai-draft", async (req, res) => {
  const trace = startRouteTrace("/api/ai-draft", { lang: String(req.body?.lang || "en").slice(0, 8) });
  try {
    const { message, state, lang } = req.body || {};
    const userMsg = String(message || "").trim();
    if (!userMsg) {
      trace.end("bad_request", { status: 400, provider: "none" });
      return res.status(400).json({ error: "Missing message" });
    }

    let current = sanitizeState(state || {});

    // Conversational onboarding: if user is vague and we have no scope yet, don't interrogate.
    if (!current.scopeType && isVagueStarterMessage(userMsg)) {
      trace.end("ok", { status: 200, provider: "none", conversational: "starter" });
      return res.json({
        patch: current,
        missing: ["scopeType"],
        nextQuestion: humanAsk("scopeType", current, lang),
        draftPlan: null,
        fpeDraft: null,
      });
    }
    // RULE PARSER DISABLED (LLM-FIRST)
    // Guardrails (pre) just to provide missing-hints to the model for short replies like "2"
    let pre = applyGuardrailsAndNextQuestion(current, lang);

    // LLM FIRST (always run). No conditional gating.
    let rawLLM = null;
    const llm = await llmFallback(userMsg, current, lang, pre.missing, trace);
    if (llm && llm.patch) {
      rawLLM = llm._raw || null;
      current = mergePatch(current, llm.patch);
    }

    let guarded = applyGuardrailsAndNextQuestion(current, lang);

    // If user says "not sure / idk", we can apply a safe default for certain fields and keep the convo moving.
    if (isUnsure(userMsg) && guarded.missing && guarded.missing.length === 1) {
      const mk = guarded.missing[0];
      const applied = applyUnsureDefault(guarded.state, mk, lang);
      if (applied.applied) {
        current = applied.state;
        guarded = applyGuardrailsAndNextQuestion(current, lang);
      }
    }

    let draftPlan = null;
    if (guarded.missing.length === 0 && guarded.nextQuestion === "") {
      draftPlan = computePaintingDraftPlan(guarded.state);
    }

// Human acknowledgements: detect one newly-filled key (null -> value) this turn.
let filledKey = "";
let filledVal = null;
try {
  const prev = sanitizeState(state || {});
  const nowS = sanitizeState(guarded.state || {});
  const keys = Object.keys(nowS);
  for (const k of keys) {
    const wasEmpty = prev[k] === null || prev[k] === undefined || prev[k] === "";
    const isSet = nowS[k] !== null && nowS[k] !== undefined && nowS[k] !== "";
    if (wasEmpty && isSet) { filledKey = k; filledVal = nowS[k]; break; }
  }
} catch {
  // ignore
}


    trace.end("ok", {
      status: 200,
      provider: "ollama:/api/generate",
      llm_attempted: "yes",
      llm_applied: rawLLM ? "yes" : "no",
    });
    return res.json({
      patch: guarded.state,
      missing: guarded.missing,
      nextQuestion: soften(withAck(guarded.nextQuestion, filledKey, filledVal, lang), lang),
      status: oneLinerStatus(guarded.state, lang),
      draftPlan,
    fpeDraft: draftPlan ? planToFpeDraft(draftPlan, guarded.state, lang) : null,
      ...(rawLLM ? { _raw: rawLLM } : {}),
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (msg.includes("aborted")) {
      trace.end("timeout", { status: 504, provider: "ollama:/api/generate" });
      return res.status(504).json({ error: "Timeout waiting for Ollama" });
    }
    trace.end("error", { status: 500, provider: "ollama:/api/generate" });
    return res.status(500).json({ error: "ai-draft failed", detail: msg });
  }
});

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

function resolveOpenAiCompatibleChatUrl(value, fallbackUrl = "") {
  const raw = String(value || "").trim();
  if (!raw) return String(fallbackUrl || "").trim();
  if (/\/chat\/completions\/?$/i.test(raw)) return raw.replace(/\/+$/g, "");
  return `${raw.replace(/\/+$/g, "")}/chat/completions`;
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
    currentScope: String(currentScope || context?.currentScopeNotes || "").trim(),
    refineInstruction: String(refineInstruction || context?.refineInstruction || "").trim(),
    formatIntent: String(formatIntent || context?.scopeFormatIntent || "").trim(),
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

function getScopeAssistFallbackProviderConfig() {
  const apiKey = String(process.env.SCOPE_AI_FALLBACK_API_KEY || process.env.OPENAI_API_KEY || "").trim();
  const model = String(process.env.SCOPE_AI_FALLBACK_MODEL || process.env.OPENAI_MODEL || "").trim();
  const configuredUrl = String(
    process.env.SCOPE_AI_FALLBACK_URL
    || process.env.SCOPE_AI_FALLBACK_BASE_URL
    || process.env.OPENAI_BASE_URL
    || process.env.OPENAI_API_BASE
    || ""
  ).trim();
  const url = resolveOpenAiCompatibleChatUrl(
    configuredUrl,
    apiKey && model ? OPENAI_CHAT_COMPLETIONS_URL : ""
  );
  if (!apiKey || !model || !url) return null;

  return {
    name: String(process.env.SCOPE_AI_FALLBACK_PROVIDER || "scope_fallback").trim() || "scope_fallback",
    url,
    apiKey,
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
      maxAttempts: refineMode ? 3 : scopeSection ? 2 : 2,
      baseDelayMs: refineMode ? 900 : 700,
      maxDelayMs: refineMode ? 5200 : 3600,
      jitterRatio: 0.28,
    };
  }

  return {
    maxAttempts: refineMode ? 4 : scopeSection ? 3 : 2,
    baseDelayMs: refineMode ? 700 : 520,
    maxDelayMs: refineMode ? 4800 : 3200,
    jitterRatio: refineMode ? 0.35 : 0.24,
  };
}

function shouldRetrySectionAssistProviderFailure(reason) {
  const source = reason && typeof reason === "object" ? reason : { message: String(reason || "") };
  const status = Number(source?.httpStatus || source?.status || 0);
  if ([400, 401, 403, 404, 422].includes(status)) return false;
  if ([408, 429, 500, 502, 503, 504].includes(status)) return true;

  const detail = String(source?.providerDetail || source?.detail || source?.message || "");
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
      const scopeMode = String(context?.scopeMode || "").trim().toLowerCase() === "refine" ? "refine" : "initial";
      const lines = [
        "You are a professional trade estimator writing scope-of-work notes for a construction estimate.",
        "Return ONLY the note text that should be written into the scope notes field.",
        "Rules:",
        "- Plain, professional estimator language",
        "- Organize into clear work items (what is being done, not how it is priced)",
        "- Do NOT include dollar amounts, hourly rates, or pricing",
        "- Do NOT invent measurements or quantities not stated by the user",
        "- Keep concise — under 600 characters unless scope genuinely requires more",
        "- Quality is preferred over speed for this section",
        "- Honor requested structure first (bullets, numbered list, sentence, paragraph), then apply brevity and style within that structure",
        "- If the user did not explicitly request a format, default to contractor-ready paragraph-style scope notes",
        "- Do not default to bullets just because there are multiple work items",
        "- Use bullets or numbering only when the user explicitly asked for them or the scope is unusually list-like and materially clearer that way",
        "- A sentence request means exactly one sentence",
        "- A paragraph request means a short prose block, not a clipped one-line sentence",
        "- If a paragraph is requested and the input supports it, use 2 to 3 connected sentences",
        "- Default non-requested formatting should read like real contractor scope notes, not polished essay prose or a giant unbroken paragraph",
        "- When no explicit format is requested and the note is long enough, organize it into 2 to 4 compact scope-note blocks or mini paragraphs where natural",
        "- In default formatting, separate main scope from follow-up operations and exclusions when that improves readability",
        "- Those default scope-note blocks are still paragraph-style notes, not bullets or numbering",
        "- If concise or short is requested, shorten within the chosen structure instead of flattening the structure",
        "- Always stay in estimate scope-note format only",
        "- Never answer like a chat assistant and never say things like 'here is a rewrite' or 'scope notes:'",
        "- Active professional voice (e.g. 'Prepare designated surfaces...' / 'Furnish and install...')",
        "- If existing scope notes are provided, incorporate and improve them with the new description",
        "- Use provided detection hints for actions, quantities, items, locations, and qualifiers when they help clarify the note",
        "- When a scope skeleton is provided, write from it",
        "- Use certain skeleton items first, then selectively use implied adjacent work only when it is a standard, directly connected part of the described scope",
        "- Treat risky-missing skeleton items as short qualifiers or exclusions only when they help avoid scope disputes",
        "- Expand one level deeper than the user's shorthand so vague inputs become usable estimate scope, but do not hallucinate broad project scope",
        "- Do not lightly paraphrase and stop after one generic sentence",
        "- Do not use repetitive cookie-cutter contractor filler or the same exclusion wording on every trade",
        "- Vary the scope language by trade, task, environment, and detail level so different jobs do not sound templated",
        "- For vague but trade-recognizable inputs such as 'painting house', 'patch drywall', 'replace toilet', or 'install vanity', expand into useful estimate scope instead of restating the input",
        "- For vague inputs, produce a fuller estimate-ready scope draft with direct work, implied process, completion language, and short boundaries where relevant",
        "- Unless the user explicitly asks for one sentence, vague one-line trade inputs should usually resolve to multiple scope components, not a single thin sentence",
        "- For vague non-sentence inputs, aim for at least direct work plus implied process/prep plus completion or a narrow qualifier when the scope supports it",
        "- For mid-detail inputs, preserve the user's real scope and expand moderately without bloating it",
        "- For specialty or technical inputs, preserve domain terminology, quantities, units, and environment details while adding trade-relevant scope and boundaries",
        "- A later amend/refine step may exist for user steering, but the first draft must still be technically credible and estimate-ready on its own",
        "- Treat short technical or commercial scope prompts as estimator shorthand unless they are already clearly developed notes",
        "- When a short technical/commercial prompt is given, infer a realistic professional work sequence within that trade instead of returning a same-ish paraphrase",
        "- Treat short commercial/site/equipment/infrastructure prompts the same way: they are usually field shorthand and should not come back as a plain rewrite",
        "- For terse field asset removal, replacement, or installation prompts, build a stronger first-pass work sequence instead of saving the important scope development for amend",
        "- Treat short replace, remove, or install prompts naming a piece of equipment, a fixture, a unit, hardware, or utility-connected building asset as estimator shorthand, not a finished scope note",
        "- For short equipment or fixture replacement prompts, do not stop at a restatement like 'Replace water heater' or 'Replace exhaust fan'; expand into a contractor-ready replacement sequence",
        "- Treat short prompts naming a real asset, system, fixture, hardware item, repair target, or finish scope as estimator shorthand when they are not already developed notes",
        "- Treat the listed verbs and examples as anchor patterns, not a closed whitelist; nearby phrasing should be routed to the nearest work family when the meaning is clear",
        "- Mentally route short scope prompts by work family and asset family: demo/remove, replace connected equipment, replace non-connected asset or hardware, install new equipment or asset, repair or patch, finish or coating, site or exterior asset, and specialty commercial room context",
        "- Normalize adjacent verbs into the same family when appropriate, such as demo/demolish/tear out/strip out/decommission for remove work, swap out/change out/remove and replace for replacement work, furnish and install/provide and install/add/mount/set for installation work, restore/fix/rework/rebuild for repair work, and repaint/coat/finish/seal for finish work",
        "- Infer the nearest asset family from shorthand even when the exact noun was not pre-listed: connected equipment or fixtures, non-connected hardware or assets, finish materials or surfaces, repair surfaces or damage areas, site or exterior assets, and storefront or glazing openings",
        "- Treat that family-tree routing as an open model, not a fixed taxonomy: if no named family is a strong fit, infer the scope from action family plus object behavior",
        "- Treat the broader trade, asset, method, and location vocabulary as support for that existing layered routing, not as a replacement for it",
        "- When the exact noun is not deeply modeled, infer likely contractor workflow from object type, connection model, assembly scale, context modifiers, access implication, and boundary risk instead of collapsing into a near-echo restatement",
        "- Object behavior can be broader than the noun examples: equipment/unit, fixture/device, hardware/component, opening/assembly, finish material/surface, repair area, site/exterior asset, mounted or anchored object, framed opening, trim/accessory, or panel/closure",
        "- Broader real-world asset vocabulary should still map into those families when the meaning is clear, including cabinets, shelving, casework, millwork, built-ins, locker units, benches, storage units, doors, hatches, access panels, glazing, fence or rail assemblies, panels, flashing, brackets, supports, and mounted items",
        "- Use that broader asset vocabulary as routing support, not as a closed taxonomy: interior built-ins or casework, door or opening hardware, glazing or storefront components, site or perimeter assemblies, finish or repair surfaces, and minor supports, brackets, caps, cover panels, or mounted accessories should still resolve to the nearest bounded contractor workflow",
        "- Connection behavior can be broader than the noun examples: utility/service connection, electrical terminations, water/gas/drain/vent, controls/power, anchorage/fasteners, perimeter closure/sealant/flashing, finish-only attachment, or no clear connection type",
        "- Assembly scale can also shape the note: small hardware/component, fixture/device, full assembly/opening, surface/material system, site/exterior assembly, or localized repair area",
        "- If a real contractor-style noun is present, produce a bounded contractor-ready workflow even when it is a new noun family; stay realistic, avoid hallucinated specifics, and do not fall back to a one-line paraphrase",
        "- Users may type in rough field shorthand, weak grammar, clipped verbs, or mixed action fragments; translate that rough contractor intent into clean contractor-ready scope wording instead of mirroring the messy phrasing",
        "- Rough field verbs are often shorthand for a stronger action family: put/put up/put in can mean install, tear out can mean remove/demo, redo can mean repair or replacement depending on the object, and swap can mean replace",
        "- Broader action wording should still resolve through those same high-level families: place, hang, assemble, fit, secure in place, upgrade, retrofit, mend, stabilize, straighten, haul off, pull, rehang, relocate, alter, finish out, mud and tape, texture, flash, or waterproof should inform the nearest likely scope workflow when the context supports it",
        "- Use location and room vocabulary as context support rather than as a separate scope: kitchen, bathroom, laundry, office, lobby, storefront, reception, breakroom, backyard, front entry, rear stair, roof, wall edge, or ceiling edge should bias the workflow and language without inventing unsupported extra trades",
        "- If multiple rough action fragments appear in one prompt, combine them into one coherent bounded workflow instead of treating each fragment like a separate unrelated scope",
        "- Users may also type weak generic verbs or condition-first shorthand such as fix gate, bad window, broken panel, damaged drywall, failed sealant, or rotted trim; infer the most likely bounded contractor action instead of mirroring the vague phrasing",
        "- Around, perimeter, section, side, corner, piece, and area wording matters: keep those prompts narrower than full assembly replacement unless the prompt clearly expands the scope",
        "- Build on the layered routing cues you are given: strong known family matches still win first, broader object-behavior fallback applies next, and rough shorthand cues should shape both without replacing them",
        "- Preserve repair bias when replacement is not clearly supported, especially for minor hardware, brackets, hinges, caps, covers, trim pieces, or localized loose/bent/soft conditions",
        "- Preserve partial or localized scope when the user says section, side, corner, edge, end, around, area, or one section; do not quietly widen those prompts into full-system language",
        "- Preserve narrow component or accessory scope when the object is a hinge, latch, bracket, cover panel, corner bead, cap, trim piece, or similar minor component unless the prompt clearly expands it",
        "- Low-level contractor tasks are common and important: fix hinge, replace latch, adjust closer, resecure bracket, caulk around frame, patch trim piece, replace weatherstrip, tighten loose support, repair cover panel, swap threshold, replace cap, or patch and paint a small area should still come back as concise contractor-ready notes",
        "- Low-level component and accessory prompts should stay centered on the small part itself: hinge, latch, lock, closer, handle, threshold, sweep, weatherstrip, bracket, support, cap, cover, bead, trim piece, or similar items should remain the main scope target unless the wording clearly expands the work",
        "- If a small component appears with a parent assembly, use the parent assembly only as context: replace latch at access door, fix hinge on cabinet door, replace cap at fence post, or repair bracket at canopy panel should stay narrow component work, not inflate into full assembly replacement",
        "- Caulk, seal, weatherstrip, gasket, threshold, sweep, trim-around, patch-around, and similar perimeter/accessory prompts should stay perimeter or adjacent-finish work unless the wording clearly says to replace the larger assembly",
        "- Tighten, adjust, align, resecure, reset, reattach, and similar low-level correction verbs usually mean narrow repair/reset work, not full replacement, unless the prompt clearly says new material or replacement",
        "- When a small component noun appears next to a larger assembly noun, keep the small component as the main scope target and use the larger assembly only as context unless the prompt clearly expands the scope",
        "- Perimeter seal, caulk, weatherstrip, gasket, threshold, sweep, trim-around, and patch-around prompts should stay perimeter or accessory tasks, not turn into full opening or full assembly replacement unless the wording clearly says to replace the assembly",
        "- Adjust, align, tighten, resecure, reset, reattach, and touch-up prompts should stay narrow correction or localized finish work unless the wording clearly supports broader replacement",
        "- Low-level mixed chains such as replace hinge and align door, patch around panel and paint, replace latch and resecure gate, caulk around frame and touch up paint, or replace weatherstrip and adjust door should become one coherent narrow workflow instead of a bloated full-system note",
        "- Mid-level contractor prompts should scale up from those low-level rules without jumping to full-project language: assembly, section, run, room, wall area, entry, and localized exterior elevation prompts should read larger than latch-or-hinge work but smaller than whole-system replacement unless the wording clearly expands the scope",
        "- When the mid-band ambiguity signal is active, the user's prompt lacks a strong construction object or clear scope-size signal; default to bounded section or area language and avoid escalating to full system replacement, full assembly replacement, or broad project scope unless the prompt explicitly earns it",
        "- Object-light mid-band prompts (fix area, redo section, repair this part, patch this up, replace damaged section) should resolve to bounded affected-area or stated-section language, not full-surface or full-system language",
        "- Generic-surface mid-band prompts (repair wall area, fix damaged area, make good this wall, repair affected ceiling area) should stay bounded to the visible or described surface area; do not inflate into full wall or full ceiling replacement",
        "- Condition-plus-location mid-band prompts (repair area around window, repair section at storefront, redo wall area after leak, repair area around entry) should stay locally bounded to the described location and condition area, not convert into full opening or full assembly replacement",
        "- For mid-level prompts, keep the main assembly, section, run, or repair area as the primary scope target and treat make-good, trim-around, seal-around, patch-and-paint, texture, or secure-and-align steps as secondary workflow where that is the natural reading",
        "- Room, area, and section wording matters for the middle band: kitchen cabinets, vanity in bathroom, drywall in bedroom, stained ceiling from leak, fence section at side yard, canopy section at entry, storefront glass at entry, or lower cabinet run should stay bounded to the described room, area, section, run, or opening scope",
        "- Mid-level combo prompts such as replace and seal, install and align, repair and make good, patch texture and paint, remove and replace, replace and trim around, or install and weld joints should resolve into one coherent contractor-ready workflow with a clear primary target and only the most relevant secondary steps",
        "- Preserve scope-size discipline across the current layered system: low-level tasks stay low-level, mid-level prompts become assembly, section, run, room, or area scopes, and full project or system scope should not be invented unless the user actually describes it",
        "- Cabinets, shelving, casework, millwork, built-ins, vanities, benches, lockers, and similar interior built-in assemblies should read like built-in installation or replacement work: layout, place, level, align, secure, verify fit or operation where applicable, cleanup, and bounded exclusions without inventing countertop, plumbing, electrical, or finish work unless the prompt supports it",
        "- Remove-and-reinstall or reset wording is distinct from replacement: detach/remove, protect/store if appropriate, reinstall/reset, secure, and verify fit without converting it into full replacement unless the user clearly asks for new material",
        "- When the prompt is still ambiguous after routing, write the strongest bounded contractor-ready note you can using confidence-aware wording such as affected area, stated section, identified component, visible damage area, or accessible work area instead of generic filler or fake certainty",
        "- Location-heavy shorthand such as kitchen, bathroom, laundry, office, lobby, storefront, front entry, rear stair, roof edge, side gate, backyard, wall edge, ceiling edge, reception wall, or breakroom should bias context and trade language, but should not invent work if the action or object is still too unclear",
        "- Water, leak, wet, and damage wording usually points to bounded repair or finish restoration in the visible affected area; do not hallucinate full root-cause correction, mold remediation, structural rebuild, or broad hidden-trade scope unless the prompt supports it",
        "- Field slang and shorthand methods such as flash it, mud and tape, skim it, float it, shim it, level it, plumb it, square it, sleeve it, wrap post, cap it, bolt it up, anchor it down, or close it up are usually workflow details inside the main scope plan when the object/context supports them",
        "- Quantity-light prompts such as replace windows, patch holes, install fence, repair railing, or replace panels should still become usable scope notes using bounded wording like affected area, identified section, stated locations, or accessible work areas instead of inventing counts",
        "- Treat secondary method clues such as punch holes, drill, core, weld, tack, bolt up, anchor down, seal around, or wire up as workflow details inside the main assembly plan when the object/context supports them",
        "- Use object behavior and context to interpret rough method cues: fence, gate, railing, canopy, panel, door, hatch, glass, flashing, trim, post, bracket, and support prompts can imply layout, attachment prep, anchorage, perimeter closure, or welded connections without turning into generic technical filler",
        "- For rough contractor prompts, prefer concise contractor-ready assembly workflow over vague specialty fluff: main work, the most relevant secondary methods, verification/completion, and a short scope boundary where it helps",
        "- For terse replacement or installation prompts involving equipment, appliances, fixtures, fans, units, hardware, or mounted assets, include realistic remove/replace or install language, applicable service disconnection or reconnection, setting or securement, verification, and cleanup or disposal when naturally implied",
        "- For terse repair or patch prompts, expand into a practical repair workflow with prep, repair execution, finish/blend language where applicable, cleanup, and short boundary language when it helps avoid scope confusion",
        "- For terse finish or coating prompts, expand into prep/protection/install or application/finish/cleanup language appropriate to the described material or area",
        "- When the noun is generic but still points toward a probable family, stay bounded and estimate-ready instead of collapsing into a near-echo restatement",
        "- For terse trade shorthand, add trade-appropriate operations, coordination, installation workflow, testing, verification, labeling, cleanup, and access/shutdown language when naturally applicable",
        "- For commercial/site asset work such as light poles, site lighting, mounted assets, exterior equipment, or similar field infrastructure, use trade/site language and include realistic removal, access equipment, safe handling, disposal, set/securement, verification, and cleanup operations when they are naturally implied",
        "- Where the described work naturally suggests lift, crane, or access-equipment coordination, include that coordination in estimator-safe wording without inventing exotic means and methods",
        "- Let room or location context such as commercial kitchen, lobby, restroom, storefront, hotel, warehouse, rooftop, or site area bias the note commercial and trade-appropriate instead of generic residential wording",
        "- Keep that added detail realistic and estimate-ready without inventing exotic equipment specifics, unsupported quantities, or broad extra scope",
        "- Do not force a canned wrapper such as 'scope includes' or 'work includes' in place of real scope development",
        "- On broad painting inputs, infer only the strongest implied steps: surface prep as needed, adjacent-area protection, paint application to the described area, minor masking/cleanup, and a short repair/damage qualifier only when relevant",
        "- For drywall patch/repair inputs, favor patch/repair language, sanding or ready-for-finish language, and a minor-vs-extensive repair boundary when relevant",
        "- For plumbing fixture replacement or installation inputs, favor remove/replace or install language, reconnect/test/cleanup where clearly implied, and fixture-specific exclusions when relevant",
        "- For finish carpentry or trim inputs, favor install/replace, fit/secure, and trim-specific completion/boundary language instead of plumbing or painting filler",
        "- For specialty process, fab, tubing, piping, orbital, electrical gear, disconnect, breaker, or conduit work, preserve technical terminology and environment details, then add trade-specific execution and boundary language instead of residential remodeling language",
        "- For fallback general scopes, keep the note practical: direct work, the most relevant implied process, and a short boundary only when it helps avoid disputes",
        "- Reject lazy summary wrappers such as 'Scope includes painting the house' or 'Work includes patching drywall' when they do not add real scope detail",
        "- Reject shallow outputs that lack enough scope components for the input class, even if they are grammatically clean",
        "- Carry stated quantities, fixture/material nouns, and locations when they are clearly part of the user's request",
        "- Preserve explicit qualifiers such as 'as needed', 'if needed', 'where required', or 'subject to existing conditions' when present",
        "- Do not turn uncertain, hidden-condition, or damage-dependent work into guaranteed included work",
        "- When access-related repair, hidden damage, concealed conditions, existing conditions, or similar uncertainty is implied, use measured estimator-safe wording",
        "- Preserve cautionary meaning during cleanup instead of rewriting it away",
        "- On risk-aware inputs, do not return a trivial paraphrase or synonym swap of the user's sentence",
        "- If uncertainty, contingent work, damaged areas, or access-related patch/repair is implied, distinguish direct included work from contingent or concealed-condition work when helpful",
        "- Use qualifiers such as 'where required', 'if discovered', 'accessible work areas', or 'unless identified and approved' when they fit the user's actual scope",
        "- If bullets are requested on a risk-aware scope, prefer 2 to 3 useful bullets when the input supports them: direct work, related repair/patch work, and a concealed-condition qualifier when relevant",
        "- Avoid weak one-bullet echo responses for multi-part risk-aware inputs",
        "- If the user asks to clean up, rewrite, or professionalize the note, preserve the actual scope meaning while improving wording",
        "- If the input is sparse, improve clarity with practical scope/process/completion language instead of inventing major assumptions or filler",
        "- Slightly fuller scope output is preferred over a clipped bare-minimum answer when no specific brevity limit was requested",
        "- Keep wording natural and contractor-friendly unless the user explicitly asks for more professional wording",
        "- If the user asks for bullets, numbered lines, a concise paragraph, or a professional rewrite, preserve that lightweight formatting",
        "- Bullets using -, *, or • and numbered lines are allowed when helpful or requested",
        "- Return note text only — no JSON, code fences, headings, labels, or commentary",
      ];

      if (scopeMode === "refine") {
        lines.push(
          "- This request is refining an existing scope draft, not starting a chat response",
          "- Revise the current scope note directly instead of answering the instruction conversationally",
          "- Preserve the existing draft's good trade-specific content unless the refine instruction clearly changes or removes it",
          "- Apply requested additions, exclusions, tone shifts, shortening, technical buildout, or formatting changes clearly in the revised note",
          "- If the refine instruction does not ask for a full rewrite, amend the existing draft instead of replacing it with a different scope concept",
          "- If the refine instruction asks for bullets, numbered lines, a sentence, or a paragraph, that format change wins",
          "- If no new format is requested during refine, keep contractor-ready scope-note formatting rather than turning it into chat prose",
          "- Do not explain what changed and do not prepend phrases like 'here is the revised version'",
        );
      }

      return lines.join("\n");
    },
    buildUserPrompt({ userInput, context }) {
      const scopeMode = String(context?.scopeMode || "").trim().toLowerCase() === "refine" ? "refine" : "initial";
      if (scopeMode === "refine") {
        const parts = ["Mode: refine existing scope draft"];
        if (context?.tradeKey) parts.push(`Trade: ${context.tradeKey}`);
        if (context?.currentScopeNotes) parts.push(`Current scope draft: ${context.currentScopeNotes}`);
        if (context?.sourceScopePrompt) parts.push(`Original scope request: ${context.sourceScopePrompt}`);
        if (context?.scopeSourceAnalysis?.coreScopeText) parts.push(`Original core scope text: ${context.scopeSourceAnalysis.coreScopeText}`);
        if (Array.isArray(context?.scopeSourceAnalysis?.technicalSignals) && context.scopeSourceAnalysis.technicalSignals.length) {
          parts.push(`Existing trade/specialty signals: ${context.scopeSourceAnalysis.technicalSignals.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeSourceAnalysis?.actions) && context.scopeSourceAnalysis.actions.length) {
          parts.push(`Existing work actions: ${context.scopeSourceAnalysis.actions.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeSourceAnalysis?.actionFamilies) && context.scopeSourceAnalysis.actionFamilies.length) {
          parts.push(`Existing action families: ${context.scopeSourceAnalysis.actionFamilies.join(" | ")}`);
        }
        if (context?.scopeInputAnalysis?.formattingIntent) {
          parts.push(`Requested output format: ${context.scopeInputAnalysis.formattingIntent}`);
        } else {
          parts.push("Default format expectation: keep contractor-ready scope-note blocks or compact paragraphs unless the refine instruction asks for a different structure.");
        }
        if (context?.scopeInputAnalysis?.brevityIntent) {
          parts.push(`Requested brevity direction: ${context.scopeInputAnalysis.brevityIntent}`);
        }
        if (Array.isArray(context?.scopeRefineAnalysis?.rewriteIntents) && context.scopeRefineAnalysis.rewriteIntents.length) {
          parts.push(`Refine wording intents: ${context.scopeRefineAnalysis.rewriteIntents.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeRefineAnalysis?.actions) && context.scopeRefineAnalysis.actions.length) {
          parts.push(`Refine change actions: ${context.scopeRefineAnalysis.actions.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeRefineAnalysis?.items) && context.scopeRefineAnalysis.items.length) {
          parts.push(`Refine item hints: ${context.scopeRefineAnalysis.items.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeRefineAnalysis?.locations) && context.scopeRefineAnalysis.locations.length) {
          parts.push(`Refine location hints: ${context.scopeRefineAnalysis.locations.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeInputAnalysis?.technicalSignals) && context.scopeInputAnalysis.technicalSignals.length) {
          parts.push(`Active technical/specialty signals: ${context.scopeInputAnalysis.technicalSignals.join(" | ")}`);
        }
        if (context?.scopeInputAnalysis?.scopeProfile) {
          parts.push(`Scope profile: ${context.scopeInputAnalysis.scopeProfile}`);
        }
        if (context?.scopeInputAnalysis?.primaryActionFamily) {
          parts.push(`Active action family: ${context.scopeInputAnalysis.primaryActionFamily}`);
        }
        if (context?.scopeInputAnalysis?.scopeAssetFamily) {
          parts.push(`Active asset family: ${context.scopeInputAnalysis.scopeAssetFamily}`);
        }
        if (context?.scopeInputAnalysis?.objectType) {
          parts.push(`Active object type: ${context.scopeInputAnalysis.objectType}`);
        }
        if (context?.scopeInputAnalysis?.connectionModel) {
          parts.push(`Active connection model: ${context.scopeInputAnalysis.connectionModel}`);
        }
        if (context?.scopeInputAnalysis?.assemblyScale) {
          parts.push(`Active assembly scale: ${context.scopeInputAnalysis.assemblyScale}`);
        }
        if (context?.scopeInputAnalysis?.roughPrompt) {
          parts.push("Rough contractor shorthand path: active.");
        }
        if (Array.isArray(context?.scopeInputAnalysis?.siteAssemblyHints) && context.scopeInputAnalysis.siteAssemblyHints.length) {
          parts.push(`Active site/assembly hints: ${context.scopeInputAnalysis.siteAssemblyHints.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeInputAnalysis?.secondaryActionMethods) && context.scopeInputAnalysis.secondaryActionMethods.length) {
          parts.push(`Active secondary method cues: ${context.scopeInputAnalysis.secondaryActionMethods.join(" | ")}`);
        }
        if (context?.scopeInputAnalysis?.holeCreationIntent) {
          parts.push(`Active hole/prep cue: ${context.scopeInputAnalysis.holeCreationIntent}`);
        }
        if (Array.isArray(context?.scopeInputAnalysis?.connectionMethodHints) && context.scopeInputAnalysis.connectionMethodHints.length) {
          parts.push(`Active connection-method hints: ${context.scopeInputAnalysis.connectionMethodHints.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeInputAnalysis?.perimeterScopeHints) && context.scopeInputAnalysis.perimeterScopeHints.length) {
          parts.push(`Active perimeter/local-scope hints: ${context.scopeInputAnalysis.perimeterScopeHints.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeInputAnalysis?.partialScopeHints) && context.scopeInputAnalysis.partialScopeHints.length) {
          parts.push(`Active partial/localized scope hints: ${context.scopeInputAnalysis.partialScopeHints.join(" | ")}`);
        }
        if (context?.scopeInputAnalysis?.resetIntent) {
          parts.push(`Active remove-reinstall/reset cue: ${context.scopeInputAnalysis.resetIntent}`);
        }
        if (Array.isArray(context?.scopeInputAnalysis?.openingClosureHints) && context.scopeInputAnalysis.openingClosureHints.length) {
          parts.push(`Active opening/closure hints: ${context.scopeInputAnalysis.openingClosureHints.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeInputAnalysis?.waterDamageRepairHints) && context.scopeInputAnalysis.waterDamageRepairHints.length) {
          parts.push(`Active water/leak repair hints: ${context.scopeInputAnalysis.waterDamageRepairHints.join(" | ")}`);
        }
        if (context?.scopeInputAnalysis?.detailLevel) {
          parts.push(`Current draft detail level: ${context.scopeInputAnalysis.detailLevel}`);
        }
        if (context?.scopeInputAnalysis?.technicalScopeCompleteness) {
          parts.push(`Current draft technical completeness: ${context.scopeInputAnalysis.technicalScopeCompleteness}`);
        }
        if (context?.scopeInputAnalysis?.expansionPressure) {
          parts.push(`Refine expansion pressure: ${context.scopeInputAnalysis.expansionPressure}`);
        }
        if (context?.scopeRefineAnalysis?.mentionsDisposal) parts.push("Refine request mentions disposal or haul-away.");
        if (context?.scopeRefineAnalysis?.mentionsPatchOrRepair) parts.push("Refine request mentions patching, repair, or demo-related work.");
        if (Array.isArray(context?.scopeRefineAnalysis?.uncertaintyPhrases) && context.scopeRefineAnalysis.uncertaintyPhrases.length) {
          parts.push(`Refine safe-wording triggers: ${context.scopeRefineAnalysis.uncertaintyPhrases.join(" | ")}`);
        }
        if (Array.isArray(context?.scopeRefineAnalysis?.riskTriggerTerms) && context.scopeRefineAnalysis.riskTriggerTerms.length) {
          parts.push(`Refine risk-aware triggers: ${context.scopeRefineAnalysis.riskTriggerTerms.join(" | ")}`);
        }
        const sourceSkeletonLines = formatScopeSkeletonForPrompt(context?.scopeSourceAnalysis?.scopeSkeleton);
        if (sourceSkeletonLines.length) {
          parts.push(`Existing scope skeleton:\n${sourceSkeletonLines.map((line) => `- ${line}`).join("\n")}`);
        }
        const refineSkeletonLines = formatScopeSkeletonForPrompt(context?.scopeRefineAnalysis?.scopeSkeleton);
        if (refineSkeletonLines.length) {
          parts.push(`Refine request skeleton:\n${refineSkeletonLines.map((line) => `- ${line}`).join("\n")}`);
        }
        parts.push("Revision instruction: preserve good existing scope content unless the refine request clearly changes it.");
        parts.push(`Refine instruction: ${context?.refineInstruction || userInput || "(none provided)"}`);
        return parts.join("\n");
      }

      const parts = [];
      if (context?.tradeKey) parts.push(`Trade: ${context.tradeKey}`);
      if (context?.currentScopeNotes) parts.push(`Existing scope notes: ${context.currentScopeNotes}`);
      if (context?.scopeInputAnalysis?.coreScopeText) parts.push(`Core scope text: ${context.scopeInputAnalysis.coreScopeText}`);
      if (Array.isArray(context?.scopeInputAnalysis?.actions) && context.scopeInputAnalysis.actions.length) {
        parts.push(`Detected actions: ${context.scopeInputAnalysis.actions.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.actionFamilies) && context.scopeInputAnalysis.actionFamilies.length) {
        parts.push(`Detected action families: ${context.scopeInputAnalysis.actionFamilies.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.quantityItemPairs) && context.scopeInputAnalysis.quantityItemPairs.length) {
        parts.push(`Detected quantity/item hints: ${context.scopeInputAnalysis.quantityItemPairs.join(" | ")}`);
      } else if (Array.isArray(context?.scopeInputAnalysis?.quantities) && context.scopeInputAnalysis.quantities.length) {
        parts.push(`Detected quantities: ${context.scopeInputAnalysis.quantities.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.items) && context.scopeInputAnalysis.items.length) {
        parts.push(`Detected items: ${context.scopeInputAnalysis.items.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.locations) && context.scopeInputAnalysis.locations.length) {
        parts.push(`Detected locations: ${context.scopeInputAnalysis.locations.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.rewriteIntents) && context.scopeInputAnalysis.rewriteIntents.length) {
        parts.push(`Requested rewrite intents: ${context.scopeInputAnalysis.rewriteIntents.join(" | ")}`);
      }
      if (context?.scopeInputAnalysis?.formattingIntent) {
        parts.push(`Primary format intent: ${context.scopeInputAnalysis.formattingIntent}`);
      } else {
        parts.push("Default format expectation: contractor-ready scope-note blocks or compact paragraphs unless structured bullets are clearly necessary.");
      }
      if (context?.scopeInputAnalysis?.brevityIntent) {
        parts.push(`Secondary brevity intent: ${context.scopeInputAnalysis.brevityIntent}`);
      }
      if (context?.scopeInputAnalysis?.detailLevel) {
        parts.push(`Input detail level: ${context.scopeInputAnalysis.detailLevel}`);
      }
      if (context?.scopeInputAnalysis?.technicalScopeCompleteness) {
        parts.push(`Technical note completeness: ${context.scopeInputAnalysis.technicalScopeCompleteness}`);
      }
      if (context?.scopeInputAnalysis?.expansionPressure) {
        parts.push(`Expansion pressure: ${context.scopeInputAnalysis.expansionPressure}`);
      }
      if (context?.scopeInputAnalysis?.inputShape) {
        const shape = context.scopeInputAnalysis.inputShape;
        const shapeFlags = [
          shape.veryShortInput ? "very_short_input" : "",
          shape.singleClauseInput ? "single_clause_input" : "",
          shape.lowDetailDensity ? "low_detail_density" : "",
          shape.terseTechnicalCommercialInput ? "terse_technical_commercial_input" : "",
        ].filter(Boolean);
        if (shapeFlags.length) parts.push(`Input shape cues: ${shapeFlags.join(" | ")}`);
      }
      if (context?.scopeInputAnalysis?.scopeDepthTarget) {
        parts.push(`Target output depth: ${context.scopeInputAnalysis.scopeDepthTarget}`);
      }
      if (context?.scopeInputAnalysis?.scopeProfile) {
        parts.push(`Scope profile: ${context.scopeInputAnalysis.scopeProfile}`);
      }
      if (context?.scopeInputAnalysis?.primaryActionFamily) {
        parts.push(`Primary action family: ${context.scopeInputAnalysis.primaryActionFamily}`);
      }
      if (context?.scopeInputAnalysis?.scopeWorkBucket) {
        parts.push(`Scope work bucket: ${context.scopeInputAnalysis.scopeWorkBucket}`);
      }
      if (context?.scopeInputAnalysis?.scopeTradeBucket) {
        parts.push(`Trade bucket: ${context.scopeInputAnalysis.scopeTradeBucket}`);
      }
      if (context?.scopeInputAnalysis?.scopeAssetCategory) {
        parts.push(`Asset/category cue: ${context.scopeInputAnalysis.scopeAssetCategory}`);
      }
      if (context?.scopeInputAnalysis?.scopeAssetFamily) {
        parts.push(`Asset family cue: ${context.scopeInputAnalysis.scopeAssetFamily}`);
      }
      if (context?.scopeInputAnalysis?.objectType) {
        parts.push(`Object type cue: ${context.scopeInputAnalysis.objectType}`);
      }
      if (context?.scopeInputAnalysis?.connectionModel) {
        parts.push(`Connection model cue: ${context.scopeInputAnalysis.connectionModel}`);
      }
      if (context?.scopeInputAnalysis?.assemblyScale) {
        parts.push(`Assembly scale cue: ${context.scopeInputAnalysis.assemblyScale}`);
      }
      if (context?.scopeInputAnalysis?.roughPrompt) {
        parts.push("Rough contractor shorthand path: active.");
      }
      if (Array.isArray(context?.scopeInputAnalysis?.siteAssemblyHints) && context.scopeInputAnalysis.siteAssemblyHints.length) {
        parts.push(`Site/assembly hints: ${context.scopeInputAnalysis.siteAssemblyHints.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.secondaryActionMethods) && context.scopeInputAnalysis.secondaryActionMethods.length) {
        parts.push(`Secondary method cues: ${context.scopeInputAnalysis.secondaryActionMethods.join(" | ")}`);
      }
      if (context?.scopeInputAnalysis?.holeCreationIntent) {
        parts.push(`Hole/prep cue: ${context.scopeInputAnalysis.holeCreationIntent}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.connectionMethodHints) && context.scopeInputAnalysis.connectionMethodHints.length) {
        parts.push(`Connection-method hints: ${context.scopeInputAnalysis.connectionMethodHints.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.perimeterScopeHints) && context.scopeInputAnalysis.perimeterScopeHints.length) {
        parts.push(`Perimeter/local-scope hints: ${context.scopeInputAnalysis.perimeterScopeHints.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.partialScopeHints) && context.scopeInputAnalysis.partialScopeHints.length) {
        parts.push(`Partial/localized scope hints: ${context.scopeInputAnalysis.partialScopeHints.join(" | ")}`);
      }
      if (context?.scopeInputAnalysis?.resetIntent) {
        parts.push(`Remove-reinstall/reset cue: ${context.scopeInputAnalysis.resetIntent}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.openingClosureHints) && context.scopeInputAnalysis.openingClosureHints.length) {
        parts.push(`Opening/closure hints: ${context.scopeInputAnalysis.openingClosureHints.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.waterDamageRepairHints) && context.scopeInputAnalysis.waterDamageRepairHints.length) {
        parts.push(`Water/leak repair hints: ${context.scopeInputAnalysis.waterDamageRepairHints.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.locationContextHints) && context.scopeInputAnalysis.locationContextHints.length) {
        parts.push(`Location context hints: ${context.scopeInputAnalysis.locationContextHints.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.fieldSlangMethodHints) && context.scopeInputAnalysis.fieldSlangMethodHints.length) {
        parts.push(`Field slang/method cues: ${context.scopeInputAnalysis.fieldSlangMethodHints.join(" | ")}`);
      }
      if (context?.scopeInputAnalysis?.detailLevel === "vague" && context?.scopeInputAnalysis?.formattingIntent !== "sentence") {
        parts.push("Minimum acceptable depth: multi-component scope note with direct work, implied process/prep, and completion or qualifier language.");
      }
      if (context?.scopeInputAnalysis?.scopeWorkBucket === "repair_patch" && context?.scopeInputAnalysis?.formattingIntent !== "sentence") {
        parts.push("Minimum acceptable depth: expand terse repair shorthand into prep, repair execution, finish/blend where applicable, cleanup, and a clean scope boundary when it helps.");
      }
      if (context?.scopeInputAnalysis?.scopeWorkBucket === "finish_coating" && context?.scopeInputAnalysis?.formattingIntent !== "sentence") {
        parts.push("Minimum acceptable depth: expand terse finish shorthand into prep/protection plus install or application workflow plus cleanup and boundary language where applicable.");
      }
      if (context?.scopeInputAnalysis?.inputShape?.terseTechnicalCommercialInput && context?.scopeInputAnalysis?.formattingIntent !== "sentence") {
        parts.push("Minimum acceptable depth: build out short technical/commercial shorthand into a fuller estimate-ready work sequence, not a one-line paraphrase.");
      }
      if (context?.scopeInputAnalysis?.siteEquipmentScope && context?.scopeInputAnalysis?.formattingIntent !== "sentence") {
        parts.push("Minimum acceptable depth: build short site/equipment shorthand into a field-ready work sequence with access or handling coordination, debris/disposal or securement, and realistic scope boundaries where applicable.");
      }
      if (context?.scopeInputAnalysis?.replaceableAssetScope && context?.scopeInputAnalysis?.formattingIntent !== "sentence") {
        parts.push("Minimum acceptable depth: build short replace/install/remove asset shorthand into a contractor-ready work sequence with remove and replace or installation language, applicable reconnection or terminations, verification, cleanup or disposal, and realistic scope boundaries where applicable.");
      }
      if (Array.isArray(context?.scopeInputAnalysis?.technicalSignals) && context.scopeInputAnalysis.technicalSignals.length) {
        parts.push(`Technical/specialty signals: ${context.scopeInputAnalysis.technicalSignals.join(" | ")}`);
      }
      if (context?.scopeInputAnalysis?.siteEquipmentScope) {
        parts.push("Site/equipment shorthand path: active.");
      }
      if (context?.scopeInputAnalysis?.replaceableAssetScope) {
        parts.push(`Replaceable asset shorthand path: ${context.scopeInputAnalysis.replaceableAssetCategory || "active"}.`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.commercialContextSignals) && context.scopeInputAnalysis.commercialContextSignals.length) {
        parts.push(`Commercial/site context cues: ${context.scopeInputAnalysis.commercialContextSignals.join(" | ")}`);
      }
      if (context?.scopeInputAnalysis?.residentialContext) {
        parts.push("Residential context: active.");
      }
      if (context?.scopeInputAnalysis?.siteExteriorContext) {
        parts.push("Site/exterior context: active.");
      }
      if (context?.scopeInputAnalysis?.impliedAccessContext) {
        parts.push(`Implied access cue: ${context.scopeInputAnalysis.impliedAccessContext}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.conditionModifiers) && context.scopeInputAnalysis.conditionModifiers.length) {
        parts.push(`Condition modifiers: ${context.scopeInputAnalysis.conditionModifiers.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.boundaryRiskHints) && context.scopeInputAnalysis.boundaryRiskHints.length) {
        parts.push(`Boundary risk hints: ${context.scopeInputAnalysis.boundaryRiskHints.join(" | ")}`);
      }
      if (context?.scopeInputAnalysis?.expandRequested) {
        parts.push("Scope expansion intent: user requested a fuller scope note.");
      }
      if (Array.isArray(context?.scopeInputAnalysis?.uncertaintyPhrases) && context.scopeInputAnalysis.uncertaintyPhrases.length) {
        parts.push(`Safe-wording triggers: ${context.scopeInputAnalysis.uncertaintyPhrases.join(" | ")}`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.riskTriggerTerms) && context.scopeInputAnalysis.riskTriggerTerms.length) {
        parts.push(`Risk-aware triggers: ${context.scopeInputAnalysis.riskTriggerTerms.join(" | ")}`);
      }
      if (context?.scopeInputAnalysis?.safeWordingRequested) parts.push("Secondary style intent: safe wording / uncertainty-aware wording.");
      if (context?.scopeInputAnalysis?.riskAwareInput) parts.push("Risk-aware estimator path: active.");
      if (context?.scopeInputAnalysis?.scopeExpansionActive) parts.push("Hidden scope engine path: active.");
      if (context?.scopeInputAnalysis?.mentionsDisposal) parts.push("User mentioned disposal or haul-away.");
      if (context?.scopeInputAnalysis?.mentionsPatchOrRepair) parts.push("User mentioned patching or repair work.");
      if (context?.scopeInputAnalysis?.midBandAmbiguity) {
        const biasPhrasing = context.scopeInputAnalysis.midBandBiasPhrasing || "bounded_section_area";
        const isMixedClause = context.scopeInputAnalysis.hasStrongClause === true && context.scopeInputAnalysis.hasWeakClause === true;
        const biasHint = biasPhrasing === "localized_surface_repair"
          ? "keep work bounded to the visible affected surface area — avoid full surface or full-system replacement phrasing"
          : biasPhrasing === "localized_water_damage_surface_repair"
          ? "keep work bounded to the water-damaged surface area — do not inflate into full replacement or structural repair"
          : biasPhrasing === "localized_water_damage_area_repair"
          ? "keep work bounded to the visible water-damaged area — prefer repair/patch language over full system repair"
          : "prefer bounded section or area phrasing over full system, full assembly, or full surface replacement";
        if (isMixedClause) {
          parts.push(`Mid-band ambiguity bias: active (mixed clauses) — keep explicit-object clauses fully specified; ${biasHint} for vague-object clauses.`);
        } else {
          parts.push(`Mid-band ambiguity bias: active — ${biasHint}.`);
        }
      }
      if (Array.isArray(context?.scopeInputAnalysis?.referentialFollowUpHints) && context.scopeInputAnalysis.referentialFollowUpHints.length) {
        const rfHints = context.scopeInputAnalysis.referentialFollowUpHints;
        const rfParts = [];
        if (rfHints.includes("perimeter_follow_up")) {
          rfParts.push("treat 'around it / around frame / around opening / around them' as perimeter-bounded follow-up — scope only the immediate surrounding area or frame, not the primary object");
        }
        if (rfHints.includes("action_pronoun_follow_up")) {
          rfParts.push("resolve pronoun targets (it / them / this / that) to the nearest grounded object or zone — keep the follow-up action secondary and bounded, not a full replacement or assembly event");
        }
        if (rfHints.includes("adjacent_area_follow_up")) {
          rfParts.push("treat adjacent / surrounding / nearby area language as localized secondary work tied to the primary object zone");
        }
        if (rfHints.includes("after_work_follow_up")) {
          rfParts.push("treat 'after' follow-up clauses as secondary finish or make-good work following the primary install or replacement — keep bounded");
        }
        if (rfParts.length) parts.push(`Referential follow-up: active — ${rfParts.join("; ")}.`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.demonstrativeModifierHints) && context.scopeInputAnalysis.demonstrativeModifierHints.length) {
        const dmHints = context.scopeInputAnalysis.demonstrativeModifierHints;
        const dmParts = [];
        if (dmHints.includes("demonstrative_weak_extent")) {
          dmParts.push("treat 'this / that / these / those' before generic extent words (section, area, zone, opening area) as a bounded scope anchor — stay localized to the referenced extent, do not inflate to broader scope");
        }
        if (dmHints.includes("demonstrative_generic_surface")) {
          dmParts.push("treat 'this / that / these / those' before surface nouns (wall, ceiling, floor, drywall) as a localized surface-area anchor — keep repair bounded to the visible or stated surface area");
        }
        if (dmHints.includes("demonstrative_bounded_object")) {
          dmParts.push("treat 'this / that / these / those' before specific objects (panel, trim, door, frame) as a direct object anchor — preserve object specificity and keep any follow-up clauses secondary and bounded");
        }
        if (dmHints.includes("demonstrative_strong_object")) {
          dmParts.push("treat 'this / that / these / those' before named construction objects (fence, railing, glazing panel, cabinet, etc.) as a direct object anchor — preserve full object scope and keep follow-up clauses secondary");
        }
        if (dmParts.length) parts.push(`Demonstrative modifier: active — ${dmParts.join("; ")}.`);
      }
      if (context?.scopeInputAnalysis?.multiAnchorSeparationActive) {
        parts.push(
          "Multi-anchor zone separation: active — this prompt contains multiple clauses each with their own stated location. " +
          "Keep each clause bound to its own stated object and location: " +
          "(1) a later clause's location does not retroactively modify an earlier clause's object or zone; " +
          "(2) an earlier clause's location does not absorb a later clause's object; " +
          "(3) a follow-up clause with its own explicit location is a separate zone — scope it independently; " +
          "(4) a follow-up clause with no explicit location may only inherit from the immediately preceding clause — not from unrelated earlier anchors. " +
          "Output as one unified contractor-ready scope note, but do not merge or cross-pollinate the stated zones."
        );
      }
      if (Array.isArray(context?.scopeInputAnalysis?.relativeZoneHints) && context.scopeInputAnalysis.relativeZoneHints.length) {
        const rzHints = context.scopeInputAnalysis.relativeZoneHints;
        const rzParts = [];
        rzParts.push("treat relative zone language as a bounded clause-local spatial anchor — do not inflate a stated relative zone to whole-object or full-system scope");
        if (rzHints.includes("relative_side_contrast")) {
          rzParts.push("left / right / one side / other side zones are distinct bounded areas — keep work on each stated side contained to that side; do not combine both sides into one scope action");
        }
        if (rzHints.includes("relative_interior_exterior")) {
          rzParts.push("inside and outside (or interior and exterior) are distinct bounded zones — scope inside face and outside face work independently; do not merge interior and exterior work");
        }
        if (rzHints.includes("relative_front_rear")) {
          rzParts.push("front and rear / back side zones are distinct bounded areas — keep them separated; do not carry front-side work into rear-side scope or vice versa");
        }
        if (rzHints.includes("relative_same")) {
          rzParts.push("'same wall / same area / same section' means stay localized to the primary object's immediate surface — do not expand to neighboring or whole-system scope");
        }
        if (rzHints.includes("relative_opposite")) {
          rzParts.push("the opposite side is a distinct bounded zone from the primary position — scope it independently without merging with the primary side's work");
        }
        if (rzHints.includes("relative_adjacent_nearby")) {
          rzParts.push("adjacent and nearby zones are secondary and localized — keep bounded without inflating to full wall or full system scope");
        }
        if (context.scopeInputAnalysis.relativeZoneSeparationActive) {
          rzParts.push("multiple clauses each have their own stated relative zone — keep each clause's zone separated; do not carry one clause's relative zone into another");
        }
        parts.push(`Relative zone: active — ${rzParts.join("; ")}.`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.multiZoneChainHints) && context.scopeInputAnalysis.multiZoneChainHints.length) {
        const mzHints = context.scopeInputAnalysis.multiZoneChainHints;
        const mzParts = [];
        if (mzHints.includes("sparse_directional_zone")) {
          mzParts.push("bare directional zone words (inside, outside, interior, exterior, front, rear, back, side, edge, center, middle) are bounded clause-local spatial anchors — keep each localized to the stated face, side, or zone; do not inflate to whole-object or full-system scope");
        }
        if (mzHints.includes("multi_zone_chain")) {
          mzParts.push("this prompt is a spatial chain with 3 or more distinct zone clauses — keep every zone anchor independently bounded; center / middle / edge anchors must stay localized to their stated position and not expand into neighboring zones; do not carry any zone's scope into an adjacent zone in the chain");
        }
        parts.push(`Sparse zone / multi-zone chain: active — ${mzParts.join("; ")}.`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.coverageExtentHints) && context.scopeInputAnalysis.coverageExtentHints.length) {
        const ceHints = context.scopeInputAnalysis.coverageExtentHints;
        const ceParts = [];
        ceParts.push("coverage and extent quantifiers in this prompt are bounded to the local object or surface — do not inflate any stated extent to whole-project or full-system scope");
        if (ceHints.includes("both_sides")) {
          ceParts.push("'both sides' / 'both ends' means dual local coverage on the stated object — keep work on each side independently bounded; do not collapse both sides into one generic action or inflate to the full assembly");
        }
        if (ceHints.includes("perimeter_wraparound")) {
          ceParts.push("'all around' / 'full perimeter' / 'all edges' / 'all sides' means wraparound coverage bounded to the immediate local object, opening, frame, or panel — do not escalate to full building or system perimeter");
        }
        if (ceHints.includes("whole_local_surface")) {
          ceParts.push("'entire wall' / 'whole section' / 'whole face' / 'full rear side' means the full extent of the named local surface or assembly — do not conflate with full-building or full-system scope");
        }
        if (ceHints.includes("remainder_partial")) {
          ceParts.push("'rest of wall' / 'remaining area' / 'other half' / 'remaining side' means the balance of the already-stated local zone — stay bounded to that wall, section, or area; do not interpret as a project-wide remainder");
        }
        if (ceHints.includes("run_span_edge")) {
          ceParts.push("'full run' / 'full span' / 'full edge' / 'entire edge' means the complete extent of the stated linear element (run, span, edge, railing section, cabinet run) — scope it as full local coverage of that element without escalating to the broader assembly or system");
        }
        parts.push(`Coverage / extent quantifier: active — ${ceParts.join("; ")}.`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.ordinalCountStackedHints) && context.scopeInputAnalysis.ordinalCountStackedHints.length) {
        const ocsHints = context.scopeInputAnalysis.ordinalCountStackedHints;
        const ocsParts = [];
        ocsParts.push("ordinal, count, or stacked extent references are bounded local selections — do not expand to whole-project or whole-assembly scope");
        if (ocsHints.includes("ordinal_local_selection")) {
          ocsParts.push("ordinal selectors (first, second, third, last, middle, center, end) identify a specific local section, panel, bay, or span within the stated object — keep work bounded to that local selection; do not apply the scope to the full assembly or all instances");
        }
        if (ocsHints.includes("count_local_extent")) {
          ocsParts.push("small count phrases (two sections, three runs, two panels) identify a specific local quantity — keep the scope bounded to that stated number of local elements; do not expand to whole-system replacement or full assembly scope");
        }
        if (ocsHints.includes("stacked_extent_location")) {
          ocsParts.push("stacked modifier chains (full outside perimeter, entire inside face, both outer edges, remaining rear half) stack a coverage quantifier with a directional modifier and an extent noun — preserve all three layers; keep work bounded to the combined local extent without inflating to broader scope");
        }
        parts.push(`Ordinal / count / stacked extent: active — ${ocsParts.join("; ")}.`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.rangePositionalFractionalHints) && context.scopeInputAnalysis.rangePositionalFractionalHints.length) {
        const rpfHints = context.scopeInputAnalysis.rangePositionalFractionalHints;
        const rpfParts = [];
        rpfParts.push("range, positional, or fractional extent references are bounded local selections — do not expand to whole-assembly or whole-project scope");
        if (rpfHints.includes("ordinal_range_selection")) {
          rpfParts.push("ordinal or numeric ranges (sections 2 through 4, panels 1–3, first through third) identify a bounded multi-piece local selection — keep work scoped to that specific range; do not apply to the full assembly or all instances");
        }
        if (rpfHints.includes("positional_local_selection")) {
          rpfParts.push("positional selectors (top, bottom, upper, lower, front, rear) identify a bounded local position within the stated object — keep work bounded to that local vertical or directional position; do not apply to the full assembly");
        }
        if (rpfHints.includes("fractional_local_extent")) {
          rpfParts.push("fractional extent phrases (half the wall, a third of the section, left half of opening, rear half of ceiling) specify partial local coverage — keep the scope bounded to that stated fraction of the local surface or object; do not expand to full coverage or full replacement");
        }
        if (rpfHints.includes("mixed_selection_location")) {
          rpfParts.push("mixed selection + location (first panel at rear wall, second section on left side, last two panels at entry) combines a local selector with an explicit location anchor — keep both the selection and the location scope independently bounded and locally attached");
        }
        parts.push(`Range / positional / fractional extent: active — ${rpfParts.join("; ")}.`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.anchorCarrySubzoneHints) && context.scopeInputAnalysis.anchorCarrySubzoneHints.length) {
        const acsHints = context.scopeInputAnalysis.anchorCarrySubzoneHints;
        const acsParts = [];
        acsParts.push("anchor carry and named sub-zone references are precision-bounded — scope is constrained to the specific sub-zone or anchored selection; do not expand to full assembly or project scope");
        if (acsHints.includes("range_anchor_carry")) {
          acsParts.push("ordinal or numeric range with explicit location anchor (sections 1-3 at rear elevation, panels 2-4 at entry, first through third wall areas in lobby) — the anchor location is load-bearing; the range applies only to that specific location, not the full elevation or full project");
        }
        if (acsHints.includes("fraction_anchor_carry")) {
          acsParts.push("fractional extent with explicit location anchor (left half of opening at entry, rear half of wall at lobby, lower third of panel at storefront) — the anchor location is load-bearing; the fraction applies only to the anchored local surface; do not apply fractional coverage beyond that location");
        }
        if (acsHints.includes("position_of_local")) {
          acsParts.push("positional 'of' references (top of wall, bottom of opening, upper edge of frame, lower face of panel) — these name a specific positional sub-zone of a local surface; scope is bounded to that positional sub-zone only; do not apply to the full face, full frame, or full assembly");
        }
        if (acsHints.includes("named_subzone_local")) {
          acsParts.push("named construction sub-zones (head jamb, side jamb, sill plate, wall base, center mullion, face frame, bottom rail, infield section) — these are precise named parts of an assembly; scope is bounded to that specific part only; do not apply to the full opening, full frame, full cabinet run, or whole assembly");
        }
        parts.push(`Anchor carry / sub-zone: active — ${acsParts.join("; ")}.`);
      }
      if (Array.isArray(context?.scopeInputAnalysis?.coordinatedDistributionHints) && context.scopeInputAnalysis.coordinatedDistributionHints.length) {
        const cdHints = context.scopeInputAnalysis.coordinatedDistributionHints;
        const cdParts = [];
        cdParts.push("coordinated local-distribution — multiple bounded local pieces, positions, or sub-zones are being coordinated in one clause; keep each piece separately scoped and do not collapse into one generic object or inflate to whole-system scope");
        if (cdHints.includes("coordinated_position_distribution")) {
          cdParts.push("coordinated positional distribution (top and bottom, left and right, upper and lower, front and rear, top edge and bottom face) — each position is a separate bounded local piece sharing the same surface; keep them distinct and do not merge into full-coverage or whole-assembly scope");
        }
        if (cdHints.includes("coordinated_selection_distribution")) {
          cdParts.push("coordinated ordinal selection (first and second, first and third, first, second, and third) — each ordinal identifies a discrete separate local selection; preserve the bounded count and do not expand beyond the named selections");
        }
        if (cdHints.includes("coordinated_subzone_distribution")) {
          cdParts.push("coordinated named sub-zones (head jamb and sill plate, bottom rail and center mullion, side jamb and head jamb) — each sub-zone is a separate local assembly member; keep scope bounded to those specific members and do not expand to full frame, full opening, or full assembly");
        }
        if (cdHints.includes("coordinated_local_members")) {
          cdParts.push("coordinated local construction members (head and side jamb, top jamb and sill) — both members are bounded local pieces within the same assembly; keep each member separately scoped and do not generalize to full frame or whole-system repair");
        }
        parts.push(`Coordinated local distribution: active — ${cdParts.join("; ")}.`);
      }
      if (context?.scopeInputAnalysis?.weldingBaseProcess) {
        const weldBase = context.scopeInputAnalysis.weldingBaseProcess;
        const weldSecondary = context.scopeInputAnalysis.weldingSecondaryTags || [];
        const weldMaterial = context.scopeInputAnalysis.weldingMaterialContext || [];
        const weldBias = context.scopeInputAnalysis.weldingScopeBias || [];
        const weldRelated = context.scopeInputAnalysis.weldingRelatedNotWelding || [];
        const weldConfidence = context.scopeInputAnalysis.weldingConfidence || "low";
        const weldParts = [];
        weldParts.push(`base process: ${weldBase}`);
        if (weldSecondary.length) weldParts.push(`execution/application: ${weldSecondary.join(", ")}`);
        if (weldMaterial.length) weldParts.push(`material context: ${weldMaterial.join(", ")}`);
        if (weldBias.length) weldParts.push(`scope bias: ${weldBias.join(", ")}`);
        if (weldRelated.length) weldParts.push(`related non-welding: ${weldRelated.join(", ")}`);
        weldParts.push(`detection confidence: ${weldConfidence}`);
        parts.push(`Welding normalization: active — ${weldParts.join("; ")}. Use base process as the primary classification; execution/application tags describe HOW the weld is performed, not WHAT process it is; do not reclassify the base process based on execution tags alone; treat inferred base process as the governing process classification.`);
      }
      if (context?.scopeInputAnalysis?.ironworkTradeFamily) {
        const iwFamily = context.scopeInputAnalysis.ironworkTradeFamily;
        const iwOps = context.scopeInputAnalysis.ironworkOperationTags || [];
        const iwObjs = context.scopeInputAnalysis.ironworkObjectTags || [];
        const iwBias = context.scopeInputAnalysis.ironworkScopeBias || [];
        const iwConf = context.scopeInputAnalysis.ironworkConfidence || "low";
        const iwParts = [];
        iwParts.push(`trade family: ${iwFamily}`);
        if (iwOps.length) iwParts.push(`operations: ${iwOps.join(", ")}`);
        if (iwObjs.length) iwParts.push(`assembly/objects: ${iwObjs.join(", ")}`);
        if (iwBias.length) iwParts.push(`scope bias: ${iwBias.join(", ")}`);
        iwParts.push(`detection confidence: ${iwConf}`);
        parts.push(`Ironwork normalization: active — ${iwParts.join("; ")}. Preserve trade family as the primary classification; do not flatten into generic install steel language; keep trade family, operation, and assembly/object distinctions intact in scope notes; operation tags describe what is being done to the ironwork, not a separate trade.`);
      }
      if (context?.scopeInputAnalysis?.carpentryTradeFamily) {
        const carpFamily = context.scopeInputAnalysis.carpentryTradeFamily;
        const carpOps = context.scopeInputAnalysis.carpentryOperationTags || [];
        const carpObjs = context.scopeInputAnalysis.carpentryObjectTags || [];
        const carpConf = context.scopeInputAnalysis.carpentryConfidence || "low";
        const carpParts = [];
        carpParts.push(`trade family: ${carpFamily}`);
        if (carpOps.length) carpParts.push(`operations: ${carpOps.join(", ")}`);
        if (carpObjs.length) carpParts.push(`assembly/objects: ${carpObjs.join(", ")}`);
        carpParts.push(`detection confidence: ${carpConf}`);
        parts.push(`Carpentry normalization: active — ${carpParts.join("; ")}. Use carpentry trade family as the primary classification; keep operation and object distinctions intact; do not flatten to generic install/repair language when trade-specific workflow is indicated.`);
      }
      const scopeSkeletonLines = formatScopeSkeletonForPrompt(context?.scopeInputAnalysis?.scopeSkeleton);
      if (scopeSkeletonLines.length) {
        parts.push(`Detected scope skeleton:\n${scopeSkeletonLines.map((line) => `- ${line}`).join("\n")}`);
      }
      parts.push(`User description: ${userInput || "(none provided — generate scope from trade context)"}`);
      return parts.join("\n");
    },
    buildRequestOptions({ context }) {
      const depthTarget = context?.scopeInputAnalysis?.scopeDepthTarget || "moderate_expansion";
      const expansionPressure = context?.scopeInputAnalysis?.expansionPressure || "";
      const technicalScope = depthTarget === "technical_trade_expansion";
      const vagueScope = depthTarget === "fuller_scope_draft";
      const terseTechnicalScope = technicalScope && expansionPressure === "high";

      return {
        model: GROQ_SCOPE_MODEL || GROQ_MODEL,
        temperature: terseTechnicalScope ? 0.2 : technicalScope ? 0.16 : vagueScope ? 0.3 : depthTarget === "moderate_expansion" ? 0.22 : 0.18,
        top_p: terseTechnicalScope ? 0.9 : technicalScope ? 0.82 : vagueScope ? 0.94 : depthTarget === "moderate_expansion" ? 0.9 : 0.88,
        max_tokens: terseTechnicalScope ? 720 : technicalScope ? 620 : vagueScope ? 460 : depthTarget === "moderate_expansion" ? 340 : 280,
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

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
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
        OLLAMA_TIMEOUT_MS
      );
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
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
        throw error;
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
      const retryable = shouldRetrySectionAssistProviderFailure(error);
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

  const primaryProviderConfig = {
    name: "groq",
    url: GROQ_CHAT_COMPLETIONS_URL,
    apiKey: GROQ_API_KEY,
    model: String(requestOptions?.model || GROQ_MODEL).trim() || GROQ_MODEL,
  };

  try {
    return await callSectionAssistProviderWithRetry(
      primaryProviderConfig,
      systemPrompt,
      userPrompt,
      trace,
      requestOptions,
      assistOptions
    );
  } catch (error) {
    if (!shouldRetrySectionAssistProviderFailure(error)) throw error;

    const fallbackProviderConfig = normalizeAssistSectionKey(assistOptions?.sectionKey) === "scope"
      ? getScopeAssistFallbackProviderConfig()
      : null;
    if (!fallbackProviderConfig) {
      trace?.step("provider_fallback_skipped", {
        from: "groq",
        reason: "not_configured",
      });
      throw error;
    }

    trace?.step("provider_fallback", {
      from: "groq",
      to: fallbackProviderConfig.name,
      reason: normalizeSectionAssistFailure(error).code,
    });
    return callSectionAssistProviderWithRetry(
      fallbackProviderConfig,
      systemPrompt,
      userPrompt,
      trace,
      requestOptions,
      assistOptions
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
    _traceId,
  } = req.body || {};
  const _tid = String(_traceId || "").slice(0, 16); // Pass 19: correlation trace ID from client
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
      currentScopeNotes: String(currentScope || context?.currentScopeNotes || "").trim(),
      refineInstruction: String(refineInstruction || context?.refineInstruction || userInput || "").trim(),
      scopeFormatIntent: String(formatIntent || context?.scopeFormatIntent || "").trim(),
    } : {}),
  };
  const trace = startRouteTrace("/api/ai-assist", { section: normalizedSectionKey || String(sectionKey || "") });

  const sectionDef = AI_ASSIST_SECTIONS[normalizedSectionKey];
  if (!sectionDef) {
    trace.end("bad_request", { status: 400 });
    return res.status(400).json({ error: `Unknown section: ${sectionKey}` });
  }

  const systemPrompt = sectionDef.buildSystemPrompt({ context: normalizedContext, userInput: String(userInput || "") });
  const userPrompt = sectionDef.buildUserPrompt({ userInput: String(userInput || ""), context: normalizedContext });
  const requestOptions = typeof sectionDef.buildRequestOptions === "function"
    ? (sectionDef.buildRequestOptions({ context: normalizedContext, userInput: String(userInput || "") }) || {})
    : {};
  const scopeRequestFingerprint = normalizedSectionKey === "scope"
    ? buildScopeAssistRequestFingerprint({
      sectionKey: normalizedSectionKey,
      scopeMode: normalizedScopeMode,
      userInput: String(userInput || ""),
      sourcePrompt,
      currentScope,
      refineInstruction,
      formatIntent,
      context: normalizedContext,
      systemPrompt,
      userPrompt,
      requestOptions,
    })
    : "";

  try {
    const runSectionAssistRequest = async () => {
      let raw = await callSectionAssistGroq(systemPrompt, userPrompt, trace, requestOptions, {
        sectionKey: normalizedSectionKey,
        scopeMode: normalizedScopeMode,
      });
      let parsed = typeof sectionDef.parseResponse === "function"
        ? sectionDef.parseResponse(raw, { context: normalizedContext, userInput: String(userInput || "") })
        : extractJsonPayload(raw);

      if (normalizedSectionKey === "scope") {
        const specialtyRetryReasons = getSpecialtyRetryReasons(parsed?.scopeNotes || raw, {
          userInput: String(userInput || ""),
          context: normalizedContext,
        });

        if (specialtyRetryReasons.length) {
          trace.step("specialty_retry", { reasons: specialtyRetryReasons.join(" | ") });
          const retryPrompts = buildSpecialtyRetryPrompts(systemPrompt, userPrompt, {
            context: normalizedContext,
            reasons: specialtyRetryReasons,
          });
          raw = await callSectionAssistGroq(
            retryPrompts.systemPrompt,
            retryPrompts.userPrompt,
            trace,
            buildSpecialtyRetryOptions(requestOptions, { context: normalizedContext }),
            {
              sectionKey: normalizedSectionKey,
              scopeMode: normalizedScopeMode,
            }
          );
          parsed = typeof sectionDef.parseResponse === "function"
            ? sectionDef.parseResponse(raw, { context: normalizedContext, userInput: String(userInput || "") })
            : extractJsonPayload(raw);
        }
      }

      return parsed;
    };
    const parsed = normalizedSectionKey === "scope"
      ? await withCoalescedScopeAssistRequest(scopeRequestFingerprint, trace, runSectionAssistRequest)
      : await runSectionAssistRequest();

    if (!parsed || typeof parsed !== "object") {
      if (normalizedSectionKey === "scope") {
        if (_tid) {
          const _sa = normalizedContext?.scopeInputAnalysis || {};
          console.log(`[ai-assist:${_tid}] specialty_check branch=parse_failed input="${String(userInput || "").slice(0, 60)}" weld_base=${_sa.weldingBaseProcess || "none"} weld_conf=${_sa.weldingConfidence || "none"} iron_family=${_sa.ironworkTradeFamily || "none"} carp_family=${_sa.carpentryTradeFamily || "none"}`);
        }
        const specialtyFallback = buildSpecialtyLocalFallback(normalizedContext, String(userInput || ""));
        if (specialtyFallback) {
          trace.end("specialty_local_fallback", { status: 200, reason: "parse_failed" });
          return res.json(specialtyFallback);
        }
      }
      trace.end("fallback", { status: 200, reason: "parse_failed" });
      return res.json(sectionDef.fallback("groq returned unparseable response"));
    }
    trace.end("ok", { status: 200 });
    return res.json(parsed);
  } catch (e) {
    if (normalizedSectionKey === "scope") {
      if (_tid) {
        const _sa = normalizedContext?.scopeInputAnalysis || {};
        console.log(`[ai-assist:${_tid}] specialty_check branch=provider_error input="${String(userInput || "").slice(0, 60)}" weld_base=${_sa.weldingBaseProcess || "none"} weld_conf=${_sa.weldingConfidence || "none"} iron_family=${_sa.ironworkTradeFamily || "none"} carp_family=${_sa.carpentryTradeFamily || "none"} error_status=${e?.httpStatus || 0} error_code=${normalizeSectionAssistFailure(e).code}`);
      }
      const specialtyFallback = buildSpecialtyLocalFallback(normalizedContext, String(userInput || ""));
      if (specialtyFallback) {
        const failure = normalizeSectionAssistFailure(e);
        if (_tid) console.log(`[ai-assist:${_tid}] branch=success_fallback note_len=${String(specialtyFallback.scopeNotes || "").length}`);
        trace.end("specialty_local_fallback", { status: 200, reason: failure.code });
        return res.json(specialtyFallback);
      }
      if (_tid) {
        const failure = normalizeSectionAssistFailure(e);
        console.log(`[ai-assist:${_tid}] branch=failure_busy_no_local_fallback failure_code=${failure.code} retryable=${failure.retryable}`);
      }
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
