import {
  ACCOUNT_SCOPED_STORAGE_ERROR,
  DEVICE_GLOBAL_LOGICAL_KEYS,
  WORKSPACE_MARKER_LOGICAL_KEY,
  WORKSPACE_NAMESPACE_PREFIX,
  activateAccountScopedLocalStorage,
  buildAccountWorkspaceNamespace,
  buildScopedStorageKey,
  QUARANTINED_LEGACY_LOGICAL_KEYS,
  deactivateAccountScopedLocalStorage,
  getActiveAccountWorkspaceNamespace,
  inspectAccountScopedWorkspace,
  isWorkspaceScopedLogicalKey,
} from "./accountScopedLocalStorage";
import { STORAGE_KEYS } from "../constants/storageKeys";

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const COMPANY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// Unmistakable pre-existing values. Nothing in this suite may ever surface them
// through a scoped workspace.
const LEGACY_COMPANY = JSON.stringify({ companyName: "BVW" });
const LEGACY_CUSTOMERS = JSON.stringify([{ name: "Legacy BVW Customer", balance: "20508" }]);

function createFakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    get length() { return map.size; },
    key(index) { return Array.from(map.keys())[index] ?? null; },
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(String(key), String(value)); },
    removeItem(key) { map.delete(String(key)); },
    clear() { map.clear(); },
  };
}

function seedLegacy(storage) {
  storage.setItem(STORAGE_KEYS.COMPANY_PROFILE, LEGACY_COMPANY);
  storage.setItem(STORAGE_KEYS.CUSTOMERS, LEGACY_CUSTOMERS);
  storage.setItem(STORAGE_KEYS.ESTIMATES, "[]");
  storage.setItem(STORAGE_KEYS.LANG, "en");
  storage.setItem("estipaid-device-id-v1", "device-1");
  storage.setItem("sb-localhost-auth-token", "supabase-session");
  storage.setItem("debug", "1");
  storage.setItem("shopify-selector", "kept");
}

function open(storage, userId, companyId) {
  const result = activateAccountScopedLocalStorage({ storage, userId, companyId });
  expect(result.ok).toBe(true);
  return result.storage;
}

afterEach(() => deactivateAccountScopedLocalStorage());

describe("namespace derivation", () => {
  // 1-3: the namespace is a pure function of the immutable identity pair.
  test("1. user A + company A produces a deterministic namespace", () => {
    const first = buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A });
    const second = buildAccountWorkspaceNamespace({ userId: ` ${USER_A} `, companyId: COMPANY_A });
    expect(first).toBe(`${WORKSPACE_NAMESPACE_PREFIX}:${USER_A}:${COMPANY_A}`);
    expect(second).toBe(first);
  });

  test("2. a different user on the same company gets a different namespace", () => {
    expect(buildAccountWorkspaceNamespace({ userId: USER_B, companyId: COMPANY_A }))
      .not.toBe(buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A }));
  });

  test("3. the same user on a different company gets a different namespace", () => {
    expect(buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_B }))
      .not.toBe(buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A }));
  });

  test("incomplete identity yields no namespace and no scoped key", () => {
    expect(buildAccountWorkspaceNamespace({ userId: USER_A })).toBe("");
    expect(buildAccountWorkspaceNamespace({ userId: "  ", companyId: COMPANY_A })).toBe("");
    expect(buildScopedStorageKey({ namespace: "", logicalKey: STORAGE_KEYS.CUSTOMERS })).toBe("");
  });

  test("identity separators cannot be injected across segments", () => {
    const spoofed = buildAccountWorkspaceNamespace({ userId: `${USER_A}:${COMPANY_A}`, companyId: USER_B });
    const genuine = buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A });
    expect(spoofed).not.toBe(genuine);
    expect(spoofed.split(":")).toHaveLength(3);
  });

  test("only EstiPaid business keys are scoped", () => {
    expect(isWorkspaceScopedLogicalKey(STORAGE_KEYS.COMPANY_PROFILE)).toBe(true);
    expect(isWorkspaceScopedLogicalKey(STORAGE_KEYS.CLOUD_BACKUP_QUEUE)).toBe(true);
    expect(isWorkspaceScopedLogicalKey(STORAGE_KEYS.SUBSCRIPTION_PLAN_STATE)).toBe(true);
    DEVICE_GLOBAL_LOGICAL_KEYS.forEach((key) => expect(isWorkspaceScopedLogicalKey(key)).toBe(false));
    expect(isWorkspaceScopedLogicalKey("sb-localhost-auth-token")).toBe(false);
    expect(isWorkspaceScopedLogicalKey("debug")).toBe(false);
    expect(isWorkspaceScopedLogicalKey(`${WORKSPACE_NAMESPACE_PREFIX}:x:y:estipaid-customers-v1`)).toBe(false);
  });

  test("every non-language STORAGE_KEYS entry is scoped", () => {
    Object.values(STORAGE_KEYS).forEach((key) => {
      expect(isWorkspaceScopedLogicalKey(key)).toBe(key !== STORAGE_KEYS.LANG);
    });
  });
});

