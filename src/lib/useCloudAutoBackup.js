// @ts-nocheck
/* eslint-disable */

// Gate 13B: turns the Gate 13A cloud-backup dirty queue into a real
// automatic background backup worker.
//
// Important product rule: this is automatic cloud backup, not two-way sync.
// This hook never restores from cloud, never overwrites local data, and
// never changes the backup payload schema -- it only decides *when* to call
// the existing manual-backup orchestration (runSupabaseCloudOnboardingBackup)
// on the user's behalf, in the background, without blocking any local save.

import { useEffect, useRef, useState } from "react";
import {
  isCloudAutoBackupPaused,
  readCloudBackupQueueState,
  markCloudBackupSyncing,
  markCloudBackupOfflinePending,
  recordCloudBackupAttemptFailure,
  applyCloudBackupResultToQueue,
  isCloudBootstrapQueue,
  markCloudBootstrapPending,
  CLOUD_BACKUP_PRIORITY,
} from "./cloudBackupQueue";
import { tryAcquireCloudOperationRunLock, releaseCloudOperationRunLock } from "./cloudOperationRunLock";
import { CLOUD_OPERATION_OWNER, resolveOperationOwnerFromSnapshot } from "./cloudOperationOwnership";
import { buildLocalSnapshotFromStorage } from "./localDataIntegrity";
import {
  checkSupabaseCloudOnboardingStatus,
  CLOUD_ONBOARDING_STATUS,
  runSupabaseCloudOnboardingBackup,
} from "./supabaseCloudOnboarding";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { getOrCreateLocalDeviceId } from "./supabaseDeviceLock";
import {
  ensureCurrentDeviceCanApplyLocalRestore,
  ensureCurrentDeviceCanWriteCloud,
  ensureDeviceFenceStillCurrent,
  operationFenceStillCurrent,
} from "./supabaseDeviceLock";
import { readSupabaseCloudConvergenceSnapshot } from "./supabaseCloudRestore";
import { captureVerifiedCloudSyncBaseline } from "./cloudSyncBaseline";
import { updateSupabaseAppRestoreBundle, APP_RESTORE_BUNDLE_STATUS } from "./supabaseAppRestoreBundle";
import {
  acknowledgeCloudMutation,
  CLOUD_MUTATION_AUTO_RECOVERY_COOLDOWN_MS,
  getCloudMutationLedgerSummary,
  getCloudMutationAutomaticRecoveryProof,
  getHistoricalMutationRecoveryContext,
  getNextCloudMutation,
  markCloudMutationSyncing,
  readCloudMutationLedger,
  reconcileSupersededCloudBackupQueueFromAcknowledgedMutations,
  reconcileSupersededParentMissingMutations,
  recordCloudMutationFailure,
  requeueCloudMutationForAutomaticRetry,
  requeueCloudMutationForManualRetry,
} from "./cloudMutationLedger";
import { runSupabaseCloudMutationWrite } from "./supabaseCloudMutationWriter";
import { VAULT_RUNTIME_ERROR_CODES } from "./vaultRuntimeStore";
import { materializeLegacyCompatibilityQueue } from "./cloudLegacyQueueCutover";

// Test-friendly, overridable debounce constants. Immediate covers
// money-critical queue entries (invoices/payments); normal covers
// everything else. A "deferred" priority queue entry never auto-runs.
//
// Gate E2: the NORMAL window is widened to 5s so a burst of ordinary local
// edits (typing, field-by-field saves) collapses into a single backup + verify
// scan instead of one per mutation -- the main non-money-critical egress source.
// Because each pe-localstorage event re-arms the timer (trailing-edge debounce),
// the backup fires once, five seconds after the LAST mutation. The money-critical
// window is deliberately left short so invoice/payment safety is never delayed.
export const CLOUD_AUTO_BACKUP_IMMEDIATE_DELAY_MS = 900;
export const CLOUD_AUTO_BACKUP_NORMAL_DELAY_MS = 5000;
export const CLOUD_AUTO_BACKUP_MAX_RETRY_DELAY_MS = 60000;

export const CLOUD_AUTO_BACKUP_RUNNING_EVENT = "estipaid:cloud-auto-backup-running";
export const CLOUD_AUTO_BACKUP_REQUEST_EVENT = "estipaid:cloud-auto-backup-request";

