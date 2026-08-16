jest.mock("../lib/cloudBackupQueue", () => {
  const actual = jest.requireActual("../lib/cloudBackupQueue");
  return {
    ...actual,
    commitAtomicCloudQueuedBusinessMutation: async ({ writes = [] }) => {
      writes.forEach(({ key, value }) => globalThis.localStorage.setItem(key, value));
      return { ok: true, revision: 1, queue: {}, keys: writes.map(({ key }) => key) };
    },
  };
});

import {
  commitStoredInvoices,
  INVOICE_STATUSES,
  INVOICE_TYPES,
  createInvoiceBuilderDraftFromEstimate,
  readStoredInvoices,
  validateInvoiceAgainstEstimate,
} from "./invoices";
import { computeTotals } from "../estimator/engine";
import { STORAGE_KEYS } from "../constants/storageKeys";

const ESTIMATE_ID = "est_billing_1";

function approvedEstimate() {
  return {
    id: ESTIMATE_ID,
    docType: "estimate",
    estimateNumber: "EST-7001",
    status: "approved",
    customerId: "cust_1",
    customerName: "Jose Martinez",
    projectId: "proj_1",
    projectName: "Bathroom remodel",
    total: 1000,
    invoiceTotal: 1000,
    ui: { materialsMode: "blanket" },
    labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [] },
    materials: { blanketCost: "1000", markupPct: 0, items: [] },
  };
}

function childInvoice(id, total) {
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
  };
}

function engineTotal(draft) {
  const totals = computeTotals(draft);
  return Number(totals?.invoiceTotal ?? totals?.total ?? totals?.grandTotal ?? totals?.totalRevenue ?? 0);
}

describe("intentional billing reaches the canonical creation helper", () => {
  beforeEach(() => localStorage.clear());

  test("a deposit for 25% bills 250 and keeps its billing intent", () => {
    const result = createInvoiceBuilderDraftFromEstimate(approvedEstimate(), [], {
      invoiceType: INVOICE_TYPES.DEPOSIT,
      requestedValue: "25%",
    });

    expect(result.ok).toBe(true);
    expect(result.draft.invoiceTotal).toBe(250);
    expect(result.draft.invoiceType).toBe(INVOICE_TYPES.DEPOSIT);
    expect(result.draft.invoiceMeta.amountMode).toBe("percent");
    expect(result.draft.invoiceMeta.requestedPercent).toBe(25);
    // The intent must survive the engine, not just the object.
    expect(engineTotal(result.draft)).toBeCloseTo(250, 2);
  });

  test("a progress draw for a dollar amount bills that amount", () => {
    const result = createInvoiceBuilderDraftFromEstimate(approvedEstimate(), [], {
      invoiceType: INVOICE_TYPES.PROGRESS,
      requestedValue: "250",
    });

    expect(result.ok).toBe(true);
    expect(result.draft.invoiceTotal).toBe(250);
    expect(result.draft.invoiceType).toBe(INVOICE_TYPES.PROGRESS);
    expect(result.draft.invoiceMeta.amountMode).toBe("amount");
    expect(engineTotal(result.draft)).toBeCloseTo(250, 2);
  });

  test("an explicit request above the remaining balance is refused outright", () => {
    const result = createInvoiceBuilderDraftFromEstimate(
      approvedEstimate(),
      [childInvoice("INV-1", 800)],
      { invoiceType: INVOICE_TYPES.PROGRESS, requestedValue: "300" }
    );

    expect(result.ok).toBe(false);
    expect(result.draft).toBeUndefined();
  });

  test("due date and note reach the created draft", () => {
    const result = createInvoiceBuilderDraftFromEstimate(approvedEstimate(), [], {
      invoiceType: INVOICE_TYPES.DEPOSIT,
      requestedValue: "10%",
      dueDate: "2027-03-04",
      note: "Mobilization deposit",
    });

    expect(result.ok).toBe(true);
    expect(result.draft.dueDate).toBe("2027-03-04");
    expect(JSON.stringify(result.draft)).toContain("Mobilization deposit");
  });

  test("an explicit request still validates against the estimate", () => {
    const estimate = approvedEstimate();
    const invoices = [childInvoice("INV-1", 400)];
    const result = createInvoiceBuilderDraftFromEstimate(estimate, invoices, {
      invoiceType: INVOICE_TYPES.PROGRESS,
      requestedValue: "300",
    });

    expect(result.ok).toBe(true);
    expect(result.draft.invoiceTotal).toBe(300);
    expect(validateInvoiceAgainstEstimate(result.draft, estimate, invoices).ok).toBe(true);
  });

  test("without billing options the proven defaults are untouched", () => {
    // First invoice: full approved total.
    expect(createInvoiceBuilderDraftFromEstimate(approvedEstimate(), []).draft.invoiceTotal).toBe(1000);
    // Follow-up: exact remainder.
    expect(
      createInvoiceBuilderDraftFromEstimate(approvedEstimate(), [childInvoice("INV-1", 400)]).draft.invoiceTotal
    ).toBe(600);
  });

  test("an explicit final with no amount still means the remaining balance", () => {
    const result = createInvoiceBuilderDraftFromEstimate(approvedEstimate(), [childInvoice("INV-1", 400)], {
      invoiceType: INVOICE_TYPES.FINAL,
    });

    expect(result.ok).toBe(true);
    expect(result.draft.invoiceTotal).toBe(600);
  });

  test("the source estimate is never rewritten to represent partial billing", () => {
    const estimate = approvedEstimate();
    const before = JSON.stringify(estimate);
    createInvoiceBuilderDraftFromEstimate(estimate, [], {
      invoiceType: INVOICE_TYPES.DEPOSIT,
      requestedValue: "25%",
    });
    expect(JSON.stringify(estimate)).toBe(before);
  });

  test("a normal canonical save does not promote an unrelated invoice-shaped Estimate record", async () => {
    const legacyInvoice = childInvoice("INV-LEGACY", 125);
    localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([legacyInvoice]));

    const canonicalInvoice = childInvoice("inv_canonical_1", 250);
    await commitStoredInvoices([canonicalInvoice, ...readStoredInvoices()], {
      source: "invoices.intentionalBilling.test",
      documentId: canonicalInvoice.id,
    });

    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES) || "[]")).toEqual([
      expect.objectContaining({ id: "inv_canonical_1", invoiceNumber: "inv_canonical_1" }),
    ]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES) || "[]")).toEqual([legacyInvoice]);
  });
});
