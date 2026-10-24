/*
 * BFO's service worker: what makes the site an installable app (Chrome's
 * "Install BFO"), and a calm page when the network is gone. Nothing the app
 * shows is cached here: pages and every /api call always come from the
 * network, so a signed-out or stale copy of family data can never be served.
 * Only the offline page and its icon are kept.
 */
const CACHE = "bfo-shell-v1";
const OFFLINE = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll([OFFLINE, "/icon-192.png"])).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only page loads are handled, and only when the network fails.
  if (req.mode !== "navigate") return;
  event.respondWith(fetch(req).catch(() => caches.match(OFFLINE)));
});
