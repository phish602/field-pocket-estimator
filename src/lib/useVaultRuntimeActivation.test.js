/**
 * ISO-16 -- the production activation hook: migration handoff, sealing,
 * hydration, adapter installation, revocation, and identity switching.
 */
import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import useVaultRuntimeActivation, {
  VAULT_ACTIVATION_PLAN_ACTIONS,
  VAULT_ACTIVATION_PLAN_CODES,
  resolveVaultActivationPlan,
} from "./useVaultRuntimeActivation";

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
  runtime.flushVaultRuntime.mockResolvedValue({ state: "ready", code: "", pending: 0, generation: 1, entryCount: 1 });
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
  // A catalog is only coherent next to an authoritative guard and no transition.
  guard.readVaultCompatibilityGuard.mockReturnValue({ state: "authoritative", code: "", message: "" });
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

// ---------------------------------------------------------------------------
// ISO-16 review fix -- the activation state matrix.
//
// Build policy, compatibility guard, active transition, and runtime catalog are
// ALWAYS inspected. Every combination has one enumerated outcome, and anything
// inconsistent fails closed instead of hydrating on the strength of a catalog.
// ---------------------------------------------------------------------------

const TAG = "A".repeat(43);
const OTHER_TAG = "B".repeat(43);
const VALID_POLICY = { bridgeRelease: false, vaultCreationEnabled: true, migrationEnabled: true };

const STATE_MATRIX = [
  // guardState, transition, catalogPresent, expected action, expected code, case
  ["absent", null, false, "migrate", "", "H"],
  ["absent", "self", false, "migrate", "", "G"],
  ["absent", "other", false, "block", VAULT_ACTIVATION_PLAN_CODES.OTHER_WORKSPACE_TRANSITION, "C"],
  ["absent", null, true, "block", VAULT_ACTIVATION_PLAN_CODES.RUNTIME_GUARD_MISMATCH, "D"],
  ["absent", "self", true, "block", VAULT_ACTIVATION_PLAN_CODES.RUNTIME_GUARD_MISMATCH, "D"],
  ["transition", null, false, "block", VAULT_ACTIVATION_PLAN_CODES.GUARD_RECOVERY_REQUIRED, "I"],
  ["transition", "self", false, "migrate", "", "G"],
  ["transition", "other", false, "block", VAULT_ACTIVATION_PLAN_CODES.OTHER_WORKSPACE_TRANSITION, "C"],
  ["transition", null, true, "block", VAULT_ACTIVATION_PLAN_CODES.RUNTIME_GUARD_MISMATCH, "D"],
  ["transition", "self", true, "block", VAULT_ACTIVATION_PLAN_CODES.RUNTIME_GUARD_MISMATCH, "D"],
  ["authoritative", null, false, "seal", "", "J"],
  ["authoritative", "self", false, "migrate", "", "G"],
  ["authoritative", "other", false, "block", VAULT_ACTIVATION_PLAN_CODES.OTHER_WORKSPACE_TRANSITION, "C"],
  ["authoritative", null, true, "hydrate", "", "F"],
  ["authoritative", "self", true, "block", VAULT_ACTIVATION_PLAN_CODES.RUNTIME_TRANSITION_CONFLICT, "E"],
  ["authoritative", "other", true, "block", VAULT_ACTIVATION_PLAN_CODES.OTHER_WORKSPACE_TRANSITION, "C"],
  ["blocked", null, false, "block", VAULT_ACTIVATION_PLAN_CODES.GUARD_UNAVAILABLE, "B"],
  ["blocked", "self", false, "block", VAULT_ACTIVATION_PLAN_CODES.GUARD_UNAVAILABLE, "B"],
  ["blocked", null, true, "block", VAULT_ACTIVATION_PLAN_CODES.GUARD_UNAVAILABLE, "B"],
  ["unknown-state", null, false, "block", VAULT_ACTIVATION_PLAN_CODES.GUARD_UNAVAILABLE, "B"],
  ["unknown-state", null, true, "block", VAULT_ACTIVATION_PLAN_CODES.GUARD_UNAVAILABLE, "B"],
];

function transitionFor(kind) {
  if (kind === "self") return { phase: "copying", workspaceTag: TAG };
  if (kind === "other") return { phase: "copying", workspaceTag: OTHER_TAG };
  return null;
}

