// @ts-nocheck
/* eslint-disable */

// The single owner of BROWSER-SURFACE authority: which browser document (tab or
// window) is the one live EstiPaid client on this browser profile.
//
// This is deliberately NOT the physical-device lock. Every tab in one browser
// profile shares `estipaid-device-id-v1`, so the Supabase device lock cannot
// tell two tabs apart -- and must not try to. Tab switching is a local, offline,
// zero-network transition: it never claims the active device, never writes to
// Supabase, and never signs anyone out (auth persistence is shared across tabs,
// so a global sign-out would destroy the session of the tab the user just moved
// to).
//
// The ownership record lives in native, device-global localStorage. It carries
// no business data, no account identity, and no secret: only a random surface
// id, a random claim token, and a timestamp. The record itself is authority --
// the `storage` event is nothing more than a wake-up telling another surface to
// reread it.

export const BROWSER_SURFACE_OWNER_KEY = "estipaid-browser-surface-owner-v1";
export const BROWSER_SURFACE_OWNER_VERSION = 1;

// Distinct from `device_locked` on purpose: a browser takeover is local and
// reversible by attending this tab, and it must never be reported as the
// physical device losing its lease.
export const BROWSER_SURFACE_INACTIVE_CODE = "browser_surface_inactive";
export const BROWSER_SURFACE_STORAGE_UNAVAILABLE_CODE = "browser_surface_storage_unavailable";
export const BROWSER_SURFACE_INACTIVE_MESSAGE =
  "EstiPaid is active in another tab. Use this tab to continue here.";

const OWNER_FIELDS = ["claimToken", "claimedAt", "surfaceId", "version"];

// One document == one live surface, and BOTH pieces of that identity live as
// long as the module does -- which is exactly as long as the document does.
//
// This is deliberately not tied to a React subscription. A hook cleanup and
// remount, a StrictMode double-invoke, an App remount, a gate transition, or an
// HMR cycle all happen inside ONE loaded document; if they minted a new surface
// id or restored the automatic claim, a stale tab could silently take EstiPaid
// back just by re-rendering. Only a genuinely new document -- a new tab, a
// duplicate, a refresh, a navigation -- builds a new module context, and that is
// the only thing that produces a new identity.
//
// Held in memory ONLY: sessionStorage is cloned when a browser duplicates a tab,
// so persisting the id there would let a duplicate inherit a live surface's
// authority.
let surfaceId = "";
let started = false;
let ownerStorage = null;

// Each document gets exactly ONE automatic claim: its first real attendance.
//
// Without this, ordinary tab switching silently traded ownership back and forth.
// Two tabs in one window each ran their focus/visibility handlers on selection,
// each reclaimed before the inactive gate could be seen, and both tabs looked
// live. After a surface has participated once, ownership moves only through the
// explicit "Use This Tab" action or a genuinely new document (a refresh, a new
// tab, a duplicate) -- never from merely looking at a tab again.
//
// Memory-only and per DOCUMENT -- not per hook mount: never in localStorage,
// never in sessionStorage, never in the owner record. A reload builds a new
// document and therefore a fresh opportunity, which is why refreshing the active
// tab still comes back active on its own; a remount inside the same document
// does not.
let firstAttendanceClaimed = false;

// The NATIVE backing Storage, captured while this module is evaluated -- before
// any workspace is open.
//
// While a workspace is active the account-scoped facade IS window.localStorage,
// and it routes by logical key: an unrecognised key is not device-global, so the
// owner record would be scoped, refused, or simply unreadable exactly when the
// final mutation fence needs it. The compatibility guard already reads its own
// device-global key straight from the real Storage for the same reason. Holding
// the real object also keeps this readable while vault state is changing, which
// is the whole point of documenting the key as a storage exclusion.
const nativeStorage = (() => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
})();

