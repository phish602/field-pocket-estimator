import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from "../utils/settings";
import { clearDevSampleData, seedDevSampleData } from "../utils/devSampleData";
import { appendAuditEvent, createStoredAuditEvent, readStoredAuditEvents } from "../utils/auditStore";
import { buildDiagnosticBundle } from "../utils/supportDiagnostics";
import { triggerLocalStorageExportDownload } from "../lib/localStorageExportDownload";
import useSupabaseAuth from "../lib/useSupabaseAuth";
import useSupabaseAccount from "../lib/useSupabaseAccount";
import useDeviceLockStatus from "../lib/useDeviceLockStatus";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";
import { createSupabaseMigrationPreview } from "../lib/supabaseMigrationPreview";
import { isSupabaseMigrationPreviewReady, runSupabaseMigrationWrite } from "../lib/supabaseMigrationWriter";
import { runSupabaseCloudVerification } from "../lib/supabaseCloudVerification";
import { CLOUD_CONVERGENCE_RESULT_EVENT, getLastCloudConvergenceResult, requestCloudConvergence } from "../lib/supabaseCloudConvergence";
import {
  previewSupabaseCloudRestore,
  executeSupabaseCloudRestore,
  exportSupabaseCloudBackupArtifact,
  CLOUD_RESTORE_STATUS,
  CLOUD_BACKUP_EXPORT_STATUS,
  CLOUD_RESTORE_STOPPED_MESSAGE,
} from "../lib/supabaseCloudRestore";
import { triggerCloudBackupExportDownload } from "../lib/cloudBackupExportDownload";
import { buildBackupJsonImportPlan, applyBackupJsonImportPlan } from "../lib/backupJsonImport";
import {
  checkSupabaseCloudOnboardingStatus,
  runSupabaseCloudOnboardingBackup,
  CLOUD_ONBOARDING_STATUS,
} from "../lib/supabaseCloudOnboarding";
import {
  updateEstimateRestorePayloads,
  ESTIMATE_PAYLOAD_UPDATE_STATUS,
} from "../lib/supabaseEstimateRestorePayload";
import {
  updateSupabaseAppRestoreBundle,
  APP_RESTORE_BUNDLE_STATUS,
} from "../lib/supabaseAppRestoreBundle";
import { markCloudBackupDirty, readCloudBackupQueueState, markCloudBackupSyncing, applyCloudBackupResultToQueue, CLOUD_BACKUP_STATUS } from "../lib/cloudBackupQueue";
import { acquireCloudBackupRunLock, releaseCloudBackupRunLock } from "../lib/cloudBackupRunLock";
import { CLOUD_AUTO_BACKUP_RUNNING_EVENT } from "../lib/useCloudAutoBackup";
import {
  getCloudDataDecision,
  LOCAL_DATA_DECISION,
  repairStoredLocalDataIntegrity,
} from "../lib/localDataIntegrity";
import CloudConfirmDialog from "../components/CloudConfirmDialog";
import {
  buildCloudRestoreConfirmationDialog,
  buildPartialSnapshotRecheckMessage,
  getCloudRestoreAvailability,
} from "../lib/cloudRestoreUi";

const ESTIPAID_PREFIX = "estipaid-";
const DEV_CLOUD_TOOLS_FLAG = "estipaid-dev-cloud-tools-v1";

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

// Requests a fresh automatic-convergence attempt and resolves with the next safe
// result event, or the last known result after a bounded timeout. Never calls
// Restore/Replace -- it only asks the automatic hook to try again.
function requestAndAwaitCloudConvergence(timeoutMs = 8000) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) { clearTimeout(timer); timer = null; }
      try { window.removeEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onResult); } catch {}
      resolve(value);
    };
    const onResult = (event) => finish(event?.detail || getLastCloudConvergenceResult() || null);
    try { window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onResult); } catch { finish(getLastCloudConvergenceResult() || null); return; }
    requestCloudConvergence();
    timer = setTimeout(() => finish(getLastCloudConvergenceResult() || null), timeoutMs);
  });
}

// Tables the deliberate "Replace Cloud Backup With This Device" action is
// allowed to remove cloud-only rows from (kept in sync with
// CLOUD_ONLY_REPLACEABLE_TABLES in supabaseMigrationWriter.js). Invoices and
// invoice payments are financial records and are never removed by Replace.
const REPLACEABLE_MISMATCH_TABLES = new Set(["customers", "projects", "estimates"]);

// A generic "Cloud verification found mismatches" notice tells the user
// something is wrong but not what, or which action (Restore vs Replace)
// would actually fix it. This turns the per-table verification result into
// a short, concrete reason per table so the user is never stuck guessing.
function describeVerificationMismatchTables(verification) {
  const results = Array.isArray(verification?.tableResults) ? verification.tableResults : [];
  return results
    .filter((result) => String(result?.status || "") === "mismatch" || String(result?.status || "") === "unavailable")
    .map((result) => {
      const table = String(result?.table || "").trim();
      const label = table.replace(/_/g, " ");
      if (String(result?.status) === "unavailable") {
        return `${label}: could not be verified (${String(result?.error || "cloud read failed")}).`;
      }
      const missing = Array.isArray(result?.missingLegacyIds) ? result.missingLegacyIds.length : 0;
      const extra = Array.isArray(result?.extraLegacyIds) ? result.extraLegacyIds.length : 0;
      const countOnly = Boolean(result?.countOnly);
      const parts = [];
      if (extra > 0) parts.push(`${extra} only in the cloud`);
      if (missing > 0) parts.push(`${missing} only on this device`);
      if (parts.length === 0) {
        parts.push(countOnly ? "row count does not match" : "does not match");
      }
      let hint;
      if (extra > 0 && REPLACEABLE_MISMATCH_TABLES.has(table)) {
        hint = "Replace can remove the cloud-only rows.";
      } else if (countOnly && table === "invoice_line_items") {
        hint = "Replace will not remove protected invoice data. Export backups first, then restore cloud data here to review it.";
      } else if (extra > 0) {
        hint = "Replace will not remove these (invoices/payments are protected) -- restore cloud data here to review them instead.";
      } else if (missing > 0) {
        hint = "Restore can bring the missing rows down, or back up this device to push them up.";
      } else {
        hint = "Restore or replace should clear this once run.";
      }
      return `${label}: ${parts.join(", ")}. ${hint}`;
    });
}

