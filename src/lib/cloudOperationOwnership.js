// @ts-nocheck
/* eslint-disable */

// ONE client-side authority for a single question:
//
//   which automatic cloud actor is allowed to own the next operation?
//
// Before this module the answer was assembled independently in several places:
// useCloudAutoConvergence carried a private empty-core check, supabaseCloudOnboarding
// carried its own core-doc count, and useCloudRestorePrompt separately decided that
// a pending backup queue outranks an empty-device restore. Each encoded a piece of
// the same precedence, so any one of them could drift and let the wrong actor act.
//
// PRECEDENCE (in this exact order):
//
//   1. positively-empty core + pending queue        -> BACKUP
//   2. established remote_changed/conflict review   -> CONVERGENCE
//   3. other pending local queue generation         -> BACKUP
//   4. otherwise, a positively-proven empty core    -> RECOVERY
//   5. otherwise                                    -> CONVERGENCE
//
// Rule 1 outranking recovery is the important one. AN EMPTY DEVICE IS NOT ALWAYS A
// FRESH DEVICE: a user may legitimately delete their last customer/project/
// estimate/invoice, which leaves the core empty while that deletion is still
// waiting in the backup queue. Treating that as a fresh device would let recovery
// overwrite real local work. Pending work therefore always wins while the core
// is empty; established terminal review states are revalidated by convergence.
//
// This module decides OWNERSHIP ONLY. It is pure: no React, no Supabase, no
// timers, no events, no persistence, no locks, no network, no retries. The
// existing actors still perform all the work and keep all their own eligibility
// rules on top of ownership. Ownership derives entirely from current local state,
// so it changes back naturally -- there is no "established device" flag and no
// "recovery complete" flag to remember.

// "Core" business docs only. Line items and payments are DEPENDENT data: if their
// parent docs are zero they do not change whether a device counts as empty.
export const CORE_BUSINESS_FAMILIES = Object.freeze([
  "customers",
  "projects",
  "estimates",
  "invoices",
]);

export const CLOUD_OPERATION_OWNER = Object.freeze({
  // Pending local mutation waiting to reach the cloud, including any pending
  // review state while core data is positively empty.
  BACKUP: "backup",
  // A clean, positively-empty core device: recovery may hydrate before anything
  // else claims the shared run lock.
  RECOVERY: "recovery",
  // Normal steady state.
  CONVERGENCE: "convergence",
});

// ---------------------------------------------------------------------------
// CORE STATE (no queue involved)
//
// supabaseCloudOnboarding consumes this layer only: it classifies DATA state and
// must not depend on backup queue state.
// ---------------------------------------------------------------------------

// Sums the core doc counts of a counts-shaped object. Preserves the previous
// Number(x || 0) arithmetic exactly, including its NaN on a non-numeric family --
// NaN is not === 0, so an unreadable count never reads as an empty device.
export function sumCoreBusinessDocCounts(counts) {
  const source = counts || {};
  return CORE_BUSINESS_FAMILIES.reduce((total, family) => total + Number(source[family] || 0), 0);
}

export function hasEmptyCoreBusinessCounts(counts) {
  return sumCoreBusinessDocCounts(counts) === 0;
}

// True only when EVERY core family is a readable array and every one is empty. A
// family that is missing or not an array means the snapshot could not be safely
// interpreted, so this returns false and the caller keeps the safe path rather
// than claiming a fresh device.
export function hasEmptyCoreBusinessSnapshot(snapshot) {
  return CORE_BUSINESS_FAMILIES.every((family) => (
    Array.isArray(snapshot?.[family]) && snapshot[family].length === 0
  ));
}

// ---------------------------------------------------------------------------
// OPERATION OWNERSHIP (core state + queue)
// ---------------------------------------------------------------------------

// ANY pending generation counts when deciding whether an EMPTY device can recover.
// This is the protective reading the restore prompt already used: a user who just
// deleted their final record must never be mistaken for a fresh device.
export function hasPendingLocalBackup(queueState) {
  return Boolean(queueState?.pending);
}

// Terminal review states are not retryable backup work: the backup worker
// deliberately refuses them. On an established device, convergence is the
// existing read/compare/strict-verify owner that can either prove the current
// state safe or leave a genuine conflict unresolved.
function reviewStateNeedsConvergence(queueState) {
  const status = String(queueState?.status || "");
  return status === "remote_changed" || status === "conflict";
}

// The single precedence rule. `coreEmpty` must be a POSITIVE proof of emptiness;
// anything unproven or unreadable must arrive here as false.
// Retirement ends an obligation without claiming its own cloud write succeeded.
export function isActiveCloudMutation(entry) {
  return !["acknowledged", "retired"].includes(String(entry?.status || ""));
}

export function hasCurrentDurableLedgerWork(ledgerState) {
  const entries = Array.isArray(ledgerState?.entries) ? ledgerState.entries : [];
  return entries.some(isActiveCloudMutation);
}

function resolveOwner(coreEmpty, queueState, ledgerState) {
  // Durable record-level work is the authoritative local mutation channel. It
  // wins before convergence regardless of hook mount order or legacy queue
  // review state, including a DELETE that made the local core empty.
  if (hasCurrentDurableLedgerWork(ledgerState)) return CLOUD_OPERATION_OWNER.BACKUP;
  // Pending work always wins while core data is empty, including terminal review
  // states. That preserves deletion-to-empty safety and keeps recovery from
  // overwriting the local mutation represented by the queue.
  if (coreEmpty && hasPendingLocalBackup(queueState)) return CLOUD_OPERATION_OWNER.BACKUP;
  // An established device can safely let the existing convergence transaction
  // resolve a cloud-only review. It performs no cloud writes, journals its local
  // apply, strictly verifies, then clears this exact queue revision only on
  // success.
  if (reviewStateNeedsConvergence(queueState)) return CLOUD_OPERATION_OWNER.CONVERGENCE;
  if (hasPendingLocalBackup(queueState)) return CLOUD_OPERATION_OWNER.BACKUP;
  if (coreEmpty) return CLOUD_OPERATION_OWNER.RECOVERY;
  return CLOUD_OPERATION_OWNER.CONVERGENCE;
}

// Snapshot-shaped resolution (local snapshot families as arrays).
export function resolveOperationOwnerFromSnapshot({ snapshot, queueState, mutationLedger } = {}) {
  return resolveOwner(hasEmptyCoreBusinessSnapshot(snapshot), queueState, mutationLedger);
}

// Counts-shaped resolution (a migration preview's localCounts).
export function resolveOperationOwnerFromCounts({ counts, queueState, mutationLedger } = {}) {
  return resolveOwner(hasEmptyCoreBusinessCounts(counts), queueState, mutationLedger);
}

export const backupOwnsOperation = (owner) => owner === CLOUD_OPERATION_OWNER.BACKUP;
export const recoveryOwnsOperation = (owner) => owner === CLOUD_OPERATION_OWNER.RECOVERY;
export const convergenceOwnsOperation = (owner) => owner === CLOUD_OPERATION_OWNER.CONVERGENCE;

export default resolveOperationOwnerFromSnapshot;
