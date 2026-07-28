export const VAULT_REPOSITORY_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_SCHEMA: "INVALID_SCHEMA",
  UNSUPPORTED_ENVIRONMENT: "UNSUPPORTED_ENVIRONMENT",
  DATABASE_NOT_FOUND: "DATABASE_NOT_FOUND",
  DATABASE_BLOCKED: "DATABASE_BLOCKED",
  DATABASE_VERSION_ERROR: "DATABASE_VERSION_ERROR",
  TRANSACTION_ABORTED: "TRANSACTION_ABORTED",
  CONFLICT: "CONFLICT",
  RECORD_CORRUPT: "RECORD_CORRUPT",
  REVISION_OVERFLOW: "REVISION_OVERFLOW",
  QUOTA_EXCEEDED: "QUOTA_EXCEEDED",
  STORAGE_OPERATION_FAILED: "STORAGE_OPERATION_FAILED",
});

const ERROR_MESSAGES = Object.freeze({
  INVALID_INPUT: "Invalid vault request.",
  INVALID_SCHEMA: "Invalid vault data.",
  UNSUPPORTED_ENVIRONMENT: "Secure local storage is unavailable.",
  DATABASE_NOT_FOUND: "Vault storage was not found.",
  DATABASE_BLOCKED: "Vault storage is busy.",
  DATABASE_VERSION_ERROR: "Vault storage version is unavailable.",
  TRANSACTION_ABORTED: "Vault storage operation did not complete.",
  CONFLICT: "Vault data changed. Retry required.",
  RECORD_CORRUPT: "Vault storage could not be verified.",
  REVISION_OVERFLOW: "Vault data cannot be updated.",
  QUOTA_EXCEEDED: "Secure local storage is full.",
  STORAGE_OPERATION_FAILED: "Vault storage operation failed.",
});

export class VaultRepositoryError extends Error {
  constructor(code) {
    if (!Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, code)) {
      throw new TypeError("Unknown vault repository error code.");
    }
    super(ERROR_MESSAGES[code]);
    this.name = "VaultRepositoryError";
    this.code = code;
  }
}

export const WORKSPACE_VAULT_DATABASE_VERSION = 1;
export const WORKSPACE_VAULT_DATABASE_PREFIX = "estipaid-vault-v1-";
export const WORKSPACE_VAULT_METADATA_STORE = "metadata";
export const WORKSPACE_VAULT_RECORDS_STORE = "records";
export const WORKSPACE_VAULT_MIGRATION_STORE = "migration";

