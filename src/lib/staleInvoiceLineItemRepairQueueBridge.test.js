// The automatic recovery bridge.
//
// The screen said "Cloud backup is up to date" while convergence still saw the
// stale cloud children: with a clean queue nothing ever woke the writer, so the
// repair that already exists could never run. Convergence must therefore be able
// to REQUEST existing backup work -- without ever writing to the cloud itself.

import { renderHook, waitFor, act } from "@testing-library/react";
import useCloudAutoConvergence, {
  requestStaleInvoiceLineItemRepairBackup,
  STALE_INVOICE_LINE_ITEM_REPAIR_QUEUE_REASON,
} from "./useCloudAutoConvergence";
import { runSupabaseCloudConvergence, recoverInterruptedCloudConvergence } from "./supabaseCloudConvergence";
import { resetCloudOperationRunLockForTests } from "./cloudOperationRunLock";
import {
  readCloudBackupQueueState,
  clearCloudBackupDirty,
  CLOUD_BACKUP_SEVERITY,
  CLOUD_BACKUP_PRIORITY,
} from "./cloudBackupQueue";
import { STALE_INVOICE_LINE_ITEM_PLACEHOLDER_REPAIR } from "./supabaseCloudVerification";
import { runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } from "./supabaseCloudOnboarding";
import { updateSupabaseAppRestoreBundle } from "./supabaseAppRestoreBundle";
import useCloudAutoBackup from "./useCloudAutoBackup";

jest.mock("./supabaseCloudConvergence", () => {
  const actual = jest.requireActual("./supabaseCloudConvergence");
  return { ...actual, runSupabaseCloudConvergence: jest.fn(), recoverInterruptedCloudConvergence: jest.fn() };
});

jest.mock("./supabaseCloudOnboarding", () => {
  const actual = jest.requireActual("./supabaseCloudOnboarding");
  return { ...actual, runSupabaseCloudOnboardingBackup: jest.fn() };
});

jest.mock("./supabaseAppRestoreBundle", () => ({
  APP_RESTORE_BUNDLE_STATUS: { COMPLETED: "completed" },
  updateSupabaseAppRestoreBundle: jest.fn(),
}));

const ACTIVE_LOCK = { ready: true, loading: false, isActive: true, isLocked: false };
const convergenceProps = (overrides = {}) => ({
  configured: true, user: { id: "user-1" }, company: { id: "company-1" }, deviceLock: ACTIVE_LOCK, ...overrides,
});

function repairableMismatch(overrides = {}) {
  return {
    ok: false,
    status: "mismatch",
    code: "verification_mismatch",
    noCloudWritesPerformed: true,
    mismatch: {
      verificationOk: true,
      allMatched: false,
      blockerCount: 0,
      repairAvailable: true,
      repairableMismatchOnly: true,
      repairTypes: [STALE_INVOICE_LINE_ITEM_PLACEHOLDER_REPAIR],
      repairRowCount: 16,
      noticeCodes: ["cloud_verification_mismatch"],
      ...overrides,
    },
  };
}

// Fresh-device recovery owns startup: automatic convergence deliberately yields
// while the local core snapshot is completely empty. The localStorage.clear()
// below makes every test read as a brand-new device, which is NOT the condition
// these convergence tests exist to exercise -- a company carrying stale cloud
// children has local business data by definition. Seed the minimum core record
// so the device reads as established and the intended convergence path runs.
//
// This corrects the FIXTURE only. The startup-ownership rule itself is real
// production behavior and is never bypassed, mocked or relaxed here.
function seedNonEmptyLocalCore() {
  localStorage.setItem("estipaid-invoices-v1", JSON.stringify([{ id: "inv_local_1", invoiceNumber: "INV-2604" }]));
}

beforeEach(() => {
  localStorage.clear();
  resetCloudOperationRunLockForTests();
  jest.clearAllMocks();
  recoverInterruptedCloudConvergence.mockReturnValue({ ok: true, recovered: false });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED });
  updateSupabaseAppRestoreBundle.mockResolvedValue({ status: "completed", bundleUpdated: true });
});

