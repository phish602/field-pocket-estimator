// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useState } from "react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import {
  readStoredProjects,
  buildNormalizedProjectView,
  deriveProjectDisplayStatus,
} from "../utils/projects";
import { INVOICE_STATUSES, deriveInvoiceStatus, readStoredInvoices } from "../utils/invoices";

function readEstimates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATES);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((record) => String(record?.docType || "estimate").toLowerCase() !== "invoice")
      : [];
  } catch {
    return [];
  }
}

function readCustomers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
    return Array.isArray(JSON.parse(raw)) ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "$0";
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: n % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(n);
  } catch {
    return `$${n.toFixed(2)}`;
  }
}

function formatRelativeDate(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return "";
  const now = Date.now();
  const diff = now - d.getTime();
  if (diff < 86400000) return "Today";
  if (diff < 172800000) return "Yesterday";
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
  try {
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined });
  } catch {
    return "";
  }
}

// Attention-first sort: overdue > balance due > approved est > recent activity
function projSortPriority(proj) {
  if ((proj.overdueCount || 0) > 0) return 0;
  if ((proj.totals?.balanceRemaining || 0) > 0) return 1;
  if ((proj.approvedEstCount || 0) > 0) return 2;
  return 3;
}

function deriveProjectColorLane(proj) {
  if ((proj.overdueCount || 0) > 0) return "overdue";
  if ((proj.totals?.balanceRemaining || 0) > 0) return "balance";
  if ((proj.approvedEstCount || 0) > 0) return "approved";
  return "standard";
}

function deriveProjectNextAction(proj) {
  if ((proj?.overdueCount || 0) > 0) {
    return {
      label: "Resolve Overdue",
      tone: "danger",
    };
  }
  if ((proj?.totals?.balanceRemaining || 0) > 0) {
    return {
      label: "Collect Balance",
      tone: "warning",
    };
  }
  if ((proj?.approvedEstCount || 0) > 0) {
    return {
      label: "Ready to Invoice",
      tone: "success",
    };
  }
  if (String(proj?.status || "").toLowerCase() === "estimating") {
    return {
      label: "Follow Up",
      tone: "info",
    };
  }
  if (String(proj?.status || "").toLowerCase() === "completed") {
    return {
      label: "Review Closeout",
      tone: "neutral",
    };
  }
  return {
    label: "View Project",
    tone: "info",
  };
}

