// StageType lightweight offline shell cache.
// Lets "Saved on this phone. Reopens from this link, even offline." keep working on flights and trains.
const CACHE = "stagetype-shell-v3";
const CORE_PRECACHE = [
  "/join",
  "/shared.js",
  "/ghost.svg",
  "/vendor/fonts.css",
  "/manifest.webmanifest",
];
// Precache primary Latin curated fonts (~244 KB total) so Atkinson Hyperlegible, Inter, Fraunces & Mono work offline.
const FONT_PRECACHE = [
  "/vendor/fonts/atkinson-hyperlegible-latin-400-normal.woff2",
  "/vendor/fonts/atkinson-hyperlegible-latin-700-normal.woff2",
  "/vendor/fonts/inter-latin-wght-normal.woff2",
  "/vendor/fonts/fraunces-latin-full-normal.woff2",
  "/vendor/fonts/jetbrains-mono-latin-wght-normal.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Core shell MUST succeed cleanly so a captive-portal blip never activates a half-cached SW.
    await Promise.all([
      ...CORE_PRECACHE.map(async (path) => {
        const res = await fetch(path, { cache: "no-cache" });
        if (!res.ok) throw new Error(`precache ${path} failed (${res.status})`);
        await cache.put(path, res);
      }),
      (async () => {
        const res = await fetch("/live/offline", { cache: "no-cache" });
        if (!res.ok) throw new Error(`precache reader shell failed (${res.status})`);
        await cache.put("/__reader_shell__", res);
      })(),
    ]);
    await Promise.allSettled(
      FONT_PRECACHE.map(async (path) => {
        const res = await fetch(path);
        if (res.ok) await cache.put(path, res);
      }),
    );
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept live streams, APIs, or demo rooms.
  if (url.pathname.startsWith("/api/")) return;

  const isReader = /^\/live\/[a-z0-9]+$/.test(url.pathname);
  const isVendor = url.pathname.startsWith("/vendor/");
  const isShellAsset = url.pathname === "/join" ||
    url.pathname === "/shared.js" || url.pathname === "/ghost.svg" || url.pathname === "/manifest.webmanifest" ||
    url.pathname === "/apple-touch-icon.png" || url.pathname === "/icon-192.png" || url.pathname === "/icon-512.png" ||
    isVendor;
  if (!isReader && !isShellAsset) return;

  // Vendored fonts/scripts are immutable: cache-first makes offline font switching instant.
  if (isVendor) {
    event.respondWith(
      caches.match(url.pathname).then((hit) =>
        hit || fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(url.pathname, copy)).catch(() => {});
          }
          return res;
        }).catch(() => Response.error())
      ),
    );
    return;
  }

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          const key = isReader ? "/__reader_shell__" : url.pathname;
          caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(isReader ? "/__reader_shell__" : url.pathname);
        if (cached) return cached;
        if (req.mode !== "navigate") return Response.error();
        return new Response("Offline. Open StageType once while online to cache saved talks.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }),
  );
});
