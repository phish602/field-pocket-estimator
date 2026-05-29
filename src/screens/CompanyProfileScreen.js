// @ts-nocheck
/* eslint-disable */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Field from "../components/Field";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { formatPhoneForDisplay, sanitizePhoneDigits, sanitizeZip } from "../utils/sanitize";
import {
  composeAddressFull,
  DEFAULT_COMPANY_PROFILE,
  loadCompanyProfile,
  normalizeCompanyProfile,
} from "../utils/storage";

const PROFILE_KEY = STORAGE_KEYS.COMPANY_PROFILE;
const PROFILE_RETURN_TARGET_KEY = "estipaid-profile-return-target-v1";
const STRIPE_CHECKOUT_SESSIONS_KEY = STORAGE_KEYS.STRIPE_CHECKOUT_SESSIONS;

const US_STATES = ["AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC"];
const REQUIRED_FIELD_META = {
  companyName: { label: "Company Name", inputId: "user-profile-company-name" },
  phone: { label: "Phone", inputId: "user-profile-phone" },
  addressLine1: { label: "Address Line 1", inputId: "user-profile-address-line-1" },
  city: { label: "City", inputId: "user-profile-city" },
  state: { label: "State", inputId: "user-profile-state" },
  zip: { label: "ZIP", inputId: "user-profile-zip" },
};
const REQUIRED_FIELD_ORDER = ["companyName", "phone", "addressLine1", "city", "state", "zip"];

const ESTIMATOR_SECTION_TITLE_STACK_STYLE = {
  display: "inline-flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 6,
  width: "fit-content",
  marginBottom: 8,
};

const ESTIMATOR_SECTION_TITLE_TEXT_STYLE = {
  marginBottom: 0,
  fontSize: 17,
  fontWeight: 950,
  letterSpacing: "0.15em",
  lineHeight: 1.04,
  textTransform: "uppercase",
  color: "rgba(236,242,250,0.96)",
  textShadow: "0 1px 4px rgba(0,0,0,0.32), 0 6px 14px rgba(0,0,0,0.2)",
};

const ESTIMATOR_SECTION_ACCENT_LINE_STYLE = {
  width: "100%",
  height: 3,
  background: "linear-gradient(90deg, rgba(34,197,94,0.78) 0%, rgba(59,130,246,0.74) 100%)",
  clipPath: "polygon(2% 0, 100% 0, 98% 100%, 0 100%)",
  filter: "drop-shadow(0 0 2px rgba(34,197,94,0.16))",
};

function IconBuilding() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <path d="M4 20V5.6A1.6 1.6 0 0 1 5.6 4h7.8A1.6 1.6 0 0 1 15 5.6V8h3.4A1.6 1.6 0 0 1 20 9.6V20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 8.2h2M8 11.2h2M8 14.2h2M12 8.2h1.6M12 11.2h1.6M7.6 20v-2.8h3.2V20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconMapPin() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <path d="M12 20.2s6-5.4 6-10.1a6 6 0 1 0-12 0c0 4.7 6 10.1 6 10.1Z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
    </svg>
  );
}

function IconBadge() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <rect x="4.5" y="5" width="15" height="14" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <path d="M8 9h8M8 12h4.6M8 15h6" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
      <circle cx="16.6" cy="14.9" r="1.2" fill="currentColor" />
    </svg>
  );
}

function IconImage() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false">
      <rect x="4" y="5" width="16" height="14" rx="2.2" fill="none" stroke="currentColor" strokeWidth="1.9" />
      <circle cx="9" cy="10" r="1.5" fill="currentColor" />
      <path d="m6.6 16.6 4.1-4.1 2.8 2.8 2.1-2.1 2.4 2.4" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ValidCheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="rgba(34,197,94,0.18)" stroke="rgba(74,222,128,0.75)" strokeWidth="1.5" />
      <path d="M8.2 12.2 10.8 14.8 15.8 9.8" fill="none" stroke="rgba(134,239,172,0.96)" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProfileSectionHeader({ icon, title }) {
  return (
    <div className="pe-company-section-heading">
      <span className="pe-company-section-icon" aria-hidden="true">
        {icon}
      </span>
      <div style={ESTIMATOR_SECTION_TITLE_STACK_STYLE}>
        <div className="pe-section-title" style={ESTIMATOR_SECTION_TITLE_TEXT_STYLE}>{title}</div>
        <div style={ESTIMATOR_SECTION_ACCENT_LINE_STYLE} />
      </div>
    </div>
  );
}

function stripNonCompanyFields(profile) {
  const { attn, terms, ...rest } = profile || {};
  return rest;
}

function hasValidPhone(phone) {
  const digits = sanitizePhoneDigits(phone, 11);
  return digits.length === 10 || digits.length === 11;
}

function hasValidEmail(email) {
  const v = String(email || "").trim();
  if (!v) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function validHelperText() {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "rgba(134,239,172,0.9)" }}>
      <ValidCheckIcon />
      Valid
    </span>
  );
}

function serializeProfileState(profile) {
  const normalized = stripNonCompanyFields(normalizeCompanyProfile(profile || {}));
  normalized.address = composeAddressFull(normalized);
  return JSON.stringify(normalized);
}

