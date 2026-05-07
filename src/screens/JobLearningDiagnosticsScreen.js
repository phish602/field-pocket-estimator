// @ts-nocheck
/* eslint-disable */

import React from "react";
import {
  buildJobLearningRegistrySnapshot,
  summarizeJobLearningRegistrySnapshot,
  detectJobLearningRegistryDrift,
  getJobLearningRegistryAuditRows,
} from "../utils/jobLearningRegistrySnapshot";

// Dev/local gate — this screen must never render for production users.
const IS_DEV = process.env.NODE_ENV !== "production";
function isLocal() {
  try {
    const h = window.location.hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "";
  } catch {
    return false;
  }
}
const ACCESSIBLE = IS_DEV || isLocal();

// No registry source wired yet. Using empty fixture per spec.
const CANDIDATES = [];

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function pill(text, color) {
  return (
    <span style={{ ...S.pill, background: color }}>{text}</span>
  );
}

function riskPill(risk) {
  const map = { critical: "#c0392b", high: "#e67e22", moderate: "#8e44ad", low: "#27ae60" };
  return pill(risk || "—", map[risk] || "#555");
}

function statePill(state) {
  const map = {
    approved_candidate: "#27ae60",
    review_ready: "#2980b9",
    needs_review: "#8e44ad",
    quarantined: "#e67e22",
    rejected: "#c0392b",
    runtime_blocked: "#555",
    promotion_ready: "#27ae60",
    not_ready: "#c0392b",
    review_pending: "#8e44ad",
    blocked: "#c0392b",
  };
  return pill(state || "—", map[state] || "#555");
}

// ── Section wrapper ───────────────────────────────────────────────────────────

