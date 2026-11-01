import { act, renderHook, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { normalizeCompanyProfile, DEFAULT_COMPANY_PROFILE } from "../utils/storage";
import { createScopeTemplate, readStoredScopeTemplates } from "../utils/scopeTemplates";
import { activateAccountScopedLocalStorage, deactivateAccountScopedLocalStorage, installAuthoritativeVaultRuntime,
  setActiveWorkspaceVaultCompatibility, revokeAuthoritativeVaultRuntime } from "./accountScopedLocalStorage";
import { createVaultIndexedDbRepository } from "./vaultIndexedDbRepository";
import { setupVault, lockVault, deriveWorkspaceVaultTag } from "./vaultSession";
import { beginVaultRuntimeActivation, hydrateVaultRuntime, initializeEmptyRecoveryRuntimeCatalog,
  runtimeGetItem, runtimeSetItem, runtimeRemoveItem, runtimeClear, runtimeLogicalKeys,
  isVaultRuntimeReady, isVaultRuntimeReadable, getVaultRuntimeStatus, revokeVaultRuntime,
  flushVaultRuntime, runtimeCommitAtomicRecords } from "./vaultRuntimeStore";
import { createEmptyCloudMutationLedger, appendCloudMutationRecords, readCloudMutationLedger,
  getCloudMutationLedgerSummary, normalizeCloudMutationLedger, recordCloudMutationFailure, getHistoricalWorkspaceBaselineCandidates } from "./cloudMutationLedger";
import { createEmptyCloudBackupQueueState, readCloudBackupQueueState, isInactiveWorkspaceBaselineQueue } from "./cloudBackupQueue";
import { materializeLegacyCompatibilityQueue } from "./cloudLegacyQueueCutover";
import { buildTargetCustomerPersistencePayload, buildTargetProjectPersistencePayload,
  buildTargetEstimatePersistencePayloads, buildTargetInvoicePersistencePayloads } from "./supabaseMigrationWriter";
import { buildAuditStorePayload, createStoredAuditEvent, AUDIT_STORE_SCHEMA_VERSION } from "../utils/auditStore";
import { buildLocalStorageExportArtifact } from "./localStorageExportArtifact";
import { mapLocalSnapshotToBackendDraft, mapLocalAuditEventToBackendDraft } from "../utils/backendDataMapper";
import { buildSupabaseAppRestoreBundle, validateSupabaseAppRestoreBundle } from "./supabaseAppRestoreBundle";
import { runSupabaseCloudVerification } from "./supabaseCloudVerification";
import { readSupabaseCloudConvergenceSnapshot } from "./supabaseCloudRestore";
import { runSupabaseCloudConvergence, canVerifyHistoricalWorkspaceResidue, getHistoricalWorkspaceBaselineEligibility, getLastCloudConvergenceResult, readHistoricalTemplateCaptureStatus, buildSafeConvergenceResult, recordCloudConvergenceResult, CLOUD_CONVERGENCE_RESULT_EVENT } from "./supabaseCloudConvergence";
import useCloudAutoConvergence from "./useCloudAutoConvergence";
import { getCloudDataDecision, scanLocalDataIntegrity, buildLocalSnapshotFromStorage } from "./localDataIntegrity";
import { deriveCloudProductStatus, deriveLastSuccessfulSyncAt } from "./useCloudBackupStatus";
import { commitStoredCustomerCollectionMutation } from "./businessCloudMutationOwners";
import { resolveOperationOwnerFromSnapshot, CLOUD_OPERATION_OWNER, hasCurrentDurableLedgerWork, hasPendingLocalBackup } from "./cloudOperationOwnership";
import { tryAcquireCloudOperationRunLock, releaseCloudOperationRunLock, resetCloudOperationRunLockForTests } from "./cloudOperationRunLock";

let mockClaim = "owner", mockActive = true, mockRecoveryBusy = false, mockFenceVersion = 5, mockDeviceActive = true;
let mockRows, mockReads, mockBeforeApply, mockReadGate, mockReadErrors;
jest.mock("./browserSurfaceAuthority", () => ({
  ...jest.requireActual("./browserSurfaceAuthority"),
  isBrowserSurfaceActive: () => mockActive, getBrowserSurfaceClaimToken: () => mockClaim,
}));
jest.mock("./supabaseDeviceLock", () => ({
  ...jest.requireActual("./supabaseDeviceLock"),
  ensureCurrentDeviceCanApplyLocalRestore: async input => {
    if (mockBeforeApply) await mockBeforeApply(input);
    return { ok: mockDeviceActive, access: { isActive: mockDeviceActive, isLocked: !mockDeviceActive,
      fence: { companyId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", deviceId: "device-1", lockVersion: mockFenceVersion } } };
  },
}));
jest.mock("./supabaseClient", () => ({ getSupabaseClient: () => ({ from: table => {
  const filters = [];
  const query = { select: () => query, eq: (key, value) => { filters.push([key, value]); return query; },
    then: resolve => { mockReads.push(table); return Promise.resolve(mockReadGate).then(() => ({ data: (mockRows[table] || [])
      .filter(row => filters.every(([key, value]) => row[key] === value)), error: mockReadErrors[table] || null })).then(resolve); } };
  return query;
} }) }));

const USER = "11111111-2222-4333-8444-555555555555", COMPANY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const PORTABLE = ["CUSTOMERS", "PROJECTS", "ESTIMATES", "INVOICES", "COMPANY_PROFILE", "SETTINGS", "SCOPE_TEMPLATES"].map(key => STORAGE_KEYS[key]);
const props = { configured: true, user: { id: USER }, company: { id: COMPANY } };
const business = () => ({
  customers: [{ id: "c1", fullName: "Synthetic customer", name: "Synthetic customer", type: "residential" }],
  projects: [{ id: "p1", customerId: "c1", projectName: "Synthetic project", status: "active" }],
  estimates: [{ id: "e1", docType: "estimate", customerId: "c1", projectId: "p1", estimateNumber: "EST-1", status: "draft", total: 100,
    labor: { lines: [{ id: "labor-1", description: "Labor", quantity: 1, rate: 100 }] } }],
  invoices: [{ id: "i1", customerId: "c1", projectId: "p1", sourceEstimateId: "e1", invoiceNumber: "INV-1", invoiceTotal: 100,
    amountPaid: 25, balanceRemaining: 75, lineItems: [{ id: "il1", description: "Labor", quantity: 1, price: 100, total: 100 }],
    payments: [{ id: "pay1", amount: 25, method: "cash", status: "paid" }] }],
  companyProfile: { companyName: "Synthetic business" }, settings: { pricing: { defaultMarkupPct: 15 } }, scopeTemplates: [],
});
function cloudRows(local) {
  const context = { userId: USER, companyId: COMPANY };
  const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const customer = { id: uuid(1), ...buildTargetCustomerPersistencePayload({ ...context, customer: local.customers[0] }).customerPayload };
  const project = { id: uuid(2), ...buildTargetProjectPersistencePayload({ ...context, project: local.projects[0], customerId: customer.id }).projectPayload };
  const est = buildTargetEstimatePersistencePayloads({ ...context, estimate: local.estimates[0], customerId: customer.id, projectId: project.id, estimateId: uuid(3) });
  const inv = buildTargetInvoicePersistencePayloads({ ...context, invoice: local.invoices[0], customerId: customer.id, projectId: project.id, estimateId: uuid(3), invoiceId: uuid(4) });
  return { customers: [customer], projects: [project], estimates: [{ id: uuid(3), ...est.estimatePayload }],
    invoices: [{ id: uuid(4), ...inv.invoicePayload }], estimate_line_items: est.lineItemPayloads.map((row, i) => ({ id: uuid(100 + i), ...row })),
    invoice_line_items: inv.lineItemPayloads.map((row, i) => ({ id: uuid(200 + i), ...row })),
    invoice_payments: inv.paymentPayloads.map((row, i) => ({ id: uuid(300 + i), ...row })),
    app_settings: [{ id: "bundle", company_id: COMPANY, setting_scope: "company", setting_key: "app_restore_bundle", setting_value: buildSupabaseAppRestoreBundle(localStorage).bundle }] };
}
function historicalLedger() {
  const local = business();
  const inputs = Array.from({ length: 28 }, (_, i) => ({
    entityType: "estimate", documentId: "old-" + i, payload: { id: "old-" + i },
  }));
  [1, 2, 14].forEach(i => { inputs[i] = { companyId: i === 14 ? COMPANY : "", entityType: "estimate",
    documentId: "e1", payload: local.estimates[0] }; });
  inputs[15] = { companyId: COMPANY, entityType: "invoice", documentId: "i1", payload: local.invoices[0] };
  const { ledger } = appendCloudMutationRecords(createEmptyCloudMutationLedger(), inputs, { now: 100 });
  ledger.entries = ledger.entries.map(entry => ({ ...entry, status: "acknowledged", acknowledgedAt: 3000, verifiedAt: 3000 }));
  [1, 2, 14, 15].forEach(i => { ledger.entries[i] = { ...ledger.entries[i], status: "needs_attention",
    retryCount: i === 1 ? 298 : i === 2 ? 13 : 3, lastAttemptAt: 2000,
    lastErrorCode: i === 14 ? "estimate_write_failed" : i === 15 ? "estimates_parent_missing" : "projects_parent_missing",
    lastError: "Historical failure", acknowledgedAt: null, verifiedAt: null }; });
  ledger.lastAcknowledgedRevision = 28; ledger.lastVerifiedAt = 3000;
  return ledger;
}
let repository, runtimeRepository, tag, nativeStorage, failCommit;
const originalClone = globalThis.structuredClone, originalLocks = navigator.locks;
beforeAll(() => {
  if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto;
  globalThis.structuredClone = value => {
    if (value instanceof Uint8Array) return value.slice();
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (Array.isArray(value)) return value.map(globalThis.structuredClone);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, globalThis.structuredClone(item)]));
    return value;
  };
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: async (name, options, callback) => callback(mockRecoveryBusy ? null : { name }) } });
});
afterAll(() => {
  if (originalClone) globalThis.structuredClone = originalClone; else delete globalThis.structuredClone;
  Object.defineProperty(navigator, "locks", { configurable: true, value: originalLocks });
});
beforeEach(async () => {
  deactivateAccountScopedLocalStorage(); revokeVaultRuntime(); lockVault();
  nativeStorage = localStorage; nativeStorage.clear();
  mockClaim = "owner"; mockActive = true; mockRecoveryBusy = false; mockFenceVersion = 5; mockDeviceActive = true; mockBeforeApply = null; mockReadGate = null; mockReads = []; mockReadErrors = {}; failCommit = false;
  globalThis.indexedDB = new IDBFactory();
  repository = createVaultIndexedDbRepository({ indexedDB: globalThis.indexedDB });
  runtimeRepository = { ...repository, commitRuntimeRecordBatch: jest.fn(async input => {
    if (failCommit) throw new Error("TRANSACTION_ABORTED");
    return repository.commitRuntimeRecordBatch(input);
  }) };
  let key;
  const keyStore = { read: async () => key, remove: async () => { key = null; },
    getOrCreate: async () => { if (!key) key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); return key; } };
  tag = await deriveWorkspaceVaultTag(USER, COMPANY);
  activateAccountScopedLocalStorage({ storage: nativeStorage, userId: USER, companyId: COMPANY });
  setActiveWorkspaceVaultCompatibility({ workspaceTag: tag, state: "authoritative", generation: 1 });
  await setupVault({ userId: USER, companyId: COMPANY }, { repositoryFactory: () => repository, deviceKeyStoreFactory: () => keyStore, randomBytes: () => new Uint8Array(32).fill(7) });
  await initializeEmptyRecoveryRuntimeCatalog({ userId: USER, companyId: COMPANY, repository, readGuard: () => ({ state: "authoritative" }) });
  const hydrated = await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: runtimeRepository, activation: beginVaultRuntimeActivation() });
  installAuthoritativeVaultRuntime({ workspaceTag: tag, generation: hydrated.generation, adapter: {
    isReady: isVaultRuntimeReady, canRead: isVaultRuntimeReadable, canMutate: isVaultRuntimeReady,
    getItem: runtimeGetItem, setItem: runtimeSetItem, removeItem: runtimeRemoveItem, clear: runtimeClear, keys: runtimeLogicalKeys,
  } });
  const local = business();
  const families = ["customers", "projects", "estimates", "invoices", "companyProfile", "settings", "scopeTemplates"];
  await runtimeCommitAtomicRecords([
    ...PORTABLE.map((logicalKey, i) => ({ logicalKey, value: JSON.stringify(local[families[i]]) })),
    { logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER, value: JSON.stringify(historicalLedger()) },
    { logicalKey: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: JSON.stringify({ ...createEmptyCloudBackupQueueState(), companyId: COMPANY,
      purpose: "legacy_compatibility", lastError: "Historical identity review", lastErrorCode: "identity_review_required", updatedAt: 2500,
      lastSuccessfulBackupAt: 3000, lastVerifiedAt: 3000, localMutationRevision: 28, compatibilityMaterializedRevision: 28, compatibilityMaterializedAt: 2500 }) },
  ]);
  mockRows = cloudRows(local);
  runtimeRepository.commitRuntimeRecordBatch.mockClear(); resetCloudOperationRunLockForTests();
});
afterEach(async () => {
  if (isVaultRuntimeReady()) await flushVaultRuntime();
  deactivateAccountScopedLocalStorage(); revokeVaultRuntime(); lockVault(); resetCloudOperationRunLockForTests();
});
const rawBusiness = () => PORTABLE.map(key => runtimeGetItem(key));
const operational = () => [runtimeGetItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER), runtimeGetItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)];
const clock = () => deriveLastSuccessfulSyncAt({ queueState: readCloudBackupQueueState(), ledgerVerifiedAt: readCloudMutationLedger().lastVerifiedAt });
function decision(verification = { ok: true, allMatched: true }) {
  return getCloudDataDecision({ cloudVerification: verification, localIntegrity: scanLocalDataIntegrity(buildLocalSnapshotFromStorage(localStorage).snapshot),
    mutationLedger: readCloudMutationLedger(), queueState: readCloudBackupQueueState(), onboardingStatus: { status: "established_workspace" } });
}
async function run(overrides = {}) {
  const lease = tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.CONVERGENCE);
  try { return await runSupabaseCloudConvergence({ ...props, storage: localStorage, reconcileHistoricalResidueOnly: true, ...overrides }); }
  finally { releaseCloudOperationRunLock(lease); }
}
async function editLedger(edit) {
  const ledger = readCloudMutationLedger(); edit(ledger);
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER, value: JSON.stringify(ledger) }]);
  runtimeRepository.commitRuntimeRecordBatch.mockClear();
}
async function editQueue(edit) {
  const queue = readCloudBackupQueueState(); edit(queue);
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.CLOUD_BACKUP_QUEUE, value: JSON.stringify(queue) }]);
  runtimeRepository.commitRuntimeRecordBatch.mockClear();
}

