import { createBackendMigrationPreview } from "./backendMigrationPreview";
import { formatBackendMigrationPreviewReport } from "./backendMigrationPreviewReport";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const cleanSnapshot = {
  companyProfile: {
    id: "company_local_1",
    companyName: "Field Pocket",
    email: "support@example.com",
    phone: "555-100-2000",
  },
  customers: [
    {
      id: "cust_1",
      companyName: "Acme Co",
      contactName: "Alex",
      email: "alex@example.com",
    },
  ],
  projects: [
    {
      id: "proj_1",
      customerId: "cust_1",
      projectNumber: "PR-100",
      projectName: "Roof Repair",
      siteAddress: "123 Main St",
      status: "active",
      notes: "Keep clear of the skylight.",
    },
  ],
  estimates: [
    {
      id: "est_1",
      projectId: "proj_1",
      customerId: "cust_1",
      estimateNumber: "EST-100",
      status: "approved",
      total: 1250,
      totalCost: 800,
      grossProfit: 450,
      labor: {
        lines: [
          { id: "lab_1", description: "Labor", quantity: 10, rate: 75 },
        ],
      },
      materials: {
        items: [
          { id: "mat_1", description: "Shingles", quantity: 5, price: 40 },
        ],
      },
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
      invoiceTotal: 1250,
      amountPaid: 250,
      balanceRemaining: 1000,
      date: 1710000000000,
      payments: [
        {
          id: "pay_1",
          amount: 250,
          method: "cash",
          status: "paid",
          paidAt: 1710000500000,
        },
      ],
    },
  ],
  scopeTemplates: [
    {
      id: "tmpl_1",
      name: "Default",
      scopeText: "Standard roof repair scope.",
    },
  ],
  settings: {
    pricing: { defaultTaxPct: 8 },
    docDefaults: { invoicePrefix: "INV" },
  },
  auditEvents: [
    {
      id: "evt_1",
      type: "invoice.created",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

describe("backendMigrationPreviewFlow", () => {
  test("clean local snapshot flows through preview and report", () => {
    const snapshot = clone(cleanSnapshot);
    const contextInput = {
      companyId: "company_1",
      userId: "user_1",
      generatedAt: "2026-01-02T03:04:05.000Z",
    };
    const beforeSnapshot = clone(snapshot);
    const beforeContext = clone(contextInput);

    const preview = createBackendMigrationPreview(snapshot, contextInput);
    const report = formatBackendMigrationPreviewReport(preview);

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
    expect(report).toContain("EstiPaid Backend Migration Preview Report");
    expect(report).toContain("Mapping version: backend-mapping-v1");
    expect(report).toContain("Entity counts:");
    expect(report).toContain("Warning summary:");
    expect(report).toContain("This is a dry-run report only. No backend writes have been performed.");
    expect(report).not.toContain("Draft JSON:");

    expect(snapshot).toEqual(beforeSnapshot);
    expect(contextInput).toEqual(beforeContext);
  });

  test("intentional issues flow through blockers and needs-review warnings", () => {
    const snapshot = {
      ...clone(cleanSnapshot),
      customers: [
        { id: "cust_1", companyName: "Acme Co" },
        { id: "cust_1", companyName: "Acme Co Duplicate" },
      ],
      projects: [
        { id: "proj_1", customerId: "missing_customer", projectNumber: "PR-100" },
      ],
      estimates: [
        { id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-100" },
        { id: "est_2", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-100" },
      ],
      invoices: [
        {
          id: "inv_1",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "missing_estimate",
          invoiceNumber: "INV-100",
          estimateNumber: "EST-100",
          paymentStatus: "partial",
          invoiceTotal: 1250,
          amountPaid: 250,
          balanceRemaining: 1000,
          payments: [
            { id: "pay_1", method: "cash", status: "paid" },
          ],
        },
        {
          id: "inv_2",
          projectId: "proj_1",
          customerId: "cust_1",
          sourceEstimateId: "est_1",
          invoiceNumber: "INV-100",
          estimateNumber: "EST-100",
          paymentStatus: "partial",
          invoiceTotal: 1250,
          amountPaid: 250,
          balanceRemaining: 1000,
        },
      ],
    };
    const beforeSnapshot = clone(snapshot);

    const preview = createBackendMigrationPreview(snapshot, {});
    const report = formatBackendMigrationPreviewReport(preview);

    expect(preview.hasBlockers).toBe(true);
    expect(preview.canProceed).toBe(false);
    expect(preview.warningSummary.blocker).toBeGreaterThanOrEqual(3);
    expect(preview.warningSummary.needsReview).toBeGreaterThanOrEqual(3);
    expect(report).toContain("Status: Blocked");
    expect(report).toContain("Blockers:");
    expect(report).toContain("Needs Review:");
    expect(report).toContain("missing_company_id");
    expect(report).toContain("missing_user_id");
    expect(report).toContain("duplicate_local_id:customer:cust_1");
    expect(report).toContain("project_customer_ref_missing:proj_1");
    expect(report).toContain("invoice_source_estimate_missing:inv_1");
    expect(report).toContain("document_number_collision:invoice:INV-100");
    expect(report).toContain("invoice_payment_missing_amount:inv_1");

    expect(snapshot).toEqual(beforeSnapshot);
  });

  test("no localStorage, fetch, or UI imports are required", () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn();
    const getItemSpy = jest.spyOn(Storage.prototype, "getItem");
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

    global.fetch = fetchSpy;
    try {
      const preview = createBackendMigrationPreview(clone(cleanSnapshot), {
        companyId: "company_1",
        userId: "user_1",
      });
      formatBackendMigrationPreviewReport(preview);
    } finally {
      global.fetch = originalFetch;
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
  });
});
