// @ts-nocheck
/* eslint-disable */

// The way back from a Snapshot drill-down. It renders only while the user is
// on the destination that drill-down opened, so an ordinary visit to Invoices,
// Projects, or Estimates never shows a stale "back" control. Shared by all
// three destinations rather than triplicated markup.
export default function SnapshotReturnBar({ snapshotReturn, onReturnToSnapshot, lang = "en" }) {
  if (!snapshotReturn || typeof onReturnToSnapshot !== "function") return null;

  return (
    <div style={{ display: "flex", alignItems: "center", paddingBottom: 8 }}>
      <button
        type="button"
        onClick={onReturnToSnapshot}
        aria-label={lang === "es" ? "Volver al panel financiero" : "Back to Snapshot"}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "5px 11px",
          borderRadius: 999,
          fontSize: 11.5,
          fontWeight: 800,
          cursor: "pointer",
          fontFamily: "inherit",
          border: "1px solid rgba(148,163,184,0.34)",
          background: "rgba(255,255,255,0.04)",
          color: "rgba(226,238,250,0.92)",
        }}
      >
        <span aria-hidden="true">←</span>
        <span>{lang === "es" ? "Panel financiero" : "Back to Snapshot"}</span>
      </button>
    </div>
  );
}