test("the exact contaminated established profile retires only after a fresh real strict match, preserving business, history and every sync clock", async () => {
  const before = readCloudMutationLedger(), beforeBusiness = rawBusiness(), beforeClock = clock(), beforeQueue = readCloudBackupQueueState();
  expect(getCloudMutationLedgerSummary(before).activeCount).toBe(4);
  expect(before.entries.filter(entry => entry.status === "needs_attention").map(entry =>
    [entry.entityType, entry.lastErrorCode, entry.retryCount, entry.companyId])).toEqual([
    ["estimate", "projects_parent_missing", 298, ""], ["estimate", "projects_parent_missing", 13, ""],
    ["estimate", "estimate_write_failed", 3, COMPANY], ["invoice", "estimates_parent_missing", 3, COMPANY],
  ]);
  expect(decision()).toMatchObject({ ledgerFailed: true, verifiedCurrent: true, queueUnresolved: false, mismatch: false });
  expect(deriveCloudProductStatus({ connected: true, decision: decision() }).state).toBe("sync_issue");
  expect(resolveOperationOwnerFromSnapshot({ snapshot: business(), mutationLedger: before, queueState: beforeQueue })).toBe("backup");
  const proof = await runSupabaseCloudVerification({ ...props, storageSnapshot: localStorage });
  expect(proof.allMatched).toBe(true);
  const mappedCloud = await readSupabaseCloudConvergenceSnapshot(props);
  expect(mappedCloud).toMatchObject({ ok: true, supplemental: { status: "available" } });
  expect(mappedCloud.mapped.settings).toEqual(business().settings);
  expect(mappedCloud.mapped.companyProfile).toEqual(business().companyProfile);
  expect(mappedCloud.mapped.scopeTemplates).toEqual(business().scopeTemplates);
  expect(scanLocalDataIntegrity(buildLocalSnapshotFromStorage(localStorage).snapshot).blockers).toEqual([]);
  expect(canVerifyHistoricalWorkspaceResidue({ storage: localStorage, companyId: COMPANY })).toBe(true);
  const result = await run();
  if (!result.ok) throw new Error(JSON.stringify(result));
  expect(result).toMatchObject({ ok: true, status: "matched", retiredCount: 4, queueRetired: true });
  const after = readCloudMutationLedger();
  expect(after.entries).toHaveLength(28);
  before.entries.forEach((entry, i) => {
    if (entry.status !== "needs_attention") expect(after.entries[i]).toEqual(entry);
    else { const { retirement, ...retired } = after.entries[i];
      expect(retired).toEqual({ ...entry, status: "retired" });
      expect(retirement).toMatchObject({ reason: "verified_workspace_baseline_superseded", userId: USER, companyId: COMPANY, workspaceTag: tag, generation: getVaultRuntimeStatus().generation });
      expect(retirement.verifiedAt).toBeGreaterThan(entry.lastAttemptAt);
    }
  });
  expect(normalizeCloudMutationLedger(after)).toEqual(after);
  expect(after.lastAcknowledgedRevision).toBe(28); expect(after.lastVerifiedAt).toBe(before.lastVerifiedAt);
  expect(rawBusiness()).toEqual(beforeBusiness); expect(clock()).toBe(beforeClock);
  const queue = readCloudBackupQueueState();
  expect(queue).toMatchObject({ pending: false, status: "clean", purpose: "none", lastError: "", lastErrorCode: "",
    lastVerifiedAt: beforeQueue.lastVerifiedAt, lastSuccessfulBackupAt: beforeQueue.lastSuccessfulBackupAt, retryCount: beforeQueue.retryCount, updatedAt: beforeQueue.updatedAt });
  expect(queue.supersededCompatibilityFailure.previous).toEqual(beforeQueue);
  expect(decision()).toMatchObject({ ledgerFailed: false, queueUnresolved: false, mismatch: false, verifiedCurrent: true });
  expect(deriveCloudProductStatus({ connected: true, decision: decision() }).state).toBe("cloud_ok");
  expect(resolveOperationOwnerFromSnapshot({ snapshot: business(), mutationLedger: after, queueState: queue })).toBe("convergence");
  expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
  const batch = runtimeRepository.commitRuntimeRecordBatch.mock.calls[0][0];
  expect(batch.records.map(row => row.logicalKey).sort()).toEqual([STORAGE_KEYS.CLOUD_MUTATION_LEDGER, STORAGE_KEYS.CLOUD_BACKUP_QUEUE].sort());
  batch.records.forEach(row => expect(row.ciphertext).toBeInstanceOf(Uint8Array));
  const bytes = operational();
  await run(); await run();
  expect(operational()).toEqual(bytes); expect(clock()).toBe(beforeClock);
  expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
});

test.each(["no_proof", "mismatch", "wrong_company", "stale", "warning", "missing_table", "repair"])("%s strict proof cannot retire anything", async kind => {
  const before = operational(), beforeBusiness = rawBusiness();
  const result = await run({ verifyCloud: async input => {
    if (kind === "no_proof") return null;
    const proof = await runSupabaseCloudVerification(input);
    if (kind === "mismatch") proof.allMatched = false;
    if (kind === "wrong_company") proof.company.id = OTHER;
    if (kind === "stale") proof.generatedAt = new Date(1000).toISOString();
    if (kind === "warning") proof.notices.push({ level: "warning", code: "unverified" });
    if (kind === "missing_table") proof.tableResults.pop();
    if (kind === "repair") proof.availableRepairs = [{ type: "repair" }];
    return proof;
  } });
  expect(result.ok).toBe(false); expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["pending", "syncing", "retry_wait", "delete", "current_failure", "wrong_entry_company"])("%s ledger work blocks the entire remediation", async kind => {
  await editLedger(ledger => {
    if (["pending", "syncing", "retry_wait"].includes(kind)) ledger.entries[2].status = kind;
    if (kind === "delete") ledger.entries[2].operation = "delete";
    if (kind === "current_failure") ledger.entries[2].lastAttemptAt = Date.now() + 60000;
    if (kind === "wrong_entry_company") ledger.entries[2].companyId = OTHER;
  });
  const before = operational();
  expect((await run()).ok).toBe(false); expect(operational()).toEqual(before);
  expect(mockReads).toHaveLength(0); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["pending", "syncing_generation", "quarantined_review", "new_generation", "wrong_company"])("queue %s is preserved", async kind => {
  await editQueue(queue => {
    if (kind === "pending") queue.pending = true;
    if (kind === "syncing_generation") queue.syncingRevision = 29;
    if (kind === "quarantined_review") { queue.status = "conflict"; queue.reviewOrigin = "legacy_historical_review"; }
    if (kind === "new_generation") { queue.pending = true; queue.localMutationRevision = 29; queue.status = "pending"; }
    if (kind === "wrong_company") queue.companyId = OTHER;
  });
  const before = operational();
  expect((await run()).ok).toBe(false); expect(operational()).toEqual(before);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["browser", "device", "journal", "null_journal", "pause", "partial_recovery", "recovery_lease", "vault_not_ready", "run_lock"])("%s ownership/recovery blocker preserves historical state", async kind => {
  const before = operational();
  if (kind === "browser") mockActive = false;
  if (kind === "device") mockDeviceActive = false;
  if (kind === "recovery_lease") mockRecoveryBusy = true;
  if (kind === "vault_not_ready") revokeAuthoritativeVaultRuntime();
  if (kind === "run_lock") tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP);
  const key = { journal: STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL, null_journal: STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL, pause: STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, partial_recovery: STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS }[kind];
  if (key) { await runtimeCommitAtomicRecords([{ logicalKey: key, value: kind === "null_journal" ? "null" : JSON.stringify({ active: true }) }]); runtimeRepository.commitRuntimeRecordBatch.mockClear(); }
  expect((await run()).ok).toBe(false); expect(operational()).toEqual(before);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["user", "company", "generation", "claim", "device_generation", "business", "new_failure", "queue"])("%s changed while fresh verification runs invalidates its proof", async kind => {
  const before = operational();
  const result = await run({ verifyCloud: async input => {
    const proof = await runSupabaseCloudVerification(input);
    if (kind === "user" || kind === "company") activateAccountScopedLocalStorage({ storage: nativeStorage, userId: kind === "user" ? OTHER : USER, companyId: kind === "company" ? OTHER : COMPANY });
    if (kind === "generation") await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository: runtimeRepository, activation: beginVaultRuntimeActivation() });
    if (kind === "claim") mockClaim = "different-owner";
    if (kind === "device_generation") mockFenceVersion = 7;
    if (kind === "business") await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.SETTINGS, value: JSON.stringify({ changed: true }) }]);
    if (kind === "new_failure") await editLedger(ledger => { ledger.entries[1].lastAttemptAt = Date.now() + 1; });
    if (kind === "queue") await editQueue(queue => { queue.pending = true; queue.localMutationRevision += 1; });
    return proof;
  } });
  expect(result.ok).toBe(false);
  if (!["new_failure", "queue"].includes(kind)) expect(operational()).toEqual(before);
  expect(readCloudMutationLedger().entries.filter(entry => entry.status === "retired")).toHaveLength(0);
});

