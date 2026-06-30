import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import AdvancedSettingsScreen from "./AdvancedSettingsScreen";
import { STORAGE_KEYS } from "../constants/storageKeys";
import useSupabaseAuth from "../lib/useSupabaseAuth";
import useSupabaseAccount from "../lib/useSupabaseAccount";
import useSupabaseWorkspaceBootstrap from "../lib/useSupabaseWorkspaceBootstrap";
import { createSupabaseMigrationPreview } from "../lib/supabaseMigrationPreview";
import { isSupabaseMigrationPreviewReady, runSupabaseMigrationWrite } from "../lib/supabaseMigrationWriter";

jest.mock("../lib/useSupabaseAuth", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../lib/useSupabaseAccount", () => ({
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
    signInWithEmailOtp: jest.fn(),
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
    useSupabaseAuth.mockReturnValue(buildAuthState());
    useSupabaseAccount.mockReturnValue(buildAccountState());
    useSupabaseWorkspaceBootstrap.mockReturnValue(buildWorkspaceBootstrapState());
    createSupabaseMigrationPreview.mockReset();
    runSupabaseMigrationWrite.mockReset();
    isSupabaseMigrationPreviewReady.mockReset();
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
        invoices: 1,
        invoicePayments: 1,
        scopeTemplates: 1,
        settings: 1,
      },
      cloudCounts: {
        customers: 0,
        projects: 0,
        estimates: 0,
        invoices: 0,
        invoicePayments: 0,
      },
      cloudCountCheckAvailable: true,
      cloudCountStatusMessage: "Cloud count check completed.",
      notices: [],
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
        { table: "estimate_line_items", label: "Estimate line items", status: "skipped", written: 0, skipped: 0, failed: 0 },
        { table: "invoices", label: "Invoices", status: "success", written: 1, skipped: 0, failed: 0 },
        { table: "invoice_line_items", label: "Invoice line items", status: "skipped", written: 0, skipped: 0, failed: 0 },
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
    expect(screen.getByText("Account & Cloud Sync")).toBeInTheDocument();
    expect(screen.getByText("Templates")).toBeInTheDocument();
    expect(screen.getByText("Reports & Bookkeeping")).toBeInTheDocument();
    expect(screen.getByText("Developer Tools")).toBeInTheDocument();
    expect(screen.getByText(/Supabase not configured/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download Backup JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export Raw App Data" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import Raw App Data" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Business Profile" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Templates" }));
    fireEvent.click(screen.getByRole("button", { name: "Open Snapshot" }));

    expect(onOpenCompanyProfile).toHaveBeenCalledTimes(1);
    expect(onOpenTemplates).toHaveBeenCalledTimes(1);
    expect(onOpenSnapshot).toHaveBeenCalledTimes(1);
  });

  test("shows signed-out cloud auth controls and sends an OTP sign-in request", () => {
    const signInWithEmailOtp = jest.fn();
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      signInWithEmailOtp,
    }));

    render(<AdvancedSettingsScreen />);

    fireEvent.change(screen.getByLabelText("Account email"), {
      target: { value: "owner@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Email Sign-In Link" }));

    expect(signInWithEmailOtp).toHaveBeenCalledWith("owner@example.com");
    expect(screen.getByText(/Cloud data sync is not active yet/i)).toBeInTheDocument();
  });

  test("shows signed-in cloud account state and allows sign out", () => {
    const signOut = jest.fn();
    useSupabaseAuth.mockReturnValue(buildAuthState({
      configured: true,
      user: { id: "user_1", email: "owner@example.com" },
      userEmail: "owner@example.com",
      session: { user: { id: "user_1", email: "owner@example.com" } },
      signOut,
    }));

    render(<AdvancedSettingsScreen />);

    expect(screen.getByText(/Signed in as/i)).toBeInTheDocument();
    expect(screen.getByText("owner@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Data migration\/sync not enabled yet/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Sign Out" }));
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test("shows company name and role when a read-only membership exists", () => {
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

    render(<AdvancedSettingsScreen />);

    expect(screen.getByText(/Company:/i)).toBeInTheDocument();
    expect(screen.getByText("Field Pocket LLC")).toBeInTheDocument();
    expect(screen.getByText(/Role:/i)).toBeInTheDocument();
    expect(screen.getByText("owner")).toBeInTheDocument();
    expect(screen.getByText(/Data migration\/sync not enabled yet/i)).toBeInTheDocument();
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

    render(<AdvancedSettingsScreen />);

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
    expect(screen.getByText(/Cloud counts: customers 0, projects 0, estimates 0, invoices 0, invoice payments 0\./i)).toBeInTheDocument();
    expect(screen.getByText(/No Supabase writes were performed\./i)).toBeInTheDocument();
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

    render(<AdvancedSettingsScreen />);

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
    expect(screen.getByText(/Invoice payments: success, written 1/i)).toBeInTheDocument();
    expect(screen.getByText(/Local data remains in localStorage after this migration step\./i)).toBeInTheDocument();
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

  test("hides the workspace-create form once membership exists", () => {
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

    render(<AdvancedSettingsScreen />);

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

    fireEvent.click(screen.getByRole("button", { name: /download backup json/i }));

    expect(screen.getByRole("status")).toHaveTextContent(/backup json downloaded:/i);
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
});
