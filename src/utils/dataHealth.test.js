import { DATA_HEALTH_CODES, DATA_HEALTH_SEVERITY, runDataHealthCheck } from "./dataHealth";

describe("dataHealth", () => {
  test("does not crash on an empty snapshot", () => {
    const result = runDataHealthCheck({});
    expect(result.ok).toBe(true);
    expect(result.summary).toEqual({
      errors: 0,
      warnings: 0,
      info: 0,
      customers: 0,
      projects: 0,
      estimates: 0,
      invoices: 0,
    });
    expect(result.issues).toEqual([]);
  });

  test("detects duplicate ids and missing ids", () => {
    const result = runDataHealthCheck({
      customers: [
        { id: "c1", createdAt: "2025-01-01" },
        { id: "c1", createdAt: "2025-01-02" },
        { name: "missing id" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.DUPLICATE_ID)).toBe(true);
    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.MISSING_ID)).toBe(true);
    expect(result.summary.errors).toBeGreaterThan(0);
  });

  test("detects invoice balance mismatches and status contradictions", () => {
    const result = runDataHealthCheck({
      invoices: [
        {
          id: "inv-1",
          invoiceTotal: 100,
          amountPaid: 120,
          balanceRemaining: 0,
          status: "paid",
          dueDate: "2025-06-01",
        },
        {
          id: "inv-2",
          invoiceTotal: 100,
          amountPaid: 100,
          balanceRemaining: 10,
          status: "paid",
        },
        {
          id: "inv-3",
          invoiceTotal: 100,
          amountPaid: 20,
          balanceRemaining: 80,
          status: "void",
        },
      ],
    });

    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.INVOICE_AMOUNT_GT_TOTAL)).toBe(true);
    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.INVOICE_BALANCE_MISMATCH)).toBe(true);
    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.INVOICE_PAID_WITH_BALANCE)).toBe(true);
    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.INVOICE_VOID_WITH_AMOUNT)).toBe(true);
  });

  test("detects missing references and invalid dates", () => {
    const result = runDataHealthCheck({
      customers: [{ id: "c1" }],
      projects: [{ id: "p1", customerId: "missing-customer", createdAt: "not-a-date" }],
      estimates: [{ id: "e1", projectId: "missing-project", dueDate: "bad-date" }],
      invoices: [{ id: "i1", projectId: "missing-project", date: "also-bad" }],
      auditEvents: [{ type: "", createdAt: "" }],
    });

    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.BROKEN_PROJECT_CUSTOMER_REF)).toBe(true);
    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.BROKEN_ESTIMATE_PROJECT_REF)).toBe(true);
    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.BROKEN_INVOICE_PROJECT_REF)).toBe(true);
    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.INVALID_DATE)).toBe(true);
    expect(result.issues.some((issue) => issue.code === DATA_HEALTH_CODES.AUDIT_EVENT_MISSING_FIELDS)).toBe(true);
    expect(result.issues.every((issue) => [DATA_HEALTH_SEVERITY.ERROR, DATA_HEALTH_SEVERITY.WARNING, DATA_HEALTH_SEVERITY.INFO].includes(issue.severity))).toBe(true);
  });
});

