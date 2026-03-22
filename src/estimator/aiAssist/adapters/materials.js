// @ts-nocheck
/* eslint-disable */

const VALID_MATERIALS_MODES = new Set(["blanket", "itemized"]);

function asText(value) {
  return String(value ?? "").trim();
}

function trimText(value, max = 320) {
  const normalized = asText(value).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trim()}…`;
}

function toPositiveMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.round(numeric * 100) / 100;
}

function toQtyString(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "1";
  return String(Math.max(1, Math.round(numeric)));
}

function toMoneyString(value) {
  const numeric = toPositiveMoney(value);
  return numeric > 0 ? String(numeric) : "";
}

function normalizeIdentity(value) {
  return asText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(gal|gallon|gallons|qt|quart|ea|each|pc|pcs|piece|pieces|unit|units|ft|lf|sf|sq\s*ft|sqft|box|boxes|roll|rolls|tube|tubes|sheet|sheets|pail|pails|bucket|buckets|case|cases|bag|bags)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueTextList(values) {
  const seen = new Set();
  return (Array.isArray(values) ? values : [])
    .map((value) => asText(value))
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function buildAiMaterialId(index) {
  return `ai_mat_${Date.now().toString(36)}_${index}`;
}

export function normalizeMaterialsAssistMode(value) {
  const normalized = asText(value).toLowerCase();
  return VALID_MATERIALS_MODES.has(normalized) ? normalized : "";
}

export function resolveMaterialsAssistMode(value) {
  return normalizeMaterialsAssistMode(value);
}

export function isBlankMaterialItem(item) {
  if (!item || typeof item !== "object") return true;
  return ![
    item?.desc,
    item?.note,
    item?.qty,
    item?.cost,
    item?.unitCostInternal,
    item?.costInternal,
    item?.charge,
    item?.priceEach,
  ].some((value) => asText(value));
}

export function detectMaterialsAssistIntent(userInput) {
  const text = asText(userInput).toLowerCase();
  if (!text) return "";

  const normalizedLines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const quantityUnitMatches = text.match(/\b\d+(?:\.\d+)?\s*(?:x|ea|each|pc|pcs|piece|pieces|unit|units|ft|lf|sf|sq\.?\s*ft|sqft|gal|gallon|gallons|qt|quart|box|boxes|roll|rolls|tube|tubes|sheet|sheets|pail|pails|bucket|buckets|bag|bags|case|cases)\b/g) || [];
  const segmentedItems = text
    .split(/[,\n;]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);

  const blanketSignalCount = [
    /\ballowance\b/,
    /\brough\b/,
    /\bballpark\b/,
    /\bbudget\b/,
    /\bone[-\s]?number\b/,
    /\bone total\b/,
    /\brough total\b/,
    /\blump\b/,
    /\blump sum\b/,
    /\bcarry\b.*\ballowance\b/,
    /\btotal\b.*\bmaterials\b/,
  ].reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0);

  const itemizedSignalCount = [
    /\bitemi[sz]e\b/,
    /\bline items?\b/,
    /\bmaterials? list\b/,
    /\bparts? list\b/,
    /\bbuild\b.*\blist\b/,
  ].reduce((count, pattern) => count + (pattern.test(text) ? 1 : 0), 0)
    + (quantityUnitMatches.length >= 1 ? 1 : 0)
    + (segmentedItems.length >= 3 && /\d/.test(text) ? 1 : 0)
    + (segmentedItems.length >= 4 && /^\s*\d+/.test(text) ? 1 : 0)
    + (normalizedLines.length >= 2 ? 1 : 0);

  if (itemizedSignalCount >= 2 && itemizedSignalCount > blanketSignalCount) return "itemized";
  if (blanketSignalCount >= 1 && blanketSignalCount >= itemizedSignalCount) return "blanket";
  return "";
}

export function buildMaterialsAssistPreflight({ userInput, mode } = {}) {
  const resolvedMode = normalizeMaterialsAssistMode(mode);
  if (!resolvedMode) {
    return {
      responseType: "needs_mode",
      message: "Choose whether you want one total or a broken-out list before I draft materials.",
    };
  }

  const inferredIntent = detectMaterialsAssistIntent(userInput);
  if (!inferredIntent || inferredIntent === resolvedMode) return null;

  if (resolvedMode === "blanket" && inferredIntent === "itemized") {
    return {
      responseType: "mode_mismatch",
      currentMode: resolvedMode,
      recommendedMode: "itemized",
      message: "This looks more like a broken-out materials list. Switch to itemized mode if you want draft line items.",
    };
  }

  if (resolvedMode === "itemized" && inferredIntent === "blanket") {
    return {
      responseType: "mode_mismatch",
      currentMode: resolvedMode,
      recommendedMode: "blanket",
      message: "This sounds better for one reviewed materials allowance. Switch to blanket mode if you want a single total.",
    };
  }

  return null;
}

function buildTradeClues(state) {
  const tradeInsertText = asText(state?.tradeInsert?.text);
  const firstTradeLine = tradeInsertText
    .split(/\n+/)
    .map((line) => line.replace(/^trade insert:\s*/i, "").trim())
    .find(Boolean);
  return uniqueTextList([
    asText(state?.tradeInsert?.key),
    firstTradeLine,
  ]).slice(0, 3);
}

function buildMaterialsStateSummary(state, mode) {
  if (mode === "blanket") {
    const amount = asText(state?.materials?.blanketCost);
    const markup = asText(state?.materials?.markupPct);
    const description = trimText(state?.materials?.materialsBlanketDescription, 240);
    return [
      amount ? `Current allowance field: ${amount}` : "Current allowance field is empty.",
      markup ? `Current blanket markup: ${markup}%` : "",
      description ? `Current blanket notes: ${description}` : "",
    ].filter(Boolean).join(" ");
  }

  const items = Array.isArray(state?.materials?.items) ? state.materials.items : [];
  const describedItems = items
    .filter((item) => !isBlankMaterialItem(item))
    .slice(0, 8)
    .map((item, index) => {
      const desc = asText(item?.desc) || `Item ${index + 1}`;
      const qty = asText(item?.qty) || "1";
      const each = asText(item?.priceEach ?? item?.charge);
      const note = trimText(item?.note, 120);
      return [
        `${index + 1}. ${desc}`,
        `qty ${qty}`,
        each ? `base each ${each}` : "",
        note ? `note: ${note}` : "",
      ].filter(Boolean).join(" | ");
    });
  return describedItems.length
    ? `Existing material rows:\n${describedItems.join("\n")}`
    : "No existing itemized materials yet.";
}

function buildEstimateContextSummary(state) {
  return {
    tradeClues: buildTradeClues(state),
    scopeNotes: trimText(state?.scopeNotes, 700),
    additionalNotes: trimText(state?.additionalNotes, 320),
  };
}

function buildItemNote(rawLine) {
  const noteParts = [];
  const note = trimText(rawLine?.note || rawLine?.assumptionNote || rawLine?.assumptions, 160);
  const unit = asText(rawLine?.unit || rawLine?.basis || rawLine?.unitLabel);
  if (note) noteParts.push(note);
  if (unit) noteParts.push(`Basis: ${unit}`);
  return noteParts.join(" • ").slice(0, 240);
}

export function normalizeProposedMaterialLine(rawLine, index) {
  const desc = asText(
    rawLine?.desc
    || rawLine?.description
    || rawLine?.label
    || rawLine?.item
    || rawLine?.name
  );
  if (!desc) return null;

  const unitCostInternal = toMoneyString(
    rawLine?.unitCostInternal
    ?? rawLine?.costInternal
    ?? rawLine?.internalCost
    ?? rawLine?.unitCost
    ?? rawLine?.cost
  );
  const priceEach = toMoneyString(
    rawLine?.priceEach
    ?? rawLine?.charge
    ?? rawLine?.unitPrice
    ?? rawLine?.price
  );
  const note = buildItemNote(rawLine);

  return {
    id: buildAiMaterialId(index),
    desc,
    note,
    qty: toQtyString(rawLine?.qty ?? rawLine?.quantity ?? 1),
    cost: unitCostInternal,
    unitCostInternal,
    costInternal: unitCostInternal,
    charge: priceEach,
    priceEach,
    markupPct: "",
  };
}

export function dedupeProposedMaterialLines(proposedLines, existingItems) {
  const duplicateWarnings = [];
  const existingKeys = new Set(
    (Array.isArray(existingItems) ? existingItems : [])
      .map((item) => normalizeIdentity(item?.desc))
      .filter(Boolean)
  );
  const seen = new Set();

  const nextLines = (Array.isArray(proposedLines) ? proposedLines : []).filter((line) => {
    const key = normalizeIdentity(line?.desc);
    const label = asText(line?.desc) || "Material";
    if (!key) return false;
    if (existingKeys.has(key)) {
      duplicateWarnings.push(`Skipped "${label}" because it already exists in your current materials.`);
      return false;
    }
    if (seen.has(key)) {
      duplicateWarnings.push(`Skipped duplicate draft line "${label}".`);
      return false;
    }
    seen.add(key);
    return true;
  });

  return {
    proposedLines: nextLines,
    duplicateWarnings,
  };
}

export const materialsAssistConfig = {
  sectionKey: "materials",
  sectionLabel: "Materials",
  inputPlaceholder: 'Describe the materials or supplies you need — e.g. "3 toilets, wax rings, closet bolts, supply lines, caulk"',
  inputLabel: "What materials or supplies should I carry?",
  generateLabel: "Build Materials",
  allowedFields: ["materials.blanketCost", "materials.items", "ui.materialsMode"],
  acceptFlow: "review",
  reviewType: "materials",
  writebackTargets: ["materials.blanketCost", "materials.items", "ui.materialsMode"],

  contextBuilder(state) {
    const materialsMode = normalizeMaterialsAssistMode(state?.ui?.materialsMode);
    return {
      currentSection: "materials",
      materialsMode,
      estimateContext: buildEstimateContextSummary(state),
      materialsStateSummary: buildMaterialsStateSummary(state, materialsMode),
    };
  },

  preflight({ userInput, context }) {
    return buildMaterialsAssistPreflight({
      userInput,
      mode: context?.materialsMode,
    });
  },

  localAdapter(rawResponse, state) {
    const activeMode = normalizeMaterialsAssistMode(state?.ui?.materialsMode);
    const responseType = asText(rawResponse?.responseType || rawResponse?.type).toLowerCase();

    if (responseType === "needs_mode") {
      return {
        kind: "materials",
        modeChoiceRequired: true,
        assistantMessage: asText(rawResponse?.message)
          || "Choose whether you want one total or a broken-out list before I draft materials.",
      };
    }

    if (responseType === "mode_mismatch") {
      const recommendedMode = normalizeMaterialsAssistMode(rawResponse?.recommendedMode);
      return recommendedMode
        ? {
            kind: "materials",
            modeMismatch: {
              currentMode: normalizeMaterialsAssistMode(rawResponse?.currentMode) || activeMode,
              recommendedMode,
              message: asText(rawResponse?.message)
                || "This request fits the other materials mode better.",
            },
          }
        : null;
    }

    if (responseType === "blanketsuggestion" || activeMode === "blanket") {
      const source = rawResponse?.blanketSuggestion && typeof rawResponse.blanketSuggestion === "object"
        ? rawResponse.blanketSuggestion
        : rawResponse;
      const suggestedAmount = toPositiveMoney(
        source?.suggestedAmount
        ?? source?.amount
        ?? source?.blanketAmount
      );
      const assumptionsSummary = trimText(
        source?.assumptionsSummary
        || source?.assumptions
        || source?.summary,
        280
      );
      const includedCategories = uniqueTextList(
        source?.includedCategories
        || source?.categories
        || []
      );
      if (!suggestedAmount) return null;
      return {
        kind: "materials",
        mode: "blanket",
        blanketSuggestion: {
          suggestedAmount,
          assumptionsSummary,
          includedCategories,
        },
      };
    }

    if (responseType === "itemizedsuggestion" || activeMode === "itemized") {
      const source = rawResponse?.itemizedSuggestion && typeof rawResponse.itemizedSuggestion === "object"
        ? rawResponse.itemizedSuggestion
        : rawResponse;
      const rawLines = Array.isArray(source?.proposedLines)
        ? source.proposedLines
        : (Array.isArray(source?.lines) ? source.lines : []);
      const normalizedLines = rawLines
        .map((line, index) => normalizeProposedMaterialLine(line, index))
        .filter(Boolean);
      const deduped = dedupeProposedMaterialLines(normalizedLines, state?.materials?.items);
      return {
        kind: "materials",
        mode: "itemized",
        itemizedSuggestion: {
          proposedLines: deduped.proposedLines,
          assumptionsSummary: trimText(
            source?.assumptionsSummary
            || source?.assumptions
            || source?.summary,
            280
          ),
          duplicateWarnings: [
            ...uniqueTextList(source?.duplicateWarnings || []),
            ...deduped.duplicateWarnings,
          ],
        },
      };
    }

    return null;
  },

  validationRules(writes) {
    if (!writes) return { valid: false, error: "No materials suggestion was generated." };
    if (writes?.modeChoiceRequired) return { valid: true };
    if (writes?.modeMismatch?.recommendedMode) return { valid: true };
    if (writes?.mode === "blanket") {
      if (!Number.isFinite(Number(writes?.blanketSuggestion?.suggestedAmount)) || Number(writes.blanketSuggestion.suggestedAmount) <= 0) {
        return { valid: false, error: "No usable blanket allowance was generated." };
      }
      return { valid: true };
    }
    if (writes?.mode === "itemized") {
      if (writes?.itemizedSuggestion?.proposedLines?.length) return { valid: true };
      const duplicateWarnings = writes?.itemizedSuggestion?.duplicateWarnings || [];
      return {
        valid: false,
        error: duplicateWarnings[0] || "No new material lines were generated.",
      };
    }
    return { valid: false, error: "No materials suggestion was generated." };
  },
};
