/* global globalThis */
// AUTOMATIC MISSING-PARENT RECOVERY THROUGH THE REAL WORKER.
//
// Reproduces the Production failure end to end against the persisted ledger:
// a new account's estimate references a project that exists on the device but
// never reached the cloud. The cloud writer below enforces the same parent
// rule as Supabase (an estimate or invoice cannot be written before its
// project row exists). With no user action, the worker must sync the project
// first and then complete the original estimate mutation.

import { act, renderHook, waitFor } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  activateAccountScopedLocalStorage, deactivateAccountScopedLocalStorage,
  installAuthoritativeVaultRuntime, setActiveWorkspaceVaultCompatibility,
} from "./accountScopedLocalStorage";
import { deriveWorkspaceVaultTag } from "./vaultSession";
import {
  appendCloudMutationRecords, createEmptyCloudMutationLedger, getCloudMutationLedgerSummary, readCloudMutationLedger,
} from "./cloudMutationLedger";
import useCloudAutoBackup from "./useCloudAutoBackup";
import { runSupabaseCloudMutationWrite } from "./supabaseCloudMutationWriter";
import { resetCloudOperationRunLockForTests } from "./cloudOperationRunLock";
import { runtimeCommitAtomicRecords, getVaultRuntimeStatus, isVaultRuntimeReady, runtimeGetItem } from "./vaultRuntimeStore";

let mockRecords;
let mockGeneration;
jest.mock("./vaultRuntimeStore", () => ({
  getVaultRuntimeStatus: jest.fn(() => ({ state: "ready", generation: mockGeneration })),
  isVaultRuntimeReady: jest.fn(generation => generation === mockGeneration),
  runtimeGetItem: jest.fn(key => mockRecords.get(key) ?? null),
  runtimeCommitAtomicRecords: jest.fn(async records => {
    records.forEach(({ logicalKey, value }) => mockRecords.set(logicalKey, value));
    return { ok: true };
  }),
}));
jest.mock("./supabaseCloudMutationWriter", () => ({ runSupabaseCloudMutationWrite: jest.fn() }));

jest.setTimeout(30000);

const USER = "11111111-2222-4333-8444-555555555555";
const COMPANY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const props = { enabled: true, configured: true, user: { id: USER }, company: { id: COMPANY }, immediateDelayMs: 1, normalDelayMs: 2 };

const customer = { id: "c_1793513096951_85e9ff5a50ffd", name: "John Doe Test" };
const project = { id: "proj_9vzc57", customerId: customer.id, projectName: "Recharge HVAC System", status: "active" };
const estimate = {
  id: "doc_mvxfg4xq_zmg7w8", docType: "estimate", estimateNumber: "EST-0001", status: "draft",
  projectId: project.id, customerId: customer.id, total: 1107.5, grossProfit: 824.5,
};

// Cloud model: rows keyed by entity type, and the writer's parent rule.
let cloud;
function installCloudWriter({ transientProjectFailures = 0 } = {}) {
  let projectFailuresLeft = transientProjectFailures;
  runSupabaseCloudMutationWrite.mockImplementation(async ({ mutation, company }) => {
    if (company?.id !== COMPANY) return { ok: false, verified: false, code: "mutation_company_mismatch" };
    const { entityType, payload } = mutation;
    if (entityType === "project") {
      if (projectFailuresLeft > 0) { projectFailuresLeft -= 1; return { ok: false, verified: false, code: "project_write_failed" }; }
      if (!cloud.customer.has(payload.customerId)) return { ok: false, verified: false, code: "customers_parent_missing" };
    }
    if ((entityType === "estimate" || entityType === "invoice") && !cloud.project.has(payload.projectId)) {
      return { ok: false, verified: false, code: "projects_parent_missing" };
    }
    cloud[entityType].set(payload.id, JSON.parse(JSON.stringify(payload)));
    return { ok: true, verified: true, verifiedAt: Date.now() };
  });
}

