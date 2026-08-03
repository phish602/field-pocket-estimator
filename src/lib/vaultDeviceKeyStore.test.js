import { IDBFactory } from "fake-indexeddb";
import {
  createVaultDeviceKeyStore,
  VaultDeviceKeyError,
  VAULT_DEVICE_KEY_ERROR_CODES,
} from "./vaultDeviceKeyStore";

const workspaceTag = "A".repeat(43);
const originalStructuredClone = globalThis.structuredClone;

beforeAll(() => {
  if (!globalThis.crypto?.subtle) globalThis.crypto = require("crypto").webcrypto;
  globalThis.structuredClone = (value) => {
    if (value instanceof Uint8Array) return value.slice();
    if (value instanceof ArrayBuffer) return value.slice(0);
    if (Array.isArray(value)) return value.map((entry) => globalThis.structuredClone(entry));
    if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, globalThis.structuredClone(entry)]));
    }
    return value;
  };
});

afterAll(() => {
  if (originalStructuredClone === undefined) delete globalThis.structuredClone;
  else globalThis.structuredClone = originalStructuredClone;
});

function store() {
  return createVaultDeviceKeyStore({ indexedDB: new IDBFactory(), crypto: globalThis.crypto });
}

test("creates and reloads one non-extractable AES-256 key for the workspace", async () => {
  const deviceStore = store();
  const created = await deviceStore.getOrCreate({ workspaceTag });
  const loaded = await deviceStore.read({ workspaceTag });

  expect(created.type).toBe("secret");
  expect(created.extractable).toBe(false);
  expect(created.algorithm).toEqual(expect.objectContaining({ name: "AES-GCM", length: 256 }));
  expect(created.usages).toEqual(expect.arrayContaining(["encrypt", "decrypt"]));
  expect(loaded).toBeTruthy();
  expect(loaded.extractable).toBe(false);
});

test("a reloaded device key opens ciphertext written before the reload", async () => {
  const deviceStore = store();
  const first = await deviceStore.getOrCreate({ workspaceTag });
  const iv = new Uint8Array(12).fill(9);
  const plaintext = new TextEncoder().encode("estipaid-device-key-roundtrip");
  const ciphertext = await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, first, plaintext);

  const second = await deviceStore.getOrCreate({ workspaceTag });
  const opened = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv }, second, ciphertext);
  expect(new TextDecoder().decode(opened)).toBe("estipaid-device-key-roundtrip");
});

test("removal makes the workspace key unavailable without inventing a replacement on read", async () => {
  const deviceStore = store();
  await deviceStore.getOrCreate({ workspaceTag });
  await expect(deviceStore.remove({ workspaceTag })).resolves.toBe(true);
  await expect(deviceStore.read({ workspaceTag })).resolves.toBeNull();
});

test("invalid workspace input fails before IndexedDB or crypto work", async () => {
  const deviceStore = store();
  await expect(deviceStore.getOrCreate({ workspaceTag: "invalid" })).rejects.toEqual(
    expect.objectContaining({
      name: "VaultDeviceKeyError",
      code: VAULT_DEVICE_KEY_ERROR_CODES.INVALID_INPUT,
    })
  );
  await expect(deviceStore.read()).rejects.toBeInstanceOf(VaultDeviceKeyError);
});
