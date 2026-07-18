import { render, screen } from "@testing-library/react";
import App from "./App";

// Phase 2.1 -- proves the root routing branch that keeps a password-recovery
// session on the auth screen instead of the dashboard. No existing suite can
// prove this, because a recovery callback establishes a REAL session.

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

jest.mock("./lib/useCloudAutoConvergence", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./lib/useDeviceLockStatus", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./components/CloudHeaderStatusChip", () => ({
  __esModule: true,
  default: jest.fn(() => null),
}));

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
const useDeviceLockStatus = require("./lib/useDeviceLockStatus").default;
const useCloudAutoBackup = require("./lib/useCloudAutoBackup").default;
const useCloudAutoConvergence = require("./lib/useCloudAutoConvergence").default;
const { checkSupabaseCloudOnboardingStatus } = require("./lib/supabaseCloudOnboarding");

const USER = { id: "user_1", email: "owner@example.com" };

function buildAuthState(overrides = {}) {
  return {
    configured: true,
    missingEnvKeys: [],
    loading: false,
    authBusy: false,
    session: { user: USER },
    user: USER,
    userEmail: USER.email,
    rememberedEmail: "",
    errorMessage: "",
    infoMessage: "",
    passwordRecoveryPending: false,
    passwordRecoveryReady: false,
    passwordRecoveryComplete: false,
    abandonPasswordRecovery: jest.fn(),
    signInWithPassword: jest.fn(async () => ({ ok: true })),
    signUpWithPassword: jest.fn(async () => ({ ok: true })),
    resetPasswordForEmail: jest.fn(async () => ({ ok: true })),
    updatePassword: jest.fn(async () => ({ ok: true })),
    completePasswordRecovery: jest.fn(),
    clearRememberedAccount: jest.fn(),
    signOut: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  // Call history must be per-test so hook-input assertions are exact.
  jest.clearAllMocks();
  useSupabaseAccount.mockReturnValue({
    configured: true,
    user: USER,
    companyUser: null,
    membership: null,
    company: { id: "company_1" },
    role: "owner",
    loading: false,
    error: "",
    hasCompany: true,
    refresh: jest.fn(),
  });
  useDeviceLockStatus.mockReturnValue({
    loading: false,
    ready: true,
    isLocked: false,
    isActive: true,
    activeDeviceState: null,
  });
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: "already_backed_up" });
});

test("a verified password-recovery session renders the set-new-password form instead of the dashboard", () => {
  useSupabaseAuth.mockReturnValue(
    buildAuthState({ passwordRecoveryPending: true, passwordRecoveryReady: true })
  );

  render(<App />);

  expect(screen.getByText("Set A New Password")).toBeInTheDocument();
  expect(screen.getByLabelText("New Password")).toBeInTheDocument();
  // The dashboard shell must NOT be reachable while recovery is pending.
  expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument();
});

test("an UNVERIFIED recovery never exposes the dashboard and offers a way back", () => {
  useSupabaseAuth.mockReturnValue(
    buildAuthState({ passwordRecoveryPending: true, passwordRecoveryReady: false })
  );

  render(<App />);

  expect(screen.getByText("Reset Link Not Valid")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Back to Sign In/i })).toBeInTheDocument();
  expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument();
});

test("a completed recovery still holds the auth screen until the explicit continuation", () => {
  useSupabaseAuth.mockReturnValue(
    buildAuthState({
      passwordRecoveryPending: true,
      passwordRecoveryReady: true,
      passwordRecoveryComplete: true,
    })
  );

  render(<App />);

  expect(screen.getByText("Password Updated")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Continue to EstiPaid/i })).toBeInTheDocument();
  expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument();
});

// Finding 3 -- account and cloud workers must be inert during recovery.
test("pending recovery feeds every account and cloud worker a disabled/unconfigured state", () => {
  useSupabaseAuth.mockReturnValue(
    buildAuthState({ passwordRecoveryPending: true, passwordRecoveryReady: true })
  );

  render(<App />);

  expect(useSupabaseAccount).toHaveBeenCalledWith({ configured: false, user: null });
  expect(useDeviceLockStatus).toHaveBeenCalledWith(
    expect.objectContaining({ configured: false, user: null, enabled: false })
  );
  expect(useCloudAutoConvergence).toHaveBeenCalledWith(
    expect.objectContaining({ configured: false, user: null })
  );
  expect(useCloudAutoBackup).toHaveBeenCalledWith(
    expect.objectContaining({ configured: false, enabled: false, user: null })
  );
});

// Mid-abandon: sign-out is still in flight, so a live session coexists with a
// closed gate. Neither the dashboard nor any worker may come back during it.
test("an in-flight abandonment keeps the dashboard and every worker gated despite a live session", () => {
  useSupabaseAuth.mockReturnValue(
    buildAuthState({
      passwordRecoveryPending: true,
      passwordRecoveryReady: false,
      authBusy: true,
      session: { user: USER },
    })
  );

  render(<App />);

  expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument();
  expect(screen.getByText("Reset Link Not Valid")).toBeInTheDocument();
  expect(useSupabaseAccount).toHaveBeenCalledWith({ configured: false, user: null });
  expect(useDeviceLockStatus).toHaveBeenCalledWith(
    expect.objectContaining({ configured: false, user: null, enabled: false })
  );
  expect(useCloudAutoConvergence).toHaveBeenCalledWith(
    expect.objectContaining({ configured: false, user: null })
  );
  expect(useCloudAutoBackup).toHaveBeenCalledWith(
    expect.objectContaining({ configured: false, enabled: false, user: null })
  );
});

test("after explicit continuation the normal authenticated hook inputs are restored", () => {
  useSupabaseAuth.mockReturnValue(buildAuthState());

  render(<App />);

  expect(useSupabaseAccount).toHaveBeenCalledWith({ configured: true, user: USER });
  expect(useDeviceLockStatus).toHaveBeenCalledWith(
    expect.objectContaining({ configured: true, user: USER, enabled: true })
  );
  expect(useCloudAutoConvergence).toHaveBeenCalledWith(
    expect.objectContaining({ configured: true, user: USER })
  );
  expect(useCloudAutoBackup).toHaveBeenCalledWith(
    expect.objectContaining({ configured: true, enabled: true, user: USER })
  );
});

test("a normal authenticated session still renders the app shell (routing unchanged)", async () => {
  useSupabaseAuth.mockReturnValue(buildAuthState());

  render(<App />);

  expect(await screen.findByLabelText(/open menu/i)).toBeInTheDocument();
  expect(screen.queryByText("Set A New Password")).not.toBeInTheDocument();
});

test("no session still renders the normal sign-in screen (routing unchanged)", () => {
  useSupabaseAuth.mockReturnValue(buildAuthState({ session: null, user: null, userEmail: "" }));

  render(<App />);

  expect(screen.getByLabelText("Email")).toBeInTheDocument();
  expect(screen.getByLabelText("Password")).toBeInTheDocument();
  expect(screen.queryByText("Set A New Password")).not.toBeInTheDocument();
});
