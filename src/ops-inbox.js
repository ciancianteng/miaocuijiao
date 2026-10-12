(function () {
  var role = document.body && document.body.dataset.opsAudience === "companion" ? "companion"
    : document.body && document.body.dataset.opsAudience === "service" ? "service"
    : location.pathname.indexOf("admin") >= 0 ? "admin" : "boss";

  function headers() {
    var actor = {};
    try { actor = JSON.parse(localStorage.getItem("customerServiceUser") || "{}"); } catch (e) { actor = {}; }
    var id = role === "companion" ? (localStorage.getItem("mcjOpsCompanionId") || "")
      : role === "boss" ? (localStorage.getItem("mcjOpsBossId") || "")
      : role === "service" ? (actor.user_id || actor.id || "svc_1")
      : "admin";
    var name = role === "service" ? (actor.name || "客服") : role;
    return {
      "Content-Type": "application/json",
      "x-ops-role": role,
      "x-ops-actor-id": id,
      "x-ops-companion-id": role === "companion" ? id : "",
      "x-ops-boss-id": role === "boss" ? id : "",
      "x-ops-actor-name": encodeURIComponent(name)
    };
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function openDrawer() {
    var old = document.getElementById("opsInbox");
    if (old) old.remove();
    var node = document.createElement("aside");
    node.id = "opsInbox";
    node.style.cssText = "position:fixed;top:0;right:0;z-index:80;width:min(380px,100%);height:100%;overflow:auto;background:#120910;color:#fff;border-left:1px solid rgba(255,190,224,.3);padding:calc(16px + env(safe-area-inset-top)) 16px 16px";
    node.innerHTML = '<button type="button" data-close-inbox>关闭</button><h2>通知</h2><div data-inbox-list>正在读取…</div><button type="button" data-enable-push>开启系统通知</button>';
    document.body.appendChild(node);
    node.addEventListener("click", function (event) {
      if (event.target.closest("[data-close-inbox]")) node.remove();
      var item = event.target.closest("[data-inbox-id]");
      if (item) {
        fetch("/api/ops/inbox/" + encodeURIComponent(item.dataset.inboxId) + "/read", { method: "POST", headers: headers(), body: "{}" });
        if (item.dataset.href) location.href = item.dataset.href;
      }
      if (event.target.closest("[data-enable-push]")) enablePush();
    });
    fetch("/api/ops/inbox", { headers: headers(), cache: "no-store" }).then(function (res) { return res.json(); }).then(function (payload) {
      var rows = (payload && payload.data) || [];
      var list = node.querySelector("[data-inbox-list]");
      var unread = rows.filter(function (item) { return !item.read; }).length;
      list.innerHTML = "<p>未读 " + unread + "</p>" + (rows.map(function (item) {
        return '<button type="button" data-inbox-id="' + esc(item.id) + '" data-href="' + esc(item.href) + '"><b>' + esc(item.title) + "</b><br>" + esc(item.body) + "</button>";
      }).join("") || "<p>暂无通知</p>");
    }).catch(function () {
      node.querySelector("[data-inbox-list]").textContent = "通知暂时读不到";
    });
  }

  function mountBell() {
    if (document.querySelector("[data-ops-bell]")) return;
    var host = document.querySelector(".portal-top, .service-header-inner, .admin-topbar, .top-actions, .topbar .nav");
    if (!host) return;
    var button = document.createElement("button");
    button.type = "button";
    button.dataset.opsBell = "1";
    button.textContent = "通知";
    button.className = "ops-btn";
    button.addEventListener("click", function (event) {
      event.preventDefault();
      openDrawer();
    });
    host.appendChild(button);
  }

  function seenKey() { return "mcj-chat-seen-" + role; }
  function seedEvents() {
    fetch("/api/ops/chat/events", { headers: headers(), cache: "no-store" }).then(function (res) { return res.json(); }).then(function (payload) {
      var rows = (payload && payload.data) || [];
      var seen = {};
      try { seen = JSON.parse(localStorage.getItem(seenKey()) || "{}"); } catch (e) { seen = {}; }
      var first = !localStorage.getItem(seenKey() + "-ready");
      rows.forEach(function (item) {
        if (!first && !seen[item.id] && window.MCJNotify) window.MCJNotify.push("chat", "新消息", "有一条新的客服消息", item.threadId);
        seen[item.id] = 1;
      });
      localStorage.setItem(seenKey(), JSON.stringify(seen));
      localStorage.setItem(seenKey() + "-ready", "1");
    }).catch(function () {});
  }

  function urlBase64ToUint8Array(base64String) {
    var padding = "=".repeat((4 - base64String.length % 4) % 4);
    var base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = window.atob(base64);
    var output = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; ++i) output[i] = raw.charCodeAt(i);
    return output;
  }

  function enablePush() {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      alert("这个浏览器不能接收系统推送。iPhone 需要把网站添加到主屏幕后再允许通知。");
      return;
    }
    Notification.requestPermission().then(function (permission) {
      if (permission !== "granted") return;
      navigator.serviceWorker.register("/sw.js").then(function (reg) {
        return fetch("/api/ops/push/public-key", { cache: "no-store" }).then(function (res) { return res.json(); }).then(function (payload) {
          var key = payload && payload.data && payload.data.publicKey;
          if (!key) { alert("服务器还没有推送密钥，订阅已保留在引导里，不会假装已经送达。"); return; }
          return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) });
        });
      }).then(function (sub) {
        if (!sub) return;
        return fetch("/api/ops/push/subscribe", { method: "POST", headers: headers(), body: JSON.stringify(sub.toJSON()) });
      }).catch(function () { alert("系统通知没有开启成功"); });
    });
  }

  function widgetHint() {
    if (role !== "companion" && role !== "admin") return;
    if (localStorage.getItem("mcj-widget-hint") === "hide") return;
    if (document.querySelector("[data-ops-widget]")) return;
    var card = document.createElement("section");
    card.dataset.opsWidget = "1";
    card.className = "ops-card";
    card.style.cssText = "position:fixed;left:12px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:70;width:min(280px,calc(100% - 24px));background:#1a1020;color:#fff;padding:12px;border-radius:16px;border:1px solid rgba(255,190,224,.35)";
    card.innerHTML = '<p>iPhone 锁屏小组件需要原生 App，当前网站不能直接安装。这里先显示同一套今日数据。</p><button type="button" data-hide-widget>稍后提醒</button><div data-widget-body>正在读取今日数据…</div>';
    document.body.appendChild(card);
    card.querySelector("[data-hide-widget]").addEventListener("click", function () {
      localStorage.setItem("mcj-widget-hint", "hide");
      card.remove();
    });
    var path = role === "admin" ? "/api/ops/admin/daily" : "/api/ops/companion/daily";
    fetch(path, { headers: headers(), cache: "no-store" }).then(function (res) { return res.json(); }).then(function (payload) {
      var data = payload && payload.data;
      var box = card.querySelector("[data-widget-body]");
      if (!box || !data) return;
      box.innerHTML = role === "admin"
        ? "今日订单 " + esc(data.orders) + "<br>今日成交额 " + esc(data.turnover) + "<br>待审核付款 " + esc(data.pendingPayments) + "<br>新陪玩申请 " + esc(data.applications) + "<br>在线陪玩 " + esc(data.onlineCompanions) + "<br>待处理客服 " + esc(data.pendingChats)
        : "今日订单 " + esc(data.orders) + "<br>今日收入 " + esc(data.income) + "<br>接单状态 " + (data.accepting ? "开启" : "暂停") + "<br>待处理订单 " + esc(data.pending) + "<br>未读客服消息 " + esc(data.unread);
    }).catch(function () {
      var box = card.querySelector("[data-widget-body]");
      if (box) box.textContent = "今日数据暂时读不到";
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  function start() {
    mountBell();
    widgetHint();
    seedEvents();
    setInterval(seedEvents, 20000);
  }
})();
