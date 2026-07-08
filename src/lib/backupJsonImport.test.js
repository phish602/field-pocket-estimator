const {
  BACKUP_JSON_SOURCE,
  detectBackupJsonSource,
  buildBackupJsonImportPlan,
  applyBackupJsonImportPlan,
} = require("./backupJsonImport");
const { STORAGE_KEYS } = require("../constants/storageKeys");

function cloudArtifact(overrides = {}) {
  return {
    artifactVersion: "cloud-backup-export-artifact-v1",
    schemaVersion: 1,
    source: "cloud",
    app: "EstiPaid",
    exportedAt: "2026-07-05T12:00:00.000Z",
    companyId: "company_1",
    counts: {
      customers: 1,
      projects: 1,
      estimates: 1,
      estimateLineItems: 0,
      invoices: 1,
      invoiceLineItems: 1,
      invoicePayments: 1,
      scopeTemplates: 1,
    },
    restorePayloadCoverage: { totalEstimates: 1, estimatesWithRestorePayload: 1, estimatesMissingRestorePayload: 0 },
    optionalSections: { appRestoreBundle: "available" },
    records: {
      customers: [{ id: "cust_1", type: "commercial", companyName: "Acme Co" }],
      projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
      estimates: [{ id: "est_1", labor: { hazardPct: 5, lines: [] }, materials: { markupPct: 18, items: [] } }],
      invoices: [{
        id: "inv_1",
        invoiceNumber: "INV-1",
        lineItems: [{ id: "line_1", description: "Material" }],
        payments: [{ id: "pay_1", amount: 250 }],
      }],
      companyProfile: { companyName: "AAS Property Care" },
      settings: { pdf: { includeLogo: true } },
      scopeTemplates: [{ id: "tmpl_1", name: "Roof Repair" }],
    },
    notices: [],
    ...overrides,
  };
}

function deviceArtifact(overrides = {}) {
  return {
    artifactVersion: "localstorage-export-artifact-v1",
    createdAt: "2026-07-05T12:00:00.000Z",
    source: "localStorage",
    app: "EstiPaid",
    parsedData: {
      migration: {
        companyProfile: { present: true, parsed: { companyName: "AAS Property Care" } },
        customers: { present: true, parsed: [{ id: "cust_1", type: "residential", fullName: "Jane Doe" }], count: 1 },
        projects: { present: true, parsed: [{ id: "proj_1", projectName: "Fence" }], count: 1 },
        estimates: { present: true, parsed: [{ id: "est_1" }], count: 1 },
        invoices: { present: true, parsed: [{ id: "inv_1", payments: [{ id: "pay_1" }] }], count: 1 },
        settings: { present: true, parsed: { pricing: { defaultMarkupPct: 12 } } },
        scopeTemplates: { present: true, parsed: [{ id: "tmpl_1" }], count: 1 },
        auditEvents: { present: true, parsed: [], count: 0 },
      },
      supporting: {},
    },
    ...overrides,
  };
}

function legacyRawExport(overrides = {}) {
  return {
    app: "EstiPaid",
    version: 1,
    exportedAt: "2026-07-05T12:00:00.000Z",
    settingsKey: STORAGE_KEYS.SETTINGS,
    settings: { pricing: { defaultMarkupPct: 10 } },
    keys: {
      [STORAGE_KEYS.CUSTOMERS]: [{ id: "cust_1" }],
      [STORAGE_KEYS.PROJECTS]: [{ id: "proj_1" }],
      [STORAGE_KEYS.ESTIMATES]: [],
      [STORAGE_KEYS.INVOICES]: [{ id: "inv_1", payments: [] }],
      "not-estipaid-key": [{ id: "x" }],
    },
    ...overrides,
  };
}

function buildWritableStorage() {
  const store = {};
  return {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: jest.fn((key, value) => {
      store[key] = value;
    }),
    __store: store,
  };
}

