import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import useBuilderWizard from "./useBuilderWizard";
import { WIZARD_STEP_IDS, resolveWizardSteps, resolveStepTitle } from "./steps";

// Small harness so the hook is exercised the way the builder uses it, without
// reaching into internal setters.
function Harness({ docType = "estimate", initialStepId, validateStep }) {
  const wizard = useBuilderWizard({ docType, initialStepId, validateStep });
  return (
    <div>
      <div data-testid="active">{wizard.activeStepId}</div>
      <div data-testid="number">{wizard.stepNumber}</div>
      <div data-testid="total">{wizard.totalSteps}</div>
      <div data-testid="direction">{wizard.direction}</div>
      <div data-testid="first">{String(wizard.isFirstStep)}</div>
      <div data-testid="last">{String(wizard.isLastStep)}</div>
      <div data-testid="error">{wizard.stepError}</div>
      <button type="button" onClick={wizard.goNext}>next</button>
      <button type="button" onClick={wizard.goBack}>back</button>
      <button type="button" onClick={() => wizard.goToStep(WIZARD_STEP_IDS.MATERIALS)}>jump</button>
    </div>
  );
}

const active = () => screen.getByTestId("active").textContent;
const clickNext = () => fireEvent.click(screen.getByText("next"));
const clickBack = () => fireEvent.click(screen.getByText("back"));

describe("builder wizard step registry", () => {
  test("estimate documents expose the nine agreed steps in order", () => {
    const ids = resolveWizardSteps({ docType: "estimate" }).map((s) => s.id);
    expect(ids).toEqual([
      WIZARD_STEP_IDS.CUSTOMER,
      WIZARD_STEP_IDS.PROJECT,
      WIZARD_STEP_IDS.SCOPE,
      WIZARD_STEP_IDS.LABOR,
      WIZARD_STEP_IDS.CONDITIONS,
      WIZARD_STEP_IDS.MATERIALS,
      WIZARD_STEP_IDS.CHARGES,
      WIZARD_STEP_IDS.TERMS,
      WIZARD_STEP_IDS.REVIEW,
    ]);
  });

  test("Customer and Project Info stay separate consecutive steps", () => {
    const ids = resolveWizardSteps({ docType: "estimate" }).map((s) => s.id);
    expect(ids.indexOf(WIZARD_STEP_IDS.PROJECT)).toBe(ids.indexOf(WIZARD_STEP_IDS.CUSTOMER) + 1);
  });

  test("Review is always the final step", () => {
    const ids = resolveWizardSteps({ docType: "invoice" }).map((s) => s.id);
    expect(ids[ids.length - 1]).toBe(WIZARD_STEP_IDS.REVIEW);
  });

  test("Invoice always exposes Scope between Project and Labor", () => {
    const ids = resolveWizardSteps({ docType: "invoice" }).map((s) => s.id);
    expect(ids).toHaveLength(9);
    expect(ids.slice(1, 4)).toEqual([
      WIZARD_STEP_IDS.PROJECT,
      WIZARD_STEP_IDS.SCOPE,
      WIZARD_STEP_IDS.LABOR,
    ]);
  });

  test("invoice titles override estimate wording where the document differs", () => {
    const steps = resolveWizardSteps({ docType: "invoice" });
    const project = steps.find((s) => s.id === WIZARD_STEP_IDS.PROJECT);
    const scope = steps.find((s) => s.id === WIZARD_STEP_IDS.SCOPE);
    expect(resolveStepTitle(project, { lang: "en", docType: "invoice" })).toBe("Project / Invoice Info");
    expect(resolveStepTitle(scope, { lang: "en", docType: "invoice" })).toBe("Scope of Work");
    expect(resolveStepTitle(project, { lang: "en", docType: "estimate" })).toBe("Project Info");
  });

  test("Spanish titles are provided for both document types", () => {
    const steps = resolveWizardSteps({ docType: "invoice" });
    const project = steps.find((s) => s.id === WIZARD_STEP_IDS.PROJECT);
    const customer = steps.find((s) => s.id === WIZARD_STEP_IDS.CUSTOMER);
    expect(resolveStepTitle(project, { lang: "es", docType: "invoice" })).toBe("Proyecto / Factura");
    expect(resolveStepTitle(customer, { lang: "es", docType: "estimate" })).toBe("Cliente");
  });
});

