import { IDBFactory } from "fake-indexeddb";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { activateAccountScopedLocalStorage, deactivateAccountScopedLocalStorage,
  installAuthoritativeVaultRuntime, setActiveWorkspaceVaultCompatibility } from "./accountScopedLocalStorage";
import { createVaultIndexedDbRepository } from "./vaultIndexedDbRepository";
import { setupVault, lockVault, deriveWorkspaceVaultTag } from "./vaultSession";
import { beginVaultRuntimeActivation, hydrateVaultRuntime, initializeEmptyRecoveryRuntimeCatalog,
  runtimeGetItem, runtimeSetItem, runtimeRemoveItem, runtimeClear, runtimeLogicalKeys,
  isVaultRuntimeReady, isVaultRuntimeReadable, getVaultRuntimeStatus, revokeVaultRuntime,
  flushVaultRuntime, runtimeCommitAtomicRecords } from "./vaultRuntimeStore";
import { executeSupabaseCloudRestore, CLOUD_RESTORE_COMPLETE_EVENT } from "./supabaseCloudRestore";
import { resetCloudOperationRunLockForTests } from "./cloudOperationRunLock";
import { appendCloudMutationRecords, createEmptyCloudMutationLedger, readCloudMutationLedger, getCloudMutationLedgerSummary } from "./cloudMutationLedger";
import { readCloudBackupQueueState } from "./cloudBackupQueue";
import { buildEstimateRestorePayload } from "./supabaseEstimateRestorePayload";
import { buildSupabaseAppRestoreBundle } from "./supabaseAppRestoreBundle";
import { commitStoredCustomerCollectionMutation } from "./businessCloudMutationOwners";
import { getCloudDataDecision } from "./localDataIntegrity";
import { deriveCloudProductStatus } from "./useCloudBackupStatus";
import { resolveOperationOwnerFromSnapshot } from "./cloudOperationOwnership";
import { renderHook, waitFor } from "@testing-library/react";
import useCloudAutoConvergence from "./useCloudAutoConvergence";
import * as convergence from "./supabaseCloudConvergence";

