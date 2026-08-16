// The ONE automatic-operation precedence rule, proven directly.
//
// Both core-state shapes that exist in the app -- a local snapshot (arrays) and a
// migration preview's counts (numbers) -- must resolve the same owner, and a
// pending local backup generation must outrank an empty core in every one of them.

import {
  CLOUD_OPERATION_OWNER,
  CORE_BUSINESS_FAMILIES,
  sumCoreBusinessDocCounts,
  hasEmptyCoreBusinessCounts,
  hasEmptyCoreBusinessSnapshot,
  hasPendingLocalBackup,
  resolveOperationOwnerFromSnapshot,
  resolveOperationOwnerFromCounts,
  backupOwnsOperation,
  recoveryOwnsOperation,
  convergenceOwnsOperation,
} from "./cloudOperationOwnership";

const emptySnapshot = () => ({ customers: [], projects: [], estimates: [], invoices: [] });
const emptyCounts = () => ({ customers: 0, projects: 0, estimates: 0, invoices: 0 });
const nonEmptySnapshot = () => ({ ...emptySnapshot(), invoices: [{ id: "inv_1" }] });
const nonEmptyCounts = () => ({ ...emptyCounts(), invoices: 1 });

const CLEAN = { pending: false };
const PENDING = { pending: true, localMutationRevision: 1 };

describe("core family definition", () => {
  test("is exactly customers, projects, estimates, invoices", () => {
    expect([...CORE_BUSINESS_FAMILIES].sort()).toEqual(["customers", "estimates", "invoices", "projects"]);
  });
});

describe("CASE 1 - empty core + clean queue -> RECOVERY", () => {
  test("snapshot shape", () => {
    expect(hasEmptyCoreBusinessSnapshot(emptySnapshot())).toBe(true);
    const owner = resolveOperationOwnerFromSnapshot({ snapshot: emptySnapshot(), queueState: CLEAN });
    expect(owner).toBe(CLOUD_OPERATION_OWNER.RECOVERY);
    expect(recoveryOwnsOperation(owner)).toBe(true);
  });

  test("counts shape", () => {
    expect(hasEmptyCoreBusinessCounts(emptyCounts())).toBe(true);
    expect(resolveOperationOwnerFromCounts({ counts: emptyCounts(), queueState: CLEAN }))
      .toBe(CLOUD_OPERATION_OWNER.RECOVERY);
  });

  test("a missing queueState is treated as clean, not pending", () => {
    expect(hasPendingLocalBackup(undefined)).toBe(false);
    expect(resolveOperationOwnerFromSnapshot({ snapshot: emptySnapshot() }))
      .toBe(CLOUD_OPERATION_OWNER.RECOVERY);
  });
});

describe("CASE 2 - non-empty core + clean queue -> CONVERGENCE", () => {
  test.each(CORE_BUSINESS_FAMILIES)("a %s record alone gives convergence", (family) => {
    const snapshot = { ...emptySnapshot(), [family]: [{ id: "record_1" }] };
    const owner = resolveOperationOwnerFromSnapshot({ snapshot, queueState: CLEAN });
    expect(owner).toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
    expect(convergenceOwnsOperation(owner)).toBe(true);

    expect(resolveOperationOwnerFromCounts({ counts: { ...emptyCounts(), [family]: 1 }, queueState: CLEAN }))
      .toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
  });
});

