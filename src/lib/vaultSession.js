/* global globalThis */

import {
  PRODUCTION_KDF_PROFILE,
  VaultCryptoError,
  VaultCryptoErrorCode,
  createSentinel,
  createWrappedDek,
  deriveKek,
  keyWrapAad,
  sentinelAad,
  unwrapDek,
  verifySentinel,
  workspaceTag,
} from "./vaultCrypto";
import {
  VaultRepositoryError,
  VAULT_REPOSITORY_ERROR_CODES,
  createVaultIndexedDbRepository,
} from "./vaultIndexedDbRepository";
import {
  VaultDeviceKeyError,
  VAULT_DEVICE_KEY_ERROR_CODES,
  createVaultDeviceKeyStore,
} from "./vaultDeviceKeyStore";

// The only unwrapped vault key lives in these module-private bindings. It is
// never exported, serialized, dispatched, or persisted as raw key material.
let activeWorkspaceTag = null;
let activeDek = null;

const STATES = new Set([
  "setup_required",
  "locked",
  "unlocking",
  "unlocked",
  "damaged",
  "unsupported",
  "reset_required",
]);

const AUTHENTICATION_CODE = "AUTHENTICATION_FAILED";
const AUTHENTICATION_MESSAGE = "The Local Data Password is incorrect or the local vault is damaged.";
const DAMAGED_MESSAGE = "The local vault is damaged.";
const DEVICE_KEY_RESET_MESSAGE = "This device can no longer open its local encrypted data. Restore from cloud backup or reset local data.";

function capability(state, code = "", message = "") {
  if (!STATES.has(state)) throw new Error("Invalid vault capability state.");
  return Object.freeze({ state, code, message });
}

function lockPrivateSession() {
  activeWorkspaceTag = null;
  activeDek = null;
}

function isTestOverrides(value) {
  return process.env.NODE_ENV === "test"
    && value
    && typeof value === "object"
    && Object.getPrototypeOf(value) === Object.prototype;
}

function repositoryFor(overrides) {
  if (isTestOverrides(overrides) && typeof overrides.repositoryFactory === "function") {
    return overrides.repositoryFactory();
  }
  return createVaultIndexedDbRepository();
}

function deviceKeyStoreFor(overrides) {
  if (isTestOverrides(overrides) && typeof overrides.deviceKeyStoreFactory === "function") {
    return overrides.deviceKeyStoreFactory();
  }
  return createVaultDeviceKeyStore();
}

function randomSalt(overrides) {
  if (isTestOverrides(overrides) && typeof overrides.randomBytes === "function") {
    const value = overrides.randomBytes(32);
    if (!(value instanceof Uint8Array) || value.length !== 32) {
      throw new VaultCryptoError(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed.");
    }
    return new Uint8Array(value);
  }
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") {
    throw new VaultCryptoError(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT, "Required browser cryptography is unavailable.");
  }
  const salt = new Uint8Array(32);
  cryptoApi.getRandomValues(salt);
  return salt;
}

function passwordBytes(password) {
  if (typeof password !== "string") {
    throw new VaultCryptoError(VaultCryptoErrorCode.INVALID_INPUT, "Invalid password.");
  }
  return new Uint8Array(new TextEncoder().encode(password.normalize("NFC")));
}

function zero(bytes) {
  if (bytes instanceof Uint8Array) bytes.fill(0);
}

function mapFailure(error) {
  if (error instanceof VaultDeviceKeyError) {
    if (error.code === VAULT_DEVICE_KEY_ERROR_CODES.UNSUPPORTED_ENVIRONMENT) {
      return capability("unsupported", error.code, error.message);
    }
    if (error.code === VAULT_DEVICE_KEY_ERROR_CODES.RECORD_CORRUPT) {
      return capability("reset_required", error.code, DEVICE_KEY_RESET_MESSAGE);
    }
    return capability("locked", error.code, "Vault storage operation failed.");
  }
  if (error instanceof VaultCryptoError) {
    if (error.code === VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED) {
      return capability("locked", AUTHENTICATION_CODE, AUTHENTICATION_MESSAGE);
    }
    if (error.code === VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT || error.code === VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY) {
      return capability("unsupported", error.code, error.message);
    }
    return capability("locked", error.code, error.message);
  }
  if (error instanceof VaultRepositoryError) {
    if (
      error.code === VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT
      || error.code === VAULT_REPOSITORY_ERROR_CODES.INVALID_SCHEMA
      || error.code === VAULT_REPOSITORY_ERROR_CODES.DATABASE_VERSION_ERROR
    ) {
      return capability("damaged", error.code, DAMAGED_MESSAGE);
    }
    if (error.code === VAULT_REPOSITORY_ERROR_CODES.UNSUPPORTED_ENVIRONMENT) {
      return capability("unsupported", error.code, error.message);
    }
    return capability("locked", error.code, error.message);
  }
  return capability("locked", VAULT_REPOSITORY_ERROR_CODES.STORAGE_OPERATION_FAILED, "Vault storage operation failed.");
}

