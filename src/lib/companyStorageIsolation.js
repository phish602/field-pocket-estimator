import { STORAGE_KEYS } from "../constants/storageKeys";

const APP_KEY_PREFIX = "estipaid-";
const COMPANY_SCOPE_PREFIX = "estipaid-company-v1:";
const COMPANY_READY_PREFIX = "estipaid-company-storage-ready-v1:";
const LEGACY_OWNER_KEY = "estipaid-legacy-storage-owner-v1";

let activeCompanyId = "";
let storagePatched = false;
let rawMethods = null;

const LEGACY_IMPORT_KEYS = new Set([
  STORAGE_KEYS.LANG,
  STORAGE_KEYS.SETTINGS,
  STORAGE_KEYS.ESTIMATOR_STATE,
  STORAGE_KEYS.ESTIMATE_DRAFT,
  STORAGE_KEYS.ESTIMATES,
  STORAGE_KEYS.PROJECTS,
  STORAGE_KEYS.INVOICES,
  STORAGE_KEYS.PENDING_CUSTOMER_USE,
  STORAGE_KEYS.PENDING_CUSTOMER_CREATE,
  STORAGE_KEYS.PENDING_CUSTOMER_EDIT,
  STORAGE_KEYS.CUSTOMER_EDIT_TARGET,
  STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE,
  STORAGE_KEYS.SELECTED_CUSTOMER_ID,
  STORAGE_KEYS.SELECTED_CUSTOMER_SNAP,
  STORAGE_KEYS.CUSTOMERS,
  STORAGE_KEYS.CUSTOMER_RECENTS,
  STORAGE_KEYS.COMPANY_PROFILE,
  STORAGE_KEYS.AUDIT_EVENTS,
  STORAGE_KEYS.SCOPE_TEMPLATES,
  STORAGE_KEYS.CUSTOM_LABOR_ROLES,
  STORAGE_KEYS.JOB_LEARNING_REVIEWED_CANDIDATES,
  "estipaid-edit-estimate-target-v1",
  "estipaid-edit-invoice-target-v1",
  "estipaid-active-edit-context-v1",
  "estipaid-profile-return-target-v1",
  "estipaid-project-detail-return-target-v1",
  "estipaid-project-create-seed-v1",
]);

const MEANINGFUL_LEGACY_KEYS = new Set([
  STORAGE_KEYS.COMPANY_PROFILE,
  STORAGE_KEYS.ESTIMATOR_STATE,
  STORAGE_KEYS.ESTIMATE_DRAFT,
  STORAGE_KEYS.ESTIMATES,
  STORAGE_KEYS.PROJECTS,
  STORAGE_KEYS.INVOICES,
  STORAGE_KEYS.CUSTOMERS,
  STORAGE_KEYS.SCOPE_TEMPLATES,
]);

function storageAvailable() {
  return typeof window !== "undefined" && !!window.localStorage;
}

function captureRawMethods() {
  if (!storageAvailable()) return null;
  if (rawMethods) return rawMethods;
  const storage = window.localStorage;
  rawMethods = {
    storage,
    getItem: Storage.prototype.getItem.bind(storage),
    setItem: Storage.prototype.setItem.bind(storage),
    removeItem: Storage.prototype.removeItem.bind(storage),
    clear: Storage.prototype.clear.bind(storage),
    key: Storage.prototype.key.bind(storage),
    get length() {
      return storage.length;
    },
  };
  return rawMethods;
}

function rawGetItem(key) {
  try {
    return captureRawMethods()?.getItem(String(key)) ?? null;
  } catch {
    return null;
  }
}

function rawSetItem(key, value) {
  captureRawMethods()?.setItem(String(key), String(value));
}

function rawRemoveItem(key) {
  try {
    captureRawMethods()?.removeItem(String(key));
  } catch {}
}

function rawKeys() {
  const raw = captureRawMethods();
  if (!raw) return [];
  const keys = [];
  try {
    for (let index = 0; index < raw.length; index += 1) {
      const key = raw.key(index);
      if (key) keys.push(String(key));
    }
  } catch {}
  return keys;
}

