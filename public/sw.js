/* eslint-disable no-restricted-globals */

// This worker is retained only for browsers where an older EstiPaid release
// already installed it. The current app does not register a worker globally.
const CACHE_VERSION = "fpe-v2-client-freshness";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const OWNED_LEGACY_CACHES = new Set(["fpe-v1-static", "fpe-v1-runtime"]);

// Files that MUST be available offline
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest"
];

async function fetchFresh(request) {
  return fetch(new Request(request, { cache: "no-store" }));
}

// Install: refresh the offline shell when the network is available. A failed
// optional cache fill must not prevent the safer worker from activating.
self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(STATIC_ASSETS.map(async (asset) => {
        try {
          const response = await fetchFresh(asset);
          if (response && response.ok) await cache.put(asset, response.clone());
        } catch {}
      }));
      self.skipWaiting();
    })()
  );
});

// Activate: clean up old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => OWNED_LEGACY_CACHES.has(key)).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

// Allow page to tell SW to activate immediately
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Fetch strategy
self.addEventListener("fetch", (event) => {
  const req = event.request;

  // Only handle GET requests
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Only same-origin requests
  if (url.origin !== self.location.origin) return;

  const isNavigation = req.mode === "navigate";

  event.respondWith((async () => {
    // Freshness metadata is network-only. A cache-busted request must never be
    // silently answered with an obsolete manifest.
    if (url.pathname === "/asset-manifest.json") {
      try {
        return await fetchFresh(req);
      } catch {
        return new Response("Offline", { status: 503 });
      }
    }

    // Navigation is network-first so an installed legacy worker cannot keep
    // serving an outdated application shell while the browser is online.
    if (isNavigation) {
      try {
        const fresh = await fetchFresh(req);
        if (fresh && fresh.ok) {
          const cache = await caches.open(RUNTIME_CACHE);
          await cache.put("/", fresh.clone());
        }
        return fresh;
      } catch {
        return (await caches.match("/")) || new Response("Offline", { status: 503 });
      }
    }

    // Hashed assets are immutable and safe to reuse. Other same-origin assets
    // prefer the network and fall back to their last cached response offline.
    const isHashedAsset = /\/static\/(?:js|css)\/[^/]+\.[a-f0-9]{8,}\.(?:js|css)$/i.test(url.pathname);
    if (isHashedAsset) {
      const cached = await caches.match(req);
      if (cached) return cached;
    }

    try {
      const fresh = await fetchFresh(req);
      if (fresh && fresh.ok) {
        const cache = await caches.open(RUNTIME_CACHE);
        await cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      return (await caches.match(req)) || new Response("Offline", { status: 503 });
    }
  })());
});
