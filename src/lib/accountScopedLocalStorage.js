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

import { readVaultCompatibilityGuard } from "./vaultCompatibilityGuard";

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
  activeVaultCompatibility = {
    workspaceTag: typeof workspaceTag === "string" ? workspaceTag : "",
    state: state === "legacy-safe" ? "legacy-safe" : "blocked",
    generation: Number.isSafeInteger(generation) && generation >= 0 ? generation : 0,
  };
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

  // The guard is re-read synchronously for every mutation. A stale bridge tab
  // therefore cannot write after another tab has published a guard state.
  const mayMutate = () => {
    const guard = readVaultCompatibilityGuard();
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

  const facade = {
    get length() {
      return visibleLogicalKeys().length;
    },
    key(index) {
      const keys = visibleLogicalKeys();
      const position = Number(index);
      if (!Number.isInteger(position) || position < 0 || position >= keys.length) return null;
      return keys[position];
    },
    getItem(key) {
      const normalizedKey = normalizeStorageKey(key);
      if (isQuarantinedLegacyKey(normalizedKey)) return null;
      if (isForeignPhysicalKey(normalizedKey)) return null;
      try {
        const value = storage.getItem(toPhysicalKey(normalizedKey));
        return value === undefined ? null : value;
      } catch {
        return null;
      }
    },
    setItem(key, value) {
      if (!mayMutate()) return undefined;
      const normalizedKey = normalizeStorageKey(key);
      if (isQuarantinedLegacyKey(normalizedKey)) return undefined;
      if (isForeignPhysicalKey(normalizedKey)) return undefined;
      return storage.setItem(toPhysicalKey(normalizedKey), value);
    },
    removeItem(key) {
      if (!mayMutate()) return undefined;
      const normalizedKey = normalizeStorageKey(key);
      if (isQuarantinedLegacyKey(normalizedKey)) return undefined;
      if (isForeignPhysicalKey(normalizedKey)) return undefined;
      return storage.removeItem(toPhysicalKey(normalizedKey));
    },
    // ISO-15H -- these two narrowly scoped methods are the only migration
    // escape hatches. They stay inside this active facade, cannot name a
    // physical key or another namespace, and never expose the backing store.
    setVaultCompatibilityGuardValue(rawValue) {
      if (rawValue !== '{"version":1,"state":"transition"}'
        && rawValue !== '{"version":1,"state":"authoritative"}') return null;
      try {
        storage.setItem("estipaid-vault-guard-v1", rawValue);
        return storage.getItem("estipaid-vault-guard-v1");
      } catch {
        return null;
      }
    },
    removeVaultMigrationItem(key) {
      const normalizedKey = normalizeStorageKey(key);
      const guard = readVaultCompatibilityGuard();
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
  restoreGlobalLocalStorage();
  removeCrossTabBridge();
  activeWorkspace = null;
  setActiveWorkspaceVaultCompatibility();

  const namespace = buildAccountWorkspaceNamespace({ userId, companyId });
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

  activeWorkspace = { namespace, userId: strictId(userId), companyId: strictId(companyId), storage: realStorage, facade };

  // Only a verified, active workspace gets a cross-tab bridge.
  installCrossTabBridge(namespace);

  return { ok: true, namespace, storage: facade, marker: verified, installed: Boolean(shouldInstall), error: "" };
}

export function deactivateAccountScopedLocalStorage() {
  restoreGlobalLocalStorage();
  removeCrossTabBridge();
  activeWorkspace = null;
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
