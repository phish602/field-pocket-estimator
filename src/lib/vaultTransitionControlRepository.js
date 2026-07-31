import {
  VaultRepositoryError,
  VAULT_REPOSITORY_ERROR_CODES,
} from "./vaultIndexedDbRepository";

export const VAULT_TRANSITION_CONTROL_DATABASE_NAME = "estipaid-vault-control-v1";
export const VAULT_TRANSITION_CONTROL_DATABASE_VERSION = 1;
export const VAULT_TRANSITION_CONTROL_STORE = "transitions";
export const VAULT_TRANSITION_CONTROL_ACTIVE_KEY = "active";

const TRANSITION_FIELDS = Object.freeze([
  "version",
  "transitionId",
  "workspaceTag",
  "phase",
  "createdAt",
  "updatedAt",
]);
const CREATE_FIELDS = Object.freeze(["transitionId", "workspaceTag"]);
const READ_FIELDS = Object.freeze([]);
const ADVANCE_FIELDS = Object.freeze(["transitionId", "workspaceTag", "expectedPhase", "nextPhase"]);
const DELETE_FIELDS = Object.freeze(["transitionId", "workspaceTag", "expectedPhase"]);
const CONSTRUCTOR_FIELDS = Object.freeze(["indexedDB", "clock"]);
const TRANSITION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const PHASES = Object.freeze(["prepared", "guarded", "copying", "verifying", "cleaning", "authoritative"]);
const NEXT_PHASE = Object.freeze({
  prepared: "guarded",
  guarded: "copying",
  copying: "verifying",
  verifying: "cleaning",
  cleaning: "authoritative",
});

const repositoryError = (code) => new VaultRepositoryError(code);

function hasExactShape(value, fields) {
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const names = Object.getOwnPropertyNames(value);
  if (Object.getOwnPropertySymbols(value).length !== 0 || names.length !== fields.length) return false;
  const expected = new Set(fields);
  if (names.some((name) => !expected.has(name))) return false;
  return fields.every((field) => {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    return descriptor && descriptor.enumerable === true && Object.prototype.hasOwnProperty.call(descriptor, "value") && descriptor.value !== undefined;
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

function requireTransitionId(value, code) {
  if (typeof value !== "string" || !TRANSITION_ID.test(value)) throw repositoryError(code);
  return value;
}

function requireWorkspaceTag(value, code) {
  if (typeof value !== "string" || !WORKSPACE_TAG.test(value)) throw repositoryError(code);
  return value;
}

function requirePhase(value, code) {
  if (typeof value !== "string" || !PHASES.includes(value)) throw repositoryError(code);
  return value;
}

function isCanonicalTimestamp(value) {
  if (typeof value !== "string" || value.length !== 24 || !TIMESTAMP.test(value)) return false;
  try {
    return new Date(value).toISOString() === value;
  } catch (_) {
    return false;
  }
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

function clockTimestamp(clock, minimum) {
  let milliseconds;
  try {
    milliseconds = clock();
  } catch (_) {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED);
  }
  if (!Number.isFinite(milliseconds) || !Number.isSafeInteger(milliseconds)) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED);
  const next = Math.max(milliseconds, minimum ?? milliseconds);
  try {
    const timestamp = new Date(next).toISOString();
    if (!isCanonicalTimestamp(timestamp)) throw new Error();
    return timestamp;
  } catch (_) {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED);
  }
}

function transactionCompletion(transaction, state) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => {
      if (!state.error) state.error = mapNativeError(transaction.error);
      try { transaction.abort(); } catch (_) {}
    };
    transaction.onabort = () => reject(state.error || mapNativeError(transaction.error));
  });
}

function abortWith(transaction, state, error) {
  state.error = error instanceof VaultRepositoryError ? error : mapNativeError(error);
  try { transaction.abort(); } catch (_) {}
}

