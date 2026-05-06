// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  addManualInvoicePayment,
  appendStripeInvoicePayment,
  INVOICE_STATUSES,
  PAYMENT_STATUSES,
  createManualInvoiceDraft,
  deriveInvoiceStatus,
  duplicateInvoiceDraft,
  readStoredInvoices,
  roundCurrency,
  todayISO,
  updateInvoiceLifecycleStatus,
  writeStoredInvoices,
} from "../utils/invoices";
import {
  readStoredProjects,
  resolveProjectNavigationTarget,
  upsertProject,
  writeStoredProjects,
} from "../utils/projects";

const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const STRIPE_CHECKOUT_SESSIONS_KEY = STORAGE_KEYS.STRIPE_CHECKOUT_SESSIONS;
const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const ACTIVE_EDIT_CONTEXT_KEY = "estipaid-active-edit-context-v1";
const PAYMENT_METHOD_OPTIONS = ["manual", "cash", "check", "card", "bank_transfer"];

function readCompanyStripeAccountId() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE) || "";
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    const stripeAccountId = String(parsed?.stripeAccountId || "").trim();
    return /^acct_/i.test(stripeAccountId) ? stripeAccountId : "";
  } catch {
    return "";
  }
}

function normalizeStripeCheckoutSessionRef(entry) {
  const status = String(entry?.status || "pending").trim().toLowerCase();
  return {
    invoiceId: String(entry?.invoiceId || "").trim(),
    invoiceNumber: String(entry?.invoiceNumber || "").trim(),
    stripeAccountId: String(entry?.stripeAccountId || "").trim(),
    sessionId: String(entry?.sessionId || "").trim(),
    checkoutUrl: String(entry?.checkoutUrl || "").trim(),
    amount: roundCurrency(entry?.amount),
    currency: String(entry?.currency || "usd").trim().toLowerCase() || "usd",
    createdAt: Number(entry?.createdAt || 0) || Date.now(),
    expiresAt: Number(entry?.expiresAt || 0) || null,
    status: ["pending", "synced", "review"].includes(status) ? status : "pending",
    paymentIntentId: String(entry?.paymentIntentId || "").trim(),
    paidAt: String(entry?.paidAt || "").trim(),
    lastCheckedAt: Number(entry?.lastCheckedAt || 0) || 0,
  };
}

function isStripeSessionExpired(sessionRef, nowTs = Date.now()) {
  const expiresAt = Number(sessionRef?.expiresAt || 0) || 0;
  if (!expiresAt) return false;
  return nowTs >= expiresAt * 1000;
}

function hasMatchingStripeLedgerPayment(invoice, sessionRef) {
  const targetSessionId = String(sessionRef?.sessionId || "").trim();
  const targetPaymentIntentId = String(sessionRef?.paymentIntentId || "").trim();
  const payments = Array.isArray(invoice?.payments) ? invoice.payments : [];
  if (!targetSessionId && !targetPaymentIntentId) return false;
  return payments.some((payment) => {
    const method = String(payment?.method || "").trim().toLowerCase();
    if (method !== "stripe") return false;
    const paymentSessionId = String(payment?.stripeSessionId || payment?.sessionId || "").trim();
    const paymentIntentId = String(payment?.stripePaymentIntentId || payment?.paymentIntentId || "").trim();
    return (
      (targetSessionId && paymentSessionId && paymentSessionId === targetSessionId)
      || (targetPaymentIntentId && paymentIntentId && paymentIntentId === targetPaymentIntentId)
    );
  });
}

function getStripeSessionDisplayState(sessionRef, invoice, nowTs = Date.now()) {
  const storedStatus = String(sessionRef?.status || "").trim().toLowerCase();
  if (storedStatus === "synced") return "synced";
  if (storedStatus === "review") return "review";
  if (hasMatchingStripeLedgerPayment(invoice, sessionRef)) return "synced";
  if (isStripeSessionExpired(sessionRef, nowTs)) return "expired";
  return "pending";
}

function readStoredStripeCheckoutSessions() {
  try {
    const raw = localStorage.getItem(STRIPE_CHECKOUT_SESSIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean).map((entry) => normalizeStripeCheckoutSessionRef(entry));
  } catch {
    return [];
  }
}

function loadSavedEstimates() {
  try {
    const raw = localStorage.getItem(ESTIMATES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean).filter((entry) => String(entry?.docType || "estimate").toLowerCase() !== "invoice");
  } catch {
    return [];
  }
}

function readCustomers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function EmptyInvoiceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6.5h8" />
        <path d="M8 9.8h7" opacity="0.85" />
        <path d="M8 13.1h8" opacity="0.7" />
        <path d="M6.8 6.2h10.4v13.2l-1.7-.9-1.7.9-1.7-.9-1.7.9-1.7-.9-1.7.9V6.2Z" opacity="0.95" />
        <path d="M14.6 15.3l1 1 2-2" opacity="0.85" />
      </g>
    </svg>
  );
}

const stickyListHeaderStyle = {
  position: "sticky",
  top: 0,
  zIndex: 12,
  paddingTop: 6,
  paddingBottom: 8,
  background: "transparent",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
  borderBottom: "0",
};

const filterPanelStyle = {
  width: "100%",
  marginBottom: "18px",
};

const statusSelectStyle = {
};

const valueSelectStyle = {
};

const clearButtonStyle = {
};

const searchFieldStyle = {
  width: "100%",
  display: "block",
  padding: "10px 14px",
  borderRadius: "10px",
  paddingRight: 42,
};

const filtersRowStyle = {
  display: "flex",
  gap: "10px",
  justifyContent: "center",
  marginTop: "12px",
  marginBottom: "20px",
};

const invoiceCardStyle = {
  padding: "14px 16px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  boxSizing: "border-box",
  overflow: "hidden",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  width: "100%",
  maxWidth: "100%",
  minWidth: 0,
};

const invoiceCardTopStyle = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  gap: 10,
  alignItems: "start",
};

const invoicePrimaryLineStyle = {
  display: "grid",
  gap: 5,
  minWidth: 0,
};

const invoiceTitleStyle = {
  fontSize: 15.5,
  lineHeight: 1.3,
  fontWeight: 800,
  letterSpacing: 0.2,
  minWidth: 0,
  display: "block",
  whiteSpace: "normal",
  overflow: "visible",
  textOverflow: "clip",
  WebkitLineClamp: "unset",
  WebkitBoxOrient: "initial",
};

const invoiceEstimateNumberStyle = {
  fontSize: 12,
  lineHeight: 1.3,
  fontWeight: 600,
  opacity: 0.75,
  color: "rgba(226,232,240,0.92)",
  display: "block",
  whiteSpace: "normal",
  overflow: "visible",
  textOverflow: "clip",
};

const invoiceDocLineStyle = {
  fontSize: 12,
  lineHeight: 1.3,
  fontWeight: 600,
  opacity: 0.65,
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  alignItems: "baseline",
  minWidth: 0,
};

const invoiceSecondaryLineStyle = {
  fontSize: 13,
  lineHeight: 1.3,
  fontWeight: 500,
  color: "rgba(99,179,237,0.84)",
  minWidth: 0,
  whiteSpace: "normal",
  overflow: "visible",
  textOverflow: "clip",
};

const invoiceProjectLineStyle = {
  fontSize: 12.5,
  lineHeight: 1.32,
  fontWeight: 500,
  color: "rgba(226,232,240,0.72)",
  minWidth: 0,
  whiteSpace: "normal",
  overflow: "visible",
  textOverflow: "clip",
};

const invoiceMetaLineStyle = {
  display: "flex",
  flexWrap: "wrap",
  gap: 6,
  alignItems: "baseline",
  fontSize: 11.5,
  lineHeight: 1.35,
  color: "rgba(226,232,240,0.68)",
  minWidth: 0,
};

const invoiceDateStyle = {
  minWidth: 0,
  flex: "1 1 auto",
  whiteSpace: "normal",
};

const invoiceMetricsWrapStyle = {
  display: "flex",
  width: "100%",
  minWidth: 0,
};

const invoiceMetricRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "nowrap",
  gap: "8px",
  width: "100%",
  minWidth: 0,
};

const invoiceMetricLabelStyle = {
  fontSize: 10,
  fontWeight: 900,
  opacity: 0.72,
  letterSpacing: "0.9px",
  textTransform: "uppercase",
  textAlign: "center",
  lineHeight: 1.1,
};

const invoiceMetricColumnStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 4,
  flex: "1 1 0",
};

const invoiceMetricPillStyle = (highlight) => ({
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: highlight ? "rgba(34,197,94,0.10)" : "rgba(255,255,255,0.06)",
  boxShadow: "inset 0 1px 2px rgba(255,255,255,0.05), 0 4px 10px rgba(0,0,0,0.35)",
  fontSize: 12.5,
  fontWeight: 800,
  letterSpacing: "0.3px",
  flexShrink: 0,
  whiteSpace: "nowrap",
  color: "rgba(245,248,252,0.96)",
  textAlign: "center",
  flex: "1 1 0",
});

const invoiceHeaderInfoStyle = {
  display: "grid",
  gap: 8,
  minWidth: 0,
  flex: "1 1 0",
};

const invoiceCustomerProjectWrapStyle = {
  display: "grid",
  gap: 4,
  minWidth: 0,
};

const invoiceStatusPillBaseStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 24,
  padding: "4px 9px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.16)",
  fontSize: 10.5,
  lineHeight: 1,
  fontWeight: 900,
  letterSpacing: "0.2px",
  whiteSpace: "nowrap",
};

const invoiceDetailsWrapStyle = {
  overflow: "hidden",
  transition: "max-height 320ms ease, opacity 220ms ease, transform 220ms ease, padding-top 220ms ease",
  borderTop: "1px solid rgba(255,255,255,0.10)",
};

function formatStatusLabel(status, lang) {
  const raw = String(status || "").toLowerCase();
  if (raw === INVOICE_STATUSES.SENT) return lang === "es" ? "Enviada" : "Sent";
  if (raw === INVOICE_STATUSES.PAID) return lang === "es" ? "Pagada" : "Paid";
  if (raw === INVOICE_STATUSES.OVERDUE) return lang === "es" ? "Vencida" : "Overdue";
  if (raw === INVOICE_STATUSES.VOID) return lang === "es" ? "Anulada" : "Void";
  return lang === "es" ? "Borrador" : "Draft";
}

function formatPaymentStatus(paymentStatus, lang) {
  const raw = String(paymentStatus || "").toLowerCase();
  if (raw === PAYMENT_STATUSES.PAID) return lang === "es" ? "Pagado" : "Paid";
  if (raw === PAYMENT_STATUSES.PARTIAL) return lang === "es" ? "Parcial" : "Partial";
  if (raw === PAYMENT_STATUSES.VOID) return lang === "es" ? "Anulado" : "Void";
  return lang === "es" ? "Pendiente" : "Unpaid";
}

function formatPaymentMethod(method, lang) {
  const raw = String(method || "manual").trim().toLowerCase();
  if (raw === "stripe") return "Stripe";
  if (raw === "cash") return lang === "es" ? "Efectivo" : "Cash";
  if (raw === "check") return lang === "es" ? "Cheque" : "Check";
  if (raw === "card") return lang === "es" ? "Tarjeta" : "Card";
  if (raw === "bank_transfer" || raw === "bank transfer" || raw === "transfer") {
    return lang === "es" ? "Transferencia" : "Bank Transfer";
  }
  return lang === "es" ? "Manual" : "Manual";
}

