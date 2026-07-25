import React, { useCallback, useEffect, useMemo, useState } from "react";
import App from "./App";
import AuthScreen from "./screens/AuthScreen";
import CompanyProfileScreen from "./screens/CompanyProfileScreen";
import useSupabaseAuth from "./lib/useSupabaseAuth";
import useSupabaseAccount from "./lib/useSupabaseAccount";
import useSupabaseWorkspaceBootstrap from "./lib/useSupabaseWorkspaceBootstrap";
import { STORAGE_KEYS } from "./constants/storageKeys";
import {
  activateCompanyStorageNamespace,
  deactivateCompanyStorageNamespace,
  importLegacyCompanyStorage,
  installCompanyStorageIsolation,
  prefillCompanyProfileForSetup,
  prepareCompanyStorage,
  startWithEmptyCompanyStorage,
} from "./lib/companyStorageIsolation";

const MIN_PASSWORD_LENGTH = 6;

const pageStyle = {
  minHeight: "100dvh",
  display: "grid",
  placeItems: "center",
  padding: "32px 16px",
  boxSizing: "border-box",
  background: "var(--pe-app-bg)",
};

const cardStyle = {
  width: "min(460px, 100%)",
  display: "grid",
  gap: 18,
  padding: "30px 24px",
  borderRadius: 22,
  border: "1px solid rgba(255,255,255,0.11)",
  background: "linear-gradient(180deg, rgba(255,255,255,0.06), rgba(255,255,255,0.025))",
  boxShadow: "0 24px 60px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
};

const primaryStyle = {
  border: "none",
  borderRadius: 14,
  padding: "14px 16px",
  minHeight: 50,
  fontSize: 14.5,
  fontWeight: 850,
  color: "#04141c",
  background: "linear-gradient(135deg, #6fd3ba 0%, #4d9ab3 55%, #3b78ba 100%)",
  cursor: "pointer",
};

const secondaryStyle = {
  borderRadius: 14,
  padding: "13px 16px",
  minHeight: 48,
  fontSize: 14,
  fontWeight: 800,
  color: "rgba(236,242,248,0.94)",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(255,255,255,0.045)",
  cursor: "pointer",
};

const linkStyle = {
  border: 0,
  background: "transparent",
  color: "rgba(147,197,253,0.95)",
  textDecoration: "underline",
  cursor: "pointer",
  fontWeight: 700,
  padding: 4,
};

const helperStyle = {
  color: "rgba(220,229,238,0.68)",
  fontSize: 13,
  lineHeight: 1.5,
};

const errorStyle = {
  borderRadius: 12,
  padding: "10px 12px",
  color: "rgba(252,165,165,0.98)",
  background: "rgba(248,113,113,0.1)",
  borderLeft: "3px solid rgba(248,113,113,0.75)",
  fontSize: 12.5,
};

function BrandHeader({ title, description }) {
  return (
    <div style={{ display: "grid", justifyItems: "center", gap: 10, textAlign: "center" }}>
      <img src="/logo/estipaid.svg" alt="EstiPaid" style={{ height: 62, width: "auto" }} draggable={false} />
      <div style={{ fontSize: 14, fontWeight: 950, letterSpacing: "0.14em", textTransform: "uppercase" }}>{title}</div>
      <div style={{ ...helperStyle, maxWidth: 360 }}>{description}</div>
    </div>
  );
}

function Field({ id, label, type = "text", value, onChange, autoComplete, placeholder }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <label htmlFor={id} style={{ fontSize: 12.5, fontWeight: 800, color: "rgba(229,238,245,0.76)" }}>{label}</label>
      <input
        id={id}
        className="pe-input"
        type={type}
        value={value}
        onChange={onChange}
        autoComplete={autoComplete}
        placeholder={placeholder}
        disabled={false}
      />
    </div>
  );
}

