import { STORAGE_KEYS } from "../constants/storageKeys";
import { commitAtomicCloudQueuedBusinessMutation, readCloudBackupQueueState } from "./cloudBackupQueue";
import { readCloudMutationLedger } from "./cloudMutationLedger";
import { runtimeCommitAtomicRecords } from "./vaultRuntimeStore";
import {
  BROWSER_SURFACE_OWNER_KEY,
  claimBrowserSurface,
  startBrowserSurfaceAuthority,
  resetBrowserSurfaceAuthorityForTests,
} from "./browserSurfaceAuthority";

jest.mock("./vaultRuntimeStore", () => ({ runtimeCommitAtomicRecords: jest.fn() }));

const ESTIMATE_WRITE = () => ({
  writes: [{ key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([{ id: "estimate-1", total: 6000 }]) }],
  event: { reason: "estimate_saved", companyId: "company-1", domains: ["estimates"] },
  ledgerMutations: [{
    companyId: "company-1",
    entityType: "estimate",
    documentId: "estimate-1",
    payload: { id: "estimate-1", total: 6000 },
  }],
});

// Exactly what another tab taking over looks like from here: its claim is the
// stored record.
function anotherTabTakesOver() {
  window.localStorage.setItem(BROWSER_SURFACE_OWNER_KEY, JSON.stringify({
    version: 1, surfaceId: "newer-tab", claimToken: "newer-token", claimedAt: Date.now(),
  }));
}

beforeEach(() => {
  window.localStorage.clear();
  runtimeCommitAtomicRecords.mockReset();
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => window.localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
  startBrowserSurfaceAuthority();
  claimBrowserSurface();
});

afterEach(() => {
  resetBrowserSurfaceAuthorityForTests();
  window.localStorage.clear();
});

test("the active browser surface still commits the exact existing atomic business transaction", async () => {
  const result = await commitAtomicCloudQueuedBusinessMutation(ESTIMATE_WRITE());

  expect(result).toEqual(expect.objectContaining({ ok: true, ledgerBacked: true }));
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(1);
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledWith(expect.arrayContaining([
    expect.objectContaining({ logicalKey: STORAGE_KEYS.ESTIMATES }),
    expect.objectContaining({ logicalKey: STORAGE_KEYS.CLOUD_MUTATION_LEDGER }),
  ]));
  const ledger = readCloudMutationLedger();
  expect(ledger.entries).toHaveLength(1);
  expect(ledger.entries[0]).toEqual(expect.objectContaining({
    entityType: "estimate",
    documentId: "estimate-1",
    status: "pending",
  }));
});

// The stale async-handler gap: the React guard passed while this tab was still
// the live surface, and the takeover landed before the save reached the vault.
test("a save that started before a takeover is refused before anything becomes durable", async () => {
  const ledgerBefore = window.localStorage.getItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER);
  const queueBefore = readCloudBackupQueueState();

  anotherTabTakesOver();

  await expect(commitAtomicCloudQueuedBusinessMutation(ESTIMATE_WRITE()))
    .rejects.toMatchObject({ code: "browser_surface_inactive", reason: "estimate_saved" });

  // Nothing durable happened, and nothing pretended to succeed.
  expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(STORAGE_KEYS.ESTIMATES)).toBeNull();
  expect(window.localStorage.getItem(STORAGE_KEYS.CLOUD_MUTATION_LEDGER)).toBe(ledgerBefore);
  expect(readCloudMutationLedger().entries).toHaveLength(0);
  expect(readCloudBackupQueueState().localMutationRevision).toBe(queueBefore.localMutationRevision);
});

test("the global compatibility queue revision cannot advance from a taken-over surface", async () => {
  const queueBefore = readCloudBackupQueueState();
  anotherTabTakesOver();

  await expect(commitAtomicCloudQueuedBusinessMutation({
    writes: [{ key: STORAGE_KEYS.CUSTOMERS, value: JSON.stringify([{ id: "customer-1" }]) }],
    event: { reason: "customer_saved", companyId: "company-1" },
  })).rejects.toMatchObject({ code: "browser_surface_inactive" });

  expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
  expect(window.localStorage.getItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)).toBeNull();
  expect(readCloudBackupQueueState().localMutationRevision).toBe(queueBefore.localMutationRevision);
});

test("taking the tab back restores normal saving with no separate path", async () => {
  anotherTabTakesOver();
  await expect(commitAtomicCloudQueuedBusinessMutation(ESTIMATE_WRITE())).rejects.toMatchObject({
    code: "browser_surface_inactive",
  });

  // The user comes back to this tab.
  claimBrowserSurface();

  await expect(commitAtomicCloudQueuedBusinessMutation(ESTIMATE_WRITE())).resolves.toEqual(
    expect.objectContaining({ ok: true, ledgerBacked: true })
  );
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(1);
});

test("a document that never installed browser authority saves exactly as before", async () => {
  resetBrowserSurfaceAuthorityForTests();

  await expect(commitAtomicCloudQueuedBusinessMutation(ESTIMATE_WRITE())).resolves.toEqual(
    expect.objectContaining({ ok: true })
  );
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(1);
});