function normalizeCompanyId(value) {
  return String(value || "").trim();
}

function isInternalStorageKey(key) {
  const value = String(key || "");
  return value.startsWith(COMPANY_SCOPE_PREFIX)
    || value.startsWith(COMPANY_READY_PREFIX)
    || value === LEGACY_OWNER_KEY;
}

function shouldScopeKey(key) {
  const value = String(key || "");
  return value.startsWith(APP_KEY_PREFIX) && !isInternalStorageKey(value);
}

function scopedKey(companyId, key) {
  return `${COMPANY_SCOPE_PREFIX}${normalizeCompanyId(companyId)}:${String(key)}`;
}

function readyKey(companyId) {
  return `${COMPANY_READY_PREFIX}${normalizeCompanyId(companyId)}`;
}

function unscopedKeyFromScoped(companyId, key) {
  const prefix = `${COMPANY_SCOPE_PREFIX}${normalizeCompanyId(companyId)}:`;
  return String(key || "").startsWith(prefix) ? String(key).slice(prefix.length) : "";
}

function mapActiveKey(key) {
  const normalizedKey = String(key || "");
  if (!activeCompanyId || !shouldScopeKey(normalizedKey)) return normalizedKey;
  return scopedKey(activeCompanyId, normalizedKey);
}

function visibleKeysForActiveCompany() {
  const keys = rawKeys();
  if (!activeCompanyId) return keys;
  const visible = [];
  const activePrefix = `${COMPANY_SCOPE_PREFIX}${activeCompanyId}:`;
  keys.forEach((key) => {
    if (key.startsWith(activePrefix)) {
      const virtualKey = key.slice(activePrefix.length);
      if (virtualKey) visible.push(virtualKey);
      return;
    }
    if (key.startsWith(COMPANY_SCOPE_PREFIX) || isInternalStorageKey(key)) return;
    if (shouldScopeKey(key)) return;
    visible.push(key);
  });
  return visible;
}

export function installCompanyStorageIsolation() {
  if (!storageAvailable()) return false;
  if (storagePatched) return true;
  const raw = captureRawMethods();
  if (!raw) return false;
  const storage = raw.storage;

  storage.getItem = (key) => raw.getItem(mapActiveKey(key));
  storage.setItem = (key, value) => raw.setItem(mapActiveKey(key), String(value));
  storage.removeItem = (key) => raw.removeItem(mapActiveKey(key));
  storage.key = (index) => visibleKeysForActiveCompany()[Number(index)] || null;
  storage.clear = () => {
    if (!activeCompanyId) {
      raw.clear();
      return;
    }
    const prefix = `${COMPANY_SCOPE_PREFIX}${activeCompanyId}:`;
    rawKeys().forEach((key) => {
      if (key.startsWith(prefix)) raw.removeItem(key);
    });
  };

  storagePatched = true;
  return true;
}

export function deactivateCompanyStorageNamespace() {
  activeCompanyId = "";
}

export function getActiveCompanyStorageNamespace() {
  return activeCompanyId;
}

export function activateCompanyStorageNamespace(companyId) {
  const normalized = normalizeCompanyId(companyId);
  if (!normalized) return false;
  installCompanyStorageIsolation();
  activeCompanyId = normalized;
  rawSetItem(readyKey(normalized), "1");
  return true;
}

