// @ts-nocheck
/* eslint-disable */

import {
  buildSectionPayload,
  chooseNextGuidedTarget,
  describeFieldValue,
  GUIDED_PLANNER_META_KEY,
  getGuidedField,
  getGuidedPlannerState,
  getLiveOptionsForField,
  MATERIALS_MODE_OPTIONS,
  TRADE_INSERT_OPTIONS,
} from "./registry";
import { getSupabaseClient } from "../../lib/supabaseClient";

const REQUEST_TIMEOUT_MS = 150000;

export async function getSessionAuthorizationHeader() {
  try {
    const client = getSupabaseClient();
    const result = await client?.auth?.getSession?.();
    const token = String(result?.data?.session?.access_token || "").trim();
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}
const MAX_GUIDED_FIELD_SUBSET = 4;
const MAX_PRIOR_GUIDED_ANSWERS = 3;
const MAX_SUMMARY_TEXT = 160;
const AI_OPTION_FIELDS = new Set([
  "customer.id",
  "customer.projectSameAsCustomer",
  "customer.state",
  "tradeInsert.key",
  "ui.materialsMode",
  "labor.lines",
]);
const GUIDED_INTERPRETIVE_FIELDS = new Set([
  "scopeNotes",
  "tradeInsert.key",
  "labor.lines",
  "materials.items",
  "additionalNotes",
]);
const STEP_RUNNER_REASON_BY_FIELD = Object.freeze({
  "customer.id": "customer_selection",
  "customer.projectSameAsCustomer": "project_location_match",
  "customer.projectAddress": "project_location",
  "scopeNotes": "scope_driver",
  "tradeInsert.key": "trade_definition",
  "labor.lines": "labor_basis",
  "ui.materialsMode": "materials_path",
  "materials.blanketCost": "materials_basis",
  "materials.items": "materials_basis",
  "materials.markupPct": "markup_assumption",
  "additionalNotes": "notes_assumptions",
  "job.docNumber": "review_handoff",
});
const GUIDED_SHORT_FORM_ALLOWED_TOKENS = new Set([
  "lvp",
  "lvt",
  "sf",
  "sqft",
  "sq",
  "ft",
  "ti",
  "ac",
  "hvac",
  "yes",
  "no",
  "big",
]);
const GUIDED_UNRESOLVED_STEP_STATUSES = new Set([
  "partially_resolved",
  "unresolved_clarified",
  "invalid_for_prompt",
  "needs_interpretive_retry",
]);
const GUIDED_ADAPTIVE_PROMPT_VARIANTS = new Set([
  "initial",
  "clarify",
  "narrow_clarify",
  "repair",
  "confirm",
]);
const GUIDED_ADAPTIVE_ANSWER_CLASSIFICATIONS = new Set([
  "resolved",
  "partial",
  "unresolved_clarify",
  "invalid_for_step",
  "repeated_unresolved",
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function limitChoices(choices, max = 6) {
  return asArray(choices).slice(0, max);
}

function timeoutPromise(ms) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error("guided-build timeout")), ms);
  });
}

function normalizeSuggestedChoices(rawChoices = []) {
  return asArray(rawChoices)
    .map((choice, index) => ({
      id: String(choice?.id || `${choice?.fieldKey || "choice"}:${choice?.value ?? index}`),
      label: String(choice?.label || choice?.title || choice?.value || "").trim(),
      description: String(choice?.description || "").trim(),
      value: choice?.value,
      fieldKey: String(choice?.fieldKey || "").trim(),
      source: String(choice?.source || "ai").trim(),
    }))
    .filter((choice) => choice.label);
}

function normalizeExtractedFieldValues(rawValues = []) {
  return asArray(rawValues)
    .map((entry) => ({
      key: String(entry?.key || "").trim(),
      value: normalizeGuidedPublishText(String(entry?.key || "").trim(), entry?.value),
      confidence: Number(entry?.confidence || 0),
      source: String(entry?.source || "ai").trim(),
      reason: trimText(String(entry?.reason || "").trim(), 160),
    }))
    .filter((entry) => entry.key);
}

function trimText(value, max = MAX_SUMMARY_TEXT) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.length > max ? `${raw.slice(0, max - 1)}...` : raw;
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

function normalizeGuidedPublishText(fieldKey, rawValue) {
  if (typeof rawValue !== "string") return rawValue;
  let text = stripGuidedSpeakerLead(rawValue)
    .replace(/\s+/g, " ")
    .replace(/\s+,/g, ",")
    .replace(/\s+\./g, ".")
    .replace(/\s*;\s*/g, "; ")
    .trim();
  if (!text) return "";

  if (fieldKey === "scopeNotes" || fieldKey === "tradeInsert.text" || fieldKey === "additionalNotes") {
    text = toSentenceCase(text);
    if (!/[.!?]$/.test(text)) text = `${text}.`;
    return trimText(text, 220);
  }

  if (fieldKey === "__intentSummary") {
    return trimText(toSentenceCase(text), 160);
  }

  return text;
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

function exactMatchOption(options, value) {
  const raw = normalizeLooseGuidedText(value);
  if (!raw) return null;
  return asArray(options).find((option) => {
    const label = normalizeLooseGuidedText(option?.label);
    const optionValue = normalizeLooseGuidedText(option?.value);
    return raw === label || raw === optionValue;
  }) || null;
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
    /\bbase(?:board)?s?\b/,
    /\btransitions?\b/,
    /\bsubfloor\b/,
  ]);
}

