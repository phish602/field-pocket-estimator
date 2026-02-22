export default function AdvancedSettingsScreen({ lang = "en", t, onDone, spinTick }) {
  return (
    <div className="pe-main">
      <div
        className="pe-section-title"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          position: "relative",
        }}
      >
        <img
          key={spinTick || 0}
          className="esti-spin"
          src="/logo/estipaid.svg"
          alt="EstiPaid"
          style={{
            height: 34,
            width: "auto",
            display: "block",
            objectFit: "contain",
            filter: "drop-shadow(0 8px 18px rgba(0,0,0,0.32))",
          }}
          draggable={false}
        />
      </div>

      <div style={{ padding: 16 }}>{lang === "es" ? "Ajustes Avanzados" : "Advanced Settings"}</div>
    </div>
  );
}
