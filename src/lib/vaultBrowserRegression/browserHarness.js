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
import { decryptBytes, encryptBytes, migrationManifestAad, recordAad } from "../vaultCrypto";
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

    runStateKey: RUN_STATE_KEY,
  });
}
