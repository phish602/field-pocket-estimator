import { act, renderHook } from "@testing-library/react";
import useBrowserSurfaceAuthority from "./useBrowserSurfaceAuthority";
import {
  BROWSER_SURFACE_OWNER_KEY,
  getBrowserSurfaceId,
  hasConsumedFirstAttendanceClaim,
  readBrowserSurfaceOwner,
  resetBrowserSurfaceAuthorityForTests,
} from "./browserSurfaceAuthority";

// One mounted hook is THIS document. "The other tab" is simulated the way a real
// one appears from here: its claim lands in the shared record, and a `storage`
// event says so.
function otherSurfaceClaims(surfaceId = "other-surface") {
  const record = JSON.stringify({
    version: 1, surfaceId, claimToken: "newer-token", claimedAt: Date.now(),
  });
  window.localStorage.setItem(BROWSER_SURFACE_OWNER_KEY, record);
  return record;
}

function deliverStorageEvent(newValue) {
  const event = new Event("storage");
  event.key = BROWSER_SURFACE_OWNER_KEY;
  event.newValue = newValue;
  window.dispatchEvent(event);
}

function setVisibility(state) {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
}

beforeEach(() => {
  window.localStorage.clear();
  setVisibility("visible");
});

afterEach(() => {
  resetBrowserSurfaceAuthorityForTests();
  window.localStorage.clear();
  setVisibility("visible");
});

test("a visible surface claims on startup and owns EstiPaid", () => {
  const { result } = renderHook(() => useBrowserSurfaceAuthority());

  expect(result.current.ready).toBe(true);
  expect(result.current.isActive).toBe(true);
  expect(result.current.code).toBe("");
  expect(result.current.surfaceId).toBeTruthy();
  expect(readBrowserSurfaceOwner().surfaceId).toBe(result.current.surfaceId);
});

test("a hidden background surface does not steal ownership merely by loading", () => {
  const ownerBefore = otherSurfaceClaims("already-open-tab");
  setVisibility("hidden");

  const { result } = renderHook(() => useBrowserSurfaceAuthority());

  expect(result.current.ready).toBe(true);
  expect(result.current.isActive).toBe(false);
  expect(result.current.code).toBe("browser_surface_inactive");
  expect(window.localStorage.getItem(BROWSER_SURFACE_OWNER_KEY)).toBe(ownerBefore);

  // It claims when the person actually looks at it.
  act(() => {
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });

  expect(result.current.isActive).toBe(true);
  expect(readBrowserSurfaceOwner().surfaceId).toBe(result.current.surfaceId);
});

test("another tab's claim makes this surface inactive and it does NOT claim back", () => {
  const { result } = renderHook(() => useBrowserSurfaceAuthority());
  const mySurfaceId = result.current.surfaceId;
  expect(result.current.isActive).toBe(true);

  act(() => {
    const record = otherSurfaceClaims("newer-tab");
    deliverStorageEvent(record);
  });

  expect(result.current.ready).toBe(true);
  expect(result.current.isActive).toBe(false);
  expect(result.current.code).toBe("browser_surface_inactive");
  // No ping-pong: the notification alone never triggers a counter-claim.
  expect(readBrowserSurfaceOwner().surfaceId).toBe("newer-tab");
  expect(readBrowserSurfaceOwner().surfaceId).not.toBe(mySurfaceId);
});

// The live same-window defect: selecting a tab used to reclaim, so two tabs in
// one window traded ownership on every click and both looked live.
test.each([
  ["focus", () => window.dispatchEvent(new Event("focus"))],
  ["a BFCache restore", () => window.dispatchEvent(new Event("pageshow"))],
  ["a visibility transition", () => document.dispatchEvent(new Event("visibilitychange"))],
])("merely attending this tab again through %s does NOT take ownership back", (_label, attend) => {
  const { result } = renderHook(() => useBrowserSurfaceAuthority());
  const mySurfaceId = result.current.surfaceId;
  // This document already spent its one automatic claim at visible startup.
  expect(result.current.isActive).toBe(true);

  act(() => { deliverStorageEvent(otherSurfaceClaims("newer-tab")); });
  expect(result.current.isActive).toBe(false);

  act(() => { attend(); });
  act(() => { attend(); });

  expect(result.current.isActive).toBe(false);
  expect(result.current.code).toBe("browser_surface_inactive");
  // Not one owner write: the record still belongs to the other tab.
  expect(readBrowserSurfaceOwner().surfaceId).toBe("newer-tab");
  expect(readBrowserSurfaceOwner().surfaceId).not.toBe(mySurfaceId);
});

