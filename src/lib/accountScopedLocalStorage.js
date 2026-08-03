// ISO-14D -- account-scoped local workspace namespace.
//
// Every authenticated account gets its own physical key namespace inside the
// browser's local storage. The namespace is derived ONLY from immutable
// authenticated identity:
//
//   estipaid-workspace-v2:<encoded user UUID>:<encoded company UUID>:<logical key>
//
// Email, username, company name, tokens, Supabase URL, and Stripe identifiers
// are display/config metadata and never take part in the namespace.
//
// CONTAINMENT, NOT ENCRYPTION. Values are still plaintext in the browser. This
// gate isolates accounts from each other and quarantines pre-existing unscoped
// data; it does not protect data from someone with access to the device. See
// docs/estipaid-encrypted-local-vault-plan.md for the encrypted-vault gate that
// must land before Production.
//
// Legacy unscoped keys (estipaid-customers-v1, estipaid-company-profile-v1, ...)
// are never read, parsed, counted, copied, moved, or deleted here. Once a
// workspace is active they are not even enumerable through the compatibility
// facade: a missing scoped value reads as null, and there is NO fallback to the
// unscoped value. That fallback is the exact thing this module exists to
// prevent.

import {
  VAULT_COMPATIBILITY_GUARD_KEY,
  verifyVaultCompatibilityGuardValue,
} from "./vaultCompatibilityGuard";
import { VAULT_MIGRATION_LOGICAL_KEYS } from "./vaultIndexedDbRepository";
import { isDocumentedStorageExclusion } from "../constants/vaultStorageExclusions";

export const WORKSPACE_NAMESPACE_PREFIX = "estipaid-workspace-v2";

// Written inside the namespace at activation and read back to prove the
// namespace belongs to the exact user/company that asked for it.
export const WORKSPACE_MARKER_LOGICAL_KEY = "estipaid-workspace-marker-v1";
export const WORKSPACE_MARKER_VERSION = "estipaid-workspace-marker-v1";

// Genuine device-level preferences. They stay unscoped so a device keeps its
// language and identity across accounts.
export const DEVICE_GLOBAL_LOGICAL_KEYS = Object.freeze([
  "estipaid-lang",
  "estipaid-device-id-v1",
  // ISO-15H -- the compatibility guard is device-global by design. It is
  // intentionally not a workspace record and is never a migration source.
  "estipaid-vault-guard-v1",
]);

export const QUARANTINED_LEGACY_LOGICAL_KEYS = Object.freeze([
  "field-pocket-language", "field-pocket-theme", "field-pocket-show-costs",
  "field-pocket-profile", "field-pocket-profile-v1", "field-pocket-customers-v1",
  "field-pocket-estimates", "field-pocket-invoices-v1",
]);

export const ACCOUNT_SCOPED_STORAGE_ERROR = Object.freeze({
  INCOMPLETE_IDENTITY: "Workspace identity is incomplete.",
  STORAGE_UNAVAILABLE: "This browser is not able to open your workspace.",
  MARKER_UNVERIFIED: "This workspace could not be opened securely.",
  INSTALL_FAILED: "This browser is not able to open your workspace.",
});

const ESTIPAID_PREFIX = "estipaid-";
const NAMESPACE_PREFIX_WITH_SEPARATOR = `${WORKSPACE_NAMESPACE_PREFIX}:`;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MARKER_FIELDS = ["boundAt", "companyId", "userId", "version"];
const facadeMetadata = new WeakMap();

// ISO-15F1 -- one narrow, module-private handoff from the React bridge to the
// synchronous compatibility facade. It intentionally retains no identity or
// storage data: activation/deactivation revoke it before another workspace can
// use the facade.
let activeVaultCompatibility = { workspaceTag: "", state: "blocked", generation: 0 };

export function setActiveWorkspaceVaultCompatibility({ workspaceTag = "", state = "blocked", generation = 0 } = {}) {
  invalidateDeviceGuardState();
  activeVaultCompatibility = {
    workspaceTag: typeof workspaceTag === "string" ? workspaceTag : "",
    state: state === "legacy-safe" ? "legacy-safe" : "blocked",
    generation: Number.isSafeInteger(generation) && generation >= 0 ? generation : 0,
  };
}

// ISO-16 -- the AUTHORITATIVE runtime adapter.
//
// After migration reaches authority the scoped plaintext no longer exists, so
// approved business keys must be served from the verified encrypted runtime
// instead. The adapter is installed by the runtime activation hook for one exact
// workspace tag and one exact runtime generation; anything else is refused.
//
// This is a narrow, module-private handoff: it holds no identity, no namespace,
// no key material, and it is revoked synchronously on lock, logout, identity
// switch, workspace switch, and unmount.
let authoritativeRuntime = null;

