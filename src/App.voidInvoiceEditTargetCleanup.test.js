import {
  resetConfiguredTestWorkspace,
  setupConfiguredWorkspace,
  buildUnlockedVaultSessionResult,
  waitForConfiguredWorkspaceShell,
} from "./testUtils/configuredWorkspaceTestHarness";
import { setActiveWorkspaceVaultCompatibility } from "./lib/accountScopedLocalStorage";

// ISO-14K: the operational shell requires an authenticated identity with an
// active account-scoped workspace, so this suite states one explicitly and
// seeds its fixtures inside that workspace namespace.
jest.mock("./lib/useSupabaseAuth", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useSupabaseAccount", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useSupabaseWorkspaceBootstrap", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useDeviceLockStatus", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoBackup", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoConvergence", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultSession", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultRuntimeActivation", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultCompatibilityBridge", () => ({ __esModule: true, default: () => ({ state: "legacy-safe", checking: false, code: "", message: "", refresh: jest.fn() }) }));
jest.mock("./lib/vaultCrypto", () => ({ workspaceTag: () => Promise.resolve("A".repeat(43)) }));

import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";

import App from "./App";

const useVaultSession = require("./lib/useVaultSession").default;

const EDIT_INVOICE_TARGET_KEY = "estipaid-edit-invoice-target-v1";
const INVOICES_KEY = "estipaid-invoices-v1";

// Allow builder access without a real company profile
jest.mock("./utils/guards", () => ({
  requireCompanyProfile: () => ({ allowed: true }),
}));

// Minimal stub so EstimateForm can mount when the builder tab opens
jest.mock("./estimator/useEstimatorState", () => {
  const React = require("react");
  const { DEFAULT_STATE } = require("./estimator/defaultState");

  function useMockEstimatorState() {
    const [state] = React.useState(DEFAULT_STATE);
    return {
      state,
      patch: jest.fn(),
      dupLaborLine: jest.fn(),
      removeLaborLine: jest.fn(),
      updateLaborLine: jest.fn(),
      clearAll: jest.fn(),
      saveNow: jest.fn(),
      replaceState: jest.fn(),
    };
  }

  useMockEstimatorState.useEstimatorState = useMockEstimatorState;
  return {
    __esModule: true,
    default: useMockEstimatorState,
    useEstimatorState: useMockEstimatorState,
  };
});

function makeVoidInvoice(id) {
  return {
    id,
    docType: "invoice",
    invoiceNumber: `INV-${id}`,
    invoiceTotal: 500,
    total: 500,
    status: "void",
    paymentStatus: "void",
    amountPaid: 0,
    balanceRemaining: 0,
    updatedAt: 1714694400000,
    createdAt: 1714694300000,
  };
}

function makeActiveInvoice(id) {
  return {
    id,
    docType: "invoice",
    invoiceNumber: `INV-${id}`,
    invoiceTotal: 500,
    total: 500,
    status: "sent",
    paymentStatus: "unpaid",
    amountPaid: 0,
    balanceRemaining: 500,
    updatedAt: 1714694400000,
    createdAt: 1714694300000,
  };
}

function triggerBuilderNavigation() {
  act(() => {
    window.dispatchEvent(new Event("estipaid:navigate-invoice-builder"));
  });
}

// Opens CreateLauncher and clicks the "Invoice" button, triggering onCreateButtonRoute(INVOICE).
// For a valid non-void edit target, this shows the "Start new document" modal WITHOUT mounting
// EstimateForm — so the key is not consumed and remains in localStorage for assertion.
function triggerCreateInvoiceFromLauncher() {
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: /^Create$/i }));
  });
  act(() => {
    fireEvent.click(screen.getByRole("button", { name: /^Invoice$/i }));
  });
}

describe("App readValidatedCreateEditTargets void invoice defense", () => {
  beforeEach(() => {
    resetConfiguredTestWorkspace();
    setupConfiguredWorkspace();
    setActiveWorkspaceVaultCompatibility({ workspaceTag: "A".repeat(43), state: "legacy-safe", generation: 1 });
    useVaultSession.mockReturnValue(buildUnlockedVaultSessionResult());
  });

  afterEach(() => {
    resetConfiguredTestWorkspace();
  });

  test("clears EDIT_INVOICE_TARGET_KEY when the target invoice is void", async () => {
    const voidInv = makeVoidInvoice("inv_void_stale");
    localStorage.setItem(INVOICES_KEY, JSON.stringify([voidInv]));
    localStorage.setItem(EDIT_INVOICE_TARGET_KEY, "inv_void_stale");

    render(<App />);
    await waitForConfiguredWorkspaceShell();
    triggerBuilderNavigation();

    expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
  });

  test("clears EDIT_INVOICE_TARGET_KEY when the target invoice is missing (existing behavior preserved)", async () => {
    localStorage.setItem(EDIT_INVOICE_TARGET_KEY, "inv_missing_ghost");

    render(<App />);
    await waitForConfiguredWorkspaceShell();
    triggerBuilderNavigation();

    expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
  });

  test("accepts a non-void invoice target: edit session is flagged active and modal appears on Create Invoice", async () => {
    // Non-void (sent) invoice — should be accepted by validation, not cleared by the void guard.
    // We test via CreateLauncher → Invoice button path, which calls onCreateButtonRoute(INVOICE).
    // With a valid invoiceEditTarget, the "Start new document" modal appears instead of navigating,
    // and EstimateForm does NOT mount — so the key is not consumed and remains in localStorage.
    const activeInv = makeActiveInvoice("inv_sent_valid");
    localStorage.setItem(INVOICES_KEY, JSON.stringify([activeInv]));
    localStorage.setItem(EDIT_INVOICE_TARGET_KEY, "inv_sent_valid");

    render(<App />);
    await waitForConfiguredWorkspaceShell();
    triggerCreateInvoiceFromLauncher();

    // Modal is shown because invoiceEditTarget was valid (non-void), proving the guard did not fire
    expect(screen.getByRole("dialog", { name: /Start new document/i })).toBeInTheDocument();
    // Key was not consumed (builder didn't mount, no EstimateForm hydration)
    expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBe("inv_sent_valid");
  });

  test("does not disturb EDIT_INVOICE_TARGET_KEY for a void invoice before navigation clears it", async () => {
    // Verify the key exists at seed time (sanity), then builder navigation clears it.
    const voidInv = makeVoidInvoice("inv_void_sanity");
    localStorage.setItem(INVOICES_KEY, JSON.stringify([voidInv]));
    localStorage.setItem(EDIT_INVOICE_TARGET_KEY, "inv_void_sanity");

    expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBe("inv_void_sanity");

    render(<App />);
    await waitForConfiguredWorkspaceShell();
    triggerBuilderNavigation();

    expect(localStorage.getItem(EDIT_INVOICE_TARGET_KEY)).toBeNull();
  });
});
