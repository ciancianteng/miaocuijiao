/* MCJ service worker — installability + Web Push */
self.addEventListener("install", function () {
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
  if (url.pathname.indexOf("/api/") === 0) return;
  event.respondWith(
    fetch(req).catch(function () {
      return fetch(req);
    })
  );
});

function safeParse(data) {
  if (!data) return {};
  if (typeof data === "object") return data;
  try {
    return JSON.parse(String(data));
  } catch (e) {
    return { title: "妙脆角", body: String(data) };
  }
}

self.addEventListener("push", function (event) {
  var payload = {};
  try {
    if (event.data) {
      payload = safeParse(event.data.json ? event.data.json() : event.data.text());
    }
  } catch (e) {
    try {
      payload = safeParse(event.data && event.data.text ? event.data.text() : "");
    } catch (e2) {
      payload = {};
    }
  }
  // event.data.json() returns a Promise in some browsers — normalize.
  event.waitUntil(
    Promise.resolve(payload)
      .catch(function () {
        return {};
      })
      .then(function (data) {
        data = data || {};
        var title = data.title || "妙脆角";
        var options = {
          body: data.body || "",
          icon: data.icon || "/icons/icon-192.png",
          badge: data.badge || "/icons/icon-192.png",
          data: {
            url: data.url || "/",
            notification_type: data.notification_type || "",
            entity_id: data.entity_id || "",
          },
          tag: data.tag || data.notification_type || "mcj-push",
          renotify: true,
        };
        return self.registration.showNotification(title, options);
      })
  );
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var data = (event.notification && event.notification.data) || {};
  var target = "/";
  try {
    target = new URL(data.url || "/", self.location.origin).href;
  } catch (e) {
    target = self.location.origin + "/";
  }

  event.waitUntil(
    clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        try {
          if (client.url && client.url.indexOf(self.location.origin) === 0 && "focus" in client) {
            if ("navigate" in client) {
              return client.navigate(target).then(function (c) {
                return c && c.focus ? c.focus() : client.focus();
              });
            }
            return client.focus();
          }
        } catch (e) {}
      }
      if (clients.openWindow) return clients.openWindow(target);
      return undefined;
    })
  );
});

self.addEventListener("pushsubscriptionchange", function (event) {
  // Best-effort: cannot re-auth here. Client settings page will rebind on next open.
  event.waitUntil(Promise.resolve());
});
