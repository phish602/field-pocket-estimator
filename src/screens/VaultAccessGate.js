import React, { useRef, useState } from "react";

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
const fieldStyle = { display: "grid", gap: 7 };
const labelStyle = { fontSize: 12.5, fontWeight: 800, color: "rgba(229,238,245,0.76)" };
const errorStyle = { borderRadius: 12, padding: "10px 12px", fontSize: 12.5, lineHeight: 1.45, color: "rgba(252,165,165,0.98)", background: "rgba(248,113,113,0.1)", borderLeft: "3px solid rgba(248,113,113,0.75)" };

function GateCard({ heading, explainer, children }) {
  return (
    <main style={wrapStyle} aria-label="Local Data Password access">
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
  return <div aria-label="Opening secure local vault" role="status" style={{ display: "flex", justifyContent: "center", gap: 6 }}><span>●</span><span style={{ opacity: 0.65 }}>●</span><span style={{ opacity: 0.35 }}>●</span></div>;
}

function safeFailureMessage(capability) {
  if (capability?.code === "AUTHENTICATION_FAILED") return "The Local Data Password is incorrect or the local vault is damaged.";
  return "We couldn’t open the local encrypted vault. Please try again.";
}

function PasswordForm({ setup, pending, onSubmit }) {
  const inputRef = useRef(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [validation, setValidation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submit = async (event) => {
    event.preventDefault();
    if (pending || submitting) return;
    if (setup && !acknowledged) {
      setValidation("Please acknowledge the Local Data Password notice before continuing.");
      return;
    }
    const password = String(inputRef.current?.value || "");
    if (inputRef.current) inputRef.current.value = "";
    if (!password) {
      setValidation("Enter a Local Data Password to continue.");
      return;
    }
    setValidation("");
    setSubmitting(true);
    try {
      await onSubmit(password);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <form onSubmit={submit} noValidate style={{ display: "grid", gap: 16 }}>
      {setup ? (
        <label style={{ display: "flex", gap: 9, alignItems: "flex-start", fontSize: 12.5, lineHeight: 1.45, color: "rgba(220,229,238,0.8)" }}>
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>I understand that EstiPaid cannot recover this password and forgetting it requires a destructive local reset that may permanently lose local-only or unsynchronized estimates, invoices, projects, and other data.</span>
        </label>
      ) : null}
      <div style={fieldStyle}>
        <label style={labelStyle} htmlFor={setup ? "vault-setup-password" : "vault-unlock-password"}>Local Data Password</label>
        <input ref={inputRef} id={setup ? "vault-setup-password" : "vault-unlock-password"} className="pe-input" type="password" autoComplete={setup ? "new-password" : "current-password"} disabled={pending || submitting} />
      </div>
      {validation ? <div role="alert" style={errorStyle}>{validation}</div> : null}
      <button type="submit" className="pe-btn" disabled={pending || submitting || (setup && !acknowledged)}>{pending || submitting ? "Opening secure vault…" : (setup ? "Set Local Data Password" : "Unlock Local Data")}</button>
    </form>
  );
}

export default function VaultAccessGate({ capability = { state: "locked" }, checking = false, pending = false, setup, unlock }) {
  const state = String(capability?.state || "locked");
  if (checking || state === "unlocking" || pending) {
    return <GateCard heading="Opening secure local vault" explainer="EstiPaid is checking your encrypted local data."><Progress /></GateCard>;
  }
  if (state === "setup_required") {
    return <GateCard heading="Create a Local Data Password" explainer="This password is separate from your EstiPaid account/login password. There are no recovery codes in this first release, and EstiPaid cannot recover it."><PasswordForm setup pending={pending} onSubmit={setup} /></GateCard>;
  }
  if (state === "damaged") return <GateCard heading="Local vault cannot be opened" explainer="The local encrypted vault is damaged and cannot be opened safely. No data was changed, repaired, or deleted." />;
  if (state === "unsupported") {
    const unsupported = capability?.code === "UNSUPPORTED_KDF_POLICY"
      ? "This device cannot initialize the required Local Data Password protection."
      : "This device does not provide the secure browser features required to open the local vault.";
    return <GateCard heading="Secure local vault unavailable" explainer={unsupported} />;
  }
  if (state === "reset_required") return <GateCard heading="Local reset required" explainer="A local reset is required before the encrypted vault can be used. EstiPaid has not deleted or changed any data." />;
  return (
    <GateCard heading="Unlock your local data" explainer="Enter your Local Data Password. It is not your EstiPaid login password.">
      {capability?.code ? <div role="alert" style={errorStyle}>{safeFailureMessage(capability)}</div> : null}
      <PasswordForm setup={false} pending={pending} onSubmit={unlock} />
    </GateCard>
  );
}
