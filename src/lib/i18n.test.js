import { act, render, screen } from "@testing-library/react";
import React from "react";

import { STORAGE_KEYS } from "../constants/storageKeys";
import { DICTIONARY } from "./i18nDictionary";
import {
  DEFAULT_LANGUAGE,
  LANG_STORAGE_KEY,
  SUPPORTED_LANGUAGES,
  getLanguage,
  normalizeLanguage,
  setLanguage,
  translate,
  useLanguage,
} from "./i18n";

function Probe() {
  const { lang, t, setLanguage: set, toggleLanguage } = useLanguage();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="copy">{t("shell.navEstimates")}</span>
      <span data-testid="interpolated">{t("home.projectAmountDue", { amount: "$1,200" })}</span>
      <button type="button" onClick={() => set("es")}>to-es</button>
      <button type="button" onClick={() => set("en")}>to-en</button>
      <button type="button" onClick={toggleLanguage}>toggle</button>
    </div>
  );
}

describe("shared bilingual owner", () => {
  beforeEach(() => {
    localStorage.clear();
    setLanguage("en");
    localStorage.clear();
  });

  it("uses the one canonical storage key the rest of EstiPaid already persists", () => {
    expect(LANG_STORAGE_KEY).toBe(STORAGE_KEYS.LANG);
    expect(SUPPORTED_LANGUAGES).toEqual(["en", "es"]);
    expect(DEFAULT_LANGUAGE).toBe("en");
  });

  it("serves both English and Spanish for the same key", () => {
    expect(translate("en", "shell.navEstimates")).toBe("Estimates");
    expect(translate("es", "shell.navEstimates")).toBe("Estimados");
    expect(translate("en", "shell.navInvoices")).toBe("Invoices");
    expect(translate("es", "shell.navInvoices")).toBe("Facturas");
  });

  it("falls back to English, then to the key itself, instead of rendering blank", () => {
    expect(translate("es", "shell.languageEnglish")).toBe("Inglés");
    expect(translate("es", "totally.unknown.key")).toBe("totally.unknown.key");
    expect(translate("en", "totally.unknown.key")).toBe("totally.unknown.key");
  });

  it("interpolates values without translating them", () => {
    expect(translate("en", "home.projectAmountDue", { amount: "$4,000" })).toBe("$4,000 due");
    expect(translate("es", "home.projectAmountDue", { amount: "$4,000" })).toBe("$4,000 por cobrar");
  });

  it("normalizes anything that is not Spanish to English", () => {
    expect(normalizeLanguage("es")).toBe("es");
    expect(normalizeLanguage("ES")).toBe("es");
    expect(normalizeLanguage("fr")).toBe("en");
    expect(normalizeLanguage(null)).toBe("en");
    expect(normalizeLanguage(undefined)).toBe("en");
  });

  it("persists to the canonical key and reads it back", () => {
    setLanguage("es");
    expect(localStorage.getItem(STORAGE_KEYS.LANG)).toBe("es");
    expect(getLanguage()).toBe("es");

    setLanguage("en");
    expect(localStorage.getItem(STORAGE_KEYS.LANG)).toBe("en");
    expect(getLanguage()).toBe("en");
  });

  it("starts on a language already stored before anything mounts", () => {
    localStorage.setItem(STORAGE_KEYS.LANG, "es");
    render(<Probe />);
    expect(screen.getByTestId("lang")).toHaveTextContent("es");
    expect(screen.getByTestId("copy")).toHaveTextContent("Estimados");
  });

  it("re-renders every subscriber in place when the language changes", () => {
    render(
      <>
        <Probe />
        <Probe />
      </>
    );
    const [first, second] = screen.getAllByTestId("copy");
    expect(first).toHaveTextContent("Estimates");
    expect(second).toHaveTextContent("Estimates");

    act(() => {
      screen.getAllByText("to-es")[0].click();
    });

    // Both subscribers followed, even though only one of them was clicked:
    // there is a single owner, not per-component language state.
    expect(screen.getAllByTestId("copy")[0]).toHaveTextContent("Estimados");
    expect(screen.getAllByTestId("copy")[1]).toHaveTextContent("Estimados");
    expect(screen.getAllByTestId("lang")[1]).toHaveTextContent("es");
  });

  it("toggles back and forth through the same owner", () => {
    render(<Probe />);
    expect(screen.getByTestId("lang")).toHaveTextContent("en");

    act(() => { screen.getByText("toggle").click(); });
    expect(screen.getByTestId("lang")).toHaveTextContent("es");
    expect(localStorage.getItem(STORAGE_KEYS.LANG)).toBe("es");

    act(() => { screen.getByText("toggle").click(); });
    expect(screen.getByTestId("lang")).toHaveTextContent("en");
    expect(localStorage.getItem(STORAGE_KEYS.LANG)).toBe("en");
  });

  it("follows a change announced on the existing pe-localstorage channel", () => {
    render(<Probe />);
    act(() => {
      localStorage.setItem(STORAGE_KEYS.LANG, "es");
      window.dispatchEvent(
        new CustomEvent("pe-localstorage", { detail: { key: STORAGE_KEYS.LANG, value: "es" } })
      );
    });
    expect(screen.getByTestId("lang")).toHaveTextContent("es");
  });

  it("follows a change announced on the existing estipaid:lang channel", () => {
    render(<Probe />);
    act(() => {
      localStorage.setItem(STORAGE_KEYS.LANG, "es");
      window.dispatchEvent(new Event("estipaid:lang"));
    });
    expect(screen.getByTestId("lang")).toHaveTextContent("es");
  });

  it("follows a cross-tab storage event", () => {
    render(<Probe />);
    act(() => {
      localStorage.setItem(STORAGE_KEYS.LANG, "es");
      window.dispatchEvent(new Event("storage"));
    });
    expect(screen.getByTestId("lang")).toHaveTextContent("es");
  });

  it("announces its own writes on the channels other surfaces listen to", () => {
    const seen = [];
    const onLocal = (event) => seen.push(["pe-localstorage", event?.detail?.key]);
    const onLang = () => seen.push(["estipaid:lang", null]);
    window.addEventListener("pe-localstorage", onLocal);
    window.addEventListener("estipaid:lang", onLang);
    try {
      setLanguage("es");
    } finally {
      window.removeEventListener("pe-localstorage", onLocal);
      window.removeEventListener("estipaid:lang", onLang);
    }
    expect(seen).toContainEqual(["pe-localstorage", STORAGE_KEYS.LANG]);
    expect(seen).toContainEqual(["estipaid:lang", null]);
  });

  it("keeps a storage failure from breaking the live UI", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    try {
      render(<Probe />);
      act(() => { screen.getByText("to-es").click(); });
      expect(screen.getByTestId("lang")).toHaveTextContent("es");
      expect(screen.getByTestId("copy")).toHaveTextContent("Estimados");
    } finally {
      setItem.mockRestore();
    }
  });
});

