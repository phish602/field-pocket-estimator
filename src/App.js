import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import EstimateForm from "./EstimateForm";
import CustomersScreen from "./screens/CustomersScreen";
import EstimatesScreen from "./screens/EstimatesScreen";
import InvoicesScreen from "./screens/InvoicesScreen";
import * as CompanyProfileScreenMod from "./screens/CompanyProfileScreen";
import * as AdvancedSettingsScreenMod from "./screens/AdvancedSettingsScreen";
import * as FinancialSnapshotScreenMod from "./screens/FinancialSnapshotScreen";
import { STORAGE_KEYS } from "./constants/storageKeys";
import "./EstimateForm.css";
import "./FieldSystem.css";
import "./AppShell.css";
import "./App.css";
const DEFAULT_LOGO = "/logo/estipaid.svg";




// __PE_RESOLVE_SCREEN__ (prevents default/named export mismatches for new screens)
const resolveScreen = (mod, fallbackName) => {
  if (!mod) return null;

  // Prefer default export, then named export
  let candidate = mod.default || (fallbackName && mod[fallbackName]) || null;

  const isReactTypeObject = (v) => v && typeof v === "object" && !!v.$$typeof;

  const pickFromObject = (obj) => {
    if (!obj || typeof obj !== "object") return null;
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "function" || isReactTypeObject(v)) return v;
    }
    return null;
  };

  if (candidate && typeof candidate === "object" && !isReactTypeObject(candidate)) {
    candidate = pickFromObject(candidate) || candidate;
  }

  if (!candidate) {
    candidate = pickFromObject(mod);
  }

  if (!candidate) return null;

  if (typeof candidate === "function" || isReactTypeObject(candidate)) return candidate;

  return null;
};

const CompanyProfileScreen = resolveScreen(CompanyProfileScreenMod, "CompanyProfileScreen");
const AdvancedSettingsScreen = resolveScreen(AdvancedSettingsScreenMod, "AdvancedSettingsScreen");
const FinancialSnapshotScreen = resolveScreen(FinancialSnapshotScreenMod, "FinancialSnapshotScreen");

/* =========================================================
   APP SHELL + CREATE FLOW OWNER
   - Create tab owns the flow (Language/Profile/Job/Estimate/Review)
   - EstimateForm remains the engine (no feature loss)
   - Header/Footer are transparent overlays; content scrolls underneath
   ========================================================= */

const LANG_KEY = "estipaid-lang";
const ESTIMATES_KEY = "estipaid-estimates-v1";
const ESTIMATES_KEY_LEGACY = "field-pocket-estimates";

function loadSavedEstimates() {
  try {
    const rawNew = localStorage.getItem(ESTIMATES_KEY);
    const rawLegacy = localStorage.getItem(ESTIMATES_KEY_LEGACY);
    const arrNew = rawNew ? JSON.parse(rawNew) : [];
    const arrLegacy = rawLegacy ? JSON.parse(rawLegacy) : [];
    const arr = Array.isArray(arrNew) && arrNew.length ? arrNew : Array.isArray(arrLegacy) ? arrLegacy : [];
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function getSavedLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en" || v === "es") return v;
  } catch {
    // ignore
  }
  return "en";
}

/* =========================
   Icons (Motif 1: Blueprint corners)
   ========================= */
function BlueprintCorners({ size = 24, strokeWidth = 2 }) {
  return null;
}