function formatStripeDetailText(value) {
  return String(value || "")
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function getStripePaymentSummary(payment) {
  const brand = formatStripeDetailText(payment?.cardBrand);
  const last4 = String(payment?.cardLast4 || "").trim();
  if (brand && last4) return `${brand} •••• ${last4}`;
  if (last4) return `Card •••• ${last4}`;
  const methodType = formatStripeDetailText(payment?.paymentMethodType);
  return methodType || "";
}

function isSafeReceiptUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return false;
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function moneyUSD(value) {
  const amount = roundCurrency(value);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

const PROTECTED_DELETE_PAYMENT_STATUSES = new Set([
  PAYMENT_STATUSES.PAID,
  PAYMENT_STATUSES.PARTIAL,
  PAYMENT_STATUSES.VOID,
]);

function hasSourceEstimateHistory(invoice) {
  if (!invoice || typeof invoice !== "object") return false;
  if (String(invoice?.sourceEstimateId || "").trim()) return true;
  const snapshot = invoice?.sourceEstimateSnapshot;
  if (!snapshot || typeof snapshot !== "object") return false;
  return Boolean(
    String(
      snapshot?.estimateId
      || snapshot?.estimateNumber
      || snapshot?.projectId
      || snapshot?.projectName
      || snapshot?.customerId
      || snapshot?.customerName
      || ""
    ).trim()
  );
}

function hasProjectHistory(invoice) {
  if (!invoice || typeof invoice !== "object") return false;
  const projectId = String(invoice?.projectId || invoice?.project?.id || "").trim();
  if (!projectId) return false;
  return Boolean(
    String(
      invoice?.projectName
      || invoice?.project?.name
      || invoice?.projectNumber
      || invoice?.siteAddress
      || invoice?.job?.location
      || invoice?.customerId
      || invoice?.customerName
      || invoice?.customer?.projectAddress
      || invoice?.customer?.address
      || ""
    ).trim()
  );
}

function canHardDeleteInvoice(invoice) {
  const derivedStatus = deriveInvoiceStatus(invoice);
  const storedStatus = String(invoice?.status || "").trim().toLowerCase();
  const paymentStatus = String(invoice?.paymentStatus || "").trim().toLowerCase();
  const amountPaid = roundCurrency(invoice?.amountPaid || 0);

  if (hasSourceEstimateHistory(invoice) || hasProjectHistory(invoice)) return false;
  if (derivedStatus !== INVOICE_STATUSES.DRAFT) return false;
  if (storedStatus && storedStatus !== INVOICE_STATUSES.DRAFT) return false;
  if (PROTECTED_DELETE_PAYMENT_STATUSES.has(paymentStatus)) return false;
  if (amountPaid > 0) return false;
  return true;
}

function formatDateTime(value) {
  const raw = Number(value || 0) || Date.parse(String(value || ""));
  if (!raw) return "";
  try {
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  } catch {
    return "";
  }
}

function getExistingInvoiceMarginValue(invoice) {
  const candidates = [
    invoice?.margin,
    invoice?.marginPct,
    invoice?.marginPercent,
    invoice?.grossMargin,
    invoice?.grossMarginPct,
    invoice?.grossProfitMargin,
    invoice?.sourceEstimateSnapshot?.margin,
    invoice?.sourceEstimateSnapshot?.marginPct,
    invoice?.sourceEstimateSnapshot?.marginPercent,
    invoice?.sourceEstimateSnapshot?.grossMargin,
    invoice?.sourceEstimateSnapshot?.grossMarginPct,
    invoice?.sourceEstimateSnapshot?.grossProfitMargin,
  ];

  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (!Number.isFinite(numeric)) continue;
    if (numeric >= 0 && numeric <= 1) return numeric * 100;
    if (numeric >= 0 && numeric <= 100) return numeric;
  }

  return null;
}

function formatDateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [yyyy, mm, dd] = raw.split("-");
    return `${mm}/${dd}/${yyyy}`;
  }
  return raw;
}

function canRecordManualPayment(invoice) {
  const derivedStatus = deriveInvoiceStatus(invoice);
  const invoiceTotal = roundCurrency(invoice?.invoiceTotal || 0);
  const amountPaid = roundCurrency(invoice?.amountPaid || 0);
  const balanceRemaining = roundCurrency(Math.max(0, invoiceTotal - amountPaid));
  return (
    derivedStatus !== INVOICE_STATUSES.DRAFT
    && derivedStatus !== INVOICE_STATUSES.VOID
    && derivedStatus !== INVOICE_STATUSES.PAID
    && balanceRemaining > 0
  );
}

function getPaymentActionLabel(invoice, lang) {
  const hasPriorPayment = roundCurrency(invoice?.amountPaid || 0) > 0
    || String(invoice?.paymentStatus || "").trim().toLowerCase() === PAYMENT_STATUSES.PARTIAL;
  if (hasPriorPayment) return lang === "es" ? "Agregar pago" : "Add Payment";
  return lang === "es" ? "Cobrar" : "Take Payment";
}

function getInvoiceCustomerEmail(invoice) {
  return String(
    invoice?.customer?.email
    || invoice?.customerEmail
    || invoice?.email
    || ""
  ).trim();
}

function getStatusConfirmationContent(nextStatus, lang) {
  if (nextStatus === INVOICE_STATUSES.SENT) {
    return {
      title: lang === "es" ? "¿Marcar factura como enviada?" : "Mark invoice as sent?",
      body: lang === "es"
        ? "Esto actualizará el estado de la factura a Enviada."
        : "This will update the invoice status to Sent.",
      confirmLabel: lang === "es" ? "Marcar enviada" : "Mark Sent",
    };
  }

  if (nextStatus === INVOICE_STATUSES.PAID) {
    return {
      title: lang === "es" ? "¿Marcar factura como pagada?" : "Mark invoice as paid?",
      body: lang === "es"
        ? "Esto actualizará el estado de la factura a Pagada."
        : "This will update the invoice status to Paid.",
      confirmLabel: lang === "es" ? "Marcar pagada" : "Mark Paid",
    };
  }

  if (nextStatus === INVOICE_STATUSES.VOID) {
    return {
      title: lang === "es" ? "¿Anular esta factura?" : "Void this invoice?",
      body: lang === "es"
        ? "Esto marcará la factura como Anulada. Debe tratarse como una acción protegida."
        : "This will mark the invoice status to Void. This should be treated as a guarded action.",
      confirmLabel: lang === "es" ? "Anular factura" : "Void Invoice",
    };
  }

  return null;
}

