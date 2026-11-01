/* global globalThis */
// MISSING-PARENT DEPENDENCY RECOVERY.
//
// A dependent mutation (estimate, invoice, project) can fail with
// "<parent>_parent_missing" because its parent never reached the cloud: the
// parent's own mutation was never recorded, was lost, or predates the ledger.
// Waiting for a parent acknowledgement that nothing will ever produce strands
// the dependent forever. The existing recovery owner now queues exactly that
// parent, from the current workspace's own records, through the same durable
// ledger -- and the existing proof rule then retries the untouched dependent.

import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  activateAccountScopedLocalStorage, deactivateAccountScopedLocalStorage,
  installAuthoritativeVaultRuntime, setActiveWorkspaceVaultCompatibility,
} from "./accountScopedLocalStorage";
import { deriveWorkspaceVaultTag } from "./vaultSession";
import {
  acknowledgeCloudMutation, appendCloudMutationRecords, createEmptyCloudMutationLedger,
  enqueueRecoverableMissingParentMutations, getCloudMutationAutomaticRecoveryProof,
  getCloudMutationLedgerSummary, getHistoricalMutationRecoveryContext, readCloudMutationLedger,
  requeueCloudMutationForAutomaticRetry,
} from "./cloudMutationLedger";
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

const USER = "11111111-2222-4333-8444-555555555555";
const COMPANY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const customer = { id: "c_1793513096951_85e9ff5a50ffd", name: "John Doe Test", type: "residential" };
const project = {
  id: "proj_9vzc57", customerId: customer.id, projectName: "Recharge HVAC System", status: "active",
  scopeSummary: "Recover, evacuate and recharge.", createdAt: 1000, updatedAt: 1000,
};
const estimate = {
  id: "doc_mvxfg4xq_zmg7w8", docType: "estimate", estimateNumber: "EST-0001", status: "draft",
  projectId: project.id, customerId: customer.id, total: 1107.5,
};
const invoice = {
  id: "inv_dep_1", docType: "invoice", invoiceNumber: "INV-0001", status: "sent",
  projectId: project.id, customerId: customer.id, invoiceTotal: 1107.5, total: 1107.5, payments: [],
};

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
  expect(activateAccountScopedLocalStorage({ storage: localStorage, userId: USER, companyId: COMPANY }).installed).toBe(true);
  const tag = await deriveWorkspaceVaultTag(USER, COMPANY);
  setActiveWorkspaceVaultCompatibility({ workspaceTag: tag, state: "authoritative", generation: mockGeneration });
  installAuthoritativeVaultRuntime({ workspaceTag: tag, generation: mockGeneration, adapter: {
    isReady: generation => mockReady && generation === mockGeneration,
    getItem: key => mockRecords.get(key) ?? null, setItem: (key, value) => mockRecords.set(key, value),
    removeItem: key => mockRecords.delete(key), clear: () => mockRecords.clear(), keys: () => [...mockRecords.keys()],
  } });
});
afterEach(() => { deactivateAccountScopedLocalStorage(); });

const context = () => getHistoricalMutationRecoveryContext({ userId: USER, companyId: COMPANY });
const ledgerJson = () => mockRecords.get(STORAGE_KEYS.CLOUD_MUTATION_LEDGER);

function seedWorkspace({ customers = [customer], projects = [project], estimates = [estimate] } = {}) {
  mockRecords.set(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));
  mockRecords.set(STORAGE_KEYS.PROJECTS, JSON.stringify(projects));
  mockRecords.set(STORAGE_KEYS.ESTIMATES, JSON.stringify(estimates));
}

// The live Production shape: the save owner records no company on the entry,
// the estimate exhausted its retries on projects_parent_missing, and no project
// mutation exists anywhere in the ledger.
function seedFailure({ entityType = "estimate", payload = estimate, status = "needs_attention",
  errorCode = "projects_parent_missing", companyId = "", extra = [] } = {}) {
  const inputs = [{ companyId, entityType, documentId: payload.id, payload }, ...extra];
  const { ledger } = appendCloudMutationRecords(createEmptyCloudMutationLedger(), inputs, { now: 100 });
  ledger.entries[0] = {
    ...ledger.entries[0], status, retryCount: status === "needs_attention" ? 3 : 1,
    nextRetryAt: status === "retry_wait" ? Date.now() + 60000 : null,
    lastAttemptAt: 2000, lastErrorCode: errorCode, lastError: "Referenced row was not found.",
  };
  mockRecords.set(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));
  return ledger;
}

