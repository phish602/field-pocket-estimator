import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  createInvoiceBuilderDraftFromEstimate,
  normalizeInvoiceList,
  normalizeInvoiceRecord,
  readStoredInvoices,
  writeStoredInvoices,
} from "./invoices";
import {
  getDocumentEditTarget,
  resolveDocumentEditTarget,
} from "../lib/documentEditTarget";
import { mapLocalInvoiceToBackendInvoice } from "./backendDataMapper";
import { buildParentLineItemContract } from "../lib/cloudLineItemContract";

function childLegacyIds(invoice) {
  const backend = mapLocalInvoiceToBackendInvoice(invoice, {});
  return buildParentLineItemContract({
    entityType: "invoice",
    parentLegacyId: backend.legacy_local_id,
    parentColumn: "invoice_id",
    items: backend.line_items,
  }).rows.map((row) => row.legacy_local_id);
}

function legacyEstimateCollectionInvoice(overrides = {}) {
  return {
    docType: "invoice",
    invoiceNumber: "INV-LEGACY-2601",
    job: { docNumber: "INV-LEGACY-2601", date: "2026-01-01" },
    status: "sent",
    invoiceTotal: 1000,
    total: 1000,
    date: "2026-01-01",
    customer: { id: "cust_1", name: "Test Co" },
    customerId: "cust_1",
    materials: {
      items: [
        { id: "m0", desc: "Mobilization deposit", qty: 1, priceEach: 750 },
        { id: "m1", desc: "Permits", qty: 1, priceEach: 250 },
      ],
    },
    ...overrides,
  };
}

describe("Invoice identity stability", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("a modern Invoice id is unchanged across repeated normalization", () => {
    const source = legacyEstimateCollectionInvoice({ id: "inv_authoritative" });

    const once = normalizeInvoiceRecord(source);
    const twice = normalizeInvoiceRecord(once);
    const thrice = normalizeInvoiceRecord(twice);

    expect(once.id).toBe("inv_authoritative");
    expect(twice.id).toBe("inv_authoritative");
    expect(thrice.id).toBe("inv_authoritative");
  });

  test("a meta.savedDocId-only supported legacy Invoice retains that exact id", () => {
    const source = legacyEstimateCollectionInvoice({ meta: { savedDocId: "doc_saved_exact" } });

    expect(normalizeInvoiceRecord(source).id).toBe("doc_saved_exact");
    expect(normalizeInvoiceRecord(normalizeInvoiceRecord(source)).id).toBe("doc_saved_exact");
  });

  test("the real Estimates-collection legacy path keeps one lookup target without minting an id", () => {
    const legacy = legacyEstimateCollectionInvoice();
    const before = JSON.stringify([legacy]);
    localStorage.setItem(STORAGE_KEYS.ESTIMATES, before);

    const first = readStoredInvoices();
    const second = readStoredInvoices();

    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0].id).toBe("");
    expect(second[0].id).toBe("");
    expect(getDocumentEditTarget(first[0], "invoice")).toBe("INV-LEGACY-2601");
    expect(getDocumentEditTarget(second[0], "invoice")).toBe("INV-LEGACY-2601");
    expect(resolveDocumentEditTarget(first, "INV-LEGACY-2601", "invoice")).toBe(first[0]);
    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATES)).toBe(before);
  });

  test("first-save promotion then reopen and save keeps one Invoice and stable child ids", () => {
    localStorage.setItem(
      STORAGE_KEYS.ESTIMATES,
      JSON.stringify([legacyEstimateCollectionInvoice()])
    );
    const openedLegacy = readStoredInvoices()[0];
    expect(getDocumentEditTarget(openedLegacy, "invoice")).toBe("INV-LEGACY-2601");

    const canonicalId = "doc_promoted_once";
    const firstSaved = normalizeInvoiceRecord({
      ...openedLegacy,
      id: canonicalId,
      meta: { ...(openedLegacy.meta || {}), savedDocId: canonicalId },
    });
    writeStoredInvoices([firstSaved]);

    const reopened = readStoredInvoices();
    expect(reopened).toHaveLength(1);
    expect(reopened[0].id).toBe(canonicalId);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES) || "[]")).toEqual([]);
    const firstChildIds = childLegacyIds(reopened[0]);

    const numberEdited = normalizeInvoiceRecord({
      ...reopened[0],
      invoiceNumber: "INVOICE 2601 REVISED",
      job: { ...(reopened[0].job || {}), docNumber: "INVOICE 2601 REVISED" },
    });
    writeStoredInvoices([numberEdited]);
    const afterSecondSave = readStoredInvoices();

    expect(afterSecondSave).toHaveLength(1);
    expect(afterSecondSave[0].id).toBe(canonicalId);
    expect(afterSecondSave[0].invoiceNumber).toBe("INVOICE 2601 REVISED");
    expect(childLegacyIds(afterSecondSave[0])).toEqual(firstChildIds);
  });

  test("distinct authoritative ids are not collapsed by equal or slug-equivalent numbers", () => {
    const records = normalizeInvoiceList([
      legacyEstimateCollectionInvoice({ id: "inv_a", invoiceNumber: "INV-001", job: { docNumber: "INV-001" } }),
      legacyEstimateCollectionInvoice({ id: "inv_b", invoiceNumber: "INV 001", job: { docNumber: "INV 001" } }),
      legacyEstimateCollectionInvoice({ id: "inv_c", invoiceNumber: "INV-001", job: { docNumber: "INV-001" } }),
    ]);

    expect(records.map((record) => record.id).sort()).toEqual(["inv_a", "inv_b", "inv_c"]);
  });

  test("a new converted Invoice receives one persisted id before normalization", () => {
    const estimate = {
      id: "est_1",
      status: "approved",
      estimateNumber: "EST-1",
      total: 500,
      customerId: "cust_1",
      projectId: "proj_1",
      customer: { id: "cust_1", name: "Test Co" },
      job: { docNumber: "EST-1", date: "2026-01-01" },
    };

    const result = createInvoiceBuilderDraftFromEstimate(estimate, [], {
      invoiceNumber: "INV-NEW-1",
      nowTs: 1770000000000,
    });

    expect(result.ok).toBe(true);
    expect(result.draft.id).toMatch(/^inv_/);
    expect(result.draft.meta.savedDocId).toBe(result.draft.id);
    expect(normalizeInvoiceRecord(normalizeInvoiceRecord(result.draft)).id).toBe(result.draft.id);
  });
});
