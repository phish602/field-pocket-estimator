import React, { useReducer } from "react";

const wrapStyle = {
  minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center",
  padding: "32px 16px", boxSizing: "border-box",
};
const cardStyle = {
  width: "100%", maxWidth: 400, display: "grid", gap: 16, padding: "30px 24px",
  borderRadius: 22, border: "1px solid rgba(255,255,255,0.1)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.02))",
};

const COPY = Object.freeze({
  en: Object.freeze({
    checking: ["Checking your business backup", "EstiPaid is confirming that your saved customers, jobs, estimates, invoices, and settings can be recovered safely."],
    review: ["Your business data can be recovered", "This device can no longer open its local copy."],
    recovering: ["Recovering your business data", "Keep EstiPaid open. If your connection drops, recovery will continue safely when you try again."],
    paused: ["Recovery paused", "Your cloud backup was not replaced. Check your connection and try again."],
    blocked: ["Business data could not be recovered safely", "EstiPaid did not open an empty workspace or replace your cloud backup. Try again or sign out."],
    warning: "Changes that never finished syncing from this device may not be recoverable.",
    recover: "Recover business data", retry: "Try again", signOut: "Sign out", language: "Español",
    counts: ["Customers", "Jobs", "Estimates", "Invoices"],
  }),
  es: Object.freeze({
    checking: ["Revisando la copia de seguridad de tu negocio", "EstiPaid está confirmando que tus clientes, trabajos, estimaciones, facturas y configuraciones se puedan recuperar de forma segura."],
    review: ["Los datos de tu negocio se pueden recuperar", "Este dispositivo ya no puede abrir su copia local."],
    recovering: ["Recuperando los datos de tu negocio", "Mantén EstiPaid abierto. Si se pierde la conexión, la recuperación continuará de forma segura cuando vuelvas a intentarlo."],
    paused: ["Recuperación pausada", "Tu copia de seguridad en la nube no fue reemplazada. Revisa tu conexión y vuelve a intentarlo."],
    blocked: ["Los datos del negocio no se pudieron recuperar de forma segura", "EstiPaid no abrió un espacio de trabajo vacío ni reemplazó tu copia de seguridad en la nube. Inténtalo de nuevo o cierra sesión."],
    warning: "Es posible que no se puedan recuperar los cambios de este dispositivo que nunca terminaron de sincronizarse.",
    recover: "Recuperar datos del negocio", retry: "Intentar de nuevo", signOut: "Cerrar sesión", language: "English",
    counts: ["Clientes", "Trabajos", "Estimaciones", "Facturas"],
  }),
});

function initialLanguage() {
  try {
    return String(navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";
  } catch {
    return "en";
  }
}

function safeCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export default function VaultRecoveryGate({
  recovery = Object.freeze({ state: "checking" }),
  onSignOut,
} = {}) {
  const [language, toggleLanguage] = useReducer(
    (value) => value === "en" ? "es" : "en",
    undefined,
    initialLanguage
  );
  const copy = COPY[language];
  const state = ["checking", "review", "recovering", "paused", "blocked"].includes(recovery?.state)
    ? recovery.state
    : "checking";
  const [heading, message] = copy[state];
  const pending = recovery?.pending === true || state === "recovering";
  const retryable = recovery?.retryable === true;
  const primary = state === "review" ? recovery?.confirm : retryable ? recovery?.retry : null;
  const primaryLabel = state === "review" ? copy.recover : copy.retry;
  const counts = recovery?.counts || {};

  return (
    <main style={wrapStyle} aria-label="Business data recovery">
      <section style={cardStyle}>
        <img src="/logo/estipaid.svg" alt="EstiPaid" style={{ height: 60, width: "auto", justifySelf: "center" }} draggable={false} />
        <button type="button" className="pe-btn pe-btn-ghost" onClick={toggleLanguage} aria-label="Change language">
          {copy.language}
        </button>
        <h1 style={{ textAlign: "center", fontSize: 18, margin: 0 }}>{heading}</h1>
        <p role={state === "blocked" ? "alert" : "status"} style={{ textAlign: "center", margin: 0, lineHeight: 1.5 }}>{message}</p>
        {state === "review" ? (
          <>
            <dl style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, margin: 0 }}>
              {copy.counts.map((label, index) => {
                const keys = ["customers", "projects", "estimates", "invoices"];
                return <React.Fragment key={keys[index]}><dt>{label}</dt><dd style={{ margin: 0 }}>{safeCount(counts[keys[index]])}</dd></React.Fragment>;
              })}
            </dl>
            <p style={{ margin: 0, fontSize: 13 }}>{copy.warning}</p>
          </>
        ) : null}
        {primary ? <button type="button" className="pe-btn pe-btn-primary" onClick={primary} disabled={pending}>{primaryLabel}</button> : null}
        {(state === "review" || state === "paused" || state === "blocked") ? (
          <button type="button" className="pe-btn pe-btn-ghost" onClick={onSignOut} disabled={pending}>{copy.signOut}</button>
        ) : null}
      </section>
    </main>
  );
}
