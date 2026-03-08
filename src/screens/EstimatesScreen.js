// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from "react";
import { computeTotals } from "../estimator/engine";
import { STORAGE_KEYS } from "../constants/storageKeys";

const ESTIMATES_SEARCH_KEY = "estipaid-estimates-search";
const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const STATUS_PENDING = "pending";
const STATUS_APPROVED = "approved";
const STATUS_LOST = "lost";

function normalizeEstimateStatus(status) {
  const raw = String(status || "").trim().toLowerCase();
  if (raw === STATUS_APPROVED) return STATUS_APPROVED;
  if (raw === STATUS_LOST) return STATUS_LOST;
  return STATUS_PENDING;
}

function sortEstimatesByDateDesc(a, b) {
  const bTs = getMostRecentTimestamp(b);
  const aTs = getMostRecentTimestamp(a);
  if (bTs !== aTs) return bTs - aTs;
  return String(b?.id || "").localeCompare(String(a?.id || ""));
}

function normalizeEstimateList(records) {
  const arr = Array.isArray(records) ? records.filter(Boolean) : [];
  return arr
    .map((entry) => ({ ...entry, status: normalizeEstimateStatus(entry?.status) }))
    .sort(sortEstimatesByDateDesc);
}

function createSavedDocId() {
  return `doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function readSavedEstimatesList() {
  try {
    const raw = localStorage.getItem(ESTIMATES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function cloneAsNewEstimate(record, nowTs = Date.now()) {
  let cloned = {};
  try {
    cloned = JSON.parse(JSON.stringify(record || {})) || {};
  } catch {
    cloned = { ...(record || {}) };
  }

  const now = Number(nowTs) || Date.now();
  const next = {
    ...cloned,
    id: createSavedDocId(),
    savedAt: now,
    updatedAt: now,
    createdAt: now,
    ts: now,
    status: STATUS_PENDING,
  };

  next.estimateNumber = "";
  next.invoiceNumber = "";
  next.docNumber = "";
  next.documentNumber = "";
  next.documentNo = "";
  next.number = "";

  next.job = {
    ...(next.job || {}),
    docNumber: "",
  };
  next.customer = {
    ...(next.customer || {}),
    projectNumber: "",
  };

  const meta = {
    ...(next.meta || {}),
    savedDocId: String(next.id || ""),
    savedDocCreatedAt: now,
    lastSavedAt: now,
  };
  next.meta = meta;

  return next;
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path d="M4.8 7.2h14.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M9.2 7.2V5.8h5.6v1.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <path d="M7.3 7.2v10.2a1.8 1.8 0 0 0 1.8 1.8h5.8a1.8 1.8 0 0 0 1.8-1.8V7.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.2 10.3v6.1M13.8 10.3v6.1" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path d="M4.8 19.2h3.2l9.6-9.6a2.3 2.3 0 1 0-3.2-3.2l-9.6 9.6v3.2Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M12.6 8.2l3.2 3.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

function WavyFormIcon() {
  return (
    <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
      <path d="M5 7h14M5 12h14M5 17h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="9" cy="7" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="15" cy="12" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="11" cy="17" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <rect x="9" y="9" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <rect x="5" y="5" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.9" opacity="0.9" />
    </svg>
  );
}

function EmptyEstimateIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M8 6.8h8" />
        <path d="M8 10.2h8" opacity="0.85" />
        <path d="M8 13.6h6.2" opacity="0.7" />
        <path d="M7 6.2h10c.6 0 1 .4 1 1V18c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V7.2c0-.6.4-1 1-1Z" opacity="0.95" />
        <path d="M17.7 8.2v1" opacity="0.7" />
        <path d="M17.7 11.6v1" opacity="0.55" />
      </g>
    </svg>
  );
}

function estimateIdentity(doc) {
  const id = String(doc?.id || "").trim();
  if (id) return `id:${id}`;
  const num = String(
    doc?.estimateNumber
    || doc?.docNumber
    || doc?.documentNumber
    || doc?.documentNo
    || doc?.number
    || doc?.job?.docNumber
    || ""
  ).trim();
  return num ? `num:${num}` : "";
}

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

function toTimestamp(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const num = Number(v);
  if (Number.isFinite(num) && num > 0) return num;
  const parsed = Date.parse(String(v));
  return Number.isFinite(parsed) ? parsed : 0;
}

function getMostRecentTimestamp(doc) {
  const savedAt = toTimestamp(doc?.savedAt ?? doc?.meta?.savedAt ?? doc?.meta?.lastSavedAt);
  if (savedAt > 0) return savedAt;
  const updatedAt = toTimestamp(doc?.updatedAt);
  if (updatedAt > 0) return updatedAt;
  const dateVal = toTimestamp(doc?.date);
  if (dateVal > 0) return dateVal;
  return 0;
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
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [valueFilter, setValueFilter] = useState("all");
  const [estimates, setEstimates] = useState(() => normalizeEstimateList(history));
  const [expanded, setExpanded] = useState(() => ({})); // { [id]: boolean }
  const [draggingEstimateId, setDraggingEstimateId] = useState(null);
  const [touchDraggingId, setTouchDraggingId] = useState(null);
  const [touchDragPos, setTouchDragPos] = useState({ x: 0, y: 0 });
  const touchStartTimer = useRef(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [showListSkeleton, setShowListSkeleton] = useState(true);
  const [showCopyToast, setShowCopyToast] = useState(false);
  const [invoicePromptTarget, setInvoicePromptTarget] = useState(null);
  const [revenueValuePulse, setRevenueValuePulse] = useState({
    pending: false,
    approved: false,
    lost: false,
  });
  const boardRef = useRef(null);
  const prevRevenueRef = useRef(null);
  useEffect(() => {
    setEstimates(normalizeEstimateList(history));
  }, [history]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!boardRef.current) return;

      if (!boardRef.current.contains(event.target)) {
        setExpanded({});
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  useEffect(
    () => () => {
      if (touchStartTimer.current) {
        clearTimeout(touchStartTimer.current);
      }
    },
    []
  );

  const pendingEstimates =
    (estimates || []).filter((e) => e?.status === "pending");
  const approvedEstimates =
    (estimates || []).filter((e) => e?.status === "approved");
  const lostEstimates =
    (estimates || []).filter((e) => e?.status === "lost");

  const pipelineSections = useMemo(
    () => [
      {
        key: STATUS_PENDING,
        title: lang === "es" ? "En espera de respuesta" : "Awaiting Response",
        items: pendingEstimates,
      },
      {
        key: STATUS_APPROVED,
        title: lang === "es" ? "Aprobado" : "Approved",
        items: approvedEstimates,
      },
      {
        key: STATUS_LOST,
        title: lang === "es" ? "Perdido" : "Lost",
        items: lostEstimates,
      },
    ],
    [lang, pendingEstimates, approvedEstimates, lostEstimates]
  );

  const matchesSearch = (estimate) => {
    const q = (searchQuery || "").toLowerCase();
    const status = String(statusFilter || "all").toLowerCase();
    const value = String(valueFilter || "all").toLowerCase();

    const name =
      String(estimate?.name || "").toLowerCase();

    const customer =
      String(
        estimate?.customer?.name
        || estimate?.customer
        || ""
      ).toLowerCase();

    const number =
      String(
        estimate?.estimateNumber
        || ""
      ).toLowerCase();

    const matchesText = !q
      || name.includes(q)
      || customer.includes(q)
      || number.includes(q);

    const matchesStatus = status === "all"
      || normalizeEstimateStatus(estimate?.status) === normalizeEstimateStatus(status);

    const total = toNum(estimate?.total);
    const matchesValue = value === "all"
      || (value === "small" && total < 1000)
      || (value === "medium" && total >= 1000 && total < 10000)
      || (value === "large" && total >= 10000);

    return (
      matchesText
      && matchesStatus
      && matchesValue
    );
  };

  const revenueForecast = useMemo(() => {
    const totals = {
      pendingRevenue: 0,
      approvedRevenue: 0,
      lostRevenue: 0,
    };

    for (const estimate of estimates) {
      const status = normalizeEstimateStatus(estimate?.status);
      const amount = toNum(estimate?.total);
      if (status === STATUS_APPROVED) totals.approvedRevenue += amount;
      else if (status === STATUS_LOST) totals.lostRevenue += amount;
      else totals.pendingRevenue += amount;
    }

    return totals;
  }, [estimates]);

  useEffect(() => {
    const prev = prevRevenueRef.current;
    if (!prev) {
      prevRevenueRef.current = revenueForecast;
      return undefined;
    }

    const nextPulse = {
      pending: prev.pendingRevenue !== revenueForecast.pendingRevenue,
      approved: prev.approvedRevenue !== revenueForecast.approvedRevenue,
      lost: prev.lostRevenue !== revenueForecast.lostRevenue,
    };
    prevRevenueRef.current = revenueForecast;

    if (!nextPulse.pending && !nextPulse.approved && !nextPulse.lost) return undefined;

    setRevenueValuePulse(nextPulse);
    const timer = window.setTimeout(() => {
      setRevenueValuePulse({ pending: false, approved: false, lost: false });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    revenueForecast.pendingRevenue,
    revenueForecast.approvedRevenue,
    revenueForecast.lostRevenue,
    revenueForecast,
  ]);

  useEffect(() => {
    try {
      localStorage.setItem(ESTIMATES_SEARCH_KEY, String(searchQuery ?? ""));
    } catch {}
  }, [searchQuery]);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const status = String(params.get("status") || "").trim();
      const customer = String(params.get("customer") || "").trim();
      const value = String(params.get("value") || "").trim();
      if (status) setStatusFilter(status);
      if (customer) setCustomerFilter(customer);
      if (value) setValueFilter(value);
    } catch {}
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowListSkeleton(false), 260);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!showCopyToast) return undefined;
    const timer = window.setTimeout(() => setShowCopyToast(false), 1500);
    return () => window.clearTimeout(timer);
  }, [showCopyToast]);

  const copyEstimateNumber = async (estimateNumber, evt) => {
    if (evt?.stopPropagation) evt.stopPropagation();
    const value = String(estimateNumber || "").trim();
    if (!value) return;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement("textarea");
        ta.value = value;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setShowCopyToast(true);
    } catch {}
  };

  const fmtUpdated = (doc) => {
    try {
      const ts = getMostRecentTimestamp(doc);
      if (!ts) return "";
      const d = new Date(ts);
      if (Number.isNaN(d.getTime())) return "";
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      const yyyy = String(d.getFullYear());
      const hh = String(d.getHours()).padStart(2, "0");
      const min = String(d.getMinutes()).padStart(2, "0");
      return `Updated ${mm}/${dd}/${yyyy} ${hh}:${min}`;
    } catch {
      return "";
    }
  };

  const toggle = (id) => {
    setExpanded((prev) => {
      const next = {};
      const isOpening = !prev[id];
      if (isOpening) next[id] = true;
      return next;
    });
  };

  const openEstimate = (estimate) => {
    const id = String(estimate?.id || "").trim();
    try {
      if (id) localStorage.setItem(EDIT_ESTIMATE_TARGET_KEY, id);
      else localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
    } catch {}
    if (onOpenEstimate) onOpenEstimate(estimate);
  };

  const setEstimateStatus = (estimate, nextStatus) => {
    const normalized = normalizeEstimateStatus(nextStatus);
    const targetIdentity = estimateIdentity(estimate);
    const targetId = String(estimate?.id || "").trim();

    setEstimates((prev) => {
      const next = (Array.isArray(prev) ? prev : []).map((item) => {
        const matches = targetIdentity
          ? estimateIdentity(item) === targetIdentity
          : String(item?.id || "").trim() === targetId;
        if (!matches) return item;
        return { ...item, status: normalized };
      });
      return next.slice().sort(sortEstimatesByDateDesc);
    });

    setExpanded({});

    if (normalized === STATUS_APPROVED) {
      setTimeout(() => {
        setInvoicePromptTarget(estimate);
      }, 0);
    }

    setExpanded((prev) => ({
      ...prev,
      [String(estimate?.id || "")]: false,
    }));

    setExpanded((prev) => {
      const id = String(estimate?.id || "").trim();
      if (!id) return prev;
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

    try {
      const existing = readSavedEstimatesList();
      const next = existing.map((item) => {
        const matches = targetIdentity
          ? estimateIdentity(item) === targetIdentity
          : String(item?.id || "").trim() === targetId;
        if (!matches) return item;
        return { ...item, status: normalized };
      });
      localStorage.setItem(ESTIMATES_KEY, JSON.stringify(next));
      try {
        window.dispatchEvent(new Event("estipaid:navigate-estimates"));
      } catch {}
    } catch {}
  };

  const moveEstimateToStatus = (estimateId, status) => {
    const draggedId = String(estimateId || "").trim();
    const movedEstimate = (estimates || []).find(
      (e) => String(e?.id || "") === draggedId
    );
    const normalized = normalizeEstimateStatus(status);
    if (!draggedId) return;

    setEstimates((prev) => {
      const next = (Array.isArray(prev) ? prev : []).map((est) => {
        if (String(est?.id || "") !== draggedId) return est;
        return { ...est, status: normalized };
      });
      return next.slice().sort(sortEstimatesByDateDesc);
    });

    setExpanded({});

    if (normalized === STATUS_APPROVED && movedEstimate) {
      setTimeout(() => {
        setInvoicePromptTarget(movedEstimate);
      }, 0);
    }

    setExpanded((prev) => ({
      ...prev,
      [String(estimateId || "")]: false,
    }));

    setExpanded((prev) => {
      if (!draggedId) return prev;
      if (!prev[draggedId]) return prev;
      const next = { ...prev };
      delete next[draggedId];
      return next;
    });

    try {
      const existing = readSavedEstimatesList();
      const next = existing.map((est) => {
        if (String(est?.id || "").trim() !== draggedId) return est;
        return { ...est, status: normalized };
      });
      localStorage.setItem(ESTIMATES_KEY, JSON.stringify(next));
      try {
        window.dispatchEvent(new Event("estipaid:navigate-estimates"));
      } catch {}
    } catch {}
  };

  const onRequestDelete = (estimate) => {
    setDeleteTarget(estimate || null);
    setDeleteConfirmOpen(true);
  };

  const onCancelDelete = () => {
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  };

  const handleInvoicePromptLater = () => {
    setInvoicePromptTarget(null);
  };

  const handleInvoicePromptYes = () => {
    try {
      window.dispatchEvent(new Event("estipaid:navigate-invoice-builder"));
    } catch {}
    setInvoicePromptTarget(null);
  };

  const onConfirmDelete = () => {
    const target = deleteTarget;
    if (!target) {
      onCancelDelete();
      return;
    }

    const targetIdentity = estimateIdentity(target);
    const deletedId = String(target?.id || "").trim();

    try {
      const existing = readSavedEstimatesList();
      const next = existing.filter((item) => {
        if (targetIdentity) return estimateIdentity(item) !== targetIdentity;
        return String(item?.id || "").trim() !== deletedId;
      });
      localStorage.setItem(ESTIMATES_KEY, JSON.stringify(next));

      if (deletedId) {
        const currentEditTarget = String(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY) || "").trim();
        if (currentEditTarget === deletedId) {
          localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
        }
      }

      try {
        window.dispatchEvent(new Event("estipaid:navigate-estimates"));
      } catch {}
    } catch {}

    if (deletedId) {
      setExpanded((prev) => {
        if (!prev || !Object.prototype.hasOwnProperty.call(prev, deletedId)) return prev;
        const next = { ...prev };
        delete next[deletedId];
        return next;
      });
    }

    onCancelDelete();
  };

  useEffect(() => {
    if (!deleteConfirmOpen) return undefined;
    const onKeyDown = (evt) => {
      if (evt.key !== "Escape") return;
      evt.preventDefault();
      setDeleteConfirmOpen(false);
      setDeleteTarget(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteConfirmOpen]);

  const labelSaved = lang === "es" ? "Estimaciones guardadas" : "Saved Estimates";
  const labelBack = lang === "es" ? "Volver" : "Back";

  const labelOpen = lang === "es" ? "Abrir" : "Open";
  const labelDetails = lang === "es" ? "Detalles" : "Details";
  const labelHide = lang === "es" ? "Ocultar" : "Hide";
  const labelDuplicate = lang === "es" ? "Duplicar" : "Duplicate";
  const labelDelete = "Delete";
  const labelTotalMetric = lang === "es" ? "TOTAL" : "TOTAL";
  const labelMarginMetric = lang === "es" ? "MARGEN" : "MARGIN";

  const labelRevenue = lang === "es" ? "Ingresos" : "Revenue";
  const labelInternal = lang === "es" ? "Costo interno" : "Internal cost";
  const labelProfit = lang === "es" ? "Ganancia" : "Profit";
  const labelMargin = lang === "es" ? "Margen" : "Margin";
  const visibleEstimatesCount = (estimates || []).filter(matchesSearch).length;
  const labelSavedWithCount = `${labelSaved} (${visibleEstimatesCount})`;
  const deleteTargetNumber = String(
    deleteTarget?.estimateNumber
    || deleteTarget?.docNumber
    || deleteTarget?.documentNumber
    || deleteTarget?.documentNo
    || deleteTarget?.number
    || deleteTarget?.job?.docNumber
    || ""
  ).trim();
  const deleteTargetName = String(
    deleteTarget?.projectName
    || deleteTarget?.estimateName
    || deleteTarget?.name
    || deleteTarget?.title
    || deleteTarget?.jobName
    || deleteTarget?.customerName
    || ""
  ).trim();
  const deleteTargetDetail = deleteTarget
    ? `Estimate: ${deleteTargetName || "(unnamed)"}${deleteTargetNumber ? ` • #${deleteTargetNumber}` : ""}`
    : "";

  const duplicateEstimate = (estimate) => {
    try {
      const now = Date.now();
      const duplicate = cloneAsNewEstimate(estimate, now);
      const draftExists = !!localStorage.getItem("estipaid-estimate-draft-v1");

      if (draftExists) {
        const confirmOpen = window.confirm(
          "You have an estimate currently in progress.\nOpening this duplicate will replace your current draft.\nContinue?"
        );
        if (!confirmOpen) return;
      }

      const existing = readSavedEstimatesList();
      localStorage.setItem(ESTIMATES_KEY, JSON.stringify([duplicate, ...existing]));

      setExpanded({});

      try {
        localStorage.setItem(EDIT_ESTIMATE_TARGET_KEY, duplicate.id);
      } catch {}

      try {
        window.dispatchEvent(new Event("estipaid:navigate-estimates"));
      } catch {}

      try {
        window.dispatchEvent(
          new CustomEvent("pe-shell-action", {
            detail: { action: "openCreate" },
          })
        );
      } catch {}
    } catch {}
  };

  const hasActiveFilters =
    String(searchQuery || "").trim().length > 0
    || statusFilter !== "all"
    || valueFilter !== "all";
  const hasNoMatchingResults = hasActiveFilters && visibleEstimatesCount === 0;

  const onRevenueTileClick = (statusKey) => {
    const normalized = normalizeEstimateStatus(statusKey);
    setStatusFilter((prev) => (normalizeEstimateStatus(prev) === normalized ? "all" : normalized));
  };

  return (
    <section className="pe-section">
      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header" style={{ position: "relative", minHeight: 56 }}>
          <div className="pe-company-header-title">
            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title={labelSavedWithCount}>{labelSavedWithCount}</h1>
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

        <div
          className="pe-estimates-container"
          style={{
            width: "100%",
            maxWidth: "1400px",
            margin: "0 auto",
            padding: "0 24px",
            boxSizing: "border-box",
          }}
        >

          <div
            className="pe-estimates-search"
            style={{
              width: "100%",
              marginBottom: "18px",
            }}
          >
            <div className="pe-estimates-search-container" style={{ position: "relative", width: "100%" }}>
              <input
                type="text"
                className="pe-input pe-estimates-search-input"
                placeholder="Search estimates by name, number, or customer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(evt) => {
                  if (evt.key === "Escape") {
                    evt.preventDefault();
                    setSearchQuery("");
                  }
                }}
                style={{
                  width: "100%",
                  display: "block",
                  padding: "10px 14px",
                  borderRadius: "10px",
                  paddingRight: 42,
                }}
              />
              {searchQuery ? (
                <button
                  type="button"
                  className="pe-btn pe-btn-ghost"
                  aria-label={lang === "es" ? "Limpiar búsqueda" : "Clear search"}
                  onClick={() => setSearchQuery("")}
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

            <div
              className="pe-estimate-filters"
              style={{
                display: "flex",
                gap: "10px",
                justifyContent: "center",
                marginTop: "12px",
                marginBottom: "20px",
              }}
            >
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="lost">Lost</option>
              </select>

              <select
                value={valueFilter}
                onChange={(e) => setValueFilter(e.target.value)}
              >
                <option value="all">All Values</option>
                <option value="small">Under $1k</option>
                <option value="medium">$1k-$10k</option>
                <option value="large">$10k+</option>
              </select>

              <button
                type="button"
                onClick={() => {
                  setSearchQuery("");
                  setStatusFilter("all");
                  setValueFilter("all");
                }}
              >
                Clear
              </button>
            </div>
          </div>

          <div
            className="pe-estimate-revenue-bar"
            style={{
              width: "100%",
              marginBottom: "22px",
            }}
          >
            <div
              className={`pe-revenue-stat${normalizeEstimateStatus(statusFilter) === STATUS_PENDING ? " pe-tile-active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onRevenueTileClick(STATUS_PENDING)}
              onKeyDown={(evt) => {
                if (evt.key === "Enter" || evt.key === " ") {
                  evt.preventDefault();
                  onRevenueTileClick(STATUS_PENDING);
                }
              }}
            >
              <div className="pe-revenue-label">{lang === "es" ? "Pendiente" : "Pending"}</div>
              <div className={`pe-revenue-value${revenueValuePulse.pending ? " updated" : ""}`}>{money(revenueForecast.pendingRevenue)}</div>
            </div>
            <div
              className={`pe-revenue-stat${normalizeEstimateStatus(statusFilter) === STATUS_APPROVED ? " pe-tile-active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onRevenueTileClick(STATUS_APPROVED)}
              onKeyDown={(evt) => {
                if (evt.key === "Enter" || evt.key === " ") {
                  evt.preventDefault();
                  onRevenueTileClick(STATUS_APPROVED);
                }
              }}
            >
              <div className="pe-revenue-label">{lang === "es" ? "Aprobado" : "Approved"}</div>
              <div className={`pe-revenue-value${revenueValuePulse.approved ? " updated" : ""}`}>{money(revenueForecast.approvedRevenue)}</div>
            </div>
            <div
              className={`pe-revenue-stat${normalizeEstimateStatus(statusFilter) === STATUS_LOST ? " pe-tile-active" : ""}`}
              role="button"
              tabIndex={0}
              onClick={() => onRevenueTileClick(STATUS_LOST)}
              onKeyDown={(evt) => {
                if (evt.key === "Enter" || evt.key === " ") {
                  evt.preventDefault();
                  onRevenueTileClick(STATUS_LOST);
                }
              }}
            >
              <div className="pe-revenue-label">{lang === "es" ? "Perdido" : "Lost"}</div>
              <div className={`pe-revenue-value${revenueValuePulse.lost ? " updated" : ""}`}>{money(revenueForecast.lostRevenue)}</div>
            </div>
          </div>

          <div
            ref={boardRef}
            className={`pe-pipeline-board${showListSkeleton ? "" : " pe-content-fade-in"}`}
            style={{
              display: "grid",
              gridTemplateColumns:
                statusFilter === "all"
                  ? "repeat(3, minmax(0, 1fr))"
                  : "minmax(0, 1fr)",
              gap: 16,
              width: "100%",
              maxWidth: "100%",
              boxSizing: "border-box",
              alignItems: "start",
            }}
          >
          {showListSkeleton ? (
              <div className="pe-skeleton-stack" aria-hidden="true">
                {[0, 1, 2].map((idx) => (
                  <div key={`estimate-skel-${idx}`} className="pe-skeleton-card">
                    <div className="pe-skeleton-row">
                      <div className="pe-skeleton-col">
                        <div className="pe-skeleton-line w55" />
                        <div className="pe-skeleton-line w85" />
                        <div className="pe-skeleton-line w40" />
                      </div>
                      <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                        <div style={{ display: "flex", gap: 10 }}>
                          <div className="pe-skeleton-pill" />
                          <div className="pe-skeleton-pill" />
                        </div>
                        <div className="pe-skeleton-actions" style={{ marginTop: 0 }}>
                          <div className="pe-skeleton-button" />
                          <div className="pe-skeleton-button" />
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
          ) : estimates.length === 0 ? (
              <div style={{ opacity: 0.8, fontSize: 14, textAlign: "center", display: "grid", justifyItems: "center", gap: 6 }}>
                <div style={{ opacity: 0.68 }}>
                  <EmptyEstimateIcon />
                </div>
                <div>No estimates yet. Create your first estimate.</div>
              </div>
          ) : (
            <>
              {hasNoMatchingResults ? (
                <div
                  style={{
                    textAlign: "center",
                    opacity: 0.6,
                    gridColumn: "1 / -1",
                  }}
                >
                  No matching estimates
                </div>
              ) : null}
              {pipelineSections.map((section) => {
              if (statusFilter !== "all" && section.key !== statusFilter) return null;
              const sectionRevenue = section.key === STATUS_APPROVED
                ? revenueForecast.approvedRevenue
                : section.key === STATUS_LOST
                  ? revenueForecast.lostRevenue
                  : revenueForecast.pendingRevenue;
              const sectionRevenueText = section.key === STATUS_APPROVED
                ? (lang === "es" ? "de ingresos ganados" : "won revenue")
                : section.key === STATUS_LOST
                  ? (lang === "es" ? "de ingresos perdidos" : "lost revenue")
                  : (lang === "es" ? "de ingresos pendientes" : "pending revenue");

              return (
                <div
                  key={`section-${section.key}`}
                  className="pe-pipeline-section"
                  data-section-key={section.key}
                  style={{
                    width: "100%",
                    minWidth: 0,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "stretch",
                    height: "auto",
                    position: "relative",
                    gap: "12px",
                  }}
                >
                  <div
                    className="pe-pipeline-bucket"
                    style={{
                      width: "100%",
                      minWidth: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "stretch",
                      height: "auto",
                      position: "relative",
                      gap: 12,
                    }}
                  >
                    <div
                      className="pe-pipeline-dropzone"
                    >
                      <div className="pe-pipeline-header" style={{ display: "grid", gap: 2 }}>
                        <div
                          className="pe-pipeline-tile-drop"
                        >
                          <div
                            className="pe-pipeline-title"
                            style={{
                              fontWeight: 800,
                              fontSize: "13px",
                              letterSpacing: ".08em",
                              textTransform: "uppercase",
                              opacity: 0.7,
                            }}
                          >
                            {section.title} ({section.items.length})
                          </div>
                        </div>
                        <div style={{ fontSize: 12, fontWeight: 800, opacity: 0.74 }}>
                          {money(sectionRevenue)} {sectionRevenueText}
                        </div>
                      </div>
                    </div>

                    <div
                      className="pe-pipeline-cards"
                      onDragOver={(e) => {
                        e.preventDefault();
                      }}
                      onDrop={(e) => {
                        e.preventDefault();

                        const draggedId =
                          e.dataTransfer.getData("text/plain")
                          || draggingEstimateId;

                        if (!draggedId) return;

                        setEstimateStatus({ id: draggedId }, section.key);
                        setDraggingEstimateId(null);
                      }}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "14px",
                        alignItems: "stretch",
                        width: "100%",
                        minHeight: "400px",
                        flexGrow: 1,
                    }}
                  >
                    {section.items.filter(matchesSearch).map((entry) => {
                      const estimate = entry;
                      const e = estimate;
                      const id = String(e?.id || "");
                      const isOpen = Boolean(expanded[id]);
                      const status = normalizeEstimateStatus(e?.status);
                      const bd = calcBreakdown(e);
                      const isActiveCard = isOpen;

              const card = {
                padding: 16,
                borderRadius: 16,
                border: "1px solid rgba(255,255,255,0.12)",
                background: "rgba(255,255,255,0.04)",
                boxSizing: "border-box",
                overflow: "hidden",
                display: "flex",
                flexDirection: "column",
                gap: 12,
                cursor: "pointer",
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                ...(isActiveCard
                  ? {
                      border: "1px solid rgba(34,197,94,0.42)",
                      background: "rgba(255,255,255,0.07)",
                      boxShadow: "0 0 0 1px rgba(34,197,94,0.18), 0 10px 22px rgba(0,0,0,0.28)",
                    }
                  : null),
              };

              const small = { fontSize: 11.5, opacity: 0.68, letterSpacing: "0.2px" };
              const cardBodyLine = {
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              };
              const updatedTextLine = {
                ...small,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              };
              const row = {
                display: "grid",
                gridTemplateRows: "auto auto auto",
                rowGap: "8px",
                width: "100%",
              };
              const headerRow = {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 8,
              };
              const customerEstimateRow = {
                display: "flex",
                justifyContent: "space-between",
                gap: "8px",
                minWidth: 0,
              };
              const customerField = {
                ...cardBodyLine,
                fontSize: 12.5,
                opacity: 0.78,
                lineHeight: 1.2,
                minWidth: 0,
                flex: "1 1 auto",
              };
              const estimateField = {
                ...cardBodyLine,
                fontSize: 12.5,
                opacity: 0.78,
                lineHeight: 1.2,
                minWidth: 0,
                flex: "0 1 auto",
                display: "flex",
                alignItems: "center",
                justifyContent: "flex-end",
              };
              const metricLabel = {
                fontSize: 10.5,
                fontWeight: 900,
                opacity: 0.82,
                letterSpacing: "1px",
                textTransform: "uppercase",
                textAlign: "center",
                lineHeight: 1.1,
              };

              const metricRow = {
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "nowrap",
                columnGap: 12,
                gap: "8px",
                minWidth: 0,
              };

              const pill = (ok) => ({
                padding: "6px 10px",
                borderRadius: 999,
                border: "1px solid rgba(255,255,255,0.14)",
                background: ok ? "rgba(34,197,94,0.10)" : "rgba(255,255,255,0.06)",
                boxShadow: "inset 0 1px 2px rgba(255,255,255,0.05), 0 4px 10px rgba(0,0,0,0.35)",
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: "0.3px",
                flexShrink: 0,
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
              const updatedLine = fmtUpdated(e);
              const statusClassName = status === STATUS_APPROVED
                ? "pe-status-approved"
                : status === STATUS_LOST
                  ? "pe-status-lost"
                  : "pe-status-pending";
              const statusLabel = status === STATUS_APPROVED
                ? (lang === "es" ? "Aprobado" : "Approved")
                : status === STATUS_LOST
                  ? (lang === "es" ? "Perdido" : "Lost")
                  : (lang === "es" ? "En espera de respuesta" : "Awaiting Response");

              return (
                <div
                  className={`pe-card pe-saved-estimate-card pe-estimate-card ${draggingEstimateId === id ? "pe-dragging" : ""}`}
                  key={String(
                    e?.id
                    || e?.estimateId
                    || e?.uuid
                    || `${estimateIdentity(e)}:${getMostRecentTimestamp(e)}:${String(e?.projectName || "")}:${String(e?.customerName || "")}`
                  )}
                  style={card}
                  draggable={true}
                  onTouchStart={(e) => {
                    const touch = e.touches?.[0];
                    if (!touch) return;

                    if (touchStartTimer.current) {
                      clearTimeout(touchStartTimer.current);
                    }

                    touchStartTimer.current = setTimeout(() => {
                      setTouchDraggingId(id);
                      setTouchDragPos({
                        x: touch.clientX,
                        y: touch.clientY,
                      });
                      setDraggingEstimateId(id);
                    }, 350);
                  }}
                  onTouchMove={(e) => {
                    if (!touchDraggingId) return;

                    const touch = e.touches?.[0];
                    if (!touch) return;
                    e.preventDefault();

                    setTouchDragPos({
                      x: touch.clientX,
                      y: touch.clientY,
                    });
                  }}
                  onTouchEnd={(e) => {
                    if (touchStartTimer.current) {
                      clearTimeout(touchStartTimer.current);
                    }
                    touchStartTimer.current = null;

                    if (!touchDraggingId) return;

                    const touch = e.changedTouches?.[0];
                    const clientX = touch?.clientX ?? touchDragPos.x;
                    const clientY = touch?.clientY ?? touchDragPos.y;
                    const el = document.elementFromPoint(clientX, clientY);
                    const column = el?.closest(".pe-pipeline-section");

                    if (column) {
                      const status = column.getAttribute("data-section-key");
                      moveEstimateToStatus(touchDraggingId, status);
                    }

                    setTouchDraggingId(null);
                    setDraggingEstimateId(null);
                  }}
                  onTouchCancel={() => {
                    if (touchStartTimer.current) {
                      clearTimeout(touchStartTimer.current);
                    }
                    touchStartTimer.current = null;
                    setTouchDraggingId(null);
                    setDraggingEstimateId(null);
                  }}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", id);

                    const el = e.currentTarget;

                    el.style.transform = "scale(1.03)";
                    el.style.boxShadow = "0 16px 36px rgba(0,0,0,0.55)";
                    el.style.opacity = "0.8";
                    el.style.cursor = "grabbing";
                    el.style.zIndex = "999";

                    setDraggingEstimateId(id);
                  }}
                  onDragEnd={(e) => {
                    const el = e.currentTarget;

                    setDraggingEstimateId(null);

                    if (el) {
                      el.style.transform = "";
                      el.style.boxShadow = "";
                      el.style.opacity = "";
                      el.style.zIndex = "";
                      el.style.cursor = "grab";

                      requestAnimationFrame(() => {
                        el.style.cursor = "";
                      });
                    }
                  }}
                >
                  <div style={row}>
                    <div style={headerRow}>
                      <div style={{ display: "grid", gap: 3, minWidth: 0 }}>
                        <div
                          style={{
                            fontWeight: 600,
                            fontSize: "15px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {e?.projectName || (lang === "es" ? "Sin proyecto" : "No project")}
                        </div>
                        <div style={customerEstimateRow}>
                          <div style={customerField}>
                            {e?.customerName ? e.customerName : (lang === "es" ? "Sin cliente" : "No customer")}
                          </div>
                          <div style={estimateField}>
                            {e?.estimateNumber ? (
                              <>
                                <span style={{ fontSize: 12, opacity: 0.75, whiteSpace: "nowrap" }}>{`${t("estimateNumLabel")} ${e.estimateNumber}`}</span>
                                <button
                                  type="button"
                                  className="ep-icon-btn ep-icon-btn--sm ep-icon-btn--glass"
                                  aria-label="Copy estimate number"
                                  title="Copy estimate number"
                                  onClick={(evt) => copyEstimateNumber(e?.estimateNumber, evt)}
                                  style={{ marginLeft: 6, verticalAlign: "middle" }}
                                >
                                  <CopyIcon />
                                </button>
                              </>
                            ) : null}
                            {e?.invoiceNumber ? (
                              <span style={{ fontSize: 12, opacity: 0.75, whiteSpace: "nowrap", marginLeft: e?.estimateNumber ? 6 : 0 }}>
                                {`${e?.estimateNumber ? "• " : ""}${t("invoiceNumLabel")} ${e.invoiceNumber}`}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        {updatedLine ? <div style={updatedTextLine}>{updatedLine}</div> : null}
                      </div>
                      <div
                        className={`pe-estimate-status ${statusClassName}`}
                        style={{
                          whiteSpace: "nowrap",
                          flexShrink: 0,
                        }}
                      >
                        {statusLabel}
                      </div>
                    </div>
                    <div style={{ display: "flex", justifyContent: "flex-end", minWidth: 0 }}>
                      <div style={metricRow}>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <div style={metricLabel}>{labelTotalMetric}</div>
                          <div style={pill(true)} title={labelRevenue}>
                            {money(bd.totals.revenue)}
                          </div>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                          <div style={metricLabel}>{labelMarginMetric}</div>
                          <div style={pill(false)} title={labelMargin}>
                            {(bd.totals.margin * 100).toFixed(1)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="pe-estimate-actions">
                    <div
                      className="actions-right pe-estimate-actions-row"
                      style={{
                        display: "flex",
                        gap: 10,
                        marginTop: 8,
                      }}
                    >
                      <button className="pe-btn" type="button" onClick={() => openEstimate(e)}>
                        {labelOpen}
                      </button>
                      <button className="pe-btn pe-btn-ghost" type="button" onClick={() => toggle(id)}>
                        {isOpen ? labelHide : labelDetails}
                      </button>
                    </div>
                  </div>

                  <div style={panel} aria-hidden={!isOpen}>
                    <div className="pe-card pe-card-content" style={subCard}>
                      <div style={sectionTitle}>{lang === "es" ? "Estado" : "Status"}</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          className={status === STATUS_APPROVED ? "pe-btn" : "pe-btn pe-btn-ghost"}
                          type="button"
                          onClick={() => {
                            setEstimateStatus(e, STATUS_APPROVED);
                            setInvoicePromptTarget(e);
                          }}
                        >
                          {lang === "es" ? "Marcar aprobado" : "Mark Approved"}
                        </button>
                        <button
                          className={status === STATUS_LOST ? "pe-btn" : "pe-btn pe-btn-ghost"}
                          type="button"
                          onClick={() => setEstimateStatus(e, STATUS_LOST)}
                        >
                          {lang === "es" ? "Marcar perdido" : "Mark Lost"}
                        </button>
                        <button
                          className={status === STATUS_PENDING ? "pe-btn" : "pe-btn pe-btn-ghost"}
                          type="button"
                          onClick={() => setEstimateStatus(e, STATUS_PENDING)}
                        >
                          {lang === "es" ? "Restablecer a pendiente" : "Reset to Pending"}
                        </button>
                        <button
                          className="pe-btn pe-btn-secondary pe-btn-duplicate"
                          type="button"
                          onClick={(evt) => {
                            evt.stopPropagation();
                            duplicateEstimate(estimate);
                          }}
                        >
                          <CopyIcon />
                          Duplicate
                        </button>
                      </div>
                    </div>

                    {/* TOTALS */}
                    <div className="pe-card pe-card-content" style={{ ...subCard, marginTop: 10 }}>
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

                    <div
                      className="actions-right pe-estimate-actions-row"
                      style={{
                        display: "flex",
                        gap: 10,
                        marginTop: 10,
                      }}
                    >
                      <button
                        className="pe-btn pe-btn-ghost"
                        type="button"
                        onClick={(evt) => {
                          evt.stopPropagation();
                          onRequestDelete(e);
                        }}
                      >
                        {labelDelete}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
                  </div>
                </div>
                </div>
              );
              })
              }
            </>
          )}
        </div>
      </div>
      </div>

      {deleteConfirmOpen ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Delete estimate confirmation"
          onClick={onCancelDelete}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1300,
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
              width: "min(560px, 96vw)",
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
              Delete estimate?
            </div>
            <div style={{ fontSize: 14, opacity: 0.9 }}>
              This will permanently delete this estimate. This can&apos;t be undone.
            </div>
            {deleteTargetDetail ? (
              <div style={{ fontSize: 13, opacity: 0.82 }}>
                {deleteTargetDetail}
              </div>
            ) : null}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap", marginTop: 4 }}>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={onCancelDelete}>
                Cancel
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={onConfirmDelete}
                style={{
                  borderColor: "rgba(248,113,113,0.65)",
                  background: "linear-gradient(180deg, rgba(185,28,28,0.74), rgba(127,29,29,0.7))",
                  color: "#fff",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {invoicePromptTarget && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.45)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 2000
          }}
        >
          <div
            className="pe-card"
            style={{
              width: 360,
              maxWidth: "90%",
              textAlign: "center",
              padding: 24
            }}
          >
            <h3 style={{ marginTop: 0 }}>Create Invoice?</h3>

            <p style={{ opacity: 0.8 }}>
              This estimate was moved to Approved.
              Would you like to create an invoice now?
            </p>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: 12,
                marginTop: 18
              }}
            >
              <button
                className="pe-btn"
                onClick={handleInvoicePromptLater}
              >
                No, Later
              </button>

              <button
                className="pe-btn pe-btn-primary"
                onClick={handleInvoicePromptYes}
              >
                Yes, Create Invoice
              </button>
            </div>
          </div>
        </div>
      )}
      {showCopyToast ? (
        <div className="pe-toast" role="status" aria-live="polite">Estimate number copied</div>
      ) : null}
    </section>
  );
}
