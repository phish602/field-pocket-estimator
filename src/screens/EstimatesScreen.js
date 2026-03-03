// @ts-nocheck
/* eslint-disable */
import { useMemo, useState } from "react";
import Field from "../components/Field";
import { computeTotals } from "../estimator/engine";

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

function resolveMaterialsMode(doc) {
  const explicit = String(doc?.ui?.materialsMode || doc?.materialsMode || "").toLowerCase();
  if (explicit === "itemized" || explicit === "blanket") return explicit;
  if (Array.isArray(doc?.materials?.items) && doc.materials.items.length > 0) return "itemized";
  if (Array.isArray(doc?.materialItems) && doc.materialItems.length > 0) return "itemized";
  return "itemized";
}

function toEstimatorState(doc) {
  const laborLines = Array.isArray(doc?.labor?.lines) ? doc.labor.lines : (Array.isArray(doc?.laborLines) ? doc.laborLines : []);
  const materialItems = Array.isArray(doc?.materials?.items) ? doc.materials.items : (Array.isArray(doc?.materialItems) ? doc.materialItems : []);
  const multiplierMode = String(doc?.multiplierMode || "").toLowerCase();
  const customMultiplier = toNum(doc?.customMultiplier);
  const presetMultiplier = toNum(doc?.laborMultiplier);
  const directMultiplier = toNum(doc?.labor?.multiplier);
  const multiplier = directMultiplier > 0
    ? directMultiplier
    : (multiplierMode === "custom" ? (customMultiplier || 1) : (presetMultiplier || 1));
  const materialsMode = resolveMaterialsMode(doc);

  return {
    ui: {
      materialsMode,
    },
    labor: {
      hazardPct: toNum(doc?.labor?.hazardPct ?? doc?.hazardPct),
      riskPct: toNum(doc?.labor?.riskPct ?? doc?.riskPct),
      multiplier: multiplier > 0 ? multiplier : 1,
      lines: laborLines.map((ln, idx) => ({
        id: String(ln?.id ?? `labor_${idx}`),
        role: String(ln?.role || ""),
        label: String(ln?.label || ln?.name || ""),
        qty: Math.max(1, toNum(ln?.qty || 1)),
        hours: Math.max(0, toNum(ln?.hours)),
        rate: Math.max(0, toNum(ln?.rate ?? ln?.billRate)),
        markupPct: toNum(ln?.markupPct),
        trueRateInternal: Math.max(0, toNum(ln?.trueRateInternal ?? ln?.internalRate ?? ln?.rateInternal)),
      })),
    },
    materials: {
      blanketCost: Math.max(0, toNum(doc?.materials?.blanketCost ?? doc?.blanketCost ?? doc?.materialsCost)),
      blanketInternalCost: Math.max(
        0,
        toNum(doc?.materials?.blanketInternalCost ?? doc?.blanketInternalCost ?? doc?.materialsCost)
      ),
      markupPct: toNum(doc?.materials?.markupPct ?? doc?.materialsMarkupPct),
      items: materialItems.map((it, idx) => ({
        id: String(it?.id ?? `mat_${idx}`),
        desc: String(it?.desc || it?.name || ""),
        qty: Math.max(1, toNum(it?.qty || 1)),
        priceEach: Math.max(0, toNum(it?.priceEach ?? it?.chargeEach ?? it?.charge ?? it?.price ?? it?.unitPrice)),
        markupPct: toNum(it?.markupPct),
        unitCostInternal: Math.max(
          0,
          toNum(it?.unitCostInternal ?? it?.costInternal ?? it?.internalCost ?? it?.internalEach ?? it?.internalPrice ?? it?.cost)
        ),
      })),
    },
  };
}

