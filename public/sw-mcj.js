/* mcj-sw 20261008badge1
   MCJ service worker — installability + Web Push
   Do NOT rewrite navigations to "/". Portal PWAs (companion / customer-service /
   admin) must keep their own start_url paths when launched from the home screen.
   Shared SW scope "/" keeps Web Push / #248 subscriptions intact.
   No "fetch" listener on purpose: a pass-through handler forces the worker to
   boot and proxy every page/asset request, slowing each page switch on iOS/Android.
   Chrome 108+ (mobile) / 112+ (desktop) no longer require one for installability. */
self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(Promise.all([
    self.clients.claim(),
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (key) { return caches.delete(key); }));
    }).catch(function () {})
  ]));
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

function readPushData(event) {
  if (!event || !event.data) return Promise.resolve({});
  var data = event.data;
  var job;
  try {
    job = typeof data.json === "function" ? data.json() : null;
  } catch (e) {
    job = null;
  }
  return Promise.resolve(job)
    .then(function (parsed) {
      if (parsed && typeof parsed === "object") return parsed;
      throw new Error("empty");
    })
    .catch(function () {
      try {
        return safeParse(typeof data.text === "function" ? data.text() : "");
      } catch (e2) {
        return {};
      }
    });
}

self.addEventListener("push", function (event) {
  event.waitUntil(
    readPushData(event)
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
        return self.registration.showNotification(title, options);
      })
      .catch(function () {
        return self.registration.showNotification("妙脆角", { body: "你有一条新通知", tag: "mcj-push-fallback" });
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
      var same = [];
      for (var i = 0; i < list.length; i++) {
        var client = list[i];
        if (client.url && client.url.indexOf(self.location.origin) === 0) same.push(client);
      }
      var chain = Promise.resolve();
      for (var j = 0; j < same.length; j++) {
        (function (client) {
          chain = chain.then(function (opened) {
            if (opened) return opened;
            if (!("navigate" in client)) return null;
            return client.navigate(target).then(function (next) {
              var page = next || client;
              if (page && page.focus) return page.focus();
              return page || client;
            }).catch(function () { return null; });
          });
        })(same[j]);
      }
      return chain.then(function (opened) {
        if (opened) return opened;
        if (clients.openWindow) return clients.openWindow(target);
        if (same[0] && same[0].focus) return same[0].focus();
        return undefined;
      });
    })
  );
});

self.addEventListener("pushsubscriptionchange", function (event) {
  // Android Chrome rotates the endpoint without a page reload. Ask any open
  // client to save the new subscription. A closed tab rebinds on next visit.
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      list.forEach(function (client) {
        try {
          client.postMessage({ type: "mcj-push-resubscribe" });
        } catch (e) {}
      });
    })
  );
});
