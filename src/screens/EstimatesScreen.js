// @ts-nocheck
/* eslint-disable */
import { useMemo, useState } from "react";

export default function EstimatesScreen({ lang, t, history, onOpenEstimate, onDone }) {
  const [q, setQ] = useState("");
  const list = useMemo(() => (Array.isArray(history) ? history : []), [history]);

  const filtered = useMemo(() => {
    const s = String(q || "").trim().toLowerCase();
    if (!s) return list;
    return list.filter((e) => {
      const pn = String(e?.projectName || "").toLowerCase();
      const cn = String(e?.customerName || "").toLowerCase();
      const en = String(e?.estimateNumber || "").toLowerCase();
      const inv = String(e?.invoiceNumber || "").toLowerCase();
      return pn.includes(s) || cn.includes(s) || en.includes(s) || inv.includes(s);
    });
  }, [list, q]);

  const fmtDate = (ts) => {
    try {
      const d = new Date(Number(ts));
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleString();
    } catch {
      return "";
    }
  };

  return (
    <section className="pe-section">
      <div
        className="pe-section-title"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
      >
        <div>{lang === "es" ? "Estimaciones guardadas" : "Saved Estimates"}</div>
        <button className="pe-btn" onClick={onDone}>
          {lang === "es" ? "Volver" : "Back"}
        </button>
      </div>

      <div className="pe-grid" style={{ gap: 10 }}>
        <input
          className="pe-input"
          placeholder={lang === "es" ? "Buscar…" : "Search…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />

        <div style={{ display: "grid", gap: 10 }}>
          {filtered.length === 0 ? (
            <div style={{ opacity: 0.8, fontSize: 14 }}>{lang === "es" ? "Nada guardado todavía." : "Nothing saved yet."}</div>
          ) : (
            filtered.map((e) => (
              <div
                key={String(e?.id || Math.random())}
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
                    <div style={{ fontWeight: 800 }}>{e?.projectName || (lang === "es" ? "Sin proyecto" : "No project")}</div>
                    <div style={{ fontSize: 13, opacity: 0.85 }}>
                      {e?.customerName ? e.customerName : (lang === "es" ? "Sin cliente" : "No customer")}
                      {e?.estimateNumber ? ` • ${t("estimateNumLabel")} ${e.estimateNumber}` : ""}
                      {e?.invoiceNumber ? ` • ${t("invoiceNumLabel")} ${e.invoiceNumber}` : ""}
                    </div>
                    <div style={{ fontSize: 12, opacity: 0.7 }}>{fmtDate(e?.updatedAt || e?.ts || e?.createdAt || e?.id)}</div>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <button className="pe-btn" onClick={() => onOpenEstimate && onOpenEstimate(e)}>
                      {lang === "es" ? "Abrir" : "Open"}
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </section>
  );
}
