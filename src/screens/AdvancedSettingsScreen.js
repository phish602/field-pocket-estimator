import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { triggerLocalStorageExportDownload } from "../lib/localStorageExportDownload";
import { triggerCloudBackupExportDownload } from "../lib/cloudBackupExportDownload";
import { buildDiagnosticBundle } from "../utils/supportDiagnostics";
import { appendAuditEvent, createStoredAuditEvent, readStoredAuditEvents } from "../utils/auditStore";
import { SUPPORTED_LANGUAGES, useLanguage } from "../lib/i18n";
import { DEFAULT_SETTINGS, loadSettings, normalizeSettings, saveSettings } from "../utils/settings";
import useSupabaseAuth from "../lib/useSupabaseAuth";
import useSupabaseAccount from "../lib/useSupabaseAccount";
import useDeviceLockStatus from "../lib/useDeviceLockStatus";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";
import useCloudBackupStatus, { CLOUD_PRODUCT_STATE } from "../lib/useCloudBackupStatus";
import { getCloudMutationLedgerSummary, getHistoricalWorkspaceBaselineCandidates } from "../lib/cloudMutationLedger";
import { isActiveCloudMutation, hasCurrentDurableLedgerWork, hasPendingLocalBackup } from "../lib/cloudOperationOwnership";
import { isInactiveWorkspaceBaselineQueue } from "../lib/cloudBackupQueue";
import { getHistoricalWorkspaceBaselineEligibility, HISTORICAL_PROFILE_DIAGNOSTIC_FIELD_KEYS, readHistoricalTemplateCaptureStatus } from "../lib/supabaseCloudConvergence";
import { getActiveAccountWorkspaceIdentity } from "../lib/accountScopedLocalStorage";
import { DEFAULT_VAULT_IDLE_LOCK_MINUTES, VAULT_IDLE_LOCK_MINUTES } from "../lib/vaultIdleLockSettings";
import { previewSupabaseCloudRestore, executeSupabaseCloudRestore, exportSupabaseCloudBackupArtifact, CLOUD_RESTORE_STATUS, CLOUD_BACKUP_EXPORT_STATUS } from "../lib/supabaseCloudRestore";
import { checkSupabaseCloudOnboardingStatus, CLOUD_ONBOARDING_STATUS } from "../lib/supabaseCloudOnboarding";
import { LOCAL_DATA_DECISION } from "../lib/localDataIntegrity";
import CloudConfirmDialog from "../components/CloudConfirmDialog";
import { buildCloudRestoreConfirmationDialog, getCloudRestoreAvailability } from "../lib/cloudRestoreUi";
import { VAULT_COMPATIBILITY_GUARD_KEY } from "../lib/vaultCompatibilityGuard";
const ESTIPAID_PREFIX = "estipaid-";
function asObject(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? v : {};
}

