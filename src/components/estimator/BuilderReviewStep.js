import React from "react";

const COPY = Object.freeze({
  en: {
    edit: "Edit",
    empty: "Not added",
    reviewIntro: "A final preflight of the customer, job, scope, and pricing before you save or send.",
    ready: "Ready for final action",
    readyDetail: "Review any section, then open Review & Save to preview and approve the document.",
    document: "Document preview",
  },
  es: {
    edit: "Editar",
    empty: "Sin agregar",
    reviewIntro: "Una revisión final del cliente, trabajo, alcance y precio antes de guardar o enviar.",
    ready: "Listo para la acción final",
    readyDetail: "Revisa cualquier sección y luego abre Revisar y guardar para previsualizar y aprobar el documento.",
    document: "Vista previa del documento",
  },
});

/**
 * Final wizard screen.
 *
 * Every value shown here is passed in already-computed by the builder. This
 * component performs no arithmetic of its own -- it reads the same totals the
 * existing engine produced, so the review can never disagree with the record.
 */
export default function BuilderReviewStep({
  lang = "en",
  sections = [],
  onEditStep,
  actions = null,
  totalLabel = "",
  totalValue = "",
}) {
  const copy = COPY[String(lang).toLowerCase() === "es" ? "es" : "en"] || COPY.en;

  return (
    <div className="pe-review">
      <div className="pe-review-hero">
        <div className="pe-review-ready-mark" aria-hidden="true">✓</div>
        <div>
          <div className="pe-review-kicker">{copy.document}</div>
          <div className="pe-review-intro">{copy.reviewIntro}</div>
        </div>
      </div>

      <div className="pe-review-layout">
        <div className="pe-review-document">
          {sections.map((section) => (
            <section key={section.stepId} className="pe-card pe-review-card" data-review-section={section.stepId}>
              <div className="pe-review-card-head">
                <div className="pe-review-card-title">{section.title}</div>
                <button
                  type="button"
                  className="pe-btn pe-btn-ghost pe-review-edit"
                  onClick={() => onEditStep && onEditStep(section.stepId)}
                  aria-label={`${copy.edit} — ${section.title}`}
                >
                  {copy.edit}
                </button>
              </div>
              <dl className="pe-review-rows">
                {(section.rows || []).map((row, index) => (
                  <div className="pe-review-row" key={`${section.stepId}_${row.label}_${index}`}>
                    <dt className="pe-review-row-label">{row.label}</dt>
                    <dd className="pe-review-row-value">
                      {row.value === "" || row.value === null || row.value === undefined
                        ? copy.empty
                        : row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <aside className="pe-review-sidebar" aria-label={copy.ready}>
          <div className="pe-review-status">
            <span className="pe-review-status-dot" aria-hidden="true" />
            <div>
              <strong>{copy.ready}</strong>
              <span>{copy.readyDetail}</span>
            </div>
          </div>
          {totalValue ? (
            <div className="pe-review-total">
              <span className="pe-review-total-label">{totalLabel}</span>
              <span className="pe-review-total-value">{totalValue}</span>
            </div>
          ) : null}
          {actions ? <div className="pe-review-actions">{actions}</div> : null}
        </aside>
      </div>
    </div>
  );
}
