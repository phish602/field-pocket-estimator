// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useState } from "react";
import Field from "../components/Field";
import { STORAGE_KEYS } from "../constants/storageKeys";

const INVOICES_KEY = STORAGE_KEYS.INVOICES;

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

export default function InvoicesScreen({lang, t, onDone, spinTick = 0 }) {
  const [q, setQ] = useState("");
  const [list, setList] = useState(() => loadSavedInvoices());

  useEffect(() => {
    const refresh = () => setList(loadSavedInvoices());
    refresh();
    const onStorage = (e) => {
      if (!e || e.key === INVOICES_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

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

  return (
    <section className="pe-section">
      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header" style={{ position: "relative", minHeight: 56 }}>
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

          <div style={{ display: "grid", gap: 10 }}>
            {filtered.length === 0 ? (
              <div style={{ opacity: 0.8, fontSize: 14 }}>{lang === "es" ? "Sin facturas guardadas." : "No saved invoices."}</div>
            ) : (
              filtered.map((x) => (
                <div
                  className="pe-card pe-card-content"
                  key={String(x?.id || x?.invoiceNumber || Math.random())}
                  style={{
                    padding: 12,
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.12)",
                    background: "rgba(0,0,0,0.12)",
                    display: "grid",
                    gap: 8,
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
                      <button className="pe-btn pe-btn-ghost" onClick={() => remove(x?.invoiceNumber)}>
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
    </section>
  );
}
