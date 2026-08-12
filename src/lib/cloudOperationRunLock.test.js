// The mutual-exclusion boundary, proven directly.
//
// The important property beyond "one at a time" is that release is LEASE-scoped:
// the old anonymous mutex let any caller -- including a stale callback from an
// operation that had already finished -- unlock a newer operation mid-flight.

import {
  tryAcquireCloudOperationRunLock,
  releaseCloudOperationRunLock,
  readCloudOperationRunLock,
  isCloudOperationRunLocked,
  cloudOperationRunLockOwner,
  resetCloudOperationRunLockForTests,
} from "./cloudOperationRunLock";
import { CLOUD_OPERATION_OWNER } from "./cloudOperationOwnership";

beforeEach(() => resetCloudOperationRunLockForTests());
afterEach(() => resetCloudOperationRunLockForTests());

describe("CASE 1 - acquisition records the owning operation", () => {
  test("BACKUP acquires and is recorded as the owner", () => {
    const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
    expect(lease).toBeTruthy();
    expect(isCloudOperationRunLocked()).toBe(true);
    expect(cloudOperationRunLockOwner()).toBe(CLOUD_OPERATION_OWNER.BACKUP);
    expect(readCloudOperationRunLock()).toEqual({ locked: true, owner: CLOUD_OPERATION_OWNER.BACKUP, leaseId: expect.any(Number) });
  });

  test("each operation class can own the lock", () => {
    Object.values(CLOUD_OPERATION_OWNER).forEach((owner) => {
      resetCloudOperationRunLockForTests();
      expect(tryAcquireCloudOperationRunLock(owner)).toBeTruthy();
      expect(cloudOperationRunLockOwner()).toBe(owner);
    });
  });

  test("the read-only view never exposes the lease itself", () => {
    const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
    const view = readCloudOperationRunLock();
    expect(view).not.toBe(lease);
    // Reading can never grant the ability to release.
    expect(releaseCloudOperationRunLock(view)).toBe(false);
    expect(isCloudOperationRunLocked()).toBe(true);
  });
});

describe("CASES 2 & 3 - exactly one operation at a time", () => {
  test.each([
    ["CONVERGENCE", CLOUD_OPERATION_OWNER.CONVERGENCE],
    ["RECOVERY", CLOUD_OPERATION_OWNER.RECOVERY],
    ["a second BACKUP", CLOUD_OPERATION_OWNER.BACKUP],
  ])("%s is refused while BACKUP owns the lock", (_label, owner) => {
    expect(tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP)).toBeTruthy();

    expect(tryAcquireCloudOperationRunLock(owner)).toBeNull();
    // The incumbent is untouched.
    expect(cloudOperationRunLockOwner()).toBe(CLOUD_OPERATION_OWNER.BACKUP);
    expect(isCloudOperationRunLocked()).toBe(true);
  });
});

describe("CASE 4 & 10 - releasing the correct lease frees the lock", () => {
  test("release unlocks and another owner may acquire immediately", () => {
    const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
    expect(releaseCloudOperationRunLock(lease)).toBe(true);
    expect(isCloudOperationRunLocked()).toBe(false);
    expect(cloudOperationRunLockOwner()).toBeNull();

    const next = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.RECOVERY);
    expect(next).toBeTruthy();
    expect(cloudOperationRunLockOwner()).toBe(CLOUD_OPERATION_OWNER.RECOVERY);
  });
});

describe("CASE 5 - a wrong lease cannot release someone else's lock", () => {
  test("a forged or foreign lease is refused and the lock stays held", () => {
    const held = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
    const forged = { id: held.id, owner: held.owner };

    expect(releaseCloudOperationRunLock(forged)).toBe(false);
    // Structural equality is not enough -- identity is required.
    expect(isCloudOperationRunLocked()).toBe(true);
    expect(cloudOperationRunLockOwner()).toBe(CLOUD_OPERATION_OWNER.BACKUP);
    expect(releaseCloudOperationRunLock(held)).toBe(true);
  });

  test("owner-string release is not even possible", () => {
    tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
    expect(releaseCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP)).toBe(false);
    expect(isCloudOperationRunLocked()).toBe(true);
  });
});

// THE CRITICAL CASE the anonymous mutex could not express.
describe("CASE 6 - a stale lease can never release a newer operation", () => {
  test("BACKUP's finished lease cannot unlock CONVERGENCE's in-flight work", () => {
    const backupLease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
    expect(releaseCloudOperationRunLock(backupLease)).toBe(true);

    const convergenceLease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.CONVERGENCE);
    expect(convergenceLease).toBeTruthy();

    // A late unwind from the finished backup fires here.
    expect(releaseCloudOperationRunLock(backupLease)).toBe(false);

    // Convergence still holds the lock with its own lease.
    expect(isCloudOperationRunLocked()).toBe(true);
    expect(cloudOperationRunLockOwner()).toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
    expect(releaseCloudOperationRunLock(convergenceLease)).toBe(true);
    expect(isCloudOperationRunLocked()).toBe(false);
  });
});

