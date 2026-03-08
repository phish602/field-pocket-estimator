// @ts-nocheck
/* eslint-disable */

import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { STORAGE_KEYS } from "./constants/storageKeys";
import { detectDataUrlType } from "./utils/sanitize";

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function asText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function splitText(doc, value, width) {
  const text = asText(value);
  if (!text) return [];
  return doc.splitTextToSize(text.replace(/\r\n/g, "\n"), width);
}

function normalizeLongTextLine(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function isStructuredListLine(value) {
  return /^(([-*•\u2013\u2014])\s+|\(?\d{1,3}[.)]\s+|[a-zA-Z][.)]\s+)/.test(String(value || "").trim());
}

function splitParagraphSentences(value) {
  const text = normalizeLongTextLine(value);
  if (!text) return [];

  const sentences = [];
  let start = 0;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char !== "." && char !== "!" && char !== "?") continue;

    let end = i;
    while (end + 1 < text.length && /[.!?]/.test(text[end + 1])) end += 1;

    let next = end + 1;
    while (next < text.length && /\s/.test(text[next])) next += 1;

    let probe = next;
    while (probe < text.length && /["')\]}]/.test(text[probe])) probe += 1;

    const shouldSplit = probe >= text.length || /[A-Z0-9]/.test(text[probe]);
    if (!shouldSplit) continue;

    const sentence = text.slice(start, next).trim();
    if (sentence) sentences.push(sentence);
    start = next;
    i = end;
  }

  const tail = text.slice(start).trim();
  if (tail) sentences.push(tail);
  return sentences.filter(Boolean);
}

function formatDenseLongTextParagraph(value) {
  const text = normalizeLongTextLine(value);
  if (!text) return "";

  const sentences = splitParagraphSentences(text);
  if (sentences.length <= 1) {
    const semicolonParts = text.split(/\s*;\s*/).map(normalizeLongTextLine).filter(Boolean);
    if (semicolonParts.length >= 3) {
      return semicolonParts
        .map((part, index) => (index < semicolonParts.length - 1 ? `${part};` : part))
        .join("\n");
    }
    return text;
  }

  if (sentences.length <= 3 && text.length < 240) {
    return text;
  }

  const groupedSentences = [];
  let currentGroup = [];
  let currentLength = 0;

  for (const sentence of sentences) {
    const nextLength = currentLength + (currentGroup.length ? 1 : 0) + sentence.length;
    if (currentGroup.length && (currentGroup.length >= 3 || nextLength > 220)) {
      groupedSentences.push(currentGroup);
      currentGroup = [sentence];
      currentLength = sentence.length;
      continue;
    }

    currentGroup.push(sentence);
    currentLength = nextLength;
  }

  if (currentGroup.length) groupedSentences.push(currentGroup);

  if (groupedSentences.length > 1 && groupedSentences[groupedSentences.length - 1].length === 1) {
    const previousGroup = groupedSentences[groupedSentences.length - 2];
    if (previousGroup?.length >= 3) {
      groupedSentences[groupedSentences.length - 1].unshift(previousGroup.pop());
    }
  }

  return groupedSentences.map((group) => group.join(" ")).join("\n\n");
}

