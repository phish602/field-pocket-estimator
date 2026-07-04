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
import { runSupabaseCloudVerification } from "../lib/supabaseCloudVerification";
import {
  previewSupabaseCloudRestore,
  executeSupabaseCloudRestore,
  CLOUD_RESTORE_STATUS,
} from "../lib/supabaseCloudRestore";
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
import { markCloudBackupDirty, readCloudBackupQueueState, CLOUD_BACKUP_STATUS } from "../lib/cloudBackupQueue";
import { acquireCloudBackupRunLock, releaseCloudBackupRunLock } from "../lib/cloudBackupRunLock";
import { CLOUD_AUTO_BACKUP_RUNNING_EVENT } from "../lib/useCloudAutoBackup";
import {
  getCloudDataDecision,
  LOCAL_DATA_DECISION,
  repairStoredLocalDataIntegrity,
} from "../lib/localDataIntegrity";

const ESTIPAID_PREFIX = "estipaid-";
const DEV_CLOUD_TOOLS_FLAG = "estipaid-dev-cloud-tools-v1";

function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
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

  const requestCloudSignOut = async () => {
    setAuthAction("signout");
    try {
      await signOut();
    } finally {
      setAuthAction("");
    }
  };

  const authPending = authBusy || Boolean(authAction);

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

  // Read-only: checks whether the cloud already matches local data so the
  // contractor-facing Cloud Backup section can show a simple state without
  // requiring any click. This never writes.
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
  }, [isSupabaseReady, user, company, accountRole]);

  const runCloudBackup = async () => {
    // Shared with the Gate 13B automatic background worker so a manual click
    // and an automatic run never execute a cloud backup at the same time.
    if (!acquireCloudBackupRunLock()) return;
    try {
      setOnboardingBackupBusy(true);
      const result = await runSupabaseCloudOnboardingBackup({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role: accountRole,
      });
      setOnboardingStatus(result);
    } catch {
      setOnboardingStatus({
        status: CLOUD_ONBOARDING_STATUS.ERROR,
        preview: null,
        verification: null,
        writeResult: null,
        error: "Unable to complete cloud backup.",
        noLocalDeletes: true,
      });
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
    if (!acquireCloudBackupRunLock()) return;
    try {
      setReplaceCloudBusy(true);
      const result = await runSupabaseCloudOnboardingBackup({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role: accountRole,
        allowCloudOnlyReplacement: true,
      });
      setOnboardingStatus(result);
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
  const autoBackupDisplayState = autoBackupRunning
    ? "running"
    : autoBackupQueueState.status === CLOUD_BACKUP_STATUS.FAILED
      ? "failed"
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
  const localIntegrity = onboardingStatus?.preview?.integrity || migrationPreview?.integrity || null;
  const cloudDecision = getCloudDataDecision({
    localIntegrity,
    cloudVerification: onboardingStatus?.verification || cloudVerification,
    queueState: autoBackupQueueState,
    onboardingStatus,
    restorePreview,
    workerRunning: autoBackupRunning,
    restoredRecently: restoreResult?.status === CLOUD_RESTORE_STATUS.RESTORED,
  });
  const cloudBackupDetail = String(
    cloudDecision?.firstBlocker?.message
      || cloudDecision?.firstSafeRepair?.message
      || backupAttentionDetail
      || ""
  ).trim();
  const mismatchTableDetails = describeVerificationMismatchTables(onboardingStatus?.verification || cloudVerification);

  // Read-only: once onboarding detects a fresh device with cloud data
  // available, check exactly what (if anything) is safely restorable. Never
  // writes. Only runs when this device is confirmed empty.
  useEffect(() => {
    let active = true;

    if (onboardingStatus?.status !== CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE) {
      setRestorePreview(null);
      return undefined;
    }

    setRestorePreviewBusy(true);
    previewSupabaseCloudRestore({
      storageSnapshot: localStorage,
      configured: isSupabaseReady,
      user,
      company,
    })
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
  }, [onboardingStatus?.status, isSupabaseReady, user, company]);

  const runCloudRestore = async () => {
    try {
      setRestoreBusy(true);
      const result = await executeSupabaseCloudRestore({
        storage: localStorage,
        configured: isSupabaseReady,
        user,
        company,
      });
      setRestoreResult(result);
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

  const requestCloudBackupConfirmation = () => {
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
    setCloudConfirmDialog({
      action: "restore",
      title: "Restore cloud data to this device?",
      lines: [
        "This will copy your cloud backup onto this device.",
        "It will not delete your cloud backup.",
      ],
      confirmLabel: "Restore Data",
    });
  };

  const requestReplaceCloudConfirmation = () => {
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
      const importedDomains = new Set();
      const IMPORT_KEY_DOMAINS = {
        [STORAGE_KEYS.CUSTOMERS]: "customers",
        [STORAGE_KEYS.PROJECTS]: "projects",
        [STORAGE_KEYS.ESTIMATES]: "estimates",
        [STORAGE_KEYS.INVOICES]: "invoices",
        [STORAGE_KEYS.SCOPE_TEMPLATES]: "templates",
        [STORAGE_KEYS.COMPANY_PROFILE]: "company_profile",
      };

      Object.keys(keysObj).forEach((key) => {
        if (!key.startsWith(ESTIPAID_PREFIX)) return;
        if (key === STORAGE_KEYS.SETTINGS) return;
        const raw = toStorageString(keysObj[key]);
        if (!raw) return;
        try {
          localStorage.setItem(key, raw);
          writeCount += 1;
          if (IMPORT_KEY_DOMAINS[key]) importedDomains.add(IMPORT_KEY_DOMAINS[key]);
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
      if (importedDomains.size > 0) {
        markCloudBackupDirty({
          reason: "bulk_json_import",
          domains: [...importedDomains],
          severity: "money_critical",
          source: "importJsonFile",
        });
      }
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
                    Download Backup JSON in Developer Tools before any future migration or cloud-write step.
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
                    ) : autoBackupDisplayState === "failed" ? (
                      <>
                        <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)" }}>
                          Cloud backup needs attention
                        </div>
                        <div className="pe-field-helper">Your work is saved on this device. Cloud backup will retry.</div>
                      </>
                    ) : autoBackupDisplayState === "pending" ? (
                      <>
                        <div className="pe-field-helper">Cloud backup pending</div>
                        <div className="pe-field-helper">Your latest changes are saved on this device and will back up automatically.</div>
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
                  <div className="pe-field-helper">Checking cloud backup status...</div>
                ) : onboardingStatus?.status === CLOUD_ONBOARDING_STATUS.NO_LOCAL_DATA ? (
                  <>
                    <div className="pe-field-helper">This device has no saved work yet.</div>
                    <div className="pe-field-helper">Create your first project to start cloud backup.</div>
                  </>
                ) : cloudDecision.screenState === LOCAL_DATA_DECISION.PARTIAL_LOCAL_DATA
                  || cloudDecision.screenState === LOCAL_DATA_DECISION.NEEDS_REPAIR_BEFORE_BACKUP
                  || cloudDecision.screenState === LOCAL_DATA_DECISION.BACKUP_FAILED
                  || cloudDecision.screenState === LOCAL_DATA_DECISION.CLOUD_UNRESTORABLE ? (
                  <>
                    <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(253,224,71,0.95)" }}>
                      Cloud backup needs attention.
                    </div>
                    {cloudDecision.screenState === LOCAL_DATA_DECISION.CLOUD_UNRESTORABLE ? (
                      <div className="pe-field-helper">Cloud data is not fully restorable yet.</div>
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
                    {cloudDecision.safeRepairsAvailable ? (
                      <div className="pe-field-helper">
                        We&apos;ll repair safe metadata before backing up. Totals, payments, and documents will not be changed.
                      </div>
                    ) : null}
                    {repairResult?.changed ? (
                      <div className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
                        Safe metadata repair completed.
                      </div>
                    ) : null}
                    {cloudDecision.safeRepairsAvailable ? (
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="pe-btn pe-btn-ghost"
                          onClick={runSafeMetadataRepair}
                          disabled={repairBusy}
                        >
                          {repairBusy ? "Repairing..." : "Repair Safe Metadata"}
                        </button>
                        {!cloudDecision.firstBlocker ? (
                          <button
                            type="button"
                            className="pe-btn"
                            onClick={requestCloudBackupConfirmation}
                            disabled={onboardingBackupBusy}
                          >
                            Back Up This Device
                          </button>
                        ) : null}
                      </div>
                    ) : null}
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
                        {restoreResult.status === CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY
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
                      Cloud and this device are different.
                    </div>
                    <div className="pe-field-helper">
                      Cloud has records or verification details that do not match this device. Choose whether to restore cloud data here or replace the cloud backup with this device.
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
                    {restoreResult ? (
                      <div
                        role="status"
                        aria-live="polite"
                        className="pe-field-helper"
                        style={{ color: restoreResult.status === CLOUD_RESTORE_STATUS.RESTORED ? "rgba(187,247,208,0.95)" : "rgba(253,224,71,0.95)" }}
                      >
                        {restoreResult.status === CLOUD_RESTORE_STATUS.RESTORED
                          ? "Cloud data restored to this device."
                          : restoreResult.status === CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY
                            ? "This device already has local data. Restore is blocked to prevent overwriting."
                            : "Restore could not be completed on this device."}
                      </div>
                    ) : null}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button
                        type="button"
                        className="pe-btn pe-btn-ghost"
                        onClick={requestCloudRestoreConfirmation}
                        disabled={restoreBusy}
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
                        onClick={downloadBackupJson}
                      >
                        Download Backup JSON
                      </button>
                    </div>
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
      {cloudConfirmDialog ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cloud-confirm-dialog-title"
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(2,6,23,0.66)",
            display: "grid",
            placeItems: "center",
            padding: 20,
            zIndex: 60,
          }}
        >
          <div
            className="pe-card pe-card-content"
            style={{
              width: "min(100%, 460px)",
              display: "grid",
              gap: 12,
              borderRadius: 18,
              border: "1px solid rgba(148,163,184,0.24)",
              background: "linear-gradient(180deg, rgba(30,41,59,0.96), rgba(15,23,42,0.98))",
              boxShadow: "0 24px 60px rgba(0,0,0,0.38)",
            }}
          >
            <div id="cloud-confirm-dialog-title" className="pe-field-label" style={{ marginBottom: 0 }}>
              {cloudConfirmDialog.title}
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              {cloudConfirmDialog.lines.map((line) => (
                <div key={line} className="pe-field-helper">{line}</div>
              ))}
            </div>
            {cloudConfirmDialog.requireCheckbox ? (
              <label className="pe-field-helper" style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={replaceConfirmChecked}
                  onChange={(e) => setReplaceConfirmChecked(e.target.checked)}
                  style={{ marginTop: 2 }}
                />
                <span>{cloudConfirmDialog.checkboxLabel}</span>
              </label>
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => setCloudConfirmDialog(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={confirmCloudAction}
                disabled={Boolean(cloudConfirmDialog.requireCheckbox && !replaceConfirmChecked)}
              >
                {cloudConfirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
