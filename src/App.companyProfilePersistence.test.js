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

// ISO-14K: inside a configured workspace, local business saves are routed
// through the device-lock guard, which cannot confirm an active device without
// a live Supabase client (it reports "no_workspace"). These suites exercise
// builder/navigation/persistence behavior rather than device-lock policy, so
// the guard is mocked to the verified-active-device answer. Device-lock policy
// keeps its own dedicated suites.
jest.mock("./lib/supabaseDeviceLock", () => ({
  ...jest.requireActual("./lib/supabaseDeviceLock"),
  ensureCurrentDeviceCanMutateBusinessData: jest.fn(),
  ensureCurrentDeviceCanWriteCloud: jest.fn(),
}));


import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";

const useVaultSession = require("./lib/useVaultSession").default;

const PROFILE = {
  companyName: "Desert Ridge",
  phone: "6025550147",
  addressLine1: "123 Main St",
  city: "Phoenix",
  state: "AZ",
  zip: "85001",
  logoDataUrl: "data:image/png;base64,old-logo",
};

function shellAction(action) {
  act(() => {
    window.dispatchEvent(new CustomEvent("pe-shell-action", { detail: { action } }));
  });
}

describe("App Company Profile dirty-navigation integration", () => {
  let originalConfirm;

  beforeEach(() => {
    resetConfiguredTestWorkspace();
    setupConfiguredWorkspace();
    setActiveWorkspaceVaultCompatibility({ workspaceTag: "A".repeat(43), state: "legacy-safe", generation: 1 });
    useVaultSession.mockReturnValue(buildUnlockedVaultSessionResult());
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify(PROFILE));
    originalConfirm = window.confirm;
    window.confirm = jest.fn(() => true);
  });

  afterEach(() => {
    window.confirm = originalConfirm;
    resetConfiguredTestWorkspace();
  });

  test("a successful Company Profile save clears the shell dirty-navigation block", async () => {
    render(<App />);
    await waitForConfiguredWorkspaceShell();
    shellAction("openCompanyProfile");
    expect(await screen.findByRole("heading", { name: "Company Profile" })).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Desert Ridge"), { target: { value: "Updated Ridge" } });
    await waitFor(() => {
      shellAction("goEstimatesTab");
      expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "Stay" }));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /^Save$/i }));
      await Promise.resolve();
    });
    await waitFor(() => expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE))).toEqual(expect.objectContaining({ companyName: "Updated Ridge" })));

    shellAction("goEstimatesTab");
    await waitFor(() => expect(screen.getByRole("heading", { name: /Saved Estimates/i })).toBeInTheDocument());
    expect(screen.queryByText("Unsaved changes")).not.toBeInTheDocument();
  });
});