describe("scoped reads and writes", () => {
  // 4-6: logical calls land on physical namespaced keys, and only there.
  test("4. a logical company-profile write becomes a scoped physical write", () => {
    const storage = createFakeStorage();
    const scoped = open(storage, USER_A, COMPANY_A);
    scoped.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ companyName: "Scoped Co" }));

    const namespace = buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A });
    expect(storage.getItem(`${namespace}:${STORAGE_KEYS.COMPANY_PROFILE}`)).toBe(JSON.stringify({ companyName: "Scoped Co" }));
    expect(storage.getItem(STORAGE_KEYS.COMPANY_PROFILE)).toBeNull();
  });

  test("5. a logical customer read uses only the scoped physical key", () => {
    const storage = createFakeStorage();
    const namespace = buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A });
    storage.setItem(`${namespace}:${STORAGE_KEYS.CUSTOMERS}`, "scoped-customers");
    storage.setItem(STORAGE_KEYS.CUSTOMERS, LEGACY_CUSTOMERS);

    const getItem = jest.spyOn(storage, "getItem");
    const scoped = open(storage, USER_A, COMPANY_A);
    expect(scoped.getItem(STORAGE_KEYS.CUSTOMERS)).toBe("scoped-customers");
    expect(getItem.mock.calls.map(([key]) => key)).not.toContain(STORAGE_KEYS.CUSTOMERS);
    getItem.mockRestore();
  });

  test("6. a missing scoped value reads as null", () => {
    const storage = createFakeStorage();
    const scoped = open(storage, USER_A, COMPANY_A);
    expect(scoped.getItem(STORAGE_KEYS.ESTIMATES)).toBeNull();
  });

  // 7: the forbidden fallback.
  test("7. a missing scoped value NEVER falls back to the legacy unscoped value", () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    const scoped = open(storage, USER_A, COMPANY_A);

    expect(scoped.getItem(STORAGE_KEYS.COMPANY_PROFILE)).toBeNull();
    expect(scoped.getItem(STORAGE_KEYS.CUSTOMERS)).toBeNull();
    expect(scoped.getItem(STORAGE_KEYS.ESTIMATES)).toBeNull();
    // ...and the legacy values are still exactly where they were.
    expect(storage.getItem(STORAGE_KEYS.COMPANY_PROFILE)).toBe(LEGACY_COMPANY);
    expect(storage.getItem(STORAGE_KEYS.CUSTOMERS)).toBe(LEGACY_CUSTOMERS);
  });

  test("legacy business keys are invisible to enumeration", () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    const scoped = open(storage, USER_A, COMPANY_A);

    const visible = [];
    for (let index = 0; index < scoped.length; index += 1) visible.push(scoped.key(index));
    expect(visible).not.toContain(STORAGE_KEYS.COMPANY_PROFILE);
    expect(visible).not.toContain(STORAGE_KEYS.CUSTOMERS);
    expect(visible).toEqual(expect.arrayContaining([STORAGE_KEYS.LANG, "estipaid-device-id-v1", "sb-localhost-auth-token", "debug", "shopify-selector"]));
    expect(JSON.stringify(visible)).not.toContain("BVW");
  });

  // 8: removal is scoped too.
  test("8. removal affects only the active scoped key", () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    const scoped = open(storage, USER_A, COMPANY_A);
    scoped.setItem(STORAGE_KEYS.CUSTOMERS, "mine");
    scoped.removeItem(STORAGE_KEYS.CUSTOMERS);

    const namespace = buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A });
    expect(storage.getItem(`${namespace}:${STORAGE_KEYS.CUSTOMERS}`)).toBeNull();
    expect(storage.getItem(STORAGE_KEYS.CUSTOMERS)).toBe(LEGACY_CUSTOMERS);
  });

  // 9-12: what must never be touched.
  test("9. language stays device-global", () => {
    const storage = createFakeStorage();
    const scoped = open(storage, USER_A, COMPANY_A);
    scoped.setItem(STORAGE_KEYS.LANG, "es");
    expect(storage.getItem(STORAGE_KEYS.LANG)).toBe("es");
    expect(scoped.getItem(STORAGE_KEYS.LANG)).toBe("es");
  });

  test("10. the device id stays device-global across two accounts", () => {
    const storage = createFakeStorage();
    open(storage, USER_A, COMPANY_A).setItem("estipaid-device-id-v1", "device-1");
    expect(open(storage, USER_B, COMPANY_B).getItem("estipaid-device-id-v1")).toBe("device-1");
    expect(storage.getItem("estipaid-device-id-v1")).toBe("device-1");
  });

  test("11. Supabase sb-* auth keys are passed through untouched", () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    const scoped = open(storage, USER_A, COMPANY_A);
    expect(scoped.getItem("sb-localhost-auth-token")).toBe("supabase-session");
    scoped.setItem("sb-localhost-auth-token", "rotated");
    expect(storage.getItem("sb-localhost-auth-token")).toBe("rotated");
    expect(Array.from(storage.map.keys()).filter((key) => key.includes("sb-localhost-auth-token"))).toEqual(["sb-localhost-auth-token"]);
  });

  test("12. unrelated origin keys are untouched", () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    const scoped = open(storage, USER_A, COMPANY_A);
    expect(scoped.getItem("debug")).toBe("1");
    expect(scoped.getItem("shopify-selector")).toBe("kept");
    expect(storage.getItem("debug")).toBe("1");
  });

  test("another workspace's physical keys cannot be reached directly", () => {
    const storage = createFakeStorage();
    const otherNamespace = buildAccountWorkspaceNamespace({ userId: USER_B, companyId: COMPANY_B });
    storage.setItem(`${otherNamespace}:${STORAGE_KEYS.CUSTOMERS}`, "user-b-records");
    const scoped = open(storage, USER_A, COMPANY_A);

    expect(scoped.getItem(`${otherNamespace}:${STORAGE_KEYS.CUSTOMERS}`)).toBeNull();
    scoped.removeItem(`${otherNamespace}:${STORAGE_KEYS.CUSTOMERS}`);
    expect(storage.getItem(`${otherNamespace}:${STORAGE_KEYS.CUSTOMERS}`)).toBe("user-b-records");
  });

  test("wrapped and custom-string foreign physical keys are blocked after coercion", () => {
    const storage = createFakeStorage();
    const otherNamespace = buildAccountWorkspaceNamespace({ userId: USER_B, companyId: COMPANY_B });
    const foreignKey = `${otherNamespace}:${STORAGE_KEYS.CUSTOMERS}`;
    storage.setItem(foreignKey, "user-b-records");
    const scoped = open(storage, USER_A, COMPANY_A);
    [new String(foreignKey), { toString: () => foreignKey }].forEach((wrappedKey) => {
      expect(scoped.getItem(wrappedKey)).toBeNull();
      scoped.setItem(wrappedKey, "attacker-write");
      scoped.removeItem(wrappedKey);
      expect(storage.getItem(foreignKey)).toBe("user-b-records");
    });
    expect(scoped.getItem(42)).toBeNull();
    expect(scoped.getItem(null)).toBeNull();
    expect(scoped.getItem(undefined)).toBeNull();
  });

  test("the facade exposes no public real-storage escape property or symbol", () => {
    const storage = createFakeStorage();
    const scoped = open(storage, USER_A, COMPANY_A);
    expect(scoped.__estipaidRealStorage).toBeUndefined();
    expect(Object.getOwnPropertyNames(scoped)).not.toContain("__estipaidRealStorage");
    expect(Object.getOwnPropertySymbols(scoped).some((symbol) => scoped[symbol] === storage)).toBe(false);
  });

  test("every Field Pocket key is unreadable, unwriteable, unremovable, and invisible", () => {
    const storage = createFakeStorage({
      "field-pocket-language": "Legacy Field Pocket BVW",
      "field-pocket-profile-v1": "Legacy Field Pocket BVW",
      "field-pocket-customers-v1": "Legacy Field Pocket Customer 20508",
      "field-pocket-estimates": "20508",
      "field-pocket-invoices-v1": "20508",
    });
    const original = Array.from(storage.map.entries());
    const scoped = open(storage, USER_A, COMPANY_A);
    Array.from(storage.map.keys()).filter((key) => key.startsWith("field-pocket-")).forEach((key) => {
      [key, new String(key), { toString: () => key }].forEach((representation) => expect(scoped.getItem(representation)).toBeNull());
      scoped.setItem(key, "overwrite"); scoped.removeItem(key);
    });
    scoped.clear();
    const enumerated = Array.from({ length: scoped.length }, (_, index) => scoped.key(index));
    expect(enumerated.some((key) => key.startsWith("field-pocket-"))).toBe(false);
    expect(JSON.stringify(enumerated)).not.toMatch(/Legacy Field Pocket|20508/);
    expect(Array.from(storage.map.entries())).toEqual(expect.arrayContaining(original));
  });
});

