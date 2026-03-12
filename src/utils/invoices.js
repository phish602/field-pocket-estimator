// @ts-nocheck
/* eslint-disable */

import { DEFAULT_STATE } from "../estimator/defaultState";
import { computeTotals } from "../estimator/engine";
import { STORAGE_KEYS } from "../constants/storageKeys";

export const INVOICE_TYPES = {
  DEPOSIT: "deposit",
  PROGRESS: "progress",
  FINAL: "final",
  CUSTOM: "custom",
  MANUAL: "manual",
};

export const INVOICE_STATUSES = {
  DRAFT: "draft",
  SENT: "sent",
  PAID: "paid",
  OVERDUE: "overdue",
  VOID: "void",
};

export const PAYMENT_STATUSES = {
  UNPAID: "unpaid",
  PARTIAL: "partial",
  PAID: "paid",
  VOID: "void",
};

const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const EPSILON = 0.005;

function deepClone(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    if (Array.isArray(value)) return value.map((entry) => deepClone(entry));
    if (value && typeof value === "object") {
      const next = {};
      Object.keys(value).forEach((key) => {
        next[key] = deepClone(value[key]);
      });
      return next;
    }
    return value;
  }
}

function asText(value) {
  return String(value || "").trim();
}

export function toCurrencyNumber(value) {
  const next = typeof value === "number"
    ? value
    : parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(next) ? next : 0;
}

export function roundCurrency(value) {
  return Math.round(toCurrencyNumber(value) * 100) / 100;
}