function IconBase({ children, size = 24, viewBox = "0 0 24 24" }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

function IconHome({ size = 24 }) {
  return (
    <IconBase size={size}>
      <BlueprintCorners size={24} />
      <g
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M6.5 11.2L12 6.5l5.5 4.7" />
        <path d="M8.2 10.9V18h7.6v-7.1" />
        <path d="M10.3 18v-4.2h3.4V18" opacity="0.9" />
      </g>
    </IconBase>
  );
}

function IconCustomers({ size = 24 }) {
  return (
    <IconBase size={size}>
      <BlueprintCorners size={24} />
      <g
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 12.2c1.7 0 3-1.3 3-3s-1.3-3-3-3-3 1.3-3 3 1.3 3 3 3Z" />
        <path d="M4.8 18c.8-2.5 2.6-3.8 4.2-3.8s3.4 1.3 4.2 3.8" />
        <path d="M14.2 10.2h5" opacity="0.9" />
        <path d="M14.2 13.2h4.2" opacity="0.75" />
      </g>
    </IconBase>
  );
}

function IconEstimates({ size = 24 }) {
  return (
    <IconBase size={size}>
      <BlueprintCorners size={24} />
      <g
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 6.8h8" />
        <path d="M8 10.2h8" opacity="0.85" />
        <path d="M8 13.6h6.2" opacity="0.7" />
        <path
          d="M7 6.2h10c.6 0 1 .4 1 1V18c0 .6-.4 1-1 1H7c-.6 0-1-.4-1-1V7.2c0-.6.4-1 1-1Z"
          opacity="0.95"
        />
        <path d="M17.7 8.2v1" opacity="0.7" />
        <path d="M17.7 11.6v1" opacity="0.55" />
      </g>
    </IconBase>
  );
}

function IconInvoices({ size = 24 }) {
  return (
    <IconBase size={size}>
      <BlueprintCorners size={24} />
      <g
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M8 6.5h8" />
        <path d="M8 9.8h7" opacity="0.85" />
        <path d="M8 13.1h8" opacity="0.7" />
        <path d="M6.8 6.2h10.4v13.2l-1.7-.9-1.7.9-1.7-.9-1.7.9-1.7-.9-1.7.9V6.2Z" opacity="0.95" />
        <path d="M14.6 15.3l1 1 2-2" opacity="0.85" />
      </g>
    </IconBase>
  );
}

function IconCreate({ size = 28 }) {
  return (
    <IconBase size={size} viewBox="0 0 28 28">
      <g
        stroke="currentColor"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M4 10V4h6" opacity="0.9" />
        <path d="M18 4h6v6" opacity="0.9" />
        <path d="M4 18v6h6" opacity="0.9" />
        <path d="M24 18v6h-6" opacity="0.9" />
        <path d="M14 9v10" />
        <path d="M9 14h10" />
      </g>
    </IconBase>
  );
}

/* =========================
   Overlay dimensions
   ========================= */
const HEADER_H = 60;
const FOOTER_H = 78;

/* =========================
   Top bar + bottom nav + drawer
   ========================= */
function TopBar({ onMenu, onProfile, topRightLogoSrc, showHeaderSpin, onHeaderSpinTap, onHeaderSpinLongPress, isScrolled, glassOnScroll }) {
  const src = topRightLogoSrc || "/logo/estipaid.svg";

  return (
    <div style={{ ...styles.topbar, ...(glassOnScroll && isScrolled ? styles.topbarScrolled : null) }}>
      <button
        className="pe-btn pe-btn-ghost"
        style={{ ...styles.headerIconBtn, ...styles.headerMenuIcon }}
        onClick={onMenu}
        aria-label="Open Menu"
      >
        ☰
      </button>

      

      {showHeaderSpin ? (
        <button
          type="button"
          style={styles.headerSpinBtn}
          aria-label="Go Home (Hold for Shortcuts)"
          title="Tap: Home • Hold: Shortcuts"
          onClick={(e) => {
            if (e?.currentTarget?.__lpFired) return;
            onHeaderSpinTap && onHeaderSpinTap();
          }}
          onPointerDown={(e) => {
            if (!onHeaderSpinLongPress) return;
            try { e.currentTarget.__lpFired = false; } catch {}
            const t = setTimeout(() => {
              try { e.currentTarget.__lpFired = true; } catch {}
              onHeaderSpinLongPress();
            }, 520);
            e.currentTarget.__lpTimer = t;
          }}
          onPointerUp={(e) => {
            const t = e.currentTarget.__lpTimer;
            if (t) clearTimeout(t);
            e.currentTarget.__lpTimer = null;
          }}
          onPointerCancel={(e) => {
            const t = e.currentTarget.__lpTimer;
            if (t) clearTimeout(t);
            e.currentTarget.__lpTimer = null;
          }}
        >
          <img
            src={DEFAULT_LOGO}
            alt="EstiPaid"
            className="esti-spin"
            style={styles.profileLogo}
            draggable={false}
            onError={(e) => {
              try { e.currentTarget.src = DEFAULT_LOGO; } catch {}
            }}
          />
        </button>
      ) : null}

<button
        className="pe-btn pe-btn-ghost"
        style={styles.headerIconBtn}
        onClick={onProfile}
        aria-label="Open Snapshot"
      >
        <img
          src={src}
          alt="Company logo"
          style={styles.profileLogo}
          draggable={false}
        />
      </button>
    </div>
  );
}

function BottomNav({ active, setActive, disabled, onQuickOpen }) {
  const tabs = useMemo(
    () => [
      { key: "home", label: "Home", Icon: IconHome },
      { key: "customers", label: "Customers", Icon: IconCustomers },
      { key: "create", label: "Create", Icon: IconCreate, center: true },
      { key: "estimates", label: "Estimates", Icon: IconEstimates },
      { key: "invoices", label: "Invoices", Icon: IconInvoices },
    ],
    []
  );

  const [createBump, setCreateBump] = useState(false);

  const onTab = (t) => {
    if (disabled && t.key !== "create") return;

    if (t.key === "create") {
      setCreateBump(true);
      setTimeout(() => setCreateBump(false), 260);
    }
    setActive(t.key);

    try {
      if (
        typeof navigator !== "undefined" &&
        typeof navigator.vibrate === "function"
      ) {
        navigator.vibrate(10);
      }
    } catch {
      // ignore
    }
  };
  useEffect(() => {
    const onTap = () => setActive("home");
    const onLong = () => {
      try {
        onQuickOpen && onQuickOpen();
      } catch {
        // ignore
      }
    };
    window.addEventListener("estipaid:hero-logo-tap", onTap);
    window.addEventListener("estipaid:hero-logo-longpress", onLong);
    return () => {
      window.removeEventListener("estipaid:hero-logo-tap", onTap);
      window.removeEventListener("estipaid:hero-logo-longpress", onLong);
    };
  }, [setActive, onQuickOpen]);



  useEffect(() => {
    if (active !== "create" && createBump) setCreateBump(false);
  }, [active, createBump]);

  return (
    <div style={styles.bottomnav} role="navigation" aria-label="Primary">
      {tabs.map((t) => {
        const isActive = active === t.key;
        const isCenter = !!t.center;
        const Icon = t.Icon;
        const isDisabled = disabled && t.key !== "create";

        const btnStyle = {
          ...styles.navBtn,
          opacity: isDisabled ? 0.35 : isActive ? 1 : 0.75,
          marginTop: isCenter ? -10 : 0,
          pointerEvents: isDisabled ? "none" : "auto",
        };

        const iconWrapStyle = isCenter
          ? { ...styles.navIconWrap, ...styles.createIconWrap }
          : styles.navIconWrap;

        const createWrapClass = isCenter && createBump ? "pe-create-bump" : "";

        return (
          <button
            key={t.key}
            style={btnStyle}
            onClick={() => onTab(t)}
            aria-label={t.label}
          >
            <span style={iconWrapStyle} className={createWrapClass}>
              <Icon size={isCenter ? 28 : 24} />
            </span>
            <span style={styles.navLabel}>{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}


function QuickMenu({ open, onClose, onSelect }) {
  if (!open) return null;

  const items = [
    { key: "home", label: "Home" },
    { key: "create", label: "Create" },
    { key: "estimates", label: "Estimates" },
    { key: "invoices", label: "Invoices" },
    { key: "snapshot", label: "Snapshot" },
    { key: "companyProfile", label: "Company Profile" },
  ];

  return (
    <>
      <div style={styles.quickOverlay} onClick={onClose} />
      <div style={styles.quickMenu} role="dialog" aria-modal="true" aria-label="Shortcuts">
        <div style={styles.quickTitleRow}>
          <div style={styles.quickTitle}>Shortcuts</div>
          <button
            className="pe-btn pe-btn-ghost"
            style={styles.quickClose}
            onClick={onClose}
            aria-label="Close Shortcuts"
            type="button"
          >
            ✕
          </button>
        </div>

        <div style={styles.quickGrid}>
          {items.map((it) => (
            <button
              key={it.key}
              className="pe-btn"
              type="button"
              style={styles.quickItem}
              onClick={() => onSelect(it.key)}
            >
              {it.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}


function Drawer({ open, onClose, onSelect, disabled }) {
  return (
    <>
      {open && <div style={styles.drawerOverlay} onClick={onClose} />}

      <div
        style={{
          ...styles.drawer,
          transform: open ? "translateX(0)" : "translateX(-110%)",
        }}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
      >
        <div style={styles.drawerHeader}>
          <div style={styles.drawerTitle}>Menu</div>
          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerClose}
            onClick={onClose}
            aria-label="Close Menu"
          >
            ✕
          </button>
        </div>

        <div style={styles.drawerList}>
<button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect("company")}
            disabled={disabled}
          >
            Company Profile
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect("templates")}
            disabled={disabled}
          >
            Templates
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect("advanced")}
          >
            Settings
          </button>
        </div>
      </div>
    </>
  );
}

/* =========================
   Create Flow (App owns flow; NO stepper UI)
   ========================= */
function CreateFlow({ gated, intent, spinTick }) {
  return (
    <div>
      <EstimateForm key={"estimate"} embeddedInShell forceProfileOnMount={false} spinTick={spinTick} />
    </div>
  );
}
/* =========================
   Placeholder screens (theme-safe)
   ========================= */

function HomeScreen({ spinTick, onLogoTap, onLogoLongPress }) {
  const pressTimerRef = useRef(null);
  const didLongPressRef = useRef(false);
  const LONG_PRESS_MS = 650;

  const startPress = () => {
    try { if (pressTimerRef.current) clearTimeout(pressTimerRef.current); } catch {}
    didLongPressRef.current = false;
    pressTimerRef.current = setTimeout(() => {
      didLongPressRef.current = true;
      try { onLogoLongPress && onLogoLongPress(); } catch {}
    }, LONG_PRESS_MS);
  };

  const endPress = () => {
    try { if (pressTimerRef.current) clearTimeout(pressTimerRef.current); } catch {}
    pressTimerRef.current = null;
  };

  const onTap = () => {
    if (didLongPressRef.current) return;
    try { onLogoTap && onLogoTap(); } catch {}
  };

  return (
    <div className="pe-main" style={{ paddingTop: 0 }}>
      <div style={{ width: "min(860px, calc(100% - 28px))", margin: "0 auto" }}>
      <div className="pe-card" style={{ marginTop: 10, textAlign: "center" }}>
        <div
          style={{
            fontSize: 16,
            fontWeight: 600,
            letterSpacing: "2px",
            textTransform: "uppercase",
            opacity: 0.75,
            lineHeight: 1.1,
            marginBottom: 8,
            textShadow: "0 2px 6px rgba(0,0,0,0.45), 0 6px 18px rgba(0,0,0,0.35)",
            display: "inline-flex",
            alignItems: "baseline",
            justifyContent: "center",
          }}
        >
          <span>ESTIPAID</span>
          <span
            style={{
              fontSize: 9,
              marginLeft: 2,
              position: "relative",
              top: -4,
              letterSpacing: "0px",
              opacity: 0.9,
            }}
          >
            ™
          </span>
        </div>

        <div
          role="button"
          tabIndex={0}
          onMouseDown={startPress}
          onMouseUp={endPress}
          onMouseLeave={endPress}
          onTouchStart={startPress}
          onTouchEnd={endPress}
          onTouchCancel={endPress}
          onClick={onTap}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onTap();
            }
          }}
          style={{ display: "flex", justifyContent: "center", transform: "translateX(-14px)", margin: "0 auto 10px", cursor: "pointer" }}
        >
        <img
          key={spinTick}
          className="esti-spin"
          src="/logo/estipaid.svg"
          alt="EstiPaid"
          style={{
            height: 110,
            width: "auto",
            display: "block",
            objectFit: "contain",
            filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.38))",
          }}
          draggable={false}
        />
        </div>
<div
          style={{
            marginTop: 10,
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: "2.2px",
            textTransform: "uppercase",
            background:
              "linear-gradient(90deg, rgba(255,255,255,0.96), rgba(200,210,255,0.86))",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            textShadow:
              "0 1px 0 rgba(255,255,255,0.14), 0 10px 18px rgba(0,0,0,0.34)",
            opacity: 0.98,
          }}
        >
          Turn Scope into Revenue
        </div>
      </div>

      <div className="pe-card" style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Quick Actions</div>
        <div className="pe-muted" style={{ marginBottom: 10 }}>
          Jump back in or start fresh.
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            className="pe-btn"
            type="button"
            onClick={() => {
              try {
                window.dispatchEvent(
                  new CustomEvent("pe-shell-action", {
                    detail: { action: "continueLast" },
                  })
                );
              } catch {}
            }}
            style={{ flex: "1 1 180px" }}
          >
            Continue Last Estimate
          </button>

          <button
            className="pe-btn"
            type="button"
            onClick={() => {
              try {
                window.dispatchEvent(
                  new CustomEvent("pe-shell-action", {
                    detail: { action: "newClear" },
                  })
                );
              } catch {}
              try {
                window.dispatchEvent(
                  new CustomEvent("pe-shell-action", {
                    detail: { action: "openCreate" },
                  })
                );
              } catch {}
            }}
            style={{ flex: "1 1 180px" }}
          >
            Start New Estimate
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            type="button"
            onClick={() => {
              try {
                window.dispatchEvent(
                  new CustomEvent("pe-shell-action", {
                    detail: { action: "goEstimatesTab" },
                  })
                );
              } catch {}
            }}
            style={{ flex: "1 1 180px" }}
          >
            View Estimates
          </button>
        </div>
      </div>

      <div className="pe-card" style={{ marginTop: 10 }}>
        <div style={{ fontWeight: 900, marginBottom: 8 }}>Updates</div>
        <div className="pe-muted">• Beta calculator update (coming soon)</div>
        <div className="pe-muted">• Chat estimate build (beta) (coming soon)</div>
      </div>
      </div>
    </div>
  );
}


/* =========================
   Styles (transparent overlays + legibility)
   ========================= */
const styles = {
  shell: { height: "100vh", position: "relative", overflow: "hidden" },

  // overlay header
  topbar: {
    height: HEADER_H,
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 14px",
    background: "transparent",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
  },
  

  topbarScrolled: {
    background: "rgba(10, 18, 28, 0.35)",
    borderBottom: "1px solid rgba(255,255,255,0.12)",
  },

  headerSpinBtn: {
    position: "absolute",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    background: "transparent",
    backgroundColor: "transparent",
    border: "none",
    outline: "none",
    boxShadow: "none",
    padding: 0,
    margin: 0,
    width: 44,
    height: 44,
    display: "grid",
    placeItems: "center",
    cursor: "pointer",
    pointerEvents: "auto",
    userSelect: "none",
    borderRadius: 999,
    appearance: "none",
    WebkitAppearance: "none",
    lineHeight: 0,
    fontSize: 0,
    zIndex: 5,
  },

  quickOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.42)",
    zIndex: 80,
  },
  quickMenu: {
    position: "fixed",
    top: 74,
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(520px, calc(100% - 24px))",
    zIndex: 85,
    padding: 14,
    borderRadius: 18,
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.14)",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    boxShadow: "0 20px 60px rgba(0,0,0,0.35)",
  },
  quickTitleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 12,
  },
  quickTitle: {
    fontWeight: 900,
    letterSpacing: "0.2px",
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },
  quickClose: { width: 44, height: 44, display: "grid", placeItems: "center" },
  quickGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
    gap: 10,
  },
  quickItem: {
    height: 48,
    borderRadius: 14,
    fontWeight: 900,
    letterSpacing: "0.2px",
  },

  headerIconBtn: {
    padding: 0,
    width: 44,
    height: 44,
    display: "grid",
    placeItems: "center",
    borderRadius: 12,
  },
  headerMenuIcon: {
    fontSize: 24,
    lineHeight: 1,
    fontWeight: 800,
  },
  title: {
    fontWeight: 900,
    letterSpacing: "0.2px",
    fontSize: 15,
    opacity: 0.98,
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },
  profileCircle: {
    width: 32,
    height: 32,
    borderRadius: 999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 12,
    fontWeight: 900,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },

  profileLogo: {
    width: 40,
    height: 40,
    display: "block",
    margin: "0 auto",
    objectFit: "contain",
    filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.35))",
  },

  // full-height scroll under overlays
  content: {
    position: "absolute",
    inset: 0,
    overflowY: "auto",
    WebkitOverflowScrolling: "touch",
    paddingTop: HEADER_H,
    paddingBottom: FOOTER_H + 10,
    background: "transparent",
  },

  // overlay footer
  bottomnav: {
    height: FOOTER_H,
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 50,
    display: "flex",
    justifyContent: "space-around",
    alignItems: "flex-start",
    gap: 4,
    paddingBottom: "env(safe-area-inset-bottom, 0px)",
    background: "transparent",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",
  },
  navBtn: {
    flex: 1,
    background: "transparent",
    border: "none",
    color: "inherit",
    padding: "10px 6px 12px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 16,
    cursor: "pointer",
    transition: "opacity 140ms ease, transform 90ms ease",
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },
  navIconWrap: { display: "flex", alignItems: "center", justifyContent: "center" },
  createIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.18)",
    background: "rgba(255,255,255,0.06)",
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },
  navLabel: { fontSize: 11, lineHeight: 1, letterSpacing: "0.2px" },

  // drawer overlay
  drawerOverlay: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.42)",
    zIndex: 60,
  },
  drawer: {
    position: "fixed",
    top: 0,
    left: 0,
    width: 260,
    height: "100%",
    zIndex: 65,
    padding: 14,
    background: "transparent",
    backdropFilter: "blur(12px)",
    WebkitBackdropFilter: "blur(12px)",
    transition: "transform 220ms ease",
  },
  drawerHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "6px 2px 12px",
  },
  drawerTitle: {
    fontWeight: 900,
    letterSpacing: "0.2px",
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },
  drawerClose: { width: 44, height: 44, display: "grid", placeItems: "center" },
  drawerList: { display: "flex", flexDirection: "column", gap: 8, marginTop: 6 },
  drawerItem: { textAlign: "left", width: "100%" },

  // Stepper
  stepperWrap: { padding: "10px 14px 0" },
  stepperRow: {
    display: "flex",
    gap: 8,
    overflowX: "auto",
    paddingBottom: 6,
  },
  stepPill: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 999,
    padding: "8px 10px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    color: "inherit",
    whiteSpace: "nowrap",
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },
  stepIndex: {
    width: 22,
    height: 22,
    borderRadius: 999,
    display: "grid",
    placeItems: "center",
    fontWeight: 900,
    fontSize: 12,
    background: "rgba(0,0,0,0.18)",
    border: "1px solid rgba(255,255,255,0.14)",
  },
  stepLabel: { fontWeight: 800, fontSize: 12, letterSpacing: "0.2px" },
};

