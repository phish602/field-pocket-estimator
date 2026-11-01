import { act, renderHook, waitFor } from "@testing-library/react";
import {
  markCloudBootstrapPending,
  clearCloudBackupDirty,
  pauseCloudAutoBackup,
  recordCloudBackupAttemptFailure,
  readCloudBackupQueueState,
  CLOUD_BACKUP_STATUS } from
"./cloudBackupQueue";
import { resetCloudOperationRunLockForTests, tryAcquireCloudOperationRunLock } from "./cloudOperationRunLock";
import { CLOUD_OPERATION_OWNER } from "./cloudOperationOwnership";
import { checkSupabaseCloudOnboardingStatus, runSupabaseCloudOnboardingBackup, CLOUD_ONBOARDING_STATUS } from "./supabaseCloudOnboarding";
import { updateSupabaseAppRestoreBundle } from "./supabaseAppRestoreBundle";
import { ensureCurrentDeviceCanWriteCloud, ensureDeviceFenceStillCurrent } from "./supabaseDeviceLock";
import useCloudAutoBackup, { requestCloudAutoBackupRun, CLOUD_AUTO_BACKUP_REQUEST_EVENT } from "./useCloudAutoBackup";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { appendCloudMutationRecords, createEmptyCloudMutationLedger, readCloudMutationLedger, recordCloudMutationFailure, CLOUD_MUTATION_AUTO_RECOVERY_COOLDOWN_MS } from "./cloudMutationLedger";
import { runSupabaseCloudMutationWrite } from "./supabaseCloudMutationWriter";
import { deriveCloudProductStatus, CLOUD_PRODUCT_STATE } from "./useCloudBackupStatus";

jest.mock("./supabaseCloudOnboarding", () => {
  const actual = jest.requireActual("./supabaseCloudOnboarding");
  return {
    ...actual,
    checkSupabaseCloudOnboardingStatus: jest.fn(),
    runSupabaseCloudOnboardingBackup: jest.fn()
  };
});

jest.mock("./supabaseAppRestoreBundle", () => ({
  APP_RESTORE_BUNDLE_STATUS: { COMPLETED: "completed" },
  updateSupabaseAppRestoreBundle: jest.fn()
}));

jest.mock("./supabaseCloudMutationWriter", () => ({
  runSupabaseCloudMutationWrite: jest.fn()
}));

jest.mock("./vaultRuntimeStore", () => ({
  ...jest.requireActual("./vaultRuntimeStore"),
  runtimeCommitAtomicRecords: jest.fn()
}));

// The worker now takes ONE attempt-level device generation and re-proves it at
// its single clean-capable boundary. Only those two ownership reads are stubbed;
// everything else in the device-lock authority stays real.
jest.mock("./supabaseDeviceLock", () => ({
  ...jest.requireActual("./supabaseDeviceLock"),
  ensureCurrentDeviceCanWriteCloud: jest.fn(),
  ensureDeviceFenceStillCurrent: jest.fn()
}));

const USER = { id: "user-1" };
const COMPANY = { id: "company-1" };

const ATTEMPT_FENCE_A5 = { companyId: "company-1", deviceId: "device-a", lockVersion: 5 };
const ATTEMPT_FENCE_A7 = { companyId: "company-1", deviceId: "device-a", lockVersion: 7 };
const ATTEMPT_FENCE_B6 = { companyId: "company-1", deviceId: "device-b", lockVersion: 6 };
function attemptAccessOk(fence = ATTEMPT_FENCE_A5) {
  return { ok: true, access: { isActive: true, isLocked: false, fence }, error: "" };
}
const FAST_DELAYS = { immediateDelayMs: 5, normalDelayMs: 15 };

function baseProps(overrides = {}) {
  return {
    enabled: true,
    configured: true,
    user: USER,
    company: COMPANY,
    role: "owner",
    ...FAST_DELAYS,
    ...overrides
  };
}

beforeEach(() => {
  localStorage.clear();
  resetCloudOperationRunLockForTests();
  runSupabaseCloudOnboardingBackup.mockReset();
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED });
  checkSupabaseCloudOnboardingStatus.mockReset();
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP });
  updateSupabaseAppRestoreBundle.mockReset();
  updateSupabaseAppRestoreBundle.mockResolvedValue({ status: "completed", bundleUpdated: true });
  // A worker that actually runs is, in production, an authorized active device
  // holding a lease generation.
  ensureCurrentDeviceCanWriteCloud.mockReset();
  ensureCurrentDeviceCanWriteCloud.mockResolvedValue(attemptAccessOk());
  ensureDeviceFenceStillCurrent.mockReset();
  ensureDeviceFenceStillCurrent.mockResolvedValue({ ok: true, code: "", deviceLockLost: false });
  runSupabaseCloudMutationWrite.mockReset();
  runSupabaseCloudMutationWrite.mockResolvedValue({ ok: true, verified: true, verifiedAt: 777 });
  const { runtimeCommitAtomicRecords } = jest.requireMock("./vaultRuntimeStore");
  runtimeCommitAtomicRecords.mockReset();
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
});

afterEach(() => {
  resetCloudOperationRunLockForTests();
});

describe("shared automatic-operation ownership", () => {
  // CASE 11 (backup side): a clean, positively-empty core device is recovery's
  // turn. Automatic backup must not take the shared run lock or write cloud.
  test("does not run on a clean empty-core device where recovery owns the operation", async () => {
    localStorage.clear();
    // A queue generation exists but carries no local core data behind it.
    markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });
    clearCloudBackupDirty({ syncedRevision: readCloudBackupQueueState().localMutationRevision });
    expect(readCloudBackupQueueState().pending).toBe(false);

    renderHook(() => useCloudAutoBackup(baseProps()));
    await act(async () => {await new Promise((resolve) => setTimeout(resolve, 40));});

    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    expect(tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP)).toBeTruthy();
    resetCloudOperationRunLockForTests();
  });

  // CASE 10 / DELETION-TO-EMPTY (backup side): the user deleted their last core
  // document. Core is empty AND a real generation is pending -- that is BACKUP's
  // work, not a fresh device, so the existing backup path must still run.
  test("still runs when the user deletes their final core document, leaving an empty core with pending work", async () => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));
    markCloudBootstrapPending({ reason: "invoice_deleted", severity: "money_critical" });
    expect(readCloudBackupQueueState().pending).toBe(true);

    renderHook(() => useCloudAutoBackup(baseProps()));

    await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
    expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({
      user: USER,
      company: COMPANY
    }));
  });
});

test("pending normal-priority BOOTSTRAP queue schedules and runs automatic onboarding", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(
    expect.objectContaining({ configured: true, user: USER, company: COMPANY, role: "owner" })
  );

  unmount();
});

