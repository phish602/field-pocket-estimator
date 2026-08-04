import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import useVaultRuntimeActivation from "./lib/useVaultRuntimeActivation";
import useCloudAutoBackup from "./lib/useCloudAutoBackup";
import useCloudAutoConvergence from "./lib/useCloudAutoConvergence";
import useVaultDeviceRecovery from "./lib/useVaultDeviceRecovery";
import useSupabaseAuth from "./lib/useSupabaseAuth";
import useSupabaseAccount from "./lib/useSupabaseAccount";
import useVaultSession from "./lib/useVaultSession";
import useDeviceLockStatus from "./lib/useDeviceLockStatus";
import useVaultCompatibilityBridge from "./lib/useVaultCompatibilityBridge";
import {
  activateAccountScopedLocalStorage,
  deactivateAccountScopedLocalStorage,
  setActiveWorkspaceVaultCompatibility,
} from "./lib/accountScopedLocalStorage";
import { workspaceTag } from "./lib/vaultCrypto";

jest.mock("./lib/useSupabaseAuth", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    configured: true,
    loading: false,
    passwordRecoveryPending: false,
    session: { access_token: "test-session" },
    user: { id: "user-1" },
    signOut: jest.fn(),
  })),
}));
jest.mock("./lib/useSupabaseAccount", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    loading: false,
    error: "",
    hasCompany: true,
    membership: true,
    company: { id: "company-1" },
    role: "owner",
  })),
}));
jest.mock("./lib/useVaultSession", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    capability: { state: "unlocked", code: "" },
    checking: false,
    pending: false,
    refresh: jest.fn(),
    lock: jest.fn(),
  })),
}));
jest.mock("./lib/useVaultDeviceRecovery", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultRuntimeActivation", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoBackup", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoConvergence", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useDeviceLockStatus", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    ready: false, loading: false, isActive: false, isLocked: false,
  })),
}));
jest.mock("./lib/useVaultCompatibilityBridge", () => ({ __esModule: true, default: jest.fn(() => ({ state: "checking" })) }));
jest.mock("./lib/useVaultIdleLock", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/vaultCrypto", () => ({ workspaceTag: jest.fn().mockResolvedValue("A".repeat(43)) }));
jest.mock("./lib/vaultBridgeBuildPolicy", () => ({ VAULT_BRIDGE_RELEASE: false }));
jest.mock("./lib/accountScopedLocalStorage", () => ({
  activateAccountScopedLocalStorage: jest.fn(() => ({ ok: true, namespace: "test" })),
  deactivateAccountScopedLocalStorage: jest.fn(),
  setActiveWorkspaceVaultCompatibility: jest.fn(),
}));
jest.mock("./screens/VaultRecoveryGate", () => (props) => (
  <div data-testid="recovery-gate">{props.recovery.state}</div>
));

function recovery(state) {
  return {
    state,
    checking: state === "checking",
    pending: state === "recovering",
    retryable: state === "paused" || state === "blocked",
    code: "",
    counts: null,
    confirm: jest.fn(),
    retry: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useSupabaseAuth.mockReturnValue({
    configured: true,
    loading: false,
    passwordRecoveryPending: false,
    session: { access_token: "test-session" },
    user: { id: "user-1" },
    signOut: jest.fn(),
  });
  useSupabaseAccount.mockReturnValue({
    loading: false,
    error: "",
    hasCompany: true,
    membership: true,
    company: { id: "company-1" },
    role: "owner",
  });
  useVaultSession.mockReturnValue({
    capability: { state: "unlocked", code: "" },
    checking: false,
    pending: false,
    refresh: jest.fn(),
    lock: jest.fn(),
  });
  useDeviceLockStatus.mockReturnValue({
    ready: false, loading: false, isActive: false, isLocked: false,
  });
  useVaultCompatibilityBridge.mockReturnValue({ state: "checking" });
  activateAccountScopedLocalStorage.mockReturnValue({ ok: true, namespace: "test" });
  deactivateAccountScopedLocalStorage.mockImplementation(() => {});
  setActiveWorkspaceVaultCompatibility.mockImplementation(() => {});
  workspaceTag.mockResolvedValue("A".repeat(43));
});

test.each(["checking", "review", "recovering", "paused", "blocked"])(
  "keeps runtime, workers, and business shell disabled during %s recovery",
  async (state) => {
    useVaultDeviceRecovery.mockReturnValue(recovery(state));
    useVaultRuntimeActivation.mockReturnValue({ state: "disabled", flushAndLock: jest.fn() });

    render(<App />);

    await waitFor(() => expect(screen.getByTestId("recovery-gate")).toHaveTextContent(state));
    expect(useVaultRuntimeActivation).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: false,
    }));
    expect(useCloudAutoConvergence).toHaveBeenLastCalledWith(expect.objectContaining({
      configured: false,
      user: null,
      company: null,
    }));
    expect(useCloudAutoBackup).toHaveBeenLastCalledWith(expect.objectContaining({
      enabled: false,
      configured: false,
      user: null,
      company: null,
    }));
  }
);
