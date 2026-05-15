// __BUILD_TS__ wird beim Build durch den Unix-Timestamp ersetzt (vite.config.js Plugin).
// Jeder Deploy bekommt eine neue Cache-Version → alte Caches sicher gelöscht.
const CACHE_NAME = "zeittracker-__BUILD_TS__";
const PRECACHE = ["/manifest.json"];

self.addEventListener("install", event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE).catch(() => {}))
  );
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Explizites SKIP_WAITING aus registerSW.js (belt-and-suspenders für wartende SWs)
self.addEventListener("message", event => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);

  // Network-first für HTML → neue index.html referenziert neue gehashte Assets
  if (url.pathname === "/" || url.pathname.endsWith(".html")) {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // manifest.json + sw.js nie aus Cache → immer frisch vom Server
  if (url.pathname === "/manifest.json" || url.pathname === "/sw.js") {
    event.respondWith(
      fetch(event.request, { cache: "no-store" })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first für Vite-Assets (content-hashed Filenames → ewig cachebar)
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then(c => c.put(event.request, clone).catch(() => {}));
        return res;
      }).catch(() => caches.match(event.request));
    })
  );
});