// Read the existing owner without deciding or acting on sync. Reject objects,
// free-form messages and missing values instead of coercing them into text.
const DIAGNOSTIC_UNAVAILABLE = "unavailable";
function diagnosticCode(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,95}$/.test(value)
    ? value : DIAGNOSTIC_UNAVAILABLE;
}
function diagnosticBoolean(value) {
  return typeof value === "boolean" ? String(value) : DIAGNOSTIC_UNAVAILABLE;
}
function diagnosticNumber(value) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? String(value) : DIAGNOSTIC_UNAVAILABLE;
}
function diagnosticTime(value) {
  if (typeof value === "number") return diagnosticNumber(value);
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) ? value : DIAGNOSTIC_UNAVAILABLE;
}
function diagnosticOptional(value, sanitize) {
  return value === null ? "null" : sanitize(value);
}
function readDiagnosticRecord(key) {
  try {
    const raw = localStorage.getItem(key);
    return { readAvailable: true, present: raw != null, value: typeof raw === "string" ? safeJsonParse(raw) : null };
  } catch {
    return { readAvailable: false, present: false, value: null };
  }
}
function diagnosticIdentityMatches(left, right) {
  return typeof left === "string" && left.trim() && typeof right === "string" && right.trim()
    ? left.trim() === right.trim() : undefined;
}
function diagnosticCompanyMatches(entry, companyId) {
  if (typeof companyId !== "string" || !companyId.trim()) return undefined;
  const values = [entry?.companyId, entry?.payload?.companyId, entry?.payload?.company_id]
    .filter(value => value != null && value !== "");
  if (!values.length || values.some(value => typeof value !== "string" || !value.trim())) return undefined;
  return values.every(value => value.trim() === companyId.trim());
}
function DevelopmentSyncDiagnostic({ status }) {
  const decision = status?.decision;
  const queue = status?.queueState;
  // Explicit null avoids the summary helper's storage-reading default.
  const ledger = getCloudMutationLedgerSummary(status?.mutationLedger ?? null);
  const mutation = ledger.failed || ledger.syncing || ledger.pending;
  // Read through the current facade only. Whitelisted scalars below are the
  // entire output: no storage record, identity or payload is ever rendered.
  const persistedLedger = readDiagnosticRecord(STORAGE_KEYS.CLOUD_MUTATION_LEDGER);
  const persistedQueue = readDiagnosticRecord(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
  const entrySource = Array.isArray(persistedLedger.value?.entries) ? persistedLedger.value : status?.mutationLedger;
  const activeEntries = (Array.isArray(entrySource?.entries) ? entrySource.entries : []).filter(isActiveCloudMutation);
  const companyId = getActiveAccountWorkspaceIdentity()?.companyId;
  const evaluatedAt = Date.now();
  const onboarding = status?.onboardingStatus;
  const verification = onboarding?.verification;
  const integrity = status?.localIntegrity;
  const convergence = status?.convergenceResult;
  const mismatch = convergence?.mismatch;
  const rows = [];
  const add = (label, value, sanitize = diagnosticCode) => rows.push([label, sanitize(value)]);
  ["productState", "displayState", "chipState", "chipAction"].forEach(key => add(key, status?.[key]));
  add("workerRunning", status?.workerRunning, diagnosticBoolean);
  ["screenState", "chipState"].forEach(key => add(`decision.${key}`, decision?.[key]));
  add("decision.firstBlocker.code", decision?.firstBlocker?.code);
  [
    "cloudUnrestorable", "ledgerFailed", "ledgerSyncing", "ledgerPending",
    "queueUnresolved", "queueSyncing", "knownPendingLocalMutation", "mismatch",
    "cloudOnlyRowsDetected", "pendingLocalAheadOnly", "verifiedCurrent",
    "restoreAvailable", "partialLocalData", "queueCurrentReview",
    "queueHistoricalReview", "queueLegacyCompatibility",
  ].forEach(key => add(`decision.${key}`, decision?.[key], diagnosticBoolean));
  add("queueState.pending", queue?.pending, diagnosticBoolean);
  ["status", "purpose", "lastErrorCode", "reviewOrigin"].forEach(key => add(`queueState.${key}`, queue?.[key]));
  add("queueState.retryCount", queue?.retryCount, diagnosticNumber);
  ["lastVerifiedAt", "lastSuccessfulBackupAt"].forEach(key => add(`queueState.${key}`, queue?.[key], diagnosticTime));
  const version = value => typeof value === "string" && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) ? value : DIAGNOSTIC_UNAVAILABLE;
  // Keep normalized status and persisted evidence separate. In particular,
  // clean queue reads can normalize historical review provenance away.
  [["queueState", queue], ["persistedQueue", persistedQueue.value]].forEach(([prefix, value]) => {
    add(`${prefix}.schemaVersion`, value?.schemaVersion, version);
    if (prefix === "persistedQueue") add(`${prefix}.reviewOrigin`, value?.reviewOrigin, item => item === "" ? "none" : diagnosticCode(item));
    add(`${prefix}.syncingRevision`, value?.syncingRevision, item => diagnosticOptional(item, diagnosticNumber));
    ["nextRetryAt", "createdAt", "updatedAt", "lastQueuedAt", "lastAttemptAt", "compatibilityMaterializedAt"]
      .forEach(key => add(`${prefix}.${key}`, value?.[key], item => diagnosticOptional(item, diagnosticTime)));
  });
  add("persistedQueue.readAvailable", persistedQueue.readAvailable, diagnosticBoolean);
  add("mutationLedger.activeCount", ledger.activeCount, diagnosticNumber);
  add("mutationLedger.lastVerifiedAt", ledger.lastVerifiedAt, diagnosticTime);
  add("mutationLedger.lastAcknowledgedRevision", ledger.lastAcknowledgedRevision, diagnosticNumber);
  add("mutationLedger.activeEntriesSource", Array.isArray(persistedLedger.value?.entries) ? "persisted" : "status");
  add("mutationLedger.activeEntriesCount", activeEntries.length, diagnosticNumber);
  activeEntries.forEach((entry, index) => {
    const prefix = `activeMutations[${index}]`;
    ["entityType", "operation", "status", "lastErrorCode"].forEach(key => add(`${prefix}.${key}`, entry?.[key]));
    ["createdAt", "lastAttemptAt", "nextRetryAt"].forEach(key => add(`${prefix}.${key}`, entry?.[key], value => diagnosticOptional(value, diagnosticTime)));
    add(`${prefix}.retryCount`, entry?.retryCount, diagnosticNumber);
    add(`${prefix}.documentIdEqualsPayloadId`, diagnosticIdentityMatches(entry?.documentId, entry?.payload?.id), diagnosticBoolean);
    add(`${prefix}.companyIdentityMatchesCurrentWorkspace`, diagnosticCompanyMatches(entry, companyId), diagnosticBoolean);
  });
  const presence = [
    ["cloudAutoBackupPausePresent", STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE],
    ["partialRecoveryStatusPresent", STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS],
    ["convergenceJournalPresent", STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL],
  ].map(([label, key]) => [label, readDiagnosticRecord(key)]);
  add("operationalPresenceReadAvailable", presence.every(([, record]) => record.readAvailable), diagnosticBoolean);
  presence.forEach(([label, record]) => add(label, record.present, diagnosticBoolean));
  // Reuse the exact existing pure/read-only predicates; never start their
  // verification, retry, requeue or retirement owners from this component.
  const historicalEligibility = companyId ? getHistoricalWorkspaceBaselineEligibility({ storage: localStorage, companyId }) : undefined;
  add("historicalBaselineEligible", historicalEligibility?.eligible, diagnosticBoolean);
  add("historicalBaselineEligibilityCode", historicalEligibility?.code);
  add("historicalBaselineEligibilityFamily", historicalEligibility?.family);
  add("historicalFailureShapeEligible", companyId ? getHistoricalWorkspaceBaselineCandidates(entrySource, { companyId, before: evaluatedAt }).length > 0 : undefined, diagnosticBoolean);
  add("hasCurrentDurableLedgerWork", hasCurrentDurableLedgerWork(entrySource), diagnosticBoolean);
  add("hasPendingLocalBackup", hasPendingLocalBackup(persistedQueue.value ?? queue), diagnosticBoolean);
  add("hasUnacknowledgedDelete", activeEntries.some(entry => entry?.operation === "delete"), diagnosticBoolean);
  add("inactiveWorkspaceBaselineQueue", companyId ? isInactiveWorkspaceBaselineQueue(persistedQueue.value, { companyId, before: evaluatedAt }) : undefined, diagnosticBoolean);
  if (mutation) {
    ["status", "entityType", "operation", "lastErrorCode"].forEach(key => add(`mutation.${key}`, mutation[key]));
    ["revision", "retryCount"].forEach(key => add(`mutation.${key}`, mutation[key], diagnosticNumber));
    add("mutation.nextRetryAt", mutation.nextRetryAt, diagnosticTime);
  }
  ["status", "code", "reason"].forEach(key => add(`onboardingStatus.${key}`, onboarding?.[key]));
  ["ok", "allMatched"].forEach(key => add(`verification.${key}`, verification?.[key], diagnosticBoolean));
  const tables = Array.isArray(verification?.tableResults) ? verification.tableResults : [];
  tables.forEach((table, index) => {
    const knownTables = ["customers", "projects", "estimates", "estimate_line_items", "invoices", "invoice_line_items", "invoice_payments", "app_restore_bundles"];
    if (!knownTables.includes(table?.table)) return;
    add(`verification.tableResults[${index}].table`, table.table);
    ["missingLegacyIds", "extraLegacyIds"].forEach(key => add(
      `verification.tableResults[${index}].${key}.length`,
      Array.isArray(table[key]) ? table[key].length : undefined, diagnosticNumber
    ));
  });
  add("localIntegrity.firstBlocker.code", integrity?.blockers?.[0]?.code);
  ["blockersCount", "warningsCount", "repairsAvailableCount"].forEach(key => add(`localIntegrity.${key}`, integrity?.summary?.[key], diagnosticNumber));
  add("deviceLock.isLocked", status?.deviceLock?.isLocked, diagnosticBoolean);
  add("deviceLock.code", status?.deviceLock?.code);
  add("convergenceResult.status", convergence?.status);
  add("convergenceResult.code", convergence?.code);
  const bundleProof = convergence?.historicalBundleProof;
  ["code", "family", "supplementalStatus", "localShape", "cloudShape"]
    .forEach(key => add(`convergenceResult.historicalBundleProof.${key}`, bundleProof?.[key]));
  ["snapshotAvailable", "companyProfileMatched", "settingsMatched", "scopeTemplatesMatched"]
    .forEach(key => add(`convergenceResult.historicalBundleProof.${key}`, bundleProof?.[key], diagnosticBoolean));
  ["companyProfileDifference", "scopeTemplatesDifference"].forEach(family => {
    const detail = bundleProof?.[family], prefix = `convergenceResult.historicalBundleProof.${family}`;
    add(`${prefix}.classification`, detail?.classification);
    ["localOnlyFields", "cloudOnlyFields", "differentValues", "orderingDifference", "localOnlyRecords", "cloudOnlyRecords",
      "serializationOnly", "phoneFormattingEquivalent", "collectionOrderEquivalent", "unsupportedShape", "identityIssue"]
      .forEach(key => add(`${prefix}.${key}`, detail?.[key], diagnosticBoolean));
  });
  const profileDifference = bundleProof?.companyProfileDifference;
  ["localOnlyFieldKeys", "cloudOnlyFieldKeys", "differingFieldKeys"].forEach(key => {
    add(`convergenceResult.historicalBundleProof.companyProfileDifference.${key}`, profileDifference?.[key], value =>
      Array.isArray(value) ? [...new Set(value.filter(field => HISTORICAL_PROFILE_DIAGNOSTIC_FIELD_KEYS.includes(field)))].sort().join(", ") || "none" : DIAGNOSTIC_UNAVAILABLE);
  });
  add("convergenceResult.historicalBundleProof.companyProfileDifference.redactedFieldKeyCount", profileDifference?.redactedFieldKeyCount, diagnosticNumber);
  ["localStatus", "cloudStatus", "historicalNullReason"].forEach(key =>
    add(`convergenceResult.historicalBundleProof.scopeTemplateCapture.${key}`, bundleProof?.scopeTemplateCapture?.[key]));
  add("scopeTemplateCurrentLocalCaptureStatus", readHistoricalTemplateCaptureStatus({ storage: localStorage }));
  add("convergenceResult.mismatch.repairableMismatchOnly", mismatch?.repairableMismatchOnly, diagnosticBoolean);
  add("convergenceResult.mismatch.repairTypes", mismatch?.repairTypes, values => (
    Array.isArray(values) && values.every(value => diagnosticCode(value) !== DIAGNOSTIC_UNAVAILABLE)
      ? values.join(", ") || DIAGNOSTIC_UNAVAILABLE : DIAGNOSTIC_UNAVAILABLE
  ));
  add("convergenceResult.mismatch.repairDocumentIds.length", Array.isArray(mismatch?.repairDocumentIds) ? mismatch.repairDocumentIds.length : undefined, diagnosticNumber);
  return (
    <section aria-label="Development Sync Diagnostic" style={{ borderTop: "1px solid rgba(148,163,184,0.18)", paddingTop: 8 }}>
      <h3 className="pe-field-label">Development Sync Diagnostic</h3>
      <div style={{ fontFamily: "monospace", fontSize: 12, overflowWrap: "anywhere" }}>
        {rows.map(([label, value]) => <div key={label}>{label}: {value}</div>)}
      </div>
    </section>
  );
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
function mergeSettingsSafe(base, incoming) {
  const b = normalizeSettings(base);
  const i = normalizeSettings(incoming);
  return normalizeSettings({
    ...b,
    ...i,
    pricing: {
      ...(b.pricing || {}),
      ...(i.pricing || {})
    },
    docDefaults: {
      ...(b.docDefaults || {}),
      ...(i.docDefaults || {})
    },
    internal: {
      ...(b.internal || {}),
      ...(i.internal || {})
    },
    pdf: {
      ...(b.pdf || {}),
      ...(i.pdf || {})
    },
    customer: {
      ...(b.customer || {}),
      ...(i.customer || {})
    }
  });
}
function inferWorkspaceName() {
  const profile = readStoredJson(STORAGE_KEYS.COMPANY_PROFILE, {});
  return String(profile?.companyName || profile?.name || "").trim();
}
function SettingRow({
  title,
  hint,
  control
}) {
  return <div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap"
  }}>
      <div style={{
      minWidth: 220,
      flex: "1 1 220px"
    }}>
        <div className="pe-field-label" style={{
        margin: 0
      }}>{title}</div>
        {hint ? <div className="pe-field-helper" style={{
        marginTop: 4
      }}>{hint}</div> : null}
      </div>
      <div style={{
      display: "flex",
      gap: 8,
      alignItems: "center",
      flexWrap: "wrap"
    }}>
        {control}
      </div>
    </div>;
}
function SegmentedButtons({
  options,
  value,
  onChange
}) {
  return <div style={{
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: 2,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.06)"
  }}>

      {options.map(opt => {
      const active = opt.value === value;
      return <button key={String(opt.value)} type="button" className={active ? "pe-btn" : "pe-btn pe-btn-ghost"} onClick={() => onChange(opt.value)} style={{
        padding: "8px 12px",
        borderRadius: 999,
        minWidth: 86,
        fontWeight: active ? 800 : 600,
        border: active ? "1px solid rgba(255,255,255,0.24)" : "1px solid transparent"
      }}>

            {opt.label}
          </button>;
    })}
    </div>;
}
function ToggleButton({
  value,
  onClick,
  disabled = false
}) {
  const {
    t
  } = useLanguage();
  return <button type="button" className={value ? "pe-btn" : "pe-btn pe-btn-ghost"} onClick={onClick} disabled={disabled} style={{
    minWidth: 84
  }}>

      {value ? t("settings.toggleOn") : t("settings.toggleOff")}
    </button>;
}
export default function AdvancedSettingsScreen({
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
  // Language and copy come from the app's one owner.
  const {
    lang,
    setLanguage,
    t
  } = useLanguage();
  const cloudBackupStatus = useCloudBackupStatus();
  const [settings, setSettings] = useState(() => loadSettings());
  const [authAction, setAuthAction] = useState("");
  const [workspaceName, setWorkspaceName] = useState(() => inferWorkspaceName());
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [restorePreviewBusy, setRestorePreviewBusy] = useState(false);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [cloudConfirmDialog, setCloudConfirmDialog] = useState(null);
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  const [cloudExportBusy, setCloudExportBusy] = useState(false);
  const [recoveryMessage, setRecoveryMessage] = useState(null);
  const recoveryMessageTimerRef = useRef(null);
  useEffect(() => () => {
    if (recoveryMessageTimerRef.current) {
      clearTimeout(recoveryMessageTimerRef.current);
      recoveryMessageTimerRef.current = null;
    }
  }, []);
  const {
    configured: isSupabaseReady,
    missingEnvKeys,
    loading: authLoading,
    authBusy,
    user,
    userEmail,
    errorMessage: authErrorMessage,
    signOut
  } = useSupabaseAuth();
  const {
    companyUser,
    company,
    role: accountRole,
    loading: accountLoading,
    error: accountError,
    hasCompany,
    refresh: refreshAccountStatus
  } = useSupabaseAccount({
    configured: isSupabaseReady,
    user
  });
  const {
    createWorkspace,
    creating: creatingWorkspace,
    error: workspaceError,
    success: workspaceSuccess
  } = useSupabaseWorkspaceBootstrap({
    configured: isSupabaseReady,
    user,
    hasMembership: Boolean(companyUser),
    onCreated: refreshAccountStatus
  });
  const deviceLock = useDeviceLockStatus({
    configured: isSupabaseReady,
    user,
    company,
    enabled: Boolean(isSupabaseReady && user?.id && company?.id)
  });
  useEffect(() => {
    const onStorage = e => {
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
  const sectionStyle = useMemo(() => ({
    margin: 0,
    padding: "14px 14px",
    display: "grid",
    gap: 12
  }), []);
  const panelStyle = useMemo(() => ({
    ...sectionStyle,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.1)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.015))",
    boxShadow: "0 12px 28px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.02)"
  }), [sectionStyle]);
  const shortcutGridStyle = useMemo(() => ({
    display: "grid",
    gap: 12,
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))"
  }), []);
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
    partialLocalSnapshot: partialLocalSnapshotState
  });
  const restoreActionAvailable = restoreAvailability.available;
  // A safe technical reason when the last automatic convergence did not succeed,
  // so the screen never claims zero blockers with no sign the sync failed. Only
  // the safe code is shown -- no names, numbers, or record details. Cleared once
  // a later matched/converged result arrives (convergenceResult.ok === true).

  // Safe automatic-sync state for the contractor restore section.

  const loadRestorePreview = useCallback(async ({
    allowPartialLocalSnapshot
  }) => {
    return previewSupabaseCloudRestore({
      storageSnapshot: localStorage,
      configured: isSupabaseReady,
      user,
      company,
      allowPartialLocalSnapshot
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
    loadRestorePreview({
      allowPartialLocalSnapshot: partialLocalSnapshotState
    }).then(result => {
      if (active) setRestorePreview(result);
    }).catch(() => {
      if (active) {
        setRestorePreview({
          status: CLOUD_RESTORE_STATUS.ERROR,
          eligible: false,
          error: "Unable to check restore eligibility.",
          noWritesPerformed: true
        });
      }
    }).finally(() => {
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
      if ([CLOUD_RESTORE_STATUS.RESTORED, CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY, CLOUD_RESTORE_STATUS.DEVICE_LOCKED, CLOUD_RESTORE_STATUS.ERROR].includes(result?.status) && isSupabaseReady && user?.id && company?.id) {
        try {
          const nextStatus = await checkSupabaseCloudOnboardingStatus({
            storageSnapshot: localStorage,
            configured: isSupabaseReady,
            user,
            company,
            role: accountRole,
            allowAutomaticSafeRepair: false
          });
          setOnboardingStatus(nextStatus);
        } catch {}
      }
    } catch {

      // The contractor-facing screen keeps restore errors in the canonical
      // onboarding/status owner; it does not expose a second technical result.
    } finally {
      setRestoreBusy(false);
    }
  };
  const requestCloudRestoreConfirmation = () => {
    if (!ensureUnlockedForWrite()) return;
    setCloudConfirmDialog({
      action: "restore",
      ...buildCloudRestoreConfirmationDialog({
        partialLocalSnapshot: partialLocalSnapshotState
      })
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
      keys.forEach(key => {
        // This is device-global vault authority, not workspace business data.
        // Removing it while the encrypted runtime catalog remains creates a
        // guard/catalog mismatch that correctly fails closed after reload.
        if (key === VAULT_COMPATIBILITY_GUARD_KEY) return;
        try {
          localStorage.removeItem(key);
        } catch {}
      });
      try {
        window.dispatchEvent(new Event("estipaid:settings-changed"));
      } catch {}
      setSettings(loadSettings());
    } catch {
      window.alert("Clear failed.");
    }
  };

  // Recovery Tools: read-only copies only. These reuse the existing device,
  // cloud and diagnostics exporters; nothing here imports or restores data.
  const showRecoveryMessage = (text, tone = "success") => {
    if (recoveryMessageTimerRef.current) clearTimeout(recoveryMessageTimerRef.current);
    setRecoveryMessage({ text, tone });
    recoveryMessageTimerRef.current = setTimeout(() => {
      setRecoveryMessage(null);
      recoveryMessageTimerRef.current = null;
    }, 1800);
  };
  const downloadBackupJson = () => {
    try {
      const result = triggerLocalStorageExportDownload({
        storageSnapshot: localStorage,
        BlobConstructor: Blob,
        URLObject: URL,
        documentObject: document
      });
      showRecoveryMessage(t("settings.deviceBackupDownloaded", { filename: result.filename }));
    } catch {
      showRecoveryMessage(t("settings.deviceBackupFailed"), "error");
    }
  };
  const downloadCloudBackupJson = async () => {
    try {
      setCloudExportBusy(true);
      const exportResult = await exportSupabaseCloudBackupArtifact({
        configured: isSupabaseReady,
        user,
        company
      });
      if (exportResult.status !== CLOUD_BACKUP_EXPORT_STATUS.EXPORTED || !exportResult.artifact) {
        showRecoveryMessage(String(exportResult.error || t("settings.cloudBackupFailed")), "error");
        return;
      }
      const { filename, artifact } = triggerCloudBackupExportDownload({
        artifact: exportResult.artifact,
        BlobConstructor: Blob,
        URLObject: URL,
        documentObject: document
      });
      const counts = artifact.counts;
      const coreTotal = counts.customers + counts.projects + counts.estimates + counts.invoices;
      showRecoveryMessage(coreTotal === 0
        ? t("settings.cloudBackupDownloadedEmpty", { filename })
        : t("settings.cloudBackupDownloadedCounts", { filename, ...counts }));
    } catch (error) {
      showRecoveryMessage(String(error?.message || t("settings.cloudBackupFailed")), "error");
    } finally {
      setCloudExportBusy(false);
    }
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
        auditEvents: readStoredAuditEvents()
      };
      const bundle = buildDiagnosticBundle(snapshot, {
        includeSensitive: false,
        routeContext: "advanced_settings"
      });
      const generatedAt = String(bundle?.bundleMeta?.generatedAt || new Date().toISOString());
      downloadJson(bundle, `estipaid-diagnostics-${generatedAt.slice(0, 10)}.json`);
      try {
        const auditEvent = createStoredAuditEvent("diagnostic_bundle.exported", {
          targetType: "diagnostic_bundle",
          targetId: String(bundle?.bundleMeta?.supportId || ""),
          source: "advanced_settings",
          reason: "manual_export",
          metadata: {
            bundleSchemaVersion: String(bundle?.bundleMeta?.bundleSchemaVersion || ""),
            supportId: String(bundle?.bundleMeta?.supportId || ""),
            issueCount: Number(bundle?.healthSummary?.issueCount || 0)
          }
        });
        if (auditEvent) appendAuditEvent(auditEvent);
      } catch {}
      showRecoveryMessage(t("settings.diagnosticsExported"));
    } catch {
      showRecoveryMessage(t("settings.diagnosticsFailed"), "error");
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  return <section className="pe-section">
      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header">
          <div className="pe-company-header-title">
            <img key={spinTick} src="/logo/estipaid.svg" alt={t("settings2.estipaid")} className="pe-company-header-logo esti-spin" draggable={false} />

            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title={t("settings.title")}>{t("settings.title")}</h1>
          </div>
          <div className="pe-company-header-controls" />
        </div>

        <div className="pe-company-form-inner ep-section-gap-sm" style={{
        gap: 12,
        paddingBottom: 8
      }}>
          {/* Gate 13O-2K: the header h1 above is the page title -- do not
                    repeat "Settings" here. */}
          <div style={{
          display: "grid",
          gap: 6
        }}>
            <div className="pe-muted" style={{
            maxWidth: 760
          }}>
              {t("settings.intro")}
            </div>
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{
            marginBottom: 2
          }}>{t("settings.sectionLanguage")}</div>
            <div className="pe-field-helper" style={{
            marginTop: -4
          }}>
              {t("settings.languageHelp")}
            </div>
            <div role="group" aria-label={t("shell.languageGroupLabel")} style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap"
          }}>

              {SUPPORTED_LANGUAGES.map(code => <button key={code} type="button" className="pe-btn" aria-pressed={lang === code} data-language-option={code} onClick={() => setLanguage(code)} style={lang === code ? {
              borderColor: "rgba(96,165,250,0.55)",
              background: "rgba(59,130,246,0.16)"
            } : undefined}>

                  {code === "es" ? t("shell.languageSpanish") : t("shell.languageEnglish")}
                </button>)}
            </div>
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{
            marginBottom: 2
          }}>{t("settings.sectionBusinessProfile")}</div>
            <div className="pe-field-helper" style={{
            marginTop: -4
          }}>
              {t("settings.businessProfileHelp")}
            </div>
            <div>
              <button type="button" className="pe-btn" onClick={() => {
              if (typeof onOpenCompanyProfile === "function") onOpenCompanyProfile();
            }}>

                {t("settings.openBusinessProfile")}
              </button>
            </div>
          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{
            marginBottom: 2
          }}>{t("settings.sectionPricingDefaults")}</div>
            <div className="pe-field-helper" style={{
            marginTop: -4
          }}>
              {t("settings.pricingDefaultsHelp")}
            </div>
            <SettingRow title={t("settings.defaultMarkupPct")} hint={t("settings.defaultMarkupPctHint")} control={<input className="pe-input" inputMode="decimal" style={{
            width: 140
          }} value={String(settings?.pricing?.defaultMarkupPct ?? 0)} onChange={e => writeSettings(prev => ({
            ...prev,
            pricing: {
              ...(prev.pricing || {}),
              defaultMarkupPct: e.target.value
            }
          }))} />} />

            <SettingRow title={t("settings.useDefaultMarkup")} hint={t("settings.useDefaultMarkupHint")} control={<ToggleButton value={!!settings?.pricing?.lockMarkupToGlobal} onClick={() => writeSettings(prev => ({
            ...prev,
            pricing: {
              ...(prev.pricing || {}),
              lockMarkupToGlobal: !prev?.pricing?.lockMarkupToGlobal
            }
          }))} />} />

          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{
            marginBottom: 2
          }}>{t("settings.sectionInternalCostVisibility")}</div>
            <div className="pe-field-helper" style={{
            marginTop: -4
          }}>
              {t("settings.internalCostVisibilityHelp")}
            </div>
            <SettingRow title={t("settings.showInternalCostFields")} control={<ToggleButton value={!!settings?.internal?.showInternalCostFields} onClick={() => writeSettings(prev => ({
            ...prev,
            internal: {
              ...(prev.internal || {}),
              showInternalCostFields: !prev?.internal?.showInternalCostFields
            }
          }))} />} />

            <SettingRow title={t("settings.lockInternalCostFields")} control={<ToggleButton value={!!settings?.internal?.lockInternalCostFields} onClick={() => writeSettings(prev => ({
            ...prev,
            internal: {
              ...(prev.internal || {}),
              lockInternalCostFields: !prev?.internal?.lockInternalCostFields
            }
          }))} />} />

          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{
            marginBottom: 2
          }}>{t("settings.sectionPdfPreferences")}</div>
            <div className="pe-field-helper" style={{
            marginTop: -4
          }}>
              {t("settings.pdfPreferencesHelp")}
            </div>
            <SettingRow title={t("settings.includeLogo")} control={<ToggleButton value={!!settings?.pdf?.includeLogo} onClick={() => writeSettings(prev => ({
            ...prev,
            pdf: {
              ...(prev.pdf || {}),
              includeLogo: !prev?.pdf?.includeLogo
            }
          }))} />} />

            <SettingRow title={t("settings.compactLayout")} control={<ToggleButton value={!!settings?.pdf?.compactLayout} onClick={() => writeSettings(prev => ({
            ...prev,
            pdf: {
              ...(prev.pdf || {}),
              compactLayout: !prev?.pdf?.compactLayout
            }
          }))} />} />

            <SettingRow title={t("settings.showUnitRates")} control={<ToggleButton value={!!settings?.pdf?.showUnitRates} onClick={() => writeSettings(prev => ({
            ...prev,
            pdf: {
              ...(prev.pdf || {}),
              showUnitRates: !prev?.pdf?.showUnitRates
            }
          }))} />} />

          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{
            marginBottom: 2
          }}>{t("settings.sectionCustomerDefaults")}</div>
            <div className="pe-field-helper" style={{
            marginTop: -4
          }}>
              {t("settings.customerDefaultsHelp")}
            </div>
            <SettingRow title={t("settings.defaultCustomerType")} control={<SegmentedButtons value={settings?.customer?.defaultCustomerType === "commercial" ? "commercial" : "residential"} options={[{
            label: t("settings.residential"),
            value: "residential"
          }, {
            label: t("settings.commercial"),
            value: "commercial"
          }]} onChange={value => writeSettings(prev => ({
            ...prev,
            customer: {
              ...(prev.customer || {}),
              defaultCustomerType: value
            }
          }))} />} />

            <SettingRow title={t("settings.requirePhone")} control={<ToggleButton value={!!settings?.customer?.requirePhone} onClick={() => writeSettings(prev => ({
            ...prev,
            customer: {
              ...(prev.customer || {}),
              requirePhone: !prev?.customer?.requirePhone
            }
          }))} />} />

            <SettingRow title={t("settings.requireEmail")} control={<ToggleButton value={!!settings?.customer?.requireEmail} onClick={() => writeSettings(prev => ({
            ...prev,
            customer: {
              ...(prev.customer || {}),
              requireEmail: !prev?.customer?.requireEmail
            }
          }))} />} />

          </div>

          <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
            <div className="pe-field-label" style={{
            marginBottom: 2
          }}>{t("settings.sectionLocalVaultLock")}</div>
            <div className="pe-field-helper" style={{
            marginTop: -4
          }}>
              {t("settings2.estipaidAutomaticallyLocksEncryptedLocalVault")}
            </div>
            <SettingRow title={t("settings.lockAfterInactivity")} hint={t("settings.lockAfterInactivityHint")} control={<select className="pe-input" aria-label={t("settings2.automaticVaultLockAfterInactivity")} value={String(vaultIdleLockMinutes)} onChange={event => {
            const minutes = Number(event.target.value);
            if (VAULT_IDLE_LOCK_MINUTES.includes(minutes) && typeof onVaultIdleLockMinutesChange === "function") {
              onVaultIdleLockMinutesChange(minutes);
            }
          }}>

                  {vaultIdleLockOptions.filter(minutes => VAULT_IDLE_LOCK_MINUTES.includes(minutes)).map(minutes => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
                </select>} />

            <div>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={() => {
              if (typeof onVaultLockNow === "function") onVaultLockNow();
            }}>

                {t("settings2.lockNow")}
              </button>
            </div>
          </div>

          <div style={shortcutGridStyle}>
            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
              {/* Phase 2 -- this section is about WHO is signed in: identity,
                        session, and sign out. Cloud backup state lives in its own
                        section below the divider. Presentation only: every handler,
                        condition, and cloud behavior is unchanged. */}
              <div className="pe-field-label" style={{
              marginBottom: 2
            }}>{t("settings.sectionAccount")}</div>
              <div className="pe-field-helper" style={{
              marginTop: -4
            }}>
                {t("settings2.estipaidAccountSignedDeviceSigningOut")}
              </div>
              {!isSupabaseReady ? <>
                  <div className="pe-field-helper">
                    Supabase not configured. Set {missingEnvKeys.join(" and ")} to enable account sign-in.
                  </div>
                  <div className="pe-field-helper">
                    {t("settings2.downloadDeviceBackupJsonRecoveryTools")}
                  </div>
                </> : authLoading ? <div className="pe-field-helper">{t("settings2.checkingCloudAccountSession")}</div> : userEmail ? <>
                  <div className="pe-field-helper">
                    {t("settings.signedInAs")} <strong>{userEmail}</strong>
                  </div>
                  {accountLoading ? <div className="pe-field-helper">{t("settings2.checkingCompanyMembership")}</div> : null}
                  {!accountLoading && hasCompany ? <div className="pe-field-helper">
                      {t("settings.companyLabel")} <strong>{String(company?.name || t("settings.unnamedCompany"))}</strong>
                    </div> : null}
                  {!accountLoading && accountRole ? <div className="pe-field-helper">
                      {t("settings.roleLabel")} <strong>{accountRole}</strong>
                    </div> : null}
                  {!accountLoading && !accountError && !companyUser ? <>
                      <div className="pe-field-helper">{t("settings2.noCompanyMembershipFoundYet")}</div>
                      <div className="pe-field-helper">
                        {t("settings2.createsCloudWorkspaceOnlyBackupRestore")}
                      </div>
                      <div style={{
                  display: "grid",
                  gap: 8,
                  maxWidth: 440
                }}>
                        <label className="pe-field-helper" htmlFor="cloud-workspace-name" style={{
                    marginTop: 2
                  }}>
                          {t("settings2.companyWorkspaceName")}
                        </label>
                        <input id="cloud-workspace-name" type="text" className="pe-input" value={workspaceName} onChange={e => setWorkspaceName(e.target.value)} placeholder={t("settings2.fieldPocketLlc")} disabled={creatingWorkspace} />

                        <div>
                          <button type="button" className="pe-btn" onClick={submitWorkspaceCreate} disabled={creatingWorkspace}>

                            {creatingWorkspace ? "Creating..." : "Create Cloud Workspace"}
                          </button>
                        </div>
                      </div>
                    </> : null}
                  {!accountLoading && !accountError && companyUser && !hasCompany ? <div className="pe-field-helper">{t("settings2.companyRecordNotFoundMembershipYet")}</div> : null}
                  <div>
                    <button type="button" className="pe-btn pe-btn-ghost" onClick={requestCloudSignOut} disabled={authPending}>

                      {authAction === "signout" ? t("settings.signingOut") : t("settings.signOut")}
                    </button>
                  </div>
                </> : <div className="pe-field-helper">{t("settings2.signWelcomeScreenUseCloudBackup")}</div>}
              {authErrorMessage ? <div role="status" aria-live="polite" className="pe-field-helper" style={{
              color: "rgba(248,113,113,0.95)"
            }}>
                  {authErrorMessage}
                </div> : null}
              {!authErrorMessage && accountError ? <div role="status" aria-live="polite" className="pe-field-helper" style={{
              color: "rgba(248,113,113,0.95)"
            }}>
                  {accountError}
                </div> : null}
              {!authErrorMessage && !accountError && workspaceError ? <div role="status" aria-live="polite" className="pe-field-helper" style={{
              color: "rgba(248,113,113,0.95)"
            }}>
                  {workspaceError}
                </div> : null}
              {!authErrorMessage && !accountError && workspaceSuccess ? <div role="status" aria-live="polite" className="pe-field-helper" style={{
              color: "rgba(187,247,208,0.95)"
            }}>
                  {workspaceSuccess}
                </div> : null}

              {<div style={{
              display: "grid",
              gap: 8,
              paddingTop: 8,
              borderTop: "1px solid rgba(148,163,184,0.18)"
            }}>

                  <div className="pe-field-label" style={{
                marginBottom: 0
              }}>{t("settings.sectionCloudBackup")}</div>
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
                  {process.env.NODE_ENV !== "production" ? <DevelopmentSyncDiagnostic status={cloudBackupStatus} /> : null}
                </div>}
            </div>

            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
              <div className="pe-field-label" style={{
              marginBottom: 2
            }}>{t("settings.sectionTemplates")}</div>
              <div className="pe-field-helper" style={{
              marginTop: -4
            }}>
                {t("settings2.manageReusableWorkPackageTemplates")}
              </div>
              <div>
                <button type="button" className="pe-btn" onClick={() => {
                if (typeof onOpenTemplates === "function") onOpenTemplates();
              }}>

                  {t("settings2.openTemplates")}
                </button>
              </div>
            </div>

            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
              <div className="pe-field-label" style={{
              marginBottom: 2
            }}>{t("settings.sectionReportsBookkeeping")}</div>
              <div className="pe-field-helper" style={{
              marginTop: -4
            }}>
                {t("settings2.viewBusinessSnapshotFutureBookkeepingExports")}
              </div>
              <div>
                <button type="button" className={snapshotAvailable ? "pe-btn" : "pe-btn pe-btn-ghost"} disabled={!snapshotAvailable} onClick={() => {
                if (snapshotAvailable && typeof onOpenSnapshot === "function") onOpenSnapshot();
              }}>

                  {snapshotAvailable ? "Open Snapshot" : "Snapshot Unavailable"}
                </button>
              </div>
            </div>

            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={panelStyle}>
              <div className="pe-field-label" style={{
              marginBottom: 2
            }}>{t("settings.sectionRecoveryTools")}</div>
              <div className="pe-field-helper" style={{
              marginTop: -4
            }}>
                {t("settings.recoveryToolsHelp")}
              </div>
              <div style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap"
            }}>
                <button type="button" className="pe-btn" onClick={exportDiagnosticsJson} disabled={diagnosticsBusy}>
                  {diagnosticsBusy ? t("settings.exportingDiagnostics") : t("settings.exportDiagnostics")}
                </button>
                <button type="button" className="pe-btn pe-btn-ghost" onClick={downloadCloudBackupJson} disabled={cloudExportBusy}>
                  {cloudExportBusy ? t("settings.preparingCloudBackup") : t("settings.downloadCloudBackupJson")}
                </button>
                <button type="button" className="pe-btn pe-btn-ghost" onClick={downloadBackupJson}>
                  {t("settings2.downloadDeviceBackupJson")}
                </button>
              </div>
              <div className="pe-field-helper" style={{
              marginTop: 2
            }}>
                {t("settings2.diagnosticsExportsCreateRedactedSupportBundle")}
              </div>
              {recoveryMessage ? <div role="status" aria-live="polite" className="pe-field-helper" style={{
              color: recoveryMessage.tone === "error" ? "rgba(248,113,113,0.95)" : "rgba(187,247,208,0.95)"
            }}>
                  {recoveryMessage.text}
                </div> : null}
            </div>
          </div>

          {null}

          <div className="ep-glass-tile ep-tile-hover" style={{
          ...panelStyle,
          border: "1px solid rgba(239,68,68,0.38)",
          background: "linear-gradient(180deg, rgba(127,29,29,0.22), rgba(15,23,42,0.52))"
        }}>
            <div className="pe-field-label" style={{
            marginBottom: 2,
            color: "rgba(254,202,202,0.95)"
          }}>
              {t("settings.sectionDangerZone")}
            </div>
            <div className="pe-field-helper">
              {t("settings2.destructiveMaintenanceActionsLocalDeviceData")}
            </div>
            <div style={{
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
            paddingTop: 4,
            borderTop: "1px solid rgba(248,113,113,0.24)"
          }}>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={resetSettings}>
                {t("settings2.resetSettings")}
              </button>
              <button type="button" className="pe-btn pe-btn-ghost" style={{
              borderColor: "rgba(248,113,113,0.34)",
              color: "rgba(254,202,202,0.94)"
            }} onClick={clearEstiPaidData}>

                {t("settings2.clearEstipaidLocalData")}
              </button>
            </div>
          </div>
        </div>
      </div>
      <CloudConfirmDialog dialog={cloudConfirmDialog} onCancel={() => setCloudConfirmDialog(null)} onConfirm={confirmCloudAction} />

    </section>;
}
