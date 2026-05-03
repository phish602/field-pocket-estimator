import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockPatch = jest.fn();
const mockUseEstimatorState = jest.fn();
const mockUseAiAssist = jest.fn();
const mockCloseLaborAssist = jest.fn();
const mockSubmitLaborAssist = jest.fn();
const mockOpenLaborAssist = jest.fn();
const mockCloseMaterialsAssist = jest.fn();
const mockSubmitMaterialsAssist = jest.fn();
const mockOpenMaterialsAssist = jest.fn();
const EXPECTED_DEFAULT_MARKUP_PCT = "12";
const mockRequestSectionAssist = jest.fn();

jest.mock("./estimator/useEstimatorState", () => ({
  __esModule: true,
  default: (...args) => mockUseEstimatorState(...args),
  useEstimatorState: (...args) => mockUseEstimatorState(...args),
}));

jest.mock("./estimator/aiAssist/useAiAssist", () => ({
  useAiAssist: (...args) => mockUseAiAssist(...args),
}));

jest.mock("./estimator/aiAssist/service", () => ({
  requestSectionAssist: (...args) => mockRequestSectionAssist(...args),
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

jest.mock("./components/estimator/PdfPromptModal", () => {
  return function MockPdfPromptModal() {
    return null;
  };
});

jest.mock("./components/estimator/SectionMaterials", () => {
  return function MockSectionMaterials() {
    return <div data-testid="section-materials" />;
  };
});

jest.mock("./utils/settings", () => {
  const settings = {
    pricing: {
      defaultMarkupPct: 12,
      lockMarkupToGlobal: false,
    },
    internal: {
      showInternalCostFields: true,
      lockInternalCostFields: false,
    },
    docDefaults: {
      defaultInternalNotesEstimate: "",
    },
  };
  return {
    DEFAULT_SETTINGS: settings,
    loadSettings: () => settings,
  };
});

import EstimateForm from "./EstimateForm";
import { DEFAULT_STATE } from "./estimator/defaultState";
import { STORAGE_KEYS } from "./constants/storageKeys";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createBlankStarterLine() {
  return {
    id: "l1",
    role: "",
    label: "",
    hours: "",
    rate: "",
    trueRateInternal: "",
    internalRate: "",
    qty: "1",
    markupPct: EXPECTED_DEFAULT_MARKUP_PCT,
  };
}

function createManualLaborLine(overrides = {}) {
  return {
    id: "manual_1",
    role: "foreman",
    label: "Foreman",
    hours: "8",
    rate: "62",
    trueRateInternal: "38",
    internalRate: "38",
    qty: "2",
    markupPct: "25",
    ...overrides,
  };
}

function createState({ laborLines = [createBlankStarterLine()] } = {}) {
  const state = clone(DEFAULT_STATE);
  state.ui = { ...state.ui, docType: "estimate", materialsMode: "itemized" };
  state.customer = {
    ...state.customer,
    id: "cust_1",
    name: "Acme Facilities",
    address: "123 Main St",
    projectSameAsCustomer: true,
  };
  state.job = { ...state.job, docNumber: "EST-1001", location: "" };
  state.tradeInsert = { key: "painting", text: "Painting" };
  state.scopeNotes = "Paint two offices and touch up trim.";
  state.additionalNotes = "";
  state.labor = {
    ...state.labor,
    hazardPct: 0,
    riskPct: 0,
    multiplier: 1,
    lines: laborLines,
  };
  state.materials = {
    ...state.materials,
    blanketCost: "",
    blanketInternalCost: "",
    materialsBlanketDescription: "",
    markupPct: 0,
    items: [{ id: "m1", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" }],
  };
  return state;
}

function createAssistState(writes) {
  return {
    phase: "review",
    input: "",
    result: { writes },
  };
}

function buildLaborAssistReturn(writes) {
  return {
    assistState: createAssistState(writes),
    open: mockOpenLaborAssist,
    close: mockCloseLaborAssist,
    submit: mockSubmitLaborAssist,
  };
}

function buildIdleAssistReturn({ open, close, submit } = {}) {
  return {
    assistState: { phase: "idle" },
    open: open || jest.fn(),
    close: close || jest.fn(),
    submit: submit || jest.fn(),
  };
}

function setup({ state, laborWrites }) {
  mockRequestSectionAssist.mockResolvedValue({
    writes: { scopeNotes: "Replace existing ceiling tiles and dispose of debris." },
    validation: { valid: true },
  });

  mockUseEstimatorState.mockImplementation(() => ({
    state,
    patch: mockPatch,
    dupLaborLine: jest.fn(),
    removeLaborLine: jest.fn(),
    updateLaborLine: jest.fn(),
    clearAll: jest.fn(),
    saveNow: jest.fn(),
    replaceState: jest.fn(),
  }));

  mockUseAiAssist.mockImplementation((sectionKey) => {
    if (sectionKey === "labor") return buildLaborAssistReturn(laborWrites);
    if (sectionKey === "materials") {
      return buildIdleAssistReturn({
        open: mockOpenMaterialsAssist,
        close: mockCloseMaterialsAssist,
        submit: mockSubmitMaterialsAssist,
      });
    }
    return buildIdleAssistReturn();
  });

  const view = render(<EstimateForm />);
  mockPatch.mockClear();
  return view;
}

function setupManualLaborEditor({ state, updateLaborLine = jest.fn() }) {
  mockRequestSectionAssist.mockResolvedValue({
    writes: { scopeNotes: "Replace existing ceiling tiles and dispose of debris." },
    validation: { valid: true },
  });

  mockUseEstimatorState.mockImplementation(() => ({
    state,
    patch: mockPatch,
    dupLaborLine: jest.fn(),
    removeLaborLine: jest.fn(),
    updateLaborLine,
    clearAll: jest.fn(),
    saveNow: jest.fn(),
    replaceState: jest.fn(),
  }));

  mockUseAiAssist.mockImplementation((sectionKey) => {
    if (sectionKey === "labor") {
      return buildIdleAssistReturn({
        open: mockOpenLaborAssist,
        close: mockCloseLaborAssist,
        submit: mockSubmitLaborAssist,
      });
    }
    if (sectionKey === "materials") {
      return buildIdleAssistReturn({
        open: mockOpenMaterialsAssist,
        close: mockCloseMaterialsAssist,
        submit: mockSubmitMaterialsAssist,
      });
    }
    return buildIdleAssistReturn();
  });

  const view = render(<EstimateForm />);
  mockPatch.mockClear();
  return { ...view, updateLaborLine };
}

function getLaborRoleSelects() {
  return screen.getAllByTitle(/role/i);
}

function getSelectOptionLabels(select) {
  return Array.from(select.querySelectorAll("option")).map((option) => String(option.textContent || ""));
}

function getOptionValueByLabel(select, matcher) {
  return Array.from(select.querySelectorAll("option")).find((option) => matcher.test(String(option.textContent || "")))?.value || "";
}

function getLaborLinesPatchArg() {
  const laborCalls = mockPatch.mock.calls.filter(([path]) => path === "labor.lines");
  return laborCalls[laborCalls.length - 1]?.[1];
}

describe("EstimateForm labor AI assist writeback", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test("sends labor-from-scope requests through laborAssist.submit with the from_scope discriminator", () => {
    const state = createState({ laborLines: [createBlankStarterLine()] });

    mockUseEstimatorState.mockImplementation(() => ({
      state,
      patch: mockPatch,
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine: jest.fn(),
      clearAll: jest.fn(),
      saveNow: jest.fn(),
      replaceState: jest.fn(),
    }));

    mockUseAiAssist.mockImplementation((sectionKey) => {
      if (sectionKey === "labor") {
        return buildIdleAssistReturn({
          open: mockOpenLaborAssist,
          close: mockCloseLaborAssist,
          submit: mockSubmitLaborAssist,
        });
      }
      if (sectionKey === "materials") {
        return buildIdleAssistReturn({
          open: mockOpenMaterialsAssist,
          close: mockCloseMaterialsAssist,
          submit: mockSubmitMaterialsAssist,
        });
      }
      return buildIdleAssistReturn();
    });

    render(<EstimateForm />);
    mockPatch.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /suggest labor from scope/i }));

    expect(mockSubmitLaborAssist).toHaveBeenCalledTimes(1);
    expect(mockSubmitLaborAssist).toHaveBeenCalledWith("", { laborRequestMode: "from_scope" });
    expect(mockPatch).not.toHaveBeenCalled();
  });

  test("replaces the lone blank starter row when Append Lines is accepted", () => {
    setup({
      state: createState({ laborLines: [createBlankStarterLine()] }),
      laborWrites: {
        laborLines: [
          { id: "ai_1", role: "journeyman", label: "Journeyman", hours: "4.5", rate: "85" },
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /append lines/i }));

    const nextLines = getLaborLinesPatchArg();
    expect(nextLines).toHaveLength(1);
    expect(nextLines[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^labor_ai_/),
        role: "journeyman",
        label: "Journeyman",
        hours: "4.5",
        rate: "85",
        qty: "1",
        markupPct: EXPECTED_DEFAULT_MARKUP_PCT,
        trueRateInternal: "0",
        internalRate: "0",
      })
    );
    expect(mockCloseLaborAssist).toHaveBeenCalledTimes(1);
  });

  test("appends normalized AI labor rows after existing meaningful manual rows", () => {
    const manualLine = createManualLaborLine();

    setup({
      state: createState({ laborLines: [manualLine] }),
      laborWrites: {
        laborLines: [
          { id: "ai_2", role: "helper", label: "Helper", hours: "6", rate: "40" },
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /append lines/i }));

    const nextLines = getLaborLinesPatchArg();
    expect(nextLines).toHaveLength(2);
    expect(nextLines[0]).toMatchObject(manualLine);
    expect(nextLines[1]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^labor_ai_/),
        role: "helper",
        label: "Helper",
        hours: "6",
        rate: "40",
        qty: "1",
        markupPct: EXPECTED_DEFAULT_MARKUP_PCT,
        trueRateInternal: "0",
        internalRate: "0",
      })
    );
  });

  test("preserves specialized free-form labor labels through accept writeback", () => {
    setup({
      state: createState({ laborLines: [createBlankStarterLine()] }),
      laborWrites: {
        laborLines: [
          {
            id: "ai_pool_1",
            role: "",
            label: "Pool Maintenance Technician",
            hours: "7",
            rate: "95",
            qty: "1",
          },
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /append lines/i }));

    const nextLines = getLaborLinesPatchArg();
    expect(nextLines).toHaveLength(1);
    expect(nextLines[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^labor_ai_/),
        role: "",
        label: "Pool Maintenance Technician",
        hours: "7",
        rate: "95",
        qty: "1",
        markupPct: EXPECTED_DEFAULT_MARKUP_PCT,
        trueRateInternal: "0",
        internalRate: "0",
      })
    );
  });

  test("replaces existing manual labor rows only when Replace Existing is chosen", () => {
    const manualLine = createManualLaborLine();

    setup({
      state: createState({ laborLines: [manualLine] }),
      laborWrites: {
        laborLines: [
          { id: "ai_3", role: "technician", label: "Technician", hours: "3", rate: "95" },
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /replace existing/i }));

    const nextLines = getLaborLinesPatchArg();
    expect(nextLines).toHaveLength(1);
    expect(nextLines[0]).toEqual(
      expect.objectContaining({
        id: expect.stringMatching(/^labor_ai_/),
        role: "technician",
        label: "Technician",
        hours: "3",
        rate: "95",
        qty: "1",
        markupPct: EXPECTED_DEFAULT_MARKUP_PCT,
        trueRateInternal: "0",
        internalRate: "0",
      })
    );
    expect(nextLines.some((line) => line.id === manualLine.id)).toBe(false);
  });

  test("blocks malformed accepted AI labor rows before writeback", () => {
    setup({
      state: createState({ laborLines: [createManualLaborLine()] }),
      laborWrites: {
        laborLines: [
          { id: "bad_1", role: "helper", label: "", hours: "", rate: "" },
        ],
      },
    });

    fireEvent.click(screen.getByRole("button", { name: /append lines/i }));

    expect(mockPatch.mock.calls.filter(([path]) => path === "labor.lines")).toHaveLength(0);
    expect(mockCloseLaborAssist).not.toHaveBeenCalled();
  });

  test("falls back cleanly when custom labor role storage is malformed", () => {
    localStorage.setItem(STORAGE_KEYS.CUSTOM_LABOR_ROLES, "{");

    setupManualLaborEditor({ state: createState({ laborLines: [createBlankStarterLine()] }) });

    const labels = getSelectOptionLabels(getLaborRoleSelects()[0]);
    expect(labels).toContain("Foreman");
    expect(labels[labels.length - 1]).toMatch(/create new role/i);
    expect(labels).not.toContain("Pool Maintenance Technician");
  });

  test("dedupes saved custom labor roles by normalized label and keeps them after built-ins", () => {
    localStorage.setItem(
      STORAGE_KEYS.CUSTOM_LABOR_ROLES,
      JSON.stringify([
        "Pool Maintenance Technician",
        { label: " pool   maintenance technician " },
        "",
        { label: " " },
        "Foreman",
      ])
    );

    setupManualLaborEditor({ state: createState({ laborLines: [createBlankStarterLine()] }) });

    const labels = getSelectOptionLabels(getLaborRoleSelects()[0]);
    expect(labels.filter((label) => label === "Pool Maintenance Technician")).toHaveLength(1);
    expect(labels.filter((label) => label === "Foreman")).toHaveLength(1);
    expect(labels.indexOf("Equipment Operator")).toBeLessThan(labels.indexOf("Pool Maintenance Technician"));
    expect(labels[labels.length - 1]).toMatch(/create new role/i);
  });

  test("creates a custom labor role from the dropdown and makes it available to other rows", async () => {
    const blankLine = createBlankStarterLine();
    const manualLine = createManualLaborLine({ id: "manual_2", role: "helper", label: "Helper" });
    const updateLaborLine = jest.fn();
    const promptSpy = jest.spyOn(window, "prompt").mockReturnValue("Pool Maintenance Technician");

    try {
      setupManualLaborEditor({
        state: createState({ laborLines: [blankLine, manualLine] }),
        updateLaborLine,
      });

      const [firstRoleSelect] = getLaborRoleSelects();
      fireEvent.change(firstRoleSelect, {
        target: { value: getOptionValueByLabel(firstRoleSelect, /create new role/i) },
      });

      expect(updateLaborLine).toHaveBeenCalledWith(blankLine.id, {
        label: "Pool Maintenance Technician",
        role: "",
      });
      expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_LABOR_ROLES))).toEqual([
        "Pool Maintenance Technician",
      ]);

      await waitFor(() => {
        expect(getSelectOptionLabels(getLaborRoleSelects()[1])).toContain("Pool Maintenance Technician");
      });
    } finally {
      promptSpy.mockRestore();
    }
  });

  test("applies saved custom labor roles without overwriting pricing fields", () => {
    localStorage.setItem(
      STORAGE_KEYS.CUSTOM_LABOR_ROLES,
      JSON.stringify(["Pool Maintenance Technician"])
    );

    const manualLine = createManualLaborLine({
      id: "manual_custom_1",
      role: "",
      label: "",
      hours: "8",
      rate: "62",
      trueRateInternal: "38",
      internalRate: "38",
      qty: "2",
      markupPct: "25",
    });
    const updateLaborLine = jest.fn();

    setupManualLaborEditor({
      state: createState({ laborLines: [manualLine] }),
      updateLaborLine,
    });

    fireEvent.change(getLaborRoleSelects()[0], {
      target: { value: "Pool Maintenance Technician" },
    });

    expect(updateLaborLine).toHaveBeenCalledTimes(1);
    expect(updateLaborLine).toHaveBeenCalledWith(manualLine.id, {
      label: "Pool Maintenance Technician",
      role: "",
    });
  });

  test("keeps built-in labor preset selection behavior unchanged", () => {
    const manualLine = createManualLaborLine({
      id: "manual_builtin_1",
      role: "",
      label: "",
    });
    const updateLaborLine = jest.fn();

    setupManualLaborEditor({
      state: createState({ laborLines: [manualLine] }),
      updateLaborLine,
    });

    fireEvent.change(getLaborRoleSelects()[0], {
      target: { value: "Foreman" },
    });

    expect(updateLaborLine).toHaveBeenCalledWith(manualLine.id, {
      label: "Foreman",
      role: "foreman",
    });
  });

  test("keeps row-specific legacy labor labels local until explicitly saved", () => {
    const legacyLine = createManualLaborLine({
      id: "legacy_row_1",
      role: "",
      label: "Pool Maintenance Technician",
    });
    const manualLine = createManualLaborLine({ id: "manual_2", role: "helper", label: "Helper" });

    setupManualLaborEditor({
      state: createState({ laborLines: [legacyLine, manualLine] }),
    });

    const [legacySelect, otherSelect] = getLaborRoleSelects();
    const legacyLabels = getSelectOptionLabels(legacySelect);
    const otherLabels = getSelectOptionLabels(otherSelect);

    expect(legacyLabels[1]).toBe("Pool Maintenance Technician");
    expect(otherLabels).not.toContain("Pool Maintenance Technician");
    expect(localStorage.getItem(STORAGE_KEYS.CUSTOM_LABOR_ROLES)).toBeNull();
  });

  test("blocks explicit scaffold scope output before review", async () => {
    const state = createState({ laborLines: [createBlankStarterLine()] });
    mockRequestSectionAssist.mockResolvedValue({
      writes: {
        scopeNotes: "Complete the described scope and clean up the work area.",
      },
      validation: { valid: true },
    });

    mockUseEstimatorState.mockImplementation(() => ({
      state,
      patch: mockPatch,
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine: jest.fn(),
      clearAll: jest.fn(),
      saveNow: jest.fn(),
      replaceState: jest.fn(),
    }));

    mockUseAiAssist.mockImplementation((sectionKey) => {
      if (sectionKey === "labor") {
        return buildIdleAssistReturn({
          open: mockOpenLaborAssist,
          close: mockCloseLaborAssist,
          submit: mockSubmitLaborAssist,
        });
      }
      if (sectionKey === "materials") {
        return buildIdleAssistReturn({
          open: mockOpenMaterialsAssist,
          close: mockCloseMaterialsAssist,
          submit: mockSubmitMaterialsAssist,
        });
      }
      return buildIdleAssistReturn();
    });

    render(<EstimateForm />);
    mockPatch.mockClear();

    fireEvent.click(screen.getByTitle(/ai drafts scope text you review and edit before accepting/i));
    fireEvent.change(screen.getByPlaceholderText(/describe the work.*interior repaint, 3 rooms, 2 coats, patch drywall near windows/i), {
      target: { value: "replace ceiling tiles in two offices" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate scope/i }));

    await waitFor(() => {
      expect(screen.getByText(/scope draft was too generic\. add more job detail and try again\./i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /accept draft/i })).not.toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalledWith("scopeNotes", expect.anything());
  });

  test("fails closed when returned invalid scope validation has non-empty scope text", async () => {
    const state = createState({ laborLines: [createBlankStarterLine()] });
    const invalidSummaryWrapperScope = "Scope includes labor, materials, equipment, cleanup, and completion of the requested work.";
    mockRequestSectionAssist.mockResolvedValue({
      writes: {
        scopeNotes: invalidSummaryWrapperScope,
      },
      validation: { valid: false, error: "Generated scope is too generic." },
    });

    mockUseEstimatorState.mockImplementation(() => ({
      state,
      patch: mockPatch,
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine: jest.fn(),
      clearAll: jest.fn(),
      saveNow: jest.fn(),
      replaceState: jest.fn(),
    }));

    mockUseAiAssist.mockImplementation((sectionKey) => {
      if (sectionKey === "labor") {
        return buildIdleAssistReturn({
          open: mockOpenLaborAssist,
          close: mockCloseLaborAssist,
          submit: mockSubmitLaborAssist,
        });
      }
      if (sectionKey === "materials") {
        return buildIdleAssistReturn({
          open: mockOpenMaterialsAssist,
          close: mockCloseMaterialsAssist,
          submit: mockSubmitMaterialsAssist,
        });
      }
      return buildIdleAssistReturn();
    });

    render(<EstimateForm />);
    mockPatch.mockClear();

    fireEvent.click(screen.getByTitle(/ai drafts scope text you review and edit before accepting/i));
    fireEvent.change(screen.getByPlaceholderText(/describe the work.*interior repaint, 3 rooms, 2 coats, patch drywall near windows/i), {
      target: { value: "replace ceiling tiles in two offices" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate scope/i }));

    await waitFor(() => {
      expect(screen.getByText(/generated scope is too generic\./i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /accept draft/i })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(invalidSummaryWrapperScope);
    expect(mockPatch).not.toHaveBeenCalledWith("scopeNotes", invalidSummaryWrapperScope);
  });

  test("restores the prior scope review when a refine result is blocked as scaffold", async () => {
    const state = createState({ laborLines: [createBlankStarterLine()] });
    mockRequestSectionAssist
      .mockResolvedValueOnce({
        writes: {
          scopeNotes: "- Remove damaged ceiling tiles.\n- Install matching replacement ceiling tiles.\n- Dispose of debris.",
        },
        validation: { valid: true },
      })
      .mockResolvedValueOnce({
        writes: {
          scopeNotes: "Complete the described scope and clean up the work area.",
        },
        validation: { valid: true },
      });

    mockUseEstimatorState.mockImplementation(() => ({
      state,
      patch: mockPatch,
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine: jest.fn(),
      clearAll: jest.fn(),
      saveNow: jest.fn(),
      replaceState: jest.fn(),
    }));

    mockUseAiAssist.mockImplementation((sectionKey) => {
      if (sectionKey === "labor") {
        return buildIdleAssistReturn({
          open: mockOpenLaborAssist,
          close: mockCloseLaborAssist,
          submit: mockSubmitLaborAssist,
        });
      }
      if (sectionKey === "materials") {
        return buildIdleAssistReturn({
          open: mockOpenMaterialsAssist,
          close: mockCloseMaterialsAssist,
          submit: mockSubmitMaterialsAssist,
        });
      }
      return buildIdleAssistReturn();
    });

    render(<EstimateForm />);
    mockPatch.mockClear();

    fireEvent.click(screen.getByTitle(/ai drafts scope text you review and edit before accepting/i));
    fireEvent.change(screen.getByPlaceholderText(/describe the work.*interior repaint, 3 rooms, 2 coats, patch drywall near windows/i), {
      target: { value: "replace ceiling tiles in two offices" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate scope/i }));

    await waitFor(() => {
      expect(document.body.textContent).toContain("Remove damaged ceiling tiles.");
    });

    fireEvent.click(screen.getByRole("button", { name: /refine/i }));
    fireEvent.click(screen.getByRole("button", { name: /shorter/i }));

    await waitFor(() => {
      expect(screen.getByText(/scope draft was too generic\. add more job detail and try again\./i)).toBeInTheDocument();
      expect(document.body.textContent).toContain("Remove damaged ceiling tiles.");
      expect(screen.getByRole("button", { name: /accept draft/i })).toBeInTheDocument();
    });

    expect(screen.queryByText(/complete the described scope and clean up the work area/i)).not.toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalledWith("scopeNotes", expect.stringMatching(/complete the described scope/i));
  });

  test("restores the prior scope review when a refine result is blocked as a generic summary wrapper", async () => {
    const state = createState({ laborLines: [createBlankStarterLine()] });
    const blockedSummaryWrapperScope = "Scope includes labor, materials, equipment, cleanup, and completion of the requested work.";

    mockRequestSectionAssist
      .mockResolvedValueOnce({
        writes: {
          scopeNotes: "- Remove damaged ceiling tiles.\n- Install matching replacement ceiling tiles.\n- Dispose of debris.",
        },
        validation: { valid: true },
      })
      .mockResolvedValueOnce({
        writes: {
          scopeNotes: blockedSummaryWrapperScope,
        },
        validation: { valid: false, error: "Generated scope is too generic." },
      });

    mockUseEstimatorState.mockImplementation(() => ({
      state,
      patch: mockPatch,
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine: jest.fn(),
      clearAll: jest.fn(),
      saveNow: jest.fn(),
      replaceState: jest.fn(),
    }));

    mockUseAiAssist.mockImplementation((sectionKey) => {
      if (sectionKey === "labor") {
        return buildIdleAssistReturn({
          open: mockOpenLaborAssist,
          close: mockCloseLaborAssist,
          submit: mockSubmitLaborAssist,
        });
      }
      if (sectionKey === "materials") {
        return buildIdleAssistReturn({
          open: mockOpenMaterialsAssist,
          close: mockCloseMaterialsAssist,
          submit: mockSubmitMaterialsAssist,
        });
      }
      return buildIdleAssistReturn();
    });

    render(<EstimateForm />);
    mockPatch.mockClear();

    fireEvent.click(screen.getByTitle(/ai drafts scope text you review and edit before accepting/i));
    fireEvent.change(screen.getByPlaceholderText(/describe the work.*interior repaint, 3 rooms, 2 coats, patch drywall near windows/i), {
      target: { value: "replace ceiling tiles in two offices" },
    });
    fireEvent.click(screen.getByRole("button", { name: /generate scope/i }));

    await waitFor(() => {
      expect(document.body.textContent).toContain("Remove damaged ceiling tiles.");
      expect(screen.getByRole("button", { name: /accept draft/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /refine/i }));
    fireEvent.click(screen.getByRole("button", { name: /shorter/i }));

    await waitFor(() => {
      expect(screen.getByText(/generated scope is too generic\./i)).toBeInTheDocument();
      expect(document.body.textContent).toContain("Remove damaged ceiling tiles.");
      expect(screen.getByRole("button", { name: /accept draft/i })).toBeInTheDocument();
    });

    expect(screen.queryByText(new RegExp(blockedSummaryWrapperScope, "i"))).not.toBeInTheDocument();
    expect(mockPatch).not.toHaveBeenCalledWith("scopeNotes", blockedSummaryWrapperScope);
  });

  test("preserves the first materials request when switching modes", async () => {
    const state = createState({ laborLines: [createBlankStarterLine()] });
    state.ui.materialsMode = "blanket";
    let currentMaterialsAssistState = {
      phase: "review",
      input: "3 toilets, wax rings, closet bolts, supply lines, caulk",
      result: {
        writes: {
          modeMismatch: {
            currentMode: "blanket",
            recommendedMode: "itemized",
            message: "This request fits the other materials mode better.",
          },
        },
      },
    };

    mockCloseMaterialsAssist.mockImplementation(() => {
      currentMaterialsAssistState = { phase: "idle", input: "" };
    });

    mockUseEstimatorState.mockImplementation(() => ({
      state,
      patch: (...args) => {
        const [path, value] = args;
        mockPatch(...args);
        if (path === "ui.materialsMode") {
          state.ui.materialsMode = value;
        }
      },
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine: jest.fn(),
      clearAll: jest.fn(),
      saveNow: jest.fn(),
      replaceState: jest.fn(),
    }));

    mockUseAiAssist.mockImplementation((sectionKey) => {
      if (sectionKey === "labor") {
        return buildIdleAssistReturn({
          open: mockOpenLaborAssist,
          close: mockCloseLaborAssist,
          submit: mockSubmitLaborAssist,
        });
      }
      if (sectionKey === "materials") {
        return {
          assistState: currentMaterialsAssistState,
          open: mockOpenMaterialsAssist,
          close: mockCloseMaterialsAssist,
          submit: mockSubmitMaterialsAssist,
        };
      }
      return buildIdleAssistReturn();
    });

    const view = render(<EstimateForm />);
    mockPatch.mockClear();
    mockSubmitMaterialsAssist.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /switch to itemized/i }));
    view.rerender(<EstimateForm />);

    await waitFor(() => {
      expect(mockSubmitMaterialsAssist).toHaveBeenCalledWith("3 toilets, wax rings, closet bolts, supply lines, caulk");
    });
  });

  test("does not replay the materials request when a mode-switch review is kept current", async () => {
    const state = createState({ laborLines: [createBlankStarterLine()] });
    state.ui.materialsMode = "blanket";
    let currentMaterialsAssistState = {
      phase: "review",
      input: "3 toilets, wax rings, closet bolts, supply lines, caulk",
      result: {
        writes: {
          modeMismatch: {
            currentMode: "blanket",
            recommendedMode: "itemized",
            message: "This request fits the other materials mode better.",
          },
        },
      },
    };

    mockCloseMaterialsAssist.mockImplementation(() => {
      currentMaterialsAssistState = { phase: "idle", input: "" };
    });

    mockUseEstimatorState.mockImplementation(() => ({
      state,
      patch: (...args) => {
        const [path, value] = args;
        mockPatch(...args);
        if (path === "ui.materialsMode") {
          state.ui.materialsMode = value;
        }
      },
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine: jest.fn(),
      clearAll: jest.fn(),
      saveNow: jest.fn(),
      replaceState: jest.fn(),
    }));

    mockUseAiAssist.mockImplementation((sectionKey) => {
      if (sectionKey === "labor") {
        return buildIdleAssistReturn({
          open: mockOpenLaborAssist,
          close: mockCloseLaborAssist,
          submit: mockSubmitLaborAssist,
        });
      }
      if (sectionKey === "materials") {
        return {
          assistState: currentMaterialsAssistState,
          open: mockOpenMaterialsAssist,
          close: mockCloseMaterialsAssist,
          submit: mockSubmitMaterialsAssist,
        };
      }
      return buildIdleAssistReturn();
    });

    const view = render(<EstimateForm />);
    mockPatch.mockClear();
    mockSubmitMaterialsAssist.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /keep current/i }));
    view.rerender(<EstimateForm />);

    await waitFor(() => {
      expect(mockCloseMaterialsAssist).toHaveBeenCalledTimes(1);
    });
    expect(mockPatch).not.toHaveBeenCalledWith("ui.materialsMode", expect.anything());
    expect(mockSubmitMaterialsAssist).not.toHaveBeenCalled();
  });

  test("does not replay the materials request when a mode-switch review is closed", async () => {
    const state = createState({ laborLines: [createBlankStarterLine()] });
    state.ui.materialsMode = "blanket";
    let currentMaterialsAssistState = {
      phase: "review",
      input: "3 toilets, wax rings, closet bolts, supply lines, caulk",
      result: {
        writes: {
          modeMismatch: {
            currentMode: "blanket",
            recommendedMode: "itemized",
            message: "This request fits the other materials mode better.",
          },
        },
      },
    };

    mockCloseMaterialsAssist.mockImplementation(() => {
      currentMaterialsAssistState = { phase: "idle", input: "" };
    });

    mockUseEstimatorState.mockImplementation(() => ({
      state,
      patch: (...args) => {
        const [path, value] = args;
        mockPatch(...args);
        if (path === "ui.materialsMode") {
          state.ui.materialsMode = value;
        }
      },
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine: jest.fn(),
      clearAll: jest.fn(),
      saveNow: jest.fn(),
      replaceState: jest.fn(),
    }));

    mockUseAiAssist.mockImplementation((sectionKey) => {
      if (sectionKey === "labor") {
        return buildIdleAssistReturn({
          open: mockOpenLaborAssist,
          close: mockCloseLaborAssist,
          submit: mockSubmitLaborAssist,
        });
      }
      if (sectionKey === "materials") {
        return {
          assistState: currentMaterialsAssistState,
          open: mockOpenMaterialsAssist,
          close: mockCloseMaterialsAssist,
          submit: mockSubmitMaterialsAssist,
        };
      }
      return buildIdleAssistReturn();
    });

    const view = render(<EstimateForm />);
    mockPatch.mockClear();
    mockSubmitMaterialsAssist.mockClear();

    fireEvent.click(screen.getByLabelText(/close/i));
    view.rerender(<EstimateForm />);

    await waitFor(() => {
      expect(mockCloseMaterialsAssist).toHaveBeenCalledTimes(1);
    });
    expect(mockPatch).not.toHaveBeenCalledWith("ui.materialsMode", expect.anything());
    expect(mockSubmitMaterialsAssist).not.toHaveBeenCalled();
  });
});
