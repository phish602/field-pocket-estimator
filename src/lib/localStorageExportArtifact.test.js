// @ts-nocheck
/* eslint-disable */

import {
  buildLocalStorageExportArtifact,
  serializeArtifact,
  buildArtifactFilename,
  EXPORT_ARTIFACT_VERSION,
} from "./localStorageExportArtifact";

// All migration keys populated, one supporting key (lang) present as a plain string.
function buildFakeSnapshot(overrides = {}) {
  const defaults = {
    "estipaid-company-profile-v1": JSON.stringify({
      id: "company_local_1",
      companyName: "Test Co",
      email: "test@example.com",
    }),
    "estipaid-customers-v1": JSON.stringify([
      { id: "cust_1", name: "Alice" },
      { id: "cust_2", name: "Bob" },
    ]),
    "estipaid-projects-v1": JSON.stringify([
      { id: "proj_1", customerId: "cust_1", projectNumber: "PR-001" },
    ]),
    "estipaid-estimates-v1": JSON.stringify([
      { id: "est_1", projectId: "proj_1", estimateNumber: "EST-001" },
    ]),
    "estipaid-invoices-v1": JSON.stringify([
      { id: "inv_1", sourceEstimateId: "est_1", invoiceNumber: "INV-001" },
    ]),
    "estipaid-settings-v1": JSON.stringify({ pricing: { taxPct: 8 } }),
    "estipaid-scope-templates-v1": JSON.stringify([
      { id: "tmpl_1", name: "Standard scope" },
    ]),
    "estipaid-audit-events-v1": JSON.stringify([]),
    "estipaid-lang": "en",
  };
  return { ...defaults, ...overrides };
}

// ---------------------------------------------------------------------------
// Top-level artifact shape
// ---------------------------------------------------------------------------

describe("buildLocalStorageExportArtifact — shape", () => {
  test("returns all required top-level fields", () => {
    const artifact = buildLocalStorageExportArtifact(
      buildFakeSnapshot(),
      { createdAt: "2026-03-15T12:00:00.000Z" }
    );

    expect(artifact.artifactVersion).toBe(EXPORT_ARTIFACT_VERSION);
    expect(artifact.createdAt).toBe("2026-03-15T12:00:00.000Z");
    expect(artifact.source).toBe("localStorage");
    expect(artifact.app).toBe("EstiPaid");
    expect(Array.isArray(artifact.storageKeysFound)).toBe(true);
    expect(Array.isArray(artifact.storageKeysMissing)).toBe(true);
    expect(artifact.parsedData).toBeDefined();
    expect(typeof artifact.parsedData.migration).toBe("object");
    expect(typeof artifact.parsedData.supporting).toBe("object");
    expect(Array.isArray(artifact.parseWarnings)).toBe(true);
    expect(typeof artifact.migrationReadiness).toBe("object");
  });

  test("uses injected createdAt for determinism", () => {
    const artifact = buildLocalStorageExportArtifact(
      buildFakeSnapshot(),
      { createdAt: "2026-01-02T03:04:05.000Z" }
    );
    expect(artifact.createdAt).toBe("2026-01-02T03:04:05.000Z");
  });

  test("generates a createdAt when not provided", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    expect(typeof artifact.createdAt).toBe("string");
    expect(artifact.createdAt.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Successful build from full snapshot
// ---------------------------------------------------------------------------

describe("buildLocalStorageExportArtifact — successful full build", () => {
  test("parses companyProfile correctly", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    const { companyProfile } = artifact.parsedData.migration;
    expect(companyProfile.present).toBe(true);
    expect(companyProfile.parsed.companyName).toBe("Test Co");
    expect(companyProfile.count).toBeNull();
  });

  test("parses customers array correctly", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    const { customers } = artifact.parsedData.migration;
    expect(customers.present).toBe(true);
    expect(customers.parsed).toHaveLength(2);
    expect(customers.count).toBe(2);
  });

  test("parses all array migration keys with correct counts", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    const { migration } = artifact.parsedData;

    expect(migration.projects.count).toBe(1);
    expect(migration.estimates.count).toBe(1);
    expect(migration.invoices.count).toBe(1);
    expect(migration.scopeTemplates.count).toBe(1);
    expect(migration.auditEvents.count).toBe(0);
  });

  test("parses settings object correctly", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    const { settings } = artifact.parsedData.migration;
    expect(settings.present).toBe(true);
    expect(settings.parsed.pricing.taxPct).toBe(8);
  });

  test("all migration keys appear in storageKeysFound", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    expect(artifact.storageKeysFound).toContain("estipaid-company-profile-v1");
    expect(artifact.storageKeysFound).toContain("estipaid-customers-v1");
    expect(artifact.storageKeysFound).toContain("estipaid-projects-v1");
    expect(artifact.storageKeysFound).toContain("estipaid-estimates-v1");
    expect(artifact.storageKeysFound).toContain("estipaid-invoices-v1");
    expect(artifact.storageKeysFound).toContain("estipaid-settings-v1");
    expect(artifact.storageKeysFound).toContain("estipaid-scope-templates-v1");
    expect(artifact.storageKeysFound).toContain("estipaid-audit-events-v1");
  });

  test("storageKeysMissing is empty when all migration keys present", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    expect(artifact.storageKeysMissing).toHaveLength(0);
  });

  test("migrationReadiness reflects complete data", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    const r = artifact.migrationReadiness;

    expect(r.hasCompanyProfile).toBe(true);
    expect(r.hasCustomers).toBe(true);
    expect(r.customerCount).toBe(2);
    expect(r.estimateCount).toBe(1);
    expect(r.invoiceCount).toBe(1);
    expect(r.projectCount).toBe(1);
    expect(r.scopeTemplateCount).toBe(1);
    expect(r.auditEventCount).toBe(0);
    expect(r.parseErrorCount).toBe(0);
    expect(r.missingMigrationKeys).toHaveLength(0);
    expect(r.ready).toBe(true);
  });

  test("lang plain string captured in supporting data", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    expect(artifact.parsedData.supporting.lang.present).toBe(true);
    expect(artifact.parsedData.supporting.lang.parsed).toBe("en");
  });
});