test("a background tab spends its one automatic claim on its FIRST attendance only", () => {
  otherSurfaceClaims("already-open-tab");
  setVisibility("hidden");

  const { result } = renderHook(() => useBrowserSurfaceAuthority());
  const mySurfaceId = result.current.surfaceId;
  expect(result.current.isActive).toBe(false);

  // First time the person selects it: it takes over, no button needed.
  act(() => {
    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(result.current.isActive).toBe(true);
  expect(readBrowserSurfaceOwner().surfaceId).toBe(mySurfaceId);

  // Someone else takes it, and selecting this tab again does nothing.
  act(() => { deliverStorageEvent(otherSurfaceClaims("third-tab")); });
  act(() => { window.dispatchEvent(new Event("focus")); });

  expect(result.current.isActive).toBe(false);
  expect(readBrowserSurfaceOwner().surfaceId).toBe("third-tab");
});

test("pageshow on the surface that already owns keeps it active without a new claim", () => {
  const { result } = renderHook(() => useBrowserSurfaceAuthority());
  const mySurfaceId = result.current.surfaceId;
  const ownerBefore = window.localStorage.getItem(BROWSER_SURFACE_OWNER_KEY);

  act(() => { window.dispatchEvent(new Event("pageshow")); });

  expect(result.current.isActive).toBe(true);
  expect(readBrowserSurfaceOwner().surfaceId).toBe(mySurfaceId);
  // No pointless rewrite of a record this surface already owns.
  expect(window.localStorage.getItem(BROWSER_SURFACE_OWNER_KEY)).toBe(ownerBefore);
});

test("a refreshed active tab comes back active on its own", () => {
  const before = renderHook(() => useBrowserSurfaceAuthority());
  const beforeId = before.result.current.surfaceId;
  expect(before.result.current.isActive).toBe(true);
  before.unmount();

  // A reload throws the whole document away, module state included.
  resetBrowserSurfaceAuthorityForTests();
  const after = renderHook(() => useBrowserSurfaceAuthority());

  expect(after.result.current.surfaceId).not.toBe(beforeId);
  expect(after.result.current.isActive).toBe(true);
  expect(readBrowserSurfaceOwner().surfaceId).toBe(after.result.current.surfaceId);
});

// A React cleanup/remount is NOT a new tab. The stale surface must come back
// exactly as stale as it was.
test("remounting a taken-over surface does not give it another automatic claim", () => {
  const first = renderHook(() => useBrowserSurfaceAuthority());
  const mySurfaceId = first.result.current.surfaceId;
  act(() => { deliverStorageEvent(otherSurfaceClaims("newer-tab")); });
  expect(first.result.current.isActive).toBe(false);
  first.unmount();

  const again = renderHook(() => useBrowserSurfaceAuthority());

  expect(again.result.current.surfaceId).toBe(mySurfaceId);
  expect(again.result.current.isActive).toBe(false);
  expect(hasConsumedFirstAttendanceClaim()).toBe(true);

  // And selecting it still changes nothing.
  act(() => { window.dispatchEvent(new Event("focus")); });
  act(() => { window.dispatchEvent(new Event("pageshow")); });
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });

  expect(again.result.current.isActive).toBe(false);
  expect(readBrowserSurfaceOwner().surfaceId).toBe("newer-tab");

  // Only the explicit action transfers it.
  act(() => { again.result.current.claim(); });
  expect(again.result.current.isActive).toBe(true);
  expect(readBrowserSurfaceOwner().surfaceId).toBe(mySurfaceId);
});

test("a StrictMode-style double mount neither forks the identity nor claims twice", () => {
  otherSurfaceClaims("already-open-tab");
  Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });

  // Mount, cleanup, mount again -- all before this surface is ever attended.
  const first = renderHook(() => useBrowserSurfaceAuthority());
  const mySurfaceId = first.result.current.surfaceId;
  first.unmount();
  const second = renderHook(() => useBrowserSurfaceAuthority());

  expect(second.result.current.surfaceId).toBe(mySurfaceId);
  expect(second.result.current.isActive).toBe(false);
  expect(readBrowserSurfaceOwner().surfaceId).toBe("already-open-tab");

  // The unspent opportunity survived the cycle and is spent exactly once.
  act(() => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  expect(second.result.current.isActive).toBe(true);
  expect(getBrowserSurfaceId()).toBe(mySurfaceId);

  act(() => { deliverStorageEvent(otherSurfaceClaims("third-tab")); });
  act(() => { window.dispatchEvent(new Event("focus")); });
  expect(second.result.current.isActive).toBe(false);
});

test("remounting the surface that still owns keeps it active", () => {
  const first = renderHook(() => useBrowserSurfaceAuthority());
  const mySurfaceId = first.result.current.surfaceId;
  const ownerBefore = window.localStorage.getItem(BROWSER_SURFACE_OWNER_KEY);
  first.unmount();

  const again = renderHook(() => useBrowserSurfaceAuthority());

  expect(again.result.current.surfaceId).toBe(mySurfaceId);
  expect(again.result.current.isActive).toBe(true);
  expect(window.localStorage.getItem(BROWSER_SURFACE_OWNER_KEY)).toBe(ownerBefore);
});

