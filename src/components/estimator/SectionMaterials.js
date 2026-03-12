// @ts-nocheck
/* eslint-disable */

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import InlineCustomNumberField from "./InlineCustomNumberField";

const BLANKET_DESCRIPTION_MIN_HEIGHT = 100;
const CUSTOM_PICKER_OPTION_VALUE = "__custom__";
const QTY_PRESET_OPTIONS = Array.from({ length: 50 }, (_, index) => index + 1);
const MARKUP_PRESET_OPTIONS = Array.from({ length: 101 }, (_, index) => index);

function autoResizeNotesTextarea(el) {
  if (!el) return;
  const minHeight = BLANKET_DESCRIPTION_MIN_HEIGHT;
  try {
    el.style.height = "auto";
    el.style.overflowY = "hidden";
    const nextHeight = Math.max(el.scrollHeight || 0, minHeight);
    el.style.height = `${nextHeight}px`;
  } catch {}
}

function derivePresetSelection(value, options, normalizeValue, fallbackValue) {
  const normalized = normalizeValue(value);
  if (normalized === "") return fallbackValue;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return CUSTOM_PICKER_OPTION_VALUE;
  if (Number.isInteger(numeric) && options.includes(numeric)) return String(numeric);
  return CUSTOM_PICKER_OPTION_VALUE;
}

function normalizeInlineNumberDraft(value, { min = 0, max = Number.POSITIVE_INFINITY, integer = false } = {}) {
  const cleaned = integer
    ? String(value ?? "").replace(/[^\d]/g, "")
    : String(value ?? "").replace(/[^\d.]/g, "");
  if (integer) {
    if (!cleaned) return "";
    const numeric = Number(cleaned);
    if (!Number.isFinite(numeric)) return "";
    let nextValue = numeric;
    if (Number.isFinite(min)) nextValue = Math.max(min, nextValue);
    if (Number.isFinite(max)) nextValue = Math.min(max, nextValue);
    return String(Math.round(nextValue));
  }

  const dot = cleaned.indexOf(".");
  const normalized = dot === -1
    ? cleaned
    : `${cleaned.slice(0, dot + 1)}${cleaned.slice(dot + 1).replace(/\./g, "")}`;
  if (!normalized || normalized === ".") return "";

  const hasTrailingDot = normalized.endsWith(".");
  const numericSource = hasTrailingDot ? normalized.slice(0, -1) : normalized;
  const numeric = Number(numericSource);
  if (!Number.isFinite(numeric)) return "";

  let clamped = numeric;
  if (Number.isFinite(min)) clamped = Math.max(min, clamped);
  if (Number.isFinite(max)) clamped = Math.min(max, clamped);
  if (hasTrailingDot && clamped === numeric) return `${clamped}.`;
  return String(clamped);
}

function normalizeInlineNumberFinal(
  value,
  { min = 0, max = Number.POSITIVE_INFINITY, integer = false, fallback = "0" } = {}
) {
  const normalized = normalizeInlineNumberDraft(value, { min, max, integer });
  if (normalized === "") return fallback;
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return fallback;
  let nextValue = numeric;
  if (Number.isFinite(min)) nextValue = Math.max(min, nextValue);
  if (Number.isFinite(max)) nextValue = Math.min(max, nextValue);
  if (integer) nextValue = Math.round(nextValue);
  return String(nextValue);
}

function normalizeQtySelection(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return String(Math.max(1, Math.round(numeric)));
}

function deriveQtySelection(value) {
  return derivePresetSelection(value, QTY_PRESET_OPTIONS, normalizeQtySelection, "1");
}

function deriveMarkupSelection(value, normalizePercentInput) {
  return derivePresetSelection(value, MARKUP_PRESET_OPTIONS, normalizePercentInput, "0");
}

function normalizeCustomQtyDraft(value) {
  return normalizeInlineNumberDraft(value, { min: 1, integer: true });
}

function normalizeCustomQtyFinal(value) {
  return normalizeInlineNumberFinal(value, { min: 1, integer: true, fallback: "1" });
}

function normalizeCustomMarkupDraft(value, max = 200) {
  return normalizeInlineNumberDraft(value, { min: 0, max });
}

function normalizeCustomMarkupFinal(value, max = 200) {
  return normalizeInlineNumberFinal(value, { min: 0, max, fallback: "0" });
}