describe("detectBackupJsonSource", () => {
  test("recognizes cloud backup artifacts", () => {
    expect(detectBackupJsonSource(cloudArtifact())).toBe(BACKUP_JSON_SOURCE.CLOUD);
  });

  test("recognizes device localStorage export artifacts", () => {
    expect(detectBackupJsonSource(deviceArtifact())).toBe(BACKUP_JSON_SOURCE.DEVICE);
  });

  test("recognizes legacy raw app data exports", () => {
    expect(detectBackupJsonSource(legacyRawExport())).toBe(BACKUP_JSON_SOURCE.LEGACY_RAW);
  });

  test("everything else is unknown", () => {
    expect(detectBackupJsonSource(null)).toBe(BACKUP_JSON_SOURCE.UNKNOWN);
    expect(detectBackupJsonSource([])).toBe(BACKUP_JSON_SOURCE.UNKNOWN);
    expect(detectBackupJsonSource({ hello: "world" })).toBe(BACKUP_JSON_SOURCE.UNKNOWN);
  });
});

describe("buildBackupJsonImportPlan - cloud artifacts", () => {
  test("maps cloud records to the local storage keys with previewed counts", () => {
    const plan = buildBackupJsonImportPlan(cloudArtifact());

    expect(plan.ok).toBe(true);
    expect(plan.source).toBe(BACKUP_JSON_SOURCE.CLOUD);
    expect(plan.sourceLabel).toBe("Cloud Backup JSON");
    expect(plan.counts).toEqual({ customers: 1, projects: 1, estimates: 1, invoices: 1, invoicePayments: 1 });
    expect(plan.coreRecordTotal).toBe(4);

    const writeKeys = plan.writes.map((w) => w.key);
    expect(writeKeys).toEqual(expect.arrayContaining([
      STORAGE_KEYS.CUSTOMERS,
      STORAGE_KEYS.PROJECTS,
      STORAGE_KEYS.ESTIMATES,
      STORAGE_KEYS.INVOICES,
      STORAGE_KEYS.SCOPE_TEMPLATES,
      STORAGE_KEYS.COMPANY_PROFILE,
    ]));
    // Settings are never written directly; callers merge them safely.
    expect(writeKeys).not.toContain(STORAGE_KEYS.SETTINGS);
    expect(plan.settings).toEqual({ pdf: { includeLogo: true } });

    const customersWrite = plan.writes.find((w) => w.key === STORAGE_KEYS.CUSTOMERS);
    expect(JSON.parse(customersWrite.value)).toEqual([{ id: "cust_1", type: "commercial", companyName: "Acme Co" }]);
  });

  test("warns about estimates that were missing restore payloads at export time", () => {
    const plan = buildBackupJsonImportPlan(cloudArtifact({
      restorePayloadCoverage: { totalEstimates: 3, estimatesWithRestorePayload: 1, estimatesMissingRestorePayload: 2 },
    }));

    expect(plan.ok).toBe(true);
    expect(plan.warnings.join(" ")).toContain("2 cloud estimate(s) were missing a restore payload");
    expect(plan.warnings.join(" ")).toContain("not rebuilt from guessed math");
  });

  test("blocks a cloud artifact with no records section", () => {
    const plan = buildBackupJsonImportPlan({ source: "cloud", artifactVersion: "cloud-backup-export-artifact-v1" });

    expect(plan.ok).toBe(false);
    expect(plan.blockedReason).toContain("no records section");
    expect(plan.writes).toEqual([]);
  });

  test("an all-zero cloud artifact plans zero core records and writes no core collections", () => {
    const plan = buildBackupJsonImportPlan(cloudArtifact({
      records: {
        customers: [],
        projects: [],
        estimates: [],
        invoices: [],
        companyProfile: null,
        settings: null,
        scopeTemplates: null,
      },
    }));

    expect(plan.ok).toBe(true);
    expect(plan.coreRecordTotal).toBe(0);
    expect(plan.writes).toEqual([]);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });
});

