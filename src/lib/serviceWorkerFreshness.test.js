import fs from "fs";
import path from "path";
import {
  CLIENT_FRESHNESS_EVENT,
  CLIENT_FRESHNESS_NOTICE_ID,
  CLIENT_FRESHNESS_RELOAD_KEY,
  checkClientFreshness,
  createClientFreshnessController,
  hasPendingCloudWork,
  updateExistingEstiPaidServiceWorkers,
} from "./serviceWorkerFreshness";

jest.mock("./cloudMutationLedger", () => ({
  getCloudMutationLedgerSummary: jest.fn(() => ({ hasUnacknowledged: false })),
  readCloudMutationLedger: jest.fn(() => ({ entries: [] })),
}));

const ORIGIN = "https://www.estipaid.com";
const CURRENT_ASSET = "/static/js/main.11111111.js";
const NEW_ASSET = "/static/js/main.22222222.js";

function installRunningAsset(asset = CURRENT_ASSET) {
  document.head.innerHTML = `<script src="${asset}"></script>`;
}

function manifestResponse(asset = CURRENT_ASSET) {
  return {
    ok: true,
    status: 200,
    json: jest.fn(async () => ({
      files: { "main.js": asset },
      entrypoints: [asset.replace(/^\//, "")],
    })),
  };
}

function controllerOptions(overrides = {}) {
  const fetchImpl = overrides.fetchImpl || jest.fn(async () => manifestResponse(NEW_ASSET));
  return {
    windowRef: window,
    documentRef: document,
    navigatorRef: { onLine: true },
    locationRef: { origin: ORIGIN, href: `${ORIGIN}/estimates` },
    fetchImpl,
    serviceWorkerContainer: overrides.serviceWorkerContainer || { getRegistrations: jest.fn(async () => []) },
    sessionStorageRef: sessionStorage,
    pendingWorkCheck: overrides.pendingWorkCheck || (() => false),
    reload: overrides.reload || jest.fn(),
    now: overrides.now || (() => 1700000000000),
    ...overrides,
  };
}

beforeEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  sessionStorage.removeItem(CLIENT_FRESHNESS_RELOAD_KEY);
  jest.restoreAllMocks();
});

test("recognizes the current hashed application bundle using no-store manifest metadata", async () => {
  installRunningAsset(CURRENT_ASSET);
  const fetchImpl = jest.fn(async () => manifestResponse(CURRENT_ASSET));

  const result = await checkClientFreshness({
    fetchImpl,
    documentRef: document,
    locationRef: { origin: ORIGIN, href: `${ORIGIN}/` },
    navigatorRef: { onLine: true },
    now: () => 42,
  });

  expect(result).toEqual({
    status: "current",
    runningAsset: CURRENT_ASSET,
    deployedAsset: CURRENT_ASSET,
  });
  expect(fetchImpl).toHaveBeenCalledWith(
    `${ORIGIN}/asset-manifest.json?estipaid_freshness=42`,
    expect.objectContaining({
      cache: "no-store",
      credentials: "same-origin",
      headers: expect.objectContaining({ "Cache-Control": "no-cache, no-store, max-age=0" }),
    })
  );
});

test("detects when the running main bundle differs from the deployed bundle", async () => {
  installRunningAsset(CURRENT_ASSET);
  const result = await checkClientFreshness({
    fetchImpl: jest.fn(async () => manifestResponse(NEW_ASSET)),
    documentRef: document,
    locationRef: { origin: ORIGIN, href: `${ORIGIN}/` },
    navigatorRef: { onLine: true },
  });

  expect(result).toEqual({
    status: "outdated",
    runningAsset: CURRENT_ASSET,
    deployedAsset: NEW_ASSET,
  });
});

test("network failure leaves the running client intact", async () => {
  installRunningAsset();
  const result = await checkClientFreshness({
    fetchImpl: jest.fn(async () => { throw new Error("network down"); }),
    documentRef: document,
    locationRef: { origin: ORIGIN, href: `${ORIGIN}/` },
    navigatorRef: { onLine: true },
  });

  expect(result).toEqual(expect.objectContaining({
    status: "unavailable",
    reason: "manifest_network_failed",
  }));
});

test("offline clients keep working without attempting a freshness request", async () => {
  installRunningAsset();
  const fetchImpl = jest.fn();
  const result = await checkClientFreshness({
    fetchImpl,
    documentRef: document,
    locationRef: { origin: ORIGIN, href: `${ORIGIN}/` },
    navigatorRef: { onLine: false },
  });

  expect(result).toEqual({ status: "offline" });
  expect(fetchImpl).not.toHaveBeenCalled();
});