test("an integrity blocker or supplemental mismatch cannot be explained away by matched core tables", async () => {
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.PROJECTS, value: JSON.stringify([{ ...business().projects[0], customerId: "absent" }]) }]);
  runtimeRepository.commitRuntimeRecordBatch.mockClear(); const before = operational();
  expect((await run()).ok).toBe(false); expect(operational()).toEqual(before); expect(mockReads).toHaveLength(0);
});
test("portable settings mismatch blocks retirement even when the seven core tables strictly match", async () => {
  mockRows.app_settings[0].setting_value.settings = { other: true };
  const before = operational(); expect((await run()).ok).toBe(false); expect(operational()).toEqual(before);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});
test("failed encrypted commit preserves durable ledger and queue", async () => {
  const before = operational(); failCommit = true;
  expect((await run()).ok).toBe(false);
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository, activation: beginVaultRuntimeActivation() });
  expect(operational()).toEqual(before);
});
test.each(["browser", "device"])("%s ownership loss after encryption prevents the atomic retirement", async kind => {
  const before = operational();
  mockBeforeApply = input => {
    if (input.reason !== "before_historical_workspace_retirement") return;
    if (kind === "browser") mockClaim = "new-claim";
    else mockFenceVersion = 7;
  };
  expect((await run()).ok).toBe(false);
  expect(operational()).toEqual(before);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});
test("lifecycle events and cached current status cannot retire entries while NEW verification is incomplete", async () => {
  let resolveRead;
  mockReadGate = new Promise(resolve => { resolveRead = resolve; });
  const before = operational();
  const actor = renderHook(() => useCloudAutoConvergence({ ...props, deviceLock: { ready: true, loading: false, isActive: true, isLocked: false } }));
  await waitFor(() => expect(mockReads.length).toBe(1));
  act(() => { window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("pageshow")); document.dispatchEvent(new Event("visibilitychange")); });
  actor.rerender(); await act(async () => { await Promise.resolve(); });
  expect(decision().verifiedCurrent).toBe(true); expect(decision().ledgerFailed).toBe(true);
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
  await act(async () => { resolveRead(); });
  await waitFor(() => expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(0));
  expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
  actor.unmount();
});
test("future real edits and failures remain normal targeted work after retirement", async () => {
  expect((await run()).ok).toBe(true);
  const previousCustomers = business().customers;
  await commitStoredCustomerCollectionMutation({ previousCustomers, nextCustomers: [{ ...previousCustomers[0], fullName: "Fresh edit" }], event: { companyId: COMPANY } });
  const mutation = readCloudMutationLedger().entries[28];
  expect(mutation).toMatchObject({ revision: 29, entityType: "customer", status: "pending", retryCount: 0 });
  await recordCloudMutationFailure(mutation, { errorCode: "real_failure", error: "New current failure" });
  await recordCloudMutationFailure(mutation, { errorCode: "real_failure", error: "New current failure" });
  await recordCloudMutationFailure(mutation, { errorCode: "real_failure", error: "New current failure" });
  expect(decision().ledgerFailed).toBe(true);
  expect(deriveCloudProductStatus({ connected: true, decision: decision() }).state).toBe("sync_issue");
  const before = operational(); expect((await run()).ok).toBe(false); expect(operational()).toEqual(before);
});
test("the existing hook obtains NEW proof before retiring and then normal convergence is no longer blocked by local_backup_pending", async () => {
  const actor = renderHook(() => useCloudAutoConvergence({ ...props, deviceLock: { ready: true, loading: false, isActive: true, isLocked: false } }));
  await waitFor(() => expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(0));
  expect(getLastCloudConvergenceResult().status).toBe("matched");
  expect(mockReads.filter(table => table === "customers")).toHaveLength(2);
  const writes = runtimeRepository.commitRuntimeRecordBatch.mock.calls.length;
  actor.rerender(); await act(async () => { await Promise.resolve(); });
  expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(writes);
  actor.unmount();
  const snapshot = await readSupabaseCloudConvergenceSnapshot(props);
  const normal = await runSupabaseCloudConvergence({ ...props, storage: localStorage, cloudSnapshot: snapshot });
  if (!normal.ok) throw new Error(JSON.stringify(normal));
  expect(normal.ok).toBe(true); expect(["converged", "matched"]).toContain(normal.status);
  expect(canVerifyHistoricalWorkspaceResidue({ storage: localStorage, companyId: COMPANY })).toBe(false);
});

async function seedProducerRetainedReviewResidue() {
  await editQueue(queue => {
    queue.pending = true; queue.status = "remote_changed"; queue.reviewOrigin = "current_sync_failure";
    queue.compatibilityMaterializedRevision = null;
  });
  const materialized = await materializeLegacyCompatibilityQueue({ storage: localStorage, companyId: COMPANY });
  expect(materialized.materialized).toBe(true);
  // Build the pre-fix 28-entry historical ledger beside the actual producer's
  // queue bytes. The old fixture handcrafted a clean reviewOrigin and missed
  // the provenance this production transition retains after clearing pending.
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER, value: JSON.stringify(historicalLedger()) }]);
  const persistedQueue = JSON.parse(runtimeGetItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE));
  expect(persistedQueue).toMatchObject({ pending: false, status: "clean", purpose: "legacy_compatibility",
    lastErrorCode: "identity_review_required", reviewOrigin: "current_sync_failure" });
  expect(readCloudBackupQueueState().reviewOrigin).toBe("");
  await waitFor(() => expect(Date.now()).toBeGreaterThan(persistedQueue.updatedAt));
  mockReads = []; runtimeRepository.commitRuntimeRecordBatch.mockClear();
  return persistedQueue;
}

test("producer-retained review provenance reaches strict verification instead of the live local_backup_pending early return", async () => {
  const originalQueue = await seedProducerRetainedReviewResidue();
  const beforeBusiness = rawBusiness(), beforeClock = clock(), beforeLedger = readCloudMutationLedger();
  expect(getCloudMutationLedgerSummary(beforeLedger).activeCount).toBe(4);
  expect(beforeLedger.lastAcknowledgedRevision).toBe(28);
  expect(beforeLedger.entries[1]).toMatchObject({ revision: 2, retryCount: 298, status: "needs_attention", operation: "upsert", lastErrorCode: "projects_parent_missing" });
  expect(decision()).toMatchObject({ ledgerFailed: true, verifiedCurrent: true, mismatch: false, queueUnresolved: false });
  const outcomes = [];
  const listener = event => outcomes.push(event.detail);
  window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, listener);
  const actor = renderHook(() => useCloudAutoConvergence({ ...props, deviceLock: { ready: true, loading: false, isActive: true, isLocked: false } }));
  try {
    await waitFor(() => expect(outcomes.length).toBeGreaterThan(0));
    if (outcomes[0].code === "local_backup_pending") {
      expect(mockReads).toHaveLength(0);
      expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
      expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(4);
      throw new Error("Production hook returned skipped/local_backup_pending before remediation: cloud reads=0, retirement commits=0, active historical failures=4");
    }
    expect(outcomes[0]).toMatchObject({ status: "matched", code: "" });
    expect(mockReads.filter(table => table === "customers")).toHaveLength(2);
    expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(0);
    expect(readCloudBackupQueueState()).toMatchObject({ pending: false, status: "clean", purpose: "none", lastErrorCode: "" });
    expect(readCloudBackupQueueState().supersededCompatibilityFailure.previous).toEqual(originalQueue);
    expect(rawBusiness()).toEqual(beforeBusiness); expect(clock()).toBe(beforeClock);
    expect(decision()).toMatchObject({ ledgerFailed: false, queueUnresolved: false, mismatch: false, verifiedCurrent: true });
    expect(deriveCloudProductStatus({ connected: true, decision: decision() }).state).toBe("cloud_ok");
    expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
  } finally { actor.unmount(); window.removeEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, listener); }
});


