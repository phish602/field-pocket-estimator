import { runtimeCommitAtomicRecords } from "./vaultRuntimeStore";
import {
  acknowledgeCloudMutation,
  appendCloudMutationRecords,
  canVerifiedMutationSupersedeCloudBackupQueue,
  CLOUD_MUTATION_AUTO_RECOVERY_COOLDOWN_MS,
  createEmptyCloudMutationLedger,
  getNextCloudMutation,
  getCloudMutationLedgerSummary,
  normalizeCloudMutationLedger,
  reconcileSupersededParentMissingMutations,
  readCloudMutationLedger,
  reconcileSupersededCloudBackupQueueFromAcknowledgedMutations,
  recordCloudMutationFailure,
  requeueCloudMutationForAutomaticRetry,
  requeueCloudMutationForManualRetry,
} from "./cloudMutationLedger";
import { STORAGE_KEYS } from "../constants/storageKeys";

jest.mock("./vaultRuntimeStore", () => ({
  runtimeCommitAtomicRecords: jest.fn(),
}));

function input(id, amount = 10, entityType = "invoice") {
  return { companyId: "company-1", entityType, documentId: id, payload: { id, payments: [{ id: `pay-${id}`, amount }] } };
}

beforeEach(() => {
  localStorage.clear();
  runtimeCommitAtomicRecords.mockReset();
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
});

test("append assigns ordered immutable revisions and preserves older payloads", () => {
  const source = input("inv-1", 10);
  const first = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [source]);
  source.payload.payments[0].amount = 999;
  const second = appendCloudMutationRecords(first.ledger, [input("inv-1", 20)]);
  expect(second.ledger.entries.map((entry) => entry.revision)).toEqual([1, 2]);
  expect(second.ledger.entries[0].payload.payments[0].amount).toBe(10);
  expect(second.ledger.entries[1].payload.payments[0].amount).toBe(20);
});

test("one ledger preserves existing invoice entries and accepts immutable estimate entries", () => {
  const invoice = input("inv-1", 10, "invoice");
  const estimate = { companyId: "company-1", entityType: "estimate", documentId: "est-1", payload: { id: "est-1", estimateNumber: "EST-1", materials: { items: [{ priceEach: 1000 }] } } };
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [invoice, estimate]);
  estimate.payload.materials.items[0].priceEach = 9999;
  expect(appended.ledger.entries).toEqual([
    expect.objectContaining({ entityType: "invoice", documentId: "inv-1", revision: 1 }),
    expect.objectContaining({ entityType: "estimate", documentId: "est-1", revision: 2 }),
  ]);
  expect(appended.ledger.entries[1].payload.materials.items[0].priceEach).toBe(1000);
});

test("exact acknowledgement leaves a newer mutation pending", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [input("inv-1", 10), input("inv-1", 20)]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  const result = await acknowledgeCloudMutation(appended.appended[0], { verifiedAt: 12345 });
  expect(result.ok).toBe(true);
  const ledger = readCloudMutationLedger();
  expect(ledger.entries[0].status).toBe("acknowledged");
  expect(ledger.entries[1].status).toBe("pending");
  expect(getNextCloudMutation(ledger).revision).toBe(2);
  expect(ledger.lastVerifiedAt).toBe(12345);
});

test("acknowledging estimate revision N leaves the newer estimate revision N+1 pending", async () => {
  const first = { companyId: "company-1", entityType: "estimate", documentId: "est-1", payload: { id: "est-1", total: 100 } };
  const second = { companyId: "company-1", entityType: "estimate", documentId: "est-1", payload: { id: "est-1", total: 1100 } };
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [first, second]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  await acknowledgeCloudMutation(appended.appended[0], { verifiedAt: 22222 });
  const ledger = readCloudMutationLedger();
  expect(ledger.entries[0]).toEqual(expect.objectContaining({ entityType: "estimate", revision: 1, status: "acknowledged" }));
  expect(ledger.entries[1]).toEqual(expect.objectContaining({ entityType: "estimate", revision: 2, status: "pending", payload: second.payload }));
  expect(getNextCloudMutation(ledger).revision).toBe(2);
});