async function inspectWorkspace(repository, tag) {
  const exists = await repository.workspaceDatabaseExists({ workspaceTag: tag });
  if (!exists) return { state: "setup_required", metadata: null };

  const metadata = await repository.readWorkspaceVaultMetadata({ workspaceTag: tag });
  if (metadata) return { state: "locked", metadata };

  const [recordKeys, manifest] = await Promise.all([
    repository.listEncryptedRecordKeys({ workspaceTag: tag }),
    repository.readMigrationManifest({ workspaceTag: tag }),
  ]);
  if (recordKeys.length > 0 || manifest !== null) {
    return { state: "damaged", metadata: null };
  }
  return { state: "setup_required", metadata: null };
}

function aadFor(metadata, userId, companyId) {
  return {
    wrap: keyWrapAad({
      vaultFormatVersion: metadata.version,
      userId,
      companyId,
      kdfVersion: metadata.kdfVersion,
    }),
    sentinel: sentinelAad({
      vaultFormatVersion: metadata.version,
      userId,
      companyId,
      sentinelSchemaVersion: metadata.sentinelSchemaVersion,
    }),
  };
}

async function verifyStoredMetadataWithKek({ metadata, userId, companyId, kek }) {
  let dek = null;
  const aad = aadFor(metadata, userId, companyId);
  dek = await unwrapDek(kek, metadata.wrappedDekCiphertext, metadata.wrappedDekIv, aad.wrap);
  await verifySentinel(dek, metadata.sentinelCiphertext, metadata.sentinelIv, aad.sentinel);
  return dek;
}

async function verifyStoredMetadata({ metadata, userId, companyId, bytes }) {
  let kek = null;
  try {
    kek = await deriveKek(bytes, metadata.salt, metadata.kdfParameters);
    return await verifyStoredMetadataWithKek({ metadata, userId, companyId, kek });
  } finally {
    kek = null;
  }
}

function installSession(tag, dek) {
  activeWorkspaceTag = tag;
  activeDek = dek;
}

export async function deriveWorkspaceVaultTag(userId, companyId) {
  return workspaceTag(userId, companyId);
}

export async function readVaultCapability({ userId, companyId } = {}, overrides) {
  try {
    const tag = await deriveWorkspaceVaultTag(userId, companyId);
    if (activeWorkspaceTag === tag && activeDek) return capability("unlocked");
    const inspected = await inspectWorkspace(repositoryFor(overrides), tag);
    if (inspected.state === "damaged") return capability("damaged", VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT, DAMAGED_MESSAGE);
    return capability(inspected.state);
  } catch (error) {
    return mapFailure(error);
  }
}