const originalCrypto = globalThis.crypto;
beforeAll(() => { if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto; });
afterAll(() => { globalThis.crypto = originalCrypto; });
beforeEach(async () => {
  deactivateAccountScopedLocalStorage();
  localStorage.clear();
  resetCloudOperationRunLockForTests();
  mockRecords = new Map();
  mockGeneration = 7;
  getVaultRuntimeStatus.mockImplementation(() => ({ state: "ready", generation: mockGeneration }));
  isVaultRuntimeReady.mockImplementation(generation => generation === mockGeneration);
  runtimeGetItem.mockImplementation(key => mockRecords.get(key) ?? null);
  runtimeCommitAtomicRecords.mockImplementation(async records => {
    records.forEach(({ logicalKey, value }) => mockRecords.set(logicalKey, value));
    return { ok: true };
  });
  runSupabaseCloudMutationWrite.mockReset();
  cloud = { customer: new Map([[customer.id, customer]]), project: new Map(), estimate: new Map(), invoice: new Map() };
  installCloudWriter();
  expect(activateAccountScopedLocalStorage({ storage: localStorage, userId: USER, companyId: COMPANY }).installed).toBe(true);
  const tag = await deriveWorkspaceVaultTag(USER, COMPANY);
  setActiveWorkspaceVaultCompatibility({ workspaceTag: tag, state: "authoritative", generation: mockGeneration });
  installAuthoritativeVaultRuntime({ workspaceTag: tag, generation: mockGeneration, adapter: {
    isReady: generation => generation === mockGeneration,
    getItem: key => mockRecords.get(key) ?? null, setItem: (key, value) => mockRecords.set(key, value),
    removeItem: key => mockRecords.delete(key), clear: () => mockRecords.clear(), keys: () => [...mockRecords.keys()],
  } });
  mockRecords.set(STORAGE_KEYS.CUSTOMERS, JSON.stringify([customer]));
  mockRecords.set(STORAGE_KEYS.PROJECTS, JSON.stringify([project]));
  mockRecords.set(STORAGE_KEYS.ESTIMATES, JSON.stringify([estimate]));
});
afterEach(() => { deactivateAccountScopedLocalStorage(); resetCloudOperationRunLockForTests(); });

function seedEstimateMutation({ exhausted = false } = {}) {
  const { ledger } = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [
    { companyId: "", entityType: "estimate", documentId: estimate.id, source: "EstimateForm.saveEstimate", payload: estimate },
  ]);
  if (exhausted) {
    ledger.entries[0] = { ...ledger.entries[0], status: "needs_attention", retryCount: 3,
      lastAttemptAt: Date.now() - 31000, lastErrorCode: "projects_parent_missing", lastError: "Referenced projects row was not found." };
  }
  mockRecords.set(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));
  return ledger.entries[0];
}

const writes = () => runSupabaseCloudMutationWrite.mock.calls.map(([args]) => `${args.mutation.entityType}:${args.mutation.documentId}`);
const entriesOf = (entityType) => readCloudMutationLedger().entries.filter((entry) => entry.entityType === entityType);
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 80)); });

test("B: a fresh estimate whose project never reached the cloud syncs project first, then itself", async () => {
  const original = seedEstimateMutation();
  const { unmount } = renderHook(() => useCloudAutoBackup(props));

  await waitFor(() => expect(entriesOf("estimate")[0].status).toBe("acknowledged"), { timeout: 15000 });

  expect(writes()[0]).toBe(`estimate:${estimate.id}`);
  expect(writes().slice(-2)).toEqual([`project:${project.id}`, `estimate:${estimate.id}`]);
  expect(entriesOf("project")).toEqual([expect.objectContaining({ status: "acknowledged", payload: project })]);
  expect(entriesOf("estimate")).toEqual([expect.objectContaining({ mutationId: original.mutationId, payload: estimate })]);
  expect(cloud.project.get(project.id)).toEqual(project);
  expect(cloud.estimate.get(estimate.id)).toEqual(estimate);
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger())).toEqual(expect.objectContaining({ activeCount: 0, failed: null }));
  unmount();
});