test("current failures remain durable and become needs_attention at the retry limit", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [input("inv-1")]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  await recordCloudMutationFailure(appended.appended[0], { error: "one", retryDelayMs: 1 });
  await recordCloudMutationFailure(appended.appended[0], { error: "two", retryDelayMs: 1 });
  await recordCloudMutationFailure(appended.appended[0], { error: "three", retryDelayMs: 1 });
  expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({ status: "needs_attention", retryCount: 3, lastError: "three" }));
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(3);
});

test("manual retry requeues only the exact failed mutation without changing payload or error evidence", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [input("inv-1")]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  await recordCloudMutationFailure(appended.appended[0], { error: "one" });
  await recordCloudMutationFailure(appended.appended[0], { error: "two" });
  await recordCloudMutationFailure(appended.appended[0], { error: "three", errorCode: "target_verification_failed" });
  const before = readCloudMutationLedger().entries[0];

  const result = await requeueCloudMutationForManualRetry(before);

  expect(result.ok).toBe(true);
  expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({
    mutationId: before.mutationId,
    revision: before.revision,
    payload: before.payload,
    status: "pending",
    retryCount: 0,
    lastError: "three",
    lastErrorCode: "target_verification_failed",
  }));
});

function compatibilityQueue(overrides = {}) {
  return {
    schemaVersion: "3.0.0",
    pending: true,
    status: "conflict",
    reviewOrigin: "current_sync_failure",
    lastErrorCode: "data_mismatch",
    documentId: "est-2606",
    companyId: "company-1",
    domains: ["estimates"],
    lastQueuedAt: 1000,
    localMutationRevision: 7,
    reasons: ["old_estimate_save"],
    severity: "normal",
    priority: "normal",
    syncingRevision: null,
    ...overrides,
  };
}

function verifiedEstimateInput() {
  return {
    companyId: "company-1",
    entityType: "estimate",
    documentId: "est-2606",
    createdAt: 2000,
    payload: { id: "est-2606", estimateNumber: "EST-2606", materials: { total: 2000 } },
  };
}

test("verified acknowledgement and exact same-document compatibility failure retirement share one vault transaction", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [verifiedEstimateInput()]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify(compatibilityQueue()));

  const result = await acknowledgeCloudMutation(appended.appended[0], { verifiedAt: 3000 });

  expect(result).toEqual(expect.objectContaining({ ok: true, queueRetired: true }));
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(1);
  expect(runtimeCommitAtomicRecords.mock.calls[0][0].map((record) => record.logicalKey)).toEqual([
    STORAGE_KEYS.CLOUD_MUTATION_LEDGER,
    STORAGE_KEYS.CLOUD_BACKUP_QUEUE,
  ]);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE))).toEqual(expect.objectContaining({
    pending: false,
    status: "clean",
    lastVerifiedAt: 3000,
    supersededCompatibilityFailure: expect.objectContaining({
      documentId: "est-2606",
      mutationRevision: 1,
      lastErrorCode: "data_mismatch",
    }),
  }));
});

test.each([
  ["different document", { documentId: "est-2607" }],
  ["mixed domains", { domains: ["customers", "estimates"] }],
  ["newer global work", { lastQueuedAt: 2001 }],
  ["different company", { companyId: "company-2" }],
])("verified mutation preserves a %s queue failure", async (_label, queueOverrides) => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [verifiedEstimateInput()]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  const queue = compatibilityQueue(queueOverrides);
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify(queue));
  const result = await acknowledgeCloudMutation(appended.appended[0], { verifiedAt: 3000 });
  expect(result.queueRetired).toBe(false);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE))).toEqual(queue);
});

test("an empty legacy queue company is accepted only with every other exact supersession proof", () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [verifiedEstimateInput()]);
  expect(canVerifiedMutationSupersedeCloudBackupQueue(compatibilityQueue({ companyId: "" }), appended.appended[0])).toBe(true);
});

