import React, { useEffect, useMemo, useRef, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from "../utils/settings";
import { clearDevSampleData, seedDevSampleData } from "../utils/devSampleData";
import { appendAuditEvent, createStoredAuditEvent, readStoredAuditEvents } from "../utils/auditStore";
import { buildDiagnosticBundle } from "../utils/supportDiagnostics";
import { triggerLocalStorageExportDownload } from "../lib/localStorageExportDownload";
import useSupabaseAuth from "../lib/useSupabaseAuth";
import useSupabaseAccount from "../lib/useSupabaseAccount";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";
import { createSupabaseMigrationPreview } from "../lib/supabaseMigrationPreview";
import { isSupabaseMigrationPreviewReady, runSupabaseMigrationWrite } from "../lib/supabaseMigrationWriter";

const ESTIPAID_PREFIX = "estipaid-";

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

function readStoredJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null || raw === "") return fallback;
    const parsed = safeJsonParse(raw);
    if (parsed == null) return fallback;
    return parsed;
  } catch {
    return fallback;
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
  if (
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    typeof document === "undefined" ||
    typeof document.createElement !== "function"
  ) {
    throw new Error("Browser export unavailable");
  }
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

function inferWorkspaceName() {
  const profile = readStoredJson(STORAGE_KEYS.COMPANY_PROFILE, {});
  return String(profile?.companyName || profile?.name || "").trim();
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

export default function AdvancedSettingsScreen({
  spinTick = 0,
  onOpenCompanyProfile = null,
  onOpenTemplates = null,
  onOpenSnapshot = null,
  snapshotAvailable = false,
} = {}) {
  const [settings, setSettings] = useState(() => loadSettings());
  const [busyLabel, setBusyLabel] = useState("");
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState("");
  const [cloudEmail, setCloudEmail] = useState("");
  const [workspaceName, setWorkspaceName] = useState(() => inferWorkspaceName());
  const [migrationPreviewBusy, setMigrationPreviewBusy] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState(null);
  const [migrationConfirmText, setMigrationConfirmText] = useState("");
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationResult, setMigrationResult] = useState(null);
  const importInputRef = useRef(null);
  const diagnosticsMessageTimerRef = useRef(null);
  const isDevBuild = process.env.NODE_ENV !== "production";
  const {
    configured: isSupabaseReady,
    missingEnvKeys,
    loading: authLoading,
    authBusy,
    user,
    userEmail,
    errorMessage: authErrorMessage,
    infoMessage: authInfoMessage,
    signInWithEmailOtp,
    signOut,
  } = useSupabaseAuth();
  const {
    companyUser,
    company,
    role: accountRole,
    loading: accountLoading,
    error: accountError,
    hasCompany,
    refresh: refreshAccountStatus,
  } = useSupabaseAccount({
    configured: isSupabaseReady,
    user,
  });
  const {
    createWorkspace,
    creating: creatingWorkspace,
    error: workspaceError,
    success: workspaceSuccess,
  } = useSupabaseWorkspaceBootstrap({
    configured: isSupabaseReady,
    user,
    hasMembership: Boolean(companyUser),
    onCreated: refreshAccountStatus,
  });

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

  useEffect(() => () => {
    if (diagnosticsMessageTimerRef.current) {
      clearTimeout(diagnosticsMessageTimerRef.current);
      diagnosticsMessageTimerRef.current = null;
    }
  }, []);

  const sectionStyle = useMemo(
    () => ({
      margin: 0,
      padding: "14px 14px",
      display: "grid",
      gap: 12,
    }),
    []
  );

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

  const shortcutGridStyle = useMemo(
    () => ({
      display: "grid",
      gap: 12,
      gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    }),
    []
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

  const downloadBackupJson = () => {
    try {
      setBusyLabel("Preparing backup...");
      const result = triggerLocalStorageExportDownload({
        storageSnapshot: localStorage,
        BlobConstructor: Blob,
        URLObject: URL,
        documentObject: document,
      });
      showDiagnosticsMessage(`Backup JSON downloaded: ${result.filename}`);
    } catch {
      showDiagnosticsMessage("Unable to download backup JSON.");
    } finally {
      setBusyLabel("");
    }
  };

  const requestCloudSignIn = async () => {
    await signInWithEmailOtp(cloudEmail);
  };

  const submitWorkspaceCreate = async () => {
    const response = await createWorkspace(workspaceName);
    if (response?.ok) {
      setWorkspaceName(String(response?.result?.company?.name || workspaceName).trim());
    }
  };

  const runMigrationPreview = async () => {
    try {
      setMigrationPreviewBusy(true);
      setMigrationResult(null);
      const preview = await createSupabaseMigrationPreview({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role: accountRole,
        backupDownloadAvailable: true,
      });
      setMigrationPreview(preview);
    } catch {
      setMigrationPreview({
        company: {
          id: String(company?.id || "").trim(),
          name: String(company?.name || "").trim(),
          role: String(accountRole || "").trim().toLowerCase(),
        },
        localCounts: {
          customers: 0,
          projects: 0,
          estimates: 0,
          invoices: 0,
          invoicePayments: 0,
          scopeTemplates: 0,
          settings: 0,
        },
        cloudCounts: null,
        cloudCountCheckAvailable: false,
        cloudCountStatusMessage: "Cloud count check unavailable.",
        notices: [{ level: "error", code: "preview_failed", message: "Unable to build migration preview." }],
        noWritesPerformed: true,
      });
    } finally {
      setMigrationPreviewBusy(false);
    }
  };

  const executeMigrationWrite = async () => {
    try {
      setMigrationBusy(true);
      const result = await runSupabaseMigrationWrite({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role: accountRole,
        backupDownloadAvailable: true,
        preview: migrationPreview,
      });
      setMigrationResult(result);
      if (result?.ok) {
        setMigrationConfirmText("");
      }
    } catch {
      setMigrationResult({
        ok: false,
        blocked: false,
        reason: "Unable to run cloud migration.",
        notices: [{ level: "error", code: "migration_failed", message: "Unable to run cloud migration." }],
        tableResults: [],
        noLocalDeletes: true,
      });
    } finally {
      setMigrationBusy(false);
    }
  };

  const clearDiagnosticsMessage = () => {
    if (diagnosticsMessageTimerRef.current) {
      clearTimeout(diagnosticsMessageTimerRef.current);
      diagnosticsMessageTimerRef.current = null;
    }
  };

  const showDiagnosticsMessage = (message) => {
    clearDiagnosticsMessage();
    setDiagnosticsMessage(message);
    diagnosticsMessageTimerRef.current = setTimeout(() => {
      setDiagnosticsMessage("");
      diagnosticsMessageTimerRef.current = null;
    }, 1800);
  };

  const exportDiagnosticsJson = () => {
    try {
      setDiagnosticsBusy(true);
      const snapshot = {
        companyProfile: readStoredJson(STORAGE_KEYS.COMPANY_PROFILE, null),
        customers: readStoredJson(STORAGE_KEYS.CUSTOMERS, []),
        projects: readStoredJson(STORAGE_KEYS.PROJECTS, []),
        estimates: readStoredJson(STORAGE_KEYS.ESTIMATES, []),
        invoices: readStoredJson(STORAGE_KEYS.INVOICES, []),
        settings,
        scopeTemplates: readStoredJson(STORAGE_KEYS.SCOPE_TEMPLATES, []),
        auditEvents: readStoredAuditEvents(),
      };
      const bundle = buildDiagnosticBundle(snapshot, {
        includeSensitive: false,
        routeContext: "advanced_settings",
      });
      const generatedAt = String(bundle?.bundleMeta?.generatedAt || new Date().toISOString());
      const filename = `estipaid-diagnostics-${generatedAt.slice(0, 10)}.json`;
      downloadJson(bundle, filename);
      try {
        const auditEvent = createStoredAuditEvent("diagnostic_bundle.exported", {
          targetType: "diagnostic_bundle",
          targetId: String(bundle?.bundleMeta?.supportId || ""),
          source: "advanced_settings",
          reason: "manual_export",
          metadata: {
            bundleSchemaVersion: String(bundle?.bundleMeta?.bundleSchemaVersion || ""),
            supportId: String(bundle?.bundleMeta?.supportId || ""),
            issueCount: Number(bundle?.healthSummary?.issueCount || 0),
          },
        });
        if (auditEvent) appendAuditEvent(auditEvent);
      } catch {}
      showDiagnosticsMessage("Diagnostics JSON exported.");
    } catch {
      showDiagnosticsMessage("Unable to export diagnostics.");
    } finally {
      setDiagnosticsBusy(false);
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
            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title="Settings">Settings</h1>
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
          <div style={{ display: "grid", gap: 6 }}>
            <div className="pe-title screenTitle" style={{ margin: 0 }}>Settings</div>
            <div className="pe-muted" style={{ maxWidth: 760 }}>
              Configure business defaults, document behavior, internal visibility, and local tools.
            </div>
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>Business Profile</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              Company identity used on estimates, invoices, and PDFs.
            </div>
            <div>
              <button
                type="button"
                className="pe-btn"
                onClick={() => {
                  if (typeof onOpenCompanyProfile === "function") onOpenCompanyProfile();
                }}
              >
                Open Business Profile
              </button>
            </div>
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>Pricing Defaults</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              Controls that influence the starting markup behavior for new estimates and invoices.
            </div>
            <SettingRow
              title="Default Markup %"
              hint="Starting markup used for new labor and material line items."
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
              title="Use Default Markup on Line Items"
              hint="When on, labor and itemized material line items use your default markup and their line-item markup fields stay read-only in the builder. Blanket material markup still stays editable per document."
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
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>Internal Cost Visibility</div>
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
            <div className="pe-field-label" style={{ marginBottom: 2 }}>PDF Preferences</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              Output layout preferences for generated customer-facing documents.
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

          <div style={shortcutGridStyle}>
            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
              <div className="pe-field-label" style={{ marginBottom: 2 }}>Account &amp; Cloud Sync</div>
              <div className="pe-field-helper" style={{ marginTop: -4 }}>
                Connect your cloud account first. Customer, project, estimate, and invoice storage still remains local in this lane.
              </div>
              {!isSupabaseReady ? (
                <>
                  <div className="pe-field-helper">
                    Supabase not configured. Set {missingEnvKeys.join(" and ")} to enable account sign-in.
                  </div>
                  <div className="pe-field-helper">
                    Download Backup JSON in Developer Tools before any future migration or cloud-write step.
                  </div>
                </>
              ) : authLoading ? (
                <div className="pe-field-helper">Checking cloud account session...</div>
              ) : userEmail ? (
                <>
                  <div className="pe-field-helper">
                    Signed in as <strong>{userEmail}</strong>.
                  </div>
                  {accountLoading ? (
                    <div className="pe-field-helper">Checking company membership...</div>
                  ) : null}
                  {!accountLoading && hasCompany ? (
                    <div className="pe-field-helper">
                      Company: <strong>{String(company?.name || "Unnamed company")}</strong>
                    </div>
                  ) : null}
                  {!accountLoading && accountRole ? (
                    <div className="pe-field-helper">
                      Role: <strong>{accountRole}</strong>
                    </div>
                  ) : null}
                  {!accountLoading && !accountError && !companyUser ? (
                    <>
                      <div className="pe-field-helper">No company membership found yet.</div>
                      <div className="pe-field-helper">
                        This creates your cloud workspace only. Data migration/sync is not enabled yet.
                      </div>
                      <div style={{ display: "grid", gap: 8, maxWidth: 440 }}>
                        <label className="pe-field-helper" htmlFor="cloud-workspace-name" style={{ marginTop: 2 }}>
                          Company / Workspace Name
                        </label>
                        <input
                          id="cloud-workspace-name"
                          type="text"
                          className="pe-input"
                          value={workspaceName}
                          onChange={(e) => setWorkspaceName(e.target.value)}
                          placeholder="Field Pocket LLC"
                          disabled={creatingWorkspace}
                        />
                        <div>
                          <button
                            type="button"
                            className="pe-btn"
                            onClick={submitWorkspaceCreate}
                            disabled={creatingWorkspace}
                          >
                            {creatingWorkspace ? "Creating..." : "Create Cloud Workspace"}
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                  {!accountLoading && !accountError && companyUser && !hasCompany ? (
                    <div className="pe-field-helper">Company record not found for this membership yet.</div>
                  ) : null}
                  <div className="pe-field-helper">
                    Cloud account connected. Data migration/sync not enabled yet.
                  </div>
                  <div>
                    <button
                      type="button"
                      className="pe-btn pe-btn-ghost"
                      onClick={signOut}
                      disabled={authBusy}
                    >
                      {authBusy ? "Signing Out..." : "Sign Out"}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div className="pe-field-helper">
                    Sign in with a magic link. Cloud data sync is not active yet.
                  </div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                    <input
                      type="email"
                      className="pe-input"
                      style={{ minWidth: 220, flex: "1 1 220px" }}
                      value={cloudEmail}
                      onChange={(e) => setCloudEmail(e.target.value)}
                      placeholder="name@company.com"
                      autoComplete="email"
                      aria-label="Account email"
                      disabled={authBusy}
                    />
                    <button
                      type="button"
                      className="pe-btn"
                      onClick={requestCloudSignIn}
                      disabled={authBusy}
                    >
                      {authBusy ? "Sending Link..." : "Email Sign-In Link"}
                    </button>
                  </div>
                </>
              )}
              {authErrorMessage ? (
                <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(248,113,113,0.95)" }}>
                  {authErrorMessage}
                </div>
              ) : null}
              {!authErrorMessage && accountError ? (
                <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(248,113,113,0.95)" }}>
                  {accountError}
                </div>
              ) : null}
              {!authErrorMessage && !accountError && workspaceError ? (
                <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(248,113,113,0.95)" }}>
                  {workspaceError}
                </div>
              ) : null}
              {!authErrorMessage && authInfoMessage ? (
                <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                  {authInfoMessage}
                </div>
              ) : null}
              {!authErrorMessage && !accountError && workspaceSuccess ? (
                <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                  {workspaceSuccess}
                </div>
              ) : null}
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  paddingTop: 8,
                  borderTop: "1px solid rgba(148,163,184,0.18)",
                }}
              >
                <div className="pe-field-label" style={{ marginBottom: 0 }}>Migration Preview</div>
                <div className="pe-field-helper">
                  Dry run the localStorage to Supabase migration plan. This checks local counts, workspace context, and optional cloud counts only.
                </div>
                <div>
                  <button
                    type="button"
                    className="pe-btn pe-btn-ghost"
                    onClick={runMigrationPreview}
                    disabled={migrationPreviewBusy}
                  >
                    {migrationPreviewBusy ? "Previewing..." : "Preview Local Data Migration"}
                  </button>
                </div>
                {migrationPreview ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 6,
                      padding: 10,
                      borderRadius: 12,
                      border: "1px solid rgba(148,163,184,0.18)",
                      background: "rgba(15,23,42,0.34)",
                    }}
                  >
                    <div className="pe-field-helper">
                      Current workspace: <strong>{String(migrationPreview?.company?.name || "Unavailable")}</strong>
                    </div>
                    <div className="pe-field-helper">
                      Current role: <strong>{String(migrationPreview?.company?.role || "unavailable")}</strong>
                    </div>
                    <div className="pe-field-helper">
                      Local counts: customers <strong>{Number(migrationPreview?.localCounts?.customers || 0)}</strong>, projects <strong>{Number(migrationPreview?.localCounts?.projects || 0)}</strong>, estimates <strong>{Number(migrationPreview?.localCounts?.estimates || 0)}</strong>, invoices <strong>{Number(migrationPreview?.localCounts?.invoices || 0)}</strong>, invoice payments <strong>{Number(migrationPreview?.localCounts?.invoicePayments || 0)}</strong>.
                    </div>
                    <div className="pe-field-helper">
                      Local line items: estimate <strong>{Number(migrationPreview?.localCounts?.estimateLineItems || 0)}</strong>, invoice <strong>{Number(migrationPreview?.localCounts?.invoiceLineItems || 0)}</strong>.
                    </div>
                    <div className="pe-field-helper">
                      {migrationPreview?.cloudCountCheckAvailable && migrationPreview?.cloudCounts
                        ? `Cloud counts: customers ${Number(migrationPreview.cloudCounts.customers || 0)}, projects ${Number(migrationPreview.cloudCounts.projects || 0)}, estimates ${Number(migrationPreview.cloudCounts.estimates || 0)}, invoices ${Number(migrationPreview.cloudCounts.invoices || 0)}, invoice payments ${Number(migrationPreview.cloudCounts.invoicePayments || 0)}.`
                        : String(migrationPreview?.cloudCountStatusMessage || "Cloud count check unavailable.")}
                    </div>
                    {migrationPreview?.cloudCountCheckAvailable && migrationPreview?.cloudCounts ? (
                      <div className="pe-field-helper">
                        {`Cloud line items: estimate ${Number(migrationPreview.cloudCounts.estimateLineItems || 0)}, invoice ${Number(migrationPreview.cloudCounts.invoiceLineItems || 0)}.`}
                      </div>
                    ) : null}
                    {Array.isArray(migrationPreview?.notices) && migrationPreview.notices.length > 0 ? (
                      <div style={{ display: "grid", gap: 4 }}>
                        {migrationPreview.notices.map((notice) => (
                          <div
                            key={String(notice?.code || notice?.message)}
                            className="pe-field-helper"
                            style={{
                              color: notice?.level === "error"
                                ? "rgba(248,113,113,0.95)"
                                : notice?.level === "warning"
                                  ? "rgba(253,224,71,0.95)"
                                  : "rgba(191,219,254,0.95)",
                            }}
                          >
                            {String(notice?.message || "")}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                      No Supabase writes were performed.
                    </div>
                  </div>
                ) : null}
                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    paddingTop: 8,
                    borderTop: "1px solid rgba(148,163,184,0.18)",
                  }}
                >
                  <div className="pe-field-label" style={{ marginBottom: 0 }}>Migration Write</div>
                  <div className="pe-field-helper">
                    This copies local customers, projects, estimates, invoices, and payments into Supabase for this workspace. It does not delete local data.
                  </div>
                  <label className="pe-field-helper" htmlFor="migration-confirm-input" style={{ marginTop: 2 }}>
                    Type MIGRATE to confirm
                  </label>
                  <input
                    id="migration-confirm-input"
                    type="text"
                    className="pe-input"
                    value={migrationConfirmText}
                    onChange={(e) => setMigrationConfirmText(e.target.value)}
                    placeholder="MIGRATE"
                    disabled={migrationBusy}
                    style={{ maxWidth: 220 }}
                  />
                  <div>
                    <button
                      type="button"
                      className="pe-btn"
                      onClick={executeMigrationWrite}
                      disabled={
                        migrationBusy ||
                        migrationConfirmText !== "MIGRATE" ||
                        !isSupabaseMigrationPreviewReady(migrationPreview)
                      }
                    >
                      {migrationBusy ? "Migrating..." : "Migrate Local Data to Cloud"}
                    </button>
                  </div>
                  {migrationResult ? (
                    <div
                      style={{
                        display: "grid",
                        gap: 6,
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid rgba(148,163,184,0.18)",
                        background: "rgba(15,23,42,0.34)",
                      }}
                    >
                      <div
                        role="status"
                        aria-live="polite"
                        className="pe-field-helper"
                        style={{
                          color: migrationResult?.ok
                            ? "rgba(187,247,208,0.95)"
                            : "rgba(248,113,113,0.95)",
                        }}
                      >
                        {migrationResult?.ok
                          ? "Cloud migration completed."
                          : String(migrationResult?.reason || "Cloud migration did not complete.")}
                      </div>
                      {Array.isArray(migrationResult?.tableResults) && migrationResult.tableResults.length > 0 ? (
                        <div style={{ display: "grid", gap: 4 }}>
                          {migrationResult.tableResults.map((tableResult) => (
                            <div key={String(tableResult?.table || tableResult?.label)} className="pe-field-helper">
                              {String(tableResult?.label || tableResult?.table)}: {String(tableResult?.status || "unknown")}
                              {typeof tableResult?.written === "number" ? `, written ${tableResult.written}` : ""}
                              {typeof tableResult?.reused === "number" && tableResult.reused > 0 ? `, reused ${tableResult.reused}` : ""}
                              {typeof tableResult?.skipped === "number" && tableResult.skipped > 0 ? `, skipped ${tableResult.skipped}` : ""}
                              {typeof tableResult?.failed === "number" && tableResult.failed > 0 ? `, failed ${tableResult.failed}` : ""}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {Array.isArray(migrationResult?.notices) && migrationResult.notices.length > 0 ? (
                        <div style={{ display: "grid", gap: 4 }}>
                          {migrationResult.notices.map((notice) => (
                            <div
                              key={String(notice?.code || notice?.message)}
                              className="pe-field-helper"
                              style={{
                                color: notice?.level === "error"
                                  ? "rgba(248,113,113,0.95)"
                                  : notice?.level === "warning"
                                    ? "rgba(253,224,71,0.95)"
                                    : "rgba(191,219,254,0.95)",
                              }}
                            >
                              {String(notice?.message || "")}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="pe-field-helper">
                        Local data remains in localStorage after this migration step.
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
              <div className="pe-field-label" style={{ marginBottom: 2 }}>Templates</div>
              <div className="pe-field-helper" style={{ marginTop: -4 }}>
                Manage reusable work-package templates.
              </div>
              <div>
                <button
                  type="button"
                  className="pe-btn"
                  onClick={() => {
                    if (typeof onOpenTemplates === "function") onOpenTemplates();
                  }}
                >
                  Open Templates
                </button>
              </div>
            </div>

            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
              <div className="pe-field-label" style={{ marginBottom: 2 }}>Reports &amp; Bookkeeping</div>
              <div className="pe-field-helper" style={{ marginTop: -4 }}>
                View business snapshot and future bookkeeping exports.
              </div>
              <div>
                <button
                  type="button"
                  className={snapshotAvailable ? "pe-btn" : "pe-btn pe-btn-ghost"}
                  disabled={!snapshotAvailable}
                  onClick={() => {
                    if (snapshotAvailable && typeof onOpenSnapshot === "function") onOpenSnapshot();
                  }}
                >
                  {snapshotAvailable ? "Open Snapshot" : "Snapshot Unavailable"}
                </button>
              </div>
            </div>
          </div>

          <div
            className="pe-card pe-card-content ep-glass-tile"
            style={{
              ...panelStyle,
              border: "1px solid rgba(96,165,250,0.2)",
              background: "linear-gradient(180deg, rgba(30,41,59,0.48), rgba(15,23,42,0.62))",
            }}
          >
            <div className="pe-field-label" style={{ marginBottom: 2 }}>Developer Tools</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              Internal and support tools for raw app data, diagnostics, and local sample-data workflows.
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="pe-btn"
                  onClick={exportDiagnosticsJson}
                  disabled={diagnosticsBusy}
                >
                  {diagnosticsBusy ? "Exporting..." : "Export Diagnostics"}
                </button>
                <button type="button" className="pe-btn pe-btn-ghost" onClick={downloadBackupJson}>
                  Download Backup JSON
                </button>
                <button type="button" className="pe-btn pe-btn-ghost" onClick={exportData}>
                  Export Raw App Data
                </button>
                <button
                  type="button"
                  className="pe-btn pe-btn-ghost"
                  onClick={() => importInputRef.current?.click?.()}
                >
                  Import Raw App Data
                </button>
              </div>

              {isDevBuild ? (
                <div style={{ display: "grid", gap: 8, paddingTop: 8, borderTop: "1px solid rgba(148,163,184,0.18)" }}>
                  <div className="pe-field-label" style={{ marginBottom: 0 }}>Development Sample Data</div>
                  <div className="pe-field-helper">
                    Loads deterministic customers, estimates, and invoice records into normal EstiPaid storage for local testing only.
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="pe-btn pe-btn-ghost" onClick={loadDevSampleData}>
                      Load Sample Data
                    </button>
                    <button type="button" className="pe-btn pe-btn-ghost" onClick={clearOnlyDevSampleData}>
                      Clear Sample Data
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="pe-field-helper" style={{ marginTop: 2 }}>
                Diagnostics exports create a redacted support bundle. Backup JSON downloads the migration-ready localStorage artifact. Raw app data import/export is for local support workflows.
              </div>
              {diagnosticsMessage ? (
                <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: diagnosticsMessage.includes("Unable") ? "rgba(248,113,113,0.95)" : "rgba(187,247,208,0.95)" }}>
                  {diagnosticsMessage}
                </div>
              ) : null}
            </div>
          </div>

          <div className="ep-glass-tile ep-tile-hover" style={{ ...panelStyle, border: "1px solid rgba(239,68,68,0.38)", background: "linear-gradient(180deg, rgba(127,29,29,0.22), rgba(15,23,42,0.52))" }}>
            <div className="pe-field-label" style={{ marginBottom: 2, color: "rgba(254,202,202,0.95)" }}>
              Danger Zone
            </div>
            <div className="pe-field-helper">
              Destructive maintenance actions for local device data. Review before applying.
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid rgba(248,113,113,0.24)" }}>
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
