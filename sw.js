self.addEventListener("push", function (event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (error) { data = {}; }
  event.waitUntil(self.registration.showNotification(data.title || "MEOW CUI JIAO", {
    body: data.body || "你有一条新通知，打开后查看。",
    data: { href: data.href || "/" }
  }));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var href = (event.notification.data && event.notification.data.href) || "/";
  event.waitUntil(self.clients.openWindow(href));
});