test("startup reconciliation retires an already-acknowledged matching failure without a network write", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [verifiedEstimateInput()]);
  const acknowledged = {
    ...appended.ledger,
    lastAcknowledgedRevision: 1,
    lastVerifiedAt: 3000,
    entries: [{ ...appended.ledger.entries[0], status: "acknowledged", acknowledgedAt: 3000, verifiedAt: 3000 }],
  };
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(acknowledged));
  localStorage.setItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE, JSON.stringify(compatibilityQueue()));

  const result = await reconcileSupersededCloudBackupQueueFromAcknowledgedMutations();

  expect(result).toEqual(expect.objectContaining({ ok: true, repaired: true }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE))).toEqual(expect.objectContaining({ pending: false, status: "clean" }));
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(1);
});

test("elapsed cooldown alone cannot requeue an unchanged terminal failure", async () => {
  const appended = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [verifiedEstimateInput()]);
  const failed = {
    ...appended.ledger.entries[0],
    status: "needs_attention",
    retryCount: 3,
    lastAttemptAt: 1000,
    lastError: "permission denied",
    lastErrorCode: "estimate_line_items_target_cleanup_failed",
  };
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify({ ...appended.ledger, entries: [failed] }));
  const cooling = await requeueCloudMutationForAutomaticRetry(failed, { now: 1000, trigger: "online" });
  expect(cooling).toEqual(expect.objectContaining({ ok: false, code: "mutation_recovery_evidence_unchanged" }));

  const requeued = await requeueCloudMutationForAutomaticRetry(failed, {
    now: 1000 + CLOUD_MUTATION_AUTO_RECOVERY_COOLDOWN_MS,
    trigger: "online",
  });
  expect(requeued.ok).toBe(false);
  expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({
    status: "needs_attention",
    retryCount: 3,
    lastError: "permission denied",
    lastErrorCode: "estimate_line_items_target_cleanup_failed",
  }));
});

function parentFailureLedger({ sameDocument = true, operation = "upsert", parent = false } = {}) {
  const inputs = Array.from({ length: 28 }, (_, i) => ({
    companyId: "company-1", entityType: "customer", documentId: `customer-${i}`,
    payload: { id: `customer-${i}` },
  }));
  inputs[1] = { companyId: "company-1", entityType: "estimate", documentId: "E1", payload: { id: "E1", projectId: "P1", total: 100 } };
  inputs[27] = parent
    ? { companyId: "company-1", entityType: "project", documentId: "P1", payload: { id: "P1" } }
    : { ...inputs[1], documentId: sameDocument ? "E1" : "E2", operation,
      payload: { id: sameDocument ? "E1" : "E2", projectId: "P1", total: 200 } };
  const { ledger } = appendCloudMutationRecords(createEmptyCloudMutationLedger(), inputs, { now: 100 });
  ledger.entries = ledger.entries.map(entry => ({ ...entry, status: "acknowledged", acknowledgedAt: 5000, verifiedAt: 5000 }));
  ledger.entries[1] = { ...ledger.entries[1], status: "needs_attention", retryCount: 290,
    lastAttemptAt: 1000, acknowledgedAt: null, verifiedAt: null, lastErrorCode: "projects_parent_missing", lastError: "Referenced projects row was not found." };
  ledger.lastAcknowledgedRevision = 28;
  ledger.lastVerifiedAt = 5000;
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));
  return ledger;
}

