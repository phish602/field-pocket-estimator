import React from "react";

/**
 * Renders a builder section only while it is the active wizard step.
 *
 * Inactive steps are unmounted rather than hidden with CSS: the whole point of
 * this change is that a contractor on a phone is never scrolling past seven
 * other sections to reach the one they want.
 */
export default function BuilderWizardStep({ stepId, activeStepId, children }) {
  if (stepId !== activeStepId) return null;
  return (
    <div
      className={`pe-wizard-step pe-wizard-step-${stepId}`}
      data-wizard-step={stepId}
    >
      {children}
    </div>
  );
}
