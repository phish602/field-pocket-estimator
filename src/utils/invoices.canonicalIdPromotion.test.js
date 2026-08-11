// Regression guard for the id-less legacy Invoice crossing into canonical
// Invoice storage.
//
// Phase 3 correctly made read normalization NON-MINTING: an old id-less legacy
// invoice (a `docType: "invoice"` record still living in Estimate storage) no
// longer gets a fresh random id every time it is merely read. That part must
// stay.
//
// What was missing is the other half of the lifecycle. readStoredInvoices()
// MERGES those legacy records with canonical ones, and that merged collection is
// what a later save writes back -- so an id-less legacy invoice could land in
// canonical invoice storage with NO id at all, which the unchanged cloud
// convergence engine correctly reports as data_mismatch.
//
// Promotion must happen exactly once, at the authoritative write boundary.

import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  normalizeInvoiceList,
  normalizeInvoiceRecord,
  readStoredInvoices,
  writeStoredInvoices,
} from "./invoices";

const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;

const readRaw = (key) => JSON.parse(localStorage.getItem(key) || "[]");

// An old invoice as it actually sits in Estimate storage: real business number,
// no canonical id, no meta.savedDocId.
function legacyInvoiceWithoutId(overrides = {}) {
  return {
    docType: "invoice",
    invoiceNumber: "INV-1001",
    job: { docNumber: "INV-1001", date: "2026-01-05" },
    status: "sent",
    date: "2026-01-05",
    invoiceTotal: 1200,
    total: 1200,
    customerId: "cust_legacy",
    customer: { id: "cust_legacy", name: "Legacy Co" },
    materials: {
      items: [{ id: "m0", desc: "Panel upgrade", qty: 1, priceEach: 1200 }],
    },
    ...overrides,
  };
}

function modernInvoice(overrides = {}) {
  return {
    id: "inv_modern_b",
    docType: "invoice",
    invoiceNumber: "INV-1002",
    job: { docNumber: "INV-1002", date: "2026-02-10" },
    status: "sent",
    date: "2026-02-10",
    invoiceTotal: 500,
    total: 500,
    customerId: "cust_modern",
    customer: { id: "cust_modern", name: "Modern Co" },
    materials: {
      items: [{ id: "m0", desc: "Service call", qty: 1, priceEach: 500 }],
    },
    meta: { savedDocId: "inv_modern_b", savedDocCreatedAt: 1770000000000 },
    ...overrides,
  };
}

function realEstimate() {
  return {
    id: "est_real_1",
    docType: "estimate",
    estimateNumber: "EST-2001",
    status: "pending",
    date: "2026-01-20",
    total: 4000,
    customerId: "cust_legacy",
    customer: { id: "cust_legacy", name: "Legacy Co" },
  };
}

const idlessCount = (invoices) => invoices.filter((invoice) => !String(invoice?.id || "").trim()).length;

beforeEach(() => {
  localStorage.clear();
});

describe("TEST 1 - read does not mint", () => {
  test("repeated normalization of an id-less legacy Invoice never invents an id", () => {
    const legacy = legacyInvoiceWithoutId();

    const once = normalizeInvoiceRecord(legacy);
    const twice = normalizeInvoiceRecord(once);
    const thrice = normalizeInvoiceRecord(twice);

    expect(String(once.id || "")).toBe("");
    expect(String(twice.id || "")).toBe("");
    expect(String(thrice.id || "")).toBe("");
    // The business number is untouched and is never promoted into identity.
    expect(thrice.invoiceNumber).toBe("INV-1001");
  });

  test("readStoredInvoices surfaces the legacy Invoice without minting an id", () => {
    localStorage.setItem(ESTIMATES_KEY, JSON.stringify([legacyInvoiceWithoutId()]));

    const first = readStoredInvoices();
    const second = readStoredInvoices();

    expect(first).toHaveLength(1);
    expect(String(first[0].id || "")).toBe("");
    expect(String(second[0].id || "")).toBe("");
    // Reading must not have written anything back.
    expect(readRaw(INVOICES_KEY)).toEqual([]);
  });
});

