import {
  HARNESS_CONTROL_PREFIX,
  canonicalizeIndexedDbValue,
  compareIndexedDbContentIntegrity,
  LOCAL_STORAGE_CATEGORIES,
  categorizeDatabaseName,
  categorizePhysicalKey,
  compareCategories,
  describeValue,
  digestBytes,
  snapshotIndexedDbNames,
  snapshotLocalStorage,
  utf8Bytes,
} from "./integritySnapshot";
import { buildAccountWorkspaceNamespace } from "../accountScopedLocalStorage";

const ACTIVE_NAMESPACE = buildAccountWorkspaceNamespace({
  userId: "00000000-0000-4000-8000-000000000001",
  companyId: "00000000-0000-4000-8000-0000000000a1",
});
const FOREIGN_NAMESPACE = buildAccountWorkspaceNamespace({
  userId: "00000000-0000-4000-8000-000000000002",
  companyId: "00000000-0000-4000-8000-0000000000a2",
});

beforeAll(() => {
  if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto;
});

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
}

test("every physical key lands in exactly one integrity category", () => {
  const cases = [
    [`${ACTIVE_NAMESPACE}:estipaid-customers-v1`, "active-scoped"],
    [`${FOREIGN_NAMESPACE}:estipaid-customers-v1`, "foreign-scoped"],
    [`${ACTIVE_NAMESPACE}:estipaid-workspace-marker-v1`, "workspace-marker"],
    [`${FOREIGN_NAMESPACE}:estipaid-workspace-marker-v1`, "workspace-marker"],
    ["estipaid-customers-v1", "legacy-bare-estipaid"],
    ["field-pocket-customers-v1", "quarantined-field-pocket"],
    ["field-pocket-anything-else", "quarantined-field-pocket"],
    ["estipaid-lang", "device-global"],
    ["estipaid-device-id-v1", "device-global"],
    ["estipaid-vault-guard-v1", "vault-guard"],
    ["sb-synthetic-local-auth-token", "auth-shaped"],
    ["sb-synthetic-local-auth-token.0", "auth-shaped"],
    ["synthetic-third-party-preference", "unrelated"],
    [`${HARNESS_CONTROL_PREFIX}crash-marker`, "harness-control"],
  ];
  cases.forEach(([key, expected]) => {
    const category = categorizePhysicalKey(key, { activeNamespace: ACTIVE_NAMESPACE });
    expect(category).toBe(expected);
    expect(LOCAL_STORAGE_CATEGORIES).toContain(category);
  });
});

test("database names are categorised without exposing the workspace tag", () => {
  const activeVaultDatabaseName = `estipaid-vault-v1-${"A".repeat(43)}`;
  expect(categorizeDatabaseName(activeVaultDatabaseName, { activeVaultDatabaseName })).toBe("active-workspace-vault");
  expect(categorizeDatabaseName(`estipaid-vault-v1-${"B".repeat(43)}`, { activeVaultDatabaseName })).toBe("other-workspace-vault");
  expect(categorizeDatabaseName("estipaid-vault-control-v1", { activeVaultDatabaseName })).toBe("transition-control");
  expect(categorizeDatabaseName("synthetic-unrelated-store-v1", { activeVaultDatabaseName })).toBe("unrelated");
});

test("a described value reveals only presence, byte length, and digest", async () => {
  const described = await describeValue('{"secret":"do-not-leak"}');
  expect(Object.keys(described).sort()).toEqual(["byteLength", "digest", "present"]);
  expect(described.present).toBe(true);
  expect(described.byteLength).toBe(24);
  expect(JSON.stringify(described)).not.toContain("do-not-leak");
  expect(await describeValue(null)).toEqual({ present: false, byteLength: null, digest: null });
});

test("present-empty and absent are distinguishable", async () => {
  const empty = await describeValue("");
  const absent = await describeValue(null);
  expect(empty.present).toBe(true);
  expect(empty.byteLength).toBe(0);
  expect(absent.present).toBe(false);
  expect(empty.digest).not.toBe(absent.digest);
});

test("multibyte, combining, and supplementary-plane values report exact UTF-8 byte counts", async () => {
  expect((await describeValue("ñ")).byteLength).toBe(2);
  expect((await describeValue("é")).byteLength).toBe(3);
  expect((await describeValue("🧰")).byteLength).toBe(4);
  expect((await describeValue("𠜎")).byteLength).toBe(4);
});

