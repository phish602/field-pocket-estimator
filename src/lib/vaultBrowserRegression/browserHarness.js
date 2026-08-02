// ISO-15I -- TEST-ONLY real-browser vault regression harness.
//
// This module is the browser-side test driver. It is statically unreachable
// from App.js, index.js, every screen, every hook, every event listener, every
// service worker, every cloud worker, and every Production build entry. It is
// compiled only by scripts/vault-browser-regression/build-harness.js into a
// generated local asset that is never part of the Production bundle.
//
// It exercises the REAL modules: real Web Crypto, real IndexedDB, real
// localStorage, the real account-scoped storage facade, the real vault crypto,
// the real vault IndexedDB repository, the real transition-control repository,
// the real compatibility guard reader and writer, the real vault-session
// binding, and the real migration orchestrator.

import {
  activateAccountScopedLocalStorage,
  buildAccountWorkspaceNamespace,
  deactivateAccountScopedLocalStorage,
  getActiveAccountScopedStorage,
  setActiveWorkspaceVaultCompatibility,
} from "../accountScopedLocalStorage";
import {
  VAULT_COMPATIBILITY_GUARD_KEY,
  readVaultCompatibilityGuard,
} from "../vaultCompatibilityGuard";
import { writeVaultCompatibilityGuard } from "../vaultCompatibilityGuardWriter";
import {
  VAULT_MIGRATION_LOGICAL_KEYS,
  WORKSPACE_VAULT_DATABASE_PREFIX,
  WORKSPACE_VAULT_RECORDS_STORE,
  WORKSPACE_VAULT_MIGRATION_STORE,
  createVaultIndexedDbRepository,
} from "../vaultIndexedDbRepository";
import {
  VAULT_TRANSITION_CONTROL_ACTIVE_KEY,
  VAULT_TRANSITION_CONTROL_DATABASE_NAME,
  VAULT_TRANSITION_CONTROL_STORE,
  createVaultTransitionControlRepository,
} from "../vaultTransitionControlRepository";
import {
  deriveWorkspaceVaultTag,
  lockVault,
  runWithActiveVaultDek,
  setupVault,
  unlockVault,
} from "../vaultSession";
import { createVaultMigrationOrchestrator } from "../vaultMigrationOrchestrator";
import { getVaultBridgeBuildPolicy } from "../vaultBridgeBuildPolicy";
import {
  CRASH_BOUNDARIES,
  CRASH_BOUNDARY_LABELS,
  HarnessInterrupt,
  createCheckpointController,
} from "./crashBoundaries";
import { instrumentDependencies } from "./instrumentedMigration";
import {
  HARNESS_CONTROL_PREFIX,
  compareCategories,
  describeValue,
  snapshotIndexedDbNames,
  snapshotLocalStorage,
} from "./integritySnapshot";
import {
  SYNTHETIC_ACTIVE_IDENTITY,
  SYNTHETIC_FOREIGN_IDENTITY,
  SYNTHETIC_THIRD_IDENTITY,
  UNRELATED_INDEXED_DB_NAME,
  buildPopulatedWorkspaceValues,
  describeFixtureKeyRoles,
  describeFixtureManifest,
  seedPhysicalLocalStorage,
} from "./syntheticFixtures";

const CRASH_MARKER_KEY = `${HARNESS_CONTROL_PREFIX}crash-marker`;
const RUN_STATE_KEY = `${HARNESS_CONTROL_PREFIX}run-state`;

// Categories that must be byte-identical after every migration outcome.
export const PRESERVED_CATEGORIES = Object.freeze([
  "foreign-scoped",
  "legacy-bare-estipaid",
  "quarantined-field-pocket",
  "device-global",
  "auth-shaped",
  "unrelated",
]);

const IDENTITIES = Object.freeze({
  active: SYNTHETIC_ACTIVE_IDENTITY,
  foreign: SYNTHETIC_FOREIGN_IDENTITY,
  third: SYNTHETIC_THIRD_IDENTITY,
});

// The real Storage object, captured before any facade installation so fixture
// seeding and durable inspection never travel through the facade under test.
let nativeStorage = null;

function realStorage() {
  if (!nativeStorage) {
    const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
    // Before activation `window.localStorage` is the genuine Storage object.
    nativeStorage = descriptor && descriptor.get ? window.localStorage : window.localStorage;
  }
  return nativeStorage;
}