function getMissingRequiredFields(profile) {
  const normalized = stripNonCompanyFields(normalizeCompanyProfile(profile || {}));
  const missing = [];

  if (!String(normalized.companyName || "").trim()) missing.push("companyName");
  if (!hasValidPhone(normalized.phone)) missing.push("phone");
  if (!String(normalized.addressLine1 || "").trim()) missing.push("addressLine1");
  if (!String(normalized.city || "").trim()) missing.push("city");
  if (!String(normalized.state || "").trim()) missing.push("state");
  if (!String(normalized.zip || "").trim()) missing.push("zip");

  return missing;
}

function loadProfile() {
  try {
    return stripNonCompanyFields(loadCompanyProfile());
  } catch {
    return stripNonCompanyFields({ ...DEFAULT_COMPANY_PROFILE });
  }
}

function isStripeAccountId(value) {
  return /^acct_/i.test(String(value || "").trim());
}

function buildStripeConnectUrls() {
  try {
    const current = new URL(String(window.location.href || "http://localhost:3000"));
    const returnUrl = new URL(current.toString());
    returnUrl.searchParams.set("stripeConnect", "return");
    const refreshUrl = new URL(current.toString());
    refreshUrl.searchParams.set("stripeConnect", "refresh");
    return {
      returnUrl: returnUrl.toString(),
      refreshUrl: refreshUrl.toString(),
    };
  } catch {
    return {
      returnUrl: "http://localhost:3000/?stripeConnect=return",
      refreshUrl: "http://localhost:3000/?stripeConnect=refresh",
    };
  }
}

function saveProfile(p) {
  try {
    const normalized = stripNonCompanyFields(normalizeCompanyProfile(p || {}));
    normalized.address = composeAddressFull(normalized);
    localStorage.setItem(PROFILE_KEY, JSON.stringify(normalized));
    try {
      // notify shell listeners
      window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: PROFILE_KEY, value: JSON.stringify(normalized) } }));
    } catch {}
    return true;
  } catch {
    return false;
  }
}

function dispatchLocalStorageUpdate(key, value) {
  try {
    window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key, value } }));
  } catch {}
}

function readProfileReturnTarget() {
  try {
    const raw = localStorage.getItem(PROFILE_RETURN_TARGET_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => resolve("");
      reader.readAsDataURL(file);
    } catch {
      resolve("");
    }
  });
}

