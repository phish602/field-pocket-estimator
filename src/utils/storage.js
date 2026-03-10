// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";
import { sanitizePhoneDigits } from "./sanitize";

export const DEFAULT_COMPANY_PROFILE = {
  companyName: "",
  phone: "",
  email: "",
  address: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  state: "",
  zip: "",
  logoDataUrl: "",
  roc: "",
  attn: "",
  website: "",
  ein: "",
  terms: "",
};

const STATE_ZIP_PATTERN = /^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/;
const LEGACY_STORAGE_KEYS = {
  LANG: "field-pocket-language",
  THEME: "field-pocket-theme",
  SHOW_COSTS: "field-pocket-show-costs",
  PROFILE: "field-pocket-profile",
  PROFILE_V1: "field-pocket-profile-v1",
  CUSTOMERS: "field-pocket-customers-v1",
  ESTIMATES: "field-pocket-estimates",
  INVOICES: "field-pocket-invoices-v1",
};
const STORAGE_MIGRATION_DONE_KEY = "estipaid-storage-migrated-v1";

function safeParseJSON(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function hasStorageValue(key) {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

function parseLegacyBool(raw) {
  if (typeof raw === "boolean") return raw;
  const v = String(raw || "").trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return null;
}

function removeLegacyKey(key) {
  try {
    if (localStorage.getItem(key) === null) return false;
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function migrateLegacyArray(legacyKey, canonicalKey) {
  try {
    const legacyRaw = localStorage.getItem(legacyKey);
    if (legacyRaw === null) return false;
    if (hasStorageValue(canonicalKey)) {
      removeLegacyKey(legacyKey);
      return false;
    }
    const parsed = safeParseJSON(legacyRaw);
    if (!Array.isArray(parsed)) return false;
    localStorage.setItem(canonicalKey, JSON.stringify(parsed));
    removeLegacyKey(legacyKey);
    return true;
  } catch {
    return false;
  }
}

function migrateLegacyObject(legacyKey, canonicalKey, normalizer) {
  try {
    const legacyRaw = localStorage.getItem(legacyKey);
    if (legacyRaw === null) return false;
    if (hasStorageValue(canonicalKey)) {
      removeLegacyKey(legacyKey);
      return false;
    }
    const parsed = safeParseJSON(legacyRaw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    const next = typeof normalizer === "function" ? normalizer(parsed) : parsed;
    localStorage.setItem(canonicalKey, JSON.stringify(next));
    removeLegacyKey(legacyKey);
    return true;
  } catch {
    return false;
  }
}

export function migrateLegacyStorageNamespace() {
  try {
    if (typeof localStorage === "undefined") return false;
  } catch {
    return false;
  }

  try {
    if (localStorage.getItem(STORAGE_MIGRATION_DONE_KEY) === "1") return false;
  } catch {
    return false;
  }

  let migratedAny = false;

  try {
    const legacyLang = localStorage.getItem(LEGACY_STORAGE_KEYS.LANG);
    const hasCanonicalLang = hasStorageValue(STORAGE_KEYS.LANG);
    if (legacyLang !== null && !hasCanonicalLang) {
      const lang = String(legacyLang || "").trim().toLowerCase();
      if (lang === "en" || lang === "es") {
        localStorage.setItem(STORAGE_KEYS.LANG, lang);
        migratedAny = true;
      }
    }
    if (legacyLang !== null && (hasStorageValue(STORAGE_KEYS.LANG) || String(legacyLang || "").trim() === "")) {
      removeLegacyKey(LEGACY_STORAGE_KEYS.LANG);
    }
  } catch {}

  try {
    const legacyShowCosts = localStorage.getItem(LEGACY_STORAGE_KEYS.SHOW_COSTS);
    const hasCanonicalSettings = hasStorageValue(STORAGE_KEYS.SETTINGS);
    if (legacyShowCosts !== null && !hasCanonicalSettings) {
      const parsedShowCosts = parseLegacyBool(legacyShowCosts);
      if (parsedShowCosts !== null) {
        localStorage.setItem(
          STORAGE_KEYS.SETTINGS,
          JSON.stringify({ internal: { showInternalCostFields: parsedShowCosts } })
        );
        migratedAny = true;
      }
    }
    if (legacyShowCosts !== null && hasStorageValue(STORAGE_KEYS.SETTINGS)) {
      removeLegacyKey(LEGACY_STORAGE_KEYS.SHOW_COSTS);
    }
  } catch {}

  try {
    if (migrateLegacyObject(LEGACY_STORAGE_KEYS.PROFILE_V1, STORAGE_KEYS.COMPANY_PROFILE, normalizeCompanyProfile)) {
      migratedAny = true;
    }
    if (migrateLegacyObject(LEGACY_STORAGE_KEYS.PROFILE, STORAGE_KEYS.COMPANY_PROFILE, normalizeCompanyProfile)) {
      migratedAny = true;
    }
    if (hasStorageValue(STORAGE_KEYS.COMPANY_PROFILE)) {
      removeLegacyKey(LEGACY_STORAGE_KEYS.PROFILE_V1);
      removeLegacyKey(LEGACY_STORAGE_KEYS.PROFILE);
    }
  } catch {}

  if (migrateLegacyArray(LEGACY_STORAGE_KEYS.CUSTOMERS, STORAGE_KEYS.CUSTOMERS)) migratedAny = true;
  if (migrateLegacyArray(LEGACY_STORAGE_KEYS.ESTIMATES, STORAGE_KEYS.ESTIMATES)) migratedAny = true;
  if (migrateLegacyArray(LEGACY_STORAGE_KEYS.INVOICES, STORAGE_KEYS.INVOICES)) migratedAny = true;

  removeLegacyKey(LEGACY_STORAGE_KEYS.THEME);

  try {
    localStorage.setItem(STORAGE_MIGRATION_DONE_KEY, "1");
  } catch {}

  return migratedAny;
}

function parseLegacyAddress(address) {
  const raw = String(address || "").trim();
  if (!raw) return {};
  const lines = raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!lines.length) return {};

  const out = {
    addressLine1: lines[0] || "",
    addressLine2: "",
    city: "",
    state: "",
    zip: "",
  };

  if (lines.length >= 2) {
    const second = lines[1];
    const parts = second.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      out.city = parts[0] || "";
      const tail = parts.slice(1).join(" ");
      const m = STATE_ZIP_PATTERN.exec(tail);
      if (m) {
        out.state = m[1].toUpperCase();
        out.zip = m[2];
      } else {
        const tokens = tail.split(/\s+/).filter(Boolean);
        out.state = (tokens[0] || "").toUpperCase();
        out.zip = tokens.slice(1).join(" ");
      }
    } else if (parts.length === 1) {
      out.city = parts[0];
    }
  }

  if (lines.length >= 3 && !out.addressLine2) {
    out.addressLine2 = lines[1] || "";
    const third = lines[2] || "";
    const parts = third.split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      out.city = out.city || parts[0];
      const tail = parts.slice(1).join(" ");
      const m = STATE_ZIP_PATTERN.exec(tail);
      if (m) {
        out.state = out.state || m[1].toUpperCase();
        out.zip = out.zip || m[2];
      }
    }
  }

  return out;
}

export function composeAddressFull(profile) {
  const p = profile || {};
  const line1 = String(p.addressLine1 || "").trim();
  const line2 = String(p.addressLine2 || "").trim();
  const city = String(p.city || "").trim();
  const state = String(p.state || "").trim().toUpperCase();
  const zip = String(p.zip || "").trim();
  const cityState = [city, state].filter(Boolean).join(", ");
  const cityStateZip = [cityState, zip].filter(Boolean).join(" ");
  return [line1, line2, cityStateZip].filter(Boolean).join("\n");
}

export function normalizeCompanyProfile(profile) {
  const base = { ...DEFAULT_COMPANY_PROFILE, ...(profile || {}) };
  const legacyParsed = parseLegacyAddress(base.address);

  const normalized = {
    ...base,
    phone: sanitizePhoneDigits(base.phone, 11),
    addressLine1: String(base.addressLine1 || legacyParsed.addressLine1 || "").trim(),
    addressLine2: String(base.addressLine2 || legacyParsed.addressLine2 || "").trim(),
    city: String(base.city || legacyParsed.city || "").trim(),
    state: String(base.state || legacyParsed.state || "").trim().toUpperCase(),
    zip: String(base.zip || legacyParsed.zip || "").trim(),
  };

  normalized.address = composeAddressFull(normalized);
  return normalized;
}

export function readJsonStorage(key, fallback = null) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function loadCompanyProfile() {
  try {
    migrateLegacyStorageNamespace();
    const raw = localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE) || "";
    if (!raw) return { ...DEFAULT_COMPANY_PROFILE };
    const parsed = JSON.parse(raw);
    return normalizeCompanyProfile(parsed || {});
  } catch {
    return { ...DEFAULT_COMPANY_PROFILE };
  }
}
