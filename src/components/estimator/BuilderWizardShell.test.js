import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import BuilderWizardShell from "./BuilderWizardShell";
import BuilderReviewStep from "./BuilderReviewStep";
import { resolveWizardSteps, WIZARD_STEP_IDS } from "../../estimator/wizard/steps";

const STEPS = resolveWizardSteps({ docType: "estimate" });

function setMatchMedia(matches, { listenable = true } = {}) {
  const listeners = new Set();
  const query = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: listenable ? (_, cb) => listeners.add(cb) : undefined,
    removeEventListener: listenable ? (_, cb) => listeners.delete(cb) : undefined,
    addListener: listenable ? (cb) => listeners.add(cb) : undefined,
    removeListener: listenable ? (cb) => listeners.delete(cb) : undefined,
  };
  window.matchMedia = jest.fn(() => query);
  return {
    query,
    emit(next) {
      query.matches = next;
      listeners.forEach((cb) => cb(query));
    },
  };
}

function renderShell(overrides = {}) {
  const props = {
    lang: "en",
    docType: "estimate",
    steps: STEPS,
    activeStep: STEPS[0],
    stepNumber: 1,
    totalSteps: STEPS.length,
    direction: "forward",
    stepError: "",
    onStepSelect: jest.fn(),
    children: <div>step body</div>,
    ...overrides,
  };
  return { props, ...render(<BuilderWizardShell {...props} />) };
}

beforeEach(() => {
  setMatchMedia(false);
});

