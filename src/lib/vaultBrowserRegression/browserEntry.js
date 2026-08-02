// ISO-15I -- TEST-ONLY browser entry for the vault regression harness.
//
// This file is an entry ONLY for scripts/vault-browser-regression/build-harness.js,
// which emits a generated asset outside the repository's Production build paths.
// It is never imported by App.js, index.js, a screen, a hook, a listener, a
// service worker, a cloud worker, or src/index.js, so it can never appear in the
// Production bundle entry graph.

import { createBrowserHarness } from "./browserHarness";

const harness = createBrowserHarness();
window.__vaultBrowserRegressionHarness = harness;
window.__vaultBrowserRegressionReady = true;
