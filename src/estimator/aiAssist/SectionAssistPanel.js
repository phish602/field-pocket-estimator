// @ts-nocheck
/* eslint-disable */

import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

const S = {
  backdrop: {
    position: "fixed",
    inset: 0,
    background: "rgba(0,0,0,0.55)",
    backdropFilter: "blur(4px)",
    WebkitBackdropFilter: "blur(4px)",
    zIndex: 3000,
  },
  panel: {
    position: "fixed",
    left: "50%",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: "min(92vw, 480px)",
    background: "rgba(18,20,30,0.97)",
    border: "1px solid rgba(255,255,255,0.13)",
    borderRadius: 16,
    boxShadow: "0 24px 60px rgba(0,0,0,0.7)",
    zIndex: 3001,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 18px 12px",
    borderBottom: "1px solid rgba(255,255,255,0.08)",
    gap: 10,
  },
  headerLeft: {
    display: "flex",
    flexDirection: "column",
    gap: 5,
    minWidth: 0,
    flex: 1,
  },
  headerTitle: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "rgba(99,179,237,0.95)",
  },
  modeBadge: {
    display: "inline-flex",
    alignItems: "center",
    alignSelf: "flex-start",
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
  },
  modeBadgeBlanket: {
    background: "rgba(99,179,237,0.1)",
    border: "1px solid rgba(99,179,237,0.2)",
    color: "rgba(99,179,237,0.72)",
  },
  modeBadgeItemized: {
    background: "rgba(72,187,120,0.1)",
    border: "1px solid rgba(72,187,120,0.2)",
    color: "rgba(72,187,120,0.72)",
  },
  closeBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "rgba(230,241,248,0.45)",
    fontSize: 18,
    lineHeight: 1,
    padding: "2px 4px",
    borderRadius: 4,
    flexShrink: 0,
  },
  body: {
    padding: "18px 18px 20px",
    display: "flex",
    flexDirection: "column",
    gap: 14,
  },
  helpText: {
    margin: 0,
    fontSize: 13,
    color: "rgba(230,241,248,0.65)",
    lineHeight: 1.5,
  },
  textarea: {
    width: "100%",
    minHeight: 90,
    background: "rgba(255,255,255,0.05)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 8,
    color: "rgba(230,241,248,0.92)",
    fontSize: 14,
    lineHeight: 1.55,
    padding: "10px 12px",
    resize: "vertical",
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
  },
  actionsRow: {
    display: "flex",
    gap: 10,
    justifyContent: "flex-end",
    marginTop: 4,
    flexWrap: "wrap",
  },
  cancelBtn: {
    background: "none",
    border: "1px solid rgba(255,255,255,0.14)",
    borderRadius: 8,
    color: "rgba(230,241,248,0.55)",
    fontSize: 13,
    fontWeight: 600,
    padding: "8px 16px",
    cursor: "pointer",
  },
  generateBtn: {
    background: "rgba(99,179,237,0.15)",
    border: "1px solid rgba(99,179,237,0.4)",
    borderRadius: 8,
    color: "rgba(99,179,237,0.95)",
    fontSize: 13,
    fontWeight: 700,
    padding: "8px 18px",
    cursor: "pointer",
    letterSpacing: "0.03em",
  },
  acceptBtn: {
    background: "rgba(72,187,120,0.15)",
    border: "1px solid rgba(72,187,120,0.4)",
    borderRadius: 8,
    color: "rgba(72,187,120,0.95)",
    fontSize: 13,
    fontWeight: 700,
    padding: "8px 18px",
    cursor: "pointer",
    letterSpacing: "0.03em",
  },
  errorText: {
    margin: 0,
    fontSize: 13,
    color: "rgba(252,129,74,0.9)",
    background: "rgba(252,129,74,0.08)",
    border: "1px solid rgba(252,129,74,0.2)",
    borderRadius: 6,
    padding: "8px 12px",
  },
  loadingWrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    padding: "28px 0 12px",
    color: "rgba(230,241,248,0.55)",
    fontSize: 13,
  },
  spinner: {
    width: 28,
    height: 28,
    border: "3px solid rgba(99,179,237,0.18)",
    borderTop: "3px solid rgba(99,179,237,0.85)",
    borderRadius: "50%",
    animation: "pe-ai-spin 0.75s linear infinite",
  },
  reviewLabel: {
    margin: "0 0 8px",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.4)",
  },
  reviewBox: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 8,
    padding: "12px 14px",
    fontSize: 13,
    lineHeight: 1.65,
    color: "rgba(230,241,248,0.88)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  valueBox: {
    padding: "14px 16px",
    borderRadius: 10,
    background: "rgba(99,179,237,0.08)",
    border: "1px solid rgba(99,179,237,0.22)",
    display: "grid",
    gap: 4,
  },
  valueLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.5)",
  },
  valueText: {
    fontSize: 28,
    fontWeight: 800,
    color: "rgba(230,241,248,0.96)",
    fontVariantNumeric: "tabular-nums",
  },
  tagList: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  tag: {
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid rgba(99,179,237,0.2)",
    background: "rgba(99,179,237,0.08)",
    color: "rgba(230,241,248,0.82)",
    fontSize: 12,
    fontWeight: 600,
  },
  listWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxHeight: 260,
    overflowY: "auto",
  },
  listRow: {
    display: "grid",
    gap: 5,
    padding: "10px 12px",
    borderRadius: 8,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.08)",
  },
  listRowHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  listRowLabel: {
    fontSize: 13,
    fontWeight: 700,
    color: "rgba(230,241,248,0.92)",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  listRowMeta: {
    fontSize: 12,
    color: "rgba(230,241,248,0.5)",
    fontVariantNumeric: "tabular-nums",
    flexShrink: 0,
  },
  listRowNote: {
    fontSize: 12,
    color: "rgba(230,241,248,0.68)",
    lineHeight: 1.5,
  },
  listRowPriceRow: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap",
  },
  listRowQtyTag: {
    fontSize: 11,
    fontWeight: 600,
    color: "rgba(230,241,248,0.42)",
    background: "rgba(255,255,255,0.05)",
    padding: "1px 6px",
    borderRadius: 4,
    letterSpacing: "0.02em",
    flexShrink: 0,
  },
  listRowPriceText: {
    fontSize: 12,
    fontWeight: 600,
    color: "rgba(230,241,248,0.58)",
    fontVariantNumeric: "tabular-nums",
  },
  warningList: {
    display: "grid",
    gap: 6,
  },
  warningText: {
    margin: 0,
    fontSize: 12,
    color: "rgba(252,129,74,0.92)",
    background: "rgba(252,129,74,0.08)",
    border: "1px solid rgba(252,129,74,0.18)",
    borderRadius: 8,
    padding: "8px 10px",
    lineHeight: 1.45,
  },
  promptChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
  },
  promptChip: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.12)",
    borderRadius: 999,
    color: "rgba(230,241,248,0.8)",
    fontSize: 12,
    fontWeight: 600,
    padding: "6px 10px",
    cursor: "pointer",
  },

  // --- Materials-specific styles ---

  // Mismatch nudge callout
  mismatchCallout: {
    background: "rgba(253,224,150,0.05)",
    border: "1px solid rgba(253,224,150,0.14)",
    borderRadius: 10,
    padding: "12px 14px",
    display: "grid",
    gap: 7,
  },
  mismatchCalloutLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(253,224,150,0.58)",
  },
  mismatchCalloutMsg: {
    fontSize: 13,
    color: "rgba(230,241,248,0.78)",
    lineHeight: 1.55,
  },

  // Mode choice option cards
  modeChoiceGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 8,
  },
  modeChoiceCard: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10,
    padding: "13px 13px 12px",
    cursor: "pointer",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    textAlign: "left",
  },
  modeChoiceCardTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: "rgba(230,241,248,0.92)",
    lineHeight: 1.2,
  },
  modeChoiceCardDesc: {
    fontSize: 11.5,
    color: "rgba(230,241,248,0.44)",
    lineHeight: 1.45,
  },

  // Blanket allowance hero card
  allowanceCard: {
    padding: "16px 18px 18px",
    borderRadius: 12,
    background: "rgba(99,179,237,0.06)",
    border: "1px solid rgba(99,179,237,0.16)",
    display: "grid",
    gap: 3,
  },
  allowanceAmountLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.38)",
  },
  allowanceAmount: {
    fontSize: 36,
    fontWeight: 800,
    color: "rgba(230,241,248,0.96)",
    fontVariantNumeric: "tabular-nums",
    letterSpacing: "-0.02em",
    lineHeight: 1.1,
    marginTop: 3,
  },

  // Subsection labels inside review blocks
  subsectionLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.3)",
    margin: "0 0 6px",
    display: "block",
  },

  // Itemized count note
  listCountNote: {
    fontSize: 12,
    color: "rgba(230,241,248,0.36)",
    letterSpacing: "0.02em",
    marginBottom: -4,
  },

  // Scope refine surface
  refineSection: {
    borderTop: "1px solid rgba(255,255,255,0.06)",
    paddingTop: 12,
    display: "flex",
    flexDirection: "column",
    gap: 9,
  },
  refineLabel: {
    fontSize: 10.5,
    fontWeight: 700,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
    color: "rgba(230,241,248,0.28)",
  },
  refineChips: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  },
  refineChip: {
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.09)",
    borderRadius: 999,
    color: "rgba(230,241,248,0.68)",
    fontSize: 11.5,
    fontWeight: 600,
    padding: "5px 10px",
    cursor: "pointer",
    letterSpacing: "0.01em",
  },
  refineTextarea: {
    width: "100%",
    minHeight: 64,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 8,
    color: "rgba(230,241,248,0.88)",
    fontSize: 13,
    lineHeight: 1.5,
    padding: "9px 12px",
    resize: "none",
    fontFamily: "inherit",
    boxSizing: "border-box",
    outline: "none",
  },
  refineToggleBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "rgba(230,241,248,0.35)",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.03em",
    padding: 0,
  },
  refinePillBtn: {
    background: "rgba(255,255,255,0.06)",
    border: "1px solid rgba(255,255,255,0.16)",
    borderRadius: 999,
    cursor: "pointer",
    color: "rgba(230,241,248,0.72)",
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
    padding: "5px 12px",
  },
  refineAmendBtn: {
    background: "rgba(99,179,237,0.14)",
    border: "1px solid rgba(99,179,237,0.35)",
    borderRadius: 8,
    color: "rgba(99,179,237,0.92)",
    fontSize: 13,
    fontWeight: 700,
    padding: "8px 18px",
    cursor: "pointer",
    letterSpacing: "0.03em",
  },
};

