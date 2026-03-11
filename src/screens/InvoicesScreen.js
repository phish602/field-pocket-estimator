// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from "react";
import Field from "../components/Field";
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
  background: "linear-gradient(180deg, rgba(8,18,28,0.9), rgba(8,18,28,0.62))",
  backdropFilter: "blur(8px)",
  WebkitBackdropFilter: "blur(8px)",
  borderBottom: "1px solid rgba(255,255,255,0.08)",
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

function formatDateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [yyyy, mm, dd] = raw.split("-");
    return `${mm}/${dd}/${yyyy}`;
  }
  return raw;
}

export default function InvoicesScreen({ lang, t, onDone, spinTick = 0 }) {
  const [q, setQ] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [list, setList] = useState(() => readStoredInvoices());
  const [expanded, setExpanded] = useState(() => ({}));
  const [showListSkeleton, setShowListSkeleton] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const prevListCountRef = useRef(0);
  const hasMeasuredListRef = useRef(false);

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

  return (
    <section className="pe-section">
      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header" style={{ ...stickyListHeaderStyle, position: "sticky", minHeight: 56 }}>
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
            <button className="pe-btn" type="button" onClick={onDone}>
              {lang === "es" ? "Volver" : "Back"}
            </button>
          </div>
        </div>

        <div className="pe-grid" style={{ gap: 10 }}>
          <Field
            placeholder={lang === "es" ? "Buscar…" : "Search…"}
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">{lang === "es" ? "Todos los estados" : "All Statuses"}</option>
              <option value={INVOICE_STATUSES.DRAFT}>{formatStatusLabel(INVOICE_STATUSES.DRAFT, lang)}</option>
              <option value={INVOICE_STATUSES.SENT}>{formatStatusLabel(INVOICE_STATUSES.SENT, lang)}</option>
              <option value={INVOICE_STATUSES.PAID}>{formatStatusLabel(INVOICE_STATUSES.PAID, lang)}</option>
              <option value={INVOICE_STATUSES.OVERDUE}>{formatStatusLabel(INVOICE_STATUSES.OVERDUE, lang)}</option>
              <option value={INVOICE_STATUSES.VOID}>{formatStatusLabel(INVOICE_STATUSES.VOID, lang)}</option>
            </select>

            <button
              className="pe-btn pe-btn-ghost"
              type="button"
              onClick={() => {
                setQ("");
                setStatusFilter("all");
              }}
            >
              {lang === "es" ? "Limpiar" : "Clear"}
            </button>
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
                const statusTone = derivedStatus === INVOICE_STATUSES.PAID
                  ? "rgba(34,197,94,0.14)"
                  : derivedStatus === INVOICE_STATUSES.OVERDUE
                    ? "rgba(248,113,113,0.14)"
                    : derivedStatus === INVOICE_STATUSES.VOID
                      ? "rgba(148,163,184,0.14)"
                      : "rgba(255,255,255,0.08)";

                return (
                  <div
                    className="pe-card pe-card-content ep-glass-tile"
                    key={invoiceId || invoice?.invoiceNumber || Math.random()}
                    style={{
                      padding: 12,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
                      <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
                        <div style={{ fontWeight: 800, display: "flex", flexWrap: "wrap", gap: 6 }}>
                          <span>{t("invoiceNumLabel")} {invoice?.invoiceNumber || ""}</span>
                          {invoice?.estimateNumber ? (
                            <span style={{ opacity: 0.7 }}>
                              • {t("estimateNumLabel")} {invoice.estimateNumber}
                            </span>
                          ) : null}
                        </div>
                        <div style={{ fontSize: 13, opacity: 0.85 }}>
                          {invoice?.customerName || (lang === "es" ? "Sin cliente" : "No customer")}
                          {invoice?.projectName ? ` • ${invoice.projectName}` : ""}
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7 }}>
                          {formatDateTime(invoice?.updatedAt || invoice?.createdAt)} • {moneyUSD(invoice?.invoiceTotal)}
                        </div>
                      </div>

                      <div
                        style={{
                          padding: "6px 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(255,255,255,0.12)",
                          background: statusTone,
                          fontSize: 12,
                          fontWeight: 800,
                          whiteSpace: "nowrap",
                        }}
                      >
                        {formatStatusLabel(derivedStatus, lang)}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button className="pe-btn" type="button" onClick={() => openInvoice(invoice)}>
                        {lang === "es" ? "Abrir" : "Open"}
                      </button>
                      <button className="pe-btn pe-btn-ghost" type="button" onClick={() => toggleDetails(invoiceId)}>
                        {isOpen ? (lang === "es" ? "Ocultar" : "Hide") : (lang === "es" ? "Detalles" : "Details")}
                      </button>
                    </div>

                    <div
                      style={{
                        overflow: "hidden",
                        maxHeight: isOpen ? 1200 : 0,
                        opacity: isOpen ? 1 : 0,
                        transform: isOpen ? "translateY(0px)" : "translateY(-4px)",
                        transition: "max-height 320ms ease, opacity 220ms ease, transform 220ms ease",
                        borderTop: "1px solid rgba(255,255,255,0.10)",
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
                            onClick={() => updateInvoiceStatus(invoice, INVOICE_STATUSES.SENT)}
                            disabled={derivedStatus === INVOICE_STATUSES.SENT || derivedStatus === INVOICE_STATUSES.PAID || derivedStatus === INVOICE_STATUSES.VOID}
                          >
                            {lang === "es" ? "Marcar enviada" : "Mark Sent"}
                          </button>
                          <button
                            className="pe-btn pe-btn-ghost"
                            type="button"
                            onClick={() => updateInvoiceStatus(invoice, INVOICE_STATUSES.PAID)}
                            disabled={derivedStatus === INVOICE_STATUSES.PAID || derivedStatus === INVOICE_STATUSES.VOID}
                          >
                            {lang === "es" ? "Marcar pagada" : "Mark Paid"}
                          </button>
                          <button
                            className="pe-btn pe-btn-ghost"
                            type="button"
                            onClick={() => updateInvoiceStatus(invoice, INVOICE_STATUSES.VOID)}
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
      {showToast ? (
        <div className="pe-toast" role="status" aria-live="polite">{toastMessage}</div>
      ) : null}
    </section>
  );
}
