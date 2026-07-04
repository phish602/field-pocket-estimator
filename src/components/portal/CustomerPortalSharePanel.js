import React, { useMemo, useState } from "react";

import PortalStatusChip from "./PortalStatusChip";

const PANEL_COPY = {
  estimate: {
    description: "Share a secure estimate link for approval or requested changes.",
    actions: ["Approve Estimate", "Request Changes"],
  },
  invoice: {
    description: "Share a secure invoice link for customer acknowledgment.",
    actions: ["Acknowledge Invoice"],
  },
};

const styles = {
  card: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    marginTop: 14,
    marginBottom: 4,
  },
  trigger: {
    width: "100%",
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    background: "transparent",
    border: "none",
    color: "inherit",
    textAlign: "left",
    padding: 0,
    cursor: "pointer",
  },
  title: {
    fontSize: 17,
    fontWeight: 700,
    color: "rgba(255,255,255,0.96)",
    marginBottom: 4,
  },
  description: {
    fontSize: 13,
    lineHeight: 1.45,
    color: "rgba(226,232,240,0.72)",
    maxWidth: 520,
  },
  triggerMeta: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-end",
    gap: 8,
    flexShrink: 0,
  },
  triggerHint: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "rgba(148,163,184,0.92)",
  },
  body: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingTop: 2,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(148,163,184,0.78)",
  },
  actionWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  actionPill: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 30,
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(56,189,248,0.22)",
    background: "rgba(56,189,248,0.09)",
    color: "rgba(224,242,254,0.96)",
    fontSize: 12,
    fontWeight: 700,
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 10,
  },
  metaCard: {
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)",
    padding: "11px 12px",
  },
  metaValue: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: 700,
    color: "rgba(255,255,255,0.94)",
  },
  mutedRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 6,
    color: "rgba(226,232,240,0.72)",
    fontSize: 13,
  },
  checkbox: {
    width: 16,
    height: 16,
    accentColor: "rgba(56,189,248,0.92)",
  },
  soonBadge: {
    display: "inline-flex",
    alignItems: "center",
    minHeight: 22,
    padding: "2px 8px",
    borderRadius: 999,
    border: "1px solid rgba(148,163,184,0.2)",
    background: "rgba(148,163,184,0.08)",
    color: "rgba(203,213,225,0.88)",
    fontSize: 10,
    fontWeight: 800,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
  },
  actionButton: {
    width: "100%",
  },
  note: {
    borderRadius: 14,
    border: "1px solid rgba(96,165,250,0.18)",
    background: "rgba(59,130,246,0.08)",
    color: "rgba(219,234,254,0.94)",
    fontSize: 13,
    lineHeight: 1.5,
    padding: "11px 12px",
  },
};

export default function CustomerPortalSharePanel({
  documentType = "estimate",
  status = "unsent",
  defaultExpanded = false,
  expiresInDays = 7,
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const resolvedDocumentType = documentType === "invoice" ? "invoice" : "estimate";
  const copy = useMemo(() => PANEL_COPY[resolvedDocumentType], [resolvedDocumentType]);
  const panelId = `customer-portal-share-panel-${resolvedDocumentType}`;

  return (
    <section className="pe-card" style={styles.card}>
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((current) => !current)}
        style={styles.trigger}
      >
        <div style={{ minWidth: 0 }}>
          <div style={styles.title}>Send to Customer</div>
          <div style={styles.description}>{copy.description}</div>
        </div>
        <div style={styles.triggerMeta}>
          <PortalStatusChip status={status} />
          <span style={styles.triggerHint}>{expanded ? "Hide details" : "View details"}</span>
        </div>
      </button>

      {expanded ? (
        <div id={panelId} style={styles.body}>
          <div>
            <div style={styles.sectionLabel}>Customer actions later</div>
            <div style={styles.actionWrap}>
              {copy.actions.map((label) => (
                <span key={label} style={styles.actionPill}>{label}</span>
              ))}
            </div>
          </div>

          <div style={styles.metaGrid}>
            <div style={styles.metaCard}>
              <div style={styles.sectionLabel}>Link timing</div>
              <div style={styles.metaValue}>Expires in {expiresInDays} days</div>
            </div>

            <div style={styles.metaCard}>
              <div style={styles.sectionLabel}>Comments</div>
              <div style={styles.mutedRow}>
                <input
                  aria-label="Allow customer comments"
                  type="checkbox"
                  disabled
                  style={styles.checkbox}
                />
                <span>Allow customer comments</span>
              </div>
              <div style={{ marginTop: 8 }}>
                <span style={styles.soonBadge}>Coming soon</span>
              </div>
            </div>
          </div>

          <div>
            <button className="pe-btn pe-btn-ghost" type="button" disabled style={styles.actionButton}>
              Copy Secure Link (Coming soon)
            </button>
          </div>

          <div role="note" style={styles.note}>
            Secure customer links will be enabled after the portal backend is connected.
          </div>
        </div>
      ) : null}
    </section>
  );
}