// Normal-user Retry Sync has one job: make genuinely retryable durable work
// eligible, then wake the already-mounted worker. It never calls Supabase or
// the whole-workspace onboarding writer itself.
export async function requestCloudAutoBackupRun(reason = "manual_retry") {
  const ledgerSummary = getCloudMutationLedgerSummary(readCloudMutationLedger());
  let ledgerRetry = null;
  if (ledgerSummary.failed) {
    ledgerRetry = await requeueCloudMutationForManualRetry(ledgerSummary.failed);
  }
  const queueState = readCloudBackupQueueState();
  const queueRetryable = Boolean(queueState?.pending && isCloudBootstrapQueue(queueState))
    && ["needs_attention", "pending", "offline_pending", "retry_wait", "syncing"].includes(String(queueState?.status || ""));
  const requested = Boolean(ledgerRetry?.ok || queueRetryable);
  if (requested) {
    try {
      window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_REQUEST_EVENT, {
        detail: { reason: String(reason || "manual_retry").trim() || "manual_retry" },
      }));
    } catch {}
  }
  return { requested, ledgerRetry, queueRetryable };
}

function canRunAutomatically({ enabled, configured, user, company, deviceLocked }) {
  return Boolean(
    enabled
    && configured
    && user?.id
    && company?.id
    && !deviceLocked
    && !isCloudAutoBackupPaused()
  );
}

function isEligibleQueueState(queueState) {
  return Boolean(queueState?.pending)
    && isCloudBootstrapQueue(queueState)
    && queueState?.priority !== CLOUD_BACKUP_PRIORITY.DEFERRED
    && !["remote_changed", "conflict"].includes(String(queueState?.status || ""));
}

// Same shared precedence contract convergence and the restore prompt use. A
// pending queue always makes BACKUP the owner, so in practice this only blocks
// the case that must be blocked: a clean, positively-empty core device, where
// recovery owns the next operation and automatic backup must not take the shared
// run lock or write cloud. Eligibility (deferred / conflicted / offline / journal)
// remains this hook's own separate decision, unchanged.
function backupOwnsNextOperation(queueState) {
  try {
    const { snapshot } = buildLocalSnapshotFromStorage(localStorage);
    return resolveOperationOwnerFromSnapshot({ snapshot, queueState, mutationLedger: readCloudMutationLedger() }) === CLOUD_OPERATION_OWNER.BACKUP;
  } catch {
    // An unreadable local snapshot can never prove an empty core, so ownership
    // never falls to recovery; keep the established backup behavior.
    return true;
  }
}

function hasUnresolvedConvergenceJournal() {
  try { return Boolean(localStorage.getItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)); } catch { return true; }
}

function queueIdentity(queueState, companyId) {
  return [
    String(queueState?.companyId || companyId || "").trim(),
    Number(queueState?.localMutationRevision || 0),
    Number(queueState?.createdAt || 0),
    String(queueState?.documentId || "").trim(),
  ].join(":");
}

function delayForPriority(priority, immediateDelayMs, normalDelayMs) {
  return priority === CLOUD_BACKUP_PRIORITY.IMMEDIATE ? immediateDelayMs : normalDelayMs;
}

function isBrowserOnline() {
  try {
    return typeof navigator === "undefined" || navigator.onLine !== false;
  } catch {
    return true;
  }
}

// Two different failures wear the same shape here, and telling them apart is the
// whole point of this worker's error handling.
//
// A CLOUD failure means the targeted Supabase write or its strict reread did not
// succeed. That is durable news about the cloud, and it belongs in the ledger.
//
// A LEDGER-PERSISTENCE failure means the encrypted vault refused to commit the
// ledger transition itself. The vault is fail-closed by design and refuses while
// it is locked, being replaced, or frozen inside another atomic transaction or a
// same-identity revalidation. Recording THAT through the very ledger that just
// refused is what produced the live crash: recordCloudMutationFailure re-entered
// runtimeCommitAtomicRecords, threw NOT_READY again, and the rejection escaped
// the fire-and-forget worker into the React runtime.
//
// runtimeCommitAtomicRecords throws `new Error(CODE)` with no `code` property, so
// the message IS the code. These are matched exactly against the store's own
// exported constants -- never by substring, and never by inventing a code.
// Read from the store's own table at call time, never copied or restated here,
// so this can only ever recognise codes the runtime actually exports.
function temporaryVaultLifecycleCodes() {
  const codes = VAULT_RUNTIME_ERROR_CODES || {};
  return [
    // No session, blocked, or frozen: a deliberate lock, an atomic transaction
    // in flight, or revalidation holding the freeze.
    codes.NOT_READY,
    // The vault is locked; it will accept writes again once unlocked.
    codes.VAULT_LOCKED,
    // The runtime was replaced mid-transaction: session turnover, and nothing
    // durable was written under the old session.
    codes.STALE_SESSION,
  ].filter(Boolean);
}

