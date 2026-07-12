import {
  CLOUD_ASSET_BINDINGS_KEY,
  CLOUD_ASSET_ENTITY_TYPES,
  isValidCloudUuid,
  getDefaultCloudAssetBindings,
  readCloudAssetBindings,
  writeCloudAssetBindings,
  getCloudAssetBinding,
  setCloudAssetBinding,
  setCloudAssetBindingsBatch,
  removeCloudAssetBinding,
  clearCloudAssetBindingsForCompany,
  validateCloudAssetBinding,
  invertCloudAssetBindingsByUuid,
  exportCloudAssetBindingsDiagnosticSummary,
  importCloudAssetBindingsFromArtifact,
  getCloudAssetBindingUuidMap,
} from "./cloudAssetBindings";

const COMPANY = "company_1";
const UUID_A = "11111111-1111-4111-8111-111111111111";
const UUID_B = "22222222-2222-4222-8222-222222222222";

function binding(overrides = {}) {
  return {
    entityType: "customer",
    localLegacyId: "cust_local_1",
    cloudUuid: UUID_A,
    companyId: COMPANY,
    source: "cloud_upsert",
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe("cloudAssetBindings storage", () => {
  test("a valid binding round-trips", () => {
    const result = setCloudAssetBinding(binding());
    expect(result.ok).toBe(true);
    const read = getCloudAssetBinding("customer", "cust_local_1", COMPANY);
    expect(read).toMatchObject({
      entityType: "customer",
      localLegacyId: "cust_local_1",
      cloudUuid: UUID_A,
      companyId: COMPANY,
      source: "cloud_upsert",
    });
    expect(read.boundAt).toEqual(expect.any(Number));
    expect(read.lastConfirmedAt).toEqual(expect.any(Number));
  });

  test("malformed storage fails closed to an empty safe structure", () => {
    localStorage.setItem(CLOUD_ASSET_BINDINGS_KEY, "{not valid json");
    expect(readCloudAssetBindings(COMPANY)).toEqual(getDefaultCloudAssetBindings(COMPANY));
    localStorage.setItem(CLOUD_ASSET_BINDINGS_KEY, JSON.stringify([1, 2, 3]));
    expect(readCloudAssetBindings(COMPANY)).toEqual(getDefaultCloudAssetBindings(COMPANY));
    // A structurally-valid state with a garbage binding drops only the bad row.
    localStorage.setItem(CLOUD_ASSET_BINDINGS_KEY, JSON.stringify({
      version: 1, companyId: COMPANY, updatedAt: 1,
      bindings: { customer: { c1: { cloudUuid: "not-a-uuid", companyId: COMPANY } }, project: {}, estimate: {}, invoice: {}, invoice_payment: {} },
    }));
    expect(readCloudAssetBindings(COMPANY).bindings.customer).toEqual({});
  });

  test("a company mismatch is rejected on read and on write validation", () => {
    setCloudAssetBinding(binding());
    // Reading with a different company returns an empty scope (no leakage).
    expect(readCloudAssetBindings("other_company").bindings.customer).toEqual({});
    // Validating a binding against a mismatched company is rejected.
    expect(validateCloudAssetBinding(binding(), "other_company")).toEqual({ ok: false, reason: "company_mismatch" });
  });

  test("an invalid cloud UUID is rejected", () => {
    expect(isValidCloudUuid("not-a-uuid")).toBe(false);
    expect(isValidCloudUuid(UUID_A)).toBe(true);
    expect(setCloudAssetBinding(binding({ cloudUuid: "not-a-uuid" }))).toEqual({ ok: false, reason: "malformed_binding" });
    expect(setCloudAssetBinding(binding({ cloudUuid: "" }))).toEqual({ ok: false, reason: "malformed_binding" });
  });

  test("an unknown entity type is rejected", () => {
    expect(setCloudAssetBinding(binding({ entityType: "invoice_line_item" }))).toEqual({ ok: false, reason: "malformed_binding" });
    expect(CLOUD_ASSET_ENTITY_TYPES).toEqual(["customer", "project", "estimate", "invoice", "invoice_payment"]);
  });

  test("one local id cannot silently switch to a different cloud UUID", () => {
    expect(setCloudAssetBinding(binding({ cloudUuid: UUID_A })).ok).toBe(true);
    const conflict = setCloudAssetBinding(binding({ cloudUuid: UUID_B }));
    expect(conflict).toEqual({ ok: false, reason: "local_rebind_conflict" });
    // Original binding is preserved.
    expect(getCloudAssetBinding("customer", "cust_local_1", COMPANY).cloudUuid).toBe(UUID_A);
  });

  test("one cloud UUID cannot silently bind two local ids of the same entity", () => {
    expect(setCloudAssetBinding(binding({ localLegacyId: "cust_local_1", cloudUuid: UUID_A })).ok).toBe(true);
    const conflict = setCloudAssetBinding(binding({ localLegacyId: "cust_local_2", cloudUuid: UUID_A }));
    expect(conflict).toEqual({ ok: false, reason: "uuid_reused" });
    expect(getCloudAssetBinding("customer", "cust_local_2", COMPANY)).toBeNull();
  });

  test("an explicit proven reconciliation may replace a stale local-id binding", () => {
    // Old local id was bound to the cloud UUID; the local id drifted.
    expect(setCloudAssetBinding(binding({ localLegacyId: "cust_old", cloudUuid: UUID_A })).ok).toBe(true);
    const rebind = setCloudAssetBinding(binding({ localLegacyId: "cust_new", cloudUuid: UUID_A, source: "cloud_reconciliation" }), { reconciliation: true });
    expect(rebind.ok).toBe(true);
    // The stale binding on that UUID is gone; the new one wins.
    expect(getCloudAssetBinding("customer", "cust_old", COMPANY)).toBeNull();
    expect(getCloudAssetBinding("customer", "cust_new", COMPANY).cloudUuid).toBe(UUID_A);
  });

  test("the sidecar stores no business information (names/totals/notes)", () => {
    setCloudAssetBinding({
      ...binding(),
      // These extra business-ish fields must never be persisted.
      customerName: "Jane Private",
      amount: 999.99,
      notes: "secret note",
    });
    const raw = localStorage.getItem(CLOUD_ASSET_BINDINGS_KEY);
    expect(raw).not.toMatch(/Jane Private/);
    expect(raw).not.toMatch(/999\.99/);
    expect(raw).not.toMatch(/secret note/);
    const stored = getCloudAssetBinding("customer", "cust_local_1", COMPANY);
    expect(Object.keys(stored).sort()).toEqual(
      ["boundAt", "cloudUuid", "companyId", "entityType", "lastConfirmedAt", "localLegacyId", "source"].sort()
    );
  });

  test("batch writes apply guards and report a non-sensitive skip summary", () => {
    const summary = setCloudAssetBindingsBatch(COMPANY, [
      binding({ entityType: "customer", localLegacyId: "c1", cloudUuid: UUID_A }),
      binding({ entityType: "invoice", localLegacyId: "i1", cloudUuid: UUID_B }),
      binding({ entityType: "customer", localLegacyId: "c2", cloudUuid: UUID_A }), // uuid reused -> skipped
      binding({ entityType: "bogus", localLegacyId: "x", cloudUuid: UUID_A }), // bad type -> skipped
    ]);
    expect(summary.written).toBe(2);
    expect(summary.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ localLegacyId: "c2", reason: "uuid_reused" }),
      expect.objectContaining({ reason: "malformed_binding" }),
    ]));
    expect(getCloudAssetBinding("customer", "c1", COMPANY).cloudUuid).toBe(UUID_A);
    expect(getCloudAssetBinding("invoice", "i1", COMPANY).cloudUuid).toBe(UUID_B);
  });

  test("remove, clear, invert, and diagnostics behave", () => {
    setCloudAssetBindingsBatch(COMPANY, [
      binding({ entityType: "customer", localLegacyId: "c1", cloudUuid: UUID_A }),
      binding({ entityType: "invoice", localLegacyId: "i1", cloudUuid: UUID_B }),
    ]);
    expect(exportCloudAssetBindingsDiagnosticSummary(COMPANY)).toMatchObject({
      totalBindings: 2,
      perEntity: expect.objectContaining({ customer: 1, invoice: 1 }),
    });
    const inverted = invertCloudAssetBindingsByUuid(COMPANY);
    expect(inverted[`customer:${UUID_A}`]).toHaveLength(1);
    expect(removeCloudAssetBinding("customer", "c1", COMPANY)).toEqual({ ok: true, removed: true });
    expect(getCloudAssetBinding("customer", "c1", COMPANY)).toBeNull();
    clearCloudAssetBindingsForCompany(COMPANY);
    expect(exportCloudAssetBindingsDiagnosticSummary(COMPANY).totalBindings).toBe(0);
  });

  test("clear never wipes a different company's stored bindings", () => {
    setCloudAssetBinding(binding({ companyId: COMPANY }));
    const result = clearCloudAssetBindingsForCompany("other_company");
    expect(result).toEqual({ ok: true, cleared: false });
    expect(getCloudAssetBinding("customer", "cust_local_1", COMPANY).cloudUuid).toBe(UUID_A);
  });
});