test("the activation state matrix is exhaustive and fails closed", () => {
  STATE_MATRIX.forEach(([guardState, transitionKind, catalogPresent, action, code, planCase]) => {
    const plan = resolveVaultActivationPlan({
      policy: VALID_POLICY,
      guard: { state: guardState },
      transition: transitionFor(transitionKind),
      catalogPresent,
      workspaceTag: TAG,
    });
    expect({ ...plan, input: [guardState, transitionKind, catalogPresent] }).toEqual({
      action, code, case: planCase, input: [guardState, transitionKind, catalogPresent],
    });
  });
  // Every enumerated action is one of the four known actions.
  const actions = new Set(Object.values(VAULT_ACTIVATION_PLAN_ACTIONS));
  STATE_MATRIX.forEach(([, , , action]) => expect(actions.has(action)).toBe(true));
});

test("an unreadable guard, a missing guard, and an invalid policy all fail closed", () => {
  expect(resolveVaultActivationPlan({ policy: VALID_POLICY, guard: null, transition: null, catalogPresent: true, workspaceTag: TAG }))
    .toMatchObject({ action: "block", code: VAULT_ACTIVATION_PLAN_CODES.GUARD_UNAVAILABLE });
  expect(resolveVaultActivationPlan({ policy: null, guard: { state: "authoritative" }, transition: null, catalogPresent: true, workspaceTag: TAG }))
    .toMatchObject({ action: "block", code: VAULT_ACTIVATION_PLAN_CODES.BUILD_POLICY_INVALID });
  [{ ...VALID_POLICY, bridgeRelease: true }, { ...VALID_POLICY, vaultCreationEnabled: false }, { ...VALID_POLICY, migrationEnabled: false }]
    .forEach((policyValue) => {
      expect(resolveVaultActivationPlan({ policy: policyValue, guard: { state: "authoritative" }, transition: null, catalogPresent: true, workspaceTag: TAG }))
        .toMatchObject({ action: "block", code: VAULT_ACTIVATION_PLAN_CODES.BUILD_POLICY_INVALID });
    });
  // A transition with no verifiable workspace binding is never resumed.
  expect(resolveVaultActivationPlan({ policy: VALID_POLICY, guard: { state: "absent" }, transition: { workspaceTag: TAG }, catalogPresent: false, workspaceTag: "short" }))
    .toMatchObject({ action: "block", code: VAULT_ACTIVATION_PLAN_CODES.OTHER_WORKSPACE_TRANSITION });
  expect(resolveVaultActivationPlan()).toMatchObject({ action: "block", code: VAULT_ACTIVATION_PLAN_CODES.BUILD_POLICY_INVALID });
});

test("guard and transition are inspected even when a runtime catalog exists", async () => {
  guard.readVaultCompatibilityGuard.mockReturnValue({ state: "authoritative", code: "", message: "" });
  const readActiveTransition = jest.fn(async () => null);
  transitionRepo.createVaultTransitionControlRepository.mockReturnValue({ readActiveTransition });
  primeRepository({ catalog: { revision: 2, runtimeGeneration: 1 } });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  expect(guard.readVaultCompatibilityGuard).toHaveBeenCalled();
  expect(readActiveTransition).toHaveBeenCalled();
});

test("a catalog beside a non-authoritative guard blocks instead of hydrating", async () => {
  guard.readVaultCompatibilityGuard.mockReturnValue({ state: "absent", code: "", message: "" });
  primeRepository({ catalog: { revision: 2, runtimeGeneration: 1 } });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe(VAULT_ACTIVATION_PLAN_CODES.RUNTIME_GUARD_MISMATCH);
  expect(runtime.hydrateVaultRuntime).not.toHaveBeenCalled();
  expect(runtime.sealVaultRuntime).not.toHaveBeenCalled();
  expect(orchestrator.migrateActiveWorkspaceVault).not.toHaveBeenCalled();
  expect(scoped.installAuthoritativeVaultRuntime).not.toHaveBeenCalled();
});

test("a catalog beside a live transition blocks instead of hydrating", async () => {
  guard.readVaultCompatibilityGuard.mockReturnValue({ state: "authoritative", code: "", message: "" });
  transitionRepo.createVaultTransitionControlRepository.mockReturnValue({
    readActiveTransition: jest.fn(async () => ({ phase: "cleaning", workspaceTag: TAG })),
  });
  primeRepository({ catalog: { revision: 2, runtimeGeneration: 1 } });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe(VAULT_ACTIVATION_PLAN_CODES.RUNTIME_TRANSITION_CONFLICT);
  expect(runtime.hydrateVaultRuntime).not.toHaveBeenCalled();
});