test("updates only an existing EstiPaid legacy worker and never registers one", async () => {
  const legacyUpdate = jest.fn(async () => undefined);
  const unrelatedUpdate = jest.fn(async () => undefined);
  const serviceWorkerContainer = {
    register: jest.fn(),
    getRegistrations: jest.fn(async () => [
      { active: { scriptURL: `${ORIGIN}/sw.js` }, update: legacyUpdate },
      { active: { scriptURL: `${ORIGIN}/other-worker.js` }, update: unrelatedUpdate },
    ]),
  };

  const result = await updateExistingEstiPaidServiceWorkers({
    serviceWorkerContainer,
    locationRef: { origin: ORIGIN, href: `${ORIGIN}/` },
  });

  expect(result).toEqual({ status: "checked", checked: 1, updated: 1 });
  expect(legacyUpdate).toHaveBeenCalledTimes(1);
  expect(unrelatedUpdate).not.toHaveBeenCalled();
  expect(serviceWorkerContainer.register).not.toHaveBeenCalled();
});

test("outdated detection shows one update path without automatically reloading", async () => {
  installRunningAsset();
  const reload = jest.fn();
  const listener = jest.fn();
  window.addEventListener(CLIENT_FRESHNESS_EVENT, listener);
  const controller = createClientFreshnessController(controllerOptions({ reload }));

  await controller.start();
  await controller.checkNow();

  expect(document.querySelectorAll(`#${CLIENT_FRESHNESS_NOTICE_ID}`)).toHaveLength(1);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(reload).not.toHaveBeenCalled();
  controller.stop();
  window.removeEventListener(CLIENT_FRESHNESS_EVENT, listener);
});

test("pending cloud work blocks reload and leaves its durable state untouched", async () => {
  installRunningAsset();
  const reload = jest.fn();
  const pendingWorkCheck = jest.fn(() => true);
  const controller = createClientFreshnessController(controllerOptions({ pendingWorkCheck, reload }));
  await controller.start();

  const result = controller.attemptReload();

  expect(result).toEqual(expect.objectContaining({
    status: "blocked",
    blockers: expect.arrayContaining(["pending_cloud_work"]),
    reloaded: false,
  }));
  expect(reload).not.toHaveBeenCalled();
  expect(sessionStorage.getItem(CLIENT_FRESHNESS_RELOAD_KEY)).toBeNull();
  controller.stop();
});

test("the default reload guard recognizes the persisted compatibility queue without rewriting it", () => {
  const key = "estipaid-cloud-backup-queue-v1";
  const serialized = JSON.stringify({ pending: true, status: "pending", syncingRevision: null });
  localStorage.setItem(key, serialized);

  expect(hasPendingCloudWork()).toBe(true);
  expect(localStorage.getItem(key)).toBe(serialized);

  localStorage.removeItem(key);
});

test("an in-flight cloud operation blocks reload until the operation is no longer running", async () => {
  installRunningAsset();
  const reload = jest.fn();
  const controller = createClientFreshnessController(controllerOptions({ reload }));
  await controller.start();
  window.dispatchEvent(new CustomEvent("estipaid:cloud-auto-backup-running", {
    detail: { running: true },
  }));

  expect(controller.attemptReload()).toEqual(expect.objectContaining({
    status: "blocked",
    blockers: expect.arrayContaining(["cloud_sync_running"]),
  }));
  expect(reload).not.toHaveBeenCalled();

  window.dispatchEvent(new CustomEvent("estipaid:cloud-auto-backup-running", {
    detail: { running: false },
  }));
  expect(controller.attemptReload()).toEqual({ status: "reloading", reloaded: true });
  expect(reload).toHaveBeenCalledTimes(1);
  controller.stop();
});

test("unsaved-work beforeunload protection blocks reload", async () => {
  installRunningAsset();
  const reload = jest.fn();
  const protect = (event) => event.preventDefault();
  window.addEventListener("beforeunload", protect);
  const controller = createClientFreshnessController(controllerOptions({ reload }));
  await controller.start();

  const result = controller.attemptReload();

  expect(result).toEqual(expect.objectContaining({
    status: "blocked",
    blockers: expect.arrayContaining(["unsaved_changes"]),
  }));
  expect(reload).not.toHaveBeenCalled();
  controller.stop();
  window.removeEventListener("beforeunload", protect);
});

test("a safe user-requested reload is marked once to prevent a reload loop", async () => {
  installRunningAsset();
  const reload = jest.fn();
  const now = jest.fn(() => 1700000000000);
  const controller = createClientFreshnessController(controllerOptions({ reload, now }));
  await controller.start();

  expect(controller.attemptReload()).toEqual({ status: "reloading", reloaded: true });
  expect(reload).toHaveBeenCalledTimes(1);
  expect(JSON.parse(sessionStorage.getItem(CLIENT_FRESHNESS_RELOAD_KEY))).toEqual({
    targetAsset: NEW_ASSET,
    at: 1700000000000,
  });

  expect(controller.attemptReload()).toEqual({ status: "loop_protected", reloaded: false });
  expect(reload).toHaveBeenCalledTimes(1);
  controller.stop();
});

