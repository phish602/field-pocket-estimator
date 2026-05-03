import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const PROJECT_CREATE_SEED_KEY = "estipaid-project-create-seed-v1";
const PROJECT_DETAIL_RETURN_TARGET_KEY = "estipaid-project-detail-return-target-v1";
const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const ACTIVE_EDIT_CONTEXT_KEY = "estipaid-active-edit-context-v1";

const mockProjectSeed = Object.freeze({
  projectId: "proj_seed",
  customerId: "cust_seed",
  customerName: "Seed Customer",
  projectName: "Seed Project",
  projectNumber: "PRJ-100",
  siteAddress: "123 Seed St",
});

const mockInitialBuilderStates = [];
const mockPatch = jest.fn();
const mockReplaceState = jest.fn();
const mockSaveNow = jest.fn();

jest.mock("./utils/guards", () => ({
  requireCompanyProfile: () => ({ allowed: true }),
}));

jest.mock("./screens/ProjectsScreen", () => {
  return function MockProjectsScreen({ onOpenProjectDetail }) {
    return (
      <div data-testid="projects-screen">
        <button type="button" onClick={() => onOpenProjectDetail("proj_seed")}>
          Open project detail
        </button>
      </div>
    );
  };
});

jest.mock("./screens/ProjectDetailScreen", () => {
  const React = require("react");
  let mockProjectDetailTarget = "";

  function writeSeed() {
    globalThis.localStorage.setItem("estipaid-project-create-seed-v1", JSON.stringify(mockProjectSeed));
  }

  function MockProjectDetailScreen({ onNewEstimate, onNewInvoice }) {
    return (
      <div data-testid="project-detail-screen">
        <button
          type="button"
          onClick={() => {
            writeSeed();
            onNewEstimate();
          }}
        >
          Launch seeded estimate
        </button>
        <button
          type="button"
          onClick={() => {
            writeSeed();
            onNewInvoice();
          }}
        >
          Launch seeded invoice
        </button>
      </div>
    );
  }

  return {
    __esModule: true,
    default: MockProjectDetailScreen,
    readProjectDetailTarget: () => mockProjectDetailTarget,
    writeProjectDetailTarget: (projectId) => {
      mockProjectDetailTarget = String(projectId || "").trim();
      return mockProjectDetailTarget;
    },
    __resetProjectDetailTarget: () => {
      mockProjectDetailTarget = "";
    },
  };
});

jest.mock("./estimator/useEstimatorState", () => {
  const React = require("react");
  const { DEFAULT_STATE } = require("./estimator/defaultState");
  const { STORAGE_KEYS } = require("./constants/storageKeys");

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeValues(baseValue, nextValue) {
    if (Array.isArray(nextValue)) {
      return nextValue.map((entry) => mergeValues(undefined, entry));
    }

    if (nextValue && typeof nextValue === "object") {
      const baseObject = baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)
        ? { ...baseValue }
        : {};
      Object.keys(nextValue).forEach((key) => {
        baseObject[key] = mergeValues(baseObject[key], nextValue[key]);
      });
      return baseObject;
    }

    return nextValue === undefined ? baseValue : nextValue;
  }

  function normalizeState(nextState = {}) {
    return mergeValues(clone(DEFAULT_STATE), clone(nextState || {}));
  }

  function setByPath(target, path, value) {
    const segments = String(path || "").split(".").filter(Boolean);
    if (!segments.length) return;

    let cursor = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const key = segments[index];
      if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) {
        cursor[key] = {};
      }
      cursor = cursor[key];
    }

    cursor[segments[segments.length - 1]] = value;
  }

  function readInitialState() {
    try {
      const raw = globalThis.localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE);
      const parsed = raw ? JSON.parse(raw) : {};
      const normalized = normalizeState(parsed);
      mockInitialBuilderStates.push(clone(normalized));
      return normalized;
    } catch {
      const normalized = normalizeState();
      mockInitialBuilderStates.push(clone(normalized));
      return normalized;
    }
  }

  function useMockEstimatorState() {
    const [state, setState] = React.useState(() => readInitialState());

    const patch = React.useCallback((path, value) => {
      mockPatch(path, value);
      setState((previousState) => {
        const nextState = clone(previousState);
        setByPath(nextState, path, value);
        return nextState;
      });
    }, []);

    const replaceState = React.useCallback((nextState, options = {}) => {
      mockReplaceState(nextState, options);
      setState(normalizeState(nextState || {}));
    }, []);

    const updateLaborLine = React.useCallback((index, key, value) => {
      setState((previousState) => {
        const nextState = clone(previousState);
        const currentLines = Array.isArray(nextState?.labor?.lines) ? [...nextState.labor.lines] : [];
        const currentLine = currentLines[index] && typeof currentLines[index] === "object" ? currentLines[index] : {};
        currentLines[index] = { ...currentLine, [key]: value };
        nextState.labor = { ...(nextState.labor || {}), lines: currentLines };
        return nextState;
      });
    }, []);

    const clearAll = React.useCallback(() => {
      setState(normalizeState());
    }, []);

    return {
      state,
      patch,
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine,
      clearAll,
      saveNow: mockSaveNow,
      replaceState,
    };
  }

  return {
    __esModule: true,
    default: (...args) => useMockEstimatorState(...args),
    useEstimatorState: (...args) => useMockEstimatorState(...args),
  };
});

