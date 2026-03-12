import React, { useEffect, useMemo, useState } from "react";
import Field from "../components/Field";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { computeTotals } from "../estimator/engine";
import {
  buildEstimateInvoiceSummary,
  deriveInvoiceStatus,
  INVOICE_STATUSES,
  isInvoiceFinanciallyCommitted,
  isInvoiceReceivable,
  readStoredInvoices,
} from "../utils/invoices";

const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const INVOICES_KEY = STORAGE_KEYS.INVOICES;

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

function normalizeEstimateStatus(status) {
  const raw = String(status || "").trim().toLowerCase();
  if (raw === "approved") return "approved";
  if (raw === "lost") return "lost";
  return "pending";
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

function resolveMaterialsMode(doc) {
  const explicit = String(doc?.ui?.materialsMode || doc?.materialsMode || "").toLowerCase();
  if (explicit === "itemized" || explicit === "blanket") return explicit;
  if (Array.isArray(doc?.materials?.items) && doc.materials.items.length > 0) return "itemized";
  if (Array.isArray(doc?.materialItems) && doc.materialItems.length > 0) return "itemized";
  return "blanket";
}

function toEstimatorState(doc) {
  const laborLines = Array.isArray(doc?.labor?.lines) ? doc.labor.lines : (Array.isArray(doc?.laborLines) ? doc.laborLines : []);
  const materialItems = Array.isArray(doc?.materials?.items) ? doc.materials.items : (Array.isArray(doc?.materialItems) ? doc.materialItems : []);
  const multiplierMode = String(doc?.multiplierMode || "").toLowerCase();
  const customMultiplier = asNumber(doc?.customMultiplier);
  const presetMultiplier = asNumber(doc?.laborMultiplier);
  const directMultiplier = asNumber(doc?.labor?.multiplier);
  const multiplier = directMultiplier > 0
    ? directMultiplier
    : (multiplierMode === "custom" ? (customMultiplier || 1) : (presetMultiplier || 1));
  return {
    ui: {
      materialsMode: resolveMaterialsMode(doc),
    },
    labor: {
      hazardPct: asNumber(doc?.labor?.hazardPct ?? doc?.hazardPct),
      riskPct: asNumber(doc?.labor?.riskPct ?? doc?.riskPct),
      multiplier: multiplier > 0 ? multiplier : 1,
      lines: laborLines.map((ln, idx) => ({
        id: String(ln?.id ?? `labor_${idx}`),
        qty: Math.max(1, asNumber(ln?.qty || 1)),
        hours: Math.max(0, asNumber(ln?.hours)),
        rate: Math.max(0, asNumber(ln?.rate ?? ln?.billRate)),
        markupPct: asNumber(ln?.markupPct),
        trueRateInternal: Math.max(0, asNumber(ln?.trueRateInternal ?? ln?.internalRate ?? ln?.rateInternal)),
      })),
    },
    materials: {
      blanketCost: Math.max(0, asNumber(doc?.materials?.blanketCost ?? doc?.blanketCost ?? doc?.materialsCost)),
      blanketInternalCost: Math.max(
        0,
        asNumber(doc?.materials?.blanketInternalCost ?? doc?.blanketInternalCost ?? doc?.materialsCost)
      ),
      markupPct: asNumber(doc?.materials?.markupPct ?? doc?.materialsMarkupPct),
      items: materialItems.map((it, idx) => ({
        id: String(it?.id ?? `mat_${idx}`),
        qty: Math.max(1, asNumber(it?.qty || 1)),
        priceEach: Math.max(0, asNumber(it?.priceEach ?? it?.chargeEach ?? it?.charge ?? it?.price ?? it?.unitPrice)),
        markupPct: asNumber(it?.markupPct),
        unitCostInternal: Math.max(
          0,
          asNumber(it?.unitCostInternal ?? it?.costInternal ?? it?.internalCost ?? it?.internalEach ?? it?.internalPrice ?? it?.cost)
        ),
      })),
    },
  };
}

const FALLBACK_TOTALS_CACHE = new WeakMap();

function getFallbackTotals(doc) {
  if (!doc || typeof doc !== "object") return null;
  const cached = FALLBACK_TOTALS_CACHE.get(doc);
  if (cached) return cached;
  try {
    const computed = computeTotals(toEstimatorState(doc));
    FALLBACK_TOTALS_CACHE.set(doc, computed);
    return computed;
  } catch {
    return null;
  }
}

function calcRevenue(doc) {
  const direct = doc?.financials?.totalRevenue ?? doc?.totals?.totalRevenue ?? doc?.totalRevenue ?? doc?.grandTotal ?? doc?.total;
  if (direct !== undefined && direct !== null && String(direct) !== "") return asNumber(direct);
  return asNumber(getFallbackTotals(doc)?.totalRevenue);
}

function calcCost(doc) {
  const direct = doc?.financials?.totalCost ?? doc?.totals?.totalCost ?? doc?.totalCost;
  if (direct !== undefined && direct !== null && String(direct) !== "") return asNumber(direct);
  return asNumber(getFallbackTotals(doc)?.totalCost);
}

function calcGrossProfit(doc) {
  const direct = doc?.financials?.grossProfit ?? doc?.totals?.grossProfit ?? doc?.grossProfit;
  if (direct !== undefined && direct !== null && String(direct) !== "") return asNumber(direct);
  const fallback = getFallbackTotals(doc);
  if (fallback) return asNumber(fallback?.grossProfit);
  return calcRevenue(doc) - calcCost(doc);
}

function calcMarginPct(doc) {
  const revenue = calcRevenue(doc);
  if (revenue <= 0) return 0;
  return (calcGrossProfit(doc) / revenue) * 100;
}

function getReceivableAmount(invoice) {
  const balance = asNumber(invoice?.balanceRemaining);
  if (balance > 0) return balance;
  return Math.max(calcRevenue(invoice) - asNumber(invoice?.amountPaid), 0);
}

function readSavedEstimates() {
  const records = loadArray(ESTIMATES_KEY);
  return records
    .filter((entry) => String(entry?.docType || "estimate").toLowerCase() !== "invoice")
    .map((entry) => ({
      ...entry,
      status: normalizeEstimateStatus(entry?.status),
    }));
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
    weeks[i].revenue += calcRevenue(inv);
    weeks[i].profit += calcGrossProfit(inv);
  }

  return weeks;
}