export function installAuthoritativeVaultRuntime({ workspaceTag = "", generation = 0, adapter = null } = {}) {
  invalidateDeviceGuardState();
  if (typeof workspaceTag !== "string" || !workspaceTag || !Number.isSafeInteger(generation) || generation < 1) return false;
  if (!adapter || typeof adapter.getItem !== "function" || typeof adapter.setItem !== "function"
    || typeof adapter.removeItem !== "function" || typeof adapter.clear !== "function"
    || typeof adapter.keys !== "function" || typeof adapter.isReady !== "function") return false;
  authoritativeRuntime = { workspaceTag, generation, adapter };
  return true;
}

export function revokeAuthoritativeVaultRuntime() {
  invalidateDeviceGuardState();
  authoritativeRuntime = null;
}

export function isAuthoritativeVaultRuntimeInstalled(workspaceTag) {
  if (!authoritativeRuntime) return false;
  return workspaceTag === undefined || authoritativeRuntime.workspaceTag === workspaceTag;
}

const APPROVED_VAULT_KEYS = new Set(VAULT_MIGRATION_LOGICAL_KEYS);

// The compatibility guard is one device-global string, and the facade sits on
// the hottest path in the app -- every synchronous storage read goes through it.
// Reading and verifying the guard on every one of those reads is measurably
// expensive, so the verified state is cached and invalidated on exactly the
// events that can change it: this tab writing the guard, the active workspace or
// compatibility state changing, an adapter being installed or revoked, and
// another tab's storage event.
let guardStateValid = false;
let guardStateCache = "";
let guardStorageListenerBound = false;

function invalidateDeviceGuardState() {
  guardStateValid = false;
}

function bindGuardStorageListener() {
  if (guardStorageListenerBound) return;
  guardStorageListenerBound = true;
  try {
    if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;
    window.addEventListener("storage", (event) => {
      if (!event || event.key === null || event.key === VAULT_COMPATIBILITY_GUARD_KEY) invalidateDeviceGuardState();
    });
  } catch { /* a non-browser environment simply reads through every time */ }
}

// The guard is read from the NATIVE backing Storage this facade wraps, never
// from window.localStorage.
//
// Once the facade is installed globally, window.localStorage IS the facade, so
// reading the guard through it re-enters getItem -> protectedRouting ->
// deviceGuardState -> getItem ... until the stack is exhausted. Relying on the
// catch to unwind that recursion "successfully" is not an implementation; the
// read has to go straight to the real Storage object the module already holds.
function readNativeGuardState(nativeStorage) {
  bindGuardStorageListener();
  if (guardStateValid) return guardStateCache;
  try {
    if (!nativeStorage || typeof nativeStorage.getItem !== "function") {
      guardStateCache = "blocked";
      guardStateValid = true;
      return guardStateCache;
    }
    guardStateCache = verifyVaultCompatibilityGuardValue(nativeStorage.getItem(VAULT_COMPATIBILITY_GUARD_KEY))?.state || "blocked";
    guardStateValid = true;
    return guardStateCache;
  } catch {
    guardStateCache = "blocked";
    guardStateValid = true;
    return guardStateCache;
  }
}

// Every fresh read of the guard elsewhere in this module refreshes the cache, so
// the mutation paths (which always re-read) keep the read path honest too.
function adoptGuardState(guard) {
  guardStateCache = guard?.state || "";
  guardStateValid = true;
  return guard;
}

// Three-way classification while the authoritative runtime is installed:
//
//   "vault"     approved business data -> the encrypted runtime, never plaintext
//   "native"    a documented, reviewed non-business exclusion -> its classified
//               scoped/native location (e.g. the idle-lock preference, which must
//               stay readable while the vault is LOCKED)
//   "refused"   a workspace-shaped key that is in neither list. It has no
//               authoritative home, so it fails closed rather than silently
//               reopening a plaintext business channel.
export function classifyAuthoritativeKey(logicalKey) {
  if (!isWorkspaceScopedLogicalKey(logicalKey)) return "native";
  if (APPROVED_VAULT_KEYS.has(logicalKey)) return "vault";
  if (isDocumentedStorageExclusion(logicalKey)) return "native";
  return "refused";
}