describe("cloudAssetBindings import (This-Device backup restore)", () => {
  function sidecarState(company, entries) {
    // Build a raw sidecar as produced by the export artifact.
    const bindings = {};
    CLOUD_ASSET_ENTITY_TYPES.forEach((t) => { bindings[t] = {}; });
    entries.forEach((e) => {
      bindings[e.entityType][e.localLegacyId] = {
        entityType: e.entityType,
        localLegacyId: e.localLegacyId,
        cloudUuid: e.cloudUuid,
        companyId: company,
        source: e.source || "cloud_restore",
        boundAt: e.boundAt || 1000,
        lastConfirmedAt: e.lastConfirmedAt || 1000,
      };
    });
    return { version: 1, companyId: company, updatedAt: 1000, bindings };
  }

  test("imports valid bindings for the matching company scope, no business writes", () => {
    const artifact = { cloudAssetBindings: sidecarState(COMPANY, [
      { entityType: "customer", localLegacyId: "cust_local_1", cloudUuid: UUID_A },
      { entityType: "invoice", localLegacyId: "inv_local_1", cloudUuid: UUID_B },
    ]) };
    const result = importCloudAssetBindingsFromArtifact(artifact, { companyId: COMPANY });
    expect(result).toMatchObject({ ok: true, imported: 2, companyScopeMismatch: false });
    expect(getCloudAssetBinding("customer", "cust_local_1", COMPANY)).toMatchObject({ cloudUuid: UUID_A });
    expect(getCloudAssetBinding("invoice", "inv_local_1", COMPANY)).toMatchObject({ cloudUuid: UUID_B });
  });

  test("rejects a sidecar from a different company scope and writes nothing", () => {
    const artifact = { cloudAssetBindings: sidecarState("company_OTHER", [
      { entityType: "customer", localLegacyId: "cust_local_1", cloudUuid: UUID_A },
    ]) };
    const result = importCloudAssetBindingsFromArtifact(artifact, { companyId: COMPANY });
    expect(result).toMatchObject({ ok: false, companyScopeMismatch: true, imported: 0 });
    expect(getCloudAssetBinding("customer", "cust_local_1", COMPANY)).toBeNull();
  });

  test("skips invalid bindings but imports the valid ones", () => {
    const state = sidecarState(COMPANY, [
      { entityType: "customer", localLegacyId: "cust_ok", cloudUuid: UUID_A },
    ]);
    state.bindings.customer["cust_bad"] = { entityType: "customer", localLegacyId: "cust_bad", cloudUuid: "not-a-uuid", companyId: COMPANY };
    const result = importCloudAssetBindingsFromArtifact({ cloudAssetBindings: state }, { companyId: COMPANY });
    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ localLegacyId: "cust_bad" }),
    ]));
    expect(getCloudAssetBinding("customer", "cust_ok", COMPANY)).toMatchObject({ cloudUuid: UUID_A });
    expect(getCloudAssetBinding("customer", "cust_bad", COMPANY)).toBeNull();
  });

  test("preserves a newer local binding over an older imported one", () => {
    // Seed a fresh local binding (lastConfirmedAt = now, large).
    setCloudAssetBinding(binding({ entityType: "customer", localLegacyId: "cust_local_1", cloudUuid: UUID_A }));
    // Import an OLDER record that would rebind the same local to a different UUID.
    const artifact = { cloudAssetBindings: sidecarState(COMPANY, [
      { entityType: "customer", localLegacyId: "cust_local_1", cloudUuid: UUID_B, boundAt: 500, lastConfirmedAt: 500 },
    ]) };
    const result = importCloudAssetBindingsFromArtifact(artifact, { companyId: COMPANY });
    expect(result.skipped).toEqual(expect.arrayContaining([
      expect.objectContaining({ localLegacyId: "cust_local_1", reason: "local_binding_newer" }),
    ]));
    // The newer local UUID_A survives — the stale import did not silently win.
    expect(getCloudAssetBinding("customer", "cust_local_1", COMPANY)).toMatchObject({ cloudUuid: UUID_A });
  });
});

describe("cloudAssetBindings hard-delete cleanup", () => {
  test("removing a binding by local id operates on the stored scope without a companyId", () => {
    setCloudAssetBinding(binding({ entityType: "estimate", localLegacyId: "est_local_1", cloudUuid: UUID_A }));
    expect(getCloudAssetBinding("estimate", "est_local_1", COMPANY)).toMatchObject({ cloudUuid: UUID_A });
    // A hard-delete handler only knows the local id.
    const result = removeCloudAssetBinding("estimate", "est_local_1");
    expect(result).toMatchObject({ ok: true, removed: true });
    expect(getCloudAssetBinding("estimate", "est_local_1", COMPANY)).toBeNull();
  });

  test("removing a binding for a non-matching company id does nothing", () => {
    setCloudAssetBinding(binding({ entityType: "customer", localLegacyId: "cust_local_1", cloudUuid: UUID_A }));
    const result = removeCloudAssetBinding("customer", "cust_local_1", "company_OTHER");
    expect(result).toMatchObject({ ok: true, removed: false });
    expect(getCloudAssetBinding("customer", "cust_local_1", COMPANY)).toMatchObject({ cloudUuid: UUID_A });
  });
});
