import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AdvancedSettingsScreen from "./AdvancedSettingsScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import useSupabaseAuth from "../lib/useSupabaseAuth";
import useSupabaseAccount from "../lib/useSupabaseAccount";
import useDeviceLockStatus from "../lib/useDeviceLockStatus";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";
import { createSupabaseMigrationPreview } from "../lib/supabaseMigrationPreview";
import { isSupabaseMigrationPreviewReady, runSupabaseMigrationWrite } from "../lib/supabaseMigrationWriter";
import { runSupabaseCloudVerification } from "../lib/supabaseCloudVerification";
import {
  checkSupabaseCloudOnboardingStatus,
  runSupabaseCloudOnboardingBackup,
  CLOUD_ONBOARDING_STATUS,
} from "../lib/supabaseCloudOnboarding";
import {
  previewSupabaseCloudRestore,
  executeSupabaseCloudRestore,
  exportSupabaseCloudBackupArtifact,
  CLOUD_RESTORE_STATUS,
  CLOUD_BACKUP_EXPORT_STATUS,
} from "../lib/supabaseCloudRestore";
import {
  updateEstimateRestorePayloads,
  ESTIMATE_PAYLOAD_UPDATE_STATUS,
} from "../lib/supabaseEstimateRestorePayload";
import {
  updateSupabaseAppRestoreBundle,
  APP_RESTORE_BUNDLE_STATUS,
} from "../lib/supabaseAppRestoreBundle";
import {
  markCloudBackupDirty,
  clearCloudBackupDirty,
  recordCloudBackupAttemptFailure,
} from "../lib/cloudBackupQueue";
import { CLOUD_AUTO_BACKUP_RUNNING_EVENT } from "../lib/useCloudAutoBackup";
import { scanLocalDataIntegrity } from "../lib/localDataIntegrity";

jest.mock("../lib/useSupabaseAuth", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../lib/useSupabaseAccount", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../lib/useDeviceLockStatus", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../lib/useSupabaseWorkspaceBootstrap", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../lib/supabaseMigrationPreview", () => ({
  __esModule: true,
  createSupabaseMigrationPreview: jest.fn(),
}));

jest.mock("../lib/supabaseMigrationWriter", () => ({
  __esModule: true,
  isSupabaseMigrationPreviewReady: jest.fn(),
  runSupabaseMigrationWrite: jest.fn(),
}));

jest.mock("../lib/supabaseCloudVerification", () => ({
  __esModule: true,
  runSupabaseCloudVerification: jest.fn(),
}));

jest.mock("../lib/supabaseCloudOnboarding", () => ({
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

jest.mock("../lib/supabaseCloudRestore", () => ({
  __esModule: true,
  previewSupabaseCloudRestore: jest.fn(),
  executeSupabaseCloudRestore: jest.fn(),
  exportSupabaseCloudBackupArtifact: jest.fn(),
  CLOUD_RESTORE_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    LOCAL_NOT_EMPTY: "local_not_empty",
    NO_CLOUD_DATA: "no_cloud_data",
    ELIGIBLE: "eligible",
    RESTORED: "restored",
    DEVICE_LOCKED: "device_locked",
    BLOCKED_UNSUPPORTED_SHAPE: "blocked_unsupported_shape",
    ERROR: "error",
  },
  CLOUD_BACKUP_EXPORT_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    EXPORTED: "exported",
    ERROR: "error",
  },
  CLOUD_BACKUP_EXPORT_ARTIFACT_VERSION: "cloud-backup-export-artifact-v1",
  CLOUD_RESTORE_STOPPED_MESSAGE: "Recovery stopped because EstiPaid was switched to another device.",
}));

jest.mock("../lib/supabaseEstimateRestorePayload", () => ({
  __esModule: true,
  updateEstimateRestorePayloads: jest.fn(),
  ESTIMATE_PAYLOAD_UPDATE_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    NO_LOCAL_ESTIMATES: "no_local_estimates",
    COMPLETED: "completed",
    ERROR: "error",
  },
}));

jest.mock("../lib/supabaseAppRestoreBundle", () => ({
  __esModule: true,
  updateSupabaseAppRestoreBundle: jest.fn(),
  APP_RESTORE_BUNDLE_STATUS: {
    SIGNED_OUT: "signed_out",
    NO_WORKSPACE: "no_workspace",
    ROLE_NOT_ALLOWED: "role_not_allowed",
    COMPLETED: "completed",
    ERROR: "error",
  },
}));

