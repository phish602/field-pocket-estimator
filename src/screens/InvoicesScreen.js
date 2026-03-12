// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  INVOICE_STATUSES,
  PAYMENT_STATUSES,
  createManualInvoiceDraft,
  deriveInvoiceStatus,
  duplicateInvoiceDraft,
  readStoredInvoices,
  roundCurrency,
  updateInvoiceLifecycleStatus,
  writeStoredInvoices,
} from "../utils/invoices";

const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";

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
  padding: 16,
  borderRadius: 16,
  border: "1px solid rgba(255,255,255,0.12)",
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
  gap: 3,
  minWidth: 0,
};

const invoiceTitleStyle = {
  fontSize: 15.5,
  lineHeight: 1.28,
  fontWeight: 700,
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

const invoiceSecondaryLineStyle = {
  fontSize: 13,
  lineHeight: 1.32,
  fontWeight: 500,
  color: "rgba(226,232,240,0.78)",
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
  justifyContent: "flex-end",
  minWidth: 0,
};

const invoiceMetricRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "nowrap",
  columnGap: 12,
  gap: "8px",
  minWidth: 0,
};

const invoiceMetricLabelStyle = {
  fontSize: 10.5,
  fontWeight: 900,
  opacity: 0.82,
  letterSpacing: "1px",
  textTransform: "uppercase",
  textAlign: "center",
  lineHeight: 1.1,
};

const invoiceMetricColumnStyle = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 4,
};

const invoiceMetricPillStyle = (highlight) => ({
  padding: "6px 10px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  background: highlight ? "rgba(34,197,94,0.10)" : "rgba(255,255,255,0.06)",
  boxShadow: "inset 0 1px 2px rgba(255,255,255,0.05), 0 4px 10px rgba(0,0,0,0.35)",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.3px",
  flexShrink: 0,
  whiteSpace: "nowrap",
  color: "rgba(245,248,252,0.96)",
});

const invoiceHeaderInfoStyle = {
  display: "grid",
  gap: 6,
  minWidth: 0,
  flex: "1 1 0",
};

const invoiceCustomerProjectWrapStyle = {
  display: "grid",
  gap: 2,
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

function moneyUSD(value) {
  const amount = roundCurrency(value);
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
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

export default function InvoicesScreen({ lang, t, spinTick = 0 }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [list, setList] = useState(() => readStoredInvoices());
  const [expanded, setExpanded] = useState(() => ({}));
  const [showListSkeleton, setShowListSkeleton] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [statusConfirmState, setStatusConfirmState] = useState(null);
  const [statusConfirmBusy, setStatusConfirmBusy] = useState(false);
  const prevListCountRef = useRef(0);
  const hasMeasuredListRef = useRef(false);
  const cardActionIntentRef = useRef({ invoiceId: "", action: "", setAt: 0 });
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
    const onInvoicesChanged = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("estipaid:invoices-changed", onInvoicesChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("estipaid:invoices-changed", onInvoicesChanged);
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

  const filtered = useMemo(() => {
    const search = String(q || "").trim().toLowerCase();
    const filterStatus = String(statusFilter || "all").trim().toLowerCase();
    return (Array.isArray(list) ? list : []).filter((invoice) => {
      const derivedStatus = deriveInvoiceStatus(invoice);
      const invoiceNumber = String(invoice?.invoiceNumber || "").toLowerCase();
      const customerName = String(invoice?.customerName || "").toLowerCase();
      const projectName = String(invoice?.projectName || "").toLowerCase();
      const estimateNumber = String(invoice?.estimateNumber || "").toLowerCase();
      const searchMatch = !search
        || invoiceNumber.includes(search)
        || customerName.includes(search)
        || projectName.includes(search)
        || estimateNumber.includes(search);
      const statusMatch = filterStatus === "all" || derivedStatus === filterStatus;
      return searchMatch && statusMatch;
    });
  }, [list, q, statusFilter]);

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

  const createManualInvoice = () => {
    const currentInvoices = readStoredInvoices();
    const draft = createManualInvoiceDraft(currentInvoices);
    const nextInvoices = persistInvoices(
      [draft, ...currentInvoices],
      lang === "es" ? "Borrador de factura creado" : "Invoice draft created"
    );
    try {
      localStorage.setItem(EDIT_INVOICE_TARGET_KEY, String(draft.id || ""));
    } catch {}
    setExpanded({});
    setList(nextInvoices);
    try {
      window.dispatchEvent(new Event("estipaid:navigate-invoice-builder"));
    } catch {}
  };

  const removeInvoice = (invoice) => {
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
                const derivedStatus = deriveInvoiceStatus(invoice);
                const invoiceMarginValue = getExistingInvoiceMarginValue(invoice);
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
                            <span className="pe-estimate-card-title" style={invoiceTitleStyle}>{t("invoiceNumLabel")} {invoice?.invoiceNumber || ""}</span>
                            {invoice?.estimateNumber ? (
                              <span className="pe-estimate-card-number" style={invoiceEstimateNumberStyle}>
                                {t("estimateNumLabel")} {invoice.estimateNumber}
                              </span>
                            ) : null}
                          </div>
                          <div className="pe-estimate-card-customer-row" style={invoiceCustomerProjectWrapStyle}>
                            <div className="pe-estimate-card-customer" style={invoiceSecondaryLineStyle}>
                              {invoice?.customerName || (lang === "es" ? "Sin cliente" : "No customer")}
                            </div>
                            {invoice?.projectName ? (
                              <div style={invoiceProjectLineStyle}>{invoice.projectName}</div>
                            ) : null}
                          </div>
                          <div className="pe-estimate-card-updated" style={invoiceMetaLineStyle}>
                            <span style={invoiceDateStyle}>{formatDateTime(invoice?.updatedAt || invoice?.createdAt)}</span>
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
                        <div className="pe-estimate-card-metrics" style={invoiceMetricRowStyle}>
                          <div style={invoiceMetricColumnStyle}>
                            <div style={invoiceMetricLabelStyle}>{labelTotalMetric}</div>
                            <div style={invoiceMetricPillStyle(true)} title={labelRevenue}>
                              {moneyUSD(invoice?.invoiceTotal)}
                            </div>
                          </div>
                          {invoiceMarginValue !== null ? (
                            <div style={invoiceMetricColumnStyle}>
                              <div style={invoiceMetricLabelStyle}>{labelMarginMetric}</div>
                              <div style={invoiceMetricPillStyle(false)} title={labelMargin}>
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
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
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
