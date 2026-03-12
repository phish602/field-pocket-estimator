// @ts-nocheck
/* eslint-disable */
import React, { useEffect, useMemo, useState } from "react";
import Field from "../components/Field";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { DEFAULT_SETTINGS, loadSettings } from "../utils/settings";
import { computeTotals } from "../estimator/engine";

const CUSTOMERS_KEY = STORAGE_KEYS.CUSTOMERS;
const PENDING_CUSTOMER_USE_KEY = STORAGE_KEYS.PENDING_CUSTOMER_USE;
const PENDING_CUSTOMER_EDIT_KEY = STORAGE_KEYS.PENDING_CUSTOMER_EDIT;
const PENDING_CUSTOMER_CREATE_KEY = STORAGE_KEYS.PENDING_CUSTOMER_CREATE;
const CUSTOMER_EDIT_TARGET_KEY = STORAGE_KEYS.CUSTOMER_EDIT_TARGET;

// ===== Customer KPI (live-compute) =====
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const INVOICES_KEY = STORAGE_KEYS.INVOICES;

function toNum(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function safeDiv(a, b) {
  const A = toNum(a);
  const B = toNum(b);
  if (!B) return 0;
  return A / B;
}
function moneyUSD(v) {
  const n = toNum(v);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function readSavedDocs() {
  try {
    const estimateRaw = localStorage.getItem(ESTIMATES_KEY);
    const invoiceRaw = localStorage.getItem(INVOICES_KEY);
    const estimates = estimateRaw ? safeParse(estimateRaw, []) : [];
    const invoices = invoiceRaw ? safeParse(invoiceRaw, []) : [];
    const merged = [
      ...(Array.isArray(estimates) ? estimates : []),
      ...(Array.isArray(invoices) ? invoices : []),
    ].filter(Boolean);
    const deduped = [];
    const seen = new Set();
    merged.forEach((entry) => {
      const key = String(entry?.id || entry?.invoiceNumber || entry?.estimateNumber || "").trim();
      if (key && seen.has(key)) return;
      if (key) seen.add(key);
      deduped.push(entry);
    });
    return deduped;
  } catch {
    return [];
  }
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
  return {
    ui: {
      materialsMode: resolveMaterialsMode(doc),
    },
    labor: {
      hazardPct: toNum(doc?.labor?.hazardPct ?? doc?.hazardPct),
      riskPct: toNum(doc?.labor?.riskPct ?? doc?.riskPct),
      multiplier: multiplier > 0 ? multiplier : 1,
      lines: laborLines.map((ln, idx) => ({
        id: String(ln?.id ?? `labor_${idx}`),
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
  const computed = computeTotals(toEstimatorState(e || {}));
  const revenue = toNum(computed?.totalRevenue);
  const internal = toNum(computed?.totalCost);
  const profit = toNum(computed?.grossProfit);
  const margin = safeDiv(profit, revenue);
  return { revenue, internal, profit, margin };
}


const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"];

function safeParse(raw, fallback) {
  try {
    const v = JSON.parse(raw);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function readCustomers() {
  const raw = localStorage.getItem(CUSTOMERS_KEY);
  const arr = raw ? safeParse(raw, []) : [];
  return (Array.isArray(arr) ? arr : []).filter(Boolean);
}

function persistCustomers(list) {
  const safe = Array.isArray(list) ? list : [];
  try {
    localStorage.setItem(CUSTOMERS_KEY, JSON.stringify(safe));
  } catch {}
}

function buildId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function joinAddr(a) {
  const street = String(a?.street || "").trim();
  const city = String(a?.city || "").trim();
  const state = String(a?.state || "").trim();
  const zip = String(a?.zip || "").trim();
  const line2 = [city, state].filter(Boolean).join(", ");
  const line2Full = [line2, zip].filter(Boolean).join(" ");
  return [street, line2Full].filter(Boolean).join("\n");
}


function toEstimatorFlat(c) {
  const type = String(c?.type || "residential");
  if (type === "commercial") {
    const job = c?.jobsite || {};
    const bill = c?.billSameAsJob ? (c?.jobsite || {}) : (c?.billing || {});
    return {
      name: String(c?.companyName || "").trim(),
      phone: String(c?.comPhone || "").trim(),
      email: String(c?.comEmail || "").trim(),
      attn: String(c?.contactName || "").trim(),
      address: joinAddr(job),
      billingAddress: joinAddr(bill),
      city: String(job?.city || "").trim(),
      state: String(job?.state || "").trim(),
      zip: String(job?.zip || "").trim(),
    };
  }
  const svc = c?.resService || {};
  const bill = c?.resBillingSame ? (c?.resService || {}) : (c?.resBilling || {});
  return {
    name: String(c?.fullName || "").trim(),
    phone: String(c?.resPhone || "").trim(),
    email: String(c?.resEmail || "").trim(),
    attn: "",
    address: joinAddr(svc),
    billingAddress: joinAddr(bill),
    city: String(svc?.city || "").trim(),
    state: String(svc?.state || "").trim(),
    zip: String(svc?.zip || "").trim(),
  };
}


function digitsOnly(s) {
  return String(s || "").replace(/\D+/g, "");
}

function formatPhoneUS(input) {
  const d = digitsOnly(input).slice(0, 10);
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return a;
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}

function formatZipUS(input) {
  const d = digitsOnly(input).slice(0, 9);
  if (d.length <= 5) return d;
  return `${d.slice(0,5)}-${d.slice(5)}`;
}

function formatStateUS(input) {
  return String(input || "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase()
    .slice(0, 2);
}


function FieldLabel({ children }) {
  return <div className="pe-field-label">{children}</div>;
}

function StateSelect({ value, onChange, placeholder = "State" }) {
  return (
    <select className="pe-input pe-field-control" value={value || ""} onChange={onChange} autoComplete="address-level1">
      <option value="">{placeholder}</option>
      {US_STATES.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}


function TextLine({ children }) {
  return <div style={{ fontSize: 13, opacity: 0.85, lineHeight: 1.25, whiteSpace: "pre-line" }}>{children}</div>;
}

function labelOf(lang, en, es) {
  return lang === "es" ? es : en;
}

function EmptyCustomersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      <g stroke="currentColor" strokeWidth="1.9" fill="none" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 12.2c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3Z" />
        <path d="M4.8 18c.8-2.5 2.6-3.8 4.2-3.8s3.4 1.3 4.2 3.8" />
        <path d="M14.2 10.2h5" opacity="0.9" />
        <path d="M14.2 13.2h4.2" opacity="0.75" />
      </g>
    </svg>
  );
}

function ValidCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="rgba(34,197,94,0.18)" stroke="rgba(74,222,128,0.75)" strokeWidth="1.5" />
      <path d="M8.2 12.2 10.8 14.8 15.8 9.8" fill="none" stroke="rgba(134,239,172,0.96)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function hasValidPhoneValue(value) {
  const digits = digitsOnly(value);
  return digits.length === 10 || (digits.length === 11 && digits.startsWith("1"));
}

function hasValidEmailValue(value) {
  const v = String(value || "").trim();
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function validHelperText() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "rgba(134,239,172,0.9)" }}>
      <ValidCheckIcon />
      Valid
    </span>
  );
}

const cardBaseStyle = {
  padding: 14,
};

const cardActiveStyle = {
  border: "1px solid rgba(34,197,94,0.50)",
};

const stickyListHeaderStyle = {
  position: "sticky",
  top: 0,
  zIndex: 12,
  paddingTop: 6,
  paddingBottom: 8,
  background: "transparent",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
  borderBottom: "0",
};

const NET_TERMS_OPTIONS = [
  { value: "DUE_UPON_RECEIPT", labelEn: "Due upon receipt", labelEs: "Pago al recibir" },
  { value: "NET_15", labelEn: "Net 15", labelEs: "Neto 15" },
  { value: "NET_30", labelEn: "Net 30", labelEs: "Neto 30" },
  { value: "NET_CUSTOM", labelEn: "Net custom", labelEs: "Neto personalizado" },
];

const ESTIMATOR_SECTION_TITLE_STACK_STYLE = {
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: "var(--customer-section-header-gap, 6px)",
  width: "fit-content",
  marginBottom: "var(--customer-section-underline-gap, 14px)",
};

const ESTIMATOR_SECTION_TITLE_TEXT_STYLE = {
  marginBottom: 0,
  fontSize: 17,
  fontWeight: 950,
  letterSpacing: "0.15em",
  lineHeight: 1.04,
  textTransform: "uppercase",
  color: "rgba(236,242,250,0.96)",
  textShadow: "0 1px 4px rgba(0,0,0,0.32), 0 6px 14px rgba(0,0,0,0.2)",
};

const ESTIMATOR_SECTION_ACCENT_LINE_STYLE = {
  width: "100%",
  height: 3,
  background: "linear-gradient(90deg, rgba(34,197,94,0.78) 0%, rgba(59,130,246,0.74) 100%)",
  clipPath: "polygon(2% 0, 100% 0, 98% 100%, 0 100%)",
  filter: "drop-shadow(0 0 2px rgba(34,197,94,0.16))",
};

function CustomerSectionHeader({ title }) {
  return (
    <div className="pe-company-section-heading">
      <div style={ESTIMATOR_SECTION_TITLE_STACK_STYLE}>
        <div className="pe-section-title" style={ESTIMATOR_SECTION_TITLE_TEXT_STYLE}>{title}</div>
        <div style={ESTIMATOR_SECTION_ACCENT_LINE_STYLE} />
      </div>
    </div>
  );
}

function emptyDraft(type = "residential") {
  return {
    id: "",
    type,

    // residential
    fullName: "",
    resPhone: "",
    resEmail: "",
    resService: { street: "", city: "", state: "", zip: "" },
    resBillingSame: true,
    resBilling: { street: "", city: "", state: "", zip: "" },

    // commercial
    companyName: "",
    contactName: "",
    contactTitle: "",
    comPhone: "",
    comEmail: "",
    apEmail: "",
    netTermsType: "DUE_UPON_RECEIPT",
    netTermsDays: null,
    poRequired: false,
    jobsite: { street: "", city: "", state: "", zip: "" },
    billSameAsJob: true,
    billing: { street: "", city: "", state: "", zip: "" },
  };
}

function displayName(c) {
  const type = String(c?.type || "residential");
  if (type === "commercial") return String(c?.companyName || "").trim() || "Unnamed";
  return String(c?.fullName || "").trim() || "Unnamed";
}

function contactLine(c) {
  const type = String(c?.type || "residential");
  if (type === "commercial") {
    const contact = [c?.contactName, c?.contactTitle].filter(Boolean).join(c?.contactTitle ? ", " : "");
    return contact || "";
  }
  return "";
}

function phoneEmailLine(c) {
  const type = String(c?.type || "residential");
  const phone = type === "commercial" ? c?.comPhone : c?.resPhone;
  const email = type === "commercial" ? c?.comEmail : c?.resEmail;
  return [email, phone].filter(Boolean).join(" • ");
}

function mainAddressText(c) {
  const type = String(c?.type || "residential");
  const a = type === "commercial" ? c?.jobsite : c?.resService;
  return joinAddr(a);
}

export default function CustomersScreen({
  lang = "en",
  t = (k) => k,
  customers,
  setCustomers,
  selectedCustomerId,
  setSelectedCustomerId,
  onDone,
}) {
  const label = (en, es) => labelOf(lang, en, es);

  const [settingsSnapshot, setSettingsSnapshot] = useState(() => loadSettings());
  const customerSettings = settingsSnapshot?.customer || DEFAULT_SETTINGS.customer;
  const defaultCustomerType = customerSettings?.defaultCustomerType === "commercial" ? "commercial" : "residential";
  const requirePhone = !!customerSettings?.requirePhone;
  const requireEmail = !!customerSettings?.requireEmail;
  const [localCustomers, setLocalCustomers] = useState(() => (Array.isArray(customers) ? [] : readCustomers()));
  const [q, setQ] = useState("");
  const [mode, setMode] = useState("list"); // list | edit
  const [showListSkeleton, setShowListSkeleton] = useState(true);
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft(defaultCustomerType));
  const [returnToEstimator, setReturnToEstimator] = useState(false);
  const [autoUseOnSave, setAutoUseOnSave] = useState(false);
  const [missingRequired, setMissingRequired] = useState({});

  const phoneFieldMissing = !!missingRequired.phone;
  const emailFieldMissing = !!missingRequired.email;

  useEffect(() => {
    if (!Array.isArray(customers)) setLocalCustomers(readCustomers());
  }, [customers]);

  useEffect(() => {
    const refresh = (e) => {
      if (e?.key && e.key !== STORAGE_KEYS.SETTINGS) return;
      setSettingsSnapshot(loadSettings());
    };
    window.addEventListener("estipaid:settings-changed", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("estipaid:settings-changed", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);

  useEffect(() => {
    const onStorage = (e) => {
      if (!e) return;
      if (e.key === CUSTOMERS_KEY) {
        if (!Array.isArray(customers)) setLocalCustomers(readCustomers());
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [customers]);

  useEffect(() => {
    const timer = window.setTimeout(() => setShowListSkeleton(false), 260);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!showToast) return undefined;
    const timer = window.setTimeout(() => setShowToast(false), 1500);
    return () => window.clearTimeout(timer);
  }, [showToast]);

  const list = useMemo(() => (Array.isArray(customers) ? customers : localCustomers), [customers, localCustomers]);

  // Handle estimator-intent (edit/create) when routed here from EstimateForm
  useEffect(() => {
    // Edit-target intent (from EstimateForm "Edit" button)
    try {
      const rawEditTarget = localStorage.getItem(CUSTOMER_EDIT_TARGET_KEY);
      if (rawEditTarget) {
        localStorage.removeItem(CUSTOMER_EDIT_TARGET_KEY);
        const payload = JSON.parse(rawEditTarget);
        const id = String(payload?.id || "");
        if (id) {
          const c = (list || []).find((x) => String(x?.id) === id || String(x?.customerId) === id);
          if (c) { startEdit(c, { returnToEstimator: true, autoUseOnSave: true }); }
        }
      }
    } catch {}

    // Edit intent
    try {
      const raw = localStorage.getItem(PENDING_CUSTOMER_EDIT_KEY);
      if (raw) {
        const payload = JSON.parse(raw);
        const id = String(payload?.id || "");
        if (id) {
          const c = (list || []).find((x) => String(x?.id) === id);
          if (c) startEdit(c);
        }
        localStorage.removeItem(PENDING_CUSTOMER_EDIT_KEY);
      }
    } catch {}

    // Create intent
    try {
      const raw2 = localStorage.getItem(PENDING_CUSTOMER_CREATE_KEY);
      if (raw2) {
        try {
          const payload2 = JSON.parse(raw2);
          const fromEstimator = String(payload2?.source || "") === "estimator";
          if (fromEstimator) {
            setReturnToEstimator(true);
            setAutoUseOnSave(true);
          }
        } catch {}
        setDraft(emptyDraft(defaultCustomerType));
        setMissingRequired({});
        setMode("edit");
        localStorage.removeItem(PENDING_CUSTOMER_CREATE_KEY);
      }
    } catch {}
  }, [defaultCustomerType, list]);

  const customerKpis = useMemo(() => {
    const docs = readSavedDocs();
    const byId = {};
    for (const d of docs) {
      const cid = String(d?.customerId || "");
      if (!cid) continue;
      const b = calcBreakdown(d || {});
      const isInvoice = String(d?.docType || "").toLowerCase() === "invoice";
      if (!byId[cid]) {
        byId[cid] = {
          revenue: 0,
          internal: 0,
          profit: 0,
          estimateCount: 0,
          invoiceCount: 0,
          lastDate: "",
        };
      }
      byId[cid].revenue += toNum(b.revenue);
      byId[cid].internal += toNum(b.internal);
      byId[cid].profit += toNum(b.profit);
      if (isInvoice) byId[cid].invoiceCount += 1;
      else byId[cid].estimateCount += 1;

      const dt = String(d?.date || "").trim();
      if (dt) {
        // prefer latest lexicographically for ISO-like dates; fallback to keep non-empty
        if (!byId[cid].lastDate || dt > byId[cid].lastDate) byId[cid].lastDate = dt;
      }
    }
    for (const cid of Object.keys(byId)) {
      const rev = toNum(byId[cid].revenue);
      const prof = toNum(byId[cid].profit);
      byId[cid].margin = safeDiv(prof, rev);
    }
    return byId;
  }, [customers, localCustomers, q, mode]);


  const filtered = useMemo(() => {
  const qq = norm(q);
  const arr = list || [];
  if (!qq) return arr;

  const vals = [];
  const pushVal = (v) => {
    if (v === null || v === undefined) return;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      vals.push(String(v));
    }
  };

  const walk = (obj, depth = 0) => {
    if (obj === null || obj === undefined) return;
    if (depth > 4) return;
    if (Array.isArray(obj)) {
      for (const it of obj) walk(it, depth + 1);
      return;
    }
    if (typeof obj === "object") {
      for (const k of Object.keys(obj)) {
        // Ignore huge blobs if ever present
        if (k === "_raw" || k === "raw" || k === "html") continue;
        walk(obj[k], depth + 1);
      }
      return;
    }
    pushVal(obj);
  };

  return arr.filter((c) => {
    vals.length = 0;
    walk(c, 0);
    const blob = norm(vals.join(" "));
    return blob.includes(qq);
  });
}, [list, q]);

  function clearMissingRequiredField(field) {
    setMissingRequired((prev) => {
      if (!prev?.[field]) return prev;
      const next = { ...(prev || {}) };
      delete next[field];
      return next;
    });
  }

  function startNew(type = defaultCustomerType) {
    setReturnToEstimator(false);
    setAutoUseOnSave(false);
    setDraft(emptyDraft(type));
    setMissingRequired({});
    setMode("edit");
  }

  function startEdit(c, opts = {}) {
    const useEstimatorReturn = !!opts?.returnToEstimator;
    const useAutoOnSave = !!opts?.autoUseOnSave;
    setReturnToEstimator(useEstimatorReturn);
    setAutoUseOnSave(useAutoOnSave);
    const type = String(c?.type || "residential");
    const base = emptyDraft(type);
    setDraft({ ...base, ...(c || {}) });
    setMissingRequired({});
    setMode("edit");
  }

  function returnToEstimatorNow() {
    try { localStorage.removeItem(CUSTOMER_EDIT_TARGET_KEY); } catch {}
    setAutoUseOnSave(false);
    setReturnToEstimator(false);
    try { window.dispatchEvent(new Event("estipaid:navigate-estimator")); } catch {}
  }

  function saveDraft() {
    const d = draft || emptyDraft(defaultCustomerType);
    const type = String(d.type || "residential");

    if (type === "commercial") {
      if (!String(d.companyName || "").trim()) return alert(label("Company name is required.", "Nombre de la compañía es requerido."));
      if (!String(d.contactName || "").trim()) return alert(label("Primary contact is required.", "Contacto principal es requerido."));
      if (!String(d.jobsite?.street || "").trim()) return alert(label("Jobsite street is required.", "Calle del sitio es requerida."));
      if (!String(d.jobsite?.city || "").trim()) return alert(label("Jobsite city is required.", "Ciudad del sitio es requerida."));
      if (!String(d.jobsite?.state || "").trim()) return alert(label("Jobsite state is required.", "Estado del sitio es requerido."));
      if (!String(d.jobsite?.zip || "").trim()) return alert(label("Jobsite ZIP is required.", "ZIP del sitio es requerido."));
    } else {
      if (!String(d.fullName || "").trim()) return alert(label("Full name is required.", "Nombre completo es requerido."));
      if (!String(d.resService?.street || "").trim()) return alert(label("Street is required.", "Calle es requerida."));
      if (!String(d.resService?.city || "").trim()) return alert(label("City is required.", "Ciudad es requerida."));
      if (!String(d.resService?.state || "").trim()) return alert(label("State is required.", "Estado es requerido."));
      if (!String(d.resService?.zip || "").trim()) return alert(label("ZIP is required.", "ZIP es requerido."));
    }

    const nextMissing = {};
    const phoneValue = type === "commercial" ? d?.comPhone : d?.resPhone;
    const emailValue = type === "commercial" ? d?.comEmail : d?.resEmail;
    if (requirePhone && !String(phoneValue || "").trim()) nextMissing.phone = true;
    if (requireEmail && !String(emailValue || "").trim()) nextMissing.email = true;
    if (Object.keys(nextMissing).length > 0) {
      setMissingRequired(nextMissing);
      const requiredBits = [];
      if (nextMissing.phone) requiredBits.push(label("phone", "teléfono"));
      if (nextMissing.email) requiredBits.push(label("email", "correo"));
      alert(label(
        `Please add required ${requiredBits.join(" and ")} before saving.`,
        `Agrega ${requiredBits.join(" y ")} requerid${requiredBits.length > 1 ? "os" : "o"} antes de guardar.`
      ));
      return;
    }
    setMissingRequired({});

    const termsType = String(d?.netTermsType || "").trim() || "DUE_UPON_RECEIPT";
    const validTerms = new Set(["DUE_UPON_RECEIPT", "NET_15", "NET_30", "NET_CUSTOM"]);
    const safeTermsType = validTerms.has(termsType) ? termsType : "DUE_UPON_RECEIPT";
    let safeTermsDays = null;
    if (safeTermsType === "NET_CUSTOM") {
      const parsed = parseInt(String(d?.netTermsDays ?? "").trim(), 10);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 365) {
        return alert(label("Custom net terms days must be between 0 and 365.", "Los días personalizados deben estar entre 0 y 365."));
      }
      safeTermsDays = parsed;
    }

    const id = String(d.id || "").trim() || buildId();
    const now = Date.now();

    // normalize booleans
    const nextItem = { ...d, id, updatedAt: now, netTermsType: safeTermsType, netTermsDays: safeTermsDays };

    // Enforce billing address behavior
    if (type === "commercial") {
      if (nextItem.billSameAsJob) nextItem.billing = { ...nextItem.jobsite };
    } else {
      if (nextItem.resBillingSame) nextItem.resBilling = { ...nextItem.resService };
    }

    // Estimator compatibility fields (flat)
    try {
      const flat = toEstimatorFlat(nextItem);
      nextItem.name = flat.name;
      nextItem.phone = flat.phone;
      nextItem.email = flat.email;
      nextItem.attn = flat.attn;
      nextItem.address = flat.address;
      nextItem.billingAddress = flat.billingAddress;
      nextItem.city = flat.city;
      nextItem.state = flat.state;
      nextItem.zip = flat.zip;
    } catch {}

    const next = Array.isArray(list) ? [...list] : [];
    const idx = next.findIndex((x) => String(x?.id) === String(id));
    if (idx >= 0) next[idx] = { ...next[idx], ...nextItem };
    else next.unshift(nextItem);

    // sort recently used
    next.sort((a, b) => (Number(b?.lastUsed) || 0) - (Number(a?.lastUsed) || 0));
    persistCustomers(next);

    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);

    setMode("list");
    setToastMessage(label("Customer saved", "Cliente guardado"));
    setShowToast(true);

    if (autoUseOnSave && typeof onDone === "function") {
      try {
        const payloadCustomer = { ...nextItem, ...toEstimatorFlat(nextItem) };
        localStorage.setItem(PENDING_CUSTOMER_USE_KEY, JSON.stringify({ id, customer: payloadCustomer, ts: Date.now() }));
        window.dispatchEvent(new Event("estipaid:customer-use"));
      } catch {}
      try { onDone({ id, customer: nextItem }); } catch {}
      setAutoUseOnSave(false);
    }
  }

  function del(id) {
    const sid = String(id || "");
    const target = (Array.isArray(list) ? list : []).find((c) => String(c?.id || "") === sid);
    const nm = target ? displayName(target) : sid;
    const ok = window.confirm(label(`Delete customer: ${nm}? This cannot be undone.`, `¿Eliminar cliente: ${nm}? Esto no se puede deshacer.`));
    if (!ok) return;
    const next = (Array.isArray(list) ? list : []).filter((c) => String(c?.id || "") !== sid);
    persistCustomers(next);
    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);
    if (String(selectedCustomerId || "") === sid && typeof setSelectedCustomerId === "function") setSelectedCustomerId("");
  }

  function useCustomer(c) {
    const id = String(c?.id || "");
    const next = (Array.isArray(list) ? [...list] : []).map((x) => (String(x?.id) === id ? { ...x, lastUsed: Date.now() } : x));
    persistCustomers(next);
    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);

    if (typeof setSelectedCustomerId === "function") setSelectedCustomerId(id);

    // Handoff to EstimateForm (same-tab; storage event won't fire)
    try {
      const payload = { id, customer: { ...c, ...toEstimatorFlat(c) }, ts: Date.now() };
      localStorage.setItem(PENDING_CUSTOMER_USE_KEY, JSON.stringify(payload));
      window.dispatchEvent(new Event("estipaid:customer-use"));
    } catch {}

    if (typeof onDone === "function") onDone({ id, customer: c });
  }

  return (
    <section className="pe-section">
      {returnToEstimator && (
        <button
          className="pe-btn pe-btn-ghost"
          type="button"
          style={{ marginBottom: 10 }}
          onClick={returnToEstimatorNow}
        >
          ← Back to Estimator
        </button>
      )}
      {mode === "list" ? (
        <div className="pe-card">
          <div className="pe-company-profile-header pe-utility-panel-header" style={stickyListHeaderStyle}>
            <div className="pe-company-header-title">
              <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title={label("Customers", "Clientes")}>{label("Customers", "Clientes")}</h1>
            </div>

              <div className="pe-company-header-controls">
                <button className="pe-btn" type="button" onClick={() => startNew()}>
                  {label("Add Customer", "Agregar cliente")}
                </button>
              </div>
          </div>

          <div className={`ep-section-gap-sm ${showListSkeleton ? "" : "pe-content-fade-in"}`} style={{ display: "grid", gap: 12 }}>
            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={{ ...cardBaseStyle, display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <input
                  className="pe-input"
                  placeholder={label("Search name, phone, email, PO, address…", "Buscar nombre, teléfono, correo, PO, dirección…")}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  style={{ flex: "1 1 280px" }}
                />
              </div>
            </div>

            {showListSkeleton ? (
              <div className="pe-skeleton-stack" aria-hidden="true">
                {[0, 1, 2].map((idx) => (
                  <div key={`customer-skel-${idx}`} className="pe-skeleton-card">
                    <div className="pe-skeleton-row">
                      <div className="pe-skeleton-col">
                        <div className="pe-skeleton-line w55" />
                        <div className="pe-skeleton-line w70" />
                        <div className="pe-skeleton-line w85" />
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
              <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={{ ...cardBaseStyle, textAlign: "center", padding: 18 }}>
                <div style={{ display: "grid", placeItems: "center", marginBottom: 8, opacity: 0.68 }}>
                  <EmptyCustomersIcon />
                </div>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>No customers yet. Add your first customer to begin.</div>
                <button className="pe-btn" type="button" onClick={() => startNew()}>
                  {label("Add Customer", "Agregar cliente")}
                </button>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}>
              {filtered.map((c) => {
                const id = String(c?.id || "");
                const active = String(selectedCustomerId || "") && String(selectedCustomerId) === id;

                return (
                  <div className="pe-card pe-card-content ep-glass-tile" key={id || Math.random()} style={{ ...cardBaseStyle, ...(active ? cardActiveStyle : null), display: "grid", gap: 10, cursor: "pointer" }}>
                    <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div style={{ display: "grid", gap: 6, minWidth: 240, flex: "1 1 320px" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 900, fontSize: 16, letterSpacing: 0.2 }}>{displayName(c)}</div>
                          <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>
                            {String(c?.type || "residential") === "commercial" ? label("Commercial", "Comercial") : label("Residential", "Residencial")}
                          </div>
                          {active ? <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.85 }}>{label("Selected", "Seleccionado")}</div> : null}
                        </div>

                        {contactLine(c) ? <TextLine>{contactLine(c)}</TextLine> : null}
                        {phoneEmailLine(c) ? <TextLine>{phoneEmailLine(c)}</TextLine> : null}
                        {mainAddressText(c) ? <TextLine>{mainAddressText(c)}</TextLine> : null}

                        {/* KPIs (live computed from saved estimates/invoices) */}
                        {customerKpis && id ? (
                          <div
                            style={{
                              marginTop: 6,
                              paddingTop: 10,
                              borderTop: "1px solid rgba(255,255,255,0.10)",
                              display: "grid",
                              gridTemplateColumns: "1fr 1fr",
                              gap: 10,
                            }}
                          >
                            <div style={{ display: "grid", gap: 2 }}>
                              <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                {label("Revenue", "Ingresos")}
                              </div>
                              <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.95 }}>
                                {moneyUSD(customerKpis[id]?.revenue || 0)}
                              </div>
                            </div>
                            <div style={{ display: "grid", gap: 2 }}>
                              <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                {label("Avg margin", "Margen prom.")}
                              </div>
                              <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.95 }}>
                                {Math.round(toNum(customerKpis[id]?.margin || 0) * 100)}%
                              </div>
                            </div>
                            <div style={{ display: "grid", gap: 2 }}>
                              <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                {label("Jobs", "Trabajos")}
                              </div>
                              <div style={{ fontSize: 14, fontWeight: 900, opacity: 0.95 }}>
                                {toNum(customerKpis[id]?.estimateCount || 0) + toNum(customerKpis[id]?.invoiceCount || 0)}
                              </div>
                            </div>
                            <div style={{ display: "grid", gap: 2 }}>
                              <div style={{ fontSize: 11, fontWeight: 900, opacity: 0.65, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                {label("Last", "Último")}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.85 }}>
                                {String(customerKpis[id]?.lastDate || "—") || "—"}
                              </div>
                            </div>
                          </div>
                        ) : null}
                      </div>

                      <div style={{ display: "grid", gap: 8, minWidth: 220, justifyItems: "stretch" }}>
                        <button className="pe-btn" type="button" onClick={() => useCustomer(c)} style={{ width: "100%" }}>
                          {label("Use", "Usar")}
                        </button>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                          <button className="pe-btn pe-btn-ghost" type="button" onClick={() => startEdit(c)} style={{ width: "100%" }}>
                            {label("Edit", "Editar")}
                          </button>
                          <button className="pe-btn pe-btn-ghost" type="button" onClick={() => del(c?.id)} style={{ width: "100%" }}>
                            {label("Delete", "Eliminar")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="pe-card">
          <div className="pe-company-profile-header">
            <div className="pe-company-header-title">
              <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title={label("Edit Customer", "Editar Cliente")}>{label("Edit Customer", "Editar Cliente")}</h1>
            </div>

            <div className="pe-company-header-controls">
              <button
                className="pe-btn pe-btn-ghost"
                type="button"
                onClick={() => {
                  if (returnToEstimator) {
                    returnToEstimatorNow();
                    return;
                  }
                  setMode("list");
                }}
              >
                {label("Cancel", "Cancelar")}
              </button>
              <button className="pe-btn" type="button" onClick={saveDraft}>
                {label("Save", "Guardar")}
              </button>
            </div>
          </div>

            <div className="pe-company-form-inner pe-customer-edit-form">
            <div className="pe-company-form-section">
              <CustomerSectionHeader title={label("Customer Type", "Tipo de Cliente")} />
              <div className="pe-company-grid-12">
                <div className="pe-company-col-12">
                  <div className="pe-customer-toggle-row">
                    <button
                      type="button"
                      onClick={() => {
                        setDraft((d) => ({ ...emptyDraft("residential"), ...d, type: "residential" }));
                        setMissingRequired({});
                      }}
                      className={`pe-btn pe-customer-toggle-segment ${(draft.type || "commercial") === "residential" ? "is-active" : "pe-btn-ghost"}`}
                      aria-pressed={(draft.type || "commercial") === "residential"}
                    >
                      {label("Residential", "Residencial")}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft((d) => ({ ...emptyDraft("commercial"), ...d, type: "commercial" }));
                        setMissingRequired({});
                      }}
                      className={`pe-btn pe-customer-toggle-segment ${(draft.type || "commercial") === "commercial" ? "is-active" : "pe-btn-ghost"}`}
                      aria-pressed={(draft.type || "commercial") === "commercial"}
                    >
                      {label("Commercial", "Comercial")}
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="pe-company-form-section">
              <CustomerSectionHeader title={label("Billing Preferences", "Preferencias de Facturación")} />
              <div className="pe-company-grid-12">
                <Field
                  as="select"
                  fieldClassName="pe-company-col-7"
                  label={label("Net terms", "Términos de pago")}
                  value={String(draft.netTermsType || "DUE_UPON_RECEIPT")}
                  onChange={(e) => {
                    const nextType = String(e.target.value || "DUE_UPON_RECEIPT");
                    setDraft((d) => ({ ...d, netTermsType: nextType, netTermsDays: nextType === "NET_CUSTOM" ? d.netTermsDays : null }));
                  }}
                >
                  {NET_TERMS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {label(o.labelEn, o.labelEs)}
                    </option>
                  ))}
                </Field>
                {String(draft.netTermsType || "") === "NET_CUSTOM" ? (
                  <Field
                    fieldClassName="pe-company-col-5"
                    label={label("Custom days", "Días personalizados")}
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={365}
                    step={1}
                    value={draft.netTermsDays ?? ""}
                    onChange={(e) => setDraft((d) => ({ ...d, netTermsDays: e.target.value }))}
                  />
                ) : (
                  <div className="pe-company-col-5" />
                )}

                {(draft.type || "residential") === "commercial" ? (
                  <label className="pe-company-col-12" style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                    <input type="checkbox" checked={Boolean(draft.poRequired)} onChange={(e) => setDraft((d) => ({ ...d, poRequired: e.target.checked }))} />
                    <span className="pe-field-helper">{label("PO required", "PO Requerido")}</span>
                  </label>
                ) : null}
              </div>
            </div>

            {(draft.type || "residential") === "commercial" ? (
              <>
                <div className="pe-company-form-section">
                  <CustomerSectionHeader title={label("Company", "Compañía")} />
                  <div className="pe-company-grid-12">
                    <Field
                      fieldClassName="pe-company-col-12"
                      label={label("Company name *", "Nombre de la compañía *")}
                      placeholder={label("Example: Desert Ridge HOA", "Ejemplo: Desert Ridge HOA")}
                      value={draft.companyName}
                      onChange={(e) => setDraft((d) => ({ ...d, companyName: e.target.value }))}
                    />
                    <Field
                      fieldClassName="pe-company-col-7"
                      label={label("Main contact *", "Contacto principal *")}
                      placeholder={label("Example: Alex Smith", "Ejemplo: Alex Smith")}
                      value={draft.contactName}
                      onChange={(e) => setDraft((d) => ({ ...d, contactName: e.target.value }))}
                    />
                    <Field
                      fieldClassName="pe-company-col-5"
                      label={label("Contact title", "Puesto")}
                      value={draft.contactTitle}
                      onChange={(e) => setDraft((d) => ({ ...d, contactTitle: e.target.value }))}
                    />
                    <Field
                      fieldClassName="pe-company-col-5"
                      label={requirePhone ? label("Phone *", "Teléfono *") : label("Phone", "Teléfono")}
                      labelClassName={phoneFieldMissing ? "pe-company-field-missing-label" : ""}
                      controlClassName={phoneFieldMissing ? "pe-company-field-missing-input" : ""}
                      errorText={phoneFieldMissing ? label("Phone is required by settings.", "El teléfono es requerido por configuración.") : ""}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder={label("Example: 602-555-0147", "Ejemplo: 602-555-0147")}
                      helperText={hasValidPhoneValue(draft.comPhone) ? validHelperText() : ""}
                      value={draft.comPhone}
                      onChange={(e) => {
                        clearMissingRequiredField("phone");
                        setDraft((d) => ({ ...d, comPhone: formatPhoneUS(e.target.value) }));
                      }}
                    />
                    <Field
                      fieldClassName="pe-company-col-7"
                      label={requireEmail ? label("Email *", "Correo *") : label("Email", "Correo")}
                      labelClassName={emailFieldMissing ? "pe-company-field-missing-label" : ""}
                      controlClassName={emailFieldMissing ? "pe-company-field-missing-input" : ""}
                      errorText={emailFieldMissing ? label("Email is required by settings.", "El correo es requerido por configuración.") : ""}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder={label("Example: office@desertridgehoa.com", "Ejemplo: oficina@desertridgehoa.com")}
                      helperText={hasValidEmailValue(draft.comEmail) ? validHelperText() : ""}
                      value={draft.comEmail}
                      onChange={(e) => {
                        clearMissingRequiredField("email");
                        setDraft((d) => ({ ...d, comEmail: e.target.value }));
                      }}
                    />
                    <Field
                      fieldClassName="pe-company-col-12"
                      label={label("AP email", "Correo de Cuentas por Pagar")}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder={label("Example: ap@desertridgehoa.com", "Ejemplo: cuentas@desertridgehoa.com")}
                      value={draft.apEmail}
                      onChange={(e) => setDraft((d) => ({ ...d, apEmail: e.target.value }))}
                    />
                  </div>
                </div>

                <div className="pe-company-form-section">
                  <CustomerSectionHeader title={label("Jobsite Address", "Dirección del Sitio")} />
                  <div className="pe-company-grid-12">
                    <Field
                      fieldClassName="pe-company-col-12"
                      label={label("Address 1 *", "Dirección 1 *")}
                      type="text"
                      autoComplete="street-address"
                      placeholder={label("Example: 1234 E Camelback Rd, Phoenix AZ", "Ejemplo: 1234 E Camelback Rd, Phoenix AZ")}
                      value={draft.jobsite.street}
                      onChange={(e) => setDraft((d) => ({ ...d, jobsite: { ...d.jobsite, street: e.target.value } }))}
                    />
                    <Field
                      fieldClassName="pe-company-col-5"
                      label={label("City *", "Ciudad *")}
                      type="text"
                      autoComplete="address-level2"
                      placeholder={label("Example: Phoenix", "Ejemplo: Phoenix")}
                      value={draft.jobsite.city}
                      onChange={(e) => setDraft((d) => ({ ...d, jobsite: { ...d.jobsite, city: e.target.value } }))}
                    />
                    <div className="pe-field pe-company-col-4">
                      <FieldLabel>{label("State *", "Estado *")}</FieldLabel>
                      <StateSelect value={draft.jobsite.state} onChange={(e) => setDraft((d) => ({ ...d, jobsite: { ...d.jobsite, state: e.target.value } }))} />
                    </div>
                    <Field
                      fieldClassName="pe-company-col-3"
                      label={label("ZIP *", "ZIP *")}
                      type="text"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      placeholder="85001"
                      value={draft.jobsite.zip}
                      onChange={(e) => setDraft((d) => ({ ...d, jobsite: { ...d.jobsite, zip: formatZipUS(e.target.value) } }))}
                    />
                  </div>
                </div>

                <div className="pe-company-form-section">
                  <CustomerSectionHeader title={label("Billing", "Facturación")} />
                  <div className="pe-company-grid-12">
                    <label className="pe-company-col-12" style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input type="checkbox" checked={Boolean(draft.billSameAsJob)} onChange={(e) => setDraft((d) => ({ ...d, billSameAsJob: e.target.checked }))} />
                      <span className="pe-field-helper">{label("Billing same as jobsite", "Facturación igual al sitio")}</span>
                    </label>

                    {!draft.billSameAsJob ? (
                      <>
                        <Field
                          fieldClassName="pe-company-col-12"
                          label={label("Address 1", "Dirección 1")}
                          type="text"
                          autoComplete="street-address"
                          placeholder={label("Example: 1234 E Camelback Rd, Phoenix AZ", "Ejemplo: 1234 E Camelback Rd, Phoenix AZ")}
                          value={draft.billing.street}
                          onChange={(e) => setDraft((d) => ({ ...d, billing: { ...d.billing, street: e.target.value } }))}
                        />
                        <Field
                          fieldClassName="pe-company-col-5"
                          label={label("City", "Ciudad")}
                          type="text"
                          autoComplete="address-level2"
                          placeholder={label("Example: Phoenix", "Ejemplo: Phoenix")}
                          value={draft.billing.city}
                          onChange={(e) => setDraft((d) => ({ ...d, billing: { ...d.billing, city: e.target.value } }))}
                        />
                        <div className="pe-field pe-company-col-4">
                          <FieldLabel>{label("State", "Estado")}</FieldLabel>
                          <StateSelect value={draft.billing.state} onChange={(e) => setDraft((d) => ({ ...d, billing: { ...d.billing, state: e.target.value } }))} placeholder={label("State", "Estado")} />
                        </div>
                        <Field
                          fieldClassName="pe-company-col-3"
                          label={label("ZIP", "ZIP")}
                          type="text"
                          inputMode="numeric"
                          autoComplete="postal-code"
                          placeholder="85001"
                          value={draft.billing.zip}
                          onChange={(e) => setDraft((d) => ({ ...d, billing: { ...d.billing, zip: formatZipUS(e.target.value) } }))}
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="pe-company-form-section">
                  <CustomerSectionHeader title={label("Customer", "Cliente")} />
                  <div className="pe-company-grid-12">
                    <Field
                      fieldClassName="pe-company-col-12"
                      label={label("Full name *", "Nombre completo *")}
                      placeholder={label("Example: Alex Smith", "Ejemplo: Alex Smith")}
                      value={draft.fullName}
                      onChange={(e) => setDraft((d) => ({ ...d, fullName: e.target.value }))}
                    />
                    <Field
                      fieldClassName="pe-company-col-5"
                      label={requirePhone ? label("Phone *", "Teléfono *") : label("Phone", "Teléfono")}
                      labelClassName={phoneFieldMissing ? "pe-company-field-missing-label" : ""}
                      controlClassName={phoneFieldMissing ? "pe-company-field-missing-input" : ""}
                      errorText={phoneFieldMissing ? label("Phone is required by settings.", "El teléfono es requerido por configuración.") : ""}
                      type="tel"
                      inputMode="tel"
                      autoComplete="tel"
                      placeholder={label("Example: 602-555-0147", "Ejemplo: 602-555-0147")}
                      helperText={hasValidPhoneValue(draft.resPhone) ? validHelperText() : ""}
                      value={draft.resPhone}
                      onChange={(e) => {
                        clearMissingRequiredField("phone");
                        setDraft((d) => ({ ...d, resPhone: formatPhoneUS(e.target.value) }));
                      }}
                    />
                    <Field
                      fieldClassName="pe-company-col-7"
                      label={requireEmail ? label("Email *", "Correo *") : label("Email", "Correo")}
                      labelClassName={emailFieldMissing ? "pe-company-field-missing-label" : ""}
                      controlClassName={emailFieldMissing ? "pe-company-field-missing-input" : ""}
                      errorText={emailFieldMissing ? label("Email is required by settings.", "El correo es requerido por configuración.") : ""}
                      type="email"
                      inputMode="email"
                      autoComplete="email"
                      placeholder={label("Example: alex.smith@email.com", "Ejemplo: alex.smith@email.com")}
                      helperText={hasValidEmailValue(draft.resEmail) ? validHelperText() : ""}
                      value={draft.resEmail}
                      onChange={(e) => {
                        clearMissingRequiredField("email");
                        setDraft((d) => ({ ...d, resEmail: e.target.value }));
                      }}
                    />
                  </div>
                </div>

                <div className="pe-company-form-section">
                  <CustomerSectionHeader title={label("Address", "Dirección")} />
                  <div className="pe-company-grid-12">
                    <Field
                      fieldClassName="pe-company-col-12"
                      label={label("Address 1 *", "Dirección 1 *")}
                      type="text"
                      autoComplete="street-address"
                      placeholder={label("Example: 1234 E Camelback Rd, Phoenix AZ", "Ejemplo: 1234 E Camelback Rd, Phoenix AZ")}
                      value={draft.resService.street}
                      onChange={(e) => setDraft((d) => ({ ...d, resService: { ...d.resService, street: e.target.value } }))}
                    />
                    <Field
                      fieldClassName="pe-company-col-5"
                      label={label("City *", "Ciudad *")}
                      type="text"
                      autoComplete="address-level2"
                      placeholder={label("Example: Phoenix", "Ejemplo: Phoenix")}
                      value={draft.resService.city}
                      onChange={(e) => setDraft((d) => ({ ...d, resService: { ...d.resService, city: e.target.value } }))}
                    />
                    <div className="pe-field pe-company-col-4">
                      <FieldLabel>{label("State *", "Estado *")}</FieldLabel>
                      <StateSelect value={draft.resService.state} onChange={(e) => setDraft((d) => ({ ...d, resService: { ...d.resService, state: e.target.value } }))} />
                    </div>
                    <Field
                      fieldClassName="pe-company-col-3"
                      label={label("ZIP *", "ZIP *")}
                      type="text"
                      inputMode="numeric"
                      autoComplete="postal-code"
                      placeholder="85001"
                      value={draft.resService.zip}
                      onChange={(e) => setDraft((d) => ({ ...d, resService: { ...d.resService, zip: formatZipUS(e.target.value) } }))}
                    />
                  </div>
                </div>

                <div className="pe-company-form-section">
                  <CustomerSectionHeader title={label("Billing", "Facturación")} />
                  <div className="pe-company-grid-12">
                    <label className="pe-company-col-12" style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input type="checkbox" checked={Boolean(draft.resBillingSame)} onChange={(e) => setDraft((d) => ({ ...d, resBillingSame: e.target.checked }))} />
                      <span className="pe-field-helper">{label("Billing same as service", "Facturación igual al servicio")}</span>
                    </label>

                    {!draft.resBillingSame ? (
                      <>
                        <Field
                          fieldClassName="pe-company-col-12"
                          label={label("Address 1", "Dirección 1")}
                          type="text"
                          autoComplete="street-address"
                          placeholder={label("Example: 1234 E Camelback Rd, Phoenix AZ", "Ejemplo: 1234 E Camelback Rd, Phoenix AZ")}
                          value={draft.resBilling.street}
                          onChange={(e) => setDraft((d) => ({ ...d, resBilling: { ...d.resBilling, street: e.target.value } }))}
                        />
                        <Field
                          fieldClassName="pe-company-col-5"
                          label={label("City", "Ciudad")}
                          type="text"
                          autoComplete="address-level2"
                          placeholder={label("Example: Phoenix", "Ejemplo: Phoenix")}
                          value={draft.resBilling.city}
                          onChange={(e) => setDraft((d) => ({ ...d, resBilling: { ...d.resBilling, city: e.target.value } }))}
                        />
                        <div className="pe-field pe-company-col-4">
                          <FieldLabel>{label("State", "Estado")}</FieldLabel>
                          <StateSelect value={draft.resBilling.state} onChange={(e) => setDraft((d) => ({ ...d, resBilling: { ...d.resBilling, state: e.target.value } }))} placeholder={label("State", "Estado")} />
                        </div>
                        <Field
                          fieldClassName="pe-company-col-3"
                          label={label("ZIP", "ZIP")}
                          type="text"
                          inputMode="numeric"
                          autoComplete="postal-code"
                          placeholder="85001"
                          value={draft.resBilling.zip}
                          onChange={(e) => setDraft((d) => ({ ...d, resBilling: { ...d.resBilling, zip: formatZipUS(e.target.value) } }))}
                        />
                      </>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      {showToast ? (
        <div className="pe-toast" role="status" aria-live="polite">{toastMessage}</div>
      ) : null}
    </section>
  );
}