describe("identity switching", () => {
  // 13-14.
  test("13. switching identity changes the active namespace", () => {
    const storage = createFakeStorage();
    open(storage, USER_A, COMPANY_A).setItem(STORAGE_KEYS.CUSTOMERS, "A records");
    const namespaceA = getActiveAccountWorkspaceNamespace();

    const scopedB = open(storage, USER_B, COMPANY_A);
    expect(getActiveAccountWorkspaceNamespace()).not.toBe(namespaceA);
    expect(scopedB.getItem(STORAGE_KEYS.CUSTOMERS)).toBeNull();
  });

  test("14. returning to the same identity restores the same namespace and records", () => {
    const storage = createFakeStorage();
    open(storage, USER_A, COMPANY_A).setItem(STORAGE_KEYS.CUSTOMERS, "A records");
    const namespaceA = getActiveAccountWorkspaceNamespace();

    open(storage, USER_B, COMPANY_A).setItem(STORAGE_KEYS.CUSTOMERS, "B records");

    const scopedA = open(storage, USER_A, COMPANY_A);
    expect(getActiveAccountWorkspaceNamespace()).toBe(namespaceA);
    expect(scopedA.getItem(STORAGE_KEYS.CUSTOMERS)).toBe("A records");
  });

  test("the same user with a different company gets a separate empty workspace", () => {
    const storage = createFakeStorage();
    open(storage, USER_A, COMPANY_A).setItem(STORAGE_KEYS.ESTIMATES, "company A estimates");
    expect(open(storage, USER_A, COMPANY_B).getItem(STORAGE_KEYS.ESTIMATES)).toBeNull();
    expect(open(storage, USER_A, COMPANY_A).getItem(STORAGE_KEYS.ESTIMATES)).toBe("company A estimates");
  });

  test("deactivation clears the active namespace", () => {
    const storage = createFakeStorage();
    open(storage, USER_A, COMPANY_A);
    deactivateAccountScopedLocalStorage();
    expect(getActiveAccountWorkspaceNamespace()).toBe("");
  });
});

