import { act, renderHook, waitFor } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  activateAccountScopedLocalStorage, deactivateAccountScopedLocalStorage,
  getActiveAccountWorkspaceIdentity, installAuthoritativeVaultRuntime,
  revokeAuthoritativeVaultRuntime, setActiveWorkspaceVaultCompatibility,
} from "./accountScopedLocalStorage";
import { deriveWorkspaceVaultTag } from "./vaultSession";
import {
  appendCloudMutationRecords, createEmptyCloudMutationLedger, normalizeCloudMutationLedger,
  readCloudMutationLedger, getCloudMutationLedgerSummary, getHistoricalMutationRecoveryContext,
  deriveParentMissingEstimateRecoveryIdentity, reconcileSupersededParentMissingMutations,
  requeueCloudMutationForAutomaticRetry, recordCloudMutationFailure, acknowledgeCloudMutation,
  requeueCloudMutationForManualRetry, getHistoricalWorkspaceBaselineCandidates, buildWorkspaceBaselineRetiredLedger,
} from "./cloudMutationLedger";
import { buildEstimateCloudMutationPlan } from "./estimateCloudMutationPlan";
import { buildLegacyCompatibilityMaterializationMutations } from "./cloudLegacyQueueCutover";
import useCloudAutoBackup from "./useCloudAutoBackup";
import { runSupabaseCloudMutationWrite } from "./supabaseCloudMutationWriter";
import { getCloudDataDecision } from "./localDataIntegrity";
import { resolveOperationOwnerFromSnapshot } from "./cloudOperationOwnership";
import { deriveLastSuccessfulSyncAt } from "./useCloudBackupStatus";
import { resetCloudOperationRunLockForTests } from "./cloudOperationRunLock";
import { runtimeCommitAtomicRecords, getVaultRuntimeStatus, isVaultRuntimeReady, runtimeGetItem } from "./vaultRuntimeStore";

let mockRecords;
let mockReady;
let mockGeneration;
jest.mock("./vaultRuntimeStore", () => ({
  getVaultRuntimeStatus: jest.fn(() => ({ state: "ready", generation: mockGeneration })),
  isVaultRuntimeReady: jest.fn(generation => mockReady && generation === mockGeneration),
  runtimeGetItem: jest.fn(key => mockRecords.get(key) ?? null),
  runtimeCommitAtomicRecords: jest.fn(async records => {
    records.forEach(({ logicalKey, value }) => mockRecords.set(logicalKey, value));
    return { ok: true };
  }),
}));
jest.mock("./supabaseCloudMutationWriter", () => ({ runSupabaseCloudMutationWrite: jest.fn() }));

const USER = "11111111-2222-4333-8444-555555555555";
const COMPANY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const estimate = {
  id: "legacy-E1", docType: "estimate", projectId: "legacy-P1", customerId: "legacy-C1",
  estimateNumber: "EST-2606", status: "draft", total: 5000,
  materials: { items: [{ id: "material-1", desc: "Fixtures", qty: 1, priceEach: 1000 }] },
};
const props = { enabled: true, configured: true, user: { id: USER }, company: { id: COMPANY },
  immediateDelayMs: 1, normalDelayMs: 2 };
let tag;
const originalCrypto = globalThis.crypto;
beforeAll(() => { if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto; });
afterAll(() => { globalThis.crypto = originalCrypto; });
beforeEach(async () => {
  deactivateAccountScopedLocalStorage();
  localStorage.clear();
  mockRecords = new Map();
  mockReady = true;
  mockGeneration = 7;
  getVaultRuntimeStatus.mockImplementation(() => ({ state: "ready", generation: mockGeneration }));
  isVaultRuntimeReady.mockImplementation(generation => mockReady && generation === mockGeneration);
  runtimeGetItem.mockImplementation(key => mockRecords.get(key) ?? null);
  runtimeCommitAtomicRecords.mockImplementation(async records => {
    records.forEach(({ logicalKey, value }) => mockRecords.set(logicalKey, value));
    return { ok: true };
  });
  runtimeCommitAtomicRecords.mockClear();
  runSupabaseCloudMutationWrite.mockReset();
  runSupabaseCloudMutationWrite.mockResolvedValue({ ok: true, verified: true, verifiedAt: Date.now() });
  const opened = activateAccountScopedLocalStorage({ storage: localStorage, userId: USER, companyId: COMPANY });
  expect(opened.installed).toBe(true);
  tag = await deriveWorkspaceVaultTag(USER, COMPANY);
  setActiveWorkspaceVaultCompatibility({ workspaceTag: tag, state: "authoritative", generation: mockGeneration });
  installAuthoritativeVaultRuntime({ workspaceTag: tag, generation: mockGeneration, adapter: {
    isReady: generation => mockReady && generation === mockGeneration,
    getItem: key => mockRecords.get(key) ?? null, setItem: (key, value) => mockRecords.set(key, value),
    removeItem: key => mockRecords.delete(key), clear: () => mockRecords.clear(), keys: () => [...mockRecords.keys()],
  } });
});
afterEach(() => { deactivateAccountScopedLocalStorage(); resetCloudOperationRunLockForTests(); });

