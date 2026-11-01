import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  buildCollectionCloudMutationPlan,
  buildImmutableAppRestoreBundleMutation,
  commitAppRestoreBundleBusinessMutation,
  commitStoredCustomerCollectionMutation,
  commitStoredProjectCollectionMutation,
} from "./businessCloudMutationOwners";
import { markCloudBackupDirty, readCloudBackupQueueState } from "./cloudBackupQueue";
import { readCloudMutationLedger } from "./cloudMutationLedger";
import { runtimeCommitAtomicRecords } from "./vaultRuntimeStore";

jest.mock("./vaultRuntimeStore", () => ({ runtimeCommitAtomicRecords: jest.fn() }));

beforeEach(() => {
  localStorage.clear();
  runtimeCommitAtomicRecords.mockReset();
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
});

test("customer create commits local post-state and one exact mutation without advancing the global queue", async () => {
  markCloudBackupDirty({ reason: "preexisting_compatibility_evidence" });
  const queueRevision = readCloudBackupQueueState().localMutationRevision;
  const customer = { id: "customer-1", name: "Martinez" };

  const result = await commitStoredCustomerCollectionMutation({
    previousCustomers: [], nextCustomers: [customer], event: { companyId: "company-1" },
  });

  expect(result).toEqual(expect.objectContaining({ ok: true, ledgerBacked: true, skipGlobalQueue: true }));
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toEqual([customer]);
  expect(readCloudMutationLedger().entries).toEqual([
    expect.objectContaining({ companyId: "company-1", entityType: "customer", documentId: "customer-1", operation: "upsert", payload: customer }),
  ]);
  expect(readCloudBackupQueueState().localMutationRevision).toBe(queueRevision);
});

test("customer and project collection diffs emit one exact tombstone per removed parent", () => {
  const customerPlan = buildCollectionCloudMutationPlan({
    previous: [{ id: "customer-delete" }], next: [], entityType: "customer", companyId: "company-1",
  });
  const projectPlan = buildCollectionCloudMutationPlan({
    previous: [{ id: "project-delete" }], next: [], entityType: "project", companyId: "company-1",
  });
  expect(customerPlan.mutations).toEqual([
    expect.objectContaining({ entityType: "customer", documentId: "customer-delete", operation: "delete", payload: { id: "customer-delete", legacyLocalId: "customer-delete" } }),
  ]);
  expect(projectPlan.mutations).toEqual([
    expect.objectContaining({ entityType: "project", documentId: "project-delete", operation: "delete", payload: { id: "project-delete", legacyLocalId: "project-delete" } }),
  ]);
});

test("project edit commits through the same atomic ledger owner and leaves unrelated queue evidence unchanged", async () => {
  markCloudBackupDirty({ reason: "legacy_project_evidence" });
  const beforeQueue = readCloudBackupQueueState();
  const previous = [{ id: "project-1", name: "Before", customerId: "customer-1" }];
  const next = [{ id: "project-1", name: "After", customerId: "customer-1" }];
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify(previous));

  await commitStoredProjectCollectionMutation({ previousProjects: previous, nextProjects: next, event: { companyId: "company-1" } });

  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS))).toEqual(next);
  expect(readCloudMutationLedger().entries).toEqual([
    expect.objectContaining({ entityType: "project", documentId: "project-1", operation: "upsert", payload: next[0] }),
  ]);
  expect(readCloudBackupQueueState()).toEqual(beforeQueue);
});

test("app bundle mutation captures the exact accepted staged state and never rereads a newer local value", async () => {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ companyName: "Before" }));
  localStorage.setItem(STORAGE_KEYS.SETTINGS, JSON.stringify({ language: "en" }));
  localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, "[]");
  const staged = [{ key: STORAGE_KEYS.COMPANY_PROFILE, value: JSON.stringify({ companyName: "Accepted" }) }];
  const captured = buildImmutableAppRestoreBundleMutation({ writes: staged, companyId: "company-1" });
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ companyName: "Newer" }));
  expect(captured.payload.bundle.companyProfile).toEqual({ companyName: "Accepted" });

  await commitAppRestoreBundleBusinessMutation({ writes: staged, event: { companyId: "company-1" } });
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE))).toEqual({ companyName: "Accepted" });
  expect(readCloudMutationLedger().entries).toEqual([
    expect.objectContaining({
      entityType: "app_restore_bundle", operation: "upsert",
      payload: expect.objectContaining({ bundle: expect.objectContaining({ companyProfile: { companyName: "Accepted" } }) }),
    }),
  ]);
  expect(localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)).toBeNull();
});
