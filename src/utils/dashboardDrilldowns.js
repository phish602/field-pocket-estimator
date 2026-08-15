// @ts-nocheck
/* eslint-disable */

// Lane 3 shared drill-down semantics.
//
// Dashboard metrics and the list filters they drill into must never disagree.
// Every predicate below is the single definition used by BOTH sides: the card
// that displays the number imports it to count, and the destination list
// imports it to filter. Nothing here introduces a new business status,
// threshold, or arithmetic -- each predicate mirrors the calculation that
// already produced the visible metric.

import { INVOICE_STATUSES, deriveInvoiceStatus } from "./invoiceStatus";

export const DRILLDOWN_SCOPES = {
  INVOICES: "invoices",
  PROJECTS: "projects",
  ESTIMATES: "estimates",
  CUSTOMERS: "customers",
};

export const INVOICE_DRILLDOWNS = {
  RECEIVABLES: "receivables",
  OVERDUE: "overdue",
  PAID: "paid",
  // Home shows money "collected to date", which sums every recorded payment --
  // including partial payments on invoices that are not yet settled. The honest
  // drill-down for that figure is therefore every invoice that contributed a
  // payment, not only the fully paid ones.
  COLLECTED: "collected",
  PAYMENT_STATUS: "payment-status",
};

export const PROJECT_DRILLDOWNS = {
  ACTIVE: "active",
  BALANCE: "balance",
  OVERDUE: "overdue",
  READY_TO_INVOICE: "approved",
};

export const ESTIMATE_DRILLDOWNS = {
  AWAITING: "awaiting",
  READY_TO_INVOICE: "approved-ready",
  HIGH_VALUE: "high-value",
  LOST: "lost",
  APPROVED: "approved",
  DRAFT: "draft",
};

export const CUSTOMER_DRILLDOWNS = {
  BALANCE_DUE: "balance-due",
  LINKED_PROJECTS: "linked-projects",
  OPEN_DOCUMENTS: "open-documents",
  OVERDUE: "overdue",
};

// The Estimates revenue pipeline already calls anything at or above this total
// "high value", and the existing `valueFilter === "large"` option uses the same
// number. Exported so the metric and the filter can never drift apart.
export const HIGH_VALUE_ESTIMATE_MIN = 10000;

const PAYMENT_STATUS_PAID = "paid";
const PAYMENT_STATUS_VOID = "void";

