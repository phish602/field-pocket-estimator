import React from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const EDIT_ESTIMATE_TARGET_KEY = "estipaid-edit-estimate-target-v1";
const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const ACTIVE_EDIT_CONTEXT_KEY = "estipaid-active-edit-context-v1";

const mockPatch = jest.fn();
const mockReplaceState = jest.fn();
const mockSaveNow = jest.fn();

jest.mock("./utils/guards", () => ({
  requireCompanyProfile: () => ({ allowed: true }),
}));

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
      return normalizeState(parsed);
    } catch {
      return normalizeState();
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
import { STORAGE_KEYS } from "./constants/storageKeys";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createCustomer({
  id,
  name,
  projectName,
  projectNumber,
  address,
}) {
  return {
    id,
    name,
    fullName: name,
    displayName: name,
    customerType: "residential",
    projectName,
    projectNumber,
    projectAddress: address,
    address,
    city: "Phoenix",
    state: "AZ",
    zip: "85001",
  };
}

function createEstimate({
  id,
  status = "pending",
  estimateNumber,
  projectId,
  customer,
  scopeNotes,
  materialsMode,
  total,
  laborLine,
  materialItem,
  blanketMaterials,
  additionalChargeItems = [],
}) {
  const siteAddress = customer.projectAddress || customer.address || "";
  const additionalChargesRevenue = additionalChargeItems.reduce((sum, item) => (
    sum + ((Number(item?.qty) || 0) * (Number(item?.priceEach) || 0))
  ), 0);

  return {
    id,
    docType: "estimate",
    status,
    estimateNumber,
    customerId: customer.id,
    customerName: customer.name,
    projectId,
    projectName: customer.projectName,
    projectNumber: customer.projectNumber,
    total,
    grandTotal: total,
    totalRevenue: total,
    additionalChargesRevenue,
    customer: {
      ...customer,
      id: customer.id,
      name: customer.name,
      projectName: customer.projectName,
      projectNumber: customer.projectNumber,
      projectAddress: siteAddress,
      address: customer.address || siteAddress,
    },
    job: {
      docNumber: estimateNumber,
      date: "2026-05-03",
      due: "2026-05-17",
      location: siteAddress,
      poNumber: `PO-${estimateNumber}`,
    },
    scopeNotes,
    ui: {
      docType: "estimate",
      materialsMode,
    },
    labor: {
      hazardPct: 0,
      riskPct: 0,
      multiplier: 1,
      lines: [clone(laborLine)],
    },
    materials: materialsMode === "itemized"
      ? {
        blanketCost: "",
        blanketInternalCost: "",
        materialsBlanketDescription: "",
        markupPct: 0,
        items: [clone(materialItem)],
      }
      : {
        blanketCost: blanketMaterials.blanketCost,
        blanketInternalCost: blanketMaterials.blanketInternalCost,
        materialsBlanketDescription: blanketMaterials.materialsBlanketDescription,
        markupPct: blanketMaterials.markupPct,
        items: [clone(blanketMaterials.item)],
      },
    additionalCharges: {
      items: additionalChargeItems.map((item) => clone(item)),
    },
  };
}

function createLinkedInvoice({
  id,
  invoiceNumber,
  estimate,
  customer,
  invoiceTotal,
  status = "draft",
}) {
  const siteAddress = customer.projectAddress || customer.address || "";
  const total = invoiceTotal ?? estimate.total;
  const timestamp = 1714694400000;

  return {
    id,
    docType: "invoice",
    status,
    invoiceNumber,
    invoiceTotal: total,
    total,
    customerId: customer.id,
    customerName: customer.name,
    projectId: estimate.projectId,
    projectName: customer.projectName,
    projectNumber: customer.projectNumber,
    sourceEstimateId: estimate.id,
    sourceEstimateSnapshot: {
      estimateId: estimate.id,
      estimateNumber: estimate.estimateNumber,
      customerId: customer.id,
      customerName: customer.name,
      projectId: estimate.projectId,
      projectName: customer.projectName,
      projectNumber: customer.projectNumber,
      approvedTotal: estimate.total,
      siteAddress,
    },
    customer: {
      ...customer,
      id: customer.id,
      name: customer.name,
      projectName: customer.projectName,
      projectNumber: customer.projectNumber,
      projectAddress: siteAddress,
      address: customer.address || siteAddress,
    },
    job: {
      docNumber: invoiceNumber,
      date: "2026-05-03",
      due: "2026-05-17",
      location: siteAddress,
    },
    ui: {
      docType: "invoice",
      materialsMode: estimate?.ui?.materialsMode === "blanket" ? "blanket" : "itemized",
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    savedAt: timestamp,
    ts: timestamp,
  };
}

function seedEstimateSession({ estimate, customer, invoices = [] }) {
  localStorage.clear();
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([customer]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([estimate]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify(invoices));
  localStorage.removeItem(STORAGE_KEYS.ESTIMATOR_STATE);
  localStorage.removeItem(STORAGE_KEYS.ESTIMATE_DRAFT);
  localStorage.removeItem(STORAGE_KEYS.RESTORE_DRAFT_ON_CREATE);
  localStorage.removeItem(EDIT_ESTIMATE_TARGET_KEY);
  localStorage.removeItem(EDIT_INVOICE_TARGET_KEY);
  localStorage.removeItem(ACTIVE_EDIT_CONTEXT_KEY);
}

function readStoredInvoices() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.INVOICES);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStoredEstimates() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ESTIMATES);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function expectEditInvoiceTargetWasSet(setItemSpy, expectedId) {
  const matchingCall = setItemSpy.mock.calls.find(
    ([key, value]) => key === EDIT_INVOICE_TARGET_KEY && value === expectedId
  );
  expect(matchingCall).toBeTruthy();
}

function expectEditInvoiceTargetWasNotSet(setItemSpy) {
  const matchingCall = setItemSpy.mock.calls.find(([key]) => key === EDIT_INVOICE_TARGET_KEY);
  expect(matchingCall).toBeFalsy();
}

async function renderAppOnEstimates(projectName) {
  render(<App />);

  fireEvent.click(screen.getByRole("button", { name: /^Estimates$/i }));

  await screen.findByText(/Saved Estimates/i);
  await screen.findByText(projectName);
}

describe("App approved estimate invoice builder handoff", () => {
  let setItemSpy;

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    setItemSpy = jest.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    setItemSpy.mockRestore();
  });

  test("prompt Yes opens the full invoice builder with a preserved itemized invoice draft", async () => {
    const customer = createCustomer({
      id: "cust_prompt",
      name: "Prompt Customer",
      projectName: "Prompt Itemized Project",
      projectNumber: "P-4301",
      address: "123 Prompt St",
    });
    const estimate = createEstimate({
      id: "est_prompt_itemized",
      status: "pending",
      estimateNumber: "EST-4301",
      projectId: "proj_prompt",
      customer,
      scopeNotes: "Paint the lobby and repair wall damage.",
      materialsMode: "itemized",
      total: 560,
      laborLine: {
        id: "labor_prompt_1",
        role: "painter",
        label: "Painter",
        qty: "2",
        hours: "8",
        rate: "65",
        trueRateInternal: "40",
        internalRate: "40",
        markupPct: "12",
      },
      materialItem: {
        id: "material_prompt_1",
        desc: "Prompt itemized material",
        qty: "5",
        unitCostInternal: "12",
        costInternal: "60",
        priceEach: "20",
        markupPct: "0",
      },
      blanketMaterials: {
        blanketCost: "",
        blanketInternalCost: "",
        materialsBlanketDescription: "",
        markupPct: 0,
        item: { id: "blanket_placeholder", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" },
      },
    });

    seedEstimateSession({ estimate, customer });
    await renderAppOnEstimates(customer.projectName);

    fireEvent.click(screen.getByRole("button", { name: /^Details$/i }));
    await screen.findByRole("button", { name: /Mark Approved/i });

    setItemSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Mark Approved/i }));

    await screen.findByText("Create Invoice?");
    expect(screen.queryByRole("dialog", { name: /Create invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Quick Composer/i)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Yes, Create Invoice/i }));

    await screen.findByRole("heading", { name: /EDIT INVOICE/i });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /Create invoice/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Quick Composer/i)).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue(customer.name);
      expect(screen.getByPlaceholderText("Job / Work Title (optional)")).toHaveValue(customer.projectName);
    });

    const invoices = readStoredInvoices();
    expect(invoices).toHaveLength(1);

    const createdInvoice = invoices[0];
    expect(createdInvoice).toEqual(expect.objectContaining({
      docType: "invoice",
      customerId: customer.id,
      customerName: customer.name,
      projectId: "proj_prompt",
      projectName: customer.projectName,
      sourceEstimateId: estimate.id,
      scopeNotes: estimate.scopeNotes,
    }));
    expect(createdInvoice.ui).toEqual(expect.objectContaining({ docType: "invoice", materialsMode: "itemized" }));
    expect(createdInvoice.sourceEstimateSnapshot).toEqual(expect.objectContaining({
      estimateNumber: estimate.estimateNumber,
      customerId: customer.id,
      customerName: customer.name,
      projectId: "proj_prompt",
      projectName: customer.projectName,
    }));
    expect(createdInvoice.job).toEqual(expect.objectContaining({
      location: estimate.job.location,
    }));

    const createdLaborLine = createdInvoice?.labor?.lines?.[0] || {};
    expect(createdLaborLine).toEqual(expect.objectContaining({
      role: "painter",
      label: "Painter",
    }));
    expect(String(createdLaborLine.qty || "")).toBe("2");
    expect(String(createdLaborLine.hours || "")).toBe("8");
    expect(String(createdLaborLine.rate || "")).toBe("65");
    expect(String(createdLaborLine.trueRateInternal || createdLaborLine.internalRate || "")).toBe("40");
    expect(String(createdLaborLine.markupPct || "")).toBe("12");

    const createdMaterialLine = createdInvoice?.materials?.items?.[0] || {};
    expect(createdMaterialLine).toEqual(expect.objectContaining({
      desc: "Prompt itemized material",
    }));
    expect(String(createdMaterialLine.qty || "")).toBe("5");
    expect(String(createdMaterialLine.unitCostInternal || "")).toBe("12");
    expect(String(createdMaterialLine.costInternal || "")).toBe("60");
    expect(String(createdMaterialLine.priceEach || "")).toBe("20");
    expect(String(createdInvoice?.materials?.materialsBlanketDescription || "")).toBe("");

    expectEditInvoiceTargetWasSet(setItemSpy, createdInvoice.id);
  });

  test("approved bucket Create Invoice opens the full invoice builder with a preserved blanket invoice draft", async () => {
    const customer = createCustomer({
      id: "cust_bucket",
      name: "Bucket Customer",
      projectName: "Bucket Blanket Project",
      projectNumber: "P-4302",
      address: "456 Bucket Ave",
    });
    const estimate = createEstimate({
      id: "est_bucket_blanket",
      status: "approved",
      estimateNumber: "EST-4302",
      projectId: "proj_bucket",
      customer,
      scopeNotes: "Replace damaged fixtures and patch wiring access.",
      materialsMode: "blanket",
      total: 900,
      laborLine: {
        id: "labor_bucket_1",
        role: "electrician",
        label: "Electrician",
        qty: "1",
        hours: "6",
        rate: "95",
        trueRateInternal: "55",
        internalRate: "55",
        markupPct: "12",
      },
      materialItem: {
        id: "material_bucket_placeholder",
        desc: "",
        qty: "",
        unitCostInternal: "",
        costInternal: "",
        priceEach: "",
      },
      blanketMaterials: {
        blanketCost: "330",
        blanketInternalCost: "210",
        materialsBlanketDescription: "Bucket blanket materials",
        markupPct: 0,
        item: {
          id: "material_bucket_placeholder",
          desc: "",
          qty: "",
          unitCostInternal: "",
          costInternal: "",
          priceEach: "",
        },
      },
    });

    seedEstimateSession({ estimate, customer });
    await renderAppOnEstimates(customer.projectName);

    fireEvent.click(screen.getByRole("button", { name: /^Details$/i }));
    await screen.findByRole("button", { name: /Create Invoice/i });

    setItemSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Create Invoice/i }));

    await screen.findByRole("heading", { name: /EDIT INVOICE/i });

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /Create invoice/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/Quick Composer/i)).not.toBeInTheDocument();
      expect(screen.getByPlaceholderText("Search or select a customer…")).toHaveValue(customer.name);
      expect(screen.getByPlaceholderText("Job / Work Title (optional)")).toHaveValue(customer.projectName);
    });

    const invoices = readStoredInvoices();
    expect(invoices).toHaveLength(1);

    const createdInvoice = invoices[0];
    expect(createdInvoice).toEqual(expect.objectContaining({
      docType: "invoice",
      customerId: customer.id,
      customerName: customer.name,
      projectId: "proj_bucket",
      projectName: customer.projectName,
      sourceEstimateId: estimate.id,
      scopeNotes: estimate.scopeNotes,
    }));
    expect(createdInvoice.ui).toEqual(expect.objectContaining({ docType: "invoice", materialsMode: "blanket" }));
    expect(createdInvoice.sourceEstimateSnapshot).toEqual(expect.objectContaining({
      estimateNumber: estimate.estimateNumber,
      customerId: customer.id,
      customerName: customer.name,
      projectId: "proj_bucket",
      projectName: customer.projectName,
    }));
    expect(createdInvoice.job).toEqual(expect.objectContaining({
      location: estimate.job.location,
    }));

    const createdLaborLine = createdInvoice?.labor?.lines?.[0] || {};
    expect(createdLaborLine).toEqual(expect.objectContaining({
      role: "electrician",
      label: "Electrician",
    }));
    expect(String(createdLaborLine.qty || "")).toBe("1");
    expect(String(createdLaborLine.hours || "")).toBe("6");
    expect(String(createdLaborLine.rate || "")).toBe("95");
    expect(String(createdLaborLine.trueRateInternal || createdLaborLine.internalRate || "")).toBe("55");
    expect(String(createdLaborLine.markupPct || "")).toBe("12");

    expect(String(createdInvoice?.materials?.blanketCost || "")).toBe("330");
    expect(String(createdInvoice?.materials?.blanketInternalCost || "")).toBe("210");
    expect(String(createdInvoice?.materials?.materialsBlanketDescription || "")).toBe("Bucket blanket materials");
    expect(String(createdInvoice?.materials?.items?.[0]?.desc || "")).toBe("");

    expectEditInvoiceTargetWasSet(setItemSpy, createdInvoice.id);
  });

  test("full invoice builder preserves additional charges without collapsing them into materials", async () => {
    const customer = createCustomer({
      id: "cust_additional_charge",
      name: "Additional Charge Customer",
      projectName: "Emergency Service Project",
      projectNumber: "P-4302A",
      address: "456 Service Ave",
    });
    const estimate = createEstimate({
      id: "est_additional_charge",
      status: "approved",
      estimateNumber: "EST-4302A",
      projectId: "proj_additional_charge",
      customer,
      scopeNotes: "Emergency Sunday service call with same-day mobilization.",
      materialsMode: "itemized",
      total: 1430,
      laborLine: {
        id: "labor_additional_charge_1",
        role: "technician",
        label: "Technician",
        qty: "1",
        hours: "8",
        rate: "95",
        trueRateInternal: "60",
        internalRate: "60",
        markupPct: "0",
      },
      materialItem: {
        id: "material_additional_charge_1",
        desc: "Service consumables",
        qty: "1",
        unitCostInternal: "95",
        costInternal: "95",
        priceEach: "120",
        markupPct: "0",
      },
      blanketMaterials: {
        blanketCost: "",
        blanketInternalCost: "",
        materialsBlanketDescription: "",
        markupPct: 0,
        item: { id: "blanket_placeholder", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" },
      },
      additionalChargeItems: [
        {
          id: "charge_emergency_1",
          desc: "Emergency Sunday Call",
          qty: "1",
          priceEach: "350",
        },
      ],
    });

    seedEstimateSession({ estimate, customer });
    await renderAppOnEstimates(customer.projectName);

    fireEvent.click(screen.getByRole("button", { name: /^Details$/i }));
    await screen.findByRole("button", { name: /Create Invoice/i });

    setItemSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Create Invoice/i }));

    await screen.findByRole("heading", { name: /EDIT INVOICE/i });

    const invoices = readStoredInvoices();
    expect(invoices).toHaveLength(1);

    const createdInvoice = invoices[0];
    expect(createdInvoice.additionalCharges).toEqual({
      items: [
        expect.objectContaining({
          id: "charge_emergency_1",
          desc: "Emergency Sunday Call",
          qty: "1",
          priceEach: "350",
        }),
      ],
    });
    expect(createdInvoice.materials).toEqual(expect.objectContaining({
      items: [
        expect.objectContaining({
          desc: "Service consumables",
        }),
      ],
    }));
    expect(createdInvoice.sourceEstimateSnapshot).toEqual(expect.objectContaining({
      additionalChargesRevenue: 350,
    }));
    expect(createdInvoice.additionalNotes).toBe(
      "Scope from estimate: Emergency Sunday service call with same-day mobilization."
    );
    expect(screen.queryByText(/Quick Composer/i)).not.toBeInTheDocument();

    expectEditInvoiceTargetWasSet(setItemSpy, createdInvoice.id);
  });

  test("No, Later dismisses safely without opening the builder or creating an invoice", async () => {
    const customer = createCustomer({
      id: "cust_later",
      name: "Later Customer",
      projectName: "Later Project",
      projectNumber: "P-4303",
      address: "789 Later Rd",
    });
    const estimate = createEstimate({
      id: "est_later_itemized",
      status: "pending",
      estimateNumber: "EST-4303",
      projectId: "proj_later",
      customer,
      scopeNotes: "Hold for later.",
      materialsMode: "itemized",
      total: 420,
      laborLine: {
        id: "labor_later_1",
        role: "painter",
        label: "Painter",
        qty: "1",
        hours: "4",
        rate: "70",
        trueRateInternal: "45",
        internalRate: "45",
        markupPct: "12",
      },
      materialItem: {
        id: "material_later_1",
        desc: "Later material",
        qty: "2",
        unitCostInternal: "10",
        costInternal: "20",
        priceEach: "18",
        markupPct: "0",
      },
      blanketMaterials: {
        blanketCost: "",
        blanketInternalCost: "",
        materialsBlanketDescription: "",
        markupPct: 0,
        item: { id: "blanket_placeholder", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" },
      },
    });

    seedEstimateSession({ estimate, customer });
    await renderAppOnEstimates(customer.projectName);

    fireEvent.click(screen.getByRole("button", { name: /^Details$/i }));
    await screen.findByRole("button", { name: /Mark Approved/i });

    setItemSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Mark Approved/i }));

    await screen.findByText("Create Invoice?");
    fireEvent.click(screen.getByRole("button", { name: /No, Later/i }));

    await waitFor(() => {
      expect(screen.queryByText("Create Invoice?")).not.toBeInTheDocument();
      expect(screen.getByText(/Saved Estimates/i)).toBeInTheDocument();
      expect(screen.getByText(customer.projectName)).toBeInTheDocument();
    });

    expect(screen.queryByText("Invoice Builder")).not.toBeInTheDocument();
    expect(screen.queryByText("EDIT INVOICE")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Create invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Quick Composer/i)).not.toBeInTheDocument();
    expect(readStoredInvoices()).toEqual([]);
    expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
    expectEditInvoiceTargetWasNotSet(setItemSpy);
  });

  test("marking approved suppresses the prompt when linked invoices already cover the estimate", async () => {
    const customer = createCustomer({
      id: "cust_covered",
      name: "Covered Customer",
      projectName: "Covered Project",
      projectNumber: "P-4304",
      address: "100 Covered Way",
    });
    const estimate = createEstimate({
      id: "est_covered",
      status: "pending",
      estimateNumber: "EST-4304",
      projectId: "proj_covered",
      customer,
      scopeNotes: "Replace the damaged storefront glazing.",
      materialsMode: "itemized",
      total: 750,
      laborLine: {
        id: "labor_covered_1",
        role: "glazier",
        label: "Glazier",
        qty: "1",
        hours: "5",
        rate: "90",
        trueRateInternal: "55",
        internalRate: "55",
        markupPct: "12",
      },
      materialItem: {
        id: "material_covered_1",
        desc: "Tempered glass panel",
        qty: "1",
        unitCostInternal: "220",
        costInternal: "220",
        priceEach: "300",
        markupPct: "0",
      },
      blanketMaterials: {
        blanketCost: "",
        blanketInternalCost: "",
        materialsBlanketDescription: "",
        markupPct: 0,
        item: { id: "blanket_placeholder", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" },
      },
    });
    const linkedInvoice = createLinkedInvoice({
      id: "inv_covered_full",
      invoiceNumber: "INV-4304",
      estimate,
      customer,
      invoiceTotal: 750,
    });

    seedEstimateSession({ estimate, customer, invoices: [linkedInvoice] });
    await renderAppOnEstimates(customer.projectName);

    fireEvent.click(screen.getByRole("button", { name: /^Details$/i }));
    await screen.findByRole("button", { name: /Mark Approved/i });

    setItemSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Mark Approved/i }));

    await waitFor(() => {
      expect(screen.queryByText("Create Invoice?")).not.toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: /Create invoice/i })).not.toBeInTheDocument();
      expect(readStoredEstimates()).toEqual([
        expect.objectContaining({ id: estimate.id, status: "approved" }),
      ]);
    });

    expect(readStoredInvoices()).toEqual([linkedInvoice]);
    expect(screen.queryByText(/Quick Composer/i)).not.toBeInTheDocument();
    expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
    expectEditInvoiceTargetWasNotSet(setItemSpy);
  });

  test("marking approved still prompts when linked invoices leave a remaining balance", async () => {
    const customer = createCustomer({
      id: "cust_remaining",
      name: "Remaining Customer",
      projectName: "Remaining Balance Project",
      projectNumber: "P-4305",
      address: "200 Remaining Ave",
    });
    const estimate = createEstimate({
      id: "est_remaining",
      status: "pending",
      estimateNumber: "EST-4305",
      projectId: "proj_remaining",
      customer,
      scopeNotes: "Install new lobby lighting and patch the ceiling.",
      materialsMode: "itemized",
      total: 900,
      laborLine: {
        id: "labor_remaining_1",
        role: "electrician",
        label: "Electrician",
        qty: "1",
        hours: "6",
        rate: "95",
        trueRateInternal: "60",
        internalRate: "60",
        markupPct: "12",
      },
      materialItem: {
        id: "material_remaining_1",
        desc: "LED fixture kit",
        qty: "3",
        unitCostInternal: "75",
        costInternal: "225",
        priceEach: "100",
        markupPct: "0",
      },
      blanketMaterials: {
        blanketCost: "",
        blanketInternalCost: "",
        materialsBlanketDescription: "",
        markupPct: 0,
        item: { id: "blanket_placeholder", desc: "", qty: "", unitCostInternal: "", costInternal: "", priceEach: "" },
      },
    });
    const linkedInvoice = createLinkedInvoice({
      id: "inv_remaining_partial",
      invoiceNumber: "INV-4305",
      estimate,
      customer,
      invoiceTotal: 300,
    });

    seedEstimateSession({ estimate, customer, invoices: [linkedInvoice] });
    await renderAppOnEstimates(customer.projectName);

    fireEvent.click(screen.getByRole("button", { name: /^Details$/i }));
    await screen.findByRole("button", { name: /Mark Approved/i });

    setItemSpy.mockClear();

    fireEvent.click(screen.getByRole("button", { name: /Mark Approved/i }));

    await screen.findByText("Create Invoice?");

    expect(screen.queryByRole("dialog", { name: /Create invoice/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Quick Composer/i)).not.toBeInTheDocument();
    expect(readStoredInvoices()).toEqual([linkedInvoice]);

    fireEvent.click(screen.getByRole("button", { name: /No, Later/i }));

    await waitFor(() => {
      expect(screen.queryByText("Create Invoice?")).not.toBeInTheDocument();
      expect(readStoredEstimates()).toEqual([
        expect.objectContaining({ id: estimate.id, status: "approved" }),
      ]);
    });

    expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
    expectEditInvoiceTargetWasNotSet(setItemSpy);
  });

  test("fresh estimate draft with meaningful content blocks an accidental flip to invoice", async () => {
    localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify({
      ui: { docType: "estimate", materialsMode: "itemized" },
      scopeNotes: "Repair drywall and repaint two rooms.",
      labor: {
        hazardPct: 0,
        riskPct: 0,
        multiplier: 1,
        lines: [{ id: "l1", role: "painter", hours: "4", rate: "60", trueRateInternal: "" }],
      },
    }));

    render(<App />);

    act(() => {
      window.dispatchEvent(new Event("estipaid:hero-logo-longpress"));
    });
    const quickMenu = await screen.findByRole("dialog", { name: /Shortcuts/i });
    fireEvent.click(within(quickMenu).getByRole("button", { name: /^Create$/i }));

    const launcher = await screen.findByRole("dialog", { name: /Start New/i });
    fireEvent.click(within(launcher).getByRole("button", { name: /^Invoice$/i }));

    const guard = await screen.findByRole("dialog", { name: /You have a draft in progress/i });

    // The draft must not be silently flipped to invoice or have scopeNotes wiped
    // while the guard is awaiting a choice.
    const guardedDraft = JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE));
    expect(guardedDraft.ui.docType).toBe("estimate");
    expect(guardedDraft.scopeNotes).toBe("Repair drywall and repaint two rooms.");

    fireEvent.click(within(guard).getByRole("button", { name: /Continue Current Draft/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /You have a draft in progress/i })).not.toBeInTheDocument();
    });

    const draftAfterContinue = JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE));
    expect(draftAfterContinue.ui.docType).toBe("estimate");
    expect(draftAfterContinue.scopeNotes).toBe("Repair drywall and repaint two rooms.");
  });

  test("explicit Start Blank Invoice choice replaces the draft only after user confirmation", async () => {
    localStorage.setItem(STORAGE_KEYS.ESTIMATOR_STATE, JSON.stringify({
      ui: { docType: "estimate", materialsMode: "itemized" },
      scopeNotes: "Repair drywall and repaint two rooms.",
      labor: {
        hazardPct: 0,
        riskPct: 0,
        multiplier: 1,
        lines: [{ id: "l1", role: "painter", hours: "4", rate: "60", trueRateInternal: "" }],
      },
    }));

    render(<App />);

    act(() => {
      window.dispatchEvent(new Event("estipaid:hero-logo-longpress"));
    });
    const quickMenu = await screen.findByRole("dialog", { name: /Shortcuts/i });
    fireEvent.click(within(quickMenu).getByRole("button", { name: /^Create$/i }));

    const launcher = await screen.findByRole("dialog", { name: /Start New/i });
    fireEvent.click(within(launcher).getByRole("button", { name: /^Invoice$/i }));

    const guard = await screen.findByRole("dialog", { name: /You have a draft in progress/i });

    fireEvent.click(within(guard).getByRole("button", { name: /Discard and Start New Invoice/i }));

    await waitFor(() => {
      const resolvedDraft = JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATOR_STATE));
      expect(resolvedDraft.ui.docType).toBe("invoice");
      expect(resolvedDraft.scopeNotes).toBe("");
    });
  });
});
