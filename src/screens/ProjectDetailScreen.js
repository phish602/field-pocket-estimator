// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  readStoredProjects,
  buildNormalizedProjectView,
  deriveProjectDisplayStatus,
  deleteStoredProject,
  updateProjectStoredStatus,
} from "../utils/projects";
import { INVOICE_STATUSES, deriveInvoiceStatus, readStoredInvoices } from "../utils/invoices";

const PROJECT_DETAIL_TARGET_KEY = "estipaid-project-detail-target-v1";
const PROJECT_CREATE_SEED_KEY = "estipaid-project-create-seed-v1";

function writeProjectCreateSeed(view) {
  if (!view?.project) return;
  try {
    const customer = view.customer || {};
    const project = view.project || {};
    localStorage.setItem(PROJECT_CREATE_SEED_KEY, JSON.stringify({
      projectId: String(project.id || "").trim(),
      customerId: String(project.customerId || customer.id || "").trim(),
      customerName: String(customer.name || customer.companyName || customer.fullName || "").trim(),
      projectName: String(project.projectName || "").trim(),
      projectNumber: String(project.projectNumber || "").trim(),
      siteAddress: String(project.siteAddress || "").trim(),
    }));
  } catch {}
}

function readEstimates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATES);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((record) => record && String(record?.docType || "estimate").toLowerCase() !== "invoice")
      : [];
  } catch {
    return [];
  }
}

function readCustomers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function money(v) {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return "$0";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function fmtDate(ts) {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
  } catch {
    return "";
  }
}

function statusLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s === "approved") return "Approved";
  if (s === "lost") return "Lost";
  if (s === "sent") return "Sent";
  if (s === "draft") return "Draft";
  if (s === "archived") return "Archived";
  if (s === "active") return "Active";
  return "Pending";
}

// open/actionable first, closed last — tiebreaker is existing date-desc order from buildNormalizedProjectView
function estSortPriority(est) {
  const s = String(est?.status || "").toLowerCase();
  if (s === "sent") return 0;
  if (s === "pending") return 1;
  if (s === "draft") return 2;
  if (s === "approved") return 3;
  if (s === "lost") return 5;
  return 4;
}

function invSortPriority(inv) {
  const status = deriveInvoiceStatus(inv);
  if (status === INVOICE_STATUSES.OVERDUE) return 0;
  if (status === INVOICE_STATUSES.SENT) return 1;
  if (status === INVOICE_STATUSES.DRAFT) return 2;
  if (status === INVOICE_STATUSES.PAID) return 5;
  if (status === INVOICE_STATUSES.VOID) return 6;
  return 3;
}

function invStatusLabel(status) {
  const s = String(status || "").toLowerCase();
  if (s === "overdue") return "Overdue";
  if (s === "sent") return "Sent";
  if (s === "draft") return "Draft";
  if (s === "paid") return "Paid";
  if (s === "void") return "Void";
  return "";
}

const EST_STATUS_ACCENT = {
  sent: "rgba(99,179,237,0.82)",
  pending: "rgba(245,158,11,0.82)",
  approved: "rgba(72,187,120,0.82)",
  draft: "rgba(230,241,248,0.42)",
  lost: "rgba(230,241,248,0.30)",
};

const INV_STATUS_ACCENT = {
  overdue: "rgba(239,68,68,0.88)",
  sent: "rgba(99,179,237,0.78)",
  draft: "rgba(230,241,248,0.42)",
  paid: "rgba(72,187,120,0.78)",
  void: "rgba(230,241,248,0.30)",
};

