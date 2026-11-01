import {
  buildTargetEstimatePersistencePayloads,
  buildTargetInvoicePersistencePayloads,
} from "./supabaseMigrationWriter";

test("target adapter reuses the existing invoice/payment mapper and persistence payload contract", () => {
  const result = buildTargetInvoicePersistencePayloads({
    companyId: "company-1",
    userId: "user-1",
    customerId: "cust-cloud",
    projectId: "proj-cloud",
    estimateId: "est-cloud",
    invoiceId: "inv-cloud",
    invoice: {
      id: "inv-local",
      invoiceNumber: "INV-77",
      customerId: "cust-local",
      projectId: "proj-local",
      sourceEstimateId: "est-local",
      status: "sent",
      paymentStatus: "partial",
      date: "2026-08-23",
      dueDate: "2026-09-23",
      invoiceTotal: 100,
      amountPaid: 25,
      balanceRemaining: 75,
      materials: { items: [{ id: "line-1", desc: "Work", qty: 1, priceEach: 100 }] },
      payments: [{ id: "pay-1", amount: 25, method: "cash", status: "paid", paidAt: "2026-08-24" }],
    },
  });

  expect(result.invoicePayload).toEqual(expect.objectContaining({
    company_id: "company-1",
    legacy_local_id: "inv-local",
    customer_id: "cust-cloud",
    project_id: "proj-cloud",
    estimate_id: "est-cloud",
    total_amount: 100,
    amount_paid: 25,
    balance_remaining: 75,
  }));
  expect(result.paymentPayloads).toEqual([expect.objectContaining({
    company_id: "company-1",
    invoice_id: "inv-cloud",
    legacy_local_id: "pay-1",
    paid_at: "2026-08-24T00:00:00.000Z",
  })]);
  expect(result.lineItemIssues.filter((notice) => notice.level === "error")).toEqual([]);
  expect(result.lineItemPayloads[0]).toEqual(expect.objectContaining({ invoice_id: "inv-cloud" }));
});

test("target estimate adapter reuses the mapper, persisted contract, verbatim restore payload, and line identity contract", () => {
  const estimate = {
    id: "estimate-2606",
    estimateNumber: "EST-2606",
    customerId: "customer-local",
    projectId: "project-local",
    status: "draft",
    total: 6000,
    materials: { items: [{ id: "material-1", desc: "Fixtures", qty: 1, priceEach: 2000 }] },
  };
  const result = buildTargetEstimatePersistencePayloads({
    companyId: "company-1",
    userId: "user-1",
    customerId: "customer-cloud",
    projectId: "project-cloud",
    estimateId: "estimate-cloud",
    estimate,
  });

  expect(result.estimatePayload).toEqual(expect.objectContaining({
    company_id: "company-1",
    legacy_local_id: "estimate-2606",
    customer_id: "customer-cloud",
    project_id: "project-cloud",
    estimate_number: "EST-2606",
    total_amount: 6000,
    restore_payload: expect.objectContaining({ legacyLocalId: "estimate-2606", estimate }),
    restore_payload_version: expect.any(String),
  }));
  expect(result.lineItemIssues.filter((notice) => notice.level === "error")).toEqual([]);
  expect(result.lineItemPayloads).toEqual([
    expect.objectContaining({
      company_id: "company-1",
      legacy_local_id: "estimate:estimate-2606:line:0",
      estimate_id: "estimate-cloud",
      line_role: "material",
      quantity: 1,
      unit_price: null,
    }),
  ]);
  expect(result.estimatePayload.restore_payload.estimate.materials.items[0].priceEach).toBe(2000);
});
