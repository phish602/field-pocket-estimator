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

// ---------------------------------------------------------------------------
// Gate 16H: a baseline is a comparison record, never a data source, so inline
// data URLs are stored as content-sensitive digest tokens instead of full
// duplicate copies. Change detection must stay exactly as strict.
// ---------------------------------------------------------------------------
describe("Gate 16H compact data-URL baselines", () => {
  const {
    isCloudSyncOpaqueString, digestCloudSyncOpaqueString, projectCloudSyncBaselineValue,
    normalizeCloudSyncValue, cloudSyncEqual, buildCloudSyncBaseline,
    writeCloudSyncBaselineDetailed, CLOUD_SYNC_BASELINE_KEY,
  } = require("./cloudSyncBaseline");

  const png = (body) => `data:image/png;base64,${body}`;
  const filler = (n, ch = "A") => ch.repeat(n);

  test("only data URLs are treated as opaque", () => {
    expect(isCloudSyncOpaqueString(png("abc"))).toBe(true);
    expect(isCloudSyncOpaqueString("data:application/pdf;base64,xyz")).toBe(true);
    // 12. Ordinary business strings keep their existing behavior.
    ["Acme Roofing", "INV-2001", "Net 30", "a data: url mention", "", "2026-07-10T00:00:00.000Z"]
      .forEach((value) => expect(isCloudSyncOpaqueString(value)).toBe(false));
    expect(normalizeCloudSyncValue("Acme Roofing")).toBe("Acme Roofing");
    expect(normalizeCloudSyncValue("  Acme  ")).toBe("Acme");
    expect(normalizeCloudSyncValue("42")).toBe(42);
    expect(normalizeCloudSyncValue("2026-07-10T00:00:00.000Z")).toBe("2026-07-10T00:00:00.000Z");
  });

  test("1. a raw data URL equals its own compact token", () => {
    const logo = png(filler(5000, "Q"));
    const token = projectCloudSyncBaselineValue(logo);
    expect(cloudSyncEqual(logo, token)).toBe(true);
    // 2/normalization is stable when repeated.
    expect(normalizeCloudSyncValue(normalizeCloudSyncValue(logo))).toEqual(normalizeCloudSyncValue(logo));
    expect(token).toEqual({ __estipaidCloudSyncOpaque: "data-url-v1", length: logo.length, digest: expect.any(String) });
  });

  test("2/3/4. different contents are unequal, including equal-length and same prefix/suffix", () => {
    const a = png(filler(2000, "A"));
    const b = png(filler(2000, "B"));
    expect(a.length).toBe(b.length);
    // 2/3: different contents, same length.
    expect(cloudSyncEqual(a, b)).toBe(false);
    expect(cloudSyncEqual(projectCloudSyncBaselineValue(a), projectCloudSyncBaselineValue(b))).toBe(false);

    // 4: identical prefix AND suffix, different middle, identical length.
    const mid1 = png(`${filler(500, "X")}${filler(20, "M")}${filler(500, "Z")}`);
    const mid2 = png(`${filler(500, "X")}${filler(20, "N")}${filler(500, "Z")}`);
    expect(mid1.length).toBe(mid2.length);
    expect(cloudSyncEqual(mid1, mid2)).toBe(false);

    // A transposition (same character multiset and length) still diverges.
    const t1 = png(`${filler(100, "A")}BC${filler(100, "D")}`);
    const t2 = png(`${filler(100, "A")}CB${filler(100, "D")}`);
    expect(cloudSyncEqual(t1, t2)).toBe(false);

    // A one-character change anywhere diverges.
    const base = filler(4000, "K");
    expect(cloudSyncEqual(png(base), png(`${base.slice(0, 1999)}Z${base.slice(2000)}`))).toBe(false);
  });

  test("the digest is 64 bits, deterministic, and carries no payload", () => {
    const logo = png(filler(3000, "S"));
    const d = digestCloudSyncOpaqueString(logo);
    expect(d).toBe(digestCloudSyncOpaqueString(logo));
    expect(d).toMatch(/^fnv1a64:[0-9a-f]{16}$/);
    expect(d).not.toContain("SSSS");
    expect(projectCloudSyncBaselineValue(logo).digest).toBe(d);
    // Not length-only: same length, different content.
    expect(digestCloudSyncOpaqueString(png(filler(3000, "T")))).not.toBe(d);
  });

  const profile = (logo) => ({ id: "co", companyName: "BVW Contracting Solutions", logoDataUrl: logo });

  test("5/6/7/8. logo change detection on either side survives compaction", () => {
    const base = png(filler(1000, "A"));
    const next = png(filler(1000, "B"));
    const baselineToken = normalizeCloudSyncValue(profile(base));

    // 5. Cloud-only change.
    expect(cloudSyncEqual(baselineToken, profile(next))).toBe(false);
    // 6. Local-only change.
    expect(cloudSyncEqual(profile(next), baselineToken)).toBe(false);
    // 7. Both sides moved to the SAME new image: not a conflict.
    expect(cloudSyncEqual(profile(next), profile(next))).toBe(true);
    // 8. Both sides moved to DIFFERENT images: still a conflict.
    expect(cloudSyncEqual(profile(next), profile(png(filler(1000, "C"))))).toBe(false);
    // Unchanged compares equal.
    expect(cloudSyncEqual(baselineToken, profile(base))).toBe(true);
  });

  test("9/10/11. scope images follow the same rules; layout, id and name changes stay detectable", () => {
    const img = (id, name, url, sortOrder) => ({ id, name, dataUrl: url, sortOrder });
    const a = png(filler(800, "A"));
    const b = png(filler(800, "B"));
    const tpl = (images) => ({ id: "tpl-1", name: "Standard", images });

    const base = tpl([img("i1", "Front", a, 0), img("i2", "Back", b, 1)]);
    const baseToken = normalizeCloudSyncValue(base);

    expect(cloudSyncEqual(baseToken, tpl([img("i1", "Front", a, 0), img("i2", "Back", b, 1)]))).toBe(true);
    // 9. Image content change.
    expect(cloudSyncEqual(baseToken, tpl([img("i1", "Front", b, 0), img("i2", "Back", b, 1)]))).toBe(false);
    // 10. Layout/order change.
    expect(cloudSyncEqual(baseToken, tpl([img("i1", "Front", a, 1), img("i2", "Back", b, 0)]))).toBe(false);
    expect(cloudSyncEqual(baseToken, tpl([img("i2", "Back", b, 1), img("i1", "Front", a, 0)]))).toBe(false);
    // 11. Id and name changes.
    expect(cloudSyncEqual(baseToken, tpl([img("i9", "Front", a, 0), img("i2", "Back", b, 1)]))).toBe(false);
    expect(cloudSyncEqual(baseToken, tpl([img("i1", "Side", a, 0), img("i2", "Back", b, 1)]))).toBe(false);
    // Removing an image is detected.
    expect(cloudSyncEqual(baseToken, tpl([img("i1", "Front", a, 0)]))).toBe(false);
  });

  test("13. an existing full baseline holding raw data URLs stays readable and compares correctly", () => {
    const logo = png(filler(2000, "L"));
    // A pre-Gate-16H baseline: raw data URLs, no snapshotEncoding marker.
    const legacyStored = { companyProfile: profile(logo) };
    expect(legacyStored.companyProfile.logoDataUrl).toBe(logo);
    // It still compares equal to the same unchanged image...
    expect(cloudSyncEqual(legacyStored, { companyProfile: profile(logo) })).toBe(true);
    // ...and unequal to a changed one.
    expect(cloudSyncEqual(legacyStored, { companyProfile: profile(png(filler(2000, "M"))) })).toBe(false);
    // And it compares equal to the compact form of itself.
    expect(cloudSyncEqual(legacyStored, normalizeCloudSyncValue(legacyStored))).toBe(true);
  });

  test("14/newly built baselines are compact and marked", () => {
    const logo = png(filler(200000, "Z"));
    const local = { companyProfile: profile(logo), settings: null, scopeTemplates: [], customers: [], projects: [], estimates: [], invoices: [] };
    const baseline = buildCloudSyncBaseline({ companyId: "c1", queueRevision: 0, localSnapshot: local, cloudSnapshot: local, bindings: null });
    const serialized = JSON.stringify(baseline);
    expect(baseline.snapshotEncoding).toBe("opaque-digest-v1");
    expect(baseline.version).toBe(1); // version compatibility preserved
    expect(serialized).not.toContain("data:image/");
    expect(serialized.length).toBeLessThan(logo.length / 10);
    // 15. The source object is untouched.
    expect(local.companyProfile.logoDataUrl).toBe(logo);
    expect(local.companyProfile.logoDataUrl.length).toBe(200022);
  });

  test("writeCloudSyncBaselineDetailed reports the precise failure reason", () => {
    const baseline = buildCloudSyncBaseline({ companyId: "c1", localSnapshot: {}, cloudSnapshot: {}, bindings: null });

    const ok = writeCloudSyncBaselineDetailed(baseline, localStorage);
    expect(ok).toEqual(expect.objectContaining({ ok: true, serializedLength: expect.any(Number) }));
    expect(ok.estimatedUtf16Bytes).toBe(ok.serializedLength * 2);

    const quota = {
      getItem: () => null,
      setItem: () => { const e = new Error("full"); e.name = "QuotaExceededError"; e.code = 22; throw e; },
    };
    expect(writeCloudSyncBaselineDetailed(baseline, quota)).toEqual(expect.objectContaining({ ok: false, code: "baseline_quota_exceeded", errorName: "QuotaExceededError" }));

    const firefox = {
      getItem: () => null,
      setItem: () => { const e = new Error("full"); e.name = "NS_ERROR_DOM_QUOTA_REACHED"; e.code = 1014; throw e; },
    };
    expect(writeCloudSyncBaselineDetailed(baseline, firefox).code).toBe("baseline_quota_exceeded");

    const broken = { getItem: () => null, setItem: () => { throw new Error("nope"); } };
    expect(writeCloudSyncBaselineDetailed(baseline, broken).code).toBe("baseline_write_failed");

    const silent = { getItem: () => null, setItem: () => {} };
    expect(writeCloudSyncBaselineDetailed(baseline, silent).code).toBe("baseline_readback_mismatch");

    expect(writeCloudSyncBaselineDetailed(baseline, null).code).toBe("baseline_storage_unavailable");

    const cyclic = { ...baseline }; cyclic.self = cyclic;
    expect(writeCloudSyncBaselineDetailed(cyclic, localStorage).code).toBe("baseline_serialization_failed");
  });
});