// ---------------------------------------------------------------------------
// Missing keys
// ---------------------------------------------------------------------------

describe("buildLocalStorageExportArtifact — missing keys", () => {
  test("reports missing key in storageKeysMissing", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-customers-v1": undefined });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    expect(artifact.storageKeysMissing).toContain("estipaid-customers-v1");
  });

  test("adds warning for missing migration key", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-customers-v1": undefined });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    const w = artifact.parseWarnings.find((w) => w.key === "estipaid-customers-v1");
    expect(w).toBeDefined();
    expect(w.code).toMatch(/^missing_key:/);
    expect(w.severity).toBe("warning");
  });

  test("adds one warning per missing key for multiple missing keys", () => {
    const snapshot = buildFakeSnapshot({
      "estipaid-customers-v1": undefined,
      "estipaid-invoices-v1": undefined,
    });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    const missingWarnings = artifact.parseWarnings.filter((w) =>
      w.code.startsWith("missing_key:")
    );
    expect(missingWarnings.length).toBeGreaterThanOrEqual(2);
    expect(missingWarnings.some((w) => w.key === "estipaid-customers-v1")).toBe(true);
    expect(missingWarnings.some((w) => w.key === "estipaid-invoices-v1")).toBe(true);
  });

  test("sets present=false on migration entry for missing key", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-projects-v1": undefined });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    expect(artifact.parsedData.migration.projects.present).toBe(false);
  });

  test("migrationReadiness.ready is false when migration key missing", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-estimates-v1": undefined });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    expect(artifact.migrationReadiness.ready).toBe(false);
    expect(artifact.migrationReadiness.missingMigrationKeys).toContain("estipaid-estimates-v1");
  });

  test("migrationReadiness.hasCustomers false when customers missing", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-customers-v1": undefined });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    expect(artifact.migrationReadiness.hasCustomers).toBe(false);
    expect(artifact.migrationReadiness.customerCount).toBe(0);
  });

  test("missing key does not appear in storageKeysFound", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-customers-v1": undefined });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    expect(artifact.storageKeysFound).not.toContain("estipaid-customers-v1");
  });
});

// ---------------------------------------------------------------------------
// Invalid JSON
// ---------------------------------------------------------------------------