test("a snapshot emits no plaintext, no namespace, and no third-party key name", async () => {
  const storage = memoryStorage({
    [`${ACTIVE_NAMESPACE}:estipaid-customers-v1`]: '{"name":"synthetic-private-value"}',
    [`${FOREIGN_NAMESPACE}:estipaid-customers-v1`]: '{"name":"synthetic-foreign-value"}',
    "synthetic-third-party-preference": "synthetic-unrelated-value",
    "estipaid-lang": "es",
  });
  const snapshot = await snapshotLocalStorage({ storage, activeNamespace: ACTIVE_NAMESPACE });
  const serialized = JSON.stringify(snapshot);
  expect(serialized).not.toContain("synthetic-private-value");
  expect(serialized).not.toContain("synthetic-foreign-value");
  expect(serialized).not.toContain("synthetic-unrelated-value");
  expect(serialized).not.toContain(ACTIVE_NAMESPACE);
  expect(serialized).not.toContain(FOREIGN_NAMESPACE);
  expect(serialized).not.toContain("synthetic-third-party-preference");
  expect(snapshot.categories["active-scoped"].keyCount).toBe(1);
  expect(snapshot.categories["foreign-scoped"].keyCount).toBe(1);
  expect(snapshot.categories["device-global"].keyCount).toBe(1);
  expect(snapshot.categories.unrelated.keyCount).toBe(1);
  // The approved logical key name is public source vocabulary and is retained
  // so the storage-boundary matrix can be proven.
  expect(serialized).toContain("estipaid-customers-v1");
});

test("re-activating a workspace disturbs only the marker category", async () => {
  const business = { [`${ACTIVE_NAMESPACE}:estipaid-customers-v1`]: '{"note":"synthetic"}' };
  const before = await snapshotLocalStorage({
    storage: memoryStorage({ ...business, [`${ACTIVE_NAMESPACE}:estipaid-workspace-marker-v1`]: '{"boundAt":"2026-08-01T00:00:00.000Z"}' }),
    activeNamespace: ACTIVE_NAMESPACE,
  });
  const after = await snapshotLocalStorage({
    storage: memoryStorage({ ...business, [`${ACTIVE_NAMESPACE}:estipaid-workspace-marker-v1`]: '{"boundAt":"2026-08-01T12:34:56.000Z"}' }),
    activeNamespace: ACTIVE_NAMESPACE,
  });
  expect(compareCategories(before, after, ["active-scoped"]).allIdentical).toBe(true);
  expect(compareCategories(before, after, ["workspace-marker"]).allIdentical).toBe(false);
});

test("a foreign namespace is folded per logical key without revealing the namespace", async () => {
  const before = await snapshotLocalStorage({
    storage: memoryStorage({ [`${FOREIGN_NAMESPACE}:estipaid-customers-v1`]: '{"note":"a"}' }),
    activeNamespace: ACTIVE_NAMESPACE,
  });
  const changed = await snapshotLocalStorage({
    storage: memoryStorage({ [`${FOREIGN_NAMESPACE}:estipaid-customers-v1`]: '{"note":"b"}' }),
    activeNamespace: ACTIVE_NAMESPACE,
  });
  expect(before.entries["foreign-scoped"][0].slot).toBe("foreign:estipaid-customers-v1");
  expect(JSON.stringify(before)).not.toContain(FOREIGN_NAMESPACE);
  expect(compareCategories(before, changed, ["foreign-scoped"]).allIdentical).toBe(false);
});

test("the compatibility guard is tracked apart from the preserved device-global keys", async () => {
  const withoutGuard = await snapshotLocalStorage({
    storage: memoryStorage({ "estipaid-lang": "es", "estipaid-device-id-v1": "synthetic" }),
    activeNamespace: ACTIVE_NAMESPACE,
  });
  const withGuard = await snapshotLocalStorage({
    storage: memoryStorage({
      "estipaid-lang": "es",
      "estipaid-device-id-v1": "synthetic",
      "estipaid-vault-guard-v1": '{"version":1,"state":"authoritative"}',
    }),
    activeNamespace: ACTIVE_NAMESPACE,
  });
  // Writing the guard must never disturb the device language or device id.
  expect(compareCategories(withoutGuard, withGuard, ["device-global"]).allIdentical).toBe(true);
  expect(withoutGuard.categories["vault-guard"].keyCount).toBe(0);
  expect(withGuard.categories["vault-guard"].keyCount).toBe(1);
});

