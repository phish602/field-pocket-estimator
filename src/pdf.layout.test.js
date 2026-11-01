import { buildPdfDoc, normalizePdfText } from "./pdf";

function basePayload(overrides = {}) {
  return {
    docType: "estimate",
    documentNumber: "EST-2001",
    company: { companyName: "EstiPaid Test Company" },
    customer: { name: "Layout Test Customer" },
    job: {
      date: "2026-11-01",
      dateDisplay: "11/01/2026",
      projectName: "PDF Layout Test",
      projectAddress: "100 Test Avenue",
    },
    laborRows: [["Journeyman Labor", "1", "2", "$75.00", "$150.00"]],
    materialRows: [
      {
        desc: "Copper fittings",
        note: "Use approved lead-free fittings at all connections.",
        qty: "2",
        each: "$45.00",
        total: "$90.00",
      },
      {
        desc: "Disconnect",
        note: "Coordinate final mounting location with the owner.",
        qty: "1",
        each: "$125.00",
        total: "$125.00",
      },
    ],
    materialsMode: "itemized",
    summaryRows: [
      ["Labor", "$150.00"],
      ["Materials", "$215.00"],
      ["Subtotal", "$365.00"],
      ["Grand Total", "$365.00"],
    ],
    ...overrides,
  };
}

function pdfOperations(doc) {
  return (doc.internal.pages || [])
    .filter(Boolean)
    .flat()
    .join("\n");
}

function expectPdfText(doc, ...values) {
  const operations = pdfOperations(doc);
  for (const value of values) expect(operations).toContain(value);
}

function expectNormalCharacterSpacing(doc) {
  const spacingValues = [...pdfOperations(doc).matchAll(/(-?(?:\d+(?:\.\d*)?|\.\d+))\s+Tc/g)]
    .map((match) => Number(match[1]));
  expect(spacingValues.length).toBeGreaterThan(0);
  expect(spacingValues.every((value) => value === 0)).toBe(true);
}

describe("shared estimate and invoice PDF layout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("normalizes spacing characters without discarding document text", () => {
    expect(normalizePdfText("Copper\u00a0fittings\u200b — 2\u202funits"))
      .toBe("Copper fittings - 2 units");
  });

  test("renders an estimate with AI-generated scope and itemized materials", () => {
    const doc = buildPdfDoc(basePayload({
      scopeNotes: [
        "## Electrical Installation",
        "**Provide and install** the following work while maintaining safe access.",
        "- Verify existing conditions before installation.",
        "- Label all new equipment at completion.",
      ].join("\n"),
      materialRows: [{
        desc: "Copper\u00a0fittings\u200b for branch piping",
        notes: "AI-generated note with normal wrapping and no lost content.",
        qty: "2",
        each: "$45.00",
        total: "$90.00",
      }],
    }));

    expectPdfText(
      doc,
      "Electrical Installation",
      "Provide and install",
      "Copper fittings for branch piping",
      "AI-generated note",
      "$90.00",
      "$365.00",
    );
    expect(pdfOperations(doc)).not.toContain("**Provide");
    expectNormalCharacterSpacing(doc);
  });

  test("renders a directly created invoice with material values and notes intact", () => {
    const doc = buildPdfDoc(basePayload({
      docType: "invoice",
      documentNumber: "INV-2001",
      invoiceStatus: "sent",
      paymentStatus: "unpaid",
      customer: { name: "Direct Invoice Customer", netTermsDays: 30 },
    }));

    expectPdfText(
      doc,
      "INVOICE",
      "Copper fittings",
      "Use approved lead-free fittings",
      "$45.00",
      "$125.00",
      "$365.00",
      "Payment Terms",
      "30 days",
    );
    expectNormalCharacterSpacing(doc);
  });

  test("renders included estimate scope on a converted invoice", () => {
    const doc = buildPdfDoc(basePayload({
      docType: "invoice",
      documentNumber: "INV-2002",
      includeInvoiceScopeOnPdf: true,
      scopeNotes: "## Converted Scope\n**Preserve this scope** when the approved estimate becomes an invoice.",
      additionalNotes: "Converted invoice notes remain attached to the approved work.",
      customer: { name: "Converted Invoice Customer", netTermsDays: 30 },
    }));

    expect(doc.getNumberOfPages()).toBe(1);
    expectPdfText(doc, "Converted Scope", "Preserve this scope", "Copper fittings", "Converted invoice notes");
    expect(pdfOperations(doc)).not.toContain("**Preserve");
  });

  test("wraps long invoice material descriptions and preserves the final words and note", () => {
    const finalDescriptionWords = "FINAL DESCRIPTION MARKER";
    const doc = buildPdfDoc(basePayload({
      docType: "invoice",
      documentNumber: "INV-2003",
      materialRows: [{
        desc: `${"Long material description requiring professional table-cell wrapping. ".repeat(7)}${finalDescriptionWords}`,
        materialNote: "FINAL MATERIAL NOTE MARKER",
        qty: "12",
        each: "$19.75",
        total: "$237.00",
      }],
    }));

    expectPdfText(doc, "FINAL", "DESCRIPTION MARKER", "FINAL MATERIAL NOTE MARKER", "12", "$19.75", "$237.00");
  });

  test("renders invoice Additional Notes without clipping their final text", () => {
    const doc = buildPdfDoc(basePayload({
      docType: "invoice",
      documentNumber: "INV-2004",
      additionalNotes: `${"Coordinate access with the site representative before beginning work. ".repeat(18)}FINAL ADDITIONAL NOTES MARKER.`,
    }));

    expectPdfText(doc, "ADDITIONAL NOTES", "FINAL ADDITIONAL NOTES MARKER");
  });

  test("renders explicit invoice payment terms", () => {
    const doc = buildPdfDoc(basePayload({
      docType: "invoice",
      documentNumber: "INV-2005",
      customer: { name: "Terms Customer", netTermsDays: 15 },
    }));

    expectPdfText(doc, "TERMS & CONDITIONS", "Payment Terms", "15 days");
  });

  test("keeps a short invoice on one page when its content fits", () => {
    const doc = buildPdfDoc(basePayload({
      docType: "invoice",
      documentNumber: "INV-2006",
      customer: { name: "Short Invoice Customer", netTermsDays: 30 },
      laborRows: [],
      materialRows: [{ desc: "Service part", qty: "1", each: "$25.00", total: "$25.00" }],
      summaryRows: [["Grand Total", "$25.00"]],
    }));

    expect(doc.getNumberOfPages()).toBe(1);
    expectPdfText(doc, "Service part", "$25.00", "Payment Terms");
  });

  test("adds pages only when a long invoice genuinely requires them and preserves the ending", () => {
    const materialRows = Array.from({ length: 42 }, (_, index) => ({
      desc: index === 41
        ? "FINAL LONG INVOICE MATERIAL MARKER"
        : `Material ${index + 1}: ${"detailed installation component ".repeat(3)}`,
      note: `Installation note ${index + 1}`,
      qty: String(index + 1),
      each: "$10.00",
      total: `$${((index + 1) * 10).toFixed(2)}`,
    }));
    const doc = buildPdfDoc(basePayload({
      docType: "invoice",
      documentNumber: "INV-2007",
      materialRows,
      additionalNotes: `${"Long invoice notes remain readable across page boundaries. ".repeat(90)}FINAL LONG INVOICE NOTES MARKER.`,
    }));

    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expectPdfText(doc, "FINAL LONG INVOICE MATERIAL MARKER", "FINAL LONG INVOICE NOTES MARKER", "$365.00");
  });
});