function guidedTextHasDrywallSignal(text) {
  return guidedTextHasAny(text, [
    /\bdrywall\b/,
    /\bsheetrock\b/,
    /\bpatch(?:ing|es)?\b/,
    /\btexture\b/,
    /\bmud\b/,
    /\btape\b/,
    /\bopened walls?\b/,
    /\bcut open\b/,
    /\bplumbing opened\b/,
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

function guidedTokenLooksLikeMash(token) {
  const value = String(token || "").trim().toLowerCase();
  if (!value || GUIDED_SHORT_FORM_ALLOWED_TOKENS.has(value)) return false;
  if (value.length >= 4 && /^(.)\1+$/.test(value)) return true;
  if (/^(?:asdf|qwer|zxcv|hjkl|qazwsx|poiuy|lkjhg|mnbvc|sdfg|fghj)+$/.test(value)) return true;
  if (value.length >= 6 && !/[aeiou]/.test(value) && !/\d/.test(value)) return true;
  if (value.length >= 6 && new Set(value.split("")).size <= 2) return true;
  return false;
}

function isGuidedGibberishAnswer(answer) {
  const text = normalizeLooseGuidedText(answer);
  if (!text) return false;
  const words = text.split(" ").filter(Boolean);
  if (!words.length) return false;
  if (words.length === 1 && guidedTokenLooksLikeMash(words[0])) return true;
  if (words.every((word) => guidedTokenLooksLikeMash(word))) return true;
  if (words.length >= 2 && words.every((word) => word === words[0]) && guidedTokenLooksLikeMash(words[0])) return true;
  return false;
}

function isWeakGuidedClarificationQuestion(value = "") {
  const text = normalizeLooseGuidedText(value);
  if (!text) return true;
  return [
    /\bwhat should i price next\b/,
    /\bwhat should i carry next\b/,
    /\bwhat should i fill in next\b/,
    /\bgive me the part of the job detail\b/,
    /\bplease provide more details\b/,
    /\btell me more\b/,
    /\bcurrent step\b/,
    /\bcoverage\b/,
    /\bmissing field\b/,
  ].some((pattern) => pattern.test(text));
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

function parseGuidedMaterialsModeIntent(answer) {
  const text = normalizeLooseGuidedText(answer);
  if (!text) return "";
  if (guidedTextHasAny(text, [/\bitemi(?:zed|ze)\b/, /\bline[-\s]?item(?:s|ize|ized)?\b/, /\blist materials?\b/])) {
    return "itemized";
  }
  if (guidedTextHasAny(text, [
    /\ballowance\b/,
    /\bblanket\b/,
    /\bcarry(?:ing)? materials?\b/,
    /\bmaterials?\s+as\s+allowance\b/,
    /\bmaterials?\s+allowance\b/,
  ])) {
    return "blanket";
  }
  return "";
}

const GUIDED_TRADE_SIGNAL_RULES = Object.freeze([
  {
    value: "flooring",
    patterns: [
      [/\blvp\b/, 5],
      [/\blvt\b/, 5],
      [/\bvinyl plank\b/, 5],
      [/\bluxury vinyl\b/, 5],
      [/\bfloor(?:ing|s)?\b/, 2],
      [/\blaminate\b/, 4],
      [/\btile\b/, 3],
      [/\btransitions?\b/, 2],
      [/\bsubfloor\b/, 2],
      [/\bbase(?:board)?s?\b/, 1],
      [/\bstairs?\b/, 1],
    ],
  },
  {
    value: "drywall",
    patterns: [
      [/\bdrywall\b/, 5],
      [/\bsheetrock\b/, 5],
      [/\btexture\b/, 3],
      [/\bopened walls?\b/, 4],
      [/\bcut open\b/, 4],
      [/\bplumbing opened\b/, 5],
      [/\bmud\b/, 3],
      [/\btape\b/, 3],
      [/\bpatch(?:ing|es)?\b/, 2],
      [/\bboard replacement\b/, 4],
      [/\bsection replacement\b/, 4],
    ],
  },
  {
    value: "painting",
    patterns: [
      [/\bpaint(?:ing|ed)?\b/, 5],
      [/\brepaint\b/, 5],
      [/\bwalls?\b/, 2],
      [/\bceilings?\b/, 2],
      [/\btrim\b/, 2],
      [/\bdoors?\b/, 1],
      [/\bclosets?\b/, 1],
      [/\bbaseboards?\b/, 1],
      [/\bcoats?\b/, 2],
      [/\bcolor\b/, 2],
      [/\bstucco\b/, 1],
    ],
  },
  {
    value: "plumbing",
    patterns: [
      [/\bplumbing\b/, 5],
      [/\bpipes?\b/, 3],
      [/\bfixtures?\b/, 2],
    ],
  },
  {
    value: "demo",
    patterns: [
      [/\bdemo\b/, 5],
      [/\bdemolition\b/, 5],
      [/\btear\s*out\b/, 4],
      [/\bremoval\b/, 3],
    ],
  },
]);

function joinGuidedList(items = []) {
  const values = Array.from(new Set(asArray(items).map((item) => String(item || "").trim()).filter(Boolean)));
  if (!values.length) return "";
  if (values.length === 1) return values[0];
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function collectGuidedLabels(text, entries = []) {
  return entries
    .filter((entry) => entry?.pattern?.test(text))
    .map((entry) => entry.label);
}

function extractApproxGuidedNumber(answer, normalizedText, minimum = 1) {
  const raw = String(answer || "").trim();
  const explicitMatch = raw.match(/\b(?:about|around|approx(?:imately)?|roughly|~)?\s*(\d+(?:\.\d+)?)\s*(?:sq\s*ft|sqft|sf|square feet)?\b/i);
  if (explicitMatch && Number(explicitMatch[1]) >= minimum) return explicitMatch[1];
  const normalizedMatch = String(normalizedText || "").match(/\b(\d+(?:\.\d+)?)\b/);
  if (normalizedMatch && Number(normalizedMatch[1]) >= minimum) return normalizedMatch[1];
  return "";
}

function scoreGuidedTradeSignals(text) {
  const normalized = normalizeLooseGuidedText(text);
  return GUIDED_TRADE_SIGNAL_RULES.map((rule) => ({
    value: rule.value,
    score: rule.patterns.reduce((sum, [pattern, weight]) => (
      pattern.test(normalized) ? sum + Number(weight || 0) : sum
    ), 0),
  }));
}

function buildPaintingScopeBasis(answer, text) {
  if (/\bstucco\b/.test(text) && /\bcracks?\b/.test(text)) {
    let summary = "Stucco crack repair and exterior repaint";
    if (/\bfront of house\b/.test(text)) summary += " at the front of the house";
    if (/\btwo story\b|\b2 story\b/.test(text)) summary += "; two-story access noted";
    if (/\bladder\b/.test(text)) summary += "; ladder setup noted";
    if (/\blift\b|\bscaffold\b/.test(text)) summary += "; access equipment to confirm";
    return normalizeGuidedPublishText("scopeNotes", summary);
  }

  if (guidedTextHasCommercialSignal(text)) {
    let summary = /\brepaint\b|\bpaint(?:ing|ed)?\b/.test(text) ? "Office suite repaint" : "Commercial painting scope";
    const roomCount = text.match(/\b(\d+)\s*rooms?\b/);
    if (roomCount) summary += ` for ${roomCount[1]} rooms`;
    if (/\bhallway\b/.test(text)) summary += roomCount ? " and hallway areas" : " including hallway areas";
    if (/\btenant improvement\b|\bti cleanup\b/.test(text)) summary += "; tenant-improvement cleanup noted";
    if (/\bwarehouse\b/.test(text)) summary = "Warehouse repaint scope";
    return normalizeGuidedPublishText("scopeNotes", summary);
  }

  let summary = /\binterior\b|\binside\b/.test(text)
    ? "Interior repaint"
    : (/\bexterior\b|\boutside\b/.test(text) ? "Exterior repaint" : "Painting scope");
  if (/\bwarehouse\b/.test(text) && /\binterior\b|\binside\b/.test(text)) {
    summary = "Warehouse interior repaint";
  }
  const bedroomCount = text.match(/\b(\d+)\s*bed(?:rooms?)?\b/);
  if (bedroomCount) {
    summary += ` for a ${bedroomCount[1]}-bedroom house`;
  } else if (/\bhouse\b|\bhome\b/.test(text)) {
    summary += " for the house";
  } else {
    const roomCount = text.match(/\b(\d+)\s*rooms?\b/);
    if (roomCount) summary += ` for ${roomCount[1]} rooms`;
  }
  const surfaces = collectGuidedLabels(text, [
    { pattern: /\bwalls?\b/, label: "walls" },
    { pattern: /\bceilings?\b/, label: "ceilings" },
    { pattern: /\btrim\b/, label: /\bmaybe trim\b/.test(text) ? "trim to confirm" : "trim" },
    { pattern: /\bdoors?\b/, label: "doors" },
    { pattern: /\bclosets?\b/, label: "closets" },
    { pattern: /\bbaseboards?\b/, label: "baseboards" },
  ]);
  if (surfaces.length) summary += ` including ${joinGuidedList(surfaces)}`;
  if (/\bpatch(?:ing)?\b|\brepairs?\b/.test(text)) summary += "; patching and prep noted";
  return normalizeGuidedPublishText("scopeNotes", summary);
}

function buildFlooringScopeBasis(answer, text) {
  let summary = /\blvp\b|\blvt\b|\bvinyl plank\b|\bluxury vinyl\b/.test(text)
    ? "Install LVP flooring"
    : "Install flooring";
  const areas = collectGuidedLabels(text, [
    { pattern: /\bdownstairs\b/, label: "downstairs area" },
    { pattern: /\bliving room\b/, label: "living room" },
    { pattern: /\bkitchen\b/, label: "kitchen" },
    { pattern: /\bhallway\b/, label: "hallway" },
    { pattern: /\bstairs?\b/, label: "stairs" },
    { pattern: /\bbedrooms?\b/, label: "bedrooms" },
  ]);
  if (areas.length) summary += ` in the ${joinGuidedList(areas)}`;
  const approxSqFt = extractApproxGuidedNumber(answer, text, 100);
  if (approxSqFt) summary += `, approximately ${approxSqFt} square feet`;
  if (/\bdemo\b|\bremove\b|\btear\s*out\b/.test(text)) summary += "; demo and removal included";
  if (/\bbase(?:board)?s?\b/.test(text)) summary += "; base removal noted";
  if (/\btransitions?\b/.test(text)) summary += "; transitions noted";
  return normalizeGuidedPublishText("scopeNotes", summary);
}

function buildDrywallScopeBasis(answer, text) {
  let summary = /\bplumbing opened\b|\bplumbing\b/.test(text)
    ? "Drywall repair where plumbing opened the walls"
    : "Drywall repair";
  const areas = collectGuidedLabels(text, [
    { pattern: /\bbathroom\b/, label: "bathroom" },
    { pattern: /\bkitchen\b/, label: "kitchen" },
    { pattern: /\bhallway\b/, label: "hallway" },
    { pattern: /\bceiling\b/, label: "ceiling areas" },
  ]);
  if (areas.length) summary += ` in the ${joinGuidedList(areas)}`;
  const areaCount = extractApproxGuidedNumber(answer, text, 2);
  if (/\ba few\b|\bfew\b|\bcouple\b/.test(text)) {
    summary += "; a few repair areas";
  } else if (areaCount && /\b(?:areas?|spots?|patches?|sections?|openings?)\b/.test(text)) {
    summary += `; ${areaCount} repair areas`;
  }
  if (/\blarge\b|\bsection replacement\b|\bboard replacement\b|\breplace(?:ment)?\b/.test(text)) {
    summary += "; larger section replacement to confirm";
  } else {
    summary += "; patch and finish";
  }
  if (/\btexture\b/.test(text)) summary += "; texture match to confirm";
  if (/\bpaint\b/.test(text)) summary += "; paint touch-up to confirm";
  return normalizeGuidedPublishText("scopeNotes", summary);
}

function buildProfessionalScopeBasisText(answer, tradeKey = "") {
  const raw = String(answer || "").trim();
  if (!raw) return "";
  const text = normalizeLooseGuidedText(raw);
  const detectedTrade = String(tradeKey || detectTradeInsert(raw)?.value || "").trim();
  if (detectedTrade === "flooring") return buildFlooringScopeBasis(raw, text);
  if (detectedTrade === "drywall") return buildDrywallScopeBasis(raw, text);
  if (detectedTrade === "painting") return buildPaintingScopeBasis(raw, text);
  return normalizeGuidedPublishText("scopeNotes", raw);
}

function buildScopeWriteFromAnswer(answer, existingScopeNotes = "", existingTradeKey = "") {
  if (String(existingScopeNotes || "").trim()) return null;
  if (!isLikelyRichScopeAnswer(answer)) return null;
  const trade = detectTradeInsert(answer, existingTradeKey);
  const cleaned = buildProfessionalScopeBasisText(answer, trade?.value || existingTradeKey);
  if (!cleaned) return null;
  return {
    key: "scopeNotes",
    value: cleaned,
    confidence: trade?.value ? 0.91 : 0.9,
    source: "user_input_scope_cleanup",
  };
}

function isLikelyRichScopeAnswer(answer) {
  const text = normalizeLooseGuidedText(answer);
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
  if (/\b\d+\s*(?:bedrooms?|rooms?|walls?|doors?|closets?|windows?|areas?|patches?|sections?|openings?)\b/.test(text)) signals += 1;
  if (guidedTextHasQuantitySignal(text)) signals += 1;
  if (/\b(?:one|two|1|2)\s+coats?\b/.test(text)) signals += 1;
  return signals >= 2 || (wordCount >= 5 && signals >= 1);
}

function looksLikeFinalGuidedNote(answer) {
  const text = normalizeLooseGuidedText(answer);
  if (!text || isLikelyRichScopeAnswer(answer)) return false;
  return guidedTextHasAny(text, [
    /\bexclude(?:d|s|ing)?\b/,
    /\bexclusions?\b/,
    /\bnot included\b/,
    /\bpayment\b/,
    /\bdeposit\b/,
    /\bterms?\b/,
    /\bwarranty\b/,
    /\bvalid\b/,
    /\bsubject to\b/,
    /\ballowance\b/,
    /\bcleanup\b/,
    /\bproposal\b/,
  ]) || /^(?:note|notes|exclude|exclusions|payment|terms|warranty)\b/.test(text);
}

function normalizeInterpretedIntent(raw, fallback = null) {
  const source = raw && typeof raw === "object"
    ? raw
    : (fallback && typeof fallback === "object" ? fallback : { kind: String(raw || "").trim() });
  return compactObject({
    kind: String(source?.kind || source?.type || "").trim().toLowerCase(),
    summary: normalizeGuidedPublishText("__intentSummary", source?.summary || source?.description || ""),
    targetField: String(source?.targetField || source?.fieldKey || "").trim(),
    tradeKey: String(source?.tradeKey || source?.matchedTradeKey || "").trim(),
  });
}

function normalizeMissingContext(raw) {
  return asArray(raw)
    .map((entry) => {
      if (entry && typeof entry === "object") {
        return trimText(entry?.question || entry?.label || entry?.key || entry?.fieldKey || "", 140);
      }
      return trimText(entry, 140);
    })
    .filter(Boolean)
    .slice(0, 4);
}

function normalizeNextBestQuestion(raw, fallbackFieldKey = "", fallbackQuestion = "") {
  const source = raw && typeof raw === "object"
    ? raw
    : { question: raw, fieldKey: fallbackFieldKey };
  return compactObject({
    fieldKey: String(source?.fieldKey || source?.key || fallbackFieldKey || "").trim(),
    sectionKey: String(source?.sectionKey || "").trim(),
    question: trimText(source?.question || source?.assistantMessage || fallbackQuestion || "", 180),
  });
}

function isScopeIntentKind(kind) {
  const value = String(kind || "").trim().toLowerCase();
  return value.includes("scope") || value.includes("painting") || value.includes("trade");
}

function isNotesIntentKind(kind) {
  const value = String(kind || "").trim().toLowerCase();
  return value.includes("note") || value.includes("exclusion") || value.includes("payment") || value.includes("warranty");
}

function buildGuidedChoice(label, fieldKey, description = "", value = undefined, source = "local_context") {
  const trimmedLabel = String(label || "").trim();
  if (!trimmedLabel) return null;
  const choice = {
    id: `${fieldKey || "choice"}:${normalizeLooseGuidedText(trimmedLabel).replace(/\s+/g, "-") || "choice"}`,
    label: trimmedLabel,
    description: trimText(description, 120),
    source,
  };
  if (fieldKey) choice.fieldKey = fieldKey;
  if (value !== undefined) choice.value = value;
  return choice;
}

function buildAtomicScopePrompt(payload = {}) {
  const plannerState = normalizePlannerState({
    ...readPlannerStateFromPayload(payload),
    ...(payload?.activeStep?.plannerState || {}),
  });
  const promptIntent = String(payload?.activeStep?.promptIntent || "").trim();
  const promptText = String(payload?.activeStep?.promptText || payload?.currentPrompt || "").trim();
  const tradeKey = String(payload?.state?.tradeInsert?.key || plannerState.tradeKey || "").trim();
  const text = normalizeLooseGuidedText([
    payload?.state?.scopeNotes,
    payload?.userAnswer,
    promptText,
    promptIntent,
    tradeKey,
  ].filter(Boolean).join(" "));
  const commercialEnvironment = getGuidedCommercialEnvironment(text);
  const painting = plannerState.painting
    || promptIntent.startsWith("painting_")
    || tradeKey === "painting"
    || guidedTextHasAny(text, [/\bpaint(?:ing|ed)?\b/, /\brepaint\b/, /\btrim\b/, /\bceilings?\b/]);
  const flooring = plannerState.flooring
    || promptIntent.startsWith("flooring_")
    || tradeKey === "flooring"
    || guidedTextHasFlooringSignal(text);
  const drywallRepair = plannerState.drywallRepair
    || promptIntent.startsWith("drywall_")
    || tradeKey === "drywall"
    || guidedTextHasDrywallSignal(text);
  const stuccoRepair = plannerState.stuccoRepair
    || promptIntent === "stucco_extent"
    || (/\bstucco\b/.test(text) && /\bcracks?\b|\brepair(?:s|ing)?\b/.test(text));

  if (promptIntent === "painting_surfaces" || promptIntent === "scope_surfaces") {
    return "Which surfaces are included in the price?";
  }
  if (promptIntent === "painting_occupancy") {
    return "Will the work be done in an occupied space, a furnished space, or a vacant one?";
  }
  if (promptIntent === "commercial_access") {
    return buildCommercialAccessQuestion(commercialEnvironment);
  }
  if (promptIntent === "flooring_quantity") {
    return "About how much floor area are we covering?";
  }
  if (promptIntent === "drywall_repair_count") {
    return "How many repair areas are we dealing with?";
  }
  if (promptIntent === "drywall_repair_shape") {
    return "Are these small patches, or larger drywall sections that need replacement?";
  }
  if (promptIntent === "stucco_extent") {
    return "Am I carrying isolated crack repairs with touch-up paint, or a larger stucco repair and repaint area?";
  }
  if (!tradeKey && plannerState.tradeRecognized !== true && !painting && !flooring && !drywallRepair && !stuccoRepair) {
    return "What kind of work is this?";
  }
  if (painting) return "Which surfaces or areas are included in the price?";
  if (flooring) return "About how much floor area are we covering?";
  if (drywallRepair) return "How many repair areas are we dealing with?";
  if (stuccoRepair) return "Am I carrying isolated crack repairs, or a larger repair and repaint area?";
  return "What work are you doing there?";
}

function dedupeGuidedChoices(choices, max = 3) {
  const seen = new Set();
  const out = [];
  asArray(choices).forEach((choice) => {
    const label = String(choice?.label || "").trim();
    const fieldKey = String(choice?.fieldKey || "").trim();
    if (!label) return;
    const dedupeKey = `${fieldKey}:${normalizeLooseGuidedText(label)}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push(choice);
  });
  return out.slice(0, max);
}

function normalizeGuidedPromptText(value) {
  return trimText(value, 180);
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
    scopeOccupancy: scopePrompt && guidedTextHasAny(prompt, [/\boccupied\b/, /\bvacant\b/, /\bfurnished\b/, /\bempty\b/]),
    scopeCoverage: scopePrompt && guidedTextHasAny(prompt, [/\bwalls?\b/, /\bceilings?\b/, /\btrim\b/, /\bdoors?\b/, /\bclosets?\b/, /\bbaseboards?\b/, /\bsurfaces?\b/, /\bareas?\b/]),
    scopeCoats: scopePrompt && guidedTextHasAny(prompt, [/\bcoat(?:s)?\b/, /\bcolor\b/, /\bcolor change\b/, /\bsame color\b/]),
    scopeFinish: scopePrompt && guidedTextHasAny(prompt, [/\bfinish(?:es)?\b/, /\bsheen\b/, /\bflat\b/, /\beggshell\b/, /\bsatin\b/, /\bsemi[\s-]?gloss\b/, /\bgloss\b/]),
  };
}

function normalizeGuidedStepComponents(values) {
  return Array.from(new Set(asArray(values).map((value) => String(value || "").trim()).filter(Boolean)));
}

function normalizeGuidedStepResolution(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return compactObject({
    status: String(source?.status || "").trim(),
    answeredComponents: normalizeGuidedStepComponents(source?.answeredComponents),
    missingComponents: normalizeGuidedStepComponents(source?.missingComponents),
    markers: normalizePlannerState(source?.markers),
    invalidReason: trimText(source?.invalidReason, 140),
  });
}

function resolveGuidedStepIntentFromPrompt(fieldKey, sectionKey, promptText, plannerState = {}) {
  const prompt = normalizeLooseGuidedText(promptText);
  const focus = detectGuidedPromptFocus(fieldKey, sectionKey, promptText);

  if (fieldKey === "customer.id") return "customer_selection";
  if (fieldKey === "customer.projectSameAsCustomer") return "project_location_match";
  if (fieldKey === "customer.projectAddress") return "project_location";
  if (fieldKey === "customer.state") return "customer_state";
  if (fieldKey === "ui.materialsMode") return "materials_path";
  if (fieldKey === "materials.blanketCost") return "materials_allowance";
  if (fieldKey === "materials.items") return "materials_itemized";
  if (fieldKey === "labor.lines") return "labor_basis";
  if (fieldKey === "tradeInsert.key") return "trade_definition";
  if (fieldKey === "job.docNumber") return "review_handoff";
  if (fieldKey === "additionalNotes") {
    if (focus.notesAccess) return "notes_access";
    if (focus.notesMaterials) return "notes_materials";
    if (focus.notesFurniture) return "notes_furniture";
    return "notes_general";
  }
  if (fieldKey !== "scopeNotes") return "generic";
  if (/\bhow many repair areas\b/.test(prompt)) return "drywall_repair_count";
  if (/\bsmall patches\b|\blarger drywall sections?\b|\breplacement\b/.test(prompt)) return "drywall_repair_shape";
  if (/\btexture match\b|\bsmooth finish\b|\bready for paint\b/.test(prompt)) return "drywall_finish";
  if (/\bpaint touch(?:-?up)?\b|\bdrywall repair only\b|\bready for painter\b/.test(prompt)) return "drywall_paint_scope";
  if (/\bfloor area\b|\bhow much floor area\b/.test(prompt)) return "flooring_quantity";
  if (/\bdemo\b|\bremoval\b/.test(prompt)) return "flooring_demo";
  if (/\btransitions?\b|\bbase removal\b|\bstairs\b/.test(prompt)) return "flooring_transitions";
  if (/\bsubfloor\b|\bmoisture\b/.test(prompt)) return "flooring_prep";
  if (/\bstucco\b|\bfront area\b|\bexterior area\b/.test(prompt)) return "stucco_extent";
  if (/\bwarehouse\b|\boccupied offices\b|\bafter-hours\b|\bafter hours\b|\boperations\b|\bopen access\b/.test(prompt)) return "commercial_access";
  if (focus.scopeCoverage) return plannerState?.painting === true ? "painting_surfaces" : "scope_surfaces";
  if (focus.scopeCoats) return "painting_coats_color";
  if (focus.scopePrep) return plannerState?.flooring === true ? "flooring_prep" : "painting_prep";
  if (focus.scopeOccupancy) return plannerState?.commercialContext === true ? "commercial_access" : "painting_occupancy";
  if (focus.scopeFinish) return plannerState?.drywallRepair === true ? "drywall_finish" : "painting_finish";
  if (/\bladder\b|\blift\b|\bscaffold\b/.test(prompt)) return "access_setup";
  if (/\binside work\b|\boutside work\b|\bboth\b/.test(prompt)) return "scope_location_type";
  if (/\bhow much\b|\bhow many\b|\barea\b|\brooms?\b|\bsuite\b|\bsections?\b/.test(prompt)) {
    if (plannerState?.flooring === true) return "flooring_quantity";
    if (plannerState?.drywallRepair === true) return "drywall_repair_count";
    if (plannerState?.commercialContext === true) return "commercial_extent";
    return "scope_quantity";
  }
  return plannerState?.painting === true ? "painting_surfaces" : "scope_clarification";
}

const GUIDED_BLOCKER_FAMILY_BY_FIELD = Object.freeze({
  "customer.id": "customer",
  "customer.projectSameAsCustomer": "customer",
  "customer.projectAddress": "customer",
  "customer.state": "customer",
  "tradeInsert.key": "trade",
  "labor.lines": "labor_basis",
  "ui.materialsMode": "materials_mode",
  "materials.blanketCost": "materials_basis",
  "materials.blanketInternalCost": "materials_basis",
  "materials.items": "materials_basis",
  "materials.markupPct": "materials_basis",
  "materials.materialsBlanketDescription": "materials_basis",
  additionalNotes: "notes",
  "job.docNumber": "review",
});

const GUIDED_BLOCKER_FAMILY_BY_INTENT = Object.freeze({
  customer_selection: "customer",
  project_location_match: "customer",
  project_location: "customer",
  customer_state: "customer",
  trade_definition: "trade",
  labor_basis: "labor_basis",
  materials_path: "materials_mode",
  materials_allowance: "materials_basis",
  materials_itemized: "materials_basis",
  painting_surfaces: "surfaces",
  scope_surfaces: "surfaces",
  painting_occupancy: "occupancy_access",
  commercial_access: "occupancy_access",
  access_setup: "occupancy_access",
  flooring_quantity: "area_scope",
  commercial_extent: "area_scope",
  stucco_extent: "area_scope",
  scope_quantity: "area_scope",
  drywall_repair_count: "drywall_repair",
  drywall_repair_shape: "drywall_repair",
  drywall_finish: "drywall_repair",
  drywall_paint_scope: "drywall_repair",
  scope_location_type: "location",
  flooring_demo: "demo",
  flooring_transitions: "transitions",
  painting_prep: "prep",
  flooring_prep: "prep",
  painting_finish: "painting_finish",
  painting_coats_color: "painting_coats_color",
  notes_general: "notes",
  notes_access: "notes",
  notes_materials: "notes",
  notes_furniture: "notes",
  review_handoff: "review",
});

function getGuidedBlockerFamilyFromIntent(intent = "") {
  return GUIDED_BLOCKER_FAMILY_BY_INTENT[String(intent || "").trim()] || "";
}

function getGuidedBlockerFamilyFromField(fieldKey = "") {
  return GUIDED_BLOCKER_FAMILY_BY_FIELD[String(fieldKey || "").trim()] || "";
}

function classifyGuidedTextFamily(value = "") {
  const text = normalizeLooseGuidedText(value);
  if (!text) return "";
  if (guidedTextHasAny(text, [/\bwho is the customer\b/, /\bwhich saved customer\b/, /\bcustomer for this estimate\b/, /\bjobsite address\b/])) return "customer";
  if (guidedTextHasAny(text, [/\bgeneric labor\b/, /\blabor\b/, /\bcrew\b/, /\bjourneyman\b/, /\bforeman\b/, /\bapprentice\b/, /\blaborer\b/, /\bhelper\b/])) return "labor_basis";
  if (guidedTextHasAny(text, [/\bwhat kind of work\b/, /\bkind of job\b/, /\bpainting\b/, /\bdrywall repair\b/, /\bflooring\b/, /\bstucco repair\b/, /\bdemolition\b/])) return "trade";
  if (guidedTextHasAny(text, [/\btexture match\b/, /\bsmooth finish\b/, /\bready for paint\b/, /\bdrywall repair only\b/, /\bpaint touch(?:-?up)?\b/, /\brepair areas?\b/, /\blarger drywall sections?\b/, /\bsmall patches?\b/])) return "drywall_repair";
  if (guidedTextHasAny(text, [/\bwalls?\b/, /\bceilings?\b/, /\btrim\b/, /\bdoors?\b/, /\bclosets?\b/, /\bsurfaces?\b/])) return "surfaces";
  if (guidedTextHasAny(text, [/\boccupied\b/, /\bvacant\b/, /\bfurnished\b/, /\bopen access\b/, /\bafter[-\s]?hours\b/, /\boperations\b/, /\bladder\b/, /\blift\b/, /\bscaffold\b/])) return "occupancy_access";
  if (guidedTextHasAny(text, [/\binterior\b/, /\binside\b/, /\bexterior\b/, /\boutside\b/, /\bboth\b/])) return "location";
  if (guidedTextHasAny(text, [/\ballowance\b/, /\bitemize\b/, /\bitemized\b/, /\blabor only\b/, /\bmaterials path\b/])) return "materials_mode";
  if (guidedTextHasAny(text, [/\bmaterials allowance\b/, /\bmaterials should i carry\b/, /\bmarkup\b/, /\bblanket materials\b/])) return "materials_basis";
  if (guidedTextHasAny(text, [/\bone coat\b/, /\btwo coats?\b/, /\bcolor change\b/, /\bsame color\b/])) return "painting_coats_color";
  if (guidedTextHasAny(text, [/\bdemo\b/, /\bremoval\b/, /\btear\s*out\b/])) return "demo";
  if (guidedTextHasAny(text, [/\btransitions?\b/, /\bstairs?\b/, /\bbase removal\b/])) return "transitions";
  if (guidedTextHasAny(text, [/\bstandard prep\b/, /\bminor patch(?:ing)?\b/, /\bheavy prep\b/, /\bsubfloor\b/, /\bmoisture\b/, /\bprep\b/])) return "prep";
  if (guidedTextHasAny(text, [/\bflat\b/, /\beggshell\b/, /\bsatin\b/, /\bsemi[-\s]?gloss\b/, /\bfinish should i assume\b/])) return "painting_finish";
  if (guidedTextHasAny(text, [/\bhow much\b/, /\bhow many\b/, /\barea\b/, /\brooms?\b/, /\bsections?\b/, /\bwhole level\b/, /\bmost of downstairs\b/, /\ba few connected rooms\b/, /\bfull suite\b/])) return "area_scope";
  if (guidedTextHasAny(text, [/\bexclude(?:d|s|ing)?\b/, /\bassumptions?\b/, /\bcustomer[-\s]?supplied\b/, /\bowner moves furniture\b/, /\blimited access\b/])) return "notes";
  if (guidedTextHasAny(text, [/\breview\b/, /\bestimate number\b/, /\binvoice number\b/])) return "review";
  return "";
}

function buildCanonicalGuidedStepId(sectionKey = "", fieldKey = "", family = "") {
  const section = String(sectionKey || "review").trim() || "review";
  const field = String(fieldKey || "").trim();
  const normalizedFamily = String(family || "generic").trim() || "generic";
  return field ? `${section}:${field}:${normalizedFamily}` : "";
}

function parseGuidedStepIdFamily(stepId = "") {
  const parts = String(stepId || "").trim().split(":").filter(Boolean);
  return parts.length >= 3 ? String(parts[parts.length - 1] || "").trim() : "";
}

function getCanonicalGuidedBlockerFamily(fieldKey = "", promptIntent = "", promptText = "") {
  const key = String(fieldKey || "").trim();
  const fieldFamily = getGuidedBlockerFamilyFromField(key);
  const intentFamily = getGuidedBlockerFamilyFromIntent(promptIntent);
  if (key && key !== "scopeNotes") return fieldFamily || intentFamily || classifyGuidedTextFamily(promptText);
  return intentFamily || classifyGuidedTextFamily(promptText) || fieldFamily;
}

function buildGuidedStepContract(payload = {}, questionKey = "", sectionKey = "") {
  const source = payload?.activeStep && typeof payload.activeStep === "object" ? payload.activeStep : {};
  const fieldKey = String(questionKey || source?.fieldKey || source?.activeFieldKey || "").trim();
  const section = String(sectionKey || source?.sectionKey || source?.activeSectionKey || "").trim();
  const promptText = normalizeGuidedPromptText(source?.promptText || source?.prompt || payload?.currentPrompt || buildPromptForField(fieldKey, payload));
  const plannerState = normalizePlannerState({
    ...readPlannerStateFromPayload(payload),
    ...(source?.plannerState || {}),
  });
  const promptIntent = String(
    source?.promptIntent
    || resolveGuidedStepIntentFromPrompt(fieldKey, section, promptText, plannerState)
    || ""
  ).trim();
  const expectedComponents = normalizeGuidedStepComponents(
    source?.expectedComponents
    || ({
      materials_path: ["materialsPathKnown"],
      painting_surfaces: ["coverageKnown"],
      scope_surfaces: ["coverageKnown"],
      painting_coats_color: ["coatsKnown", "colorKnown"],
      painting_occupancy: ["occupancyKnown"],
      commercial_access: ["occupancyKnown"],
      painting_prep: ["prepKnown"],
      flooring_prep: ["prepKnown"],
      painting_finish: ["finishKnown"],
      drywall_finish: ["textureKnown"],
      access_setup: ["accessSetupKnown"],
      flooring_quantity: ["quantityBasisKnown"],
      commercial_extent: ["quantityBasisKnown"],
      stucco_extent: ["quantityBasisKnown"],
      scope_quantity: ["quantityBasisKnown"],
      scope_location_type: ["interiorExteriorKnown"],
      flooring_demo: ["demoKnown"],
      flooring_transitions: ["transitionsKnown"],
      drywall_repair_count: ["repairCountKnown"],
      drywall_repair_shape: ["patchVsReplaceKnown"],
      drywall_paint_scope: ["paintTouchupKnown"],
      notes_general: ["notesResolved"],
      notes_access: ["scheduleKnown"],
      notes_materials: ["suppliedMaterialsKnown"],
      notes_furniture: ["furnitureKnown"],
      trade_definition: ["tradeRecognized"],
    }[promptIntent] || [])
  );
  const expectedAnswerMode = String(
    source?.expectedAnswerMode
    || ({
      materials_path: "material_path",
      painting_surfaces: "scope_clarification",
      scope_surfaces: "scope_clarification",
      painting_coats_color: "mixed_multi_part",
      painting_occupancy: "single_select",
      commercial_access: "mixed_multi_part",
      painting_prep: "single_select",
      flooring_prep: "single_select",
      painting_finish: "single_select",
      drywall_finish: "single_select",
      access_setup: "single_select",
      flooring_quantity: "quantity_extent",
      commercial_extent: "quantity_extent",
      stucco_extent: "quantity_extent",
      scope_quantity: "quantity_extent",
      scope_location_type: "single_select",
      flooring_demo: "single_select",
      flooring_transitions: "single_select",
      drywall_repair_count: "quantity_extent",
      drywall_repair_shape: "single_select",
      drywall_paint_scope: "single_select",
      notes_general: "notes_exclusions",
      notes_access: "access_risk",
      notes_materials: "notes_exclusions",
      notes_furniture: "notes_exclusions",
      labor_basis: "labor_path",
      trade_definition: "single_select",
    }[promptIntent] || "freeform")
  ).trim();
  const suggestedChoices = normalizeSuggestedChoices(
    source?.suggestedChoices
    || payload?.currentSuggestedChoices
    || payload?.suggestedChoices
    || []
  );

  // Enforce canonical section from field
  const canonicalField = fieldKey ? getGuidedField(fieldKey) : null;
  const canonicalSection = canonicalField?.section || section;

  // Defensive: enforce canonical blocker family alignment for prompt/chips
  const promptFamily = getCanonicalGuidedBlockerFamily(fieldKey, promptIntent, promptText);
  const chipFamily = classifyGuidedChoiceFamily(suggestedChoices);
  if (suggestedChoices.length > 0 && chipFamily && chipFamily !== promptFamily) {
    // Discard chips if cross-family detected
    return compactObject({
      fieldKey,
      sectionKey: canonicalSection,
      promptText,
      promptIntent,
      expectedAnswerMode,
      expectedComponents,
      suggestedChoices: [],
      repeatedUnresolvedCount: Number(source?.repeatedUnresolvedCount || payload?.turnState?.repeatedUnresolvedCount || 0) || 0,
      turnDiagnosis: String(source?.turnDiagnosis || payload?.turnState?.turnDiagnosis || "").trim(),
      missingComponents: normalizeGuidedStepComponents(source?.missingComponents),
      resolvedComponents: normalizeGuidedStepComponents(source?.resolvedComponents),
      canonicalStepId: buildCanonicalGuidedStepId(canonicalSection, fieldKey, promptFamily),
    });
  }

  // Canonicalize step id by blocker family and fieldKey
  const canonicalStepId = buildCanonicalGuidedStepId(canonicalSection, fieldKey, promptFamily);

  return compactObject({
    fieldKey,
    sectionKey: canonicalSection,
    promptText,
    promptIntent,
    expectedAnswerMode,
    expectedComponents,
    suggestedChoices,
    repeatedUnresolvedCount: Number(source?.repeatedUnresolvedCount || payload?.turnState?.repeatedUnresolvedCount || 0) || 0,
    turnDiagnosis: String(source?.turnDiagnosis || payload?.turnState?.turnDiagnosis || "").trim(),
    missingComponents: normalizeGuidedStepComponents(source?.missingComponents),
    resolvedComponents: normalizeGuidedStepComponents(source?.resolvedComponents),
    canonicalStepId,
  });
}

function buildGuidedNarrowFollowUp(contract, missingComponents = [], payload = {}, options = {}) {
  const missing = normalizeGuidedStepComponents(missingComponents);
  const firstMissing = missing[0];
  const intent = String(contract?.promptIntent || "").trim();
  const fieldKey = String(contract?.fieldKey || payload?.questionKey || "").trim() || "scopeNotes";
  const base = { fieldKey, sectionKey: String(contract?.sectionKey || payload?.sectionKey || "").trim() || "scope" };
  const forceClarify = options?.forceClarify === true;

  if (intent === "painting_coats_color" && firstMissing === "colorKnown") {
    return {
      ...base,
      question: "Is it staying the same color or changing?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Same color", fieldKey, "Carry same-color production."),
        buildGuidedChoice("Color change", fieldKey, "Carry color-change coverage."),
      ]),
    };
  }
  if (intent === "painting_coats_color" && firstMissing === "coatsKnown") {
    return {
      ...base,
      question: "Should I carry one coat or two?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("One coat", fieldKey, "Carry one finish coat."),
        buildGuidedChoice("Two coats", fieldKey, "Carry two finish coats."),
      ]),
    };
  }
  if (intent === "painting_surfaces" || intent === "scope_surfaces") {
    return {
      ...base,
      question: "Which surfaces are included: walls, ceilings, trim, doors, or closets?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Walls only", fieldKey, "Carry wall surfaces only."),
        buildGuidedChoice("Walls + ceilings", fieldKey, "Carry walls and ceilings."),
        buildGuidedChoice("Walls + ceilings + trim", fieldKey, "Carry walls, ceilings, trim, doors, and closets."),
      ]),
    };
  }
  if (intent === "commercial_access") {
    const promptSeed = normalizeLooseGuidedText([
      payload?.currentPrompt,
      payload?.userAnswer,
      contract?.promptText,
    ].filter(Boolean).join(" "));
    const environment = getGuidedCommercialEnvironment(promptSeed);
    return {
      ...base,
      question: buildCommercialAccessQuestion(environment),
      suggestedChoices: buildCommercialAccessChoices(environment),
    };
  }
  if (intent === "painting_prep") {
    return {
      ...base,
      question: "Should I carry standard prep only, or patching and repairs too?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Standard prep only", fieldKey, "Carry standard prep only."),
        buildGuidedChoice("Some patching / repairs", fieldKey, "Carry patching and repair prep."),
        buildGuidedChoice("Heavy prep", fieldKey, "Carry heavier repair and prep time."),
      ]),
    };
  }
  if (intent === "painting_finish") {
    return {
      ...base,
      question: "What finish should I carry?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Standard finish", fieldKey, "Carry a standard finish assumption."),
        buildGuidedChoice("Flat / eggshell", fieldKey, "Carry flat or eggshell finish."),
        buildGuidedChoice("Satin / semi-gloss", fieldKey, "Carry satin or semi-gloss finish."),
      ]),
    };
  }
  if (intent === "painting_occupancy") {
    return {
      ...base,
      question: "Is this occupied, vacant, or open access while work is happening?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Occupied", fieldKey, "Carry occupied-work protection and pacing."),
        buildGuidedChoice("Vacant", fieldKey, "Carry vacant open access."),
        buildGuidedChoice("Open access", fieldKey, "Carry open access with fewer restrictions."),
      ]),
    };
  }
  if (intent === "flooring_quantity") {
    return {
      ...base,
      question: "About how much floor area are we covering?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("A few connected rooms", fieldKey, "Carry connected living areas."),
        buildGuidedChoice("Most of downstairs", fieldKey, "Carry a larger downstairs footprint."),
        buildGuidedChoice("Whole level / full area", fieldKey, "Carry the full level or broad area."),
      ]),
    };
  }
  if (intent === "flooring_demo") {
    return {
      ...base,
      question: "Is existing flooring staying, or do I need to include demo and removal?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Leave existing in place", fieldKey, "No demo or removal included."),
        buildGuidedChoice("Include demo / removal", fieldKey, "Carry tear-out and disposal."),
        buildGuidedChoice("Demo in some areas only", fieldKey, "Carry partial demo and removal."),
      ]),
    };
  }
  if (intent === "flooring_transitions") {
    return {
      ...base,
      question: "Any stairs, base removal, or tricky transitions to account for?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("No stairs or tricky transitions", fieldKey, "Straight run with minimal finish work."),
        buildGuidedChoice("Base removal / reinstall", fieldKey, "Carry base removal and reinstall."),
        buildGuidedChoice("Stairs or multiple transitions", fieldKey, "Carry stair or transition detail."),
      ]),
    };
  }
  if (intent === "flooring_prep") {
    return {
      ...base,
      question: "Any subfloor prep or moisture issues I should carry?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Standard prep only", fieldKey, "No unusual prep beyond normal install."),
        buildGuidedChoice("Minor prep", fieldKey, "Carry minor prep and leveling."),
        buildGuidedChoice("Moisture / subfloor work", fieldKey, "Carry added prep or moisture mitigation."),
      ]),
    };
  }
  if (intent === "drywall_repair_count") {
    return {
      ...base,
      question: "How many repair areas are we dealing with?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("One or two areas", fieldKey, "Carry a small repair count."),
        buildGuidedChoice("A few areas", fieldKey, "Carry several repair spots."),
        buildGuidedChoice("Several sections / rooms", fieldKey, "Carry a broader repair scope."),
      ]),
    };
  }
  if (intent === "drywall_repair_shape") {
    return {
      ...base,
      question: "Are these small patches, or larger drywall sections that need replacement?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Mostly small patches", fieldKey, "Carry patch and finish work."),
        buildGuidedChoice("Larger drywall sections", fieldKey, "Carry board replacement work."),
        buildGuidedChoice("Mixed repairs", fieldKey, "Carry both patching and some replacement."),
      ]),
    };
  }
  if (intent === "drywall_finish") {
    return {
      ...base,
      question: "Does the finish need texture match, smooth finish, or ready for paint?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Texture match", fieldKey, "Carry texture blend and finish."),
        buildGuidedChoice("Smooth finish", fieldKey, "Carry smooth finish work."),
        buildGuidedChoice("Ready for paint", fieldKey, "Leave ready for painter."),
      ]),
    };
  }
  if (intent === "drywall_paint_scope") {
    return {
      ...base,
      question: "Should I include paint touch-up, or leave this as drywall repair only?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Drywall repair only", fieldKey, "Leave ready for painter."),
        buildGuidedChoice("Include paint touch-up", fieldKey, "Carry paint touch-up with repair."),
        buildGuidedChoice("Paint match to confirm", fieldKey, "Carry paint scope but confirm finish match."),
      ]),
    };
  }
  if (intent === "access_setup") {
    return {
      ...base,
      question: "Should I carry ladder access, lift access, or standard ground access?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Standard ground access", fieldKey, "Ground-level access only."),
        buildGuidedChoice("Ladder access", fieldKey, "Carry ladder setup."),
        buildGuidedChoice("Lift / scaffold access", fieldKey, "Carry lift or scaffold setup."),
      ]),
    };
  }
  if (intent === "scope_location_type") {
    return {
      ...base,
      question: "Is this interior work, exterior work, or both?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Interior", fieldKey, "Carry interior work only."),
        buildGuidedChoice("Exterior", fieldKey, "Carry exterior work only."),
        buildGuidedChoice("Both", fieldKey, "Carry interior and exterior work."),
      ]),
    };
  }
  if (intent === "materials_path") {
    return {
      fieldKey: "ui.materialsMode",
      sectionKey: "materials",
      question: "Do you want me to carry materials as an allowance, itemize them, or leave this labor only for now?",
      suggestedChoices: dedupeGuidedChoices([
        buildGuidedChoice("Carry materials allowance", "ui.materialsMode", "Use one materials allowance line.", "blanket"),
        buildGuidedChoice("Itemize materials", "ui.materialsMode", "List materials line by line.", "itemized"),
        buildGuidedChoice("Labor only for now", "ui.materialsMode", "Carry labor first and keep materials separate."),
      ]),
    };
  }
  if (intent === "trade_definition") {
    return {
      ...base,
      question: "What kind of job is this: painting, drywall repair, flooring, stucco repair, or something else?",
      suggestedChoices: dedupeGuidedChoices(contract?.suggestedChoices || [
        buildGuidedChoice("Painting", fieldKey, "Carry a painting estimate path."),
        buildGuidedChoice("Drywall repair", fieldKey, "Carry drywall repair work."),
        buildGuidedChoice("Flooring / LVP", fieldKey, "Carry flooring installation."),
      ]),
    };
  }
  if (intent === "scope_clarification") {
    return {
      ...base,
      question: "Tell me the main work I should carry for this job.",
      suggestedChoices: normalizeSuggestedChoices(contract?.suggestedChoices || []),
    };
  }
  if (contract?.expectedAnswerMode === "quantity_extent") {
    return {
      ...base,
      question: forceClarify
        ? "I still need the size of this scope so I can price it: about how much area, how many rooms, or how many repair areas?"
        : "Give me the best size read you have so I can price it: about how much area, how many rooms, or how many repair areas?",
      suggestedChoices: dedupeGuidedChoices(contract?.suggestedChoices || []),
    };
  }
  if (contract?.expectedAnswerMode === "single_select") {
    return {
      ...base,
      question: forceClarify
        ? "For this item, tell me which option fits best."
        : "For this item, which way should I carry it?",
      suggestedChoices: dedupeGuidedChoices(contract?.suggestedChoices || []),
    };
  }
  const fallbackQuestion = normalizeGuidedPromptText(
    forceClarify
      ? buildPromptForField(fieldKey, payload)
      : (contract?.promptText || buildPromptForField(fieldKey, payload) || "Tell me the part of the job I should carry for this item.")
  );
  return compactObject({
    ...base,
    question: isWeakGuidedClarificationQuestion(fallbackQuestion)
      ? buildPromptForField(fieldKey, payload)
      : fallbackQuestion,
    suggestedChoices: normalizeSuggestedChoices(contract?.suggestedChoices || []),
  });
}

function resolveGuidedActiveStepAnswer(payload, target, writes = []) {
  const answer = String(payload?.userAnswer || "").trim();
  const questionKey = String(target?.questionKey || payload?.questionKey || "").trim();
  const contract = buildGuidedStepContract(payload, questionKey, target?.sectionKey || payload?.sectionKey || "");
  if (!answer || !contract?.fieldKey) {
    return { contract, stepResolution: normalizeGuidedStepResolution(null), narrowedFollowUp: null };
  }

  const text = normalizeLooseGuidedText(answer);
  const writeKeys = new Set(asArray(writes).map((entry) => String(entry?.key || "").trim()).filter(Boolean));
  const markers = {};
  const expectedComponents = normalizeGuidedStepComponents(contract.expectedComponents);
  const suggestedChoiceMatch = fuzzyMatchOption(contract?.suggestedChoices || [], answer) || exactMatchOption(contract?.suggestedChoices || [], answer);
  const gibberishAnswer = isGuidedGibberishAnswer(answer);
  const roughQuantitySignal = guidedTextHasAny(text, [
    /\bdownstairs\b/,
    /\bliving room\b/,
    /\bkitchen\b/,
    /\bhallway\b/,
    /\bbedrooms?\b/,
    /\ba few\b/,
    /\bfew\b/,
    /\bcouple\b/,
    /\bspots?\b/,
    /\bareas?\b/,
    /\bsections?\b/,
    /\bopenings?\b/,
    /\bsuite\b/,
  ]);

  const mark = (component, predicate, extraMarkers = null) => {
    if (!predicate) return;
    if (component) markers[component] = true;
    if (extraMarkers && typeof extraMarkers === "object") {
      Object.entries(extraMarkers).forEach(([key, value]) => {
        if (value === true) markers[key] = true;
      });
    }
  };

  if (suggestedChoiceMatch && expectedComponents.length === 1) {
    mark(expectedComponents[0], true);
  }

  const positiveSurfaceSignal = guidedTextHasAny(text, [/\bwalls?\b/, /\bceilings?\b/, /\bbaseboards?\b/])
    || (/\btrim\b/.test(text) && !/\bno\s+trim\b|\bleave\s+trim\s+out\b/.test(text))
    || (/\bdoors?\b/.test(text) && !/\bno\s+doors?\b/.test(text))
    || (/\bclosets?\b/.test(text) && !/\bno\s+closets?\b/.test(text));
  mark("coverageKnown", positiveSurfaceSignal);
  mark("quantityBasisKnown",
    guidedTextHasQuantitySignal(text)
    || ((contract.promptIntent === "flooring_quantity" || contract.promptIntent === "scope_quantity")
      && guidedTextHasAny(text, [/\bstairs?\b/, /\bconnected rooms?\b/, /\bwhole level\b/, /\bfull area\b/, /\bmost of downstairs\b/, /\bmost of the interior\b/, /\blarger area\b/]))
    || (contract.promptIntent === "commercial_extent" && guidedTextHasAny(text, [/\bwarehouse\b/, /\bfull suite\b/, /\blarger area\b/, /\bmost of\b/, /\bfull warehouse\b/, /\bmost of the warehouse\b/]))
    || (contract.promptIntent === "stucco_extent" && guidedTextHasAny(text, [/\bfull front elevation\b/, /\blarger exterior area\b/, /\btouch-up only\b/]))
  );
  mark("repairCountKnown",
    /\b\d+\s*(?:spots?|areas?|patches?|sections?|openings?)\b/.test(text)
  );
  mark("patchVsReplaceKnown", guidedTextHasAny(text, [
    /\bsmall patches?\b/,
    /\bpatch and finish\b/,
    /\bmixed patches?\b/,
    /\blarger sections?\b/,
    /\bboard replacement\b/,
    /\bsection replacement\b/,
    /\breplace(?:ment)?\b/,
  ]));
  mark("textureKnown", guidedTextHasAny(text, [
    /\btexture\b/,
    /\bsmooth\b/,
    /\bready for paint\b/,
    /\bready for painter\b/,
    /\blevel 4\b/,
    /\blevel 5\b/,
    /\bstandard finish\b/,
  ]));
  mark("paintTouchupKnown", guidedTextHasAny(text, [
    /\bdrywall repair only\b/,
    /\bpaint touch(?:-?up)?\b/,
    /\bpaint match\b/,
    /\bready for painter\b/,
    /\binclude paint\b/,
  ]));
  mark("coatsKnown", guidedTextHasAny(text, [
    /\bone coat\b/,
    /\btwo coats?\b/,
    /\b1 coat\b/,
    /\b2 coats?\b/,
    /\bsingle coat\b/,
  ]));
  mark("colorKnown", guidedTextHasAny(text, [
    /\bsame color\b/,
    /\bcolor change\b/,
    /\bone color\b/,
    /\bmultiple colors?\b/,
    /\bchanging\b/,
  ]));
  mark("prepKnown", guidedTextHasAny(text, [
    /\bstandard prep\b/,
    /\bstandard\b/,
    /\bminor patch(?:ing)?\b/,
    /\bsome patch(?:ing)?\b/,
    /\bpatch(?:ing)?\b/,
    /\bheavy prep\b/,
    /\brepair(?:s|ing)?\b/,
    /\bprep\b/,
  ]));
  mark("finishKnown", guidedTextHasAny(text, [
    /\bflat\b/,
    /\beggshell\b/,
    /\bsatin\b/,
    /\bsemi[\s-]?gloss\b/,
    /\bgloss\b/,
    /\bfinish\b/,
    /\bstandard finish\b/,
    /\bstandard\b/,
  ]));
  mark("occupancyKnown", guidedTextHasAny(text, [
    /\boccupied\b/,
    /\bvacant\b/,
    /\bfurnished\b/,
    /\bempty\b/,
    /\bafter hours\b/,
    /\bafter-hours\b/,
    /\bopen access\b/,
    /\boperations?\b/,
  ]), {
    scheduleKnown: /\bafter hours\b|\bafter-hours\b/.test(text),
  });
  mark("accessSetupKnown", guidedTextHasAny(text, [/\bladder\b/, /\blift\b/, /\bscaffold\b/, /\bboom\b/]));
  mark("demoKnown", guidedTextHasAny(text, [/\bdemo\b/, /\bremoval\b/, /\btear\s*out\b/, /\bexisting floor stays\b/, /\binstall over\b/, /\bstays\b/]));
  mark("transitionsKnown", guidedTextHasAny(text, [/\btransitions?\b/, /\bthresholds?\b/, /\bstairs?\b/, /\bbase removal\b/, /\bno stairs\b/, /\bno major transitions?\b/]));
  mark("interiorExteriorKnown", guidedTextHasAny(text, [/\binterior\b/, /\binside\b/, /\bexterior\b/, /\boutside\b/, /\bboth\b/]));
  mark("tradeRecognized", !!detectTradeInsert(answer), detectTradeInsert(answer)?.value ? { tradeKey: detectTradeInsert(answer)?.value } : null);
  const parsedMaterialsMode = parseGuidedMaterialsModeIntent(answer);
  mark("materialsPathKnown", writeKeys.has("ui.materialsMode") || !!parsedMaterialsMode);
  mark("materialsAllowanceIntent", guidedTextHasAllowanceSignal(text) || !!parsedMaterialsMode);

  const answeredComponents = expectedComponents.filter((component) => {
    if (component === "tradeRecognized") return markers.tradeRecognized === true || writeKeys.has("tradeInsert.key");
    if (component === "materialsPathKnown") return markers.materialsPathKnown === true || writeKeys.has("ui.materialsMode");
    return markers[component] === true;
  });
  const missingComponents = expectedComponents.filter((component) => !answeredComponents.includes(component));

  const anyStructuredSignal = Object.keys(markers).length > 0 || writeKeys.size > 0 || roughQuantitySignal || !!suggestedChoiceMatch;
  let status = "unresolved";
  let invalidReason = "";
  if (expectedComponents.length && answeredComponents.length >= expectedComponents.length) {
    status = "fully_resolved";
  } else if (answeredComponents.length > 0) {
    status = "partially_resolved";
  } else if (gibberishAnswer && contract.repeatedUnresolvedCount > 0) {
    status = "needs_interpretive_retry";
    invalidReason = "The answer did not give usable estimating detail for this item.";
  } else if (gibberishAnswer) {
    status = "invalid_for_prompt";
    invalidReason = "The answer did not give usable estimating detail for this item.";
  } else if (anyStructuredSignal) {
    status = "unresolved_clarified";
  } else if (contract.repeatedUnresolvedCount > 0) {
    status = "needs_interpretive_retry";
    invalidReason = "The answer still did not resolve the active estimating question.";
  } else {
    status = "invalid_for_prompt";
    invalidReason = "The answer did not clearly resolve the active estimating question.";
  }

  const narrowedFollowUp = (status === "partially_resolved" || status === "unresolved_clarified" || status === "invalid_for_prompt")
    ? buildGuidedNarrowFollowUp(
      contract,
      missingComponents.length ? missingComponents : contract.expectedComponents,
      payload,
      { forceClarify: status === "invalid_for_prompt" }
    )
    : (status === "needs_interpretive_retry"
      ? buildGuidedNarrowFollowUp(
        contract,
        missingComponents.length ? missingComponents : contract.expectedComponents,
        payload,
        { forceClarify: true }
      )
      : null);

  return {
    contract,
    stepResolution: normalizeGuidedStepResolution({
      status,
      answeredComponents,
      missingComponents,
      markers,
      invalidReason,
    }),
    narrowedFollowUp,
  };
}

function looksLikeGuidedNegativeAnswer(answer) {
  const text = normalizeLooseGuidedText(answer);
  if (!text) return false;
  if (countGuidedWords(text) > 10 && !/^no\b/.test(text) && !/\bnot applicable\b/.test(text)) return false;
  if (/\bnot applicable\b/.test(text) || /\bnothing special\b/.test(text)) return true;
  return guidedTextHasAny(text, [
    /^(?:no|none|nope|nah|n a|n a\b|not applicable|nothing|nothing special|nothing else|no issues?|no problem(?:s)?|no concerns?)$/,
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
  const mentionsAccess = /\baccess\b|\bschedule\b|\bissues?\b|\blimits?\b|\bconstraints?\b/.test(normalizedAnswer);
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
  return asArray(entries)
    .map((entry) => trimText(entry?.answer, 120))
    .filter(Boolean)
    .join(" ");
}

function summarizeGuidedWriteValues(writes) {
  return asArray(writes)
    .map((entry) => {
      if (typeof entry?.value === "string") return trimText(entry.value, 120);
      if (entry?.key === "tradeInsert.key") return trimText(entry?.value, 48);
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

function deriveGuidedTradeKey(interpretedIntent, writes) {
  const intentTradeKey = String(interpretedIntent?.tradeKey || "").trim();
  if (intentTradeKey) return intentTradeKey;
  const tradeWrite = asArray(writes).find((entry) => String(entry?.key || "").trim() === "tradeInsert.key");
  return String(tradeWrite?.value || "").trim();
}

function deriveGuidedContext(response, requestMeta, interpretedIntent, proposedFieldWrites, nextBestQuestion) {
  const plannerState = normalizePlannerState(requestMeta?.plannerState);
  const stepResolution = normalizeGuidedStepResolution(response?.stepResolution);
  const stepMarkers = normalizePlannerState(stepResolution?.markers);
  const activeStep = requestMeta?.activeStep && typeof requestMeta.activeStep === "object" ? requestMeta.activeStep : {};
  const activePromptIntent = String(activeStep?.promptIntent || "").trim();
  const activePromptText = String(activeStep?.promptText || requestMeta?.currentPrompt || "").trim();
  const historyText = summarizeGuidedHistory(requestMeta?.priorGuidedAnswers);
  const writeText = summarizeGuidedWriteValues(proposedFieldWrites);
  const questionKey = String(requestMeta?.questionKey || "").trim();
  const sectionKey = String(requestMeta?.sectionKey || "").trim();
  const nextFieldKey = String(nextBestQuestion?.fieldKey || response?.recommendedNextQuestion || questionKey || "").trim();
  const tradeKey = deriveGuidedTradeKey(interpretedIntent, proposedFieldWrites) || plannerState.tradeKey;
  const intentKind = String(interpretedIntent?.kind || "").trim().toLowerCase();
  const currentNegativeResolution = resolveGuidedNegativeAnswer({
    sectionKey,
    questionKey,
    promptText: requestMeta?.currentPrompt,
    answer: requestMeta?.userAnswer,
  });
  const resolvedMarkers = asArray(requestMeta?.priorGuidedAnswers).reduce((acc, entry) => {
    const resolution = resolveGuidedNegativeAnswer({
      sectionKey: entry?.sectionKey,
      questionKey: entry?.questionKey,
      promptText: entry?.prompt,
      answer: entry?.answer,
    });
    return mergeGuidedResolutionMarkers(acc, resolution?.markers);
  }, mergeGuidedResolutionMarkers({}, currentNegativeResolution?.markers));
  const text = normalizeLooseGuidedText([
    requestMeta?.userAnswer,
    historyText,
    interpretedIntent?.summary,
    intentKind,
    tradeKey,
    activePromptText,
    activePromptIntent,
    writeText,
  ].filter(Boolean).join(" "));
  const painting = plannerState.painting
    || stepMarkers.painting
    || activePromptIntent.startsWith("painting_")
    || tradeKey === "painting"
    || guidedTextHasAny(text, [/\bpaint(?:ing|ed)?\b/, /\brepaint\b/, /\btrim\b/, /\bceilings?\b/, /\bbaseboards?\b/, /\bstucco\b/]);
  const flooring = plannerState.flooring
    || stepMarkers.flooring
    || activePromptIntent.startsWith("flooring_")
    || tradeKey === "flooring"
    || guidedTextHasFlooringSignal(text);
  const drywallRepair = plannerState.drywallRepair
    || stepMarkers.drywallRepair
    || activePromptIntent.startsWith("drywall_")
    || tradeKey === "drywall"
    || guidedTextHasDrywallSignal(text);
  const commercialContext = plannerState.commercialContext
    || stepMarkers.commercialContext
    || activePromptIntent === "commercial_access"
    || guidedTextHasCommercialSignal(text);
  const commercialEnvironment = getGuidedCommercialEnvironment(text);
  const warehouseContext = commercialEnvironment === "warehouse";
  const officeSuiteContext = commercialEnvironment === "office_suite";
  const exteriorAccess = plannerState.exteriorAccess || stepMarkers.exteriorAccess || guidedTextHasExteriorAccessSignal(text);
  const stuccoRepair = plannerState.stuccoRepair || stepMarkers.stuccoRepair || (/\bstucco\b/.test(text) && /\bcracks?\b|\brepair(?:s|ing)?\b|\bpaint(?:ing|ed)?\b/.test(text));
  const roomWork = guidedTextHasAny(text, [/\bbedrooms?\b/, /\brooms?\b/, /\bhouse\b/, /\bhome\b/]);
  const coverageKnown = plannerState.coverageKnown || stepMarkers.coverageKnown || guidedTextHasAny(text, [
    /\bwalls?\s+only\b/,
    /\bwalls?\b/,
    /\bceilings?\b/,
    /\btrim\b/,
    /\bdoors?\b/,
    /\bclosets?\b/,
    /\bbaseboards?\b/,
    /\bcabinets?\b/,
    /\bsiding\b/,
    /\bfence\b/,
    /\bstucco\b/,
    /\bfloor(?:ing|s)?\b/,
  ]);
  const occupancyKnown = plannerState.occupancyKnown || stepMarkers.occupancyKnown || guidedTextHasAny(text, [/\boccupied\b/, /\bvacant\b/, /\bfurnished\b/, /\bempty\b/, /\btenant(?:ed)?\b/]);
  const prepKnown = plannerState.prepKnown || stepMarkers.prepKnown || guidedTextHasAny(text, [/\bprep\b/, /\bpatch(?:ing)?\b/, /\brepair(?:s|ing)?\b/, /\bsand(?:ing)?\b/, /\bcaulk(?:ing)?\b/, /\bprime(?:r|ing)?\b/]);
  const colorKnown = plannerState.colorKnown || stepMarkers.colorKnown || guidedTextHasAny(text, [/\bsame color\b/, /\bcolor change\b/, /\baccent\b/, /\bone color\b/, /\bmultiple colors?\b/]);
  const coatsKnown = plannerState.coatsKnown || stepMarkers.coatsKnown || guidedTextHasAny(text, [/\bone coat\b/, /\btwo coats?\b/, /\b1 coat\b/, /\b2 coats?\b/, /\bsingle coat\b/]);
  const finishKnown = plannerState.finishKnown || stepMarkers.finishKnown || guidedTextHasAny(text, [/\bfinish(?:es)?\b/, /\bflat\b/, /\beggshell\b/, /\bsatin\b/, /\bsemi[\s-]?gloss\b/, /\bgloss\b/, /\bsheen\b/]);
  const interiorExteriorKnown = plannerState.interiorExteriorKnown || stepMarkers.interiorExteriorKnown || roomWork || guidedTextHasAny(text, [/\binterior\b/, /\bexterior\b/, /\binside\b/, /\boutside\b/]);
  const furnitureKnown = plannerState.furnitureKnown || stepMarkers.furnitureKnown || guidedTextHasAny(text, [/\bfurniture\b/, /\bmove(?:d|ing)?\b/, /\bclear(?:ed|ing)?\b/]);
  const scheduleKnown = plannerState.scheduleKnown || stepMarkers.scheduleKnown || guidedTextHasAny(text, [/\bschedule\b/, /\bafter hours\b/, /\bweekend\b/, /\bweekday\b/, /\baccess\b/, /\boccupied\b/, /\bvacant\b/]);
  const suppliedMaterialsKnown = plannerState.suppliedMaterialsKnown || stepMarkers.suppliedMaterialsKnown || guidedTextHasAny(text, [/\bcustomer[-\s]?supplied\b/, /\bowner[-\s]?supplied\b/, /\bmaterials?\s+provided\b/, /\bpaint\s+provided\b/]);
  const exclusionsKnown = plannerState.exclusionsKnown || stepMarkers.exclusionsKnown || guidedTextHasAny(text, [/\bexclude(?:d|s|ing)?\b/, /\bexclusions?\b/, /\bnot included\b/, /\bassumptions?\b/]);
  const quantityBasisKnown = plannerState.quantityBasisKnown
    || stepMarkers.quantityBasisKnown
    || guidedTextHasQuantitySignal(text);
  const accessSetupKnown = plannerState.accessSetupKnown || stepMarkers.accessSetupKnown || guidedTextHasAny(text, [
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
  const demoKnown = plannerState.demoKnown || stepMarkers.demoKnown || guidedTextHasAny(text, [
    /\bdemo\b/,
    /\bdemolition\b/,
    /\bremove\b/,
    /\bremoval\b/,
    /\btear\s*out\b/,
    /\binstall over\b/,
    /\bexisting flooring staying\b/,
  ]);
  const transitionsKnown = plannerState.transitionsKnown || stepMarkers.transitionsKnown || guidedTextHasAny(text, [
    /\btransitions?\b/,
    /\bthresholds?\b/,
    /\bstairs?\b/,
    /\bbase(?:board)?s?\b/,
    /\bshoe\b/,
  ]);
  const repairCountKnown = plannerState.repairCountKnown
    || stepMarkers.repairCountKnown
    || guidedTextHasAny(text, [/\ba few\b/, /\bfew\b/, /\bcouple\b/, /\bspots?\b/, /\bpatches?\b/, /\bareas?\b/, /\bsections?\b/, /\bopenings?\b/])
    || guidedTextHasQuantitySignal(text);
  const patchVsReplaceKnown = plannerState.patchVsReplaceKnown || stepMarkers.patchVsReplaceKnown || guidedTextHasAny(text, [
    /\bsmall patches?\b/,
    /\bpatch and finish\b/,
    /\blarger sections?\b/,
    /\bboard replacement\b/,
    /\bsection replacement\b/,
    /\breplace(?:ment)?\b/,
    /\bcut out and replace\b/,
  ]);
  const textureKnown = plannerState.textureKnown || stepMarkers.textureKnown || guidedTextHasAny(text, [
    /\btexture\b/,
    /\bsmooth\b/,
    /\blevel 4\b/,
    /\blevel 5\b/,
    /\bready for paint\b/,
  ]);
  const paintTouchupKnown = plannerState.paintTouchupKnown || stepMarkers.paintTouchupKnown || guidedTextHasAny(text, [
    /\bpaint touch(?:-?up)?\b/,
    /\bpaint match\b/,
    /\bdrywall repair only\b/,
    /\bready for paint\b/,
  ]);
  const materialsAllowanceIntent = plannerState.materialsAllowanceIntent || stepMarkers.materialsAllowanceIntent || guidedTextHasAllowanceSignal(text);
  const materialsPathKnown = plannerState.materialsPathKnown || stepMarkers.materialsPathKnown || guidedTextHasAny(text, [
    /\bitemized\b/,
    /\bblanket\b/,
    /\bmaterials mode\b/,
  ]);
  const notesFieldActive = nextFieldKey === "additionalNotes" || questionKey === "additionalNotes";
  const scopeFieldActive = nextFieldKey === "scopeNotes" || questionKey === "scopeNotes" || questionKey === "tradeInsert.key";
  const tradeRecognized = !!tradeKey || plannerState.tradeRecognized === true;
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
    rawAnswer: String(requestMeta?.userAnswer || "").trim(),
    analysisText: text,
    questionKey,
    sectionKey,
    nextFieldKey,
    tradeKey,
    intentKind,
    painting,
    flooring,
    drywallRepair,
    commercialContext,
    commercialEnvironment,
    warehouseContext,
    officeSuiteContext,
    exteriorAccess,
    stuccoRepair,
    roomWork,
    coverageKnown,
    quantityBasisKnown,
    occupancyKnown,
    prepKnown: prepKnown || resolvedMarkers.prepKnown,
    colorKnown,
    coatsKnown,
    finishKnown,
    interiorExteriorKnown,
    accessSetupKnown,
    demoKnown,
    transitionsKnown,
    repairCountKnown,
    patchVsReplaceKnown,
    textureKnown,
    paintTouchupKnown,
    materialsAllowanceIntent,
    materialsPathKnown,
    furnitureKnown: furnitureKnown || resolvedMarkers.furnitureKnown,
    scheduleKnown: scheduleKnown || resolvedMarkers.scheduleKnown,
    suppliedMaterialsKnown: suppliedMaterialsKnown || resolvedMarkers.suppliedMaterialsKnown,
    exclusionsKnown: exclusionsKnown || resolvedMarkers.exclusionsKnown,
    notesFieldActive,
    scopeFieldActive,
    tradeRecognized,
    notesResolved: resolvedMarkers.notesResolved || plannerState.notesResolved === true,
    currentNegativeResolution,
    scopeDriverCount,
    scopeReadyForNotes: plannerState.scopeReadyForNotes === true
      || (tradeRecognized && scopeDriverCount >= scopePromotionThreshold && (materialsPathKnown || accessSetupKnown || occupancyKnown || scheduleKnown || finishKnown || textureKnown)),
  };
}

function buildMaterialsPathPlan(context) {
  return {
    context,
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

function buildPaintingScopePlan(context) {
  const missing = [];

  if (context.stuccoRepair && !context.quantityBasisKnown) {
    missing.push({
      label: "stucco repair extent",
      question: "Am I carrying isolated crack repairs with touch-up paint, or a larger stucco repair and repaint area?",
      choices: [
        buildGuidedChoice("Spot crack repairs only", "scopeNotes", "Carry localized crack repair with paint touch-up."),
        buildGuidedChoice("Front elevation repair + paint", "scopeNotes", "Carry broader stucco repair and repaint at the front."),
        buildGuidedChoice("Larger exterior repair area", "scopeNotes", "Carry a wider repair and repaint scope."),
      ],
    });
  }

  if (!context.coverageKnown) {
    missing.push({
      label: "surfaces included",
      question: "For this scope, am I carrying walls only, walls + ceilings, or walls + ceilings + trim, doors, and closets?",
      choices: [
        buildGuidedChoice("Walls only", "scopeNotes", "Carry wall surfaces only."),
        buildGuidedChoice("Walls + ceilings", "scopeNotes", "Carry walls and ceilings."),
        buildGuidedChoice("Walls + ceilings + trim", "scopeNotes", "Carry walls, ceilings, trim, doors, and closets."),
      ],
    });
  }

  if (!context.quantityBasisKnown && (context.roomWork || context.commercialContext || context.stuccoRepair)) {
    missing.push({
      label: "size or quantity basis",
      question: context.commercialContext
        ? buildCommercialExtentQuestion(context.commercialEnvironment)
        : (context.stuccoRepair
          ? "Is this just the front area, or a larger portion of the exterior?"
          : "About how much area or how many rooms should I carry?"),
      choices: dedupeGuidedChoices([
        ...(context.commercialContext ? buildCommercialExtentChoices(context.commercialEnvironment) : []),
        context.stuccoRepair && buildGuidedChoice("Front area only", "scopeNotes", "Carry the front only."),
        context.stuccoRepair && buildGuidedChoice("Larger exterior area", "scopeNotes", "Carry more than one exterior area."),
        !context.commercialContext && !context.stuccoRepair && buildGuidedChoice("A few rooms", "scopeNotes", "Carry a limited room count."),
        !context.commercialContext && !context.stuccoRepair && buildGuidedChoice("Most of the interior", "scopeNotes", "Carry a larger interior area."),
      ].filter(Boolean)),
    });
  }

  if (context.commercialContext && !context.occupancyKnown) {
    missing.push({
      label: "commercial access timing",
      question: buildCommercialAccessQuestion(context.commercialEnvironment),
      choices: buildCommercialAccessChoices(context.commercialEnvironment),
    });
  }

  if (!context.interiorExteriorKnown) {
    missing.push({
      label: "interior or exterior",
      question: "Is this inside work, outside work, or both?",
      choices: [
        buildGuidedChoice("Interior", "scopeNotes", "Carry interior surfaces only."),
        buildGuidedChoice("Exterior", "scopeNotes", "Carry exterior surfaces only."),
        buildGuidedChoice("Interior + exterior", "scopeNotes", "Carry both interior and exterior work."),
      ],
    });
  }

  if (!context.coatsKnown || !context.colorKnown) {
    missing.push({
      label: "coat count and color change",
      question: "Should I price one coat or two, and is it staying the same color or changing?",
      choices: [
        buildGuidedChoice("Same color, one coat", "scopeNotes", "Light production impact."),
        buildGuidedChoice("Same color, two coats", "scopeNotes", "Carry two coats at the same color."),
        buildGuidedChoice("Color change, two coats", "scopeNotes", "Carry full color-change coverage."),
      ],
    });
  }

  if (!context.occupancyKnown) {
    missing.push({
      label: "occupancy status",
      question: "Will the work be done in an occupied space, a furnished space, or a vacant one?",
      choices: [
        buildGuidedChoice("Occupied", "scopeNotes", "Carry protection and daily cleanup."),
        buildGuidedChoice("Vacant", "scopeNotes", "Vacant or empty space."),
        buildGuidedChoice("Occupied with furniture", "scopeNotes", "Carry furniture moving and protection."),
      ],
    });
  }

  if (!context.prepKnown) {
    missing.push({
      label: "prep or patching",
      question: "Do you want standard prep only, minor patching, or heavier repairs in the price?",
      choices: [
        buildGuidedChoice("Standard prep only", "scopeNotes", "No repair scope beyond normal prep."),
        buildGuidedChoice("Minor patching included", "scopeNotes", "Carry light patching and prep."),
        buildGuidedChoice("Heavy prep / repairs included", "scopeNotes", "Carry significant prep and repair time."),
      ],
    });
  }

  if (context.exteriorAccess && !context.accessSetupKnown) {
    missing.push({
      label: "access setup",
      question: "Should I carry straightforward ladder access, or do I need to allow for lift or scaffold setup?",
      choices: [
        buildGuidedChoice("Ladder access only", "scopeNotes", "Carry straightforward ladder setup."),
        buildGuidedChoice("Lift access", "scopeNotes", "Carry lift or boom access."),
        buildGuidedChoice("Scaffold setup", "scopeNotes", "Carry scaffold setup."),
      ],
    });
  }

  if (!context.finishKnown) {
    missing.push({
      label: "finish level",
      question: "What finish should I assume for the walls and trim?",
      choices: [
        buildGuidedChoice("Flat walls", "scopeNotes", "Standard flat wall finish."),
        buildGuidedChoice("Eggshell walls", "scopeNotes", "Carry eggshell on the walls."),
        buildGuidedChoice("Satin / semi-gloss trim", "scopeNotes", "Carry a typical trim finish."),
      ],
    });
  }

  if (context.materialsAllowanceIntent && !context.materialsPathKnown && context.tradeRecognized) {
    return buildMaterialsPathPlan(context);
  }

  if (!missing.length) return null;
  const next = missing[0];
  return {
    context,
    missingContext: missing.map((item) => item.label),
    nextBestQuestion: {
      fieldKey: "scopeNotes",
      sectionKey: "scope",
      question: next.question,
    },
    suggestedChoices: dedupeGuidedChoices(next.choices),
  };
}

function buildFlooringScopePlan(context) {
  if (context.materialsAllowanceIntent && !context.materialsPathKnown && context.tradeRecognized) {
    return buildMaterialsPathPlan(context);
  }

  const missing = [];

  if (!context.quantityBasisKnown) {
    missing.push({
      label: "floor area basis",
      question: "About how much floor area are we covering?",
      choices: [
        buildGuidedChoice("A few connected rooms", "scopeNotes", "Carry connected living areas."),
        buildGuidedChoice("Most of downstairs", "scopeNotes", "Carry a larger downstairs footprint."),
        buildGuidedChoice("Whole level / full area", "scopeNotes", "Carry the full level or broad area."),
      ],
    });
  }

  if (!context.demoKnown) {
    missing.push({
      label: "demo or removal",
      question: "Is existing flooring staying, or do I need to include demo and removal?",
      choices: [
        buildGuidedChoice("Existing floor stays", "scopeNotes", "Install over a ready surface."),
        buildGuidedChoice("Include demo / removal", "scopeNotes", "Carry tear-out and disposal."),
        buildGuidedChoice("Minor floor prep only", "scopeNotes", "Carry light prep without full demo."),
      ],
    });
  }

  if (!context.transitionsKnown) {
    missing.push({
      label: "stairs or transitions",
      question: "Any stairs, base removal, or tricky transitions to account for?",
      choices: [
        buildGuidedChoice("No stairs or major transitions", "scopeNotes", "Straight run with standard transitions."),
        buildGuidedChoice("Base removal included", "scopeNotes", "Carry base removal and reset."),
        buildGuidedChoice("Stairs / transitions included", "scopeNotes", "Carry extra transition or stair work."),
      ],
    });
  }

  if (!context.materialsPathKnown) {
    missing.push({
      label: "materials path",
      question: "Do you want me to carry materials, or labor only for now?",
      choices: [
        buildGuidedChoice("Carry materials allowance", "ui.materialsMode", "Use one materials allowance line.", "blanket"),
        buildGuidedChoice("Itemize materials", "ui.materialsMode", "List materials line by line.", "itemized"),
        buildGuidedChoice("Labor only for now", "ui.materialsMode", "Carry labor first and hold materials."),
      ],
    });
  }

  if (!context.prepKnown) {
    missing.push({
      label: "subfloor or prep",
      question: "Any subfloor prep, patching, or moisture issues I should carry?",
      choices: [
        buildGuidedChoice("Standard prep only", "scopeNotes", "No unusual floor prep."),
        buildGuidedChoice("Minor floor prep", "scopeNotes", "Carry light patching or leveling."),
        buildGuidedChoice("Moisture / leveling concerns", "scopeNotes", "Carry heavier prep or moisture mitigation."),
      ],
    });
  }

  if (!missing.length) return null;
  const next = missing[0];
  return {
    context,
    missingContext: missing.map((item) => item.label),
    nextBestQuestion: {
      fieldKey: String(next?.choices?.[0]?.fieldKey || "scopeNotes").trim() || "scopeNotes",
      sectionKey: String(next?.choices?.[0]?.fieldKey || "").trim() === "ui.materialsMode" ? "materials" : "scope",
      question: next.question,
    },
    suggestedChoices: dedupeGuidedChoices(next.choices),
  };
}

function buildDrywallRepairPlan(context) {
  const missing = [];

  if (!context.repairCountKnown) {
    missing.push({
      label: "repair area count",
      question: "How many repair areas are we dealing with?",
      choices: [
        buildGuidedChoice("One or two areas", "scopeNotes", "Carry a small repair count."),
        buildGuidedChoice("A few areas", "scopeNotes", "Carry several repair spots."),
        buildGuidedChoice("Several sections / rooms", "scopeNotes", "Carry a broader repair scope."),
      ],
    });
  }

  if (!context.patchVsReplaceKnown) {
    missing.push({
      label: "patch or replacement",
      question: "Are these small patches, or larger drywall sections that need replacement?",
      choices: [
        buildGuidedChoice("Small patches only", "scopeNotes", "Carry patch-and-finish work."),
        buildGuidedChoice("Mixed patches + some replacement", "scopeNotes", "Carry patching with a little board replacement."),
        buildGuidedChoice("Larger section replacement", "scopeNotes", "Carry broader drywall replacement."),
      ],
    });
  }

  if (!context.textureKnown) {
    missing.push({
      label: "finish level",
      question: "Does the finish need texture match, smooth finish, or just ready for paint?",
      choices: [
        buildGuidedChoice("Texture match", "scopeNotes", "Carry texture match after repair."),
        buildGuidedChoice("Smooth finish", "scopeNotes", "Carry a smooth repair finish."),
        buildGuidedChoice("Ready for paint", "scopeNotes", "Finish ready for paint without texture match."),
      ],
    });
  }

  if (!context.paintTouchupKnown) {
    missing.push({
      label: "paint scope",
      question: "Should I include paint touch-up, or leave this as drywall repair only?",
      choices: [
        buildGuidedChoice("Drywall repair only", "scopeNotes", "Leave paint out of the scope."),
        buildGuidedChoice("Include paint touch-up", "scopeNotes", "Carry paint touch-up with the repairs."),
        buildGuidedChoice("Ready for painter", "scopeNotes", "Finish for paint but do not include coating."),
      ],
    });
  }

  if (!missing.length) return null;
  const next = missing[0];
  return {
    context,
    missingContext: missing.map((item) => item.label),
    nextBestQuestion: {
      fieldKey: "scopeNotes",
      sectionKey: "scope",
      question: next.question,
    },
    suggestedChoices: dedupeGuidedChoices(next.choices),
  };
}

function buildPaintingNotesPlan(context) {
  const choices = dedupeGuidedChoices([
    !context.furnitureKnown && buildGuidedChoice("Owner moves furniture", "additionalNotes", "Owner clears and moves furniture before work."),
    !context.suppliedMaterialsKnown && buildGuidedChoice("Customer supplies paint", "additionalNotes", "Customer provides finish materials."),
    !context.scheduleKnown && buildGuidedChoice("Limited occupied access", "additionalNotes", "Carry an occupied-home access or schedule constraint."),
    !context.exclusionsKnown && buildGuidedChoice("Exclude wall repairs", "additionalNotes", "Exclude repair work beyond minor patching."),
  ].filter(Boolean));

  return {
    context,
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
    suggestedChoices: choices.length
      ? choices
      : dedupeGuidedChoices([
        buildGuidedChoice("Owner moves furniture", "additionalNotes", "Owner clears rooms before work."),
        buildGuidedChoice("Customer supplies paint", "additionalNotes", "Customer provides finish materials."),
        buildGuidedChoice("No special exclusions", "additionalNotes", "No added assumptions beyond standard prep."),
      ]),
  };
}

function buildGenericNotesPlan(context) {
  return {
    context,
    missingContext: [
      "exclusions or assumptions",
      "access or schedule constraints",
      "customer-supplied responsibilities",
    ],
    nextBestQuestion: {
      fieldKey: "additionalNotes",
      sectionKey: "notes",
      question: "Any assumptions or exclusions I should carry, like access limits, customer-supplied materials, or work not included?",
    },
    suggestedChoices: dedupeGuidedChoices([
      buildGuidedChoice("Limited access / schedule window", "additionalNotes", "Carry access or scheduling limits."),
      buildGuidedChoice("Customer-supplied materials", "additionalNotes", "Customer provides some materials."),
      buildGuidedChoice("Exclude unforeseen repairs", "additionalNotes", "Clarify what is outside the price."),
    ]),
  };
}

function buildProactiveGuidedPlan(response, requestMeta, interpretedIntent, proposedFieldWrites, nextBestQuestion) {
  const context = deriveGuidedContext(response, requestMeta, interpretedIntent, proposedFieldWrites, nextBestQuestion);
  if (context.notesFieldActive) {
    if (context.currentNegativeResolution?.resolved || context.notesResolved) return null;
    return context.painting ? buildPaintingNotesPlan(context) : buildGenericNotesPlan(context);
  }
  if (context.flooring && (context.scopeFieldActive || context.tradeRecognized || isScopeIntentKind(context.intentKind))) {
    return buildFlooringScopePlan(context);
  }
  if (context.drywallRepair && (context.scopeFieldActive || context.tradeRecognized || isScopeIntentKind(context.intentKind))) {
    return buildDrywallRepairPlan(context);
  }
  if (context.painting && (context.scopeFieldActive || context.tradeRecognized || isScopeIntentKind(context.intentKind))) {
    return buildPaintingScopePlan(context);
  }
  if (context.materialsAllowanceIntent && !context.materialsPathKnown && context.tradeRecognized) {
    return buildMaterialsPathPlan(context);
  }
  return null;
}

function isWeakGuidedQuestion(question, context, fieldKey) {
  const text = normalizeLooseGuidedText(question);
  if (!text) return true;
  if (guidedTextHasAny(text, [
    /\blet s keep moving\b/,
    /\bwhat should i fill in next\b/,
    /\bwhich trade best matches\b/,
    /\bdescribe the work being priced\b/,
    /\bwhat should i fill in for\b/,
    /\bcurrent step\b/,
    /\bcoverage\b/,
    /\bmissing field\b/,
    /\bestimating driver\b/,
  ])) return true;
  if (context?.painting && fieldKey === "scopeNotes") {
    return !guidedTextHasAny(text, [
      /\bwalls?\b/,
      /\bceilings?\b/,
      /\btrim\b/,
      /\bcoat(?:s)?\b/,
      /\bcolor\b/,
      /\boccupied\b/,
      /\bvacant\b/,
      /\bprep\b/,
      /\bpatch(?:ing)?\b/,
      /\bfinish\b/,
      /\bsurfaces?\b/,
    ]);
  }
  if (context?.flooring && fieldKey === "scopeNotes") {
    return !guidedTextHasAny(text, [
      /\bfloor\b/,
      /\barea\b/,
      /\bsquare feet\b/,
      /\bdemo\b/,
      /\bremoval\b/,
      /\btransitions?\b/,
      /\bstairs?\b/,
      /\bmaterials\b/,
    ]);
  }
  if (context?.drywallRepair && fieldKey === "scopeNotes") {
    return !guidedTextHasAny(text, [
      /\brepair areas?\b/,
      /\bpatch(?:es|ing)?\b/,
      /\breplacement\b/,
      /\btexture\b/,
      /\bready for paint\b/,
      /\bpaint touch(?:-?up)?\b/,
    ]);
  }
  if (fieldKey === "additionalNotes") {
    return !guidedTextHasAny(text, [
      /\bexclude(?:d|s|ing)?\b/,
      /\bassumption(?:s)?\b/,
      /\bfurniture\b/,
      /\baccess\b/,
      /\bschedule\b/,
      /\bcustomer\b/,
      /\bsupplied\b/,
    ]);
  }
  return false;
}

function isWeakGuidedChoiceSet(choices, context, fieldKey) {
  const normalized = normalizeSuggestedChoices(choices);
  if (!normalized.length) return true;
  const text = normalizeLooseGuidedText(
    normalized.map((choice) => `${choice.label} ${choice.description}`).join(" ")
  );
  if (context?.painting && fieldKey === "scopeNotes") {
    return !guidedTextHasAny(text, [
      /\bwalls?\b/,
      /\bceilings?\b/,
      /\btrim\b/,
      /\boccupied\b/,
      /\bvacant\b/,
      /\bpatch(?:ing)?\b/,
      /\bprep\b/,
      /\bcoat(?:s)?\b/,
      /\bcolor\b/,
      /\bfinish(?:es)?\b/,
    ]);
  }
  if (context?.flooring && fieldKey === "scopeNotes") {
    return !guidedTextHasAny(text, [
      /\bfloor\b/,
      /\bdemo\b/,
      /\bremoval\b/,
      /\btransitions?\b/,
      /\bstairs?\b/,
      /\bmaterials\b/,
      /\ballowance\b/,
    ]);
  }
  if (context?.drywallRepair && fieldKey === "scopeNotes") {
    return !guidedTextHasAny(text, [
      /\bpatch(?:es|ing)?\b/,
      /\breplacement\b/,
      /\btexture\b/,
      /\bready for paint\b/,
      /\bpaint touch(?:-?up)?\b/,
    ]);
  }
  if (fieldKey === "additionalNotes") {
    return !guidedTextHasAny(text, [
      /\bexclude(?:d|s|ing)?\b/,
      /\bassumption(?:s)?\b/,
      /\bfurniture\b/,
      /\baccess\b/,
      /\bschedule\b/,
      /\bcustomer\b/,
      /\bsupplied\b/,
    ]);
  }
  return false;
}

function classifyGuidedPromptFamily(promptIntent = "", fieldKey = "", promptText = "") {
  return getCanonicalGuidedBlockerFamily(fieldKey, promptIntent, promptText);
}

function classifyGuidedChoiceFamily(choices = []) {
  const normalized = normalizeSuggestedChoices(choices);
  const fieldFamilies = Array.from(new Set(
    normalized
      .map((choice) => classifyGuidedPromptFamily("", choice?.fieldKey, `${choice?.label || ""} ${choice?.description || ""}`))
      .filter(Boolean)
  ));
  if (fieldFamilies.length > 1) return "mixed";
  if (fieldFamilies.length === 1) return fieldFamilies[0];
  return classifyGuidedTextFamily(
    normalized.map((choice) => `${choice.label} ${choice.description}`).join(" ")
  );
}

function getCanonicalSectionForField(fieldKey = "", fallbackSection = "") {
  const key = String(fieldKey || "").trim();
  if (!key) return String(fallbackSection || "").trim();
  const field = getGuidedField(key);
  const canonical = String(field?.section || "").trim();
  return canonical || String(fallbackSection || "").trim();
}

function buildGuidedRuntimeContract(response = {}, requestMeta = {}) {
  const stepRunnerState = response?.stepRunnerState && typeof response.stepRunnerState === "object"
    ? response.stepRunnerState
    : {};
  const nextBestQuestion = response?.nextBestQuestion && typeof response.nextBestQuestion === "object"
    ? response.nextBestQuestion
    : {};
  const surfacedFieldCandidates = Array.from(new Set([
    String(stepRunnerState?.activeFieldKey || "").trim(),
    String(nextBestQuestion?.fieldKey || "").trim(),
    String(response?.recommendedNextQuestion || "").trim(),
  ].filter(Boolean)));
  const fieldCandidates = surfacedFieldCandidates.length
    ? surfacedFieldCandidates
    : Array.from(new Set([String(requestMeta?.questionKey || "").trim()].filter(Boolean)));
  const fieldKey = fieldCandidates[0] || "";
  const canonicalSection = getCanonicalSectionForField(
    fieldKey,
    stepRunnerState?.activeSectionKey || nextBestQuestion?.sectionKey || response?.recommendedNextSection || requestMeta?.sectionKey || ""
  );
  const surfacedSectionCandidates = Array.from(new Set([
    canonicalSection,
    String(stepRunnerState?.activeSectionKey || "").trim(),
    String(nextBestQuestion?.sectionKey || "").trim(),
    String(response?.recommendedNextSection || "").trim(),
  ].filter(Boolean)));
  const sectionCandidates = surfacedSectionCandidates.length
    ? surfacedSectionCandidates
    : Array.from(new Set([canonicalSection, String(requestMeta?.sectionKey || "").trim()].filter(Boolean)));
  const assistantMessage = String(response?.assistantMessage || "").trim();
  const questionText = String(nextBestQuestion?.question || assistantMessage).trim();
  const promptIntent = String(
    stepRunnerState?.promptIntent
    || resolveGuidedStepIntentFromPrompt(fieldKey, canonicalSection, questionText || assistantMessage, requestMeta?.plannerState || {})
    || ""
  ).trim();
  const canonicalFamily = getCanonicalGuidedBlockerFamily(fieldKey, promptIntent, questionText || assistantMessage);

  return {
    fieldKey,
    fieldCandidates,
    requestFieldKey: String(requestMeta?.questionKey || "").trim(),
    canonicalSection,
    sectionCandidates,
    requestSectionKey: String(requestMeta?.sectionKey || "").trim(),
    promptIntent,
    canonicalFamily,
    questionFamily: classifyGuidedPromptFamily(promptIntent, fieldKey, questionText),
    assistantFamily: classifyGuidedPromptFamily(promptIntent, fieldKey, assistantMessage),
    choiceFamily: classifyGuidedChoiceFamily(response?.suggestedChoices || []),
    stepFamily: parseGuidedStepIdFamily(stepRunnerState?.activeStepId)
      || getCanonicalGuidedBlockerFamily(
        stepRunnerState?.activeFieldKey || fieldKey,
        stepRunnerState?.promptIntent || promptIntent,
        stepRunnerState?.activePrompt || assistantMessage
      ),
  };
}

function normalizeGuidedAdaptiveSelections(values = []) {
  return Array.from(new Set(
    asArray(values)
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  )).slice(0, 6);
}

function normalizeGuidedAdaptivePrompt(raw = {}) {
  const source = raw && typeof raw === "object" ? raw : {};
  const variant = String(source?.promptVariant || "").trim().toLowerCase();
  const classification = String(source?.answerClassification || "").trim().toLowerCase();
  return compactObject({
    promptText: trimText(source?.promptText, 220),
    promptVariant: GUIDED_ADAPTIVE_PROMPT_VARIANTS.has(variant) ? variant : "",
    answerClassification: GUIDED_ADAPTIVE_ANSWER_CLASSIFICATIONS.has(classification) ? classification : "",
    clarificationText: trimText(source?.clarificationText, 220),
    missingComponents: normalizeGuidedStepComponents(source?.missingComponents),
    normalizedAnswer: trimText(source?.normalizedAnswer, 220),
    interpretedSelections: normalizeGuidedAdaptiveSelections(source?.interpretedSelections),
    reasoningSummary: trimText(source?.reasoningSummary, 180),
    confidence: Number.isFinite(Number(source?.confidence)) ? Math.max(0, Math.min(1, Number(source.confidence))) : undefined,
  });
}

function buildGuidedAdaptivePromptPhase(contract = {}, requestMeta = {}) {
  const repeatedUnresolvedCount = Number(
    contract?.repeatedUnresolvedCount || requestMeta?.turnState?.repeatedUnresolvedCount || 0
  ) || 0;
  const turnDiagnosis = String(
    contract?.turnDiagnosis || requestMeta?.turnState?.turnDiagnosis || ""
  ).trim().toLowerCase();
  const hasAnswer = String(requestMeta?.userAnswer || "").trim().length > 0;

  if (!hasAnswer && repeatedUnresolvedCount === 0) return "initial";
  if (repeatedUnresolvedCount >= 2 || turnDiagnosis === "repeated_unresolved") return "repair";
  if (repeatedUnresolvedCount >= 1 || turnDiagnosis === "invalid_for_step") return "narrow_clarify";
  if (turnDiagnosis === "partial" || turnDiagnosis === "unresolved_clarify") return "clarify";
  return hasAnswer ? "clarify" : "initial";
}

function buildGuidedActiveBlockerPayload(payload = {}, activeStep = {}) {
  const fieldKey = String(activeStep?.fieldKey || payload?.questionKey || "").trim();
  const sectionKey = getCanonicalSectionForField(fieldKey, activeStep?.sectionKey || payload?.sectionKey || "");
  const blockerFamily = getCanonicalGuidedBlockerFamily(
    fieldKey,
    activeStep?.promptIntent || "",
    activeStep?.promptText || payload?.currentPrompt || ""
  );
  const allowedChoices = normalizeSuggestedChoices(
    activeStep?.suggestedChoices || payload?.currentSuggestedChoices || []
  ).map((choice) => compactObject({
    id: String(choice?.id || "").trim(),
    label: trimText(choice?.label, 80),
    description: trimText(choice?.description, 120),
    value: choice?.value,
    fieldKey: String(choice?.fieldKey || "").trim(),
  }));

  return compactObject({
    activeSectionKey: sectionKey,
    activeQuestionKey: fieldKey,
    activeStepId: String(activeStep?.canonicalStepId || activeStep?.activeStepId || activeStep?.canonicalStepId || "").trim()
      || buildCanonicalGuidedStepId(sectionKey, fieldKey, blockerFamily),
    blockerFamily,
    promptIntent: String(activeStep?.promptIntent || "").trim(),
    expectedAnswerShape: String(activeStep?.expectedAnswerMode || "").trim(),
    allowedChoices,
    requiredComponents: normalizeGuidedStepComponents(activeStep?.expectedComponents),
    missingComponents: normalizeGuidedStepComponents(activeStep?.missingComponents),
    resolvedComponents: normalizeGuidedStepComponents(activeStep?.resolvedComponents),
    unresolvedCount: Number(activeStep?.repeatedUnresolvedCount || payload?.turnState?.repeatedUnresolvedCount || 0) || undefined,
    promptPhase: buildGuidedAdaptivePromptPhase(activeStep, payload),
    promptText: trimText(activeStep?.promptText || payload?.currentPrompt, 220),
    liveDraftContext: compactObject({
      estimateContext: buildGuidedEstimateContextSummary(payload?.state, payload?.context),
      plannerState: summarizePlannerStateForRequest(readPlannerStateFromPayload(payload)),
    }),
  });
}

function mapGuidedAdaptiveClassificationToStatus(classification = "") {
  const normalized = String(classification || "").trim().toLowerCase();
  if (normalized === "resolved") return "fully_resolved";
  if (normalized === "partial") return "partially_resolved";
  if (normalized === "unresolved_clarify") return "unresolved_clarified";
  if (normalized === "invalid_for_step") return "invalid_for_prompt";
  if (normalized === "repeated_unresolved") return "needs_interpretive_retry";
  return "";
}

function buildGuidedAdaptiveChoiceMatches(contract = {}, adaptivePrompt = {}) {
  const choices = normalizeSuggestedChoices(contract?.suggestedChoices || []);
  const matchedChoices = [];
  const seen = new Set();
  normalizeGuidedAdaptiveSelections(adaptivePrompt?.interpretedSelections).forEach((selection) => {
    const match = exactMatchOption(choices, selection) || fuzzyMatchOption(choices, selection);
    const key = String(match?.id || `${match?.fieldKey || ""}:${match?.label || match?.value || ""}`).trim();
    if (!match || !key || seen.has(key)) return;
    seen.add(key);
    matchedChoices.push(match);
  });
  return matchedChoices;
}

function buildGuidedAdaptiveSyntheticAnswer(contract = {}, adaptivePrompt = {}, matchedChoices = [], requestMeta = {}) {
  const normalizedAnswer = String(adaptivePrompt?.normalizedAnswer || "").trim();
  const selectionText = matchedChoices.map((choice) => String(choice?.label || choice?.value || "").trim()).filter(Boolean).join("; ");
  if (normalizedAnswer && selectionText) return `${normalizedAnswer}; ${selectionText}`;
  if (normalizedAnswer) return normalizedAnswer;
  if (selectionText) return selectionText;
  return String(requestMeta?.userAnswer || "").trim();
}

function isGuidedAdaptivePromptTextAllowed(contract = {}, text = "") {
  const prompt = String(text || "").trim();
  if (!prompt) return false;
  if (isWeakGuidedClarificationQuestion(prompt)) return false;
  const family = getPrimaryGuidedBlockerFamily(contract);
  const promptFamily = classifyGuidedPromptFamily(
    String(contract?.promptIntent || "").trim(),
    String(contract?.fieldKey || "").trim(),
    prompt
  ) || classifyGuidedTextFamily(prompt);
  if (promptFamily && family && promptFamily !== family) return false;
  return true;
}

function isGuidedAdaptivePromptValid(contract = {}, adaptivePrompt = {}) {
  if (!adaptivePrompt || typeof adaptivePrompt !== "object") return false;
  if (!GUIDED_ADAPTIVE_ANSWER_CLASSIFICATIONS.has(String(adaptivePrompt?.answerClassification || "").trim().toLowerCase())) {
    return false;
  }
  const followUpText = String(adaptivePrompt?.clarificationText || adaptivePrompt?.promptText || "").trim();
  const classification = String(adaptivePrompt?.answerClassification || "").trim().toLowerCase();
  if (classification !== "resolved" && !isGuidedAdaptivePromptTextAllowed(contract, followUpText)) {
    return false;
  }
  return true;
}

function buildGuidedAdaptiveFallbackResponse(requestMeta = {}, fallback = {}) {
  const questionKey = String(requestMeta?.questionKey || "").trim();
  const sectionKey = String(requestMeta?.sectionKey || "").trim();
  const requestStepContract = buildGuidedStepContract(requestMeta, questionKey, sectionKey);
  const narrowedFollowUp = buildGuidedNarrowFollowUp(
    requestStepContract,
    requestStepContract?.missingComponents?.length
      ? requestStepContract.missingComponents
      : requestStepContract.expectedComponents,
    requestMeta,
    {
      forceClarify: Number(requestMeta?.turnState?.repeatedUnresolvedCount || 0) > 0,
    }
  );
  const fallbackQuestion = normalizeNextBestQuestion(
    narrowedFollowUp,
    questionKey,
    narrowedFollowUp?.question || fallback?.assistantMessage || buildPromptForField(questionKey, requestMeta)
  );
  const stepResolution = normalizeGuidedStepResolution({
    status: Number(requestMeta?.turnState?.repeatedUnresolvedCount || 0) > 0 ? "needs_interpretive_retry" : "invalid_for_prompt",
    answeredComponents: [],
    missingComponents: requestStepContract?.expectedComponents || [],
    invalidReason: "Local blocker-scoped clarification fallback.",
  });
  return {
    assistantMessage: fallbackQuestion.question,
    suggestedChoices: normalizeSuggestedChoices(
      narrowedFollowUp?.suggestedChoices || requestStepContract?.suggestedChoices || fallback?.suggestedChoices || []
    ),
    extractedFieldValues: [],
    proposedFieldWrites: [],
    confidenceByField: fallback?.confidenceByField || {},
    fieldsNeedingConfirmation: [],
    unresolvedFields: questionKey ? [questionKey] : [],
    recommendedNextSection: fallbackQuestion.sectionKey || sectionKey,
    recommendedNextQuestion: fallbackQuestion.fieldKey || questionKey,
    reasoningTags: ["adaptive_fallback", questionKey ? `field:${questionKey}` : ""].filter(Boolean),
    warnings: asArray(fallback?.warnings || []),
    interpretedIntent: normalizeInterpretedIntent({
      kind: "adaptive_local_fallback",
      targetField: questionKey,
      summary: "Local blocker-scoped clarification fallback.",
    }),
    missingContext: normalizeMissingContext(stepResolution?.missingComponents || requestStepContract?.expectedComponents || []),
    nextBestQuestion: fallbackQuestion,
    stepResolution,
    shouldAutoApply: false,
    shouldAskFollowUp: true,
  };
}

function buildGuidedResponseFromAdaptivePrompt(raw = {}, fallback = {}, requestMeta = {}) {
  const adaptiveSource = raw?.adaptivePrompt && typeof raw.adaptivePrompt === "object"
    ? raw.adaptivePrompt
    : raw;
  const adaptivePrompt = normalizeGuidedAdaptivePrompt(adaptiveSource);
  const questionKey = String(requestMeta?.questionKey || "").trim();
  const sectionKey = String(requestMeta?.sectionKey || "").trim();
  const requestStepContract = buildGuidedStepContract(requestMeta, questionKey, sectionKey);

  if (!isGuidedAdaptivePromptValid(requestStepContract, adaptivePrompt)) {
    return buildGuidedAdaptiveFallbackResponse(requestMeta, fallback);
  }

  const matchedChoices = buildGuidedAdaptiveChoiceMatches(requestStepContract, adaptivePrompt);
  const syntheticAnswer = buildGuidedAdaptiveSyntheticAnswer(requestStepContract, adaptivePrompt, matchedChoices, requestMeta);
  const target = {
    questionKey,
    sectionKey,
  };
  const writes = extractFallbackWrites({
    ...requestMeta,
    userAnswer: syntheticAnswer,
  }, target, syntheticAnswer);
  const resolvedTurn = resolveGuidedActiveStepAnswer({
    ...requestMeta,
    userAnswer: syntheticAnswer,
  }, target, writes);
  const locallyResolved = normalizeGuidedStepResolution(resolvedTurn?.stepResolution);
  const classificationStatus = mapGuidedAdaptiveClassificationToStatus(adaptivePrompt?.answerClassification);
  const stepResolution = normalizeGuidedStepResolution({
    ...locallyResolved,
    status: locallyResolved?.status || classificationStatus,
    missingComponents: locallyResolved?.missingComponents?.length
      ? locallyResolved.missingComponents
      : adaptivePrompt?.missingComponents,
    invalidReason: String(locallyResolved?.invalidReason || adaptivePrompt?.reasoningSummary || "").trim(),
  });
  const followUpText = String(
    adaptivePrompt?.clarificationText
    || adaptivePrompt?.promptText
    || ""
  ).trim();
  const useAdaptiveFollowUp = ["partially_resolved", "unresolved_clarified", "invalid_for_prompt", "needs_interpretive_retry"]
    .includes(stepResolution?.status || "")
    && isGuidedAdaptivePromptTextAllowed(requestStepContract, followUpText);

  if (!["fully_resolved", "partially_resolved", "unresolved_clarified", "invalid_for_prompt", "needs_interpretive_retry"].includes(stepResolution?.status || "")) {
    return buildGuidedAdaptiveFallbackResponse(requestMeta, fallback);
  }

  return {
    assistantMessage: useAdaptiveFollowUp ? followUpText : "",
    suggestedChoices: normalizeSuggestedChoices(requestStepContract?.suggestedChoices || fallback?.suggestedChoices || []),
    extractedFieldValues: writes,
    proposedFieldWrites: writes,
    confidenceByField: mergeConfidenceByField(
      fallback?.confidenceByField || {},
      writes.length
        ? writes
        : matchedChoices.map((choice) => ({
          key: String(choice?.fieldKey || "").trim(),
          confidence: Number(adaptivePrompt?.confidence || 0),
        }))
    ),
    fieldsNeedingConfirmation: [],
    unresolvedFields: useAdaptiveFollowUp && questionKey ? [questionKey] : [],
    recommendedNextSection: useAdaptiveFollowUp ? sectionKey : "",
    recommendedNextQuestion: useAdaptiveFollowUp ? questionKey : "",
    reasoningTags: [
      "adaptive_prompt",
      adaptivePrompt?.promptVariant ? `variant:${adaptivePrompt.promptVariant}` : "",
      adaptivePrompt?.answerClassification ? `classification:${adaptivePrompt.answerClassification}` : "",
      questionKey ? `field:${questionKey}` : "",
    ].filter(Boolean),
    warnings: asArray(fallback?.warnings || []),
    interpretedIntent: normalizeInterpretedIntent({
      kind: `adaptive_${adaptivePrompt?.answerClassification || "step"}`,
      summary: adaptivePrompt?.reasoningSummary || syntheticAnswer,
      targetField: questionKey,
    }),
    missingContext: normalizeMissingContext(
      stepResolution?.missingComponents?.length ? stepResolution.missingComponents : adaptivePrompt?.missingComponents
    ),
    nextBestQuestion: useAdaptiveFollowUp
      ? {
        fieldKey: questionKey,
        sectionKey,
        question: followUpText,
      }
      : null,
    stepResolution,
    shouldAutoApply: stepResolution?.status === "fully_resolved" && writes.length > 0,
    shouldAskFollowUp: useAdaptiveFollowUp,
    adaptivePrompt,
  };
}

function getPrimaryGuidedBlockerFamily(contract = {}) {
  const choiceFamily = String(contract?.choiceFamily || "").trim();
  return String(
    contract?.questionFamily
    || contract?.assistantFamily
    || (choiceFamily && choiceFamily !== "mixed" ? choiceFamily : "")
    || contract?.stepFamily
    || contract?.canonicalFamily
    || ""
  ).trim();
}

function isGuidedCustomerBlocker(fieldKey = "", sectionKey = "", family = "") {
  const normalizedFieldKey = String(fieldKey || "").trim();
  const normalizedSectionKey = String(sectionKey || "").trim();
  const normalizedFamily = String(family || "").trim();
  return normalizedFamily === "customer"
    || normalizedSectionKey === "customer"
    || normalizedFieldKey.startsWith("customer.");
}

function getGuidedLiveBlockerTarget(requestMeta = {}) {
  const liveTarget = chooseNextGuidedTarget({
    mode: requestMeta?.mode === "invoice" ? "invoice" : "estimate",
    state: requestMeta?.state,
    guidedMeta: buildGuidedRepairMeta(requestMeta),
    preferredSection: requestMeta?.sectionKey || "",
    context: requestMeta?.context,
  });
  const fieldKey = String(liveTarget?.questionKey || "").trim();
  const sectionKey = getCanonicalSectionForField(fieldKey, liveTarget?.sectionKey || requestMeta?.sectionKey || "");
  const family = isGuidedCustomerBlocker(fieldKey, sectionKey)
    ? "customer"
    : (getGuidedBlockerFamilyFromField(fieldKey) || "");

  return {
    fieldKey,
    sectionKey,
    family,
    raw: liveTarget,
  };
}

function validateGuidedRuntimeContract(contract = {}) {
  const reasons = [];
  const fieldCandidates = Array.from(new Set(asArray(contract?.fieldCandidates).filter(Boolean)));
  const sectionCandidates = Array.from(new Set(asArray(contract?.sectionCandidates).filter(Boolean)));
  const familyCandidates = Array.from(new Set([
    String(contract?.canonicalFamily || "").trim(),
    String(contract?.questionFamily || "").trim(),
    String(contract?.assistantFamily || "").trim(),
    String(contract?.stepFamily || "").trim(),
  ].filter(Boolean)));

  if (!String(contract?.fieldKey || "").trim()) reasons.push("missing_field");
  if (fieldCandidates.length > 1) reasons.push("field_mismatch");
  if (sectionCandidates.some((section) => section !== contract?.canonicalSection)) reasons.push("section_mismatch");
  if (String(contract?.choiceFamily || "").trim() === "mixed") reasons.push("choice_family_mixed");
  if (familyCandidates.length > 1) reasons.push("family_mismatch");
  if (contract?.choiceFamily && contract?.canonicalFamily && contract.choiceFamily !== contract.canonicalFamily) {
    reasons.push("choice_family_mismatch");
  }

  return { valid: reasons.length === 0, reasons };
}

function requiresGuidedPrerequisiteRepair(contract = {}, requestMeta = {}) {
  const state = requestMeta?.state || {};
  const tradeKey = String(state?.tradeInsert?.key || requestMeta?.plannerState?.tradeKey || "").trim();
  const family = getPrimaryGuidedBlockerFamily(contract);
  if (!tradeKey && !["customer", "trade", "review"].includes(family) && String(contract?.fieldKey || "").trim() !== "tradeInsert.key") {
    return true;
  }
  return false;
}

function buildGuidedRepairMeta(requestMeta = {}) {
  const guidedMeta = requestMeta?.guidedMeta && typeof requestMeta.guidedMeta === "object"
    ? { ...requestMeta.guidedMeta }
    : {};
  const plannerState = normalizePlannerState({
    ...getGuidedPlannerState(guidedMeta),
    ...(requestMeta?.plannerState || {}),
  });
  if (Object.keys(plannerState).length) {
    guidedMeta[GUIDED_PLANNER_META_KEY] = plannerState;
  }
  return guidedMeta;
}

function pickRepresentativeIntentForFamily(family = "", requestMeta = {}, fallbackIntent = "") {
  const normalizedFamily = String(family || "").trim();
  const fallback = String(fallbackIntent || "").trim();
  if (normalizedFamily === "customer") return fallback || "customer_selection";
  if (normalizedFamily === "trade") return fallback || "trade_definition";
  if (normalizedFamily === "labor_basis") return fallback || "labor_basis";
  if (normalizedFamily === "materials_mode") return fallback || "materials_path";
  if (normalizedFamily === "materials_basis") return fallback || "materials_allowance";
  if (normalizedFamily === "surfaces") return fallback || "scope_surfaces";
  if (normalizedFamily === "occupancy_access") return fallback || (requestMeta?.plannerState?.commercialContext ? "commercial_access" : "painting_occupancy");
  if (normalizedFamily === "area_scope") return fallback || "scope_quantity";
  if (normalizedFamily === "drywall_repair") return fallback || "drywall_repair_count";
  if (normalizedFamily === "location") return fallback || "scope_location_type";
  if (normalizedFamily === "demo") return fallback || "flooring_demo";
  if (normalizedFamily === "transitions") return fallback || "flooring_transitions";
  if (normalizedFamily === "prep") return fallback || (requestMeta?.plannerState?.flooring ? "flooring_prep" : "painting_prep");
  if (normalizedFamily === "painting_finish") return fallback || "painting_finish";
  if (normalizedFamily === "painting_coats_color") return fallback || "painting_coats_color";
  if (normalizedFamily === "notes") return fallback || "notes_general";
  if (normalizedFamily === "review") return fallback || "review_handoff";
  return fallback;
}

function getGuidedFieldForFamily(family = "", fallbackFieldKey = "") {
  const normalizedFamily = String(family || "").trim();
  if (normalizedFamily === "customer") return "customer.id";
  if (normalizedFamily === "trade") return "tradeInsert.key";
  if (normalizedFamily === "labor_basis") return "labor.lines";
  if (normalizedFamily === "materials_mode") return "ui.materialsMode";
  if (normalizedFamily === "materials_basis") return String(fallbackFieldKey || "materials.blanketCost").trim() || "materials.blanketCost";
  if (normalizedFamily === "notes") return "additionalNotes";
  if (normalizedFamily === "review") return "job.docNumber";
  return String(fallbackFieldKey || "scopeNotes").trim() || "scopeNotes";
}

function resolveGuidedRepairTarget(contract = {}, requestMeta = {}) {
  const state = requestMeta?.state || {};
  const tradeKey = String(state?.tradeInsert?.key || requestMeta?.plannerState?.tradeKey || "").trim();
  const desiredFamily = getPrimaryGuidedBlockerFamily(contract);
  const liveTarget = getGuidedLiveBlockerTarget(requestMeta);

  if (!tradeKey && !["customer", "review"].includes(desiredFamily)) {
    return { fieldKey: "tradeInsert.key", sectionKey: "scope", family: "trade", reason: "missing_trade" };
  }

  if (isGuidedCustomerBlocker(contract?.fieldKey, contract?.canonicalSection, desiredFamily)) {
    return {
      fieldKey: String(liveTarget.fieldKey || contract?.fieldKey || "customer.id").trim() || "customer.id",
      sectionKey: String(liveTarget.sectionKey || contract?.canonicalSection || "customer").trim() || "customer",
      family: "customer",
      reason: "customer_blocker",
    };
  }

  if (liveTarget.family === "customer" && !desiredFamily) {
    return {
      fieldKey: String(liveTarget.fieldKey || "customer.id").trim() || "customer.id",
      sectionKey: String(liveTarget.sectionKey || "customer").trim() || "customer",
      family: "customer",
      reason: "live_customer_blocker",
    };
  }

  const familyFieldKey = getGuidedFieldForFamily(desiredFamily, contract?.fieldKey);
  if (familyFieldKey) {
    return {
      fieldKey: familyFieldKey,
      sectionKey: getCanonicalSectionForField(familyFieldKey, requestMeta?.sectionKey || contract?.canonicalSection || ""),
      family: desiredFamily,
      reason: "family_repair",
    };
  }

  return {
    fieldKey: String(liveTarget?.fieldKey || contract?.fieldKey || requestMeta?.questionKey || "scopeNotes").trim(),
    sectionKey: getCanonicalSectionForField(
      liveTarget?.fieldKey || contract?.fieldKey || requestMeta?.questionKey || "scopeNotes",
      liveTarget?.sectionKey || requestMeta?.sectionKey || contract?.canonicalSection || "scope"
    ),
    family: desiredFamily || liveTarget.family,
    reason: "live_target",
  };
}

function buildCanonicalGuidedTurn(target = {}, response = {}, requestMeta = {}, familyHint = "") {
  const fieldKey = String(target?.fieldKey || "").trim();
  const sectionKey = getCanonicalSectionForField(fieldKey, target?.sectionKey || "");
  const promptIntent = pickRepresentativeIntentForFamily(
    familyHint,
    requestMeta,
    response?.stepRunnerState?.promptIntent || response?.promptIntent || ""
  );
  const basePayload = {
    mode: requestMeta?.mode === "invoice" ? "invoice" : "estimate",
    state: requestMeta?.state,
    context: requestMeta?.context,
    guidedMeta: buildGuidedRepairMeta(requestMeta),
    sectionKey,
    questionKey: fieldKey,
    currentPrompt: "",
    userAnswer: "",
    answeredPrompts: requestMeta?.priorGuidedAnswers || requestMeta?.answeredPrompts || [],
    plannerState: normalizePlannerState(requestMeta?.plannerState),
    turnState: requestMeta?.turnState,
    activeStep: {
      fieldKey,
      sectionKey,
      promptIntent,
      promptText: "",
      suggestedChoices: [],
      plannerState: normalizePlannerState(requestMeta?.plannerState),
    },
    currentSuggestedChoices: [],
  };

  let promptText = buildPromptForField(fieldKey, basePayload);
  let suggestedChoices = normalizeSuggestedChoices(buildChoiceSet(fieldKey, basePayload));
  let contract = buildGuidedStepContract({
    ...basePayload,
    currentPrompt: promptText,
    activeStep: {
      ...basePayload.activeStep,
      promptText,
      suggestedChoices,
    },
    currentSuggestedChoices: suggestedChoices,
  }, fieldKey, sectionKey);
  let nextBestQuestion = {
    fieldKey,
    sectionKey,
    question: contract?.promptText || promptText,
  };

  const narrowed = buildGuidedNarrowFollowUp(contract, contract?.expectedComponents || [], {
    ...basePayload,
    currentPrompt: contract?.promptText || promptText,
    activeStep: contract,
    currentSuggestedChoices: suggestedChoices,
    userAnswer: "",
  }, { forceClarify: false });

  if (narrowed?.question) {
    nextBestQuestion = normalizeNextBestQuestion(narrowed, narrowed?.fieldKey || fieldKey, narrowed?.question || promptText);
    promptText = String(nextBestQuestion?.question || promptText).trim();
    suggestedChoices = normalizeSuggestedChoices(narrowed?.suggestedChoices || suggestedChoices);
    contract = buildGuidedStepContract({
      ...basePayload,
      questionKey: nextBestQuestion.fieldKey || fieldKey,
      sectionKey: nextBestQuestion.sectionKey || sectionKey,
      currentPrompt: promptText,
      activeStep: {
        ...basePayload.activeStep,
        fieldKey: nextBestQuestion.fieldKey || fieldKey,
        sectionKey: nextBestQuestion.sectionKey || sectionKey,
        promptText,
        promptIntent,
        suggestedChoices,
      },
      currentSuggestedChoices: suggestedChoices,
    }, nextBestQuestion.fieldKey || fieldKey, nextBestQuestion.sectionKey || sectionKey);
  }

  if (!suggestedChoices.length) {
    suggestedChoices = normalizeSuggestedChoices(buildChoiceSet(nextBestQuestion.fieldKey || fieldKey, basePayload));
  }

  return {
    fieldKey: String(nextBestQuestion.fieldKey || fieldKey).trim(),
    sectionKey: getCanonicalSectionForField(nextBestQuestion.fieldKey || fieldKey, nextBestQuestion.sectionKey || sectionKey),
    promptText: String(nextBestQuestion.question || contract?.promptText || promptText || buildPromptForField(fieldKey, basePayload)).trim(),
    suggestedChoices,
    contract,
  };
}

function buildFailClosedGuidedTurn(target = {}, requestMeta = {}, familyHint = "") {
  const fieldKey = String(target?.fieldKey || requestMeta?.questionKey || "scopeNotes").trim();
  const sectionKey = getCanonicalSectionForField(fieldKey, target?.sectionKey || requestMeta?.sectionKey || "scope");
  const promptText = buildPromptForField(fieldKey, {
    mode: requestMeta?.mode === "invoice" ? "invoice" : "estimate",
    state: requestMeta?.state,
    context: requestMeta?.context,
    sectionKey,
    questionKey: fieldKey,
  });
  return {
    fieldKey,
    sectionKey,
    promptText,
    suggestedChoices: [],
    contract: buildGuidedStepContract({
      ...requestMeta,
      questionKey: fieldKey,
      sectionKey,
      currentPrompt: promptText,
      activeStep: {
        fieldKey,
        sectionKey,
        promptIntent: pickRepresentativeIntentForFamily(familyHint, requestMeta, ""),
        promptText,
        suggestedChoices: [],
      },
      currentSuggestedChoices: [],
    }, fieldKey, sectionKey),
  };
}

function alignGuidedStepPresentation({ nextBestQuestion = {}, suggestedChoices = [], requestMeta = {} } = {}) {
  const fieldKey = String(nextBestQuestion?.fieldKey || "").trim();
  const sectionKey = getCanonicalSectionForField(nextBestQuestion?.fieldKey, nextBestQuestion?.sectionKey);
  const question = String(nextBestQuestion?.question || "").trim();
  if (!fieldKey || !question) {
    return {
      nextBestQuestion,
      suggestedChoices: normalizeSuggestedChoices(suggestedChoices),
    };
  }

  const synthesizedContract = buildGuidedStepContract({
    ...requestMeta,
    questionKey: fieldKey,
    sectionKey,
    currentPrompt: question,
    activeStep: {
      fieldKey,
      sectionKey,
      promptText: question,
      suggestedChoices,
    },
    currentSuggestedChoices: suggestedChoices,
  }, fieldKey, sectionKey);

  const promptFamily = classifyGuidedPromptFamily(
    synthesizedContract?.promptIntent,
    fieldKey,
    question
  );
  const choiceFamily = classifyGuidedChoiceFamily(suggestedChoices);
  const hasMismatch = !!promptFamily && !!choiceFamily && promptFamily !== choiceFamily;
  if (!hasMismatch) {
    return {
      nextBestQuestion: {
        ...nextBestQuestion,
        sectionKey,
      },
      suggestedChoices: normalizeSuggestedChoices(suggestedChoices),
    };
  }

  const narrowed = buildGuidedNarrowFollowUp(
    synthesizedContract,
    synthesizedContract?.expectedComponents || [],
    {
      ...requestMeta,
      questionKey: fieldKey,
      sectionKey,
      currentPrompt: question,
      activeStep: synthesizedContract,
      currentSuggestedChoices: suggestedChoices,
      userAnswer: "",
    },
    { forceClarify: false }
  );

  const rebuiltChoices = normalizeSuggestedChoices(
    narrowed?.suggestedChoices?.length
      ? narrowed.suggestedChoices
      : buildChoiceSet(fieldKey, {
        ...requestMeta,
        questionKey: fieldKey,
        sectionKey,
      })
  );
  const rebuiltQuestion = String(narrowed?.question || question || "").trim();

  return {
    nextBestQuestion: {
      fieldKey,
      sectionKey,
      question: rebuiltQuestion,
    },
    suggestedChoices: rebuiltChoices,
  };
}

function isEchoLikeGuidedWrite(userAnswer, proposedValue) {
  if (typeof proposedValue !== "string") return false;
  const answer = normalizeLooseGuidedText(userAnswer);
  const value = normalizeLooseGuidedText(proposedValue);
  if (!answer || !value) return false;
  if (answer === value) return true;
  const answerWords = answer.split(" ").filter(Boolean);
  const valueWords = value.split(" ").filter(Boolean);
  if (answerWords.length < 4 || valueWords.length < 4) return false;
  return answer.includes(value) || value.includes(answer);
}

function isGuidedWriteCompatible(questionKey, write, interpretedIntent, userAnswer) {
  const writeKey = String(write?.key || "").trim();
  if (!writeKey) return false;
  const confidence = Number(write?.confidence || 0);
  const intentKind = String(interpretedIntent?.kind || "").trim().toLowerCase();

  if (questionKey === "scopeNotes") {
    if (writeKey === "tradeInsert.key") return confidence >= 0.86 && isScopeIntentKind(intentKind);
    if (writeKey === "scopeNotes") return confidence >= 0.9 && isScopeIntentKind(intentKind) && !isEchoLikeGuidedWrite(userAnswer, write?.value);
    return false;
  }

  if (questionKey === "tradeInsert.key") {
    return writeKey === "tradeInsert.key" && confidence >= 0.84;
  }

  if (questionKey === "additionalNotes") {
    return writeKey === "additionalNotes" && confidence >= 0.88 && isNotesIntentKind(intentKind) && !isEchoLikeGuidedWrite(userAnswer, write?.value);
  }

  return true;
}

function mergeConfidenceByField(baseMap, writes) {
  const next = baseMap && typeof baseMap === "object" ? { ...baseMap } : {};
  asArray(writes).forEach((write) => {
    if (!write?.key) return;
    next[write.key] = Number(write?.confidence || 0);
  });
  return next;
}

function enforceCanonicalBlockerContract(response, requestMeta = {}) {
  const contract = buildGuidedRuntimeContract(response, requestMeta);
  const validation = validateGuidedRuntimeContract(contract);
  if (validation.valid && !requiresGuidedPrerequisiteRepair(contract, requestMeta)) return response;

  const repairTarget = resolveGuidedRepairTarget(contract, requestMeta);
  const repairedTurn = buildCanonicalGuidedTurn(
    repairTarget,
    response,
    requestMeta,
    repairTarget.family || contract.canonicalFamily
  );
  const interpretedIntent = normalizeInterpretedIntent(response?.interpretedIntent);
  const nextBestQuestion = {
    fieldKey: repairedTurn.fieldKey,
    sectionKey: repairedTurn.sectionKey,
    question: repairedTurn.promptText,
  };
  const repairedContext = deriveGuidedContext(
    {
      ...response,
      assistantMessage: repairedTurn.promptText,
      suggestedChoices: repairedTurn.suggestedChoices,
      nextBestQuestion,
      recommendedNextSection: repairedTurn.sectionKey,
      recommendedNextQuestion: repairedTurn.fieldKey,
    },
    {
      ...requestMeta,
      questionKey: repairedTurn.fieldKey,
      sectionKey: repairedTurn.sectionKey,
      currentPrompt: repairedTurn.promptText,
      activeStep: repairedTurn.contract,
      currentSuggestedChoices: repairedTurn.suggestedChoices,
    },
    interpretedIntent,
    normalizeExtractedFieldValues(response?.proposedFieldWrites || response?.extractedFieldValues || []),
    nextBestQuestion
  );
  const repairedResponse = {
    ...response,
    assistantMessage: repairedTurn.promptText,
    suggestedChoices: repairedTurn.suggestedChoices,
    nextBestQuestion,
    recommendedNextSection: repairedTurn.sectionKey,
    recommendedNextQuestion: repairedTurn.fieldKey,
    stepRunnerState: buildStepRunnerState({
      ...response,
      assistantMessage: repairedTurn.promptText,
      suggestedChoices: repairedTurn.suggestedChoices,
      nextBestQuestion,
      recommendedNextSection: repairedTurn.sectionKey,
      recommendedNextQuestion: repairedTurn.fieldKey,
    }, {
      ...requestMeta,
      questionKey: repairedTurn.fieldKey,
      sectionKey: repairedTurn.sectionKey,
      currentPrompt: repairedTurn.promptText,
      activeStep: repairedTurn.contract,
      currentSuggestedChoices: repairedTurn.suggestedChoices,
    }, repairedContext),
  };

  const repairedValidation = validateGuidedRuntimeContract(
    buildGuidedRuntimeContract(repairedResponse, {
      ...requestMeta,
      questionKey: repairedTurn.fieldKey,
      sectionKey: repairedTurn.sectionKey,
    })
  );
  if (repairedValidation.valid) return repairedResponse;

  const failClosedTurn = buildFailClosedGuidedTurn(
    repairTarget,
    requestMeta,
    repairTarget.family || contract.canonicalFamily
  );
  const failClosedNextBestQuestion = {
    fieldKey: failClosedTurn.fieldKey,
    sectionKey: failClosedTurn.sectionKey,
    question: failClosedTurn.promptText,
  };
  const failClosedContext = deriveGuidedContext(
    {
      ...response,
      assistantMessage: failClosedTurn.promptText,
      suggestedChoices: [],
      nextBestQuestion: failClosedNextBestQuestion,
      recommendedNextSection: failClosedTurn.sectionKey,
      recommendedNextQuestion: failClosedTurn.fieldKey,
    },
    {
      ...requestMeta,
      questionKey: failClosedTurn.fieldKey,
      sectionKey: failClosedTurn.sectionKey,
      currentPrompt: failClosedTurn.promptText,
      activeStep: failClosedTurn.contract,
      currentSuggestedChoices: [],
    },
    interpretedIntent,
    normalizeExtractedFieldValues(response?.proposedFieldWrites || response?.extractedFieldValues || []),
    failClosedNextBestQuestion
  );

  return {
    ...response,
    assistantMessage: failClosedTurn.promptText,
    suggestedChoices: [],
    nextBestQuestion: failClosedNextBestQuestion,
    recommendedNextSection: failClosedTurn.sectionKey,
    recommendedNextQuestion: failClosedTurn.fieldKey,
    stepRunnerState: buildStepRunnerState({
      ...response,
      assistantMessage: failClosedTurn.promptText,
      suggestedChoices: [],
      nextBestQuestion: failClosedNextBestQuestion,
      recommendedNextSection: failClosedTurn.sectionKey,
      recommendedNextQuestion: failClosedTurn.fieldKey,
    }, {
      ...requestMeta,
      questionKey: failClosedTurn.fieldKey,
      sectionKey: failClosedTurn.sectionKey,
      currentPrompt: failClosedTurn.promptText,
      activeStep: failClosedTurn.contract,
      currentSuggestedChoices: [],
    }, failClosedContext),
  };
}

function finalizeGuidedResponse(response, requestMeta = {}) {
  const questionKey = String(requestMeta?.questionKey || "").trim();
  const userAnswer = String(requestMeta?.userAnswer || "").trim();
  const requestStepContract = buildGuidedStepContract(requestMeta, questionKey, requestMeta?.sectionKey || "");
  const stepResolution = normalizeGuidedStepResolution(response?.stepResolution);
  const proposedFieldWrites = normalizeExtractedFieldValues(response?.proposedFieldWrites || response?.extractedFieldValues || []);
  const interpretedIntent = normalizeInterpretedIntent(response?.interpretedIntent);
  const narrowedFollowUp = ["partially_resolved", "unresolved_clarified", "invalid_for_prompt", "needs_interpretive_retry"].includes(stepResolution?.status || "")
    ? buildGuidedNarrowFollowUp(
      requestStepContract,
      stepResolution?.missingComponents?.length ? stepResolution.missingComponents : requestStepContract.expectedComponents,
      requestMeta,
      {
        forceClarify: ["invalid_for_prompt", "needs_interpretive_retry"].includes(stepResolution?.status || ""),
      }
    )
    : null;
  const normalizedNextBestQuestionBase = normalizeNextBestQuestion(
    response?.nextBestQuestion,
    response?.recommendedNextQuestion,
    response?.assistantMessage
  );
  const normalizedNextBestQuestion = (!normalizedNextBestQuestionBase.question && narrowedFollowUp?.question)
    ? normalizeNextBestQuestion(
      narrowedFollowUp,
      narrowedFollowUp.fieldKey,
      narrowedFollowUp.question
    )
    : normalizedNextBestQuestionBase;
  const shouldAutoApply = response?.shouldAutoApply === true;
  const proactivePlan = buildProactiveGuidedPlan(
    response,
    requestMeta,
    interpretedIntent,
    proposedFieldWrites,
    normalizedNextBestQuestion
  );
  const context = proactivePlan?.context || deriveGuidedContext(
    response,
    requestMeta,
    interpretedIntent,
    proposedFieldWrites,
    normalizedNextBestQuestion
  );
  const nextBestQuestion = proactivePlan?.nextBestQuestion && (
    !normalizedNextBestQuestion.question
    || isWeakGuidedQuestion(
      normalizedNextBestQuestion.question,
      context,
      normalizedNextBestQuestion.fieldKey || proactivePlan?.nextBestQuestion?.fieldKey
    )
  )
    ? normalizeNextBestQuestion(
      proactivePlan.nextBestQuestion,
      normalizedNextBestQuestion.fieldKey || questionKey,
      proactivePlan.nextBestQuestion?.question || response?.assistantMessage
    )
    : normalizedNextBestQuestion;
  const shouldAskFollowUp = response?.shouldAskFollowUp === true
    || ["partially_resolved", "unresolved_clarified", "invalid_for_prompt", "needs_interpretive_retry"].includes(stepResolution?.status || "")
    || (!shouldAutoApply && !!nextBestQuestion.question)
    || !!proactivePlan?.nextBestQuestion?.question;
  const autoApplicableWrites = proposedFieldWrites.filter((write) =>
    isGuidedWriteCompatible(questionKey, write, interpretedIntent, userAnswer)
  );
  const suggestedChoices = proactivePlan?.suggestedChoices?.length && isWeakGuidedChoiceSet(
    response?.suggestedChoices || [],
    context,
    nextBestQuestion.fieldKey || questionKey
  )
    ? normalizeSuggestedChoices(proactivePlan.suggestedChoices)
    : normalizeSuggestedChoices(response?.suggestedChoices || []);
  const alignedStep = alignGuidedStepPresentation({
    nextBestQuestion,
    suggestedChoices,
    requestMeta,
  });
  const alignedQuestion = alignedStep.nextBestQuestion || nextBestQuestion;
  const finalNextBestQuestion = {
    ...alignedQuestion,
    sectionKey: getCanonicalSectionForField(
      alignedQuestion?.fieldKey,
      alignedQuestion?.sectionKey || response?.recommendedNextSection || requestMeta?.sectionKey || ""
    ),
  };
  const finalSuggestedChoices = alignedStep.suggestedChoices || suggestedChoices;
  const assistantMessage = shouldAskFollowUp && finalNextBestQuestion.question
    ? finalNextBestQuestion.question
    : String(response?.assistantMessage || "").trim();
  const unresolvedFields = Array.from(new Set([
    ...asArray(response?.unresolvedFields || []).map((value) => String(value || "").trim()).filter(Boolean),
    ...((shouldAskFollowUp && finalNextBestQuestion.fieldKey) ? [finalNextBestQuestion.fieldKey] : []),
  ]));
  const stepRunnerState = buildStepRunnerState({
    ...response,
    assistantMessage: assistantMessage || buildPromptForField(questionKey, requestMeta),
    suggestedChoices: finalSuggestedChoices,
    nextBestQuestion: finalNextBestQuestion,
  }, requestMeta, context);

  // Canonical blocker contract guard: ensure all elements come from the same blocker
  const canonicalResponse = enforceCanonicalBlockerContract({
    ...response,
    assistantMessage: assistantMessage || buildPromptForField(questionKey, requestMeta),
    interpretedIntent,
    proposedFieldWrites,
    suggestedChoices: finalSuggestedChoices,
    extractedFieldValues: shouldAutoApply ? autoApplicableWrites : [],
    confidenceByField: mergeConfidenceByField(response?.confidenceByField, proposedFieldWrites),
    missingContext: proactivePlan?.missingContext?.length
      ? normalizeMissingContext(proactivePlan.missingContext)
      : normalizeMissingContext(response?.missingContext),
    nextBestQuestion: finalNextBestQuestion,
    shouldAutoApply: shouldAutoApply && autoApplicableWrites.length > 0,
    shouldAskFollowUp,
    unresolvedFields,
    recommendedNextSection: String(
      finalNextBestQuestion.sectionKey || response?.recommendedNextSection || ""
    ).trim(),
    recommendedNextQuestion: String(
      finalNextBestQuestion.fieldKey || response?.recommendedNextQuestion || ""
    ).trim(),
    stepResolution,
    stepRunnerState,
    resolutionSource: String(requestMeta?.resolutionSource || response?.resolutionSource || "").trim() || "local",
  }, requestMeta);

  return canonicalResponse;
}

function normalizeGuidedRequestAnswer(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeGuidedResponse(raw, fallback = {}, requestMeta = {}) {
  const adaptiveSource = raw?.adaptivePrompt && typeof raw.adaptivePrompt === "object"
    ? raw.adaptivePrompt
    : raw;
  if (
    adaptiveSource
    && typeof adaptiveSource === "object"
    && (
      Object.prototype.hasOwnProperty.call(adaptiveSource, "promptText")
      || Object.prototype.hasOwnProperty.call(adaptiveSource, "answerClassification")
      || Object.prototype.hasOwnProperty.call(raw || {}, "adaptivePrompt")
    )
  ) {
    return finalizeGuidedResponse(
      buildGuidedResponseFromAdaptivePrompt(raw, fallback, requestMeta),
      requestMeta
    );
  }
  const response = raw && typeof raw === "object" ? raw : {};
  const normalized = {
    assistantMessage: String(response?.assistantMessage || fallback.assistantMessage || "").trim(),
    suggestedChoices: normalizeSuggestedChoices(response?.suggestedChoices || fallback.suggestedChoices || []),
    extractedFieldValues: normalizeExtractedFieldValues(response?.extractedFieldValues || fallback.extractedFieldValues || []),
    proposedFieldWrites: normalizeExtractedFieldValues(response?.proposedFieldWrites || response?.extractedFieldValues || fallback.proposedFieldWrites || fallback.extractedFieldValues || []),
    confidenceByField: response?.confidenceByField && typeof response.confidenceByField === "object"
      ? response.confidenceByField
      : (fallback.confidenceByField || {}),
    fieldsNeedingConfirmation: asArray(response?.fieldsNeedingConfirmation || fallback.fieldsNeedingConfirmation || []).map((value) => String(value || "").trim()).filter(Boolean),
    unresolvedFields: asArray(response?.unresolvedFields || fallback.unresolvedFields || []).map((value) => String(value || "").trim()).filter(Boolean),
    recommendedNextSection: String(response?.recommendedNextSection || fallback.recommendedNextSection || "").trim(),
    recommendedNextQuestion: String(response?.recommendedNextQuestion || fallback.recommendedNextQuestion || "").trim(),
    reasoningTags: asArray(response?.reasoningTags || fallback.reasoningTags || []).map((value) => String(value || "").trim()).filter(Boolean),
    warnings: asArray(response?.warnings || fallback.warnings || []).map((value) => String(value || "").trim()).filter(Boolean),
    interpretedIntent: normalizeInterpretedIntent(response?.interpretedIntent, fallback?.interpretedIntent),
    missingContext: response?.missingContext || fallback?.missingContext || [],
    nextBestQuestion: response?.nextBestQuestion || fallback?.nextBestQuestion || null,
    stepResolution: normalizeGuidedStepResolution(response?.stepResolution || fallback?.stepResolution),
    shouldAutoApply: response?.shouldAutoApply === true || fallback?.shouldAutoApply === true,
    shouldAskFollowUp: response?.shouldAskFollowUp === true || fallback?.shouldAskFollowUp === true,
  };
  return finalizeGuidedResponse(normalized, requestMeta);
}

function compactObject(source) {
  const out = {};
  Object.entries(source || {}).forEach(([key, value]) => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      if (!value.length) return;
      out[key] = value;
      return;
    }
    if (typeof value === "object") {
      const nested = compactObject(value);
      if (!Object.keys(nested).length) return;
      out[key] = nested;
      return;
    }
    if (typeof value === "string" && !value.trim()) return;
    out[key] = value;
  });
  return out;
}

function normalizePlannerState(value) {
  const source = value && typeof value === "object" ? value : {};
  return compactObject({
    tradeRecognized: source?.tradeRecognized === true ? true : undefined,
    tradeKey: String(source?.tradeKey || "").trim(),
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
    nextQuestionReason: String(source?.nextQuestionReason || "").trim(),
    activeFieldKey: String(source?.activeFieldKey || "").trim(),
    activeSectionKey: String(source?.activeSectionKey || "").trim(),
    lastAnsweredFieldKey: String(source?.lastAnsweredFieldKey || "").trim(),
    lastResolutionSource: String(source?.lastResolutionSource || "").trim(),
  });
}

function readPlannerStateFromPayload(payload) {
  const direct = normalizePlannerState(payload?.plannerState);
  if (Object.keys(direct).length) return direct;
  return normalizePlannerState(payload?.guidedMeta?.[GUIDED_PLANNER_META_KEY]);
}

function deriveNextQuestionReason(fieldKey, context = {}) {
  const key = String(fieldKey || "").trim();
  if (!key) return "review_handoff";
  if (key === "scopeNotes") {
    if (context.flooring) {
      if (!context.quantityBasisKnown) return "flooring_quantity";
      if (!context.demoKnown) return "flooring_demo";
      if (!context.transitionsKnown) return "flooring_transitions";
      if (!context.materialsPathKnown) return "materials_path";
      if (!context.prepKnown) return "flooring_prep";
    }
    if (context.drywallRepair) {
      if (!context.repairCountKnown) return "drywall_area_count";
      if (!context.patchVsReplaceKnown) return "drywall_repair_shape";
      if (!context.textureKnown) return "drywall_finish_level";
      if (!context.paintTouchupKnown) return "drywall_paint_scope";
    }
    if (context.stuccoRepair && !context.quantityBasisKnown) return "stucco_repair_extent";
    if (context.exteriorAccess && !context.accessSetupKnown) return "access_setup";
    if (!context.coverageKnown) return "scope_surfaces";
    if (!context.quantityBasisKnown) return "scope_quantity";
    if (context.commercialContext && !context.occupancyKnown) return context.warehouseContext ? "warehouse_access" : "commercial_access";
    if (!context.interiorExteriorKnown) return "scope_location_type";
    if (!context.coatsKnown || !context.colorKnown) return "scope_coat_color";
    if (!context.occupancyKnown) return "scope_occupancy";
    if (!context.prepKnown) return "scope_prep";
    if (!context.finishKnown) return "scope_finish";
  }
  if (key === "additionalNotes") {
    if (!context.exclusionsKnown) return "notes_exclusions";
    if (!context.scheduleKnown) return "notes_access";
    if (!context.suppliedMaterialsKnown) return "notes_material_responsibility";
    if (!context.furnitureKnown) return "notes_furniture";
  }
  return STEP_RUNNER_REASON_BY_FIELD[key] || "next_best_gap";
}

function deriveGuidedTurnDiagnosis(stepResolutionStatus = "", resolutionSource = "") {
  const status = String(stepResolutionStatus || "").trim();
  if (!status) return "";
  if (status === "fully_resolved") return "resolved";
  if (status === "partially_resolved") return "partial";
  if (status === "unresolved_clarified") return "unresolved_clarify";
  if (status === "invalid_for_prompt") {
    return resolutionSource === "ai" ? "escalated_to_groq" : "invalid_for_step";
  }
  if (status === "needs_interpretive_retry") {
    return resolutionSource === "ai" ? "escalated_to_groq" : "repeated_unresolved";
  }
  return status;
}

function buildStepRunnerState(response, requestMeta = {}, context = {}) {
  const nextBestQuestion = normalizeNextBestQuestion(
    response?.nextBestQuestion,
    response?.recommendedNextQuestion,
    response?.assistantMessage
  );
  const stepResolution = normalizeGuidedStepResolution(response?.stepResolution);
  const activeFieldKey = String(nextBestQuestion?.fieldKey || requestMeta?.questionKey || "").trim();
  const activeSectionKey = getCanonicalSectionForField(
    activeFieldKey,
    nextBestQuestion?.sectionKey || requestMeta?.sectionKey || ""
  );
  const prompt = String(nextBestQuestion?.question || response?.assistantMessage || "").trim();
  const activeStepContract = buildGuidedStepContract({
    ...requestMeta,
    questionKey: activeFieldKey,
    sectionKey: activeSectionKey,
    currentPrompt: prompt,
    activeStep: {
      ...(requestMeta?.activeStep || {}),
      fieldKey: activeFieldKey,
      sectionKey: activeSectionKey,
      promptText: prompt,
      suggestedChoices: normalizeSuggestedChoices(response?.suggestedChoices || nextBestQuestion?.suggestedChoices || []),
    },
    currentSuggestedChoices: normalizeSuggestedChoices(response?.suggestedChoices || nextBestQuestion?.suggestedChoices || []),
  }, activeFieldKey, activeSectionKey);
  const resolutionSource = String(requestMeta?.resolutionSource || response?.resolutionSource || "").trim() || "local";
  const plannerState = normalizePlannerState({
    ...(requestMeta?.plannerState || {}),
    tradeRecognized: context.tradeRecognized,
    tradeKey: context.tradeKey,
    painting: context.painting,
    flooring: context.flooring,
    drywallRepair: context.drywallRepair,
    commercialContext: context.commercialContext,
    exteriorAccess: context.exteriorAccess,
    stuccoRepair: context.stuccoRepair,
    scopeCaptured: context.tradeRecognized
      || context.coverageKnown
      || context.quantityBasisKnown
      || context.repairCountKnown
      || context.patchVsReplaceKnown
      || context.roomWork
      || isScopeIntentKind(context.intentKind),
    coverageKnown: context.coverageKnown,
    quantityBasisKnown: context.quantityBasisKnown,
    occupancyKnown: context.occupancyKnown,
    accessSetupKnown: context.accessSetupKnown,
    prepKnown: context.prepKnown,
    demoKnown: context.demoKnown,
    transitionsKnown: context.transitionsKnown,
    repairCountKnown: context.repairCountKnown,
    patchVsReplaceKnown: context.patchVsReplaceKnown,
    textureKnown: context.textureKnown,
    paintTouchupKnown: context.paintTouchupKnown,
    interiorExteriorKnown: context.interiorExteriorKnown,
    colorKnown: context.colorKnown,
    coatsKnown: context.coatsKnown,
    finishKnown: context.finishKnown,
    materialsAllowanceIntent: context.materialsAllowanceIntent,
    materialsPathKnown: context.materialsPathKnown,
    notesResolved: context.notesResolved,
    exclusionsKnown: context.exclusionsKnown,
    scheduleKnown: context.scheduleKnown,
    suppliedMaterialsKnown: context.suppliedMaterialsKnown,
    furnitureKnown: context.furnitureKnown,
    scopeReadyForNotes: context.scopeReadyForNotes,
    nextQuestionReason: deriveNextQuestionReason(activeFieldKey, context),
    activeFieldKey,
    activeSectionKey,
    lastAnsweredFieldKey: String(requestMeta?.questionKey || "").trim(),
    lastResolutionSource: resolutionSource,
  });

  return compactObject({
    activeStepId: String(activeStepContract?.canonicalStepId || (activeFieldKey ? `${activeSectionKey || "review"}:${activeFieldKey}` : "")).trim(),
    canonicalStepId: String(activeStepContract?.canonicalStepId || (activeFieldKey ? buildCanonicalGuidedStepId(activeSectionKey, activeFieldKey, getCanonicalGuidedBlockerFamily(activeFieldKey, activeStepContract?.promptIntent || "", prompt)) : "")).trim(),
    activeSectionKey,
    activeFieldKey,
    activePrompt: prompt,
    promptIntent: String(activeStepContract?.promptIntent || "").trim(),
    expectedAnswerMode: String(activeStepContract?.expectedAnswerMode || "").trim(),
    expectedComponents: normalizeGuidedStepComponents(activeStepContract?.expectedComponents),
    answeredComponents: normalizeGuidedStepComponents(stepResolution?.answeredComponents),
    missingComponents: normalizeGuidedStepComponents(stepResolution?.missingComponents),
    turnDiagnosis: deriveGuidedTurnDiagnosis(stepResolution?.status, resolutionSource),
    nextQuestionReason: deriveNextQuestionReason(activeFieldKey, context),
    resolutionSource,
    plannerState,
  });
}

function summarizePlannerStateForRequest(plannerState) {
  const planner = normalizePlannerState(plannerState);
  return Object.keys(planner).length ? planner : undefined;
}

function isCompletedGuidedField(field) {
  return String(field?.status || "").trim().toLowerCase() === "complete";
}

function summarizeGuidedField(field) {
  const summary = compactObject({
    key: String(field?.key || "").trim(),
    label: trimText(field?.label, 80),
    inputType: String(field?.inputType || "").trim(),
    valueType: String(field?.valueType || "").trim(),
    required: field?.required === true ? true : undefined,
    allowCustom: field?.allowCustom === true ? true : undefined,
    confirmationRequired: field?.confirmationRequired === true ? true : undefined,
    status: String(field?.status || "").trim(),
  });
  return summary.key ? summary : null;
}

function pickActiveFieldSubset(sectionPayload, questionKey) {
  const fields = asArray(sectionPayload?.activeFields);
  const picked = [];
  const seen = new Set();

  function push(field) {
    const key = String(field?.key || "").trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    picked.push(field);
  }

  if (questionKey) push(fields.find((field) => String(field?.key || "").trim() === questionKey));
  fields.filter((field) => !isCompletedGuidedField(field)).forEach(push);
  fields.forEach(push);

  return picked
    .slice(0, MAX_GUIDED_FIELD_SUBSET)
    .map(summarizeGuidedField)
    .filter(Boolean);
}

function buildActiveFieldValueSummary(fields, state, context) {
  return fields.reduce((acc, field) => {
    const key = String(field?.key || "").trim();
    if (!key) return acc;
    const summary = trimText(describeFieldValue(key, state, context), 120);
    if (summary) acc[key] = summary;
    return acc;
  }, {});
}

function shouldIncludeSelectedCustomer(sectionKey, questionKey, fields) {
  const keys = [questionKey, ...fields.map((field) => String(field?.key || "").trim())]
    .filter(Boolean);
  return sectionKey === "customer"
    || keys.includes("job.due")
    || keys.some((key) => key.startsWith("customer."));
}

function summarizeSelectedCustomer(context, sectionKey, questionKey, fields) {
  if (!shouldIncludeSelectedCustomer(sectionKey, questionKey, fields)) return null;
  const selectedCustomer = context?.selectedCustomer;
  if (!selectedCustomer) return null;
  return compactObject({
    id: String(selectedCustomer?.id || "").trim(),
    name: trimText(selectedCustomer?.displayName || selectedCustomer?.fullName || selectedCustomer?.companyName || selectedCustomer?.name, 80),
    type: String(selectedCustomer?.type || "").trim(),
    netTermsLabel: trimText(selectedCustomer?.netTermsLabel || selectedCustomer?.netTerms, 40),
    hasBillingAddress: selectedCustomer?.billingAddress ? true : undefined,
    hasProjectAddress: selectedCustomer?.projectAddress ? true : undefined,
  });
}

function summarizeRequestOptions(fieldKey, context) {
  if (!AI_OPTION_FIELDS.has(fieldKey)) return [];
  const options = asArray(getLiveOptionsForField(fieldKey, context));
  let limited = options;
  if (fieldKey === "customer.id") limited = limitChoices(options, 12);
  if (fieldKey === "tradeInsert.key") limited = limitChoices(options, 12);
  if (fieldKey === "labor.lines") limited = limitChoices(options, 8);
  return limited
    .map((option) => compactObject({
      value: option?.value,
      label: trimText(option?.label || option?.value, 80),
      description: trimText(option?.description, 120),
    }))
    .filter((option) => String(option?.label || option?.value || "").trim());
}

function buildAvailableOptionsMap(fields, context) {
  return fields.reduce((acc, field) => {
    const key = String(field?.key || "").trim();
    if (!key) return acc;
    const options = summarizeRequestOptions(key, context);
    if (options.length) acc[key] = options;
    return acc;
  }, {});
}

function summarizePriorGuidedAnswers(entries) {
  return asArray(entries)
    .slice(-MAX_PRIOR_GUIDED_ANSWERS)
    .map((entry) => compactObject({
      sectionKey: String(entry?.sectionKey || "").trim(),
      questionKey: String(entry?.questionKey || "").trim(),
      prompt: trimText(entry?.prompt, 140),
      answer: trimText(entry?.answer, 120),
    }))
    .filter((entry) => Object.keys(entry).length);
}

function buildUnresolvedFieldSummary(questionKey, fields) {
  const ordered = [
    questionKey,
    ...fields.filter((field) => !isCompletedGuidedField(field)).map((field) => field.key),
  ];
  return Array.from(new Set(ordered.map((value) => String(value || "").trim()).filter(Boolean))).slice(0, MAX_GUIDED_FIELD_SUBSET);
}

function summarizeSectionRules(section, questionPrompt) {
  return compactObject({
    key: String(section?.key || "").trim(),
    title: trimText(section?.title || section?.label, 80),
    questionPrompt: trimText(questionPrompt, 140),
    aiPromptFraming: trimText(section?.aiPromptFraming, 160),
    extractionRules: asArray(section?.extractionRules).map((rule) => trimText(rule, 120)).filter(Boolean).slice(0, 3),
    writebackRules: asArray(section?.writebackRules).map((rule) => trimText(rule, 120)).filter(Boolean).slice(0, 3),
  });
}

function buildGuidedEstimateContextSummary(state, context) {
  return compactObject({
    trade: trimText(
      describeFieldValue("tradeInsert.key", state, context)
        || state?.tradeInsert?.text
        || state?.tradeInsert?.key,
      80
    ),
    scope: trimText(normalizeGuidedPublishText("scopeNotes", state?.scopeNotes || ""), 180),
    materialsPath: trimText(describeFieldValue("ui.materialsMode", state, context), 80),
    notes: trimText(normalizeGuidedPublishText("additionalNotes", state?.additionalNotes || ""), 180),
  });
}

function fuzzyMatchOption(options, value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return null;
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const label = String(option?.label || "").trim().toLowerCase();
    const optionValue = String(option?.value ?? "").trim().toLowerCase();
    if (!label && !optionValue) continue;
    if (raw === label || raw === optionValue) return option;
  }
  for (let index = 0; index < options.length; index += 1) {
    const option = options[index];
    const label = String(option?.label || "").trim().toLowerCase();
    const optionValue = String(option?.value ?? "").trim().toLowerCase();
    if (label.includes(raw) || raw.includes(label) || optionValue.includes(raw) || raw.includes(optionValue)) {
      return option;
    }
  }
  return null;
}

function parseSimpleDate(answer) {
  const raw = String(answer || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(raw);
  if (mdy) {
    return `${mdy[3]}-${String(mdy[1]).padStart(2, "0")}-${String(mdy[2]).padStart(2, "0")}`;
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return "";
  const next = new Date(parsed);
  if (Number.isNaN(next.getTime())) return "";
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
}

function parsePercent(answer) {
  const raw = String(answer || "").replace(/[^\d.]/g, "");
  if (!raw) return "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

function parseMoney(answer) {
  const raw = String(answer || "").replace(/[^\d.]/g, "");
  if (!raw) return "";
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? String(parsed) : "";
}

function parseBoolean(answer) {
  const raw = String(answer || "").trim().toLowerCase();
  if (["yes", "y", "true", "same", "same as customer", "customer", "use customer", "1"].includes(raw)) return true;
  if (["no", "n", "false", "different", "custom", "manual", "separate", "0"].includes(raw)) return false;
  return null;
}

function parseAddress(answer) {
  const raw = String(answer || "").trim();
  if (!raw) return null;
  const segments = raw.split(",").map((part) => String(part || "").trim()).filter(Boolean);
  if (segments.length < 3) return null;
  const street = segments[0];
  const city = segments[1];
  const stateZip = segments[2];
  const stateZipMatch = /^([A-Za-z]{2}|[A-Za-z ]+)\s+(\d{5}(?:-\d{4})?)$/.exec(stateZip);
  if (!stateZipMatch) return null;
  return {
    street,
    city,
    state: String(stateZipMatch[1] || "").trim(),
    zip: String(stateZipMatch[2] || "").trim(),
    line2: segments.length > 3 ? segments.slice(3).join(", ") : "",
  };
}

function parseJobContext(answer) {
  const text = String(answer || "").trim();
  if (!text) return [];
  const extracted = [];

  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})\b/);
  if (dateMatch) {
    const iso = parseSimpleDate(dateMatch[1]);
    if (iso) extracted.push({ key: "job.date", value: iso, confidence: 0.88 });
  }

  const poMatch = text.match(/\bpo(?:\s*#|\s+number|\s+num|\s+)?[:\-]?\s*([A-Za-z0-9-]+)/i);
  if (poMatch) {
    extracted.push({ key: "job.poNumber", value: poMatch[1], confidence: 0.86 });
  }

  const projectNameMatch = text.match(/\bproject(?:\s+name)?[:\-]?\s*([^,;\n]+)/i);
  if (projectNameMatch) {
    extracted.push({ key: "customer.projectName", value: projectNameMatch[1], confidence: 0.8 });
  }

  const explicitProjectSame = parseBoolean(text);
  if (explicitProjectSame !== null && /same as customer|different|separate/i.test(text)) {
    extracted.push({ key: "customer.projectSameAsCustomer", value: explicitProjectSame, confidence: 0.9 });
  }

  const address = parseAddress(text);
  if (address) {
    extracted.push({ key: "customer.projectSameAsCustomer", value: false, confidence: 0.92 });
    extracted.push({ key: "customer.projectAddress", value: address.street, confidence: 0.9 });
    extracted.push({ key: "customer.city", value: address.city, confidence: 0.88 });
    extracted.push({ key: "customer.state", value: address.state, confidence: 0.88 });
    extracted.push({ key: "customer.zip", value: address.zip, confidence: 0.88 });
    if (address.line2) extracted.push({ key: "job.location", value: address.line2, confidence: 0.75 });
  }

  return extracted;
}

function splitCollectionSegments(answer) {
  return String(answer || "")
    .split(/\n|;/)
    .map((segment) => String(segment || "").trim())
    .filter(Boolean);
}

function parseLaborLines(answer) {
  return splitCollectionSegments(answer)
    .map((segment) => {
      const qtyMatch = segment.match(/\b(\d+)\s*x?\s*(foreman|journeyman|apprentice|laborer|helper|supervisor|technician|operator|general laborer|equipment operator)\b/i);
      const roleMatch = segment.match(/\b(foreman|journeyman|apprentice|laborer|helper|supervisor|technician|operator|general laborer|equipment operator)\b/i);
      const hoursMatch = segment.match(/\b(\d+(?:\.\d+)?)\s*(?:hours|hrs|hr)\b/i);
      const rateMatch = segment.match(/(?:\$|rate\s*)(\d+(?:\.\d+)?)/i);
      const markupMatch = segment.match(/markup\s*(\d+(?:\.\d+)?)%?/i);
      const internalMatch = segment.match(/(?:internal|true)\s*(?:rate)?\s*(\d+(?:\.\d+)?)/i);
      if (!roleMatch && !hoursMatch && !rateMatch) return null;
      return {
        qty: qtyMatch ? qtyMatch[1] : "1",
        role: roleMatch ? roleMatch[1] : "",
        label: roleMatch ? roleMatch[1] : "",
        hours: hoursMatch ? hoursMatch[1] : "",
        rate: rateMatch ? rateMatch[1] : "",
        markupPct: markupMatch ? markupMatch[1] : "",
        trueRateInternal: internalMatch ? internalMatch[1] : "",
      };
    })
    .filter(Boolean);
}

function parseMaterialLines(answer) {
  return splitCollectionSegments(answer)
    .map((segment) => {
      const qtyAtPrice = segment.match(/(.+?)\s+(\d+)\s*(?:x|@)\s*\$?(\d+(?:\.\d+)?)/i);
      const internalMatch = segment.match(/internal\s*(\d+(?:\.\d+)?)/i);
      if (!qtyAtPrice) return null;
      return {
        desc: String(qtyAtPrice[1] || "").trim(),
        qty: qtyAtPrice[2],
        priceEach: qtyAtPrice[3],
        unitCostInternal: internalMatch ? internalMatch[1] : "",
      };
    })
    .filter(Boolean);
}

function detectTradeInsert(answer) {
  const lower = normalizeLooseGuidedText(answer);
  if (!lower) return null;

  const scored = scoreGuidedTradeSignals(lower)
    .filter((entry) => Number(entry?.score || 0) > 0)
    .sort((left, right) => Number(right?.score || 0) - Number(left?.score || 0));
  const best = scored[0];
  if (best?.value && Number(best?.score || 0) >= 2) {
    return TRADE_INSERT_OPTIONS.find((option) => String(option?.value || "").trim() === String(best.value).trim()) || null;
  }

  return TRADE_INSERT_OPTIONS.find((option) => lower.includes(String(option.label || "").toLowerCase()) || lower.includes(String(option.value || "").toLowerCase())) || null;
}

function inferTradeWriteFromAnswer(answer, existingTradeKey = "") {
  const trade = detectTradeInsert(answer);
  if (!trade) return null;
  if (String(existingTradeKey || "").trim() === String(trade.value || "").trim()) return null;
  const confidence = isLikelyRichScopeAnswer(answer) ? 0.9 : 0.84;
  if (confidence < 0.86) return null;
  return {
    key: "tradeInsert.key",
    value: trade.value,
    confidence,
    source: "user_input_scope_inference",
  };
}

function buildPromptForField(fieldKey, payload) {
  const mode = payload?.mode === "invoice" ? "invoice" : "estimate";
  switch (fieldKey) {
    case "customer.id":
      return "Which saved customer is this for?";
    case "job.date":
      return `What ${mode === "invoice" ? "invoice" : "estimate"} date should I use?`;
    case "customer.projectSameAsCustomer":
      return "Is the jobsite the same as the customer address, or do I need a separate project location?";
    case "customer.projectAddress":
      return "What jobsite address should I use? One full address line is enough.";
    case "scopeNotes":
      return buildAtomicScopePrompt(payload);
    case "tradeInsert.key":
      return "What kind of job is this?";
    case "labor.lines":
      return "About what crew should I carry for this job? Example: `2 journeymen 8 hours at 65; 1 foreman 4 hours at 95`.";
    case "ui.materialsMode":
      return "Do you want me to carry materials as one allowance or as itemized lines?";
    case "materials.blanketCost":
      return "What materials allowance should I carry?";
    case "materials.blanketInternalCost":
      return "If you track true cost, what internal materials cost should I store?";
    case "materials.markupPct":
      return "What markup should I apply to blanket materials?";
    case "materials.materialsBlanketDescription":
      return "What materials description should print on the estimate?";
    case "materials.items":
      return "What materials should I list? Example: `Paint 10 @ 45; Primer 4 @ 28`.";
    case "labor.hazardPct":
      return "Do you want any hazard or site-condition percentage on labor?";
    case "labor.riskPct":
      return "Do you want any risk or uncertainty percentage on labor?";
    case "labor.multiplier":
      return "Any labor difficulty multiplier to use? If not, keep it at 1.0.";
    case "additionalNotes":
      return "Any prep, repairs, access issues, exclusions, or customer responsibilities I should call out?";
    default: {
      const field = getGuidedField(fieldKey);
      return field?.label ? `What should I carry for ${String(field.label).toLowerCase()}?` : "What should I price next?";
    }
  }
}

function buildChoiceSet(fieldKey, payload) {
  const options = getLiveOptionsForField(fieldKey, payload?.context || {});
  if (!options.length) return [];
  if (fieldKey === "customer.id") return limitChoices(options, 8).map((option) => ({ ...option, fieldKey }));
  if (fieldKey === "customer.state") return limitChoices(options, 8).map((option) => ({ ...option, fieldKey }));
  if (fieldKey === "materials.markupPct") {
    const preferred = ["0", String(payload?.context?.globalDefaultMarkupPct || "0"), "10", "15", "20", "25", "30"];
    const seen = new Set();
    return preferred
      .map((value) => options.find((option) => String(option.value) === String(value)))
      .filter(Boolean)
      .filter((option) => {
        const key = String(option.value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .map((option) => ({ ...option, fieldKey }));
  }
  return limitChoices(options, 6).map((option) => ({ ...option, fieldKey }));
}

function extractFallbackWrites(payload, target, userAnswer) {
  const answer = String(userAnswer || "").trim();
  if (!answer) return [];

  const fieldKey = target?.questionKey || "";
  if (!fieldKey) return [];

  switch (fieldKey) {
    case "customer.id": {
      const options = getLiveOptionsForField("customer.id", payload?.context || {});
      const exact = fuzzyMatchOption(options, answer);
      return exact ? [{ key: "customer.id", value: exact.value, confidence: 0.94, source: "user_input" }] : [];
    }
    case "job.date": {
      const date = parseSimpleDate(answer);
      return date ? [{ key: "job.date", value: date, confidence: 0.9, source: "user_input" }] : [];
    }
    case "job.due": {
      const date = parseSimpleDate(answer);
      return date ? [{ key: "job.due", value: date, confidence: 0.82, source: "user_input" }] : [];
    }
    case "customer.projectSameAsCustomer": {
      const boolValue = parseBoolean(answer);
      return boolValue === null ? [] : [{ key: "customer.projectSameAsCustomer", value: boolValue, confidence: 0.92, source: "user_input" }];
    }
    case "customer.projectAddress": {
      const parsed = parseAddress(answer);
      if (parsed) {
        return [
          { key: "customer.projectSameAsCustomer", value: false, confidence: 0.95, source: "user_input" },
          { key: "customer.projectAddress", value: parsed.street, confidence: 0.9, source: "user_input" },
          { key: "customer.city", value: parsed.city, confidence: 0.88, source: "user_input" },
          { key: "customer.state", value: parsed.state, confidence: 0.88, source: "user_input" },
          { key: "customer.zip", value: parsed.zip, confidence: 0.88, source: "user_input" },
        ];
      }
      return [{ key: "customer.projectAddress", value: answer, confidence: 0.74, source: "user_input" }];
    }
    case "customer.state": {
      const options = getLiveOptionsForField("customer.state", payload?.context || {});
      const exact = fuzzyMatchOption(options, answer);
      return exact ? [{ key: "customer.state", value: exact.value, confidence: 0.92, source: "user_input" }] : [];
    }
    case "scopeNotes": {
      const scopeWrite = buildScopeWriteFromAnswer(answer, payload?.state?.scopeNotes, payload?.state?.tradeInsert?.key);
      const inferredTrade = inferTradeWriteFromAnswer(answer, payload?.state?.tradeInsert?.key);
      return [scopeWrite, inferredTrade].filter(Boolean);
    }
    case "tradeInsert.key": {
      const options = getLiveOptionsForField("tradeInsert.key", payload?.context || {});
      const exact = exactMatchOption(options, answer);
      if (exact) return [{ key: "tradeInsert.key", value: exact.value, confidence: 0.9, source: "user_input" }];
      const inferredTrade = inferTradeWriteFromAnswer(answer, payload?.state?.tradeInsert?.key);
      return inferredTrade ? [inferredTrade] : [];
    }
    case "labor.lines": {
      const lines = parseLaborLines(answer);
      return lines.length ? [{ key: "labor.lines", value: lines, confidence: 0.8, source: "user_input" }] : [];
    }
    case "ui.materialsMode": {
      const exact = fuzzyMatchOption(MATERIALS_MODE_OPTIONS, answer);
      if (exact) {
        return [{ key: "ui.materialsMode", value: exact.value, confidence: 0.95, source: "user_input" }];
      }
      const parsedMode = parseGuidedMaterialsModeIntent(answer);
      return parsedMode
        ? [{ key: "ui.materialsMode", value: parsedMode, confidence: 0.92, source: "user_input" }]
        : [];
    }
    case "materials.blanketCost":
      return parseMoney(answer) ? [{ key: "materials.blanketCost", value: parseMoney(answer), confidence: 0.9, source: "user_input" }] : [];
    case "materials.blanketInternalCost":
      return parseMoney(answer) ? [{ key: "materials.blanketInternalCost", value: parseMoney(answer), confidence: 0.82, source: "user_input" }] : [];
    case "materials.markupPct":
      return parsePercent(answer) ? [{ key: "materials.markupPct", value: parsePercent(answer), confidence: 0.84, source: "user_input" }] : [];
    case "materials.materialsBlanketDescription":
      return [{ key: "materials.materialsBlanketDescription", value: answer, confidence: 0.86, source: "user_input" }];
    case "materials.items": {
      const items = parseMaterialLines(answer);
      return items.length ? [{ key: "materials.items", value: items, confidence: 0.78, source: "user_input" }] : [];
    }
    case "labor.hazardPct":
      return parsePercent(answer) ? [{ key: "labor.hazardPct", value: parsePercent(answer), confidence: 0.8, source: "user_input" }] : [];
    case "labor.riskPct":
      return parsePercent(answer) ? [{ key: "labor.riskPct", value: parsePercent(answer), confidence: 0.8, source: "user_input" }] : [];
    case "labor.multiplier":
      return parsePercent(answer) ? [{ key: "labor.multiplier", value: parsePercent(answer), confidence: 0.72, source: "user_input" }] : [];
    case "additionalNotes":
      return looksLikeFinalGuidedNote(answer)
        ? [{ key: "additionalNotes", value: answer, confidence: 0.9, source: "user_input_explicit" }]
        : [];
    default:
      return parseJobContext(answer);
  }
}

function buildResolvedNegativeAdvanceTarget(payload, localTurn) {
  const negativeResolution = localTurn?.negativeResolution;
  if (!negativeResolution?.resolved) return null;
  if (String(localTurn?.questionKey || "").trim() !== "additionalNotes") return null;
  const guidedMetaWithPlanner = {
    ...(payload?.guidedMeta || {}),
    [GUIDED_PLANNER_META_KEY]: normalizePlannerState({
      ...readPlannerStateFromPayload(payload),
      ...(negativeResolution?.markers || {}),
      lastAnsweredFieldKey: String(localTurn?.questionKey || "").trim(),
      lastResolutionSource: "local",
    }),
  };
  const preferredSection = localTurn?.target?.sectionKey || payload?.sectionKey || "";
  let target = chooseNextGuidedTarget({
    mode: payload?.mode,
    state: payload?.state,
    guidedMeta: guidedMetaWithPlanner,
    preferredSection,
    context: payload?.context,
  });
  if (
    String(target?.sectionKey || "").trim() === String(preferredSection).trim()
    && String(target?.questionKey || "").trim() === String(localTurn?.questionKey || "").trim()
  ) {
    target = chooseNextGuidedTarget({
      mode: payload?.mode,
      state: payload?.state,
      guidedMeta: guidedMetaWithPlanner,
      preferredSection: "review",
      context: payload?.context,
    });
  }
  if (!target?.questionKey) return null;
  return target;
}

function buildFallbackMessage(payload, target, writes) {
  if (writes.length) {
    return `Got it. I’ve carried ${writes.length === 1 ? "that detail" : "those details"} forward.`;
  }
  return buildPromptForField(target?.questionKey, payload);
}

function buildLocalGuidedTurn(payload) {
  const computedTarget = chooseNextGuidedTarget({
    mode: payload?.mode,
    state: payload?.state,
    guidedMeta: payload?.guidedMeta,
    preferredSection: payload?.sectionKey,
    context: payload?.context,
  });
  const target = {
    ...computedTarget,
    sectionKey: String(payload?.sectionKey || computedTarget?.sectionKey || "").trim() || computedTarget?.sectionKey || "customer",
    questionKey: String(payload?.questionKey || computedTarget?.questionKey || "").trim() || computedTarget?.questionKey || "",
  };

  const writes = extractFallbackWrites(payload, target, payload?.userAnswer);
  const questionKey = target?.questionKey || "";
  const negativeResolution = resolveGuidedNegativeAnswer({
    sectionKey: target?.sectionKey || payload?.sectionKey,
    questionKey,
    promptText: payload?.currentPrompt,
    answer: payload?.userAnswer,
  });
  const activeStepResolution = resolveGuidedActiveStepAnswer(payload, target, writes);
  return {
    target,
    writes,
    questionKey,
    negativeResolution,
    activeStepContract: activeStepResolution.contract,
    stepResolution: activeStepResolution.stepResolution,
    narrowedFollowUp: activeStepResolution.narrowedFollowUp,
    unresolvedFields: questionKey ? [questionKey] : [],
  };
}

function looksMessyGuidedNotes(answer) {
  const text = String(answer || "").trim();
  if (!text) return false;
  const commaCount = (text.match(/,/g) || []).length;
  return text.length > 180 || /\n|;/.test(text) || commaCount >= 3;
}

function shouldUseGuidedBuildAI(payload, localTurn) {
  const answer = String(payload?.userAnswer || "").trim();
  const questionKey = String(localTurn?.questionKey || "").trim();
  if (!answer || !questionKey || String(payload?.sectionKey || "").trim() === "review") return false;
  if (localTurn?.negativeResolution?.resolved) return false;
  const stepResolution = normalizeGuidedStepResolution(localTurn?.stepResolution);
  const activeStepContract = localTurn?.activeStepContract || buildGuidedStepContract(payload, questionKey, localTurn?.target?.sectionKey || payload?.sectionKey || "");
  const stepPromptIntent = String(activeStepContract?.promptIntent || "").trim();
  const promptIsSpecific = !!stepPromptIntent && !["generic", "scope_clarification", "trade_definition"].includes(stepPromptIntent);
  const repeatedUnresolvedCount = Number(
    activeStepContract?.repeatedUnresolvedCount || payload?.turnState?.repeatedUnresolvedCount || 0
  ) || 0;
  const context = deriveGuidedContext(
    {},
    payload,
    null,
    asArray(localTurn?.writes),
    normalizeNextBestQuestion(localTurn?.narrowedFollowUp, questionKey, localTurn?.narrowedFollowUp?.question)
  );
  const narrowedQuestion = normalizeNextBestQuestion(
    localTurn?.narrowedFollowUp,
    questionKey,
    localTurn?.narrowedFollowUp?.question
  );
  const localClarificationIsWeak = !narrowedQuestion?.question
    || isWeakGuidedQuestion(narrowedQuestion.question, context, narrowedQuestion.fieldKey || questionKey)
    || isWeakGuidedClarificationQuestion(narrowedQuestion.question);
  const shouldForceInterpretiveScopePass = (() => {
    if (!["scopeNotes", "tradeInsert.key"].includes(questionKey)) return false;
    if (!isLikelyRichScopeAnswer(answer)) return false;
    if (promptIsSpecific) return false;
    const text = normalizeLooseGuidedText(answer);
    const writes = asArray(localTurn?.writes);
    const hasScopeWrite = writes.some((entry) => String(entry?.key || "").trim() === "scopeNotes");
    const onlyTradeInference = writes.length > 0 && writes.every((entry) => String(entry?.key || "").trim() === "tradeInsert.key");
    const richSignalCount = [
      guidedTextHasFlooringSignal(text),
      guidedTextHasDrywallSignal(text),
      guidedTextHasCommercialSignal(text),
      guidedTextHasExteriorAccessSignal(text),
      guidedTextHasQuantitySignal(text),
      guidedTextHasAllowanceSignal(text),
      /\bpatch(?:ing|es)?\b|\brepair(?:s|ing)?\b/.test(text),
    ].filter(Boolean).length;
    return !hasScopeWrite || onlyTradeInference || richSignalCount >= 2;
  })();
  if (stepResolution?.status === "needs_interpretive_retry") return true;
  if (GUIDED_UNRESOLVED_STEP_STATUSES.has(stepResolution?.status || "") && repeatedUnresolvedCount > 0 && localClarificationIsWeak) {
    return true;
  }
  if (promptIsSpecific && ["fully_resolved", "partially_resolved", "unresolved_clarified"].includes(stepResolution?.status || "")) {
    return false;
  }
  if (promptIsSpecific && stepResolution?.status === "invalid_for_prompt") {
    return repeatedUnresolvedCount > 0 || localClarificationIsWeak;
  }
  if (asArray(localTurn?.writes).length) {
    const lowestConfidence = Math.min(...asArray(localTurn.writes).map((entry) => Number(entry?.confidence || 0)));
    if (!shouldForceInterpretiveScopePass && Number.isFinite(lowestConfidence) && lowestConfidence >= 0.86) return false;
  }
  if (!GUIDED_INTERPRETIVE_FIELDS.has(questionKey)) return false;

  if (questionKey === "tradeInsert.key") {
    const options = getLiveOptionsForField(questionKey, payload?.context || {});
    if (shouldForceInterpretiveScopePass || isLikelyRichScopeAnswer(answer)) return true;
    return !exactMatchOption(options, answer);
  }
  if (questionKey === "labor.lines") return !parseLaborLines(answer).length;
  if (questionKey === "materials.items") return !parseMaterialLines(answer).length;
  if (questionKey === "additionalNotes") {
    if (looksMessyGuidedNotes(answer)) return true;
    return !looksLikeFinalGuidedNote(answer);
  }
  if (stepResolution?.status === "invalid_for_prompt") {
    return repeatedUnresolvedCount > 0 || shouldForceInterpretiveScopePass || localClarificationIsWeak;
  }
  if (stepResolution?.status === "unresolved_clarified" && repeatedUnresolvedCount > 0) {
    return true;
  }

  return true;
}

function buildLocalGuidedResponse(payload, options = {}) {
  const localTurn = options?.localTurn || buildLocalGuidedTurn(payload);
  const {
    target,
    writes,
    questionKey,
    unresolvedFields,
    negativeResolution,
    activeStepContract,
    stepResolution,
    narrowedFollowUp,
  } = localTurn;
  const deterministic = options?.deterministic === true;
  const normalizedStepResolution = negativeResolution?.resolved
    ? normalizeGuidedStepResolution({
      status: "fully_resolved",
      answeredComponents: activeStepContract?.expectedComponents || [],
      missingComponents: [],
      markers: {
        ...(stepResolution?.markers || {}),
        ...(negativeResolution?.markers || {}),
      },
    })
    : normalizeGuidedStepResolution(stepResolution);
  const advancedTarget = buildResolvedNegativeAdvanceTarget(payload, localTurn);
  const followUpQuestion = advancedTarget?.questionKey
    ? buildPromptForField(advancedTarget.questionKey, {
      ...payload,
      sectionKey: advancedTarget.sectionKey,
      questionKey: advancedTarget.questionKey,
    })
    : "";
  const narrowedPrompt = narrowedFollowUp?.question
    ? normalizeNextBestQuestion(narrowedFollowUp, narrowedFollowUp.fieldKey, narrowedFollowUp.question)
    : null;
  const responseIsNarrowed = ["partially_resolved", "unresolved_clarified", "invalid_for_prompt", "needs_interpretive_retry"]
    .includes(normalizedStepResolution?.status || "")
    && !!narrowedPrompt?.question;
  const resolvedWithoutWrites = !negativeResolution?.resolved
    && !writes.length
    && normalizedStepResolution?.status === "fully_resolved";
  const suggestedChoices = negativeResolution?.resolved && advancedTarget?.questionKey
    ? buildChoiceSet(advancedTarget.questionKey, {
      ...payload,
      sectionKey: advancedTarget.sectionKey,
      questionKey: advancedTarget.questionKey,
    })
    : (responseIsNarrowed
      ? dedupeGuidedChoices(narrowedFollowUp?.suggestedChoices || activeStepContract?.suggestedChoices || [], 3)
      : (writes.length ? [] : buildChoiceSet(questionKey, payload)));
  const nextFieldKey = negativeResolution?.resolved
    ? (advancedTarget?.questionKey || questionKey)
    : (responseIsNarrowed ? (narrowedPrompt?.fieldKey || questionKey) : questionKey);
  const nextSectionKey = negativeResolution?.resolved
    ? (advancedTarget?.sectionKey || target?.sectionKey || "review")
    : (responseIsNarrowed ? (narrowedPrompt?.sectionKey || target?.sectionKey || "review") : (target?.sectionKey || "review"));
  const responseMessage = negativeResolution?.resolved
    ? (followUpQuestion || negativeResolution.normalizedMeaning || buildFallbackMessage(payload, target, writes))
    : responseIsNarrowed
      ? narrowedPrompt.question
      : resolvedWithoutWrites
        ? ""
    : (writes.length && deterministic
      ? `Saved ${writes.length === 1 ? "that detail" : "those details"}.`
      : buildFallbackMessage(payload, target, writes));

  return normalizeGuidedResponse({
    assistantMessage: responseMessage,
    suggestedChoices,
    extractedFieldValues: writes,
    proposedFieldWrites: writes,
    confidenceByField: writes.reduce((acc, item) => {
      acc[item.key] = Number(item.confidence || 0);
      return acc;
    }, {}),
    fieldsNeedingConfirmation: [],
    unresolvedFields: negativeResolution?.resolved
      ? (nextFieldKey ? [nextFieldKey] : [])
      : (responseIsNarrowed ? [nextFieldKey] : (resolvedWithoutWrites ? [] : unresolvedFields)),
    recommendedNextSection: responseIsNarrowed || negativeResolution?.resolved ? nextSectionKey : "",
    recommendedNextQuestion: responseIsNarrowed || negativeResolution?.resolved ? nextFieldKey : "",
    nextBestQuestion: negativeResolution?.resolved
      ? {
        fieldKey: nextFieldKey,
        sectionKey: nextSectionKey,
        question: followUpQuestion || buildPromptForField(nextFieldKey, {
          ...payload,
          sectionKey: nextSectionKey,
          questionKey: nextFieldKey,
        }),
      }
      : (responseIsNarrowed ? narrowedPrompt : null),
    interpretedIntent: {
      kind: negativeResolution?.kind
        || (normalizedStepResolution?.status ? `active_step_${normalizedStepResolution.status}` : (writes.length ? "deterministic_field_capture" : `${questionKey || "guided"}_follow_up`)),
      summary: negativeResolution?.normalizedMeaning || "",
      targetField: questionKey,
    },
    shouldAutoApply: writes.length > 0,
    shouldAskFollowUp: negativeResolution?.resolved || responseIsNarrowed || resolvedWithoutWrites || writes.length === 0,
    stepResolution: normalizedStepResolution,
    reasoningTags: [
      `${deterministic ? "deterministic" : "fallback"}:${target?.sectionKey || "review"}`,
      questionKey ? `field:${questionKey}` : "",
      normalizedStepResolution?.status ? `turn:${normalizedStepResolution.status}` : "",
      ...asArray(negativeResolution?.tags),
    ].filter(Boolean),
    warnings: [],
  }, {}, {
    mode: payload?.mode,
    state: payload?.state,
    context: payload?.context,
    guidedMeta: payload?.guidedMeta,
    questionKey,
    sectionKey: target?.sectionKey,
    currentPrompt: payload?.currentPrompt,
    activeStep: activeStepContract,
    currentSuggestedChoices: activeStepContract?.suggestedChoices || payload?.currentSuggestedChoices,
    userAnswer: payload?.userAnswer,
    priorGuidedAnswers: payload?.answeredPrompts,
    plannerState: readPlannerStateFromPayload(payload),
    turnState: payload?.turnState,
    resolutionSource: deterministic ? "local" : "fallback",
  });
}

export function buildGuidedBuildRequest(payload) {
  const mode = payload?.mode === "invoice" ? "invoice" : "estimate";
  const context = payload?.context || {};
  const sectionKey = String(payload?.sectionKey || "").trim();
  const questionKey = String(payload?.questionKey || "").trim();
  const plannerState = readPlannerStateFromPayload(payload);
  const activeStep = buildGuidedStepContract(payload, questionKey, sectionKey);
  const activeBlocker = buildGuidedActiveBlockerPayload(payload, activeStep);
  const sectionPayload = buildSectionPayload({
    mode,
    state: payload?.state,
    sectionKey,
    guidedMeta: payload?.guidedMeta,
    context,
  });
  const activeFields = pickActiveFieldSubset(sectionPayload, questionKey);
  const currentFieldValues = buildActiveFieldValueSummary(activeFields, payload?.state, context);
  const questionPrompt = buildPromptForField(questionKey, payload);

  return compactObject({
    mode,
    sectionKey: sectionPayload?.section?.key || sectionKey || "customer",
    questionKey,
    currentPrompt: trimText(payload?.currentPrompt, 180),
    userAnswer: String(payload?.userAnswer || "").trim(),
    fieldRegistryMetadata: activeFields,
    sectionRules: summarizeSectionRules(sectionPayload?.section, questionPrompt),
    formSnapshot: Object.keys(currentFieldValues).length ? { currentFieldValues } : undefined,
    selectedCustomer: summarizeSelectedCustomer(context, sectionPayload?.section?.key || sectionKey, questionKey, activeFields),
    availableOptionsByField: buildAvailableOptionsMap(activeFields, context),
    priorGuidedAnswers: summarizePriorGuidedAnswers(payload?.answeredPrompts),
    unresolvedFields: buildUnresolvedFieldSummary(questionKey, activeFields),
    plannerState: summarizePlannerStateForRequest(plannerState),
    activeStep,
    activeBlocker,
    turnState: compactObject({
      repeatedUnresolvedCount: Number(payload?.turnState?.repeatedUnresolvedCount || 0) || undefined,
      turnDiagnosis: String(payload?.turnState?.turnDiagnosis || "").trim(),
    }),
    estimateContext: buildGuidedEstimateContextSummary(payload?.state, context),
  });
}

export function previewGuidedBuildTurn(payload) {
  const requestBody = buildGuidedBuildRequest(payload);
  const localPayload = {
    ...payload,
    sectionKey: requestBody.sectionKey,
    questionKey: requestBody.questionKey,
    activeStep: requestBody?.activeStep || payload?.activeStep,
    currentSuggestedChoices: requestBody?.activeStep?.suggestedChoices || payload?.currentSuggestedChoices || [],
    turnState: requestBody?.turnState || payload?.turnState,
  };
  const localTurn = buildLocalGuidedTurn(localPayload);
  const fallback = buildLocalGuidedResponse(localPayload, { localTurn });
  const deterministicResponse = buildLocalGuidedResponse(localPayload, { localTurn, deterministic: true });
  return {
    requestBody,
    localPayload,
    localTurn,
    fallback,
    deterministicResponse,
    requiresAI: shouldUseGuidedBuildAI(localPayload, localTurn),
    requestKey: [
      String(requestBody.sectionKey || "").trim(),
      String(requestBody.questionKey || "").trim(),
      normalizeGuidedRequestAnswer(requestBody?.activeStep?.promptText || requestBody?.currentPrompt || ""),
      String(requestBody?.activeStep?.promptIntent || "").trim(),
      String(requestBody?.turnState?.repeatedUnresolvedCount || 0),
      normalizeGuidedRequestAnswer(localPayload?.userAnswer),
    ].join("::"),
  };
}

export async function requestGuidedBuildTurn(payload, preview = null) {
  const prepared = preview || previewGuidedBuildTurn(payload);

  if (!prepared.requiresAI) {
    return prepared.deterministicResponse;
  }

  try {
    const fetchPromise = fetch("/api/guided-build", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(await getSessionAuthorizationHeader()) },
      body: JSON.stringify(prepared.requestBody),
    }).then(async (response) => {
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(detail || `guided-build failed (${response.status})`);
      }
      return response.json();
    });

    const raw = await Promise.race([fetchPromise, timeoutPromise(REQUEST_TIMEOUT_MS)]);
    return normalizeGuidedResponse(raw, prepared.fallback, {
      mode: payload?.mode,
      state: payload?.state,
      context: payload?.context,
      guidedMeta: payload?.guidedMeta,
      sectionKey: prepared.localPayload?.sectionKey,
      currentPrompt: prepared.requestBody?.currentPrompt,
      questionKey: prepared.localPayload?.questionKey,
      userAnswer: prepared.localPayload?.userAnswer,
      activeStep: prepared.requestBody?.activeStep,
      currentSuggestedChoices: prepared.requestBody?.activeStep?.suggestedChoices,
      priorGuidedAnswers: prepared.requestBody?.priorGuidedAnswers,
      plannerState: prepared.requestBody?.plannerState,
      turnState: prepared.requestBody?.turnState,
      resolutionSource: "ai",
    });
  } catch (error) {
    return normalizeGuidedResponse({
      ...prepared.fallback,
      warnings: ["AI assist is unavailable right now. I’ll keep guiding with local logic."],
    }, prepared.fallback, {
      mode: payload?.mode,
      state: payload?.state,
      context: payload?.context,
      guidedMeta: payload?.guidedMeta,
      sectionKey: prepared.localPayload?.sectionKey,
      currentPrompt: prepared.requestBody?.currentPrompt,
      questionKey: prepared.localPayload?.questionKey,
      userAnswer: prepared.localPayload?.userAnswer,
      activeStep: prepared.requestBody?.activeStep,
      currentSuggestedChoices: prepared.requestBody?.activeStep?.suggestedChoices,
      priorGuidedAnswers: prepared.requestBody?.priorGuidedAnswers,
      plannerState: prepared.requestBody?.plannerState,
      turnState: prepared.requestBody?.turnState,
      resolutionSource: "fallback",
    });
  }
}