// Being INSTALLED for this workspace and being MUTATION-READY are different
// questions, and conflating them was a real hazard: during a revalidation the
// runtime deliberately reports not-ready, and the facade then fell through to
// scoped physical localStorage for reads and enumeration. After authority that
// is exactly the plaintext channel the vault exists to close.
function installedAuthoritativeRuntime() {
  if (!authoritativeRuntime) return null;
  if (!activeVaultCompatibility.workspaceTag
    || activeVaultCompatibility.workspaceTag !== authoritativeRuntime.workspaceTag) return null;
  return authoritativeRuntime;
}

// Readable: the adapter can still serve the last VERIFIED cache. A frozen
// runtime is readable but not mutable.
function readableAuthoritativeAdapter() {
  const installed = installedAuthoritativeRuntime();
  if (!installed) return null;
  const { adapter, generation } = installed;
  const readable = typeof adapter.canRead === "function"
    ? adapter.canRead(generation)
    : adapter.isReady(generation);
  return readable ? adapter : null;
}

// Mutable: the adapter will accept a durable mutation right now.
function mutableAuthoritativeAdapter() {
  const installed = installedAuthoritativeRuntime();
  if (!installed) return null;
  const { adapter, generation } = installed;
  const mutable = typeof adapter.canMutate === "function"
    ? adapter.canMutate(generation)
    : adapter.isReady(generation);
  return mutable ? adapter : null;
}

function isQuarantinedLegacyKey(key) {
  return QUARANTINED_LEGACY_LOGICAL_KEYS.includes(key);
}

function strictId(value) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function validIsoTimestamp(value) {
  if (typeof value !== "string" || !ISO_TIMESTAMP.test(value)) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}

// encodeURIComponent never emits ":" and is reversible, so a namespace splits
// back into exactly one (userId, companyId) pair -- no two distinct identities
// can produce the same namespace, and no identity value can inject a separator.
function encodeIdentitySegment(value) {
  return encodeURIComponent(value);
}

export function buildAccountWorkspaceNamespace({ userId, companyId } = {}) {
  const normalizedUserId = strictId(userId);
  const normalizedCompanyId = strictId(companyId);
  if (!normalizedUserId || !normalizedCompanyId) return "";
  return `${WORKSPACE_NAMESPACE_PREFIX}:${encodeIdentitySegment(normalizedUserId)}:${encodeIdentitySegment(normalizedCompanyId)}`;
}

function isNamespace(namespace) {
  if (typeof namespace !== "string" || !namespace.startsWith(NAMESPACE_PREFIX_WITH_SEPARATOR)) return false;
  const segments = namespace.split(":");
  return segments.length === 3 && Boolean(segments[1]) && Boolean(segments[2]);
}

// A logical key belongs to the account workspace when it is EstiPaid business
// data. Device-global preferences and non-EstiPaid keys (Supabase `sb-*` auth
// tokens, debug flags, unrelated origin data) are never rewritten.
export function isWorkspaceScopedLogicalKey(logicalKey) {
  if (typeof logicalKey !== "string" || !logicalKey) return false;
  if (!logicalKey.startsWith(ESTIPAID_PREFIX)) return false;
  if (logicalKey.startsWith(NAMESPACE_PREFIX_WITH_SEPARATOR)) return false;
  return !DEVICE_GLOBAL_LOGICAL_KEYS.includes(logicalKey);
}

export function buildScopedStorageKey({ namespace, logicalKey } = {}) {
  if (!isNamespace(namespace)) return "";
  if (!isWorkspaceScopedLogicalKey(logicalKey)) return "";
  return `${namespace}:${logicalKey}`;
}

// Reads must never throw into the app; an unusable storage fails closed.
function isUsableStorage(storage) {
  if (!storage) return false;
  try {
    if (typeof storage.getItem !== "function") return false;
    if (typeof storage.setItem !== "function") return false;
    if (typeof storage.removeItem !== "function") return false;
    if (typeof storage.key !== "function") return false;
    const { length } = storage;
    return Number.isInteger(length) && length >= 0;
  } catch {
    return false;
  }
}

function realKeysOf(storage) {
  const keys = [];
  let length;
  try { length = storage.length; } catch { return null; }
  if (!Number.isInteger(length) || length < 0) return null;
  for (let index = 0; index < length; index += 1) {
    let key;
    try { key = storage.key(index); } catch { return null; }
    if (typeof key === "string") keys.push(key);
  }
  return keys;
}

function isValidMarker(marker) {
  if (!marker || typeof marker !== "object" || Array.isArray(marker)) return false;
  const fields = Object.keys(marker).sort();
  if (fields.length !== MARKER_FIELDS.length) return false;
  if (fields.some((field, index) => field !== MARKER_FIELDS[index])) return false;
  return marker.version === WORKSPACE_MARKER_VERSION
    && Boolean(strictId(marker.userId))
    && Boolean(strictId(marker.companyId))
    && validIsoTimestamp(marker.boundAt);
}

