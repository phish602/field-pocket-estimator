// Gate 17A-R: the tamper capture/restore harness must be byte-exact and must
// fail loudly. These tests encode the exact bug from the prior gate: a hard
// refresh wiped the in-page originals, restore deleted a key that had been
// present, and verification still reported success.

import {
  captureLocalStorageSnapshot,
  restoreLocalStorageSnapshot,
  verifyLocalStorageSnapshot,
  describeSnapshot,
} from "./localStorageSnapshotFixture";

const K_STATE = "estipaid-subscription-plan-state-v1";
const K_CACHE = "estipaid-subscription-plan-remote-cache-v1";
const K_PROFILE = "estipaid-company-profile-v1";
const K_OTHER = "estipaid-invoices-v1";

beforeEach(() => localStorage.clear());

test("absent-key restoration: a key that was absent stays absent", () => {
  localStorage.setItem(K_OTHER, "[]");
  const snap = captureLocalStorageSnapshot([K_STATE], localStorage);
  expect(snap.entries[K_STATE].presence).toBe("__absent__");

  localStorage.setItem(K_STATE, JSON.stringify({ plan: "business", source: "admin" }));
  const result = restoreLocalStorageSnapshot(snap, localStorage);

  expect(result).toEqual(expect.objectContaining({ ok: true, code: "exact" }));
  expect(localStorage.getItem(K_STATE)).toBeNull();
});

test("empty-string restoration is distinct from absence", () => {
  localStorage.setItem(K_STATE, "");
  const snap = captureLocalStorageSnapshot([K_STATE], localStorage);
  expect(snap.entries[K_STATE]).toEqual({ presence: "__present__", raw: "", length: 0 });

  localStorage.setItem(K_STATE, JSON.stringify({ plan: "business" }));
  const result = restoreLocalStorageSnapshot(snap, localStorage);

  expect(result.ok).toBe(true);
  // Present-and-empty, NOT deleted.
  expect(localStorage.getItem(K_STATE)).toBe("");
  expect(localStorage.getItem(K_STATE)).not.toBeNull();
});

test("JSON-value restoration is byte-for-byte", () => {
  const original = JSON.stringify({ plan: "pro", status: "active", source: "local_dev", updatedAt: "2026-07-10T00:00:00.000Z" });
  localStorage.setItem(K_STATE, original);
  const snap = captureLocalStorageSnapshot([K_STATE], localStorage);

  localStorage.setItem(K_STATE, JSON.stringify({ plan: "business", status: "active", source: "admin" }));
  const result = restoreLocalStorageSnapshot(snap, localStorage);

  expect(result.ok).toBe(true);
  expect(localStorage.getItem(K_STATE)).toBe(original);
});

test("THE PRIOR BUG: originals survive a page refresh because the snapshot lives outside window", () => {
  const original = JSON.stringify({ plan: "pro", status: "active", source: "local_dev" });
  localStorage.setItem(K_STATE, original);

  // Capture, then serialize the snapshot the way the caller persists it to /tmp.
  const snap = captureLocalStorageSnapshot([K_STATE], localStorage);
  const persisted = JSON.stringify(snap);

  // Simulate a hard refresh: every in-page variable is gone.
  // (The old harness kept originals on `window` and lost them exactly here.)
  localStorage.setItem(K_STATE, JSON.stringify({ plan: "business", source: "admin" }));

  const revived = JSON.parse(persisted);
  const result = restoreLocalStorageSnapshot(revived, localStorage);

  expect(result.ok).toBe(true);
  expect(localStorage.getItem(K_STATE)).toBe(original);
});

test("false-positive prevention: deleting a present key is reported, never passed", () => {
  localStorage.setItem(K_STATE, JSON.stringify({ plan: "pro", source: "local_dev" }));
  const snap = captureLocalStorageSnapshot([K_STATE], localStorage);

  // The exact prior failure: the key gets removed instead of restored.
  localStorage.removeItem(K_STATE);
  const verdict = verifyLocalStorageSnapshot(snap, localStorage);

  expect(verdict.ok).toBe(false);
  expect(verdict.code).toBe("mismatch");
  expect(verdict.mismatches).toEqual([{ key: K_STATE, reason: "originally_present_now_absent" }]);
});

