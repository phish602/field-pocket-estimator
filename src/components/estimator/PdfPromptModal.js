// @ts-nocheck
/* eslint-disable */

import React from "react";
import { createPortal } from "react-dom";

export default function PdfPromptModal(props) {
  const {
    open,
    docType = "estimate",
    onClose,
    onView,
    onDownload,
    onShare,
  } = props || {};

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div style={styles.backdrop} onClick={onClose}>
      <div className="pe-card pe-card-content" style={styles.card} onClick={(e) => e.stopPropagation()}>
        <div style={styles.title}>Export PDF</div>
        <div style={styles.text}>
          Choose an action for this {docType === "invoice" ? "invoice" : "estimate"} PDF.
        </div>
        <div style={styles.actions}>
          <button type="button" className="pe-btn pe-btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="pe-btn pe-btn-ghost" onClick={onView}>
            View
          </button>
          <button type="button" className="pe-btn pe-btn-ghost" onClick={onDownload}>
            Download
          </button>
          <button type="button" className="pe-btn" onClick={onShare}>
            Share
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

const styles = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(5,8,14,0.72)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10000,
    padding: 12,
  },
  card: {
    width: "min(560px, 96vw)",
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.16)",
    background: "rgba(9,14,24,0.96)",
    boxShadow: "0 20px 54px rgba(0,0,0,0.45)",
    padding: 16,
    color: "rgba(245,248,252,0.98)",
  },
  title: {
    fontSize: 19,
    fontWeight: 900,
    letterSpacing: 0.2,
    marginBottom: 6,
  },
  text: {
    fontSize: 14,
    opacity: 0.86,
    marginBottom: 14,
  },
  actions: {
    display: "flex",
    gap: 8,
    justifyContent: "flex-end",
    flexWrap: "wrap",
  },
};