function identityFor(name) {
  const identity = IDENTITIES[name];
  if (!identity) throw new Error("UNKNOWN_SYNTHETIC_IDENTITY");
  return identity;
}

function transitionRepository() {
  return createVaultTransitionControlRepository({ indexedDB: window.indexedDB, clock: Date.now });
}

function vaultRepository() {
  return createVaultIndexedDbRepository();
}

async function vaultDatabaseName(name) {
  const identity = identityFor(name);
  return `${WORKSPACE_VAULT_DATABASE_PREFIX}${await deriveWorkspaceVaultTag(identity.userId, identity.companyId)}`;
}

function deleteDatabase(databaseName) {
  return new Promise((resolve) => {
    let request;
    try {
      request = window.indexedDB.deleteDatabase(databaseName);
    } catch {
      resolve(false);
      return;
    }
    request.onsuccess = () => resolve(true);
    request.onerror = () => resolve(false);
    request.onblocked = () => resolve(false);
  });
}

function openRaw(databaseName, version) {
  return new Promise((resolve, reject) => {
    const request = version ? window.indexedDB.open(databaseName, version) : window.indexedDB.open(databaseName);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains("synthetic")) database.createObjectStore("synthetic");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("BLOCKED"));
  });
}

// ---------------------------------------------------------------------------
// State reset and fixture installation
// ---------------------------------------------------------------------------

async function resetAll() {
  deactivateAccountScopedLocalStorage();
  lockVault();
  const storage = realStorage();
  storage.clear();
  const databases = await window.indexedDB.databases();
  for (const entry of databases) {
    if (typeof entry?.name === "string") await deleteDatabase(entry.name);
  }
  return Object.freeze({ reset: true, databasesRemoved: databases.length });
}

async function seedFixtures({ populated = true, withSecondVault = true } = {}) {
  const storage = realStorage();
  const seeded = seedPhysicalLocalStorage({ storage, populated });

  // P -- an unrelated IndexedDB database that migration must never touch.
  const unrelated = await openRaw(UNRELATED_INDEXED_DB_NAME, 1);
  const transaction = unrelated.transaction("synthetic", "readwrite");
  transaction.objectStore("synthetic").put("synthetic-unrelated-record", "row");
  await new Promise((resolve) => { transaction.oncomplete = resolve; });
  unrelated.close();

  if (withSecondVault) {
    // Q and R -- a second workspace vault and an unrelated transition-free vault
    // database, both created through the real vault-session setup path.
    await setupVault({ ...identityFor("foreign"), password: identityFor("foreign").password });
    await setupVault({ ...identityFor("third"), password: identityFor("third").password });
    lockVault();
  }

  return Object.freeze({ ...seeded, secondVault: withSecondVault });
}

async function activateWorkspace({ identity = "active" } = {}) {
  const { userId, companyId } = identityFor(identity);
  const activation = activateAccountScopedLocalStorage({ storage: realStorage(), userId, companyId });
  if (!activation.ok) return Object.freeze({ ok: false, error: activation.error });
  const tag = await deriveWorkspaceVaultTag(userId, companyId);
  setActiveWorkspaceVaultCompatibility({ workspaceTag: tag, state: "legacy-safe", generation: 1 });
  return Object.freeze({ ok: true, installed: activation.installed });
}

async function openVaultSession({ identity = "active", create = true } = {}) {
  const { userId, companyId, password } = identityFor(identity);
  const capability = create
    ? await setupVault({ userId, companyId, password })
    : await unlockVault({ userId, companyId, password });
  return Object.freeze({ state: capability.state, code: capability.code });
}

// ---------------------------------------------------------------------------
// Sanitized snapshots
// ---------------------------------------------------------------------------

