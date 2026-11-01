import { fireEvent, render, screen } from "@testing-library/react";
import { STORAGE_KEYS } from "../constants/storageKeys";
import NewProjectScreen from "./NewProjectScreen";
import EditProjectScreen from "./EditProjectScreen";
import CustomersScreen from "./CustomersScreen";
import TemplatesScreen from "./TemplatesScreen";
import CompanyProfileScreen from "./CompanyProfileScreen";
import { markCloudBackupDirty } from "../lib/cloudBackupQueue";

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

const PROJECT_DETAIL_TARGET_KEY = "estipaid-project-detail-target-v1";

function signInWithCompany() {
  useSupabaseAuth.mockReturnValue({
    configured: true,
    user: { id: "user_1" },
    userEmail: "owner@example.com",
  });
  // The canonical cloud status counts a workspace as connected only when the
  // account resolves a company record, exactly as useSupabaseAccount does.
  useSupabaseAccount.mockReturnValue({
    company: { id: "company_1", name: "Field Pocket LLC" },
    role: "owner",
    hasCompany: true,
  });
}

function signedOut() {
  useSupabaseAuth.mockReturnValue({ configured: false, user: null, userEmail: "" });
  useSupabaseAccount.mockReturnValue({ hasCompany: false });
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

test("NewProjectScreen shows inline backup status near the Create Project control when queue state exists", () => {
  signInWithCompany();
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  render(<NewProjectScreen onBack={() => {}} onSave={() => {}} />);

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Backup pending"
  );
});

// A connected workspace with no queued work reports the canonical connected
// state, never a pending or up-to-date claim it has no proof for.
test("NewProjectScreen shows connected status, not pending, when there is no queued work", () => {
  signInWithCompany();

  render(<NewProjectScreen onBack={() => {}} onSave={() => {}} />);

  const status = screen.getByTestId("cloud-backup-inline-status");
  expect(status).toHaveTextContent("Cloud connected");
  expect(status).not.toHaveTextContent(/Backup pending|Cloud up to date/);
});

test("EditProjectScreen shows inline backup status near the Save Changes control when queue state exists", () => {
  signInWithCompany();
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([
    { id: "proj_1", projectName: "Test Project", status: "active", createdAt: Date.now(), updatedAt: Date.now() },
  ]));
  localStorage.setItem(PROJECT_DETAIL_TARGET_KEY, "proj_1");

  render(<EditProjectScreen onBack={() => {}} onSave={() => {}} />);

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Backup pending"
  );
});

test("CustomersScreen edit mode shows inline backup status near the Save control when queue state exists", () => {
  signInWithCompany();
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  render(<CustomersScreen onDone={() => {}} onOpenProjectDetail={() => {}} />);
  fireEvent.click(screen.getByText(/add customer/i));

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Backup pending"
  );
});

test("TemplatesScreen shows inline backup status near the saved-templates area when queue state exists", () => {
  signInWithCompany();
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  render(<TemplatesScreen onOpenBuilder={() => {}} />);

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Backup pending"
  );
});

test("TemplatesScreen shows no inline backup status when signed out", () => {
  signedOut();
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  render(<TemplatesScreen onOpenBuilder={() => {}} />);

  expect(screen.queryByTestId("cloud-backup-inline-status")).not.toBeInTheDocument();
});

test("CompanyProfileScreen shows inline backup status near the Save control when queue state exists", () => {
  signInWithCompany();
  markCloudBackupDirty({ reason: "test_edit", severity: "normal" });

  render(<CompanyProfileScreen />);

  expect(screen.getByTestId("cloud-backup-inline-status")).toHaveTextContent(
    "Saved on this device · Backup pending"
  );
});
