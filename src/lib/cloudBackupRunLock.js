// @ts-nocheck
/* eslint-disable */

// Tiny in-memory mutex (never persisted) so the Gate 13B automatic backup
// worker and the existing manual "Back Up This Device" button never run a
// cloud backup at the same time. Not part of the cloud-backup-queue schema.

let locked = false;

export function isCloudBackupRunLocked() {
  return locked;
}

export function acquireCloudBackupRunLock() {
  if (locked) return false;
  locked = true;
  return true;
}

export function releaseCloudBackupRunLock() {
  locked = false;
}
