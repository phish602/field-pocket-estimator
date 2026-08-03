/**
 * ISO-16 -- App activation order.
 *
 * The shell must mount only when the exact workspace is ready, the exact vault
 * is unlocked, AND the authoritative runtime for that workspace reports `ready`.
 * Cloud workers must see an identity only under the same condition.
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import App from "./App";
import {
  TEST_COMPANY,
  TEST_USER,
  buildReadyVaultRuntimeResult,
  buildUnlockedVaultSessionResult,
  primeConfiguredWorkspaceMocks,
  resetConfiguredTestWorkspace,
  activateConfiguredTestWorkspace,
} from "./testUtils/configuredWorkspaceTestHarness";

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
}));
jest.mock("./lib/vaultCrypto", () => ({ workspaceTag: () => Promise.resolve("A".repeat(43)) }));

const useVaultSession = require("./lib/useVaultSession").default;
const useVaultRuntimeActivation = require("./lib/useVaultRuntimeActivation").default;
const useCloudAutoConvergence = require("./lib/useCloudAutoConvergence").default;
const useCloudAutoBackup = require("./lib/useCloudAutoBackup").default;
const useVaultIdleLock = require("./lib/useVaultIdleLock").default;

function setup({ vault, runtime } = {}) {
  primeConfiguredWorkspaceMocks();
  activateConfiguredTestWorkspace();
  useVaultSession.mockReturnValue(vault || buildUnlockedVaultSessionResult());
  useVaultRuntimeActivation.mockReturnValue(runtime || buildReadyVaultRuntimeResult());
}

afterEach(() => {
  resetConfiguredTestWorkspace();
});

test("the shell mounts only when the authoritative runtime is ready", async () => {
  setup();
  render(<App />);
  expect(await screen.findByLabelText(/open menu/i)).toBeInTheDocument();
});

test("a locked vault shows the access gate and never the shell", async () => {
  setup({ vault: { ...buildUnlockedVaultSessionResult(), capability: Object.freeze({ state: "locked", code: "", message: "" }) } });
  render(<App />);
  await waitFor(() => expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument());
});

test("a missing vault shows the setup gate and never the shell", async () => {
  setup({ vault: { ...buildUnlockedVaultSessionResult(), capability: Object.freeze({ state: "setup_required", code: "", message: "" }) } });
  render(<App />);
  await waitFor(() => expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument());
});

test.each([
  ["checking"],
  ["migrating"],
  ["sealing"],
  ["hydrating"],
  ["pending-writes"],
  ["blocked"],
])("the shell does not mount while the runtime is %s", async (state) => {
  setup({ runtime: buildReadyVaultRuntimeResult({ state, checking: state !== "blocked" && state !== "pending-writes" }) });
  render(<App />);
  await waitFor(() => expect(screen.getByLabelText(/encrypted local data access/i)).toBeInTheDocument());
  expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument();
});

test("the runtime gate never offers a destructive reset or asks for the login password", async () => {
  setup({ runtime: buildReadyVaultRuntimeResult({ state: "blocked", checking: false, code: "CATALOG_INVALID" }) });
  render(<App />);
  const gate = await screen.findByLabelText(/encrypted local data access/i);
  const text = gate.textContent.toLowerCase();

  // The strongest form of "offers no destructive action" is that the gate has no
  // interactive control at all: nothing to click, nothing to submit.
  expect(gate.querySelectorAll("button, a, input, select, textarea, [role='button']")).toHaveLength(0);

  // And no imperative that would send a contractor to destroy their own data or
  // hand over the wrong password. ("deleted" inside the reassurance below is the
  // opposite of an offer, so the patterns are offer-shaped.)
  expect(text).not.toMatch(/delete your|erase your|reset your data|clear (your )?browser|clear (your )?storage/);
  expect(text).not.toMatch(/sign[- ]?in password|login password|account password/);
  expect(text).not.toMatch(/recover (your )?(local data )?password|password recovery|forgot/);

  // It states plainly that nothing was changed, repaired, or deleted.
  expect(text).toMatch(/nothing was changed, repaired, or deleted/);
});

test.each([
  ["checking"],
  ["migrating"],
  ["sealing"],
  ["hydrating"],
  ["blocked"],
])("cloud convergence and cloud backup receive no identity while the runtime is %s", async (state) => {
  setup({ runtime: buildReadyVaultRuntimeResult({ state, checking: state !== "blocked" }) });
  render(<App />);
  await waitFor(() => expect(useCloudAutoConvergence).toHaveBeenCalled());

  const convergence = useCloudAutoConvergence.mock.calls.at(-1)[0];
  expect(convergence.configured).toBe(false);
  expect(convergence.user).toBeNull();
  expect(convergence.company).toBeNull();

  const backup = useCloudAutoBackup.mock.calls.at(-1)[0];
  expect(backup.enabled).toBe(false);
  expect(backup.configured).toBe(false);
  expect(backup.user).toBeNull();
  expect(backup.company).toBeNull();
});

test("cloud workers receive the exact identity only once the runtime is ready", async () => {
  setup();
  render(<App />);
  await screen.findByLabelText(/open menu/i);
  const convergence = useCloudAutoConvergence.mock.calls.at(-1)[0];
  expect(convergence.configured).toBe(true);
  expect(convergence.user?.id).toBe(TEST_USER.id);
  expect(convergence.company?.id).toBe(TEST_COMPANY.id);
});

test("a runtime that blocks after mounting removes the shell", async () => {
  setup();
  const view = render(<App />);
  await screen.findByLabelText(/open menu/i);

  useVaultRuntimeActivation.mockReturnValue(buildReadyVaultRuntimeResult({ state: "blocked", checking: false, code: "DURABILITY_FAILED" }));
  view.rerender(<App />);
  await waitFor(() => expect(screen.queryByLabelText(/open menu/i)).not.toBeInTheDocument());
  expect(screen.getByLabelText(/encrypted local data access/i)).toBeInTheDocument();
});

test("idle locking is wired to the flush-aware lock, not the raw vault lock", async () => {
  const vault = buildUnlockedVaultSessionResult();
  const runtime = buildReadyVaultRuntimeResult();
  setup({ vault, runtime });
  render(<App />);
  await screen.findByLabelText(/open menu/i);
  const idle = useVaultIdleLock.mock.calls.at(-1)[0];
  expect(idle.enabled).toBe(true);
  expect(typeof idle.onLock).toBe("function");
  // The raw vault lock is NOT handed to the idle locker under the activation
  // policy: a lock must flush accepted writes first.
  expect(idle.onLock).not.toBe(vault.lock);
  idle.onLock();
  await waitFor(() => expect(runtime.flushAndLock).toHaveBeenCalledWith(vault.lock));
});

test("the activation hook is called with the exact authenticated identity", async () => {
  setup();
  render(<App />);
  await screen.findByLabelText(/open menu/i);
  const activation = useVaultRuntimeActivation.mock.calls.at(-1)[0];
  expect(activation.enabled).toBe(true);
  expect(activation.userId).toBe(TEST_USER.id);
  expect(activation.companyId).toBe(TEST_COMPANY.id);
  expect(activation.vaultUnlocked).toBe(true);
});

test("the activation hook is not enabled while the vault is locked", async () => {
  setup({ vault: { ...buildUnlockedVaultSessionResult(), capability: Object.freeze({ state: "locked", code: "", message: "" }) } });
  render(<App />);
  await waitFor(() => expect(useVaultRuntimeActivation).toHaveBeenCalled());
  const activation = useVaultRuntimeActivation.mock.calls.at(-1)[0];
  expect(activation.vaultUnlocked).toBe(false);
});