// THE CRITICAL SAFETY CASE. An empty core with pending local work is a user who
// just deleted their last document -- never a fresh device.
describe("CASE 3 - empty core + PENDING queue -> BACKUP (deletion-to-empty safety)", () => {
  test("snapshot shape", () => {
    const owner = resolveOperationOwnerFromSnapshot({ snapshot: emptySnapshot(), queueState: PENDING });
    expect(owner).toBe(CLOUD_OPERATION_OWNER.BACKUP);
    expect(backupOwnsOperation(owner)).toBe(true);
    expect(recoveryOwnsOperation(owner)).toBe(false);
  });

  test("counts shape", () => {
    expect(resolveOperationOwnerFromCounts({ counts: emptyCounts(), queueState: PENDING }))
      .toBe(CLOUD_OPERATION_OWNER.BACKUP);
  });

  test("even a deferred or conflicted pending generation still outranks recovery", () => {
    // Whether backup is ELIGIBLE to run is backup's own rule; ownership only
    // decides precedence, so local work is never exposed to recovery.
    [
      { pending: true, priority: "deferred" },
      { pending: true, status: "conflict" },
      { pending: true, status: "remote_changed" },
      { pending: true, status: "needs_attention" },
    ].forEach((queueState) => {
      expect(resolveOperationOwnerFromSnapshot({ snapshot: emptySnapshot(), queueState }))
        .toBe(CLOUD_OPERATION_OWNER.BACKUP);
    });
  });
});

describe("CASE 4 - non-empty core + pending queue -> BACKUP", () => {
  test("both shapes", () => {
    expect(resolveOperationOwnerFromSnapshot({ snapshot: nonEmptySnapshot(), queueState: PENDING }))
      .toBe(CLOUD_OPERATION_OWNER.BACKUP);
    expect(resolveOperationOwnerFromCounts({ counts: nonEmptyCounts(), queueState: PENDING }))
      .toBe(CLOUD_OPERATION_OWNER.BACKUP);
  });

  test("a terminal remote_changed review hands an established device to safe convergence", () => {
    const queueState = { pending: true, status: "remote_changed", localMutationRevision: 7 };
    expect(resolveOperationOwnerFromSnapshot({ snapshot: nonEmptySnapshot(), queueState }))
      .toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
    expect(resolveOperationOwnerFromCounts({ counts: nonEmptyCounts(), queueState }))
      .toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
  });

  test("a true conflict remains owned by review, never automatic convergence", () => {
    const queueState = { pending: true, status: "conflict", localMutationRevision: 7 };
    expect(resolveOperationOwnerFromSnapshot({ snapshot: nonEmptySnapshot(), queueState }))
      .toBe(CLOUD_OPERATION_OWNER.BACKUP);
    expect(resolveOperationOwnerFromCounts({ counts: nonEmptyCounts(), queueState }))
      .toBe(CLOUD_OPERATION_OWNER.BACKUP);
  });
});

describe("CASES 5 & 6 - malformed core can never produce RECOVERY", () => {
  const malformed = [
    ["null", null],
    ["undefined", undefined],
    ["a non-object", "nonsense"],
    ["an empty object", {}],
    ["a missing family", { customers: [], projects: [], estimates: [] }],
    ["a non-array family", { customers: [], projects: [], estimates: [], invoices: "0" }],
    ["a null family", { customers: [], projects: [], estimates: [], invoices: null }],
  ];

  test.each(malformed)("CASE 5: %s + clean queue -> CONVERGENCE", (_label, snapshot) => {
    expect(hasEmptyCoreBusinessSnapshot(snapshot)).toBe(false);
    expect(resolveOperationOwnerFromSnapshot({ snapshot, queueState: CLEAN }))
      .toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
  });

  test.each(malformed)("CASE 6: %s + pending queue -> BACKUP", (_label, snapshot) => {
    expect(resolveOperationOwnerFromSnapshot({ snapshot, queueState: PENDING }))
      .toBe(CLOUD_OPERATION_OWNER.BACKUP);
  });

  test("a non-numeric count is never an empty device", () => {
    // Preserved verbatim from the previous Number(x || 0) arithmetic: NaN is not
    // === 0, so unreadable counts fall through to the safe owner.
    expect(Number.isNaN(sumCoreBusinessDocCounts({ customers: "nonsense" }))).toBe(true);
    expect(hasEmptyCoreBusinessCounts({ customers: "nonsense" })).toBe(false);
    expect(resolveOperationOwnerFromCounts({ counts: { customers: "nonsense" }, queueState: CLEAN }))
      .toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
  });

  test("absent count families still read as zero, exactly as before", () => {
    expect(sumCoreBusinessDocCounts(null)).toBe(0);
    expect(sumCoreBusinessDocCounts({})).toBe(0);
    expect(hasEmptyCoreBusinessCounts({})).toBe(true);
  });
});

