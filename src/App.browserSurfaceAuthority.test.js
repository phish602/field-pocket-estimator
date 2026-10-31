/**
 * The one live EstiPaid browser surface, seen from the App.
 *
 * Everything below runs against the REAL browser-surface authority: only "the
 * other tab" is simulated, and it is simulated the way a real one appears from
 * here -- its claim is the record in shared localStorage, announced by a
 * `storage` event. No browser automation, no localhost, no network.
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import {
  buildReadyVaultRuntimeResult,
  buildUnlockedVaultSessionResult,
  primeConfiguredWorkspaceMocks,
  resetConfiguredTestWorkspace,
  activateConfiguredTestWorkspace,
  ensureTestAuthoritativeRuntime,
} from "./testUtils/configuredWorkspaceTestHarness";
import { BROWSER_SURFACE_OWNER_KEY, resetBrowserSurfaceAuthorityForTests } from "./lib/browserSurfaceAuthority";

// The account-scoped facade replaces window.localStorage while a workspace is
// open, and browser-surface coordination deliberately lives outside it. Hold the
// real Storage the way the authority module itself does.
const NATIVE_STORAGE = window.localStorage;

jest.mock("./lib/useSupabaseAuth", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useSupabaseAccount", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useSupabaseWorkspaceBootstrap", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useDeviceLockStatus", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoBackup", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useCloudAutoConvergence", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultSession", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultRuntimeActivation", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultCompatibilityBridge", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/useVaultIdleLock", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("./lib/supabaseDeviceLock", () => ({
  ensureCurrentDeviceCanMutateBusinessData: jest.fn(),
  ensureCurrentDeviceCanWriteCloud: jest.fn(),
  claimActiveDevice: jest.fn(),
  getOrCreateLocalDeviceId: jest.fn(() => "test_device_1"),
}));
jest.mock("./lib/vaultCrypto", () => ({ workspaceTag: () => Promise.resolve("A".repeat(43)) }));

const useSupabaseAuth = require("./lib/useSupabaseAuth").default;
const useVaultSession = require("./lib/useVaultSession").default;
const useVaultRuntimeActivation = require("./lib/useVaultRuntimeActivation").default;
const useCloudAutoConvergence = require("./lib/useCloudAutoConvergence").default;
const useCloudAutoBackup = require("./lib/useCloudAutoBackup").default;
const useDeviceLockStatus = require("./lib/useDeviceLockStatus").default;
const { claimActiveDevice } = require("./lib/supabaseDeviceLock");

function setup() {
  primeConfiguredWorkspaceMocks();
  activateConfiguredTestWorkspace();
  useVaultSession.mockReturnValue(buildUnlockedVaultSessionResult());
  useVaultRuntimeActivation.mockReturnValue(buildReadyVaultRuntimeResult());
  ensureTestAuthoritativeRuntime();
}

// Another tab claims the browser profile and the browser tells this document.
function anotherTabTakesOver() {
  const record = JSON.stringify({
    version: 1, surfaceId: "newer-tab", claimToken: "newer-token", claimedAt: Date.now(),
  });
  NATIVE_STORAGE.setItem(BROWSER_SURFACE_OWNER_KEY, record);
  const event = new Event("storage");
  event.key = BROWSER_SURFACE_OWNER_KEY;
  event.newValue = record;
  window.dispatchEvent(event);
}

function lastCallArg(mock) {
  return mock.mock.calls.length ? mock.mock.calls[mock.mock.calls.length - 1][0] : null;
}

beforeEach(() => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
});

afterEach(() => {
  resetBrowserSurfaceAuthorityForTests();
  resetConfiguredTestWorkspace();
  NATIVE_STORAGE.removeItem(BROWSER_SURFACE_OWNER_KEY);
});

test("the live surface mounts the shell and owns the browser profile", async () => {
  setup();
  render(<App />);

  expect(await screen.findByLabelText(/open menu/i)).toBeInTheDocument();
  expect(JSON.parse(NATIVE_STORAGE.getItem(BROWSER_SURFACE_OWNER_KEY)).surfaceId).toBeTruthy();
});

test("a taken-over surface is gated out of the shell and can take the tab back", async () => {
  setup();
  render(<App />);
  await screen.findByLabelText(/open menu/i);

  act(() => { anotherTabTakesOver(); });

  // No business shell, no business records, and contractor-safe wording.
  await waitFor(() => expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument());
  expect(screen.getByText("EstiPaid is active in another tab")).toBeInTheDocument();
  expect(screen.getByText("Use this tab to continue. The other tab will become inactive.")).toBeInTheDocument();
  const rendered = document.body.textContent || "";
  ["lease", "CAS", "surface id", "epoch", "BroadcastChannel", "mutation fence"].forEach((jargon) => {
    expect(rendered).not.toContain(jargon);
  });

  // The local reclaim action needs no re-authentication.
  fireEvent.click(screen.getByRole("button", { name: "Use This Tab" }));

  expect(await screen.findByLabelText(/open menu/i)).toBeInTheDocument();
  expect(JSON.parse(NATIVE_STORAGE.getItem(BROWSER_SURFACE_OWNER_KEY)).surfaceId).not.toBe("newer-tab");
});

// The UX live acceptance exposed: selecting the old tab used to reclaim
// instantly, so the gate never stayed on screen and both tabs looked live.
test("selecting the taken-over tab keeps the gate up; only Use This Tab transfers", async () => {
  setup();
  render(<App />);
  await screen.findByLabelText(/open menu/i);

  act(() => { anotherTabTakesOver(); });
  await waitFor(() => expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument());

  // Every ordinary way a person selects a tab.
  act(() => { window.dispatchEvent(new Event("focus")); });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
  act(() => { window.dispatchEvent(new Event("pageshow")); });

  expect(screen.getByText("EstiPaid is active in another tab")).toBeInTheDocument();
  expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument();
  expect(JSON.parse(NATIVE_STORAGE.getItem(BROWSER_SURFACE_OWNER_KEY)).surfaceId).toBe("newer-tab");

  fireEvent.click(screen.getByRole("button", { name: "Use This Tab" }));

  expect(await screen.findByLabelText(/open menu/i)).toBeInTheDocument();
  expect(JSON.parse(NATIVE_STORAGE.getItem(BROWSER_SURFACE_OWNER_KEY)).surfaceId).not.toBe("newer-tab");
});

test("a taken-over surface stops automatic cloud work and resumes it when reclaimed", async () => {
  setup();
  render(<App />);
  await screen.findByLabelText(/open menu/i);

  expect(lastCallArg(useCloudAutoConvergence)).toEqual(expect.objectContaining({ configured: true }));
  expect(lastCallArg(useCloudAutoBackup)).toEqual(expect.objectContaining({ configured: true, enabled: true }));

  act(() => { anotherTabTakesOver(); });
  await waitFor(() => expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument());

  // No convergence, no backup, no targeted mutation drain from an inactive tab.
  expect(lastCallArg(useCloudAutoConvergence)).toEqual(expect.objectContaining({
    configured: false, user: null, company: null,
  }));
  expect(lastCallArg(useCloudAutoBackup)).toEqual(expect.objectContaining({
    configured: false, enabled: false, user: null, company: null,
  }));

  // Selecting the tab does not resume cloud work either -- the transfer is
  // explicit.
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(lastCallArg(useCloudAutoConvergence)).toEqual(expect.objectContaining({ configured: false }));

  fireEvent.click(screen.getByRole("button", { name: "Use This Tab" }));
  await screen.findByLabelText(/open menu/i);

  expect(lastCallArg(useCloudAutoConvergence)).toEqual(expect.objectContaining({ configured: true }));
  expect(lastCallArg(useCloudAutoBackup)).toEqual(expect.objectContaining({ configured: true, enabled: true }));
});

test("a browser takeover is not a physical-device takeover and never signs the user out", async () => {
  setup();
  render(<App />);
  await screen.findByLabelText(/open menu/i);

  const auth = useSupabaseAuth.mock.results[0].value;
  const deviceLockBefore = lastCallArg(useDeviceLockStatus);
  const deviceIdBefore = NATIVE_STORAGE.getItem("estipaid-device-id-v1");

  act(() => { anotherTabTakesOver(); });
  await waitFor(() => expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument());

  // Auth persistence is shared across tabs: signing out here would sign the user
  // out of the tab they just moved to.
  expect(auth.signOut).not.toHaveBeenCalled();
  // The physical device keeps its identity, its lease, and its fencing.
  expect(claimActiveDevice).not.toHaveBeenCalled();
  expect(lastCallArg(useDeviceLockStatus)).toEqual(deviceLockBefore);
  expect(NATIVE_STORAGE.getItem("estipaid-device-id-v1")).toBe(deviceIdBefore);
});

// The vault is bound to the CURRENT browser ownership claim. The runtime hook
// is mocked here with exactly that contract -- ready only for the claim token it
// has verified -- so this proves the App wiring: the token reaches the vault,
// and the vault's readiness alone holds the shell and both cloud workers until
// a NEW claim is verified.
test("a reclaimed tab stays gated, shell and cloud, until the vault verifies the new claim", async () => {
  setup();
  let validatedToken = null;
  const renders = [];
  useVaultRuntimeActivation.mockImplementation((args) => {
    const ready = buildReadyVaultRuntimeResult();
    const token = args.browserOwnershipToken;
    renders.push({ token });
    // Inactive: the last verified cache is retained; App gates on the browser.
    if (!token) return ready;
    if (validatedToken === null) validatedToken = token;            // initial activation verified T1
    return token === validatedToken ? ready : { ...ready, state: "checking", checking: true };
  });
  useCloudAutoConvergence.mockImplementation((args) => { renders[renders.length - 1].convergence = args.configured; });
  useCloudAutoBackup.mockImplementation((args) => { renders[renders.length - 1].backup = args.enabled; });

  const view = render(<App />);
  await screen.findByLabelText(/open menu/i);
  const t1 = JSON.parse(NATIVE_STORAGE.getItem(BROWSER_SURFACE_OWNER_KEY)).claimToken;
  expect(lastCallArg(useVaultRuntimeActivation).browserOwnershipToken).toBe(t1);

  act(() => { anotherTabTakesOver(); });
  await waitFor(() => expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument());
  // An inactive surface presents no ownership token at all.
  expect(lastCallArg(useVaultRuntimeActivation).browserOwnershipToken).toBe("");

  renders.length = 0;
  fireEvent.click(screen.getByRole("button", { name: "Use This Tab" }));
  const t2 = JSON.parse(NATIVE_STORAGE.getItem(BROWSER_SURFACE_OWNER_KEY)).claimToken;
  expect(t2).toBeTruthy();
  expect(t2).not.toBe(t1);
  await waitFor(() => expect(lastCallArg(useVaultRuntimeActivation).browserOwnershipToken).toBe(t2));

  // Browser authority is back, but the vault has not verified T2: no shell, no
  // browser gate, and in NO render did a cloud worker become eligible.
  expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument();
  expect(screen.queryByText("EstiPaid is active in another tab")).not.toBeInTheDocument();
  const underT2 = renders.filter((entry) => entry.token === t2);
  expect(underT2.length).toBeGreaterThan(0);
  expect(underT2.every((entry) => entry.convergence === false && entry.backup === false)).toBe(true);

  // The vault verifies T2: shell and cloud eligibility resume.
  validatedToken = t2;
  view.rerender(<App />);
  expect(await screen.findByLabelText(/open menu/i)).toBeInTheDocument();
  expect(lastCallArg(useCloudAutoConvergence)).toEqual(expect.objectContaining({ configured: true }));
  expect(lastCallArg(useCloudAutoBackup)).toEqual(expect.objectContaining({ configured: true, enabled: true }));
});
