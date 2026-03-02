// @ts-nocheck
/* eslint-disable */
import { useEffect, useMemo, useRef, useState } from "react";
import Field from "../components/Field";
import { STORAGE_KEYS } from "../constants/storageKeys";

const PROFILE_KEY = STORAGE_KEYS.COMPANY_PROFILE;
const PROFILE_KEY_LEGACY = STORAGE_KEYS.COMPANY_PROFILE_LEGACY_1;
const PROFILE_KEY_LEGACY2 = STORAGE_KEYS.COMPANY_PROFILE_LEGACY_2;

const DEFAULT_PROFILE = {
  companyName: "",
  phone: "",
  email: "",
  address: "",
  logoDataUrl: "",
  roc: "",
  attn: "",
  website: "",
  ein: "",
  terms: "",
};

function isRequiredComplete(p) {
  const nameOk = Boolean(p?.companyName && String(p.companyName).trim());
  const phoneOk = Boolean(p?.phone && String(p?.phone).trim());
  const emailOk = Boolean(p?.email && String(p?.email).trim());
  const addrOk = Boolean(p?.address && String(p?.address).trim());
  return nameOk && phoneOk && emailOk && addrOk;
}

function loadProfile() {
  try {
    let raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) {
      raw = localStorage.getItem(PROFILE_KEY_LEGACY) || localStorage.getItem(PROFILE_KEY_LEGACY2) || "";
      if (raw) {
        try {
          localStorage.setItem(PROFILE_KEY, raw);
          localStorage.removeItem(PROFILE_KEY_LEGACY);
          localStorage.removeItem(PROFILE_KEY_LEGACY2);
        } catch {}
      }
    }
    if (!raw) return { ...DEFAULT_PROFILE };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PROFILE, ...(parsed || {}) };
  } catch {
    return { ...DEFAULT_PROFILE };
  }
}