export default function InvoicesScreen({ lang, t, spinTick = 0, onOpenProjectDetail }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [list, setList] = useState(() => readStoredInvoices());
  const [metadataRefreshSeq, setMetadataRefreshSeq] = useState(0);
  const [expanded, setExpanded] = useState(() => ({}));
  const [showListSkeleton, setShowListSkeleton] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [statusConfirmState, setStatusConfirmState] = useState(null);
  const [statusConfirmBusy, setStatusConfirmBusy] = useState(false);
  const [paymentModalState, setPaymentModalState] = useState(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [stripeCheckoutBusyId, setStripeCheckoutBusyId] = useState("");
  const [stripeCopyBusyId, setStripeCopyBusyId] = useState("");
  const [stripeSyncBusyId, setStripeSyncBusyId] = useState("");
  const [stripeAccountId, setStripeAccountId] = useState(() => readCompanyStripeAccountId());
  const [stripeCheckoutSessions, setStripeCheckoutSessions] = useState(() => readStoredStripeCheckoutSessions());
  const [stripeInlineNoticeByInvoice, setStripeInlineNoticeByInvoice] = useState(() => ({}));
  const [paymentForm, setPaymentForm] = useState(() => ({
    amount: "",
    paidAt: todayISO(),
    method: "manual",
    note: "",
  }));
  const prevListCountRef = useRef(0);
  const hasMeasuredListRef = useRef(false);
  const cardActionIntentRef = useRef({ invoiceId: "", action: "", setAt: 0 });
  const stripeReturnNoticeKeyRef = useRef("");

  const [isPhone, setIsPhone] = useState(
    typeof window !== "undefined" ? window.innerWidth < 480 : false
  );
  useEffect(() => {
    const onResize = () => setIsPhone(window.innerWidth < 480);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const invoiceMetricRowStyleLocal = isPhone
    ? { ...invoiceMetricRowStyle, flexWrap: "wrap" }
    : invoiceMetricRowStyle;
  const invoiceMetricColumnStyleLocal = isPhone
    ? { ...invoiceMetricColumnStyle, flex: "1 1 auto" }
    : invoiceMetricColumnStyle;
  const invoiceMetricPillStyleLocal = (highlight) => ({
    ...invoiceMetricPillStyle(highlight),
    padding: isPhone ? "5px 8px" : "6px 12px",
    fontSize: isPhone ? 11.5 : 12.5,
  });

  const labelTotalMetric = lang === "es" ? "TOTAL" : "TOTAL";
  const labelMarginMetric = lang === "es" ? "MARGEN" : "MARGIN";
  const labelRevenue = lang === "es" ? "Ingresos" : "Revenue";
  const labelMargin = lang === "es" ? "Margen" : "Margin";

  useEffect(() => {
    const refresh = () => setList(readStoredInvoices());
    refresh();
    const onStorage = (event) => {
      if (!event?.key || event.key === INVOICES_KEY) refresh();
    };
    const onLocalStorage = (event) => {
      if (!event?.detail?.key || event.detail.key === INVOICES_KEY) refresh();
    };
    const onInvoicesChanged = () => refresh();
    const onFocus = () => refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("estipaid:invoices-changed", onInvoicesChanged);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:invoices-changed", onInvoicesChanged);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  useEffect(() => {
    const refresh = () => setMetadataRefreshSeq((value) => value + 1);
    const onStorage = (event) => {
      if (
        !event?.key
        || event.key === STORAGE_KEYS.PROJECTS
        || event.key === STORAGE_KEYS.CUSTOMERS
      ) {
        refresh();
      }
    };
    const onLocalStorage = (event) => {
      if (
        !event?.detail?.key
        || event.detail.key === STORAGE_KEYS.PROJECTS
        || event.detail.key === STORAGE_KEYS.CUSTOMERS
      ) {
        refresh();
      }
    };
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        refresh();
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("estipaid:customer-use", refresh);
    window.addEventListener("focus", refresh);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:customer-use", refresh);
      window.removeEventListener("focus", refresh);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  useEffect(() => {
    const refreshStripeAccountId = () => setStripeAccountId(readCompanyStripeAccountId());
    const onStorage = (event) => {
      if (!event?.key || event.key === STORAGE_KEYS.COMPANY_PROFILE) refreshStripeAccountId();
    };
    const onLocalStorage = (event) => {
      if (!event?.detail?.key || event.detail.key === STORAGE_KEYS.COMPANY_PROFILE) refreshStripeAccountId();
    };
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        refreshStripeAccountId();
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("focus", refreshStripeAccountId);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("focus", refreshStripeAccountId);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  useEffect(() => {
    const refreshStripeSessions = () => setStripeCheckoutSessions(readStoredStripeCheckoutSessions());
    const onStorage = (event) => {
      if (!event?.key || event.key === STRIPE_CHECKOUT_SESSIONS_KEY) refreshStripeSessions();
    };
    const onLocalStorage = (event) => {
      if (!event?.detail?.key || event.detail.key === STRIPE_CHECKOUT_SESSIONS_KEY) refreshStripeSessions();
    };
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        refreshStripeSessions();
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("focus", refreshStripeSessions);
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("focus", refreshStripeSessions);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowListSkeleton(false), 260);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const prevCount = Number(prevListCountRef.current || 0);
    const nextCount = Number(list?.length || 0);
    if (hasMeasuredListRef.current && nextCount > prevCount) {
      setToastMessage(lang === "es" ? "Factura creada" : "Invoice created");
      setShowToast(true);
    }
    prevListCountRef.current = nextCount;
    hasMeasuredListRef.current = true;
  }, [lang, list]);

  useEffect(() => {
    if (!showToast) return undefined;
    const timer = window.setTimeout(() => setShowToast(false), 1500);
    return () => window.clearTimeout(timer);
  }, [showToast]);

  const invoiceDisplayMeta = useMemo(() => {
    const currentProjects = readStoredProjects();
    const currentCustomers = readCustomers();
    const customerById = new Map(
      currentCustomers
        .filter(Boolean)
        .map((customer) => [String(customer?.id || "").trim(), customer])
        .filter(([id]) => !!id)
    );
    const customerByName = new Map();

    currentCustomers.forEach((customer) => {
      const name = String(
        customer?.name
        || customer?.companyName
        || customer?.fullName
        || ""
      ).trim();
      if (name) customerByName.set(name.toLowerCase(), customer);
    });

    return new Map((Array.isArray(list) ? list : []).map((invoice) => {
      const invoiceId = String(invoice?.id || "").trim();
      const target = resolveProjectNavigationTarget(invoice, currentProjects);
      const project = target?.project || null;
      const projectName = String(
        project?.projectName
        || project?.name
        || invoice?.projectName
        || ""
      ).trim();
      const linkedCustomer = customerById.get(String(project?.customerId || invoice?.customerId || "").trim())
        || customerByName.get(String(project?.customerName || invoice?.customerName || "").trim().toLowerCase())
        || null;
      const customerName = String(
        linkedCustomer?.name
        || linkedCustomer?.companyName
        || linkedCustomer?.fullName
        || project?.customerName
        || invoice?.customerName
        || ""
      ).trim();

      return [invoiceId, { projectName, customerName }];
    }));
  }, [list, metadataRefreshSeq]);

  const filtered = useMemo(() => {
    const search = String(q || "").trim().toLowerCase();
    const filterStatus = String(statusFilter || "all").trim().toLowerCase();
    return (Array.isArray(list) ? list : []).filter((invoice) => {
      const derivedStatus = deriveInvoiceStatus(invoice);
      const displayMeta = invoiceDisplayMeta.get(String(invoice?.id || "").trim()) || {};
      const invoiceNumber = String(invoice?.invoiceNumber || "").toLowerCase();
      const customerName = String(displayMeta.customerName || invoice?.customerName || "").toLowerCase();
      const projectName = String(displayMeta.projectName || invoice?.projectName || "").toLowerCase();
      const estimateNumber = String(invoice?.estimateNumber || "").toLowerCase();
      const searchMatch = !search
        || invoiceNumber.includes(search)
        || customerName.includes(search)
        || projectName.includes(search)
        || estimateNumber.includes(search);
      const statusMatch = filterStatus === "all" || derivedStatus === filterStatus;
      return searchMatch && statusMatch;
    });
  }, [invoiceDisplayMeta, list, q, statusFilter]);

  const clearCardActionIntent = () => {
    cardActionIntentRef.current = {
      invoiceId: "",
      action: "",
      setAt: 0,
    };
  };

  const setCardActionIntent = (invoiceId, action) => {
    cardActionIntentRef.current = {
      invoiceId: String(invoiceId || "").trim(),
      action: String(action || "").trim(),
      setAt: Date.now(),
    };
  };

  const getCardActionIntent = () => {
    const current = cardActionIntentRef.current;
    if (!current?.action) return { invoiceId: "", action: "", setAt: 0 };
    if (Date.now() - Number(current.setAt || 0) > 1200) {
      clearCardActionIntent();
      return { invoiceId: "", action: "", setAt: 0 };
    }
    return current;
  };

  const consumeInvoiceActionEvent = (event, invoiceId, action, { preventDefault = false } = {}) => {
    if (preventDefault && event?.preventDefault) event.preventDefault();
    if (event?.stopPropagation) event.stopPropagation();
    if (event?.nativeEvent?.stopImmediatePropagation) {
      event.nativeEvent.stopImmediatePropagation();
    }
    if (action) {
      setCardActionIntent(invoiceId, action);
    }
  };

  const runInvoiceCardAction = (event, invoiceId, action, handler) => {
    consumeInvoiceActionEvent(event, invoiceId, action, { preventDefault: true });
    const currentIntent = getCardActionIntent();
    const normalizedInvoiceId = String(invoiceId || "").trim();
    if (
      currentIntent.invoiceId === normalizedInvoiceId
      && currentIntent.action
      && currentIntent.action !== action
    ) {
      return;
    }
    handler();
    window.setTimeout(() => {
      const latestIntent = getCardActionIntent();
      if (
        latestIntent.invoiceId === normalizedInvoiceId
        && latestIntent.action === action
      ) {
        clearCardActionIntent();
      }
    }, 0);
  };

  const toggleDetails = (invoiceId) => {
    setExpanded((prev) => {
      const next = {};
      if (!prev[invoiceId]) next[invoiceId] = true;
      return next;
    });
  };

  const openInvoice = (invoice) => {
    const id = String(invoice?.id || "").trim();
    try {
      localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
      localStorage.removeItem(ACTIVE_EDIT_CONTEXT_KEY);
      localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE);
      localStorage.removeItem(STORAGE_KEYS.ESTIMATE_DRAFT);
      localStorage.removeItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE);
      if (id) localStorage.setItem(EDIT_INVOICE_TARGET_KEY, id);
      else localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
    } catch {}
    try {
      window.dispatchEvent(new Event("estipaid:navigate-invoice-builder"));
    } catch {}
  };

  const persistInvoices = (nextInvoices, nextToast = "") => {
    const normalized = writeStoredInvoices(nextInvoices);
    setList(normalized);
    if (nextToast) {
      setToastMessage(nextToast);
      setShowToast(true);
    }
    try {
      window.dispatchEvent(new Event("estipaid:invoices-changed"));
    } catch {}
    return normalized;
  };

  const persistStripeCheckoutSessions = (nextSessions) => {
    const normalized = (Array.isArray(nextSessions) ? nextSessions : [])
      .filter(Boolean)
      .map((entry) => normalizeStripeCheckoutSessionRef(entry))
      .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
    try {
      localStorage.setItem(STRIPE_CHECKOUT_SESSIONS_KEY, JSON.stringify(normalized));
    } catch {}
    setStripeCheckoutSessions(normalized);
    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", {
        detail: {
          key: STRIPE_CHECKOUT_SESSIONS_KEY,
          value: JSON.stringify(normalized),
        },
      }));
    } catch {}
    return normalized;
  };

  const saveStripeCheckoutSessionRef = (sessionRef) => {
    const normalizedEntry = normalizeStripeCheckoutSessionRef(sessionRef);
    const nextSessions = [
      normalizedEntry,
      ...stripeCheckoutSessions.filter((entry) => String(entry?.sessionId || "") !== normalizedEntry.sessionId),
    ];
    return persistStripeCheckoutSessions(nextSessions);
  };

  const updateStripeCheckoutSessionRef = (sessionId, patch = {}) => {
    const targetSessionId = String(sessionId || "").trim();
    if (!targetSessionId) return stripeCheckoutSessions;
    const nextSessions = stripeCheckoutSessions.map((entry) => (
      String(entry?.sessionId || "").trim() === targetSessionId
        ? normalizeStripeCheckoutSessionRef({ ...entry, ...patch })
        : entry
    ));
    return persistStripeCheckoutSessions(nextSessions);
  };

  const setStripeInlineNotice = (invoiceId, tone, message) => {
    const normalizedInvoiceId = String(invoiceId || "").trim();
    if (!normalizedInvoiceId) return;
    setStripeInlineNoticeByInvoice((current) => ({
      ...current,
      [normalizedInvoiceId]: {
        tone: String(tone || "info").trim() || "info",
        message: String(message || "").trim(),
      },
    }));
  };

  const copyCheckoutUrlWithFallback = async (checkoutUrl, customerEmail, options = {}) => {
    const normalizedUrl = String(checkoutUrl || "").trim();
    if (!normalizedUrl) return false;

    let copied = false;
    if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      try {
        await navigator.clipboard.writeText(normalizedUrl);
        copied = true;
      } catch (_clipErr) {
        copied = false;
      }
    }

    if (copied) {
      window.alert(
        (options?.successMessage
          || (lang === "es"
            ? "Enlace de pago copiado al portapapeles. Envíaselo al cliente para que pague.\n\nRecuerda: el enlace expira. Concilia el pago en EstiPaid después de confirmarlo en Stripe."
            : "Payment link copied to clipboard. Send it to your customer to pay.\n\nReminder: Stripe links expire. Reconcile the payment in EstiPaid after Stripe confirms."))
      );
      return true;
    }

    window.alert(
      (options?.fallbackMessage
        || (lang === "es"
          ? "No se pudo copiar automáticamente. Copia este enlace y envíaselo al cliente:\n\n"
          : "Could not copy automatically. Copy this link and send it to your customer:\n\n"))
      + normalizedUrl
      + "\n\n"
      + (lang === "es"
        ? "Recuerda: el enlace expira. Concilia el pago en EstiPaid después de confirmarlo en Stripe."
        : "Reminder: Stripe links expire. Reconcile the payment in EstiPaid after Stripe confirms.")
    );
    return false;
  };

  const getStripeSessionsForInvoice = (invoiceId) => {
    const targetInvoiceId = String(invoiceId || "").trim();
    if (!targetInvoiceId) return [];
    return stripeCheckoutSessions
      .filter((entry) => String(entry?.invoiceId || "").trim() === targetInvoiceId)
      .sort((a, b) => Number(b?.createdAt || 0) - Number(a?.createdAt || 0));
  };

  const getLatestStripeCheckoutSessionForInvoice = (invoiceId) => getStripeSessionsForInvoice(invoiceId)[0] || null;

  const getLatestActionableStripeCheckoutSessionForInvoice = (invoiceOrId) => {
    const invoiceRecord = invoiceOrId && typeof invoiceOrId === "object" ? invoiceOrId : null;
    const targetInvoiceId = String(invoiceRecord?.id || invoiceOrId || "").trim();
    if (!targetInvoiceId) return null;
    return getStripeSessionsForInvoice(targetInvoiceId)
      .find((entry) => getStripeSessionDisplayState(entry, invoiceRecord) !== "synced") || null;
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const searchParams = new URLSearchParams(window.location.search || "");
    const stripeState = String(searchParams.get("stripe") || "").trim().toLowerCase();
    const invoiceId = String(searchParams.get("invoiceId") || "").trim();
    const sessionId = String(searchParams.get("session_id") || "").trim();
    if (!invoiceId || (stripeState !== "success" && stripeState !== "cancel")) return;

    const noticeKey = `${stripeState}:${invoiceId}:${sessionId}`;
    if (stripeReturnNoticeKeyRef.current === noticeKey) return;

    const invoiceExists = (Array.isArray(list) ? list : []).some(
      (entry) => String(entry?.id || "").trim() === invoiceId
    );
    if (!invoiceExists) return;

    stripeReturnNoticeKeyRef.current = noticeKey;
    setExpanded((current) => ({ ...current, [invoiceId]: true }));

    const matchingSession = sessionId
      ? stripeCheckoutSessions.find((entry) => String(entry?.sessionId || "").trim() === sessionId)
      : null;
    const invoiceRecord = (Array.isArray(list) ? list : []).find((entry) => String(entry?.id || "").trim() === invoiceId) || null;
    const invoiceSession = matchingSession || getLatestActionableStripeCheckoutSessionForInvoice(invoiceRecord || invoiceId);

    if (stripeState === "cancel") {
      setStripeInlineNotice(
        invoiceId,
        "info",
        lang === "es"
          ? "Stripe Checkout fue cancelado. Puedes reutilizar el enlace existente o generar uno nuevo cuando quieras."
          : "Stripe Checkout was canceled. You can reuse the existing link or generate a new one when you're ready."
      );
      return;
    }

    if (invoiceSession) {
      setStripeInlineNotice(
        invoiceId,
        "info",
        lang === "es"
          ? "Stripe recibió el pago. Vuelve a esta factura y haz clic en Revisar / sincronizar pago de Stripe para registrarlo en EstiPaid."
          : "Stripe received the payment. Return to this invoice and click Check / Sync Stripe Payment to record it in EstiPaid."
      );
      return;
    }

    setStripeInlineNotice(
      invoiceId,
      "warning",
      lang === "es"
        ? "Stripe recibió el pago, pero este navegador no tiene la referencia local de la sesión. Vuelve a la sesión original de EstiPaid o revisa la factura manualmente antes de sincronizar."
        : "Stripe received the payment, but this browser does not have the local session reference. Return to the original EstiPaid browser session or review the invoice manually before syncing."
    );
  }, [lang, list, stripeCheckoutSessions]);

  const createManualInvoice = () => {
    const currentInvoices = readStoredInvoices();
    const draft = createManualInvoiceDraft(currentInvoices);
    const nextInvoices = persistInvoices(
      [draft, ...currentInvoices],
      lang === "es" ? "Borrador de factura creado" : "Invoice draft created"
    );
    try {
      localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
      localStorage.setItem(EDIT_INVOICE_TARGET_KEY, String(draft.id || ""));
    } catch {}
    setExpanded({});
    setList(nextInvoices);
    try {
      window.dispatchEvent(new Event("estipaid:navigate-invoice-builder"));
    } catch {}
  };

  const removeInvoice = (invoice) => {
    if (!canHardDeleteInvoice(invoice)) {
      window.alert(
        lang === "es"
          ? "Esta factura forma parte del historial financiero del proyecto y no se puede eliminar."
          : "This invoice is part of project/financial history and cannot be deleted."
      );
      return;
    }
    const ok = window.confirm(lang === "es" ? "¿Eliminar esta factura del historial?" : "Delete this invoice from history?");
    if (!ok) return;
    const invoiceId = String(invoice?.id || "").trim();
    const next = list.filter((entry) => String(entry?.id || "").trim() !== invoiceId);
    persistInvoices(next);
    setExpanded((prev) => {
      if (!prev[invoiceId]) return prev;
      const nextExpanded = { ...prev };
      delete nextExpanded[invoiceId];
      return nextExpanded;
    });
  };

  const duplicateInvoice = (invoice) => {
    const currentInvoices = readStoredInvoices();
    const currentEstimates = loadSavedEstimates();
    const duplicated = duplicateInvoiceDraft(invoice, currentInvoices, { estimates: currentEstimates });
    if (!duplicated.ok || !duplicated.draft) {
      window.alert(duplicated?.message || (lang === "es" ? "No se pudo duplicar la factura." : "Unable to duplicate invoice."));
      return;
    }
    persistInvoices(
      [duplicated.draft, ...currentInvoices],
      lang === "es" ? "Factura duplicada" : "Invoice duplicated"
    );
    try {
      localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
      localStorage.setItem(EDIT_INVOICE_TARGET_KEY, String(duplicated.draft.id || ""));
    } catch {}
    setExpanded({});
    try {
      window.dispatchEvent(new Event("estipaid:navigate-invoice-builder"));
    } catch {}
  };

  const updateInvoiceStatus = (invoice, nextStatus) => {
    const currentInvoices = readStoredInvoices();
    const invoiceId = String(invoice?.id || "").trim();
    const nextInvoices = currentInvoices.map((entry) => {
      if (String(entry?.id || "").trim() !== invoiceId) return entry;
      return updateInvoiceLifecycleStatus(entry, nextStatus);
    });
    persistInvoices(nextInvoices);
  };

  const requestInvoiceStatusChange = (invoice, nextStatus) => {
    const content = getStatusConfirmationContent(nextStatus, lang);
    if (!invoice || !content) return;
    setStatusConfirmState({
      invoiceId: String(invoice?.id || "").trim(),
      nextStatus,
      title: content.title,
      body: content.body,
      confirmLabel: content.confirmLabel,
    });
  };

  const closeStatusConfirm = () => {
    if (statusConfirmBusy) return;
    setStatusConfirmState(null);
  };

  const confirmInvoiceStatusChange = () => {
    if (statusConfirmBusy || !statusConfirmState?.invoiceId || !statusConfirmState?.nextStatus) return;
    setStatusConfirmBusy(true);
    try {
      const currentInvoices = readStoredInvoices();
      const targetInvoice = currentInvoices.find(
        (entry) => String(entry?.id || "").trim() === String(statusConfirmState.invoiceId || "").trim()
      );
      if (!targetInvoice) {
        setStatusConfirmState(null);
        return;
      }
      updateInvoiceStatus(targetInvoice, statusConfirmState.nextStatus);
      setStatusConfirmState(null);
    } finally {
      setStatusConfirmBusy(false);
    }
  };

  const openPaymentModal = (invoice) => {
    if (!invoice || !canRecordManualPayment(invoice)) return;
    const balanceRemaining = roundCurrency(Math.max(0, roundCurrency(invoice?.invoiceTotal || 0) - roundCurrency(invoice?.amountPaid || 0)));
    setPaymentError("");
    setPaymentForm({
      amount: balanceRemaining > 0 ? balanceRemaining.toFixed(2) : "",
      paidAt: todayISO(),
      method: "manual",
      note: "",
    });
    setPaymentModalState({
      invoiceId: String(invoice?.id || "").trim(),
      invoiceNumber: String(invoice?.invoiceNumber || "").trim(),
      projectName: String(invoice?.projectName || "").trim(),
      customerName: String(invoice?.customerName || "").trim(),
      balanceRemaining,
    });
  };

  const closePaymentModal = () => {
    setPaymentModalState(null);
    setPaymentError("");
    setPaymentForm({
      amount: "",
      paidAt: todayISO(),
      method: "manual",
      note: "",
    });
  };

  const confirmPayment = () => {
    if (paymentBusy || !paymentModalState?.invoiceId) return;

    const amount = roundCurrency(paymentForm.amount);
    if (amount <= 0) {
      setPaymentError(lang === "es" ? "Ingresa un monto mayor que $0." : "Enter a payment amount greater than $0.");
      return;
    }

    if (amount > roundCurrency(paymentModalState.balanceRemaining)) {
      setPaymentError(lang === "es" ? "El pago no puede exceder el saldo pendiente." : "Payment amount cannot exceed the remaining balance.");
      return;
    }

    setPaymentBusy(true);
    try {
      const currentInvoices = readStoredInvoices();
      const targetInvoice = currentInvoices.find(
        (entry) => String(entry?.id || "").trim() === String(paymentModalState.invoiceId || "").trim()
      );
      if (!targetInvoice) {
        closePaymentModal();
        return;
      }

      const result = addManualInvoicePayment(targetInvoice, {
        amount,
        paidAt: paymentForm.paidAt,
        method: paymentForm.method,
        note: paymentForm.note,
      });

      if (!result?.ok || !result?.invoice) {
        setPaymentError(result?.message || (lang === "es" ? "No se pudo registrar el pago." : "Unable to record payment."));
        return;
      }

      const invoiceId = String(targetInvoice?.id || "").trim();
      const nextInvoices = currentInvoices.map((entry) => (
        String(entry?.id || "").trim() === invoiceId ? result.invoice : entry
      ));
      const fullyPaid = String(result.invoice?.paymentStatus || "").trim().toLowerCase() === PAYMENT_STATUSES.PAID;
      persistInvoices(
        nextInvoices,
        fullyPaid
          ? (lang === "es" ? "Pago final registrado" : "Final payment recorded")
          : (lang === "es" ? "Pago registrado" : "Payment recorded")
      );
      closePaymentModal();
    } finally {
      setPaymentBusy(false);
    }
  };

  const launchStripeCheckout = async (invoice) => {
    const invoiceId = String(invoice?.id || "").trim();
    if (!invoiceId || !canRecordManualPayment(invoice) || !stripeAccountId || stripeCheckoutBusyId === invoiceId) return;

    setStripeCheckoutBusyId(invoiceId);
    try {
      const invoiceTotal = roundCurrency(invoice?.invoiceTotal || 0);
      const amountPaid = roundCurrency(invoice?.amountPaid || 0);
      const balanceRemaining = roundCurrency(Math.max(0, invoiceTotal - amountPaid));
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          invoiceId,
          invoiceNumber: String(invoice?.invoiceNumber || "").trim(),
          customerName: String(invoice?.customerName || "").trim(),
          customerEmail: getInvoiceCustomerEmail(invoice),
          projectName: String(invoice?.projectName || "").trim(),
          stripeAccountId,
          balanceRemaining,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !String(payload?.checkoutUrl || "").trim()) {
        window.alert(payload?.error || (lang === "es" ? "No se pudo generar el enlace de Stripe." : "Unable to generate Stripe checkout."));
        return;
      }

      saveStripeCheckoutSessionRef({
        invoiceId,
        invoiceNumber: String(invoice?.invoiceNumber || "").trim(),
        stripeAccountId,
        sessionId: String(payload?.sessionId || "").trim(),
        checkoutUrl: String(payload?.checkoutUrl || "").trim(),
        amount: balanceRemaining,
        currency: "usd",
        createdAt: Date.now(),
        expiresAt: Number(payload?.expiresAt || 0) || null,
        status: "pending",
      });

      const openedWindow = typeof window !== "undefined" && typeof window.open === "function"
        ? window.open(String(payload.checkoutUrl), "_blank", "noopener,noreferrer")
        : null;
      if (!openedWindow) {
        window.alert(
          lang === "es"
            ? "Stripe se abrió en una pestaña nueva. Si tu navegador la bloqueó, usa \"Copiar enlace de pago\" para abrirla manualmente sin salir de EstiPaid."
            : "Stripe should open in a new tab. If your browser blocked it, use \"Copy Payment Link\" to open it manually without leaving EstiPaid."
        );
      }
    } catch (_error) {
      window.alert(lang === "es" ? "No se pudo generar el enlace de Stripe." : "Unable to generate Stripe checkout.");
    } finally {
      setStripeCheckoutBusyId("");
    }
  };

  const copyStripeLink = async (invoice) => {
    const invoiceId = String(invoice?.id || "").trim();
    if (!invoiceId || !canRecordManualPayment(invoice) || !stripeAccountId || stripeCopyBusyId === invoiceId) return;

    setStripeCopyBusyId(invoiceId);
    try {
      const invoiceTotal = roundCurrency(invoice?.invoiceTotal || 0);
      const amountPaid = roundCurrency(invoice?.amountPaid || 0);
      const balanceRemaining = roundCurrency(Math.max(0, invoiceTotal - amountPaid));
      const response = await fetch("/api/stripe/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          invoiceId,
          invoiceNumber: String(invoice?.invoiceNumber || "").trim(),
          customerName: String(invoice?.customerName || "").trim(),
          customerEmail: getInvoiceCustomerEmail(invoice),
          projectName: String(invoice?.projectName || "").trim(),
          stripeAccountId,
          balanceRemaining,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !String(payload?.checkoutUrl || "").trim()) {
        window.alert(payload?.error || (lang === "es" ? "No se pudo generar el enlace de Stripe." : "Unable to generate Stripe payment link."));
        return;
      }

      const checkoutUrl = String(payload.checkoutUrl);
      saveStripeCheckoutSessionRef({
        invoiceId,
        invoiceNumber: String(invoice?.invoiceNumber || "").trim(),
        stripeAccountId,
        sessionId: String(payload?.sessionId || "").trim(),
        checkoutUrl,
        amount: balanceRemaining,
        currency: "usd",
        createdAt: Date.now(),
        expiresAt: Number(payload?.expiresAt || 0) || null,
        status: "pending",
      });
      await copyCheckoutUrlWithFallback(checkoutUrl, getInvoiceCustomerEmail(invoice));
    } catch (_error) {
      window.alert(lang === "es" ? "No se pudo generar el enlace de Stripe." : "Unable to generate Stripe payment link.");
    } finally {
      setStripeCopyBusyId("");
    }
  };

  const copyExistingStripeLink = async (invoice) => {
    const invoiceId = String(invoice?.id || "").trim();
    const sessionRef = getLatestActionableStripeCheckoutSessionForInvoice(invoice);
    if (!invoiceId || !sessionRef?.checkoutUrl || stripeCopyBusyId === invoiceId) return;

    setStripeCopyBusyId(invoiceId);
    try {
      await copyCheckoutUrlWithFallback(String(sessionRef.checkoutUrl || "").trim(), getInvoiceCustomerEmail(invoice), {
        successMessage: lang === "es"
          ? "Enlace de Stripe existente copiado al portapapeles. Envíaselo al cliente para que pague.\n\nRecuerda: el enlace expira. Concilia el pago en EstiPaid después de confirmarlo en Stripe."
          : "Existing Stripe link copied to clipboard. Send it to your customer to pay.\n\nReminder: Stripe links expire. Reconcile the payment in EstiPaid after Stripe confirms.",
      });
    } finally {
      setStripeCopyBusyId("");
    }
  };

  const syncStripePayment = async (invoice) => {
    const invoiceId = String(invoice?.id || "").trim();
    const sessionRef = getLatestActionableStripeCheckoutSessionForInvoice(invoice);
    if (!invoiceId || !sessionRef || stripeSyncBusyId === invoiceId) return;

    setStripeSyncBusyId(invoiceId);
    try {
      const response = await fetch("/api/stripe/retrieve-checkout-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId: String(sessionRef?.sessionId || "").trim(),
          stripeAccountId: String(sessionRef?.stripeAccountId || "").trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setStripeInlineNotice(
          invoiceId,
          "error",
          payload?.error || (lang === "es" ? "No se pudo revisar el pago de Stripe." : "Unable to check Stripe payment.")
        );
        return;
      }

      const paymentStatus = String(payload?.paymentStatus || "").trim().toLowerCase();
      const sessionStatus = String(payload?.status || "").trim().toLowerCase();
      updateStripeCheckoutSessionRef(sessionRef.sessionId, {
        lastCheckedAt: Date.now(),
      });

      if (paymentStatus !== "paid") {
        if (sessionStatus === "expired") {
          setStripeInlineNotice(
            invoiceId,
            "warning",
            lang === "es" ? "La sesión de Stripe expiró. Genera un enlace nuevo antes de volver a intentar." : "This Stripe session expired. Generate a fresh payment link before trying again."
          );
          return;
        }
        setStripeInlineNotice(
          invoiceId,
          "info",
          lang === "es" ? "El pago de Stripe todavía no se completó. Revisa de nuevo después de que Stripe confirme el cobro." : "This Stripe payment has not completed yet. Check again after Stripe confirms the charge."
        );
        return;
      }

      const currentInvoices = readStoredInvoices();
      const targetInvoice = currentInvoices.find(
        (entry) => String(entry?.id || "").trim() === invoiceId
      );
      if (!targetInvoice) {
        setStripeInlineNotice(invoiceId, "error", lang === "es" ? "No se encontró la factura para sincronizar." : "Unable to find the invoice to sync.");
        return;
      }

      const amount = roundCurrency((Number(payload?.amountTotal || 0) || 0) / 100);
      const result = appendStripeInvoicePayment(targetInvoice, {
        amount,
        paidAt: payload?.paidAt,
        note: "Stripe Checkout",
        stripeSessionId: String(payload?.sessionId || sessionRef?.sessionId || "").trim(),
        stripePaymentIntentId: String(payload?.paymentIntentId || "").trim(),
        stripeAccountId: String(payload?.stripeAccountId || sessionRef?.stripeAccountId || "").trim(),
        paymentMethodType: String(payload?.paymentMethodType || "").trim(),
        cardBrand: String(payload?.cardBrand || "").trim(),
        cardLast4: String(payload?.cardLast4 || "").trim(),
        receiptEmail: String(payload?.receiptEmail || "").trim(),
        receiptUrl: String(payload?.receiptUrl || "").trim(),
        stripePaymentStatus: String(payload?.paymentStatus || "").trim(),
        currency: String(payload?.currency || "").trim(),
      });

      if (!result?.ok || !result?.invoice) {
        if (result?.code === "duplicate_payment_intent" || result?.code === "duplicate_session") {
          updateStripeCheckoutSessionRef(sessionRef.sessionId, {
            status: "synced",
            paymentIntentId: String(payload?.paymentIntentId || "").trim(),
            paidAt: String(payload?.paidAt || "").trim(),
            lastCheckedAt: Date.now(),
          });
          setStripeInlineNotice(invoiceId, "info", lang === "es" ? "Este pago de Stripe ya se registró en EstiPaid." : "This Stripe payment is already recorded in EstiPaid.");
          return;
        }
        if (result?.code === "amount_exceeds_balance") {
          updateStripeCheckoutSessionRef(sessionRef.sessionId, {
            status: "review",
            paymentIntentId: String(payload?.paymentIntentId || "").trim(),
            paidAt: String(payload?.paidAt || "").trim(),
            lastCheckedAt: Date.now(),
          });
          setStripeInlineNotice(
            invoiceId,
            "warning",
            lang === "es" ? "El monto pagado en Stripe supera el saldo actual. Revísalo manualmente antes de registrarlo." : "The Stripe amount exceeds the current remaining balance. Review it manually before recording it."
          );
          return;
        }
        setStripeInlineNotice(invoiceId, "error", result?.message || (lang === "es" ? "No se pudo sincronizar el pago de Stripe." : "Unable to sync Stripe payment."));
        return;
      }

      const nextInvoices = currentInvoices.map((entry) => (
        String(entry?.id || "").trim() === invoiceId ? result.invoice : entry
      ));
      persistInvoices(
        nextInvoices,
        String(result.invoice?.paymentStatus || "").trim().toLowerCase() === PAYMENT_STATUSES.PAID
          ? (lang === "es" ? "Pago de Stripe sincronizado" : "Stripe payment synced")
          : (lang === "es" ? "Pago de Stripe registrado" : "Stripe payment recorded")
      );
      updateStripeCheckoutSessionRef(sessionRef.sessionId, {
        status: "synced",
        paymentIntentId: String(payload?.paymentIntentId || "").trim(),
        paidAt: String(payload?.paidAt || "").trim(),
        lastCheckedAt: Date.now(),
      });
      setStripeInlineNotice(
        invoiceId,
        "success",
        String(result.invoice?.paymentStatus || "").trim().toLowerCase() === PAYMENT_STATUSES.PAID
          ? (lang === "es" ? "Pago de Stripe registrado y factura liquidada." : "Stripe payment recorded and invoice is now paid.")
          : (lang === "es" ? "Pago de Stripe registrado correctamente." : "Stripe payment recorded successfully.")
      );
    } catch (_error) {
      setStripeInlineNotice(invoiceId, "error", lang === "es" ? "No se pudo revisar el pago de Stripe." : "Unable to check Stripe payment.");
    } finally {
      setStripeSyncBusyId("");
    }
  };

  const valueFilter = "all";

  return (
    <section className="pe-section">
      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header pe-utility-panel-header" style={{ ...stickyListHeaderStyle, position: "sticky", minHeight: 56 }}>
          <div className="pe-company-header-title">
            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title={lang === "es" ? "Facturas" : "Invoices"}>
              {lang === "es" ? "Facturas" : "Invoices"}
            </h1>
          </div>
          <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
            <img
              key={spinTick}
              className="esti-spin"
              src="/logo/estipaid.svg"
              alt="EstiPaid"
              style={{ height: 34, width: "auto", display: "block", objectFit: "contain", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.35))" }}
              draggable={false}
            />
          </div>
          <div className="pe-company-header-controls" style={{ display: "flex", gap: 8 }}>
            <button className="pe-btn pe-btn-ghost" type="button" onClick={createManualInvoice}>
              {lang === "es" ? "Nueva factura" : "New Invoice"}
            </button>
          </div>
        </div>

        <div className="pe-grid" style={{ gap: 12 }}>
          <div className="pe-estimates-search" style={filterPanelStyle}>
            <div className="pe-estimates-search-container" style={{ position: "relative", width: "100%" }}>
              <input
                type="text"
                className="pe-input pe-estimates-search-input"
                placeholder={lang === "es" ? "Buscar…" : "Search..."}
                value={q}
                onChange={(event) => setQ(event.target.value)}
                onKeyDown={(evt) => {
                  if (evt.key === "Escape") {
                    evt.preventDefault();
                    setQ("");
                  }
                }}
                style={searchFieldStyle}
              />
              {q ? (
                <button
                  type="button"
                  className="pe-btn pe-btn-ghost"
                  aria-label={lang === "es" ? "Limpiar búsqueda" : "Clear search"}
                  onClick={() => setQ("")}
                  style={{
                    position: "absolute",
                    right: 6,
                    top: "50%",
                    transform: "translateY(-50%)",
                    width: 30,
                    height: 30,
                    minWidth: 30,
                    minHeight: 30,
                    borderRadius: 999,
                    padding: 0,
                    lineHeight: 1,
                    display: "grid",
                    placeItems: "center",
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>

            <div className="pe-estimate-filters" style={filtersRowStyle}>
              <select
                value={statusFilter}
                onChange={(event) => setStatusFilter(event.target.value)}
                style={statusSelectStyle}
              >
                <option value="all">{lang === "es" ? "Todos los estados" : "All Statuses"}</option>
                <option value={INVOICE_STATUSES.DRAFT}>{formatStatusLabel(INVOICE_STATUSES.DRAFT, lang)}</option>
                <option value={INVOICE_STATUSES.SENT}>{formatStatusLabel(INVOICE_STATUSES.SENT, lang)}</option>
                <option value={INVOICE_STATUSES.PAID}>{formatStatusLabel(INVOICE_STATUSES.PAID, lang)}</option>
                <option value={INVOICE_STATUSES.OVERDUE}>{formatStatusLabel(INVOICE_STATUSES.OVERDUE, lang)}</option>
                <option value={INVOICE_STATUSES.VOID}>{formatStatusLabel(INVOICE_STATUSES.VOID, lang)}</option>
              </select>

              <select value={valueFilter} onChange={() => {}} style={valueSelectStyle}>
                <option value="all">{lang === "es" ? "Todos los valores" : "All Values"}</option>
                <option value="small">{lang === "es" ? "Menos de $1k" : "Under $1k"}</option>
                <option value="medium">{lang === "es" ? "$1k-$10k" : "$1k-$10k"}</option>
                <option value="large">{lang === "es" ? "$10k+" : "$10k+"}</option>
              </select>

              <button
                type="button"
                style={clearButtonStyle}
                onClick={() => {
                  setQ("");
                  setStatusFilter("all");
                }}
              >
                {lang === "es" ? "Limpiar" : "Clear"}
              </button>
            </div>
          </div>

          <div className={`ep-section-gap-sm ${showListSkeleton ? "" : "pe-content-fade-in"}`} style={{ display: "grid", gap: 10 }}>
            {showListSkeleton ? (
              <div className="pe-skeleton-stack" aria-hidden="true">
                {[0, 1, 2].map((idx) => (
                  <div key={`invoice-skel-${idx}`} className="pe-skeleton-card">
                    <div className="pe-skeleton-row">
                      <div className="pe-skeleton-col">
                        <div className="pe-skeleton-line w55" />
                        <div className="pe-skeleton-line w85" />
                        <div className="pe-skeleton-line w40" />
                      </div>
                      <div className="pe-skeleton-actions">
                        <div className="pe-skeleton-button" />
                        <div className="pe-skeleton-button" />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : list.length === 0 ? (
              <div style={{ opacity: 0.8, fontSize: 14, textAlign: "center", display: "grid", justifyItems: "center", gap: 6 }}>
                <div style={{ opacity: 0.68 }}>
                  <EmptyInvoiceIcon />
                </div>
                <div>{lang === "es" ? "Aún no hay facturas. Crea una factura manual o desde una estimación aprobada." : "No invoices yet. Create a manual invoice or create one from an approved estimate."}</div>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ opacity: 0.75, textAlign: "center" }}>
                {lang === "es" ? "No hay facturas que coincidan." : "No matching invoices."}
              </div>
            ) : (
              filtered.map((invoice) => {
                const invoiceId = String(invoice?.id || "");
                const isOpen = !!expanded[invoiceId];
                const displayMeta = invoiceDisplayMeta.get(invoiceId) || {};
                const derivedStatus = deriveInvoiceStatus(invoice);
                const invoiceMarginValue = getExistingInvoiceMarginValue(invoice);
                const invoiceTotal = roundCurrency(invoice?.invoiceTotal || 0);
                const amountPaid = roundCurrency(invoice?.amountPaid || 0);
                const balanceRemaining = roundCurrency(invoice?.balanceRemaining ?? (invoiceTotal - amountPaid));
                const paymentLedger = Array.isArray(invoice?.payments)
                  ? [...invoice.payments].filter(Boolean).sort((a, b) => Number(a?.order || 0) - Number(b?.order || 0))
                  : [];
                const canTakePayment = canRecordManualPayment(invoice);
                const canUseStripe = canTakePayment && !!stripeAccountId;
                const latestActionableStripeSession = getLatestActionableStripeCheckoutSessionForInvoice(invoice);
                const latestStripeSession = latestActionableStripeSession || getLatestStripeCheckoutSessionForInvoice(invoiceId);
                const stripeSessionState = latestStripeSession ? getStripeSessionDisplayState(latestStripeSession, invoice) : "";
                const stripeNotice = stripeInlineNoticeByInvoice[invoiceId] || null;
                const canSyncStripeSession = derivedStatus !== INVOICE_STATUSES.VOID
                  && derivedStatus !== INVOICE_STATUSES.PAID
                  && !!latestActionableStripeSession;
                const canCopyExistingStripeLink = !!latestActionableStripeSession?.checkoutUrl
                  && getStripeSessionDisplayState(latestActionableStripeSession, invoice) === "pending";
                const dueDate = formatDateOnly(invoice?.dueDate);
                const siteAddr = String(invoice?.siteAddress || invoice?.job?.address || invoice?.customer?.address || "").trim();
                const projectLabel = displayMeta.projectName || invoice?.projectName || "";
                const customerLabel = displayMeta.customerName || invoice?.customerName || "";
                const statusTone = derivedStatus === INVOICE_STATUSES.PAID
                  ? "rgba(34,197,94,0.14)"
                  : derivedStatus === INVOICE_STATUSES.OVERDUE
                    ? "rgba(248,113,113,0.14)"
                    : derivedStatus === INVOICE_STATUSES.VOID
                      ? "rgba(148,163,184,0.14)"
                      : "rgba(255,255,255,0.06)";

                return (
                  <div
                    className="pe-card pe-card-content ep-glass-tile pe-saved-estimate-card pe-estimate-card"
                    key={invoiceId || invoice?.invoiceNumber || Math.random()}
                    style={{
                      ...invoiceCardStyle,
                      cursor: "default",
                      ...(isOpen
                        ? {
                            border: "1px solid rgba(34,197,94,0.42)",
                            background: "rgba(255,255,255,0.07)",
                            boxShadow: "0 0 0 1px rgba(34,197,94,0.18), 0 10px 22px rgba(0,0,0,0.28)",
                          }
                        : null),
                    }}
                  >
                    <div className="pe-estimate-card-mainrow" style={{ display: "grid", gridTemplateRows: "auto auto auto", rowGap: "8px", width: "100%" }}>
                      <div className="pe-estimate-card-header" style={invoiceCardTopStyle}>
                        <div className="pe-estimate-card-info" style={invoiceHeaderInfoStyle}>
                          <div style={invoicePrimaryLineStyle}>
                            <span className="pe-estimate-card-title" style={invoiceTitleStyle}>
                              {projectLabel || (lang === "es" ? "Sin proyecto" : "No project")}
                            </span>
                          </div>
                          <div className="pe-estimate-card-customer-row" style={invoiceCustomerProjectWrapStyle}>
                            <div className="pe-estimate-card-customer" style={invoiceSecondaryLineStyle}>
                              {customerLabel || (lang === "es" ? "Sin cliente" : "No customer")}
                            </div>
                            {siteAddr ? <div style={{ fontSize: 11.5, opacity: 0.52, lineHeight: 1.2, minWidth: 0 }}>{siteAddr}</div> : null}
                            <div style={invoiceDocLineStyle}>
                              <span className="pe-estimate-card-number">{t("invoiceNumLabel")} {invoice?.invoiceNumber || ""}</span>
                              {invoice?.estimateNumber ? (
                                <span className="pe-estimate-card-number">{"• "}{t("estimateNumLabel")} {invoice.estimateNumber}</span>
                              ) : null}
                            </div>
                          </div>
                          <div className="pe-estimate-card-updated" style={invoiceMetaLineStyle}>
                            <span style={invoiceDateStyle}>{formatDateTime(invoice?.updatedAt || invoice?.createdAt)}</span>
                            {dueDate ? (
                              <span style={{ fontWeight: 700, opacity: 0.82 }}>
                                {derivedStatus === INVOICE_STATUSES.OVERDUE
                                  ? <span style={{ color: "rgba(248,113,113,0.92)" }}>{lang === "es" ? "Venció" : "Due"} {dueDate}</span>
                                  : <span>{lang === "es" ? "Vence" : "Due"} {dueDate}</span>}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div
                          className="pe-estimate-status pe-estimate-card-status"
                          style={{
                            ...invoiceStatusPillBaseStyle,
                            background: statusTone,
                            color: derivedStatus === INVOICE_STATUSES.PAID
                              ? "rgba(187, 247, 208, 0.98)"
                              : derivedStatus === INVOICE_STATUSES.OVERDUE
                                ? "rgba(254, 202, 202, 0.98)"
                                : derivedStatus === INVOICE_STATUSES.VOID
                                  ? "rgba(226, 232, 240, 0.82)"
                                  : "rgba(241, 245, 249, 0.92)",
                            borderColor: derivedStatus === INVOICE_STATUSES.PAID
                              ? "rgba(34, 197, 94, 0.42)"
                              : derivedStatus === INVOICE_STATUSES.OVERDUE
                                ? "rgba(239, 68, 68, 0.42)"
                                : derivedStatus === INVOICE_STATUSES.VOID
                                  ? "rgba(255,255,255,0.16)"
                                  : "rgba(255,255,255,0.16)",
                            flexShrink: 0,
                            whiteSpace: "nowrap",
                          }}
                        >
                          {formatStatusLabel(derivedStatus, lang)}
                        </div>
                      </div>
                      <div className="pe-estimate-card-metrics-wrap" style={invoiceMetricsWrapStyle}>
                        <div className="pe-estimate-card-metrics" style={invoiceMetricRowStyleLocal}>
                          <div style={invoiceMetricColumnStyleLocal}>
                            <div style={invoiceMetricLabelStyle}>{labelTotalMetric}</div>
                            <div style={invoiceMetricPillStyleLocal(true)} title={labelRevenue}>
                              {moneyUSD(invoiceTotal)}
                            </div>
                          </div>
                          {balanceRemaining > 0 ? (
                            <div style={invoiceMetricColumnStyleLocal}>
                              <div style={invoiceMetricLabelStyle}>{lang === "es" ? "SALDO" : "BALANCE"}</div>
                              <div style={invoiceMetricPillStyleLocal(false)} title={lang === "es" ? "Saldo restante" : "Balance remaining"}>
                                {moneyUSD(balanceRemaining)}
                              </div>
                            </div>
                          ) : amountPaid > 0 ? (
                            <div style={invoiceMetricColumnStyleLocal}>
                              <div style={invoiceMetricLabelStyle}>{lang === "es" ? "PAGADO" : "PAID"}</div>
                              <div style={{ ...invoiceMetricPillStyleLocal(false), background: "rgba(34,197,94,0.10)", borderColor: "rgba(34,197,94,0.22)" }} title={lang === "es" ? "Pagado" : "Amount paid"}>
                                {moneyUSD(amountPaid)}
                              </div>
                            </div>
                          ) : null}
                          {invoiceMarginValue !== null ? (
                            <div style={invoiceMetricColumnStyleLocal}>
                              <div style={invoiceMetricLabelStyle}>{labelMarginMetric}</div>
                              <div style={invoiceMetricPillStyleLocal(false)} title={labelMargin}>
                                {invoiceMarginValue.toFixed(1)}%
                              </div>
                            </div>
                          ) : null}
                        </div>
                      </div>
                      <div className="pe-estimate-actions">
                        <div
                          className="actions-right pe-estimate-actions-row"
                          style={{ display: "flex", gap: 10, marginTop: 8, position: "relative", zIndex: 2 }}
                          onClick={(evt) => {
                            if (evt?.stopPropagation) evt.stopPropagation();
                          }}
                        >
                          <button
                            className="pe-btn"
                            type="button"
                            disabled={derivedStatus === INVOICE_STATUSES.VOID}
                            onPointerDown={(evt) => consumeInvoiceActionEvent(evt, invoiceId, "open")}
                            onTouchStart={(evt) => consumeInvoiceActionEvent(evt, invoiceId, "open")}
                            onClick={(evt) => runInvoiceCardAction(evt, invoiceId, "open", () => openInvoice(invoice))}
                          >
                            {lang === "es" ? "Abrir" : "Open"}
                          </button>
                          <button
                            className="pe-btn pe-btn-ghost"
                            type="button"
                            onPointerDown={(evt) => consumeInvoiceActionEvent(evt, invoiceId, "details")}
                            onTouchStart={(evt) => consumeInvoiceActionEvent(evt, invoiceId, "details")}
                            onClick={(evt) => runInvoiceCardAction(evt, invoiceId, "details", () => toggleDetails(invoiceId))}
                          >
                            {isOpen ? (lang === "es" ? "Ocultar" : "Hide") : (lang === "es" ? "Detalles" : "Details")}
                          </button>
                          {onOpenProjectDetail ? (
                            <button
                              className="pe-btn pe-btn-ghost"
                              type="button"
                              onPointerDown={(evt) => consumeInvoiceActionEvent(evt, invoiceId, "project")}
                              onTouchStart={(evt) => consumeInvoiceActionEvent(evt, invoiceId, "project")}
                              onClick={(evt) => runInvoiceCardAction(evt, invoiceId, "project", () => {
                                const currentProjects = readStoredProjects();
                                const target = resolveProjectNavigationTarget(invoice, currentProjects);
                                if (target?.needsBackfill && target?.project) {
                                  const nextProjects = upsertProject(currentProjects, target.project);
                                  writeStoredProjects(nextProjects);
                                  window.dispatchEvent(new Event("estipaid:projects-changed"));
                                }
                                if (target?.projectId) onOpenProjectDetail(target.projectId);
                              })}
                            >
                              Project
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div
                      style={{
                        ...invoiceDetailsWrapStyle,
                        maxHeight: isOpen ? 1200 : 0,
                        opacity: isOpen ? 1 : 0,
                        transform: isOpen ? "translateY(0px)" : "translateY(-4px)",
                        paddingTop: isOpen ? 10 : 0,
                      }}
                      aria-hidden={!isOpen}
                    >
                      <div style={{ display: "grid", gap: 10 }}>
                        <div
                          style={{
                            borderRadius: 12,
                            border: "1px solid rgba(255,255,255,0.10)",
                            background: "rgba(255,255,255,0.04)",
                            padding: 10,
                            display: "grid",
                            gap: 8,
                          }}
                        >
                          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85, letterSpacing: "0.8px" }}>
                            {lang === "es" ? "Resumen" : "Summary"}
                          </div>
                          <div style={{ display: "grid", gap: 6 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <div style={{ fontSize: 12, opacity: 0.72 }}>{lang === "es" ? "Tipo" : "Type"}</div>
                              <div style={{ fontWeight: 800 }}>{String(invoice?.invoiceType || "").toUpperCase() || "MANUAL"}</div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <div style={{ fontSize: 12, opacity: 0.72 }}>{lang === "es" ? "Total" : "Invoice total"}</div>
                              <div style={{ fontWeight: 800 }}>{moneyUSD(invoice?.invoiceTotal)}</div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <div style={{ fontSize: 12, opacity: 0.72 }}>{lang === "es" ? "Pagado" : "Amount paid"}</div>
                              <div style={{ fontWeight: 800 }}>{moneyUSD(invoice?.amountPaid)}</div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <div style={{ fontSize: 12, opacity: 0.72 }}>{lang === "es" ? "Saldo" : "Balance remaining"}</div>
                              <div style={{ fontWeight: 800 }}>{moneyUSD(invoice?.balanceRemaining)}</div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <div style={{ fontSize: 12, opacity: 0.72 }}>{lang === "es" ? "Pago" : "Payment status"}</div>
                              <div style={{ fontWeight: 800 }}>{formatPaymentStatus(invoice?.paymentStatus, lang)}</div>
                            </div>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                              <div style={{ fontSize: 12, opacity: 0.72 }}>{lang === "es" ? "Vence" : "Due date"}</div>
                              <div style={{ fontWeight: 800 }}>{formatDateOnly(invoice?.dueDate) || "—"}</div>
                            </div>
                            {invoice?.sourceEstimateId ? (
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                <div style={{ fontSize: 12, opacity: 0.72 }}>{lang === "es" ? "Estimación padre" : "Parent estimate"}</div>
                                <div style={{ fontWeight: 800 }}>{invoice?.estimateNumber || invoice?.sourceEstimateId}</div>
                              </div>
                            ) : null}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          {canTakePayment ? (
                            <button
                              className="pe-btn"
                              type="button"
                              onClick={() => openPaymentModal(invoice)}
                            >
                              {getPaymentActionLabel(invoice, lang)}
                            </button>
                          ) : null}
                          {canUseStripe ? (
                            <button
                              className="pe-btn pe-btn-ghost"
                              type="button"
                              onClick={() => launchStripeCheckout(invoice)}
                              disabled={stripeCheckoutBusyId === invoiceId}
                            >
                              {stripeCheckoutBusyId === invoiceId
                                ? (lang === "es" ? "Generando Stripe..." : "Generating Stripe...")
                                : (lang === "es" ? "Pagar en línea con Stripe" : "Pay Online with Stripe")}
                            </button>
                          ) : null}
                          {canUseStripe ? (
                            <button
                              className="pe-btn pe-btn-ghost"
                              type="button"
                              onClick={() => copyStripeLink(invoice)}
                              disabled={stripeCopyBusyId === invoiceId}
                            >
                              {stripeCopyBusyId === invoiceId
                                ? (lang === "es" ? "Copiando enlace..." : "Copying link...")
                                : (lang === "es" ? "Copiar enlace de pago" : "Copy Payment Link")}
                            </button>
                          ) : null}
                          {canCopyExistingStripeLink ? (
                            <button
                              className="pe-btn pe-btn-ghost"
                              type="button"
                              onClick={() => copyExistingStripeLink(invoice)}
                              disabled={stripeCopyBusyId === invoiceId}
                            >
                              {stripeCopyBusyId === invoiceId
                                ? (lang === "es" ? "Copiando enlace..." : "Copying link...")
                                : (lang === "es" ? "Copiar enlace de Stripe existente" : "Copy Existing Stripe Link")}
                            </button>
                          ) : null}
                          {canSyncStripeSession ? (
                            <button
                              className="pe-btn pe-btn-ghost"
                              type="button"
                              onClick={() => syncStripePayment(invoice)}
                              disabled={stripeSyncBusyId === invoiceId}
                            >
                              {stripeSyncBusyId === invoiceId
                                ? (lang === "es" ? "Revisando Stripe..." : "Checking Stripe...")
                                : (lang === "es" ? "Revisar / sincronizar pago de Stripe" : "Check / Sync Stripe Payment")}
                            </button>
                          ) : null}
                          <button
                            className="pe-btn pe-btn-ghost"
                            type="button"
                            onClick={() => requestInvoiceStatusChange(invoice, INVOICE_STATUSES.SENT)}
                            disabled={derivedStatus === INVOICE_STATUSES.SENT || derivedStatus === INVOICE_STATUSES.PAID || derivedStatus === INVOICE_STATUSES.VOID}
                          >
                            {lang === "es" ? "Marcar enviada" : "Mark Sent"}
                          </button>
                          <button
                            className="pe-btn pe-btn-ghost"
                            type="button"
                            onClick={() => requestInvoiceStatusChange(invoice, INVOICE_STATUSES.PAID)}
                            disabled={derivedStatus === INVOICE_STATUSES.PAID || derivedStatus === INVOICE_STATUSES.VOID}
                          >
                            {lang === "es" ? "Marcar pagada" : "Mark Paid"}
                          </button>
                          <button
                            className="pe-btn pe-btn-ghost"
                            type="button"
                            onClick={() => requestInvoiceStatusChange(invoice, INVOICE_STATUSES.VOID)}
                            disabled={derivedStatus === INVOICE_STATUSES.VOID}
                          >
                            {lang === "es" ? "Anular" : "Void"}
                          </button>
                          <button className="pe-btn pe-btn-ghost" type="button" onClick={() => duplicateInvoice(invoice)}>
                            {lang === "es" ? "Duplicar" : "Duplicate"}
                          </button>
                          <button className="pe-btn pe-btn-ghost" type="button" onClick={() => removeInvoice(invoice)}>
                            {lang === "es" ? "Eliminar" : "Delete"}
                          </button>
                        </div>
                        {canTakePayment && !canUseStripe ? (
                          <div style={{ fontSize: 11.5, opacity: 0.72, lineHeight: 1.45 }}>
                            {lang === "es"
                              ? "Conecta Stripe en Company Profile para aceptar pagos en línea."
                              : "Connect Stripe in Company Profile to accept online payments."}
                          </div>
                        ) : null}
                        {canUseStripe ? (
                          <div style={{ fontSize: 11.5, opacity: 0.72, lineHeight: 1.45 }}>
                            {lang === "es"
                              ? "Los enlaces de Stripe expiran. Genera uno nuevo si el cliente paga después. Los pagos de Stripe deben conciliarse antes de registrarlos en EstiPaid."
                              : "Stripe links expire. Generate a fresh link if the customer pays later. Payment must still be reconciled in EstiPaid after Stripe confirms."}
                          </div>
                        ) : null}
                        {latestStripeSession ? (
                          <div
                            style={{
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: stripeSessionState === "review"
                                ? "rgba(248,113,113,0.08)"
                                : stripeSessionState === "synced"
                                  ? "rgba(34,197,94,0.08)"
                                  : "rgba(255,255,255,0.04)",
                              padding: 10,
                              display: "grid",
                              gap: 8,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                              <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85, letterSpacing: "0.8px" }}>
                                {lang === "es" ? "Sesión de Stripe" : "Stripe session"}
                              </div>
                              <div style={{
                                fontSize: 11.5,
                                fontWeight: 800,
                                borderRadius: 999,
                                border: "1px solid rgba(255,255,255,0.12)",
                                padding: "3px 9px",
                                background: stripeSessionState === "review"
                                  ? "rgba(248,113,113,0.14)"
                                  : stripeSessionState === "synced"
                                    ? "rgba(34,197,94,0.14)"
                                    : stripeSessionState === "expired"
                                      ? "rgba(250,204,21,0.14)"
                                      : "rgba(59,130,246,0.12)",
                              }}>
                                {stripeSessionState === "review"
                                  ? (lang === "es" ? "Revisión" : "Review")
                                  : stripeSessionState === "synced"
                                    ? (lang === "es" ? "Sincronizada" : "Synced")
                                    : stripeSessionState === "expired"
                                      ? (lang === "es" ? "Expirada" : "Expired")
                                      : (lang === "es" ? "Pendiente" : "Pending")}
                              </div>
                            </div>
                            <div style={{ display: "grid", gap: 6, fontSize: 12.5 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                <div style={{ opacity: 0.72 }}>{lang === "es" ? "Monto" : "Amount"}</div>
                                <div style={{ fontWeight: 800 }}>{moneyUSD(latestStripeSession.amount)}</div>
                              </div>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                <div style={{ opacity: 0.72 }}>{lang === "es" ? "Creada" : "Created"}</div>
                                <div style={{ fontWeight: 700 }}>{formatDateTime(latestStripeSession.createdAt) || "—"}</div>
                              </div>
                              {latestStripeSession.expiresAt ? (
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                                  <div style={{ opacity: 0.72 }}>{lang === "es" ? "Expira" : "Expires"}</div>
                                  <div style={{ fontWeight: 700 }}>{formatDateTime(Number(latestStripeSession.expiresAt || 0) * 1000) || "—"}</div>
                                </div>
                              ) : null}
                            </div>
                            <div style={{ fontSize: 11.5, opacity: 0.78, lineHeight: 1.45 }}>
                              {stripeSessionState === "review"
                                ? (lang === "es"
                                  ? "Stripe reportó un pago que no se pudo registrar automáticamente. Revísalo manualmente antes de agregarlo."
                                  : "Stripe reported a payment that could not be safely recorded automatically. Review it manually before adding it.")
                                : stripeSessionState === "synced"
                                  ? (lang === "es"
                                    ? "Este pago de Stripe ya se registró en EstiPaid."
                                    : "This Stripe payment has already been recorded in EstiPaid.")
                                  : stripeSessionState === "expired"
                                    ? (lang === "es"
                                      ? "Este enlace de Stripe expiró. Genera un enlace nuevo si el cliente todavía necesita pagar."
                                      : "This Stripe link expired. Generate a fresh link if the customer still needs to pay.")
                                    : (lang === "es"
                                      ? "Pendiente significa que se generó un enlace de Stripe, pero el pago todavía no se registró en EstiPaid."
                                      : "Pending means a Stripe link was generated, but the payment has not been recorded in EstiPaid yet.")}
                            </div>
                          </div>
                        ) : null}
                        {canSyncStripeSession ? (
                          <div style={{ fontSize: 11.5, opacity: 0.72, lineHeight: 1.45 }}>
                            {lang === "es"
                              ? "Usa Revisar / sincronizar pago de Stripe después de confirmar el cobro en Stripe para registrar el pago de forma segura."
                              : "Use Check / Sync Stripe Payment after Stripe confirms the charge to record it safely in EstiPaid."}
                          </div>
                        ) : null}
                        {stripeNotice?.message ? (
                          <div
                            role="status"
                            aria-live="polite"
                            style={{
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: stripeNotice?.tone === "error"
                                ? "rgba(248,113,113,0.10)"
                                : stripeNotice?.tone === "warning"
                                  ? "rgba(250,204,21,0.10)"
                                  : stripeNotice?.tone === "success"
                                    ? "rgba(34,197,94,0.10)"
                                    : "rgba(59,130,246,0.08)",
                              padding: "9px 10px",
                              fontSize: 12.5,
                              lineHeight: 1.45,
                            }}
                          >
                            {stripeNotice.message}
                          </div>
                        ) : null}
                        {paymentLedger.length ? (
                          <div
                            style={{
                              borderRadius: 12,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(255,255,255,0.04)",
                              padding: 10,
                              display: "grid",
                              gap: 8,
                            }}
                          >
                            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85, letterSpacing: "0.8px" }}>
                              {lang === "es" ? "Pagos" : "Payments"}
                            </div>
                            <div style={{ display: "grid", gap: 8 }}>
                              {paymentLedger.map((payment) => (
                                (() => {
                                  const isStripePayment = String(payment?.method || "").trim().toLowerCase() === "stripe";
                                  const stripeSummary = isStripePayment ? getStripePaymentSummary(payment) : "";
                                  const receiptEmail = isStripePayment ? String(payment?.receiptEmail || "").trim() : "";
                                  const receiptUrl = isStripePayment && isSafeReceiptUrl(payment?.receiptUrl)
                                    ? String(payment?.receiptUrl || "").trim()
                                    : "";

                                  return (
                                    <div
                                      key={String(payment?.id || `${payment?.paidAt || ""}_${payment?.amount || ""}`)}
                                      style={{
                                        display: "grid",
                                        gap: 4,
                                        borderRadius: 10,
                                        border: "1px solid rgba(255,255,255,0.08)",
                                        background: "rgba(255,255,255,0.03)",
                                        padding: "8px 10px",
                                      }}
                                    >
                                      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "baseline", flexWrap: "wrap" }}>
                                        <div style={{ fontWeight: 800 }}>{moneyUSD(payment?.amount)}</div>
                                        <div style={{ fontSize: 12, opacity: 0.76, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                          <span>{formatDateOnly(payment?.paidAt) || "—"}</span>
                                          {isStripePayment ? (
                                            <span style={{
                                              borderRadius: 999,
                                              border: "1px solid rgba(59,130,246,0.18)",
                                              background: "rgba(59,130,246,0.10)",
                                              padding: "2px 8px",
                                              fontSize: 11,
                                              fontWeight: 800,
                                              letterSpacing: "0.3px",
                                            }}>
                                              Stripe
                                            </span>
                                          ) : (
                                            <span>{formatPaymentMethod(payment?.method, lang)}</span>
                                          )}
                                        </div>
                                      </div>
                                      {payment?.note ? (
                                        <div style={{ fontSize: 12.5, opacity: 0.84 }}>
                                          {payment.note}
                                        </div>
                                      ) : null}
                                      {isStripePayment && stripeSummary ? (
                                        <div style={{ fontSize: 12, opacity: 0.76 }}>
                                          {stripeSummary}
                                        </div>
                                      ) : null}
                                      {isStripePayment && receiptEmail ? (
                                        <div style={{ fontSize: 12, opacity: 0.76 }}>
                                          {receiptEmail}
                                        </div>
                                      ) : null}
                                      {receiptUrl ? (
                                        <a
                                          href={receiptUrl}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          style={{ fontSize: 12, fontWeight: 700, color: "#93c5fd", textDecoration: "none" }}
                                        >
                                          {lang === "es" ? "Ver recibo de Stripe" : "View Stripe receipt"}
                                        </a>
                                      ) : null}
                                    </div>
                                  );
                                })()
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
      {paymentModalState ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lang === "es" ? "Registrar pago" : "Record payment"}
          onClick={closePaymentModal}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2100,
            background: "rgba(4,8,14,0.58)",
            backdropFilter: "blur(3px)",
            WebkitBackdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 12,
          }}
        >
          <div
            className="pe-card pe-card-content"
            onClick={(evt) => evt.stopPropagation()}
            style={{
              width: "min(520px, 96vw)",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "linear-gradient(180deg, rgba(20,28,42,0.94), rgba(7,11,18,0.92))",
              boxShadow: "0 20px 54px rgba(0,0,0,0.45)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              padding: 16,
              color: "rgba(245,248,252,0.98)",
              display: "grid",
              gap: 12,
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "0.2px" }}>
                {lang === "es" ? "Registrar pago" : "Record payment"}
              </div>
              <div style={{ fontSize: 13, opacity: 0.82 }}>
                {[paymentModalState.projectName, paymentModalState.customerName, paymentModalState.invoiceNumber]
                  .filter(Boolean)
                  .join(" • ")}
              </div>
            </div>
            <div style={{ fontSize: 14, opacity: 0.92 }}>
              {lang === "es" ? "Saldo pendiente" : "Remaining balance"}: <strong>{moneyUSD(paymentModalState.balanceRemaining)}</strong>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.84 }}>{lang === "es" ? "Monto" : "Amount"}</div>
                <input
                  type="text"
                  inputMode="decimal"
                  aria-label={lang === "es" ? "Monto del pago" : "Payment amount"}
                  className="pe-input"
                  value={paymentForm.amount}
                  onChange={(event) => {
                    setPaymentError("");
                    setPaymentForm((current) => ({ ...current, amount: event.target.value }));
                  }}
                  placeholder="0.00"
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.84 }}>{lang === "es" ? "Fecha de pago" : "Paid date"}</div>
                <input
                  type="date"
                  aria-label={lang === "es" ? "Fecha de pago" : "Paid date"}
                  className="pe-input"
                  value={paymentForm.paidAt}
                  onChange={(event) => {
                    setPaymentError("");
                    setPaymentForm((current) => ({ ...current, paidAt: event.target.value }));
                  }}
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.84 }}>{lang === "es" ? "Método" : "Method"}</div>
                <select
                  aria-label={lang === "es" ? "Método de pago" : "Payment method"}
                  className="pe-select"
                  value={paymentForm.method}
                  onChange={(event) => {
                    setPaymentError("");
                    setPaymentForm((current) => ({ ...current, method: event.target.value }));
                  }}
                >
                  {PAYMENT_METHOD_OPTIONS.map((method) => (
                    <option key={method} value={method}>
                      {formatPaymentMethod(method, lang)}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.84 }}>{lang === "es" ? "Nota (opcional)" : "Note (optional)"}</div>
                <textarea
                  aria-label={lang === "es" ? "Nota del pago" : "Payment note"}
                  className="pe-input"
                  value={paymentForm.note}
                  onChange={(event) => {
                    setPaymentError("");
                    setPaymentForm((current) => ({ ...current, note: event.target.value }));
                  }}
                  rows={3}
                  placeholder={lang === "es" ? "Detalles del pago" : "Payment details"}
                  style={{ resize: "vertical", minHeight: 88 }}
                />
              </div>
            </div>
            {paymentError ? (
              <div style={{ color: "rgba(252,165,165,0.98)", fontSize: 13, fontWeight: 700 }}>
                {paymentError}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 4 }}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={closePaymentModal}
                disabled={paymentBusy}
              >
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={confirmPayment}
                disabled={paymentBusy}
              >
                {paymentBusy
                  ? (lang === "es" ? "Guardando..." : "Saving...")
                  : (lang === "es" ? "Registrar pago" : "Record payment")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {statusConfirmState ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={statusConfirmState.title}
          onClick={closeStatusConfirm}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 2100,
            background: "rgba(4,8,14,0.58)",
            backdropFilter: "blur(3px)",
            WebkitBackdropFilter: "blur(3px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 12,
          }}
        >
          <div
            className="pe-card pe-card-content"
            onClick={(evt) => evt.stopPropagation()}
            style={{
              width: "min(520px, 96vw)",
              borderRadius: 16,
              border: "1px solid rgba(255,255,255,0.16)",
              background: "linear-gradient(180deg, rgba(20,28,42,0.94), rgba(7,11,18,0.92))",
              boxShadow: "0 20px 54px rgba(0,0,0,0.45)",
              backdropFilter: "blur(12px)",
              WebkitBackdropFilter: "blur(12px)",
              padding: 16,
              color: "rgba(245,248,252,0.98)",
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 20, fontWeight: 900, letterSpacing: "0.2px" }}>
              {statusConfirmState.title}
            </div>
            <div style={{ fontSize: 14, opacity: 0.9 }}>
              {statusConfirmState.body}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 4 }}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={closeStatusConfirm}
                disabled={statusConfirmBusy}
              >
                {lang === "es" ? "Cancelar" : "Cancel"}
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={confirmInvoiceStatusChange}
                disabled={statusConfirmBusy}
              >
                {statusConfirmBusy
                  ? (lang === "es" ? "Actualizando..." : "Updating...")
                  : statusConfirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {showToast ? (
        <div className="pe-toast" role="status" aria-live="polite">{toastMessage}</div>
      ) : null}
    </section>
  );
}
