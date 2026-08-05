import React, { useMemo, useReducer, useState } from "react";

const MODES = {
  SIGN_IN: "signin",
  MAGIC_LINK: "magiclink",
  SIGN_UP: "signup",
  RESET: "reset",
};

// Mirrors MIN_PASSWORD_LENGTH in lib/useSupabaseAuth.js. Kept local so this
// screen stays renderable from an injected `auth` prop in tests.
const MIN_PASSWORD_LENGTH = 6;

// Deliberately permissive: the provider is the authority on deliverability.
// This only catches obvious typos before a pointless network round trip.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  gap: 20,
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

// The password field and its reveal control share one rounded shell so the
// toggle reads as part of the input rather than a floating button.
const passwordWrapStyle = {
  position: "relative",
  display: "block",
};

const passwordInputStyle = {
  paddingRight: 74,
  width: "100%",
  boxSizing: "border-box",
};

const revealButtonStyle = {
  position: "absolute",
  top: "50%",
  right: 8,
  transform: "translateY(-50%)",
  background: "rgba(255,255,255,0.06)",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 9,
  color: "rgba(226,236,245,0.86)",
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: "0.4px",
  textTransform: "uppercase",
  padding: "0 10px",
  height: 30,
  minWidth: 54,
  cursor: "pointer",
};

// PRIMARY -- the one action the screen wants most people to take.
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

// SECONDARY -- account creation. Outlined so it never competes with the
// primary gradient, but still a full-width, obviously tappable control.
const secondaryButtonStyle = {
  border: "1px solid rgba(255,255,255,0.16)",
  borderRadius: 14,
  padding: "12px 16px",
  minHeight: 46,
  fontSize: 13.5,
  fontWeight: 700,
  letterSpacing: "0.2px",
  color: "rgba(233,240,247,0.94)",
  background: "rgba(255,255,255,0.045)",
  cursor: "pointer",
  width: "100%",
};

const secondaryButtonDisabledStyle = {
  ...secondaryButtonStyle,
  opacity: 0.55,
  cursor: "not-allowed",
};

const secondaryBlockStyle = {
  display: "grid",
  gap: 8,
  justifyItems: "center",
};

const secondaryHintStyle = {
  fontSize: 12,
  color: "rgba(220,229,238,0.6)",
};

const dividerStyle = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  color: "rgba(220,229,238,0.5)",
  fontSize: 11.5,
  fontWeight: 700,
  letterSpacing: "0.8px",
  textTransform: "uppercase",
};

const dividerRuleStyle = {
  flex: 1,
  height: 1,
  background: "rgba(255,255,255,0.12)",
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

const fieldErrorStyle = {
  fontSize: 11.5,
  lineHeight: 1.4,
  color: "rgba(252,165,165,0.95)",
};

// Phase 2.2 -- social provider buttons. Provider artwork is local-only metadata:
// no external icon, script, font, or provider credential reaches the DOM.
const socialBlockStyle = {
  display: "grid",
  gap: 10,
};

const socialButtonStyle = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 10,
  border: "1px solid rgba(255,255,255,0.14)",
  borderRadius: 14,
  padding: "13px 16px",
  minHeight: 48,
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: "0.2px",
  color: "rgba(233,240,247,0.94)",
  background: "rgba(255,255,255,0.045)",
  cursor: "pointer",
  transition: "background 140ms ease, opacity 140ms ease",
};

const socialIconStyle = {
  width: 20,
  height: 20,
  flex: "0 0 auto",
  objectFit: "contain",
};

const socialButtonDisabledStyle = {
  ...socialButtonStyle,
  opacity: 0.55,
  cursor: "not-allowed",
};

// TERTIARY -- recovery routes. Small, centred, visually quietest tier.
// The two recovery routes sit on one wrapping row with no separator glyph:
// longer Spanish labels wrap at mobile width, and a separator would be left
// stranded at the end of the first line. The gap carries the separation.
const tertiaryRowStyle = {
  display: "flex",
  justifyContent: "center",
  alignItems: "center",
  flexWrap: "wrap",
  gap: 16,
};

