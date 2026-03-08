import { useCallback, useEffect, useMemo, useState, useRef, useId } from "react";
import EstimateForm from "./EstimateForm";
import CustomersScreen from "./screens/CustomersScreen";
import EstimatesScreen from "./screens/EstimatesScreen";
import InvoicesScreen from "./screens/InvoicesScreen";
import * as CompanyProfileScreenMod from "./screens/CompanyProfileScreen";
import * as AdvancedSettingsScreenMod from "./screens/AdvancedSettingsScreen";
import * as FinancialSnapshotScreenMod from "./screens/FinancialSnapshotScreen";
import { STORAGE_KEYS } from "./constants/storageKeys";
import { ROUTES, BUILDER_INTENTS } from "./constants/routes";
import { requireCompanyProfile } from "./utils/guards";
import { migrateLegacyStorageNamespace } from "./utils/storage";
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

function EstiPaidInlineLogo({ className, style, svgRef, draggable = false, title = "EstiPaid" }) {
  const baseId = useId().replace(/:/g, "");
  const grad0 = `${baseId}-linear-gradient`;
  const grad1 = `${baseId}-linear-gradient1`;

  return (
    <svg
      ref={svgRef}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 268.8 222.72"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={title}
      className={className}
      style={{
        ...style,
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        touchAction: "manipulation",
      }}
      draggable={draggable}
      onContextMenu={(e) => e.preventDefault()}
    >
      <title>{title}</title>
      <defs>
        <linearGradient id={grad0} x1="844.97" y1="819.67" x2="36.51" y2="1065.46" gradientTransform="translate(39.09 -127.78) scale(.24)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#b6d4a5" />
          <stop offset=".58" stopColor="#4d9ab3" />
          <stop offset=".9" stopColor="#3b78ba" />
          <stop offset="1" stopColor="#3f68a0" />
        </linearGradient>
        <linearGradient id={grad1} x1="507.94" y1="730.58" x2="102.96" y2="892.1" gradientTransform="translate(39.09 -127.78) scale(.24)" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#78b1ad" />
          <stop offset="1" stopColor="#427eaf" />
        </linearGradient>
      </defs>
      <path fill={`url(#${grad0})`} d="M181.28,46.03c-4.88-.08-9.76-.16-14.63-.24-8.92.21-18.57.21-27.58,0-7.73.21-16.16.21-23.98,0-12.28.18-24.62.2-37.03.05l.11-.29c1.62-4.34,6.62-9.65,10.25-12.8,13.09-11.33,29.35-16.21,46.44-18.35h91.32s-1.42,10.63-1.42,10.63c-2.36,11.92-5.96,23.48-11.39,34.33l-2.1,4.21c-5.95,11.89-16.42,25.06-26.28,34.13-8.66,7.97-17.95,15.01-28.34,20.51l-4.58,2.42c-8.17,4.32-18.12,8.2-26.89,11.21-10.68,3.67-19.71,7.15-28.2,14.76-3.91,3.5-7.06,7.5-9.78,12.03-6.85,11.39-10.32,24.01-12.58,37.06l-2.29,13.27c-.93-1.8-1.17-3.43-1.55-5.25l-5.84-27.87-2.78-16.9-2.19-15.81-1.21-12.46-.17-3.85c-.29-6.49.22-13.09,4.76-18.14,1.68-1.87,3.44-3.31,5.69-4.45,3.91-1.98,8.09-3.39,12.48-4,.66-.09,1.3-.22,1.97-.22l34.62-.14c2.97-.01,9.92-1.8,12.89-2.74,4.57-1.44,8.75-3.32,13.09-5.34,6.41-2.98,18.52-11.27,23.65-15.92l2.55-2.31c7.32-6.64,13.44-14.27,18.79-22.61.9-1.4,1.33-2.82,2.47-4.06.15-.16.06-.66-.02-.88h-10.25Z" />
      <path fill={`url(#${grad1})`} d="M92.8,85.35c-6.77.08-13.64.08-20.62,0-2.92-.03-5.82-.08-8.71-.15-.32.11-.64.22-.97.33,2.13-9.76,4.84-18.49,9.03-27.28h96.15s-8.35,8.28-8.35,8.28c-7.3,7.23-25.14,18.65-35.38,18.69l-31.16.13Z" />
      <path fill="#4994b4" d="M115.1,45.79c.21.07.21.15,0,.24h-15.11c-7.23.21-14.82.21-22.06,0-.11-.24.18-.32.24-.48-.03.09.07.24.28.24h36.64Z" />
      <path fill="#70adae" d="M166.65,45.79c.21.07.21.15,0,.24h-27.58c-.21-.07-.21-.15,0-.24h27.58Z" />
      <rect fill="#58a0b1" x="115.1" y="45.79" width="23.98" height=".24" />
      <path fill="#4987af" d="M92.8,85.35h-20.62c6.68-.6,13.48,0,20.35-.29.17,0,.31.26.27.29Z" />
      <path fill="#87baab" d="M181.28,46.03h-14.63v-.24h14.36c.18,0,.29.15.26.24Z" />
    </svg>
  );
}

