// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";

const SCOPE_TEMPLATES_KEY = STORAGE_KEYS.SCOPE_TEMPLATES;

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

function normalizeTemplateText(value) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim();
}

function normalizeTemplateName(value, scopeText = "") {
  const raw = String(value ?? "").replace(/\s+/g, " ").trim();
  if (raw) return raw;
  const fallback = String(scopeText || "")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean) || "";
  if (!fallback) return "";
  return fallback.length > 72 ? `${fallback.slice(0, 69).trimEnd()}…` : fallback;
}

export function normalizeScopeTemplateRecord(record = {}, options = {}) {
  const source = record && typeof record === "object" ? record : {};
  const scopeText = normalizeTemplateText(
    source.scopeText
    || source.text
    || source.scope
    || options.scopeText
  );
  if (!scopeText) return null;

  const name = normalizeTemplateName(
    source.name
    || source.label
    || options.name,
    scopeText
  );
  if (!name) return null;

  const id = String(source.id || options.id || "").trim() || createScopeTemplateId();
  const createdAt = normalizeTimestamp(source.createdAt || options.createdAt || Date.now(), Date.now());
  const updatedAt = normalizeTimestamp(source.updatedAt || options.updatedAt || createdAt, createdAt);
  const sourceEstimateId = String(source.sourceEstimateId || options.sourceEstimateId || "").trim();
  const sourceEstimateNumber = String(source.sourceEstimateNumber || options.sourceEstimateNumber || "").trim();

  return {
    id,
    name,
    scopeText,
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
