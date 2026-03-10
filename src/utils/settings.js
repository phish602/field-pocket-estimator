// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { normalizePercentInput } from "./format";

export const DEFAULT_SETTINGS = {
  pricing: {
    defaultMarkupPct: 0,
    lockMarkupToGlobal: false,
    defaultTaxPct: 0,
    roundTotals: false,
    precision: 2,
  },
  docDefaults: {
    defaultInternalNotesEstimate: "",
  },
  internal: {
    showInternalCostFields: true,
    lockInternalCostFields: false,
  },
  pdf: {
    includeLogo: true,
    compactLayout: false,
    showUnitRates: true,
  },
  customer: {
    defaultCustomerType: "residential",
    requirePhone: false,
    requireEmail: false,
  },
};

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function asBool(v, fallback) {
  if (typeof v === "boolean") return v;
  if (v === "1" || v === "true" || v === "yes") return true;
  if (v === "0" || v === "false" || v === "no") return false;
  return fallback;
}

function asText(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function asMarkup(v, fallback = 0) {
  const normalized = normalizePercentInput(v);
  if (normalized === "") return fallback;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : fallback;
}

function asPrecision(v, fallback = 2) {
  const n = Number(v);
  if (n === 0) return 0;
  if (n === 2) return 2;
  return fallback === 0 ? 0 : 2;
}

function asCustomerType(v, fallback = "residential") {
  const s = String(v || "").toLowerCase();
  return s === "commercial" ? "commercial" : (fallback === "commercial" ? "commercial" : "residential");
}

export function normalizeSettings(input) {
  const src = asObject(input);
  const pricing = asObject(src.pricing);
  const docDefaults = asObject(src.docDefaults);
  const documentsLegacy = asObject(src.documents);
  const internal = asObject(src.internal);
  const pdf = asObject(src.pdf);
  const customer = asObject(src.customer);

  // Backward compatibility: migrate legacy documents.defaultInternalNotes
  const defaultInternalNotesEstimate = asText(
    docDefaults.defaultInternalNotesEstimate
      ?? docDefaults.defaultInternalNotes
      ?? documentsLegacy.defaultInternalNotes,
    DEFAULT_SETTINGS.docDefaults.defaultInternalNotesEstimate
  );

  return {
    pricing: {
      defaultMarkupPct: asMarkup(pricing.defaultMarkupPct, DEFAULT_SETTINGS.pricing.defaultMarkupPct),
      lockMarkupToGlobal: asBool(pricing.lockMarkupToGlobal, DEFAULT_SETTINGS.pricing.lockMarkupToGlobal),
      defaultTaxPct: asMarkup(pricing.defaultTaxPct, DEFAULT_SETTINGS.pricing.defaultTaxPct),
      roundTotals: asBool(pricing.roundTotals, DEFAULT_SETTINGS.pricing.roundTotals),
      precision: asPrecision(pricing.precision, DEFAULT_SETTINGS.pricing.precision),
    },
    docDefaults: {
      defaultInternalNotesEstimate,
    },
    internal: {
      showInternalCostFields: asBool(internal.showInternalCostFields, DEFAULT_SETTINGS.internal.showInternalCostFields),
      lockInternalCostFields: asBool(internal.lockInternalCostFields, DEFAULT_SETTINGS.internal.lockInternalCostFields),
    },
    pdf: {
      includeLogo: asBool(pdf.includeLogo, DEFAULT_SETTINGS.pdf.includeLogo),
      compactLayout: asBool(pdf.compactLayout, DEFAULT_SETTINGS.pdf.compactLayout),
      showUnitRates: asBool(pdf.showUnitRates, DEFAULT_SETTINGS.pdf.showUnitRates),
    },
    customer: {
      defaultCustomerType: asCustomerType(customer.defaultCustomerType, DEFAULT_SETTINGS.customer.defaultCustomerType),
      requirePhone: asBool(customer.requirePhone, DEFAULT_SETTINGS.customer.requirePhone),
      requireEmail: asBool(customer.requireEmail, DEFAULT_SETTINGS.customer.requireEmail),
    },
  };
}

export function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SETTINGS);
    if (!raw) return normalizeSettings(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return normalizeSettings(parsed);
  } catch {
    return normalizeSettings(DEFAULT_SETTINGS);
  }
}

export function saveSettings(next) {
  const normalized = normalizeSettings(next);
  try {
    localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify(normalized));
    try {
      window.dispatchEvent(new Event("estipaid:settings-changed"));
    } catch {}
    return true;
  } catch {
    return false;
  }
}
