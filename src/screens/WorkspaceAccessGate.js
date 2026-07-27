import React, { useState } from "react";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";

// ISO-14D -- the only screens between a signed-in contractor and their
// dashboard. There are no browser-data questions here: a new account simply
// gets its own clean workspace. Copy stays in the contractor's language (no
// storage, backup, database, or developer terminology).

const wrapStyle = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  overflowY: "auto",
  padding: "32px 16px",
  paddingBottom: "max(32px, env(safe-area-inset-bottom, 0px))",
  paddingTop: "max(32px, env(safe-area-inset-top, 0px))",
  boxSizing: "border-box",
};

const cardStyle = {
  width: "100%",
  maxWidth: 400,
  display: "grid",
  gap: 22,
  padding: "30px 24px",
  borderRadius: 22,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.02))",
  boxShadow: "0 24px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};

const brandBlockStyle = { display: "grid", justifyItems: "center", gap: 10 };
const logoWrapStyle = { display: "flex", justifyContent: "center" };
const logoStyle = { height: 60, width: "auto", display: "block" };

const titleStyle = {
  textAlign: "center",
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "2px",
  textTransform: "uppercase",
  opacity: 0.9,
};

const explainerStyle = {
  textAlign: "center",
  fontSize: 13,
  lineHeight: 1.5,
  color: "rgba(220,229,238,0.68)",
  maxWidth: 310,
  margin: "0 auto",
};

const fieldGroupStyle = { display: "grid", gap: 6 };

const fieldLabelStyle = {
  fontSize: 12.5,
  fontWeight: 800,
  letterSpacing: "0.2px",
  color: "rgba(229,238,245,0.72)",
};

const inputStyle = { fontSize: 16, minHeight: 52 };
const inputFocusStyle = {
  ...inputStyle,
  borderColor: "rgba(111,211,186,0.75)",
  boxShadow: "0 0 0 3px rgba(111,211,186,0.18)",
};

const primaryButtonStyle = {
  border: "none",
  borderRadius: 14,
  padding: "14px 16px",
  minHeight: 52,
  fontSize: 14.5,
  fontWeight: 800,
  letterSpacing: "0.2px",
  color: "#04141c",
  background: "linear-gradient(135deg, #6fd3ba 0%, #4d9ab3 55%, #3b78ba 100%)",
  boxShadow: "0 12px 24px rgba(61,140,170,0.32), inset 0 1px 0 rgba(255,255,255,0.35)",
  cursor: "pointer",
  transition: "transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease",
};

const primaryButtonHoverStyle = {
  ...primaryButtonStyle,
  transform: "translateY(-1px)",
  boxShadow: "0 16px 30px rgba(61,140,170,0.42), inset 0 1px 0 rgba(255,255,255,0.4)",
};

const primaryButtonDisabledStyle = {
  ...primaryButtonStyle,
  opacity: 0.6,
  cursor: "not-allowed",
  boxShadow: "none",
};

const secondaryButtonStyle = {
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 14,
  padding: "12px 16px",
  minHeight: 48,
  fontSize: 13.5,
  fontWeight: 700,
  color: "rgba(229,238,245,0.9)",
  background: "rgba(255,255,255,0.04)",
  cursor: "pointer",
  transition: "background 140ms ease, border-color 140ms ease",
};

const messageBoxBaseStyle = {
  borderRadius: 12,
  padding: "10px 12px",
  fontSize: 12.5,
  lineHeight: 1.45,
  borderLeft: "3px solid transparent",
};

const errorBoxStyle = {
  ...messageBoxBaseStyle,
  color: "rgba(252,165,165,0.98)",
  background: "rgba(248,113,113,0.1)",
  borderLeftColor: "rgba(248,113,113,0.75)",
};

const progressDotsStyle = {
  display: "flex",
  gap: 6,
  justifyContent: "center",
  opacity: 0.85,
};

const dotStyle = {
  width: 7,
  height: 7,
  borderRadius: "50%",
  background: "linear-gradient(135deg, #6fd3ba, #3b78ba)",
};

function GateCard({ heading, explainer, children }) {
  return (
    <div style={wrapStyle}>
      <section style={cardStyle}>
        <div style={brandBlockStyle}>
          <div style={logoWrapStyle}>
            <img src="/logo/estipaid.svg" alt="EstiPaid" style={logoStyle} draggable={false} />
          </div>
          <div style={titleStyle}>{heading}</div>
          {explainer ? <div style={explainerStyle}>{explainer}</div> : null}
        </div>
        {children}
      </section>
    </div>
  );
}

