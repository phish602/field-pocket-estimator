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
import useSupabaseAuth from "./useSupabaseAuth";
import useSupabaseAccount from "./useSupabaseAccount";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  buildLocalSnapshotFromStorage,
  getCloudDataDecision,
  scanLocalDataIntegrity,
} from "./localDataIntegrity";

export const CLOUD_BACKUP_RESTORE_BANNER_DURATION_MS = 6000;

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
  const [queueState, setQueueState] = useState(() => readCloudBackupQueueState());
  const [workerRunning, setWorkerRunning] = useState(false);
  const [restoredRecently, setRestoredRecently] = useState(isRestoreRecent);
  const [localIntegrity, setLocalIntegrity] = useState(readLocalIntegrity);
  const [onboardingStatus, setOnboardingStatus] = useState(null);
  const [restorePreview, setRestorePreview] = useState(null);
  const [restorePreviewLoading, setRestorePreviewLoading] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    const refresh = () => {
      setQueueState(readCloudBackupQueueState());
      setLocalIntegrity(readLocalIntegrity());
    };

    const onStorageEvent = (event) => {
      const key = event?.detail?.key;
      if (
        key
        && key !== STORAGE_KEYS.CLOUD_BACKUP_QUEUE
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

    refresh();

    if (isRestoreRecent()) {
      armRestoreBannerTimer(CLOUD_BACKUP_RESTORE_BANNER_DURATION_MS - (Date.now() - getLastCloudRestoreCompleteAt()));
    }

    try {
      window.addEventListener("pe-localstorage", onStorageEvent);
      window.addEventListener(CLOUD_AUTO_BACKUP_RUNNING_EVENT, onWorkerRunningEvent);
      window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onRestoreComplete);
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
    setLocalIntegrity(readLocalIntegrity());
    setRefreshToken((value) => value + 1);
  };

  const decision = getCloudDataDecision({
    localIntegrity,
    cloudVerification: onboardingStatus?.verification || null,
    queueState,
    onboardingStatus,
    restorePreview,
    workerRunning,
    restoredRecently,
  });

  const displayState = decision.chipState === "restored"
    ? "current"
    : decision.chipState === "backup_running"
      ? "running"
      : decision.chipState === "backup_pending"
        ? "pending"
        : decision.chipState === "cloud_verified_current"
          ? "current"
          : decision.chipState === "backup_failed" || decision.chipState === "local_cloud_mismatch"
            ? "failed"
            : "none";

  return {
    isSupabaseReady,
    hasCompany,
    userEmail,
    queueState,
    displayState,
    chipState: decision.chipState,
    chipAction: decision.chipAction,
    restoredRecently,
    onboardingStatus,
    restorePreview,
    restorePreviewLoading,
    localIntegrity,
    decision,
    refreshCloudStatus,
  };
}
