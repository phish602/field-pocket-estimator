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

function pageOperations(doc, page) {
  return (doc.internal.pages[page] || []).join("\n");
}

// Rendered text as a reader sees it: unescaped Tj strings joined with spaces, so wrapped
// lines and parenthesised labels can be matched as whole phrases.
function textContent(operations) {
  return [...operations.matchAll(/\(((?:\\.|[^\\)])*)\)\s*Tj/g)]
    .map((match) => match[1].replace(/\\(.)/g, "$1"))
    .join(" ");
}

function pageText(doc, page) {
  return textContent(pageOperations(doc, page));
}

function documentText(doc) {
  return textContent(pdfOperations(doc));
}

function countOccurrences(text, value) {
  return text.split(value).length - 1;
}

const FULL_COMPANY = {
  companyName: "Valenzuela Electric & Plumbing",
  phone: "602-555-0142",
  addressLines: ["4120 E Camelback Rd, Suite 210", "Phoenix, AZ 85018"],
};

// A one-line company footer (name + one details line) leaves content room down to ~257.6mm.
const ONE_LINE_FOOTER_CONTENT_LIMIT_Y = 257.7;

function expectFooterOnEveryPage(doc, ...footerValues) {
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    const text = pageText(doc, page);
    for (const value of footerValues) expect(countOccurrences(text, value)).toBe(1);
    expect(text).toContain(`Page ${page} of ${pageCount}`);
  }
}

const PT_PER_MM = 72 / 25.4;

// Baseline (mm from the page top) of the first text run on a page that contains value.
// Td offsets accumulate within a BT block, which is how wrapped lines are positioned.
function textBaselineY(doc, page, value) {
  const pageHeight = doc.internal.pageSize.getHeight();
  for (const block of pageOperations(doc, page).matchAll(/BT([\s\S]*?)ET/g)) {
    let y = 0;
    for (const match of block[1].matchAll(/(-?[\d.]+) (-?[\d.]+) Td\s*\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      y += Number(match[2]);
      if (match[3].replace(/\\(.)/g, "$1").includes(value)) return pageHeight - (y / PT_PER_MM);
    }
  }
  return null;
}

// Y (mm from the page top) of the footer divider, which spans 26mm to 184mm.
function footerDividerY(doc, page) {
  const pageHeight = doc.internal.pageSize.getHeight();
  for (const match of pageOperations(doc, page).matchAll(/([\d.]+) ([\d.]+) m\s*([\d.]+) ([\d.]+) l/g)) {
    const [x1, y1, x2, y2] = match.slice(1).map((value) => Number(value) / PT_PER_MM);
    if (Math.abs(x1 - 26) < 0.1 && Math.abs(x2 - 184) < 0.1 && Math.abs(y1 - y2) < 0.01) return pageHeight - y1;
  }
  return null;
}

// Every text run on a page in drawing order, with its position (mm from the page's top-left),
// font size and font id; Td offsets accumulate within a BT block.
function pageTextRuns(doc, page) {
  const pageHeight = doc.internal.pageSize.getHeight();
  const runs = [];
  for (const block of pageOperations(doc, page).matchAll(/BT([\s\S]*?)ET/g)) {
    let x = 0;
    let y = 0;
    let fontId = "";
    let fontSize = 0;
    for (const op of block[1].matchAll(/\/(F\d+) ([\d.]+) Tf|(-?[\d.]+) (-?[\d.]+) Td|\(((?:\\.|[^\\)])*)\)\s*Tj/g)) {
      if (op[1]) {
        fontId = op[1];
        fontSize = Number(op[2]);
      } else if (op[3] !== undefined) {
        x += Number(op[3]);
        y += Number(op[4]);
      } else {
        runs.push({
          text: op[5].replace(/\\(.)/g, "$1"),
          x: x / PT_PER_MM,
          y: pageHeight - (y / PT_PER_MM),
          fontId,
          fontSize,
        });
      }
    }
  }
  return runs;
}

function documentTextRuns(doc) {
  const runs = [];
  for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
    runs.push(...pageTextRuns(doc, page).map((run) => ({ ...run, page })));
  }
  return runs;
}

const INVOICE_NOTES_FONT_SIZE = 9.85;
const ESTIMATE_NOTES_FONT_SIZE = 9.4;
const NOTES_MIN_FONT_SIZE = 8.8;
const NOTES_TEXT_LEFT = 19.2;
const TOTALS_LEFT = 117.5;
const NOTES_WIDE_TEXT_RIGHT = 194 - 3.2;

