import {
  BACKEND_ADAPTER_ENTITY_COVERAGE,
  createBackendDataAdapter,
  getBackendAdapterStatus,
} from "./backendDataAdapter";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("backendDataAdapter", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.REACT_APP_SUPABASE_URL;
    delete process.env.REACT_APP_SUPABASE_ANON_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  test("imports without throwing", () => {
    expect(() => require("./backendDataAdapter")).not.toThrow();
  });

  test("reports safe unconfigured status when env is missing", () => {
    const module = require("./backendDataAdapter");
    const status = module.getBackendAdapterStatus();

    expect(status).toEqual({
      isConfigured: false,
      canRead: false,
      canWrite: false,
      reason: "Supabase public runtime env is missing or placeholder-only.",
      missingKeys: ["REACT_APP_SUPABASE_URL", "REACT_APP_SUPABASE_ANON_KEY"],
    });
  });

  test("does not require real credentials", () => {
    const adapter = createBackendDataAdapter();
    const status = getBackendAdapterStatus();

    expect(adapter).toBeTruthy();
    expect(status.isConfigured).toBe(false);
    expect(status.canRead).toBe(false);
    expect(status.canWrite).toBe(false);
  });

  test("exposes backend entity coverage metadata", () => {
    const adapter = createBackendDataAdapter();

    expect(BACKEND_ADAPTER_ENTITY_COVERAGE).toEqual(expect.arrayContaining([
      "company_profile",
      "customers",
      "projects",
      "estimates",
      "estimate_line_items",
      "invoices",
      "invoice_line_items",
      "invoice_payments",
      "scope_templates",
      "app_settings",
      "audit_events",
      "migration_batches",
      "migration_write_results",
    ]));
    expect(adapter.entityCoverage).toEqual(BACKEND_ADAPTER_ENTITY_COVERAGE);
  });

  test("can prepare a fake minimal local snapshot without mutating input", () => {
    const adapter = createBackendDataAdapter();
    const snapshot = {
      companyProfile: {
        id: "company_local_1",
        companyName: "Demo Company",
      },
      customers: [
        {
          id: "cust_1",
          name: "Acme",
        },
      ],
      projects: [
        {
          id: "proj_1",
          customerId: "cust_1",
          projectNumber: "PR-1",
        },
      ],
      estimates: [
        {
          id: "est_1",
          projectId: "proj_1",
          customerId: "cust_1",
          estimateNumber: "EST-1",
        },
      ],
      invoices: [],
      settings: {},
      scopeTemplates: [],
      auditEvents: [],
    };
    const before = clone(snapshot);

    const result = adapter.prepareBackendDraft(snapshot, {
      companyId: "company_1",
      userId: "user_1",
      generatedAt: "2026-06-05T00:00:00.000Z",
    });

    expect(result.ok).toBe(true);
    expect(result.mappedDraft).toBeTruthy();
    expect(result.mappedDraft.mappingMeta).toEqual(expect.objectContaining({
      companyId: "company_1",
      userId: "user_1",
    }));
    expect(result.mappedDraft.customers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        legacy_local_id: "cust_1",
      }),
    ]));
    expect(snapshot).toEqual(before);
  });

  test("blocked future read/write methods return blocked results", () => {
    const adapter = createBackendDataAdapter();

    expect(adapter.readFromBackend()).toEqual(expect.objectContaining({
      ok: false,
      blocked: true,
      operation: "readFromBackend",
    }));
    expect(adapter.writeToBackend()).toEqual(expect.objectContaining({
      ok: false,
      blocked: true,
      operation: "writeToBackend",
    }));
  });

  test("adapter file does not import app workflow modules", () => {
    const fs = require("fs");
    const path = require("path");
    const filePath = path.join(__dirname, "backendDataAdapter.js");
    const source = fs.readFileSync(filePath, "utf8");

    expect(source).not.toMatch(/from\s+["']\.\.\/App["']/);
    expect(source).not.toMatch(/from\s+["']\.\.\/screens\//);
    expect(source).not.toMatch(/from\s+["']\.\.\/estimator\//);
    expect(source).not.toMatch(/from\s+["']\.\.\/pdf/);
    expect(source).not.toMatch(/from\s+["']\.\.\/.*aiAssist/i);
  });
});