function AccountAccessScreen({ auth }) {
  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [validationError, setValidationError] = useState("");

  const isCreate = mode === "create";
  const isReset = mode === "reset";

  const submit = async (event) => {
    event.preventDefault();
    if (auth.authBusy) return;
    setValidationError("");

    if (isReset) {
      await auth.resetPasswordForEmail?.(email);
      return;
    }
    if (isCreate) {
      if (String(password).length < MIN_PASSWORD_LENGTH) {
        setValidationError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
        return;
      }
      if (password !== confirmPassword) {
        setValidationError("Both passwords must match.");
        return;
      }
      await auth.signUpWithPassword?.(email, password);
      return;
    }
    await auth.signInWithPassword?.(email, password);
  };

  const title = isCreate ? "Create Your EstiPaid Account" : isReset ? "Reset Your Password" : "Welcome Back";
  const description = isCreate
    ? "Create your login first. After email confirmation, EstiPaid will guide you through setting up your business and Company Profile."
    : isReset
      ? "Enter your account email and we’ll send a secure password-reset link."
      : "Sign in to open the business workspace connected to your account.";

  return (
    <div style={pageStyle}>
      <form style={cardStyle} onSubmit={submit} noValidate>
        <BrandHeader title={title} description={description} />

        {isCreate ? (
          <div style={{ display: "grid", gap: 7, padding: "13px 14px", borderRadius: 14, background: "rgba(59,130,246,0.08)", border: "1px solid rgba(96,165,250,0.18)" }}>
            <strong style={{ fontSize: 13 }}>What happens next</strong>
            <span style={helperStyle}>1. Confirm your email</span>
            <span style={helperStyle}>2. Set up your business</span>
            <span style={helperStyle}>3. Complete your Company Profile</span>
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 14 }}>
          <Field id="account-email" label="Email address" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="name@company.com" />
          {!isReset ? (
            <Field id="account-password" label={isCreate ? "Create password" : "Password"} type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={isCreate ? "new-password" : "current-password"} placeholder={isCreate ? `At least ${MIN_PASSWORD_LENGTH} characters` : "Enter your password"} />
          ) : null}
          {isCreate ? (
            <Field id="account-confirm-password" label="Confirm password" type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" placeholder="Re-enter your password" />
          ) : null}
        </div>

        <button type="submit" style={{ ...primaryStyle, opacity: auth.authBusy ? 0.6 : 1 }} disabled={auth.authBusy}>
          {auth.authBusy ? "Please wait..." : isCreate ? "Create My Account" : isReset ? "Send Reset Email" : "Sign In"}
        </button>

        {validationError || auth.errorMessage ? <div role="status" style={errorStyle}>{validationError || auth.errorMessage}</div> : null}
        {!validationError && !auth.errorMessage && auth.infoMessage ? (
          <div role="status" style={{ ...errorStyle, color: "rgba(190,247,214,0.98)", background: "rgba(52,211,153,0.1)", borderLeftColor: "rgba(52,211,153,0.75)" }}>{auth.infoMessage}</div>
        ) : null}

        <div style={{ display: "flex", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
          {mode !== "signin" ? <button type="button" style={linkStyle} onClick={() => { setMode("signin"); setValidationError(""); }}>Back to Sign In</button> : null}
          {mode === "signin" ? <button type="button" style={linkStyle} onClick={() => { setMode("reset"); setValidationError(""); }}>Forgot Password?</button> : null}
          {mode === "signin" ? <button type="button" style={linkStyle} onClick={() => { setMode("create"); setValidationError(""); }}>Create a New Account</button> : null}
        </div>
      </form>
    </div>
  );
}

function LoadingCard({ message = "Checking your account..." }) {
  return (
    <div style={pageStyle}>
      <div style={{ ...cardStyle, justifyItems: "center" }}>
        <img src="/logo/estipaid.svg" alt="EstiPaid" style={{ height: 62 }} />
        <div style={helperStyle}>{message}</div>
      </div>
    </div>
  );
}

function BusinessSetupScreen({ auth, account }) {
  const [businessName, setBusinessName] = useState("");
  const bootstrap = useSupabaseWorkspaceBootstrap({
    configured: auth.configured,
    user: auth.user,
    hasMembership: Boolean(account.companyUser),
    onCreated: async () => account.refresh(),
  });

  const createBusiness = async (event) => {
    event.preventDefault();
    const result = await bootstrap.createWorkspace(businessName);
    if (!result?.ok) return;
    const companyId = String(result?.result?.company?.id || "").trim();
    if (companyId) {
      activateCompanyStorageNamespace(companyId);
      prefillCompanyProfileForSetup(businessName);
      try { sessionStorage.setItem(`estipaid-profile-onboarding-v1:${companyId}`, "1"); } catch {}
    }
  };

  return (
    <div style={pageStyle}>
      <form style={cardStyle} onSubmit={createBusiness}>
        <BrandHeader title="Set Up Your Business" description="Your login is confirmed. Now create the business account that will own your estimates, invoices, customers, subscription, and team access." />
        <Field id="business-name" label="Business or company name" value={businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" placeholder="AAS Property Care" />
        <button type="submit" style={{ ...primaryStyle, opacity: bootstrap.creating ? 0.6 : 1 }} disabled={bootstrap.creating}>
          {bootstrap.creating ? "Setting Up Business..." : "Continue to Company Profile"}
        </button>
        {bootstrap.error ? <div style={errorStyle}>{bootstrap.error}</div> : null}
        <button type="button" style={linkStyle} onClick={() => auth.signOut?.()} disabled={auth.authBusy}>Sign Out</button>
      </form>
    </div>
  );
}

function LegacyDataDecision({ company, decision, onResolved }) {
  const legacyName = String(decision?.legacy?.companyName || "").trim();
  const companyName = String(company?.name || "this business").trim();
  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <BrandHeader title="Existing Data Found" description="EstiPaid found business data saved in this browser before accounts were separated. It will not attach that data automatically." />
        <div style={{ ...helperStyle, padding: "13px 14px", borderRadius: 14, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.035)" }}>
          {legacyName ? <>Saved business: <strong>{legacyName}</strong><br /></> : null}
          Signed-in business: <strong>{companyName}</strong>
        </div>
        <button type="button" style={primaryStyle} onClick={() => onResolved(importLegacyCompanyStorage(company.id))}>
          Import This Device’s Data into {companyName}
        </button>
        <button type="button" style={secondaryStyle} onClick={() => onResolved(startWithEmptyCompanyStorage(company.id))}>
          Start {companyName} Empty
        </button>
        <div style={helperStyle}>Starting empty does not delete the older browser data. It simply prevents this account from displaying it.</div>
      </div>
    </div>
  );
}

function readProfileComplete() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE);
    const profile = raw ? JSON.parse(raw) : {};
    const phoneDigits = String(profile?.phone || "").replace(/\D/g, "");
    return Boolean(
      String(profile?.companyName || "").trim()
      && (phoneDigits.length === 10 || phoneDigits.length === 11)
      && String(profile?.addressLine1 || "").trim()
      && String(profile?.city || "").trim()
      && String(profile?.state || "").trim()
      && String(profile?.zip || "").trim()
    );
  } catch {
    return false;
  }
}

