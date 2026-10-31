import React from "react";
import "fake-indexeddb/auto";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import AdvancedSettingsScreen from "./AdvancedSettingsScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import { VAULT_COMPATIBILITY_GUARD_KEY } from "../lib/vaultCompatibilityGuard";
import useSupabaseAuth from "../lib/useSupabaseAuth";
import useSupabaseAccount from "../lib/useSupabaseAccount";
import useDeviceLockStatus from "../lib/useDeviceLockStatus";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";
import useCloudBackupStatus, { CLOUD_PRODUCT_STATE } from "../lib/useCloudBackupStatus";
import { checkSupabaseCloudOnboardingStatus, CLOUD_ONBOARDING_STATUS } from "../lib/supabaseCloudOnboarding";
import { executeSupabaseCloudRestore, previewSupabaseCloudRestore, CLOUD_RESTORE_STATUS } from "../lib/supabaseCloudRestore";

jest.mock("../lib/useSupabaseAuth", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useSupabaseAccount", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useDeviceLockStatus", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useSupabaseWorkspaceBootstrap", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useCloudBackupStatus", () => {
  const actual = jest.requireActual("../lib/useCloudBackupStatus");
  return { ...actual, __esModule: true, default: jest.fn() };
});
jest.mock("../lib/supabaseCloudOnboarding", () => {
  const actual = jest.requireActual("../lib/supabaseCloudOnboarding");
  return { ...actual, checkSupabaseCloudOnboardingStatus: jest.fn() };
});
jest.mock("../lib/supabaseCloudRestore", () => {
  const actual = jest.requireActual("../lib/supabaseCloudRestore");
  return { ...actual, executeSupabaseCloudRestore: jest.fn(), previewSupabaseCloudRestore: jest.fn() };
});

function cloudStatus(overrides = {}) {
  return {
    productState: CLOUD_PRODUCT_STATE.CLOUD_OK,
    productStatus: { state: CLOUD_PRODUCT_STATE.CLOUD_OK, pendingReason: "", lastSuccessfulBackupAt: null },
    decision: {},
    onboardingStatus: null,
    restorePreviewLoading: false,
    refreshCloudStatus: jest.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  jest.restoreAllMocks();
  useSupabaseAuth.mockReturnValue({ configured: true, missingEnvKeys: [], loading: false, authBusy: false, user: { id: "user-1" }, userEmail: "owner@example.com", errorMessage: "", signOut: jest.fn() });
  useSupabaseAccount.mockReturnValue({ companyUser: { id: "membership-1" }, company: { id: "company-1", name: "BVW Contracting" }, role: "owner", loading: false, error: "", hasCompany: true, refresh: jest.fn() });
  useDeviceLockStatus.mockReturnValue({ ready: true, loading: false, isLocked: false, isActive: true });
  useSupabaseWorkspaceBootstrap.mockReturnValue({ createWorkspace: jest.fn(), creating: false, error: "", success: "" });
  useCloudBackupStatus.mockReturnValue(cloudStatus());
});

test("keeps normal account, vault, template, report, and local danger-zone controls", () => {
  const lockNow = jest.fn();
  render(<AdvancedSettingsScreen onVaultLockNow={lockNow} snapshotAvailable />);
  expect(screen.getByText("owner@example.com")).toBeInTheDocument();
  expect(screen.getByText("BVW Contracting")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Lock Now" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Templates" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Open Snapshot" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Clear EstiPaid local data" })).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Lock Now" }));
  expect(lockNow).toHaveBeenCalledTimes(1);
});

test("clearing local business data preserves device-global vault authority", () => {
  localStorage.setItem(VAULT_COMPATIBILITY_GUARD_KEY, "guard-evidence");
  localStorage.setItem("estipaid-customers", "[{\"id\":\"customer-1\"}]");
  jest.spyOn(window, "confirm").mockReturnValue(true);
  render(<AdvancedSettingsScreen />);
  fireEvent.click(screen.getByRole("button", { name: "Clear EstiPaid local data" }));
  expect(localStorage.getItem(VAULT_COMPATIBILITY_GUARD_KEY)).toBe("guard-evidence");
  expect(localStorage.getItem("estipaid-customers")).toBeNull();
});

test("fresh-device restore remains available and uses the guarded restore flow", async () => {
  const prepare = jest.fn();
  useCloudBackupStatus.mockReturnValue(cloudStatus({ onboardingStatus: { status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE } }));
  previewSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.ELIGIBLE, eligible: true });
  executeSupabaseCloudRestore.mockResolvedValue({ status: CLOUD_RESTORE_STATUS.RESTORED, restored: true });
  checkSupabaseCloudOnboardingStatus.mockResolvedValue({ status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP });
  render(<AdvancedSettingsScreen onPrepareCloudRestore={prepare} />);
  fireEvent.click(await screen.findByRole("button", { name: "Restore Cloud to This Device" }));
  fireEvent.click(await screen.findByRole("button", { name: "Restore Data" }));
  await waitFor(() => expect(executeSupabaseCloudRestore).toHaveBeenCalledTimes(1));
  expect(executeSupabaseCloudRestore).toHaveBeenCalledWith(expect.objectContaining({ prepareSecureRestore: prepare }));
  expect(checkSupabaseCloudOnboardingStatus).toHaveBeenCalledTimes(1);
});
