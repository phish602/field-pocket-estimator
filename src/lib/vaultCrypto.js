/* global globalThis */

import { argon2id } from "hash-wasm";

export const VaultCryptoErrorCode = Object.freeze({
  INVALID_INPUT: "INVALID_INPUT",
  UNSUPPORTED_ENVIRONMENT: "UNSUPPORTED_ENVIRONMENT",
  UNSUPPORTED_KDF_POLICY: "UNSUPPORTED_KDF_POLICY",
  CRYPTO_AUTHENTICATION_FAILED: "CRYPTO_AUTHENTICATION_FAILED",
  CRYPTO_OPERATION_FAILED: "CRYPTO_OPERATION_FAILED",
});

export class VaultCryptoError extends Error {
  constructor(code, message) { super(message); this.name = "VaultCryptoError"; this.code = code; }
}

export const PRODUCTION_KDF_PROFILE = Object.freeze({ algorithm: "argon2id", memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: "binary" });
export const TEST_ONLY_KDF_PROFILE = Object.freeze({ algorithm: "argon2id", memorySize: 8192, iterations: 1, parallelism: 1, hashLength: 32, outputType: "binary", testOnly: true });
// Internal fixed sentinel payload. Held as a frozen ordinary array so no mutable
// shared typed-array reference is ever exported: a caller cannot alter what
// future sentinels encrypt to, nor what verification compares against.
const VAULT_SENTINEL_VALUES = Object.freeze([
  0x45, 0x53, 0x54, 0x49,
  0x50, 0x41, 0x49, 0x44,
  0x2d, 0x56, 0x41, 0x55,
  0x4c, 0x54, 0x2d, 0x31,
]);
const createSentinelBytes = () => Uint8Array.from(VAULT_SENTINEL_VALUES);

// Vault format v1 Argon2id iteration bounds. The Production default stays at the
// minimum; the ceiling bounds a hostile or mistaken caller-supplied cost.
const MIN_KDF_ITERATIONS_V1 = 3;
const MAX_KDF_ITERATIONS_V1 = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const textEncoder = new TextEncoder();
let argon2Adapter = argon2id;
const fail = (code, message) => { throw new VaultCryptoError(code, message); };
const assertBytes = (value, name, length) => {
  if (!(value instanceof Uint8Array) || (length !== undefined && value.length !== length)) fail(VaultCryptoErrorCode.INVALID_INPUT, `Invalid ${name}.`);
  return value;
};
const cryptoApi = () => {
  const c = globalThis.crypto;
  if (!c || typeof c.getRandomValues !== "function" || !c.subtle) fail(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT, "Required browser cryptography is unavailable.");
  return c;
};
// A required Web Crypto method that is absent, null, or non-callable is an
// environment capability failure, never an operation or authentication failure.
// The method is resolved BEFORE the operation is attempted so a missing
// capability can never surface as a raw TypeError or be mistaken for a failed
// AES-GCM tag check.
const requireSubtleMethod = (methodName) => {
  const api = cryptoApi();
  const method = api.subtle[methodName];
  if (typeof method !== "function") fail(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT, "Required browser cryptography is unavailable.");
  return (...args) => method.apply(api.subtle, args);
};
const concat = (...items) => {
  const size = items.reduce((n, item) => n + item.length, 0);
  const output = new Uint8Array(size); let offset = 0;
  items.forEach((item) => { output.set(item, offset); offset += item.length; });
  return output;
};
const random = (length) => { const bytes = new Uint8Array(length); cryptoApi().getRandomValues(bytes); return bytes; };
const zero = (bytes) => { if (bytes instanceof Uint8Array) bytes.fill(0); };

export function setTestArgon2Adapter(adapter) {
  if (process.env.NODE_ENV !== "test" || typeof adapter !== "function") fail(VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY, "Unsupported KDF policy.");
  const previous = argon2Adapter;
  argon2Adapter = adapter;
  return () => { argon2Adapter = previous; };
}

