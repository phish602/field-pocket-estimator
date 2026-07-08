// @ts-nocheck
/* eslint-disable */

const MAX_EVENTS = 5000;
const MAX_SEQUENCE_LENGTH = 6;
const MAX_SESSIONS = 500;
const MIN_HINT_EVENTS = 3;
const SEQUENCE_GAP_MS = 5 * 60 * 1000;

// ── Workflow classifications ───────────────────────────────────────────────────
const WORKFLOW_CLASS_INVOICE_FLOW         = "invoice_flow";
const WORKFLOW_CLASS_FULL_ESTIMATE        = "full_estimate_flow";
const WORKFLOW_CLASS_SCOPE_LABOR_SAVE     = "scope_labor_save";
const WORKFLOW_CLASS_SCOPE_MATERIALS_SAVE = "scope_materials_save";
const WORKFLOW_CLASS_SCOPE_TO_SAVE        = "scope_to_save";
const WORKFLOW_CLASS_SCOPE_ONLY           = "scope_only";
const WORKFLOW_CLASS_UNKNOWN              = "unknown";

// ── Trade hints ───────────────────────────────────────────────────────────────
const TRADE_HINT_PAINTING    = "painting";
const TRADE_HINT_ELECTRICAL  = "electrical";
const TRADE_HINT_PLUMBING    = "plumbing";
const TRADE_HINT_LOW_VOLTAGE = "low_voltage";
const TRADE_HINT_DRYWALL     = "drywall";
const TRADE_HINT_FLOORING    = "flooring";
const TRADE_HINT_UNKNOWN     = "unknown";

// ── Complexity levels ─────────────────────────────────────────────────────────
const COMPLEXITY_SIMPLE   = "simple";
const COMPLEXITY_MODERATE = "moderate";
const COMPLEXITY_COMPLEX  = "complex";

// ── Shared helpers (pure, no throws) ─────────────────────────────────────────