function defaultStorage() {
  if (nativeStorage) return nativeStorage;
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

// Ids and claim tokens need to be UNIQUE, not secret: the record is device-local,
// non-secret, and grants nothing to anyone who reads it. Web Crypto is used when
// present, and the fallback is the same shape the device-lock module already
// uses, plus a per-document counter so two surfaces created inside one
// millisecond can never collide.
let tokenSequence = 0;
function randomToken() {
  const source = typeof globalThis === "undefined" ? null : globalThis.crypto;
  try {
    if (source && typeof source.randomUUID === "function") return String(source.randomUUID());
    if (source && typeof source.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      source.getRandomValues(bytes);
      return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
  } catch { /* fall through to the local fallback */ }
  tokenSequence += 1;
  return `surface_${Date.now()}_${tokenSequence}_${Math.random().toString(16).slice(2, 10)}`;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

// Strict, exact shape. Anything else -- a truncated write, a hand-edited value,
// an object from another product on this origin -- grants nothing. A malformed
// record simply means no surface owns EstiPaid yet, and the next attended
// surface overwrites it with a real claim.
export function parseBrowserSurfaceOwnerRecord(raw) {
  if (!nonEmptyString(raw)) return null;
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const prototype = Object.getPrototypeOf(parsed);
  if (prototype !== Object.prototype && prototype !== null) return null;
  if (Object.getOwnPropertyNames(parsed).sort().join(",") !== OWNER_FIELDS.join(",")) return null;
  if (parsed.version !== BROWSER_SURFACE_OWNER_VERSION) return null;
  if (!nonEmptyString(parsed.surfaceId) || !nonEmptyString(parsed.claimToken)) return null;
  if (!Number.isSafeInteger(parsed.claimedAt) || parsed.claimedAt <= 0) return null;
  return Object.freeze({
    version: parsed.version,
    surfaceId: parsed.surfaceId,
    claimToken: parsed.claimToken,
    claimedAt: parsed.claimedAt,
  });
}

function activeStorage() {
  return ownerStorage || defaultStorage();
}

// Reading is the only source of truth. A throwing/blocked storage reads as "no
// owner", which fails closed for every caller below.
export function readBrowserSurfaceOwner() {
  const storage = activeStorage();
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    return parseBrowserSurfaceOwnerRecord(storage.getItem(BROWSER_SURFACE_OWNER_KEY));
  } catch {
    return null;
  }
}

/**
 * Installs authority for THIS document. Idempotent across the document's whole
 * life: a second call -- a StrictMode double-invoke, a remount, an HMR cycle --
 * keeps the same surface id AND the same spent/unspent automatic claim.
 */
export function startBrowserSurfaceAuthority({ storage = undefined } = {}) {
  if (storage !== undefined) ownerStorage = storage;
  // The identity is minted once for this document and then reused for every
  // later install, so stopping and starting the hook cannot fork one document
  // into two surfaces or hand it a second automatic claim.
  if (!surfaceId) surfaceId = randomToken();
  started = Boolean(surfaceId);
  return { ok: started, surfaceId };
}

/**
 * TEST-ONLY. Returns this module to the never-installed state so one test file
 * can stand in for several documents.
 *
 * There is deliberately no production "stop": authority belongs to the document,
 * and a document stops owning EstiPaid only when another surface claims it or
 * the document itself is gone. Nothing in the app tears this down, which is what
 * keeps a remount from rearming the automatic claim.
 */
export function resetBrowserSurfaceAuthorityForTests() {
  started = false;
  surfaceId = "";
  ownerStorage = null;
  firstAttendanceClaimed = false;
}

export function isBrowserSurfaceAuthorityStarted() {
  return started;
}

export function getBrowserSurfaceId() {
  return surfaceId;
}

/**
 * Claims this browser profile for THIS surface.
 *
 * Calling setItem is not proof of winning: two surfaces can write in the same
 * instant and the last write is the one that survives. Authority is therefore
 * decided by writing a fresh random token and reading the record back -- this
 * surface is active only when the STORED record is exactly its own claim.
 */
export function claimBrowserSurface() {
  // Any claim -- automatic or explicit -- is this document participating, so the
  // automatic opportunity is spent either way.
  firstAttendanceClaimed = true;
  if (!started) return { ok: false, active: false, code: BROWSER_SURFACE_STORAGE_UNAVAILABLE_CODE };
  const storage = activeStorage();
  const claimToken = randomToken();
  if (!storage || typeof storage.setItem !== "function" || !claimToken) {
    return { ok: false, active: false, code: BROWSER_SURFACE_STORAGE_UNAVAILABLE_CODE };
  }
  const record = {
    version: BROWSER_SURFACE_OWNER_VERSION,
    surfaceId,
    claimToken,
    claimedAt: Date.now(),
  };
  try {
    storage.setItem(BROWSER_SURFACE_OWNER_KEY, JSON.stringify(record));
  } catch {
    // Private mode, quota, or a blocked origin: business operation must not
    // continue on an unprovable surface.
    return { ok: false, active: false, code: BROWSER_SURFACE_STORAGE_UNAVAILABLE_CODE };
  }
  const stored = readBrowserSurfaceOwner();
  if (!stored) return { ok: false, active: false, code: BROWSER_SURFACE_STORAGE_UNAVAILABLE_CODE };
  if (stored.surfaceId !== surfaceId || stored.claimToken !== claimToken) {
    // Another surface's claim landed after ours. It owns EstiPaid now.
    return { ok: false, active: false, code: BROWSER_SURFACE_INACTIVE_CODE };
  }
  // The token is returned only once it has been read back as the stored owner:
  // it is the verified version of THIS ownership, and every later successful
  // claim mints a different one.
  return { ok: true, active: true, code: "", claimToken };
}

/**
 * The verified claim token of THIS surface's current ownership, or "" when this
 * surface does not own EstiPaid right now.
 *
 * Callers use it as the browser-ownership VERSION: it is stable for as long as
 * one claim stands (focus, visibility, pageshow, and remounts never change it)
 * and changes on every successful takeover. It always rereads the shared record,
 * so a surface that has been taken over can never present its old token as
 * current.
 */
export function getBrowserSurfaceClaimToken() {
  if (!started) return "";
  const owner = readBrowserSurfaceOwner();
  if (!owner || owner.surfaceId !== surfaceId) return "";
  return owner.claimToken;
}

export function hasConsumedFirstAttendanceClaim() {
  return firstAttendanceClaimed;
}

/**
 * The ONLY automatic path to ownership: this document's first real attendance.
 *
 * A newly opened foreground tab, a refreshed active tab, and a background tab
 * the person finally selects all take ownership without being asked. Every later
 * attention signal from the same document resolves to `attempted: false`, and
 * the caller then publishes whatever the shared record actually says instead of
 * overwriting a valid owner.
 */
export function claimFirstAttendance() {
  if (firstAttendanceClaimed) {
    return { attempted: false, ok: false, active: isBrowserSurfaceActive(), code: "" };
  }
  return { attempted: true, ...claimBrowserSurface() };
}

/**
 * The synchronous source of truth used by the final durable business-mutation
 * fence. It always rereads the shared record, so a takeover that happened while
 * an async save handler was in flight is seen immediately.
 *
 * When authority was never installed for this document -- an isolated unit test,
 * a headless utility, a non-App entry point -- there is no browser arbitration
 * to enforce and this reports true. Once a document HAS started authority it is
 * enforced strictly: a started-but-inactive surface is never permissive, in any
 * environment.
 */
export function isBrowserSurfaceActive() {
  if (!started) return true;
  const owner = readBrowserSurfaceOwner();
  if (!owner) return false;
  return owner.surfaceId === surfaceId;
}

/**
 * The typed refusal used by the canonical durable business-mutation owner.
 */
export function browserSurfaceInactiveError(reason = "business_mutation") {
  const error = new Error(BROWSER_SURFACE_INACTIVE_CODE);
  error.code = BROWSER_SURFACE_INACTIVE_CODE;
  error.reason = String(reason || "business_mutation");
  error.userMessage = BROWSER_SURFACE_INACTIVE_MESSAGE;
  return error;
}
