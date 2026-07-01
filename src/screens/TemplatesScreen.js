import React, { useEffect, useMemo, useState } from "react";
import {
  deleteScopeTemplate,
  isLegacyScopeTemplateRecord,
  readStoredScopeTemplates,
  updateScopeTemplate,
  writeStoredScopeTemplates,
} from "../utils/scopeTemplates";
import { STORAGE_KEYS } from "../constants/storageKeys";

function formatTemplateTimestamp(value) {
  const ts = Number(value || 0);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return "";
  }
}

function summarizeScope(scopeText = "") {
  const normalized = String(scopeText || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "No scope text saved.";
  return normalized.length > 220 ? `${normalized.slice(0, 217).trimEnd()}...` : normalized;
}

function countScopeLines(scopeText = "") {
  return String(scopeText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function hasBlanketMaterials(template = {}) {
  return Boolean(
    String(template?.materialsBlanketDescription || "").trim()
    || String(template?.materialsBlanketCost ?? "").trim()
    || String(template?.materialsBlanketInternalCost ?? "").trim()
    || String(template?.materialsMarkupPct ?? "").trim()
  );
}

export default function TemplatesScreen({ onOpenBuilder }) {
  const [templates, setTemplates] = useState(() => readStoredScopeTemplates());

  const commitTemplates = (nextTemplates) => {
    const saved = writeStoredScopeTemplates(nextTemplates);
    setTemplates(saved);
    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", {
        detail: {
          key: STORAGE_KEYS.SCOPE_TEMPLATES,
          value: JSON.stringify(saved),
        },
      }));
    } catch {}
    return saved;
  };

  useEffect(() => {
    const refreshTemplates = (event) => {
      if (event?.key && event.key !== STORAGE_KEYS.SCOPE_TEMPLATES) return;
      setTemplates(readStoredScopeTemplates());
    };
    const onLocalStorage = (event) => {
      if (event?.detail?.key === STORAGE_KEYS.SCOPE_TEMPLATES) {
        setTemplates(readStoredScopeTemplates());
      }
    };

    window.addEventListener("storage", refreshTemplates);
    window.addEventListener("pe-localstorage", onLocalStorage);
    return () => {
      window.removeEventListener("storage", refreshTemplates);
      window.removeEventListener("pe-localstorage", onLocalStorage);
    };
  }, []);

  const templateCards = useMemo(() => (
    templates.map((template) => {
      const scopeText = String(template?.scopeText || "");
      const lineCount = countScopeLines(scopeText);
      const updatedLabel = formatTemplateTimestamp(template?.updatedAt);
      const sourceDocNumber = String(template?.sourceEstimateNumber || "").trim();
      const laborCount = Array.isArray(template?.laborItems) ? template.laborItems.length : 0;
      const materialItemCount = Array.isArray(template?.materialItems) ? template.materialItems.length : 0;
      const materialCount = materialItemCount > 0
        ? materialItemCount
        : (hasBlanketMaterials(template) ? 1 : 0);
      const additionalChargeCount = Array.isArray(template?.additionalChargeItems)
        ? template.additionalChargeItems.length
        : 0;
      const includesNotes = Boolean(String(template?.additionalNotes || "").trim());
      const isLegacyScopeOnly = isLegacyScopeTemplateRecord(template);
      return {
        id: String(template?.id || "").trim(),
        name: String(template?.name || "Untitled template").trim(),
        summary: summarizeScope(scopeText),
        lineCount,
        laborCount,
        materialCount,
        additionalChargeCount,
        includesNotes,
        isLegacyScopeOnly,
        updatedLabel,
        sourceDocNumber,
      };
    })
  ), [templates]);

  const handleRenameTemplate = (templateId) => {
    const existing = templates.find((entry) => String(entry?.id || "").trim() === String(templateId || "").trim());
    if (!existing) return;
    const nextName = window.prompt("Rename template:", String(existing?.name || "").trim());
    if (nextName === null) return;

    const updated = updateScopeTemplate(templates, templateId, { name: nextName });
    commitTemplates(updated);
  };

  const handleDeleteTemplate = (templateId) => {
    const existing = templates.find((entry) => String(entry?.id || "").trim() === String(templateId || "").trim());
    if (!existing) return;
    const ok = window.confirm(`Delete template "${existing.name}"?`);
    if (!ok) return;

    const updated = deleteScopeTemplate(templates, templateId);
    commitTemplates(updated);
  };

  return (
    <div className="pe-wrap" style={{ display: "grid", gap: 14 }}>
      <div className="pe-builder-bar" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <h1 className="pe-title screenTitle" style={{ margin: 0 }}>Templates</h1>
          <div className="pe-muted" style={{ marginTop: 4 }}>
            Reusable work package templates shared across estimates and invoices.
          </div>
          <div className="pe-muted" style={{ marginTop: 4 }}>
            Applying a template updates work content only and does not replace customer or job details.
          </div>
        </div>
      </div>

      <section className="pe-card" style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", color: "rgba(226,236,244,0.72)" }}>
              Saved Templates
            </div>
            <div className="pe-muted" style={{ marginTop: 4 }}>
              Save templates from the builder, then manage them here.
            </div>
          </div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(226,236,244,0.78)" }}>
            {templates.length} {templates.length === 1 ? "template" : "templates"}
          </div>
        </div>

        {templateCards.length === 0 ? (
          <div
            style={{
              borderRadius: 16,
              border: "1px dashed rgba(148,163,184,0.28)",
              background: "rgba(255,255,255,0.03)",
              padding: 18,
              display: "grid",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 16, fontWeight: 800 }}>No saved templates yet</div>
            <div className="pe-muted">
              Create a reusable work package in the builder, then use “Save as Template” to keep it for future customers and jobs.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {templateCards.map((template) => (
              <article
                key={template.id}
                className="pe-card"
                style={{
                  display: "grid",
                  gap: 10,
                  padding: 14,
                  borderRadius: 16,
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <div style={{ fontSize: 16, fontWeight: 800, color: "rgba(236,243,248,0.96)" }}>{template.name}</div>
                      {template.isLegacyScopeOnly ? (
                        <span style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "rgba(251,191,36,0.96)", background: "rgba(251,191,36,0.12)", borderRadius: 999, padding: "3px 8px", border: "1px solid rgba(251,191,36,0.22)" }}>
                          Scope-only legacy
                        </span>
                      ) : null}
                    </div>
                    <div className="pe-muted" style={{ marginTop: 4 }}>
                      {template.lineCount} {template.lineCount === 1 ? "scope line" : "scope lines"}
                      {` • ${template.laborCount} ${template.laborCount === 1 ? "labor line" : "labor lines"}`}
                      {` • ${template.materialCount} ${template.materialCount === 1 ? "material" : "materials"}`}
                      {` • ${template.additionalChargeCount} ${template.additionalChargeCount === 1 ? "additional charge" : "additional charges"}`}
                      {template.includesNotes ? " • notes included" : ""}
                      {template.updatedLabel ? ` • Updated ${template.updatedLabel}` : ""}
                      {template.sourceDocNumber ? ` • Saved from #${template.sourceDocNumber}` : ""}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="pe-btn pe-btn-ghost"
                      type="button"
                      onClick={() => handleRenameTemplate(template.id)}
                    >
                      Rename
                    </button>
                    <button
                      className="pe-btn pe-btn-ghost"
                      type="button"
                      onClick={() => handleDeleteTemplate(template.id)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.55, color: "rgba(220,229,238,0.82)", whiteSpace: "pre-wrap" }}>
                  {template.summary}
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
