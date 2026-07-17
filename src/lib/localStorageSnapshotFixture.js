// Gate 17A-R: byte-exact localStorage capture/restore for tamper testing.
//
// The prior live tamper test stored originals in `window` variables, then hard-
// refreshed the page. The refresh wiped `window`, so restore fell through to
// removeItem and DELETED a key that had originally been present -- and the
// verification reported success anyway, because it compared
// `localStorage.getItem(k) === (undefined ?? null)`, i.e. null === null.
//
// This module fixes both halves of that bug:
//   1. The snapshot is a plain serializable object the caller must persist
//      OUTSIDE the page lifecycle (a /tmp file, or Claude process state).
//   2. Restoration distinguishes absent / empty-string / value explicitly, and
//      never uses `undefined ?? null` to decide anything.
//
// It touches only the keys it is given, and fails loudly rather than silently.

const ABSENT = "__absent__";
const PRESENT = "__present__";

// Capture the exact state of specific keys. Each entry records presence
// explicitly, so "absent" and "present but empty string" stay distinguishable.
export function captureLocalStorageSnapshot(keys, storage = localStorage) {
  const entries = {};
  (Array.isArray(keys) ? keys : []).forEach((key) => {
    const raw = storage.getItem(key);
    entries[key] = raw === null
      ? { presence: ABSENT, raw: null, length: 0 }
      : { presence: PRESENT, raw, length: raw.length };
  });
  return {
    version: 1,
    capturedAt: new Date().toISOString(),
    // Every other key, recorded by name+length only, so unrelated-key drift is
    // detectable without ever copying customer data around.
    otherKeyFingerprint: fingerprintOtherKeys(keys, storage),
    entries,
  };
}

function fingerprintOtherKeys(keys, storage) {
  const skip = new Set(Array.isArray(keys) ? keys : []);
  const out = {};
  for (let i = 0; i < storage.length; i += 1) {
    const k = storage.key(i);
    if (!k || skip.has(k)) continue;
    // Name + length only: never the value.
    out[k] = (storage.getItem(k) || "").length;
  }
  return out;
}

// Restore exactly: setItem the original raw string when it was present,
// removeItem ONLY when it was genuinely absent.
export function restoreLocalStorageSnapshot(snapshot, storage = localStorage) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.entries) {
    return { ok: false, code: "invalid_snapshot", mismatches: [] };
  }
  Object.entries(snapshot.entries).forEach(([key, entry]) => {
    if (entry?.presence === PRESENT && typeof entry.raw === "string") storage.setItem(key, entry.raw);
    else if (entry?.presence === ABSENT) storage.removeItem(key);
    // An entry with neither marker is not restorable; verify() will flag it.
  });
  return verifyLocalStorageSnapshot(snapshot, storage);
}

// Prove restoration byte-for-byte. Presence and raw value are compared
// explicitly -- never via a nullish default that makes "deleted" look like
// "was already absent".
export function verifyLocalStorageSnapshot(snapshot, storage = localStorage) {
  const mismatches = [];
  if (!snapshot || typeof snapshot !== "object" || !snapshot.entries) {
    return { ok: false, code: "invalid_snapshot", mismatches: [{ key: "(snapshot)", reason: "unusable" }] };
  }

  Object.entries(snapshot.entries).forEach(([key, entry]) => {
    const current = storage.getItem(key);
    const wasPresent = entry?.presence === PRESENT;
    const isPresent = current !== null;
    if (wasPresent !== isPresent) {
      mismatches.push({ key, reason: wasPresent ? "originally_present_now_absent" : "originally_absent_now_present" });
      return;
    }
    // Byte-for-byte, including the empty-string case.
    if (wasPresent && current !== entry.raw) {
      mismatches.push({ key, reason: "raw_value_differs", expectedLength: entry.length, actualLength: current.length });
    }
  });

  // Unrelated keys must be untouched.
  const nowOther = fingerprintOtherKeys(Object.keys(snapshot.entries), storage);
  const before = snapshot.otherKeyFingerprint || {};
  Object.keys(before).forEach((k) => {
    if (!(k in nowOther)) mismatches.push({ key: k, reason: "unrelated_key_deleted" });
    else if (nowOther[k] !== before[k]) mismatches.push({ key: k, reason: "unrelated_key_changed" });
  });
  Object.keys(nowOther).forEach((k) => {
    if (!(k in before)) mismatches.push({ key: k, reason: "unrelated_key_added" });
  });

  return { ok: mismatches.length === 0, code: mismatches.length === 0 ? "exact" : "mismatch", mismatches };
}

// A snapshot is safe to persist outside the page: it holds raw values, so the
// caller must keep it in a restricted location and delete it after use. This
// helper reports only shape, never content.
export function describeSnapshot(snapshot) {
  if (!snapshot?.entries) return { valid: false };
  return {
    valid: true,
    capturedAt: snapshot.capturedAt,
    keys: Object.entries(snapshot.entries).map(([key, e]) => ({
      key,
      presence: e.presence === PRESENT ? "present" : "absent",
      length: e.length,
    })),
    unrelatedKeyCount: Object.keys(snapshot.otherKeyFingerprint || {}).length,
  };
}

export const SNAPSHOT_PRESENCE = { ABSENT, PRESENT };