describe("fail-closed activation", () => {
  // 15.
  test("15. incomplete identity fails closed", () => {
    const result = activateAccountScopedLocalStorage({ storage: createFakeStorage(), userId: USER_A, companyId: "" });
    expect(result).toEqual(expect.objectContaining({ ok: false, namespace: "", storage: null, error: ACCOUNT_SCOPED_STORAGE_ERROR.INCOMPLETE_IDENTITY }));
    expect(getActiveAccountWorkspaceNamespace()).toBe("");
  });

  test("15b. unusable storage fails closed", () => {
    const result = activateAccountScopedLocalStorage({ storage: null, userId: USER_A, companyId: COMPANY_A });
    expect(result.ok).toBe(false);
    expect(result.storage).toBeNull();
    expect(getActiveAccountWorkspaceNamespace()).toBe("");
  });

  test("15c. a marker that cannot be written fails closed and mounts nothing", () => {
    const storage = createFakeStorage();
    storage.setItem = () => { throw new Error("quota"); };
    const result = activateAccountScopedLocalStorage({ storage, userId: USER_A, companyId: COMPANY_A });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(ACCOUNT_SCOPED_STORAGE_ERROR.MARKER_UNVERIFIED);
    expect(getActiveAccountWorkspaceNamespace()).toBe("");
  });

  test("15d. a marker that cannot be verified fails closed", () => {
    const storage = createFakeStorage();
    storage.setItem = () => {}; // silently drops the write
    const result = activateAccountScopedLocalStorage({ storage, userId: USER_A, companyId: COMPANY_A });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(ACCOUNT_SCOPED_STORAGE_ERROR.MARKER_UNVERIFIED);
  });

  test("15e. a marker naming another identity is not accepted", () => {
    const storage = createFakeStorage();
    const namespace = buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A });
    storage.setItem = (key, value) => {
      if (key === `${namespace}:${WORKSPACE_MARKER_LOGICAL_KEY}`) {
        storage.map.set(key, JSON.stringify({ version: "estipaid-workspace-marker-v1", userId: USER_B, companyId: COMPANY_B, boundAt: "2026-07-25T00:00:00.000Z" }));
        return;
      }
      storage.map.set(key, String(value));
    };
    const result = activateAccountScopedLocalStorage({ storage, userId: USER_A, companyId: COMPANY_A });
    expect(result.ok).toBe(false);
    expect(result.error).toBe(ACCOUNT_SCOPED_STORAGE_ERROR.MARKER_UNVERIFIED);
  });

  // 16.
  test("16. a broad clear cannot wipe another workspace, legacy data, or the origin", () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    const otherNamespace = buildAccountWorkspaceNamespace({ userId: USER_B, companyId: COMPANY_B });
    storage.setItem(`${otherNamespace}:${STORAGE_KEYS.CUSTOMERS}`, "user-b-records");

    const scoped = open(storage, USER_A, COMPANY_A);
    scoped.setItem(STORAGE_KEYS.CUSTOMERS, "mine");
    scoped.clear();

    const namespaceA = buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A });
    expect(storage.getItem(`${namespaceA}:${STORAGE_KEYS.CUSTOMERS}`)).toBeNull();
    expect(storage.getItem(`${otherNamespace}:${STORAGE_KEYS.CUSTOMERS}`)).toBe("user-b-records");
    expect(storage.getItem(STORAGE_KEYS.CUSTOMERS)).toBe(LEGACY_CUSTOMERS);
    expect(storage.getItem(STORAGE_KEYS.COMPANY_PROFILE)).toBe(LEGACY_COMPANY);
    expect(storage.getItem(STORAGE_KEYS.LANG)).toBe("en");
    expect(storage.getItem("estipaid-device-id-v1")).toBe("device-1");
    expect(storage.getItem("sb-localhost-auth-token")).toBe("supabase-session");
    expect(storage.getItem("debug")).toBe("1");
  });

  // 17.
  test("17. activation never reads a legacy unscoped value", () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    const getItem = jest.spyOn(storage, "getItem");
    const removeItem = jest.spyOn(storage, "removeItem");

    activateAccountScopedLocalStorage({ storage, userId: USER_A, companyId: COMPANY_A });

    const readKeys = getItem.mock.calls.map(([key]) => key);
    expect(readKeys).toEqual([`${buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A })}:${WORKSPACE_MARKER_LOGICAL_KEY}`]);
    expect(readKeys).not.toContain(STORAGE_KEYS.COMPANY_PROFILE);
    expect(readKeys).not.toContain(STORAGE_KEYS.CUSTOMERS);
    expect(removeItem).not.toHaveBeenCalled();
    getItem.mockRestore();
    removeItem.mockRestore();
  });

  // 18.
  test("18. no token, email, or company name is written into the namespace or marker", () => {
    const storage = createFakeStorage();
    const result = activateAccountScopedLocalStorage({ storage, userId: USER_A, companyId: COMPANY_A });
    const physicalKeys = Array.from(storage.map.keys());
    const everything = JSON.stringify({ namespace: result.namespace, physicalKeys, values: Array.from(storage.map.values()) });

    ["owner@example.test", "BVW", "access_token", "refresh_token", "sb-", "eyJ", "sk_live", "cus_", "http://", "https://"]
      .forEach((secret) => expect(everything).not.toContain(secret));
    expect(result.marker).toEqual({
      version: "estipaid-workspace-marker-v1",
      userId: USER_A,
      companyId: COMPANY_A,
      boundAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });
});

