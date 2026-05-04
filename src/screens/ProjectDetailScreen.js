// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  readStoredProjects,
  buildNormalizedProjectView,
  deriveProjectDisplayStatus,
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
    padding: "18px 18px 16px",
    borderRadius: 14,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    display: "grid",
    gap: 6,
  },
  projectName: {
    fontSize: 18,
    fontWeight: 800,
    lineHeight: 1.25,
    color: "rgba(230,241,248,0.96)",
    overflowWrap: "break-word",
  },
  customerName: {
    fontSize: 13,
    fontWeight: 600,
    color: "rgba(99,179,237,0.82)",
  },
  meta: {
    fontSize: 12,
    color: "rgba(230,241,248,0.45)",
    lineHeight: 1.4,
  },
  statusBadge: {
    display: "inline-block",
    padding: "2px 8px",
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
    gridTemplateColumns: "1fr 1fr",
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
  const overviewValueStyle = isPhone ? { ...S.overviewValue, fontSize: 17 } : S.overviewValue;

  return (
    <div style={S.screen}>
      <div style={S.topBar}>
        <button type="button" style={S.backBtn} onClick={onBack}>← Back</button>
      </div>

      {/* Hero */}
      <div style={S.heroCard}>
        <div style={S.projectName}>{project.projectName || "Untitled Project"}</div>
        {project.projectNumber ? <div style={{ fontSize: 11, fontWeight: 600, color: "rgba(230,241,248,0.38)", letterSpacing: "0.04em" }}>Project #{project.projectNumber}</div> : null}
        {customer ? (
          <div style={S.customerName}>{customer.name || customer.companyName || customer.fullName || "—"}</div>
        ) : null}
        {project.siteAddress ? <div style={S.meta}>{project.siteAddress}</div> : null}
        <div style={{ ...S.statusBadge, background: projectStatusStyle.bg, border: `1px solid ${projectStatusStyle.border}`, color: projectStatusStyle.color }}>
          {displayStatus.label}
        </div>
        <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", margin: isPhone ? "10px 0 6px" : "6px 0 4px" }} />
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
        <div style={S.overviewGrid}>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Estimates</div>
            <div style={overviewValueStyle}>{totals.estimateCount}</div>
          </div>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Invoices</div>
            <div style={overviewValueStyle}>{totals.invoiceCount}</div>
          </div>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Est. Total</div>
            <div style={overviewValueStyle}>{money(totals.estimateTotal)}</div>
          </div>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Invoiced</div>
            <div style={overviewValueStyle}>{money(totals.invoiceTotal)}</div>
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

      {/* Estimates */}
      <div style={S.sectionWrap}>
        <div style={S.sectionTitle}>Estimates{estimates.length > 0 ? ` (${estimates.length})` : ""}</div>
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

      {/* Invoices */}
      <div style={S.sectionWrap}>
        <div style={S.sectionTitle}>Invoices{invoices.length > 0 ? ` (${invoices.length})` : ""}</div>
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
  );
}
