const mockGetSupabaseClient = jest.fn();
const mockEnsureCurrentDeviceCanWriteCloud = jest.fn();
const mockEnsureCurrentDeviceCanApplyLocalRestore = jest.fn();
const mockRunSupabaseCloudVerification = jest.fn();
const mockAtomicRestore = jest.fn();
let mockRestoreTarget;
let mockRestoreIdentity;
let mockRestoreReady;
let mockRestoreGeneration;
let mockRestoreClaim;
jest.mock("./vaultRuntimeStore", () => ({
  runtimeCommitAtomicRecords: (...args) => mockAtomicRestore(...args),
  getVaultRuntimeStatus: () => ({ generation: mockRestoreGeneration }),
  isVaultRuntimeReady: () => mockRestoreReady,
  isVaultRuntimeReadable: () => mockRestoreReady,
}));
jest.mock("./vaultSession", () => ({ deriveWorkspaceVaultTag: async () => "restore-test-tag" }));
jest.mock("./accountScopedLocalStorage", () => ({
  ...jest.requireActual("./accountScopedLocalStorage"),
  getActiveAccountScopedStorage: () => mockRestoreTarget,
  getActiveAccountWorkspaceIdentity: () => mockRestoreIdentity,
  isAuthoritativeVaultRuntimeInstalled: () => mockRestoreReady,
}));
jest.mock("./browserSurfaceAuthority", () => ({
  ...jest.requireActual("./browserSurfaceAuthority"),
  getBrowserSurfaceClaimToken: () => mockRestoreClaim,
}));
beforeEach(() => {
  mockRestoreIdentity = { userId: "user_1", companyId: "company_1" };
  mockRestoreReady = true; mockRestoreGeneration = 1; mockRestoreClaim = "restore-claim";
  mockAtomicRestore.mockImplementation(async (records, { beforeCommit } = {}) => {
    if (beforeCommit && !await beforeCommit()) throw new Error("STALE_SESSION");
    records.forEach(({ logicalKey, value }) => mockRestoreTarget.setItem(logicalKey, value));
    return { ok: true };
  });
});

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

// Only the two ownership READS are stubbed. operationFenceStillCurrent is a
// pure comparator and must stay real, or these tests would prove nothing about
// the generation check the restore path now performs.
jest.mock("./supabaseDeviceLock", () => ({
  ...jest.requireActual("./supabaseDeviceLock"),
  ensureCurrentDeviceCanWriteCloud: (...args) => mockEnsureCurrentDeviceCanWriteCloud(...args),
  ensureCurrentDeviceCanApplyLocalRestore: (...args) => mockEnsureCurrentDeviceCanApplyLocalRestore(...args),
  DEVICE_LOCK_LOST_CODE: "device_lock_lost",
  DEVICE_LOCK_LOST_RESTORE_MESSAGE: "Recovery stopped because EstiPaid was switched to another device.",
}));

// The generation every default fixture operates under.
const RESTORE_FENCE = { companyId: "company_1", deviceId: "device-a", lockVersion: 5 };
function restoreAccessOk(fence = RESTORE_FENCE) {
  return { ok: true, access: { isActive: true, isLocked: false, fence }, error: "" };
}

jest.mock("./supabaseCloudVerification", () => ({
  runSupabaseCloudVerification: (...args) => mockRunSupabaseCloudVerification(...args),
}));

const {
  previewSupabaseCloudRestore,
  executeSupabaseCloudRestore,
  exportSupabaseCloudBackupArtifact,
  CLOUD_RESTORE_STATUS,
  CLOUD_BACKUP_EXPORT_STATUS,
  CLOUD_BACKUP_EXPORT_ARTIFACT_VERSION,
  CLOUD_RESTORE_COMPLETE_EVENT,
  getLastCloudRestoreCompleteAt,
} = require("./supabaseCloudRestore");
const { STORAGE_KEYS } = require("../constants/storageKeys");
const { markCloudBackupDirty, readCloudBackupQueueState, CLOUD_BACKUP_STATUS } = require("./cloudBackupQueue");

function buildEmptyStorageSnapshot(overrides = {}) {
  const values = {
    "estipaid-customers-v1": JSON.stringify([]),
    "estipaid-projects-v1": JSON.stringify([]),
    "estipaid-estimates-v1": JSON.stringify([]),
    "estipaid-invoices-v1": JSON.stringify([]),
    "estipaid-company-profile-v1": JSON.stringify({ id: "local_company", companyName: "AAS Property Care" }),
    "estipaid-settings-v1": JSON.stringify({}),
    "estipaid-scope-templates-v1": JSON.stringify([]),
    "estipaid-audit-events-v1": JSON.stringify([]),
    ...overrides,
  };
  return { getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null) };
}

function buildNonEmptyStorageSnapshot() {
  return buildEmptyStorageSnapshot({
    "estipaid-customers-v1": JSON.stringify([{ id: "cust_local_1", type: "residential", fullName: "Existing Customer" }]),
  });
}

function buildPartialLocalStorageSnapshot() {
  return buildEmptyStorageSnapshot({
    "estipaid-customers-v1": JSON.stringify([{ id: "cust_1", type: "commercial", companyName: "Acme Co" }]),
    "estipaid-projects-v1": JSON.stringify([{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }]),
    "estipaid-estimates-v1": JSON.stringify([]),
    "estipaid-invoices-v1": JSON.stringify([
      {
        id: "inv_1",
        customerId: "cust_1",
        projectId: "proj_1",
        invoiceNumber: "INV-1",
        sourceEstimateId: "est_1",
        total: 1000,
        amountPaid: 250,
        balanceRemaining: 750,
        payments: [],
      },
    ]),
  });
}

function buildWritableStorage(initial = {}) {
  const store = { ...initial };
  mockRestoreTarget = {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: jest.fn((key, value) => {
      store[key] = value;
    }),
    __store: store,
  };
  return mockRestoreTarget;
}

function createMockClient({ rowsByTable = {}, countErrorsByTable = {}, rowErrorsByTable = {} } = {}) {
  const from = jest.fn((table) => ({
    select: jest.fn((columns, options) => {
      if (options && options.head === true) {
        return {
          eq: jest.fn(async () => {
            if (countErrorsByTable[table]) return { count: null, error: countErrorsByTable[table] };
            return { count: (rowsByTable[table] || []).length, error: null };
          }),
        };
      }
      if (table === "app_settings") {
        const eq3 = jest.fn(async () => {
          if (rowErrorsByTable[table]) return { data: null, error: rowErrorsByTable[table] };
          return { data: rowsByTable[table] || [], error: null };
        });
        const eq2 = jest.fn(() => ({ eq: eq3 }));
        const eq1 = jest.fn(() => ({ eq: eq2 }));
        return { eq: eq1 };
      }
      return {
        eq: jest.fn(async () => {
          if (rowErrorsByTable[table]) return { data: null, error: rowErrorsByTable[table] };
          return { data: rowsByTable[table] || [], error: null };
        }),
      };
    }),
  }));
  return { from };
}

function cloudCustomerRow(overrides = {}) {
  return {
    id: "db_cust_1",
    company_id: "company_1",
    legacy_local_id: "cust_1",
    display_name: "Acme Co",
    company_name: "Acme Co",
    contact_name: "Jane Doe",
    phone: "555-1234",
    email: "jane@acme.com",
    billing_address: "123 Main St",
    customer_type: "commercial",
    customer_status: "active",
    ...overrides,
  };
}

function cloudProjectRow(overrides = {}) {
  return {
    id: "db_proj_1",
    company_id: "company_1",
    legacy_local_id: "proj_1",
    customer_id: "db_cust_1",
    project_number: "P-1",
    project_name: "Roof Repair",
    site_address: "456 Oak Ave",
    status: "active",
    notes: "",
    scope_summary: "",
    ...overrides,
  };
}

function cloudInvoiceRow(overrides = {}) {
  return {
    id: "db_inv_1",
    company_id: "company_1",
    legacy_local_id: "inv_1",
    customer_id: "db_cust_1",
    project_id: "db_proj_1",
    estimate_id: null,
    source_estimate_legacy_id: "est_1",
    invoice_number: "INV-1",
    estimate_number: "EST-1",
    status: "sent",
    payment_status: "partial",
    invoice_date: "2026-01-01",
    due_date: "2026-02-01",
    total_amount: 1000,
    amount_paid: 250,
    balance_remaining: 750,
    notes: "",
    terms: "Net 30",
    ...overrides,
  };
}

function cloudPaymentRow(overrides = {}) {
  return {
    id: "db_pay_1",
    company_id: "company_1",
    invoice_id: "db_inv_1",
    legacy_local_id: "pay_1",
    amount: 250,
    method: "cash",
    status: "paid",
    paid_at: "2026-01-15",
    ...overrides,
  };
}

function cloudInvoiceLineItemRow(overrides = {}) {
  return {
    id: "db_inv_line_1",
    company_id: "company_1",
    invoice_id: "db_inv_1",
    legacy_local_id: "invoice:inv_1:line:0",
    sort_order: 0,
    description: "Material",
    quantity: 1,
    unit: null,
    unit_price: 1000,
    total_price: 1000,
    metadata: { kind: "invoice" },
    ...overrides,
  };
}

function localEstimateFixture(overrides = {}) {
  return {
    id: "est_1",
    projectId: "proj_1",
    customerId: "cust_1",
    estimateNumber: "EST-1",
    date: "2026-06-26",
    status: "approved",
    total: 7083000,
    labor: {
      hazardPct: 5,
      riskPct: 2,
      multiplier: 1.25,
      lines: [{ id: "l1", role: "Electrician", hours: 40, rate: 145.75, trueRateInternal: 60 }],
    },
    materials: {
      markupPct: 18,
      items: [{ id: "m1", desc: "Panel", qty: 1, unitCostInternal: 400000, costInternal: 400000, priceEach: 1200000 }],
    },
    ui: { materialsMode: "itemized" },
    ...overrides,
  };
}

