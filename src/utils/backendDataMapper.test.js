import {
  BACKEND_MAPPING_VERSION,
  collectBackendMappingWarnings,
  createBackendMappingContext,
  mapLocalCompanyProfileToBackendCompany,
  mapLocalCustomerToBackendCustomer,
  mapLocalEstimateToBackendEstimate,
  mapLocalInvoicePaymentToBackendPayment,
  mapLocalInvoiceToBackendInvoice,
  mapLocalProjectToBackendProject,
  mapLocalSnapshotToBackendDraft,
} from "./backendDataMapper";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

describe("backendDataMapper", () => {
  test("createBackendMappingContext is deterministic with injected values", () => {
    const context = createBackendMappingContext({
      companyId: "company_1",
      userId: "user_1",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    expect(context).toEqual({
      mappingVersion: BACKEND_MAPPING_VERSION,
      companyId: "company_1",
      userId: "user_1",
      generatedAt: "2026-01-02T03:04:05.000Z",
      source: "local_storage_export",
      warnings: [],
    });
  });

  test("mapLocalSnapshotToBackendDraft does not mutate the input snapshot", () => {
    const snapshot = {
      companyProfile: {
        id: "company_local_1",
        companyName: "Field Pocket",
        email: "support@example.com",
      },
      customers: [
        { id: "cust_1", name: "Acme Co" },
      ],
      projects: [
        { id: "proj_1", customerId: "cust_1", projectNumber: "PR-100" },
      ],
      estimates: [
        { id: "est_1", projectId: "proj_1", estimateNumber: "EST-100" },
      ],
      invoices: [
        { id: "inv_1", projectId: "proj_1", sourceEstimateId: "est_1", invoiceNumber: "INV-100" },
      ],
      settings: {
        pricing: { defaultTaxPct: 8 },
      },
      scopeTemplates: [
        { id: "tmpl_1", name: "Support scope", scopeText: "Template text" },
      ],
      auditEvents: [
        {
          id: "evt_1",
          type: "invoice.created",
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    };
    const before = clone(snapshot);

    mapLocalSnapshotToBackendDraft(snapshot, {
      companyId: "company_1",
      userId: "user_1",
      generatedAt: "2026-01-02T03:04:05.000Z",
    });

    expect(snapshot).toEqual(before);
  });

  test("empty snapshot returns the expected top-level draft shape", () => {
    const draft = mapLocalSnapshotToBackendDraft({}, {});

    expect(draft).toEqual(expect.objectContaining({
      mappingMeta: expect.objectContaining({
        mappingVersion: BACKEND_MAPPING_VERSION,
        source: "local_storage_export",
      }),
      companies: [],
      customers: [],
      projects: [],
      estimates: [],
      invoices: [],
      invoicePayments: [],
      scopeTemplates: [],
      settings: null,
      auditEvents: [],
      warnings: expect.any(Array),
    }));
    expect(draft.warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_company_id" }),
      expect.objectContaining({ code: "missing_user_id" }),
    ]));
  });

  test("customer maps with company_id and legacy_local_id", () => {
    const context = createBackendMappingContext({ companyId: "company_1", userId: "user_1" });
    const customer = mapLocalCustomerToBackendCustomer({
      id: "cust_1",
      companyName: "Acme Co",
      contactName: "Alex",
      phone: "555-000-1111",
      email: "alex@example.com",
      address: "10 Market St",
      billingAddress: "PO Box 1",
      type: "commercial",
      status: "active",
      netTermsType: "net",
      netTermsDays: 30,
      createdAt: 1710000000000,
      updatedAt: 1710001000000,
    }, context);

    expect(customer).toEqual(expect.objectContaining({
      company_id: "company_1",
      legacy_local_id: "cust_1",
      display_name: "Acme Co",
      company_name: "Acme Co",
      contact_name: "Alex",
      phone: "555-000-1111",
      email: "alex@example.com",
      address: "10 Market St",
      billing_address: "PO Box 1",
      customer_type: "commercial",
      status: "active",
      net_terms_type: "net",
      net_terms_days: 30,
    }));
    expect(customer.created_at).toBe("2024-03-09T16:00:00.000Z");
    expect(customer.updated_at).toBe("2024-03-09T16:16:40.000Z");
  });

  test("project maps customerId as customer_legacy_local_id", () => {
    const context = createBackendMappingContext({ companyId: "company_1", userId: "user_1" });
    const project = mapLocalProjectToBackendProject({
      id: "proj_1",
      customerId: "cust_1",
      projectNumber: "PR-100",
      projectName: "Roof Repair",
      siteAddress: "123 Main St",
      status: "active",
      notes: "Internal note",
      scopeSummary: "Scope summary",
      createdAt: 1710000000000,
      updatedAt: 1710001000000,
    }, context);

    expect(project).toEqual(expect.objectContaining({
      company_id: "company_1",
      legacy_local_id: "proj_1",
      customer_legacy_local_id: "cust_1",
      project_number: "PR-100",
      project_name: "Roof Repair",
      site_address: "123 Main St",
      status: "active",
      notes: "Internal note",
      scope_summary: "Scope summary",
    }));
  });

  test("estimate maps estimate_number separately from legacy_local_id", () => {
    const context = createBackendMappingContext({ companyId: "company_1", userId: "user_1" });
    const estimate = mapLocalEstimateToBackendEstimate({
      id: "est_1",
      projectId: "proj_1",
      customerId: "cust_1",
      estimateNumber: "EST-100",
      status: "approved",
      total: 1234.56,
      totalCost: 800,
      grossProfit: 434.56,
      approvedTotal: 1234.56,
      invoiceId: "inv_1",
      invoiceNumber: "INV-100",
      createdAt: 1710000000000,
      updatedAt: 1710001000000,
      labor: { lines: [{ id: "lab_1", description: "Labor", quantity: 2, rate: 50 }] },
    }, context);

    expect(estimate).toEqual(expect.objectContaining({
      company_id: "company_1",
      legacy_local_id: "est_1",
      project_legacy_local_id: "proj_1",
      customer_legacy_local_id: "cust_1",
      estimate_number: "EST-100",
      status: "approved",
      doc_type: "estimate",
      converted_invoice_legacy_local_id: "inv_1",
      converted_invoice_number: "INV-100",
      total: 1234.56,
      total_cost: 800,
      gross_profit: 434.56,
      approved_total: 1234.56,
    }));
    expect(Array.isArray(estimate.line_items)).toBe(true);
    expect(estimate.line_items).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "labor",
        legacy_local_id: "lab_1",
        description: "Labor",
        quantity: 2,
        unit_price: 50,
      }),
    ]));
  });

  test("invoice maps invoice_number separately from legacy_local_id", () => {
    const context = createBackendMappingContext({ companyId: "company_1", userId: "user_1" });
    const invoice = mapLocalInvoiceToBackendInvoice({
      id: "inv_1",
      projectId: "proj_1",
      customerId: "cust_1",
      sourceEstimateId: "est_1",
      invoiceNumber: "INV-100",
      estimateNumber: "EST-100",
      status: "sent",
      paymentStatus: "partial",
      invoiceTotal: 1234.56,
      amountPaid: 234.56,
      balanceRemaining: 1000,
      total: 1234.56,
      createdAt: 1710000000000,
      updatedAt: 1710001000000,
      sourceEstimateSnapshot: {
        estimateId: "est_1",
        customerId: "cust_1",
        projectId: "proj_1",
      },
      payments: [
        {
          id: "pay_1",
          amount: 234.56,
          method: "cash",
          status: "paid",
          notes: "Private notes should not map",
          stripePayload: { secret: true },
          paidAt: 1710002000000,
        },
      ],
    }, context);

    expect(invoice).toEqual(expect.objectContaining({
      company_id: "company_1",
      legacy_local_id: "inv_1",
      project_legacy_local_id: "proj_1",
      customer_legacy_local_id: "cust_1",
      source_estimate_legacy_local_id: "est_1",
      invoice_number: "INV-100",
      estimate_number: "EST-100",
      status: "sent",
      payment_status: "partial",
      amount_paid: 234.56,
      balance_remaining: 1000,
      total: 1234.56,
    }));
    expect(invoice.sourceEstimateSnapshot).toBeUndefined();
    expect(Array.isArray(invoice.line_items)).toBe(true);
  });

  test("invoice payment maps without raw payment notes", () => {
    const context = createBackendMappingContext({ companyId: "company_1", userId: "user_1" });
    const payment = mapLocalInvoicePaymentToBackendPayment({
      id: "pay_1",
      amount: 99.25,
      method: "stripe",
      status: "paid",
      notes: "Do not carry this forward",
      stripePayload: { secret: true },
      createdAt: 1710000000000,
      paidAt: 1710000500000,
    }, { id: "inv_1" }, context);

    expect(payment).toEqual(expect.objectContaining({
      company_id: "company_1",
      invoice_legacy_local_id: "inv_1",
      legacy_local_id: "pay_1",
      amount: 99.25,
      method: "stripe",
      status: "paid",
      paid_at: "2024-03-09T16:08:20.000Z",
    }));
    expect(payment.notes).toBeUndefined();
    expect(payment.stripePayload).toBeUndefined();
  });

  test("duplicate local customer ids produce a warning", () => {
    const warnings = collectBackendMappingWarnings({
      customers: [{ id: "cust_1" }, { id: "cust_1" }],
      projects: [],
      estimates: [],
      invoices: [],
    }, { companyId: "company_1", userId: "user_1" });

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: expect.stringContaining("duplicate_local_id:customer:cust_1"),
        severity: "error",
        entityType: "customer",
      }),
    ]));
  });

  test("invoice sourceEstimateId mismatch produces a warning", () => {
    const warnings = collectBackendMappingWarnings({
      customers: [{ id: "cust_1" }],
      projects: [{ id: "proj_1", customerId: "cust_1" }],
      estimates: [{ id: "est_1", projectId: "proj_1" }],
      invoices: [{ id: "inv_1", sourceEstimateId: "missing_estimate" }],
    }, { companyId: "company_1", userId: "user_1" });

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: expect.stringContaining("invoice_source_estimate_missing:inv_1"),
        severity: "warning",
        entityType: "invoice",
      }),
    ]));
  });

  test("document number collisions produce warnings", () => {
    const warnings = collectBackendMappingWarnings({
      customers: [],
      projects: [],
      estimates: [
        { id: "est_1", estimateNumber: "EST-100" },
        { id: "est_2", estimateNumber: "EST-100" },
      ],
      invoices: [
        { id: "inv_1", invoiceNumber: "INV-200" },
        { id: "inv_2", invoiceNumber: "INV-200" },
      ],
    }, { companyId: "company_1", userId: "user_1" });

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: expect.stringContaining("document_number_collision:estimate:EST-100"),
        severity: "warning",
        entityType: "estimate",
      }),
      expect.objectContaining({
        code: expect.stringContaining("document_number_collision:invoice:INV-200"),
        severity: "warning",
        entityType: "invoice",
      }),
    ]));
  });

  test("missing companyId and userId produce warnings", () => {
    const warnings = collectBackendMappingWarnings({
      customers: [],
      projects: [],
      estimates: [],
      invoices: [],
    }, {});

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_company_id", severity: "warning" }),
      expect.objectContaining({ code: "missing_user_id", severity: "warning" }),
    ]));
  });
});

describe("Gate 16D customerless project mapping", () => {
  test("a customerless project maps to an empty customer_legacy_local_id", () => {
    const context = createBackendMappingContext({ companyId: "company_1", userId: "user_1" });
    // The empty customer relationship is omitted entirely (no customer claim).
    expect(mapLocalProjectToBackendProject({ id: "p1", projectName: "Unassigned", customerId: "" }, context).customer_legacy_local_id).toBeUndefined();
    // An assigned project still carries its customer relationship.
    expect(mapLocalProjectToBackendProject({ id: "p2", projectName: "Assigned", customerId: "cust_1" }, context).customer_legacy_local_id).toBe("cust_1");
  });
});
