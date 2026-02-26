import React, { useEffect, useMemo, useState } from "react";

const ESTIMATES_KEY = "field-pocket-estimates";
const INVOICES_KEY = "field-pocket-invoices-v1";

function safeParseJSON(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function loadArray(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const v = safeParseJSON(raw, []);
    return Array.isArray(v) ? v.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function asNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseDateAny(x) {
  if (!x && x !== 0) return null;

  if (x instanceof Date) return isNaN(x.getTime()) ? null : x;

  if (typeof x === "number") {
    const d = new Date(x);
    return isNaN(d.getTime()) ? null : d;
  }

  const s = String(x || "").trim();
  if (!s) return null;

  if (/^\d{10,13}$/.test(s)) {
    const d = new Date(Number(s));
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + (Number(days) || 0));
  return x;
}

function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function fmtMoney(n) {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(asNumber(n));
  } catch {
    return `$${asNumber(n).toFixed(2)}`;
  }
}

function fmtPct(p) {
  const n = asNumber(p);
  return `${n.toFixed(1)}%`;
}

function isPaidInvoice(inv) {
  const v =
    inv?.paid === true ||
    inv?.isPaid === true ||
    String(inv?.status || "").toLowerCase() === "paid" ||
    String(inv?.paymentStatus || "").toLowerCase() === "paid" ||
    !!inv?.paidDate ||
    !!inv?.datePaid;
  return !!v;
}

function getDocDate(doc) {
  const cands = [doc?.invoiceDate, doc?.date, doc?.createdAt, doc?.updatedAt, doc?.ts, doc?.timestamp];
  for (const c of cands) {
    const d = parseDateAny(c);
    if (d) return d;
  }
  return null;
}

function getDueDate(inv) {
  const explicit = parseDateAny(inv?.dueDate);
  if (explicit) return explicit;

  const base = getDocDate(inv);
  if (!base) return null;

  const terms = Number(inv?.termsDays || inv?.net || inv?.netDays || inv?.terms || 0);
  if (Number.isFinite(terms) && terms > 0) return addDays(base, terms);

  return addDays(base, 30);
}

function sumInternalLabor(doc) {
  const lines = Array.isArray(doc?.laborLines) ? doc.laborLines : [];
  let total = 0;
  for (const ln of lines) {
    const hrs = asNumber(ln?.hours);
    const qty = asNumber(ln?.qty || 1) || 1;
    const rate = asNumber(ln?.internalRate);
    total += hrs * qty * rate;
  }
  return total;
}

function sumInternalMaterials(doc) {
  const items = Array.isArray(doc?.materialItems) ? doc.materialItems : [];
  if (items.length) {
    let total = 0;
    for (const it of items) {
      const qty = asNumber(it?.qty || 1) || 1;
      const cost = asNumber(it?.cost);
      total += qty * cost;
    }
    return total;
  }
  return asNumber(doc?.materialsCost);
}

function calcGrossProfit(doc) {
  const revenue = asNumber(doc?.total);
  const labor = sumInternalLabor(doc);
  const mats = sumInternalMaterials(doc);
  return revenue - labor - mats;
}

function calcMarginPct(doc) {
  const revenue = asNumber(doc?.total);
  if (revenue <= 0) return 0;
  return (calcGrossProfit(doc) / revenue) * 100;
}

function getTimeRangeStart(rangeKey) {
  const now = new Date();
  const today = startOfDay(now);

  if (rangeKey === "30") return addDays(today, -30);
  if (rangeKey === "90") return addDays(today, -90);

  const y = today.getFullYear();
  return new Date(y, 0, 1);
}

function inRange(docDate, start, end) {
  if (!docDate) return false;
  const t = docDate.getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function weekKey(d) {
  const x = startOfDay(d);
  const day = x.getDay();
  const diffToMon = (day + 6) % 7;
  x.setDate(x.getDate() - diffToMon);
  const y = x.getFullYear();
  const startYear = new Date(y, 0, 1);
  const days = Math.floor((x.getTime() - startYear.getTime()) / 86400000);
  const wk = Math.floor(days / 7) + 1;
  return `${y}-W${String(wk).padStart(2, "0")}`;
}

function buildWeeklySeries(invoices) {
  const now = startOfDay(new Date());
  const weeks = [];
  const start = addDays(now, -7 * 11);
  for (let i = 0; i < 12; i++) {
    const wStart = addDays(start, i * 7);
    const key = weekKey(wStart);
    weeks.push({ key, start: wStart, revenue: 0, profit: 0 });
  }
  const idx = new Map(weeks.map((w, i) => [w.key, i]));

  for (const inv of invoices) {
    const d = getDocDate(inv);
    if (!d) continue;
    const k = weekKey(d);
    const i = idx.get(k);
    if (i === undefined) continue;
    weeks[i].revenue += asNumber(inv?.total);
    weeks[i].profit += calcGrossProfit(inv);
  }

  return weeks;
}

function Donut({ segments, size = 180, stroke = 18, centerLabelTop, centerLabelBottom }) {
  const r = (size - stroke) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Donut chart">
      <g transform={`rotate(-90 ${c} ${c})`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={stroke} />
        {segments.map((s, idx) => {
          const dash = circ * clamp01(s.frac);
          const seg = (
            <circle
              key={idx}
              cx={c}
              cy={c}
              r={r}
              fill="none"
              stroke={s.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${dash} ${circ - dash}`}
              strokeDashoffset={-offset}
              opacity={s.opacity ?? 1}
            />
          );
          offset += dash;
          return seg;
        })}
      </g>

      <g>
        <text x="50%" y="48%" textAnchor="middle" fill="rgba(229,231,235,0.95)" fontSize="12" fontWeight="800">
          {centerLabelTop}
        </text>
        <text x="50%" y="60%" textAnchor="middle" fill="rgba(229,231,235,0.95)" fontSize="18" fontWeight="950">
          {centerLabelBottom}
        </text>
      </g>
    </svg>
  );
}

function Bars({ data, height = 120, width = 320 }) {
  const max = Math.max(1, ...data.map((d) => asNumber(d.revenue)));
  const pad = 6;
  const barW = (width - pad * (data.length + 1)) / data.length;

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Revenue bars">
      {data.map((d, i) => {
        const h = (asNumber(d.revenue) / max) * (height - 18);
        const x = pad + i * (barW + pad);
        const y = height - h - 12;
        return (
          <g key={d.key}>
            <rect x={x} y={y} width={barW} height={h} rx="6" ry="6" fill="rgba(34,197,94,0.35)" />
          </g>
        );
      })}
      <line x1="0" y1={height - 12} x2={width} y2={height - 12} stroke="rgba(255,255,255,0.10)" />
    </svg>
  );
}

export default function FinancialSnapshotScreen({ lang = "en", spinTick = 0 }) {
  const [range, setRange] = useState("30");
  const [estimates, setEstimates] = useState([]);
  const [invoices, setInvoices] = useState([]);

  useEffect(() => {
    const refresh = () => {
      const est = loadArray(ESTIMATES_KEY);
      const inv = loadArray(INVOICES_KEY);
      setEstimates(est);
      setInvoices(inv);
    };
    refresh();

    const onStorage = (e) => {
      if (!e) return;
      if (e.key === ESTIMATES_KEY || e.key === INVOICES_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const computed = useMemo(() => {
    const now = startOfDay(new Date());
    const start = getTimeRangeStart(range === "ytd" ? "ytd" : range);
    const end = now;

    const invAll = (Array.isArray(invoices) ? invoices : []).filter(Boolean);
    const estAll = (Array.isArray(estimates) ? estimates : []).filter(Boolean);

    const estOnly = estAll.filter((x) => String(x?.docType || "").toLowerCase() === "estimate");
    const invFromEstimates = estAll.filter((x) => String(x?.docType || "").toLowerCase() === "invoice");

    const byKey = new Map();
    for (const x of invAll) {
      const k = String(x?.id || x?.invoiceNumber || x?.estimateNumber || Math.random());
      byKey.set(k, x);
    }
    for (const x of invFromEstimates) {
      const k = String(x?.id || x?.invoiceNumber || x?.estimateNumber || Math.random());
      if (!byKey.has(k)) byKey.set(k, x);
    }

    const invMerged = Array.from(byKey.values());
    const invUse = invMerged.filter((x) => inRange(getDocDate(x), start, end));

    const revenue = invUse.reduce((s, x) => s + asNumber(x?.total), 0);
    const grossProfit = invUse.reduce((s, x) => s + calcGrossProfit(x), 0);
    const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    const unpaid = invUse.filter((x) => !isPaidInvoice(x));
    const arTotal = unpaid.reduce((s, x) => s + asNumber(x?.total), 0);

    const aging = { current: 0, late1_15: 0, late16_30: 0, late30p: 0, delinquentTotal: 0, canCompute: true };

    for (const inv of unpaid) {
      const due = getDueDate(inv);
      if (!due) {
        aging.canCompute = false;
        continue;
      }
      const daysLate = Math.floor((startOfDay(now).getTime() - startOfDay(due).getTime()) / 86400000);
      const amt = asNumber(inv?.total);
      if (daysLate <= 0) aging.current += amt;
      else if (daysLate <= 15) aging.late1_15 += amt;
      else if (daysLate <= 30) aging.late16_30 += amt;
      else aging.late30p += amt;

      if (daysLate > 0) aging.delinquentTotal += amt;
    }

    const estInRange = estOnly.filter((x) => inRange(getDocDate(x), start, end));
    const pipelineValue = estInRange.reduce((s, x) => s + asNumber(x?.total), 0);
    const pipelineCount = estInRange.length;
    const avgEstimate = pipelineCount ? pipelineValue / pipelineCount : 0;

    const weekly = buildWeeklySeries(invUse);

    const withRevenue = invUse.filter((x) => asNumber(x?.total) > 0);
    const sortedByMargin = withRevenue.map((x) => ({ x, m: calcMarginPct(x) })).sort((a, b) => b.m - a.m);
    const best = sortedByMargin.slice(0, 3);
    const worst = sortedByMargin.slice(-3).reverse();

    return { revenue, grossProfit, marginPct, arTotal, delinquentTotal: aging.delinquentTotal, aging, weekly, pipelineValue, pipelineCount, avgEstimate, best, worst, invCount: invUse.length };
  }, [range, estimates, invoices]);

  const donutSegments = useMemo(() => {
    const a = computed.aging;
    if (!a.canCompute) return [];

    const total = a.current + a.late1_15 + a.late16_30 + a.late30p;
    const safeTotal = total > 0 ? total : 1;

    return [
      { label: lang === "es" ? "Actual" : "Current", value: a.current, frac: a.current / safeTotal, color: "rgba(255,255,255,0.55)", opacity: 0.9 },
      { label: "1–15", value: a.late1_15, frac: a.late1_15 / safeTotal, color: "rgba(34,197,94,0.70)", opacity: 0.9 },
      { label: "16–30", value: a.late16_30, frac: a.late16_30 / safeTotal, color: "rgba(245,158,11,0.78)", opacity: 0.95 },
      { label: "30+", value: a.late30p, frac: a.late30p / safeTotal, color: "rgba(239,68,68,0.78)", opacity: 0.95 },
    ].filter((s) => s.value > 0);
  }, [computed.aging, lang]);

  const title = lang === "es" ? "Resumen financiero" : "Financial Snapshot";

  const insight = useMemo(() => {
    const parts = [];
    if (computed.invCount === 0) {
      parts.push(lang === "es" ? "Aún no hay facturas en este rango." : "No invoices in this range yet.");
    } else {
      parts.push((lang === "es" ? "Margen promedio: " : "Average margin: ") + fmtPct(computed.marginPct));
      if (computed.arTotal > 0) parts.push((lang === "es" ? "Cuentas por cobrar: " : "Receivables: ") + fmtMoney(computed.arTotal));
      if (computed.delinquentTotal > 0) parts.push((lang === "es" ? "Delincuencia: " : "Delinquent: ") + fmtMoney(computed.delinquentTotal));
    }
    return parts.join(" • ");
  }, [computed, lang]);

  return (
    <section className="pe-section">
      <div className="pe-section-title" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, position: "relative", minHeight: 56 }}>
        <div>{title}</div>

        <div style={{ position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)", pointerEvents: "none" }}>
          <img
            key={spinTick}
            className="esti-spin"
            src="/logo/estipaid.svg"
            alt="EstiPaid"
            style={{ height: 34, width: "auto", display: "block", objectFit: "contain", filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.38))" }}
            draggable={false}
          />
        </div>

        <div style={{ width: 80, display: "flex", justifyContent: "flex-end" }}>
          <select className="pe-input" value={range} onChange={(e) => setRange(e.target.value)} aria-label={lang === "es" ? "Rango de tiempo" : "Time range"} style={{ padding: "10px 12px", height: 44 }}>
            <option value="30">{lang === "es" ? "30 días" : "30 Days"}</option>
            <option value="90">{lang === "es" ? "90 días" : "90 Days"}</option>
            <option value="ytd">{lang === "es" ? "Año" : "YTD"}</option>
          </select>
        </div>
      </div>

      <div className="pe-card" style={{ marginTop: 10 }}>
        <div style={{ display: "grid", gap: 10 }}>
          <KPI label={lang === "es" ? "Ingresos (facturas)" : "Revenue (Invoices)"} value={fmtMoney(computed.revenue)} tone="ok" />
          <KPI label={lang === "es" ? "Ganancia bruta" : "Gross Profit"} value={fmtMoney(computed.grossProfit)} tone="ok" />
          <KPI
            label={lang === "es" ? "Margen promedio" : "Avg Margin"}
            value={fmtPct(computed.marginPct)}
            tone={computed.marginPct >= 25 ? "ok" : computed.marginPct >= 15 ? "warn" : "bad"}
          />
          <KPI label={lang === "es" ? "Cuentas por cobrar" : "Outstanding Receivables"} value={fmtMoney(computed.arTotal)} tone={computed.arTotal > 0 ? "warn" : "ok"} />
          <KPI
            label={lang === "es" ? "Delinquent" : "Delinquent"}
            value={fmtMoney(computed.delinquentTotal)}
            tone={computed.delinquentTotal > 0 ? "bad" : "ok"}
            note={!computed.aging.canCompute ? (lang === "es" ? "Faltan fechas de vencimiento/terminos en algunas facturas." : "Some invoices missing due date/terms.") : ""}
          />
        </div>
      </div>

      <div className="pe-card" style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Tendencia de ingresos" : "Revenue Trend"}</div>
        <div className="pe-muted" style={{ marginBottom: 10 }}>{lang === "es" ? "Últimas 12 semanas (facturas en el rango)" : "Last 12 weeks (invoices in range)"}</div>
        <Bars data={computed.weekly} />
      </div>

      <div className="pe-card" style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Envejecimiento de cuentas por cobrar" : "Receivables Aging"}</div>
        <div className="pe-muted" style={{ marginBottom: 12 }}>{lang === "es" ? "Basado en fecha de vencimiento (Net 30 por defecto)" : "Based on due date (defaults to Net 30)"}</div>

        <div style={{ display: "grid", placeItems: "center" }}>
          <Donut
            segments={donutSegments.length ? donutSegments : [{ label: "none", value: 1, frac: 1, color: "rgba(255,255,255,0.12)", opacity: 1 }]}
            centerLabelTop={lang === "es" ? "AR" : "AR"}
            centerLabelBottom={fmtMoney(computed.arTotal)}
          />
        </div>

        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {(donutSegments.length ? donutSegments : []).map((s) => (
            <div key={s.label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ width: 10, height: 10, borderRadius: 999, background: s.color, display: "inline-block" }} />
                <span style={{ fontWeight: 800, opacity: 0.9 }}>{s.label}</span>
              </div>
              <div style={{ fontWeight: 900 }}>{fmtMoney(s.value)}</div>
            </div>
          ))}
          {!computed.aging.canCompute ? (
            <div className="pe-muted" style={{ marginTop: 6 }}>
              {lang === "es"
                ? "Nota: algunas facturas no tienen dueDate/termsDays. Se usa Net 30 cuando faltan."
                : "Note: some invoices lack dueDate/termsDays. Net 30 is used when missing."}
            </div>
          ) : null}
        </div>
      </div>

      <div className="pe-card" style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Salud del margen" : "Margin Health"}</div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div className="pe-muted" style={{ fontWeight: 900 }}>{lang === "es" ? "Mejores márgenes" : "Best margins"}</div>
            {computed.best.length ? (
              computed.best.map((it, idx) => (
                <MiniRow key={`b-${idx}`} left={String(it.x?.projectName || it.x?.customerName || it.x?.invoiceNumber || "Invoice")} mid={fmtMoney(it.x?.total)} right={fmtPct(it.m)} tone="ok" />
              ))
            ) : (
              <div className="pe-muted">{lang === "es" ? "Sin datos" : "No data"}</div>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div className="pe-muted" style={{ fontWeight: 900 }}>{lang === "es" ? "Peores márgenes" : "Worst margins"}</div>
            {computed.worst.length ? (
              computed.worst.map((it, idx) => (
                <MiniRow key={`w-${idx}`} left={String(it.x?.projectName || it.x?.customerName || it.x?.invoiceNumber || "Invoice")} mid={fmtMoney(it.x?.total)} right={fmtPct(it.m)} tone="bad" />
              ))
            ) : (
              <div className="pe-muted">{lang === "es" ? "Sin datos" : "No data"}</div>
            )}
          </div>
        </div>
      </div>

      <div className="pe-card" style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Pipeline de estimados" : "Estimate Pipeline"}</div>
        <div style={{ display: "grid", gap: 10 }}>
          <KPI label={lang === "es" ? "Valor total" : "Total value"} value={fmtMoney(computed.pipelineValue)} tone="ok" />
          <KPI label={lang === "es" ? "Cantidad" : "Count"} value={String(computed.pipelineCount)} tone="ok" />
          <KPI label={lang === "es" ? "Promedio" : "Average size"} value={fmtMoney(computed.avgEstimate)} tone="ok" />
        </div>
      </div>

      <div className="pe-card" style={{ marginTop: 10, opacity: 0.98 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Resumen" : "Summary"}</div>
        <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.35 }}>{insight}</div>
      </div>

      <div className="pe-footer" style={{ marginTop: 12 }}>{lang === "es" ? "Vista de solo lectura." : "Display-only view."}</div>
    </section>
  );
}

function KPI({ label, value, tone = "ok", note = "" }) {
  const stripe = tone === "ok" ? "rgba(34,197,94,0.75)" : tone === "warn" ? "rgba(245,158,11,0.85)" : "rgba(239,68,68,0.85)";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "6px 1fr", gap: 12, alignItems: "stretch", padding: 12, borderRadius: 16, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(255,255,255,0.04)" }}>
      <div style={{ width: 6, borderRadius: 999, background: stripe }} />
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 12, opacity: 0.78, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 950, letterSpacing: "0.2px" }}>{value}</div>
        {note ? <div style={{ fontSize: 12, opacity: 0.7 }}>{note}</div> : null}
      </div>
    </div>
  );
}

function MiniRow({ left, mid, right, tone = "ok" }) {
  const c = tone === "ok" ? "rgba(34,197,94,0.95)" : tone === "warn" ? "rgba(245,158,11,0.95)" : "rgba(239,68,68,0.95)";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.10)", background: "rgba(0,0,0,0.10)" }}>
      <div style={{ fontWeight: 900, opacity: 0.92, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{left}</div>
      <div style={{ fontWeight: 900, opacity: 0.88 }}>{mid}</div>
      <div style={{ fontWeight: 950, color: c }}>{right}</div>
    </div>
  );
}
