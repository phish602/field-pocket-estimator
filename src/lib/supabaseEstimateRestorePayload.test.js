const mockGetSupabaseClient = jest.fn();

jest.mock("./supabaseClient", () => ({
  getSupabaseClient: (...args) => mockGetSupabaseClient(...args),
}));

const {
  buildEstimateRestorePayload,
  updateEstimateRestorePayloads,
  ESTIMATE_PAYLOAD_UPDATE_STATUS,
  ESTIMATE_RESTORE_PAYLOAD_SCHEMA,
  ESTIMATE_RESTORE_PAYLOAD_VERSION,
} = require("./supabaseEstimateRestorePayload");

function buildStorageSnapshot({ estimates } = {}) {
  const values = {
    "estipaid-company-profile-v1": JSON.stringify({ id: "local_company", companyName: "AAS Property Care" }),
    "estipaid-customers-v1": JSON.stringify([]),
    "estipaid-projects-v1": JSON.stringify([]),
    "estipaid-estimates-v1": JSON.stringify(estimates || []),
    "estipaid-invoices-v1": JSON.stringify([]),
    "estipaid-settings-v1": JSON.stringify({}),
    "estipaid-scope-templates-v1": JSON.stringify([]),
    "estipaid-audit-events-v1": JSON.stringify([]),
  };
  return { getItem: (key) => (Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null) };
}

function localEstimateFixture(overrides = {}) {
  return {
    id: "est_1",
    projectId: "proj_1",
    customerId: "cust_1",
    estimateNumber: "EST-1",
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
      blanketCost: "",
      items: [{ id: "m1", desc: "Panel", qty: 1, unitCostInternal: 400000, costInternal: 400000, priceEach: 1200000 }],
    },
    ui: { materialsMode: "itemized" },
    ...overrides,
  };
}

function createMockClient({ cloudRows = [], readError = null, updateResponses = {} } = {}) {
  const updateCalls = [];
  const eqCallsByUpdate = [];

  const from = jest.fn((table) => ({
    select: jest.fn((columns) => {
      // Initial "read cloud estimates" call shape: select("id, legacy_local_id").eq("company_id", X)
      return {
        eq: jest.fn(async () => {
          if (readError) return { data: null, error: readError };
          return { data: cloudRows, error: null };
        }),
      };
    }),
    update: jest.fn((values) => {
      const callRecord = { table, values, eqs: [] };
      updateCalls.push(callRecord);
      const chain = {
        eq: jest.fn((col, val) => {
          callRecord.eqs.push([col, val]);
          return chain;
        }),
        select: jest.fn(async (cols) => {
          const legacyId = callRecord.eqs.find(([c]) => c === "legacy_local_id")?.[1];
          if (Object.prototype.hasOwnProperty.call(updateResponses, legacyId)) {
            return updateResponses[legacyId];
          }
          return { data: [{ id: `db_${legacyId}` }], error: null };
        }),
      };
      return chain;
    }),
    insert: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  }));

  return { from, updateCalls };
}

const baseContext = {
  configured: true,
  user: { id: "user_1" },
  company: { id: "company_1", name: "AAS Property Care" },
};

