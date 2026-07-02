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
  overflowY: "auto",
  padding: "32px 16px",
  paddingBottom: "max(32px, env(safe-area-inset-bottom, 0px))",
  paddingTop: "max(32px, env(safe-area-inset-top, 0px))",
  boxSizing: "border-box",
};

const cardStyle = {
  width: "100%",
  maxWidth: 380,
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

const brandBlockStyle = {
  display: "grid",
  justifyItems: "center",
  gap: 10,
};

const logoWrapStyle = {
  display: "flex",
  justifyContent: "center",
};

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
  maxWidth: 300,
  margin: "0 auto",
};

const rememberedBlockStyle = {
  display: "grid",
  gap: 6,
  textAlign: "center",
  padding: "12px 14px",
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.03)",
};

const rememberedLabelStyle = {
  fontSize: 11,
  letterSpacing: "0.6px",
  textTransform: "uppercase",
  opacity: 0.62,
  color: "rgba(220,229,238,0.85)",
};

const rememberedEmailRowStyle = {
  fontSize: 13.5,
  color: "rgba(230,238,245,0.92)",
};

const fieldsBlockStyle = {
  display: "grid",
  gap: 14,
};

const fieldGroupStyle = {
  display: "grid",
  gap: 6,
};

const fieldLabelStyle = {
  fontSize: 12.5,
  fontWeight: 800,
  letterSpacing: "0.2px",
  color: "rgba(229,238,245,0.72)",
};

const primaryButtonStyle = {
  border: "none",
  borderRadius: 14,
  padding: "14px 16px",
  minHeight: 50,
  fontSize: 14.5,
  fontWeight: 800,
  letterSpacing: "0.2px",
  color: "#04141c",
  background: "linear-gradient(135deg, #6fd3ba 0%, #4d9ab3 55%, #3b78ba 100%)",
  boxShadow: "0 12px 24px rgba(61,140,170,0.32), inset 0 1px 0 rgba(255,255,255,0.35)",
  cursor: "pointer",
  transition: "transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease",
};

const primaryButtonDisabledStyle = {
  ...primaryButtonStyle,
  opacity: 0.6,
  cursor: "not-allowed",
  boxShadow: "none",
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

const successBoxStyle = {
  ...messageBoxBaseStyle,
  color: "rgba(190,247,214,0.98)",
  background: "rgba(52,211,153,0.1)",
  borderLeftColor: "rgba(52,211,153,0.75)",
};

const linksRowStyle = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 12,
};

const linkButtonStyle = {
  background: "none",
  border: "none",
  padding: "6px 0",
  color: "rgba(147,197,253,0.92)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "underline",
  minHeight: 32,
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
    rememberedEmail = "",
    clearRememberedAccount,
    signInWithPassword,
    signUpWithPassword,
    resetPasswordForEmail,
  } = auth || {};

  const supportsSignUp = typeof signUpWithPassword === "function";
  const supportsReset = typeof resetPasswordForEmail === "function";

  const [mode, setMode] = useState(MODES.SIGN_IN);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const showRememberedAccount = !errorMessage && !infoMessage && !!rememberedEmail;

  const copy = modeCopy(mode);

  const switchMode = (nextMode) => {
    setMode(nextMode);
  };

  const handleUseDifferentAccount = () => {
    clearRememberedAccount?.();
    setMode(MODES.SIGN_IN);
    setEmail("");
    setPassword("");
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
      <form style={cardStyle} onSubmit={handleSubmit} noValidate>
        <div style={brandBlockStyle}>
          <div style={logoWrapStyle}>
            <img
              src="/logo/estipaid.svg"
              alt="EstiPaid"
              style={{ height: 60, width: "auto", display: "block" }}
              draggable={false}
            />
          </div>
          <div style={titleStyle}>{copy.heading}</div>
          <div style={explainerStyle}>
            Sign in to back up and restore your company, customers, estimates, invoices, templates, and settings.
          </div>
        </div>

        {showRememberedAccount ? (
          <div style={rememberedBlockStyle}>
            <div style={rememberedLabelStyle}>Welcome back</div>
            <div style={rememberedEmailRowStyle}>
              Last used account: <strong>{rememberedEmail}</strong>
            </div>
            {typeof clearRememberedAccount === "function" ? (
              <button
                type="button"
                style={linkButtonStyle}
                onClick={handleUseDifferentAccount}
                disabled={authBusy}
              >
                Use Different Account
              </button>
            ) : null}
          </div>
        ) : null}

        <div style={fieldsBlockStyle}>
          <div style={fieldGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              className="pe-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="email"
              spellCheck={false}
              enterKeyHint={mode === MODES.RESET ? "send" : "next"}
              aria-label="Email"
              disabled={authBusy}
            />
          </div>

          {mode !== MODES.RESET ? (
            <div style={fieldGroupStyle}>
              <label style={fieldLabelStyle} htmlFor="auth-password">
                Password
              </label>
              <input
                id="auth-password"
                type="password"
                className="pe-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                name="password"
                autoComplete={mode === MODES.SIGN_UP ? "new-password" : "current-password"}
                enterKeyHint="go"
                aria-label="Password"
                disabled={authBusy}
              />
            </div>
          ) : null}
        </div>

        <button
          type="submit"
          style={authBusy ? primaryButtonDisabledStyle : primaryButtonStyle}
          disabled={authBusy}
        >
          {authBusy ? copy.busyLabel : copy.primaryLabel}
        </button>

        {errorMessage ? (
          <div role="status" aria-live="polite" style={errorBoxStyle}>
            {errorMessage}
          </div>
        ) : null}
        {!errorMessage && infoMessage ? (
          <div role="status" aria-live="polite" style={successBoxStyle}>
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
