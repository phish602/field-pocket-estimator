import { render, screen } from "@testing-library/react";
import App from "./App";

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

// Gate 13F: Home now also runs the cloud-restore-prompt onboarding check.
// Resolve it immediately here so this file's assertions (which finish
// synchronously after render) aren't racing an unmocked async Supabase call.
jest.mock("./lib/supabaseCloudOnboarding", () => ({
  __esModule: true,
  checkSupabaseCloudOnboardingStatus: jest.fn(),
  runSupabaseCloudOnboardingBackup: jest.fn(),
  CLOUD_ONBOARDING_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    NO_LOCAL_DATA: "no_local_data",
    CLOUD_AVAILABLE_EMPTY_DEVICE: "cloud_available_empty_device",
    READY_TO_BACKUP: "ready_to_backup",
    ALREADY_BACKED_UP: "already_backed_up",
    LOCAL_CLOUD_MISMATCH: "local_cloud_mismatch",
    BACKUP_COMPLETED: "backup_completed",
    NEEDS_ATTENTION: "needs_attention",
    ERROR: "error",
  },
}));

const useSupabaseAuth = require("./lib/useSupabaseAuth").default;
const useSupabaseAccount = require("./lib/useSupabaseAccount").default;
const useCloudAutoBackup = require("./lib/useCloudAutoBackup").default;
const { checkSupabaseCloudOnboardingStatus } = require("./lib/supabaseCloudOnboarding");

function buildAuthState(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function buildAccountState(overrides = {}) {
  return {
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
    ...overrides,
  };
}

beforeEach(() => {
  useSupabaseAccount.mockReturnValue(buildAccountState());
  useCloudAutoBackup.mockReturnValue({ running: false });
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: "already_backed_up" });
});

test("worker is disabled while signed out even when Supabase is configured", () => {
  useSupabaseAuth.mockReturnValue(buildAuthState({ configured: true, session: null }));

  render(<App />);

  expect(useCloudAutoBackup).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false })
  );
});

test("worker is disabled when Supabase is not configured, regardless of session", () => {
  useSupabaseAuth.mockReturnValue(buildAuthState({ configured: false, session: { user: { id: "u1" } } }));

  render(<App />);

  expect(useCloudAutoBackup).toHaveBeenCalledWith(
    expect.objectContaining({ enabled: false })
  );
});

test("worker is enabled only once signed in and Supabase is configured, using account company/role", async () => {
  const user = { id: "user_1", email: "owner@example.com" };
  useSupabaseAuth.mockReturnValue(buildAuthState({
    configured: true,
    user,
    userEmail: user.email,
    session: { user },
  }));
  useSupabaseAccount.mockReturnValue(buildAccountState({
    configured: true,
    user,
    company: { id: "company_1" },
    role: "owner",
    hasCompany: true,
  }));

  render(<App />);

  expect(useCloudAutoBackup).toHaveBeenCalledWith(
    expect.objectContaining({
      enabled: true,
      configured: true,
      user,
      company: { id: "company_1" },
      role: "owner",
    })
  );
  expect(await screen.findByLabelText(/open menu/i)).toBeInTheDocument();
});
