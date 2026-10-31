import { commitAtomicCloudQueuedBusinessMutation, readCloudBackupQueueState } from "./cloudBackupQueue";
import { CLOUD_MUTATION_ENTITY, CLOUD_MUTATION_OPERATION, readCloudMutationLedger } from "./cloudMutationLedger";
import { runtimeCommitAtomicRecords } from "./vaultRuntimeStore";
import { STORAGE_KEYS } from "../constants/storageKeys";

jest.mock("./vaultRuntimeStore", () => ({
  runtimeCommitAtomicRecords: jest.fn(),
}));

beforeEach(() => {
  localStorage.clear();
  runtimeCommitAtomicRecords.mockReset();
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
});

test("one vault transaction contains invoice post-state plus ledger and no global queue revision", async () => {
  const invoices = [{ id: "inv-atomic", payments: [{ id: "pay-1", amount: 25 }] }];
  await commitAtomicCloudQueuedBusinessMutation({
    writes: [{ key: STORAGE_KEYS.INVOICES, value: JSON.stringify(invoices) }],
    ledgerMutations: [{
      companyId: "company-1",
      entityType: CLOUD_MUTATION_ENTITY.INVOICE,
      operation: CLOUD_MUTATION_OPERATION.UPSERT,
      documentId: "inv-atomic",
      payload: invoices[0],
    }],
  });
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(1);
  const keys = runtimeCommitAtomicRecords.mock.calls[0][0].map((record) => record.logicalKey);
  expect(keys).toEqual(expect.arrayContaining([STORAGE_KEYS.INVOICES, STORAGE_KEYS.CLOUD_MUTATION_LEDGER]));
  expect(keys).not.toContain(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
  expect(readCloudBackupQueueState().localMutationRevision).toBe(0);
  expect(readCloudMutationLedger().entries[0].payload).toEqual(invoices[0]);
});

test("non-ledger callers retain the legacy global queue transaction", async () => {
  await commitAtomicCloudQueuedBusinessMutation({
    writes: [{ key: STORAGE_KEYS.PROJECTS, value: "[]" }],
    event: { reason: "project_saved" },
  });
  const keys = runtimeCommitAtomicRecords.mock.calls[0][0].map((record) => record.logicalKey);
  expect(keys).toEqual(expect.arrayContaining([STORAGE_KEYS.PROJECTS, STORAGE_KEYS.CLOUD_BACKUP_QUEUE]));
  expect(readCloudBackupQueueState().pending).toBe(true);
});
