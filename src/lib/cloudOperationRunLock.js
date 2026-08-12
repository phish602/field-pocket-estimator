// @ts-nocheck
/* eslint-disable */

// The single MUTUAL-EXCLUSION boundary for cloud operations: at most one cloud
// operation (backup, recovery or convergence) executes at a time.
//
// This replaces the original anonymous `let locked = false` mutex, which had two
// weaknesses now that several actors share it:
//
//   1. it did not know WHO held it, so a busy lock was indistinguishable from a
//      lock held by the very operation that was about to be started; and
//   2. release took no argument, so ANY caller -- including a stale callback from
//      an operation that had already finished -- could unlock a newer, unrelated
//      operation mid-flight.
//
// Acquisition therefore returns an opaque per-acquisition LEASE, and release only
// succeeds for that exact lease. The lease is an object, so identity comparison
// makes a stale lease structurally incapable of releasing a later one.
//
// SEPARATION OF CONCERNS: this module performs no policy. It never decides that
// backup outranks recovery or that convergence should yield -- that precedence has
// exactly one owner, cloudOperationOwnership, and each actor consults it before
// ever reaching this lock. Here the rule is only "first eligible caller wins".
//
// Memory-only and never persisted: no ownership survives a reload, so a crash or
// refresh can never leave the app permanently wedged behind a stale lock.

import { CLOUD_OPERATION_OWNER } from "./cloudOperationOwnership";

// Owner values are NOT redefined here -- they come from the shared contract.
const VALID_OWNERS = new Set(Object.values(CLOUD_OPERATION_OWNER));

// The active lease object, or null when the lock is free.
let activeLease = null;
// Monotonic id purely for diagnostics/readability; identity is what enforces
// correctness, not this number.
let leaseSequence = 0;

// Read-only view for diagnostics and deterministic tests. Never returns the
// lease itself, so reading can never grant the ability to release.
export function readCloudOperationRunLock() {
  return activeLease
    ? { locked: true, owner: activeLease.owner, leaseId: activeLease.id }
    : { locked: false, owner: null, leaseId: 0 };
}

export function isCloudOperationRunLocked() {
  return activeLease !== null;
}

export function cloudOperationRunLockOwner() {
  return activeLease ? activeLease.owner : null;
}

// Returns an opaque lease on success, or null when the lock is busy or the owner
// is not a recognized operation class. An unknown/empty owner FAILS CLOSED: it
// never acquires, so a mislabelled operation cannot execute cloud work.
export function tryAcquireCloudOperationRunLock(owner) {
  if (!VALID_OWNERS.has(owner)) return null;
  if (activeLease) return null;
  leaseSequence += 1;
  activeLease = Object.freeze({ id: leaseSequence, owner });
  return activeLease;
}

// Releases ONLY when the caller presents the exact lease that currently holds the
// lock. A stale lease, a forged object, a null/garbage value or a second release
// of an already-released lease all return false and change nothing -- so an
// operation can never unlock work that is not its own.
export function releaseCloudOperationRunLock(lease) {
  if (!lease || activeLease !== lease) return false;
  activeLease = null;
  return true;
}

// TEST-ONLY escape hatch. Suites need to guarantee a clean mutex between cases
// without holding leases created inside hooks. Deliberately named so it can never
// be mistaken for the production release path, which always requires a lease.
export function resetCloudOperationRunLockForTests() {
  activeLease = null;
}
