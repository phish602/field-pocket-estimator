// CompanyProfileScreen.js
// Clean company profile store for EstiPaid (separate from legacy scripts)
// NOTE: One-file edit only. No new buttons.

import React, { useEffect, useMemo, useRef, useState } from "react";

const PROFILE_KEY = "estipaid-company-profile-v1";
const PROFILE_KEY_LEGACY = "field-pocket-profile-v1";

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

function loadProfile(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return { ...DEFAULT_PROFILE, ...parsed };
  } catch {
    return null;
  }
}

function saveProfile(key, profile) {
  try {
    localStorage.setItem(key, JSON.stringify(profile));
    return true;
  } catch {
    // If storage is full (often due to a large logo), save without logo.
    try {
      const { logoDataUrl, ...rest } = profile || {};
      localStorage.setItem(key, JSON.stringify({ ...DEFAULT_PROFILE, ...rest, logoDataUrl: "" }));
      return false;
    } catch {
      return false;
    }
  }
}

function isRequiredComplete(p) {
  const v = p || {};
  return Boolean(
    String(v.companyName || "").trim() &&
      String(v.phone || "").trim() &&
      String(v.email || "").trim() &&
      String(v.address || "").trim()
  );
}

export default function CompanyProfileScreen() {
  const [profile, setProfile] = useState(() => {
    // Prefer new key. If missing, do a one-time clean migration from legacy IF present.
    const current = loadProfile(PROFILE_KEY);
    if (current) return current;

    const legacy = loadProfile(PROFILE_KEY_LEGACY);
    if (legacy && isRequiredComplete(legacy)) {
      // clean migrate into new key, but keep fields identical
      try {
        localStorage.setItem(PROFILE_KEY, JSON.stringify(legacy));
      } catch {}
      return legacy;
    }

    return { ...DEFAULT_PROFILE };
  });

  const [lastSaveOk, setLastSaveOk] = useState(true);
  const saveTimerRef = useRef(null);

  const requiredComplete = useMemo(() => isRequiredComplete(profile), [profile]);

  useEffect(() => {
    // Debounced autosave (no buttons)
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    saveTimerRef.current = setTimeout(() => {
      const ok = saveProfile(PROFILE_KEY, profile);
      setLastSaveOk(ok);
    }, 250);

    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [profile]);

  const onField = (key) => (e) => {
    const val = e?.target?.value ?? "";
    setProfile((p) => ({ ...p, [key]: val }));
  };

  const onLogoFile = async (e) => {
    const file = e?.target?.files?.[0];
    if (!file) return;

    if (!/^image\//.test(file.type || "")) return;

    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      setProfile((p) => ({ ...p, logoDataUrl: dataUrl }));
    } catch {
      // ignore
    }
  };

  const page = {
    padding: 16,
    maxWidth: 860,
    margin: "0 auto",
    color: "rgba(255,255,255,0.92)",
  };

  const card = {
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.10)",
    background: "rgba(10,14,22,0.55)",
    boxShadow: "0 10px 26px rgba(0,0,0,0.45)",
    padding: 16,
  };

  const h1 = {
    margin: "4px 0 2px",
    fontSize: 18,
    fontWeight: 900,
    letterSpacing: "1.2px",
    textTransform: "uppercase",
  };

  const sub = {
    margin: 0,
    opacity: 0.7,
    fontSize: 12,
    letterSpacing: "0.6px",
  };

  const grid = {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 12,
    marginTop: 14,
  };

  const full = {
    gridColumn: "1 / -1",
  };

  const label = {
    display: "block",
    fontSize: 12,
    fontWeight: 800,
    opacity: 0.78,
    letterSpacing: "0.5px",
    marginBottom: 6,
    textTransform: "uppercase",
  };

  const input = {
    width: "100%",
    padding: "12px 12px",
    borderRadius: 12,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(255,255,255,0.06)",
    color: "rgba(255,255,255,0.92)",
    outline: "none",
    boxSizing: "border-box",
  };

  const textarea = {
    ...input,
    minHeight: 96,
    resize: "vertical",
  };

  const pill = {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.14)",
    background: requiredComplete ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.10)",
    marginTop: 10,
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.4px",
  };

  const dot = {
    width: 8,
    height: 8,
    borderRadius: 999,
    background: requiredComplete ? "#22c55e" : "#ef4444",
    boxShadow: "0 0 0 4px rgba(255,255,255,0.04)",
  };

  const helper = {
    marginTop: 10,
    fontSize: 12,
    opacity: 0.72,
    lineHeight: 1.35,
  };

  const hr = {
    height: 1,
    border: "none",
    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.14), transparent)",
    margin: "14px 0",
  };

  const logoWrap = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    marginTop: 10,
  };

  const logoBox = {
    width: 110,
    height: 110,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.12)",
    background: "rgba(255,255,255,0.05)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    flex: "0 0 auto",
  };

  const logoImg = {
    width: "100%",
    height: "100%",
    objectFit: "contain",
    display: "block",
    filter: "drop-shadow(0 10px 18px rgba(0,0,0,0.35))",
  };

  return (
    <div style={page}>
      <div style={card}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div>
            <div style={h1}>Company Profile</div>
            <p style={sub}>Autosaves. Used for PDFs and headers.</p>
          </div>

          <div
            style={pill}
            title={requiredComplete ? "Required fields complete" : "Fill required fields to complete"}
          >
            <span aria-hidden="true" style={dot} />
            {requiredComplete ? "Company complete" : "Company incomplete"}
          </div>
        </div>

        <div style={helper}>
          Required: Company name, phone, email, address.
          <br />
          Storage key: <span style={{ opacity: 0.95, fontWeight: 800 }}>{PROFILE_KEY}</span>
          {!lastSaveOk ? (
            <span style={{ display: "block", marginTop: 6, color: "rgba(254, 202, 202, 0.98)" }}>
              Logo may be too large for storage. Text fields saved; logo cleared.
            </span>
          ) : null}
        </div>

        <hr style={hr} />

        <div style={grid}>
          <div style={full}>
            <label style={label}>Logo upload</label>
            <div style={logoWrap}>
              <div style={logoBox}>
                {profile.logoDataUrl ? (
                  <img src={profile.logoDataUrl} alt="Company logo" style={logoImg} />
                ) : (
                  <span style={{ opacity: 0.55, fontSize: 12, fontWeight: 800 }}>No logo</span>
                )}
              </div>
              <div style={{ flex: "1 1 auto", minWidth: 220 }}>
                <input type="file" accept="image/*" onChange={onLogoFile} style={input} />
                <div style={{ marginTop: 8, fontSize: 12, opacity: 0.68 }}>
                  Tip: Use a smaller PNG/SVG-export image to avoid storage limits.
                </div>
              </div>
            </div>
          </div>

          <div>
            <label style={label}>Company name *</label>
            <input style={input} value={profile.companyName} onChange={onField("companyName")} placeholder="Company name" />
          </div>

          <div>
            <label style={label}>Attn / Contact</label>
            <input style={input} value={profile.attn} onChange={onField("attn")} placeholder="Attn / Contact" />
          </div>

          <div>
            <label style={label}>Phone *</label>
            <input style={input} value={profile.phone} onChange={onField("phone")} placeholder="555-555-5555" />
          </div>

          <div>
            <label style={label}>Email *</label>
            <input style={input} value={profile.email} onChange={onField("email")} placeholder="email@company.com" />
          </div>

          <div style={full}>
            <label style={label}>Address *</label>
            <input style={input} value={profile.address} onChange={onField("address")} placeholder="Address" />
          </div>

          <div>
            <label style={label}>ROC #</label>
            <input style={input} value={profile.roc} onChange={onField("roc")} placeholder="ROC #" />
          </div>

          <div>
            <label style={label}>Website</label>
            <input style={input} value={profile.website} onChange={onField("website")} placeholder="Website" />
          </div>

          <div>
            <label style={label}>EIN / Tax ID</label>
            <input style={input} value={profile.ein} onChange={onField("ein")} placeholder="EIN / Tax ID" />
          </div>

          <div style={full}>
            <label style={label}>Default terms</label>
            <textarea style={textarea} value={profile.terms} onChange={onField("terms")} placeholder="Default terms (ex: Net 15)" />
          </div>
        </div>
      </div>
    </div>
  );
}