function buildScopeImages(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    id: `scope-image-${index + 1}`,
    name: `Reference Photo ${index + 1}.jpg`,
    mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,scopephoto${index + 1}`,
    storedWidth: 1200,
    storedHeight: 900,
    storedSizeBytes: 3072 + index,
    layout: {
      size: index % 2 === 0 ? "medium" : "large",
      align: index % 3 === 0 ? "left" : "center",
      caption: index % 2 === 0,
    },
  }));
}

function cloudEstimateRow(overrides = {}) {
  return {
    id: "db_est_1",
    company_id: "company_1",
    legacy_local_id: "est_1",
    customer_id: "db_cust_1",
    project_id: "db_proj_1",
    estimate_number: "EST-1",
    estimate_date: "2026-06-26",
    status: "approved",
    document_type: "estimate",
    total_amount: 7083000,
    notes: "",
    terms: "",
    restore_payload: {
      schema: "estipaid.estimate.restore_payload",
      version: 1,
      capturedFrom: "localStorage",
      legacyLocalId: "est_1",
      estimate: localEstimateFixture(),
    },
    restore_payload_version: "1",
    restore_payload_captured_at: "2026-06-29T00:00:00.000Z",
    ...overrides,
  };
}

function appRestoreBundleRow(overrides = {}) {
  return {
    id: "bundle_row_1",
    company_id: "company_1",
    setting_scope: "company",
    setting_key: "app_restore_bundle",
    setting_value: {
      schema: "estipaid.app.restore_bundle",
      version: 1,
      capturedFrom: "localStorage",
      companyProfile: {
        companyName: "AAS Property Care",
        phone: "5551234567",
        logoDataUrl: "data:image/png;base64,abc123",
      },
      settings: {
        pdf: { includeLogo: true },
        pricing: { defaultMarkupPct: 12 },
      },
      scopeTemplates: [
        { id: "tmpl_1", name: "Roof Repair", scopeText: "Repair roof leak" },
      ],
    },
    ...overrides,
  };
}

function fullCloudRows(overrides = {}) {
  return {
    customers: [cloudCustomerRow()],
    projects: [cloudProjectRow()],
    estimates: [],
    invoices: [cloudInvoiceRow()],
    invoice_payments: [cloudPaymentRow()],
    estimate_line_items: [],
    invoice_line_items: [cloudInvoiceLineItemRow()],
    ...overrides,
  };
}

const baseContext = {
  configured: true,
  user: { id: "user_1" },
  company: { id: "company_1", name: "AAS Property Care" },
};

describe("supabaseCloudRestore", () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
    mockEnsureCurrentDeviceCanWriteCloud.mockReset();
    mockEnsureCurrentDeviceCanWriteCloud.mockResolvedValue(restoreAccessOk());
    mockEnsureCurrentDeviceCanApplyLocalRestore.mockReset();
    mockEnsureCurrentDeviceCanApplyLocalRestore.mockResolvedValue(restoreAccessOk());
    mockRunSupabaseCloudVerification.mockReset();
    mockRunSupabaseCloudVerification.mockResolvedValue({ ok: true, allMatched: true, availableRepairs: [], notices: [] });
  });

  describe("previewSupabaseCloudRestore", () => {
    test("blocks at signed_out when not configured or no user, with no Supabase calls", async () => {
      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildEmptyStorageSnapshot(),
        configured: false,
        user: null,
        company: null,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.SIGNED_OUT);
      expect(result.eligible).toBe(false);
      expect(result.noWritesPerformed).toBe(true);
      expect(mockGetSupabaseClient).not.toHaveBeenCalled();
    });

    test("blocks at no_workspace when there is no company", async () => {
      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildEmptyStorageSnapshot(),
        ...baseContext,
        company: null,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.NO_WORKSPACE);
      expect(result.eligible).toBe(false);
    });

    test("blocks when local core data is not empty, without reading the cloud", async () => {
      const mockClient = createMockClient({ rowsByTable: fullCloudRows() });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildNonEmptyStorageSnapshot(),
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY);
      expect(result.eligible).toBe(false);
      expect(mockClient.from).not.toHaveBeenCalled();
    });

    test("allows previewing restore for the exact partial-local-snapshot blocker", async () => {
      const mockClient = createMockClient({ rowsByTable: fullCloudRows({ estimates: [cloudEstimateRow()] }) });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildPartialLocalStorageSnapshot(),
        allowPartialLocalSnapshot: true,
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.ELIGIBLE);
      expect(result.eligible).toBe(true);
      expect(result.partial).toBe(false);
    });

    test("partial-local-snapshot preview stays eligible when the linked estimate is restorable even if another cloud estimate is not", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          estimates: [
            cloudEstimateRow(),
            cloudEstimateRow({ id: "db_est_2", legacy_local_id: "est_2", restore_payload: null, restore_payload_version: null }),
          ],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildPartialLocalStorageSnapshot(),
        allowPartialLocalSnapshot: true,
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.ELIGIBLE);
      expect(result.eligible).toBe(true);
      expect(result.recoveryEligibleForPartialLocalSnapshot).toBe(true);
    });

    test("partial-local-snapshot preview blocks when the linked estimate is missing valid restore data", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          estimates: [cloudEstimateRow({ restore_payload: null, restore_payload_version: null })],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildPartialLocalStorageSnapshot(),
        allowPartialLocalSnapshot: true,
        ...baseContext,
      });

      expect(result.eligible).toBe(true);
      expect(result.recoveryEligibleForPartialLocalSnapshot).toBe(false);
      expect(result.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "partial_snapshot_estimates_unrestorable" }),
      ]));
    });

    test("reports eligible and cloud counts when local is empty and cloud has restorable data", async () => {
      const mockClient = createMockClient({ rowsByTable: fullCloudRows() });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildEmptyStorageSnapshot(),
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.ELIGIBLE);
      expect(result.eligible).toBe(true);
      expect(result.partial).toBe(false);
      expect(result.cloudCounts).toEqual(expect.objectContaining({
        customers: 1, projects: 1, invoices: 1, invoice_payments: 1, invoice_line_items: 1, estimates: 0, estimate_line_items: 0,
      }));
      expect(result.blockers).toEqual([]);
      expect(result.notices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "supplemental_restore_not_available",
          details: expect.objectContaining({
            localStorageKeys: expect.objectContaining({
              companyProfile: STORAGE_KEYS.COMPANY_PROFILE,
              logoField: "logoDataUrl",
              settings: STORAGE_KEYS.SETTINGS,
              scopeTemplates: STORAGE_KEYS.SCOPE_TEMPLATES,
            }),
          }),
        }),
      ]));
    });

    test("preview stops warning about missing app restore coverage when a valid bundle exists", async () => {
      const mockClient = createMockClient({
        rowsByTable: {
          ...fullCloudRows(),
          app_settings: [appRestoreBundleRow()],
        },
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildEmptyStorageSnapshot(),
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.ELIGIBLE);
      expect(result.appBundleAvailable).toBe(true);
      expect(result.appBundleSummary).toEqual(expect.objectContaining({
        companyProfileCaptured: true,
        logoDataUrlCaptured: true,
        settingsCaptured: true,
        scopeTemplatesCaptured: true,
      }));
      expect(result.notices.some((notice) => notice.code === "supplemental_restore_not_available")).toBe(false);
    });

    test("reports a partial-eligible result with an estimate blocker when the cloud also has estimates", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          estimates: [{ id: "db_est_1" }],
          estimate_line_items: [{ id: "db_est_line_1" }],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildEmptyStorageSnapshot(),
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.ELIGIBLE);
      expect(result.eligible).toBe(true);
      expect(result.partial).toBe(true);
      expect(result.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "estimates_not_reconstructable" }),
      ]));
    });

    test("reports full estimate restore eligible (no blocker) when every cloud estimate has a valid restore_payload", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          estimates: [cloudEstimateRow()],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildEmptyStorageSnapshot(),
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.ELIGIBLE);
      expect(result.eligible).toBe(true);
      expect(result.partial).toBe(false);
      expect(result.blockers).toEqual([]);
      expect(result.cloudCounts).toEqual(expect.objectContaining({ estimates: 1 }));
    });

    test("keeps the partial blocker when at least one cloud estimate is missing its restore_payload", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          estimates: [cloudEstimateRow(), cloudEstimateRow({ id: "db_est_2", legacy_local_id: "est_2", restore_payload: null, restore_payload_version: null })],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildEmptyStorageSnapshot(),
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.ELIGIBLE);
      expect(result.eligible).toBe(true);
      expect(result.partial).toBe(true);
      expect(result.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "estimates_not_reconstructable" }),
      ]));
    });

    test("reports no_cloud_data when local is empty and the cloud workspace has no core data", async () => {
      const mockClient = createMockClient({ rowsByTable: fullCloudRows({ customers: [], projects: [], invoices: [] }) });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await previewSupabaseCloudRestore({
        storageSnapshot: buildEmptyStorageSnapshot(),
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.NO_CLOUD_DATA);
      expect(result.eligible).toBe(false);
    });
  });

  describe("executeSupabaseCloudRestore", () => {
    test("confirmed fresh-device restore waits for secure runtime handoff before applying records", async () => {
      mockGetSupabaseClient.mockReturnValue(createMockClient({ rowsByTable: fullCloudRows() }));
      const storage = buildWritableStorage();
      let ready = false;
      const write = storage.setItem.getMockImplementation();
      storage.setItem.mockImplementation((key, value) => {
        if (!ready) throw new Error("EstiPaid could not save yet because this workspace's secure storage is not ready.");
        write(key, value);
      });
      const prepareSecureRestore = jest.fn(async () => { ready = true; return { ok: true }; });
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext, prepareSecureRestore });
      expect(result.error || "").toBe("");
      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      expect(prepareSecureRestore).toHaveBeenCalledTimes(1);
    });
    test("blocks at signed_out without any Supabase calls or localStorage writes", async () => {
      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({
        storage,
        configured: false,
        user: null,
        company: null,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.SIGNED_OUT);
      expect(result.restored).toBe(false);
      expect(mockGetSupabaseClient).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    test("rejects when a fresh device-lock check says this device is locked", async () => {
      mockEnsureCurrentDeviceCanWriteCloud.mockResolvedValue({
        ok: false,
        access: { isLocked: true, isActive: false },
        error: "This device is locked because EstiPaid is active on another device.",
      });

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({
        storage,
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.ERROR);
      expect(result.error).toMatch(/locked/i);
      expect(mockGetSupabaseClient).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    test("aborts after cloud fetch when a takeover is detected before the local restore batch", async () => {
      localStorage.clear();
      markCloudBackupDirty({ reason: "restore_pending_before_takeover", domains: ["customers"], severity: "normal" });
      const mockClient = createMockClient({ rowsByTable: fullCloudRows({ estimates: [cloudEstimateRow()] }) });
      mockGetSupabaseClient.mockReturnValue(mockClient);
      mockEnsureCurrentDeviceCanApplyLocalRestore.mockResolvedValueOnce({
        ok: false,
        code: "device_lock_lost",
        deviceLockLost: true,
        error: "Recovery stopped because EstiPaid was switched to another device.",
      });

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.DEVICE_LOCKED);
      expect(result.deviceLockLost).toBe(true);
      expect(result.error).toBe("Recovery stopped because EstiPaid was switched to another device.");
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(readCloudBackupQueueState().pending).toBe(true);
      expect(mockEnsureCurrentDeviceCanApplyLocalRestore).toHaveBeenCalledWith(expect.objectContaining({
        reason: "before_local_restore_apply",
      }));
    });

    test("does not clear the backup queue or mark restore complete if ownership is lost after the local batch", async () => {
      localStorage.clear();
      markCloudBackupDirty({ reason: "restore_pending_after_takeover", domains: ["customers"], severity: "normal" });
      const mockClient = createMockClient({ rowsByTable: fullCloudRows() });
      mockGetSupabaseClient.mockReturnValue(mockClient);
      mockEnsureCurrentDeviceCanApplyLocalRestore
        .mockResolvedValueOnce(restoreAccessOk())
        .mockResolvedValueOnce(restoreAccessOk())
        .mockResolvedValueOnce({
          ok: false,
          code: "device_lock_lost",
          deviceLockLost: true,
          error: "Recovery stopped because EstiPaid was switched to another device.",
        });

      const onComplete = jest.fn();
      window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
      try {
        const storage = buildWritableStorage();
        const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

        expect(result.status).toBe(CLOUD_RESTORE_STATUS.DEVICE_LOCKED);
        expect(result.noWritesPerformed).toBe(false);
        expect(readCloudBackupQueueState().pending).toBe(true);
        expect(onComplete).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
      }
    });

    test("rechecks local emptiness immediately before writing and blocks if data appeared in between", async () => {
      const mockClient = createMockClient({ rowsByTable: fullCloudRows() });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      let callCount = 0;
      const originalGetItem = storage.getItem;
      storage.getItem = (key) => {
        if (key === "estipaid-customers-v1") {
          callCount += 1;
          // First call (initial check) sees empty; second call (final
          // recheck right before writing) sees a customer that appeared
          // from another tab/process in between.
          if (callCount > 1) return JSON.stringify([{ id: "late_arrival", type: "residential", fullName: "Late" }]);
        }
        return originalGetItem(key);
      };

      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY);
      expect(result.restored).toBe(false);
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    test("allows restoring over the exact partial-local-snapshot blocker when explicitly enabled", async () => {
      const mockClient = createMockClient({ rowsByTable: fullCloudRows({ estimates: [cloudEstimateRow()] }) });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage({
        [STORAGE_KEYS.CUSTOMERS]: JSON.stringify([{ id: "cust_1", type: "commercial", companyName: "Old Acme Co" }]),
        [STORAGE_KEYS.PROJECTS]: JSON.stringify([{ id: "proj_1", customerId: "cust_1", projectName: "Old Roof Repair" }]),
        [STORAGE_KEYS.ESTIMATES]: JSON.stringify([]),
        [STORAGE_KEYS.INVOICES]: JSON.stringify([
          {
            id: "inv_1",
            customerId: "cust_1",
            projectId: "proj_1",
            invoiceNumber: "INV-1",
            sourceEstimateId: "est_1",
            total: 1000,
            amountPaid: 250,
            balanceRemaining: 750,
            payments: [],
          },
        ]),
        [STORAGE_KEYS.COMPANY_PROFILE]: JSON.stringify({ companyName: "AAS Property Care" }),
        [STORAGE_KEYS.SETTINGS]: JSON.stringify({}),
        [STORAGE_KEYS.SCOPE_TEMPLATES]: JSON.stringify([]),
        [STORAGE_KEYS.AUDIT_EVENTS]: JSON.stringify([]),
      });

      const result = await executeSupabaseCloudRestore({
        storage,
        allowPartialLocalSnapshot: true,
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      expect(result.restored).toBe(true);
      expect(result.noExistingLocalDataOverwritten).toBe(false);
      expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.ESTIMATES, expect.any(String));
      const restoredEstimates = JSON.parse(storage.__store[STORAGE_KEYS.ESTIMATES]);
      expect(restoredEstimates[0]).toEqual(expect.objectContaining({ id: "est_1", estimateNumber: "EST-1" }));
    });

    test("partial-local-snapshot restore stays blocked when the linked estimate is missing valid restore data", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          estimates: [cloudEstimateRow({ restore_payload: null, restore_payload_version: null })],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage({
        [STORAGE_KEYS.CUSTOMERS]: JSON.stringify([{ id: "cust_1", type: "commercial", companyName: "Old Acme Co" }]),
        [STORAGE_KEYS.PROJECTS]: JSON.stringify([{ id: "proj_1", customerId: "cust_1", projectName: "Old Roof Repair" }]),
        [STORAGE_KEYS.ESTIMATES]: JSON.stringify([]),
        [STORAGE_KEYS.INVOICES]: JSON.stringify([
          {
            id: "inv_1",
            customerId: "cust_1",
            projectId: "proj_1",
            invoiceNumber: "INV-1",
            sourceEstimateId: "est_1",
            total: 1000,
            amountPaid: 250,
            balanceRemaining: 750,
            payments: [],
          },
        ]),
        [STORAGE_KEYS.COMPANY_PROFILE]: JSON.stringify({ companyName: "AAS Property Care" }),
        [STORAGE_KEYS.SETTINGS]: JSON.stringify({}),
        [STORAGE_KEYS.SCOPE_TEMPLATES]: JSON.stringify([]),
        [STORAGE_KEYS.AUDIT_EVENTS]: JSON.stringify([]),
      });

      const result = await executeSupabaseCloudRestore({
        storage,
        allowPartialLocalSnapshot: true,
        ...baseContext,
      });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.BLOCKED_UNSUPPORTED_SHAPE);
      expect(result.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "partial_snapshot_estimates_unrestorable" }),
      ]));
      expect(storage.setItem).not.toHaveBeenCalledWith(STORAGE_KEYS.ESTIMATES, expect.any(String));
    });

    test("performs only SELECT reads against Supabase, never any write call", async () => {
      const mockClient = createMockClient({ rowsByTable: fullCloudRows() });
      mockClient.insert = jest.fn();
      mockClient.update = jest.fn();
      mockClient.upsert = jest.fn();
      mockClient.delete = jest.fn();
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(mockClient.insert).not.toHaveBeenCalled();
      expect(mockClient.update).not.toHaveBeenCalled();
      expect(mockClient.upsert).not.toHaveBeenCalled();
      expect(mockClient.delete).not.toHaveBeenCalled();
    });

    test("does not write localStorage when a cloud row cannot be mapped (missing legacy_local_id)", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          customers: [cloudCustomerRow({ legacy_local_id: "" })],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.ERROR);
      expect(result.restored).toBe(false);
      expect(result.noWritesPerformed).toBe(true);
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    test("does not write localStorage when an invoice line item references an invoice that was not fetched", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          invoice_line_items: [cloudInvoiceLineItemRow({ invoice_id: "db_inv_missing" })],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.ERROR);
      expect(storage.setItem).not.toHaveBeenCalled();
    });

    test("writes localStorage only after the full payload is built, in one pass, when eligible", async () => {
      const mockClient = createMockClient({ rowsByTable: fullCloudRows() });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      expect(result.restored).toBe(true);
      expect(result.noWritesPerformed).toBe(false);
      expect(result.noCloudDataDeleted).toBe(true);
      expect(result.noExistingLocalDataOverwritten).toBe(true);
      expect(result.notices).toEqual(expect.arrayContaining([
        expect.objectContaining({
          code: "supplemental_restore_not_available",
          details: expect.objectContaining({
            localStorageKeys: expect.objectContaining({
              companyProfile: STORAGE_KEYS.COMPANY_PROFILE,
              logoField: "logoDataUrl",
              settings: STORAGE_KEYS.SETTINGS,
              scopeTemplates: STORAGE_KEYS.SCOPE_TEMPLATES,
            }),
          }),
        }),
      ]));
      expect(storage.setItem).toHaveBeenCalledTimes(8);
      expect(storage.setItem).toHaveBeenCalledWith("estipaid-customers-v1", expect.any(String));
      expect(storage.setItem).toHaveBeenCalledWith("estipaid-projects-v1", expect.any(String));
      expect(storage.setItem).toHaveBeenCalledWith("estipaid-invoices-v1", expect.any(String));
      expect(storage.setItem).not.toHaveBeenCalledWith(STORAGE_KEYS.COMPANY_PROFILE, expect.anything());
      expect(storage.setItem).not.toHaveBeenCalledWith(STORAGE_KEYS.SETTINGS, expect.anything());
      expect(storage.setItem).not.toHaveBeenCalledWith(STORAGE_KEYS.SCOPE_TEMPLATES, expect.anything());

      const restoredCustomers = JSON.parse(storage.__store["estipaid-customers-v1"]);
      expect(restoredCustomers).toEqual([
        expect.objectContaining({ id: "cust_1", type: "commercial", companyName: "Acme Co" }),
      ]);

      const restoredProjects = JSON.parse(storage.__store["estipaid-projects-v1"]);
      expect(restoredProjects).toEqual([
        expect.objectContaining({ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }),
      ]);

      const restoredInvoices = JSON.parse(storage.__store["estipaid-invoices-v1"]);
      expect(restoredInvoices).toEqual([
        expect.objectContaining({
          id: "inv_1",
          customerId: "cust_1",
          projectId: "proj_1",
          invoiceNumber: "INV-1",
          estimateNumber: "EST-1",
          invoiceTotal: 1000,
          amountPaid: 250,
          balanceRemaining: 750,
          terms: "Net 30",
          lineItems: [expect.objectContaining({ id: "invoice:inv_1:line:0", description: "Material", price: 1000 })],
          payments: [expect.objectContaining({ id: "pay_1", amount: 250, method: "cash" })],
        }),
      ]);
    });

    test("writer-shaped cloud invoices restore through the real verifier without semantic loss and remain stable on repeat", async () => {
      const actualVerification = jest.requireActual("./supabaseCloudVerification");
      mockRunSupabaseCloudVerification.mockImplementation((options) => actualVerification.runSupabaseCloudVerification(options));
      const restoredEstimate = localEstimateFixture({
        labor: { hazardPct: 5, riskPct: 2, multiplier: 1.25, lines: [] },
        materials: { markupPct: 18, items: [] },
      });
      const cloudRows = fullCloudRows({
        estimates: [cloudEstimateRow({
          restore_payload: {
            schema: "estipaid.estimate.restore_payload",
            version: 1,
            capturedFrom: "localStorage",
            legacyLocalId: "est_1",
            estimate: restoredEstimate,
          },
        })],
        invoices: [cloudInvoiceRow({ estimate_id: "db_est_1", estimate_number: "EST-1", terms: "Net 30" })],
        // Timestamp-shaped, not date-only: this is the shape the writer actually
        // persists, and the shape that used to decay a day per restore.
        invoice_payments: [cloudPaymentRow({ paid_at: "2026-01-15T00:00:00.000Z" })],
        invoice_line_items: [
          cloudInvoiceLineItemRow(),
          cloudInvoiceLineItemRow({
            id: "db_inv_line_2",
            legacy_local_id: "invoice:inv_1:line:1",
            sort_order: 1,
            description: "Labor",
            quantity: 2,
            unit: "hr",
            unit_price: 50,
            total_price: 100,
          }),
        ],
      });
      mockGetSupabaseClient.mockReturnValue(createMockClient({ rowsByTable: cloudRows }));
      const storage = buildWritableStorage();

      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result).toEqual(expect.objectContaining({ status: CLOUD_RESTORE_STATUS.RESTORED, restored: true }));
      expect(result.verification).toEqual(expect.objectContaining({ ok: true, allMatched: true }));
      expect(result.verification.tableResults).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: "invoices", status: "matched" }),
      ]));
      const restoredInvoice = JSON.parse(storage.__store[STORAGE_KEYS.INVOICES])[0];
      expect(restoredInvoice).toEqual(expect.objectContaining({
        id: "inv_1",
        invoiceNumber: "INV-1",
        estimateNumber: "EST-1",
        terms: "Net 30",
        invoiceTotal: 1000,
        amountPaid: 250,
        balanceRemaining: 750,
      }));
      expect(restoredInvoice.lineItems.map((item) => item.id)).toEqual(["invoice:inv_1:line:0", "invoice:inv_1:line:1"]);
      expect(restoredInvoice.payments.map((payment) => payment.id)).toEqual(["pay_1"]);
      // The persisted instant survives as its own UTC calendar date.
      expect(restoredInvoice.payments[0].paidAt).toBe("2026-01-15");

      const passTwo = await actualVerification.runSupabaseCloudVerification({ storageSnapshot: storage, ...baseContext });
      expect(passTwo).toEqual(expect.objectContaining({ ok: true, allMatched: true }));
      expect(JSON.parse(storage.__store[STORAGE_KEYS.INVOICES])).toEqual([restoredInvoice]);

      const changed = { ...restoredInvoice, estimateNumber: "EST-CHANGED" };
      storage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([changed]));
      const negative = await actualVerification.runSupabaseCloudVerification({ storageSnapshot: storage, ...baseContext });
      expect(negative).toEqual(expect.objectContaining({ ok: true, allMatched: false }));
      expect(negative.tableResults).toEqual(expect.arrayContaining([
        expect.objectContaining({ table: "invoices", status: "mismatch", semanticMismatchFields: expect.arrayContaining(["estimate_number"]) }),
      ]));
    });

    test("invoice scope and formatting survive repeated real verification and restoration with $405/$25/$100/$305 unchanged", async () => {
      const { mapLocalInvoiceToBackendInvoice } = require("../utils/backendDataMapper");
      const { normalizeInvoiceRecord } = require("../utils/invoices");
      const { computeTotals } = require("../estimator/engine");
      const { buildParentLineItemContract } = require("./cloudLineItemContract");
      const actualVerification = jest.requireActual("./supabaseCloudVerification");
      mockRunSupabaseCloudVerification.mockImplementation(options => actualVerification.runSupabaseCloudVerification(options));
      const scopeNotes = "  ## Installation\n\n• Install three fixtures — café\n1. Test circuit\n---\n[scope-image:scope-image-1]\n";
      const scopeImages = [{ id: "scope-image-1", dataUrl: "data:image/png;base64,dGVzdA==", caption: "Original caption" }];
      let invoice = {
        id: "inv_1", invoiceNumber: "INV-1", estimateNumber: "EST-1", sourceEstimateId: "est_1",
        customerId: "cust_1", projectId: "proj_1", status: "sent", paymentStatus: "partial",
        invoiceTotal: 405, amountPaid: 100, balanceRemaining: 305,
        date: "2026-01-01", dueDate: "2026-02-01", terms: "Net 30",
        scopeNotes, scopeImages, additionalNotes: "Separate customer note",
        tradeInsert: { key: "electrical", text: "Installation" },
        ui: { materialsMode: "itemized", includeInvoiceScopeOnPdf: true },
        labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [{ id: "l", role: "Technician", qty: 1, hours: 2, rate: 100 }] },
        materials: { markupPct: 0, blanketCost: "", items: [{ id: "m", desc: "Fixture", qty: 3, priceEach: 60 }] },
        additionalCharges: { items: [{ id: "ac", desc: "Service", qty: 1, priceEach: 25 }] },
      };
      const originalNotes = mapLocalInvoiceToBackendInvoice(invoice, {}).notes;
      for (let cycle = 0; cycle < 3; cycle += 1) {
        const mapped = mapLocalInvoiceToBackendInvoice(invoice, {});
        const children = buildParentLineItemContract({ entityType: "invoice", parentLegacyId: "inv_1", parentCloudId: "db_inv_1", parentColumn: "invoice_id", items: mapped.line_items }).rows;
        const rows = fullCloudRows({
          invoices: [cloudInvoiceRow({ total_amount: 405, amount_paid: 100, balance_remaining: 305, notes: mapped.notes })],
          invoice_line_items: children,
          invoice_payments: [cloudPaymentRow({ amount: 100, method: "cash" })],
        });
        mockGetSupabaseClient.mockReturnValue(createMockClient({ rowsByTable: rows }));
        const storage = buildWritableStorage();
        const result = await executeSupabaseCloudRestore({ storage, ...baseContext });
        expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
        expect(result.verification).toMatchObject({ ok: true, allMatched: true });
        invoice = normalizeInvoiceRecord(JSON.parse(storage.__store[STORAGE_KEYS.INVOICES])[0]);
        expect(invoice.scopeNotes).toBe(scopeNotes);
        expect(invoice.scopeImages).toEqual(scopeImages);
        expect(invoice.tradeInsert).toEqual({ key: "electrical", text: "Installation" });
        expect(invoice.ui.includeInvoiceScopeOnPdf).toBe(true);
        expect(invoice.additionalNotes).toBe("Separate customer note");
        expect(mapLocalInvoiceToBackendInvoice(invoice, {}).notes).toBe(originalNotes);
        expect(computeTotals(invoice).totalRevenue).toBe(405);
        expect(invoice.additionalCharges.items).toHaveLength(1);
        expect(invoice.additionalCharges.items[0].priceEach).toBe(25);
        expect(invoice.payments).toHaveLength(1);
        expect(invoice.payments[0].amount).toBe(100);
        expect(invoice.amountPaid).toBe(100);
        expect(invoice.balanceRemaining).toBe(305);

        const changed = { ...invoice, scopeNotes: `${scopeNotes}Meaningful edit` };
        storage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([changed]));
        expect(await actualVerification.runSupabaseCloudVerification({ storageSnapshot: storage, ...baseContext }))
          .toMatchObject({ ok: true, allMatched: false });
      }
    });

    test.each([
      "Legacy ordinary notes",
      '{"schema":"estipaid.invoice.scope","version":2,"scopeNotes":"future"}',
      '{"schema":"estipaid.invoice.scope","version":1,"scopeNotes":7,"notes":"keep"}',
      '{"schema":"estipaid.invoice.scope","version":1',
    ])("legacy, unsupported, or malformed invoice notes are preserved verbatim: %s", async notes => {
      mockGetSupabaseClient.mockReturnValue(createMockClient({ rowsByTable: fullCloudRows({ invoices: [cloudInvoiceRow({ notes })] }) }));
      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });
      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      const invoice = JSON.parse(storage.__store[STORAGE_KEYS.INVOICES])[0];
      expect(invoice.notes).toBe(notes);
      expect(invoice.scopeNotes).toBeUndefined();
    });

    test("keeps reconstructed local records but never reports false restore success when strict verification mismatches", async () => {
      localStorage.clear();
      markCloudBackupDirty({ reason: "pre_restore_stale_marker", domains: ["customers"], severity: "normal" });
      const completedAtBefore = getLastCloudRestoreCompleteAt();
      mockRunSupabaseCloudVerification.mockResolvedValue({
        ok: true,
        allMatched: false,
        availableRepairs: [{ type: "stale_invoice_line_item_empty_placeholders", count: 2 }],
        notices: [{ level: "warning", code: "cloud_verification_mismatch" }],
      });
      const mockClient = createMockClient({ rowsByTable: fullCloudRows() });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const onComplete = jest.fn();
      window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
      try {
        const storage = buildWritableStorage();
        const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

        expect(result.status).toBe(CLOUD_RESTORE_STATUS.RECOVERED_UNVERIFIED);
        expect(result.restored).toBe(false);
        expect(result.localRecoveryApplied).toBe(true);
        expect(result.baselineCaptured).toBe(false);
        expect(result.verification).toMatchObject({ ok: true, allMatched: false });
        expect(JSON.parse(storage.__store[STORAGE_KEYS.INVOICES])).toHaveLength(1);
        expect(JSON.parse(storage.__store[STORAGE_KEYS.CLOUD_SYNC_BASELINE])).toBeNull();
        expect(readCloudBackupQueueState().pending).toBe(true);
        expect(getLastCloudRestoreCompleteAt()).toBe(completedAtBefore);
        expect(onComplete).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
      }
    });

    test("a successful restore clears cloud backup dirty instead of marking it (local now equals cloud)", async () => {
      localStorage.clear();
      markCloudBackupDirty({ reason: "pre_restore_stale_marker", domains: ["customers"], severity: "normal" });
      expect(readCloudBackupQueueState().pending).toBe(true);

      const mockClient = createMockClient({ rowsByTable: fullCloudRows() });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      const queueState = readCloudBackupQueueState();
      expect(queueState.pending).toBe(false);
      expect(queueState.status).toBe(CLOUD_BACKUP_STATUS.CLEAN);
    });

    test("a successful restore dispatches the cloud-restore-complete event so the app shell can navigate Home", async () => {
      const mockClient = createMockClient({ rowsByTable: fullCloudRows() });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const onComplete = jest.fn();
      window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
      try {
        const storage = buildWritableStorage();
        const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

        expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
        expect(onComplete).toHaveBeenCalledTimes(1);
      } finally {
        window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
      }
    });

    test("a failed/blocked restore does not dispatch the cloud-restore-complete event", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({ customers: [cloudCustomerRow({ legacy_local_id: "" })] }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const onComplete = jest.fn();
      window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
      try {
        const storage = buildWritableStorage();
        const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

        expect(result.status).toBe(CLOUD_RESTORE_STATUS.ERROR);
        expect(onComplete).not.toHaveBeenCalled();
      } finally {
        window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
      }
    });

    test("empty-device restore writes company profile, settings, and scope templates when a valid bundle exists", async () => {
      const mockClient = createMockClient({
        rowsByTable: {
          ...fullCloudRows(),
          app_settings: [appRestoreBundleRow()],
        },
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      expect(result.appBundleRestored).toBe(true);
      expect(result.appBundleSummary).toEqual(expect.objectContaining({
        companyProfileCaptured: true,
        logoDataUrlCaptured: true,
        settingsCaptured: true,
        scopeTemplatesCaptured: true,
      }));
      expect(result.notices.some((notice) => notice.code === "supplemental_restore_not_available")).toBe(false);
      expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.COMPANY_PROFILE, expect.any(String));
      expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.SETTINGS, expect.any(String));
      expect(storage.setItem).toHaveBeenCalledWith(STORAGE_KEYS.SCOPE_TEMPLATES, expect.any(String));

      expect(JSON.parse(storage.__store[STORAGE_KEYS.COMPANY_PROFILE])).toEqual(expect.objectContaining({
        companyName: "AAS Property Care",
        logoDataUrl: "data:image/png;base64,abc123",
      }));
      expect(JSON.parse(storage.__store[STORAGE_KEYS.SETTINGS])).toEqual(expect.objectContaining({
        pdf: expect.objectContaining({ includeLogo: true }),
      }));
      expect(JSON.parse(storage.__store[STORAGE_KEYS.SCOPE_TEMPLATES])).toEqual([
        expect.objectContaining({ id: "tmpl_1", name: "Roof Repair" }),
      ]);
    });

    test("reports a partial restore with an estimate blocker but still restores customers/projects/invoices", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          estimates: [{ id: "db_est_1" }],
          estimate_line_items: [{ id: "db_est_line_1" }],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      expect(result.partial).toBe(true);
      expect(result.blockers).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "estimates_not_reconstructable" }),
      ]));
      expect(storage.setItem).toHaveBeenCalledTimes(8);
      expect(storage.setItem).not.toHaveBeenCalledWith("estipaid-estimates-v1", expect.anything());
    });

    test("restores estimates from restore_payload (not display fields) when every cloud estimate has a valid payload", async () => {
      const restoredEstimate = localEstimateFixture({
        estimateNumber: "EST-RESTORE-1",
        docNumber: "EST-RESTORE-1",
        job: { docNumber: "EST-RESTORE-1", location: "Restored job" },
        scopeNotes: "Restored scope notes",
      });
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          estimates: [cloudEstimateRow({
            restore_payload: {
              schema: "estipaid.estimate.restore_payload",
              version: 1,
              capturedFrom: "localStorage",
              legacyLocalId: "est_1",
              estimate: restoredEstimate,
            },
          })],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      expect(result.partial).toBe(false);
      expect(result.blockers).toEqual([]);
      expect(result.restoredCounts).toEqual(expect.objectContaining({ estimates: 1 }));
      expect(storage.setItem).toHaveBeenCalledTimes(9);
      expect(storage.setItem).toHaveBeenCalledWith("estipaid-estimates-v1", expect.any(String));

      const restoredEstimates = JSON.parse(storage.__store["estipaid-estimates-v1"]);
      expect(restoredEstimates).toEqual([
        expect.objectContaining({
          id: "est_1",
          estimateNumber: "EST-RESTORE-1",
          docNumber: "EST-RESTORE-1",
          labor: expect.objectContaining({ hazardPct: 5, riskPct: 2, multiplier: 1.25 }),
          materials: expect.objectContaining({ markupPct: 18 }),
          ui: expect.objectContaining({ materialsMode: "itemized" }),
        }),
      ]);
      expect(restoredEstimates[0].job).toEqual(expect.objectContaining({ docNumber: "EST-RESTORE-1", location: "Restored job" }));
      expect(restoredEstimates[0].scopeNotes).toBe("Restored scope notes");
      const restoredInvoices = JSON.parse(storage.__store["estipaid-invoices-v1"]);
      expect(restoredInvoices[0]).toEqual(expect.objectContaining({ sourceEstimateId: "est_1" }));
      // The display-only field total_amount must not have been used to
      // synthesize labor/materials state -- it should only ever come from
      // the captured restore_payload.estimate object.
      expect(restoredEstimates[0].labor.lines[0].hours).toBe(40);
    });

    test("restores scope images from restore_payload unchanged, including the full 8-photo app limit", async () => {
      const scopeImages = buildScopeImages(8);
      const estimateWithScopeImages = localEstimateFixture({
        scopeNotes: "Repair lobby wall\n[scope-image:scope-image-1]\n[scope-image:scope-image-8]",
        scopeImages,
      });
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          estimates: [cloudEstimateRow({
            restore_payload: {
              schema: "estipaid.estimate.restore_payload",
              version: 1,
              capturedFrom: "localStorage",
              legacyLocalId: "est_1",
              estimate: estimateWithScopeImages,
            },
          })],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      const restoredEstimates = JSON.parse(storage.__store["estipaid-estimates-v1"]);
      expect(restoredEstimates[0].scopeImages).toEqual(scopeImages);
      expect(restoredEstimates[0].scopeImages).toHaveLength(8);
      expect(restoredEstimates[0].scopeNotes).toContain("[scope-image:scope-image-1]");
      expect(restoredEstimates[0].scopeNotes).toContain("[scope-image:scope-image-8]");
      expect(restoredEstimates[0].scopeImages[7]).toEqual(expect.objectContaining({
        id: "scope-image-8",
        dataUrl: expect.stringContaining("data:image/jpeg;base64,scopephoto8"),
      }));
    });

    test("does not restore estimates from display fields alone when restore_payload is missing", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          estimates: [cloudEstimateRow({ restore_payload: null, restore_payload_version: null })],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      expect(result.partial).toBe(true);
      expect(result.restoredCounts).toEqual(expect.objectContaining({ estimates: 0 }));
      expect(storage.setItem).not.toHaveBeenCalledWith("estipaid-estimates-v1", expect.anything());
    });

    test("reports blocked_unsupported_shape and writes nothing when the cloud only has estimates", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows({
          customers: [], projects: [], invoices: [], invoice_payments: [], invoice_line_items: [],
          estimates: [{ id: "db_est_1" }],
          estimate_line_items: [{ id: "db_est_line_1" }],
        }),
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.BLOCKED_UNSUPPORTED_SHAPE);
      expect(result.restored).toBe(false);
      expect(storage.setItem).not.toHaveBeenCalled();
    });
  });

  // Gate 13O-2J: the downloadable source:"cloud" backup artifact.
  describe("exportSupabaseCloudBackupArtifact", () => {
    test("blocks at signed_out without touching Supabase", async () => {
      const result = await exportSupabaseCloudBackupArtifact({
        configured: false,
        user: null,
        company: null,
      });

      expect(result.status).toBe(CLOUD_BACKUP_EXPORT_STATUS.SIGNED_OUT);
      expect(result.artifact).toBeNull();
      expect(result.error).toContain("Sign in");
      expect(mockGetSupabaseClient).not.toHaveBeenCalled();
    });

    test("blocks at no_workspace when there is no company", async () => {
      const result = await exportSupabaseCloudBackupArtifact({
        ...baseContext,
        company: null,
      });

      expect(result.status).toBe(CLOUD_BACKUP_EXPORT_STATUS.NO_WORKSPACE);
      expect(result.artifact).toBeNull();
    });

    test("exports a source:'cloud' artifact with correct counts and locally-shaped records", async () => {
      const mockClient = createMockClient({
        rowsByTable: {
          ...fullCloudRows({ estimates: [cloudEstimateRow()], estimate_line_items: [{ id: "db_est_line_1" }] }),
          app_settings: [appRestoreBundleRow()],
        },
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await exportSupabaseCloudBackupArtifact(baseContext);

      expect(result.status).toBe(CLOUD_BACKUP_EXPORT_STATUS.EXPORTED);
      expect(result.noWritesPerformed).toBe(true);

      const artifact = result.artifact;
      expect(artifact.source).toBe("cloud");
      expect(artifact.artifactVersion).toBe(CLOUD_BACKUP_EXPORT_ARTIFACT_VERSION);
      expect(artifact.companyId).toBe("company_1");
      expect(artifact.counts).toEqual({
        customers: 1,
        projects: 1,
        estimates: 1,
        estimateLineItems: 1,
        invoices: 1,
        invoiceLineItems: 1,
        invoicePayments: 1,
        scopeTemplates: 1,
      });
      expect(artifact.restorePayloadCoverage).toEqual({
        totalEstimates: 1,
        estimatesWithRestorePayload: 1,
        estimatesMissingRestorePayload: 0,
      });

      // Records are already mapped to the local app storage shape.
      expect(artifact.records.customers[0]).toEqual(expect.objectContaining({ id: "cust_1", type: "commercial", companyName: "Acme Co" }));
      expect(artifact.records.projects[0]).toEqual(expect.objectContaining({ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }));
      expect(artifact.records.invoices[0]).toEqual(expect.objectContaining({
        id: "inv_1",
        invoiceNumber: "INV-1",
        lineItems: [expect.objectContaining({ description: "Material" })],
        payments: [expect.objectContaining({ id: "pay_1", amount: 250 })],
      }));
      // Estimates come verbatim from restore_payload, pinned to legacy id.
      expect(artifact.records.estimates[0]).toEqual(expect.objectContaining({
        id: "est_1",
        labor: expect.objectContaining({ hazardPct: 5, riskPct: 2, multiplier: 1.25 }),
      }));
      expect(artifact.records.companyProfile).toEqual(expect.objectContaining({ companyName: "AAS Property Care" }));
      expect(artifact.records.scopeTemplates).toEqual([expect.objectContaining({ id: "tmpl_1" })]);
      expect(artifact.optionalSections.appRestoreBundle).toBe("available");
    });

    test("fails clearly with the failing table and never produces a 'successful' empty artifact", async () => {
      const mockClient = createMockClient({
        rowsByTable: fullCloudRows(),
        rowErrorsByTable: { customers: { message: "permission denied for table customers" } },
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await exportSupabaseCloudBackupArtifact(baseContext);

      expect(result.status).toBe(CLOUD_BACKUP_EXPORT_STATUS.ERROR);
      expect(result.artifact).toBeNull();
      expect(result.failedTable).toBe("customers");
      expect(result.error).toContain("Unable to read customers from Supabase");
    });

    test("excludes payload-less estimates from records, reports coverage, and never guesses estimate math", async () => {
      const mockClient = createMockClient({
        rowsByTable: {
          ...fullCloudRows({
            estimates: [
              cloudEstimateRow(),
              cloudEstimateRow({ id: "db_est_2", legacy_local_id: "est_2", restore_payload: null, restore_payload_version: null }),
            ],
          }),
          app_settings: [],
        },
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await exportSupabaseCloudBackupArtifact(baseContext);

      expect(result.status).toBe(CLOUD_BACKUP_EXPORT_STATUS.EXPORTED);
      expect(result.artifact.counts.estimates).toBe(2);
      expect(result.artifact.restorePayloadCoverage).toEqual({
        totalEstimates: 2,
        estimatesWithRestorePayload: 1,
        estimatesMissingRestorePayload: 1,
      });
      expect(result.artifact.records.estimates).toHaveLength(1);
      expect(result.artifact.records.estimates[0].id).toBe("est_1");
      expect(result.artifact.notices).toEqual(expect.arrayContaining([
        expect.objectContaining({ code: "estimates_missing_restore_payload_excluded" }),
      ]));
    });

    test("marks the app restore bundle optional section missing without failing the export", async () => {
      const mockClient = createMockClient({
        rowsByTable: { ...fullCloudRows(), app_settings: [] },
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await exportSupabaseCloudBackupArtifact(baseContext);

      expect(result.status).toBe(CLOUD_BACKUP_EXPORT_STATUS.EXPORTED);
      expect(result.artifact.optionalSections.appRestoreBundle).toBe("missing");
      expect(result.artifact.records.companyProfile).toBeNull();
      expect(result.artifact.records.settings).toBeNull();
    });
  });
});

const { readCloudAssetBindings, CLOUD_ASSET_BINDINGS_KEY } = require("./cloudAssetBindings");
const { tryAcquireCloudOperationRunLock, resetCloudOperationRunLockForTests } = require("./cloudOperationRunLock");
const { CLOUD_OPERATION_OWNER } = require("./cloudOperationOwnership");

describe("executeSupabaseCloudRestore — shared run lock", () => {
  afterEach(() => resetCloudOperationRunLockForTests());

  test("refuses to begin while the existing convergence/backup lock owns local mutation access", async () => {
    expect(tryAcquireCloudOperationRunLock(CLOUD_OPERATION_OWNER.BACKUP)).toBeTruthy();
    const storage = buildWritableStorage();

    const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

    expect(result.status).toBe(CLOUD_RESTORE_STATUS.RUN_LOCK_BUSY);
    expect(result.noWritesPerformed).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});

describe("executeSupabaseCloudRestore — cloud asset binding capture", () => {
  const U = {
    cust: "aaaa1111-0000-4000-8000-000000000001",
    proj: "aaaa1111-0000-4000-8000-000000000002",
    est: "aaaa1111-0000-4000-8000-000000000003",
    inv: "aaaa1111-0000-4000-8000-000000000004",
    pay: "aaaa1111-0000-4000-8000-000000000005",
  };

  function uuidCloudRows() {
    return fullCloudRows({
      customers: [cloudCustomerRow({ id: U.cust })],
      projects: [cloudProjectRow({ id: U.proj, customer_id: U.cust })],
      estimates: [cloudEstimateRow({ id: U.est, customer_id: U.cust, project_id: U.proj })],
      invoices: [cloudInvoiceRow({ id: U.inv, customer_id: U.cust, project_id: U.proj })],
      invoice_payments: [cloudPaymentRow({ id: U.pay, invoice_id: U.inv })],
      invoice_line_items: [cloudInvoiceLineItemRow({ invoice_id: U.inv })],
    });
  }

  beforeEach(() => {
    localStorage.clear();
    mockRunSupabaseCloudVerification.mockReset();
    mockRunSupabaseCloudVerification.mockResolvedValue({
      ok: true,
      allMatched: true,
      availableRepairs: [],
      notices: [],
    });
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
    mockEnsureCurrentDeviceCanWriteCloud.mockReset();
    mockEnsureCurrentDeviceCanWriteCloud.mockResolvedValue(restoreAccessOk());
    mockEnsureCurrentDeviceCanApplyLocalRestore.mockReset();
    mockEnsureCurrentDeviceCanApplyLocalRestore.mockResolvedValue(restoreAccessOk());
  });

  test("a successful restore binds every restored record to its cloud UUID (source cloud_restore)", async () => {
    mockGetSupabaseClient.mockReturnValue(createMockClient({ rowsByTable: uuidCloudRows() }));
    const storage = buildWritableStorage();

    const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

    expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
    expect(result.assetBindingCapture).toMatchObject({ ok: true, written: 5 });

    const state = readCloudAssetBindings("company_1");
    expect(state.bindings.customer.cust_1).toMatchObject({ cloudUuid: U.cust, source: "cloud_restore" });
    expect(state.bindings.project.proj_1).toMatchObject({ cloudUuid: U.proj });
    expect(state.bindings.estimate.est_1).toMatchObject({ cloudUuid: U.est });
    expect(state.bindings.invoice.inv_1).toMatchObject({ cloudUuid: U.inv });
    expect(state.bindings.invoice_payment.pay_1).toMatchObject({ cloudUuid: U.pay });
  });

  test("a blocked restore (local not empty) writes no bindings", async () => {
    mockGetSupabaseClient.mockReturnValue(createMockClient({ rowsByTable: uuidCloudRows() }));
    const storage = buildWritableStorage({
      [STORAGE_KEYS.CUSTOMERS]: JSON.stringify([{ id: "cust_local_x", type: "residential", fullName: "Existing" }]),
    });

    const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

    expect(result.status).toBe(CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY);
    expect(storage.setItem).not.toHaveBeenCalled();
    // No sidecar was written at all.
    expect(localStorage.getItem(CLOUD_ASSET_BINDINGS_KEY)).toBeNull();
  });

  test("non-UUID cloud ids are skipped and never fail the restore", async () => {
    // The default fixtures use non-UUID ids like "db_cust_1".
    mockGetSupabaseClient.mockReturnValue(createMockClient({ rowsByTable: fullCloudRows() }));
    const storage = buildWritableStorage();

    const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

    expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
    // Capture ran but wrote nothing (all ids failed UUID validation).
    expect(result.assetBindingCapture).toMatchObject({ written: 0 });
    expect(readCloudAssetBindings("company_1").bindings.customer).toEqual({});
  });
});

// Gate 16B: invoice line-item cloud round-trip stress. For every valid child the
// canonical cloud contract must survive: cloud row -> restored local child ->
// backend draft -> expected cloud row, identical on identity + all fields.
describe("invoice line-item round trip preserves the canonical child contract", () => {
  const { mapCloudInvoiceLineItem } = require("./supabaseCloudRestore");
  const { buildParentLineItemContract, compareRestoredLineItemOrder } = require("./cloudLineItemContract");
  const { mapLocalInvoiceToBackendInvoice } = require("../utils/backendDataMapper");

  const CANONICAL_FIELDS = ["legacy_local_id", "invoice_id", "sort_order", "description", "quantity", "unit", "unit_price", "total_price", "metadata"];
  const canonical = (rows) => rows.map((row) => CANONICAL_FIELDS.reduce((out, f) => ({ ...out, [f]: row[f] ?? null }), {}));

  function roundTrip(backendChildren) {
    const cloud1 = buildParentLineItemContract({ entityType: "invoice", parentLegacyId: "inv-x", parentCloudId: "db-inv-x", parentColumn: "invoice_id", items: backendChildren })
      .rows.map((row, i) => ({ id: `db-il-${i}`, ...row }));
    // Restore: deterministic ordering + faithful field mapping.
    const localChildren = cloud1.map((r, i) => ({ ...r, __fetchPos: i })).sort(compareRestoredLineItemOrder).map(mapCloudInvoiceLineItem);
    const backend2 = mapLocalInvoiceToBackendInvoice({ id: "inv-x", customerId: "c", projectId: "p", lineItems: localChildren, payments: [] }, {}).line_items;
    const cloud2 = buildParentLineItemContract({ entityType: "invoice", parentLegacyId: "inv-x", parentCloudId: "db-inv-x", parentColumn: "invoice_id", items: backend2 }).rows;
    return { cloud1, cloud2 };
  }

  test.each([
    ["labor child with unit cost", [{ kind: "labor", sort_order: 0, description: "Framing", quantity: 2, unit: "hr", unit_price: 75, total: 150, unit_cost: 45 }]],
    ["material child with unit cost", [{ kind: "material", sort_order: 0, description: "Lumber", quantity: 10, unit: "ea", unit_price: 12.5, total: 125, unit_cost: 8 }]],
    ["generic invoice child", [{ kind: "invoice", sort_order: 0, description: "Permit", quantity: 1, unit_price: 60, total: 60 }]],
    ["duplicate source sort orders across kinds", [
      { kind: "labor", sort_order: 0, description: "L0", quantity: 1, unit: "hr", unit_price: 50, total: 50, unit_cost: 30 },
      { kind: "labor", sort_order: 1, description: "L1", quantity: 1, unit: "hr", unit_price: 55, total: 55, unit_cost: 33 },
      { kind: "material", sort_order: 0, description: "M0", quantity: 2, unit: "ea", unit_price: 10, total: 20, unit_cost: 6 },
      { kind: "material", sort_order: 1, description: "M1", quantity: 1, unit: "box", unit_price: 15, total: 15, unit_cost: 9 },
      { kind: "invoice", sort_order: 2, description: "G2", quantity: 1, unit_price: 12, total: 12 },
    ]],
    ["missing sort order", [{ kind: "material", description: "No sort", quantity: 1, unit: "ea", unit_price: 9, total: 9, unit_cost: 4 }]],
    ["nonempty unit and decimal quantity/price", [{ kind: "material", sort_order: 0, description: "Paint", quantity: 1.5, unit: "gal", unit_price: 39.99, total: 59.99, unit_cost: 22.5 }]],
    ["null optional values", [{ kind: "invoice", sort_order: 0, description: "Bare", quantity: null, unit: null, unit_price: null, total: null }]],
  ])("round-trips: %s", (_label, backendChildren) => {
    const { cloud1, cloud2 } = roundTrip(backendChildren);
    expect(canonical(cloud2)).toEqual(canonical(cloud1));
  });

  test("a malformed deterministic legacy id falls back safely and still restores every child", () => {
    // Cloud rows whose legacy ids cannot be parsed still map to local children.
    const rows = [
      { id: "a", invoice_id: "db-inv-x", legacy_local_id: "not-canonical", sort_order: 1, description: "B", quantity: 1, unit: "ea", unit_price: 2, total_price: 2, metadata: { kind: "material", unit_cost: 1 } },
      { id: "b", invoice_id: "db-inv-x", legacy_local_id: "also-weird", sort_order: 0, description: "A", quantity: 1, unit: "ea", unit_price: 3, total_price: 3, metadata: { kind: "labor", unit_cost: 2 } },
    ];
    const local = rows.map((r, i) => ({ ...r, __fetchPos: i })).sort(compareRestoredLineItemOrder).map(mapCloudInvoiceLineItem);
    // Fallback ordering: finite sort_order ascending -> "A" (0) before "B" (1).
    expect(local.map((c) => c.description)).toEqual(["A", "B"]);
    expect(local.every((c) => c.kind && Number.isFinite(c.unitCost))).toBe(true);
  });
});

describe("mapCloudProjectToLocal customerless projects (Gate 16D)", () => {
  const { mapCloudProjectToLocal } = require("./supabaseCloudRestore");

  test("a cloud project with customer_id null restores as customerId ''", () => {
    const byCloudId = new Map([["db-cust-1", "cust-1"]]);
    expect(mapCloudProjectToLocal({ id: "db-p1", legacy_local_id: "proj-cl", customer_id: null, project_name: "Unassigned" }, byCloudId).customerId).toBe("");
    // An assigned project resolves its cloud customer id back to the local id.
    expect(mapCloudProjectToLocal({ id: "db-p2", legacy_local_id: "proj-1", customer_id: "db-cust-1", project_name: "Assigned" }, byCloudId).customerId).toBe("cust-1");
  });
});

// Gate E2 / E2.2 -- in-flight convergence-snapshot coordinator. Proves that
// overlapping direct reads for the same client+company share ONE complete scan
// without ever caching a completed snapshot or crossing client/company bounds.
//
// A COMPLETE snapshot performs EIGHT PostgREST requests: one GET for each of the
// seven business tables PLUS one GET for app_settings (the restore-bundle read
// via readExistingBundleRows). The coordinator here is a defensive guarantee for
// concurrent DIRECT reader calls sharing one Supabase client identity + company
// id; the real backup and convergence workers are serialized by
// cloudOperationRunLock and lifecycle bursts are coalesced in useCloudAutoConvergence.
describe("readSupabaseCloudConvergenceSnapshot in-flight coordinator (Gate E2.2)", () => {
  const { readSupabaseCloudConvergenceSnapshot } = require("./supabaseCloudRestore");

  // The seven business tables a single snapshot scan reads (one GET each).
  const BUSINESS_TABLES = ["customers", "projects", "estimates", "invoices", "invoice_payments", "estimate_line_items", "invoice_line_items"];
  // The eighth request of a complete snapshot: the app_settings restore-bundle read.
  const APP_SETTINGS_TABLE = "app_settings";
  // One complete snapshot = 7 business-table GETs + 1 app_settings GET = 8.
  const COMPLETE_SNAPSHOT_REQUESTS = BUSINESS_TABLES.length + 1;

  const READ_ARGS = (client, companyId = "company_1") => ({
    configured: true,
    user: { id: "user_1" },
    company: { id: companyId },
    client,
  });

  // Every `.from(table)` call === one PostgREST GET.
  const getsFor = (client, table) => client.from.mock.calls.filter((c) => c[0] === table).length;
  const totalGets = (client) => client.from.mock.calls.length;

  test("two simultaneous same-client/same-company reads share one 8-request scan (16 -> 8)", async () => {
    const client = createMockClient({ rowsByTable: {} });
    const p1 = readSupabaseCloudConvergenceSnapshot(READ_ARGS(client));
    const p2 = readSupabaseCloudConvergenceSnapshot(READ_ARGS(client));
    const [r1, r2] = await Promise.all([p1, p2]);

    // Same resolved snapshot object -> the second caller joined the in-flight read.
    expect(r1).toBe(r2);
    // Two independent callers would issue 16 requests (8 each); shared -> 8.
    BUSINESS_TABLES.forEach((table) => expect(getsFor(client, table)).toBe(1));
    expect(getsFor(client, APP_SETTINGS_TABLE)).toBe(1);
    expect(totalGets(client)).toBe(COMPLETE_SNAPSHOT_REQUESTS); // 8, not 16
  });

  test("a single complete scan issues exactly eight requests (7 business tables + app_settings)", async () => {
    const client = createMockClient({ rowsByTable: {} });
    await readSupabaseCloudConvergenceSnapshot(READ_ARGS(client));
    BUSINESS_TABLES.forEach((table) => expect(getsFor(client, table)).toBe(1));
    expect(getsFor(client, APP_SETTINGS_TABLE)).toBe(1);
    expect(totalGets(client)).toBe(COMPLETE_SNAPSHOT_REQUESTS); // exactly 8
  });

  test("convergence evidence carries estimate_date while restoration remains verbatim from restore_payload", async () => {
    const row = cloudEstimateRow({ estimate_date: "2026-06-27" });
    row.restore_payload = {
      ...row.restore_payload,
      estimate: localEstimateFixture({ date: "2026-06-26" }),
    };
    const client = createMockClient({ rowsByTable: fullCloudRows({ estimates: [row] }) });

    const result = await readSupabaseCloudConvergenceSnapshot(READ_ARGS(client));

    expect(result).toEqual(expect.objectContaining({ ok: true, status: "ready", noWritesPerformed: true }));
    expect(result.mapped.estimates[0].date).toBe("2026-06-26");
    expect(result.estimateEvidence.est_1.persisted.estimate_date).toBe("2026-06-27");
    expect(result.estimateEvidence.est_1.restorePayload.estimate.date).toBe("2026-06-26");
  });

  test("a second read after completion performs a brand-new 8-request scan (no completed-result cache)", async () => {
    const client = createMockClient({ rowsByTable: {} });
    await readSupabaseCloudConvergenceSnapshot(READ_ARGS(client));
    expect(totalGets(client)).toBe(COMPLETE_SNAPSHOT_REQUESTS);

    // A later logical operation must re-read the cloud, not reuse the old snapshot.
    await readSupabaseCloudConvergenceSnapshot(READ_ARGS(client));
    BUSINESS_TABLES.forEach((table) => expect(getsFor(client, table)).toBe(2));
    expect(getsFor(client, APP_SETTINGS_TABLE)).toBe(2);
    expect(totalGets(client)).toBe(COMPLETE_SNAPSHOT_REQUESTS * 2); // 16 across two fresh scans
  });

  test("a business-table read that fails before completion does NOT require eight requests and clears the coordinator", async () => {
    const badClient = createMockClient({ rowErrorsByTable: { customers: { message: "boom" } } });
    // Overlapping failing reads still share the single in-flight attempt.
    const [e1, e2] = await Promise.all([
      readSupabaseCloudConvergenceSnapshot(READ_ARGS(badClient)),
      readSupabaseCloudConvergenceSnapshot(READ_ARGS(badClient)),
    ]);
    expect(e1.ok).toBe(false);
    expect(e1).toBe(e2);
    // Early-exit: the loop returns on the first failing business table, so it
    // never reaches the remaining tables or the app_settings read.
    expect(getsFor(badClient, "customers")).toBe(1);
    expect(getsFor(badClient, APP_SETTINGS_TABLE)).toBe(0);
    expect(totalGets(badClient)).toBeLessThan(COMPLETE_SNAPSHOT_REQUESTS);

    // The failure must NOT poison the coordinator -- a subsequent read tries again.
    await readSupabaseCloudConvergenceSnapshot(READ_ARGS(badClient));
    expect(getsFor(badClient, "customers")).toBe(2);
  });

  test("different companies never share a Promise or a result (two independent 8-request scans)", async () => {
    const client = createMockClient({ rowsByTable: {} });
    const p1 = readSupabaseCloudConvergenceSnapshot(READ_ARGS(client, "company_A"));
    const p2 = readSupabaseCloudConvergenceSnapshot(READ_ARGS(client, "company_B"));
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).not.toBe(r2);
    // Each company triggered its own complete 8-request scan.
    BUSINESS_TABLES.forEach((table) => expect(getsFor(client, table)).toBe(2));
    expect(getsFor(client, APP_SETTINGS_TABLE)).toBe(2);
    expect(totalGets(client)).toBe(COMPLETE_SNAPSHOT_REQUESTS * 2);
  });

  test("different clients never share a Promise or a result", async () => {
    const clientA = createMockClient({ rowsByTable: {} });
    const clientB = createMockClient({ rowsByTable: {} });
    const [rA, rB] = await Promise.all([
      readSupabaseCloudConvergenceSnapshot(READ_ARGS(clientA)),
      readSupabaseCloudConvergenceSnapshot(READ_ARGS(clientB)),
    ]);

    expect(rA).not.toBe(rB);
    expect(totalGets(clientA)).toBe(COMPLETE_SNAPSHOT_REQUESTS);
    expect(totalGets(clientB)).toBe(COMPLETE_SNAPSHOT_REQUESTS);
  });

  test("a fresh convergence read after an earlier completed scan sees newly-changed remote rows", async () => {
    // First scan: empty cloud.
    const clientEmpty = createMockClient({ rowsByTable: {} });
    const first = await readSupabaseCloudConvergenceSnapshot(READ_ARGS(clientEmpty));
    expect(first.counts.customers).toBe(0);

    // A later accepted convergence must reflect remote changes made in the interim.
    const clientChanged = createMockClient({ rowsByTable: { customers: [cloudCustomerRow()] } });
    const second = await readSupabaseCloudConvergenceSnapshot(READ_ARGS(clientChanged));
    expect(second.counts.customers).toBe(1);
  });
});

// START-FENCE: restore is a long, multi-stage operation whose every later
// boundary previously asked only "is this device active NOW?". That question is
// answered YES by A(v5) -> B(v6) -> A(v7): the same browser lost the workspace
// and took it back, so its in-flight restore is operating on a cloud read from a
// generation that has since been superseded. Each test below drives the run to a
// specific fenced boundary and proves the forbidden side effect did not happen.
describe("executeSupabaseCloudRestore START fence", () => {
  const fenceA5 = { companyId: "company_1", deviceId: "device-a", lockVersion: 5 };
  const fenceA7 = { companyId: "company_1", deviceId: "device-a", lockVersion: 7 };
  const fenceB6 = { companyId: "company_1", deviceId: "device-b", lockVersion: 6 };
  const okAt = (fence) => ({ ok: true, access: { isActive: true, isLocked: false, fence }, error: "" });

  // Drives the four ownership reads in order:
  // apply -> baseline capture -> queue clear -> restore complete.
  function stageFences(fences) {
    mockEnsureCurrentDeviceCanApplyLocalRestore.mockReset();
    fences.forEach((fence) => mockEnsureCurrentDeviceCanApplyLocalRestore.mockResolvedValueOnce(okAt(fence)));
    mockEnsureCurrentDeviceCanApplyLocalRestore.mockResolvedValue(okAt(fences[fences.length - 1]));
  }

  beforeEach(() => {
    localStorage.clear();
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(createMockClient({ rowsByTable: fullCloudRows() }));
    mockEnsureCurrentDeviceCanWriteCloud.mockReset();
    mockEnsureCurrentDeviceCanWriteCloud.mockResolvedValue(okAt(fenceA5));
    mockEnsureCurrentDeviceCanApplyLocalRestore.mockReset();
    mockEnsureCurrentDeviceCanApplyLocalRestore.mockResolvedValue(okAt(fenceA5));
    mockRunSupabaseCloudVerification.mockReset();
    mockRunSupabaseCloudVerification.mockResolvedValue({ ok: true, allMatched: true, availableRepairs: [], notices: [] });
    markCloudBackupDirty({ reason: "restore_fence_probe", domains: ["customers"], severity: "normal" });
  });

  test("a same-owner heartbeat keeps the same generation and still restores", async () => {
    // A heartbeat by the current owner does not advance lockVersion, so every
    // boundary sees v5 and the restore must complete exactly as before.
    stageFences([fenceA5, fenceA5, fenceA5, fenceA5]);
    const onComplete = jest.fn();
    window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
    try {
      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
      expect(result.baselineCaptured).toBe(true);
      expect(readCloudBackupQueueState().pending).toBe(false);
      expect(onComplete).toHaveBeenCalled();
    } finally {
      window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
    }
  });

  test("a takeover reported as still-active cannot overwrite local data", async () => {
    // Defence in depth: even if the ownership read optimistically answers ok,
    // a fence naming ANOTHER device is not the generation this run started under.
    stageFences([fenceB6]);

    const storage = buildWritableStorage();
    const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

    expect(result.status).toBe(CLOUD_RESTORE_STATUS.DEVICE_LOCKED);
    // The destructive batch is the forbidden side effect here.
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(readCloudBackupQueueState().pending).toBe(true);
  });

  test("A(v5) -> B(v6) -> A(v7) cannot overwrite local data at the apply boundary", async () => {
    stageFences([fenceA7]);

    const storage = buildWritableStorage();
    const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

    expect(result.status).toBe(CLOUD_RESTORE_STATUS.DEVICE_LOCKED);
    expect(result.deviceLockLost).toBe(true);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(readCloudBackupQueueState().pending).toBe(true);
  });

  test("A(v5) -> B(v6) -> A(v7) cannot capture a verified baseline after verification", async () => {
    // The generation moves while the async strict verification is running.
    stageFences([fenceA5, fenceA5, fenceA7]);
    const onComplete = jest.fn();
    window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
    try {
      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      // It reached the fenced boundary: verification actually ran.
      expect(mockRunSupabaseCloudVerification).toHaveBeenCalledTimes(1);
      expect(result.status).toBe(CLOUD_RESTORE_STATUS.DEVICE_LOCKED);
      // FORBIDDEN: no durable baseline, no queue clear, no completion signal.
      expect(storage.setItem.mock.calls.filter(([key]) => key === STORAGE_KEYS.CLOUD_SYNC_BASELINE)
        .every(([, value]) => JSON.parse(value) === null)).toBe(true);
      expect(readCloudBackupQueueState().pending).toBe(true);
      expect(onComplete).not.toHaveBeenCalled();
      // The local write it already performed is reported honestly.
      expect(result.noWritesPerformed).toBe(false);
    } finally {
      window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
    }
  });

  test("A(v5) -> B(v6) -> A(v7) cannot clear the backup queue", async () => {
    stageFences([fenceA5, fenceA5, fenceA7]);
    const onComplete = jest.fn();
    window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
    try {
      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).toBe(CLOUD_RESTORE_STATUS.DEVICE_LOCKED);
      // FORBIDDEN: the pending-mutation record survives.
      expect(readCloudBackupQueueState().pending).toBe(true);
      expect(onComplete).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
    }
  });

  test("A(v5) -> B(v6) -> A(v7) cannot publish RESTORED or the complete event", async () => {
    stageFences([fenceA5, fenceA5, fenceA5, fenceA7]);
    const onComplete = jest.fn();
    window.addEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
    try {
      const storage = buildWritableStorage();
      const result = await executeSupabaseCloudRestore({ storage, ...baseContext });

      expect(result.status).not.toBe(CLOUD_RESTORE_STATUS.RESTORED);
      expect(result.status).toBe(CLOUD_RESTORE_STATUS.DEVICE_LOCKED);
      // FORBIDDEN: the settled-device signal the rest of the app keys off.
      expect(onComplete).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener(CLOUD_RESTORE_COMPLETE_EVENT, onComplete);
    }
  });
});

// PAYMENT DATE DECAY.
//
// Restore used to hand `paid_at` through verbatim, and the local invoice
// normalizer then read it with the LOCAL calendar (getFullYear/getMonth/
// getDate). West of UTC that turned a persisted midnight-UTC instant into the
// previous day, which the backend mapper wrote back as a new midnight-UTC
// instant -- so every cloud -> local -> cloud cycle walked the payment one more
// day backwards. These run under a fixed negative offset so the regression is
// reproducible regardless of where the suite executes.
describe("invoice payment date is a restore/backup fixed point", () => {
  const { mapLocalInvoicePaymentToBackendPayment } = require("../utils/backendDataMapper");
  const PHOENIX_OFFSET_MINUTES = 7 * 60; // UTC-7, the offset that exposed this.
  let realGetTimezoneOffset;

  beforeEach(() => {
    localStorage.clear();
    mockGetSupabaseClient.mockReset();
    mockEnsureCurrentDeviceCanWriteCloud.mockReset();
    mockEnsureCurrentDeviceCanWriteCloud.mockResolvedValue(restoreAccessOk());
    mockEnsureCurrentDeviceCanApplyLocalRestore.mockReset();
    mockEnsureCurrentDeviceCanApplyLocalRestore.mockResolvedValue(restoreAccessOk());
    mockRunSupabaseCloudVerification.mockReset();
    mockRunSupabaseCloudVerification.mockResolvedValue({ ok: true, allMatched: true, availableRepairs: [], notices: [] });

    realGetTimezoneOffset = Date.prototype.getTimezoneOffset;
    // eslint-disable-next-line no-extend-native
    Date.prototype.getTimezoneOffset = function getTimezoneOffset() { return PHOENIX_OFFSET_MINUTES; };
  });

  afterEach(() => {
    // eslint-disable-next-line no-extend-native
    Date.prototype.getTimezoneOffset = realGetTimezoneOffset;
  });

  async function restorePaymentWith(paidAt) {
    mockGetSupabaseClient.mockReturnValue(createMockClient({
      rowsByTable: fullCloudRows({ invoice_payments: [cloudPaymentRow({ paid_at: paidAt })] }),
    }));
    const storage = buildWritableStorage();
    const result = await executeSupabaseCloudRestore({ storage, ...baseContext });
    expect(result.status).toBe(CLOUD_RESTORE_STATUS.RESTORED);
    const invoice = JSON.parse(storage.__store[STORAGE_KEYS.INVOICES])[0];
    return { invoice, payment: invoice.payments[0] };
  }

  test("1 -- a midnight-UTC timestamp restores as its own UTC calendar date", async () => {
    const { payment } = await restorePaymentWith("2026-08-10T00:00:00+00:00");
    expect(payment.paidAt).toBe("2026-08-10");
  });

  test("2 -- a date-only value is unchanged", async () => {
    const { payment } = await restorePaymentWith("2026-08-10");
    expect(payment.paidAt).toBe("2026-08-10");
  });

  test("3 -- the real cloud -> local -> cloud cycle is a fixed point over 5 rounds", async () => {
    let persisted = "2026-08-10T00:00:00.000Z";

    for (let cycle = 0; cycle < 5; cycle += 1) {
      // eslint-disable-next-line no-await-in-loop
      const { invoice, payment } = await restorePaymentWith(persisted);
      expect(payment.paidAt).toBe("2026-08-10");

      // Back out through the EXISTING backend payment mapper.
      persisted = mapLocalInvoicePaymentToBackendPayment(payment, invoice, {}).paid_at;
      expect(persisted).toBe("2026-08-10T00:00:00.000Z");
    }
  });

  test("4 -- different payment days remain different", async () => {
    const tenth = await restorePaymentWith("2026-08-10T00:00:00.000Z");
    const first = await restorePaymentWith("2026-08-01T00:00:00.000Z");

    expect(tenth.payment.paidAt).toBe("2026-08-10");
    expect(first.payment.paidAt).toBe("2026-08-01");
    expect(tenth.payment.paidAt).not.toBe(first.payment.paidAt);
  });

  test("5 -- payment identity, amount, method and status are untouched", async () => {
    const { payment } = await restorePaymentWith("2026-08-10T00:00:00.000Z");
    expect(payment).toEqual(expect.objectContaining({
      id: "pay_1",
      amount: 250,
      method: "cash",
      status: "paid",
    }));
  });
});