function formatLongFormPdfText(value) {
  const text = asText(value);
  if (!text) return "";

  const normalized = text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  const blocks = normalized.split(/\n{2,}/);
  const formattedBlocks = [];

  for (const block of blocks) {
    const trimmedBlock = block.trim();
    if (!trimmedBlock) continue;

    const lines = trimmedBlock
      .split(/\n+/)
      .map(normalizeLongTextLine)
      .filter(Boolean);

    if (!lines.length) continue;

    if (lines.some(isStructuredListLine)) {
      formattedBlocks.push(lines.join("\n"));
      continue;
    }

    if (lines.length > 1) {
      const averageLineLength = lines.reduce((sum, line) => sum + line.length, 0) / lines.length;
      const shortLineCount = lines.filter((line) => line.length <= 90).length;
      const preserveLineBreaks = averageLineLength <= 80
        || (lines.length >= 3 && shortLineCount >= Math.ceil(lines.length * 0.75));

      if (preserveLineBreaks) {
        formattedBlocks.push(lines.join("\n"));
        continue;
      }

      formattedBlocks.push(formatDenseLongTextParagraph(lines.join(" ")));
      continue;
    }

    formattedBlocks.push(formatDenseLongTextParagraph(lines[0]));
  }

  return formattedBlocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function cleanMaterialNoteText(value) {
  const text = asText(value);
  if (!text) return "";
  return text.replace(/^\s*[-\u2022\u2013\u2014]+\s*/, "");
}

function getCellPaddingValue(cellPadding, side, fallback = 0) {
  if (typeof cellPadding === "number") return cellPadding;
  if (cellPadding && typeof cellPadding === "object") {
    const next = Number(cellPadding?.[side]);
    return Number.isFinite(next) ? next : fallback;
  }
  return fallback;
}

function normalizeMaterialRow(row) {
  if (Array.isArray(row)) {
    return {
      desc: asText(row?.[0]),
      note: asText(row?.note),
      qty: asText(row?.[1], "-"),
      each: asText(row?.[2], "-"),
      total: asText(row?.[3], "-"),
    };
  }

  if (row && typeof row === "object") {
    return {
      desc: asText(row?.desc, asText(row?.description, asText(row?.label))),
      note: asText(row?.note),
      qty: asText(row?.qty, "-"),
      each: asText(row?.each, asText(row?.priceEach, asText(row?.price, "-"))),
      total: asText(row?.total, asText(row?.lineTotal, asText(row?.amount, "-"))),
    };
  }

  return {
    desc: "-",
    note: "",
    qty: "-",
    each: "-",
    total: "-",
  };
}

function buildFooterLine(company) {
  const address = ensureArray(company?.addressLines)
    .map((line) => asText(line))
    .filter(Boolean)
    .join(", ") || asText(company?.address);

  return [
    asText(company?.companyName),
    asText(company?.phone),
    address,
  ].filter(Boolean).join(" • ");
}

function buildFooterDetails(company) {
  const address = ensureArray(company?.addressLines)
    .map((line) => asText(line))
    .filter(Boolean)
    .join(", ") || asText(company?.address);

  return [
    asText(company?.phone),
    address,
  ].filter(Boolean).join(" • ");
}

function buildBillToText(customer) {
  return [
    asText(customer?.name),
    asText(customer?.billingAddress, asText(customer?.address)),
  ].filter(Boolean).join("\n");
}

function buildCustomerText(customer) {
  return [
    asText(customer?.name),
    customer?.attn ? `Attn: ${asText(customer.attn)}` : "",
    asText(customer?.address),
  ].filter(Boolean).join("\n");
}

function buildProjectText(job) {
  const projectNumber = asText(job?.projectNumber);
  return [
    asText(job?.projectName),
    projectNumber ? `# ${projectNumber}` : "",
    asText(job?.projectAddress),
  ].filter(Boolean).join("\n");
}

function resolveLogoFallbackSourceText(company) {
  const firstName = asText(company?.firstName);
  const lastName = asText(company?.lastName);
  const joinedName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const candidates = [
    company?.companyName,
    company?.businessName,
    company?.legalName,
    company?.displayName,
    company?.name,
    company?.fullName,
    company?.ownerName,
    company?.contactName,
    company?.attn,
    joinedName,
  ];

  for (const candidate of candidates) {
    const text = asText(candidate);
    if (text) return text;
  }

  return "";
}

function buildLogoFallbackInitials(company) {
  const source = resolveLogoFallbackSourceText(company)
    .replace(/[^\w\s&/-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!source) return "EP";

  const rawWords = source
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean);

  if (!rawWords.length) return "EP";

  const acronymCandidate = rawWords[0].replace(/[^A-Za-z0-9]/g, "");
  if (
    acronymCandidate.length >= 2
    && acronymCandidate.length <= 3
    && /[A-Z]/.test(rawWords[0])
    && rawWords[0] === rawWords[0].toUpperCase()
  ) {
    return acronymCandidate.toUpperCase();
  }

  const genericWords = new Set([
    "and",
    "co",
    "company",
    "corp",
    "corporation",
    "enterprise",
    "enterprises",
    "group",
    "holding",
    "holdings",
    "inc",
    "incorporated",
    "limited",
    "llc",
    "ltd",
    "partners",
    "partner",
    "service",
    "services",
    "solution",
    "solutions",
    "system",
    "systems",
    "the",
  ]);

  const words = rawWords
    .map((part) => part.replace(/[^A-Za-z0-9]/g, ""))
    .filter(Boolean);
  const filteredWords = words.filter((word) => !genericWords.has(word.toLowerCase()));
  const meaningfulWords = filteredWords.length ? filteredWords : words;

  if (!meaningfulWords.length) return "EP";
  if (meaningfulWords.length === 1) {
    return meaningfulWords[0].slice(0, 3).toUpperCase();
  }

  return meaningfulWords
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("")
    .slice(0, 3) || "EP";
}

function drawLogoFallbackBadge(doc, company, x, y) {
  const badgeWidth = 48;
  const badgeHeight = 22;
  const initials = buildLogoFallbackInitials(company);
  const fontSize = initials.length >= 3 ? 12.6 : 14.6;

  doc.setDrawColor(165, 165, 165);
  doc.setFillColor(245, 245, 245);
  doc.setLineWidth(0.45);
  doc.roundedRect(x, y, badgeWidth, badgeHeight, 2.8, 2.8, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(fontSize);
  doc.setTextColor(44, 44, 44);
  doc.text(initials, x + (badgeWidth / 2), y + (badgeHeight / 2) + 0.2, {
    align: "center",
    baseline: "middle",
  });
  doc.setTextColor(20, 20, 20);
}

function drawLogo(doc, company, x, y) {
  const logoDataUrl = asText(company?.logoDataUrl);
  if (!logoDataUrl) {
    drawLogoFallbackBadge(doc, company, x, y);
    return;
  }

  try {
    const props = doc.getImageProperties(logoDataUrl);
    const width = Number(props?.width) || 1;
    const height = Number(props?.height) || 1;
    const maxWidth = 48;
    const maxHeight = 22;
    const scale = Math.min(maxWidth / width, maxHeight / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    doc.addImage(
      logoDataUrl,
      detectDataUrlType(logoDataUrl),
      x,
      y,
      drawWidth,
      drawHeight
    );
  } catch {
    drawLogoFallbackBadge(doc, company, x, y);
  }
}

function safeParseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readStoredJson(key) {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key);
    return raw ? safeParseJson(raw) : null;
  } catch {
    return null;
  }
}

function parseTermsDays(value) {
  if (value === null || value === undefined || value === "") return null;
  const days = typeof value === "number" ? value : parseInt(String(value).trim(), 10);
  if (!Number.isFinite(days)) return null;
  if (days < 0 || days > 365) return null;
  return days;
}

function parseTermsString(value) {
  const raw = asText(value);
  if (!raw) return null;

  const normalized = raw
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) return null;

  if (
    /\bdue\s+(?:on|upon)\s+receipt\b/.test(normalized)
    || /\bpayment\s+is\s+due\s+upon\s+receipt\b/.test(normalized)
    || /\bpayment\s+due\s+upon\s+receipt\b/.test(normalized)
    || /\bupon\s+receipt\b/.test(normalized)
  ) {
    return { kind: "receipt" };
  }

  const netMatch = normalized.match(/\bnet\s*(\d{1,3})\b/);
  if (netMatch) {
    const days = parseTermsDays(netMatch[1]);
    if (days === 0) return { kind: "receipt" };
    if (days !== null) return { kind: "net", days };
  }

  const daysMatch = normalized.match(/\b(\d{1,3})\s*days?\b/);
  if (daysMatch) {
    const days = parseTermsDays(daysMatch[1]);
    if (days === 0) return { kind: "receipt" };
    if (days !== null) return { kind: "net", days };
  }

  return null;
}

function extractPaymentTerms(source) {
  if (!source || typeof source !== "object") return null;

  const dayCandidates = [
    source?.netTermsDays,
    source?.termsDays,
    source?.netDays,
    source?.paymentTermsDays,
    source?.terms,
    source?.paymentTerms,
  ];

  for (const candidate of dayCandidates) {
    const days = parseTermsDays(candidate);
    if (days === null) continue;
    if (days === 0) return { kind: "receipt" };
    return { kind: "net", days };
  }

  const stringCandidates = [
    source?.netTermsLabel,
    source?.paymentTerms,
    source?.paymentTermsLabel,
    source?.termsLabel,
    source?.netTerms,
    source?.terms,
    source?.netTermsType,
  ];

  for (const candidate of stringCandidates) {
    const parsed = parseTermsString(candidate);
    if (parsed) return parsed;
  }

  return null;
}

function matchesDocumentNumber(record, documentNumber, docType = "") {
  const expected = asText(documentNumber);
  if (!expected) return false;

  const normalizedDocType = docType === "invoice" || docType === "estimate" ? docType : "";
  const recordDocType = asText(record?.docType).toLowerCase();

  if (normalizedDocType && recordDocType && recordDocType !== normalizedDocType) {
    return false;
  }

  const candidates = normalizedDocType === "invoice"
    ? [record?.invoiceNumber, record?.documentNumber, record?.number, record?.job?.docNumber]
    : normalizedDocType === "estimate"
      ? [record?.estimateNumber, record?.documentNumber, record?.number, record?.job?.docNumber]
      : [record?.invoiceNumber, record?.estimateNumber, record?.documentNumber, record?.number, record?.job?.docNumber];

  return candidates.some((value) => asText(value) === expected);
}

