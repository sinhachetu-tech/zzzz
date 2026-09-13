// HFMC service worker.
// Strategy:
//   - /api/*         → network-first (always fresh when online; no offline fallback —
//                      stale loan data is worse than no data, so we let it fail cleanly)
//   - /_next/static/*  → cache-first (immutable hashed assets)
//   - icons/manifest → cache-first
//   - navigation (HTML) → network-first, fall back to cached "/" shell so the app
//                      loads instantly on a flaky connection (the PWA payoff)
const VERSION = "hfmc-v1";
const APP_SHELL = ["/", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/favicon-32.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(VERSION).then((c) => c.addAll(APP_SHELL).catch(() => {})).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Never cache API responses — they must always be live.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(req));
    return;
  }

  // Immutable build assets.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Icons + manifest — cache-first.
  if (/\.(png|ico|svg|webmanifest)$/.test(url.pathname) || url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }))
    );
    return;
  }

  // Navigations (HTML pages) — network-first, fall back to cached shell.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((cached) => cached || caches.match("/")))
    );
    return;
  }
});