async function snapshot({ identity = "active" } = {}) {
  const { userId, companyId } = identityFor(identity);
  const namespace = buildAccountWorkspaceNamespace({ userId, companyId });
  const local = await snapshotLocalStorage({ storage: realStorage(), activeNamespace: namespace });
  const databases = await snapshotIndexedDbNames({
    indexedDb: window.indexedDB,
    activeVaultDatabaseName: await vaultDatabaseName(identity),
  });

  const guard = readVaultCompatibilityGuard();
  let transition = null;
  try {
    transition = await transitionRepository().readActiveTransition({});
  } catch (error) {
    transition = { phase: `unreadable:${error?.code || "ERROR"}` };
  }

  const tag = await deriveWorkspaceVaultTag(userId, companyId);
  const repository = vaultRepository();
  let recordKeys = [];
  let manifestPresent = false;
  let vaultPresent = false;
  try {
    vaultPresent = await repository.workspaceDatabaseExists({ workspaceTag: tag });
    if (vaultPresent) {
      recordKeys = await repository.listEncryptedRecordKeys({ workspaceTag: tag });
      manifestPresent = (await repository.readMigrationManifest({ workspaceTag: tag })) !== null;
    }
  } catch (error) {
    recordKeys = [];
  }

  return Object.freeze({
    localStorage: local,
    indexedDb: databases,
    guardState: guard.state,
    guardCode: guard.code,
    transitionPhase: transition ? transition.phase : "none",
    transitionBelongsToActiveWorkspace: transition ? transition.workspaceTag === tag : null,
    activeWorkspaceVaultPresent: vaultPresent,
    encryptedRecordKeys: [...recordKeys].sort(),
    encryptedRecordCount: recordKeys.length,
    manifestPresent,
  });
}

function preservationVerdict(baseline, current) {
  return compareCategories(baseline?.localStorage, current?.localStorage, PRESERVED_CATEGORIES);
}

// ---------------------------------------------------------------------------
// Migration execution with real durable interruption
// ---------------------------------------------------------------------------

let runState = { status: "idle", boundary: null, result: null, error: null, tripped: null };

function recordCrashMarker(marker) {
  try {
    realStorage().setItem(CRASH_MARKER_KEY, JSON.stringify(marker));
  } catch {
    /* the durable IndexedDB/localStorage state is the real evidence */
  }
  runState = { ...runState, status: "interrupted", tripped: marker.boundary };
}

function presentApprovedCount() {
  const values = buildPopulatedWorkspaceValues();
  return VAULT_MIGRATION_LOGICAL_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(values, key)).length;
}

function buildOrchestrator({ crashAt = null } = {}) {
  const controller = createCheckpointController({ crashAt, record: recordCrashMarker });
  const facade = getActiveAccountScopedStorage();
  if (!facade) throw new Error("FACADE_UNAVAILABLE");
  const instrumented = instrumentDependencies({
    storage: facade,
    vaultRepository: vaultRepository(),
    transitionRepository: transitionRepository(),
    readGuard: readVaultCompatibilityGuard,
    writeGuard: writeVaultCompatibilityGuard,
    controller,
    presentRecordCount: presentApprovedCount(),
  });
  return {
    controller,
    orchestrator: createVaultMigrationOrchestrator({
      storage: instrumented.storage,
      vaultRepository: instrumented.vaultRepository,
      transitionRepository: instrumented.transitionRepository,
      readGuard: instrumented.readGuard,
      writeGuard: instrumented.writeGuard,
    }),
  };
}

// Fire-and-forget so the driver can observe the durable interruption and then
// perform an ACTUAL browser reload or an ACTUAL browser-session restart.
function startMigration({ crashAt = null, identity = "active" } = {}) {
  const { userId, companyId } = identityFor(identity);
  runState = { status: "running", boundary: crashAt, result: null, error: null, tripped: null };
  try {
    realStorage().removeItem(CRASH_MARKER_KEY);
  } catch { /* ignore */ }
  const { orchestrator } = buildOrchestrator({ crashAt });
  orchestrator.run({ userId, companyId }).then((result) => {
    if (runState.status === "interrupted") return;
    runState = { ...runState, status: "settled", result };
  }).catch((error) => {
    if (error instanceof HarnessInterrupt) {
      runState = { ...runState, status: "interrupted", tripped: error.boundary };
      return;
    }
    runState = { ...runState, status: "failed", error: String(error?.code || error?.name || "ERROR") };
  });
  return Object.freeze({ started: true, boundary: crashAt });
}

async function runMigration({ crashAt = null, identity = "active" } = {}) {
  const { userId, companyId } = identityFor(identity);
  const { orchestrator } = buildOrchestrator({ crashAt });
  try {
    const result = await orchestrator.run({ userId, companyId });
    runState = { status: "settled", boundary: crashAt, result, error: null, tripped: null };
    return result;
  } catch (error) {
    if (error instanceof HarnessInterrupt) {
      runState = { status: "interrupted", boundary: crashAt, result: null, error: null, tripped: error.boundary };
      return Object.freeze({ state: "interrupted", boundary: error.boundary });
    }
    throw error;
  }
}