describe("buildBackupJsonImportPlan - device artifacts", () => {
  test("maps parsedData.migration records into the local storage keys", () => {
    const plan = buildBackupJsonImportPlan(deviceArtifact());

    expect(plan.ok).toBe(true);
    expect(plan.source).toBe(BACKUP_JSON_SOURCE.DEVICE);
    expect(plan.counts).toEqual({ customers: 1, projects: 1, estimates: 1, invoices: 1, invoicePayments: 1 });
    expect(plan.coreRecordTotal).toBe(4);
    expect(plan.settings).toEqual({ pricing: { defaultMarkupPct: 12 } });

    const writeKeys = plan.writes.map((w) => w.key);
    expect(writeKeys).toEqual(expect.arrayContaining([
      STORAGE_KEYS.CUSTOMERS,
      STORAGE_KEYS.PROJECTS,
      STORAGE_KEYS.ESTIMATES,
      STORAGE_KEYS.INVOICES,
      STORAGE_KEYS.SCOPE_TEMPLATES,
      STORAGE_KEYS.COMPANY_PROFILE,
    ]));
  });

  test("an empty-device artifact (the cleared-storage trap) plans zero records", () => {
    const plan = buildBackupJsonImportPlan(deviceArtifact({
      parsedData: {
        migration: {
          companyProfile: { present: false },
          customers: { present: false },
          projects: { present: false },
          estimates: { present: false },
          invoices: { present: false },
          settings: { present: false },
          scopeTemplates: { present: false },
          auditEvents: { present: false },
        },
        supporting: {},
      },
    }));

    expect(plan.ok).toBe(true);
    expect(plan.coreRecordTotal).toBe(0);
    expect(plan.writes).toEqual([]);
  });
});

describe("buildBackupJsonImportPlan - legacy raw exports and unknown files", () => {
  test("maps estipaid-prefixed keys (except settings) and counts core records", () => {
    const plan = buildBackupJsonImportPlan(legacyRawExport());

    expect(plan.ok).toBe(true);
    expect(plan.source).toBe(BACKUP_JSON_SOURCE.LEGACY_RAW);
    expect(plan.counts).toEqual({ customers: 1, projects: 1, estimates: 0, invoices: 1, invoicePayments: 0 });

    const writeKeys = plan.writes.map((w) => w.key);
    expect(writeKeys).toContain(STORAGE_KEYS.CUSTOMERS);
    expect(writeKeys).not.toContain(STORAGE_KEYS.SETTINGS);
    expect(writeKeys).not.toContain("not-estipaid-key");
    expect(plan.settings).toEqual({ pricing: { defaultMarkupPct: 10 } });
  });

  test("blocks unrecognized files with a clear reason", () => {
    const plan = buildBackupJsonImportPlan({ some: "random", json: true });

    expect(plan.ok).toBe(false);
    expect(plan.blockedReason).toContain("not a recognized EstiPaid backup JSON");
  });
});

describe("applyBackupJsonImportPlan", () => {
  test("writes the planned keys and reports imported counts", () => {
    const storage = buildWritableStorage();
    const plan = buildBackupJsonImportPlan(cloudArtifact());

    const result = applyBackupJsonImportPlan({ plan, storage });

    expect(result.writeCount).toBe(plan.writes.length);
    expect(result.importedCounts).toEqual({ customers: 1, projects: 1, estimates: 1, invoices: 1, invoicePayments: 1 });
    expect(JSON.parse(storage.__store[STORAGE_KEYS.INVOICES])[0]).toEqual(expect.objectContaining({ id: "inv_1" }));
    expect(JSON.parse(storage.__store[STORAGE_KEYS.COMPANY_PROFILE])).toEqual({ companyName: "AAS Property Care" });
  });

  test("never overwrites existing local collections with empty arrays", () => {
    const storage = buildWritableStorage();
    storage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([{ id: "existing_est" }]));
    storage.setItem.mockClear();

    const plan = buildBackupJsonImportPlan(cloudArtifact({
      records: {
        ...cloudArtifact().records,
        estimates: [],
      },
    }));
    applyBackupJsonImportPlan({ plan, storage });

    expect(storage.setItem).not.toHaveBeenCalledWith(STORAGE_KEYS.ESTIMATES, expect.anything());
    expect(JSON.parse(storage.__store[STORAGE_KEYS.ESTIMATES])).toEqual([{ id: "existing_est" }]);
    expect(plan.warnings.join(" ")).toContain("contains no estimates");
  });

  test("refuses to apply a blocked plan", () => {
    const storage = buildWritableStorage();
    const plan = buildBackupJsonImportPlan({ some: "random" });

    const result = applyBackupJsonImportPlan({ plan, storage });

    expect(result.writeCount).toBe(0);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
