// @ts-nocheck
/* eslint-disable */

// Gate 13F: a modern, Home-screen cloud recovery prompt so a user signing
// into a fresh/empty device isn't forced through Settings -> Cloud Backup ->
// Restore From Cloud to get their work back. Reuses the existing decision
// hook (useCloudRestorePrompt) and the existing restore/backup functions
// unchanged -- this component only adds presentation. It never silently
// restores or overwrites; the only restore action offered here (empty
// device) still runs through the same safety checks Advanced Settings
// already enforces.
//
// Gate 13F amendment: when local data already exists, Home no longer offers
// a restore action at all -- executeSupabaseCloudRestore always rejects that
// case (LOCAL_NOT_EMPTY) by design, so presenting a "Restore" button there
// was a predictable dead end. That state now only offers the safe action
// (back up this device) plus a route to Advanced Settings for anyone who
// still wants the full manual restore/backup review.

import { useEffect, useRef, useState } from "react";
import useCloudRestorePrompt, { CLOUD_RESTORE_PROMPT_STATE, SHOW_CLOUD_RESTORE_PROMPT_EVENT } from "../lib/useCloudRestorePrompt";
import {
  executeSupabaseCloudRestore,
  exportSupabaseCloudBackupArtifact,
  CLOUD_RESTORE_STATUS,
  CLOUD_BACKUP_EXPORT_STATUS,
} from "../lib/supabaseCloudRestore";
import { runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } from "../lib/supabaseCloudOnboarding";
import { triggerCloudBackupExportDownload } from "../lib/cloudBackupExportDownload";
import {
  previewSafeCloudRecovery,
  applySafeCloudRecovery,
  runRecoveryContinuation,
  describeBackupPauseReason,
  SAFE_CLOUD_RECOVERY_STATUS,
  RECOVERY_CONTINUATION_STATUS,
} from "../lib/cloudSafeRecovery";
import { readCloudPartialRecoveryStatus } from "../lib/cloudPartialRecoveryStatus";
import {
  updateEstimateRestorePayloads,
  ESTIMATE_PAYLOAD_UPDATE_STATUS,
} from "../lib/supabaseEstimateRestorePayload";
import { STORAGE_KEYS } from "../constants/storageKeys";
import CloudConfirmDialog from "./CloudConfirmDialog";
import { buildCloudRestoreConfirmationDialog } from "../lib/cloudRestoreUi";

const DISMISS_KEY = "estipaid-home-restore-prompt-dismissed-v1";

function readDismissed() {
  try {
    return sessionStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed() {
  try {
    sessionStorage.setItem(DISMISS_KEY, "1");
  } catch {}
}

function restoreErrorMessage(result) {
  const status = result?.status;
  if (status === CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY) {
    return "This device already has local data. Restore is blocked to prevent overwriting.";
  }
  if (status === CLOUD_RESTORE_STATUS.NO_CLOUD_DATA) {
    return "No cloud backup data was found to restore.";
  }
  if (status === CLOUD_RESTORE_STATUS.BLOCKED_UNSUPPORTED_SHAPE) {
    return "Some cloud data can't be safely restored yet. Open Advanced Settings for details.";
  }
  return String(result?.error || "Restore could not be completed on this device.");
}

function navigateToEstimates() {
  try {
    window.dispatchEvent(new Event("estipaid:navigate-estimates"));
  } catch {}
}

// Gate 13O-2K: whether the safe estimate-payload repair can run right here.
// The repair captures this device's original local estimates into the cloud
// rows' restore_payload, so it needs local estimates to exist.
function countLocalEstimates() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES) || "[]");
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function plural(count, singular, pluralWord) {
  return Number(count) === 1 ? singular : pluralWord;
}

function isJobLinkIssue(code) {
  const normalized = String(code || "").trim();
  return normalized === "estimate_project_missing" || normalized === "estimate_project_stale";
}

function isGenericBackupPauseStatus(code) {
  const normalized = String(code || "").trim();
  return (
    normalized === ""
    || normalized === "backup_incomplete"
    || normalized === CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION
    || normalized === CLOUD_ONBOARDING_STATUS.ERROR
  );
}

function buildSkippedEstimateCopy(count) {
  const total = Number(count || 0);
  if (total <= 0) return "";
  return `${total} older ${plural(total, "estimate is", "estimates are")} still kept safely in cloud. ${total === 1 ? "It could" : "They could"} not be fully rebuilt on this device.`;
}

