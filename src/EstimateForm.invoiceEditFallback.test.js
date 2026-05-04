import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const FIXED_TIMESTAMP = 1770000000000;

const mockPatch = jest.fn();
const mockReplaceState = jest.fn();
const mockSaveNow = jest.fn();
let mockInitialState = null;

jest.mock("./estimator/useEstimatorState", () => {
  const React = require("react");
  const { DEFAULT_STATE } = require("./estimator/defaultState");

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

  function useMockEstimatorState() {
    const [state, setState] = React.useState(() => normalizeState(mockInitialState || {}));

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

function createCustomer() {
  return {
    id: "cust_invoice_verify",
    name: "Invoice Verify Customer",
    fullName: "Invoice Verify Customer",
    displayName: "Invoice Verify Customer",
    customerType: "residential",
    projectName: "Invoice Verify Project",
    projectNumber: "IV-1001",
    projectAddress: "123 Main St",
    address: "123 Main St",
    city: "Phoenix",
    state: "AZ",
    zip: "85001",
  };
}

function createLaborLine(overrides = {}) {
  return {
    id: "labor_saved_1",
    role: "foreman",
    label: "Foreman",
    hours: "9",
    rate: "123",
    trueRateInternal: "77",
    internalRate: "77",
    qty: "1",
    markupPct: "0",
    ...overrides,
  };
}

function createSavedInvoice(overrides = {}) {
  const customer = createCustomer();

  return {
    id: "inv_manual_verify",
    docType: "invoice",
    invoiceType: "manual",
    invoiceNumber: "INV-1001",
    estimateNumber: "EST-2001",
    customerId: customer.id,
    customerName: customer.name,
    projectId: "proj_invoice_verify",
    projectName: customer.projectName,
    status: "sent",
    paymentStatus: "unpaid",
    total: 300,
    invoiceTotal: 300,
    amountPaid: 0,
    balanceRemaining: 300,
    date: "2026-05-03",
    dueDate: "2026-05-17",
    customer: {
      ...customer,
      projectSameAsCustomer: false,
    },
    job: {
      date: "2026-05-03",
      due: "2026-05-17",
      poNumber: "PO-INV-1",
      docNumber: "INV-1001",
      location: "Suite 100",
    },
    labor: {
      lines: [createLaborLine()],
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
    },
    materials: {
      items: [],
      markupPct: 0,
      blanketCost: "300",
      blanketInternalCost: "200",
      materialsBlanketDescription: "Allowance",
    },
    payments: [],
    ui: {
      docType: "invoice",
      materialsMode: "blanket",
    },
    meta: {
      savedDocId: "inv_manual_verify",
      savedDocCreatedAt: FIXED_TIMESTAMP - 1000,
      lastSavedAt: FIXED_TIMESTAMP,
    },
    createdAt: FIXED_TIMESTAMP - 1000,
    updatedAt: FIXED_TIMESTAMP,
    savedAt: FIXED_TIMESTAMP,
    ts: FIXED_TIMESTAMP,
    ...overrides,
  };
}

function createSavedEstimate(overrides = {}) {
  const customer = createCustomer();

  return {
    id: "est_manual_verify",
    docType: "estimate",
    estimateNumber: "EST-2001",
    customerId: customer.id,
    customerName: customer.name,
    projectId: "proj_estimate_verify",
    projectName: customer.projectName,
    status: "pending",
    total: 420,
    grandTotal: 420,
    totalRevenue: 420,
    scopeNotes: "Patch drywall and repaint the front lobby.",
    customer: {
      ...customer,
      projectSameAsCustomer: false,
    },
    job: {
      date: "2026-05-03",
      due: "2026-05-17",
      poNumber: "PO-EST-1",
      docNumber: "EST-2001",
      location: "123 Main St",
    },
    labor: {
      lines: [createLaborLine()],
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
    },
    materials: {
      items: [],
      markupPct: 0,
      blanketCost: "120",
      blanketInternalCost: "80",
      materialsBlanketDescription: "Estimate allowance",
    },
    ui: {
      docType: "estimate",
      materialsMode: "blanket",
    },
    meta: {
      savedDocId: "est_manual_verify",
      savedDocCreatedAt: FIXED_TIMESTAMP - 1000,
      lastSavedAt: FIXED_TIMESTAMP,
    },
    createdAt: FIXED_TIMESTAMP - 1000,
    updatedAt: FIXED_TIMESTAMP,
    savedAt: FIXED_TIMESTAMP,
    ts: FIXED_TIMESTAMP,
    ...overrides,
  };
}

function createRetainedInvoiceDraft() {
  const state = clone(DEFAULT_STATE);
  const customer = createCustomer();

  state.ui = { ...state.ui, docType: "invoice", materialsMode: "blanket" };
  state.customer = {
    ...state.customer,
    id: customer.id,
    name: customer.name,
    fullName: customer.fullName,
    displayName: customer.displayName,
    address: customer.address,
    city: customer.city,
    state: customer.state,
    zip: customer.zip,
    projectName: "Retained Invoice Draft",
    projectNumber: customer.projectNumber,
    projectAddress: customer.projectAddress,
    projectSameAsCustomer: false,
  };
  state.job = {
    ...state.job,
    docNumber: "INV-1001",
    date: "2026-05-03",
    due: "2026-05-17",
    poNumber: "PO-INV-1",
    location: "Suite 100",
  };
  state.invoiceNumber = "INV-1001";
  state.estimateNumber = "EST-2001";
  state.labor = {
    ...state.labor,
    lines: [createLaborLine()],
    hazardPct: 0,
    riskPct: 0,
    multiplier: 1,
  };
  state.materials = {
    ...state.materials,
    items: [],
    markupPct: 0,
    blanketCost: "300",
    blanketInternalCost: "200",
    materialsBlanketDescription: "Allowance",
  };
  state.meta = {
    ...(state.meta || {}),
    savedDocId: "inv_manual_verify",
    savedDocCreatedAt: FIXED_TIMESTAMP - 1000,
    lastSavedAt: FIXED_TIMESTAMP,
  };

  return state;
}

function seedInvoiceStorage({ invoice, customer, estimatorState, editInvoiceTargetId = "" }) {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([customer]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([invoice]));

  if (estimatorState) {
    localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify(estimatorState));
  } else {
    localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE);
  }

  if (editInvoiceTargetId) {
    localStorage.setItem(EDIT_INVOICE_TARGET_KEY, editInvoiceTargetId);
  } else {
    localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
  }
}

function seedEstimateStorage({ estimate, customer, estimatorState, editEstimateTargetId = "" }) {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([customer]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([estimate]));

  if (estimatorState) {
    localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify(estimatorState));
  } else {
    localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE);
  }

  if (editEstimateTargetId) {
    localStorage.setItem(EDIT_ESTIMATE_TARGET_KEY, editEstimateTargetId);
  } else {
    localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
  }
}

