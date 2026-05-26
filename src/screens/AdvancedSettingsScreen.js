import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from "../utils/settings";
import { clearDevSampleData, seedDevSampleData } from "../utils/devSampleData";

const ESTIPAID_PREFIX = "estipaid-";
const NOTES_TEXTAREA_MIN_HEIGHT = 170;

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toStorageString(value) {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function toFileStamp(date = new Date()) {
  const yyyy = String(date.getFullYear());
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  const ss = String(date.getSeconds()).padStart(2, "0");
  return `${yyyy}${mm}${dd}-${hh}${min}${ss}`;
}

function downloadJson(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => {
    try { URL.revokeObjectURL(url); } catch {}
  }, 3000);
}

function listEstipaidKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(ESTIPAID_PREFIX)) continue;
      out.push(key);
    }
  } catch {}
  return out.sort();
}

function mergeSettingsSafe(base, incoming) {
  const b = normalizeSettings(base);
  const i = normalizeSettings(incoming);
  return normalizeSettings({
    ...b,
    ...i,
    pricing: { ...(b.pricing || {}), ...(i.pricing || {}) },
    docDefaults: { ...(b.docDefaults || {}), ...(i.docDefaults || {}) },
    internal: { ...(b.internal || {}), ...(i.internal || {}) },
    pdf: { ...(b.pdf || {}), ...(i.pdf || {}) },
    customer: { ...(b.customer || {}), ...(i.customer || {}) },
  });
}

function SettingRow({ title, hint, control }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
      <div style={{ minWidth: 220, flex: "1 1 220px" }}>
        <div className="pe-field-label" style={{ margin: 0 }}>{title}</div>
        {hint ? <div className="pe-field-helper" style={{ marginTop: 4 }}>{hint}</div> : null}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {control}
      </div>
    </div>
  );
}