function companyHasScopedStorage(companyId) {
  const normalized = normalizeCompanyId(companyId);
  if (!normalized) return false;
  if (rawGetItem(readyKey(normalized)) === "1") return true;
  const prefix = `${COMPANY_SCOPE_PREFIX}${normalized}:`;
  return rawKeys().some((key) => key.startsWith(prefix));
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasMeaningfulLegacyValue(key, rawValue) {
  if (!MEANINGFUL_LEGACY_KEYS.has(key) || rawValue == null || rawValue === "") return false;
  const parsed = safeParse(rawValue);
  if (key === STORAGE_KEYS.COMPANY_PROFILE) {
    if (!parsed || typeof parsed !== "object") return rawValue.length > 20;
    return Boolean(
      String(parsed.companyName || parsed.name || "").trim()
      || String(parsed.logoDataUrl || "").trim()
      || String(parsed.phone || "").trim()
      || String(parsed.address || parsed.addressLine1 || "").trim()
    );
  }
  if (Array.isArray(parsed)) return parsed.length > 0;
  if (parsed && typeof parsed === "object") return Object.keys(parsed).length > 0;
  return rawValue.trim().length > 2;
}

export function inspectLegacyCompanyData() {
  const keys = [];
  let companyName = "";
  LEGACY_IMPORT_KEYS.forEach((key) => {
    const rawValue = rawGetItem(key);
    if (rawValue == null) return;
    keys.push(key);
    if (key === STORAGE_KEYS.COMPANY_PROFILE) {
      const profile = safeParse(rawValue);
      companyName = String(profile?.companyName || profile?.name || "").trim();
    }
  });
  const meaningfulKeys = keys.filter((key) => hasMeaningfulLegacyValue(key, rawGetItem(key)));
  return {
    exists: meaningfulKeys.length > 0,
    companyName,
    keys,
    meaningfulKeys,
    recordGroups: meaningfulKeys.length,
    ownerCompanyId: String(rawGetItem(LEGACY_OWNER_KEY) || "").trim(),
  };
}

export function prepareCompanyStorage(companyId) {
  const normalized = normalizeCompanyId(companyId);
  if (!normalized) return { status: "error", error: "Missing company ID." };
  installCompanyStorageIsolation();

  if (companyHasScopedStorage(normalized)) {
    activateCompanyStorageNamespace(normalized);
    return { status: "ready", importedLegacy: false };
  }

  const legacy = inspectLegacyCompanyData();
  if (legacy.ownerCompanyId) {
    if (legacy.ownerCompanyId === normalized) {
      return importLegacyCompanyStorage(normalized);
    }
    activateCompanyStorageNamespace(normalized);
    return { status: "ready", importedLegacy: false, legacyOwnedByAnotherCompany: true };
  }

  if (legacy.exists) {
    return { status: "decision_required", legacy };
  }

  activateCompanyStorageNamespace(normalized);
  return { status: "ready", importedLegacy: false };
}

export function startWithEmptyCompanyStorage(companyId) {
  const normalized = normalizeCompanyId(companyId);
  if (!normalized) return { status: "error", error: "Missing company ID." };
  activateCompanyStorageNamespace(normalized);
  return { status: "ready", importedLegacy: false };
}

export function importLegacyCompanyStorage(companyId) {
  const normalized = normalizeCompanyId(companyId);
  if (!normalized) return { status: "error", error: "Missing company ID." };
  installCompanyStorageIsolation();

  const copiedKeys = [];
  LEGACY_IMPORT_KEYS.forEach((key) => {
    const rawValue = rawGetItem(key);
    if (rawValue == null) return;
    rawSetItem(scopedKey(normalized, key), rawValue);
    copiedKeys.push(key);
  });
  rawSetItem(LEGACY_OWNER_KEY, normalized);
  rawSetItem(readyKey(normalized), "1");
  activeCompanyId = normalized;
  return { status: "ready", importedLegacy: copiedKeys.length > 0, copiedKeys };
}

export function prefillCompanyProfileForSetup(companyName) {
  const normalizedName = String(companyName || "").trim();
  if (!activeCompanyId || !normalizedName) return false;
  let profile = {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) profile = parsed;
  } catch {}

  if (!String(profile.companyName || profile.name || "").trim()) {
    profile.companyName = normalizedName;
    try {
      window.localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(profile));
      return true;
    } catch {
      return false;
    }
  }
  return true;
}

export const companyStorageIsolationInternals = {
  APP_KEY_PREFIX,
  COMPANY_SCOPE_PREFIX,
  COMPANY_READY_PREFIX,
  LEGACY_OWNER_KEY,
  LEGACY_IMPORT_KEYS,
  scopedKey,
  unscopedKeyFromScoped,
  rawGetItem,
  rawSetItem,
  rawRemoveItem,
};
