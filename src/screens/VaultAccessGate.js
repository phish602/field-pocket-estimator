import React from "react";

const wrapStyle = {
  minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
  overflowY: "auto", padding: "32px 16px", boxSizing: "border-box",
};
const cardStyle = {
  width: "100%", maxWidth: 400, display: "grid", gap: 22, padding: "30px 24px", borderRadius: 22,
  border: "1px solid rgba(255,255,255,0.1)", background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.02))",
  boxShadow: "0 24px 60px rgba(0,0,0,0.4)", backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
};
const titleStyle = { textAlign: "center", fontSize: 13, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase", opacity: 0.9 };
const explainerStyle = { textAlign: "center", fontSize: 13, lineHeight: 1.55, color: "rgba(220,229,238,0.72)", margin: 0 };
const errorStyle = { borderRadius: 12, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.45, color: "rgba(252,165,165,0.98)", background: "rgba(248,113,113,0.1)", borderLeft: "3px solid rgba(248,113,113,0.75)" };

function GateCard({ heading, explainer, children }) {
  return (
    <main style={wrapStyle} aria-label="Secure local data access">
      <section style={cardStyle}>
        <div style={{ display: "grid", justifyItems: "center", gap: 10 }}>
          <img src="/logo/estipaid.svg" alt="EstiPaid" style={{ height: 60, width: "auto" }} draggable={false} />
          <div style={titleStyle}>{heading}</div>
          {explainer ? <p style={explainerStyle}>{explainer}</p> : null}
        </div>
        {children}
      </section>
    </main>
  );
}

function Progress() {
  return (
    <div aria-label="Opening secure local vault" role="status" style={{ display: "flex", justifyContent: "center", gap: 6 }}>
      <span>●</span><span style={{ opacity: 0.65 }}>●</span><span style={{ opacity: 0.35 }}>●</span>
    </div>
  );
}

export default function VaultAccessGate({
  capability = { state: "locked" },
  checking = false,
  pending = false,
  refresh,
}) {
  const state = String(capability?.state || "locked");

  if (checking || state === "unlocking" || state === "setup_required" || pending) {
    return (
      <GateCard
        heading="Protecting local data"
        explainer="EstiPaid is preparing this device’s encrypted local vault. No additional password is required."
      >
        <Progress />
      </GateCard>
    );
  }

  if (state === "damaged") {
    return (
      <GateCard
        heading="Local vault cannot be opened"
        explainer="The local encrypted vault is damaged and cannot be opened safely. No data was changed, repaired, or deleted."
      />
    );
  }

  if (state === "unsupported") {
    return (
      <GateCard
        heading="Secure local vault unavailable"
        explainer="This device does not provide the secure browser storage required to protect local EstiPaid data."
      />
    );
  }

  if (state === "reset_required") {
    return (
      <GateCard
        heading="Local recovery required"
        explainer="This device’s secure key is no longer available. Cloud-synced data remains recoverable, but local-only unsynchronized data cannot be opened with a replacement key."
      />
    );
  }

  return (
    <GateCard
      heading="Local vault locked"
      explainer="Your encrypted local data is locked on this device. Continue to reopen it with this device’s secure key."
    >
      {capability?.code ? <div role="alert" style={errorStyle}>We couldn’t open the local encrypted vault. Please try again.</div> : null}
      <button type="button" className="pe-btn" onClick={() => refresh?.()} disabled={pending}>
        {pending ? "Opening secure vault…" : "Continue to EstiPaid"}
      </button>
    </GateCard>
  );
}