test("profile diagnostic names actual differing schema keys but withholds every value and unrecognized/security key", async () => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  local.profile.city = "PRIVATE_LOCAL_CITY";
  cloud.profile.attn = "PRIVATE_CONTACT"; cloud.profile.terms = "PRIVATE_TERMS"; cloud.profile.website = "PRIVATE_WEBSITE";
  cloud.profile.companyName = "PRIVATE_DIFFERENT_NAME";
  const denied = ["credentials", "password", "secret", "accessToken", "refresh_token", "encryptionKey", "ciphertext", "encryptedContents", "iv", "dek", "userId", "companyId", "ein", "stripeAccountId", "PRIVATE_CUSTOM_KEY"];
  denied.forEach(key => { cloud.profile[key] = "PRIVATE_SECURITY_VALUE"; });
  await seedPortablePair(local, cloud); const before = operational(), beforeBusiness = rawBusiness();
  const result = await run();
  expect(result.ok).toBe(false);
  expect(result.historicalBundleProof.companyProfileDifference).toMatchObject({
    localOnlyFieldKeys: ["city"], cloudOnlyFieldKeys: ["attn", "terms", "website"], differingFieldKeys: ["companyName"], redactedFieldKeyCount: denied.length,
  });
  const safe = recordCloudConvergenceResult(result);
  expect(safe.historicalBundleProof.companyProfileDifference).toEqual(result.historicalBundleProof.companyProfileDifference);
  const output = JSON.stringify(safe);
  denied.forEach(key => expect(output).not.toContain(JSON.stringify(key)));
  ["PRIVATE_LOCAL_CITY", "PRIVATE_CONTACT", "PRIVATE_TERMS", "PRIVATE_WEBSITE", "PRIVATE_DIFFERENT_NAME", "PRIVATE_SECURITY_VALUE"].forEach(value => expect(output).not.toContain(value));
  expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(4);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each([
  [null, "missing_source_storage"], ["{broken", "malformed_stored_data"], ["null", "unsupported_storage_shape"],
  [JSON.stringify({ templates: [] }), "unsupported_storage_shape"], [JSON.stringify([{ name: "PRIVATE_UNIDENTIFIED" }]), "unsupported_template_records"],
  ["[]", "captured_empty"], [JSON.stringify([{ id: "synthetic-template", scopeText: "PRIVATE_VALID_SCOPE" }]), "captured_records"],
])("current template source classification is precise and read-only: %s", (raw, expected) => {
  const getItem = jest.fn(() => raw), setItem = jest.fn(), removeItem = jest.fn();
  expect(readHistoricalTemplateCaptureStatus({ storage: { getItem, setItem, removeItem } })).toBe(expected);
  expect(getItem).toHaveBeenCalledWith(STORAGE_KEYS.SCOPE_TEMPLATES); expect(setItem).not.toHaveBeenCalled(); expect(removeItem).not.toHaveBeenCalled();
});

test("a failed template read is not missing storage and never reveals error/decryption content", () => {
  const status = readHistoricalTemplateCaptureStatus({ storage: { getItem: () => { throw new Error("PRIVATE_DECRYPTION_CONTENT"); } } });
  expect(status).toBe("read_unavailable"); expect(status).not.toContain("PRIVATE_DECRYPTION_CONTENT");
});

test.each(["missing", "invalid_json", "unsupported_shape"])("historical %s source loss remains explicitly unknown when the persisted cloud capture is null", async source => {
  const local = portablePair(); local.templates = [];
  const storage = { [STORAGE_KEYS.COMPANY_PROFILE]: JSON.stringify(local.profile), [STORAGE_KEYS.SETTINGS]: JSON.stringify(business().settings) };
  if (source !== "missing") storage[STORAGE_KEYS.SCOPE_TEMPLATES] = source === "invalid_json" ? "{invalid" : JSON.stringify({ templates: [] });
  const captured = buildSupabaseAppRestoreBundle(storage);
  expect(captured.bundle.scopeTemplates).toBeNull();
  await seedPortablePair(local, { profile: local.profile, templates: null }); mockRows.app_settings[0].setting_value = captured.bundle;
  const before = operational(); const result = await run();
  expect(result).toMatchObject({ ok: false, historicalBundleProof: { scopeTemplatesMatched: false,
    scopeTemplateCapture: { localStatus: "captured_empty", cloudStatus: "uncaptured_null", historicalNullReason: "not_recorded_in_bundle" } } });
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each([false, true])("valid array captures distinguish truly empty and populated libraries without modifying either, populated=%s", async populated => {
  const local = portablePair(); if (!populated) local.templates = [];
  await seedPortablePair(local, JSON.parse(JSON.stringify(local))); const beforeBusiness = rawBusiness();
  expect(await run()).toMatchObject({ ok: true, historicalBundleProof: { scopeTemplateCapture: {
    localStatus: populated ? "captured_records" : "captured_empty", cloudStatus: populated ? "captured_records" : "captured_empty", historicalNullReason: "not_applicable",
  } } });
  expect(rawBusiness()).toEqual(beforeBusiness);
});

test.each(["read", "duplicate", "missing", "invalid"])("cloud %s failure stays distinct from a historical null source capture", async kind => {
  if (kind === "read") mockReadErrors.app_settings = { message: "PRIVATE_READ_ERROR" };
  if (kind === "duplicate") mockRows.app_settings.push({ ...mockRows.app_settings[0], id: "private-duplicate" });
  if (kind === "missing") mockRows.app_settings = [];
  if (kind === "invalid") mockRows.app_settings[0].setting_value.scopeTemplates = { templates: [] };
  const before = operational();
  expect(await run()).toMatchObject({ ok: false, historicalBundleProof: { scopeTemplateCapture: {
    cloudStatus: { read: "bundle_read_unavailable", duplicate: "bundle_selection_error", missing: "bundle_missing", invalid: "bundle_invalid" }[kind], historicalNullReason: "not_applicable",
  } } });
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});


test("source-defined empty profile defaults already compare equal and cannot explain cloud_only_fields", async () => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  cloud.profile = { ...DEFAULT_COMPANY_PROFILE, ...cloud.profile };
  await seedPortablePair(local, cloud); const beforeBusiness = rawBusiness();
  const result = await run();
  expect(result).toMatchObject({ ok: true, historicalBundleProof: { companyProfileMatched: true,
    companyProfileDifference: { classification: "serialization_equivalent", serializationOnly: true, cloudOnlyFields: false } } });
  expect(rawBusiness()).toEqual(beforeBusiness);
});

test.each(["attn", "terms", "stripeAccountId", "roc", "ein"])("cloud-only nonempty historical/business profile field %s remains a blocking obligation", async field => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  cloud.profile[field] = "PRIVATE_PRESERVED_BUSINESS_INFORMATION";
  await seedPortablePair(local, cloud); const before = operational(), beforeBusiness = rawBusiness();
  const verifyCloud = jest.fn(runSupabaseCloudVerification);
  const result = await run({ verifyCloud });
  expect(result).toMatchObject({ ok: false, code: "workspace_bundle_not_matched", historicalBundleProof: { companyProfileMatched: false,
    companyProfileDifference: { classification: "cloud_only_fields", cloudOnlyFields: true, differentValues: false, identityIssue: false } } });
  expect(verifyCloud).not.toHaveBeenCalled(); expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
  expect(mockRows.app_settings[0].setting_value.companyProfile[field]).toBe("PRIVATE_PRESERVED_BUSINESS_INFORMATION");
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(4);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["legacy_document_fields", "contact_fields"])("exact source-defined %s keys distinguish otherwise identical live classifications", async kind => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  if (kind === "legacy_document_fields") Object.assign(cloud.profile, { attn: "PRIVATE_LEGACY_CONTACT", terms: "PRIVATE_LEGACY_TERMS" });
  else Object.assign(cloud.profile, { email: "synthetic@example.invalid", website: "https://example.invalid" });
  cloud.templates = null;
  await seedPortablePair(local, cloud); const before = operational(), beforeBusiness = rawBusiness();
  const result = await run();
  expect(result).toMatchObject({ ok: false, code: "workspace_bundle_not_matched", historicalBundleProof: {
    companyProfileMatched: false, scopeTemplatesMatched: false, settingsMatched: true,
    companyProfileDifference: { classification: "cloud_only_fields", cloudOnlyFields: true, differentValues: false, identityIssue: false },
    scopeTemplatesDifference: { classification: "capture_difference", differentValues: true, localOnlyRecords: false, cloudOnlyRecords: false, identityIssue: false },
  } });
  expect(result.historicalBundleProof.companyProfileDifference.cloudOnlyFieldKeys)
    .toEqual(kind === "legacy_document_fields" ? ["attn", "terms"] : ["email", "website"]);
  expect(JSON.stringify(recordCloudConvergenceResult(result))).not.toMatch(/PRIVATE_|example\.invalid/);
  expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness); expect(decision().ledgerFailed).toBe(true);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["missing", "invalid_json", "null", "object_envelope", "scalar"].flatMap(source => [[source, false], [source, true]]))(
  "%s historical template capture cannot prove the canonical library, localHasTemplates=%s", async (source, localHasTemplates) => {
    const local = portablePair(); if (!localHasTemplates) local.templates = [];
    const capturedStorage = {
      [STORAGE_KEYS.COMPANY_PROFILE]: JSON.stringify(local.profile),
      [STORAGE_KEYS.SETTINGS]: JSON.stringify(business().settings),
    };
    const raw = { invalid_json: "{unparseable", null: "null", object_envelope: JSON.stringify({ templates: [] }), scalar: "0" }[source];
    if (source !== "missing") capturedStorage[STORAGE_KEYS.SCOPE_TEMPLATES] = raw;
    const captured = buildSupabaseAppRestoreBundle(capturedStorage);
    expect(captured.bundle.scopeTemplates).toBeNull(); expect(captured.captureSummary.scopeTemplatesCaptured).toBe(false);
    expect(validateSupabaseAppRestoreBundle(captured.bundle).valid).toBe(true);
    expect(captured.notices.some(notice => notice.code.endsWith(STORAGE_KEYS.SCOPE_TEMPLATES))).toBe(true);
    await seedPortablePair(local, { profile: local.profile, templates: null });
    mockRows.app_settings[0].setting_value = captured.bundle;
    const before = operational(), beforeBusiness = rawBusiness(), verifyCloud = jest.fn(runSupabaseCloudVerification);
    // A matched seven-table business proof cannot fill in missing template
    // capture evidence: this exact bundle field is outside those seven tables.
    expect((await runSupabaseCloudVerification({ ...props, storageSnapshot: localStorage })).allMatched).toBe(true);
    const result = await run({ verifyCloud });
    expect(result).toMatchObject({ ok: false, code: "workspace_bundle_not_matched", historicalBundleProof: {
      companyProfileMatched: true, settingsMatched: true, scopeTemplatesMatched: false,
      localShape: "array", cloudShape: "null", supplementalStatus: "available",
      scopeTemplatesDifference: { classification: "capture_difference", differentValues: true, localOnlyRecords: false, cloudOnlyRecords: false, identityIssue: false },
    } });
    expect(verifyCloud).not.toHaveBeenCalled(); expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
    expect(mockRows.app_settings[0].setting_value).toEqual(captured.bundle);
    expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(4);
    expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
  }
);

test.each([false, true])("explicit captured template arrays retain existing serialization equivalence, hasTemplates=%s", async hasTemplates => {
  const local = portablePair(); if (!hasTemplates) local.templates = [];
  const captured = buildSupabaseAppRestoreBundle({
    [STORAGE_KEYS.COMPANY_PROFILE]: JSON.stringify(local.profile),
    [STORAGE_KEYS.SETTINGS]: JSON.stringify(business().settings),
    [STORAGE_KEYS.SCOPE_TEMPLATES]: JSON.stringify(local.templates.map(row => Object.fromEntries(Object.entries(row).reverse()))),
  });
  expect(captured.captureSummary.scopeTemplatesCaptured).toBe(true); expect(captured.notices).toEqual([]);
  await seedPortablePair(local, { profile: captured.bundle.companyProfile, templates: captured.bundle.scopeTemplates });
  mockRows.app_settings[0].setting_value = captured.bundle;
  const beforeBusiness = rawBusiness();
  expect(await run()).toMatchObject({ ok: true, retiredCount: 4, historicalBundleProof: { companyProfileMatched: true, scopeTemplatesMatched: true } });
  expect(rawBusiness()).toEqual(beforeBusiness);
});


function portablePair() {
  const profile = { companyName: "PRIVATE_COMPANY", phone: "15550102020", address: "PRIVATE_ADDRESS", logoDataUrl: "data:image/png;base64,SYNTHETIC", extraEvidence: { retain: "PRIVATE_EVIDENCE" } };
  const templates = [
    createScopeTemplate({ id: "private-t-a", name: "PRIVATE_TEMPLATE_A", scopeText: "PRIVATE_SCOPE_A", createdAt: 100, updatedAt: 300,
      laborItems: [{ id: "private-l-a", role: "PRIVATE_ROLE", hours: 2, rate: 75 }],
      scopeImages: [{ id: "private-image-a", name: "PRIVATE_IMAGE", dataUrl: "data:image/png;base64,SYNTHETIC", layout: { size: "medium", align: "center", caption: true } }] }),
    createScopeTemplate({ id: "private-t-b", name: "PRIVATE_TEMPLATE_B", scopeText: "PRIVATE_SCOPE_B", createdAt: 100, updatedAt: 200 }),
  ];
  return { profile, templates };
}
async function seedPortablePair(local, cloud) {
  await runtimeCommitAtomicRecords([
    { logicalKey: STORAGE_KEYS.COMPANY_PROFILE, value: JSON.stringify(local.profile) },
    { logicalKey: STORAGE_KEYS.SCOPE_TEMPLATES, value: JSON.stringify(local.templates) },
  ]);
  mockRows.app_settings[0].setting_value.companyProfile = cloud.profile;
  mockRows.app_settings[0].setting_value.scopeTemplates = cloud.templates;
  runtimeRepository.commitRuntimeRecordBatch.mockClear();
}

test("phone punctuation and outer template-library order are source-proven equivalents with every stored field retained", async () => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  cloud.profile.phone = "+1 (555) 010-2020";
  cloud.templates.reverse();
  expect(normalizeCompanyProfile(cloud.profile).phone).toBe(normalizeCompanyProfile(local.profile).phone);
  await seedPortablePair(local, cloud); const beforeBusiness = rawBusiness();
  expect(readStoredScopeTemplates().map(row => row.id)).toEqual(["private-t-a", "private-t-b"]);
  const result = await run();
  expect(result).toMatchObject({ ok: true, retiredCount: 4, historicalBundleProof: {
    companyProfileMatched: true, scopeTemplatesMatched: true,
    companyProfileDifference: { classification: "phone_format_equivalent", phoneFormattingEquivalent: true, differentValues: false },
    scopeTemplatesDifference: { classification: "collection_order_equivalent", collectionOrderEquivalent: true, orderingDifference: true },
  } });
  expect(rawBusiness()).toEqual(beforeBusiness); expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
});