test("false-positive prevention: a changed value is reported", () => {
  localStorage.setItem(K_STATE, JSON.stringify({ plan: "pro" }));
  const snap = captureLocalStorageSnapshot([K_STATE], localStorage);
  localStorage.setItem(K_STATE, JSON.stringify({ plan: "business" }));

  const verdict = verifyLocalStorageSnapshot(snap, localStorage);
  expect(verdict.ok).toBe(false);
  expect(verdict.mismatches[0]).toEqual(expect.objectContaining({ key: K_STATE, reason: "raw_value_differs" }));
});

test("unrelated-key preservation: business data changes are detected", () => {
  localStorage.setItem(K_OTHER, JSON.stringify([{ id: "inv-1" }]));
  localStorage.setItem(K_PROFILE, JSON.stringify({ companyName: "X" }));
  const snap = captureLocalStorageSnapshot([K_STATE], localStorage);

  // Restoring the tracked key must not disturb anything else...
  expect(restoreLocalStorageSnapshot(snap, localStorage).ok).toBe(true);

  // ...and a change to an untracked key is caught.
  localStorage.setItem(K_OTHER, JSON.stringify([{ id: "inv-1" }, { id: "inv-2" }]));
  const verdict = verifyLocalStorageSnapshot(snap, localStorage);
  expect(verdict.ok).toBe(false);
  expect(verdict.mismatches).toEqual(expect.arrayContaining([expect.objectContaining({ key: K_OTHER, reason: "unrelated_key_changed" })]));
});

test("unrelated-key preservation: deletion and addition are both detected", () => {
  localStorage.setItem(K_OTHER, "[]");
  const snap = captureLocalStorageSnapshot([K_STATE], localStorage);

  localStorage.removeItem(K_OTHER);
  expect(verifyLocalStorageSnapshot(snap, localStorage).mismatches)
    .toEqual(expect.arrayContaining([expect.objectContaining({ key: K_OTHER, reason: "unrelated_key_deleted" })]));

  localStorage.setItem(K_OTHER, "[]");
  localStorage.setItem("estipaid-new-key", "x");
  expect(verifyLocalStorageSnapshot(snap, localStorage).mismatches)
    .toEqual(expect.arrayContaining([expect.objectContaining({ key: "estipaid-new-key", reason: "unrelated_key_added" })]));
});

test("multiple keys with mixed presence restore correctly together", () => {
  const profile = JSON.stringify({ companyName: "BVW", logoDataUrl: "data:image/png;base64,AAAA" });
  localStorage.setItem(K_PROFILE, profile);
  localStorage.setItem(K_CACHE, "");
  // K_STATE deliberately absent.
  const snap = captureLocalStorageSnapshot([K_STATE, K_CACHE, K_PROFILE], localStorage);

  localStorage.setItem(K_STATE, JSON.stringify({ plan: "business" }));
  localStorage.setItem(K_CACHE, JSON.stringify({ plan: "business" }));
  localStorage.setItem(K_PROFILE, JSON.stringify({ companyName: "BVW", plan: "business" }));

  const result = restoreLocalStorageSnapshot(snap, localStorage);
  expect(result).toEqual(expect.objectContaining({ ok: true, code: "exact" }));
  expect(localStorage.getItem(K_STATE)).toBeNull();
  expect(localStorage.getItem(K_CACHE)).toBe("");
  expect(localStorage.getItem(K_PROFILE)).toBe(profile);
});

test("an invalid snapshot fails loudly rather than silently passing", () => {
  expect(restoreLocalStorageSnapshot(null, localStorage)).toEqual(expect.objectContaining({ ok: false, code: "invalid_snapshot" }));
  expect(verifyLocalStorageSnapshot({}, localStorage)).toEqual(expect.objectContaining({ ok: false, code: "invalid_snapshot" }));
});

test("describeSnapshot reports shape without leaking values", () => {
  localStorage.setItem(K_PROFILE, JSON.stringify({ companyName: "BVW Contracting Solutions", logoDataUrl: "data:image/png;base64,SECRET" }));
  const snap = captureLocalStorageSnapshot([K_PROFILE], localStorage);
  const described = describeSnapshot(snap);
  const serialized = JSON.stringify(described);
  expect(serialized).not.toContain("SECRET");
  expect(serialized).not.toContain("BVW");
  expect(described.keys[0]).toEqual(expect.objectContaining({ key: K_PROFILE, presence: "present" }));
});
