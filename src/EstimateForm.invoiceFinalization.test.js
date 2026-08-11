// New-invoice finalization regression coverage.
//
// Confirmed regression: create Invoice -> Save -> Review -> Approve & Save left
// the user staring at an EMPTY new invoice builder, with a false
// "Invoice not found. Switched to new mode." notice.
//
// Cause: a non-edit-mode recovery effect fired whenever the builder's draft
// carried a savedDocId whose invoice EXISTED in storage. That is the successful
// case. The effect is meant only for a stale retained ghost draft, so a
// successful save was being treated as a lookup failure and the builder was
// destructively reset after the invoice had already been written.

import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const STORAGE_KEY = "estipaid-estimator-v1";
const INVOICES_KEY = "estipaid-invoices-v1";

const mockPatch = jest.fn();
const mockReplaceState = jest.fn();
const mockCleanBuilderReset = jest.fn();
let mockInitialState = null;

jest.mock("./estimator/useEstimatorState", () => {
  const React = require("react");
  const { DEFAULT_STATE } = require("./estimator/defaultState");

  const clone = (value) => JSON.parse(JSON.stringify(value));

  function mergeValues(baseValue, nextValue) {
    if (Array.isArray(nextValue)) return nextValue.map((entry) => mergeValues(undefined, entry));
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

  const normalizeState = (next = {}) => mergeValues(clone(DEFAULT_STATE), clone(next || {}));

  function setByPath(target, path, value) {
    const segments = String(path || "").split(".").filter(Boolean);
    if (!segments.length) return;
    let cursor = target;
    for (let index = 0; index < segments.length - 1; index += 1) {
      const key = segments[index];
      if (!cursor[key] || typeof cursor[key] !== "object" || Array.isArray(cursor[key])) cursor[key] = {};
      cursor = cursor[key];
    }
    cursor[segments[segments.length - 1]] = value;
  }

  function useMockEstimatorState() {
    const [state, setState] = React.useState(() => normalizeState(mockInitialState || {}));
    const stateRef = React.useRef(state);
    stateRef.current = state;

    const patch = React.useCallback((path, value) => {
      mockPatch(path, value);
      setState((previous) => {
        const next = clone(previous);
        setByPath(next, path, value);
        return next;
      });
    }, []);

    // Mirrors the real saveNow contract: merge the meta patch, persist the exact
    // draft bytes, and return the persisted object.
    const saveNow = React.useCallback((metaPatch = {}) => {
      const persisted = {
        ...clone(stateRef.current),
        meta: { ...(stateRef.current?.meta || {}), ...metaPatch },
      };
      global.localStorage.setItem("estipaid-estimator-v1", JSON.stringify(persisted));
      setState(persisted);
      return persisted;
    }, []);

    const replaceState = React.useCallback((nextState, options = {}) => {
      mockReplaceState(nextState, options);
      // A clean builder reset is what the regression produced. Record it so the
      // test can assert it never happens on a successful finalization.
      const lines = nextState?.labor?.lines || [];
      const isCleanReset = !String(nextState?.customer?.name || "").trim()
        && lines.every((line) => !String(line?.role || "").trim());
      if (isCleanReset) mockCleanBuilderReset(nextState);
      setState(normalizeState(nextState || {}));
    }, []);

    return {
      state,
      patch,
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine: jest.fn(),
      clearAll: jest.fn(),
      saveNow,
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
    assistState: { phase: "idle", input: "", error: "", runtime: {} },
    open: jest.fn(),
    close: jest.fn(),
    submit: jest.fn(),
  }),
}));

jest.mock("./estimator/aiAssist/service", () => ({ requestSectionAssist: jest.fn() }));

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

jest.mock("./utils/settings", () => {
  const settings = {
    pricing: { defaultMarkupPct: 0, lockMarkupToGlobal: false },
    internal: { showInternalCostFields: true, lockInternalCostFields: false },
    docDefaults: { defaultInternalNotesEstimate: "" },
  };
  return { DEFAULT_SETTINGS: settings, loadSettings: () => settings };
});

import EstimateForm from "./EstimateForm";
import { DEFAULT_STATE } from "./estimator/defaultState";
import { computeTotals } from "./estimator/engine";

const clone = (value) => JSON.parse(JSON.stringify(value));