function migrationStatus() {
  let marker = null;
  try {
    const raw = realStorage().getItem(CRASH_MARKER_KEY);
    marker = raw ? JSON.parse(raw) : null;
  } catch { marker = null; }
  return Object.freeze({
    status: runState.status,
    boundary: runState.boundary,
    tripped: runState.tripped || marker?.boundary || null,
    stageAtTrip: marker?.stage || null,
    result: runState.result,
    error: runState.error,
  });
}

// ---------------------------------------------------------------------------
// Guard / phase matrix construction on real durable stores
// ---------------------------------------------------------------------------

async function forceGuard({ state = "absent" } = {}) {
  if (state === "absent") {
    realStorage().removeItem(VAULT_COMPATIBILITY_GUARD_KEY);
    return Object.freeze({ guardState: readVaultCompatibilityGuard().state });
  }
  const written = writeVaultCompatibilityGuard({ state, storage: getActiveAccountScopedStorage() || realStorage() });
  return Object.freeze({ written, guardState: readVaultCompatibilityGuard().state });
}

async function forceTransitionPhase({ phase = "prepared", identity = "active", transitionId = null } = {}) {
  const { userId, companyId } = identityFor(identity);
  const tag = await deriveWorkspaceVaultTag(userId, companyId);
  const repository = transitionRepository();
  const id = transitionId || window.crypto.randomUUID();
  let active = await repository.createActiveTransition({ transitionId: id, workspaceTag: tag });
  const order = ["prepared", "guarded", "copying", "verifying", "cleaning", "authoritative"];
  const next = { prepared: "guarded", guarded: "copying", copying: "verifying", verifying: "cleaning", cleaning: "authoritative" };
  while (active.phase !== phase && order.indexOf(active.phase) < order.indexOf(phase)) {
    active = await repository.advanceActiveTransition({
      transitionId: id, workspaceTag: tag, expectedPhase: active.phase, nextPhase: next[active.phase],
    });
  }
  return Object.freeze({ phase: active.phase, belongsToActive: identity === "active" });
}

async function clearTransition() {
  await deleteDatabase(VAULT_TRANSITION_CONTROL_DATABASE_NAME);
  return Object.freeze({ cleared: true });
}

// ---------------------------------------------------------------------------
// Stale-tab and source-mutation probes (facade contract, no bypass)
// ---------------------------------------------------------------------------

function facadeWrite({ logicalKey, value }) {
  const facade = getActiveAccountScopedStorage();
  if (!facade) return Object.freeze({ attempted: false, applied: false });
  const before = facade.getItem(logicalKey);
  facade.setItem(logicalKey, value);
  const after = facade.getItem(logicalKey);
  return Object.freeze({ attempted: true, applied: after === value && after !== before, changed: after !== before });
}

function facadeRemove({ logicalKey }) {
  const facade = getActiveAccountScopedStorage();
  if (!facade) return Object.freeze({ attempted: false, applied: false });
  const before = facade.getItem(logicalKey);
  facade.removeItem(logicalKey);
  const after = facade.getItem(logicalKey);
  return Object.freeze({ attempted: true, applied: before !== null && after === null, changed: after !== before });
}

async function facadeRead({ logicalKey }) {
  const facade = getActiveAccountScopedStorage();
  if (!facade) return Object.freeze({ attempted: false });
  return Object.freeze({ attempted: true, ...(await describeValue(facade.getItem(logicalKey))) });
}

// Physical source mutation, used to model another tab writing plaintext while a
// migration generation is already in flight.
function mutatePhysicalSource({ logicalKey, value = null, identity = "active" }) {
  const { userId, companyId } = identityFor(identity);
  const namespace = buildAccountWorkspaceNamespace({ userId, companyId });
  const physicalKey = `${namespace}:${logicalKey}`;
  const storage = realStorage();
  if (value === null) storage.removeItem(physicalKey);
  else storage.setItem(physicalKey, value);
  return Object.freeze({ mutated: true, nowPresent: storage.getItem(physicalKey) !== null });
}

// ---------------------------------------------------------------------------
// Corruption injection on real durable stores
// ---------------------------------------------------------------------------