function todayParts(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function todayISO() {
  return todayParts(new Date());
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
}

function resolveMaterialsMode(doc) {
  const explicit = asText(doc?.ui?.materialsMode || doc?.materialsMode).toLowerCase();
  if (explicit === "itemized" || explicit === "blanket") return explicit;
  if (Array.isArray(doc?.materials?.items) && doc.materials.items.length > 0) return "itemized";
  if (Array.isArray(doc?.materialItems) && doc.materialItems.length > 0) return "itemized";
  return "blanket";
}

function toEstimatorState(doc) {
  const laborLines = Array.isArray(doc?.labor?.lines)
    ? doc.labor.lines
    : (Array.isArray(doc?.laborLines) ? doc.laborLines : []);
  const materialItems = Array.isArray(doc?.materials?.items)
    ? doc.materials.items
    : (Array.isArray(doc?.materialItems) ? doc.materialItems : []);
  const multiplierMode = asText(doc?.multiplierMode).toLowerCase();
  const customMultiplier = toCurrencyNumber(doc?.customMultiplier);
  const presetMultiplier = toCurrencyNumber(doc?.laborMultiplier);
  const directMultiplier = toCurrencyNumber(doc?.labor?.multiplier);
  const multiplier = directMultiplier > 0
    ? directMultiplier
    : (multiplierMode === "custom" ? (customMultiplier || 1) : (presetMultiplier || 1));

  return {
    ui: {
      materialsMode: resolveMaterialsMode(doc),
    },
    labor: {
      hazardPct: toCurrencyNumber(doc?.labor?.hazardPct ?? doc?.hazardPct),
      riskPct: toCurrencyNumber(doc?.labor?.riskPct ?? doc?.riskPct),
      multiplier: multiplier > 0 ? multiplier : 1,
      lines: laborLines.map((line, index) => ({
        id: asText(line?.id) || `labor_${index}`,
        role: asText(line?.role),
        label: asText(line?.label || line?.name),
        qty: Math.max(1, toCurrencyNumber(line?.qty || 1)),
        hours: Math.max(0, toCurrencyNumber(line?.hours)),
        rate: Math.max(0, toCurrencyNumber(line?.rate ?? line?.billRate)),
        markupPct: toCurrencyNumber(line?.markupPct),
        trueRateInternal: Math.max(
          0,
          toCurrencyNumber(line?.trueRateInternal ?? line?.internalRate ?? line?.rateInternal)
        ),
      })),
    },
    materials: {
      blanketCost: Math.max(0, toCurrencyNumber(doc?.materials?.blanketCost ?? doc?.blanketCost ?? doc?.materialsCost)),
      blanketInternalCost: Math.max(
        0,
        toCurrencyNumber(doc?.materials?.blanketInternalCost ?? doc?.blanketInternalCost ?? doc?.materialsCost)
      ),
      markupPct: toCurrencyNumber(doc?.materials?.markupPct ?? doc?.materialsMarkupPct),
      items: materialItems.map((item, index) => ({
        id: asText(item?.id) || `mat_${index}`,
        desc: asText(item?.desc || item?.name),
        qty: Math.max(1, toCurrencyNumber(item?.qty || 1)),
        priceEach: Math.max(
          0,
          toCurrencyNumber(item?.priceEach ?? item?.chargeEach ?? item?.charge ?? item?.price ?? item?.unitPrice)
        ),
        markupPct: toCurrencyNumber(item?.markupPct),
        unitCostInternal: Math.max(
          0,
          toCurrencyNumber(
            item?.unitCostInternal
            ?? item?.costInternal
            ?? item?.internalCost
            ?? item?.internalEach
            ?? item?.internalPrice
            ?? item?.cost
          )
        ),
      })),
    },
  };
}

function buildFinancialSummary({
  approvedTotal = null,
  totalRevenue = 0,
  totalCost = 0,
  laborRevenue = 0,
  laborCost = 0,
  materialsRevenue = 0,
  materialsCost = 0,
}) {
  const revenue = roundCurrency(totalRevenue);
  const cost = roundCurrency(totalCost);
  const grossProfit = roundCurrency(revenue - cost);
  const marginRatio = revenue > 0 ? roundCurrency(grossProfit / revenue) : 0;
  const marginPercent = roundCurrency(marginRatio * 100);
  const approved = approvedTotal === null || approvedTotal === undefined || approvedTotal === ""
    ? revenue
    : roundCurrency(approvedTotal);
  const normalizedLaborRevenue = roundCurrency(laborRevenue);
  const normalizedLaborCost = roundCurrency(laborCost);
  const normalizedMaterialsRevenue = roundCurrency(materialsRevenue);
  const normalizedMaterialsCost = roundCurrency(materialsCost);

  return {
    approvedTotal: approved,
    totalRevenue: revenue,
    grandTotal: revenue,
    total: revenue,
    totalCost: cost,
    internalCost: cost,
    grossProfit,
    grossMargin: marginRatio,
    grossMarginPct: marginRatio,
    grossProfitMargin: marginRatio,
    margin: marginRatio,
    marginPct: marginPercent,
    marginPercent,
    laborRevenue: normalizedLaborRevenue,
    laborCost: normalizedLaborCost,
    materialsRevenue: normalizedMaterialsRevenue,
    materialsCost: normalizedMaterialsCost,
    financials: {
      approvedTotal: approved,
      totalRevenue: revenue,
      grandTotal: revenue,
      totalCost: cost,
      internalCost: cost,
      grossProfit,
      grossMargin: marginRatio,
      grossMarginPct: marginRatio,
      grossProfitMargin: marginRatio,
      margin: marginRatio,
      marginPct: marginPercent,
      marginPercent,
      laborRevenue: normalizedLaborRevenue,
      laborCost: normalizedLaborCost,
      materialsRevenue: normalizedMaterialsRevenue,
      materialsCost: normalizedMaterialsCost,
    },
    totals: {
      approvedTotal: approved,
      totalRevenue: revenue,
      grandTotal: revenue,
      totalCost: cost,
      internalCost: cost,
      grossProfit,
      grossMargin: marginRatio,
      grossMarginPct: marginRatio,
      grossProfitMargin: marginRatio,
      margin: marginRatio,
      marginPct: marginPercent,
      marginPercent,
      laborRevenue: normalizedLaborRevenue,
      laborCost: normalizedLaborCost,
      materialsRevenue: normalizedMaterialsRevenue,
      materialsCost: normalizedMaterialsCost,
    },
  };
}

export function buildFinancialSummaryFromComputed(computed, approvedTotal = null) {
  const laborRevenue = roundCurrency(
    computed?.labor?.totalRevenue
    ?? computed?.laborAfterAdjustments
    ?? computed?.laborAfterMultiplier
    ?? computed?.labor?.subtotal
    ?? 0
  );
  const laborCost = roundCurrency(
    computed?.labor?.totalCost
    ?? computed?.labor?.internalCost
    ?? computed?.labor?.cost
    ?? 0
  );
  const materialsRevenue = roundCurrency(
    computed?.materials?.totalRevenue
    ?? computed?.materials?.totalCharge
    ?? 0
  );
  const materialsCost = roundCurrency(
    computed?.materials?.totalCost
    ?? computed?.materials?.internalCost
    ?? 0
  );
  const totalRevenue = roundCurrency(
    computed?.totalRevenue
    ?? computed?.grandTotal
    ?? (laborRevenue + materialsRevenue)
  );
  const totalCost = roundCurrency(
    computed?.totalCost
    ?? (laborCost + materialsCost)
  );

  return buildFinancialSummary({
    approvedTotal,
    totalRevenue,
    totalCost,
    laborRevenue,
    laborCost,
    materialsRevenue,
    materialsCost,
  });
}

export function allocateFinancialSummaryFromSource(source, invoiceTotal, approvedTotalOverride = null) {
  const normalizedInvoiceTotal = roundCurrency(invoiceTotal);
  const base = extractFinancialSummaryFromDoc(source, { approvedTotal: approvedTotalOverride });
  const approvedTotal = roundCurrency(
    approvedTotalOverride
    ?? base?.approvedTotal
    ?? base?.totalRevenue
    ?? normalizedInvoiceTotal
  );
  const ratioBase = approvedTotal > 0 ? approvedTotal : roundCurrency(base?.totalRevenue);
  const ratio = ratioBase > 0 ? normalizedInvoiceTotal / ratioBase : 0;

  return buildFinancialSummary({
    approvedTotal,
    totalRevenue: normalizedInvoiceTotal,
    totalCost: roundCurrency((base?.totalCost || 0) * ratio),
    laborRevenue: roundCurrency((base?.laborRevenue || 0) * ratio),
    laborCost: roundCurrency((base?.laborCost || 0) * ratio),
    materialsRevenue: roundCurrency((base?.materialsRevenue || 0) * ratio),
    materialsCost: roundCurrency((base?.materialsCost || 0) * ratio),
  });
}

export function extractFinancialSummaryFromDoc(doc, options = {}) {
  const source = doc && typeof doc === "object" ? doc : {};
  const explicitApprovedTotal = firstFiniteNumber(
    options?.approvedTotal,
    source?.approvedTotal,
    source?.financials?.approvedTotal,
    source?.totals?.approvedTotal,
    source?.sourceEstimateSnapshot?.approvedTotal
  );
  const directRevenue = firstFiniteNumber(
    source?.financials?.totalRevenue,
    source?.totals?.totalRevenue,
    source?.totalRevenue,
    source?.grandTotal,
    source?.invoiceTotal,
    source?.total
  );
  const directCost = firstFiniteNumber(
    source?.financials?.totalCost,
    source?.totals?.totalCost,
    source?.totalCost,
    source?.internalCost
  );
  const directGrossProfit = firstFiniteNumber(
    source?.financials?.grossProfit,
    source?.totals?.grossProfit,
    source?.grossProfit
  );
  const directLaborRevenue = firstFiniteNumber(
    source?.financials?.laborRevenue,
    source?.totals?.laborRevenue,
    source?.laborRevenue
  );
  const directLaborCost = firstFiniteNumber(
    source?.financials?.laborCost,
    source?.totals?.laborCost,
    source?.laborCost
  );
  const directMaterialsRevenue = firstFiniteNumber(
    source?.financials?.materialsRevenue,
    source?.totals?.materialsRevenue,
    source?.materialsRevenue
  );
  const directMaterialsCost = firstFiniteNumber(
    source?.financials?.materialsCost,
    source?.totals?.materialsCost,
    source?.materialsCost
  );
  const snapshot = source?.sourceEstimateSnapshot && typeof source.sourceEstimateSnapshot === "object"
    ? source.sourceEstimateSnapshot
    : null;

  if (asText(source?.sourceEstimateId) && snapshot && directCost === null && directRevenue !== null) {
    return allocateFinancialSummaryFromSource(
      snapshot,
      directRevenue,
      explicitApprovedTotal ?? snapshot?.approvedTotal
    );
  }

  if (directRevenue !== null || directCost !== null || directGrossProfit !== null) {
    const revenue = roundCurrency(directRevenue ?? 0);
    let cost = directCost;
    let grossProfit = directGrossProfit;
    if (cost === null && grossProfit !== null) cost = roundCurrency(revenue - grossProfit);
    if (grossProfit === null && cost !== null) grossProfit = roundCurrency(revenue - cost);
    return buildFinancialSummary({
      approvedTotal: explicitApprovedTotal,
      totalRevenue: revenue,
      totalCost: cost ?? 0,
      laborRevenue: directLaborRevenue ?? 0,
      laborCost: directLaborCost ?? 0,
      materialsRevenue: directMaterialsRevenue ?? 0,
      materialsCost: directMaterialsCost ?? 0,
    });
  }

  try {
    const computed = computeTotals(toEstimatorState(source));
    return buildFinancialSummaryFromComputed(computed, explicitApprovedTotal);
  } catch {
    return buildFinancialSummary({
      approvedTotal: explicitApprovedTotal,
      totalRevenue: roundCurrency(directRevenue ?? 0),
      totalCost: roundCurrency(directCost ?? 0),
      laborRevenue: roundCurrency(directLaborRevenue ?? 0),
      laborCost: roundCurrency(directLaborCost ?? 0),
      materialsRevenue: roundCurrency(directMaterialsRevenue ?? 0),
      materialsCost: roundCurrency(directMaterialsCost ?? 0),
    });
  }
}

function normalizeIsoDate(value, fallback = "") {
  const raw = asText(value);
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return todayParts(parsed);
}

export function createInvoiceId() {
  return `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createPaymentId() {
  return `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeInvoiceType(value) {
  const raw = asText(value).toLowerCase();
  if (raw === INVOICE_TYPES.DEPOSIT) return INVOICE_TYPES.DEPOSIT;
  if (raw === INVOICE_TYPES.PROGRESS) return INVOICE_TYPES.PROGRESS;
  if (raw === INVOICE_TYPES.FINAL) return INVOICE_TYPES.FINAL;
  if (raw === INVOICE_TYPES.CUSTOM) return INVOICE_TYPES.CUSTOM;
  return INVOICE_TYPES.MANUAL;
}

export function normalizeStoredInvoiceStatus(value) {
  const raw = asText(value).toLowerCase();
  if (raw === INVOICE_STATUSES.VOID) return INVOICE_STATUSES.VOID;
  if (raw === INVOICE_STATUSES.PAID) return INVOICE_STATUSES.PAID;
  if (raw === INVOICE_STATUSES.OVERDUE) return INVOICE_STATUSES.OVERDUE;
  if (raw === INVOICE_STATUSES.SENT) return INVOICE_STATUSES.SENT;
  return INVOICE_STATUSES.DRAFT;
}

function normalizePaymentStatus(value) {
  const raw = asText(value).toLowerCase();
  if (raw === PAYMENT_STATUSES.VOID) return PAYMENT_STATUSES.VOID;
  if (raw === PAYMENT_STATUSES.PAID) return PAYMENT_STATUSES.PAID;
  if (raw === PAYMENT_STATUSES.PARTIAL) return PAYMENT_STATUSES.PARTIAL;
  return PAYMENT_STATUSES.UNPAID;
}

function normalizePayments(payments) {
  const arr = Array.isArray(payments) ? payments.filter(Boolean) : [];
  return arr.map((payment, index) => ({
    id: asText(payment?.id) || createPaymentId(),
    amount: roundCurrency(payment?.amount),
    paidAt: normalizeIsoDate(payment?.paidAt || payment?.date, todayISO()),
    note: asText(payment?.note),
    method: asText(payment?.method) || "manual",
    order: Number.isFinite(Number(payment?.order)) ? Number(payment.order) : index,
  }));
}

function invoiceDateLabel(value, fallback = "") {
  return normalizeIsoDate(value, fallback);
}

export function sortInvoicesByDateDesc(a, b) {
  const bTs = Number(b?.updatedAt || b?.savedAt || b?.createdAt || 0) || 0;
  const aTs = Number(a?.updatedAt || a?.savedAt || a?.createdAt || 0) || 0;
  if (bTs !== aTs) return bTs - aTs;
  return asText(b?.invoiceNumber).localeCompare(asText(a?.invoiceNumber));
}

function dedupeInvoices(records) {
  const seen = new Set();
  return records.filter((invoice) => {
    const key = asText(invoice?.invoiceNumber || invoice?.id);
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function generateNextInvoiceNumber(invoices) {
  const arr = Array.isArray(invoices) ? invoices.filter(Boolean) : [];
  let max = 0;
  arr.forEach((invoice) => {
    const raw = asText(invoice?.invoiceNumber);
    if (!raw) return;
    const match = raw.match(/(\d+)(?!.*\d)/);
    if (!match) return;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > max) {
      max = parsed;
    }
  });
  return `INV-${String(max + 1).padStart(4, "0")}`;
}

export function readStoredInvoices() {
  try {
    const raw = localStorage.getItem(INVOICES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    let merged = Array.isArray(parsed) ? parsed : [];

    try {
      const legacyRaw = localStorage.getItem(STORAGE_KEYS.ESTIMATES);
      const legacyParsed = legacyRaw ? JSON.parse(legacyRaw) : [];
      const legacyInvoices = Array.isArray(legacyParsed)
        ? legacyParsed.filter((entry) => asText(entry?.docType).toLowerCase() === "invoice")
        : [];
      if (legacyInvoices.length > 0) {
        merged = [...merged, ...legacyInvoices];
      }
    } catch {}

    return normalizeInvoiceList(merged);
  } catch {
    return [];
  }
}

export function writeStoredInvoices(invoices) {
  const next = normalizeInvoiceList(invoices);
  localStorage.setItem(INVOICES_KEY, JSON.stringify(next));
  return next;
}

export function buildEstimateInvoiceSnapshot(estimate) {
  const source = estimate && typeof estimate === "object" ? estimate : {};
  const financialSummary = extractFinancialSummaryFromDoc(source, {
    approvedTotal: source?.approvedTotal ?? source?.total,
  });
  return {
    estimateId: asText(source?.id),
    estimateNumber: asText(source?.estimateNumber || source?.job?.docNumber),
    approvedTotal: financialSummary.approvedTotal,
    totalRevenue: financialSummary.totalRevenue,
    grandTotal: financialSummary.grandTotal,
    total: financialSummary.total,
    totalCost: financialSummary.totalCost,
    internalCost: financialSummary.internalCost,
    grossProfit: financialSummary.grossProfit,
    grossMargin: financialSummary.grossMargin,
    grossMarginPct: financialSummary.grossMarginPct,
    grossProfitMargin: financialSummary.grossProfitMargin,
    margin: financialSummary.margin,
    marginPct: financialSummary.marginPct,
    marginPercent: financialSummary.marginPercent,
    laborRevenue: financialSummary.laborRevenue,
    laborCost: financialSummary.laborCost,
    materialsRevenue: financialSummary.materialsRevenue,
    materialsCost: financialSummary.materialsCost,
    estimateStatus: asText(source?.status || "approved"),
    customerId: asText(source?.customerId || source?.customer?.id),
    customerName: asText(source?.customerName || source?.customer?.name),
    projectName: asText(source?.projectName || source?.customer?.projectName),
    projectNumber: asText(source?.projectNumber || source?.customer?.projectNumber),
    poNumber: asText(source?.poNumber || source?.job?.poNumber),
    estimateDate: invoiceDateLabel(source?.date || source?.job?.date),
    dueDate: invoiceDateLabel(source?.dueDate || source?.job?.due),
    customer: deepClone(source?.customer || {}),
    job: deepClone(source?.job || {}),
    financials: {
      ...(source?.financials || {}),
      ...(financialSummary?.financials || {}),
    },
    totals: {
      ...(source?.totals || {}),
      ...(financialSummary?.totals || {}),
    },
    summary: {
      total: financialSummary.totalRevenue,
      totalCost: financialSummary.totalCost,
      grossProfit: financialSummary.grossProfit,
      savedAt: Number(source?.savedAt || 0) || 0,
      updatedAt: Number(source?.updatedAt || 0) || 0,
    },
  };
}

export function normalizeInvoiceRecord(record) {
  const source = record && typeof record === "object" ? deepClone(record) : {};
  const snapshot = source?.sourceEstimateSnapshot && typeof source.sourceEstimateSnapshot === "object"
    ? deepClone(source.sourceEstimateSnapshot)
    : null;
  const invoiceNumber = asText(source?.invoiceNumber || source?.job?.docNumber || source?.docNumber);
  const estimateNumber = asText(source?.estimateNumber || snapshot?.estimateNumber);
  const sourceEstimateId = asText(source?.sourceEstimateId || snapshot?.estimateId);
  const invoiceDate = invoiceDateLabel(source?.date || source?.job?.date, todayISO());
  const dueDate = invoiceDateLabel(source?.dueDate || source?.job?.due);
  const payments = normalizePayments(source?.payments);
  let invoiceTotal = roundCurrency(source?.invoiceTotal ?? source?.total);
  let amountPaid = roundCurrency(source?.amountPaid);
  const paidFromLedger = roundCurrency(
    payments.reduce((sum, payment) => sum + roundCurrency(payment?.amount), 0)
  );
  if (paidFromLedger > 0) amountPaid = paidFromLedger;

  let status = normalizeStoredInvoiceStatus(source?.status);
  if (status === INVOICE_STATUSES.PAID) amountPaid = invoiceTotal;
  if (status === INVOICE_STATUSES.VOID) amountPaid = 0;
  if (invoiceTotal > 0 && amountPaid > invoiceTotal) amountPaid = invoiceTotal;
  if (invoiceTotal <= 0) amountPaid = 0;

  let paymentStatus = normalizePaymentStatus(source?.paymentStatus);
  if (status === INVOICE_STATUSES.VOID) paymentStatus = PAYMENT_STATUSES.VOID;
  else if (invoiceTotal > 0 && amountPaid >= invoiceTotal - EPSILON) paymentStatus = PAYMENT_STATUSES.PAID;
  else if (amountPaid > 0) paymentStatus = PAYMENT_STATUSES.PARTIAL;
  else paymentStatus = PAYMENT_STATUSES.UNPAID;

  const balanceRemaining = status === INVOICE_STATUSES.VOID
    ? 0
    : roundCurrency(Math.max(invoiceTotal - amountPaid, 0));

  const customerName = asText(source?.customerName || source?.customer?.name || snapshot?.customerName);
  const customerId = asText(source?.customerId || source?.customer?.id || snapshot?.customerId);
  const projectName = asText(source?.projectName || source?.customer?.projectName || snapshot?.projectName);
  const projectNumber = asText(source?.projectNumber || source?.customer?.projectNumber || snapshot?.projectNumber);
  const invoiceType = normalizeInvoiceType(
    source?.invoiceType || (sourceEstimateId ? INVOICE_TYPES.CUSTOM : INVOICE_TYPES.MANUAL)
  );
  const createdAt = Number(source?.createdAt || source?.savedAt || Date.now()) || Date.now();
  const updatedAt = Number(source?.updatedAt || source?.savedAt || createdAt) || createdAt;
  const normalizedSnapshot = sourceEstimateId
    ? {
        ...(snapshot || {}),
        ...buildEstimateInvoiceSnapshot(snapshot || {}),
      }
    : null;
  const financialSummary = extractFinancialSummaryFromDoc(source, {
    approvedTotal: normalizedSnapshot?.approvedTotal ?? source?.approvedTotal ?? invoiceTotal,
  });

  return {
    ...source,
    ...financialSummary,
    id: asText(source?.id) || createInvoiceId(),
    docType: "invoice",
    ui: {
      ...(source?.ui || {}),
      docType: "invoice",
    },
    invoiceType,
    invoiceNumber,
    estimateNumber,
    status,
    invoiceTotal,
    total: invoiceTotal,
    amountPaid,
    balanceRemaining,
    paymentStatus,
    payments,
    customerId,
    customerName,
    projectName,
    projectNumber,
    sourceEstimateId,
    sourceEstimateSnapshot: normalizedSnapshot,
    date: invoiceDate,
    dueDate,
    job: {
      ...(source?.job || {}),
      date: invoiceDate,
      due: dueDate,
      docNumber: invoiceNumber,
    },
    customer: {
      ...(source?.customer || {}),
      id: customerId,
      name: customerName,
      projectName,
      projectNumber,
    },
    financials: {
      ...(source?.financials || {}),
      ...(financialSummary?.financials || {}),
    },
    totals: {
      ...(source?.totals || {}),
      ...(financialSummary?.totals || {}),
    },
    createdAt,
    savedAt: Number(source?.savedAt || updatedAt) || updatedAt,
    updatedAt,
    ts: Number(source?.ts || updatedAt) || updatedAt,
  };
}

export function deriveInvoiceStatus(record, nowTs = Date.now()) {
  const invoice = normalizeInvoiceRecord(record);
  if (invoice.status === INVOICE_STATUSES.VOID) return INVOICE_STATUSES.VOID;
  if (invoice.paymentStatus === PAYMENT_STATUSES.PAID) return INVOICE_STATUSES.PAID;
  const sentLikeStatus = invoice.status === INVOICE_STATUSES.SENT || invoice.status === INVOICE_STATUSES.OVERDUE;
  const hasCommittedBalance =
    roundCurrency(invoice.balanceRemaining) > 0
    && (
      sentLikeStatus
      || invoice.paymentStatus === PAYMENT_STATUSES.PARTIAL
      || roundCurrency(invoice.amountPaid) > 0
    );
  const today = todayParts(new Date(nowTs));
  if (invoice.dueDate && invoice.dueDate < today && hasCommittedBalance) return INVOICE_STATUSES.OVERDUE;
  if (invoice.status === INVOICE_STATUSES.OVERDUE) return INVOICE_STATUSES.OVERDUE;
  if (invoice.status === INVOICE_STATUSES.SENT) return INVOICE_STATUSES.SENT;
  return INVOICE_STATUSES.DRAFT;
}

export function normalizeInvoiceList(records) {
  const arr = Array.isArray(records) ? records.filter(Boolean) : [];
  const normalized = arr.map((invoice) => normalizeInvoiceRecord(invoice)).sort(sortInvoicesByDateDesc);
  return dedupeInvoices(normalized);
}

export function isInvoiceFinanciallyCommitted(record, nowTs = Date.now()) {
  const invoice = normalizeInvoiceRecord(record);
  const status = deriveInvoiceStatus(invoice, nowTs);
  if (status === INVOICE_STATUSES.VOID) return false;
  if (status !== INVOICE_STATUSES.DRAFT) return true;
  return (
    invoice.paymentStatus === PAYMENT_STATUSES.PAID
    || invoice.paymentStatus === PAYMENT_STATUSES.PARTIAL
    || roundCurrency(invoice.amountPaid) > 0
  );
}

export function isInvoiceReceivable(record, nowTs = Date.now()) {
  const invoice = normalizeInvoiceRecord(record);
  const status = deriveInvoiceStatus(invoice, nowTs);
  if (status === INVOICE_STATUSES.VOID) return false;
  if (status === INVOICE_STATUSES.PAID || invoice.paymentStatus === PAYMENT_STATUSES.PAID) return false;
  if (!isInvoiceFinanciallyCommitted(invoice, nowTs)) return false;
  return roundCurrency(invoice.balanceRemaining) > 0;
}

export function buildEstimateInvoiceSummary(estimate, invoices, options = {}) {
  const sourceEstimateId = asText(estimate?.id);
  const ignoreInvoiceId = asText(options?.ignoreInvoiceId);
  const approvedTotal = roundCurrency(estimate?.total ?? estimate?.approvedTotal);
  const arr = Array.isArray(invoices) ? invoices : [];
  const childInvoices = arr
    .map((invoice) => normalizeInvoiceRecord(invoice))
    .filter((invoice) => invoice.sourceEstimateId && invoice.sourceEstimateId === sourceEstimateId)
    .filter((invoice) => !ignoreInvoiceId || invoice.id !== ignoreInvoiceId);
  const activeInvoices = childInvoices.filter((invoice) => deriveInvoiceStatus(invoice) !== INVOICE_STATUSES.VOID);
  const invoicedTotal = roundCurrency(
    activeInvoices.reduce((sum, invoice) => sum + roundCurrency(invoice.invoiceTotal), 0)
  );
  return {
    approvedTotal,
    invoicedTotal,
    remainingToInvoice: roundCurrency(Math.max(approvedTotal - invoicedTotal, 0)),
    linkedInvoiceCount: childInvoices.length,
    activeInvoiceCount: activeInvoices.length,
  };
}

function resolveRequestedInvoiceAmount(invoiceType, requestedValue, summary) {
  const remainingToInvoice = roundCurrency(summary?.remainingToInvoice);
  const approvedTotal = roundCurrency(summary?.approvedTotal);
  const raw = asText(requestedValue);

  if (invoiceType === INVOICE_TYPES.FINAL && !raw) {
    if (remainingToInvoice <= 0) {
      return { error: "Nothing remains to invoice for this estimate." };
    }
    return {
      amount: remainingToInvoice,
      amountMode: "remaining",
      requestedPercent: approvedTotal > 0 ? roundCurrency((remainingToInvoice / approvedTotal) * 100) : 0,
    };
  }

  if (!raw) {
    return { error: "Enter an amount or percent to invoice." };
  }

  const percentMatch = raw.match(/^(-?\d+(?:\.\d+)?)\s*%$/);
  const requestedPercent = percentMatch ? Number(percentMatch[1]) : null;
  const amount = percentMatch
    ? roundCurrency((approvedTotal * requestedPercent) / 100)
    : roundCurrency(raw);
  const amountMode = percentMatch ? "percent" : "amount";

  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "Invoice amount must be greater than $0.00." };
  }
  if (percentMatch && (!Number.isFinite(requestedPercent) || requestedPercent <= 0)) {
    return { error: "Invoice percent must be greater than 0%." };
  }
  if (remainingToInvoice > 0 && amount > remainingToInvoice + EPSILON) {
    return {
      error: `Invoice exceeds the remaining amount to invoice (${remainingToInvoice.toFixed(2)}).`,
    };
  }

  return {
    amount,
    amountMode,
    requestedPercent: percentMatch ? roundCurrency(requestedPercent) : null,
  };
}

export function validateInvoiceAgainstEstimate(options = {}) {
  const invoice = normalizeInvoiceRecord(options?.invoice);
  if (!invoice.sourceEstimateId) {
    return { ok: true, summary: null };
  }

  const invoices = Array.isArray(options?.invoices) ? options.invoices : [];
  const estimate = options?.estimate && typeof options.estimate === "object"
    ? options.estimate
    : { id: invoice.sourceEstimateId, total: invoice?.sourceEstimateSnapshot?.approvedTotal || 0 };
  const summary = buildEstimateInvoiceSummary(estimate, invoices, {
    ignoreInvoiceId: asText(options?.ignoreInvoiceId || invoice.id),
  });
  const nextInvoicedTotal = deriveInvoiceStatus(invoice) === INVOICE_STATUSES.VOID
    ? summary.invoicedTotal
    : roundCurrency(summary.invoicedTotal + invoice.invoiceTotal);

  if (summary.approvedTotal > 0 && nextInvoicedTotal > summary.approvedTotal + EPSILON) {
    return {
      ok: false,
      summary,
      message: `This invoice exceeds the estimate's remaining billable total (${summary.remainingToInvoice.toFixed(2)} remaining).`,
    };
  }

  return { ok: true, summary };
}

function baseInvoiceDraft(nowTs) {
  const base = deepClone(DEFAULT_STATE);
  const now = Number(nowTs) || Date.now();
  return {
    ...base,
    id: createInvoiceId(),
    docType: "invoice",
    ui: {
      ...(base?.ui || {}),
      docType: "invoice",
    },
    status: INVOICE_STATUSES.DRAFT,
    invoiceType: INVOICE_TYPES.MANUAL,
    invoiceNumber: "",
    invoiceTotal: 0,
    amountPaid: 0,
    balanceRemaining: 0,
    paymentStatus: PAYMENT_STATUSES.UNPAID,
    payments: [],
    savedAt: now,
    updatedAt: now,
    createdAt: now,
    ts: now,
    meta: {
      ...(base?.meta || {}),
      savedDocId: "",
      savedDocCreatedAt: now,
      lastSavedAt: now,
      ephemeralDraft: true,
    },
  };
}

export function createManualInvoiceDraft(existingInvoices, options = {}) {
  const now = Number(options?.nowTs) || Date.now();
  const invoiceNumber = generateNextInvoiceNumber(existingInvoices);
  const draft = baseInvoiceDraft(now);
  draft.id = createInvoiceId();
  draft.invoiceType = INVOICE_TYPES.MANUAL;
  draft.invoiceNumber = invoiceNumber;
  draft.job = {
    ...(draft.job || {}),
    date: normalizeIsoDate(options?.invoiceDate, todayISO()),
    due: normalizeIsoDate(options?.dueDate),
    docNumber: invoiceNumber,
  };
  draft.meta = {
    ...(draft.meta || {}),
    savedDocId: draft.id,
    savedDocCreatedAt: now,
    lastSavedAt: now,
    ephemeralDraft: true,
  };
  return normalizeInvoiceRecord(draft);
}

export function createInvoiceDraftFromEstimate(estimate, invoices, options = {}) {
  const status = asText(estimate?.status).toLowerCase();
  if (status !== "approved") {
    return { ok: false, message: "Only approved estimates can create child invoices." };
  }

  const summary = buildEstimateInvoiceSummary(estimate, invoices);
  if (summary.remainingToInvoice <= 0) {
    return { ok: false, message: "This estimate has no remaining amount to invoice." };
  }

  const invoiceType = normalizeInvoiceType(options?.invoiceType || INVOICE_TYPES.FINAL);
  const amountResolution = resolveRequestedInvoiceAmount(invoiceType, options?.requestedValue, summary);
  if (amountResolution.error) {
    return { ok: false, message: amountResolution.error, summary };
  }

  const now = Number(options?.nowTs) || Date.now();
  const invoiceNumber = generateNextInvoiceNumber(invoices);
  const snapshot = buildEstimateInvoiceSnapshot(estimate);
  const note = asText(options?.note);
  const invoiceDate = normalizeIsoDate(options?.invoiceDate, todayISO());
  const dueDate = normalizeIsoDate(options?.dueDate || estimate?.job?.due);
  const draft = baseInvoiceDraft(now);
  const allocatedFinancialSummary = allocateFinancialSummaryFromSource(
    snapshot,
    amountResolution.amount,
    summary.approvedTotal
  );

  draft.id = createInvoiceId();
  draft.invoiceType = invoiceType;
  draft.invoiceNumber = invoiceNumber;
  draft.estimateNumber = snapshot.estimateNumber;
  draft.sourceEstimateId = snapshot.estimateId;
  draft.sourceEstimateSnapshot = snapshot;
  draft.customerId = snapshot.customerId;
  draft.customerName = snapshot.customerName;
  draft.projectName = snapshot.projectName;
  draft.projectNumber = snapshot.projectNumber;
  draft.invoiceTotal = amountResolution.amount;
  draft.total = amountResolution.amount;
  draft.amountPaid = 0;
  draft.balanceRemaining = amountResolution.amount;
  draft.paymentStatus = PAYMENT_STATUSES.UNPAID;
  draft.payments = [];
  draft.additionalNotes = note;
  draft.customer = {
    ...(draft.customer || {}),
    ...(snapshot.customer || {}),
    id: snapshot.customerId,
    name: snapshot.customerName,
    projectName: snapshot.projectName,
    projectNumber: snapshot.projectNumber,
  };
  draft.job = {
    ...(draft.job || {}),
    ...(snapshot.job || {}),
    date: invoiceDate,
    due: dueDate,
    poNumber: snapshot.poNumber,
    docNumber: invoiceNumber,
  };
  draft.ui = {
    ...(draft.ui || {}),
    docType: "invoice",
    materialsMode: "blanket",
  };
  draft.labor = {
    ...(draft.labor || {}),
    hazardPct: 0,
    riskPct: 0,
    multiplier: 1,
    lines: [{ id: "l1", role: "", hours: "", rate: "", trueRateInternal: "" }],
  };
  draft.materials = {
    ...(draft.materials || {}),
    blanketCost: String(amountResolution.amount),
    blanketInternalCost: "",
    materialsBlanketDescription: `${invoiceType.charAt(0).toUpperCase()}${invoiceType.slice(1)} invoice for Estimate #${snapshot.estimateNumber || "-"}`,
    markupPct: 0,
    items: [{ id: "m1", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" }],
  };
  draft.invoiceMeta = {
    sourceType: "estimate",
    amountMode: amountResolution.amountMode,
    requestedPercent: amountResolution.requestedPercent,
    approvedTotalAtCreation: summary.approvedTotal,
    remainingToInvoiceAtCreation: summary.remainingToInvoice,
    createdFromEstimateAt: now,
    financialSource: "estimate-proportional",
  };
  draft.approvedTotal = allocatedFinancialSummary.approvedTotal;
  draft.totalRevenue = allocatedFinancialSummary.totalRevenue;
  draft.grandTotal = allocatedFinancialSummary.grandTotal;
  draft.totalCost = allocatedFinancialSummary.totalCost;
  draft.internalCost = allocatedFinancialSummary.internalCost;
  draft.grossProfit = allocatedFinancialSummary.grossProfit;
  draft.grossMargin = allocatedFinancialSummary.grossMargin;
  draft.grossMarginPct = allocatedFinancialSummary.grossMarginPct;
  draft.grossProfitMargin = allocatedFinancialSummary.grossProfitMargin;
  draft.margin = allocatedFinancialSummary.margin;
  draft.marginPct = allocatedFinancialSummary.marginPct;
  draft.marginPercent = allocatedFinancialSummary.marginPercent;
  draft.laborRevenue = allocatedFinancialSummary.laborRevenue;
  draft.laborCost = allocatedFinancialSummary.laborCost;
  draft.materialsRevenue = allocatedFinancialSummary.materialsRevenue;
  draft.materialsCost = allocatedFinancialSummary.materialsCost;
  draft.financials = {
    ...(draft.financials || {}),
    ...(allocatedFinancialSummary.financials || {}),
  };
  draft.totals = {
    ...(draft.totals || {}),
    ...(allocatedFinancialSummary.totals || {}),
  };
  draft.meta = {
    ...(draft.meta || {}),
    savedDocId: draft.id,
    savedDocCreatedAt: now,
    lastSavedAt: now,
    ephemeralDraft: true,
  };

  const normalized = normalizeInvoiceRecord(draft);
  const validation = validateInvoiceAgainstEstimate({
    invoice: normalized,
    estimate,
    invoices,
  });
  if (!validation.ok) {
    return { ok: false, message: validation.message, summary };
  }

  return {
    ok: true,
    draft: normalized,
    summary,
  };
}

export function duplicateInvoiceDraft(invoice, invoices, options = {}) {
  const source = normalizeInvoiceRecord(invoice);
  const now = Number(options?.nowTs) || Date.now();
  const invoiceNumber = generateNextInvoiceNumber(invoices);
  const duplicate = normalizeInvoiceRecord({
    ...deepClone(source),
    id: createInvoiceId(),
    invoiceNumber,
    status: INVOICE_STATUSES.DRAFT,
    amountPaid: 0,
    balanceRemaining: source.invoiceTotal,
    paymentStatus: PAYMENT_STATUSES.UNPAID,
    payments: [],
    date: normalizeIsoDate(options?.invoiceDate, todayISO()),
    dueDate: normalizeIsoDate(options?.dueDate || source?.dueDate),
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    ts: now,
    job: {
      ...(source?.job || {}),
      docNumber: invoiceNumber,
      date: normalizeIsoDate(options?.invoiceDate, todayISO()),
      due: normalizeIsoDate(options?.dueDate || source?.dueDate),
    },
    meta: {
      ...(source?.meta || {}),
      savedDocId: "",
      savedDocCreatedAt: now,
      lastSavedAt: now,
      ephemeralDraft: true,
    },
  });
  duplicate.meta = {
    ...(duplicate.meta || {}),
    savedDocId: duplicate.id,
  };

  if (duplicate.sourceEstimateId) {
    const estimates = Array.isArray(options?.estimates) ? options.estimates : [];
    const estimate = estimates.find((entry) => asText(entry?.id) === duplicate.sourceEstimateId) || null;
    const validation = validateInvoiceAgainstEstimate({
      invoice: duplicate,
      estimate,
      invoices,
    });
    if (!validation.ok) {
      return { ok: false, message: validation.message, summary: validation.summary };
    }
  }

  return { ok: true, draft: duplicate };
}

export function updateInvoiceLifecycleStatus(invoice, nextStatus, options = {}) {
  const source = normalizeInvoiceRecord(invoice);
  const status = asText(nextStatus).toLowerCase();
  const now = Number(options?.nowTs) || Date.now();
  const today = todayParts(new Date(now));

  if (status === INVOICE_STATUSES.PAID) {
    const paymentAmount = roundCurrency(source.invoiceTotal);
    return normalizeInvoiceRecord({
      ...source,
      status: INVOICE_STATUSES.PAID,
      amountPaid: paymentAmount,
      balanceRemaining: 0,
      paymentStatus: PAYMENT_STATUSES.PAID,
      payments: [
        {
          id: createPaymentId(),
          amount: paymentAmount,
          paidAt: today,
          note: asText(options?.note) || "Marked paid",
          method: "manual",
        },
      ],
      updatedAt: now,
      savedAt: now,
      ts: now,
    });
  }

  if (status === INVOICE_STATUSES.VOID) {
    return normalizeInvoiceRecord({
      ...source,
      status: INVOICE_STATUSES.VOID,
      amountPaid: 0,
      balanceRemaining: 0,
      paymentStatus: PAYMENT_STATUSES.VOID,
      payments: [],
      updatedAt: now,
      savedAt: now,
      ts: now,
    });
  }

  if (status === INVOICE_STATUSES.SENT) {
    return normalizeInvoiceRecord({
      ...source,
      status: INVOICE_STATUSES.SENT,
      updatedAt: now,
      savedAt: now,
      ts: now,
    });
  }

  return normalizeInvoiceRecord({
    ...source,
    status: INVOICE_STATUSES.DRAFT,
    updatedAt: now,
    savedAt: now,
    ts: now,
  });
}