describe("stranded dependents", () => {
  test("an exhausted estimate queues its missing project from local state and keeps its own evidence", async () => {
    seedWorkspace();
    const before = seedFailure();

    const result = await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });

    expect(result).toEqual(expect.objectContaining({ ok: true }));
    expect(result.appended.map((entry) => [entry.entityType, entry.documentId])).toEqual([["project", project.id]]);
    const after = readCloudMutationLedger();
    expect(after.entries).toHaveLength(2);
    expect(after.entries[1]).toEqual(expect.objectContaining({
      entityType: "project", documentId: project.id, operation: "upsert", status: "pending",
      companyId: COMPANY, payload: project,
    }));
    // The dependent is not discarded, rewritten or retried here.
    const { dependencyRecovery, ...dependentRest } = after.entries[0];
    expect(dependentRest).toEqual(before.entries[0]);
    expect(dependencyRecovery).toEqual(expect.objectContaining({
      parentEntityType: "project", parentDocumentId: project.id, attempts: 1,
      parentMutationId: after.entries[1].mutationId,
    }));
    // The failure stays visible until the dependent itself succeeds.
    expect(getCloudMutationLedgerSummary(after).failed.revision).toBe(1);
    expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(1);
  });

  test("a dependent still waiting to retry queues its parent before its next attempt", async () => {
    seedWorkspace();
    seedFailure({ status: "retry_wait" });

    const result = await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });

    expect(result.appended.map((entry) => entry.entityType)).toEqual(["project"]);
    expect(readCloudMutationLedger().entries[0].status).toBe("retry_wait");
  });

  test("repeated recovery passes never queue a duplicate parent", async () => {
    seedWorkspace();
    seedFailure();
    await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });
    const once = ledgerJson();

    const again = await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });

    expect(again.appended).toEqual([]);
    expect(ledgerJson()).toBe(once);
    expect(readCloudMutationLedger().entries.filter((entry) => entry.entityType === "project")).toHaveLength(1);
  });

  test("two dependents of one missing project queue that project once", async () => {
    seedWorkspace({ estimates: [estimate, { ...estimate, id: "doc_second", estimateNumber: "EST-0002" }] });
    seedFailure({ extra: [{ companyId: "", entityType: "estimate", documentId: "doc_second", payload: { ...estimate, id: "doc_second" } }] });
    const ledger = readCloudMutationLedger();
    ledger.entries[1] = { ...ledger.entries[1], status: "needs_attention", retryCount: 3, lastAttemptAt: 2100, lastErrorCode: "projects_parent_missing" };
    mockRecords.set(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));

    const result = await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });

    expect(result.appended.map((entry) => entry.documentId)).toEqual([project.id]);
    expect(readCloudMutationLedger().entries.slice(0, 2).map((entry) => entry.dependencyRecovery?.parentMutationId))
      .toEqual([result.appended[0].mutationId, result.appended[0].mutationId]);
  });

  test("an invoice missing its project queues the project without touching invoice money", async () => {
    seedWorkspace();
    const before = seedFailure({ entityType: "invoice", payload: invoice });

    const result = await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });

    expect(result.appended.map((entry) => [entry.entityType, entry.documentId])).toEqual([["project", project.id]]);
    expect(readCloudMutationLedger().entries[0].payload).toEqual(before.entries[0].payload);
  });

  test("a project missing its customer queues the customer", async () => {
    seedWorkspace();
    seedFailure({ entityType: "project", payload: project, errorCode: "customers_parent_missing" });

    const result = await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });

    expect(result.appended.map((entry) => [entry.entityType, entry.documentId, entry.payload])).toEqual([["customer", customer.id, customer]]);
  });
});

describe("the dependent resumes through the existing proof rule", () => {
  test.each([["estimate", estimate], ["invoice", invoice]])("a verified recovered project unlocks the exhausted %s exactly once", async (entityType, payload) => {
    seedWorkspace();
    seedFailure({ entityType, payload });
    const recoveryContext = await context();
    const { appended } = await enqueueRecoverableMissingParentMutations({ recoveryContext, companyId: COMPANY });
    expect(getCloudMutationAutomaticRecoveryProof(readCloudMutationLedger().entries[0], readCloudMutationLedger(), recoveryContext)).toBeNull();

    await acknowledgeCloudMutation(appended[0], { verifiedAt: 5000 });
    const ledger = readCloudMutationLedger();
    expect(getCloudMutationAutomaticRecoveryProof(ledger.entries[0], ledger, recoveryContext)).toBeTruthy();

    const requeued = await requeueCloudMutationForAutomaticRetry(ledger.entries[0], { now: Date.now(), recoveryContext });
    expect(requeued.ok).toBe(true);
    expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({
      status: "pending", payload, retryCount: 3, mutationId: ledger.entries[0].mutationId,
    }));
    // The same proof cannot be reused for a second automatic retry.
    const reused = readCloudMutationLedger();
    expect(getCloudMutationAutomaticRecoveryProof({ ...reused.entries[0], status: "needs_attention" }, reused, recoveryContext)).toBeNull();
  });
});