test("C: an estimate that already exhausted its retries is completed without discarding the original mutation", async () => {
  const original = seedEstimateMutation({ exhausted: true });
  // G: the failure is visible before recovery.
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).failed.mutationId).toBe(original.mutationId);

  const { unmount } = renderHook(() => useCloudAutoBackup(props));
  await waitFor(() => expect(entriesOf("estimate")[0].status).toBe("acknowledged"), { timeout: 15000 });

  expect(writes()).toEqual([`project:${project.id}`, `estimate:${estimate.id}`]);
  expect(entriesOf("estimate")[0]).toEqual(expect.objectContaining({
    mutationId: original.mutationId, revision: original.revision, payload: estimate, retryCount: 3,
  }));
  expect(cloud.estimate.get(estimate.id).grossProfit).toBe(824.5);
  // G: cleared only after the dependent itself is acknowledged.
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger())).toEqual(expect.objectContaining({ activeCount: 0, failed: null }));
  unmount();
});

test("D: recovery interrupted by a restart resumes from durable state without duplicates", async () => {
  seedEstimateMutation({ exhausted: true });
  installCloudWriter({ transientProjectFailures: 1 });

  const { unmount: closeFirstSession } = renderHook(() => useCloudAutoBackup(props));
  await waitFor(() => expect(entriesOf("project")[0]?.status).toBe("retry_wait"), { timeout: 15000 });
  closeFirstSession();
  // Durable: the recovered parent is in the persisted ledger, not in memory.
  expect(JSON.parse(mockRecords.get(STORAGE_KEYS.CLOUD_MUTATION_LEDGER)).entries.map((entry) => entry.entityType)).toEqual(["estimate", "project"]);

  const { unmount: closeSecondSession } = renderHook(() => useCloudAutoBackup(props));
  await waitFor(() => expect(entriesOf("estimate")[0].status).toBe("acknowledged"), { timeout: 15000 });
  await settle();

  expect(entriesOf("project")).toHaveLength(1);
  expect(entriesOf("estimate")).toHaveLength(1);
  expect(writes()).toEqual([`project:${project.id}`, `project:${project.id}`, `estimate:${estimate.id}`]);
  expect(cloud.project.size).toBe(1);
  expect(cloud.estimate.size).toBe(1);
  closeSecondSession();
});

test("E: an invoice whose auto-created project is missing syncs after the project, money unchanged", async () => {
  const invoice = { id: "inv_dep_1", docType: "invoice", invoiceNumber: "INV-0001", projectId: project.id, customerId: customer.id,
    invoiceTotal: 1107.5, total: 1107.5, amountPaid: 500, balanceRemaining: 607.5, payments: [{ id: "pay-1", amount: 500 }] };
  const { ledger } = appendCloudMutationRecords(createEmptyCloudMutationLedger(), [
    { companyId: "", entityType: "invoice", documentId: invoice.id, payload: invoice },
  ]);
  ledger.entries[0] = { ...ledger.entries[0], status: "needs_attention", retryCount: 3,
    lastAttemptAt: Date.now() - 31000, lastErrorCode: "projects_parent_missing" };
  mockRecords.set(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));

  const { unmount } = renderHook(() => useCloudAutoBackup(props));
  await waitFor(() => expect(entriesOf("invoice")[0].status).toBe("acknowledged"), { timeout: 15000 });

  expect(writes()).toEqual([`project:${project.id}`, `invoice:${invoice.id}`]);
  expect(cloud.invoice.get(invoice.id)).toEqual(invoice);
  unmount();
});

test("F/G: a project missing on the device is not fabricated and the failure stays visible", async () => {
  mockRecords.set(STORAGE_KEYS.PROJECTS, JSON.stringify([]));
  const original = seedEstimateMutation({ exhausted: true });

  const { unmount } = renderHook(() => useCloudAutoBackup(props));
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      window.dispatchEvent(new Event("online"));
      document.dispatchEvent(new Event("visibilitychange"));
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  });

  expect(runSupabaseCloudMutationWrite).not.toHaveBeenCalled();
  expect(entriesOf("project")).toEqual([]);
  expect(readCloudMutationLedger().entries).toEqual([expect.objectContaining({
    mutationId: original.mutationId, status: "needs_attention", lastErrorCode: "projects_parent_missing",
  })]);
  expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).failed.mutationId).toBe(original.mutationId);
  unmount();
});