describe("inspectAccountScopedWorkspace", () => {
  test("reports only this workspace's logical keys", () => {
    const storage = createFakeStorage();
    seedLegacy(storage);
    open(storage, USER_A, COMPANY_A).setItem(STORAGE_KEYS.PROJECTS, "projects");
    open(storage, USER_B, COMPANY_B).setItem(STORAGE_KEYS.INVOICES, "invoices");

    const a = inspectAccountScopedWorkspace({ storage, userId: USER_A, companyId: COMPANY_A });
    expect(a.ok).toBe(true);
    expect(a.logicalKeys).toEqual([STORAGE_KEYS.PROJECTS]);
    expect(a.marker).toEqual(expect.objectContaining({ userId: USER_A, companyId: COMPANY_A }));

    const b = inspectAccountScopedWorkspace({ storage, userId: USER_B, companyId: COMPANY_B });
    expect(b.logicalKeys).toEqual([STORAGE_KEYS.INVOICES]);
  });

  test("fails closed on an incomplete identity", () => {
    expect(inspectAccountScopedWorkspace({ storage: createFakeStorage(), userId: "", companyId: COMPANY_A }))
      .toEqual(expect.objectContaining({ ok: false, error: ACCOUNT_SCOPED_STORAGE_ERROR.INCOMPLETE_IDENTITY }));
  });
});

