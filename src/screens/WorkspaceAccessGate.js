import React, { useEffect, useReducer, useRef, useState } from "react";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";

// Same rule the sign-in surface applies to provider errors: show a short
// readable sentence, or fall back. It is kept local rather than imported from
// useSupabaseAuth because suites that replace that module with a mock would
// otherwise take this gate down with them.
const UNSAFE_GATE_MESSAGE = new RegExp(
  [
    "PGRST", "SQLSTATE", "postgres", "\\bpg_", "\\brelation\\b", "\\bcolumn\\b",
    "\\bconstraint\\b", "violates", "null value", "duplicate key", "syntax error",
    "TypeError", "ReferenceError", "SyntaxError", "undefined is not", "Cannot read",
    "\\bat\\s+\\w+\\s*\\(", "<[a-z!/]", "^\\s*[[{]",
  ].join("|"),
  "i"
);
const MAX_SAFE_GATE_MESSAGE = 160;

function toSafeGateMessage(message, fallback) {
  const raw = String(message || "").trim();
  if (!raw) return "";
  if (raw.length > MAX_SAFE_GATE_MESSAGE) return fallback;
  if (/[\r\n]/.test(raw)) return fallback;
  if (UNSAFE_GATE_MESSAGE.test(raw)) return fallback;
  return raw;
}

// Bilingual copy follows the in-component pattern used by the other gates
// (see screens/VaultRecoveryGate.js and screens/AuthScreen.js): a frozen COPY
// table plus a memory-only toggle seeded from the browser locale.
const GATE_COPY = Object.freeze({
  en: Object.freeze({
    setupHeading: "Set up your company",
    setupExplainer:
      "Add your company name to start creating estimates, invoices, projects, and customer records.",
    setupStep: "Step 1 of 1 — this is the only thing we need to get you started.",
    companyLabel: "Company name",
    companyPlaceholder: "e.g. Valley Roofing",
    companyHint: "This appears on your estimates, invoices, and PDFs. You can change it later in Settings.",
    companyRequired: "Enter your company name to continue.",
    createWorkspace: "Create My Workspace",
    creating: "Creating your workspace…",
    createFailed: "We couldn’t create your workspace. Please try again.",
    genericError: "Something went wrong. Please try again.",
    preparingHeading: "Setting up your workspace…",
    preparingExplainer: "Preparing your estimates, invoices, customers, and company settings.",
    openingHeading: "Opening your workspace…",
    openingExplainer: "One moment while we get your company ready.",
    accountErrorHeading: "We couldn’t open your workspace",
    accountErrorExplainer:
      "EstiPaid could not confirm which company this account belongs to. Your company records were not opened or changed.",
    activationErrorExplainer:
      "EstiPaid could not open your company workspace on this device. Your company records were not opened or changed. Sign in again to retry.",
    configErrorHeading: "EstiPaid couldn’t start securely",
    configErrorExplainer:
      "We couldn’t verify the account service for this session. Your company records were not opened.",
    tryAgain: "Try Again",
    signOut: "Sign Out",
    langToggle: "Español",
  }),
  es: Object.freeze({
    setupHeading: "Configura tu compañía",
    setupExplainer:
      "Agrega el nombre de tu compañía para comenzar a crear estimaciones, facturas, proyectos y registros de clientes.",
    setupStep: "Paso 1 de 1 — esto es lo único que necesitamos para comenzar.",
    companyLabel: "Nombre de la compañía",
    companyPlaceholder: "ej. Valley Roofing",
    companyHint:
      "Aparecerá en tus estimaciones, facturas y PDFs. Puedes cambiarlo después en Configuración.",
    companyRequired: "Ingresa el nombre de tu compañía para continuar.",
    createWorkspace: "Crear Mi Espacio de Trabajo",
    creating: "Creando tu espacio de trabajo…",
    createFailed: "No pudimos crear tu espacio de trabajo. Inténtalo de nuevo.",
    genericError: "Algo salió mal. Inténtalo de nuevo.",
    preparingHeading: "Configurando tu espacio de trabajo…",
    preparingExplainer: "Preparando tus estimaciones, facturas, clientes y configuraciones.",
    openingHeading: "Abriendo tu espacio de trabajo…",
    openingExplainer: "Un momento mientras preparamos tu compañía.",
    accountErrorHeading: "No pudimos abrir tu espacio de trabajo",
    accountErrorExplainer:
      "EstiPaid no pudo confirmar a qué compañía pertenece esta cuenta. Tus registros no fueron abiertos ni modificados.",
    activationErrorExplainer:
      "EstiPaid no pudo abrir el espacio de trabajo de tu compañía en este dispositivo. Tus registros no fueron abiertos ni modificados. Inicia sesión de nuevo para reintentar.",
    configErrorHeading: "EstiPaid no pudo iniciar de forma segura",
    configErrorExplainer:
      "No pudimos verificar el servicio de cuentas para esta sesión. Tus registros no fueron abiertos.",
    tryAgain: "Intentar de Nuevo",
    signOut: "Cerrar Sesión",
    langToggle: "English",
  }),
});

