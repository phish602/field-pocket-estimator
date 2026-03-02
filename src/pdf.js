// @ts-nocheck
/* eslint-disable */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { detectDataUrlType } from "./utils/sanitize";

const FALLBACK_BORDER = [214, 219, 228];
const FALLBACK_MUTED = [95, 103, 115];

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function asText(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function buildPdfDoc(payload) {
  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const margin = Number(payload?.layout?.margin) || 32;
  const contentWidth = pageWidth - margin * 2;
  const border = ensureArray(payload?.layout?.borderColor).length === 3 ? payload.layout.borderColor : FALLBACK_BORDER;
  const muted = ensureArray(payload?.layout?.mutedColor).length === 3 ? payload.layout.mutedColor : FALLBACK_MUTED;

  const uiDocType = payload?.docType === "invoice" ? "invoice" : "estimate";
  const title = uiDocType === "invoice" ? "INVOICE" : "ESTIMATE";

  const company = payload?.company || {};
  const customer = payload?.customer || {};
  const job = payload?.job || {};
  const laborRows = ensureArray(payload?.laborRows);
  const materialRows = ensureArray(payload?.materialRows);
  const summaryRows = ensureArray(payload?.summaryRows);
  const tradeInsertText = asText(payload?.tradeInsertText);
  const scopeNotes = asText(payload?.scopeNotes);
  const additionalNotes = asText(payload?.additionalNotes);

  const headerTop = 36;
  const logoBoxW = 118;
  const logoBoxH = 62;
  const logoBoxX = pageWidth - margin - logoBoxW;
  const logoBoxY = headerTop - 4;

  doc.setFontSize(16);
  doc.setFont(undefined, "bold");
  doc.text(asText(company.companyName, "Company"), margin, headerTop);

  doc.setFontSize(10);
  doc.setFont(undefined, "normal");
  const companyMeta = [
    asText(company.phone),
    asText(company.email),
    asText(company.website),
  ].filter(Boolean).join(" • ");
  if (companyMeta) doc.text(companyMeta, margin, headerTop + 14);
  const companyAddr = asText(company.address);
  if (companyAddr) doc.text(companyAddr, margin, headerTop + 28);

  doc.setFontSize(12);
  doc.setFont(undefined, "bold");
  doc.text(title, margin, headerTop + 52);
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.text(`# ${asText(payload?.documentNumber, "Draft")}`, margin + 68, headerTop + 52);
  doc.text(`Date: ${asText(job.dateDisplay, asText(job.date, "-"))}`, margin + 168, headerTop + 52);

  if (company.logoDataUrl) {
    try {
      const props = doc.getImageProperties(company.logoDataUrl);
      const iw = Number(props?.width) || 1;
      const ih = Number(props?.height) || 1;
      const scale = Math.min(logoBoxW / iw, logoBoxH / ih);
      const drawW = iw * scale;
      const drawH = ih * scale;
      const drawX = logoBoxX + (logoBoxW - drawW) / 2;
      const drawY = logoBoxY + (logoBoxH - drawH) / 2;
      doc.addImage(company.logoDataUrl, detectDataUrlType(company.logoDataUrl), drawX, drawY, drawW, drawH);
    } catch {}
  }

  doc.setDrawColor(...border);
  doc.setLineWidth(0.8);
  doc.line(margin, headerTop + 64, pageWidth - margin, headerTop + 64);

  let cursorY = headerTop + 76;

  autoTable(doc, {
    startY: cursorY,
    head: [["CUSTOMER", "BILL TO"]],
    body: [[
      [asText(customer.name, "-"), customer.attn ? `Attn: ${customer.attn}` : "", asText(customer.address, "-")].filter(Boolean).join("\n"),
      [asText(customer.name, "-"), asText(customer.billingAddress, asText(customer.address, "-"))].filter(Boolean).join("\n"),
    ]],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 6, lineColor: border, lineWidth: 0.5 },
    headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
    margin: { left: margin, right: margin },
  });
  cursorY = (doc.lastAutoTable?.finalY || cursorY) + 10;

  autoTable(doc, {
    startY: cursorY,
    head: [["JOB INFO", ""]],
    body: ensureArray(payload?.jobInfoRows).length
      ? payload.jobInfoRows
      : [
        ["Document #", asText(payload?.documentNumber, "Draft")],
        ["Date", asText(job.dateDisplay, asText(job.date, "-"))],
        ["Project", asText(job.projectName, "-")],
        ["Project #", asText(job.projectNumber, "-")],
        ["Project Address", asText(job.projectAddress, "-")],
        ["PO #", asText(job.poNumber, "-")],
      ],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 6, lineColor: border, lineWidth: 0.5 },
    headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 130, fontStyle: "bold" }, 1: { cellWidth: contentWidth - 130 } },
    margin: { left: margin, right: margin },
  });
  cursorY = (doc.lastAutoTable?.finalY || cursorY) + 10;

  if (tradeInsertText) {
    autoTable(doc, {
      startY: cursorY,
      head: [["TRADE INSERTS"]],
      body: [[tradeInsertText]],
      theme: "grid",
      styles: { fontSize: 10, cellPadding: 6, lineColor: border, lineWidth: 0.5 },
      headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
      margin: { left: margin, right: margin },
    });
    cursorY = (doc.lastAutoTable?.finalY || cursorY) + 10;
  }

  autoTable(doc, {
    startY: cursorY,
    head: [["LABOR ITEMS", "Qty", "Hours", "Rate", "Line Total"]],
    body: laborRows.length ? laborRows : [["Labor", "1", "0", "$0.00", "$0.00"]],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 6, lineColor: border, lineWidth: 0.5 },
    headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
    margin: { left: margin, right: margin },
  });
  cursorY = (doc.lastAutoTable?.finalY || cursorY) + 10;

  autoTable(doc, {
    startY: cursorY,
    head: [["MATERIALS ITEMS", "Qty", "Price (each)", "Line Total"]],
    body: materialRows.length ? materialRows : [["Materials", "1", "$0.00", "$0.00"]],
    theme: "grid",
    styles: { fontSize: 10, cellPadding: 6, lineColor: border, lineWidth: 0.5 },
    headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
    margin: { left: margin, right: margin },
  });
  cursorY = (doc.lastAutoTable?.finalY || cursorY) + 10;

  autoTable(doc, {
    startY: cursorY,
    head: [["SUMMARY / TOTALS", "Amount"]],
    body: summaryRows,
    theme: "grid",
    styles: { fontSize: 10.5, cellPadding: 6, lineColor: border, lineWidth: 0.5 },
    headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: contentWidth - 130 }, 1: { cellWidth: 130, halign: "right" } },
    didParseCell: (data) => {
      if (data.section === "body" && data.row.index === summaryRows.length - 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [245, 248, 252];
      }
    },
    margin: { left: margin, right: margin },
  });
  cursorY = (doc.lastAutoTable?.finalY || cursorY) + 10;

  if (scopeNotes) {
    autoTable(doc, {
      startY: cursorY,
      head: [["SCOPE / NOTES"]],
      body: [[scopeNotes]],
      theme: "grid",
      styles: { fontSize: 9.5, cellPadding: 6, lineColor: border, lineWidth: 0.5, textColor: [25, 25, 25] },
      headStyles: { fillColor: [248, 250, 252], textColor: [24, 24, 24], fontStyle: "bold" },
      margin: { left: margin, right: margin },
    });
    cursorY = (doc.lastAutoTable?.finalY || cursorY) + 8;
  }

  if (additionalNotes) {
    autoTable(doc, {
      startY: cursorY,
      head: [["ADDITIONAL NOTES"]],
      body: [[additionalNotes]],
      theme: "grid",
      styles: { fontSize: 9.5, cellPadding: 6, lineColor: border, lineWidth: 0.5, textColor: [25, 25, 25] },
      headStyles: { fillColor: [248, 250, 252], textColor: [24, 24, 24], fontStyle: "bold" },
      margin: { left: margin, right: margin },
    });
  }

  const footerY = pageHeight - 20;
  doc.setFontSize(9);
  doc.setTextColor(...muted);
  doc.text(`Generated by EstiPaid • ${uiDocType === "invoice" ? "Invoice" : "Estimate"} ${asText(payload?.documentNumber, "Draft")}`, margin, footerY);

  return doc;
}

export async function exportPdf(payload, mode = "download") {
  const normalizedMode = mode === "view" || mode === "share" ? mode : "download";
  const doc = buildPdfDoc(payload || {});
  const filename = asText(payload?.filename, "Estimate-Draft.pdf");

  if (normalizedMode === "view") {
    try {
      const ab = doc.output("arraybuffer");
      const blob = new Blob([ab], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener,noreferrer");
      setTimeout(() => {
        try { URL.revokeObjectURL(url); } catch {}
      }, 60000);
      return;
    } catch {
      doc.save(filename);
      return;
    }
  }

  if (normalizedMode === "share") {
    try {
      const ab = doc.output("arraybuffer");
      const blob = new Blob([ab], { type: "application/pdf" });
      const shareFile = new File([blob], filename, { type: "application/pdf" });
      if (typeof navigator !== "undefined" && navigator.share) {
        try {
          await navigator.share({
            files: [shareFile],
            title: filename,
            text: payload?.docType === "invoice" ? "Invoice PDF" : "Estimate PDF",
          });
          return;
        } catch {}
      }
      doc.save(filename);
      return;
    } catch {
      doc.save(filename);
      return;
    }
  }

  doc.save(filename);
}
