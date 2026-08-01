import { argon2id } from "hash-wasm";
import { VaultCryptoError, VaultCryptoErrorCode, TEST_ONLY_KDF_PROFILE, canonicalUuid, createSentinel, createWrappedDek, decryptBytes, deriveKek, deriveTestOnlyKek, encodeText, encodeUint32, encryptBytes, generateDek, keyWrapAad, migrationManifestAad, recordAad, rotateWrappedDek, sentinelAad, setTestArgon2Adapter, unwrapDek, validateKdfParameters, verifySentinel, workspaceTag } from "./vaultCrypto";

const u = "11111111-2222-4333-8444-555555555555";
const c = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const bytes = (...v) => new Uint8Array(v);
const salt = bytes(...Array.from({ length: 32 }, (_, i) => i + 1));
const password = bytes(1, 2, 3, 4, 5, 6, 7, 8);
const aad = keyWrapAad({ vaultFormatVersion: 1, userId: u, companyId: c, kdfVersion: 1 });
const expectCode = async (promise, code) => await expect(promise).rejects.toMatchObject({ code });

beforeAll(() => { if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto; });
const toHex = (value) => Array.from(value, (byte) => byte.toString(16).padStart(2, "0")).join("");

test("encodeUint32 encodes zero as four zero bytes", () => expect(toHex(encodeUint32(0))).toBe("00000000"));
test("encodeUint32 encodes 0xffffffff as four ff bytes", () => expect(toHex(encodeUint32(0xffffffff))).toBe("ffffffff"));
test("encodeUint32 rejects negative values", () => expect(() => encodeUint32(-1)).toThrow(VaultCryptoError));
test("encodeUint32 rejects fractional values", () => expect(() => encodeUint32(1.5)).toThrow(VaultCryptoError));
test("encodeUint32 rejects values above 0xffffffff", () => expect(() => encodeUint32(0x100000000)).toThrow(VaultCryptoError));
test("encodeUint32 rejects NaN", () => expect(() => encodeUint32(NaN)).toThrow(VaultCryptoError));
test("encodeUint32 rejects positive infinity", () => expect(() => encodeUint32(Infinity)).toThrow(VaultCryptoError));
test("encodeUint32 rejects negative infinity", () => expect(() => encodeUint32(-Infinity)).toThrow(VaultCryptoError));
test("encodeText encodes ASCII with an exact uint32 byte-length prefix", () => expect(toHex(encodeText("abc"))).toBe("00000003616263"));
test("encodeText encodes multibyte UTF-8 using byte length rather than character count", () => expect(toHex(encodeText("é🙂"))).toBe("00000006c3a9f09f9982"));
test("canonical UUID normalization lowercases valid uppercase input", () => expect(canonicalUuid(c.toUpperCase())).toBe(c));
test("canonical UUID normalization preserves valid lowercase input", () => expect(canonicalUuid(c)).toBe(c));
test("UUID validation rejects braces", () => expect(() => canonicalUuid(`{${c}}`)).toThrow(VaultCryptoError));
test("UUID validation rejects urn prefixes", () => expect(() => canonicalUuid(`urn:uuid:${c}`)).toThrow(VaultCryptoError));
test("UUID validation rejects leading whitespace", () => expect(() => canonicalUuid(` ${c}`)).toThrow(VaultCryptoError));
test("UUID validation rejects trailing whitespace", () => expect(() => canonicalUuid(`${c} `)).toThrow(VaultCryptoError));
test("UUID validation rejects missing hyphens", () => expect(() => canonicalUuid(c.replace(/-/g, ""))).toThrow(VaultCryptoError));
test("UUID validation rejects invalid hexadecimal characters", () => expect(() => canonicalUuid(c.replace("a", "g"))).toThrow(VaultCryptoError));
test("UUID validation rejects incorrect UUID field lengths", () => expect(() => canonicalUuid("aaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")).toThrow(VaultCryptoError));
test("workspaceTag matches a hardcoded base64url known-answer value", async () => expect(await workspaceTag(u, c)).toBe("HNf2JMBBTNJAycCFYtCITIwQsRqLaILPNLII-TjOAV4"));
test("record AAD matches a hardcoded byte-for-byte hexadecimal vector", () => expect(toHex(recordAad({ vaultFormatVersion: 1, userId: u, companyId: c, logicalStorageKey: "estipaid-customers-v1", blobIdentifier: "customers", recordSchemaVersion: 1 }))).toBe("0000001865737469706169642d7661756c742d7265636f72642d7631000000010000002431313131313131312d323232322d343333332d383434342d3535353535353535353535350000002461616161616161612d626262622d346363632d386464642d6565656565656565656565650000001565737469706169642d637573746f6d6572732d763100000009637573746f6d65727300000001"));
test("key-wrap AAD matches a hardcoded byte-for-byte hexadecimal vector", () => expect(toHex(keyWrapAad({ vaultFormatVersion: 1, userId: u, companyId: c, kdfVersion: 1 }))).toBe("0000001a65737469706169642d7661756c742d6b65792d777261702d7631000000010000002431313131313131312d323232322d343333332d383434342d3535353535353535353535350000002461616161616161612d626262622d346363632d386464642d65656565656565656565656500000001"));
test("sentinel AAD matches a hardcoded byte-for-byte hexadecimal vector", () => expect(toHex(sentinelAad({ vaultFormatVersion: 1, userId: u, companyId: c, sentinelSchemaVersion: 1 }))).toBe("0000001a65737469706169642d7661756c742d73656e74696e656c2d7631000000010000002431313131313131312d323232322d343333332d383434342d3535353535353535353535350000002461616161616161612d626262622d346363632d386464642d65656565656565656565656500000001"));
test("migration-manifest AAD matches a hardcoded byte-for-byte hexadecimal vector", () => expect(toHex(migrationManifestAad({ vaultFormatVersion: 1, userId: u, companyId: c, transitionId: "0123456789abcdef0123456789abcdef", manifestSchemaVersion: 1 }))).toBe("0000002465737469706169642d7661756c742d6d6967726174696f6e2d6d616e69666573742d7631000000010000002431313131313131312d323232322d343333332d383434342d3535353535353535353535350000002461616161616161612d626262622d346363632d386464642d65656565656565656565656500000020303132333435363738396162636465663031323334353637383961626364656600000001"));