const linkButtonStyle = {
  background: "none",
  border: "none",
  padding: "6px 2px",
  color: "rgba(147,197,253,0.92)",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
  textDecoration: "underline",
  minHeight: 32,
};

const langRowStyle = {
  display: "flex",
  justifyContent: "center",
};

const langButtonStyle = {
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
};

// Bilingual copy follows the established in-component pattern used by the
// newer gates (see screens/VaultRecoveryGate.js): a frozen COPY table plus a
// memory-only language toggle seeded from the browser locale.
const COPY = Object.freeze({
  en: Object.freeze({
    signInHeading: "Sign In",
    signUpHeading: "Create Your Account",
    magicHeading: "Email Sign-In Link",
    resetHeading: "Reset Your Password",
    signInPrimary: "Sign In",
    signInBusy: "Signing In...",
    signUpPrimary: "Create Account",
    signUpBusy: "Creating Account...",
    magicPrimary: "Send Sign-In Link",
    magicBusy: "Sending...",
    resetPrimary: "Send Reset Email",
    resetBusy: "Sending...",
    signInExplainer:
      "Sign in to back up and restore your company, customers, estimates, invoices, templates, and settings.",
    signUpExplainer: "Create an EstiPaid account to back up your work and restore it on any device.",
    magicExplainer: "We’ll email a secure sign-in link to this address. No password needed.",
    resetExplainer: "Enter your email and we’ll send a link to choose a new password.",
    emailLabel: "Email",
    emailPlaceholder: "name@company.com",
    passwordLabel: "Password",
    passwordPlaceholder: "Enter your password",
    newPasswordLabel: "New Password",
    confirmPasswordLabel: "Confirm New Password",
    confirmPasswordPlaceholder: "Re-enter your new password",
    show: "Show",
    hide: "Hide",
    showPasswordAria: "Show password",
    hidePasswordAria: "Hide password",
    or: "or",
    newHere: "New to EstiPaid?",
    createAccount: "Create Account",
    // Labels kept verbatim: hierarchy is expressed through placement and
    // styling, not by relabelling actions contractors already recognise.
    magicLink: "Email Me a Sign-In Link",
    forgotPassword: "Forgot Password?",
    backToSignIn: "Back to Sign In",
    welcomeBack: "Welcome back",
    lastUsed: "Last used account:",
    useDifferent: "Use Different Account",
    passwordRules: `At least ${MIN_PASSWORD_LENGTH} characters`,
    emailRequired: "Enter your email address.",
    emailInvalid: "Enter a valid email address.",
    passwordRequired: "Enter your password.",
    passwordTooShort: `Use at least ${MIN_PASSWORD_LENGTH} characters.`,
    bothPasswordsRequired: "Enter and confirm your new password.",
    passwordsMustMatch: "Both passwords must match.",
    recoveryUpdatedTitle: "Password Updated",
    recoveryReadyTitle: "Set A New Password",
    recoveryInvalidTitle: "Reset Link Not Valid",
    recoveryUpdatedBody: "Your password has been updated. Continue to pick up where you left off.",
    recoveryReadyBody: "Choose a new password to finish resetting your account.",
    recoveryInvalidBody:
      "This password reset link is invalid or has expired. Request a new reset email from the sign-in screen.",
    recoveryUpdated: "Password updated.",
    continueToApp: "Continue to EstiPaid",
    updatePassword: "Update Password",
    updatingPassword: "Updating Password...",
    langToggle: "Español",
  }),
  es: Object.freeze({
    signInHeading: "Iniciar Sesión",
    signUpHeading: "Crea Tu Cuenta",
    magicHeading: "Enlace de Acceso por Correo",
    resetHeading: "Restablecer Tu Contraseña",
    signInPrimary: "Iniciar Sesión",
    signInBusy: "Iniciando sesión...",
    signUpPrimary: "Crear Cuenta",
    signUpBusy: "Creando cuenta...",
    magicPrimary: "Enviar Enlace de Acceso",
    magicBusy: "Enviando...",
    resetPrimary: "Enviar Correo de Restablecimiento",
    resetBusy: "Enviando...",
    signInExplainer:
      "Inicia sesión para respaldar y restaurar tu compañía, clientes, estimaciones, facturas, plantillas y configuraciones.",
    signUpExplainer:
      "Crea una cuenta de EstiPaid para respaldar tu trabajo y restaurarlo en cualquier dispositivo.",
    magicExplainer:
      "Te enviaremos un enlace de acceso seguro a este correo. No necesitas contraseña.",
    resetExplainer:
      "Ingresa tu correo y te enviaremos un enlace para elegir una nueva contraseña.",
    emailLabel: "Correo electrónico",
    emailPlaceholder: "nombre@compañia.com",
    passwordLabel: "Contraseña",
    passwordPlaceholder: "Ingresa tu contraseña",
    newPasswordLabel: "Nueva contraseña",
    confirmPasswordLabel: "Confirmar nueva contraseña",
    confirmPasswordPlaceholder: "Vuelve a ingresar tu nueva contraseña",
    show: "Mostrar",
    hide: "Ocultar",
    showPasswordAria: "Mostrar contraseña",
    hidePasswordAria: "Ocultar contraseña",
    or: "o",
    newHere: "¿Nuevo en EstiPaid?",
    createAccount: "Crear Cuenta",
    magicLink: "Envíame un enlace de acceso",
    forgotPassword: "¿Olvidaste tu contraseña?",
    backToSignIn: "Volver a Iniciar Sesión",
    welcomeBack: "Bienvenido de nuevo",
    lastUsed: "Última cuenta usada:",
    useDifferent: "Usar Otra Cuenta",
    passwordRules: `Al menos ${MIN_PASSWORD_LENGTH} caracteres`,
    emailRequired: "Ingresa tu correo electrónico.",
    emailInvalid: "Ingresa un correo electrónico válido.",
    passwordRequired: "Ingresa tu contraseña.",
    passwordTooShort: `Usa al menos ${MIN_PASSWORD_LENGTH} caracteres.`,
    bothPasswordsRequired: "Ingresa y confirma tu nueva contraseña.",
    passwordsMustMatch: "Ambas contraseñas deben coincidir.",
    recoveryUpdatedTitle: "Contraseña Actualizada",
    recoveryReadyTitle: "Elige Una Nueva Contraseña",
    recoveryInvalidTitle: "Enlace No Válido",
    recoveryUpdatedBody:
      "Tu contraseña fue actualizada. Continúa donde lo dejaste.",
    recoveryReadyBody: "Elige una nueva contraseña para terminar de restablecer tu cuenta.",
    recoveryInvalidBody:
      "Este enlace de restablecimiento no es válido o ya expiró. Solicita un nuevo correo desde la pantalla de inicio de sesión.",
    recoveryUpdated: "Contraseña actualizada.",
    continueToApp: "Continuar a EstiPaid",
    updatePassword: "Actualizar Contraseña",
    updatingPassword: "Actualizando contraseña...",
    langToggle: "English",
  }),
});

