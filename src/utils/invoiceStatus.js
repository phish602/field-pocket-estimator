// @ts-nocheck
/* eslint-disable */

export const INVOICE_STATUSES = {
  DRAFT: "draft",
  SENT: "sent",
  PAID: "paid",
  OVERDUE: "overdue",
  VOID: "void",
};

const PAYMENT_STATUSES = {
  UNPAID: "unpaid",
  PARTIAL: "partial",
  PAID: "paid",
  VOID: "void",
};

const EPSILON = 0.005;

function asText(value) {
  return String(value || "").trim();
}

function toCurrencyNumber(value) {
  const next = typeof value === "number"
    ? value
    : parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(next) ? next : 0;
}

function roundCurrency(value) {
  return Math.round(toCurrencyNumber(value) * 100) / 100;
}

function todayParts(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function normalizeIsoDate(value, fallback = "") {
  const raw = asText(value);
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return todayParts(parsed);
}

export function normalizeStoredInvoiceStatus(value) {
  const raw = asText(value).toLowerCase();
  if (raw === INVOICE_STATUSES.VOID) return INVOICE_STATUSES.VOID;
  if (raw === INVOICE_STATUSES.PAID) return INVOICE_STATUSES.PAID;
  if (raw === INVOICE_STATUSES.OVERDUE) return INVOICE_STATUSES.OVERDUE;
  if (raw === INVOICE_STATUSES.SENT) return INVOICE_STATUSES.SENT;
  return INVOICE_STATUSES.DRAFT;
}

export function normalizePaymentStatus(value) {
  const raw = asText(value).toLowerCase();
  if (raw === PAYMENT_STATUSES.VOID) return PAYMENT_STATUSES.VOID;
  if (raw === PAYMENT_STATUSES.PAID) return PAYMENT_STATUSES.PAID;
  if (raw === PAYMENT_STATUSES.PARTIAL) return PAYMENT_STATUSES.PARTIAL;
  return PAYMENT_STATUSES.UNPAID;
}

export function normalizeInvoiceLifecycleRecord(record) {
  const source = record && typeof record === "object" ? record : {};
  const payments = Array.isArray(source?.payments) ? source.payments.filter(Boolean) : [];
  let invoiceTotal = roundCurrency(source?.invoiceTotal ?? source?.total);
  let amountPaid = roundCurrency(source?.amountPaid);
  const paidFromLedger = roundCurrency(
    payments.reduce((sum, payment) => sum + roundCurrency(payment?.amount), 0)
  );
  if (paidFromLedger > 0) amountPaid = paidFromLedger;

  const status = normalizeStoredInvoiceStatus(source?.status);
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

  return {
    status,
    paymentStatus,
    balanceRemaining,
    amountPaid,
    dueDate: normalizeIsoDate(source?.dueDate || source?.job?.due),
  };
}

export function deriveInvoiceStatus(record, nowTs = Date.now()) {
  const invoice = normalizeInvoiceLifecycleRecord(record);
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