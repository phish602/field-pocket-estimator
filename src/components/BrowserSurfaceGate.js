import React from "react";

// The contractor-facing gate for a browser tab that is no longer the live
// EstiPaid surface. It is the same branded frame as the other access gates, so
// switching tabs never looks like an error or a crash.
//
// It says what happened in plain words and offers the one action that fixes it.
// Nothing here mentions surfaces, claims, tokens, locks, or storage: the person
// only needs to know EstiPaid is open somewhere else and that this tab can take
// over. Their work is untouched, they stay signed in, and this device keeps its
// place -- so the copy promises exactly that.

const wrapStyle = {
  minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
  padding: "32px 16px", boxSizing: "border-box",
};
const cardStyle = {
  width: "100%", maxWidth: 400, display: "grid", gap: 14, padding: "30px 24px",
  borderRadius: 22, border: "1px solid rgba(255,255,255,0.1)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.02))",
};
const headingStyle = {
  textAlign: "center", fontSize: 13, fontWeight: 800, letterSpacing: "2px", textTransform: "uppercase",
};
const explainerStyle = {
  textAlign: "center", fontSize: 13, lineHeight: 1.5, color: "rgba(220,229,238,0.68)",
};

const CONTENT = Object.freeze({
  checking: [
    "Opening EstiPaid",
    "EstiPaid is getting this tab ready.",
  ],
  inactive: [
    "EstiPaid is active in another tab",
    "Use this tab to continue. The other tab will become inactive.",
  ],
  unavailable: [
    "EstiPaid cannot run in this tab",
    "This browser is not allowing EstiPaid to keep track of which tab is in use. Your work on this device has not been changed.",
  ],
});

export default function BrowserSurfaceGate({ state = "checking", onUseThisTab = null } = {}) {
  const [heading, explainer] = CONTENT[state] || CONTENT.checking;
  return (
    <div style={wrapStyle} aria-label="EstiPaid tab access">
      <section style={cardStyle}>
        <img src="/logo/estipaid.svg" alt="EstiPaid" style={{ height: 60, width: "auto", justifySelf: "center" }} draggable={false} />
        <div style={headingStyle}>{heading}</div>
        <div style={explainerStyle}>{explainer}</div>
        {state === "inactive" && typeof onUseThisTab === "function" ? (
          <button type="button" className="pe-btn" onClick={onUseThisTab}>Use This Tab</button>
        ) : null}
      </section>
    </div>
  );
}
