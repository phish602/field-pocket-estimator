import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const PROJECT_CREATE_SEED_KEY = "estipaid-project-create-seed-v1";
const FIXED_TIMESTAMP = 1770000000000;

const mockPatch = jest.fn();
const mockReplaceState = jest.fn();
const mockSaveNow = jest.fn();
const mockExportPdf = jest.fn(() => Promise.resolve());
let mockInitialState = null;
let mockSuppressReplaceState = false;

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
      if (mockSuppressReplaceState) return;
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
  return function MockPdfPromptModal({ open, onDownload, onView, onShare }) {
    if (!open) return null;
    return (
      <div data-testid="pdf-prompt-modal">
        <button type="button" onClick={onView}>View PDF</button>
        <button type="button" onClick={onDownload}>Download PDF</button>
        <button type="button" onClick={onShare}>Share PDF</button>
      </div>
    );
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

jest.mock("./utils/storage", () => {
  const actual = jest.requireActual("./utils/storage");
  return {
    ...actual,
    loadCompanyProfile: () => ({
      legalName: "EstiPaid Test Company",
      addressLine1: "123 Builder Way",
      city: "Phoenix",
      state: "AZ",
      zip: "85001",
      phone: "6025550100",
    }),
    normalizeCompanyProfile: (profile) => ({
      ...actual.normalizeCompanyProfile({
        legalName: "EstiPaid Test Company",
        addressLine1: "123 Builder Way",
        city: "Phoenix",
        state: "AZ",
        zip: "85001",
        phone: "6025550100",
      }),
      ...(profile || {}),
    }),
  };
});

jest.mock("./utils/guards", () => ({
  requireCompanyProfile: ({ profile }) => ({
    allowed: true,
    profile: profile || {
      legalName: "EstiPaid Test Company",
      addressLine1: "123 Builder Way",
      city: "Phoenix",
      state: "AZ",
      zip: "85001",
      phone: "6025550100",
    },
  }),
}));

jest.mock("./pdf", () => ({
  exportPdf: (...args) => mockExportPdf(...args),
}));

jest.mock("./lib/scopeImageStorage", () => {
  const actual = jest.requireActual("./lib/scopeImageStorage");
  return {
    ...actual,
    normalizeScopeImageForStorage: jest.fn(),
  };
});

import EstimateForm from "./EstimateForm";
import { DEFAULT_STATE, STORAGE_KEY } from "./estimator/defaultState";
import { STORAGE_KEYS } from "./constants/storageKeys";
import { ROUTES } from "./constants/routes";
import { normalizeScopeImageForStorage } from "./lib/scopeImageStorage";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function renderEstimateFormInStrictMode() {
  return render(
    <React.StrictMode>
      <EstimateForm />
    </React.StrictMode>
  );
}

function getScopeImageInput() {
  return document.querySelector('input[type="file"][accept="image/png,image/jpeg,image/webp"]');
}

function expectDisplayedInvoiceTotal(amountLabel) {
  const totalSection = screen.getByText("Invoice Total").closest(".pe-total");
  expect(totalSection).not.toBeNull();
  expect(within(totalSection).getByText(amountLabel)).toBeInTheDocument();
}

function expectTradeScopeStarterUiAbsent() {
  expect(screen.queryByText(/Trade scope starters/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Punto de partida por oficio/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Add a trade starting point/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("option", { name: /Create custom trade starter/i })).not.toBeInTheDocument();
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

function createProject(overrides = {}) {
  const customer = createCustomer();
  return {
    id: "proj_invoice_verify",
    customerId: customer.id,
    customerName: customer.name,
    projectName: customer.projectName,
    siteAddress: customer.projectAddress,
    status: "estimating",
    ...overrides,
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

function createScopeImages(count = 1) {
  return Array.from({ length: count }, (_, index) => ({
    id: `scope-image-${index + 1}`,
    name: `Reference Photo ${index + 1}.jpg`,
    mimeType: "image/jpeg",
    dataUrl: `data:image/jpeg;base64,scopephoto${index + 1}`,
    storedWidth: 1200,
    storedHeight: 900,
    storedSizeBytes: 4096 + index,
    layout: {
      size: index % 2 === 0 ? "medium" : "large",
      align: index % 3 === 0 ? "left" : "center",
      caption: index % 2 === 0,
    },
  }));
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

function seedInvoiceStorage({ invoice, customer, project = null, estimatorState, editInvoiceTargetId = "" }) {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([customer]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([invoice]));
  if (project) {
    localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([project]));
  } else {
    localStorage.removeItem(STORAGE_KEYS.PROJECTS);
  }

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

function seedProjectCreateSeed({ project, customer }) {
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([customer]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([project]));
  localStorage.setItem(
    "estipaid-project-detail-return-target-v1",
    JSON.stringify({
      route: ROUTES.PROJECT_DETAIL,
      projectId: project.id,
    }),
  );
  localStorage.setItem(
    PROJECT_CREATE_SEED_KEY,
    JSON.stringify({
      projectId: project.id,
      customerId: customer.id,
      projectName: project.projectName,
      customerName: customer.name,
      siteAddress: project.siteAddress,
    }),
  );
}

describe("EstimateForm invoice edit fallback", () => {
  let alertSpy;

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    mockInitialState = null;
    mockSuppressReplaceState = false;
    alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    normalizeScopeImageForStorage.mockReset();
  });

  afterEach(() => {
    alertSpy.mockRestore();
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
    expect(screen.queryByRole("button", { name: /^Estimate$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Invoice$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/^Scope$/i)).toBeInTheDocument();
    expect(screen.getByText("Scope of Work")).toBeInTheDocument();
  });

  test("shows Start Here for seeded new estimate flow while keeping project and customer context linked", async () => {
    const customer = createCustomer();
    const project = createProject();
    mockInitialState = clone(DEFAULT_STATE);

    seedProjectCreateSeed({ project, customer });

    render(<EstimateForm />);

    await screen.findByText("Estimate Builder");

    expect(screen.getByText("New estimate for", { exact: false })).toBeInTheDocument();
    expect(screen.getAllByText(project.projectName).length).toBeGreaterThan(0);
    expect(screen.getAllByText(customer.name).length).toBeGreaterThan(0);
    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(screen.getByText(/^Project$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Scope$/i)).toBeInTheDocument();
    expect(screen.getByText(/Linked customer:/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(project.projectName)).toBeInTheDocument();
    expectTradeScopeStarterUiAbsent();
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

    renderEstimateFormInStrictMode();

    await screen.findByText("EDIT ESTIMATE");

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(screen.getByText(/^Scope$/i)).toBeInTheDocument();
    expectTradeScopeStarterUiAbsent();
  });

  test("hydrates a valid saved estimate edit target with labor and materials intact", async () => {
    const customer = createCustomer();
    const scopeImages = createScopeImages(8);
    const savedEstimate = createSavedEstimate({
      customer: {
        ...createCustomer(),
        projectName: "Restored Guest Bath Refresh",
        projectSameAsCustomer: false,
      },
      labor: {
        lines: [createLaborLine({
          role: "Electrician",
          label: "Electrician",
          qty: "2",
          hours: "40",
          rate: "145.75",
          trueRateInternal: "60",
        })],
        hazardPct: 1,
        riskPct: 1,
        multiplier: 1.08,
      },
      materials: {
        items: [
          {
            id: "mat_restore_1",
            desc: "LED fixture",
            qty: "3",
            unitCostInternal: "85",
            costInternal: "255",
            priceEach: "145",
          },
        ],
        markupPct: 0,
        blanketCost: "",
        blanketInternalCost: "",
        materialsBlanketDescription: "",
      },
      ui: {
        docType: "estimate",
        materialsMode: "itemized",
      },
      scopeNotes: "Repair guest bath finishes.\n[scope-image:scope-image-1]\n[scope-image:scope-image-8]",
      scopeImages,
    });
    mockInitialState = clone(DEFAULT_STATE);

    seedEstimateStorage({
      estimate: savedEstimate,
      customer,
      editEstimateTargetId: savedEstimate.id,
    });

    renderEstimateFormInStrictMode();

    await screen.findByText("EDIT ESTIMATE");

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("Invoice Verify Customer");
    });

    expect(screen.getByText("Scope photos: 8 of 8 used — remove a photo before adding another.")).toBeInTheDocument();
    expect(screen.getByAltText("Reference Photo 1.jpg")).toHaveAttribute("src", scopeImages[0].dataUrl);
    expect(screen.getByAltText("Reference Photo 8.jpg")).toHaveAttribute("src", scopeImages[7].dataUrl);

    const replaceStateCall = mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1] || [];
    const hydratedState = replaceStateCall[0] || {};

    expect(hydratedState.labor).toEqual(expect.objectContaining({
      hazardPct: 1,
      riskPct: 1,
      multiplier: 1.08,
      lines: [
        expect.objectContaining({
          role: "Electrician",
          label: "Electrician",
          qty: "2",
          hours: "40",
          rate: "145.75",
          trueRateInternal: "60",
        }),
      ],
    }));
    expect(hydratedState.materials).toEqual(expect.objectContaining({
      markupPct: 0,
      items: [
        expect.objectContaining({
          desc: "LED fixture",
          qty: "3",
          unitCostInternal: "85",
          costInternal: "255",
          priceEach: "145",
        }),
      ],
    }));
    expect(hydratedState.ui).toEqual(expect.objectContaining({ docType: "estimate", materialsMode: "itemized" }));
    expect(hydratedState.scopeImages).toEqual(scopeImages);
  });

  test("does not show Trade Scope Starter in new estimate or new invoice builder modes", async () => {
    const estimateState = clone(DEFAULT_STATE);
    estimateState.ui = {
      ...(estimateState.ui || {}),
      docType: "estimate",
      materialsMode: "blanket",
    };
    mockInitialState = estimateState;

    const { unmount } = render(<EstimateForm />);

    await screen.findByText("Estimate Builder");
    expectTradeScopeStarterUiAbsent();

    const invoiceState = clone(DEFAULT_STATE);
    invoiceState.ui = {
      ...(invoiceState.ui || {}),
      docType: "invoice",
      materialsMode: "blanket",
    };
    mockInitialState = invoiceState;

    unmount();
    render(<EstimateForm />);

    await screen.findByText("Invoice Builder");
    expectTradeScopeStarterUiAbsent();
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
      expect(screen.getByPlaceholderText("Job / Work Title (optional)")).toHaveValue("");
      expect(screen.getByPlaceholderText("Hours")).toHaveValue("");
      expect(screen.getByPlaceholderText("Rate ($/hr)")).toHaveValue("");
    });

    const replaceStateCall = mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1] || [];
    const fallbackState = replaceStateCall[0] || {};

    expect(fallbackState.ui).toEqual(expect.objectContaining({ docType: "invoice", materialsMode: "blanket" }));
    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE)).toBeNull();
  });

  test("recovers restored estimate labor and materials from the saved edit target when a blank draft would otherwise win", async () => {
    const customer = createCustomer();
    const savedEstimate = createSavedEstimate({
      customer: {
        ...createCustomer(),
        projectName: "Hilton Guest Bath Refresh",
        projectSameAsCustomer: false,
      },
      labor: {
        lines: [
          createLaborLine({
            id: "restored_labor_1",
            role: "Electrician",
            label: "Electrician",
            qty: "2",
            hours: "40",
            rate: "145.75",
            trueRateInternal: "60",
          }),
        ],
        hazardPct: 1,
        riskPct: 1,
        multiplier: 1.08,
      },
      materials: {
        items: [
          {
            id: "restored_material_1",
            desc: "Vanity light",
            qty: "2",
            unitCostInternal: "70",
            costInternal: "140",
            priceEach: "135",
          },
        ],
        markupPct: 0,
        blanketCost: "",
        blanketInternalCost: "",
        materialsBlanketDescription: "",
      },
      ui: {
        docType: "estimate",
        materialsMode: "itemized",
      },
    });
    const blankEstimateState = clone(DEFAULT_STATE);
    blankEstimateState.ui = {
      ...(blankEstimateState.ui || {}),
      docType: "estimate",
      materialsMode: "blanket",
    };
    blankEstimateState.meta = {
      ...(blankEstimateState.meta || {}),
      savedDocId: savedEstimate.id,
    };
    mockInitialState = blankEstimateState;
    mockSuppressReplaceState = true;

    seedEstimateStorage({
      estimate: savedEstimate,
      customer,
      editEstimateTargetId: savedEstimate.id,
    });

    renderEstimateFormInStrictMode();

    await screen.findByText("EDIT ESTIMATE");

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("Invoice Verify Customer");
      expect(screen.getByText("#EST-2001")).toBeInTheDocument();
    });

    expect(mockPatch).toHaveBeenCalledWith("ui.materialsMode", "itemized");
    expect(mockPatch).toHaveBeenCalledWith("materials.items", [
      expect.objectContaining({
        id: "restored_material_1",
        desc: "Vanity light",
        qty: "2",
        unitCostInternal: "70",
        costInternal: "140",
        priceEach: "135",
      }),
    ]);
    expect(mockPatch).toHaveBeenCalledWith("materials.markupPct", 0);
    expect(mockPatch).toHaveBeenCalledWith("materials.blanketCost", "");
    expect(mockPatch).toHaveBeenCalledWith("materials.blanketInternalCost", "");
    expect(mockPatch).toHaveBeenCalledWith("materials.materialsBlanketDescription", "");
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

    renderEstimateFormInStrictMode();

    await screen.findByText("EDIT INVOICE");

    await waitFor(() => {
      expect(screen.queryByText("Invoice not found. Switched to new mode.")).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("Invoice Verify Customer");
      expect(screen.getByPlaceholderText("Job / Work Title (optional)")).toHaveValue("Invoice Verify Project");
    });

    expect(screen.queryByText("Start here")).not.toBeInTheDocument();
    expectTradeScopeStarterUiAbsent();
    expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();

    const replaceStateCall = mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1] || [];
    const hydratedState = replaceStateCall[0] || {};

    expect(hydratedState.meta).toEqual(expect.objectContaining({ savedDocId: savedInvoice.id }));
    expect(hydratedState.ui).toEqual(expect.objectContaining({ docType: "invoice" }));
    expectDisplayedInvoiceTotal("$300.00");
  });

  test("hydrates a thin restored invoice edit target into populated invoice builder data", async () => {
    const customer = createCustomer();
    const project = createProject();
    const restoredInvoice = {
      id: "sample_invoice_hilton_mobilization_deposit",
      customerId: customer.id,
      projectId: project.id,
      sourceEstimateId: "est_1",
      invoiceNumber: "INV-2601",
      status: "sent",
      paymentStatus: "partial",
      invoiceTotal: 1000,
      amountPaid: 250,
      balanceRemaining: 750,
      date: "2026-01-01",
      dueDate: "2026-02-01",
      notes: "Mobilization deposit for the Hilton refresh.",
      lineItems: [
        {
          id: "invoice:inv_1:line:0",
          description: "Mobilization deposit",
          quantity: 1,
          unit: "ea",
          price: 750,
          total: 750,
        },
        {
          id: "invoice:inv_1:line:1",
          description: "Permits",
          quantity: 1,
          unit: "ea",
          price: 250,
          total: 250,
        },
      ],
      payments: [
        {
          id: "pay_1",
          amount: 250,
          method: "cash",
          status: "paid",
          paidAt: "2026-01-15",
        },
      ],
    };
    mockInitialState = clone(DEFAULT_STATE);

    seedInvoiceStorage({
      invoice: restoredInvoice,
      customer,
      project,
      editInvoiceTargetId: restoredInvoice.id,
    });

    renderEstimateFormInStrictMode();

    await screen.findByText("EDIT INVOICE");

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue(customer.name);
      expect(screen.getByPlaceholderText("Job / Work Title (optional)")).toHaveValue(project.projectName);
    });

    const replaceStateCall = mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1] || [];
    const hydratedState = replaceStateCall[0] || {};

    expect(hydratedState.customer).toEqual(expect.objectContaining({
      id: customer.id,
      name: customer.name,
      projectName: project.projectName,
      projectAddress: project.siteAddress,
    }));
    expect(hydratedState.job).toEqual(expect.objectContaining({
      docNumber: "INV-2601",
      location: project.siteAddress,
      projectName: project.projectName,
    }));
    expect(hydratedState.ui).toEqual(expect.objectContaining({
      docType: "invoice",
      materialsMode: "itemized",
    }));
    expect(hydratedState.materials).toEqual(expect.objectContaining({
      items: [
        expect.objectContaining({
          id: "invoice:inv_1:line:0",
          desc: "Mobilization deposit",
          qty: 1,
          priceEach: 750,
          note: "ea",
        }),
        expect.objectContaining({
          id: "invoice:inv_1:line:1",
          desc: "Permits",
          qty: 1,
          priceEach: 250,
          note: "ea",
        }),
      ],
    }));
    expect(hydratedState.invoiceTotal).toBe(1000);
    expect(hydratedState.total).toBe(1000);
    expect(hydratedState.paymentStatus).toBe("partial");
    expect(hydratedState.amountPaid).toBe(250);
    expect(hydratedState.balanceRemaining).toBe(750);
    expect(hydratedState.lineItems).toEqual(restoredInvoice.lineItems);
    expect(hydratedState.payments).toEqual([
      expect.objectContaining({ id: "pay_1", amount: 250, method: "cash" }),
    ]);
    expect(hydratedState.additionalNotes).toBe("Mobilization deposit for the Hilton refresh.");
    expectDisplayedInvoiceTotal("$1,000.00");
  });

  test("hydrates an estimate-created thin invoice with invoiceTotal into a nonzero opened invoice total", async () => {
    const customer = createCustomer();
    const project = createProject();
    const estimateCreatedThinInvoice = {
      id: "invoice_from_estimate_thin",
      invoiceNumber: "INV-EST-560",
      customerId: customer.id,
      projectId: project.id,
      sourceEstimateId: "est_approved_560",
      sourceEstimateSnapshot: {
        estimateId: "est_approved_560",
        estimateNumber: "EST-560",
        customerId: customer.id,
        customerName: customer.name,
        projectId: project.id,
        projectName: project.projectName,
        approvedTotal: 560,
        totalRevenue: 560,
        grandTotal: 560,
        total: 560,
      },
      status: "sent",
      paymentStatus: "unpaid",
      invoiceTotal: 560,
      total: 560,
      amountPaid: 0,
      balanceRemaining: 560,
      date: "2026-06-10",
      dueDate: "2026-06-24",
      notes: "Created from approved estimate without stored line rows.",
      payments: [],
    };
    mockInitialState = clone(DEFAULT_STATE);

    seedInvoiceStorage({
      invoice: estimateCreatedThinInvoice,
      customer,
      project,
      editInvoiceTargetId: estimateCreatedThinInvoice.id,
    });

    renderEstimateFormInStrictMode();

    await screen.findByText("EDIT INVOICE");

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue(customer.name);
      expect(screen.getByPlaceholderText("Job / Work Title (optional)")).toHaveValue(project.projectName);
    });

    const replaceStateCall = mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1] || [];
    const hydratedState = replaceStateCall[0] || {};

    expect(hydratedState.invoiceTotal).toBe(560);
    expect(hydratedState.total).toBe(560);
    expect(hydratedState.paymentStatus).toBe("unpaid");
    expect(hydratedState.amountPaid).toBe(0);
    expect(hydratedState.balanceRemaining).toBe(560);
    expectDisplayedInvoiceTotal("$560.00");
  });

  test("old saved estimate and invoice records with trade starter data still load safely without showing the starter UI", async () => {
    const customer = createCustomer();
    const savedEstimate = createSavedEstimate({
      tradeInsert: { key: "painting", text: "Trade Insert: Painting\n- Mask surfaces\n- Apply finish coats" },
      scopeNotes: "Repair wall damage in lobby.\n\nTrade Insert: Painting\n- Mask surfaces\n- Apply finish coats",
    });
    mockInitialState = clone(DEFAULT_STATE);

    seedEstimateStorage({
      estimate: savedEstimate,
      customer,
      editEstimateTargetId: savedEstimate.id,
    });

    const { unmount } = renderEstimateFormInStrictMode();

    await screen.findByText("EDIT ESTIMATE");
    expect(screen.getAllByText(/Repair wall damage in lobby/i).length).toBeGreaterThan(0);
    expectTradeScopeStarterUiAbsent();

    const savedInvoice = createSavedInvoice({
      tradeInsert: { key: "painting", text: "Trade Insert: Painting\n- Mask surfaces\n- Apply finish coats" },
      scopeNotes: "Invoice scope text retained for reference.",
    });
    mockInitialState = clone(savedInvoice);
    localStorage.clear();

    seedInvoiceStorage({
      invoice: savedInvoice,
      customer,
      editInvoiceTargetId: savedInvoice.id,
    });

    unmount();
    renderEstimateFormInStrictMode();

    await screen.findByText(/Invoice Builder|EDIT INVOICE/);
    expectTradeScopeStarterUiAbsent();
  });

  test("hydrates saved invoice labor into invoice edit mode", async () => {
    const customer = createCustomer();
    const savedInvoice = createSavedInvoice({
      labor: {
        lines: [createLaborLine({ role: "carpenter", label: "Carpenter", qty: "2", hours: "5", rate: "72" })],
        hazardPct: 5,
        riskPct: 3,
        multiplier: 1.15,
      },
    });
    mockInitialState = clone(DEFAULT_STATE);

    seedInvoiceStorage({
      invoice: savedInvoice,
      customer,
      editInvoiceTargetId: savedInvoice.id,
    });

    renderEstimateFormInStrictMode();

    await screen.findByText("EDIT INVOICE");

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Job / Work Title (optional)")).toHaveValue("Invoice Verify Project");
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("Invoice Verify Customer");
    });

    const replaceStateCall = mockReplaceState.mock.calls[mockReplaceState.mock.calls.length - 1] || [];
    const hydratedState = replaceStateCall[0] || {};
    expect(hydratedState.labor).toEqual(expect.objectContaining({
      hazardPct: 5,
      riskPct: 3,
      multiplier: 1.15,
      lines: [
        expect.objectContaining({
          role: "carpenter",
          label: "Carpenter",
          hours: "5",
          rate: "72",
          trueRateInternal: "77",
          qty: "2",
        }),
      ],
    }));
  });

  test("exports saved paid invoice data when edit-mode invoice state is blank", async () => {
    const customer = createCustomer();
    const savedInvoice = createSavedInvoice({
      status: "paid",
      paymentStatus: "paid",
      amountPaid: 300,
      balanceRemaining: 0,
      additionalNotes: "Paid in full by ACH.",
      materials: {
        items: [
          {
            id: "mat_paid_1",
            desc: "Finish materials",
            note: "Primer and paint",
            qty: "3",
            priceEach: "100",
          },
        ],
        markupPct: 0,
        materialsBlanketDescription: "",
      },
      additionalCharges: {
        items: [
          {
            id: "charge_paid_1",
            desc: "Emergency Sunday Call",
            qty: "1",
            priceEach: "350",
          },
        ],
      },
      ui: {
        docType: "invoice",
        materialsMode: "itemized",
      },
      payments: [
        {
          id: "pay_1",
          amount: 300,
          method: "ach",
          receivedAt: "2026-05-10",
        },
      ],
    });
    const blankInvoiceState = clone(DEFAULT_STATE);
    blankInvoiceState.ui = {
      ...(blankInvoiceState.ui || {}),
      docType: "invoice",
      materialsMode: "blanket",
    };
    blankInvoiceState.meta = {
      ...(blankInvoiceState.meta || {}),
      savedDocId: savedInvoice.id,
    };
    mockInitialState = blankInvoiceState;
    mockSuppressReplaceState = true;

    seedInvoiceStorage({
      invoice: savedInvoice,
      customer,
      editInvoiceTargetId: savedInvoice.id,
    });

    renderEstimateFormInStrictMode();

    await screen.findByText("EDIT INVOICE");

    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    fireEvent.click(await screen.findByRole("button", { name: /download pdf/i }));

    await waitFor(() => expect(mockExportPdf).toHaveBeenCalledTimes(1));

    const [payload, mode] = mockExportPdf.mock.calls[0];
    const summaryValues = Object.fromEntries(payload.summaryRows || []);

    expect(mode).toBe("download");
    expect(payload.docType).toBe("invoice");
    expect(payload.documentNumber).toBe("INV-1001");
    expect(payload.invoiceStatus).toBe("paid");
    expect(payload.paymentStatus).toBe("paid");
    expect(payload.customer).toEqual(expect.objectContaining({ name: "Invoice Verify Customer" }));
    expect(payload.job).toEqual(expect.objectContaining({
      projectName: "Invoice Verify Project",
      poNumber: "PO-INV-1",
    }));
    expect(payload.additionalNotes).toBe("Paid in full by ACH.");
    expect(payload.materialsMode).toBe("itemized");
    expect(payload.materialRows).toEqual(expect.arrayContaining([
      expect.objectContaining({
        desc: "Finish materials",
        note: "Primer and paint",
        total: "$300.00",
      }),
    ]));
    expect(payload.additionalChargeRows).toEqual([
      expect.objectContaining({
        desc: "Emergency Sunday Call",
        total: "$350.00",
      }),
    ]);
    expect(summaryValues["Grand Total"]).toBe("$1,757.00");
    expect(summaryValues.Materials).toBe("$300.00");
    expect(summaryValues["Additional Charges"]).toBe("$350.00");
  }, 15000);

  test("estimate PDF export removes the dedicated trade starter payload while preserving actual scope text", async () => {
    const customer = createCustomer();
    const scopeImages = createScopeImages(2);
    const savedEstimate = createSavedEstimate({
      scopeNotes: [
        "Repair wall damage in the lobby and repaint affected areas.",
        "",
        "[scope-image:scope-image-1]",
        "Trade Insert: Painting",
        "- Mask surfaces",
        "- Apply finish coats",
        "[scope-image:scope-image-2]",
      ].join("\n"),
      tradeInsert: {
        key: "painting",
        text: "Trade Insert: Painting\n- Mask surfaces\n- Apply finish coats",
      },
      additionalNotes: "Night work by request.",
      scopeImages,
    });
    mockInitialState = clone(savedEstimate);

    seedEstimateStorage({
      estimate: savedEstimate,
      customer,
      editEstimateTargetId: savedEstimate.id,
    });

    renderEstimateFormInStrictMode();

    await screen.findByText("EDIT ESTIMATE");

    fireEvent.click(screen.getByRole("button", { name: /export pdf/i }));
    fireEvent.click(await screen.findByRole("button", { name: /download pdf/i }));

    await waitFor(() => expect(mockExportPdf).toHaveBeenCalledTimes(1));

    const [payload, mode] = mockExportPdf.mock.calls[0];

    expect(mode).toBe("download");
    expect(payload.docType).toBe("estimate");
    expect(payload.tradeInsertText).toBeUndefined();
    expect(payload.scopeNotes).toContain("Repair wall damage in the lobby and repaint affected areas.");
    expect(payload.scopeNotes).toContain("[scope-image:scope-image-1]");
    expect(payload.scopeNotes).not.toMatch(/Trade Insert:/i);
    expect(payload.additionalNotes).toBe("Night work by request.");
    expect(payload.scopeImages).toEqual(scopeImages);
  });

  test("stores compressed scope photo metadata and inserts its marker into scope notes", async () => {
    mockInitialState = clone(DEFAULT_STATE);
    normalizeScopeImageForStorage.mockResolvedValue({
      mimeType: "image/jpeg",
      dataUrl: "data:image/jpeg;base64,compressed-scope-photo",
      originalSizeBytes: 2400000,
      storedSizeBytes: 140000,
      originalWidth: 4032,
      originalHeight: 3024,
      storedWidth: 1024,
      storedHeight: 768,
    });

    renderEstimateFormInStrictMode();

    await screen.findByText("Estimate Builder");

    const input = getScopeImageInput();
    const file = new File(["raw-photo"], "Lobby Damage.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 2400000 });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(normalizeScopeImageForStorage).toHaveBeenCalledWith(file);
    });

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("scopeNotes", "[scope-image:scope-image-1]");
      expect(mockPatch).toHaveBeenCalledWith("scopeImages", [
        expect.objectContaining({
          id: "scope-image-1",
          name: "Lobby Damage.jpg",
          mimeType: "image/jpeg",
          dataUrl: "data:image/jpeg;base64,compressed-scope-photo",
          storedSizeBytes: 140000,
          storedWidth: 1024,
          storedHeight: 768,
          layout: expect.objectContaining({ size: "medium", align: "center", caption: false }),
        }),
      ]);
      expect(screen.getByText(/Scope photos:\s*1 of 8 used/i)).toBeInTheDocument();
    });
  });

  test("keeps the 8-photo cap when another scope photo is selected", async () => {
    const savedEstimate = createSavedEstimate({
      scopeImages: createScopeImages(8),
      scopeNotes: "Existing scope notes",
    });
    mockInitialState = clone(savedEstimate);

    renderEstimateFormInStrictMode();

    await screen.findByText("Estimate Builder");

    const input = getScopeImageInput();
    const file = new File(["raw-photo"], "Overflow Photo.jpg", { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 1900000 });

    fireEvent.change(input, { target: { files: [file] } });

    expect(normalizeScopeImageForStorage).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith("This document already has 8 scope photos. Remove one before adding another.");
  });

  test("shows a friendly error when scope photo processing fails", async () => {
    mockInitialState = clone(DEFAULT_STATE);
    normalizeScopeImageForStorage.mockRejectedValue(new Error("Could not process this photo. Try another image."));

    renderEstimateFormInStrictMode();

    await screen.findByText("Estimate Builder");

    const input = getScopeImageInput();
    const file = new File(["bad-photo"], "Broken Photo.heic", { type: "image/heic" });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(window.alert).toHaveBeenCalledWith("Could not process this photo. Try another image.");
    });
    expect(mockPatch).not.toHaveBeenCalledWith("scopeImages", expect.anything());
  });

  test("shows a friendly storage-full message when the builder draft cannot persist during save", async () => {
    const estimateState = clone(DEFAULT_STATE);
    estimateState.ui = {
      ...(estimateState.ui || {}),
      docType: "estimate",
      materialsMode: "blanket",
    };
    estimateState.customer = {
      ...(estimateState.customer || {}),
      name: "Quota Customer",
      fullName: "Quota Customer",
      displayName: "Quota Customer",
      projectName: "Quota Project",
      projectNumber: "QT-1001",
    };
    estimateState.job = {
      ...(estimateState.job || {}),
      date: "2026-06-30",
      docNumber: "EST-QUOTA-1",
    };
    estimateState.scopeNotes = "Document scope with photos.";
    mockInitialState = estimateState;
    mockSaveNow.mockImplementation((metaPatch = {}) => ({
      ...clone(estimateState),
      meta: {
        ...(estimateState.meta || {}),
        ...metaPatch,
        lastSavedAt: FIXED_TIMESTAMP,
      },
    }));

    renderEstimateFormInStrictMode();

    await screen.findByText("Estimate Builder");

    fireEvent.click(screen.getByRole("button", { name: /save estimate/i }));

    expect(await screen.findByText("Storage is full. Remove some photos or templates and try again.")).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("failed new estimate save keeps the chambered draft and resume state intact", async () => {
    const estimateState = clone(DEFAULT_STATE);
    estimateState.ui = {
      ...(estimateState.ui || {}),
      docType: "estimate",
      materialsMode: "blanket",
    };
    estimateState.customer = {
      ...(estimateState.customer || {}),
      name: "Failed Save Customer",
      fullName: "Failed Save Customer",
      displayName: "Failed Save Customer",
      projectName: "Failed Save Project",
      projectNumber: "FS-1001",
    };
    estimateState.job = {
      ...(estimateState.job || {}),
      date: "2026-07-01",
      docNumber: "EST-FAIL-1",
    };
    estimateState.scopeNotes = "This draft should remain available after a failed save.";
    mockInitialState = estimateState;
    const draftRaw = JSON.stringify(estimateState);
    localStorage.setItem(STORAGE_KEY, draftRaw);
    localStorage.setItem(STORAGE_KEYS.ESTIMATE_DRAFT, draftRaw);
    localStorage.setItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE, "1");
    mockSaveNow.mockImplementation((metaPatch = {}) => ({
      ...clone(estimateState),
      meta: {
        ...(estimateState.meta || {}),
        ...metaPatch,
        lastSavedAt: FIXED_TIMESTAMP,
      },
    }));

    renderEstimateFormInStrictMode();

    await screen.findByText("Estimate Builder");

    const actualSetItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(function setItemWithQuota(key, value) {
      if (key === STORAGE_KEYS.ESTIMATES) {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      return actualSetItem.call(this, key, value);
    });

    fireEvent.click(screen.getByRole("button", { name: /save estimate/i }));

    expect(await screen.findByText("Storage is full. Remove some photos or templates and try again.")).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(draftRaw);
    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATE_DRAFT)).toBe(draftRaw);
    expect(localStorage.getItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE)).toBe("1");
  });

  test("shows a friendly storage-full message when updating an estimate hits localStorage quota", async () => {
    const customer = createCustomer();
    const savedEstimate = createSavedEstimate({
      scopeNotes: "Existing saved estimate scope.",
    });
    mockInitialState = clone(savedEstimate);
    mockSaveNow.mockImplementation((metaPatch = {}) => ({
      ...clone(savedEstimate),
      meta: {
        ...(savedEstimate.meta || {}),
        ...metaPatch,
        lastSavedAt: FIXED_TIMESTAMP,
      },
    }));

    seedEstimateStorage({
      estimate: savedEstimate,
      customer,
      editEstimateTargetId: savedEstimate.id,
    });

    renderEstimateFormInStrictMode();

    await screen.findByRole("button", { name: /save estimate|update estimate/i });

    const actualSetItem = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(function setItemWithQuota(key, value) {
      if (key === STORAGE_KEYS.ESTIMATES) {
        throw new DOMException("quota exceeded", "QuotaExceededError");
      }
      return actualSetItem.call(this, key, value);
    });

    fireEvent.click(screen.getByRole("button", { name: /save estimate|update estimate/i }));

    expect(await screen.findByText("Storage is full. Remove some photos or templates and try again.")).toBeInTheDocument();
  });
});
