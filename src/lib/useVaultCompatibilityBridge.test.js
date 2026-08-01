import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import useVaultCompatibilityBridge from "./useVaultCompatibilityBridge";

jest.mock("./vaultCompatibilityGuard", () => ({
  VAULT_COMPATIBILITY_GUARD_KEY: "estipaid-vault-guard-v1",
  readVaultCompatibilityGuard: jest.fn(),
}));
jest.mock("./vaultTransitionControlRepository", () => ({ createVaultTransitionControlRepository: jest.fn() }));
jest.mock("./vaultIndexedDbRepository", () => ({
  createVaultIndexedDbRepository: jest.fn(),
  VAULT_REPOSITORY_ERROR_CODES: Object.freeze({
    DATABASE_NOT_FOUND: "DATABASE_NOT_FOUND",
    STORAGE_OPERATION_FAILED: "STORAGE_OPERATION_FAILED",
  }),
}));
jest.mock("./accountScopedLocalStorage", () => ({
  isActiveAccountScopedNativeStorage: jest.fn(() => false),
  setActiveWorkspaceVaultCompatibility: jest.fn(),
}));

const guard = require("./vaultCompatibilityGuard");
const transition = require("./vaultTransitionControlRepository");
const vault = require("./vaultIndexedDbRepository");
const scoped = require("./accountScopedLocalStorage");
const TAG_A = "A".repeat(43);
const TAG_B = "B".repeat(43);
let latest;

function Probe(props) {
  latest = useVaultCompatibilityBridge(props);
  return <div data-state={latest.state} />;
}

function wire({ guardResult = { state: "absent", code: "", message: "" }, activeTransition = null, manifest = null, manifestError = null } = {}) {
  guard.readVaultCompatibilityGuard.mockReturnValue(guardResult);
  transition.createVaultTransitionControlRepository.mockReturnValue({ readActiveTransition: jest.fn().mockResolvedValue(activeTransition) });
  vault.createVaultIndexedDbRepository.mockReturnValue({
    readMigrationManifest: manifestError
      ? jest.fn().mockRejectedValue(manifestError)
      : jest.fn().mockResolvedValue(manifest),
  });
}

beforeEach(() => { latest = null; jest.clearAllMocks(); wire(); });

test("exposes only the narrow non-secret hook result", async () => {
  render(<Probe enabled workspaceTag={TAG_A} />);
  await waitFor(() => expect(latest.state).toBe("legacy-safe"));
  expect(Object.keys(latest).sort()).toEqual(["checking", "code", "message", "refresh", "state"]);
  expect(JSON.stringify(latest)).not.toMatch(/transition|workspace|manifest|identity|password|dek/i);
});

test("disabled hook performs no reads and revokes synchronous authorization", () => {
  render(<Probe enabled={false} workspaceTag={TAG_A} />);
  expect(guard.readVaultCompatibilityGuard).not.toHaveBeenCalled();
  expect(transition.createVaultTransitionControlRepository).not.toHaveBeenCalled();
  expect(scoped.setActiveWorkspaceVaultCompatibility).toHaveBeenCalledWith(expect.objectContaining({ state: "checking" }));
});

test("absent guard with no transition and manifest is positively legacy-safe", async () => {
  render(<Probe enabled workspaceTag={TAG_A} />);
  await waitFor(() => expect(latest.state).toBe("legacy-safe"));
  expect(scoped.setActiveWorkspaceVaultCompatibility).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceTag: TAG_A, state: "legacy-safe" }));
});

test("absent vault database is treated as an absent migration manifest", async () => {
  const databaseNotFound = Object.assign(new Error("missing database"), {
    code: vault.VAULT_REPOSITORY_ERROR_CODES.DATABASE_NOT_FOUND,
  });
  wire({ activeTransition: null, manifestError: databaseNotFound });
  render(<Probe enabled workspaceTag={TAG_A} />);
  await waitFor(() => expect(latest.state).toBe("legacy-safe"));
  expect(scoped.setActiveWorkspaceVaultCompatibility).toHaveBeenLastCalledWith(expect.objectContaining({ workspaceTag: TAG_A, state: "legacy-safe" }));
});