function save(ledger) { mockRecords.set(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger)); }
function fixture({ proof = "none", companyId = COMPANY, documentId = estimate.id, legacyProof = false } = {}) {
  // The real save owner with omitted event.companyId produces the historical
  // immutable payload. The cutover owner also copies the complete same record.
  const historical = buildEstimateCloudMutationPlan([], [estimate], { source: "EstimateForm.saveEstimate" }).mutations[0];
  const inputs = Array.from({ length: 28 }, (_, i) => ({
    companyId: COMPANY, entityType: "customer", documentId: "unrelated-" + i, payload: { id: "unrelated-" + i },
  }));
  inputs[1] = historical;
  if (proof !== "none") inputs[27] = {
    companyId: legacyProof ? "" : companyId, entityType: proof === "parent" ? "project" : "estimate",
    documentId: proof === "parent" ? documentId === estimate.id ? estimate.projectId : documentId : documentId,
    operation: proof === "delete" ? "delete" : "upsert",
    payload: proof === "parent" ? { id: documentId === estimate.id ? estimate.projectId : documentId }
      : { ...estimate, id: documentId, total: 6000 },
  };
  const { ledger } = appendCloudMutationRecords(createEmptyCloudMutationLedger(), inputs, { now: 100 });
  ledger.entries = ledger.entries.map(entry => ({ ...entry, status: "acknowledged", verifiedAt: 3000, acknowledgedAt: 3000 }));
  ledger.entries[1] = { ...ledger.entries[1], status: "needs_attention", retryCount: 298,
    lastAttemptAt: 2000, lastErrorCode: "projects_parent_missing", lastError: "Referenced projects row was not found.",
    verifiedAt: null, acknowledgedAt: null };
  ledger.lastAcknowledgedRevision = 28; ledger.lastVerifiedAt = 3000;
  save(ledger);
  return ledger;
}
const context = () => getHistoricalMutationRecoveryContext({ userId: USER, companyId: COMPANY });

test("historical live shape uses the real full estimate payload and canonical id/projectId without rewriting it", async () => {
  const ledger = fixture();
  const cutover = buildLegacyCompatibilityMaterializationMutations({ snapshot: { estimates: [estimate] } })
    .find(entry => entry.entityType === "estimate");
  expect(cutover.payload).toEqual(ledger.entries[1].payload);
  expect(ledger.entries[1]).toEqual(expect.objectContaining({
    revision: 2, companyId: "", entityType: "estimate", operation: "upsert",
    status: "needs_attention", retryCount: 298, payload: estimate,
  }));
  expect(deriveParentMissingEstimateRecoveryIdentity(ledger.entries[1], await context()))
    .toEqual({ companyId: COMPANY, documentId: estimate.id, projectId: estimate.projectId });
  expect(readCloudMutationLedger()).toEqual(ledger);
});