const PROJECT_STATUS_CONTROLS = [
  { key: "draft", label: "Draft" },
  { key: "estimating", label: "Estimating" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];

function normalizeProjectControlStatus(status) {
  const raw = String(status || "").toLowerCase();
  if (raw === "complete") return "completed";
  if (raw === "closed" || raw === "inactive") return "archived";
  if (raw === "draft" || raw === "estimating" || raw === "active" || raw === "completed" || raw === "archived") return raw;
  return "active";
}

const PROJECT_STATUS_COLORS = {
  draft: { bg: "rgba(230,241,248,0.06)", border: "rgba(230,241,248,0.14)", color: "rgba(230,241,248,0.5)" },
  estimating: { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.22)", color: "rgba(245,158,11,0.84)" },
  active: { bg: "rgba(72,187,120,0.1)", border: "rgba(72,187,120,0.22)", color: "rgba(72,187,120,0.82)" },
  completed: { bg: "rgba(99,179,237,0.1)", border: "rgba(99,179,237,0.22)", color: "rgba(99,179,237,0.84)" },
  archived: { bg: "rgba(230,241,248,0.04)", border: "rgba(230,241,248,0.1)", color: "rgba(230,241,248,0.35)" },
};

const S = {
  screen: {
    padding: "0 0 32px",
    minHeight: "100%",
    color: "rgba(230,241,248,0.92)",
  },
  topBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    padding: "14px 16px 10px",
  },
  backBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "rgba(99,179,237,0.85)",
    fontSize: 14,
    fontWeight: 600,
    padding: "4px 8px",
    borderRadius: 6,
  },
  editBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "rgba(99,179,237,0.85)",
    fontSize: 14,
    fontWeight: 600,
    padding: "4px 8px",
    borderRadius: 6,
  },
  heroCard: {
    margin: "0 16px 16px",
    padding: "20px 18px 18px",
    borderRadius: 18,
    background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.03))",
    border: "1px solid rgba(255,255,255,0.1)",
    display: "grid",
    gap: 14,
    boxShadow: "0 18px 42px rgba(2,6,23,0.18)",
  },
  heroHeader: {
    display: "grid",
    gap: 14,
  },
  heroHeaderTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 16,
    flexWrap: "wrap",
  },
  heroIdentity: {
    display: "grid",
    gap: 8,
    minWidth: 0,
  },
  heroEyebrow: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.12em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.34)",
  },
  heroStatusStack: {
    display: "grid",
    gap: 8,
    justifyItems: "flex-start",
  },
  heroContextRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  heroContextPill: {
    padding: "6px 10px",
    borderRadius: 999,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    fontSize: 11,
    fontWeight: 700,
    color: "rgba(230,241,248,0.6)",
  },
  projectName: {
    fontSize: 28,
    fontWeight: 800,
    lineHeight: 1.25,
    color: "rgba(230,241,248,0.96)",
    overflowWrap: "break-word",
  },
  customerName: {
    fontSize: 15,
    fontWeight: 600,
    color: "rgba(99,179,237,0.82)",
  },
  meta: {
    fontSize: 12,
    color: "rgba(230,241,248,0.45)",
    lineHeight: 1.4,
  },
  statusBadge: {
    display: "inline-flex",
    padding: "5px 10px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    background: "rgba(99,179,237,0.1)",
    border: "1px solid rgba(99,179,237,0.2)",
    color: "rgba(99,179,237,0.72)",
    marginTop: 2,
    alignSelf: "flex-start",
    justifySelf: "flex-start",
    width: "fit-content",
  },
  heroFinancialGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 10,
  },
  heroFinancialCard: {
    padding: "14px 14px 12px",
    borderRadius: 14,
    background: "rgba(9,15,24,0.44)",
    border: "1px solid rgba(255,255,255,0.08)",
    display: "grid",
    gap: 4,
    minWidth: 0,
  },
  heroFinancialLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.4)",
  },
  heroFinancialValue: {
    fontSize: 25,
    lineHeight: 1.1,
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
    color: "rgba(230,241,248,0.96)",
  },
  heroFinancialMeta: {
    fontSize: 11.5,
    color: "rgba(230,241,248,0.46)",
    lineHeight: 1.35,
  },
  heroAttentionCard: {
    display: "grid",
    gap: 5,
    padding: "14px 16px",
    borderRadius: 14,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  heroAttentionLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.4)",
  },
  heroAttentionValue: {
    fontSize: 18,
    lineHeight: 1.2,
    fontWeight: 800,
    color: "rgba(230,241,248,0.96)",
  },
  heroAttentionMeta: {
    fontSize: 12,
    color: "rgba(230,241,248,0.56)",
    lineHeight: 1.4,
  },
  statusControlWrap: {
    display: "grid",
    gap: 8,
    marginTop: 4,
  },
  statusControlLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.38)",
  },
  statusControlRow: {
    display: "grid",
    gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
    gap: 6,
  },
  statusControlChip: {
    padding: "8px 6px",
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 700,
    cursor: "pointer",
    textAlign: "center",
    font: "inherit",
    letterSpacing: "0.02em",
    lineHeight: 1.1,
  },
  sectionWrap: {
    margin: "0 16px 18px",
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.38)",
    marginBottom: 10,
  },
  overviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
    gap: 8,
  },
  overviewCard: {
    padding: "12px 14px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    display: "grid",
    gap: 3,
  },
  overviewLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.38)",
  },
  overviewValue: {
    fontSize: 20,
    fontWeight: 800,
    color: "rgba(230,241,248,0.94)",
    fontVariantNumeric: "tabular-nums",
  },
  docCard: {
    padding: "12px 14px",
    borderRadius: 10,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
    display: "grid",
    gap: 4,
    marginBottom: 8,
  },
  docActionCard: {
    width: "100%",
    textAlign: "left",
    appearance: "none",
    WebkitAppearance: "none",
    cursor: "pointer",
    font: "inherit",
    color: "inherit",
  },
  docTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "rgba(230,241,248,0.9)",
    lineHeight: 1.25,
  },
  docMeta: {
    fontSize: 12,
    color: "rgba(230,241,248,0.48)",
  },
  docAmount: {
    fontSize: 14,
    fontWeight: 700,
    color: "rgba(230,241,248,0.8)",
    fontVariantNumeric: "tabular-nums",
  },
  emptyState: {
    fontSize: 13,
    color: "rgba(230,241,248,0.32)",
    padding: "14px 0",
  },
  actionsRow: {
    display: "flex",
    gap: 10,
    marginTop: 8,
  },
  docFlowShell: {
    padding: "14px",
    borderRadius: 14,
    background: "rgba(255,255,255,0.035)",
    border: "1px solid rgba(255,255,255,0.08)",
    display: "grid",
    gap: 14,
  },
  docFlowSummary: {
    display: "grid",
    gap: 4,
    padding: "0 2px",
  },
  docFlowTitle: {
    fontSize: 14,
    fontWeight: 700,
    color: "rgba(230,241,248,0.9)",
  },
  docFlowMeta: {
    fontSize: 12,
    color: "rgba(230,241,248,0.48)",
    lineHeight: 1.4,
  },
  docFlowGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 14,
    alignItems: "start",
  },
  docFlowColumn: {
    display: "grid",
    gap: 10,
    minWidth: 0,
  },
  docFlowColumnHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
    padding: "0 2px",
  },
  docFlowColumnTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.38)",
  },
  docFlowColumnCount: {
    padding: "4px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    color: "rgba(230,241,248,0.65)",
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  actionBtn: {
    flex: 1,
    padding: "10px 0",
    borderRadius: 10,
    border: "1px solid rgba(99,179,237,0.22)",
    background: "rgba(99,179,237,0.08)",
    color: "rgba(99,179,237,0.92)",
    fontSize: 13,
    fontWeight: 700,
    cursor: "pointer",
    letterSpacing: "0.03em",
    textAlign: "center",
  },
};

