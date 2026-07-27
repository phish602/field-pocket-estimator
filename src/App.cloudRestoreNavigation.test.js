import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { CLOUD_RESTORE_COMPLETE_EVENT } from "./lib/supabaseCloudRestore";
import {
  resetConfiguredTestWorkspace,
  setupConfiguredWorkspace,
} from "./testUtils/configuredWorkspaceTestHarness";

jest.mock("./lib/useSupabaseAuth", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./lib/useSupabaseAccount", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./lib/useCloudAutoBackup", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./lib/useSupabaseWorkspaceBootstrap", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useDeviceLockStatus", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoConvergence", () => ({ __esModule: true, default: jest.fn() }));

// The full Advanced Settings screen pulls in many independent Supabase
// modules that are irrelevant to this navigation test; stub it so this test
// only exercises App's restore-complete listener and routing.
jest.mock("./screens/AdvancedSettingsScreen", () => ({
  __esModule: true,
  default: () => <div>Advanced Settings Stub</div>,
}));

// ISO-14K: this suite exercises in-shell navigation, so it now signs in with an
// explicit authenticated identity and opens that account's scoped workspace.
beforeEach(() => {
  resetConfiguredTestWorkspace();
  setupConfiguredWorkspace();
});

afterEach(() => {
  resetConfiguredTestWorkspace();
});

test("a completed cloud restore navigates the user back to Home from another screen", () => {
  render(<App />);

  fireEvent.click(screen.getByLabelText(/open menu/i));
  fireEvent.click(screen.getByText("Settings"));
  expect(screen.getByText("Advanced Settings Stub")).toBeInTheDocument();

  act(() => {
    window.dispatchEvent(new CustomEvent(CLOUD_RESTORE_COMPLETE_EVENT, { detail: { restored: true } }));
  });

  expect(screen.queryByText("Advanced Settings Stub")).not.toBeInTheDocument();
  expect(screen.getByText("Turn Scope into Revenue")).toBeInTheDocument();
});

test("without a restore-complete event, the app does not navigate away on its own", () => {
  render(<App />);

  fireEvent.click(screen.getByLabelText(/open menu/i));
  fireEvent.click(screen.getByText("Settings"));

  expect(screen.getByText("Advanced Settings Stub")).toBeInTheDocument();
  expect(screen.queryByText("Turn Scope into Revenue")).not.toBeInTheDocument();
});
