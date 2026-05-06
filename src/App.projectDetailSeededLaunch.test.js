import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

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
  localStorage.setItem(
    STORAGE_KEYS.PROJECTS,
    JSON.stringify([
      {
        id: mockProjectSeed.projectId,
        customerId: mockProjectSeed.customerId,
        customerName: mockProjectSeed.customerName,
        projectName: mockProjectSeed.projectName,
        projectNumber: mockProjectSeed.projectNumber,
        siteAddress: mockProjectSeed.siteAddress,
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
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

function createContinueCreateDraftState({
  docType,
  customerName,
  projectName,
  laborHours,
  laborRate,
  materialDesc = "",
  blanketDescription = "",
}) {
  const normalizedDocType = docType === "invoice" ? "invoice" : "estimate";
  const state = clone(DEFAULT_STATE);

  state.ui = {
    ...state.ui,
    docType: normalizedDocType,
    materialsMode: normalizedDocType === "invoice" ? "blanket" : "itemized",
  };
  state.customer = {
    ...state.customer,
    id: `${normalizedDocType}_continue_customer`,
    name: customerName,
    fullName: customerName,
    displayName: customerName,
    address: `${customerName} Address`,
    city: "Phoenix",
    state: "AZ",
    zip: "85001",
    projectName,
    projectNumber: `${normalizedDocType.toUpperCase()}-CONTINUE`,
    projectAddress: `${projectName} Address`,
    projectSameAsCustomer: false,
  };
  state.job = {
    ...state.job,
    docNumber: normalizedDocType === "invoice" ? "INV-2201" : "EST-2201",
    location: `${projectName} Site`,
  };
  state.projectId = `${normalizedDocType}_continue_project`;
  state.scopeNotes = normalizedDocType === "invoice" ? "" : `${projectName} scope notes`;
  state.tradeInsert = normalizedDocType === "invoice"
    ? { key: "", text: "" }
    : { key: "painting", text: "Painting" };
  state.labor = {
    ...state.labor,
    hazardPct: 0,
    riskPct: 0,
    multiplier: 1,
    lines: [
      {
        id: `${normalizedDocType}_continue_labor`,
        role: "tech",
        label: "Technician",
        hours: laborHours,
        rate: laborRate,
        trueRateInternal: "55",
        internalRate: "55",
        qty: "1",
        markupPct: "12",
      },
    ],
  };

  if (normalizedDocType === "invoice") {
    state.invoiceNumber = "INV-2201";
    state.estimateNumber = "EST-2101";
    state.materials = {
      ...state.materials,
      items: [],
      markupPct: 0,
      blanketCost: "450",
      blanketInternalCost: "300",
      materialsBlanketDescription: blanketDescription,
    };
  } else {
    state.materials = {
      ...state.materials,
      items: [
        {
          id: `${normalizedDocType}_continue_material`,
          desc: materialDesc,
          qty: "2",
          unitCostInternal: "10",
          costInternal: "20",
          priceEach: "25",
        },
      ],
      markupPct: 0,
      blanketCost: "",
      blanketInternalCost: "",
      materialsBlanketDescription: "",
    };
  }

  return state;
}

function seedContinueCreateDraft(draftState) {
  const draftRaw = JSON.stringify(draftState);
  const draftDocType = draftState?.ui?.docType === "invoice" ? "invoice" : "estimate";

  localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE);
  localStorage.removeItem(STORAGE_KEYS.ESTIMATES);
  localStorage.removeItem(STORAGE_KEYS.INVOICES);
  localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
  localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
  localStorage.removeItem(ACTIVE_EDIT_CONTEXT_KEY);

  localStorage.setItem(STORAGE_KEYS.ESTIMATE_DRAFT, draftRaw);
  localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1");

  if (draftDocType === "invoice") {
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([{ id: "saved_invoice_1", docType: "invoice" }]));
    localStorage.setItem(EDIT_INVOICE_TARGET_KEY, "saved_invoice_1");
    localStorage.setItem(ACTIVE_EDIT_CONTEXT_KEY, JSON.stringify({ type: "invoice", id: "saved_invoice_1" }));
  } else {
    localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([{ id: "saved_estimate_1", docType: "estimate" }]));
    localStorage.setItem(EDIT_ESTIMATE_TARGET_KEY, "saved_estimate_1");
    localStorage.setItem(ACTIVE_EDIT_CONTEXT_KEY, JSON.stringify({ type: "estimate", id: "saved_estimate_1" }));
  }

  localStorage.setItem(
    STORAGE_KEYS.CUSTOMERS,
    JSON.stringify([
      {
        id: draftState?.customer?.id || "",
        name: draftState?.customer?.name || "",
        fullName: draftState?.customer?.fullName || draftState?.customer?.name || "",
        displayName: draftState?.customer?.displayName || draftState?.customer?.name || "",
        address: draftState?.customer?.address || "",
        city: draftState?.customer?.city || "",
        state: draftState?.customer?.state || "",
        zip: draftState?.customer?.zip || "",
        projectName: draftState?.customer?.projectName || "",
        projectNumber: draftState?.customer?.projectNumber || "",
        projectAddress: draftState?.customer?.projectAddress || "",
      },
    ])
  );

  return draftRaw;
}

function createSavedInvoiceRecord({
  id = "saved_invoice_open_1",
  customerName = "Saved Invoice Customer",
  projectName = "Saved Invoice Project",
  projectId = "saved_invoice_project_1",
  invoiceNumber = "INV-7001",
  laborHours = "9",
  laborRate = "125",
  materialDesc = "Saved invoice material",
} = {}) {
  const now = Date.now();
  return {
    id,
    docType: "invoice",
    invoiceType: "manual",
    invoiceNumber,
    status: "sent",
    paymentStatus: "unpaid",
    total: 875,
    invoiceTotal: 875,
    amountPaid: 0,
    balanceRemaining: 875,
    projectId,
    projectName,
    customerId: `cust_${id}`,
    customerName,
    customer: {
      id: `cust_${id}`,
      name: customerName,
      fullName: customerName,
      displayName: customerName,
      projectName,
      projectNumber: "PRJ-7001",
      projectAddress: "100 Saved Invoice Way",
    },
    job: {
      date: "2026-05-06",
      due: "2026-05-20",
      location: "Saved Invoice Site",
      poNumber: "PO-7001",
      docNumber: invoiceNumber,
    },
    scopeNotes: "Saved invoice scope notes",
    additionalNotes: "Saved invoice additional notes",
    labor: {
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
      lines: [
        {
          id: `${id}_labor_1`,
          role: "tech",
          label: "Technician",
          hours: laborHours,
          rate: laborRate,
          trueRateInternal: "55",
          internalRate: "55",
          qty: "1",
          markupPct: "12",
        },
      ],
    },
    materials: {
      items: [
        {
          id: `${id}_material_1`,
          desc: materialDesc,
          qty: "2",
          unitCostInternal: "20",
          costInternal: "40",
          priceEach: "55",
        },
      ],
      markupPct: 0,
      blanketCost: "",
      blanketInternalCost: "",
      materialsBlanketDescription: "",
    },
    ui: {
      docType: "invoice",
      materialsMode: "itemized",
    },
    createdAt: now,
    updatedAt: now,
    savedAt: now,
    ts: now,
  };
}

async function openContinueCreateFlow(intent = "estimate") {
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

  const startNewDialog = await screen.findByRole("dialog", { name: /start new/i });
  fireEvent.click(
    within(startNewDialog).getByRole("button", { name: intent === "invoice" ? /^invoice$/i : /^estimate$/i })
  );

  const continueDialog = await screen.findByRole("dialog", { name: /start new estimate/i });
  fireEvent.click(within(continueDialog).getByRole("button", { name: /^continue$/i }));

  await screen.findByText(intent === "invoice" ? "Invoice Builder" : "Estimate Builder");
}

function readStoredEstimatorState() {
  const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE) || "";
  return {
    raw,
    parsed: raw ? JSON.parse(raw) : null,
  };
}

