/* MCJ service worker — installability + Web Push
   Do NOT rewrite navigations to "/". Portal PWAs (companion / customer-service /
   admin) must keep their own start_url paths when launched from the home screen.
   Shared SW scope "/" keeps Web Push / #248 subscriptions intact. */
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

function recordPushDiagnostic(kind, detail) {
  return new Promise(function (resolve) {
    try {
      var request = indexedDB.open("mcj-push-diagnostics", 1);
      request.onupgradeneeded = function () {
        var db = request.result;
        if (!db.objectStoreNames.contains("events")) {
          db.createObjectStore("events", { keyPath: "id", autoIncrement: true });
        }
      };
      request.onerror = function () { resolve(); };
      request.onsuccess = function () {
        var db = request.result;
        var tx = db.transaction("events", "readwrite");
        tx.objectStore("events").add({
          kind: String(kind || "unknown"),
          at: new Date().toISOString(),
          detail: detail || {},
        });
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); resolve(); };
      };
    } catch (e) {
      resolve();
    }
  });
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
            notification_type: data.notification_type || data.event_type || "",
            entity_id: data.entity_id || data.order_id || "",
            event_type: data.event_type || data.notification_type || "",
            order_id: data.order_id || data.entity_id || "",
            target_user_id: data.target_user_id || "",
          },
          tag: data.tag || data.notification_type || "mcj-push",
          renotify: true,
        };
        return recordPushDiagnostic("push_received", {
          eventType: options.data.event_type,
          entityId: options.data.entity_id,
          targetUserId: options.data.target_user_id,
        })
          .then(function () {
            return self.registration.showNotification(title, options);
          })
          .then(function () {
            return recordPushDiagnostic("notification_shown", {
              eventType: options.data.event_type,
              entityId: options.data.entity_id,
            });
          })
          .catch(function (error) {
            return recordPushDiagnostic("notification_show_failed", {
              message: String(error && error.message ? error.message : error).slice(0, 180),
            }).then(function () {
              throw error;
            });
          });
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
    recordPushDiagnostic("notification_clicked", { url: target }).then(function () {
      return clients.matchAll({ type: "window", includeUncontrolled: true });
    }).then(function (list) {
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
  // A service worker has no authenticated portal session. Record the loss and
  // notify any open client; next authenticated app boot performs a fresh bind.
  event.waitUntil(
    recordPushDiagnostic("subscription_changed", {
      hadOldSubscription: !!event.oldSubscription,
      hasNewSubscription: !!event.newSubscription,
    }).then(function () {
      return clients.matchAll({ type: "window", includeUncontrolled: true });
    }).then(function (list) {
      return Promise.all(list.map(function (client) {
        client.postMessage({ type: "MCJ_PUSH_SUBSCRIPTION_CHANGED" });
      }));
    })
  );
});
