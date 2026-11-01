import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import AdvancedSettingsScreen from "./AdvancedSettingsScreen";
import useSupabaseAuth from "../lib/useSupabaseAuth";
import useSupabaseAccount from "../lib/useSupabaseAccount";
import useDeviceLockStatus from "../lib/useDeviceLockStatus";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";
import useCloudBackupStatus, { CLOUD_PRODUCT_STATE } from "../lib/useCloudBackupStatus";

jest.mock("../lib/useSupabaseAuth", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useSupabaseAccount", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useDeviceLockStatus", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useSupabaseWorkspaceBootstrap", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../lib/useCloudBackupStatus", () => {
  const actual = jest.requireActual("../lib/useCloudBackupStatus");
  return { ...actual, __esModule: true, default: jest.fn() };
});

const REMOVED_COPY = [
  "Developer Migration Tools",
  "Migration Preview",
  "Preview Local Data Migration",
  "Migration Write",
  "Migrate Local Data to Cloud",
  "Cloud Verification",
  "Verify Cloud Data",
  "MIGRATE",
  "BUNDLE",
  "PAYLOAD",
  "Update App Restore Bundle",
  "Update Estimate Restore Payloads",
  "Data Check",
  "Automatic cloud sync stopped",
  "data_mismatch",
  "Safe metadata repair completed",
  "Recheck Cloud Status",
  "Back Up This Device",
  "Advanced Recovery",
  "Replace Cloud Backup With This Device",
  "Developer Tools",
  "Export Raw App Data",
  "Import Backup JSON",
  "Development Sample Data",
  "Retry Sync",
];

function status(state, overrides = {}) {
  return {
    productState: state,
    productStatus: {
      state,
      pendingReason: "",
      lastSuccessfulSyncAt: null,
      lastSuccessfulBackupAt: null,
      ...overrides,
    },
    decision: {},
    onboardingStatus: null,
    restorePreview: null,
    refreshCloudStatus: jest.fn(),
  };
}

beforeEach(() => {
  localStorage.clear();
  useSupabaseAuth.mockReturnValue({
    configured: true,
    loading: false,
    authBusy: false,
    user: { id: "user-1" },
    userEmail: "owner@example.com",
    errorMessage: "",
    signOut: jest.fn(),
    missingEnvKeys: [],
  });
  useSupabaseAccount.mockReturnValue({
    companyUser: { id: "membership-1" },
    company: { id: "company-1", name: "BVW Contracting" },
    role: "owner",
    loading: false,
    error: "",
    hasCompany: true,
    refresh: jest.fn(),
  });
  useDeviceLockStatus.mockReturnValue({ ready: true, loading: false, isLocked: false, isActive: true });
  useSupabaseWorkspaceBootstrap.mockReturnValue({
    createWorkspace: jest.fn(),
    creating: false,
    error: "",
    success: "",
  });
  useCloudBackupStatus.mockReturnValue(status(CLOUD_PRODUCT_STATE.CLOUD_OK));
});

afterEach(cleanup);

test.each(["development", "production"])("%s Settings renders the same contractor-only cloud contract", (environment) => {
  render(<AdvancedSettingsScreen developerCloudToolsEnabled={environment === "development"} />);
  expect(screen.getByText("Cloud Backup")).toBeInTheDocument();
  expect(screen.getByText("Cloud account connected.")).toBeInTheDocument();
  expect(screen.getByText("Automatic backup is on.")).toBeInTheDocument();
  expect(screen.getByText("Cloud OK")).toBeInTheDocument();
  const rendered = document.body.textContent || "";
  REMOVED_COPY.forEach((copy) => expect(rendered).not.toContain(copy));
});

test.each([
  [CLOUD_PRODUCT_STATE.SYNCING, "Syncing", ""],
  [CLOUD_PRODUCT_STATE.PENDING, "Pending", "Your changes are saved on this device and will sync automatically."],
  [CLOUD_PRODUCT_STATE.SYNC_ISSUE, "Sync issue", "EstiPaid is having trouble syncing. Your changes are saved on this device and EstiPaid will retry automatically."],
])("canonical %s state is contractor-safe and actionless", (stateValue, label, detail) => {
  useCloudBackupStatus.mockReturnValue(status(stateValue));
  render(<AdvancedSettingsScreen developerCloudToolsEnabled />);
  expect(screen.getByText(label)).toBeInTheDocument();
  if (detail) expect(screen.getByText(detail)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /retry sync|back up|recheck|verify cloud/i })).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain("data_mismatch");
});

test("offline pending copy promises automatic continuation without a button", () => {
  useCloudBackupStatus.mockReturnValue(status(CLOUD_PRODUCT_STATE.PENDING, { pendingReason: "offline" }));
  render(<AdvancedSettingsScreen />);
  expect(screen.getByText("Your changes are saved on this device. Sync will continue automatically when you’re back online.")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /retry|recheck|back up/i })).not.toBeInTheDocument();
});

// The contractor-facing sync clock. Settings must read the ONE canonical
// timestamp the status hook derives, not the historical whole-workspace backup
// clock that the mutation-ledger cutover stopped writing.
test("Last synced shows the canonical newest sync proof", () => {
  const syncedAt = Date.parse("2026-08-26T17:00:00.000Z");
  useCloudBackupStatus.mockReturnValue(status(CLOUD_PRODUCT_STATE.CLOUD_OK, {
    lastSuccessfulSyncAt: syncedAt,
    lastSuccessfulBackupAt: syncedAt,
  }));

  render(<AdvancedSettingsScreen />);

  expect(screen.getByText(`Last synced ${new Date(syncedAt).toLocaleString()}`)).toBeInTheDocument();
});

test("no successful sync proof shows no Last synced line", () => {
  useCloudBackupStatus.mockReturnValue(status(CLOUD_PRODUCT_STATE.SYNC_ISSUE));

  render(<AdvancedSettingsScreen />);

  expect(screen.getByText("Sync issue")).toBeInTheDocument();
  expect(document.body.textContent).not.toContain("Last synced");
});
