import { runtimeCommitAtomicRecords } from "../lib/vaultRuntimeStore";
import { readCloudMutationLedger } from "../lib/cloudMutationLedger";
import { readCloudBackupQueueState } from "../lib/cloudBackupQueue";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { commitStoredInvoices, createInvoiceBuilderDraftFromEstimate } from "./invoices";

jest.mock("../lib/vaultRuntimeStore", () => ({
  runtimeCommitAtomicRecords: jest.fn(),
}));

function invoice(overrides = {}) {
  return {
    id: "inv-ledger-1",
    docType: "invoice",
    invoiceNumber: "INV-1001",
    status: "sent",
    paymentStatus: "unpaid",
    date: "2026-08-23",
    dueDate: "2026-09-23",
    invoiceTotal: 100,
    total: 100,
    amountPaid: 0,
    balanceRemaining: 100,
    lineItems: [{ id: "line-1", description: "Work", quantity: 1, unitPrice: 100, total: 100 }],
    payments: [],
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  runtimeCommitAtomicRecords.mockReset();
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
});

test("invoice save, payment add, and payment-date edit append exact immutable revisions", async () => {
  const created = await commitStoredInvoices([invoice()], { companyId: "company-1" });
  const withPayment = {
    ...created.invoices[0],
    paymentStatus: "partial",
    amountPaid: 25,
    balanceRemaining: 75,
    payments: [{ id: "pay-1", amount: 25, method: "cash", status: "paid", paidAt: "2026-08-23T12:00:00.000Z" }],
  };
  await commitStoredInvoices([withPayment], { companyId: "company-1", reason: "invoice_payment_added" });
  const corrected = { ...withPayment, payments: [{ ...withPayment.payments[0], paidAt: "2026-08-24T12:00:00.000Z" }] };
  await commitStoredInvoices([corrected], { companyId: "company-1", reason: "invoice_payment_date_edited" });

  const entries = readCloudMutationLedger().entries;
  const invoiceEntries = entries.filter((entry) => entry.entityType === "invoice");
  const projectEntries = entries.filter((entry) => entry.entityType === "project");
  expect(invoiceEntries).toHaveLength(3);
  expect(projectEntries).toHaveLength(1);
  expect(entries.map((entry) => entry.revision)).toEqual([1, 2, 3, 4]);
  expect(invoiceEntries[1].payload.payments[0].paidAt).toBe("2026-08-23");
  expect(invoiceEntries[2].payload.payments[0].paidAt).toBe("2026-08-24");
  expect(invoiceEntries[0].payload.payments).toEqual([]);
});

test("canonical no-op save appends no mutation and performs no second commit", async () => {
  const first = await commitStoredInvoices([invoice()], { companyId: "company-1" });
  const before = readCloudMutationLedger();
  const result = await commitStoredInvoices(first.invoices, { companyId: "company-1" });
  expect(readCloudMutationLedger()).toEqual(before);
  expect(result.mutations || []).toHaveLength(0);
});

test("estimate conversion result enters the ledger without changing conversion math", async () => {
  const estimate = {
    id: "est-ledger", docType: "estimate", estimateNumber: "EST-1", status: "approved",
    customerId: "cust-1", projectId: "proj-1", total: 240, invoiceTotal: 240,
    ui: { materialsMode: "blanket" }, labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [] },
    materials: { blanketCost: "240", markupPct: 0, items: [] },
  };
  const conversion = createInvoiceBuilderDraftFromEstimate(estimate, []);
  expect(conversion.ok).toBe(true);
  expect(conversion.draft.invoiceTotal).toBe(240);
  await commitStoredInvoices([conversion.draft], { companyId: "company-1", reason: "estimate_converted_to_invoice" });
  expect(readCloudMutationLedger().entries[0]).toEqual(expect.objectContaining({
    documentId: conversion.draft.id,
    reason: "estimate_converted_to_invoice",
  }));
});