// The exact invoice from the regression report: one technician, 14 hours at
// $50/hr = $700.
function buildTechnicianInvoiceState() {
  const state = clone(DEFAULT_STATE);
  state.ui = { ...state.ui, docType: "invoice", materialsMode: "itemized" };
  state.customer = {
    ...state.customer,
    id: "cust_final_1",
    name: "Finalization Customer",
    projectName: "Finalization Project",
    projectSameAsCustomer: true,
  };
  state.job = { ...state.job, date: "2026-08-10", due: "2026-09-09" };
  state.labor = {
    ...state.labor,
    hazardPct: 0,
    riskPct: 0,
    multiplier: 1,
    lines: [{ id: "labor_tech", role: "Technician", qty: "1", hours: "14", rate: "50", trueRateInternal: "" }],
  };
  state.materials = { ...state.materials, markupPct: 0, blanketCost: "", items: [] };
  state.additionalCharges = { items: [] };
  return state;
}

const readInvoices = () => JSON.parse(localStorage.getItem(INVOICES_KEY) || "[]");

async function approveAndSave() {
  fireEvent.click(screen.getByRole("button", { name: "Review & Save" }));
  fireEvent.click(await screen.findByRole("button", { name: "Approve & Save" }));
  await screen.findByRole("heading", { name: "Invoice Saved" });
}

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  mockInitialState = buildTechnicianInvoiceState();
});

describe("new invoice finalization", () => {
  test("the source state really is a $700 invoice", () => {
    expect(computeTotals(buildTechnicianInvoiceState()).totalRevenue).toBe(700);
  });

  test("Approve & Save writes exactly one $700 invoice and does not reset the builder", async () => {
    render(<EstimateForm />);
    await screen.findByText("Invoice Builder");

    await approveAndSave();

    const invoices = readInvoices();
    expect(invoices).toHaveLength(1);

    const saved = invoices[0];
    expect(Number(saved.invoiceTotal)).toBe(700);
    expect(saved.labor.lines).toHaveLength(1);
    expect(saved.labor.lines[0].role).toBe("Technician");
    expect(saved.materials.items.some((item) => /technician/i.test(String(item?.desc || "")))).toBe(false);

    // The builder was never destructively reset, and the false notice never ran.
    expect(mockCleanBuilderReset).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByText("Invoice not found. Switched to new mode.")).not.toBeInTheDocument();
    });

    // The user is left in the intended post-finalization state: the Saved panel
    // with its Exit Builder action, not an empty builder.
    expect(screen.getByRole("button", { name: "Exit Builder" })).toBeInTheDocument();
  });

  test("the builder still holds the invoice after finalization settles", async () => {
    render(<EstimateForm />);
    await screen.findByText("Invoice Builder");

    await approveAndSave();

    fireEvent.click(screen.getByRole("button", { name: "Continue Editing" }));

    await waitFor(() => {
      expect(screen.queryByText("Invoice not found. Switched to new mode.")).not.toBeInTheDocument();
    });
    // The draft the builder is still editing is the saved invoice, not a blank.
    const draft = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    expect(draft?.customer?.name).toBe("Finalization Customer");
    expect(draft?.labor?.lines?.[0]?.role).toBe("Technician");
    expect(computeTotals(draft).totalRevenue).toBe(700);
  });

  test("saving again keeps the same invoice id and creates no duplicate", async () => {
    render(<EstimateForm />);
    await screen.findByText("Invoice Builder");

    await approveAndSave();
    const firstId = readInvoices()[0].id;
    expect(firstId).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Continue Editing" }));
    await approveAndSave();

    const invoices = readInvoices();
    expect(invoices).toHaveLength(1);
    expect(invoices[0].id).toBe(firstId);
    expect(Number(invoices[0].invoiceTotal)).toBe(700);
    expect(invoices[0].labor.lines[0].role).toBe("Technician");
    expect(mockCleanBuilderReset).not.toHaveBeenCalled();
  });

  test("a stale retained ghost draft for an invoice this session never saved still resets", async () => {
    // The behavior the recovery effect actually exists for must survive: the
    // live draft points at an invoice saved elsewhere, and this session did not
    // save it.
    const ghost = buildTechnicianInvoiceState();
    ghost.invoiceNumber = "INV-7777";
    ghost.job = { ...ghost.job, docNumber: "INV-7777" };
    ghost.meta = { ...(ghost.meta || {}), savedDocId: "inv_saved_elsewhere" };
    mockInitialState = ghost;

    localStorage.setItem(INVOICES_KEY, JSON.stringify([
      { id: "inv_saved_elsewhere", invoiceNumber: "INV-7777", status: "sent", invoiceTotal: 700 },
    ]));

    render(<EstimateForm />);
    await screen.findByText("Invoice Builder");

    expect(await screen.findByText("Invoice not found. Switched to new mode.")).toBeInTheDocument();
    expect(mockCleanBuilderReset).toHaveBeenCalled();
  });
});
