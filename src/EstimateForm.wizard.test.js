import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";

const mockPatch = jest.fn();
const mockSaveNow = jest.fn();
const mockClearAll = jest.fn();
const mockReplaceState = jest.fn();
const mockUseEstimatorState = jest.fn();
const mockUseAiAssist = jest.fn();

jest.mock("./estimator/useEstimatorState", () => ({
  __esModule: true,
  default: (...args) => mockUseEstimatorState(...args),
  useEstimatorState: (...args) => mockUseEstimatorState(...args),
}));

jest.mock("./estimator/aiAssist/useAiAssist", () => ({
  useAiAssist: (...args) => mockUseAiAssist(...args),
}));

jest.mock("./estimator/aiAssist/service", () => ({
  requestSectionAssist: jest.fn(),
}));

jest.mock("./estimator/guided/useGuidedBuild", () => ({
  __esModule: true,
  default: () => ({
    guided: {
      enabled: false,
      currentSection: "",
      currentQuestion: "",
      activeStepId: "",
      assistantMessage: "",
      completionAudit: { counts: {} },
      reviewReadiness: { score: 0 },
      unresolvedRequiredFields: [],
    },
    closeGuided: jest.fn(),
    submitAnswer: jest.fn(),
    selectChoice: jest.fn(),
    skipCurrent: jest.fn(),
    openReview: jest.fn(),
    jumpToSection: jest.fn(),
    confirmPending: jest.fn(),
    rejectPending: jest.fn(),
  }),
  buildCanonicalBlankDisplayState: () => null,
  hasCoreGuidedDraftState: () => true,
  hasGuidedRuntimeResidue: () => false,
}));

jest.mock("./components/estimator/InlineCustomNumberField", () => {
  return function MockInlineCustomNumberField({ value = "" }) {
    return <div data-testid="inline-custom-number-field">{String(value)}</div>;
  };
});

jest.mock("./components/estimator/SectionMaterials", () => {
  return function MockSectionMaterials() {
    return <div data-testid="section-materials" />;
  };
});

jest.mock("./utils/settings", () => {
  const settings = {
    pricing: { defaultMarkupPct: 12, lockMarkupToGlobal: false },
    internal: { showInternalCostFields: true, lockInternalCostFields: false },
    docDefaults: { defaultInternalNotesEstimate: "" },
  };
  return { DEFAULT_SETTINGS: settings, loadSettings: () => settings };
});

import EstimateForm from "./EstimateForm";
import { DEFAULT_STATE } from "./estimator/defaultState";
import { STORAGE_KEYS } from "./constants/storageKeys";
import { advanceToWizardStep } from "./testUtils/wizardTestNavigation";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildState(overrides = {}) {
  const state = clone(DEFAULT_STATE);
  state.customer = {
    ...state.customer,
    id: "cust_1",
    name: "Wizard Test Customer",
    phone: "555-0100",
    email: "wizard@example.com",
    address: "12 Job Site Way",
    projectName: "Wizard Test Project",
    projectSameAsCustomer: true,
  };
  state.job = { ...state.job, date: "2026-08-01" };
  state.scopeNotes = "Tear off and replace the lobby ceiling.";
  state.labor = {
    ...state.labor,
    hazardPct: 5,
    riskPct: 3,
    lines: [{ id: "l1", role: "carpenter", label: "Carpenter", hours: "8", rate: "70", qty: "1" }],
  };
  state.additionalNotes = "Net 30. Excludes permits.";
  return { ...state, ...overrides };
}

function buildParityFinancialState(docType = "estimate") {
  const state = buildState();
  state.ui = { ...state.ui, docType, materialsMode: "itemized" };
  state.labor = {
    ...state.labor,
    hazardPct: 0,
    riskPct: 0,
    multiplier: 1,
    lines: [{ id: "labor_parity", role: "carpenter", label: "Carpenter", qty: "1", hours: "2", rate: "100", markupPct: "0" }],
  };
  state.materials = {
    ...state.materials,
    items: [{ id: "material_parity", desc: "Parity material", qty: "2", priceEach: "50", unitCostInternal: "25", markupPct: "0" }],
  };
  state.additionalCharges = {
    items: [{ id: "charge_parity", desc: "Permit", qty: "1", priceEach: "25" }],
  };
  return state;
}

function idleAssist() {
  return {
    assistState: { phase: "idle", input: "", error: "", runtime: {} },
    open: jest.fn(),
    close: jest.fn(),
    submit: jest.fn(),
  };
}

function mountBuilder(state, props = {}) {
  mockUseEstimatorState.mockImplementation(() => ({
    state,
    patch: mockPatch,
    dupLaborLine: jest.fn(),
    removeLaborLine: jest.fn(),
    updateLaborLine: jest.fn(),
    clearAll: mockClearAll,
    saveNow: mockSaveNow,
    replaceState: mockReplaceState,
  }));
  return render(<EstimateForm {...props} />);
}

