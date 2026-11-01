// @ts-nocheck
/* eslint-disable */

import { useEffect, useState } from "react";
import { readCloudBackupQueueState } from "./cloudBackupQueue";
import { CLOUD_AUTO_BACKUP_RUNNING_EVENT } from "./useCloudAutoBackup";
import {
  CLOUD_RESTORE_COMPLETE_EVENT,
  getLastCloudRestoreCompleteAt,
  previewSupabaseCloudRestore,
} from "./supabaseCloudRestore";
import { checkSupabaseCloudOnboardingStatus } from "./supabaseCloudOnboarding";
import { CLOUD_CONVERGENCE_RESULT_EVENT, getLastCloudConvergenceResult } from "./supabaseCloudConvergence";
import useSupabaseAuth from "./useSupabaseAuth";
import useSupabaseAccount from "./useSupabaseAccount";
import useDeviceLockStatus from "./useDeviceLockStatus";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { getCloudMutationLedgerSummary, readCloudMutationLedger } from "./cloudMutationLedger";
import {
  buildLocalSnapshotFromStorage,
  getCloudDataDecision,
  LOCAL_DATA_DECISION,
  scanLocalDataIntegrity,
} from "./localDataIntegrity";

export const CLOUD_BACKUP_RESTORE_BANNER_DURATION_MS = 6000;
export const CLOUD_PRODUCT_STATE = Object.freeze({
  CLOUD_OK: "cloud_ok",
  CLOUD_CONNECTED: "cloud_connected",
  SYNCING: "syncing",
  PENDING: "pending",
  SYNC_ISSUE: "sync_issue",
  RESTORE_AVAILABLE: "restore_available",
});