let spinnerInjected = false;
function ensureSpinnerKeyframe() {
  if (spinnerInjected || typeof document === "undefined") return;
  spinnerInjected = true;
  const style = document.createElement("style");
  style.textContent = "@keyframes pe-ai-spin { to { transform: rotate(360deg); } }";
  document.head.appendChild(style);
}

function formatMoney(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "$0";
  return numeric.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: numeric % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function InputPhase({ config, initialInput, onSubmit, onClose, error, suggestedPrompts = [] }) {
  const [value, setValue] = useState(initialInput || "");
  const taRef = useRef(null);

  useEffect(() => {
    taRef.current?.focus();
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (value.trim()) onSubmit(value); }
    if (e.key === "Escape") onClose();
  };

  return (
    <>
      <p style={S.helpText}>{config.inputLabel}</p>
      {suggestedPrompts.length ? (
        <div style={S.promptChips}>
          {suggestedPrompts.map((entry, index) => {
            const label = typeof entry === "string" ? entry : String(entry?.label || "");
            const prompt = typeof entry === "string" ? entry : String(entry?.prompt || entry?.label || "");
            if (!label || !prompt) return null;
            return (
              <button
                key={`${label}:${index}`}
                type="button"
                style={S.promptChip}
                onClick={() => onSubmit(prompt)}
              >
                {label}
              </button>
            );
          })}
        </div>
      ) : null}
      <textarea
        ref={taRef}
        style={S.textarea}
        placeholder={config.inputPlaceholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        rows={4}
      />
      {error ? <p style={S.errorText}>{error}</p> : null}
      <div style={S.actionsRow}>
        <button style={S.cancelBtn} type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          style={S.generateBtn}
          type="button"
          onClick={() => onSubmit(value)}
        >
          {config.generateLabel}
        </button>
      </div>
    </>
  );
}

function LoadingPhase() {
  ensureSpinnerKeyframe();
  return (
    <div style={S.loadingWrap}>
      <div style={S.spinner} />
      <span>Generating…</span>
    </div>
  );
}

function ScopeDiffReview({ result, onAccept, onClose, onSubmit }) {
  const scopeNotes = result?.writes?.scopeNotes || "";
  const [refining, setRefining] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const refineRef = useRef(null);

  useEffect(() => {
    if (refining && refineRef.current) refineRef.current.focus();
  }, [refining]);

  function submitRefine(instruction) {
    const text = String(instruction || "").trim();
    if (!text || !onSubmit) return;
    onSubmit(text, { mode: "refine", currentScope: scopeNotes, refineInstruction: text });
    setRefining(false);
    setRefineInput("");
  }

  const REFINE_CHIPS = ["Shorter", "More commercial", "Add exclusions", "More technical"];

  return (
    <>
      <p style={S.reviewLabel}>Suggested scope</p>
      <div style={S.reviewBox}>{scopeNotes}</div>

      {refining ? (
        <div style={S.refineSection}>
          <span style={S.refineLabel}>Amend</span>
          <div style={S.refineChips}>
            {REFINE_CHIPS.map((chip) => (
              <button key={chip} type="button" style={S.refineChip} onClick={() => submitRefine(chip)}>
                {chip}
              </button>
            ))}
          </div>
          <textarea
            ref={refineRef}
            style={S.refineTextarea}
            placeholder="Make it more commercial, add demo and disposal, exclude permits…"
            value={refineInput}
            onChange={(e) => setRefineInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submitRefine(refineInput); }
              if (e.key === "Escape") { setRefining(false); setRefineInput(""); }
            }}
            rows={3}
          />
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <button
              type="button"
              style={S.refineToggleBtn}
              onClick={() => { setRefining(false); setRefineInput(""); }}
            >
              ← Back
            </button>
            <div style={{ display: "flex", gap: 8 }}>
              <button style={S.cancelBtn} type="button" onClick={onClose}>
                Cancel
              </button>
              <button
                style={{ ...S.refineAmendBtn, opacity: refineInput.trim() ? 1 : 0.45 }}
                type="button"
                onClick={() => submitRefine(refineInput)}
                disabled={!refineInput.trim()}
              >
                Amend ↑
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
          {onSubmit ? (
            <button type="button" style={S.refinePillBtn} onClick={() => setRefining(true)}>
              Refine
            </button>
          ) : <span />}
          <div style={{ display: "flex", gap: 10 }}>
            <button style={S.cancelBtn} type="button" onClick={onClose}>
              Cancel
            </button>
            <button style={S.acceptBtn} type="button" onClick={() => onAccept(result.writes)}>
              Accept &amp; Replace
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function LaborLinesReview({ result, onAccept, onClose }) {
  const lines = result?.writes?.laborLines || [];
  return (
    <>
      <p style={S.reviewLabel}>Suggested labor lines</p>
      <div style={S.listWrap}>
        {lines.map((line, index) => (
          <div key={line.id || index} style={S.listRow}>
            <div style={S.listRowHead}>
              <span style={S.listRowLabel}>{line.label || line.role || "—"}</span>
              <span style={S.listRowMeta}>
                {line.hours} hrs · ${line.rate}/hr
              </span>
            </div>
          </div>
        ))}
      </div>
      <div style={S.actionsRow}>
        <button style={S.cancelBtn} type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          style={S.acceptBtn}
          type="button"
          onClick={() => onAccept(result.writes)}
        >
          Accept All
        </button>
      </div>
    </>
  );
}

// Unchosen mode: soft decision state with two clear option cards
function MaterialsModeChoiceReview({ result, onAccept, onClose }) {
  const message = result?.writes?.assistantMessage
    || "How do you want to handle materials for this project?";
  return (
    <>
      <p style={S.helpText}>{message}</p>
      <div style={S.modeChoiceGrid}>
        <button
          type="button"
          style={S.modeChoiceCard}
          onClick={() => onAccept(result?.writes, { type: "switchMode", mode: "blanket" })}
        >
          <span style={S.modeChoiceCardTitle}>One Total</span>
          <span style={S.modeChoiceCardDesc}>Smart blanket allowance — one reviewed amount</span>
        </button>
        <button
          type="button"
          style={S.modeChoiceCard}
          onClick={() => onAccept(result?.writes, { type: "switchMode", mode: "itemized" })}
        >
          <span style={S.modeChoiceCardTitle}>Broken-Out List</span>
          <span style={S.modeChoiceCardDesc}>Draft line items to review and add individually</span>
        </button>
      </div>
      <div style={S.actionsRow}>
        <button style={S.cancelBtn} type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    </>
  );
}

// Mismatch: helpful assistant nudge, not an error state
function MaterialsModeMismatchReview({ result, onAccept, onClose }) {
  const mismatch = result?.writes?.modeMismatch || {};
  const recommendedMode = String(mismatch?.recommendedMode || "").trim();
  const message = String(mismatch?.message || "This request fits the other materials mode better.").trim();
  const actionLabel = recommendedMode === "itemized" ? "Switch to Itemized" : "Switch to Blanket";
  return (
    <>
      <div style={S.mismatchCallout}>
        <span style={S.mismatchCalloutLabel}>Heads up</span>
        <div style={S.mismatchCalloutMsg}>{message}</div>
      </div>
      <div style={S.actionsRow}>
        <button style={S.cancelBtn} type="button" onClick={onClose}>
          Keep current
        </button>
        <button
          style={S.generateBtn}
          type="button"
          onClick={() => onAccept(result?.writes, { type: "switchMode", mode: recommendedMode })}
        >
          {actionLabel}
        </button>
      </div>
    </>
  );
}

// Blanket: allowance card with amount as focal point
function MaterialsBlanketReview({ result, onAccept, onClose }) {
  const suggestion = result?.writes?.blanketSuggestion || {};
  const assumptionsSummary = String(suggestion?.assumptionsSummary || "").trim();
  const includedCategories = Array.isArray(suggestion?.includedCategories) ? suggestion.includedCategories : [];

  return (
    <>
      <div style={S.allowanceCard}>
        <span style={S.allowanceAmountLabel}>Pre-markup allowance</span>
        <div style={S.allowanceAmount}>{formatMoney(suggestion?.suggestedAmount)}</div>
      </div>
      {assumptionsSummary ? (
        <div>
          <span style={S.subsectionLabel}>Assumptions</span>
          <div style={S.reviewBox}>{assumptionsSummary}</div>
        </div>
      ) : null}
      {includedCategories.length ? (
        <div>
          <span style={S.subsectionLabel}>Included categories</span>
          <div style={S.tagList}>
            {includedCategories.map((category) => (
              <div key={category} style={S.tag}>{category}</div>
            ))}
          </div>
        </div>
      ) : null}
      <div style={S.actionsRow}>
        <button style={S.cancelBtn} type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          style={S.acceptBtn}
          type="button"
          onClick={() => onAccept(result?.writes, { type: "applyBlanketSuggestion" })}
        >
          Apply Allowance
        </button>
      </div>
    </>
  );
}

// Itemized: scannable review list with clearly separated sections
function MaterialsItemizedReview({ result, onAccept, onClose }) {
  const suggestion = result?.writes?.itemizedSuggestion || {};
  const lines = Array.isArray(suggestion?.proposedLines) ? suggestion.proposedLines : [];
  const assumptionsSummary = String(suggestion?.assumptionsSummary || "").trim();
  const duplicateWarnings = Array.isArray(suggestion?.duplicateWarnings) ? suggestion.duplicateWarnings : [];

  return (
    <>
      {lines.length > 0 ? (
        <p style={S.listCountNote}>
          {lines.length} item{lines.length !== 1 ? "s" : ""} proposed
        </p>
      ) : null}
      <div style={S.listWrap}>
        {lines.map((line, index) => {
          const qty = line?.qty;
          const qtyDisplay = qty && Number(qty) !== 1 ? `Qty ${qty}` : null;
          const priceEach = line?.priceEach
            ? `${formatMoney(line.priceEach)} ea`
            : line?.unitCostInternal
              ? `${formatMoney(line.unitCostInternal)} internal`
              : null;
          return (
            <div key={line.id || index} style={S.listRow}>
              <div style={S.listRowHead}>
                <span style={S.listRowLabel}>{line?.desc || "Material"}</span>
              </div>
              {(qtyDisplay || priceEach) ? (
                <div style={S.listRowPriceRow}>
                  {qtyDisplay ? <span style={S.listRowQtyTag}>{qtyDisplay}</span> : null}
                  {priceEach ? <span style={S.listRowPriceText}>{priceEach}</span> : null}
                </div>
              ) : null}
              {line?.note ? <div style={S.listRowNote}>{line.note}</div> : null}
            </div>
          );
        })}
      </div>
      {assumptionsSummary ? (
        <div>
          <span style={S.subsectionLabel}>Assumptions</span>
          <div style={S.reviewBox}>{assumptionsSummary}</div>
        </div>
      ) : null}
      {duplicateWarnings.length ? (
        <div>
          <span style={S.subsectionLabel}>Possible duplicates</span>
          <div style={S.warningList}>
            {duplicateWarnings.map((warning, index) => (
              <p key={`warning-${index}`} style={S.warningText}>{warning}</p>
            ))}
          </div>
        </div>
      ) : null}
      <div style={S.actionsRow}>
        <button style={S.cancelBtn} type="button" onClick={onClose}>
          Cancel
        </button>
        <button
          style={S.acceptBtn}
          type="button"
          onClick={() => onAccept(result?.writes, { type: "applyItemizedSuggestion" })}
        >
          Add Draft Lines
        </button>
      </div>
    </>
  );
}

function MaterialsReview({ result, onAccept, onClose }) {
  const writes = result?.writes || {};
  if (writes?.modeChoiceRequired) {
    return <MaterialsModeChoiceReview result={result} onAccept={onAccept} onClose={onClose} />;
  }
  if (writes?.modeMismatch?.recommendedMode) {
    return <MaterialsModeMismatchReview result={result} onAccept={onAccept} onClose={onClose} />;
  }
  if (writes?.mode === "blanket") {
    return <MaterialsBlanketReview result={result} onAccept={onAccept} onClose={onClose} />;
  }
  if (writes?.mode === "itemized") {
    return <MaterialsItemizedReview result={result} onAccept={onAccept} onClose={onClose} />;
  }
  return (
    <>
      <p style={S.errorText}>No materials suggestion was available to review.</p>
      <div style={S.actionsRow}>
        <button style={S.cancelBtn} type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </>
  );
}

export default function SectionAssistPanel({ config, assistState, onSubmit, onAccept, onClose }) {
  const { phase, input, result, error, suggestedPrompts = [] } = assistState;

  // Derive current materials mode for header badge — no parent change required,
  // derived entirely from result.writes which is already populated by the service
  const displayMode = (() => {
    if (config.reviewType !== "materials") return null;
    if (phase === "review" && result?.writes) {
      if (result.writes.mode === "blanket") return "blanket";
      if (result.writes.mode === "itemized") return "itemized";
      if (result.writes.modeChoiceRequired) return null;
      // mismatch: currentMode already carried in writes
      if (result.writes.modeMismatch?.currentMode) return result.writes.modeMismatch.currentMode;
    }
    // optional: parent may pass config.currentMode for badge in input phase
    return config.currentMode || null;
  })();

  const modeBadgeStyle = displayMode === "blanket"
    ? { ...S.modeBadge, ...S.modeBadgeBlanket }
    : displayMode === "itemized"
      ? { ...S.modeBadge, ...S.modeBadgeItemized }
      : null;
  const modeBadgeText = displayMode === "blanket"
    ? "Blanket"
    : displayMode === "itemized"
      ? "Itemized"
      : null;

  useEffect(() => {
    const handler = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const content = (
    <>
      <div style={S.backdrop} onClick={onClose} aria-hidden="true" />
      <div
        style={S.panel}
        role="dialog"
        aria-modal="true"
        aria-label={`AI Assist — ${config.sectionLabel}`}
        onClick={(event) => event.stopPropagation()}
      >
        <div style={S.header}>
          <div style={S.headerLeft}>
            <span style={S.headerTitle}>✦ AI Assist · {config.sectionLabel}</span>
            {modeBadgeText ? (
              <span style={modeBadgeStyle}>{modeBadgeText}</span>
            ) : null}
          </div>
          <button style={S.closeBtn} type="button" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div style={S.body}>
          {(phase === "open" || phase === "error") ? (
            <InputPhase
              config={config}
              initialInput={input}
              onSubmit={onSubmit}
              onClose={onClose}
              error={phase === "error" ? error : null}
              suggestedPrompts={suggestedPrompts}
            />
          ) : null}

          {phase === "requesting" ? <LoadingPhase /> : null}

          {phase === "review" && config.reviewType === "scope-diff" ? (
            <ScopeDiffReview result={result} onAccept={onAccept} onClose={onClose} onSubmit={onSubmit} />
          ) : null}

          {phase === "review" && config.reviewType === "labor-lines" ? (
            <LaborLinesReview result={result} onAccept={onAccept} onClose={onClose} />
          ) : null}

          {phase === "review" && config.reviewType === "materials" ? (
            <MaterialsReview result={result} onAccept={onAccept} onClose={onClose} />
          ) : null}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