let mockClaim;
let mockBeforeCommit;
let mockRows;
jest.mock("./browserSurfaceAuthority", () => ({
  ...jest.requireActual("./browserSurfaceAuthority"),
  getBrowserSurfaceClaimToken: () => mockClaim,
  isBrowserSurfaceActive: () => Boolean(mockClaim),
}));
jest.mock("./supabaseClient", () => ({
  getSupabaseClient: () => ({ from: table => {
    const query = {
      select: () => query, eq: () => query,
      then: resolve => Promise.resolve({ data: mockRows[table] || [], error: null }).then(resolve),
    };
    return query;
  } }),
}));
const USER = "11111111-2222-4333-8444-555555555555";
const COMPANY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
jest.mock("./supabaseDeviceLock", () => ({
  ...jest.requireActual("./supabaseDeviceLock"),
  ensureCurrentDeviceCanWriteCloud: async () => ({
    ok: true, access: { isActive: true, isLocked: false,
      fence: { companyId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", deviceId: "device-a", lockVersion: 5 } },
  }),
  ensureCurrentDeviceCanApplyLocalRestore: async input => {
    if (input.reason === "before_atomic_restore_commit" && mockBeforeCommit) {
      const result = await mockBeforeCommit();
      if (result) return result;
    }
    return { ok: true, access: { isActive: true, isLocked: false,
      fence: { companyId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", deviceId: "device-a", lockVersion: 5 } } };
  },
}));
jest.mock("./supabaseCloudVerification", () => ({
  runSupabaseCloudVerification: async () => ({ ok: true, allMatched: true, notices: [], blockers: [], availableRepairs: [] }),
}));

let repository;
let runtimeRepository;
let tag;
let nativeStorage;
let keyStore;
let failBatch;
const originalClone = globalThis.structuredClone;
beforeAll(() => {
  if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto;
  globalThis.structuredClone = value => {
    if (value instanceof Uint8Array) return value.slice();
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (Array.isArray(value)) return value.map(globalThis.structuredClone);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, globalThis.structuredClone(item)]));
    return value;
  };
});
afterAll(() => { if (originalClone) globalThis.structuredClone = originalClone; else delete globalThis.structuredClone; });
beforeEach(async () => {
  deactivateAccountScopedLocalStorage(); revokeVaultRuntime(); lockVault();
  nativeStorage = localStorage; nativeStorage.clear();
  globalThis.indexedDB = new IDBFactory();
  repository = createVaultIndexedDbRepository({ indexedDB: globalThis.indexedDB });
  failBatch = false;
  runtimeRepository = { ...repository, commitRuntimeRecordBatch: jest.fn(async input => {
    if (failBatch) throw new Error("TRANSACTION_ABORTED");
    return repository.commitRuntimeRecordBatch(input);
  }) };
  let key;
  keyStore = {
    read: async () => key,
    getOrCreate: jest.fn(async () => {
      if (!key) key = await globalThis.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      return key;
    }),
    remove: async () => { key = null; return true; },
  };
  tag = await deriveWorkspaceVaultTag(USER, COMPANY);
  activateAccountScopedLocalStorage({ storage: nativeStorage, userId: USER, companyId: COMPANY });
  setActiveWorkspaceVaultCompatibility({ workspaceTag: tag, state: "authoritative", generation: 1 });
  mockClaim = "claim-a"; mockBeforeCommit = null;
  mockRows = {
    customers: [{ id: "cloud-c1", company_id: COMPANY, legacy_local_id: "c1", display_name: "Synthetic customer", customer_type: "residential" }],
    projects: [{ id: "cloud-p1", company_id: COMPANY, legacy_local_id: "p1", customer_id: "cloud-c1", project_name: "Synthetic project", status: "active" }],
  };
});
afterEach(async () => {
  if (isVaultRuntimeReady()) await flushVaultRuntime();
  deactivateAccountScopedLocalStorage(); revokeVaultRuntime(); lockVault();
  resetCloudOperationRunLockForTests();
});

async function prepareSecureRestore() {
  const setup = await setupVault({ userId: USER, companyId: COMPANY }, {
    repositoryFactory: () => repository, deviceKeyStoreFactory: () => keyStore,
    randomBytes: () => new Uint8Array(32).fill(7),
  });
  if (setup.state !== "unlocked") return { ok: false };
  const empty = await initializeEmptyRecoveryRuntimeCatalog({
    userId: USER, companyId: COMPANY, repository, readGuard: () => ({ state: "authoritative" }),
  });
  if (!empty.ok) return { ok: false };
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY,
    repository: runtimeRepository, activation: beginVaultRuntimeActivation() });
  if (!hydrated.ok) return { ok: false };
  installAuthoritativeVaultRuntime({ workspaceTag: tag, generation: hydrated.generation, adapter: {
    isReady: generation => isVaultRuntimeReady(generation),
    canRead: generation => isVaultRuntimeReadable(generation), canMutate: generation => isVaultRuntimeReady(generation),
    getItem: runtimeGetItem, setItem: runtimeSetItem, removeItem: runtimeRemoveItem,
    clear: runtimeClear, keys: runtimeLogicalKeys,
  } });
  return { ok: isVaultRuntimeReady() };
}
const restore = options => executeSupabaseCloudRestore({
  storage: localStorage, configured: true, user: { id: USER }, company: { id: COMPANY },
  prepareSecureRestore, ...options,
});

