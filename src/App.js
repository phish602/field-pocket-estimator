import { useEffect, useMemo, useState } from "react";
import EstimateForm from "./EstimateForm";
import CustomersScreen from "./screens/CustomersScreen";
import EstimatesScreen from "./screens/EstimatesScreen";
import InvoicesScreen from "./screens/InvoicesScreen";
import "./EstimateForm.css";

/* =========================================================
   APP SHELL + CREATE FLOW OWNER
   - Create tab owns the flow (Language/Profile/Job/Estimate/Review)
   - EstimateForm remains the engine (no feature loss)
   - Header/Footer are transparent overlays; content scrolls underneath
   ========================================================= */

const LANG_KEY = "field-pocket-lang";

function getSavedLang() {
  try {
    const v = localStorage.getItem(LANG_KEY);
    if (v === "en" || v === "es") return v;
  } catch {
    // ignore
  }
  return "";
}

/* =========================
   Icons (Motif 1: Blueprint corners)
   ========================= */
function BlueprintCorners({ size = 24, strokeWidth = 2 }) {
  const s = size;
  const p = 3;
  const c = 6;
  return (
    <g
      stroke="currentColor"
      strokeWidth={strokeWidth}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity="0.9"
    >
      <path d={`M${p} ${p + c} V${p} H${p + c}`} />
      <path d={`M${s - p - c} ${p} H${s - p} V${p + c}`} />
      <path d={`M${p} ${s - p - c} V${s - p} H${p + c}`} />
      <path d={`M${s - p - c} ${s - p} H${s - p} V${s - p - c}`} />
    </g>
  );
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
function TopBar({ title, onMenu, onProfile }) {
  return (
    <div style={styles.topbar}>
      <button
        className="pe-btn pe-btn-ghost"
        style={styles.iconBtn}
        onClick={onMenu}
        aria-label="Open menu"
      >
        ☰
      </button>

      <div style={styles.title}>{title}</div>

      <button
        className="pe-btn pe-btn-ghost"
        style={styles.profileBtn}
        onClick={onProfile}
        aria-label="Profile"
      >
        <div style={styles.profileCircle}>AV</div>
      </button>
    </div>
  );
}

function BottomNav({ active, setActive, disabled }) {
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
            aria-label="Close menu"
          >
            ✕
          </button>
        </div>

        <div style={styles.drawerList}>
          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect("create")}
          >
            Create Flow
          </button>

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
            Advanced
          </button>

          <div style={{ height: 10 }} />

          <div style={{ fontSize: 11, opacity: 0.75, padding: "0 6px" }}>
            Create Actions
          </div>

          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect("editCompany")}
            disabled={disabled}
          >
            Edit Company
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect("newClear")}
            disabled={disabled}
          >
            New / Clear
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect("save")}
            disabled={disabled}
          >
            Save
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect("pdf")}
            disabled={disabled}
          >
            PDF
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect("toggleDocType")}
            disabled={disabled}
          >
            Toggle Estimate / Invoice
          </button>

          <button
            className="pe-btn pe-btn-ghost"
            style={styles.drawerItem}
            onClick={() => onSelect("language")}
          >
            Language
          </button>
        </div>
      </div>
    </>
  );
}

/* =========================
   Create Flow (App owns flow; NO stepper UI)
   ========================= */
function CreateFlow({ gated }) {
  return (
    <div>
      {gated ? (
        <div className="pe-card" style={{ margin: "12px 14px 0" }}>
          Select language on <b>Home</b> to unlock Create.
          <div className="pe-muted" style={{ marginTop: 6 }}>
            Home → Language → choose English/Español.
          </div>
        </div>
      ) : (
        <EstimateForm embeddedInShell />
      )}
    </div>
  );
}

/* =========================
   Placeholder screens (theme-safe)
   ========================= */