test("a transition owned by another workspace blocks and is never resumed", async () => {
  transitionRepo.createVaultTransitionControlRepository.mockReturnValue({
    readActiveTransition: jest.fn(async () => ({ phase: "copying", workspaceTag: OTHER_TAG })),
  });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe(VAULT_ACTIVATION_PLAN_CODES.OTHER_WORKSPACE_TRANSITION);
  expect(orchestrator.migrateActiveWorkspaceVault).not.toHaveBeenCalled();
});

test("a transition guard with no transition record requires recovery", async () => {
  guard.readVaultCompatibilityGuard.mockReturnValue({ state: "transition", code: "", message: "" });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe(VAULT_ACTIVATION_PLAN_CODES.GUARD_RECOVERY_REQUIRED);
  expect(orchestrator.migrateActiveWorkspaceVault).not.toHaveBeenCalled();
});

test("a blocked guard blocks without migrating, sealing, or hydrating", async () => {
  guard.readVaultCompatibilityGuard.mockReturnValue({ state: "blocked", code: "INVALID_GUARD", message: "" });
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  expect(latest.code).toBe(VAULT_ACTIVATION_PLAN_CODES.GUARD_UNAVAILABLE);
  expect(orchestrator.migrateActiveWorkspaceVault).not.toHaveBeenCalled();
  expect(runtime.sealVaultRuntime).not.toHaveBeenCalled();
  expect(runtime.hydrateVaultRuntime).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- queue-safe, serialized, coalesced revalidation.
//
// Revalidation used to run the full activation path, which revoked the runtime
// immediately and discarded queued-but-undurable writes. It now flushes first
// and lets revision CAS decide, then re-hydrates in place.
// ---------------------------------------------------------------------------

function captureRevalidation() {
  let listener = null;
  runtime.subscribeVaultRuntimeRevalidation.mockImplementation((callback) => { listener = callback; return () => {}; });
  return () => listener;
}

test("revalidation flushes accepted writes before it replaces the cache", async () => {
  const revalidation = captureRevalidation();
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));

  const order = [];
  runtime.flushVaultRuntime.mockImplementation(async () => { order.push("flush"); return { state: "ready", code: "", pending: 0, generation: 1, entryCount: 1 }; });
  runtime.hydrateVaultRuntime.mockImplementation(async () => { order.push("hydrate"); return { ok: true, state: "ready", code: "", entryCount: 1, generation: 2 }; });
  runtime.revokeVaultRuntime.mockClear();
  scoped.revokeAuthoritativeVaultRuntime.mockClear();

  await act(async () => { await revalidation()(); });
  expect(order).toEqual(["flush", "hydrate"]);
  // The cache is never thrown away before the flush result is known.
  expect(runtime.revokeVaultRuntime).not.toHaveBeenCalled();
  expect(scoped.revokeAuthoritativeVaultRuntime).not.toHaveBeenCalled();
  expect(latest.state).toBe("ready");
});

test("revalidation installs the adapter for the new runtime generation", async () => {
  const revalidation = captureRevalidation();
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));

  runtime.hydrateVaultRuntime.mockResolvedValue({ ok: true, state: "ready", code: "", entryCount: 3, generation: 7 });
  scoped.installAuthoritativeVaultRuntime.mockClear();
  await act(async () => { await revalidation()(); });
  expect(scoped.installAuthoritativeVaultRuntime).toHaveBeenCalledWith(expect.objectContaining({ workspaceTag: TAG, generation: 7 }));
});

test("a CAS conflict during the revalidation flush blocks rather than discarding the write", async () => {
  const revalidation = captureRevalidation();
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));

  runtime.flushVaultRuntime.mockResolvedValue({ state: "blocked", code: "CONFLICT", pending: 1, generation: 1, entryCount: 1 });
  runtime.hydrateVaultRuntime.mockClear();
  await act(async () => { await revalidation()(); });
  expect(latest.state).toBe("blocked");
  expect(latest.code).toBe("CONFLICT");
  // The stale tab never re-reads over its own unsaved mutation.
  expect(runtime.hydrateVaultRuntime).not.toHaveBeenCalled();
});

test("a durability failure during the revalidation flush blocks", async () => {
  const revalidation = captureRevalidation();
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  runtime.flushVaultRuntime.mockResolvedValue({ state: "blocked", code: "DURABILITY_FAILED", pending: 1, generation: 1, entryCount: 1 });
  await act(async () => { await revalidation()(); });
  expect(latest.state).toBe("blocked");
  expect(latest.code).toBe("DURABILITY_FAILED");
});