function runWidth(doc, run) {
  const bold = run.fontId === doc.internal.getFont("helvetica", "bold").id;
  doc.setFont("helvetica", bold ? "bold" : "normal");
  return (doc.getStringUnitWidth(run.text) * run.fontSize) / doc.internal.scaleFactor;
}

const NOTES_PANEL_HEADER_PATTERN = /^(ADDITIONAL NOTES|TERMS & CONDITIONS|NOTES & CONDITIONS)/;

// Body font size the panel was drawn at: the first regular-weight run after its header.
function notesPanelFontSize(doc) {
  const runs = documentTextRuns(doc);
  const normalFontId = doc.internal.getFont("helvetica", "normal").id;
  const headerIndex = runs.findIndex((run) => NOTES_PANEL_HEADER_PATTERN.test(run.text));
  if (headerIndex < 0) return null;
  return runs.slice(headerIndex + 1).find((run) => run.fontId === normalFontId)?.fontSize ?? null;
}

// The panel's text, in reading order across pages, must contain the source text exactly
// (ignoring whitespace, since wrapping replaces spaces with line breaks).
function expectNotesPanelText(doc, sourceText) {
  const fontSize = notesPanelFontSize(doc);
  const panelText = documentTextRuns(doc)
    .filter((run) => run.fontSize === fontSize)
    .map((run) => run.text)
    .join("");
  expect(panelText.replace(/\s+/g, "")).toContain(normalizePdfText(sourceText).replace(/\s+/g, ""));
}

// Regular-weight runs at the notes body size (section titles at the same size are bold).
function notesBodyRuns(doc, runs, fontSize) {
  const normalFontId = doc.internal.getFont("helvetica", "normal").id;
  return runs.filter((run) => run.fontSize === fontSize && run.fontId === normalFontId);
}

// Panel lines stay inside the panel, clear of the totals beside them and above the footer.
function expectNotesPanelBounds(doc) {
  const fontSize = notesPanelFontSize(doc);
  expect(fontSize).toBeGreaterThanOrEqual(NOTES_MIN_FONT_SIZE);
  const totals = doc.lastAutoTable;
  const totalsTop = totals.finalY - totals.body.reduce((sum, row) => sum + row.height, 0);
  const descent = (fontSize * 0.22) / doc.internal.scaleFactor;
  const ascent = (fontSize * 0.78) / doc.internal.scaleFactor;
  const panelRuns = notesBodyRuns(doc, documentTextRuns(doc), fontSize);

  expect(panelRuns.length).toBeGreaterThan(0);
  for (const run of panelRuns) {
    const right = run.x + runWidth(doc, run);
    expect(run.x).toBeGreaterThanOrEqual(NOTES_TEXT_LEFT - 0.01);
    expect(right).toBeLessThanOrEqual(NOTES_WIDE_TEXT_RIGHT + 0.05);
    expect(run.y + descent).toBeLessThanOrEqual(ONE_LINE_FOOTER_CONTENT_LIMIT_Y);
    const besideTotals = run.page === totals.startPageNumber
      && run.y + descent > totalsTop
      && run.y - ascent < totals.finalY;
    if (besideTotals) expect(right).toBeLessThan(TOTALS_LEFT);
  }
}

function expectDocumentText(doc, ...values) {
  const text = documentText(doc);
  for (const value of values) expect(text).toContain(value);
}

function materialRowsOfCount(count) {
  return Array.from({ length: count }, (_, index) => ({
    desc: `Part ${index + 1}`,
    qty: "1",
    each: "$1.00",
    total: "$1.00",
  }));
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

  test("keeps scope text written directly after a bullet list", () => {
    const doc = buildPdfDoc(basePayload({
      scopeNotes: [
        "## Scope of Work",
        "- Install the new panel.",
        "  including all branch circuit transfers.",
        "- Label every circuit.",
        "FINAL TRAILING SCOPE PARAGRAPH MARKER follows the list without a blank line.",
      ].join("\n"),
    }));

    expectPdfText(
      doc,
      "Install the new panel. including all branch circuit transfers.",
      "Label every circuit.",
      "FINAL TRAILING SCOPE PARAGRAPH MARKER",
    );
  });
});

