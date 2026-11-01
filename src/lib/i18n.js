// @ts-nocheck
/* eslint-disable */

// EstiPaid's single bilingual owner.
//
// There is exactly one language value in the app: the "en" | "es" string stored
// under STORAGE_KEYS.LANG. This module owns reading it, writing it, announcing
// changes on the channels EstiPaid already uses (`storage`, `pe-localstorage`,
// `estipaid:lang`), and turning it into UI copy through one dictionary.
//
// Screens must not keep their own language state or their own en/es literals --
// they subscribe here with `useLanguage()` / `useT()` and read copy with `t()`.
// The store is a module singleton rather than a React provider so that every
// mounted surface (shell, screens, builder, modals) observes the same value with
// no wrapper to forget and no second source of truth to drift.

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { DICTIONARY } from "./i18nDictionary";

export const LANG_STORAGE_KEY = STORAGE_KEYS.LANG;
export const SUPPORTED_LANGUAGES = ["en", "es"];
export const DEFAULT_LANGUAGE = "en";
export const LANG_CHANGE_EVENT = "estipaid:lang";
export const LOCAL_STORAGE_EVENT = "pe-localstorage";

export function normalizeLanguage(value) {
  return String(value == null ? "" : value).trim().toLowerCase() === "es" ? "es" : "en";
}

function readStoredLanguage() {
  try {
    return localStorage.getItem(LANG_STORAGE_KEY) === "es" ? "es" : "en";
  } catch {
    return DEFAULT_LANGUAGE;
  }
}

let currentLanguage = readStoredLanguage();
// The last value we observed in storage. The live value stays authoritative
// unless storage itself has moved since we looked -- so a write that fails
// (private mode, quota) still switches the UI for this session instead of
// being silently reverted by the next read.
let lastSeenStored = currentLanguage;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // a bad subscriber must never stop the rest of the app from following
    }
  });
}

// Adopts the stored value only when storage has actually changed since we last
// looked. Returns true when the live value moved.
function adoptStoredLanguage() {
  const stored = readStoredLanguage();
  if (stored === lastSeenStored) return false;
  lastSeenStored = stored;
  if (stored === currentLanguage) return false;
  currentLanguage = stored;
  return true;
}

function refreshFromStorage() {
  if (adoptStoredLanguage()) emit();
}

function onLocalStorageEvent(event) {
  if (!event?.detail || event.detail.key === LANG_STORAGE_KEY) refreshFromStorage();
}

let wired = false;
function ensureWired() {
  if (wired || typeof window === "undefined" || !window.addEventListener) return;
  wired = true;
  // The same three channels the rest of EstiPaid already writes: cross-tab
  // `storage`, same-tab `pe-localstorage`, and the dedicated language event.
  window.addEventListener("storage", refreshFromStorage);
  window.addEventListener(LOCAL_STORAGE_EVENT, onLocalStorageEvent);
  window.addEventListener(LANG_CHANGE_EVENT, refreshFromStorage);
}
ensureWired();

export function getLanguage() {
  // Re-check on access so a surface that mounts after a direct storage write
  // (restore, another tab, a test fixture) still starts on the stored value.
  adoptStoredLanguage();
  return currentLanguage;
}

export function subscribeLanguage(listener) {
  ensureWired();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// The only writer. Persists to the one canonical key and announces the change on
// the existing channels so every mounted surface follows in place -- no reload,
// no remount, and no business state touched.
export function setLanguage(requested) {
  const next = normalizeLanguage(requested);
  const stored = readStoredLanguage();
  if (next === stored && next === currentLanguage) return next;
  try {
    localStorage.setItem(LANG_STORAGE_KEY, next);
  } catch {
    // a storage failure still updates the live UI for this session
  }
  currentLanguage = next;
  lastSeenStored = readStoredLanguage();
  try {
    window.dispatchEvent(new CustomEvent(LOCAL_STORAGE_EVENT, { detail: { key: LANG_STORAGE_KEY, value: next } }));
  } catch {}
  try {
    window.dispatchEvent(new Event(LANG_CHANGE_EVENT));
  } catch {}
  emit();
  return next;
}

export function toggleLanguage() {
  return setLanguage(getLanguage() === "es" ? "en" : "es");
}

const INTERPOLATION_PATTERN = /\{(\w+)\}/g;

function interpolate(template, vars) {
  return String(template).replace(INTERPOLATION_PATTERN, (match, name) => {
    const value = vars?.[name];
    return value == null ? match : String(value);
  });
}

// Copy lookup. Unknown keys fall back to English and then to the key itself so a
// missing translation degrades to readable text instead of a blank UI.
export function translate(language, key, vars) {
  const lang = normalizeLanguage(language);
  const raw = DICTIONARY[lang]?.[key] ?? DICTIONARY.en?.[key];
  if (raw == null) return key;
  return vars ? interpolate(raw, vars) : String(raw);
}

export function getDictionary(language) {
  return DICTIONARY[normalizeLanguage(language)] || DICTIONARY.en;
}

export function hasTranslation(language, key) {
  return DICTIONARY[normalizeLanguage(language)]?.[key] != null;
}

export function useLanguage() {
  const lang = useSyncExternalStore(subscribeLanguage, getLanguage, () => DEFAULT_LANGUAGE);
  const t = useMemo(() => (key, vars) => translate(lang, key, vars), [lang]);
  const toggle = useCallback(() => setLanguage(lang === "es" ? "en" : "es"), [lang]);
  return {
    lang,
    language: lang,
    isSpanish: lang === "es",
    setLanguage,
    toggleLanguage: toggle,
    t,
  };
}

export function useT() {
  return useLanguage().t;
}