// Source: Daninet/hash-wasm v4.12.0, test/argon2.test.ts, test("argon2id")
// first vector: hash("a", "abcdefgh", 1, 2, 16, 16, "hex", "id").
// Argon2 version: v1.3 (0x13); hash-wasm v4.12.0's public API fixes this version.
test("hash-wasm Argon2id matches the selected published known-answer vector", async () => {
  const result = await argon2id({
    password: new Uint8Array([97]),
    salt: new Uint8Array([97, 98, 99, 100, 101, 102, 103, 104]),
    memorySize: 16,
    iterations: 2,
    parallelism: 1,
    hashLength: 16,
    outputType: "binary",
  });
  expect(result).toBeInstanceOf(Uint8Array);
  expect(result).toHaveLength(16);
  expect(toHex(result)).toBe("f94aa50873d67fdd589d6774b87c0634");
});
test("Argon2id produces 32 binary bytes and keeps the production KDF separate", async () => { const direct = await argon2id({ password, salt, memorySize: 8192, iterations: 1, parallelism: 1, hashLength: 32, outputType: "binary" }); expect(direct).toBeInstanceOf(Uint8Array); expect(direct).toHaveLength(32); const key = await deriveTestOnlyKek(password, salt); expect(key.extractable).toBe(false); expect(key.algorithm.name).toBe("AES-GCM"); await expectCode(deriveTestOnlyKek("password", salt), VaultCryptoErrorCode.INVALID_INPUT); await expectCode(deriveTestOnlyKek(password, bytes(1)), VaultCryptoErrorCode.INVALID_INPUT); expect(() => validateKdfParameters({ ...TEST_ONLY_KDF_PROFILE, algorithm: "scrypt" })).toThrow(VaultCryptoError); await expectCode(deriveKek(password, salt, TEST_ONLY_KDF_PROFILE), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY); });
test("wrap, tamper resistance, record binding, sentinel and rotation", async () => { const kek = await deriveTestOnlyKek(password, salt); const other = await deriveTestOnlyKek(bytes(9,8,7,6,5,4,3,2), salt); const created = await createWrappedDek(kek, aad); const unwrapped = await unwrapDek(kek, created.wrappedDek, created.wrapIv, aad); const payload = bytes(7, 8, 9); const record = await encryptBytes(unwrapped, payload, recordAad({ vaultFormatVersion: 1, userId: u, companyId: c, logicalStorageKey: "key", blobIdentifier: "blob", recordSchemaVersion: 1 })); expect(await decryptBytes(unwrapped, record.ciphertext, record.iv, recordAad({ vaultFormatVersion: 1, userId: u, companyId: c, logicalStorageKey: "key", blobIdentifier: "blob", recordSchemaVersion: 1 }))).toEqual(payload); await expectCode(unwrapDek(other, created.wrappedDek, created.wrapIv, aad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED); const bad = created.wrappedDek.slice(); bad[0] ^= 1; await expectCode(unwrapDek(kek, bad, created.wrapIv, aad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED); const sentinel = await createSentinel(unwrapped, aad); expect(await verifySentinel(unwrapped, sentinel.ciphertext, sentinel.iv, aad)).toBe(true); const rotated = await rotateWrappedDek(kek, other, created.wrappedDek, created.wrapIv, aad, aad); expect(rotated.wrapIv).not.toEqual(created.wrapIv); });
test("inputs remain unchanged and encryption IVs are unique", async () => { const before = [password.slice(), salt.slice()]; const kek = await deriveTestOnlyKek(password, salt); const ivs = new Set(); for (let i = 0; i < 256; i++) { const result = await encryptBytes(kek, bytes(1), aad); ivs.add(Array.from(result.iv).join(",")); } expect(ivs.size).toBe(256); expect(password).toEqual(before[0]); expect(salt).toEqual(before[1]); });

test("deriveKek defaults to the Production KDF profile", async () => {
  const key = await deriveKek(password, salt);
  expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
});
test("deriveKek returns a non-extractable AES-256-GCM CryptoKey", async () => {
  const key = await deriveKek(password, salt);
  expect(key.type).toBe("secret"); expect(key.extractable).toBe(false); expect(key.usages).toEqual(expect.arrayContaining(["encrypt", "decrypt"]));
});
test("deriveKek rejects TEST_ONLY_KDF_PROFILE", async () => await expectCode(deriveKek(password, salt, TEST_ONLY_KDF_PROFILE), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek rejects a caller-controlled testOnly true property", async () => await expectCode(deriveKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, testOnly: true }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveTestOnlyKek succeeds while NODE_ENV is test", async () => expect(await deriveTestOnlyKek(password, salt)).toBeTruthy());
test("deriveTestOnlyKek rejects execution outside NODE_ENV test", async () => { const prior = process.env.NODE_ENV; try { process.env.NODE_ENV = "development"; await expectCode(deriveTestOnlyKek(password, salt), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY); } finally { process.env.NODE_ENV = prior; } });
test("deriveTestOnlyKek rejects test memorySize other than exactly 8192", async () => await expectCode(deriveTestOnlyKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, memorySize: 8193 }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveTestOnlyKek rejects test iterations other than exactly 1", async () => await expectCode(deriveTestOnlyKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, iterations: 2 }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveTestOnlyKek rejects test parallelism other than exactly 1", async () => await expectCode(deriveTestOnlyKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, parallelism: 2 }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveTestOnlyKek rejects test hashLength other than exactly 32", async () => await expectCode(deriveTestOnlyKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, hashLength: 16 }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveTestOnlyKek rejects test outputType other than binary", async () => await expectCode(deriveTestOnlyKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, outputType: "hex" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveTestOnlyKek rejects test algorithm other than argon2id", async () => await expectCode(deriveTestOnlyKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, algorithm: "argon2i" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek rejects a JavaScript string password", async () => await expectCode(deriveKek("password", salt), VaultCryptoErrorCode.INVALID_INPUT));
test("deriveKek rejects a password supplied as ArrayBuffer", async () => await expectCode(deriveKek(password.buffer, salt), VaultCryptoErrorCode.INVALID_INPUT));
test("deriveKek rejects a password supplied as a regular JavaScript array", async () => await expectCode(deriveKek([1, 2], salt), VaultCryptoErrorCode.INVALID_INPUT));
test("deriveKek rejects a salt that is not exactly 32 bytes", async () => await expectCode(deriveKek(password, bytes(1)), VaultCryptoErrorCode.INVALID_INPUT));
test("deriveKek rejects memory below 65536 KiB", async () => await expectCode(deriveKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, memorySize: 65535, iterations: 3 }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek rejects memory above 131072 KiB", async () => await expectCode(deriveKek(password, salt, { algorithm: "argon2id", memorySize: 131073, iterations: 3, parallelism: 1, hashLength: 32, outputType: "binary" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek rejects iterations below 3", async () => await expectCode(deriveKek(password, salt, { algorithm: "argon2id", memorySize: 65536, iterations: 2, parallelism: 1, hashLength: 32, outputType: "binary" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek rejects parallelism other than 1", async () => await expectCode(deriveKek(password, salt, { algorithm: "argon2id", memorySize: 65536, iterations: 3, parallelism: 2, hashLength: 32, outputType: "binary" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek rejects algorithm other than argon2id", async () => await expectCode(deriveKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, memorySize: 65536, iterations: 3, algorithm: "scrypt" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek rejects outputType other than binary", async () => await expectCode(deriveKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, memorySize: 65536, iterations: 3, outputType: "hex" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek rejects hashLength other than 32", async () => await expectCode(deriveKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, memorySize: 65536, iterations: 3, hashLength: 16 }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek accepts an approved stronger memory value up to 131072 KiB", async () => {
  const restore = setTestArgon2Adapter(jest.fn(async () => new Uint8Array(32)));
  try { await expect(deriveKek(password, salt, { algorithm: "argon2id", memorySize: 131072, iterations: 3, parallelism: 1, hashLength: 32, outputType: "binary" })).resolves.toBeTruthy(); }
  finally { restore(); }
});
test("deriveKek rejects memory above 131072 KiB before Argon2 executes", async () => {
  const spy = jest.fn(); const restore = setTestArgon2Adapter(spy);
  try { await expectCode(deriveKek(password, salt, { algorithm: "argon2id", memorySize: 131073, iterations: 3, parallelism: 1, hashLength: 32, outputType: "binary" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY); expect(spy).not.toHaveBeenCalled(); } finally { restore(); }
});
test("deriveKek rejects iterations below three before Argon2 executes", async () => {
  const spy = jest.fn(); const restore = setTestArgon2Adapter(spy);
  try { await expectCode(deriveKek(password, salt, { algorithm: "argon2id", memorySize: 65536, iterations: 2, parallelism: 1, hashLength: 32, outputType: "binary" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY); expect(spy).not.toHaveBeenCalled(); } finally { restore(); }
});
test("deriveKek rejects an algorithm other than argon2id before Argon2 executes", async () => {
  const spy = jest.fn(); const restore = setTestArgon2Adapter(spy);
  try { await expectCode(deriveKek(password, salt, { algorithm: "scrypt", memorySize: 65536, iterations: 3, parallelism: 1, hashLength: 32, outputType: "binary" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY); expect(spy).not.toHaveBeenCalled(); } finally { restore(); }
});
test("deriveKek exposes no PBKDF2 fallback", async () => await expectCode(deriveKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, memorySize: 65536, iterations: 3, algorithm: "pbkdf2" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek exposes no scrypt fallback", async () => await expectCode(deriveKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, memorySize: 65536, iterations: 3, algorithm: "scrypt" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek exposes no Argon2i fallback", async () => await expectCode(deriveKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, memorySize: 65536, iterations: 3, algorithm: "argon2i" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveKek exposes no Argon2d fallback", async () => await expectCode(deriveKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, memorySize: 65536, iterations: 3, algorithm: "argon2d" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY));
test("deriveTestOnlyKek does not mutate caller-owned password bytes", async () => { const original = password.slice(); await deriveTestOnlyKek(password, salt); expect(password).toEqual(original); });
test("deriveTestOnlyKek does not mutate caller-owned salt bytes", async () => { const original = salt.slice(); await deriveTestOnlyKek(password, salt); expect(salt).toEqual(original); });

// ---------------------------------------------------------------------------
// ISO-15C-R3B1: AES key validation, DEK generation, and DEK wrapping
// ---------------------------------------------------------------------------

const subtle = () => globalThis.crypto.subtle;

test("a valid non-extractable AES-256-GCM encrypt-decrypt KEK is accepted", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  await expect(encryptBytes(kek, bytes(1), aad)).resolves.toBeTruthy();
});

test("a valid non-extractable AES-256-GCM encrypt-decrypt DEK is accepted", async () => {
  const dek = await generateDek();
  await expect(encryptBytes(dek, bytes(1), aad)).resolves.toBeTruthy();
});

test("an extractable AES-256-GCM key is rejected", async () => {
  const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  await expectCode(encryptBytes(key, bytes(1), aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("a non-extractable AES-128-GCM key is rejected", async () => {
  const key = await subtle().generateKey({ name: "AES-GCM", length: 128 }, false, ["encrypt", "decrypt"]);
  await expectCode(encryptBytes(key, bytes(1), aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("an AES-GCM key lacking encrypt usage is rejected", async () => {
  const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  await expectCode(encryptBytes(key, bytes(1), aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("an AES-GCM key lacking decrypt usage is rejected", async () => {
  const key = await subtle().generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt"]);
  await expectCode(encryptBytes(key, bytes(1), aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("an AES-CBC key is rejected", async () => {
  const key = await subtle().generateKey({ name: "AES-CBC", length: 256 }, false, ["encrypt", "decrypt"]);
  await expectCode(encryptBytes(key, bytes(1), aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("a public CryptoKey is rejected", async () => {
  const pair = await subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  await expectCode(encryptBytes(pair.publicKey, bytes(1), aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("a non-CryptoKey object is rejected", async () => {
  await expectCode(encryptBytes({}, bytes(1), aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("generateDek returns a non-extractable AES-256-GCM CryptoKey", async () => {
  const dek = await generateDek();
  expect(dek.type).toBe("secret");
  expect(dek.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
  expect(dek.extractable).toBe(false);
  expect(dek.usages).toEqual(expect.arrayContaining(["encrypt", "decrypt"]));
});

test("generateDek creates independently usable keys", async () => {
  const dekA = await generateDek();
  const dekB = await generateDek();
  const payload = bytes(4, 5, 6);
  const encryptedA = await encryptBytes(dekA, payload, aad);
  const encryptedB = await encryptBytes(dekB, payload, aad);
  await expect(decryptBytes(dekA, encryptedA.ciphertext, encryptedA.iv, aad)).resolves.toEqual(payload);
  await expect(decryptBytes(dekB, encryptedB.ciphertext, encryptedB.iv, aad)).resolves.toEqual(payload);
  await expectCode(decryptBytes(dekA, encryptedB.ciphertext, encryptedB.iv, aad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("wrapDek returns ciphertext and a fresh 12-byte IV", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  expect(created.wrappedDek).toBeInstanceOf(Uint8Array);
  expect(created.wrappedDek.length).toBeGreaterThan(0);
  expect(created.wrapIv).toBeInstanceOf(Uint8Array);
  expect(created.wrapIv).toHaveLength(12);
});

test("wrapDek does not return raw DEK bytes", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  expect(created.dek).not.toBeInstanceOf(Uint8Array);
  expect(created.dek.extractable).toBe(false);
  expect(Object.keys(created).sort()).toEqual(["dek", "wrapIv", "wrappedDek"]);
});

test("unwrapDek returns a non-extractable AES-256-GCM CryptoKey", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  const unwrapped = await unwrapDek(kek, created.wrappedDek, created.wrapIv, aad);
  expect(unwrapped.type).toBe("secret");
  expect(unwrapped.extractable).toBe(false);
  expect(unwrapped.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
  expect(unwrapped.usages).toEqual(expect.arrayContaining(["encrypt", "decrypt"]));
});

test("DEK wrap and unwrap round trip preserves decryption capability", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  const challenge = bytes(9, 9, 5, 1, 2);
  const encrypted = await encryptBytes(created.dek, challenge, aad);
  const unwrapped = await unwrapDek(kek, created.wrappedDek, created.wrapIv, aad);
  const recovered = await decryptBytes(unwrapped, encrypted.ciphertext, encrypted.iv, aad);
  expect(recovered).toEqual(challenge);
});

test("wrong KEK fails with the generic authentication error", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const other = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(kek, aad);
  await expectCode(unwrapDek(other, created.wrappedDek, created.wrapIv, aad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("modified wrapped ciphertext fails with the generic authentication error", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  const tampered = created.wrappedDek.slice();
  tampered[0] ^= 1;
  await expectCode(unwrapDek(kek, tampered, created.wrapIv, aad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("modified wrap IV fails with the generic authentication error", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  const tamperedIv = created.wrapIv.slice();
  tamperedIv[0] ^= 1;
  await expectCode(unwrapDek(kek, created.wrappedDek, tamperedIv, aad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("modified wrap AAD fails with the generic authentication error", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  const tamperedAad = keyWrapAad({ vaultFormatVersion: 2, userId: u, companyId: c, kdfVersion: 1 });
  await expectCode(unwrapDek(kek, created.wrappedDek, created.wrapIv, tamperedAad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("truncated wrapped ciphertext fails with the generic authentication error", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  const truncated = created.wrappedDek.slice(0, created.wrappedDek.length - 4);
  await expectCode(unwrapDek(kek, truncated, created.wrapIv, aad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

async function buildTamperedWrapScenarios() {
  const kek = await deriveTestOnlyKek(password, salt);
  const other = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(kek, aad);
  const tamperedCiphertext = created.wrappedDek.slice();
  tamperedCiphertext[0] ^= 1;
  const tamperedIv = created.wrapIv.slice();
  tamperedIv[0] ^= 1;
  const tamperedAad = keyWrapAad({ vaultFormatVersion: 2, userId: u, companyId: c, kdfVersion: 1 });
  const truncated = created.wrappedDek.slice(0, created.wrappedDek.length - 4);
  return [
    unwrapDek(other, created.wrappedDek, created.wrapIv, aad),
    unwrapDek(kek, tamperedCiphertext, created.wrapIv, aad),
    unwrapDek(kek, created.wrappedDek, tamperedIv, aad),
    unwrapDek(kek, created.wrappedDek, created.wrapIv, tamperedAad),
    unwrapDek(kek, truncated, created.wrapIv, aad),
  ];
}

test("wrong KEK and tampered wrap inputs expose the same public error code", async () => {
  const scenarios = await buildTamperedWrapScenarios();
  const results = await Promise.allSettled(scenarios);
  results.forEach((result) => {
    expect(result.status).toBe("rejected");
    expect(result.reason.code).toBe(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
  });
});

test("wrong KEK and tampered wrap inputs expose the same public error message", async () => {
  const scenarios = await buildTamperedWrapScenarios();
  const results = await Promise.allSettled(scenarios);
  const messages = results.map((result) => result.reason.message);
  messages.forEach((message) => expect(message).toBe(messages[0]));
});

test("createWrappedDek does not allow caller control over the generated IV", async () => {
  expect(createWrappedDek.length).toBe(2);
  const kek = await deriveTestOnlyKek(password, salt);
  const forgedIv = bytes(9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9, 9);
  const created = await createWrappedDek(kek, aad, forgedIv);
  expect(created.wrapIv).not.toEqual(forgedIv);
  expect(created.wrapIv).toHaveLength(12);
});

test("unwrapDek rejects an IV that is not exactly 12 bytes", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  await expectCode(unwrapDek(kek, created.wrappedDek, bytes(1, 2, 3), aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("unwrapDek rejects wrapped ciphertext that is not a Uint8Array", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  await expectCode(unwrapDek(kek, Array.from(created.wrappedDek), created.wrapIv, aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("wrapDek rejects AAD that is not a Uint8Array", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  await expectCode(createWrappedDek(kek, "not-bytes"), VaultCryptoErrorCode.INVALID_INPUT);
});

test("unwrapDek rejects AAD that is not a Uint8Array", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  await expectCode(unwrapDek(kek, created.wrappedDek, created.wrapIv, "not-bytes"), VaultCryptoErrorCode.INVALID_INPUT);
});

test("wrapDek rejects a KEK that fails AES key validation", async () => {
  const badKek = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  await expectCode(createWrappedDek(badKek, aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("wrapDek rejects a DEK that fails AES key validation", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const badRaw = new Uint8Array(32);
  const badDek = await subtle().importKey("raw", badRaw, { name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const importSpy = jest.spyOn(subtle(), "importKey").mockImplementationOnce(async () => badDek);
  try {
    await expectCode(createWrappedDek(kek, aad), VaultCryptoErrorCode.INVALID_INPUT);
  } finally {
    importSpy.mockRestore();
  }
});

test("unwrapDek rejects a KEK that fails AES key validation", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  const badKek = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  await expectCode(unwrapDek(badKek, created.wrappedDek, created.wrapIv, aad), VaultCryptoErrorCode.INVALID_INPUT);
});

test("wrapDek does not mutate caller-owned AAD bytes", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const original = aad.slice();
  await createWrappedDek(kek, aad);
  expect(aad).toEqual(original);
});

test("unwrapDek does not mutate caller-owned wrapped ciphertext bytes", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  const original = created.wrappedDek.slice();
  await unwrapDek(kek, created.wrappedDek, created.wrapIv, aad);
  expect(created.wrappedDek).toEqual(original);
});

test("unwrapDek does not mutate caller-owned IV bytes", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  const original = created.wrapIv.slice();
  await unwrapDek(kek, created.wrappedDek, created.wrapIv, aad);
  expect(created.wrapIv).toEqual(original);
});

test("unwrapDek does not mutate caller-owned AAD bytes", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const created = await createWrappedDek(kek, aad);
  const original = aad.slice();
  await unwrapDek(kek, created.wrappedDek, created.wrapIv, aad);
  expect(aad).toEqual(original);
});

function assertNoLeakedMaterial(error, distinctiveValues) {
  const haystacks = [
    error.message,
    error.code,
    error.name,
    error.cause === undefined ? "" : String(error.cause),
    JSON.stringify(Object.fromEntries(Object.entries(error).filter(([key]) => !["message", "code", "name", "stack"].includes(key)))),
  ].join("\n");
  distinctiveValues.forEach((value) => expect(haystacks).not.toContain(value));
}

test("wrap authentication errors contain no wrapped ciphertext material", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const other = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(kek, aad);
  try {
    await unwrapDek(other, created.wrappedDek, created.wrapIv, aad);
    throw new Error("expected rejection");
  } catch (error) {
    assertNoLeakedMaterial(error, [toHex(created.wrappedDek)]);
  }
});

test("wrap authentication errors contain no IV material", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const other = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(kek, aad);
  try {
    await unwrapDek(other, created.wrappedDek, created.wrapIv, aad);
    throw new Error("expected rejection");
  } catch (error) {
    assertNoLeakedMaterial(error, [toHex(created.wrapIv)]);
  }
});

test("wrap authentication errors contain no AAD material", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const other = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(kek, aad);
  try {
    await unwrapDek(other, created.wrappedDek, created.wrapIv, aad);
    throw new Error("expected rejection");
  } catch (error) {
    assertNoLeakedMaterial(error, [toHex(aad)]);
  }
});

test("wrap authentication errors contain no UUID text", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const other = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(kek, aad);
  try {
    await unwrapDek(other, created.wrappedDek, created.wrapIv, aad);
    throw new Error("expected rejection");
  } catch (error) {
    assertNoLeakedMaterial(error, [u, c]);
  }
});

test("wrap authentication errors contain no workspace tag", async () => {
  const kek = await deriveTestOnlyKek(password, salt);
  const other = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(kek, aad);
  const tag = await workspaceTag(u, c);
  try {
    await unwrapDek(other, created.wrappedDek, created.wrapIv, aad);
    throw new Error("expected rejection");
  } catch (error) {
    assertNoLeakedMaterial(error, [tag]);
  }
});

// ---------------------------------------------------------------------------
// ISO-15C-R3B2: record encryption, sentinel, rotation, and IV tests
// ---------------------------------------------------------------------------

const canonicalRecordAadFields = { vaultFormatVersion: 1, userId: u, companyId: c, logicalStorageKey: "estipaid-customers-v1", blobIdentifier: "customers", recordSchemaVersion: 1 };
const buildRecordAad = (overrides = {}) => recordAad({ ...canonicalRecordAadFields, ...overrides });
const recordPlaintext = bytes(10, 20, 30, 40, 50);
const otherUserId = "22222222-3333-4444-8555-666666666666";
const otherCompanyId = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const canonicalSentinelAad = sentinelAad({ vaultFormatVersion: 1, userId: u, companyId: c, sentinelSchemaVersion: 1 });

test("record encryption and decryption round trip succeeds", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  const decrypted = await decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad());
  expect(decrypted).toEqual(recordPlaintext);
});

test("record encryption returns ciphertext and a 12-byte IV", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  expect(encrypted.ciphertext).toBeInstanceOf(Uint8Array);
  expect(encrypted.ciphertext.length).toBeGreaterThan(0);
  expect(encrypted.iv).toBeInstanceOf(Uint8Array);
  expect(encrypted.iv).toHaveLength(12);
  const second = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  expect(second.iv).not.toEqual(encrypted.iv);
});

test("record encryption does not return plaintext bytes as ciphertext", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  expect(encrypted.ciphertext).not.toEqual(recordPlaintext);
});

test("modified record ciphertext fails with the generic authentication error", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  const tampered = encrypted.ciphertext.slice();
  tampered[0] ^= 1;
  await expectCode(decryptBytes(dek, tampered, encrypted.iv, buildRecordAad()), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("modified record IV fails with the generic authentication error", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  const tamperedIv = encrypted.iv.slice();
  tamperedIv[0] ^= 1;
  await expectCode(decryptBytes(dek, encrypted.ciphertext, tamperedIv, buildRecordAad()), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("modified record AAD fails with the generic authentication error", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  await expectCode(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad({ recordSchemaVersion: 2 })), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("cross-user record AAD fails authentication", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  await expectCode(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad({ userId: otherUserId })), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("cross-company record AAD fails authentication", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  await expectCode(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad({ companyId: otherCompanyId })), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("cross-logical-key record AAD fails authentication", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  await expectCode(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad({ logicalStorageKey: "estipaid-invoices-v1" })), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("cross-blob-identifier record AAD fails authentication", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  await expectCode(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad({ blobIdentifier: "other-blob" })), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("record encryption does not mutate caller-owned plaintext bytes", async () => {
  const dek = await generateDek();
  const original = recordPlaintext.slice();
  await encryptBytes(dek, recordPlaintext, buildRecordAad());
  expect(recordPlaintext).toEqual(original);
});

test("record encryption does not mutate caller-owned AAD bytes", async () => {
  const dek = await generateDek();
  const recordAadBytes = buildRecordAad();
  const original = recordAadBytes.slice();
  await encryptBytes(dek, recordPlaintext, recordAadBytes);
  expect(recordAadBytes).toEqual(original);
});

test("record decryption does not mutate caller-owned ciphertext bytes", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  const original = encrypted.ciphertext.slice();
  await decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad());
  expect(encrypted.ciphertext).toEqual(original);
});

test("record decryption does not mutate caller-owned IV bytes", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  const original = encrypted.iv.slice();
  await decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad());
  expect(encrypted.iv).toEqual(original);
});

test("record decryption does not mutate caller-owned AAD bytes", async () => {
  const dek = await generateDek();
  const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
  const recordAadBytes = buildRecordAad();
  const original = recordAadBytes.slice();
  await decryptBytes(dek, encrypted.ciphertext, encrypted.iv, recordAadBytes);
  expect(recordAadBytes).toEqual(original);
});

test("sentinel creation and verification succeeds", async () => {
  const dek = await generateDek();
  const sentinel = await createSentinel(dek, canonicalSentinelAad);
  await expect(verifySentinel(dek, sentinel.ciphertext, sentinel.iv, canonicalSentinelAad)).resolves.toBe(true);
});

test("sentinel creation returns ciphertext and a 12-byte IV", async () => {
  const dek = await generateDek();
  const sentinel = await createSentinel(dek, canonicalSentinelAad);
  expect(sentinel.ciphertext).toBeInstanceOf(Uint8Array);
  expect(sentinel.ciphertext.length).toBeGreaterThan(0);
  expect(sentinel.iv).toBeInstanceOf(Uint8Array);
  expect(sentinel.iv).toHaveLength(12);
  const second = await createSentinel(dek, canonicalSentinelAad);
  expect(second.iv).not.toEqual(sentinel.iv);
});

test("modified sentinel ciphertext fails authentication", async () => {
  const dek = await generateDek();
  const sentinel = await createSentinel(dek, canonicalSentinelAad);
  const tampered = sentinel.ciphertext.slice();
  tampered[0] ^= 1;
  await expectCode(verifySentinel(dek, tampered, sentinel.iv, canonicalSentinelAad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("modified sentinel IV fails authentication", async () => {
  const dek = await generateDek();
  const sentinel = await createSentinel(dek, canonicalSentinelAad);
  const tamperedIv = sentinel.iv.slice();
  tamperedIv[0] ^= 1;
  await expectCode(verifySentinel(dek, sentinel.ciphertext, tamperedIv, canonicalSentinelAad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("modified sentinel AAD fails authentication", async () => {
  const dek = await generateDek();
  const sentinel = await createSentinel(dek, canonicalSentinelAad);
  const tamperedAad = sentinelAad({ vaultFormatVersion: 1, userId: u, companyId: c, sentinelSchemaVersion: 2 });
  await expectCode(verifySentinel(dek, sentinel.ciphertext, sentinel.iv, tamperedAad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

async function buildSentinelFailureScenarios() {
  const dek = await generateDek();
  const otherDek = await generateDek();
  const sentinel = await createSentinel(dek, canonicalSentinelAad);
  const tamperedCiphertext = sentinel.ciphertext.slice();
  tamperedCiphertext[0] ^= 1;
  const tamperedIv = sentinel.iv.slice();
  tamperedIv[0] ^= 1;
  const tamperedAad = sentinelAad({ vaultFormatVersion: 1, userId: u, companyId: c, sentinelSchemaVersion: 2 });
  return [
    verifySentinel(otherDek, sentinel.ciphertext, sentinel.iv, canonicalSentinelAad),
    verifySentinel(dek, tamperedCiphertext, sentinel.iv, canonicalSentinelAad),
    verifySentinel(dek, sentinel.ciphertext, tamperedIv, canonicalSentinelAad),
    verifySentinel(dek, sentinel.ciphertext, sentinel.iv, tamperedAad),
  ];
}

test("wrong-DEK sentinel verification and sentinel tampering expose the same public error code", async () => {
  const scenarios = await buildSentinelFailureScenarios();
  const results = await Promise.allSettled(scenarios);
  results.forEach((result) => {
    expect(result.status).toBe("rejected");
    expect(result.reason.code).toBe(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
  });
});

test("wrong-DEK sentinel verification and sentinel tampering expose the same public error message", async () => {
  const scenarios = await buildSentinelFailureScenarios();
  const results = await Promise.allSettled(scenarios);
  const messages = results.map((result) => result.reason.message);
  messages.forEach((message) => expect(message).toBe(messages[0]));
});

test("password rotation returns a fresh 12-byte wrap IV", async () => {
  const oldKek = await deriveTestOnlyKek(password, salt);
  const newKek = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(oldKek, aad);
  const rotated = await rotateWrappedDek(oldKek, newKek, created.wrappedDek, created.wrapIv, aad, aad);
  expect(rotated.wrapIv).toBeInstanceOf(Uint8Array);
  expect(rotated.wrapIv).toHaveLength(12);
});

test("password rotation produces a different wrapped envelope", async () => {
  const oldKek = await deriveTestOnlyKek(password, salt);
  const newKek = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(oldKek, aad);
  const rotated = await rotateWrappedDek(oldKek, newKek, created.wrappedDek, created.wrapIv, aad, aad);
  expect(rotated.wrapIv).not.toEqual(created.wrapIv);
  expect(rotated.wrappedDek).not.toEqual(created.wrappedDek);
});

test("password rotation preserves the exact underlying DEK capability", async () => {
  const oldKek = await deriveTestOnlyKek(password, salt);
  const newKek = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(oldKek, aad);
  const challenge = bytes(3, 1, 4, 1, 5, 9);
  const challengeEncrypted = await encryptBytes(created.dek, challenge, aad);
  const oldUnwrapped = await unwrapDek(oldKek, created.wrappedDek, created.wrapIv, aad);
  const rotated = await rotateWrappedDek(oldKek, newKek, created.wrappedDek, created.wrapIv, aad, aad);
  const newUnwrapped = await unwrapDek(newKek, rotated.wrappedDek, rotated.wrapIv, aad);
  await expect(decryptBytes(oldUnwrapped, challengeEncrypted.ciphertext, challengeEncrypted.iv, aad)).resolves.toEqual(challenge);
  await expect(decryptBytes(newUnwrapped, challengeEncrypted.ciphertext, challengeEncrypted.iv, aad)).resolves.toEqual(challenge);
});

test("password rotation with the wrong old KEK fails with the generic authentication error", async () => {
  const oldKek = await deriveTestOnlyKek(password, salt);
  const wrongOldKek = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const newKek = await deriveTestOnlyKek(bytes(1, 1, 1, 1, 1, 1, 1, 1), salt);
  const created = await createWrappedDek(oldKek, aad);
  await expectCode(rotateWrappedDek(wrongOldKek, newKek, created.wrappedDek, created.wrapIv, aad, aad), VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
});

test("password rotation does not mutate the original wrapped ciphertext, IV, or AAD", async () => {
  const oldKek = await deriveTestOnlyKek(password, salt);
  const newKek = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
  const created = await createWrappedDek(oldKek, aad);
  const originalWrappedDek = created.wrappedDek.slice();
  const originalWrapIv = created.wrapIv.slice();
  const originalAad = aad.slice();
  await rotateWrappedDek(oldKek, newKek, created.wrappedDek, created.wrapIv, aad, aad);
  expect(created.wrappedDek).toEqual(originalWrappedDek);
  expect(created.wrapIv).toEqual(originalWrapIv);
  expect(aad).toEqual(originalAad);
});

test("at least 256 encryption operations produce no duplicate IV", async () => {
  const dek = await generateDek();
  const ivHexes = new Set();
  for (let i = 0; i < 256; i += 1) {
    const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
    ivHexes.add(toHex(encrypted.iv));
  }
  expect(ivHexes.size).toBe(256);
});

// ---------------------------------------------------------------------------
// ISO-15C-R3C1: environment, network, and error-hygiene completion
// ---------------------------------------------------------------------------

// Optional whole-suite fetch-throw mode. Enabled by VAULT_FETCH_THROW=1 so the
// focused suite can be re-run with network access globally unavailable; the
// original descriptor is always restored in afterAll.
const FETCH_THROW_MODE = process.env.VAULT_FETCH_THROW === "1";
let suiteFetchDescriptor;

beforeAll(() => {
  if (!FETCH_THROW_MODE) return;
  suiteFetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: () => { throw new Error("network access is forbidden in vaultCrypto tests"); },
  });
});

afterAll(() => {
  if (!FETCH_THROW_MODE) return;
  if (suiteFetchDescriptor) Object.defineProperty(globalThis, "fetch", suiteFetchDescriptor);
  else delete globalThis.fetch;
});

async function withThrowingFetch(run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const mock = jest.fn(() => { throw new Error("network access is forbidden"); });
  Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: mock });
  try {
    await run(mock);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "fetch", descriptor);
    else delete globalThis.fetch;
  }
}

async function withGlobalCrypto(replacement, run) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
  Object.defineProperty(globalThis, "crypto", { configurable: true, writable: true, value: replacement });
  try {
    return await run();
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "crypto", descriptor);
    else delete globalThis.crypto;
  }
}

const SUBTLE_METHODS = ["digest", "importKey", "encrypt", "decrypt", "generateKey", "exportKey", "deriveBits", "deriveKey", "sign", "verify", "wrapKey", "unwrapKey"];

// Builds a Web Crypto stand-in from the real implementation. An override value
// of `undefined` removes the method entirely; any other value replaces it (so a
// non-callable or throwing method can be simulated).
function cryptoWithSubtleOverrides(overrides) {
  const real = globalThis.crypto;
  const partialSubtle = {};
  SUBTLE_METHODS.forEach((method) => {
    if (typeof real.subtle[method] === "function") partialSubtle[method] = real.subtle[method].bind(real.subtle);
  });
  Object.keys(overrides).forEach((name) => {
    if (overrides[name] === undefined) delete partialSubtle[name];
    else partialSubtle[name] = overrides[name];
  });
  return { getRandomValues: (buffer) => real.getRandomValues(buffer), subtle: partialSubtle };
}

function cryptoWithoutSubtleMethod(omitted) {
  return cryptoWithSubtleOverrides({ [omitted]: undefined });
}

const RAW_TYPE_ERROR_PATTERNS = [/is not a function/i, /Cannot read propert/i, /undefined is not/i];

function expectNoRawTypeErrorText(error) {
  const surfaces = errorSurfaces(error);
  expect(error).not.toBeInstanceOf(TypeError);
  RAW_TYPE_ERROR_PATTERNS.forEach((pattern) => expect(surfaces).not.toMatch(pattern));
}

async function captureRejection(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to reject");
}

function errorSurfaces(error) {
  let serialized = "";
  try { serialized = JSON.stringify(error) || ""; } catch (_) { serialized = ""; }
  return [
    String(error && error.name),
    String(error && error.code),
    String(error && error.message),
    error && error.cause === undefined ? "" : String(error && error.cause),
    Object.keys(error || {}).join(","),
    serialized,
    String((error && error.stack) || ""),
  ].join("\n");
}

function expectNoSecrets(error, secrets) {
  const surfaces = errorSurfaces(error);
  secrets.forEach((secret) => {
    expect(String(secret).length).toBeGreaterThan(0);
    expect(surfaces).not.toContain(String(secret));
  });
}

const distinctivePasswordText = "PW-DISTINCTIVE-8f3a1c9e-secret";
const distinctivePasswordBytes = bytes(0xde, 0xad, 0xbe, 0xef, 0x13, 0x37, 0x42, 0x99);
const distinctiveInvalidUuid = "ZZZZZZZZ-NOTA-VALID-UUID-9f2b7c1d5e04";
const distinctiveLogicalKey = "estipaid-distinctive-logical-key-7d41f0ab";
const distinctiveBlobIdentifier = "blob-distinctive-3e9c22f1";
const distinctiveRecordAad = () => recordAad({ vaultFormatVersion: 1, userId: u, companyId: c, logicalStorageKey: distinctiveLogicalKey, blobIdentifier: distinctiveBlobIdentifier, recordSchemaVersion: 1 });

async function captureTamperedRecordFailure() {
  const dek = await generateDek();
  const recordAadBytes = distinctiveRecordAad();
  const encrypted = await encryptBytes(dek, recordPlaintext, recordAadBytes);
  const tampered = encrypted.ciphertext.slice();
  tampered[0] ^= 1;
  const error = await captureRejection(decryptBytes(dek, tampered, encrypted.iv, recordAadBytes));
  return { error, encrypted, tampered, recordAadBytes };
}

test("deriveTestOnlyKek never calls fetch", async () => {
  await withThrowingFetch(async (mock) => {
    const key = await deriveTestOnlyKek(password, salt);
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(mock).not.toHaveBeenCalled();
  });
});

test("workspaceTag never calls fetch", async () => {
  await withThrowingFetch(async (mock) => {
    await expect(workspaceTag(u, c)).resolves.toBe("HNf2JMBBTNJAycCFYtCITIwQsRqLaILPNLII-TjOAV4");
    expect(mock).not.toHaveBeenCalled();
  });
});

test("DEK generation and wrapping never call fetch", async () => {
  await withThrowingFetch(async (mock) => {
    const kek = await deriveTestOnlyKek(password, salt);
    const dek = await generateDek();
    expect(dek.extractable).toBe(false);
    const created = await createWrappedDek(kek, aad);
    const unwrapped = await unwrapDek(kek, created.wrappedDek, created.wrapIv, aad);
    expect(unwrapped.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(mock).not.toHaveBeenCalled();
  });
});

test("record and sentinel encryption never call fetch", async () => {
  await withThrowingFetch(async (mock) => {
    const dek = await generateDek();
    const encrypted = await encryptBytes(dek, recordPlaintext, buildRecordAad());
    await expect(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad())).resolves.toEqual(recordPlaintext);
    const sentinel = await createSentinel(dek, canonicalSentinelAad);
    await expect(verifySentinel(dek, sentinel.ciphertext, sentinel.iv, canonicalSentinelAad)).resolves.toBe(true);
    expect(mock).not.toHaveBeenCalled();
  });
});

test("password rotation never calls fetch", async () => {
  await withThrowingFetch(async (mock) => {
    const oldKek = await deriveTestOnlyKek(password, salt);
    const newKek = await deriveTestOnlyKek(bytes(9, 8, 7, 6, 5, 4, 3, 2), salt);
    const created = await createWrappedDek(oldKek, aad);
    const rotated = await rotateWrappedDek(oldKek, newKek, created.wrappedDek, created.wrapIv, aad, aad);
    expect(rotated.wrapIv).toHaveLength(12);
    expect(mock).not.toHaveBeenCalled();
  });
});

test("missing global Web Crypto fails with UNSUPPORTED_ENVIRONMENT", async () => {
  await withGlobalCrypto(undefined, async () => {
    await expectCode(workspaceTag(u, c), VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
  });
});

test("missing crypto.subtle fails with UNSUPPORTED_ENVIRONMENT", async () => {
  const real = globalThis.crypto;
  await withGlobalCrypto({ getRandomValues: (buffer) => real.getRandomValues(buffer) }, async () => {
    await expectCode(workspaceTag(u, c), VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
  });
});

test("missing crypto.getRandomValues fails with UNSUPPORTED_ENVIRONMENT", async () => {
  const real = globalThis.crypto;
  await withGlobalCrypto({ subtle: real.subtle }, async () => {
    await expectCode(generateDek(), VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
  });
});

test("missing crypto.subtle.digest fails with UNSUPPORTED_ENVIRONMENT", async () => {
  await withGlobalCrypto(cryptoWithoutSubtleMethod("digest"), async () => {
    const error = await captureRejection(workspaceTag(u, c));
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error.code).toBe(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
    expect(error.message).toBe("Required browser cryptography is unavailable.");
    expectNoRawTypeErrorText(error);
  });
});

test("missing crypto.subtle.importKey fails with UNSUPPORTED_ENVIRONMENT", async () => {
  const adapter = jest.fn(async () => new Uint8Array(32));
  const restore = setTestArgon2Adapter(adapter);
  try {
    await withGlobalCrypto(cryptoWithoutSubtleMethod("importKey"), async () => {
      const error = await captureRejection(deriveKek(password, salt));
      expect(error).toBeInstanceOf(VaultCryptoError);
      expect(error.code).toBe(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
      expectNoRawTypeErrorText(error);
      // Capability is resolved before the KDF runs, so no derivation is attempted.
      expect(adapter).not.toHaveBeenCalled();
      const dekError = await captureRejection(generateDek());
      expect(dekError.code).toBe(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
    });
  } finally {
    restore();
  }
});

test("missing crypto.subtle.encrypt fails with UNSUPPORTED_ENVIRONMENT", async () => {
  const dek = await generateDek();
  await withGlobalCrypto(cryptoWithoutSubtleMethod("encrypt"), async () => {
    const error = await captureRejection(encryptBytes(dek, recordPlaintext, buildRecordAad()));
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error.code).toBe(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
    expectNoRawTypeErrorText(error);
  });
});

test("missing crypto.subtle.decrypt fails with UNSUPPORTED_ENVIRONMENT", async () => {
  const dek = await generateDek();
  const recordAadBytes = buildRecordAad();
  const encrypted = await encryptBytes(dek, recordPlaintext, recordAadBytes);
  await withGlobalCrypto(cryptoWithoutSubtleMethod("decrypt"), async () => {
    const error = await captureRejection(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, recordAadBytes));
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error.code).toBe(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
    expect(error.code).not.toBe(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
    expectNoRawTypeErrorText(error);
  });
});

test("a non-callable crypto.subtle.decrypt fails with UNSUPPORTED_ENVIRONMENT", async () => {
  const dek = await generateDek();
  const recordAadBytes = buildRecordAad();
  const encrypted = await encryptBytes(dek, recordPlaintext, recordAadBytes);
  const nonCallableValues = [null, 42, "decrypt", {}, []];
  for (const value of nonCallableValues) {
    await withGlobalCrypto(cryptoWithSubtleOverrides({ decrypt: value }), async () => {
      const error = await captureRejection(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, recordAadBytes));
      expect(error).toBeInstanceOf(VaultCryptoError);
      expect(error.code).toBe(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
      expect(error.code).not.toBe(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
      expectNoRawTypeErrorText(error);
    });
  }
});

test("a callable decrypt that rejects authentication uses CRYPTO_AUTHENTICATION_FAILED", async () => {
  const dek = await generateDek();
  const recordAadBytes = buildRecordAad();
  const encrypted = await encryptBytes(dek, recordPlaintext, recordAadBytes);
  const tampered = encrypted.ciphertext.slice();
  tampered[0] ^= 1;
  expect(typeof globalThis.crypto.subtle.decrypt).toBe("function");
  const error = await captureRejection(decryptBytes(dek, tampered, encrypted.iv, recordAadBytes));
  expect(error).toBeInstanceOf(VaultCryptoError);
  expect(error.code).toBe(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
  expect(error.message).toBe("Record authentication failed.");
});

test("a callable encrypt that throws a non-authentication failure uses CRYPTO_OPERATION_FAILED", async () => {
  const dek = await generateDek();
  const throwingEncrypt = jest.fn(async () => { throw new Error("ENCRYPT-INTERNAL-9f2c"); });
  await withGlobalCrypto(cryptoWithSubtleOverrides({ encrypt: throwingEncrypt }), async () => {
    const error = await captureRejection(encryptBytes(dek, recordPlaintext, buildRecordAad()));
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error.code).toBe(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED);
    expect(throwingEncrypt).toHaveBeenCalledTimes(1);
    expectNoSecrets(error, ["ENCRYPT-INTERNAL-9f2c"]);
  });
});

test("a callable digest that throws uses CRYPTO_OPERATION_FAILED", async () => {
  const throwingDigest = jest.fn(async () => { throw new Error("DIGEST-INTERNAL-71ab"); });
  await withGlobalCrypto(cryptoWithSubtleOverrides({ digest: throwingDigest }), async () => {
    const error = await captureRejection(workspaceTag(u, c));
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error.code).toBe(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED);
    expect(throwingDigest).toHaveBeenCalledTimes(1);
    expectNoSecrets(error, ["DIGEST-INTERNAL-71ab"]);
  });
});

test("missing Web Crypto method errors contain no raw TypeError message", async () => {
  const dek = await generateDek();
  const recordAadBytes = buildRecordAad();
  const encrypted = await encryptBytes(dek, recordPlaintext, recordAadBytes);
  const cases = [
    ["digest", () => workspaceTag(u, c)],
    ["importKey", () => generateDek()],
    ["encrypt", () => encryptBytes(dek, recordPlaintext, recordAadBytes)],
    ["decrypt", () => decryptBytes(dek, encrypted.ciphertext, encrypted.iv, recordAadBytes)],
  ];
  for (const [method, operation] of cases) {
    await withGlobalCrypto(cryptoWithoutSubtleMethod(method), async () => {
      const error = await captureRejection(operation());
      expect(error.code).toBe(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
      expect(error.message).toBe("Required browser cryptography is unavailable.");
      expectNoRawTypeErrorText(error);
      expectNoSecrets(error, [method === "digest" ? u : toHex(recordAadBytes)]);
    });
  }
});

test("resolved Web Crypto methods are invoked with the SubtleCrypto receiver", async () => {
  const real = globalThis.crypto;
  const replacement = cryptoWithSubtleOverrides({});
  const receivers = [];
  // Real SubtleCrypto methods throw "Illegal invocation" in Chromium/Safari when
  // detached from their receiver. This mock reproduces that requirement exactly,
  // so the test fails if requireSubtleMethod ever returns an unbound method.
  replacement.subtle.digest = function receiverSensitiveDigest(algorithm, data) {
    receivers.push(this);
    if (this !== replacement.subtle) throw new TypeError("Illegal invocation");
    return real.subtle.digest(algorithm, data);
  };
  await withGlobalCrypto(replacement, async () => {
    await expect(workspaceTag(u, c)).resolves.toBe("HNf2JMBBTNJAycCFYtCITIwQsRqLaILPNLII-TjOAV4");
  });
  expect(receivers).toHaveLength(1);
  expect(receivers[0]).toBe(replacement.subtle);
});

test("authentication failure remains indistinguishable across wrong key and tampered inputs", async () => {
  const dek = await generateDek();
  const otherDek = await generateDek();
  const recordAadBytes = buildRecordAad();
  const encrypted = await encryptBytes(dek, recordPlaintext, recordAadBytes);
  const tamperedCiphertext = encrypted.ciphertext.slice();
  tamperedCiphertext[0] ^= 1;
  const tamperedIv = encrypted.iv.slice();
  tamperedIv[0] ^= 1;
  const results = await Promise.allSettled([
    decryptBytes(otherDek, encrypted.ciphertext, encrypted.iv, recordAadBytes),
    decryptBytes(dek, tamperedCiphertext, encrypted.iv, recordAadBytes),
    decryptBytes(dek, encrypted.ciphertext, tamperedIv, recordAadBytes),
    decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad({ recordSchemaVersion: 2 })),
    decryptBytes(dek, encrypted.ciphertext.slice(0, encrypted.ciphertext.length - 4), encrypted.iv, recordAadBytes),
  ]);
  results.forEach((result) => {
    expect(result.status).toBe("rejected");
    expect(result.reason.code).toBe(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
    expect(result.reason.message).toBe(results[0].reason.message);
  });
});

test("the Argon2 test adapter cannot be replaced outside NODE_ENV test", () => {
  const prior = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    expect(() => setTestArgon2Adapter(jest.fn())).toThrow(VaultCryptoError);
    process.env.NODE_ENV = "development";
    expect(() => setTestArgon2Adapter(jest.fn())).toThrow(VaultCryptoError);
  } finally {
    process.env.NODE_ENV = prior;
  }
});

test("the Argon2 test adapter is restored after each test", async () => {
  const spy = jest.fn(async () => new Uint8Array(32));
  const restore = setTestArgon2Adapter(spy);
  await deriveTestOnlyKek(password, salt);
  expect(spy).toHaveBeenCalledTimes(1);
  restore();
  await deriveTestOnlyKek(password, salt);
  expect(spy).toHaveBeenCalledTimes(1);
});

test("Production deriveKek cannot select the injected test adapter through caller input", async () => {
  const spy = jest.fn(async () => new Uint8Array(32));
  const restore = setTestArgon2Adapter(spy);
  try {
    await expectCode(deriveKek(password, salt, TEST_ONLY_KDF_PROFILE), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY);
    await expectCode(deriveKek(password, salt, { ...TEST_ONLY_KDF_PROFILE, testOnly: true }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY);
    expect(spy).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});

test("public invalid-input errors contain no password material", async () => {
  const textError = await captureRejection(deriveKek(distinctivePasswordText, salt));
  expect(textError.code).toBe(VaultCryptoErrorCode.INVALID_INPUT);
  expectNoSecrets(textError, [distinctivePasswordText]);
  const bytesError = await captureRejection(deriveKek(distinctivePasswordBytes, bytes(1, 2, 3)));
  expect(bytesError.code).toBe(VaultCryptoErrorCode.INVALID_INPUT);
  expectNoSecrets(bytesError, [toHex(distinctivePasswordBytes)]);
});

test("public UUID-validation errors contain no rejected UUID text", () => {
  let error;
  try { canonicalUuid(distinctiveInvalidUuid); } catch (caught) { error = caught; }
  expect(error).toBeInstanceOf(VaultCryptoError);
  expect(error.code).toBe(VaultCryptoErrorCode.INVALID_INPUT);
  expectNoSecrets(error, [distinctiveInvalidUuid]);
});

test("public authentication errors contain no raw AAD material", async () => {
  const { error, recordAadBytes } = await captureTamperedRecordFailure();
  expectNoSecrets(error, [toHex(recordAadBytes)]);
});

test("public authentication errors contain no ciphertext material", async () => {
  const { error, encrypted, tampered } = await captureTamperedRecordFailure();
  expectNoSecrets(error, [toHex(encrypted.ciphertext), toHex(tampered)]);
});

test("public authentication errors contain no IV material", async () => {
  const { error, encrypted } = await captureTamperedRecordFailure();
  expectNoSecrets(error, [toHex(encrypted.iv)]);
});

test("public authentication errors contain no logical storage key", async () => {
  const { error } = await captureTamperedRecordFailure();
  expectNoSecrets(error, [distinctiveLogicalKey]);
});

test("public authentication errors contain no blob identifier", async () => {
  const { error } = await captureTamperedRecordFailure();
  expectNoSecrets(error, [distinctiveBlobIdentifier]);
});

test("public authentication errors contain no workspaceTag", async () => {
  const tag = await workspaceTag(u, c);
  const { error } = await captureTamperedRecordFailure();
  expectNoSecrets(error, [tag]);
});

test("public errors contain no raw CryptoKey details", async () => {
  const extractableKey = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
  const error = await captureRejection(encryptBytes(extractableKey, recordPlaintext, buildRecordAad()));
  expect(error.code).toBe(VaultCryptoErrorCode.INVALID_INPUT);
  expectNoSecrets(error, [
    JSON.stringify(extractableKey.algorithm),
    Array.from(extractableKey.usages).join(","),
    "extractable",
  ]);
});

test("invalid input uses the stable INVALID_INPUT code", async () => {
  const error = await captureRejection(deriveKek(password, bytes(1)));
  expect(error).toBeInstanceOf(VaultCryptoError);
  expect(error.code).toBe(VaultCryptoErrorCode.INVALID_INPUT);
  expect(error.name).toBe("VaultCryptoError");
});

test("unsupported environment uses the stable UNSUPPORTED_ENVIRONMENT code", async () => {
  await withGlobalCrypto(undefined, async () => {
    const error = await captureRejection(generateDek());
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error.code).toBe(VaultCryptoErrorCode.UNSUPPORTED_ENVIRONMENT);
    expect(error.name).toBe("VaultCryptoError");
  });
});

test("unsupported KDF policy uses the stable UNSUPPORTED_KDF_POLICY code", async () => {
  const error = await captureRejection(deriveKek(password, salt, TEST_ONLY_KDF_PROFILE));
  expect(error).toBeInstanceOf(VaultCryptoError);
  expect(error.code).toBe(VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY);
  expect(error.name).toBe("VaultCryptoError");
});

test("authentication failure uses the stable CRYPTO_AUTHENTICATION_FAILED code", async () => {
  const { error } = await captureTamperedRecordFailure();
  expect(error).toBeInstanceOf(VaultCryptoError);
  expect(error.code).toBe(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
  expect(error.name).toBe("VaultCryptoError");
});

test("non-authentication crypto failure uses the stable CRYPTO_OPERATION_FAILED code", async () => {
  const restore = setTestArgon2Adapter(jest.fn(async () => { throw new Error("ADAPTER-INTERNAL-FAILURE-4c7e"); }));
  try {
    const error = await captureRejection(deriveKek(password, salt));
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error.code).toBe(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED);
    expectNoSecrets(error, ["ADAPTER-INTERNAL-FAILURE-4c7e"]);
  } finally {
    restore();
  }
});

test("authentication failures do not expose raw DOMException messages", async () => {
  const { error } = await captureTamperedRecordFailure();
  expect(error).toBeInstanceOf(VaultCryptoError);
  expect(error).not.toBeInstanceOf(globalThis.DOMException);
  expect(error.cause).toBeUndefined();
  expect(error.message).toBe("Record authentication failed.");
  expect(error.message).not.toMatch(/DOMException|OperationError|operation-specific|Cipher job failed/i);
});

// ---------------------------------------------------------------------------
// ISO-15C-R4: final crypto API hardening
// ---------------------------------------------------------------------------

const vaultCryptoModule = require("./vaultCrypto");

test("the sentinel payload is not exported as mutable bytes", () => {
  expect(vaultCryptoModule.VAULT_SENTINEL_BYTES).toBeUndefined();
  const exportedTypedArrays = Object.keys(vaultCryptoModule).filter((name) => ArrayBuffer.isView(vaultCryptoModule[name]));
  expect(exportedTypedArrays).toEqual([]);
});

test("mutating a caller-owned sentinel ciphertext cannot change the fixed sentinel payload", async () => {
  const dek = await generateDek();
  const first = await createSentinel(dek, canonicalSentinelAad);
  first.ciphertext.fill(0);
  first.iv.fill(0);
  const second = await createSentinel(dek, canonicalSentinelAad);
  await expect(verifySentinel(dek, second.ciphertext, second.iv, canonicalSentinelAad)).resolves.toBe(true);
});

test("sentinel creation remains stable across repeated calls", async () => {
  const dek = await generateDek();
  const ivs = new Set();
  for (let i = 0; i < 8; i += 1) {
    const sentinel = await createSentinel(dek, canonicalSentinelAad);
    ivs.add(toHex(sentinel.iv));
    await expect(verifySentinel(dek, sentinel.ciphertext, sentinel.iv, canonicalSentinelAad)).resolves.toBe(true);
  }
  expect(ivs.size).toBe(8);
});

test("recordAad rejects a missing options object with INVALID_INPUT", () => {
  expect(() => recordAad()).toThrow(VaultCryptoError);
  expect(() => recordAad(undefined)).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
});

test("keyWrapAad rejects null options with INVALID_INPUT", () => {
  expect(() => keyWrapAad(null)).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
});

test("sentinelAad rejects array options with INVALID_INPUT", () => {
  expect(() => sentinelAad([])).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
});

test("migrationManifestAad rejects non-object options with INVALID_INPUT", () => {
  [42, "options", true, Symbol("options")].forEach((value) => {
    expect(() => migrationManifestAad(value)).toThrow(expect.objectContaining({ code: VaultCryptoErrorCode.INVALID_INPUT }));
  });
});

test("AAD-builder invalid-input errors expose no raw destructuring TypeError", () => {
  const builders = [recordAad, keyWrapAad, sentinelAad, migrationManifestAad];
  const badContainers = [undefined, null, [], 42, "options"];
  builders.forEach((builder) => {
    badContainers.forEach((container) => {
      let error;
      try { builder(container); } catch (caught) { error = caught; }
      expect(error).toBeInstanceOf(VaultCryptoError);
      expect(error).not.toBeInstanceOf(TypeError);
      expect(error.code).toBe(VaultCryptoErrorCode.INVALID_INPUT);
      const surfaces = errorSurfaces(error);
      expect(surfaces).not.toMatch(/Cannot destructure/i);
      expect(surfaces).not.toMatch(/Cannot read propert/i);
      expect(surfaces).not.toMatch(/of undefined|of null/i);
    });
  });
});

test("deriveKek accepts the v1 maximum of ten iterations", async () => {
  const adapter = jest.fn(async () => new Uint8Array(32));
  const restore = setTestArgon2Adapter(adapter);
  try {
    const key = await deriveKek(password, salt, { algorithm: "argon2id", memorySize: 65536, iterations: 10, parallelism: 1, hashLength: 32, outputType: "binary" });
    expect(key.algorithm).toMatchObject({ name: "AES-GCM", length: 256 });
    expect(adapter).toHaveBeenCalledTimes(1);
    expect(adapter.mock.calls[0][0].iterations).toBe(10);
  } finally {
    restore();
  }
});

test("deriveKek rejects iterations above ten", async () => {
  await expectCode(deriveKek(password, salt, { algorithm: "argon2id", memorySize: 65536, iterations: 11, parallelism: 1, hashLength: 32, outputType: "binary" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY);
  expect(() => validateKdfParameters({ algorithm: "argon2id", memorySize: 65536, iterations: 11, parallelism: 1, hashLength: 32, outputType: "binary" })).toThrow(VaultCryptoError);
});

test("iterations above ten are rejected before Argon2 executes", async () => {
  const adapter = jest.fn(async () => new Uint8Array(32));
  const restore = setTestArgon2Adapter(adapter);
  try {
    await expectCode(deriveKek(password, salt, { algorithm: "argon2id", memorySize: 65536, iterations: 1000, parallelism: 1, hashLength: 32, outputType: "binary" }), VaultCryptoErrorCode.UNSUPPORTED_KDF_POLICY);
    expect(adapter).not.toHaveBeenCalled();
  } finally {
    restore();
  }
});

const spoofedAesKey = () => ({
  type: "secret",
  extractable: false,
  algorithm: { name: "AES-GCM", length: 256 },
  usages: ["encrypt", "decrypt"],
});

test("a structurally spoofed AES key object is rejected", async () => {
  const spoof = spoofedAesKey();
  await expectCode(encryptBytes(spoof, recordPlaintext, buildRecordAad()), VaultCryptoErrorCode.INVALID_INPUT);
  await expectCode(decryptBytes(spoof, bytes(1, 2, 3), bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), buildRecordAad()), VaultCryptoErrorCode.INVALID_INPUT);
});

test("a structurally spoofed key is rejected before Web Crypto encrypt executes", async () => {
  const encryptSpy = jest.fn(async () => { throw new Error("encrypt must not run"); });
  await withGlobalCrypto(cryptoWithSubtleOverrides({ encrypt: encryptSpy }), async () => {
    await expectCode(encryptBytes(spoofedAesKey(), recordPlaintext, buildRecordAad()), VaultCryptoErrorCode.INVALID_INPUT);
    expect(encryptSpy).not.toHaveBeenCalled();
  });
});

test("a structurally spoofed key is rejected before Web Crypto decrypt executes", async () => {
  const decryptSpy = jest.fn(async () => { throw new Error("decrypt must not run"); });
  await withGlobalCrypto(cryptoWithSubtleOverrides({ decrypt: decryptSpy }), async () => {
    await expectCode(decryptBytes(spoofedAesKey(), bytes(1, 2, 3), bytes(1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12), buildRecordAad()), VaultCryptoErrorCode.INVALID_INPUT);
    expect(decryptSpy).not.toHaveBeenCalled();
  });
});

function operationError(message) {
  const error = new Error(message);
  error.name = "OperationError";
  return error;
}

test("a callable decrypt throwing OperationError maps to authentication failure", async () => {
  const dek = await generateDek();
  const recordAadBytes = buildRecordAad();
  const encrypted = await encryptBytes(dek, recordPlaintext, recordAadBytes);
  const failingDecrypt = jest.fn(async () => { throw operationError("OP-ERROR-INTERNAL-5b1d"); });
  await withGlobalCrypto(cryptoWithSubtleOverrides({ decrypt: failingDecrypt }), async () => {
    const error = await captureRejection(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, recordAadBytes));
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error.code).toBe(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
    expect(error.message).toBe("Record authentication failed.");
    expect(failingDecrypt).toHaveBeenCalledTimes(1);
    expectNoSecrets(error, ["OP-ERROR-INTERNAL-5b1d"]);
  });
});

test("a callable decrypt throwing a non-OperationError maps to crypto operation failure", async () => {
  const dek = await generateDek();
  const recordAadBytes = buildRecordAad();
  const encrypted = await encryptBytes(dek, recordPlaintext, recordAadBytes);
  const failingDecrypt = jest.fn(async () => { throw new Error("DECRYPT-INTERNAL-2e9f"); });
  await withGlobalCrypto(cryptoWithSubtleOverrides({ decrypt: failingDecrypt }), async () => {
    const error = await captureRejection(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, recordAadBytes));
    expect(error).toBeInstanceOf(VaultCryptoError);
    expect(error.code).toBe(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED);
    expect(error.code).not.toBe(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
    expect(failingDecrypt).toHaveBeenCalledTimes(1);
  });
});

test("non-authentication decrypt failure exposes no raw browser error", async () => {
  const dek = await generateDek();
  const recordAadBytes = buildRecordAad();
  const encrypted = await encryptBytes(dek, recordPlaintext, recordAadBytes);
  const failingDecrypt = jest.fn(async () => {
    const error = new Error("RAW-BROWSER-DETAIL-77c3");
    error.name = "NotSupportedError";
    throw error;
  });
  await withGlobalCrypto(cryptoWithSubtleOverrides({ decrypt: failingDecrypt }), async () => {
    const error = await captureRejection(decryptBytes(dek, encrypted.ciphertext, encrypted.iv, recordAadBytes));
    expect(error.code).toBe(VaultCryptoErrorCode.CRYPTO_OPERATION_FAILED);
    expect(error.message).toBe("Cryptographic operation failed.");
    expect(error.cause).toBeUndefined();
    expect(error.name).toBe("VaultCryptoError");
    expectNoSecrets(error, ["RAW-BROWSER-DETAIL-77c3", "NotSupportedError"]);
  });
});

test("wrong key and authenticated-envelope tampering remain indistinguishable", async () => {
  const dek = await generateDek();
  const otherDek = await generateDek();
  const recordAadBytes = buildRecordAad();
  const encrypted = await encryptBytes(dek, recordPlaintext, recordAadBytes);
  const tamperedCiphertext = encrypted.ciphertext.slice();
  tamperedCiphertext[0] ^= 1;
  const tamperedIv = encrypted.iv.slice();
  tamperedIv[0] ^= 1;
  const results = await Promise.allSettled([
    decryptBytes(otherDek, encrypted.ciphertext, encrypted.iv, recordAadBytes),
    decryptBytes(dek, tamperedCiphertext, encrypted.iv, recordAadBytes),
    decryptBytes(dek, encrypted.ciphertext, tamperedIv, recordAadBytes),
    decryptBytes(dek, encrypted.ciphertext, encrypted.iv, buildRecordAad({ blobIdentifier: "different-blob" })),
    decryptBytes(dek, encrypted.ciphertext.slice(0, encrypted.ciphertext.length - 4), encrypted.iv, recordAadBytes),
    decryptBytes(dek, encrypted.ciphertext.slice(0, 4), encrypted.iv, recordAadBytes),
  ]);
  results.forEach((result) => {
    expect(result.status).toBe("rejected");
    expect(result.reason.code).toBe(VaultCryptoErrorCode.CRYPTO_AUTHENTICATION_FAILED);
    expect(result.reason.message).toBe(results[0].reason.message);
    expect(result.reason.name).toBe(results[0].reason.name);
  });
});
