import React from "react";

// ISO-16 -- the secure progress gate shown between a successful unlock and a
// verified authoritative runtime.
//
// It never flashes the normal shell, never flashes an empty workspace, never
// offers a destructive reset, never asks for the EstiPaid login password, never
// promises Local Data Password recovery, and never tells a contractor to clear
// their browser storage.

const wrapStyle = {
  minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
  padding: "32px 16px", boxSizing: "border-box",
};
const cardStyle = {
  width: "100%", maxWidth: 400, display: "grid", gap: 14, padding: "30px 24px",
  borderRadius: 22, border: "1px solid rgba(255,255,255,0.1)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.02))",
};

const CONTENT = Object.freeze({
  checking: [
    "Checking secure local data",
    "EstiPaid is verifying that this workspace can be opened safely.",
  ],
  migrating: [
    "Encrypting local data",
    "EstiPaid is encrypting the data already saved on this device. Keep this window open.",
  ],
  sealing: [
    "Finishing secure setup",
    "EstiPaid is finishing secure setup for this device. Keep this window open.",
  ],
  hydrating: [
    "Opening encrypted local data",
    "EstiPaid is opening your encrypted local data on this device.",
  ],
  "pending-writes": [
    "Saving securely",
    "EstiPaid is finishing a secure local save. Keep this window open.",
  ],
  blocked: [
    "Encrypted local data could not be opened",
    "EstiPaid could not open your encrypted local data safely on this device. Nothing was changed, repaired, or deleted.",
  ],
  disabled: [
    "Checking secure local data",
    "EstiPaid is verifying that this workspace can be opened safely.",
  ],
});

export default function VaultRuntimeGate({ state = "checking" } = {}) {
  const [heading, explainer] = CONTENT[state] || CONTENT.blocked;
  return (
    <div style={wrapStyle} aria-label="Encrypted local data access">
      <section style={cardStyle}>
        <img src="/logo/estipaid.svg" alt="EstiPaid" style={{ height: 60, width: "auto", justifySelf: "center" }} draggable={false} />
        <div style={{ textAlign: "center", fontSize: 13, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase" }}>{heading}</div>
        <div style={{ textAlign: "center", fontSize: 13, lineHeight: 1.5, color: "rgba(220,229,238,0.68)" }}>{explainer}</div>
      </section>
    </div>
  );
}