function readWorkspaceMarker({ storage, namespace }) {
  const physicalKey = `${namespace}:${WORKSPACE_MARKER_LOGICAL_KEY}`;
  let raw;
  try { raw = storage.getItem(physicalKey); } catch { return null; }
  if (typeof raw !== "string" || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!isValidMarker(parsed)) return null;
    return {
      version: parsed.version,
      userId: parsed.userId.trim(),
      companyId: parsed.companyId.trim(),
      boundAt: parsed.boundAt,
    };
  } catch {
    return null;
  }
}

function writeWorkspaceMarker({ storage, namespace, userId, companyId, now }) {
  const timestamp = typeof now === "function" ? now() : now;
  if (!validIsoTimestamp(timestamp)) return null;
  const marker = {
    version: WORKSPACE_MARKER_VERSION,
    userId: strictId(userId),
    companyId: strictId(companyId),
    boundAt: timestamp,
  };
  try {
    storage.setItem(`${namespace}:${WORKSPACE_MARKER_LOGICAL_KEY}`, JSON.stringify(marker));
    return marker;
  } catch {
    return null;
  }
}

// The compatibility boundary. Hundreds of call sites use `localStorage.getItem`
// / `setItem` / `removeItem` directly; rather than rewriting each one, this
// facade takes the place of `window.localStorage` while a workspace is open and
// routes approved EstiPaid logical keys into the active namespace.
function createScopedStorageFacade({ storage, namespace }) {
  const scopedPrefix = `${namespace}:`;

  const normalizeStorageKey = (key) => String(key);
  const isForeignPhysicalKey = (normalizedKey) =>
    normalizedKey.startsWith(NAMESPACE_PREFIX_WITH_SEPARATOR)
    && !normalizedKey.startsWith(scopedPrefix);

  // Logical -> physical. Non-scoped keys pass through untouched so Supabase
  // auth tokens, language, device id, and unrelated origin data keep working.
  const toPhysicalKey = (normalizedKey) => {
    if (isWorkspaceScopedLogicalKey(normalizedKey)) return `${scopedPrefix}${normalizedKey}`;
    return normalizedKey;
  };

  // ISO-16 review fix -- authoritative routing is bound to THIS facade.
  //
  // A facade retained from a previous workspace must never reach the runtime
  // that a later workspace installed, and must not keep serving its own old
  // scoped business data either. Every authoritative decision below therefore
  // starts from "am I the exact currently active facade for the exact currently
  // active namespace".
  const isCurrentFacade = () => Boolean(activeWorkspace)
    && activeWorkspace.facade === facade
    && activeWorkspace.namespace === namespace;

  const facadeInstalledRuntime = () => (isCurrentFacade() ? installedAuthoritativeRuntime() : null);
  const facadeReadableAdapter = () => (isCurrentFacade() ? readableAuthoritativeAdapter() : null);
  const facadeMutableAdapter = () => (isCurrentFacade() ? mutableAuthoritativeAdapter() : null);

  // Protected routing applies to the exact current facade when an adapter is
  // installed for it, or unless the verified guard is exactly the legacy-safe
  // absent/transition state. Any unreadable or unrecognized state fails closed.
  const protectedRouting = () => {
    if (!isCurrentFacade()) return false;
    if (facadeInstalledRuntime()) return true;
    const guardState = readNativeGuardState(storage);
    return guardState !== "absent" && guardState !== "transition";
  };

  // The guard is re-read synchronously for every mutation. A stale bridge tab
  // therefore cannot write after another tab has published a guard state.
  // A fresh, uncached native read: a stale bridge tab must not be able to write
  // after another tab has published a guard state.
  const freshNativeGuard = () => {
    invalidateDeviceGuardState();
    return adoptGuardState({ state: readNativeGuardState(storage) });
  };

  const mayMutate = () => {
    const guard = freshNativeGuard();
    return guard?.state === "absent"
      && activeVaultCompatibility.state === "legacy-safe"
      && activeVaultCompatibility.workspaceTag
      && activeWorkspace?.namespace === namespace
      && activeWorkspace?.facade === facade;
  };

  // Physical -> logical for enumeration. Other workspaces and legacy unscoped
  // EstiPaid business keys are not merely unreadable, they are invisible.
  const visibleLogicalKeys = () => {
    const keys = realKeysOf(storage);
    if (!keys) return [];
    const visible = [];
    keys.forEach((key) => {
      if (key.startsWith(scopedPrefix)) {
        const logical = key.slice(scopedPrefix.length);
        if (logical !== WORKSPACE_MARKER_LOGICAL_KEY) visible.push(logical);
        return;
      }
      if (key.startsWith(NAMESPACE_PREFIX_WITH_SEPARATOR)) return; // another workspace
      if (isWorkspaceScopedLogicalKey(key)) return; // quarantined legacy value
      if (isQuarantinedLegacyKey(key)) return;
      visible.push(key);
    });
    return visible;
  };

  // Authoritative enumeration: approved business keys come from the encrypted
  // runtime, everything else keeps its classified native location. Scoped
  // plaintext business keys are never enumerated in authoritative mode.
  const authoritativeLogicalKeys = (adapter) => {
    const keys = realKeysOf(storage);
    const visible = new Set(adapter.keys());
    if (keys) {
      keys.forEach((key) => {
        if (key.startsWith(scopedPrefix)) {
          // A scoped key is only visible when it is a documented non-business
          // exclusion; scoped plaintext BUSINESS data stays invisible.
          const logical = key.slice(scopedPrefix.length);
          if (logical !== WORKSPACE_MARKER_LOGICAL_KEY && classifyAuthoritativeKey(logical) === "native") visible.add(logical);
          return;
        }
        if (key.startsWith(NAMESPACE_PREFIX_WITH_SEPARATOR)) return; // another workspace
        if (isWorkspaceScopedLogicalKey(key)) return;                // quarantined bare legacy
        if (isQuarantinedLegacyKey(key)) return;
        visible.add(key);
      });
    }
    return [...visible];
  };

  // Enumeration in every state: a stale facade shows no workspace-scoped key at
  // all, an authoritative workspace enumerates the encrypted runtime (never
  // scoped plaintext business keys), and everything else keeps native behaviour.
  const facadeVisibleKeys = () => {
    if (!isCurrentFacade()) return staleVisibleLogicalKeys();
    const adapter = facadeReadableAdapter();
    if (adapter) return authoritativeLogicalKeys(adapter);
    if (protectedRouting()) return authoritativeLogicalKeys({ keys: () => [] });
    return visibleLogicalKeys();
  };

  // A retained facade keeps only what is not workspace data: device-global keys,
  // auth tokens, and unrelated origin values.
  const staleVisibleLogicalKeys = () => {
    const keys = realKeysOf(storage);
    if (!keys) return [];
    const visible = [];
    keys.forEach((key) => {
      if (key.startsWith(NAMESPACE_PREFIX_WITH_SEPARATOR)) return;   // any workspace, including its own
      if (isWorkspaceScopedLogicalKey(key)) return;                  // quarantined bare legacy
      if (isQuarantinedLegacyKey(key)) return;
      visible.push(key);
    });
    return visible;
  };

  const facade = {
    get length() {
      return facadeVisibleKeys().length;
    },
    key(index) {
      const keys = facadeVisibleKeys();
      const position = Number(index);
      if (!Number.isInteger(position) || position < 0 || position >= keys.length) return null;
      return keys[position];
    },
    getItem(key) {
      const normalizedKey = normalizeStorageKey(key);
      if (isQuarantinedLegacyKey(normalizedKey)) return null;
      if (isForeignPhysicalKey(normalizedKey)) return null;
      // A retained facade for a workspace that is no longer active has no
      // workspace data at all: not its own old scoped values, and certainly not
      // the currently active workspace's runtime.
      if (!isCurrentFacade()) {
        if (isWorkspaceScopedLogicalKey(normalizedKey)) return null;
      } else if (protectedRouting()) {
        const routing = classifyAuthoritativeKey(normalizedKey);
        if (routing === "vault") {
          // Approved business data is served from the verified encrypted runtime
          // -- including while mutations are frozen, while the adapter is being
          // reinstalled, and while the vault is locked. If no readable adapter
          // matches, the key is ABSENT; it never falls back to scoped plaintext.
          const adapter = facadeReadableAdapter();
          return adapter ? adapter.getItem(normalizedKey) : null;
        }
        // An unclassified workspace-shaped key has no authoritative home, so it
        // reads as absent rather than reopening a plaintext business channel.
        if (routing === "refused") return null;
      }
      try {
        const value = storage.getItem(toPhysicalKey(normalizedKey));
        return value === undefined ? null : value;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      const normalizedKey = normalizeStorageKey(key);
      if (isQuarantinedLegacyKey(normalizedKey)) return undefined;
      if (isForeignPhysicalKey(normalizedKey)) return undefined;
      if (!isCurrentFacade()) {
        if (isWorkspaceScopedLogicalKey(normalizedKey)) return undefined;
      } else if (protectedRouting()) {
        const routing = classifyAuthoritativeKey(normalizedKey);
        // Never writes scoped plaintext for business data. Without a mutable
        // matching adapter the mutation is refused outright rather than
        // deferred, redirected, or written as plaintext.
        if (routing === "vault") {
          const adapter = facadeMutableAdapter();
          if (adapter) adapter.setItem(normalizedKey, value);
          return undefined;
        }
        if (routing === "refused") return undefined;
        return storage.setItem(toPhysicalKey(normalizedKey), value);
      }
      if (!mayMutate()) return undefined;
      return storage.setItem(toPhysicalKey(normalizedKey), value);
    },
    removeItem(key) {
      const normalizedKey = normalizeStorageKey(key);
      if (isQuarantinedLegacyKey(normalizedKey)) return undefined;
      if (isForeignPhysicalKey(normalizedKey)) return undefined;
      if (!isCurrentFacade()) {
        if (isWorkspaceScopedLogicalKey(normalizedKey)) return undefined;
      } else if (protectedRouting()) {
        const routing = classifyAuthoritativeKey(normalizedKey);
        if (routing === "vault") {
          const adapter = facadeMutableAdapter();
          if (adapter) adapter.removeItem(normalizedKey);
          return undefined;
        }
        if (routing === "refused") return undefined;
        return storage.removeItem(toPhysicalKey(normalizedKey));
      }
      if (!mayMutate()) return undefined;
      return storage.removeItem(toPhysicalKey(normalizedKey));
    },
    // ISO-15H -- these two narrowly scoped methods are the only migration
    // escape hatches. They stay inside this active facade, cannot name a
    // physical key or another namespace, and never expose the backing store.
    setVaultCompatibilityGuardValue(rawValue) {
      if (rawValue !== '{"version":1,"state":"transition"}'
        && rawValue !== '{"version":1,"state":"authoritative"}') return null;
      invalidateDeviceGuardState();
      try {
        storage.setItem("estipaid-vault-guard-v1", rawValue);
        return storage.getItem("estipaid-vault-guard-v1");
      } catch {
        return null;
      }
    },
    // ISO-15H/ISO-16 -- the migration orchestrator's privileged read of the
    // frozen scoped PLAINTEXT source. Ordinary getItem stops serving business
    // plaintext the moment the guard is authoritative, but the completed-
    // authority verification still has to be able to prove the sources are
    // really gone, so it reads through this named, current-facade-only,
    // workspace-scoped-only accessor instead of through the application surface.
    readVaultMigrationSourceItem(key) {
      const normalizedKey = normalizeStorageKey(key);
      if (!isCurrentFacade()) return null;
      if (!isWorkspaceScopedLogicalKey(normalizedKey)) return null;
      if (isQuarantinedLegacyKey(normalizedKey) || isForeignPhysicalKey(normalizedKey)) return null;
      try {
        const value = storage.getItem(`${scopedPrefix}${normalizedKey}`);
        return value === undefined ? null : value;
      } catch {
        return null;
      }
    },
    removeVaultMigrationItem(key) {
      const normalizedKey = normalizeStorageKey(key);
      const guard = freshNativeGuard();
      if (!isWorkspaceScopedLogicalKey(normalizedKey)
        || guard?.state !== "authoritative"
        || activeWorkspace?.namespace !== namespace
        || activeWorkspace?.facade !== facade) return false;
      try {
        storage.removeItem(`${scopedPrefix}${normalizedKey}`);
        return storage.getItem(`${scopedPrefix}${normalizedKey}`) === null;
      } catch {
        return false;
      }
    },
    // Never clears the browser origin. Only the active workspace's own scoped
    // keys are removed: other workspaces, legacy unscoped values, Supabase auth
    // keys, language, device id, and unrelated data all survive.
    clear() {
      // A retained facade clears nothing at all.
      if (!isCurrentFacade()) return undefined;
      if (protectedRouting()) {
        // Clears only approved encrypted business records. Vault metadata, the
        // frozen migration manifest, other workspaces, device-global keys, and
        // quarantined legacy values are all untouched. A frozen or absent
        // adapter refuses the clear rather than performing a partial one.
        const adapter = facadeMutableAdapter();
        if (adapter) adapter.clear();
        return undefined;
      }
      if (!mayMutate()) return undefined;
      const keys = realKeysOf(storage);
      if (!keys) return undefined;
      keys
        .filter((key) => key.startsWith(scopedPrefix) && key !== `${scopedPrefix}${WORKSPACE_MARKER_LOGICAL_KEY}`)
        .forEach((key) => {
          try { storage.removeItem(key); } catch { /* leave the rest intact */ }
        });
      return undefined;
    },
  };

  facadeMetadata.set(facade, { storage, namespace });
  return facade;
}

let installedGlobal = null; // { originalDescriptor, facade }
let activeWorkspace = null; // { namespace, userId, companyId, storage, facade }
let crossTabBridge = null;  // { namespace, listener } -- module-private, never exported

// The bridge listener receives a native event whose storageArea is the real
// Storage object even while the global property is temporarily the facade.
export function isActiveAccountScopedNativeStorage(storage) {
  return Boolean(activeWorkspace?.storage && storage === activeWorkspace.storage);
}

// ISO-14L -- cross-tab event bridge.
//
// A write in another tab raises a native `storage` event carrying the PHYSICAL
// key, so in-app listeners comparing against logical keys never matched and
// cross-tab updates were silently dropped. This bridge is the single
// translation boundary: it re-emits the same `pe-localstorage` custom event the
// app already listens to for same-tab writes, carrying the LOGICAL key.
//
// It is deliberately narrow:
//   - only keys inside the exact active namespace are translated, so another
//     user's or company's workspace, unscoped legacy EstiPaid keys, Field
//     Pocket keys, device-global keys, and Supabase `sb-*` auth events are all
//     ignored (and therefore never duplicated);
//   - the workspace marker is never re-emitted;
//   - the physical key never leaves this function;
//   - it performs NO storage operation -- the new/old values come from the
//     event itself, so translation cannot read, write, or enumerate anything.
function removeCrossTabBridge() {
  if (!crossTabBridge) return;
  try {
    window.removeEventListener("storage", crossTabBridge.listener);
  } catch { /* window torn down; drop the reference either way */ }
  crossTabBridge = null;
}

function installCrossTabBridge(namespace) {
  // Always drop any previous listener first: re-activating, or switching
  // identity, must never leave two bridges attached.
  removeCrossTabBridge();
  if (typeof window === "undefined" || typeof window.addEventListener !== "function") return;

  const scopedPrefix = `${namespace}:`;
  const listener = (event) => {
    const physicalKey = event?.key;
    if (typeof physicalKey !== "string" || !physicalKey.startsWith(scopedPrefix)) return;

    const logicalKey = physicalKey.slice(scopedPrefix.length);
    if (!logicalKey || logicalKey === WORKSPACE_MARKER_LOGICAL_KEY) return;
    if (!isWorkspaceScopedLogicalKey(logicalKey)) return;

    try {
      window.dispatchEvent(new CustomEvent("pe-localstorage", {
        detail: {
          key: logicalKey,
          value: event.newValue,
          oldValue: event.oldValue,
          crossTab: true,
        },
      }));
    } catch { /* a listener that throws must not break storage */ }
  };

  window.addEventListener("storage", listener);
  crossTabBridge = { namespace, listener };
}

function unwrapRealStorage(storage) {
  const metadata = storage && facadeMetadata.get(storage);
  return metadata?.storage || storage || null;
}

function restoreGlobalLocalStorage() {
  if (!installedGlobal || typeof window === "undefined") {
    installedGlobal = null;
    return;
  }
  const { originalDescriptor } = installedGlobal;
  try {
    if (originalDescriptor) {
      Object.defineProperty(window, "localStorage", originalDescriptor);
    } else {
      delete window.localStorage;
    }
  } catch { /* leave the facade in place rather than losing storage entirely */ }
  installedGlobal = null;
}

function installGlobalLocalStorage(facade) {
  if (typeof window === "undefined") return false;
  const originalDescriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  try {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { return facade; },
    });
  } catch {
    return false;
  }
  if (window.localStorage !== facade) {
    installedGlobal = { originalDescriptor, facade };
    restoreGlobalLocalStorage();
    return false;
  }
  installedGlobal = { originalDescriptor, facade };
  return true;
}

