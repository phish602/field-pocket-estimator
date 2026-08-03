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

// ---------------------------------------------------------------------------
// ISO-16 review fix -- authoritative routing is bound to the ACTIVE facade.
//
// Routing used to be decided from global state alone, so a facade retained from
// workspace A could reach whatever runtime workspace B installed. And because
// authoritative mode was inferred from adapter presence, revoking the adapter
// reopened scoped plaintext for the current workspace.
// ---------------------------------------------------------------------------

const SECOND_USER = "22222222-3333-4444-8555-666666666666";
const SECOND_COMPANY = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const SECOND_TAG = "C".repeat(43);
const SECOND_NAMESPACE = buildAccountWorkspaceNamespace({ userId: SECOND_USER, companyId: SECOND_COMPANY });

function setDeviceGuard(state) {
  // The compatibility guard is device-global: it is always read from the real
  // window.localStorage, never from the memory storage the facade wraps. A write
  // from OUTSIDE this module looks exactly like another tab's write, so the
  // storage event is dispatched with it -- that is the real invalidation signal.
  if (state === null) window.localStorage.removeItem("estipaid-vault-guard-v1");
  else window.localStorage.setItem("estipaid-vault-guard-v1", `{"version":1,"state":"${state}"}`);
  window.dispatchEvent(new StorageEvent("storage", { key: "estipaid-vault-guard-v1" }));
}

afterEach(() => {
  window.localStorage.removeItem("estipaid-vault-guard-v1");
});

test("a facade retained from workspace A cannot reach workspace B's runtime", () => {
  activate();
  const facadeA = facade;
  const storageA = storage;
  // A's own scoped business value, written while A was active and legacy-safe.
  expect(facadeA.getItem("estipaid-customers-v1")).toBe('{"note":"stale-plaintext"}');

  // Switch to workspace B and install B's authoritative runtime.
  const activationB = activateAccountScopedLocalStorage({ storage: storageA, userId: SECOND_USER, companyId: SECOND_COMPANY });
  expect(activationB.ok).toBe(true);
  const facadeB = activationB.storage;
  setActiveWorkspaceVaultCompatibility({ workspaceTag: SECOND_TAG, state: "legacy-safe", generation: 1 });
  const adapterB = freezableAdapter({ seed: { "estipaid-customers-v1": "workspace-b-encrypted" } });
  expect(installAuthoritativeVaultRuntime({ workspaceTag: SECOND_TAG, generation: 1, adapter: adapterB })).toBe(true);

  // 4/5/6: the retained facade cannot read, mutate, or enumerate B.
  expect(facadeA.getItem("estipaid-customers-v1")).toBeNull();
  facadeA.setItem("estipaid-customers-v1", "written-by-stale-facade");
  facadeA.removeItem("estipaid-customers-v1");
  facadeA.clear();
  expect(adapterB.cache.get("estipaid-customers-v1")).toBe("workspace-b-encrypted");
  const staleKeys = [];
  for (let index = 0; index < facadeA.length; index += 1) staleKeys.push(facadeA.key(index));
  expect(staleKeys).not.toContain("estipaid-customers-v1");
  expect(staleKeys).not.toContain("estipaid-vault-idle-lock-minutes");

  // 7: nor its own old scoped business data, which is still physically present.
  expect(storageA.getItem(`${NAMESPACE}:estipaid-customers-v1`)).toBe('{"note":"stale-plaintext"}');
  expect(facadeA.getItem("estipaid-customers-v1")).toBeNull();

  // 8: the current facade keeps working normally.
  expect(facadeB.getItem("estipaid-customers-v1")).toBe("workspace-b-encrypted");
  facadeB.setItem("estipaid-projects-v1", "workspace-b-write");
  expect(adapterB.cache.get("estipaid-projects-v1")).toBe("workspace-b-write");
  expect(storageA.getItem(`${SECOND_NAMESPACE}:estipaid-projects-v1`)).toBeNull();

  // Device-global and unrelated origin keys keep their native behaviour even on
  // the retained facade.
  expect(facadeA.getItem("estipaid-device-id-v1")).toBe("synthetic-device");
  expect(facadeA.getItem("synthetic-third-party")).toBe("unrelated");
  expect(staleKeys).toContain("estipaid-device-id-v1");
});