describe("CASE 7 - dependent-only data never redefines core emptiness", () => {
  test.each([
    ["invoice line items", "invoiceLineItems"],
    ["estimate line items", "estimateLineItems"],
    ["invoice payments", "invoicePayments"],
  ])("orphan %s + clean queue still gives RECOVERY", (_label, family) => {
    const snapshot = { ...emptySnapshot(), [family]: [{ id: "dependent_1" }] };
    expect(resolveOperationOwnerFromSnapshot({ snapshot, queueState: CLEAN }))
      .toBe(CLOUD_OPERATION_OWNER.RECOVERY);

    const counts = { ...emptyCounts(), [family]: 7 };
    expect(sumCoreBusinessDocCounts(counts)).toBe(0);
    expect(resolveOperationOwnerFromCounts({ counts, queueState: CLEAN }))
      .toBe(CLOUD_OPERATION_OWNER.RECOVERY);
  });
});

describe("DELETION-TO-EMPTY - a real user deletion is protected as backup work", () => {
  test("deleting the final core document hands ownership to BACKUP, never RECOVERY", () => {
    // Established device, nothing pending: normal steady state.
    let snapshot = { ...emptySnapshot(), invoices: [{ id: "inv_last" }] };
    let queueState = CLEAN;
    expect(resolveOperationOwnerFromSnapshot({ snapshot, queueState }))
      .toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);

    // The user deletes their final invoice. Core is now empty AND the deletion is
    // queued. This must NOT look like a fresh device.
    snapshot = emptySnapshot();
    queueState = PENDING;
    const owner = resolveOperationOwnerFromSnapshot({ snapshot, queueState });
    expect(owner).toBe(CLOUD_OPERATION_OWNER.BACKUP);
    expect(owner).not.toBe(CLOUD_OPERATION_OWNER.RECOVERY);
    expect(owner).not.toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
  });
});

describe("CASES 12 & 13 - the full handoff arises from state alone", () => {
  test("recovery -> convergence -> backup -> convergence, with no coordinator state", () => {
    // EMPTY + CLEAN -> recovery owns startup.
    let snapshot = emptySnapshot();
    let queueState = CLEAN;
    expect(resolveOperationOwnerFromSnapshot({ snapshot, queueState }))
      .toBe(CLOUD_OPERATION_OWNER.RECOVERY);

    // Recovery hydrates local core. No "recovery complete" flag is consulted --
    // the same pure rule simply answers differently now.
    snapshot = { ...emptySnapshot(), customers: [{ id: "cust_1" }] };
    expect(resolveOperationOwnerFromSnapshot({ snapshot, queueState }))
      .toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);

    // An ordinary local edit queues a generation.
    queueState = PENDING;
    expect(resolveOperationOwnerFromSnapshot({ snapshot, queueState }))
      .toBe(CLOUD_OPERATION_OWNER.BACKUP);

    // The queue drains. Ownership returns on its own.
    queueState = CLEAN;
    expect(resolveOperationOwnerFromSnapshot({ snapshot, queueState }))
      .toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
  });
});

describe("both shapes agree", () => {
  test("snapshot and counts resolve identically across the precedence matrix", () => {
    [CLEAN, PENDING].forEach((queueState) => {
      expect(resolveOperationOwnerFromSnapshot({ snapshot: emptySnapshot(), queueState }))
        .toBe(resolveOperationOwnerFromCounts({ counts: emptyCounts(), queueState }));
      expect(resolveOperationOwnerFromSnapshot({ snapshot: nonEmptySnapshot(), queueState }))
        .toBe(resolveOperationOwnerFromCounts({ counts: nonEmptyCounts(), queueState }));
    });
  });
});
