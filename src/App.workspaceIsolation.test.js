import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";
import {
  DEVICE_GLOBAL_LOGICAL_KEYS,
  WORKSPACE_NAMESPACE_PREFIX,
  buildAccountWorkspaceNamespace,
  inspectAccountScopedWorkspace,
} from "./lib/accountScopedLocalStorage";

jest.mock("./lib/useSupabaseAuth", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useSupabaseAccount", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useSupabaseWorkspaceBootstrap", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useDeviceLockStatus", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoBackup", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoConvergence", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultSession", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./components/CloudHeaderStatusChip", () => ({ __esModule: true, default: () => null }));
jest.mock("./components/CloudBackupStatusBadge", () => ({ __esModule: true, default: () => null }));
jest.mock("./components/CloudHomeRestorePrompt", () => ({ __esModule: true, default: () => null }));

const useSupabaseAuth = require("./lib/useSupabaseAuth").default;
const useSupabaseAccount = require("./lib/useSupabaseAccount").default;
const useSupabaseWorkspaceBootstrap = require("./lib/useSupabaseWorkspaceBootstrap").default;
const useDeviceLockStatus = require("./lib/useDeviceLockStatus").default;
const useCloudAutoBackup = require("./lib/useCloudAutoBackup").default;
const useCloudAutoConvergence = require("./lib/useCloudAutoConvergence").default;
const useVaultSession = require("./lib/useVaultSession").default;

const USER_A = { id: "11111111-1111-4111-8111-111111111111", email: "a@example.test" };
const USER_B = { id: "22222222-2222-4222-8222-222222222222", email: "b@example.test" };
const COMPANY_A = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Company A" };
const COMPANY_B = { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "Company B" };

// Unmistakable pre-existing unscoped values. If any of these ever surface, an
// account has adopted data it does not own.
const LEGACY_COMPANY_NAME = "BVW";
const LEGACY_CUSTOMER_NAME = "Legacy BVW Customer";
const LEGACY_BALANCE = "20508";

function seedLegacyBrowserData() {
  localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ companyName: LEGACY_COMPANY_NAME }));
  localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([{ id: "legacy-1", name: LEGACY_CUSTOMER_NAME }]));
  localStorage.setItem(STORAGE_KEYS.INVOICES, JSON.stringify([{ id: "legacy-inv", balanceDue: LEGACY_BALANCE }]));
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify([{ id: "legacy-est", total: LEGACY_BALANCE }]));
  localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([{ id: "legacy-proj", name: LEGACY_COMPANY_NAME }]));
  localStorage.setItem(STORAGE_KEYS.SCOPE_TEMPLATES, JSON.stringify([{ id: "legacy-tpl" }]));
}

function auth(overrides = {}) {
  return {
    configured: true, loading: false, session: { user: USER_A }, user: USER_A,
    passwordRecoveryPending: false, passwordRecoveryReady: false, passwordRecoveryComplete: false,
    authBusy: false, errorMessage: "", infoMessage: "", userEmail: USER_A.email, rememberedEmail: "",
    signOut: jest.fn(), abandonPasswordRecovery: jest.fn(), signInWithPassword: jest.fn(), signUpWithPassword: jest.fn(),
    resetPasswordForEmail: jest.fn(), updatePassword: jest.fn(), completePasswordRecovery: jest.fn(), clearRememberedAccount: jest.fn(),
    ...overrides,
  };
}

function account(overrides = {}) {
  return {
    loading: false, error: "", company: COMPANY_A,
    membership: { user_id: USER_A.id, company_id: COMPANY_A.id, role: "owner" },
    companyUser: { user_id: USER_A.id, company_id: COMPANY_A.id, role: "owner" },
    hasCompany: true, role: "owner", refresh: jest.fn(), ...overrides,
  };
}

function signedInAs(user, company) {
  useSupabaseAuth.mockReturnValue(auth({ session: { user }, user, userEmail: user.email }));
  useSupabaseAccount.mockReturnValue(account({
    company,
    membership: { user_id: user.id, company_id: company.id, role: "owner" },
    companyUser: { user_id: user.id, company_id: company.id, role: "owner" },
  }));
}