afterEach(() => resetCloudOperationRunLockForTests());

describe("TEST 11 - automatic recovery queue bridge", () => {
  test("a repairable-only mismatch enqueues exactly one money-critical repair request", async () => {
    seedNonEmptyLocalCore();
    runSupabaseCloudConvergence.mockResolvedValue(repairableMismatch());

    renderHook(() => useCloudAutoConvergence(convergenceProps()));
    await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(true));

    const queue = readCloudBackupQueueState();
    expect(queue.reasons).toContain(STALE_INVOICE_LINE_ITEM_REPAIR_QUEUE_REASON);
    expect(queue.severity).toBe(CLOUD_BACKUP_SEVERITY.MONEY_CRITICAL);
    expect(queue.priority).toBe(CLOUD_BACKUP_PRIORITY.IMMEDIATE);
    expect(queue.domains).toEqual(expect.arrayContaining(["invoices", "invoice_line_items"]));
    expect(queue.localMutationRevision).toBe(1);
  });

  test("convergence performs no cloud write and calls no repair endpoint itself", async () => {
    seedNonEmptyLocalCore();
    const fetchSpy = jest.spyOn(global, "fetch").mockImplementation(() => {
      throw new Error("convergence must never call the repair endpoint directly");
    });
    try {
      runSupabaseCloudConvergence.mockResolvedValue(repairableMismatch());
      renderHook(() => useCloudAutoConvergence(convergenceProps()));
      await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(true));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test.each([
    ["repairableMismatchOnly is false", { repairableMismatchOnly: false }],
    ["the repair class is not the placeholder class", { repairTypes: ["something_else"] }],
    ["no repair types are reported", { repairTypes: [] }],
  ])("no repair is queued when %s", async (_label, override) => {
    seedNonEmptyLocalCore();
    runSupabaseCloudConvergence.mockResolvedValue(repairableMismatch(override));

    renderHook(() => useCloudAutoConvergence(convergenceProps()));
    await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(readCloudBackupQueueState().pending).toBe(false);
  });

  test("a matched convergence never queues a repair", async () => {
    seedNonEmptyLocalCore();
    runSupabaseCloudConvergence.mockResolvedValue({ ok: true, status: "matched" });

    renderHook(() => useCloudAutoConvergence(convergenceProps()));
    await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(readCloudBackupQueueState().pending).toBe(false);
  });
});

describe("TEST 12 - no queue loop", () => {
  test("repeated identical repairable results during one pending generation queue only once", async () => {
    seedNonEmptyLocalCore();
    runSupabaseCloudConvergence.mockResolvedValue(repairableMismatch());

    renderHook(() => useCloudAutoConvergence(convergenceProps()));
    await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(true));
    const firstRevision = readCloudBackupQueueState().localMutationRevision;

    // Several more foreground scans producing the same repairable verdict.
    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        window.dispatchEvent(new Event("online"));
        await Promise.resolve(); await Promise.resolve();
      });
    }
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(readCloudBackupQueueState().localMutationRevision).toBe(firstRevision);
  });

  test("the pure bridge refuses a second request while the same reason is still pending", () => {
    expect(requestStaleInvoiceLineItemRepairBackup(repairableMismatch())).toBe(true);
    expect(readCloudBackupQueueState().localMutationRevision).toBe(1);

    expect(requestStaleInvoiceLineItemRepairBackup(repairableMismatch())).toBe(false);
    expect(readCloudBackupQueueState().localMutationRevision).toBe(1);
  });

  test("once the queue is drained a genuinely new repairable mismatch can queue again", () => {
    expect(requestStaleInvoiceLineItemRepairBackup(repairableMismatch())).toBe(true);
    const revision = readCloudBackupQueueState().localMutationRevision;

    clearCloudBackupDirty({ syncedRevision: revision });
    expect(readCloudBackupQueueState().pending).toBe(false);

    expect(requestStaleInvoiceLineItemRepairBackup(repairableMismatch())).toBe(true);
    expect(readCloudBackupQueueState().localMutationRevision).toBe(revision + 1);
  });

  test("after convergence settles matched, no repair entry exists", async () => {
    seedNonEmptyLocalCore();
    runSupabaseCloudConvergence.mockResolvedValue({ ok: true, status: "converged", changedFamilies: {} });

    renderHook(() => useCloudAutoConvergence(convergenceProps()));
    await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    const queue = readCloudBackupQueueState();
    expect(queue.pending).toBe(false);
    expect(queue.reasons).not.toContain(STALE_INVOICE_LINE_ITEM_REPAIR_QUEUE_REASON);
  });
});

