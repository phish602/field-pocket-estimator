/**
 * ISO-16 -- the synchronous authoritative storage surface.
 *
 * Existing application code calls localStorage synchronously in hundreds of
 * places. In authoritative mode those calls must be served by the encrypted
 * runtime with NO plaintext read and NO plaintext write, while keeping
 * localStorage's immediate read-after-write semantics.
 */
import {
  activateAccountScopedLocalStorage,
  deactivateAccountScopedLocalStorage,
  installAuthoritativeVaultRuntime,
  isAuthoritativeVaultRuntimeInstalled,
  revokeAuthoritativeVaultRuntime,
  setActiveWorkspaceVaultCompatibility,
  buildAccountWorkspaceNamespace,
} from "./accountScopedLocalStorage";

const USER = "11111111-2222-4333-8444-555555555555";
const COMPANY = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const TAG = "A".repeat(43);
const NAMESPACE = buildAccountWorkspaceNamespace({ userId: USER, companyId: COMPANY });
const FOREIGN_NAMESPACE = buildAccountWorkspaceNamespace({
  userId: "22222222-3333-4444-8555-666666666666",
  companyId: "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff",
});

function memoryStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

// A minimal in-memory stand-in for the encrypted runtime adapter. The real
// adapter is exercised in vaultRuntimeStore.test.js; here the contract under
// test is the FACADE's routing.
function fakeAdapter({ generation = 1, ready = true, seed = {} } = {}) {
  const cache = new Map(Object.entries(seed));
  return {
    cache,
    ready,
    isReady(requested) { return this.ready && requested === generation; },
    getItem(key) { return cache.has(key) ? cache.get(key) : null; },
    setItem(key, value) { cache.set(key, String(value)); },
    removeItem(key) { cache.delete(key); },
    clear() { cache.clear(); },
    keys() { return [...cache.keys()]; },
  };
}

let storage;
let facade;

function activate() {
  storage = memoryStorage({
    [`${NAMESPACE}:estipaid-customers-v1`]: '{"note":"stale-plaintext"}',
    [`${FOREIGN_NAMESPACE}:estipaid-customers-v1`]: '{"note":"foreign"}',
    "estipaid-lang": "es",
    "estipaid-device-id-v1": "synthetic-device",
    [`${NAMESPACE}:estipaid-vault-idle-lock-minutes`]: "30",
    "field-pocket-customers-v1": '{"note":"quarantined"}',
    "estipaid-customers-v1": '{"note":"bare-legacy"}',
    "sb-synthetic-local-auth-token": "synthetic-auth",
    "synthetic-third-party": "unrelated",
  });
  const activation = activateAccountScopedLocalStorage({ storage, userId: USER, companyId: COMPANY });
  expect(activation.ok).toBe(true);
  facade = activation.storage;
  setActiveWorkspaceVaultCompatibility({ workspaceTag: TAG, state: "legacy-safe", generation: 1 });
}

afterEach(() => {
  revokeAuthoritativeVaultRuntime();
  deactivateAccountScopedLocalStorage();
});

test("an approved business key reads from the runtime, never from scoped plaintext", () => {
  activate();
  const adapter = fakeAdapter({ seed: { "estipaid-customers-v1": '{"note":"authoritative"}' } });
  expect(installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter })).toBe(true);
  // Scoped plaintext for the same key still exists in the backing store and is
  // deliberately NOT what the application sees.
  expect(storage.getItem(`${NAMESPACE}:estipaid-customers-v1`)).toBe('{"note":"stale-plaintext"}');
  expect(facade.getItem("estipaid-customers-v1")).toBe('{"note":"authoritative"}');
});

test("an approved business write never creates scoped plaintext", () => {
  activate();
  const adapter = fakeAdapter();
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  const before = storage.getItem(`${NAMESPACE}:estipaid-projects-v1`);
  facade.setItem("estipaid-projects-v1", '{"note":"new"}');
  expect(storage.getItem(`${NAMESPACE}:estipaid-projects-v1`)).toBe(before);
  expect(adapter.cache.get("estipaid-projects-v1")).toBe('{"note":"new"}');
  // Immediate read-after-write, exactly like localStorage.
  expect(facade.getItem("estipaid-projects-v1")).toBe('{"note":"new"}');
});