function calcBreakdown(e) {
  const state = toEstimatorState(e || {});
  const computed = computeTotals(state);
  const effectiveMultiplier = toNum(computed?.multiplier || 1) || 1;
  const hazardPct = toNum(computed?.hazardPct);
  const riskPct = toNum(computed?.riskPct);
  const hazardAmt = toNum(computed?.hazardAmount);
  const riskAmt = toNum(computed?.riskAmount);
  const materialsMode = state?.ui?.materialsMode === "itemized" ? "itemized" : "blanket";
  const materialsMarkupPct = toNum(state?.materials?.markupPct);

  const laborRows = (computed?.labor?.normalized || []).map((ln, idx) => {
    const billed = toNum(ln?.total) * effectiveMultiplier;
    const internal = toNum(ln?.internalCost);
    return {
      id: String(ln?.id ?? idx),
      name: String(ln?.label || ln?.name || `Labor ${idx + 1}`),
      qty: Math.max(1, toNum(ln?.qty || 1)),
      hours: Math.max(0, toNum(ln?.hours)),
      rate: toNum(ln?.effectiveRate ?? ln?.rate),
      internalRate: toNum(ln?.trueRateInternal) > 0 ? toNum(ln?.trueRateInternal) : null,
      base: toNum(ln?.total),
      billed,
      internal,
      profit: billed - internal,
      margin: safeDiv(billed - internal, billed),
    };
  });

  const laborBase = toNum(computed?.labor?.subtotal);
  const laborBilled = toNum(computed?.laborAfterMultiplier);
  const laborInternal = toNum(computed?.labor?.totalCost);

  let materialsRows = [];
  if (materialsMode === "blanket") {
    const billed = toNum(computed?.materials?.totalRevenue);
    const internal = toNum(computed?.materials?.totalCost);
    materialsRows = [{
      id: "blanket",
      name: "Materials (blanket)",
      qty: 1,
      chargeEach: billed,
      internalEach: internal > 0 ? internal : null,
      billed,
      internal,
      profit: billed - internal,
      margin: safeDiv(billed - internal, billed),
    }];
  } else {
    materialsRows = (computed?.materials?.normalized || []).map((it, idx) => {
      const billed = toNum(it?.charge);
      const internal = toNum(it?.internalCost);
      const internalEachRaw = toNum(it?.unitCostInternal);
      return {
        id: String(it?.id ?? idx),
        name: String(it?.desc || it?.name || `Material ${idx + 1}`),
        qty: Math.max(1, toNum(it?.qty || 1)),
        chargeEach: toNum(it?.effectivePriceEach ?? it?.priceEach),
        internalEach: internalEachRaw > 0 ? internalEachRaw : null,
        billed,
        internal,
        profit: billed - internal,
        margin: safeDiv(billed - internal, billed),
      };
    });
  }
  const materialsBilled = toNum(computed?.materials?.totalRevenue);
  const materialsInternal = toNum(computed?.materials?.totalCost);
  const revenue = toNum(computed?.totalRevenue);
  const internal = toNum(computed?.totalCost);
  const profit = toNum(computed?.grossProfit);
  const margin = toNum(computed?.grossMarginPct);

  return {
    effectiveMultiplier,
    hazardPct,
    riskPct,
    hazardAmt,
    riskAmt,
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
  const labelInternal = lang === "es" ? "Costo interno" : "Internal cost";
  const labelProfit = lang === "es" ? "Ganancia" : "Profit";
  const labelMargin = lang === "es" ? "Margen" : "Margin";

  return (
    <section className="pe-section">
      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header" style={{ position: "relative", minHeight: 56 }}>
          <div className="pe-company-header-title">
            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title={labelSaved}>{labelSaved}</h1>
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
              {labelBack}
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
                <div className="pe-card pe-card-content" key={id || Math.random()} style={card}>
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
                    <div className="pe-card pe-card-content" style={subCard}>
                      <div style={sectionTitle}>{lang === "es" ? "Totales" : "Totals"}</div>
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
                    <div className="pe-card pe-card-content" style={{ ...subCard, marginTop: 10 }}>
                      <div style={sectionTitle}>{lang === "es" ? "Mano de obra" : "Labor"}</div>
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
                    <div className="pe-card pe-card-content" style={{ ...subCard, marginTop: 10 }}>
                      <div style={sectionTitle}>{lang === "es" ? "Materiales" : "Materials"}</div>
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

                    {/* HAZARD / RISK */}
                    <div className="pe-card pe-card-content" style={{ ...subCard, marginTop: 10 }}>
                      <div style={sectionTitle}>{lang === "es" ? "Peligro y Riesgo" : "Hazard & Risk"}</div>
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Peligro %" : "Hazard %"}</div>
                        <div style={{ fontWeight: 900 }}>{pctStr(bd.hazardPct)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Cargo de Peligro" : "Hazard amount"}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.hazardAmt)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Riesgo %" : "Risk %"}</div>
                        <div style={{ fontWeight: 900 }}>{pctStr(bd.riskPct)}</div>
                      </div>
                      <div style={row}>
                        <div style={small}>{lang === "es" ? "Cargo de Riesgo" : "Risk amount"}</div>
                        <div style={{ fontWeight: 900 }}>{money(bd.riskAmt)}</div>
                      </div>
                      <div style={{ fontSize: 12, opacity: 0.72, marginTop: 6 }}>
                        {lang === "es"
                          ? "Se aplica una sola vez sobre la mano de obra facturada."
                          : "Applied once on billed labor."}
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
    </section>
  );
}
