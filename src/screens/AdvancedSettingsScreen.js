import React, { useEffect, useMemo, useState } from "react";

const THEME_KEY = "field-pocket-theme"; // "auto" | "light" | "dark"
const SHOW_COSTS_KEY = "field-pocket-show-costs"; // "1" | "0"
const LANG_KEY = "field-pocket-language"; // "en" | "es"

function readTheme() {
  const v = (localStorage.getItem(THEME_KEY) || "auto").toLowerCase();
  return v === "light" || v === "dark" || v === "auto" ? v : "auto";
}

function readShowCosts() {
  const v = localStorage.getItem(SHOW_COSTS_KEY);
  if (v === null) return true;
  return v === "1" || v === "true" || v === "yes";
}

function readLang() {
  const v = (localStorage.getItem(LANG_KEY) || "en").toLowerCase();
  return v === "es" ? "es" : "en";
}

function broadcastSettingsChange() {
  try {
    window.dispatchEvent(new Event("estipaid:settings-changed"));
  } catch (e) {}
}

export default function AdvancedSettingsScreen({ spinTick = 0 } = {}) {
  const [theme, setTheme] = useState(() => readTheme());
  const [showCosts, setShowCosts] = useState(() => readShowCosts());
  const [lang, setLang] = useState(() => readLang());

  useEffect(() => {
    const onStorage = (e) => {
      if (!e || !e.key) return;
      if (e.key === THEME_KEY) setTheme(readTheme());
      if (e.key === SHOW_COSTS_KEY) setShowCosts(readShowCosts());
      if (e.key === LANG_KEY) setLang(readLang());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const topBarStyle = useMemo(
    () => ({
      position: "sticky",
      top: 0,
      zIndex: 50,
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingLeft: 16,
      paddingRight: 16,
      paddingBottom: 10,
      display: "flex",
      alignItems: "center",
      minHeight: 66,
      background: "transparent",
    }),
    []
  );

  const sectionStyle = useMemo(
    () => ({
      margin: "14px 12px",
      padding: "14px 14px",
      borderRadius: 14,
      background: "rgba(255,255,255,0.06)",
      border: "1px solid rgba(255,255,255,0.08)",
    }),
    []
  );

  const rowStyle = useMemo(
    () => ({
      display: "flex",
      gap: 10,
      flexWrap: "wrap",
      alignItems: "center",
    }),
    []
  );

  const pillStyle = (active) => ({
    padding: "10px 12px",
    borderRadius: 999,
    border: "1px solid rgba(255,255,255,0.12)",
    background: active ? "rgba(255,255,255,0.14)" : "rgba(255,255,255,0.06)",
    color: "white",
    cursor: "pointer",
    fontSize: 13,
    userSelect: "none",
  });

  const toggleRowStyle = useMemo(
    () => ({
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 12,
    }),
    []
  );

  const onSetTheme = (next) => {
    localStorage.setItem(THEME_KEY, next);
    setTheme(next);
    broadcastSettingsChange();
  };

  const onSetLang = (next) => {
    localStorage.setItem(LANG_KEY, next);
    setLang(next);
    broadcastSettingsChange();
  };

  const onToggleCosts = () => {
    const next = !showCosts;
    localStorage.setItem(SHOW_COSTS_KEY, next ? "1" : "0");
    setShowCosts(next);
    broadcastSettingsChange();
  };

  return (
    <div style={{ minHeight: "100vh", color: "white" }}>
      <div style={topBarStyle}>
        <div style={{ width: 64 }} />

        <div style={{ flex: 1, display: "flex", justifyContent: "center" }}>
          <div className="esti-spin-wrap" data-esti-spin="advanced-header">
            <img
              key={spinTick}
              className="esti-spin"
              src="/logo/estipaid.svg"
              alt="EstiPaid"
              style={{
                height: 44,
                width: "auto",
                display: "block",
                objectFit: "contain",
                filter: "drop-shadow(0 10px 22px rgba(0,0,0,0.38))",
              }}
              draggable={false}
            />
          </div>
        </div>

        <div style={{ width: 64 }} />
      </div>

      <div style={{ paddingBottom: 18 }}>
        <div style={sectionStyle}>
          <div className="pe-field-label" style={{ marginBottom: 10 }}>Appearance</div>
          <div style={rowStyle}>
            <div onClick={() => onSetTheme("auto")} style={pillStyle(theme === "auto")}>
              Auto
            </div>
            <div onClick={() => onSetTheme("dark")} style={pillStyle(theme === "dark")}>
              Dark
            </div>
            <div onClick={() => onSetTheme("light")} style={pillStyle(theme === "light")}>
              Light
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <div className="pe-field-label" style={{ marginBottom: 10 }}>Language</div>
          <div style={rowStyle}>
            <div onClick={() => onSetLang("en")} style={pillStyle(lang === "en")}>
              English
            </div>
            <div onClick={() => onSetLang("es")} style={pillStyle(lang === "es")}>
              Español
            </div>
          </div>
        </div>

        <div style={sectionStyle}>
          <div className="pe-field-label" style={{ marginBottom: 10 }}>Estimator display</div>
          <div style={toggleRowStyle}>
            <div className="pe-field-helper">Show costs</div>
            <button
              onClick={onToggleCosts}
              style={{
                background: showCosts ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.08)",
                border: "1px solid rgba(255,255,255,0.12)",
                color: "white",
                padding: "10px 14px",
                borderRadius: 999,
                cursor: "pointer",
                minWidth: 92,
              }}
            >
              {showCosts ? "On" : "Off"}
            </button>
          </div>
        </div>

        <div style={sectionStyle}>
          <div className="pe-field-label" style={{ marginBottom: 10 }}>More</div>
          <div style={{ fontSize: 13, opacity: 0.8, lineHeight: 1.5 }}>
            Advanced settings centralized here.
          </div>
        </div>
      </div>
    </div>
  );
}