test("an explicit first-bootstrap queue performs onboarding automatically without a Settings action", async () => {
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([{ id: "first-project", name: "First job" }]));
  markCloudBootstrapPending({
    reason: "first_project_saved",
    domains: ["projects"],
    documentId: "first-project",
    companyId: COMPANY.id,
    severity: "normal"
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: false, status: CLOUD_BACKUP_STATUS.CLEAN }));
  unmount();
});

test("historical global conflict does not block a newer invoice ledger mutation", async () => {
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({
    schemaVersion: "1.0.0", pending: true, status: "conflict", localMutationRevision: 99
  }));
  localStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT, JSON.stringify({ entries: [{ id: "historical" }] }));
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{ entityType: "invoice", operation: "upsert",
    companyId: COMPANY.id,
    documentId: "inv-new",
    payload: { id: "inv-new", invoiceNumber: "INV-NEW", payments: [] }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("acknowledged"));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  expect(readCloudBackupQueueState().status).toBe("conflict");
  unmount();
});

test("historical workspace divergence does not block an EST-2606 estimate mutation from exact acknowledgement", async () => {
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({
    schemaVersion: "2.0.0", pending: true, status: "conflict", localMutationRevision: 99,
    syncingRevision: null, companyId: COMPANY.id, reasons: [], domains: [], lastError: "Historical unrelated divergence"
  }));
  localStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT, JSON.stringify({ entries: [
    { family: "customers", id: "unrelated-customer" },
    { family: "projects", id: "unrelated-project" },
    { family: "invoices", id: "unrelated-invoice" }]
  }));
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{
    companyId: COMPANY.id,
    entityType: "estimate",
    documentId: "estimate-2606",
    payload: {
      id: "estimate-2606",
      estimateNumber: "EST-2606",
      total: 6000,
      materials: { items: [{ id: "material-1", priceEach: 2000 }] }
    }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudMutationWrite).toHaveBeenCalledWith(expect.objectContaining({
    mutation: expect.objectContaining({ entityType: "estimate", documentId: "estimate-2606", payload: appended.appended[0].payload })
  })));
  await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("acknowledged"));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  expect(readCloudBackupQueueState().status).toBe("conflict");
  unmount();
});

test("exact EST-2606 +$1,000 automatic flow acknowledges and retires only its older compatibility failure", async () => {
  const queue = {
    schemaVersion: "3.0.0",
    pending: true,
    status: "conflict",
    reviewOrigin: "current_sync_failure",
    lastError: "Historical whole-workspace mismatch",
    lastErrorCode: "data_mismatch",
    documentId: "estimate-2606",
    companyId: COMPANY.id,
    domains: ["estimates"],
    lastQueuedAt: 1000,
    localMutationRevision: 9,
    syncingRevision: null,
    reasons: ["legacy_estimate_save"],
    severity: "normal",
    priority: "normal"
  };
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify(queue));
  localStorage.setItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT, JSON.stringify({ entries: [
    { family: "customers", id: "unrelated-customer" },
    { family: "payments", id: "unrelated-payment" }]
  }));
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{
    companyId: COMPANY.id,
    entityType: "estimate",
    documentId: "estimate-2606",
    createdAt: 2000,
    payload: {
      id: "estimate-2606",
      estimateNumber: "EST-2606",
      total: 6000,
      materials: { items: [{ id: "material-1", priceEach: 2000 }] }
    }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  runSupabaseCloudMutationWrite.mockResolvedValue({
    ok: true,
    verified: true,
    verifiedAt: 3000,
    cleanup: { table: "estimate_line_items", deletedIds: ["stale-est-2606-line"] }
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("acknowledged"));
  await waitFor(() => expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: false, status: "clean" })));

  expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1);
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_CONFLICT_VAULT))).toEqual({ entries: [
    { family: "customers", id: "unrelated-customer" },
    { family: "payments", id: "unrelated-payment" }]
  });
  expect(readCloudBackupQueueState().supersededCompatibilityFailure).toEqual(expect.objectContaining({
    documentId: "estimate-2606",
    lastErrorCode: "data_mismatch"
  }));
  const product = deriveCloudProductStatus({
    connected: true,
    queueState: readCloudBackupQueueState(),
    mutationLedger: readCloudMutationLedger(),
    decision: { verifiedCurrent: true }
  });
  expect(product.state).toBe(CLOUD_PRODUCT_STATE.CLOUD_OK);
  unmount();
});

test("startup repairs an already-acknowledged EST-2606 queue failure without network work", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{
    companyId: COMPANY.id,
    entityType: "estimate",
    documentId: "estimate-2606",
    createdAt: 2000,
    payload: { id: "estimate-2606", total: 6000 }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify({
    ...appended.ledger,
    lastAcknowledgedRevision: 1,
    lastVerifiedAt: 3000,
    entries: [{ ...appended.ledger.entries[0], status: "acknowledged", acknowledgedAt: 3000, verifiedAt: 3000 }]
  }));
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({
    schemaVersion: "3.0.0",
    pending: true,
    status: "needs_attention",
    lastErrorCode: "data_mismatch",
    documentId: "estimate-2606",
    companyId: COMPANY.id,
    domains: ["estimates"],
    lastQueuedAt: 1000,
    localMutationRevision: 3,
    reasons: [],
    severity: "normal",
    priority: "normal"
  }));

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: false, status: "clean" })));
  expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  unmount();
});

test("mount and visibility do not retry an unchanged cooled-down terminal mutation", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{
    companyId: COMPANY.id,
    entityType: "estimate",
    documentId: "estimate-recover",
    payload: { id: "estimate-recover", total: 7000 }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify({
    ...appended.ledger,
    entries: [{
      ...appended.ledger.entries[0],
      status: "needs_attention",
      retryCount: 3,
      lastAttemptAt: Date.now() - 31000,
      lastError: "temporary permission failure",
      lastErrorCode: "estimate_line_items_target_cleanup_failed"
    }]
  }));

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await act(async () => {await new Promise((resolve) => setTimeout(resolve, 40));});
  expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
  expect(readCloudMutationLedger().entries[0].status).toBe("needs_attention");
  act(() => document.dispatchEvent(new Event("visibilitychange")));
  await act(async () => {await new Promise((resolve) => setTimeout(resolve, 40));});
  expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
  unmount();
});