function validateTransition(value) {
  requireExactShape(value, TRANSITION_FIELDS, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT);
  if (
    value.version !== 1
    || !Number.isSafeInteger(value.version)
    || !isCanonicalTimestamp(value.createdAt)
    || !isCanonicalTimestamp(value.updatedAt)
    || Date.parse(value.updatedAt) < Date.parse(value.createdAt)
  ) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT);
  return {
    version: 1,
    transitionId: requireTransitionId(value.transitionId, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    workspaceTag: requireWorkspaceTag(value.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    phase: requirePhase(value.phase, VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function cloneTransition(value) {
  return {
    version: value.version,
    transitionId: value.transitionId,
    workspaceTag: value.workspaceTag,
    phase: value.phase,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function createVaultTransitionControlRepository(options) {
  requireExactShape(options, CONSTRUCTOR_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
  const { indexedDB, clock } = options;
  if (!indexedDB || typeof indexedDB !== "object" || typeof indexedDB.open !== "function" || typeof indexedDB.databases !== "function") {
    throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.UNSUPPORTED_ENVIRONMENT);
  }
  if (typeof clock !== "function") throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);

  async function listDatabases() {
    let databases;
    try {
      databases = await indexedDB.databases();
    } catch (error) {
      throw mapNativeError(error);
    }
    if (!Array.isArray(databases) || databases.some((entry) => !entry || typeof entry !== "object" || typeof entry.name !== "string")) {
      throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED);
    }
    return databases;
  }

  async function exists() {
    return (await listDatabases()).some((entry) => entry.name === VAULT_TRANSITION_CONTROL_DATABASE_NAME);
  }

  function open(allowCreation) {
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
        request = indexedDB.open(VAULT_TRANSITION_CONTROL_DATABASE_NAME, VAULT_TRANSITION_CONTROL_DATABASE_VERSION);
      } catch (error) {
        finish(reject, mapNativeError(error));
        return;
      }
      request.onblocked = () => finish(reject, repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_BLOCKED));
      request.onerror = () => finish(reject, upgradeError || mapNativeError(request.error));
      request.onupgradeneeded = (event) => {
        const database = request.result;
        const transaction = request.transaction;
        if (!allowCreation || event.oldVersion !== 0) {
          upgradeError = repositoryError(event.oldVersion === 0
            ? VAULT_REPOSITORY_ERROR_CODES.DATABASE_NOT_FOUND
            : VAULT_REPOSITORY_ERROR_CODES.DATABASE_VERSION_ERROR);
          try { transaction.abort(); } catch (_) {}
          try { database.close(); } catch (_) {}
          return;
        }
        try {
          database.createObjectStore(VAULT_TRANSITION_CONTROL_STORE);
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

  async function validateSchema(database) {
    const names = Array.from(database.objectStoreNames);
    if (names.length !== 1 || names[0] !== VAULT_TRANSITION_CONTROL_STORE) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_VERSION_ERROR);
    let transaction;
    try {
      transaction = database.transaction(VAULT_TRANSITION_CONTROL_STORE, "readonly");
      const store = transaction.objectStore(VAULT_TRANSITION_CONTROL_STORE);
      if (store.keyPath !== null || store.autoIncrement !== false || store.indexNames.length !== 0) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_VERSION_ERROR);
      await new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => {};
        transaction.onabort = () => reject(mapNativeError(transaction.error));
      });
    } catch (error) {
      if (transaction) {
        try { transaction.abort(); } catch (_) {}
      }
      if (error instanceof VaultRepositoryError) throw error;
      throw mapNativeError(error);
    }
  }

  async function openExisting() {
    if (!(await exists())) return null;
    const database = await open(false);
    try {
      await validateSchema(database);
      return database;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  return Object.freeze({
    async createActiveTransition(input) {
      requireExactShape(input, CREATE_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const transitionId = requireTransitionId(input.transitionId, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const workspaceTag = requireWorkspaceTag(input.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      let database;
      try {
        database = await open(true);
        await validateSchema(database);
        const transaction = database.transaction(VAULT_TRANSITION_CONTROL_STORE, "readwrite");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let result = null;
        let getRequest;
        try {
          getRequest = transaction.objectStore(VAULT_TRANSITION_CONTROL_STORE).get(VAULT_TRANSITION_CONTROL_ACTIVE_KEY);
          getRequest.onsuccess = () => {
            try {
              if (getRequest.result !== undefined) {
                validateTransition(getRequest.result);
                throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.CONFLICT);
              }
              const timestamp = clockTimestamp(clock);
              result = { version: 1, transitionId, workspaceTag, phase: "prepared", createdAt: timestamp, updatedAt: timestamp };
              const addRequest = transaction.objectStore(VAULT_TRANSITION_CONTROL_STORE).add(result, VAULT_TRANSITION_CONTROL_ACTIVE_KEY);
              addRequest.onerror = () => abortWith(transaction, state, addRequest.error);
            } catch (error) {
              abortWith(transaction, state, error);
            }
          };
          getRequest.onerror = () => abortWith(transaction, state, getRequest.error);
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        return cloneTransition(result);
      } finally {
        if (database) database.close();
      }
    },

    async readActiveTransition(input) {
      requireExactShape(input, READ_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      let database;
      try {
        database = await openExisting();
        if (!database) return null;
        const transaction = database.transaction(VAULT_TRANSITION_CONTROL_STORE, "readonly");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let result;
        let request;
        try {
          request = transaction.objectStore(VAULT_TRANSITION_CONTROL_STORE).get(VAULT_TRANSITION_CONTROL_ACTIVE_KEY);
          request.onsuccess = () => { result = request.result; };
          request.onerror = () => abortWith(transaction, state, request.error);
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        return result === undefined ? null : cloneTransition(validateTransition(result));
      } finally {
        if (database) database.close();
      }
    },

    async advanceActiveTransition(input) {
      requireExactShape(input, ADVANCE_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const transitionId = requireTransitionId(input.transitionId, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const workspaceTag = requireWorkspaceTag(input.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const expectedPhase = requirePhase(input.expectedPhase, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const nextPhase = requirePhase(input.nextPhase, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      if (NEXT_PHASE[expectedPhase] !== nextPhase) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      let database;
      try {
        database = await openExisting();
        if (!database) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_NOT_FOUND);
        const transaction = database.transaction(VAULT_TRANSITION_CONTROL_STORE, "readwrite");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let result = null;
        let getRequest;
        try {
          getRequest = transaction.objectStore(VAULT_TRANSITION_CONTROL_STORE).get(VAULT_TRANSITION_CONTROL_ACTIVE_KEY);
          getRequest.onsuccess = () => {
            if (getRequest.result === undefined) {
              abortWith(transaction, state, repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_NOT_FOUND));
              return;
            }
            try {
              const current = validateTransition(getRequest.result);
              if (current.transitionId !== transitionId || current.workspaceTag !== workspaceTag || current.phase !== expectedPhase) {
                throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.CONFLICT);
              }
              const updatedAt = clockTimestamp(clock, Date.parse(current.updatedAt) + 1);
              result = { ...current, phase: nextPhase, updatedAt };
              const putRequest = transaction.objectStore(VAULT_TRANSITION_CONTROL_STORE).put(result, VAULT_TRANSITION_CONTROL_ACTIVE_KEY);
              putRequest.onerror = () => abortWith(transaction, state, putRequest.error);
            } catch (error) {
              abortWith(transaction, state, error);
            }
          };
          getRequest.onerror = () => abortWith(transaction, state, getRequest.error);
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        return cloneTransition(result);
      } finally {
        if (database) database.close();
      }
    },

    async deleteActiveTransition(input) {
      requireExactShape(input, DELETE_FIELDS, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const transitionId = requireTransitionId(input.transitionId, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      const workspaceTag = requireWorkspaceTag(input.workspaceTag, VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      if (input.expectedPhase !== "authoritative") throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.INVALID_INPUT);
      let database;
      try {
        database = await openExisting();
        if (!database) throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_NOT_FOUND);
        const transaction = database.transaction(VAULT_TRANSITION_CONTROL_STORE, "readwrite");
        const state = { error: null };
        const completed = transactionCompletion(transaction, state);
        let deleted = false;
        let getRequest;
        try {
          getRequest = transaction.objectStore(VAULT_TRANSITION_CONTROL_STORE).get(VAULT_TRANSITION_CONTROL_ACTIVE_KEY);
          getRequest.onsuccess = () => {
            if (getRequest.result === undefined) {
              abortWith(transaction, state, repositoryError(VAULT_REPOSITORY_ERROR_CODES.DATABASE_NOT_FOUND));
              return;
            }
            try {
              const current = validateTransition(getRequest.result);
              if (current.transitionId !== transitionId || current.workspaceTag !== workspaceTag || current.phase !== "authoritative") {
                throw repositoryError(VAULT_REPOSITORY_ERROR_CODES.CONFLICT);
              }
              const deleteRequest = transaction.objectStore(VAULT_TRANSITION_CONTROL_STORE).delete(VAULT_TRANSITION_CONTROL_ACTIVE_KEY);
              deleteRequest.onerror = () => abortWith(transaction, state, deleteRequest.error);
              deleted = true;
            } catch (error) {
              abortWith(transaction, state, error);
            }
          };
          getRequest.onerror = () => abortWith(transaction, state, getRequest.error);
        } catch (error) {
          abortWith(transaction, state, error);
        }
        await completed;
        return deleted;
      } finally {
        if (database) database.close();
      }
    },
  });
}
