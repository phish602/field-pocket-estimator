// @ts-nocheck
/* eslint-disable */

// React binding for the one browser-surface authority. It owns WHEN a surface
// claims -- and, just as importantly, when it must not.
//
// A document claims automatically exactly ONCE, at its first real attendance:
// visible startup, or the first focus/visibility/BFCache signal for a tab that
// opened in the background. Every attention signal after that only REREADS the
// shared record and publishes the truth.
//
// That distinction is the whole fix. Previously each focus and visibility event
// claimed, so two tabs in one window traded ownership on every click: whichever
// tab you selected reclaimed instantly, the inactive gate never stayed on screen,
// and both tabs looked live. Now a surface that has already participated stays
// inactive when you merely look at it, and ownership returns only through the
// explicit "Use This Tab" action -- or a genuinely new document, such as a
// refresh.
//
// A `storage` event announcing another owner makes this surface inactive and
// NEVER triggers a counter-claim.
//
// Blur and hidden do not release ownership either: OS app switching, a file
// picker, or a backgrounded mobile document would otherwise open an authority
// gap in which nothing owns EstiPaid. Nor is unload cleanup required -- a stale
// record from a closed tab is harmless, because the next attended surface simply
// overwrites it with a fresh verified claim.

import { useCallback, useEffect, useState } from "react";
import {
  BROWSER_SURFACE_INACTIVE_CODE,
  BROWSER_SURFACE_OWNER_KEY,
  claimBrowserSurface,
  claimFirstAttendance,
  getBrowserSurfaceClaimToken,
  getBrowserSurfaceId,
  isBrowserSurfaceActive,
  startBrowserSurfaceAuthority,
} from "./browserSurfaceAuthority";

// `claimToken` is the verified token of this surface's CURRENT ownership and is
// "" whenever this surface is not the owner. It is the browser-ownership version
// the vault binds its operational readiness to: unchanged by focus, visibility,
// pageshow, or a remount; fresh on every successful takeover.
const UNRESOLVED = Object.freeze({ ready: false, isActive: false, code: "", surfaceId: "", claimToken: "" });

function documentIsVisible() {
  try {
    if (typeof document === "undefined") return false;
    // An unknown visibility state is treated as visible: a browser that does not
    // report visibility must still be usable.
    return document.visibilityState !== "hidden";
  } catch {
    return false;
  }
}

export default function useBrowserSurfaceAuthority({ storage = undefined } = {}) {
  const [state, setState] = useState(UNRESOLVED);

  // The EXPLICIT transfer: "Use This Tab". It always attempts a fresh verified
  // claim, whatever this document has done before.
  const claim = useCallback(() => {
    const result = claimBrowserSurface();
    const next = result.active
      ? { ready: true, isActive: true, code: "", surfaceId: getBrowserSurfaceId(), claimToken: result.claimToken }
      : {
        // A storage failure is not a resolved authority: it fails closed and the
        // gate says so, rather than silently allowing a second live writer.
        ready: result.code === BROWSER_SURFACE_INACTIVE_CODE,
        isActive: false,
        code: result.code,
        surfaceId: getBrowserSurfaceId(),
        claimToken: "",
      };
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    const install = startBrowserSurfaceAuthority(storage === undefined ? {} : { storage });
    if (!install.ok) {
      setState({ ready: false, isActive: false, code: "browser_surface_storage_unavailable", surfaceId: "", claimToken: "" });
      return undefined;
    }

    // Publishes what the shared record actually says. This never writes, so it
    // can never take ownership from a valid owner.
    // The token is reread with the record, so an unchanged claim republishes
    // the SAME token -- attention never looks like a new ownership.
    const publishCurrentOwner = () => {
      const claimToken = getBrowserSurfaceClaimToken();
      const active = isBrowserSurfaceActive() && Boolean(claimToken);
      setState((previous) => {
        const next = {
          ready: true,
          isActive: active,
          code: active ? "" : BROWSER_SURFACE_INACTIVE_CODE,
          surfaceId: getBrowserSurfaceId(),
          claimToken: active ? claimToken : "",
        };
        return previous.ready === next.ready
          && previous.isActive === next.isActive
          && previous.code === next.code
          && previous.surfaceId === next.surfaceId
          && previous.claimToken === next.claimToken
          ? previous
          : next;
      });
    };

    // The user is looking at this tab. On this document's FIRST attendance that
    // takes ownership; every time after, it is only a refresh of the truth --
    // selecting a tab is not consent to move the whole app to it.
    const attend = () => {
      if (!documentIsVisible()) return;
      const first = claimFirstAttendance();
      if (!first.attempted) {
        publishCurrentOwner();
        return;
      }
      setState(first.active
        ? { ready: true, isActive: true, code: "", surfaceId: getBrowserSurfaceId(), claimToken: first.claimToken }
        : {
          ready: first.code === BROWSER_SURFACE_INACTIVE_CODE,
          isActive: false,
          code: first.code,
          surfaceId: getBrowserSurfaceId(),
          claimToken: "",
        });
    };

    // Another surface claimed. Reread the shared record and publish the result;
    // never claim back from here, and never restore the spent first-attendance
    // opportunity.
    const onStorage = (event) => {
      const key = event?.key;
      if (key && key !== BROWSER_SURFACE_OWNER_KEY) return;
      publishCurrentOwner();
    };

    const onVisibilityChange = () => {
      // Becoming hidden is not a release and not a signal.
      if (!documentIsVisible()) return;
      attend();
    };

    if (documentIsVisible()) {
      attend();
    } else {
      // A background tab keeps its unspent opportunity for the moment the person
      // actually selects it.
      setState({
        ready: true,
        isActive: false,
        code: BROWSER_SURFACE_INACTIVE_CODE,
        surfaceId: getBrowserSurfaceId(),
        claimToken: "",
      });
    }

    try {
      window.addEventListener("focus", attend);
      window.addEventListener("pageshow", attend);
      window.addEventListener("storage", onStorage);
      document.addEventListener("visibilitychange", onVisibilityChange);
    } catch {}

    return () => {
      try {
        window.removeEventListener("focus", attend);
        window.removeEventListener("pageshow", attend);
        window.removeEventListener("storage", onStorage);
        document.removeEventListener("visibilitychange", onVisibilityChange);
      } catch {}
      // Listeners only. The document's surface identity and its spent automatic
      // claim outlive this subscription on purpose: a remount is not a new tab,
      // and must never hand a stale surface another silent claim. Whatever this
      // document already wrote to the shared record stays there, harmlessly,
      // until some surface makes a newer claim.
    };
  }, [claim, storage]);

  return {
    ready: state.ready,
    isActive: state.isActive,
    code: state.code,
    surfaceId: state.surfaceId,
    claimToken: state.claimToken,
    claim,
  };
}