test("device readiness alone cannot resurrect unchanged NEEDS_ATTENTION work", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{
    companyId: COMPANY.id,
    entityType: "estimate",
    documentId: "estimate-device-ready",
    payload: { id: "estimate-device-ready" }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify({
    ...appended.ledger,
    entries: [{ ...appended.ledger.entries[0], status: "needs_attention", retryCount: 3, lastAttemptAt: Date.now() - 31000 }]
  }));
  const { rerender, unmount } = renderHook(
    ({ locked }) => useCloudAutoBackup(baseProps({ deviceLocked: locked })),
    { initialProps: { locked: true } }
  );
  await act(async () => {await new Promise((resolve) => setTimeout(resolve, 30));});
  expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
  rerender({ locked: false });
  await act(async () => {await new Promise((resolve) => setTimeout(resolve, 40));});
  expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
  expect(readCloudMutationLedger().entries[0].retryCount).toBe(3);
  unmount();
});

test("target verification failure leaves the exact ledger mutation unacknowledged", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{ entityType: "invoice", operation: "upsert",
    companyId: COMPANY.id,
    documentId: "inv-fail",
    payload: { id: "inv-fail", payments: [{ id: "pay-1", paidAt: "2026-08-24T00:00:00.000Z" }] }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  runSupabaseCloudMutationWrite.mockResolvedValue({ ok: false, verified: false, code: "target_verification_failed" });
  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("retry_wait"));
  expect(readCloudMutationLedger().entries[0].acknowledgedAt).toBeNull();
  unmount();
});

test("strict estimate verification failure leaves the exact estimate mutation unacknowledged", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{
    companyId: COMPANY.id,
    entityType: "estimate",
    documentId: "estimate-2606",
    payload: { id: "estimate-2606", estimateNumber: "EST-2606", total: 6000 }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  runSupabaseCloudMutationWrite.mockResolvedValue({ ok: false, verified: false, code: "target_verification_failed" });
  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("retry_wait"));
  expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({ entityType: "estimate", acknowledgedAt: null }));
  unmount();
});

test("manual Retry Sync requeues a current ledger failure and wakes the existing targeted worker", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{ entityType: "invoice", operation: "upsert",
    companyId: COMPANY.id,
    documentId: "inv-manual-retry",
    payload: { id: "inv-manual-retry", payments: [] }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  await recordCloudMutationFailure(appended.appended[0], { error: "one" });
  await recordCloudMutationFailure(appended.appended[0], { error: "two" });
  await recordCloudMutationFailure(appended.appended[0], { error: "three" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ immediateDelayMs: 100000 })));
  expect(readCloudMutationLedger().entries[0].status).toBe("needs_attention");

  await act(async () => {
    await requestCloudAutoBackupRun("manual_retry_test");
  });

  await waitFor(() => expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("acknowledged"));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  unmount();
});

test("offline invoice mutation remains durably pending without becoming a failure", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{ entityType: "invoice", operation: "upsert",
    companyId: COMPANY.id, documentId: "inv-offline", payload: { id: "inv-offline", payments: [] }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await act(async () => {await new Promise((resolve) => setTimeout(resolve, 30));});
  expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
  expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({ status: "pending", retryCount: 0 }));
  unmount();
  if (descriptor) Object.defineProperty(navigator, "onLine", descriptor);else
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

test("offline estimate mutation remains durably pending without invoking whole-workspace backup", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{
    companyId: COMPANY.id,
    entityType: "estimate",
    documentId: "estimate-offline",
    payload: { id: "estimate-offline", estimateNumber: "EST-OFFLINE" }
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await act(async () => {await new Promise((resolve) => setTimeout(resolve, 30));});
  expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({ entityType: "estimate", status: "pending", retryCount: 0 }));
  unmount();
  if (descriptor) Object.defineProperty(navigator, "onLine", descriptor);else
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

test("money-critical/immediate queue runs faster than normal-priority", async () => {
  markCloudBootstrapPending({ reason: "invoice_saved", severity: "money_critical" });

  const start = Date.now();
  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ immediateDelayMs: 5, normalDelayMs: 500 })));

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  expect(Date.now() - start).toBeLessThan(500);

  unmount();
});

test("no pending queue does not run a backup", async () => {
  clearCloudBackupDirty("test_setup");

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  unmount();
});

test("an unresolved convergence journal blocks automatic cloud backup", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });
  localStorage.setItem("estipaid-cloud-convergence-journal-v1", JSON.stringify({ version: 1, previous: {} }));
  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  unmount();
});

test("signed-out state (enabled=false) does not run a backup", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ enabled: false })));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  unmount();
});

test("Supabase not configured does not run a backup", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ configured: false })));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  unmount();
});

test("missing company/workspace context does not run a backup", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ company: null })));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  unmount();
});

test("backup success clears the queue back to current", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });
  runSupabaseCloudOnboardingBackup.mockImplementation(async () => {
    clearCloudBackupDirty("manual_backup_success");
    return { status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED };
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(false));
  expect(readCloudBackupQueueState().status).toBe(CLOUD_BACKUP_STATUS.CURRENT);

  unmount();
});

test("a verified automatic backup captures the latest saved Company Profile and logo in the app restore bundle", async () => {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({
    companyName: "Desert Ridge Updated",
    logoDataUrl: "data:image/png;base64,replacement-logo"
  }));
  markCloudBootstrapPending({ reason: "company_profile_saved", domains: ["company_profile"], severity: "normal" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED,
    verification: { ok: true, allMatched: true, notices: [] }
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(updateSupabaseAppRestoreBundle).toHaveBeenCalledWith(expect.objectContaining({
    storageSnapshot: localStorage,
    configured: true,
    user: USER,
    company: COMPANY,
    role: "owner"
  })));
  expect(JSON.parse(updateSupabaseAppRestoreBundle.mock.calls[0][0].storageSnapshot.getItem(STORAGE_KEYS.COMPANY_PROFILE))).toEqual({
    companyName: "Desert Ridge Updated",
    logoDataUrl: "data:image/png;base64,replacement-logo"
  });
  unmount();
});

test("a failed app restore-bundle capture keeps the cloud queue pending", async () => {
  markCloudBootstrapPending({ reason: "company_profile_saved", domains: ["company_profile"], severity: "normal" });
  runSupabaseCloudOnboardingBackup.mockImplementation(async () => {
    clearCloudBackupDirty("business_backup_verified");
    return {
      status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED,
      verification: { ok: true, allMatched: true, notices: [] }
    };
  });
  updateSupabaseAppRestoreBundle.mockResolvedValue({
    status: "error",
    bundleUpdated: false,
    error: "Unable to update the app restore bundle in Supabase."
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(updateSupabaseAppRestoreBundle).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: true })));
  expect(readCloudBackupQueueState().status).not.toBe(CLOUD_BACKUP_STATUS.CURRENT);
  unmount();
});

test("backup failure records the failure and keeps the queue pending", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
    error: "Unable to complete cloud backup."
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(readCloudBackupQueueState().status).toBe(CLOUD_BACKUP_STATUS.FAILED));
  const state = readCloudBackupQueueState();
  expect(state.pending).toBe(true);
  expect(state.attempts).toBeGreaterThan(0);
  expect(state.lastError).toBeTruthy();

  unmount();
});