function hasEstimateLineItemsReplacePermissionError(status) {
  const notices = [
    ...(Array.isArray(status?.writeResult?.notices) ? status.writeResult.notices : []),
    ...(Array.isArray(status?.verification?.notices) ? status.verification.notices : []),
  ];
  return notices.some((notice) => {
    const code = String(notice?.code || "").trim();
    const message = String(notice?.message || "").trim();
    return code === "estimate_line_items_cloud_only_replace_failed" && /permission denied/i.test(message);
  });
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

function resolveDeveloperCloudToolsEnabled(explicitValue) {
  if (typeof explicitValue === "boolean") return explicitValue;
  try {
    if (localStorage.getItem(DEV_CLOUD_TOOLS_FLAG) === "1") return true;
  } catch {}
  try {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search || "");
      if (params.get("devCloudTools") === "1") return true;
    }
  } catch {}
  return false;
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
  developerCloudToolsEnabled,
} = {}) {
  const [settings, setSettings] = useState(() => loadSettings());
  const [busyLabel, setBusyLabel] = useState("");
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [cloudExportBusy, setCloudExportBusy] = useState(false);
  const [diagnosticsMessage, setDiagnosticsMessage] = useState("");
  const [authAction, setAuthAction] = useState("");
  const [workspaceName, setWorkspaceName] = useState(() => inferWorkspaceName());
  const [migrationPreviewBusy, setMigrationPreviewBusy] = useState(false);
  const [migrationPreview, setMigrationPreview] = useState(null);
  const [migrationConfirmText, setMigrationConfirmText] = useState("");
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationResult, setMigrationResult] = useState(null);
  const [cloudVerifyBusy, setCloudVerifyBusy] = useState(false);
  const [cloudVerification, setCloudVerification] = useState(null);
  const [onboardingStatusBusy, setOnboardingStatusBusy] = useState(false);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [convergenceResult, setConvergenceResult] = useState(() => getLastCloudConvergenceResult());
  const [convergenceTick, setConvergenceTick] = useState(0);
  const [onboardingBackupBusy, setOnboardingBackupBusy] = useState(false);
  const [autoBackupQueueState, setAutoBackupQueueState] = useState(() => readCloudBackupQueueState());
  const [autoBackupWorkerRunning, setAutoBackupWorkerRunning] = useState(false);
  const [restorePreviewBusy, setRestorePreviewBusy] = useState(false);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const [repairBusy, setRepairBusy] = useState(false);
  const [repairResult, setRepairResult] = useState(null);
  const [replaceCloudBusy, setReplaceCloudBusy] = useState(false);
  const [replaceConfirmChecked, setReplaceConfirmChecked] = useState(false);
  const [cloudStatusMessage, setCloudStatusMessage] = useState("");
  const [appBundleConfirmText, setAppBundleConfirmText] = useState("");
  const [appBundleBusy, setAppBundleBusy] = useState(false);
  const [appBundleResult, setAppBundleResult] = useState(null);
  const [estimatePayloadConfirmText, setEstimatePayloadConfirmText] = useState("");
  const [estimatePayloadBusy, setEstimatePayloadBusy] = useState(false);
  const [estimatePayloadResult, setEstimatePayloadResult] = useState(null);
  const [cloudConfirmDialog, setCloudConfirmDialog] = useState(null);
  const importInputRef = useRef(null);
  const diagnosticsMessageTimerRef = useRef(null);
  const isDevBuild = process.env.NODE_ENV !== "production";
  const showDeveloperCloudTools = resolveDeveloperCloudToolsEnabled(developerCloudToolsEnabled);
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
  const lockedDeviceMessage = "This device is locked because EstiPaid is active on another device. Switch EstiPaid to this device before editing or using cloud actions here.";

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
      if (deviceLock.isLocked) {
        setCloudStatusMessage(lockedDeviceMessage);
        return prev;
      }
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

  // Gate 13O-2J: exports what is on THIS DEVICE only. Never presented as a
  // cloud backup -- an empty device produces an empty artifact by design.
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

  // Gate 13O-2J: true cloud export -- fetches this workspace's Supabase rows
  // through the same authenticated reads restore uses and downloads a
  // source:"cloud" artifact with explicit counts. Fails loudly (with the
  // failing table) instead of producing an empty "successful" file.
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

  const requestCloudSignOut = async () => {
    setAuthAction("signout");
    try {
      await signOut();
    } finally {
      setAuthAction("");
    }
  };

  const authPending = authBusy || Boolean(authAction);
  const ensureUnlockedForWrite = useCallback((message = lockedDeviceMessage) => {
    if (!deviceLock.isLocked) return true;
    setCloudStatusMessage(message);
    return false;
  }, [deviceLock.isLocked]);

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
    if (!ensureUnlockedForWrite()) return;
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

  const runCloudVerification = async () => {
    try {
      setCloudVerifyBusy(true);
      const result = await runSupabaseCloudVerification({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
      });
      setCloudVerification(result);
    } catch {
      setCloudVerification({
        ok: false,
        company: {
          id: String(company?.id || "").trim(),
          name: String(company?.name || "").trim(),
        },
        validations: {
          supabaseConfigured: isSupabaseReady,
          signedIn: Boolean(user?.id),
          hasCompany: Boolean(company?.id),
        },
        localCounts: null,
        tableResults: [],
        allMatched: false,
        notices: [{ level: "error", code: "cloud_verification_failed", message: "Unable to run cloud verification." }],
        noWritesPerformed: true,
      });
    } finally {
      setCloudVerifyBusy(false);
    }
  };

  // Checks whether the cloud already matches local data so the contractor-
  // facing Cloud Backup section can show a simple state without requiring
  // any click. If the only issue is an already-classified safe metadata
  // repair, the onboarding helper will fix it and continue automatically.
  useEffect(() => {
    let active = true;
    const userId = String(user?.id || "").trim();
    const companyId = String(company?.id || "").trim();

    if (!isSupabaseReady || !userId || !companyId) {
      setOnboardingStatus(null);
      return undefined;
    }

    setOnboardingStatusBusy(true);
    checkSupabaseCloudOnboardingStatus({
      storageSnapshot: localStorage,
      configured: isSupabaseReady,
      user,
      company,
      role: accountRole,
    })
      .then((result) => {
        if (active) setOnboardingStatus(result);
      })
      .catch(() => {
        if (active) {
          setOnboardingStatus({
            status: CLOUD_ONBOARDING_STATUS.ERROR,
            preview: null,
            verification: null,
            writeResult: null,
            error: "Unable to check cloud backup status.",
            noWritesPerformed: true,
          });
        }
      })
      .finally(() => {
        if (active) setOnboardingStatusBusy(false);
      });

    return () => {
      active = false;
    };
  }, [isSupabaseReady, user, company, accountRole, convergenceTick]);

  // Automatic convergence finished (any outcome): re-run the onboarding/cloud
  // verification check so a stale pre-convergence mismatch is replaced. A
  // verified success reaches Cloud OK; a failure keeps the mismatch and records
  // a safe technical reason for display.
  useEffect(() => {
    const onConvergenceResult = (event) => {
      setConvergenceResult(event?.detail || getLastCloudConvergenceResult());
      setConvergenceTick((value) => value + 1);
    };
    try { window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onConvergenceResult); } catch {}
    return () => { try { window.removeEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onConvergenceResult); } catch {} };
  }, []);

  const runCloudBackup = async () => {
    if (!ensureUnlockedForWrite()) return;
    // Shared with the Gate 13B automatic background worker so a manual click
    // and an automatic run never execute a cloud backup at the same time.
    if (!acquireCloudBackupRunLock()) return;
    try {
      setOnboardingBackupBusy(true);
      // Capture the queue generation so a verified clear cannot wipe out a
      // local mutation that lands while this manual backup is in flight.
      const syncingQueue = markCloudBackupSyncing({ companyId: company?.id });
      const queueGeneration = Number(syncingQueue?.syncingRevision ?? 0);
      const result = await runSupabaseCloudOnboardingBackup({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role: accountRole,
        queueGeneration,
      });
      setOnboardingStatus(result);
      // Manual Retry Sync applies the SAME queue classification as the automatic
      // worker, then immediately refreshes the persisted queue shown on screen,
      // so it can never leave stale "retrying" copy after a remote_changed /
      // conflict result.
      applyCloudBackupResultToQueue(result, { queueGeneration });
      setAutoBackupQueueState(readCloudBackupQueueState());
    } catch {
      setOnboardingStatus({
        status: CLOUD_ONBOARDING_STATUS.ERROR,
        preview: null,
        verification: null,
        writeResult: null,
        error: "Unable to complete cloud backup.",
        noLocalDeletes: true,
      });
      applyCloudBackupResultToQueue({ status: CLOUD_ONBOARDING_STATUS.ERROR, error: "Unable to complete cloud backup." });
      setAutoBackupQueueState(readCloudBackupQueueState());
    } finally {
      releaseCloudBackupRunLock();
      setOnboardingBackupBusy(false);
    }
  };

  // Deliberate, user-confirmed replacement path for when the cloud has rows
  // (e.g. estimates) that are not present on this device. Never runs
  // automatically -- only from the explicit "Replace Cloud Backup With This
  // Device" confirmation below. Shares the normal backup's run lock so it
  // can never race the Gate 13B automatic background worker.
  const runReplaceCloudBackup = async () => {
    if (!ensureUnlockedForWrite()) return;
    if (!acquireCloudBackupRunLock()) return;
    try {
      setReplaceCloudBusy(true);
      const syncingQueue = markCloudBackupSyncing({ companyId: company?.id });
      const queueGeneration = Number(syncingQueue?.syncingRevision ?? 0);
      const result = await runSupabaseCloudOnboardingBackup({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role: accountRole,
        allowCloudOnlyReplacement: true,
        queueGeneration,
      });
      setOnboardingStatus(result);
      applyCloudBackupResultToQueue(result, { queueGeneration });
      setAutoBackupQueueState(readCloudBackupQueueState());
      const replacedRows = result?.writeResult?.replacedCloudOnlyRows;
      if (Array.isArray(replacedRows) && replacedRows.length > 0) {
        const auditEvent = createStoredAuditEvent("data_integrity.cloud_only_rows_replaced", {
          meta: {
            tables: replacedRows.map((entry) => entry?.table).filter(Boolean),
            totalRows: replacedRows.reduce((sum, entry) => sum + (Array.isArray(entry?.legacyIds) ? entry.legacyIds.length : 0), 0),
          },
        });
        if (auditEvent) appendAuditEvent(auditEvent);
      }
    } catch {
      setOnboardingStatus({
        status: CLOUD_ONBOARDING_STATUS.ERROR,
        preview: null,
        verification: null,
        writeResult: null,
        error: "Unable to replace the cloud backup.",
        noLocalDeletes: true,
      });
      applyCloudBackupResultToQueue({ status: CLOUD_ONBOARDING_STATUS.ERROR, error: "Unable to replace the cloud backup." });
      setAutoBackupQueueState(readCloudBackupQueueState());
    } finally {
      releaseCloudBackupRunLock();
      setReplaceCloudBusy(false);
    }
  };

  // Read-only: mirrors the Gate 13A cloud-backup queue and the Gate 13B
  // worker's live running state so this screen can show a calm, separate
  // "automatic backup" status line without changing the onboarding flow
  // above. Never writes.
  useEffect(() => {
    const refreshQueueState = () => setAutoBackupQueueState(readCloudBackupQueueState());

    const onStorageEvent = (event) => {
      const key = event?.detail?.key;
      if (key && key !== STORAGE_KEYS.CLOUD_BACKUP_QUEUE) return;
      refreshQueueState();
    };

    const onWorkerRunningEvent = (event) => {
      setAutoBackupWorkerRunning(Boolean(event?.detail?.running));
    };

    refreshQueueState();

    try {
      window.addEventListener("pe-localstorage", onStorageEvent);
      window.addEventListener(CLOUD_AUTO_BACKUP_RUNNING_EVENT, onWorkerRunningEvent);
    } catch {}

    return () => {
      try {
        window.removeEventListener("pe-localstorage", onStorageEvent);
        window.removeEventListener(CLOUD_AUTO_BACKUP_RUNNING_EVENT, onWorkerRunningEvent);
      } catch {}
    };
  }, []);

  const autoBackupRunning = onboardingBackupBusy || autoBackupWorkerRunning;
  // "Current" is only shown once a backup has actually been confirmed --
  // a fresh queue that has never been dirty and never backed up has nothing
  // to report yet, so the detailed status below speaks for it instead.
  // Priority (highest first): running, conflict, remote_changed, needs_attention
  // (retry_wait folds into pending/retry copy below), pending, clean. A review
  // state (conflict/remote_changed) must always win over the retrying copy so
  // the screen can never show "EstiPaid is retrying" alongside "Cloud changed
  // elsewhere".
  const autoBackupDisplayState = autoBackupRunning
    ? "running"
    : autoBackupQueueState.status === CLOUD_BACKUP_STATUS.CONFLICT
      ? "conflict"
      : autoBackupQueueState.status === CLOUD_BACKUP_STATUS.REMOTE_CHANGED
        ? "remote_changed"
        : autoBackupQueueState.status === CLOUD_BACKUP_STATUS.NEEDS_ATTENTION
          ? "needs_attention"
          : autoBackupQueueState.pending
            ? "pending"
            : autoBackupQueueState.lastSuccessfulBackupAt
              ? "current"
              : "none";
  const backupAttentionDetail = String(
    onboardingStatus?.writeResult?.notices?.find((notice) => notice?.level !== "info")?.message
      || onboardingStatus?.writeResult?.reason
      || onboardingStatus?.verification?.notices?.find((notice) => notice?.level !== "info")?.message
      || onboardingStatus?.error
      || ""
  ).trim();
  const replaceEstimateLineItemsPermissionBlocked = hasEstimateLineItemsReplacePermissionError(onboardingStatus);
  const localIntegrity = onboardingStatus?.preview?.integrity || migrationPreview?.integrity || null;
  const automaticSafeRepair = onboardingStatus?.automaticSafeRepair || null;
  const automaticSafeRepairFailed = Boolean(automaticSafeRepair?.failed);
  const automaticSafeRepairRunning = Boolean(
    onboardingStatusBusy
    && localIntegrity?.backupReadiness?.canProceedAfterSafeRepair
  );
  const cloudDecision = getCloudDataDecision({
    localIntegrity,
    cloudVerification: onboardingStatus?.verification || cloudVerification,
    queueState: autoBackupQueueState,
    onboardingStatus,
    restorePreview,
    workerRunning: autoBackupRunning,
    restoredRecently: restoreResult?.status === CLOUD_RESTORE_STATUS.RESTORED,
  });
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
  const convergenceFailureReason = convergenceResult && convergenceResult.ok === false
    ? `Automatic cloud sync stopped: ${String(convergenceResult.code || convergenceResult.status || "unknown").trim()}.`
    : "";
  // Safe automatic-sync state for the Data Check section (no sensitive details).
  const automaticSyncState = convergenceResult
    ? {
        status: String(convergenceResult.status || "").trim(),
        code: String(convergenceResult.code || "").trim(),
        stage: String(convergenceResult.stage || "").trim(),
        // Why a clean-replica bootstrap was refused (e.g.
        // baseline_bootstrap_evidence_invalid). A fixed code, never a record
        // detail.
        bootstrapCode: String(convergenceResult.bootstrapCode || "").trim(),
        // Gate 16G: WHICH metadata refused the bootstrap (a legacy queue, a
        // stale takeover pause, a real safety lock...) and how far recovery
        // got. Fixed codes and schema versions only -- never a record detail.
        bootstrapDetailCode: String(convergenceResult.bootstrapDetailCode || "").trim(),
        metadataRecoveryStage: String(convergenceResult.metadataRecoveryStage || "").trim(),
        pauseReason: String(convergenceResult.pauseReason || "").trim(),
        retryable: Boolean(convergenceResult.retryable),
        ok: Boolean(convergenceResult.ok),
        conflictSummary: Array.isArray(convergenceResult.conflictSummary)
          ? convergenceResult.conflictSummary.map((entry) => ({ family: String(entry?.family || "").trim(), code: String(entry?.code || "").trim(), count: Number(entry?.count || 0) })).filter((entry) => entry.family && entry.code && entry.count > 0)
          : [],
      }
    : null;
  const cloudBackupDetail = String(
    (replaceEstimateLineItemsPermissionBlocked
      ? "Replace reached estimate line item cleanup, but this account does not have permission to delete those cloud rows. Cloud backup cannot be replaced until estimate_line_items cleanup is allowed."
      : "")
      || cloudDecision?.firstBlocker?.message
      || (showDeveloperCloudTools ? cloudDecision?.firstSafeRepair?.message : "")
      // Convergence failure reason precedes the generic verification message so a
      // real automatic-sync stop is never masked by generic mismatch copy.
      || convergenceFailureReason
      || backupAttentionDetail
      || ""
  ).trim();
  const mismatchTableDetails = describeVerificationMismatchTables(onboardingStatus?.verification || cloudVerification);

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
      setCloudStatusMessage("");
      const result = await executeSupabaseCloudRestore({
        storage: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        allowPartialLocalSnapshot: partialLocalSnapshotState,
      });
      setRestoreResult(result);
      if (result?.deviceLockLost) {
        setCloudStatusMessage(CLOUD_RESTORE_STOPPED_MESSAGE);
      }
      // executeSupabaseCloudRestore never re-verifies on its own, so without
      // this the mismatch state on this screen would never clear after a
      // successful restore -- only the header chip's separate hook refreshes
      // on the restore-complete event. Re-check the same way runSafeMetadataRepair
      // does after a repair.
      if (result?.status === CLOUD_RESTORE_STATUS.RESTORED && isSupabaseReady && user?.id && company?.id) {
        try {
          const nextStatus = await checkSupabaseCloudOnboardingStatus({
            storageSnapshot: localStorage,
            configured: isSupabaseReady,
            user,
            company,
            role: accountRole,
          });
          setOnboardingStatus(nextStatus);
        } catch {}
      }
    } catch {
      setRestoreResult({
        status: CLOUD_RESTORE_STATUS.ERROR,
        restored: false,
        error: "Unable to complete cloud restore.",
        noWritesPerformed: true,
        noCloudDataDeleted: true,
        noExistingLocalDataOverwritten: true,
      });
    } finally {
      setRestoreBusy(false);
    }
  };

  const runSafeMetadataRepair = async () => {
    try {
      setRepairBusy(true);
      const result = repairStoredLocalDataIntegrity(localStorage);
      setRepairResult(result);
      if (result?.changed) {
        markCloudBackupDirty({
          reason: "safe_metadata_repaired",
          domains: ["estimates", "invoices"],
          severity: "normal",
          source: "AdvancedSettingsScreen",
        });
        const auditEvent = createStoredAuditEvent("data_integrity.safe_metadata_repaired", {
          meta: {
            estimateNumbers: result?.repairs?.estimateNumbers?.length || 0,
            staleInvoiceSourceEstimateIds: result?.repairs?.staleInvoiceSourceEstimateIds?.length || 0,
            staleInvoiceProjectIds: result?.repairs?.staleInvoiceProjectIds?.length || 0,
          },
        });
        if (auditEvent) appendAuditEvent(auditEvent);
      }
      if (isSupabaseReady && user?.id && company?.id) {
        try {
          const nextStatus = await checkSupabaseCloudOnboardingStatus({
            storageSnapshot: localStorage,
            configured: isSupabaseReady,
            user,
            company,
            role: accountRole,
          });
          setOnboardingStatus(nextStatus);
        } catch {}
      }
    } finally {
      setRepairBusy(false);
    }
  };

  const runCloudStatusRecheck = async () => {
    try {
      setOnboardingStatusBusy(true);
      setCloudStatusMessage("");
      // First ask the automatic hook to actually attempt convergence (import the
      // eligible cloud-only records), then await its safe result, THEN re-verify.
      // This never invokes manual Restore or Replace.
      const convergence = await requestAndAwaitCloudConvergence();
      if (convergence) setConvergenceResult(convergence);
      const result = await checkSupabaseCloudOnboardingStatus({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role: accountRole,
      });
      setOnboardingStatus(result);
      const nextDecision = getCloudDataDecision({
        localIntegrity: result?.preview?.integrity || null,
        cloudVerification: result?.verification || null,
        queueState: autoBackupQueueState,
        onboardingStatus: result,
        restorePreview: null,
        workerRunning: autoBackupRunning,
        restoredRecently: restoreResult?.status === CLOUD_RESTORE_STATUS.RESTORED,
      });
      if (nextDecision.screenState === LOCAL_DATA_DECISION.PARTIAL_LOCAL_DATA) {
        try {
          const nextRestorePreview = await loadRestorePreview({ allowPartialLocalSnapshot: true });
          setRestorePreview(nextRestorePreview);
          const nextRestoreAvailability = getCloudRestoreAvailability({
            restorePreview: nextRestorePreview,
            partialLocalSnapshot: true,
          });
          setCloudStatusMessage(buildPartialSnapshotRecheckMessage({
            restoreAvailable: nextRestoreAvailability.available,
            blockedReason: nextRestoreAvailability.blockedReason,
          }));
        } catch {
          setRestorePreview({
            status: CLOUD_RESTORE_STATUS.ERROR,
            eligible: false,
            error: "Unable to check restore eligibility.",
            noWritesPerformed: true,
          });
          setCloudStatusMessage(buildPartialSnapshotRecheckMessage({
            restoreAvailable: false,
            blockedReason: "Unable to check whether cloud backup can rebuild the missing local estimates.",
          }));
        }
      }
    } catch {
      setOnboardingStatus({
        status: CLOUD_ONBOARDING_STATUS.ERROR,
        preview: null,
        verification: null,
        writeResult: null,
        error: "Unable to recheck cloud backup status.",
        noWritesPerformed: true,
      });
      setCloudStatusMessage("");
    } finally {
      setOnboardingStatusBusy(false);
    }
  };

  const requestCloudBackupConfirmation = () => {
    if (!ensureUnlockedForWrite()) return;
    setCloudConfirmDialog({
      action: "backup",
      title: "Back up this device to cloud?",
      lines: [
        "This will copy this device's saved work to your cloud backup.",
        cloudDecision?.safeRepairsAvailable
          ? "We'll repair safe metadata before backing up. Totals, payments, and documents will not be changed."
          : null,
        "It will not delete local data on this device.",
      ].filter(Boolean),
      confirmLabel: "Back Up Now",
    });
  };

  const requestCloudRestoreConfirmation = () => {
    if (!ensureUnlockedForWrite()) return;
    setCloudConfirmDialog({
      action: "restore",
      ...buildCloudRestoreConfirmationDialog({ partialLocalSnapshot: partialLocalSnapshotState }),
    });
  };

  const requestReplaceCloudConfirmation = () => {
    if (!ensureUnlockedForWrite()) return;
    setReplaceConfirmChecked(false);
    setCloudConfirmDialog({
      action: "replace_cloud",
      title: "Replace cloud backup with this device?",
      lines: [
        "Cloud has records that are not on this device. Replacing the cloud backup will make cloud match this device.",
        "Download a backup first if you want a copy.",
        "This will not delete any local data or change invoice totals, payments, or status.",
      ],
      confirmLabel: "Replace Cloud Backup",
      requireCheckbox: true,
      checkboxLabel: "I understand cloud-only records not on this device will be removed from the cloud backup.",
    });
  };

  const confirmCloudAction = async () => {
    const action = String(cloudConfirmDialog?.action || "").trim();
    if (cloudConfirmDialog?.requireCheckbox && !replaceConfirmChecked) return;
    setCloudConfirmDialog(null);
    if (action === "backup") {
      await runCloudBackup();
      return;
    }
    if (action === "restore") {
      await runCloudRestore();
      return;
    }
    if (action === "replace_cloud") {
      await runReplaceCloudBackup();
    }
  };

  const runUpdateAppRestoreBundle = async () => {
    if (!ensureUnlockedForWrite()) return;
    try {
      setAppBundleBusy(true);
      const result = await updateSupabaseAppRestoreBundle({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role: accountRole,
      });
      setAppBundleResult(result);
      if (result?.status === APP_RESTORE_BUNDLE_STATUS.COMPLETED) {
        setAppBundleConfirmText("");
      }
    } catch {
      setAppBundleResult({
        status: APP_RESTORE_BUNDLE_STATUS.ERROR,
        bundleUpdated: false,
        noLocalDataChanged: true,
        captureSummary: {
          companyProfileCaptured: false,
          logoDataUrlCaptured: false,
          settingsCaptured: false,
          scopeTemplatesCaptured: false,
        },
        notices: [],
        error: "Unable to update the app restore bundle.",
      });
    } finally {
      setAppBundleBusy(false);
    }
  };

  const runUpdateEstimateRestorePayloads = async () => {
    if (!ensureUnlockedForWrite()) return;
    try {
      setEstimatePayloadBusy(true);
      const result = await updateEstimateRestorePayloads({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
      });
      setEstimatePayloadResult(result);
      if (result?.status === ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED) {
        setEstimatePayloadConfirmText("");
      }
    } catch {
      setEstimatePayloadResult({
        status: ESTIMATE_PAYLOAD_UPDATE_STATUS.ERROR,
        estimatesChecked: 0,
        estimatesUpdated: 0,
        missingCloudRows: [],
        skipped: [],
        failed: [],
        noLocalDataChanged: true,
        error: "Unable to update estimate restore payloads.",
      });
    } finally {
      setEstimatePayloadBusy(false);
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

  // Gate 13O-2J: import goes through the shared backup JSON contract:
  // detect the source (cloud / device / legacy raw), preview counts before
  // any write, require explicit confirmation (extra-explicit when the file
  // holds zero core records -- the empty-device export trap), then write and
  // refresh the app. Never reports success on a zero-record import.
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
          {/* Gate 13O-2K: the header h1 above is the page title -- do not
              repeat "Settings" here. */}
          <div style={{ display: "grid", gap: 6 }}>
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
              <div className="pe-field-label" style={{ marginBottom: 2 }}>Account</div>
              <div className="pe-field-helper" style={{ marginTop: -4 }}>
                Cloud backup uses your signed-in EstiPaid account. Customer, project, estimate, and invoice storage still remains local in this lane.
              </div>
              {!isSupabaseReady ? (
                <>
                  <div className="pe-field-helper">
                    Supabase not configured. Set {missingEnvKeys.join(" and ")} to enable account sign-in.
                  </div>
                  <div className="pe-field-helper">
                    Download This Device Backup JSON in Developer Tools before any future migration or cloud-write step.
                  </div>
                </>
              ) : authLoading ? (
                <div className="pe-field-helper">Checking cloud account session...</div>
              ) : userEmail ? (
                <>
                  <div className="pe-field-helper">
                    Signed in as: <strong>{userEmail}</strong>
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
                        This creates your cloud workspace only. Backup and restore become available after setup.
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
                    Cloud account connected.
                  </div>
                  <div className="pe-field-helper">
                    Backup and restore are available for this workspace.
                  </div>
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
                </>
              ) : (
                <div className="pe-field-helper">Sign in from the welcome screen to use cloud backup.</div>
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
                <div className="pe-field-label" style={{ marginBottom: 0 }}>Cloud Backup</div>
                {isSupabaseReady && userEmail && hasCompany && autoBackupDisplayState !== "none" ? (
                  <div style={{ display: "grid", gap: 2 }}>
                    {autoBackupDisplayState === "running" ? (
                      <div role="status" aria-live="polite" className="pe-field-helper">
                        Backing up changes...
                      </div>
                    ) : autoBackupDisplayState === "needs_attention" ? (
                      <>
                        <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)" }}>
                          Sync needs attention
                        </div>
                        <div className="pe-field-helper">Your changes are safe. EstiPaid is retrying cloud sync.</div>
                        <div>
                          <button
                            type="button"
                            className="pe-btn pe-btn-ghost"
                            onClick={runCloudBackup}
                            disabled={onboardingBackupBusy || autoBackupRunning}
                          >
                            {onboardingBackupBusy ? "Retrying..." : "Retry Sync"}
                          </button>
                        </div>
                      </>
                    ) : autoBackupDisplayState === "remote_changed" || autoBackupDisplayState === "conflict" ? (
                      <>
                        <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)" }}>
                          {autoBackupDisplayState === "conflict" ? "Cloud sync conflict" : "Cloud changed elsewhere"}
                        </div>
                        <div className="pe-field-helper">Review this device and cloud backup before choosing a recovery action.</div>
                      </>
                    ) : autoBackupDisplayState === "pending" ? (
                      <>
                        <div className="pe-field-helper">Cloud sync</div>
                        <div className="pe-field-helper">
                          {autoBackupQueueState.status === CLOUD_BACKUP_STATUS.OFFLINE_PENDING
                            ? "Your changes are saved on this device. Sync will continue when you’re back online."
                            : autoBackupQueueState.status === CLOUD_BACKUP_STATUS.RETRY_WAIT
                              ? "Your changes are safe. EstiPaid is retrying cloud sync."
                              : "Your changes are saved on this device and will sync automatically."}
                        </div>
                      </>
                    ) : (
                      <>
                        <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                          Cloud backup is up to date.
                        </div>
                        {autoBackupQueueState.lastSuccessfulBackupAt ? (
                          <div className="pe-field-helper" style={{ opacity: 0.75 }}>
                            Last backed up {new Date(autoBackupQueueState.lastSuccessfulBackupAt).toLocaleString()}
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>
                ) : null}
                {!isSupabaseReady || !userEmail ? (
                  <div className="pe-field-helper">Sign in from the welcome screen to use cloud backup.</div>
                ) : !hasCompany ? (
                  <div className="pe-field-helper">Create a cloud workspace before backing up your data.</div>
                ) : onboardingBackupBusy ? (
                  <div className="pe-field-helper">Backing up your data...</div>
                ) : onboardingStatusBusy && !onboardingStatus ? (
                  <div className="pe-field-helper">
                    {localIntegrity?.backupReadiness?.canProceedAfterSafeRepair
                      ? "Finishing backup protection."
                      : "Checking cloud backup status..."}
                  </div>
                ) : onboardingStatus?.status === CLOUD_ONBOARDING_STATUS.NO_LOCAL_DATA ? (
                  <>
                    <div className="pe-field-helper">This device has no saved work yet.</div>
                    <div className="pe-field-helper">Create your first project to start cloud backup.</div>
                  </>
                ) : partialLocalSnapshotState ? (
                  <>
                    <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)", fontWeight: 700 }}>
                      This device has a partial local snapshot.
                    </div>
                    <div className="pe-field-helper">
                      This device has invoices but missing estimates. Backing up this device is blocked so the cloud backup is not overwritten with incomplete local data.
                    </div>
                    {cloudBackupDetail ? (
                      <div className="pe-field-helper" style={{ opacity: 0.82 }}>
                        {cloudBackupDetail}
                      </div>
                    ) : null}
                    {restorePreviewBusy && !restorePreview ? (
                      <div className="pe-field-helper">Checking restore availability...</div>
                    ) : null}
                    {!restorePreviewBusy && restorePreview && !restoreActionAvailable ? (
                      <div className="pe-field-helper" style={{ opacity: 0.82 }}>
                        {restoreAvailability.blockedReason}
                      </div>
                    ) : null}
                    {cloudStatusMessage ? (
                      <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)" }}>
                        {cloudStatusMessage}
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="pe-btn"
                        onClick={requestCloudRestoreConfirmation}
                        disabled={restoreBusy || restorePreviewBusy || !restoreActionAvailable}
                      >
                        {restoreBusy ? "Restoring..." : "Restore Cloud to This Device"}
                      </button>
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={downloadCloudBackupJson}
                        disabled={cloudExportBusy}
                      >
                        {cloudExportBusy ? "Preparing Cloud Backup..." : "Download Cloud Backup JSON"}
                      </button>
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={downloadBackupJson}
                      >
                        Download This Device Backup JSON
                      </button>
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={runCloudStatusRecheck}
                        disabled={onboardingStatusBusy}
                      >
                        {onboardingStatusBusy ? "Rechecking..." : "Recheck Cloud Status"}
                      </button>
                    </div>
                  </>
                ) : cloudDecision.screenState === LOCAL_DATA_DECISION.NEEDS_REPAIR_BEFORE_BACKUP
                  || cloudDecision.screenState === LOCAL_DATA_DECISION.BACKUP_FAILED
                  || cloudDecision.screenState === LOCAL_DATA_DECISION.CLOUD_UNRESTORABLE ? (
                  <>
                    <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)" }}>
                      {automaticSafeRepairRunning ? "Finishing backup protection." : "Cloud backup needs attention."}
                    </div>
                    {cloudDecision.screenState === LOCAL_DATA_DECISION.CLOUD_UNRESTORABLE ? (
                      <div className="pe-field-helper">Cloud data is not fully restorable yet.</div>
                    ) : automaticSafeRepairRunning ? (
                      <div className="pe-field-helper">
                        We found a small backup cleanup this device can fix safely. Finishing that now.
                      </div>
                    ) : automaticSafeRepairFailed ? (
                      <div className="pe-field-helper">
                        We could not finish protecting this device automatically.
                      </div>
                    ) : (
                      <div className="pe-field-helper">
                        {showDeveloperCloudTools
                          ? "Review the concrete blocker below before backing up or restoring."
                          : "Review this device and cloud backup before trying again."}
                      </div>
                    )}
                    {cloudBackupDetail ? (
                      <div className="pe-field-helper" style={{ opacity: 0.82 }}>
                        {cloudBackupDetail}
                      </div>
                    ) : null}
                    {showDeveloperCloudTools && cloudDecision.safeRepairsAvailable && !automaticSafeRepairRunning && !automaticSafeRepairFailed ? (
                      <div className="pe-field-helper">
                        We&apos;ll repair safe metadata before backing up. Totals, payments, and documents will not be changed.
                      </div>
                    ) : null}
                    {showDeveloperCloudTools && repairResult?.changed ? (
                      <div className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                        Safe metadata repair completed.
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {showDeveloperCloudTools && cloudDecision.safeRepairsAvailable && !automaticSafeRepairRunning && !automaticSafeRepairFailed ? (
                        <button
                          type="button"
                          className="pe-btn pe-btn-ghost"
                          onClick={runSafeMetadataRepair}
                          disabled={repairBusy}
                        >
                          {repairBusy ? "Repairing..." : "Repair Safe Metadata"}
                        </button>
                      ) : null}
                      {automaticSafeRepairFailed ? (
                        <button
                          type="button"
                          className="pe-btn"
                          onClick={runCloudStatusRecheck}
                          disabled={onboardingStatusBusy}
                        >
                          {onboardingStatusBusy ? "Checking..." : "Try Again"}
                        </button>
                      ) : null}
                      {!automaticSafeRepairRunning && !automaticSafeRepairFailed && (cloudDecision.safeRepairsAvailable || onboardingStatus?.status === CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP) && !cloudDecision.firstBlocker ? (
                        <button
                          type="button"
                          className="pe-btn"
                          onClick={requestCloudBackupConfirmation}
                          disabled={onboardingBackupBusy}
                        >
                          Back Up This Device
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={runCloudStatusRecheck}
                        disabled={onboardingStatusBusy}
                      >
                        {onboardingStatusBusy ? "Rechecking..." : "Recheck Cloud Status"}
                      </button>
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={downloadCloudBackupJson}
                        disabled={cloudExportBusy}
                      >
                        {cloudExportBusy ? "Preparing Cloud Backup..." : "Download Cloud Backup JSON"}
                      </button>
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={downloadBackupJson}
                      >
                        Download This Device Backup JSON
                      </button>
                    </div>
                  </>
                ) : onboardingStatus?.status === CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE ? (
                  <>
                    <div className="pe-field-helper">Cloud data found.</div>
                    <div className="pe-field-helper">This device has no saved work yet.</div>
                    {restoreResult?.status === CLOUD_RESTORE_STATUS.RESTORED ? (
                      <>
                        <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                          Cloud data restored to this device.
                        </div>
                        <div className="pe-field-helper">No cloud data was deleted.</div>
                        <div className="pe-field-helper">No existing local data was overwritten.</div>
                        {restoreResult?.partial ? (
                          <div className="pe-field-helper">Estimates were not restored yet — only customers, projects, and invoices.</div>
                        ) : null}
                        {restoreResult?.appBundleRestored ? (
                          <div className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                            Company profile, logo, settings, and scope templates restored.
                          </div>
                        ) : null}
                      </>
                    ) : restoreBusy ? (
                      <div className="pe-field-helper">Restoring cloud data to this device...</div>
                    ) : restoreResult && restoreResult.status !== CLOUD_RESTORE_STATUS.RESTORED ? (
                      <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)" }}>
                        {restoreResult.deviceLockLost
                          ? CLOUD_RESTORE_STOPPED_MESSAGE
                          : restoreResult.status === CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY
                          ? "This device already has local data. Restore is blocked to prevent overwriting."
                          : "Restore could not be completed on this device."}
                      </div>
                    ) : restorePreviewBusy && !restorePreview ? (
                      <div className="pe-field-helper">Checking restore eligibility...</div>
                    ) : restorePreview?.status === CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY ? (
                      <div className="pe-field-helper">This device already has local data. Restore is blocked to prevent overwriting.</div>
                    ) : (
                      <>
                        {restorePreview?.partial ? (
                          <div className="pe-field-helper">Estimates can&apos;t be restored yet; customers, projects, and invoices will be.</div>
                        ) : null}
                        <div className="pe-field-helper">Restore is available for this device.</div>
                        <div>
                          <button
                            type="button"
                            className="pe-btn"
                            onClick={requestCloudRestoreConfirmation}
                            disabled={restoreBusy}
                          >
                            Restore Cloud Data to This Device
                          </button>
                        </div>
                      </>
                    )}
                  </>
                ) : cloudDecision.screenState === LOCAL_DATA_DECISION.LOCAL_CLOUD_MISMATCH ? (
                  <>
                    <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)" }}>
                      {autoBackupQueueState.status === CLOUD_BACKUP_STATUS.CONFLICT ? "Cloud sync conflict." : "Cloud changed elsewhere."}
                    </div>
                    <div className="pe-field-helper">
                      {autoBackupQueueState.status === CLOUD_BACKUP_STATUS.REMOTE_CHANGED || autoBackupQueueState.status === CLOUD_BACKUP_STATUS.CONFLICT
                        ? "Cloud contains records that require review. EstiPaid will not overwrite or delete them automatically."
                        : "Cloud has records or verification details that do not match this device. Choose whether to restore cloud data here or replace the cloud backup with this device."}
                    </div>
                    {repairResult?.changed ? (
                      <div className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                        Safe metadata repair completed.
                      </div>
                    ) : null}
                    {cloudBackupDetail ? (
                      <div className="pe-field-helper" style={{ opacity: 0.82 }}>
                        {cloudBackupDetail}
                      </div>
                    ) : null}
                    {mismatchTableDetails.length > 0 ? (
                      <div style={{ display: "grid", gap: 4 }}>
                        {mismatchTableDetails.map((line) => (
                          <div key={line} className="pe-field-helper" style={{ opacity: 0.82 }}>
                            {line}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {automaticSyncState && !automaticSyncState.ok ? (
                      <div
                        data-testid="automatic-sync-state"
                        className="pe-field-helper"
                        style={{ opacity: 0.82 }}
                      >
                        {`Automatic sync — status: ${automaticSyncState.status || "unknown"}`}
                        {automaticSyncState.code ? `, code: ${automaticSyncState.code}` : ""}
                        {automaticSyncState.stage ? `, stage: ${automaticSyncState.stage}` : ""}
                        {automaticSyncState.bootstrapCode ? `, bootstrap: ${automaticSyncState.bootstrapCode}` : ""}
                        {automaticSyncState.bootstrapDetailCode && automaticSyncState.bootstrapDetailCode !== automaticSyncState.bootstrapCode ? `, detail: ${automaticSyncState.bootstrapDetailCode}` : ""}
                        {automaticSyncState.metadataRecoveryStage ? `, metadata: ${automaticSyncState.metadataRecoveryStage}` : ""}
                        {automaticSyncState.pauseReason ? `, pause: ${automaticSyncState.pauseReason}` : ""}
                        {`, retryable: ${automaticSyncState.retryable ? "yes" : "no"}`}
                        {automaticSyncState.conflictSummary.length ? `, conflicts: ${automaticSyncState.conflictSummary.map((entry) => `${entry.family}/${entry.code} (${entry.count})`).join(", ")}` : ""}
                      </div>
                    ) : null}
                    {restoreResult ? (
                      <div
                        role="status"
                        aria-live="polite"
                        className="pe-field-helper"
                        style={{ color: restoreResult.status === CLOUD_RESTORE_STATUS.RESTORED ? "rgba(187,247,208,0.95)" : "rgba(253,224,71,0.95)" }}
                      >
                        {restoreResult.status === CLOUD_RESTORE_STATUS.RESTORED
                          ? "Cloud data restored to this device."
                          : restoreResult.deviceLockLost
                            ? CLOUD_RESTORE_STOPPED_MESSAGE
                            : restoreResult.status === CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY
                            ? "This device already has local data. Restore is blocked to prevent overwriting."
                            : "Restore could not be completed on this device."}
                      </div>
                    ) : null}
                    <details>
                      <summary className="pe-field-helper" style={{ cursor: "pointer" }}>Advanced recovery</summary>
                      <div className="pe-field-helper" style={{ marginTop: 8 }}>
                        Restore is blocked here because this device already has local data. Use Replace only if you want cloud to match this device instead.
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={requestCloudRestoreConfirmation}
                        disabled={true}
                      >
                        Restore Cloud to This Device
                      </button>
                      {cloudDecision.replaceCloudAvailable ? (
                        <button
                          type="button"
                          className="pe-btn pe-btn-ghost"
                          onClick={requestReplaceCloudConfirmation}
                          disabled={replaceCloudBusy}
                        >
                          {replaceCloudBusy ? "Replacing..." : "Replace Cloud Backup With This Device"}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={runCloudStatusRecheck}
                        disabled={onboardingStatusBusy}
                      >
                        {onboardingStatusBusy ? "Rechecking..." : "Recheck Cloud Status"}
                      </button>
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={downloadCloudBackupJson}
                        disabled={cloudExportBusy}
                      >
                        {cloudExportBusy ? "Preparing Cloud Backup..." : "Download Cloud Backup JSON"}
                      </button>
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={downloadBackupJson}
                      >
                        Download This Device Backup JSON
                      </button>
                      </div>
                    </details>
                  </>
                ) : cloudDecision.screenState === LOCAL_DATA_DECISION.CLOUD_VERIFIED_CURRENT ? (
                  <>
                    <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                      Cloud backup is up to date.
                    </div>
                    <div className="pe-field-helper">Cloud data matches this device.</div>
                    {onboardingStatus?.status === CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED ? (
                      <div className="pe-field-helper">No local data was deleted.</div>
                    ) : null}
                    {autoBackupQueueState.lastSuccessfulBackupAt ? (
                      <div className="pe-field-helper" style={{ opacity: 0.75 }}>
                        Last backed up {new Date(autoBackupQueueState.lastSuccessfulBackupAt).toLocaleString()}
                      </div>
                    ) : null}
                  </>
                ) : cloudDecision.screenState === LOCAL_DATA_DECISION.SAFE_TO_BACKUP ? (
                  <>
                    <div className="pe-field-helper">
                      This device has work that is not backed up yet.
                    </div>
                    <div>
                      <button
                        type="button"
                        className="pe-btn"
                        onClick={requestCloudBackupConfirmation}
                        disabled={onboardingBackupBusy}
                      >
                        Back Up This Device
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="pe-field-helper">
                    Your estimates, invoices, customers, and projects can be backed up to your cloud account.
                  </div>
                )}
                {localIntegrity?.summary ? (
                  <div
                    style={{
                      display: "grid",
                      gap: 4,
                      padding: 10,
                      borderRadius: 12,
                      border: "1px solid rgba(148,163,184,0.18)",
                      background: "rgba(15,23,42,0.34)",
                    }}
                  >
                    <div className="pe-field-label" style={{ marginBottom: 0 }}>Data check</div>
                    <div className="pe-field-helper">
                      Customers <strong>{Number(localIntegrity.summary.customers || 0)}</strong>, projects <strong>{Number(localIntegrity.summary.projects || 0)}</strong>, estimates <strong>{Number(localIntegrity.summary.estimates || 0)}</strong>, invoices <strong>{Number(localIntegrity.summary.invoices || 0)}</strong>.
                    </div>
                    <div className="pe-field-helper">
                      Blockers <strong>{Number(localIntegrity.summary.blockersCount || 0)}</strong>, warnings <strong>{Number(localIntegrity.summary.warningsCount || 0)}</strong>, repairs available <strong>{Number(localIntegrity.summary.repairsAvailableCount || 0)}</strong>.
                    </div>
                    <div className="pe-field-helper">
                      Invoice payments <strong>{Number(localIntegrity.summary.invoicePayments || 0)}</strong>, scope templates <strong>{Number(localIntegrity.summary.scopeTemplates || 0)}</strong>, audit events <strong>{Number(localIntegrity.summary.auditEvents || 0)}</strong>.
                    </div>
                  </div>
                ) : null}
              </div>

              {showDeveloperCloudTools ? (
                <>
              <div
                style={{
                  display: "grid",
                  gap: 8,
                  paddingTop: 8,
                  borderTop: "1px solid rgba(148,163,184,0.18)",
                }}
              >
                <div className="pe-field-label" style={{ marginBottom: 0 }}>Developer Migration Tools</div>
                <div className="pe-field-helper">
                  Advanced tools for diagnosing cloud migration issues. Normal backups use the Cloud Backup section above.
                </div>
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

              <div
                style={{
                  display: "grid",
                  gap: 8,
                  paddingTop: 8,
                  borderTop: "1px solid rgba(148,163,184,0.18)",
                }}
              >
                <div className="pe-field-label" style={{ marginBottom: 0 }}>Cloud Verification</div>
                <div className="pe-field-helper">
                  Read-only check that reads migrated Supabase rows back and compares them against local data by count and legacy id. This performs no writes.
                </div>
                <div>
                  <button
                    type="button"
                    className="pe-btn pe-btn-ghost"
                    onClick={runCloudVerification}
                    disabled={cloudVerifyBusy}
                  >
                    {cloudVerifyBusy ? "Verifying..." : "Verify Cloud Data"}
                  </button>
                </div>
                {cloudVerification ? (
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
                      Current workspace: <strong>{String(cloudVerification?.company?.name || "Unavailable")}</strong>
                    </div>
                    {Array.isArray(cloudVerification?.tableResults) && cloudVerification.tableResults.length > 0 ? (
                      <div style={{ display: "grid", gap: 4 }}>
                        {cloudVerification.tableResults.map((tableResult) => (
                          <div key={String(tableResult?.table)} className="pe-field-helper">
                            {String(tableResult?.table)}: local <strong>{Number(tableResult?.localCount ?? 0)}</strong>, cloud{" "}
                            <strong>{tableResult?.cloudCount === null ? "unavailable" : Number(tableResult?.cloudCount ?? 0)}</strong>
                            {" — "}
                            <span
                              style={{
                                color: tableResult?.status === "matched"
                                  ? "rgba(187,247,208,0.95)"
                                  : tableResult?.status === "unavailable"
                                    ? "rgba(253,224,71,0.95)"
                                    : "rgba(248,113,113,0.95)",
                              }}
                            >
                              {String(tableResult?.status || "unknown")}
                            </span>
                            {Array.isArray(tableResult?.missingLegacyIds) && tableResult.missingLegacyIds.length > 0
                              ? `, missing cloud ids: ${tableResult.missingLegacyIds.join(", ")}`
                              : ""}
                            {Array.isArray(tableResult?.extraLegacyIds) && tableResult.extraLegacyIds.length > 0
                              ? `, extra cloud ids: ${tableResult.extraLegacyIds.join(", ")}`
                              : ""}
                            {tableResult?.error ? `, error: ${tableResult.error}` : ""}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {Array.isArray(cloudVerification?.notices) && cloudVerification.notices.some((notice) => (
                      notice?.code !== "cloud_verification_passed" && notice?.code !== "cloud_verification_mismatch"
                    )) ? (
                      <div style={{ display: "grid", gap: 4 }}>
                        {cloudVerification.notices
                          .filter((notice) => notice?.code !== "cloud_verification_passed" && notice?.code !== "cloud_verification_mismatch")
                          .map((notice) => (
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
                    <div
                      role="status"
                      aria-live="polite"
                      className="pe-field-helper"
                      style={{
                        color: cloudVerification?.allMatched
                          ? "rgba(187,247,208,0.95)"
                          : "rgba(253,224,71,0.95)",
                      }}
                    >
                      {cloudVerification?.allMatched
                        ? "Cloud verification passed. Supabase data matches local migration data."
                        : "Cloud verification found mismatches. Review the table results above."}
                    </div>
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
                  <div className="pe-field-label" style={{ marginBottom: 0 }}>Update App Restore Bundle</div>
                  <div className="pe-field-helper">
                    Stores this device&apos;s company profile, logo, settings, and scope templates in Supabase for restore on another device.
                  </div>
                  <label className="pe-field-helper" htmlFor="app-bundle-confirm-input" style={{ marginTop: 2 }}>
                    Type BUNDLE to confirm
                  </label>
                  <input
                    id="app-bundle-confirm-input"
                    type="text"
                    className="pe-input"
                    value={appBundleConfirmText}
                    onChange={(e) => setAppBundleConfirmText(e.target.value)}
                    placeholder="BUNDLE"
                    disabled={appBundleBusy}
                    style={{ maxWidth: 220 }}
                  />
                  <div>
                    <button
                      type="button"
                      className="pe-btn pe-btn-ghost"
                      onClick={runUpdateAppRestoreBundle}
                      disabled={appBundleBusy || appBundleConfirmText !== "BUNDLE"}
                    >
                      {appBundleBusy ? "Updating..." : "Update App Restore Bundle"}
                    </button>
                  </div>
                  {appBundleResult ? (
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
                      {appBundleResult.status === APP_RESTORE_BUNDLE_STATUS.ERROR
                        || appBundleResult.status === APP_RESTORE_BUNDLE_STATUS.SIGNED_OUT
                        || appBundleResult.status === APP_RESTORE_BUNDLE_STATUS.NO_WORKSPACE
                        || appBundleResult.status === APP_RESTORE_BUNDLE_STATUS.ROLE_NOT_ALLOWED ? (
                          <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(248,113,113,0.95)" }}>
                            {String(appBundleResult.error || "Unable to update the app restore bundle.")}
                          </div>
                        ) : (
                          <>
                            <div className="pe-field-helper">
                              Company profile captured: <strong>{appBundleResult?.captureSummary?.companyProfileCaptured ? "Yes" : "No"}</strong>
                            </div>
                            <div className="pe-field-helper">
                              logoDataUrl captured: <strong>{appBundleResult?.captureSummary?.logoDataUrlCaptured ? "Yes" : "No"}</strong>
                            </div>
                            <div className="pe-field-helper">
                              Settings captured: <strong>{appBundleResult?.captureSummary?.settingsCaptured ? "Yes" : "No"}</strong>
                            </div>
                            <div className="pe-field-helper">
                              Scope templates captured: <strong>{appBundleResult?.captureSummary?.scopeTemplatesCaptured ? "Yes" : "No"}</strong>
                            </div>
                            <div className="pe-field-helper">
                              Bundle updated: <strong>{appBundleResult?.bundleUpdated ? "Yes" : "No"}</strong>
                            </div>
                            <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                              No local data changed.
                            </div>
                          </>
                        )}
                      {Array.isArray(appBundleResult?.notices) && appBundleResult.notices.length > 0 ? (
                        <div style={{ display: "grid", gap: 4 }}>
                          {appBundleResult.notices.map((notice) => (
                            <div
                              key={String(notice?.code || notice?.message)}
                              className="pe-field-helper"
                              style={{
                                color: notice?.level === "warning"
                                  ? "rgba(253,224,71,0.95)"
                                  : notice?.level === "error"
                                    ? "rgba(248,113,113,0.95)"
                                    : "rgba(191,219,254,0.95)",
                              }}
                            >
                              {String(notice?.message || "")}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>

                <div
                  style={{
                    display: "grid",
                    gap: 8,
                    paddingTop: 8,
                    borderTop: "1px solid rgba(148,163,184,0.18)",
                  }}
                >
                  <div className="pe-field-label" style={{ marginBottom: 0 }}>Update Estimate Restore Payloads</div>
                  <div className="pe-field-helper">
                    Stores the editable estimate state in Supabase so estimates can be restored on another device.
                  </div>
                  <label className="pe-field-helper" htmlFor="estimate-payload-confirm-input" style={{ marginTop: 2 }}>
                    Type PAYLOAD to confirm
                  </label>
                  <input
                    id="estimate-payload-confirm-input"
                    type="text"
                    className="pe-input"
                    value={estimatePayloadConfirmText}
                    onChange={(e) => setEstimatePayloadConfirmText(e.target.value)}
                    placeholder="PAYLOAD"
                    disabled={estimatePayloadBusy}
                    style={{ maxWidth: 220 }}
                  />
                  <div>
                    <button
                      type="button"
                      className="pe-btn pe-btn-ghost"
                      onClick={runUpdateEstimateRestorePayloads}
                      disabled={estimatePayloadBusy || estimatePayloadConfirmText !== "PAYLOAD"}
                    >
                      {estimatePayloadBusy ? "Updating..." : "Update Estimate Restore Payloads"}
                    </button>
                  </div>
                  {estimatePayloadResult ? (
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
                      {estimatePayloadResult.status === ESTIMATE_PAYLOAD_UPDATE_STATUS.ERROR ? (
                        <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(248,113,113,0.95)" }}>
                          {String(estimatePayloadResult.error || "Unable to update estimate restore payloads.")}
                        </div>
                      ) : (
                        <>
                          <div className="pe-field-helper">
                            Estimates checked: <strong>{Number(estimatePayloadResult.estimatesChecked || 0)}</strong>, payloads updated:{" "}
                            <strong>{Number(estimatePayloadResult.estimatesUpdated || 0)}</strong>
                          </div>
                          {Array.isArray(estimatePayloadResult.missingCloudRows) && estimatePayloadResult.missingCloudRows.length > 0 ? (
                            <div className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)" }}>
                              Missing cloud rows: {estimatePayloadResult.missingCloudRows.map((row) => row.legacyLocalId).join(", ")}
                            </div>
                          ) : null}
                          {Array.isArray(estimatePayloadResult.failed) && estimatePayloadResult.failed.length > 0 ? (
                            <div className="pe-field-helper" style={{ color: "rgba(248,113,113,0.95)" }}>
                              Failed: {estimatePayloadResult.failed.map((row) => row.legacyLocalId).join(", ")}
                            </div>
                          ) : null}
                          {Array.isArray(estimatePayloadResult.skipped) && estimatePayloadResult.skipped.length > 0 ? (
                            <div className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)" }}>
                              Skipped: {estimatePayloadResult.skipped.length}
                            </div>
                          ) : null}
                          <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                            No local data changed.
                          </div>
                        </>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
                </>
              ) : null}
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
                Diagnostics exports create a redacted support bundle. Cloud Backup JSON downloads this workspace&apos;s records from Supabase. This Device Backup JSON exports only data currently stored on this device — it does not download your cloud backup, and it will be empty if this device is empty. Import Backup JSON accepts cloud, device, and raw app data backup files and previews record counts before writing.
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
      <CloudConfirmDialog
        dialog={cloudConfirmDialog}
        checkboxChecked={replaceConfirmChecked}
        onCheckboxChange={setReplaceConfirmChecked}
        onCancel={() => setCloudConfirmDialog(null)}
        onConfirm={confirmCloudAction}
      />
    </section>
  );
}
