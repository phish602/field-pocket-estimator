// @ts-nocheck
/* eslint-disable */

import { DEFAULT_STATE } from "../estimator/defaultState";
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
    return normalizeInvoiceList(parsed);
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
  return {
    estimateId: asText(source?.id),
    estimateNumber: asText(source?.estimateNumber || source?.job?.docNumber),
    approvedTotal: roundCurrency(source?.total),
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
    summary: {
      total: roundCurrency(source?.total),
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

  return {
    ...source,
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
    sourceEstimateSnapshot: sourceEstimateId ? snapshot : null,
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
  const today = todayParts(new Date(nowTs));
  if (invoice.dueDate && invoice.dueDate < today) return INVOICE_STATUSES.OVERDUE;
  if (invoice.status === INVOICE_STATUSES.SENT) return INVOICE_STATUSES.SENT;
  return INVOICE_STATUSES.DRAFT;
}

export function normalizeInvoiceList(records) {
  const arr = Array.isArray(records) ? records.filter(Boolean) : [];
  return arr.map((invoice) => normalizeInvoiceRecord(invoice)).sort(sortInvoicesByDateDesc);
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
