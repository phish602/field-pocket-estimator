import { STORAGE_KEYS } from "../constants/storageKeys";
import { readCloudBackupQueueState } from "./cloudBackupQueue";
import { readCloudMutationLedger } from "./cloudMutationLedger";
import {
  buildEstimateCloudMutationPlan,
  commitStoredEstimateCollectionMutation,
} from "./estimateCloudMutationPlan";
import { runtimeCommitAtomicRecords } from "./vaultRuntimeStore";

jest.mock("./vaultRuntimeStore", () => ({ runtimeCommitAtomicRecords: jest.fn() }));

function estimate(overrides = {}) {
  return {
    id: "estimate-2606",
    docType: "estimate",
    estimateNumber: "EST-2606",
    customerId: "customer-1",
    projectId: "project-1",
    status: "draft",
    total: 5000,
    materials: { items: [{ id: "material-1", desc: "Fixtures", qty: 1, priceEach: 1000 }] },
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  runtimeCommitAtomicRecords.mockReset();
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
});

test("EST-2606-like material edit atomically stores the exact immutable estimate mutation without dirtying the global queue", async () => {
  const before = estimate();
  const after = estimate({
    total: 6000,
    materials: { items: [{ id: "material-1", desc: "Fixtures", qty: 1, priceEach: 2000 }] },
  });
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([before]));
  const queueRevisionBefore = readCloudBackupQueueState().localMutationRevision;

  const result = await commitStoredEstimateCollectionMutation({
    previousEstimates: [before],
    nextEstimates: [after],
    writes: [{ key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([after]) }],
    event: { companyId: "company-1", source: "EstimateForm.saveEstimate" },
  });

  expect(result).toEqual(expect.objectContaining({ ok: true, ledgerBacked: true }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toEqual([after]);
  expect(readCloudBackupQueueState().localMutationRevision).toBe(queueRevisionBefore);
  const entry = readCloudMutationLedger().entries[0];
  expect(entry).toEqual(expect.objectContaining({
    entityType: "estimate",
    documentId: "estimate-2606",
    source: "EstimateForm.saveEstimate",
    payload: after,
    status: "pending",
  }));
  after.materials.items[0].priceEach = 999999;
  expect(readCloudMutationLedger().entries[0].payload.materials.items[0].priceEach).toBe(2000);
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(1);
  expect(runtimeCommitAtomicRecords.mock.calls[0][0].map((record) => record.logicalKey)).toEqual([
    STORAGE_KEYS.ESTIMATES,
    STORAGE_KEYS.CLOUD_MUTATION_LEDGER,
  ]);
});

test("no-op estimate save creates no mutation and performs no durability write", async () => {
  const current = estimate();
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([current]));
  const result = await commitStoredEstimateCollectionMutation({
    previousEstimates: [current],
    nextEstimates: [JSON.parse(JSON.stringify(current))],
    writes: [{ key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([current]) }],
  });
  expect(result).toEqual(expect.objectContaining({ ok: true, noOp: true, mutations: [] }));
  expect(readCloudMutationLedger().entries).toEqual([]);
  expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
});

test("atomic durability failure accepts neither the estimate post-state nor its mutation", async () => {
  const before = estimate();
  const after = estimate({ total: 6000 });
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([before]));
  runtimeCommitAtomicRecords.mockRejectedValueOnce(new Error("durability_failed"));
  await expect(commitStoredEstimateCollectionMutation({
    previousEstimates: [before],
    nextEstimates: [after],
    writes: [{ key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([after]) }],
  })).rejects.toThrow("durability_failed");
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toEqual([before]);
  expect(readCloudMutationLedger().entries).toEqual([]);
});

test.each([
  ["new estimate creation", [], [estimate()], "draft"],
  ["estimate status change", [estimate()], [estimate({ status: "approved" })], "approved"],
])("%s produces one estimate UPSERT mutation", (_label, previous, next, expectedStatus) => {
  const plan = buildEstimateCloudMutationPlan(previous, next, { companyId: "company-1" });
  expect(plan.deletionDetected).toBe(false);
  expect(plan.mutations).toHaveLength(1);
  expect(plan.mutations[0]).toEqual(expect.objectContaining({ entityType: "estimate", documentId: "estimate-2606" }));
  expect(plan.mutations[0].payload.status).toBe(expectedStatus);
});