const METADATA_KEY = "vault";
const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_REVISION = Number.MAX_SAFE_INTEGER;
const METADATA_FIELDS = Object.freeze([
  "version",
  "workspaceTag",
  "revision",
  "kdfVersion",
  "kdfParameters",
  "salt",
  "wrappedDekCiphertext",
  "wrappedDekIv",
  "sentinelSchemaVersion",
  "sentinelCiphertext",
  "sentinelIv",
  "createdAt",
  "updatedAt",
]);
const CREATE_FIELDS = Object.freeze([
  "workspaceTag",
  "expectedRevision",
  "kdfVersion",
  "kdfParameters",
  "salt",
  "wrappedDekCiphertext",
  "wrappedDekIv",
  "sentinelSchemaVersion",
  "sentinelCiphertext",
  "sentinelIv",
]);
const REPLACE_FIELDS = CREATE_FIELDS;
const READ_FIELDS = Object.freeze(["workspaceTag"]);
const KDF_FIELDS = Object.freeze([
  "algorithm",
  "memorySize",
  "iterations",
  "parallelism",
  "hashLength",
  "outputType",
]);
const RECORD_FIELDS = Object.freeze([
  "version",
  "logicalKey",
  "blobId",
  "revision",
  "recordSchemaVersion",
  "ciphertext",
  "iv",
  "createdAt",
  "updatedAt",
]);
const RECORD_INPUT_FIELDS = Object.freeze([
  "workspaceTag",
  "logicalKey",
  "expectedRevision",
  "blobId",
  "recordSchemaVersion",
  "ciphertext",
  "iv",
]);
const RECORD_READ_FIELDS = Object.freeze(["workspaceTag", "logicalKey"]);
const RECORD_DELETE_FIELDS = Object.freeze(["workspaceTag", "logicalKey", "expectedRevision"]);
const BLOB_ID = /^[A-Za-z0-9_-]{22}$/;
const LOGICAL_KEYS = new Set([
  "estipaid-settings-v1",
  "estipaid-estimator-v1",
  "estipaid-estimate-draft-v1",
  "estipaid-estimates-v1",
  "estipaid-projects-v1",
  "estipaid-invoices-v1",
  "estipaid-pending-customer-use-v1",
  "estipaid-pending-customer-create-v1",
  "estipaid-pending-customer-edit-v1",
  "estipaid-customer-edit-target-v1",
  "estipaid-restore-draft-on-create-v1",
  "estipaid-selectedCustomerId-v1",
  "estipaid-selectedCustomerSnap-v1",
  "estipaid-customers-v1",
  "estipaid-customer-recent-v1",
  "estipaid-company-profile-v1",
  "estipaid-subscription-plan-state-v1",
  "estipaid-subscription-plan-remote-cache-v1",
  "estipaid-audit-events-v1",
  "estipaid-stripe-checkout-sessions-v1",
  "estipaid-stripe-checkout-create-locks-v1",
  "estipaid-scope-templates-v1",
  "estipaid-custom-labor-roles-v1",
  "estipaid-job-learning-reviewed-candidates-v1",
  "estipaid-cloud-backup-queue-v1",
  "estipaid-cloud-auto-backup-pause-v1",
  "estipaid-cloud-partial-recovery-status-v1",
  "estipaid-cloud-asset-bindings-v1",
  "estipaid-cloud-sync-baseline-v1",
  "estipaid-cloud-sync-conflict-vault-v1",
  "estipaid-cloud-convergence-journal-v1",
  "estipaid-job-learning-events-v1",
]);
const STORE_NAMES = Object.freeze([
  WORKSPACE_VAULT_METADATA_STORE,
  WORKSPACE_VAULT_RECORDS_STORE,
  WORKSPACE_VAULT_MIGRATION_STORE,
]);

const repositoryError = (code) => new VaultRepositoryError(code);

function hasExactShape(value, fields) {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const names = Object.getOwnPropertyNames(value);
  const symbols = Object.getOwnPropertySymbols(value);
  if (symbols.length !== 0 || names.length !== fields.length) return false;
  const expected = new Set(fields);
  if (names.some((name) => !expected.has(name))) return false;
  return fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor && descriptor.enumerable === true && Object.prototype.hasOwnProperty.call(descriptor, "value");
  });
}

function requireExactShape(value, fields, code) {
  try {
    if (!hasExactShape(value, fields)) throw repositoryError(code);
    return value;
  } catch (error) {
    if (error instanceof VaultRepositoryError) throw error;
    throw repositoryError(code);
  }
}

function isSafeInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function requireWorkspaceTag(value, code) {
  if (typeof value !== "string" || !WORKSPACE_TAG.test(value)) throw repositoryError(code);
  return value;
}

function requireLogicalKey(value, code) {
  if (typeof value !== "string" || !LOGICAL_KEYS.has(value)) throw repositoryError(code);
  return value;
}

function requireBlobId(value, code) {
  if (typeof value !== "string" || !BLOB_ID.test(value)) throw repositoryError(code);
  return value;
}

function requireUint8Array(value, length, code) {
  if (!(value instanceof Uint8Array) || Object.getPrototypeOf(value) !== Uint8Array.prototype || value.length !== length) {
    throw repositoryError(code);
  }
  return new Uint8Array(value);
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string" || value.length !== 24 || !TIMESTAMP.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch (_) {
    return false;
  }
}

function requireKdfParameters(value, code) {
  requireExactShape(value, KDF_FIELDS, code);
  if (
    value.algorithm !== "argon2id"
    || !isSafeInteger(value.memorySize, 65536, 131072)
    || !isSafeInteger(value.iterations, 3, 10)
    || !isSafeInteger(value.parallelism, 1, 1)
    || !isSafeInteger(value.hashLength, 32, 32)
    || value.outputType !== "binary"
  ) throw repositoryError(code);
  return {
    algorithm: "argon2id",
    memorySize: value.memorySize,
    iterations: value.iterations,
    parallelism: 1,
    hashLength: 32,
    outputType: "binary",
  };
}