function buildSkippedEstimateRepairNote(count) {
  const total = Number(count || 0);
  if (total <= 0) return "";
  return `Use the old device to repair ${total === 1 ? "that estimate" : "those estimates"} if needed.`;
}

function getOldDeviceBackupProtectionLegacyIds(verification) {
  const estimatesResult = (Array.isArray(verification?.tableResults) ? verification.tableResults : [])
    .find((result) => String(result?.table || "").trim() === "estimates");
  return Array.isArray(estimatesResult?.oldDeviceRequiredMissingRestorePayloadLegacyIds)
    ? estimatesResult.oldDeviceRequiredMissingRestorePayloadLegacyIds
    : [];
}

function needsOldDeviceForBackupProtection(verification) {
  if (getOldDeviceBackupProtectionLegacyIds(verification).length > 0) return true;
  return Array.isArray(verification?.notices)
    && verification.notices.some((notice) => String(notice?.code || "").trim() === "estimates_backup_protection_old_device_required");
}

export default function CloudHomeRestorePrompt({ hasChamberedDraft = false, style } = {}) {
  const {
    state,
    company,
    user,
    role,
    isSupabaseReady,
    onboardingStatus,
    checking,
    restoreAvailable,
    missingEstimatePayloadCount,
    partialLocalSnapshot,
    localFirstBlocker,
    localBlockersCount,
    refreshCloudStatus,
  } = useCloudRestorePrompt({ hasChamberedDraft });
  const [dismissed, setDismissed] = useState(readDismissed);
  const [restoring, setRestoring] = useState(false);
  const [restoreResult, setRestoreResult] = useState(null);
  const [backingUp, setBackingUp] = useState(false);
  const [backupResult, setBackupResult] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const [downloadMessage, setDownloadMessage] = useState("");
  const [downloadingCloudBackup, setDownloadingCloudBackup] = useState(false);
  const [recheckState, setRecheckState] = useState("idle");
  const [recheckMessage, setRecheckMessage] = useState("");
  const [safeRecovering, setSafeRecovering] = useState(false);
  const [safeRecoveryPreview, setSafeRecoveryPreview] = useState(null);
  const [safeRecoveryResult, setSafeRecoveryResult] = useState(null);
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState(null);
  const [completedRecoveryStatus, setCompletedRecoveryStatus] = useState(() => readCloudPartialRecoveryStatus(localStorage));
  const confirmActionRunningRef = useRef(false);
  // Gate 13O-2L recovery-assistant pipeline:
  // idle -> recovering -> checking -> repairing -> backing_up -> done
  const [recoveryPhase, setRecoveryPhase] = useState("idle");
  const [continuationResult, setContinuationResult] = useState(null);

  // A fresh sign-in / device state change should get a fresh chance to show
  // the prompt rather than staying dismissed forever.
  useEffect(() => {
    if (recoveryPhase !== "idle" || continuationResult || safeRecoveryResult || completedRecoveryStatus) return;
    setRestoreResult(null);
    setBackupResult(null);
    setDownloadMessage("");
    setRecheckState("idle");
    setRecheckMessage("");
  }, [state, recoveryPhase, continuationResult, safeRecoveryResult, completedRecoveryStatus]);

  // Gate 13G: "Not now" only hides the large card for the session -- it
  // never removes the header's compact restore chip. Tapping that chip
  // dispatches this event so the card reappears without a page reload.
  useEffect(() => {
    const onShowPrompt = () => {
      try { sessionStorage.removeItem(DISMISS_KEY); } catch {}
      setDismissed(false);
    };
    window.addEventListener(SHOW_CLOUD_RESTORE_PROMPT_EVENT, onShowPrompt);
    return () => window.removeEventListener(SHOW_CLOUD_RESTORE_PROMPT_EVENT, onShowPrompt);
  }, []);

  useEffect(() => {
    if (recheckState === "requested" && checking) {
      setRecheckState("running");
      return;
    }
    if (recheckState === "running" && !checking) {
      setRecheckState("idle");
      const missingCount = Number(missingEstimatePayloadCount || 0);
      setRecheckMessage(
        restoreAvailable
          ? "Check complete. Recovery is ready on this device."
          : missingCount > 0
            ? `Check complete. ${buildSkippedEstimateCopy(missingCount)}`
            : "Check complete. Recovery still needs attention."
      );
    }
  }, [checking, recheckState, restoreAvailable, missingEstimatePayloadCount]);

  const keepVisibleForRecoveryFlow = Boolean(
    safeRecoveryResult
    || continuationResult
    || completedRecoveryStatus
    || recoveryPhase !== "idle"
  );

  if (dismissed && !keepVisibleForRecoveryFlow) return null;
  if (
    state !== CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE
    && state !== CLOUD_RESTORE_PROMPT_STATE.CLOUD_AVAILABLE_LOCAL_EXISTS
    && !keepVisibleForRecoveryFlow
  ) {
    return null;
  }
  // Once restored, the badge's own "Cloud backup restored." message covers
  // the confirmation -- this card has nothing further to say.
  if (restoreResult?.status === CLOUD_RESTORE_STATUS.RESTORED && !keepVisibleForRecoveryFlow) return null;

  const isEmptyDevice = state === CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE;
  const companyName = String(company?.name || "").trim();
  const missingPayloadsBlocked = isEmptyDevice && !restoreAvailable && Number(missingEstimatePayloadCount || 0) > 0;
  // State C vs D: the payload repair can only run where the original local
  // estimates still exist. On a truly empty device it cannot.
  const repairAvailable = missingPayloadsBlocked && countLocalEstimates() > 0;
  const busy = restoring || checking || safeRecovering || repairing;
  const currentVerification = backupResult?.verification || onboardingStatus?.verification || null;
  const skippedEstimatesCount = Number(
    (
      completedRecoveryStatus?.skippedEstimateCount
      ?? continuationResult?.recoveryStatus?.skippedEstimateCount
      ?? continuationResult?.skippedEstimates
      ?? safeRecoveryResult?.skippedEstimates
      ?? missingEstimatePayloadCount
    ) || 0
  );
  const olderEstimatesKeptInCloud = Boolean(
    completedRecoveryStatus?.olderEstimatesKeptInCloud
    || continuationResult?.olderEstimatesKeptInCloud
    || continuationResult?.recoveryStatus?.olderEstimatesKeptInCloud
  );
  const continuationPaused = continuationResult?.status === RECOVERY_CONTINUATION_STATUS.PAUSED;
  const continuationSucceeded = continuationResult?.status === RECOVERY_CONTINUATION_STATUS.BACKED_UP
    || continuationResult?.status === RECOVERY_CONTINUATION_STATUS.BACKED_UP_WITH_SKIPPED;
  const continuationSucceededWithOlderEstimates = continuationResult?.status === RECOVERY_CONTINUATION_STATUS.BACKED_UP_WITH_SKIPPED
    && skippedEstimatesCount > 0;
  const onboardingStatusCode = String(onboardingStatus?.status || "").trim();
  const backupCompletedWithPreservedSkippedEstimates = backupResult?.status === CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED
    && olderEstimatesKeptInCloud
    && skippedEstimatesCount > 0;
  const storedCompletedRecoveryWithPreservedSkippedEstimates = Boolean(
    completedRecoveryStatus?.olderEstimatesKeptInCloud
    && skippedEstimatesCount > 0
  );
  const cloudVerifiedWithPreservedSkippedEstimates = (
    onboardingStatusCode === CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP
    || onboardingStatusCode === CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED
  ) && olderEstimatesKeptInCloud
    && skippedEstimatesCount > 0;
  const showRecoveryFinishedState = Boolean(
    storedCompletedRecoveryWithPreservedSkippedEstimates
    || continuationSucceededWithOlderEstimates
    || backupCompletedWithPreservedSkippedEstimates
    || cloudVerifiedWithPreservedSkippedEstimates
  );
  const recoveryBusy = recoveryPhase === "recovering" || recoveryPhase === "checking" || recoveryPhase === "repairing";
  const backupBusy = recoveryPhase === "backing_up";
  const localBackupBlocked = !isEmptyDevice && Number(localBlockersCount || 0) > 0;
  const localPausedReasonCode = String(localFirstBlocker?.code || "");
  const localPausedReason = localFirstBlocker ? describeBackupPauseReason(localFirstBlocker) : "";
  const preferLocalPausedReason = continuationPaused
    && localBackupBlocked
    && isGenericBackupPauseStatus(continuationResult?.pausedReasonCode);
  const pausedReasonCode = String(
    (preferLocalPausedReason ? localPausedReasonCode : continuationResult?.pausedReasonCode)
    || localPausedReasonCode
    || ""
  );
  const pausedReason = (
    preferLocalPausedReason ? localPausedReason : continuationResult?.pausedReason
  ) || localPausedReason;
  const pausedMessage = pausedReason || "Backup is paused because some records need attention.";
  const backupPausedForJobLinks = isJobLinkIssue(pausedReasonCode);
  const oldDeviceBackupProtectionNeeded = !isEmptyDevice
    && !olderEstimatesKeptInCloud
    && needsOldDeviceForBackupProtection(currentVerification);

  const dismiss = () => {
    setContinuationResult(null);
    setSafeRecoveryResult(null);
    setCompletedRecoveryStatus(null);
    writeDismissed();
    setDismissed(true);
  };

  const requestRestoreConfirmation = () => {
    setConfirmDialog({ kind: "restore", ...buildCloudRestoreConfirmationDialog({ partialLocalSnapshot }) });
  };

  const recheckRestorePreview = () => {
    setRestoreResult(null);
    setDownloadMessage("");
    setRecheckMessage("");
    setRecheckState("requested");
    refreshCloudStatus();
  };

  // Gate 13O-2J: this prompt only ever appears in cloud recovery states, so
  // the only backup JSON it may offer is the CLOUD one. It previously
  // exported this device's localStorage here -- on a freshly-cleared device
  // that produced an empty "backup" that imported as 0 records. The cloud
  // export fails loudly (with the failing table) rather than downloading a
  // silently empty artifact.
  const downloadCloudBackupJson = async () => {
    setDownloadingCloudBackup(true);
    try {
      const exportResult = await exportSupabaseCloudBackupArtifact({
        configured: isSupabaseReady,
        user,
        company,
      });
      if (exportResult.status !== CLOUD_BACKUP_EXPORT_STATUS.EXPORTED || !exportResult.artifact) {
        setDownloadMessage(String(exportResult.error || "Unable to download cloud backup JSON."));
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
      setDownloadMessage(
        coreTotal === 0
          ? `Emergency backup file downloaded: ${filename}. Warning: no customer, job, estimate, or invoice records were found in cloud backup.`
          : `Emergency backup file downloaded: ${filename}.`
      );
    } catch (error) {
      setDownloadMessage(String(error?.message || "Unable to download cloud backup JSON."));
    } finally {
      setDownloadingCloudBackup(false);
    }
  };

  // Gate 13O-2K State B/D: one-click safe recovery straight from the cloud.
  // Phase A (here) is read-only -- it fetches cloud records and opens a
  // confirmation with the exact counts. Phase B (confirmSafeRecovery) writes
  // only after the user confirms. No JSON download/import round trip.
  const requestSafeRecovery = async () => {
    setSafeRecovering(true);
    setSafeRecoveryResult(null);
    setContinuationResult(null);
    setDownloadMessage("");
    setRecheckMessage("");
    try {
      const preview = await previewSafeCloudRecovery({
        configured: isSupabaseReady,
        user,
        company,
      });
      if (preview.status === SAFE_CLOUD_RECOVERY_STATUS.PREVIEWED) {
        const counts = preview.counts;
        setSafeRecoveryPreview(preview);
        setConfirmDialog({
          kind: "safe_recovery",
          title: "Finish recovery on this device?",
          lines: [
            "EstiPaid can finish recovering the records that are safe to bring back on this device.",
            `This will recover ${counts.customers} customers, ${counts.projects} jobs, ${counts.estimates} estimates, and ${counts.invoices} invoices.`,
            preview.skippedEstimates > 0
              ? `${preview.skippedEstimates} ${plural(preview.skippedEstimates, "estimate", "estimates")} cannot be fully rebuilt for editing and will be left out for now.`
              : null,
            "Nothing will be guessed or overwritten in cloud backup.",
          ].filter(Boolean),
          confirmLabel: "Finish Recovery",
        });
      } else if (preview.status === SAFE_CLOUD_RECOVERY_STATUS.NOTHING_TO_RECOVER) {
        setSafeRecoveryResult(preview);
      } else {
        setSafeRecoveryResult({
          status: SAFE_CLOUD_RECOVERY_STATUS.ERROR,
          error: String(preview.error || "Safe recovery could not read cloud data."),
        });
      }
    } catch (error) {
      setSafeRecoveryResult({
        status: SAFE_CLOUD_RECOVERY_STATUS.ERROR,
        error: String(error?.message || "Safe recovery could not read cloud data."),
      });
    } finally {
      setSafeRecovering(false);
    }
  };

  const confirmSafeRecovery = async () => {
    setConfirmDialog(null);
    const preview = safeRecoveryPreview;
    setSafeRecoveryPreview(null);
    if (!preview) return;
    setRecoveryPhase("recovering");
    try {
      const result = applySafeCloudRecovery({ preview, storage: localStorage });
      setSafeRecoveryResult(result);
      refreshCloudStatus();
      if (result?.status === SAFE_CLOUD_RECOVERY_STATUS.RECOVERED) {
        try {
          const continuation = await runRecoveryContinuation({
            configured: isSupabaseReady,
            user,
            company,
            role,
            storage: localStorage,
            skippedEstimates: Number(result?.skippedEstimates || 0),
            skippedEstimateLegacyIds: Array.isArray(result?.skippedEstimateLegacyIds)
              ? result.skippedEstimateLegacyIds
              : [],
            onPhase: (phase) => setRecoveryPhase(phase),
          });
          setContinuationResult(continuation);
          setCompletedRecoveryStatus(readCloudPartialRecoveryStatus(localStorage));
          setRecoveryPhase("done");
          refreshCloudStatus();
          return;
        } catch (error) {
          setContinuationResult({
            status: RECOVERY_CONTINUATION_STATUS.ERROR,
            error: "Recovery could not continue right now.",
            technicalDetail: String(error?.message || ""),
          });
          setRecoveryPhase("idle");
          return;
        }
      }
      setRecoveryPhase("idle");
    } catch (error) {
      setSafeRecoveryResult({
        status: SAFE_CLOUD_RECOVERY_STATUS.ERROR,
        error: String(error?.message || "Safe recovery could not finish right now."),
      });
      setRecoveryPhase("idle");
      refreshCloudStatus();
      return;
    }
    setRecoveryPhase("idle");
  };

  // Gate 13O-2K State C: run the existing safe payload repair from Home and
  // recheck cloud status automatically afterward -- no Settings trip. The
  // repair writes restore metadata to cloud estimate rows (never totals) and
  // never changes local data, but it is still a cloud write, so it confirms.
  const requestRepairConfirmation = () => {
    setConfirmDialog({
      kind: "repair",
      title: "Repair missing estimate details?",
      lines: [
        "This uses the original estimate details on this device to repair missing estimate details in cloud backup.",
        "Estimate totals are not changed.",
        "Nothing on this device will be deleted.",
      ],
      confirmLabel: "Repair Estimate Details",
    });
  };

  const confirmRepair = async () => {
    setConfirmDialog(null);
    setRepairing(true);
    setRepairResult(null);
    try {
      const result = await updateEstimateRestorePayloads({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
      });
      setRepairResult(result);
      if (result?.status === ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED) {
        // Automatic recheck: if the repair unblocked restore, the card's
        // primary action flips to "Restore This Device" on its own.
        setRecheckState("requested");
        refreshCloudStatus();
      }
    } catch (error) {
      setRepairResult({
        status: ESTIMATE_PAYLOAD_UPDATE_STATUS.ERROR,
        error: String(error?.message || "Unable to repair cloud restore data."),
      });
    } finally {
      setRepairing(false);
    }
  };

  const retryRecoveryContinuation = async () => {
    setContinuationResult(null);
    setBackupResult(null);
    setRecheckMessage("");
    setRecoveryPhase("checking");
    try {
      const continuation = await runRecoveryContinuation({
        configured: isSupabaseReady,
        user,
        company,
        role,
        storage: localStorage,
        skippedEstimates: skippedEstimatesCount,
        skippedEstimateLegacyIds: Array.isArray(completedRecoveryStatus?.skippedEstimateIds)
          ? completedRecoveryStatus.skippedEstimateIds
          : Array.isArray(continuationResult?.recoveryStatus?.skippedEstimateIds)
            ? continuationResult.recoveryStatus.skippedEstimateIds
            : [],
        onPhase: (phase) => setRecoveryPhase(phase),
      });
      setContinuationResult(continuation);
      setCompletedRecoveryStatus(readCloudPartialRecoveryStatus(localStorage));
      setRecoveryPhase("done");
      refreshCloudStatus();
    } catch (error) {
      setContinuationResult({
        status: RECOVERY_CONTINUATION_STATUS.ERROR,
        error: "Recovery could not continue right now.",
        technicalDetail: String(error?.message || ""),
      });
      setRecoveryPhase("idle");
    }
  };

  const runRestore = async () => {
    setRestoring(true);
    try {
      const result = await executeSupabaseCloudRestore({
        storage: localStorage,
        configured: isSupabaseReady,
        user,
        company,
      });
      setRestoreResult(result);
    } catch (error) {
      setRestoreResult({ status: CLOUD_RESTORE_STATUS.ERROR, error: error?.message });
    } finally {
      setRestoring(false);
    }
  };

  const confirmRestore = async () => {
    setConfirmDialog(null);
    await runRestore();
  };

  const handleDialogConfirm = async () => {
    if (confirmActionRunningRef.current) return;
    confirmActionRunningRef.current = true;
    const kind = confirmDialog?.kind;
    try {
      if (kind === "safe_recovery") {
        await confirmSafeRecovery();
        return;
      }
      if (kind === "repair") {
        await confirmRepair();
        return;
      }
      await confirmRestore();
    } finally {
      confirmActionRunningRef.current = false;
    }
  };

  const handleDialogCancel = () => {
    setConfirmDialog(null);
    setSafeRecoveryPreview(null);
  };

  const runBackup = async () => {
    setBackingUp(true);
    setContinuationResult(null);
    try {
      const storedRecoveryStatus = readCloudPartialRecoveryStatus(localStorage);
      const result = await runSupabaseCloudOnboardingBackup({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role,
        preservedSkippedEstimateLegacyIds: Array.isArray(storedRecoveryStatus?.skippedEstimateIds)
          ? storedRecoveryStatus.skippedEstimateIds
          : [],
      });
      setBackupResult(result);
      setCompletedRecoveryStatus(readCloudPartialRecoveryStatus(localStorage));
      refreshCloudStatus();
    } catch (error) {
      setBackupResult({ status: CLOUD_ONBOARDING_STATUS.ERROR, error: error?.message });
    } finally {
      setBackingUp(false);
    }
  };

  const heading = showRecoveryFinishedState
    ? "Recovery finished."
    : oldDeviceBackupProtectionNeeded
      ? "Backup needs old device."
    : continuationSucceeded || continuationPaused || recoveryBusy || backupBusy
      ? "Recovery Assistant"
    : isEmptyDevice
      ? "Recovery Available"
      : "Backup Available";

  let bodyCopy = isEmptyDevice
    ? `Recover your ${companyName || "cloud"} records on this device.`
    : "This device has recovered work that may need to be backed up.";

  if (recoveryBusy) {
    bodyCopy = "Recovering customers, jobs, estimates, and invoices.";
  } else if (backupBusy) {
    bodyCopy = "Recovery finished. Backing up recovered data to cloud.";
  } else if (showRecoveryFinishedState) {
    bodyCopy = "Your data is back on this device.";
  } else if (oldDeviceBackupProtectionNeeded) {
    bodyCopy = "Some older estimates need the original device to finish backup protection.";
  } else if (continuationSucceeded) {
    bodyCopy = "Recovery finished. Your data is backed up.";
  } else if (continuationPaused) {
    bodyCopy = "Recovery finished, but backup is paused.";
  } else if (missingPayloadsBlocked) {
    bodyCopy = "Most of your data can still be recovered safely on this device.";
  } else if (localBackupBlocked) {
    bodyCopy = "Backup is paused until recovered records are fixed.";
  }

  const secondaryStatus = showRecoveryFinishedState
      ? buildSkippedEstimateCopy(skippedEstimatesCount)
      : continuationSucceeded && skippedEstimatesCount > 0
      ? buildSkippedEstimateCopy(skippedEstimatesCount)
      : missingPayloadsBlocked
        ? buildSkippedEstimateCopy(missingEstimatePayloadCount)
        : "";

  const showTechnicalDetails = Boolean(
    continuationResult?.technicalDetail
    || continuationResult?.pausedReasonCode
    || repairResult?.error
    || safeRecoveryResult?.error
  );

  let primaryAction = {
    id: "dismiss",
    label: "Not now",
    onClick: dismiss,
    disabled: false,
  };

  if (recoveryBusy) {
    primaryAction = { id: "recovering", label: "Recovering your data...", onClick: null, disabled: true };
  } else if (backupBusy) {
    primaryAction = { id: "backing_up", label: "Backing up...", onClick: null, disabled: true };
  } else if (showRecoveryFinishedState) {
    primaryAction = { id: "done", label: "Done", onClick: dismiss, disabled: false };
  } else if (oldDeviceBackupProtectionNeeded) {
    primaryAction = { id: "dismiss", label: "Not now", onClick: dismiss, disabled: false };
  } else if (continuationSucceeded) {
    primaryAction = { id: "done", label: "Done", onClick: dismiss, disabled: false };
  } else if (continuationPaused && backupPausedForJobLinks) {
    primaryAction = { id: "fix_job_links", label: "Fix Estimate Job Links", onClick: navigateToEstimates, disabled: false };
  } else if (continuationPaused) {
    primaryAction = { id: "retry_continuation", label: "Try Again", onClick: retryRecoveryContinuation, disabled: false };
  } else if (isEmptyDevice && restoreAvailable) {
    primaryAction = { id: "finish_recovery", label: "Finish Recovery", onClick: requestRestoreConfirmation, disabled: busy };
  } else if (missingPayloadsBlocked && repairAvailable) {
    primaryAction = { id: "repair_missing_estimate_details", label: "Repair Missing Estimate Details", onClick: requestRepairConfirmation, disabled: busy };
  } else if (missingPayloadsBlocked) {
    primaryAction = { id: "finish_safe_recovery", label: "Finish Recovery", onClick: requestSafeRecovery, disabled: busy };
  } else if (!isEmptyDevice && !localBackupBlocked) {
    primaryAction = { id: "back_up_now", label: backingUp ? "Backing up..." : "Back Up Now", onClick: runBackup, disabled: backingUp };
  } else if (!isEmptyDevice && backupPausedForJobLinks) {
    primaryAction = { id: "fix_job_links", label: "Fix Estimate Job Links", onClick: navigateToEstimates, disabled: false };
  } else if (!isEmptyDevice) {
    primaryAction = { id: "recheck_restore_preview", label: "Try Again", onClick: recheckRestorePreview, disabled: busy };
  } else {
    primaryAction = {
      id: "recheck_restore_preview",
      label: recheckState === "running" || checking ? "Checking..." : "Check Again",
      onClick: recheckRestorePreview,
      disabled: busy,
    };
  }

  const actions = [];
  const addAction = (action, className) => {
    if (!action?.id) return;
    if (actions.some((entry) => entry.id === action.id)) return;
    actions.push({ ...action, className });
  };

  addAction(primaryAction, "pe-btn");

  const showRetryAction = !showRecoveryFinishedState && (
    missingPayloadsBlocked
    || (isEmptyDevice && !restoreAvailable)
    || continuationPaused
    || localBackupBlocked
  ) && primaryAction.id !== "retry_continuation"
    && primaryAction.id !== "recheck_restore_preview"
    && primaryAction.id !== "fix_job_links";

  if (showRetryAction) {
    addAction({
      id: continuationPaused ? "retry_continuation" : "recheck_restore_preview",
      label: backupBusy || recoveryBusy || recheckState === "running" || checking ? "Checking..." : "Try Again",
      onClick: continuationPaused ? retryRecoveryContinuation : recheckRestorePreview,
      disabled: busy || backupBusy || recoveryBusy || checking,
    }, "pe-btn pe-btn-ghost");
  }

  if (showRecoveryFinishedState || continuationPaused || localBackupBlocked || missingPayloadsBlocked || oldDeviceBackupProtectionNeeded || (isEmptyDevice && !restoreAvailable)) {
    addAction({
      id: "download_emergency_backup_file",
      label: downloadingCloudBackup ? "Preparing file..." : "Download Emergency Backup File",
      onClick: downloadCloudBackupJson,
      disabled: busy || downloadingCloudBackup,
    }, "pe-btn pe-btn-ghost");
  }

  if (!continuationSucceeded && !showRecoveryFinishedState) {
    addAction({
      id: "dismiss",
      label: "Not now",
      onClick: dismiss,
      disabled: busy,
    }, "pe-btn pe-btn-ghost");
  }

  return (
    <div
      className="pe-card"
      data-testid="cloud-home-restore-prompt"
      style={{
        display: "grid",
        gap: 8,
        padding: "14px 16px",
        borderColor: "rgba(99,179,237,0.24)",
        ...style,
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 800, color: "rgba(230,241,248,0.96)" }}>
        {heading}
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "rgba(220,229,238,0.72)" }}>
        {bodyCopy}
      </div>

      {continuationPaused || localBackupBlocked ? (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
          {pausedMessage}
        </div>
      ) : null}
      {secondaryStatus ? (
        <div className="pe-field-helper" style={{ color: "rgba(220,229,238,0.78)" }}>
          {secondaryStatus}
        </div>
      ) : null}
      {showRecoveryFinishedState ? (
        <div className="pe-field-helper" style={{ color: "rgba(220,229,238,0.78)" }}>
          {buildSkippedEstimateRepairNote(skippedEstimatesCount)}
        </div>
      ) : null}
      {missingPayloadsBlocked && repairAvailable && !continuationPaused && !continuationSucceeded ? (
        <div className="pe-field-helper" style={{ color: "rgba(220,229,238,0.78)" }}>
          This device still has the original estimate details, so it can repair the missing cloud estimate details directly from here.
        </div>
      ) : null}
      {missingPayloadsBlocked && !repairAvailable && !continuationPaused && !continuationSucceeded ? (
        <div className="pe-field-helper" style={{ color: "rgba(220,229,238,0.78)" }}>
          If you still have the old device, you can use it later to repair the missing estimate details for editing.
        </div>
      ) : null}

      {isEmptyDevice && restoreResult && restoreResult.status !== CLOUD_RESTORE_STATUS.RESTORED ? (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
          {restoreErrorMessage(restoreResult)}
        </div>
      ) : null}
      {backupResult && !showRecoveryFinishedState ? (
        <div role="status" style={{ fontSize: 12, fontWeight: 700, color: backupResult.status === CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED
          ? "rgba(187,247,208,0.92)"
          : "rgba(253,224,71,0.92)" }}
        >
          {backupResult.status === CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED
            ? "Backup finished. Your data is backed up."
            : oldDeviceBackupProtectionNeeded
              ? "Some older estimates need the original device to finish backup protection."
            : "Backup is paused because some records need attention."}
        </div>
      ) : null}
      {recheckMessage ? (
        <div role="status" style={{ fontSize: 12, fontWeight: 700, color: "rgba(191,219,254,0.92)" }}>
          {recheckMessage}
        </div>
      ) : null}
      {downloadMessage ? (
        <div role="status" style={{ fontSize: 12, fontWeight: 700, color: "rgba(191,219,254,0.92)" }}>
          {downloadMessage}
        </div>
      ) : null}
      {repairResult?.status === ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED ? (
        <div role="status" style={{ fontSize: 12, fontWeight: 700, color: "rgba(187,247,208,0.92)" }}>
          {`Estimate details repaired for ${Number(repairResult.estimatesUpdated || 0)} ${plural(repairResult.estimatesUpdated, "estimate", "estimates")}. Checking again...`}
        </div>
      ) : null}
      {repairResult && repairResult.status !== ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED ? (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
          {repairResult.status === ESTIMATE_PAYLOAD_UPDATE_STATUS.NO_LOCAL_ESTIMATES
            ? "This device does not have the original estimate details needed for that repair."
            : "Estimate details could not be repaired right now."}
        </div>
      ) : null}
      {safeRecoveryResult?.status === SAFE_CLOUD_RECOVERY_STATUS.NOTHING_TO_RECOVER ? (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
          No recoverable records were found in cloud backup.
        </div>
      ) : null}
      {safeRecoveryResult?.status === SAFE_CLOUD_RECOVERY_STATUS.ERROR ? (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
          {String(safeRecoveryResult.error || "Recovery could not be completed.")}
        </div>
      ) : null}
      {continuationResult?.status === RECOVERY_CONTINUATION_STATUS.ERROR ? (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
          {String(continuationResult.error || "Recovery could not continue right now.")}
        </div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {actions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={action.className}
            disabled={action.disabled}
            onClick={action.onClick || undefined}
          >
            {action.label}
          </button>
        ))}
      </div>
      {(showRecoveryFinishedState || continuationPaused || localBackupBlocked || missingPayloadsBlocked || oldDeviceBackupProtectionNeeded || (isEmptyDevice && !restoreAvailable)) ? (
        <div className="pe-field-helper" style={{ opacity: 0.8 }}>
          Downloads an emergency backup file. It does not automatically restore or back up your account.
        </div>
      ) : null}
      {showTechnicalDetails ? (
        <details style={{ opacity: 0.86 }}>
          <summary className="pe-field-helper" style={{ cursor: "pointer" }}>Technical details</summary>
          <div className="pe-field-helper" style={{ marginTop: 6 }}>
            {String(
              continuationResult?.technicalDetail
              || repairResult?.error
              || safeRecoveryResult?.error
              || ""
            )}
          </div>
        </details>
      ) : null}
      <CloudConfirmDialog
        dialog={confirmDialog}
        onCancel={handleDialogCancel}
        onConfirm={handleDialogConfirm}
      />
    </div>
  );
}
