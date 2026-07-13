import {
  buildCloudSyncBaseline,
  cloudSyncEqual,
  normalizeCloudSyncValue,
  readCloudSyncBaseline,
  writeCloudSyncBaseline,
} from "./cloudSyncBaseline";
import { STORAGE_KEYS } from "../constants/storageKeys";

beforeEach(() => localStorage.clear());

test("normalizes numeric, timestamp, and object-key equivalents without trusting ordering", () => {
  expect(cloudSyncEqual({ total: "10.00", metadata: { b: 2, a: 1 } }, { metadata: { a: 1, b: 2 }, total: 10 })).toBe(true);
  expect(normalizeCloudSyncValue("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00.000Z");
});

test("writes and reads a company-scoped versioned baseline", () => {
  const baseline = buildCloudSyncBaseline({ companyId: "company-a", localSnapshot: { customers: [{ id: "c1" }] }, cloudSnapshot: { customers: [{ id: "c1" }] } });
  expect(writeCloudSyncBaseline(baseline, localStorage)).toBe(true);
  expect(readCloudSyncBaseline("company-a", localStorage)).toEqual(expect.objectContaining({ companyId: "company-a", snapshots: expect.any(Object) }));
  expect(readCloudSyncBaseline("company-b", localStorage)).toBeNull();
  expect(localStorage.getItem(STORAGE_KEYS.CLOUD_SYNC_BASELINE)).toContain("company-a");
});