test("removeItem followed immediately by getItem returns null", () => {
  activate();
  const adapter = fakeAdapter({ seed: { "estipaid-customers-v1": "value" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  facade.removeItem("estipaid-customers-v1");
  expect(facade.getItem("estipaid-customers-v1")).toBeNull();
  // The scoped plaintext was never touched, and never becomes a fallback.
  expect(storage.getItem(`${NAMESPACE}:estipaid-customers-v1`)).toBe('{"note":"stale-plaintext"}');
});

test("enumeration reflects the runtime synchronously and hides scoped plaintext", () => {
  activate();
  const adapter = fakeAdapter({ seed: { "estipaid-customers-v1": "a" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  const keysBefore = [];
  for (let index = 0; index < facade.length; index += 1) keysBefore.push(facade.key(index));
  expect(keysBefore).toContain("estipaid-customers-v1");
  expect(keysBefore).toContain("estipaid-lang");
  expect(keysBefore).not.toContain("field-pocket-customers-v1");

  facade.setItem("estipaid-projects-v1", "b");
  const keysAfter = [];
  for (let index = 0; index < facade.length; index += 1) keysAfter.push(facade.key(index));
  expect(keysAfter).toContain("estipaid-projects-v1");
  expect(keysAfter.length).toBe(keysBefore.length + 1);
});

test("device-global keys keep their native location in authoritative mode", () => {
  activate();
  const adapter = fakeAdapter();
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  expect(facade.getItem("estipaid-lang")).toBe("es");
  expect(facade.getItem("estipaid-device-id-v1")).toBe("synthetic-device");
  facade.setItem("estipaid-lang", "en");
  expect(storage.getItem("estipaid-lang")).toBe("en");
  expect(adapter.cache.has("estipaid-lang")).toBe(false);
});

test("the documented idle-lock preference stays readable while the runtime holds business data", () => {
  activate();
  const adapter = fakeAdapter();
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  // Its documented exclusion reason is that it must be readable while locked, so
  // it is scoped-but-not-vaulted. It must never hold business content.
  expect(facade.getItem("estipaid-vault-idle-lock-minutes")).toBe("30");
  expect(adapter.cache.has("estipaid-vault-idle-lock-minutes")).toBe(false);
  // It stays writable through its classified scoped location, never the vault.
  facade.setItem("estipaid-vault-idle-lock-minutes", "15");
  expect(storage.getItem(`${NAMESPACE}:estipaid-vault-idle-lock-minutes`)).toBe("15");
  expect(adapter.cache.has("estipaid-vault-idle-lock-minutes")).toBe(false);
});

test("quarantined legacy and foreign namespaces stay invisible and immutable", () => {
  activate();
  const adapter = fakeAdapter();
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });

  expect(facade.getItem("field-pocket-customers-v1")).toBeNull();
  facade.setItem("field-pocket-customers-v1", "attempt");
  expect(storage.getItem("field-pocket-customers-v1")).toBe('{"note":"quarantined"}');
  facade.removeItem("field-pocket-customers-v1");
  expect(storage.getItem("field-pocket-customers-v1")).toBe('{"note":"quarantined"}');

  expect(facade.getItem(`${FOREIGN_NAMESPACE}:estipaid-customers-v1`)).toBeNull();
  facade.setItem(`${FOREIGN_NAMESPACE}:estipaid-customers-v1`, "attempt");
  expect(storage.getItem(`${FOREIGN_NAMESPACE}:estipaid-customers-v1`)).toBe('{"note":"foreign"}');
});

test("an unclassified workspace-shaped key fails closed instead of writing plaintext", () => {
  activate();
  const adapter = fakeAdapter();
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  // The runtime refuses an unapproved key; the facade must NOT fall back to
  // scoped plaintext for it.
  facade.setItem("estipaid-brand-new-key-v1", "value");
  expect(storage.getItem(`${NAMESPACE}:estipaid-brand-new-key-v1`)).toBeNull();
  expect(storage.getItem("estipaid-brand-new-key-v1")).toBeNull();
  expect(facade.getItem("estipaid-brand-new-key-v1")).toBeNull();
});

test("clear removes only runtime business data and preserves every other category", () => {
  activate();
  const adapter = fakeAdapter({ seed: { "estipaid-customers-v1": "a", "estipaid-projects-v1": "b" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  facade.clear();
  expect(adapter.cache.size).toBe(0);
  expect(storage.getItem("estipaid-lang")).toBe("es");
  expect(storage.getItem("estipaid-device-id-v1")).toBe("synthetic-device");
  expect(storage.getItem("field-pocket-customers-v1")).toBe('{"note":"quarantined"}');
  expect(storage.getItem(`${FOREIGN_NAMESPACE}:estipaid-customers-v1`)).toBe('{"note":"foreign"}');
  expect(storage.getItem("sb-synthetic-local-auth-token")).toBe("synthetic-auth");
  expect(storage.getItem("estipaid-customers-v1")).toBe('{"note":"bare-legacy"}');
});

test("an adapter for a different workspace tag is never honoured", () => {
  activate();
  const adapter = fakeAdapter({ seed: { "estipaid-customers-v1": "other-workspace" } });
  installAuthoritativeVaultRuntime({ workspaceTag: "B".repeat(43), generation: 1, adapter });
  // Falls back to the NON-authoritative facade path, which reads scoped
  // plaintext -- correct only because this adapter is not for this workspace.
  expect(facade.getItem("estipaid-customers-v1")).toBe('{"note":"stale-plaintext"}');
  expect(isAuthoritativeVaultRuntimeInstalled(TAG)).toBe(false);
});

test("a not-ready or stale-generation adapter reads absent, never scoped plaintext", () => {
  activate();
  const adapter = fakeAdapter({ generation: 2, seed: { "estipaid-customers-v1": "runtime" } });
  // Installed generation 1 while the adapter only answers for generation 2.
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  // ISO-16 review fix: an installed-but-unusable authoritative runtime does NOT
  // reopen the scoped plaintext business channel. The key reads absent.
  expect(facade.getItem("estipaid-customers-v1")).toBeNull();
  // Documented native exclusions still enumerate; the approved business key does not.
  const enumerated = [];
  for (let index = 0; index < facade.length; index += 1) enumerated.push(facade.key(index));
  expect(enumerated).not.toContain("estipaid-customers-v1");

  const live = fakeAdapter({ generation: 1, seed: { "estipaid-customers-v1": "runtime" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter: live });
  expect(facade.getItem("estipaid-customers-v1")).toBe("runtime");
  live.ready = false;
  expect(facade.getItem("estipaid-customers-v1")).toBeNull();

  // The plaintext value is still physically present -- it is invisible, not
  // deleted -- and becomes irrelevant again once the runtime answers.
  expect(storage.getItem(`${NAMESPACE}:estipaid-customers-v1`)).toBe('{"note":"stale-plaintext"}');
  live.ready = true;
  expect(facade.getItem("estipaid-customers-v1")).toBe("runtime");
});

test("deactivating the workspace revokes the authoritative adapter synchronously", () => {
  activate();
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter: fakeAdapter({ seed: { "estipaid-customers-v1": "runtime" } }) });
  expect(isAuthoritativeVaultRuntimeInstalled(TAG)).toBe(true);
  deactivateAccountScopedLocalStorage();
  expect(isAuthoritativeVaultRuntimeInstalled()).toBe(false);
});

test("a malformed adapter is rejected outright", () => {
  activate();
  expect(installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter: {} })).toBe(false);
  expect(installAuthoritativeVaultRuntime({ workspaceTag: "", generation: 1, adapter: fakeAdapter() })).toBe(false);
  expect(installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 0, adapter: fakeAdapter() })).toBe(false);
  expect(isAuthoritativeVaultRuntimeInstalled()).toBe(false);
});

// ---------------------------------------------------------------------------
// ISO-16 review fix -- a FROZEN runtime is still an authoritative runtime.
//
// Being installed for this workspace and being mutation-ready are different
// questions. Treating "temporarily not mutation-ready" as "no authoritative
// runtime exists" made the facade fall through to scoped physical localStorage
// for getItem, length, and key -- exactly the plaintext channel the vault
// exists to close.
// ---------------------------------------------------------------------------

// Mirrors the real runtime contract: a frozen session can still READ its last
// verified cache, but refuses every mutation.
function freezableAdapter({ generation = 1, seed = {} } = {}) {
  const cache = new Map(Object.entries(seed));
  return {
    cache,
    frozen: false,
    revoked: false,
    canRead(requested) { return !this.revoked && requested === generation; },
    canMutate(requested) { return !this.revoked && !this.frozen && requested === generation; },
    isReady(requested) { return this.canMutate(requested); },
    getItem(key) { return cache.has(key) ? cache.get(key) : null; },
    setItem(key, value) { if (this.canMutate(generation)) cache.set(key, String(value)); },
    removeItem(key) { if (this.canMutate(generation)) cache.delete(key); },
    clear() { if (this.canMutate(generation)) cache.clear(); },
    keys() { return [...cache.keys()]; },
  };
}

test("a frozen runtime serves encrypted reads and never scoped plaintext", () => {
  activate();
  const adapter = freezableAdapter({ seed: { "estipaid-customers-v1": "encrypted-value" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  // A conflicting scoped plaintext value for the same approved key.
  storage.setItem(`${NAMESPACE}:estipaid-customers-v1`, "plaintext-value");

  adapter.frozen = true;
  expect(facade.getItem("estipaid-customers-v1")).toBe("encrypted-value");
  expect(facade.getItem("estipaid-customers-v1")).not.toBe("plaintext-value");

  // Enumeration comes from the encrypted runtime, not from the scoped prefix.
  const enumerated = [];
  for (let index = 0; index < facade.length; index += 1) enumerated.push(facade.key(index));
  expect(enumerated).toContain("estipaid-customers-v1");
  // The documented native exclusion is still visible; foreign, quarantined, and
  // bare-legacy keys stay invisible.
  expect(enumerated).toContain("estipaid-vault-idle-lock-minutes");
  expect(enumerated).not.toContain("field-pocket-customers-v1");
});

test("a frozen runtime refuses every approved mutation without touching plaintext", () => {
  activate();
  const adapter = freezableAdapter({ seed: { "estipaid-customers-v1": "encrypted-value" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  storage.setItem(`${NAMESPACE}:estipaid-customers-v1`, "plaintext-value");
  adapter.frozen = true;

  facade.setItem("estipaid-customers-v1", "written-while-frozen");
  facade.setItem("estipaid-projects-v1", "written-while-frozen");
  facade.removeItem("estipaid-customers-v1");
  facade.clear();

  // The cache is untouched ...
  expect(adapter.cache.get("estipaid-customers-v1")).toBe("encrypted-value");
  expect(adapter.cache.has("estipaid-projects-v1")).toBe(false);
  expect(adapter.cache.size).toBe(1);
  // ... and no scoped plaintext was created or modified.
  expect(storage.getItem(`${NAMESPACE}:estipaid-customers-v1`)).toBe("plaintext-value");
  expect(storage.getItem(`${NAMESPACE}:estipaid-projects-v1`)).toBeNull();
  // Reads still serve the verified cache throughout.
  expect(facade.getItem("estipaid-customers-v1")).toBe("encrypted-value");
});

test("documented exclusions and unknown keys keep their frozen behaviour", () => {
  activate();
  const adapter = freezableAdapter({ seed: { "estipaid-customers-v1": "encrypted-value" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  adapter.frozen = true;

  // A documented native exclusion keeps using its classified location.
  expect(facade.getItem("estipaid-vault-idle-lock-minutes")).toBe("30");
  facade.setItem("estipaid-vault-idle-lock-minutes", "15");
  expect(storage.getItem(`${NAMESPACE}:estipaid-vault-idle-lock-minutes`)).toBe("15");

  // An unclassified workspace-shaped key reads absent and refuses mutation.
  expect(facade.getItem("estipaid-brand-new-key-v1")).toBeNull();
  facade.setItem("estipaid-brand-new-key-v1", "value");
  expect(storage.getItem(`${NAMESPACE}:estipaid-brand-new-key-v1`)).toBeNull();

  // Quarantined and foreign keys stay invisible and immutable.
  expect(facade.getItem("field-pocket-customers-v1")).toBeNull();
  facade.setItem("field-pocket-customers-v1", "mutated");
  expect(storage.getItem("field-pocket-customers-v1")).toBe('{"note":"quarantined"}');
  expect(storage.getItem(`${FOREIGN_NAMESPACE}:estipaid-customers-v1`)).toBe('{"note":"foreign"}');
});

test("after the atomic replacement reads come from the new encrypted cache", () => {
  activate();
  const first = freezableAdapter({ seed: { "estipaid-customers-v1": "encrypted-value" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter: first });
  storage.setItem(`${NAMESPACE}:estipaid-customers-v1`, "plaintext-value");
  first.frozen = true;
  expect(facade.getItem("estipaid-customers-v1")).toBe("encrypted-value");

  // The replacement installs a new adapter for the new generation.
  const replacement = freezableAdapter({ generation: 2, seed: { "estipaid-customers-v1": "replacement-value" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 2, adapter: replacement });
  expect(facade.getItem("estipaid-customers-v1")).toBe("replacement-value");
  facade.setItem("estipaid-customers-v1", "written-after-replacement");
  expect(replacement.cache.get("estipaid-customers-v1")).toBe("written-after-replacement");
  expect(storage.getItem(`${NAMESPACE}:estipaid-customers-v1`)).toBe("plaintext-value");
});

test("after lock or revocation no approved plaintext fallback is available", () => {
  activate();
  const adapter = freezableAdapter({ seed: { "estipaid-customers-v1": "encrypted-value" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  storage.setItem(`${NAMESPACE}:estipaid-customers-v1`, "plaintext-value");

  // A lock that leaves the adapter installed but unusable.
  adapter.revoked = true;
  expect(facade.getItem("estipaid-customers-v1")).toBeNull();
  facade.setItem("estipaid-customers-v1", "written-after-lock");
  expect(storage.getItem(`${NAMESPACE}:estipaid-customers-v1`)).toBe("plaintext-value");

  // A full revocation uninstalls the adapter; approved business plaintext is
  // still not served, because the workspace vault compatibility is no longer
  // legacy-safe once authority exists.
  revokeAuthoritativeVaultRuntime();
  expect(isAuthoritativeVaultRuntimeInstalled(TAG)).toBe(false);
});