describe("useBuilderWizard navigation", () => {
  test("a new document opens on Customer as step 1 of 9", () => {
    render(<Harness />);
    expect(active()).toBe(WIZARD_STEP_IDS.CUSTOMER);
    expect(screen.getByTestId("number").textContent).toBe("1");
    expect(screen.getByTestId("total").textContent).toBe("9");
    expect(screen.getByTestId("first").textContent).toBe("true");
  });

  test("an invoice opens with the same nine-step shared sequence", () => {
    render(<Harness docType="invoice" />);
    expect(active()).toBe(WIZARD_STEP_IDS.CUSTOMER);
    expect(screen.getByTestId("total").textContent).toBe("9");
  });

  test("an existing-record session can open at Review once", () => {
    const { rerender } = render(<Harness initialStepId={WIZARD_STEP_IDS.REVIEW} />);
    expect(active()).toBe(WIZARD_STEP_IDS.REVIEW);

    fireEvent.click(screen.getByText("jump"));
    expect(active()).toBe(WIZARD_STEP_IDS.MATERIALS);

    rerender(<Harness initialStepId={WIZARD_STEP_IDS.REVIEW} />);
    expect(active()).toBe(WIZARD_STEP_IDS.MATERIALS);
  });

  test("an invalid preferred entry falls back to the first valid step", () => {
    render(<Harness initialStepId="not-a-step" />);
    expect(active()).toBe(WIZARD_STEP_IDS.CUSTOMER);
  });

  test("Next advances one step and reports forward direction", () => {
    render(<Harness />);
    clickNext();
    expect(active()).toBe(WIZARD_STEP_IDS.PROJECT);
    expect(screen.getByTestId("direction").textContent).toBe("forward");
  });

  test("Back returns to the prior step and reports backward direction", () => {
    render(<Harness />);
    clickNext();
    clickBack();
    expect(active()).toBe(WIZARD_STEP_IDS.CUSTOMER);
    expect(screen.getByTestId("direction").textContent).toBe("backward");
  });

  test("Back on the first step is inert rather than wrapping around", () => {
    render(<Harness />);
    clickBack();
    expect(active()).toBe(WIZARD_STEP_IDS.CUSTOMER);
  });

  test("Next on the final step does not advance past Review", () => {
    render(<Harness />);
    for (let i = 0; i < 12; i += 1) clickNext();
    expect(active()).toBe(WIZARD_STEP_IDS.REVIEW);
    expect(screen.getByTestId("last").textContent).toBe("true");
  });

  test("a genuine requirement blocks Next and surfaces inline guidance", () => {
    const validateStep = (stepId) => (stepId === WIZARD_STEP_IDS.CUSTOMER ? "Pick a customer to continue." : "");
    render(<Harness validateStep={validateStep} />);

    clickNext();

    expect(active()).toBe(WIZARD_STEP_IDS.CUSTOMER);
    expect(screen.getByTestId("error").textContent).toBe("Pick a customer to continue.");
  });

  test("Back never runs the current step's validation", () => {
    const validateStep = jest.fn(() => "Blocked.");
    render(<Harness validateStep={validateStep} />);

    // Move forward once with validation disabled for that step.
    validateStep.mockImplementationOnce(() => "");
    clickNext();
    expect(active()).toBe(WIZARD_STEP_IDS.PROJECT);

    validateStep.mockClear();
    clickBack();

    expect(active()).toBe(WIZARD_STEP_IDS.CUSTOMER);
    expect(validateStep).not.toHaveBeenCalled();
  });

  test("optional steps and legitimate zero values never block progression", () => {
    // The live builder supplies no validator, so every step passes through --
    // zero hours, zero dollars and empty optional sections included.
    render(<Harness />);
    clickNext();
    clickNext();
    clickNext();
    clickNext();
    expect(active()).toBe(WIZARD_STEP_IDS.CONDITIONS);
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  test("blocking guidance clears once the step is left", () => {
    const validateStep = jest.fn(() => "Blocked.");
    render(<Harness validateStep={validateStep} />);
    clickNext();
    expect(screen.getByTestId("error").textContent).toBe("Blocked.");

    clickBack();
    expect(screen.getByTestId("error").textContent).toBe("");
  });

  test("jumping directly to a step reports the correct direction", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("jump"));
    expect(active()).toBe(WIZARD_STEP_IDS.MATERIALS);
    expect(screen.getByTestId("direction").textContent).toBe("forward");

    // Jumping to an earlier step from Materials reads as backward.
    act(() => {});
    clickBack();
    expect(screen.getByTestId("direction").textContent).toBe("backward");
  });

  test("direct navigation bypasses the sequential Next validator", () => {
    const validateStep = jest.fn(() => "Blocked.");
    render(<Harness validateStep={validateStep} />);

    fireEvent.click(screen.getByText("jump"));

    expect(active()).toBe(WIZARD_STEP_IDS.MATERIALS);
    expect(validateStep).not.toHaveBeenCalled();
    expect(screen.getByTestId("error").textContent).toBe("");
  });
});