let readKeys = [];
let getItemSpy = null;

beforeEach(() => {
  localStorage.clear();
  jest.clearAllMocks();
  readKeys = [];
  useSupabaseAuth.mockReturnValue(auth());
  useSupabaseAccount.mockReturnValue(account());
  useSupabaseWorkspaceBootstrap.mockReturnValue({ createWorkspace: jest.fn(), creating: false, error: "", success: "", result: null });
  useDeviceLockStatus.mockReturnValue({ loading: false, ready: true, isLocked: false, isActive: true });
  useVaultSession.mockReturnValue({
    capability: { state: "unlocked", code: "", message: "" }, checking: false, pending: false, error: "",
    setup: jest.fn(), unlock: jest.fn(), refresh: jest.fn(),
  });
  const realGetItem = Storage.prototype.getItem;
  getItemSpy = jest.spyOn(Storage.prototype, "getItem").mockImplementation(function getItem(key) {
    readKeys.push(key);
    return realGetItem.call(this, key);
  });
});

afterEach(() => {
  getItemSpy?.mockRestore();
  localStorage.clear();
});

const dashboard = () => screen.queryByLabelText(/open menu/i);

function expectWorkersDisabled() {
  expect(useDeviceLockStatus).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, configured: false, user: null, company: null }));
  expect(useCloudAutoConvergence).toHaveBeenLastCalledWith(expect.objectContaining({ configured: false, user: null, company: null }));
  expect(useCloudAutoBackup).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false, configured: false, user: null, company: null }));
}

function expectNoLegacyValuesOnScreen() {
  expect(screen.queryByText(new RegExp(LEGACY_COMPANY_NAME))).not.toBeInTheDocument();
  expect(screen.queryByText(new RegExp(LEGACY_CUSTOMER_NAME))).not.toBeInTheDocument();
  expect(screen.queryByText(new RegExp(LEGACY_BALANCE))).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain(LEGACY_COMPANY_NAME);
  expect(document.body.textContent).not.toContain(LEGACY_CUSTOMER_NAME);
  expect(document.body.textContent).not.toContain(LEGACY_BALANCE);
}

// Any EstiPaid business key read WITHOUT a workspace prefix would be a read of
// quarantined legacy data.
function unscopedBusinessReads() {
  return readKeys.filter((key) => typeof key === "string"
    && key.startsWith("estipaid-")
    && !key.startsWith(`${WORKSPACE_NAMESPACE_PREFIX}:`)
    && !DEVICE_GLOBAL_LOGICAL_KEYS.includes(key));
}

// The rejected ISO-14 onboarding vocabulary must not exist anywhere.
function expectNoRejectedOnboardingControls() {
  [/use existing device data/i, /start empty/i, /download transition backup/i, /transition backup/i, /choose browser data access/i]
    .forEach((pattern) => {
      expect(screen.queryByText(pattern)).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: pattern })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(pattern)).not.toBeInTheDocument();
    });
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/START EMPTY/);
  expect(document.body.textContent).not.toMatch(/backup/i);
  expect(document.body.textContent).not.toMatch(/browser storage|localStorage|database/i);
}