export function writeProjectDetailTarget(projectId) {
  try {
    localStorage.setItem(PROJECT_DETAIL_TARGET_KEY, String(projectId || ""));
  } catch {}
}

export function readProjectDetailTarget() {
  try {
    return String(localStorage.getItem(PROJECT_DETAIL_TARGET_KEY) || "").trim();
  } catch {
    return "";
  }
}

export default function ProjectDetailScreen({
  onBack,
  onEditProject,
  onNewEstimate,
  onNewInvoice,
  onOpenEstimate,
  onOpenInvoice,
}) {
  const [projectId] = useState(() => readProjectDetailTarget());
  const [refreshSeq, setRefreshSeq] = useState(0);
  const [deleteConfirmValue, setDeleteConfirmValue] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [isPhone, setIsPhone] = useState(
    typeof window !== "undefined" ? window.innerWidth < 480 : false
  );
  useEffect(() => {
    const onResize = () => setIsPhone(window.innerWidth < 480);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  useEffect(() => {
    const relevantStorageKeys = new Set([
      STORAGE_KEYS.PROJECTS,
      STORAGE_KEYS.CUSTOMERS,
      STORAGE_KEYS.ESTIMATES,
      STORAGE_KEYS.INVOICES,
    ]);
    const refresh = () => setRefreshSeq((value) => value + 1);
    const onStorage = (event) => {
      if (!event) return;
      if (event.key == null || relevantStorageKeys.has(event.key)) {
        refresh();
      }
    };
    const onLocalStorage = (event) => {
      const key = event?.detail?.key;
      if (
        key == null
        || key === STORAGE_KEYS.PROJECTS
        || key === STORAGE_KEYS.CUSTOMERS
        || key === STORAGE_KEYS.ESTIMATES
        || key === STORAGE_KEYS.INVOICES
      ) {
        refresh();
      }
    };
    const onVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        refresh();
      }
    };
    const appEvents = [
      "estipaid:estimates-changed",
      "estipaid:invoices-changed",
    ];
    window.addEventListener("focus", refresh);
    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("estipaid:customer-use", refresh);
    appEvents.forEach((name) => window.addEventListener(name, refresh));
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:customer-use", refresh);
      appEvents.forEach((name) => window.removeEventListener(name, refresh));
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  const view = useMemo(() => {
    if (!projectId) return null;
    const projects = readStoredProjects();
    const customers = readCustomers();
    const estimates = readEstimates();
    const invoices = readStoredInvoices();
    return buildNormalizedProjectView({
      projectId,
      projects,
      customers,
      estimates,
      invoices,
    });
  }, [projectId, refreshSeq]);

  const displayStatus = useMemo(() => deriveProjectDisplayStatus(view || {}), [view]);

  useEffect(() => {
    setDeleteConfirmValue("");
    setDeleteMessage("");
    setDeleteBusy(false);
  }, [projectId]);

  if (!view || !view.project) {
    return (
      <div style={S.screen}>
        <div style={S.topBar}>
          <button type="button" style={S.backBtn} onClick={onBack}>← Back</button>
        </div>
        <div style={{ ...S.sectionWrap, ...S.emptyState }}>Project not found.</div>
      </div>
    );
  }

  const { project, customer, estimates, invoices, latestActivityAt, totals } = view;
  const projectStatusStyle = PROJECT_STATUS_COLORS[displayStatus.key] || PROJECT_STATUS_COLORS.draft;
  const storedProjectStatus = normalizeProjectControlStatus(project.status);

  // Attention signals — derived from existing assembled view data, not mutated
  const overdueCount = invoices.filter((inv) => deriveInvoiceStatus(inv) === INVOICE_STATUSES.OVERDUE).length;
  const approvedEstCount = estimates.filter((est) => String(est?.status || "").toLowerCase() === "approved").length;
  const hasAttentionSignals = overdueCount > 0 || totals.balanceRemaining > 0 || approvedEstCount > 0;
  const documentCount = totals.estimateCount + totals.invoiceCount;
  const hasPaid = totals.amountPaid > 0;
  const hasBalanceDue = totals.balanceRemaining > 0;
  const hasLinkedDocuments = documentCount > 0 || estimates.length > 0 || invoices.length > 0;
  const canHardDelete = !hasLinkedDocuments
    && Number(totals.estimateTotal || 0) === 0
    && Number(totals.invoiceTotal || 0) === 0
    && Number(totals.amountPaid || 0) === 0
    && Number(totals.balanceRemaining || 0) === 0;
  const isArchivedProject = storedProjectStatus === "archived";
  const overviewValueStyle = isPhone ? { ...S.overviewValue, fontSize: 17 } : S.overviewValue;
  const projectNameStyle = isPhone ? { ...S.projectName, fontSize: 24 } : S.projectName;
  const heroFinancialGridStyle = isPhone ? { ...S.heroFinancialGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } : S.heroFinancialGrid;
  const overviewGridStyle = isPhone ? { ...S.overviewGrid, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } : S.overviewGrid;
  const docFlowGridStyle = isPhone ? { ...S.docFlowGrid, gridTemplateColumns: "1fr" } : S.docFlowGrid;
  const nextStepTone = overdueCount > 0
    ? { bg: "rgba(239,68,68,0.08)", border: "rgba(239,68,68,0.22)", value: "rgba(248,113,113,0.96)" }
    : hasBalanceDue
      ? { bg: "rgba(245,158,11,0.08)", border: "rgba(245,158,11,0.24)", value: "rgba(245,158,11,0.96)" }
      : approvedEstCount > 0
        ? { bg: "rgba(72,187,120,0.08)", border: "rgba(72,187,120,0.22)", value: "rgba(72,187,120,0.96)" }
        : { bg: "rgba(99,179,237,0.08)", border: "rgba(99,179,237,0.2)", value: "rgba(99,179,237,0.94)" };
  const nextStep = overdueCount > 0
    ? {
      label: "Needs attention",
      value: overdueCount === 1 ? "1 overdue invoice" : `${overdueCount} overdue invoices`,
      meta: "A payment follow-up is the top priority on this job.",
    }
    : hasBalanceDue
      ? {
        label: "Needs attention",
        value: `${money(totals.balanceRemaining)} still due`,
        meta: "Open invoice balance remains on this project.",
      }
      : approvedEstCount > 0
        ? {
          label: "Next up",
          value: approvedEstCount === 1 ? "1 approved estimate is ready to bill" : `${approvedEstCount} approved estimates are ready to bill`,
          meta: "Convert approved work into the next invoice when ready.",
        }
        : totals.estimateCount === 0
          ? {
            label: "Next up",
            value: "Create the first estimate",
            meta: "No project documents exist yet.",
          }
          : totals.invoiceCount === 0
            ? {
              label: "Next up",
              value: "Create the first invoice",
              meta: "Estimate work exists, but nothing has been invoiced yet.",
            }
            : {
              label: "Next up",
              value: "Project is moving",
              meta: latestActivityAt ? `Latest recorded activity was ${fmtDate(latestActivityAt)}.` : "Documents and billing are up to date.",
            };
  const heroMetrics = [
    {
      label: "Estimated",
      value: money(totals.estimateTotal),
      meta: totals.estimateCount === 1 ? "1 estimate" : `${totals.estimateCount} estimates`,
      tone: {},
    },
    {
      label: "Invoiced",
      value: money(totals.invoiceTotal),
      meta: totals.invoiceCount === 1 ? "1 invoice" : `${totals.invoiceCount} invoices`,
      tone: {},
    },
    {
      label: "Paid",
      value: money(totals.amountPaid),
      meta: hasPaid ? "Collected so far" : "No payment recorded yet",
      tone: hasPaid ? {
        background: "rgba(72,187,120,0.09)",
        border: "1px solid rgba(72,187,120,0.22)",
        color: "rgba(72,187,120,0.96)",
      } : {},
    },
    {
      label: "Balance Due",
      value: money(totals.balanceRemaining),
      meta: hasBalanceDue ? "Outstanding receivable" : "Paid or no balance remaining",
      tone: hasBalanceDue ? {
        background: "rgba(245,158,11,0.1)",
        border: "1px solid rgba(245,158,11,0.26)",
        color: "rgba(245,158,11,0.98)",
      } : {},
    },
  ];

  return (
    <div style={S.screen}>
      <div style={S.topBar}>
        <button type="button" style={S.backBtn} onClick={onBack}>← Back</button>
      </div>

      {/* Hero */}
      <div style={S.heroCard}>
        <div style={S.heroHeader}>
          <div style={S.heroHeaderTop}>
            <div style={S.heroIdentity}>
              <div style={S.heroEyebrow}>Job Overview</div>
              <div style={projectNameStyle}>{project.projectName || "Untitled Project"}</div>
              {project.projectNumber ? <div style={{ fontSize: 11.5, fontWeight: 700, color: "rgba(230,241,248,0.4)", letterSpacing: "0.05em" }}>Project #{project.projectNumber}</div> : null}
              {customer ? (
                <div style={S.customerName}>{customer.name || customer.companyName || customer.fullName || "—"}</div>
              ) : null}
              {project.siteAddress ? <div style={S.meta}>{project.siteAddress}</div> : null}
            </div>
            <div style={S.heroStatusStack}>
              <div style={{ ...S.statusBadge, background: projectStatusStyle.bg, border: `1px solid ${projectStatusStyle.border}`, color: projectStatusStyle.color }}>
                {displayStatus.label}
              </div>
              <div style={S.heroContextRow}>
                <div style={S.heroContextPill}>{documentCount === 1 ? "1 document" : `${documentCount} documents`}</div>
                <div style={S.heroContextPill}>{latestActivityAt ? `Updated ${fmtDate(latestActivityAt)}` : "No recent activity"}</div>
              </div>
            </div>
          </div>
          <div style={heroFinancialGridStyle}>
            {heroMetrics.map((metric) => (
              <div
                key={metric.label}
                style={{
                  ...S.heroFinancialCard,
                  ...(metric.tone?.background ? { background: metric.tone.background } : {}),
                  ...(metric.tone?.border ? { border: metric.tone.border } : {}),
                }}
              >
                <div style={S.heroFinancialLabel}>{metric.label}</div>
                <div style={{ ...S.heroFinancialValue, ...(metric.tone?.color ? { color: metric.tone.color } : {}) }}>{metric.value}</div>
                <div style={S.heroFinancialMeta}>{metric.meta}</div>
              </div>
            ))}
          </div>
          <div style={{ ...S.heroAttentionCard, background: nextStepTone.bg, border: `1px solid ${nextStepTone.border}` }}>
            <div style={S.heroAttentionLabel}>{nextStep.label}</div>
            <div style={{ ...S.heroAttentionValue, color: nextStepTone.value }}>{nextStep.value}</div>
            <div style={S.heroAttentionMeta}>{nextStep.meta}</div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", margin: isPhone ? "2px 0 0" : "0" }} />
        <div style={{ display: "grid", gap: 8, marginTop: isPhone ? 0 : 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <button
              type="button"
              style={{ ...S.actionBtn, background: "rgba(72,187,120,0.12)", border: "1px solid rgba(72,187,120,0.28)", color: "rgba(72,187,120,0.94)" }}
              onClick={() => {
                writeProjectCreateSeed(view);
                onNewEstimate && onNewEstimate();
              }}
            >
              + New Estimate
            </button>
            <button
              type="button"
              style={{ ...S.actionBtn, background: "rgba(99,179,237,0.12)", border: "1px solid rgba(99,179,237,0.28)", color: "rgba(99,179,237,0.94)" }}
              onClick={() => {
                writeProjectCreateSeed(view);
                onNewInvoice && onNewInvoice();
              }}
            >
              + New Invoice
            </button>
          </div>
          {onEditProject ? (
            <button
              type="button"
              style={{
                width: "100%",
                padding: "12px 0",
                borderRadius: 10,
                border: "1px solid rgba(255,255,255,0.11)",
                background: "rgba(255,255,255,0.04)",
                color: "rgba(230,241,248,0.68)",
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                letterSpacing: "0.03em",
                textAlign: "center",
                font: "inherit",
              }}
              onClick={onEditProject}
            >
              Edit Project Details
            </button>
          ) : null}
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", margin: isPhone ? "10px 0 4px" : "6px 0 2px" }} />
        <div style={S.statusControlWrap}>
          <div style={S.statusControlLabel}>Project lifecycle</div>
          <div style={isPhone ? { ...S.statusControlRow, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" } : S.statusControlRow}>
            {PROJECT_STATUS_CONTROLS.map((option) => {
              const selected = storedProjectStatus === option.key;
              const optionStyle = PROJECT_STATUS_COLORS[option.key] || PROJECT_STATUS_COLORS.active;
              return (
                <button
                  key={option.key}
                  type="button"
                  style={{
                    ...S.statusControlChip,
                    background: selected ? optionStyle.bg : "rgba(255,255,255,0.03)",
                    border: `1px solid ${selected ? optionStyle.border : "rgba(255,255,255,0.08)"}`,
                    color: selected ? optionStyle.color : "rgba(230,241,248,0.62)",
                  }}
                  onClick={() => {
                    const updated = updateProjectStoredStatus(project.id, option.key);
                    if (updated) {
                      setRefreshSeq((value) => value + 1);
                      window.dispatchEvent(new Event("estipaid:projects-changed"));
                    }
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Overview */}
      <div style={S.sectionWrap}>
        <div style={S.sectionTitle}>Overview</div>
        <div style={overviewGridStyle}>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Estimated</div>
            <div style={overviewValueStyle}>{money(totals.estimateTotal)}</div>
          </div>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Invoiced</div>
            <div style={overviewValueStyle}>{money(totals.invoiceTotal)}</div>
          </div>
          <div
            style={{
              ...S.overviewCard,
              ...(hasPaid ? {
                background: "rgba(72,187,120,0.08)",
                border: "1px solid rgba(72,187,120,0.2)",
              } : {}),
            }}
          >
            <div style={S.overviewLabel}>Paid</div>
            <div style={{ ...overviewValueStyle, ...(hasPaid ? { color: "rgba(72,187,120,0.96)" } : {}) }}>{money(totals.amountPaid)}</div>
          </div>
          <div
            style={{
              ...S.overviewCard,
              ...(hasBalanceDue ? {
                background: "rgba(245,158,11,0.09)",
                border: "1px solid rgba(245,158,11,0.24)",
              } : {}),
            }}
          >
            <div style={S.overviewLabel}>Balance Due</div>
            <div style={{ ...overviewValueStyle, ...(hasBalanceDue ? { color: "rgba(245,158,11,0.98)" } : {}) }}>{money(totals.balanceRemaining)}</div>
          </div>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Estimates</div>
            <div style={overviewValueStyle}>{totals.estimateCount}</div>
          </div>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Invoices</div>
            <div style={overviewValueStyle}>{totals.invoiceCount}</div>
          </div>
        </div>
        {hasAttentionSignals ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {overdueCount > 0 ? (
              <div style={{ padding: "4px 10px", borderRadius: 8, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.22)", color: "rgba(239,68,68,0.88)", fontSize: 11, fontWeight: 700 }}>
                {overdueCount === 1 ? "1 invoice overdue" : `${overdueCount} invoices overdue`}
              </div>
            ) : null}
            {totals.balanceRemaining > 0 ? (
              <div style={{ padding: "4px 10px", borderRadius: 8, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "rgba(245,158,11,0.84)", fontSize: 11, fontWeight: 700 }}>
                {money(totals.balanceRemaining)} balance due
              </div>
            ) : null}
            {approvedEstCount > 0 ? (
              <div style={{ padding: "4px 10px", borderRadius: 8, background: "rgba(72,187,120,0.08)", border: "1px solid rgba(72,187,120,0.2)", color: "rgba(72,187,120,0.82)", fontSize: 11, fontWeight: 700 }}>
                {approvedEstCount === 1 ? "1 estimate approved" : `${approvedEstCount} estimates approved`}
              </div>
            ) : null}
          </div>
        ) : null}
        {latestActivityAt ? (
          <div style={{ ...S.meta, marginTop: 8 }}>Latest activity: {fmtDate(latestActivityAt)}</div>
        ) : null}
      </div>

      <div style={S.sectionWrap}>
        <div style={S.sectionTitle}>Documents</div>
        <div style={S.docFlowShell}>
          <div style={S.docFlowSummary}>
            <div style={S.docFlowTitle}>Project document flow</div>
            <div style={S.docFlowMeta}>
              {documentCount === 0
                ? "No estimates or invoices have been created for this project yet."
                : `${documentCount} project documents across estimating and billing. Estimated ${money(totals.estimateTotal)} · Invoiced ${money(totals.invoiceTotal)}.`}
            </div>
          </div>
          <div style={docFlowGridStyle}>
            <div style={S.docFlowColumn}>
              <div style={S.docFlowColumnHeader}>
                <div style={S.docFlowColumnTitle}>Estimates</div>
                <div style={S.docFlowColumnCount}>{estimates.length === 1 ? "1 document" : `${estimates.length} documents`}</div>
              </div>
              {estimates.length === 0 ? (
                <div style={{ padding: "14px 16px", borderRadius: 10, border: "1px dashed rgba(255,255,255,0.07)", display: "grid", gap: 10, alignItems: "start" }}>
                  <div style={{ fontSize: 13, color: "rgba(230,241,248,0.38)", lineHeight: 1.4 }}>No estimates for this project yet.</div>
                  {onNewEstimate ? (
                    <button
                      type="button"
                      style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(99,179,237,0.2)", background: "rgba(99,179,237,0.07)", color: "rgba(99,179,237,0.82)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.02em" }}
                      onClick={() => { writeProjectCreateSeed(view); onNewEstimate && onNewEstimate(); }}
                    >
                      + New Estimate
                    </button>
                  ) : null}
                </div>
              ) : (
                [...estimates].sort((a, b) => estSortPriority(a) - estSortPriority(b)).map((est, i) => {
                  const estTotal = est?.approvedTotal ?? est?.total ?? est?.grandTotal ?? 0;
                  const estNum = est?.estimateNumber || est?.docNumber || "";
                  const estDate = fmtDate(est?.updatedAt || est?.savedAt || est?.createdAt);
                  const estStatusStr = statusLabel(est?.status);
                  const estStatusKey = String(est?.status || "").toLowerCase();
                  return (
                    <button
                      key={est?.id || i}
                      type="button"
                      style={{ ...S.docCard, ...S.docActionCard }}
                      onClick={() => onOpenEstimate && onOpenEstimate(est)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={S.docTitle}>{estNum ? `Estimate #${estNum}` : (est?.projectName || "Estimate")}</div>
                        <div style={S.docAmount}>{money(estTotal)}</div>
                      </div>
                      <div style={S.docMeta}>
                        <span style={{ color: EST_STATUS_ACCENT[estStatusKey] || "rgba(230,241,248,0.45)" }}>{estStatusStr}</span>
                        {estDate ? ` · ${estDate}` : ""}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div style={S.docFlowColumn}>
              <div style={S.docFlowColumnHeader}>
                <div style={S.docFlowColumnTitle}>Invoices</div>
                <div style={S.docFlowColumnCount}>{invoices.length === 1 ? "1 document" : `${invoices.length} documents`}</div>
              </div>
              {invoices.length === 0 ? (
                <div style={{ padding: "14px 16px", borderRadius: 10, border: "1px dashed rgba(255,255,255,0.07)", display: "grid", gap: 10, alignItems: "start" }}>
                  <div style={{ fontSize: 13, color: "rgba(230,241,248,0.38)", lineHeight: 1.4 }}>No invoices for this project yet.</div>
                  {onNewInvoice ? (
                    <button
                      type="button"
                      style={{ padding: "6px 14px", borderRadius: 8, border: "1px solid rgba(99,179,237,0.2)", background: "rgba(99,179,237,0.07)", color: "rgba(99,179,237,0.82)", fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", letterSpacing: "0.02em" }}
                      onClick={() => { writeProjectCreateSeed(view); onNewInvoice && onNewInvoice(); }}
                    >
                      + New Invoice
                    </button>
                  ) : null}
                </div>
              ) : (
                [...invoices].sort((a, b) => invSortPriority(a) - invSortPriority(b)).map((inv, i) => {
                  const invTotal = inv?.invoiceTotal ?? inv?.total ?? 0;
                  const invNum = inv?.invoiceNumber || inv?.docNumber || "";
                  const invDate = fmtDate(inv?.updatedAt || inv?.savedAt || inv?.createdAt || inv?.date);
                  const invDerivedStatus = deriveInvoiceStatus(inv);
                  const invStatusStr = invStatusLabel(invDerivedStatus);
                  const invStatusKey = String(invDerivedStatus || "").toLowerCase();
                  const isVoidInv = invDerivedStatus === INVOICE_STATUSES.VOID;
                  return (
                    <button
                      key={inv?.id || i}
                      type="button"
                      style={{ ...S.docCard, ...S.docActionCard, ...(isVoidInv ? { opacity: 0.55, cursor: "default" } : {}) }}
                      onClick={() => !isVoidInv && onOpenInvoice && onOpenInvoice(inv)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                        <div style={S.docTitle}>{invNum ? `Invoice #${invNum}` : (inv?.customerName || "Invoice")}</div>
                        <div style={S.docAmount}>{money(invTotal)}</div>
                      </div>
                      <div style={S.docMeta}>
                        {invStatusStr ? <span style={{ color: INV_STATUS_ACCENT[invStatusKey] || "rgba(230,241,248,0.45)" }}>{invStatusStr}</span> : null}
                        {invStatusStr && invDate ? " · " : ""}
                        {invDate || ""}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={S.sectionWrap}>
        <div style={S.sectionTitle}>Danger Zone</div>
        <div style={{
          padding: "14px 14px 16px",
          borderRadius: 14,
          background: "rgba(239,68,68,0.05)",
          border: "1px solid rgba(239,68,68,0.16)",
          display: "grid",
          gap: 10,
        }}>
          <div style={{ display: "grid", gap: 4 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "rgba(230,241,248,0.62)" }}>
              {canHardDelete
                ? "This project has no saved estimates or invoices. You can permanently delete it."
                : "This project has saved documents. Archive it instead to keep your records safe."}
            </div>
          </div>
          {!canHardDelete ? (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {!isArchivedProject ? (
                <button
                  type="button"
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: "1px solid rgba(99,179,237,0.24)",
                    background: "rgba(99,179,237,0.08)",
                    color: "rgba(99,179,237,0.92)",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    letterSpacing: "0.02em",
                  }}
                  onClick={() => {
                    const updated = updateProjectStoredStatus(project.id, "archived");
                    if (updated) {
                      setRefreshSeq((value) => value + 1);
                      window.dispatchEvent(new Event("estipaid:projects-changed"));
                    }
                  }}
                >
                  Archive Project
                </button>
              ) : null}
            </div>
          ) : (
            <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
              <label style={{ display: "grid", gap: 6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(230,241,248,0.72)" }}>
                  Type DELETE to permanently delete this empty project.
                </div>
                <input
                  className="pe-input"
                  value={deleteConfirmValue}
                  onChange={(e) => setDeleteConfirmValue(String(e.target.value || "").toUpperCase())}
                  placeholder="DELETE"
                  autoComplete="off"
                  spellCheck={false}
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(239,68,68,0.24)",
                    color: "rgba(230,241,248,0.92)",
                  }}
                />
              </label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {!isArchivedProject ? (
                  <button
                    type="button"
                    style={{
                      padding: "10px 14px",
                      borderRadius: 10,
                      border: "1px solid rgba(99,179,237,0.24)",
                      background: "rgba(99,179,237,0.08)",
                      color: "rgba(99,179,237,0.92)",
                      fontSize: 13,
                      fontWeight: 700,
                      cursor: "pointer",
                      fontFamily: "inherit",
                      letterSpacing: "0.02em",
                    }}
                    onClick={() => {
                      const updated = updateProjectStoredStatus(project.id, "archived");
                      if (updated) {
                        setRefreshSeq((value) => value + 1);
                        window.dispatchEvent(new Event("estipaid:projects-changed"));
                      }
                    }}
                  >
                    Archive Project
                  </button>
                ) : null}
                <button
                  type="button"
                  disabled={deleteBusy || deleteConfirmValue !== "DELETE"}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 10,
                    border: `1px solid ${deleteConfirmValue === "DELETE" ? "rgba(239,68,68,0.34)" : "rgba(239,68,68,0.16)"}`,
                    background: deleteConfirmValue === "DELETE" ? "rgba(239,68,68,0.14)" : "rgba(239,68,68,0.08)",
                    color: deleteConfirmValue === "DELETE" ? "rgba(248,113,113,0.96)" : "rgba(248,113,113,0.6)",
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: deleteBusy || deleteConfirmValue !== "DELETE" ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                    letterSpacing: "0.02em",
                  }}
                  onClick={() => {
                    if (deleteBusy || deleteConfirmValue !== "DELETE") return;
                    setDeleteBusy(true);
                    setDeleteMessage("");
                    try {
                      const result = deleteStoredProject(project.id);
                      if (!result?.removed) {
                        setDeleteMessage("Unable to delete this project right now.");
                        setDeleteBusy(false);
                        return;
                      }
                      try { localStorage.removeItem(PROJECT_DETAIL_TARGET_KEY); } catch {}
                      window.dispatchEvent(new Event("estipaid:projects-changed"));
                      onBack && onBack();
                    } catch {
                      setDeleteMessage("Unable to delete this project right now.");
                      setDeleteBusy(false);
                    }
                  }}
                >
                  Permanently Delete Project
                </button>
              </div>
            </div>
          )}
          {deleteMessage ? (
            <div style={{ fontSize: 12.5, lineHeight: 1.45, color: "rgba(248,113,113,0.9)" }}>
              {deleteMessage}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
