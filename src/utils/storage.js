// @ts-nocheck
/* eslint-disable */

import { STORAGE_KEYS } from "../constants/storageKeys";

export const DEFAULT_COMPANY_PROFILE = {
  companyName: "",
  phone: "",
  email: "",
  address: "",
  logoDataUrl: "",
  roc: "",
  attn: "",
  website: "",
  ein: "",
  terms: "",
};

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
    let raw = localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE);
    if (!raw) {
      raw = localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE_LEGACY_1) || localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE_LEGACY_2) || "";
      if (raw) {
        try {
          localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, raw);
          localStorage.removeItem(STORAGE_KEYS.COMPANY_PROFILE_LEGACY_1);
          localStorage.removeItem(STORAGE_KEYS.COMPANY_PROFILE_LEGACY_2);
        } catch {}
      }
    }
    if (!raw) return { ...DEFAULT_COMPANY_PROFILE };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_COMPANY_PROFILE, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_COMPANY_PROFILE };
  }
}
