/* Offline-first kiosk cache */
const CACHE = "phonepe-kiosk-v66";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./design.js",
  "./questions.json",
  "./manifest.json",
  "./assets/bg.png",
  "./assets/logo.png",
  "./assets/fonts/PhonePeSans-Light.otf",
  "./assets/fonts/PhonePeSans-Regular.otf",
  "./assets/fonts/PhonePeSans-Medium.otf",
  "./assets/fonts/PhonePeSans-Bold.otf",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(ASSETS);
      self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(req, { ignoreSearch: true });
      if (cached) return cached;
      try {
        const fresh = await fetch(req);
        if (fresh && fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      } catch {
        // fallback to app shell if navigation
        if (req.mode === "navigate") return (await cache.match("./index.html")) || new Response("Offline");
        return new Response("Offline", { status: 503 });
      }
    })(),
  );
});

