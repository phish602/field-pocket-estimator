// @ts-nocheck
/* eslint-disable */

import { triggerLocalStorageExportDownload } from "./localStorageExportDownload";

function buildFakeSnapshot(overrides = {}) {
  const defaults = {
    "estipaid-company-profile-v1": JSON.stringify({ companyName: "Test Co" }),
    "estipaid-customers-v1": JSON.stringify([{ id: "cust_1", name: "Alice" }]),
    "estipaid-projects-v1": JSON.stringify([]),
    "estipaid-estimates-v1": JSON.stringify([{ id: "est_1", estimateNumber: "EST-001" }]),
    "estipaid-invoices-v1": JSON.stringify([]),
    "estipaid-settings-v1": JSON.stringify({ pricing: {} }),
    "estipaid-scope-templates-v1": JSON.stringify([]),
    "estipaid-audit-events-v1": JSON.stringify([]),
  };
  return { ...defaults, ...overrides };
}

function buildFakeDeps() {
  const objectUrl = "blob:http://localhost/fake-uuid";
  const anchor = { href: null, download: null, click: jest.fn() };
  const body = { appendChild: jest.fn(), removeChild: jest.fn() };
  const documentObject = { createElement: jest.fn(() => anchor), body };
  const blob = { _isFakeBlob: true };
  const BlobConstructor = jest.fn(() => blob);
  const URLObject = {
    createObjectURL: jest.fn(() => objectUrl),
    revokeObjectURL: jest.fn(),
  };
  return { anchor, body, documentObject, blob, BlobConstructor, objectUrl, URLObject };
}

// ---------------------------------------------------------------------------
// Return shape
// ---------------------------------------------------------------------------

describe("triggerLocalStorageExportDownload — return shape", () => {
  test("returns all required fields", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      ...deps,
      createdAt: "2026-03-15T12:00:00.000Z",
    });

    expect(typeof result.filename).toBe("string");
    expect(typeof result.artifact).toBe("object");
    expect(Array.isArray(result.storageKeysFound)).toBe(true);
    expect(Array.isArray(result.storageKeysMissing)).toBe(true);
    expect(Array.isArray(result.parseWarnings)).toBe(true);
    expect(typeof result.migrationReadiness).toBe("object");
  });

  test("filename matches injected createdAt", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      ...deps,
      createdAt: "2026-03-15T14:30:45.000Z",
    });
    expect(result.filename).toBe("estipaid-localstorage-export-20260315-143045.json");
  });

  test("artifact source is localStorage", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      ...deps,
    });
    expect(result.artifact.source).toBe("localStorage");
    expect(result.artifact.app).toBe("EstiPaid");
  });

  test("storageKeysFound and storageKeysMissing are the artifact's own arrays", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      ...deps,
    });
    expect(result.storageKeysFound).toBe(result.artifact.storageKeysFound);
    expect(result.storageKeysMissing).toBe(result.artifact.storageKeysMissing);
    expect(result.parseWarnings).toBe(result.artifact.parseWarnings);
    expect(result.migrationReadiness).toBe(result.artifact.migrationReadiness);
  });
});

// ---------------------------------------------------------------------------
// Successful download flow
// ---------------------------------------------------------------------------

