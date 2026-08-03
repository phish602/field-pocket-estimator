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

import { fireEvent, render, screen, within } from "@testing-library/react";
import App from "./App";

const useVaultSession = require("./lib/useVaultSession").default;
import { STORAGE_KEYS } from "./constants/storageKeys";

const COMPLETE_COMPANY_PROFILE = {
  companyName: "Acme Field Services",
  phone: "5551234567",
  addressLine1: "123 Main St",
  city: "Springfield",
  state: "IL",
  zip: "62704",
};

const CUSTOMER_SEARCH_PLACEHOLDER = "Search or select a customer…";

function seedCompanyProfile() {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(COMPLETE_COMPANY_PROFILE));
}

function seedMeaningfulDraft(docType, customerName) {
  localStorage.setItem(
    STORAGE_KEYS.ESTIMATOR_STATE,
    JSON.stringify({
      ui: { docType },
      customer: { name: customerName },
    })
  );
}

function queryToggle() {
  return document.querySelector(".pe-builder-mode");
}

async function clickCreateThenLauncherOption(buttonNamePattern) {
  fireEvent.click(screen.getByLabelText("Create"));
  const launcher = await screen.findByRole("dialog", { name: /Start New/i });
  fireEvent.click(within(launcher).getByRole("button", { name: buttonNamePattern }));
}

async function clickNewEstimate() {
  await clickCreateThenLauncherOption(/^Estimate$|^New Estimate$|^Resume Estimate Draft$/i);
}

async function clickNewInvoice() {
  await clickCreateThenLauncherOption(/^Invoice$|^New Invoice$/i);
}

beforeEach(() => {
  resetConfiguredTestWorkspace();
  setupConfiguredWorkspace();
  setActiveWorkspaceVaultCompatibility({ workspaceTag: "A".repeat(43), state: "legacy-safe", generation: 1 });
  useVaultSession.mockReturnValue(buildUnlockedVaultSessionResult());
  seedCompanyProfile();
});

test("1. Create -> New Estimate opens Estimate Builder with no Estimate/Invoice toggle", async () => {
  render(<App />);
  await waitForConfiguredWorkspaceShell();

  await clickNewEstimate();

  expect(await screen.findByText(/Estimate Builder/i)).toBeInTheDocument();
  expect(queryToggle()).toBeNull();
  expect(screen.queryByRole("button", { name: "Invoice" })).toBeNull();
});

test("2. Create -> New Invoice opens Invoice Builder with no toggle", async () => {
  render(<App />);
  await waitForConfiguredWorkspaceShell();

  await clickNewInvoice();

  expect(await screen.findByText(/Invoice Builder/i)).toBeInTheDocument();
  expect(queryToggle()).toBeNull();
  expect(screen.queryByRole("button", { name: "Estimate" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Invoice" })).toBeNull();
});

test("3. New Invoice draft guard: Continue Current Draft keeps Estimate Draft A and routes to Estimate Builder", async () => {
  seedMeaningfulDraft("estimate", "Draft A Customer");
  render(<App />);
  await waitForConfiguredWorkspaceShell();

  await clickNewInvoice();

  const guard = await screen.findByRole("dialog", { name: /You have a draft in progress/i });
  expect(guard).toBeInTheDocument();

  fireEvent.click(within(guard).getByRole("button", { name: "Continue Current Draft" }));

  expect(await screen.findByText(/Estimate Builder/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("Draft A Customer");
  expect(queryToggle()).toBeNull();
});

test("4. New Invoice draft guard: Discard and Start New Invoice clears stale estimate data", async () => {
  seedMeaningfulDraft("estimate", "Draft A Customer");
  render(<App />);
  await waitForConfiguredWorkspaceShell();

  await clickNewInvoice();

  const guard = await screen.findByRole("dialog", { name: /You have a draft in progress/i });
  fireEvent.click(within(guard).getByRole("button", { name: "Discard and Start New Invoice" }));

  expect(await screen.findByText(/Invoice Builder/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("");
  expect(queryToggle()).toBeNull();
});

test("5. New Estimate draft guard: Continue Current Draft keeps Invoice Draft A and routes to Invoice Builder", async () => {
  seedMeaningfulDraft("invoice", "Invoice Draft A Customer");
  render(<App />);
  await waitForConfiguredWorkspaceShell();

  await clickNewEstimate();

  const guard = await screen.findByRole("dialog", { name: /You have a draft in progress/i });
  fireEvent.click(within(guard).getByRole("button", { name: "Continue Current Draft" }));

  expect(await screen.findByText(/Invoice Builder/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("Invoice Draft A Customer");
  expect(queryToggle()).toBeNull();
});

test("6. New Estimate draft guard: Discard and Start New Estimate clears stale invoice data", async () => {
  seedMeaningfulDraft("invoice", "Invoice Draft A Customer");
  render(<App />);
  await waitForConfiguredWorkspaceShell();

  await clickNewEstimate();

  const guard = await screen.findByRole("dialog", { name: /You have a draft in progress/i });
  fireEvent.click(within(guard).getByRole("button", { name: "Discard and Start New Estimate" }));

  expect(await screen.findByText(/Estimate Builder/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("");
  expect(queryToggle()).toBeNull();
});

test("7. New Estimate with no existing draft does not show the draft guard", async () => {
  render(<App />);
  await waitForConfiguredWorkspaceShell();

  await clickNewEstimate();

  expect(screen.queryByRole("dialog", { name: /You have a draft in progress/i })).toBeNull();
  expect(await screen.findByText(/Estimate Builder/i)).toBeInTheDocument();
});

test("8. New Estimate when an Estimate draft already exists does not show the draft guard (same docType)", async () => {
  seedMeaningfulDraft("estimate", "Existing Customer");
  render(<App />);
  await waitForConfiguredWorkspaceShell();

  await clickNewEstimate();

  expect(screen.queryByRole("dialog", { name: /You have a draft in progress/i })).toBeNull();
  expect(await screen.findByText(/Estimate Builder/i)).toBeInTheDocument();
  expect(screen.getByPlaceholderText(CUSTOMER_SEARCH_PLACEHOLDER)).toHaveValue("Existing Customer");
});
