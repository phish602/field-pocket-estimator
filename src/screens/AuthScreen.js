import React, { useState } from "react";

const MODES = {
  SIGN_IN: "signin",
  SIGN_UP: "signup",
  RESET: "reset",
};

const wrapStyle = {
  minHeight: "100dvh",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px 16px",
  boxSizing: "border-box",
};

const cardStyle = {
  width: "100%",
  maxWidth: 400,
  display: "grid",
  gap: 16,
};

const logoWrapStyle = {
  display: "flex",
  justifyContent: "center",
  marginBottom: 4,
};

const titleStyle = {
  textAlign: "center",
  fontSize: 13,
  fontWeight: 800,
  letterSpacing: "2px",
  textTransform: "uppercase",
  opacity: 0.85,
};

const explainerStyle = {
  textAlign: "center",
  fontSize: 13,
  lineHeight: 1.5,
  color: "rgba(220,229,238,0.72)",
  marginTop: -4,
};

const fieldGroupStyle = {
  display: "grid",
  gap: 8,
};

const actionsStyle = {
  display: "grid",
  gap: 8,
  marginTop: 4,
};

const linksRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: 8,
  marginTop: 4,
};

const linkButtonStyle = {
  background: "none",
  border: "none",
  padding: 0,
  color: "rgba(147,197,253,0.92)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "underline",
};

function modeCopy(mode) {
  if (mode === MODES.SIGN_UP) {
    return {
      heading: "Create Your Account",
      primaryLabel: "Create Account",
      busyLabel: "Creating Account...",
    };
  }
  if (mode === MODES.RESET) {
    return {
      heading: "Reset Your Password",
      primaryLabel: "Send Reset Email",
      busyLabel: "Sending...",
    };
  }
  return {
    heading: "Sign In",
    primaryLabel: "Sign In",
    busyLabel: "Signing In...",
  };
}

export default function AuthScreen({ auth }) {
  const {
    authBusy = false,
    errorMessage = "",
    infoMessage = "",
    signInWithPassword,
    signUpWithPassword,
    resetPasswordForEmail,
  } = auth || {};

  const supportsSignUp = typeof signUpWithPassword === "function";
  const supportsReset = typeof resetPasswordForEmail === "function";

  const [mode, setMode] = useState(MODES.SIGN_IN);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const copy = modeCopy(mode);

  const switchMode = (nextMode) => {
    setMode(nextMode);
  };

  const handleSubmit = async (event) => {
    if (event?.preventDefault) event.preventDefault();
    if (authBusy) return;

    if (mode === MODES.SIGN_IN) {
      await signInWithPassword?.(email, password);
      return;
    }
    if (mode === MODES.SIGN_UP && supportsSignUp) {
      await signUpWithPassword(email, password);
      return;
    }
    if (mode === MODES.RESET && supportsReset) {
      await resetPasswordForEmail(email);
    }
  };

  return (
    <div style={wrapStyle}>
      <form className="pe-card pe-card-content" style={cardStyle} onSubmit={handleSubmit}>
        <div style={logoWrapStyle}>
          <img
            src="/logo/estipaid.svg"
            alt="EstiPaid"
            style={{ height: 64, width: "auto", display: "block" }}
            draggable={false}
          />
        </div>
        <div style={titleStyle}>{copy.heading}</div>
        <div style={explainerStyle}>
          Sign in to sync your company, customers, estimates, invoices, templates, and settings.
        </div>

        <div style={fieldGroupStyle}>
          <label className="pe-field-label" htmlFor="auth-email">
            Email
          </label>
          <input
            id="auth-email"
            type="email"
            className="pe-input"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            autoComplete="email"
            aria-label="Email"
            disabled={authBusy}
          />
        </div>

        {mode !== MODES.RESET ? (
          <div style={fieldGroupStyle}>
            <label className="pe-field-label" htmlFor="auth-password">
              Password
            </label>
            <input
              id="auth-password"
              type="password"
              className="pe-input"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
              autoComplete={mode === MODES.SIGN_UP ? "new-password" : "current-password"}
              aria-label="Password"
              disabled={authBusy}
            />
          </div>
        ) : null}

        <div style={actionsStyle}>
          <button type="submit" className="pe-btn" disabled={authBusy}>
            {authBusy ? copy.busyLabel : copy.primaryLabel}
          </button>
        </div>

        {errorMessage ? (
          <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(248,113,113,0.95)" }}>
            {errorMessage}
          </div>
        ) : null}
        {!errorMessage && infoMessage ? (
          <div role="status" aria-live="polite" className="pe-field-helper" style={{ color: "rgba(187,247,208,0.95)" }}>
            {infoMessage}
          </div>
        ) : null}

        <div style={linksRowStyle}>
          {mode === MODES.SIGN_IN ? (
            <>
              {supportsReset ? (
                <button
                  type="button"
                  style={linkButtonStyle}
                  onClick={() => switchMode(MODES.RESET)}
                  disabled={authBusy}
                >
                  Forgot Password?
                </button>
              ) : <span />}
              {supportsSignUp ? (
                <button
                  type="button"
                  style={linkButtonStyle}
                  onClick={() => switchMode(MODES.SIGN_UP)}
                  disabled={authBusy}
                >
                  Create Account
                </button>
              ) : null}
            </>
          ) : (
            <button
              type="button"
              style={linkButtonStyle}
              onClick={() => switchMode(MODES.SIGN_IN)}
              disabled={authBusy}
            >
              Back to Sign In
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
