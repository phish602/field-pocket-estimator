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
//   1. a pending local backup queue generation      -> BACKUP
//   2. otherwise, a positively-proven empty core    -> RECOVERY
//   3. otherwise                                    -> CONVERGENCE
//
// Rule 1 outranking rule 2 is the important one. AN EMPTY DEVICE IS NOT ALWAYS A
// FRESH DEVICE: a user may legitimately delete their last customer/project/
// estimate/invoice, which leaves the core empty while that deletion is still
// waiting in the backup queue. Treating that as a fresh device would let recovery
// overwrite real local work. Pending local work therefore always wins.
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
  // Pending local mutation waiting to reach the cloud. Outranks everything.
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

// `remote_changed` is terminal review state, not queued backup work: the backup
// worker deliberately will not retry it. On an established device, keeping that
// state owned by backup would deadlock the safe, local-only convergence that
// imports proven cloud-only additions and verifies the result. A true `conflict`
// remains review-only because convergence cannot choose between competing edits.
function remoteChangedReviewNeedsConvergence(queueState) {
  return String(queueState?.status || "") === "remote_changed";
}

// The single precedence rule. `coreEmpty` must be a POSITIVE proof of emptiness;
// anything unproven or unreadable must arrive here as false.
function resolveOwner(coreEmpty, queueState) {
  // Pending work always wins while core data is empty, including terminal review
  // states. That preserves deletion-to-empty safety and keeps recovery from
  // overwriting the local mutation represented by the queue.
  if (coreEmpty && hasPendingLocalBackup(queueState)) return CLOUD_OPERATION_OWNER.BACKUP;
  // An established device can safely let the existing convergence transaction
  // resolve a cloud-only review. It performs no cloud writes, journals its local
  // apply, strictly verifies, then clears this exact queue revision only on
  // success.
  if (remoteChangedReviewNeedsConvergence(queueState)) return CLOUD_OPERATION_OWNER.CONVERGENCE;
  if (hasPendingLocalBackup(queueState)) return CLOUD_OPERATION_OWNER.BACKUP;
  if (coreEmpty) return CLOUD_OPERATION_OWNER.RECOVERY;
  return CLOUD_OPERATION_OWNER.CONVERGENCE;
}

// Snapshot-shaped resolution (local snapshot families as arrays).
export function resolveOperationOwnerFromSnapshot({ snapshot, queueState } = {}) {
  return resolveOwner(hasEmptyCoreBusinessSnapshot(snapshot), queueState);
}

// Counts-shaped resolution (a migration preview's localCounts).
export function resolveOperationOwnerFromCounts({ counts, queueState } = {}) {
  return resolveOwner(hasEmptyCoreBusinessCounts(counts), queueState);
}

export const backupOwnsOperation = (owner) => owner === CLOUD_OPERATION_OWNER.BACKUP;
export const recoveryOwnsOperation = (owner) => owner === CLOUD_OPERATION_OWNER.RECOVERY;
export const convergenceOwnsOperation = (owner) => owner === CLOUD_OPERATION_OWNER.CONVERGENCE;

export default resolveOperationOwnerFromSnapshot;