test("a fresh bundle automatically recovers one pending NEEDS_ATTENTION item without a Retry Sync click", async () => {
  markCloudBootstrapPending({ reason: "stale_invoice_duplicate", severity: "money_critical" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: true, status: CLOUD_BACKUP_STATUS.NEEDS_ATTENTION, lastError: "previous browser delete path failed" }));

  const localRecords = { customers: "local-customers", projects: "local-projects", estimates: "local-estimates", invoices: "local-invoices" };
  Object.entries(localRecords).forEach(([key, value]) => localStorage.setItem(key, value));
  runSupabaseCloudOnboardingBackup.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED,
    writeResult: { staleInvoiceLineItemRepair: { ok: true, repaired: 2 } },
    verification: { ok: true },
    noLocalDeletes: true
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: false, status: CLOUD_BACKUP_STATUS.CURRENT })));
  await new Promise((resolve) => setTimeout(resolve, 40));

  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1);
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({ user: USER, company: COMPANY, role: "owner" }));
  Object.entries(localRecords).forEach(([key, value]) => expect(localStorage.getItem(key)).toBe(value));
  unmount();
});

test("failed fresh-bundle NEEDS_ATTENTION recovery remains pending without a same-session retry loop", async () => {
  markCloudBootstrapPending({ reason: "stale_invoice_duplicate", severity: "money_critical" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  recordCloudBackupAttemptFailure("previous browser delete path failed", { errorCode: "legacy_browser_delete" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION, error: "server repair unavailable" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: true, status: CLOUD_BACKUP_STATUS.NEEDS_ATTENTION, lastError: "server repair unavailable" })));
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1);
  unmount();
});

test("manual Retry Sync wakes the same worker for retryable non-ledger needs_attention work", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });
  recordCloudBackupAttemptFailure("one");
  recordCloudBackupAttemptFailure("two");
  recordCloudBackupAttemptFailure("three");
  expect(readCloudBackupQueueState().status).toBe(CLOUD_BACKUP_STATUS.NEEDS_ATTENTION);

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ normalDelayMs: 100000 })));
  await act(async () => {
    await requestCloudAutoBackupRun("manual_retry_test");
  });

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  unmount();
});

test("device-lock abort leaves the pending queue untouched instead of recording a backup failure", async () => {
  markCloudBootstrapPending({ reason: "invoice_saved", severity: "money_critical" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
    deviceLockLost: true,
    error: "Backup stopped because EstiPaid was switched to another device."
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));

  expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({
    pending: true,
    attempts: 0,
    lastError: ""
  }));
  unmount();
});

test("a mutation during upload schedules one follow-up backup after the first completes", async () => {
  markCloudBootstrapPending({ reason: "invoice_saved", severity: "money_critical" });
  let resolveBackup;
  runSupabaseCloudOnboardingBackup.mockImplementation(
    () => new Promise((resolve) => {resolveBackup = resolve;})
  );

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));

  // A second dirty event arrives while the first attempt is still in flight.
  markCloudBootstrapPending({ reason: "invoice_saved", severity: "money_critical" });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1);

  resolveBackup({ status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED });
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(2));
  unmount();
});

test("pending queue resumes on hook remount", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION });

  const first = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  first.unmount();

  const second = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(2), { timeout: 3000 });
  second.unmount();
});

test("browser online event retries a pending queue", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ normalDelayMs: 100000 })));

  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  act(() => {
    window.dispatchEvent(new Event("online"));
  });

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));

  unmount();
});

test("offline mutation remains safely queued until connectivity returns", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "onLine");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  markCloudBootstrapPending({ reason: "invoice_saved", severity: "money_critical" });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(readCloudBackupQueueState().status).toBe("offline_pending"));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
  act(() => window.dispatchEvent(new Event("online")));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));

  if (descriptor) Object.defineProperty(navigator, "onLine", descriptor);
  unmount();
});

test("deferred-priority queue does not auto-run even when pending", async () => {
  markCloudBootstrapPending({ reason: "low_priority_change", severity: "low", priority: "deferred" });
  expect(readCloudBackupQueueState().priority).toBe("deferred");

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  unmount();
});

test("does not run while a manual backup already holds the shared run lock", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });
  expect(tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP)).toBeTruthy();

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  resetCloudOperationRunLockForTests();
  unmount();
});

test("takeover pause blocks automatic backup until a fresh local change re-dirties the queue", async () => {
  markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });
  pauseCloudAutoBackup("device_takeover");

  const hook = renderHook(() => useCloudAutoBackup(baseProps()));

  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  markCloudBootstrapPending({ reason: "estimate_saved_after_takeover", severity: "normal" });

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  hook.unmount();
});

test("a permanent identity conflict stops automatic retries and remains review-required", async () => {
  markCloudBootstrapPending({ reason: "invoice_saved", severity: "money_critical" });
  runSupabaseCloudOnboardingBackup.mockResolvedValue({
    status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
    permanentIdentityConflict: true,
    syncReviewState: "conflict",
    reason: "Cloud records require identity review."
  });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(readCloudBackupQueueState().status).toBe(CLOUD_BACKUP_STATUS.CONFLICT));
  await new Promise((resolve) => setTimeout(resolve, 40));
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1);
  unmount();
});

// Gate E2: a burst of ordinary local edits (one pe-localstorage event each) must
// debounce into a SINGLE backup + verify scan, not one scan per mutation.
test("a burst of 100 dirty events inside the debounce window produces exactly one backup (Gate E2)", async () => {
  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps({ normalDelayMs: 30 })));

  act(() => {
    for (let i = 0; i < 100; i += 1) {
      markCloudBootstrapPending({ reason: "field_edit", severity: "normal" });
    }
  });

  await waitFor(() => expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1));
  // The whole burst collapsed to one operation; no per-mutation scans followed.
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1);
  unmount();
});

