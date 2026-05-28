import { STORAGE_KEYS } from "../constants/storageKeys";

const DEFAULT_CUSTOM_LABOR_ROLES_KEY = STORAGE_KEYS.CUSTOM_LABOR_ROLES || "estipaid-custom-labor-roles-v1";

function normalizeLaborRoleLabel(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeLaborRoleLabelKey(value) {
  return normalizeLaborRoleLabel(value).toLowerCase();
}

function hasPresetLabel(labelKey, presetByNormalizedLabel) {
  if (!labelKey || !presetByNormalizedLabel) return false;
  if (typeof presetByNormalizedLabel.has === "function") return presetByNormalizedLabel.has(labelKey);
  return Boolean(presetByNormalizedLabel[labelKey]);
}

function findPresetLabel(labelKey, presetByNormalizedLabel) {
  if (!labelKey || !presetByNormalizedLabel) return null;
  if (typeof presetByNormalizedLabel.get === "function") return presetByNormalizedLabel.get(labelKey) || null;
  return presetByNormalizedLabel[labelKey] || null;
}

export function normalizeCustomLaborRoleList(records = [], options = {}) {
  const presetByNormalizedLabel = options?.presetByNormalizedLabel;
  const seen = new Set();
  const next = [];
  for (const record of Array.isArray(records) ? records : []) {
    const rawLabel = typeof record === "string" ? record : record?.label;
    const label = normalizeLaborRoleLabel(rawLabel);
    const labelKey = normalizeLaborRoleLabelKey(label);
    if (!labelKey || seen.has(labelKey) || hasPresetLabel(labelKey, presetByNormalizedLabel)) continue;
    seen.add(labelKey);
    next.push(label);
  }
  return next;
}

export function readStoredCustomLaborRoles(options = {}) {
  const storageKey = options?.storageKey || DEFAULT_CUSTOM_LABOR_ROLES_KEY;
  try {
    const raw = localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return normalizeCustomLaborRoleList(parsed, options);
  } catch {
    return [];
  }
}

export function writeStoredCustomLaborRoles(labels = [], options = {}) {
  const storageKey = options?.storageKey || DEFAULT_CUSTOM_LABOR_ROLES_KEY;
  const next = normalizeCustomLaborRoleList(labels, options);
  try {
    const value = JSON.stringify(next);
    localStorage.setItem(storageKey, value);
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: storageKey, value } }));
    }
  } catch {}
  return next;
}

export function findSavedCustomLaborRoleLabel(label = "", customLaborRoles = []) {
  const labelKey = normalizeLaborRoleLabelKey(label);
  if (!labelKey) return "";
  return customLaborRoles.find((savedLabel) => normalizeLaborRoleLabelKey(savedLabel) === labelKey) || "";
}

export function getLegacyLaborRoleLabel(label = "", customLaborRoles = [], options = {}) {
  const presetByNormalizedLabel = options?.presetByNormalizedLabel;
  const rawLabel = String(label || "").trim();
  const labelKey = normalizeLaborRoleLabelKey(rawLabel);
  if (!labelKey) return "";
  if (hasPresetLabel(labelKey, presetByNormalizedLabel)) return "";
  if (findSavedCustomLaborRoleLabel(rawLabel, customLaborRoles)) return "";
  return rawLabel;
}

export function resolveLaborRoleSelectValue(label = "", customLaborRoles = [], options = {}) {
  const presetByNormalizedLabel = options?.presetByNormalizedLabel;
  const legacyLabel = getLegacyLaborRoleLabel(label, customLaborRoles, options);
  if (legacyLabel) return legacyLabel;
  const preset = findPresetLabel(normalizeLaborRoleLabelKey(label), presetByNormalizedLabel);
  if (preset?.label) return preset.label;
  return findSavedCustomLaborRoleLabel(label, customLaborRoles) || String(label || "").trim();
}
