/* global globalThis */

export const VAULT_DEVICE_KEY_DATABASE = "estipaid-vault-device-keys-v1";
export const VAULT_DEVICE_KEY_STORE = "keys";
export const VAULT_DEVICE_KEY_DATABASE_VERSION = 1;

export const VAULT_DEVICE_KEY_ERROR_CODES = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  UNSUPPORTED_ENVIRONMENT: "UNSUPPORTED_ENVIRONMENT",
  STORAGE_OPERATION_FAILED: "STORAGE_OPERATION_FAILED",
  RECORD_CORRUPT: "RECORD_CORRUPT",
});

export class VaultDeviceKeyError extends Error {
  constructor(code) {
    const messages = {
      INVALID_INPUT: "Invalid device-key request.",
      UNSUPPORTED_ENVIRONMENT: "Secure device-key storage is unavailable.",
      STORAGE_OPERATION_FAILED: "Device-key storage operation failed.",
      RECORD_CORRUPT: "The stored device key could not be verified.",
    };
    if (!Object.prototype.hasOwnProperty.call(messages, code)) throw new TypeError("Unknown device-key error code.");
    super(messages[code]);
    this.name = "VaultDeviceKeyError";
    this.code = code;
  }
}

const WORKSPACE_TAG = /^[A-Za-z0-9_-]{43}$/;
const RECORD_FIELDS = Object.freeze(["version", "workspaceTag", "key", "createdAt"]);

function fail(code) {
  throw new VaultDeviceKeyError(code);
}

function requireWorkspaceTag(value) {
  if (typeof value !== "string" || !WORKSPACE_TAG.test(value)) fail(VAULT_DEVICE_KEY_ERROR_CODES.INVALID_INPUT);
  return value;
}

function cryptoApi(overrides) {
  const api = overrides?.crypto || globalThis.crypto;
  if (!api?.subtle || typeof api.subtle.generateKey !== "function") {
    fail(VAULT_DEVICE_KEY_ERROR_CODES.UNSUPPORTED_ENVIRONMENT);
  }
  return api;
}

function indexedDbApi(overrides) {
  const api = overrides?.indexedDB || globalThis.indexedDB;
  if (!api || typeof api.open !== "function") fail(VAULT_DEVICE_KEY_ERROR_CODES.UNSUPPORTED_ENVIRONMENT);
  return api;
}

function isCryptoKey(value) {
  if (!value || typeof value !== "object") return false;
  const ctor = typeof globalThis.CryptoKey === "function"
    ? globalThis.CryptoKey
    : (globalThis.crypto && typeof globalThis.crypto.CryptoKey === "function" ? globalThis.crypto.CryptoKey : null);
  if (ctor && !(value instanceof ctor)) return false;
  if (!ctor && Object.getPrototypeOf(value) === Object.prototype) return false;
  return value.type === "secret"
    && value.extractable === false
    && value.algorithm?.name === "AES-GCM"
    && value.algorithm?.length === 256
    && Array.isArray(value.usages)
    && value.usages.includes("encrypt")
    && value.usages.includes("decrypt");
}

function validateRecord(value, workspaceTag) {
  if (!value || typeof value !== "object") fail(VAULT_DEVICE_KEY_ERROR_CODES.RECORD_CORRUPT);
  const names = Object.getOwnPropertyNames(value);
  if (names.length !== RECORD_FIELDS.length || RECORD_FIELDS.some((field) => !names.includes(field))) {
    fail(VAULT_DEVICE_KEY_ERROR_CODES.RECORD_CORRUPT);
  }
  if (value.version !== 1 || value.workspaceTag !== workspaceTag || !isCryptoKey(value.key)) {
    fail(VAULT_DEVICE_KEY_ERROR_CODES.RECORD_CORRUPT);
  }
  if (typeof value.createdAt !== "string" || Number.isNaN(Date.parse(value.createdAt))) {
    fail(VAULT_DEVICE_KEY_ERROR_CODES.RECORD_CORRUPT);
  }
  return value.key;
}

