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
jest.mock("./lib/useVaultCompatibilityBridge", () => ({ __esModule: true, default: () => ({ state: "legacy-safe", checking: false, code: "", message: "", refresh: jest.fn() }) }));
jest.mock("./lib/vaultCrypto", () => ({ workspaceTag: () => Promise.resolve("A".repeat(43)) }));

import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";

jest.mock("./utils/guards", () => ({
  requireCompanyProfile: () => ({ allowed: true }),
}));

jest.mock("./screens/ProjectsScreen", () => {
  return function MockProjectsScreen() {
    return <div data-testid="projects-screen">Projects screen</div>;
  };
});

import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";

const useVaultSession = require("./lib/useVaultSession").default;

const COMPLETE_COMPANY_PROFILE = {
  companyName: "Acme Field Services",
  phone: "5551234567",
  addressLine1: "123 Main St",
  city: "Springfield",
  state: "IL",
  zip: "62704",
};

beforeEach(() => {
  resetConfiguredTestWorkspace();
  setupConfiguredWorkspace();
  setActiveWorkspaceVaultCompatibility({ workspaceTag: "A".repeat(43), state: "legacy-safe", generation: 1 });
  useVaultSession.mockReturnValue(buildUnlockedVaultSessionResult());
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(COMPLETE_COMPANY_PROFILE));
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([]));
});

test("long-press logo shortcut grid includes Projects and opens the existing Projects route", async () => {
  render(<App />);
  await waitForConfiguredWorkspaceShell();

  act(() => {
    window.dispatchEvent(new Event("estipaid:hero-logo-longpress"));
  });

  const quickMenu = await screen.findByRole("dialog", { name: /Shortcuts/i });
  expect(within(quickMenu).getByRole("button", { name: /^Projects$/i })).toBeInTheDocument();

  fireEvent.click(within(quickMenu).getByRole("button", { name: /^Projects$/i }));

  expect(await screen.findByTestId("projects-screen")).toBeInTheDocument();
  expect(screen.queryByRole("dialog", { name: /Shortcuts/i })).not.toBeInTheDocument();
});
