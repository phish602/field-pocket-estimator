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
import {
  createVaultMigrationOrchestrator,
  verifyCompletedVaultMigrationAuthority,
} from "../vaultMigrationOrchestrator";
import {
  beginVaultRuntimeActivation,
  freezeVaultRuntimeMutations,
  hasVaultRuntimeSession,
  isVaultRuntimeFrozen,
  subscribeVaultRuntimeRevalidation,
  unfreezeVaultRuntimeMutations,
} from "../vaultRuntimeStore";
import { resolveVaultActivationPlan } from "../useVaultRuntimeActivation";
import {
  flushVaultRuntime,
  getVaultRuntimeStatus,
  hydrateVaultRuntime,
  isVaultRuntimeReady,
  revokeVaultRuntime,
  runtimeClear as runtimeClearValue,
  runtimeGetItem,
  runtimeLogicalKeys,
  runtimeRemoveItem,
  runtimeSetItem,
  sealVaultRuntime,
  describeVaultRuntime,
} from "../vaultRuntimeStore";
import {
  installAuthoritativeVaultRuntime,
  isAuthoritativeVaultRuntimeInstalled,
  revokeAuthoritativeVaultRuntime,
} from "../accountScopedLocalStorage";
import { isVaultRuntimeReadable } from "../vaultRuntimeStore";
import { decryptBytes, encryptBytes, migrationManifestAad, recordAad } from "../vaultCrypto";
import {
  buildRuntimeCatalog,
  encryptRuntimeCatalog,
  randomBlobId,
  utf8Bytes,
} from "../vaultRuntimeCatalog";
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
  compareIndexedDbContentIntegrity,
  digestBytes,
  snapshotIndexedDbContentIntegrity,
  snapshotIndexedDbNames,
  snapshotLocalStorage,
} from "./integritySnapshot";
import {
  SYNTHETIC_ACTIVE_IDENTITY,
  SYNTHETIC_FOREIGN_IDENTITY,
  SYNTHETIC_THIRD_IDENTITY,
  UNRELATED_INDEXED_DB_NAME,
  buildAllApprovedWorkspaceValues,
  buildMixedPresenceWorkspaceValues,
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

// ISO-16 review fix -- module-private probe state for the cross-tab and
// catalog-replay checks. Never exported, never placed on window.
let revalidationCapture = null;
let revalidationSignalCount = 0;
let stashedCatalogEnvelope = null;
let logicalEventCapture = [];
let logicalEventListener = null;
let originalBroadcastChannel = null;
const heldLeases = {};
const retainedFacades = {};

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

async function seedFixtures({ populated = true, fixtureMode = "mixed", withSecondVault = true } = {}) {
  const storage = realStorage();
  const seeded = seedPhysicalLocalStorage({ storage, populated, fixtureMode });

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

  return Object.freeze({ ...seeded, fixtureMode, secondVault: withSecondVault });
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

  // Canonical CONTENT integrity of every database that must never change, not
  // merely its presence. Captured as part of the snapshot so a preservation
  // verdict can never be asserted without it.
  let preservedIndexedDb = null;
  try {
    preservedIndexedDb = await snapshotPreservedIndexedDbIntegrity();
  } catch (error) {
    preservedIndexedDb = Object.freeze({ entries: Object.freeze([]), error: String(error?.message || "ERROR") });
  }

  return Object.freeze({
    localStorage: local,
    indexedDb: databases,
    preservedIndexedDb,
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

async function snapshotPreservedIndexedDbIntegrity() {
  return snapshotIndexedDbContentIntegrity({
    indexedDb: window.indexedDB,
    selections: [
      { category: "foreign-workspace-vault", databaseName: await vaultDatabaseName("foreign") },
      { category: "third-workspace-vault", databaseName: await vaultDatabaseName("third") },
      { category: "unrelated-synthetic-indexeddb", databaseName: UNRELATED_INDEXED_DB_NAME },
    ],
  });
}

async function verifyActiveMigrationIntegrity({ identity = "active", fixtureMode = "mixed" } = {}) {
  const { userId, companyId } = identityFor(identity);
  const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
  const expected = fixtureMode === "all-approved" ? buildAllApprovedWorkspaceValues() : buildMixedPresenceWorkspaceValues();
  const repository = vaultRepository();
  const stored = await repository.readMigrationManifest({ workspaceTag });
  if (!stored) return Object.freeze({ manifestEntryCount: 0, encryptedRecordCount: 0, allApprovedRepresented: false, noUnexpectedRecords: false, exactUtf8Bytes: false, plaintextAbsent: false });
  let manifestBytes = null;
  const verified = await runWithActiveVaultDek({ workspaceTag, operation: async (dek) => {
    manifestBytes = await decryptBytes(dek, stored.ciphertext, stored.iv, migrationManifestAad({ vaultFormatVersion: 1, userId, companyId, transitionId: stored.transitionId, manifestSchemaVersion: 1 }));
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
    const records = await repository.listEncryptedRecordKeys({ workspaceTag });
    const expectedKeys = Object.keys(expected).sort();
    let exactUtf8Bytes = true;
    for (const entry of manifest.entries || []) {
      if (!entry.present) continue;
      const record = await repository.readEncryptedRecord({ workspaceTag, logicalKey: entry.key });
      let bytes = null;
      try {
        bytes = await decryptBytes(dek, record.ciphertext, record.iv, recordAad({ vaultFormatVersion: 1, userId, companyId, logicalStorageKey: entry.key, blobIdentifier: entry.blobId, recordSchemaVersion: 1 }));
        const sourceBytes = new TextEncoder().encode(expected[entry.key]);
        exactUtf8Bytes = exactUtf8Bytes && sourceBytes.length === bytes.length && sourceBytes.every((byte, index) => byte === bytes[index]);
      } finally { if (bytes) bytes.fill(0); }
    }
    const namespace = buildAccountWorkspaceNamespace({ userId, companyId });
    const plaintextAbsent = VAULT_MIGRATION_LOGICAL_KEYS.every((key) => realStorage().getItem(`${namespace}:${key}`) === null);
    return Object.freeze({
      manifestEntryCount: Array.isArray(manifest.entries) ? manifest.entries.length : 0,
      encryptedRecordCount: records.length,
      allApprovedRepresented: Array.isArray(manifest.entries) && manifest.entries.length === VAULT_MIGRATION_LOGICAL_KEYS.length && new Set(manifest.entries.map((entry) => entry.key)).size === VAULT_MIGRATION_LOGICAL_KEYS.length,
      noUnexpectedRecords: records.every((key) => VAULT_MIGRATION_LOGICAL_KEYS.includes(key)) && records.length === expectedKeys.length,
      exactUtf8Bytes,
      plaintextAbsent,
    });
  } });
  if (manifestBytes) manifestBytes.fill(0);
  return verified || Object.freeze({ manifestEntryCount: 0, encryptedRecordCount: 0, allApprovedRepresented: false, noUnexpectedRecords: false, exactUtf8Bytes: false, plaintextAbsent: false });
}

function preservationVerdict(baseline, current) {
  const localStorage = compareCategories(baseline?.localStorage, current?.localStorage, PRESERVED_CATEGORIES);
  const indexedDb = compareIndexedDbContentIntegrity(baseline?.preservedIndexedDb, current?.preservedIndexedDb);
  return Object.freeze({ allIdentical: localStorage.allIdentical && indexedDb.allIdentical, localStorage, indexedDb });
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

function presentApprovedCount({ fixtureMode = "mixed" } = {}) {
  const values = fixtureMode === "all-approved" ? buildAllApprovedWorkspaceValues() : buildMixedPresenceWorkspaceValues();
  return VAULT_MIGRATION_LOGICAL_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(values, key)).length;
}

function buildOrchestrator({ crashAt = null, fixtureMode = "mixed" } = {}) {
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
    presentRecordCount: presentApprovedCount({ fixtureMode }),
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
function startMigration({ crashAt = null, identity = "active", fixtureMode = "mixed" } = {}) {
  const { userId, companyId } = identityFor(identity);
  runState = { status: "running", boundary: crashAt, result: null, error: null, tripped: null };
  try {
    realStorage().removeItem(CRASH_MARKER_KEY);
  } catch { /* ignore */ }
  const { orchestrator } = buildOrchestrator({ crashAt, fixtureMode });
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

async function runMigration({ crashAt = null, identity = "active", fixtureMode = "mixed" } = {}) {
  const { userId, companyId } = identityFor(identity);
  const { orchestrator } = buildOrchestrator({ crashAt, fixtureMode });
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

// ---------------------------------------------------------------------------
// Authenticated-encryption SEMANTIC corruption
//
// Every mutation below stays VALIDLY AES-GCM encrypted under the same active
// workspace DEK and the correct real AAD. Only the authenticated PLAINTEXT is
// semantically wrong. That is the point: these cases prove the orchestrator
// rejects semantically invalid content it can successfully decrypt, rather than
// relying on an authentication tag failure.
//
// The DEK is used only inside runWithActiveVaultDek. It is never returned from
// the callback, assigned to a global, placed on window, serialized, logged, or
// included in a result or in evidence, and it is never extractable.
// ---------------------------------------------------------------------------

const SEMANTIC_MANIFEST_TARGETS = Object.freeze([
  "manifest-semantic-malformed-json",
  "manifest-semantic-wrong-top-level-type",
  "manifest-semantic-missing-required-field",
  "manifest-semantic-duplicate-logical-key",
  "manifest-semantic-missing-logical-key",
  "manifest-semantic-unknown-logical-key",
  "manifest-semantic-invalid-present-type",
  "manifest-semantic-present-null-byte-length",
  "manifest-semantic-absent-non-null-metadata",
  "manifest-semantic-incorrect-byte-length",
  "manifest-semantic-incorrect-digest",
  "manifest-semantic-malformed-digest",
  "manifest-semantic-incorrect-blob-id",
  "manifest-semantic-malformed-blob-id",
  "manifest-semantic-mismatched-transition-identity",
  "manifest-semantic-record-transition-inconsistent",
  "manifest-semantic-unsupported-version",
  "manifest-semantic-unexpected-extra-field",
]);

const SEMANTIC_RECORD_TARGETS = Object.freeze([
  "record-semantic-same-length-content",
  "record-semantic-different-length-content",
  "record-semantic-valid-json-content",
  "record-semantic-invalid-json-content",
  "record-semantic-altered-against-frozen-manifest",
  "record-semantic-empty-replaces-non-empty",
  "record-semantic-non-empty-replaces-present-empty",
  "record-semantic-mismatched-blob-aad",
  "record-semantic-mismatched-logical-key-aad",
  "record-semantic-altered-persisted-blob-id",
  "record-semantic-altered-persisted-logical-key",
]);

const OTHER_VALID_TRANSITION_ID = "123e4567-e89b-42d3-a456-426614174999";

function manifestAadFor({ userId, companyId, transitionId }) {
  return migrationManifestAad({ vaultFormatVersion: 1, userId, companyId, transitionId, manifestSchemaVersion: 1 });
}

function recordAadFor({ userId, companyId, logicalKey, blobId }) {
  return recordAad({ vaultFormatVersion: 1, userId, companyId, logicalStorageKey: logicalKey, blobIdentifier: blobId, recordSchemaVersion: 1 });
}

function firstPresent(entries) {
  const entry = entries.find((candidate) => candidate.present);
  if (!entry) throw new Error("NO_PRESENT_MANIFEST_ENTRY");
  return entry;
}

function firstAbsent(entries) {
  const entry = entries.find((candidate) => !candidate.present);
  if (!entry) throw new Error("NO_ABSENT_MANIFEST_ENTRY");
  return entry;
}

function mutateManifestPlaintext(target, decodedText) {
  // Malformed plaintext cases never parse the original.
  if (target === "manifest-semantic-malformed-json") return "{\"version\":1,\"entries\":";
  if (target === "manifest-semantic-wrong-top-level-type") return JSON.stringify([1, 2, 3]);

  const value = JSON.parse(decodedText);
  switch (target) {
    case "manifest-semantic-missing-required-field": {
      delete value.version;
      break;
    }
    case "manifest-semantic-duplicate-logical-key": {
      value.entries.push({ ...value.entries[0] });
      break;
    }
    case "manifest-semantic-missing-logical-key": {
      value.entries.pop();
      break;
    }
    case "manifest-semantic-unknown-logical-key": {
      value.entries[0] = { ...value.entries[0], key: "estipaid-not-an-approved-key-v1" };
      break;
    }
    case "manifest-semantic-invalid-present-type": {
      value.entries[0] = { ...value.entries[0], present: "yes" };
      break;
    }
    case "manifest-semantic-present-null-byte-length": {
      firstPresent(value.entries).byteLength = null;
      break;
    }
    case "manifest-semantic-absent-non-null-metadata": {
      const entry = firstAbsent(value.entries);
      entry.byteLength = 7;
      entry.digest = "B".repeat(43);
      break;
    }
    case "manifest-semantic-incorrect-byte-length": {
      firstPresent(value.entries).byteLength += 1;
      break;
    }
    case "manifest-semantic-incorrect-digest": {
      // Structurally valid base64url digest that simply is not the real one.
      firstPresent(value.entries).digest = "A".repeat(43);
      break;
    }
    case "manifest-semantic-malformed-digest": {
      firstPresent(value.entries).digest = "not-a-digest";
      break;
    }
    case "manifest-semantic-incorrect-blob-id": {
      firstPresent(value.entries).blobId = "A".repeat(22);
      break;
    }
    case "manifest-semantic-malformed-blob-id": {
      firstPresent(value.entries).blobId = "short";
      break;
    }
    case "manifest-semantic-mismatched-transition-identity": {
      value.transitionId = OTHER_VALID_TRANSITION_ID;
      break;
    }
    case "manifest-semantic-unsupported-version": {
      value.version = 2;
      break;
    }
    case "manifest-semantic-unexpected-extra-field": {
      value.unexpected = "synthetic";
      break;
    }
    case "manifest-semantic-record-transition-inconsistent": {
      // Plaintext stays internally valid; the PERSISTED record's transition
      // identity is what is made inconsistent, below.
      break;
    }
    default:
      throw new Error("UNKNOWN_SEMANTIC_MANIFEST_TARGET");
  }
  return JSON.stringify(value);
}

async function semanticManifestCorruption({ target, identity = "active" }) {
  const { userId, companyId } = identityFor(identity);
  const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
  const repository = vaultRepository();

  // Read and validate the persisted repository record before touching it.
  const stored = await repository.readMigrationManifest({ workspaceTag });
  if (!stored) return Object.freeze({ corrupted: false, target, reason: "NO_MANIFEST" });

  // The persisted record's transition identity is what binds the manifest AAD.
  const inconsistentRecord = target === "manifest-semantic-record-transition-inconsistent";

  let plaintext = null;
  let mutatedBytes = null;
  try {
    const applied = await runWithActiveVaultDek({
      workspaceTag,
      operation: async (dek) => {
        plaintext = await decryptBytes(dek, stored.ciphertext, stored.iv,
          manifestAadFor({ userId, companyId, transitionId: stored.transitionId }));
        const mutatedText = mutateManifestPlaintext(target, new TextDecoder().decode(plaintext));
        mutatedBytes = new Uint8Array(new TextEncoder().encode(mutatedText));

        // Re-encrypt under the SAME active DEK with the correct manifest AAD and
        // a fresh random 12-byte IV supplied by encryptBytes.
        const aadTransitionId = inconsistentRecord ? OTHER_VALID_TRANSITION_ID : stored.transitionId;
        const envelope = await encryptBytes(dek, mutatedBytes,
          manifestAadFor({ userId, companyId, transitionId: aadTransitionId }));

        if (inconsistentRecord) {
          // The repository deliberately forbids changing a persisted manifest's
          // transition identity, so this intentionally-invalid persisted state
          // can only be constructed by a narrowly scoped raw write.
          await withRawStore(await vaultDatabaseName(identity), WORKSPACE_VAULT_MIGRATION_STORE, "readwrite", async (store) => {
            const current = await storeGet(store, "manifest");
            store.put({ ...current, transitionId: OTHER_VALID_TRANSITION_ID, ciphertext: envelope.ciphertext, iv: envelope.iv }, "manifest");
            return true;
          });
          return "raw-indexeddb-write";
        }

        // Every other case goes through the real repository revision contract.
        const replaced = await repository.replaceMigrationManifest({
          workspaceTag,
          expectedRevision: stored.revision,
          transitionId: stored.transitionId,
          manifestSchemaVersion: 1,
          ciphertext: envelope.ciphertext,
          iv: envelope.iv,
        });
        if (!replaced) throw new Error("MANIFEST_REPLACE_REJECTED");
        return "repository-revision-contract";
      },
    });
    return Object.freeze({
      corrupted: typeof applied === "string",
      target,
      category: "manifest",
      injectionMethod: applied || "none",
      authenticatedEncryptionPreserved: typeof applied === "string",
    });
  } finally {
    if (plaintext) plaintext.fill(0);
    if (mutatedBytes) mutatedBytes.fill(0);
    plaintext = null;
    mutatedBytes = null;
  }
}

function mutateRecordPlaintext(target, decodedText) {
  switch (target) {
    case "record-semantic-same-length-content": {
      // Exact same byte length, different bytes.
      const bytes = new TextEncoder().encode(decodedText);
      const copy = new Uint8Array(bytes);
      copy[copy.length - 1] = copy[copy.length - 1] === 65 ? 66 : 65;
      return new TextDecoder().decode(copy);
    }
    case "record-semantic-different-length-content":
      return `${decodedText} `;
    case "record-semantic-valid-json-content":
      return JSON.stringify({ note: "synthetic-still-valid-json", altered: true });
    case "record-semantic-invalid-json-content":
      return "not-json-at-all{";
    case "record-semantic-altered-against-frozen-manifest":
      return JSON.stringify({ note: "synthetic-altered-against-frozen-manifest" });
    case "record-semantic-empty-replaces-non-empty":
      return "";
    case "record-semantic-non-empty-replaces-present-empty":
      return JSON.stringify({ note: "synthetic-now-non-empty" });
    case "record-semantic-mismatched-blob-aad":
    case "record-semantic-mismatched-logical-key-aad":
    case "record-semantic-altered-persisted-blob-id":
    case "record-semantic-altered-persisted-logical-key":
      // Content is re-encrypted unchanged; the BINDING is what is made wrong.
      return decodedText;
    default:
      throw new Error("UNKNOWN_SEMANTIC_RECORD_TARGET");
  }
}

async function semanticRecordCorruption({ target, identity = "active" }) {
  const { userId, companyId } = identityFor(identity);
  const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
  const repository = vaultRepository();

  const recordKeys = await repository.listEncryptedRecordKeys({ workspaceTag });
  if (!recordKeys.length) return Object.freeze({ corrupted: false, target, reason: "NO_RECORDS" });

  // The present-empty case must target a record whose plaintext really is empty;
  // every other case targets a non-empty record.
  const wantEmpty = target === "record-semantic-non-empty-replaces-present-empty";

  let plaintext = null;
  let mutatedBytes = null;
  try {
    const applied = await runWithActiveVaultDek({
      workspaceTag,
      operation: async (dek) => {
        let chosen = null;
        for (const logicalKey of recordKeys) {
          const record = await repository.readEncryptedRecord({ workspaceTag, logicalKey });
          if (!record) continue;
          let bytes = null;
          try {
            bytes = await decryptBytes(dek, record.ciphertext, record.iv,
              recordAadFor({ userId, companyId, logicalKey, blobId: record.blobId }));
            const isEmpty = bytes.length === 0;
            if (isEmpty === wantEmpty) {
              chosen = { record, logicalKey, text: new TextDecoder().decode(bytes) };
              break;
            }
          } finally { if (bytes) bytes.fill(0); }
        }
        if (!chosen) throw new Error("NO_SUITABLE_RECORD");

        const mutatedText = mutateRecordPlaintext(target, chosen.text);
        mutatedBytes = new Uint8Array(new TextEncoder().encode(mutatedText));

        // Choose the binding used for re-encryption. A mismatched-AAD case is
        // still validly encrypted -- just bound to the wrong identity.
        const aadBlobId = target === "record-semantic-mismatched-blob-aad"
          ? "A".repeat(22) : chosen.record.blobId;
        const aadLogicalKey = target === "record-semantic-mismatched-logical-key-aad"
          ? recordKeys.find((key) => key !== chosen.logicalKey) || chosen.logicalKey
          : chosen.logicalKey;
        const envelope = await encryptBytes(dek, mutatedBytes,
          recordAadFor({ userId, companyId, logicalKey: aadLogicalKey, blobId: aadBlobId }));

        if (target === "record-semantic-altered-persisted-blob-id") {
          // The repository's replace contract REQUIRES a new blob identifier, so
          // this case is expressible through the real revision contract.
          const replaced = await repository.replaceEncryptedRecord({
            workspaceTag,
            logicalKey: chosen.logicalKey,
            expectedRevision: chosen.record.revision,
            blobId: "C".repeat(22),
            recordSchemaVersion: 1,
            ciphertext: envelope.ciphertext,
            iv: envelope.iv,
          });
          if (!replaced) throw new Error("RECORD_REPLACE_REJECTED");
          return "repository-revision-contract";
        }

        if (target === "record-semantic-altered-persisted-logical-key") {
          // Moving a record to a different primary key is not expressible
          // through the repository, so the invalid persisted state is built with
          // a narrowly scoped raw write.
          const other = recordKeys.find((key) => key !== chosen.logicalKey);
          if (!other) throw new Error("NO_SECOND_RECORD");
          await withRawStore(await vaultDatabaseName(identity), WORKSPACE_VAULT_RECORDS_STORE, "readwrite", async (store) => {
            const current = await storeGet(store, chosen.logicalKey);
            store.delete(chosen.logicalKey);
            store.put({ ...current, logicalKey: other });
            return true;
          });
          return "raw-indexeddb-write";
        }

        // Every remaining case keeps the same blob identifier so the frozen
        // manifest still points at this record: the repository's replace
        // contract forbids reusing a blob id, so the persisted swap is a
        // narrowly scoped raw write of correctly authenticated ciphertext.
        await withRawStore(await vaultDatabaseName(identity), WORKSPACE_VAULT_RECORDS_STORE, "readwrite", async (store) => {
          const current = await storeGet(store, chosen.logicalKey);
          store.put({ ...current, ciphertext: envelope.ciphertext, iv: envelope.iv });
          return true;
        });
        return "raw-indexeddb-write";
      },
    });
    return Object.freeze({
      corrupted: typeof applied === "string",
      target,
      category: "record",
      injectionMethod: applied || "none",
      authenticatedEncryptionPreserved: typeof applied === "string",
    });
  } finally {
    if (plaintext) plaintext.fill(0);
    if (mutatedBytes) mutatedBytes.fill(0);
    plaintext = null;
    mutatedBytes = null;
  }
}

async function corrupt({ target, identity = "active" }) {
  if (target.startsWith("manifest-semantic-")) return semanticManifestCorruption({ target, identity });
  if (target.startsWith("record-semantic-")) return semanticRecordCorruption({ target, identity });
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
    fixtureKeyRoles: (options) => describeFixtureKeyRoles(options),
    approvedLogicalKeys: () => [...VAULT_MIGRATION_LOGICAL_KEYS],

    resetAll,
    seedFixtures,
    activateWorkspace,
    openVaultSession,
    deactivate: () => { deactivateAccountScopedLocalStorage(); lockVault(); return { deactivated: true }; },

    snapshot,
    verifyActiveMigrationIntegrity,
    snapshotPreservedIndexedDbIntegrity,
    comparePreservedIndexedDbIntegrity: compareIndexedDbContentIntegrity,
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
    semanticManifestTargets: () => [...SEMANTIC_MANIFEST_TARGETS],
    semanticRecordTargets: () => [...SEMANTIC_RECORD_TARGETS],
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

    // ---- ISO-16 authoritative runtime -----------------------------------
    //
    // These drive the REAL production runtime: real sealing, real hydration,
    // the real synchronous facade adapter, and the real durability queue.

    sealRuntime: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      return sealVaultRuntime({ userId, companyId });
    },

    hydrateRuntime: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      return hydrateVaultRuntime({ userId, companyId });
    },

    // Installs the authoritative adapter exactly as the activation hook does.
    installRuntimeAdapter: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
      const status = getVaultRuntimeStatus();
      const installed = installAuthoritativeVaultRuntime({
        workspaceTag,
        generation: status.generation,
        adapter: {
          canRead: (generation) => isVaultRuntimeReadable(generation),
          canMutate: (generation) => isVaultRuntimeReady(generation),
          isReady: (generation) => isVaultRuntimeReady(generation),
          getItem: (logicalKey) => runtimeGetItem(logicalKey),
          setItem: (logicalKey, value) => runtimeSetItem(logicalKey, value),
          removeItem: (logicalKey) => runtimeRemoveItem(logicalKey),
          clear: () => runtimeClearValue(),
          keys: () => runtimeLogicalKeys(),
        },
      });
      return Object.freeze({ installed, generation: status.generation, state: status.state });
    },

    runtimeStatus: () => getVaultRuntimeStatus(),
    runtimeDescribe: () => describeVaultRuntime(),
    runtimeFlush: async () => flushVaultRuntime(),
    runtimeRevoke: () => { revokeAuthoritativeVaultRuntime(); revokeVaultRuntime(); return { revoked: true }; },
    runtimeAdapterInstalled: () => Object.freeze({ installed: isAuthoritativeVaultRuntimeInstalled() }),
    runtimeKeys: () => [...runtimeLogicalKeys()].sort(),

    // Reads/writes go through the ACTIVE FACADE, i.e. the same synchronous
    // surface the application uses -- never the runtime module directly.
    runtimeFacadeRead: async ({ logicalKey }) => {
      const facade = getActiveAccountScopedStorage();
      if (!facade) return Object.freeze({ attempted: false });
      return Object.freeze({ attempted: true, ...(await describeValue(facade.getItem(logicalKey))) });
    },
    runtimeFacadeWrite: async ({ logicalKey, value }) => {
      const facade = getActiveAccountScopedStorage();
      if (!facade) return Object.freeze({ attempted: false, matches: false });
      facade.setItem(logicalKey, value);
      const readBack = facade.getItem(logicalKey);
      return Object.freeze({ attempted: true, matches: readBack === value, immediate: readBack !== null });
    },
    runtimeFacadeRemove: async ({ logicalKey }) => {
      const facade = getActiveAccountScopedStorage();
      if (!facade) return Object.freeze({ attempted: false });
      facade.removeItem(logicalKey);
      return Object.freeze({ attempted: true, absent: facade.getItem(logicalKey) === null });
    },
    runtimeFacadeClear: async () => {
      const facade = getActiveAccountScopedStorage();
      if (!facade) return Object.freeze({ attempted: false });
      facade.clear();
      return Object.freeze({ attempted: true, remaining: runtimeLogicalKeys().length });
    },
    runtimeFacadeEnumerate: () => {
      const facade = getActiveAccountScopedStorage();
      if (!facade) return Object.freeze({ attempted: false, keys: [] });
      const keys = [];
      for (let index = 0; index < facade.length; index += 1) keys.push(facade.key(index));
      return Object.freeze({ attempted: true, keys: keys.sort() });
    },

    // Proof that no approved plaintext exists at any scoped physical key.
    approvedPlaintextPresent: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const namespace = buildAccountWorkspaceNamespace({ userId, companyId });
      const present = VAULT_MIGRATION_LOGICAL_KEYS.filter((key) => realStorage().getItem(`${namespace}:${key}`) !== null);
      return Object.freeze({ count: present.length, keys: present.sort() });
    },

    // The frozen migration manifest must never change after runtime writes.
    migrationManifestFingerprint: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
      const stored = await vaultRepository().readMigrationManifest({ workspaceTag });
      if (!stored) return Object.freeze({ present: false, digest: "", revision: 0 });
      return Object.freeze({
        present: true,
        revision: stored.revision,
        digest: await digestBytes(new Uint8Array(stored.ciphertext)),
      });
    },

    runtimeCatalogFingerprint: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
      let stored = null;
      try {
        stored = await vaultRepository().readRuntimeCatalog({ workspaceTag });
      } catch (error) {
        return Object.freeze({ present: false, error: String(error?.code || "ERROR") });
      }
      if (!stored) return Object.freeze({ present: false, revision: 0, runtimeGeneration: 0 });
      return Object.freeze({ present: true, revision: stored.revision, runtimeGeneration: stored.runtimeGeneration });
    },

    // Corrupts the persisted runtime catalog for the failure matrix.
    corruptRuntimeCatalog: async ({ target, identity = "active" }) => {
      const databaseName = await vaultDatabaseName(identity);
      return withRawStore(databaseName, WORKSPACE_VAULT_MIGRATION_STORE, "readwrite", async (store) => {
        const current = await storeGet(store, "runtime");
        if (!current) return Object.freeze({ corrupted: false });
        if (target === "catalog-ciphertext") current.ciphertext[0] ^= 0xff;
        else if (target === "catalog-iv") current.iv[0] ^= 0xff;
        else if (target === "catalog-generation") current.runtimeGeneration += 1;
        else if (target === "catalog-shape") delete current.runtimeSchemaVersion;
        else return Object.freeze({ corrupted: false });
        store.put(current, "runtime");
        return Object.freeze({ corrupted: true, target });
      });
    },

    // ---- ISO-16 review fix probes ---------------------------------------
    //
    // Drive the corrected behaviour in the real browser: completed-authority
    // verification before the first seal, the activation state matrix, catalog
    // revision binding, and the cross-tab transport.

    verifyCompletedAuthority: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
      const outcome = await runWithActiveVaultDek({ workspaceTag, operation: async (dek) => {
        const verified = await verifyCompletedVaultMigrationAuthority({
          workspaceTag, dek, userId, companyId, vaultRepository: vaultRepository(),
        });
        // Sanitized: counts and a code only. No key names, digests, or blobs.
        return Object.freeze({ ok: verified.ok, code: verified.code, entryCount: verified.entries.length });
      } });
      return outcome || Object.freeze({ ok: false, code: "VAULT_LOCKED", entryCount: 0 });
    },

    // The persisted runtime catalog is removed so the seal path can be
    // re-exercised against a deliberately damaged completed migration.
    deleteRuntimeCatalog: async ({ identity = "active" } = {}) => {
      const databaseName = await vaultDatabaseName(identity);
      return withRawStore(databaseName, WORKSPACE_VAULT_MIGRATION_STORE, "readwrite", async (store) => {
        store.delete("runtime");
        return Object.freeze({ deleted: true });
      });
    },

    corruptMigrationManifest: async ({ target, identity = "active" }) => {
      const databaseName = await vaultDatabaseName(identity);
      return withRawStore(databaseName, WORKSPACE_VAULT_MIGRATION_STORE, "readwrite", async (store) => {
        const current = await storeGet(store, "manifest");
        if (!current) return Object.freeze({ corrupted: false });
        if (target === "manifest-remove") store.delete("manifest");
        else if (target === "manifest-ciphertext") { current.ciphertext[0] ^= 0xff; store.put(current, "manifest"); }
        else if (target === "manifest-iv") { current.iv[0] ^= 0xff; store.put(current, "manifest"); }
        else if (target === "manifest-transition") {
          current.transitionId = "00000000-0000-4000-8000-000000000000";
          store.put(current, "manifest");
        } else return Object.freeze({ corrupted: false });
        return Object.freeze({ corrupted: true, target });
      });
    },

    // The pure activation decision, evaluated inside the real bundle.
    activationPlan: ({ guardState = "absent", transition = "none", catalogPresent = false } = {}) => {
      const workspaceTag = "A".repeat(43);
      const transitionRecord = transition === "self"
        ? { phase: "copying", workspaceTag }
        : (transition === "other" ? { phase: "copying", workspaceTag: "B".repeat(43) } : null);
      const plan = resolveVaultActivationPlan({
        policy: getVaultBridgeBuildPolicy(),
        guard: guardState === "missing" ? null : { state: guardState },
        transition: transitionRecord,
        catalogPresent,
        workspaceTag,
      });
      return Object.freeze({ action: plan.action, code: plan.code, case: plan.case });
    },

    // Replays an older catalog envelope under a newer persisted wrapper
    // revision. Only the ciphertext/IV are moved; the wrapper revision is left
    // where the runtime advanced it.
    stashRuntimeCatalogEnvelope: async ({ identity = "active" } = {}) => {
      const databaseName = await vaultDatabaseName(identity);
      return withRawStore(databaseName, WORKSPACE_VAULT_MIGRATION_STORE, "readonly", async (store) => {
        const current = await storeGet(store, "runtime");
        if (!current) return Object.freeze({ stashed: false });
        stashedCatalogEnvelope = {
          ciphertext: new Uint8Array(current.ciphertext),
          iv: new Uint8Array(current.iv),
          revision: current.revision,
        };
        return Object.freeze({ stashed: true, revision: current.revision });
      });
    },

    replayStashedRuntimeCatalogEnvelope: async ({ identity = "active" } = {}) => {
      if (!stashedCatalogEnvelope) return Object.freeze({ replayed: false });
      const databaseName = await vaultDatabaseName(identity);
      return withRawStore(databaseName, WORKSPACE_VAULT_MIGRATION_STORE, "readwrite", async (store) => {
        const current = await storeGet(store, "runtime");
        if (!current) return Object.freeze({ replayed: false });
        const wrapperRevision = current.revision;
        current.ciphertext = new Uint8Array(stashedCatalogEnvelope.ciphertext);
        current.iv = new Uint8Array(stashedCatalogEnvelope.iv);
        store.put(current, "runtime");
        return Object.freeze({
          replayed: true,
          stashedRevision: stashedCatalogEnvelope.revision,
          wrapperRevision,
          newer: wrapperRevision > stashedCatalogEnvelope.revision,
        });
      });
    },

    // Rewinds ONLY the persisted wrapper revision, leaving the current envelope
    // in place: the plaintext revision then disagrees with the wrapper.
    rewindRuntimeCatalogWrapperRevision: async ({ identity = "active" } = {}) => {
      const databaseName = await vaultDatabaseName(identity);
      return withRawStore(databaseName, WORKSPACE_VAULT_MIGRATION_STORE, "readwrite", async (store) => {
        const current = await storeGet(store, "runtime");
        if (!current || current.revision <= 1) return Object.freeze({ rewound: false });
        const from = current.revision;
        current.revision -= 1;
        store.put(current, "runtime");
        return Object.freeze({ rewound: true, from, to: current.revision });
      });
    },

    // ---- cross-tab transport --------------------------------------------

    startRevalidationCapture: () => {
      if (revalidationCapture) revalidationCapture();
      revalidationSignalCount = 0;
      revalidationCapture = subscribeVaultRuntimeRevalidation(() => { revalidationSignalCount += 1; });
      return Object.freeze({ capturing: true, broadcastChannel: typeof window.BroadcastChannel === "function" });
    },
    revalidationSignals: () => Object.freeze({ signals: revalidationSignalCount }),
    stopRevalidationCapture: () => {
      if (revalidationCapture) revalidationCapture();
      revalidationCapture = null;
      return Object.freeze({ capturing: false });
    },

    // Posts a message onto the REAL runtime channel from a separate channel
    // instance, which is what another tab looks like from here.
    postRuntimeChannelMessage: async ({ shape = "valid", identity = "active", revisionDelta = 1 } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
      const described = describeVaultRuntime();
      const base = {
        type: "runtime-committed",
        workspaceTag,
        runtimeGeneration: described.runtimeGeneration || 1,
        catalogRevision: (described.catalogRevision || 1) + revisionDelta,
      };
      const message = (() => {
        if (shape === "valid") return base;
        if (shape === "extra-property") return { ...base, extra: true };
        if (shape === "missing-property") return { type: base.type, workspaceTag: base.workspaceTag };
        if (shape === "wrong-type") return { ...base, type: "something-else" };
        if (shape === "bad-tag") return { ...base, workspaceTag: "short" };
        if (shape === "bad-generation") return { ...base, runtimeGeneration: 0 };
        if (shape === "bad-revision") return { ...base, catalogRevision: "2" };
        if (shape === "foreign-workspace") return { ...base, workspaceTag: "B".repeat(43) };
        if (shape === "primitive") return "runtime-committed";
        if (shape === "array") return [base];
        return base;
      })();
      const bus = new window.BroadcastChannel("estipaid-vault-runtime-v1");
      bus.postMessage(message);
      await new Promise((resolve) => { window.setTimeout(resolve, 60); });
      bus.close();
      return Object.freeze({ posted: true, shape });
    },

    // Real focus / visibility events, dispatched exactly as the browser would.
    dispatchVisibilityEvent: async ({ kind = "focus" } = {}) => {
      if (kind === "focus") window.dispatchEvent(new Event("focus"));
      else document.dispatchEvent(new Event("visibilitychange"));
      await new Promise((resolve) => { window.setTimeout(resolve, 60); });
      return Object.freeze({
        dispatched: kind,
        visibilityState: document.visibilityState,
        broadcastChannel: typeof window.BroadcastChannel === "function",
      });
    },

    // Forces the exact CAS loss another tab would cause, by advancing the
    // persisted catalog revision behind this runtime's back.
    advancePersistedCatalogRevision: async ({ identity = "active" } = {}) => {
      const databaseName = await vaultDatabaseName(identity);
      return withRawStore(databaseName, WORKSPACE_VAULT_MIGRATION_STORE, "readwrite", async (store) => {
        const current = await storeGet(store, "runtime");
        if (!current) return Object.freeze({ advanced: false });
        current.revision += 1;
        store.put(current, "runtime");
        return Object.freeze({ advanced: true, revision: current.revision });
      });
    },

    // An asynchronous failure must return a blocked result, never throw.
    hydrateWithUnusableRepository: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const broken = {
        readRuntimeCatalog: async () => { throw new Error("synthetic repository failure"); },
        listEncryptedRecordKeys: async () => { throw new Error("synthetic repository failure"); },
        readEncryptedRecord: async () => { throw new Error("synthetic repository failure"); },
      };
      try {
        const outcome = await hydrateVaultRuntime({ userId, companyId, repository: broken });
        return Object.freeze({ threw: false, ok: outcome.ok, code: outcome.code });
      } catch (error) {
        return Object.freeze({ threw: true, ok: false, code: String(error?.code || "THREW") });
      }
    },

    sealWithUnusableRepository: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const broken = { readRuntimeCatalog: async () => { throw new Error("synthetic repository failure"); } };
      try {
        const outcome = await sealVaultRuntime({ userId, companyId, repository: broken });
        return Object.freeze({ threw: false, ok: outcome.ok, code: outcome.code });
      } catch (error) {
        return Object.freeze({ threw: true, ok: false, code: String(error?.code || "THREW") });
      }
    },

    // ---- ISO-16 atomic-revalidation probes ------------------------------

    // Runs one same-identity revalidation exactly as the production hook does:
    // flush, freeze, verify a candidate while the previous runtime stays active,
    // then install the adapter for the new generation.
    revalidateRuntime: async ({ identity = "active", observe = false } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
      const before = describeVaultRuntime();
      const flushed = await flushVaultRuntime();
      if (flushed.state === "blocked") {
        return Object.freeze({ ok: false, stage: "flush", code: flushed.code, ready: isVaultRuntimeReady() });
      }
      const frozenLease = freezeVaultRuntimeMutations().lease || null;
      // While frozen: reads still serve the last verified cache, the adapter is
      // not ready, and every approved mutation is definitively refused.
      const during = observe
        ? Object.freeze({
          frozen: isVaultRuntimeFrozen(),
          ready: isVaultRuntimeReady(),
          adapterInstalled: isAuthoritativeVaultRuntimeInstalled(),
          entryCount: runtimeLogicalKeys().length,
          writeRefused: runtimeSetItem(VAULT_MIGRATION_LOGICAL_KEYS[0], "refused-while-frozen") === false,
          facadeWriteRefused: (() => {
            const facade = getActiveAccountScopedStorage();
            if (!facade) return true;
            const key = VAULT_MIGRATION_LOGICAL_KEYS[0];
            const previous = facade.getItem(key);
            facade.setItem(key, "refused-through-facade");
            return facade.getItem(key) === previous;
          })(),
        })
        : null;
      const hydrated = await hydrateVaultRuntime({ userId, companyId, lease: frozenLease });
      if (!hydrated.ok) {
        // Only the exact lease reopens the session it froze.
        unfreezeVaultRuntimeMutations(frozenLease);
        return Object.freeze({ ok: false, stage: "hydrate", code: hydrated.code, state: hydrated.state, during, ready: isVaultRuntimeReady() });
      }
      const installed = installAuthoritativeVaultRuntime({
        workspaceTag,
        generation: hydrated.generation,
        adapter: {
          canRead: (generation) => isVaultRuntimeReadable(generation),
          canMutate: (generation) => isVaultRuntimeReady(generation),
          isReady: (generation) => isVaultRuntimeReady(generation),
          getItem: (logicalKey) => runtimeGetItem(logicalKey),
          setItem: (logicalKey, value) => runtimeSetItem(logicalKey, value),
          removeItem: (logicalKey) => runtimeRemoveItem(logicalKey),
          clear: () => runtimeClearValue(),
          keys: () => runtimeLogicalKeys(),
        },
      });
      const after = describeVaultRuntime();
      return Object.freeze({
        ok: true,
        stage: "ready",
        code: "",
        during,
        installed,
        ready: isVaultRuntimeReady(),
        generationBefore: before.generation || 0,
        generationAfter: after.generation || 0,
        catalogRevisionBefore: before.catalogRevision || 0,
        catalogRevisionAfter: after.catalogRevision || 0,
      });
    },

    // Commits durably from OUTSIDE this tab's cache, which is what another tab
    // looks like: the durable catalog advances while this runtime is unaware.
    commitBehindTheRuntime: async ({ logicalKey, value, identity = "active" }) => {
      const { userId, companyId } = identityFor(identity);
      const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
      const outcome = await runWithActiveVaultDek({ workspaceTag, operation: async (dek) => {
        const repository = vaultRepository();
        const storedCatalog = await repository.readRuntimeCatalog({ workspaceTag });
        if (!storedCatalog) return Object.freeze({ committed: false });
        const existing = await repository.readEncryptedRecord({ workspaceTag, logicalKey });
        const plain = utf8Bytes(value);
        const blobId = randomBlobId();
        const envelope = await encryptBytes(dek, plain, recordAad({
          vaultFormatVersion: 1, userId, companyId,
          logicalStorageKey: logicalKey, blobIdentifier: blobId, recordSchemaVersion: 1,
        }));
        const keys = await repository.listEncryptedRecordKeys({ workspaceTag });
        const entries = [];
        for (const key of keys) {
          if (key === logicalKey) continue;
          const record = await repository.readEncryptedRecord({ workspaceTag, logicalKey: key });
          const bytes = await decryptBytes(dek, record.ciphertext, record.iv, recordAad({
            vaultFormatVersion: 1, userId, companyId,
            logicalStorageKey: key, blobIdentifier: record.blobId, recordSchemaVersion: 1,
          }));
          entries.push({ key, blobId: record.blobId, byteLength: bytes.length, digest: await digestBytes(bytes), revision: record.revision });
          bytes.fill(0);
        }
        entries.push({
          key: logicalKey, blobId, byteLength: plain.length,
          digest: await digestBytes(plain), revision: existing ? existing.revision + 1 : 1,
        });
        const catalog = buildRuntimeCatalog({
          runtimeGeneration: storedCatalog.runtimeGeneration,
          catalogRevision: storedCatalog.revision + 1,
          entries,
        });
        const catalogEnvelope = await encryptRuntimeCatalog({ dek, userId, companyId, catalog });
        await repository.commitRuntimeRecordSet({
          workspaceTag,
          logicalKey,
          expectedRecordRevision: existing ? existing.revision : null,
          expectedCatalogRevision: storedCatalog.revision,
          blobId,
          recordSchemaVersion: 1,
          ciphertext: envelope.ciphertext,
          iv: envelope.iv,
          catalogCiphertext: catalogEnvelope.ciphertext,
          catalogIv: catalogEnvelope.iv,
          runtimeGeneration: storedCatalog.runtimeGeneration,
          runtimeSchemaVersion: 1,
        });
        plain.fill(0);
        return Object.freeze({ committed: true, catalogRevision: storedCatalog.revision + 1 });
      } });
      return outcome || Object.freeze({ committed: false });
    },

    // Logical-key change events observed during a revalidation, with what a
    // listener sees when it reads back synchronously.
    captureLogicalEvents: ({ action = "start" } = {}) => {
      if (action === "start") {
        logicalEventCapture = [];
        logicalEventListener = (event) => {
          const key = event?.detail?.key;
          logicalEventCapture.push({
            matchesCache: runtimeGetItem(key) === event?.detail?.value,
            readyAtDispatch: isVaultRuntimeReady(),
          });
        };
        window.addEventListener("pe-localstorage", logicalEventListener);
        return Object.freeze({ capturing: true, events: 0 });
      }
      if (action === "stop" && logicalEventListener) {
        window.removeEventListener("pe-localstorage", logicalEventListener);
        logicalEventListener = null;
      }
      return Object.freeze({
        capturing: Boolean(logicalEventListener),
        events: logicalEventCapture.length,
        allMatchedCache: logicalEventCapture.every((entry) => entry.matchesCache),
        allReadyAtDispatch: logicalEventCapture.every((entry) => entry.readyAtDispatch),
      });
    },

    // Replaces BroadcastChannel with a constructor that throws, so the fallback
    // selection can be exercised against a genuinely unusable transport.
    breakBroadcastChannel: ({ mode = "throw" } = {}) => {
      if (!originalBroadcastChannel) originalBroadcastChannel = window.BroadcastChannel;
      if (mode === "restore") {
        window.BroadcastChannel = originalBroadcastChannel;
        return Object.freeze({ mode: "restore", usable: typeof window.BroadcastChannel === "function" });
      }
      window.BroadcastChannel = mode === "unusable"
        ? function UnusableChannel() { return { name: "unusable" }; }
        : function ThrowingChannel() { throw new Error("synthetic transport failure"); };
      return Object.freeze({ mode, constructorPresent: typeof window.BroadcastChannel === "function" });
    },

    dispatchFocusSignal: async () => {
      window.dispatchEvent(new Event("focus"));
      await new Promise((resolve) => { window.setTimeout(resolve, 60); });
      return Object.freeze({ dispatched: "focus", visibilityState: document.visibilityState });
    },

    // ---- ISO-16 exact runtime-session lease probes ----------------------

    // Freezes the exact active session and keeps the lease module-private here,
    // so a suite can drive a stale candidate without ever handling the token.
    holdRuntimeLease: ({ slot = "current" } = {}) => {
      const frozen = freezeVaultRuntimeMutations();
      heldLeases[slot] = frozen.lease || null;
      return Object.freeze({
        frozen: frozen.frozen,
        held: Boolean(heldLeases[slot]),
        opaque: heldLeases[slot] ? Object.getOwnPropertyNames(heldLeases[slot]).length === 0 : false,
        ready: isVaultRuntimeReady(),
        session: hasVaultRuntimeSession(),
      });
    },

    releaseRuntimeLease: ({ slot = "current" } = {}) => {
      const outcome = unfreezeVaultRuntimeMutations(heldLeases[slot] || null);
      return Object.freeze({ stale: Boolean(outcome.stale), frozen: isVaultRuntimeFrozen(), ready: isVaultRuntimeReady() });
    },

    // Runs a hydration under a HELD lease, optionally against a repository that
    // makes the candidate fail, so a stale success and a stale failure can both
    // be exercised after the session underneath has been replaced.
    hydrateUnderHeldLease: async ({ slot = "current", identity = "active", mode = "succeed" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const lease = heldLeases[slot] || null;
      const repository = mode === "fail"
        ? { ...vaultRepository(), readEncryptedRecord: async () => null }
        : undefined;
      const outcome = await hydrateVaultRuntime({ userId, companyId, repository, lease });
      return Object.freeze({ ok: outcome.ok, state: outcome.state, code: outcome.code });
    },

    // Claims an activation token and hydrates under it, exactly as the initial
    // activation path does.
    activateRuntimeSession: async ({ identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const workspaceTag = await deriveWorkspaceVaultTag(userId, companyId);
      const activation = beginVaultRuntimeActivation();
      const hydrated = await hydrateVaultRuntime({ userId, companyId, activation });
      if (!hydrated.ok) return Object.freeze({ ok: false, state: hydrated.state, code: hydrated.code });
      const installed = installAuthoritativeVaultRuntime({
        workspaceTag,
        generation: hydrated.generation,
        adapter: {
          canRead: (generation) => isVaultRuntimeReadable(generation),
          canMutate: (generation) => isVaultRuntimeReady(generation),
          isReady: (generation) => isVaultRuntimeReady(generation),
          getItem: (logicalKey) => runtimeGetItem(logicalKey),
          setItem: (logicalKey, value) => runtimeSetItem(logicalKey, value),
          removeItem: (logicalKey) => runtimeRemoveItem(logicalKey),
          clear: () => runtimeClearValue(),
          keys: () => runtimeLogicalKeys(),
        },
      });
      return Object.freeze({ ok: true, state: "ready", code: "", installed, generation: hydrated.generation });
    },

    // Sanitized view of the current session: counts and flags only.
    runtimeSessionState: () => {
      const described = describeVaultRuntime();
      return Object.freeze({
        session: hasVaultRuntimeSession(),
        frozen: isVaultRuntimeFrozen(),
        ready: isVaultRuntimeReady(),
        generation: described.active ? described.generation : 0,
        catalogRevision: described.active ? described.catalogRevision : 0,
        entryCount: described.active ? described.entryCount : 0,
        blocked: described.active ? described.blocked : false,
        code: described.active ? described.code : "",
      });
    },

    // Writes scoped PLAINTEXT for an approved key directly into the physical
    // store, so the frozen facade can be proven never to serve it.
    injectScopedPlaintext: async ({ logicalKey, value, identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const namespace = buildAccountWorkspaceNamespace({ userId, companyId });
      realStorage().setItem(`${namespace}:${logicalKey}`, value);
      return Object.freeze({ injected: realStorage().getItem(`${namespace}:${logicalKey}`) === value });
    },

    // What the FACADE answers for an approved key, plus whether the injected
    // plaintext is still physically present and untouched.
    frozenFacadeProbe: async ({ logicalKey, plaintext, identity = "active" } = {}) => {
      const { userId, companyId } = identityFor(identity);
      const namespace = buildAccountWorkspaceNamespace({ userId, companyId });
      const facade = getActiveAccountScopedStorage();
      if (!facade) return Object.freeze({ attempted: false });
      const read = facade.getItem(logicalKey);
      const keys = [];
      for (let index = 0; index < facade.length; index += 1) keys.push(facade.key(index));
      const cacheBefore = runtimeGetItem(logicalKey);
      facade.setItem(logicalKey, "written-while-frozen");
      facade.removeItem(logicalKey);
      facade.clear();
      return Object.freeze({
        attempted: true,
        readsPlaintext: read === plaintext,
        readMatchesRuntime: read === cacheBefore,
        readPresent: read !== null,
        enumeratesKey: keys.includes(logicalKey),
        cacheUnchanged: runtimeGetItem(logicalKey) === cacheBefore,
        plaintextUnchanged: realStorage().getItem(`${namespace}:${logicalKey}`) === plaintext,
        entryCount: runtimeLogicalKeys().length,
      });
    },

    // ---- ISO-16 facade boundary probes ----------------------------------

    // Retains the CURRENT active facade so a later workspace switch can prove
    // the retained one is inert. The facade object itself never leaves here.
    retainActiveFacade: ({ slot = "a" } = {}) => {
      retainedFacades[slot] = getActiveAccountScopedStorage() || null;
      return Object.freeze({ retained: Boolean(retainedFacades[slot]) });
    },

    // What a retained facade can still see or do. Values are never returned --
    // only booleans and byte counts.
    probeRetainedFacade: async ({ slot = "a", logicalKey, expectPresent = false } = {}) => {
      const retained = retainedFacades[slot];
      if (!retained) return Object.freeze({ attempted: false });
      const current = getActiveAccountScopedStorage();
      const beforeRead = retained.getItem(logicalKey);
      const currentBefore = current ? current.getItem(logicalKey) : null;
      retained.setItem(logicalKey, "written-by-retained-facade");
      retained.removeItem(logicalKey);
      retained.clear();
      const keys = [];
      for (let index = 0; index < retained.length; index += 1) keys.push(retained.key(index));
      const currentAfter = current ? current.getItem(logicalKey) : null;
      return Object.freeze({
        attempted: true,
        readPresent: beforeRead !== null,
        readByteLength: beforeRead === null ? 0 : new TextEncoder().encode(beforeRead).length,
        enumeratesKey: keys.includes(logicalKey),
        enumeratesAnyWorkspaceKey: keys.some((key) => VAULT_MIGRATION_LOGICAL_KEYS.includes(key)),
        deviceGlobalStillVisible: keys.includes("estipaid-device-id-v1"),
        currentUnchanged: currentBefore === currentAfter,
        currentPresent: currentAfter !== null,
        currentByteLength: currentAfter === null ? 0 : new TextEncoder().encode(currentAfter).length,
        expectPresent,
      });
    },

    // The device-global compatibility guard as this tab currently reads it.
    guardState: () => Object.freeze({ state: readVaultCompatibilityGuard()?.state || "" }),

    // Reads an approved key through the CURRENT facade, reporting only whether
    // the answer matches the encrypted runtime or the injected plaintext.
    facadeSourceProbe: async ({ logicalKey, plaintext } = {}) => {
      const facade = getActiveAccountScopedStorage();
      if (!facade) return Object.freeze({ attempted: false });
      const read = facade.getItem(logicalKey);
      const migrationSource = typeof facade.readVaultMigrationSourceItem === "function"
        ? facade.readVaultMigrationSourceItem(logicalKey)
        : null;
      const keys = [];
      for (let index = 0; index < facade.length; index += 1) keys.push(facade.key(index));
      return Object.freeze({
        attempted: true,
        readPresent: read !== null,
        readsPlaintext: read === plaintext,
        readMatchesRuntime: read === runtimeGetItem(logicalKey),
        enumeratesKey: keys.includes(logicalKey),
        migrationSourceSeesPlaintext: migrationSource === plaintext,
      });
    },

    // ISO-16 review fix -- proves the guard read never re-enters the globally
    // installed facade. Counts NATIVE backing-storage guard reads and nested
    // facade calls; a stack overflow would show up as a thrown error instead.
    nativeGuardReadProbe: async ({ logicalKey, plaintext } = {}) => {
      const facade = getActiveAccountScopedStorage();
      if (!facade) return Object.freeze({ attempted: false });
      const globalIsFacade = window.localStorage === facade;
      const nativePrototypeGet = Storage.prototype.getItem;
      let guardReads = 0;
      let depth = 0;
      let nestedFacadeCalls = 0;
      Storage.prototype.getItem = function instrumented(key) {
        if (key === "estipaid-vault-guard-v1") guardReads += 1;
        return nativePrototypeGet.call(this, key);
      };
      const originalFacadeGet = facade.getItem.bind(facade);
      facade.getItem = (key) => {
        depth += 1;
        if (depth > 1) nestedFacadeCalls += 1;
        try {
          return originalFacadeGet(key);
        } finally {
          depth -= 1;
        }
      };
      let read = null;
      let threw = "";
      try {
        read = facade.getItem(logicalKey);
        for (let index = 0; index < 20; index += 1) facade.getItem(logicalKey);
      } catch (error) {
        threw = String(error && (error.name || error));
      } finally {
        facade.getItem = originalFacadeGet;
        Storage.prototype.getItem = nativePrototypeGet;
      }
      return Object.freeze({
        attempted: true,
        globalIsFacade,
        readPresent: read !== null,
        readsPlaintext: read === plaintext,
        guardReads,
        nestedFacadeCalls,
        threw,
      });
    },

    // A malformed device guard must close the approved plaintext channel while
    // preserving documented exclusions and device-global storage behaviour.
    malformedGuardFacadeProbe: async ({ logicalKey, plaintext } = {}) => {
      const facade = getActiveAccountScopedStorage();
      if (!facade) return Object.freeze({ attempted: false });
      const { userId, companyId } = identityFor("active");
      const namespace = buildAccountWorkspaceNamespace({ userId, companyId });
      const plaintextKey = `${namespace}:${logicalKey}`;
      const nativeExclusionKey = `${namespace}:estipaid-vault-idle-lock-minutes`;
      const backingStorage = realStorage();
      backingStorage.setItem(VAULT_COMPATIBILITY_GUARD_KEY, "{malformed");
      backingStorage.setItem(plaintextKey, plaintext);
      backingStorage.setItem(nativeExclusionKey, "available");
      backingStorage.setItem("estipaid-device-id-v1", "available");
      window.dispatchEvent(new StorageEvent("storage", { key: VAULT_COMPATIBILITY_GUARD_KEY }));
      revokeAuthoritativeVaultRuntime();

      const nativeGetItem = Storage.prototype.getItem;
      let guardReads = 0;
      let depth = 0;
      let nestedFacadeCalls = 0;
      let networkRequests = 0;
      Storage.prototype.getItem = function instrumentedGetItem(key) {
        if (key === VAULT_COMPATIBILITY_GUARD_KEY) guardReads += 1;
        return nativeGetItem.call(this, key);
      };
      const originalFacadeGet = facade.getItem.bind(facade);
      const nativeFetch = window.fetch;
      facade.getItem = (key) => {
        depth += 1;
        if (depth > 1) nestedFacadeCalls += 1;
        try {
          return originalFacadeGet(key);
        } finally {
          depth -= 1;
        }
      };
      if (typeof nativeFetch === "function") {
        window.fetch = (...args) => {
          networkRequests += 1;
          return nativeFetch(...args);
        };
      }

      let read = null;
      let keys = [];
      let threw = "";
      try {
        read = facade.getItem(logicalKey);
        for (let index = 0; index < facade.length; index += 1) keys.push(facade.key(index));
        facade.setItem(logicalKey, "attempted-write");
        facade.removeItem(logicalKey);
        facade.clear();
      } catch (error) {
        threw = String(error && (error.name || error));
      } finally {
        facade.getItem = originalFacadeGet;
        Storage.prototype.getItem = nativeGetItem;
        if (typeof nativeFetch === "function") window.fetch = nativeFetch;
      }

      return Object.freeze({
        attempted: true,
        readPresent: read !== null,
        readsPlaintext: read === plaintext,
        enumeratesKey: keys.includes(logicalKey),
        plaintextUnchanged: backingStorage.getItem(plaintextKey) === plaintext,
        nativeExclusionReadable: facade.getItem("estipaid-vault-idle-lock-minutes") === "available",
        deviceGlobalReadable: facade.getItem("estipaid-device-id-v1") === "available",
        guardReads,
        nestedFacadeCalls,
        networkRequests,
        threw,
      });
    },

    runStateKey: RUN_STATE_KEY,
  });
}
