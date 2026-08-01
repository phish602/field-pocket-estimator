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

test("exposes only the narrow non-secret hook surface", async () => {
  renderProbe();
  await waitFor(() => expect(latest.checking).toBe(false));
  expect(Object.keys(latest).sort()).toEqual(["capability", "checking", "error", "lock", "pending", "refresh", "setup", "unlock"]);
  expect(latest.capability).toEqual(locked);
  expect(JSON.stringify(latest)).not.toMatch(/password|dek|kek|cryptokey|metadata/i);
});

test("disabled state performs no capability read and synchronously locks", () => {
  renderProbe({ enabled: false });
  expect(vaultSession.readVaultCapability).not.toHaveBeenCalled();
  expect(vaultSession.lockVault).toHaveBeenCalled();
  expect(latest.capability.state).toBe("locked");
});

test.each(["setup_required", "locked", "unlocked", "damaged", "unsupported", "reset_required"])("publishes the public %s capability", async (state) => {
  vaultSession.readVaultCapability.mockResolvedValue({ state, code: "", message: "" });
  renderProbe();
  await waitFor(() => expect(latest.capability.state).toBe(state));
  expect(vaultSession.readVaultCapability).toHaveBeenCalledWith({ userId: "user-a", companyId: "company-a" });
});

test("starts inspection in a blocked pending state", () => {
  const read = deferred();
  vaultSession.readVaultCapability.mockReturnValue(read.promise);
  renderProbe();
  expect(latest.capability.state).toBe("locked");
  expect(latest.checking).toBe(true);
});

test("setup and unlock delegate directly without returning password material", async () => {
  renderProbe();
  await waitFor(() => expect(latest.checking).toBe(false));
  await act(async () => { await latest.setup("setup-local-password"); });
  expect(vaultSession.setupVault).toHaveBeenCalledWith({ userId: "user-a", companyId: "company-a", password: "setup-local-password" });
  expect(latest.capability).toEqual(unlocked);

  await act(async () => { await latest.unlock("unlock-local-password"); });
  expect(vaultSession.unlockVault).toHaveBeenCalledWith({ userId: "user-a", companyId: "company-a", password: "unlock-local-password" });
  expect(Object.values(latest).filter((value) => typeof value === "string")).not.toContain("unlock-local-password");
});

test("manual lock synchronously delegates, publishes locked, and is idempotent", async () => {
  vaultSession.readVaultCapability.mockResolvedValue(unlocked);
  renderProbe();
  await waitFor(() => expect(latest.capability.state).toBe("unlocked"));
  act(() => { latest.lock(); latest.lock(); });
  expect(vaultSession.lockVault).toHaveBeenCalledTimes(3); // identity activation plus two manual locks
  expect(latest.capability).toEqual(locked);
  expect(latest.pending).toBe(false);
  expect(latest.error).toBe("");
});

test("manual lock invalidates an older capability read", async () => {
  const read = deferred();
  vaultSession.readVaultCapability.mockReturnValue(read.promise);
  renderProbe();
  act(() => { latest.lock(); });
  expect(latest.capability).toEqual(locked);
  await act(async () => { read.resolve(unlocked); await read.promise; });
  expect(latest.capability).toEqual(locked);
});

test("manual lock invalidates pending setup and unlock without republishing stale success", async () => {
  const setup = deferred();
  const unlock = deferred();
  vaultSession.setupVault.mockReturnValueOnce(setup.promise);
  vaultSession.unlockVault.mockReturnValueOnce(unlock.promise);
  renderProbe();
  await waitFor(() => expect(latest.checking).toBe(false));

  let setupResult;
  act(() => { setupResult = latest.setup("setup-password"); });
  act(() => { latest.lock(); });
  expect(latest.capability).toEqual(locked);
  await act(async () => { setup.resolve(unlocked); await setupResult; });
  expect(latest.capability).toEqual(locked);

  await waitFor(() => expect(latest.checking).toBe(false));
  let unlockResult;
  act(() => { unlockResult = latest.unlock("unlock-password"); });
  act(() => { latest.lock(); });
  await act(async () => { unlock.resolve(unlocked); await unlockResult; });
  expect(latest.capability).toEqual(locked);
  expect(JSON.stringify(latest)).not.toMatch(/setup-password|unlock-password|password|dek|kek/i);
});