// ---------------------------------------------------------------------------
// Gate 16H (live): the production device already held a 2,136,696-char legacy
// baseline. That record becomes the rollback journal's `previous` value, so the
// transaction needed two copies of it and could not fit -- the live browser
// reported journal_write_failed on a 4,506,183-char journal. Compacting the
// stored baseline first is information-preserving and reclaims the space.
// ---------------------------------------------------------------------------
describe("Gate 16H stored-baseline compaction", () => {
  const { compactStoredCloudSyncBaseline, buildCloudSyncBaseline, cloudSyncEqual, CLOUD_SYNC_BASELINE_KEY } = require("./cloudSyncBaseline");
  const png = (b) => `data:image/png;base64,${b}`;
  const legacy = (companyId = "c1") => ({
    version: 1, companyId, verifiedAt: "2026-07-10T22:05:23.000Z", queueRevision: 0,
    snapshots: {
      companyProfile: { id: "co", companyName: "BVW", logoDataUrl: png("L".repeat(120000)) },
      scopeTemplates: [{ id: "t1", images: [{ id: "i1", dataUrl: png("S".repeat(40000)), sortOrder: 0 }] }],
      customers: [{ id: "c-1", displayName: "Acme" }], invoices: [{ id: "inv-1", invoiceTotal: 100 }],
    },
    hashes: { local: "fnv1a:0", cloud: "fnv1a:0", bindings: "fnv1a:0" },
  });

  beforeEach(() => localStorage.clear());

  test("rewrites a legacy full baseline compactly without changing what it means", () => {
    const before = JSON.stringify(legacy());
    localStorage.setItem(CLOUD_SYNC_BASELINE_KEY, before);
    expect(before).toContain("data:image/");

    const result = compactStoredCloudSyncBaseline({ storage: localStorage, companyId: "c1" });

    expect(result).toEqual(expect.objectContaining({ ok: true, migrated: true }));
    expect(result.beforeLength).toBe(before.length);
    expect(result.afterLength).toBeLessThan(before.length / 20);

    const after = localStorage.getItem(CLOUD_SYNC_BASELINE_KEY);
    expect(after).not.toContain("data:image/");
    expect(JSON.parse(after).snapshotEncoding).toBe("opaque-digest-v1");
    // The whole point: it still means exactly the same thing.
    expect(cloudSyncEqual(JSON.parse(before).snapshots, JSON.parse(after).snapshots)).toBe(true);
    // Non-image fields are preserved verbatim.
    expect(JSON.parse(after).snapshots.customers).toEqual([{ id: "c-1", displayName: "Acme" }]);
    expect(JSON.parse(after).companyId).toBe("c1");
    expect(JSON.parse(after).verifiedAt).toBe("2026-07-10T22:05:23.000Z");
  });

  test("is idempotent: an already-compact baseline is left alone", () => {
    localStorage.setItem(CLOUD_SYNC_BASELINE_KEY, JSON.stringify(legacy()));
    compactStoredCloudSyncBaseline({ storage: localStorage, companyId: "c1" });
    const once = localStorage.getItem(CLOUD_SYNC_BASELINE_KEY);

    const again = compactStoredCloudSyncBaseline({ storage: localStorage, companyId: "c1" });
    expect(again).toEqual(expect.objectContaining({ ok: true, migrated: false, code: "baseline_already_compact" }));
    expect(localStorage.getItem(CLOUD_SYNC_BASELINE_KEY)).toBe(once);
  });

  test("a freshly built baseline needs no compaction", () => {
    const b = buildCloudSyncBaseline({ companyId: "c1", localSnapshot: { customers: [] }, cloudSnapshot: {}, bindings: null });
    localStorage.setItem(CLOUD_SYNC_BASELINE_KEY, JSON.stringify(b));
    expect(compactStoredCloudSyncBaseline({ storage: localStorage, companyId: "c1" }))
      .toEqual(expect.objectContaining({ ok: true, migrated: false, code: "baseline_already_compact" }));
  });

  test("refuses anything it cannot safely rewrite", () => {
    expect(compactStoredCloudSyncBaseline({ storage: localStorage, companyId: "c1" }))
      .toEqual(expect.objectContaining({ ok: true, migrated: false, code: "baseline_absent" }));

    localStorage.setItem(CLOUD_SYNC_BASELINE_KEY, "{not json");
    expect(compactStoredCloudSyncBaseline({ storage: localStorage, companyId: "c1" }))
      .toEqual(expect.objectContaining({ ok: false, code: "baseline_unreadable" }));
    expect(localStorage.getItem(CLOUD_SYNC_BASELINE_KEY)).toBe("{not json");

    // Another workspace's baseline is never adopted or rewritten.
    const other = JSON.stringify(legacy("other-company"));
    localStorage.setItem(CLOUD_SYNC_BASELINE_KEY, other);
    expect(compactStoredCloudSyncBaseline({ storage: localStorage, companyId: "c1" }))
      .toEqual(expect.objectContaining({ ok: false, code: "baseline_company_mismatch" }));
    expect(localStorage.getItem(CLOUD_SYNC_BASELINE_KEY)).toBe(other);
  });

  test("a quota-full storage leaves the legacy baseline untouched", () => {
    const before = JSON.stringify(legacy());
    const quota = {
      getItem: () => before,
      setItem: () => { const e = new Error("full"); e.name = "QuotaExceededError"; e.code = 22; throw e; },
    };
    expect(compactStoredCloudSyncBaseline({ storage: quota, companyId: "c1" }))
      .toEqual(expect.objectContaining({ ok: false, migrated: false, code: "baseline_quota_exceeded" }));
  });
});