test.each(["both", "profile_only", "templates_only"])("%s genuine portable divergence is independently classified and preserves all four mutations", async kind => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  if (kind !== "templates_only") cloud.profile.address = "DIFFERENT_PRIVATE_ADDRESS";
  if (kind !== "profile_only") cloud.templates[0].scopeText = "DIFFERENT_PRIVATE_SCOPE";
  await seedPortablePair(local, cloud); const before = operational(), beforeBusiness = rawBusiness();
  const result = await run();
  expect(result).toMatchObject({ ok: false, code: "workspace_bundle_not_matched", historicalBundleProof: {
    companyProfileMatched: kind === "templates_only", scopeTemplatesMatched: kind === "profile_only",
    companyProfileDifference: { classification: kind === "templates_only" ? "matched" : "value_difference", differentValues: kind !== "templates_only" },
    scopeTemplatesDifference: { classification: kind === "profile_only" ? "matched" : "value_difference", differentValues: kind !== "profile_only" },
  } });
  expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness); expect(decision().ledgerFailed).toBe(true);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["companyProfile", "scopeTemplates"])("%s local-only, cloud-only and changed fields remain visible as separate flags without revealing their keys", async family => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  const left = family === "companyProfile" ? local.profile : local.templates[0];
  const right = family === "companyProfile" ? cloud.profile : cloud.templates[0];
  left.PRIVATE_LOCAL_KEY = "PRIVATE_LOCAL_VALUE"; right.PRIVATE_CLOUD_KEY = "PRIVATE_CLOUD_VALUE";
  if (family === "companyProfile") right.companyName = "PRIVATE_DIFFERENT_NAME";
  else right.scopeText = "PRIVATE_DIFFERENT_SCOPE";
  await seedPortablePair(local, cloud); const before = operational();
  const result = await run();
  const difference = result.historicalBundleProof[family === "companyProfile" ? "companyProfileDifference" : "scopeTemplatesDifference"];
  expect(difference).toMatchObject({ classification: "mixed_difference", localOnlyFields: true, cloudOnlyFields: true, differentValues: true });
  expect(JSON.stringify(recordCloudConvergenceResult(result).historicalBundleProof)).not.toMatch(/PRIVATE_|private-|15550102020|SYNTHETIC/);
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["local", "cloud"])("%s-only template records stay blocked without choosing a canonical winner", async side => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  if (side === "local") cloud.templates.pop(); else local.templates.pop();
  await seedPortablePair(local, cloud); const before = operational();
  expect(await run()).toMatchObject({ ok: false, historicalBundleProof: { scopeTemplatesMatched: false,
    scopeTemplatesDifference: { classification: side + "_only_records", localOnlyRecords: side === "local", cloudOnlyRecords: side === "cloud" } } });
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("nested child ordering remains meaningful even when the outer template library is reordered", async () => {
  const local = portablePair();
  local.templates[0].laborItems.push({ ...local.templates[0].laborItems[0], id: "private-l-b", role: "PRIVATE_SECOND_ROLE" });
  const cloud = JSON.parse(JSON.stringify(local)); cloud.templates.reverse(); cloud.templates[1].laborItems.reverse();
  await seedPortablePair(local, cloud); const before = operational();
  expect(await run()).toMatchObject({ ok: false, historicalBundleProof: { scopeTemplatesMatched: false,
    scopeTemplatesDifference: { classification: "ordering_difference", orderingDifference: true, collectionOrderEquivalent: false } } });
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("simultaneous template ordering and content changes are independently reported", async () => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  cloud.templates.reverse(); cloud.templates[0].scopeText = "PRIVATE_CHANGED_SCOPE";
  await seedPortablePair(local, cloud); const before = operational();
  expect(await run()).toMatchObject({ ok: false, historicalBundleProof: { scopeTemplatesMatched: false,
    scopeTemplatesDifference: { classification: "mixed_difference", orderingDifference: true, differentValues: true, collectionOrderEquivalent: false } } });
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["changed_digits", "extension", "truncation", "changed_identity", "changed_child", "changed_image", "duplicate_identity", "missing_identity", "unsupported_record"])("%s cannot be hidden by phone/template compatibility", async kind => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  cloud.profile.phone = "+1 (555) 010-2020"; cloud.templates.reverse();
  if (kind === "changed_digits") cloud.profile.phone = "+1 (555) 010-2021";
  if (kind === "extension") cloud.profile.phone += " ext 4";
  if (kind === "truncation") cloud.profile.phone += "123";
  if (kind === "changed_identity") cloud.templates[1].id = "private-other-id";
  if (kind === "changed_child") cloud.templates[1].laborItems[0].rate += 1;
  if (kind === "changed_image") cloud.templates[1].scopeImages[0].dataUrl += "DIFFERENT";
  if (kind === "duplicate_identity") cloud.templates[0].id = cloud.templates[1].id;
  if (kind === "missing_identity") delete cloud.templates[0].id;
  if (kind === "unsupported_record") cloud.templates[0] = 7;
  await seedPortablePair(local, cloud); const before = operational();
  expect((await run()).ok).toBe(false); expect(operational()).toEqual(before);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("existing serialization equality is diagnosed separately without dropping unknown meaningful fields", async () => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  cloud.profile = Object.fromEntries(Object.entries(cloud.profile).reverse());
  cloud.templates[0].laborItems[0].rate = "75";
  await seedPortablePair(local, cloud);
  expect(await run()).toMatchObject({ ok: true, historicalBundleProof: {
    companyProfileDifference: { classification: "serialization_equivalent", serializationOnly: true },
    scopeTemplatesDifference: { classification: "serialization_equivalent", serializationOnly: true },
  } });
});

test("compatible portable representations cannot bypass immutable intent or changed-state checks", async () => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  cloud.profile.phone = "+1 (555) 010-2020"; cloud.templates.reverse();
  await seedPortablePair(local, cloud);
  await editLedger(ledger => { ledger.entries[15].payload.payments[0].amount += 1; });
  const before = operational();
  expect(await run()).toMatchObject({ ok: false, code: "historical_mutation_intent_uncovered" });
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("sanitized family differences never forward arbitrary keys, values or classification strings", () => {
  const safe = buildSafeConvergenceResult({ historicalBundleProof: {
    code: "company_profile_mismatch", family: "company_profile",
    companyProfileDifference: { classification: "PRIVATE_CUSTOMER", localOnlyFields: "PRIVATE_ADDRESS", differentValues: true, privateId: "private-id", payload: { name: "PRIVATE_BUSINESS" } },
    scopeTemplatesDifference: { classification: "ordering_difference", orderingDifference: true, privateId: "private-template" },
  } });
  expect(safe.historicalBundleProof.companyProfileDifference).toMatchObject({ classification: "unavailable", localOnlyFields: null, differentValues: true });
  expect(safe.historicalBundleProof.scopeTemplatesDifference).toMatchObject({ classification: "ordering_difference", orderingDifference: true });
  expect(JSON.stringify(safe)).not.toMatch(/PRIVATE_|private-|payload|privateId/);
});

test.each([["companyProfile", "local"], ["companyProfile", "cloud"], ["scopeTemplates", "local"], ["scopeTemplates", "cloud"]])("%s %s-only meaningful fields cannot be discarded", async (family, side) => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  const target = side === "local" ? local : cloud;
  (family === "companyProfile" ? target.profile : target.templates[0]).PRIVATE_EXTRA_FIELD = "PRIVATE_NONEMPTY_VALUE";
  await seedPortablePair(local, cloud); const before = operational(), beforeBusiness = rawBusiness();
  const result = await run();
  expect(result.ok).toBe(false);
  expect(result.historicalBundleProof[family === "companyProfile" ? "companyProfileDifference" : "scopeTemplatesDifference"])
    .toMatchObject({ classification: side + "_only_fields", localOnlyFields: side === "local", cloudOnlyFields: side === "cloud" });
  expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["companyProfile", "scopeTemplates"])("%s absent versus empty fields retain existing canonical equivalence", async family => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  (family === "companyProfile" ? cloud.profile : cloud.templates[0]).PRIVATE_EMPTY_FIELD = "";
  await seedPortablePair(local, cloud); const beforeBusiness = rawBusiness();
  const result = await run();
  expect(result.ok).toBe(true);
  expect(result.historicalBundleProof[family === "companyProfile" ? "companyProfileDifference" : "scopeTemplatesDifference"])
    .toMatchObject({ classification: "serialization_equivalent", serializationOnly: true });
  expect(rawBusiness()).toEqual(beforeBusiness);
});

test.each(["stale", "changed_profile"])("equivalent portable records do not bypass %s proof protection", async kind => {
  const local = portablePair(), cloud = JSON.parse(JSON.stringify(local));
  cloud.profile.phone = "+1 (555) 010-2020"; cloud.templates.reverse();
  await seedPortablePair(local, cloud); const before = operational();
  const result = await run({ verifyCloud: async input => {
    const proof = await runSupabaseCloudVerification(input);
    if (kind === "stale") proof.generatedAt = new Date(1000).toISOString();
    else {
      await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.COMPANY_PROFILE, value: JSON.stringify({ ...local.profile, phone: "15550109999" }) }]);
      runtimeRepository.commitRuntimeRecordBatch.mockClear();
    }
    return proof;
  } });
  expect(result).toMatchObject({ ok: false, code: kind === "stale" ? "strict_workspace_match_required" : "historical_workspace_context_changed" });
  expect(operational()).toEqual(before); expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(4);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});