function saveProfile(p) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p || {}));
    try {
      // notify shell listeners
      window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: PROFILE_KEY, value: JSON.stringify(p || {}) } }));
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
  const [profile, setProfile] = useState(() => loadProfile());
  const [lastSaveOk, setLastSaveOk] = useState(true);
  const [savedAt, setSavedAt] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  const requiredComplete = useMemo(() => isRequiredComplete(profile), [profile]);
  const existingSavedRef = useRef(null);

  useEffect(() => {
    try {
      existingSavedRef.current = localStorage.getItem(PROFILE_KEY) || null;
    } catch {
      existingSavedRef.current = null;
    }
  }, []);

  // autosave (keeps your prior behavior)
  useEffect(() => {
    const t = setTimeout(() => {
      const ok = saveProfile(profile);
      setLastSaveOk(ok);
      try {
        setSavedAt(Date.now());
      } catch {}
    }, 250);
    return () => clearTimeout(t);
  }, [profile]);

  const doExplicitSave = () => {
    let existingRaw = null;
    try {
      existingRaw = localStorage.getItem(PROFILE_KEY);
    } catch {
      existingRaw = null;
    }

    if (existingRaw) {
      let same = false;
      try {
        const normalizedExisting = JSON.stringify({ ...DEFAULT_PROFILE, ...(JSON.parse(existingRaw || "{}") || {}) });
        const normalizedCurrent = JSON.stringify({ ...DEFAULT_PROFILE, ...(profile || {}) });
        same = normalizedExisting === normalizedCurrent;
      } catch {
        same = false;
      }
      if (!same) {
        const ok = window.confirm("Overwrite saved company profile?");
        if (!ok) return;
      }
    }

    const ok = saveProfile(profile);
    setLastSaveOk(ok);
    try {
      setSavedAt(Date.now());
    } catch {}
  };

  const doClearProfile = () => {
    try {
      localStorage.removeItem(PROFILE_KEY);
    } catch {}
    try {
      localStorage.removeItem(PROFILE_KEY_LEGACY);
    } catch {}
    try {
      localStorage.removeItem(PROFILE_KEY_LEGACY2);
    } catch {}

    setProfile({ ...DEFAULT_PROFILE });
    setLastSaveOk(true);
    setSavedAt(null);
    setShowClearConfirm(false);

    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", { detail: { key: PROFILE_KEY, value: "" } }));
    } catch {}
  };

  const pill = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: requiredComplete ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)",
    fontSize: 12,
    fontWeight: 900,
    letterSpacing: "0.4px",
    whiteSpace: "nowrap",
  };

  const dot = {
    width: 9,
    height: 9,
    borderRadius: 999,
    background: requiredComplete ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)",
    boxShadow: requiredComplete ? "0 0 0 3px rgba(34,197,94,0.15)" : "0 0 0 3px rgba(239,68,68,0.15)",
  };

  const actions = {
    display: "flex",
    gap: 10,
    alignItems: "center",
    flexWrap: "wrap",
    justifyContent: "flex-end",
  };

  const btn = {
    padding: "10px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.92)",
    fontWeight: 900,
    letterSpacing: "0.4px",
    cursor: "pointer",
  };

  const btnPrimary = {
    ...btn,
    background: "rgba(34,197,94,0.12)",
    border: "1px solid rgba(34,197,94,0.30)",
  };

  const btnDanger = {
    ...btn,
    background: "rgba(239,68,68,0.12)",
    border: "1px solid rgba(239,68,68,0.30)",
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
            <div style={modalTitle}>Clear company profile?</div>
            <div style={modalText}>
              This will erase your saved company info and logo from this device. This cannot be undone.
            </div>
            <div style={modalActions}>
              <button type="button" style={btn} onClick={() => setShowClearConfirm(false)}>
                Cancel
              </button>
              <button type="button" style={btnDanger} onClick={doClearProfile}>
                Erase
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div
        className="pe-section-title"
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
      >
        <div>Company Profile</div>

        <div style={actions}>
          <button type="button" style={btnPrimary} onClick={doExplicitSave}>
            Save
          </button>
          <button type="button" style={btnDanger} onClick={() => setShowClearConfirm(true)}>
            Clear
          </button>
          <div style={pill} title={requiredComplete ? "Required fields complete" : "Fill required fields to complete"}>
            <span aria-hidden="true" style={dot} />
            {requiredComplete ? "Company info complete" : "Company info incomplete"}
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        <Field
          label="Company name *"
          value={profile.companyName}
          onChange={(e) => setProfile((p) => ({ ...p, companyName: e.target.value }))}
        />

        <Field
          label="Phone *"
          value={profile.phone}
          onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
        />

        <Field
          label="Email *"
          value={profile.email}
          onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))}
        />

        <Field
          label="Address *"
          value={profile.address}
          onChange={(e) => setProfile((p) => ({ ...p, address: e.target.value }))}
        />

        <div className="pe-field">
          <div className="pe-field-label">Logo</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            <input
              className="pe-input"
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const f = e.target.files && e.target.files[0];
                if (!f) return;
                const dataUrl = await fileToDataUrl(f);
                setProfile((p) => ({ ...p, logoDataUrl: dataUrl || "" }));
              }}
            />
            {profile.logoDataUrl ? (
              <img
                src={profile.logoDataUrl}
                alt="Company logo"
                style={{ width: 64, height: 64, borderRadius: 14, objectFit: "contain", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.12)", padding: 6 }}
              />
            ) : (
              <div className="pe-field-helper">No logo uploaded</div>
            )}
          </div>
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <Field
            label="ROC"
            value={profile.roc}
            onChange={(e) => setProfile((p) => ({ ...p, roc: e.target.value }))}
          />
          <Field
            label="ATTN"
            value={profile.attn}
            onChange={(e) => setProfile((p) => ({ ...p, attn: e.target.value }))}
          />
        </div>

        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
          <Field
            label="Website"
            value={profile.website}
            onChange={(e) => setProfile((p) => ({ ...p, website: e.target.value }))}
          />
          <Field
            label="EIN"
            value={profile.ein}
            onChange={(e) => setProfile((p) => ({ ...p, ein: e.target.value }))}
          />
        </div>

        <Field
          as="textarea"
          label="Payment terms / notes"
          value={profile.terms}
          onChange={(e) => setProfile((p) => ({ ...p, terms: e.target.value }))}
          style={{ minHeight: 110, resize: "vertical" }}
        />

        <div className="pe-field-helper">
          Storage key: <span style={{ opacity: 0.95, fontWeight: 800 }}>{PROFILE_KEY}</span>
          {savedAt ? (
            <span style={{ display: "block", marginTop: 6, opacity: 0.82 }}>
              Saved {new Date(savedAt).toLocaleString()}
            </span>
          ) : null}
          {!lastSaveOk ? (
            <span style={{ display: "block", marginTop: 6, color: "rgba(239,68,68,0.92)", fontWeight: 900 }}>
              Save failed (storage unavailable)
            </span>
          ) : null}
        </div>
      </div>
    </section>
  );
}
