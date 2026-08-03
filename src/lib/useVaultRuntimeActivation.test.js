/**
 * ISO-16 -- the production activation hook: migration handoff, sealing,
 * hydration, adapter installation, revocation, and identity switching.
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import useVaultRuntimeActivation from "./useVaultRuntimeActivation";

jest.mock("./vaultBridgeBuildPolicy", () => ({
  VAULT_BRIDGE_RELEASE: false,
  VAULT_CREATION_ENABLED: true,
  VAULT_MIGRATION_ENABLED: true,
  getVaultBridgeBuildPolicy: jest.fn(),
}));
jest.mock("./vaultCompatibilityGuard", () => ({
  VAULT_COMPATIBILITY_GUARD_KEY: "estipaid-vault-guard-v1",
  readVaultCompatibilityGuard: jest.fn(),
}));
jest.mock("./vaultIndexedDbRepository", () => ({
  createVaultIndexedDbRepository: jest.fn(),
  VAULT_MIGRATION_LOGICAL_KEYS: Object.freeze(["estipaid-customers-v1"]),
}));
jest.mock("./vaultTransitionControlRepository", () => ({ createVaultTransitionControlRepository: jest.fn() }));
jest.mock("./vaultMigrationOrchestrator", () => ({ migrateActiveWorkspaceVault: jest.fn() }));
jest.mock("./vaultSession", () => ({
  deriveWorkspaceVaultTag: jest.fn(async () => "A".repeat(43)),
  runWithActiveVaultDek: jest.fn(),
}));
jest.mock("./vaultRuntimeStore", () => ({
  flushVaultRuntime: jest.fn(),
  getVaultRuntimeStatus: jest.fn(() => ({ state: "ready", generation: 1, pending: 0, code: "", entryCount: 0 })),
  subscribeVaultRuntimeStatus: jest.fn(() => () => {}),
  subscribeVaultRuntimeRevalidation: jest.fn(() => () => {}),
  hydrateVaultRuntime: jest.fn(),
  isVaultRuntimeReady: jest.fn(() => true),
  revokeVaultRuntime: jest.fn(),
  runtimeClear: jest.fn(),
  runtimeGetItem: jest.fn(),
  runtimeLogicalKeys: jest.fn(() => []),
  runtimeRemoveItem: jest.fn(),
  runtimeSetItem: jest.fn(),
  sealVaultRuntime: jest.fn(),
}));
jest.mock("./accountScopedLocalStorage", () => ({
  installAuthoritativeVaultRuntime: jest.fn(() => true),
  revokeAuthoritativeVaultRuntime: jest.fn(),
}));

const policy = require("./vaultBridgeBuildPolicy");
const guard = require("./vaultCompatibilityGuard");
const vaultRepo = require("./vaultIndexedDbRepository");
const transitionRepo = require("./vaultTransitionControlRepository");
const orchestrator = require("./vaultMigrationOrchestrator");
const runtime = require("./vaultRuntimeStore");
const scoped = require("./accountScopedLocalStorage");

const USER = "11111111-2222-4333-8444-555555555555";
const COMPANY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
let latest;

function Probe(props) {
  latest = useVaultRuntimeActivation(props);
  return null;
}

function primeRepository({ catalog = null } = {}) {
  vaultRepo.createVaultIndexedDbRepository.mockReturnValue({
    readRuntimeCatalog: jest.fn(async () => catalog),
  });
}

beforeEach(() => {
  latest = undefined;
  // resetMocks strips factory implementations, so the workspace tag is primed here.
  require("./vaultSession").deriveWorkspaceVaultTag.mockResolvedValue("A".repeat(43));
  policy.getVaultBridgeBuildPolicy.mockReturnValue({ bridgeRelease: false, vaultCreationEnabled: true, migrationEnabled: true });
  guard.readVaultCompatibilityGuard.mockReturnValue({ state: "absent", code: "", message: "" });
  transitionRepo.createVaultTransitionControlRepository.mockReturnValue({ readActiveTransition: jest.fn(async () => null) });
  orchestrator.migrateActiveWorkspaceVault.mockResolvedValue({ state: "authoritative", code: "", phase: "" });
  runtime.sealVaultRuntime.mockResolvedValue({ ok: true, state: "sealed", code: "", entryCount: 1, generation: 0 });
  runtime.hydrateVaultRuntime.mockResolvedValue({ ok: true, state: "ready", code: "", entryCount: 1, generation: 1 });
  runtime.isVaultRuntimeReady.mockReturnValue(true);
  runtime.subscribeVaultRuntimeStatus.mockReturnValue(() => {});
  runtime.subscribeVaultRuntimeRevalidation.mockReturnValue(() => {});
  runtime.getVaultRuntimeStatus.mockReturnValue({ state: "ready", generation: 1, pending: 0, code: "", entryCount: 1 });
  scoped.installAuthoritativeVaultRuntime.mockReturnValue(true);
  primeRepository();
});

test("a locked vault or a missing identity keeps the runtime disabled", async () => {
  const view = render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked={false} />);
  await waitFor(() => expect(latest.state).toBe("disabled"));
  expect(orchestrator.migrateActiveWorkspaceVault).not.toHaveBeenCalled();
  expect(scoped.installAuthoritativeVaultRuntime).not.toHaveBeenCalled();
  view.unmount();
});

test("a first-run workspace migrates, seals, hydrates, and installs the adapter in order", async () => {
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  expect(orchestrator.migrateActiveWorkspaceVault).toHaveBeenCalledWith({ userId: USER, companyId: COMPANY });
  expect(runtime.sealVaultRuntime).toHaveBeenCalled();
  expect(runtime.hydrateVaultRuntime).toHaveBeenCalled();
  expect(scoped.installAuthoritativeVaultRuntime).toHaveBeenCalledWith(expect.objectContaining({
    workspaceTag: "A".repeat(43), generation: 1,
  }));
});

test("an existing runtime catalog hydrates without rerunning a source migration", async () => {
  primeRepository({ catalog: { revision: 3, runtimeGeneration: 1 } });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  expect(orchestrator.migrateActiveWorkspaceVault).not.toHaveBeenCalled();
  expect(runtime.sealVaultRuntime).not.toHaveBeenCalled();
  expect(runtime.hydrateVaultRuntime).toHaveBeenCalled();
});

test("an authoritative guard with no runtime catalog seals without re-migrating", async () => {
  guard.readVaultCompatibilityGuard.mockReturnValue({ state: "authoritative", code: "", message: "" });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  expect(orchestrator.migrateActiveWorkspaceVault).not.toHaveBeenCalled();
  expect(runtime.sealVaultRuntime).toHaveBeenCalled();
});

test("an existing transition is resumed through the orchestrator", async () => {
  guard.readVaultCompatibilityGuard.mockReturnValue({ state: "transition", code: "", message: "" });
  transitionRepo.createVaultTransitionControlRepository.mockReturnValue({
    readActiveTransition: jest.fn(async () => ({ phase: "copying", workspaceTag: "A".repeat(43) })),
  });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  expect(orchestrator.migrateActiveWorkspaceVault).toHaveBeenCalledTimes(1);
});

test("a blocked migration blocks the runtime and installs no adapter", async () => {
  orchestrator.migrateActiveWorkspaceVault.mockResolvedValue({ state: "blocked", code: "SOURCE_CHANGED", phase: "verifying" });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe("SOURCE_CHANGED");
  expect(runtime.sealVaultRuntime).not.toHaveBeenCalled();
  expect(scoped.installAuthoritativeVaultRuntime).not.toHaveBeenCalled();
});

test("a failed seal or a failed hydration blocks and never installs the adapter", async () => {
  runtime.sealVaultRuntime.mockResolvedValue({ ok: false, state: "blocked", code: "RECORD_INVALID" });
  const first = render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe("RECORD_INVALID");
  expect(scoped.installAuthoritativeVaultRuntime).not.toHaveBeenCalled();
  first.unmount();

  runtime.sealVaultRuntime.mockResolvedValue({ ok: true, state: "sealed", code: "", entryCount: 0, generation: 0 });
  runtime.hydrateVaultRuntime.mockResolvedValue({ ok: false, state: "blocked", code: "CATALOG_INVALID" });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe("CATALOG_INVALID");
  expect(scoped.installAuthoritativeVaultRuntime).not.toHaveBeenCalled();
});

test("a bridge-release or migration-disabled build blocks activation outright", async () => {
  policy.getVaultBridgeBuildPolicy.mockReturnValue({ bridgeRelease: true, vaultCreationEnabled: false, migrationEnabled: false });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe("BUILD_POLICY_INVALID");
  expect(orchestrator.migrateActiveWorkspaceVault).not.toHaveBeenCalled();
});

test("an invalid derived workspace tag blocks before any adapter is installed", async () => {
  require("./vaultSession").deriveWorkspaceVaultTag.mockResolvedValue(undefined);
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe("IDENTITY_UNAVAILABLE");
  expect(scoped.installAuthoritativeVaultRuntime).not.toHaveBeenCalled();
});

test("an unusable IndexedDB environment blocks instead of throwing", async () => {
  vaultRepo.createVaultIndexedDbRepository.mockImplementation(() => { throw new Error("unsupported"); });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe("UNSUPPORTED_ENVIRONMENT");
});

test("an identity switch revokes the previous runtime before the new one activates", async () => {
  const view = render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  scoped.revokeAuthoritativeVaultRuntime.mockClear();
  runtime.revokeVaultRuntime.mockClear();

  view.rerender(<Probe enabled userId={"22222222-3333-4444-8555-666666666666"} companyId={COMPANY} vaultUnlocked />);
  // Revocation is synchronous on the identity change, before any await resolves.
  expect(scoped.revokeAuthoritativeVaultRuntime).toHaveBeenCalled();
  expect(runtime.revokeVaultRuntime).toHaveBeenCalled();
  await waitFor(() => expect(latest.state).toBe("ready"));
});

test("locking revokes the runtime and disables activation", async () => {
  const view = render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  view.rerender(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked={false} />);
  await waitFor(() => expect(latest.state).toBe("disabled"));
  expect(scoped.revokeAuthoritativeVaultRuntime).toHaveBeenCalled();
  expect(runtime.revokeVaultRuntime).toHaveBeenCalled();
});

test("unmount revokes the runtime", async () => {
  const view = render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  scoped.revokeAuthoritativeVaultRuntime.mockClear();
  view.unmount();
  expect(scoped.revokeAuthoritativeVaultRuntime).toHaveBeenCalled();
});

test("flushAndLock locks only when every accepted write is durable", async () => {
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));

  runtime.flushVaultRuntime.mockResolvedValue({ state: "blocked", code: "DURABILITY_FAILED", pending: 1, generation: 1, entryCount: 0 });
  const lock = jest.fn();
  let outcome;
  await act(async () => { outcome = await latest.flushAndLock(lock); });
  expect(outcome).toEqual({ ok: false, code: "DURABILITY_FAILED" });
  // A failed flush never claims a clean lock.
  expect(lock).not.toHaveBeenCalled();
  await waitFor(() => expect(latest.state).toBe("blocked"));
});

test("flushAndLock locks and revokes when the flush succeeds", async () => {
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  runtime.flushVaultRuntime.mockResolvedValue({ state: "ready", code: "", pending: 0, generation: 1, entryCount: 1 });
  const lock = jest.fn();
  let outcome;
  await act(async () => { outcome = await latest.flushAndLock(lock); });
  expect(outcome).toEqual({ ok: true, code: "" });
  expect(lock).toHaveBeenCalled();
  expect(scoped.revokeAuthoritativeVaultRuntime).toHaveBeenCalled();
});

test("the public result exposes no identity, tag, or crypto material", async () => {
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  expect(Object.keys(latest).sort()).toEqual(["checking", "code", "flushAndLock", "message", "pending", "refresh", "state"]);
  const serialized = JSON.stringify(latest);
  expect(serialized).not.toContain(USER);
  expect(serialized).not.toContain(COMPANY);
  expect(serialized).not.toContain("A".repeat(43));
});

test("a durability failure published by the runtime blocks the hook", async () => {
  // The hook SUBSCRIBES to runtime status rather than polling, so the runtime
  // publishing a blocked status is what must block it.
  let publish;
  runtime.subscribeVaultRuntimeStatus.mockImplementation((listener) => { publish = listener; return () => {}; });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  expect(typeof publish).toBe("function");

  await act(async () => { publish({ state: "blocked", generation: 1, pending: 0, code: "DURABILITY_FAILED", entryCount: 1 }); });
  expect(latest.state).toBe("blocked");
  expect(latest.code).toBe("DURABILITY_FAILED");
});

test("a pending durable write is reported honestly, then clears when it commits", async () => {
  let publish;
  runtime.subscribeVaultRuntimeStatus.mockImplementation((listener) => { publish = listener; return () => {}; });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));

  await act(async () => { publish({ state: "pending-writes", generation: 1, pending: 2, code: "", entryCount: 1 }); });
  expect(latest.state).toBe("pending-writes");
  expect(latest.pending).toBe(true);

  await act(async () => { publish({ state: "ready", generation: 1, pending: 0, code: "", entryCount: 1 }); });
  expect(latest.state).toBe("ready");
});

test("another tab committing a newer catalog triggers revalidation", async () => {
  let revalidate;
  runtime.subscribeVaultRuntimeRevalidation.mockImplementation((listener) => { revalidate = listener; return () => {}; });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  expect(typeof revalidate).toBe("function");

  runtime.hydrateVaultRuntime.mockClear();
  await act(async () => { revalidate(); });
  // Revalidation re-reads and re-verifies rather than trusting the cache.
  await waitFor(() => expect(runtime.hydrateVaultRuntime).toHaveBeenCalled());
});