test("category digests change when any byte changes and are insertion-order independent", async () => {
  const first = await snapshotLocalStorage({ storage: memoryStorage({ a: "1", b: "2" }), activeNamespace: ACTIVE_NAMESPACE });
  const reordered = await snapshotLocalStorage({ storage: memoryStorage({ b: "2", a: "1" }), activeNamespace: ACTIVE_NAMESPACE });
  const altered = await snapshotLocalStorage({ storage: memoryStorage({ a: "1", b: "3" }), activeNamespace: ACTIVE_NAMESPACE });
  expect(first.categories.unrelated.digest).toBe(reordered.categories.unrelated.digest);
  expect(first.categories.unrelated.digest).not.toBe(altered.categories.unrelated.digest);
});

test("compareCategories reports a mismatch when a preserved category is mutated", async () => {
  const baseline = await snapshotLocalStorage({ storage: memoryStorage({ "estipaid-lang": "es" }), activeNamespace: ACTIVE_NAMESPACE });
  const same = await snapshotLocalStorage({ storage: memoryStorage({ "estipaid-lang": "es" }), activeNamespace: ACTIVE_NAMESPACE });
  const changed = await snapshotLocalStorage({ storage: memoryStorage({ "estipaid-lang": "en" }), activeNamespace: ACTIVE_NAMESPACE });
  expect(compareCategories(baseline, same, ["device-global"]).allIdentical).toBe(true);
  const verdict = compareCategories(baseline, changed, ["device-global"]);
  expect(verdict.allIdentical).toBe(false);
  expect(verdict.findings[0].digestMatches).toBe(false);
});

test("digests are stable base64url over the exact UTF-8 bytes", async () => {
  const digest = await digestBytes(utf8Bytes("estipaid"));
  expect(digest).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(await digestBytes(utf8Bytes("estipaid"))).toBe(digest);
});

test("indexed database names are counted by category only", async () => {
  const activeVaultDatabaseName = `estipaid-vault-v1-${"A".repeat(43)}`;
  const summary = await snapshotIndexedDbNames({
    indexedDb: { databases: async () => ([
      { name: activeVaultDatabaseName },
      { name: `estipaid-vault-v1-${"B".repeat(43)}` },
      { name: "estipaid-vault-control-v1" },
      { name: "synthetic-unrelated-store-v1" },
    ]) },
    activeVaultDatabaseName,
  });
  expect(summary.databaseCount).toBe(4);
  expect(summary.categories["active-workspace-vault"]).toBe(1);
  expect(summary.categories["other-workspace-vault"]).toBe(1);
  expect(summary.categories["transition-control"]).toBe(1);
  expect(JSON.stringify(summary)).not.toContain("A".repeat(43));
});

const bytesOf = (value) => Array.from(canonicalizeIndexedDbValue(value));

test("canonical IndexedDB encoding distinguishes every supported value type", () => {
  // A value's TYPE is part of its canonical bytes, so look-alike values across
  // types can never collide.
  const distinct = [
    null, "1", 1, true, false, "true",
    new Uint8Array([1, 2, 3]),
    new Uint8Array([1, 2, 3]).buffer,
    new Int8Array([1, 2, 3]),
    new DataView(new Uint8Array([1, 2, 3]).buffer),
    new Date(1767225600000),
    1767225600000,
    [1, 2],
    { a: 1 },
  ];
  const encoded = distinct.map((value) => JSON.stringify(bytesOf(value)));
  expect(new Set(encoded).size).toBe(distinct.length);
});

test("canonical IndexedDB encoding is deterministic and byte exact", () => {
  expect(bytesOf({ a: 1, b: [2, 3] })).toEqual(bytesOf({ a: 1, b: [2, 3] }));
  // Plain-object key order is not meaningful and must be normalised.
  expect(bytesOf({ a: 1, b: 2 })).toEqual(bytesOf({ b: 2, a: 1 }));
  // Array order IS meaningful and must be preserved.
  expect(bytesOf([1, 2])).not.toEqual(bytesOf([2, 1]));
  // Byte order inside binary values is preserved.
  expect(bytesOf(new Uint8Array([1, 2]))).not.toEqual(bytesOf(new Uint8Array([2, 1])));
  // Length framing prevents concatenation ambiguity.
  expect(bytesOf(["a", "bc"])).not.toEqual(bytesOf(["ab", "c"]));
  expect(bytesOf({ ab: "c" })).not.toEqual(bytesOf({ a: "bc" }));
});

test("negative zero stays distinct from zero", () => {
  expect(bytesOf(-0)).not.toEqual(bytesOf(0));
  expect(bytesOf(-0)).toEqual(bytesOf(-0));
});

