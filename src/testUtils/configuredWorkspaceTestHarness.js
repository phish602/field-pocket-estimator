// ISO-14K -- TEST-ONLY harness for suites that exercise normal operational
// shell behavior.
//
// Since ISO-14I there is no fail-open shell: an unconfigured auth service
// renders the secure unavailable screen, and the dashboard mounts only after a
// real authenticated identity has activated and verified its account-scoped
// workspace. Suites that predate that gate used to get the shell for free; they
// now have to state the authenticated identity they are testing under.
//
// This file is imported ONLY by tests. It must never be imported by a
// production runtime module, and it never relaxes any production behavior: it
// supplies explicit mock return values and activates a real workspace namespace
// through the same production API the app uses.

import {
  activateAccountScopedLocalStorage,
  deactivateAccountScopedLocalStorage,
} from "../lib/accountScopedLocalStorage";
import { screen } from "@testing-library/react";

export const TEST_USER = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "app-test@example.test",
};

export const TEST_COMPANY = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "App Test Company",
};

export const TEST_MEMBERSHIP = Object.freeze({
  user_id: TEST_USER.id,
  company_id: TEST_COMPANY.id,
  role: "owner",
});

export function buildConfiguredAuthResult(overrides = {}) {
  return {
    configured: true,
    loading: false,
    session: { user: TEST_USER },
    user: TEST_USER,
    passwordRecoveryPending: false,
    passwordRecoveryReady: false,
    passwordRecoveryComplete: false,
    authBusy: false,
    errorMessage: "",
    infoMessage: "",
    userEmail: TEST_USER.email,
    rememberedEmail: "",
    signOut: jest.fn(),
    abandonPasswordRecovery: jest.fn(),
    signInWithPassword: jest.fn(),
    signUpWithPassword: jest.fn(),
    resetPasswordForEmail: jest.fn(),
    updatePassword: jest.fn(),
    completePasswordRecovery: jest.fn(),
    clearRememberedAccount: jest.fn(),
    ...overrides,
  };
}

export function buildConfiguredAccountResult(overrides = {}) {
  return {
    configured: true,
    user: TEST_USER,
    loading: false,
    error: "",
    company: TEST_COMPANY,
    membership: { ...TEST_MEMBERSHIP },
    companyUser: { ...TEST_MEMBERSHIP },
    hasCompany: true,
    role: "owner",
    refresh: jest.fn(),
    ...overrides,
  };
}

export function buildIdleDeviceLockResult(overrides = {}) {
  return { loading: false, ready: true, isLocked: false, isActive: true, ...overrides };
}

// Test-only public result for App suites whose subject intentionally starts
// beyond the encrypted-vault gate. Each suite must still mock the hook and opt
// into this result explicitly; this helper never alters production behavior.
export function buildUnlockedVaultSessionResult() {
  return {
    capability: Object.freeze({ state: "unlocked", code: "", message: "" }),
    checking: false,
    pending: false,
    error: null,
    setup: jest.fn(),
    unlock: jest.fn(),
    lock: jest.fn(),
    refresh: jest.fn(),
  };
}

export function buildLegacySafeVaultCompatibilityResult() {
  return {
    state: "legacy-safe",
    checking: false,
    code: "",
    message: "",
    refresh: jest.fn(),
  };
}

// Wait for an existing persistent shell control. The compatibility gate never
// renders this control, so this is a deterministic test-only readiness signal.
export async function waitForConfiguredWorkspaceShell() {
  return screen.findByLabelText(/open menu/i);
}

function mockModuleDefault(path) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mocked = require(path);
    const fn = mocked?.default;
    return typeof fn?.mockReturnValue === "function" ? fn : null;
  } catch {
    return null;
  }
}

