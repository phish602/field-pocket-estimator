// @ts-nocheck
/* eslint-disable */
import React, { useEffect, useMemo, useRef, useState } from "react";
import Field from "../components/Field";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { DEFAULT_SETTINGS, loadSettings } from "../utils/settings";
import { computeTotals } from "../estimator/engine";
import { INVOICE_STATUSES, deriveInvoiceStatus, readStoredInvoices } from "../utils/invoices";
import { readStoredProjects, buildNormalizedProjectView, deriveProjectDisplayStatus } from "../utils/projects";
import { markCloudBackupDirty } from "../lib/cloudBackupQueue";
import { useBusinessMutationGuard } from "../lib/BusinessMutationGuardContext";
import CloudBackupInlineStatus from "../components/CloudBackupInlineStatus";

const CUSTOMERS_KEY = STORAGE_KEYS.CUSTOMERS;
const PENDING_CUSTOMER_USE_KEY = STORAGE_KEYS.PENDING_CUSTOMER_USE;
const PENDING_CUSTOMER_EDIT_KEY = STORAGE_KEYS.PENDING_CUSTOMER_EDIT;
const PENDING_CUSTOMER_CREATE_KEY = STORAGE_KEYS.PENDING_CUSTOMER_CREATE;
const CUSTOMER_EDIT_TARGET_KEY = STORAGE_KEYS.CUSTOMER_EDIT_TARGET;

// ===== Customer KPI (live-compute) =====
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const INVOICES_KEY = STORAGE_KEYS.INVOICES;

const CUST_PROJECT_STATUS_COLORS = {
  draft: { color: "rgba(230,241,248,0.5)" },
  estimating: { color: "rgba(245,158,11,0.84)" },
  active: { color: "rgba(72,187,120,0.82)" },
  completed: { color: "rgba(99,179,237,0.84)" },
  archived: { color: "rgba(230,241,248,0.35)" },
};

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
    const estimates = estimateRaw ? safeParse(estimateRaw, []) : [];
    const invoices = readStoredInvoices();
    const estimateRecords = Array.isArray(estimates)
      ? estimates.filter((record) => String(record?.docType || "estimate").toLowerCase() !== "invoice")
      : [];
    const merged = [
      ...estimateRecords,
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
    markCloudBackupDirty({
      reason: "customer_data_saved",
      domains: ["customers"],
      severity: "normal",
      source: "persistCustomers",
    });
  } catch {}
}