test("valid IndexedDB primary key shapes all canonicalize", () => {
  const keys = [42, "estipaid", new Date(0), new Uint8Array([9, 9]), [1, "a", new Date(5)]];
  keys.forEach((key) => expect(canonicalizeIndexedDbValue(key)).toBeInstanceOf(Uint8Array));
  expect(bytesOf(new Date(0))).not.toEqual(bytesOf(0));
});

test("unsupported, non-finite, symbol-bearing, and cyclic values fail closed", () => {
  // Never silently converted to a generic string: an unmodelled value must
  // raise, or two different database states could digest identically.
  [undefined, () => {}, Symbol("s"), new Map(), new Set(), /re/, Object.create(null), new Error("x")]
    .forEach((value) => expect(() => canonicalizeIndexedDbValue(value)).toThrow("UNSUPPORTED_INDEXEDDB_VALUE"));

  [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]
    .forEach((value) => expect(() => canonicalizeIndexedDbValue(value)).toThrow("UNSUPPORTED_INDEXEDDB_VALUE"));

  expect(() => canonicalizeIndexedDbValue(new Date(Number.NaN))).toThrow("UNSUPPORTED_INDEXEDDB_VALUE");

  // A symbol-keyed property is invisible to Object.keys, so digesting it would
  // silently ignore real state.
  const symbolBearing = { a: 1 };
  symbolBearing[Symbol("hidden")] = 2;
  expect(() => canonicalizeIndexedDbValue(symbolBearing)).toThrow("UNSUPPORTED_INDEXEDDB_VALUE");

  const cyclicObject = { a: 1 };
  cyclicObject.self = cyclicObject;
  expect(() => canonicalizeIndexedDbValue(cyclicObject)).toThrow("CYCLIC_INDEXEDDB_VALUE");
  const cyclicArray = [1];
  cyclicArray.push(cyclicArray);
  expect(() => canonicalizeIndexedDbValue(cyclicArray)).toThrow("CYCLIC_INDEXEDDB_VALUE");

  // The same object appearing twice without a cycle is legal.
  const shared = { a: 1 };
  expect(() => canonicalizeIndexedDbValue([shared, shared])).not.toThrow();
});

test("preserved IndexedDB comparison requires matching stores records bytes and digest", () => {
  const before = { entries: [{ category: "foreign-workspace-vault", objectStoreCount: 3, recordCount: 4, canonicalByteLength: 99, digest: "a" }] };
  const same = { entries: [{ category: "foreign-workspace-vault", objectStoreCount: 3, recordCount: 4, canonicalByteLength: 99, digest: "a" }] };
  const changed = { entries: [{ category: "foreign-workspace-vault", objectStoreCount: 3, recordCount: 4, canonicalByteLength: 100, digest: "b" }] };
  const sameDigestFewerRecords = { entries: [{ category: "foreign-workspace-vault", objectStoreCount: 3, recordCount: 3, canonicalByteLength: 99, digest: "a" }] };
  expect(compareIndexedDbContentIntegrity(before, same).allIdentical).toBe(true);
  expect(compareIndexedDbContentIntegrity(before, changed).allIdentical).toBe(false);
  expect(compareIndexedDbContentIntegrity(before, sameDigestFewerRecords).allIdentical).toBe(false);
});

test("an uncaptured IndexedDB comparison is never vacuously identical", () => {
  // A caller that forgets to capture content integrity must FAIL the assertion,
  // not silently pass it.
  const populated = { entries: [{ category: "foreign-workspace-vault", objectStoreCount: 1, recordCount: 1, canonicalByteLength: 1, digest: "a" }] };
  [[undefined, undefined], [{ entries: [] }, { entries: [] }], [populated, { entries: [] }], [{ entries: [] }, populated]]
    .forEach(([before, after]) => {
      const verdict = compareIndexedDbContentIntegrity(before, after);
      expect(verdict.allIdentical).toBe(false);
      expect(verdict.captured).toBe(false);
      expect(verdict.reason).toBe("INDEXEDDB_CONTENT_NOT_CAPTURED");
    });
  expect(compareIndexedDbContentIntegrity(populated, populated).captured).toBe(true);
});

test("a missing category on either side is not identical", () => {
  const before = { entries: [
    { category: "foreign-workspace-vault", objectStoreCount: 1, recordCount: 1, canonicalByteLength: 1, digest: "a" },
    { category: "third-workspace-vault", objectStoreCount: 1, recordCount: 1, canonicalByteLength: 1, digest: "b" },
  ] };
  const after = { entries: [{ category: "foreign-workspace-vault", objectStoreCount: 1, recordCount: 1, canonicalByteLength: 1, digest: "a" }] };
  expect(compareIndexedDbContentIntegrity(before, after).allIdentical).toBe(false);
});