function useCountUp(targetValue, durationMs = 720) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const target = asNumber(targetValue);
    let rafId = 0;
    let startTs = 0;

    const tick = (ts) => {
      if (!startTs) startTs = ts;
      const p = Math.min(1, (ts - startTs) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3);
      setValue(target * eased);
      if (p < 1) rafId = window.requestAnimationFrame(tick);
    };

    setValue(0);
    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [targetValue, durationMs]);

  return value;
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
      setEstimates(readSavedEstimates());
      setInvoices(readStoredInvoices());
    };
    refresh();

    const onStorage = (e) => {
      if (!e) return;
      if (e.key === ESTIMATES_KEY || e.key === INVOICES_KEY) refresh();
    };
    const onLocalStorage = (event) => {
      const key = String(event?.detail?.key || "").trim();
      if (key === ESTIMATES_KEY || key === INVOICES_KEY) refresh();
    };
    const onInvoicesChanged = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("estipaid:invoices-changed", onInvoicesChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:invoices-changed", onInvoicesChanged);
    };
  }, []);

  const computed = useMemo(() => {
    const now = startOfDay(new Date());
    const start = getTimeRangeStart(range === "ytd" ? "ytd" : range);
    const end = now;

    const invAll = (Array.isArray(invoices) ? invoices : []).filter(Boolean);
    const estAll = (Array.isArray(estimates) ? estimates : []).filter(Boolean);

    const activeInvoices = invAll
      .filter((invoice) => inRange(getDocDate(invoice), start, end))
      .filter((invoice) => isInvoiceFinanciallyCommitted(invoice, now.getTime()));
    const revenue = activeInvoices.reduce((sum, invoice) => sum + calcRevenue(invoice), 0);
    const grossProfit = activeInvoices.reduce((sum, invoice) => sum + calcGrossProfit(invoice), 0);
    const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    const receivables = activeInvoices.filter((invoice) => isInvoiceReceivable(invoice, now.getTime()));
    const arTotal = receivables.reduce((sum, invoice) => sum + getReceivableAmount(invoice), 0);

    const aging = { current: 0, late1_15: 0, late16_30: 0, late30p: 0, delinquentTotal: 0, canCompute: true };

    for (const inv of receivables) {
      const due = getDueDate(inv);
      if (!due) {
        aging.canCompute = false;
        continue;
      }
      const daysLate = Math.floor((startOfDay(now).getTime() - startOfDay(due).getTime()) / 86400000);
      const amt = getReceivableAmount(inv);
      if (daysLate <= 0) aging.current += amt;
      else if (daysLate <= 15) aging.late1_15 += amt;
      else if (daysLate <= 30) aging.late16_30 += amt;
      else aging.late30p += amt;

      if (daysLate > 0) aging.delinquentTotal += amt;
    }

    const pendingEstimates = estAll.filter((estimate) => normalizeEstimateStatus(estimate?.status) === "pending");
    const approvedEstimates = estAll.filter((estimate) => normalizeEstimateStatus(estimate?.status) === "approved");
    const pipelineEstimates = pendingEstimates.filter((estimate) => inRange(getDocDate(estimate), start, end));
    const approvedInRange = approvedEstimates.filter((estimate) => inRange(getDocDate(estimate), start, end));

    const pipelineValue = pipelineEstimates.reduce((sum, estimate) => sum + calcRevenue(estimate), 0);
    const pipelineCount = pipelineEstimates.length;
    const avgEstimate = pipelineCount ? pipelineValue / pipelineCount : 0;

    let approvedReadyValue = 0;
    let approvedReadyCount = 0;
    for (const estimate of approvedInRange) {
      const summary = buildEstimateInvoiceSummary(estimate, invAll);
      const remaining = Math.max(0, asNumber(summary?.remainingToInvoice));
      approvedReadyValue += remaining;
      if (remaining > 0) approvedReadyCount += 1;
    }

    const weekly = buildWeeklySeries(activeInvoices);

    const withRevenue = activeInvoices.filter((invoice) => calcRevenue(invoice) > 0);
    const sortedByMargin = withRevenue.map((x) => ({ x, m: calcMarginPct(x) })).sort((a, b) => b.m - a.m);
    const best = sortedByMargin.slice(0, 3);
    const worst = sortedByMargin.slice(-3).reverse();

    const statusCounts = activeInvoices.reduce((counts, invoice) => {
      const status = deriveInvoiceStatus(invoice, now.getTime());
      counts.total += 1;
      if (status === INVOICE_STATUSES.PAID) counts.paid += 1;
      else if (status === INVOICE_STATUSES.OVERDUE) counts.overdue += 1;
      else if (status === INVOICE_STATUSES.SENT) counts.sent += 1;
      else counts.draft += 1;
      return counts;
    }, { total: 0, draft: 0, sent: 0, paid: 0, overdue: 0 });

    return {
      revenue,
      grossProfit,
      marginPct,
      arTotal,
      delinquentTotal: aging.delinquentTotal,
      aging,
      weekly,
      pipelineValue,
      pipelineCount,
      avgEstimate,
      approvedReadyValue,
      approvedReadyCount,
      best,
      worst,
      invCount: activeInvoices.length,
      statusCounts,
    };
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
      if (computed.statusCounts.sent > 0 || computed.statusCounts.overdue > 0 || computed.statusCounts.paid > 0) {
        parts.push(
          lang === "es"
            ? `Facturas activas: ${computed.statusCounts.sent} enviadas, ${computed.statusCounts.overdue} vencidas, ${computed.statusCounts.paid} pagadas`
            : `Active invoices: ${computed.statusCounts.sent} sent, ${computed.statusCounts.overdue} overdue, ${computed.statusCounts.paid} paid`
        );
      }
    }
    if (computed.approvedReadyValue > 0) {
      parts.push(
        (lang === "es" ? "Aprobadas por facturar: " : "Approved ready to invoice: ")
        + fmtMoney(computed.approvedReadyValue)
      );
    }
    return parts.join(" • ");
  }, [computed, lang]);

  return (
    <section className="pe-section">
      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header" style={{ position: "relative", minHeight: 56 }}>
          <div className="pe-company-header-title">
            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title={title}>{title}</h1>
          </div>

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

          <div className="pe-company-header-controls">
            <div style={{ width: 110, display: "flex", justifyContent: "flex-end" }}>
              <Field as="select" value={range} onChange={(e) => setRange(e.target.value)} aria-label={lang === "es" ? "Rango de tiempo" : "Time range"}>
                <option value="30">{lang === "es" ? "30 días" : "30 Days"}</option>
                <option value="90">{lang === "es" ? "90 días" : "90 Days"}</option>
                <option value="ytd">{lang === "es" ? "Año" : "YTD"}</option>
              </Field>
            </div>
          </div>
        </div>

      <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-md">
        <div style={{ display: "grid", gap: 10 }}>
          <KPI label={lang === "es" ? "Ingresos (facturas)" : "Revenue (invoices)"} value={fmtMoney(computed.revenue)} numericValue={computed.revenue} formatValue={fmtMoney} tone="ok" />
          <KPI label={lang === "es" ? "Ganancia bruta" : "Gross Profit"} value={fmtMoney(computed.grossProfit)} numericValue={computed.grossProfit} formatValue={fmtMoney} tone="ok" />
          <KPI
            label={lang === "es" ? "Margen promedio" : "Avg margin"}
            value={fmtPct(computed.marginPct)}
            numericValue={computed.marginPct}
            formatValue={fmtPct}
            tone={computed.marginPct >= 25 ? "ok" : computed.marginPct >= 15 ? "warn" : "bad"}
          />
          <KPI label={lang === "es" ? "Cuentas por cobrar" : "Outstanding receivables"} value={fmtMoney(computed.arTotal)} numericValue={computed.arTotal} formatValue={fmtMoney} tone={computed.arTotal > 0 ? "warn" : "ok"} />
          <KPI
            label={lang === "es" ? "Delinquent" : "Delinquent"}
            value={fmtMoney(computed.delinquentTotal)}
            numericValue={computed.delinquentTotal}
            formatValue={fmtMoney}
            tone={computed.delinquentTotal > 0 ? "bad" : "ok"}
            note={!computed.aging.canCompute ? (lang === "es" ? "Faltan fechas de vencimiento/terminos en algunas facturas." : "Some invoices missing due date/terms.") : ""}
          />
        </div>
      </div>

      <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-sm">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Tendencia de ingresos" : "Revenue Trend"}</div>
        <div className="pe-muted" style={{ marginBottom: 10 }}>{lang === "es" ? "Últimas 12 semanas (facturas en el rango)" : "Last 12 weeks (invoices in range)"}</div>
        <Bars data={computed.weekly} />
      </div>

      <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-sm">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Envejecimiento de cuentas por cobrar" : "Receivables Aging"}</div>
        <div className="pe-muted" style={{ marginBottom: 12 }}>{lang === "es" ? "Basado en fecha de vencimiento (Net 30 por defecto)" : "Based on due date (defaults to Net 30)"}</div>

        <div style={{ display: "grid", placeItems: "center" }}>
          <Donut
            segments={donutSegments.length ? donutSegments : [{ label: "none", value: 1, frac: 1, color: "rgba(255,255,255,0.12)", opacity: 1 }]}
            centerLabelTop={lang === "es" ? "AR" : "AR"}
            centerLabelBottom={fmtMoney(computed.arTotal)}
          />
        </div>

        <div className="ep-section-gap-sm" style={{ display: "grid", gap: 8 }}>
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

      <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-sm">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Salud del margen" : "Margin Health"}</div>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div className="pe-muted" style={{ fontWeight: 900 }}>{lang === "es" ? "Mejores márgenes" : "Best margins"}</div>
            {computed.best.length ? (
              computed.best.map((it, idx) => (
                <MiniRow key={`b-${idx}`} left={String(it.x?.projectName || it.x?.customerName || it.x?.invoiceNumber || "Invoice")} mid={fmtMoney(calcRevenue(it.x))} right={fmtPct(it.m)} tone="ok" />
              ))
            ) : (
              <div className="pe-muted">{lang === "es" ? "Sin datos" : "No data"}</div>
            )}
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div className="pe-muted" style={{ fontWeight: 900 }}>{lang === "es" ? "Peores márgenes" : "Worst margins"}</div>
            {computed.worst.length ? (
              computed.worst.map((it, idx) => (
                <MiniRow key={`w-${idx}`} left={String(it.x?.projectName || it.x?.customerName || it.x?.invoiceNumber || "Invoice")} mid={fmtMoney(calcRevenue(it.x))} right={fmtPct(it.m)} tone="bad" />
              ))
            ) : (
              <div className="pe-muted">{lang === "es" ? "Sin datos" : "No data"}</div>
            )}
          </div>
        </div>
      </div>

      <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-sm">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Pipeline de estimados" : "Estimate Pipeline"}</div>
        <div style={{ display: "grid", gap: 10 }}>
          <KPI label={lang === "es" ? "Valor pendiente" : "Pending value"} value={fmtMoney(computed.pipelineValue)} numericValue={computed.pipelineValue} formatValue={fmtMoney} tone="ok" />
          <KPI label={lang === "es" ? "Pendientes" : "Pending count"} value={String(computed.pipelineCount)} numericValue={computed.pipelineCount} formatValue={(n) => String(Math.round(asNumber(n)))} tone="ok" />
          <KPI label={lang === "es" ? "Promedio pendiente" : "Avg pending"} value={fmtMoney(computed.avgEstimate)} numericValue={computed.avgEstimate} formatValue={fmtMoney} tone="ok" />
        </div>
        <div className="pe-muted" style={{ marginTop: 8 }}>
          {lang === "es"
            ? `Aprobadas por facturar: ${fmtMoney(computed.approvedReadyValue)} (${computed.approvedReadyCount})`
            : `Approved ready to invoice: ${fmtMoney(computed.approvedReadyValue)} (${computed.approvedReadyCount})`}
        </div>
      </div>

      <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-sm">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Resumen" : "Summary"}</div>
        <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.35 }}>{insight}</div>
      </div>

      <div className="pe-footer ep-section-gap-sm">{lang === "es" ? "Vista de solo lectura." : "Display-only view."}</div>
      </div>
    </section>
  );
}