// Everything else the store can throw -- DURABILITY_FAILED, CONFLICT,
// STORAGE_OPERATION_FAILED, RECORD_*, CATALOG_*, UNSUPPORTED_KEY -- is a REAL
// local durability or safety failure and is never treated as "try again later".
function isTemporaryVaultLifecycleError(error) {
  const message = String(error?.message || "");
  return message !== "" && temporaryVaultLifecycleCodes().includes(message);
}

// The stages a mutation attempt passes through. Only CLOUD_WRITE may produce a
// recorded cloud failure; every other stage is local persistence, and a refusal
// there must never be written back through the same unavailable ledger.
const LEDGER_STAGE = Object.freeze({
  MARK_SYNCING: "mark_syncing",
  CLOUD_WRITE: "cloud_write",
  RECORD_CLOUD_FAILURE: "record_cloud_failure",
  ACKNOWLEDGE: "acknowledge",
  AUTOMATIC_RECOVERY: "automatic_recovery_transition",
});

// Runs ONE ledger transition and converts its outcome into a handled result.
// `deferred` means the vault is temporarily unable to accept the transition:
// nothing durable changed, no retry count moved, and the mutation is left in
// exactly the state it was already in for a later automatic pass to resume.
async function commitLedgerStage(stage, run) {
  try {
    const result = await run();
    return { ok: Boolean(result?.ok), stage, result: result || null, deferred: false, code: String(result?.code || "") };
  } catch (error) {
    const deferred = isTemporaryVaultLifecycleError(error);
    return { ok: false, stage, result: null, deferred, code: String(error?.message || ""), error };
  }
}

function retryDelayMs(retryCount) {
  const exponent = Math.max(0, Math.min(6, Number(retryCount || 0) - 1));
  return Math.min(CLOUD_AUTO_BACKUP_MAX_RETRY_DELAY_MS, 1500 * (2 ** exponent));
}

function nextLedgerWork(ledger = readCloudMutationLedger()) {
  const due = getNextCloudMutation(ledger);
  if (due) return { mutation: due, delay: 0 };
  const waiting = (Array.isArray(ledger?.entries) ? ledger.entries : [])
    .filter((entry) => entry?.status === "retry_wait" && Number(entry?.nextRetryAt || 0) > Date.now())
    .sort((left, right) => Number(left.revision || 0) - Number(right.revision || 0))[0];
  return waiting ? { mutation: null, delay: Number(waiting.nextRetryAt) - Date.now() } : null;
}

async function captureAutomaticBackupBaseline({ result, params, queueGeneration }) {
  if (result?.status !== "backup_completed" || !result?.verification?.ok || !result?.verification?.allMatched) return { ok: true, skipped: true };
  const warnings = Array.isArray(result.verification?.notices) && result.verification.notices.some((notice) => notice?.level === "warning" || notice?.level === "error");
  if (warnings) return { ok: false, code: "verification_requires_attention" };
  const access = await ensureCurrentDeviceCanApplyLocalRestore({ configured: params.configured, user: params.user, company: params.company, storage: localStorage, reason: "backup_baseline_capture" });
  if (!access?.ok) return { ok: false, code: "device_not_active", deviceLockLost: Boolean(access?.deviceLockLost) };
  if (Number(readCloudBackupQueueState()?.localMutationRevision || 0) !== Number(queueGeneration || 0)) return { ok: false, code: "newer_queue_revision" };
  // The generation this capture is authorised under. The convergence read below
  // is a full network scan, and a takeover (or a takeover-and-return, which
  // leaves this device "active" again under a NEWER generation) can complete
  // inside it. A baseline is a durable claim that local equals cloud, so it must
  // be stamped by the generation that actually proved it.
  const startFence = access?.access?.fence || null;
  const cloudSnapshot = await readSupabaseCloudConvergenceSnapshot({ configured: params.configured, user: params.user, company: params.company });
  const completionAccess = await ensureCurrentDeviceCanApplyLocalRestore({ configured: params.configured, user: params.user, company: params.company, storage: localStorage, reason: "backup_baseline_capture_completion" });
  if (!completionAccess?.ok) return { ok: false, code: "device_not_active", deviceLockLost: Boolean(completionAccess?.deviceLockLost) };
  if (!operationFenceStillCurrent({ startFence, completionAccess })) return { ok: false, code: "device_generation_changed", deviceLockLost: true };
  const captured = captureVerifiedCloudSyncBaseline({ storage: localStorage, companyId: params.company?.id, queueRevision: queueGeneration, cloudSnapshot, verified: true, deviceAccess: completionAccess });
  return captured.ok ? { ok: true } : { ok: false, code: captured.code || "baseline_write_failed" };
}

