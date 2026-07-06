// @ts-nocheck
/* eslint-disable */

// Gate 13F: decides whether Home should show a modern cloud-restore prompt,
// so users don't have to dig into Advanced Settings to recover a fresh
// device. This is a *decision* helper only -- it reuses the existing
// onboarding check (Gate 9/10's checkSupabaseCloudOnboardingStatus) and the
// Gate 13A/13D queue signal (via useCloudBackupStatus) rather than
// duplicating any restore/backup/diff logic. It never writes anything.
//
// Product rule: automatic *check*, never automatic *overwrite*. This hook
// only ever recommends a state; the caller decides what UI (if any) to show
// and always requires an explicit user tap to actually restore.

import { useEffect, useState } from "react";
import useSupabaseAuth from "./useSupabaseAuth";
import useSupabaseAccount from "./useSupabaseAccount";
import useCloudBackupStatus from "./useCloudBackupStatus";
import { CLOUD_ONBOARDING_STATUS } from "./supabaseCloudOnboarding";
import { LOCAL_DATA_DECISION } from "./localDataIntegrity";
import { getCloudRestoreAvailability } from "./cloudRestoreUi";

// Gate 13G: dispatched by the header's compact restore chip (and anything
// else that wants to bring the Home restore card back after "Not now"
// dismissed it for the session). CloudHomeRestorePrompt listens for this to
// clear its session dismissal; the app shell listens for it to navigate Home
// so the card is actually visible when it reappears.
export const SHOW_CLOUD_RESTORE_PROMPT_EVENT = "estipaid:show-cloud-restore-prompt";

export const CLOUD_RESTORE_PROMPT_STATE = {
  HIDDEN: "hidden",
  // Cloud has data and this device's core records (customers/projects/
  // estimates/invoices) are empty -- friendly, low-risk restore.
  CLOUD_FOUND_EMPTY_DEVICE: "cloud_found_empty_device",
  // Cloud has data but this device also has real local work (saved records
  // or a chambered draft) -- cautious copy, restore requires confirmation.
  CLOUD_AVAILABLE_LOCAL_EXISTS: "cloud_available_local_exists",
  // This device has changes that have not been backed up yet. Never push a
  // restore recommendation while that's true, regardless of what the cloud
  // comparison shows -- the existing backup status already speaks for this.
  LOCAL_PENDING_BACKUP: "local_pending_backup",
  // The onboarding check itself could not confirm a clean state (error, or
  // an in-flight write issue). Nothing actionable to recommend here.
  NEEDS_ATTENTION: "needs_attention",
};

// hasChamberedDraft: pass Home's existing `Boolean(liveDraftResume)` -- an
// unsaved-but-in-progress estimate/invoice draft counts as real local work
// even when there are zero *saved* records yet, so an empty-device restore
// recommendation would be unsafe.
export default function useCloudRestorePrompt({ hasChamberedDraft = false } = {}) {
  const { configured: isSupabaseReady, user, userEmail } = useSupabaseAuth();
  const { company, role, hasCompany } = useSupabaseAccount({ configured: isSupabaseReady, user });
  const {
    queueState,
    onboardingStatus,
    restorePreview,
    restorePreviewLoading,
    decision,
    refreshCloudStatus,
  } = useCloudBackupStatus();

  let state = CLOUD_RESTORE_PROMPT_STATE.HIDDEN;
  const status = onboardingStatus?.status;
  const partialLocalSnapshot = decision?.screenState === LOCAL_DATA_DECISION.PARTIAL_LOCAL_DATA;
  const restoreAvailability = getCloudRestoreAvailability({
    restorePreview,
    partialLocalSnapshot,
  });

  if (isSupabaseReady && userEmail && hasCompany && status) {
    if (queueState.pending) {
      state = CLOUD_RESTORE_PROMPT_STATE.LOCAL_PENDING_BACKUP;
    } else if (status === CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE) {
      state = hasChamberedDraft
        ? CLOUD_RESTORE_PROMPT_STATE.CLOUD_AVAILABLE_LOCAL_EXISTS
        : CLOUD_RESTORE_PROMPT_STATE.CLOUD_FOUND_EMPTY_DEVICE;
    } else if (status === CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH) {
      state = CLOUD_RESTORE_PROMPT_STATE.CLOUD_AVAILABLE_LOCAL_EXISTS;
    } else if (
      status === CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION
      || status === CLOUD_ONBOARDING_STATUS.ERROR
    ) {
      state = CLOUD_RESTORE_PROMPT_STATE.NEEDS_ATTENTION;
    }
    // NO_LOCAL_DATA, READY_TO_BACKUP, ALREADY_BACKED_UP, BACKUP_COMPLETED
    // all fall through to HIDDEN -- nothing meaningful to restore, or local
    // and cloud already match.
  }

  return {
    state,
    checking: restorePreviewLoading,
    isSupabaseReady,
    hasCompany,
    userEmail,
    user,
    company,
    role,
    onboardingStatus,
    restorePreview,
    restoreAvailable: restoreAvailability.available,
    restoreBlockedReason: restoreAvailability.blockedReason,
    missingEstimatePayloadCount: restoreAvailability.missingEstimatePayloadCount,
    partialLocalSnapshot,
    refreshCloudStatus,
  };
}