// Gate E2.2: pagehide's ONLY job is to cancel an already-scheduled backup timer
// before it fires. Proven deterministically with fake timers by advancing PAST
// the configured deadline (not merely waiting less than the delay) and showing:
// zero backups fired, the pending queue is preserved, and a later safe remount
// resumes the pending backup exactly once.
test("pagehide cancels an already-scheduled backup and a later remount resumes it exactly once (Gate E2.2)", async () => {
  jest.useFakeTimers();
  try {
    const DELAY = 5000;
    markCloudBootstrapPending({ reason: "project_saved", severity: "normal" }); // eligible pending queue

    const first = renderHook(() => useCloudAutoBackup(baseProps({ normalDelayMs: DELAY, immediateDelayMs: DELAY })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    // (2) A backup timer is scheduled, but its deadline has not arrived.
    expect(jest.getTimerCount()).toBeGreaterThan(0);
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

    // (3) pagehide BEFORE the deadline cancels the scheduled backup.
    act(() => {window.dispatchEvent(new Event("pagehide"));});

    // (4) Advance well PAST the original deadline: the cancelled timer must not fire.
    await act(async () => {jest.advanceTimersByTime(DELAY + 3000);await Promise.resolve();});

    // (5) Zero backup calls.
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    // (6) The dirty queue is untouched by pagehide -- still pending/persisted.
    expect(readCloudBackupQueueState().pending).toBe(true);

    first.unmount();

    // (7) A safe remount and (8) the still-pending backup resumes exactly once.
    const second = renderHook(() => useCloudAutoBackup(baseProps({ normalDelayMs: DELAY, immediateDelayMs: DELAY })));
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => {jest.advanceTimersByTime(DELAY);await Promise.resolve();await Promise.resolve();});
    expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledTimes(1);

    second.unmount();
  } finally {
    jest.useRealTimers();
  }
});

// ATTEMPT START-FENCE: the worker's logical attempt spans onboarding, app
// restore bundle capture and baseline capture. Each of those fences itself, but
// the ATTEMPT did not, so A/v5 could finish onboarding, lose the workspace to
// B/v6, take it back as A/v7, and still hand a completed result to the shared
// queue classifier -- marking clean an attempt that crossed generations.
describe("automatic backup attempt START fence", () => {
  function completingBackup() {
    runSupabaseCloudOnboardingBackup.mockImplementation(async () => {
      clearCloudBackupDirty("manual_backup_success");
      return { status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED };
    });
  }

  test("a stable generation still reaches a clean queue", async () => {
    // Positive control: without it, the stale cases below could pass on a run
    // that never reached the final classifier at all.
    completingBackup();
    markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

    const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

    await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(false));
    expect(readCloudBackupQueueState().status).toBe(CLOUD_BACKUP_STATUS.CURRENT);
    expect(ensureDeviceFenceStillCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ fence: ATTEMPT_FENCE_A5 })
    );

    unmount();
  });

  test("A(v5) -> B(v6) -> A(v7) cannot mark the queue clean", async () => {
    completingBackup();
    ensureCurrentDeviceCanWriteCloud.mockResolvedValue(attemptAccessOk(ATTEMPT_FENCE_A5));
    // Same device, active again -- but a generation this attempt never owned.
    ensureDeviceFenceStillCurrent.mockResolvedValue({
      ok: false,
      code: "device_lock_lost",
      deviceLockLost: true,
      fence: ATTEMPT_FENCE_A5,
      currentFence: ATTEMPT_FENCE_A7,
      userMessage: "Backup stopped because EstiPaid was switched to another device.",
      error: "Backup stopped because EstiPaid was switched to another device."
    });
    markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

    const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

    // It genuinely reached the clean-capable boundary.
    await waitFor(() => expect(ensureDeviceFenceStillCurrent).toHaveBeenCalledTimes(1));
    expect(ensureDeviceFenceStillCurrent).toHaveBeenCalledWith(
      expect.objectContaining({ fence: ATTEMPT_FENCE_A5 })
    );
    // FORBIDDEN: a clean transition earned across a generation change.
    await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(true));
    expect(readCloudBackupQueueState().status).not.toBe(CLOUD_BACKUP_STATUS.CURRENT);

    unmount();
  });

  test("a takeover by another device cannot mark the queue clean", async () => {
    completingBackup();
    ensureDeviceFenceStillCurrent.mockResolvedValue({
      ok: false,
      code: "device_lock_lost",
      deviceLockLost: true,
      fence: ATTEMPT_FENCE_A5,
      currentFence: ATTEMPT_FENCE_B6,
      userMessage: "Backup stopped because EstiPaid was switched to another device.",
      error: "Backup stopped because EstiPaid was switched to another device."
    });
    markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

    const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

    await waitFor(() => expect(ensureDeviceFenceStillCurrent).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(readCloudBackupQueueState().pending).toBe(true));

    unmount();
  });

  test("an attempt that cannot prove a starting generation never runs", async () => {
    ensureCurrentDeviceCanWriteCloud.mockResolvedValue({
      ok: false,
      code: "device_lock_lost",
      deviceLockLost: true,
      error: "Backup stopped because EstiPaid was switched to another device."
    });
    markCloudBootstrapPending({ reason: "project_saved", severity: "normal" });

    const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));

    await new Promise((resolve) => setTimeout(resolve, 60));
    // Stopped before the queue was even marked syncing; the work stays pending.
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    expect(readCloudBackupQueueState().pending).toBe(true);

    unmount();
  });
});

// A permission change is not represented by durable dependency evidence. The
// deliberate manual path can still retry and verify the exact failed invoice.
test("manual retry finishes the same failed invoice mutation once its delete is permitted", async () => {
  const VERIFIED_AT = Date.parse("2026-08-26T17:00:00.000Z");
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{
    companyId: COMPANY.id,
    entityType: "invoice",
    documentId: "invoice-2606",
    createdAt: 2000,
    payload: { id: "invoice-2606", invoiceNumber: "INV-2606", total: 6000, payments: [{ id: "pay-1", amount: 6000 }] }
  }]);
  const failedMutation = appended.appended[0];
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify({
    ...appended.ledger,
    entries: appended.ledger.entries.map((entry) => ({
      ...entry,
      status: "needs_attention",
      retryCount: 3,
      nextRetryAt: null,
      // Elapsed cooldown alone is no longer permission for an automatic retry.
      lastAttemptAt: Date.now() - CLOUD_MUTATION_AUTO_RECOVERY_COOLDOWN_MS - 1000,
      lastError: "Exact invoice_payments deletion could not be verified.",
      lastErrorCode: "invoice_payments_target_cleanup_failed"
    }))
  }));

  // Before: a real, unacknowledged, current failure -- a truthful Sync issue.
  expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({
    status: "needs_attention",
    lastErrorCode: "invoice_payments_target_cleanup_failed",
    acknowledgedAt: null
  }));
  expect(deriveCloudProductStatus({
    connected: true,
    queueState: readCloudBackupQueueState(),
    mutationLedger: readCloudMutationLedger(),
    decision: { ledgerFailed: true }
  })).toEqual(expect.objectContaining({
    state: CLOUD_PRODUCT_STATE.SYNC_ISSUE,
    lastSuccessfulSyncAt: null
  }));

  // The next writer attempt succeeds because the delete is now permitted.
  runSupabaseCloudMutationWrite.mockResolvedValue({ ok: true, verified: true, verifiedAt: VERIFIED_AT });

  const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
  await act(async () => { await requestCloudAutoBackupRun("manual_retry"); });

  await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("acknowledged"));

  // The SAME mutation was retried -- not a new one, and only once.
  expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1);
  expect(runSupabaseCloudMutationWrite).toHaveBeenCalledWith(expect.objectContaining({
    mutation: expect.objectContaining({
      mutationId: failedMutation.mutationId,
      revision: failedMutation.revision,
      entityType: "invoice",
      documentId: "invoice-2606"
    })
  }));
  expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();

  // Only now does the product clock move, and only from real verification.
  const ledger = readCloudMutationLedger();
  expect(ledger.lastVerifiedAt).toBe(VERIFIED_AT);
  expect(deriveCloudProductStatus({
    connected: true,
    queueState: readCloudBackupQueueState(),
    mutationLedger: ledger,
    decision: { verifiedCurrent: true }
  })).toEqual(expect.objectContaining({
    state: CLOUD_PRODUCT_STATE.CLOUD_OK,
    lastSuccessfulSyncAt: VERIFIED_AT
  }));
  unmount();
});


