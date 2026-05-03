// @ts-nocheck
/* eslint-disable */

import { LABOR_ROLE_OPTIONS } from "../../guided/registry";

function asText(value) {
  return String(value ?? "").trim();
}

function compactText(value, max = 240) {
  const normalized = asText(value).replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > max ? `${normalized.slice(0, Math.max(0, max - 1)).trim()}…` : normalized;
}

function toPositiveNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeQty(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return String(Math.max(1, Math.round(numeric)));
}

function hasMeaningfulLaborLine(line) {
  if (!line || typeof line !== "object") return false;
  const qty = normalizeQty(line?.qty);
  return Boolean(
    asText(line?.role)
    || asText(line?.label)
    || asText(line?.hours)
    || asText(line?.rate)
    || asText(line?.trueRateInternal ?? line?.internalRate)
    || (qty && qty !== "1")
    || asText(line?.markupPct)
  );
}

function buildExistingLaborSummary(lines = []) {
  return (Array.isArray(lines) ? lines : [])
    .filter(hasMeaningfulLaborLine)
    .slice(0, 8)
    .map((line, index) => {
      const parts = [
        `${index + 1}. ${asText(line?.label || line?.role) || "Labor line"}`,
        asText(line?.hours) ? `${asText(line?.hours)} hrs` : "",
        asText(line?.rate) ? `$${asText(line?.rate)}/hr` : "",
      ];
      const qty = normalizeQty(line?.qty);
      const markupPct = asText(line?.markupPct);
      const internalRate = asText(line?.trueRateInternal ?? line?.internalRate);
      if (qty) parts.push(`qty ${qty}`);
      if (markupPct) parts.push(`markup ${markupPct}%`);
      if (internalRate) parts.push(`internal $${internalRate}/hr`);
      return parts.filter(Boolean).join(" | ");
    });
}

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
    const existingLaborLines = buildExistingLaborSummary(state?.labor?.lines);
    const hazardPct = toPositiveNumber(state?.labor?.hazardPct);
    const riskPct = toPositiveNumber(state?.labor?.riskPct);
    const laborMultiplier = Number(state?.labor?.multiplier);
    const pricingHints = Array.from(new Set(
      (Array.isArray(state?.labor?.lines) ? state.labor.lines : [])
        .filter(hasMeaningfulLaborLine)
        .flatMap((line) => {
          const hints = [];
          const markupPct = asText(line?.markupPct);
          const rate = asText(line?.rate);
          const internalRate = asText(line?.trueRateInternal ?? line?.internalRate);
          if (markupPct) hints.push(`row markup ${markupPct}%`);
          if (rate) hints.push(`row bill rate $${rate}/hr`);
          if (internalRate) hints.push(`row internal $${internalRate}/hr`);
          return hints;
        })
    )).slice(0, 8);
    return {
      tradeKey: String(state?.tradeInsert?.key || "").trim(),
      tradeLabel: String(state?.tradeInsert?.text || "").trim(),
      scopeNotes: String(state?.scopeNotes || "").trim(),
      customerName: compactText(state?.customer?.name, 120),
      projectName: compactText(state?.customer?.projectName, 120),
      projectAddress: compactText(state?.customer?.projectAddress || state?.job?.location, 160),
      additionalNotes: compactText(state?.additionalNotes, 220),
      existingLaborLines,
      laborPricingHints: pricingHints,
      laborConditions: {
        ...(hazardPct > 0 ? { hazardPct } : {}),
        ...(riskPct > 0 ? { riskPct } : {}),
        ...(Number.isFinite(laborMultiplier) && laborMultiplier > 0 && laborMultiplier !== 1
          ? { multiplier: laborMultiplier }
          : {}),
      },
    };
  },

  localAdapter(rawResponse) {
    const rawLines = rawResponse?.lines;
    if (!Array.isArray(rawLines) || rawLines.length === 0) return null;

    const laborLines = rawLines
      .slice(0, 6)
      .map((line, i) => {
        const { role, label } = resolveRoleFromLabel(line?.role || line?.label || line?.roleLabel);
        const rawHours = Number(line?.hours);
        const rawRate = Number(line?.rate);
        const hours = Number.isFinite(rawHours) && rawHours > 0 ? String(rawHours).trim() : "";
        const rate = Number.isFinite(rawRate) && rawRate > 0 ? String(rawRate).trim() : "";
        const qty = normalizeQty(line?.qty ?? line?.headcount);
        return {
          id: makeLineId(i),
          role,
          label,
          hours,
          rate,
          ...(qty ? { qty } : {}),
          trueRateInternal: "",
          internalRate: "",
        };
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
