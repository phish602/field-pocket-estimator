// @ts-nocheck
/* eslint-disable */

import { LABOR_ROLE_OPTIONS } from "../../guided/registry";

function resolveRoleFromLabel(raw) {
  const text = String(raw || "").trim();
  if (!text) return { role: "", label: "" };
  const lower = text.toLowerCase();
  // Exact value match ("foreman")
  const byValue = LABOR_ROLE_OPTIONS.find((o) => o.value.toLowerCase() === lower);
  if (byValue) return { role: byValue.value, label: byValue.label };
  // Exact label match ("Foreman")
  const byLabel = LABOR_ROLE_OPTIONS.find((o) => o.label.toLowerCase() === lower);
  if (byLabel) return { role: byLabel.value, label: byLabel.label };
  // Partial match — label contains the text or vice versa
  const partial = LABOR_ROLE_OPTIONS.find(
    (o) => o.label.toLowerCase().includes(lower) || lower.includes(o.label.toLowerCase())
  );
  if (partial) return { role: partial.value, label: partial.label };
  // Unrecognized — pass through as free-form label (form allows custom labels)
  return { role: "", label: text };
}

function makeLineId(i) {
  return `ai_${Date.now().toString(36)}_${i}`;
}

export const laborAssistConfig = {
  sectionKey: "labor",
  sectionLabel: "Labor",
  inputPlaceholder: "Optional: add context — e.g. \"2 painters, ~3 days\" — or leave blank to generate from scope",
  inputLabel: "Any notes for this estimate? (optional)",
  generateLabel: "Suggest Labor Lines",
  allowedFields: ["labor.lines"],
  acceptFlow: "review",
  reviewType: "labor-lines",
  writebackTargets: ["labor.lines"],

  contextBuilder(state) {
    return {
      tradeKey: String(state?.tradeInsert?.key || "").trim(),
      tradeLabel: String(state?.tradeInsert?.text || "").trim(),
      scopeNotes: String(state?.scopeNotes || "").trim(),
    };
  },

  localAdapter(rawResponse) {
    const rawLines = rawResponse?.lines;
    if (!Array.isArray(rawLines) || rawLines.length === 0) return null;

    const laborLines = rawLines
      .slice(0, 6)
      .map((line, i) => {
        const { role, label } = resolveRoleFromLabel(line?.role || line?.label || line?.roleLabel);
        const hours = String(Number(line?.hours) || "").trim();
        const rate = String(Number(line?.rate) || "").trim();
        return { id: makeLineId(i), role, label, hours, rate, trueRateInternal: "", internalRate: "" };
      })
      .filter((l) => l.label && l.hours && l.rate);

    return laborLines.length ? { laborLines } : null;
  },

  validationRules(writes) {
    if (!writes?.laborLines?.length) return { valid: false, error: "No labor lines were generated." };
    const incomplete = writes.laborLines.filter((l) => !l.label || !l.hours || !l.rate);
    if (incomplete.length > 0) return { valid: false, error: "Some lines are missing role, hours, or rate." };
    return { valid: true };
  },
};