// ONE product clock for "Last synced". Successful cloud proof is recorded in
// three different places by three legitimate owners: the first whole-workspace
// bootstrap backup (queue.lastSuccessfulBackupAt), a verified queue generation
// (queue.lastVerifiedAt), and a verified/acknowledged targeted mutation
// (ledger.lastVerifiedAt). After the mutation-ledger cutover routine sync stopped
// writing the queue clock, so reading the queue alone reported a months-old
// bootstrap date while targeted syncs were succeeding today. The newest VALID
// proof wins; 0, NaN, and any non-positive value are not proof, and nothing here
// invents or advances a timestamp -- a pending or failed mutation never writes
// one, so it can never appear.
function toValidSyncTimestamp(value) {
  if (value === null || value === undefined || value === "") return 0;
  const numeric = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

export function deriveLastSuccessfulSyncAt({ queueState = null, ledgerVerifiedAt = null } = {}) {
  const newest = [
    queueState?.lastSuccessfulBackupAt,
    queueState?.lastVerifiedAt,
    ledgerVerifiedAt,
  ].reduce((best, candidate) => Math.max(best, toValidSyncTimestamp(candidate)), 0);
  return newest > 0 ? newest : null;
}

export function deriveCloudProductStatus({
  connected = false,
  deviceLocked = false,
  decision = null,
  queueState = null,
  mutationLedger = null,
  workerRunning = false,
} = {}) {
  if (!connected) return Object.freeze({ state: null, retryAvailable: false, pendingReason: "", action: "none", lastSuccessfulSyncAt: null, lastSuccessfulBackupAt: null });

  const ledgerSummary = getCloudMutationLedgerSummary(mutationLedger);
  const screenState = decision?.screenState;
  const integrityIssue = Boolean(
    decision?.firstBlocker
    || decision?.cloudUnrestorable
    || screenState === LOCAL_DATA_DECISION.PARTIAL_LOCAL_DATA
    || screenState === LOCAL_DATA_DECISION.NEEDS_REPAIR_BEFORE_BACKUP
  );
  const currentIssue = Boolean(
    deviceLocked
    || integrityIssue
    || decision?.ledgerFailed
    || decision?.queueUnresolved
    || decision?.mismatch
    || screenState === LOCAL_DATA_DECISION.BACKUP_FAILED
  );

  let state;
  if (currentIssue) state = CLOUD_PRODUCT_STATE.SYNC_ISSUE;
  else if (workerRunning || decision?.ledgerSyncing || decision?.queueSyncing) state = CLOUD_PRODUCT_STATE.SYNCING;
  else if (decision?.ledgerPending || decision?.knownPendingLocalMutation) state = CLOUD_PRODUCT_STATE.PENDING;
  else if (decision?.restoreAvailable) state = CLOUD_PRODUCT_STATE.RESTORE_AVAILABLE;
  else if (decision?.verifiedCurrent) state = CLOUD_PRODUCT_STATE.CLOUD_OK;
  else state = CLOUD_PRODUCT_STATE.CLOUD_CONNECTED;

  const queueStatus = String(queueState?.status || "").trim();
  const pendingReason = state === CLOUD_PRODUCT_STATE.PENDING
    ? queueStatus === "offline_pending" ? "offline" : queueStatus === "retry_wait" ? "retry" : "pending"
    : "";
  const queueRetryable = Boolean(queueState?.pending && queueStatus === "needs_attention");
  const retryAvailable = state === CLOUD_PRODUCT_STATE.SYNC_ISSUE
    && !deviceLocked
    && Boolean(ledgerSummary.failed || queueRetryable);
  const action = deviceLocked
    ? "device_locked"
    : state === CLOUD_PRODUCT_STATE.SYNC_ISSUE
      ? "open_settings"
      : state === CLOUD_PRODUCT_STATE.RESTORE_AVAILABLE
        ? "open_restore"
        : "none";

  const lastSuccessfulSyncAt = deriveLastSuccessfulSyncAt({
    queueState,
    ledgerVerifiedAt: ledgerSummary.lastVerifiedAt,
  });

  return Object.freeze({
    state,
    retryAvailable,
    pendingReason,
    action,
    lastSuccessfulSyncAt,
    // Same derived value under the older name, so no consumer can read a
    // different clock than the one Settings shows.
    lastSuccessfulBackupAt: lastSuccessfulSyncAt,
  });
}

function isRestoreRecent() {
  const at = getLastCloudRestoreCompleteAt();
  return Boolean(at) && Date.now() - at < CLOUD_BACKUP_RESTORE_BANNER_DURATION_MS;
}

function readLocalIntegrity() {
  try {
    return scanLocalDataIntegrity(buildLocalSnapshotFromStorage(localStorage).snapshot);
  } catch {
    return null;
  }
}

function hasPartialLocalSnapshotBlocker(integrity) {
  return Boolean(
    Array.isArray(integrity?.blockers)
    && integrity.blockers.some((issue) => String(issue?.code || "").trim() === "empty_estimates_with_invoices")
  );
}

export default function useCloudBackupStatus() {
  const { configured: isSupabaseReady, user, userEmail } = useSupabaseAuth();
  const { company, role, hasCompany } = useSupabaseAccount({ configured: isSupabaseReady, user });
  const deviceLock = useDeviceLockStatus({
    configured: isSupabaseReady,
    user,
    company,
    enabled: Boolean(isSupabaseReady && user?.id && company?.id),
  });
  const [queueState, setQueueState] = useState(() => readCloudBackupQueueState());
  const [mutationLedger, setMutationLedger] = useState(() => readCloudMutationLedger());
  const [workerRunning, setWorkerRunning] = useState(false);
  const [restoredRecently, setRestoredRecently] = useState(isRestoreRecent);
  const [localIntegrity, setLocalIntegrity] = useState(readLocalIntegrity);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restorePreviewLoading, setRestorePreviewLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [convergenceResult, setConvergenceResult] = useState(() => getLastCloudConvergenceResult());

  useEffect(() => {
    const refresh = () => {
      setQueueState(readCloudBackupQueueState());
      setMutationLedger(readCloudMutationLedger());
      setLocalIntegrity(readLocalIntegrity());
    };

    const onStorageEvent = (event) => {
      const key = event?.detail?.key;
      if (
        key
        && key !== STORAGE_KEYS.CLOUD_BACKUP_QUEUE
        && key !== STORAGE_KEYS.CLOUD_MUTATION_LEDGER
        && key !== STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS
        && key !== STORAGE_KEYS.CUSTOMERS
        && key !== STORAGE_KEYS.PROJECTS
        && key !== STORAGE_KEYS.ESTIMATES
        && key !== STORAGE_KEYS.INVOICES
        && key !== STORAGE_KEYS.AUDIT_EVENTS
      ) {
        return;
      }
      refresh();
      if (key === STORAGE_KEYS.CLOUD_BACKUP_QUEUE) {
        setRefreshToken((value) => value + 1);
      }
      if (key === STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS) {
        setRefreshToken((value) => value + 1);
      }
    };

    const onWorkerRunningEvent = (event) => {
      setWorkerRunning(Boolean(event?.detail?.running));
    };

    let restoreBannerTimer = null;
    const armRestoreBannerTimer = (remainingMs) => {
      if (restoreBannerTimer) clearTimeout(restoreBannerTimer);
      restoreBannerTimer = setTimeout(() => setRestoredRecently(false), remainingMs);
    };
    const onRestoreComplete = () => {
      refresh();
      setRestoredRecently(true);
      armRestoreBannerTimer(CLOUD_BACKUP_RESTORE_BANNER_DURATION_MS);
    };

    // Automatic convergence finished (any outcome): re-run cloud verification so
    // the chip stops showing a stale pre-convergence mismatch. A verified success
    // reaches Cloud OK; a failure keeps the mismatch and carries a safe reason.
    const onConvergenceResult = (event) => {
      setConvergenceResult(event?.detail || getLastCloudConvergenceResult());
      refresh();
      setRefreshToken((value) => value + 1);
    };

    refresh();

    if (isRestoreRecent()) {
      armRestoreBannerTimer(CLOUD_BACKUP_RESTORE_BANNER_DURATION_MS - (Date.now() - getLastCloudRestoreCompleteAt()));
    }

    try {
      window.addEventListener("pe-localstorage", onStorageEvent);
      window.addEventListener(CLOUD_AUTO_BACKUP_RUNNING_EVENT, onWorkerRunningEvent);
      window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onRestoreComplete);
      window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onConvergenceResult);
      window.addEventListener("estipaid:customers-changed", refresh);
      window.addEventListener("estipaid:projects-changed", refresh);
      window.addEventListener("estipaid:estimates-changed", refresh);
      window.addEventListener("estipaid:invoices-changed", refresh);
    } catch {}

    return () => {
      if (restoreBannerTimer) clearTimeout(restoreBannerTimer);
      try {
        window.removeEventListener("pe-localstorage", onStorageEvent);
        window.removeEventListener(CLOUD_AUTO_BACKUP_RUNNING_EVENT, onWorkerRunningEvent);
        window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onRestoreComplete);
        window.removeEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, onConvergenceResult);
        window.removeEventListener("estipaid:customers-changed", refresh);
        window.removeEventListener("estipaid:projects-changed", refresh);
        window.removeEventListener("estipaid:estimates-changed", refresh);
        window.removeEventListener("estipaid:invoices-changed", refresh);
      } catch {}
    };
  }, []);

  useEffect(() => {
    let active = true;
    const userId = String(user?.id || "").trim();
    const companyId = String(company?.id || "").trim();

    if (!isSupabaseReady || !userId || !companyId) {
      setOnboardingStatus(null);
      setRestorePreview(null);
      setRestorePreviewLoading(false);
      return undefined;
    }

    checkSupabaseCloudOnboardingStatus({
      storageSnapshot: localStorage,
      configured: isSupabaseReady,
      user,
      company,
      role,
      allowAutomaticSafeRepair: false,
      verifyEstablishedWorkspace: false,
    })
      .then(async (result) => {
        if (!active) return;
        setOnboardingStatus(result);
        const currentLocalIntegrity = readLocalIntegrity();
        const partialLocalSnapshot = hasPartialLocalSnapshotBlocker(currentLocalIntegrity);
        if (String(result?.status || "").trim() !== "cloud_available_empty_device" && !partialLocalSnapshot) {
          setRestorePreview(null);
          setRestorePreviewLoading(false);
          return;
        }
        try {
          if (active) setRestorePreviewLoading(true);
          const preview = await previewSupabaseCloudRestore({
            storageSnapshot: localStorage,
            configured: isSupabaseReady,
            user,
            company,
            allowPartialLocalSnapshot: partialLocalSnapshot,
          });
          if (active) setRestorePreview(preview);
        } catch {
          if (active) setRestorePreview(null);
        } finally {
          if (active) setRestorePreviewLoading(false);
        }
      })
      .catch(() => {
        if (active) {
          setOnboardingStatus(null);
          setRestorePreview(null);
          setRestorePreviewLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [isSupabaseReady, user, company, role, refreshToken]);

  const refreshCloudStatus = () => {
    setQueueState(readCloudBackupQueueState());
    setMutationLedger(readCloudMutationLedger());
    setLocalIntegrity(readLocalIntegrity());
    setRefreshToken((value) => value + 1);
  };

  const decision = getCloudDataDecision({
    localIntegrity,
    cloudVerification: onboardingStatus?.verification || null,
    queueState,
    mutationLedger,
    onboardingStatus,
    restorePreview,
    workerRunning,
    restoredRecently,
  });

  const connected = Boolean(isSupabaseReady && user?.id && userEmail && hasCompany && company?.id);
  const productStatus = deriveCloudProductStatus({
    connected,
    deviceLocked: deviceLock.isLocked,
    decision,
    queueState,
    mutationLedger,
    workerRunning,
  });
  const productState = productStatus.state;

  if (deviceLock.isLocked) {
    return {
      isSupabaseReady,
      hasCompany,
      userEmail,
      queueState,
      mutationLedger,
      productState,
      productStatus,
      displayState: "failed",
      chipState: "device_locked",
      chipAction: "device_locked",
      restoredRecently,
      onboardingStatus,
      restorePreview,
      restorePreviewLoading,
      localIntegrity,
      decision,
      refreshCloudStatus,
      deviceLock,
      convergenceResult,
    };
  }

  const displayState = productState === CLOUD_PRODUCT_STATE.SYNCING
      ? "running"
      : productState === CLOUD_PRODUCT_STATE.PENDING
        ? "pending"
        : productState === CLOUD_PRODUCT_STATE.CLOUD_OK || productState === CLOUD_PRODUCT_STATE.CLOUD_CONNECTED
          ? "current"
          : productState === CLOUD_PRODUCT_STATE.SYNC_ISSUE
            ? "failed"
            : "none";

  return {
    isSupabaseReady,
    hasCompany,
    userEmail,
    queueState,
    mutationLedger,
    productState,
    productStatus,
    displayState,
    chipState: decision.chipState,
    chipAction: productStatus.action,
    restoredRecently,
    onboardingStatus,
    restorePreview,
    restorePreviewLoading,
    localIntegrity,
    decision,
    refreshCloudStatus,
    deviceLock,
    convergenceResult,
  };
}