function withRawStore(databaseName, storeName, mode, work) {
  return new Promise((resolve, reject) => {
    const request = window.indexedDB.open(databaseName);
    request.onsuccess = async () => {
      const database = request.result;
      try {
        const transaction = database.transaction(storeName, mode);
        const store = transaction.objectStore(storeName);
        const outcome = await work(store);
        await new Promise((done, fail) => { transaction.oncomplete = done; transaction.onabort = () => fail(transaction.error); });
        database.close();
        resolve(outcome);
      } catch (error) {
        database.close();
        reject(error);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

function storeGet(store, key) {
  return new Promise((resolve, reject) => {
    const request = key === undefined ? store.getAll() : store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function corrupt({ target, identity = "active" }) {
  const databaseName = await vaultDatabaseName(identity);
  if (target === "manifest-ciphertext" || target === "manifest-iv" || target === "manifest-transition-id"
    || target === "manifest-transition-id-malformed" || target === "manifest-schema") {
    return withRawStore(databaseName, WORKSPACE_VAULT_MIGRATION_STORE, "readwrite", async (store) => {
      const manifest = await storeGet(store, "manifest");
      if (!manifest) return Object.freeze({ corrupted: false });
      if (target === "manifest-ciphertext") manifest.ciphertext[0] ^= 0xff;
      if (target === "manifest-iv") manifest.iv[0] ^= 0xff;
      if (target === "manifest-transition-id") manifest.transitionId = "123e4567-e89b-42d3-a456-426614174999";
      if (target === "manifest-transition-id-malformed") manifest.transitionId = "not-a-transition-identity";
      if (target === "manifest-schema") manifest.manifestSchemaVersion = 2;
      store.put(manifest, "manifest");
      return Object.freeze({ corrupted: true });
    });
  }
  if (target === "record-ciphertext" || target === "record-iv" || target === "record-blob-id"
    || target === "record-schema" || target === "record-remove" || target === "record-unexpected"
    || target === "record-shape-invalid") {
    return withRawStore(databaseName, WORKSPACE_VAULT_RECORDS_STORE, "readwrite", async (store) => {
      const records = await storeGet(store);
      if (!records.length) return Object.freeze({ corrupted: false });
      const first = records[0];
      if (target === "record-ciphertext") { first.ciphertext[0] ^= 0xff; store.put(first); }
      if (target === "record-iv") { first.iv[0] ^= 0xff; store.put(first); }
      if (target === "record-blob-id") { first.blobId = "AAAAAAAAAAAAAAAAAAAAAA"; store.put(first); }
      if (target === "record-schema") { first.recordSchemaVersion = 2; store.put(first); }
      if (target === "record-remove") { store.delete(first.logicalKey); }
      // A persisted record missing required fields: the repository's read-side
      // validation must reject it and abort the enclosing transaction.
      if (target === "record-shape-invalid") {
        store.put({ logicalKey: first.logicalKey, version: 1, ciphertext: first.ciphertext });
      }
      if (target === "record-unexpected") {
        const absent = VAULT_MIGRATION_LOGICAL_KEYS.find((key) => !records.some((record) => record.logicalKey === key));
        if (!absent) return Object.freeze({ corrupted: false });
        store.put({ ...first, logicalKey: absent });
      }
      return Object.freeze({ corrupted: true });
    });
  }
  if (target === "transition-record") {
    return withRawStore(VAULT_TRANSITION_CONTROL_DATABASE_NAME, VAULT_TRANSITION_CONTROL_STORE, "readwrite", async (store) => {
      const active = await storeGet(store, VAULT_TRANSITION_CONTROL_ACTIVE_KEY);
      if (!active) return Object.freeze({ corrupted: false });
      store.put({ ...active, phase: "not-a-phase" }, VAULT_TRANSITION_CONTROL_ACTIVE_KEY);
      return Object.freeze({ corrupted: true });
    });
  }
  if (target === "transition-database-schema") {
    await deleteDatabase(VAULT_TRANSITION_CONTROL_DATABASE_NAME);
    const database = await openRaw(VAULT_TRANSITION_CONTROL_DATABASE_NAME, 1);
    database.close();
    return Object.freeze({ corrupted: true });
  }
  if (target === "vault-database-schema") {
    await deleteDatabase(databaseName);
    const database = await openRaw(databaseName, 1);
    database.close();
    return Object.freeze({ corrupted: true });
  }
  if (target === "vault-database-version") {
    const database = await openRaw(databaseName, 99);
    database.close();
    return Object.freeze({ corrupted: true });
  }
  if (target === "vault-database-remove") {
    await deleteDatabase(databaseName);
    return Object.freeze({ corrupted: true });
  }
  throw new Error("UNKNOWN_CORRUPTION_TARGET");
}

// A denied storage environment: every mutation raises, exactly as a browser
// with local storage disabled behaves.
function denyStorage({ mode = "quota" } = {}) {
  const storage = realStorage();
  const originalSetItem = storage.setItem.bind(storage);
  const failure = mode === "quota"
    ? () => { const error = new Error("quota"); error.name = "QuotaExceededError"; throw error; }
    : () => { const error = new Error("denied"); error.name = "SecurityError"; throw error; };
  storage.setItem = failure;
  return Object.freeze({
    denied: true,
    restore: () => { storage.setItem = originalSetItem; },
  });
}

let storageDenial = null;

// ---------------------------------------------------------------------------
// Public test-only surface
// ---------------------------------------------------------------------------

export function createBrowserHarness() {
  return Object.freeze({
    version: "iso-15i-1",
    boundaries: CRASH_BOUNDARY_LABELS,
    boundaryTable: CRASH_BOUNDARIES,
    buildPolicy: () => getVaultBridgeBuildPolicy(),
    fixtureManifest: (options) => describeFixtureManifest(options),
    fixtureKeyRoles: () => describeFixtureKeyRoles(),
    approvedLogicalKeys: () => [...VAULT_MIGRATION_LOGICAL_KEYS],

    resetAll,
    seedFixtures,
    activateWorkspace,
    openVaultSession,
    deactivate: () => { deactivateAccountScopedLocalStorage(); lockVault(); return { deactivated: true }; },

    snapshot,
    preservationVerdict,
    compareSnapshots: (baseline, current, categories) =>
      compareCategories(baseline?.localStorage, current?.localStorage, categories || PRESERVED_CATEGORIES),

    startMigration,
    runMigration,
    migrationStatus,
    clearRunState: () => { runState = { status: "idle", boundary: null, result: null, error: null, tripped: null }; try { realStorage().removeItem(CRASH_MARKER_KEY); } catch { /* ignore */ } return { cleared: true }; },

    forceGuard,
    forceTransitionPhase,
    clearTransition,

    facadeWrite,
    facadeRemove,
    facadeRead,
    mutatePhysicalSource,

    corrupt,
    denyStorage: (options) => { storageDenial = denyStorage(options); return { denied: true }; },
    restoreStorage: () => { if (storageDenial) storageDenial.restore(); storageDenial = null; return { restored: true }; },

    // Proof that the DEK never leaves the session module: the harness can only
    // observe that a bound operation runs, never the key itself.
    dekIsBound: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const tag = await deriveWorkspaceVaultTag(userId, companyId);
      const outcome = await runWithActiveVaultDek({ workspaceTag: tag, operation: (dek) => Object.freeze({
        bound: true, type: dek?.type || null, extractable: dek?.extractable, algorithm: dek?.algorithm?.name || null,
      }) });
      return outcome || Object.freeze({ bound: false });
    },

    // Exact redaction self-test. The caller hands in captured output; this
    // returns BOOLEANS only, so the secret audit can prove that no real
    // workspace tag, namespace, identity, or password appears anywhere without
    // any of those values ever being emitted for comparison.
    containsForbiddenIdentity: async (text = "") => {
      const haystack = String(text);
      const names = ["active", "foreign", "third"];
      const found = { workspaceTag: false, namespace: false, userId: false, companyId: false, password: false, vaultDatabaseName: false };
      for (const name of names) {
        const identity = identityFor(name);
        const tag = await deriveWorkspaceVaultTag(identity.userId, identity.companyId);
        if (haystack.includes(tag)) found.workspaceTag = true;
        if (haystack.includes(`${WORKSPACE_VAULT_DATABASE_PREFIX}${tag}`)) found.vaultDatabaseName = true;
        const namespace = buildAccountWorkspaceNamespace(identity);
        if (namespace && haystack.includes(namespace)) found.namespace = true;
        if (haystack.includes(identity.userId)) found.userId = true;
        if (haystack.includes(identity.companyId)) found.companyId = true;
        if (haystack.includes(identity.password)) found.password = true;
      }
      return Object.freeze({ ...found, any: Object.values(found).some(Boolean) });
    },

    runStateKey: RUN_STATE_KEY,
  });
}
