// Step registry for the Estimate / Invoice builder wizard.
//
// This module is presentation metadata only. It owns no record state, no
// calculations, and no persistence -- the builder keeps exactly one estimator
// instance and one calculation engine, and the wizard only decides which part
// of that single record is on screen.

export const WIZARD_STEP_IDS = Object.freeze({
  CUSTOMER: "customer",
  PROJECT: "project",
  SCOPE: "scope",
  LABOR: "labor",
  CONDITIONS: "conditions",
  MATERIALS: "materials",
  CHARGES: "charges",
  TERMS: "terms",
  REVIEW: "review",
});

// Titles live here so the wizard chrome stays bilingual alongside the rest of
// the builder. Section bodies keep their own existing copy untouched.
const STEP_DEFINITIONS = [
  {
    id: WIZARD_STEP_IDS.CUSTOMER,
    en: "Customer",
    es: "Cliente",
    invoiceEn: "Customer",
    invoiceEs: "Cliente",
    optional: false,
  },
  {
    id: WIZARD_STEP_IDS.PROJECT,
    en: "Project Info",
    es: "Información del proyecto",
    invoiceEn: "Project / Invoice Info",
    invoiceEs: "Proyecto / Factura",
    optional: false,
  },
  {
    id: WIZARD_STEP_IDS.SCOPE,
    en: "Scope of Work",
    es: "Alcance del trabajo",
    invoiceEn: "Scope of Work",
    invoiceEs: "Alcance del trabajo",
    optional: true,
  },
  {
    id: WIZARD_STEP_IDS.LABOR,
    en: "Labor",
    es: "Mano de obra",
    optional: true,
  },
  {
    id: WIZARD_STEP_IDS.CONDITIONS,
    en: "Job Conditions",
    es: "Condiciones del trabajo",
    optional: true,
  },
  {
    id: WIZARD_STEP_IDS.MATERIALS,
    en: "Materials",
    es: "Materiales",
    optional: true,
  },
  {
    id: WIZARD_STEP_IDS.CHARGES,
    en: "Additional Charges",
    es: "Cargos adicionales",
    optional: true,
  },
  {
    id: WIZARD_STEP_IDS.TERMS,
    en: "Terms & Notes",
    es: "Términos y notas",
    optional: true,
  },
  {
    id: WIZARD_STEP_IDS.REVIEW,
    en: "Review",
    es: "Revisión",
    optional: false,
  },
];

function isSpanish(lang) {
  return String(lang || "").toLowerCase() === "es";
}

export function resolveStepTitle(step, { lang, docType } = {}) {
  if (!step) return "";
  const spanish = isSpanish(lang);
  if (docType === "invoice") {
    if (spanish && step.invoiceEs) return step.invoiceEs;
    if (!spanish && step.invoiceEn) return step.invoiceEn;
  }
  return spanish ? step.es : step.en;
}

/**
 * The visible step list for the current document.
 *
 * Estimate and Invoice share this full section sequence. Optional content may
 * be empty, but its editing step remains reachable in both document types.
 */
export function resolveWizardSteps({ docType = "estimate" } = {}) {
  return STEP_DEFINITIONS.map((step) => ({ ...step, docType }));
}

export function findStepIndex(steps, stepId) {
  if (!Array.isArray(steps)) return -1;
  return steps.findIndex((step) => step && step.id === stepId);
}

export function isReviewStep(stepId) {
  return stepId === WIZARD_STEP_IDS.REVIEW;
}

/**
 * Where a builder session should open.
 *
 * New records start at the beginning. An existing-record edit can nominate
 * Review as its one-time entry point without persisting wizard position or
 * changing the active step again after the contractor starts navigating.
 */
export function resolveInitialStepId(steps, preferredStepId) {
  const list = Array.isArray(steps) ? steps : [];
  if (findStepIndex(list, preferredStepId) !== -1) return preferredStepId;
  return list.length ? list[0].id : WIZARD_STEP_IDS.CUSTOMER;
}
