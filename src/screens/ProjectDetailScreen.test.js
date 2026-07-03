import { act, render, screen } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import ProjectDetailScreen from "./ProjectDetailScreen";
import {
  markCloudBackupDirty,
  clearCloudBackupDirty,
} from "../lib/cloudBackupQueue";
import { CLOUD_AUTO_BACKUP_RUNNING_EVENT } from "../lib/useCloudAutoBackup";

jest.mock("../lib/useSupabaseAuth", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("../lib/useSupabaseAccount", () => ({
  __esModule: true,
  default: jest.fn(),
}));

const useSupabaseAuth = require("../lib/useSupabaseAuth").default;
const useSupabaseAccount = require("../lib/useSupabaseAccount").default;

const PROJECTS_KEY = STORAGE_KEYS.PROJECTS;
const INVOICES_KEY = STORAGE_KEYS.INVOICES;
const PROJECT_DETAIL_TARGET_KEY = "estipaid-project-detail-target-v1";

function setViewportWidth(width) {
  Object.defineProperty(window, "innerWidth", { writable: true, configurable: true, value: width });
}

function signedOut() {
  useSupabaseAuth.mockReturnValue({ configured: false, user: null, userEmail: "" });
  useSupabaseAccount.mockReturnValue({ hasCompany: false });
}

function signedInWithCompany() {
  useSupabaseAuth.mockReturnValue({
    configured: true,
    user: { id: "user_1" },
    userEmail: "owner@example.com",
  });
  useSupabaseAccount.mockReturnValue({ hasCompany: true });
}

function seedProject(project) {
  localStorage.setItem(PROJECTS_KEY, JSON.stringify([project]));
}

function seedProjectDetailTarget(projectId) {
  localStorage.setItem(PROJECT_DETAIL_TARGET_KEY, projectId);
}

function createProject(overrides = {}) {
  return {
    id: "proj_test",
    projectName: "Test Project",
    customerName: "Test Customer",
    status: "active",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("ProjectDetailScreen mobile title, metadata, and backup chip", () => {
  beforeEach(() => {
    localStorage.clear();
    setViewportWidth(1024);
    signedOut();
  });

  afterEach(() => {
    localStorage.clear();
    setViewportWidth(1024);
  });

  test("a long project title renders fully without truncation", () => {
    const longName = "The Complete Whole-House Exterior Renovation And Roofing Replacement Project For The Johnson Family Residence";
    seedProject(createProject({ id: "proj_1", projectName: longName }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    const title = document.querySelector(".pe-project-detail-title");
    expect(title.textContent).toBe(longName);
  });

  test("the title uses mobile-safe wrapping so a long unbroken word can't overflow", () => {
    const unbrokenName = "Supercalifragilisticexpialidociousresidentialexteriorrenovationandroofingreplacement";
    seedProject(createProject({ id: "proj_1", projectName: unbrokenName }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    const title = document.querySelector(".pe-project-detail-title");
    expect(title.style.overflowWrap).toBe("anywhere");
    expect(title.style.wordBreak).toBe("break-word");
    expect(title.textContent).toBe(unbrokenName);
  });

  test("the title uses a tightened line-height to avoid vertical bloat", () => {
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    const title = document.querySelector(".pe-project-detail-title");
    expect(title.style.lineHeight).toBe("1.15");
  });

  test("financial cards remain single-column on narrow phone widths", () => {
    setViewportWidth(375);
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    const grid = screen.getAllByText("Estimated")
      .map((node) => node.parentElement.parentElement)
      .find((candidate) => !String(candidate.style.gridTemplateColumns || "").includes("auto-fit"));
    expect(grid.style.gridTemplateColumns).toBe("1fr");
  });

  test("the screen root carries a stable mobile-safe-bottom-padding marker", () => {
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    const { container } = render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(container.querySelector(".pe-project-detail-screen")).toBeInTheDocument();
  });

  test("metadata row still renders document count and Updated date", () => {
    seedProject(createProject({ id: "proj_1", updatedAt: Date.now() }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(screen.getByText(/^\d+ documents?$/i)).toBeInTheDocument();
    expect(screen.getByText(/^Updated /i)).toBeInTheDocument();
  });

  test("no large cloud backup card/badge appears on Project Detail", () => {
    signedInWithCompany();
    markCloudBackupDirty({ reason: "test_edit", severity: "normal" });
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(screen.queryByTestId("cloud-backup-status-badge")).not.toBeInTheDocument();
  });

  test("compact backup chip does not render when there is no cloud workspace", () => {
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(screen.queryByTestId("project-detail-backup-chip")).not.toBeInTheDocument();
  });

  test("compact backup chip does not render when the queue has never been dirty and never backed up", () => {
    signedInWithCompany();
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(screen.queryByTestId("project-detail-backup-chip")).not.toBeInTheDocument();
  });

  test("compact backup chip shows 'Backup pending' when the queue is dirty", () => {
    signedInWithCompany();
    markCloudBackupDirty({ reason: "test_edit", severity: "normal" });
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(screen.getByTestId("project-detail-backup-chip")).toHaveTextContent("Backup pending");
    expect(screen.queryByText(/sync/i)).not.toBeInTheDocument();
  });

  test("compact backup chip shows 'Backing up...' while the worker is running", () => {
    signedInWithCompany();
    markCloudBackupDirty({ reason: "test_edit", severity: "normal" });
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);
    act(() => {
      window.dispatchEvent(new CustomEvent(CLOUD_AUTO_BACKUP_RUNNING_EVENT, { detail: { running: true } }));
    });

    expect(screen.getByTestId("project-detail-backup-chip")).toHaveTextContent("Backing up...");
  });

  test("compact backup chip shows 'Cloud up to date' only once a successful backup is confirmed", () => {
    signedInWithCompany();
    clearCloudBackupDirty("test_backup_success");
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(screen.getByTestId("project-detail-backup-chip")).toHaveTextContent("Cloud up to date");
  });

  test("project detail financial totals still render correctly", () => {
    seedProject(createProject({ id: "proj_1" }));
    seedProjectDetailTarget("proj_1");
    localStorage.setItem(INVOICES_KEY, JSON.stringify([
      {
        id: "inv_1",
        docType: "invoice",
        projectId: "proj_1",
        invoiceNumber: "INV-1",
        invoiceTotal: 6446.77,
        total: 6446.77,
        status: "sent",
        paymentStatus: "partial",
        amountPaid: 2600,
        balanceRemaining: 3846.77,
        updatedAt: Date.now(),
        createdAt: Date.now(),
      },
    ]));

    render(<ProjectDetailScreen onBack={() => {}} onOpenProjectDetail={() => {}} />);

    expect(screen.getAllByText("$6,446.77").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$2,600.00").length).toBeGreaterThan(0);
    expect(screen.getAllByText("$3,846.77").length).toBeGreaterThan(0);
  });
});