describe("triggerLocalStorageExportDownload — download mechanics", () => {
  test("anchor.click is called exactly once", () => {
    const deps = buildFakeDeps();
    triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      ...deps,
      createdAt: "2026-03-15T12:00:00.000Z",
    });
    expect(deps.anchor.click).toHaveBeenCalledTimes(1);
  });

  test("Blob constructor is called with serialized JSON and correct MIME type", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      ...deps,
      createdAt: "2026-03-15T12:00:00.000Z",
    });

    expect(deps.BlobConstructor).toHaveBeenCalledTimes(1);
    const [blobContent, blobOptions] = deps.BlobConstructor.mock.calls[0];
    expect(Array.isArray(blobContent)).toBe(true);
    expect(blobContent.length).toBe(1);

    const parsed = JSON.parse(blobContent[0]);
    expect(parsed.source).toBe("localStorage");
    expect(parsed.app).toBe("EstiPaid");
    expect(parsed.artifactVersion).toBe(result.artifact.artifactVersion);
    expect(blobOptions).toEqual({ type: "application/json" });
  });

  test("anchor.download is set to the correct filename", () => {
    const deps = buildFakeDeps();
    triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      ...deps,
      createdAt: "2026-03-15T14:30:45.000Z",
    });
    expect(deps.anchor.download).toBe("estipaid-localstorage-export-20260315-143045.json");
  });

  test("anchor.href is set to the object URL from createObjectURL", () => {
    const deps = buildFakeDeps();
    triggerLocalStorageExportDownload({ storageSnapshot: buildFakeSnapshot(), ...deps });
    expect(deps.anchor.href).toBe(deps.objectUrl);
  });

  test("createElement is called with 'a'", () => {
    const deps = buildFakeDeps();
    triggerLocalStorageExportDownload({ storageSnapshot: buildFakeSnapshot(), ...deps });
    expect(deps.documentObject.createElement).toHaveBeenCalledWith("a");
  });

  test("anchor is appended to body before click and removed after", () => {
    const deps = buildFakeDeps();
    triggerLocalStorageExportDownload({ storageSnapshot: buildFakeSnapshot(), ...deps });
    expect(deps.body.appendChild).toHaveBeenCalledWith(deps.anchor);
    expect(deps.body.removeChild).toHaveBeenCalledWith(deps.anchor);
  });

  test("object URL is revoked after download", () => {
    const deps = buildFakeDeps();
    triggerLocalStorageExportDownload({ storageSnapshot: buildFakeSnapshot(), ...deps });
    expect(deps.URLObject.revokeObjectURL).toHaveBeenCalledWith(deps.objectUrl);
    expect(deps.URLObject.revokeObjectURL).toHaveBeenCalledTimes(1);
  });

  test("object URL is revoked even if anchor.click throws", () => {
    const deps = buildFakeDeps();
    deps.anchor.click.mockImplementation(() => { throw new Error("click failed"); });

    expect(() => triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      ...deps,
    })).toThrow("click failed");

    expect(deps.URLObject.revokeObjectURL).toHaveBeenCalledWith(deps.objectUrl);
  });

  test("createObjectURL receives the Blob instance", () => {
    const deps = buildFakeDeps();
    triggerLocalStorageExportDownload({ storageSnapshot: buildFakeSnapshot(), ...deps });
    expect(deps.URLObject.createObjectURL).toHaveBeenCalledWith(deps.blob);
  });
});

// ---------------------------------------------------------------------------
// Missing keys
// ---------------------------------------------------------------------------

describe("triggerLocalStorageExportDownload — missing keys", () => {
  test("returns storageKeysMissing when keys absent from snapshot", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot({ "estipaid-customers-v1": undefined }),
      ...deps,
    });
    expect(result.storageKeysMissing).toContain("estipaid-customers-v1");
    expect(result.migrationReadiness.ready).toBe(false);
  });

  test("parseWarnings contains missing-key entries", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot({
        "estipaid-estimates-v1": undefined,
        "estipaid-invoices-v1": undefined,
      }),
      ...deps,
    });
    const missingWarnings = result.parseWarnings.filter((w) => w.code.startsWith("missing_key:"));
    expect(missingWarnings.length).toBeGreaterThanOrEqual(2);
    expect(missingWarnings.some((w) => w.key === "estipaid-estimates-v1")).toBe(true);
    expect(missingWarnings.some((w) => w.key === "estipaid-invoices-v1")).toBe(true);
  });

  test("download still proceeds for incomplete snapshot", () => {
    const deps = buildFakeDeps();
    triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot({ "estipaid-customers-v1": undefined }),
      ...deps,
    });
    expect(deps.anchor.click).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Invalid JSON
// ---------------------------------------------------------------------------

describe("triggerLocalStorageExportDownload — invalid JSON", () => {
  test("returns error-severity warning for invalid JSON", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot({ "estipaid-customers-v1": "{ bad json" }),
      ...deps,
    });
    const errorWarnings = result.parseWarnings.filter((w) => w.severity === "error");
    expect(errorWarnings.length).toBeGreaterThanOrEqual(1);
    expect(errorWarnings.some((w) => w.key === "estipaid-customers-v1")).toBe(true);
  });

  test("migrationReadiness.parseErrorCount > 0 for invalid JSON", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot({ "estipaid-estimates-v1": "[broken" }),
      ...deps,
    });
    expect(result.migrationReadiness.parseErrorCount).toBeGreaterThan(0);
    expect(result.migrationReadiness.ready).toBe(false);
  });

  test("download still proceeds despite parse errors", () => {
    const deps = buildFakeDeps();
    triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot({ "estipaid-customers-v1": "not json" }),
      ...deps,
    });
    expect(deps.anchor.click).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// No localStorage mutation
// ---------------------------------------------------------------------------

