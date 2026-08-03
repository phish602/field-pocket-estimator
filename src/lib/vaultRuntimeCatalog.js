/* global globalThis */

// ISO-16 -- the authoritative runtime catalog codec.
//
// The catalog describes the CURRENT authoritative encrypted record set for one
// workspace. It is deliberately separate from the frozen migration manifest:
// the manifest is historical evidence of the migration SOURCE generation and is
// never rewritten by a normal business write, while this catalog advances with
// every authoritative mutation.
//
// The catalog is always encrypted under the active workspace DEK with a
// runtime-specific AAD that binds the workspace identity, the runtime schema
// version, and the runtime generation. It never contains a plaintext business
// value, a user id, a company id, a password, a KEK, a DEK, or a token.

import { decryptBytes, encryptBytes, runtimeCatalogAad } from "./vaultCrypto";
import { VAULT_MIGRATION_LOGICAL_KEYS } from "./vaultIndexedDbRepository";

export const RUNTIME_CATALOG_VERSION = 1;
export const RUNTIME_SCHEMA_VERSION = 1;
export const VAULT_FORMAT_VERSION = 1;

const DIGEST = /^[A-Za-z0-9_-]{43}$/;
const BLOB_ID = /^[A-Za-z0-9_-]{22}$/;
const ENTRY_FIELDS = ["blobId", "byteLength", "digest", "key", "revision"];
const CATALOG_FIELDS = ["catalogRevision", "entries", "runtimeGeneration", "version"];
// The revision is bound into the AAD as an unsigned 32-bit integer, so that is
// the exact ceiling. Reaching it blocks with a stable code instead of wrapping.
const MAX_CATALOG_REVISION = 0xffffffff;
const APPROVED = new Set(VAULT_MIGRATION_LOGICAL_KEYS);

export class VaultRuntimeCatalogError extends Error {
  constructor(code) {
    super("The authoritative local runtime could not be verified.");
    this.name = "VaultRuntimeCatalogError";
    this.code = code;
  }
}

const base64urlAlphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

export function base64url(bytes) {
  let value = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index];
    const b = index + 1 < bytes.length ? bytes[index + 1] : 0;
    const c = index + 2 < bytes.length ? bytes[index + 2] : 0;
    value += base64urlAlphabet[a >> 2];
    value += base64urlAlphabet[((a & 3) << 4) | (b >> 4)];
    if (index + 1 < bytes.length) value += base64urlAlphabet[((b & 15) << 2) | (c >> 6)];
    if (index + 2 < bytes.length) value += base64urlAlphabet[c & 63];
  }
  return value;
}

export function utf8Bytes(value) {
  return new Uint8Array(new TextEncoder().encode(value));
}

export async function digestBytes(bytes) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== "function") throw new VaultRuntimeCatalogError("UNSUPPORTED_ENVIRONMENT");
  return base64url(new Uint8Array(await subtle.digest("SHA-256", bytes)));
}

export function randomBlobId() {
  const cryptoApi = globalThis.crypto;
  if (!cryptoApi || typeof cryptoApi.getRandomValues !== "function") throw new VaultRuntimeCatalogError("UNSUPPORTED_ENVIRONMENT");
  const bytes = new Uint8Array(16);
  cryptoApi.getRandomValues(bytes);
  return base64url(bytes);
}

// Exact-shape validation. Anything unexpected is a hard failure: a runtime that
// cannot be verified exactly must never be hydrated.
export function exactRuntimeCatalog(value, { runtimeGeneration, catalogRevision } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return null;
  if (Object.keys(value).sort().join(",") !== CATALOG_FIELDS.join(",")) return null;
  if (value.version !== RUNTIME_CATALOG_VERSION) return null;
  if (!Number.isSafeInteger(value.runtimeGeneration) || value.runtimeGeneration < 1) return null;
  if (runtimeGeneration !== undefined && value.runtimeGeneration !== runtimeGeneration) return null;
  // The catalog's own revision is part of its authenticated plaintext, so an
  // older envelope cannot be replayed under a newer persisted wrapper revision.
  if (!Number.isSafeInteger(value.catalogRevision) || value.catalogRevision < 1 || value.catalogRevision > MAX_CATALOG_REVISION) return null;
  if (catalogRevision !== undefined && value.catalogRevision !== catalogRevision) return null;
  if (!Array.isArray(value.entries)) return null;

  const seen = new Set();
  const entries = [];
  for (const entry of value.entries) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || Object.getPrototypeOf(entry) !== Object.prototype) return null;
    if (Object.keys(entry).sort().join(",") !== ENTRY_FIELDS.join(",")) return null;
    if (typeof entry.key !== "string" || !APPROVED.has(entry.key) || seen.has(entry.key)) return null;
    if (!Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0) return null;
    if (typeof entry.digest !== "string" || !DIGEST.test(entry.digest)) return null;
    if (typeof entry.blobId !== "string" || !BLOB_ID.test(entry.blobId)) return null;
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 1) return null;
    seen.add(entry.key);
    entries.push(Object.freeze({ ...entry }));
  }
  // Deterministic ordering so two byte-identical catalogs always serialize the
  // same way regardless of mutation history.
  entries.sort((left, right) => (left.key < right.key ? -1 : left.key > right.key ? 1 : 0));
  return Object.freeze({
    version: RUNTIME_CATALOG_VERSION,
    runtimeGeneration: value.runtimeGeneration,
    catalogRevision: value.catalogRevision,
    entries: Object.freeze(entries),
  });
}