describe("BuilderWizardShell presentation", () => {
  test("identifies the active step by name and position", () => {
    renderShell();
    expect(screen.getByText("Estimate", { selector: ".pe-wizard-document-label" })).toBeInTheDocument();
    const heading = screen.getByRole("heading", { level: 2, name: "Customer" });
    expect(heading).toHaveClass("pe-wizard-title");
    expect(heading).not.toHaveClass("pe-section-title");
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    // A fresh document sitting on Step 1 has completed nothing.
    expect(screen.getByText("0%", { selector: ".pe-wizard-percentage" })).toBeInTheDocument();
    expect(screen.queryByText(/Estimate workflow/i)).not.toBeInTheDocument();
  });

  test("progress reports completed work, not the active step position", () => {
    // Step 1: nothing behind the contractor yet.
    const { unmount } = renderShell({ activeStep: STEPS[0], stepNumber: 1 });
    expect(screen.getByText("0%", { selector: ".pe-wizard-percentage" })).toBeInTheDocument();
    expect(document.querySelector(".pe-wizard-progress-fill")).toHaveStyle({ width: "0%" });
    unmount();

    // Step 2: one step (Customer) has been completed -> 1/9.
    const two = renderShell({ activeStep: STEPS[1], stepNumber: 2 });
    expect(screen.getByText("11%", { selector: ".pe-wizard-percentage" })).toBeInTheDocument();
    two.unmount();

    // Mid-flow advances consistently: Step 5 -> 4/9.
    const five = renderShell({ activeStep: STEPS[4], stepNumber: 5 });
    expect(screen.getByText("44%", { selector: ".pe-wizard-percentage" })).toBeInTheDocument();
    five.unmount();

    // Final Review step is the completion of the build flow -> 100%.
    renderShell({ activeStep: STEPS[STEPS.length - 1], stepNumber: STEPS.length });
    expect(screen.getByText("100%", { selector: ".pe-wizard-percentage" })).toBeInTheDocument();
    expect(document.querySelector(".pe-wizard-progress-fill")).toHaveStyle({ width: "100%" });
  });

  test("exposes progress to assistive technology, not by colour alone", () => {
    renderShell({ activeStep: STEPS[3], stepNumber: 4, isFirstStep: false });
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "4");
    expect(bar).toHaveAttribute("aria-valuemax", "9");
    expect(bar.getAttribute("aria-valuetext")).toContain("Step 4 of 9");
    expect(bar.getAttribute("aria-valuetext")).toContain("Labor");
  });

  test("uses one restrained progress line without a nine-number strip", () => {
    renderShell();
    expect(document.querySelectorAll(".pe-wizard-progress")).toHaveLength(1);
    expect(document.querySelector(".pe-wizard-dots")).toBeNull();
  });

  test("offers a compact section navigator backed by the shared step list", () => {
    const onStepSelect = jest.fn();
    renderShell({ onStepSelect });

    const navigator = screen.getByRole("combobox", { name: "Jump to section" });
    expect(navigator).toHaveDisplayValue("Sections");
    expect(Array.from(navigator.options).map((option) => option.textContent)).toEqual([
      "Sections",
      "Current: Customer",
      "Project Info",
      "Scope of Work",
      "Labor",
      "Job Conditions",
      "Materials",
      "Additional Charges",
      "Terms & Notes",
      "Review",
    ]);

    fireEvent.change(navigator, { target: { value: WIZARD_STEP_IDS.MATERIALS } });
    expect(onStepSelect).toHaveBeenCalledWith(WIZARD_STEP_IDS.MATERIALS);
  });

  test("the section navigator uses the existing Spanish step titles", () => {
    renderShell({ lang: "es" });
    const navigator = screen.getByRole("combobox", { name: "Ir a sección" });
    expect(navigator).toHaveDisplayValue("Secciones");
    expect(Array.from(navigator.options).map((option) => option.textContent)).toContain("Mano de obra");
  });





  test("inline step guidance is announced as an alert rather than a dialog", () => {
    renderShell({ stepError: "Pick a customer to continue." });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Pick a customer to continue.");
    expect(alert.closest(".pe-wizard-header")).not.toBeNull();
  });



  test("invoice mode uses the invoice step wording", () => {
    renderShell({ docType: "invoice", activeStep: STEPS[1], stepNumber: 2, isFirstStep: false });
    expect(screen.getByText("Invoice", { selector: ".pe-wizard-document-label" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Project / Invoice Info" })).toBeInTheDocument();
  });

  test("Spanish shell chrome translates the step counter", () => {
    renderShell({ lang: "es" });
    expect(screen.getByText("Estimado", { selector: ".pe-wizard-document-label" })).toBeInTheDocument();
    expect(screen.getByText("Paso 1 de 9")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Cliente" })).toBeInTheDocument();
  });

  test("the shell renders no action buttons of its own", () => {
    renderShell();
    // Every builder action now lives in the unified command bar.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  test("the shell does not own or render the command bar", () => {
    // The command bar now mounts as a sibling under the builder root so its
    // fixed positioning resolves against the viewport, not the animated subtree.
    renderShell({ commandBar: <div data-testid="command-bar" /> });
    expect(screen.queryByTestId("command-bar")).not.toBeInTheDocument();
    expect(document.querySelector(".pe-command-bar")).toBeNull();
  });
});

describe("BuilderWizardShell motion", () => {
  test("forward and backward movement are visually distinguishable", () => {
    const { unmount } = renderShell({ direction: "forward" });
    expect(document.querySelector(".pe-wizard-body-forward")).not.toBeNull();
    unmount();

    renderShell({ direction: "backward" });
    expect(document.querySelector(".pe-wizard-body-back")).not.toBeNull();
  });

  test("prefers-reduced-motion replaces the transition with a static body", () => {
    setMatchMedia(true);
    renderShell({ direction: "forward" });
    expect(document.querySelector(".pe-wizard-body-static")).not.toBeNull();
    expect(document.querySelector(".pe-wizard-body-forward")).toBeNull();
    expect(document.querySelector('[data-reduced-motion="1"]')).not.toBeNull();
  });

  test("a live preference change is honoured without a remount", () => {
    const media = setMatchMedia(false);
    renderShell({ direction: "forward" });
    expect(document.querySelector(".pe-wizard-body-forward")).not.toBeNull();

    // The media listener updates React state outside an event handler, so the
    // emit is wrapped to flush the resulting render before asserting.
    act(() => {
      media.emit(true);
    });

    expect(document.querySelector(".pe-wizard-body-static")).not.toBeNull();
  });

  test("environments without matchMedia still render", () => {
    delete window.matchMedia;
    renderShell();
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
  });
});

describe("BuilderReviewStep", () => {
  const sections = [
    { stepId: WIZARD_STEP_IDS.CUSTOMER, title: "Customer", rows: [{ label: "Customer", value: "Acme Roofing" }] },
    { stepId: WIZARD_STEP_IDS.LABOR, title: "Labor", rows: [{ label: "Base labor", value: "$400.00" }] },
    { stepId: WIZARD_STEP_IDS.CONDITIONS, title: "Job Conditions", rows: [{ label: "Hazard", value: "0%" }] },
  ];

  test("summarises the supplied document state verbatim", () => {
    render(<BuilderReviewStep lang="en" sections={sections} totalLabel="Estimate Total" totalValue="$400.00" />);
    expect(screen.getByText("Acme Roofing")).toBeInTheDocument();
    expect(screen.getByText("$400.00", { selector: ".pe-review-row-value" })).toBeInTheDocument();
    expect(screen.getByText("0%")).toBeInTheDocument();
  });

  test("shows the total it was given and performs no arithmetic of its own", () => {
    // A deliberately inconsistent total proves Review never recomputes.
    render(<BuilderReviewStep lang="en" sections={sections} totalLabel="Estimate Total" totalValue="$999.99" />);
    expect(screen.getByText("$999.99")).toBeInTheDocument();
  });

  test("each Edit action names its destination and reports the owning step", () => {
    const onEditStep = jest.fn();
    render(<BuilderReviewStep lang="en" sections={sections} onEditStep={onEditStep} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit — Labor" }));
    expect(onEditStep).toHaveBeenCalledWith(WIZARD_STEP_IDS.LABOR);

    fireEvent.click(screen.getByRole("button", { name: "Edit — Customer" }));
    expect(onEditStep).toHaveBeenCalledWith(WIZARD_STEP_IDS.CUSTOMER);
  });

  test("empty values read as not-added rather than blank", () => {
    render(<BuilderReviewStep lang="en" sections={[{ stepId: "terms", title: "Terms & Notes", rows: [{ label: "Terms", value: "" }] }]} />);
    expect(screen.getByText("Not added")).toBeInTheDocument();
  });

  test("Spanish review copy is translated", () => {
    render(<BuilderReviewStep lang="es" sections={[{ stepId: "terms", title: "Términos", rows: [{ label: "Términos", value: "" }] }]} />);
    expect(screen.getByText("Sin agregar")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar — Términos" })).toBeInTheDocument();
  });

  test("final actions supplied by the builder are rendered in Review", () => {
    render(<BuilderReviewStep lang="en" sections={sections} actions={<button type="button">Send to Customer</button>} />);
    expect(screen.getByRole("button", { name: "Send to Customer" })).toBeInTheDocument();
  });
});