function SegmentedButtons({ options, value, onChange }) {
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: 2,
        borderRadius: 999,
        border: "1px solid rgba(255,255,255,0.12)",
        background: "rgba(255,255,255,0.06)",
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            className={active ? "pe-btn" : "pe-btn pe-btn-ghost"}
            onClick={() => onChange(opt.value)}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              minWidth: 86,
              fontWeight: active ? 800 : 600,
              border: active ? "1px solid rgba(255,255,255,0.24)" : "1px solid transparent",
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

function ToggleButton({ value, onClick, disabled = false }) {
  return (
    <button
      type="button"
      className={value ? "pe-btn" : "pe-btn pe-btn-ghost"}
      onClick={onClick}
      disabled={disabled}
      style={{ minWidth: 84 }}
    >
      {value ? "On" : "Off"}
    </button>
  );
}

export default function AdvancedSettingsScreen({ spinTick = 0 } = {}) {
  const [settings, setSettings] = useState(() => loadSettings());
  const [busyLabel, setBusyLabel] = useState("");
  const importInputRef = useRef(null);
  const defaultInternalNotesRef = useRef(null);
  const defaultInternalNotes = String(settings?.docDefaults?.defaultInternalNotesEstimate || "");
  const isDevBuild = process.env.NODE_ENV !== "production";

  const autoResizeNotesField = (el) => {
    if (!el) return;
    el.style.boxSizing = "border-box";
    el.style.resize = "none";
    el.style.height = "0px";
    const raw = Number(el.scrollHeight) || NOTES_TEXTAREA_MIN_HEIGHT;
    const next = Math.max(NOTES_TEXTAREA_MIN_HEIGHT, raw);
    el.style.height = `${next}px`;
    el.style.overflowY = "hidden";
  };

  useEffect(() => {
    const onStorage = (e) => {
      if (e?.key && e.key !== STORAGE_KEYS.SETTINGS) return;
      setSettings(loadSettings());
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("estipaid:settings-changed", onStorage);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("estipaid:settings-changed", onStorage);
    };
  }, []);

  useLayoutEffect(() => {
    const raf = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(() => autoResizeNotesField(defaultInternalNotesRef.current))
      : null;
    if (raf === null) autoResizeNotesField(defaultInternalNotesRef.current);
    return () => {
      if (raf !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [defaultInternalNotes]);

  const sectionStyle = useMemo(
    () => ({
      margin: 0,
      padding: "14px 14px",
      display: "grid",
      gap: 12,
    }),
    []
  );

  const controlCenterSummary = useMemo(() => {
    const pricing = settings?.pricing || {};
    const internal = settings?.internal || {};
    const customer = settings?.customer || {};
    const businessRuleFlags = [
      !!pricing.lockMarkupToGlobal,
      !!pricing.roundTotals,
      Number(pricing.precision) === 0,
    ].filter(Boolean).length;
    const customerRequirements = [
      !!customer.requirePhone ? "Phone" : null,
      !!customer.requireEmail ? "Email" : null,
    ].filter(Boolean);
    const internalState = internal.lockInternalCostFields
      ? "Locked"
      : (internal.showInternalCostFields ? "Visible" : "Hidden");
    return {
      businessRuleFlags,
      internalState,
      customerRequirements,
      defaultMarkupPct: String(pricing.defaultMarkupPct ?? 0),
      defaultTaxPct: String(pricing.defaultTaxPct ?? 0),
      defaultCustomerType: customer.defaultCustomerType === "commercial" ? "Commercial" : "Residential",
    };
  }, [settings]);

  const panelStyle = useMemo(
    () => ({
      ...sectionStyle,
      borderRadius: 16,
      border: "1px solid rgba(255,255,255,0.1)",
      background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))",
      boxShadow: "0 12px 28px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.02)",
    }),
    [sectionStyle]
  );

  const writeSettings = (updater) => {
    setSettings((prev) => {
      const base = normalizeSettings(prev);
      const nextRaw = typeof updater === "function" ? updater(base) : updater;
      const merged = mergeSettingsSafe(base, asObject(nextRaw));
      saveSettings(merged);
      return merged;
    });
  };

  const exportData = () => {
    try {
      setBusyLabel("Exporting...");
      const keys = listEstipaidKeys();
      const payload = {
        app: "EstiPaid",
        version: 1,
        exportedAt: new Date().toISOString(),
        settingsKey: STORAGE_KEYS.SETTINGS,
        settings: loadSettings(),
        keys: {},
      };
      keys.forEach((key) => {
        try {
          const raw = localStorage.getItem(key);
          payload.keys[key] = raw == null ? null : (safeJsonParse(raw) ?? raw);
        } catch {
          payload.keys[key] = null;
        }
      });
      downloadJson(payload, `estipaid-export-${toFileStamp()}.json`);
    } catch {
      window.alert("Export failed.");
    } finally {
      setBusyLabel("");
    }
  };

  const resetSettings = () => {
    if (!window.confirm("Reset all settings to defaults?")) return;
    const defaults = normalizeSettings(DEFAULT_SETTINGS);
    saveSettings(defaults);
    setSettings(defaults);
  };

  const clearEstiPaidData = () => {
    if (!window.confirm("Clear all EstiPaid local data? This cannot be undone.")) return;
    try {
      const keys = listEstipaidKeys();
      keys.forEach((key) => {
        try { localStorage.removeItem(key); } catch {}
      });
      try { window.dispatchEvent(new Event("estipaid:settings-changed")); } catch {}
      setSettings(loadSettings());
    } catch {
      window.alert("Clear failed.");
    }
  };

  const loadDevSampleData = () => {
    if (!isDevBuild) return;
    try {
      setBusyLabel("Loading sample data...");
      const result = seedDevSampleData();
      window.alert(
        `Loaded sample data: ${Number(result?.customers || 0)} customers, ${Number(result?.estimates || 0)} estimates, ${Number(result?.invoices || 0)} invoices.`
      );
    } catch (error) {
      window.alert(error?.message || "Sample data load failed.");
    } finally {
      setBusyLabel("");
    }
  };

  const clearOnlyDevSampleData = () => {
    if (!isDevBuild) return;
    if (!window.confirm("Remove seeded sample customers, estimates, and invoices only?")) return;
    try {
      setBusyLabel("Clearing sample data...");
      const result = clearDevSampleData();
      window.alert(
        `Removed sample data: ${Number(result?.clearedCustomers || 0)} customers, ${Number(result?.clearedEstimates || 0)} estimates, ${Number(result?.clearedInvoices || 0)} invoices.`
      );
    } catch (error) {
      window.alert(error?.message || "Sample data clear failed.");
    } finally {
      setBusyLabel("");
    }
  };

  const importJsonFile = async (file) => {
    if (!file) return;
    setBusyLabel("Importing...");
    try {
      const text = await file.text();
      const parsed = safeJsonParse(text);
      if (!parsed || typeof parsed !== "object") {
        window.alert("Invalid import file.");
        return;
      }

      const keysObj = asObject(parsed.keys);
      let writeCount = 0;

      Object.keys(keysObj).forEach((key) => {
        if (!key.startsWith(ESTIPAID_PREFIX)) return;
        if (key === STORAGE_KEYS.SETTINGS) return;
        const raw = toStorageString(keysObj[key]);
        if (!raw) return;
        try {
          localStorage.setItem(key, raw);
          writeCount += 1;
        } catch {}
      });

      let importedSettings = parsed.settings;
      if (!importedSettings && Object.prototype.hasOwnProperty.call(keysObj, STORAGE_KEYS.SETTINGS)) {
        const fromKeys = keysObj[STORAGE_KEYS.SETTINGS];
        if (typeof fromKeys === "string") {
          importedSettings = safeJsonParse(fromKeys) || {};
        } else {
          importedSettings = fromKeys;
        }
      }
      const mergedSettings = mergeSettingsSafe(loadSettings(), asObject(importedSettings));
      saveSettings(mergedSettings);
      setSettings(mergedSettings);
      window.alert(`Import complete. Updated ${writeCount + 1} key(s).`);
    } catch {
      window.alert("Import failed.");
    } finally {
      setBusyLabel("");
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  return (
    <section className="pe-section">
      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header">
          <div className="pe-company-header-title">
            <img
              key={spinTick}
              src="/logo/estipaid.svg"
              alt="EstiPaid"
              className="pe-company-header-logo esti-spin"
              draggable={false}
            />
            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title="Advanced">Advanced</h1>
          </div>
          <div className="pe-company-header-controls">
            {busyLabel ? (
              <div className="pe-company-save-indicator is-visible" aria-live="polite">
                {busyLabel}
              </div>
            ) : null}
          </div>
        </div>

        <div className="pe-company-form-inner ep-section-gap-sm" style={{ gap: 12, paddingBottom: 8 }}>
          <div
            className="pe-card pe-card-content"
            style={{
              ...sectionStyle,
              borderRadius: 18,
              border: "1px solid rgba(168,184,195,0.14)",
              background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(34,197,94,0.08) 48%, rgba(245,158,11,0.06)), linear-gradient(180deg, rgba(24,34,44,0.4), rgba(7,10,15,0.94))",
              boxShadow: "0 22px 48px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.04)",
              gap: 14,
            }}
          >
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(180,196,208,0.58)" }}>
                App control center
              </div>
              <div style={{ fontSize: 23, fontWeight: 950, letterSpacing: "-0.03em", color: "rgba(239,245,249,0.98)", lineHeight: 1.06 }}>
                Advanced settings and business rules
              </div>
              <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "rgba(215,225,233,0.76)", maxWidth: 760 }}>
                Manage pricing defaults, internal visibility, PDF output, customer requirements, and local system data tools in one place.
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
              <div style={{ minWidth: 0, display: "grid", gap: 5, padding: "11px 12px", borderRadius: 14, border: "1px solid rgba(59,130,246,0.2)", background: "rgba(7,11,16,0.22)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(96,165,250,0.86)" }}>Business rules</div>
                <div style={{ fontSize: 22, fontWeight: 950, lineHeight: 1, color: "rgba(239,245,249,0.98)" }}>{controlCenterSummary.businessRuleFlags}</div>
                <div style={{ fontSize: 11.5, color: "rgba(208,219,228,0.66)" }}>high-impact toggles enabled</div>
              </div>
              <div style={{ minWidth: 0, display: "grid", gap: 5, padding: "11px 12px", borderRadius: 14, border: "1px solid rgba(34,197,94,0.2)", background: "rgba(7,11,16,0.22)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(74,222,128,0.86)" }}>Internal controls</div>
                <div style={{ fontSize: 22, fontWeight: 950, lineHeight: 1, color: "rgba(239,245,249,0.98)" }}>{controlCenterSummary.internalState}</div>
                <div style={{ fontSize: 11.5, color: "rgba(208,219,228,0.66)" }}>cost fields default state</div>
              </div>
              <div style={{ minWidth: 0, display: "grid", gap: 5, padding: "11px 12px", borderRadius: 14, border: "1px solid rgba(245,158,11,0.2)", background: "rgba(7,11,16,0.22)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(251,191,36,0.88)" }}>Pricing defaults</div>
                <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.1, color: "rgba(239,245,249,0.98)" }}>
                  {controlCenterSummary.defaultMarkupPct}% / {controlCenterSummary.defaultTaxPct}%
                </div>
                <div style={{ fontSize: 11.5, color: "rgba(208,219,228,0.66)" }}>markup and tax baselines</div>
              </div>
              <div style={{ minWidth: 0, display: "grid", gap: 5, padding: "11px 12px", borderRadius: 14, border: "1px solid rgba(148,163,184,0.2)", background: "rgba(7,11,16,0.22)" }}>
                <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(191,219,254,0.86)" }}>Customer policy</div>
                <div style={{ fontSize: 18, fontWeight: 900, lineHeight: 1.1, color: "rgba(239,245,249,0.98)" }}>
                  {controlCenterSummary.customerRequirements.length > 0 ? controlCenterSummary.customerRequirements.join(" + ") : "Optional"}
                </div>
                <div style={{ fontSize: 11.5, color: "rgba(208,219,228,0.66)" }}>
                  default type: {controlCenterSummary.defaultCustomerType}
                </div>
              </div>
            </div>
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>Business Rules</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              Controls that influence estimate and invoice defaults. Safe to adjust as your pricing policy evolves.
            </div>
            <SettingRow
              title="Default Markup %"
              control={(
                <input
                  className="pe-input"
                  inputMode="decimal"
                  style={{ width: 140 }}
                  value={String(settings?.pricing?.defaultMarkupPct ?? 0)}
                  onChange={(e) => writeSettings((prev) => ({
                    ...prev,
                    pricing: { ...(prev.pricing || {}), defaultMarkupPct: e.target.value },
                  }))}
                />
              )}
            />
            <SettingRow
              title="Lock Markup to Global"
              control={(
                <ToggleButton
                  value={!!settings?.pricing?.lockMarkupToGlobal}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    pricing: {
                      ...(prev.pricing || {}),
                      lockMarkupToGlobal: !prev?.pricing?.lockMarkupToGlobal,
                    },
                  }))}
                />
              )}
            />
            <SettingRow
              title="Default Tax %"
              control={(
                <input
                  className="pe-input"
                  inputMode="decimal"
                  style={{ width: 140 }}
                  value={String(settings?.pricing?.defaultTaxPct ?? 0)}
                  onChange={(e) => writeSettings((prev) => ({
                    ...prev,
                    pricing: { ...(prev.pricing || {}), defaultTaxPct: e.target.value },
                  }))}
                />
              )}
            />
            <SettingRow
              title="Round Totals"
              control={(
                <ToggleButton
                  value={!!settings?.pricing?.roundTotals}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    pricing: {
                      ...(prev.pricing || {}),
                      roundTotals: !prev?.pricing?.roundTotals,
                    },
                  }))}
                />
              )}
            />
            <SettingRow
              title="Precision"
              control={(
                <SegmentedButtons
                  value={Number(settings?.pricing?.precision) === 0 ? 0 : 2}
                  options={[
                    { label: "0", value: 0 },
                    { label: "2", value: 2 },
                  ]}
                  onChange={(value) => writeSettings((prev) => ({
                    ...prev,
                    pricing: { ...(prev.pricing || {}), precision: value },
                  }))}
                />
              )}
            />
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>Document Defaults</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              Reusable internal writing defaults for faster estimate preparation.
            </div>
            <SettingRow
              title="Default Internal Notes (Estimate only)"
              hint="Pre-filled internal notes template for new estimate docs."
              control={(
                <textarea
                  ref={defaultInternalNotesRef}
                  className="pe-input pe-textarea"
                  value={defaultInternalNotes}
                  onChange={(e) => writeSettings((prev) => ({
                    ...prev,
                    docDefaults: { ...(prev.docDefaults || {}), defaultInternalNotesEstimate: e.target.value },
                  }))}
                  onInput={(e) => autoResizeNotesField(e.currentTarget)}
                  style={{ minHeight: NOTES_TEXTAREA_MIN_HEIGHT, resize: "none", width: "min(520px, 100%)" }}
                />
              )}
            />
            <div className="pe-field-helper">
              Internal Notes are estimate-only and never appear on invoices.
            </div>
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>Internal Controls</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              Set visibility and protection for internal cost details used by your team.
            </div>
            <SettingRow
              title="Show Internal Cost Fields"
              control={(
                <ToggleButton
                  value={!!settings?.internal?.showInternalCostFields}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    internal: {
                      ...(prev.internal || {}),
                      showInternalCostFields: !prev?.internal?.showInternalCostFields,
                    },
                  }))}
                />
              )}
            />
            <SettingRow
              title="Lock Internal Cost Fields"
              control={(
                <ToggleButton
                  value={!!settings?.internal?.lockInternalCostFields}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    internal: {
                      ...(prev.internal || {}),
                      lockInternalCostFields: !prev?.internal?.lockInternalCostFields,
                    },
                  }))}
                />
              )}
            />
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>PDF / Export</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              Output layout preferences for generated documents and customer-facing exports.
            </div>
            <SettingRow
              title="Include Logo"
              control={(
                <ToggleButton
                  value={!!settings?.pdf?.includeLogo}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    pdf: { ...(prev.pdf || {}), includeLogo: !prev?.pdf?.includeLogo },
                  }))}
                />
              )}
            />
            <SettingRow
              title="Compact Layout"
              control={(
                <ToggleButton
                  value={!!settings?.pdf?.compactLayout}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    pdf: { ...(prev.pdf || {}), compactLayout: !prev?.pdf?.compactLayout },
                  }))}
                />
              )}
            />
            <SettingRow
              title="Show Unit Rates"
              control={(
                <ToggleButton
                  value={!!settings?.pdf?.showUnitRates}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    pdf: { ...(prev.pdf || {}), showUnitRates: !prev?.pdf?.showUnitRates },
                  }))}
                />
              )}
            />
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>Customer Defaults</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              Default requirements applied when creating new customer profiles.
            </div>
            <SettingRow
              title="Default customer type"
              control={(
                <SegmentedButtons
                  value={settings?.customer?.defaultCustomerType === "commercial" ? "commercial" : "residential"}
                  options={[
                    { label: "Residential", value: "residential" },
                    { label: "Commercial", value: "commercial" },
                  ]}
                  onChange={(value) => writeSettings((prev) => ({
                    ...prev,
                    customer: { ...(prev.customer || {}), defaultCustomerType: value },
                  }))}
                />
              )}
            />
            <SettingRow
              title="Require phone"
              control={(
                <ToggleButton
                  value={!!settings?.customer?.requirePhone}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    customer: { ...(prev.customer || {}), requirePhone: !prev?.customer?.requirePhone },
                  }))}
                />
              )}
            />
            <SettingRow
              title="Require email"
              control={(
                <ToggleButton
                  value={!!settings?.customer?.requireEmail}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    customer: { ...(prev.customer || {}), requireEmail: !prev?.customer?.requireEmail },
                  }))}
                />
              )}
            />
          </div>

          <div className="ep-glass-tile ep-tile-hover" style={{ ...panelStyle, border: "1px solid rgba(239,68,68,0.38)", background: "linear-gradient(180deg, rgba(127,29,29,0.22), rgba(15,23,42,0.52))" }}>
            <div className="pe-field-label" style={{ marginBottom: 2, color: "rgba(254,202,202,0.95)" }}>
              System &amp; Data (Danger Zone)
            </div>
            <div className="pe-field-helper">
              Advanced maintenance actions for local device data. Review before applying.
            </div>

            {isDevBuild ? (
              <div style={{ display: "grid", gap: 8 }}>
                <div className="pe-field-label" style={{ marginBottom: 0 }}>Development Sample Data</div>
                <div className="pe-field-helper">
                  Loads deterministic customers, estimates, and invoice records into the normal EstiPaid storage keys for local testing only.
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button type="button" className="pe-btn" onClick={loadDevSampleData}>
                    Load Sample Data
                  </button>
                  <button type="button" className="pe-btn pe-btn-ghost" onClick={clearOnlyDevSampleData}>
                    Clear Sample Data
                  </button>
                </div>
              </div>
            ) : null}

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid rgba(248,113,113,0.24)" }}>
              <button type="button" className="pe-btn" onClick={exportData}>
                Export JSON
              </button>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => importInputRef.current?.click?.()}
              >
                Import JSON
              </button>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={resetSettings}>
                Reset Settings
              </button>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                style={{ borderColor: "rgba(248,113,113,0.34)", color: "rgba(254,202,202,0.94)" }}
                onClick={clearEstiPaidData}
              >
                Clear EstiPaid local data
              </button>
            </div>
            <input
              ref={importInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: "none" }}
              onChange={(e) => {
                const file = e.target.files?.[0];
                importJsonFile(file);
              }}
            />
          </div>
        </div>
      </div>
    </section>
  );
}
