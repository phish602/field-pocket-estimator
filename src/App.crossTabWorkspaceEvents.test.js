import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import { STORAGE_KEYS } from "./constants/storageKeys";
import {
  buildAccountWorkspaceNamespace,
} from "./lib/accountScopedLocalStorage";
import {
  TEST_COMPANY,
  TEST_USER,
  resetConfiguredTestWorkspace,
  simulateAuthoritativeCrossTabUpdate,
  setupConfiguredWorkspace,
  buildUnlockedVaultSessionResult,
  buildLegacySafeVaultCompatibilityResult,
} from "./testUtils/configuredWorkspaceTestHarness";

// ISO-14L: another tab writes the PHYSICAL namespaced key, so the native
// `storage` event carries a key none of the app's logical listeners match. The
// module-private bridge in accountScopedLocalStorage is the single translation
// boundary; this suite proves the mounted shell reacts through it, and that a
// different workspace's write is still invisible.

jest.mock("./lib/useSupabaseAuth", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useSupabaseAccount", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useSupabaseWorkspaceBootstrap", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useDeviceLockStatus", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoBackup", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoConvergence", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultSession", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultRuntimeActivation", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultCompatibilityBridge", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/vaultCrypto", () => ({ workspaceTag: jest.fn() }));
jest.mock("./components/CloudHeaderStatusChip", () => ({ __esModule: true, default: () => null }));
jest.mock("./components/CloudBackupStatusBadge", () => ({ __esModule: true, default: () => null }));
jest.mock("./components/CloudHomeRestorePrompt", () => ({ __esModule: true, default: () => null }));

const useVaultSession = require("./lib/useVaultSession").default;
const useVaultCompatibilityBridge = require("./lib/useVaultCompatibilityBridge").default;
const vaultCrypto = require("./lib/vaultCrypto");
const { setActiveWorkspaceVaultCompatibility } = require("./lib/accountScopedLocalStorage");

const OTHER_USER = "99999999-9999-4999-8999-999999999999";
const OTHER_COMPANY = "88888888-8888-4888-8888-888888888888";

const SEEDED_PROJECT = "Seeded Alpha Project";
const CROSS_TAB_PROJECT = "Cross Tab Bravo Project";
const FOREIGN_PROJECT = "Foreign Workspace Project";

function estimate({ id, projectName, customerName, estimateNumber }) {
  const now = new Date("2026-07-26T00:00:00.000Z").getTime();
  return {
    id,
    estimateNumber,
    status: "pending",
    projectName,
    customerName,
    scopeNotes: "",
    total: 1200,
    createdAt: now,
    updatedAt: now,
    ts: now,
  };
}

// The genuine jsdom Storage, captured before any workspace is opened. This is a
// test-side capture only -- the module never exposes the real Storage object.
let realStorage = null;

beforeEach(() => {
  realStorage = window.localStorage;
  resetConfiguredTestWorkspace();
  setupConfiguredWorkspace();
  // This suite seeds the already activated fixture workspace before App mounts.
  // The explicit test-only bridge state permits that fixture write; production
  // authorization still comes only from the compatibility hook.
  setActiveWorkspaceVaultCompatibility({ workspaceTag: "A".repeat(43), state: "legacy-safe", generation: 1 });
  useVaultSession.mockReturnValue(buildUnlockedVaultSessionResult());
  vaultCrypto.workspaceTag.mockResolvedValue("A".repeat(43));
  useVaultCompatibilityBridge.mockImplementation(() => {
    setActiveWorkspaceVaultCompatibility({ workspaceTag: "A".repeat(43), state: "legacy-safe", generation: 1 });
    return buildLegacySafeVaultCompatibilityResult();
  });
});

afterEach(() => {
  resetConfiguredTestWorkspace();
});

// Simulates another tab: write the physical key straight onto the real Storage
// (bypassing this tab's facade), then raise the native event that tab would.
function simulateOtherTabWrite({ namespace, logicalKey, newValue, oldValue = null }) {
  const physicalKey = `${namespace}:${logicalKey}`;
  Storage.prototype.setItem.call(realStorage, physicalKey, newValue);
  act(() => {
    const event = new Event("storage");
    Object.assign(event, { key: physicalKey, newValue, oldValue, storageArea: null, url: "http://localhost/" });
    window.dispatchEvent(event);
  });
}

async function openSavedEstimates() {
  render(<App />);
  fireEvent.click(await screen.findByRole("button", { name: /^Estimates$/i }));
  await screen.findByText(/Saved Estimates/i);
}

test("a cross-tab write to the active workspace reaches the mounted shell as a logical update", async () => {
  const namespace = buildAccountWorkspaceNamespace({ userId: TEST_USER.id, companyId: TEST_COMPANY.id });
  const seeded = [estimate({ id: "est_alpha", projectName: SEEDED_PROJECT, customerName: "Alpha Customer", estimateNumber: "EST-1001" })];
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(seeded));

  await openSavedEstimates();
  expect(await screen.findByText(SEEDED_PROJECT)).toBeInTheDocument();
  expect(screen.queryByText(CROSS_TAB_PROJECT)).not.toBeInTheDocument();

  // Another tab appends an estimate to THIS workspace.
  const afterOtherTab = [
    ...seeded,
    estimate({ id: "est_bravo", projectName: CROSS_TAB_PROJECT, customerName: "Bravo Customer", estimateNumber: "EST-1002" }),
  ];
  // ISO-16: estimates are an approved VAULT key, so another tab's change arrives
  // as a verified authoritative commit that this tab re-reads, not as a raw
  // physical localStorage event.
  simulateAuthoritativeCrossTabUpdate({
    logicalKey: STORAGE_KEYS.ESTIMATES,
    value: JSON.stringify(afterOtherTab),
  });

  // The shell refreshed purely from the translated event.
  expect(await screen.findByText(CROSS_TAB_PROJECT)).toBeInTheDocument();
  expect(screen.getByText(SEEDED_PROJECT)).toBeInTheDocument();
});