describe("supabaseEstimateRestorePayload", () => {
  beforeEach(() => {
    mockGetSupabaseClient.mockReset();
    mockGetSupabaseClient.mockReturnValue(null);
  });

  describe("buildEstimateRestorePayload", () => {
    test("wraps the full local estimate object in a versioned envelope", () => {
      const estimate = localEstimateFixture();
      const payload = buildEstimateRestorePayload(estimate);

      expect(payload).toEqual({
        schema: ESTIMATE_RESTORE_PAYLOAD_SCHEMA,
        version: 1,
        capturedFrom: "localStorage",
        legacyLocalId: "est_1",
        estimate,
      });
      expect(ESTIMATE_RESTORE_PAYLOAD_SCHEMA).toBe("estipaid.estimate.restore_payload");
      expect(ESTIMATE_RESTORE_PAYLOAD_VERSION).toBe("1");
    });

    test("preserves computational fields the cloud display columns do not carry", () => {
      const estimate = localEstimateFixture();
      const payload = buildEstimateRestorePayload(estimate);

      expect(payload.estimate.labor.hazardPct).toBe(5);
      expect(payload.estimate.labor.riskPct).toBe(2);
      expect(payload.estimate.labor.multiplier).toBe(1.25);
      expect(payload.estimate.labor.lines[0].hours).toBe(40);
      expect(payload.estimate.materials.markupPct).toBe(18);
      expect(payload.estimate.ui.materialsMode).toBe("itemized");
    });
  });

  describe("updateEstimateRestorePayloads", () => {
    test("blocks at signed_out without any Supabase calls", async () => {
      const result = await updateEstimateRestorePayloads({
        storageSnapshot: buildStorageSnapshot({ estimates: [localEstimateFixture()] }),
        configured: false,
        user: null,
        company: null,
      });

      expect(result.status).toBe(ESTIMATE_PAYLOAD_UPDATE_STATUS.SIGNED_OUT);
      expect(result.noLocalDataChanged).toBe(true);
      expect(mockGetSupabaseClient).not.toHaveBeenCalled();
    });

    test("blocks at no_workspace when there is no company", async () => {
      const result = await updateEstimateRestorePayloads({
        storageSnapshot: buildStorageSnapshot({ estimates: [localEstimateFixture()] }),
        ...baseContext,
        company: null,
      });

      expect(result.status).toBe(ESTIMATE_PAYLOAD_UPDATE_STATUS.NO_WORKSPACE);
    });

    test("reports no_local_estimates when there are no local estimates to update", async () => {
      const mockClient = createMockClient({ cloudRows: [] });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await updateEstimateRestorePayloads({
        storageSnapshot: buildStorageSnapshot({ estimates: [] }),
        ...baseContext,
      });

      expect(result.status).toBe(ESTIMATE_PAYLOAD_UPDATE_STATUS.NO_LOCAL_ESTIMATES);
      expect(mockClient.from).not.toHaveBeenCalled();
    });

    test("validates local estimates have ids and reports missing cloud rows separately", async () => {
      const mockClient = createMockClient({
        cloudRows: [{ id: "db_est_1", legacy_local_id: "est_1" }],
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await updateEstimateRestorePayloads({
        storageSnapshot: buildStorageSnapshot({
          estimates: [
            localEstimateFixture({ id: "est_1" }),
            localEstimateFixture({ id: "" }),
            localEstimateFixture({ id: "est_not_in_cloud" }),
          ],
        }),
        ...baseContext,
      });

      expect(result.status).toBe(ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED);
      expect(result.estimatesChecked).toBe(3);
      expect(result.estimatesUpdated).toBe(1);
      expect(result.skipped).toEqual([
        expect.objectContaining({ legacyLocalId: "", reason: expect.stringContaining("missing its local id") }),
      ]);
      expect(result.missingCloudRows).toEqual([
        expect.objectContaining({ legacyLocalId: "est_not_in_cloud" }),
      ]);
    });

    test("uses UPDATE only -- never insert, upsert, or delete", async () => {
      const mockClient = createMockClient({
        cloudRows: [{ id: "db_est_1", legacy_local_id: "est_1" }],
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      await updateEstimateRestorePayloads({
        storageSnapshot: buildStorageSnapshot({ estimates: [localEstimateFixture()] }),
        ...baseContext,
      });

      const fromInstances = mockClient.from.mock.results.map((r) => r.value);
      fromInstances.forEach((instance) => {
        expect(instance.insert).not.toHaveBeenCalled();
        expect(instance.upsert).not.toHaveBeenCalled();
        expect(instance.delete).not.toHaveBeenCalled();
      });
      expect(mockClient.updateCalls.length).toBe(1);
    });

    test("scopes every update by company_id and legacy_local_id", async () => {
      const mockClient = createMockClient({
        cloudRows: [{ id: "db_est_1", legacy_local_id: "est_1" }],
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      await updateEstimateRestorePayloads({
        storageSnapshot: buildStorageSnapshot({ estimates: [localEstimateFixture({ id: "est_1" })] }),
        ...baseContext,
      });

      expect(mockClient.updateCalls).toHaveLength(1);
      expect(mockClient.updateCalls[0].table).toBe("estimates");
      expect(mockClient.updateCalls[0].eqs).toEqual([
        ["company_id", "company_1"],
        ["legacy_local_id", "est_1"],
      ]);
      expect(mockClient.updateCalls[0].values).toEqual(expect.objectContaining({
        restore_payload: expect.objectContaining({ schema: ESTIMATE_RESTORE_PAYLOAD_SCHEMA, legacyLocalId: "est_1" }),
        restore_payload_version: "1",
        restore_payload_captured_at: expect.any(String),
      }));
    });

    test("reports a failed update without throwing when Supabase returns an error", async () => {
      const mockClient = createMockClient({
        cloudRows: [{ id: "db_est_1", legacy_local_id: "est_1" }],
        updateResponses: { est_1: { data: null, error: { message: "network error" } } },
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const result = await updateEstimateRestorePayloads({
        storageSnapshot: buildStorageSnapshot({ estimates: [localEstimateFixture({ id: "est_1" })] }),
        ...baseContext,
      });

      expect(result.status).toBe(ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED);
      expect(result.estimatesUpdated).toBe(0);
      expect(result.failed).toEqual([
        expect.objectContaining({ legacyLocalId: "est_1", reason: "network error" }),
      ]);
    });

    test("never mutates localStorage", async () => {
      const mockClient = createMockClient({
        cloudRows: [{ id: "db_est_1", legacy_local_id: "est_1" }],
      });
      mockGetSupabaseClient.mockReturnValue(mockClient);

      const storageSnapshot = buildStorageSnapshot({ estimates: [localEstimateFixture()] });
      const setItemSpy = jest.fn();
      storageSnapshot.setItem = setItemSpy;

      const result = await updateEstimateRestorePayloads({ storageSnapshot, ...baseContext });

      expect(setItemSpy).not.toHaveBeenCalled();
      expect(result.noLocalDataChanged).toBe(true);
    });
  });
});
