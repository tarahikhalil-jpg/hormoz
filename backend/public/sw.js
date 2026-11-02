const CACHE_NAME = "hormoz-single-entry-v2";
self.addEventListener("install", event => self.skipWaiting());
self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
// Keep application and private API responses network-only; never cache stale screens.
self.addEventListener("fetch", event => {
  if (event.request.method === "GET") event.respondWith(fetch(event.request));
});