describe("global window.localStorage compatibility boundary", () => {
  afterEach(() => deactivateAccountScopedLocalStorage());

  test("direct localStorage calls route into the active namespace and restore on deactivate", () => {
    localStorage.clear();
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, LEGACY_COMPANY);
    const real = window.localStorage;

    const result = activateAccountScopedLocalStorage({ storage: window.localStorage, userId: USER_A, companyId: COMPANY_A });
    expect(result.ok).toBe(true);
    expect(result.installed).toBe(true);

    // A module that captured nothing and simply calls the global sees only the
    // scoped workspace.
    expect(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE)).toBeNull();
    localStorage.setItem(STORAGE_KEYS.COMPANY_PROFILE, JSON.stringify({ companyName: "Scoped Co" }));

    deactivateAccountScopedLocalStorage();
    expect(window.localStorage).toBe(real);
    expect(localStorage.getItem(STORAGE_KEYS.COMPANY_PROFILE)).toBe(LEGACY_COMPANY);
    expect(localStorage.getItem(`${result.namespace}:${STORAGE_KEYS.COMPANY_PROFILE}`)).toBe(JSON.stringify({ companyName: "Scoped Co" }));
    localStorage.clear();
  });

  test("re-activating does not stack facades or double-prefix keys", () => {
    localStorage.clear();
    activateAccountScopedLocalStorage({ storage: window.localStorage, userId: USER_A, companyId: COMPANY_A });
    const second = activateAccountScopedLocalStorage({ storage: window.localStorage, userId: USER_A, companyId: COMPANY_A });
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, "once");

    deactivateAccountScopedLocalStorage();
    const physicalKeys = [];
    for (let index = 0; index < localStorage.length; index += 1) physicalKeys.push(localStorage.key(index));
    expect(physicalKeys).toContain(`${second.namespace}:${STORAGE_KEYS.CUSTOMERS}`);
    expect(physicalKeys.filter((key) => key.includes(`${WORKSPACE_NAMESPACE_PREFIX}:${USER_A}:${COMPANY_A}:${WORKSPACE_NAMESPACE_PREFIX}`))).toHaveLength(0);
    localStorage.clear();
  });
});

