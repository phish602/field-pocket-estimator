import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";

jest.mock("./utils/guards", () => ({
  requireCompanyProfile: () => ({ allowed: true }),
}));

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
import { STORAGE_KEYS } from "./constants/storageKeys";
import { DEFAULT_STATE } from "./estimator/defaultState";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildLiveDraftA() {
  const state = clone(DEFAULT_STATE);
  state.ui = { ...state.ui, docType: "estimate", materialsMode: "itemized" };
  state.scopeNotes = "Draft A scope: repair fence and gate hardware.";
  state.customer = {
    ...state.customer,
    id: "cust_draft_a",
    name: "Draft A Customer",
    fullName: "Draft A Customer",
    displayName: "Draft A Customer",
    address: "1 Draft A Way",
    city: "Phoenix",
    state: "AZ",
    zip: "85001",
    projectName: "Draft A Project",
    projectNumber: "DRAFT-A-1",
    projectAddress: "1 Draft A Way",
    projectSameAsCustomer: false,
  };
  state.job = { ...state.job, location: "Draft A Site", docNumber: "" };
  state.labor = {
    ...state.labor,
    lines: [
      {
        id: "draft_a_labor_1",
        role: "tech",
        label: "Technician",
        hours: "3",
        rate: "70",
        trueRateInternal: "40",
        internalRate: "40",
        qty: "1",
        markupPct: "12",
      },
    ],
  };
  state.materials = {
    ...state.materials,
    items: [
      {
        id: "draft_a_material_1",
        desc: "Draft A fence hardware",
        qty: "1",
        unitCostInternal: "15",
        costInternal: "15",
        priceEach: "25",
      },
    ],
  };
  state.additionalCharges = {
    items: [
      { id: "draft_a_charge_1", desc: "Draft A trip fee", qty: "1", priceEach: "40" },
    ],
  };
  return state;
}

function createCustomerB() {
  return {
    id: "cust_estimate_b",
    name: "Estimate B Customer",
    fullName: "Estimate B Customer",
    displayName: "Estimate B Customer",
    customerType: "residential",
    projectName: "Estimate B Project",
    projectNumber: "PRJ-B-1",
    projectAddress: "2 Estimate B Ave",
    address: "2 Estimate B Ave",
    city: "Phoenix",
    state: "AZ",
    zip: "85001",
  };
}

function createSavedEstimateB(customer) {
  return {
    id: "saved_estimate_b",
    docType: "estimate",
    status: "pending",
    estimateNumber: "EST-B-1",
    customerId: customer.id,
    customerName: customer.name,
    projectId: "proj_estimate_b",
    projectName: customer.projectName,
    projectNumber: customer.projectNumber,
    total: 500,
    grandTotal: 500,
    totalRevenue: 500,
    customer: { ...customer },
    job: {
      docNumber: "EST-B-1",
      date: "2026-05-03",
      due: "2026-05-17",
      location: customer.projectAddress,
      poNumber: "PO-EST-B-1",
    },
    scopeNotes: "Estimate B scope: repaint kitchen cabinets.",
    ui: { docType: "estimate", materialsMode: "itemized" },
    labor: {
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
      lines: [
        {
          id: "estimate_b_labor_1",
          role: "painter",
          label: "Painter",
          hours: "6",
          rate: "65",
          trueRateInternal: "40",
          internalRate: "40",
          qty: "1",
          markupPct: "12",
        },
      ],
    },
    materials: {
      blanketCost: "",
      blanketInternalCost: "",
      materialsBlanketDescription: "",
      markupPct: 0,
      items: [
        {
          id: "estimate_b_material_1",
          desc: "Estimate B cabinet paint",
          qty: "2",
          unitCostInternal: "20",
          costInternal: "40",
          priceEach: "55",
        },
      ],
    },
    additionalCharges: { items: [] },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    savedAt: Date.now(),
  };
}

function seedSession({ draftA, customerB, estimateB }) {
  localStorage.clear();
  if (draftA) {
    localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify(draftA));
  }
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([customerB]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([estimateB]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));
  localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
  localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
}

function readStoredEstimatorState() {
  const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE) || "";
  return { raw, parsed: raw ? JSON.parse(raw) : null };
}

function readStoredEstimates() {
  const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATES) || "[]";
  return JSON.parse(raw);
}

async function openEstimateBForEdit(customerB) {
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: /^Estimates$/i }));
  await screen.findByText(customerB.projectName);

  fireEvent.click(screen.getByRole("button", { name: /^Open$/i }));
  await screen.findByText("EDIT ESTIMATE");
}