test.each(["companyProfile", "settings", "scopeTemplates"])("eligible historical group reports the exact %s bundle mismatch without discarding any intent", async family => {
  const audit = await seedAudit(auditEnvelope());
  const bundle = mockRows.app_settings[0].setting_value;
  if (family === "companyProfile") bundle.companyProfile.companyName = "DIFFERENT_PRIVATE_BUSINESS";
  if (family === "settings") bundle.settings.pricing.defaultMarkupPct = 16;
  if (family === "scopeTemplates") bundle.scopeTemplates = [{ id: "PRIVATE_TEMPLATE_ID", name: "PRIVATE_TEMPLATE_NAME", scopeText: "PRIVATE_SCOPE" }];
  const before = operational(), beforeBusiness = rawBusiness(), verifyCloud = jest.fn(runSupabaseCloudVerification);
  expect(diagnosticPredicates()).toMatchObject({ historicalBaselineEligible: true, historicalFailureShapeEligible: true,
    inactiveWorkspaceBaselineQueue: true, activeCount: 4, hasCurrentDurableLedgerWork: true });
  const result = await run({ verifyCloud });
  const key = { companyProfile: "company_profile", settings: "settings", scopeTemplates: "scope_templates" }[family];
  expect(result).toMatchObject({ ok: false, status: "skipped", code: "workspace_bundle_not_matched", historicalBundleProof: {
    code: key + "_mismatch", family: key, snapshotAvailable: true, supplementalStatus: "available",
    companyProfileMatched: family !== "companyProfile", settingsMatched: family !== "settings", scopeTemplatesMatched: family !== "scopeTemplates",
    localShape: family === "scopeTemplates" ? "array" : "object", cloudShape: family === "scopeTemplates" ? "array" : "object",
  } });
  const safe = recordCloudConvergenceResult(result);
  expect(safe.historicalBundleProof).toEqual(result.historicalBundleProof);
  expect(JSON.stringify(safe)).not.toMatch(/DIFFERENT_PRIVATE_BUSINESS|PRIVATE_TEMPLATE|PRIVATE_SCOPE/);
  expect(verifyCloud).not.toHaveBeenCalled(); expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
  expect(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(audit); expect(decision().ledgerFailed).toBe(true);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["missing", "invalid", "error", "duplicate", "snapshot_error", "snapshot_invalid"])("%s snapshot/bundle availability is distinguished from business-content divergence", async kind => {
  if (kind === "missing") mockRows.app_settings = [];
  if (kind === "invalid") mockRows.app_settings[0].setting_value.version = 99;
  if (kind === "error") mockReadErrors.app_settings = { message: "PRIVATE_CLOUD_ERROR_TOKEN" };
  if (kind === "duplicate") mockRows.app_settings.push({ ...mockRows.app_settings[0], id: "private-duplicate-bundle" });
  if (kind === "snapshot_error") mockReadErrors.customers = { message: "PRIVATE_CLOUD_ERROR_TOKEN" };
  if (kind === "snapshot_invalid") mockRows.invoices[0].estimate_id = OTHER;
  const before = operational(), verifyCloud = jest.fn(runSupabaseCloudVerification);
  const result = await run({ verifyCloud });
  const snapshotFailed = kind.startsWith("snapshot_");
  expect(result).toMatchObject({ ok: false, code: "workspace_bundle_not_matched", historicalBundleProof: {
    code: snapshotFailed ? "cloud_snapshot_unavailable" : "app_restore_bundle_" + (kind === "duplicate" ? "error" : kind),
    family: "none", snapshotAvailable: !snapshotFailed, supplementalStatus: snapshotFailed ? "unavailable" : kind === "duplicate" ? "error" : kind,
    companyProfileMatched: null, settingsMatched: null, scopeTemplatesMatched: null, localShape: "unavailable", cloudShape: "unavailable",
  } });
  expect(JSON.stringify(recordCloudConvergenceResult(result))).not.toMatch(/PRIVATE_CLOUD_ERROR_TOKEN|private-duplicate-bundle/);
  expect(verifyCloud).not.toHaveBeenCalled(); expect(operational()).toEqual(before); expect(decision().ledgerFailed).toBe(true);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("available cloud bundle with uncaptured templates is not equivalent to a captured empty template array", async () => {
  mockRows.app_settings[0].setting_value.scopeTemplates = null;
  const before = operational();
  expect(await run()).toMatchObject({ ok: false, code: "workspace_bundle_not_matched", historicalBundleProof: {
    code: "scope_templates_mismatch", family: "scope_templates", localShape: "array", cloudShape: "null", scopeTemplatesMatched: false,
  } });
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["key_order_and_numeric_strings", "empty_object_and_null"])("already supported %s bundle representation still requires full proof", async kind => {
  await seedAudit(auditEnvelope());
  if (kind === "key_order_and_numeric_strings") {
    mockRows.app_settings[0].setting_value.settings = { pricing: { defaultMarkupPct: "15" } };
    mockRows.app_settings[0].setting_value.companyProfile = { companyName: " Synthetic business " };
  } else {
    await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.COMPANY_PROFILE, value: "{}" }]);
    mockRows.app_settings[0].setting_value.companyProfile = null;
    runtimeRepository.commitRuntimeRecordBatch.mockClear();
  }
  const beforeBusiness = rawBusiness(), audit = runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS);
  expect(await run()).toMatchObject({ ok: true, retiredCount: 4, historicalBundleProof: {
    code: "matched", family: "none", snapshotAvailable: true, supplementalStatus: "available",
    companyProfileMatched: true, settingsMatched: true, scopeTemplatesMatched: true,
  } });
  expect(rawBusiness()).toEqual(beforeBusiness); expect(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(audit);
  expect(mockReads.filter(table => table === "customers")).toHaveLength(2);
  expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
});

test.each(["business", "claim"])("%s changed during snapshot read is a proof-binding failure, not a bundle mismatch", async kind => {
  let releaseRead; mockReadGate = new Promise(resolve => { releaseRead = resolve; });
  const before = operational(), verifyCloud = jest.fn(runSupabaseCloudVerification);
  const pending = run({ verifyCloud });
  try {
    await waitFor(() => expect(mockReads).toHaveLength(1));
    if (kind === "business") {
      await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.SETTINGS, value: JSON.stringify({ pricing: { defaultMarkupPct: 20 } }) }]);
      runtimeRepository.commitRuntimeRecordBatch.mockClear();
    } else mockClaim = "new-surface-owner";
  } finally { releaseRead(); }
  expect(await pending).toMatchObject({ ok: false, code: "historical_workspace_context_changed" });
  expect(verifyCloud).not.toHaveBeenCalled(); expect(operational()).toEqual(before);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("bundle proof diagnostics discard unknown fields, payloads and unsafe enum values", () => {
  const safe = buildSafeConvergenceResult({ status: "skipped", code: "workspace_bundle_not_matched", historicalBundleProof: {
    code: "PRIVATE_TOKEN", family: "private-company-id", supplementalStatus: { payload: "PRIVATE_BUSINESS" },
    snapshotAvailable: { token: "PRIVATE_TOKEN" }, companyProfileMatched: "PRIVATE_BUSINESS", settingsMatched: false, scopeTemplatesMatched: true,
    localShape: "PRIVATE_CUSTOMER", cloudShape: { amount: 987654 }, payload: { id: "private-id", notes: "PRIVATE_BUSINESS" },
  } });
  expect(safe.historicalBundleProof).toEqual({ code: "unavailable", family: "unavailable", snapshotAvailable: null, supplementalStatus: "unavailable",
    companyProfileMatched: null, settingsMatched: false, scopeTemplatesMatched: true, localShape: "unavailable", cloudShape: "unavailable" });
  expect(JSON.stringify(safe)).not.toMatch(/PRIVATE_|private-|987654|payload/);
});

test("cached matching cloud bundle cannot replace a new snapshot that exposes genuine divergence", async () => {
  const cached = await readSupabaseCloudConvergenceSnapshot(props);
  expect(cached.mapped.settings).toEqual(business().settings);
  mockRows.app_settings[0].setting_value.settings = { pricing: { defaultMarkupPct: 18 } };
  mockReads = [];
  const before = operational();
  expect(await run({ cloudSnapshot: cached })).toMatchObject({ ok: false, code: "workspace_bundle_not_matched",
    historicalBundleProof: { code: "settings_mismatch", family: "settings" } });
  expect(mockReads.filter(table => table === "app_settings")).toHaveLength(1);
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});


test.each(["estimate_header", "estimate_restore", "estimate_child", "invoice_header", "invoice_child", "payment_amount", "payment_method"])("one unresolved %s payload preserves all four durable failures despite a fresh current/cloud match", async kind => {
  await editLedger(ledger => {
    const estimate = ledger.entries[14].payload, invoice = ledger.entries[15].payload;
    if (kind === "estimate_header") estimate.total += 1;
    if (kind === "estimate_restore") estimate.estimatorOnlyInput = { wasteFactor: 17 };
    if (kind === "estimate_child") estimate.labor.lines[0].rate += 1;
    if (kind === "invoice_header") invoice.balanceRemaining += 1;
    if (kind === "invoice_child") invoice.lineItems[0].price += 1;
    if (kind === "payment_amount") invoice.payments[0].amount += 1;
    if (kind === "payment_method") invoice.payments[0].method = "check";
  });
  const before = operational(), beforeBusiness = rawBusiness(), beforeClock = clock();
  expect((await runSupabaseCloudVerification({ ...props, storageSnapshot: localStorage })).allMatched).toBe(true);
  expect(await run()).toMatchObject({ ok: false, code: "historical_mutation_intent_uncovered" });
  expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness); expect(clock()).toBe(beforeClock);
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(4);
  expect(decision().ledgerFailed).toBe(true);
  expect(deriveCloudProductStatus({ connected: true, decision: decision() }).state).toBe("sync_issue");
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("a newer current document and fresh workspace match alone cannot supersede immutable intent", async () => {
  const local = business(); local.estimates[0].total += 50; local.estimates[0].updatedAt = Date.now();
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.ESTIMATES, value: JSON.stringify(local.estimates) }]);
  mockRows = cloudRows(local); runtimeRepository.commitRuntimeRecordBatch.mockClear();
  const before = operational();
  expect((await runSupabaseCloudVerification({ ...props, storageSnapshot: localStorage })).allMatched).toBe(true);
  expect(await run()).toMatchObject({ ok: false, code: "historical_mutation_intent_uncovered" });
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("concrete latest same-document verified acknowledgement plus NEW strict proof covers legitimate supersession", async () => {
  await editLedger(ledger => {
    ledger.entries[14].payload.total = 90;
    const appended = appendCloudMutationRecords(ledger, [{ companyId: COMPANY, entityType: "estimate", documentId: "e1", payload: business().estimates[0] }], { now: 3500 });
    Object.assign(ledger, appended.ledger);
    Object.assign(ledger.entries[28], { status: "acknowledged", acknowledgedAt: 4000, verifiedAt: 4000, lastAttemptAt: 3600 });
  });
  const before = readCloudMutationLedger(), beforeBusiness = rawBusiness(), beforeClock = clock();
  expect(await run()).toMatchObject({ ok: true, retiredCount: 4 });
  const after = readCloudMutationLedger();
  expect(after.entries[14].retirement.coverage).toEqual({ kind: "verified_same_document_supersession",
    mutationId: before.entries[28].mutationId, revision: 29 });
  expect(after.entries[1].retirement.coverage.kind).toBe("immutable_payload");
  expect(after.entries[28]).toEqual(before.entries[28]); expect(after.lastVerifiedAt).toBe(before.lastVerifiedAt);
  expect(rawBusiness()).toEqual(beforeBusiness); expect(clock()).toBe(beforeClock);
  expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
});

test.each(["project", "source_estimate"])("a named missing %s parent cannot be accepted as a nullable expected FK", async kind => {
  const local = business();
  if (kind === "project") local.estimates[0].projectId = "missing-project";
  else local.invoices[0].sourceEstimateId = "missing-estimate";
  const logicalKey = kind === "project" ? STORAGE_KEYS.ESTIMATES : STORAGE_KEYS.INVOICES;
  await runtimeCommitAtomicRecords([{ logicalKey, value: JSON.stringify(kind === "project" ? local.estimates : local.invoices) }]);
  await editLedger(ledger => {
    if (kind === "project") [1, 2, 14].forEach(i => { ledger.entries[i].payload = local.estimates[0]; });
    else ledger.entries[15].payload = local.invoices[0];
  });
  mockRows = cloudRows(local);
  if (kind === "project") mockRows.estimates[0].project_id = null;
  else mockRows.invoices[0].estimate_id = null;
  const before = operational(), beforeBusiness = rawBusiness();
  // The existing verifier projects an unresolved local parent to null. That
  // ordinary table match must not provide the stronger remediation proof.
  expect((await runSupabaseCloudVerification({ ...props, storageSnapshot: localStorage })).allMatched).toBe(true);
  expect((await run()).ok).toBe(false);
  expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
  expect(decision().ledgerFailed).toBe(true); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["project_fk", "estimate_fk", "customer_fk", "parent_company", "missing_cloud_parent", "requested_parent_changed", "invoice_detached"])("%s cannot retire named required relationships", async kind => {
  if (kind === "project_fk") mockRows.estimates[0].project_id = OTHER;
  if (kind === "estimate_fk") mockRows.invoices[0].estimate_id = null;
  if (kind === "customer_fk") mockRows.estimates[0].customer_id = null;
  if (kind === "parent_company") mockRows.projects[0].company_id = OTHER;
  if (kind === "missing_cloud_parent") mockRows.estimates = [];
  if (kind === "requested_parent_changed") await editLedger(ledger => { ledger.entries[1].payload.projectId = "old-parent"; });
  if (kind === "invoice_detached") {
    const local = business(); delete local.invoices[0].sourceEstimateId;
    await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.INVOICES, value: JSON.stringify(local.invoices) }]);
    await editLedger(ledger => { ledger.entries[15].payload = local.invoices[0]; });
    mockRows = cloudRows(local); mockRows.invoices[0].estimate_id = null;
  }
  const before = operational(), beforeBusiness = rawBusiness();
  expect((await run()).ok).toBe(false); expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("retained materialized provenance cannot clear the queue while one transferred intent is unresolved", async () => {
  await seedProducerRetainedReviewResidue();
  await editLedger(ledger => { ledger.entries[15].payload.payments[0].amount += 1; });
  const before = operational();
  expect(canVerifyHistoricalWorkspaceResidue({ storage: localStorage, companyId: COMPANY })).toBe(true);
  expect(await run()).toMatchObject({ ok: false, code: "historical_mutation_intent_uncovered" });
  expect(operational()).toEqual(before); expect(decision().ledgerFailed).toBe(true);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});


function diagnosticPredicates() {
  const ledger = JSON.parse(runtimeGetItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER));
  const queue = JSON.parse(runtimeGetItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE));
  const integrity = scanLocalDataIntegrity(buildLocalSnapshotFromStorage(localStorage).snapshot);
  return {
    historicalFailureShapeEligible: getHistoricalWorkspaceBaselineCandidates(ledger, { companyId: COMPANY, before: Date.now() }).length > 0,
    inactiveWorkspaceBaselineQueue: isInactiveWorkspaceBaselineQueue(queue, { companyId: COMPANY, before: Date.now() }),
    historicalBaselineEligible: canVerifyHistoricalWorkspaceResidue({ storage: localStorage, companyId: COMPANY }),
    hasCurrentDurableLedgerWork: hasCurrentDurableLedgerWork(ledger), hasPendingLocalBackup: hasPendingLocalBackup(queue),
    activeCount: getCloudMutationLedgerSummary(ledger).activeCount,
    blockersCount: integrity.summary.blockersCount, warningsCount: integrity.summary.warningsCount,
    repairsAvailableCount: integrity.summary.repairsAvailableCount,
    operationalPresent: [STORAGE_KEYS.CLOUD_AUTO_BACKUP_PAUSE, STORAGE_KEYS.CLOUD_PARTIAL_RECOVERY_STATUS, STORAGE_KEYS.CLOUD_CONVERGENCE_JOURNAL]
      .some(key => localStorage.getItem(key) != null),
  };
}

