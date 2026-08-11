import React, { useEffect, useRef, useState } from "react";
import { resolveStepTitle } from "../../estimator/wizard/steps";

const COPY = Object.freeze({
  en: {
    documentLabel: (docType) => (docType === "invoice" ? "Invoice" : "Estimate"),
    stepOf: (n, total) => `Step ${n} of ${total}`,
    progressLabel: "Builder progress",
    optional: "Optional",
    sectionNavigator: "Jump to section",
    sectionNavigatorShort: "Sections",
    current: "Current",
  },
  es: {
    documentLabel: (docType) => (docType === "invoice" ? "Factura" : "Estimado"),
    stepOf: (n, total) => `Paso ${n} de ${total}`,
    progressLabel: "Progreso del generador",
    optional: "Opcional",
    sectionNavigator: "Ir a sección",
    sectionNavigatorShort: "Secciones",
    current: "Actual",
  },
});

function prefersReducedMotion() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return Boolean(window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  } catch {
    return false;
  }
}

/**
 * Shared wizard chrome for both builders.
 *
 * Presentation only. Every action is a handler supplied by the builder that
 * owns the record, so Save & Exit runs the existing save path and the running
 * total is the number the existing engine already produced.
 */
export default function BuilderWizardShell({
  lang = "en",
  docType = "estimate",
  steps = [],
  activeStep,
  stepNumber,
  totalSteps,
  direction = "forward",
  stepError = "",
  onStepSelect,
  children,
}) {
  const copy = COPY[String(lang).toLowerCase() === "es" ? "es" : "en"] || COPY.en;
  const [reducedMotion, setReducedMotion] = useState(() => prefersReducedMotion());
  const liveRegionRef = useRef(null);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    let query;
    try {
      query = window.matchMedia("(prefers-reduced-motion: reduce)");
    } catch {
      return undefined;
    }
    const onChange = () => setReducedMotion(Boolean(query.matches));
    onChange();
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    }
    if (typeof query.addListener === "function") {
      query.addListener(onChange);
      return () => query.removeListener(onChange);
    }
    return undefined;
  }, []);

  const stepTitle = resolveStepTitle(activeStep, { lang, docType });
  // Progress reports *completed* work, not the position of the active step.
  // Simply arriving on Step 1 has completed nothing, so a fresh document reads
  // 0%. Each step the contractor moves past adds one completed unit, and the
  // terminal Review step -- reached only after the whole build flow -- reads
  // 100%. This is a presentation of the existing wizard position; it invents no
  // field-level completion state.
  const clampedStepNumber = Math.max(0, Math.min(totalSteps, stepNumber));
  const completedSteps = totalSteps > 0
    ? (clampedStepNumber >= totalSteps ? totalSteps : Math.max(0, clampedStepNumber - 1))
    : 0;
  const percent = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
  const transitionClass = reducedMotion
    ? "pe-wizard-body pe-wizard-body-static"
    : `pe-wizard-body pe-wizard-body-${direction === "backward" ? "back" : "forward"}`;


  return (
    <div className="pe-wizard" data-doc-type={docType} data-reduced-motion={reducedMotion ? "1" : "0"}>
      <div className="pe-wizard-header">
        <div className="pe-wizard-header-row">
          <div className="pe-wizard-heading">
            <h2 className="pe-wizard-title">{stepTitle}</h2>
            <div className="pe-wizard-orientation-row">
              <div className="pe-wizard-meta-row">
                <span className="pe-wizard-document-label">{copy.documentLabel(docType)}</span>
                <span className="pe-wizard-meta-divider" aria-hidden="true">·</span>
                <span className="pe-wizard-step-count">{copy.stepOf(stepNumber, totalSteps)}</span>
                <span className="pe-wizard-meta-divider" aria-hidden="true">·</span>
                <span className="pe-wizard-percentage">{percent}%</span>
              </div>
              <label className="pe-section-jump-wrap">
                <span className="pe-wizard-live">{copy.sectionNavigator}</span>
                <select
                  className="pe-section-jump"
                  aria-label={copy.sectionNavigator}
                  value=""
                  onChange={(event) => {
                    const stepId = String(event.target.value || "");
                    if (stepId && typeof onStepSelect === "function") onStepSelect(stepId);
                  }}
                >
                  <option value="">{copy.sectionNavigatorShort}</option>
                  {(Array.isArray(steps) ? steps : []).map((step) => (
                    <option key={step.id} value={step.id}>
                      {step.id === activeStep?.id ? `${copy.current}: ` : ""}
                      {resolveStepTitle(step, { lang, docType })}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </div>

        <div
          className="pe-wizard-progress"
          role="progressbar"
          aria-label={copy.progressLabel}
          aria-valuemin={1}
          aria-valuemax={totalSteps}
          aria-valuenow={stepNumber}
          aria-valuetext={`${copy.stepOf(stepNumber, totalSteps)} — ${stepTitle}`}
        >
          <div className="pe-wizard-progress-fill" style={{ width: `${percent}%` }} />
        </div>

        {stepError ? (
          <div className="pe-wizard-error" role="alert">
            {stepError}
          </div>
        ) : null}
      </div>

      <div
        key={activeStep ? activeStep.id : "step"}
        className={transitionClass}
      >
        {children}
      </div>

      <div
        ref={liveRegionRef}
        role="status"
        aria-live="polite"
        className="pe-wizard-live"
      >
        {stepError ? "" : `${copy.stepOf(stepNumber, totalSteps)} — ${stepTitle}`}
      </div>

    </div>
  );
}