jest.mock("./estimator/aiAssist/useAiAssist", () => ({
  useAiAssist: () => ({
    assistState: { phase: "idle" },
    open: jest.fn(),
    close: jest.fn(),
    submit: jest.fn(),
  }),
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

jest.mock("./components/estimator/PdfPromptModal", () => {
  return function MockPdfPromptModal() {
    return null;
  };
});

jest.mock("./components/estimator/SectionMaterials", () => {
  return function MockSectionMaterials({ materialItems = [] }) {
    const labels = Array.isArray(materialItems)
      ? materialItems.map((item) => String(item?.desc || "").trim()).filter(Boolean)
      : [];
    return (
      <div data-testid="section-materials">
        {labels.map((label) => (
          <div key={label}>{label}</div>
        ))}
      </div>
    );
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

import App from "./App";
import { DEFAULT_STATE } from "./estimator/defaultState";
import { ROUTES } from "./constants/routes";
import { STORAGE_KEYS } from "./constants/storageKeys";

const projectDetailScreenModule = require("./screens/ProjectDetailScreen");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createStaleBuilderState({
  docType,
  customerName,
  projectName,
  laborHours,
  laborRate,
  materialDesc,
}) {
  const state = clone(DEFAULT_STATE);

  state.ui = { ...state.ui, docType, materialsMode: "itemized" };
  state.customer = {
    ...state.customer,
    id: `cust_${docType}_stale`,
    name: customerName,
    fullName: customerName,
    displayName: customerName,
    address: "999 Stale Way",
    city: "Phoenix",
    state: "AZ",
    zip: "85001",
    projectName,
    projectNumber: `${docType.toUpperCase()}-PROJ`,
    projectAddress: "999 Stale Way",
    projectSameAsCustomer: false,
  };
  state.job = {
    ...state.job,
    docNumber: docType === "invoice" ? "INV-9999" : "EST-9999",
    location: "Stale Site",
  };
  state.projectId = `${docType}_project_stale`;
  state.labor = {
    ...state.labor,
    hazardPct: 0,
    riskPct: 0,
    multiplier: 1,
    lines: [
      {
        id: `${docType}_labor_1`,
        role: "tech",
        label: "Technician",
        hours: laborHours,
        rate: laborRate,
        trueRateInternal: "45",
        internalRate: "45",
        qty: "1",
        markupPct: "12",
      },
    ],
  };
  state.materials = {
    ...state.materials,
    items: [
      {
        id: `${docType}_material_1`,
        desc: materialDesc,
        qty: "2",
        unitCostInternal: "10",
        costInternal: "20",
        priceEach: "22",
      },
    ],
    markupPct: 0,
    blanketCost: "",
    blanketInternalCost: "",
    materialsBlanketDescription: "",
  };

  if (docType === "invoice") {
    state.invoiceNumber = "INV-9999";
    state.estimateNumber = "EST-8888";
  }

  return state;
}

function seedContaminatedBuilderSession(staleState) {
  const raw = JSON.stringify(staleState);
  localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, raw);
  localStorage.setItem(STORAGE_KEYS.ESTIMATE_DRAFT, raw);
  localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1");
  localStorage.setItem(EDIT_ESTIMATE_TARGET_KEY, "stale_estimate_target");
  localStorage.setItem(EDIT_INVOICE_TARGET_KEY, "stale_invoice_target");
  localStorage.setItem(
    ACTIVE_EDIT_CONTEXT_KEY,
    JSON.stringify({
      type: staleState?.ui?.docType === "invoice" ? "invoice" : "estimate",
      id: "stale_edit_context",
    })
  );
}

function seedCustomerDirectory() {
  localStorage.setItem(
    STORAGE_KEYS.CUSTOMERS,
    JSON.stringify([
      {
        id: mockProjectSeed.customerId,
        name: mockProjectSeed.customerName,
        fullName: mockProjectSeed.customerName,
        displayName: mockProjectSeed.customerName,
        address: mockProjectSeed.siteAddress,
        city: "Phoenix",
        state: "AZ",
        zip: "85001",
        projectName: mockProjectSeed.projectName,
        projectNumber: mockProjectSeed.projectNumber,
        projectAddress: mockProjectSeed.siteAddress,
      },
    ])
  );
}

async function openProjectDetail() {
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: /projects/i }));
  await screen.findByTestId("projects-screen");

  fireEvent.click(screen.getByRole("button", { name: /open project detail/i }));
  await screen.findByTestId("project-detail-screen");
}

function expectCleanMountedBuilderState({
  expectedDocType,
  staleCustomerName,
  staleProjectName,
  staleLaborHours,
  staleLaborRate,
  staleMaterialDesc,
}) {
  const mountedState = mockInitialBuilderStates[mockInitialBuilderStates.length - 1] || {};
  const mountedRaw = JSON.stringify(mountedState);

  expect(mountedState.ui).toEqual(expect.objectContaining({ docType: expectedDocType }));
  expect(mountedState.customer?.name || "").not.toBe(staleCustomerName);
  expect(mountedState.customer?.projectName || "").not.toBe(staleProjectName);
  expect(mountedRaw).not.toContain(staleLaborHours);
  expect(mountedRaw).not.toContain(staleLaborRate);
  expect(mountedRaw).not.toContain(staleMaterialDesc);
}

function expectResetStorage(staleMaterialDesc) {
  expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBeNull();
  expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBeNull();
  expect(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY)).toBeNull();
  expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
  expect(localStorage.getItem(ACTIVE_EDIT_CONTEXT_KEY)).toBeNull();

  const estimatorStateRaw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE);
  if (estimatorStateRaw) {
    expect(estimatorStateRaw).not.toContain(staleMaterialDesc);
    expect(estimatorStateRaw).not.toContain("Stale");
  }
}