function CompanyProfileHandoff({ auth, account, onComplete }) {
  const [complete, setComplete] = useState(() => readProfileComplete());
  useEffect(() => {
    const refresh = () => setComplete(readProfileComplete());
    window.addEventListener("storage", refresh);
    window.addEventListener("pe-localstorage", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("pe-localstorage", refresh);
    };
  }, []);

  return (
    <div style={{ minHeight: "100dvh", background: "var(--pe-app-bg)", paddingBottom: 100 }}>
      <div style={{ position: "sticky", top: 0, zIndex: 100, padding: "12px 16px", background: "rgba(7,12,19,0.94)", borderBottom: "1px solid rgba(255,255,255,0.1)", backdropFilter: "blur(16px)" }}>
        <div style={{ maxWidth: 1080, margin: "0 auto", display: "flex", gap: 12, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
          <div>
            <strong>Finish setting up your Company Profile</strong>
            <div style={helperStyle}>Complete the required business details, save, then continue to your dashboard.</div>
          </div>
          <button type="button" style={{ ...primaryStyle, minHeight: 42, padding: "10px 15px", opacity: complete ? 1 : 0.5 }} disabled={!complete} onClick={onComplete}>
            Continue to EstiPaid
          </button>
        </div>
      </div>
      <CompanyProfileScreen
        supabaseConfigured={Boolean(auth.configured)}
        companyId={String(account.company?.id || "")}
        accessToken={String(auth.session?.access_token || "")}
      />
    </div>
  );
}

export default function RootAccountGate() {
  const auth = useSupabaseAuth();
  const account = useSupabaseAccount({ configured: Boolean(auth.configured && auth.session), user: auth.user });
  const [storageDecision, setStorageDecision] = useState(null);
  const [storageReadyCompanyId, setStorageReadyCompanyId] = useState("");
  const [profileHandoffDismissed, setProfileHandoffDismissed] = useState(false);

  useEffect(() => {
    installCompanyStorageIsolation();
  }, []);

  const companyId = String(account.company?.id || "").trim();

  useEffect(() => {
    setStorageDecision(null);
    setStorageReadyCompanyId("");
    setProfileHandoffDismissed(false);
    if (!auth.session || !companyId) {
      deactivateCompanyStorageNamespace();
      return;
    }
    const result = prepareCompanyStorage(companyId);
    if (result?.status === "decision_required") {
      setStorageDecision(result);
      return;
    }
    if (result?.status === "ready") setStorageReadyCompanyId(companyId);
  }, [auth.session?.user?.id, companyId]);

  const shouldShowProfileHandoff = useMemo(() => {
    if (!companyId || storageReadyCompanyId !== companyId || profileHandoffDismissed) return false;
    let flagged = false;
    try { flagged = sessionStorage.getItem(`estipaid-profile-onboarding-v1:${companyId}`) === "1"; } catch {}
    return flagged || !readProfileComplete();
  }, [companyId, profileHandoffDismissed, storageReadyCompanyId]);

  const resolveStorageDecision = useCallback((result) => {
    if (result?.status !== "ready" || !companyId) return;
    setStorageDecision(null);
    setStorageReadyCompanyId(companyId);
  }, [companyId]);

  const finishProfileHandoff = useCallback(() => {
    try { sessionStorage.removeItem(`estipaid-profile-onboarding-v1:${companyId}`); } catch {}
    setProfileHandoffDismissed(true);
  }, [companyId]);

  if (!auth.configured) {
    deactivateCompanyStorageNamespace();
    return <App />;
  }
  if (auth.loading) return <LoadingCard message="Checking your session..." />;
  if (auth.passwordRecoveryPending) return <AuthScreen auth={auth} />;
  if (!auth.session) {
    deactivateCompanyStorageNamespace();
    return <AccountAccessScreen auth={auth} />;
  }
  if (account.loading) return <LoadingCard message="Loading your business account..." />;
  if (account.error) {
    return (
      <div style={pageStyle}><div style={cardStyle}><BrandHeader title="Account Needs Attention" description={account.error} /><button type="button" style={secondaryStyle} onClick={() => account.refresh()}>Try Again</button><button type="button" style={linkStyle} onClick={() => auth.signOut?.()}>Sign Out</button></div></div>
    );
  }
  if (!account.company) return <BusinessSetupScreen auth={auth} account={account} />;
  if (storageDecision?.status === "decision_required") return <LegacyDataDecision company={account.company} decision={storageDecision} onResolved={resolveStorageDecision} />;
  if (storageReadyCompanyId !== companyId) return <LoadingCard message="Opening your business workspace..." />;
  if (shouldShowProfileHandoff) return <CompanyProfileHandoff auth={auth} account={account} onComplete={finishProfileHandoff} />;

  return <App />;
}
