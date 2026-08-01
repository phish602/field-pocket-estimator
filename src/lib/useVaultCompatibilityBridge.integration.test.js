import React from "react";
import { render, waitFor } from "@testing-library/react";
import { IDBFactory } from "fake-indexeddb";
import useVaultCompatibilityBridge from "./useVaultCompatibilityBridge";
import { VAULT_COMPATIBILITY_GUARD_KEY, readVaultCompatibilityGuard } from "./vaultCompatibilityGuard";
import { getVaultBridgeBuildPolicy } from "./vaultBridgeBuildPolicy";

jest.mock("./accountScopedLocalStorage", () => ({
  isActiveAccountScopedNativeStorage: jest.fn(() => false),
  setActiveWorkspaceVaultCompatibility: jest.fn(),
}));

const scoped = require("./accountScopedLocalStorage");
const WORKSPACE_TAG = "A".repeat(43);
let latest;
let factory;
let originalIndexedDb;

function Probe(props) {
  latest = useVaultCompatibilityBridge(props);
  return <div data-state={latest.state} />;
}

beforeEach(() => {
  latest = null;
  factory = new IDBFactory();
  originalIndexedDb = globalThis.indexedDB;
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: factory });
  window.localStorage.removeItem(VAULT_COMPATIBILITY_GUARD_KEY);
  jest.clearAllMocks();
});

afterEach(() => {
  window.localStorage.removeItem(VAULT_COMPATIBILITY_GUARD_KEY);
  if (originalIndexedDb === undefined) delete globalThis.indexedDB;
  else Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: originalIndexedDb });
});

test("real repositories treat an absent workspace vault database as legacy-safe without creating databases", async () => {
  expect(getVaultBridgeBuildPolicy()).toEqual({ bridgeRelease: true, vaultCreationEnabled: false, migrationEnabled: false });
  expect(readVaultCompatibilityGuard().state).toBe("absent");
  expect(await factory.databases()).toEqual([]);

  const rendered = render(<Probe enabled workspaceTag={WORKSPACE_TAG} />);

  expect(scoped.setActiveWorkspaceVaultCompatibility).toHaveBeenLastCalledWith(expect.objectContaining({
    workspaceTag: WORKSPACE_TAG,
    state: "checking",
  }));
  expect(scoped.setActiveWorkspaceVaultCompatibility.mock.calls.some(([value]) => value.state === "legacy-safe")).toBe(false);

  await waitFor(() => expect(latest.state).toBe("legacy-safe"));

  expect(await factory.databases()).toEqual([]);
  expect(scoped.setActiveWorkspaceVaultCompatibility).toHaveBeenLastCalledWith(expect.objectContaining({
    workspaceTag: WORKSPACE_TAG,
    state: "legacy-safe",
  }));

  rendered.unmount();

  expect(scoped.setActiveWorkspaceVaultCompatibility).toHaveBeenLastCalledWith(expect.objectContaining({
    workspaceTag: "",
    state: "checking",
  }));
});