// 1. A signed-in user with no company sees only the company-name setup.
test("1. an authenticated user with no company sees workspace setup and never touches legacy data", () => {
  seedLegacyBrowserData();
  readKeys = [];
  useSupabaseAccount.mockReturnValue(account({ company: null, membership: null, companyUser: null, hasCompany: false }));

  render(<App />);

  expect(screen.getByText("Set up your company")).toBeInTheDocument();
  expect(screen.getByLabelText("Company name")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Create My Workspace" })).toBeInTheDocument();
  expect(dashboard()).not.toBeInTheDocument();
  expectNoLegacyValuesOnScreen();
  expectNoRejectedOnboardingControls();
  expect(unscopedBusinessReads()).toEqual([]);
  expectWorkersDisabled();
});

// 2. Creating a company opens a clean, empty, scoped workspace automatically.
test("2. creating a company activates a new namespace and opens an empty dashboard automatically", async () => {
  seedLegacyBrowserData();
  const created = jest.fn();
  useSupabaseAccount.mockReturnValue(account({ company: null, membership: null, companyUser: null, hasCompany: false }));
  useSupabaseWorkspaceBootstrap.mockImplementation(({ onCreated }) => ({
    createWorkspace: jest.fn((name) => { created(name); onCreated?.(); }),
    creating: false, error: "", success: "", result: null,
  }));

  const { rerender } = render(<App />);
  fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Valley Roofing" } });
  readKeys = [];
  fireEvent.click(screen.getByRole("button", { name: "Create My Workspace" }));
  expect(created).toHaveBeenCalledWith("Valley Roofing");

  // The account hook now resolves the freshly created company.
  useSupabaseAccount.mockReturnValue(account());
  rerender(<App />);

  await waitFor(() => expect(dashboard()).toBeInTheDocument());
  expectNoLegacyValuesOnScreen();
  expectNoRejectedOnboardingControls();
  expect(unscopedBusinessReads()).toEqual([]);
  expect(useDeviceLockStatus).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, configured: true, user: USER_A, company: COMPANY_A }));
});

// 3-5. Records live in their own namespace, survive a round trip, and are
// invisible to a different account on the same browser.
test("3-5. records persist per account and never leak across accounts on one browser", async () => {
  seedLegacyBrowserData();
  const namespaceA = buildAccountWorkspaceNamespace({ userId: USER_A.id, companyId: COMPANY_A.id });
  const namespaceB = buildAccountWorkspaceNamespace({ userId: USER_B.id, companyId: COMPANY_B.id });

  // 3. User A creates a record while their workspace is open.
  signedInAs(USER_A, COMPANY_A);
  const first = render(<App />);
  await waitFor(() => expect(dashboard()).toBeInTheDocument());
  // The shell patches the active storage so same-tab listeners fire, so this
  // write reaches the app exactly as an in-app save would.
  act(() => { localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify([{ id: "a-1", name: "A Customer" }])); });
  expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toContain("A Customer");
  first.unmount();

  expect(inspectAccountScopedWorkspace({ storage: window.localStorage, userId: USER_A.id, companyId: COMPANY_A.id }).logicalKeys)
    .toContain(STORAGE_KEYS.CUSTOMERS);

  // 4. Signing in as user B opens an empty namespace with no trace of A or of
  // the legacy browser data.
  signedInAs(USER_B, COMPANY_B);
  readKeys = [];
  const second = render(<App />);
  await waitFor(() => expect(dashboard()).toBeInTheDocument());
  expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toBeNull();
  expect(document.body.textContent).not.toContain("A Customer");
  expectNoLegacyValuesOnScreen();
  expectNoRejectedOnboardingControls();
  expect(unscopedBusinessReads()).toEqual([]);
  second.unmount();

  // 5. Returning to user A / company A reopens exactly that namespace.
  signedInAs(USER_A, COMPANY_A);
  const third = render(<App />);
  await waitFor(() => expect(dashboard()).toBeInTheDocument());
  expect(localStorage.getItem(STORAGE_KEYS.CUSTOMERS)).toContain("A Customer");
  third.unmount();

  // The physical layout proves the separation, and legacy keys are untouched.
  const physicalKeys = [];
  for (let index = 0; index < localStorage.length; index += 1) physicalKeys.push(localStorage.key(index));
  expect(physicalKeys).toContain(`${namespaceA}:${STORAGE_KEYS.CUSTOMERS}`);
  expect(physicalKeys.some((key) => key.startsWith(`${namespaceB}:`))).toBe(true);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOMERS))).toEqual([{ id: "legacy-1", name: LEGACY_CUSTOMER_NAME }]);
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE))).toEqual({ companyName: LEGACY_COMPANY_NAME });
});

