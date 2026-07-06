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
import { executeSupabaseCloudRestore, CLOUD_RESTORE_STATUS } from "../lib/supabaseCloudRestore";
import { runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } from "../lib/supabaseCloudOnboarding";
import { triggerLocalStorageExportDownload } from "../lib/localStorageExportDownload";
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
  const [recheckState, setRecheckState] = useState("idle");
  const [recheckMessage, setRecheckMessage] = useState("");

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
      setRecheckMessage(
        restoreAvailable
          ? "Recheck complete. Restore is now available on this device."
          : `Recheck complete. ${restoreBlockedReason}`
      );
    }
  }, [checking, recheckState, restoreAvailable, restoreBlockedReason]);

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
  const settingsActionLabel = missingPayloadsBlocked ? "Update Payloads in Settings" : "Manage Restore in Settings";

  const dismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  const requestRestoreConfirmation = () => {
    setConfirmDialog(buildCloudRestoreConfirmationDialog({ partialLocalSnapshot }));
  };

  const recheckRestorePreview = () => {
    setRestoreResult(null);
    setDownloadMessage("");
    setRecheckMessage("");
    setRecheckState("requested");
    refreshCloudStatus();
  };

  const downloadBackupJson = () => {
    try {
      const result = triggerLocalStorageExportDownload({
        storageSnapshot: localStorage,
        BlobConstructor: Blob,
        URLObject: URL,
        documentObject: document,
      });
      setDownloadMessage(`Backup JSON downloaded: ${String(result?.filename || "export")}`);
    } catch {
      setDownloadMessage("Unable to download backup JSON.");
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
      {missingPayloadsBlocked ? (
        <div className="pe-field-helper" style={{ color: "rgba(220,229,238,0.78)" }}>
          This device is empty, so Update Estimate Restore Payloads can only run on the original device that still has the local estimate data. After that repair, return here and recheck cloud status.
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

      {isEmptyDevice ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="pe-btn"
            disabled={restoring || checking || !restoreAvailable}
            onClick={requestRestoreConfirmation}
          >
            {restoring ? "Restoring..." : checking ? "Checking restore..." : "Restore This Device"}
          </button>
          {!restoreAvailable ? (
            <>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={navigateToCloudSettings}
                disabled={restoring || checking}
              >
                {settingsActionLabel}
              </button>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={recheckRestorePreview}
                disabled={restoring || checking}
              >
                {recheckState === "running" || checking ? "Rechecking..." : "Recheck Cloud Status"}
              </button>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={downloadBackupJson}
                disabled={restoring}
              >
                Download Backup JSON
              </button>
            </>
          ) : null}
          <button type="button" className="pe-btn pe-btn-ghost" onClick={dismiss} disabled={restoring}>
            Not now
          </button>
        </div>
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
        onCancel={() => setConfirmDialog(null)}
        onConfirm={confirmRestore}
      />
    </div>
  );
}
