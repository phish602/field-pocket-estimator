import {
  documentEditTargetCandidates,
  getDocumentEditTarget,
  resolveDocumentEditTarget,
} from "./documentEditTarget";
import { normalizeInvoiceRecord } from "../utils/invoices";

describe("document edit target resolution", () => {
  test("resolves a modern estimate id before its legacy number", () => {
    const estimate = { id: "est-modern-1", estimateNumber: "EST-1001" };

    expect(getDocumentEditTarget(estimate, "estimate")).toBe("est-modern-1");
    expect(resolveDocumentEditTarget([estimate], "est-modern-1", "estimate")).toBe(estimate);
  });

  test("resolves an id-less legacy estimate by a supported document number", () => {
    const estimate = { job: { docNumber: "EST-LEGACY-1" }, customerName: "Legacy Customer" };

    expect(documentEditTargetCandidates(estimate, "estimate")).toContain("EST-LEGACY-1");
    expect(getDocumentEditTarget(estimate, "estimate")).toBe("EST-LEGACY-1");
    expect(resolveDocumentEditTarget([estimate], "EST-LEGACY-1", "estimate")).toBe(estimate);
  });

  test("resolves a modern invoice id before its legacy number", () => {
    const invoice = {
      id: "inv-modern-1",
      meta: { savedDocId: "inv-saved-older" },
      __legacyEditTarget: "INV-LEGACY-TARGET",
      invoiceNumber: "INV-1001",
    };

    expect(getDocumentEditTarget(invoice, "invoice")).toBe("inv-modern-1");
    expect(resolveDocumentEditTarget([invoice], "inv-modern-1", "invoice")).toBe(invoice);
  });

  test("resolves an id-less normalized legacy invoice by its stable source number", () => {
    const invoice = normalizeInvoiceRecord({
      id: "",
      invoiceNumber: "INV-LEGACY-1",
      job: { docNumber: "INV-LEGACY-1" },
      total: 100,
    });

    expect(getDocumentEditTarget(invoice, "invoice")).toBe("INV-LEGACY-1");
    expect(resolveDocumentEditTarget([invoice], "INV-LEGACY-1", "invoice")).toBe(invoice);
    expect(JSON.stringify(invoice)).not.toContain("__legacyEditTarget");
  });

  test("does not resolve an empty or unrelated edit target", () => {
    const estimate = { estimateNumber: "EST-1001" };

    expect(resolveDocumentEditTarget([estimate], "", "estimate")).toBeNull();
    expect(resolveDocumentEditTarget([estimate], "EST-9999", "estimate")).toBeNull();
  });

  test("fails closed when a legacy document number identifies more than one estimate", () => {
    const first = { estimateNumber: "EST-AMBIGUOUS", customerName: "First Customer" };
    const second = { job: { docNumber: "EST-AMBIGUOUS" }, customerName: "Second Customer" };

    expect(resolveDocumentEditTarget([first, second], "EST-AMBIGUOUS", "estimate")).toBeNull();
  });
});
