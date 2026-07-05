import React from "react";

export default function CloudConfirmDialog({
  dialog = null,
  checkboxChecked = false,
  onCheckboxChange = null,
  onCancel = null,
  onConfirm = null,
} = {}) {
  if (!dialog) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cloud-confirm-dialog-title"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(2,6,23,0.66)",
        display: "grid",
        placeItems: "center",
        padding: 20,
        zIndex: 60,
      }}
    >
      <div
        className="pe-card pe-card-content"
        style={{
          width: "min(100%, 460px)",
          display: "grid",
          gap: 12,
          borderRadius: 18,
          border: "1px solid rgba(148,163,184,0.24)",
          background: "linear-gradient(180deg, rgba(30,41,59,0.96), rgba(15,23,42,0.98))",
          boxShadow: "0 24px 60px rgba(0,0,0,0.38)",
        }}
      >
        <div id="cloud-confirm-dialog-title" className="pe-field-label" style={{ marginBottom: 0 }}>
          {dialog.title}
        </div>
        <div style={{ display: "grid", gap: 6 }}>
          {(Array.isArray(dialog.lines) ? dialog.lines : []).map((line) => (
            <div key={line} className="pe-field-helper">{line}</div>
          ))}
        </div>
        {dialog.requireCheckbox ? (
          <label className="pe-field-helper" style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={checkboxChecked}
              onChange={(event) => onCheckboxChange?.(event.target.checked)}
              style={{ marginTop: 2 }}
            />
            <span>{dialog.checkboxLabel}</span>
          </label>
        ) : null}
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", flexWrap: "wrap" }}>
          <button
            type="button"
            className="pe-btn pe-btn-ghost"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="pe-btn"
            onClick={onConfirm}
            disabled={Boolean(dialog.requireCheckbox && !checkboxChecked)}
          >
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
