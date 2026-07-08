import { createBackendMigrationPreview } from "./backendMigrationPreview";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const baseSnapshot = {
  companyProfile: {
    id: "company_local_1",
    companyName: "Field Pocket",
    email: "support@example.com",
  },
  customers: [
    { id: "cust_1", companyName: "Acme Co", contactName: "Alex" },
  ],
  projects: [
    { id: "proj_1", customerId: "cust_1", projectNumber: "PR-100" },
  ],
  estimates: [
    {
      id: "est_1",
      projectId: "proj_1",
      customerId: "cust_1",
      estimateNumber: "EST-100",
      status: "approved",
      total: 100,
      labor: { lines: [{ id: "lab_1", description: "Labor", quantity: 1, rate: 100 }] },
    },
  ],
  invoices: [
    {
      id: "inv_1",
      projectId: "proj_1",
      customerId: "cust_1",
      sourceEstimateId: "est_1",
      invoiceNumber: "INV-100",
      estimateNumber: "EST-100",
      status: "sent",
      paymentStatus: "partial",
      invoiceTotal: 100,
      amountPaid: 25,
      balanceRemaining: 75,
      payments: [
        { id: "pay_1", amount: 25, method: "cash", status: "paid", paidAt: 1710000000000 },
      ],
    },
  ],
  settings: {
    pricing: { defaultTaxPct: 8 },
  },
  scopeTemplates: [
    { id: "tmpl_1", name: "Default", scopeText: "Scope text" },
  ],
  auditEvents: [
    {
      id: "evt_1",
      type: "invoice.created",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

describe("backendMigrationPreview", () => {
  test("clean snapshot returns counts and canProceed true", () => {
    const preview = createBackendMigrationPreview(clone(baseSnapshot), {
      companyId: "company_1",
      userId: "user_1",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    expect(preview.mappingVersion).toBe("backend-mapping-v1");
    expect(preview.generatedAtIso).toBe("2026-01-02T03:04:05.000Z");
    expect(preview.entityCounts).toEqual({
      companies: 1,
      customers: 1,
      projects: 1,
      estimates: 1,
      invoices: 1,
      invoicePayments: 1,
      scopeTemplates: 1,
      settings: 1,
      auditEvents: 1,
    });
    expect(preview.warningSummary).toEqual({
      blocker: 0,
      needsReview: 0,
      informational: 0,
      total: 0,
    });
    expect(preview.hasBlockers).toBe(false);
    expect(preview.canProceed).toBe(true);
  });

  test("missing companyId and userId create blockers", () => {
    const preview = createBackendMigrationPreview({}, {});

    expect(preview.warningSummary.blocker).toBeGreaterThanOrEqual(2);
    expect(preview.hasBlockers).toBe(true);
    expect(preview.canProceed).toBe(false);
    expect(preview.warningsBySeverity.blocker).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_company_id", previewSeverity: "blocker" }),
      expect.objectContaining({ code: "missing_user_id", previewSeverity: "blocker" }),
    ]));
  });

  test("duplicate ids create blockers", () => {
    const preview = createBackendMigrationPreview({
      ...clone(baseSnapshot),
      customers: [
        { id: "cust_1", companyName: "Acme Co" },
        { id: "cust_1", companyName: "Acme Co Duplicate" },
      ],
    }, {
      companyId: "company_1",
      userId: "user_1",
    });

    expect(preview.hasBlockers).toBe(true);
    expect(preview.canProceed).toBe(false);
    expect(preview.warningsBySeverity.blocker).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "duplicate_local_id:customer:cust_1",
        previewSeverity: "blocker",
      }),
    ]));
  });

  test("broken relationships create needs-review warnings", () => {
    const preview = createBackendMigrationPreview({
      ...clone(baseSnapshot),
      projects: [
        { id: "proj_1", customerId: "missing_customer", projectNumber: "PR-100" },
      ],
      invoices: [
        {
          id: "inv_1",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "missing_estimate",
          invoiceNumber: "INV-100",
          estimateNumber: "EST-100",
          status: "sent",
          paymentStatus: "partial",
          invoiceTotal: 100,
          amountPaid: 25,
          balanceRemaining: 75,
        },
      ],
    }, {
      companyId: "company_1",
      userId: "user_1",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    expect(preview.hasBlockers).toBe(false);
    expect(preview.canProceed).toBe(true);
    expect(preview.warningsBySeverity.needsReview).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "project_customer_ref_missing:proj_1",
        previewSeverity: "needsReview",
      }),
      expect.objectContaining({
        code: "invoice_source_estimate_missing:inv_1",
        previewSeverity: "needsReview",
      }),
    ]));
  });

  test("document-number collisions create needs-review warnings", () => {
    const preview = createBackendMigrationPreview({
      ...clone(baseSnapshot),
      estimates: [
        { id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-100" },
        { id: "est_2", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-100" },
      ],
      invoices: [
        {
          id: "inv_1",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "est_1",
          invoiceNumber: "INV-100",
          estimateNumber: "EST-100",
        },
        {
          id: "inv_2",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "est_1",
          invoiceNumber: "INV-100",
          estimateNumber: "EST-100",
        },
      ],
    }, {
      companyId: "company_1",
      userId: "user_1",
    });

    expect(preview.hasBlockers).toBe(false);
    expect(preview.canProceed).toBe(true);
    expect(preview.warningsBySeverity.needsReview).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "document_number_collision:estimate:EST-100",
        previewSeverity: "needsReview",
      }),
      expect.objectContaining({
        code: "document_number_collision:invoice:INV-100",
        previewSeverity: "needsReview",
      }),
    ]));
  });

  test("missing invoice payment amount creates a needs-review warning", () => {
    const preview = createBackendMigrationPreview({
      ...clone(baseSnapshot),
      invoices: [
        {
          id: "inv_1",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "est_1",
          invoiceNumber: "INV-100",
          estimateNumber: "EST-100",
          payments: [
            { id: "pay_1", method: "cash", status: "paid" },
          ],
        },
      ],
    }, {
      companyId: "company_1",
      userId: "user_1",
    });

    expect(preview.hasBlockers).toBe(false);
    expect(preview.canProceed).toBe(true);
    expect(preview.warningsBySeverity.needsReview).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "invoice_payment_missing_amount:inv_1",
        previewSeverity: "needsReview",
      }),
    ]));
  });

  test("empty snapshot does not crash", () => {
    const preview = createBackendMigrationPreview({}, {});

    expect(preview).toEqual(expect.objectContaining({
      mappingVersion: "backend-mapping-v1",
      entityCounts: expect.any(Object),
      warningSummary: expect.any(Object),
      warningsBySeverity: expect.any(Object),
      draft: expect.any(Object),
    }));
  });

  test("inputs are not mutated", () => {
    const snapshot = clone(baseSnapshot);
    const contextInput = {
      companyId: "company_1",
      userId: "user_1",
      generatedAt: "2026-01-02T03:04:05.000Z",
    };
    const beforeSnapshot = clone(snapshot);
    const beforeContext = clone(contextInput);

    createBackendMigrationPreview(snapshot, contextInput);

    expect(snapshot).toEqual(beforeSnapshot);
    expect(contextInput).toEqual(beforeContext);
  });

  test("preview does not require localStorage or fetch behavior", () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn();
    const getItemSpy = jest.spyOn(Storage.prototype, "getItem");
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");
    const removeItemSpy = jest.spyOn(Storage.prototype, "removeItem");

    global.fetch = fetchSpy;

    try {
      createBackendMigrationPreview(clone(baseSnapshot), {
        companyId: "company_1",
        userId: "user_1",
      });
    } finally {
      global.fetch = originalFetch;
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
      removeItemSpy.mockRestore();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(removeItemSpy).not.toHaveBeenCalled();
  });
});