function sourceOperationalHistory() {
  const inputs = Array.from({ length: 28 }, (_, index) => ({
    entityType: "estimate", documentId: "historical-" + index, payload: { id: "historical-" + index, projectId: "old-project" },
  }));
  const { ledger } = appendCloudMutationRecords(createEmptyCloudMutationLedger(), inputs);
  ledger.entries = ledger.entries.map(entry => ({ ...entry, status: "acknowledged", acknowledgedAt: 1000, verifiedAt: 1000 }));
  [1, 2, 14, 15].forEach(index => { ledger.entries[index] = { ...ledger.entries[index],
    status: "needs_attention", retryCount: index === 1 ? 298 : 3, lastErrorCode: "projects_parent_missing", verifiedAt: null, acknowledgedAt: null }; });
  ledger.lastAcknowledgedRevision = 28; ledger.lastVerifiedAt = 1000;
  return ledger;
}

function portableCloudFixture() {
  const estimate = { id: "e1", docType: "estimate", projectId: "p1", customerId: "c1", estimateNumber: "EST-1", status: "approved", total: 100 };
  mockRows.estimates = [{ id: "cloud-e1", company_id: COMPANY, legacy_local_id: "e1", customer_id: "cloud-c1", project_id: "cloud-p1", restore_payload: buildEstimateRestorePayload(estimate), restore_payload_version: "1" }];
  mockRows.invoices = [{ id: "cloud-i1", company_id: COMPANY, legacy_local_id: "i1", customer_id: "cloud-c1", project_id: "cloud-p1", source_estimate_legacy_id: "e1", invoice_number: "INV-1", total_amount: 100, amount_paid: 25, balance_remaining: 75 }];
  mockRows.invoice_payments = [{ id: "cloud-pay1", company_id: COMPANY, legacy_local_id: "pay1", invoice_id: "cloud-i1", amount: 25, paid_at: "2026-01-15" }];
  mockRows.invoice_line_items = [{ id: "cloud-line1", company_id: COMPANY, invoice_id: "cloud-i1", legacy_local_id: "invoice:i1:line:0", quantity: 1, unit_price: 100, total_price: 100, description: "Portable line" }];
  const values = {
    [STORAGE_KEYS.COMPANY_PROFILE]: { companyName: "Portable company" },
    [STORAGE_KEYS.SETTINGS]: { pricing: { defaultMarkupPct: 15 } },
    [STORAGE_KEYS.SCOPE_TEMPLATES]: [{ id: "template-1", title: "Portable template" }],
  };
  const { bundle } = buildSupabaseAppRestoreBundle({ getItem: key => values[key] ? JSON.stringify(values[key]) : null });
  // Even an old/extended cloud bundle cannot activate arbitrary storage keys.
  bundle[STORAGE_KEYS.CLOUD_MUTATION_LEDGER] = sourceOperationalHistory();
  bundle[STORAGE_KEYS.CLOUD_BACKUP_QUEUE] = { purpose: "legacy_compatibility", lastErrorCode: "identity_review_required" };
  bundle[STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL] = { stage: "source_device_only" };
  bundle[STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE] = { paused: true };
  mockRows.app_settings = [{ id: "bundle-row", company_id: COMPANY, setting_key: "app_restore_bundle", setting_value: bundle }];
}

async function seedTransportHistory() {
  await runtimeCommitAtomicRecords([
    { logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER, value: JSON.stringify(sourceOperationalHistory()) },
    { logicalKey: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: JSON.stringify({ ...readCloudBackupQueueState(), pending: false, status: "clean", purpose: "legacy_compatibility", lastErrorCode: "identity_review_required" }) },
  ]);
}