function failed(error) {
  return { ok: false, namespace: "", storage: null, marker: null, installed: false, error };
}

// Opens (creating on first use) the workspace for an exact authenticated
// identity and installs the compatibility boundary. Fails closed: on any
// failure nothing is installed and the caller must not mount the app.
export function activateAccountScopedLocalStorage({
  storage,
  userId,
  companyId,
  now = () => new Date().toISOString(),
} = {}) {
  // Always start from a clean global so re-activation cannot stack facades or
  // cross-tab listeners. Doing this before the identity check also means a
  // failed activation leaves nothing installed.
  const previousNamespace = activeWorkspace?.namespace || "";
  restoreGlobalLocalStorage();
  removeCrossTabBridge();
  invalidateDeviceGuardState();
  activeWorkspace = null;

  const namespace = buildAccountWorkspaceNamespace({ userId, companyId });
  // The authoritative adapter is revoked whenever the workspace CHANGES, so a
  // switched or signed-out identity can never leave a previous runtime
  // reachable. Re-activating the SAME namespace (a re-render, a remount) leaves
  // a valid adapter in place: tearing it down would strand the application with
  // no readable business data until the runtime re-hydrated.
  if (!namespace || namespace !== previousNamespace) {
    revokeAuthoritativeVaultRuntime();
    setActiveWorkspaceVaultCompatibility();
  }

  if (!namespace) return failed(ACCOUNT_SCOPED_STORAGE_ERROR.INCOMPLETE_IDENTITY);

  const realStorage = unwrapRealStorage(storage);
  if (!isUsableStorage(realStorage)) return failed(ACCOUNT_SCOPED_STORAGE_ERROR.STORAGE_UNAVAILABLE);

  const written = writeWorkspaceMarker({ storage: realStorage, namespace, userId, companyId, now });
  if (!written) return failed(ACCOUNT_SCOPED_STORAGE_ERROR.MARKER_UNVERIFIED);

  // Verification is a real read-back: the namespace must contain a marker that
  // names this exact user and company.
  const verified = readWorkspaceMarker({ storage: realStorage, namespace });
  if (!verified || verified.userId !== strictId(userId) || verified.companyId !== strictId(companyId)) {
    return failed(ACCOUNT_SCOPED_STORAGE_ERROR.MARKER_UNVERIFIED);
  }

  const facade = createScopedStorageFacade({ storage: realStorage, namespace });

  // Unit tests may activate against a standalone storage object; only a real
  // `window.localStorage` is swapped globally.
  const shouldInstall = typeof window !== "undefined" && realStorage === unwrapRealStorage(window.localStorage);
  if (shouldInstall && !installGlobalLocalStorage(facade)) {
    return failed(ACCOUNT_SCOPED_STORAGE_ERROR.INSTALL_FAILED);
  }

  invalidateDeviceGuardState();
  activeWorkspace = { namespace, userId: strictId(userId), companyId: strictId(companyId), storage: realStorage, facade };

  // Only a verified, active workspace gets a cross-tab bridge.
  installCrossTabBridge(namespace);

  return { ok: true, namespace, storage: facade, marker: verified, installed: Boolean(shouldInstall), error: "" };
}