describe("TEST 20 - the Production-shaped 19-row mismatch", () => {
  // 17 historical kind:"invoice" blanks + 2 kind:"material" blanks, all proven
  // repairable by the verifier, arrive here as a single repairable-only verdict.
  const productionShapedMismatch = () => repairableMismatch({ repairRowCount: 19 });

  // A company carrying 19 stale historical invoice children is by definition NOT
  // a fresh device, so this exercises the real convergence path the mismatch takes.
  beforeEach(seedNonEmptyLocalCore);

  test("queues exactly ONE repair generation, not one per row", async () => {
    runSupabaseCloudConvergence.mockResolvedValue(productionShapedMismatch());

    renderHook(() => useCloudAutoConvergence(convergenceProps()));
    await waitFor(() => expect(runSupabaseCloudConvergence).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(true));

    const queue = readCloudBackupQueueState();
    expect(queue.reasons).toContain(STALE_INVOICE_LINE_ITEM_REPAIR_QUEUE_REASON);
    expect(queue.severity).toBe(CLOUD_BACKUP_SEVERITY.MONEY_CRITICAL);
    expect(queue.priority).toBe(CLOUD_BACKUP_PRIORITY.IMMEDIATE);
    // ONE generation for the whole 19-row batch.
    expect(queue.localMutationRevision).toBe(1);
    expect(queue.reasons.filter((reason) => reason === STALE_INVOICE_LINE_ITEM_REPAIR_QUEUE_REASON)).toHaveLength(1);
  });

  test("repeated scans of the same 19-row mismatch never queue a second request", async () => {
    runSupabaseCloudConvergence.mockResolvedValue(productionShapedMismatch());

    renderHook(() => useCloudAutoConvergence(convergenceProps()));
    await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(true));
    const firstRevision = readCloudBackupQueueState().localMutationRevision;

    for (let i = 0; i < 5; i += 1) {
      await act(async () => {
        window.dispatchEvent(new Event("online"));
        await Promise.resolve(); await Promise.resolve();
      });
    }

    expect(readCloudBackupQueueState().localMutationRevision).toBe(firstRevision);
    expect(requestStaleInvoiceLineItemRepairBackup(productionShapedMismatch())).toBe(false);
    expect(readCloudBackupQueueState().localMutationRevision).toBe(firstRevision);
  });
});

describe("TEST 13 - the existing auto backup worker drains the repair request", () => {
  test("the queued repair reaches runSupabaseCloudOnboardingBackup through the existing worker", async () => {
    // Convergence enqueues the repair exactly as it would in the app...
    expect(requestStaleInvoiceLineItemRepairBackup(repairableMismatch())).toBe(true);
    expect(readCloudBackupQueueState().reasons).toContain(STALE_INVOICE_LINE_ITEM_REPAIR_QUEUE_REASON);

    // ...and the EXISTING auto-backup worker picks it up. No second repair worker.
    renderHook(() => useCloudAutoBackup({
      enabled: true,
      configured: true,
      user: { id: "user-1" },
      company: { id: "company-1" },
      role: "owner",
      immediateDelayMs: 5,
      normalDelayMs: 15,
    }));

    await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalled());
    expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({
      user: { id: "user-1" },
      company: { id: "company-1" },
    }));
  });
});
