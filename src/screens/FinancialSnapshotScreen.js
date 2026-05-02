import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { readStoredProjects } from "../utils/projects";

const CUSTOMERS_KEY = STORAGE_KEYS.CUSTOMERS;
const PROJECTS_KEY = STORAGE_KEYS.PROJECTS;
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const COMPANY_PROFILE_KEY = STORAGE_KEYS.COMPANY_PROFILE;
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

function loadObject(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = safeParseJSON(raw, null);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
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

function endOfDay(d) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}

function addDays(d, days) {
  const x = new Date(d);
  x.setDate(x.getDate() + (Number(days) || 0));
  return x;
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

function fmtDateShort(value) {
  const d = parseDateAny(value);
  if (!d) return "No due date";
  try {
    return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

function cleanPhone(value) {
  return String(value || "").replace(/[^\d+]/g, "").trim();
}

function getCustomerDisplayName(customer) {
  if (!customer || typeof customer !== "object") return "";
  return String(
    customer?.name
    || customer?.companyName
    || customer?.fullName
    || ""
  ).trim();
}

function getCustomerEmail(customer) {
  if (!customer || typeof customer !== "object") return "";
  return String(
    customer?.email
    || customer?.comEmail
    || customer?.resEmail
    || ""
  ).trim();
}

function getCustomerPhone(customer) {
  if (!customer || typeof customer !== "object") return "";
  return String(
    customer?.phone
    || customer?.comPhone
    || customer?.resPhone
    || ""
  ).trim();
}

function getCompanySignatureLines(profile) {
  const company = profile && typeof profile === "object" ? profile : null;
  const contactName = String(company?.attn || "").trim();
  const companyName = String(company?.companyName || "").trim();
  const phone = String(company?.phone || "").trim();
  const email = String(company?.email || "").trim();
  const website = String(company?.website || "").trim();
  const roc = String(company?.roc || "").trim();

  if (!contactName && !companyName && !phone && !email && !website && !roc) {
    return ["EstiPaid"];
  }

  return [
    contactName,
    contactName && companyName ? companyName : (contactName ? "" : companyName),
    phone,
    email,
    website ? `Website: ${website}` : "",
    roc ? `ROC: ${roc}` : "",
  ].filter(Boolean);
}

function resolveAgingBucket(daysLate, lang = "en") {
  if (daysLate <= 0) {
    return {
      key: "current",
      label: lang === "es" ? "Actual" : "Current",
      riskRank: 0,
      color: "rgba(255,255,255,0.55)",
    };
  }
  if (daysLate <= 15) {
    return {
      key: "late1_15",
      label: "1-15",
      riskRank: 1,
      color: "rgba(34,197,94,0.70)",
    };
  }
  if (daysLate <= 30) {
    return {
      key: "late16_30",
      label: "16-30",
      riskRank: 2,
      color: "rgba(245,158,11,0.78)",
    };
  }
  if (daysLate <= 60) {
    return {
      key: "late31_60",
      label: "31-60",
      riskRank: 3,
      color: "rgba(249,115,22,0.82)",
    };
  }
  return {
    key: "late60p",
    label: "60+",
    riskRank: 4,
    color: "rgba(239,68,68,0.82)",
  };
}

function getMarginTone(marginPct) {
  if (marginPct >= 30) return "healthy";
  if (marginPct >= 20) return "caution";
  return "risk";
}

function hasKnownCost(doc) {
  const directCost = doc?.financials?.totalCost ?? doc?.totals?.totalCost ?? doc?.totalCost;
  if (directCost !== undefined && directCost !== null && String(directCost) !== "") return true;

  const directGrossProfit = doc?.financials?.grossProfit ?? doc?.totals?.grossProfit ?? doc?.grossProfit;
  if (directGrossProfit !== undefined && directGrossProfit !== null && String(directGrossProfit) !== "") return true;

  const directInternalCost = doc?.financials?.internalCost ?? doc?.totals?.internalCost ?? doc?.internalCost;
  if (directInternalCost !== undefined && directInternalCost !== null && String(directInternalCost) !== "") return true;

  const laborLines = Array.isArray(doc?.labor?.lines) ? doc.labor.lines : (Array.isArray(doc?.laborLines) ? doc.laborLines : []);
  if (laborLines.some((line) => {
    const v = line?.trueRateInternal ?? line?.internalRate ?? line?.rateInternal;
    return v !== undefined && v !== null && String(v) !== "";
  })) return true;

  const materialItems = Array.isArray(doc?.materials?.items) ? doc.materials.items : (Array.isArray(doc?.materialItems) ? doc.materialItems : []);
  if (materialItems.some((item) => {
    const v = item?.unitCostInternal ?? item?.costInternal ?? item?.internalCost ?? item?.internalEach ?? item?.internalPrice;
    return v !== undefined && v !== null && String(v) !== "";
  })) return true;

  const blanketInternalCost = doc?.materials?.blanketInternalCost ?? doc?.blanketInternalCost;
  if (blanketInternalCost !== undefined && blanketInternalCost !== null && String(blanketInternalCost) !== "") return true;

  return false;
}

function buildFollowUpMailto(row, companyProfile, lang = "en") {
  const subject = `Invoice ${row.invoiceNumber || row.invoiceLabel} follow-up`;
  const detailsLines = [
    lang === "es" ? "Detalles de la factura:" : "Invoice details:",
    `${lang === "es" ? "- Saldo pendiente" : "- Amount due"}: ${fmtMoney(row.balanceDue)}`,
    `${lang === "es" ? "- Fecha de vencimiento" : "- Due date"}: ${row.dueDateLabel}`,
    row.projectName ? `${lang === "es" ? "- Proyecto" : "- Project"}: ${row.projectName}` : "",
  ].filter(Boolean);
  const signatureLines = getCompanySignatureLines(companyProfile);
  const bodySections = [
    lang === "es" ? `Hola ${row.customerName},` : `Hi ${row.customerName},`,
    lang === "es"
      ? `Quería dar seguimiento a la factura ${row.invoiceNumber || row.invoiceLabel}.`
      : `I wanted to follow up on invoice ${row.invoiceNumber || row.invoiceLabel}.`,
    detailsLines.join("\n"),
    lang === "es"
      ? "Avíseme si necesita una copia de la factura o si tiene alguna pregunta."
      : "Please let me know if you need a copy of the invoice or have any questions.",
    [lang === "es" ? "Gracias," : "Thank you,", "", ...signatureLines].join("\n"),
  ];
  const body = bodySections.join("\n\n");
  return `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function normalizeEstimatePipelineStatus(status) {
  const raw = String(status || "").trim().toLowerCase();
  if (raw === "approved") return "approved";
  if (raw === "lost") return "lost";
  if (raw === "draft") return "draft";
  if (raw === "sent") return "pending";
  return "pending";
}

function buildEstimateFollowUpMailto(row, companyProfile, lang = "en") {
  const subject = lang === "es"
    ? `Seguimiento de estimado ${row.estimateLabel}`
    : `Estimate ${row.estimateLabel} follow-up`;
  const signatureLines = getCompanySignatureLines(companyProfile);
  const projectName = String(row?.projectName || "").trim();
  const isApproved = String(row?.statusKey || "").trim().toLowerCase() === "approved";
  const introProject = projectName ? `${lang === "es" ? " para " : " for "}${projectName}` : "";
  const statusLabel = String(
    row?.statusLabel
    || (isApproved
      ? (lang === "es" ? "Aprobado" : "Approved")
      : (lang === "es" ? "Pendiente" : "Pending"))
  ).trim();
  const detailsLines = isApproved
    ? [
      lang === "es" ? "Detalles del estimado:" : "Estimate details:",
      `${lang === "es" ? "- Monto aprobado" : "- Approved amount"}: ${fmtMoney(row.total)}`,
      `${lang === "es" ? "- Pendiente por facturar" : "- Remaining to invoice"}: ${fmtMoney(row.remainingToInvoice)}`,
      projectName ? `${lang === "es" ? "- Proyecto" : "- Project"}: ${projectName}` : "",
    ].filter(Boolean)
    : [
      lang === "es" ? "Detalles del estimado:" : "Estimate details:",
      `${lang === "es" ? "- Monto del estimado" : "- Estimate amount"}: ${fmtMoney(row.total)}`,
      `${lang === "es" ? "- Estado" : "- Status"}: ${statusLabel}`,
      projectName ? `${lang === "es" ? "- Proyecto" : "- Project"}: ${projectName}` : "",
    ].filter(Boolean);
  const body = [
    lang === "es" ? `Hola ${row.customerName},` : `Hi ${row.customerName},`,
    isApproved
      ? (
        lang === "es"
          ? `Gracias por aprobar el estimado ${row.estimateLabel}${introProject}.`
          : `Thank you for approving estimate ${row.estimateLabel}${introProject}.`
      )
      : (
        lang === "es"
          ? `Quería dar seguimiento al estimado ${row.estimateLabel}${introProject}.`
          : `I wanted to follow up on estimate ${row.estimateLabel}${introProject}.`
      ),
    detailsLines.join("\n"),
    isApproved
      ? (
        lang === "es"
          ? "Avíseme si hay algún detalle de facturación que quiera incluir en la factura."
          : "Please let me know if there are any billing details you would like included on the invoice."
      )
      : (
        lang === "es"
          ? "Avíseme si tiene alguna pregunta o si le gustaría seguir adelante."
          : "Please let me know if you have any questions or if you would like to move forward."
      ),
    [lang === "es" ? "Gracias," : "Thank you,", "", ...signatureLines].join("\n"),
  ].join("\n\n");
  return `mailto:${encodeURIComponent(row.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
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

function getInvoiceChartDate(invoice) {
  const cands = [invoice?.invoiceDate, invoice?.date, invoice?.job?.date, invoice?.createdAt, invoice?.updatedAt, invoice?.ts];
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
      snapshotStatus: String(entry?.status || "").trim().toLowerCase(),
      status: normalizeEstimateStatus(entry?.status),
    }));
}

function normalizeEstimateLifecycleStatus(status) {
  const raw = String(status || "").trim().toLowerCase();
  if (raw === "approved") return "approved";
  if (raw === "lost") return "lost";
  if (raw === "draft") return "draft";
  return "pending";
}

function normalizeProjectLifecycleStatus(status) {
  const raw = String(status || "").trim().toLowerCase();
  if (raw === "completed" || raw === "complete") return "completed";
  if (raw === "estimating") return "estimating";
  if (raw === "draft") return "draft";
  if (raw === "archived" || raw === "closed" || raw === "inactive") return "archived";
  return "active";
}

function getTimeRangeStart(rangeKey) {
  const now = new Date();
  const today = startOfDay(now);

  if (rangeKey === "30") return addDays(today, -30);
  if (rangeKey === "90") return addDays(today, -90);

  const y = today.getFullYear();
  return new Date(y, 0, 1);
}

function parseInputDate(value, mode = "start") {
  const raw = String(value || "").trim();
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const parsed = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return mode === "end" ? endOfDay(parsed) : startOfDay(parsed);
}

function resolveSnapshotRange(rangeKey, customStartDate, customEndDate) {
  const now = new Date();
  const todayStart = startOfDay(now);
  const todayEnd = endOfDay(now);

  if (rangeKey === "custom") {
    const customStart = parseInputDate(customStartDate, "start");
    const customEnd = parseInputDate(customEndDate, "end");
    if (customStart && customEnd && customStart.getTime() <= customEnd.getTime()) {
      return {
        start: customStart,
        end: customEnd,
        isCustomApplied: true,
        isCustomInvalid: false,
      };
    }
    return {
      start: new Date(todayStart.getFullYear(), 0, 1),
      end: todayEnd,
      isCustomApplied: false,
      isCustomInvalid: true,
    };
  }

  return {
    start: getTimeRangeStart(rangeKey === "ytd" ? "ytd" : rangeKey),
    end: todayEnd,
    isCustomApplied: false,
    isCustomInvalid: false,
  };
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

function buildWeeklySeries(invoices, { nowTs = Date.now(), endDate = new Date() } = {}) {
  const chartEnd = startOfDay(endDate);
  const weeks = [];
  const start = addDays(chartEnd, -7 * 11);
  for (let i = 0; i < 12; i++) {
    const wStart = addDays(start, i * 7);
    const key = weekKey(wStart);
    weeks.push({ key, start: wStart, revenue: 0, profit: 0, paid: 0, sent: 0, overdue: 0, other: 0 });
  }
  const idx = new Map(weeks.map((w, i) => [w.key, i]));

  for (const inv of invoices) {
    const d = getInvoiceChartDate(inv);
    if (!d) continue;
    const k = weekKey(d);
    const i = idx.get(k);
    if (i === undefined) continue;
    const rev = calcRevenue(inv);
    weeks[i].revenue += rev;
    weeks[i].profit += calcGrossProfit(inv);
    const status = deriveInvoiceStatus(inv, nowTs);
    if (status === INVOICE_STATUSES.PAID) weeks[i].paid += rev;
    else if (status === INVOICE_STATUSES.OVERDUE) weeks[i].overdue += rev;
    else if (status === INVOICE_STATUSES.SENT) weeks[i].sent += rev;
    else weeks[i].other += rev;
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

function Bars({ data, height = 196, width = 320 }) {
  const max = Math.max(1, ...data.map((d) => asNumber(d.revenue)));

  const ML = 46;  // left margin — Y-axis labels
  const MR = 6;   // right margin
  const MT = 24;  // top margin — value labels
  const MB = 30;  // bottom margin — X-axis labels

  const plotW = width - ML - MR;
  const plotH = height - MT - MB;
  const baseY = MT + plotH;
  const midY  = MT + plotH / 2;

  const barSlot = plotW / Math.max(1, data.length);
  const barW    = Math.max(4, Math.floor(barSlot * 0.62));
  const barPad  = (barSlot - barW) / 2;

  function fmtCompact(n) {
    const v = asNumber(n);
    if (v === 0) return "$0";
    if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`;
    if (v >= 1000)    return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k`;
    return `$${Math.round(v)}`;
  }

  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

  const SEG_COLORS = {
    overdue: "rgba(249,115,22,0.75)",
    sent:    "rgba(96,165,250,0.75)",
    paid:    "rgba(34,197,94,0.72)",
    other:   "rgba(156,163,175,0.40)",
  };

  // One label per calendar month, centered over that month's bar group
  const monthLabels = (() => {
    const seen = new Set();
    const result = [];
    data.forEach((d) => {
      if (!(d.start instanceof Date)) return;
      const m = d.start.getMonth();
      if (seen.has(m)) return;
      seen.add(m);
      const indices = data.reduce((acc, dd, ii) => {
        if (dd.start instanceof Date && dd.start.getMonth() === m) acc.push(ii);
        return acc;
      }, []);
      const bxFirst = ML + indices[0] * barSlot + barPad + barW / 2;
      const bxLast  = ML + indices[indices.length - 1] * barSlot + barPad + barW / 2;
      result.push({ label: MON[m], cx: (bxFirst + bxLast) / 2 });
    });
    return result;
  })();

  return (
    <>
      <svg
        className="pe-snapshot-bars"
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Weekly revenue trend by invoice status"
      >
        {/* mid grid line */}
        <line x1={ML} y1={midY} x2={width - MR} y2={midY}
          stroke="rgba(255,255,255,0.07)" strokeDasharray="4 4" />

        {/* baseline */}
        <line x1={ML} y1={baseY} x2={width - MR} y2={baseY}
          stroke="rgba(255,255,255,0.18)" />

        {/* Y-axis scale */}
        <text x={ML - 4} y={MT + 4}    textAnchor="end" fill="rgba(229,231,235,0.45)" fontSize="9" fontWeight="600">{fmtCompact(max)}</text>
        <text x={ML - 4} y={midY + 4}  textAnchor="end" fill="rgba(229,231,235,0.35)" fontSize="9" fontWeight="600">{fmtCompact(max / 2)}</text>
        <text x={ML - 4} y={baseY + 4} textAnchor="end" fill="rgba(229,231,235,0.28)" fontSize="9" fontWeight="600">$0</text>

        {data.map((d, i) => {
          const total = asNumber(d.revenue);
          const bx    = ML + i * barSlot + barPad;

          // Stacked segments bottom-to-top: overdue → sent → paid → other
          const segDefs = [
            { key: "overdue", v: asNumber(d.overdue), color: SEG_COLORS.overdue },
            { key: "sent",    v: asNumber(d.sent),    color: SEG_COLORS.sent },
            { key: "paid",    v: asNumber(d.paid),    color: SEG_COLORS.paid },
            { key: "other",   v: asNumber(d.other),   color: SEG_COLORS.other },
          ].filter((s) => s.v > 0);

          const rects = segDefs.reduce((acc, { key, v, color }) => {
            const prevY = acc.length > 0 ? acc[acc.length - 1].y : baseY;
            const h = Math.max(2, (v / max) * plotH);
            acc.push({ key, y: prevY - h, h, color });
            return acc;
          }, []);

          const topY = rects.length > 0 ? rects[rects.length - 1].y : baseY;

          return (
            <g key={d.key}>
              {rects.map(({ key, y, h, color }) => (
                <rect key={key} x={bx} y={y} width={barW} height={h} rx="3" ry="3" fill={color} />
              ))}

              {total > 0 && (
                <text
                  x={bx + barW / 2}
                  y={topY - 4}
                  textAnchor="middle"
                  fill="rgba(229,231,235,0.78)"
                  fontSize="8.5"
                  fontWeight="700"
                >
                  {fmtCompact(total)}
                </text>
              )}

            </g>
          );
        })}

        {monthLabels.map(({ label, cx }) => (
          <text key={label} x={cx} y={height - 4} textAnchor="middle" fill="rgba(229,231,235,0.38)" fontSize="9" fontWeight="600">
            {label}
          </text>
        ))}
      </svg>

      <div style={{ display: "flex", gap: 14, marginTop: 8, flexWrap: "wrap" }}>
        {[
          { color: SEG_COLORS.paid,    label: "Paid" },
          { color: SEG_COLORS.sent,    label: "Sent" },
          { color: SEG_COLORS.overdue, label: "Overdue" },
        ].map(({ color, label }) => (
          <div key={label} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 3, background: color, display: "inline-block", flexShrink: 0 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(229,231,235,0.50)" }}>{label}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export default function FinancialSnapshotScreen({ lang = "en", spinTick = 0, onCreateInvoiceFromEstimate = null }) {
  const [range, setRange] = useState("ytd");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [companyProfile, setCompanyProfile] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [projects, setProjects] = useState([]);
  const [estimates, setEstimates] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [invoiceDateFlags, setInvoiceDateFlags] = useState({});
  const [marginFilter, setMarginFilter] = useState("all");
  const [expandedMarginId, setExpandedMarginId] = useState(null);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const topRef       = useRef(null);
  const overviewRef  = useRef(null);
  const revenueRef   = useRef(null);
  const arRef        = useRef(null);
  const marginRef    = useRef(null);
  const pipelineRef  = useRef(null);
  const summaryRef   = useRef(null);

  const resolvedRange = useMemo(
    () => resolveSnapshotRange(range, customStartDate, customEndDate),
    [range, customStartDate, customEndDate]
  );

  useEffect(() => {
    const collectInvoiceIdentityKeys = (invoice) => {
      const keys = new Set();
      const id = String(invoice?.id || "").trim();
      const invoiceNumber = String(invoice?.invoiceNumber || invoice?.job?.docNumber || "").trim();
      if (id) keys.add(`id:${id}`);
      if (invoiceNumber) keys.add(`num:${invoiceNumber}`);
      return [...keys];
    };
    const buildInvoiceDateFlags = () => {
      const rawInvoices = [
        ...loadArray(INVOICES_KEY),
        ...loadArray(ESTIMATES_KEY).filter((entry) => String(entry?.docType || "").toLowerCase() === "invoice"),
      ];
      return rawInvoices.reduce((flags, invoice) => {
        const hasRealDate = Boolean(parseDateAny(invoice?.invoiceDate || invoice?.date || invoice?.job?.date));
        collectInvoiceIdentityKeys(invoice).forEach((key) => {
          flags[key] = hasRealDate;
        });
        return flags;
      }, {});
    };
    const refresh = () => {
      setCompanyProfile(loadObject(COMPANY_PROFILE_KEY));
      setCustomers(loadArray(CUSTOMERS_KEY));
      setProjects(readStoredProjects());
      setEstimates(readSavedEstimates());
      setInvoices(readStoredInvoices());
      setInvoiceDateFlags(buildInvoiceDateFlags());
    };
    refresh();

    const onStorage = (e) => {
      if (!e) return;
      if (
        e.key === COMPANY_PROFILE_KEY
        || e.key === CUSTOMERS_KEY
        || e.key === PROJECTS_KEY
        || e.key === ESTIMATES_KEY
        || e.key === INVOICES_KEY
      ) refresh();
    };
    const onLocalStorage = (event) => {
      const key = String(event?.detail?.key || "").trim();
      if (
        key === COMPANY_PROFILE_KEY
        || key === CUSTOMERS_KEY
        || key === PROJECTS_KEY
        || key === ESTIMATES_KEY
        || key === INVOICES_KEY
      ) refresh();
    };
    const onEstimatesChanged = () => refresh();
    const onInvoicesChanged = () => refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("estipaid:estimates-changed", onEstimatesChanged);
    window.addEventListener("estipaid:invoices-changed", onInvoicesChanged);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:estimates-changed", onEstimatesChanged);
      window.removeEventListener("estipaid:invoices-changed", onInvoicesChanged);
    };
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 280);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleCreateInvoiceFromEstimate = (estimate) => {
    if (!estimate || normalizeEstimateStatus(estimate?.status) !== "approved") {
      return false;
    }
    if (typeof onCreateInvoiceFromEstimate !== "function") {
      return false;
    }
    return onCreateInvoiceFromEstimate(estimate) !== false;
  };

  const computed = useMemo(() => {
    const now = startOfDay(new Date());
    const start = resolvedRange.start;
    const end = resolvedRange.end;
    const getInvoiceIdentityKeys = (invoice) => {
      const keys = new Set();
      const id = String(invoice?.id || "").trim();
      const invoiceNumber = String(invoice?.invoiceNumber || invoice?.job?.docNumber || "").trim();
      if (id) keys.add(`id:${id}`);
      if (invoiceNumber) keys.add(`num:${invoiceNumber}`);
      return [...keys];
    };
    const hasRealInvoiceDate = (invoice) => {
      const keys = getInvoiceIdentityKeys(invoice);
      if (keys.length === 0) return false;
      return keys.some((key) => invoiceDateFlags[key] === true);
    };

    const customerAll = (Array.isArray(customers) ? customers : []).filter(Boolean);
    const projectAll = (Array.isArray(projects) ? projects : []).filter(Boolean);
    const invAll = (Array.isArray(invoices) ? invoices : []).filter(Boolean);
    const estAll = (Array.isArray(estimates) ? estimates : []).filter(Boolean);
    const committedInvoices = invAll.filter((invoice) => isInvoiceFinanciallyCommitted(invoice, now.getTime()));
    const datedCommittedInvoices = committedInvoices.filter((invoice) => hasRealInvoiceDate(invoice));
    const missingInvoiceDateCount = committedInvoices.length - datedCommittedInvoices.length;

    const activeInvoices = datedCommittedInvoices
      .filter((invoice) => inRange(getDocDate(invoice), start, end))
      .filter(Boolean);
    const revenue = activeInvoices.reduce((sum, invoice) => sum + calcRevenue(invoice), 0);
    const grossProfit = activeInvoices.reduce((sum, invoice) => sum + calcGrossProfit(invoice), 0);
    const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    const receivables = activeInvoices.filter((invoice) => isInvoiceReceivable(invoice, now.getTime()));
    const arTotal = receivables.reduce((sum, invoice) => sum + getReceivableAmount(invoice), 0);
    const customerById = new Map(
      customerAll
        .map((customer) => [String(customer?.id || "").trim(), customer])
        .filter(([id]) => id)
    );
    const projectById = new Map(
      projectAll
        .map((project) => [String(project?.id || "").trim(), project])
        .filter(([id]) => id)
    );

    const aging = { current: 0, current_n: 0, late1_15: 0, late1_15_n: 0, late16_30: 0, late16_30_n: 0, late30p: 0, late30p_n: 0, delinquentTotal: 0, canCompute: true };

    for (const inv of receivables) {
      const due = getDueDate(inv);
      if (!due) {
        aging.canCompute = false;
        continue;
      }
      const daysLate = Math.floor((startOfDay(now).getTime() - startOfDay(due).getTime()) / 86400000);
      const amt = getReceivableAmount(inv);
      if (daysLate <= 0) { aging.current += amt; aging.current_n += 1; }
      else if (daysLate <= 15) { aging.late1_15 += amt; aging.late1_15_n += 1; }
      else if (daysLate <= 30) { aging.late16_30 += amt; aging.late16_30_n += 1; }
      else { aging.late30p += amt; aging.late30p_n += 1; }

      if (daysLate > 0) aging.delinquentTotal += amt;
    }

    const arBuckets = [
      { key: "current", label: lang === "es" ? "Actual" : "Current", amount: 0, count: 0, color: "rgba(255,255,255,0.55)", riskRank: 0 },
      { key: "late1_15", label: "1-15", amount: 0, count: 0, color: "rgba(34,197,94,0.70)", riskRank: 1 },
      { key: "late16_30", label: "16-30", amount: 0, count: 0, color: "rgba(245,158,11,0.78)", riskRank: 2 },
      { key: "late31_60", label: "31-60", amount: 0, count: 0, color: "rgba(249,115,22,0.82)", riskRank: 3 },
      { key: "late60p", label: "60+", amount: 0, count: 0, color: "rgba(239,68,68,0.82)", riskRank: 4 },
    ];
    const arBucketIndex = new Map(arBuckets.map((bucket, index) => [bucket.key, index]));
    const arRows = receivables.map((invoice) => {
      const dueDate = getDueDate(invoice);
      const daysLate = dueDate
        ? Math.floor((startOfDay(now).getTime() - startOfDay(dueDate).getTime()) / 86400000)
        : 0;
      const bucket = resolveAgingBucket(daysLate, lang);
      const customerId = String(invoice?.customerId || invoice?.customer?.id || "").trim();
      const linkedCustomer = customerById.get(customerId) || null;
      const linkedProject = projectById.get(String(invoice?.projectId || "").trim()) || null;
      const customerName = String(
        invoice?.customerName
        || invoice?.customer?.name
        || getCustomerDisplayName(linkedCustomer)
        || "Unknown customer"
      ).trim();
      const email = String(
        invoice?.customer?.email
        || invoice?.email
        || getCustomerEmail(linkedCustomer)
        || ""
      ).trim();
      const phone = String(
        invoice?.customer?.phone
        || invoice?.phone
        || getCustomerPhone(linkedCustomer)
        || ""
      ).trim();
      const balanceDue = getReceivableAmount(invoice);
      const amountPaid = asNumber(invoice?.amountPaid);
      const invoiceTotal = calcRevenue(invoice);
      const status = deriveInvoiceStatus(invoice, now.getTime());
      const projectName = String(
        invoice?.projectName
        || invoice?.job?.projectName
        || linkedProject?.projectName
        || linkedProject?.projectNumber
        || ""
      ).trim();
      const invoiceNumber = String(invoice?.invoiceNumber || invoice?.job?.docNumber || "").trim();
      const entry = {
        id: String(invoice?.id || invoiceNumber || `${customerName}-${balanceDue}`),
        invoiceNumber,
        invoiceLabel: invoiceNumber || (lang === "es" ? "Sin número" : "No number"),
        customerName,
        email,
        phone,
        phoneHref: cleanPhone(phone),
        projectName,
        invoiceTotal,
        amountPaid,
        balanceDue,
        dueDate,
        dueDateLabel: fmtDateShort(dueDate),
        daysLate,
        bucketKey: bucket.key,
        bucketLabel: bucket.label,
        bucketColor: bucket.color,
        status,
        isPartial: amountPaid > 0 && balanceDue > 0,
      };
      const bucketIndex = arBucketIndex.get(bucket.key);
      if (bucketIndex !== undefined) {
        arBuckets[bucketIndex].amount += balanceDue;
        arBuckets[bucketIndex].count += 1;
      }
      return entry;
    }).sort((a, b) => {
      const riskDiff = resolveAgingBucket(b.daysLate, lang).riskRank - resolveAgingBucket(a.daysLate, lang).riskRank;
      if (riskDiff !== 0) return riskDiff;
      if (a.daysLate > 0 || b.daysLate > 0) {
        if (b.daysLate !== a.daysLate) return b.daysLate - a.daysLate;
        if (b.balanceDue !== a.balanceDue) return b.balanceDue - a.balanceDue;
      } else {
        const aPriority = a.isPartial || a.status === INVOICE_STATUSES.SENT ? 1 : 0;
        const bPriority = b.isPartial || b.status === INVOICE_STATUSES.SENT ? 1 : 0;
        if (bPriority !== aPriority) return bPriority - aPriority;
        if (b.balanceDue !== a.balanceDue) return b.balanceDue - a.balanceDue;
      }
      return String(a.customerName).localeCompare(String(b.customerName));
    });
    const atRiskRows = arRows.filter((row) => row.daysLate > 15 || row.balanceDue >= 2500).slice(0, 5);

    const estimateStatusEntries = estAll.map((estimate) => ({
      estimate,
      statusKey: normalizeEstimatePipelineStatus(estimate?.snapshotStatus || estimate?.status),
      estimateDate: getDocDate(estimate),
    }));
    const estimatesInRange = estimateStatusEntries
      .filter(({ estimateDate }) => inRange(estimateDate, start, end))
      .map(({ estimate }) => estimate);
    const pipelineEstimates = estimateStatusEntries
      .filter(({ statusKey, estimateDate }) => statusKey === "pending" && inRange(estimateDate, start, end))
      .map(({ estimate }) => estimate);
    const approvedInRange = estimateStatusEntries
      .filter(({ statusKey, estimateDate }) => statusKey === "approved" && inRange(estimateDate, start, end))
      .map(({ estimate }) => estimate);

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
    const pipelineBuckets = [
      { key: "draft", label: lang === "es" ? "Borrador" : "Draft", count: 0, value: 0, color: "rgba(156,163,175,0.75)" },
      { key: "pending", label: lang === "es" ? "Pendiente / enviado" : "Pending / sent", count: 0, value: 0, color: "rgba(96,165,250,0.78)" },
      { key: "approved", label: lang === "es" ? "Aprobado" : "Approved", count: 0, value: 0, color: "rgba(34,197,94,0.78)" },
      { key: "lost", label: lang === "es" ? "Perdido" : "Lost", count: 0, value: 0, color: "rgba(239,68,68,0.78)" },
    ];
    const pipelineBucketIndex = new Map(pipelineBuckets.map((bucket, index) => [bucket.key, index]));
    const pipelineRows = estimatesInRange.map((estimate, index) => {
      const customerId = String(estimate?.customerId || estimate?.customer?.id || "").trim();
      const linkedCustomer = customerById.get(customerId) || null;
      const linkedProject = projectById.get(String(estimate?.projectId || "").trim()) || null;
      const statusKey = normalizeEstimatePipelineStatus(estimate?.snapshotStatus || estimate?.status);
      const total = calcRevenue(estimate);
      const estimateDate = getDocDate(estimate);
      const ageDays = estimateDate ? Math.floor((startOfDay(now).getTime() - startOfDay(estimateDate).getTime()) / 86400000) : 0;
      const summary = buildEstimateInvoiceSummary(estimate, invAll);
      const remainingToInvoice = Math.max(0, asNumber(summary?.remainingToInvoice));
      const row = {
        id: String(estimate?.id || `estimate-${index}`),
        sourceEstimate: estimate,
        estimateNumber: String(estimate?.estimateNumber || estimate?.job?.docNumber || "").trim(),
        estimateLabel: String(estimate?.estimateNumber || estimate?.job?.docNumber || (lang === "es" ? "Sin número" : "No number")).trim(),
        customerName: String(
          estimate?.customerName
          || estimate?.customer?.name
          || getCustomerDisplayName(linkedCustomer)
          || (lang === "es" ? "Cliente sin nombre" : "Unnamed customer")
        ).trim(),
        email: String(
          estimate?.customer?.email
          || estimate?.email
          || getCustomerEmail(linkedCustomer)
          || ""
        ).trim(),
        projectName: String(
          estimate?.projectName
          || estimate?.job?.projectName
          || linkedProject?.projectName
          || linkedProject?.projectNumber
          || ""
        ).trim(),
        statusKey,
        statusLabel: statusKey === "draft"
          ? (lang === "es" ? "Borrador" : "Draft")
          : statusKey === "approved"
          ? (lang === "es" ? "Aprobado" : "Approved")
          : statusKey === "lost"
          ? (lang === "es" ? "Perdido" : "Lost")
          : (lang === "es" ? "Pendiente" : "Pending"),
        total,
        estimateDate,
        estimateDateLabel: estimateDate ? fmtDateShort(estimateDate) : "",
        ageDays,
        remainingToInvoice,
      };
      const bucketIndex = pipelineBucketIndex.get(statusKey);
      if (bucketIndex !== undefined) {
        pipelineBuckets[bucketIndex].count += 1;
        pipelineBuckets[bucketIndex].value += total;
      }
      return row;
    }).sort((a, b) => {
      const priority = { approved: 0, pending: 1, draft: 2, lost: 3 };
      const prioDiff = (priority[a.statusKey] ?? 9) - (priority[b.statusKey] ?? 9);
      if (prioDiff !== 0) return prioDiff;
      if (a.statusKey === "approved") {
        if (b.remainingToInvoice !== a.remainingToInvoice) return b.remainingToInvoice - a.remainingToInvoice;
      }
      if (a.statusKey === "pending") {
        if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays;
      }
      if (b.total !== a.total) return b.total - a.total;
      return a.customerName.localeCompare(b.customerName);
    });
    const approvedReadyRows = pipelineRows
      .filter((row) => row.statusKey === "approved" && row.remainingToInvoice > 0)
      .sort((a, b) => b.remainingToInvoice - a.remainingToInvoice)
      .slice(0, 5);
    const pendingFollowUpRows = pipelineRows
      .filter((row) => row.statusKey === "pending")
      .sort((a, b) => {
        if (b.ageDays !== a.ageDays) return b.ageDays - a.ageDays;
        return b.total - a.total;
      })
      .slice(0, 5);

    const chartRangeInvoices = datedCommittedInvoices.filter((invoice) => {
      const chartDate = getInvoiceChartDate(invoice);
      if (!chartDate) return false;
      return chartDate.getTime() >= start.getTime() && chartDate.getTime() <= end.getTime();
    });
    const latestChartDate = chartRangeInvoices.reduce((latest, invoice) => {
      const chartDate = getInvoiceChartDate(invoice);
      if (!chartDate) return latest;
      return chartDate.getTime() > latest.getTime() ? chartDate : latest;
    }, end);
    const weekly = buildWeeklySeries(chartRangeInvoices, {
      nowTs: now.getTime(),
      endDate: latestChartDate,
    });

    const withRevenue = activeInvoices.filter((invoice) => calcRevenue(invoice) > 0);
    const customerMarginMap = new Map();
    withRevenue.forEach((invoice, index) => {
      const customerId = String(invoice?.customerId || invoice?.customer?.id || "").trim();
      const customerName = String(
        invoice?.customerName
        || invoice?.customer?.name
        || invoice?.customer?.companyName
        || invoice?.customer?.fullName
        || ""
      ).trim();
      const key = customerId || customerName.toLowerCase() || `unknown-${index}`;
      const revenue = calcRevenue(invoice);
      const knownCost = hasKnownCost(invoice);
      const cost = knownCost ? calcCost(invoice) : 0;
      const grossProfit = knownCost ? calcGrossProfit(invoice) : 0;
      const detail = {
        id: String(invoice?.id || `${key}-${index}`),
        invoiceNumber: String(invoice?.invoiceNumber || invoice?.job?.docNumber || "").trim(),
        invoiceLabel: String(invoice?.invoiceNumber || invoice?.job?.docNumber || (lang === "es" ? "Sin número" : "No number")).trim(),
        projectName: String(invoice?.projectName || invoice?.job?.projectName || "").trim(),
        revenue,
        cost,
        grossProfit,
        marginPct: knownCost ? calcMarginPct(invoice) : null,
        knownCost,
      };
      if (!customerMarginMap.has(key)) {
        customerMarginMap.set(key, {
          id: key,
          customerId,
          customerName: customerName || (lang === "es" ? "Cliente sin nombre" : "Unnamed customer"),
          revenue: 0,
          cost: 0,
          grossProfit: 0,
          invoiceCount: 0,
          knownCostInvoiceCount: 0,
          unknownCostInvoiceCount: 0,
          details: [],
        });
      }
      const group = customerMarginMap.get(key);
      group.invoiceCount += 1;
      if (knownCost) {
        group.revenue += revenue;
        group.cost += cost;
        group.grossProfit += grossProfit;
        group.knownCostInvoiceCount += 1;
      } else {
        group.unknownCostInvoiceCount += 1;
      }
      group.details.push(detail);
    });
    const customerMargins = [...customerMarginMap.values()]
      .filter((group) => group.knownCostInvoiceCount > 0)
      .map((group) => ({
        ...group,
        marginPct: group.revenue > 0 ? (group.grossProfit / group.revenue) * 100 : 0,
        tone: getMarginTone(group.revenue > 0 ? (group.grossProfit / group.revenue) * 100 : 0),
        details: group.details.slice().sort((a, b) => b.revenue - a.revenue),
      }))
      .sort((a, b) => b.marginPct - a.marginPct);
    const unknownCostCustomers = [...customerMarginMap.values()]
      .filter((group) => group.knownCostInvoiceCount === 0 && group.unknownCostInvoiceCount > 0)
      .map((group) => ({
        ...group,
        unknownRevenue: group.details.reduce((sum, detail) => sum + detail.revenue, 0),
        details: group.details.slice().sort((a, b) => b.revenue - a.revenue),
      }))
      .sort((a, b) => b.unknownRevenue - a.unknownRevenue);

    const statusCounts = activeInvoices.reduce((counts, invoice) => {
      const status = deriveInvoiceStatus(invoice, now.getTime());
      counts.total += 1;
      if (status === INVOICE_STATUSES.PAID) counts.paid += 1;
      else if (status === INVOICE_STATUSES.OVERDUE) counts.overdue += 1;
      else if (status === INVOICE_STATUSES.SENT) counts.sent += 1;
      else counts.draft += 1;
      return counts;
    }, { total: 0, draft: 0, sent: 0, paid: 0, overdue: 0 });

    const customerCount = customerAll.length;
    const projectCounts = projectAll.reduce((counts, project) => {
      counts.total += 1;
      counts[normalizeProjectLifecycleStatus(project?.status)] += 1;
      return counts;
    }, { total: 0, active: 0, completed: 0, estimating: 0, draft: 0, archived: 0 });

    const estimateCounts = estAll.reduce((counts, estimate) => {
      counts.total += 1;
      counts[normalizeEstimateLifecycleStatus(estimate?.snapshotStatus || estimate?.status)] += 1;
      return counts;
    }, { total: 0, approved: 0, pending: 0, draft: 0, lost: 0 });

    const invoiceTotals = invAll.reduce((totals, invoice) => {
      const status = deriveInvoiceStatus(invoice, now.getTime());
      const invoiceTotal = calcRevenue(invoice);
      const amountPaid = asNumber(invoice?.amountPaid);
      const balanceRemaining = getReceivableAmount(invoice);
      totals.total += 1;
      totals.totalValue += invoiceTotal;
      totals.paidValue += amountPaid;
      totals.outstandingValue += balanceRemaining;
      if (status === INVOICE_STATUSES.PAID) totals.paid += 1;
      else if (status === INVOICE_STATUSES.OVERDUE) {
        totals.overdue += 1;
        totals.overdueValue += balanceRemaining;
      } else if (status === INVOICE_STATUSES.SENT) totals.sent += 1;
      else {
        totals.draft += 1;
        totals.draftValue += invoiceTotal;
      }
      if (amountPaid > 0 && balanceRemaining > 0) {
        totals.partial += 1;
        totals.partialValue += balanceRemaining;
      }
      return totals;
    }, {
      total: 0,
      paid: 0,
      sent: 0,
      overdue: 0,
      draft: 0,
      partial: 0,
      totalValue: 0,
      paidValue: 0,
      outstandingValue: 0,
      overdueValue: 0,
      draftValue: 0,
      partialValue: 0,
    });

    return {
      customerCount,
      projectCounts,
      estimateCounts,
      missingInvoiceDateCount,
      invoiceTotals,
      revenue,
      grossProfit,
      marginPct,
      arTotal,
      delinquentTotal: aging.delinquentTotal,
      aging,
      arBuckets,
      arRows,
      atRiskRows,
      pipelineBuckets,
      pipelineRows,
      approvedReadyRows,
      pendingFollowUpRows,
      weekly,
      pipelineValue,
      pipelineCount,
      avgEstimate,
      approvedReadyValue,
      approvedReadyCount,
      customerMargins,
      unknownCostCustomers,
      invCount: activeInvoices.length,
      statusCounts,
    };
  }, [lang, customers, projects, estimates, invoices, invoiceDateFlags, resolvedRange]);

  const title = lang === "es" ? "Resumen financiero" : "Financial Snapshot";

  const insight = useMemo(() => {
    const allTimeLine = lang === "es"
      ? `Registros históricos: ${computed.customerCount} clientes, ${computed.projectCounts.total} proyectos, ${computed.estimateCounts.total} estimados, ${computed.invoiceTotals.total} facturas`
      : `All-time records: ${computed.customerCount} customers, ${computed.projectCounts.total} projects, ${computed.estimateCounts.total} estimates, ${computed.invoiceTotals.total} invoices`;

    const rangeParts = [];
    if (computed.invCount === 0) {
      rangeParts.push(lang === "es" ? "sin facturas comprometidas en este rango" : "no committed invoices in this range");
    } else {
      rangeParts.push((lang === "es" ? "ingresos " : "revenue ") + fmtMoney(computed.revenue));
      if (computed.arTotal > 0) {
        rangeParts.push((lang === "es" ? "cuentas por cobrar " : "receivables ") + fmtMoney(computed.arTotal));
      }
      rangeParts.push(
        lang === "es"
          ? `${computed.invCount} facturas activas`
          : `${computed.invCount} active invoices`
      );
      if (computed.statusCounts.sent > 0 || computed.statusCounts.overdue > 0 || computed.statusCounts.paid > 0) {
        rangeParts.push(
          lang === "es"
            ? `${computed.statusCounts.sent} enviadas, ${computed.statusCounts.overdue} vencidas, ${computed.statusCounts.paid} pagadas`
            : `${computed.statusCounts.sent} sent, ${computed.statusCounts.overdue} overdue, ${computed.statusCounts.paid} paid`
        );
      }
      rangeParts.push((lang === "es" ? "margen promedio " : "avg margin ") + fmtPct(computed.marginPct));
      if (computed.delinquentTotal > 0) {
        rangeParts.push((lang === "es" ? "vencido " : "delinquent ") + fmtMoney(computed.delinquentTotal));
      }
    }
    if (computed.approvedReadyValue > 0) {
      rangeParts.push(
        (lang === "es" ? "aprobadas por facturar " : "approved ready to invoice ")
        + `${fmtMoney(computed.approvedReadyValue)} (${computed.approvedReadyCount})`
      );
    }
    if (computed.missingInvoiceDateCount > 0) {
      rangeParts.push(
        lang === "es"
          ? `${computed.missingInvoiceDateCount} facturas sin fecha excluidas de los totales por fecha`
          : `${computed.missingInvoiceDateCount} undated invoices excluded from date-based totals`
      );
    }

    const rangeLine = (lang === "es" ? "Rango seleccionado: " : "Selected range: ") + rangeParts.join(" • ");
    return `${allTimeLine} • ${rangeLine}`;
  }, [computed, lang]);

  return (
    <section className="pe-section pe-snapshot-screen">
      <div className="pe-card pe-company-shell pe-snapshot-shell">
        <div ref={topRef} className="pe-company-profile-header pe-snapshot-header" style={{ position: "relative", minHeight: 56 }}>
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
            <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
              <div style={{ width: range === "custom" ? 328 : 110, maxWidth: "100%", display: "flex", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
              <Field as="select" value={range} onChange={(e) => setRange(e.target.value)} aria-label={lang === "es" ? "Rango de tiempo" : "Time range"}>
                <option value="30">{lang === "es" ? "30 días" : "30 Days"}</option>
                <option value="90">{lang === "es" ? "90 días" : "90 Days"}</option>
                <option value="ytd">{lang === "es" ? "Año" : "YTD"}</option>
                <option value="custom">{lang === "es" ? "Personalizado" : "Custom"}</option>
              </Field>
              {range === "custom" ? (
                <>
                  <Field
                    as="input"
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    aria-label={lang === "es" ? "Fecha inicial" : "Start date"}
                  />
                  <Field
                    as="input"
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    aria-label={lang === "es" ? "Fecha final" : "End date"}
                  />
                </>
              ) : null}
              </div>
              <div className="pe-muted" style={{ fontSize: 11, textAlign: "right", maxWidth: 328 }}>
                {range === "custom" && resolvedRange.isCustomInvalid
                  ? (lang === "es" ? "Seleccione ambas fechas para aplicar un rango personalizado. Usando Año por ahora." : "Select both dates to apply a custom range. Using YTD for now.")
                  : range === "custom" && resolvedRange.isCustomApplied
                  ? (lang === "es" ? `Aplicando ${customStartDate} a ${customEndDate}` : `Using ${customStartDate} to ${customEndDate}`)
                  : range === "30"
                  ? (lang === "es" ? "Últimos 30 días" : "Last 30 days")
                  : range === "90"
                  ? (lang === "es" ? "Últimos 90 días" : "Last 90 days")
                  : (lang === "es" ? "Año en curso" : "Year to date")}
              </div>
            </div>
          </div>
        </div>

      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", padding: "6px 0 8px" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "nowrap", padding: "0 2px" }}>
          {[
            { label: lang === "es" ? "Resumen" : "Overview",  sectionRef: overviewRef  },
            { label: lang === "es" ? "Ingresos" : "Revenue",  sectionRef: revenueRef   },
            { label: "AR",                                     sectionRef: arRef        },
            { label: lang === "es" ? "Margen" : "Margin",     sectionRef: marginRef    },
            { label: "Pipeline",                               sectionRef: pipelineRef  },
            { label: lang === "es" ? "Sumario" : "Summary",   sectionRef: summaryRef   },
          ].map((chip) => (
            <button
              key={chip.label}
              type="button"
              onClick={() => chip.sectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
              style={{ flexShrink: 0, padding: "4px 12px", borderRadius: 999, fontSize: 11, fontWeight: 800, cursor: "pointer", border: "1px solid rgba(255,255,255,0.14)", background: "rgba(255,255,255,0.05)", color: "rgba(229,231,235,0.72)" }}
            >
              {chip.label}
            </button>
          ))}
        </div>
      </div>

      <div ref={overviewRef} className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-md pe-snapshot-kpi-panel">
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

      <div ref={revenueRef} className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-sm pe-snapshot-chart-panel">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Tendencia de ingresos" : "Revenue Trend"}</div>
        <div className="pe-muted" style={{ marginBottom: 10 }}>{lang === "es" ? "Últimas 12 semanas, agrupadas por período de factura y estado actual" : "Last 12 weeks, grouped by invoice period and current status"}</div>
        {computed.missingInvoiceDateCount > 0 ? (
          <div className="pe-muted" style={{ marginBottom: 10 }}>
            {lang === "es"
              ? `${computed.missingInvoiceDateCount} facturas sin fecha se excluyen de los totales basados en fecha.`
              : `${computed.missingInvoiceDateCount} invoices missing invoice dates are excluded from date-based totals.`}
          </div>
        ) : null}
        <Bars data={computed.weekly} />
      </div>

      <div ref={arRef} className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-sm pe-snapshot-aging-panel">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Envejecimiento de cuentas por cobrar" : "Receivables Aging"}</div>
        <div className="pe-muted" style={{ marginBottom: 10 }}>{lang === "es" ? "Seguimiento por cliente, fecha de vencimiento y saldo pendiente." : "Track who owes you, when it is due, and who to contact next."}</div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10, marginBottom: 12 }}>
          <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(229,231,235,0.40)" }}>
              {lang === "es" ? "Total AR" : "Total AR"}
            </div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtMoney(computed.arTotal)}</div>
          </div>
          <div style={{ padding: "10px 12px", borderRadius: 10, background: computed.delinquentTotal > 0 ? "rgba(239,68,68,0.08)" : "rgba(255,255,255,0.04)", border: computed.delinquentTotal > 0 ? "1px solid rgba(239,68,68,0.22)" : "1px solid rgba(255,255,255,0.08)" }}>
            <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(229,231,235,0.40)" }}>
              {lang === "es" ? "Necesita atención" : "Needs attention"}
            </div>
            <div style={{ marginTop: 4, fontSize: 20, fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtMoney(computed.delinquentTotal)}</div>
          </div>
        </div>

        {computed.arTotal > 0 ? (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))", gap: 8, marginBottom: 14 }}>
              {computed.arBuckets.map((bucket) => (
                <div key={bucket.key} style={{ padding: "9px 10px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: bucket.color, display: "inline-block", flexShrink: 0 }} />
                    <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(229,231,235,0.78)" }}>{bucket.label}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtMoney(bucket.amount)}</div>
                  <div style={{ fontSize: 11, color: "rgba(229,231,235,0.40)", marginTop: 2 }}>
                    {bucket.count} {lang === "es" ? (bucket.count === 1 ? "factura" : "facturas") : (bucket.count === 1 ? "invoice" : "invoices")}
                  </div>
                </div>
              ))}
            </div>

            {computed.atRiskRows.length ? (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "En riesgo / atender primero" : "At risk / needs attention"}</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {computed.atRiskRows.map((row) => (
                    <div key={`risk-${row.id}`} style={{ padding: "11px 12px", borderRadius: 10, background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.20)" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{row.customerName}</div>
                          <div className="pe-muted" style={{ marginTop: 2, fontSize: 12 }}>
                            {row.invoiceLabel} • {row.bucketLabel} • {row.daysLate > 0 ? `${row.daysLate} ${lang === "es" ? "días tarde" : "days late"}` : (lang === "es" ? "Pendiente" : "Open")}
                          </div>
                        </div>
                        <div style={{ textAlign: "right" }}>
                          <div style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtMoney(row.balanceDue)}</div>
                          <div className="pe-muted" style={{ marginTop: 2, fontSize: 12 }}>{row.dueDateLabel}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Cuentas activas" : "Active receivables"}</div>
            <div style={{ display: "grid", gap: 10 }}>
              {computed.arRows.map((row) => {
                const mailtoHref = row.email ? buildFollowUpMailto(row, companyProfile, lang) : "";
                return (
                  <div key={row.id} style={{ padding: "12px", borderRadius: 12, background: row.daysLate > 0 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.03)", border: row.daysLate > 30 ? "1px solid rgba(239,68,68,0.22)" : "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 10 }}>
                      <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{row.customerName}</span>
                          <span style={{ padding: "2px 7px", borderRadius: 999, background: row.bucketColor, color: "#08111f", fontSize: 11, fontWeight: 900 }}>{row.bucketLabel}</span>
                          {row.isPartial ? <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(96,165,250,0.92)" }}>{lang === "es" ? "Parcial" : "Partial"}</span> : null}
                        </div>
                        <div className="pe-muted" style={{ marginTop: 4, fontSize: 12, lineHeight: 1.45, overflowWrap: "anywhere" }}>
                          {[row.invoiceLabel, row.projectName, row.dueDateLabel ? `${lang === "es" ? "Vence" : "Due"} ${row.dueDateLabel}` : "", row.daysLate > 0 ? `${row.daysLate} ${lang === "es" ? "días tarde" : "days late"}` : ""].filter(Boolean).join(" • ")}
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flex: "0 0 auto" }}>
                        <div style={{ fontSize: 18, fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtMoney(row.balanceDue)}</div>
                        <div className="pe-muted" style={{ marginTop: 2, fontSize: 12 }}>
                          {lang === "es" ? "Factura" : "Invoice"} {fmtMoney(row.invoiceTotal)}{row.amountPaid > 0 ? ` • ${lang === "es" ? "Pagado" : "Paid"} ${fmtMoney(row.amountPaid)}` : ""}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
                      <div className="pe-muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                        {row.email || (lang === "es" ? "Sin email" : "No email")}
                      </div>
                      <div className="pe-muted" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
                        {row.phone || (lang === "es" ? "Sin teléfono" : "No phone")}
                      </div>
                    </div>

                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                      {row.email ? (
                        <a href={mailtoHref} style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(96,165,250,0.14)", border: "1px solid rgba(96,165,250,0.30)", color: "rgba(191,219,254,0.96)", textDecoration: "none", fontSize: 12, fontWeight: 800 }}>
                          {lang === "es" ? "Email" : "Email"}
                        </a>
                      ) : (
                        <span style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(229,231,235,0.34)", fontSize: 12, fontWeight: 800 }}>
                          {lang === "es" ? "Sin email" : "No email"}
                        </span>
                      )}
                      {row.phoneHref ? (
                        <a href={`tel:${row.phoneHref}`} style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.30)", color: "rgba(187,247,208,0.95)", textDecoration: "none", fontSize: 12, fontWeight: 800 }}>
                          {lang === "es" ? "Llamar" : "Call"}
                        </a>
                      ) : (
                        <span style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(229,231,235,0.34)", fontSize: 12, fontWeight: 800 }}>
                          {lang === "es" ? "Sin teléfono" : "No phone"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        ) : (
          <div className="pe-muted">{lang === "es" ? "Sin cuentas por cobrar" : "No outstanding receivables"}</div>
        )}

        {!computed.aging.canCompute ? (
          <div className="pe-muted" style={{ marginTop: 8 }}>
            {lang === "es"
              ? "Nota: algunas facturas no tienen dueDate/termsDays. Se usa Net 30 cuando faltan."
              : "Note: some invoices lack dueDate/termsDays. Net 30 is used when missing."}
          </div>
        ) : null}
      </div>

      <div ref={marginRef} className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-sm pe-snapshot-margin-panel">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Salud del margen" : "Margin Health"}</div>
        <div className="pe-muted" style={{ marginBottom: 10 }}>
          {lang === "es" ? "Basado en facturas comprometidas dentro del rango seleccionado." : "Based on committed invoices in the selected range."}
        </div>

        {computed.customerMargins.length === 0 ? (
          <div className="pe-muted">{lang === "es" ? "Sin datos" : "No data"}</div>
        ) : (() => {
          const healthyCount = computed.customerMargins.filter((it) => it.tone === "healthy").length;
          const cautionCount = computed.customerMargins.filter((it) => it.tone === "caution").length;
          const riskCount = computed.customerMargins.filter((it) => it.tone === "risk").length;
          const avgMargin = computed.customerMargins.reduce((sum, it) => sum + it.marginPct, 0) / computed.customerMargins.length;
          const filtered = marginFilter === "healthy"
            ? computed.customerMargins.filter((it) => it.tone === "healthy")
            : marginFilter === "caution"
            ? computed.customerMargins.filter((it) => it.tone === "caution")
            : marginFilter === "risk"
            ? computed.customerMargins.filter((it) => it.tone === "risk")
            : computed.customerMargins;
          return (
            <>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center", marginBottom: 12, padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "rgba(229,231,235,0.40)" }}>{lang === "es" ? "Margen prom." : "Avg margin"}</div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtPct(avgMargin)}</div>
                </div>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginLeft: "auto" }}>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(34,197,94,0.92)" }}>{healthyCount} {lang === "es" ? "sanos" : "healthy"}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(245,158,11,0.92)" }}>{cautionCount} {lang === "es" ? "precaución" : "caution"}</span>
                  <span style={{ fontSize: 12, fontWeight: 800, color: "rgba(239,68,68,0.92)" }}>{riskCount} {lang === "es" ? "riesgo" : "risk"}</span>
                </div>
              </div>

              <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
                {[
                  { key: "all", label: lang === "es" ? "Todos" : "All" },
                  { key: "healthy", label: lang === "es" ? "Saludable" : "Healthy" },
                  { key: "caution", label: lang === "es" ? "Precaución" : "Caution" },
                  { key: "risk", label: lang === "es" ? "Riesgo" : "Risk" },
                ].map((chip) => (
                  <button
                    key={chip.key}
                    onClick={() => setMarginFilter(chip.key)}
                    style={{
                      padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 800, cursor: "pointer",
                      border: marginFilter === chip.key ? "1px solid rgba(96,165,250,0.60)" : "1px solid rgba(255,255,255,0.12)",
                      background: marginFilter === chip.key ? "rgba(96,165,250,0.18)" : "rgba(255,255,255,0.04)",
                      color: marginFilter === chip.key ? "rgba(191,219,254,0.96)" : "rgba(229,231,235,0.60)",
                    }}
                  >
                    {chip.label}
                  </button>
                ))}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                {filtered.length === 0 ? (
                  <div className="pe-muted">{lang === "es" ? "Sin clientes para este filtro" : "No customers for this filter"}</div>
                ) : filtered.map((group) => {
                  const toneColor = group.tone === "healthy" ? "rgba(34,197,94,0.95)" : group.tone === "caution" ? "rgba(245,158,11,0.95)" : "rgba(239,68,68,0.95)";
                  const itemId = String(group.id);
                  const isExpanded = expandedMarginId === itemId;
                  const actionHint = group.tone === "healthy"
                    ? (lang === "es" ? "Cliente saludable en el rango seleccionado." : "Healthy customer margin in the selected range.")
                    : group.tone === "caution"
                    ? (lang === "es" ? "Revisa mezcla de trabajo, mano de obra y markup." : "Review work mix, labor, and markup.")
                    : (lang === "es" ? "Revisa trabajos subpreciados o costos reales faltantes." : "Check underpriced jobs or missing true costs.");
                  return (
                    <div key={itemId}>
                      <div
                        onClick={() => setExpandedMarginId(isExpanded ? null : itemId)}
                        style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", padding: "10px 12px", borderRadius: isExpanded ? "10px 10px 0 0" : 10, background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", cursor: "pointer", userSelect: "none" }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 900, opacity: 0.92, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{group.customerName}</div>
                          <div className="pe-muted" style={{ fontSize: 12, marginTop: 2 }}>{group.invoiceCount} {lang === "es" ? (group.invoiceCount === 1 ? "factura/proyecto" : "facturas/proyectos") : (group.invoiceCount === 1 ? "invoice/job" : "invoices/jobs")}</div>
                          {group.unknownCostInvoiceCount > 0 ? (
                            <div className="pe-muted" style={{ fontSize: 11, marginTop: 2, color: "rgba(245,158,11,0.92)" }}>
                              {lang === "es"
                                ? `${group.unknownCostInvoiceCount} sin costo confirmado`
                                : `${group.unknownCostInvoiceCount} missing confirmed cost`}
                            </div>
                          ) : null}
                        </div>
                        <div style={{ fontWeight: 900, opacity: 0.88 }}>{fmtMoney(group.revenue)}</div>
                        <div style={{ fontWeight: 950, color: toneColor }}>{fmtPct(group.marginPct)}</div>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: "10px 12px", borderRadius: "0 0 10px 10px", background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)", borderTop: "none" }}>
                          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(229,231,235,0.40)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{lang === "es" ? "Ingresos" : "Revenue"}</div>
                              <div style={{ fontWeight: 900, fontSize: 14 }}>{fmtMoney(group.revenue)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(229,231,235,0.40)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{lang === "es" ? "Costo" : "Cost"}</div>
                              <div style={{ fontWeight: 900, fontSize: 14 }}>{fmtMoney(group.cost)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(229,231,235,0.40)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{lang === "es" ? "Ganancia bruta" : "Gross Profit"}</div>
                              <div style={{ fontWeight: 900, fontSize: 14 }}>{fmtMoney(group.grossProfit)}</div>
                            </div>
                            <div>
                              <div style={{ fontSize: 11, fontWeight: 700, color: "rgba(229,231,235,0.40)", textTransform: "uppercase", letterSpacing: "0.05em" }}>{lang === "es" ? "Margen" : "Margin"}</div>
                              <div style={{ fontWeight: 900, fontSize: 14, color: toneColor }}>{fmtPct(group.marginPct)}</div>
                            </div>
                          </div>
                          <div style={{ display: "grid", gap: 6, marginBottom: 8 }}>
                            {group.details.map((detail) => (
                              <div key={detail.id} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto auto", gap: 8, alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                                <div style={{ minWidth: 0 }}>
                                  <div style={{ fontWeight: 800, color: "rgba(229,231,235,0.90)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail.invoiceLabel}</div>
                                  {detail.projectName ? <div className="pe-muted" style={{ fontSize: 12, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{detail.projectName}</div> : null}
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: 12, fontWeight: 800 }}>{fmtMoney(detail.revenue)}</div>
                                  <div className="pe-muted" style={{ fontSize: 11 }}>{detail.knownCost ? fmtMoney(detail.cost) : (lang === "es" ? "Costo pendiente" : "Cost pending")}</div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: 12, fontWeight: 900 }}>{detail.knownCost ? fmtMoney(detail.grossProfit) : "—"}</div>
                                  <div style={{ fontSize: 11, fontWeight: 900, color: detail.knownCost ? (detail.marginPct >= 30 ? "rgba(34,197,94,0.95)" : detail.marginPct >= 20 ? "rgba(245,158,11,0.95)" : "rgba(239,68,68,0.95)") : "rgba(245,158,11,0.95)" }}>
                                    {detail.knownCost ? fmtPct(detail.marginPct) : (lang === "es" ? "Sin costo" : "Unknown cost")}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(229,231,235,0.55)", fontStyle: "italic" }}>{actionHint}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {computed.unknownCostCustomers.length > 0 ? (
                <div style={{ marginTop: 12 }}>
                  <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Costo pendiente / revisar" : "Needs cost review"}</div>
                  <div style={{ display: "grid", gap: 6 }}>
                    {computed.unknownCostCustomers.map((group) => (
                      <div key={`unknown-${group.id}`} style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.20)" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{group.customerName}</div>
                            <div className="pe-muted" style={{ fontSize: 12, marginTop: 2 }}>
                              {group.unknownCostInvoiceCount} {lang === "es" ? (group.unknownCostInvoiceCount === 1 ? "factura sin costo confirmado" : "facturas sin costo confirmado") : (group.unknownCostInvoiceCount === 1 ? "invoice missing confirmed cost" : "invoices missing confirmed cost")}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtMoney(group.unknownRevenue)}</div>
                            <div className="pe-muted" style={{ fontSize: 12, marginTop: 2 }}>{lang === "es" ? "Margen no disponible" : "Margin unavailable"}</div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          );
        })()}
      </div>

      <div ref={pipelineRef} className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-sm pe-snapshot-pipeline-panel">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Pipeline de estimados" : "Estimate Pipeline"}</div>
        <div style={{ display: "grid", gap: 10 }}>
          <KPI label={lang === "es" ? "Valor pendiente" : "Pending value"} value={fmtMoney(computed.pipelineValue)} numericValue={computed.pipelineValue} formatValue={fmtMoney} tone="ok" />
          <KPI label={lang === "es" ? "Pendientes" : "Pending count"} value={String(computed.pipelineCount)} numericValue={computed.pipelineCount} formatValue={(n) => String(Math.round(asNumber(n)))} tone="ok" />
          <KPI label={lang === "es" ? "Promedio pendiente" : "Avg pending"} value={fmtMoney(computed.avgEstimate)} numericValue={computed.avgEstimate} formatValue={fmtMoney} tone="ok" />
        </div>
        <div className="pe-muted" style={{ marginTop: 8, marginBottom: 12 }}>
          {lang === "es"
            ? "Vista de pipeline basada en estimados dentro del rango seleccionado."
            : "Pipeline view based on estimates in the selected range."}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(112px, 1fr))", gap: 8, marginBottom: 14 }}>
          {computed.pipelineBuckets.map((bucket) => (
            <div key={bucket.key} style={{ padding: "9px 10px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 6 }}>
                <span style={{ width: 9, height: 9, borderRadius: 3, background: bucket.color, display: "inline-block", flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 800, color: "rgba(229,231,235,0.78)" }}>{bucket.label}</span>
              </div>
              <div style={{ fontSize: 14, fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtMoney(bucket.value)}</div>
              <div style={{ fontSize: 11, color: "rgba(229,231,235,0.40)", marginTop: 2 }}>
                {bucket.count} {lang === "es" ? (bucket.count === 1 ? "estimado" : "estimados") : (bucket.count === 1 ? "estimate" : "estimates")}
              </div>
            </div>
          ))}
        </div>

        {computed.approvedReadyRows.length ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Aprobados listos para facturar" : "Approved ready to invoice"}</div>
            <div style={{ display: "grid", gap: 8 }}>
              {computed.approvedReadyRows.map((row) => (
                <div key={`approved-${row.id}`} style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.18)" }}>
                  <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{row.customerName}</div>
                      <div className="pe-muted" style={{ marginTop: 2, fontSize: 12, overflowWrap: "anywhere" }}>
                        {[row.estimateLabel, row.projectName, row.estimateDateLabel].filter(Boolean).join(" • ")}
                      </div>
                    </div>
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtMoney(row.remainingToInvoice)}</div>
                      <div className="pe-muted" style={{ marginTop: 2, fontSize: 12 }}>{lang === "es" ? "Pendiente por facturar" : "Remaining to invoice"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                    <button
                      type="button"
                      onClick={() => handleCreateInvoiceFromEstimate(row.sourceEstimate)}
                      style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(34,197,94,0.14)", border: "1px solid rgba(34,197,94,0.30)", color: "rgba(187,247,208,0.95)", fontSize: 12, fontWeight: 800, cursor: "pointer" }}
                    >
                      {lang === "es" ? "Crear factura" : "Create Invoice"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {computed.pendingFollowUpRows.length ? (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Pendientes para seguimiento" : "Pending follow-up"}</div>
            <div style={{ display: "grid", gap: 8 }}>
              {computed.pendingFollowUpRows.map((row) => {
                const followUpHref = row.email ? buildEstimateFollowUpMailto(row, companyProfile, lang) : "";
                return (
                  <div key={`pending-${row.id}`} style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(96,165,250,0.08)", border: "1px solid rgba(96,165,250,0.18)" }}>
                    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                        <div style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{row.customerName}</div>
                        <div className="pe-muted" style={{ marginTop: 2, fontSize: 12, overflowWrap: "anywhere" }}>
                          {[row.estimateLabel, row.projectName, `${row.ageDays} ${lang === "es" ? "días" : "days"}`].filter(Boolean).join(" • ")}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtMoney(row.total)}</div>
                        <div className="pe-muted" style={{ marginTop: 2, fontSize: 12 }}>{row.statusLabel}</div>
                      </div>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                      {row.email ? (
                        <a href={followUpHref} style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(96,165,250,0.14)", border: "1px solid rgba(96,165,250,0.30)", color: "rgba(191,219,254,0.96)", textDecoration: "none", fontSize: 12, fontWeight: 800 }}>
                          {lang === "es" ? "Email" : "Email"}
                        </a>
                      ) : (
                        <span style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(229,231,235,0.34)", fontSize: 12, fontWeight: 800 }}>
                          {lang === "es" ? "Sin email" : "No email"}
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Estimados en pipeline" : "Estimates in pipeline"}</div>
        <div style={{ display: "grid", gap: 8 }}>
          {computed.pipelineRows.length === 0 ? (
            <div className="pe-muted">{lang === "es" ? "Sin estimados en este rango" : "No estimates in this range"}</div>
          ) : computed.pipelineRows.map((row) => {
            const followUpHref = row.email ? buildEstimateFollowUpMailto(row, companyProfile, lang) : "";
            const toneColor = row.statusKey === "approved"
              ? "rgba(34,197,94,0.95)"
              : row.statusKey === "lost"
              ? "rgba(239,68,68,0.95)"
              : row.statusKey === "draft"
              ? "rgba(156,163,175,0.95)"
              : "rgba(96,165,250,0.95)";
            return (
              <div key={row.id} style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", overflow: "hidden" }}>
                <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: 8 }}>
                  <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{row.customerName}</span>
                      <span style={{ fontSize: 11, fontWeight: 900, color: toneColor }}>{row.statusLabel}</span>
                    </div>
                    <div className="pe-muted" style={{ marginTop: 3, fontSize: 12, overflowWrap: "anywhere" }}>
                      {[row.estimateLabel, row.projectName, row.estimateDateLabel, `${row.ageDays} ${lang === "es" ? "días" : "days"}`].filter(Boolean).join(" • ")}
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 900, color: "rgba(229,231,235,0.95)" }}>{fmtMoney(row.total)}</div>
                    {row.remainingToInvoice > 0 ? <div className="pe-muted" style={{ marginTop: 2, fontSize: 12 }}>{lang === "es" ? "Por facturar" : "To invoice"} {fmtMoney(row.remainingToInvoice)}</div> : null}
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
                  {row.email ? (
                    <a href={followUpHref} style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(96,165,250,0.14)", border: "1px solid rgba(96,165,250,0.30)", color: "rgba(191,219,254,0.96)", textDecoration: "none", fontSize: 12, fontWeight: 800 }}>
                      {lang === "es" ? "Email" : "Email"}
                    </a>
                  ) : (
                    <span style={{ padding: "7px 10px", borderRadius: 8, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "rgba(229,231,235,0.34)", fontSize: 12, fontWeight: 800 }}>
                      {lang === "es" ? "Sin email" : "No email"}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div ref={summaryRef} className="pe-card pe-card-content ep-glass-tile ep-tile-hover ep-section-gap-sm pe-snapshot-summary-panel">
        <div style={{ fontWeight: 900, marginBottom: 8 }}>{lang === "es" ? "Resumen" : "Summary"}</div>
        <div style={{ fontSize: 13, opacity: 0.9, lineHeight: 1.35 }}>{insight}</div>
      </div>

      <div className="pe-footer ep-section-gap-sm">{lang === "es" ? "Vista de solo lectura." : "Display-only view."}</div>
      </div>

      <button
        type="button"
        aria-label={lang === "es" ? "Volver arriba" : "Back to top"}
        onClick={() => topRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        style={{
          position: "fixed",
          bottom: 84,
          right: 16,
          zIndex: 45,
          width: 36,
          height: 36,
          borderRadius: "50%",
          border: "1px solid rgba(255,255,255,0.18)",
          background: "rgba(15,15,20,0.55)",
          backdropFilter: "blur(8px)",
          WebkitBackdropFilter: "blur(8px)",
          color: "rgba(229,231,235,0.72)",
          fontSize: 16,
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: showScrollTop ? 1 : 0,
          pointerEvents: showScrollTop ? "auto" : "none",
          transition: "opacity 220ms ease",
          lineHeight: 1,
          padding: 0,
        }}
      >
        ↑
      </button>
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
    <div className={`pe-snapshot-kpi pe-tone-${tone}`} style={{ display: "grid", gridTemplateColumns: "6px 1fr", gap: 12, alignItems: "stretch", padding: 12 }}>
      <div className="pe-snapshot-kpi-stripe" style={{ width: 6, borderRadius: 999, background: stripe }} />
      <div className="pe-snapshot-kpi-content" style={{ display: "grid", gap: 4 }}>
        <div className="pe-snapshot-kpi-label" style={{ fontSize: 12, opacity: 0.78, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</div>
        <div className="pe-snapshot-kpi-value" style={{ fontSize: 22, fontWeight: 950, letterSpacing: "0.2px" }}>{displayValue}</div>
        {note ? <div className="pe-snapshot-kpi-note" style={{ fontSize: 12, opacity: 0.7 }}>{note}</div> : null}
      </div>
    </div>
  );
}