describe("CASE 7 - double release is harmless", () => {
  test("releasing the same lease twice changes nothing the second time", () => {
    const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
    expect(releaseCloudOperationRunLock(lease)).toBe(true);
    expect(releaseCloudOperationRunLock(lease)).toBe(false);
    expect(isCloudOperationRunLocked()).toBe(false);
  });

  test("a double release cannot unlock an unrelated newer acquisition", () => {
    const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
    releaseCloudOperationRunLock(lease);
    const newer = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.RECOVERY);

    releaseCloudOperationRunLock(lease);

    expect(isCloudOperationRunLocked()).toBe(true);
    expect(cloudOperationRunLockOwner()).toBe(CLOUD_OPERATION_OWNER.RECOVERY);
    expect(releaseCloudOperationRunLock(newer)).toBe(true);
  });
});

describe("CASE 8 - an unrecognized owner fails closed", () => {
  test.each([
    ["an unknown string", "sync"],
    ["an empty string", ""],
    ["null", null],
    ["undefined", undefined],
    ["a number", 1],
    ["an object", { owner: "backup" }],
  ])("%s never acquires the lock", (_label, owner) => {
    expect(tryAcquireCloudOperationRunLock(owner)).toBeNull();
    expect(isCloudOperationRunLocked()).toBe(false);
  });

  test("a mislabelled operation cannot displace a real owner either", () => {
    tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.CONVERGENCE);
    expect(tryAcquireCloudOperationRunLock("sync")).toBeNull();
    expect(cloudOperationRunLockOwner()).toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
  });
});

describe("CASE 9 - garbage release tokens change no state", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["false", false],
    ["a string", "token"],
    ["a number", 42],
    ["an empty object", {}],
  ])("releasing with %s leaves the held lock intact", (_label, token) => {
    const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.RECOVERY);

    expect(releaseCloudOperationRunLock(token)).toBe(false);
    expect(isCloudOperationRunLocked()).toBe(true);
    expect(cloudOperationRunLockOwner()).toBe(CLOUD_OPERATION_OWNER.RECOVERY);

    releaseCloudOperationRunLock(lease);
  });

  test("garbage release on a free lock also changes nothing", () => {
    expect(releaseCloudOperationRunLock(null)).toBe(false);
    expect(isCloudOperationRunLocked()).toBe(false);
  });
});

describe("memory-only", () => {
  test("the lock writes nothing to storage", () => {
    const before = { ...localStorage };
    const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
    expect({ ...localStorage }).toEqual(before);
    releaseCloudOperationRunLock(lease);
    expect({ ...localStorage }).toEqual(before);
  });
});

// Proves the three actors contend on ONE mutex, from the lock's own side. The
// hook/restore suites prove each actor's busy BEHAVIOR (retry, queue intact,
// RUN_LOCK_BUSY) against this same module.
describe("cross-actor exclusion", () => {
  test.each([
    ["BACKUP", CLOUD_OPERATION_OWNER.BACKUP],
    ["CONVERGENCE", CLOUD_OPERATION_OWNER.CONVERGENCE],
    ["RECOVERY", CLOUD_OPERATION_OWNER.RECOVERY],
  ])("while %s holds the lease, no other actor can acquire", (_label, holder) => {
    const lease = tryAcquireCloudOperationRunLock(holder);
    expect(lease).toBeTruthy();

    Object.values(CLOUD_OPERATION_OWNER).forEach((other) => {
      expect(tryAcquireCloudOperationRunLock(other)).toBeNull();
    });
    expect(cloudOperationRunLockOwner()).toBe(holder);

    // Once the holder finishes, the next rightful operation proceeds.
    expect(releaseCloudOperationRunLock(lease)).toBe(true);
    const next = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.CONVERGENCE);
    expect(next).toBeTruthy();
    releaseCloudOperationRunLock(next);
  });
});

describe("exception safety", () => {
  test("a throwing operation still releases its own lease in finally", () => {
    const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.CONVERGENCE);
    expect(() => {
      try {
        throw new Error("operation exploded");
      } finally {
        releaseCloudOperationRunLock(lease);
      }
    }).toThrow("operation exploded");

    // Not wedged: the next rightful operation can proceed.
    expect(isCloudOperationRunLocked()).toBe(false);
    expect(tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP)).toBeTruthy();
  });
});