// ISO-14L -- cross-tab event bridge.
//
// A write from another tab arrives as a native `storage` event carrying the
// PHYSICAL namespaced key. The bridge is the single place that translates it
// back to the logical key the app already listens for.
describe("cross-tab storage event bridge", () => {
  const NAMESPACE_A = buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_A });
  const NAMESPACE_B = buildAccountWorkspaceNamespace({ userId: USER_B, companyId: COMPANY_B });

  let received = [];
  let listener = null;

  beforeEach(() => {
    localStorage.clear();
    received = [];
    listener = (event) => received.push(event.detail);
    window.addEventListener("pe-localstorage", listener);
  });

  afterEach(() => {
    window.removeEventListener("pe-localstorage", listener);
    deactivateAccountScopedLocalStorage();
    localStorage.clear();
  });

  // Synthetic native event: nothing real is written, so no browser data changes.
  function dispatchNativeStorageEvent({ key, newValue = null, oldValue = null }) {
    const event = new Event("storage");
    Object.assign(event, { key, newValue, oldValue, storageArea: null, url: "http://localhost/" });
    window.dispatchEvent(event);
  }

  function openWorkspace(userId = USER_A, companyId = COMPANY_A) {
    const activation = activateAccountScopedLocalStorage({ storage: window.localStorage, userId, companyId });
    expect(activation.ok).toBe(true);
    received = []; // ignore anything emitted by activation itself
    return activation;
  }

  test("1-4. an active-workspace physical event emits exactly one logical pe-localstorage event", () => {
    openWorkspace();
    dispatchNativeStorageEvent({
      key: `${NAMESPACE_A}:${STORAGE_KEYS.ESTIMATES}`,
      newValue: '[{"id":"est-new"}]',
      oldValue: "[]",
    });

    expect(received).toHaveLength(1);
    expect(received[0].key).toBe(STORAGE_KEYS.ESTIMATES);          // logical, not physical
    expect(received[0].value).toBe('[{"id":"est-new"}]');           // newValue preserved
    expect(received[0].oldValue).toBe("[]");                        // oldValue preserved
    expect(received[0].crossTab).toBe(true);
    // The physical namespace never leaves the bridge.
    expect(JSON.stringify(received[0])).not.toContain(WORKSPACE_NAMESPACE_PREFIX);
    expect(JSON.stringify(received[0])).not.toContain(USER_A);
    expect(JSON.stringify(received[0])).not.toContain(COMPANY_A);
  });

  test("5. a foreign workspace event emits nothing", () => {
    openWorkspace();
    dispatchNativeStorageEvent({ key: `${NAMESPACE_B}:${STORAGE_KEYS.CUSTOMERS}`, newValue: '[{"id":"user-b"}]' });
    // Same company, different user, and same user, different company, too.
    dispatchNativeStorageEvent({ key: `${buildAccountWorkspaceNamespace({ userId: USER_B, companyId: COMPANY_A })}:${STORAGE_KEYS.CUSTOMERS}`, newValue: "x" });
    dispatchNativeStorageEvent({ key: `${buildAccountWorkspaceNamespace({ userId: USER_A, companyId: COMPANY_B })}:${STORAGE_KEYS.CUSTOMERS}`, newValue: "x" });
    expect(received).toEqual([]);
  });

  test("6. unscoped legacy EstiPaid events emit nothing", () => {
    openWorkspace();
    [STORAGE_KEYS.CUSTOMERS, STORAGE_KEYS.ESTIMATES, STORAGE_KEYS.INVOICES, STORAGE_KEYS.PROJECTS, STORAGE_KEYS.COMPANY_PROFILE]
      .forEach((key) => dispatchNativeStorageEvent({ key, newValue: "legacy" }));
    expect(received).toEqual([]);
  });

  test("7. every Field Pocket event emits nothing", () => {
    openWorkspace();
    QUARANTINED_LEGACY_LOGICAL_KEYS.forEach((key) => dispatchNativeStorageEvent({ key, newValue: "field-pocket" }));
    // ...including one that has been namespaced by hand.
    dispatchNativeStorageEvent({ key: `${NAMESPACE_A}:field-pocket-customers-v1`, newValue: "spoofed" });
    expect(received).toEqual([]);
  });

  test("8. a workspace-marker event emits nothing", () => {
    openWorkspace();
    dispatchNativeStorageEvent({ key: `${NAMESPACE_A}:${WORKSPACE_MARKER_LOGICAL_KEY}`, newValue: "{}" });
    expect(received).toEqual([]);
  });

  test("device-global and Supabase auth events are never translated or duplicated", () => {
    openWorkspace();
    [...DEVICE_GLOBAL_LOGICAL_KEYS, "sb-localhost-auth-token", "debug", "shopify-selector"]
      .forEach((key) => dispatchNativeStorageEvent({ key, newValue: "value" }));
    expect(received).toEqual([]);
  });

  test("9. after deactivation the old workspace event emits nothing", () => {
    openWorkspace();
    deactivateAccountScopedLocalStorage();
    dispatchNativeStorageEvent({ key: `${NAMESPACE_A}:${STORAGE_KEYS.ESTIMATES}`, newValue: "[]" });
    expect(received).toEqual([]);
  });

  test("9b. a failed activation leaves no bridge behind", () => {
    openWorkspace();
    const failedActivation = activateAccountScopedLocalStorage({ storage: window.localStorage, userId: USER_A, companyId: "" });
    expect(failedActivation.ok).toBe(false);
    dispatchNativeStorageEvent({ key: `${NAMESPACE_A}:${STORAGE_KEYS.ESTIMATES}`, newValue: "[]" });
    expect(received).toEqual([]);
  });

  test("10. switching identity removes the previous bridge and installs exactly one new bridge", () => {
    openWorkspace(USER_A, COMPANY_A);
    openWorkspace(USER_B, COMPANY_B);

    // The previous workspace is no longer listened to...
    dispatchNativeStorageEvent({ key: `${NAMESPACE_A}:${STORAGE_KEYS.ESTIMATES}`, newValue: "[]" });
    expect(received).toEqual([]);

    // ...and the new one is, exactly once.
    dispatchNativeStorageEvent({ key: `${NAMESPACE_B}:${STORAGE_KEYS.ESTIMATES}`, newValue: '[{"id":"b"}]' });
    expect(received).toHaveLength(1);
    expect(received[0].key).toBe(STORAGE_KEYS.ESTIMATES);
  });

  test("11. re-activating the same identity does not create duplicate events", () => {
    openWorkspace();
    openWorkspace();
    openWorkspace();
    dispatchNativeStorageEvent({ key: `${NAMESPACE_A}:${STORAGE_KEYS.INVOICES}`, newValue: "[]" });
    expect(received).toHaveLength(1);
  });

  test("12. the bridge performs zero storage operations while translating", () => {
    openWorkspace();
    const spies = {
      getItem: jest.spyOn(Storage.prototype, "getItem"),
      setItem: jest.spyOn(Storage.prototype, "setItem"),
      removeItem: jest.spyOn(Storage.prototype, "removeItem"),
      clear: jest.spyOn(Storage.prototype, "clear"),
      key: jest.spyOn(Storage.prototype, "key"),
    };
    try {
      dispatchNativeStorageEvent({
        key: `${NAMESPACE_A}:${STORAGE_KEYS.PROJECTS}`,
        newValue: '[{"id":"p1"}]',
        oldValue: null,
      });
      expect(received).toHaveLength(1);
      Object.entries(spies).forEach(([name, spy]) => {
        expect({ [name]: spy.mock.calls.length }).toEqual({ [name]: 0 });
      });
    } finally {
      Object.values(spies).forEach((spy) => spy.mockRestore());
    }
  });

  test("the bridge is module-private: no export hands back a listener or the real Storage", () => {
    // eslint-disable-next-line global-require
    const moduleExports = require("./accountScopedLocalStorage");
    Object.entries(moduleExports).forEach(([name, value]) => {
      expect(name).not.toMatch(/listener|bridge|realStorage/i);
      expect(value).not.toBe(window.localStorage);
    });
    const activation = openWorkspace();
    expect(activation.storage).not.toBe(unwrapRealStorageForTest());
  });

  function unwrapRealStorageForTest() {
    // The genuine jsdom Storage instance, obtained without going through the
    // module, so the assertion above cannot be satisfied by an export.
    deactivateAccountScopedLocalStorage();
    return window.localStorage;
  }
});