function HomeScreen() {
  return (
    <div className="pe-main" style={{ paddingTop: 0 }}>
      <div className="pe-card" style={{ marginTop: 10, textAlign: "center" }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: "2px",
            textTransform: "uppercase",
            opacity: 0.75,
            lineHeight: 1.1,
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

        <img
          src="/logo/estipaid.svg"
          alt="EstiPaid"
          style={{
            height: 110,
            width: "auto",
            display: "block",
            margin: "0 auto 10px",
            objectFit: "contain",
            filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.38))",
          }}
        />

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
  iconBtn: { padding: "8px 10px" },
  title: {
    fontWeight: 900,
    letterSpacing: "0.2px",
    fontSize: 15,
    opacity: 0.98,
    textShadow: "0 1px 8px rgba(0,0,0,0.35)",
  },
  profileBtn: {
    padding: 0,
    width: 44,
    height: 44,
    display: "grid",
    placeItems: "center",
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

  const [lang, setLang] = useState(() => getSavedLang());
  const [activeTab, setActiveTab] = useState(() =>
    getSavedLang() ? "home" : "create"
  );
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Create Flow step (App-owned)
  // Listen for language selection inside EstimateForm (it writes LANG_KEY)
  useEffect(() => {
    const onEvt = (e) => {
      const k = e?.detail?.key;
      const v = e?.detail?.value;
      if (k === LANG_KEY && (v === "en" || v === "es")) {
        setLang(v);
        setActiveTab("home");
      }
    };
    window.addEventListener("pe-localstorage", onEvt);
    return () => window.removeEventListener("pe-localstorage", onEvt);
  }, []);

  // Safety: if language is unset, force them back into Create (LanguageGate)
  useEffect(() => {
    const v = getSavedLang();
    if (!v) {
      setLang("");
      setActiveTab("create");
    }
  }, []);

  const gated = !lang;

  const title = useMemo(() => {
    if (activeTab === "home") return "Home";
    if (activeTab === "customers") return "Customers";
    if (activeTab === "create") return "Create";
    if (activeTab === "estimates") return "Estimates";
    if (activeTab === "invoices") return "Invoices";
    return "Home";
  }, [activeTab]);

  const renderScreen = () => {
    if (activeTab === "home") return <HomeScreen />;
    if (activeTab === "customers") return <CustomersScreen />;
    if (activeTab === "estimates") return <EstimatesScreen />;
    if (activeTab === "invoices") return <InvoicesScreen />;
    if (activeTab === "create") return <CreateFlow gated={gated} />;
    return <HomeScreen />;
  };

  const onDrawerSelect = (key) => {
    setDrawerOpen(false);

    const fire = (action) => {
      try {
        window.dispatchEvent(
          new CustomEvent("pe-shell-action", { detail: { action } })
        );
      } catch {
        // ignore
      }
    };

    if (key === "create") {
      setActiveTab("create");
      return;
    }

    // Global
    if (key === "language") {
      setActiveTab("home");
      return;
    }

    // Create navigation
    if (key === "advanced") {
      setActiveTab("create");
      fire("openAdvanced");
      return;
    }

    // Company Profile / Templates
    if (key === "company") {
      setActiveTab("create");
      fire("openProfile");
      return;
    }
    if (key === "templates") {
      setActiveTab("create");
      fire("openTemplates");
      return;
    }

    // Create actions
    if (key === "editCompany") {
      setActiveTab("create");
      fire("openProfile");
      return;
    }
    if (key === "newClear") {
      setActiveTab("create");
      fire("newClear");
      return;
    }
    if (key === "save") {
      setActiveTab("create");
      fire("save");
      return;
    }
    if (key === "pdf") {
      setActiveTab("create");
      fire("pdf");
      return;
    }

    // Fallback: close only
  };

  return (
    <div className="pe-wrap" style={styles.shell}>
      <style>{`
        @media (prefers-reduced-motion: no-preference){
          .pe-create-bump{ animation: peCreateBump 260ms ease-out; }
          @keyframes peCreateBump{
            0%{ transform: scale(0.96); }
            45%{ transform: scale(1.08); }
            100%{ transform: scale(1.00); }
          }
        }
      `}</style>

      <TopBar
        title={title}
        onMenu={() => setDrawerOpen(true)}
        onProfile={() => setDrawerOpen(true)}
      />
      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSelect={onDrawerSelect}
        disabled={gated}
      />

      <div style={styles.content}>{renderScreen()}</div>

      <BottomNav active={activeTab} setActive={setActiveTab} disabled={gated} />
    </div>
  );
}