test("fresh cloud restore does not retain old operational history revealed by catalog activation", async () => {
  portableCloudFixture();
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(0);
  expect(readCloudBackupQueueState().purpose).toBe("none");
  const history = sourceOperationalHistory();
  expect(getCloudMutationLedgerSummary(history).activeCount).toBe(4);
  expect(history.lastAcknowledgedRevision).toBe(28);
  expect(history.entries[1]).toMatchObject({ revision: 2, operation: "upsert", entityType: "estimate", status: "needs_attention", retryCount: 298, lastErrorCode: "projects_parent_missing" });
  const restoreStartedAt = Date.now();
  // Cloud rows are explicitly business-only. The existing catalog is opened by
  // the handoff; the business-only merge previously retained these old keys.
  const result = await restore({ prepareSecureRestore: async () => {
    await prepareSecureRestore();
    await runtimeCommitAtomicRecords([
      { logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER, value: JSON.stringify(history) },
      { logicalKey: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: JSON.stringify({
        ...readCloudBackupQueueState(), pending: false, status: "clean", purpose: "legacy_compatibility", lastErrorCode: "identity_review_required",
      }) },
    ]);
    return { ok: true };
  } });
  expect(result.status).toBe("restored");
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))[0].id).toBe("c1");
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(0);
  expect(readCloudBackupQueueState().purpose).toBe("none");
  expect(readCloudBackupQueueState().lastErrorCode).toBe("");
  expect(JSON.parse(runtimeGetItem(STORAGE_KEYS.ESTIMATES)).map(row => row.id)).toEqual(["e1"]);
  const invoice = JSON.parse(runtimeGetItem(STORAGE_KEYS.INVOICES))[0];
  expect(invoice.id).toBe("i1");
  expect(invoice.payments[0]).toMatchObject({ id: "pay1", amount: 25 });
  expect(invoice.lineItems).toHaveLength(1);
  expect(JSON.parse(runtimeGetItem(STORAGE_KEYS.COMPANY_PROFILE)).companyName).toBe("Portable company");
  expect(JSON.parse(runtimeGetItem(STORAGE_KEYS.SETTINGS)).pricing.defaultMarkupPct).toBe(15);
  expect(JSON.parse(runtimeGetItem(STORAGE_KEYS.SCOPE_TEMPLATES))).toHaveLength(1);
  expect(readCloudMutationLedger()).toEqual(createEmptyCloudMutationLedger());
  expect(runtimeGetItem(STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL)).toBeNull();
  expect(JSON.parse(runtimeGetItem(STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS))).toBeNull();
  const queue = readCloudBackupQueueState();
  expect(queue.lastVerifiedAt).toBeGreaterThanOrEqual(restoreStartedAt);
  expect(queue.lastVerifiedAt).toBeLessThanOrEqual(Date.now());
  const ledger = readCloudMutationLedger();
  const decision = getCloudDataDecision({ mutationLedger: ledger, queueState: queue, cloudVerification: result.verification, onboardingStatus: { status: "already_backed_up" } });
  expect(decision).toMatchObject({ ledgerFailed: false, queueUnresolved: false, mismatch: false });
  expect(deriveCloudProductStatus({ connected: true, mutationLedger: ledger, queueState: queue, decision }).state).not.toBe("sync_issue");
  expect(resolveOperationOwnerFromSnapshot({ snapshot: { customers: [{ id: "c1" }] }, queueState: queue, mutationLedger: ledger })).toBe("convergence");
  const run = jest.spyOn(convergence, "runSupabaseCloudConvergence").mockResolvedValue({ ok: true, status: "matched" });
  const actor = renderHook(() => useCloudAutoConvergence({ configured: true, user: { id: USER }, company: { id: COMPANY }, deviceLock: { ready: true, loading: false, isActive: true, isLocked: false } }));
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  actor.unmount(); run.mockRestore();
  const customers = JSON.parse(runtimeGetItem(STORAGE_KEYS.CUSTOMERS));
  await commitStoredCustomerCollectionMutation({ previousCustomers: customers, nextCustomers: [{ ...customers[0], fullName: "Fresh local edit" }], event: { companyId: COMPANY } });
  expect(readCloudMutationLedger().entries).toHaveLength(1);
  expect(readCloudMutationLedger().entries[0]).toMatchObject({ revision: 1, entityType: "customer", status: "pending", retryCount: 0 });
});

