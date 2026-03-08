// @ts-nocheck
/* eslint-disable */

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";

const BLANKET_DESCRIPTION_MIN_HEIGHT = 100;

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

export default function SectionMaterials(props) {
  const {
    t,
    lang,
    styles,
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
  } = props || {};
  const blanketDescriptionRef = useRef(null);
  const noteInputRefs = useRef({});
  const [noteOpenById, setNoteOpenById] = useState({});
  const blanketDescriptionValue = String(materialsBlanketDescription || "");

  useEffect(() => {
    setNoteOpenById((prev) => {
      const next = {};
      for (let i = 0; i < materialItems.length; i += 1) {
        const item = materialItems[i];
        const id = String(item?.id ?? i);
        next[id] = Object.prototype.hasOwnProperty.call(prev, id)
          ? prev[id]
          : !!String(item?.note || "").trim();
      }

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) return next;
      for (const key of nextKeys) {
        if (prev[key] !== next[key]) return next;
      }
      return prev;
    });
  }, [materialItems]);

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
              <input
                className="pe-input"
                value={materialsMarkupPct}
                onChange={(e) => setMaterialsMarkupPct(e.target.value)}
                onBlur={(e) => setMaterialsMarkupPct(normalizePercentInput(e.target.value))}
                placeholder={t("markupPct")}
                inputMode="decimal"
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
                  className={materialItemCardClass}
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
                    style={{
                      marginTop: 8,
                      display: "grid",
                      gridTemplateColumns: showInternalCostFields ? "1fr 1fr 1fr 1fr 40px" : "1fr 1fr 1fr 40px",
                      gap: 8,
                      alignItems: "end",
                    }}
                  >
                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={styles.label}>{t("materialQty")}</div>
                      <select
                        className="pe-input"
                        value={qtyVal}
                        onChange={(e) => updateMaterialItem(i, "qty", e.target.value)}
                        title={t("materialQty")}
                        style={{ width: "100%" }}
                      >
                        {Array.from({ length: 50 }, (_, n) => n + 1).map((n) => (
                          <option key={n} value={n}>
                            {n}
                          </option>
                        ))}
                      </select>
                    </div>

                    {showInternalCostFields ? (
                      <div style={{ display: "grid", gap: 4 }}>
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

                    <div style={{ display: "grid", gap: 4 }}>
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

                    <div style={{ display: "grid", gap: 4 }}>
                      <div style={styles.label}>{t("markupPct")}</div>
                      <input
                        className="pe-input"
                        value={lineMarkupValue}
                        onChange={(e) => updateMaterialItem(i, "markupPct", e.target.value)}
                        onBlur={(e) => updateMaterialItem(i, "markupPct", normalizePercentInput(e.target.value))}
                        placeholder={t("markupPct")}
                        inputMode="decimal"
                        disabled={lockMarkupToGlobal}
                        title={lockMarkupToGlobal ? "Locked to global default markup" : "Line markup"}
                        style={{ width: "100%", opacity: lockMarkupToGlobal ? 0.72 : 1 }}
                      />
                    </div>

                    <button
                      className="pe-btn pe-btn-ghost pe-labor-trash-btn"
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
          <div style={styles.laborBottomActions}>
            <button
              type="button"
              className="pe-btn pe-btn-ghost"
              onClick={() => setMaterialsOpen(false)}
              title={lang === "es" ? "Colapsar" : "Collapse"}
              style={{ padding: "6px 10px" }}
            >
              {lang === "es" ? "Colapsar" : "Collapse"} ▴
            </button>
            <button className="pe-btn pe-btn-micro" type="button" onClick={addMaterialItem}>
              {t("addMaterialItem")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
