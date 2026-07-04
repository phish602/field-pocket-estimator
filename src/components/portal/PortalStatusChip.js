import React from "react";

const STATUS_LABELS = {
  unsent: "Not sent",
  staged: "Portal ready soon",
  sent: "Sent to customer",
  viewed: "Viewed",
  approved: "Customer approved",
  rejected: "Changes requested",
  acknowledged: "Acknowledged",
  expired: "Expired",
  revoked: "Revoked",
};

const STATUS_TONES = {
  unsent: {
    background: "rgba(148,163,184,0.14)",
    borderColor: "rgba(148,163,184,0.3)",
    color: "rgba(226,232,240,0.94)",
  },
  staged: {
    background: "rgba(56,189,248,0.14)",
    borderColor: "rgba(56,189,248,0.28)",
    color: "rgba(125,211,252,0.96)",
  },
  sent: {
    background: "rgba(59,130,246,0.14)",
    borderColor: "rgba(59,130,246,0.28)",
    color: "rgba(147,197,253,0.96)",
  },
  viewed: {
    background: "rgba(168,85,247,0.14)",
    borderColor: "rgba(168,85,247,0.28)",
    color: "rgba(216,180,254,0.96)",
  },
  approved: {
    background: "rgba(34,197,94,0.14)",
    borderColor: "rgba(34,197,94,0.28)",
    color: "rgba(187,247,208,0.96)",
  },
  rejected: {
    background: "rgba(245,158,11,0.14)",
    borderColor: "rgba(245,158,11,0.28)",
    color: "rgba(253,230,138,0.96)",
  },
  acknowledged: {
    background: "rgba(20,184,166,0.14)",
    borderColor: "rgba(20,184,166,0.28)",
    color: "rgba(153,246,228,0.96)",
  },
  expired: {
    background: "rgba(244,63,94,0.14)",
    borderColor: "rgba(244,63,94,0.28)",
    color: "rgba(254,205,211,0.96)",
  },
  revoked: {
    background: "rgba(100,116,139,0.16)",
    borderColor: "rgba(100,116,139,0.28)",
    color: "rgba(203,213,225,0.94)",
  },
};

function resolveStatus(status) {
  return Object.prototype.hasOwnProperty.call(STATUS_LABELS, status) ? status : "unsent";
}

export default function PortalStatusChip({ status = "unsent", style = {} }) {
  const resolvedStatus = resolveStatus(status);
  const tone = STATUS_TONES[resolvedStatus];

  return (
    <span
      data-testid="portal-status-chip"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 26,
        padding: "4px 10px",
        borderRadius: 999,
        border: `1px solid ${tone.borderColor}`,
        background: tone.background,
        color: tone.color,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {STATUS_LABELS[resolvedStatus]}
    </span>
  );
}
