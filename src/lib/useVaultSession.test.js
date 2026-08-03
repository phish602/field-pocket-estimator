import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import useVaultSession from "./useVaultSession";

jest.mock("./vaultSession", () => ({
  lockVault: jest.fn(() => ({ state: "locked", code: "", message: "" })),
  readVaultCapability: jest.fn(),
  setupVault: jest.fn(),
  unlockVault: jest.fn(),
}));

const vaultSession = require("./vaultSession");

function deferred() {
  let resolve;
  const promise = new Promise((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

let latest = null;
function Probe(props) {
  latest = useVaultSession(props);
  return <div data-state={latest.capability.state} data-checking={String(latest.checking)} />;
}

function renderProbe(props = {}) {
  return render(<Probe userId="user-a" companyId="company-a" enabled {...props} />);
}

const locked = { state: "locked", code: "", message: "" };
const unlocked = { state: "unlocked", code: "", message: "" };

beforeEach(() => {
  latest = null;
  jest.clearAllMocks();
  vaultSession.readVaultCapability.mockResolvedValue(locked);
  vaultSession.setupVault.mockResolvedValue(unlocked);
  vaultSession.unlockVault.mockResolvedValue(unlocked);
});

test("exposes the same narrow non-secret hook surface", async () => {
  renderProbe();
  await waitFor(() => expect(latest.capability).toEqual(unlocked));
  expect(Object.keys(latest).sort()).toEqual(["capability", "checking", "error", "lock", "pending", "refresh", "setup", "unlock"]);
  expect(JSON.stringify(latest)).not.toMatch(/password|dek|kek|cryptokey|metadata/i);
});

test("automatically creates a device vault when setup is required", async () => {
  vaultSession.readVaultCapability.mockResolvedValue({ state: "setup_required", code: "", message: "" });
  renderProbe();
  await waitFor(() => expect(latest.capability).toEqual(unlocked));
  expect(vaultSession.setupVault).toHaveBeenCalledWith({ userId: "user-a", companyId: "company-a" });
  expect(vaultSession.unlockVault).not.toHaveBeenCalled();
});

test("automatically opens a locked device vault without a password", async () => {
  renderProbe();
  await waitFor(() => expect(latest.capability).toEqual(unlocked));
  expect(vaultSession.unlockVault).toHaveBeenCalledWith({ userId: "user-a", companyId: "company-a" });
  expect(vaultSession.setupVault).not.toHaveBeenCalled();
});

test.each(["unlocked", "damaged", "unsupported", "reset_required"])("publishes terminal %s capability without a second operation", async (state) => {
  vaultSession.readVaultCapability.mockResolvedValue({ state, code: "", message: "" });
  renderProbe();
  await waitFor(() => expect(latest.capability.state).toBe(state));
  expect(vaultSession.setupVault).not.toHaveBeenCalled();
  expect(vaultSession.unlockVault).not.toHaveBeenCalled();
});

test("disabled state performs no capability read and synchronously locks", () => {
  renderProbe({ enabled: false });
  expect(vaultSession.readVaultCapability).not.toHaveBeenCalled();
  expect(vaultSession.lockVault).toHaveBeenCalled();
  expect(latest.capability.state).toBe("locked");
});

test("starts automatic activation in a blocked checking state", () => {
  const read = deferred();
  vaultSession.readVaultCapability.mockReturnValue(read.promise);
  renderProbe();
  expect(latest.capability.state).toBe("locked");
  expect(latest.checking).toBe(true);
});

test("refresh retries automatic device-key activation", async () => {
  vaultSession.readVaultCapability.mockResolvedValue({ state: "damaged", code: "RECORD_CORRUPT", message: "" });
  renderProbe();
  await waitFor(() => expect(latest.capability.state).toBe("damaged"));
  vaultSession.readVaultCapability.mockResolvedValueOnce(locked);
  await act(async () => { await latest.refresh(); });
  await waitFor(() => expect(latest.capability.state).toBe("unlocked"));
  expect(vaultSession.unlockVault).toHaveBeenLastCalledWith({ userId: "user-a", companyId: "company-a" });
});

test("legacy manual setup and unlock remain available without retaining password material", async () => {
  vaultSession.readVaultCapability.mockResolvedValue({ state: "damaged", code: "RECORD_CORRUPT", message: "" });
  renderProbe();
  await waitFor(() => expect(latest.checking).toBe(false));
  await act(async () => { await latest.setup("setup-local-password"); });
  expect(vaultSession.setupVault).toHaveBeenCalledWith({ userId: "user-a", companyId: "company-a", password: "setup-local-password" });
  await act(async () => { await latest.unlock("unlock-local-password"); });
  expect(vaultSession.unlockVault).toHaveBeenCalledWith({ userId: "user-a", companyId: "company-a", password: "unlock-local-password" });
  expect(JSON.stringify(latest)).not.toMatch(/setup-local-password|unlock-local-password|password|dek|kek/i);
});

test("manual lock publishes locked and waits for explicit refresh", async () => {
  renderProbe();
  await waitFor(() => expect(latest.capability).toEqual(unlocked));
  act(() => { latest.lock(); });
  expect(latest.capability).toEqual(locked);
  expect(latest.checking).toBe(false);
  expect(vaultSession.unlockVault).toHaveBeenCalledTimes(1);
  await act(async () => { await latest.refresh(); });
  expect(vaultSession.unlockVault).toHaveBeenCalledTimes(2);
});

test("manual lock invalidates an older automatic activation", async () => {
  const unlock = deferred();
  vaultSession.unlockVault.mockReturnValue(unlock.promise);
  renderProbe();
  await waitFor(() => expect(vaultSession.unlockVault).toHaveBeenCalled());
  act(() => { latest.lock(); });
  await act(async () => { unlock.resolve(unlocked); await unlock.promise; });
  expect(latest.capability).toEqual(locked);
});

test("an identity change immediately drops the prior workspace and activates the new one", async () => {
  const view = renderProbe();
  await waitFor(() => expect(latest.capability).toEqual(unlocked));
  view.rerender(<Probe userId="user-b" companyId="company-b" enabled />);
  expect(latest.capability.state).toBe("locked");
  expect(latest.checking).toBe(true);
  await waitFor(() => expect(vaultSession.readVaultCapability).toHaveBeenLastCalledWith({ userId: "user-b", companyId: "company-b" }));
  await waitFor(() => expect(vaultSession.unlockVault).toHaveBeenLastCalledWith({ userId: "user-b", companyId: "company-b" }));
});

test("a stale activation cannot republish an older workspace", async () => {
  const readA = deferred();
  const readB = deferred();
  vaultSession.readVaultCapability.mockReturnValueOnce(readA.promise).mockReturnValueOnce(readB.promise);
  const view = renderProbe();
  view.rerender(<Probe userId="user-b" companyId="company-b" enabled />);
  await act(async () => { readA.resolve(unlocked); await readA.promise; });
  expect(latest.capability.state).toBe("locked");
  await act(async () => { readB.resolve({ state: "damaged", code: "RECORD_CORRUPT", message: "" }); await readB.promise; });
  await waitFor(() => expect(latest.capability.state).toBe("damaged"));
});

test("same-identity rerenders do not repeat activation", async () => {
  const view = renderProbe();
  await waitFor(() => expect(latest.capability).toEqual(unlocked));
  const reads = vaultSession.readVaultCapability.mock.calls.length;
  const unlocks = vaultSession.unlockVault.mock.calls.length;
  view.rerender(<Probe userId="user-a" companyId="company-a" enabled />);
  expect(vaultSession.readVaultCapability).toHaveBeenCalledTimes(reads);
  expect(vaultSession.unlockVault).toHaveBeenCalledTimes(unlocks);
});

test("does not access localStorage, sessionStorage, messaging, or network", async () => {
  const local = jest.spyOn(Storage.prototype, "getItem");
  const session = jest.spyOn(Storage.prototype, "setItem");
  const dispatch = jest.spyOn(window, "dispatchEvent");
  const fetch = jest.spyOn(global, "fetch");
  try {
    renderProbe();
    await waitFor(() => expect(latest.capability).toEqual(unlocked));
    act(() => { latest.lock(); });
    expect(local).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    local.mockRestore(); session.mockRestore(); dispatch.mockRestore(); fetch.mockRestore();
  }
});