describe("parent-missing mutation lifecycle", () => {
  function seed({ parentPending = false, superseded = false } = {}) {
    const inputs = [{
      companyId: COMPANY.id, entityType: "estimate", documentId: "E1",
      payload: { id: "E1", projectId: "P1", total: 100 },
    }];
    if (parentPending) inputs.push({ companyId: COMPANY.id, entityType: "project", documentId: "P1", payload: { id: "P1" } });
    if (superseded) inputs.push({ ...inputs[0], payload: { id: "E1", projectId: "P1", total: 200 } });
    const { ledger } = appendCloudMutationRecords(createEmptyCloudMutationLedger(), inputs);
    ledger.entries[0] = { ...ledger.entries[0], status: "needs_attention", retryCount: 3,
      lastAttemptAt: Date.now() - 31000, lastErrorCode: "projects_parent_missing" };
    if (superseded) {
      ledger.entries[1] = { ...ledger.entries[1], status: "acknowledged", verifiedAt: 5000, acknowledgedAt: 5000 };
      ledger.lastVerifiedAt = 5000;
      ledger.lastAcknowledgedRevision = 2;
    }
    localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));
    return ledger;
  }
  async function lifecycleEvents() {
    await act(async () => {
      for (let i = 0; i < 10; i += 1) {
        window.dispatchEvent(new Event("online"));
        document.dispatchEvent(new Event("visibilitychange"));
        window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: STORAGE_KEYS.CLOUD_MUTATION_LEDGER } }));
      }
      await new Promise(resolve => setTimeout(resolve, 60));
    });
  }
  test("worker retires proven historical failure on mount without a cloud call or clock change", async () => {
    seed({ superseded: true });
    const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("acknowledged"));
    expect(readCloudMutationLedger().entries[0].verifiedAt).toBeNull();
    expect(readCloudMutationLedger().lastVerifiedAt).toBe(5000);
    expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    unmount();
  });
  test.each([true, false])("project acknowledgement unlocks one estimate attempt; success=%s", async succeeds => {
    seed({ parentPending: true });
    runSupabaseCloudMutationWrite.mockImplementation(async ({ mutation }) => {
      if (mutation.entityType === "project" || succeeds) return { ok: true, verified: true, verifiedAt: Date.now() };
      return { ok: false, verified: false, code: "projects_parent_missing" };
    });
    const first = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe(succeeds ? "acknowledged" : "needs_attention"));
    expect(runSupabaseCloudMutationWrite.mock.calls.map(([args]) => args.mutation.entityType)).toEqual(["project", "estimate"]);
    expect(readCloudMutationLedger().entries[0].automaticRecoveryProof).toBeTruthy();
    await lifecycleEvents();
    first.unmount();
    const second = renderHook(() => useCloudAutoBackup(baseProps()));
    await lifecycleEvents();
    expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(2);
    expect(readCloudMutationLedger().entries[0].retryCount).toBe(succeeds ? 3 : 4);
    second.unmount();
  });
  test("unchanged current failure stays at three across events, ownership readiness and remount", async () => {
    seed();
    const first = renderHook(() => useCloudAutoBackup(baseProps()));
    await lifecycleEvents();
    first.unmount();
    const second = renderHook(() => useCloudAutoBackup(baseProps()));
    await lifecycleEvents();
    expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
    expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({ status: "needs_attention", retryCount: 3, acknowledgedAt: null }));
    second.unmount();
  });
});


describe("exact historical revision-2 retry investigation", () => {
  function historicalLedger() {
    localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify({
      ...readCloudBackupQueueState(), pending: false, status: "clean", purpose: "legacy_compatibility",
    }));
    const inputs = Array.from({ length: 28 }, (_, index) => ({
      companyId: COMPANY.id, entityType: "estimate", documentId: "historical-" + (index + 1),
      payload: { id: "historical-" + (index + 1), projectId: "missing-parent-" + (index + 1) },
    }));
    const { ledger } = appendCloudMutationRecords(createEmptyCloudMutationLedger(), inputs);
    ledger.entries = ledger.entries.map(entry => ({
      ...entry, status: "acknowledged", acknowledgedAt: 1000, verifiedAt: 1000,
    }));
    [1, 2, 14, 15].forEach(index => {
      ledger.entries[index] = {
        ...ledger.entries[index], status: "needs_attention", acknowledgedAt: null, verifiedAt: null,
        retryCount: index === 1 ? 290 : index === 2 ? 13 : 3, lastAttemptAt: 2000,
        lastErrorCode: index === 14 ? "estimate_write_failed" : index === 15 ? "estimates_parent_missing" : "projects_parent_missing",
        ...(index === 1 ? { companyId: "" } : {}),
        ...(index === 15 ? { entityType: "invoice" } : {}),
      };
    });
    ledger.lastAcknowledgedRevision = 28;
    ledger.lastVerifiedAt = 1000;
    // The inspected live revision 2 has no companyId or recovery marker.
    // Preserve its original count: a stopped historical failure is not reset.
    localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));
    return ledger;
  }
  test("current production hook keeps exact historical 290 across 300 timed wakeups, effect recreation and reload-shaped remount", async () => {
    jest.useFakeTimers("modern");
    try {
      const before = historicalLedger();
      const { runtimeCommitAtomicRecords } = jest.requireMock("./vaultRuntimeStore");
      // Match the production runtime's asynchronous durable publication and
      // per-key event delivery, which the older synchronous test mock omitted.
      runtimeCommitAtomicRecords.mockImplementation(async records => {
        await Promise.resolve();
        const previous = new Map(records.map(record => [record.logicalKey, localStorage.getItem(record.logicalKey)]));
        records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
        records.forEach(({ logicalKey, value }) => {
          if (previous.get(logicalKey) !== value) {
            window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: logicalKey, value, oldValue: previous.get(logicalKey), crossTab: true } }));
          }
        });
        return { ok: true };
      });
      runSupabaseCloudMutationWrite.mockResolvedValue({ ok: false, verified: false, code: "projects_parent_missing" });
      const first = renderHook(({ enabled, locked }) => useCloudAutoBackup(baseProps({ enabled, deviceLocked: locked })),
        { initialProps: { enabled: true, locked: false } });
      for (let cycle = 0; cycle < 300; cycle += 1) {
        await act(async () => {
          window.dispatchEvent(new Event("online"));
          document.dispatchEvent(new Event("visibilitychange"));
          window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: STORAGE_KEYS.CLOUD_MUTATION_LEDGER } }));
          window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: STORAGE_KEYS.CLOUD_BACKUP_QUEUE } }));
          window.dispatchEvent(new CustomEvent("estipaid:cloud-convergence-result", { detail: { status: "skipped", code: "local_backup_pending" } }));
          // A request event wakes the worker; it must not invoke manual requeue.
          window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_REQUEST_EVENT, { detail: { reason: "worker_wakeup" } }));
          jest.advanceTimersByTime(61000);
        });
        if (cycle % 50 === 0) {
          first.rerender({ enabled: false, locked: true });
          first.rerender({ enabled: true, locked: false });
        }
      }
      first.unmount();
      const serialized = JSON.stringify(readCloudMutationLedger());
      localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, serialized);
      const second = renderHook(() => useCloudAutoBackup(baseProps()));
      await act(async () => { jest.advanceTimersByTime(86400000); });
      second.unmount();
      expect(readCloudMutationLedger()).toEqual(before);
      expect(readCloudMutationLedger().entries[1]).toEqual(expect.objectContaining({ revision: 2, status: "needs_attention", retryCount: 290 }));
      expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
      expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });
});

