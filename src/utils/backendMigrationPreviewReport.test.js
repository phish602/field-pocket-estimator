import { createBackendMigrationPreview } from "./backendMigrationPreview";
import { formatBackendMigrationPreviewReport } from "./backendMigrationPreviewReport";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

const baseSnapshot = {
  companyProfile: {
    id: "company_local_1",
    companyName: "Field Pocket",
  },
  customers: [{ id: "cust_1", companyName: "Acme Co" }],
  projects: [{ id: "proj_1", customerId: "cust_1", projectNumber: "PR-100" }],
  estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-100" }],
  invoices: [{ id: "inv_1", projectId: "proj_1", customerId: "cust_1", sourceEstimateId: "est_1", invoiceNumber: "INV-100", payments: [{ id: "pay_1", amount: 25, method: "cash" }] }],
  settings: { pricing: { defaultTaxPct: 8 } },
  scopeTemplates: [{ id: "tmpl_1", name: "Default", scopeText: "Scope text" }],
  auditEvents: [{ id: "evt_1", type: "invoice.created", createdAt: "2026-01-01T00:00:00.000Z" }],
};

describe("backendMigrationPreviewReport", () => {
  test("formats a clean preview with counts and no warnings", () => {
    const preview = createBackendMigrationPreview(clone(baseSnapshot), {
      companyId: "company_1",
      userId: "user_1",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    const report = formatBackendMigrationPreviewReport(preview);

    expect(report).toContain("EstiPaid Backend Migration Preview Report");
    expect(report).toContain("Mapping version: backend-mapping-v1");
    expect(report).toContain("Generated at: 2026-01-02T03:04:05.000Z");
    expect(report).toContain("Status: Ready for review");
    expect(report).toContain("Can proceed: Yes");
    expect(report).toContain("Companies: 1");
    expect(report).toContain("Invoice payments: 1");
    expect(report).toContain("Blocker warnings: 0");
    expect(report).toContain("Needs review warnings: 0");
    expect(report).toContain("Informational warnings: 0");
    expect(report).toContain("Blockers:\n  None");
    expect(report).toContain("Needs Review:\n  None");
    expect(report).toContain("Informational:\n  None");
    expect(report).toContain("This is a dry-run report only. No backend writes have been performed.");
  });

  test("formats blockers and marks report as Blocked", () => {
    const preview = createBackendMigrationPreview({}, {});
    const report = formatBackendMigrationPreviewReport(preview);

    expect(report).toContain("Status: Blocked");
    expect(report).toContain("Can proceed: No");
    expect(report).toContain("Blockers:");
    expect(report).not.toContain("Blockers:\n  None");
    expect(report).toContain("missing_company_id");
    expect(report).toContain("missing_user_id");
  });

  test("formats needs-review warnings and informational warnings", () => {
    const preview = clone(createBackendMigrationPreview(clone(baseSnapshot), {
      companyId: "company_1",
      userId: "user_1",
    }));
    preview.warningsBySeverity = {
      blocker: [],
      needsReview: [
        { code: "document_number_collision:estimate:EST-100", entityType: "estimate", entityId: "est_1", message: "Duplicate estimate document number detected." },
      ],
      informational: [
        { code: "template_stale", entityType: "scope_template", entityId: "tmpl_1", message: "Template timestamp is older than the current app state." },
      ],
    };
    preview.warningSummary = { blocker: 0, needsReview: 1, informational: 1, total: 2 };
    preview.canProceed = true;
    preview.hasBlockers = false;

    const report = formatBackendMigrationPreviewReport(preview);

    expect(report).toContain("Needs Review:");
    expect(report).toContain("document_number_collision:estimate:EST-100");
    expect(report).toContain("Informational:");
    expect(report).toContain("template_stale");
  });

  test("shows None for empty warning sections", () => {
    const report = formatBackendMigrationPreviewReport({
      mappingVersion: "backend-migration-preview-v1",
      generatedAtIso: "2026-01-02T03:04:05.000Z",
      entityCounts: {},
      warningSummary: { blocker: 0, needsReview: 0, informational: 0, total: 0 },
      warningsBySeverity: { blocker: [], needsReview: [], informational: [] },
      canProceed: true,
      draft: {},
    });

    expect(report).toContain("Blockers:\n  None");
    expect(report).toContain("Needs Review:\n  None");
    expect(report).toContain("Informational:\n  None");
  });

  test("does not mutate input", () => {
    const preview = createBackendMigrationPreview(clone(baseSnapshot), {
      companyId: "company_1",
      userId: "user_1",
    });
    const before = clone(preview);

    formatBackendMigrationPreviewReport(preview);

    expect(preview).toEqual(before);
  });

  test("does not require localStorage or fetch/network behavior", () => {
    const originalFetch = global.fetch;
    const fetchSpy = jest.fn();
    const getItemSpy = jest.spyOn(Storage.prototype, "getItem");
    const setItemSpy = jest.spyOn(Storage.prototype, "setItem");

    global.fetch = fetchSpy;
    try {
      formatBackendMigrationPreviewReport(createBackendMigrationPreview(clone(baseSnapshot), {
        companyId: "company_1",
        userId: "user_1",
      }));
    } finally {
      global.fetch = originalFetch;
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  test("includeDraftJson false by default", () => {
    const preview = createBackendMigrationPreview(clone(baseSnapshot), {
      companyId: "company_1",
      userId: "user_1",
    });

    const report = formatBackendMigrationPreviewReport(preview);

    expect(report).not.toContain("Draft JSON:");
    expect(report).not.toContain("\"companies\"");
  });

  test("includeDraftJson true appends draft JSON", () => {
    const preview = createBackendMigrationPreview(clone(baseSnapshot), {
      companyId: "company_1",
      userId: "user_1",
    });

    const report = formatBackendMigrationPreviewReport(preview, { includeDraftJson: true });

    expect(report).toContain("Draft JSON:");
    expect(report).toContain("\"companies\"");
    expect(report).toContain("\"customers\"");
  });
});
