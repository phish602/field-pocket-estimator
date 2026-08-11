import React from "react";

const COPY = Object.freeze({
  en: {
    back: "Back",
    next: "Next",
    reviewSave: "Review & Save",
    clear: "Clear",
    region: "Builder actions",
    estimateTotal: "Estimate Total",
    invoiceTotal: "Invoice Total",
    estimate: "Estimate",
    invoice: "Invoice",
    financialSummary: "Live financial summary",
  },
  es: {
    back: "Atrás",
    next: "Siguiente",
    reviewSave: "Revisar y guardar",
    clear: "Limpiar",
    region: "Acciones del generador",
    estimateTotal: "Total del estimado",
    invoiceTotal: "Total de la factura",
    estimate: "Estimado",
    invoice: "Factura",
    financialSummary: "Resumen financiero en vivo",
  },
});

/**
 * The single command region for the Estimate / Invoice builder.
 *
 * This replaces the former split between a scroll-aware document-action bar and
 * a separate wizard navigation footer. It is presentation only: every action is
 * an existing handler passed in by the builder that owns the record, and the
 * context and financial values are already-formatted outputs from the current
 * record and its existing calculation engine -- nothing here computes, saves,
 * or stores anything.
 */
export default function BuilderCommandBar({
  lang = "en",
  docType = "estimate",
  totalLabel,
  totalValue,
  customerName = "",
  projectName = "",
  saveStatus = "",
  financialItems = [],
  showTotal = true,
  isFirstStep = false,
  isLastStep = false,
  onBack,
  onNext,
  onReviewSave,
  onClear,
  clearLabel,
  statusSlot = null,
  shellChromeVisible = true,
  nextDisabled = false,
}) {
  const copy = COPY[String(lang).toLowerCase() === "es" ? "es" : "en"] || COPY.en;
  const resolvedTotalLabel = totalLabel
    || (docType === "invoice" ? copy.invoiceTotal : copy.estimateTotal);
  const documentLabel = docType === "invoice" ? copy.invoice : copy.estimate;
  const visibleFinancialItems = (Array.isArray(financialItems) ? financialItems : [])
    .filter((item) => item && item.label && item.value !== undefined && item.value !== null);
  const normalizedCustomerName = String(customerName || "").trim();
  const normalizedProjectName = String(projectName || "").trim();
  const contextPrimary = normalizedCustomerName || normalizedProjectName;
  const contextSecondary = normalizedCustomerName && normalizedProjectName ? normalizedProjectName : "";
  const hasMeaningfulContext = Boolean(contextPrimary);

  return (
    <div
      className={`pe-command-bar ${shellChromeVisible ? "is-shell-visible" : "is-shell-hidden"}`}
      data-command-dock="viewport"
      data-shell-chrome-visible={shellChromeVisible ? "true" : "false"}
      role="group"
      aria-label={copy.region}
      aria-hidden={shellChromeVisible ? undefined : "true"}
    >
      <div className="pe-command-bar-inner">
        {/* One workspace toolbar: value, document utilities, then progression. */}
        <div className={`pe-command-bar-doc ${showTotal ? "has-summary" : "is-actions-only"}`}>
          {showTotal ? (
            <div className="pe-command-summary">
              {hasMeaningfulContext ? (
                <div
                  className="pe-command-context"
                  data-command-priority="medium"
                  aria-label={`${documentLabel} · ${contextPrimary}${contextSecondary ? ` · ${contextSecondary}` : ""}`}
                >
                  <span className="pe-command-context-type">{documentLabel}</span>
                  <strong title={contextPrimary}>{contextPrimary}</strong>
                  {contextSecondary ? <span title={contextSecondary}>{contextSecondary}</span> : null}
                </div>
              ) : null}

              {visibleFinancialItems.length ? (
                <div
                  className="pe-command-financials"
                  data-command-priority="wide"
                  aria-label={copy.financialSummary}
                >
                  {visibleFinancialItems.map((item) => (
                    <div className="pe-command-financial" key={item.id || item.label}>
                      <span>{item.label}</span>
                      <strong>{item.value}</strong>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Keeps the long-standing `.pe-total` hook so existing selectors
                  continue to resolve after the total moved out of the content. */}
              {totalValue ? (
                <div className="pe-total pe-command-total" data-command-priority="always">
                  <span className="pe-command-total-label">{resolvedTotalLabel}</span>
                  <span className="pe-command-total-value" aria-live="polite">{totalValue}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="pe-command-doc-actions">
            <button
              type="button"
              className="pe-btn pe-btn-ghost pe-command-clear"
              onClick={onClear}
            >
              {clearLabel || copy.clear}
            </button>
            <button
              type="button"
              className="pe-btn pe-btn-ghost pe-command-finalize"
              onClick={onReviewSave}
            >
              {copy.reviewSave}
            </button>
          </div>
        </div>

        <div className="pe-command-bar-nav">
          {!isFirstStep ? (
            <button type="button" className="pe-btn pe-btn-ghost pe-command-back" onClick={onBack}>
              {copy.back}
            </button>
          ) : <span className="pe-command-nav-spacer" />}

          {!isLastStep ? (
            <button
              type="button"
              className="pe-btn pe-command-next"
              onClick={onNext}
              disabled={nextDisabled}
            >
              <span className="pe-command-next-label">{copy.next}</span>
            </button>
          ) : <span className="pe-command-nav-spacer" />}
        </div>

        {statusSlot || saveStatus ? (
          <div className="pe-command-bar-status" data-command-priority="always">
            {statusSlot || <span className="pe-command-local-status">{saveStatus}</span>}
          </div>
        ) : null}
      </div>
    </div>
  );
}
