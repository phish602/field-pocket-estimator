import { act, fireEvent, screen } from "@testing-library/react";

/**
 * Advance the builder wizard until the requested step is on screen.
 *
 * Existing builder tests were written against the single-scroll form, where
 * every section was mounted at once. The wizard mounts one step at a time, so
 * those tests now say explicitly which step they are exercising instead of
 * relying on everything being present.
 */
function isOnStep(stepId) {
  return Boolean(document.querySelector(`[data-wizard-step="${stepId}"]`));
}

function clickWizardControl(namePattern) {
  const button = screen.queryByRole("button", { name: namePattern });
  if (!button) return false;
  act(() => {
    fireEvent.click(button);
  });
  return true;
}

function selectWizardStep(stepId) {
  const navigator = screen.queryByRole("combobox", { name: /^(Jump to section|Ir a sección)$/ });
  if (!navigator) return false;
  act(() => {
    fireEvent.change(navigator, { target: { value: stepId } });
  });
  return true;
}

export function advanceToWizardStep(stepId, { maxSteps = 12 } = {}) {
  for (let i = 0; i < maxSteps; i += 1) {
    if (isOnStep(stepId)) return true;
    if (!clickWizardControl(/^(Next|Siguiente)$/)) break;
  }
  if (!isOnStep(stepId)) selectWizardStep(stepId);
  if (!isOnStep(stepId)) {
    throw new Error(`Could not reach wizard step "${stepId}" using the builder navigation controls.`);
  }
  return true;
}

/**
 * Navigate to a step in either direction using the visible Back/Next controls.
 * Tries forward first, then walks back, so a test can assert on an earlier
 * screen after visiting a later one.
 */
export function goToWizardStep(stepId, { maxSteps = 12 } = {}) {
  for (let i = 0; i < maxSteps; i += 1) {
    if (isOnStep(stepId)) return true;
    if (!clickWizardControl(/^(Back|Atrás)$/)) break;
  }
  if (isOnStep(stepId)) return true;

  for (let i = 0; i < maxSteps; i += 1) {
    if (isOnStep(stepId)) return true;
    if (!clickWizardControl(/^(Next|Siguiente)$/)) break;
  }
  if (!isOnStep(stepId)) selectWizardStep(stepId);
  if (!isOnStep(stepId)) {
    throw new Error(`Could not reach wizard step "${stepId}" using the builder navigation controls.`);
  }
  return true;
}

export const advanceToLaborStep = () => advanceToWizardStep("labor");
export const advanceToScopeStep = () => advanceToWizardStep("scope");
export const advanceToMaterialsStep = () => advanceToWizardStep("materials");
export const advanceToTermsStep = () => advanceToWizardStep("terms");
export const advanceToReviewStep = () => advanceToWizardStep("review");
