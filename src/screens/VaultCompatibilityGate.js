import React from "react";

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
  checking: ["Checking secure local data", "EstiPaid is verifying that this workspace can be opened safely."],
  "transition-blocked": ["Secure transition in progress", "Local data cannot be opened safely until the secure transition state is resolved."],
  "other-workspace-transition": ["Another workspace transition is pending", "Local data cannot be opened safely until the secure transition state is resolved."],
  "authoritative-blocked": ["Secure vault state detected", "Local data cannot be opened safely until the secure transition state is resolved."],
  "corrupt-blocked": ["Secure local data could not be verified", "Local data cannot be opened safely until the secure transition state is resolved."],
  "storage-blocked": ["Secure local storage unavailable", "Local data cannot be opened safely until the secure transition state is resolved."],
  disabled: ["Checking secure local data", "EstiPaid is verifying that this workspace can be opened safely."],
});

export default function VaultCompatibilityGate({ state = "checking" } = {}) {
  const [heading, explainer] = CONTENT[state] || CONTENT["corrupt-blocked"];
  return (
    <div style={wrapStyle} aria-label="Local data compatibility access">
      <section style={cardStyle}>
        <img src="/logo/estipaid.svg" alt="EstiPaid" style={{ height: 60, width: "auto", justifySelf: "center" }} draggable={false} />
        <div style={{ textAlign: "center", fontSize: 13, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase" }}>{heading}</div>
        <div style={{ textAlign: "center", fontSize: 13, lineHeight: 1.5, color: "rgba(220,229,238,0.68)" }}>{explainer}</div>
      </section>
    </div>
  );
}