function BrandedProgress() {
  return (
    <div style={progressDotsStyle} aria-hidden="true">
      <span style={dotStyle} />
      <span style={{ ...dotStyle, opacity: 0.65 }} />
      <span style={{ ...dotStyle, opacity: 0.35 }} />
    </div>
  );
}

function WorkspaceSetupForm({ auth, account }) {
  const [companyName, setCompanyName] = useState("");
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const bootstrap = useSupabaseWorkspaceBootstrap({
    configured: Boolean(auth?.configured),
    user: auth?.user,
    hasMembership: Boolean(account?.membership),
    onCreated: account?.refresh,
  });
  const trimmedName = companyName.trim();
  const disabled = bootstrap.creating || !trimmedName;

  // Creation and the namespace hand-off share one calm branded state so the
  // contractor never sees a flash of an empty dashboard.
  if (bootstrap.creating) {
    return (
      <GateCard
        heading="Setting up your workspace…"
        explainer="Preparing your estimates, invoices, customers, and company settings."
      >
        <BrandedProgress />
      </GateCard>
    );
  }

  const submit = (event) => {
    event.preventDefault();
    if (disabled) return;
    bootstrap.createWorkspace(trimmedName);
  };

  return (
    <GateCard
      heading="Set up your company"
      explainer="Add your company name to start creating estimates, invoices, projects, and customer records."
    >
      <form style={{ display: "grid", gap: 18 }} onSubmit={submit} noValidate>
        <div style={fieldGroupStyle}>
          <label style={fieldLabelStyle} htmlFor="workspace-company-name">Company name</label>
          <input
            id="workspace-company-name"
            className="pe-input"
            style={focused ? inputFocusStyle : inputStyle}
            value={companyName}
            onChange={(event) => setCompanyName(event.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="e.g. Valley Roofing"
            aria-label="Company name"
            autoComplete="organization"
            enterKeyHint="go"
          />
        </div>
        <button
          type="submit"
          style={disabled ? primaryButtonDisabledStyle : (hovered ? primaryButtonHoverStyle : primaryButtonStyle)}
          disabled={disabled}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          Create My Workspace
        </button>
        {bootstrap.error ? <div role="alert" style={errorBoxStyle}>{bootstrap.error}</div> : null}
      </form>
    </GateCard>
  );
}

// `state` drives which of the five gate screens renders. Every non-ready state
// keeps the dashboard unmounted and the cloud/device workers switched off.
export default function WorkspaceAccessGate({ state, auth, account }) {
  if (state === "setup") {
    return <WorkspaceSetupForm auth={auth} account={account} />;
  }

  if (state === "activating") {
    return (
      <GateCard
        heading="Setting up your workspace…"
        explainer="Preparing your estimates, invoices, customers, and company settings."
      >
        <BrandedProgress />
      </GateCard>
    );
  }

  if (state === "account-error") {
    return (
      <GateCard
        heading="We couldn’t open your workspace"
        explainer="EstiPaid could not confirm which company this account belongs to. Your company records were not opened or changed."
      >
        <div style={{ display: "grid", gap: 10 }}>
          <button type="button" style={primaryButtonStyle} onClick={() => account?.refresh?.()}>Try Again</button>
          <button type="button" style={secondaryButtonStyle} onClick={() => auth?.signOut?.()}>Sign Out</button>
        </div>
        {account?.error ? <div role="alert" style={errorBoxStyle}>{account.error}</div> : null}
      </GateCard>
    );
  }

  if (state === "activation-error") {
    return (
      <GateCard
        heading="We couldn’t open your workspace"
        explainer="EstiPaid could not open your company workspace on this device. Your company records were not opened or changed. Sign in again to retry."
      >
        <button type="button" style={secondaryButtonStyle} onClick={() => auth?.signOut?.()}>Sign Out</button>
      </GateCard>
    );
  }

  if (state === "configuration-error") {
    return <GateCard heading="EstiPaid couldn’t start securely" explainer="We couldn’t verify the account service for this session. Your company records were not opened.">
      <button type="button" style={primaryButtonStyle} onClick={() => { try { window.location.reload(); } catch {} }}>Try Again</button>
    </GateCard>;
  }

  return (
    <GateCard heading="Opening your workspace…" explainer="One moment while we get your company ready.">
      <BrandedProgress />
    </GateCard>
  );
}