test.each([["upsert", false], ["delete", false], ["upsert", true], ["delete", true]])("exact verified historical %s supersession, legacy proof=%s, preserves history and every clock", async (proof, legacyProof) => {
  const before = fixture({ proof, legacyProof });
  expect(resolveOperationOwnerFromSnapshot({ snapshot: { estimates: [estimate] }, mutationLedger: before })).toBe("backup");
  expect((await reconcileSupersededParentMissingMutations({ recoveryContext: await context() })).retiredCount).toBe(1);
  const after = readCloudMutationLedger();
  expect(after.entries[1]).toEqual(expect.objectContaining({
    status: "acknowledged", payload: before.entries[1].payload, companyId: "", retryCount: 298,
    lastErrorCode: before.entries[1].lastErrorCode, lastAttemptAt: before.entries[1].lastAttemptAt,
    createdAt: before.entries[1].createdAt, verifiedAt: null, supersededByRevision: 28,
  }));
  expect(after.entries[27]).toEqual(before.entries[27]);
  expect(after.lastVerifiedAt).toBe(before.lastVerifiedAt);
  expect(after.lastAcknowledgedRevision).toBe(before.lastAcknowledgedRevision);
  expect(deriveLastSuccessfulSyncAt({ ledgerVerifiedAt: after.lastVerifiedAt })).toBe(before.lastVerifiedAt);
  expect(getCloudMutationLedgerSummary(after)).toEqual(expect.objectContaining({ failed: null, activeCount: 0 }));
  expect(getCloudDataDecision({ mutationLedger: after }).ledgerFailed).toBe(false);
  expect(resolveOperationOwnerFromSnapshot({ snapshot: { estimates: [estimate] }, mutationLedger: after })).toBe("convergence");
});

test.each(["none", "other_estimate", "other_company", "unverified", "pending", "bundle", "invoice"])("%s never supersedes historical E1", async kind => {
  const before = fixture({ proof: kind === "none" ? "none" : "upsert",
    documentId: kind === "other_estimate" ? "E2" : estimate.id, companyId: kind === "other_company" ? OTHER : COMPANY });
  if (kind === "unverified") before.entries[27].verifiedAt = null;
  if (kind === "pending") before.entries[27].status = "pending";
  if (kind === "bundle" || kind === "invoice") before.entries[27].entityType = kind === "bundle" ? "app_restore_bundle" : "invoice";
  save(before);
  expect((await reconcileSupersededParentMissingMutations({ recoveryContext: await context() })).retiredCount).toBe(0);
  expect(readCloudMutationLedger().entries[1]).toEqual(before.entries[1]);
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).failed.revision).toBe(2);
});

test.each(["missing", "wrong_user", "wrong_company", "revoked_adapter", "not_ready", "wrong_tag", "changed_generation", "stale_facade", "payload_conflict"])("%s context cannot reconcile or retry historical work", async kind => {
  const before = fixture({ proof: "upsert" });
  let proofContext = await context();
  if (kind === "missing") proofContext = null;
  if (kind === "wrong_user") proofContext = await getHistoricalMutationRecoveryContext({ userId: "other-user", companyId: COMPANY });
  if (kind === "wrong_company") proofContext = await getHistoricalMutationRecoveryContext({ userId: USER, companyId: OTHER });
  if (kind === "revoked_adapter") revokeAuthoritativeVaultRuntime();
  if (kind === "not_ready") mockReady = false;
  if (kind === "wrong_tag") proofContext = { ...proofContext, workspaceTag: "wrong" };
  if (kind === "changed_generation") mockGeneration += 1;
  if (kind === "stale_facade") activateAccountScopedLocalStorage({ storage: localStorage, userId: USER, companyId: OTHER });
  if (kind === "payload_conflict") { before.entries[1].payload.companyId = OTHER; save(before); }
  expect((await reconcileSupersededParentMissingMutations({ recoveryContext: proofContext })).retiredCount).toBe(0);
  // The original encrypted namespace was not written, including after switch.
  expect(JSON.parse(mockRecords.get(STORAGE_KEYS.CLOUD_MUTATION_LEDGER)).entries[1]).toEqual(before.entries[1]);
  expect((await requeueCloudMutationForAutomaticRetry(before.entries[1], { recoveryContext: proofContext })).ok).toBe(false);
});

test.each([false, true])("same authoritative ledger can prove a parent with missing company metadata=%s", async legacyProof => {
  fixture({ proof: "parent", legacyProof });
  const { unmount } = renderHook(() => useCloudAutoBackup(props));
  await waitFor(() => expect(readCloudMutationLedger().entries[1].status).toBe("acknowledged"));
  expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1);
  expect(runSupabaseCloudMutationWrite).toHaveBeenCalledWith(expect.objectContaining({
    company: { id: COMPANY }, mutation: expect.objectContaining({ revision: 2, companyId: "", payload: estimate }),
  }));
  unmount();
});