test("an authoritative workspace with no adapter never serves scoped plaintext", () => {
  activate();
  const adapter = freezableAdapter({ seed: { "estipaid-customers-v1": "encrypted-value" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  // The workspace has settled into authority, and a conflicting scoped plaintext
  // value for an approved key exists.
  setDeviceGuard("authoritative");
  storage.setItem(`${NAMESPACE}:estipaid-customers-v1`, "plaintext-value");
  expect(facade.getItem("estipaid-customers-v1")).toBe("encrypted-value");

  // The adapter is revoked -- a lock, or the window between two activations.
  revokeAuthoritativeVaultRuntime();
  expect(isAuthoritativeVaultRuntimeInstalled(TAG)).toBe(false);

  // 12/13: absent, never plaintext, and not enumerated.
  expect(facade.getItem("estipaid-customers-v1")).toBeNull();
  const keys = [];
  for (let index = 0; index < facade.length; index += 1) keys.push(facade.key(index));
  expect(keys).not.toContain("estipaid-customers-v1");

  // 14: no mutation reaches scoped plaintext.
  facade.setItem("estipaid-customers-v1", "written-without-adapter");
  facade.removeItem("estipaid-customers-v1");
  facade.clear();
  expect(storage.getItem(`${NAMESPACE}:estipaid-customers-v1`)).toBe("plaintext-value");
  expect(storage.getItem(`${NAMESPACE}:estipaid-vault-idle-lock-minutes`)).toBe("30");

  // Documented native exclusions still work, unknown keys stay absent, and
  // quarantined/foreign values remain untouched.
  expect(facade.getItem("estipaid-vault-idle-lock-minutes")).toBe("30");
  expect(facade.getItem("estipaid-brand-new-key-v1")).toBeNull();
  expect(facade.getItem("field-pocket-customers-v1")).toBeNull();
  expect(storage.getItem("field-pocket-customers-v1")).toBe('{"note":"quarantined"}');
  expect(storage.getItem(`${FOREIGN_NAMESPACE}:estipaid-customers-v1`)).toBe('{"note":"foreign"}');
  expect(facade.getItem("estipaid-device-id-v1")).toBe("synthetic-device");
});

test("a stale-generation adapter under an authoritative guard still reads absent", () => {
  activate();
  setDeviceGuard("authoritative");
  storage.setItem(`${NAMESPACE}:estipaid-customers-v1`, "plaintext-value");
  const adapter = freezableAdapter({ generation: 2, seed: { "estipaid-customers-v1": "encrypted-value" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter });
  expect(facade.getItem("estipaid-customers-v1")).toBeNull();

  // A frozen, matching adapter still reads its verified cache.
  const live = freezableAdapter({ generation: 1, seed: { "estipaid-customers-v1": "encrypted-value" } });
  installAuthoritativeVaultRuntime({ workspaceTag: TAG, generation: 1, adapter: live });
  live.frozen = true;
  expect(facade.getItem("estipaid-customers-v1")).toBe("encrypted-value");
});

test("the transition guard still permits the established migration source path", () => {
  activate();
  // Mid-migration: the guard is transition, not settled authority.
  setDeviceGuard("transition");
  // The orchestrator's established contract keeps reading the frozen plaintext.
  expect(facade.getItem("estipaid-customers-v1")).toBe('{"note":"stale-plaintext"}');
  expect(facade.readVaultMigrationSourceItem("estipaid-customers-v1")).toBe('{"note":"stale-plaintext"}');

  // Once authority settles, the application surface closes but the named
  // migration accessor still tells the truth about the source.
  setDeviceGuard("authoritative");
  expect(facade.getItem("estipaid-customers-v1")).toBeNull();
  expect(facade.readVaultMigrationSourceItem("estipaid-customers-v1")).toBe('{"note":"stale-plaintext"}');

  // Cleanup still works, and afterwards the source really is gone.
  expect(facade.removeVaultMigrationItem("estipaid-customers-v1")).toBe(true);
  expect(facade.readVaultMigrationSourceItem("estipaid-customers-v1")).toBeNull();
  expect(storage.getItem(`${NAMESPACE}:estipaid-customers-v1`)).toBeNull();
});

test("the migration source accessor is refused to a retained facade", () => {
  activate();
  const facadeA = facade;
  const storageA = storage;
  expect(facadeA.readVaultMigrationSourceItem("estipaid-customers-v1")).toBe('{"note":"stale-plaintext"}');
  activateAccountScopedLocalStorage({ storage: storageA, userId: SECOND_USER, companyId: SECOND_COMPANY });
  expect(facadeA.readVaultMigrationSourceItem("estipaid-customers-v1")).toBeNull();
  expect(facadeA.removeVaultMigrationItem("estipaid-customers-v1")).toBe(false);
  expect(storageA.getItem(`${NAMESPACE}:estipaid-customers-v1`)).toBe('{"note":"stale-plaintext"}');
  // No physical namespace or workspace tag is exposed by any of it.
  const serialized = JSON.stringify({
    read: facadeA.readVaultMigrationSourceItem("estipaid-customers-v1"),
    item: facadeA.getItem("estipaid-customers-v1"),
    length: facadeA.length,
  });
  expect(serialized).not.toContain(NAMESPACE);
  expect(serialized).not.toContain(TAG);
});