// 6. The same user in a different company gets a different empty workspace.
test("6. the same user with a different company opens a different empty namespace", async () => {
  signedInAs(USER_A, COMPANY_A);
  const first = render(<App />);
  await waitFor(() => expect(dashboard()).toBeInTheDocument());
  act(() => { localStorage.setItem(STORAGE_KEYS.PROJECTS, JSON.stringify([{ id: "a-project" }])); });
  first.unmount();

  signedInAs(USER_A, COMPANY_B);
  const second = render(<App />);
  await waitFor(() => expect(dashboard()).toBeInTheDocument());
  expect(localStorage.getItem(STORAGE_KEYS.PROJECTS)).toBeNull();
  second.unmount();

  expect(inspectAccountScopedWorkspace({ storage: window.localStorage, userId: USER_A.id, companyId: COMPANY_A.id }).logicalKeys)
    .toContain(STORAGE_KEYS.PROJECTS);
  expect(inspectAccountScopedWorkspace({ storage: window.localStorage, userId: USER_A.id, companyId: COMPANY_B.id }).logicalKeys)
    .not.toContain(STORAGE_KEYS.PROJECTS);
});

// 7. Account loading and account errors keep everything closed.
test("7a. account loading keeps the dashboard unmounted and the workers disabled", () => {
  seedLegacyBrowserData();
  readKeys = [];
  useSupabaseAccount.mockReturnValue(account({ loading: true, company: null, membership: null, companyUser: null, hasCompany: false }));

  render(<App />);

  expect(dashboard()).not.toBeInTheDocument();
  expectNoLegacyValuesOnScreen();
  expect(unscopedBusinessReads()).toEqual([]);
  expectWorkersDisabled();
});

test("7b. an account lookup error fails closed with a polished retry screen", () => {
  seedLegacyBrowserData();
  useSupabaseAccount.mockReturnValue(account({ company: null, membership: null, companyUser: null, hasCompany: false, error: "lookup failed" }));

  render(<App />);

  expect(screen.getByText("We couldn’t open your workspace")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try Again" })).toBeInTheDocument();
  expect(dashboard()).not.toBeInTheDocument();
  expectNoLegacyValuesOnScreen();
  expectNoRejectedOnboardingControls();
  expectWorkersDisabled();
});

// 8. A namespace that cannot be opened is a hard stop.
test("8. namespace activation failure shows a fail-closed screen with no dashboard and no workers", async () => {
  seedLegacyBrowserData();
  const realSetItem = Storage.prototype.setItem;
  const setItemSpy = jest.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(key, value) {
    if (typeof key === "string" && key.startsWith(`${WORKSPACE_NAMESPACE_PREFIX}:`)) throw new Error("blocked");
    return realSetItem.call(this, key, value);
  });
  try {
    render(<App />);

    expect(await screen.findByText("We couldn’t open your workspace")).toBeInTheDocument();
    expect(dashboard()).not.toBeInTheDocument();
    expectNoLegacyValuesOnScreen();
    expectNoRejectedOnboardingControls();
    expectWorkersDisabled();
  } finally {
    setItemSpy.mockRestore();
  }
});

// 9. Password recovery stays gated regardless of any workspace state.
test("9. password recovery remains fully gated with no workspace and no workers", () => {
  seedLegacyBrowserData();
  useSupabaseAuth.mockReturnValue(auth({ passwordRecoveryPending: true, passwordRecoveryReady: false }));

  render(<App />);

  expect(dashboard()).not.toBeInTheDocument();
  expect(screen.queryByText("Set up your company")).not.toBeInTheDocument();
  expectNoLegacyValuesOnScreen();
  expectWorkersDisabled();
});

