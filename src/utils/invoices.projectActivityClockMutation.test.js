// UNCHANGED INVOICE SAVE MUST NOT QUEUE A PROJECT UPSERT.
//
// Every invoice save re-derives the invoice's project, which advances that
// project's local activity clock (updatedAt) to the save time. The clock is
// local ordering only -- the persisted cloud project row does not carry it --
// yet commitStoredInvoices queued a "project_backfilled_from_invoice" upsert
// for it on every save, rewriting and re-verifying an identical cloud row.

import { runtimeCommitAtomicRecords } from "../lib/vaultRuntimeStore";
import { readCloudMutationLedger } from "../lib/cloudMutationLedger";
import { readCloudBackupQueueState } from "../lib/cloudBackupQueue";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { commitStoredInvoices } from "./invoices";

jest.mock("../lib/vaultRuntimeStore", () => ({
  runtimeCommitAtomicRecords: jest.fn(),
}));

const FIRST_SAVE = Date.parse("2026-10-31T10:20:00.000Z");
const LATER_SAVE = Date.parse("2026-10-31T11:06:00.000Z");

function invoice(overrides = {}) {
  return {
    id: "inv_clean_lane",
    docType: "invoice",
    invoiceNumber: "INV-0001",
    projectId: "proj_clean_lane",
    projectName: "Clean Lane AC Replacement",
    customerName: "Dana Fixture",
    status: "sent",
    paymentStatus: "partial",
    date: "2026-10-31",
    dueDate: "2026-10-31",
    invoiceTotal: 4440,
    total: 4440,
    amountPaid: 1500,
    balanceRemaining: 2940,
    lineItems: [{ id: "line-1", kind: "labor", description: "technician", quantity: 1, hours: 12, price: 95, unitCost: 45 }],
    payments: [{ id: "pay-1", amount: 1500, method: "check", status: "paid", paidAt: "2026-10-31", note: "Clean-lane test deposit" }],
    createdAt: FIRST_SAVE,
    updatedAt: FIRST_SAVE,
    savedAt: FIRST_SAVE,
    ...overrides,
  };
}

const ledgerEntries = (entityType) => readCloudMutationLedger().entries.filter((entry) => entry.entityType === entityType);
const storedProject = () => JSON.parse(localStorage.getItem(STORAGE_KEYS.PROJECTS))
  .find((project) => project.id === "proj_clean_lane");

beforeEach(() => {
  localStorage.clear();
  runtimeCommitAtomicRecords.mockReset();
  runtimeCommitAtomicRecords.mockImplementation(async (records) => {
    records.forEach(({ logicalKey, value }) => localStorage.setItem(logicalKey, value));
    return { ok: true };
  });
});

test("the first save still queues the project the invoice creates", async () => {
  await commitStoredInvoices([invoice()], { companyId: "company-1" });

  const projects = ledgerEntries("project");
  expect(projects).toHaveLength(1);
  expect(projects[0]).toEqual(expect.objectContaining({ documentId: "proj_clean_lane", operation: "upsert" }));
});

test("re-saving the unchanged invoice later queues no project upsert", async () => {
  await commitStoredInvoices([invoice()], { companyId: "company-1" });
  const before = storedProject();
  const ledgerBefore = readCloudMutationLedger().entries.length;

  await commitStoredInvoices([invoice({ updatedAt: LATER_SAVE, savedAt: LATER_SAVE })], { companyId: "company-1" });

  // The project's local activity clock still moves forward on this device ...
  const after = storedProject();
  expect(after.updatedAt).toBeGreaterThan(before.updatedAt);
  const { updatedAt: beforeClock, ...beforeRest } = before;
  const { updatedAt: afterClock, ...afterRest } = after;
  expect(afterRest).toEqual(beforeRest);
  // ... but nothing is queued for the cloud: no project or invoice mutation.
  expect(readCloudMutationLedger().entries).toHaveLength(ledgerBefore);
  expect(ledgerEntries("project")).toHaveLength(1);
  // And no legacy whole-workspace backup work is created in its place.
  expect(readCloudBackupQueueState().pending).toBe(false);
});

test("an invoice change still queues its invoice mutation, without a timestamp-only project upsert", async () => {
  await commitStoredInvoices([invoice()], { companyId: "company-1" });

  await commitStoredInvoices([invoice({
    updatedAt: LATER_SAVE,
    savedAt: LATER_SAVE,
    terms: "Net 30",
  })], { companyId: "company-1" });

  expect(ledgerEntries("invoice")).toHaveLength(2);
  expect(ledgerEntries("project")).toHaveLength(1);
});

// The builder stages its own project list alongside the invoice. That staged
// list is what is stored, so it is what must be queued -- ahead of the invoice
// that references the project.
test("a project the builder stages with the invoice is queued ahead of the invoice", async () => {
  const builderProject = {
    id: "proj_clean_lane",
    customerId: "cust_clean_lane",
    projectName: "Clean Lane AC Replacement",
    status: "active",
    siteAddress: "100 Builder Way",
    createdAt: FIRST_SAVE,
    updatedAt: FIRST_SAVE,
  };

  await commitStoredInvoices([invoice()], {
    companyId: "company-1",
    source: "EstimateForm.saveInvoice",
    additionalWrites: [{ key: STORAGE_KEYS.PROJECTS, value: JSON.stringify([builderProject]) }],
  });

  const entries = readCloudMutationLedger().entries;
  expect(entries.map((entry) => entry.entityType)).toEqual(["project", "invoice"]);
  expect(entries[0].payload).toEqual(builderProject);
  expect(storedProject()).toEqual(builderProject);
});

test("a project change the invoice really makes still queues the project", async () => {
  await commitStoredInvoices([invoice()], { companyId: "company-1" });

  await commitStoredInvoices([invoice({
    updatedAt: LATER_SAVE,
    savedAt: LATER_SAVE,
    projectId: "proj_second_job",
    projectName: "Second Job",
  })], { companyId: "company-1" });

  const projects = ledgerEntries("project");
  expect(projects.map((entry) => entry.documentId)).toContain("proj_second_job");
});