function toCurrencyNumber(value) {
  const next = typeof value === "number"
    ? value
    : parseFloat(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(next) ? next : 0;
}

function roundCurrency(value) {
  return Math.round(toCurrencyNumber(value) * 100) / 100;
}

function toNum(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function rawPaymentStatus(invoice) {
  return String(invoice?.paymentStatus || "").trim().toLowerCase();
}

// Mirrors the balance arithmetic the receivables board already performs. It
// reads the stored balance when present and otherwise falls back to
// total - paid, exactly as before. No arithmetic is changed here.
export function invoiceBalanceRemaining(invoice) {
  const invoiceTotal = roundCurrency(invoice?.invoiceTotal || invoice?.total || 0);
  const amountPaid = roundCurrency(invoice?.amountPaid || 0);
  return roundCurrency(
    invoice?.balanceRemaining !== undefined && invoice?.balanceRemaining !== null
      ? invoice.balanceRemaining
      : Math.max(0, invoiceTotal - amountPaid)
  );
}

export function isReceivableInvoice(invoice) {
  const derivedStatus = deriveInvoiceStatus(invoice);
  if (derivedStatus === INVOICE_STATUSES.VOID) return false;
  if (rawPaymentStatus(invoice) === PAYMENT_STATUS_VOID) return false;
  return invoiceBalanceRemaining(invoice) > 0;
}

export function isOverdueInvoice(invoice) {
  return deriveInvoiceStatus(invoice) === INVOICE_STATUSES.OVERDUE
    && invoiceBalanceRemaining(invoice) > 0;
}

export function hasCollectedPayment(invoice) {
  if (rawPaymentStatus(invoice) === PAYMENT_STATUS_VOID) return false;
  if (deriveInvoiceStatus(invoice) === INVOICE_STATUSES.VOID) return false;
  return roundCurrency(invoice?.amountPaid) > 0;
}

export function isPaidInvoice(invoice) {
  return deriveInvoiceStatus(invoice) === INVOICE_STATUSES.PAID
    || rawPaymentStatus(invoice) === PAYMENT_STATUS_PAID;
}

// Stripe follow-up needs session state the screen owns, so the caller supplies
// the same resolver the board uses. Without a resolver the predicate matches
// nothing rather than guessing.
export function isPaymentFollowUpInvoice(invoice, resolveSessionState) {
  if (typeof resolveSessionState !== "function") return false;
  if (invoiceBalanceRemaining(invoice) <= 0) return false;
  const state = String(resolveSessionState(invoice) || "").trim().toLowerCase();
  return state === "pending" || state === "review" || state === "expired";
}

export function invoiceMatchesDrilldown(invoice, drilldown, options = {}) {
  const key = String(drilldown || "").trim().toLowerCase();
  if (!key || key === "all") return true;
  if (key === INVOICE_DRILLDOWNS.RECEIVABLES) return isReceivableInvoice(invoice);
  if (key === INVOICE_DRILLDOWNS.OVERDUE) return isOverdueInvoice(invoice);
  if (key === INVOICE_DRILLDOWNS.PAID) return isPaidInvoice(invoice);
  if (key === INVOICE_DRILLDOWNS.COLLECTED) return hasCollectedPayment(invoice);
  if (key === INVOICE_DRILLDOWNS.PAYMENT_STATUS) {
    return isPaymentFollowUpInvoice(invoice, options?.resolveSessionState);
  }
  return true;
}

// Projects are matched against the normalized rows the portfolio already
// builds (status/totals/overdueCount/approvedEstCount), so the predicates are
// the same expressions the hero stats reduce over.
export function projectMatchesDrilldown(project, drilldown) {
  const key = String(drilldown || "").trim().toLowerCase();
  if (!key || key === "all") return true;
  if (key === PROJECT_DRILLDOWNS.ACTIVE) return String(project?.status || "") === "active";
  if (key === PROJECT_DRILLDOWNS.BALANCE) return toNum(project?.totals?.balanceRemaining) > 0;
  if (key === PROJECT_DRILLDOWNS.OVERDUE) return toNum(project?.overdueCount) > 0;
  if (key === PROJECT_DRILLDOWNS.READY_TO_INVOICE) return toNum(project?.approvedEstCount) > 0;
  return true;
}

export function isHighValueEstimate(estimate) {
  return toNum(estimate?.total) >= HIGH_VALUE_ESTIMATE_MIN;
}

// `normalizeStatus` and `remainingToInvoice` are supplied by the Estimates
// screen so this module never re-implements estimate lifecycle rules or the
// estimate-to-invoice arithmetic.
export function estimateMatchesDrilldown(estimate, drilldown, options = {}) {
  const key = String(drilldown || "").trim().toLowerCase();
  if (!key || key === "all") return true;
  const normalizeStatus = typeof options?.normalizeStatus === "function"
    ? options.normalizeStatus
    : (value) => String(value || "").trim().toLowerCase();
  const status = normalizeStatus(estimate?.status);

  if (key === ESTIMATE_DRILLDOWNS.AWAITING) return status === "pending";
  if (key === ESTIMATE_DRILLDOWNS.LOST) return status === "lost";
  if (key === ESTIMATE_DRILLDOWNS.DRAFT) return status === "draft";
  if (key === ESTIMATE_DRILLDOWNS.APPROVED) return status === "approved";
  if (key === ESTIMATE_DRILLDOWNS.HIGH_VALUE) return isHighValueEstimate(estimate);
  if (key === ESTIMATE_DRILLDOWNS.READY_TO_INVOICE) {
    if (status !== "approved") return false;
    const remaining = typeof options?.remainingToInvoice === "function"
      ? toNum(options.remainingToInvoice(estimate))
      : 0;
    return remaining > 0;
  }
  return true;
}

// Customer drill-downs read the per-customer KPI rows the Account Priority
// header already sums, addressed by customer id.
export function customerMatchesDrilldown(customer, drilldown, options = {}) {
  const key = String(drilldown || "").trim().toLowerCase();
  if (!key || key === "all") return true;
  const customerId = String(customer?.id || "");
  const kpis = options?.customerKpis?.[customerId] || {};
  const projectMeta = options?.customerProjectMeta?.[customerId] || {};

  if (key === CUSTOMER_DRILLDOWNS.BALANCE_DUE) return toNum(kpis?.balanceDue) > 0;
  if (key === CUSTOMER_DRILLDOWNS.LINKED_PROJECTS) return toNum(projectMeta?.projectCount) > 0;
  if (key === CUSTOMER_DRILLDOWNS.OPEN_DOCUMENTS) {
    return toNum(kpis?.estimateCount) + toNum(kpis?.openInvoiceCount) > 0;
  }
  if (key === CUSTOMER_DRILLDOWNS.OVERDUE) return toNum(kpis?.overdueInvoiceCount) > 0;
  return true;
}

const DRILLDOWN_LABELS = {
  [DRILLDOWN_SCOPES.INVOICES]: {
    [INVOICE_DRILLDOWNS.RECEIVABLES]: { en: "Open balance", es: "Saldo abierto" },
    [INVOICE_DRILLDOWNS.OVERDUE]: { en: "Overdue", es: "Vencidas" },
    [INVOICE_DRILLDOWNS.PAID]: { en: "Paid", es: "Pagadas" },
    [INVOICE_DRILLDOWNS.COLLECTED]: { en: "Collected", es: "Cobradas" },
    [INVOICE_DRILLDOWNS.PAYMENT_STATUS]: { en: "Payment follow-up", es: "Seguimiento de pago" },
  },
  [DRILLDOWN_SCOPES.PROJECTS]: {
    [PROJECT_DRILLDOWNS.ACTIVE]: { en: "Active jobs", es: "Trabajos activos" },
    [PROJECT_DRILLDOWNS.BALANCE]: { en: "Balance due", es: "Saldo pendiente" },
    [PROJECT_DRILLDOWNS.OVERDUE]: { en: "Overdue invoices", es: "Facturas vencidas" },
    [PROJECT_DRILLDOWNS.READY_TO_INVOICE]: { en: "Ready to invoice", es: "Listo para facturar" },
  },
  [DRILLDOWN_SCOPES.ESTIMATES]: {
    [ESTIMATE_DRILLDOWNS.AWAITING]: { en: "Awaiting response", es: "Esperando respuesta" },
    [ESTIMATE_DRILLDOWNS.READY_TO_INVOICE]: { en: "Ready for invoice", es: "Listo para facturar" },
    [ESTIMATE_DRILLDOWNS.HIGH_VALUE]: { en: "High value", es: "Alto valor" },
    [ESTIMATE_DRILLDOWNS.LOST]: { en: "Lost", es: "Perdidos" },
    [ESTIMATE_DRILLDOWNS.APPROVED]: { en: "Approved", es: "Aprobados" },
    [ESTIMATE_DRILLDOWNS.DRAFT]: { en: "Draft", es: "Borrador" },
  },
  [DRILLDOWN_SCOPES.CUSTOMERS]: {
    [CUSTOMER_DRILLDOWNS.BALANCE_DUE]: { en: "Open balance due", es: "Saldo pendiente" },
    [CUSTOMER_DRILLDOWNS.LINKED_PROJECTS]: { en: "Linked projects", es: "Proyectos vinculados" },
    [CUSTOMER_DRILLDOWNS.OPEN_DOCUMENTS]: { en: "Open document activity", es: "Actividad de documentos" },
    [CUSTOMER_DRILLDOWNS.OVERDUE]: { en: "Overdue accounts", es: "Cuentas vencidas" },
  },
};

export function drilldownLabel(scope, drilldown, lang = "en") {
  const entry = DRILLDOWN_LABELS?.[String(scope || "")]?.[String(drilldown || "")];
  if (!entry) return "";
  return lang === "es" ? entry.es : entry.en;
}

// A drill-down intent is transient navigation context, not persisted filter
// state. It carries only which destination should open and which subset it
// should reveal; the destination screen stays authoritative for its own
// filters and consumes the intent exactly once.
export function createDrilldownIntent(scope, drilldown, extra = {}) {
  const normalizedScope = String(scope || "").trim();
  const normalizedDrilldown = String(drilldown || "").trim();
  if (!normalizedScope || !normalizedDrilldown) return null;
  return {
    scope: normalizedScope,
    drilldown: normalizedDrilldown,
    ...(extra && typeof extra === "object" ? extra : {}),
    seq: Number(extra?.seq) || Date.now(),
  };
}

export function readDrilldownIntent(intent, scope) {
  if (!intent || typeof intent !== "object") return "";
  if (String(intent.scope || "") !== String(scope || "")) return "";
  return String(intent.drilldown || "").trim();
}