describe("TEST 2 - first authoritative write promotes exactly once", () => {
  test("writeStoredInvoices assigns one canonical id and pins meta.savedDocId to it", () => {
    const written = writeStoredInvoices([legacyInvoiceWithoutId()]);

    expect(written).toHaveLength(1);
    const canonicalId = written[0].id;
    expect(canonicalId).toBeTruthy();
    expect(written[0].meta.savedDocId).toBe(canonicalId);

    // Canonical identity is storage identity, never the display number.
    expect(canonicalId).not.toBe("INV-1001");
    expect(canonicalId).not.toContain("INV-");
    expect(written[0].invoiceNumber).toBe("INV-1001");

    const persisted = readRaw(INVOICES_KEY);
    expect(persisted).toHaveLength(1);
    expect(persisted[0].id).toBe(canonicalId);
    expect(persisted[0].meta.savedDocId).toBe(canonicalId);
  });

  test("an Invoice carrying only meta.savedDocId adopts it rather than minting a new id", () => {
    const written = writeStoredInvoices([
      legacyInvoiceWithoutId({ meta: { savedDocId: "inv_pinned_1", savedDocCreatedAt: 42 } }),
    ]);

    expect(written[0].id).toBe("inv_pinned_1");
    expect(written[0].meta.savedDocId).toBe("inv_pinned_1");
    // Other meta fields are preserved, not replaced.
    expect(written[0].meta.savedDocCreatedAt).toBe(42);
  });
});

describe("TEST 3 - promotion is idempotent", () => {
  test("write / read / write keeps the exact same canonical id and creates no duplicate", () => {
    const firstWrite = writeStoredInvoices([legacyInvoiceWithoutId()]);
    const canonicalId = firstWrite[0].id;

    const reread = readStoredInvoices();
    expect(reread).toHaveLength(1);
    expect(reread[0].id).toBe(canonicalId);

    const secondWrite = writeStoredInvoices(reread);
    expect(secondWrite).toHaveLength(1);
    expect(secondWrite[0].id).toBe(canonicalId);
    expect(secondWrite[0].meta.savedDocId).toBe(canonicalId);

    const thirdWrite = writeStoredInvoices(readStoredInvoices());
    expect(thirdWrite).toHaveLength(1);
    expect(thirdWrite[0].id).toBe(canonicalId);

    expect(readRaw(INVOICES_KEY)).toHaveLength(1);
    expect(idlessCount(readRaw(INVOICES_KEY))).toBe(0);
  });

  test("an already-canonical Invoice is not re-identified or churned by a write", () => {
    const modern = modernInvoice();
    const written = writeStoredInvoices([modern]);

    expect(written[0].id).toBe("inv_modern_b");
    expect(written[0].meta.savedDocId).toBe("inv_modern_b");
    expect(written[0].meta.savedDocCreatedAt).toBe(1770000000000);

    const again = writeStoredInvoices(readStoredInvoices());
    expect(again[0].id).toBe("inv_modern_b");
    expect(again[0].meta.savedDocCreatedAt).toBe(1770000000000);
  });
});