async function captureAutomaticAppRestoreBundle({ result, params }) {
  if (result?.status !== "backup_completed") return { ok: true, skipped: true };
  const bundleResult = await updateSupabaseAppRestoreBundle({
    storageSnapshot: localStorage,
    configured: params.configured,
    user: params.user,
    company: params.company,
    role: params.role,
  });
  if (bundleResult?.status === APP_RESTORE_BUNDLE_STATUS.COMPLETED && bundleResult?.bundleUpdated) {
    return { ok: true };
  }
  return {
    ok: false,
    code: "app_restore_bundle_incomplete",
    error: bundleResult?.error || "The app restore bundle could not be updated.",
    deviceLockLost: Boolean(bundleResult?.deviceLockLost),
  };
}

export default function useCloudAutoBackup({
  enabled = false,
  configured = false,
  user = null,
  company = null,
  role = "",
  deviceLocked = false,
  immediateDelayMs = CLOUD_AUTO_BACKUP_IMMEDIATE_DELAY_MS,
  normalDelayMs = CLOUD_AUTO_BACKUP_NORMAL_DELAY_MS,
} = {}) {
  const [running, setRunning] = useState(false);
  const paramsRef = useRef({ enabled, configured, user, company, role, deviceLocked });
  // A NEEDS_ATTENTION item may be a repaired stale-child duplicate from a
  // previous bundle. Give it one fresh-bundle recovery attempt, but never
  // turn a failed recovery into a tight same-session retry loop.
  const needsAttentionRecoveryAttemptsRef = useRef(new Set());
  const previousDeviceLockedRef = useRef(Boolean(deviceLocked));
  // The smallest handled-result path this worker needs: what the last contained
  // automatic attempt ended on. Internal only -- no new UI, no new state system,
  // and never a substitute for the durable ledger's own truth.
  const workerErrorRef = useRef(null);
  paramsRef.current = { enabled, configured, user, company, role, deviceLocked };

  useEffect(() => {
    let disposed = false;
    let timer = null;
    let ledgerRecoveryTimer = null;
    let runningNow = false;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const clearLedgerRecoveryTimer = () => {
      if (ledgerRecoveryTimer) {
        clearTimeout(ledgerRecoveryTimer);
        ledgerRecoveryTimer = null;
      }
    };

    const setRunningState = (value) => {
      runningNow = value;
      if (!disposed) setRunning(value);
      try {
        window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, {
          detail: { running: value },
        }));
      } catch {}
    };

    const runBackupAttempt = async () => {
      clearTimer();
      const params = paramsRef.current;
      if (!canRunAutomatically(params)) return;
      if (runningNow) return;
      if (hasUnresolvedConvergenceJournal()) return;

      // Money-critical invoice mutations are independent of the historical
      // whole-workspace queue. Drain the oldest durable mutation first, even if
      // that compatibility queue still contains conflict/remote_changed history.
      const ledgerMutation = getNextCloudMutation(readCloudMutationLedger());
      if (ledgerMutation) {
        if (!isBrowserOnline()) return;
        const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
        if (!lease) {
          scheduleCheck();
          return;
        }
        let deviceLockLost = false;
        setRunningState(true);
        try {
          // STAGE 1 -- local persistence. If the vault will not durably record
          // that this mutation is syncing, the cloud must not be touched at all:
          // an unrecorded attempt is indistinguishable from no attempt, and
          // nothing may be written about a mutation whose state is not durable.
          const syncing = await commitLedgerStage(
            LEDGER_STAGE.MARK_SYNCING,
            () => markCloudMutationSyncing(ledgerMutation)
          );
          if (!syncing.ok) return;
          const mutation = syncing.result?.mutation || ledgerMutation;

          // STAGE 2 -- the cloud. This is the ONLY stage whose failure is real
          // news about the cloud, and therefore the only one that may be
          // recorded as a mutation failure.
          let result = null;
          let cloudThrew = false;
          try {
            result = await runSupabaseCloudMutationWrite({
              mutation,
              storageSnapshot: localStorage,
              configured: params.configured,
              user: params.user,
              company: params.company,
            });
          } catch (error) {
            cloudThrew = true;
            result = { ok: false, verified: false, error: error?.message || "", code: "" };
          }
          deviceLockLost = Boolean(result?.deviceLockLost);

          if (result?.ok && result?.verified) {
            // STAGE 3 -- local persistence again. A refused acknowledgement is
            // NOT a cloud failure: the targeted write really did succeed and
            // verify. Nothing is recorded, nothing is acknowledged, and no clock
            // advances. The write is exact-target and idempotent, so a later
            // automatic pass may repeat it and then acknowledge durably.
            await commitLedgerStage(
              LEDGER_STAGE.ACKNOWLEDGE,
              () => acknowledgeCloudMutation(mutation, { verifiedAt: result.verifiedAt })
            );
          } else {
            // STAGE 3' -- record the cloud failure. If the vault refuses THIS
            // transition, the attempt simply ends: retrying it here is exactly
            // the recursion that crashed the app.
            await commitLedgerStage(
              LEDGER_STAGE.RECORD_CLOUD_FAILURE,
              () => recordCloudMutationFailure(mutation, cloudThrew ? {
                error: result?.error || "automatic_invoice_mutation_error",
                errorCode: "automatic_invoice_mutation_error",
                retryDelayMs: retryDelayMs(Number(mutation?.retryCount || 0) + 1),
              } : {
                error: result?.error || "Invoice sync could not be verified.",
                errorCode: result?.code || "invoice_mutation_failed",
                retryDelayMs: retryDelayMs(Number(mutation?.retryCount || 0) + 1),
              })
            );
          }
        } finally {
          releaseCloudOperationRunLock(lease);
          setRunningState(false);
          if (!deviceLockLost) {
            scheduleCheck();
            await attemptAutomaticLedgerRecovery("mutation_completed");
          }
        }
        return;
      }

      const queueState = readCloudBackupQueueState();
      if (!isEligibleQueueState(queueState)) return;
      if (!backupOwnsNextOperation(queueState)) return;
      const recoveryKey = queueIdentity(queueState, params.company?.id);
      const recoveringNeedsAttention = queueState.status === "needs_attention";
      if (needsAttentionRecoveryAttemptsRef.current.has(recoveryKey)) return;

      if (!isBrowserOnline()) {
        markCloudBackupOfflinePending();
        return;
      }

      const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
      if (!lease) {
        // Convergence, restore and backup share this lock. Keep the queue intact
        // and recheck later instead of dropping a pending local mutation.
        scheduleCheck();
        return;
      }
      // ONE immutable generation for the whole worker attempt.
      //
      // Onboarding, bundle capture and baseline capture each fence themselves,
      // but the ATTEMPT spans all three. Without an attempt-level generation,
      // A/v5 can complete onboarding, lose the workspace to B/v6, regain it as
      // A/v7, and still deliver its old result to the queue classifier -- which
      // would mark clean a logical attempt that crossed generations. Captured
      // once here and never refreshed.
      let attemptStartFence = null;
      try {
        const attemptAccess = await ensureCurrentDeviceCanWriteCloud({
          configured: params.configured,
          user: params.user,
          company: params.company,
          storage: localStorage,
          reason: "automatic_backup_attempt",
          claimIfMissing: false,
        });
        if (attemptAccess?.ok) attemptStartFence = attemptAccess?.access?.fence || null;
      } catch {
        attemptStartFence = null;
      }
      if (!attemptStartFence) {
        // Unauthorized, or a generation that cannot be proved. Stop before the
        // queue is even marked syncing, so the pending work simply stays pending.
        releaseCloudOperationRunLock(lease);
        return;
      }

      if (recoveringNeedsAttention) needsAttentionRecoveryAttemptsRef.current.add(recoveryKey);
      setRunningState(true);
      const activeDeviceId = getOrCreateLocalDeviceId(localStorage);
      const syncingQueue = markCloudBackupSyncing({ companyId: params.company?.id, activeDeviceId });
      const queueGeneration = Number(syncingQueue?.syncingRevision ?? queueState.localMutationRevision ?? 0);
      let deviceLockLost = false;

      try {
        const onboarding = await checkSupabaseCloudOnboardingStatus({
          storageSnapshot: localStorage,
          configured: params.configured,
          user: params.user,
          company: params.company,
          role: params.role,
          allowAutomaticSafeRepair: false,
          verifyEstablishedWorkspace: false,
        });
        if (onboarding?.status !== CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP) {
          const alreadyVerified = onboarding?.status === CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP
            && onboarding?.verification?.ok
            && onboarding?.verification?.allMatched;
          applyCloudBackupResultToQueue(alreadyVerified
            ? { status: "backup_completed" }
            : { status: "needs_attention", error: "First cloud backup is no longer eligible for this workspace." }, { queueGeneration });
          return;
        }
        let result = await runSupabaseCloudOnboardingBackup({
          storageSnapshot: localStorage,
          configured: params.configured,
          user: params.user,
          company: params.company,
          role: params.role,
          queueGeneration,
        });
        let completionQueueGeneration = queueGeneration;
        if (result?.status === "backup_completed") {
          const latestQueue = readCloudBackupQueueState();
          const newerMutationArrived = latestQueue.pending
            && Number(latestQueue.localMutationRevision || 0) !== Number(queueGeneration || 0);
          if (newerMutationArrived) {
            // A newer local change arrived while the business backup was in
            // flight. Leave that generation pending for its own full backup
            // and bundle capture; never let this older completion clear it.
            applyCloudBackupResultToQueue(result, { queueGeneration });
            return;
          }
          // The business backup verified its own data before returning, but the
          // app restore bundle is a second required cloud write. Re-queue this
          // final capture so the UI cannot call the cloud current until both
          // writes have completed successfully.
          const appBundleQueue = markCloudBootstrapPending({
            reason: "app_restore_bundle_capture",
            domains: ["company_profile"],
            severity: "normal",
            source: "useCloudAutoBackup",
          });
          completionQueueGeneration = Number(appBundleQueue?.localMutationRevision || queueGeneration || 0);
          const appRestoreBundle = await captureAutomaticAppRestoreBundle({ result, params });
          if (!appRestoreBundle.ok) {
            result = {
              ...result,
              status: "needs_attention",
              error: appRestoreBundle.error || "Cloud backup needs another verification before it can be marked complete.",
              deviceLockLost: appRestoreBundle.deviceLockLost,
            };
          }
        }
        const baseline = await captureAutomaticBackupBaseline({ result, params, queueGeneration: completionQueueGeneration });
        if (!baseline.ok) {
          markCloudBootstrapPending({ reason: "cloud_sync_baseline_incomplete", severity: "normal" });
          result = { ...result, status: "needs_attention", error: "Cloud backup needs another verification before it can be marked complete.", deviceLockLost: baseline.deviceLockLost };
        }
        // The ONLY clean-capable boundary of this attempt. Re-prove the exact
        // generation the attempt began under before the shared classifier is
        // allowed to see a completed result.
        if (result?.status === "backup_completed") {
          const attemptStillCurrent = await ensureDeviceFenceStillCurrent({
            configured: params.configured,
            user: params.user,
            company: params.company,
            storage: localStorage,
            fence: attemptStartFence,
            reason: "backup",
          });
          if (!attemptStillCurrent?.ok) {
            // Existing device-lock-lost semantics. The shared queue owner reads
            // this and leaves the generation pending for whoever owns it now.
            result = {
              ...result,
              status: "needs_attention",
              error: attemptStillCurrent?.userMessage
                || attemptStillCurrent?.error
                || "Cloud backup needs another verification before it can be marked complete.",
              code: attemptStillCurrent?.code,
              deviceLockLost: true,
            };
          }
        }
        deviceLockLost = Boolean(result?.deviceLockLost);

        // Both the automatic worker and the manual Retry Sync button classify a
        // backup result through the SAME shared queue transition, so the queue
        // status can never disagree with the result the user sees.
        applyCloudBackupResultToQueue(result, { queueGeneration: completionQueueGeneration });
      } catch (error) {
        const current = readCloudBackupQueueState();
        recordCloudBackupAttemptFailure(
          error?.message || "automatic_backup_error",
          { retryDelayMs: retryDelayMs(Number(current.retryCount || 0) + 1), errorCode: "automatic_backup_error" }
        );
      } finally {
        // Releases only THIS attempt's lease, never a newer operation's.
        releaseCloudOperationRunLock(lease);
        setRunningState(false);
        // A mutation may have landed while the writer was awaiting cloud I/O.
        // Its generation remains pending, so schedule exactly one follow-up.
        if (!deviceLockLost) scheduleCheck();
      }
    };

    // THE automatic rejection boundary. Every invocation below is
    // fire-and-forget, so an attempt that ends in a rejection would reach the
    // window as an unhandled rejection and open the React error overlay -- which
    // is exactly what the live NOT_READY crash did.
    //
    // A temporary vault lifecycle refusal is not an error at all: it is deferred
    // local work, and the durable mutation is left untouched for the next pass.
    // Anything else is contained here and remembered for diagnosis. Nothing is
    // faked, cleared, retried, or written from this boundary, and the real local
    // failure stays visible through the vault runtime state the shell already
    // gates on.
    const attemptBackup = async () => {
      try {
        return await runBackupAttempt();
      } catch (error) {
        workerErrorRef.current = {
          stage: LEDGER_STAGE.CLOUD_WRITE,
          code: String(error?.message || ""),
          deferred: isTemporaryVaultLifecycleError(error),
          at: Date.now(),
        };
        return undefined;
      }
    };

    // Debounced: waits for local changes to settle before running, faster
    // for money-critical (immediate-priority) queue entries. Never runs
    // concurrently with itself or with a manual backup (shared run lock).
    const scheduleCheck = () => {
      const params = paramsRef.current;
      if (!canRunAutomatically(params) || runningNow) return;
      if (hasUnresolvedConvergenceJournal()) return;

      const ledgerWork = nextLedgerWork(readCloudMutationLedger());
      if (ledgerWork) {
        if (!isBrowserOnline()) return;
        clearTimer();
        const delay = ledgerWork.delay > 0 ? ledgerWork.delay : immediateDelayMs;
        timer = setTimeout(attemptBackup, delay);
        return;
      }

      const queueState = readCloudBackupQueueState();
      if (!isEligibleQueueState(queueState)) return;
      if (needsAttentionRecoveryAttemptsRef.current.has(queueIdentity(queueState, params.company?.id))) return;

      if (!isBrowserOnline()) {
        markCloudBackupOfflinePending();
        return;
      }

      clearTimer();
      const retryAt = Number(queueState?.nextRetryAt || 0);
      const retryDelay = retryAt > Date.now() ? retryAt - Date.now() : 0;
      const delay = retryDelay || delayForPriority(queueState.priority, immediateDelayMs, normalDelayMs);
      timer = setTimeout(attemptBackup, delay);
    };

    // Skips the debounce window -- used for reconnect (online) and foreground
    // (visibility), where waiting the full debounce would miss the opportunity.
    const attemptNowIfSafe = () => {
      const params = paramsRef.current;
      if (!canRunAutomatically(params) || runningNow) return;
      if (hasUnresolvedConvergenceJournal()) return;

      if (getNextCloudMutation(readCloudMutationLedger())) {
        attemptBackup();
        return;
      }

      const queueState = readCloudBackupQueueState();
      if (!isEligibleQueueState(queueState)) return;
      if (needsAttentionRecoveryAttemptsRef.current.has(queueIdentity(queueState, params.company?.id))) return;

      attemptBackup();
    };

    const attemptAutomaticLedgerRecovery = async (trigger) => {
      try {
        return await runAutomaticLedgerRecovery(trigger);
      } catch (error) {
        workerErrorRef.current = {
          stage: LEDGER_STAGE.AUTOMATIC_RECOVERY,
          code: String(error?.message || ""),
          deferred: isTemporaryVaultLifecycleError(error),
          at: Date.now(),
        };
        return false;
      }
    };

    const runAutomaticLedgerRecovery = async (trigger) => {
      const params = paramsRef.current;
      if (!canRunAutomatically(params) || runningNow || !isBrowserOnline()) return false;
      if (hasUnresolvedConvergenceJournal()) return false;
      const recoveryContext = await getHistoricalMutationRecoveryContext({ userId: params.user?.id, companyId: params.company?.id });
      if (disposed) return false;
      const retired = await commitLedgerStage(
        LEDGER_STAGE.AUTOMATIC_RECOVERY,
        () => reconcileSupersededParentMissingMutations({ recoveryContext })
      );
      if (!retired.ok || disposed) return false;
      const ledger = readCloudMutationLedger();
      const failed = ledger.entries.find(entry => getCloudMutationAutomaticRecoveryProof(entry, ledger, recoveryContext));
      if (!failed) return false;
      const retryAt = Number(failed.lastAttemptAt || 0) + CLOUD_MUTATION_AUTO_RECOVERY_COOLDOWN_MS;
      const remaining = retryAt - Date.now();
      if (remaining > 0) {
        if (!ledgerRecoveryTimer) {
          ledgerRecoveryTimer = setTimeout(() => {
            ledgerRecoveryTimer = null;
            if (!disposed) attemptAutomaticLedgerRecovery(trigger);
          }, remaining);
        }
        return true;
      }
      // Requeue is itself a ledger transition, so it can be refused by the vault
      // for exactly the same lifecycle reasons. A refusal leaves the failed
      // mutation exactly as it is -- still NEEDS_ATTENTION, same retryCount --
      // for the next eligible trigger to recover.
      const requeued = await commitLedgerStage(
        LEDGER_STAGE.AUTOMATIC_RECOVERY,
        () => requeueCloudMutationForAutomaticRetry(failed, { trigger, recoveryContext })
      );
      if (!requeued.ok) return false;
      attemptNowIfSafe();
      return true;
    };

    const onQueueStorageEvent = (event) => {
      const key = event?.detail?.key;
      if (key && key !== STORAGE_KEYS.CLOUD_BACKUP_QUEUE && key !== STORAGE_KEYS.CLOUD_MUTATION_LEDGER) return;
      if (key === STORAGE_KEYS.CLOUD_MUTATION_LEDGER) {
        attemptAutomaticLedgerRecovery("ledger_changed");
      }
      scheduleCheck();
    };

    const onOnline = () => {
      attemptAutomaticLedgerRecovery("online").then((handled) => {
        if (!handled) attemptNowIfSafe();
      });
    };

    const onManualRequest = () => {
      const queueState = readCloudBackupQueueState();
      needsAttentionRecoveryAttemptsRef.current.delete(queueIdentity(queueState, paramsRef.current.company?.id));
      attemptNowIfSafe();
    };

    const onVisibilityChange = () => {
      try {
        if (typeof document === "undefined" || document.visibilityState !== "visible") return;
      } catch {
        return;
      }
      attemptAutomaticLedgerRecovery("visible").then((handled) => {
        if (!handled) attemptNowIfSafe();
      });
    };

    // Gate E2 / E2.2: pagehide must NOT start a new full-table cloud read -- its
    // ONLY action is to cancel an already-scheduled backup timer so no
    // backup+verify scan fires during unload (a request the browser routinely
    // kills mid-flight, wasting egress). It never calls attemptBackup /
    // attemptNowIfSafe / runSupabaseCloudOnboardingBackup /
    // readSupabaseCloudConvergenceSnapshot, and it never clears, completes, or
    // mutates the dirty queue -- the pending queue stays in localStorage and a
    // later safe remount / visible foreground / online recovery resumes it once.
    const onPageHide = () => { clearTimer(); };

    const wasDeviceLocked = previousDeviceLockedRef.current;
    previousDeviceLockedRef.current = Boolean(deviceLocked);
    const startupTrigger = wasDeviceLocked && !deviceLocked ? "device_ready" : "mount";
    (async () => {
      // Startup runs two durable transitions before any scheduling, and at mount
      // the vault is frequently still hydrating or frozen. Each is contained on
      // its own so a refusal defers that step instead of cancelling the rest of
      // startup -- and never reaches the window as an unhandled rejection.
      const reconciled = await commitLedgerStage(
        LEDGER_STAGE.AUTOMATIC_RECOVERY,
        () => reconcileSupersededCloudBackupQueueFromAcknowledgedMutations()
      );
      if (!reconciled.ok && !reconciled.deferred && reconciled.error) {
        workerErrorRef.current = { stage: reconciled.stage, code: reconciled.code, deferred: false, at: Date.now() };
      }
      if (disposed) return;
      await commitLedgerStage(
        LEDGER_STAGE.AUTOMATIC_RECOVERY,
        () => materializeLegacyCompatibilityQueue({ storage: localStorage, companyId: paramsRef.current.company?.id })
      );
      if (disposed) return;
      scheduleCheck();
      await attemptAutomaticLedgerRecovery(startupTrigger);
    })();

    try {
      window.addEventListener("pe-localstorage", onQueueStorageEvent);
      window.addEventListener(CLOUD_AUTO_BACKUP_REQUEST_EVENT, onManualRequest);
      window.addEventListener("online", onOnline);
      document.addEventListener("visibilitychange", onVisibilityChange);
      window.addEventListener("pagehide", onPageHide);
    } catch {}

    return () => {
      disposed = true;
      clearTimer();
      clearLedgerRecoveryTimer();
      try {
        window.removeEventListener("pe-localstorage", onQueueStorageEvent);
        window.removeEventListener(CLOUD_AUTO_BACKUP_REQUEST_EVENT, onManualRequest);
        window.removeEventListener("online", onOnline);
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", onPageHide);
      } catch {}
    };
  }, [enabled, configured, user?.id, company?.id, role, deviceLocked, immediateDelayMs, normalDelayMs]);

  return { running };
}