test("authentication failure stays generic while structural, environment, and storage failures remain public states", async () => {
  vaultSession.unlockVault.mockResolvedValue({ state: "locked", code: "AUTHENTICATION_FAILED", message: "The Local Data Password is incorrect or the local vault is damaged." });
  renderProbe();
  await waitFor(() => expect(latest.checking).toBe(false));
  await act(async () => { await latest.unlock("local-password"); });
  expect(latest.capability).toEqual(expect.objectContaining({ state: "locked", code: "AUTHENTICATION_FAILED" }));

  vaultSession.readVaultCapability.mockResolvedValueOnce({ state: "damaged", code: "RECORD_CORRUPT", message: "The local vault is damaged." });
  await act(async () => { await latest.refresh(); });
  await waitFor(() => expect(latest.capability.state).toBe("damaged"));
  expect(latest.capability.code).toBe("RECORD_CORRUPT");
});

test("an identity change immediately removes an unlocked capability and locks the prior session", async () => {
  vaultSession.readVaultCapability.mockResolvedValue(unlocked);
  const view = renderProbe();
  await waitFor(() => expect(latest.capability.state).toBe("unlocked"));
  vaultSession.readVaultCapability.mockResolvedValue(locked);
  view.rerender(<Probe userId="user-b" companyId="company-b" enabled />);
  expect(latest.capability.state).toBe("locked");
  expect(latest.checking).toBe(true);
  expect(vaultSession.lockVault).toHaveBeenCalled();
  await waitFor(() => expect(vaultSession.readVaultCapability).toHaveBeenLastCalledWith({ userId: "user-b", companyId: "company-b" }));
});

test("disable and unmount synchronously lock the active session", async () => {
  vaultSession.readVaultCapability.mockResolvedValue(unlocked);
  const view = renderProbe();
  await waitFor(() => expect(latest.capability.state).toBe("unlocked"));
  view.rerender(<Probe userId="user-a" companyId="company-a" enabled={false} />);
  expect(latest.capability.state).toBe("locked");
  expect(vaultSession.lockVault).toHaveBeenCalled();
  view.unmount();
  expect(vaultSession.lockVault).toHaveBeenCalled();
});

test("a stale capability read cannot update the new identity", async () => {
  const readA = deferred();
  const readB = deferred();
  vaultSession.readVaultCapability.mockReturnValueOnce(readA.promise).mockReturnValueOnce(readB.promise);
  const view = renderProbe();
  view.rerender(<Probe userId="user-b" companyId="company-b" enabled />);
  await act(async () => { readA.resolve(unlocked); await readA.promise; });
  expect(latest.capability.state).toBe("locked");
  await act(async () => { readB.resolve(locked); await readB.promise; });
  await waitFor(() => expect(latest.capability.state).toBe("locked"));
});

test("a stale setup or unlock cannot unlock a new identity and locks the stale session", async () => {
  const setup = deferred();
  const unlock = deferred();
  vaultSession.setupVault.mockReturnValue(setup.promise);
  vaultSession.unlockVault.mockReturnValue(unlock.promise);
  const view = renderProbe();
  await waitFor(() => expect(latest.checking).toBe(false));
  let setupResult;
  act(() => { setupResult = latest.setup("local-password"); });
  view.rerender(<Probe userId="user-b" companyId="company-b" enabled />);
  await act(async () => { setup.resolve(unlocked); await setupResult; });
  expect(latest.capability.state).toBe("locked");
  expect(vaultSession.lockVault).toHaveBeenCalled();

  await waitFor(() => expect(latest.checking).toBe(false));
  let unlockResult;
  act(() => { unlockResult = latest.unlock("local-password"); });
  view.rerender(<Probe userId="user-c" companyId="company-c" enabled />);
  await act(async () => { unlock.resolve(unlocked); await unlockResult; });
  expect(latest.capability.state).toBe("locked");
  expect(vaultSession.lockVault).toHaveBeenCalled();
});

test("same-identity rerenders do not repeat reads or locks", async () => {
  const view = renderProbe();
  await waitFor(() => expect(latest.checking).toBe(false));
  const reads = vaultSession.readVaultCapability.mock.calls.length;
  const locks = vaultSession.lockVault.mock.calls.length;
  view.rerender(<Probe userId="user-a" companyId="company-a" enabled />);
  expect(vaultSession.readVaultCapability).toHaveBeenCalledTimes(reads);
  expect(vaultSession.lockVault).toHaveBeenCalledTimes(locks);
});

test("does not access web storage, events, messaging, network, or transition control", async () => {
  const local = jest.spyOn(Storage.prototype, "getItem");
  const session = jest.spyOn(Storage.prototype, "setItem");
  const dispatch = jest.spyOn(window, "dispatchEvent");
  const fetch = jest.spyOn(global, "fetch");
  try {
    renderProbe();
    await waitFor(() => expect(latest.checking).toBe(false));
    act(() => { latest.lock(); });
    expect(local).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    local.mockRestore(); session.mockRestore(); dispatch.mockRestore(); fetch.mockRestore();
  }
});