test.each(["AUDIT_EVENTS", "SETTINGS", "SCOPE_TEMPLATES"])("%s unsupported artifact shape reproduces the supplied predicates without an integrity/recovery blocker", async family => {
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS[family], value: "null" }]);
  runtimeRepository.commitRuntimeRecordBatch.mockClear();
  const before = operational(), beforeBusiness = rawBusiness();
  expect(diagnosticPredicates()).toEqual({
    historicalFailureShapeEligible: true, inactiveWorkspaceBaselineQueue: true, historicalBaselineEligible: false,
    hasCurrentDurableLedgerWork: true, hasPendingLocalBackup: false, activeCount: 4,
    blockersCount: 0, warningsCount: 0, repairsAvailableCount: 0, operationalPresent: false,
  });
  expect(getHistoricalWorkspaceBaselineEligibility({ storage: localStorage, companyId: COMPANY })).toEqual({
    eligible: false, code: "workspace_artifact_unsupported_shape", family: family.toLowerCase(),
  });
  const outcomes = [], listener = event => outcomes.push(event.detail);
  window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, listener);
  const actor = renderHook(() => useCloudAutoConvergence({ ...props, deviceLock: { ready: true, loading: false, isActive: true, isLocked: false } }));
  try {
    await waitFor(() => expect(outcomes[0]).toMatchObject({ status: "skipped", code: "local_backup_pending" }));
  } finally { actor.unmount(); window.removeEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, listener); }
  expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
  expect(mockReads).toHaveLength(0); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("terminal durable work alone permits the existing fresh proof path; classification never retires it", async () => {
  await seedProducerRetainedReviewResidue();
  const before = operational();
  expect(diagnosticPredicates()).toMatchObject({ historicalFailureShapeEligible: true, inactiveWorkspaceBaselineQueue: true,
    historicalBaselineEligible: true, hasCurrentDurableLedgerWork: true, activeCount: 4, blockersCount: 0, operationalPresent: false });
  expect(getHistoricalWorkspaceBaselineEligibility({ storage: localStorage, companyId: COMPANY })).toEqual({ eligible: true, code: "eligible", family: "none" });
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
  expect(await run()).toMatchObject({ ok: true, retiredCount: 4 });
});

test.each(["pending", "syncing", "retry_wait"])("%s current durable work still blocks proof entry", async status => {
  await editLedger(ledger => { ledger.entries[14].status = status; });
  const before = operational();
  expect(getHistoricalWorkspaceBaselineEligibility({ storage: localStorage, companyId: COMPANY })).toEqual({ eligible: false, code: "active_work_not_historical", family: "none" });
  expect((await run()).ok).toBe(false); expect(mockReads).toHaveLength(0);
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("sanitized eligibility distinguishes an empty snapshot from an export parse failure", async () => {
  await runtimeCommitAtomicRecords([STORAGE_KEYS.CUSTOMERS, STORAGE_KEYS.PROJECTS, STORAGE_KEYS.ESTIMATES, STORAGE_KEYS.INVOICES].map(logicalKey => ({ logicalKey, value: "[]" })));
  expect(getHistoricalWorkspaceBaselineEligibility({ storage: localStorage, companyId: COMPANY })).toEqual({ eligible: false, code: "empty_core_business_snapshot", family: "none" });
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.CUSTOMERS, value: JSON.stringify(business().customers) },
    { logicalKey: STORAGE_KEYS.AUDIT_EVENTS, value: "{private-business-payload" }]);
  runtimeRepository.commitRuntimeRecordBatch.mockClear();
  const before = operational();
  const result = getHistoricalWorkspaceBaselineEligibility({ storage: localStorage, companyId: COMPANY });
  expect(result).toEqual({ eligible: false, code: "workspace_artifact_parse_error", family: "audit_events" });
  expect(JSON.stringify(result)).not.toContain("private-business-payload");
  expect(operational()).toEqual(before); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});


