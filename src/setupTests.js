// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { TextEncoder, TextDecoder } from 'util';

if (typeof global.TextEncoder === "undefined") {
  global.TextEncoder = TextEncoder;
}

if (typeof global.TextDecoder === "undefined") {
  global.TextDecoder = TextDecoder;
}

if (typeof window !== "undefined") {
  Object.defineProperty(window, "scrollTo", {
    value: jest.fn(),
    writable: true,
    configurable: true,
  });
}

// jsdom does not implement the Web Locks API, but EstiPaid's workspace tab lease
// depends on it to guarantee one operational tab per browser profile. Without a
// LockManager the production code correctly FAILS CLOSED, which would make every
// app-level test render the "already open in another tab" gate.
//
// This is a minimal, faithful LockManager for the test environment only: it is
// exclusive, honours `ifAvailable`, and releases when the callback's returned
// promise settles. It does not relax any production rule -- it supplies the
// browser primitive the production rule expects.
if (typeof navigator !== "undefined" && !navigator.locks) {
  const heldLocks = new Map();

  const request = async (name, options, callback) => {
    const handler = typeof options === "function" ? options : callback;
    const settings = typeof options === "function" ? {} : (options || {});

    if (settings.ifAvailable && heldLocks.has(name)) {
      return handler(null);
    }
    while (heldLocks.has(name)) {
      // eslint-disable-next-line no-await-in-loop
      await heldLocks.get(name);
    }

    let releaseHeld;
    const held = new Promise((resolve) => { releaseHeld = resolve; });
    heldLocks.set(name, held);

    const result = await handler({ name, mode: settings.mode || "exclusive" });
    Promise.resolve(result).then(
      () => { heldLocks.delete(name); releaseHeld(); },
      () => { heldLocks.delete(name); releaseHeld(); }
    );
    return result;
  };

  Object.defineProperty(navigator, "locks", {
    value: { request },
    writable: true,
    configurable: true,
  });
}

// Each test case stands in for a fresh browser DOCUMENT.
//
// Browser-surface authority is deliberately document-lifetime in production: a
// React cleanup/remount must never mint a new surface id or rearm a surface's
// one automatic first-attendance claim, or a stale tab could take EstiPaid back
// just by re-rendering. That means module state no longer resets when a hook
// unmounts, so a suite that renders the app several times would otherwise have
// every case after the first inherit the previous case's spent claim and sit
// behind the inactive-tab gate. Resetting here gives each test its own document.
afterEach(() => {
  try {
    // eslint-disable-next-line global-require
    require("./lib/browserSurfaceAuthority").resetBrowserSurfaceAuthorityForTests();
  } catch {
    /* suites that mock the module away have nothing to reset */
  }
});
