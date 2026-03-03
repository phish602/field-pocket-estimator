// @ts-nocheck
/* eslint-disable */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { detectDataUrlType } from "./utils/sanitize";
import { DEFAULT_SETTINGS, loadSettings } from "./utils/settings";

const FALLBACK_BORDER = [214, 219, 228];
const FALLBACK_MUTED = [95, 103, 115];

function ensureArray(v) {
  return Array.isArray(v) ? v : [];
}

function asText(v, fallback = "") {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function clampWrappedText(doc, text, maxWidth, maxLines) {
  const clean = asText(text).replace(/\r\n/g, "\n");
  if (!clean) return "";
  const width = Math.max(80, Number(maxWidth) || 0);
  const lines = doc.splitTextToSize(clean, width);
  if (!Array.isArray(lines) || lines.length === 0) return "";
  const limit = Math.max(1, Number(maxLines) || 1);
  if (lines.length <= limit) return lines.join("\n");
  const clipped = lines.slice(0, limit);
  const last = String(clipped[limit - 1] || "").replace(/\s+$/g, "");
  clipped[limit - 1] = last ? `${last}…` : "…";
  return clipped.join("\n");
}

function buildPdfDoc(payload) {
  const canonicalSettings = loadSettings();
  const pdfSettings = canonicalSettings?.pdf || DEFAULT_SETTINGS.pdf;
  const includeLogo = pdfSettings.includeLogo !== false;
  const compactLayout = !!pdfSettings.compactLayout;
  const showUnitRates = pdfSettings.showUnitRates !== false;
  const doc = new jsPDF({ orientation: "p", unit: "pt", format: "letter" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();

  const margin = Number(payload?.layout?.margin) || (compactLayout ? 24 : 32);
  const contentWidth = pageWidth - margin * 2;
  const border = ensureArray(payload?.layout?.borderColor).length === 3 ? payload.layout.borderColor : FALLBACK_BORDER;
  const muted = ensureArray(payload?.layout?.mutedColor).length === 3 ? payload.layout.mutedColor : FALLBACK_MUTED;
  const tableFontSize = compactLayout ? 9 : 10;
  const sectionGap = compactLayout ? 7 : 10;
  const summaryFontSize = compactLayout ? 9.75 : 10.5;

  const uiDocType = payload?.docType === "invoice" ? "invoice" : "estimate";
  const title = uiDocType === "invoice" ? "INVOICE" : "ESTIMATE";
  const showNotes = uiDocType === "estimate";

  const company = payload?.company || {};
  const customer = payload?.customer || {};
  const job = payload?.job || {};
  const laborRows = ensureArray(payload?.laborRows);
  const materialRows = ensureArray(payload?.materialRows);
  const materialsMode = payload?.materialsMode === "itemized" ? "itemized" : "blanket";
  const materialsBlanketDescription = asText(payload?.materialsBlanketDescription);
  const summaryRows = ensureArray(payload?.summaryRows);
  const tradeInsertText = asText(payload?.tradeInsertText);
  const scopeNotes = asText(payload?.scopeNotes);
  const additionalNotes = asText(payload?.additionalNotes);

  const headerTop = compactLayout ? 30 : 36;
  const logoBoxW = compactLayout ? 104 : 118;
  const logoBoxH = compactLayout ? 54 : 62;
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
  const companyAddrLines = ensureArray(company.addressLines).map((line) => asText(line)).filter(Boolean);
  const companyAddr = companyAddrLines.length ? companyAddrLines.join("\n") : asText(company.address);
  if (companyAddr) doc.text(companyAddr, margin, headerTop + 28);

  doc.setFontSize(12);
  doc.setFont(undefined, "bold");
  doc.text(title, margin, headerTop + 52);
  doc.setFont(undefined, "normal");
  doc.setFontSize(10);
  doc.text(`# ${asText(payload?.documentNumber, "Draft")}`, margin + 68, headerTop + 52);
  doc.text(`Date: ${asText(job.dateDisplay, asText(job.date, "-"))}`, margin + 168, headerTop + 52);

  if (includeLogo && company.logoDataUrl) {
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
    styles: { fontSize: tableFontSize, cellPadding: compactLayout ? 5 : 6, lineColor: border, lineWidth: 0.5 },
    headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
    margin: { left: margin, right: margin },
  });
  cursorY = (doc.lastAutoTable?.finalY || cursorY) + sectionGap;

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
    styles: { fontSize: tableFontSize, cellPadding: compactLayout ? 5 : 6, lineColor: border, lineWidth: 0.5 },
    headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
    columnStyles: { 0: { cellWidth: 130, fontStyle: "bold" }, 1: { cellWidth: contentWidth - 130 } },
    margin: { left: margin, right: margin },
  });
  cursorY = (doc.lastAutoTable?.finalY || cursorY) + sectionGap;

  if (showNotes && tradeInsertText) {
    autoTable(doc, {
      startY: cursorY,
      head: [["TRADE INSERTS"]],
      body: [[tradeInsertText]],
      theme: "grid",
      styles: { fontSize: tableFontSize, cellPadding: compactLayout ? 5 : 6, lineColor: border, lineWidth: 0.5 },
      headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
      margin: { left: margin, right: margin },
    });
    cursorY = (doc.lastAutoTable?.finalY || cursorY) + sectionGap;
  }

  const laborTableRows = laborRows.length ? laborRows : [["Labor", "1", "0", "$0.00", "$0.00"]];
  const laborHead = showUnitRates
    ? [["LABOR ITEMS", "Qty", "Hours", "Rate", "Line Total"]]
    : [["LABOR ITEMS", "Qty", "Hours", "Line Total"]];
  const laborBody = laborTableRows.map((row) => {
    const arr = Array.isArray(row) ? row : [];
    if (showUnitRates) {
      return [
        asText(arr[0], "Labor"),
        asText(arr[1], "1"),
        asText(arr[2], "0"),
        asText(arr[3], "$0.00"),
        asText(arr[4], "$0.00"),
      ];
    }
    return [
      asText(arr[0], "Labor"),
      asText(arr[1], "1"),
      asText(arr[2], "0"),
      asText(arr[4] ?? arr[3], "$0.00"),
    ];
  });
  autoTable(doc, {
    startY: cursorY,
    head: laborHead,
    body: laborBody,
    theme: "grid",
    styles: { fontSize: tableFontSize, cellPadding: compactLayout ? 5 : 6, lineColor: border, lineWidth: 0.5 },
    headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
    margin: { left: margin, right: margin },
  });
  cursorY = (doc.lastAutoTable?.finalY || cursorY) + sectionGap;

  const materialsTableRows = materialRows.length ? materialRows : [["Materials", "1", "$0.00", "$0.00"]];
  const materialsHead = showUnitRates
    ? [["MATERIALS ITEMS", "Qty", "Price (each)", "Line Total"]]
    : [["MATERIALS ITEMS", "Qty", "Line Total"]];
  const materialsBody = materialsTableRows.map((row) => {
    const arr = Array.isArray(row) ? row : [];
    if (showUnitRates) {
      return [
        asText(arr[0], "Materials"),
        asText(arr[1], "1"),
        asText(arr[2], "$0.00"),
        asText(arr[3], "$0.00"),
      ];
    }
    return [
      asText(arr[0], "Materials"),
      asText(arr[1], "1"),
      asText(arr[3] ?? arr[2], "$0.00"),
    ];
  });
  autoTable(doc, {
    startY: cursorY,
    head: materialsHead,
    body: materialsBody,
    theme: "grid",
    styles: { fontSize: tableFontSize, cellPadding: compactLayout ? 5 : 6, lineColor: border, lineWidth: 0.5 },
    headStyles: { fillColor: [242, 245, 249], textColor: [24, 24, 24], fontStyle: "bold" },
    margin: { left: margin, right: margin },
  });
  cursorY = (doc.lastAutoTable?.finalY || cursorY);

  if (materialsMode === "blanket" && materialsBlanketDescription) {
    const descIndent = compactLayout ? 10 : 12;
    const descMaxWidth = contentWidth - (descIndent * 2);
    const clampedDesc = clampWrappedText(doc, materialsBlanketDescription, descMaxWidth, compactLayout ? 4 : 5);
    if (clampedDesc) {
      const descLines = clampedDesc.split("\n");
      const lineHeight = compactLayout ? 10 : 11;
      const topGap = compactLayout ? 5 : 7;
      const labelOffset = lineHeight;
      const bodyOffset = lineHeight + 2;
      const blockHeight = (labelOffset + bodyOffset) + (descLines.length * lineHeight);
      let descStartY = cursorY + topGap;
      const bottomSafety = pageHeight - 42;
      if (descStartY + blockHeight > bottomSafety) {
        doc.addPage();
        descStartY = margin + 16;
      }

      doc.setFontSize(compactLayout ? 8.5 : 9);
      doc.setFont(undefined, "bold");
      doc.setTextColor(...muted);
      doc.text("Materials Description:", margin + descIndent, descStartY + labelOffset);

      doc.setFont(undefined, "normal");
      doc.setTextColor(28, 31, 38);
      doc.text(descLines, margin + descIndent, descStartY + bodyOffset + lineHeight);

      cursorY = descStartY + blockHeight;
    }
  }
  cursorY += sectionGap;

  autoTable(doc, {
    startY: cursorY,
    head: [["SUMMARY / TOTALS", "Amount"]],
    body: summaryRows,
    theme: "grid",
    styles: { fontSize: summaryFontSize, cellPadding: compactLayout ? 5 : 6, lineColor: border, lineWidth: 0.5 },
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
  cursorY = (doc.lastAutoTable?.finalY || cursorY) + sectionGap;

  if (showNotes && scopeNotes) {
    autoTable(doc, {
      startY: cursorY,
      head: [["SCOPE / NOTES"]],
      body: [[scopeNotes]],
      theme: "grid",
      styles: { fontSize: compactLayout ? 9 : 9.5, cellPadding: compactLayout ? 5 : 6, lineColor: border, lineWidth: 0.5, textColor: [25, 25, 25] },
      headStyles: { fillColor: [248, 250, 252], textColor: [24, 24, 24], fontStyle: "bold" },
      margin: { left: margin, right: margin },
    });
    cursorY = (doc.lastAutoTable?.finalY || cursorY) + (compactLayout ? 6 : 8);
  }

  if (showNotes && additionalNotes) {
    autoTable(doc, {
      startY: cursorY,
      head: [["ADDITIONAL NOTES"]],
      body: [[additionalNotes]],
      theme: "grid",
      styles: { fontSize: compactLayout ? 9 : 9.5, cellPadding: compactLayout ? 5 : 6, lineColor: border, lineWidth: 0.5, textColor: [25, 25, 25] },
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
