import {
  RUNTIME_CATALOG_VERSION,
  VaultRuntimeCatalogError,
  buildRuntimeCatalog,
  decryptRuntimeCatalog,
  describeRuntimeCatalog,
  digestBytes,
  encryptRuntimeCatalog,
  exactRuntimeCatalog,
  randomBlobId,
  utf8Bytes,
} from "./vaultRuntimeCatalog";
import { runtimeCatalogAad, migrationManifestAad } from "./vaultCrypto";
import { VAULT_MIGRATION_LOGICAL_KEYS } from "./vaultIndexedDbRepository";

const USER = "11111111-2222-4333-8444-555555555555";
const COMPANY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

beforeAll(() => {
  if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto;
});

async function testDek() {
  return globalThis.crypto.subtle.importKey("raw", new Uint8Array(32).fill(9), { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function entry(key, value, revision = 1) {
  const bytes = utf8Bytes(value);
  return { key, blobId: randomBlobId(), byteLength: bytes.length, digest: await digestBytes(bytes), revision };
}

test("a catalog round-trips through real AES-GCM under the runtime AAD", async () => {
  const dek = await testDek();
  const catalog = buildRuntimeCatalog({ runtimeGeneration: 1, entries: [await entry("estipaid-customers-v1", "synthetic")] });
  const envelope = await encryptRuntimeCatalog({ dek, userId: USER, companyId: COMPANY, catalog });
  expect(envelope.iv).toHaveLength(12);
  const decoded = await decryptRuntimeCatalog({
    dek, userId: USER, companyId: COMPANY,
    stored: { ciphertext: envelope.ciphertext, iv: envelope.iv, runtimeGeneration: 1, revision: 1 },
  });
  expect(decoded).toEqual(catalog);
});

test("the runtime AAD is distinct from the migration manifest AAD", () => {
  const runtime = runtimeCatalogAad({ vaultFormatVersion: 1, userId: USER, companyId: COMPANY, runtimeSchemaVersion: 1, runtimeGeneration: 1 });
  const manifest = migrationManifestAad({ vaultFormatVersion: 1, userId: USER, companyId: COMPANY, transitionId: "123e4567-e89b-42d3-a456-426614174000", manifestSchemaVersion: 1 });
  expect(Array.from(runtime)).not.toEqual(Array.from(manifest));
});

test("a catalog encrypted for one workspace cannot be decrypted for another", async () => {
  const dek = await testDek();
  const catalog = buildRuntimeCatalog({ runtimeGeneration: 1, entries: [await entry("estipaid-customers-v1", "synthetic")] });
  const envelope = await encryptRuntimeCatalog({ dek, userId: USER, companyId: COMPANY, catalog });
  await expect(decryptRuntimeCatalog({
    dek, userId: "99999999-8888-4777-8666-555555555555", companyId: COMPANY,
    stored: { ciphertext: envelope.ciphertext, iv: envelope.iv, runtimeGeneration: 1, revision: 1 },
  })).rejects.toBeInstanceOf(VaultRuntimeCatalogError);
});

test("a catalog bound to one runtime generation cannot be replayed under another", async () => {
  const dek = await testDek();
  const catalog = buildRuntimeCatalog({ runtimeGeneration: 1, entries: [await entry("estipaid-customers-v1", "synthetic")] });
  const envelope = await encryptRuntimeCatalog({ dek, userId: USER, companyId: COMPANY, catalog });
  await expect(decryptRuntimeCatalog({
    dek, userId: USER, companyId: COMPANY,
    stored: { ciphertext: envelope.ciphertext, iv: envelope.iv, runtimeGeneration: 2, revision: 1 },
  })).rejects.toBeInstanceOf(VaultRuntimeCatalogError);
});

test("entries are deterministically ordered regardless of mutation order", async () => {
  const forward = buildRuntimeCatalog({ runtimeGeneration: 1, entries: [
    await entry("estipaid-customers-v1", "a"), await entry("estipaid-projects-v1", "b"),
  ] });
  const reverse = buildRuntimeCatalog({ runtimeGeneration: 1, entries: [
    { ...forward.entries.find((e) => e.key === "estipaid-projects-v1") },
    { ...forward.entries.find((e) => e.key === "estipaid-customers-v1") },
  ] });
  expect(reverse.entries.map((e) => e.key)).toEqual(forward.entries.map((e) => e.key));
});

test("exact-shape validation rejects every malformed catalog", async () => {
  const good = buildRuntimeCatalog({ runtimeGeneration: 1, entries: [await entry("estipaid-customers-v1", "x")] });
  expect(exactRuntimeCatalog(JSON.parse(JSON.stringify(good)))).not.toBeNull();

  const mutate = (fn) => { const copy = JSON.parse(JSON.stringify(good)); fn(copy); return exactRuntimeCatalog(copy); };
  expect(mutate((c) => { c.version = 2; })).toBeNull();
  expect(mutate((c) => { delete c.version; })).toBeNull();
  expect(mutate((c) => { c.extra = 1; })).toBeNull();
  expect(mutate((c) => { c.entries = {}; })).toBeNull();
  expect(mutate((c) => { c.runtimeGeneration = 0; })).toBeNull();
  expect(mutate((c) => { c.entries[0].key = "estipaid-not-approved-v1"; })).toBeNull();
  expect(mutate((c) => { c.entries.push({ ...c.entries[0] }); })).toBeNull();
  expect(mutate((c) => { c.entries[0].digest = "short"; })).toBeNull();
  expect(mutate((c) => { c.entries[0].blobId = "short"; })).toBeNull();
  expect(mutate((c) => { c.entries[0].byteLength = -1; })).toBeNull();
  expect(mutate((c) => { c.entries[0].revision = 0; })).toBeNull();
  expect(mutate((c) => { c.entries[0].unexpected = true; })).toBeNull();
  expect(mutate((c) => { delete c.entries[0].digest; })).toBeNull();
  expect(exactRuntimeCatalog(null)).toBeNull();
  expect(exactRuntimeCatalog([])).toBeNull();
});

test("every approved logical key is representable in a catalog", async () => {
  const entries = [];
  for (const key of VAULT_MIGRATION_LOGICAL_KEYS) entries.push(await entry(key, `synthetic-${key}`));
  const catalog = buildRuntimeCatalog({ runtimeGeneration: 1, entries });
  expect(catalog.entries).toHaveLength(VAULT_MIGRATION_LOGICAL_KEYS.length);
  expect(catalog.version).toBe(RUNTIME_CATALOG_VERSION);
});

test("a present-empty value is representable and distinct from an absent key", async () => {
  const empty = await entry("estipaid-settings-v1", "");
  expect(empty.byteLength).toBe(0);
  const catalog = buildRuntimeCatalog({ runtimeGeneration: 1, entries: [empty] });
  expect(catalog.entries[0].byteLength).toBe(0);
  expect(catalog.entries.some((e) => e.key === "estipaid-customers-v1")).toBe(false);
});

test("the sanitized description exposes no key name, digest source, or identity", async () => {
  const catalog = buildRuntimeCatalog({ runtimeGeneration: 3, entries: [await entry("estipaid-customers-v1", "synthetic-secret-value")] });
  const described = describeRuntimeCatalog(catalog);
  expect(Object.keys(described).sort()).toEqual(["entryCount", "runtimeGeneration", "totalByteLength", "version"]);
  const serialized = JSON.stringify(described);
  expect(serialized).not.toContain("synthetic-secret-value");
  expect(serialized).not.toContain(USER);
  expect(serialized).not.toContain(COMPANY);
});

test("a corrupted catalog envelope never decodes", async () => {
  const dek = await testDek();
  const catalog = buildRuntimeCatalog({ runtimeGeneration: 1, entries: [await entry("estipaid-customers-v1", "x")] });
  const envelope = await encryptRuntimeCatalog({ dek, userId: USER, companyId: COMPANY, catalog });
  const damaged = new Uint8Array(envelope.ciphertext);
  damaged[0] ^= 0xff;
  await expect(decryptRuntimeCatalog({
    dek, userId: USER, companyId: COMPANY,
    stored: { ciphertext: damaged, iv: envelope.iv, runtimeGeneration: 1, revision: 1 },
  })).rejects.toBeInstanceOf(VaultRuntimeCatalogError);
});