// The live crash: NOT_READY at runtimeCommitAtomicRecords -> commitTransition ->
// recordCloudMutationFailure -> attemptBackup. A vault that refuses a ledger
// transition is a LOCAL durability event; recording it through the very ledger
// that just refused re-entered the vault, threw again, and escaped the
// fire-and-forget worker into the React runtime.
describe("vault lifecycle interruption during automatic mutation work", () => {
  const { runtimeCommitAtomicRecords } = jest.requireMock("./vaultRuntimeStore");

  function seedPendingInvoiceMutation() {
    const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [{
      companyId: COMPANY.id,
      entityType: "invoice",
      documentId: "invoice-2606",
      createdAt: 2000,
      payload: { id: "invoice-2606", invoiceNumber: "INV-2606", total: 6000 }
    }]);
    localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
    return appended.appended[0];
  }

  // Commits succeed until `throwFromCall`, from which the vault stays refusing --
  // a lock, a replacement, or a freeze lasts longer than one attempt. The thrown
  // value is exactly what the runtime throws: `new Error(CODE)` with no `code`
  // property, so the message IS the code.
  function vaultRefusingFrom(throwFromCall, code = "NOT_READY") {
    let calls = 0;
    // Every ATTEMPTED transition is logged by the status it tried to write, so a
    // refused commit is still visible: "syncing" is mark-syncing, "retry_wait" /
    // "needs_attention" is a recorded cloud failure, "acknowledged" is an ack.
    const attempted = [];
    runtimeCommitAtomicRecords.mockImplementation(async (records) => {
      calls += 1;
      const ledgerWrite = (Array.isArray(records) ? records : [])
        .find(({ logicalKey }) => logicalKey === STORAGE_KEYS.CLOUD_MUTATION_LEDGER);
      if (ledgerWrite) {
        try { attempted.push(JSON.parse(ledgerWrite.value).entries[0].status); } catch { attempted.push("unparsed"); }
      }
      if (calls >= throwFromCall) throw new Error(code);
      records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
      return { ok: true };
    });
    return attempted;
  }

  // Real proof, not console suppression: nothing may reach the process or the
  // window as an unhandled rejection.
  function captureUnhandledRejections() {
    const seen = [];
    const onProcess = (reason) => seen.push(reason);
    const onWindow = (event) => seen.push(event?.reason);
    process.on("unhandledRejection", onProcess);
    window.addEventListener("unhandledrejection", onWindow);
    return {
      seen,
      stop() {
        process.off("unhandledRejection", onProcess);
        window.removeEventListener("unhandledrejection", onWindow);
      },
    };
  }

  async function settle(ms = 60) {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
  }

  test("the exact live stack ends cleanly: a refused failure-record never recurses", async () => {
    const mutation = seedPendingInvoiceMutation();
    // mark syncing commits; recording the cloud failure hits a frozen vault that
    // stays frozen.
    const attempted = vaultRefusingFrom(2);
    runSupabaseCloudMutationWrite.mockResolvedValue({
      ok: false,
      verified: false,
      code: "invoice_payments_target_cleanup_failed",
      error: "Exact invoice_payments deletion could not be verified."
    });
    const rejections = captureUnhandledRejections();

    const { result, unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1));
    unmount();
    await settle();

    expect(rejections.seen).toEqual([]);
    rejections.stop();
    // The refused failure record is attempted exactly ONCE per cloud failure.
    // The old code re-entered it from its own catch; that recursion is what
    // threw NOT_READY into React.
    expect(attempted.filter((status) => status === "retry_wait" || status === "needs_attention"))
      .toHaveLength(runSupabaseCloudMutationWrite.mock.calls.length);
    expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1);

    const entry = readCloudMutationLedger().entries[0];
    expect(entry).toEqual(expect.objectContaining({
      mutationId: mutation.mutationId,
      revision: mutation.revision,
      status: "syncing",
      retryCount: 0,
      acknowledgedAt: null
    }));
    expect(readCloudMutationLedger().lastVerifiedAt).toBeNull();
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    expect(result.current.running).toBe(false);
    // The shared lock is free for the next attempt.
    expect(tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP)).toBeTruthy();
    resetCloudOperationRunLockForTests();
  });

  test("a refused mark-syncing never reaches the cloud at all", async () => {
    const mutation = seedPendingInvoiceMutation();
    vaultRefusingFrom(1);
    const rejections = captureUnhandledRejections();

    const { result, unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(runtimeCommitAtomicRecords).toHaveBeenCalled());
    unmount();
    await settle();

    expect(rejections.seen).toEqual([]);
    rejections.stop();
    // The cloud is never touched for a mutation whose attempt is not durable.
    expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
    expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({
      mutationId: mutation.mutationId,
      status: "pending",
      retryCount: 0
    }));
    expect(result.current.running).toBe(false);
    expect(tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP)).toBeTruthy();
    resetCloudOperationRunLockForTests();
  });

  test("a refused acknowledgement never fakes success and never records a cloud failure", async () => {
    const mutation = seedPendingInvoiceMutation();
    const attempted = vaultRefusingFrom(2);
    runSupabaseCloudMutationWrite.mockResolvedValue({ ok: true, verified: true, verifiedAt: 4242 });
    const rejections = captureUnhandledRejections();

    const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1));
    unmount();
    await settle();

    expect(rejections.seen).toEqual([]);
    rejections.stop();
    // The cloud write really did succeed, so it is NOT relabelled as a failure:
    // one acknowledgement was attempted and refused, and no failure was recorded.
    expect(attempted.filter((status) => status === "acknowledged")).toHaveLength(1);
    expect(attempted.filter((status) => status === "retry_wait" || status === "needs_attention")).toHaveLength(0);
    const ledger = readCloudMutationLedger();
    expect(ledger.entries[0]).toEqual(expect.objectContaining({
      mutationId: mutation.mutationId,
      status: "syncing",
      retryCount: 0,
      acknowledgedAt: null,
      lastErrorCode: ""
    }));
    expect(ledger.lastVerifiedAt).toBeNull();
  });

  test("an interrupted syncing mutation is resumed automatically and acknowledged", async () => {
    const mutation = seedPendingInvoiceMutation();
    vaultRefusingFrom(2);
    runSupabaseCloudMutationWrite.mockResolvedValue({ ok: true, verified: true, verifiedAt: 4242 });

    const first = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1));
    first.unmount();
    await settle();
    expect(readCloudMutationLedger().entries[0].status).toBe("syncing");

    // The vault becomes usable again and the worker is eligible.
    runtimeCommitAtomicRecords.mockImplementation(async (records) => {
      records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
      return { ok: true };
    });
    runSupabaseCloudMutationWrite.mockResolvedValue({ ok: true, verified: true, verifiedAt: 5150 });

    const second = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("acknowledged"));

    const ledger = readCloudMutationLedger();
    // The SAME durable mutation finished. Nothing was duplicated, reset, or
    // manually retried.
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toEqual(expect.objectContaining({
      mutationId: mutation.mutationId,
      revision: mutation.revision,
      retryCount: 0,
      verifiedAt: 5150
    }));
    expect(ledger.lastVerifiedAt).toBe(5150);
    expect(runSupabaseCloudMutationWrite).toHaveBeenLastCalledWith(expect.objectContaining({
      mutation: expect.objectContaining({ mutationId: mutation.mutationId, revision: mutation.revision })
    }));
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    second.unmount();
  });

  test.each([
    ["VAULT_LOCKED"],
    ["STALE_SESSION"],
  ])("%s during mark-syncing defers the same way NOT_READY does", async (code) => {
    seedPendingInvoiceMutation();
    vaultRefusingFrom(1, code);
    const rejections = captureUnhandledRejections();

    const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(runtimeCommitAtomicRecords).toHaveBeenCalled());
    unmount();
    await settle();

    expect(rejections.seen).toEqual([]);
    rejections.stop();
    expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
    expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({
      status: "pending",
      retryCount: 0
    }));
  });

  test("DURABILITY_FAILED is a real local failure, not a deferral, and still never recurses", async () => {
    seedPendingInvoiceMutation();
    vaultRefusingFrom(1, "DURABILITY_FAILED");
    const rejections = captureUnhandledRejections();

    const { result, unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(runtimeCommitAtomicRecords).toHaveBeenCalled());
    unmount();
    await settle();

    expect(rejections.seen).toEqual([]);
    rejections.stop();
    // Mark-syncing was not durable, so the cloud is never touched and no failure
    // is recorded back through the ledger that just refused.
    expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
    expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({
      status: "pending",
      retryCount: 0,
      acknowledgedAt: null
    }));
    expect(result.current.running).toBe(false);
  });

  test("a real cloud failure on a healthy vault still records exactly as before", async () => {
    seedPendingInvoiceMutation();
    runSupabaseCloudMutationWrite.mockResolvedValue({
      ok: false,
      verified: false,
      code: "invoice_payments_target_cleanup_failed",
      error: "Exact invoice_payments deletion could not be verified."
    });

    const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("retry_wait"));

    expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({
      retryCount: 1,
      lastErrorCode: "invoice_payments_target_cleanup_failed",
      lastError: "Exact invoice_payments deletion could not be verified."
    }));
    expect(readCloudMutationLedger().entries[0].lastAttemptAt).toBeGreaterThan(0);
    unmount();
  });

  test("a real cloud success on a healthy vault still acknowledges and advances the verified clock", async () => {
    const mutation = seedPendingInvoiceMutation();
    runSupabaseCloudMutationWrite.mockResolvedValue({ ok: true, verified: true, verifiedAt: 9999 });

    const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
    await waitFor(() => expect(readCloudMutationLedger().entries[0].status).toBe("acknowledged"));

    const ledger = readCloudMutationLedger();
    expect(ledger.entries[0]).toEqual(expect.objectContaining({
      mutationId: mutation.mutationId,
      verifiedAt: 9999,
      retryCount: 0
    }));
    expect(ledger.lastVerifiedAt).toBe(9999);
    expect(deriveCloudProductStatus({
      connected: true,
      queueState: readCloudBackupQueueState(),
      mutationLedger: ledger,
      decision: { verifiedCurrent: true }
    })).toEqual(expect.objectContaining({
      state: CLOUD_PRODUCT_STATE.CLOUD_OK,
      lastSuccessfulSyncAt: 9999
    }));
    unmount();
  });

  test("no automatic entry point leaks a rejection while every ledger write is refused", async () => {
    seedPendingInvoiceMutation();
    // Startup reconcile, legacy materialization, mark-syncing, recovery requeue:
    // every durable transition is refused.
    runtimeCommitAtomicRecords.mockImplementation(async () => { throw new Error("NOT_READY"); });
    runSupabaseCloudMutationWrite.mockResolvedValue({ ok: false, verified: false, code: "cloud_unavailable", error: "offline" });
    const rejections = captureUnhandledRejections();

    const { unmount } = renderHook(() => useCloudAutoBackup(baseProps()));
    await settle();

    // Every automatic trigger this worker owns.
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: STORAGE_KEYS.CLOUD_MUTATION_LEDGER } }));
      window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_REQUEST_EVENT, { detail: { reason: "manual_retry" } }));
      await new Promise((resolve) => setTimeout(resolve, 80));
    });
    await settle();

    expect(rejections.seen).toEqual([]);
    rejections.stop();
    // Nothing durable moved and nothing was fabricated.
    expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({ status: "pending", retryCount: 0 }));
    unmount();
  });
});