describe("buildLocalStorageExportArtifact — invalid JSON", () => {
  test("emits error warning for invalid JSON in migration key", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-customers-v1": "not valid json {{{" });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    const errorWarnings = artifact.parseWarnings.filter((w) => w.severity === "error");
    expect(errorWarnings.length).toBeGreaterThanOrEqual(1);
    expect(errorWarnings.some((w) => w.key === "estipaid-customers-v1")).toBe(true);
  });

  test("sets parseError on the affected migration entry", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-estimates-v1": "{ broken" });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    const entry = artifact.parsedData.migration.estimates;
    expect(entry.present).toBe(true);
    expect(entry.parsed).toBeNull();
    expect(typeof entry.parseError).toBe("string");
    expect(entry.parseError.length).toBeGreaterThan(0);
  });

  test("parseErrorCount > 0 in migrationReadiness for invalid JSON", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-invoices-v1": "[invalid" });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    expect(artifact.migrationReadiness.parseErrorCount).toBeGreaterThan(0);
    expect(artifact.migrationReadiness.ready).toBe(false);
  });

  test("key with invalid JSON still appears in storageKeysFound (key was present)", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-customers-v1": "{bad" });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    expect(artifact.storageKeysFound).toContain("estipaid-customers-v1");
    expect(artifact.storageKeysMissing).not.toContain("estipaid-customers-v1");
  });
});

// ---------------------------------------------------------------------------
// Empty datasets
// ---------------------------------------------------------------------------

describe("buildLocalStorageExportArtifact — empty datasets", () => {
  test("emits info warning for empty array in migration key", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-customers-v1": JSON.stringify([]) });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    const infoWarnings = artifact.parseWarnings.filter((w) => w.severity === "info");
    expect(infoWarnings.some((w) => w.key === "estipaid-customers-v1")).toBe(true);
  });

  test("empty array still marks key as present with count=0", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-estimates-v1": JSON.stringify([]) });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    const entry = artifact.parsedData.migration.estimates;
    expect(entry.present).toBe(true);
    expect(entry.count).toBe(0);
  });

  test("empty array does not add the key to storageKeysMissing", () => {
    const snapshot = buildFakeSnapshot({ "estipaid-estimates-v1": JSON.stringify([]) });
    const artifact = buildLocalStorageExportArtifact(snapshot);
    expect(artifact.storageKeysMissing).not.toContain("estipaid-estimates-v1");
  });
});

// ---------------------------------------------------------------------------
// No input mutation
// ---------------------------------------------------------------------------