test("a cross-tab write belonging to another workspace never reaches the shell", async () => {
  const foreignNamespace = buildAccountWorkspaceNamespace({ userId: OTHER_USER, companyId: OTHER_COMPANY });
  const seeded = [estimate({ id: "est_alpha", projectName: SEEDED_PROJECT, customerName: "Alpha Customer", estimateNumber: "EST-1001" })];
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(seeded));

  await openSavedEstimates();
  expect(await screen.findByText(SEEDED_PROJECT)).toBeInTheDocument();

  // A different account writes, in another tab, on this same browser.
  simulateOtherTabWrite({
    namespace: foreignNamespace,
    logicalKey: STORAGE_KEYS.ESTIMATES,
    newValue: JSON.stringify([estimate({ id: "est_foreign", projectName: FOREIGN_PROJECT, customerName: "Foreign Customer", estimateNumber: "EST-9999" })]),
  });

  await waitFor(() => expect(screen.getByText(SEEDED_PROJECT)).toBeInTheDocument());
  expect(screen.queryByText(FOREIGN_PROJECT)).not.toBeInTheDocument();
  expect(document.body.textContent).not.toContain(FOREIGN_PROJECT);
  expect(document.body.textContent).not.toContain("EST-9999");
});

test("an unscoped legacy cross-tab write never reaches the shell", async () => {
  const seeded = [estimate({ id: "est_alpha", projectName: SEEDED_PROJECT, customerName: "Alpha Customer", estimateNumber: "EST-1001" })];
  localStorage.setItem(STORAGE_KEYS.ESTIMATES, JSON.stringify(seeded));

  await openSavedEstimates();
  expect(await screen.findByText(SEEDED_PROJECT)).toBeInTheDocument();

  // A pre-ISO-14 tab writing the old unscoped key.
  const legacyValue = JSON.stringify([estimate({ id: "est_legacy", projectName: "BVW Legacy Project", customerName: "BVW", estimateNumber: "EST-20508" })]);
  Storage.prototype.setItem.call(realStorage, STORAGE_KEYS.ESTIMATES, legacyValue);
  act(() => {
    const event = new Event("storage");
    Object.assign(event, { key: STORAGE_KEYS.ESTIMATES, newValue: legacyValue, oldValue: null, storageArea: null, url: "http://localhost/" });
    window.dispatchEvent(event);
  });

  await waitFor(() => expect(screen.getByText(SEEDED_PROJECT)).toBeInTheDocument());
  expect(document.body.textContent).not.toContain("BVW");
  expect(document.body.textContent).not.toContain("EST-20508");
});