test("wrong parent does not permit a retry", async () => {
  const before = fixture({ proof: "parent", documentId: "wrong-P2" });
  expect((await requeueCloudMutationForAutomaticRetry(before.entries[1], { recoveryContext: await context() })).ok).toBe(false);
  expect(readCloudMutationLedger()).toEqual(before);
});

test("consumed historical parent proof survives normalization/remount and a new verified parent permits exactly one more retry", async () => {
  fixture({ proof: "parent" });
  runSupabaseCloudMutationWrite.mockResolvedValue({ ok: false, verified: false, code: "projects_parent_missing" });
  const first = renderHook(() => useCloudAutoBackup(props));
  await waitFor(() => expect(readCloudMutationLedger().entries[1].retryCount).toBe(299));
  first.unmount();
  const consumed = readCloudMutationLedger().entries[1].automaticRecoveryProof;
  save(normalizeCloudMutationLedger(JSON.parse(JSON.stringify(readCloudMutationLedger()))));
  expect(readCloudMutationLedger().entries[1].automaticRecoveryProof).toBe(consumed);
  const second = renderHook(() => useCloudAutoBackup(props));
  await act(async () => {
    for (let i = 0; i < 10; i += 1) {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  });
  expect(runSupabaseCloudMutationWrite).toHaveBeenCalledTimes(1);
  second.unmount();
  const appended = appendCloudMutationRecords(readCloudMutationLedger(), [{
    companyId: COMPANY, entityType: "project", documentId: estimate.projectId, payload: { id: estimate.projectId },
  }]);
  save(appended.ledger);
  await acknowledgeCloudMutation(appended.appended[0], { verifiedAt: Date.now() + 1 });
  const nextContext = await context();
  expect((await requeueCloudMutationForAutomaticRetry(readCloudMutationLedger().entries[1], { recoveryContext: nextContext, now: Date.now() + 40000 })).ok).toBe(true);
  expect(readCloudMutationLedger().entries[1].automaticRecoveryProof).not.toBe(consumed);
  await recordCloudMutationFailure(readCloudMutationLedger().entries[1], { errorCode: "projects_parent_missing" });
  expect((await requeueCloudMutationForAutomaticRetry(readCloudMutationLedger().entries[1], { recoveryContext: nextContext, now: Date.now() + 1e8 })).ok).toBe(false);
});

test("300 unchanged historical recovery cycles preserve 298; manual retry remains deliberate", async () => {
  const before = fixture();
  const recoveryContext = await context();
  const worker = renderHook(() => useCloudAutoBackup(props));
  for (let i = 0; i < 300; i += 1) {
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: STORAGE_KEYS.CLOUD_MUTATION_LEDGER } }));
      expect((await requeueCloudMutationForAutomaticRetry(before.entries[1], { recoveryContext, now: Date.now() + 1e8 + i * 31000 })).ok).toBe(false);
    });
  }
  worker.unmount();
  expect(readCloudMutationLedger()).toEqual(before);
  expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
  expect((await requeueCloudMutationForManualRetry(before.entries[1])).ok).toBe(true);
  expect(readCloudMutationLedger().entries[1].payload).toEqual(before.entries[1].payload);
});


const baselineProof = { companyId: COMPANY, startedAt: 5000, verifiedAt: 6000 };
test("baseline shapes are proof candidates only, and never broaden automatic retry/reconciliation", async () => {
  for (const [entityType, lastErrorCode] of [["estimate", "estimate_write_failed"], ["invoice", "estimates_parent_missing"]]) {
    const before = fixture({ proof: "parent" });
    Object.assign(before.entries[1], { entityType, lastErrorCode }); save(before);
    expect(getHistoricalWorkspaceBaselineCandidates(before, { companyId: COMPANY, before: 5000 })).toHaveLength(1);
    expect(buildWorkspaceBaselineRetiredLedger(before, baselineProof)).toBeNull();
    const recoveryContext = await context();
    expect(deriveParentMissingEstimateRecoveryIdentity(before.entries[1], recoveryContext)).toBeNull();
    expect((await requeueCloudMutationForAutomaticRetry(before.entries[1], { recoveryContext })).ok).toBe(false);
    expect((await reconcileSupersededParentMissingMutations({ recoveryContext })).retiredCount).toBe(0);
    expect(readCloudMutationLedger()).toEqual(before);
  }
});