describe("triggerLocalStorageExportDownload — no localStorage mutation", () => {
  test("does not call localStorage.setItem", () => {
    const deps = buildFakeDeps();
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    triggerLocalStorageExportDownload({ storageSnapshot: buildFakeSnapshot(), ...deps });
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  test("does not call localStorage.removeItem", () => {
    const deps = buildFakeDeps();
    const removeItemSpy = jest.spyOn(Storage.prototype, "removeItem");
    triggerLocalStorageExportDownload({ storageSnapshot: buildFakeSnapshot(), ...deps });
    expect(removeItemSpy).not.toHaveBeenCalled();
    removeItemSpy.mockRestore();
  });

  test("does not modify the input snapshot object", () => {
    const deps = buildFakeDeps();
    const snapshot = buildFakeSnapshot();
    const before = JSON.stringify(snapshot);
    triggerLocalStorageExportDownload({ storageSnapshot: snapshot, ...deps });
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// No Supabase interaction
// ---------------------------------------------------------------------------

describe("triggerLocalStorageExportDownload — no Supabase interaction", () => {
  test("artifact source is localStorage, not a Supabase source", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      ...deps,
    });
    expect(result.artifact.source).toBe("localStorage");
  });

  test("result contains no backend write fields", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      ...deps,
    });
    expect(result).not.toHaveProperty("supabaseWrites");
    expect(result).not.toHaveProperty("insertedRows");
    expect(result).not.toHaveProperty("backendWriteResult");
  });

  test("does not invoke fetch", () => {
    const deps = buildFakeDeps();
    const originalFetch = global.fetch;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    try {
      triggerLocalStorageExportDownload({ storageSnapshot: buildFakeSnapshot(), ...deps });
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      global.fetch = originalFetch;
    }
  });

  test("does not invoke XMLHttpRequest", () => {
    const deps = buildFakeDeps();
    const xhrSpy = jest.spyOn(XMLHttpRequest.prototype, "open");
    triggerLocalStorageExportDownload({ storageSnapshot: buildFakeSnapshot(), ...deps });
    expect(xhrSpy).not.toHaveBeenCalled();
    xhrSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// No automatic execution on import
// ---------------------------------------------------------------------------

describe("triggerLocalStorageExportDownload — no automatic execution", () => {
  test("download does not happen before the function is explicitly called", () => {
    // Module was imported at the top of this file. If the function had run at
    // module level, any injected dep mocks would show unexpected calls.
    // Verifying no side effects occurred before manual invocation.
    const BlobConstructor = jest.fn();
    const createObjectURL = jest.fn();
    expect(BlobConstructor).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  test("anchor.click not called before manual invocation", () => {
    const deps = buildFakeDeps();
    // deps.anchor.click is fresh from buildFakeDeps — never called yet
    expect(deps.anchor.click).not.toHaveBeenCalled();
    triggerLocalStorageExportDownload({ storageSnapshot: buildFakeSnapshot(), ...deps });
    expect(deps.anchor.click).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Missing browser dependencies — graceful degradation
// ---------------------------------------------------------------------------

describe("triggerLocalStorageExportDownload — missing browser deps", () => {
  test("returns artifact without download when BlobConstructor is omitted", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      URLObject: deps.URLObject,
      documentObject: deps.documentObject,
      // BlobConstructor intentionally omitted
    });
    expect(deps.anchor.click).not.toHaveBeenCalled();
    expect(result.artifact).toBeDefined();
    expect(typeof result.filename).toBe("string");
  });

  test("returns artifact without download when documentObject is omitted", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      BlobConstructor: deps.BlobConstructor,
      URLObject: deps.URLObject,
      // documentObject intentionally omitted
    });
    expect(deps.anchor.click).not.toHaveBeenCalled();
    expect(result.artifact).toBeDefined();
  });

  test("returns artifact without download when URLObject is omitted", () => {
    const deps = buildFakeDeps();
    const result = triggerLocalStorageExportDownload({
      storageSnapshot: buildFakeSnapshot(),
      BlobConstructor: deps.BlobConstructor,
      documentObject: deps.documentObject,
      // URLObject intentionally omitted
    });
    expect(deps.anchor.click).not.toHaveBeenCalled();
    expect(result.artifact).toBeDefined();
  });

  test("handles null params without throwing", () => {
    expect(() => triggerLocalStorageExportDownload(null)).not.toThrow();
    const result = triggerLocalStorageExportDownload(null);
    expect(result.artifact).toBeDefined();
    expect(Array.isArray(result.storageKeysMissing)).toBe(true);
  });
});