function requireCallerMetadata(value, revisionMode) {
  requireExactShape(value, CREATE_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  requireWorkspaceTag(value.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  if (revisionMode === "create" && value.expectedRevision !== null) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  if (!isSafeInteger(value.kdfVersion, 1, 1) || !isSafeInteger(value.sentinelSchemaVersion, 1, 1)) {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA);
  }
  return {
    workspaceTag: value.workspaceTag,
    kdfVersion: 1,
    kdfParameters: requireKdfParameters(value.kdfParameters, VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA),
    salt: requireUint8Array(value.salt, 32, VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA),
    wrappedDekCiphertext: requireUint8Array(value.wrappedDekCiphertext, 48, VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA),
    wrappedDekIv: requireUint8Array(value.wrappedDekIv, 12, VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA),
    sentinelSchemaVersion: 1,
    sentinelCiphertext: requireUint8Array(value.sentinelCiphertext, 32, VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA),
    sentinelIv: requireUint8Array(value.sentinelIv, 12, VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA),
  };
}

function requireCallerRecord(value, revisionMode) {
  requireExactShape(value, RECORD_INPUT_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  if (RECORD_INPUT_FIELDS.some((field) => value[field] === undefined)) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  requireWorkspaceTag(value.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  requireLogicalKey(value.logicalKey, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  requireBlobId(value.blobId, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  if (revisionMode === "create" && value.expectedRevision !== null) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  if (revisionMode === "replace" && !isSafeInteger(value.expectedRevision, 1, MAX_REVISION)) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  if (!isSafeInteger(value.recordSchemaVersion, 1, 1)) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA);
  const ciphertext = value.ciphertext;
  if (!(ciphertext instanceof Uint8Array) || Object.getPrototypeOf(ciphertext) !== Uint8Array.prototype || ciphertext.length < 16 || ciphertext.length > 1048576) {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA);
  }
  return {
    workspaceTag: value.workspaceTag,
    logicalKey: value.logicalKey,
    blobId: value.blobId,
    recordSchemaVersion: 1,
    ciphertext: new Uint8Array(ciphertext),
    iv: requireUint8Array(value.iv, 12, VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA),
  };
}

function requirePersistedMetadata(value, workspaceTag) {
  requireExactShape(value, METADATA_FIELDS, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT);
  if (
    !isSafeInteger(value.version, 1, 1)
    || requireWorkspaceTag(value.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT) !== workspaceTag
    || !isSafeInteger(value.revision, 1, MAX_REVISION)
    || !isSafeInteger(value.kdfVersion, 1, 1)
    || !isSafeInteger(value.sentinelSchemaVersion, 1, 1)
    || !isCanonicalTimestamp(value.createdAt)
    || !isCanonicalTimestamp(value.updatedAt)
    || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
  ) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT);
  return {
    version: 1,
    workspaceTag,
    revision: value.revision,
    kdfVersion: 1,
    kdfParameters: requireKdfParameters(value.kdfParameters, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    salt: requireUint8Array(value.salt, 32, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    wrappedDekCiphertext: requireUint8Array(value.wrappedDekCiphertext, 48, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    wrappedDekIv: requireUint8Array(value.wrappedDekIv, 12, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    sentinelSchemaVersion: 1,
    sentinelCiphertext: requireUint8Array(value.sentinelCiphertext, 32, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    sentinelIv: requireUint8Array(value.sentinelIv, 12, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function requirePersistedRecord(value, logicalKey) {
  requireExactShape(value, RECORD_FIELDS, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT);
  if (
    !isSafeInteger(value.version, 1, 1)
    || requireLogicalKey(value.logicalKey, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT) !== logicalKey
    || !isSafeInteger(value.revision, 1, MAX_REVISION)
    || !isSafeInteger(value.recordSchemaVersion, 1, 1)
    || !isCanonicalTimestamp(value.createdAt)
    || !isCanonicalTimestamp(value.updatedAt)
    || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
  ) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT);
  const ciphertext = value.ciphertext;
  if (!(ciphertext instanceof Uint8Array) || Object.getPrototypeOf(ciphertext) !== Uint8Array.prototype || ciphertext.length < 16 || ciphertext.length > 1048576) {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT);
  }
  return {
    version: 1,
    logicalKey,
    blobId: requireBlobId(value.blobId, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    revision: value.revision,
    recordSchemaVersion: 1,
    ciphertext: new Uint8Array(ciphertext),
    iv: requireUint8Array(value.iv, 12, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function cloneMetadata(value) {
  return {
    version: value.version,
    workspaceTag: value.workspaceTag,
    revision: value.revision,
    kdfVersion: value.kdfVersion,
    kdfParameters: { ...value.kdfParameters },
    salt: new Uint8Array(value.salt),
    wrappedDekCiphertext: new Uint8Array(value.wrappedDekCiphertext),
    wrappedDekIv: new Uint8Array(value.wrappedDekIv),
    sentinelSchemaVersion: value.sentinelSchemaVersion,
    sentinelCiphertext: new Uint8Array(value.sentinelCiphertext),
    sentinelIv: new Uint8Array(value.sentinelIv),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function cloneRecord(value) {
  return {
    version: value.version,
    logicalKey: value.logicalKey,
    blobId: value.blobId,
    revision: value.revision,
    recordSchemaVersion: value.recordSchemaVersion,
    ciphertext: new Uint8Array(value.ciphertext),
    iv: new Uint8Array(value.iv),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function mapNativeError(error) {
  if (error instanceof VaultRepositoryError) return error;
  switch (error?.name) {
    case "VersionError": return repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_VERSION_ERROR);
    case "QuotaExceededError": return repositoryError(VAULT_REPOSITORY_ERROR_CODES.QUOTA_EXCEEDED);
    case "AbortError": return repositoryError(VAULT_REPOSITORY_ERROR_CODES.TRANSACTION_ABORTED);
    case "ConstraintError": return repositoryError(VAULT_REPOSITORY_ERROR_CODES.CONFLICT);
    default: return repositoryError(VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED);
  }
}

function databaseName(workspaceTag) {
  return `${WORKSPACE_VAULT_DATABASE_PREFIX}${workspaceTag}`;
}

function clockTimestamp(clock, minimum) {
  let milliseconds;
  try {
    milliseconds = clock();
  } catch (_) {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED);
  }
  if (!Number.isFinite(milliseconds) || !Number.isSafeInteger(milliseconds)) {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED);
  }
  const next = Math.max(milliseconds, minimum ?? milliseconds);
  try {
    const timestamp = new Date(next).toISOString();
    if (!isCanonicalTimestamp(timestamp)) throw new Error();
    return timestamp;
  } catch (_) {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED);
  }
}

function schemaInspectionCompletion(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {};
    transaction.onabort = () => reject(mapNativeError(transaction.error));
  });
}

async function validateSchema(database) {
  const names = Array.from(database.objectStoreNames).sort();
  const expected = [...STORE_NAMES].sort();
  if (names.length !== expected.length || names.some((name, index) => name !== expected[index])) {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_VERSION_ERROR);
  }
  let transaction;
  try {
    transaction = database.transaction(expected, "readonly");
    const metadata = transaction.objectStore(WORKSPACE_VAULT_METADATA_STORE);
    const records = transaction.objectStore(WORKSPACE_VAULT_RECORDS_STORE);
    const migration = transaction.objectStore(WORKSPACE_VAULT_MIGRATION_STORE);
    if (
      metadata.keyPath !== null || metadata.autoIncrement !== false || metadata.indexNames.length !== 0
      || records.keyPath !== "logicalKey" || records.autoIncrement !== false || records.indexNames.length !== 0
      || migration.keyPath !== null || migration.autoIncrement !== false || migration.indexNames.length !== 0
    ) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_VERSION_ERROR);
    await schemaInspectionCompletion(transaction);
  } catch (error) {
    if (transaction) {
      try { transaction.abort(); } catch (_) {}
    }
    if (error instanceof VaultRepositoryError) throw error;
    throw mapNativeError(error);
  }
}

function transactionCompletion(transaction, state) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      if (!state.error) state.error = mapNativeError(transaction.error);
    };
    transaction.onabort = () => reject(state.error || mapNativeError(transaction.error));
  });
}

function abortWith(transaction, state, error) {
  state.error = error instanceof VaultRepositoryError ? error : mapNativeError(error);
  try { transaction.abort(); } catch (_) {}
}

export function createVaultIndexedDbRepository(options = {}) {
  requireExactShape(options, ["indexedDB", "clock"].filter((field) => Object.prototype.hasOwnProperty.call(options, field)), VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  const suppliedIndexedDb = Object.prototype.hasOwnProperty.call(options, "indexedDB") ? options.indexedDB : globalThis.indexedDB;
  const clock = Object.prototype.hasOwnProperty.call(options, "clock") ? options.clock : Date.now;
  if (!suppliedIndexedDb || typeof suppliedIndexedDb.databases !== "function" || typeof suppliedIndexedDb.open !== "function" || typeof suppliedIndexedDb.deleteDatabase !== "function") {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.UNSUPPORTED_ENVIRONMENT);
  }
  if (typeof clock !== "function") throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);

  async function listDatabases() {
    let databases;
    try {
      databases = await suppliedIndexedDb.databases();
    } catch (error) {
      throw mapNativeError(error);
    }
    if (!Array.isArray(databases) || databases.some((entry) => !entry || typeof entry !== "object" || typeof entry.name !== "string")) {
      throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED);
    }
    return databases;
  }

  async function exists(workspaceTag) {
    const name = databaseName(workspaceTag);
    return (await listDatabases()).some((entry) => entry.name === name);
  }

  function open(name, allowCreation) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let upgradeError = null;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      let request;
      try {
        request = suppliedIndexedDb.open(name, WORKSPACE_VAULT_DATABASE_VERSION);
      } catch (error) {
        finish(reject, mapNativeError(error));
        return;
      }
      request.onblocked = () => finish(reject, repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_BLOCKED));
      request.onerror = () => finish(reject, upgradeError || mapNativeError(request.error));
      request.onupgradeneeded = (event) => {
        const transaction = request.transaction;
        const database = request.result;
        const absent = event.oldVersion === 0;
        if (!allowCreation || !absent) {
          upgradeError = repositoryError(absent
            ? VAULT_REPOSITORY_ERROR_CODES.DATABASE_NOT_FOUND
            : VAULT_REPOSITORY_ERROR_CODES.DATABASE_VERSION_ERROR);
          try { transaction.abort(); } catch (_) {}
          try { database.close(); } catch (_) {}
          return;
        }
        try {
          database.createObjectStore(WORKSPACE_VAULT_METADATA_STORE);
          database.createObjectStore(WORKSPACE_VAULT_RECORDS_STORE, { keyPath: "logicalKey" });
          database.createObjectStore(WORKSPACE_VAULT_MIGRATION_STORE);
        } catch (error) {
          upgradeError = mapNativeError(error);
          try { transaction.abort(); } catch (_) {}
          try { database.close(); } catch (_) {}
        }
      };
      request.onsuccess = () => {
        const database = request.result;
        if (settled) {
          try { database.close(); } catch (_) {}
          return;
        }
        if (upgradeError) {
          try { database.close(); } catch (_) {}
          finish(reject, upgradeError);
          return;
        }
        database.onversionchange = () => database.close();
        finish(resolve, database);
      };
    });
  }

  async function openExisting(workspaceTag) {
    if (!(await exists(workspaceTag))) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_NOT_FOUND);
    const database = await open(databaseName(workspaceTag), false);
    try {
      await validateSchema(database);
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  return Object.freeze({
    async workspaceDatabaseExists(input) {
      requireExactShape(input, READ_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const workspaceTag = requireWorkspaceTag(input.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      return exists(workspaceTag);
    },

    async createWorkspaceVaultMetadata(input) {
      const caller = requireCallerMetadata(input, "create");
      let database;
      try {
        database = await open(databaseName(caller.workspaceTag), true);
        await validateSchema(database);
        const timestamp = clockTimestamp(clock);
        const metadata = {
          version: 1,
          workspaceTag: caller.workspaceTag,
          revision: 1,
          kdfVersion: caller.kdfVersion,
          kdfParameters: { ...caller.kdfParameters },
          salt: new Uint8Array(caller.salt),
          wrappedDekCiphertext: new Uint8Array(caller.wrappedDekCiphertext),
          wrappedDekIv: new Uint8Array(caller.wrappedDekIv),
          sentinelSchemaVersion: caller.sentinelSchemaVersion,
          sentinelCiphertext: new Uint8Array(caller.sentinelCiphertext),
          sentinelIv: new Uint8Array(caller.sentinelIv),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const transaction = database.transaction(WORKSPACE_VAULT_METADATA_STORE, "readwrite");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let request;
        try {
          request = transaction.objectStore(WORKSPACE_VAULT_METADATA_STORE).add(metadata, METADATA_KEY);
          request.onerror = () => { if (!state.error) state.error = mapNativeError(request.error); };
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        return cloneMetadata(metadata);
      } finally {
        if (database) database.close();
      }
    },

    async readWorkspaceVaultMetadata(input) {
      requireExactShape(input, READ_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const workspaceTag = requireWorkspaceTag(input.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      let database;
      try {
        database = await openExisting(workspaceTag);
        const transaction = database.transaction(WORKSPACE_VAULT_METADATA_STORE, "readonly");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let result;
        let request;
        try {
          request = transaction.objectStore(WORKSPACE_VAULT_METADATA_STORE).get(METADATA_KEY);
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => { if (!state.error) state.error = mapNativeError(request.error); };
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        if (result === undefined) return null;
        return cloneMetadata(requirePersistedMetadata(result, workspaceTag));
      } finally {
        if (database) database.close();
      }
    },

    async replaceWorkspaceVaultMetadata(input) {
      const caller = requireCallerMetadata(input, "replace");
      if (!isSafeInteger(input.expectedRevision, 1, MAX_REVISION)) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      let database;
      try {
        database = await openExisting(caller.workspaceTag);
        const transaction = database.transaction(WORKSPACE_VAULT_METADATA_STORE, "readwrite");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let result = null;
        let getRequest;
        try {
          getRequest = transaction.objectStore(WORKSPACE_VAULT_METADATA_STORE).get(METADATA_KEY);
          getRequest.onsuccess = () => {
            if (getRequest.result === undefined) return;
            let current;
            try {
              current = requirePersistedMetadata(getRequest.result, caller.workspaceTag);
              if (current.revision !== input.expectedRevision) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.CONFLICT);
              if (current.revision === MAX_REVISION) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.REVISION_OVERFLOW);
              const updatedAt = clockTimestamp(clock, Date.parse(current.updatedAt) + 1);
              result = {
                version: 1,
                workspaceTag: caller.workspaceTag,
                revision: current.revision + 1,
                kdfVersion: caller.kdfVersion,
                kdfParameters: { ...caller.kdfParameters },
                salt: new Uint8Array(caller.salt),
                wrappedDekCiphertext: new Uint8Array(caller.wrappedDekCiphertext),
                wrappedDekIv: new Uint8Array(caller.wrappedDekIv),
                sentinelSchemaVersion: caller.sentinelSchemaVersion,
                sentinelCiphertext: new Uint8Array(caller.sentinelCiphertext),
                sentinelIv: new Uint8Array(caller.sentinelIv),
                createdAt: current.createdAt,
                updatedAt,
              };
              const putRequest = transaction.objectStore(WORKSPACE_VAULT_METADATA_STORE).put(result, METADATA_KEY);
              putRequest.onerror = () => { if (!state.error) state.error = mapNativeError(putRequest.error); };
            } catch (error) {
              abortWith(transaction, state, error);
            }
          };
          getRequest.onerror = () => { if (!state.error) state.error = mapNativeError(getRequest.error); };
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        return result === null ? null : cloneMetadata(result);
      } finally {
        if (database) database.close();
      }
    },

    async createEncryptedRecord(input) {
      const caller = requireCallerRecord(input, "create");
      let database;
      try {
        database = await openExisting(caller.workspaceTag);
        const timestamp = clockTimestamp(clock);
        const record = {
          version: 1,
          logicalKey: caller.logicalKey,
          blobId: caller.blobId,
          revision: 1,
          recordSchemaVersion: 1,
          ciphertext: new Uint8Array(caller.ciphertext),
          iv: new Uint8Array(caller.iv),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        const transaction = database.transaction(WORKSPACE_VAULT_RECORDS_STORE, "readwrite");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let request;
        try {
          request = transaction.objectStore(WORKSPACE_VAULT_RECORDS_STORE).add(record);
          request.onerror = () => { if (!state.error) state.error = mapNativeError(request.error); };
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        return cloneRecord(record);
      } finally {
        if (database) database.close();
      }
    },

    async readEncryptedRecord(input) {
      requireExactShape(input, RECORD_READ_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const workspaceTag = requireWorkspaceTag(input.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const logicalKey = requireLogicalKey(input.logicalKey, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      let database;
      try {
        database = await openExisting(workspaceTag);
        const transaction = database.transaction(WORKSPACE_VAULT_RECORDS_STORE, "readonly");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let result;
        let request;
        try {
          request = transaction.objectStore(WORKSPACE_VAULT_RECORDS_STORE).get(logicalKey);
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => { if (!state.error) state.error = mapNativeError(request.error); };
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        if (result === undefined) return null;
        return cloneRecord(requirePersistedRecord(result, logicalKey));
      } finally {
        if (database) database.close();
      }
    },

    async listEncryptedRecordKeys(input) {
      requireExactShape(input, READ_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const workspaceTag = requireWorkspaceTag(input.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      let database;
      try {
        database = await openExisting(workspaceTag);
        const transaction = database.transaction(WORKSPACE_VAULT_RECORDS_STORE, "readonly");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let keys;
        let request;
        try {
          request = transaction.objectStore(WORKSPACE_VAULT_RECORDS_STORE).getAllKeys();
          request.onsuccess = () => { keys = request.result; };
          request.onerror = () => { if (!state.error) state.error = mapNativeError(request.error); };
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        if (!Array.isArray(keys)) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT);
        return keys.map((key) => requireLogicalKey(key, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT)).sort();
      } finally {
        if (database) database.close();
      }
    },

    async replaceEncryptedRecord(input) {
      const caller = requireCallerRecord(input, "replace");
      let database;
      try {
        database = await openExisting(caller.workspaceTag);
        const transaction = database.transaction(WORKSPACE_VAULT_RECORDS_STORE, "readwrite");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let result = null;
        let getRequest;
        try {
          getRequest = transaction.objectStore(WORKSPACE_VAULT_RECORDS_STORE).get(caller.logicalKey);
          getRequest.onsuccess = () => {
            if (getRequest.result === undefined) return;
            let current;
            try {
              current = requirePersistedRecord(getRequest.result, caller.logicalKey);
              if (current.revision !== input.expectedRevision) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.CONFLICT);
              if (current.revision === MAX_REVISION) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.REVISION_OVERFLOW);
              if (caller.blobId === current.blobId) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
              const updatedAt = clockTimestamp(clock, Date.parse(current.updatedAt) + 1);
              result = {
                version: 1,
                logicalKey: caller.logicalKey,
                blobId: caller.blobId,
                revision: current.revision + 1,
                recordSchemaVersion: 1,
                ciphertext: new Uint8Array(caller.ciphertext),
                iv: new Uint8Array(caller.iv),
                createdAt: current.createdAt,
                updatedAt,
              };
              const putRequest = transaction.objectStore(WORKSPACE_VAULT_RECORDS_STORE).put(result);
              putRequest.onerror = () => { if (!state.error) state.error = mapNativeError(putRequest.error); };
            } catch (error) {
              abortWith(transaction, state, error);
            }
          };
          getRequest.onerror = () => { if (!state.error) state.error = mapNativeError(getRequest.error); };
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        return result === null ? null : cloneRecord(result);
      } finally {
        if (database) database.close();
      }
    },

    async deleteEncryptedRecord(input) {
      requireExactShape(input, RECORD_DELETE_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const workspaceTag = requireWorkspaceTag(input.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const logicalKey = requireLogicalKey(input.logicalKey, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      if (!isSafeInteger(input.expectedRevision, 1, MAX_REVISION)) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      let database;
      try {
        database = await openExisting(workspaceTag);
        const transaction = database.transaction(WORKSPACE_VAULT_RECORDS_STORE, "readwrite");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let deleted = false;
        let getRequest;
        try {
          getRequest = transaction.objectStore(WORKSPACE_VAULT_RECORDS_STORE).get(logicalKey);
          getRequest.onsuccess = () => {
            if (getRequest.result === undefined) return;
            try {
              const current = requirePersistedRecord(getRequest.result, logicalKey);
              if (current.revision !== input.expectedRevision) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.CONFLICT);
              const deleteRequest = transaction.objectStore(WORKSPACE_VAULT_RECORDS_STORE).delete(logicalKey);
              deleteRequest.onerror = () => { if (!state.error) state.error = mapNativeError(deleteRequest.error); };
              deleted = true;
            } catch (error) {
              abortWith(transaction, state, error);
            }
          };
          getRequest.onerror = () => { if (!state.error) state.error = mapNativeError(getRequest.error); };
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        return deleted ? true : null;
      } finally {
        if (database) database.close();
      }
    },
  });
}