describe("App live draft vs saved-estimate edit-session isolation", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test("saving an edited saved estimate does not overwrite the chambered live draft", async () => {
    const draftA = buildLiveDraftA();
    const customerB = createCustomerB();
    const estimateB = createSavedEstimateB(customerB);
    seedSession({ draftA, customerB, estimateB });

    await openEstimateBForEdit(customerB);

    // Live draft must still be untouched while the edit session is open.
    expect(readStoredEstimatorState().raw).toBe(JSON.stringify(draftA));

    fireEvent.click(screen.getByRole("button", { name: /^Update Estimate$/i }));

    await screen.findByText(/Updated/i);

    // Give the deferred navigate-away (180ms) and any stray autosave window
    // (350ms debounce) time to play out before asserting final state.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    await waitFor(() => {
      expect(screen.queryByText("EDIT ESTIMATE")).not.toBeInTheDocument();
    });

    const updatedEstimates = readStoredEstimates();
    const updatedB = updatedEstimates.find((entry) => entry.id === "saved_estimate_b");
    expect(updatedB).toBeTruthy();

    const finalDraft = readStoredEstimatorState();
    expect(finalDraft.parsed?.customer?.name).toBe("Draft A Customer");
    expect(finalDraft.parsed?.scopeNotes).toBe(draftA.scopeNotes);
    expect(finalDraft.raw).not.toContain("Estimate B Customer");
    expect(finalDraft.raw).not.toContain("Estimate B cabinet paint");

    expect(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY)).toBeNull();
  });

  test("canceling an edited saved estimate still preserves the chambered live draft", async () => {
    const draftA = buildLiveDraftA();
    const customerB = createCustomerB();
    const estimateB = createSavedEstimateB(customerB);
    seedSession({ draftA, customerB, estimateB });

    await openEstimateBForEdit(customerB);

    window.confirm = jest.fn(() => true);
    fireEvent.click(screen.getByRole("button", { name: /^Cancel Edit$/i }));

    await waitFor(() => {
      expect(screen.queryByText("EDIT ESTIMATE")).not.toBeInTheDocument();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    const finalDraft = readStoredEstimatorState();
    expect(finalDraft.parsed?.customer?.name).toBe("Draft A Customer");
    expect(finalDraft.raw).toBe(JSON.stringify(draftA));
    expect(localStorage.getItem(EDIT_ESTIMATE_TARGET_KEY)).toBeNull();
  });

  test("saving a saved estimate edit with no prior live draft leaves a clean default draft", async () => {
    const customerB = createCustomerB();
    const estimateB = createSavedEstimateB(customerB);
    seedSession({ draftA: null, customerB, estimateB });

    await openEstimateBForEdit(customerB);

    fireEvent.click(screen.getByRole("button", { name: /^Update Estimate$/i }));
    await screen.findByText(/Updated/i);

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    const finalDraft = readStoredEstimatorState();
    if (finalDraft.raw) {
      expect(finalDraft.raw).not.toContain("Estimate B cabinet paint");
      expect(finalDraft.raw).not.toContain("Estimate B Customer");
    }
  });
});

describe("App Clear Draft cleanup", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  test("Clear fully resets customer/project/job identity and the persisted live draft", async () => {
    const seededDraft = buildLiveDraftA();
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify(seededDraft));
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([]));
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));
    const launcher = await screen.findByRole("dialog", { name: /Start New/i });
    fireEvent.click(within(launcher).getByRole("button", { name: /^Estimate$|^Resume Estimate Draft$/i }));
    await screen.findByText("Estimate Builder");

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("Draft A Customer");
    });

    window.confirm = jest.fn(() => true);
    fireEvent.click(screen.getByRole("button", { name: /^Clear$/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("");
    });
    expect(screen.queryByText("Draft A fence hardware")).not.toBeInTheDocument();

    const clearedRaw = localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE);
    if (clearedRaw) {
      expect(clearedRaw).not.toContain("Draft A Customer");
      expect(clearedRaw).not.toContain("Draft A Project");
      expect(clearedRaw).not.toContain("Draft A fence hardware");
    }

    // Leave Create and come back — the old customer must not resurrect.
    fireEvent.click(screen.getByRole("button", { name: /^Estimates$/i }));
    await screen.findByText(/Saved Estimates/i);

    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));
    const reopenedLauncher = await screen.findByRole("dialog", { name: /Start New/i });
    fireEvent.click(within(reopenedLauncher).getByRole("button", { name: /^Estimate$|^Resume Estimate Draft$/i }));
    await screen.findByText("Estimate Builder");

    await waitFor(() => {
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue("");
    });
    expect(screen.queryByText(/Draft A Customer/i)).not.toBeInTheDocument();
  });
});