function initialLanguage() {
  try {
    return String(navigator.language || "").toLowerCase().startsWith("es") ? "es" : "en";
  } catch {
    return "en";
  }
}

function modeCopy(mode, copy) {
  if (mode === MODES.MAGIC_LINK) {
    return {
      heading: copy.magicHeading,
      explainer: copy.magicExplainer,
      primaryLabel: copy.magicPrimary,
      busyLabel: copy.magicBusy,
    };
  }
  if (mode === MODES.SIGN_UP) {
    return {
      heading: copy.signUpHeading,
      explainer: copy.signUpExplainer,
      primaryLabel: copy.signUpPrimary,
      busyLabel: copy.signUpBusy,
    };
  }
  if (mode === MODES.RESET) {
    return {
      heading: copy.resetHeading,
      explainer: copy.resetExplainer,
      primaryLabel: copy.resetPrimary,
      busyLabel: copy.resetBusy,
    };
  }
  return {
    heading: copy.signInHeading,
    explainer: copy.signInExplainer,
    primaryLabel: copy.signInPrimary,
    busyLabel: copy.signInBusy,
  };
}

export default function AuthScreen({ auth }) {
  const {
    authBusy = false,
    errorMessage = "",
    infoMessage = "",
    rememberedEmail = "",
    clearRememberedAccount,
    clearAuthMessages,
    signInWithEmailOtp,
    signInWithPassword,
    signUpWithPassword,
    resetPasswordForEmail,
    enabledSocialProviders = [],
    signInWithSocialProvider,
    passwordRecoveryPending = false,
    passwordRecoveryReady = false,
    passwordRecoveryComplete = false,
    updatePassword,
    completePasswordRecovery,
    abandonPasswordRecovery,
  } = auth || {};

  const supportsSignUp = typeof signUpWithPassword === "function";
  const supportsReset = typeof resetPasswordForEmail === "function";
  const supportsMagicLink = typeof signInWithEmailOtp === "function";

  const [language, toggleLanguage] = useReducer(
    (value) => (value === "en" ? "es" : "en"),
    undefined,
    initialLanguage
  );
  const copy = COPY[language];

  const [mode, setMode] = useState(MODES.SIGN_IN);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [fieldErrors, setFieldErrors] = useState({});
  const [recoveryValidationError, setRecoveryValidationError] = useState("");
  // "Welcome back -- last used account" helps someone returning to sign in, get
  // a link, or reset a password. It contradicts the create-account view, which
  // is for a brand new account, so it is withheld there.
  const showRememberedAccount =
    mode !== MODES.SIGN_UP && !errorMessage && !infoMessage && !!rememberedEmail;

  // Social providers belong to the normal SIGN-IN view only. The recovery views
  // return earlier, so no recovery screen can ever render a provider button.
  const socialProviders = Array.isArray(enabledSocialProviders) ? enabledSocialProviders : [];
  const showSocialProviders = mode === MODES.SIGN_IN && socialProviders.length > 0;

  const view = useMemo(() => modeCopy(mode, copy), [mode, copy]);
  const needsPassword = mode === MODES.SIGN_IN || mode === MODES.SIGN_UP;

  // Every check runs before `updatePassword`, so an invalid submission never
  // reaches the Supabase client.
  const handleRecoverySubmit = async (event) => {
    if (event?.preventDefault) event.preventDefault();
    if (authBusy) return;

    const nextPassword = String(newPassword || "");
    const nextConfirm = String(confirmPassword || "");

    if (!nextPassword || !nextConfirm) {
      setRecoveryValidationError(copy.bothPasswordsRequired);
      return;
    }
    if (nextPassword.length < MIN_PASSWORD_LENGTH) {
      setRecoveryValidationError(copy.passwordTooShort);
      return;
    }
    if (nextPassword !== nextConfirm) {
      setRecoveryValidationError(copy.passwordsMustMatch);
      return;
    }

    setRecoveryValidationError("");
    await updatePassword?.(nextPassword);
  };

  // A message raised in one mode describes an action taken there, so it is
  // dropped on the way out instead of following the person into a view where it
  // no longer makes sense.
  const switchMode = (nextMode) => {
    setMode(nextMode);
    setFieldErrors({});
    setShowPassword(false);
    clearAuthMessages?.();
  };

  const handleUseDifferentAccount = () => {
    clearRememberedAccount?.();
    setMode(MODES.SIGN_IN);
    setEmail("");
    setPassword("");
    setFieldErrors({});
  };

  // Local validation runs first so an obviously incomplete submission never
  // becomes a network round trip or a provider-shaped error message.
  const validate = () => {
    const next = {};
    const trimmedEmail = String(email || "").trim();
    if (!trimmedEmail) next.email = copy.emailRequired;
    else if (!EMAIL_SHAPE.test(trimmedEmail)) next.email = copy.emailInvalid;

    if (needsPassword) {
      const value = String(password || "");
      if (!value) next.password = copy.passwordRequired;
      else if (mode === MODES.SIGN_UP && value.length < MIN_PASSWORD_LENGTH) {
        next.password = copy.passwordTooShort;
      }
    }
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (event) => {
    if (event?.preventDefault) event.preventDefault();
    if (authBusy) return;
    if (!validate()) return;

    if (mode === MODES.SIGN_IN) {
      await signInWithPassword?.(email, password);
      return;
    }
    if (mode === MODES.MAGIC_LINK && supportsMagicLink) {
      await signInWithEmailOtp(email);
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

  const languageToggle = (
    <div style={langRowStyle}>
      <button
        type="button"
        style={langButtonStyle}
        onClick={toggleLanguage}
        aria-label="Change language"
      >
        {copy.langToggle}
      </button>
    </div>
  );

  // A password-recovery session must finish recovery before anything else. The
  // app routes here even though a session already exists.
  if (passwordRecoveryPending) {
    return (
      <div style={wrapStyle}>
        <form style={cardStyle} onSubmit={handleRecoverySubmit} noValidate>
          <div style={brandBlockStyle}>
            <div style={logoWrapStyle}>
              <img
                src="/logo/estipaid.svg"
                alt="EstiPaid"
                style={{ height: 60, width: "auto", display: "block" }}
                draggable={false}
              />
            </div>
            <div style={titleStyle}>
              {passwordRecoveryComplete
                ? copy.recoveryUpdatedTitle
                : passwordRecoveryReady
                  ? copy.recoveryReadyTitle
                  : copy.recoveryInvalidTitle}
            </div>
            <div style={explainerStyle}>
              {passwordRecoveryComplete
                ? copy.recoveryUpdatedBody
                : passwordRecoveryReady
                  ? copy.recoveryReadyBody
                  : copy.recoveryInvalidBody}
            </div>
          </div>

          {/* Recovery intent without a VERIFIED recovery session must never show
              an actionable update form -- only a way back to sign in. */}
          {!passwordRecoveryComplete && !passwordRecoveryReady ? (
            <>
              {/* The explainer above already states the invalid/expired case,
                  so only surface a distinct provider error here. */}
              {errorMessage ? (
                <div role="alert" style={errorBoxStyle}>
                  {errorMessage}
                </div>
              ) : null}
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => abandonPasswordRecovery?.()}
                disabled={authBusy}
              >
                {copy.backToSignIn}
              </button>
            </>
          ) : passwordRecoveryComplete ? (
            <>
              <div role="status" aria-live="polite" style={successBoxStyle}>
                {copy.recoveryUpdated}
              </div>
              <button
                type="button"
                style={primaryButtonStyle}
                onClick={() => completePasswordRecovery?.()}
              >
                {copy.continueToApp}
              </button>
            </>
          ) : (
            <>
              <div style={fieldsBlockStyle}>
                <div style={fieldGroupStyle}>
                  <label style={fieldLabelStyle} htmlFor="auth-new-password">
                    {copy.newPasswordLabel}
                  </label>
                  <span style={passwordWrapStyle}>
                    <input
                      id="auth-new-password"
                      type={showNewPassword ? "text" : "password"}
                      className="pe-input"
                      style={passwordInputStyle}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder={copy.passwordRules}
                      name="new-password"
                      autoComplete="new-password"
                      enterKeyHint="next"
                      aria-label={copy.newPasswordLabel}
                      disabled={authBusy}
                    />
                    <button
                      type="button"
                      style={revealButtonStyle}
                      onClick={() => setShowNewPassword((v) => !v)}
                      aria-label={showNewPassword ? copy.hidePasswordAria : copy.showPasswordAria}
                      aria-pressed={showNewPassword}
                      tabIndex={-1}
                    >
                      {showNewPassword ? copy.hide : copy.show}
                    </button>
                  </span>
                </div>

                <div style={fieldGroupStyle}>
                  <label style={fieldLabelStyle} htmlFor="auth-confirm-password">
                    {copy.confirmPasswordLabel}
                  </label>
                  <input
                    id="auth-confirm-password"
                    type={showNewPassword ? "text" : "password"}
                    className="pe-input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder={copy.confirmPasswordPlaceholder}
                    name="confirm-password"
                    autoComplete="new-password"
                    enterKeyHint="go"
                    aria-label={copy.confirmPasswordLabel}
                    disabled={authBusy}
                  />
                </div>
              </div>

              <button
                type="submit"
                style={authBusy ? primaryButtonDisabledStyle : primaryButtonStyle}
                disabled={authBusy}
              >
                {authBusy ? copy.updatingPassword : copy.updatePassword}
              </button>

              {recoveryValidationError || errorMessage ? (
                <div role="alert" style={errorBoxStyle}>
                  {recoveryValidationError || errorMessage}
                </div>
              ) : null}
            </>
          )}
          {languageToggle}
        </form>
      </div>
    );
  }

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
          <div style={titleStyle}>{view.heading}</div>
          <div style={explainerStyle}>{view.explainer}</div>
        </div>

        {showRememberedAccount ? (
          <div style={rememberedBlockStyle}>
            <div style={rememberedLabelStyle}>{copy.welcomeBack}</div>
            <div style={rememberedEmailRowStyle}>
              {copy.lastUsed} <strong>{rememberedEmail}</strong>
            </div>
            {typeof clearRememberedAccount === "function" ? (
              <button
                type="button"
                style={linkButtonStyle}
                onClick={handleUseDifferentAccount}
                disabled={authBusy}
              >
                {copy.useDifferent}
              </button>
            ) : null}
          </div>
        ) : null}

        {/* Rendered dynamically from the registry -- no hardcoded provider
            branch, so a new registry entry surfaces here automatically. When
            zero providers are configured this whole block (and its divider)
            is omitted and the layout stays coherent. */}
        {showSocialProviders ? (
          <>
            <div style={socialBlockStyle}>
              {socialProviders.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  style={authBusy ? socialButtonDisabledStyle : socialButtonStyle}
                  onClick={() => signInWithSocialProvider?.(provider.id)}
                  disabled={authBusy}
                  aria-label={provider.label}
                >
                  {provider.iconPath ? (
                    <img src={provider.iconPath} alt="" aria-hidden="true" style={socialIconStyle} />
                  ) : null}
                  {provider.label}
                </button>
              ))}
            </div>
            <div style={dividerStyle} aria-hidden="true">
              <span style={dividerRuleStyle} />
              <span>{copy.or}</span>
              <span style={dividerRuleStyle} />
            </div>
          </>
        ) : null}

        <div style={fieldsBlockStyle}>
          <div style={fieldGroupStyle}>
            <label style={fieldLabelStyle} htmlFor="auth-email">
              {copy.emailLabel}
            </label>
            <input
              id="auth-email"
              type="email"
              className="pe-input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={copy.emailPlaceholder}
              name="email"
              autoComplete="email"
              autoCapitalize="none"
              autoCorrect="off"
              inputMode="email"
              spellCheck={false}
              enterKeyHint={mode === MODES.RESET || mode === MODES.MAGIC_LINK ? "send" : "next"}
              aria-label={copy.emailLabel}
              aria-invalid={fieldErrors.email ? "true" : undefined}
              aria-describedby={fieldErrors.email ? "auth-email-error" : undefined}
              disabled={authBusy}
            />
            {fieldErrors.email ? (
              <div id="auth-email-error" role="alert" style={fieldErrorStyle}>
                {fieldErrors.email}
              </div>
            ) : null}
          </div>

          {needsPassword ? (
            <div style={fieldGroupStyle}>
              <label style={fieldLabelStyle} htmlFor="auth-password">
                {copy.passwordLabel}
              </label>
              <span style={passwordWrapStyle}>
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  className="pe-input"
                  style={passwordInputStyle}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    mode === MODES.SIGN_UP ? copy.passwordRules : copy.passwordPlaceholder
                  }
                  name="password"
                  autoComplete={mode === MODES.SIGN_UP ? "new-password" : "current-password"}
                  enterKeyHint="go"
                  aria-label={copy.passwordLabel}
                  aria-invalid={fieldErrors.password ? "true" : undefined}
                  aria-describedby={fieldErrors.password ? "auth-password-error" : undefined}
                  disabled={authBusy}
                />
                <button
                  type="button"
                  style={revealButtonStyle}
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? copy.hidePasswordAria : copy.showPasswordAria}
                  aria-pressed={showPassword}
                  tabIndex={-1}
                >
                  {showPassword ? copy.hide : copy.show}
                </button>
              </span>
              {fieldErrors.password ? (
                <div id="auth-password-error" role="alert" style={fieldErrorStyle}>
                  {fieldErrors.password}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* PRIMARY */}
        <button
          type="submit"
          style={authBusy ? primaryButtonDisabledStyle : primaryButtonStyle}
          disabled={authBusy}
        >
          {authBusy ? view.busyLabel : view.primaryLabel}
        </button>

        {errorMessage ? (
          <div role="alert" style={errorBoxStyle}>
            {errorMessage}
          </div>
        ) : null}
        {!errorMessage && infoMessage ? (
          <div role="status" aria-live="polite" style={successBoxStyle}>
            {infoMessage}
          </div>
        ) : null}

        {/* TERTIARY -- recovery routes stay quiet and never compete with the
            primary submit. Only shown on the sign-in view. */}
        {mode === MODES.SIGN_IN ? (
          <>
            <div style={tertiaryRowStyle}>
              {supportsMagicLink ? (
                <button
                  type="button"
                  style={linkButtonStyle}
                  onClick={() => switchMode(MODES.MAGIC_LINK)}
                  disabled={authBusy}
                >
                  {copy.magicLink}
                </button>
              ) : null}
              {supportsReset ? (
                <button
                  type="button"
                  style={linkButtonStyle}
                  onClick={() => switchMode(MODES.RESET)}
                  disabled={authBusy}
                >
                  {copy.forgotPassword}
                </button>
              ) : null}
            </div>

            {/* SECONDARY -- account creation, clearly separated from sign in. */}
            {supportsSignUp ? (
              <>
                {/* A plain rule, not another "or" divider: the social block
                    above already owns that word, and duplicating it would make
                    the two separators read as the same decision. */}
                <div style={dividerRuleStyle} aria-hidden="true" />
                <div style={secondaryBlockStyle}>
                  <div style={secondaryHintStyle}>{copy.newHere}</div>
                  <button
                    type="button"
                    style={authBusy ? secondaryButtonDisabledStyle : secondaryButtonStyle}
                    onClick={() => switchMode(MODES.SIGN_UP)}
                    disabled={authBusy}
                  >
                    {copy.createAccount}
                  </button>
                </div>
              </>
            ) : null}
          </>
        ) : (
          <div style={tertiaryRowStyle}>
            <button
              type="button"
              style={linkButtonStyle}
              onClick={() => switchMode(MODES.SIGN_IN)}
              disabled={authBusy}
            >
              {copy.backToSignIn}
            </button>
          </div>
        )}

        {languageToggle}
      </form>
    </div>
  );
}