test("freshness handling never clears browser storage or deletes protected databases", async () => {
  installRunningAsset();
  const localClear = jest.spyOn(Storage.prototype, "clear");
  const indexedDelete = jest.fn();
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: { deleteDatabase: indexedDelete },
  });
  const controller = createClientFreshnessController(controllerOptions());
  await controller.start();
  controller.attemptReload();

  expect(localClear).not.toHaveBeenCalled();
  expect(indexedDelete).not.toHaveBeenCalled();
  controller.stop();
});

function createWorkerHarness({ fetchImpl = jest.fn(), cachedResponse = null, keys = [] } = {}) {
  const listeners = {};
  const cache = { put: jest.fn(async () => undefined) };
  const cachesRef = {
    open: jest.fn(async () => cache),
    match: jest.fn(async () => cachedResponse),
    keys: jest.fn(async () => keys),
    delete: jest.fn(async () => true),
  };
  const selfRef = {
    location: { origin: ORIGIN },
    clients: { claim: jest.fn(async () => undefined) },
    skipWaiting: jest.fn(async () => undefined),
    addEventListener: jest.fn((type, listener) => { listeners[type] = listener; }),
  };

  class FakeRequest {
    constructor(input, options = {}) {
      this.url = typeof input === "string" ? new URL(input, ORIGIN).toString() : input.url;
      this.method = typeof input === "string" ? "GET" : input.method;
      this.mode = typeof input === "string" ? "same-origin" : input.mode;
      this.cache = options.cache;
    }
  }

  class FakeResponse {
    constructor(body, options = {}) {
      this.body = body;
      this.status = options.status || 200;
      this.ok = this.status >= 200 && this.status < 300;
    }

    clone() {
      return new FakeResponse(this.body, { status: this.status });
    }
  }

  const source = fs.readFileSync(path.join(process.cwd(), "public", "sw.js"), "utf8");
  // The public worker is a standalone browser script, so execute it inside the
  // fully mocked worker globals above rather than importing it as an ES module.
  // eslint-disable-next-line no-new-func
  const loadWorker = new Function("self", "caches", "fetch", "Request", "Response", "URL", source);
  loadWorker(selfRef, cachesRef, fetchImpl, FakeRequest, FakeResponse, URL);

  const dispatchFetch = async ({ url = `${ORIGIN}/`, mode = "navigate" } = {}) => {
    let responsePromise;
    listeners.fetch({
      request: { url, method: "GET", mode },
      respondWith(value) { responsePromise = value; },
    });
    return responsePromise;
  };

  return { listeners, cache, cachesRef, selfRef, FakeResponse, dispatchFetch };
}

test("legacy worker navigation is network-first and retains an offline shell fallback", async () => {
  const fresh = { ok: true, status: 200, clone: jest.fn(() => ({ fresh: true })) };
  const cached = { cached: true };
  const fetchImpl = jest.fn(async () => fresh);
  const online = createWorkerHarness({ fetchImpl, cachedResponse: cached });

  await expect(online.dispatchFetch()).resolves.toBe(fresh);
  expect(fetchImpl.mock.calls[0][0]).toEqual(expect.objectContaining({ cache: "no-store" }));
  expect(online.cachesRef.match).not.toHaveBeenCalled();

  const offline = createWorkerHarness({
    fetchImpl: jest.fn(async () => { throw new Error("offline"); }),
    cachedResponse: cached,
  });
  await expect(offline.dispatchFetch()).resolves.toBe(cached);
  expect(offline.cachesRef.match).toHaveBeenCalledWith("/");
});

test("legacy worker never serves cached freshness metadata", async () => {
  const fresh = { ok: true, status: 200, clone: jest.fn() };
  const fetchImpl = jest.fn(async () => fresh);
  const harness = createWorkerHarness({ fetchImpl, cachedResponse: { stale: true } });

  await expect(harness.dispatchFetch({
    url: `${ORIGIN}/asset-manifest.json?estipaid_freshness=42`,
    mode: "same-origin",
  })).resolves.toBe(fresh);
  expect(fetchImpl.mock.calls[0][0]).toEqual(expect.objectContaining({ cache: "no-store" }));
  expect(harness.cachesRef.match).not.toHaveBeenCalled();
});

test("legacy worker activation deletes only its named legacy shell caches", async () => {
  const harness = createWorkerHarness({
    keys: ["fpe-v1-static", "fpe-v1-runtime", "unrelated-origin-cache", "protected-offline-data"],
  });
  let activation;
  harness.listeners.activate({ waitUntil(value) { activation = value; } });
  await activation;

  expect(harness.cachesRef.delete.mock.calls.map(([key]) => key)).toEqual([
    "fpe-v1-static",
    "fpe-v1-runtime",
  ]);
  expect(harness.cachesRef.delete).not.toHaveBeenCalledWith("unrelated-origin-cache");
  expect(harness.cachesRef.delete).not.toHaveBeenCalledWith("protected-offline-data");
});