test("business and fresh baseline become visible together after one encrypted CAS", async () => {
  await prepareSecureRestore(); await seedTransportHistory();
  const snapshots = [];
  const published = event => {
    if (event.detail?.key !== STORAGE_KEYS.CUSTOMERS) return;
    snapshots.push({ projectId: JSON.parse(runtimeGetItem(STORAGE_KEYS.PROJECTS))[0].id,
      activeCount: getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount,
      queue: readCloudBackupQueueState() });
  };
  window.addEventListener("pe-localstorage", published);
  runtimeRepository.commitRuntimeRecordBatch.mockClear();
  try {
    expect((await restore({ prepareSecureRestore: async () => ({ ok: true }) })).status).toBe("restored");
    expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({ projectId: "p1", activeCount: 0,
      queue: { purpose: "none", pending: false, lastVerifiedAt: null } });
  } finally { window.removeEventListener("pe-localstorage", published); }
});

test.each(["pending_upsert", "terminal_delete", "pending_queue", "malformed_ledger", "malformed_queue", "journal", "established_business", "commit_failure"])("%s does not prematurely clear current target execution state", async kind => {
  await prepareSecureRestore(); await seedTransportHistory();
  const ledger = readCloudMutationLedger();
  if (kind === "pending_upsert") ledger.entries[1].status = "pending";
  if (kind === "terminal_delete") ledger.entries[1].operation = "delete";
  const records = [{ logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER, value: JSON.stringify(ledger) }];
  if (kind === "malformed_ledger") records[0].value = "false";
  if (kind === "malformed_queue") records.push({ logicalKey: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: "false" });
  if (kind === "pending_queue") records.push({ logicalKey: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: JSON.stringify({ ...readCloudBackupQueueState(), pending: true }) });
  if (kind === "journal") records.push({ logicalKey: STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL, value: JSON.stringify({ stage: "current_target_transaction" }) });
  if (kind === "established_business") records.push({ logicalKey: STORAGE_KEYS.CUSTOMERS, value: JSON.stringify([{ id: "existing-local" }]) });
  await runtimeCommitAtomicRecords(records);
  const beforeLedger = runtimeGetItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER);
  const beforeQueue = runtimeGetItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
  if (kind === "commit_failure") failBatch = true;
  const result = await restore({ prepareSecureRestore: async () => ({ ok: true }) });
  expect(result.restored).not.toBe(true);
  expect(result.noWritesPerformed).toBe(true);
  if (kind === "commit_failure") await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository, activation: beginVaultRuntimeActivation() });
  expect(runtimeGetItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER)).toBe(beforeLedger);
  expect(runtimeGetItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)).toBe(beforeQueue);
  expect(runtimeGetItem(STORAGE_KEYS.PROJECTS)).toBeNull();
});

test("exact fresh-device refusal becomes an encrypted atomic restore only after the secure handoff", async () => {
  expect(isVaultRuntimeReady()).toBe(false);
  const complete = jest.fn();
  window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, complete);
  try {
    const result = await restore();
    expect(result.status).toBe("restored");
    expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
    const batch = runtimeRepository.commitRuntimeRecordBatch.mock.calls[0][0];
    expect(batch.workspaceTag).toBe(tag);
    expect(batch.records.map(record => record.logicalKey)).toEqual(expect.arrayContaining([STORAGE_KEYS.CUSTOMERS, STORAGE_KEYS.PROJECTS, STORAGE_KEYS.INVOICES]));
    batch.records.forEach(record => {
      expect(record.ciphertext).toBeInstanceOf(Uint8Array);
      expect(record.value).toBeUndefined();
    });
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))[0].id).toBe("c1");
    expect(JSON.parse(runtimeGetItem(STORAGE_KEYS.PROJECTS))[0].id).toBe("p1");
    expect(nativeStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBeNull();
    expect(isVaultRuntimeReady()).toBe(true);
    expect(getVaultRuntimeStatus().code).toBe("");
    expect(complete).toHaveBeenCalledTimes(1);
  } finally { window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, complete); }
});