export default function SectionMaterials(props) {
  const {
    t,
    lang,
    styles,
    bottomActionsStyle,
    headerIcon,
    money,
    collapseMs,
    triggerHaptic,
    materialsMode,
    setMaterialsMode,
    materialsOpen,
    setMaterialsOpen,
    itemizedCollapsedSummary,
    materialsCost,
    setMaterialsCost,
    normalizeMoneyInput,
    materialsMarkupPct,
    setMaterialsMarkupPct,
    materialsBlanketDescription,
    setMaterialsBlanketDescription,
    normalizePercentInput,
    normalizedMarkupPct,
    lockMarkupToGlobal,
    globalMarkupPct,
    animateMaterialsTotal,
    materialsBilled,
    materialItems,
    materialLineTotalsById,
    updateMaterialItem,
    removeMaterialItem,
    showInternalCostFields,
    lockInternalCostFields,
    newMaterialItemIds,
    itemizedMaterialsTotal,
    addMaterialItem,
    trashIcon,
    requireExplicitPickerCommit = false,
  } = props || {};
  const blanketDescriptionRef = useRef(null);
  const noteInputRefs = useRef({});
  const [noteOpenById, setNoteOpenById] = useState({});
  const blanketDescriptionValue = String(materialsBlanketDescription || "");
  const materialsBottomActionsStyle = bottomActionsStyle || styles.sectionFooterActions;
  const materialNoteSeed = useMemo(() => {
    const entries = (Array.isArray(materialItems) ? materialItems : []).map((item, index) => ({
      id: String(item?.id ?? index),
      hasNote: !!String(item?.note || "").trim(),
    }));
    return {
      entries,
      signature: entries.map((entry) => `${entry.id}:${entry.hasNote ? "1" : "0"}`).join("|"),
    };
  }, [materialItems]);

  useEffect(() => {
    setNoteOpenById((prev) => {
      const next = {};
      for (let i = 0; i < materialNoteSeed.entries.length; i += 1) {
        const entry = materialNoteSeed.entries[i];
        const id = entry.id;
        next[id] = Object.prototype.hasOwnProperty.call(prev, id)
          ? prev[id]
          : entry.hasNote;
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) return next;
      for (const key of nextKeys) {
        if (prev[key] !== next[key]) return next;
      }
      return prev;
    });
  }, [materialNoteSeed.signature]);

  function openMaterialNote(materialNoteId) {
    setNoteOpenById((prev) => ({ ...prev, [materialNoteId]: true }));
    const focusNoteInput = () => {
      try {
        noteInputRefs.current?.[materialNoteId]?.focus?.();
      } catch {}
    };
    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(focusNoteInput);
      return;
    }
    setTimeout(focusNoteInput, 0);
  }

  function closeMaterialNote(materialNoteId) {
    setNoteOpenById((prev) => ({ ...prev, [materialNoteId]: false }));
  }

  useLayoutEffect(() => {
    if (materialsMode !== "blanket") return;
    const raf = typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
      ? window.requestAnimationFrame(() => autoResizeNotesTextarea(blanketDescriptionRef.current))
      : null;
    if (raf === null) autoResizeNotesTextarea(blanketDescriptionRef.current);
    return () => {
      if (raf !== null && typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(raf);
      }
    };
  }, [blanketDescriptionValue, materialsMode]);

  return (
    <section className="pe-section">
      <div className="pe-divider" style={styles.sectionHeaderDivider} />
      <div style={styles.sectionHeaderRow}>
        <div style={styles.sectionTitleWithIcon}>
          <span style={styles.sectionTitleIcon} aria-hidden="true">{headerIcon}</span>
          <div style={{ ...styles.sectionTitleStack, marginBottom: 0 }}>
            <div className="pe-section-title" style={styles.sectionTitleText}>{t("materials")}</div>
            <div style={styles.sectionAccentLine} />
          </div>
        </div>
        {materialsMode === "itemized" && !materialsOpen && (
          <div className="pe-muted" style={styles.laborCollapsedMeta}>
            {itemizedCollapsedSummary}
          </div>
        )}
        {materialsMode === "itemized" && !materialsOpen && (
          <button
            type="button"
            className="pe-btn pe-btn-ghost"
            onClick={() => setMaterialsOpen(true)}
            title={lang === "es" ? "Expandir" : "Expand"}
            style={{ ...styles.scopeCollapseBtn, marginLeft: "auto" }}
          >
            {lang === "es" ? "Expandir ▾" : "Expand ▾"}
          </button>
        )}
      </div>

      <div style={{ marginTop: 0, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <div className="pe-muted" style={{ minWidth: 140 }}>
            {t("materialsMode")}
          </div>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: 2,
              borderRadius: 999,
              border: "1px solid rgba(0,0,0,0.12)",
              background: "rgba(255,255,255,0.55)",
              boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08)",
            }}
          >
            <button
              type="button"
              className="pe-btn pe-btn-ghost"
              onClick={() => {
                triggerHaptic?.();
                setMaterialsMode("blanket");
              }}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                fontWeight: materialsMode === "blanket" ? 700 : 500,
                background: materialsMode === "blanket" ? "rgba(0,0,0,0.18)" : "transparent",
                border: materialsMode === "blanket" ? "1px solid rgba(0,0,0,0.22)" : "1px solid transparent",
                boxShadow: materialsMode === "blanket" ? "0 1px 2px rgba(0,0,0,0.18)" : "none",
              }}
            >
              {t("materialsModeBlanket")}
            </button>
            <button
              type="button"
              className="pe-btn pe-btn-ghost"
              onClick={() => {
                triggerHaptic?.();
                setMaterialsMode("itemized");
              }}
              style={{
                padding: "6px 10px",
                borderRadius: 999,
                fontWeight: materialsMode === "itemized" ? 700 : 500,
                background: materialsMode === "itemized" ? "rgba(0,0,0,0.18)" : "transparent",
                border: materialsMode === "itemized" ? "1px solid rgba(0,0,0,0.22)" : "1px solid transparent",
                boxShadow: materialsMode === "itemized" ? "0 1px 2px rgba(0,0,0,0.18)" : "none",
              }}
            >
              {t("materialsModeItemized")}
            </button>
          </div>
        </div>
      </div>

      {materialsMode === "blanket" && (
        <>
          <div
            className="pe-grid"
            style={{
              marginTop: 10,
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: 10,
              alignItems: "end",
            }}
          >
            <div style={{ display: "grid", gap: 4 }}>
              <div style={styles.label}>{t("materialsCost")}</div>
              <input
                className="pe-input"
                value={materialsCost}
                onChange={(e) => setMaterialsCost(e.target.value)}
                onBlur={(e) => setMaterialsCost(normalizeMoneyInput(e.target.value))}
                placeholder={t("materialsCost")}
                inputMode="decimal"
              />
            </div>
            <div style={{ display: "grid", gap: 4 }}>
              <div style={styles.label}>{t("markupPct")}</div>
              <InlineCustomNumberField
                value={materialsMarkupPct}
                options={MARKUP_PRESET_OPTIONS}
                customOptionValue={CUSTOM_PICKER_OPTION_VALUE}
                deriveSelection={(value) => deriveMarkupSelection(value, normalizePercentInput)}
                optionToValue={(selection) => String(Number(selection))}
                formatOptionLabel={(value) => `${value}%`}
                normalizeDraft={(value) => normalizeCustomMarkupDraft(value, 400)}
                normalizeFinal={(value) => normalizeCustomMarkupFinal(value, 400)}
                onValueChange={setMaterialsMarkupPct}
                onValueCommit={setMaterialsMarkupPct}
                className="pe-input"
                placeholder={t("markupPct")}
                inputMode="decimal"
                selectTitle={t("markupPct")}
                inputTitle={t("markupPct")}
                suffix="%"
                requireExplicitCommit={requireExplicitPickerCommit}
              />
            </div>
          </div>
          <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
            <div style={styles.label}>{t("materialsBlanketDescriptionLabel")}</div>
            <textarea
              ref={blanketDescriptionRef}
              className="pe-input pe-textarea"
              value={blanketDescriptionValue}
              onChange={(e) => {
                setMaterialsBlanketDescription?.(e.target.value);
                autoResizeNotesTextarea(e.target);
              }}
              placeholder={t("materialsBlanketDescriptionPlaceholder")}
              style={{ minHeight: BLANKET_DESCRIPTION_MIN_HEIGHT, resize: "none" }}
            />
          </div>
          <div className="pe-row pe-row-slim">
            <div className="pe-muted">
              {lang === "es"
                ? `Materiales facturados (${normalizedMarkupPct}%)`
                : `Materials billed (${normalizedMarkupPct}%)`}
            </div>
            <div className={`pe-value ${animateMaterialsTotal ? "value-pulse" : ""}`}>{money.format(materialsBilled)}</div>
          </div>
        </>
      )}

      {materialsMode === "itemized" && (
        <div
          className={`pe-collapse ${materialsOpen ? "pe-open" : ""}`}
          style={{ ...styles.materialsItemizedCollapseWrap, transitionDuration: `${collapseMs}ms` }}
        >
          <div className="pe-muted" style={{ marginTop: 10 }}>
            {t("materialsItemizedHelp")}
          </div>
          <div style={{ display: "grid", gap: 6, marginTop: 10 }}>
            {materialItems.map((it, i) => {
              const qtyVal = Math.max(1, Number(it.qty) || 1);
              const eachVal = Number(it.charge) || 0;
              const materialNoteId = String(it?.id ?? i);
              const materialNoteValue = String(it?.note || "");
              const materialNoteHasContent = materialNoteValue.trim().length > 0;
              const materialNoteOpen = !!noteOpenById[materialNoteId];
              const mappedLineTotal = materialLineTotalsById?.get
                ? Number(materialLineTotalsById.get(String(it?.id)))
                : NaN;
              const lineTotal = Number.isFinite(mappedLineTotal) ? mappedLineTotal : (qtyVal * eachVal);
              const lineMarkupValue = lockMarkupToGlobal
                ? String(globalMarkupPct ?? 0)
                : String(it?.markupPct ?? "");
              const materialItemCardClass = `pe-card pe-card-content${newMaterialItemIds?.[String(it.id)] ? " pe-anim-enter" : ""}`;
              return (
                <div
                  key={i}
                  className={`${materialItemCardClass} pe-material-item-card`}
                  style={{ ...styles.cardShell, marginTop: 0 }}
                >
                  <div style={{ display: "grid", gap: 4 }}>
                    <div style={styles.label}>{t("materialDesc")}</div>
                    <input
                      className="pe-input"
                      value={it.desc}
                      onChange={(e) => updateMaterialItem(i, "desc", e.target.value)}
                      placeholder={lang === "es" ? "Descripción" : "Description"}
                      style={{ width: "100%" }}
                    />
                  </div>

                  <div style={{ display: "grid", gap: materialNoteOpen ? 6 : 0, marginTop: 8 }}>
                    <button
                      type="button"
                      className="pe-btn pe-btn-ghost"
                      onClick={() => {
                        if (materialNoteOpen) closeMaterialNote(materialNoteId);
                        else openMaterialNote(materialNoteId);
                      }}
                      aria-expanded={materialNoteOpen}
                      style={{
                        justifySelf: "start",
                        padding: 0,
                        minHeight: 0,
                        border: 0,
                        background: "transparent",
                        color: "rgba(203,213,225,0.78)",
                        fontSize: 12.5,
                        fontWeight: 700,
                        letterSpacing: "0.01em",
                      }}
                    >
                      {materialNoteOpen
                        ? (lang === "es" ? "Ocultar nota" : "Hide note")
                        : materialNoteHasContent
                          ? (lang === "es" ? "Editar nota" : "Edit note")
                          : (lang === "es" ? "+ Agregar nota" : "+ Add note")}
                    </button>

                    {materialNoteOpen ? (
                      <input
                        ref={(el) => {
                          if (el) noteInputRefs.current[materialNoteId] = el;
                          else delete noteInputRefs.current[materialNoteId];
                        }}
                        className="pe-input"
                        value={materialNoteValue}
                        onChange={(e) => updateMaterialItem(i, "note", e.target.value)}
                        placeholder={t("materialNotePlaceholder")}
                        style={{
                          width: "100%",
                          fontSize: 13,
                          color: "rgba(229,238,245,0.92)",
                        }}
                      />
                    ) : null}
                  </div>

                  <div
                    className={`pe-material-item-controls ${showInternalCostFields ? "has-internal-cost" : "no-internal-cost"}`}
                    style={{
                      marginTop: 8,
                      display: "grid",
                      gridTemplateColumns: showInternalCostFields ? "1fr 1fr 1fr 1fr 40px" : "1fr 1fr 1fr 40px",
                      gap: 8,
                      alignItems: "end",
                    }}
                  >
                    <div className="pe-material-item-field pe-material-item-field-qty" style={{ display: "grid", gap: 4 }}>
                      <div style={styles.label}>{t("materialQty")}</div>
                      <InlineCustomNumberField
                        value={String(it?.qty ?? qtyVal)}
                        options={QTY_PRESET_OPTIONS}
                        customOptionValue={CUSTOM_PICKER_OPTION_VALUE}
                        deriveSelection={deriveQtySelection}
                        optionToValue={(selection) => String(Number(selection))}
                        formatOptionLabel={(value) => String(value)}
                        normalizeDraft={normalizeCustomQtyDraft}
                        normalizeFinal={normalizeCustomQtyFinal}
                        onValueChange={(nextValue) => updateMaterialItem(i, "qty", nextValue)}
                        onValueCommit={(nextValue) => updateMaterialItem(i, "qty", nextValue)}
                        className="pe-input"
                        inputMode="numeric"
                        selectTitle={t("materialQty")}
                        inputTitle={t("materialQty")}
                        requireExplicitCommit={requireExplicitPickerCommit}
                        style={{ width: "100%" }}
                      />
                    </div>

                    {showInternalCostFields ? (
                      <div className="pe-material-item-field pe-material-item-field-cost" style={{ display: "grid", gap: 4 }}>
                        <div style={styles.label}>{t("materialCostInternal")}</div>
                        <input
                          className="pe-input"
                          value={it.cost ?? ""}
                          onChange={(e) => updateMaterialItem(i, "cost", e.target.value)}
                          onBlur={(e) => updateMaterialItem(i, "cost", normalizeMoneyInput(e.target.value))}
                          placeholder="0.00"
                          inputMode="decimal"
                          title={lang === "es" ? "Solo interno (no se imprime)" : "Internal only (not printed)"}
                          disabled={lockInternalCostFields}
                          style={{ width: "100%", opacity: lockInternalCostFields ? 0.72 : 1 }}
                        />
                      </div>
                    ) : null}

                    <div className="pe-material-item-field pe-material-item-field-price" style={{ display: "grid", gap: 4 }}>
                      <div style={styles.label}>{t("materialCharge")}</div>
                      <input
                        className="pe-input"
                        value={it.charge}
                        onChange={(e) => updateMaterialItem(i, "charge", e.target.value)}
                        onBlur={(e) => updateMaterialItem(i, "charge", normalizeMoneyInput(e.target.value))}
                        placeholder="0.00"
                        inputMode="decimal"
                        style={{ width: "100%" }}
                      />
                    </div>

                    <div className="pe-material-item-field pe-material-item-field-markup" style={{ display: "grid", gap: 4 }}>
                      <div style={styles.label}>{t("markupPct")}</div>
                      <InlineCustomNumberField
                        value={lineMarkupValue}
                        options={MARKUP_PRESET_OPTIONS}
                        customOptionValue={CUSTOM_PICKER_OPTION_VALUE}
                        deriveSelection={(value) => deriveMarkupSelection(value, normalizePercentInput)}
                        optionToValue={(selection) => String(Number(selection))}
                        formatOptionLabel={(value) => `${value}%`}
                        normalizeDraft={(value) => normalizeCustomMarkupDraft(value, 200)}
                        normalizeFinal={(value) => normalizeCustomMarkupFinal(value, 200)}
                        onValueChange={(nextValue) => updateMaterialItem(i, "markupPct", nextValue)}
                        onValueCommit={(nextValue) => updateMaterialItem(i, "markupPct", nextValue)}
                        className="pe-input"
                        placeholder={t("markupPct")}
                        inputMode="decimal"
                        disabled={lockMarkupToGlobal}
                        selectTitle={lockMarkupToGlobal ? "Locked to global default markup" : "Line markup"}
                        inputTitle={lockMarkupToGlobal ? "Locked to global default markup" : "Line markup"}
                        suffix="%"
                        requireExplicitCommit={requireExplicitPickerCommit}
                        style={{ width: "100%", opacity: lockMarkupToGlobal ? 0.72 : 1 }}
                      />
                    </div>

                    <button
                      className="pe-btn pe-btn-ghost pe-labor-trash-btn pe-material-item-delete"
                      type="button"
                      onClick={() => removeMaterialItem(i)}
                      title={
                        i === 0
                          ? (lang === "es"
                            ? "Limpiar partida base (la fila se mantiene)"
                            : "Clear base item (row stays)")
                          : (lang === "es" ? "Quitar material" : "Remove item")
                      }
                      style={styles.lineTrashBtn}
                    >
                      {trashIcon || "🗑"}
                    </button>
                  </div>

                  <div className="pe-row pe-row-slim" style={{ marginTop: 6 }}>
                    <div className="pe-muted">
                      {lang === "es" ? "Total de línea" : "Line total"}
                    </div>
                    <div className="pe-value">{money.format(lineTotal)}</div>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="pe-row pe-row-slim" style={{ marginTop: 10 }}>
            <div className="pe-muted">{t("materialsItemizedTotal")}</div>
            <div className={`pe-value ${animateMaterialsTotal ? "value-pulse" : ""}`}>{money.format(itemizedMaterialsTotal)}</div>
          </div>
          <div style={materialsBottomActionsStyle}>
            <button
              type="button"
              className="pe-btn pe-btn-ghost"
              onClick={() => setMaterialsOpen(false)}
              title={lang === "es" ? "Colapsar" : "Collapse"}
              style={styles.sectionFooterBtn}
            >
              {lang === "es" ? "Colapsar" : "Collapse"} ▴
            </button>
            <button className="pe-btn pe-btn-micro" type="button" onClick={(e) => addMaterialItem?.(e)} style={styles.sectionFooterBtn}>
              {t("addMaterialItem")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