function auditEnvelope() {
  // Use the historical/current production serializer, not a guessed wrapper.
  // Equal timestamps deliberately retain insertion order rather than id order.
  return buildAuditStorePayload([
    createStoredAuditEvent("project.archived", { id: "audit-z", createdAt: 1000, targetType: "project", targetId: "p1",
      relatedIds: ["c1", "e1"], metadata: { previousStatus: "active", nextStatus: "archived", nested: { retained: [3, 1, 2] } } }),
    createStoredAuditEvent("invoice.payment_added", { id: "audit-a", createdAt: 1000, targetType: "invoice", targetId: "i1",
      actorId: "synthetic-actor", beforeHash: "before", afterHash: "after", metadata: { paymentId: "pay1", amount: 25 } }),
    createStoredAuditEvent("estimate.updated", { id: "audit-last", createdAt: 2000, targetType: "estimate", targetId: "e1" }),
  ]);
}
async function seedAudit(value) {
  const raw = "  " + JSON.stringify(value, null, 2) + "\n";
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.AUDIT_EVENTS, value: raw }]);
  runtimeRepository.commitRuntimeRecordBatch.mockClear();
  return raw;
}

test.each(["envelope", "legacy_array", "empty_envelope", "reordered_event_fields"])("audit envelope from the real store writer (%s) passes only through fresh strict verification with unchanged durable history", async format => {
  const envelope = format === "empty_envelope" ? buildAuditStorePayload([]) : auditEnvelope();
  if (format === "reordered_event_fields") envelope.events = envelope.events.map(event => Object.fromEntries(Object.entries(event).reverse()));
  expect(envelope.schemaVersion).toBe(AUDIT_STORE_SCHEMA_VERSION);
  const original = format === "legacy_array" ? envelope.events : envelope;
  const raw = await seedAudit(original), before = operational(), beforeBusiness = rawBusiness(), beforeClock = clock();
  // The export builder really is array-only. Both the original reader and
  // writer have supported the envelope since the audit store was introduced.
  const originalArtifact = buildLocalStorageExportArtifact(localStorage);
  expect(originalArtifact.parseWarnings.some(warning => warning.key === STORAGE_KEYS.AUDIT_EVENTS && warning.code.startsWith("unsupported_shape:")))
    .toBe(format !== "legacy_array");
  expect(diagnosticPredicates()).toMatchObject({ historicalFailureShapeEligible: true, inactiveWorkspaceBaselineQueue: true,
    historicalBaselineEligible: true, hasCurrentDurableLedgerWork: true, activeCount: 4, blockersCount: 0 });
  expect(operational()).toEqual(before); expect(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(raw);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
  const verifyCloud = jest.fn(async input => {
    const artifact = buildLocalStorageExportArtifact(input.storageSnapshot);
    expect(artifact.parsedData.migration.auditEvents.parsed).toEqual(envelope.events);
    expect(artifact.parseWarnings.filter(warning => warning.key === STORAGE_KEYS.AUDIT_EVENTS && warning.code.startsWith("unsupported_shape:"))).toEqual([]);
    const { snapshot } = buildLocalSnapshotFromStorage(input.storageSnapshot);
    expect(snapshot.auditEvents).toEqual(envelope.events);
    const context = { companyId: COMPANY, userId: USER };
    expect(mapLocalSnapshotToBackendDraft(snapshot, context).auditEvents)
      .toEqual(envelope.events.map(event => mapLocalAuditEventToBackendDraft(event, context)));
    return runSupabaseCloudVerification(input);
  });
  expect(await run({ verifyCloud })).toMatchObject({ ok: true, status: "matched", retiredCount: 4 });
  expect(verifyCloud).toHaveBeenCalledTimes(1);
  expect(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(raw); expect(localStorage.getItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(raw);
  expect(rawBusiness()).toEqual(beforeBusiness); expect(clock()).toBe(beforeClock);
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(0);
  expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
  expect(runtimeRepository.commitRuntimeRecordBatch.mock.calls[0][0].records.map(row => row.logicalKey).sort())
    .toEqual([STORAGE_KEYS.CLOUD_MUTATION_LEDGER, STORAGE_KEYS.CLOUD_BACKUP_QUEUE].sort());
  // Verify the original envelope/array, every field and event order survived the
  // actual encrypted transaction and a fresh hydration, without reserialization.
  await hydrateVaultRuntime({ userId: USER, companyId: COMPANY, repository, activation: beginVaultRuntimeActivation() });
  expect(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(raw);
  expect(JSON.parse(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS))).toEqual(original);
  expect(mockReads).not.toContain("audit_events");
});

test.each(["bad_json", "null", "scalar", "unknown_version", "missing_version", "missing_timestamp", "invalid_timestamp", "unknown_envelope_field", "events_not_array", "invalid_event", "missing_id", "missing_type", "invalid_event_time", "duplicate_identity", "malformed_legacy_array", "invalid_metadata", "invalid_related_ids", "unknown_event_field", "invalid_actor", "empty_unknown_field", "noncanonical_time", "missing_metadata"])("%s audit data remains blocked and byte-for-byte preserved", async kind => {
  let value = auditEnvelope();
  if (kind === "null") value = null;
  if (kind === "scalar") value = 7;
  if (kind === "unknown_version") value.schemaVersion = "99.0.0";
  if (kind === "missing_version") delete value.schemaVersion;
  if (kind === "missing_timestamp") delete value.updatedAt;
  if (kind === "invalid_timestamp") value.updatedAt = "not-a-timestamp";
  if (kind === "unknown_envelope_field") value.unrecognizedRecord = { preserve: true };
  if (kind === "events_not_array") value.events = { event: value.events[0] };
  if (kind === "invalid_event") value.events.push(null);
  if (kind === "missing_id") delete value.events[0].id;
  if (kind === "missing_type") delete value.events[0].type;
  if (kind === "invalid_event_time") value.events[0].createdAt = -1;
  if (kind === "duplicate_identity") value.events.push(value.events[0]);
  if (kind === "malformed_legacy_array") value = [{ id: "missing-details" }];
  if (kind === "invalid_metadata") value.events[0].metadata = "unrecognized-history";
  if (kind === "invalid_related_ids") value.events[0].relatedIds = { unexpected: "c1" };
  if (kind === "unknown_event_field") value.events[0].unrecognizedField = "retain-evidence";
  if (kind === "invalid_actor") value.events[0].actorId = { id: "synthetic-actor" };
  if (kind === "empty_unknown_field") value.events[0].unknownEmptyField = "";
  if (kind === "noncanonical_time") value.events[0].createdAt = String(value.events[0].createdAt);
  if (kind === "missing_metadata") delete value.events[0].metadata;
  let raw = await seedAudit(value);
  if (kind === "bad_json") {
    raw = "{unparseable-audit-evidence";
    await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.AUDIT_EVENTS, value: raw }]);
    runtimeRepository.commitRuntimeRecordBatch.mockClear();
  }
  const before = operational(), beforeBusiness = rawBusiness();
  expect(getHistoricalWorkspaceBaselineEligibility({ storage: localStorage, companyId: COMPANY })).toEqual({
    eligible: false, code: kind === "bad_json" ? "workspace_artifact_parse_error" : "workspace_artifact_unsupported_shape", family: "audit_events",
  });
  expect((await run()).ok).toBe(false); expect(mockReads).toHaveLength(0);
  expect(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(raw); expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
  expect(decision().ledgerFailed).toBe(true); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["SETTINGS", "SCOPE_TEMPLATES", "CUSTOMERS"])("valid audit envelope cannot suppress %s artifact validation", async family => {
  const raw = await seedAudit(auditEnvelope());
  await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS[family], value: family === "CUSTOMERS" ? "{broken" : "null" }]);
  runtimeRepository.commitRuntimeRecordBatch.mockClear();
  const before = operational();
  expect(getHistoricalWorkspaceBaselineEligibility({ storage: localStorage, companyId: COMPANY })).toEqual({
    eligible: false, code: family === "CUSTOMERS" ? "workspace_artifact_parse_error" : "workspace_artifact_unsupported_shape", family: family.toLowerCase(),
  });
  expect((await run()).ok).toBe(false); expect(operational()).toEqual(before); expect(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(raw);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["payload", "parent", "stale", "company", "browser"])("valid audit history does not bypass %s proof", async kind => {
  const raw = await seedAudit(auditEnvelope());
  if (kind === "payload") await editLedger(ledger => { ledger.entries[15].payload.payments[0].amount += 1; });
  if (kind === "parent") mockRows.invoices[0].estimate_id = null;
  if (kind === "browser") mockActive = false;
  const before = operational(), beforeBusiness = rawBusiness();
  const result = await run({ verifyCloud: async input => {
    const proof = await runSupabaseCloudVerification(input);
    if (kind === "stale") proof.generatedAt = new Date(1000).toISOString();
    if (kind === "company") proof.company.id = OTHER;
    return proof;
  } });
  expect(result.ok).toBe(false); expect(operational()).toEqual(before); expect(rawBusiness()).toEqual(beforeBusiness);
  expect(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(raw); expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(4);
  expect(decision().ledgerFailed).toBe(true); expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test.each(["content", "ordering", "bytes_only"])("audit %s changed during fresh verification invalidates retirement", async kind => {
  const envelope = auditEnvelope(); const raw = await seedAudit(envelope), before = operational();
  let changed;
  const result = await run({ verifyCloud: async input => {
    const proof = await runSupabaseCloudVerification(input);
    if (kind === "content") envelope.events[0].metadata.newEvidence = "retain-concurrent-event-detail";
    if (kind === "ordering") envelope.events.reverse();
    changed = kind === "bytes_only" ? raw + " " : JSON.stringify(envelope);
    await runtimeCommitAtomicRecords([{ logicalKey: STORAGE_KEYS.AUDIT_EVENTS, value: changed }]);
    runtimeRepository.commitRuntimeRecordBatch.mockClear();
    return proof;
  } });
  expect(result).toMatchObject({ ok: false, code: "historical_workspace_context_changed" });
  expect(operational()).toEqual(before); expect(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(changed);
  expect(runtimeRepository.commitRuntimeRecordBatch).not.toHaveBeenCalled();
});

test("the normal hook advances the mixed four-entry profile with valid audit history and retained compatibility provenance", async () => {
  await seedProducerRetainedReviewResidue(); const raw = await seedAudit(auditEnvelope());
  const beforeBusiness = rawBusiness(), outcomes = [], listener = event => outcomes.push(event.detail);
  window.addEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, listener);
  const actor = renderHook(() => useCloudAutoConvergence({ ...props, deviceLock: { ready: true, loading: false, isActive: true, isLocked: false } }));
  try {
    await waitFor(() => expect(outcomes[0]).toMatchObject({ status: "matched", code: "" }));
    expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(0);
    expect(mockReads.filter(table => table === "customers")).toHaveLength(2);
    expect(runtimeGetItem(STORAGE_KEYS.AUDIT_EVENTS)).toBe(raw); expect(rawBusiness()).toEqual(beforeBusiness);
    expect(runtimeRepository.commitRuntimeRecordBatch).toHaveBeenCalledTimes(1);
  } finally { actor.unmount(); window.removeEventListener(CLOUD_CONVERGENCE_RESULT_EVENT, listener); }
});