function setStateValue(state, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  let cursor = state;
  parts.slice(0, -1).forEach((part) => {
    if (!cursor[part] || typeof cursor[part] !== "object") cursor[part] = {};
    cursor = cursor[part];
  });
  cursor[parts[parts.length - 1]] = value;
}

function mountMutableBuilder(state, props = {}) {
  mockPatch.mockImplementation((path, value) => setStateValue(state, path, value));
  const view = mountBuilder(state, props);
  return {
    ...view,
    rerenderBuilder: () => view.rerender(<EstimateForm {...props} />),
  };
}

const mountedSteps = () => Array.from(document.querySelectorAll("[data-wizard-step]"))
  .map((node) => node.getAttribute("data-wizard-step"));

const clickNext = () => fireEvent.click(screen.getByRole("button", { name: /^(Next|Siguiente)$/ }));
const clickBack = () => fireEvent.click(screen.getByRole("button", { name: /^(Back|Atrás)$/ }));

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  mockUseAiAssist.mockImplementation(() => idleAssist());
});

describe("builder wizard initial presentation", () => {
  test("a new estimate opens on Customer as step 1 of 9", () => {
    mountBuilder(buildState());
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    expect(mountedSteps()).toEqual(["customer"]);
  });

  test("the builder is no longer one page containing every section at once", () => {
    mountBuilder(buildState());
    // Sections that used to share the page are absent until their step is active.
    expect(screen.queryByPlaceholderText("Job / Work Title (optional)")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Hours")).not.toBeInTheDocument();
    expect(screen.queryByTestId("section-materials")).not.toBeInTheDocument();
    expect(mountedSteps()).toHaveLength(1);
  });

  test("exactly one step stays mounted while moving through the wizard", () => {
    mountBuilder(buildState());
    for (let i = 0; i < 4; i += 1) {
      clickNext();
      expect(mountedSteps()).toHaveLength(1);
    }
  });

  test("each step renders exactly one primary visible title", () => {
    mountBuilder(buildState());

    // The wizard header owns the step title; the old inner section header must
    // not repeat it. Walk several steps to prove it holds beyond step one.
    [
      ["customer", "Customer"],
      ["project", "Project Info"],
      ["scope", "Scope of Work"],
      ["labor", "Labor"],
    ].forEach(([stepId, title]) => {
      advanceToWizardStep(stepId);
      expect(document.querySelectorAll(".pe-wizard-title")).toHaveLength(1);
      expect(screen.getByRole("heading", { level: 2, name: title })).toHaveClass("pe-wizard-title");
    });
  });

  test("the active step keeps one accessible heading", () => {
    mountBuilder(buildState());

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).toHaveTextContent("Customer");

    advanceToWizardStep("labor");
    const laborHeadings = screen.getAllByRole("heading", { level: 2 });
    expect(laborHeadings).toHaveLength(1);
    expect(laborHeadings[0]).toHaveTextContent("Labor");
    expect(screen.getByText("Crew plan", { selector: ".pe-task-kicker-label" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Crew plan" })).not.toBeInTheDocument();
  });

  test("an invoice opens on its first valid step with invoice wording", () => {
    const invoiceState = buildState();
    invoiceState.ui = { ...invoiceState.ui, docType: "invoice" };
    mountBuilder(invoiceState);

    expect(mountedSteps()).toEqual(["customer"]);
    clickNext();
    expect(screen.getByRole("heading", { level: 2, name: "Project / Invoice Info" })).toBeInTheDocument();
  });

  test("an existing saved estimate opens at Review", () => {
    const saved = { ...buildState(), id: "estimate_saved_1" };
    localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([saved]));
    localStorage.setItem("estipaid-edit-estimate-target-v1", saved.id);

    mountBuilder(buildState());

    expect(mountedSteps()).toEqual(["review"]);
    expect(screen.getByText("Step 9 of 9")).toBeInTheDocument();
  });

  test("an existing saved invoice opens at Review", () => {
    const saved = buildState();
    saved.id = "invoice_saved_1";
    saved.ui = { ...saved.ui, docType: "invoice" };
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([saved]));
    localStorage.setItem("estipaid-edit-invoice-target-v1", saved.id);

    mountBuilder(saved);

    expect(mountedSteps()).toEqual(["review"]);
    expect(screen.getByRole("heading", { level: 2, name: "Review" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Edit — Materials" }));
    expect(mountedSteps()).toEqual(["materials"]);
    expect(screen.getByRole("heading", { level: 2, name: "Materials" })).toBeInTheDocument();
  });

  test("saved-edit Review entry occurs once and does not override later navigation", () => {
    const saved = { ...buildState(), id: "estimate_saved_once" };
    localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([saved]));
    localStorage.setItem("estipaid-edit-estimate-target-v1", saved.id);

    mountBuilder(buildState());
    fireEvent.click(screen.getByRole("button", { name: "Edit — Labor" }));

    expect(mountedSteps()).toEqual(["labor"]);
    expect(screen.getByDisplayValue("8")).toBeInTheDocument();
  });
});

describe("optional invoice Scope of Work", () => {
  function buildInvoiceState({ includeOnPdf, scopeNotes = "" } = {}) {
    const state = buildState();
    state.scopeNotes = scopeNotes;
    state.scopeImages = [];
    state.tradeInsert = { key: "", text: "" };
    state.ui = { ...state.ui, docType: "invoice", materialsMode: "blanket" };
    if (typeof includeOnPdf === "boolean") state.ui.includeInvoiceScopeOnPdf = includeOnPdf;
    else delete state.ui.includeInvoiceScopeOnPdf;
    return state;
  }

  test("a new manual invoice always has the nine-step Scope flow and defaults PDF inclusion off", () => {
    mountBuilder(buildInvoiceState());

    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    const sectionValues = within(screen.getByRole("combobox", { name: "Jump to section" }))
      .getAllByRole("option")
      .map((option) => option.value)
      .filter(Boolean);
    expect(sectionValues.slice(0, 4)).toEqual(["customer", "project", "scope", "labor"]);

    advanceToWizardStep("scope");
    expect(mountedSteps()).toEqual(["scope"]);
    expect(screen.getByText("Step 3 of 9")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Include Scope of Work on PDF" })).not.toBeChecked();
  });

  test("PDF checkbox toggles without changing Scope content, Review, navigation, or step count", () => {
    const state = buildInvoiceState({ includeOnPdf: false, scopeNotes: "Retain this invoice scope." });
    state.scopeImages = [{ id: "scope-image-1", dataUrl: "data:image/jpeg;base64,scope" }];
    state.tradeInsert = { key: "painting", text: "Trade Insert: Painting" };
    const view = mountMutableBuilder(state);
    advanceToWizardStep("scope");

    fireEvent.click(screen.getByRole("checkbox", { name: "Include Scope of Work on PDF" }));
    view.rerenderBuilder();

    expect(state.ui.includeInvoiceScopeOnPdf).toBe(true);
    expect(mountedSteps()).toEqual(["scope"]);
    expect(screen.getByText("Step 3 of 9")).toBeInTheDocument();
    expect(state.scopeNotes).toBe("Retain this invoice scope.");
    expect(state.scopeImages).toHaveLength(1);
    expect(state.tradeInsert).toEqual({ key: "painting", text: "Trade Insert: Painting" });

    fireEvent.click(screen.getByRole("checkbox", { name: "Include Scope of Work on PDF" }));
    view.rerenderBuilder();
    expect(state.ui.includeInvoiceScopeOnPdf).toBe(false);
    expect(mountedSteps()).toEqual(["scope"]);
    expect(screen.getByText("Step 3 of 9")).toBeInTheDocument();
    expect(document.querySelector(".pe-scope-textarea")).toHaveTextContent("Retain this invoice scope.");

    advanceToWizardStep("review");
    const reviewScope = document.querySelector('[data-review-section="scope"]');
    expect(reviewScope).not.toBeNull();
    expect(within(reviewScope).getByText(/Retain this invoice scope/)).toBeInTheDocument();
  });

  test("Invoice Review always shows Scope and Edit always opens the shared step", () => {
    mountBuilder(buildInvoiceState({ includeOnPdf: false, scopeNotes: "Review-visible invoice scope" }));
    advanceToWizardStep("review");

    expect(document.querySelector('[data-review-section="scope"]')).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Edit — Scope of Work" }));
    expect(mountedSteps()).toEqual(["scope"]);
    expect(document.querySelector(".pe-scope-textarea")).toHaveTextContent("Review-visible invoice scope");
  });

  test("a legacy invoice with no PDF preference keeps Scope visible and defaults unchecked", () => {
    mountBuilder(buildInvoiceState({ scopeNotes: "Legacy invoice scope" }));
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    advanceToWizardStep("scope");
    expect(document.querySelector(".pe-scope-textarea")).toHaveTextContent("Legacy invoice scope");
    expect(screen.getByRole("checkbox", { name: "Include Scope of Work on PDF" })).not.toBeChecked();
  });

  test("Estimate keeps Scope without exposing the invoice-only control", () => {
    mountBuilder(buildState());
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    advanceToWizardStep("scope");
    expect(screen.getByRole("heading", { level: 2, name: "Scope of Work" })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Include Scope of Work on PDF" })).not.toBeInTheDocument();
  });

  test("the Invoice Scope control follows the existing Spanish language setting", () => {
    localStorage.setItem(STORAGE_KEYS.LANG, "es");
    mountBuilder(buildInvoiceState({ includeOnPdf: false }));
    advanceToWizardStep("scope");
    expect(screen.getByRole("checkbox", { name: "Incluir alcance del trabajo en el PDF" })).toBeInTheDocument();
  });
});

describe("builder wizard navigation preserves the single record", () => {
  test("Next then Back returns to Customer with hydrated values intact", () => {
    mountBuilder(buildState());
    expect(screen.getByDisplayValue("Wizard Test Customer")).toBeInTheDocument();

    clickNext();
    expect(mountedSteps()).toEqual(["project"]);

    clickBack();
    expect(mountedSteps()).toEqual(["customer"]);
    expect(screen.getByDisplayValue("Wizard Test Customer")).toBeInTheDocument();
  });

  test("moving between steps never saves, rehydrates, or clears the record", () => {
    mountBuilder(buildState());

    clickNext();
    clickNext();
    clickBack();
    clickNext();

    // Presentation-only: no second persistence path, no record reconstruction.
    expect(mockSaveNow).not.toHaveBeenCalled();
    expect(mockReplaceState).not.toHaveBeenCalled();
    expect(mockClearAll).not.toHaveBeenCalled();
  });

  test("representative values from later steps survive navigating away and back", () => {
    mountBuilder(buildState());

    advanceToWizardStep("project");
    expect(screen.getByDisplayValue("Wizard Test Project")).toBeInTheDocument();

    advanceToWizardStep("labor");
    expect(screen.getByDisplayValue("8")).toBeInTheDocument();

    clickBack();
    clickBack();
    expect(mountedSteps()).toEqual(["project"]);
    expect(screen.getByDisplayValue("Wizard Test Project")).toBeInTheDocument();
  });

  test("Scope text hydrates whenever its unmounted editor is revisited", () => {
    mountBuilder(buildState());

    advanceToWizardStep("scope");
    expect(document.querySelector(".pe-scope-textarea")).toHaveTextContent("Tear off and replace the lobby ceiling.");

    advanceToWizardStep("review");
    fireEvent.click(screen.getByRole("button", { name: "Edit — Scope of Work" }));
    expect(mountedSteps()).toEqual(["scope"]);
    expect(document.querySelector(".pe-scope-textarea")).toHaveTextContent("Tear off and replace the lobby ceiling.");
  });

  test("the section navigator jumps directly with current state intact", () => {
    mountBuilder(buildState());
    expect(screen.getByDisplayValue("Wizard Test Customer")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Jump to section" }), {
      target: { value: "terms" },
    });
    expect(mountedSteps()).toEqual(["terms"]);
    expect(screen.getByDisplayValue("Net 30. Excludes permits.")).toBeInTheDocument();

    fireEvent.change(screen.getByRole("combobox", { name: "Jump to section" }), {
      target: { value: "customer" },
    });
    expect(screen.getByDisplayValue("Wizard Test Customer")).toBeInTheDocument();
    expect(mockSaveNow).not.toHaveBeenCalled();
    expect(mockReplaceState).not.toHaveBeenCalled();
    expect(mockClearAll).not.toHaveBeenCalled();
  });

  test("invoice section navigation uses the same direct path for an applicable step", () => {
    mountBuilder(buildParityFinancialState("invoice"));

    fireEvent.change(screen.getByRole("combobox", { name: "Jump to section" }), {
      target: { value: "materials" },
    });

    expect(mountedSteps()).toEqual(["materials"]);
    expect(screen.getByRole("heading", { level: 2, name: "Materials" })).toBeInTheDocument();
    expect(mockSaveNow).not.toHaveBeenCalled();
    expect(mockReplaceState).not.toHaveBeenCalled();
  });

  test("optional steps with zero values do not block progression", () => {
    const zeroState = buildState();
    zeroState.labor = { ...zeroState.labor, hazardPct: 0, riskPct: 0, lines: [{ id: "l1", role: "", hours: "0", rate: "0", qty: "1" }] };
    zeroState.additionalCharges = { items: [] };
    mountBuilder(zeroState);

    advanceToWizardStep("review");
    expect(mountedSteps()).toEqual(["review"]);
  });
});

describe("builder wizard running total", () => {
  test("the existing total output stays visible on every step", () => {
    mountBuilder(buildState());
    const totalOnFirstStep = document.querySelector(".pe-total");
    expect(totalOnFirstStep).not.toBeNull();
    expect(screen.getByText("Estimate Total")).toBeInTheDocument();

    clickNext();
    clickNext();
    expect(document.querySelector(".pe-total")).not.toBeNull();
    expect(screen.getByText("Estimate Total")).toBeInTheDocument();
  });

  test("invoice mode shows the existing invoice total label", () => {
    const invoiceState = buildState();
    invoiceState.ui = { ...invoiceState.ui, docType: "invoice" };
    mountBuilder(invoiceState);
    expect(screen.getByText("Invoice Total")).toBeInTheDocument();
  });
});

describe("builder document finalization entry", () => {
  function stateMissingDate() {
    const state = buildState();
    state.job = { ...state.job, date: "" };
    return state;
  }

  test("Review & Save opens Preview without immediately invoking explicit save", () => {
    mountBuilder(stateMissingDate());

    fireEvent.click(screen.getByRole("button", { name: "Review & Save" }));

    expect(screen.getByRole("dialog", { name: "Review & Save Estimate" })).toBeInTheDocument();
    expect(screen.queryByText("Cannot save yet. Missing: Date.")).not.toBeInTheDocument();
    expect(mockClearAll).not.toHaveBeenCalled();
    expect(mockReplaceState).not.toHaveBeenCalled();
  });

  test("Save Estimate reaches the existing authoritative validation", async () => {
    mountBuilder(stateMissingDate());

    fireEvent.click(screen.getByRole("button", { name: "Review & Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Estimate" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot save yet. Missing: Date.");
    expect(screen.getByRole("heading", { name: "Review & Save Estimate" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Estimate Saved" })).not.toBeInTheDocument();
  });

  test("Review & Save works from a later step without advancing or recreating the record", () => {
    mountBuilder(stateMissingDate());
    advanceToWizardStep("labor");

    fireEvent.click(screen.getByRole("button", { name: "Review & Save" }));

    expect(screen.getByRole("dialog", { name: "Review & Save Estimate" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Labor" })).toBeInTheDocument();
    expect(mockClearAll).not.toHaveBeenCalled();
    expect(mockReplaceState).not.toHaveBeenCalled();
  });
});

describe("builder wizard Review", () => {
  test("Review is the final step and drops the Next control", () => {
    mountBuilder(buildState());
    advanceToWizardStep("review");

    expect(screen.getByText("Step 9 of 9")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Next$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Back$/ })).toBeInTheDocument();
  });

  test("Review summarises the current document state", () => {
    mountBuilder(buildState());
    advanceToWizardStep("review");

    const customerCard = document.querySelector('[data-review-section="customer"]');
    expect(within(customerCard).getByText("Wizard Test Customer")).toBeInTheDocument();
    expect(within(customerCard).getByText("wizard@example.com")).toBeInTheDocument();

    const projectCard = document.querySelector('[data-review-section="project"]');
    expect(within(projectCard).getByText("Wizard Test Project")).toBeInTheDocument();
    expect(within(projectCard).getByText("12 Job Site Way")).toBeInTheDocument();

    const scopeCard = document.querySelector('[data-review-section="scope"]');
    expect(within(scopeCard).getByText(/Tear off and replace the lobby ceiling/)).toBeInTheDocument();

    const conditionsCard = document.querySelector('[data-review-section="conditions"]');
    expect(within(conditionsCard).getByText("5%")).toBeInTheDocument();
    expect(within(conditionsCard).getByText("3%")).toBeInTheDocument();

    const termsCard = document.querySelector('[data-review-section="terms"]');
    expect(within(termsCard).getByText(/Net 30\. Excludes permits\./)).toBeInTheDocument();

    // Every wizard section is represented.
    ["labor", "materials", "charges"].forEach((stepId) => {
      expect(document.querySelector(`[data-review-section="${stepId}"]`)).not.toBeNull();
    });
  });

  test("Review Edit actions jump to the owning step and allow returning", () => {
    mountBuilder(buildState());
    advanceToWizardStep("review");

    fireEvent.click(screen.getByRole("button", { name: "Edit — Labor" }));
    expect(mountedSteps()).toEqual(["labor"]);

    advanceToWizardStep("review");
    fireEvent.click(screen.getByRole("button", { name: "Edit — Customer" }));
    expect(mountedSteps()).toEqual(["customer"]);
    expect(screen.getByDisplayValue("Wizard Test Customer")).toBeInTheDocument();

    // Editing did not disturb the record.
    expect(mockSaveNow).not.toHaveBeenCalled();
    expect(mockReplaceState).not.toHaveBeenCalled();
  });

  test("Review Edit actions share direct navigation across representative sections", () => {
    mountBuilder(buildState());
    advanceToWizardStep("review");

    [
      ["Edit — Scope of Work", "scope"],
      ["Edit — Materials", "materials"],
      ["Edit — Terms & Notes", "terms"],
    ].forEach(([label, stepId]) => {
      fireEvent.click(screen.getByRole("button", { name: label }));
      expect(mountedSteps()).toEqual([stepId]);
      fireEvent.change(screen.getByRole("combobox", { name: "Jump to section" }), {
        target: { value: "review" },
      });
    });
  });

  test("customer sharing lives in Review and is not duplicated in Terms & Notes", () => {
    mountBuilder(buildState());

    advanceToWizardStep("terms");
    expect(screen.queryByRole("button", { name: /send to customer/i })).not.toBeInTheDocument();

    advanceToWizardStep("review");
    expect(screen.getByRole("button", { name: /send to customer/i })).toBeInTheDocument();
  });
});

describe("unified builder command bar", () => {
  test("the natural-flow builder keeps its viewport command dock outside the estimator card", () => {
    mountBuilder(buildState());

    const frame = document.querySelector(".pe-builder-frame");
    const shell = frame.querySelector(".pe-wizard");
    const body = frame.querySelector(".pe-wizard-body");
    const commandBar = document.querySelector(".pe-command-bar");

    expect(frame).toHaveAttribute("data-builder-scroll", "page");
    expect(commandBar).toHaveAttribute("data-command-dock", "viewport");
    expect(Array.from(frame.children)).toEqual([shell]);
    expect(body.closest(".pe-wizard")).toBe(shell);
    expect(frame.querySelector(".pe-command-bar")).toBeNull();
    expect(commandBar.closest(".pe-wizard")).toBeNull();
    expect(commandBar.closest(".pe-estimator-shell")).toBeNull();
    expect(commandBar).not.toHaveAttribute("style");
  });

  test("the builder exposes command clearance without a measured frame height", () => {
    mountBuilder(buildState());
    const builderRoot = document.querySelector(".pe-wrap.ep-estimator");
    expect(builderRoot.style.getPropertyValue("--pe-builder-frame-height")).toBe("");
    expect(builderRoot.style.getPropertyValue("--pe-builder-command-bottom")).toContain("env(safe-area-inset-bottom");
    expect(builderRoot.style.getPropertyValue("--pe-builder-command-hide-distance")).toContain("env(safe-area-inset-bottom");
  });

  test("the command dock consumes the app shell's existing chrome visibility", () => {
    const view = mountBuilder(buildState(), { shellBottomChromeVisible: false });
    const dock = document.querySelector(".pe-command-bar");
    expect(dock).toHaveClass("is-shell-hidden");
    expect(dock).toHaveAttribute("data-shell-chrome-visible", "false");

    view.rerender(<EstimateForm shellBottomChromeVisible />);
    expect(dock).toHaveClass("is-shell-visible");
    expect(dock).toHaveAttribute("data-shell-chrome-visible", "true");
  });

  test("invoice dock consumes the same app shell chrome signal", () => {
    const view = mountBuilder(buildParityFinancialState("invoice"), { shellBottomChromeVisible: false });
    const dock = document.querySelector(".pe-command-bar");
    expect(dock).toHaveClass("is-shell-hidden");
    expect(dock).toHaveAttribute("data-shell-chrome-visible", "false");

    view.rerender(<EstimateForm shellBottomChromeVisible />);
    expect(dock).toHaveClass("is-shell-visible");
    expect(dock).toHaveAttribute("data-shell-chrome-visible", "true");
  });

  test("exactly one command region renders and the old surfaces are gone", () => {
    mountBuilder(buildState());

    expect(document.querySelectorAll(".pe-command-bar")).toHaveLength(1);
    // Former separate wizard-navigation footer.
    expect(document.querySelector(".pe-wizard-nav")).toBeNull();
    // Former independent Save/Clear/Export document-action bar.
    expect(document.querySelector(".pe-estimator-sticky-actions")).toBeNull();
  });

  test("every builder action lives in the one region without duplication", () => {
    mountBuilder(buildState());
    const region = screen.getByRole("group", { name: "Builder actions" });

    ["Review & Save", "Clear", "Next"].forEach((name) => {
      expect(within(region).getByRole("button", { name })).toBeInTheDocument();
      expect(screen.getAllByRole("button", { name })).toHaveLength(1);
    });
    expect(document.querySelector(".pe-command-next-label")).toHaveTextContent("Next");
  });

  test("working steps no longer open with a large total block", () => {
    mountBuilder(buildState());

    // The only remaining .pe-total is the compact one inside the command bar.
    const totals = document.querySelectorAll(".pe-total");
    expect(totals).toHaveLength(1);
    expect(totals[0].closest(".pe-command-bar")).not.toBeNull();
  });

  test("the compact total shows the builder's existing calculated output", () => {
    mountBuilder(buildState());
    const total = document.querySelector(".pe-command-bar .pe-total");
    expect(within(total).getByText("Estimate Total")).toBeInTheDocument();
    expect(total.textContent).toMatch(/\$/);
  });

  test("estimate dock renders authoritative context and financial values", () => {
    mountBuilder(buildParityFinancialState("estimate"));
    const context = document.querySelector(".pe-command-context");
    const financials = screen.getByLabelText("Live financial summary");
    const total = document.querySelector(".pe-command-bar .pe-total");

    expect(within(context).getByText("Estimate")).toBeInTheDocument();
    expect(within(context).getByText("Wizard Test Customer")).toBeInTheDocument();
    expect(within(context).getByText("Wizard Test Project")).toBeInTheDocument();
    expect(within(context).queryByText("Not saved yet")).not.toBeInTheDocument();
    expect(within(financials).getByText("Labor")).toBeInTheDocument();
    expect(within(financials).getByText("$200.00")).toBeInTheDocument();
    expect(within(financials).getByText("Materials")).toBeInTheDocument();
    expect(within(financials).getByText("$100.00")).toBeInTheDocument();
    expect(within(financials).getByText("Charges")).toBeInTheDocument();
    expect(within(financials).getByText("$25.00")).toBeInTheDocument();
    expect(within(total).getByText("$325.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Estimate" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
  });

  test("invoice mode swaps the document label through the same component", () => {
    mountBuilder(buildParityFinancialState("invoice"));

    expect(document.querySelectorAll(".pe-command-bar")).toHaveLength(1);
    const context = document.querySelector(".pe-command-context");
    const financials = screen.getByLabelText("Live financial summary");
    const total = document.querySelector(".pe-command-bar .pe-total");
    expect(within(context).getByText("Invoice")).toBeInTheDocument();
    expect(within(context).getByText("Wizard Test Customer")).toBeInTheDocument();
    expect(within(context).getByText("Wizard Test Project")).toBeInTheDocument();
    expect(within(context).queryByText("Not saved yet")).not.toBeInTheDocument();
    expect(within(financials).getByText("$200.00")).toBeInTheDocument();
    expect(within(financials).getByText("$100.00")).toBeInTheDocument();
    expect(within(financials).getByText("$25.00")).toBeInTheDocument();
    expect(within(total).getByText("$325.00")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Review & Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Invoice" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Estimate" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next" })).toBeInTheDocument();
    expect(screen.getByText("Invoice Total")).toBeInTheDocument();
    expect(document.querySelector(".pe-builder-frame")).toHaveAttribute("data-builder-scroll", "page");
  });

  test("Review drops Next and the compact total while keeping its own total", () => {
    mountBuilder(buildState());
    advanceToWizardStep("review");

    expect(screen.queryByRole("button", { name: /^Next$/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Back$/ })).toBeInTheDocument();
    // No compact duplicate next to Review's own total presentation.
    expect(document.querySelector(".pe-command-bar .pe-total")).toBeNull();
    expect(document.querySelector(".pe-review-total")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Review & Save" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export PDF" })).not.toBeInTheDocument();
  });

  test("Invoice Review suppresses the compact dock summary without duplicating its total", () => {
    mountBuilder(buildParityFinancialState("invoice"));
    advanceToWizardStep("review");

    expect(screen.queryByRole("button", { name: /^Next$/ })).not.toBeInTheDocument();
    expect(document.querySelector(".pe-command-summary")).toBeNull();
    expect(document.querySelector(".pe-command-bar .pe-total")).toBeNull();
    expect(document.querySelector(".pe-review-total")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Review & Save" })).toBeInTheDocument();
  });

  test("Save Estimate reaches the existing save path", async () => {
    const state = buildState();
    state.job = { ...state.job, date: "" };
    mountBuilder(state);

    fireEvent.click(screen.getByRole("button", { name: "Review & Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Save Estimate" }));

    // Same guard outcome the existing handler produces -- not a new save path.
    expect(await screen.findByRole("alert")).toHaveTextContent("Cannot save yet. Missing: Date.");
    expect(mockReplaceState).not.toHaveBeenCalled();
  });

  test("command-bar navigation does not save, rehydrate or clear the record", () => {
    mountBuilder(buildState());

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: /^Back$/ }));

    expect(mockSaveNow).not.toHaveBeenCalled();
    expect(mockReplaceState).not.toHaveBeenCalled();
    expect(mockClearAll).not.toHaveBeenCalled();
  });
});

describe("builder wizard bilingual chrome", () => {
  test("Spanish renders translated step names and navigation", () => {
    localStorage.setItem(STORAGE_KEYS.LANG, "es");
    mountBuilder(buildState());

    expect(screen.getByText("Paso 1 de 9")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revisar y guardar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeInTheDocument();
    expect(document.querySelector(".pe-command-next-label")).toHaveTextContent("Siguiente");
    expect(screen.getByRole("combobox", { name: "Ir a sección" })).toHaveDisplayValue("Secciones");

    fireEvent.click(screen.getByRole("button", { name: "Revisar y guardar" }));
    expect(screen.getByRole("dialog", { name: "Revisar y guardar estimado" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Descargar vista previa" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Volver a editar" }));
  });

  test("Spanish never rewrites customer-entered content", () => {
    localStorage.setItem(STORAGE_KEYS.LANG, "es");
    mountBuilder(buildState());

    // Saved content stays exactly as the contractor typed it.
    expect(screen.getByDisplayValue("Wizard Test Customer")).toBeInTheDocument();
  });

  test("Spanish invoice uses the shared localized command dock", () => {
    localStorage.setItem(STORAGE_KEYS.LANG, "es");
    mountBuilder(buildParityFinancialState("invoice"));

    const context = document.querySelector(".pe-command-context");
    const financials = screen.getByLabelText("Resumen financiero en vivo");
    expect(within(context).getByText("Factura")).toBeInTheDocument();
    expect(within(financials).getByText("Mano de obra")).toBeInTheDocument();
    expect(within(financials).getByText("Materiales")).toBeInTheDocument();
    expect(within(financials).getByText("Cargos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revisar y guardar" })).toBeInTheDocument();
    expect(screen.getByText("Total de la factura")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revisar y guardar" }));
    expect(screen.getByRole("dialog", { name: "Revisar y guardar factura" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ver PDF" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Aprobar y guardar" })).toBeInTheDocument();
  });
});

describe("builder disclosure defaults", () => {
  test("Scope loads open and a user collapse is not immediately overridden", () => {
    mountBuilder(buildState());
    advanceToWizardStep("scope");

    const scopeCollapse = document.querySelector(".pe-workspace-scope .pe-collapse");
    expect(scopeCollapse).toHaveClass("pe-open");
    fireEvent.click(screen.getByTitle("Collapse notes"));
    expect(scopeCollapse).not.toHaveClass("pe-open");
    expect(screen.getByTitle("Expand notes")).toBeInTheDocument();
  });

  test("Labor loads open and remains manually collapsible", () => {
    mountBuilder(buildState());
    advanceToWizardStep("labor");

    const laborCollapse = document.querySelector(".pe-workspace-labor .pe-collapse");
    expect(laborCollapse).toHaveClass("pe-open");
    fireEvent.click(screen.getByTitle("Collapse"));
    expect(laborCollapse).not.toHaveClass("pe-open");
    expect(screen.getByTitle("Expand")).toBeInTheDocument();
  });

  test("Invoice Labor uses the same default-open, manually collapsible disclosure", () => {
    mountBuilder(buildParityFinancialState("invoice"));
    advanceToWizardStep("labor");

    const laborCollapse = document.querySelector(".pe-workspace-labor .pe-collapse");
    expect(laborCollapse).toHaveClass("pe-open");
    fireEvent.click(screen.getByTitle("Collapse"));
    expect(laborCollapse).not.toHaveClass("pe-open");
    expect(screen.getByTitle("Expand")).toBeInTheDocument();
  });

  test("saved Review to Job Conditions opens the existing disclosure", () => {
    const saved = { ...buildState(), id: "estimate_conditions_open" };
    localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([saved]));
    localStorage.setItem("estipaid-edit-estimate-target-v1", saved.id);
    mountBuilder(buildState());

    fireEvent.click(screen.getByRole("button", { name: "Edit — Job Conditions" }));
    const conditionsCollapse = document.querySelector(".pe-workspace-conditions .pe-collapse");
    expect(conditionsCollapse).toHaveClass("pe-open");
    fireEvent.click(screen.getByTitle("Collapse job conditions"));
    expect(conditionsCollapse).not.toHaveClass("pe-open");
    expect(screen.getByTitle("Expand job conditions")).toBeInTheDocument();
  });
});

describe("builder wizard completion progress", () => {
  const percentText = () => document.querySelector(".pe-wizard-percentage")?.textContent;

  test("a fresh estimate reports 0% completed on Step 1", () => {
    mountBuilder(buildState());
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    // Merely arriving on Step 1 has completed nothing.
    expect(percentText()).toBe("0%");
  });

  test("a fresh invoice reports 0% completed on Step 1", () => {
    const invoiceState = buildState();
    invoiceState.ui = { ...invoiceState.ui, docType: "invoice" };
    mountBuilder(invoiceState);
    expect(screen.getByText("Step 1 of 9")).toBeInTheDocument();
    expect(percentText()).toBe("0%");
  });

  test("progress only advances once Step 1 is actually left behind", () => {
    mountBuilder(buildState());
    expect(percentText()).toBe("0%");

    clickNext();
    expect(mountedSteps()).toEqual(["project"]);
    // One of nine steps completed.
    expect(percentText()).toBe("11%");
  });
});

describe("builder in-place language control", () => {
  test("switching EN to ES updates builder copy without resetting the record", () => {
    mountBuilder(buildState());

    // Starts in English with the record hydrated.
    expect(screen.getByRole("heading", { level: 2, name: "Customer" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("Wizard Test Customer")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "ES" }));

    // Chrome and section copy follow the global preference immediately.
    expect(screen.getByRole("heading", { level: 2, name: "Cliente" })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.LANG)).toBe("es");

    // The single record survived the switch untouched: no save, clear, or
    // rehydrate was triggered, and the customer value is still present.
    expect(screen.getByDisplayValue("Wizard Test Customer")).toBeInTheDocument();
    expect(mockClearAll).not.toHaveBeenCalled();
    expect(mockSaveNow).not.toHaveBeenCalled();
    expect(mockReplaceState).not.toHaveBeenCalled();

    // And it toggles back.
    fireEvent.click(screen.getByRole("button", { name: "EN" }));
    expect(screen.getByRole("heading", { level: 2, name: "Customer" })).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEYS.LANG)).toBe("en");
  });

  test("the builder honours an existing Spanish preference on mount", () => {
    localStorage.setItem(STORAGE_KEYS.LANG, "es");
    mountBuilder(buildState());
    expect(screen.getByRole("heading", { level: 2, name: "Cliente" })).toBeInTheDocument();
    // The ES control reflects the active language.
    expect(screen.getByRole("button", { name: "ES" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "EN" })).toHaveAttribute("aria-pressed", "false");
  });
});
