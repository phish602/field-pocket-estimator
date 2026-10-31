import { BROWSER_SURFACE_OWNER_KEY } from "./browserSurfaceAuthority";

// Two browser tabs are two DOCUMENTS: each has its own module instance, and both
// see one shared browser-profile localStorage. `jest.isolateModules` reproduces
// that exactly -- a second registry for the plain authority module (no React
// involved), pointed at the same fake storage.
function createSharedStorage({ failMode = "" } = {}) {
  const values = new Map();
  return {
    values,
    getItem(key) {
      if (failMode === "read" || failMode === "all") throw new Error("storage blocked");
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      if (failMode === "write" || failMode === "all") throw new Error("storage blocked");
      values.set(key, String(value));
    },
    removeItem(key) { values.delete(key); },
  };
}

function createSurface(storage) {
  let authority = null;
  jest.isolateModules(() => {
    authority = require("./browserSurfaceAuthority");
  });
  authority.startBrowserSurfaceAuthority({ storage });
  return authority;
}

function storedOwner(storage) {
  const raw = storage.values.get(BROWSER_SURFACE_OWNER_KEY);
  return raw ? JSON.parse(raw) : null;
}

describe("browser surface authority", () => {
  test("two surfaces share one storage and exactly one of them owns EstiPaid", () => {
    const storage = createSharedStorage();
    const surfaceA = createSurface(storage);
    const surfaceB = createSurface(storage);

    expect(surfaceA.getBrowserSurfaceId()).toBeTruthy();
    expect(surfaceB.getBrowserSurfaceId()).toBeTruthy();
    expect(surfaceA.getBrowserSurfaceId()).not.toBe(surfaceB.getBrowserSurfaceId());

    const claimA = surfaceA.claimBrowserSurface();
    expect(claimA).toEqual({ ok: true, active: true, code: "", claimToken: storedOwner(storage).claimToken });
    expect(surfaceA.isBrowserSurfaceActive()).toBe(true);
    expect(surfaceB.isBrowserSurfaceActive()).toBe(false);
    expect(storedOwner(storage).surfaceId).toBe(surfaceA.getBrowserSurfaceId());

    // B takes over.
    const claimB = surfaceB.claimBrowserSurface();
    expect(claimB).toEqual({ ok: true, active: true, code: "", claimToken: storedOwner(storage).claimToken });
    expect(claimB.claimToken).not.toBe(claimA.claimToken);
    expect(surfaceB.isBrowserSurfaceActive()).toBe(true);
    // A loses authority from the shared record alone -- no notification needed.
    expect(surfaceA.isBrowserSurfaceActive()).toBe(false);

    const owner = storedOwner(storage);
    expect(owner.surfaceId).toBe(surfaceB.getBrowserSurfaceId());
    expect(owner.version).toBe(1);
    // Coordination metadata only: no business data, account, or secret.
    expect(Object.keys(owner).sort()).toEqual(["claimToken", "claimedAt", "surfaceId", "version"]);
  });

  test("switching back transfers ownership back to the first surface", () => {
    const storage = createSharedStorage();
    const surfaceA = createSurface(storage);
    const surfaceB = createSurface(storage);

    surfaceA.claimBrowserSurface();
    surfaceB.claimBrowserSurface();
    expect(surfaceA.isBrowserSurfaceActive()).toBe(false);

    // The user comes back to tab A.
    expect(surfaceA.claimBrowserSurface().active).toBe(true);
    expect(surfaceA.isBrowserSurfaceActive()).toBe(true);
    expect(surfaceB.isBrowserSurfaceActive()).toBe(false);
  });

  test("a duplicated tab cannot inherit a live surface identity", () => {
    const storage = createSharedStorage();
    const original = createSurface(storage);
    original.claimBrowserSurface();

    // Duplicating a tab can clone sessionStorage, so identity is never kept
    // there. Cloning that store changes nothing about who owns EstiPaid.
    window.sessionStorage.setItem("estipaid-browser-surface-owner-v1", JSON.stringify({
      version: 1, surfaceId: original.getBrowserSurfaceId(), claimToken: "cloned", claimedAt: Date.now(),
    }));
    const duplicate = createSurface(storage);

    expect(duplicate.getBrowserSurfaceId()).not.toBe(original.getBrowserSurfaceId());
    expect(duplicate.isBrowserSurfaceActive()).toBe(false);
    expect(original.isBrowserSurfaceActive()).toBe(true);

    // When the duplicate is used, it takes over like any other new tab.
    expect(duplicate.claimBrowserSurface().active).toBe(true);
    expect(original.isBrowserSurfaceActive()).toBe(false);
    window.sessionStorage.clear();
  });

  test("a refresh replaces the document and leaves exactly one living owner", () => {
    const storage = createSharedStorage();
    const before = createSurface(storage);
    before.claimBrowserSurface();
    const beforeId = before.getBrowserSurfaceId();
    const businessLike = storage.values.size;

    // The document is destroyed on reload.
    before.resetBrowserSurfaceAuthorityForTests();
    expect(before.isBrowserSurfaceAuthorityStarted()).toBe(false);

    const after = createSurface(storage);
    expect(after.getBrowserSurfaceId()).not.toBe(beforeId);
    expect(after.claimBrowserSurface().active).toBe(true);
    expect(after.isBrowserSurfaceActive()).toBe(true);
    // Nothing else in storage was touched: no reset, no clear.
    expect(storage.values.size).toBe(businessLike);
  });

  test("a claim is proven by rereading the stored record, not by calling setItem", () => {
    const storage = createSharedStorage();
    const surfaceA = createSurface(storage);
    const surfaceB = createSurface(storage);

    // A writes, but B's claim lands last in the same instant.
    const raced = {
      ...storage,
      setItem(key, value) {
        storage.setItem(key, value);
        // Another surface overwrites immediately after this write.
        surfaceB.claimBrowserSurface();
      },
    };
    surfaceA.startBrowserSurfaceAuthority({ storage: raced });

    const result = surfaceA.claimBrowserSurface();
    expect(result).toEqual({ ok: false, active: false, code: "browser_surface_inactive" });
    expect(storedOwner(storage).surfaceId).toBe(surfaceB.getBrowserSurfaceId());
  });

  test.each([
    ["a write failure", { failMode: "write" }],
    ["a read failure", { failMode: "read" }],
    ["a fully blocked store", { failMode: "all" }],
  ])("%s fails closed instead of allowing a second live writer", (_label, options) => {
    const storage = createSharedStorage(options);
    // Anything else this browser profile holds must survive untouched.
    storage.values.set("estipaid-estimates", "[{\"id\":\"estimate-1\"}]");
    const surface = createSurface(storage);

    expect(surface.claimBrowserSurface()).toEqual(expect.objectContaining({
      ok: false,
      active: false,
      code: "browser_surface_storage_unavailable",
    }));
    expect(surface.isBrowserSurfaceActive()).toBe(false);
    // Failing closed never clears, resets, or repairs stored data.
    expect(storage.values.get("estipaid-estimates")).toBe("[{\"id\":\"estimate-1\"}]");
  });

  test.each([
    ["a missing record", null],
    ["a malformed string", "not json"],
    ["a wrong version", JSON.stringify({ version: 2, surfaceId: "s", claimToken: "t", claimedAt: 1 })],
    ["a missing field", JSON.stringify({ version: 1, surfaceId: "s", claimedAt: 1 })],
    ["an extra field", JSON.stringify({ version: 1, surfaceId: "s", claimToken: "t", claimedAt: 1, extra: 1 })],
    ["an empty surface id", JSON.stringify({ version: 1, surfaceId: "", claimToken: "t", claimedAt: 1 })],
    ["an invalid timestamp", JSON.stringify({ version: 1, surfaceId: "s", claimToken: "t", claimedAt: 0 })],
  ])("%s grants nobody authority", (_label, raw) => {
    const storage = createSharedStorage();
    if (raw !== null) storage.values.set(BROWSER_SURFACE_OWNER_KEY, raw);
    const surface = createSurface(storage);

    expect(surface.readBrowserSurfaceOwner()).toBeNull();
    expect(surface.isBrowserSurfaceActive()).toBe(false);
    // An attended surface may safely overwrite unusable coordination metadata.
    expect(surface.claimBrowserSurface().active).toBe(true);
  });

  test("a document that never installed authority has no arbitration to enforce", () => {
    const storage = createSharedStorage();
    let authority = null;
    jest.isolateModules(() => { authority = require("./browserSurfaceAuthority"); });

    expect(authority.isBrowserSurfaceAuthorityStarted()).toBe(false);
    expect(authority.isBrowserSurfaceActive()).toBe(true);

    // Once started, it is enforced strictly: started-but-inactive is never
    // permissive.
    authority.startBrowserSurfaceAuthority({ storage });
    const other = createSurface(storage);
    other.claimBrowserSurface();
    expect(authority.isBrowserSurfaceActive()).toBe(false);
  });

  test("the typed refusal names the browser surface and never a device lock", () => {
    let authority = null;
    jest.isolateModules(() => { authority = require("./browserSurfaceAuthority"); });
    const error = authority.browserSurfaceInactiveError("estimate_save");

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("browser_surface_inactive");
    expect(error.reason).toBe("estimate_save");
    expect(error.userMessage).toContain("another tab");
    expect(error.deviceLockLost).toBeUndefined();
  });

  // The same-window live defect, at the module level: two documents, one shared
  // record, and only ONE automatic claim each.
  test("each document gets exactly one automatic first-attendance claim", () => {
    const storage = createSharedStorage();
    const surfaceA = createSurface(storage);
    const surfaceB = createSurface(storage);

    expect(surfaceA.claimFirstAttendance()).toEqual(expect.objectContaining({ attempted: true, active: true }));
    expect(surfaceA.hasConsumedFirstAttendanceClaim()).toBe(true);

    // B opens and is attended: it takes over, no button needed.
    expect(surfaceB.claimFirstAttendance()).toEqual(expect.objectContaining({ attempted: true, active: true }));
    expect(surfaceA.isBrowserSurfaceActive()).toBe(false);

    // A is selected again. Its automatic opportunity is spent, so nothing is
    // written and B keeps EstiPaid.
    const again = surfaceA.claimFirstAttendance();
    expect(again).toEqual(expect.objectContaining({ attempted: false, active: false }));
    expect(storedOwner(storage).surfaceId).toBe(surfaceB.getBrowserSurfaceId());

    // Only the explicit action transfers it back.
    expect(surfaceA.claimBrowserSurface().active).toBe(true);
    expect(storedOwner(storage).surfaceId).toBe(surfaceA.getBrowserSurfaceId());
    expect(surfaceB.isBrowserSurfaceActive()).toBe(false);

    // And B cannot take it back automatically either.
    expect(surfaceB.claimFirstAttendance()).toEqual(expect.objectContaining({ attempted: false }));
    expect(storedOwner(storage).surfaceId).toBe(surfaceA.getBrowserSurfaceId());
  });

  test("a replacement document after a refresh gets a fresh automatic claim", () => {
    const storage = createSharedStorage();
    const before = createSurface(storage);
    before.claimFirstAttendance();
    expect(before.hasConsumedFirstAttendanceClaim()).toBe(true);

    before.resetBrowserSurfaceAuthorityForTests();
    const after = createSurface(storage);

    // A new document, so a new opportunity -- a normal refresh needs no button.
    expect(after.hasConsumedFirstAttendanceClaim()).toBe(false);
    expect(after.claimFirstAttendance()).toEqual(expect.objectContaining({ attempted: true, active: true }));
  });

  test("an explicit claim also spends the automatic opportunity", () => {
    const storage = createSharedStorage();
    const surface = createSurface(storage);

    expect(surface.claimBrowserSurface().active).toBe(true);
    expect(surface.hasConsumedFirstAttendanceClaim()).toBe(true);
    expect(surface.claimFirstAttendance()).toEqual(expect.objectContaining({ attempted: false }));
  });

  // The remount hole: a React cleanup/remount, a StrictMode double-invoke, or an
  // HMR cycle all happen inside ONE document. None of them may mint a new
  // identity or hand a stale surface a second automatic claim.
  test("stop/start inside the same document keeps the identity and the spent claim", () => {
    const storage = createSharedStorage();
    const surfaceA = createSurface(storage);
    const surfaceB = createSurface(storage);

    surfaceA.claimFirstAttendance();
    const originalId = surfaceA.getBrowserSurfaceId();
    surfaceB.claimFirstAttendance();
    expect(surfaceA.isBrowserSurfaceActive()).toBe(false);

    // Exactly what a hook cleanup + remount does to the authority module.
    surfaceA.startBrowserSurfaceAuthority({ storage });
    surfaceA.startBrowserSurfaceAuthority({ storage });

    expect(surfaceA.getBrowserSurfaceId()).toBe(originalId);
    expect(surfaceA.hasConsumedFirstAttendanceClaim()).toBe(true);
    expect(surfaceA.claimFirstAttendance()).toEqual(expect.objectContaining({ attempted: false, active: false }));
    expect(storedOwner(storage).surfaceId).toBe(surfaceB.getBrowserSurfaceId());
    expect(surfaceA.isBrowserSurfaceActive()).toBe(false);
  });

  test("a remount cannot rearm the automatic claim after an explicit transfer either", () => {
    const storage = createSharedStorage();
    const surfaceA = createSurface(storage);
    const surfaceB = createSurface(storage);

    surfaceA.claimFirstAttendance();
    surfaceB.claimFirstAttendance();
    // A takes it back the only way it can.
    surfaceA.claimBrowserSurface();
    expect(surfaceB.isBrowserSurfaceActive()).toBe(false);

    surfaceB.startBrowserSurfaceAuthority({ storage });
    expect(surfaceB.claimFirstAttendance()).toEqual(expect.objectContaining({ attempted: false }));
    expect(storedOwner(storage).surfaceId).toBe(surfaceA.getBrowserSurfaceId());

    // Only the explicit action moves it.
    expect(surfaceB.claimBrowserSurface().active).toBe(true);
    expect(storedOwner(storage).surfaceId).toBe(surfaceB.getBrowserSurfaceId());
  });

  test("a remount of the surface that still owns keeps it active without rewriting the record", () => {
    const storage = createSharedStorage();
    const surface = createSurface(storage);
    surface.claimFirstAttendance();
    const ownerBefore = storage.values.get(BROWSER_SURFACE_OWNER_KEY);

    surface.startBrowserSurfaceAuthority({ storage });

    expect(surface.isBrowserSurfaceActive()).toBe(true);
    expect(surface.claimFirstAttendance()).toEqual(expect.objectContaining({ attempted: false, active: true }));
    expect(storage.values.get(BROWSER_SURFACE_OWNER_KEY)).toBe(ownerBefore);
  });
  // -------------------------------------------------------------------------
  // The verified claim token is the browser-ownership VERSION the vault binds
  // its readiness to. Owner-record schema is unchanged.
  // -------------------------------------------------------------------------

  test("the current claim token is exposed only while this surface owns EstiPaid", () => {
    const storage = createSharedStorage();
    const surfaceA = createSurface(storage);
    const surfaceB = createSurface(storage);

    expect(surfaceA.getBrowserSurfaceClaimToken()).toBe("");
    const t1 = surfaceA.claimBrowserSurface().claimToken;
    expect(surfaceA.getBrowserSurfaceClaimToken()).toBe(t1);
    // Rereading (what focus/visibility/pageshow do) never changes the token.
    expect(surfaceA.getBrowserSurfaceClaimToken()).toBe(t1);
    expect(surfaceB.getBrowserSurfaceClaimToken()).toBe("");

    surfaceB.claimBrowserSurface();
    // The taken-over surface can never present its old token as current.
    expect(surfaceA.getBrowserSurfaceClaimToken()).toBe("");

    // An explicit reclaim produces a FRESH token.
    const t2 = surfaceA.claimBrowserSurface().claimToken;
    expect(t2).toBeTruthy();
    expect(t2).not.toBe(t1);
    expect(surfaceA.getBrowserSurfaceClaimToken()).toBe(t2);
    expect(Object.keys(storedOwner(storage)).sort()).toEqual(["claimToken", "claimedAt", "surfaceId", "version"]);
  });

  test("a first-attendance claim in a new document produces a fresh token", () => {
    const storage = createSharedStorage();
    const first = createSurface(storage);
    const t1 = first.claimFirstAttendance().claimToken;
    const second = createSurface(storage);
    const t2 = second.claimFirstAttendance().claimToken;
    expect(t1).toBeTruthy();
    expect(t2).toBeTruthy();
    expect(t2).not.toBe(t1);
    expect(second.getBrowserSurfaceClaimToken()).toBe(t2);
    expect(first.getBrowserSurfaceClaimToken()).toBe("");
  });
});