function findStoredDoc(key, documentNumber, docType = "") {
  const records = ensureArray(readStoredJson(key));
  if (!records.length) return null;
  return records.find((record) => matchesDocumentNumber(record, documentNumber, docType)) || null;
}

function resolveInvoicePaymentTerms(payload) {
  const documentNumber = asText(payload?.documentNumber);
  const candidateSources = [payload?.customer, payload];

  const draft = readStoredJson(STORAGE_KEYS.ESTIMATOR_STATE);
  if (
    draft
    && draft?.ui?.docType === "invoice"
    && matchesDocumentNumber(draft, documentNumber, "invoice")
  ) {
    candidateSources.push(draft?.customer, draft);
  }

  const savedInvoice = findStoredDoc(STORAGE_KEYS.INVOICES, documentNumber, "invoice");
  if (savedInvoice) candidateSources.push(savedInvoice?.customer, savedInvoice);

  const savedEstimate = findStoredDoc(STORAGE_KEYS.ESTIMATES, documentNumber, "invoice");
  if (savedEstimate) candidateSources.push(savedEstimate?.customer, savedEstimate);

  for (const source of candidateSources) {
    const parsed = extractPaymentTerms(source);
    if (parsed) return parsed;
  }

  return null;
}

function buildInvoicePaymentTermsText(payload) {
  const parsed = resolveInvoicePaymentTerms(payload);

  if (parsed?.kind === "receipt") {
    return "Payment Terms: Payment is due upon receipt of this invoice, unless otherwise agreed to in writing.";
  }

  if (parsed?.kind === "net" && Number.isFinite(parsed?.days) && parsed.days > 0) {
    return `Payment Terms: Full payment is due within ${parsed.days} days of receipt of this invoice, unless otherwise agreed to in writing.`;
  }

  return "Payment Terms: Full payment is due within 30 days of receipt of this invoice, unless otherwise agreed to in writing.";
}

