// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";

const SCOPE_TEMPLATES_KEY = STORAGE_KEYS.SCOPE_TEMPLATES;
const WORK_PACKAGE_TEMPLATE_SCHEMA_VERSION = 2;

function normalizeTimestamp(value, fallback = 0) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createScopeTemplateId() {
  return `scope_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createTemplateItemId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function readArrayCandidate(...candidates) {
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [];
}

function normalizeTextValue(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function normalizeTemplateText(value) {
  return normalizeTextValue(value);
}

function normalizeLaborTemplateItem(record = {}) {
  const source = isPlainObject(record) ? record : {};
  const role = String(source.role ?? "").trim();
  const label = String(source.label ?? "").trim();
  const hours = source.hours ?? "";
  const rate = source.rate ?? "";
  const trueRateInternal = source.trueRateInternal ?? source.internalRate ?? source.rateInternal ?? "";
  const internalRate = source.internalRate ?? source.trueRateInternal ?? source.rateInternal ?? "";
  const qty = source.qty ?? 1;
  const markupPct = source.markupPct ?? "";
  const id = String(source.id || "").trim() || createTemplateItemId("labor");
  const hasMeaningfulContent = Boolean(
    role
    || label
    || String(hours ?? "").trim()
    || String(rate ?? "").trim()
    || String(trueRateInternal ?? "").trim()
    || String(internalRate ?? "").trim()
  );
  if (!hasMeaningfulContent) return null;
  return {
    id,
    role,
    label,
    hours,
    rate,
    trueRateInternal,
    internalRate,
    qty,
    ...(String(markupPct ?? "").trim() !== "" ? { markupPct } : {}),
  };
}

function normalizeMaterialTemplateItem(record = {}) {
  const source = isPlainObject(record) ? record : {};
  const id = String(source.id || "").trim() || createTemplateItemId("material");
  const desc = String(source.desc ?? "").trim();
  const note = String(source.note ?? "").trim();
  const qty = source.qty ?? 1;
  const cost = source.cost ?? "";
  const unitCostInternal = source.unitCostInternal ?? "";
  const costInternal = source.costInternal ?? "";
  const charge = source.charge ?? "";
  const priceEach = source.priceEach ?? "";
  const markupPct = source.markupPct ?? "";
  const hasMeaningfulContent = Boolean(
    desc
    || note
    || String(cost ?? "").trim()
    || String(unitCostInternal ?? "").trim()
    || String(costInternal ?? "").trim()
    || String(charge ?? "").trim()
    || String(priceEach ?? "").trim()
  );
  if (!hasMeaningfulContent) return null;
  return {
    id,
    desc,
    note,
    qty,
    cost,
    unitCostInternal,
    costInternal,
    charge,
    priceEach,
    ...(String(markupPct ?? "").trim() !== "" ? { markupPct } : {}),
  };
}

function normalizeAdditionalChargeTemplateItem(record = {}) {
  const source = isPlainObject(record) ? record : {};
  const id = String(source.id || "").trim() || createTemplateItemId("charge");
  const desc = String(source.desc ?? "").trim();
  const qty = source.qty ?? "";
  const priceEach = source.priceEach ?? "";
  const hasMeaningfulContent = Boolean(
    desc
    || String(qty ?? "").trim()
    || String(priceEach ?? "").trim()
  );
  if (!hasMeaningfulContent) return null;
  return {
    id,
    desc,
    qty,
    priceEach,
  };
}

function normalizeTemplateItems(records, normalizeRecord) {
  const arr = Array.isArray(records) ? records : [];
  const next = [];
  const seen = new Set();
  for (const record of arr) {
    const normalized = normalizeRecord(record);
    if (!normalized) continue;
    if (seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    next.push(normalized);
  }
  return next;
}

function hasMeaningfulBlanketMaterialContent(source = {}) {
  return Boolean(
    String(source.materialsBlanketDescription ?? "").trim()
    || String(source.materialsBlanketCost ?? "").trim()
    || String(source.materialsBlanketInternalCost ?? "").trim()
  );
}

function buildTemplateNameFallback(scopeText, laborItems, materialItems, additionalChargeItems, additionalNotes, blanketSource = {}) {
  const candidates = [
    scopeText,
    String(laborItems?.[0]?.label || laborItems?.[0]?.role || "").trim(),
    String(materialItems?.[0]?.desc || "").trim(),
    String(additionalChargeItems?.[0]?.desc || "").trim(),
    additionalNotes,
    String(blanketSource.materialsBlanketDescription || "").trim(),
  ];
  for (const candidate of candidates) {
    const firstLine = String(candidate || "")
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean) || "";
    if (firstLine) return firstLine;
  }
  return "";
}

function normalizeTemplateName(value, scopeText = "", laborItems = [], materialItems = [], additionalChargeItems = [], additionalNotes = "", blanketSource = {}) {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (raw) return raw;
  const fallback = buildTemplateNameFallback(
    scopeText,
    laborItems,
    materialItems,
    additionalChargeItems,
    additionalNotes,
    blanketSource
  );
  if (!fallback) return "";
  return fallback.length > 72 ? `${fallback.slice(0, 69).trimEnd()}…` : fallback;
}

function normalizeTemplateSchemaVersion(value, hasStructuredContent) {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  return hasStructuredContent ? WORK_PACKAGE_TEMPLATE_SCHEMA_VERSION : 1;
}

export function isLegacyScopeTemplateRecord(record = {}) {
  const source = record && typeof record === "object" ? record : {};
  const schemaVersion = Number(source.schemaVersion || source.version || 1) || 1;
  const hasLaborItems = Array.isArray(source.laborItems) && source.laborItems.length > 0;
  const hasMaterialItems = Array.isArray(source.materialItems) && source.materialItems.length > 0;
  const hasAdditionalChargeItems = Array.isArray(source.additionalChargeItems) && source.additionalChargeItems.length > 0;
  const hasAdditionalNotes = Boolean(String(source.additionalNotes || "").trim());
  const hasBlanketMaterials = hasMeaningfulBlanketMaterialContent(source);
  return schemaVersion < WORK_PACKAGE_TEMPLATE_SCHEMA_VERSION
    && !hasLaborItems
    && !hasMaterialItems
    && !hasAdditionalChargeItems
    && !hasAdditionalNotes
    && !hasBlanketMaterials;
}

export function normalizeScopeTemplateRecord(record = {}, options = {}) {
  const source = record && typeof record === "object" ? record : {};
  const scopeText = normalizeTemplateText(
    source.scopeText
    || source.text
    || source.scope
    || options.scopeText
  );
  const laborItems = normalizeTemplateItems(
    readArrayCandidate(
      source.laborItems,
      source.labor?.lines,
      options.laborItems
    ),
    normalizeLaborTemplateItem
  );
  const materialItems = normalizeTemplateItems(
    readArrayCandidate(
      source.materialItems,
      source.materials?.items,
      options.materialItems
    ),
    normalizeMaterialTemplateItem
  );
  const additionalChargeItems = normalizeTemplateItems(
    readArrayCandidate(
      source.additionalChargeItems,
      source.additionalCharges?.items,
      options.additionalChargeItems
    ),
    normalizeAdditionalChargeTemplateItem
  );
  const additionalNotes = normalizeTextValue(
    source.additionalNotes
    ?? options.additionalNotes
  );
  const materialsModeRaw = String(
    source.materialsMode
    || source.ui?.materialsMode
    || options.materialsMode
    || ""
  ).trim().toLowerCase();
  const materialsMode = materialsModeRaw === "blanket"
    ? "blanket"
    : (materialsModeRaw === "itemized" ? "itemized" : "");
  const materialsBlanketDescription = normalizeTextValue(
    source.materialsBlanketDescription
    ?? source.materials?.materialsBlanketDescription
    ?? options.materialsBlanketDescription
  );
  const materialsBlanketCost = source.materialsBlanketCost
    ?? source.materials?.blanketCost
    ?? options.materialsBlanketCost
    ?? "";
  const materialsBlanketInternalCost = source.materialsBlanketInternalCost
    ?? source.materials?.blanketInternalCost
    ?? options.materialsBlanketInternalCost
    ?? "";
  const materialsMarkupPct = source.materialsMarkupPct
    ?? source.materials?.markupPct
    ?? options.materialsMarkupPct
    ?? "";
  const hasBlanketMaterials = hasMeaningfulBlanketMaterialContent({
    materialsBlanketDescription,
    materialsBlanketCost,
    materialsBlanketInternalCost,
    materialsMarkupPct,
  });
  const hasStructuredContent = Boolean(
    laborItems.length
    || materialItems.length
    || additionalChargeItems.length
    || additionalNotes
    || hasBlanketMaterials
  );
  if (!scopeText && !hasStructuredContent) return null;

  const name = normalizeTemplateName(
    source.name
    || source.label
    || options.name,
    scopeText,
    laborItems,
    materialItems,
    additionalChargeItems,
    additionalNotes,
    {
      materialsBlanketDescription,
    }
  );
  if (!name) return null;

  const id = String(source.id || options.id || "").trim() || createScopeTemplateId();
  const createdAt = normalizeTimestamp(source.createdAt || options.createdAt || Date.now(), Date.now());
  const updatedAt = normalizeTimestamp(source.updatedAt || options.updatedAt || createdAt, createdAt);
  const sourceEstimateId = String(source.sourceEstimateId || options.sourceEstimateId || "").trim();
  const sourceEstimateNumber = String(source.sourceEstimateNumber || options.sourceEstimateNumber || "").trim();
  const schemaVersion = normalizeTemplateSchemaVersion(
    source.schemaVersion || source.version || options.schemaVersion,
    hasStructuredContent
  );

  return {
    id,
    name,
    scopeText,
    laborItems,
    materialItems,
    additionalChargeItems,
    additionalNotes,
    schemaVersion,
    ...(materialsMode ? { materialsMode } : {}),
    ...(materialsBlanketDescription ? { materialsBlanketDescription } : {}),
    ...(String(materialsBlanketCost ?? "").trim() !== "" ? { materialsBlanketCost } : {}),
    ...(String(materialsBlanketInternalCost ?? "").trim() !== "" ? { materialsBlanketInternalCost } : {}),
    ...(String(materialsMarkupPct ?? "").trim() !== "" ? { materialsMarkupPct } : {}),
    createdAt,
    updatedAt,
    ...(sourceEstimateId ? { sourceEstimateId } : {}),
    ...(sourceEstimateNumber ? { sourceEstimateNumber } : {}),
  };
}

function normalizeScopeTemplateList(records = []) {
  const arr = Array.isArray(records) ? records.filter(Boolean) : [];
  const seenIds = new Set();
  const next = [];

  for (const record of arr) {
    const normalized = normalizeScopeTemplateRecord(record);
    if (!normalized) continue;
    if (seenIds.has(normalized.id)) continue;
    seenIds.add(normalized.id);
    next.push(normalized);
  }

  next.sort((a, b) => {
    const delta = Number(b.updatedAt || 0) - Number(a.updatedAt || 0);
    if (delta !== 0) return delta;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });

  return next;
}

export function readStoredScopeTemplates() {
  try {
    const raw = localStorage.getItem(SCOPE_TEMPLATES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return normalizeScopeTemplateList(Array.isArray(parsed) ? parsed : []);
  } catch {
    return [];
  }
}

export function writeStoredScopeTemplates(templates) {
  const next = normalizeScopeTemplateList(templates);
  try {
    localStorage.setItem(SCOPE_TEMPLATES_KEY, JSON.stringify(next));
  } catch {}
  return next;
}

export function createScopeTemplate(record = {}, options = {}) {
  return normalizeScopeTemplateRecord(record, options);
}

export function updateScopeTemplate(templates = [], templateId = "", updates = {}) {
  const id = String(templateId || updates?.id || "").trim();
  if (!id) return normalizeScopeTemplateList(templates);
  const next = (Array.isArray(templates) ? templates : []).map((entry) => {
    if (String(entry?.id || "").trim() !== id) return entry;
    return {
      ...entry,
      ...updates,
      id,
      updatedAt: updates?.updatedAt || Date.now(),
    };
  });
  return normalizeScopeTemplateList(next);
}

export function deleteScopeTemplate(templates = [], templateId = "") {
  const id = String(templateId || "").trim();
  if (!id) return normalizeScopeTemplateList(templates);
  return normalizeScopeTemplateList((Array.isArray(templates) ? templates : []).filter((entry) => String(entry?.id || "").trim() !== id));
}