describe("company footer on every page", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test("renders the full company footer on a single-page estimate", () => {
    const doc = buildPdfDoc(basePayload({ company: FULL_COMPANY }));

    expect(doc.getNumberOfPages()).toBe(1);
    expectFooterOnEveryPage(doc, "Valenzuela Electric & Plumbing", "602-555-0142", "4120 E Camelback Rd, Suite 210, Phoenix, AZ 85018");
  });

  test("repeats the footer and page numbering on every page of a multipage estimate", () => {
    const doc = buildPdfDoc(basePayload({
      company: FULL_COMPANY,
      scopeNotes: Array.from({ length: 40 }, (_, index) => `- Scope task ${index + 1}: ${"verify and install ".repeat(4)}`).join("\n"),
      additionalNotes: `${"Estimate notes continue across page boundaries. ".repeat(60)}FINAL ESTIMATE NOTES MARKER.`,
    }));

    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expectFooterOnEveryPage(doc, "Valenzuela Electric & Plumbing", "602-555-0142", "4120 E Camelback Rd, Suite 210, Phoenix, AZ 85018");
    expectDocumentText(doc, "FINAL ESTIMATE NOTES MARKER");
  });

  test("repeats the same footer on every page of a long invoice", () => {
    const doc = buildPdfDoc(basePayload({
      docType: "invoice",
      documentNumber: "INV-3001",
      company: FULL_COMPANY,
      customer: { name: "Footer Invoice Customer", netTermsDays: 30 },
      materialRows: materialRowsOfCount(70),
    }));

    expect(doc.getNumberOfPages()).toBeGreaterThan(2);
    expectFooterOnEveryPage(doc, "Valenzuela Electric & Plumbing", "602-555-0142", "4120 E Camelback Rd, Suite 210, Phoenix, AZ 85018");
  });

  test("wraps a long company name and address instead of overflowing the page", () => {
    const longName = "Southwest Regional Commercial & Residential Electrical, Plumbing, and Mechanical Contractors LLC";
    const doc = buildPdfDoc(basePayload({
      company: {
        companyName: longName,
        phone: "602-555-0199",
        addressLines: ["Building C, 12500 North Scottsdale Road Commerce Park, Suite 1450 East Wing", "Scottsdale, AZ 85254"],
      },
      materialRows: materialRowsOfCount(40),
    }));

    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
      const operations = pageOperations(doc, page);
      expect(operations).not.toContain(`(${longName}) Tj`);
      expect(operations).toContain("Southwest Regional Commercial");
      expect(operations).toContain("Contractors LLC");
      expect(operations).toContain("Scottsdale, AZ 85254");
    }
  });

  test.each([
    ["estimate", "EST-3002", {}],
    ["invoice", "INV-3002", { netTermsDays: 30 }],
  ])("seats the %s footer band in the bottom margin at the same position on every page", (docType, documentNumber, customerTerms) => {
    const doc = buildPdfDoc(basePayload({
      docType,
      documentNumber,
      company: FULL_COMPANY,
      customer: { name: "Footer Band Customer", ...customerTerms },
      materialRows: materialRowsOfCount(40),
    }));
    const pageCount = doc.getNumberOfPages();

    expect(pageCount).toBeGreaterThan(1);
    for (let page = 1; page <= pageCount; page += 1) {
      expect(textBaselineY(doc, page, `Page ${page} of ${pageCount}`)).toBeCloseTo(284.8, 1);
      expect(textBaselineY(doc, page, "Created with EstiPaid")).toBeCloseTo(284.8, 1);
      expect(textBaselineY(doc, page, "4120 E Camelback Rd")).toBeCloseTo(278.8, 1);
      expect(textBaselineY(doc, page, "Valenzuela Electric & Plumbing")).toBeCloseTo(271.7, 1);
      expect(footerDividerY(doc, page)).toBeCloseTo(266.3, 1);
      expect(footerDividerY(doc, page)).toBeGreaterThan(ONE_LINE_FOOTER_CONTENT_LIMIT_Y);
    }
  });

  test("keeps a wrapped footer anchored to the same bottom line, growing upward", () => {
    const doc = buildPdfDoc(basePayload({
      company: {
        companyName: "Southwest Regional Commercial & Residential Electrical, Plumbing, and Mechanical Contractors LLC",
        phone: "602-555-0199",
        addressLines: ["Building C, 12500 North Scottsdale Road Commerce Park, Suite 1450 East Wing", "Scottsdale, AZ 85254"],
      },
    }));

    expect(textBaselineY(doc, 1, "Scottsdale, AZ 85254")).toBeCloseTo(278.8, 1);
    expect(textBaselineY(doc, 1, "Southwest Regional")).toBeLessThan(271.7);
    expect(footerDividerY(doc, 1)).toBeLessThan(textBaselineY(doc, 1, "Southwest Regional"));
    expect(doc.lastAutoTable.finalY).toBeLessThan(footerDividerY(doc, 1));
  });

  test("renders phone and address once when the company name is missing", () => {
    const doc = buildPdfDoc(basePayload({
      company: { phone: "602-555-0100", address: "1 Main St, Mesa, AZ" },
      materialRows: materialRowsOfCount(40),
    }));

    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expectFooterOnEveryPage(doc, "602-555-0100", "1 Main St, Mesa, AZ");
  });

  test("omits the footer block cleanly when no company information exists", () => {
    const doc = buildPdfDoc(basePayload({ company: {}, materialRows: materialRowsOfCount(40) }));

    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
      expect(pageOperations(doc, page)).toContain(`Page ${page} of ${doc.getNumberOfPages()}`);
    }
    expectPdfText(doc, "Part 40", "$365.00");
  });
});

