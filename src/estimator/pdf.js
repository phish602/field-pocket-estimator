// @ts-nocheck
/* eslint-disable */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

// buildPdf(state, computed) -> jsPDF instance (caller saves)
export function buildPdf(state, computed) {
  const doc = new jsPDF();

  const docType = (state?.ui?.docType === "invoice" ? "Invoice" : "Estimate") || "Estimate";
  const title = `EstiPaid ${docType}`;

  doc.setFontSize(16);
  doc.text(title, 14, 16);

  doc.setFontSize(10);

  const leftX = 14;
  let y = 24;

  const safe = (v) => (v === null || v === undefined ? "" : String(v));

  doc.text(`Customer: ${safe(state?.customer?.name)}`, leftX, y); y += 6;
  if (safe(state?.customer?.attn)) { doc.text(`Attn: ${safe(state?.customer?.attn)}`, leftX, y); y += 6; }
  if (safe(state?.customer?.phone)) { doc.text(`Phone: ${safe(state?.customer?.phone)}`, leftX, y); y += 6; }
  if (safe(state?.customer?.email)) { doc.text(`Email: ${safe(state?.customer?.email)}`, leftX, y); y += 6; }

  const projectNo = safe(state?.customer?.projectNumber || state?.job?.docNumber);
  if (projectNo) { doc.text(`${docType} #: ${projectNo}`, leftX, y); y += 6; }

  const date = safe(state?.job?.date);
  const due = safe(state?.job?.due);
  if (date) { doc.text(`Date: ${date}`, leftX, y); y += 6; }
  if (due) { doc.text(`Due: ${due}`, leftX, y); y += 6; }

  y += 2;

  // Scope / Notes
  const scope = safe(state?.scopeNotes).trim();
  if (scope) {
    doc.setFontSize(11);
    doc.text("Scope / Notes", leftX, y); y += 6;
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(scope, 180);
    doc.text(lines, leftX, y);
    y += Math.max(8, lines.length * 5) + 2;
  }

  // Labor table
  const laborRows = (computed?.labor?.normalized || []).map((ln) => [
    safe(ln?.role),
    safe(ln?.hours),
    safe(ln?.rate),
    safe(ln?.total),
  ]);

  if (laborRows.length) {
    autoTable(doc, {
      startY: y,
      head: [["Labor Role", "Hours", "Rate", "Line Total"]],
      body: laborRows,
      styles: { fontSize: 9 },
    });
    y = doc.lastAutoTable.finalY + 6;
  }

  // Materials table (itemized only)
  const matMode = state?.ui?.materialsMode === "itemized" ? "itemized" : "blanket";
  if (matMode === "itemized") {
    const matRows = (computed?.materials?.normalized || []).map((it) => [
      safe(it?.desc),
      safe(it?.qty),
      safe(it?.priceEach),
      safe(it?.charge),
    ]);

    if (matRows.length) {
      autoTable(doc, {
        startY: y,
        head: [["Material", "Qty", "Price Each", "Charge"]],
        body: matRows,
        styles: { fontSize: 9 },
      });
      y = doc.lastAutoTable.finalY + 6;
    }
  }

  // Totals
  const gt = Number(computed?.grandTotal || 0);
  const laborAfter = Number(computed?.laborAfterMultiplier || 0);
  const mats = Number(computed?.materials?.totalCharge || 0);
  const haz = Number(computed?.hazardAmount || 0);

  autoTable(doc, {
    startY: y,
    head: [["Totals", "Amount"]],
    body: [
      ["Labor (after hazard + multiplier)", laborAfter.toFixed(2)],
      ["Hazard amount (labor)", haz.toFixed(2)],
      ["Materials", mats.toFixed(2)],
      ["Grand Total", gt.toFixed(2)],
    ],
    styles: { fontSize: 10 },
    headStyles: { fontStyle: "bold" },
  });

  // Additional notes
  const addl = safe(state?.additionalNotes).trim();
  if (addl) {
    y = doc.lastAutoTable.finalY + 8;
    doc.setFontSize(11);
    doc.text("Additional Notes", leftX, y); y += 6;
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(addl, 180);
    doc.text(lines, leftX, y);
  }

  return doc;
}
