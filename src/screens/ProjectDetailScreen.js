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
import { readStoredInvoices } from "../utils/invoices";

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
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
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
  if (s === "draft") return "Draft";
  if (s === "archived") return "Archived";
  if (s === "active") return "Active";
  return "Pending";
}

const PROJECT_STATUS_CONTROLS = [
  { key: "draft", label: "Draft" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "archived", label: "Archived" },
];

function normalizeProjectControlStatus(status) {
  const raw = String(status || "").toLowerCase();
  if (raw === "complete") return "completed";
  if (raw === "closed" || raw === "inactive") return "archived";
  if (raw === "estimating") return "active";
  if (raw === "draft" || raw === "active" || raw === "completed" || raw === "archived") return raw;
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
  onNewEstimate,
  onNewInvoice,
  onOpenEstimate,
  onOpenInvoice,
}) {
  const [projectId] = useState(() => readProjectDetailTarget());
  const [refreshSeq, setRefreshSeq] = useState(0);

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
          <button type="button" style={S.backBtn} onClick={onBack}>← Estimates</button>
        </div>
        <div style={{ ...S.sectionWrap, ...S.emptyState }}>Project not found.</div>
      </div>
    );
  }

  const { project, customer, estimates, invoices, latestActivityAt, totals } = view;
  const projectStatusStyle = PROJECT_STATUS_COLORS[displayStatus.key] || PROJECT_STATUS_COLORS.draft;
  const storedProjectStatus = normalizeProjectControlStatus(project.status);

  return (
    <div style={S.screen}>
      <div style={S.topBar}>
        <button type="button" style={S.backBtn} onClick={onBack}>← Estimates</button>
      </div>

      {/* Hero */}
      <div style={S.heroCard}>
        <div style={S.projectName}>{project.projectName || "Untitled Project"}</div>
        {customer ? (
          <div style={S.customerName}>{customer.name || customer.companyName || customer.fullName || "—"}</div>
        ) : null}
        {project.siteAddress ? <div style={S.meta}>{project.siteAddress}</div> : null}
        <div style={{ ...S.statusBadge, background: projectStatusStyle.bg, border: `1px solid ${projectStatusStyle.border}`, color: projectStatusStyle.color }}>
          {displayStatus.label}
        </div>
        <div style={S.statusControlWrap}>
          <div style={S.statusControlLabel}>Project lifecycle</div>
          <div style={S.statusControlRow}>
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
                    if (updated) setRefreshSeq((value) => value + 1);
                  }}
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>
        <div style={S.actionsRow}>
          <button
            type="button"
            style={S.actionBtn}
            onClick={() => {
              writeProjectCreateSeed(view);
              onNewEstimate && onNewEstimate();
            }}
          >
            New Estimate
          </button>
          <button
            type="button"
            style={S.actionBtn}
            onClick={() => {
              writeProjectCreateSeed(view);
              onNewInvoice && onNewInvoice();
            }}
          >
            New Invoice
          </button>
        </div>
      </div>

      {/* Overview */}
      <div style={S.sectionWrap}>
        <div style={S.sectionTitle}>Overview</div>
        <div style={S.overviewGrid}>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Estimates</div>
            <div style={S.overviewValue}>{totals.estimateCount}</div>
          </div>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Invoices</div>
            <div style={S.overviewValue}>{totals.invoiceCount}</div>
          </div>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Est. Total</div>
            <div style={S.overviewValue}>{money(totals.estimateTotal)}</div>
          </div>
          <div style={S.overviewCard}>
            <div style={S.overviewLabel}>Invoiced</div>
            <div style={S.overviewValue}>{money(totals.invoiceTotal)}</div>
          </div>
        </div>
        {latestActivityAt ? (
          <div style={{ ...S.meta, marginTop: 8 }}>Latest activity: {fmtDate(latestActivityAt)}</div>
        ) : null}
      </div>

      {/* Estimates */}
      <div style={S.sectionWrap}>
        <div style={S.sectionTitle}>Estimates</div>
        {estimates.length === 0 ? (
          <div style={S.emptyState}>No estimates linked to this project.</div>
        ) : (
          estimates.map((est, i) => {
            const estTotal = est?.approvedTotal ?? est?.total ?? est?.grandTotal ?? 0;
            const estNum = est?.estimateNumber || est?.docNumber || "";
            const estDate = fmtDate(est?.updatedAt || est?.savedAt || est?.createdAt);
            return (
              <button
                key={est?.id || i}
                type="button"
                style={{ ...S.docCard, ...S.docActionCard }}
                onClick={() => onOpenEstimate && onOpenEstimate(est)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={S.docTitle}>{est?.projectName || "Estimate"}</div>
                  <div style={S.docAmount}>{money(estTotal)}</div>
                </div>
                <div style={S.docMeta}>
                  {[estNum ? `#${estNum}` : null, statusLabel(est?.status), estDate].filter(Boolean).join(" · ")}
                </div>
              </button>
            );
          })
        )}
      </div>

      {/* Invoices */}
      <div style={S.sectionWrap}>
        <div style={S.sectionTitle}>Invoices</div>
        {invoices.length === 0 ? (
          <div style={S.emptyState}>No invoices linked to this project.</div>
        ) : (
          invoices.map((inv, i) => {
            const invTotal = inv?.invoiceTotal ?? inv?.total ?? 0;
            const invNum = inv?.invoiceNumber || inv?.docNumber || "";
            const invDate = fmtDate(inv?.updatedAt || inv?.savedAt || inv?.createdAt || inv?.date);
            return (
              <button
                key={inv?.id || i}
                type="button"
                style={{ ...S.docCard, ...S.docActionCard }}
                onClick={() => onOpenInvoice && onOpenInvoice(inv)}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={S.docTitle}>{inv?.customerName || "Invoice"}</div>
                  <div style={S.docAmount}>{money(invTotal)}</div>
                </div>
                <div style={S.docMeta}>
                  {[invNum ? `#${invNum}` : null, invDate].filter(Boolean).join(" · ")}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