function readLastMountedBuilderState() {
  const state = mockInitialBuilderStates[mockInitialBuilderStates.length - 1] || {};
  return {
    state,
    raw: JSON.stringify(state),
  };
}

async function expectBuilderFieldValues({ customerName, projectName, laborHours, laborRate }) {
  await waitFor(() => {
    expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue(customerName);
    expect(screen.getByPlaceholderText("Project name (optional)")).toHaveValue(projectName);
    expect(screen.getByPlaceholderText("Hours")).toHaveValue(laborHours);
    expect(screen.getByPlaceholderText("Rate ($/hr)")).toHaveValue(laborRate);
  });
}

async function expectBlankBuilderFields() {
  await waitFor(() => {
    expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("");
    expect(screen.getByPlaceholderText("Project name (optional)")).toHaveValue("");
    expect(screen.getByPlaceholderText("Hours")).toHaveValue("");
    expect(screen.getByPlaceholderText("Rate ($/hr)")).toHaveValue("");
  });
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

describe("App Continue Create draft handoff", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockInitialBuilderStates.length = 0;
    projectDetailScreenModule.__resetProjectDetailTarget();
  });

  test("preserves an estimate-shaped draft when Continue Create reopens estimate intent", async () => {
    const draftState = createContinueCreateDraftState({
      docType: "estimate",
      customerName: "Estimate Continue Customer",
      projectName: "Estimate Continue Project",
      laborHours: "7",
      laborRate: "88",
      materialDesc: "Estimate continue material",
    });

    const draftRaw = seedContinueCreateDraft(draftState);

    await openContinueCreateFlow("estimate");
    await expectBuilderFieldValues({
      customerName: "Estimate Continue Customer",
      projectName: "Estimate Continue Project",
      laborHours: "7",
      laborRate: "88",
    });

    expect(screen.getByText("Estimate continue material")).toBeInTheDocument();

    const storedState = readStoredEstimatorState();
    const mountedState = readLastMountedBuilderState();

    expect(storedState.raw).toBe(draftRaw);
    expect(storedState.parsed?.ui).toEqual(expect.objectContaining({ docType: "estimate", materialsMode: "itemized" }));
    expect(storedState.parsed?.customer?.name).toBe("Estimate Continue Customer");
    expect(storedState.parsed?.customer?.projectName).toBe("Estimate Continue Project");
    expect(storedState.parsed?.labor?.lines?.[0]?.hours).toBe("7");
    expect(storedState.parsed?.labor?.lines?.[0]?.rate).toBe("88");
    expect(mountedState.state?.ui).toEqual(expect.objectContaining({ docType: "estimate" }));
    expect(mountedState.raw).toContain("Estimate Continue Customer");
    expect(mountedState.raw).toContain("Estimate continue material");
  });

  test("preserves an invoice-shaped draft when Continue Create reopens invoice intent", async () => {
    const draftState = createContinueCreateDraftState({
      docType: "invoice",
      customerName: "Invoice Continue Customer",
      projectName: "Invoice Continue Project",
      laborHours: "11",
      laborRate: "145",
      blanketDescription: "Invoice continue blanket",
    });

    const draftRaw = seedContinueCreateDraft(draftState);

    await openContinueCreateFlow("invoice");
    await expectBuilderFieldValues({
      customerName: "Invoice Continue Customer",
      projectName: "Invoice Continue Project",
      laborHours: "11",
      laborRate: "145",
    });

    const storedState = readStoredEstimatorState();
    const mountedState = readLastMountedBuilderState();

    expect(storedState.raw).toBe(draftRaw);
    expect(storedState.parsed?.ui).toEqual(expect.objectContaining({ docType: "invoice", materialsMode: "blanket" }));
    expect(storedState.parsed?.customer?.name).toBe("Invoice Continue Customer");
    expect(storedState.parsed?.customer?.projectName).toBe("Invoice Continue Project");
    expect(storedState.parsed?.labor?.lines?.[0]?.hours).toBe("11");
    expect(storedState.parsed?.labor?.lines?.[0]?.rate).toBe("145");
    expect(storedState.parsed?.materials?.materialsBlanketDescription).toBe("Invoice continue blanket");
    expect(mountedState.state?.ui).toEqual(expect.objectContaining({ docType: "invoice", materialsMode: "blanket" }));
    expect(mountedState.raw).toContain("Invoice Continue Customer");
    expect(mountedState.raw).toContain("Invoice continue blanket");
  });

  test("replaces an estimate-shaped draft with a clean invoice-safe state when Continue Create requests invoice intent", async () => {
    const draftState = createContinueCreateDraftState({
      docType: "estimate",
      customerName: "Cross Estimate Customer",
      projectName: "Cross Estimate Project",
      laborHours: "17",
      laborRate: "88",
      materialDesc: "Cross estimate material",
    });

    const draftRaw = seedContinueCreateDraft(draftState);

    await openContinueCreateFlow("invoice");
    await expectBlankBuilderFields();

    expect(screen.queryByText("Cross estimate material")).not.toBeInTheDocument();

    const storedState = readStoredEstimatorState();
    const mountedState = readLastMountedBuilderState();

    expect(storedState.raw).not.toBe(draftRaw);
    expect(storedState.parsed?.ui).toEqual(expect.objectContaining({ docType: "invoice", materialsMode: "blanket" }));
    expect(storedState.raw).not.toContain("Cross Estimate Customer");
    expect(storedState.raw).not.toContain("Cross Estimate Project");
    expect(storedState.raw).not.toContain("17");
    expect(storedState.raw).not.toContain("88");
    expect(storedState.raw).not.toContain("Cross estimate material");
    expect(mountedState.state?.ui).toEqual(expect.objectContaining({ docType: "invoice", materialsMode: "blanket" }));
    expect(mountedState.raw).not.toContain("Cross Estimate Customer");
    expect(mountedState.raw).not.toContain("Cross estimate material");
  });

  test("replaces an invoice-shaped draft with a clean estimate-safe state when Continue Create requests estimate intent", async () => {
    const draftState = createContinueCreateDraftState({
      docType: "invoice",
      customerName: "Cross Invoice Customer",
      projectName: "Cross Invoice Project",
      laborHours: "23",
      laborRate: "144",
      blanketDescription: "Cross invoice blanket",
    });

    const draftRaw = seedContinueCreateDraft(draftState);

    await openContinueCreateFlow("estimate");
    await expectBlankBuilderFields();

    const storedState = readStoredEstimatorState();
    const mountedState = readLastMountedBuilderState();

    expect(storedState.raw).not.toBe(draftRaw);
    expect(storedState.parsed?.ui).toEqual(expect.objectContaining({ docType: "estimate", materialsMode: "itemized" }));
    expect(storedState.raw).not.toContain("Cross Invoice Customer");
    expect(storedState.raw).not.toContain("Cross Invoice Project");
    expect(storedState.raw).not.toContain("23");
    expect(storedState.raw).not.toContain("144");
    expect(storedState.raw).not.toContain("Cross invoice blanket");
    expect(mountedState.state?.ui).toEqual(expect.objectContaining({ docType: "estimate", materialsMode: "itemized" }));
    expect(mountedState.raw).not.toContain("Cross Invoice Customer");
    expect(mountedState.raw).not.toContain("Cross invoice blanket");
  });

  test("opening an existing invoice from Invoices clears a stale invoice create session before edit hydration", async () => {
    const staleState = createStaleBuilderState({
      docType: "invoice",
      customerName: "Stale Blank Invoice Customer",
      projectName: "Stale Blank Invoice Project",
      laborHours: "23",
      laborRate: "144",
      materialDesc: "Stale blank invoice material",
    });
    const savedInvoice = createSavedInvoiceRecord({
      id: "saved_invoice_open_existing",
      customerName: "Open Existing Customer",
      projectName: "Open Existing Project",
      invoiceNumber: "INV-OPEN-7001",
      laborHours: "5",
      laborRate: "72",
      materialDesc: "Open existing material",
    });

    localStorage.clear();
    jest.clearAllMocks();
    mockInitialBuilderStates.length = 0;

    localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify(staleState));
    localStorage.setItem(STORAGE_KEYS.ESTIMATE_DRAFT, JSON.stringify(staleState));
    localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1");
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([savedInvoice]));

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^invoices$/i }));

    fireEvent.click(await screen.findByRole("button", { name: /^open$/i }));

    await screen.findByRole("heading", { name: /EDIT INVOICE/i });
    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("Open Existing Customer");
      expect(screen.getByPlaceholderText("Project name (optional)")).toHaveValue("Open Existing Project");
      expect(screen.queryByText("Stale blank invoice material")).not.toBeInTheDocument();
      expect(screen.getByText("Open existing material")).toBeInTheDocument();
    });

    expect(mockReplaceState).toHaveBeenCalledWith(
      expect.objectContaining({
        customer: expect.objectContaining({
          name: "Open Existing Customer",
          projectName: "Open Existing Project",
        }),
        labor: expect.objectContaining({
          lines: expect.arrayContaining([
            expect.objectContaining({
              hours: "5",
              rate: "72",
            }),
          ]),
        }),
        materials: expect.objectContaining({
          items: expect.arrayContaining([
            expect.objectContaining({
              desc: "Open existing material",
            }),
          ]),
        }),
      }),
      expect.any(Object)
    );

    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE)).toBe(JSON.stringify({ ui: { docType: "invoice" } }));
    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBeNull();
    expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBeNull();
    expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_EDIT_CONTEXT_KEY)).toEqual(
      JSON.stringify({ type: "invoice", id: "saved_invoice_open_existing" })
    );
  });
});
