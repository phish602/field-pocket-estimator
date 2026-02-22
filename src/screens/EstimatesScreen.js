// @ts-nocheck
/* eslint-disable */
import { useMemo, useState } from "react";

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function pctStr(v) {
  const n = toNum(v);
  return Number.isFinite(n) ? `${n.toFixed(2).replace(/\.00$/, "")}%` : "0%";
}

function money(v) {
  const n = toNum(v);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function safeDiv(a, b) {
  const A = toNum(a);
  const B = toNum(b);
  if (!B) return 0;
  return A / B;
}

function getMaterialInternalEach(item) {
  // Support multiple possible key names
  const v =
    item?.internalCost ??
    item?.costInternal ??
    item?.internal ??
    item?.internalEach ??
    item?.internalPrice ??
    item?.cost ??
    "";
  const n = toNum(v);
  // If blank/0, treat as "same as billed" to yield 0 margin for that line
  return n > 0 ? n : null;
}

function calcBreakdown(e) {
  const laborLines = Array.isArray(e?.laborLines) ? e.laborLines : [];
  const materialItems = Array.isArray(e?.materialItems) ? e.materialItems : [];

  const multiplierMode = e?.multiplierMode || "preset";
  const laborMultiplierPreset = toNum(e?.laborMultiplier || 1);
  const customMultiplier = toNum(e?.customMultiplier || 1);
  const effectiveMultiplier = multiplierMode === "custom" ? (customMultiplier || 1) : (laborMultiplierPreset || 1);

  const hazardPct = toNum(e?.hazardPct || 0);
  const materialsMode = e?.materialsMode || "itemized";
  const materialsMarkupPct = toNum(e?.materialsMarkupPct || 0);
  const materialsCost = toNum(e?.materialsCost || 0);

  // Labor billed/internal
  const laborRows = laborLines.map((ln, idx) => {
    const qty = Math.max(1, toNum(ln?.qty || 1));
    const hours = Math.max(0, toNum(ln?.hours || 0));
    const rate = Math.max(0, toNum(ln?.rate || 0));
    const internalRateRaw = toNum(ln?.internalRate || 0);
    const base = qty * hours * rate;
    const billed = base * effectiveMultiplier;

    // If internalRate is blank/0, treat internal cost as billed to yield 0 margin
    const internal = internalRateRaw > 0 ? qty * hours * internalRateRaw : billed;

    const profit = billed - internal;
    const margin = safeDiv(profit, billed);

    return {
      id: String(ln?.id ?? idx),
      name: String(ln?.label || ln?.name || `Labor ${idx + 1}`),
      qty,
      hours,
      rate,
      internalRate: internalRateRaw > 0 ? internalRateRaw : null,
      base,
      billed,
      internal,
      profit,
      margin,
    };
  });

  const laborBase = laborRows.reduce((a, r) => a + r.base, 0);
  const laborBilled = laborRows.reduce((a, r) => a + r.billed, 0);
  const laborInternal = laborRows.reduce((a, r) => a + r.internal, 0);

  // Materials billed/internal
  let materialsRows = [];
  let materialsBilled = 0;
  let materialsInternal = 0;

  if (materialsMode === "blanket") {
    const billed = materialsCost * (1 + materialsMarkupPct / 100);
    const internal = materialsCost > 0 ? materialsCost : billed; // if blank, yield 0 margin
    materialsBilled = billed;
    materialsInternal = internal;
    materialsRows = [
      {
        id: "blanket",
        name: "Materials (blanket)",
        qty: 1,
        chargeEach: billed,
        internalEach: materialsCost > 0 ? materialsCost : null,
        billed,
        internal,
        profit: billed - internal,
        margin: safeDiv(billed - internal, billed),
      },
    ];
  } else {
    materialsRows = materialItems.map((it, idx) => {
      const qty = Math.max(1, toNum(it?.qty || 1));
      const chargeEach = Math.max(0, toNum(it?.charge ?? it?.price ?? it?.unitPrice ?? 0));
      const billed = qty * chargeEach;

      const internalEach = getMaterialInternalEach(it);
      const internal = internalEach != null ? qty * internalEach : billed;

      const profit = billed - internal;
      const margin = safeDiv(profit, billed);

      return {
        id: String(it?.id ?? idx),
        name: String(it?.desc || it?.name || `Material ${idx + 1}`),
        qty,
        chargeEach,
        internalEach,
        billed,
        internal,
        profit,
        margin,
      };
    });

    const sumBilled = materialsRows.reduce((a, r) => a + r.billed, 0);
    const sumInternal = materialsRows.reduce((a, r) => a + r.internal, 0);

    // Itemized mode: do NOT apply extra markupPct unless your estimator does.
    // (If your estimator applies itemized markup elsewhere, change here.)
    materialsBilled = sumBilled;
    materialsInternal = sumInternal;
  }

  // Hazard: match common estimator behavior (apply to billed labor only)
  const hazardAmt = laborBilled * (hazardPct / 100);

  const revenue = laborBilled + materialsBilled + hazardAmt;
  const internal = laborInternal + materialsInternal; // hazard assumed pure surcharge unless you later add internal risk cost
  const profit = revenue - internal;
  const margin = safeDiv(profit, revenue);

  return {
    effectiveMultiplier,
    multiplierMode,
    hazardPct,
    hazardAmt,
    materialsMode,
    materialsMarkupPct,
    labor: {
      base: laborBase,
      billed: laborBilled,
      internal: laborInternal,
      profit: laborBilled - laborInternal,
      margin: safeDiv(laborBilled - laborInternal, laborBilled),
      rows: laborRows,
    },
    materials: {
      billed: materialsBilled,
      internal: materialsInternal,
      profit: materialsBilled - materialsInternal,
      margin: safeDiv(materialsBilled - materialsInternal, materialsBilled),
      rows: materialsRows,
    },
    totals: {
      revenue,
      internal,
      profit,
      margin,
    },
  };
}

export default function EstimatesScreen({ lang, t, history, onOpenEstimate, onDone, spinTick = 0 }) {
  const [q, setQ] = useState("");
  const [expanded, setExpanded] = useState(() => ({})); // { [id]: boolean }
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

  const toggle = (id) => {
    setExpanded((m) => ({ ...m, [id]: !m[id] }));
  };

  const labelSaved = lang === "es" ? "Estimaciones guardadas" : "Saved Estimates";
  const labelBack = lang === "es" ? "Volver" : "Back";

  const labelOpen = lang === "es" ? "Abrir" : "Open";
  const labelDetails = lang === "es" ? "Detalles" : "Details";
  const labelHide = lang === "es" ? "Ocultar" : "Hide";

  const labelRevenue = lang === "es" ? "Ingresos" : "Revenue";
  const labelInternal = lang === "es" ? "Costo interno" : "Internal Cost";
  const labelProfit = lang === "es" ? "Ganancia" : "Profit";
  const labelMargin = lang === "es" ? "Margen" : "Margin";

  return (
    <section className="pe-section">
      <div
        className="pe-section-title"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, position: "relative" }}
      >
        <div>{labelSaved}</div>
        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
          <img
            key={spinTick}
            className="esti-spin"
            src="/logo/estipaid.svg"
            alt="EstiPaid"
            style={{ height: 34, width: "auto", display: "block", objectFit: "contain", filter: "drop-shadow(0 6px 14px rgba(0,0,0,0.35))" }}
            draggable={false}
          />
        </div>
        <button className="pe-btn" onClick={onDone}>
          {labelBack}
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
            filtered.map((e) => {
              const id = String(e?.id || "");
              const isOpen = Boolean(expanded[id]);
              const bd = calcBreakdown(e);

              const card = {
                padding: 12,
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(0,0,0,0.12)",
                display: "grid",
                gap: 10,
              };

              const small = { fontSize: 12, opacity: 0.75 };
              const row = { display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" };

              const pill = (ok) => ({
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: ok ? "rgba(34,197,94,0.10)" : "rgba(255,255,255,0.06)",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.3px",
                whiteSpace: "nowrap",
              });

              const panel = {
                overflow: "hidden",
                maxHeight: isOpen ? 2600 : 0,
                opacity: isOpen ? 1 : 0,
                transform: isOpen ? "translateY(0px)" : "translateY(-4px)",
                transition: "max-height 320ms ease, opacity 220ms ease, transform 220ms ease",
                borderTop: "1px solid rgba(255,255,255,0.10)",
                paddingTop: isOpen ? 12 : 0,
              };

              const subCard = {
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,0.10)",
                background: "rgba(255,255,255,0.04)",
                padding: 10,
                display: "grid",
                gap: 8,
              };

              const sectionTitle = { fontSize: 12, fontWeight: 900, opacity: 0.85, letterSpacing: "0.8px" };

              return (
                <div key={id || Math.random()} style={card}>
                  <div style={row}>
                    <div style={{ display: "grid", gap: 2 }}>
                      <div style={{ fontWeight: 800 }}>{e?.projectName || (lang === "es" ? "Sin proyecto" : "No project")}</div>
                      <div style={{ fontSize: 13, opacity: 0.85 }}>
                        {e?.customerName ? e.customerName : (lang === "es" ? "Sin cliente" : "No customer")}
                        {e?.estimateNumber ? ` • ${t("estimateNumLabel")} ${e.estimateNumber}` : ""}
                        {e?.invoiceNumber ? ` • ${t("invoiceNumLabel")} ${e.invoiceNumber}` : ""}
                      </div>
                      <div style={small}>{fmtDate(e?.updatedAt || e?.ts || e?.createdAt || e?.id)}</div>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                      <div style={pill(true)} title={labelRevenue}>
                        {money(bd.totals.revenue)}
                      </div>
                      <div style={pill(false)} title={labelMargin}>
                        {(bd.totals.margin * 100).toFixed(1)}%
                      </div>
                      <button className="pe-btn" onClick={() => onOpenEstimate && onOpenEstimate(e)}>
                        {labelOpen}
                      </button>
                      <button className="pe-btn pe-btn-ghost" onClick={() => toggle(id)}>
                        {isOpen ? labelHide : labelDetails}
                      </button>
                    </div>
                  </div>

                  <div style={panel} aria-hidden={!isOpen}>
                    {/* TOTALS */}
                    <div style={subCard}>
                      <div style={sectionTitle}>{lang === "es" ? "TOTALES" : "TOTALS"}</div>
                      <div style={row}>
                        <div style={small}>{labelRevenue}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.totals.revenue)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{labelInternal}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.totals.internal)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{labelProfit}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.totals.profit)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{labelMargin}</div>
                        <div style={{ fontWeight: 900 }}>{(bd.totals.margin * 100).toFixed(1)}%</div>
                      </div>
                    </div>

                    {/* LABOR */}
                    <div style={{ ...subCard, marginTop: 10 }}>
                      <div style={sectionTitle}>{lang === "es" ? "MANO DE OBRA" : "LABOR"}</div>
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Base" : "Base"}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.labor.base)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Multiplicador" : "Multiplier"}</div>
                        <div style={{ fontWeight: 900 }}>{bd.effectiveMultiplier.toFixed(2).replace(/\.00$/, "")}×</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Facturado" : "Billed"}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.labor.billed)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{labelInternal}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.labor.internal)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{labelProfit}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.labor.profit)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{labelMargin}</div>
                        <div style={{ fontWeight: 900 }}>{(bd.labor.margin * 100).toFixed(1)}%</div>
                      </div>

                      {/* Labor line breakdown */}
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {bd.labor.rows.map((r) => (
                          <div
                            key={r.id}
                            style={{
                              borderRadius: 10,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(0,0,0,0.14)",
                              padding: 10,
                              display: "grid",
                              gap: 6,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ fontWeight: 900 }}>{r.name}</div>
                              <div style={{ fontWeight: 900 }}>{money(r.billed)}</div>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, opacity: 0.8 }}>
                              <div>{lang === "es" ? "Cant" : "Qty"}: {r.qty}</div>
                              <div>{lang === "es" ? "Horas" : "Hours"}: {r.hours}</div>
                              <div>{lang === "es" ? "Tarifa" : "Rate"}: {money(r.rate)}</div>
                              <div>
                                {lang === "es" ? "Int" : "Internal"}: {r.internalRate != null ? money(r.internalRate) : (lang === "es" ? "—" : "—")}
                              </div>
                              <div>{labelProfit}: {money(r.profit)}</div>
                              <div>{labelMargin}: {(r.margin * 100).toFixed(1)}%</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* MATERIALS */}
                    <div style={{ ...subCard, marginTop: 10 }}>
                      <div style={sectionTitle}>{lang === "es" ? "MATERIALES" : "MATERIALS"}</div>
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Modo" : "Mode"}</div>
                        <div style={{ fontWeight: 900 }}>{bd.materialsMode === "blanket" ? (lang === "es" ? "Global" : "Blanket") : (lang === "es" ? "Detallado" : "Itemized")}</div>
                      </div>
                      {bd.materialsMode === "blanket" ? (
                        <div style={row}>
                          <div style={small}>{lang === "es" ? "Markup" : "Markup"}</div>
                          <div style={{ fontWeight: 900 }}>{pctStr(bd.materialsMarkupPct)}</div>
                        </div>
                      ) : null}
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Facturado" : "Billed"}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.materials.billed)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{labelInternal}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.materials.internal)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{labelProfit}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.materials.profit)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{labelMargin}</div>
                        <div style={{ fontWeight: 900 }}>{(bd.materials.margin * 100).toFixed(1)}%</div>
                      </div>

                      {/* Materials line breakdown */}
                      <div style={{ marginTop: 8, display: "grid", gap: 8 }}>
                        {bd.materials.rows.map((r) => (
                          <div
                            key={r.id}
                            style={{
                              borderRadius: 10,
                              border: "1px solid rgba(255,255,255,0.10)",
                              background: "rgba(0,0,0,0.14)",
                              padding: 10,
                              display: "grid",
                              gap: 6,
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ fontWeight: 900 }}>{r.name}</div>
                              <div style={{ fontWeight: 900 }}>{money(r.billed)}</div>
                            </div>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, opacity: 0.8 }}>
                              <div>{lang === "es" ? "Cant" : "Qty"}: {r.qty}</div>
                              <div>{lang === "es" ? "Precio" : "Price"}: {money(r.chargeEach)}</div>
                              <div>
                                {lang === "es" ? "Int" : "Internal"}: {r.internalEach != null ? money(r.internalEach) : (lang === "es" ? "—" : "—")}
                              </div>
                              <div>{labelProfit}: {money(r.profit)}</div>
                              <div>{labelMargin}: {(r.margin * 100).toFixed(1)}%</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* HAZARD */}
                    <div style={{ ...subCard, marginTop: 10 }}>
                      <div style={sectionTitle}>{lang === "es" ? "RIESGO" : "HAZARD"}</div>
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Porcentaje" : "Percent"}</div>
                        <div style={{ fontWeight: 900 }}>{pctStr(bd.hazardPct)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Monto" : "Amount"}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.hazardAmt)}</div>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.72, marginTop: 6 }}>
                        {lang === "es"
                          ? "El riesgo se calcula sobre la mano de obra facturada."
                          : "Hazard is calculated on billed labor."}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
