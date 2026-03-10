// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from "react";
import Field from "../components/Field";
import { STORAGE_KEYS } from "../constants/storageKeys";

const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";

function loadSavedInvoices() {
  try {
    const raw = localStorage.getItem(INVOICES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(Boolean);
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

export default function InvoicesScreen({lang, t, onDone, spinTick = 0 }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState(() => loadSavedInvoices());
  const [showListSkeleton, setShowListSkeleton] = useState(true);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const prevListCountRef = useRef(0);
  const hasMeasuredListRef = useRef(false);

  useEffect(() => {
    const refresh = () => setList(loadSavedInvoices());
    refresh();
    const onStorage = (e) => {
      if (!e || e.key === INVOICES_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowListSkeleton(false), 260);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const prevCount = Number(prevListCountRef.current || 0);
    const nextCount = Number(list?.length || 0);
    if (hasMeasuredListRef.current && nextCount > prevCount) {
      setToastMessage("Invoice created");
      setShowToast(true);
    }
    prevListCountRef.current = nextCount;
    hasMeasuredListRef.current = true;
  }, [list]);

  useEffect(() => {
    if (!showToast) return undefined;
    const timer = window.setTimeout(() => setShowToast(false), 1500);
    return () => window.clearTimeout(timer);
  }, [showToast]);

  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return list;
    return list.filter((x) => {
      const inv = String(x?.invoiceNumber || "").toLowerCase();
      const cn = String(x?.customerName || "").toLowerCase();
      const pn = String(x?.projectName || "").toLowerCase();
      const en = String(x?.estimateNumber || "").toLowerCase();
      return inv.includes(s) || cn.includes(s) || pn.includes(s) || en.includes(s);
    });
  }, [list, q]);

  const fmtMoney = (n) => {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(n) || 0);
    } catch {
      return String(n || "");
    }
  };

  const fmtDate = (ts) => {
    try {
      const d = new Date(Number(ts));
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString();
    } catch {
      return "";
    }
  };

  const remove = (invoiceNumber) => {
    const ok = window.confirm(lang === "es" ? "¿Eliminar esta factura del historial?" : "Delete this invoice from history?");
    if (!ok) return;
    const next = list.filter((x) => String(x?.invoiceNumber || "") !== String(invoiceNumber || ""));
    setList(next);
    try {
      localStorage.setItem(INVOICES_KEY, JSON.stringify(next));
    } catch {}
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

  return (
    <section className="pe-section">
      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header" style={{ ...stickyListHeaderStyle, position: "sticky", minHeight: 56 }}>
          <div className="pe-company-header-title">
            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title={lang === "es" ? "Facturas" : "Invoices"}>{lang === "es" ? "Facturas" : "Invoices"}</h1>
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
          <div className="pe-company-header-controls">
            <button className="pe-btn" onClick={onDone}>
              {lang === "es" ? "Volver" : "Back"}
            </button>
          </div>
        </div>

        <div className="pe-grid" style={{ gap: 10 }}>
          <Field
            placeholder={lang === "es" ? "Buscar…" : "Search…"}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />

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
                <div>No invoices yet. Convert an estimate to generate an invoice.</div>
              </div>
            ) : (
              filtered.map((x) => (
                <div
                  className="pe-card pe-card-content ep-glass-tile"
                  key={String(x?.id || x?.invoiceNumber || Math.random())}
                  style={{
                    padding: 12,
                    display: "grid",
                    gap: 8,
                  }}
                  role="button"
                  tabIndex={0}
                  onClick={() => openInvoice(x)}
                  onKeyDown={(evt) => {
                    if (evt.key === "Enter" || evt.key === " ") {
                      evt.preventDefault();
                      openInvoice(x);
                    }
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div style={{ display: "grid", gap: 2 }}>
                      <div style={{ fontWeight: 800 }}>
                        {t("invoiceNumLabel")} {x?.invoiceNumber || ""}
                        {x?.estimateNumber ? ` • ${t("estimateNumLabel")} ${x.estimateNumber}` : ""}
                      </div>
                      <div style={{ fontSize: 13, opacity: 0.85 }}>
                        {x?.customerName || (lang === "es" ? "Sin cliente" : "No customer")}
                        {x?.projectName ? ` • ${x.projectName}` : ""}
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.7 }}>
                        {fmtDate(x?.updatedAt || x?.createdAt)} • {fmtMoney(x?.total)}
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <button className="pe-btn pe-btn-ghost" onClick={(evt) => { evt.stopPropagation(); remove(x?.invoiceNumber); }}>
                        {lang === "es" ? "Eliminar" : "Delete"}
                      </button>
                    </div>
                  </div>
                </div>
              ))
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
