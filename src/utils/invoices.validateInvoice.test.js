import { validateInvoiceAgainstEstimate } from "./invoices";

function createEstimate(overrides = {}) {
  return {
    id: "est_1",
    total: 1000,
    approvedTotal: 1000,
    ...overrides,
  };
}

function createLinkedInvoice(overrides = {}) {
  return {
    id: "inv_1",
    docType: "invoice",
    sourceEstimateId: "est_1",
    invoiceTotal: 500,
    total: 500,
    status: "sent",
    paymentStatus: "unpaid",
    amountPaid: 0,
    balanceRemaining: 500,
    ...overrides,
  };
}

describe("validateInvoiceAgainstEstimate void invoice exclusion", () => {
  test("void-only linked invoices leave the full approved balance available for a new invoice", () => {
    const estimate = createEstimate({ total: 1000 });
    const voidInvoice = createLinkedInvoice({
      id: "inv_void",
      invoiceTotal: 1000,
      total: 1000,
      status: "void",
      paymentStatus: "void",
      amountPaid: 0,
      balanceRemaining: 0,
    });
    const newInvoice = createLinkedInvoice({
      id: "inv_new",
      invoiceTotal: 1000,
      total: 1000,
      status: "draft",
      paymentStatus: "unpaid",
      amountPaid: 0,
      balanceRemaining: 1000,
    });

    const result = validateInvoiceAgainstEstimate({
      invoice: newInvoice,
      estimate,
      invoices: [voidInvoice],
    });

    expect(result.ok).toBe(true);
    expect(result.summary.invoicedTotal).toBe(0);
    expect(result.summary.remainingToInvoice).toBe(1000);
    expect(result.summary.activeInvoiceCount).toBe(0);
    expect(result.summary.linkedInvoiceCount).toBe(1);
  });

  test("void-only linked invoices do not block a new invoice that would exceed the estimate if void counted", () => {
    // Scenario: estimate for $800, one voided $800 invoice exists.
    // Without void exclusion, a new $800 invoice would appear to over-invoice ($1600 > $800).
    // With correct void exclusion, the new invoice should be allowed.
    const estimate = createEstimate({ total: 800 });
    const voidInvoice = createLinkedInvoice({
      id: "inv_void_800",
      invoiceTotal: 800,
      total: 800,
      status: "void",
      paymentStatus: "void",
      amountPaid: 0,
      balanceRemaining: 0,
    });
    const newInvoice = createLinkedInvoice({
      id: "inv_replacement",
      invoiceTotal: 800,
      total: 800,
      status: "draft",
      paymentStatus: "unpaid",
      amountPaid: 0,
      balanceRemaining: 800,
    });

    const result = validateInvoiceAgainstEstimate({
      invoice: newInvoice,
      estimate,
      invoices: [voidInvoice],
    });

    expect(result.ok).toBe(true);
    expect(result.summary.invoicedTotal).toBe(0);
    expect(result.summary.remainingToInvoice).toBe(800);
  });

  test("mixed void and non-void linked invoices count only the non-void total against remaining balance", () => {
    const estimate = createEstimate({ total: 1000 });
    const voidInvoice = createLinkedInvoice({
      id: "inv_void_600",
      invoiceTotal: 600,
      total: 600,
      status: "void",
      paymentStatus: "void",
      amountPaid: 0,
      balanceRemaining: 0,
    });
    const activeInvoice = createLinkedInvoice({
      id: "inv_active_400",
      invoiceTotal: 400,
      total: 400,
      status: "sent",
      paymentStatus: "unpaid",
      amountPaid: 0,
      balanceRemaining: 400,
    });
    const newInvoice = createLinkedInvoice({
      id: "inv_new_600",
      invoiceTotal: 600,
      total: 600,
      status: "draft",
      paymentStatus: "unpaid",
      amountPaid: 0,
      balanceRemaining: 600,
    });

    const result = validateInvoiceAgainstEstimate({
      invoice: newInvoice,
      estimate,
      invoices: [voidInvoice, activeInvoice],
    });

    expect(result.ok).toBe(true);
    // Active invoice ($400) reduces remaining balance; void ($600) does not
    expect(result.summary.invoicedTotal).toBe(400);
    expect(result.summary.remainingToInvoice).toBe(600);
    expect(result.summary.activeInvoiceCount).toBe(1);
    expect(result.summary.linkedInvoiceCount).toBe(2);
  });

  test("mixed void and non-void linked invoices block a new invoice that exceeds the non-void remaining balance", () => {
    const estimate = createEstimate({ total: 1000 });
    const voidInvoice = createLinkedInvoice({
      id: "inv_void_600",
      invoiceTotal: 600,
      total: 600,
      status: "void",
      paymentStatus: "void",
      amountPaid: 0,
      balanceRemaining: 0,
    });
    const activeInvoice = createLinkedInvoice({
      id: "inv_active_400",
      invoiceTotal: 400,
      total: 400,
      status: "sent",
      paymentStatus: "unpaid",
      amountPaid: 0,
      balanceRemaining: 400,
    });
    // New invoice asks for $601 — exceeds the $600 remaining after non-void invoice
    const oversizedInvoice = createLinkedInvoice({
      id: "inv_oversized",
      invoiceTotal: 601,
      total: 601,
      status: "draft",
      paymentStatus: "unpaid",
      amountPaid: 0,
      balanceRemaining: 601,
    });

    const result = validateInvoiceAgainstEstimate({
      invoice: oversizedInvoice,
      estimate,
      invoices: [voidInvoice, activeInvoice],
    });

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/remaining/i);
  });
});
