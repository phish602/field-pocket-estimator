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
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: "14px 16px",
    cursor: "pointer",
    display: "grid",
    gap: 8,
  },
  cardTop: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
  cardName: { fontWeight: 800, fontSize: 15, letterSpacing: 0.2, lineHeight: 1.3 },
  cardCustomer: { fontSize: 13, fontWeight: 600, color: "rgba(99,179,237,0.78)" },
  cardAddress: { fontSize: 12, opacity: 0.45, lineHeight: 1.4 },
  statusBadge: {
    display: "inline-flex",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    flexShrink: 0,
  },
  statsRow: {
    display: "flex",
    gap: 14,
    flexWrap: "wrap",
    borderTop: "1px solid rgba(255,255,255,0.06)",
    paddingTop: 8,
    marginTop: 2,
  },
  statItem: { display: "grid", gap: 1 },
  statLabel: { fontSize: 10, fontWeight: 700, opacity: 0.4, letterSpacing: "0.08em", textTransform: "uppercase" },
  statValue: { fontSize: 13, fontWeight: 700, opacity: 0.85, fontVariantNumeric: "tabular-nums" },
  emptyWrap: { display: "grid", placeItems: "center", padding: "48px 16px", gap: 12, textAlign: "center" },
  emptyTitle: { fontWeight: 800, fontSize: 16, opacity: 0.7 },
  emptyDesc: { fontSize: 13, opacity: 0.4, lineHeight: 1.5, maxWidth: 280 },
  activityText: { fontSize: 11, opacity: 0.35, fontWeight: 600 },
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
};

export default function ProjectsScreen({ onOpenProjectDetail }) {
  const [q, setQ] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");
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
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("pe-localstorage", onLocalStorage);
      window.removeEventListener("estipaid:customer-use", refresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("estipaid:estimates-changed", refresh);
      window.removeEventListener("estipaid:invoices-changed", refresh);
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

  const filtered = useMemo(() => {
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
            return (
              <div
                key={proj.id}
                className="pe-card pe-card-content ep-glass-tile"
                style={S.card}
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
                        {proj.approvedEstCount === 1 ? "1 est. approved" : `${proj.approvedEstCount} ests. approved`}
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
                  {proj.latestActivityAt ? (
                    <div style={{ ...S.statItem, marginLeft: "auto" }}>
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