function Panel({ title, children }) {
  return (
    <div className="pe-card pe-card-content ep-glass-tile ep-section-gap-sm" style={S.panel}>
      {title && <div style={S.panelTitle}>{title}</div>}
      {children}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function ScreenHeader() {
  return (
    <div style={S.header}>
      <div style={S.headerTop}>
        <h1 className="pe-title pe-builder-title" style={S.title}>
          Job Learning Diagnostics
        </h1>
        <span style={S.devBadge}>DEV ONLY</span>
      </div>
      <div className="pe-muted" style={S.subtitle}>
        Read-only registry health and promotion audit.
      </div>
    </div>
  );
}

function NoSourceNotice() {
  return (
    <div style={S.noSourceBanner}>
      <span style={S.noSourceIcon}>⚠</span>
      <span>No registry source wired yet — showing zeroed state. Wire a read-only candidate source to populate this surface.</span>
    </div>
  );
}

function SummaryCards({ summary }) {
  const cards = [
    { label: "Total candidates",   value: summary.totalCandidates },
    { label: "Runtime approved",   value: summary.approvedRuntimeCount },
    { label: "Promotion ready",    value: summary.promotionReadyCount },
    { label: "Blocked runtime",    value: summary.blockedRuntimeCount },
    { label: "Duplicate groups",   value: summary.duplicateGroupCount },
    { label: "Suppressed",         value: summary.suppressedCandidateCount },
    { label: "Overall risk",       value: riskPill(summary.overallRisk) },
  ];
  return (
    <div style={S.summaryGrid}>
      {cards.map(({ label, value }) => (
        <div key={label} className="ep-glass-tile" style={S.summaryCard}>
          <div style={S.summaryValue}>{value ?? 0}</div>
          <div className="pe-muted" style={S.summaryLabel}>{label}</div>
        </div>
      ))}
    </div>
  );
}

function DriftPanel({ drift }) {
  return (
    <Panel title="Registry Drift">
      <div style={S.row}>
        <span className="pe-muted" style={S.fieldLabel}>hasDrift</span>
        {pill(drift.hasDrift ? "true" : "false", drift.hasDrift ? "#c0392b" : "#27ae60")}
      </div>
      {drift.hasDrift && drift.driftReasons.length > 0 ? (
        <ul style={S.list}>
          {drift.driftReasons.map((r) => (
            <li key={r} style={S.listItem}><code style={S.code}>{r}</code></li>
          ))}
        </ul>
      ) : (
        <div className="pe-muted" style={S.empty}>No drift detected.</div>
      )}
    </Panel>
  );
}

function HealthRow({ label, health }) {
  if (!health || typeof health !== "object") {
    return <div className="pe-muted" style={S.empty}>No data.</div>;
  }
  return (
    <div style={S.healthBlock}>
      <div style={S.healthLabel}>{label}</div>
      <div style={S.healthFields}>
        {Object.entries(health).map(([k, v]) => {
          const display = typeof v === "object" ? JSON.stringify(v) : String(v ?? "—");
          return (
            <div key={k} style={S.healthField}>
              <span className="pe-muted" style={S.fieldLabel}>{k}</span>
              <span style={S.fieldValue}>{display}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function HealthPanels({ snapshot }) {
  return (
    <Panel title="Registry Health">
      <HealthRow label="Policy"        health={snapshot.policyHealth} />
      <HealthRow label="Approval"      health={snapshot.approvalHealth} />
      <HealthRow label="Runtime"       health={snapshot.runtimeHealth} />
      <HealthRow label="Promotion"     health={snapshot.promotionHealth} />
      <HealthRow label="Consolidation" health={snapshot.consolidationHealth} />
    </Panel>
  );
}

function RuntimeApprovedPanel({ candidates }) {
  return (
    <Panel title="Runtime-Approved Candidates">
      {!candidates || candidates.length === 0 ? (
        <div className="pe-muted" style={S.empty}>No runtime-approved candidates.</div>
      ) : (
        <div style={S.tableWrap}>
          {candidates.map((c, i) => (
            <div key={c.fingerprint || i} style={S.tableRow}>
              <code style={S.fp}>{c.fingerprint}</code>
              <div style={S.rowMeta}>
                {c.workflowClass && <span className="pe-muted">{c.workflowClass}</span>}
                {c.tradeHint && <span className="pe-muted">{c.tradeHint}</span>}
                <span className="pe-muted">conf: {c.confidence}</span>
                {statePill(c.scoringTier)}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function PromotionRankingPanel({ ranking }) {
  return (
    <Panel title="Promotion Ranking">
      {!ranking || ranking.length === 0 ? (
        <div className="pe-muted" style={S.empty}>No promotion candidates.</div>
      ) : (
        <div style={S.tableWrap}>
          {ranking.map((r, i) => (
            <div key={r.fingerprint || i} style={S.tableRow}>
              <code style={S.fp}>{r.fingerprint}</code>
              <div style={S.rowMeta}>
                {statePill(r.promotionState)}
                {statePill(r.approvalState)}
                <span className="pe-muted">score: {r.promotionScore}</span>
                {r.scoringTier && <span className="pe-muted">{r.scoringTier}</span>}
                {r.workflowClass && <span className="pe-muted">{r.workflowClass}</span>}
                {r.tradeHint && <span className="pe-muted">{r.tradeHint}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function ConsolidationGroupsPanel({ groups }) {
  return (
    <Panel title="Consolidation Groups">
      {!groups || groups.length === 0 ? (
        <div className="pe-muted" style={S.empty}>No consolidation groups.</div>
      ) : (
        <div style={S.tableWrap}>
          {groups.map((g, i) => (
            <div key={g.consolidationKey || i} style={S.tableRow}>
              <div style={S.rowMeta}>
                <span className="pe-muted">key:</span>
                <code style={S.code}>{g.consolidationKey || "—"}</code>
              </div>
              <div style={S.rowMeta}>
                <span className="pe-muted">canonical:</span>
                <code style={S.fp}>{g.canonicalFingerprint || "—"}</code>
              </div>
              <div style={S.rowMeta}>
                <span className="pe-muted">duplicates: {g.duplicateCount ?? 0}</span>
              </div>
              {g.suppressedFingerprints && g.suppressedFingerprints.length > 0 && (
                <div style={S.suppressed}>
                  {g.suppressedFingerprints.map((fp) => (
                    <code key={fp} style={{ ...S.code, opacity: 0.6 }}>{fp}</code>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function AuditRowsPanel({ rows }) {
  return (
    <Panel title="Audit Rows">
      {!rows || rows.length === 0 ? (
        <div className="pe-muted" style={S.empty}>No audit rows.</div>
      ) : (
        <div style={S.tableWrap}>
          {rows.map((r, i) => (
            <div key={r.fingerprint || i} style={S.tableRow}>
              <code style={S.fp}>{r.fingerprint}</code>
              <div style={S.rowMeta}>
                {statePill(r.approvalState)}
                {statePill(r.promotionState)}
                <span className="pe-muted">score: {r.promotionScore}</span>
                {pill(r.runtimeEligible ? "runtime ✓" : "runtime ✗", r.runtimeEligible ? "#27ae60" : "#555")}
                {r.isCanonical && pill("canonical", "#2980b9")}
                {r.isSuppressed && pill("suppressed", "#c0392b")}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  screen: {
    maxWidth: 820,
    margin: "0 auto",
    padding: "24px 16px 80px",
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: { marginBottom: 4 },
  headerTop: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  title: { margin: 0, fontSize: 20 },
  subtitle: { marginTop: 4, fontSize: 13 },
  devBadge: {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.12em",
    padding: "2px 7px",
    borderRadius: 4,
    background: "rgba(192,57,43,0.25)",
    color: "#e74c3c",
    border: "1px solid rgba(231,76,60,0.35)",
    flexShrink: 0,
  },
  noSourceBanner: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "10px 14px",
    borderRadius: 8,
    background: "rgba(230,126,34,0.13)",
    border: "1px solid rgba(230,126,34,0.28)",
    color: "#e67e22",
    fontSize: 12,
    lineHeight: 1.5,
  },
  noSourceIcon: { fontSize: 14, flexShrink: 0, marginTop: 1 },
  summaryGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))",
    gap: 10,
  },
  summaryCard: {
    padding: "12px 14px",
    borderRadius: 10,
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  },
  summaryValue: { fontSize: 22, fontWeight: 700, lineHeight: 1 },
  summaryLabel: { fontSize: 11, fontWeight: 600, letterSpacing: "0.04em" },
  panel: {
    borderRadius: 12,
    padding: "14px 16px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  panelTitle: {
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    opacity: 0.55,
    marginBottom: 2,
  },
  row: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" },
  fieldLabel: { fontSize: 11, minWidth: 100, flexShrink: 0 },
  fieldValue: { fontSize: 12, fontWeight: 600, wordBreak: "break-all" },
  list: { margin: 0, padding: "0 0 0 16px", display: "flex", flexDirection: "column", gap: 4 },
  listItem: { fontSize: 12 },
  code: { fontSize: 11, fontFamily: "monospace", opacity: 0.8 },
  empty: { fontSize: 12, fontStyle: "italic" },
  healthBlock: { display: "flex", flexDirection: "column", gap: 6, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,0.06)" },
  healthLabel: { fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.4, marginBottom: 2 },
  healthFields: { display: "flex", flexDirection: "column", gap: 4 },
  healthField: { display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" },
  tableWrap: { display: "flex", flexDirection: "column", gap: 8 },
  tableRow: {
    padding: "8px 10px",
    borderRadius: 8,
    background: "rgba(255,255,255,0.03)",
    border: "1px solid rgba(255,255,255,0.06)",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  rowMeta: { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" },
  fp: { fontSize: 11, fontFamily: "monospace", opacity: 0.7, wordBreak: "break-all" },
  suppressed: { display: "flex", gap: 6, flexWrap: "wrap", paddingTop: 2 },
  pill: {
    display: "inline-block",
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.05em",
    padding: "2px 7px",
    borderRadius: 20,
    color: "#fff",
    whiteSpace: "nowrap",
  },
  unavailable: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
  },
  unavailableText: { fontSize: 14, opacity: 0.5, fontStyle: "italic" },
};

// ── Default export ────────────────────────────────────────────────────────────

export default function JobLearningDiagnosticsScreen() {
  if (!ACCESSIBLE) {
    return (
      <div style={S.unavailable}>
        <p style={S.unavailableText}>Diagnostics unavailable in this environment.</p>
      </div>
    );
  }

  const snapshot = buildJobLearningRegistrySnapshot(CANDIDATES);
  const summary  = summarizeJobLearningRegistrySnapshot(CANDIDATES);
  const drift    = detectJobLearningRegistryDrift(CANDIDATES);
  const auditRows = getJobLearningRegistryAuditRows(CANDIDATES);

  return (
    <section className="pe-section" style={S.screen}>
      <ScreenHeader />
      <NoSourceNotice />
      <SummaryCards summary={summary} />
      <DriftPanel drift={drift} />
      <HealthPanels snapshot={snapshot} />
      <RuntimeApprovedPanel candidates={snapshot.runtimeApprovedCandidates} />
      <PromotionRankingPanel ranking={snapshot.promotionRanking} />
      <ConsolidationGroupsPanel groups={snapshot.consolidationGroups} />
      <AuditRowsPanel rows={auditRows} />
    </section>
  );
}