const FILTER_CHIPS = [
  { key: "all", label: "All" },
  { key: "draft", label: "Draft" },
  { key: "estimating", label: "Estimating" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];
const CHIP_ACTIVE_ALL = { bg: "rgba(99,179,237,0.12)", border: "rgba(99,179,237,0.28)", color: "rgba(99,179,237,0.9)" };

const STATUS_LABELS = {
  draft: "Draft",
  estimating: "Estimating",
  active: "Active",
  completed: "Completed",
  archived: "Archived",
};
const STATUS_COLORS = {
  draft: { bg: "rgba(230,241,248,0.06)", border: "rgba(230,241,248,0.14)", color: "rgba(230,241,248,0.5)" },
  estimating: { bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.22)", color: "rgba(245,158,11,0.84)" },
  active: { bg: "rgba(72,187,120,0.1)", border: "rgba(72,187,120,0.22)", color: "rgba(72,187,120,0.82)" },
  completed: { bg: "rgba(99,179,237,0.1)", border: "rgba(99,179,237,0.22)", color: "rgba(99,179,237,0.84)" },
  archived: { bg: "rgba(230,241,248,0.04)", border: "rgba(230,241,248,0.1)", color: "rgba(230,241,248,0.35)" },
};

const COLOR_LANES = [
  { key: "all",      label: "All colors",     swatch: "rgba(99,179,237,0.72)" },
  { key: "overdue",  label: "Overdue",        swatch: "rgba(248,113,113,0.88)" },
  { key: "balance",  label: "Balance due",    swatch: "rgba(251,191,36,0.88)" },
  { key: "approved", label: "Ready to invoice", swatch: "rgba(74,222,128,0.88)" },
  { key: "standard", label: "Standard",       swatch: "rgba(148,163,184,0.55)" },
];

const S = {
  container: { display: "flex", flexDirection: "column", gap: 16, padding: "0 4px" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 },
  title: { fontWeight: 900, fontSize: 18, letterSpacing: 0.3 },
  countBadge: { fontSize: 12, fontWeight: 700, opacity: 0.45, letterSpacing: "0.04em" },
  searchWrap: { position: "relative" },
  searchInput: {
    width: "100%",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    color: "rgba(230,241,248,0.92)",
    fontSize: 14,
    padding: "10px 14px",
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
  },
  card: {
    background: "linear-gradient(180deg, rgba(255,255,255,0.038), rgba(255,255,255,0.022))",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 18,
    padding: "16px 16px 15px",
    cursor: "pointer",
    display: "grid",
    gap: 10,
    boxShadow: "0 16px 34px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.035)",
  },
  cardTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  cardName: { fontWeight: 900, fontSize: 17, letterSpacing: "-0.01em", lineHeight: 1.2 },
  cardCustomer: { fontSize: 13, fontWeight: 600, color: "rgba(99,179,237,0.78)" },
  cardAddress: { fontSize: 12.5, opacity: 0.58, lineHeight: 1.4 },
  statusBadge: {
    display: "inline-flex",
    padding: "4px 9px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    flexShrink: 0,
  },
  statsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(92px, 1fr))",
    gap: 10,
    borderTop: "1px solid rgba(255,255,255,0.06)",
    paddingTop: 12,
    marginTop: 2,
  },
  statItem: {
    display: "grid",
    gap: 4,
    padding: "10px 10px 9px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.06)",
    background: "rgba(255,255,255,0.025)",
    minWidth: 0,
  },
  statLabel: { fontSize: 10, fontWeight: 800, opacity: 0.46, letterSpacing: "0.1em", textTransform: "uppercase" },
  statValue: { fontSize: 13.5, fontWeight: 800, opacity: 0.9, fontVariantNumeric: "tabular-nums" },
  emptyWrap: { display: "grid", placeItems: "center", padding: "48px 16px", gap: 12, textAlign: "center" },
  emptyTitle: { fontWeight: 800, fontSize: 16, opacity: 0.7 },
  emptyDesc: { fontSize: 13, opacity: 0.4, lineHeight: 1.5, maxWidth: 280 },
  activityText: { fontSize: 11.5, opacity: 0.55, fontWeight: 700 },
  filterRow: {
    display: "flex",
    gap: 6,
    overflowX: "auto",
    paddingBottom: 2,
    scrollbarWidth: "none",
    msOverflowStyle: "none",
  },
  filterChip: {
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
    border: "1px solid",
    whiteSpace: "nowrap",
    fontFamily: "inherit",
    flexShrink: 0,
    background: "none",
    lineHeight: 1.5,
  },
  portfolioHero: {
    display: "grid",
    gap: 14,
    padding: "16px 16px 14px",
    borderRadius: 20,
    border: "1px solid rgba(168,184,195,0.14)",
    background: "linear-gradient(135deg, rgba(59,130,246,0.12), rgba(34,197,94,0.08) 48%, rgba(245,158,11,0.06)), linear-gradient(180deg, rgba(24,34,44,0.4), rgba(7,10,15,0.94))",
    boxShadow: "0 24px 54px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.05)",
  },
  heroStatGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: 10,
  },
  heroStat: {
    minWidth: 0,
    display: "grid",
    gap: 6,
    padding: "12px 12px 11px",
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01)), rgba(7,11,16,0.22)",
  },
};