// Sets the return values for whichever of the six hooks the calling suite has
// declared with `jest.mock(..., () => ({ __esModule: true, default: jest.fn() }))`.
// Hooks a suite did not mock are skipped, so partial harnesses keep working.
export function primeConfiguredWorkspaceMocks(overrides = {}) {
  mockModuleDefault("../lib/useSupabaseAuth")?.mockReturnValue(buildConfiguredAuthResult(overrides.auth));
  mockModuleDefault("../lib/useSupabaseAccount")?.mockReturnValue(buildConfiguredAccountResult(overrides.account));
  mockModuleDefault("../lib/useSupabaseWorkspaceBootstrap")?.mockReturnValue({
    createWorkspace: jest.fn(),
    creating: false,
    error: "",
    success: "",
    result: null,
    ...overrides.bootstrap,
  });
  mockModuleDefault("../lib/useDeviceLockStatus")?.mockReturnValue(buildIdleDeviceLockResult(overrides.deviceLock));
  mockModuleDefault("../lib/useCloudAutoBackup")?.mockReturnValue({ running: false, ...overrides.cloudAutoBackup });
  mockModuleDefault("../lib/useCloudAutoConvergence")?.mockReturnValue({ ...overrides.cloudAutoConvergence });
  mockModuleDefault("../lib/useVaultCompatibilityBridge")?.mockReturnValue(
    overrides.vaultCompatibility || { state: "checking", checking: true, code: "", message: "", refresh: jest.fn() }
  );
  primeVerifiedDeviceGuard(overrides.deviceGuard);
}

// Inside a configured workspace, every local business save is routed through
// the device-lock guard, which cannot confirm an active device without a live
// Supabase client (it answers "no_workspace", isActive: false). Suites that
// exercise ordinary shell behavior rather than device-lock policy mock
// ../lib/supabaseDeviceLock; this primes that mock with the verified,
// active-device answer.
//
// Priming must happen here rather than in the `jest.mock` factory: this project
// runs with jest's `resetMocks`, which strips any implementation passed to
// `jest.fn()` before each test, leaving the guard returning `undefined`.
export function primeVerifiedDeviceGuard(overrides = {}) {
  let deviceLockModule;
  try {
    // eslint-disable-next-line global-require
    deviceLockModule = require("../lib/supabaseDeviceLock");
  } catch {
    return;
  }
  const allow = (reason) => ({
    ok: true,
    code: "",
    reason,
    deviceLockLost: false,
    userMessage: "",
    error: "",
    ...overrides,
  });
  if (typeof deviceLockModule?.ensureCurrentDeviceCanMutateBusinessData?.mockImplementation === "function") {
    deviceLockModule.ensureCurrentDeviceCanMutateBusinessData
      .mockImplementation(async ({ reason = "local_save" } = {}) => allow(reason));
  }
  if (typeof deviceLockModule?.ensureCurrentDeviceCanWriteCloud?.mockImplementation === "function") {
    deviceLockModule.ensureCurrentDeviceCanWriteCloud
      .mockImplementation(async ({ reason = "cloud_write" } = {}) => allow(reason));
  }
}

// Opens the exact TEST_USER/TEST_COMPANY workspace through the production API
// so that fixture writes performed afterwards land in that namespace -- never
// as unscoped legacy values. Throws rather than letting a suite silently seed
// into the wrong place.
export function activateConfiguredTestWorkspace({ userId = TEST_USER.id, companyId = TEST_COMPANY.id } = {}) {
  const activation = activateAccountScopedLocalStorage({
    storage: window.localStorage,
    userId,
    companyId,
  });
  if (!activation.ok) {
    throw new Error(`configuredWorkspaceTestHarness: workspace activation failed (${activation.error})`);
  }
  return activation;
}

// One call for the common case: prime the mocked hooks, then open the scoped
// fixture workspace. Call it before seeding any EstiPaid fixture data.
export function setupConfiguredWorkspace(overrides = {}) {
  primeConfiguredWorkspaceMocks(overrides);
  return activateConfiguredTestWorkspace(overrides.identity);
}

// Cleanup order matters: drop the facade first so the real jsdom storage is
// back in place, and only then clear it. Clearing through the facade would
// (correctly) leave every other physical key untouched.
export function resetConfiguredTestWorkspace() {
  deactivateAccountScopedLocalStorage();
  try {
    window.localStorage.clear();
  } catch {
    /* a suite may have replaced storage; nothing further to clean */
  }
  jest.clearAllMocks();
}