test.each(["missing", "false", "stale"])("%s independent intent proof cannot retire baseline candidates", kind => {
  const before = fixture();
  const proof = { ...baselineProof };
  if (kind !== "missing") proof.coversPayload = () => kind !== "false";
  if (kind === "stale") proof.verifiedAt = 4000;
  expect(buildWorkspaceBaselineRetiredLedger(before, proof)).toBeNull();
  expect(readCloudMutationLedger()).toEqual(before); expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
});

test("baseline coverage is recorded without rewriting immutable payloads, retry evidence or ledger clocks", () => {
  const before = fixture(); const coversPayload = jest.fn(() => true);
  const after = buildWorkspaceBaselineRetiredLedger(before, { ...baselineProof, coversPayload });
  expect(coversPayload).toHaveBeenCalledWith(expect.objectContaining({ revision: 2, payload: estimate }));
  expect(after.entries[1]).toEqual({ ...before.entries[1], status: "retired", retirement: {
    reason: "verified_workspace_baseline_superseded", companyId: COMPANY, verifiedAt: 6000,
    coverage: { kind: "immutable_payload", mutationId: before.entries[1].mutationId, revision: 2 },
  } });
  expect(after.entries.filter((_, i) => i !== 1)).toEqual(before.entries.filter((_, i) => i !== 1));
  expect(after.lastAcknowledgedRevision).toBe(before.lastAcknowledgedRevision); expect(after.lastVerifiedAt).toBe(before.lastVerifiedAt);
  expect(readCloudMutationLedger()).toEqual(before); expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
});

test.each(["wrong_document", "wrong_company", "payload_company", "unverified", "superseded_ack", "future_ack", "latest_conflicting"])("%s cannot stand in for concrete latest verified supersession", kind => {
  const before = fixture({ proof: "upsert", documentId: kind === "wrong_document" ? "other" : estimate.id,
    companyId: kind === "wrong_company" ? OTHER : COMPANY });
  if (kind === "payload_company") before.entries[27].payload.companyId = OTHER;
  if (kind === "unverified") before.entries[27].verifiedAt = null;
  if (kind === "superseded_ack") before.entries[27].supersededByMutationId = "other-proof";
  if (kind === "future_ack") before.entries[27].acknowledgedAt = 7000;
  if (kind === "latest_conflicting") {
    const appended = appendCloudMutationRecords(before, [{ companyId: COMPANY, entityType: "estimate", documentId: estimate.id, payload: { ...estimate, total: 7000 } }], { now: 3500 });
    Object.assign(before, appended.ledger); Object.assign(before.entries[28], { status: "acknowledged", acknowledgedAt: 4000, verifiedAt: 4000 });
  }
  const original = JSON.stringify(before);
  expect(buildWorkspaceBaselineRetiredLedger(before, { ...baselineProof, coversPayload: entry => entry.payload.total === 6000 })).toBeNull();
  expect(JSON.stringify(before)).toBe(original); expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
});

test("verified same-document immutable supersession is accepted only with a new covering proof", () => {
  const before = fixture({ proof: "upsert" });
  const after = buildWorkspaceBaselineRetiredLedger(before, { ...baselineProof, coversPayload: entry => entry.payload.total === 6000 });
  expect(after.entries[1].retirement.coverage).toEqual({ kind: "verified_same_document_supersession", mutationId: before.entries[27].mutationId, revision: 28 });
  expect(after.entries[27]).toEqual(before.entries[27]); expect(after.entries[1].payload.total).toBe(5000);
});

test.each(["mutationId", "revision"])("ambiguous persisted %s cannot retire any entries", field => {
  const ledger = fixture(); ledger.entries[0][field] = ledger.entries[1][field];
  const before = JSON.stringify(ledger);
  expect(getHistoricalWorkspaceBaselineCandidates(ledger, { companyId: COMPANY, before: 5000 })).toEqual([]);
  expect(buildWorkspaceBaselineRetiredLedger(ledger, { ...baselineProof, coversPayload: () => true })).toBeNull();
  expect(JSON.stringify(ledger)).toBe(before);
});