function buildId() {
  return `c_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function norm(s) {
  return String(s || "").trim().toLowerCase();
}

function normalizeCustomerLookupName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeBuilderIntent(value) {
  return String(value || "").trim().toLowerCase() === "invoice" ? "invoice" : "estimate";
}

function collectCustomerLookupNames(customer) {
  const rawNames = [
    customer?.name,
    customer?.companyName,
    customer?.fullName,
  ];
  return [...new Set(rawNames.map(normalizeCustomerLookupName).filter(Boolean))];
}

function collectDocCustomerLookupNames(doc) {
  const rawNames = [
    doc?.customerName,
    doc?.customer?.name,
    doc?.customer?.companyName,
    doc?.customer?.fullName,
  ];
  return [...new Set(rawNames.map(normalizeCustomerLookupName).filter(Boolean))];
}

function collectProjectLookupNames(project, view) {
  const rawNames = [
    project?.customerName,
    project?.customer?.name,
    project?.customer?.companyName,
    project?.customer?.fullName,
    view?.customer?.name,
    view?.customer?.companyName,
    view?.customer?.fullName,
  ];
  return [...new Set(rawNames.map(normalizeCustomerLookupName).filter(Boolean))];
}

function findLinkedProjectsForCustomer(customer, allProjects = [], allCustomers = [], allEstimates = [], allInvoices = []) {
  const customerId = String(customer?.id || "").trim();
  const projectList = Array.isArray(allProjects) ? allProjects.filter(Boolean) : [];
  const exactMatches = customerId
    ? projectList.filter((project) => String(project?.customerId || project?.customer?.id || "").trim() === customerId)
    : [];
  if (exactMatches.length > 0) return exactMatches;

  const targetNames = new Set(collectCustomerLookupNames(customer));
  if (!targetNames.size) return [];

  return projectList.filter((project) => {
    const view = buildNormalizedProjectView({
      project,
      projects: projectList,
      customers: Array.isArray(allCustomers) ? allCustomers : [],
      estimates: Array.isArray(allEstimates) ? allEstimates : [],
      invoices: Array.isArray(allInvoices) ? allInvoices : [],
    });
    return collectProjectLookupNames(project, view).some((name) => targetNames.has(name));
  });
}

// Narrow read-only summary of a customer's linked business history. Used to
// decide whether a customer may be hard deleted (no history) or must be
// archived instead (has history). Matching mirrors del()/KPI logic: direct
// customer-id first, then exact normalized name fallback only (no fuzzy match).
// Invoices carry amountPaid/payments/status, so linked invoices represent
// payment history.
function getCustomerBusinessHistory(customer, allCustomers = []) {
  const allProjects = readStoredProjects();
  const allDocs = readSavedDocs();
  const allEstimates = allDocs.filter((d) => String(d?.docType || "estimate").toLowerCase() !== "invoice");
  const allInvoices = allDocs.filter((d) => String(d?.docType || "").toLowerCase() === "invoice");

  const linkedProjects = findLinkedProjectsForCustomer(
    customer,
    allProjects,
    Array.isArray(allCustomers) ? allCustomers : [],
    allEstimates,
    allInvoices,
  );

  const custId = String(customer?.id || "").trim();
  const targetNames = new Set(collectCustomerLookupNames(customer));
  const isDocLinked = (d) => {
    const docCustId = String(d?.customerId || d?.customer?.id || "").trim();
    if (custId && docCustId === custId) return true;
    return collectDocCustomerLookupNames(d).some((name) => targetNames.has(name));
  };
  const linkedEstimates = allEstimates.filter(isDocLinked);
  const linkedInvoices = allInvoices.filter(isDocLinked);

  const parts = [];
  if (linkedProjects.length > 0) parts.push(`${linkedProjects.length} project${linkedProjects.length === 1 ? "" : "s"}`);
  if (linkedEstimates.length > 0) parts.push(`${linkedEstimates.length} estimate${linkedEstimates.length === 1 ? "" : "s"}`);
  if (linkedInvoices.length > 0) parts.push(`${linkedInvoices.length} invoice${linkedInvoices.length === 1 ? "" : "s"}`);

  return {
    linkedProjects,
    linkedEstimates,
    linkedInvoices,
    hasHistory: linkedProjects.length > 0 || linkedEstimates.length > 0 || linkedInvoices.length > 0,
    parts,
  };
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

function deriveCustomerNextAction(account) {
  if ((account?.overdueInvoiceCount || 0) > 0) {
    return {
      key: "resolve-overdue",
      tone: "danger",
    };
  }
  if ((account?.balanceDue || 0) > 0) {
    return {
      key: "collect-balance",
      tone: "warning",
    };
  }
  if ((account?.activeProjectCount || 0) > 0) {
    return {
      key: "review-active-work",
      tone: "info",
    };
  }
  if ((account?.openDocumentCount || 0) > 0) {
    return {
      key: "review-open-docs",
      tone: "success",
    };
  }
  return {
    key: "update-account",
    tone: "neutral",
  };
}

export default function CustomersScreen({
  lang = "en",
  t = (k) => k,
  customers,
  setCustomers,
  selectedCustomerId,
  setSelectedCustomerId,
  onDone,
  onOpenProjectDetail,
}) {
  const label = (en, es) => labelOf(lang, en, es);
  const { ensureCanMutateBusinessData } = useBusinessMutationGuard();

  const [projectChooser, setProjectChooser] = useState(null);
  // projectChooser: null | { customerId, projects: [] } | { customerId, empty: true }

  const [settingsSnapshot, setSettingsSnapshot] = useState(() => loadSettings());
  const customerSettings = settingsSnapshot?.customer || DEFAULT_SETTINGS.customer;
  const defaultCustomerType = customerSettings?.defaultCustomerType === "commercial" ? "commercial" : "residential";
  const requirePhone = !!customerSettings?.requirePhone;
  const requireEmail = !!customerSettings?.requireEmail;
  const [localCustomers, setLocalCustomers] = useState(() => (Array.isArray(customers) ? [] : readCustomers()));
  const [q, setQ] = useState("");
  const [typeaheadHidden, setTypeaheadHidden] = useState(false);
  const [highlightCustomerId, setHighlightCustomerId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const cardRefs = useRef({});
  const highlightTimerRef = useRef(null);
  const typeaheadWrapRef = useRef(null);
  const [mode, setMode] = useState("list"); // list | edit
  const [showListSkeleton, setShowListSkeleton] = useState(true);
  const [toastMessage, setToastMessage] = useState("");
  const [showToast, setShowToast] = useState(false);
  const [draft, setDraft] = useState(() => emptyDraft(defaultCustomerType));
  const [returnToEstimator, setReturnToEstimator] = useState(false);
  const [autoUseOnSave, setAutoUseOnSave] = useState(false);
  const [builderReturnIntent, setBuilderReturnIntent] = useState("estimate");
  const [missingRequired, setMissingRequired] = useState({});
  const [refreshSeq, setRefreshSeq] = useState(0);

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
    const onLocalStorage = (event) => {
      if (event?.detail?.key === STORAGE_KEYS.SETTINGS) {
        setSettingsSnapshot(loadSettings());
      }
    };
    window.addEventListener("estipaid:settings-changed", refresh);
    window.addEventListener("storage", refresh);
    window.addEventListener("pe-localstorage", onLocalStorage);
    return () => {
      window.removeEventListener("estipaid:settings-changed", refresh);
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pe-localstorage", onLocalStorage);
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      if (!Array.isArray(customers)) setLocalCustomers(readCustomers());
      setRefreshSeq((value) => value + 1);
    };
    const onStorage = (e) => {
      if (!e) return;
      if (e.key === CUSTOMERS_KEY) refresh();
    };
    const onLocalStorage = (event) => {
      if (event?.detail?.key === CUSTOMERS_KEY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("estipaid:customers-changed", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:customers-changed", refresh);
    };
  }, [customers]);

  useEffect(() => {
    const relevantStorageKeys = new Set([
      STORAGE_KEYS.PROJECTS,
      STORAGE_KEYS.ESTIMATES,
      STORAGE_KEYS.INVOICES,
    ]);
    const refresh = () => setRefreshSeq((value) => value + 1);
    const onStorage = (event) => {
      if (!event || event.key == null || relevantStorageKeys.has(event.key)) {
        refresh();
      }
    };
    const onLocalStorage = (event) => {
      if (
        !event?.detail?.key
        || relevantStorageKeys.has(event.detail.key)
      ) {
        refresh();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const appEvents = [
      "estipaid:estimates-changed",
      "estipaid:invoices-changed",
    ];

    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("focus", refresh);
    appEvents.forEach((name) => window.addEventListener(name, refresh));
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("focus", refresh);
      appEvents.forEach((name) => window.removeEventListener(name, refresh));
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

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
        const payload = JSON.parse(rawEditTarget);
        const id = String(payload?.id || "");
        if (id) {
          const c = (list || []).find((x) => String(x?.id) === id || String(x?.customerId) === id);
          if (c) {
            startEdit(c, { returnToEstimator: true, autoUseOnSave: true, builderIntent: payload?.builderIntent || payload?.intent });
            localStorage.removeItem(CUSTOMER_EDIT_TARGET_KEY);
          }
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
          if (c) {
            startEdit(c);
            localStorage.removeItem(PENDING_CUSTOMER_EDIT_KEY);
          }
        }
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
            setBuilderReturnIntent(normalizeBuilderIntent(payload2?.builderIntent || payload2?.intent));
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
    const customerList = Array.isArray(list) ? list.filter(Boolean) : [];
    const customerById = new Map(customerList.map((customer) => [String(customer?.id || "").trim(), customer]));
    const customerNameEntries = customerList.flatMap((customer) => (
      collectCustomerLookupNames(customer).map((name) => [name, customer])
    ));
    for (const d of docs) {
      const docCustomerId = String(d?.customerId || d?.customer?.id || "").trim();
      const matchedCustomer = (docCustomerId ? customerById.get(docCustomerId) : null)
        || collectDocCustomerLookupNames(d).reduce((found, name) => (
          found || customerNameEntries.find(([customerName]) => customerName === name)?.[1] || null
        ), null);
      const cid = String(matchedCustomer?.id || "").trim();
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
          openInvoiceCount: 0,
          overdueInvoiceCount: 0,
          balanceDue: 0,
          amountPaid: 0,
          lastDate: "",
        };
      }
      const fallbackRevenue = toNum(d?.total || d?.invoiceTotal || d?.approvedTotal || d?.estimateTotal);
      byId[cid].revenue += toNum(b.revenue) > 0 ? toNum(b.revenue) : fallbackRevenue;
      byId[cid].internal += toNum(b.internal);
      byId[cid].profit += toNum(b.profit);
      if (isInvoice) {
        const balanceRemaining = Math.max(
          0,
          toNum(
            d?.balanceRemaining != null
              ? d.balanceRemaining
              : (toNum(d?.invoiceTotal || d?.total) - toNum(d?.amountPaid))
          )
        );
        const paidAmount = Math.max(0, toNum(d?.amountPaid));
        byId[cid].invoiceCount += 1;
        byId[cid].balanceDue += balanceRemaining;
        byId[cid].amountPaid += paidAmount;
        if (balanceRemaining > 0) byId[cid].openInvoiceCount += 1;
        if (deriveInvoiceStatus(d) === INVOICE_STATUSES.OVERDUE) byId[cid].overdueInvoiceCount += 1;
      } else {
        byId[cid].estimateCount += 1;
      }

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
  }, [customers, localCustomers, q, mode, refreshSeq]);

  const customerProjectMeta = useMemo(() => {
    const allProjects = readStoredProjects();
    let allEstimates = [];
    let allInvoices = [];
    try {
      const eRaw = localStorage.getItem(ESTIMATES_KEY);
      allEstimates = eRaw ? safeParse(eRaw, []) : [];
      if (!Array.isArray(allEstimates)) allEstimates = [];
      allEstimates = allEstimates.filter((record) => String(record?.docType || "estimate").toLowerCase() !== "invoice");
    } catch {}
    try {
      allInvoices = readStoredInvoices();
    } catch {}
    const byId = {};
    for (const customer of list || []) {
      const cid = String(customer?.id || "");
      if (!cid) continue;
      const linkedProjects = findLinkedProjectsForCustomer(customer, allProjects, list, allEstimates, allInvoices);
      if (!linkedProjects.length) continue;
      if (!byId[cid]) {
        byId[cid] = {
          projectCount: 0,
          activeProjectCount: 0,
          estimatingProjectCount: 0,
          latestProjectName: "",
          latestProjectDisplayStatus: null,
          _archName: "",
          _archStatus: null,
        };
      }
      byId[cid].projectCount = linkedProjects.length;
      for (const p of linkedProjects) {
        const pName = String(p?.projectName || "").trim();
        if (!pName) continue;
        const view = buildNormalizedProjectView({ project: p, projects: allProjects, estimates: allEstimates, invoices: allInvoices });
        const ds = deriveProjectDisplayStatus(view);
        if (ds.key === "active") byId[cid].activeProjectCount += 1;
        if (ds.key === "estimating") byId[cid].estimatingProjectCount += 1;
        if (ds.key === "archived") {
          if (!byId[cid]._archName) { byId[cid]._archName = pName; byId[cid]._archStatus = ds; }
        } else {
          if (!byId[cid].latestProjectName) { byId[cid].latestProjectName = pName; byId[cid].latestProjectDisplayStatus = ds; }
        }
      }
    }
    // Fall back to archived context if customer has only archived projects
    for (const cid of Object.keys(byId)) {
      const entry = byId[cid];
      if (!entry.latestProjectName && entry._archName) {
        entry.latestProjectName = entry._archName;
        entry.latestProjectDisplayStatus = entry._archStatus;
      }
      delete entry._archName;
      delete entry._archStatus;
    }
    return byId;
  }, [mode, list, refreshSeq]);

  // Archived customers stay in localStorage (and in `list` for KPI/history), but
  // are hidden from the active list and dropdown unless "Show archived" is on.
  const archivedCount = useMemo(
    () => (Array.isArray(list) ? list.filter((c) => c?.archived).length : 0),
    [list],
  );
  const visibleList = useMemo(() => {
    const arr = Array.isArray(list) ? list : [];
    return showArchived ? arr : arr.filter((c) => !c?.archived);
  }, [list, showArchived]);

  const filtered = useMemo(() => {
  const qq = norm(q);
  const arr = visibleList || [];
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
}, [visibleList, q]);

  const customerPortfolioSummary = useMemo(() => {
    const visible = filtered || [];
    const totalCustomers = visible.length;
    const activeAccounts = visible.filter((customer) => {
      const cid = String(customer?.id || "");
      return toNum(customerProjectMeta?.[cid]?.activeProjectCount || 0) > 0;
    }).length;
    const balanceDue = visible.reduce((sum, customer) => {
      const cid = String(customer?.id || "");
      return sum + toNum(customerKpis?.[cid]?.balanceDue || 0);
    }, 0);
    const linkedProjects = visible.reduce((sum, customer) => {
      const cid = String(customer?.id || "");
      return sum + toNum(customerProjectMeta?.[cid]?.projectCount || 0);
    }, 0);
    const openDocs = visible.reduce((sum, customer) => {
      const cid = String(customer?.id || "");
      return sum + toNum(customerKpis?.[cid]?.estimateCount || 0) + toNum(customerKpis?.[cid]?.openInvoiceCount || 0);
    }, 0);
    const overdueAccounts = visible.filter((customer) => {
      const cid = String(customer?.id || "");
      return toNum(customerKpis?.[cid]?.overdueInvoiceCount || 0) > 0;
    }).length;
    const topAttentionCustomer = visible
      .slice()
      .sort((left, right) => {
        const leftId = String(left?.id || "");
        const rightId = String(right?.id || "");
        return toNum(customerKpis?.[rightId]?.balanceDue || 0) - toNum(customerKpis?.[leftId]?.balanceDue || 0);
      })[0] || null;
    return {
      totalCustomers,
      activeAccounts,
      balanceDue,
      linkedProjects,
      openDocs,
      overdueAccounts,
      topAttentionCustomer,
    };
  }, [filtered, customerProjectMeta, customerKpis]);

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
    setBuilderReturnIntent("estimate");
    setDraft(emptyDraft(type));
    setMissingRequired({});
    setMode("edit");
  }

  function startEdit(c, opts = {}) {
    const useEstimatorReturn = !!opts?.returnToEstimator;
    const useAutoOnSave = !!opts?.autoUseOnSave;
    setReturnToEstimator(useEstimatorReturn);
    setAutoUseOnSave(useAutoOnSave);
    setBuilderReturnIntent(useEstimatorReturn ? normalizeBuilderIntent(opts?.builderIntent) : "estimate");
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
    try {
      window.dispatchEvent(new CustomEvent("estipaid:navigate-estimator", {
        detail: { builderIntent: builderReturnIntent },
      }));
    } catch {}
  }

  async function saveDraft() {
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
    const mutationAccess = await ensureCanMutateBusinessData("local_save");
    if (!mutationAccess?.ok) {
      window.alert(mutationAccess?.userMessage || "Save stopped because EstiPaid was switched to another device.");
      return;
    }
    persistCustomers(next);

    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);

    setMode("list");
    setToastMessage(label("Customer saved", "Cliente guardado"));
    setShowToast(true);

    if (autoUseOnSave && typeof onDone === "function") {
      try {
        const payloadCustomer = { ...nextItem, ...toEstimatorFlat(nextItem) };
        localStorage.setItem(PENDING_CUSTOMER_USE_KEY, JSON.stringify({
          id,
          customer: payloadCustomer,
          ts: Date.now(),
          builderIntent: builderReturnIntent,
        }));
        window.dispatchEvent(new Event("estipaid:customer-use"));
      } catch {}
      try { onDone({ id, customer: nextItem, builderIntent: builderReturnIntent }); } catch {}
      setAutoUseOnSave(false);
    }
  }

  // Hard delete is allowed ONLY for customers with no linked business history.
  // If history exists, we never remove the record -- we archive it instead so
  // estimates/invoices/projects/payments stay connected to past work.
  async function del(id) {
    const sid = String(id || "");
    const target = (Array.isArray(list) ? list : []).find((c) => String(c?.id || "") === sid);
    if (!target) return;
    const nm = displayName(target);

    // Safety: re-check history at action time. If the customer has any linked
    // records, redirect to the archive flow rather than hard deleting.
    const history = getCustomerBusinessHistory(target, Array.isArray(list) ? list : []);
    if (history.hasHistory) {
      await archiveCustomer(id);
      return;
    }

    const ok = window.confirm(label(
      `Delete Customer?\n\nThis customer has no estimates, invoices, projects, or payments attached.\n\nDeleting removes ${nm} from your customer list.`,
      `¿Eliminar cliente?\n\nEste cliente no tiene estimados, facturas, proyectos ni pagos asociados.\n\nEliminar quita a ${nm} de tu lista de clientes.`,
    ));
    if (!ok) return;
    const mutationAccess = await ensureCanMutateBusinessData("local_save");
    if (!mutationAccess?.ok) {
      window.alert(mutationAccess?.userMessage || "Save stopped because EstiPaid was switched to another device.");
      return;
    }
    const next = (Array.isArray(list) ? list : []).filter((c) => String(c?.id || "") !== sid);
    persistCustomers(next);
    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);
    if (String(selectedCustomerId || "") === sid && typeof setSelectedCustomerId === "function") setSelectedCustomerId("");
    window.dispatchEvent(new Event("estipaid:customers-changed"));
  }

  // Archive a customer with business history. The record stays in localStorage
  // with the same id and all fields; only archived/archivedAt are added.
  // Estimates, invoices, projects, and payments are never touched.
  async function archiveCustomer(id) {
    const sid = String(id || "");
    const target = (Array.isArray(list) ? list : []).find((c) => String(c?.id || "") === sid);
    if (!target) return;
    const nm = displayName(target);

    const ok = window.confirm(label(
      "This Customer Has Business History\n\nThis customer is connected to estimates, invoices, projects, or payments.\n\nTo protect your records, EstiPaid will archive this customer instead of deleting it.\n\nArchived customers are hidden from the active customer list but remain connected to past work.",
      "Este cliente tiene historial comercial\n\nEste cliente está conectado a estimados, facturas, proyectos o pagos.\n\nPara proteger tus registros, EstiPaid archivará este cliente en lugar de eliminarlo.\n\nLos clientes archivados se ocultan de la lista activa pero permanecen conectados al trabajo anterior.",
    ));
    if (!ok) return;
    const mutationAccess = await ensureCanMutateBusinessData("local_save");
    if (!mutationAccess?.ok) {
      window.alert(mutationAccess?.userMessage || "Save stopped because EstiPaid was switched to another device.");
      return;
    }
    const next = (Array.isArray(list) ? list : []).map((c) => (
      String(c?.id || "") === sid
        ? { ...c, archived: true, archivedAt: new Date().toISOString() }
        : c
    ));
    persistCustomers(next);
    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);
    if (String(selectedCustomerId || "") === sid && typeof setSelectedCustomerId === "function") setSelectedCustomerId("");
    window.dispatchEvent(new Event("estipaid:customers-changed"));
    setToastMessage(label(`${nm} archived`, `${nm} archivado`));
    setShowToast(true);
  }

  // Restore an archived customer back into the active list. Clears the
  // archived/archivedAt flags; all other fields and linked records stay intact.
  async function restoreCustomer(id) {
    const sid = String(id || "");
    const target = (Array.isArray(list) ? list : []).find((c) => String(c?.id || "") === sid);
    if (!target) return;
    const nm = displayName(target);

    const mutationAccess = await ensureCanMutateBusinessData("local_save");
    if (!mutationAccess?.ok) {
      window.alert(mutationAccess?.userMessage || "Save stopped because EstiPaid was switched to another device.");
      return;
    }
    const next = (Array.isArray(list) ? list : []).map((c) => {
      if (String(c?.id || "") !== sid) return c;
      const clone = { ...c };
      delete clone.archived;
      delete clone.archivedAt;
      return clone;
    });
    persistCustomers(next);
    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);
    window.dispatchEvent(new Event("estipaid:customers-changed"));
    setToastMessage(label(`${nm} restored`, `${nm} restaurado`));
    setShowToast(true);
  }

  async function useCustomer(c) {
    const id = String(c?.id || "");
    const next = (Array.isArray(list) ? [...list] : []).map((x) => (String(x?.id) === id ? { ...x, lastUsed: Date.now() } : x));
    const mutationAccess = await ensureCanMutateBusinessData("local_save");
    if (!mutationAccess?.ok) {
      window.alert(mutationAccess?.userMessage || "Save stopped because EstiPaid was switched to another device.");
      return;
    }
    persistCustomers(next);
    if (typeof setCustomers === "function") setCustomers(next);
    else setLocalCustomers(next);

    if (typeof setSelectedCustomerId === "function") setSelectedCustomerId(id);

    // Handoff to EstimateForm (same-tab; storage event won't fire)
    try {
      const payload = { id, customer: { ...c, ...toEstimatorFlat(c) }, ts: Date.now(), builderIntent: builderReturnIntent };
      localStorage.setItem(PENDING_CUSTOMER_USE_KEY, JSON.stringify(payload));
      window.dispatchEvent(new Event("estipaid:customer-use"));
    } catch {}

    if (typeof onDone === "function") onDone({ id, customer: c, builderIntent: builderReturnIntent });
  }

  // Dropdown selection: keep the user on the Customers list, narrow the search
  // to the chosen customer, then scroll to and briefly highlight the matching
  // lower card. This intentionally does NOT call useCustomer() -- the dropdown
  // is a find-and-view aid, not a "use customer" shortcut.
  function selectTypeaheadCustomer(c) {
    const cid = String(c?.id || "");
    if (!cid) return;
    setQ(displayName(c));
    setTypeaheadHidden(true);
    setHighlightCustomerId(cid);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightCustomerId(""), 2000);
  }

  useEffect(() => {
    if (!highlightCustomerId) return;
    const node = cardRefs.current?.[highlightCustomerId];
    if (node && typeof node.scrollIntoView === "function") {
      try {
        node.scrollIntoView({ behavior: "smooth", block: "center" });
      } catch {
        try { node.scrollIntoView(); } catch {}
      }
    }
  }, [highlightCustomerId]);

  useEffect(() => () => {
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
  }, []);

  const typeaheadQuery = String(q || "").trim();
  const typeaheadMatches = typeaheadQuery ? (filtered || []).slice(0, 5) : [];
  const showTypeahead = mode === "list" && !!typeaheadQuery && !typeaheadHidden;

  // Close the typeahead dropdown when the user clicks/taps outside the search
  // input + dropdown wrapper. Only attached while the dropdown is open. This
  // does not clear the search text or the lower filtered list.
  useEffect(() => {
    if (!showTypeahead) return undefined;
    const handlePointerDown = (event) => {
      const wrap = typeaheadWrapRef.current;
      if (wrap && !wrap.contains(event.target)) {
        setTypeaheadHidden(true);
      }
    };
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [showTypeahead]);

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
            <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={{ ...cardBaseStyle, display: "grid", gap: 10, position: "relative", zIndex: showTypeahead ? 5 : "auto" }}>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <div ref={typeaheadWrapRef} style={{ position: "relative", flex: "1 1 280px", minWidth: 0 }}>
                  <input
                    className="pe-input"
                    placeholder={label("Search name, phone, email, PO, address…", "Buscar nombre, teléfono, correo, PO, dirección…")}
                    value={q}
                    onChange={(e) => { setQ(e.target.value); setTypeaheadHidden(false); setHighlightCustomerId(""); }}
                    onKeyDown={(e) => { if (e.key === "Escape") setTypeaheadHidden(true); }}
                    style={{ width: "100%" }}
                    role="combobox"
                    aria-expanded={showTypeahead}
                    aria-controls="customer-typeahead-list"
                    aria-autocomplete="list"
                  />
                  {showTypeahead ? (
                    <div
                      id="customer-typeahead-list"
                      role="listbox"
                      aria-label={label("Matching customers", "Clientes coincidentes")}
                      style={{
                        position: "absolute",
                        top: "calc(100% + 6px)",
                        left: 0,
                        right: 0,
                        zIndex: 20,
                        maxHeight: 300,
                        overflowY: "auto",
                        display: "grid",
                        gap: 3,
                        padding: 6,
                        borderRadius: 14,
                        border: "1px solid rgba(168,184,195,0.18)",
                        background: "linear-gradient(180deg, rgb(21,29,39), rgb(9,13,19))",
                        boxShadow: "0 24px 54px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.05)",
                      }}
                    >
                      {typeaheadMatches.map((c) => {
                        const cid = String(c?.id || "");
                        const typeText = String(c?.type || "residential") === "commercial"
                          ? label("Commercial", "Comercial")
                          : label("Residential", "Residencial");
                        const contact = phoneEmailLine(c);
                        return (
                          <button
                            key={`typeahead-${cid}`}
                            type="button"
                            role="option"
                            aria-selected="false"
                            onClick={() => selectTypeaheadCustomer(c)}
                            style={{
                              display: "grid",
                              gap: 2,
                              width: "100%",
                              textAlign: "left",
                              padding: "9px 11px",
                              borderRadius: 10,
                              border: "1px solid rgba(255,255,255,0.06)",
                              background: "rgba(255,255,255,0.02)",
                              color: "rgba(239,245,249,0.95)",
                              cursor: "pointer",
                            }}
                          >
                            <span style={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.2 }}>{displayName(c)}</span>
                            {contact ? (
                              <span style={{ fontSize: 11.5, color: "rgba(208,219,228,0.62)", lineHeight: 1.3 }}>{contact}</span>
                            ) : null}
                            <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(148,163,184,0.7)" }}>{typeText}</span>
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => startNew()}
                        style={{
                          display: "grid",
                          gap: 2,
                          width: "100%",
                          textAlign: "left",
                          padding: "9px 11px",
                          borderRadius: 10,
                          border: "1px solid rgba(59,130,246,0.28)",
                          background: "rgba(59,130,246,0.1)",
                          color: "rgba(219,234,254,0.98)",
                          cursor: "pointer",
                        }}
                      >
                        <span style={{ fontWeight: 800, fontSize: 13.5, lineHeight: 1.2 }}>+ {label("Add Customer", "Agregar cliente")}</span>
                        <span style={{ fontSize: 11.5, color: "rgba(191,219,254,0.72)", lineHeight: 1.3 }}>{label("Add a new customer from this search", "Agregar un nuevo cliente desde esta búsqueda")}</span>
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "rgba(215,225,233,0.72)", cursor: "pointer", justifySelf: "start" }}>
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                  style={{ width: 15, height: 15, cursor: "pointer" }}
                />
                {label("Show archived", "Mostrar archivados")}
                {archivedCount > 0 ? (
                  <span style={{ opacity: 0.6, fontWeight: 800 }}>({archivedCount})</span>
                ) : null}
              </label>
            </div>

            <div
              className="pe-card pe-card-content"
              style={{
                ...cardBaseStyle,
                display: "grid",
                gap: 12,
                borderRadius: 18,
                border: "1px solid rgba(168,184,195,0.14)",
                background: customerPortfolioSummary.overdueAccounts > 0
                  ? "linear-gradient(135deg, rgba(239,68,68,0.08), rgba(59,130,246,0.07) 48%, rgba(34,197,94,0.05)), linear-gradient(180deg, rgba(24,34,44,0.4), rgba(7,10,15,0.94))"
                  : "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(34,197,94,0.08) 48%, rgba(245,158,11,0.06)), linear-gradient(180deg, rgba(24,34,44,0.4), rgba(7,10,15,0.94))",
                boxShadow: "0 24px 54px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.05)",
              }}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(180,196,208,0.56)" }}>
                  {label("Client account book", "Libro de cuentas de clientes")}
                </div>
                <div style={{ fontSize: 24, fontWeight: 950, letterSpacing: "-0.03em", color: "rgba(239,245,249,0.98)", lineHeight: 1.05 }}>
                  {label("Account Priority", "Clientes priorizados por atención de cuenta")}
                </div>
                <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "rgba(215,225,233,0.74)", maxWidth: 760 }}>
                  {customerPortfolioSummary.topAttentionCustomer
                    ? `${displayName(customerPortfolioSummary.topAttentionCustomer)} ${label("currently carries the highest visible balance due.", "actualmente tiene el mayor saldo visible pendiente.")}`
                    : label("Use this view to scan account activity, project context, and next account action quickly.", "Usa esta vista para revisar actividad de cuentas, contexto de proyectos y la siguiente acción rápidamente.")}
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
                {[
                  {
                    key: "total-customers",
                    labelText: label("Visible customers", "Clientes visibles"),
                    value: String(customerPortfolioSummary.totalCustomers),
                    detail: `${customerPortfolioSummary.activeAccounts} ${label("active accounts", "cuentas activas")}`,
                    color: "rgba(96,165,250,0.86)",
                    border: "rgba(59,130,246,0.2)",
                  },
                  {
                    key: "balance-due",
                    labelText: label("Open balance due", "Saldo pendiente"),
                    value: moneyUSD(customerPortfolioSummary.balanceDue),
                    detail: customerPortfolioSummary.overdueAccounts > 0
                      ? `${customerPortfolioSummary.overdueAccounts} ${label("accounts overdue", "cuentas vencidas")}`
                      : label("No overdue accounts in view", "No hay cuentas vencidas en vista"),
                    color: customerPortfolioSummary.balanceDue > 0 ? "rgba(251,191,36,0.9)" : "rgba(203,213,225,0.78)",
                    border: customerPortfolioSummary.balanceDue > 0 ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.1)",
                  },
                  {
                    key: "projects",
                    labelText: label("Linked projects", "Proyectos vinculados"),
                    value: String(customerPortfolioSummary.linkedProjects),
                    detail: label("Across visible customer accounts", "En cuentas visibles de clientes"),
                    color: "rgba(74,222,128,0.86)",
                    border: "rgba(34,197,94,0.2)",
                  },
                  {
                    key: "open-docs",
                    labelText: label("Open document activity", "Actividad de documentos"),
                    value: String(customerPortfolioSummary.openDocs),
                    detail: label("Estimates + unpaid invoices", "Estimados + facturas no pagadas"),
                    color: "rgba(191,219,254,0.84)",
                    border: "rgba(148,163,184,0.18)",
                  },
                ].map((item) => (
                  <div key={item.key} style={{ minWidth: 0, display: "grid", gap: 6, padding: "12px 12px 11px", borderRadius: 14, border: `1px solid ${item.border}`, background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)), rgba(7,11,16,0.22)" }}>
                    <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: item.color }}>
                      {item.labelText}
                    </div>
                    <div style={{ fontSize: 24, fontWeight: 950, letterSpacing: "-0.03em", color: "rgba(239,245,249,0.98)", lineHeight: 1 }}>
                      {item.value}
                    </div>
                    <div style={{ fontSize: 11.5, lineHeight: 1.4, color: "rgba(208,219,228,0.66)" }}>
                      {item.detail}
                    </div>
                  </div>
                ))}
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
                <div style={{ fontWeight: 800, marginBottom: 6 }}>No customers yet</div>
                <div style={{ fontSize: 13, color: "rgba(230,241,248,0.52)", lineHeight: 1.45, marginBottom: 6 }}>Add your first customer so estimates, invoices, and projects have a billing contact.</div>
                <button className="pe-btn" type="button" onClick={() => startNew()}>
                  {label("Add Customer", "Agregar cliente")}
                </button>
              </div>
            ) : String(q || "").trim() && filtered.length === 0 ? (
              <div className="pe-card pe-card-content ep-glass-tile ep-tile-hover" style={{ ...cardBaseStyle, textAlign: "center", padding: 18 }}>
                <div style={{ fontWeight: 800, marginBottom: 6 }}>
                  {label("No matching customers", "No hay clientes que coincidan")}
                </div>
                <div style={{ fontSize: 13, color: "rgba(230,241,248,0.52)", lineHeight: 1.45 }}>
                  {label("Try a different name, phone number, email, or project.", "Prueba con otro nombre, teléfono, correo o proyecto.")}
                </div>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(min(340px, 100%), 1fr))" }}>
              {filtered.map((c) => {
                const id = String(c?.id || "");
                const active = String(selectedCustomerId || "") && String(selectedCustomerId) === id;
                const highlighted = String(highlightCustomerId || "") && String(highlightCustomerId) === id;
                const kpi = customerKpis?.[id] || {};
                const meta = customerProjectMeta?.[id] || {};
                const isArchived = !!c?.archived;
                const hasHistory = toNum(kpi.estimateCount || 0) > 0
                  || toNum(kpi.invoiceCount || 0) > 0
                  || toNum(meta.projectCount || 0) > 0;
                const accountAction = deriveCustomerNextAction({
                  overdueInvoiceCount: toNum(kpi.overdueInvoiceCount || 0),
                  balanceDue: toNum(kpi.balanceDue || 0),
                  activeProjectCount: toNum(meta.activeProjectCount || 0),
                  openDocumentCount: toNum(kpi.estimateCount || 0) + toNum(kpi.openInvoiceCount || 0),
                });
                const actionTone = accountAction.tone === "danger"
                  ? { color: "rgba(248,113,113,0.9)", border: "rgba(239,68,68,0.22)", background: "rgba(239,68,68,0.08)" }
                  : accountAction.tone === "warning"
                    ? { color: "rgba(251,191,36,0.9)", border: "rgba(245,158,11,0.22)", background: "rgba(245,158,11,0.08)" }
                    : accountAction.tone === "success"
                      ? { color: "rgba(74,222,128,0.88)", border: "rgba(34,197,94,0.22)", background: "rgba(34,197,94,0.08)" }
                      : { color: "rgba(96,165,250,0.9)", border: "rgba(59,130,246,0.22)", background: "rgba(59,130,246,0.08)" };
                const actionLabel = accountAction.key === "resolve-overdue"
                  ? label("Resolve Overdue", "Siguiente acción: resolver vencidos")
                  : accountAction.key === "collect-balance"
                    ? label("Collect Balance", "Siguiente acción: cobrar saldo")
                    : accountAction.key === "review-active-work"
                      ? label("Active Work", "Siguiente acción: revisar trabajo activo")
                      : accountAction.key === "review-open-docs"
                        ? label("Open Docs", "Siguiente acción: revisar documentos abiertos")
                        : label("Update Account", "Siguiente acción: actualizar cuenta");

                return (
                  <div
                    className="pe-card pe-card-content ep-glass-tile"
                    key={id || Math.random()}
                    ref={(node) => {
                      if (node) cardRefs.current[id] = node;
                      else delete cardRefs.current[id];
                    }}
                    data-customer-card-id={id}
                    data-customer-card-highlighted={highlighted ? "true" : undefined}
                    style={{
                      ...cardBaseStyle,
                      ...(active ? cardActiveStyle : null),
                      display: "grid",
                      gap: 12,
                      cursor: "pointer",
                      borderRadius: 16,
                      border: active
                        ? cardActiveStyle.border
                        : toNum(kpi.overdueInvoiceCount || 0) > 0
                          ? "1px solid rgba(239,68,68,0.16)"
                          : toNum(kpi.balanceDue || 0) > 0
                            ? "1px solid rgba(245,158,11,0.16)"
                            : "1px solid rgba(255,255,255,0.08)",
                      background: toNum(kpi.overdueInvoiceCount || 0) > 0
                        ? "linear-gradient(180deg, rgba(239,68,68,0.06), rgba(255,255,255,0.03))"
                        : toNum(kpi.balanceDue || 0) > 0
                          ? "linear-gradient(180deg, rgba(245,158,11,0.06), rgba(255,255,255,0.03))"
                          : "linear-gradient(180deg, rgba(59,130,246,0.05), rgba(255,255,255,0.03))",
                      boxShadow: "0 14px 30px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.03)",
                      transition: "box-shadow 220ms ease, border-color 220ms ease",
                      ...(highlighted ? {
                        border: "1px solid rgba(74,222,128,0.85)",
                        background: "linear-gradient(180deg, rgba(34,197,94,0.12), rgba(255,255,255,0.03))",
                        boxShadow: "0 0 0 3px rgba(74,222,128,0.35), 0 18px 40px rgba(0,0,0,0.3)",
                      } : null),
                    }}
                  >
                    <div style={{ display: "flex", gap: 12, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
                      <div style={{ display: "grid", gap: 6, minWidth: 0, flex: "1 1 200px" }}>
                        <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                          <div style={{ fontWeight: 900, fontSize: 17, letterSpacing: "-0.01em", lineHeight: 1.15 }}>{displayName(c)}</div>
                          <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.75 }}>
                            {String(c?.type || "residential") === "commercial" ? label("Commercial", "Comercial") : label("Residential", "Residencial")}
                          </div>
                          {active ? <div style={{ fontSize: 12, fontWeight: 700, opacity: 0.85 }}>{label("Selected", "Seleccionado")}</div> : null}
                          {isArchived ? (
                            <span
                              data-customer-archived-badge={id}
                              style={{ padding: "3px 9px", borderRadius: 999, border: "1px solid rgba(148,163,184,0.35)", background: "rgba(148,163,184,0.14)", color: "rgba(203,213,225,0.85)", fontSize: 10.5, fontWeight: 900, letterSpacing: "0.1em", textTransform: "uppercase" }}
                            >
                              {label("Archived", "Archivado")}
                            </span>
                          ) : null}
                        </div>

                        {contactLine(c) ? <TextLine>{contactLine(c)}</TextLine> : null}
                        {phoneEmailLine(c) ? <TextLine>{phoneEmailLine(c)}</TextLine> : null}
                        {mainAddressText(c) ? <TextLine>{mainAddressText(c)}</TextLine> : null}
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 2 }}>
                          <span style={{ padding: "4px 8px", borderRadius: 999, border: `1px solid ${actionTone.border}`, background: actionTone.background, color: actionTone.color, fontSize: 10.5, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                            {actionLabel}
                          </span>
                          {toNum(kpi.amountPaid || 0) > 0 ? (
                            <span style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid rgba(34,197,94,0.2)", background: "rgba(34,197,94,0.08)", color: "rgba(74,222,128,0.88)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase" }}>
                              {moneyUSD(kpi.amountPaid)} {label("paid", "pagado")}
                            </span>
                          ) : null}
                        </div>

                        {(toNum(kpi.overdueInvoiceCount || 0) > 0 || toNum(kpi.balanceDue || 0) > 0 || toNum(meta.activeProjectCount || 0) > 0) ? (
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 2 }}>
                            {toNum(kpi.overdueInvoiceCount || 0) > 0 ? (
                              <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.22)", color: "rgba(239,68,68,0.88)", fontSize: 10.5, fontWeight: 700 }}>
                                {toNum(kpi.overdueInvoiceCount || 0) === 1 ? label("1 overdue", "1 vencida") : `${toNum(kpi.overdueInvoiceCount || 0)} ${label("overdue", "vencidas")}`}
                              </span>
                            ) : null}
                            {toNum(kpi.balanceDue || 0) > 0 ? (
                              <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "rgba(245,158,11,0.84)", fontSize: 10.5, fontWeight: 700 }}>
                                {moneyUSD(kpi.balanceDue)} {label("due", "pendiente")}
                              </span>
                            ) : null}
                            {toNum(meta.activeProjectCount || 0) > 0 ? (
                              <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(72,187,120,0.08)", border: "1px solid rgba(72,187,120,0.2)", color: "rgba(72,187,120,0.82)", fontSize: 10.5, fontWeight: 700 }}>
                                {toNum(meta.activeProjectCount || 0)} {toNum(meta.activeProjectCount || 0) === 1 ? label("active project", "proyecto activo") : label("active projects", "proyectos activos")}
                              </span>
                            ) : null}
                          </div>
                        ) : null}

                        {/* Project context */}
                        {id && customerProjectMeta[id]?.projectCount > 0 ? (
                          <div style={{ marginTop: 6, paddingTop: 8, borderTop: "1px solid rgba(255,255,255,0.07)", display: "grid", gap: 4 }}>
                            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                              <span style={{ fontSize: 11, fontWeight: 800, opacity: 0.48, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                                {customerProjectMeta[id].projectCount === 1
                                  ? label("1 project", "1 proyecto")
                                  : `${customerProjectMeta[id].projectCount} ${label("projects", "proyectos")}`}
                              </span>
                              {customerProjectMeta[id].latestProjectDisplayStatus ? (
                                <span style={{
                                  display: "inline-block",
                                  padding: "2px 7px",
                                  borderRadius: 999,
                                  fontSize: 10,
                                  fontWeight: 800,
                                  letterSpacing: "0.04em",
                                  textTransform: "uppercase",
                                  color: CUST_PROJECT_STATUS_COLORS[customerProjectMeta[id].latestProjectDisplayStatus.key]?.color || "rgba(230,241,248,0.5)",
                                  background: "rgba(255,255,255,0.05)",
                                  border: `1px solid ${CUST_PROJECT_STATUS_COLORS[customerProjectMeta[id].latestProjectDisplayStatus.key]?.color || "rgba(230,241,248,0.12)"}`,
                                  borderColor: (CUST_PROJECT_STATUS_COLORS[customerProjectMeta[id].latestProjectDisplayStatus.key]?.color || "rgba(230,241,248,0.12)").replace(/[\d.]+\)$/, "0.28)"),
                                }}>
                                  {customerProjectMeta[id].latestProjectDisplayStatus.label}
                                </span>
                              ) : null}
                            </div>
                            {customerProjectMeta[id].latestProjectName ? (
                              <div style={{ fontSize: 13, fontWeight: 700, opacity: 0.88, lineHeight: 1.25 }}>
                                {customerProjectMeta[id].latestProjectName}
                              </div>
                            ) : null}
                          </div>
                        ) : null}

                        {/* KPIs (live computed from saved estimates/invoices) */}
                        {customerKpis && id && customerKpis[id] ? (
                          <div
                            className="pe-customer-kpi-grid"
                            style={{
                              marginTop: 6,
                              paddingTop: 10,
                              borderTop: "1px solid rgba(255,255,255,0.10)",
                              display: "grid",
                              gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))",
                              gap: 10,
                            }}
                          >
                            <div style={{ display: "grid", gap: 3, padding: "9px 10px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)" }}>
                              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                {label("Revenue", "Ingresos")}
                              </div>
                              <div className="pe-customer-kpi-value" style={{ fontSize: 14, fontWeight: 800, opacity: 0.9, fontVariantNumeric: "tabular-nums" }}>
                                {moneyUSD(customerKpis[id]?.revenue || 0)}
                              </div>
                            </div>
                            <div style={{ display: "grid", gap: 3, padding: "9px 10px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)" }}>
                              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                {label("Balance", "Saldo")}
                              </div>
                              <div className="pe-customer-kpi-value" style={{ fontSize: 14, fontWeight: 800, opacity: 0.9, fontVariantNumeric: "tabular-nums" }}>
                                {moneyUSD(customerKpis[id]?.balanceDue || 0)}
                              </div>
                            </div>
                            <div style={{ display: "grid", gap: 3, padding: "9px 10px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)" }}>
                              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                {label("Margin", "Margen")}
                              </div>
                              <div className="pe-customer-kpi-value" style={{ fontSize: 14, fontWeight: 800, opacity: 0.9 }}>
                                {Math.round(toNum(customerKpis[id]?.margin || 0) * 100)}%
                              </div>
                            </div>
                            <div style={{ display: "grid", gap: 3, padding: "9px 10px", borderRadius: 12, border: "1px solid rgba(255,255,255,0.06)", background: "rgba(255,255,255,0.025)" }}>
                              <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, letterSpacing: 0.4, textTransform: "uppercase" }}>
                                {label("Docs", "Docs")}
                              </div>
                              <div style={{ fontSize: 13, fontWeight: 800, opacity: 0.88, display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {toNum(customerKpis[id]?.estimateCount || 0) > 0 ? (
                                  <span>{toNum(customerKpis[id].estimateCount)} {label("est", "est")}</span>
                                ) : null}
                                {toNum(customerKpis[id]?.invoiceCount || 0) > 0 ? (
                                  <span>{toNum(customerKpis[id].invoiceCount)} {label("inv", "fac")}</span>
                                ) : null}
                                {toNum(customerKpis[id]?.estimateCount || 0) === 0 && toNum(customerKpis[id]?.invoiceCount || 0) === 0 ? (
                                  <span style={{ opacity: 0.5 }}>—</span>
                                ) : null}
                              </div>
                            </div>
                            </div>
                        ) : null}
                      </div>

                        <div style={{ display: "grid", gap: 8, minWidth: 0, justifyItems: "stretch" }}>
                        {isArchived ? (
                          <>
                            <button
                              className="pe-btn"
                              type="button"
                              onClick={() => restoreCustomer(c?.id)}
                              data-customer-restore={id}
                              style={{ width: "100%", background: "rgba(74,222,128,0.14)", border: "1px solid rgba(74,222,128,0.32)", color: "rgba(187,247,208,0.96)" }}
                            >
                              {label("Restore Customer", "Restaurar cliente")}
                            </button>
                            <button className="pe-btn pe-btn-ghost" type="button" onClick={() => startEdit(c)} style={{ width: "100%" }}>
                              {label("Edit", "Editar")}
                            </button>
                          </>
                        ) : (
                          <>
                            <button className="pe-btn" type="button" onClick={() => useCustomer(c)} style={{ width: "100%" }}>
                              {label("Use", "Usar")}
                            </button>
                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                              <button className="pe-btn pe-btn-ghost" type="button" onClick={() => startEdit(c)} style={{ width: "100%" }}>
                                {label("Edit", "Editar")}
                              </button>
                              {hasHistory ? (
                                <button className="pe-btn pe-btn-ghost" type="button" onClick={() => archiveCustomer(c?.id)} data-customer-archive={id} style={{ width: "100%" }}>
                                  {label("Archive Customer", "Archivar cliente")}
                                </button>
                              ) : (
                                <button className="pe-btn pe-btn-ghost" type="button" onClick={() => del(c?.id)} data-customer-delete={id} style={{ width: "100%" }}>
                                  {label("Delete Customer", "Eliminar cliente")}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                        {onOpenProjectDetail ? (
                          <button
                            className="pe-btn"
                            type="button"
                            style={{ width: "100%", background: "rgba(99,179,237,0.12)", border: "1px solid rgba(99,179,237,0.28)", color: "rgba(99,179,237,0.94)" }}
                            onClick={() => {
                              const custId = String(c?.id || "");
                              const allProjects = readStoredProjects();
                              let allEstimates = [];
                              let allInvoices = [];
                              try {
                                const eRaw = localStorage.getItem(ESTIMATES_KEY);
                                allEstimates = eRaw ? safeParse(eRaw, []) : [];
                                if (!Array.isArray(allEstimates)) allEstimates = [];
                                allEstimates = allEstimates.filter((record) => String(record?.docType || "estimate").toLowerCase() !== "invoice");
                              } catch {}
                              try {
                                allInvoices = readStoredInvoices();
                              } catch {}
                              const matched = findLinkedProjectsForCustomer(c, allProjects, list, allEstimates, allInvoices);
                              if (matched.length === 1) {
                                setProjectChooser(null);
                                onOpenProjectDetail(String(matched[0].id || ""));
                              } else if (matched.length > 1) {
                                setProjectChooser({ customerId: custId, projects: matched });
                              } else {
                                setProjectChooser({ customerId: custId, empty: true });
                              }
                            }}
                          >
                            {label("Projects", "Proyectos")}
                          </button>
                        ) : null}
                        {projectChooser && projectChooser.customerId === id && projectChooser.empty ? (
                          <div style={{ fontSize: 12, color: "rgba(230,241,248,0.5)", padding: "4px 0" }}>
                            {label("No linked projects yet.", "Aún no hay proyectos vinculados.")}
                          </div>
                        ) : null}
                        {projectChooser && projectChooser.customerId === id && projectChooser.projects?.length > 1 ? (
                          <div style={{ display: "grid", gap: 4, padding: "6px 0 0" }}>
                            <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                              {label("Choose project", "Elegir proyecto")}
                            </div>
                            {projectChooser.projects.map((proj) => (
                              <button
                                key={String(proj.id)}
                                className="pe-btn pe-btn-ghost"
                                type="button"
                                style={{ width: "100%", textAlign: "left", fontSize: 13, padding: "6px 10px" }}
                                onClick={() => {
                                  setProjectChooser(null);
                                  onOpenProjectDetail(String(proj.id || ""));
                                }}
                              >
                                {String(proj.projectName || proj.siteAddress || proj.projectNumber || proj.id || "Untitled")}
                              </button>
                            ))}
                            <button
                              className="pe-btn pe-btn-ghost"
                              type="button"
                              style={{ width: "100%", fontSize: 11, opacity: 0.5, padding: "4px 10px" }}
                              onClick={() => setProjectChooser(null)}
                            >
                              {label("Cancel", "Cancelar")}
                            </button>
                          </div>
                        ) : null}
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
          <CloudBackupInlineStatus style={{ margin: "-6px 0 8px" }} />

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