export function encodeUint32(value) {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) fail(VaultCryptoErrorCode.INVALID_INPUT, "Invalid unsigned integer.");
  const bytes = new Uint8Array(4); new DataView(bytes.buffer).setUint32(0, value, false); return bytes;
}
export function encodeText(value) {
  if (typeof value !== "string") fail(VaultCryptoErrorCode.INVALID_INPUT, "Invalid text.");
  const bytes = textEncoder.encode(value); return concat(encodeUint32(bytes.length), bytes);
}
export function canonicalUuid(value) {
  if (typeof value !== "string" || !UUID.test(value)) fail(VaultCryptoErrorCode.INVALID_INPUT, "Invalid UUID.");
  return value.toLowerCase();
}
const identities = (userId, companyId) => [canonicalUuid(userId), canonicalUuid(companyId)];
const base64url = (bytes) => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  let output = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    output += alphabet[a >> 2];
    output += alphabet[((a & 3) << 4) | (b >> 4)];
    if (i + 1 < bytes.length) output += alphabet[((b & 15) << 2) | (c >> 6)];
    if (i + 2 < bytes.length) output += alphabet[c & 63];
  }
  return output;
};
export async function workspaceTag(userId, companyId) {
  const [user, company] = identities(userId, companyId);
  const digestMethod = requireSubtleMethod("digest");
  let digest;
  try { digest = await digestMethod("SHA-256", concat(encodeText("estipaid-vault-workspace-v1"), encodeText(user), encodeText(company))); }
  catch (_) { fail(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed."); }
  return base64url(new Uint8Array(digest));
}
// Asserted before any destructuring so a missing, null, array, or primitive
// options container fails as a stable INVALID_INPUT rather than a native
// destructuring TypeError.
const assertOptions = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(VaultCryptoErrorCode.INVALID_INPUT, "Invalid options.");
  return value;
};
export function recordAad(options) {
  const { vaultFormatVersion, userId, companyId, logicalStorageKey, blobIdentifier, recordSchemaVersion } = assertOptions(options);
  const [user, company] = identities(userId, companyId);
  return concat(encodeText("estipaid-vault-record-v1"), encodeUint32(vaultFormatVersion), encodeText(user), encodeText(company), encodeText(logicalStorageKey), encodeText(blobIdentifier), encodeUint32(recordSchemaVersion));
}
export function keyWrapAad(options) {
  const { vaultFormatVersion, userId, companyId, kdfVersion } = assertOptions(options);
  const [user, company] = identities(userId, companyId);
  return concat(encodeText("estipaid-vault-key-wrap-v1"), encodeUint32(vaultFormatVersion), encodeText(user), encodeText(company), encodeUint32(kdfVersion));
}
export function sentinelAad(options) {
  const { vaultFormatVersion, userId, companyId, sentinelSchemaVersion } = assertOptions(options);
  const [user, company] = identities(userId, companyId);
  return concat(encodeText("estipaid-vault-sentinel-v1"), encodeUint32(vaultFormatVersion), encodeText(user), encodeText(company), encodeUint32(sentinelSchemaVersion));
}
export function migrationManifestAad(options) {
  const { vaultFormatVersion, userId, companyId, transitionId, manifestSchemaVersion } = assertOptions(options);
  const [user, company] = identities(userId, companyId);
  return concat(encodeText("estipaid-vault-migration-manifest-v1"), encodeUint32(vaultFormatVersion), encodeText(user), encodeText(company), encodeText(transitionId), encodeUint32(manifestSchemaVersion));
}
export function validateKdfParameters(params) {
  if (!params || params.algorithm !== "argon2id" || params.outputType !== "binary" || params.hashLength !== 32 || !Number.isInteger(params.memorySize) || !Number.isInteger(params.iterations) || params.parallelism !== 1 || params.memorySize < 65536 || params.memorySize > 131072 || params.iterations < MIN_KDF_ITERATIONS_V1 || params.iterations > MAX_KDF_ITERATIONS_V1) fail(VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY, "Unsupported KDF policy.");
  return Object.freeze({ algorithm: "argon2id", memorySize: params.memorySize, iterations: params.iterations, parallelism: params.parallelism, hashLength: 32, outputType: "binary" });
}
export async function deriveKek(password, salt, params = PRODUCTION_KDF_PROFILE) {
  assertBytes(password, "password"); assertBytes(salt, "salt", 32); cryptoApi();
  const policy = validateKdfParameters(params);
  const importKey = requireSubtleMethod("importKey");
  let derived;
  try { derived = await argon2Adapter({ password, salt, memorySize: policy.memorySize, iterations: policy.iterations, parallelism: policy.parallelism, hashLength: 32, outputType: "binary" }); }
  catch (_) { fail(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed."); }
  if (!(derived instanceof Uint8Array) || derived.length !== 32) { zero(derived); fail(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed."); }
  try { return await importKey("raw", derived, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
  catch (_) { fail(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed."); }
  finally { zero(derived); }
}
// Prefer a real brand check. `globalThis.CryptoKey` is absent in some runtimes
// (Node 16 exposes it only on the Web Crypto object), so the constructor is
// looked up in both places before falling back.
const cryptoKeyConstructor = () => {
  if (typeof globalThis.CryptoKey === "function") return globalThis.CryptoKey;
  const api = globalThis.crypto;
  if (api && typeof api.CryptoKey === "function") return api.CryptoKey;
  return null;
};
// Narrowest portable fallback when no constructor is reachable: an ordinary
// structural object literal has Object.prototype, a host CryptoKey does not.
const isCryptoKeyInstance = (key) => {
  const Ctor = cryptoKeyConstructor();
  if (Ctor) return key instanceof Ctor;
  const proto = Object.getPrototypeOf(key);
  return Boolean(proto) && proto !== Object.prototype;
};
const assertKey = (key) => {
  if (!key || typeof key !== "object" || !isCryptoKeyInstance(key) || key.type !== "secret" || key.extractable || key.algorithm?.name !== "AES-GCM" || key.algorithm?.length !== 256 || !key.usages?.includes("encrypt") || !key.usages?.includes("decrypt")) fail(VaultCryptoErrorCode.INVALID_INPUT, "Invalid AES key.");
};
export async function encryptBytes(key, plaintext, aad) {
  assertKey(key); assertBytes(plaintext, "plaintext"); assertBytes(aad, "AAD");
  const encrypt = requireSubtleMethod("encrypt"); const iv = random(12);
  try { const ciphertext = new Uint8Array(await encrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, plaintext)); return { ciphertext, iv }; }
  catch (_) { fail(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed."); }
}
async function decryptRaw(key, ciphertext, iv, aad, record) {
  assertKey(key); assertBytes(ciphertext, "ciphertext"); assertBytes(iv, "IV", 12); assertBytes(aad, "AAD");
  // Resolved before the attempt: an absent decrypt is an environment failure,
  // so only a real AES-GCM tag check can reach the authentication boundary.
  const decrypt = requireSubtleMethod("decrypt");
  try { return new Uint8Array(await decrypt({ name: "AES-GCM", iv, additionalData: aad, tagLength: 128 }, key, ciphertext)); }
  catch (error) {
    // Only a real AES-GCM authentication attempt raises OperationError. Wrong
    // key, modified ciphertext/IV/AAD, and truncated envelopes all land here and
    // stay indistinguishable. Any other rejection is an operation failure. The
    // raw error is never re-exposed and never attached as `cause`.
    if (error && error.name === "OperationError") fail(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED, record ? "Record authentication failed." : "Authentication failed.");
    fail(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed.");
  }
}
export async function deriveTestOnlyKek(password, salt, params = TEST_ONLY_KDF_PROFILE) {
  if (process.env.NODE_ENV !== "test") fail(VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY, "Unsupported KDF policy.");
  assertBytes(password, "password"); assertBytes(salt, "salt", 32); cryptoApi();
  if (!params || params.algorithm !== "argon2id" || params.memorySize !== 8192 || params.iterations !== 1 || params.parallelism !== 1 || params.hashLength !== 32 || params.outputType !== "binary") fail(VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY, "Unsupported KDF policy.");
  const testImportKey = requireSubtleMethod("importKey");
  let derived;
  try { derived = await argon2Adapter({ password, salt, memorySize: 8192, iterations: 1, parallelism: 1, hashLength: 32, outputType: "binary" }); }
  catch (_) { fail(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed."); }
  if (!(derived instanceof Uint8Array) || derived.length !== 32) { zero(derived); fail(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed."); }
  try { return await testImportKey("raw", derived, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
  catch (_) { fail(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed."); }
  finally { zero(derived); }
}
export const decryptBytes = (key, ciphertext, iv, aad) => decryptRaw(key, ciphertext, iv, aad, true);
const importDek = async (raw) => {
  const importKey = requireSubtleMethod("importKey");
  try { return await importKey("raw", raw, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]); }
  catch (_) { fail(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED, "Cryptographic operation failed."); }
};
export async function generateDek() {
  const raw = random(32);
  try { return await importDek(raw); }
  finally { zero(raw); }
}
export async function createWrappedDek(kek, wrapAad) {
  assertKey(kek); assertBytes(wrapAad, "AAD"); const raw = random(32);
  try { const dek = await importDek(raw); assertKey(dek); const wrapped = await encryptBytes(kek, raw, wrapAad); return { dek, wrappedDek: wrapped.ciphertext, wrapIv: wrapped.iv }; }
  finally { zero(raw); }
}
async function unwrapRawDek(kek, wrappedDek, wrapIv, wrapAad) { const raw = await decryptRaw(kek, wrappedDek, wrapIv, wrapAad, false); if (raw.length !== 32) { zero(raw); fail(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED, "Authentication failed."); } return raw; }
export async function unwrapDek(kek, wrappedDek, wrapIv, wrapAad) { const raw = await unwrapRawDek(kek, wrappedDek, wrapIv, wrapAad); try { return await importDek(raw); } finally { zero(raw); } }
export async function rotateWrappedDek(oldKek, newKek, wrappedDek, wrapIv, oldWrapAad, newWrapAad) { const raw = await unwrapRawDek(oldKek, wrappedDek, wrapIv, oldWrapAad); try { const wrapped = await encryptBytes(newKek, raw, newWrapAad); return { wrappedDek: wrapped.ciphertext, wrapIv: wrapped.iv }; } finally { zero(raw); } }
export const createSentinel = (dek, aad) => encryptBytes(dek, createSentinelBytes(), aad);
export async function verifySentinel(dek, ciphertext, iv, aad) { const value = await decryptRaw(dek, ciphertext, iv, aad, false); try { if (value.length !== VAULT_SENTINEL_VALUES.length || value.some((b, i) => b !== VAULT_SENTINEL_VALUES[i])) fail(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED, "Authentication failed."); return true; } finally { zero(value); } }
