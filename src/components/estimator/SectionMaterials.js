// @ts-nocheck
/* eslint-disable */

import React from "react";

export default function SectionMaterials(props) {
  const {
    t,
    lang,
    styles,
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
    normalizePercentInput,
    normalizedMarkupPct,
    animateMaterialsTotal,
    materialsBilled,
    materialItems,
    updateMaterialItem,
    removeMaterialItem,
    newMaterialItemIds,
    itemizedMaterialsTotal,
    addMaterialItem,
  } = props || {};

  return (
    <section className="pe-section">
      <div className="pe-divider" style={styles.sectionHeaderDivider} />
      <div style={styles.sectionHeaderRow}>
        <div style={{ ...styles.sectionTitleStack, marginBottom: 0 }}>
          <div className="pe-section-title" style={styles.sectionTitleText}>{t("materials")}</div>
          <div style={styles.sectionAccentLine} />
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
              const lineTotal = qtyVal * eachVal;
              return (
                <div
                  key={i}
                  className={newMaterialItemIds?.[String(it.id)] ? "pe-anim-enter" : ""}
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

                  <div
                    style={{
                      marginTop: 8,
                      display: "grid",
                      gridTemplateColumns: "1fr 1fr 1fr 40px",
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
                        style={{ width: "100%" }}
                      />
                    </div>

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

                    <button
                      className="pe-btn pe-btn-ghost"
                      type="button"
                      onClick={() => removeMaterialItem(i)}
                      title={
                        materialItems.length === 1
                          ? (lang === "es"
                            ? "Limpiar línea (la última partida no se puede borrar)"
                            : "Clear line (last item can't be removed)")
                          : (lang === "es" ? "Quitar material" : "Remove item")
                      }
                      style={styles.lineDeleteBtn}
                    >
                      −
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