describe("page-space utilization", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const fourRowSummary = [
    ["Labor", "$1.00"],
    ["Materials", "$9.00"],
    ["Subtotal", "$10.00"],
    ["Grand Total", "$10.00"],
  ];

  test("keeps totals on the materials page when they genuinely fit", () => {
    // The pre-correction height reservation pushed these totals to a second page.
    const doc = buildPdfDoc(basePayload({
      company: FULL_COMPANY,
      materialRows: materialRowsOfCount(15),
      summaryRows: fourRowSummary,
    }));

    expect(doc.getNumberOfPages()).toBe(1);
    expect(doc.lastAutoTable.finalY).toBeLessThanOrEqual(ONE_LINE_FOOTER_CONTENT_LIMIT_Y);
    expectPdfText(doc, "Part 15", "Grand Total", "$10.00");
  });

  test("moves totals to a new page as one block, clear of the footer, only when they do not fit", () => {
    for (let count = 1; count <= 24; count += 1) {
      const doc = buildPdfDoc(basePayload({
        company: FULL_COMPANY,
        materialRows: materialRowsOfCount(count),
        summaryRows: fourRowSummary,
      }));
      const totals = doc.lastAutoTable;

      // autoTable's pageNumber counts the pages a table spans.
      expect(totals.pageNumber).toBe(1);
      expect(totals.finalY).toBeLessThanOrEqual(ONE_LINE_FOOTER_CONTENT_LIMIT_Y);
      expectPdfText(doc, `Part ${count}`, "Grand Total");
    }
  });

  test("renders an EST-0001-style estimate completely without invoice terms", () => {
    const doc = buildPdfDoc(basePayload({
      documentNumber: "EST-0001",
      company: FULL_COMPANY,
      scopeNotes: [
        "## Scope of Work",
        "Provide all labor, materials, and equipment required to replace the existing main service panel.",
        "- Coordinate utility disconnect and reconnect.",
        "- Install new 200A main breaker panel and transfer all existing branch circuits.",
        "- Obtain permit and schedule final inspection.",
        "Power will be interrupted for approximately four to six hours.",
      ].join("\n"),
      additionalNotes: "This estimate is valid for 30 days. FINAL EST-0001 NOTES MARKER.",
    }));

    expectDocumentText(
      doc,
      "Scope of Work",
      "Power will be interrupted",
      "Material Schedule",
      "Copper fittings",
      "$365.00",
      "ADDITIONAL NOTES",
      "FINAL EST-0001 NOTES MARKER",
    );
    expect(pdfOperations(doc)).not.toContain("TERMS & CONDITIONS");
    expect(pdfOperations(doc)).not.toContain("Payment Terms");
    expectFooterOnEveryPage(doc, "Valenzuela Electric & Plumbing");
    expectNormalCharacterSpacing(doc);
  });

  test("renders an estimate without Additional Notes or invoice terms", () => {
    const doc = buildPdfDoc(basePayload({ company: FULL_COMPANY }));

    expect(doc.getNumberOfPages()).toBe(1);
    expect(pdfOperations(doc)).not.toContain("ADDITIONAL NOTES");
    expect(pdfOperations(doc)).not.toContain("TERMS & CONDITIONS");
  });

  test("never strands the Additional Notes header without at least two lines of notes", () => {
    const notes = `${"Estimate notes that may not fit beside the totals. ".repeat(8)}FINAL ORPHAN NOTES MARKER.`;
    for (let count = 1; count <= 30; count += 1) {
      const materialRows = materialRowsOfCount(count);
      materialRows[0] = { ...materialRows[0], note: "Field verify." };
      const doc = buildPdfDoc(basePayload({
        company: FULL_COMPANY,
        materialRows,
        summaryRows: [["Grand Total", "$10.00"]],
        additionalNotes: notes,
      }));

      for (let page = 1; page <= doc.getNumberOfPages(); page += 1) {
        const runs = pageTextRuns(doc, page);
        const header = runs.find((run) => run.text.startsWith("ADDITIONAL NOTES"));
        if (!header) continue;
        const bodyLines = notesBodyRuns(doc, runs, notesPanelFontSize(doc)).filter((run) => run.y > header.y);
        expect(bodyLines.length).toBeGreaterThanOrEqual(2);
      }
      expectNotesPanelText(doc, notes);
      expectNotesPanelBounds(doc);
    }
  });
});