// 10. Worker gating and the routing guarantee.
test("10. workers stay disabled until the namespace is verified, then read only scoped keys", async () => {
  seedLegacyBrowserData();
  useSupabaseAccount.mockReturnValue(account({ loading: true, company: null, membership: null, companyUser: null, hasCompany: false }));
  const { rerender } = render(<App />);
  expectWorkersDisabled();

  useSupabaseAccount.mockReturnValue(account());
  readKeys = [];
  rerender(<App />);
  await waitFor(() => expect(dashboard()).toBeInTheDocument());

  expect(useDeviceLockStatus).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, configured: true, user: USER_A, company: COMPANY_A }));
  expect(useCloudAutoConvergence).toHaveBeenLastCalledWith(expect.objectContaining({ configured: true, user: USER_A, company: COMPANY_A }));
  expect(useCloudAutoBackup).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, configured: true, user: USER_A, company: COMPANY_A }));

  // Every EstiPaid business read the mounted app performed was namespaced.
  expect(unscopedBusinessReads()).toEqual([]);
  expect(readKeys.some((key) => typeof key === "string" && key.startsWith(`${WORKSPACE_NAMESPACE_PREFIX}:`))).toBe(true);
});

test("signing out deactivates the namespace so unscoped keys are never exposed again", async () => {
  seedLegacyBrowserData();
  const { rerender } = render(<App />);
  await waitFor(() => expect(dashboard()).toBeInTheDocument());

  useSupabaseAuth.mockReturnValue(auth({ session: null, user: null }));
  useSupabaseAccount.mockReturnValue(account({ company: null, membership: null, companyUser: null, hasCompany: false }));
  rerender(<App />);

  expect(dashboard()).not.toBeInTheDocument();
  // The real storage is back in place: the legacy values are exactly as seeded.
  expect(JSON.parse(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE))).toEqual({ companyName: LEGACY_COMPANY_NAME });
  expectWorkersDisabled();
});

test("unconfigured account service fails closed without mounting the shell or workers", () => {
  useSupabaseAuth.mockReturnValue(auth({ configured: false, session: null, user: null }));
  render(<App />);
  expect(screen.getByText("EstiPaid couldn’t start securely")).toBeInTheDocument();
  expect(dashboard()).not.toBeInTheDocument();
  expectWorkersDisabled();
});

test.each([
  ["inspection", { capability: { state: "locked", code: "", message: "" }, checking: true }],
  ["setup required", { capability: { state: "setup_required", code: "", message: "" } }],
  ["locked", { capability: { state: "locked", code: "", message: "" } }],
  ["unlocking", { capability: { state: "unlocking", code: "", message: "" }, pending: true }],
  ["damaged", { capability: { state: "damaged", code: "RECORD_CORRUPT", message: "" } }],
  ["unsupported", { capability: { state: "unsupported", code: "UNSUPPORTED_ENVIRONMENT", message: "" } }],
  ["reset required", { capability: { state: "reset_required", code: "", message: "" } }],
])("vault %s keeps the normal shell unmounted after workspace activation", async (_name, vault) => {
  useVaultSession.mockReturnValue({ setup: jest.fn(), unlock: jest.fn(), refresh: jest.fn(), checking: false, pending: false, error: "", ...vault });
  render(<App />);
  await waitFor(() => expect(useVaultSession).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, userId: USER_A.id, companyId: COMPANY_A.id })));
  expect(dashboard()).not.toBeInTheDocument();
  expect(screen.getByLabelText("Local Data Password access")).toBeInTheDocument();
});

test("exact unlocked vault capability is required to mount the existing shell", async () => {
  render(<App />);
  await waitFor(() => expect(dashboard()).toBeInTheDocument());
  expect(useVaultSession).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true, userId: USER_A.id, companyId: COMPANY_A.id }));
});

test("account and company changes immediately remove the shell before a new vault unlock", async () => {
  const { rerender } = render(<App />);
  await waitFor(() => expect(dashboard()).toBeInTheDocument());
  useVaultSession.mockReturnValue({ capability: { state: "locked", code: "", message: "" }, checking: true, pending: false, error: "", setup: jest.fn(), unlock: jest.fn(), refresh: jest.fn() });
  signedInAs(USER_B, COMPANY_B);
  rerender(<App />);
  expect(dashboard()).not.toBeInTheDocument();
  expect(useVaultSession).toHaveBeenLastCalledWith(expect.objectContaining({ userId: USER_B.id, companyId: COMPANY_B.id }));
});