function buildAuthState(overrides = {}) {
  return {
    configured: false,
    missingEnvKeys: ["REACT_APP_SUPABASE_URL", "REACT_APP_SUPABASE_ANON_KEY"],
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

function buildWorkspaceBootstrapState(overrides = {}) {
  return {
    createWorkspace: jest.fn(() => ({ ok: true })),
    creating: false,
    error: "",
    success: "",
    result: null,
    ...overrides,
  };
}

beforeEach(() => {
  useDeviceLockStatus.mockReturnValue({
    loading: false,
    ready: true,
    isLocked: false,
    isActive: true,
    activeDeviceState: null,
  });
});

describe("AdvancedSettingsScreen diagnostics export", () => {
  let createObjectURLSpy;
  let revokeObjectURLSpy;
  let appendChildSpy;
  let clickSpy;
  let setItemSpy;
  let capturedBlob = null;

  function readBlobText(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Unable to read blob"));
      reader.readAsText(blob);
    });
  }

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEYS.CLOUD_BACKUP_QUEUE);
    useSupabaseAuth.mockReturnValue(buildAuthState());
    useSupabaseAccount.mockReturnValue(buildAccountState());
    useSupabaseWorkspaceBootstrap.mockReturnValue(buildWorkspaceBootstrapState());
    createSupabaseMigrationPreview.mockReset();
    runSupabaseMigrationWrite.mockReset();
    isSupabaseMigrationPreviewReady.mockReset();
    runSupabaseCloudVerification.mockReset();
    checkSupabaseCloudOnboardingStatus.mockReset();
    runSupabaseCloudOnboardingBackup.mockReset();
    previewSupabaseCloudRestore.mockReset();
    executeSupabaseCloudRestore.mockReset();
    exportSupabaseCloudBackupArtifact.mockReset();
    updateEstimateRestorePayloads.mockReset();
    updateSupabaseAppRestoreBundle.mockReset();
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.NO_CLOUD_DATA,
      eligible: false,
      partial: false,
      cloudCounts: null,
      localCounts: null,
      blockers: [],
      notices: [],
      noWritesPerformed: true,
    });
    updateSupabaseAppRestoreBundle.mockResolvedValue({
      status: APP_RESTORE_BUNDLE_STATUS.COMPLETED,
      bundleUpdated: true,
      noLocalDataChanged: true,
      captureSummary: {
        companyProfileCaptured: true,
        logoDataUrlCaptured: true,
        settingsCaptured: true,
        scopeTemplatesCaptured: true,
      },
      notices: [],
    });
    createSupabaseMigrationPreview.mockResolvedValue({
      validations: {
        supabaseConfigured: true,
        signedIn: true,
        hasCompany: true,
        roleAllowedForMigration: true,
        backupDownloadAvailable: true,
        exportArtifactBuilt: true,
        localDataReadable: true,
      },
      company: { id: "company_1", name: "Field Pocket LLC", role: "owner" },
      localCounts: {
        customers: 1,
        projects: 1,
        estimates: 1,
        estimateLineItems: 1,
        invoices: 1,
        invoiceLineItems: 1,
        invoicePayments: 1,
        scopeTemplates: 1,
        settings: 1,
      },
      cloudCounts: {
        customers: 0,
        projects: 0,
        estimates: 0,
        estimateLineItems: 0,
        invoices: 0,
        invoiceLineItems: 0,
        invoicePayments: 0,
      },
      cloudCountCheckAvailable: true,
      cloudCountStatusMessage: "Cloud count check completed.",
      notices: [
        { level: "info", code: "line_items_waiting_for_core", message: "Line items will migrate after core customer/project/document rows are present in cloud for this workspace." },
      ],
      noWritesPerformed: true,
    });
    isSupabaseMigrationPreviewReady.mockImplementation((preview) => Boolean(preview));
    runSupabaseMigrationWrite.mockResolvedValue({
      ok: true,
      reason: "",
      notices: [],
      tableResults: [
        { table: "customers", label: "Customers", status: "success", written: 1, skipped: 0, failed: 0 },
        { table: "projects", label: "Projects", status: "success", written: 1, skipped: 0, failed: 0 },
        { table: "estimates", label: "Estimates", status: "success", written: 1, skipped: 0, failed: 0 },
        { table: "estimate_line_items", label: "Estimate line items", status: "success", written: 1, skipped: 0, failed: 0 },
        { table: "invoices", label: "Invoices", status: "success", written: 1, skipped: 0, failed: 0 },
        { table: "invoice_line_items", label: "Invoice line items", status: "success", written: 1, skipped: 0, failed: 0 },
        { table: "invoice_payments", label: "Invoice payments", status: "success", written: 1, skipped: 0, failed: 0 },
      ],
      noLocalDeletes: true,
    });
    localStorage.clear();
    localStorage.setItem(
      STORAGE_KEYS.COMPANY_PROFILE,
      JSON.stringify({
        id: "company_1",
        companyName: "Field Pocket",
        email: "support@fieldpocket.example",
        phone: "555-123-4567",
        address: "123 Main St",
        notes: "Internal support note",
      }),
    );
    localStorage.setItem(
      STORAGE_KEYS.CUSTOMERS,
      JSON.stringify([
        {
          id: "cust_1",
          name: "Acme Co",
          email: "customer@example.com",
          phone: "555-000-0000",
          address: "10 Market St",
        },
      ]),
    );
    localStorage.setItem(
      STORAGE_KEYS.PROJECTS,
      JSON.stringify([{ id: "proj_1", customerId: "cust_1", name: "Roof Repair" }]),
    );
    localStorage.setItem(
      STORAGE_KEYS.ESTIMATES,
      JSON.stringify([{ id: "est_1", projectId: "proj_1", status: "approved" }]),
    );
    localStorage.setItem(
      STORAGE_KEYS.INVOICES,
      JSON.stringify([{ id: "inv_1", projectId: "proj_1", invoiceTotal: 100, amountPaid: 25, balanceRemaining: 75 }]),
    );
    localStorage.setItem(
      STORAGE_KEYS.SCOPE_TEMPLATES,
      JSON.stringify([{ id: "tmpl_1", name: "Support scope", scopeNotes: "Hidden notes" }]),
    );
    localStorage.setItem(
      STORAGE_KEYS.AUDIT_EVENTS,
      JSON.stringify({
        schemaVersion: "1.0.0",
        updatedAt: 1710000000000,
        events: [
          {
            id: "evt_existing",
            type: "invoice.created",
            targetType: "invoice",
            targetId: "inv_1",
            createdAt: 1710000000000,
            metadata: {
              invoiceId: "inv_1",
              projectId: "proj_1",
            },
          },
        ],
      }),
    );

    capturedBlob = null;
    jest.useFakeTimers();

    if (typeof URL.createObjectURL !== "function") {
      URL.createObjectURL = jest.fn();
    }
    if (typeof URL.revokeObjectURL !== "function") {
      URL.revokeObjectURL = jest.fn();
    }

    createObjectURLSpy = jest.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
      capturedBlob = blob;
      return "blob:diagnostics";
    });
    revokeObjectURLSpy = jest.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
    appendChildSpy = jest.spyOn(document.body, "appendChild");
    clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    setItemSpy = jest.spyOn(Storage.prototype, "setItem");
  });

  afterEach(() => {
    act(() => {
      jest.runOnlyPendingTimers();
    });
    jest.useRealTimers();
    jest.restoreAllMocks();
    localStorage.clear();
    capturedBlob = null;
    createObjectURLSpy = null;
    revokeObjectURLSpy = null;
    appendChildSpy = null;
    clickSpy = null;
    setItemSpy = null;
  });

  test("exports a redacted support bundle with read-only data", async () => {
    render(<AdvancedSettingsScreen />);

    fireEvent.click(screen.getByRole("button", { name: /export diagnostics/i }));

    expect(screen.getByRole("status")).toHaveTextContent("Diagnostics JSON exported.");
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(capturedBlob).toBeTruthy();

    const appendedAnchor = appendChildSpy.mock.calls
      .map(([node]) => node)
      .find((node) => node?.tagName === "A");
    expect(appendedAnchor).toBeTruthy();
    expect(appendedAnchor.download).toMatch(/^estipaid-diagnostics-\d{4}-\d{2}-\d{2}\.json$/);

    const payload = JSON.parse(await readBlobText(capturedBlob));
    expect(payload.bundleMeta.routeContext).toBe("advanced_settings");
    expect(payload.recordInventory.customers.count).toBe(1);
    expect(payload.recordInventory.projects.count).toBe(1);
    expect(payload.recordInventory.estimates.count).toBe(1);
    expect(payload.recordInventory.invoices.count).toBe(1);
    expect(payload.recordInventory.auditEvents.count).toBe(1);
    expect(payload.sourceSnapshots.companyProfile.email).toBe("[redacted]");
    expect(payload.sourceSnapshots.companyProfile.notes).toBe("[redacted]");
    expect(payload.sourceSnapshots.customers[0].address).toBe("[redacted]");
    expect(payload.sourceSnapshots.scopeTemplates[0].scopeNotes).toBe("[redacted]");
    expect(payload.sourceSnapshots.invoices[0].invoiceTotal).toBe(100);
    expect(payload.sourceSnapshots.auditEvents).toEqual([
      expect.objectContaining({
        id: "evt_existing",
        type: "invoice.created",
      }),
    ]);
    expect(payload.recentEvents).toEqual([
      expect.objectContaining({
        id: "evt_existing",
        type: "invoice.created",
      }),
    ]);

    const storedAuditEvents = JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT_EVENTS) || "{}");
    expect(storedAuditEvents.events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "evt_existing",
        type: "invoice.created",
      }),
      expect.objectContaining({
        type: "diagnostic_bundle.exported",
        targetType: "diagnostic_bundle",
        source: "advanced_settings",
        reason: "manual_export",
      }),
    ]));
    expect(setItemSpy).toHaveBeenCalledWith(
      STORAGE_KEYS.AUDIT_EVENTS,
      expect.stringContaining("\"diagnostic_bundle.exported\""),
    );

    act(() => {
      jest.runOnlyPendingTimers();
    });

    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:diagnostics");
  });

  test("renders settings ownership shortcuts and developer tool labels", () => {
    const onOpenCompanyProfile = jest.fn();
    const onOpenTemplates = jest.fn();
    const onOpenSnapshot = jest.fn();

    render(
      <AdvancedSettingsScreen
        onOpenCompanyProfile={onOpenCompanyProfile}
        onOpenTemplates={onOpenTemplates}
        onOpenSnapshot={onOpenSnapshot}
        snapshotAvailable
      />
    );

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByText(/Configure business defaults, document behavior, internal visibility, and local tools/i)).toBeInTheDocument();
    expect(screen.getByText("Business Profile")).toBeInTheDocument();
    expect(screen.getByText("Account")).toBeInTheDocument();
    expect(screen.getByText("Templates")).toBeInTheDocument();
    expect(screen.getByText("Reports & Bookkeeping")).toBeInTheDocument();
    expect(screen.getByText("Developer Tools")).toBeInTheDocument();
    expect(screen.getByText(/Supabase not configured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download This Device Backup JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Raw App Data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Backup JSON" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Business Profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Templates" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Snapshot" }));

    expect(onOpenCompanyProfile).toHaveBeenCalledTimes(1);
    expect(onOpenTemplates).toHaveBeenCalledTimes(1);
    expect(onOpenSnapshot).toHaveBeenCalledTimes(1);
  });

  test("shows signed-out fallback guidance without duplicate login fields", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
    }));

    render(<AdvancedSettingsScreen />);

    expect(screen.getAllByText("Sign in from the welcome screen to use cloud backup.").length).toBeGreaterThan(0);
    expect(screen.queryByLabelText("Account email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Account password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Email Sign-In Link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with password" })).not.toBeInTheDocument();
  });

  test("shows signed-in cloud account state and allows sign out", async () => {
    const signOut = jest.fn();
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_1", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_1", email: "owner@example.com" } },
      signOut,
    }));

    render(<AdvancedSettingsScreen />);

    expect(screen.getByText(/Signed in as:/i)).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.queryByLabelText("Account email")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Account password")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Email Sign-In Link" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with password" })).not.toBeInTheDocument();
    expect(screen.getByText("Cloud account connected.")).toBeInTheDocument();
    expect(screen.getByText("Backup and restore are available for this workspace.")).toBeInTheDocument();
    expect(screen.queryByText(/Data migration\/sync not enabled yet/i)).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    });
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test("shows company name and role when a read-only membership exists", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled />);
    });

    expect(screen.getByText(/Company:/i)).toBeInTheDocument();
    expect(screen.getByText("Field Pocket LLC")).toBeInTheDocument();
    expect(screen.getByText(/Role:/i)).toBeInTheDocument();
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByText("Cloud account connected.")).toBeInTheDocument();
    expect(screen.getByText("Backup and restore are available for this workspace.")).toBeInTheDocument();
    expect(screen.queryByText(/Data migration\/sync not enabled yet/i)).not.toBeInTheDocument();
  });

  test("shows migration preview results without performing writes", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview Local Data Migration" }));
    });

    expect(createSupabaseMigrationPreview).toHaveBeenCalledWith(expect.objectContaining({
      storageSnapshot: localStorage,
      configured: true,
      company: expect.objectContaining({ id: "company_1", name: "Field Pocket LLC" }),
      role: "owner",
      backupDownloadAvailable: true,
    }));
    expect(screen.getByText(/Current workspace:/i)).toBeInTheDocument();
    expect(screen.getByText(/Current role:/i)).toBeInTheDocument();
    expect(screen.getByText(/Local counts: customers/i)).toBeInTheDocument();
    expect(screen.getByText(/Local line items: estimate/i)).toBeInTheDocument();
    expect(screen.getByText(/Cloud counts: customers 0, projects 0, estimates 0, invoices 0, invoice payments 0\./i)).toBeInTheDocument();
    expect(screen.getByText(/Cloud line items: estimate 0, invoice 0\./i)).toBeInTheDocument();
    expect(screen.getByText(/Line items will migrate after core customer\/project\/document rows are present in cloud/i)).toBeInTheDocument();
    expect(screen.getByText(/No Supabase writes were performed\./i)).toBeInTheDocument();
  });

  test("shows cloud verification results without performing writes", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    runSupabaseCloudVerification.mockResolvedValue({
      ok: true,
      company: { id: "company_1", name: "Field Pocket LLC" },
      validations: { supabaseConfigured: true, signedIn: true, hasCompany: true },
      localCounts: {
        customers: 1,
        projects: 1,
        estimates: 1,
        invoices: 1,
        invoicePayments: 1,
        estimateLineItems: 1,
        invoiceLineItems: 1,
      },
      tableResults: [
        { table: "customers", localCount: 1, cloudCount: 1, status: "matched", missingLegacyIds: [], extraLegacyIds: [], countOnly: false },
        { table: "projects", localCount: 1, cloudCount: 1, status: "matched", missingLegacyIds: [], extraLegacyIds: [], countOnly: false },
        { table: "estimates", localCount: 1, cloudCount: 1, status: "matched", missingLegacyIds: [], extraLegacyIds: [], countOnly: false },
        { table: "invoices", localCount: 1, cloudCount: 1, status: "matched", missingLegacyIds: [], extraLegacyIds: [], countOnly: false },
        { table: "invoice_payments", localCount: 1, cloudCount: 1, status: "matched", missingLegacyIds: [], extraLegacyIds: [], countOnly: false },
        { table: "estimate_line_items", localCount: 1, cloudCount: 1, status: "matched", missingLegacyIds: [], extraLegacyIds: [], countOnly: true },
        { table: "invoice_line_items", localCount: 1, cloudCount: 1, status: "matched", missingLegacyIds: [], extraLegacyIds: [], countOnly: true },
      ],
      allMatched: true,
      notices: [
        { level: "info", code: "cloud_verification_passed", message: "Cloud verification passed. Supabase data matches local migration data." },
      ],
      noWritesPerformed: true,
    });

    const { container } = render(<AdvancedSettingsScreen developerCloudToolsEnabled />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Verify Cloud Data" }));
    });

    expect(runSupabaseCloudVerification).toHaveBeenCalledWith(expect.objectContaining({
      storageSnapshot: localStorage,
      configured: true,
      company: expect.objectContaining({ id: "company_1", name: "Field Pocket LLC" }),
    }));
    expect(container.textContent).toMatch(/customers: local 1, cloud 1.*matched/i);
    expect(container.textContent).toMatch(/estimate_line_items: local 1, cloud 1.*matched/i);
    expect(container.textContent).toMatch(/invoice_line_items: local 1, cloud 1.*matched/i);
    expect(container.textContent).toMatch(/Cloud verification passed\. Supabase data matches local migration data\./i);
    expect(screen.getAllByText(/No Supabase writes were performed\./i).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cloud verification passed. Supabase data matches local migration data.").length).toBe(1);
  });

  test("signed-out state shows sign-in guidance and performs no onboarding calls", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: null,
      userEmail: "",
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: null,
      company: null,
      hasCompany: false,
    }));

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled={false} />);
    });

    expect(screen.getAllByText("Sign in from the welcome screen to use cloud backup.").length).toBeGreaterThan(0);
    expect(screen.queryByText("Developer Migration Tools")).not.toBeInTheDocument();
    expect(checkSupabaseCloudOnboardingStatus).not.toHaveBeenCalled();
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  });

  test("no workspace state blocks backup with guidance and no onboarding calls", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      company: null,
      hasCompany: false,
    }));

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled={false} />);
    });

    expect(screen.getByText("Create a cloud workspace before backing up your data.")).toBeInTheDocument();
    expect(checkSupabaseCloudOnboardingStatus).not.toHaveBeenCalled();
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  });

  test("already matched cloud data shows backed-up success without calling migration write", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP,
      preview: null,
      verification: { ok: true, allMatched: true },
      writeResult: null,
      noWritesPerformed: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled={false} />);
    });

    expect(screen.getByText("Cloud backup is up to date.")).toBeInTheDocument();
    expect(screen.getByText("Cloud data matches this device.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back Up This Device" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore Cloud Data to This Device" })).not.toBeInTheDocument();
    expect(runSupabaseMigrationWrite).not.toHaveBeenCalled();
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    expect(previewSupabaseCloudRestore).not.toHaveBeenCalled();
    expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
  });

  test("ready local data state offers Back Up This Device", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("This device has work that is not backed up yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back Up This Device" })).toBeInTheDocument();
  });

  test("automatic safe repair failure hides repair jargon and shows contractor-safe retry copy", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));

    const staleInvoice = {
      id: "inv_1",
      projectId: "missing_project",
      customerId: "cust_1",
      invoiceNumber: "INV-100",
      status: "sent",
      invoiceTotal: 100,
      total: 100,
      amountPaid: 25,
      balanceRemaining: 75,
      payments: [{ id: "pay_1", amount: 25 }],
    };
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([staleInvoice]));

    const staleIntegrity = scanLocalDataIntegrity({
      customers: [{ id: "cust_1", name: "Acme Co" }],
      projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
      estimates: [{ id: "est_1", projectId: "proj_1", status: "approved" }],
      invoices: [staleInvoice],
    });
    expect(staleIntegrity.blockers).toHaveLength(0);
    expect(staleIntegrity.safeRepairs).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "invoice_project_stale" }),
    ]));

    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
      preview: { integrity: staleIntegrity },
      verification: null,
      writeResult: null,
      noWritesPerformed: false,
      automaticSafeRepair: {
        attempted: true,
        failed: true,
        technicalDetail: "Safe repair can detach a stale project link on 1 invoice.",
      },
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud backup needs attention.")).toBeInTheDocument();
    expect(screen.getByText("We could not finish protecting this device automatically.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Repair Safe Metadata" })).not.toBeInTheDocument();
    expect(screen.queryByText(/stale project link/i)).not.toBeInTheDocument();
  });

  test("cloud_available_empty_device state explains a fresh device, offers restore only after eligibility check, and never calls migration write", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.ELIGIBLE,
      eligible: true,
      partial: false,
      cloudCounts: { customers: 7, projects: 9, estimates: 0, invoices: 10, invoice_payments: 3, estimate_line_items: 0, invoice_line_items: 21 },
      localCounts: { customers: 0, projects: 0, estimates: 0, invoices: 0 },
      blockers: [],
      notices: [{
        level: "warning",
        code: "supplemental_restore_not_available",
        message: "Business records can be restored on an empty device, but company profile, logo, settings, and scope templates are not part of Supabase restore yet. They need a separate backup/update step.",
      }],
      noWritesPerformed: true,
    });

    const setItemSpy = jest.spyOn(window.localStorage.__proto__, "setItem");

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud data found.")).toBeInTheDocument();
    expect(screen.getByText("This device has no saved work yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Back Up This Device" })).not.toBeInTheDocument();
    expect(screen.queryByText("Developer Migration Tools")).not.toBeInTheDocument();
    expect(previewSupabaseCloudRestore).toHaveBeenCalledWith(expect.objectContaining({
      storageSnapshot: localStorage,
      configured: true,
      company: expect.objectContaining({ id: "company_1" }),
    }));
    const restoreButton = screen.getByRole("button", { name: "Restore Cloud Data to This Device" });
    expect(restoreButton).not.toBeDisabled();
    expect(screen.queryByLabelText("Type RESTORE to confirm")).not.toBeInTheDocument();
    expect(runSupabaseMigrationWrite).not.toHaveBeenCalled();
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  test("clicking Restore Cloud Data to This Device runs the explicit restore and shows success with no overwrite/delete messages", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.ELIGIBLE,
      eligible: true,
      partial: false,
      cloudCounts: { customers: 7, projects: 9, estimates: 0, invoices: 10, invoice_payments: 3, estimate_line_items: 0, invoice_line_items: 21 },
      localCounts: { customers: 0, projects: 0, estimates: 0, invoices: 0 },
      blockers: [],
      notices: [{
        level: "warning",
        code: "supplemental_restore_not_available",
        message: "Business records can be restored on an empty device, but company profile, logo, settings, and scope templates are not part of Supabase restore yet. They need a separate backup/update step.",
      }],
      noWritesPerformed: true,
    });
    executeSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.RESTORED,
      restored: true,
      partial: false,
      restoredCounts: { customers: 7, projects: 9, invoices: 10 },
      blockers: [],
      notices: [{
        level: "warning",
        code: "supplemental_restore_not_available",
        message: "Business records can be restored on an empty device, but company profile, logo, settings, and scope templates are not part of Supabase restore yet. They need a separate backup/update step.",
      }],
      noWritesPerformed: false,
      noCloudDataDeleted: true,
      noExistingLocalDataOverwritten: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Cloud Data to This Device" }));
    });

    expect(screen.getByRole("dialog", { name: "Restore cloud data to this device?" })).toBeInTheDocument();
    expect(screen.getByText("This will copy your cloud backup onto this device.")).toBeInTheDocument();
    expect(screen.getByText("It will not delete your cloud backup.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Data" }));
    });

    expect(executeSupabaseCloudRestore).toHaveBeenCalledWith(expect.objectContaining({
      storage: localStorage,
      configured: true,
      company: expect.objectContaining({ id: "company_1" }),
    }));
    expect(screen.getByText("Cloud data restored to this device.")).toBeInTheDocument();
    expect(screen.getByText("No cloud data was deleted.")).toBeInTheDocument();
    expect(screen.getByText("No existing local data was overwritten.")).toBeInTheDocument();
    expect(screen.queryByText("Business records restored. Company profile, logo, settings, and scope templates need a separate backup/update step.")).not.toBeInTheDocument();
  });

  function mockSignedInWithCompany() {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });
  }

  function buildPartialLocalSnapshotIntegrity() {
    return scanLocalDataIntegrity({
      customers: [{ id: "cust_1", name: "Acme Co" }],
      projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
      estimates: [],
      invoices: [{
        id: "inv_1",
        projectId: "proj_1",
        customerId: "cust_1",
        invoiceNumber: "INV-1",
        sourceEstimateId: "est_1",
        total: 100,
        amountPaid: 0,
        balanceRemaining: 100,
        payments: [],
      }],
    });
  }

  test("shows the calm automatic backup pending status when the Gate 13A queue is dirty", async () => {
    mockSignedInWithCompany();
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"], severity: "normal" });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud sync")).toBeInTheDocument();
    expect(
      screen.getByText("Your changes are saved on this device and will sync automatically.")
    ).toBeInTheDocument();
  });

  test("partial local snapshot state renders restore, download, and recheck actions instead of backup", async () => {
    mockSignedInWithCompany();
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP,
      preview: { integrity: buildPartialLocalSnapshotIntegrity() },
      verification: { ok: true, allMatched: true },
      writeResult: null,
      noWritesPerformed: true,
    });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.ELIGIBLE,
      eligible: true,
      partial: false,
      blockers: [],
      notices: [],
      noWritesPerformed: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("This device has a partial local snapshot.")).toBeInTheDocument();
    expect(screen.getByText(/Backing up this device is blocked so the cloud backup is not overwritten with incomplete local data\./)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Recheck Cloud Status" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download This Device Backup JSON" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "Back Up This Device" })).not.toBeInTheDocument();
    expect(screen.queryByText(/cannot safely rebuild the missing local records/i)).not.toBeInTheDocument();
  });

  test("partial local snapshot restore uses the existing confirmation flow and guarded restore handler", async () => {
    mockSignedInWithCompany();
    checkSupabaseCloudOnboardingStatus
      .mockResolvedValueOnce({
        onboardingVersion: "supabase-cloud-onboarding-v1",
        status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP,
        preview: { integrity: buildPartialLocalSnapshotIntegrity() },
        verification: { ok: true, allMatched: true },
        writeResult: null,
        noWritesPerformed: true,
      })
      .mockResolvedValueOnce({
        onboardingVersion: "supabase-cloud-onboarding-v1",
        status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP,
        preview: null,
        verification: { ok: true, allMatched: true },
        writeResult: null,
        noWritesPerformed: true,
      });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.ELIGIBLE,
      eligible: true,
      partial: false,
      blockers: [],
      notices: [],
      noWritesPerformed: true,
    });
    executeSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.RESTORED,
      restored: true,
      partial: false,
      restoredCounts: { customers: 7, projects: 10, estimates: 8, invoices: 9 },
      blockers: [],
      notices: [],
      noWritesPerformed: false,
      noCloudDataDeleted: true,
      noExistingLocalDataOverwritten: false,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Cloud to This Device" }));
    });

    expect(screen.getByRole("dialog", { name: "Restore cloud data to this device?" })).toBeInTheDocument();
    expect(screen.getByText("This device has invoices but missing estimates. Restoring cloud data is the safe recovery path.")).toBeInTheDocument();
    expect(screen.getByText("This will overwrite this device's incomplete local data with cloud data.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Data" }));
    });

    expect(executeSupabaseCloudRestore).toHaveBeenCalledWith(expect.objectContaining({
      storage: localStorage,
      configured: true,
      company: expect.objectContaining({ id: "company_1" }),
      allowPartialLocalSnapshot: true,
    }));
  });

  test("restore lock loss shows the recovery-stopped message instead of generic success or failure copy", async () => {
    mockSignedInWithCompany();
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.ELIGIBLE,
      eligible: true,
      partial: false,
      blockers: [],
      notices: [],
      noWritesPerformed: true,
    });
    executeSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.DEVICE_LOCKED,
      restored: false,
      deviceLockLost: true,
      error: "Recovery stopped because EstiPaid was switched to another device.",
      noWritesPerformed: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Cloud Data to This Device" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Data" }));
    });

    expect(screen.getByText("Recovery stopped because EstiPaid was switched to another device.")).toBeInTheDocument();
    expect(screen.queryByText("Cloud data restored to this device.")).not.toBeInTheDocument();
  });

  test("partial local snapshot recheck keeps the blocker visible and explains that restore is still required", async () => {
    mockSignedInWithCompany();
    checkSupabaseCloudOnboardingStatus
      .mockResolvedValueOnce({
        onboardingVersion: "supabase-cloud-onboarding-v1",
        status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP,
        preview: { integrity: buildPartialLocalSnapshotIntegrity() },
        verification: { ok: true, allMatched: true },
        writeResult: null,
        noWritesPerformed: true,
      })
      .mockResolvedValueOnce({
        onboardingVersion: "supabase-cloud-onboarding-v1",
        status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP,
        preview: { integrity: buildPartialLocalSnapshotIntegrity() },
        verification: { ok: true, allMatched: true },
        writeResult: null,
        noWritesPerformed: true,
      });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.ELIGIBLE,
      eligible: true,
      partial: false,
      blockers: [],
      notices: [],
      noWritesPerformed: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recheck Cloud Status" }));
    });

    expect(screen.getByText("Recheck complete. This device still has invoices but no local estimates. Restore cloud data to this device to rebuild the missing local records.")).toBeInTheDocument();
    expect(screen.getByText("This device has a partial local snapshot.")).toBeInTheDocument();
  });

  test("partial local snapshot with non-restorable cloud backup explains why restore is blocked and does not recommend restore", async () => {
    mockSignedInWithCompany();
    checkSupabaseCloudOnboardingStatus
      .mockResolvedValueOnce({
        onboardingVersion: "supabase-cloud-onboarding-v1",
        status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP,
        preview: { integrity: buildPartialLocalSnapshotIntegrity() },
        verification: { ok: true, allMatched: true },
        writeResult: null,
        noWritesPerformed: true,
      })
      .mockResolvedValueOnce({
        onboardingVersion: "supabase-cloud-onboarding-v1",
        status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP,
        preview: { integrity: buildPartialLocalSnapshotIntegrity() },
        verification: { ok: true, allMatched: true },
        writeResult: null,
        noWritesPerformed: true,
      });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.BLOCKED_UNSUPPORTED_SHAPE,
      eligible: true,
      partial: true,
      recoveryEligibleForPartialLocalSnapshot: false,
      blockers: [{
        code: "partial_snapshot_estimates_unrestorable",
        message: "Cloud backup cannot safely rebuild this device because one or more linked estimates are missing valid restore data.",
      }],
      notices: [],
      noWritesPerformed: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud backup cannot safely rebuild this device because one or more linked estimates are missing valid restore data.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeDisabled();
    expect(screen.queryByText("Recheck complete. This device still has invoices but no local estimates. Restore cloud data to this device to rebuild the missing local records.")).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Recheck Cloud Status" }));
    });

    expect(screen.getByText("Recheck complete. Cloud backup still cannot rebuild the missing local estimates. Cloud backup cannot safely rebuild this device because one or more linked estimates are missing valid restore data.")).toBeInTheDocument();
  });

  test("shows the calm automatic backup running status while the background worker is backing up", async () => {
    mockSignedInWithCompany();
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"], severity: "normal" });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud sync")).toBeInTheDocument();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, { detail: { running: true } }));
    });

    expect(screen.getByText("Backing up changes...")).toBeInTheDocument();
    expect(screen.queryByText("Cloud sync")).not.toBeInTheDocument();
  });

  test("shows the calm automatic backup current status once the queue clears with a confirmed backup", async () => {
    mockSignedInWithCompany();
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"], severity: "normal" });
    clearCloudBackupDirty("manual_backup_success");

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud backup is up to date.")).toBeInTheDocument();
    expect(screen.getByText(/Last backed up/)).toBeInTheDocument();
  });

  test("shows automatic retrying after an initial sync failure and keeps local work pending", async () => {
    mockSignedInWithCompany();
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"], severity: "normal" });
    recordCloudBackupAttemptFailure("Unable to reach Supabase.");

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud sync")).toBeInTheDocument();
    expect(
      screen.getByText("Your changes are safe. EstiPaid is retrying cloud sync.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry Sync" })).not.toBeInTheDocument();
  });

  test("offers Retry Sync only after repeated automatic failures", async () => {
    mockSignedInWithCompany();
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"], severity: "normal" });
    recordCloudBackupAttemptFailure("Unable to reach Supabase.");
    recordCloudBackupAttemptFailure("Unable to reach Supabase.");
    recordCloudBackupAttemptFailure("Unable to reach Supabase.");

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Sync needs attention")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry Sync" })).toBeInTheDocument();
  });

  test("restore success reports company profile, logo, settings, and scope templates restored when the app bundle is present", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.ELIGIBLE,
      eligible: true,
      partial: false,
      cloudCounts: { customers: 7, projects: 9, estimates: 0, invoices: 10, invoice_payments: 3, estimate_line_items: 0, invoice_line_items: 21 },
      localCounts: { customers: 0, projects: 0, estimates: 0, invoices: 0 },
      blockers: [],
      notices: [],
      appBundleAvailable: true,
      appBundleSummary: {
        companyProfileCaptured: true,
        logoDataUrlCaptured: true,
        settingsCaptured: true,
        scopeTemplatesCaptured: true,
      },
      noWritesPerformed: true,
    });
    executeSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.RESTORED,
      restored: true,
      partial: false,
      restoredCounts: { customers: 7, projects: 9, invoices: 10 },
      blockers: [],
      notices: [],
      appBundleRestored: true,
      appBundleSummary: {
        companyProfileCaptured: true,
        logoDataUrlCaptured: true,
        settingsCaptured: true,
        scopeTemplatesCaptured: true,
      },
      noWritesPerformed: false,
      noCloudDataDeleted: true,
      noExistingLocalDataOverwritten: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Cloud Data to This Device" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Restore Data" }));
    });

    expect(screen.getByText("Company profile, logo, settings, and scope templates restored.")).toBeInTheDocument();
    expect(screen.queryByText("Business records restored. Company profile, logo, settings, and scope templates need a separate backup/update step.")).not.toBeInTheDocument();
  });

  test("restore preview blocking with local_not_empty shows the overwrite-prevention message instead of a restore button", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.LOCAL_NOT_EMPTY,
      eligible: false,
      partial: false,
      cloudCounts: null,
      localCounts: { customers: 1, projects: 0, estimates: 0, invoices: 0 },
      blockers: [],
      notices: [],
      noWritesPerformed: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("This device already has local data. Restore is blocked to prevent overwriting.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restore Cloud Data to This Device" })).not.toBeInTheDocument();
    expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
  });

  function buildCloudOnlyEstimateVerification() {
    return {
      ok: true,
      allMatched: false,
      tableResults: [
        { table: "estimates", status: "mismatch", missingLegacyIds: [], extraLegacyIds: ["cloud_only_est"] },
        { table: "customers", status: "matched", missingLegacyIds: [], extraLegacyIds: [] },
        { table: "invoices", status: "matched", missingLegacyIds: [], extraLegacyIds: [] },
      ],
    };
  }

  test("local_cloud_mismatch state shows the cloud/local difference choice card with restore, replace, and download actions", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
      preview: null,
      verification: buildCloudOnlyEstimateVerification(),
      writeResult: null,
      noWritesPerformed: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud and this device are different.")).toBeInTheDocument();
    expect(screen.getByText(/Choose whether to restore cloud data here or replace the cloud backup/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeDisabled();
    expect(screen.getByText(/Restore is blocked here because this device already has local data/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace Cloud Backup With This Device" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck Cloud Status" })).toBeInTheDocument();
    // "Download This Device Backup JSON" also appears in the always-present Developer
    // Tools section, so this action must render at least once (not exactly
    // once) inside the mismatch choice card.
    expect(screen.getAllByRole("button", { name: "Download This Device Backup JSON" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: "Back Up This Device" })).not.toBeInTheDocument();
    expect(screen.queryByText("Cloud backup is up to date.")).not.toBeInTheDocument();
    expect(runSupabaseMigrationWrite).not.toHaveBeenCalled();
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
    expect(previewSupabaseCloudRestore).not.toHaveBeenCalled();
    expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
  });

  test("Replace Cloud Backup With This Device requires confirmation and runs the deliberate replace-cloud flow", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
      preview: null,
      verification: buildCloudOnlyEstimateVerification(),
      writeResult: null,
      noWritesPerformed: true,
    });
    runSupabaseCloudOnboardingBackup.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED,
      preview: {},
      writeResult: { ok: true, replacedCloudOnlyRows: [{ table: "estimates", legacyIds: ["cloud_only_est"] }] },
      verification: { ok: true, allMatched: true },
      noLocalDeletes: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace Cloud Backup With This Device" }));
    });

    expect(screen.getByRole("dialog", { name: "Replace cloud backup with this device?" })).toBeInTheDocument();
    expect(screen.getByText(/Replacing the cloud backup will make cloud match this device/)).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", { name: "Replace Cloud Backup" });
    expect(confirmButton).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });
    expect(confirmButton).toBeEnabled();

    await act(async () => {
      fireEvent.click(confirmButton);
    });

    expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({
      storageSnapshot: localStorage,
      configured: true,
      company: expect.objectContaining({ id: "company_1" }),
      role: "owner",
      allowCloudOnlyReplacement: true,
    }));
    expect(screen.getByText("Cloud backup is up to date.")).toBeInTheDocument();
    expect(screen.getByText("Cloud data matches this device.")).toBeInTheDocument();
  });

  test("generic cloud verification mismatch with clean local integrity shows the resolution card, not a dead-end Backup issue", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    // Mirrors the writer's own post-write verification path: writeResult.ok
    // is true (the write itself succeeded) but the follow-up verification
    // found a generic mismatch with no specific cloud-only rows called out --
    // this is the exact live scenario, distinct from the read-only
    // LOCAL_CLOUD_MISMATCH status check used in the other mismatch tests.
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
      preview: {
        integrity: scanLocalDataIntegrity({
          customers: [{ id: "cust_1", name: "Acme Co" }],
          projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
          estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-1", total: 100 }],
          invoices: [{ id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-1", total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] }],
        }),
      },
      verification: {
        ok: true,
        allMatched: false,
        notices: [{
          level: "warning",
          code: "cloud_verification_mismatch",
          message: "Cloud verification found mismatches between local and Supabase data.",
        }],
      },
      writeResult: { ok: true },
      noWritesPerformed: false,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud and this device are different.")).toBeInTheDocument();
    expect(screen.getByText("Cloud verification found mismatches between local and Supabase data.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace Cloud Backup With This Device" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck Cloud Status" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download This Device Backup JSON" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Cloud backup is up to date.")).not.toBeInTheDocument();
    // The concrete mismatch detail can still appear, but it must not be the
    // only thing shown -- there must be no generic "no actions" dead end.
    expect(screen.getByText(/Data check/i)).toBeInTheDocument();
  });

  test("true local blocker state does not offer the replace-cloud action", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
      preview: {
        integrity: scanLocalDataIntegrity({
          customers: [{ id: "cust_1", name: "Acme Co" }],
          projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
          estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-1", total: 100 }],
          invoices: [
            { id: "inv_1", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] },
            { id: "inv_2", projectId: "proj_1", customerId: "cust_1", invoiceNumber: "INV-100", total: 100, amountPaid: 0, balanceRemaining: 100, payments: [] },
          ],
        }),
      },
      verification: {
        ok: true,
        allMatched: false,
        notices: [{
          level: "warning",
          code: "cloud_verification_mismatch",
          message: "Cloud verification found mismatches between local and Supabase data.",
        }],
      },
      writeResult: { ok: true },
      noWritesPerformed: false,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.queryByRole("button", { name: "Replace Cloud Backup With This Device" })).not.toBeInTheDocument();
    expect(screen.queryByText("Cloud and this device are different.")).not.toBeInTheDocument();
  });

  test("Restore Cloud to This Device re-verifies after a successful restore and clears the mismatch state", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus
      .mockResolvedValueOnce({
        onboardingVersion: "supabase-cloud-onboarding-v1",
        status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
        preview: null,
        verification: { ok: true, allMatched: false, notices: [{ level: "warning", code: "cloud_verification_mismatch", message: "Cloud verification found mismatches between local and Supabase data." }] },
        writeResult: null,
        noWritesPerformed: true,
      })
      .mockResolvedValue({
        onboardingVersion: "supabase-cloud-onboarding-v1",
        status: CLOUD_ONBOARDING_STATUS.ALREADY_BACKED_UP,
        preview: null,
        verification: { ok: true, allMatched: true },
        writeResult: null,
        noWritesPerformed: true,
      });
    executeSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.RESTORED,
      restored: true,
      partial: false,
      restoredCounts: { customers: 7, projects: 10, estimates: 8, invoices: 9 },
      blockers: [],
      notices: [],
      noWritesPerformed: false,
      noCloudDataDeleted: true,
      noExistingLocalDataOverwritten: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeDisabled();
    expect(screen.getByText(/Restore is blocked here because this device already has local data/)).toBeInTheDocument();
    expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
  });

  test("Restore Cloud to This Device shows the exact remaining reason if a mismatch persists after a successful restore", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
      preview: null,
      verification: {
        ok: true,
        allMatched: false,
        notices: [{ level: "warning", code: "cloud_verification_mismatch", message: "Cloud verification found mismatches between local and Supabase data." }],
        tableResults: [
          { table: "invoices", status: "mismatch", missingLegacyIds: [], extraLegacyIds: ["cloud_only_inv"], countOnly: false },
        ],
      },
      writeResult: null,
      noWritesPerformed: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByRole("button", { name: "Restore Cloud to This Device" })).toBeDisabled();
    expect(screen.getByText(/Restore is blocked here because this device already has local data/)).toBeInTheDocument();
    expect(screen.getByText(/invoices:.*only in the cloud/)).toBeInTheDocument();
  });

  test("Replace Cloud Backup With This Device shows the exact remaining reason if a mismatch persists after replace", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
      preview: null,
      verification: {
        ok: true,
        allMatched: false,
        notices: [{ level: "warning", code: "cloud_verification_mismatch", message: "Cloud verification found mismatches between local and Supabase data." }],
        tableResults: [
          { table: "estimates", status: "mismatch", missingLegacyIds: [], extraLegacyIds: ["cloud_only_est"], countOnly: false },
        ],
      },
      writeResult: null,
      noWritesPerformed: true,
    });
    runSupabaseCloudOnboardingBackup.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
      preview: {},
      writeResult: { ok: true, replacedCloudOnlyRows: [{ table: "estimates", legacyIds: ["cloud_only_est"] }] },
      verification: {
        ok: true,
        allMatched: false,
        notices: [{ level: "warning", code: "cloud_verification_mismatch", message: "Cloud verification found mismatches between local and Supabase data." }],
        tableResults: [
          { table: "invoice_payments", status: "mismatch", missingLegacyIds: [], extraLegacyIds: ["cloud_only_pay"], countOnly: false },
        ],
      },
      noLocalDeletes: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace Cloud Backup With This Device" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox"));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Replace Cloud Backup" }));
    });

    expect(screen.queryByText("Cloud backup is up to date.")).not.toBeInTheDocument();
    expect(screen.getByText(/invoice payments:.*only in the cloud/)).toBeInTheDocument();
    expect(screen.getByText(/invoices\/payments are protected/)).toBeInTheDocument();
  });

  test("estimate_line_items permission denied produces clear blocked copy and recovery actions", async () => {
    mockSignedInWithCompany();
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
      preview: {
        integrity: scanLocalDataIntegrity({
          customers: [{ id: "cust_1", name: "Acme Co" }],
          projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
          estimates: [{ id: "est_1", projectId: "proj_1", customerId: "cust_1", estimateNumber: "EST-1", total: 100 }],
          invoices: [],
        }),
      },
      verification: null,
      writeResult: {
        ok: false,
        blocked: false,
        reason: "permission denied for table estimate_line_items",
        notices: [
          {
            level: "error",
            code: "estimate_line_items_cloud_only_replace_failed",
            message: "permission denied for table estimate_line_items",
          },
        ],
      },
      noLocalDeletes: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud backup needs attention.")).toBeInTheDocument();
    expect(screen.getByText(/Replace reached estimate line item cleanup, but this account does not have permission/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck Cloud Status" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download This Device Backup JSON" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("Cloud backup is up to date.")).not.toBeInTheDocument();
  });

  test("metadata repair followed by remaining mismatch re-renders actionable mismatch UI", async () => {
    mockSignedInWithCompany();

    const staleInvoice = {
      id: "inv_1",
      projectId: "missing_project",
      customerId: "cust_1",
      invoiceNumber: "INV-100",
      status: "sent",
      invoiceTotal: 100,
      total: 100,
      amountPaid: 25,
      balanceRemaining: 75,
      payments: [{ id: "pay_1", amount: 25 }],
    };
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([staleInvoice]));

    const staleIntegrity = scanLocalDataIntegrity({
      customers: [{ id: "cust_1", name: "Acme Co" }],
      projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
      estimates: [{ id: "est_1", projectId: "proj_1", status: "approved", estimateNumber: "EST-1" }],
      invoices: [staleInvoice],
    });

    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
      preview: {
        integrity: scanLocalDataIntegrity({
          customers: [{ id: "cust_1", name: "Acme Co" }],
          projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
          estimates: [{ id: "est_1", projectId: "proj_1", status: "approved", estimateNumber: "EST-1" }],
          invoices: [{ ...staleInvoice, projectId: "" }],
        }),
      },
      verification: {
        ok: true,
        allMatched: false,
        notices: [{ level: "warning", code: "cloud_verification_mismatch", message: "Cloud verification found mismatches between local and Supabase data." }],
        tableResults: [
          { table: "estimates", status: "mismatch", missingLegacyIds: [], extraLegacyIds: ["cloud_only_est"], countOnly: false },
        ],
      },
      writeResult: null,
      noWritesPerformed: false,
      automaticSafeRepair: {
        attempted: true,
        succeeded: true,
        repairChanged: true,
      },
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(await screen.findByText("Cloud and this device are different.")).toBeInTheDocument();
    expect(screen.getByText(/estimates: 1 only in the cloud\. Replace can remove the cloud-only rows\./i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace Cloud Backup With This Device" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Recheck Cloud Status" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download This Device Backup JSON" }).length).toBeGreaterThanOrEqual(1);
  });

  test("metadata repair dead-end branch keeps recovery actions visible after a failed queue state", async () => {
    mockSignedInWithCompany();
    markCloudBackupDirty({ reason: "project_saved", domains: ["projects"], severity: "normal" });
    recordCloudBackupAttemptFailure("Unable to reach Supabase.");

    const staleInvoice = {
      id: "inv_1",
      projectId: "missing_project",
      customerId: "cust_1",
      invoiceNumber: "INV-100",
      status: "sent",
      invoiceTotal: 100,
      total: 100,
      amountPaid: 25,
      balanceRemaining: 75,
      payments: [{ id: "pay_1", amount: 25 }],
    };
    localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([staleInvoice]));

    const staleIntegrity = scanLocalDataIntegrity({
      customers: [{ id: "cust_1", name: "Acme Co" }],
      projects: [{ id: "proj_1", customerId: "cust_1", projectName: "Roof Repair" }],
      estimates: [{ id: "est_1", projectId: "proj_1", status: "approved" }],
      invoices: [staleInvoice],
    });

    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
      preview: { integrity: staleIntegrity },
      verification: null,
      writeResult: null,
      noWritesPerformed: false,
      automaticSafeRepair: {
        attempted: true,
        failed: true,
        technicalDetail: "Safe repair can detach a stale project link on 1 invoice.",
      },
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText("Cloud backup needs attention.")).toBeInTheDocument();
    expect(screen.getByText("We could not finish protecting this device automatically.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Repair Safe Metadata" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Download This Device Backup JSON" }).length).toBeGreaterThanOrEqual(1);
  });

  test("protected invoice line-item mismatch does not claim replace will clear it", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
      preview: null,
      verification: {
        ok: true,
        allMatched: false,
        notices: [{ level: "warning", code: "cloud_verification_mismatch", message: "Cloud verification found mismatches between local and Supabase data." }],
        tableResults: [
          { table: "invoice_line_items", status: "mismatch", missingLegacyIds: [], extraLegacyIds: [], countOnly: true },
        ],
      },
      writeResult: null,
      noWritesPerformed: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.getByText(/invoice line items: row count does not match\./i)).toBeInTheDocument();
    expect(screen.getByText(/Replace will not remove protected invoice data\./i)).toBeInTheDocument();
    expect(screen.queryByText(/Restore or replace should clear this once run\./i)).not.toBeInTheDocument();
  });

  test("clicking Back Up This Device runs the onboarding backup and shows success with no local deletion message", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });
    runSupabaseCloudOnboardingBackup.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.BACKUP_COMPLETED,
      preview: {},
      writeResult: { ok: true },
      verification: { ok: true, allMatched: true },
      noLocalDeletes: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back Up This Device" }));
    });

    expect(screen.getByRole("dialog", { name: "Back up this device to cloud?" })).toBeInTheDocument();
    expect(screen.getByText("This will copy this device's saved work to your cloud backup.")).toBeInTheDocument();
    expect(screen.getByText("It will not delete local data on this device.")).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back Up Now" }));
    });

    expect(runSupabaseCloudOnboardingBackup).toHaveBeenCalledWith(expect.objectContaining({
      storageSnapshot: localStorage,
      configured: true,
      company: expect.objectContaining({ id: "company_1" }),
      role: "owner",
    }));
    expect(screen.getByText("Cloud backup is up to date.")).toBeInTheDocument();
    expect(screen.getByText("Cloud data matches this device.")).toBeInTheDocument();
    expect(screen.getByText("No local data was deleted.")).toBeInTheDocument();
  });

  test("backup needs_attention state points to developer migration tools instead of a false success", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });
    runSupabaseCloudOnboardingBackup.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.NEEDS_ATTENTION,
      preview: {},
      writeResult: { ok: false, blocked: true, reason: "Migration write blocked by local validation issues." },
      verification: null,
      noLocalDeletes: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back Up This Device" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Back Up Now" }));
    });

    expect(screen.getByText("Cloud backup needs attention.")).toBeInTheDocument();
    expect(screen.getByText("Review this device and cloud backup before trying again.")).toBeInTheDocument();
    expect(screen.getByText("Migration write blocked by local validation issues.")).toBeInTheDocument();
    expect(screen.queryByText("Cloud backup is up to date.")).not.toBeInTheDocument();
  });

  test("technical migration tools remain available behind the explicit Developer Migration Tools gate", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled />);
    });

    expect(screen.getByText("Developer Migration Tools")).toBeInTheDocument();
    expect(screen.getByText("Migration Preview")).toBeInTheDocument();
    expect(screen.getByText("Migration Write")).toBeInTheDocument();
    expect(screen.getByText("Cloud Verification")).toBeInTheDocument();
    expect(screen.getAllByText("Update App Restore Bundle").length).toBeGreaterThan(0);
    expect(screen.getByText("Stores the editable estimate state in Supabase so estimates can be restored on another device.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview Local Data Migration" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Migrate Local Data to Cloud" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Verify Cloud Data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update App Restore Bundle" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Update Estimate Restore Payloads" })).toBeInTheDocument();
  });

  test("requires typed BUNDLE before the Update App Restore Bundle button enables", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled />);
    });

    const button = screen.getByRole("button", { name: "Update App Restore Bundle" });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type BUNDLE to confirm"), { target: { value: "nope" } });
    expect(button).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type BUNDLE to confirm"), { target: { value: "BUNDLE" } });
    expect(button).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(button);
    });

    expect(updateSupabaseAppRestoreBundle).toHaveBeenCalledWith(expect.objectContaining({
      storageSnapshot: localStorage,
      configured: true,
      company: expect.objectContaining({ id: "company_1" }),
      role: "owner",
    }));
  });

  test("reports company profile, logoDataUrl, settings, and scope templates capture after app restore bundle update", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    updateSupabaseAppRestoreBundle.mockResolvedValue({
      status: APP_RESTORE_BUNDLE_STATUS.COMPLETED,
      bundleUpdated: true,
      noLocalDataChanged: true,
      captureSummary: {
        companyProfileCaptured: true,
        logoDataUrlCaptured: true,
        settingsCaptured: true,
        scopeTemplatesCaptured: true,
      },
      notices: [],
    });

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled />);
    });

    fireEvent.change(screen.getByLabelText("Type BUNDLE to confirm"), { target: { value: "BUNDLE" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update App Restore Bundle" }));
    });

    expect(screen.getByText("Company profile captured:")).toBeInTheDocument();
    expect(screen.getByText("logoDataUrl captured:")).toBeInTheDocument();
    expect(screen.getByText("Settings captured:")).toBeInTheDocument();
    expect(screen.getByText("Scope templates captured:")).toBeInTheDocument();
    expect(screen.getByText("Bundle updated:")).toBeInTheDocument();
    expect(screen.getByText("No local data changed.")).toBeInTheDocument();
  });

  test("requires typed PAYLOAD before the Update Estimate Restore Payloads button enables", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled />);
    });

    const updateButton = screen.getByRole("button", { name: "Update Estimate Restore Payloads" });
    expect(updateButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type PAYLOAD to confirm"), { target: { value: "nope" } });
    expect(updateButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type PAYLOAD to confirm"), { target: { value: "PAYLOAD" } });
    expect(updateButton).not.toBeDisabled();
    expect(updateEstimateRestorePayloads).not.toHaveBeenCalled();
  });

  test("clicking Update Estimate Restore Payloads reports checked/updated counts and no local data changed", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    updateEstimateRestorePayloads.mockResolvedValue({
      payloadUpdateVersion: "supabase-estimate-restore-payload-v1",
      status: ESTIMATE_PAYLOAD_UPDATE_STATUS.COMPLETED,
      estimatesChecked: 8,
      estimatesUpdated: 8,
      missingCloudRows: [],
      skipped: [],
      failed: [],
      noLocalDataChanged: true,
    });

    const setItemSpy = jest.spyOn(window.localStorage.__proto__, "setItem");

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled />);
    });

    fireEvent.change(screen.getByLabelText("Type PAYLOAD to confirm"), { target: { value: "PAYLOAD" } });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Update Estimate Restore Payloads" }));
    });

    expect(updateEstimateRestorePayloads).toHaveBeenCalledWith(expect.objectContaining({
      storageSnapshot: localStorage,
      configured: true,
      company: expect.objectContaining({ id: "company_1" }),
    }));
    expect(screen.getByText(/Estimates checked:/i)).toBeInTheDocument();
    expect(screen.getAllByText("8")).toHaveLength(2);
    expect(screen.getByText("No local data changed.")).toBeInTheDocument();
    expect(setItemSpy).not.toHaveBeenCalled();
    setItemSpy.mockRestore();
  });

  test("requires preview plus typed MIGRATE before running the cloud migration write", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    isSupabaseMigrationPreviewReady.mockImplementation((preview) => Boolean(preview?.company?.id));

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled />);
    });

    const migrateButton = screen.getByRole("button", { name: "Migrate Local Data to Cloud" });
    expect(migrateButton).toBeDisabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview Local Data Migration" }));
    });

    expect(migrateButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Type MIGRATE to confirm"), {
      target: { value: "MIGRATE" },
    });

    expect(migrateButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(migrateButton);
    });

    expect(runSupabaseMigrationWrite).toHaveBeenCalledWith(expect.objectContaining({
      storageSnapshot: localStorage,
      configured: true,
      company: expect.objectContaining({ id: "company_1", name: "Field Pocket LLC" }),
      role: "owner",
      backupDownloadAvailable: true,
      preview: expect.objectContaining({
        company: expect.objectContaining({ id: "company_1", name: "Field Pocket LLC" }),
      }),
    }));
    expect(screen.getByText(/Cloud migration completed\./i)).toBeInTheDocument();
    expect(screen.getByText(/Customers: success, written 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimate line items: success, written 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Invoice line items: success, written 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Invoice payments: success, written 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Local data remains in localStorage after this migration step\./i)).toBeInTheDocument();
  });

  test("shows reused customer counts when a partial migration resumes safely", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_2", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_2", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));
    isSupabaseMigrationPreviewReady.mockImplementation((preview) => Boolean(preview?.company?.id));
    runSupabaseMigrationWrite.mockResolvedValue({
      ok: true,
      reason: "",
      notices: [
        { level: "info", code: "prevalidation_complete", message: "Prevalidation completed before any migration writes started." },
        { level: "info", code: "existing_customers_reused", message: "Existing cloud customers were reused from the partial migration state." },
      ],
      tableResults: [
        { table: "customers", label: "Customers", status: "reused", written: 0, reused: 1, skipped: 1, failed: 0 },
        { table: "projects", label: "Projects", status: "success", written: 1, reused: 0, skipped: 0, failed: 0 },
      ],
      noLocalDeletes: true,
    });

    await act(async () => {
      render(<AdvancedSettingsScreen developerCloudToolsEnabled />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Preview Local Data Migration" }));
    });

    fireEvent.change(screen.getByLabelText("Type MIGRATE to confirm"), {
      target: { value: "MIGRATE" },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Migrate Local Data to Cloud" }));
    });

    expect(screen.getByText(/Customers: reused, written 0, reused 1, skipped 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Existing cloud customers were reused from the partial migration state\./i)).toBeInTheDocument();
  });

  test("shows no-membership state without crashing", () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_3", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_3", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_3", email: "owner@example.com" },
    }));

    render(<AdvancedSettingsScreen />);

    expect(screen.getByText("No company membership found yet.")).toBeInTheDocument();
    expect(screen.getByLabelText("Company / Workspace Name")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create Cloud Workspace" })).toBeInTheDocument();
    expect(screen.getByText(/This creates your cloud workspace only/i)).toBeInTheDocument();
  });

  test("creates a cloud workspace only from the explicit no-membership form", async () => {
    const createWorkspace = jest.fn(() => ({ ok: true }));
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_4", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_4", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_4", email: "owner@example.com" },
    }));
    useSupabaseWorkspaceBootstrap.mockReturnValue(buildWorkspaceBootstrapState({
      createWorkspace,
    }));

    render(<AdvancedSettingsScreen />);

    fireEvent.change(screen.getByLabelText("Company / Workspace Name"), {
      target: { value: "Field Pocket LLC" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Create Cloud Workspace" }));
    });

    expect(createWorkspace).toHaveBeenCalledWith("Field Pocket LLC");
  });

  test("hides the workspace-create form once membership exists", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_5", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_5", email: "owner@example.com" } },
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_5", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket LLC" },
      role: "owner",
      hasCompany: true,
    }));

    await act(async () => {
      render(<AdvancedSettingsScreen />);
    });

    expect(screen.queryByLabelText("Company / Workspace Name")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Cloud Workspace" })).not.toBeInTheDocument();
  });

  test("downloads the local backup artifact without mutating stored app data", async () => {
    render(<AdvancedSettingsScreen />);

    const beforeCompanyProfile = localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE);
    const beforeCustomers = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
    const beforeProjects = localStorage.getItem(STORAGE_KEYS.PROJECTS);
    const beforeEstimates = localStorage.getItem(STORAGE_KEYS.ESTIMATES);
    const beforeInvoices = localStorage.getItem(STORAGE_KEYS.INVOICES);
    const beforeSettings = localStorage.getItem(STORAGE_KEYS.SETTINGS);

    fireEvent.click(screen.getByRole("button", { name: "Download This Device Backup JSON" }));

    expect(screen.getByRole("status")).toHaveTextContent(/this device backup json downloaded:/i);
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
    expect(capturedBlob).toBeTruthy();

    const appendedAnchor = appendChildSpy.mock.calls
      .map(([node]) => node)
      .find((node) => node?.tagName === "A");
    expect(appendedAnchor).toBeTruthy();
    expect(appendedAnchor.download).toMatch(/^estipaid-localstorage-export-\d{8}-\d{6}\.json$/);

    const payload = JSON.parse(await readBlobText(capturedBlob));
    expect(payload.source).toBe("localStorage");
    expect(payload.app).toBe("EstiPaid");
    expect(payload.artifactVersion).toBe("localstorage-export-artifact-v1");

    expect(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE)).toBe(beforeCompanyProfile);
    expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBe(beforeCustomers);
    expect(localStorage.getItem(STORAGE_KEYS.PROJECTS)).toBe(beforeProjects);
    expect(localStorage.getItem(STORAGE_KEYS.ESTIMATES)).toBe(beforeEstimates);
    expect(localStorage.getItem(STORAGE_KEYS.INVOICES)).toBe(beforeInvoices);
    expect(localStorage.getItem(STORAGE_KEYS.SETTINGS)).toBe(beforeSettings);
  });

  // Gate 13O-2K: the screen used to render "Settings" twice -- once in the
  // header h1 and again as an inline section title.
  test("renders exactly one Settings page title", () => {
    const { container } = render(<AdvancedSettingsScreen />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    const titleNodes = [...container.querySelectorAll(".pe-title")]
      .filter((node) => node.textContent.trim() === "Settings");
    expect(titleNodes).toHaveLength(1);
    expect(screen.getByText(/Configure business defaults, document behavior, internal visibility, and local tools/)).toBeInTheDocument();
  });

  test("shows clarified real settings and hides misleading pricing controls", () => {
    render(<AdvancedSettingsScreen />);

    expect(screen.getByText("Pricing Defaults")).toBeInTheDocument();
    expect(screen.getByText("Default Markup %")).toBeInTheDocument();
    expect(screen.getByText("Use Default Markup on Line Items")).toBeInTheDocument();
    expect(
      screen.getByText(/labor and itemized material line items use your default markup/i),
    ).toBeInTheDocument();

    expect(screen.queryByText("Lock Markup to Global")).not.toBeInTheDocument();
    expect(screen.queryByText("Default Tax %")).not.toBeInTheDocument();
    expect(screen.queryByText("Round Totals")).not.toBeInTheDocument();
    expect(screen.queryByText("Precision")).not.toBeInTheDocument();
    expect(screen.queryByText("Document Defaults")).not.toBeInTheDocument();
    expect(screen.queryByText("Default Internal Estimate Notes")).not.toBeInTheDocument();
    expect(screen.queryByText("Default Internal Notes (Estimate only)")).not.toBeInTheDocument();
  });

  // Gate 13O-2J: cloud backup JSON export/import recovery contract.
  function buildCloudBackupArtifactFixture(overrides = {}) {
    return {
      artifactVersion: "cloud-backup-export-artifact-v1",
      schemaVersion: 1,
      source: "cloud",
      app: "EstiPaid",
      exportedAt: "2026-07-05T12:00:00.000Z",
      companyId: "company_1",
      companyName: "Field Pocket LLC",
      counts: {
        customers: 1,
        projects: 1,
        estimates: 1,
        estimateLineItems: 0,
        invoices: 1,
        invoiceLineItems: 0,
        invoicePayments: 1,
        scopeTemplates: 0,
      },
      restorePayloadCoverage: { totalEstimates: 1, estimatesWithRestorePayload: 1, estimatesMissingRestorePayload: 0 },
      optionalSections: { appRestoreBundle: "missing" },
      records: {
        customers: [{ id: "cloud_cust_1", type: "residential", fullName: "Cloud Customer" }],
        projects: [{ id: "cloud_proj_1", customerId: "cloud_cust_1", projectName: "Cloud Project" }],
        estimates: [{ id: "cloud_est_1", labor: { hazardPct: 5, lines: [] }, materials: { markupPct: 18, items: [] } }],
        invoices: [{ id: "cloud_inv_1", invoiceNumber: "INV-9", lineItems: [], payments: [{ id: "cloud_pay_1", amount: 100 }] }],
        companyProfile: null,
        settings: null,
        scopeTemplates: null,
      },
      notices: [],
      ...overrides,
    };
  }

  test("Download Cloud Backup JSON downloads the cloud artifact and reports its record counts", async () => {
    exportSupabaseCloudBackupArtifact.mockResolvedValue({
      status: CLOUD_BACKUP_EXPORT_STATUS.EXPORTED,
      artifact: buildCloudBackupArtifactFixture(),
      error: "",
    });

    render(<AdvancedSettingsScreen />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Download Cloud Backup JSON" })[0]);
    });

    expect(exportSupabaseCloudBackupArtifact).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Cloud backup JSON downloaded: estipaid-cloud-backup-.*\(1 customers, 1 projects, 1 estimates, 1 invoices\)/)).toBeInTheDocument();
    expect(createObjectURLSpy).toHaveBeenCalledTimes(1);
  });

  test("Download Cloud Backup JSON surfaces the failing table instead of downloading an empty artifact", async () => {
    exportSupabaseCloudBackupArtifact.mockResolvedValue({
      status: CLOUD_BACKUP_EXPORT_STATUS.ERROR,
      artifact: null,
      error: "Unable to read customers from Supabase. Cloud backup JSON was not created.",
      failedTable: "customers",
    });

    render(<AdvancedSettingsScreen />);
    await act(async () => {
      fireEvent.click(screen.getAllByRole("button", { name: "Download Cloud Backup JSON" })[0]);
    });

    expect(screen.getByText("Unable to read customers from Supabase. Cloud backup JSON was not created.")).toBeInTheDocument();
    expect(createObjectURLSpy).not.toHaveBeenCalled();
  });

  test("importing a cloud backup JSON previews counts, maps records into local storage, and reports imported counts", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});

    render(<AdvancedSettingsScreen />);

    const file = { text: async () => JSON.stringify(buildCloudBackupArtifactFixture()) };
    const input = document.querySelector('input[type="file"]');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Import Cloud Backup JSON?"));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Customers: 1"));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toEqual([
      { id: "cloud_cust_1", type: "residential", fullName: "Cloud Customer" },
    ]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.ESTIMATES))).toEqual([
      expect.objectContaining({ id: "cloud_est_1" }),
    ]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.INVOICES))).toEqual([
      expect.objectContaining({ id: "cloud_inv_1", payments: [expect.objectContaining({ id: "cloud_pay_1" })] }),
    ]);
    expect(alertSpy).toHaveBeenCalledWith("Imported backup: 1 customers, 1 projects, 1 estimates, 1 invoices.");
  });

  test("importing a zero-record backup requires explicit confirmation and writes nothing when declined", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});

    render(<AdvancedSettingsScreen />);
    const beforeCustomers = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);

    // The exact incident shape: a device export taken after storage was cleared.
    const emptyDeviceArtifact = {
      artifactVersion: "localstorage-export-artifact-v1",
      source: "localStorage",
      app: "EstiPaid",
      parsedData: {
        migration: {
          companyProfile: { present: false },
          customers: { present: false },
          projects: { present: false },
          estimates: { present: false },
          invoices: { present: false },
          settings: { present: false },
          scopeTemplates: { present: false },
          auditEvents: { present: false },
        },
        supporting: {},
      },
    };
    const file = { text: async () => JSON.stringify(emptyDeviceArtifact) };
    const input = document.querySelector('input[type="file"]');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("This backup contains no customer, project, estimate, or invoice records."));
    expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBe(beforeCustomers);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("a confirmed zero-record import never reports success", async () => {
    jest.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});

    render(<AdvancedSettingsScreen />);

    const file = {
      text: async () => JSON.stringify(buildCloudBackupArtifactFixture({
        records: {
          customers: [],
          projects: [],
          estimates: [],
          invoices: [],
          companyProfile: null,
          settings: null,
          scopeTemplates: null,
        },
      })),
    };
    const input = document.querySelector('input[type="file"]');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(alertSpy).toHaveBeenCalledWith("No records imported. This backup did not contain recoverable customer/project/estimate/invoice data.");
  });

  test("importing an unrecognized JSON file is blocked with a clear reason", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});

    render(<AdvancedSettingsScreen />);

    const file = { text: async () => JSON.stringify({ some: "random", json: true }) };
    const input = document.querySelector('input[type="file"]');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("not a recognized EstiPaid backup JSON"));
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  test("importing a legacy raw app data export still works", async () => {
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});

    render(<AdvancedSettingsScreen />);

    const legacyExport = {
      app: "EstiPaid",
      version: 1,
      exportedAt: "2026-07-05T12:00:00.000Z",
      settings: {},
      keys: {
        [STORAGE_KEYS.CUSTOMERS]: [{ id: "legacy_cust_1", type: "residential", fullName: "Legacy Customer" }],
        [STORAGE_KEYS.PROJECTS]: [{ id: "legacy_proj_1" }],
      },
    };
    const file = { text: async () => JSON.stringify(legacyExport) };
    const input = document.querySelector('input[type="file"]');
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("Raw App Data export (legacy)"));
    expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toEqual([
      expect.objectContaining({ id: "legacy_cust_1" }),
    ]);
    expect(alertSpy).toHaveBeenCalledWith("Imported backup: 1 customers, 1 projects, 0 estimates, 0 invoices.");
  });

  test("locked device blocks cloud backup confirmation before any backup write runs", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      session: { user: { id: "user_1" } },
      user: { id: "user_1", email: "owner@example.com" },
      userEmail: "owner@example.com",
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_1", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket" },
      role: "owner",
      hasCompany: true,
    }));
    useDeviceLockStatus.mockReturnValue({
      loading: false,
      ready: true,
      isLocked: true,
      isActive: false,
      activeDeviceState: { activeDeviceName: "Chrome on Mac" },
    });
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.READY_TO_BACKUP,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });

    render(<AdvancedSettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Back Up This Device" }));

    expect(screen.queryByRole("dialog", { name: "Back up this device to cloud?" })).not.toBeInTheDocument();
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  });

  test("locked device blocks restore confirmation before any restore runs", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      session: { user: { id: "user_1" } },
      user: { id: "user_1", email: "owner@example.com" },
      userEmail: "owner@example.com",
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_1", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket" },
      role: "owner",
      hasCompany: true,
    }));
    useDeviceLockStatus.mockReturnValue({
      loading: false,
      ready: true,
      isLocked: true,
      isActive: false,
      activeDeviceState: { activeDeviceName: "Chrome on Mac" },
    });
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.CLOUD_AVAILABLE_EMPTY_DEVICE,
      preview: null,
      verification: null,
      writeResult: null,
      noWritesPerformed: true,
    });
    previewSupabaseCloudRestore.mockResolvedValue({
      restoreVersion: "supabase-cloud-restore-v1",
      status: CLOUD_RESTORE_STATUS.ELIGIBLE,
      eligible: true,
      partial: false,
      notices: [],
      noWritesPerformed: true,
    });

    render(<AdvancedSettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Restore Cloud Data to This Device" }));

    expect(screen.queryByRole("dialog", { name: "Restore cloud data to this device?" })).not.toBeInTheDocument();
    expect(executeSupabaseCloudRestore).not.toHaveBeenCalled();
  });

  test("locked device blocks replace-cloud confirmation before any replace write runs", async () => {
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      session: { user: { id: "user_1" } },
      user: { id: "user_1", email: "owner@example.com" },
      userEmail: "owner@example.com",
    }));
    useSupabaseAccount.mockReturnValue(buildAccountState({
      configured: true,
      user: { id: "user_1", email: "owner@example.com" },
      companyUser: { company_id: "company_1", role: "owner" },
      membership: { company_id: "company_1", role: "owner" },
      company: { id: "company_1", name: "Field Pocket" },
      role: "owner",
      hasCompany: true,
    }));
    useDeviceLockStatus.mockReturnValue({
      loading: false,
      ready: true,
      isLocked: true,
      isActive: false,
      activeDeviceState: { activeDeviceName: "Chrome on Mac" },
    });
    checkSupabaseCloudOnboardingStatus.mockResolvedValue({
      onboardingVersion: "supabase-cloud-onboarding-v1",
      status: CLOUD_ONBOARDING_STATUS.LOCAL_CLOUD_MISMATCH,
      preview: null,
      verification: { allMatched: false, tableResults: [] },
      writeResult: null,
      noWritesPerformed: true,
    });

    render(<AdvancedSettingsScreen />);
    fireEvent.click(await screen.findByRole("button", { name: "Replace Cloud Backup With This Device" }));

    expect(screen.queryByRole("dialog", { name: "Replace cloud backup with this device?" })).not.toBeInTheDocument();
    expect(runSupabaseCloudOnboardingBackup).not.toHaveBeenCalled();
  });
});
