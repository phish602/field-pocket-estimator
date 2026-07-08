import { act, fireEvent, render, screen } from "@testing-library/react";
import App from "./App";
import { CLOUD_RESTORE_COMPLETE_EVENT } from "./lib/supabaseCloudRestore";

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
  default: jest.fn(() => ({ running: false })),
}));

// The full Advanced Settings screen pulls in many independent Supabase
// modules that are irrelevant to this navigation test; stub it so this test
// only exercises App's restore-complete listener and routing.
jest.mock("./screens/AdvancedSettingsScreen", () => ({
  __esModule: true,
  default: () => <div>Advanced Settings Stub</div>,
}));

const useSupabaseAuth = require("./lib/useSupabaseAuth").default;
const useSupabaseAccount = require("./lib/useSupabaseAccount").default;

beforeEach(() => {
  useSupabaseAuth.mockReturnValue({
    configured: false,
    missingEnvKeys: [],
    loading: false,
    authBusy: false,
    session: null,
    user: null,
    userEmail: "",
    errorMessage: "",
    infoMessage: "",
    signOut: jest.fn(),
  });
  useSupabaseAccount.mockReturnValue({
    configured: false,
    user: null,
    companyUser: null,
    membership: null,
    company: null,
    role: "",
    loading: false,
    error: "",
    hasCompany: false,
    refresh: jest.fn(),
  });
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