export async function setupVault({ userId, companyId, password } = {}, overrides) {
  lockPrivateSession();
  const passwordMode = typeof password === "string";
  let bytes = null;
  let kek = null;
  let generatedDek = null;
  let verifiedDek = null;
  try {
    const tag = await deriveWorkspaceVaultTag(userId, companyId);
    const repository = repositoryFor(overrides);
    const inspected = await inspectWorkspace(repository, tag);
    if (inspected.state === "damaged") return capability("damaged", VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT, DAMAGED_MESSAGE);
    if (inspected.state !== "setup_required") {
      return capability("locked", VAULT_REPOSITORY_ERROR_CODES.CONFLICT, "Vault metadata already exists.");
    }

    const salt = randomSalt(overrides);
    if (passwordMode) {
      bytes = passwordBytes(password);
      kek = await deriveKek(bytes, salt, PRODUCTION_KDF_PROFILE);
    } else {
      kek = await deviceKeyStoreFor(overrides).getOrCreate({ workspaceTag: tag });
    }

    const metadataShape = { version: 1, kdfVersion: 1, sentinelSchemaVersion: 1 };
    const aad = aadFor(metadataShape, userId, companyId);
    const wrapped = await createWrappedDek(kek, aad.wrap);
    generatedDek = wrapped.dek;
    const sentinel = await createSentinel(generatedDek, aad.sentinel);

    try {
      await repository.createWorkspaceVaultMetadata({
        workspaceTag: tag,
        expectedRevision: null,
        kdfVersion: 1,
        kdfParameters: { ...PRODUCTION_KDF_PROFILE },
        salt,
        wrappedDekCiphertext: wrapped.wrappedDek,
        wrappedDekIv: wrapped.wrapIv,
        sentinelSchemaVersion: 1,
        sentinelCiphertext: sentinel.ciphertext,
        sentinelIv: sentinel.iv,
      });
    } catch (error) {
      // Two tabs can both observe an empty workspace. The device-key store makes
      // them converge on the same non-extractable KEK, so the losing tab may
      // safely verify the winner's metadata instead of entering a retry loop.
      if (!passwordMode && error instanceof VaultRepositoryError && error.code === VAULT_REPOSITORY_ERROR_CODES.CONFLICT) {
        const winner = await repository.readWorkspaceVaultMetadata({ workspaceTag: tag });
        if (!winner) throw error;
        verifiedDek = await verifyStoredMetadataWithKek({ metadata: winner, userId, companyId, kek });
        installSession(tag, verifiedDek);
        verifiedDek = null;
        return capability("unlocked");
      }
      throw error;
    }

    const stored = await repository.readWorkspaceVaultMetadata({ workspaceTag: tag });
    if (!stored) throw new VaultRepositoryError(VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT);
    verifiedDek = passwordMode
      ? await verifyStoredMetadata({ metadata: stored, userId, companyId, bytes })
      : await verifyStoredMetadataWithKek({ metadata: stored, userId, companyId, kek });
    generatedDek = null;
    installSession(tag, verifiedDek);
    verifiedDek = null;
    return capability("unlocked");
  } catch (error) {
    lockPrivateSession();
    return mapFailure(error);
  } finally {
    zero(bytes);
    bytes = null;
    kek = null;
    generatedDek = null;
    verifiedDek = null;
  }
}

/**
 * Recovery-only creation entry point.
 *
 * The destructive recovery service may request a replacement vault, but the
 * actual creation primitive remains owned by this session module. Normal
 * runtime setup continues to flow through useVaultSession.
 */
export async function provisionReplacementVaultSession(
  { userId, companyId } = {},
  overrides
) {
  return setupVault({ userId, companyId }, overrides);
}

export async function unlockVault({ userId, companyId, password } = {}, overrides) {
  lockPrivateSession();
  const passwordMode = typeof password === "string";
  let bytes = null;
  let kek = null;
  let dek = null;
  try {
    const tag = await deriveWorkspaceVaultTag(userId, companyId);
    const inspected = await inspectWorkspace(repositoryFor(overrides), tag);
    if (inspected.state === "setup_required") return capability("setup_required");
    if (inspected.state === "damaged") return capability("damaged", VAULT_REPOSITORY_ERROR_CODES.RECORD_CORRUPT, DAMAGED_MESSAGE);

    if (passwordMode) {
      bytes = passwordBytes(password);
      dek = await verifyStoredMetadata({ metadata: inspected.metadata, userId, companyId, bytes });
    } else {
      kek = await deviceKeyStoreFor(overrides).read({ workspaceTag: tag });
      if (!kek) return capability("reset_required", "DEVICE_KEY_MISSING", DEVICE_KEY_RESET_MESSAGE);
      try {
        dek = await verifyStoredMetadataWithKek({ metadata: inspected.metadata, userId, companyId, kek });
      } catch (error) {
        if (error instanceof VaultCryptoError && error.code === VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED) {
          return capability("reset_required", "DEVICE_KEY_MISMATCH", DEVICE_KEY_RESET_MESSAGE);
        }
        throw error;
      }
    }

    installSession(tag, dek);
    dek = null;
    return capability("unlocked");
  } catch (error) {
    lockPrivateSession();
    return mapFailure(error);
  } finally {
    zero(bytes);
    bytes = null;
    kek = null;
    dek = null;
  }
}

export function lockVault() {
  lockPrivateSession();
  return capability("locked");
}

export function getVaultCapability() {
  return activeWorkspaceTag && activeDek ? capability("unlocked") : capability("locked");
}

export async function runWithActiveVaultDek({ workspaceTag: tag, operation } = {}) {
  if (typeof tag !== "string" || typeof operation !== "function") return null;
  if (activeWorkspaceTag !== tag || !activeDek) return null;
  return operation(activeDek);
}
