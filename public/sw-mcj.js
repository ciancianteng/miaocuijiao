/* MCJ minimal service worker — network-first passthrough for installability.
   Do NOT aggressively cache HTML/API (avoids stale login/session pages).
   Do NOT rewrite navigations to "/". Portal PWAs (companion / customer-service /
   admin) must keep their own start_url paths when launched from the home screen. */
self.addEventListener("install", function (event) {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (!req || req.method !== "GET") return;
  var url;
  try {
    url = new URL(req.url);
  } catch (e) {
    return;
  }
  if (url.origin !== self.location.origin) return;
  // Never intercept API or auth-sensitive paths with a cache strategy.
  if (url.pathname.indexOf("/api/") === 0) return;
  event.respondWith(
    fetch(req)
      .then(function (res) {
        return res;
      })
      .catch(function () {
        return fetch(req);
      })
  );
});