test("non-absence manifest failures remain storage-blocked", async () => {
  const storageFailure = Object.assign(new Error("storage failure"), {
    code: vault.VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED,
  });
  wire({ activeTransition: null, manifestError: storageFailure });
  render(<Probe enabled workspaceTag={TAG_A} />);
  await waitFor(() => expect(latest.state).toBe("storage-blocked"));
});

test.each([
  ["transition guard", { state: "transition" }, { workspaceTag: TAG_A, phase: "guarded" }, null, "transition-blocked"],
  ["authoritative guard", { state: "authoritative" }, null, null, "authoritative-blocked"],
  ["malformed guard", { state: "blocked", code: "INVALID_GUARD" }, null, null, "corrupt-blocked"],
  ["unreadable guard", { state: "blocked", code: "STORAGE_UNAVAILABLE" }, null, null, "storage-blocked"],
  ["transition without record", { state: "transition" }, null, null, "corrupt-blocked"],
  ["absent guard active prepared record", { state: "absent" }, { workspaceTag: TAG_A, phase: "prepared" }, null, "transition-blocked"],
  ["other workspace transition", { state: "absent" }, { workspaceTag: TAG_B, phase: "prepared" }, null, "other-workspace-transition"],
  ["manifest with absent guard", { state: "absent" }, null, { revision: 1 }, "corrupt-blocked"],
])("%s fails closed", async (_name, guardResult, activeTransition, manifest, state) => {
  wire({ guardResult, activeTransition, manifest });
  render(<Probe enabled workspaceTag={TAG_A} />);
  await waitFor(() => expect(latest.state).toBe(state));
});

test("repository failures and unavailable indexedDB fail closed", async () => {
  transition.createVaultTransitionControlRepository.mockImplementation(() => { throw new Error("unavailable"); });
  render(<Probe enabled workspaceTag={TAG_A} />);
  await waitFor(() => expect(latest.state).toBe("storage-blocked"));
});

test("workspace changes immediately revoke safe state and ignore stale results", async () => {
  let resolve;
  transition.createVaultTransitionControlRepository.mockReturnValue({ readActiveTransition: jest.fn(() => new Promise((next) => { resolve = next; })) });
  vault.createVaultIndexedDbRepository.mockReturnValue({ readMigrationManifest: jest.fn().mockResolvedValue(null) });
  const rendered = render(<Probe enabled workspaceTag={TAG_A} />);
  await waitFor(() => expect(latest.state).toBe("checking"));
  wire();
  rendered.rerender(<Probe enabled workspaceTag={TAG_B} />);
  expect(scoped.setActiveWorkspaceVaultCompatibility).toHaveBeenLastCalledWith(expect.objectContaining({ state: "checking" }));
  await waitFor(() => expect(latest.state).toBe("legacy-safe"));
  await act(async () => { resolve?.({ workspaceTag: TAG_A, phase: "prepared" }); });
  expect(latest.state).toBe("legacy-safe");
});

test("native guard storage event revokes safe state and re-reads storage instead of trusting newValue", async () => {
  const rendered = render(<Probe enabled workspaceTag={TAG_A} />);
  await waitFor(() => expect(latest.state).toBe("legacy-safe"));
  guard.readVaultCompatibilityGuard.mockReturnValue({ state: "authoritative", code: "", message: "" });
  const event = new StorageEvent("storage", { key: "estipaid-vault-guard-v1", newValue: "not trusted", storageArea: window.localStorage });
  act(() => window.dispatchEvent(event));
  expect(scoped.setActiveWorkspaceVaultCompatibility).toHaveBeenCalledWith(expect.objectContaining({ state: "checking" }));
  await waitFor(() => expect(latest.state).toBe("authoritative-blocked"));
  expect(guard.readVaultCompatibilityGuard).toHaveBeenCalled();
  rendered.unmount();
});

test("unrelated events are ignored and unmount revokes authorization", async () => {
  const rendered = render(<Probe enabled workspaceTag={TAG_A} />);
  await waitFor(() => expect(latest.state).toBe("legacy-safe"));
  const calls = guard.readVaultCompatibilityGuard.mock.calls.length;
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", storageArea: window.localStorage })));
  expect(guard.readVaultCompatibilityGuard).toHaveBeenCalledTimes(calls);
  rendered.unmount();
  expect(scoped.setActiveWorkspaceVaultCompatibility).toHaveBeenLastCalledWith(expect.objectContaining({ state: "checking" }));
});