describe("EstimateForm invoice edit fallback", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockInitialState = null;
  });

  test("uses invoice-specific Start Here guidance while keeping the invoice toggle hidden and estimate mode unchanged", async () => {
    const invoiceState = clone(DEFAULT_STATE);
    invoiceState.ui = {
      ...(invoiceState.ui || {}),
      docType: "invoice",
      materialsMode: "blanket",
    };
    mockInitialState = invoiceState;

    const { unmount } = render(<EstimateForm />);

    await screen.findByText("Invoice Builder");

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Estimate$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Invoice$/i })).not.toBeInTheDocument();
    expect(screen.getByText("Project / Job")).toBeInTheDocument();
    expect(screen.getByText("Amounts / Lines")).toBeInTheDocument();
    expect(screen.queryByText(/^Scope$/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Scope of Work")).not.toBeInTheDocument();

    const estimateState = clone(DEFAULT_STATE);
    estimateState.ui = {
      ...(estimateState.ui || {}),
      docType: "estimate",
      materialsMode: "blanket",
    };
    mockInitialState = estimateState;

    unmount();
    render(<EstimateForm />);

    await screen.findByText("Estimate Builder");

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Estimate$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Invoice$/i })).toBeInTheDocument();
    expect(screen.getByText(/^Scope$/i)).toBeInTheDocument();
    expect(screen.getByText("Scope of Work")).toBeInTheDocument();
  });

  test("shows Start Here in estimate edit mode while invoice edit mode stays unchanged", async () => {
    const customer = createCustomer();
    const savedEstimate = createSavedEstimate();
    mockInitialState = clone(DEFAULT_STATE);

    seedEstimateStorage({
      estimate: savedEstimate,
      customer,
      editEstimateTargetId: savedEstimate.id,
    });

    render(<EstimateForm />);

    await screen.findByText("EDIT ESTIMATE");

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(screen.getByText(/^Scope$/i)).toBeInTheDocument();
  });

  test("clears retained invoice-shaped draft state when invoice builder opens without a valid edit target", async () => {
    const customer = createCustomer();
    const savedInvoice = createSavedInvoice();
    const retainedDraft = createRetainedInvoiceDraft();
    mockInitialState = retainedDraft;

    seedInvoiceStorage({
      invoice: savedInvoice,
      customer,
      estimatorState: retainedDraft,
    });

    render(<EstimateForm />);

    await screen.findByText("Invoice Builder");

    await waitFor(() => {
      expect(screen.queryByText("EDIT INVOICE")).not.toBeInTheDocument();
      expect(screen.getByText("Invoice not found. Switched to new mode.")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("");
      expect(screen.getByPlaceholderText("Project name (optional)")).toHaveValue("");
      expect(screen.getByPlaceholderText("Hours")).toHaveValue("");
      expect(screen.getByPlaceholderText("Rate ($/hr)")).toHaveValue("");
    });

    const replaceStateCall = mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1] || [];
    const fallbackState = replaceStateCall[0] || {};

    expect(fallbackState.ui).toEqual(expect.objectContaining({ docType: "invoice", materialsMode: "blanket" }));
    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE)).toBeNull();
  });

  test("hydrates a valid saved invoice edit target without wiping invoice data", async () => {
    const customer = createCustomer();
    const savedInvoice = createSavedInvoice({
      customer: {
        ...createCustomer(),
        projectName: "Invoice Verify Project",
        projectSameAsCustomer: false,
      },
    });
    mockInitialState = clone(DEFAULT_STATE);

    seedInvoiceStorage({
      invoice: savedInvoice,
      customer,
      editInvoiceTargetId: savedInvoice.id,
    });

    render(<EstimateForm />);

    await screen.findByText("EDIT INVOICE");

    await waitFor(() => {
      expect(screen.queryByText("Invoice not found. Switched to new mode.")).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("Invoice Verify Customer");
      expect(screen.getByPlaceholderText("Project name (optional)")).toHaveValue("Invoice Verify Project");
    });

    expect(screen.queryByText("Start here")).not.toBeInTheDocument();

    const replaceStateCall = mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1] || [];
    const hydratedState = replaceStateCall[0] || {};

    expect(hydratedState.meta).toEqual(expect.objectContaining({ savedDocId: savedInvoice.id }));
    expect(hydratedState.ui).toEqual(expect.objectContaining({ docType: "invoice" }));
  });
});