test.each(["upsert", "delete"])("live revision 2 failure is durably covered only by exact newer verified estimate %s", async operation => {
  const before = parentFailureLedger({ operation });
  expect(getCloudMutationLedgerSummary(before)).toEqual(expect.objectContaining({ activeCount: 1, failed: expect.objectContaining({ revision: 2, retryCount: 290 }) }));
  const { deriveCloudProductStatus } = require("./useCloudBackupStatus");
  expect(deriveCloudProductStatus({ connected: true, mutationLedger: before, decision: { ledgerFailed: true, verifiedCurrent: true } }).state).toBe("sync_issue");
  const result = await reconcileSupersededParentMissingMutations();
  expect(result.retiredCount).toBe(1);
  const after = readCloudMutationLedger();
  expect(after.entries[1]).toEqual(expect.objectContaining({ status: "acknowledged", retryCount: 290,
    lastErrorCode: "projects_parent_missing", verifiedAt: null,
    supersededByMutationId: before.entries[27].mutationId, supersededByRevision: 28 }));
  expect(after.entries[1].payload).toEqual(before.entries[1].payload);
  expect(after.entries[27]).toEqual(before.entries[27]);
  expect(after.lastVerifiedAt).toBe(before.lastVerifiedAt);
  expect(after.lastAcknowledgedRevision).toBe(28);
  expect(getCloudMutationLedgerSummary(after)).toEqual(expect.objectContaining({ failed: null, activeCount: 0 }));
  const { getCloudDataDecision } = require("./localDataIntegrity");
  expect(getCloudDataDecision({ mutationLedger: after }).ledgerFailed).toBe(false);
  const { resolveOperationOwnerFromSnapshot, CLOUD_OPERATION_OWNER } = require("./cloudOperationOwnership");
  expect(resolveOperationOwnerFromSnapshot({ snapshot: { estimates: [{ id: "E1" }] }, mutationLedger: before })).toBe(CLOUD_OPERATION_OWNER.BACKUP);
  expect(resolveOperationOwnerFromSnapshot({ snapshot: { estimates: [{ id: "E1" }] }, mutationLedger: after })).toBe(CLOUD_OPERATION_OWNER.CONVERGENCE);
});

test.each(["different_document", "different_company", "unverified", "pending", "bundle", "unrelated_revision", "newer_pending"])("%s cannot prove same-estimate supersession", async kind => {
  const before = parentFailureLedger({ sameDocument: kind !== "different_document" });
  if (kind === "different_company") before.entries[27].companyId = "company-other";
  if (kind === "unverified") before.entries[27].verifiedAt = null;
  if (kind === "pending") before.entries[27].status = "pending";
  if (kind === "bundle") before.entries[27].entityType = "app_restore_bundle";
  if (kind === "unrelated_revision") before.entries[27].entityType = "customer";
  if (kind === "newer_pending") {
    const appended = appendCloudMutationRecords(before, [{ ...before.entries[27], payload: { id: "E1", total: 300 } }]);
    before.entries = appended.ledger.entries;
  }
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(before));
  expect((await reconcileSupersededParentMissingMutations()).retiredCount).toBe(0);
  expect(readCloudMutationLedger().entries[1].status).toBe("needs_attention");
});

test("current parent-missing failure remains terminal across 300 unchanged recovery and failure-record attempts", async () => {
  const before = parentFailureLedger({ sameDocument: false });
  before.entries[1].retryCount = 3;
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(before));
  runtimeCommitAtomicRecords.mockClear();
  for (let i = 0; i < 300; i += 1) {
    const mutation = readCloudMutationLedger().entries[1];
    expect((await requeueCloudMutationForAutomaticRetry(mutation, { now: 1e8 + i * 31000, trigger: "mount" })).ok).toBe(false);
    expect((await recordCloudMutationFailure(mutation, { errorCode: "projects_parent_missing" })).ok).toBe(false);
  }
  expect(readCloudMutationLedger().entries[1]).toEqual(before.entries[1]);
  expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
});

test("new exact parent acknowledgement permits one durable retry, never reuse after failure or remount", async () => {
  const before = parentFailureLedger({ parent: true });
  const failed = before.entries[1];
  expect((await requeueCloudMutationForAutomaticRetry(failed, { now: 1001 })).code).toBe("mutation_recovery_cooldown");
  expect((await requeueCloudMutationForAutomaticRetry(failed, { now: 40000 })).ok).toBe(true);
  const requeued = readCloudMutationLedger().entries[1];
  expect(requeued.automaticRecoveryProof).toContain(before.entries[27].mutationId);
  await recordCloudMutationFailure(requeued, { errorCode: "projects_parent_missing" });
  expect((await requeueCloudMutationForAutomaticRetry(readCloudMutationLedger().entries[1], { now: Date.now() + 1e8 })).ok).toBe(false);
  expect(readCloudMutationLedger().entries[1].retryCount).toBe(291);
  // Even a clock rollback cannot reuse the durable evidence token.
  const persisted = readCloudMutationLedger();
  persisted.entries[1].lastAttemptAt = 1000;
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(persisted));
  expect((await requeueCloudMutationForAutomaticRetry(persisted.entries[1], { now: 40000 })).ok).toBe(false);
});