export default function App() {
  // Patch localStorage.setItem so we can detect language selection inside EstimateForm (same tab)
  useEffect(() => {
    try {
      const orig = localStorage.setItem.bind(localStorage);
      if (!localStorage.__pePatched) {
        localStorage.setItem = (k, v) => {
          orig(k, v);
          try {
            window.dispatchEvent(
              new CustomEvent("pe-localstorage", { detail: { key: k, value: v } })
            );
          } catch {
            // ignore
          }
        };
        localStorage.__pePatched = true;
      }
    } catch {
      // ignore
    }
  }, []);

  const [lang] = useState(() => getSavedLang());
  const [activeTab, setActiveTab] = useState(() => "home");
const [spinTick, setSpinTick] = useState(0);
  const [estimateHistory, setEstimateHistory] = useState(() => loadSavedEstimates());

  const shellT = useCallback((key) => {
    const en = {
      estimateNumLabel: "Estimate #",
      invoiceNumLabel: "Invoice #",
    };
    const es = {
      estimateNumLabel: "Estimación #",
      invoiceNumLabel: "Factura #",
    };
    const dict = lang === "es" ? es : en;
    return dict[key] || key;
  }, [lang]);


  // ===== In-progress estimate draft (survives tab switches) =====
  const ESTIMATE_DRAFT_KEY = "estipaid-estimate-draft-v1";
  const hasEstimateDraft = () => {
    try {
      const raw = localStorage.getItem(ESTIMATE_DRAFT_KEY);
      if (!raw) return false;
      // If it's just an empty object, treat as no draft
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return raw.length > 10;
      const keys = Object.keys(parsed).filter((k) => !String(k).startsWith("__") && k !== "savedAt");
      if (!keys.length) return false;
      // any meaningful value
      for (const k of keys) {
        const v = parsed[k];
        if (v === null || v === undefined) continue;
        if (typeof v === "string" && v.trim()) return true;
        if (typeof v === "number" && Number.isFinite(v) && v !== 0) return true;
        if (typeof v === "boolean" && v === true) return true;
        if (Array.isArray(v) && v.length) return true;
        if (typeof v === "object" && Object.keys(v).length) return true;
      }
      return false;
    } catch {
      try {
        return !!localStorage.getItem(ESTIMATE_DRAFT_KEY);
      } catch {
        return false;
      }
    }
  };

  const navigateTo = useCallback((tab) => {
    try {
      if (activeTab === "create" && tab !== "create") {
        try { localStorage.setItem("estipaid-restore-draft-on-create-v1", "1"); } catch {}
        window.dispatchEvent(new Event("estipaid:draft-save-now"));
      }
    } catch {}
    try {
      setActiveTab(tab);
    } catch {}
  }, [activeTab]);

  // ✅ Navigate to Customers screen (used by EstimateForm "Create New" shortcut)
  useEffect(() => {
    const onNavCustomers = () => {
      try { navigateTo("customers"); } catch {}
    };
    window.addEventListener("estipaid:navigate-customers", onNavCustomers);
    return () => window.removeEventListener("estipaid:navigate-customers", onNavCustomers);
  }, [navigateTo]);

  useEffect(() => {
    const onNavEstimates = () => {
      try { navigateTo("estimates"); } catch {}
    };
    const onNavInvoices = () => {
      try { navigateTo("invoices"); } catch {}
    };
    window.addEventListener("estipaid:navigate-estimates", onNavEstimates);
    window.addEventListener("estipaid:navigate-invoices", onNavInvoices);
    return () => {
      window.removeEventListener("estipaid:navigate-estimates", onNavEstimates);
      window.removeEventListener("estipaid:navigate-invoices", onNavInvoices);
    };
  }, [navigateTo]);

  useEffect(() => {
    const onNavEstimator = () => {
      try {
        setCreateIntent("estimate");
        navigateTo("create");
      } catch {}
    };
    window.addEventListener("estipaid:navigate-estimator", onNavEstimator);
    return () => window.removeEventListener("estipaid:navigate-estimator", onNavEstimator);
  }, [navigateTo]);

  useEffect(() => {
    const onNavCompanyProfile = () => {
      try { navigateTo("companyProfile"); } catch {}
    };
    window.addEventListener("estipaid:navigate-company-profile", onNavCompanyProfile);
    return () => window.removeEventListener("estipaid:navigate-company-profile", onNavCompanyProfile);
  }, [navigateTo]);

  useEffect(() => {
    const refresh = () => setEstimateHistory(loadSavedEstimates());
    refresh();
    const onStorage = (e) => {
      if (!e?.key || e.key === ESTIMATES_KEY || e.key === ESTIMATES_KEY_LEGACY) refresh();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener("estipaid:navigate-estimates", refresh);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("estipaid:navigate-estimates", refresh);
    };
  }, []);

  useEffect(() => {
    const onShellAction = (evt) => {
      const action = String(evt?.detail?.action || "");
      if (!action) return;

      if (action === "continueLast" || action === "openCreate") {
        setCreateIntent("estimate");
        navigateTo("create");
        return;
      }

      if (action === "newClear") {
        try { localStorage.removeItem("estipaid-estimator-v1"); } catch {}
        try { localStorage.removeItem("estipaid-estimate-draft-v1"); } catch {}
        return;
      }

      if (action === "goEstimatesTab") {
        navigateTo("estimates");
        return;
      }

      if (action === "openCompanyProfile") {
        navigateTo("companyProfile");
      }
    };

    window.addEventListener("pe-shell-action", onShellAction);
    return () => window.removeEventListener("pe-shell-action", onShellAction);
  }, [navigateTo]);

  // Warn on refresh/close if a draft exists (draft is still saved, but prevents surprise)
  useEffect(() => {
    const onBeforeUnload = (e) => {
      if (!hasEstimateDraft()) return;
      e.preventDefault();
      e.returnValue = "";
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);


  
  const contentRef = useRef(null);
  const [isScrolled, setIsScrolled] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
useEffect(() => {
    setSpinTick((v) => v + 1);
    try { if (contentRef.current) contentRef.current.scrollTop = 0; } catch {}
    setIsScrolled(false);
    setQuickOpen(false);
  }, [activeTab]);
const [drawerOpen, setDrawerOpen] = useState(false);
  const [createIntent, setCreateIntent] = useState("estimate");

  // Keep a tiny global flag so nested screens can hard-lock into profile when requested
  useEffect(() => {
    try {
      window.__PE_FORCE_PROFILE__ = createIntent === "profile";
    } catch {
      // ignore
    }
  }, [createIntent]);
const gated = false;
  const topRightLogoSrc = useMemo(() => {
    const DEFAULT = "/logo/estipaid.svg";
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE);
      if (!raw) return DEFAULT;
      const obj = JSON.parse(raw);
      const candidates = [
        obj?.logoDataUrl,
        obj?.logo,
        obj?.logoUrl,
        obj?.logoData,
        obj?.companyLogo,
      ];
      const picked = candidates.find((s) => typeof s === "string" && s.trim().length > 0);
      return picked || DEFAULT;
    } catch {
      return DEFAULT;
    }
  // activeTab intentionally triggers a re-read of localStorage when the user
  // navigates between tabs (e.g. after saving a new company logo); activeTab is
  // not referenced inside the callback body so exhaustive-deps flags it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);


  const handleHomeLogoTap = () => {
    try { navigateTo("home"); } catch {}
  };
  const handleHomeLogoLongPress = () => {
    try { setQuickOpen(true); } catch {}
  };

  const renderScreen = () => {
    if (activeTab === "home") return <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} />;
    if (activeTab === "customers")
      return (
        <CustomersScreen
          lang={lang}
          onDone={(p) => {
            try {
              const id = String(p?.id || "");
              if (id) {
                try { localStorage.setItem("estipaid-selectedCustomerId-v1", id); } catch {}
                try { localStorage.setItem("estipaid-selectedCustomerSnap-v1", JSON.stringify(p?.customer || null)); } catch {}
                try { window.dispatchEvent(new CustomEvent("estipaid:customer-use", { detail: { id, customer: p?.customer || null } })); } catch {}
              }
            } catch {}
            try {
              navigateTo("create");
            } catch {}
          }}
        />
      );
    if (activeTab === "estimates") {
      return (
        <EstimatesScreen
          lang={lang}
          t={shellT}
          spinTick={spinTick}
          history={estimateHistory}
          onDone={() => navigateTo("home")}
          onOpenEstimate={() => {
            setCreateIntent("estimate");
            navigateTo("create");
          }}
        />
      );
    }
    if (activeTab === "invoices") {
      return (
        <InvoicesScreen
          lang={lang}
          t={shellT}
          spinTick={spinTick}
          onDone={() => navigateTo("home")}
        />
      );
    }
    if (activeTab === "companyProfile") return CompanyProfileScreen ? <CompanyProfileScreen /> : <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} />;
    if (activeTab === "advanced") return AdvancedSettingsScreen ? <AdvancedSettingsScreen /> : <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} />;
    if (activeTab === "snapshot") return FinancialSnapshotScreen ? <FinancialSnapshotScreen /> : <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} />;
    if (activeTab === "create") return <CreateFlow gated={gated} intent={createIntent} spinTick={spinTick} />;
    return <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} />;
  };

  const onDrawerSelect = (key) => {
    setDrawerOpen(false);

    if (key === "create") {
      setCreateIntent("estimate");
      navigateTo("create");
      return;
    }

    // Create navigation
    if (key === "advanced") {
      navigateTo("advanced");
      return;
    }

// Company Profile / Templates
    if (key === "company") {
      navigateTo("companyProfile");
      return;
    }
    if (key === "templates") {
      setCreateIntent("estimate");
      navigateTo("create");
      return;
    }

// Create actions
    if (key === "editCompany") {
      navigateTo("snapshot");
      return;
    }

// Fallback: close only
  };
  const showHeaderSpin = activeTab !== "home" && activeTab !== "companyProfile";
  const glassOnScroll = activeTab !== "home" && activeTab !== "create";

  return (
    <div className="pe-wrap pe-app" style={styles.shell}>
      
      {showHeaderSpin ? (
        <style>{`.pe-content img.esti-spin{ display:none !important; }`}</style>
      ) : null}
<style>{`
        @media (prefers-reduced-motion: no-preference){
          .pe-create-bump{ animation: peCreateBump 260ms ease-out; }
          @keyframes peCreateBump{
            0%{ transform: scale(0.96); }
            45%{ transform: scale(1.08); }
            100%{ transform: scale(1.00); }
          }
        }

@keyframes estiSpinPremium{
  0%{transform:rotate(0deg);}
  82%{transform:rotate(372deg);}
  100%{transform:rotate(360deg);}
}
.esti-spin{
  animation:estiSpinPremium 0.6s cubic-bezier(.22,.9,.28,1);
  transform-origin:50% 50%;
  will-change:transform;
  animation-fill-mode: both;
}
      `}</style>

      <TopBar
        topRightLogoSrc={topRightLogoSrc}
        showHeaderSpin={showHeaderSpin}
        glassOnScroll={glassOnScroll}
        isScrolled={isScrolled}
        onHeaderSpinTap={() => {
          setQuickOpen(false);
          navigateTo("home");
        }}
        onHeaderSpinLongPress={() => {
          setQuickOpen(true);
        }}
        onMenu={() => setDrawerOpen(true)}
        onProfile={() => {
          setDrawerOpen(false);
          navigateTo("snapshot");
        }}
      />
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSelect={onDrawerSelect}
        disabled={gated}
      />

      

      <QuickMenu
        open={quickOpen}
        onClose={() => setQuickOpen(false)}
        onSelect={(key) => {
          setQuickOpen(false);
          if (key === "home") {
            navigateTo("home");
            return;
          }
          if (key === "create") {
            setCreateIntent("estimate");
            navigateTo("create");
            return;
          }
          if (key === "estimates") {
            navigateTo("estimates");
            return;
          }
          if (key === "invoices") {
            navigateTo("invoices");
            return;
          }
          if (key === "snapshot") {
            navigateTo("snapshot");
            return;
          }
          if (key === "companyProfile") {
            navigateTo("companyProfile");
            return;
          }
        }}
      />
<div
        ref={contentRef}
        className={`pe-content${activeTab === "create" ? " pe-content-estimator" : ""}`}
        style={styles.content}
        onScroll={(e) => {
          const st = e.currentTarget ? e.currentTarget.scrollTop : 0;
          const next = st > 6;
          if (next !== isScrolled) setIsScrolled(next);
        }}
      >
        {renderScreen()}
      </div>

      <BottomNav
        active={activeTab}
        setActive={(key) => {
          if (key === "create") setCreateIntent("estimate");
          navigateTo(key);
        }}
        onQuickOpen={() => setQuickOpen(true)}
        disabled={gated}
      />
    </div>
  );
}
