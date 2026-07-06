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

import { useEffect, useState } from "react";
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
  SAFE_CLOUD_RECOVERY_STATUS,
} from "../lib/cloudSafeRecovery";
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

function navigateToCloudSettings() {
  try {
    window.dispatchEvent(new CustomEvent("estipaid:navigate-cloud-settings"));
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

export default function CloudHomeRestorePrompt({ hasChamberedDraft = false, style } = {}) {
  const {
    state,
    company,
    user,
    role,
    isSupabaseReady,
    checking,
    restoreAvailable,
    restoreBlockedReason,
    missingEstimatePayloadCount,
    partialLocalSnapshot,
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

  // A fresh sign-in / device state change should get a fresh chance to show
  // the prompt rather than staying dismissed forever.
  useEffect(() => {
    setRestoreResult(null);
    setBackupResult(null);
    setDownloadMessage("");
    setRecheckState("idle");
    setRecheckMessage("");
  }, [state]);

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
          ? "Recheck complete. Restore is now available."
          : missingCount > 0
            ? `Recheck complete. ${missingCount} ${plural(missingCount, "estimate is", "estimates are")} still missing restore metadata.`
            : "Recheck complete. Cloud data is still not fully restorable."
      );
    }
  }, [checking, recheckState, restoreAvailable, missingEstimatePayloadCount]);

  if (dismissed) return null;
  if (state !== CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE
    && state !== CLOUD_RESTORE_PROMPT_STATE.CLOUD_AVAILABLE_LOCAL_EXISTS) {
    return null;
  }
  // Once restored, the badge's own "Cloud backup restored." message covers
  // the confirmation -- this card has nothing further to say.
  if (restoreResult?.status === CLOUD_RESTORE_STATUS.RESTORED) return null;

  const isEmptyDevice = state === CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE;
  const companyName = String(company?.name || "").trim();
  const missingPayloadsBlocked = isEmptyDevice && !restoreAvailable && Number(missingEstimatePayloadCount || 0) > 0;
  // State C vs D: the payload repair can only run where the original local
  // estimates still exist. On a truly empty device it cannot.
  const repairAvailable = missingPayloadsBlocked && countLocalEstimates() > 0;
  const busy = restoring || checking || safeRecovering || repairing;

  const dismiss = () => {
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
          ? `Cloud backup JSON downloaded: ${filename}. Warning: the cloud has no customer, project, estimate, or invoice records.`
          : `Cloud backup JSON downloaded: ${filename} (${counts.customers} customers, ${counts.projects} projects, ${counts.estimates} estimates, ${counts.invoices} invoices).`
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
          title: "Recover safe cloud records to this device?",
          lines: [
            "Some estimates are missing restore metadata, so EstiPaid cannot safely rebuild editable estimates without risking wrong totals.",
            "EstiPaid can still import safe cloud records that are recoverable.",
            `This will write ${counts.customers} customers, ${counts.projects} projects, ${counts.estimates} estimates, and ${counts.invoices} invoices to this device.`,
            preview.skippedEstimates > 0
              ? `${preview.skippedEstimates} ${plural(preview.skippedEstimates, "estimate", "estimates")} missing restore payload will be skipped, not guessed.`
              : null,
            "Cloud collections with no records are skipped, so they never blank out local data.",
            "Your cloud backup is not changed or deleted.",
          ].filter(Boolean),
          confirmLabel: "Recover Safe Records",
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

  const confirmSafeRecovery = () => {
    setConfirmDialog(null);
    const preview = safeRecoveryPreview;
    setSafeRecoveryPreview(null);
    const result = applySafeCloudRecovery({ preview, storage: localStorage });
    setSafeRecoveryResult(result);
  };

  // Gate 13O-2K State C: run the existing safe payload repair from Home and
  // recheck cloud status automatically afterward -- no Settings trip. The
  // repair writes restore metadata to cloud estimate rows (never totals) and
  // never changes local data, but it is still a cloud write, so it confirms.
  const requestRepairConfirmation = () => {
    setConfirmDialog({
      kind: "repair",
      title: "Repair cloud restore data?",
      lines: [
        "This captures this device's original estimates into your cloud backup so they can be restored faithfully on any device.",
        "It writes restore metadata to your cloud estimate records. Estimate totals and cloud records are not changed or deleted.",
        "Nothing on this device is modified.",
      ],
      confirmLabel: "Repair Restore Data",
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

  const handleDialogConfirm = () => {
    const kind = confirmDialog?.kind;
    if (kind === "safe_recovery") return confirmSafeRecovery();
    if (kind === "repair") return confirmRepair();
    return confirmRestore();
  };

  const handleDialogCancel = () => {
    setConfirmDialog(null);
    setSafeRecoveryPreview(null);
  };

  const runBackup = async () => {
    setBackingUp(true);
    try {
      const result = await runSupabaseCloudOnboardingBackup({
        storageSnapshot: localStorage,
        configured: isSupabaseReady,
        user,
        company,
        role,
      });
      setBackupResult(result);
    } catch (error) {
      setBackupResult({ status: CLOUD_ONBOARDING_STATUS.ERROR, error: error?.message });
    } finally {
      setBackingUp(false);
    }
  };

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
        {isEmptyDevice ? "Cloud backup found" : "Cloud backup available"}
      </div>
      <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "rgba(220,229,238,0.72)" }}>
        {isEmptyDevice ? (
          <>
            Restore your {companyName || "cloud"} workspace to this device.
            <br />
            Includes customers, projects, estimates, invoices, templates, settings, and company profile.
          </>
        ) : (
          "This device has local work. Back up this device before restoring, or manage restore from Settings."
        )}
      </div>

      {isEmptyDevice && restoreResult && restoreResult.status !== CLOUD_RESTORE_STATUS.RESTORED ? (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
          {restoreErrorMessage(restoreResult)}
        </div>
      ) : null}
      {isEmptyDevice && !restoreResult && !checking && !restoreAvailable ? (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
          {restoreBlockedReason}
        </div>
      ) : null}
      {missingPayloadsBlocked && repairAvailable ? (
        <div className="pe-field-helper" style={{ color: "rgba(220,229,238,0.78)" }}>
          This device still has the original estimates, so it can repair the missing cloud restore data directly from here.
        </div>
      ) : null}
      {missingPayloadsBlocked && !repairAvailable ? (
        <div className="pe-field-helper" style={{ color: "rgba(220,229,238,0.78)" }}>
          This device cannot rebuild missing estimate restore data because the original local estimates are not on this device. You can still recover safe cloud records here, or use another device that still has the original estimates to repair full estimate restore data.
        </div>
      ) : null}

      {backupResult ? (
        <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: backupResult.status === CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED
          ? "rgba(187,247,208,0.92)"
          : "rgba(253,224,71,0.92)" }}
        >
          {backupResult.status === CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED
            ? "This device has been backed up to the cloud."
            : "Backup couldn't complete. Try again from Advanced Settings."}
        </div>
      ) : null}
      {recheckMessage ? (
        <div role="status" style={{ fontSize: 12, fontWeight: 700, color: restoreAvailable ? "rgba(187,247,208,0.92)" : "rgba(191,219,254,0.92)" }}>
          {recheckMessage}
        </div>
      ) : null}
      {downloadMessage ? (
        <div role="status" style={{ fontSize: 12, fontWeight: 700, color: "rgba(191,219,254,0.92)" }}>
          {downloadMessage}
        </div>
      ) : null}

      {repairResult ? (
        repairResult.status === ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED ? (
          <div role="status" style={{ fontSize: 12, fontWeight: 700, color: "rgba(187,247,208,0.92)" }}>
            {`Repair complete. Restore data captured for ${Number(repairResult.estimatesUpdated || 0)} ${plural(repairResult.estimatesUpdated, "estimate", "estimates")}. Rechecking cloud status...`}
          </div>
        ) : (
          <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
            {repairResult.status === ESTIMATE_PAYLOAD_UPDATE_STATUS.NO_LOCAL_ESTIMATES
              ? "This device has no local estimates to repair from. Use a device that still has the original estimates."
              : String(repairResult.error || "Unable to repair cloud restore data.")}
          </div>
        )
      ) : null}

      {safeRecoveryResult ? (
        safeRecoveryResult.status === SAFE_CLOUD_RECOVERY_STATUS.RECOVERED ? (
          <>
            <div role="status" style={{ fontSize: 12, fontWeight: 700, color: "rgba(187,247,208,0.92)" }}>
              {`Recovered ${safeRecoveryResult.recoveredCounts.customers} customers, ${safeRecoveryResult.recoveredCounts.projects} projects, ${safeRecoveryResult.recoveredCounts.estimates} estimates, ${safeRecoveryResult.recoveredCounts.invoices} invoices.`}
              {Number(safeRecoveryResult.skippedEstimates || 0) > 0
                ? ` Skipped ${safeRecoveryResult.skippedEstimates} ${plural(safeRecoveryResult.skippedEstimates, "estimate", "estimates")} missing restore payload.`
                : ""}
            </div>
            {Number(safeRecoveryResult.skippedEstimates || 0) > 0 ? (
              <div className="pe-field-helper" style={{ color: "rgba(220,229,238,0.78)" }}>
                To recover the skipped estimates, use a device that still has the original estimates to repair estimate restore data, then restore again.
              </div>
            ) : null}
          </>
        ) : safeRecoveryResult.status === SAFE_CLOUD_RECOVERY_STATUS.NOTHING_TO_RECOVER ? (
          <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
            No recoverable cloud records were found. Nothing was written to this device.
          </div>
        ) : (
          <div role="alert" style={{ fontSize: 12, fontWeight: 700, color: "rgba(253,224,71,0.92)" }}>
            {String(safeRecoveryResult.error || "Safe recovery could not be completed.")}
          </div>
        )
      ) : null}

      {isEmptyDevice ? (
        <>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {/* Gate 13O-2K: exactly one state-driven primary recovery action. */}
            {restoreAvailable ? (
              <button
                type="button"
                className="pe-btn"
                disabled={busy}
                onClick={requestRestoreConfirmation}
              >
                {restoring ? "Restoring..." : checking ? "Checking restore..." : "Restore This Device"}
              </button>
            ) : missingPayloadsBlocked && repairAvailable ? (
              <button
                type="button"
                className="pe-btn"
                disabled={busy}
                onClick={requestRepairConfirmation}
              >
                {repairing ? "Repairing..." : "Repair Cloud Restore Data"}
              </button>
            ) : missingPayloadsBlocked ? (
              <button
                type="button"
                className="pe-btn"
                disabled={busy}
                onClick={requestSafeRecovery}
              >
                {safeRecovering ? "Checking recoverable records..." : "Recover What Can Be Safely Recovered"}
              </button>
            ) : (
              <button
                type="button"
                className="pe-btn"
                disabled={busy}
                onClick={recheckRestorePreview}
              >
                {recheckState === "running" || checking ? "Rechecking..." : "Recheck Cloud Status"}
              </button>
            )}
            {!restoreAvailable ? (
              <>
                {missingPayloadsBlocked ? (
                  <button
                    type="button"
                    className="pe-btn pe-btn-ghost"
                    onClick={recheckRestorePreview}
                    disabled={busy}
                  >
                    {recheckState === "running" || checking ? "Rechecking..." : "Recheck Cloud Status"}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pe-btn pe-btn-ghost"
                  onClick={downloadCloudBackupJson}
                  disabled={busy || downloadingCloudBackup}
                >
                  {downloadingCloudBackup ? "Preparing Cloud Backup..." : "Download Cloud Backup JSON"}
                </button>
              </>
            ) : null}
            <button type="button" className="pe-btn pe-btn-ghost" onClick={dismiss} disabled={restoring}>
              Not now
            </button>
          </div>
          {!restoreAvailable ? (
            <div className="pe-field-helper" style={{ opacity: 0.8 }}>
              Download Cloud Backup JSON downloads an emergency cloud backup file. It does not automatically restore this device.
            </div>
          ) : null}
        </>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button type="button" className="pe-btn" disabled={backingUp} onClick={runBackup}>
            {backingUp ? "Backing up..." : "Back Up This Device"}
          </button>
          <button type="button" className="pe-btn pe-btn-ghost" onClick={navigateToCloudSettings}>
            Manage Restore in Settings
          </button>
          <button type="button" className="pe-btn pe-btn-ghost" onClick={dismiss}>
            Not now
          </button>
        </div>
      )}
      <CloudConfirmDialog
        dialog={confirmDialog}
        onCancel={handleDialogCancel}
        onConfirm={handleDialogConfirm}
      />
    </div>
  );
}
