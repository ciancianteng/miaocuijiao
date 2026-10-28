/**
 * App icon badge follows the server unread_count.
 * localStorage is not the source of truth.
 */
(function (global) {
  "use strict";
  if (global.__MCJ_APP_BADGE__) return;
  global.__MCJ_APP_BADGE__ = 1;

  var POLL_MS = 20000;
  var timer = 0;
  var refreshGen = 0;
  var mutationTail = Promise.resolve();

  function tokenFromBlob(raw) {
    if (!raw) return "";
    try {
      var obj = typeof raw === "string" ? JSON.parse(raw) : raw;
      return String((obj && (obj.token || obj.accessToken || obj.access_token)) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function readKey(key) {
    try {
      return String(sessionStorage.getItem(key) || localStorage.getItem(key) || "").trim();
    } catch (e) {
      return "";
    }
  }

  function readBlob(key) {
    try {
      return tokenFromBlob(sessionStorage.getItem(key)) || tokenFromBlob(localStorage.getItem(key)) || "";
    } catch (e) {
      return "";
    }
  }

  function looksLikeJwt(value) {
    return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(String(value || ""));
  }

  function accessToken() {
    var which = portal();
    if (which === "customer_service") {
      try {
        if (global.MCJServiceAuth && typeof MCJServiceAuth.getAccessToken === "function") {
          var cs = String(MCJServiceAuth.getAccessToken() || "").trim();
          if (cs) return cs;
        }
      } catch (e) {}
      return readBlob("mcjServiceSession");
    }
    if (which === "companion") {
      var fromSession = readBlob("mcjCompanionSession");
      if (fromSession) return fromSession;
      var companion = readKey("companionAuthToken");
      return looksLikeJwt(companion) ? companion : "";
    }
    if (which === "admin") return "";
    try {
      if (global.MCJBossAuth && typeof MCJBossAuth.getAccessToken === "function") {
        var boss = String(MCJBossAuth.getAccessToken() || "").trim();
        if (boss) return boss;
      }
    } catch (e2) {}
    var bossToken = readKey("mcjAuthAccessToken");
    return looksLikeJwt(bossToken) ? bossToken : "";
  }

  function portal() {
    var path = String((global.location && location.pathname) || "");
    var search = String((global.location && location.search) || "");
    if (/[?&]portal=customer_service(?:&|$)/.test(search)) return "customer_service";
    if (/[?&]portal=companion(?:&|$)/.test(search)) return "companion";
    if (path.indexOf("/admin") === 0) return "admin";
    if (path.indexOf("/companion") === 0) return "companion";
    if (path.indexOf("/customer-service") === 0) return "customer_service";
    return "boss";
  }

  function authFetch(url, init) {
    var opts = init || {};
    var headers = Object.assign({ Accept: "application/json" }, opts.headers || {});
    var token = accessToken();
    if (token) headers.Authorization = "Bearer " + token;
    return fetch(url, Object.assign({}, opts, { headers: headers, cache: "no-store" })).then(function (res) {
      return res.json().catch(function () { return { ok: false }; });
    });
  }

  function syncAppBadge(unreadCount) {
    var nav = global.navigator;
    if (!nav || typeof nav.setAppBadge !== "function") return Promise.resolve({ supported: false });
    var count = Number(unreadCount);
    if (!isFinite(count) || count <= 0) {
      var clearJob = typeof nav.clearAppBadge === "function" ? nav.clearAppBadge() : nav.setAppBadge(0);
      return Promise.resolve(clearJob).then(function () { return { supported: true, count: 0 }; }).catch(function (error) {
        console.error("Badge update failed", error);
        return { supported: true, error: true };
      });
    }
    return Promise.resolve(nav.setAppBadge(Math.floor(count))).then(function () {
      return { supported: true, count: Math.floor(count) };
    }).catch(function (error) {
      console.error("Badge update failed", error);
      return { supported: true, error: true };
    });
  }

  function paint(count) {
    var n = Number(count);
    if (!isFinite(n) || n < 0) n = 0;
    var label = n > 99 ? "99+" : String(n);
    global.__MCJ_BADGE_COUNT = n;
    document.querySelectorAll("[data-mcj-badge-count]").forEach(function (el) {
      el.textContent = n > 0 ? label : "";
      el.hidden = n <= 0;
    });
    var bell = document.querySelector("[data-mcj-badge-bell]");
    if (bell) bell.setAttribute("aria-label", n > 0 ? "通知 " + label : "通知");
  }

  function refreshUnreadCount() {
    var gen = ++refreshGen;
    return runRefresh(gen, 0);
  }

  function runRefresh(gen, attempt) {
    var token = accessToken();
    if (!token) {
      if (gen === refreshGen) paint(0);
      return syncAppBadge(0);
    }
    return authFetch("/api/notifications?action=unread_count").then(function (body) {
      if (gen !== refreshGen || accessToken() !== token) return null;
      var raw = body && (body.unread_count != null ? body.unread_count : body.unreadCount);
      var count = Number(raw);
      if (raw == null || !isFinite(count)) {
        if (attempt < 1) {
          return new Promise(function (resolve) { global.setTimeout(resolve, 800); }).then(function () {
            if (gen !== refreshGen) return null;
            return runRefresh(gen, attempt + 1);
          });
        }
        return null;
      }
      paint(count);
      return syncAppBadge(count).then(function () { return count; });
    }).catch(function () {
      if (gen !== refreshGen || accessToken() !== token) return null;
      if (attempt < 1) {
        return new Promise(function (resolve) {
          global.setTimeout(resolve, 800);
        }).then(function () {
          if (gen !== refreshGen) return null;
          return runRefresh(gen, attempt + 1);
        });
      }
      return null;
    });
  }

  function applyServerCount(body) {
    var raw = body && (body.unread_count != null ? body.unread_count : body.unreadCount);
    var count = Number(raw);
    if (raw == null || !isFinite(count)) return null;
    paint(count);
    return syncAppBadge(count);
  }

  function enqueueMutation(task) {
    var run = mutationTail.then(task, task);
    mutationTail = run.then(function () { return null; }, function () { return null; });
    return run;
  }

  function markConversation(conversationId) {
    if (!conversationId || !accessToken()) return Promise.resolve(null);
    return enqueueMutation(function () {
      return authFetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "badge_read_conversation", conversationId: conversationId }),
      }).then(function (body) {
        applyServerCount(body);
        return refreshUnreadCount();
      });
    });
  }

  function markAll() {
    return enqueueMutation(function () {
      return authFetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "badge_read_all" }),
      }).then(function (body) {
        applyServerCount(body);
        return refreshUnreadCount();
      });
    });
  }

  function markOne(id) {
    return enqueueMutation(function () {
      return authFetch("/api/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "badge_read", id: id }),
      }).then(function (body) {
        applyServerCount(body);
        return refreshUnreadCount();
      });
    });
  }

  function removeFloatingBells() {
    document.querySelectorAll("body > a[data-mcj-badge-bell]").forEach(function (node) {
      node.remove();
    });
  }

  function headerBellHost() {
    var which = portal();
    if (which === "customer_service") {
      return document.querySelector(".cs-top .cs-account") || document.querySelector("header.cs-top");
    }
    if (which === "boss") return document.querySelector("header.mcj-boss-header .mcj-boss-header-inner");
    return null;
  }

  function mountHeaderBell() {
    if (portal() === "companion" || portal() === "admin") return;
    if (document.querySelector("[data-mcj-notification-center]")) return;
    if (document.querySelector("[data-mcj-badge-bell]")) return;
    var host = headerBellHost();
    if (!host || !accessToken()) return;
    var which = portal();
    var link = document.createElement("a");
    link.className = which === "customer_service" ? "cs-bell" : "mcj-header-bell";
    link.href = which === "customer_service" ? "/notifications.html?portal=customer_service" : "/notifications.html";
    link.setAttribute("data-mcj-badge-bell", "1");
    link.setAttribute("aria-label", "通知");
    link.innerHTML = '🔔<span data-mcj-badge-count hidden></span>';
    if (which === "boss") {
      var menu = host.querySelector(".mcj-mnav");
      if (menu) host.insertBefore(link, menu);
      else host.appendChild(link);
    } else {
      host.insertBefore(link, host.firstChild);
    }
    paint(global.__MCJ_BADGE_COUNT || 0);
  }

  function watchHeaderBell() {
    if (global.__MCJ_BELL_OBS || !document.body) return;
    global.__MCJ_BELL_OBS = true;
    var obs = new MutationObserver(function () {
      removeFloatingBells();
      if (portal() === "companion" || portal() === "admin") return;
      if (document.querySelector("[data-mcj-badge-bell]")) return;
      mountHeaderBell();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  function ensureBell() {
    if (!document.body || portal() === "admin") return;
    removeFloatingBells();
    watchHeaderBell();
    if (portal() === "companion" || document.querySelector("[data-mcj-notification-center]")) return;
    mountHeaderBell();
  }

  function deniedNote() {
    var box = document.querySelector("[data-mcj-badge-denied]");
    if (!box) return;
    var denied = false;
    try { denied = global.Notification && Notification.permission === "denied"; } catch (e) {}
    box.hidden = !denied;
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function renderCenter() {
    var root = document.querySelector("[data-mcj-notification-center]");
    if (!root) return;
    var category = root.getAttribute("data-category") || "all";
    document.querySelectorAll("[data-badge-category]").forEach(function (tab) {
      tab.classList.toggle("is-active", (tab.getAttribute("data-badge-category") || "all") === category);
    });
    authFetch("/api/notifications?action=inbox&category=" + encodeURIComponent(category)).then(function (body) {
      var items = (body && body.items) || [];
      refreshUnreadCount();
      if (!items.length) {
        root.innerHTML = '<p class="mcj-note-denied" data-mcj-badge-denied hidden>通知权限已关闭。你仍然可以在妙脆角内查看未读消息。</p><p class="mcj-note-empty">暂无通知。</p>';
        deniedNote();
        return;
      }
      root.innerHTML = '<p class="mcj-note-denied" data-mcj-badge-denied hidden>通知权限已关闭。你仍然可以在妙脆角内查看未读消息。</p>' + items.map(function (item) {
        var when = item.createdAt ? new Date(item.createdAt).toLocaleString() : "";
        var kind = String(item.category || "");
        var work = kind === "consult" || kind === "recharge" || kind === "gift";
        var tag = kind === "consult" ? "待接待" : kind === "recharge" ? "充值审核" : kind === "gift" ? "礼物审核" : "";
        var href = String(item.url || "");
        var canOpen = href.charAt(0) === "/" && href.charAt(1) !== "/" && !/\/login/i.test(href);
        return '<article class="mcj-note-card' + (work ? " is-work" : "") + (item.isRead ? " is-read" : "") + '" data-id="' + esc(item.id) + '">' +
          '<a class="mcj-note-link" href="' + esc(canOpen ? href : "#") + '" data-open-notification="' + esc(item.id) + '" data-note-url="' + esc(canOpen ? href : "") + '">' +
          (item.isRead ? "" : '<i class="mcj-note-dot" aria-hidden="true"></i>') +
          '<div>' + (tag ? '<em class="mcj-note-tag">' + tag + '</em>' : '') + '<strong>' + esc(item.title || "通知") + '</strong><p>' + esc(item.body || "") + '</p><time>' + esc(when) + '</time></div></a></article>';
      }).join("");
      deniedNote();
    }).catch(function () {
      root.innerHTML = '<p class="mcj-note-empty">通知暂时无法加载。</p>';
    });
  }

  function bindCenter() {
    var root = document.querySelector("[data-mcj-notification-center]");
    if (!root || root.getAttribute("data-bound") === "1") return;
    root.setAttribute("data-bound", "1");
    document.addEventListener("click", function (event) {
      var tab = event.target.closest("[data-badge-category]");
      if (tab) {
        root.setAttribute("data-category", tab.getAttribute("data-badge-category") || "all");
        renderCenter();
        return;
      }
      if (event.target.closest("[data-badge-read-all]")) {
        markAll().then(renderCenter);
        return;
      }
      var open = event.target.closest("[data-open-notification]");
      if (open) {
        markOne(open.getAttribute("data-open-notification"));
        if (!open.getAttribute("data-note-url")) {
          event.preventDefault();
          var empty = document.querySelector("[data-mcj-note-missing]");
          if (!empty) {
            empty = document.createElement("p");
            empty.className = "mcj-note-empty";
            empty.setAttribute("data-mcj-note-missing", "1");
            empty.textContent = "这条通知没有可打开的页面。";
            root.prepend(empty);
          }
        }
      }
    });
  }

  function watchConversationClicks() {
    document.addEventListener("click", function (event) {
      var el = event.target.closest("[data-conversation-id],[data-conversation]");
      if (!el) return;
      var id = el.getAttribute("data-conversation-id") || el.getAttribute("data-conversation") || "";
      if (/^[0-9a-f-]{36}$/i.test(id)) markConversation(id);
    }, true);
  }

  function start() {
    if (portal() === "admin") return;
    ensureBell();
    bindCenter();
    renderCenter();
    refreshUnreadCount();
    if (portal() === "boss" && global.MCJWebPush && typeof MCJWebPush.maybePromptOnFirstVisit === "function") {
      MCJWebPush.maybePromptOnFirstVisit({ role: "boss" });
    }
    global.addEventListener("online", refreshUnreadCount);
    global.addEventListener("pageshow", refreshUnreadCount);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") refreshUnreadCount();
    });
    if (global.navigator.serviceWorker) {
      navigator.serviceWorker.addEventListener("message", function (event) {
        if (event.data && event.data.type === "mcj-badge-refresh") refreshUnreadCount();
      });
    }
    document.addEventListener("click", function (event) {
      var t = event.target && event.target.closest && event.target.closest("[data-logout-confirm],[data-mcj-boss-logout],[data-boss-logout],[data-logout]");
      if (!t) return;
      if (t.hasAttribute("data-logout") && !t.hasAttribute("data-logout-confirm") && portal() !== "companion") return;
      paint(0);
      syncAppBadge(0);
    }, true);
    if (!timer) timer = global.setInterval(refreshUnreadCount, portal() === "customer_service" ? 4000 : POLL_MS);
  }

  global.MCJAppBadge = {
    syncAppBadge: syncAppBadge,
    refreshUnreadCount: refreshUnreadCount,
    markConversation: markConversation,
    markAll: markAll,
    markOne: markOne,
    clear: function () { paint(0); return syncAppBadge(0); },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
  watchConversationClicks();
})(typeof window !== "undefined" ? window : globalThis);
