import {
  INVOICE_STATUSES,
  buildEstimateInvoiceSummary,
  createInvoiceBuilderDraftFromEstimate,
  validateInvoiceAgainstEstimate,
} from "./invoices";
import { computeTotals } from "../estimator/engine";

const ESTIMATE_ID = "est_partial_1";

function approvedEstimate(overrides = {}) {
  return {
    id: ESTIMATE_ID,
    docType: "estimate",
    estimateNumber: "EST-5001",
    status: "approved",
    customerId: "cust_1",
    customerName: "Jose Martinez",
    projectId: "proj_1",
    projectName: "Bathroom remodel",
    projectNumber: "P-1",
    total: 10000,
    invoiceTotal: 10000,
    ui: { materialsMode: "blanket" },
    labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [] },
    materials: { blanketCost: "10000", markupPct: 0, items: [] },
    ...overrides,
  };
}

function childInvoice(id, total, overrides = {}) {
  return {
    id,
    docType: "invoice",
    invoiceNumber: id,
    status: INVOICE_STATUSES.SENT,
    sourceEstimateId: ESTIMATE_ID,
    invoiceTotal: total,
    total,
    amountPaid: 0,
    balanceRemaining: total,
    ...overrides,
  };
}

// The amount the builder's own engine will settle on for this draft. A draft
// that merely carries the right invoiceTotal but recomputes to something else
// is the exact defect under test, so the engine gets the final word here.
function engineTotal(draft) {
  const totals = computeTotals(draft);
  return Number(
    totals?.invoiceTotal
    ?? totals?.total
    ?? totals?.grandTotal
    ?? totals?.totalRevenue
    ?? 0
  );
}

describe("canonical builder conversion respects the remaining balance", () => {
  test("a first invoice bills the full approved total", () => {
    const estimate = approvedEstimate();
    const result = createInvoiceBuilderDraftFromEstimate(estimate, []);

    expect(result.ok).toBe(true);
    expect(result.draft.invoiceTotal).toBe(10000);
    expect(result.draft.balanceRemaining).toBe(10000);
    expect(String(result.draft.sourceEstimateId)).toBe(ESTIMATE_ID);
  });

  test("a partial follow-up bills exactly the remainder and validates", () => {
    const estimate = approvedEstimate();
    const invoices = [childInvoice("INV-1", 6000)];
    const result = createInvoiceBuilderDraftFromEstimate(estimate, invoices);

    expect(result.ok).toBe(true);
    expect(result.draft.invoiceTotal).toBe(4000);
    expect(result.draft.total).toBe(4000);
    expect(result.draft.balanceRemaining).toBe(4000);
    expect(String(result.draft.sourceEstimateId)).toBe(ESTIMATE_ID);
    expect(result.draft.customerName).toBe("Jose Martinez");
    expect(result.draft.projectName).toBe("Bathroom remodel");

    // The existing safeguard must accept it rather than be relaxed for it.
    const validation = validateInvoiceAgainstEstimate(result.draft, estimate, invoices);
    expect(validation.ok).toBe(true);
  });

  test("the partial amount is what the calculation engine reproduces", () => {
    const estimate = approvedEstimate();
    const result = createInvoiceBuilderDraftFromEstimate(estimate, [childInvoice("INV-1", 6000)]);

    // This is the regression that a plain invoiceTotal patch would fail: the
    // builder hydrates the draft and recalculates it.
    expect(engineTotal(result.draft)).toBeCloseTo(4000, 2);
  });

  test("multiple prior invoices are summed", () => {
    const estimate = approvedEstimate();
    const invoices = [childInvoice("INV-1", 2500), childInvoice("INV-2", 3500)];
    const result = createInvoiceBuilderDraftFromEstimate(estimate, invoices);

    expect(result.ok).toBe(true);
    expect(result.draft.invoiceTotal).toBe(4000);
    expect(engineTotal(result.draft)).toBeCloseTo(4000, 2);
  });

  test("a void child does not consume the remainder", () => {
    const estimate = approvedEstimate();
    const invoices = [childInvoice("INV-1", 6000, { status: INVOICE_STATUSES.VOID })];

    expect(buildEstimateInvoiceSummary(estimate, invoices).remainingToInvoice).toBe(10000);

    const result = createInvoiceBuilderDraftFromEstimate(estimate, invoices);
    expect(result.ok).toBe(true);
    expect(result.draft.invoiceTotal).toBe(10000);
  });

  test("a fully invoiced estimate is blocked with no draft", () => {
    const estimate = approvedEstimate();
    const result = createInvoiceBuilderDraftFromEstimate(estimate, [childInvoice("INV-1", 10000)]);

    expect(result.ok).toBe(false);
    expect(result.draft).toBeUndefined();
  });

  test("partial draft financials describe the partial invoice, not the estimate", () => {
    const estimate = approvedEstimate();
    const result = createInvoiceBuilderDraftFromEstimate(estimate, [childInvoice("INV-1", 6000)]);
    const draft = result.draft;

    expect(draft.invoiceTotal).toBe(4000);
    expect(draft.total).toBe(4000);
    expect(draft.balanceRemaining).toBe(4000);
    expect(draft.amountPaid).toBe(0);
    // The source estimate's approved total is retained where it means exactly
    // that, so the two figures never contradict each other.
    expect(draft.invoiceMeta.approvedTotalAtCreation).toBe(10000);
    expect(draft.invoiceMeta.remainingToInvoiceAtCreation).toBe(4000);
  });

  test("cumulative billing lands on the approved total and never above it", () => {
    const estimate = approvedEstimate();
    const invoices = [childInvoice("INV-1", 6000)];
    const result = createInvoiceBuilderDraftFromEstimate(estimate, invoices);

    expect(6000 + result.draft.invoiceTotal).toBe(10000);
  });

  test("conversion leaves the source estimate untouched", () => {
    const estimate = approvedEstimate();
    const before = JSON.stringify(estimate);
    createInvoiceBuilderDraftFromEstimate(estimate, [childInvoice("INV-1", 6000)]);
    expect(JSON.stringify(estimate)).toBe(before);
  });
});