test("consumed evidence survives reload and only a new verified parent revision permits another retry", async () => {
  const before = parentFailureLedger({ parent: true });
  await requeueCloudMutationForAutomaticRetry(before.entries[1], { now: 40000 });
  await recordCloudMutationFailure(readCloudMutationLedger().entries[1], { errorCode: "projects_parent_missing" });
  const consumed = readCloudMutationLedger().entries[1].automaticRecoveryProof;
  const reloaded = normalizeCloudMutationLedger(JSON.parse(JSON.stringify(readCloudMutationLedger())));
  expect(reloaded.entries[1].automaticRecoveryProof).toBe(consumed);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(reloaded));
  expect((await requeueCloudMutationForAutomaticRetry(reloaded.entries[1], { now: Date.now() + 1e8 })).ok).toBe(false);

  const appended = appendCloudMutationRecords(readCloudMutationLedger(), [{
    companyId: "company-1", entityType: "project", documentId: "P1", payload: { id: "P1" },
  }]);
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(appended.ledger));
  await acknowledgeCloudMutation(appended.appended[0], { verifiedAt: Date.now() + 1 });
  expect((await requeueCloudMutationForAutomaticRetry(readCloudMutationLedger().entries[1], { now: Date.now() + 40000 })).ok).toBe(true);
  expect(readCloudMutationLedger().entries[1].automaticRecoveryProof).not.toBe(consumed);
  await recordCloudMutationFailure(readCloudMutationLedger().entries[1], { errorCode: "projects_parent_missing" });
  const finalReload = normalizeCloudMutationLedger(JSON.parse(JSON.stringify(readCloudMutationLedger())));
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(finalReload));
  expect((await requeueCloudMutationForAutomaticRetry(finalReload.entries[1], { now: Date.now() + 1e8 })).ok).toBe(false);
});

test.each(["wrong_parent", "old_parent", "deleted_parent", "pending_parent"])("%s does not unlock automatic parent recovery", async kind => {
  const ledger = parentFailureLedger({ parent: true });
  if (kind === "wrong_parent") ledger.entries[27].documentId = "P2";
  if (kind === "old_parent") ledger.entries[27].verifiedAt = 900;
  if (kind === "deleted_parent") ledger.entries[27].operation = "delete";
  if (kind === "pending_parent") ledger.entries[27].status = "pending";
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));
  expect((await requeueCloudMutationForAutomaticRetry(ledger.entries[1], { now: 40000 })).ok).toBe(false);
});

test("live activeCount four retains all three real pending mutations after exact retirement", async () => {
  const before = parentFailureLedger();
  [4, 5, 6].forEach(index => { before.entries[index].status = "pending"; });
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(before));
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).activeCount).toBe(4);
  await reconcileSupersededParentMissingMutations();
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger())).toEqual(expect.objectContaining({ activeCount: 3, failed: null }));
  [4, 5, 6].forEach(index => expect(readCloudMutationLedger().entries[index]).toEqual(before.entries[index]));
});

test("retirement leaves a separate genuine failure active and vault refusal preserves the historical entry", async () => {
  const ledger = parentFailureLedger();
  ledger.entries[3] = { ...ledger.entries[3], status: "needs_attention", lastErrorCode: "current_real_failure" };
  localStorage.setItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));
  runtimeCommitAtomicRecords.mockRejectedValueOnce(new Error("NOT_READY"));
  await expect(reconcileSupersededParentMissingMutations()).rejects.toThrow("NOT_READY");
  expect(readCloudMutationLedger().entries[1].status).toBe("needs_attention");
  await reconcileSupersededParentMissingMutations();
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger())).toEqual(expect.objectContaining({ activeCount: 1, failed: expect.objectContaining({ revision: 4 }) }));
});