/* =========================================================
   APP SHELL + CREATE FLOW OWNER
   - Create tab owns the flow (Language/Profile/Job/Estimate/Review)
   - EstimateForm remains the engine (no feature loss)
   - Header/Footer are transparent overlays; content scrolls underneath
   ========================================================= */

const LANG_KEY = STORAGE_KEYS.LANG;
const ESTIMATES_KEY = STORAGE_KEYS.ESTIMATES;
const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";

try {
  migrateLegacyStorageNamespace();
} catch {}

function loadSavedEstimates() {
  try {
    const raw = localStorage.getItem(ESTIMATES_KEY);
    const arr = raw ? JSON.parse(raw) : [];
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
function TopBar({
  onMenu,
  onProfile,
  topRightLogoSrc,
  showAddLogoCue,
  showHeaderSpin,
  onHeaderSpinTap,
  onHeaderSpinLongPress,
  isScrolled,
  glassOnScroll,
  routeEnterKey,
}) {
  const src = topRightLogoSrc || DEFAULT_LOGO;
  const isHome = !showHeaderSpin;
  const estiLogoRef = useRef(null);

  const restartSpin = (el) => {
    if (!el) return;
    el.classList.remove("esti-spin");
    void el.offsetWidth;
    el.classList.add("esti-spin");
  };

  useEffect(() => {
    if (isHome) return;
    restartSpin(estiLogoRef.current);
  }, [routeEnterKey, isHome]);

  useEffect(() => {
    console.log("TopBar MOUNT");
    return () => console.log("TopBar UNMOUNT");
  }, []);

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

      

      {!isHome ? (
        <button
          key={`header-brand-wrap-${routeEnterKey || "default"}`}
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
          <EstiPaidInlineLogo
            svgRef={estiLogoRef}
            className="esti-spin"
            style={styles.profileLogo}
            draggable={false}
          />
        </button>
      ) : (
        <div
          aria-hidden="true"
          style={{ ...styles.headerSpinBtn, pointerEvents: "none", cursor: "default" }}
        />
      )}

<button
        key={`header-user-wrap-${routeEnterKey || "default"}`}
        className="pe-btn pe-btn-ghost"
        style={styles.headerIconBtn}
        onClick={onProfile}
  aria-label="Open User Profile"
      >
        <div style={styles.profileLogoWrap}>
          {showAddLogoCue ? <span style={styles.profileLogoCueRing} aria-hidden="true" /> : null}
          <img
            src={src}
            alt="Company logo"
            style={styles.profileLogo}
            draggable={false}
          />
          {showAddLogoCue ? <span style={styles.profileLogoCueBadge} aria-hidden="true">+</span> : null}
          {showAddLogoCue ? <span style={styles.profileLogoCueText} aria-hidden="true">Add Logo</span> : null}
        </div>
      </button>
    </div>
  );
}

function BottomNav({ active, setActive, disabled, onQuickOpen }) {
  const tabs = useMemo(
    () => [
      { key: ROUTES.HOME, label: "Home", Icon: IconHome },
      { key: ROUTES.CUSTOMERS, label: "Customers", Icon: IconCustomers },
      { key: ROUTES.CREATE, label: "Create", Icon: IconCreate, center: true },
      { key: ROUTES.ESTIMATES, label: "Estimates", Icon: IconEstimates },
      { key: ROUTES.INVOICES, label: "Invoices", Icon: IconInvoices },
    ],
    []
  );

  const [createBump, setCreateBump] = useState(false);

  const onTab = (t) => {
    if (disabled && t.key !== ROUTES.CREATE) return;

    if (t.key === ROUTES.CREATE) {
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
    const onTap = () => setActive(ROUTES.HOME);
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
    if (active !== ROUTES.CREATE && createBump) setCreateBump(false);
  }, [active, createBump]);

  return (
    <div style={styles.bottomnav} role="navigation" aria-label="Primary">
      {tabs.map((t) => {
        const isActive = active === t.key;
        const isCenter = !!t.center;
        const Icon = t.Icon;
        const isDisabled = disabled && t.key !== ROUTES.CREATE;

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
    { key: ROUTES.HOME, label: "Home" },
    { key: ROUTES.CREATE, label: "Create" },
    { key: ROUTES.ESTIMATES, label: "Estimates" },
    { key: ROUTES.INVOICES, label: "Invoices" },
    { key: ROUTES.COMPANY_PROFILE, label: "User Profile" },
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
            User Profile
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect(ROUTES.SNAPSHOT)}
          >
            Snapshot
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
            onClick={() => onSelect(ROUTES.ADVANCED)}
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
function CreateFlow({ gated, intent, spinTick, resetSeq }) {
  return (
    <div>
      <EstimateForm key={`estimate:${resetSeq}`} embeddedInShell forceProfileOnMount={false} spinTick={spinTick} />
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
          style={{ display: "flex", justifyContent: "center", margin: "0 auto 10px", cursor: "pointer", maxWidth: "100%" }}
        >
        <EstiPaidInlineLogo
          key={spinTick}
          className="esti-spin"
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
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(1100px, calc(100% - 24px))",
    maxWidth: "100%",
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 14px",
    boxSizing: "border-box",
    background: "transparent",
    backdropFilter: "blur(8px)",
    WebkitBackdropFilter: "blur(8px)",
    minWidth: 0,
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
    position: "relative",
    zIndex: 2,
  },
  profileLogoWrap: {
    position: "relative",
    width: 40,
    height: 40,
    display: "grid",
    placeItems: "center",
  },
  profileLogoCueRing: {
    position: "absolute",
    inset: -2,
    borderRadius: 999,
    border: "1px dashed rgba(186, 230, 253, 0.32)",
    boxShadow: "0 0 10px rgba(147, 197, 253, 0.14)",
    opacity: 0.2,
    animation: "peLogoCuePulse 2.8s ease-in-out infinite",
    pointerEvents: "none",
    zIndex: 1,
  },
  profileLogoCueBadge: {
    position: "absolute",
    right: -1,
    bottom: -1,
    width: 13,
    height: 13,
    borderRadius: 999,
    border: "1px solid rgba(191, 219, 254, 0.44)",
    background: "rgba(15, 23, 42, 0.74)",
    color: "rgba(239, 246, 255, 0.92)",
    display: "grid",
    placeItems: "center",
    fontSize: 10,
    fontWeight: 900,
    lineHeight: 1,
    pointerEvents: "none",
    zIndex: 3,
  },
  profileLogoCueText: {
    position: "absolute",
    left: "50%",
    bottom: -10,
    transform: "translateX(-50%)",
    fontSize: 8,
    fontWeight: 900,
    letterSpacing: "0.08em",
    color: "rgba(219, 234, 254, 0.68)",
    textTransform: "uppercase",
    textShadow: "0 1px 4px rgba(0,0,0,0.32)",
    whiteSpace: "nowrap",
    pointerEvents: "none",
    zIndex: 3,
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
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(1100px, calc(100% - 24px))",
    maxWidth: "100%",
    bottom: 0,
    zIndex: 50,
    display: "flex",
    justifyContent: "space-around",
    alignItems: "flex-start",
    gap: 4,
    boxSizing: "border-box",
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
  const [activeTab, setActiveTab] = useState(() => ROUTES.HOME);
  const [routeEnterSeq, setRouteEnterSeq] = useState(0);
  const [userProfileDirty, setUserProfileDirty] = useState(false);
  const [showUnsavedProfileModal, setShowUnsavedProfileModal] = useState(false);
  const [showCreateFromEditModal, setShowCreateFromEditModal] = useState(false);
  const [createEditSessionActive, setCreateEditSessionActive] = useState(false);
  const [createResetSeq, setCreateResetSeq] = useState(0);
  const pendingProfileLeaveTabRef = useRef(null);
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
  const ESTIMATE_DRAFT_KEY = STORAGE_KEYS.ESTIMATE_DRAFT;
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

  useEffect(() => {
    const onUserProfileDirty = (e) => {
      const dirty = Boolean(e?.detail?.dirty);
      setUserProfileDirty(dirty);
    };
    window.addEventListener("estipaid:user-profile-dirty", onUserProfileDirty);
    return () => window.removeEventListener("estipaid:user-profile-dirty", onUserProfileDirty);
  }, []);

  const enterTab = useCallback((nextTab, intent) => {
    if (intent) setCreateIntent(intent);
    setActiveTab(nextTab);
    if (nextTab !== ROUTES.HOME) setRouteEnterSeq((n) => n + 1);
  }, []);

  const ensureBuilderAccess = useCallback(() => {
    const gate = requireCompanyProfile({
      message: "User Profile required. Open User Profile?",
      onRequireProfile: () => enterTab(ROUTES.COMPANY_PROFILE),
    });
    return !!gate?.allowed;
  }, [enterTab]);

  const performNavigation = useCallback((tab) => {
    const isBuilderTarget =
      tab === ROUTES.CREATE
      || tab === ROUTES.ESTIMATE_BUILDER
      || tab === ROUTES.INVOICE_BUILDER;
    if (isBuilderTarget && !ensureBuilderAccess()) return;

    let nextIntent = null;
    if (tab === ROUTES.ESTIMATE_BUILDER) nextIntent = BUILDER_INTENTS.ESTIMATE;
    else if (tab === ROUTES.INVOICE_BUILDER) nextIntent = BUILDER_INTENTS.INVOICE;

    const nextTab = isBuilderTarget ? ROUTES.CREATE : tab;
    if (isBuilderTarget) {
      try {
        const editTarget = String(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY) || "").trim();
        if (editTarget) setCreateEditSessionActive(true);
      } catch {}
    } else {
      setCreateEditSessionActive(false);
      setShowCreateFromEditModal(false);
    }
    try {
      if (activeTab === ROUTES.CREATE && nextTab !== ROUTES.CREATE) {
        try { localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1"); } catch {}
        window.dispatchEvent(new Event("estipaid:draft-save-now"));
      }
    } catch {}
    try { enterTab(nextTab, nextIntent); } catch {}
  }, [activeTab, ensureBuilderAccess, enterTab]);

  const navigateTo = useCallback((tab, options = {}) => {
    const bypassDirtyGuard = Boolean(options?.bypassDirtyGuard);
    const isLeavingUserProfile = activeTab === ROUTES.COMPANY_PROFILE && tab !== ROUTES.COMPANY_PROFILE;

    if (!bypassDirtyGuard && isLeavingUserProfile && userProfileDirty) {
      pendingProfileLeaveTabRef.current = tab;
      setShowUnsavedProfileModal(true);
      return;
    }

    performNavigation(tab);
  }, [activeTab, userProfileDirty, performNavigation]);

  const continueCreateFromEdit = useCallback(() => {
    setShowCreateFromEditModal(false);
    setCreateEditSessionActive(false);
    try { localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY); } catch {}

    let draftRaw = "";
    try {
      draftRaw = String(localStorage.getItem(ESTIMATE_DRAFT_KEY) || "");
    } catch {}

    if (draftRaw) {
      try { localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, draftRaw); } catch {}
    } else {
      try { localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE); } catch {}
    }

    setCreateResetSeq((n) => n + 1);
    navigateTo(ROUTES.ESTIMATE_BUILDER);
  }, [ESTIMATE_DRAFT_KEY, navigateTo]);

  const onCreateButtonRoute = useCallback(() => {
    let editTarget = "";
    try {
      editTarget = String(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY) || "").trim();
    } catch {}

    if (editTarget || createEditSessionActive) {
      setShowCreateFromEditModal(true);
      return;
    }

    navigateTo(ROUTES.ESTIMATE_BUILDER);
  }, [createEditSessionActive, navigateTo]);

  // ✅ Navigate to Customers screen (used by EstimateForm "Create New" shortcut)
  useEffect(() => {
    const onNavCustomers = () => {
      try { navigateTo(ROUTES.CUSTOMERS); } catch {}
    };
    window.addEventListener("estipaid:navigate-customers", onNavCustomers);
    return () => window.removeEventListener("estipaid:navigate-customers", onNavCustomers);
  }, [navigateTo]);

  useEffect(() => {
    const onNavEstimates = () => {
      try { navigateTo(ROUTES.ESTIMATES); } catch {}
    };
    const onNavInvoices = () => {
      try { navigateTo(ROUTES.INVOICES); } catch {}
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
        navigateTo(ROUTES.ESTIMATE_BUILDER);
      } catch {}
    };
    window.addEventListener("estipaid:navigate-estimator", onNavEstimator);
    return () => window.removeEventListener("estipaid:navigate-estimator", onNavEstimator);
  }, [navigateTo]);

  useEffect(() => {
    const onNavInvoiceBuilder = () => {
      try { navigateTo(ROUTES.INVOICE_BUILDER); } catch {}
    };
    window.addEventListener("estipaid:navigate-invoice-builder", onNavInvoiceBuilder);
    return () => window.removeEventListener("estipaid:navigate-invoice-builder", onNavInvoiceBuilder);
  }, [navigateTo]);

  useEffect(() => {
    const onNavCompanyProfile = () => {
      try { navigateTo(ROUTES.COMPANY_PROFILE); } catch {}
    };
    const onNavUserProfile = () => {
      try { navigateTo(ROUTES.COMPANY_PROFILE); } catch {}
    };
    window.addEventListener("estipaid:navigate-company-profile", onNavCompanyProfile);
    window.addEventListener("estipaid:navigate-user-profile", onNavUserProfile);
    return () => {
      window.removeEventListener("estipaid:navigate-company-profile", onNavCompanyProfile);
      window.removeEventListener("estipaid:navigate-user-profile", onNavUserProfile);
    };
  }, [navigateTo]);

  useEffect(() => {
    const refresh = () => setEstimateHistory(loadSavedEstimates());
    refresh();
    const onStorage = (e) => {
      if (!e?.key || e.key === ESTIMATES_KEY) refresh();
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
        navigateTo(ROUTES.ESTIMATE_BUILDER);
        return;
      }

      if (action === "newClear") {
        try { localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE); } catch {}
        try { localStorage.removeItem(STORAGE_KEYS.ESTIMATE_DRAFT); } catch {}
        return;
      }

      if (action === "goEstimatesTab") {
        navigateTo(ROUTES.ESTIMATES);
        return;
      }

      if (action === "openCompanyProfile" || action === "openUserProfile") {
        navigateTo(ROUTES.COMPANY_PROFILE);
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

  useEffect(() => {
    if (activeTab === ROUTES.COMPANY_PROFILE) return;
    pendingProfileLeaveTabRef.current = null;
    setShowUnsavedProfileModal(false);
    setUserProfileDirty(false);
  }, [activeTab]);
const [drawerOpen, setDrawerOpen] = useState(false);
  const [createIntent, setCreateIntent] = useState(BUILDER_INTENTS.ESTIMATE);

  // Keep a tiny global flag so nested screens can hard-lock into profile when requested
  useEffect(() => {
    try {
      window.__PE_FORCE_PROFILE__ = createIntent === BUILDER_INTENTS.PROFILE;
    } catch {
      // ignore
    }
  }, [createIntent]);
const gated = false;
  const topRightLogoMeta = useMemo(() => {
    const DEFAULT = DEFAULT_LOGO;
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE);
      if (!raw) return { src: DEFAULT, hasCustomLogo: false };
      const obj = JSON.parse(raw);
      const candidates = [
        obj?.logoDataUrl,
        obj?.logo,
        obj?.logoUrl,
        obj?.logoData,
        obj?.companyLogo,
      ];
      const picked = candidates.find((s) => typeof s === "string" && s.trim().length > 0);
      return { src: picked || DEFAULT, hasCustomLogo: Boolean(picked) };
    } catch {
      return { src: DEFAULT, hasCustomLogo: false };
    }
  // activeTab intentionally triggers a re-read of localStorage when the user
  // navigates between tabs (e.g. after saving a new company logo); activeTab is
  // not referenced inside the callback body so exhaustive-deps flags it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);
  const topRightLogoSrc = topRightLogoMeta.src;
  const showAddLogoCue = !topRightLogoMeta.hasCustomLogo;


  const handleHomeLogoTap = () => {
    try { navigateTo(ROUTES.HOME); } catch {}
  };
  const handleHomeLogoLongPress = () => {
    try { setQuickOpen(true); } catch {}
  };

  const renderScreen = () => {
    if (activeTab === ROUTES.HOME) return <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} />;
    if (activeTab === ROUTES.CUSTOMERS)
      return (
        <CustomersScreen
          lang={lang}
          onDone={(p) => {
            try {
              const id = String(p?.id || "");
              if (id) {
                try { localStorage.setItem(STORAGE_KEYS.SELECTED_CUSTOMER_ID, id); } catch {}
                try { localStorage.setItem(STORAGE_KEYS.SELECTED_CUSTOMER_SNAP, JSON.stringify(p?.customer || null)); } catch {}
                try { window.dispatchEvent(new CustomEvent("estipaid:customer-use", { detail: { id, customer: p?.customer || null } })); } catch {}
              }
            } catch {}
            try {
              navigateTo(ROUTES.ESTIMATE_BUILDER);
            } catch {}
          }}
        />
      );
    if (activeTab === ROUTES.ESTIMATES) {
      return (
        <EstimatesScreen
          lang={lang}
          t={shellT}
          spinTick={spinTick}
          history={estimateHistory}
          onDone={() => navigateTo(ROUTES.HOME)}
          onOpenEstimate={() => {
            navigateTo(ROUTES.ESTIMATE_BUILDER);
          }}
        />
      );
    }
    if (activeTab === ROUTES.INVOICES) {
      return (
        <InvoicesScreen
          lang={lang}
          t={shellT}
          spinTick={spinTick}
          onDone={() => navigateTo(ROUTES.HOME)}
        />
      );
    }
    if (activeTab === ROUTES.COMPANY_PROFILE) return CompanyProfileScreen ? <CompanyProfileScreen /> : <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} />;
    if (activeTab === ROUTES.ADVANCED) return AdvancedSettingsScreen ? <AdvancedSettingsScreen /> : <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} />;
    if (activeTab === ROUTES.SNAPSHOT) return FinancialSnapshotScreen ? <FinancialSnapshotScreen /> : <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} />;
    if (activeTab === ROUTES.CREATE) return <CreateFlow gated={gated} intent={createIntent} spinTick={spinTick} resetSeq={createResetSeq} />;
    return <HomeScreen spinTick={spinTick} onLogoTap={handleHomeLogoTap} onLogoLongPress={handleHomeLogoLongPress} />;
  };

  const onDrawerSelect = (key) => {
    setDrawerOpen(false);

    if (key === ROUTES.CREATE) {
      onCreateButtonRoute();
      return;
    }

    // Create navigation
    if (key === ROUTES.ADVANCED) {
      navigateTo(ROUTES.ADVANCED);
      return;
    }

        if (key === ROUTES.SNAPSHOT) {
          navigateTo(ROUTES.SNAPSHOT);
          return;
        }

// User Profile / Templates
    if (key === "company") {
      navigateTo(ROUTES.COMPANY_PROFILE);
      return;
    }
    if (key === "templates") {
      navigateTo(ROUTES.ESTIMATE_BUILDER);
      return;
    }

// Create actions
    if (key === "editCompany") {
      navigateTo(ROUTES.COMPANY_PROFILE);
      return;
    }

// Fallback: close only
  };
  const showHeaderSpin = activeTab !== ROUTES.HOME;
  const routeEnterKey = activeTab === ROUTES.HOME
    ? "home"
    : `${activeTab}:${createIntent || ""}:${routeEnterSeq}`;
  const glassOnScroll = activeTab !== ROUTES.HOME && activeTab !== ROUTES.CREATE;
  const unsavedModalOverlay = {
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
  const unsavedModalCard = {
    width: "min(520px, 100%)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.14)",
    background: "rgba(10,10,10,0.85)",
    boxShadow: "0 12px 40px rgba(0,0,0,0.55)",
    padding: 16,
    display: "grid",
    gap: 12,
  };
  const unsavedModalTitle = {
    fontSize: 14,
    fontWeight: 1000,
    letterSpacing: "0.7px",
  };
  const unsavedModalText = {
    fontSize: 13,
    opacity: 0.85,
    lineHeight: 1.35,
  };
  const unsavedModalActions = {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    flexWrap: "wrap",
    marginTop: 6,
  };

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
@keyframes peLogoCuePulse{
  0%,100%{opacity:.17;transform:scale(1);}
  50%{opacity:.24;transform:scale(1.02);}
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
        showAddLogoCue={showAddLogoCue}
        showHeaderSpin={showHeaderSpin}
        routeEnterKey={routeEnterKey}
        glassOnScroll={glassOnScroll}
        isScrolled={isScrolled}
        onHeaderSpinTap={() => {
          setQuickOpen(false);
          navigateTo(ROUTES.HOME);
        }}
        onHeaderSpinLongPress={() => {
          setQuickOpen(true);
        }}
        onMenu={() => setDrawerOpen(true)}
        onProfile={() => {
          setDrawerOpen(false);
          if (activeTab !== ROUTES.COMPANY_PROFILE) navigateTo(ROUTES.COMPANY_PROFILE);
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
          if (key === ROUTES.HOME) {
            navigateTo(ROUTES.HOME);
            return;
          }
          if (key === ROUTES.CREATE) {
            onCreateButtonRoute();
            return;
          }
          if (key === ROUTES.ESTIMATES) {
            navigateTo(ROUTES.ESTIMATES);
            return;
          }
          if (key === ROUTES.INVOICES) {
            navigateTo(ROUTES.INVOICES);
            return;
          }
          if (key === ROUTES.COMPANY_PROFILE) {
            navigateTo(ROUTES.COMPANY_PROFILE);
            return;
          }
        }}
      />

      {showCreateFromEditModal ? (
        <div style={unsavedModalOverlay} role="dialog" aria-modal="true" aria-label="Start new estimate">
          <div style={unsavedModalCard}>
            <div style={unsavedModalText}>
              You are currently editing an estimate.
              Starting a new estimate will discard any unsaved progress.
              Continue?
            </div>
            <div style={unsavedModalActions}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => setShowCreateFromEditModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={continueCreateFromEdit}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showUnsavedProfileModal ? (
        <div style={unsavedModalOverlay} role="dialog" aria-modal="true" aria-label="Unsaved changes">
          <div style={unsavedModalCard}>
            <div style={unsavedModalTitle}>Unsaved changes</div>
            <div style={unsavedModalText}>
              You have unsaved changes in your User Profile. If you leave this page, they will be lost.
            </div>
            <div style={unsavedModalActions}>
              <button
                type="button"
                className="pe-btn pe-btn-ghost"
                onClick={() => {
                  pendingProfileLeaveTabRef.current = null;
                  setShowUnsavedProfileModal(false);
                }}
              >
                Stay
              </button>
              <button
                type="button"
                className="pe-btn"
                onClick={() => {
                  const target = pendingProfileLeaveTabRef.current;
                  pendingProfileLeaveTabRef.current = null;
                  setShowUnsavedProfileModal(false);
                  if (target) navigateTo(target, { bypassDirtyGuard: true });
                }}
              >
                Leave without saving
              </button>
            </div>
          </div>
        </div>
      ) : null}
<div
        ref={contentRef}
        className={`pe-content${activeTab === ROUTES.CREATE ? " pe-content-estimator" : ""}`}
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
          if (key === ROUTES.CREATE) {
            onCreateButtonRoute();
            return;
          }
          navigateTo(key);
        }}
        onQuickOpen={() => setQuickOpen(true)}
        disabled={gated}
      />
    </div>
  );
}
