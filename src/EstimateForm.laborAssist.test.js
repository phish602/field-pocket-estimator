import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";

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

jest.mock("./estimator/useEstimatorState", () => ({
  __esModule: true,
  default: (...args) => mockUseEstimatorState(...args),
  useEstimatorState: (...args) => mockUseEstimatorState(...args),
}));

jest.mock("./estimator/aiAssist/useAiAssist", () => ({
  useAiAssist: (...args) => mockUseAiAssist(...args),
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

function getLaborLinesPatchArg() {
  const laborCalls = mockPatch.mock.calls.filter(([path]) => path === "labor.lines");
  return laborCalls[laborCalls.length - 1]?.[1];
}

describe("EstimateForm labor AI assist writeback", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
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
});