describe("ownership and evidence boundaries", () => {
  test("a project that does not exist locally is never invented; the failure is preserved", async () => {
    seedWorkspace({ projects: [] });
    seedFailure();
    const before = ledgerJson();

    const result = await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });

    expect(result.appended).toEqual([]);
    expect(ledgerJson()).toBe(before);
    expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
  });

  test.each([
    ["the local project names another company", () => seedWorkspace({ projects: [{ ...project, companyId: OTHER }] }), {}],
    ["the dependent belongs to another company", () => seedWorkspace(), { companyId: OTHER }],
    ["the dependent payload names another company", () => seedWorkspace(), { payload: { ...estimate, companyId: OTHER } }],
  ])("no cloud work is queued when %s", async (_label, arrange, failure) => {
    arrange();
    seedFailure(failure);
    const before = ledgerJson();

    const result = await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });

    expect(result.appended).toEqual([]);
    expect(ledgerJson()).toBe(before);
  });

  test.each(["missing", "other_company_session", "not_ready"])("an unverified workspace (%s) queues nothing", async (kind) => {
    seedWorkspace();
    seedFailure();
    const before = ledgerJson();
    let recoveryContext = await context();
    let companyId = COMPANY;
    if (kind === "missing") recoveryContext = null;
    if (kind === "other_company_session") companyId = OTHER;
    if (kind === "not_ready") mockReady = false;

    const result = await enqueueRecoverableMissingParentMutations({ recoveryContext, companyId });

    expect(result.appended).toEqual([]);
    expect(ledgerJson()).toBe(before);
  });

  test("a parent already verified after the failure is left to the proof rule", async () => {
    seedWorkspace();
    seedFailure({ extra: [{ companyId: COMPANY, entityType: "project", documentId: project.id, payload: project }] });
    const ledger = readCloudMutationLedger();
    ledger.entries[1] = { ...ledger.entries[1], status: "acknowledged", verifiedAt: 5000, acknowledgedAt: 5000 };
    mockRecords.set(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));
    const before = ledgerJson();

    const result = await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });

    expect(result.appended).toEqual([]);
    expect(ledgerJson()).toBe(before);
  });

  test("dependency recovery is bounded per dependent", async () => {
    seedWorkspace();
    seedFailure();
    const recoveryContext = await context();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const { appended } = await enqueueRecoverableMissingParentMutations({ recoveryContext, companyId: COMPANY });
      expect(appended).toHaveLength(1);
      // The parent verifies, the dependent retries and fails on the same parent again.
      await acknowledgeCloudMutation(appended[0], { verifiedAt: 5000 * attempt });
      const ledger = readCloudMutationLedger();
      ledger.entries[0] = { ...ledger.entries[0], status: "needs_attention", lastAttemptAt: 5000 * attempt + 1 };
      mockRecords.set(STORAGE_KEYS.CLOUD_MUTATION_LEDGER, JSON.stringify(ledger));
    }
    const before = ledgerJson();

    const third = await enqueueRecoverableMissingParentMutations({ recoveryContext, companyId: COMPANY });

    expect(third.appended).toEqual([]);
    expect(ledgerJson()).toBe(before);
    expect(readCloudMutationLedger().entries[0].dependencyRecovery.attempts).toBe(2);
    expect(getCloudMutationLedgerSummary(readCloudMutationLedger()).failed.revision).toBe(1);
  });

  test("an unrelated failure code never queues a parent", async () => {
    seedWorkspace();
    seedFailure({ errorCode: "estimate_write_failed" });
    const before = ledgerJson();

    const result = await enqueueRecoverableMissingParentMutations({ recoveryContext: await context(), companyId: COMPANY });

    expect(result.appended).toEqual([]);
    expect(ledgerJson()).toBe(before);
  });
});