describe("shared dictionary", () => {
  it("defines the same keys in both languages", () => {
    const enKeys = Object.keys(DICTIONARY.en).sort();
    const esKeys = Object.keys(DICTIONARY.es).sort();
    expect(esKeys).toEqual(enKeys);
    expect(enKeys.length).toBeGreaterThan(500);
  });

  it("has no empty copy on either side", () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      for (const [key, value] of Object.entries(DICTIONARY[lang])) {
        expect(typeof value).toBe("string");
        expect(`${key}:${value.trim()}`).not.toBe(`${key}:`);
      }
    }
  });

  // Regression guard for a leak found in live browser testing: copy lifted out
  // of JSX text kept its HTML entities (&apos;, &amp;). JSX decoded those, but a
  // dictionary string rendered through {t(...)} does not, so "device&apos;s"
  // reached the screen verbatim.
  it("stores decoded text, never HTML entities", () => {
    const offenders = [];
    for (const lang of SUPPORTED_LANGUAGES) {
      for (const [key, value] of Object.entries(DICTIONARY[lang])) {
        if (/&(?:apos|amp|quot|lt|gt|nbsp|#\d+);/.test(value)) {
          offenders.push(`${lang}.${key}: ${value}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the same interpolation placeholders in both languages", () => {
    const placeholders = (text) => (String(text).match(/\{\w+\}/g) || []).sort();
    for (const key of Object.keys(DICTIONARY.en)) {
      expect({ key, vars: placeholders(DICTIONARY.es[key]) })
        .toEqual({ key, vars: placeholders(DICTIONARY.en[key]) });
    }
  });

  // Regression guard for a leak found in live browser testing: EstimatesScreen
  // called t("estimateNumLabel"), a key that used to come from App's local
  // shellT dictionary. After that dictionary was folded into the shared one the
  // key lived under shell.estimateNumLabel, so the old call fell through to the
  // key-name fallback and the raw string "estimateNumLabel" rendered on screen.
  it("resolves every literal t() key used anywhere in src", () => {
    const fs = require("fs");
    const path = require("path");

    const sourceRoot = path.resolve(__dirname, "..");
    const files = [];
    (function walk(dir) {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") walk(full);
        } else if (entry.name.endsWith(".js") && !entry.name.endsWith(".test.js")) {
          files.push(full);
        }
      }
    })(sourceRoot);

    const unresolved = [];
    for (const file of files) {
      if (file.endsWith("i18nDictionary.js")) continue;
      const source = fs.readFileSync(file, "utf8");
      for (const match of source.matchAll(/\bt\(\s*"((?:[^"\\]|\\.)*)"/g)) {
        const key = match[1];
        if (DICTIONARY.en[key] == null) {
          unresolved.push(`${path.relative(sourceRoot, file)}: t("${key}")`);
        }
      }
    }

    expect(unresolved).toEqual([]);
  });

  it("preserves the estimate builder's original vocabulary under its existing key names", () => {
    // These keys were the builder's local I18N before the migration; the builder's
    // call sites still use them, so renaming or dropping them would silently
    // regress its already-working bilingual behavior.
    for (const key of ["materials", "labor", "hours", "rate", "estimateTotal", "invoiceTotal", "saveEstimate", "convertToInvoice"]) {
      expect(DICTIONARY.en[key]).toBeTruthy();
      expect(DICTIONARY.es[key]).toBeTruthy();
      expect(DICTIONARY.es[key]).not.toBe(DICTIONARY.en[key]);
    }
  });
});