export default function CompanyProfileScreen() {
  const initialProfileRef = useRef(null);
  if (initialProfileRef.current === null) {
    initialProfileRef.current = loadProfile();
  }

  const [profile, setProfile] = useState(() => initialProfileRef.current);
  const [lastSaveOk, setLastSaveOk] = useState(true);
  const [savedAt, setSavedAt] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [saveFlash, setSaveFlash] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [logoFileName, setLogoFileName] = useState("");
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() => serializeProfileState(initialProfileRef.current));
  const [showMissingRequiredPrompt, setShowMissingRequiredPrompt] = useState(false);
  const [stripeConnectBusy, setStripeConnectBusy] = useState(false);
  const [stripeStatusBusy, setStripeStatusBusy] = useState(false);
  const [stripeStatus, setStripeStatus] = useState(null);
  const fileInputRef = useRef(null);
  const brandingCardRef = useRef(null);
  const brandingUploadButtonRef = useRef(null);
  const brandingFocusTimerRef = useRef(null);
  const saveFlashTimerRef = useRef(null);
  const isDirty = useMemo(() => serializeProfileState(profile) !== lastSavedSnapshot, [profile, lastSavedSnapshot]);
  const missingRequiredFields = useMemo(() => getMissingRequiredFields(profile), [profile]);
  const missingRequiredSet = useMemo(
    () => new Set(showMissingRequiredPrompt ? missingRequiredFields : []),
    [showMissingRequiredPrompt, missingRequiredFields],
  );
  const stripeAccountId = String(profile?.stripeAccountId || "").trim();
  const stripeConnected = isStripeAccountId(stripeAccountId);
  const stripeChargesEnabled = stripeStatus ? !!stripeStatus.chargesEnabled : null;
  const stripePayoutsEnabled = stripeStatus ? !!stripeStatus.payoutsEnabled : null;
  const stripeDetailsSubmitted = stripeStatus ? !!stripeStatus.detailsSubmitted : null;
  const stripeReady = stripeConnected && !!stripeChargesEnabled && !!stripePayoutsEnabled && !!stripeDetailsSubmitted;
  const stripeCanAcceptPayments = stripeConnected && !!stripeChargesEnabled;
  const stripePrimaryActionLabel = stripeConnected ? "Continue Stripe Setup" : "Connect Stripe";
  const stripeStateMeta = stripeConnected
    ? (stripeReady
      ? {
        label: "Ready for payments",
        background: "rgba(34,197,94,0.12)",
        border: "rgba(34,197,94,0.22)",
        color: "rgba(187,247,208,0.98)",
        summary: "Stripe is connected and online invoice payments are available.",
        helper: "Customers can pay invoices online and Stripe can route funds to payouts.",
        nextAction: "Refresh Stripe Status whenever Stripe onboarding details change.",
      }
      : {
        label: "Setup incomplete",
        background: "rgba(245,158,11,0.12)",
        border: "rgba(245,158,11,0.22)",
        color: "rgba(253,230,138,0.98)",
        summary: "Stripe is connected, but onboarding still needs attention before payments are fully ready.",
        helper: "Finish account setup so EstiPaid can safely support online invoice payments.",
        nextAction: "Continue Stripe Setup, then refresh the status after Stripe updates the account.",
      })
    : {
      label: "Not connected",
      background: "rgba(59,130,246,0.12)",
      border: "rgba(59,130,246,0.22)",
      color: "rgba(191,219,254,0.98)",
      summary: "Stripe is not connected yet, so this contractor cannot accept online invoice payments.",
      helper: "Connect Stripe to let customers pay invoices online without changing invoice or payment flows.",
      nextAction: "Connect Stripe to start onboarding and create a payment-ready account link.",
    };

  useEffect(() => () => {
    if (saveFlashTimerRef.current) {
      clearTimeout(saveFlashTimerRef.current);
      saveFlashTimerRef.current = null;
    }
    if (brandingFocusTimerRef.current) {
      clearTimeout(brandingFocusTimerRef.current);
      brandingFocusTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    try {
      window.dispatchEvent(new CustomEvent("estipaid:user-profile-dirty", { detail: { dirty: isDirty } }));
    } catch {}
  }, [isDirty]);

  useEffect(
    () => () => {
      try {
        window.dispatchEvent(new CustomEvent("estipaid:user-profile-dirty", { detail: { dirty: false } }));
      } catch {}
    },
    [],
  );

  useEffect(() => {
    if (!isDirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    if (!showMissingRequiredPrompt) return;
    if (missingRequiredFields.length === 0) setShowMissingRequiredPrompt(false);
  }, [showMissingRequiredPrompt, missingRequiredFields]);

  useEffect(() => {
    if (!showToast) return undefined;
    const timer = window.setTimeout(() => setShowToast(false), 1500);
    return () => window.clearTimeout(timer);
  }, [showToast]);

  const focusRequiredField = (fieldKey) => {
    const inputId = REQUIRED_FIELD_META[fieldKey]?.inputId;
    if (!inputId) return;
    const node = document.getElementById(inputId);
    if (!node) return;
    try {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch {}
    try {
      node.focus({ preventScroll: true });
    } catch {
      try {
        node.focus();
      } catch {}
    }
  };

  const isFieldMissing = (fieldKey) => missingRequiredSet.has(fieldKey);
  const fieldLabelClassName = (fieldKey) => (isFieldMissing(fieldKey) ? "pe-company-field-missing-label" : "");
  const fieldControlClassName = (fieldKey) => (isFieldMissing(fieldKey) ? "pe-company-field-missing-input" : "");
  const fieldRequiredError = (fieldKey) => (isFieldMissing(fieldKey) ? "This field is required." : "");
  const persistProfileUpdate = useCallback((nextProfile, options = {}) => {
    const normalized = stripNonCompanyFields(normalizeCompanyProfile(nextProfile || {}));
    const ok = saveProfile(normalized);
    setLastSaveOk(ok);
    setProfile(normalized);
    if (!ok) return false;

    try {
      setSavedAt(Date.now());
    } catch {}
    setLastSavedSnapshot(serializeProfileState(normalized));
    if (options.toastMessage) {
      setToastMessage(options.toastMessage);
      setShowToast(true);
    }
    return true;
  }, []);

  const refreshStripeStatus = useCallback(async (accountIdOverride = "", options = {}) => {
    const accountId = String(accountIdOverride || "").trim() || stripeAccountId;
    if (!isStripeAccountId(accountId)) {
      setStripeStatus(null);
      return;
    }

    setStripeStatusBusy(true);
    try {
      const response = await fetch(`/api/stripe/connect/account-status?stripeAccountId=${encodeURIComponent(accountId)}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        window.alert(payload?.error || "Unable to refresh Stripe status.");
        return;
      }
      setStripeStatus({
        stripeAccountId: String(payload?.stripeAccountId || accountId),
        chargesEnabled: !!payload?.chargesEnabled,
        payoutsEnabled: !!payload?.payoutsEnabled,
        detailsSubmitted: !!payload?.detailsSubmitted,
      });
      if (options.toastMessage) {
        setToastMessage(options.toastMessage);
        setShowToast(true);
      }
    } catch {
      window.alert("Unable to refresh Stripe status.");
    } finally {
      setStripeStatusBusy(false);
    }
  }, [stripeAccountId]);

  const handleStripeConnect = useCallback(async () => {
    if (stripeConnectBusy) return;

    setStripeConnectBusy(true);
    try {
      const { returnUrl, refreshUrl } = buildStripeConnectUrls();
      const response = await fetch("/api/stripe/connect/create-account-link", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          stripeAccountId: stripeAccountId || undefined,
          returnUrl,
          refreshUrl,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !isStripeAccountId(payload?.stripeAccountId) || !String(payload?.accountLinkUrl || "").trim()) {
        window.alert(payload?.error || "Unable to start Stripe onboarding.");
        return;
      }

      if (!persistProfileUpdate(
        { ...profile, stripeAccountId: String(payload.stripeAccountId || "").trim() },
        { toastMessage: stripeAccountId ? "Stripe setup link refreshed" : "Stripe account linked" },
      )) {
        window.alert("Unable to save Stripe account information.");
        return;
      }

      const opened = typeof window !== "undefined" && typeof window.open === "function"
        ? window.open(String(payload.accountLinkUrl), "_self")
        : null;
      if (!opened && typeof window !== "undefined") {
        window.location.assign(String(payload.accountLinkUrl));
      }
    } catch {
      window.alert("Unable to start Stripe onboarding.");
    } finally {
      setStripeConnectBusy(false);
    }
  }, [persistProfileUpdate, profile, stripeAccountId, stripeConnectBusy]);

  const openLogoPicker = () => {
    if (!fileInputRef.current) return;
    try {
      fileInputRef.current.click();
    } catch {}
  };
  const focusUploadButton = () => {
    if (!brandingUploadButtonRef.current) return;
    try {
      brandingUploadButtonRef.current.focus({ preventScroll: true });
    } catch {
      try {
        brandingUploadButtonRef.current.focus();
      } catch {}
    }
  };
  const handleLogoInputChange = async (e) => {
    const f = e?.target?.files && e.target.files[0];
    if (!f) return;
    const dataUrl = await fileToDataUrl(f);
    setProfile((p) => ({ ...p, logoDataUrl: dataUrl || "" }));
    setLogoFileName(String(f.name || ""));
    try {
      e.target.value = "";
    } catch {}
  };
  const removeLogo = () => {
    setProfile((p) => ({ ...p, logoDataUrl: "" }));
    setLogoFileName("");
    try {
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch {}
  };

  useEffect(() => {
    const onFocusBranding = (event) => {
      const openPicker = event?.detail?.openPicker !== false;
      const brandingNode = brandingCardRef.current;
      if (!brandingNode) return;
      const viewportHeight = Math.max(
        Number(window?.innerHeight) || 0,
        Number(document?.documentElement?.clientHeight) || 0,
      );
      const rect = brandingNode.getBoundingClientRect();
      const isVisible = rect.top >= 0 && rect.bottom <= viewportHeight;
      if (isVisible) {
        if (openPicker) {
          openLogoPicker();
        } else {
          focusUploadButton();
        }
        return;
      }
      try {
        brandingNode.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {}
      if (brandingFocusTimerRef.current) {
        clearTimeout(brandingFocusTimerRef.current);
      }
      brandingFocusTimerRef.current = setTimeout(() => {
        focusUploadButton();
        brandingFocusTimerRef.current = null;
      }, 300);
    };
    window.addEventListener("estipaid:company-logo-focus", onFocusBranding);
    return () => window.removeEventListener("estipaid:company-logo-focus", onFocusBranding);
  }, []);

  useEffect(() => {
    if (!isStripeAccountId(stripeAccountId)) {
      setStripeStatus(null);
      return;
    }
    refreshStripeStatus(stripeAccountId);
  }, [refreshStripeStatus, stripeAccountId]);

  const doExplicitSave = () => {
    const missing = getMissingRequiredFields(profile);
    if (missing.length) {
      setSaveFlash(false);
      setShowMissingRequiredPrompt(true);
      const firstMissing = REQUIRED_FIELD_ORDER.find((fieldKey) => missing.includes(fieldKey)) || missing[0];
      window.requestAnimationFrame(() => {
        focusRequiredField(firstMissing);
      });
      return;
    }

    setShowMissingRequiredPrompt(false);
    let existingRaw = null;
    try {
      existingRaw = localStorage.getItem(PROFILE_KEY);
    } catch {
      existingRaw = null;
    }

    if (existingRaw) {
      let same = false;
      try {
        const normalizedExisting = JSON.stringify(stripNonCompanyFields(normalizeCompanyProfile((JSON.parse(existingRaw || "{}") || {}))));
        const normalizedCurrent = JSON.stringify(stripNonCompanyFields(normalizeCompanyProfile(profile || {})));
        same = normalizedExisting === normalizedCurrent;
      } catch {
        same = false;
      }
      if (!same) {
        const ok = window.confirm("Overwrite saved Company Profile?");
        if (!ok) return;
      }
    }

    const ok = saveProfile(profile);
    setLastSaveOk(ok);
    try {
      setSavedAt(Date.now());
    } catch {}
    if (ok) {
      setLastSavedSnapshot(serializeProfileState(profile));
      setSaveFlash(true);
      setToastMessage("Profile updated");
      setShowToast(true);
      if (saveFlashTimerRef.current) clearTimeout(saveFlashTimerRef.current);
      saveFlashTimerRef.current = setTimeout(() => {
        setSaveFlash(false);
        saveFlashTimerRef.current = null;
      }, 1500);

      const returnTarget = readProfileReturnTarget();
      if (returnTarget) {
        try {
          window.dispatchEvent(new CustomEvent("estipaid:profile-save-return"));
        } catch {}
      }
    }
  };

  const doClearProfile = () => {
    try {
      localStorage.removeItem(PROFILE_KEY);
    } catch {}

    const cleared = stripNonCompanyFields({ ...DEFAULT_COMPANY_PROFILE });
    setProfile(cleared);
    setLastSaveOk(true);
    setSavedAt(null);
    setSaveFlash(false);
    setShowMissingRequiredPrompt(false);
    setLogoFileName("");
    setLastSavedSnapshot(serializeProfileState(cleared));
    setShowClearConfirm(false);

    dispatchLocalStorageUpdate(PROFILE_KEY, "");
  };

  const handleStripeDisconnect = useCallback(() => {
    if (!isStripeAccountId(stripeAccountId)) return;
    const confirmed = window.confirm(
      "Disconnect Stripe from this Company Profile?\n\n"
      + "Online payment links created for the old Stripe account will no longer be usable from EstiPaid.\n"
      + "Saved invoice payment history will not be deleted."
    );
    if (!confirmed) return;

    const nextProfile = { ...profile, stripeAccountId: "" };
    if (!persistProfileUpdate(nextProfile, { toastMessage: "Stripe connection reset" })) {
      window.alert("Unable to clear the saved Stripe connection.");
      return;
    }

    try {
      localStorage.removeItem(STRIPE_CHECKOUT_SESSIONS_KEY);
    } catch {}
    dispatchLocalStorageUpdate(STRIPE_CHECKOUT_SESSIONS_KEY, "");
    setStripeStatus(null);
  }, [persistProfileUpdate, profile, stripeAccountId]);

  const modalOverlay = {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
  };

  const modalCard = {
    width: "min(520px, 100%)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(10,10,10,0.85)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
    padding: 16,
    display: "grid",
    gap: 12,
  };

  const modalTitle = {
    fontSize: 14,
    fontWeight: 1000,
    letterSpacing: "0.7px",
  };

  const modalText = {
    fontSize: 13,
    opacity: 0.85,
    lineHeight: 1.35,
  };

const modalActions = {
  display: "flex",
  gap: 10,
  justifyContent: "flex-end",
  flexWrap: "wrap",
  marginTop: 6,
};

const stripeCardBaseStyle = {
  borderRadius: 18,
  border: "1px solid rgba(255,255,255,0.12)",
  background: "linear-gradient(180deg, rgba(18,24,38,0.92), rgba(9,14,24,0.9))",
  padding: 16,
  display: "grid",
  gap: 14,
  boxShadow: "0 14px 30px rgba(0,0,0,0.22)",
};

const stripeEyebrowStyle = {
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "rgba(226,232,240,0.42)",
};

const stripeHeadlineStyle = {
  fontSize: 20,
  lineHeight: 1.15,
  fontWeight: 950,
  color: "rgba(248,250,252,0.98)",
};

const stripeBodyStyle = {
  fontSize: 13.5,
  lineHeight: 1.55,
  color: "rgba(226,232,240,0.78)",
};

const stripeStatusPillStyle = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 30,
  padding: "6px 12px",
  borderRadius: 999,
  border: "1px solid rgba(255,255,255,0.14)",
  fontSize: 11,
  fontWeight: 900,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  whiteSpace: "nowrap",
};

const stripeMetricCardStyle = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.04)",
  padding: "12px 12px 10px",
  display: "grid",
  gap: 5,
  minWidth: 0,
};

const stripeMetricLabelStyle = {
  fontSize: 10.5,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "rgba(226,232,240,0.46)",
};

const stripeMetricValueStyle = {
  fontSize: 18,
  lineHeight: 1.15,
  fontWeight: 900,
  color: "rgba(248,250,252,0.98)",
};

const stripeMetricMetaStyle = {
  fontSize: 11.5,
  lineHeight: 1.4,
  color: "rgba(226,232,240,0.62)",
};

const stripeDetailsGridStyle = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  gap: 10,
};

const stripeDetailBlockStyle = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.03)",
  padding: 12,
  display: "grid",
  gap: 8,
};

const stripeActionGroupStyle = {
  borderRadius: 14,
  border: "1px solid rgba(255,255,255,0.1)",
  background: "rgba(255,255,255,0.03)",
  padding: 12,
  display: "grid",
  gap: 8,
};

  return (
    <section className="pe-section">
      {showClearConfirm ? (
        <div style={modalOverlay} role="dialog" aria-modal="true">
          <div style={modalCard}>
            <div style={modalTitle}>Clear all Company Profile fields?</div>
            <div style={modalText}>Unsaved changes will be lost.</div>
            <div style={modalActions}>
              <button type="button" className="pe-btn pe-btn-ghost" onClick={() => setShowClearConfirm(false)}>
                Cancel
              </button>
              <button type="button" className="pe-btn" onClick={doClearProfile}>
                Clear
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="pe-card pe-company-shell">
        <div className="pe-company-profile-header pe-company-profile-header-profile">
          <div className="pe-company-header-title">
            <img
              src="/logo/estipaid.svg"
              alt="EstiPaid"
              className="pe-company-header-logo esti-spin"
              draggable={false}
            />
            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title="Company Profile">Company Profile</h1>
          </div>

          <div className="pe-company-header-controls pe-company-header-controls-profile">
            <button type="button" className="pe-btn" onClick={doExplicitSave}>
              Save
            </button>
            <button type="button" className="pe-btn pe-btn-ghost" onClick={() => setShowClearConfirm(true)}>
              Clear
            </button>
            <div className={`pe-company-save-indicator ${saveFlash ? "is-visible" : ""}`} aria-live="polite">
              Saved
            </div>
          </div>
        </div>

        {showMissingRequiredPrompt && missingRequiredFields.length ? (
          <div className="pe-company-missing-banner" role="alert" aria-live="assertive">
            <div className="pe-company-missing-banner-title">Missing required information</div>
            <div className="pe-company-missing-banner-body">
              Please complete the highlighted fields to save your Company Profile.
            </div>
            <ul className="pe-company-missing-list">
              {missingRequiredFields.map((fieldKey) => (
                <li key={fieldKey}>{REQUIRED_FIELD_META[fieldKey]?.label || fieldKey}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="pe-company-form-inner ep-section-gap-sm">
          <div className="pe-company-top-layout">
            <div className="pe-company-form-section pe-company-top-main">
              <ProfileSectionHeader icon={<IconBuilding />} title="COMPANY" />
              <div className="pe-company-grid-12">
                <Field
                  fieldClassName="pe-company-col-12"
                  labelClassName={fieldLabelClassName("companyName")}
                  controlClassName={fieldControlClassName("companyName")}
                  label="Company name *"
                  id={REQUIRED_FIELD_META.companyName.inputId}
                  errorText={fieldRequiredError("companyName")}
                  value={profile.companyName}
                  placeholder="Example: Desert Ridge HOA"
                  onChange={(e) => setProfile((p) => ({ ...p, companyName: e.target.value }))}
                />

                <Field
                  fieldClassName="pe-company-col-5"
                  labelClassName={fieldLabelClassName("phone")}
                  controlClassName={fieldControlClassName("phone")}
                  label="Phone *"
                  id={REQUIRED_FIELD_META.phone.inputId}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  errorText={fieldRequiredError("phone")}
                  helperText={hasValidPhone(profile.phone) ? validHelperText() : ""}
                  value={formatPhoneForDisplay(profile.phone)}
                  placeholder="Example: 602-555-0147"
                  onChange={(e) => setProfile((p) => ({ ...p, phone: sanitizePhoneDigits(e.target.value, 11) }))}
                />

                <Field
                  fieldClassName="pe-company-col-7"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  helperText={hasValidEmail(profile.email) ? validHelperText() : ""}
                  value={profile.email}
                  placeholder="Example: office@desertridgehoa.com"
                  onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                />

                <Field
                  fieldClassName="pe-company-col-12"
                  label="Website"
                  value={profile.website}
                  placeholder="Example: www.desertridgehoa.com"
                  onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))}
                />
              </div>
            </div>

            <div id="company-profile-branding" ref={brandingCardRef} className="pe-card pe-card-content ep-glass-tile ep-tile-hover pe-company-top-branding-col pe-company-branding-card pe-branding-tile">
              <ProfileSectionHeader icon={<IconImage />} title="BRANDING" />
              <input
                ref={fileInputRef}
                className="pe-company-hidden-file"
                type="file"
                accept="image/*"
                onChange={handleLogoInputChange}
              />
              <div className="pe-company-branding-preview-wrap">
                <div className="pe-company-branding-preview">
                  {profile.logoDataUrl ? (
                    <img
                      src={profile.logoDataUrl}
                      alt="Company logo preview"
                      className="pe-company-branding-preview-img"
                      draggable={false}
                    />
                  ) : (
                    <div className="pe-company-branding-placeholder">
                      <span className="pe-company-branding-placeholder-icon" aria-hidden="true"><IconImage /></span>
                      <span>No logo uploaded</span>
                    </div>
                  )}
                </div>
                <div className="pe-field-helper pe-company-branding-helper">Used on PDFs/exports</div>
                {!profile.logoDataUrl ? (
                  <>
                    <div className="pe-field-helper pe-company-branding-helper" style={{ marginTop: 6 }}>
                      No logo uploaded yet - your PDF will use a branded initials badge until you add one.
                    </div>
                    <div className="pe-field-helper pe-company-branding-helper" style={{ marginTop: 2, opacity: 0.78 }}>
                      Upload a logo anytime to replace it.
                    </div>
                  </>
                ) : null}
              </div>
              <div className="pe-company-upload-row">
                <button
                  ref={brandingUploadButtonRef}
                  type="button"
                  className="pe-btn pe-company-upload-btn"
                  onClick={openLogoPicker}
                >
                  Upload Logo
                </button>
                {profile.logoDataUrl ? (
                  <button type="button" className="pe-btn pe-btn-ghost" onClick={removeLogo}>
                    Remove
                  </button>
                ) : null}
              </div>
              <div className="pe-company-upload-name">
                {logoFileName || (profile.logoDataUrl ? "Logo on file" : "No file selected")}
              </div>
            </div>
          </div>

          <div className="pe-company-form-section">
            <div className="pe-company-section-divider" aria-hidden="true" />
            <ProfileSectionHeader icon={<IconMapPin />} title="BUSINESS ADDRESS" />
            <div className="pe-company-grid-12">
              <Field
                fieldClassName="pe-company-col-12"
                labelClassName={fieldLabelClassName("addressLine1")}
                controlClassName={fieldControlClassName("addressLine1")}
                label="Address line 1 *"
                id={REQUIRED_FIELD_META.addressLine1.inputId}
                autoComplete="address-line1"
                errorText={fieldRequiredError("addressLine1")}
                value={profile.addressLine1}
                placeholder="Example: 1234 E Camelback Rd, Phoenix AZ"
                onChange={(e) => setProfile((p) => ({ ...p, addressLine1: e.target.value }))}
              />

              <Field
                fieldClassName="pe-company-col-12"
                label="Address line 2"
                autoComplete="address-line2"
                value={profile.addressLine2}
                placeholder="Example: Suite 200"
                onChange={(e) => setProfile((p) => ({ ...p, addressLine2: e.target.value }))}
              />

              <Field
                fieldClassName="pe-company-col-5"
                labelClassName={fieldLabelClassName("city")}
                controlClassName={fieldControlClassName("city")}
                label="City *"
                id={REQUIRED_FIELD_META.city.inputId}
                autoComplete="address-level2"
                errorText={fieldRequiredError("city")}
                value={profile.city}
                placeholder="Example: Phoenix"
                onChange={(e) => setProfile((p) => ({ ...p, city: e.target.value }))}
              />

              <Field
                as="select"
                fieldClassName="pe-company-col-4"
                labelClassName={fieldLabelClassName("state")}
                controlClassName={fieldControlClassName("state")}
                label="State *"
                id={REQUIRED_FIELD_META.state.inputId}
                autoComplete="address-level1"
                errorText={fieldRequiredError("state")}
                value={profile.state}
                onChange={(e) => setProfile((p) => ({ ...p, state: e.target.value }))}
              >
                <option value="">Select State</option>
                {US_STATES.map((stateCode) => (
                  <option key={stateCode} value={stateCode}>
                    {stateCode}
                  </option>
                ))}
              </Field>

              <Field
                fieldClassName="pe-company-col-3"
                labelClassName={fieldLabelClassName("zip")}
                controlClassName={fieldControlClassName("zip")}
                label="ZIP *"
                id={REQUIRED_FIELD_META.zip.inputId}
                autoComplete="postal-code"
                inputMode="numeric"
                errorText={fieldRequiredError("zip")}
                value={profile.zip}
                placeholder="85016"
                onChange={(e) => setProfile((p) => ({ ...p, zip: sanitizeZip(e.target.value, 10) }))}
              />
            </div>
          </div>

          <div className="pe-company-form-section">
            <div className="pe-company-section-divider" aria-hidden="true" />
            <ProfileSectionHeader icon={<IconBadge />} title="LICENSING &amp; TAX" />
            <div className="pe-company-grid-12">
              <Field
                fieldClassName="pe-company-col-6"
                label="ROC"
                value={profile.roc}
                placeholder="ROC 123456"
                onChange={(e) => setProfile((p) => ({ ...p, roc: e.target.value }))}
              />
              <Field
                fieldClassName="pe-company-col-6"
                label="EIN"
                value={profile.ein}
                placeholder="12-3456789"
                onChange={(e) => setProfile((p) => ({ ...p, ein: e.target.value }))}
              />
            </div>
          </div>

          <div className="pe-company-form-section">
            <div className="pe-company-section-divider" aria-hidden="true" />
            <ProfileSectionHeader icon={<IconBadge />} title="STRIPE PAYMENTS" />
            <div className="pe-company-grid-12">
              <div className="pe-company-col-12">
                <div
                  style={{
                    ...stripeCardBaseStyle,
                    background: `linear-gradient(180deg, ${stripeStateMeta.background}, rgba(9,14,24,0.9))`,
                    border: `1px solid ${stripeStateMeta.border}`,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                      <div style={stripeEyebrowStyle}>Stripe onboarding</div>
                      <div style={stripeHeadlineStyle}>{stripeStateMeta.summary}</div>
                      <div className="pe-field-helper" style={{ ...stripeBodyStyle, marginBottom: 0 }}>
                        Connect your own Stripe account for future online invoice payments. EstiPaid stores your connected account ID only and never stores Stripe secret keys.
                      </div>
                    </div>
                    <div
                      style={{
                        ...stripeStatusPillStyle,
                        background: stripeStateMeta.background,
                        border: `1px solid ${stripeStateMeta.border}`,
                        color: stripeStateMeta.color,
                      }}
                    >
                      {stripeStateMeta.label}
                    </div>
                  </div>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                      gap: 10,
                    }}
                  >
                    <div style={stripeMetricCardStyle}>
                      <div style={stripeMetricLabelStyle}>Connected</div>
                      <div style={{ ...stripeMetricValueStyle, color: stripeConnected ? "rgba(191,219,254,0.98)" : "rgba(226,232,240,0.92)" }}>
                        {stripeConnected ? "Yes" : "No"}
                      </div>
                      <div style={stripeMetricMetaStyle}>
                        {stripeConnected ? "Stripe account linked to this profile" : "No Stripe account linked yet"}
                      </div>
                    </div>
                    <div style={stripeMetricCardStyle}>
                      <div style={stripeMetricLabelStyle}>Details submitted</div>
                      <div style={{ ...stripeMetricValueStyle, color: stripeDetailsSubmitted ? "rgba(187,247,208,0.98)" : stripeMetricValueStyle.color }}>
                        {stripeStatus ? (stripeStatus.detailsSubmitted ? "Yes" : "No") : "Not checked yet"}
                      </div>
                      <div style={stripeMetricMetaStyle}>
                        {stripeDetailsSubmitted ? "Stripe onboarding details are submitted" : "Stripe still needs setup details"}
                      </div>
                    </div>
                    <div style={stripeMetricCardStyle}>
                      <div style={stripeMetricLabelStyle}>Charges enabled</div>
                      <div style={{ ...stripeMetricValueStyle, color: stripeChargesEnabled ? "rgba(187,247,208,0.98)" : stripeMetricValueStyle.color }}>
                        {stripeStatus ? (stripeStatus.chargesEnabled ? "Yes" : "No") : "Not checked yet"}
                      </div>
                      <div style={stripeMetricMetaStyle}>
                        {stripeCanAcceptPayments ? "Online invoice payments can be accepted" : "Customers cannot pay online yet"}
                      </div>
                    </div>
                    <div style={stripeMetricCardStyle}>
                      <div style={stripeMetricLabelStyle}>Payouts enabled</div>
                      <div style={{ ...stripeMetricValueStyle, color: stripePayoutsEnabled ? "rgba(187,247,208,0.98)" : stripeMetricValueStyle.color }}>
                        {stripeStatus ? (stripeStatus.payoutsEnabled ? "Yes" : "No") : "Not checked yet"}
                      </div>
                      <div style={stripeMetricMetaStyle}>
                        {stripePayoutsEnabled ? "Stripe payouts are available" : "Stripe payouts are not ready yet"}
                      </div>
                    </div>
                  </div>

                  <div style={stripeDetailsGridStyle}>
                    <div style={stripeDetailBlockStyle}>
                      <div style={stripeEyebrowStyle}>Status details</div>
                      {stripeAccountId ? (
                        <div style={{ fontSize: 13.5 }}>
                          Connected account ID: <strong data-testid="stripe-account-id">{stripeAccountId}</strong>
                        </div>
                      ) : (
                        <div style={{ fontSize: 13.5, opacity: 0.82 }}>
                          No Stripe account connected yet.
                        </div>
                      )}
                      <div style={{ display: "grid", gap: 6, fontSize: 13.5 }}>
                        <div>
                          Charges enabled: <strong>{stripeStatus ? (stripeStatus.chargesEnabled ? "Yes" : "No") : "Not checked yet"}</strong>
                        </div>
                        <div>
                          Payouts enabled: <strong>{stripeStatus ? (stripeStatus.payoutsEnabled ? "Yes" : "No") : "Not checked yet"}</strong>
                        </div>
                        <div>
                          Details submitted: <strong>{stripeStatus ? (stripeStatus.detailsSubmitted ? "Yes" : "No") : "Not checked yet"}</strong>
                        </div>
                      </div>
                    </div>

                    <div style={stripeDetailBlockStyle}>
                      <div style={stripeEyebrowStyle}>Next safest action</div>
                      <div style={{ fontSize: 15, fontWeight: 900, color: stripeStateMeta.color }}>
                        {stripeConnected ? (stripeReady ? "Refresh Stripe Status" : "Continue Stripe Setup") : "Connect Stripe"}
                      </div>
                      <div style={stripeBodyStyle}>{stripeStateMeta.nextAction}</div>
                      <div style={{ ...stripeBodyStyle, color: "rgba(226,232,240,0.68)" }}>{stripeStateMeta.helper}</div>
                    </div>
                  </div>

                  <div style={stripeDetailsGridStyle}>
                    <div style={stripeActionGroupStyle}>
                      <div style={stripeEyebrowStyle}>Primary actions</div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          className="pe-btn"
                          onClick={handleStripeConnect}
                          disabled={stripeConnectBusy}
                        >
                          {stripeConnectBusy
                            ? "Opening Stripe..."
                            : stripePrimaryActionLabel}
                        </button>
                        {stripeAccountId ? (
                          <button
                            type="button"
                            className="pe-btn pe-btn-ghost"
                            onClick={() => refreshStripeStatus(stripeAccountId, { toastMessage: "Stripe status refreshed" })}
                            disabled={stripeStatusBusy}
                          >
                            {stripeStatusBusy ? "Refreshing Stripe..." : "Refresh Stripe Status"}
                          </button>
                        ) : null}
                      </div>
                    </div>

                    {stripeAccountId ? (
                      <div
                        style={{
                          ...stripeActionGroupStyle,
                          background: "rgba(127,29,29,0.12)",
                          border: "1px solid rgba(248,113,113,0.18)",
                        }}
                      >
                        <div style={stripeEyebrowStyle}>Secondary action</div>
                        <div style={{ ...stripeBodyStyle, color: "rgba(254,202,202,0.86)" }}>
                          Disconnect Stripe only if this profile should stop using the current Stripe account for online invoice payments.
                        </div>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <button
                            type="button"
                            className="pe-btn pe-btn-ghost"
                            onClick={handleStripeDisconnect}
                          >
                            Disconnect Stripe
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pe-field-helper pe-company-meta">
            Storage key: <span style={{ opacity: 0.8, fontWeight: 700 }}>{PROFILE_KEY}</span>
            {savedAt ? (
              <span style={{ display: "block", marginTop: 4, opacity: 0.8 }}>
                Saved {new Date(savedAt).toLocaleString()}
              </span>
            ) : null}
            {!lastSaveOk ? (
              <span className="pe-company-save-fail" style={{ display: "block", marginTop: 6 }}>
                Save failed (storage unavailable)
              </span>
            ) : null}
          </div>
        </div>
      </div>
      {showToast ? (
        <div className="pe-toast" role="status" aria-live="polite">{toastMessage}</div>
      ) : null}
    </section>
  );
}