test.each(["transaction", "user", "company", "browser", "device", "session"])("%s loss before durable commit leaves every business group untouched", async failure => {
  await prepareSecureRestore();
  if (failure === "transaction") failBatch = true;
  mockBeforeCommit = async () => {
    if (failure === "user" || failure === "company") {
      activateAccountScopedLocalStorage({ storage: localStorage,
        userId: failure === "user" ? "22222222-3333-4444-8555-666666666666" : USER,
        companyId: failure === "company" ? "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff" : COMPANY });
    }
    if (failure === "browser") mockClaim = "claim-b";
    if (failure === "session") revokeVaultRuntime();
    if (failure === "device") return { ok: false, deviceLockLost: true };
    return null;
  };
  const complete = jest.fn();
  window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, complete);
  try {
    const result = await restore({ prepareSecureRestore: async () => ({ ok: true }) });
    expect(result.restored).not.toBe(true);
    expect(result.noWritesPerformed).toBe(true);
    expect(await repository.listEncryptedRecordKeys({ workspaceTag: tag })).toEqual([]);
    expect(complete).not.toHaveBeenCalled();
    expect(nativeStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBeNull();
  } finally { window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, complete); }
});

test("missing device key fails before any restored business record can be committed", async () => {
  keyStore.getOrCreate.mockRejectedValue(new Error("DEVICE_KEY_MISSING"));
  const result = await restore();
  expect(result.restored).not.toBe(true);
  expect(result.noWritesPerformed).toBe(true);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
  expect(nativeStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBeNull();
});

test("invalid cloud payload never reaches the atomic repository batch", async () => {
  delete mockRows.customers[0].legacy_local_id;
  const result = await restore();
  expect(result.restored).not.toBe(true);
  expect(await repository.listEncryptedRecordKeys({ workspaceTag: tag })).toEqual([]);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("existing business records remain protected from empty-device restore", async () => {
  await prepareSecureRestore();
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.CUSTOMERS, value: JSON.stringify([{ id: "existing" }]) }]);
  runtimeRepository.commitRuntimeRecordBatch.mockClear();
  const result = await restore({ prepareSecureRestore: async () => ({ ok: true }) });
  expect(result.status).toBe("local_not_empty");
  expect(JSON.parse(runtimeGetItem(STORAGE_KEYS.CUSTOMERS))).toEqual([{ id: "existing" }]);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("NOT_READY remains fail closed without a successful handoff", async () => {
  const result = await restore({ prepareSecureRestore: async () => ({ ok: false }) });
  expect(result.restored).not.toBe(true);
  expect(result.noWritesPerformed).toBe(true);
  expect(result.error).toMatch(/secure storage is not ready/);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("a committed-stale session reopens the durable catalog through its owner without rollback or fake completion", async () => {
  const reopen = jest.fn(async () => {
    if (reopen.mock.calls.length === 1) return prepareSecureRestore();
    const result = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY,
      repository, activation: beginVaultRuntimeActivation() });
    installAuthoritativeVaultRuntime({ workspaceTag: tag, generation: result.generation, adapter: {
      isReady: isVaultRuntimeReady, canRead: isVaultRuntimeReadable, canMutate: isVaultRuntimeReady,
      getItem: runtimeGetItem, setItem: runtimeSetItem, removeItem: runtimeRemoveItem,
      clear: runtimeClear, keys: runtimeLogicalKeys,
    } });
    return { ok: result.ok };
  });
  runtimeRepository.commitRuntimeRecordBatch.mockImplementation(async input => {
    const result = await repository.commitRuntimeRecordBatch(input);
    revokeVaultRuntime();
    return result;
  });
  const complete = jest.fn();
  window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, complete);
  try {
    const result = await restore({ prepareSecureRestore: reopen });
    expect(result.restored).not.toBe(true);
    expect(result.localRecoveryApplied).toBe(true);
    expect(result.noWritesPerformed).toBe(false);
    expect(reopen).toHaveBeenCalledTimes(2);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))[0].id).toBe("c1");
    expect(isVaultRuntimeReady()).toBe(true);
    expect(complete).not.toHaveBeenCalled();
  } finally { window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, complete); }
});