function safeString(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function safeNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function roundMetric(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.round(next * 1000) / 1000;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function normalizeToken(value) {
  const s = safeString(value);
  if (!s) return "";
  return s.replace(/[^a-z0-9_]/gi, "").toLowerCase();
}

// Normalize a raw persisted event into a consistent shape.
function normalizeEvent(event, index) {
  if (!event || typeof event !== "object" || Array.isArray(event)) return null;
  const seam = safeString(event.seam || event.source);
  if (!seam) return null;
  return {
    _index: typeof index === "number" ? index : 0,
    seam,
    sectionKey: safeString(event.sectionKey, "unknown"),
    docType: safeString(event.docType, "unknown"),
    saveType: safeString(event.saveType || event.docType, "unknown"),
    acceptedAction: safeString(event.acceptedAction, "none"),
    timestamp: Math.max(0, safeNumber(event.timestamp, 0)),
    laborLineCount: Math.max(0, Math.floor(safeNumber(event.laborLineCount, 0))),
    materialItemCount: Math.max(0, Math.floor(safeNumber(event.materialItemCount, 0))),
    writeKeyCount: Math.max(0, Math.floor(safeNumber(event.writeKeyCount, 0))),
    inputLength: Math.max(0, Math.floor(safeNumber(event.inputLength, 0))),
    success: event.success === true,
    hasWrites: event.hasWrites === true,
  };
}

function normalizeEvents(events) {
  try {
    const list = Array.isArray(events) ? events.slice(0, MAX_EVENTS) : [];
    const normalized = list
      .map((ev, i) => normalizeEvent(ev, i))
      .filter(Boolean);
    normalized.sort((a, b) => {
      const delta = a.timestamp - b.timestamp;
      return delta !== 0 ? delta : a._index - b._index;
    });
    return normalized;
  } catch {
    return [];
  }
}

// Group normalized events into sessions separated by time gaps.
function groupIntoSessions(events) {
  const sessions = [];
  let current = [];
  let prevTs = 0;

  for (const ev of events) {
    const gapped = prevTs > 0 && ev.timestamp > 0 && (ev.timestamp - prevTs) > SEQUENCE_GAP_MS;
    if ((gapped || current.length >= MAX_SEQUENCE_LENGTH) && current.length) {
      sessions.push(current);
      current = [];
    }
    current.push(ev);
    prevTs = ev.timestamp || prevTs;
  }
  if (current.length) sessions.push(current);
  return sessions.slice(0, MAX_SESSIONS);
}

// Convert a session of events into sequence tokens, matching jobPatternCandidates format.
function sessionToSequence(session) {
  return session.map((ev) => {
    const seam = safeString(ev.seam);
    const sectionKey = safeString(ev.sectionKey);
    const saveType = safeString(ev.saveType || ev.docType);
    if (seam === "document_save") return `${saveType || "document"}_save`;
    if (seam === "assist_request" || seam === "assist_result" || seam === "assist_accept") {
      return `${sectionKey || "unknown"}_${seam.replace("assist_", "")}`;
    }
    return `${sectionKey || "unknown"}_${seam || "unknown"}`;
  }).filter(Boolean);
}

// Median of a numeric array. Returns 0 for empty arrays.
function median(arr) {
  if (!arr.length) return 0;
  const sorted = arr.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

// ── Public: classifyWorkflowSequence ─────────────────────────────────────────

/**
 * Classify a workflow sequence into a stable category.
 * Input: array of string tokens (e.g. ["scope_request","scope_accept","estimate_save"]).
 * Output: one of the WORKFLOW_CLASS_* constants.
 * Pure, deterministic, never throws.
 */
export function classifyWorkflowSequence(sequence) {
  try {
    if (!Array.isArray(sequence) || !sequence.length) return WORKFLOW_CLASS_UNKNOWN;

    const tokens = sequence
      .map(normalizeToken)
      .filter(Boolean)
      .slice(0, MAX_SEQUENCE_LENGTH);

    if (!tokens.length) return WORKFLOW_CLASS_UNKNOWN;

    const hasScope     = tokens.some((t) => t.startsWith("scope_"));
    const hasLabor     = tokens.some((t) => t.startsWith("labor_"));
    const hasMaterials = tokens.some((t) => t.startsWith("materials_"));
    const hasInvoiceSave  = tokens.includes("invoice_save");
    const hasEstimateSave = tokens.includes("estimate_save");
    // Generic save: catches document_save or any *_save token
    const hasSave = hasInvoiceSave || hasEstimateSave || tokens.some((t) => t.endsWith("_save"));

    // Invoice flow takes priority — invoice_save is a definitive signal.
    if (hasInvoiceSave) return WORKFLOW_CLASS_INVOICE_FLOW;

    // Full estimate: all three assist sections present with a save.
    if (hasScope && hasLabor && hasMaterials && hasSave) return WORKFLOW_CLASS_FULL_ESTIMATE;

    // Two-section estimate paths.
    if (hasScope && hasLabor && hasSave && !hasMaterials) return WORKFLOW_CLASS_SCOPE_LABOR_SAVE;
    if (hasScope && hasMaterials && hasSave && !hasLabor) return WORKFLOW_CLASS_SCOPE_MATERIALS_SAVE;

    // Scope with save, no other sections.
    if (hasScope && hasSave && !hasLabor && !hasMaterials) return WORKFLOW_CLASS_SCOPE_TO_SAVE;

    // Scope assist with no save yet.
    if (hasScope && !hasSave) return WORKFLOW_CLASS_SCOPE_ONLY;

    return WORKFLOW_CLASS_UNKNOWN;
  } catch {
    return WORKFLOW_CLASS_UNKNOWN;
  }
}

// ── Public: deriveWorkflowComplexity ─────────────────────────────────────────

/**
 * Classify a workflow sequence's complexity.
 * Input: array of string tokens.
 * Output: "simple" | "moderate" | "complex".
 * Pure, deterministic, never throws.
 */
export function deriveWorkflowComplexity(sequence) {
  try {
    if (!Array.isArray(sequence) || !sequence.length) return COMPLEXITY_SIMPLE;

    const tokens = sequence
      .map(normalizeToken)
      .filter(Boolean)
      .slice(0, MAX_SEQUENCE_LENGTH);

    if (!tokens.length) return COMPLEXITY_SIMPLE;

    const length = tokens.length;

    // Count distinct section prefixes that appear in the sequence.
    const sections = new Set();
    if (tokens.some((t) => t.startsWith("scope_")))     sections.add("scope");
    if (tokens.some((t) => t.startsWith("labor_")))     sections.add("labor");
    if (tokens.some((t) => t.startsWith("materials_"))) sections.add("materials");
    const sectionCount = sections.size;

    // Count distinct assist types (request/result/accept) present.
    const assistTypes = new Set();
    if (tokens.some((t) => t.endsWith("_request"))) assistTypes.add("request");
    if (tokens.some((t) => t.endsWith("_result")))  assistTypes.add("result");
    if (tokens.some((t) => t.endsWith("_accept")))  assistTypes.add("accept");
    const assistDiversity = assistTypes.size;

    const hasSave = tokens.some((t) => t.endsWith("_save"));

    // Complex: all 3 sections present, or long sequence with high diversity.
    if (sectionCount >= 3) return COMPLEXITY_COMPLEX;
    if (length >= 5 && assistDiversity >= 2) return COMPLEXITY_COMPLEX;

    // Moderate: 2 sections, or assist + save, or medium length.
    if (sectionCount === 2) return COMPLEXITY_MODERATE;
    if (length >= 3 && hasSave) return COMPLEXITY_MODERATE;
    if (assistDiversity >= 2 && hasSave) return COMPLEXITY_MODERATE;

    return COMPLEXITY_SIMPLE;
  } catch {
    return COMPLEXITY_SIMPLE;
  }
}

// ── Public: classifyTradeHints ────────────────────────────────────────────────

/**
 * Derive lightweight trade category hints from persisted metadata patterns.
 * Input: array of raw persisted event objects.
 * Output: { primaryHint, confidence, hintCounts, insufficientData }
 *
 * IMPORTANT: This uses ONLY persisted metadata relationships
 * (laborLineCount, materialItemCount, acceptedAction patterns).
 * Raw scope text is not persisted and is never inspected here.
 * Confidence is intentionally conservative — always <= 0.65.
 * Pure, deterministic, never throws.
 */
export function classifyTradeHints(events) {
  const EMPTY = {
    primaryHint: TRADE_HINT_UNKNOWN,
    confidence: 0,
    hintCounts: {
      [TRADE_HINT_PAINTING]: 0,
      [TRADE_HINT_ELECTRICAL]: 0,
      [TRADE_HINT_PLUMBING]: 0,
      [TRADE_HINT_LOW_VOLTAGE]: 0,
      [TRADE_HINT_DRYWALL]: 0,
      [TRADE_HINT_FLOORING]: 0,
      [TRADE_HINT_UNKNOWN]: 0,
    },
    insufficientData: true,
  };

  try {
    const normalized = normalizeEvents(events);
    if (!normalized.length) return EMPTY;

    // Work from accept events only — these represent confirmed session actions.
    const acceptEvents = normalized.filter((ev) => ev.seam === "assist_accept");
    if (acceptEvents.length < MIN_HINT_EVENTS) {
      return { ...EMPTY, insufficientData: true };
    }

    const laborAccepts     = acceptEvents.filter((ev) => ev.sectionKey === "labor");
    const materialsAccepts = acceptEvents.filter((ev) => ev.sectionKey === "materials");

    // Metadata signals.
    const laborLineCounts    = laborAccepts.map((ev) => ev.laborLineCount);
    const materialItemCounts = materialsAccepts.map((ev) => ev.materialItemCount);

    const medianLaborLines    = median(laborLineCounts);
    const medianMaterialItems = median(materialItemCounts.length ? materialItemCounts : [0]);

    // Materials action composition.
    const blanketAccepts   = materialsAccepts.filter((ev) => ev.acceptedAction === "applyBlanketSuggestion").length;
    const itemizedAccepts  = materialsAccepts.filter((ev) => ev.acceptedAction === "applyItemizedSuggestion").length;
    const totalMaterialsOps = blanketAccepts + itemizedAccepts;
    const blanketRatio     = totalMaterialsOps > 0 ? blanketAccepts / totalMaterialsOps : 0;
    const itemizedRatio    = totalMaterialsOps > 0 ? itemizedAccepts / totalMaterialsOps : 0;

    // Presence flags.
    const hasLaborAccepts     = laborAccepts.length > 0;
    const hasMaterialsAccepts = materialsAccepts.length > 0;

    // Score each trade hint. Scores are in [0, 1] but capped conservatively.
    // These are coarse signals only — confidence ceiling is 0.65.
    const scores = {};

    // painting: blanket materials dominant, low labor line count (1-2 lines typical)
    scores[TRADE_HINT_PAINTING] = clamp(
      (blanketRatio >= 0.6 ? 0.35 : 0)
      + (hasMaterialsAccepts && medianMaterialItems <= 1 ? 0.15 : 0)
      + (hasLaborAccepts && medianLaborLines >= 1 && medianLaborLines <= 2 ? 0.15 : 0)
    );

    // flooring: itemized materials dominant, moderate material items, moderate labor
    scores[TRADE_HINT_FLOORING] = clamp(
      (itemizedRatio >= 0.6 ? 0.25 : 0)
      + (hasMaterialsAccepts && medianMaterialItems >= 3 ? 0.20 : 0)
      + (hasLaborAccepts && medianLaborLines >= 2 && medianLaborLines <= 4 ? 0.10 : 0)
    );

    // electrical: high labor line count, low or no material items
    scores[TRADE_HINT_ELECTRICAL] = clamp(
      (hasLaborAccepts && medianLaborLines >= 4 ? 0.30 : 0)
      + (medianMaterialItems <= 1 ? 0.15 : 0)
      + (!hasMaterialsAccepts ? 0.10 : 0)
    );

    // low_voltage: very low labor lines, near-zero materials
    scores[TRADE_HINT_LOW_VOLTAGE] = clamp(
      (hasLaborAccepts && medianLaborLines >= 1 && medianLaborLines <= 2 ? 0.20 : 0)
      + (!hasMaterialsAccepts && medianMaterialItems === 0 ? 0.25 : 0)
    );

    // drywall: moderate labor (2-5 lines), moderate itemized materials (2-4 items)
    scores[TRADE_HINT_DRYWALL] = clamp(
      (hasLaborAccepts && medianLaborLines >= 2 && medianLaborLines <= 5 ? 0.20 : 0)
      + (hasMaterialsAccepts && medianMaterialItems >= 2 && medianMaterialItems <= 4 ? 0.20 : 0)
      + (itemizedRatio >= 0.4 ? 0.10 : 0)
    );

    // plumbing: moderate labor, low material items (parts-centric but few line items)
    scores[TRADE_HINT_PLUMBING] = clamp(
      (hasLaborAccepts && medianLaborLines >= 2 && medianLaborLines <= 3 ? 0.20 : 0)
      + (medianMaterialItems >= 1 && medianMaterialItems <= 2 ? 0.15 : 0)
    );

    // Identify the highest-scoring hint.
    let primaryHint = TRADE_HINT_UNKNOWN;
    let primaryScore = 0;
    for (const [hint, score] of Object.entries(scores)) {
      if (score > primaryScore) {
        primaryScore = score;
        primaryHint = hint;
      }
    }

    // Require a minimum score threshold to declare any non-unknown hint.
    const MIN_SCORE_THRESHOLD = 0.25;
    if (primaryScore < MIN_SCORE_THRESHOLD) {
      primaryHint = TRADE_HINT_UNKNOWN;
      primaryScore = 0;
    }

    // Cap confidence conservatively — these are coarse metadata signals only.
    const confidence = roundMetric(clamp(primaryScore, 0, 0.65));

    // Build hint counts: how many accept sessions lean toward each hint.
    const hintCounts = {
      [TRADE_HINT_PAINTING]: 0,
      [TRADE_HINT_ELECTRICAL]: 0,
      [TRADE_HINT_PLUMBING]: 0,
      [TRADE_HINT_LOW_VOLTAGE]: 0,
      [TRADE_HINT_DRYWALL]: 0,
      [TRADE_HINT_FLOORING]: 0,
      [TRADE_HINT_UNKNOWN]: 0,
    };

    // Per-session hint assignment: classify each accept session individually.
    const sessions = groupIntoSessions(normalized);
    for (const session of sessions) {
      const sessionAccepts = session.filter((ev) => ev.seam === "assist_accept");
      if (!sessionAccepts.length) continue;

      const sLaborLines   = median(sessionAccepts.filter((ev) => ev.sectionKey === "labor").map((ev) => ev.laborLineCount));
      const sMaterialItems = median(sessionAccepts.filter((ev) => ev.sectionKey === "materials").map((ev) => ev.materialItemCount));
      const sBlanket      = sessionAccepts.filter((ev) => ev.acceptedAction === "applyBlanketSuggestion").length;
      const sItemized     = sessionAccepts.filter((ev) => ev.acceptedAction === "applyItemizedSuggestion").length;
      const sTotalMat     = sBlanket + sItemized;
      const sBlanketRatio = sTotalMat > 0 ? sBlanket / sTotalMat : 0;
      const sItemizedRatio = sTotalMat > 0 ? sItemized / sTotalMat : 0;
      const sHasLabor     = sessionAccepts.some((ev) => ev.sectionKey === "labor");
      const sHasMaterials = sessionAccepts.some((ev) => ev.sectionKey === "materials");

      // Use same scoring logic per session, pick winner.
      const sScores = {
        [TRADE_HINT_PAINTING]:    sBlanketRatio >= 0.6 ? 0.35 : 0,
        [TRADE_HINT_FLOORING]:    sItemizedRatio >= 0.6 && sMaterialItems >= 3 ? 0.35 : 0,
        [TRADE_HINT_ELECTRICAL]:  sHasLabor && sLaborLines >= 4 ? 0.30 : 0,
        [TRADE_HINT_LOW_VOLTAGE]: !sHasMaterials && sLaborLines >= 1 && sLaborLines <= 2 ? 0.25 : 0,
        [TRADE_HINT_DRYWALL]:     sLaborLines >= 2 && sLaborLines <= 5 && sMaterialItems >= 2 && sMaterialItems <= 4 ? 0.30 : 0,
        [TRADE_HINT_PLUMBING]:    sLaborLines >= 2 && sLaborLines <= 3 && sMaterialItems >= 1 && sMaterialItems <= 2 ? 0.20 : 0,
      };

      let sessionHint = TRADE_HINT_UNKNOWN;
      let sessionBest = MIN_SCORE_THRESHOLD;
      for (const [h, s] of Object.entries(sScores)) {
        if (s > sessionBest) { sessionBest = s; sessionHint = h; }
      }

      hintCounts[sessionHint] = (hintCounts[sessionHint] || 0) + 1;
    }

    return {
      primaryHint,
      confidence,
      hintCounts,
      insufficientData: false,
    };
  } catch {
    return EMPTY;
  }
}

// ── Public: summarizeClassificationHealth ─────────────────────────────────────

/**
 * Summarize classification health across all stored events.
 * Input: array of raw persisted event objects.
 * Output: aggregated classification counts and stability signals.
 * Pure, deterministic, never throws. No timestamps exposed.
 */
export function summarizeClassificationHealth(events) {
  const EMPTY_SUMMARY = {
    totalSessions: 0,
    workflowCounts: {
      [WORKFLOW_CLASS_INVOICE_FLOW]:         0,
      [WORKFLOW_CLASS_FULL_ESTIMATE]:        0,
      [WORKFLOW_CLASS_SCOPE_LABOR_SAVE]:     0,
      [WORKFLOW_CLASS_SCOPE_MATERIALS_SAVE]: 0,
      [WORKFLOW_CLASS_SCOPE_TO_SAVE]:        0,
      [WORKFLOW_CLASS_SCOPE_ONLY]:           0,
      [WORKFLOW_CLASS_UNKNOWN]:              0,
    },
    complexityCounts: {
      [COMPLEXITY_SIMPLE]:   0,
      [COMPLEXITY_MODERATE]: 0,
      [COMPLEXITY_COMPLEX]:  0,
    },
    tradeHints: {
      primaryHint: TRADE_HINT_UNKNOWN,
      confidence: 0,
      hintCounts: {
        [TRADE_HINT_PAINTING]: 0,
        [TRADE_HINT_ELECTRICAL]: 0,
        [TRADE_HINT_PLUMBING]: 0,
        [TRADE_HINT_LOW_VOLTAGE]: 0,
        [TRADE_HINT_DRYWALL]: 0,
        [TRADE_HINT_FLOORING]: 0,
        [TRADE_HINT_UNKNOWN]: 0,
      },
      insufficientData: true,
    },
    unknownWorkflowCount: 0,
    classificationStability: 0,
    dominantWorkflowClass: WORKFLOW_CLASS_UNKNOWN,
  };

  try {
    const normalized = normalizeEvents(events);
    if (!normalized.length) return EMPTY_SUMMARY;

    const sessions = groupIntoSessions(normalized);
    if (!sessions.length) return EMPTY_SUMMARY;

    const workflowCounts = {
      [WORKFLOW_CLASS_INVOICE_FLOW]:         0,
      [WORKFLOW_CLASS_FULL_ESTIMATE]:        0,
      [WORKFLOW_CLASS_SCOPE_LABOR_SAVE]:     0,
      [WORKFLOW_CLASS_SCOPE_MATERIALS_SAVE]: 0,
      [WORKFLOW_CLASS_SCOPE_TO_SAVE]:        0,
      [WORKFLOW_CLASS_SCOPE_ONLY]:           0,
      [WORKFLOW_CLASS_UNKNOWN]:              0,
    };

    const complexityCounts = {
      [COMPLEXITY_SIMPLE]:   0,
      [COMPLEXITY_MODERATE]: 0,
      [COMPLEXITY_COMPLEX]:  0,
    };

    for (const session of sessions) {
      const seq = sessionToSequence(session);
      const wClass = classifyWorkflowSequence(seq);
      workflowCounts[wClass] = (workflowCounts[wClass] || 0) + 1;

      const complexity = deriveWorkflowComplexity(seq);
      complexityCounts[complexity] = (complexityCounts[complexity] || 0) + 1;
    }

    const totalSessions = sessions.length;
    const unknownWorkflowCount = workflowCounts[WORKFLOW_CLASS_UNKNOWN] || 0;

    // Dominant workflow: the most common non-unknown class.
    let dominantWorkflowClass = WORKFLOW_CLASS_UNKNOWN;
    let dominantCount = 0;
    for (const [cls, count] of Object.entries(workflowCounts)) {
      if (cls === WORKFLOW_CLASS_UNKNOWN) continue;
      if (count > dominantCount) {
        dominantCount = count;
        dominantWorkflowClass = cls;
      }
    }

    // Stability: fraction of sessions that share the dominant class.
    // If all sessions are unknown, stability is 0.
    const knownSessions = totalSessions - unknownWorkflowCount;
    const classificationStability = totalSessions > 0 && dominantCount > 0
      ? roundMetric(clamp(dominantCount / totalSessions))
      : 0;

    const tradeHints = classifyTradeHints(events);

    return {
      totalSessions,
      workflowCounts,
      complexityCounts,
      tradeHints,
      unknownWorkflowCount,
      classificationStability,
      dominantWorkflowClass,
    };
  } catch {
    return EMPTY_SUMMARY;
  }
}