function initialGateLanguage() {
  try {
    return String(navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";
  } catch {
    return "en";
  }
}

function useGateLanguage() {
  const [language, toggleLanguage] = useReducer(
    (value) => (value === "en" ? "es" : "en"),
    undefined,
    initialGateLanguage
  );
  return [GATE_COPY[language], toggleLanguage];
}

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
  const [validationError, setValidationError] = useState("");
  const [copy, toggleLanguage] = useGateLanguage();
  // Guards a second submit that fires before `bootstrap.creating` has flushed
  // (double tap, Enter + click). The hook stays the single source of truth for
  // company/membership creation -- this only stops a duplicate call reaching it.
  const submittingRef = useRef(false);
  const wasBusyRef = useRef(false);
  const bootstrap = useSupabaseWorkspaceBootstrap({
    configured: Boolean(auth?.configured),
    user: auth?.user,
    hasMembership: Boolean(account?.membership),
    onCreated: account?.refresh,
  });
  const trimmedName = companyName.trim();
  const busy = Boolean(bootstrap.creating);
  // Only an in-flight creation disables submission. Disabling on an empty name
  // would also suppress the browser's implicit Enter submission, so the inline
  // "enter your company name" message could never be reached and the screen
  // would simply do nothing. This matches how AuthScreen validates on submit.
  const disabled = busy;
  // Bootstrap failures can arrive as raw runtime or PostgREST text ("TypeError:
  // Failed to fetch", constraint names, and similar). They go through the same
  // sanitizer the sign-in surface uses, so setup can only ever show a readable
  // sentence -- never backend internals.
  const rawBootstrapError = bootstrap.error;
  const bootstrapError = toSafeGateMessage(rawBootstrapError, copy.createFailed);

  // Release the guard only when an attempt actually finishes: the busy flag
  // falling after it rose, or the hook reporting an error to retry from.
  // Resetting on every render would defeat the guard, because validation state
  // changes re-render between two rapid submits.
  useEffect(() => {
    if (busy) wasBusyRef.current = true;
    else if (wasBusyRef.current) {
      wasBusyRef.current = false;
      submittingRef.current = false;
    }
  }, [busy]);

  useEffect(() => {
    if (bootstrapError) submittingRef.current = false;
  }, [bootstrapError]);

  const submit = (event) => {
    event.preventDefault();
    if (busy || submittingRef.current) return;
    if (!trimmedName) {
      setValidationError(copy.companyRequired);
      return;
    }
    setValidationError("");
    submittingRef.current = true;
    bootstrap.createWorkspace(trimmedName);
  };

  // The form stays mounted while creating so the typed company name survives
  // the transition and is still there if creation fails. Progress is shown
  // inline instead of swapping in a separate screen, which previously
  // discarded the entered value.
  return (
    <GateCard heading={copy.setupHeading} explainer={copy.setupExplainer}>
      <form style={{ display: "grid", gap: 18 }} onSubmit={submit} noValidate>
        <div style={{ ...explainerStyle, fontSize: 12, opacity: 0.75 }}>{copy.setupStep}</div>
        <div style={fieldGroupStyle}>
          <label style={fieldLabelStyle} htmlFor="workspace-company-name">{copy.companyLabel}</label>
          <input
            id="workspace-company-name"
            className="pe-input"
            style={focused ? inputFocusStyle : inputStyle}
            value={companyName}
            onChange={(event) => {
              setCompanyName(event.target.value);
              if (validationError) setValidationError("");
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder={copy.companyPlaceholder}
            aria-label={copy.companyLabel}
            aria-invalid={validationError ? "true" : undefined}
            aria-describedby={validationError ? "workspace-company-name-error" : "workspace-company-name-hint"}
            autoComplete="organization"
            enterKeyHint="go"
            disabled={busy}
          />
          {validationError ? (
            <div id="workspace-company-name-error" role="alert" style={{ ...errorBoxStyle, padding: "6px 0", background: "none", border: "none" }}>
              {validationError}
            </div>
          ) : (
            <div id="workspace-company-name-hint" style={{ fontSize: 11.5, lineHeight: 1.4, color: "rgba(220,229,238,0.55)" }}>
              {copy.companyHint}
            </div>
          )}
        </div>
        <button
          type="submit"
          style={disabled ? primaryButtonDisabledStyle : (hovered ? primaryButtonHoverStyle : primaryButtonStyle)}
          disabled={disabled}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
        >
          {busy ? copy.creating : copy.createWorkspace}
        </button>
        {busy ? (
          <div role="status" aria-live="polite">
            <BrandedProgress />
          </div>
        ) : null}
        {bootstrapError ? <div role="alert" style={errorBoxStyle}>{bootstrapError}</div> : null}
        <div style={{ display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            onClick={toggleLanguage}
            aria-label="Change language"
            style={{
              background: "none",
              border: "none",
              padding: "4px 8px",
              color: "rgba(220,229,238,0.6)",
              fontSize: 11.5,
              fontWeight: 700,
              letterSpacing: "0.4px",
              cursor: "pointer",
              textTransform: "uppercase",
              minHeight: 30,
            }}
          >
            {copy.langToggle}
          </button>
        </div>
      </form>
    </GateCard>
  );
}

// `state` drives which of the five gate screens renders. Every non-ready state
// keeps the dashboard unmounted and the cloud/device workers switched off.
export default function WorkspaceAccessGate({ state, auth, account }) {
  const [copy] = useGateLanguage();

  if (state === "setup") {
    return <WorkspaceSetupForm auth={auth} account={account} />;
  }

  if (state === "activating") {
    return (
      <GateCard heading={copy.preparingHeading} explainer={copy.preparingExplainer}>
        <div role="status" aria-live="polite">
          <BrandedProgress />
        </div>
      </GateCard>
    );
  }

  if (state === "account-error") {
    return (
      <GateCard heading={copy.accountErrorHeading} explainer={copy.accountErrorExplainer}>
        <div style={{ display: "grid", gap: 10 }}>
          <button type="button" style={primaryButtonStyle} onClick={() => account?.refresh?.()}>{copy.tryAgain}</button>
          <button type="button" style={secondaryButtonStyle} onClick={() => auth?.signOut?.()}>{copy.signOut}</button>
        </div>
        {account?.error ? (
          <div role="alert" style={errorBoxStyle}>
            {toSafeGateMessage(account.error, copy.genericError)}
          </div>
        ) : null}
      </GateCard>
    );
  }

  if (state === "activation-error") {
    return (
      <GateCard heading={copy.accountErrorHeading} explainer={copy.activationErrorExplainer}>
        <button type="button" style={secondaryButtonStyle} onClick={() => auth?.signOut?.()}>{copy.signOut}</button>
      </GateCard>
    );
  }

  if (state === "configuration-error") {
    return <GateCard heading={copy.configErrorHeading} explainer={copy.configErrorExplainer}>
      <button type="button" style={primaryButtonStyle} onClick={() => { try { window.location.reload(); } catch {} }}>{copy.tryAgain}</button>
    </GateCard>;
  }

  return (
    <GateCard heading={copy.openingHeading} explainer={copy.openingExplainer}>
      <div role="status" aria-live="polite">
        <BrandedProgress />
      </div>
    </GateCard>
  );
}
