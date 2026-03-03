// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from "react";
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
  const [logoFileName, setLogoFileName] = useState("");
  const [lastSavedSnapshot, setLastSavedSnapshot] = useState(() => serializeProfileState(initialProfileRef.current));
  const [showMissingRequiredPrompt, setShowMissingRequiredPrompt] = useState(false);
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
        const ok = window.confirm("Overwrite saved User Profile?");
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
      if (saveFlashTimerRef.current) clearTimeout(saveFlashTimerRef.current);
      saveFlashTimerRef.current = setTimeout(() => {
        setSaveFlash(false);
        saveFlashTimerRef.current = null;
      }, 1500);
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

    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: PROFILE_KEY, value: "" } }));
    } catch {}
  };

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

  return (
    <section className="pe-section">
      {showClearConfirm ? (
        <div style={modalOverlay} role="dialog" aria-modal="true">
          <div style={modalCard}>
            <div style={modalTitle}>Clear all User Profile fields?</div>
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
            <h1 className="pe-title pe-builder-title pe-company-title pe-title-reflect" data-title="User Profile">User Profile</h1>
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
              Please complete the highlighted fields to save your User Profile.
            </div>
            <ul className="pe-company-missing-list">
              {missingRequiredFields.map((fieldKey) => (
                <li key={fieldKey}>{REQUIRED_FIELD_META[fieldKey]?.label || fieldKey}</li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="pe-company-form-inner">
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
                  placeholder="BVW Contracting Solutions"
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
                  value={formatPhoneForDisplay(profile.phone)}
                  placeholder="(602) 555-1234"
                  onChange={(e) => setProfile((p) => ({ ...p, phone: sanitizePhoneDigits(e.target.value, 11) }))}
                />

                <Field
                  fieldClassName="pe-company-col-7"
                  label="Email"
                  type="email"
                  autoComplete="email"
                  value={profile.email}
                  placeholder="office@yourcompany.com"
                  onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
                />

                <Field
                  fieldClassName="pe-company-col-12"
                  label="Website"
                  value={profile.website}
                  placeholder="www.yourcompany.com"
                  onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))}
                />
              </div>
            </div>

            <div id="company-profile-branding" ref={brandingCardRef} className="pe-card pe-card-content pe-company-top-branding-col pe-company-branding-card pe-branding-tile">
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
                placeholder="1234 E Camelback Rd"
                onChange={(e) => setProfile((p) => ({ ...p, addressLine1: e.target.value }))}
              />

              <Field
                fieldClassName="pe-company-col-12"
                label="Address line 2"
                autoComplete="address-line2"
                value={profile.addressLine2}
                placeholder="Suite / Unit (optional)"
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
                placeholder="Phoenix"
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
    </section>
  );
}