function KPI({ label, value, tone = "ok", note = "", numericValue, formatValue }) {
  const stripe = tone === "ok" ? "rgba(34,197,94,0.75)" : tone === "warn" ? "rgba(245,158,11,0.85)" : "rgba(239,68,68,0.85)";
  const canAnimate = Number.isFinite(Number(numericValue));
  const animatedNumber = useCountUp(canAnimate ? numericValue : 0, 720);
  const displayValue = canAnimate
    ? (typeof formatValue === "function" ? formatValue(animatedNumber) : String(animatedNumber))
    : value;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "6px 1fr", gap: 12, alignItems: "stretch", padding: 12 }}>
      <div style={{ width: 6, borderRadius: 999, background: stripe }} />
      <div style={{ display: "grid", gap: 4 }}>
        <div style={{ fontSize: 12, opacity: 0.78, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 950, letterSpacing: "0.2px" }}>{displayValue}</div>
        {note ? <div style={{ fontSize: 12, opacity: 0.7 }}>{note}</div> : null}
      </div>
    </div>
  );
}

function MiniRow({ left, mid, right, tone = "ok" }) {
  const c = tone === "ok" ? "rgba(34,197,94,0.95)" : tone === "warn" ? "rgba(245,158,11,0.95)" : "rgba(239,68,68,0.95)";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "10px 12px" }}>
      <div style={{ fontWeight: 900, opacity: 0.92, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{left}</div>
      <div style={{ fontWeight: 900, opacity: 0.88 }}>{mid}</div>
      <div style={{ fontWeight: 950, color: c }}>{right}</div>
    </div>
  );
}