// The builder creates a brand-new project in the same atomic save as the
// estimate. The estimate writer requires that project's cloud row, so the
// project must be queued too, and ahead of the estimate that references it.
function project(overrides = {}) {
  return {
    id: "project-1",
    customerId: "customer-1",
    projectName: "Recharge HVAC System",
    status: "active",
    scopeSummary: "Recover, evacuate and recharge.",
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  };
}

test("a project created by the estimate save is queued ahead of the estimate that references it", async () => {
  const created = estimate();
  const newProject = project();
  const result = await commitStoredEstimateCollectionMutation({
    previousEstimates: [],
    nextEstimates: [created],
    writes: [
      { key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([created]) },
      { key: STORAGE_KEYS.PROJECTS, value: JSON.stringify([newProject]) },
    ],
    event: { companyId: "company-1", source: "EstimateForm.saveEstimate" },
  });

  expect(result).toEqual(expect.objectContaining({ ok: true, ledgerBacked: true }));
  expect(readCloudMutationLedger().entries.map((entry) => [entry.entityType, entry.documentId, entry.operation])).toEqual([
    ["project", "project-1", "upsert"],
    ["estimate", "estimate-2606", "upsert"],
  ]);
  expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({ companyId: "company-1", payload: newProject }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS))).toEqual([newProject]);
});

test("an estimate save that only advances the project's local activity clock queues no project upsert", async () => {
  const before = estimate();
  const after = estimate({ total: 6000 });
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([before]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([project()]));

  await commitStoredEstimateCollectionMutation({
    previousEstimates: [before],
    nextEstimates: [after],
    writes: [
      { key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([after]) },
      { key: STORAGE_KEYS.PROJECTS, value: JSON.stringify([project({ updatedAt: 2000 })]) },
    ],
    event: { companyId: "company-1" },
  });

  expect(readCloudMutationLedger().entries.map((entry) => entry.entityType)).toEqual(["estimate"]);
});

test("a persisted project change staged with the estimate is queued; an unchanged project save is a no-op", async () => {
  const current = estimate();
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([current]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([project()]));

  await commitStoredEstimateCollectionMutation({
    previousEstimates: [current],
    nextEstimates: [current],
    writes: [
      { key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([current]) },
      { key: STORAGE_KEYS.PROJECTS, value: JSON.stringify([project({ scopeSummary: "Replace the condenser." })]) },
    ],
  });
  expect(readCloudMutationLedger().entries.map((entry) => [entry.entityType, entry.payload.scopeSummary])).toEqual([
    ["project", "Replace the condenser."],
  ]);

  runtimeCommitAtomicRecords.mockClear();
  const repeat = await commitStoredEstimateCollectionMutation({
    previousEstimates: [current],
    nextEstimates: [current],
    writes: [
      { key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([current]) },
      { key: STORAGE_KEYS.PROJECTS, value: localStorage.getItem(STORAGE_KEYS.PROJECTS) },
    ],
  });
  expect(repeat).toEqual(expect.objectContaining({ noOp: true }));
  expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
});

test("estimate deletion appends one exact tombstone without dirtying the global queue", async () => {
  const before = estimate();
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([before]));
  const initialRevision = readCloudBackupQueueState().localMutationRevision;
  await commitStoredEstimateCollectionMutation({
    previousEstimates: [before],
    nextEstimates: [],
    writes: [{ key: STORAGE_KEYS.ESTIMATES, value: "[]" }],
    event: { reason: "estimate_deleted", domains: ["estimates"] },
  });
  expect(readCloudMutationLedger().entries).toEqual([
    expect.objectContaining({
      entityType: "estimate",
      documentId: "estimate-2606",
      operation: "delete",
      payload: { id: "estimate-2606", legacyLocalId: "estimate-2606" },
    }),
  ]);
  expect(readCloudBackupQueueState()).toEqual(expect.objectContaining({ pending: false, localMutationRevision: initialRevision }));
});