export function buildRuntimeCatalog({ runtimeGeneration, catalogRevision, entries }) {
  if (!Number.isSafeInteger(catalogRevision) || catalogRevision < 1 || catalogRevision >= MAX_CATALOG_REVISION) {
    throw new VaultRuntimeCatalogError("CATALOG_REVISION_INVALID");
  }
  const catalog = exactRuntimeCatalog({
    version: RUNTIME_CATALOG_VERSION,
    runtimeGeneration,
    catalogRevision,
    entries: entries.map((entry) => ({
      key: entry.key,
      blobId: entry.blobId,
      byteLength: entry.byteLength,
      digest: entry.digest,
      revision: entry.revision,
    })),
  }, { runtimeGeneration, catalogRevision });
  if (!catalog) throw new VaultRuntimeCatalogError("CATALOG_INVALID");
  return catalog;
}

function aadFor({ userId, companyId, runtimeGeneration, catalogRevision }) {
  return runtimeCatalogAad({
    vaultFormatVersion: VAULT_FORMAT_VERSION,
    userId,
    companyId,
    runtimeSchemaVersion: RUNTIME_SCHEMA_VERSION,
    runtimeGeneration,
    catalogRevision,
  });
}

export async function encryptRuntimeCatalog({ dek, userId, companyId, catalog }) {
  let plain = null;
  try {
    plain = utf8Bytes(JSON.stringify(catalog));
    return await encryptBytes(dek, plain, aadFor({
      userId, companyId,
      runtimeGeneration: catalog.runtimeGeneration,
      catalogRevision: catalog.catalogRevision,
    }));
  } catch (error) {
    if (error instanceof VaultRuntimeCatalogError) throw error;
    throw new VaultRuntimeCatalogError("CATALOG_ENCRYPT_FAILED");
  } finally {
    if (plain) plain.fill(0);
    plain = null;
  }
}

export async function decryptRuntimeCatalog({ dek, userId, companyId, stored }) {
  if (!stored) throw new VaultRuntimeCatalogError("CATALOG_ABSENT");
  let plain = null;
  try {
    // The AAD binds the PERSISTED wrapper revision, and the exact-shape check
    // binds the plaintext revision to it. Plaintext revision, AAD revision, and
    // persisted wrapper revision must all agree exactly.
    plain = await decryptBytes(dek, stored.ciphertext, stored.iv, aadFor({
      userId, companyId,
      runtimeGeneration: stored.runtimeGeneration,
      catalogRevision: stored.revision,
    }));
    const parsed = JSON.parse(new TextDecoder().decode(plain));
    const catalog = exactRuntimeCatalog(parsed, {
      runtimeGeneration: stored.runtimeGeneration,
      catalogRevision: stored.revision,
    });
    if (!catalog) throw new VaultRuntimeCatalogError("CATALOG_INVALID");
    return catalog;
  } catch (error) {
    if (error instanceof VaultRuntimeCatalogError) throw error;
    throw new VaultRuntimeCatalogError("CATALOG_INVALID");
  } finally {
    if (plain) plain.fill(0);
    plain = null;
  }
}

// Sanitized description for diagnostics and evidence: counts only, never a key
// value, digest source, or identity.
export function describeRuntimeCatalog(catalog) {
  return Object.freeze({
    version: catalog.version,
    runtimeGeneration: catalog.runtimeGeneration,
    catalogRevision: catalog.catalogRevision,
    entryCount: catalog.entries.length,
    totalByteLength: catalog.entries.reduce((total, entry) => total + entry.byteLength, 0),
  });
}