describe("buildLocalStorageExportArtifact — no input mutation", () => {
  test("does not modify the input snapshot object", () => {
    const snapshot = buildFakeSnapshot();
    const before = JSON.stringify(snapshot);
    buildLocalStorageExportArtifact(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  test("does not add new properties to the input snapshot", () => {
    const snapshot = buildFakeSnapshot();
    const keysBefore = Object.keys(snapshot).length;
    buildLocalStorageExportArtifact(snapshot);
    expect(Object.keys(snapshot).length).toBe(keysBefore);
  });

  test("does not write to window.localStorage", () => {
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    const removeItemSpy = jest.spyOn(Storage.prototype, "removeItem");

    buildLocalStorageExportArtifact(buildFakeSnapshot());

    expect(setItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();

    setItemSpy.mockRestore();
    removeItemSpy.mockRestore();
  });

  test("artifact parsedData does not share references with input snapshot", () => {
    const snapshot = buildFakeSnapshot();
    const artifact = buildLocalStorageExportArtifact(snapshot);

    // Mutating the artifact's parsed data must not affect the snapshot
    const parsed = artifact.parsedData.migration.customers.parsed;
    if (Array.isArray(parsed) && parsed.length > 0) {
      const originalSnapshotValue = snapshot["estipaid-customers-v1"];
      parsed[0].name = "__mutated__";
      expect(snapshot["estipaid-customers-v1"]).toBe(originalSnapshotValue);
    }
  });
});

// ---------------------------------------------------------------------------
// localStorage-like input (getItem interface)
// ---------------------------------------------------------------------------

describe("buildLocalStorageExportArtifact — getItem interface", () => {
  test("accepts an object with a .getItem method", () => {
    const store = buildFakeSnapshot();
    const localStorageLike = {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    };

    const artifact = buildLocalStorageExportArtifact(localStorageLike);
    expect(artifact.parsedData.migration.customers.present).toBe(true);
    expect(artifact.parsedData.migration.customers.count).toBe(2);
  });

  test("getItem returning null treats key as missing", () => {
    const localStorageLike = {
      getItem: (_key) => null,
    };
    const artifact = buildLocalStorageExportArtifact(localStorageLike);
    expect(artifact.storageKeysMissing.length).toBeGreaterThan(0);
    expect(artifact.migrationReadiness.ready).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Null / undefined snapshot
// ---------------------------------------------------------------------------

describe("buildLocalStorageExportArtifact — null/undefined snapshot", () => {
  test("handles null snapshot without throwing", () => {
    expect(() => buildLocalStorageExportArtifact(null)).not.toThrow();
  });

  test("handles undefined snapshot without throwing", () => {
    expect(() => buildLocalStorageExportArtifact(undefined)).not.toThrow();
  });

  test("null snapshot marks all migration keys as missing", () => {
    const artifact = buildLocalStorageExportArtifact(null);
    expect(artifact.storageKeysMissing.length).toBe(8);
    expect(artifact.migrationReadiness.ready).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildArtifactFilename
// ---------------------------------------------------------------------------

describe("buildArtifactFilename", () => {
  test("generates correct filename for a known ISO timestamp", () => {
    expect(buildArtifactFilename("2026-03-15T14:30:45.000Z")).toBe(
      "estipaid-localstorage-export-20260315-143045.json"
    );
  });

  test("zero-pads month, day, hour, minute, second", () => {
    expect(buildArtifactFilename("2026-01-05T09:05:01.000Z")).toBe(
      "estipaid-localstorage-export-20260105-090501.json"
    );
  });

  test("filename starts with correct prefix", () => {
    const filename = buildArtifactFilename("2026-06-05T00:00:00.000Z");
    expect(filename).toMatch(/^estipaid-localstorage-export-/);
  });

  test("filename ends with .json", () => {
    expect(buildArtifactFilename("2026-06-05T00:00:00.000Z")).toMatch(/\.json$/);
  });

  test("generates a valid filename with no argument", () => {
    const filename = buildArtifactFilename();
    expect(filename).toMatch(/^estipaid-localstorage-export-\d{8}-\d{6}\.json$/);
  });

  test("filename matches expected pattern for midnight", () => {
    expect(buildArtifactFilename("2026-12-31T00:00:00.000Z")).toBe(
      "estipaid-localstorage-export-20261231-000000.json"
    );
  });
});

// ---------------------------------------------------------------------------
// serializeArtifact
// ---------------------------------------------------------------------------

describe("serializeArtifact", () => {
  test("returns a string", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    expect(typeof serializeArtifact(artifact)).toBe("string");
  });

  test("returns valid JSON", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    expect(() => JSON.parse(serializeArtifact(artifact))).not.toThrow();
  });

  test("round-trips cleanly", () => {
    const artifact = buildLocalStorageExportArtifact(
      buildFakeSnapshot(),
      { createdAt: "2026-03-15T12:00:00.000Z" }
    );
    const reparsed = JSON.parse(serializeArtifact(artifact));

    expect(reparsed.artifactVersion).toBe(artifact.artifactVersion);
    expect(reparsed.createdAt).toBe("2026-03-15T12:00:00.000Z");
    expect(reparsed.source).toBe("localStorage");
    expect(reparsed.app).toBe("EstiPaid");
    expect(reparsed.migrationReadiness.customerCount).toBe(artifact.migrationReadiness.customerCount);
  });

  test("output is pretty-printed (contains newlines and indentation)", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    const serialized = serializeArtifact(artifact);
    expect(serialized).toContain("\n");
    expect(serialized).toContain("  ");
  });
});

// ---------------------------------------------------------------------------
// No Supabase interaction
// ---------------------------------------------------------------------------

describe("no Supabase interaction", () => {
  test("artifact source is localStorage, not a Supabase source", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    expect(artifact.source).toBe("localStorage");
  });

  test("artifact contains no backend write fields", () => {
    const artifact = buildLocalStorageExportArtifact(buildFakeSnapshot());
    expect(artifact).not.toHaveProperty("supabaseWrites");
    expect(artifact).not.toHaveProperty("insertedRows");
    expect(artifact).not.toHaveProperty("backendWriteResult");
  });

  test("function is synchronous and makes no network requests", () => {
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;

    try {
      buildLocalStorageExportArtifact(buildFakeSnapshot());
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("does not use XMLHttpRequest", () => {
    const xhrOpenSpy = jest.spyOn(XMLHttpRequest.prototype, "open");
    buildLocalStorageExportArtifact(buildFakeSnapshot());
    expect(xhrOpenSpy).not.toHaveBeenCalled();
    xhrOpenSpy.mockRestore();
  });
});
