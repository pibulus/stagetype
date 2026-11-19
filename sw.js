// StageType lightweight offline shell cache.
// Lets "Saved on this phone. Reopens from this link." keep working on flights and trains.
const CACHE = "stagetype-shell-v1";
const PRECACHE = [
  "/join",
  "/shared.js",
  "/ghost.svg",
  "/vendor/fonts.css",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Never intercept live streams, APIs, or demo rooms.
  if (url.pathname.startsWith("/api/")) return;

  const isReader = /^\/live\/[a-z0-9]+$/.test(url.pathname);
  const isShellAsset = url.pathname === "/join" || url.pathname === "/live" || url.pathname === "/live/" ||
    url.pathname === "/shared.js" || url.pathname === "/ghost.svg" || url.pathname.startsWith("/vendor/");
  if (!isReader && !isShellAsset) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          const key = isReader ? "/__reader_shell__" : req;
          caches.open(CACHE).then((c) => c.put(key, copy)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(isReader ? "/__reader_shell__" : req);
        return cached || new Response("Offline. Open StageType once while online to cache saved talks.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }),
  );
});