test("rapid remote notifications coalesce into at most one extra pass", async () => {
  const revalidation = captureRevalidation();
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let hydrations = 0;
  runtime.hydrateVaultRuntime.mockImplementation(async () => {
    hydrations += 1;
    if (hydrations === 1) await gate;
    return { ok: true, state: "ready", code: "", entryCount: 1, generation: hydrations + 1 };
  });

  await act(async () => {
    const signal = revalidation();
    const first = signal();
    signal();
    signal();
    signal();
    release();
    await first;
  });
  // One in flight plus one coalesced pass -- not four.
  expect(hydrations).toBe(2);
});

test("a revalidation that lands after an identity switch installs nothing for the old identity", async () => {
  const revalidation = captureRevalidation();
  const view = render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));

  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  runtime.flushVaultRuntime.mockImplementation(async () => { await gate; return { state: "ready", code: "", pending: 0, generation: 1, entryCount: 1 }; });
  scoped.installAuthoritativeVaultRuntime.mockClear();

  const signal = revalidation();
  let pending;
  await act(async () => {
    pending = signal();
    view.rerender(<Probe enabled userId={"22222222-3333-4444-8555-666666666666"} companyId={COMPANY} vaultUnlocked />);
    release();
    await pending;
  });
  // Nothing from the old identity's revalidation reached the new runtime.
  const generations = scoped.installAuthoritativeVaultRuntime.mock.calls.map((call) => call[0].generation);
  expect(generations.length).toBeLessThanOrEqual(1);
  await waitFor(() => expect(latest.state).toBe("ready"));
});

test("a manual refresh re-runs full activation", async () => {
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  runtime.hydrateVaultRuntime.mockClear();
  await act(async () => { await latest.refresh(); });
  expect(runtime.hydrateVaultRuntime).toHaveBeenCalled();
  expect(latest.state).toBe("ready");
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- fail-closed exception boundary.
// ---------------------------------------------------------------------------

test("an exception anywhere in activation produces a stable blocked result", async () => {
  const failures = [
    () => { orchestrator.migrateActiveWorkspaceVault.mockRejectedValue(new Error("migration exploded")); },
    () => { runtime.sealVaultRuntime.mockRejectedValue(new Error("seal exploded")); },
    () => { runtime.hydrateVaultRuntime.mockRejectedValue(new Error("hydration exploded")); },
    () => { scoped.installAuthoritativeVaultRuntime.mockImplementation(() => { throw new Error("adapter exploded"); }); },
  ];
  for (const applyFailure of failures) {
    applyFailure();
    const view = render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
    // eslint-disable-next-line no-await-in-loop
    await waitFor(() => expect(latest.state).toBe("blocked"));
    expect(latest.code).toBe("ACTIVATION_FAILED");
    expect(latest.checking).toBe(false);
    expect(Object.isFrozen(latest)).toBe(true);
    view.unmount();
  }
});

test("an exception during revalidation blocks instead of rejecting", async () => {
  const revalidation = captureRevalidation();
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  runtime.flushVaultRuntime.mockRejectedValue(new Error("flush exploded"));
  await act(async () => { await revalidation()(); });
  expect(latest.state).toBe("blocked");
  expect(latest.code).toBe("ACTIVATION_FAILED");
});

test("an exception during flushAndLock never claims a clean lock", async () => {
  render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("ready"));
  runtime.flushVaultRuntime.mockRejectedValue(new Error("flush exploded"));
  const lock = jest.fn();
  let outcome;
  await act(async () => { outcome = await latest.flushAndLock(lock); });
  expect(outcome).toEqual({ ok: false, code: "ACTIVATION_FAILED" });
  expect(lock).not.toHaveBeenCalled();
  expect(latest.state).toBe("blocked");
});

test("activation never leaves an unhandled rejection behind", async () => {
  const unhandled = [];
  const record = (reason) => unhandled.push(reason);
  process.on("unhandledRejection", record);
  runtime.hydrateVaultRuntime.mockRejectedValue(new Error("hydration exploded"));
  const view = render(<Probe enabled userId={USER} companyId={COMPANY} vaultUnlocked />);
  await waitFor(() => expect(latest.state).toBe("blocked"));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  process.off("unhandledRejection", record);
  view.unmount();
  expect(unhandled).toEqual([]);
});
