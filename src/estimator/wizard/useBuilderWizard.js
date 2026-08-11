import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  findStepIndex,
  resolveInitialStepId,
  resolveWizardSteps,
  WIZARD_STEP_IDS,
} from "./steps";

/**
 * Presentation-only wizard state for the Estimate / Invoice builder.
 *
 * This hook holds a step id and a movement direction. It deliberately owns no
 * record data: it never saves, never rehydrates, never touches the estimator
 * store, and never runs a calculation. Moving between steps is a render
 * decision, so unsaved in-memory edits survive Back/Next for free -- the
 * builder's single state object is simply still there.
 */
export default function useBuilderWizard({
  docType = "estimate",
  initialStepId,
  validateStep,
} = {}) {
  const steps = useMemo(
    () => resolveWizardSteps({ docType }),
    [docType]
  );

  const [activeStepId, setActiveStepId] = useState(() => resolveInitialStepId(steps, initialStepId));
  const [direction, setDirection] = useState("forward");
  const [stepError, setStepError] = useState("");
  const validateRef = useRef(validateStep);
  validateRef.current = validateStep;

  useEffect(() => {
    if (findStepIndex(steps, activeStepId) !== -1) return;
    setActiveStepId(resolveInitialStepId(steps));
  }, [steps, activeStepId]);

  const activeIndex = findStepIndex(steps, activeStepId);
  const safeIndex = activeIndex === -1 ? 0 : activeIndex;
  const activeStep = steps[safeIndex] || null;
  const totalSteps = steps.length;
  const isFirstStep = safeIndex <= 0;
  const isLastStep = safeIndex >= totalSteps - 1;

  const clearStepError = useCallback(() => setStepError(""), []);

  const goToStep = useCallback((stepId, options = {}) => {
    setActiveStepId((current) => {
      const nextIndex = findStepIndex(steps, stepId);
      if (nextIndex === -1) return current;
      const currentIndex = findStepIndex(steps, current);
      const movingBack = currentIndex !== -1 && nextIndex < currentIndex;
      setDirection(options.direction || (movingBack ? "backward" : "forward"));
      return stepId;
    });
    setStepError("");
  }, [steps]);

  const goBack = useCallback(() => {
    // Back never validates. Someone retreating from a step should not be held
    // there by a complaint about that step.
    setActiveStepId((current) => {
      const currentIndex = findStepIndex(steps, current);
      if (currentIndex <= 0) return current;
      setDirection("backward");
      return steps[currentIndex - 1].id;
    });
    setStepError("");
  }, [steps]);

  const goNext = useCallback(() => {
    const currentIndex = findStepIndex(steps, activeStepId);
    if (currentIndex === -1 || currentIndex >= steps.length - 1) return false;

    const validator = validateRef.current;
    const result = typeof validator === "function"
      ? validator(activeStepId)
      : "";
    const message = typeof result === "string" ? result.trim() : "";
    if (message) {
      // Inline guidance only -- no alert()/confirm() for wizard navigation.
      setStepError(message);
      return false;
    }

    setDirection("forward");
    setActiveStepId(steps[currentIndex + 1].id);
    setStepError("");
    return true;
  }, [steps, activeStepId]);

  return {
    steps,
    activeStep,
    activeStepId: activeStep ? activeStep.id : WIZARD_STEP_IDS.CUSTOMER,
    activeIndex: safeIndex,
    stepNumber: safeIndex + 1,
    totalSteps,
    isFirstStep,
    isLastStep,
    direction,
    stepError,
    clearStepError,
    goNext,
    goBack,
    goToStep,
  };
}