export function deactivateAccountScopedLocalStorage() {
  restoreGlobalLocalStorage();
  removeCrossTabBridge();
  invalidateDeviceGuardState();
  activeWorkspace = null;
  // The authoritative adapter is revoked with the workspace, so a switched or
  // signed-out identity can never leave a previous runtime reachable.
  revokeAuthoritativeVaultRuntime();
  setActiveWorkspaceVaultCompatibility();
}

export function getActiveAccountWorkspaceNamespace() {
  return activeWorkspace?.namespace || "";
}

export function getActiveAccountScopedStorage() {
  return activeWorkspace?.facade || null;
}

// Read-only diagnostics for one identity's workspace. Never installs anything
// and never reads a legacy unscoped key.
export function inspectAccountScopedWorkspace({ storage, userId, companyId } = {}) {
  const namespace = buildAccountWorkspaceNamespace({ userId, companyId });
  if (!namespace) {
    return { ok: false, namespace: "", marker: null, logicalKeys: [], error: ACCOUNT_SCOPED_STORAGE_ERROR.INCOMPLETE_IDENTITY };
  }
  const realStorage = unwrapRealStorage(storage);
  if (!isUsableStorage(realStorage)) {
    return { ok: false, namespace, marker: null, logicalKeys: [], error: ACCOUNT_SCOPED_STORAGE_ERROR.STORAGE_UNAVAILABLE };
  }
  const keys = realKeysOf(realStorage);
  if (!keys) {
    return { ok: false, namespace, marker: null, logicalKeys: [], error: ACCOUNT_SCOPED_STORAGE_ERROR.STORAGE_UNAVAILABLE };
  }
  const scopedPrefix = `${namespace}:`;
  const logicalKeys = keys
    .filter((key) => key.startsWith(scopedPrefix))
    .map((key) => key.slice(scopedPrefix.length))
    .filter((logicalKey) => logicalKey !== WORKSPACE_MARKER_LOGICAL_KEY);
  return {
    ok: true,
    namespace,
    marker: readWorkspaceMarker({ storage: realStorage, namespace }),
    logicalKeys,
    error: "",
  };
}