test("the explicit Use This Tab action is the way ownership comes back", () => {
  const { result } = renderHook(() => useBrowserSurfaceAuthority());
  const mySurfaceId = result.current.surfaceId;

  act(() => { deliverStorageEvent(otherSurfaceClaims("newer-tab")); });
  act(() => { window.dispatchEvent(new Event("focus")); });
  // Selecting the tab left it inactive...
  expect(result.current.isActive).toBe(false);

  act(() => { result.current.claim(); });

  // ...and the explicit action transferred it, with a fresh verified claim.
  expect(result.current.isActive).toBe(true);
  const owner = readBrowserSurfaceOwner();
  expect(owner.surfaceId).toBe(mySurfaceId);
  expect(owner.claimToken).toBeTruthy();
  expect(owner.claimToken).not.toBe("newer-token");
});

test.each([
  ["blur", () => window.dispatchEvent(new Event("blur"))],
  ["going hidden", () => {
    setVisibility("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
  }],
])("%s does not release ownership while no one else claims", (_label, leave) => {
  const { result } = renderHook(() => useBrowserSurfaceAuthority());
  const mySurfaceId = result.current.surfaceId;

  act(() => { leave(); });

  // No authority gap during OS app switching, file pickers, or backgrounding.
  expect(result.current.isActive).toBe(true);
  expect(readBrowserSurfaceOwner().surfaceId).toBe(mySurfaceId);
});

test("a storage event for an unrelated key is ignored", () => {
  const { result } = renderHook(() => useBrowserSurfaceAuthority());

  act(() => {
    const event = new Event("storage");
    event.key = "estipaid-estimates";
    window.dispatchEvent(event);
  });

  expect(result.current.isActive).toBe(true);
});

test("a browser that refuses local storage fails closed instead of allowing a second writer", () => {
  const failing = {
    getItem: () => { throw new Error("blocked"); },
    setItem: () => { throw new Error("blocked"); },
  };

  const { result } = renderHook(() => useBrowserSurfaceAuthority({ storage: failing }));

  expect(result.current.isActive).toBe(false);
  expect(result.current.ready).toBe(false);
  expect(result.current.code).toBe("browser_surface_storage_unavailable");
});

test("unmounting a document leaves the record behind harmlessly and starts no cleanup race", () => {
  const { result, unmount } = renderHook(() => useBrowserSurfaceAuthority());
  const mySurfaceId = result.current.surfaceId;

  unmount();

  // No unload cleanup is required for correctness: the stale record stays and
  // the next attended surface simply overwrites it.
  expect(readBrowserSurfaceOwner().surfaceId).toBe(mySurfaceId);

  resetBrowserSurfaceAuthorityForTests();
  const replacement = renderHook(() => useBrowserSurfaceAuthority());
  expect(replacement.result.current.isActive).toBe(true);
  expect(replacement.result.current.surfaceId).not.toBe(mySurfaceId);
});

// ---------------------------------------------------------------------------
// The verified claim token is the browser-ownership VERSION the vault binds its
// readiness to: stable while one claim stands, fresh on every takeover, and
// never presented by a surface that has been taken over.
// ---------------------------------------------------------------------------

test("the active surface exposes its exact current claim token", () => {
  const { result } = renderHook(() => useBrowserSurfaceAuthority());
  expect(result.current.isActive).toBe(true);
  expect(result.current.claimToken).toBeTruthy();
  expect(result.current.claimToken).toBe(readBrowserSurfaceOwner().claimToken);
});

test.each([
  ["focus", () => window.dispatchEvent(new Event("focus"))],
  ["pageshow", () => window.dispatchEvent(new Event("pageshow"))],
  ["visibilitychange", () => document.dispatchEvent(new Event("visibilitychange"))],
])("%s does not change the claim token of the current owner", (_label, attend) => {
  const { result } = renderHook(() => useBrowserSurfaceAuthority());
  const token = result.current.claimToken;
  act(() => { attend(); });
  act(() => { attend(); });
  expect(result.current.isActive).toBe(true);
  expect(result.current.claimToken).toBe(token);
});

test("an inactive surface never presents its old token; Use This Tab mints a fresh one", () => {
  const { result } = renderHook(() => useBrowserSurfaceAuthority());
  const t1 = result.current.claimToken;

  act(() => { deliverStorageEvent(otherSurfaceClaims("newer-tab")); });
  expect(result.current.isActive).toBe(false);
  expect(result.current.claimToken).toBe("");

  act(() => { result.current.claim(); });
  expect(result.current.isActive).toBe(true);
  expect(result.current.claimToken).toBeTruthy();
  expect(result.current.claimToken).not.toBe(t1);
  expect(result.current.claimToken).toBe(readBrowserSurfaceOwner().claimToken);
  // Owner-record schema unchanged.
  expect(Object.keys(readBrowserSurfaceOwner()).sort()).toEqual(["claimToken", "claimedAt", "surfaceId", "version"]);
});

test("a same-document remount keeps the same claim token", () => {
  const first = renderHook(() => useBrowserSurfaceAuthority());
  const token = first.result.current.claimToken;
  first.unmount();
  const second = renderHook(() => useBrowserSurfaceAuthority());
  expect(second.result.current.isActive).toBe(true);
  expect(second.result.current.claimToken).toBe(token);
});