function openDatabase(overrides) {
  const indexedDB = indexedDbApi(overrides);
  return new Promise((resolve, reject) => {
    let request;
    try {
      request = indexedDB.open(VAULT_DEVICE_KEY_DATABASE, VAULT_DEVICE_KEY_DATABASE_VERSION);
    } catch (_) {
      reject(new VaultDeviceKeyError(VAULT_DEVICE_KEY_ERROR_CODES.STORAGE_OPERATION_FAILED));
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(VAULT_DEVICE_KEY_STORE)) {
        db.createObjectStore(VAULT_DEVICE_KEY_STORE, { keyPath: "workspaceTag" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new VaultDeviceKeyError(VAULT_DEVICE_KEY_ERROR_CODES.STORAGE_OPERATION_FAILED));
    request.onblocked = () => reject(new VaultDeviceKeyError(VAULT_DEVICE_KEY_ERROR_CODES.STORAGE_OPERATION_FAILED));
  });
}

function runRequest(db, mode, operation) {
  return new Promise((resolve, reject) => {
    let transaction;
    let request;
    try {
      transaction = db.transaction(VAULT_DEVICE_KEY_STORE, mode);
      request = operation(transaction.objectStore(VAULT_DEVICE_KEY_STORE));
    } catch (_) {
      reject(new VaultDeviceKeyError(VAULT_DEVICE_KEY_ERROR_CODES.STORAGE_OPERATION_FAILED));
      return;
    }
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => {};
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || request.error || new VaultDeviceKeyError(VAULT_DEVICE_KEY_ERROR_CODES.STORAGE_OPERATION_FAILED));
    transaction.onabort = () => reject(transaction.error || request.error || new VaultDeviceKeyError(VAULT_DEVICE_KEY_ERROR_CODES.STORAGE_OPERATION_FAILED));
  });
}

async function readRecord(workspaceTag, overrides) {
  const db = await openDatabase(overrides);
  try {
    return await runRequest(db, "readonly", (store) => store.get(workspaceTag));
  } finally {
    db.close();
  }
}

async function addRecord(record, overrides) {
  const db = await openDatabase(overrides);
  try {
    await runRequest(db, "readwrite", (store) => store.add(record));
  } finally {
    db.close();
  }
}

async function deleteRecord(workspaceTag, overrides) {
  const db = await openDatabase(overrides);
  try {
    await runRequest(db, "readwrite", (store) => store.delete(workspaceTag));
  } finally {
    db.close();
  }
}

async function generateDeviceKey(overrides) {
  try {
    return await cryptoApi(overrides).subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  } catch (_) {
    fail(VAULT_DEVICE_KEY_ERROR_CODES.UNSUPPORTED_ENVIRONMENT);
  }
}

function isConstraintFailure(error) {
  return error?.name === "ConstraintError" || error?.cause?.name === "ConstraintError";
}

export function createVaultDeviceKeyStore(overrides = {}) {
  return Object.freeze({
    async read({ workspaceTag } = {}) {
      const tag = requireWorkspaceTag(workspaceTag);
      const record = await readRecord(tag, overrides);
      return record == null ? null : validateRecord(record, tag);
    },

    async getOrCreate({ workspaceTag } = {}) {
      const tag = requireWorkspaceTag(workspaceTag);
      const existing = await readRecord(tag, overrides);
      if (existing != null) return validateRecord(existing, tag);

      const key = await generateDeviceKey(overrides);
      const record = {
        version: 1,
        workspaceTag: tag,
        key,
        createdAt: new Date().toISOString(),
      };
      try {
        await addRecord(record, overrides);
        return key;
      } catch (error) {
        if (!isConstraintFailure(error)) {
          if (error instanceof VaultDeviceKeyError) throw error;
          throw new VaultDeviceKeyError(VAULT_DEVICE_KEY_ERROR_CODES.STORAGE_OPERATION_FAILED);
        }
        const winner = await readRecord(tag, overrides);
        if (winner == null) fail(VAULT_DEVICE_KEY_ERROR_CODES.STORAGE_OPERATION_FAILED);
        return validateRecord(winner, tag);
      }
    },

    async remove({ workspaceTag } = {}) {
      const tag = requireWorkspaceTag(workspaceTag);
      await deleteRecord(tag, overrides);
      return true;
    },
  });
}