describe("invoice Terms & Conditions and Additional Notes", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function shortInvoice(overrides = {}) {
    return basePayload({
      docType: "invoice",
      documentNumber: "INV-4001",
      company: FULL_COMPANY,
      laborRows: [],
      materialRows: [{ desc: "Service call", qty: "1", each: "$185.00", total: "$185.00" }],
      summaryRows: [["Grand Total", "$185.00"]],
      ...overrides,
    });
  }

  test.each([
    ["Due Upon Receipt", { paymentTerms: "Due upon receipt" }, "Payment Terms: Payment is due upon receipt of this invoice, unless otherwise agreed to in writing."],
    ["Net 30 label", { netTermsLabel: "Net 30" }, "Payment Terms: Full payment is due within 30 days of receipt of this invoice, unless otherwise agreed to in writing."],
    ["Net 45 days", { netTermsDays: 45 }, "Payment Terms: Full payment is due within 45 days of receipt of this invoice, unless otherwise agreed to in writing."],
    ["no explicit terms", {}, "Payment Terms: Full payment is due within 30 days of receipt of this invoice, unless otherwise agreed to in writing."],
  ])("keeps the existing %s payment language on a one-page invoice", (_label, customerTerms, expectedText) => {
    const doc = buildPdfDoc(shortInvoice({ customer: { name: "Terms Customer", ...customerTerms } }));

    expect(doc.getNumberOfPages()).toBe(1);
    expectDocumentText(doc, "TERMS & CONDITIONS", expectedText, "$185.00");
    expectFooterOnEveryPage(doc, "Valenzuela Electric & Plumbing");
  });

  test("combines Terms & Conditions and Additional Notes into one panel, in order, without duplicates", () => {
    const doc = buildPdfDoc(shortInvoice({
      customer: { name: "Notes Customer", netTermsDays: 30 },
      additionalNotes: "Gate code 4411. FINAL SEPARATE NOTES MARKER.",
    }));
    const text = documentText(doc);
    const termsSentence = "Payment Terms: Full payment is due within 30 days of receipt of this invoice, unless otherwise agreed to in writing.";

    expect(doc.getNumberOfPages()).toBe(1);
    expect(countOccurrences(text, "NOTES & CONDITIONS")).toBe(1);
    expect(countOccurrences(text, "Terms & Conditions")).toBe(1);
    expect(countOccurrences(text, "Additional Notes")).toBe(1);
    expect(text).not.toContain("TERMS & CONDITIONS");
    expect(text).not.toContain("ADDITIONAL NOTES");
    expect(countOccurrences(text.replace(/\s+/g, ""), termsSentence.replace(/\s+/g, ""))).toBe(1);
    expect(countOccurrences(text, "FINAL SEPARATE NOTES MARKER")).toBe(1);
    const order = ["NOTES & CONDITIONS", "Terms & Conditions", "Payment Terms:", "Additional Notes", "Gate code 4411"];
    const positions = order.map((value) => text.indexOf(value));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  test("renders Terms & Conditions without an empty Additional Notes section", () => {
    const doc = buildPdfDoc(shortInvoice({ customer: { name: "No Notes Customer", netTermsDays: 30 } }));
    const text = documentText(doc);

    expect(text).toContain("TERMS & CONDITIONS");
    expect(text).not.toContain("NOTES & CONDITIONS");
    expect(text).not.toContain("Additional Notes");
    expect(text).not.toContain("ADDITIONAL NOTES");
  });

  test("lays out direct and converted short invoices identically", () => {
    const direct = buildPdfDoc(shortInvoice({ customer: { name: "Same Customer", netTermsDays: 30 } }));
    const converted = buildPdfDoc(shortInvoice({
      sourceEstimateNumber: "EST-0001",
      customer: { name: "Same Customer", netTermsDays: 30 },
    }));

    expect(direct.getNumberOfPages()).toBe(1);
    expect(converted.getNumberOfPages()).toBe(1);
    expect(pdfOperations(converted)).toBe(pdfOperations(direct));
  });

  test("paginates extensive invoice notes after the terms with the footer on every page", () => {
    const doc = buildPdfDoc(basePayload({
      docType: "invoice",
      documentNumber: "INV-4002",
      company: FULL_COMPANY,
      customer: { name: "Extensive Notes Customer", netTermsDays: 15 },
      additionalNotes: `${"Coordinate site access with the property manager before each phase. ".repeat(60)}FINAL EXTENSIVE INVOICE NOTES MARKER.`,
    }));

    expect(doc.getNumberOfPages()).toBeGreaterThan(1);
    expectDocumentText(doc, "15 days", "NOTES & CONDITIONS (CONTINUED)", "FINAL EXTENSIVE INVOICE NOTES MARKER");
    expectFooterOnEveryPage(doc, "Valenzuela Electric & Plumbing");
  });
});

describe("adaptive Notes & Conditions layout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const EST0001_MATERIALS = [
    { desc: "200A main breaker load center, 40-space", note: "Indoor rated, copper bus.", qty: "1", each: "$385.00", total: "$385.00" },
    { desc: "4/0 aluminum SER service entrance cable", note: "Sold per foot.", qty: "35", each: "$6.40", total: "$224.00" },
    { desc: "Ground rod, 5/8 in x 8 ft copper-clad", note: "Two rods spaced 6 ft apart.", qty: "2", each: "$24.50", total: "$49.00" },
    { desc: "#4 bare copper grounding electrode conductor", note: "", qty: "25", each: "$3.10", total: "$77.50" },
    { desc: "Breaker, 20A single-pole", note: "Replaces damaged breakers.", qty: "6", each: "$11.25", total: "$67.50" },
    { desc: "Meter base, 200A ringless", note: "Utility approved.", qty: "1", each: "$142.00", total: "$142.00" },
  ];
  const EST0001_SUMMARY = [
    ["Labor", "$1,560.00"],
    ["Materials", "$945.00"],
    ["Subtotal", "$2,505.00"],
    ["Grand Total", "$2,505.00"],
  ];
  const EST0001_SCOPE = [
    "## Scope of Work",
    "Provide all labor, materials, and equipment required to replace the existing 100A main service panel with a new 200A panel, upgrade the service entrance conductors, and correct the grounding system per current NEC requirements.",
    "- Coordinate utility disconnect and reconnect with the serving utility.",
    "- Remove and dispose of the existing main panel and service entrance cable.",
    "- Install new 200A main breaker panel and transfer all existing branch circuits.",
    "- Install new grounding electrode conductor and two ground rods.",
    "- Label all circuits and provide an updated panel directory.",
    "- Obtain permit and schedule final inspection with the city.",
    "Work will be performed during normal business hours. Power will be interrupted for approximately four to six hours on the day of the changeover.",
  ].join("\n");
  const EST0001_NOTES = "This estimate is valid for 30 days from the date above. Any additional work discovered after the existing panel is opened, including damaged branch wiring or code corrections not listed above, will be quoted separately before proceeding. A 50% deposit is required to schedule the work.";

  function est0001(overrides = {}) {
    return basePayload({
      documentNumber: "EST-0001",
      company: FULL_COMPANY,
      laborRows: [["Journeyman Electrician", "2", "12", "$65.00", "$1,560.00"]],
      materialRows: EST0001_MATERIALS,
      summaryRows: EST0001_SUMMARY,
      scopeNotes: EST0001_SCOPE,
      additionalNotes: EST0001_NOTES,
      ...overrides,
    });
  }

  function totalsTop(doc) {
    const totals = doc.lastAutoTable;
    return totals.finalY - totals.body.reduce((sum, row) => sum + row.height, 0);
  }

  function panelHeader(doc) {
    return documentTextRuns(doc).find((run) => NOTES_PANEL_HEADER_PATTERN.test(run.text));
  }

  test("places estimate notes beside the totals so a short estimate stays on one page", () => {
    const doc = buildPdfDoc(est0001({
      scopeNotes: "## Scope of Work\nReplace two exterior GFCI receptacles and add weatherproof in-use covers.",
      materialRows: EST0001_MATERIALS.slice(0, 3),
    }));
    const header = panelHeader(doc);

    expect(doc.getNumberOfPages()).toBe(1);
    expect(header.text).toBe("ADDITIONAL NOTES");
    expect(header.page).toBe(doc.lastAutoTable.startPageNumber);
    expect(header.y).toBeGreaterThan(totalsTop(doc));
    expect(header.y).toBeLessThan(totalsTop(doc) + 6);
    expect(notesPanelFontSize(doc)).toBe(ESTIMATE_NOTES_FONT_SIZE);
    expectNotesPanelText(doc, EST0001_NOTES);
    expectNotesPanelBounds(doc);
    expect(documentText(doc)).not.toContain("Payment Terms");
  });

  test("EST-0001: notes now share the totals page beside the totals instead of following below them", () => {
    // Totals (43.9mm) cannot fit after the six materials on page 1, so the document stays
    // two pages; the notes no longer add their own block below the totals on page 2.
    const doc = buildPdfDoc(est0001());
    const header = panelHeader(doc);

    expect(doc.getNumberOfPages()).toBe(2);
    expect(doc.lastAutoTable.startPageNumber).toBe(2);
    expect(header.page).toBe(2);
    expect(header.y).toBeLessThan(doc.lastAutoTable.finalY);
    expectNotesPanelText(doc, EST0001_NOTES);
    expectNotesPanelBounds(doc);
  });

  test("flows long notes from beside the totals to the full width below them before adding a page", () => {
    const notes = `${"Coordinate site access, parking, and staging with the property manager before each phase. ".repeat(12)}FINAL FLOW MARKER.`;
    const doc = buildPdfDoc(est0001({ materialRows: EST0001_MATERIALS.slice(0, 2), scopeNotes: "", additionalNotes: notes }));
    const totals = doc.lastAutoTable;
    const bodyRuns = notesBodyRuns(doc, documentTextRuns(doc), notesPanelFontSize(doc))
      .filter((run) => run.page === totals.startPageNumber);
    const wideRuns = bodyRuns.filter((run) => run.x + runWidth(doc, run) > TOTALS_LEFT);

    expect(doc.getNumberOfPages()).toBe(1);
    expect(bodyRuns.some((run) => run.y < totals.finalY)).toBe(true);
    expect(wideRuns.length).toBeGreaterThan(0);
    for (const run of wideRuns) expect(run.y).toBeGreaterThan(totals.finalY);
    expectNotesPanelText(doc, notes);
    expectNotesPanelBounds(doc);
  });

  test("wraps long URLs and unbroken strings inside the panel without losing characters", () => {
    const notes = [
      "Reference: https://example.com/projects/2026/glenrosa-service-upgrade/drawings/E-101-rev-C-final-approved.pdf?download=1&version=3",
      "",
      `Unbroken: ${"ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".repeat(4)}.`,
      "",
      "Spec 26-05-19-LOW-VOLTAGE-ELECTRICAL-POWER-CONDUCTORS-AND-CABLES applies. FINAL URL MARKER.",
    ].join("\n");
    const doc = buildPdfDoc(basePayload({
      docType: "invoice",
      documentNumber: "INV-5001",
      company: FULL_COMPANY,
      customer: { name: "URL Customer", netTermsDays: 30 },
      additionalNotes: notes,
    }));

    expectNotesPanelText(doc, notes);
    expectNotesPanelBounds(doc);
  });

  test("keeps bullet and numbered markers with a hanging indent for wrapped items", () => {
    const doc = buildPdfDoc(est0001({
      materialRows: EST0001_MATERIALS.slice(0, 2),
      scopeNotes: "",
      additionalNotes: [
        "Included:",
        "- Permit fees and one re-inspection if required by the city, including any resubmittal paperwork.",
        "- Haul-away of removed equipment.",
        "1. Deposit due at scheduling.",
        "2. Balance due at final inspection.",
      ].join("\n"),
    }));
    const runs = notesBodyRuns(doc, documentTextRuns(doc), notesPanelFontSize(doc));
    const markers = runs.filter((run) => ["-", "1.", "2."].includes(run.text));
    const firstItem = runs.find((run) => run.text.startsWith("Permit fees"));
    const continuation = runs[runs.indexOf(firstItem) + 1];

    expect(markers.map((run) => run.text)).toEqual(["-", "-", "1.", "2."]);
    for (const marker of markers) expect(marker.x).toBeCloseTo(NOTES_TEXT_LEFT + 2.8, 1);
    expect(firstItem.y).toBeCloseTo(markers[0].y, 3);
    expect(firstItem.x).toBeGreaterThan(markers[0].x);
    expect(continuation.y).toBeGreaterThan(firstItem.y);
    expect(continuation.x).toBeCloseTo(firstItem.x, 3);
  });

  test("keeps paragraph breaks as visible extra spacing", () => {
    const doc = buildPdfDoc(est0001({
      materialRows: EST0001_MATERIALS.slice(0, 2),
      scopeNotes: "",
      additionalNotes: "First paragraph.\n\nSecond paragraph.",
    }));
    const runs = notesBodyRuns(doc, documentTextRuns(doc), notesPanelFontSize(doc));
    const first = runs.find((run) => run.text === "First paragraph.");
    const second = runs.find((run) => run.text === "Second paragraph.");
    const lineHeight = (ESTIMATE_NOTES_FONT_SIZE * 1.18) / doc.internal.scaleFactor;

    expect(second.y - first.y).toBeGreaterThan(lineHeight * 1.4);
  });

  test("never moves or changes the totals when notes are added", () => {
    for (const docType of ["estimate", "invoice"]) {
      const payload = est0001({ docType, materialRows: EST0001_MATERIALS.slice(0, 3), customer: { name: "Totals Customer", netTermsDays: 30 } });
      const withNotes = buildPdfDoc(payload);
      const withNotesTotals = { finalY: withNotes.lastAutoTable.finalY, page: withNotes.lastAutoTable.startPageNumber };
      const withoutNotes = buildPdfDoc({ ...payload, additionalNotes: "" });
      const totalsRuns = (doc) => documentTextRuns(doc)
        .filter((run) => run.fontSize === 10)
        .map(({ text, x, y, page }) => ({ text, x: x.toFixed(2), y: y.toFixed(2), page }));

      expect(withNotesTotals).toEqual({ finalY: withoutNotes.lastAutoTable.finalY, page: withoutNotes.lastAutoTable.startPageNumber });
      expect(totalsRuns(withNotes)).toEqual(totalsRuns(withoutNotes));
      expectDocumentText(withNotes, "Grand Total", "$2,505.00", "$1,560.00", "$945.00");
    }
  });

  test("paginates substantial scope and materials naturally with the panel beside the totals", () => {
    const doc = buildPdfDoc(est0001({
      docType: "invoice",
      documentNumber: "INV-5002",
      includeInvoiceScopeOnPdf: true,
      materialRows: [...EST0001_MATERIALS, ...EST0001_MATERIALS, ...EST0001_MATERIALS.slice(0, 4)],
      customer: { name: "Scope Invoice Customer", netTermsDays: 30 },
    }));
    const header = panelHeader(doc);

    expect(doc.getNumberOfPages()).toBe(2);
    expect(doc.lastAutoTable.pageNumber).toBe(1);
    expect(header.text).toBe("NOTES & CONDITIONS");
    expect(header.page).toBe(doc.lastAutoTable.startPageNumber);
    expectNotesPanelText(doc, EST0001_NOTES);
    expectNotesPanelBounds(doc);
    expectFooterOnEveryPage(doc, "Valenzuela Electric & Plumbing");
  });

  test("uses tighter type only to keep the panel on the totals page, never below the readable minimum", () => {
    const results = [];
    for (let sentences = 1; sentences <= 40; sentences += 1) {
      const notes = `${"Coordinate access with the site representative before work. ".repeat(sentences)}FINAL SWEEP MARKER.`;
      const doc = buildPdfDoc(basePayload({
        docType: "invoice",
        documentNumber: "INV-5003",
        company: FULL_COMPANY,
        customer: { name: "Sweep Customer", netTermsDays: 30 },
        additionalNotes: notes,
      }));
      results.push({ fontSize: notesPanelFontSize(doc), pages: doc.getNumberOfPages() });
      expectNotesPanelText(doc, notes);
      expectNotesPanelBounds(doc);
    }
    const tightened = results.filter((result) => result.fontSize < INVOICE_NOTES_FONT_SIZE);
    expect(tightened.length).toBeGreaterThan(0);
    expect(tightened.every((result) => result.pages === 1)).toBe(true);
    expect(results.filter((result) => result.pages > 1).every((result) => result.fontSize === INVOICE_NOTES_FONT_SIZE)).toBe(true);
    expect(Math.min(...results.map((result) => result.fontSize))).toBeGreaterThanOrEqual(NOTES_MIN_FONT_SIZE);
  });
});
