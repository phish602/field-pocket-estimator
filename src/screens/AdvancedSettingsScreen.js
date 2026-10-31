import { markCloudBackupDirty } from "../lib/cloudBackupQueue";
import { buildBackupJsonImportPlan, applyBackupJsonImportPlan } from "../lib/backupJsonImport";
import { clearDevSampleData, seedDevSampleData } from "../utils/devSampleData";
import { triggerLocalStorageExportDownload } from "../lib/localStorageExportDownload";
import { triggerCloudBackupExportDownload } from "../lib/cloudBackupExportDownload";
import { buildDiagnosticBundle } from "../utils/supportDiagnostics";
import { appendAuditEvent, createStoredAuditEvent, readStoredAuditEvents } from "../utils/auditStore";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";

import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from "../utils/settings";
import useSupabaseAuth from "../lib/useSupabaseAuth";
import useSupabaseAccount from "../lib/useSupabaseAccount";
import useDeviceLockStatus from "../lib/useDeviceLockStatus";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";
import useCloudBackupStatus, { CLOUD_PRODUCT_STATE } from "../lib/useCloudBackupStatus";

import {
  DEFAULT_VAULT_IDLE_LOCK_MINUTES,
  VAULT_IDLE_LOCK_MINUTES,
} from "../lib/vaultIdleLockSettings";
import {
  previewSupabaseCloudRestore,
  executeSupabaseCloudRestore,
  exportSupabaseCloudBackupArtifact,
  CLOUD_RESTORE_STATUS,
  CLOUD_BACKUP_EXPORT_STATUS,
} from "../lib/supabaseCloudRestore";
import { checkSupabaseCloudOnboardingStatus, CLOUD_ONBOARDING_STATUS } from "../lib/supabaseCloudOnboarding";
import { LOCAL_DATA_DECISION } from "../lib/localDataIntegrity";
import CloudConfirmDialog from "../components/CloudConfirmDialog";
import {
  buildCloudRestoreConfirmationDialog,
  getCloudRestoreAvailability,
} from "../lib/cloudRestoreUi";
import { VAULT_COMPATIBILITY_GUARD_KEY } from "../lib/vaultCompatibilityGuard";
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
  return <div
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

      {options.map(opt => {
      const active = opt.value === value;
      return <button
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
          </button>;
    })}
    </div>;
}
function ToggleButton({ value, onClick, disabled = false }) {

  return <button
      type="button"
      className={value ? "pe-btn" : "pe-btn pe-btn-ghost"}
      onClick={onClick}
      disabled={disabled}
      style={{ minWidth: 84 }}
    >

      {value ? "On" : "Off"}
    </button>;
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

function resolveDeveloperCloudToolsEnabled(explicitValue) {
  // Developer migration controls are for local development only. A production
  // build must not expose them, including through a legacy local flag, URL, or
  // an explicit render prop.
  if (process.env.NODE_ENV === "production") return false;
  if (typeof explicitValue === "boolean") return explicitValue;
  return process.env.NODE_ENV === "development";
}

export default function AdvancedSettingsScreen({
  developerCloudToolsEnabled,
  spinTick = 0,
  onOpenCompanyProfile = null,
  onOpenTemplates = null,
  onOpenSnapshot = null,
  snapshotAvailable = false,
  vaultIdleLockMinutes = DEFAULT_VAULT_IDLE_LOCK_MINUTES,
  vaultIdleLockOptions = VAULT_IDLE_LOCK_MINUTES,
  onVaultIdleLockMinutesChange = null,
  onVaultLockNow = null,
  onPrepareCloudRestore = null
} = {}) {
  useEffect(() => () => {
    if (diagnosticsMessageTimerRef.current) {
      clearTimeout(diagnosticsMessageTimerRef.current);
      diagnosticsMessageTimerRef.current = null;
    }
  }, []);

  const [, setBusyLabel] = useState("");
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [cloudExportBusy, setCloudExportBusy] = useState(false);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState("");
  const importInputRef = useRef(null);
  const diagnosticsMessageTimerRef = useRef(null);
  const showDeveloperCloudTools = resolveDeveloperCloudToolsEnabled(developerCloudToolsEnabled);
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
      showDiagnosticsMessage(`This device backup JSON downloaded: ${result.filename}`);
    } catch {
      showDiagnosticsMessage("Unable to download this device backup JSON.");
    } finally {
      setBusyLabel("");
    }
  };
  const downloadCloudBackupJson = async () => {
    try {
      setCloudExportBusy(true);
      const exportResult = await exportSupabaseCloudBackupArtifact({
        configured: isSupabaseReady,
        user,
        company,
      });
      if (exportResult.status !== CLOUD_BACKUP_EXPORT_STATUS.EXPORTED || !exportResult.artifact) {
        showDiagnosticsMessage(String(exportResult.error || "Unable to download cloud backup JSON."));
        return;
      }
      const { filename, artifact } = triggerCloudBackupExportDownload({
        artifact: exportResult.artifact,
        BlobConstructor: Blob,
        URLObject: URL,
        documentObject: document,
      });
      const counts = artifact.counts;
      const coreTotal = counts.customers + counts.projects + counts.estimates + counts.invoices;
      showDiagnosticsMessage(
        coreTotal === 0
          ? `Cloud backup JSON downloaded: ${filename}. Warning: the cloud has no customer, project, estimate, or invoice records.`
          : `Cloud backup JSON downloaded: ${filename} (${counts.customers} customers, ${counts.projects} projects, ${counts.estimates} estimates, ${counts.invoices} invoices).`
      );
    } catch (error) {
      showDiagnosticsMessage(String(error?.message || "Unable to download cloud backup JSON."));
    } finally {
      setCloudExportBusy(false);
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
  const loadDevSampleData = () => {
    if (!showDeveloperCloudTools) return;
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
    if (!showDeveloperCloudTools) return;
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

      const plan = buildBackupJsonImportPlan(parsed);
      if (!plan.ok) {
        window.alert(plan.blockedReason || "This file cannot be imported.");
        return;
      }

      const counts = plan.counts;
      const countsPreview = [
        `Customers: ${counts.customers}`,
        `Projects: ${counts.projects}`,
        `Estimates: ${counts.estimates}`,
        `Invoices: ${counts.invoices}`,
        `Invoice payments: ${counts.invoicePayments}`,
      ].join("\n");
      const warningsPreview = plan.warnings.length > 0 ? `\n\n${plan.warnings.join("\n")}` : "";

      if (plan.coreRecordTotal === 0) {
        const proceedEmpty = window.confirm(
          `This backup contains no customer, project, estimate, or invoice records.\n\nSource: ${plan.sourceLabel}\n${countsPreview}${warningsPreview}\n\nIt may be an export taken from an empty device. Import anyway (settings, company profile, and templates only)?`
        );
        if (!proceedEmpty) return;
      } else {
        const proceed = window.confirm(
          `Import ${plan.sourceLabel}?\n\n${countsPreview}${warningsPreview}\n\nThis will overwrite matching local data on this device.`
        );
        if (!proceed) return;
      }

      const result = applyBackupJsonImportPlan({ plan, storage: localStorage, companyId: company?.id });

      const mergedSettings = mergeSettingsSafe(loadSettings(), asObject(plan.settings));
      saveSettings(mergedSettings);
      setSettings(mergedSettings);

      // Same-tab refresh so Home/Settings show the imported counts without
      // a reload (mirrors the cloud restore path's change events).
      try {
        window.dispatchEvent(new Event("estipaid:customers-changed"));
        window.dispatchEvent(new Event("estipaid:projects-changed"));
        window.dispatchEvent(new Event("estipaid:estimates-changed"));
        window.dispatchEvent(new Event("estipaid:invoices-changed"));
        window.dispatchEvent(new Event("estipaid:settings-changed"));
      } catch {}

      if (plan.importedDomains.length > 0) {
        markCloudBackupDirty({
          reason: "bulk_json_import",
          domains: [...new Set(plan.importedDomains)],
          severity: "money_critical",
          source: "importJsonFile",
        });
      }

      const imported = result.importedCounts;
      const importedCoreTotal = imported.customers + imported.projects + imported.estimates + imported.invoices;
      if (importedCoreTotal === 0) {
        window.alert("No records imported. This backup did not contain recoverable customer/project/estimate/invoice data.");
      } else {
        window.alert(
          `Imported backup: ${imported.customers} customers, ${imported.projects} projects, ${imported.estimates} estimates, ${imported.invoices} invoices.`
        );
      }
    } catch {
      window.alert("Import failed.");
    } finally {
      setBusyLabel("");
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };


  const cloudBackupStatus = useCloudBackupStatus();
  const [settings, setSettings] = useState(() => loadSettings());
  const [authAction, setAuthAction] = useState("");
  const [workspaceName, setWorkspaceName] = useState(() => inferWorkspaceName());
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [restorePreviewBusy, setRestorePreviewBusy] = useState(false);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [cloudConfirmDialog, setCloudConfirmDialog] = useState(null);
  const {
    configured: isSupabaseReady,
    missingEnvKeys,
    loading: authLoading,
    authBusy,
    user,
    userEmail,
    errorMessage: authErrorMessage,
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
  const deviceLock = useDeviceLockStatus({
    configured: isSupabaseReady,
    user,
    company,
    enabled: Boolean(isSupabaseReady && user?.id && company?.id),
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
  const writeSettings = async updater => {
    if (deviceLock.isLocked) return false;
    const base = normalizeSettings(loadSettings());
    const nextRaw = typeof updater === "function" ? updater(base) : updater;
    const merged = mergeSettingsSafe(base, asObject(nextRaw));
    const saved = await saveSettings(merged);
    if (saved) setSettings(merged);
    return saved;
  };

  // Gate 13O-2J: exports what is on THIS DEVICE only. Never presented as a
  // cloud backup -- an empty device produces an empty artifact by design.

  // Gate 13O-2J: true cloud export -- fetches this workspace's Supabase rows
  // through the same authenticated reads restore uses and downloads a
  // source:"cloud" artifact with explicit counts. Fails loudly (with the
  // failing table) instead of producing an empty "successful" file.

  const requestCloudSignOut = async () => {
    setAuthAction("signout");
    try {
      await signOut();
    } finally {
      setAuthAction("");
    }
  };
  const authPending = authBusy || Boolean(authAction);
  const ensureUnlockedForWrite = useCallback(() => {
    if (!deviceLock.isLocked) return true;
    return false;
  }, [deviceLock.isLocked]);
  const submitWorkspaceCreate = async () => {
    const response = await createWorkspace(workspaceName);
    if (response?.ok) {
      setWorkspaceName(String(response?.result?.company?.name || workspaceName).trim());
    }
  };

  // The canonical hook owns the normal product check. This screen mirrors its
  // evidence for detailed onboarding/restore controls without starting a
  // second status request or deriving another health state.
  useEffect(() => {
    setOnboardingStatus(cloudBackupStatus.onboardingStatus);
  }, [cloudBackupStatus.onboardingStatus]);

  const cloudDecision = cloudBackupStatus.decision;
  const partialLocalSnapshotState = cloudDecision.screenState === LOCAL_DATA_DECISION.PARTIAL_LOCAL_DATA;
  const shouldCheckRestorePreview = onboardingStatus?.status === CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE || partialLocalSnapshotState;
  const restoreAvailability = getCloudRestoreAvailability({
    restorePreview,
    partialLocalSnapshot: partialLocalSnapshotState,
  });
  const restoreActionAvailable = restoreAvailability.available;
  // A safe technical reason when the last automatic convergence did not succeed,
  // so the screen never claims zero blockers with no sign the sync failed. Only
  // the safe code is shown -- no names, numbers, or record details. Cleared once
  // a later matched/converged result arrives (convergenceResult.ok === true).

  // Safe automatic-sync state for the contractor restore section.

  const loadRestorePreview = useCallback(async ({ allowPartialLocalSnapshot }) => {
    return previewSupabaseCloudRestore({
      storageSnapshot: localStorage,
      configured: isSupabaseReady,
      user,
      company,
      allowPartialLocalSnapshot,
    });
  }, [isSupabaseReady, user, company]);

  // Read-only: once onboarding detects a fresh device with cloud data
  // available, or this device is confirmed to be a partial local snapshot,
  // check exactly what (if anything) is safely restorable. Never writes.
  useEffect(() => {
    let active = true;

    if (!shouldCheckRestorePreview) {
      setRestorePreview(null);
      return undefined;
    }

    setRestorePreviewBusy(true);
    loadRestorePreview({ allowPartialLocalSnapshot: partialLocalSnapshotState })
      .then((result) => {
        if (active) setRestorePreview(result);
      })
      .catch(() => {
        if (active) {
          setRestorePreview({
            status: CLOUD_RESTORE_STATUS.ERROR,
            eligible: false,
            error: "Unable to check restore eligibility.",
            noWritesPerformed: true,
          });
        }
      })
      .finally(() => {
        if (active) setRestorePreviewBusy(false);
      });

    return () => {
      active = false;
    };
  }, [shouldCheckRestorePreview, partialLocalSnapshotState, loadRestorePreview]);
  const runCloudRestore = async () => {
    if (!ensureUnlockedForWrite()) return;
    try {
      setRestoreBusy(true);
      const result = await executeSupabaseCloudRestore({
        prepareSecureRestore: onPrepareCloudRestore,
        storage: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        allowPartialLocalSnapshot: partialLocalSnapshotState
      });
      // A competing writer can change local state while a restore is reading
      // cloud rows. Re-check after every attempt that could have observed such
      // a change, not only RESTORED, so LOCAL_NOT_EMPTY is never rendered beside
      // stale pre-attempt local/cloud counts.
      if ([
          CLOUD_RESTORE_STATUS.RESTORED,
          CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY,
          CLOUD_RESTORE_STATUS.DEVICE_LOCKED,
          CLOUD_RESTORE_STATUS.ERROR,
        ].includes(result?.status)
        && isSupabaseReady && user?.id && company?.id) {
        try {
          const nextStatus = await checkSupabaseCloudOnboardingStatus({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role: accountRole,
        allowAutomaticSafeRepair: false,
      });
          setOnboardingStatus(nextStatus);
        } catch {}
      }
    } catch {} finally {
      setRestoreBusy(false);
    }
  };
  const requestCloudRestoreConfirmation = () => {
    if (!ensureUnlockedForWrite()) return;
    setCloudConfirmDialog({
      action: "restore",
      ...buildCloudRestoreConfirmationDialog({ partialLocalSnapshot: partialLocalSnapshotState }),
    });
  };
  const confirmCloudAction = async () => {
    const action = String(cloudConfirmDialog?.action || "").trim();
    setCloudConfirmDialog(null);
    if (action === "restore") {
      await runCloudRestore();
    }
  };
  const resetSettings = async () => {
    if (!window.confirm("Reset all settings to defaults?")) return;
    const defaults = normalizeSettings(DEFAULT_SETTINGS);
    if (await saveSettings(defaults)) setSettings(defaults);
  };
  const clearEstiPaidData = () => {
    if (!window.confirm("Clear all EstiPaid local data? This cannot be undone.")) return;
    try {
      const keys = listEstipaidKeys();
      keys.forEach((key) => {
        // This is device-global vault authority, not workspace business data.
        // Removing it while the encrypted runtime catalog remains creates a
        // guard/catalog mismatch that correctly fails closed after reload.
        if (key === VAULT_COMPATIBILITY_GUARD_KEY) return;
        try { localStorage.removeItem(key); } catch {}
      });
      try { window.dispatchEvent(new Event("estipaid:settings-changed")); } catch {}
      setSettings(loadSettings());
    } catch {
      window.alert("Clear failed.");
    }
  };

  // Gate 13O-2J: import goes through the shared backup JSON contract:
  // detect the source (cloud / device / legacy raw), preview counts before
  // any write, require explicit confirmation (extra-explicit when the file
  // holds zero core records -- the empty-device export trap), then write and
  // refresh the app. Never reports success on a zero-record import.

  return <section className="pe-section">
      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header">
          <div className="pe-company-header-title">
            <img key={spinTick} src="/logo/estipaid.svg" alt={"EstiPaid"} className="pe-company-header-logo esti-spin" draggable={false} />

            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title={"Settings"}>{"Settings"}</h1>
          </div>
          <div className="pe-company-header-controls" />
        </div>

        <div className="pe-company-form-inner ep-section-gap-sm" style={{ gap: 12, paddingBottom: 8 }}>
          {/* Gate 13O-2K: the header h1 above is the page title -- do not
              repeat "Settings" here. */}
          <div style={{ display: "grid", gap: 6 }}>
            <div className="pe-muted" style={{ maxWidth: 760 }}>
              {"Configure business defaults, document behavior, internal visibility, and local tools."}
            </div>
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>{"Business Profile"}</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              {"Company identity used on estimates, invoices, and PDFs."}
            </div>
            <div>
              <button
                type="button"
                className="pe-btn"
                onClick={() => {
                  if (typeof onOpenCompanyProfile === "function") onOpenCompanyProfile();
                }}
              >

                {"Open Business Profile"}
              </button>
            </div>
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>{"Pricing Defaults"}</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              {"Controls that influence the starting markup behavior for new estimates and invoices."}
            </div>
            <SettingRow title={"Default Markup %"} hint={"Starting markup used for new labor and material line items."} control={(
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
              )} />

            <SettingRow title={"Use Default Markup on Line Items"} hint={"When on, labor and itemized material line items use your default markup and their line-item markup fields stay read-only in the builder. Blanket material markup still stays editable per document."} control={(
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
              )} />

          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>{"Internal Cost Visibility"}</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              {"Set visibility and protection for internal cost details used by your team."}
            </div>
            <SettingRow title={"Show Internal Cost Fields"} control={(
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
              )} />

            <SettingRow title={"Lock Internal Cost Fields"} control={(
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
              )} />

          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>{"PDF Preferences"}</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              {"Output layout preferences for generated customer-facing documents."}
            </div>
            <SettingRow title={"Include Logo"} control={(
                <ToggleButton
                  value={!!settings?.pdf?.includeLogo}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    pdf: { ...(prev.pdf || {}), includeLogo: !prev?.pdf?.includeLogo },
                  }))}
                />
              )} />

            <SettingRow title={"Compact Layout"} control={(
                <ToggleButton
                  value={!!settings?.pdf?.compactLayout}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    pdf: { ...(prev.pdf || {}), compactLayout: !prev?.pdf?.compactLayout },
                  }))}
                />
              )} />

            <SettingRow title={"Show Unit Rates"} control={(
                <ToggleButton
                  value={!!settings?.pdf?.showUnitRates}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    pdf: { ...(prev.pdf || {}), showUnitRates: !prev?.pdf?.showUnitRates },
                  }))}
                />
              )} />

          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>{"Customer Defaults"}</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              {"Default requirements applied when creating new customer profiles."}
            </div>
            <SettingRow title={"Default customer type"} control={(
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
              )} />

            <SettingRow title={"Require phone"} control={(
                <ToggleButton
                  value={!!settings?.customer?.requirePhone}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    customer: { ...(prev.customer || {}), requirePhone: !prev?.customer?.requirePhone },
                  }))}
                />
              )} />

            <SettingRow title={"Require email"} control={(
                <ToggleButton
                  value={!!settings?.customer?.requireEmail}
                  onClick={() => writeSettings((prev) => ({
                    ...prev,
                    customer: { ...(prev.customer || {}), requireEmail: !prev?.customer?.requireEmail },
                  }))}
                />
              )} />

          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{ marginBottom: 2 }}>{"Local Vault Lock"}</div>
            <div className="pe-field-helper" style={{ marginTop: -4 }}>
              {"EstiPaid automatically locks the encrypted local vault after inactivity. Unlocking again requires the Local Data Password. Locking does not sign you out and does not delete local or cloud data."}
            </div>
            <SettingRow title={"Lock after inactivity"} hint={"Choose how long this workspace can remain unlocked without meaningful activity."} control={<select className="pe-input" aria-label={"Automatic vault lock after inactivity"} value={String(vaultIdleLockMinutes)} onChange={(event) => {
                    const minutes = Number(event.target.value);
                    if (VAULT_IDLE_LOCK_MINUTES.includes(minutes) && typeof onVaultIdleLockMinutesChange === "function") {
                      onVaultIdleLockMinutesChange(minutes);
                    }
                  }}>

                  {vaultIdleLockOptions
                    .filter((minutes) => VAULT_IDLE_LOCK_MINUTES.includes(minutes))
                    .map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                </select>} />

            <div>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => {
                  if (typeof onVaultLockNow === "function") onVaultLockNow();
                }}
              >

                {"Lock Now"}
              </button>
            </div>
          </div>

          <div style={shortcutGridStyle}>
            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
              {/* Gate 13O-2K: the header h1 above is the page title -- do not
              repeat "Settings" here. */}
              <div className="pe-field-label" style={{ marginBottom: 2 }}>{"Account"}</div>
              <div className="pe-field-helper" style={{ marginTop: -4 }}>
                {"The EstiPaid account signed in on this device. Signing out returns you to the sign-in screen and leaves your local records on this device untouched."}
              </div>
              {!isSupabaseReady ? <>
                  <div className="pe-field-helper">
                    Supabase not configured. Set {missingEnvKeys.join(" and ")} to enable account sign-in.
                  </div>
                  <div className="pe-field-helper">
                    {"Download This Device Backup JSON in Developer Tools before any future migration or cloud-write step."}
                  </div>
                </> : authLoading ? <div className="pe-field-helper">{"Checking cloud account session..."}</div> : userEmail ? <>
                  <div className="pe-field-helper">
                    {"Signed in as:"} <strong>{userEmail}</strong>
                  </div>
                  {accountLoading ? <div className="pe-field-helper">{"Checking company membership..."}</div> : null}
                  {!accountLoading && hasCompany ? <div className="pe-field-helper">
                      {"Company:"} <strong>{String(company?.name || "Unnamed company")}</strong>
                    </div> : null}
                  {!accountLoading && accountRole ? <div className="pe-field-helper">
                      {"Role:"} <strong>{accountRole}</strong>
                    </div> : null}
                  {!accountLoading && !accountError && !companyUser ? <>
                      <div className="pe-field-helper">{"No company membership found yet."}</div>
                      <div className="pe-field-helper">
                        {"This creates your cloud workspace only. Backup and restore become available after setup."}
                      </div>
                      <div style={{ display: "grid", gap: 8, maxWidth: 440 }}>
                        <label className="pe-field-helper" htmlFor="cloud-workspace-name" style={{ marginTop: 2 }}>
                          {"Company / Workspace Name"}
                        </label>
                        <input id="cloud-workspace-name" type="text" className="pe-input" value={workspaceName} onChange={(e) => setWorkspaceName(e.target.value)} placeholder={"Field Pocket LLC"} disabled={creatingWorkspace} />

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
                    </> : null}
                  {!accountLoading && !accountError && companyUser && !hasCompany ? <div className="pe-field-helper">{"Company record not found for this membership yet."}</div> : null}
                  <div>
                    <button
                      type="button"
                      className="pe-btn pe-btn-ghost"
                      onClick={requestCloudSignOut}
                      disabled={authPending}
                    >

                      {authAction === "signout" ? "Signing Out..." : "Sign Out"}
                    </button>
                  </div>
                </> : <div className="pe-field-helper">{"Sign in from the welcome screen to use cloud backup."}</div>}
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
              {!authErrorMessage && !accountError && workspaceSuccess ? (
                <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                  {workspaceSuccess}
                </div>
              ) : null}

              {<div
                style={{
                  display: "grid",
                  gap: 8,
                  paddingTop: 8,
                  borderTop: "1px solid rgba(148,163,184,0.18)",
                }}
              >

                  <div className="pe-field-label" style={{ marginBottom: 0 }}>Cloud Backup</div>
                  {isSupabaseReady && userEmail && hasCompany ? <>
                      <div className="pe-field-helper">Cloud account connected.</div>
                      <div className="pe-field-helper">Automatic backup is on.</div>
                      <div role="status" aria-live="polite" className="pe-field-helper" style={{
                  fontWeight: 800
                }}>
                        {cloudBackupStatus.productState === CLOUD_PRODUCT_STATE.CLOUD_OK ? "Cloud OK" : cloudBackupStatus.productState === CLOUD_PRODUCT_STATE.SYNCING ? "Syncing" : cloudBackupStatus.productState === CLOUD_PRODUCT_STATE.PENDING ? "Pending" : cloudBackupStatus.productState === CLOUD_PRODUCT_STATE.SYNC_ISSUE ? "Sync issue" : cloudBackupStatus.productState === CLOUD_PRODUCT_STATE.RESTORE_AVAILABLE ? "Restore available" : "Cloud connected"}
                      </div>
                      {cloudBackupStatus.productState === CLOUD_PRODUCT_STATE.PENDING ? <div className="pe-field-helper">
                          {cloudBackupStatus.productStatus.pendingReason === "offline" ? "Your changes are saved on this device. Sync will continue automatically when you’re back online." : "Your changes are saved on this device and will sync automatically."}
                        </div> : null}
                      {cloudBackupStatus.productState === CLOUD_PRODUCT_STATE.SYNC_ISSUE ? <div className="pe-field-helper">
                          EstiPaid is having trouble syncing. Your changes are saved on this device and EstiPaid will retry automatically.
                        </div> : null}
                      {cloudBackupStatus.productStatus.lastSuccessfulSyncAt ? <div className="pe-field-helper">
                          Last synced {new Date(cloudBackupStatus.productStatus.lastSuccessfulSyncAt).toLocaleString()}
                        </div> : null}
                      {onboardingStatus?.status === CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE && restoreActionAvailable ? <div>
                          <button type="button" className="pe-btn" onClick={requestCloudRestoreConfirmation} disabled={restoreBusy || restorePreviewBusy}>

                            {restoreBusy ? "Restoring..." : "Restore Cloud to This Device"}
                          </button>
                        </div> : null}
                    </> : <div className="pe-field-helper">Cloud backup becomes available after sign-in and workspace setup.</div>}

                </div>}
            </div>

            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
              <div className="pe-field-label" style={{ marginBottom: 2 }}>{"Templates"}</div>
              <div className="pe-field-helper" style={{ marginTop: -4 }}>
                {"Manage reusable work-package templates."}
              </div>
              <div>
                <button
                  type="button"
                  className="pe-btn"
                  onClick={() => {
                    if (typeof onOpenTemplates === "function") onOpenTemplates();
                  }}
                >

                  {"Open Templates"}
                </button>
              </div>
            </div>

            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
              <div className="pe-field-label" style={{ marginBottom: 2 }}>{"Reports & Bookkeeping"}</div>
              <div className="pe-field-helper" style={{ marginTop: -4 }}>
                {"View business snapshot and future bookkeeping exports."}
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

          {null}

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
                <button
                  type="button"
                  className="pe-btn pe-btn-ghost"
                  onClick={downloadCloudBackupJson}
                  disabled={cloudExportBusy}
                >
                  {cloudExportBusy ? "Preparing Cloud Backup..." : "Download Cloud Backup JSON"}
                </button>
                <button type="button" className="pe-btn pe-btn-ghost" onClick={downloadBackupJson}>
                  Download This Device Backup JSON
                </button>
                <button type="button" className="pe-btn pe-btn-ghost" onClick={exportData}>
                  Export Raw App Data
                </button>
                <button
                  type="button"
                  className="pe-btn pe-btn-ghost"
                  onClick={() => importInputRef.current?.click?.()}
                >
                  Import Backup JSON
                </button>
              </div>

              {showDeveloperCloudTools ? (
                <div style={{ display: "grid", gap: 8, paddingTop: 8, borderTop: "1px solid rgba(148,163,184,0.18)" }}>
                  <div className="pe-field-label" style={{ marginBottom: 0 }}>Development Sample Data</div>
                  <div className="pe-field-helper">
                    Loads deterministic development fixtures into normal EstiPaid storage for controlled testing.
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" className="pe-btn pe-btn-ghost" onClick={loadDevSampleData}>
                      Load / Refresh Sample Data
                    </button>
                    <button type="button" className="pe-btn pe-btn-ghost" onClick={clearOnlyDevSampleData}>
                      Clear Sample Data
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="pe-field-helper" style={{ marginTop: 2 }}>
                Diagnostics exports create a redacted support bundle. Cloud Backup JSON downloads this workspace&apos;s records from Supabase. This Device Backup JSON exports only data currently stored on this device — it does not download your cloud backup, and it will be empty if this device is empty. Import Backup JSON accepts cloud, device, and raw app data backup files and previews record counts before writing.
              </div>
              {diagnosticsMessage ? (
                <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: diagnosticsMessage.includes("Unable") ? "rgba(248,113,113,0.95)" : "rgba(187,247,208,0.95)" }}>
                  {diagnosticsMessage}
                </div>
              ) : null}
            </div>
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

          <div className="ep-glass-tile ep-tile-hover" style={{ ...panelStyle, border: "1px solid rgba(239,68,68,0.38)", background: "linear-gradient(180deg, rgba(127,29,29,0.22), rgba(15,23,42,0.52))" }}>
            <div className="pe-field-label" style={{ marginBottom: 2, color: "rgba(254,202,202,0.95)" }}>
              {"Danger Zone"}
            </div>
            <div className="pe-field-helper">
              {"Destructive maintenance actions for local device data. Review before applying."}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", paddingTop: 4, borderTop: "1px solid rgba(248,113,113,0.24)" }}>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={resetSettings}>
                {"Reset Settings"}
              </button>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                style={{ borderColor: "rgba(248,113,113,0.34)", color: "rgba(254,202,202,0.94)" }}
                onClick={clearEstiPaidData}
              >

                {"Clear EstiPaid local data"}
              </button>
            </div>
          </div>
        </div>
      </div>
      <CloudConfirmDialog dialog={cloudConfirmDialog} onCancel={() => setCloudConfirmDialog(null)} onConfirm={confirmCloudAction} />

    </section>;
}