async function expectSeededBuilderUi({ builderTitle, staleMaterialDesc }) {
  await screen.findByText(builderTitle);

  await waitFor(() => {
    expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue(mockProjectSeed.customerName);
    expect(screen.getByPlaceholderText("Project name (optional)")).toHaveValue(mockProjectSeed.projectName);
    expect(screen.getByPlaceholderText("Hours")).toHaveValue("");
    expect(screen.getByPlaceholderText("Rate ($/hr)")).toHaveValue("");
    expect(screen.queryByText(staleMaterialDesc)).not.toBeInTheDocument();
  });

  expect(mockPatch).toHaveBeenCalledWith("customer.name", mockProjectSeed.customerName);
  expect(mockPatch).toHaveBeenCalledWith("customer.id", mockProjectSeed.customerId);
  expect(mockPatch).toHaveBeenCalledWith("customer.projectName", mockProjectSeed.projectName);
  expect(mockPatch).toHaveBeenCalledWith("projectId", mockProjectSeed.projectId);

  const returnTarget = JSON.parse(localStorage.getItem(PROJECT_DETAIL_RETURN_TARGET_KEY) || "null");
  expect(returnTarget).toEqual(
    expect.objectContaining({ route: ROUTES.PROJECT_DETAIL, projectId: mockProjectSeed.projectId })
  );
  expect(localStorage.getItem(PROJECT_CREATE_SEED_KEY)).toBeNull();
}

describe("App Project Detail seeded new-document launches", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockInitialBuilderStates.length = 0;
    projectDetailScreenModule.__resetProjectDetailTarget();
  });

  test("clears stale estimate draft state before a seeded Project Detail new invoice launch hydrates", async () => {
    const staleState = createStaleBuilderState({
      docType: "estimate",
      customerName: "Stale Estimate Customer",
      projectName: "Stale Estimate Project",
      laborHours: "17",
      laborRate: "88",
      materialDesc: "Stale estimate material",
    });

    seedCustomerDirectory();
    seedContaminatedBuilderSession(staleState);
    await openProjectDetail();

    fireEvent.click(screen.getByRole("button", { name: /launch seeded invoice/i }));

    await expectSeededBuilderUi({
      builderTitle: "Invoice Builder",
      staleMaterialDesc: "Stale estimate material",
    });

    expectCleanMountedBuilderState({
      expectedDocType: "invoice",
      staleCustomerName: "Stale Estimate Customer",
      staleProjectName: "Stale Estimate Project",
      staleLaborHours: "17",
      staleLaborRate: "88",
      staleMaterialDesc: "Stale estimate material",
    });
    expectResetStorage("Stale estimate material");
  });

  test("clears stale invoice draft state before a seeded Project Detail new estimate launch hydrates", async () => {
    const staleState = createStaleBuilderState({
      docType: "invoice",
      customerName: "Stale Invoice Customer",
      projectName: "Stale Invoice Project",
      laborHours: "23",
      laborRate: "144",
      materialDesc: "Stale invoice material",
    });

    seedCustomerDirectory();
    seedContaminatedBuilderSession(staleState);
    await openProjectDetail();

    fireEvent.click(screen.getByRole("button", { name: /launch seeded estimate/i }));

    await expectSeededBuilderUi({
      builderTitle: "Estimate Builder",
      staleMaterialDesc: "Stale invoice material",
    });

    expectCleanMountedBuilderState({
      expectedDocType: "estimate",
      staleCustomerName: "Stale Invoice Customer",
      staleProjectName: "Stale Invoice Project",
      staleLaborHours: "23",
      staleLaborRate: "144",
      staleMaterialDesc: "Stale invoice material",
    });
    expectResetStorage("Stale invoice material");
  });
});