export default function ProjectsScreen({ onOpenProjectDetail }) {
  const [q, setQ] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
  const [activeColorLane, setActiveColorLane] = useState("all");
  const [refreshSeq, setRefreshSeq] = useState(0);

  useEffect(() => {
    const refresh = () => setRefreshSeq((prev) => prev + 1);
    const onStorage = (event) => {
      if (
        !event?.key
        || event.key === STORAGE_KEYS.PROJECTS
        || event.key === STORAGE_KEYS.CUSTOMERS
        || event.key === STORAGE_KEYS.ESTIMATES
        || event.key === STORAGE_KEYS.INVOICES
      ) {
        refresh();
      }
    };
    const onLocalStorage = (event) => {
      if (
        !event?.detail?.key
        || event.detail.key === STORAGE_KEYS.PROJECTS
        || event.detail.key === STORAGE_KEYS.CUSTOMERS
        || event.detail.key === STORAGE_KEYS.ESTIMATES
        || event.detail.key === STORAGE_KEYS.INVOICES
      ) {
        refresh();
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    refresh();
    window.addEventListener("storage", onStorage);
    window.addEventListener("pe-localstorage", onLocalStorage);
    window.addEventListener("estipaid:customer-use", refresh);
    window.addEventListener("focus", refresh);
    window.addEventListener("estipaid:estimates-changed", refresh);
    window.addEventListener("estipaid:invoices-changed", refresh);
    window.addEventListener("estipaid:projects-changed", refresh);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:customer-use", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("estipaid:estimates-changed", refresh);
      window.removeEventListener("estipaid:invoices-changed", refresh);
      window.removeEventListener("estipaid:projects-changed", refresh);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  const allData = useMemo(() => {
    const projects = readStoredProjects();
    const customers = readCustomers();
    const estimates = readEstimates();
    const invoices = readStoredInvoices();
    return projects.map((proj) => {
      const view = buildNormalizedProjectView({
        project: proj,
        projectId: proj.id,
        projects,
        customers,
        estimates,
        invoices,
      });
      const displayStatus = deriveProjectDisplayStatus(view);
      const projInvoices = view.invoices || [];
      const projEstimates = view.estimates || [];
      return {
        id: proj.id,
        projectName: proj.projectName || "",
        projectNumber: proj.projectNumber || "",
        customerName: view.customer?.name || view.customer?.companyName || view.customer?.fullName || proj.customerName || "",
        siteAddress: proj.siteAddress || "",
        status: displayStatus.key,
        statusLabel: displayStatus.label,
        displayStatus,
        latestActivityAt: view.latestActivityAt || 0,
        totals: view.totals,
        overdueCount: projInvoices.filter((inv) => deriveInvoiceStatus(inv) === INVOICE_STATUSES.OVERDUE).length,
        approvedEstCount: projEstimates.filter((est) => String(est?.status || "").toLowerCase() === "approved").length,
      };
    });
  }, [refreshSeq]);

  const chipCounts = useMemo(() => {
    const counts = { draft: 0, estimating: 0, active: 0, completed: 0, archived: 0 };
    for (const p of allData) {
      const key = p.status || "draft";
      if (key in counts) counts[key] += 1;
    }
    return { ...counts, all: allData.length - counts.archived };
  }, [allData]);

  const baseFiltered = useMemo(() => {
    const term = q.trim().toLowerCase();
    let list = activeFilter === "all"
      ? allData.filter((p) => p.status !== "archived")
      : allData.filter((p) => p.status === activeFilter);
    if (term) {
      list = list.filter((p) =>
        (p.projectName + " " + p.customerName + " " + p.siteAddress).toLowerCase().includes(term)
      );
    }
    return list.sort((a, b) => {
      const pa = projSortPriority(a);
      const pb = projSortPriority(b);
      if (pa !== pb) return pa - pb;
      return (b.latestActivityAt || 0) - (a.latestActivityAt || 0);
    });
  }, [allData, q, activeFilter]);

  const colorBreakdown = useMemo(() => {
    const counts = { overdue: 0, balance: 0, approved: 0, standard: 0 };
    let totalOverdueInvoices = 0;
    let totalBalance = 0;
    let totalApproved = 0;
    for (const proj of baseFiltered) {
      const lane = deriveProjectColorLane(proj);
      counts[lane] = (counts[lane] || 0) + 1;
      if (lane === "overdue") totalOverdueInvoices += proj.overdueCount || 0;
      if (lane === "balance") totalBalance += Number(proj.totals?.balanceRemaining || 0);
      if (lane === "approved") totalApproved += proj.approvedEstCount || 0;
    }
    return { counts, totalOverdueInvoices, totalBalance, totalApproved };
  }, [baseFiltered]);

  const filtered = useMemo(() => {
    if (activeColorLane === "all") return baseFiltered;
    return baseFiltered.filter((p) => deriveProjectColorLane(p) === activeColorLane);
  }, [baseFiltered, activeColorLane]);

  const portfolioSummary = useMemo(() => {
    const visible = filtered;
    const activeProjects = visible.filter((proj) => proj.status === "active").length;
    const balanceDue = visible.reduce((sum, proj) => sum + Number(proj?.totals?.balanceRemaining || 0), 0);
    const overdueProjects = visible.filter((proj) => (proj.overdueCount || 0) > 0).length;
    const overdueInvoices = visible.reduce((sum, proj) => sum + Number(proj?.overdueCount || 0), 0);
    const approvedReadyProjects = visible.filter((proj) => (proj.approvedEstCount || 0) > 0).length;
    const totalDocuments = visible.reduce(
      (sum, proj) => sum + Number(proj?.totals?.estimateCount || 0) + Number(proj?.totals?.invoiceCount || 0),
      0
    );
    const highestBalanceProject = visible
      .slice()
      .sort((a, b) => Number(b?.totals?.balanceRemaining || 0) - Number(a?.totals?.balanceRemaining || 0))[0] || null;
    return {
      activeProjects,
      balanceDue,
      overdueProjects,
      overdueInvoices,
      approvedReadyProjects,
      totalDocuments,
      highestBalanceProject,
    };
  }, [filtered]);

  if (!allData.length) {
    return (
      <div className="pe-card" style={{ padding: 0 }}>
        <div style={S.emptyWrap}>
          <div style={S.emptyTitle}>No projects yet</div>
          <div style={S.emptyDesc}>
            Projects are created automatically when you build estimates or invoices with customer and job details.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={S.container}>
      <div style={S.header}>
        <div style={S.title}>Projects</div>
        <div style={S.countBadge}>{chipCounts.all} project{chipCounts.all !== 1 ? "s" : ""}</div>
      </div>

      <div style={S.portfolioHero}>
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.18em", textTransform: "uppercase", color: "rgba(180,196,208,0.56)" }}>
            Portfolio overview
          </div>
          <div style={{ fontSize: 24, fontWeight: 950, letterSpacing: "-0.03em", color: "rgba(239,245,249,0.98)", lineHeight: 1.05 }}>
            Projects prioritized by what needs attention next
          </div>
          <div style={{ fontSize: 12.5, lineHeight: 1.5, color: "rgba(215,225,233,0.74)", maxWidth: 760 }}>
            {portfolioSummary.highestBalanceProject && Number(portfolioSummary.highestBalanceProject?.totals?.balanceRemaining || 0) > 0
              ? `${portfolioSummary.highestBalanceProject.projectName || "This project"} carries the highest visible balance due at ${formatMoney(portfolioSummary.highestBalanceProject.totals.balanceRemaining)}.`
              : "Open any project to view estimates, invoices, and full job details."}
          </div>
        </div>

        <div style={S.heroStatGrid}>
          {[
            {
              key: "active",
              label: "Active jobs",
              value: String(portfolioSummary.activeProjects),
              detail: `${filtered.length} visible`,
              color: "rgba(74,222,128,0.84)",
              border: "rgba(34,197,94,0.18)",
            },
            {
              key: "balance",
              label: "Balance due",
              value: formatMoney(portfolioSummary.balanceDue),
              detail: portfolioSummary.balanceDue > 0 ? "Across visible projects" : "No balance due in view",
              color: portfolioSummary.balanceDue > 0 ? "rgba(251,191,36,0.88)" : "rgba(203,213,225,0.78)",
              border: portfolioSummary.balanceDue > 0 ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.1)",
            },
            {
              key: "overdue",
              label: "Overdue invoices",
              value: String(portfolioSummary.overdueInvoices),
              detail: portfolioSummary.overdueProjects > 0 ? `${portfolioSummary.overdueProjects} project${portfolioSummary.overdueProjects !== 1 ? "s" : ""}` : "No overdue invoices in view",
              color: portfolioSummary.overdueInvoices > 0 ? "rgba(248,113,113,0.88)" : "rgba(203,213,225,0.78)",
              border: portfolioSummary.overdueInvoices > 0 ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.1)",
            },
            {
              key: "approved",
              label: "Ready to invoice",
              value: String(portfolioSummary.approvedReadyProjects),
              detail: `${portfolioSummary.totalDocuments} docs across visible projects`,
              color: "rgba(96,165,250,0.84)",
              border: "rgba(59,130,246,0.2)",
            },
          ].map((item) => (
            <div key={item.key} style={{ ...S.heroStat, border: `1px solid ${item.border}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 900, letterSpacing: "0.14em", textTransform: "uppercase", color: item.color }}>
                {item.label}
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

      <div style={S.filterRow}>
        {FILTER_CHIPS.map(({ key, label }) => {
          const isActive = activeFilter === key;
          const count = chipCounts[key] || 0;
          const colorSet = key === "all" ? CHIP_ACTIVE_ALL : (STATUS_COLORS[key] || CHIP_ACTIVE_ALL);
          const chipStyle = isActive
            ? { ...S.filterChip, background: colorSet.bg, borderColor: colorSet.border, color: colorSet.color }
            : { ...S.filterChip, background: "rgba(255,255,255,0.04)", borderColor: "rgba(255,255,255,0.1)", color: "rgba(230,241,248,0.42)" };
          return (
            <button
              key={key}
              type="button"
              style={chipStyle}
              onClick={() => setActiveFilter(key)}
            >
              {label}{count > 0 ? ` · ${count}` : ""}
            </button>
          );
        })}
      </div>

      {/* Color lane filter + breakdown */}
      <div style={{ display: "grid", gap: 8, padding: "10px 12px 9px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.07)", background: "rgba(255,255,255,0.025)" }}>
        <div style={{ fontSize: 9.5, fontWeight: 900, letterSpacing: "0.16em", textTransform: "uppercase", color: "rgba(180,196,208,0.45)" }}>
          Color breakdown
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {COLOR_LANES.map(({ key, label, swatch }) => {
            const isActive = activeColorLane === key;
            const count = key === "all" ? baseFiltered.length : (colorBreakdown.counts[key] || 0);
            const secondary = key === "overdue" && colorBreakdown.totalOverdueInvoices > 0
              ? `${colorBreakdown.totalOverdueInvoices} inv.`
              : key === "balance" && colorBreakdown.totalBalance > 0
                ? formatMoney(colorBreakdown.totalBalance)
                : key === "approved" && colorBreakdown.totalApproved > 0
                  ? `${colorBreakdown.totalApproved} est.`
                  : null;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActiveColorLane(key)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 9px",
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: isActive ? 800 : 600,
                  cursor: "pointer",
                  border: `1px solid ${isActive ? swatch.replace(/[\d.]+\)$/, "0.36)") : "rgba(255,255,255,0.1)"}`,
                  background: isActive ? swatch.replace(/[\d.]+\)$/, "0.1)") : "rgba(255,255,255,0.03)",
                  color: isActive ? swatch : "rgba(230,241,248,0.44)",
                  fontFamily: "inherit",
                  whiteSpace: "nowrap",
                  flexShrink: 0,
                  lineHeight: 1.4,
                }}
              >
                <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: count > 0 ? swatch : "rgba(148,163,184,0.28)", flexShrink: 0 }} />
                {label}
                {count > 0 ? <span style={{ opacity: 0.72, fontVariantNumeric: "tabular-nums" }}>{count}</span> : null}
                {secondary ? <span style={{ opacity: 0.58, fontSize: 10.5 }}>· {secondary}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {allData.length > 3 ? (
        <div style={S.searchWrap}>
          <input
            type="text"
            style={S.searchInput}
            placeholder="Search projects…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      ) : null}

      {filtered.length === 0 ? (
        <div style={{ ...S.emptyWrap, padding: "24px 16px" }}>
          <div style={S.emptyDesc}>
            {q.trim()
              ? `No projects match "${q}"`
              : `No ${FILTER_CHIPS.find((f) => f.key === activeFilter)?.label.toLowerCase() || ""} projects`
            }
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {filtered.map((proj) => {
            const statusKey = proj.displayStatus?.key || proj.status || "draft";
            const statusLabel = proj.displayStatus?.label || STATUS_LABELS[statusKey] || "Draft";
            const statusStyle = STATUS_COLORS[statusKey] || STATUS_COLORS.draft;
            const nextAction = deriveProjectNextAction(proj);
            const nextActionTone = nextAction.tone === "danger"
              ? {
                  color: "rgba(248,113,113,0.9)",
                  border: "rgba(239,68,68,0.22)",
                  background: "rgba(239,68,68,0.08)",
                }
              : nextAction.tone === "warning"
                ? {
                    color: "rgba(251,191,36,0.88)",
                    border: "rgba(245,158,11,0.22)",
                    background: "rgba(245,158,11,0.08)",
                  }
                : nextAction.tone === "success"
                  ? {
                      color: "rgba(74,222,128,0.88)",
                      border: "rgba(34,197,94,0.22)",
                      background: "rgba(34,197,94,0.08)",
                    }
                  : {
                      color: "rgba(96,165,250,0.88)",
                      border: "rgba(59,130,246,0.22)",
                      background: "rgba(59,130,246,0.08)",
                    };
            return (
              <div
                key={proj.id}
                className="pe-card pe-card-content ep-glass-tile"
                style={{
                  ...S.card,
                  border: (() => {
                    const lane = deriveProjectColorLane(proj);
                    if (lane === "overdue")  return "1px solid rgba(239,68,68,0.16)";
                    if (lane === "balance")  return "1px solid rgba(245,158,11,0.16)";
                    if (lane === "approved") return "1px solid rgba(34,197,94,0.16)";
                    return S.card.border;
                  })(),
                  background: (() => {
                    const lane = deriveProjectColorLane(proj);
                    if (lane === "overdue")  return "linear-gradient(180deg, rgba(239,68,68,0.06), rgba(255,255,255,0.03))";
                    if (lane === "balance")  return "linear-gradient(180deg, rgba(245,158,11,0.06), rgba(255,255,255,0.03))";
                    if (lane === "approved") return "linear-gradient(180deg, rgba(34,197,94,0.06), rgba(255,255,255,0.03))";
                    return S.card.background;
                  })(),
                }}
                onClick={() => {
                  if (onOpenProjectDetail && proj.id) onOpenProjectDetail(proj.id);
                }}
              >
                <div style={S.cardTop}>
                  <div style={{ display: "grid", gap: 3, minWidth: 0, flex: 1 }}>
                    <div style={S.cardName}>{proj.projectName || proj.siteAddress || "Untitled Project"}</div>
                    {proj.projectNumber ? (
                      <div style={{ fontSize: 10.5, fontWeight: 600, color: "rgba(230,241,248,0.35)", letterSpacing: "0.04em" }}>#{proj.projectNumber}</div>
                    ) : null}
                    {proj.customerName ? <div style={S.cardCustomer}>{proj.customerName}</div> : null}
                    {proj.siteAddress && proj.projectName ? <div style={S.cardAddress}>{proj.siteAddress}</div> : null}
                  </div>
                  <span style={{ ...S.statusBadge, background: statusStyle.bg, border: `1px solid ${statusStyle.border}`, color: statusStyle.color }}>
                    {statusLabel}
                  </span>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ padding: "4px 8px", borderRadius: 999, border: `1px solid ${nextActionTone.border}`, background: nextActionTone.background, color: nextActionTone.color, fontSize: 10.5, fontWeight: 900, letterSpacing: "0.08em", textTransform: "uppercase" }}>
                    {nextAction.label}
                  </span>
                  {(proj.totals?.amountPaid || 0) > 0 ? (
                    <span style={{ padding: "4px 8px", borderRadius: 999, border: "1px solid rgba(34,197,94,0.18)", background: "rgba(34,197,94,0.06)", color: "rgba(74,222,128,0.86)", fontSize: 10.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase" }}>
                      {formatMoney(proj.totals.amountPaid)} paid
                    </span>
                  ) : null}
                </div>

                {(proj.overdueCount > 0 || (proj.totals?.balanceRemaining || 0) > 0 || proj.approvedEstCount > 0) ? (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                    {proj.overdueCount > 0 ? (
                      <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.22)", color: "rgba(239,68,68,0.88)", fontSize: 10.5, fontWeight: 700 }}>
                        {proj.overdueCount === 1 ? "1 overdue" : `${proj.overdueCount} overdue`}
                      </span>
                    ) : null}
                    {(proj.totals?.balanceRemaining || 0) > 0 ? (
                      <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", color: "rgba(245,158,11,0.84)", fontSize: 10.5, fontWeight: 700 }}>
                        {formatMoney(proj.totals.balanceRemaining)} due
                      </span>
                    ) : null}
                    {proj.approvedEstCount > 0 ? (
                      <span style={{ padding: "2px 8px", borderRadius: 6, background: "rgba(72,187,120,0.08)", border: "1px solid rgba(72,187,120,0.2)", color: "rgba(72,187,120,0.82)", fontSize: 10.5, fontWeight: 700 }}>
                        {proj.approvedEstCount === 1 ? "1 est. approved" : `${proj.approvedEstCount} est. approved`}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <div style={S.statsRow}>
                  {proj.totals.estimateCount > 0 ? (
                    <div style={S.statItem}>
                      <div style={S.statLabel}>Est</div>
                      <div style={S.statValue}>{proj.totals.estimateCount}</div>
                    </div>
                  ) : null}
                  {proj.totals.invoiceCount > 0 ? (
                    <div style={S.statItem}>
                      <div style={S.statLabel}>Inv</div>
                      <div style={S.statValue}>{proj.totals.invoiceCount}</div>
                    </div>
                  ) : null}
                  {proj.totals.estimateTotal > 0 ? (
                    <div style={S.statItem}>
                      <div style={S.statLabel}>Est. total</div>
                      <div style={S.statValue}>{formatMoney(proj.totals.estimateTotal)}</div>
                    </div>
                  ) : null}
                  {proj.totals.invoiceTotal > 0 ? (
                    <div style={S.statItem}>
                      <div style={S.statLabel}>Invoiced</div>
                      <div style={S.statValue}>{formatMoney(proj.totals.invoiceTotal)}</div>
                    </div>
                  ) : null}
                  {(proj.totals?.balanceRemaining || 0) > 0 ? (
                    <div style={S.statItem}>
                      <div style={S.statLabel}>Balance due</div>
                      <div style={S.statValue}>{formatMoney(proj.totals.balanceRemaining)}</div>
                    </div>
                  ) : null}
                  {proj.latestActivityAt ? (
                    <div style={S.statItem}>
                      <div style={S.statLabel}>Last activity</div>
                      <div style={S.activityText}>{formatRelativeDate(proj.latestActivityAt)}</div>
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
