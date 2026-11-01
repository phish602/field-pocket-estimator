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
  // The project the conversion creates is queued ahead of the invoice that
  // references it, so the invoice never syncs before its parent exists.
  const entries = readCloudMutationLedger().entries;
  expect(entries.map((entry) => [entry.entityType, entry.documentId])).toEqual([
    ["project", "proj-1"],
    ["invoice", conversion.draft.id],
  ]);
  expect(entries[1]).toEqual(expect.objectContaining({
    documentId: conversion.draft.id,
    reason: "estimate_converted_to_invoice",
  }));
  expect(entries[1].payload.invoiceTotal).toBe(240);
});

function stagedApproval() {
  const before = {
    id: "est-approval", docType: "estimate", estimateNumber: "EST-2", status: "draft",
    customerId: "cust-1", projectId: "proj-1", total: 405,
    ui: { materialsMode: "itemized" },
    labor: { hazardPct: 0, riskPct: 0, multiplier: 1, lines: [{ id: "labor-1", role: "Technician", hours: 2, rate: 100 }] },
    materials: { items: [{ id: "material-1", description: "Fixture", qty: 3, priceEach: 60 }] },
    additionalCharges: { items: [{ id: "charge-1", description: "Service", qty: 1, unitPrice: 25 }] },
  };
  const unchanged = { ...before, id: "est-unrelated", estimateNumber: "EST-OTHER" };
  const approved = { ...before, status: "approved" };
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([before, unchanged]));
  const conversion = createInvoiceBuilderDraftFromEstimate(approved, []);
  expect(conversion.ok).toBe(true);
  expect(conversion.draft.invoiceTotal).toBe(405);
  const event = {
    companyId: "company-1", source: "EstimateForm.convertApprovedEstimate",
    additionalWrites: [{ key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([approved, unchanged]) }],
  };
  return { before, approved, unchanged, conversion, event };
}

test("atomic approval/conversion queues the approved estimate before its invoice with complete immutable intent", async () => {
  const { approved, unchanged, conversion, event } = stagedApproval();
  const queueBefore = readCloudBackupQueueState();
  const result = await commitStoredInvoices([conversion.draft], event);
  const entries = readCloudMutationLedger().entries;
  const estimateEntries = entries.filter(entry => entry.entityType === "estimate");
  const invoiceEntries = entries.filter(entry => entry.entityType === "invoice");
  expect(estimateEntries).toHaveLength(1);
  expect(invoiceEntries).toHaveLength(1);
  expect(estimateEntries[0]).toEqual(expect.objectContaining({
    companyId: "company-1", documentId: approved.id, operation: "upsert", status: "pending", payload: approved,
  }));
  expect(estimateEntries[0].revision).toBeLessThan(invoiceEntries[0].revision);
  expect(invoiceEntries[0].payload.sourceEstimateId).toBe(approved.id);
  expect(invoiceEntries[0].payload.projectId).toBe(approved.projectId);
  expect(invoiceEntries[0].payload.total).toBe(405);
  expect(result.invoices).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toEqual([approved, unchanged]);
  expect(runtimeCommitAtomicRecords).toHaveBeenCalledTimes(1);
  const committed = runtimeCommitAtomicRecords.mock.calls[0][0];
  [STORAGE_KEYS.ESTIMATES, STORAGE_KEYS.INVOICES, STORAGE_KEYS.CLOUD_MUTATION_LEDGER].forEach(key => {
    expect(committed.filter(record => record.logicalKey === key)).toHaveLength(1);
  });
  expect(readCloudBackupQueueState()).toEqual(queueBefore);
  approved.materials.items[0].priceEach = 999;
  expect(estimateEntries[0].payload.materials.items[0].priceEach).toBe(60);
});

test("repeating the same staged approval creates no duplicate estimate or invoice mutation", async () => {
  const { conversion, event } = stagedApproval();
  const first = await commitStoredInvoices([conversion.draft], event);
  const ledgerBefore = readCloudMutationLedger();
  await commitStoredInvoices(first.invoices, event);
  expect(readCloudMutationLedger()).toEqual(ledgerBefore);
  expect(ledgerBefore.entries.filter(entry => entry.entityType === "estimate")).toHaveLength(1);
  expect(ledgerBefore.entries.filter(entry => entry.entityType === "invoice")).toHaveLength(1);
});

test("failed atomic approval/conversion preserves the draft and accepts neither business change nor ledger entry", async () => {
  const { before, unchanged, conversion, event } = stagedApproval();
  runtimeCommitAtomicRecords.mockRejectedValueOnce(new Error("durability_failed"));
  await expect(commitStoredInvoices([conversion.draft], event)).rejects.toThrow("durability_failed");
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toEqual([before, unchanged]);
  expect(localStorage.getItem(STORAGE_KEYS.INVOICES)).toBeNull();
  expect(readCloudMutationLedger().entries).toEqual([]);
});

test.each(["{broken", "{}", "null"])("malformed staged estimates %s cannot accept an invoice without its approval intent", async value => {
  const { before, unchanged, conversion, event } = stagedApproval();
  event.additionalWrites[0].value = value;
  await expect(commitStoredInvoices([conversion.draft], event)).rejects.toThrow();
  expect(runtimeCommitAtomicRecords).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toEqual([before, unchanged]);
  expect(readCloudMutationLedger().entries).toEqual([]);
});

test("duplicate staged estimate writes derive exactly one mutation from the final committed value", async () => {
  const { before, approved, unchanged, conversion, event } = stagedApproval();
  event.additionalWrites.unshift({ key: STORAGE_KEYS.ESTIMATES, value: JSON.stringify([before, unchanged]) });
  await commitStoredInvoices([conversion.draft], event);
  expect(readCloudMutationLedger().entries.filter(entry => entry.entityType === "estimate"))
    .toEqual([expect.objectContaining({ documentId: approved.id, payload: approved })]);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toEqual([approved, unchanged]);
});