function buildPdfDoc(payload) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const company = payload?.company || {};
  const customer = payload?.customer || {};
  const job = payload?.job || {};
  const materialRows = ensureArray(payload?.materialRows);
  const isItemizedMaterials = payload?.materialsMode === "itemized";
  const normalizedMaterialRows = (
    isItemizedMaterials
      ? materialRows
      : (materialRows.length ? materialRows : [["-", "-", "-", "-"]])
  )
    .map(normalizeMaterialRow)
    .filter((row) => !isItemizedMaterials || !!asText(row?.desc));
  const summaryRows = ensureArray(payload?.summaryRows);
  const scopeNotesText = formatLongFormPdfText(payload?.scopeNotes);
  const tradeInsertText = formatLongFormPdfText(payload?.tradeInsertText);
  const additionalNotesText = formatLongFormPdfText(payload?.additionalNotes);
  const materialsBlanketDescription = asText(payload?.materialsBlanketDescription);
  const displayedSummaryRows = (summaryRows.length ? summaryRows : [["Total", "$0.00"]]).filter((row) => {
    const label = asText(row?.[0]).toLowerCase();
    return !label.startsWith("hazard") && !label.startsWith("risk");
  });
  const safeSummaryRows = displayedSummaryRows.length ? displayedSummaryRows : [["Total", "$0.00"]];
  const subtotalRowIndex = safeSummaryRows.findIndex((row) => asText(row?.[0]).toLowerCase() === "subtotal");
  const grandTotalRowIndex = safeSummaryRows.length - 1;
  const estimateLabel = payload?.docType === "invoice" ? "INVOICE #" : "ESTIMATE #";
  const estimateNumber = asText(payload?.documentNumber, "Draft");
  const date = asText(job?.dateDisplay, asText(job?.date, "-"));
  const po = asText(job?.poNumber, "-");
  const footerLine = buildFooterLine(company);
  const footerCompanyName = asText(company?.companyName);
  const footerDetails = buildFooterDetails(company);
  const invoicePaymentTermsText = payload?.docType === "invoice" ? buildInvoicePaymentTermsText(payload) : "";
  const billToText = buildBillToText(customer);
  const customerText = buildCustomerText(customer);
  const projectText = buildProjectText(job);
  const LEFT = 16;
  const RIGHT = 194;
  const CENTER = 105;
  const LOGO_Y = 15.5;
  const META_Y = 18;
  const CLIENT_Y = 48;
  const MATERIAL_HEADER_Y = 80.5;
  const ROW_HEIGHT = 5;
  const FOOTER_Y = pageHeight - 18.2;
  const RIGHT_GUTTER = Math.max(0, pageWidth - RIGHT);
  const TOTALS_TOP_OFFSET = 6.3;
  const TOTALS_TABLE_WIDTH = 62;
  const TOTALS_RIGHT_GUTTER = RIGHT_GUTTER + 4.5;
  const TOTALS_X = Math.max(LEFT, pageWidth - TOTALS_RIGHT_GUTTER - TOTALS_TABLE_WIDTH);
  const TOTALS_ROW_HEIGHT = ROW_HEIGHT + 1.35;
  const TOTALS_GRAND_TOTAL_ROW_HEIGHT = TOTALS_ROW_HEIGHT + 1.7;
  const PAGE_NUMBER_Y = FOOTER_Y;
  const PAGE_NUMBER_FONT_SIZE = 8.1;
  const PAGE_NUMBER_TEXT_COLOR = 110;
  const FOOTER_BLOCK_BOTTOM_Y = pageHeight - 24.2;
  const FOOTER_PRIMARY_FONT_SIZE = 15.4;
  const FOOTER_SECONDARY_FONT_SIZE = 12.4;
  const FOOTER_SECONDARY_LINE_HEIGHT = 1.32;
  const FOOTER_PRIMARY_TO_SECONDARY_GAP = 7.1;
  const FOOTER_DIVIDER_GAP = 5.4;
  const FOOTER_DIVIDER_SIDE_INSET = 10;
  const BORDER_COLOR = 165;
  const BORDER_LINE_WIDTH = 0.45;
  const HEADER_FILL = [245, 245, 245];
  const GRAND_TOTAL_FILL = [242, 242, 242];
  const MATERIAL_DESC_FONT_SIZE = 9.6;
  const MATERIAL_NOTE_FONT_SIZE = 8.05;
  const MATERIAL_DESC_LINE_HEIGHT_FACTOR = 1.15;
  const MATERIAL_NOTE_LINE_HEIGHT_FACTOR = 1.1;
  const MATERIAL_NOTE_GAP = 1.05;
  const MATERIAL_NOTE_INDENT = 2.8;
  const SECTION_PAGE_TOP = 25.5;
  const CONTENT_BOTTOM_BUFFER = 8.1;
  const TEXT_SECTION_GAP = 5.1;
  const MATERIAL_SECTION_GAP = 5.9;
  const SECTION_PREVIEW_LINES = 2;
  const SECTION_LINE_HEIGHT_FACTOR = 1.15;
  const SECTION_HEADER_MIN_HEIGHT = 5.8;
  const SECTION_BODY_PREVIEW_PADDING = 2.6;
  const MATERIAL_KEEP_BUFFER = 5.8;
  const TOTALS_KEEP_BUFFER = 8.8;
  const TOTALS_HEIGHT_SAFETY = 4.6;
  const META_BOX_HEIGHT = 13.2;
  const META_ROW_HEIGHT = META_BOX_HEIGHT / 2;
  const MATERIAL_TITLE_BAND_HEIGHT = 7.2;
  const MATERIAL_HEADER_GAP = 1.2;
  const TERMS_BOX_MIN_GAP = 22.4;
  const TERMS_BOX_LEFT = LEFT;
  const TERMS_BOX_PADDING_X = 3.2;
  const TERMS_BOX_TOP_PADDING = 1.6;
  const TERMS_BOX_BOTTOM_PADDING = 2.8;
  const TERMS_BOX_HEADER_BAND_HEIGHT = 5.8;
  const TERMS_BOX_BODY_TOP_GAP = 1.9;
  const TERMS_BOX_PAGE_TOP = 25.5;
  const TERMS_BOX_FOOTER_GAP = 9;
  const TERMS_HEADER_TEXT = "TERMS & CONDITIONS";
  const TERMS_HEADER_FONT_SIZE = 7.1;
  const TERMS_BODY_FONT_SIZE = 9.85;
  const TERMS_LINE_HEIGHT_FACTOR = 1.12;
  const INVOICE_NOTES_BOX_GAP = 12.8;
  const INVOICE_NOTES_HEADER_TEXT = "ADDITIONAL NOTES";
  const ESTIMATE_NOTES_BOX_GAP = 16;
  const ESTIMATE_NOTES_BOX_LEFT = LEFT;
  const ESTIMATE_NOTES_BOX_PADDING_X = 3.2;
  const ESTIMATE_NOTES_BOX_TOP_PADDING = 1.6;
  const ESTIMATE_NOTES_BOX_BOTTOM_PADDING = 2.8;
  const ESTIMATE_NOTES_HEADER_BAND_HEIGHT = 5.8;
  const ESTIMATE_NOTES_BODY_TOP_GAP = 1.9;
  const ESTIMATE_NOTES_PAGE_TOP = 25.5;
  const ESTIMATE_NOTES_FOOTER_GAP = 9;
  const ESTIMATE_NOTES_HEADER_TEXT = "ADDITIONAL NOTES";
  const ESTIMATE_NOTES_HEADER_FONT_SIZE = 7.1;
  const ESTIMATE_NOTES_BODY_FONT_SIZE = 9.4;
  const ESTIMATE_NOTES_LINE_HEIGHT_FACTOR = 1.14;
  const sectionTextWidth = Math.max(60, pageWidth - LEFT - RIGHT_GUTTER - 4.5);
  const footerTextWidth = RIGHT - LEFT - 14;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.95);
  doc.setFontSize(FOOTER_SECONDARY_FONT_SIZE);
  const footerSecondaryLines = footerDetails ? splitText(doc, footerDetails, footerTextWidth) : [];
  const footerSecondaryLineCount = Math.max(footerSecondaryLines.length, footerDetails ? 1 : 0);
  const footerSecondaryLineHeight = footerSecondaryLineCount
    ? (doc.getFontSize() * FOOTER_SECONDARY_LINE_HEIGHT) / doc.internal.scaleFactor
    : 0;
  const footerSecondaryHeight = footerSecondaryLineCount > 1
    ? (footerSecondaryLineCount - 1) * footerSecondaryLineHeight
    : 0;
  const footerPrimaryY = footerDetails
    ? FOOTER_BLOCK_BOTTOM_Y - footerSecondaryHeight - FOOTER_PRIMARY_TO_SECONDARY_GAP
    : FOOTER_BLOCK_BOTTOM_Y;
  const footerSecondaryY = footerDetails ? footerPrimaryY + FOOTER_PRIMARY_TO_SECONDARY_GAP : 0;
  const footerStartY = footerDetails ? footerPrimaryY : FOOTER_BLOCK_BOTTOM_Y;
  const footerDividerY = footerStartY - FOOTER_DIVIDER_GAP;
  const contentBottomLimit = (footerLine ? footerStartY : FOOTER_Y) - CONTENT_BOTTOM_BUFFER;

  function ensureSectionFits(startY, requiredHeight, nextPageTop = SECTION_PAGE_TOP) {
    let nextY = startY;
    if (nextY + requiredHeight > contentBottomLimit) {
      doc.addPage();
      nextY = nextPageTop;
    }
    return nextY;
  }

  function estimatePreviewTextHeight(text, fontSize, minCellHeight) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    const lines = splitText(doc, text, sectionTextWidth);
    const previewLineCount = Math.max(1, Math.min(lines.length || 1, SECTION_PREVIEW_LINES));
    const lineHeight = (doc.getFontSize() * SECTION_LINE_HEIGHT_FACTOR) / doc.internal.scaleFactor;
    return Math.max(minCellHeight, (previewLineCount * lineHeight) + SECTION_BODY_PREVIEW_PADDING);
  }

  function getMaterialRowLayout(rowData, cellWidth = 84, cellPadding = 1.45) {
    const materialRow = normalizeMaterialRow(rowData);
    const paddingTop = getCellPaddingValue(cellPadding, "top", 1.45);
    const paddingRight = getCellPaddingValue(cellPadding, "right", 1.45);
    const paddingBottom = getCellPaddingValue(cellPadding, "bottom", 1.45);
    const paddingLeft = getCellPaddingValue(cellPadding, "left", 1.45);
    const textWidth = Math.max(12, Number(cellWidth || 84) - paddingLeft - paddingRight);
    const noteText = cleanMaterialNoteText(materialRow.note);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(MATERIAL_DESC_FONT_SIZE);
    const descLines = splitText(doc, materialRow.desc || "-", textWidth);
    const descLineHeight = (MATERIAL_DESC_FONT_SIZE * MATERIAL_DESC_LINE_HEIGHT_FACTOR) / doc.internal.scaleFactor;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(MATERIAL_NOTE_FONT_SIZE);
    const noteLines = noteText ? splitText(doc, noteText, Math.max(10, textWidth - MATERIAL_NOTE_INDENT)) : [];
    const noteLineHeight = (MATERIAL_NOTE_FONT_SIZE * MATERIAL_NOTE_LINE_HEIGHT_FACTOR) / doc.internal.scaleFactor;

    const contentHeight = (Math.max(descLines.length, 1) * descLineHeight)
      + (noteLines.length ? (MATERIAL_NOTE_GAP + (noteLines.length * noteLineHeight)) : 0);

    return {
      materialRow,
      paddingTop,
      paddingRight,
      paddingBottom,
      paddingLeft,
      descLines,
      noteText,
      noteLines,
      descLineHeight,
      noteLineHeight,
      height: Math.max(4.2, paddingTop + contentHeight + paddingBottom),
    };
  }

  function estimateFirstMaterialRowHeight() {
    if (!normalizedMaterialRows.length) return 0;
    return getMaterialRowLayout(normalizedMaterialRows[0], 84, 1.45).height;
  }

  function estimateTotalsBlockHeight() {
    const rowsHeight = safeSummaryRows.reduce((sum, row, index) => {
      if (index === grandTotalRowIndex) return sum + TOTALS_GRAND_TOTAL_ROW_HEIGHT;
      if (index === subtotalRowIndex) return sum + Math.max(TOTALS_ROW_HEIGHT + 1.35, 7.3);
      return sum + TOTALS_ROW_HEIGHT;
    }, 0);
    return TOTALS_TOP_OFFSET + rowsHeight + TOTALS_KEEP_BUFFER + TOTALS_HEIGHT_SAFETY;
  }

  drawLogo(doc, company, LEFT, LOGO_Y);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  const estimateLabelWidth = doc.getTextWidth(estimateLabel);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const estimateValueWidth = doc.getTextWidth(estimateNumber);

  const estimateCellWidth = Math.max(30, estimateLabelWidth + 8, estimateValueWidth + 10);
  const dateCellWidth = 28;
  const poCellWidth = 24;
  const metaBoxWidth = estimateCellWidth + dateCellWidth + poCellWidth;
  const metaBoxX = Math.max(LEFT, RIGHT - metaBoxWidth);
  const contentRightEdge = metaBoxX + metaBoxWidth;
  const metaCenters = [
    metaBoxX + (estimateCellWidth / 2),
    metaBoxX + estimateCellWidth + (dateCellWidth / 2),
    metaBoxX + estimateCellWidth + dateCellWidth + (poCellWidth / 2),
  ];
  const TERMS_BOX_WIDTH = Math.max(contentRightEdge - LEFT + 2, RIGHT - LEFT + 2);
  const labelCenterY = META_Y + (META_ROW_HEIGHT / 2) + 0.05;
  const valueCenterY = META_Y + META_ROW_HEIGHT + (META_ROW_HEIGHT / 2) + 0.05;

  doc.setFillColor(...HEADER_FILL);
  doc.rect(metaBoxX, META_Y, metaBoxWidth, META_ROW_HEIGHT, "F");
  doc.setDrawColor(BORDER_COLOR, BORDER_COLOR, BORDER_COLOR);
  doc.setLineWidth(BORDER_LINE_WIDTH);
  doc.rect(metaBoxX, META_Y, metaBoxWidth, META_BOX_HEIGHT);
  doc.line(metaBoxX, META_Y + META_ROW_HEIGHT, metaBoxX + metaBoxWidth, META_Y + META_ROW_HEIGHT);
  doc.line(metaBoxX + estimateCellWidth, META_Y, metaBoxX + estimateCellWidth, META_Y + META_BOX_HEIGHT);
  doc.line(
    metaBoxX + estimateCellWidth + dateCellWidth,
    META_Y,
    metaBoxX + estimateCellWidth + dateCellWidth,
    META_Y + META_BOX_HEIGHT
  );

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.35);
  doc.text(estimateLabel, metaCenters[0], labelCenterY, { align: "center", baseline: "middle" });
  doc.text("DATE", metaCenters[1], labelCenterY, { align: "center", baseline: "middle" });
  doc.text("PO", metaCenters[2], labelCenterY, { align: "center", baseline: "middle" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.25);
  doc.text(estimateNumber, metaCenters[0], valueCenterY, { align: "center", baseline: "middle" });
  doc.text(date, metaCenters[1], valueCenterY, { align: "center", baseline: "middle" });
  doc.text(po, metaCenters[2], valueCenterY, { align: "center", baseline: "middle" });

  autoTable(doc, {
    startY: CLIENT_Y,
    head: [["BILL TO", "CUSTOMER", "PROJECT"]],
    body: [[billToText || "-", customerText || "-", projectText || "-"]],
    theme: "plain",
    tableLineWidth: 0,
    styles: {
      fontSize: 9.8,
      cellPadding: 1.45,
      minCellHeight: 4.2,
      overflow: "linebreak",
      lineWidth: 0,
      fillColor: [255, 255, 255],
      textColor: [20, 20, 20],
      valign: "top",
    },
    headStyles: {
      fontStyle: "bold",
      fillColor: HEADER_FILL,
      textColor: [20, 20, 20],
      lineWidth: 0,
    },
    columnStyles: {
      0: { cellWidth: 60 },
      1: { cellWidth: 60 },
      2: { cellWidth: 58 },
    },
    margin: { left: LEFT, right: RIGHT_GUTTER },
  });

  let y = (doc.lastAutoTable?.finalY || CLIENT_Y) + 9.6;

  if (payload?.docType === "estimate" && scopeNotesText) {
    const scopeSectionMinHeight = SECTION_HEADER_MIN_HEIGHT + estimatePreviewTextHeight(scopeNotesText, 8.95, 3.7) + 1.8;
    y = ensureSectionFits(y, scopeSectionMinHeight);

    autoTable(doc, {
      startY: y,
      head: [["SCOPE / NOTES"]],
      body: [[scopeNotesText]],
      theme: "plain",
      tableLineWidth: 0,
      styles: {
        fontSize: 8.95,
        cellPadding: 0.9,
        minCellHeight: 3.7,
        overflow: "linebreak",
        lineWidth: 0,
        fillColor: [255, 255, 255],
        textColor: [20, 20, 20],
        valign: "top",
      },
      headStyles: {
        fontStyle: "bold",
        fillColor: HEADER_FILL,
        textColor: [20, 20, 20],
        lineWidth: 0,
      },
      margin: { left: LEFT, right: RIGHT_GUTTER },
    });

    y = (doc.lastAutoTable?.finalY || y) + TEXT_SECTION_GAP;
  }

  if (tradeInsertText) {
    const tradeSectionMinHeight = SECTION_HEADER_MIN_HEIGHT + estimatePreviewTextHeight(tradeInsertText, 8.9, 3.45) + 1.8;
    y = ensureSectionFits(y, tradeSectionMinHeight);

    autoTable(doc, {
      startY: y,
      head: [["TRADE INSERTS"]],
      body: [[tradeInsertText]],
      theme: "plain",
      tableLineWidth: 0,
      styles: {
        fontSize: 8.9,
        cellPadding: 0.78,
        minCellHeight: 3.45,
        overflow: "linebreak",
        lineWidth: 0,
        fillColor: [255, 255, 255],
        textColor: [20, 20, 20],
        valign: "top",
      },
      headStyles: {
        fontStyle: "bold",
        fillColor: HEADER_FILL,
        textColor: [20, 20, 20],
        lineWidth: 0,
      },
      margin: { left: LEFT, right: RIGHT_GUTTER },
    });

    y = (doc.lastAutoTable?.finalY || y) + TEXT_SECTION_GAP;
  }

  y += MATERIAL_SECTION_GAP;
  y = doc.getNumberOfPages() === 1 ? Math.max(MATERIAL_HEADER_Y, y) : Math.max(SECTION_PAGE_TOP, y);
  y = ensureSectionFits(
    y,
    MATERIAL_TITLE_BAND_HEIGHT + MATERIAL_HEADER_GAP + 5.2 + estimateFirstMaterialRowHeight() + MATERIAL_KEEP_BUFFER,
    SECTION_PAGE_TOP
  );
  const materialsSectionStartPage = doc.getNumberOfPages();
  const materialsTitleY = y + 1.2;
  const materialsSectionTop = materialsTitleY - 3;
  const materialsSectionLeft = LEFT;
  const materialsSectionRight = Math.max(contentRightEdge, RIGHT);
  const materialsSectionWidth = materialsSectionRight - materialsSectionLeft;
  doc.setFillColor(...HEADER_FILL);
  doc.rect(materialsSectionLeft, materialsSectionTop, materialsSectionWidth, MATERIAL_TITLE_BAND_HEIGHT, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.4);
  doc.text("Material Schedule", LEFT + 3, materialsTitleY);
  y = materialsSectionTop + MATERIAL_TITLE_BAND_HEIGHT + MATERIAL_HEADER_GAP;
  const materialTableBody = normalizedMaterialRows.map((row) => ([
    { content: row.desc || "-", materialRow: row },
    row.qty,
    row.each,
    row.total,
  ]));

  autoTable(doc, {
    startY: y,
    head: [["", "QTY", "PRICE (each)", "TOTAL"]],
    body: materialTableBody,
    theme: "plain",
    tableLineWidth: 0,
    styles: {
      fontSize: MATERIAL_DESC_FONT_SIZE,
      cellPadding: 1.45,
      minCellHeight: 4.2,
      overflow: "linebreak",
      lineWidth: 0,
      textColor: [20, 20, 20],
      valign: "top",
    },
    headStyles: {
      fontStyle: "bold",
      textColor: [20, 20, 20],
      lineWidth: 0,
      cellPadding: { top: 0.7, right: 1.45, bottom: 1.15, left: 1.45 },
      minCellHeight: 4.3,
    },
    columnStyles: {
      0: { cellWidth: 84, halign: "left", overflow: "linebreak" },
      1: { cellWidth: 20, halign: "right" },
      2: { cellWidth: 33, halign: "right" },
      3: { cellWidth: 37, halign: "right" },
    },
    margin: { left: LEFT, right: RIGHT_GUTTER },
    didParseCell: (hookData) => {
      if (hookData.section === "head") {
        if (hookData.column.index < 1 || hookData.column.index > 3) return;
        hookData.cell.styles.halign = "right";
        return;
      }

      if (hookData.section !== "body") return;
      if (hookData.column.index !== 0) return;

      const materialRow = normalizeMaterialRow(hookData.cell.raw?.materialRow);
      if (!materialRow.note) return;

      const layout = getMaterialRowLayout(materialRow, hookData.cell.width, hookData.cell.styles.cellPadding);
      hookData.cell.text = [""];
      hookData.cell.styles.minCellHeight = Math.max(Number(hookData.cell.styles.minCellHeight || 0), layout.height);
      hookData.row.height = Math.max(Number(hookData.row.height || 0), layout.height);
    },
    didDrawCell: (hookData) => {
      if (hookData.section !== "body") return;
      if (hookData.column.index !== 0) return;

      const materialRow = normalizeMaterialRow(hookData.cell.raw?.materialRow);
      if (!materialRow.note) return;

      const layout = getMaterialRowLayout(materialRow, hookData.cell.width, hookData.cell.styles.cellPadding);
      const textX = hookData.cell.x + layout.paddingLeft;
      const textY = hookData.cell.y + layout.paddingTop;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(MATERIAL_DESC_FONT_SIZE);
      doc.setTextColor(20, 20, 20);
      doc.text(
        layout.descLines.length ? layout.descLines : [materialRow.desc || "-"],
        textX,
        textY,
        { baseline: "top", lineHeightFactor: MATERIAL_DESC_LINE_HEIGHT_FACTOR }
      );

      doc.setFont("helvetica", "italic");
      doc.setFontSize(MATERIAL_NOTE_FONT_SIZE);
      doc.setTextColor(106, 106, 106);
      doc.text(
        layout.noteLines,
        textX + MATERIAL_NOTE_INDENT,
        textY + (Math.max(layout.descLines.length, 1) * layout.descLineHeight) + MATERIAL_NOTE_GAP,
        { baseline: "top", lineHeightFactor: MATERIAL_NOTE_LINE_HEIGHT_FACTOR }
      );
      doc.setTextColor(20, 20, 20);
    },
  });

  y = (doc.lastAutoTable?.finalY || y);

  if (materialsBlanketDescription) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.25);
    const materialsDescriptionLines = splitText(doc, materialsBlanketDescription, 182);
    doc.text(materialsDescriptionLines, LEFT + 4, y);
    y += (materialsDescriptionLines.length || 1) * 3.6 + 0.05;
  }

  const materialsSectionEndPage = doc.getNumberOfPages();
  const materialsSectionBottom = y - 0.2;
  doc.setDrawColor(BORDER_COLOR, BORDER_COLOR, BORDER_COLOR);
  doc.setLineWidth(BORDER_LINE_WIDTH);

  if (materialsSectionStartPage === materialsSectionEndPage) {
    doc.rect(
      materialsSectionLeft,
      materialsSectionTop,
      materialsSectionWidth,
      materialsSectionBottom - materialsSectionTop
    );
  } else {
    for (let page = materialsSectionStartPage; page <= materialsSectionEndPage; page += 1) {
      doc.setPage(page);
      const top = page === materialsSectionStartPage ? materialsSectionTop : 4.5;
      const bottom = page === materialsSectionEndPage ? materialsSectionBottom : pageHeight - 19;
      doc.rect(
        materialsSectionLeft,
        top,
        materialsSectionWidth,
        Math.max(0, bottom - top)
      );
    }
    doc.setPage(materialsSectionEndPage);
  }

  const totalsStartY = ensureSectionFits(y, estimateTotalsBlockHeight(), SECTION_PAGE_TOP) + TOTALS_TOP_OFFSET;

  autoTable(doc, {
    startY: totalsStartY,
    body: safeSummaryRows,
    theme: "plain",
    tableLineWidth: 0,
    tableWidth: TOTALS_TABLE_WIDTH,
    pageBreak: "avoid",
    styles: {
      fontSize: 10,
      cellPadding: { top: 1.5, right: 1.25, bottom: 1.4, left: 1.25 },
      minCellHeight: TOTALS_ROW_HEIGHT,
      overflow: "linebreak",
      lineWidth: 0,
      fillColor: [255, 255, 255],
      textColor: [20, 20, 20],
      valign: "top",
    },
    columnStyles: {
      0: { cellWidth: 36, fontStyle: "normal" },
      1: { cellWidth: 26, halign: "right" },
    },
    margin: { left: TOTALS_X, right: TOTALS_RIGHT_GUTTER },
    didDrawCell: (hookData) => {
      if (hookData.section !== "body") return;
      if (hookData.row.index !== subtotalRowIndex) return;
      if (hookData.column.index !== 0) return;
      const rowY = hookData.cell.y;
      const rowHeight = hookData.row.height;
      doc.setDrawColor(182, 182, 182);
      doc.setLineWidth(0.2);
      doc.line(TOTALS_X, rowY, TOTALS_X + TOTALS_TABLE_WIDTH, rowY);
      doc.line(TOTALS_X, rowY + rowHeight, TOTALS_X + TOTALS_TABLE_WIDTH, rowY + rowHeight);
    },
    didParseCell: (hookData) => {
      if (hookData.section !== "body") return;
      if (hookData.row.index === subtotalRowIndex) {
        hookData.cell.styles.cellPadding = { top: 2.35, right: 1.25, bottom: 2.2, left: 1.25 };
        hookData.cell.styles.minCellHeight = Math.max(TOTALS_ROW_HEIGHT + 1.35, 7.3);
      }
      if (hookData.row.index !== grandTotalRowIndex) return;
      hookData.cell.styles.fontStyle = "bold";
      hookData.cell.styles.fillColor = GRAND_TOTAL_FILL;
      hookData.cell.styles.cellPadding = { top: 3.35, right: 1.25, bottom: 1.4, left: 1.25 };
      hookData.cell.styles.minCellHeight = TOTALS_GRAND_TOTAL_ROW_HEIGHT;
    },
  });

  const totalsFinalY = Number(doc.lastAutoTable?.finalY || 0);
  const totalsFinalPage = doc.getNumberOfPages();
  let invoiceCompanionPage = totalsFinalPage;
  let invoiceCompanionBottomY = totalsFinalY;

  if (payload?.docType === "estimate" && additionalNotesText) {
    const footerLimitY = (footerLine ? footerStartY : FOOTER_Y) - ESTIMATE_NOTES_FOOTER_GAP;
    const estimateNotesBoxWidth = Math.max(contentRightEdge - LEFT + 2, RIGHT - LEFT + 2);
    const notesTextWidth = estimateNotesBoxWidth - (ESTIMATE_NOTES_BOX_PADDING_X * 2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(ESTIMATE_NOTES_BODY_FONT_SIZE);
    const estimateNotesLines = splitText(doc, additionalNotesText, notesTextWidth);
    const estimateNotesLineCount = Math.max(estimateNotesLines.length, 1);
    const estimateNotesLineHeight = (doc.getFontSize() * ESTIMATE_NOTES_LINE_HEIGHT_FACTOR) / doc.internal.scaleFactor;
    const estimateNotesTextHeight = estimateNotesLineCount * estimateNotesLineHeight;
    const notesHeaderLineY = ESTIMATE_NOTES_HEADER_BAND_HEIGHT;
    const notesTextStartY = ESTIMATE_NOTES_HEADER_BAND_HEIGHT + ESTIMATE_NOTES_BODY_TOP_GAP + 0.95;
    const estimateNotesBoxHeight = ESTIMATE_NOTES_HEADER_BAND_HEIGHT + ESTIMATE_NOTES_BODY_TOP_GAP + estimateNotesTextHeight + ESTIMATE_NOTES_BOX_BOTTOM_PADDING;
    let estimateNotesBoxY = totalsFinalY + ESTIMATE_NOTES_BOX_GAP;
    let targetPage = totalsFinalPage;

    if (estimateNotesBoxY < ESTIMATE_NOTES_PAGE_TOP) {
      estimateNotesBoxY = ESTIMATE_NOTES_PAGE_TOP;
    }

    if (estimateNotesBoxY + estimateNotesBoxHeight > footerLimitY) {
      doc.addPage();
      targetPage = doc.getNumberOfPages();
      estimateNotesBoxY = ESTIMATE_NOTES_PAGE_TOP;
    }

    doc.setPage(targetPage);
    doc.setDrawColor(BORDER_COLOR, BORDER_COLOR, BORDER_COLOR);
    doc.setLineWidth(BORDER_LINE_WIDTH);
    doc.rect(ESTIMATE_NOTES_BOX_LEFT, estimateNotesBoxY, estimateNotesBoxWidth, estimateNotesBoxHeight);
    doc.line(
      ESTIMATE_NOTES_BOX_LEFT,
      estimateNotesBoxY + notesHeaderLineY,
      ESTIMATE_NOTES_BOX_LEFT + estimateNotesBoxWidth,
      estimateNotesBoxY + notesHeaderLineY
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(ESTIMATE_NOTES_HEADER_FONT_SIZE);
    doc.text(ESTIMATE_NOTES_HEADER_TEXT, ESTIMATE_NOTES_BOX_LEFT + ESTIMATE_NOTES_BOX_PADDING_X, estimateNotesBoxY + ESTIMATE_NOTES_BOX_TOP_PADDING + 2.0);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(ESTIMATE_NOTES_BODY_FONT_SIZE);
    doc.text(
      estimateNotesLines.length ? estimateNotesLines : [additionalNotesText],
      ESTIMATE_NOTES_BOX_LEFT + ESTIMATE_NOTES_BOX_PADDING_X,
      estimateNotesBoxY + notesTextStartY,
      { lineHeightFactor: ESTIMATE_NOTES_LINE_HEIGHT_FACTOR }
    );
  }

  if (payload?.docType === "invoice" && invoicePaymentTermsText) {
    const footerLimitY = (footerLine ? footerStartY : FOOTER_Y) - TERMS_BOX_FOOTER_GAP;
    const paymentTermsTextWidth = TERMS_BOX_WIDTH - (TERMS_BOX_PADDING_X * 2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(TERMS_BODY_FONT_SIZE);
    const paymentTermsLines = splitText(doc, invoicePaymentTermsText, paymentTermsTextWidth);
    const paymentTermsLineCount = Math.max(paymentTermsLines.length, 1);
    const paymentTermsLineHeight = (doc.getFontSize() * TERMS_LINE_HEIGHT_FACTOR) / doc.internal.scaleFactor;
    const paymentTermsTextHeight = paymentTermsLineCount * paymentTermsLineHeight;
    const termsHeaderLineY = TERMS_BOX_HEADER_BAND_HEIGHT;
    const termsTextStartY = TERMS_BOX_HEADER_BAND_HEIGHT + TERMS_BOX_BODY_TOP_GAP + 2.45;
    const termsBoxHeight = TERMS_BOX_HEADER_BAND_HEIGHT + TERMS_BOX_BODY_TOP_GAP + paymentTermsTextHeight + TERMS_BOX_BOTTOM_PADDING;
    let paymentTermsBoxY = totalsFinalY + TERMS_BOX_MIN_GAP;
    let targetPage = totalsFinalPage;

    if (paymentTermsBoxY < TERMS_BOX_PAGE_TOP) {
      paymentTermsBoxY = TERMS_BOX_PAGE_TOP;
    }

    if (paymentTermsBoxY + termsBoxHeight > footerLimitY) {
      doc.addPage();
      targetPage = doc.getNumberOfPages();
      paymentTermsBoxY = TERMS_BOX_PAGE_TOP;
    }

    doc.setPage(targetPage);
    doc.setDrawColor(BORDER_COLOR, BORDER_COLOR, BORDER_COLOR);
    doc.setLineWidth(BORDER_LINE_WIDTH);
    doc.rect(TERMS_BOX_LEFT, paymentTermsBoxY, TERMS_BOX_WIDTH, termsBoxHeight);
    doc.line(
      TERMS_BOX_LEFT,
      paymentTermsBoxY + termsHeaderLineY,
      TERMS_BOX_LEFT + TERMS_BOX_WIDTH,
      paymentTermsBoxY + termsHeaderLineY
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(TERMS_HEADER_FONT_SIZE);
    doc.text(TERMS_HEADER_TEXT, TERMS_BOX_LEFT + TERMS_BOX_PADDING_X, paymentTermsBoxY + TERMS_BOX_TOP_PADDING + 2.0);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(TERMS_BODY_FONT_SIZE);
    doc.text(
      paymentTermsLines.length ? paymentTermsLines : [invoicePaymentTermsText],
      TERMS_BOX_LEFT + TERMS_BOX_PADDING_X,
      paymentTermsBoxY + termsTextStartY,
      { lineHeightFactor: TERMS_LINE_HEIGHT_FACTOR }
    );

    invoiceCompanionPage = targetPage;
    invoiceCompanionBottomY = paymentTermsBoxY + termsBoxHeight;
  }

  if (payload?.docType === "invoice" && additionalNotesText) {
    const footerLimitY = (footerLine ? footerStartY : FOOTER_Y) - TERMS_BOX_FOOTER_GAP;
    const invoiceNotesTextWidth = TERMS_BOX_WIDTH - (TERMS_BOX_PADDING_X * 2);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(TERMS_BODY_FONT_SIZE);
    const invoiceNotesLines = splitText(doc, additionalNotesText, invoiceNotesTextWidth);
    const invoiceNotesLineCount = Math.max(invoiceNotesLines.length, 1);
    const invoiceNotesLineHeight = (doc.getFontSize() * TERMS_LINE_HEIGHT_FACTOR) / doc.internal.scaleFactor;
    const invoiceNotesTextHeight = invoiceNotesLineCount * invoiceNotesLineHeight;
    const invoiceNotesHeaderLineY = TERMS_BOX_HEADER_BAND_HEIGHT;
    const invoiceNotesTextStartY = TERMS_BOX_HEADER_BAND_HEIGHT + TERMS_BOX_BODY_TOP_GAP + 2.45;
    const invoiceNotesBoxHeight = TERMS_BOX_HEADER_BAND_HEIGHT + TERMS_BOX_BODY_TOP_GAP + invoiceNotesTextHeight + TERMS_BOX_BOTTOM_PADDING;
    let invoiceNotesBoxY = invoicePaymentTermsText
      ? invoiceCompanionBottomY + INVOICE_NOTES_BOX_GAP
      : totalsFinalY + TERMS_BOX_MIN_GAP;
    let targetPage = invoicePaymentTermsText ? invoiceCompanionPage : totalsFinalPage;

    if (invoiceNotesBoxY < TERMS_BOX_PAGE_TOP) {
      invoiceNotesBoxY = TERMS_BOX_PAGE_TOP;
    }

    if (invoiceNotesBoxY + invoiceNotesBoxHeight > footerLimitY) {
      doc.addPage();
      targetPage = doc.getNumberOfPages();
      invoiceNotesBoxY = TERMS_BOX_PAGE_TOP;
    }

    doc.setPage(targetPage);
    doc.setDrawColor(BORDER_COLOR, BORDER_COLOR, BORDER_COLOR);
    doc.setLineWidth(BORDER_LINE_WIDTH);
    doc.rect(TERMS_BOX_LEFT, invoiceNotesBoxY, TERMS_BOX_WIDTH, invoiceNotesBoxHeight);
    doc.line(
      TERMS_BOX_LEFT,
      invoiceNotesBoxY + invoiceNotesHeaderLineY,
      TERMS_BOX_LEFT + TERMS_BOX_WIDTH,
      invoiceNotesBoxY + invoiceNotesHeaderLineY
    );

    doc.setFont("helvetica", "bold");
    doc.setFontSize(TERMS_HEADER_FONT_SIZE);
    doc.text(INVOICE_NOTES_HEADER_TEXT, TERMS_BOX_LEFT + TERMS_BOX_PADDING_X, invoiceNotesBoxY + TERMS_BOX_TOP_PADDING + 2.0);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(TERMS_BODY_FONT_SIZE);
    doc.text(
      invoiceNotesLines.length ? invoiceNotesLines : [additionalNotesText],
      TERMS_BOX_LEFT + TERMS_BOX_PADDING_X,
      invoiceNotesBoxY + invoiceNotesTextStartY,
      { lineHeightFactor: TERMS_LINE_HEIGHT_FACTOR }
    );
  }

  const pageCount = doc.getNumberOfPages();

  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(PAGE_NUMBER_FONT_SIZE);
    doc.setTextColor(PAGE_NUMBER_TEXT_COLOR);
    doc.text(`Page ${page} of ${pageCount}`, RIGHT, PAGE_NUMBER_Y, { align: "right" });
  }

  if (footerLine) {
    const lastPage = pageCount;
    doc.setPage(lastPage);
    doc.setDrawColor(198, 198, 198);
    doc.setLineWidth(0.25);
    doc.line(LEFT + FOOTER_DIVIDER_SIDE_INSET, footerDividerY, RIGHT - FOOTER_DIVIDER_SIDE_INSET, footerDividerY);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(FOOTER_PRIMARY_FONT_SIZE);
    doc.setTextColor(28, 28, 28);
    doc.text(footerCompanyName || footerLine, CENTER, footerPrimaryY, { align: "center" });

    if (footerDetails) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(FOOTER_SECONDARY_FONT_SIZE);
      doc.setTextColor(92, 92, 92);
      doc.text(footerSecondaryLines.length ? footerSecondaryLines : [footerDetails], CENTER, footerSecondaryY, {
        align: "center",
        lineHeightFactor: FOOTER_SECONDARY_LINE_HEIGHT,
      });
    }
  }

  doc.setTextColor(20, 20, 20);

  return doc;
}

export async function exportPdf(payload, mode = "download") {
  const normalizedMode = mode === "view" || mode === "share" ? mode : "download";
  const doc = buildPdfDoc(payload || {});
  const filename = asText(payload?.filename, `Estimate-${asText(payload?.documentNumber, "Draft")}.pdf`);

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