describe("TEST 4 - mixed legacy + new Invoice (the reported scenario)", () => {
  test("legacy A is promoted once, modern B is untouched, no duplicates, no id-less canonical rows", () => {
    // Legacy A lives ONLY in Estimate storage. Canonical storage starts empty.
    localStorage.setItem(ESTIMATES_KEY, JSON.stringify([legacyInvoiceWithoutId()]));
    expect(readRaw(INVOICES_KEY)).toEqual([]);

    // The application's own merged read -- A has no id at this point.
    const merged = readStoredInvoices();
    expect(merged).toHaveLength(1);
    const legacyIdBefore = String(merged[0].id || "");
    expect(legacyIdBefore).toBe("");

    // The user creates Invoice B; the save path writes the merged collection.
    // A is NOT given an id by the test -- the write boundary must do it.
    const written = writeStoredInvoices([modernInvoice(), ...merged]);

    expect(written).toHaveLength(2);
    expect(idlessCount(written)).toBe(0);

    const promotedA = written.find((invoice) => invoice.invoiceNumber === "INV-1001");
    const untouchedB = written.find((invoice) => invoice.invoiceNumber === "INV-1002");

    // Legacy A: promoted exactly once, id pinned to meta.savedDocId.
    expect(promotedA.id).toBeTruthy();
    expect(promotedA.meta.savedDocId).toBe(promotedA.id);
    expect(promotedA.id).not.toBe("INV-1001");

    // Modern B: identity unchanged.
    expect(untouchedB.id).toBe("inv_modern_b");
    expect(untouchedB.meta.savedDocId).toBe("inv_modern_b");

    // Exactly one of each in canonical storage, none id-less.
    const persisted = readRaw(INVOICES_KEY);
    expect(persisted).toHaveLength(2);
    expect(idlessCount(persisted)).toBe(0);
    expect(persisted.filter((invoice) => invoice.invoiceNumber === "INV-1001")).toHaveLength(1);
    expect(persisted.filter((invoice) => invoice.invoiceNumber === "INV-1002")).toHaveLength(1);

    // And a subsequent read/write cycle keeps both ids frozen.
    const after = writeStoredInvoices(readStoredInvoices());
    expect(after).toHaveLength(2);
    expect(after.find((invoice) => invoice.invoiceNumber === "INV-1001").id).toBe(promotedA.id);
    expect(after.find((invoice) => invoice.invoiceNumber === "INV-1002").id).toBe("inv_modern_b");
  });
});

describe("TEST 5 - legacy copy reconciled through the existing mechanism", () => {
  test("the legacy Estimate-storage copy is removed while real Estimates survive", () => {
    localStorage.setItem(
      ESTIMATES_KEY,
      JSON.stringify([legacyInvoiceWithoutId(), realEstimate()])
    );

    const written = writeStoredInvoices([modernInvoice(), ...readStoredInvoices()]);
    const promotedA = written.find((invoice) => invoice.invoiceNumber === "INV-1001");

    // Canonical A exists exactly once, with its canonical id.
    const persisted = readRaw(INVOICES_KEY);
    expect(persisted.filter((invoice) => invoice.invoiceNumber === "INV-1001")).toHaveLength(1);
    expect(persisted.find((invoice) => invoice.invoiceNumber === "INV-1001").id).toBe(promotedA.id);

    // The legacy docType:"invoice" copy is gone from Estimate storage.
    const estimates = readRaw(ESTIMATES_KEY);
    expect(estimates.filter((entry) => String(entry?.docType).toLowerCase() === "invoice")).toHaveLength(0);

    // The real Estimate is untouched.
    expect(estimates).toHaveLength(1);
    expect(estimates[0]).toEqual(realEstimate());

    // A follow-up read does not resurrect a second copy.
    expect(readStoredInvoices().filter((invoice) => invoice.invoiceNumber === "INV-1001")).toHaveLength(1);
  });
});

describe("TEST 6 - invoice numbers are business identity, never storage identity", () => {
  test("promotion does not regenerate or consume invoice numbers", () => {
    localStorage.setItem(ESTIMATES_KEY, JSON.stringify([legacyInvoiceWithoutId()]));

    const written = writeStoredInvoices([modernInvoice(), ...readStoredInvoices()]);
    const numbers = written.map((invoice) => invoice.invoiceNumber).sort();

    expect(numbers).toEqual(["INV-1001", "INV-1002"]);
    written.forEach((invoice) => {
      expect(invoice.id).not.toBe(invoice.invoiceNumber);
    });
  });

  test("normalizeInvoiceList still does not mint ids for an unwritten collection", () => {
    const list = normalizeInvoiceList([legacyInvoiceWithoutId(), modernInvoice()]);
    expect(idlessCount(list)).toBe(1);
    expect(list.find((invoice) => invoice.invoiceNumber === "INV-1002").id).toBe("inv_modern_b");
  });
});
