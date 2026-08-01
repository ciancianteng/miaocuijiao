(function () {
  "use strict";

  if (window.__MCJBossHeaderLoaded) return;
  window.__MCJBossHeaderLoaded = true;

  var notifyState = {
    items: [],
    unread: 0,
    loading: false,
    error: "",
    open: false,
    pollTimer: null,
  };

  function path() {
    return String(location.pathname || "").replace(/\\/g, "/");
  }

  function isBossPublicPage() {
    var p = path();
    if (/\/admin(\/|\.html|$)/i.test(p)) return false;
    if (/\/companion\//i.test(p)) return false;
    if (/\/customer-service(\/|\.html|$)/i.test(p)) return false;
    if (/\/report(\/|$)/i.test(p)) return false;
    if (/admin-center\.html$/i.test(p)) return false;
    if (/customer-service\.html$/i.test(p)) return false;
    return true;
  }

  function ensureCss(href, attr) {
    if (document.querySelector("link[" + attr + "]")) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.setAttribute(attr, "1");
    document.head.appendChild(link);
  }

  function ensureScript(src, attr) {
    if (document.querySelector("script[" + attr + "],script[src*=\"" + src.split("/").pop() + "\"]")) return;
    var s = document.createElement("script");
    s.src = src;
    s.defer = true;
    s.setAttribute(attr, "1");
    document.head.appendChild(s);
  }

  function fileName() {
    var p = path();
    var name = p.split("/").pop() || "";
    if (!name || name === "") return "index.html";
    return name;
  }

  function isHomePage() {
    var file = fileName().toLowerCase();
    return file === "index.html" || path() === "/" || /\/index\.html?$/i.test(path());
  }

  function activeHref(href) {
    var file = fileName().toLowerCase();
    var raw = String(href || "");
    var target = raw.split("?")[0].split("/").pop().toLowerCase();
    var wantVoice = /(?:^|[?&])service=voice(?:&|$)/i.test(raw);
    var hasVoice = /(?:^|[?&])service=voice(?:&|$)/i.test(location.search || "");
    if (target === "companion-center.html") {
      if (file === "companion-center.html") {
        return wantVoice ? hasVoice : !hasVoice;
      }
      if (!wantVoice && /profile\.html|order-confirm\.html|companion-detail\.html/.test(file)) return true;
      return false;
    }
    if (file === target) return true;
    if (target === "index.html" && isHomePage()) return true;
    if (target === "more-gameplays.html" && /gameplay-product\.html|fixed-order\.html/.test(file)) return true;
    if (target === "orders.html" && /custom-order\.html/.test(file)) return true;
    if (target === "support.html" && /support\.html/.test(file)) return true;
    if (target === "mine.html" && /mine\.html/.test(file)) return true;
    if (target === "favorites.html" && /favorites\.html/.test(file)) return true;
    if (target === "messages.html" && /messages\.html/.test(file)) return true;
    if (target === "recharge.html" && /recharge\.html/.test(file)) return true;
    if (target === "companion-apply.html" && /companion-apply\.html/.test(file)) return true;
    return false;
  }

  function ensureBossAuthScript() {
    if (window.MCJBossAuth) return Promise.resolve(window.MCJBossAuth);
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-mcj-boss-auth],script[src*="boss-auth-session.js"]');
      if (existing) {
        var tries = 0;
        var timer = setInterval(function () {
          tries += 1;
          if (window.MCJBossAuth) {
            clearInterval(timer);
            resolve(window.MCJBossAuth);
          } else if (tries > 40) {
            clearInterval(timer);
            reject(new Error("鉴权模块未加载"));
          }
        }, 50);
        return;
      }
      var s = document.createElement("script");
      s.src = "/src/boss-auth-session.js";
      s.setAttribute("data-mcj-boss-auth", "1");
      s.onload = function () {
        if (window.MCJBossAuth) resolve(window.MCJBossAuth);
        else reject(new Error("鉴权模块未加载"));
      };
      s.onerror = function () {
        reject(new Error("鉴权模块加载失败"));
      };
      document.head.appendChild(s);
    });
  }

  function accessToken() {
    return (
      localStorage.getItem("mcjAuthAccessToken") ||
      sessionStorage.getItem("mcjAuthAccessToken") ||
      ""
    );
  }

  function hasAuthSession() {
    if (window.MCJBossAuth && typeof window.MCJBossAuth.hasSession === "function") {
      return !!window.MCJBossAuth.hasSession();
    }
    return !!(
      accessToken() ||
      localStorage.getItem("customerAuthToken") ||
      sessionStorage.getItem("customerAuthToken")
    );
  }

  function isLoggedIn() {
    var gateOk = false;
    if (window.MCJRoleGate && typeof window.MCJRoleGate.isLogged === "function") {
      gateOk = !!(window.MCJRoleGate.isLogged("customer") || window.MCJRoleGate.isLogged("boss"));
    }
    if (gateOk) return true;
    return !!(
      accessToken() ||
      localStorage.getItem("customerAuthToken") ||
      sessionStorage.getItem("customerAuthToken")
    );
  }

  function applyAuthVisibility() {
    if (!document.body) return;
    var logged = isLoggedIn();
    var isMobileNav = !!(window.matchMedia && window.matchMedia("(max-width: 820px)").matches);
    document.body.classList.toggle("is-logged-in", logged);
    document.body.classList.toggle("is-guest", !logged);
    document.body.setAttribute("data-mcj-auth", logged ? "in" : "out");

    var header = document.querySelector("header.mcj-boss-header");
    if (!header) return;

    // Header-owned auth flag — survives body.is-logged-in races with other scripts.
    header.setAttribute("data-mcj-auth", logged ? "in" : "out");
    header.classList.toggle("is-logged-in", logged);
    header.classList.toggle("is-guest", !logged);
    header.classList.toggle("mcj-mobile-nav", isMobileNav);

    function showEl(el, displayValue) {
      el.removeAttribute("hidden");
      el.style.setProperty("display", displayValue, "important");
    }
    function hideEl(el) {
      el.setAttribute("hidden", "");
      el.style.setProperty("display", "none", "important");
    }

    header.querySelectorAll("[data-guest-only], .mcj-boss-login").forEach(function (el) {
      var inMore = !!el.closest("[data-mcj-nav-more-menu]");
      if (logged) {
        hideEl(el);
        return;
      }
      // Mobile: login lives in ☰ menu only.
      if (!inMore && isMobileNav && el.classList.contains("mcj-boss-login")) {
        hideEl(el);
        return;
      }
      showEl(el, inMore ? "flex" : "inline-flex");
    });

    header.querySelectorAll(".mcj-boss-auth-only, [data-auth-only]").forEach(function (el) {
      var inMore = !!el.closest("[data-mcj-nav-more-menu]");
      if (!logged) {
        hideEl(el);
        return;
      }
      // Mobile: account menu lives in ☰.
      if (!inMore && isMobileNav && el.classList.contains("mcj-boss-auth-only")) {
        hideEl(el);
        return;
      }
      showEl(el, inMore ? "flex" : "inline-flex");
    });

    if (!logged) {
      notifyState.open = false;
      var panel = header.querySelector("[data-mcj-notify-panel]");
      if (panel) panel.hidden = true;
    }
  }

  function scheduleAuthVisibility() {
    applyAuthVisibility();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        applyAuthVisibility();
      });
    }
    setTimeout(applyAuthVisibility, 0);
    setTimeout(applyAuthVisibility, 40);
  }

  function navLink(href, label) {
    var active = activeHref(href) ? ' class="active"' : "";
    return '<a href="' + href + '"' + active + ">" + label + "</a>";
  }

  function unreadLabel(n) {
    n = Number(n || 0);
    if (n <= 0) return "";
    if (n > 99) return "99+";
    return String(n);
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function headerHtml() {
    var primary =
      navLink("index.html", "首页") +
      navLink("companion-center.html", "大厅") +
      navLink("orders.html", "我的订单") +
      navLink("support.html?start=1", "在线客服");
    return (
      '<div class="mcj-boss-header-inner header-inner">' +
      '<a class="brand mcj-boss-brand" href="index.html" aria-label="妙脆角首页">' +
      '<span class="mcj-boss-brand-text"><strong>妙脆角</strong><small>MEOW CUI JIAO</small></span>' +
      "</a>" +
      '<nav class="header-nav mcj-boss-nav mcj-boss-nav-primary" aria-label="主导航">' +
      primary +
      "</nav>" +
      '<div class="top-actions mcj-boss-user">' +
      '<div class="mcj-boss-more">' +
      '<button type="button" class="mcj-boss-more-toggle" data-mcj-nav-more aria-label="更多菜单" aria-haspopup="true" aria-expanded="false">☰</button>' +
      '<div class="mcj-boss-more-menu" role="menu" hidden data-mcj-nav-more-menu>' +
      '<a href="index.html" role="menuitem">首页</a>' +
      '<a href="companion-center.html" role="menuitem">大厅</a>' +
      '<a href="orders.html" role="menuitem">我的订单</a>' +
      '<a href="support.html?start=1" role="menuitem">在线客服</a>' +
      '<button type="button" role="menuitem" data-mcj-boss-login data-guest-only>登录 / 注册</button>' +
      '<button type="button" role="menuitem" data-mcj-boss-logout data-auth-only data-role="customer">退出登录</button>' +
      "</div></div>" +
      '<button class="login mcj-boss-login" type="button" data-mcj-boss-login data-guest-only>登录</button>' +
      '<div class="mcj-boss-mine mcj-boss-auth-only" hidden>' +
      '<button type="button" data-mcj-mine-toggle aria-haspopup="true" aria-expanded="false">我的</button>' +
      '<div class="mcj-boss-mine-menu" role="menu">' +
      '<a href="orders.html" role="menuitem">我的订单</a>' +
      '<a href="support.html?start=1" role="menuitem">在线客服</a>' +
      '<button type="button" data-mcj-boss-logout role="menuitem">退出登录</button>' +
      "</div></div></div></div>"
    );
  }

  function findExistingHeader() {
    return (
      document.querySelector("header.mcj-boss-header") ||
      document.querySelector("header.site-header") ||
      document.querySelector("header.topbar") ||
      document.querySelector("body > header")
    );
  }

  function renderNotifyPanel() {
    var body = document.querySelector("[data-mcj-notify-body]");
    var badge = document.querySelector("[data-mcj-notify-badge]");
    var panel = document.querySelector("[data-mcj-notify-panel]");
    var toggle = document.querySelector("[data-mcj-notify-toggle]");
    if (badge) {
      var label = unreadLabel(notifyState.unread);
      if (label) {
        badge.hidden = false;
        badge.textContent = label;
      } else {
        badge.hidden = true;
        badge.textContent = "";
      }
    }
    if (toggle) toggle.setAttribute("aria-expanded", notifyState.open ? "true" : "false");
    if (panel) panel.hidden = !notifyState.open;
    if (!body) return;

    if (notifyState.loading && !notifyState.items.length) {
      body.innerHTML = '<div class="mcj-boss-notify-empty">正在加载通知…</div>';
      return;
    }
    if (notifyState.error) {
      body.innerHTML =
        '<div class="mcj-boss-notify-empty">' + esc(notifyState.error) + "</div>";
      return;
    }
    if (!notifyState.items.length) {
      body.innerHTML = '<div class="mcj-boss-notify-empty">暂无通知</div>';
      return;
    }
    body.innerHTML = notifyState.items
      .map(function (item) {
        return (
          '<button type="button" class="mcj-boss-notify-item' +
          (item.read ? "" : " unread") +
          '" data-mcj-notify-item="' +
          esc(item.id) +
          '"><strong>' +
          esc(item.title || "通知") +
          "</strong><span>" +
          esc(item.body || item.message || "") +
          "</span><small>" +
          esc(item.createdAt || item.time || "") +
          "</small></button>"
        );
      })
      .join("");
  }

  function authHeaders(extra) {
    if (window.MCJBossAuth && typeof window.MCJBossAuth.authHeaders === "function") {
      return window.MCJBossAuth.authHeaders(extra || {});
    }
    var t = accessToken();
    var h = Object.assign({ Accept: "application/json" }, extra || {});
    if (t) {
      h.Authorization = "Bearer " + t;
      h["x-mcj-access-token"] = t;
    }
    return h;
  }

  function loadNotifications(opts) {
    opts = opts || {};
    if (!isLoggedIn() || !hasAuthSession()) {
      notifyState.items = [];
      notifyState.unread = 0;
      notifyState.error = "";
      notifyState.loading = false;
      renderNotifyPanel();
      return Promise.resolve();
    }
    if (!opts.silent) notifyState.loading = true;
    return ensureBossAuthScript()
      .then(function (Auth) {
        return Auth.ensureSession().then(function () {
          return Auth.authFetch("/api/notifications?action=list");
        });
      })
      .then(function (body) {
        notifyState.items = Array.isArray(body.items) ? body.items : [];
        notifyState.unread = Number(body.unread || 0);
        notifyState.error = "";
      })
      .catch(function (err) {
        notifyState.error = err.message || "通知暂时无法加载，请稍后重试";
        if (!notifyState.items.length) notifyState.unread = 0;
      })
      .finally(function () {
        notifyState.loading = false;
        renderNotifyPanel();
      });
  }

  function markAllRead() {
    if (!hasAuthSession()) return Promise.resolve();
    return ensureBossAuthScript()
      .then(function (Auth) {
        return Auth.authFetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark_all_read" }),
        });
      })
      .then(function () {
        return loadNotifications({ silent: true });
      })
      .catch(function (err) {
        notifyState.error = err.message || "通知暂时无法加载，请稍后重试";
        renderNotifyPanel();
      });
  }

  function markOneRead(id) {
    if (!id || !hasAuthSession()) return Promise.resolve();
    return ensureBossAuthScript()
      .then(function (Auth) {
        return Auth.authFetch("/api/notifications", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "mark_read", id: id }),
        });
      })
      .then(function () {
        return loadNotifications({ silent: true });
      })
      .catch(function () {});
  }

  function startNotifyPoll() {
    // MVP 止血：通知推送未完成，不加载/轮询，避免干扰主流程。
    if (notifyState.pollTimer) {
      clearInterval(notifyState.pollTimer);
      notifyState.pollTimer = null;
    }
  }

  function mount() {
    if (!isBossPublicPage() || !document.body) return;
    ensureCss("/src/boss-header.css?v=20260731-mobile-nav", "data-mcj-boss-header-css");
    document.body.classList.add("mcj-boss-shell");

    var existing = findExistingHeader();
    var header;
    if (existing) {
      header = existing;
      header.className = "site-header mcj-boss-header";
      header.setAttribute("data-mcj-boss-header", "1");
      header.innerHTML = headerHtml();
    } else {
      header = document.createElement("header");
      header.className = "site-header mcj-boss-header";
      header.setAttribute("data-mcj-boss-header", "1");
      header.innerHTML = headerHtml();
      document.body.insertBefore(header, document.body.firstChild);
    }

    scheduleAuthVisibility();
    renderNotifyPanel();
    if (isLoggedIn()) loadNotifications({ silent: true });
    window.addEventListener("mcj:auth-expired", function () {
      notifyState.items = [];
      notifyState.unread = 0;
      notifyState.error = window.MCJBossAuth && window.MCJBossAuth.expiredMessage
        ? window.MCJBossAuth.expiredMessage
        : "登录已过期，请重新登录。";
      scheduleAuthVisibility();
      renderNotifyPanel();
    });
  }

  function clearBossSession() {
    if (window.MCJRoleGate && typeof window.MCJRoleGate.logout === "function") {
      window.MCJRoleGate.logout("customer");
      window.MCJRoleGate.logout("boss");
    }
    [
      "customerAuthToken",
      "customerUser",
      "mcjAuthAccessToken",
      "mcjAuthRefreshToken",
      "mcjAuthExpiresAt",
      "mcjRole",
    ].forEach(function (key) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    notifyState.items = [];
    notifyState.unread = 0;
    notifyState.open = false;
    scheduleAuthVisibility();
    renderNotifyPanel();
  }

  function openLogin() {
    if (typeof window.loginRequiredModal === "function") {
      window.loginRequiredModal();
      return;
    }
    if (window.MCJModal && typeof window.MCJModal.openLogin === "function" && isHomePage()) {
      window.MCJModal.openLogin("login");
      return;
    }
    var legacy = document.querySelector(
      '.top-actions .login[data-modal="login"], button[data-modal="login"], [data-customer-login]'
    );
    if (legacy && !legacy.hasAttribute("data-mcj-boss-login")) {
      legacy.click();
      return;
    }
    if (isHomePage()) {
      location.hash = "login";
      setTimeout(function () {
        if (window.MCJModal && typeof window.MCJModal.openLogin === "function") window.MCJModal.openLogin("login");
        else if (typeof window.loginRequiredModal === "function") window.loginRequiredModal();
      }, 30);
      return;
    }
    location.href = "/login.html";
  }

  function bind() {
    if (window.__MCJBossHeaderBound) return;
    window.__MCJBossHeaderBound = true;

    document.addEventListener("click", function (e) {
      var moreToggle = e.target.closest("[data-mcj-nav-more]");
      if (moreToggle) {
        e.preventDefault();
        document.querySelectorAll(".mcj-boss-mine.open").forEach(function (n) {
          n.classList.remove("open");
          var b = n.querySelector("[data-mcj-mine-toggle]");
          if (b) b.setAttribute("aria-expanded", "false");
        });
        notifyState.open = false;
        renderNotifyPanel();
        toggleNavMoreMenu();
        return;
      }

      var login = e.target.closest("[data-mcj-boss-login]");
      if (login) {
        e.preventDefault();
        closeNavMoreMenu();
        openLogin();
        return;
      }

      var notifyToggle = e.target.closest("[data-mcj-notify-toggle]");
      if (notifyToggle) {
        e.preventDefault();
        closeNavMoreMenu();
        if (!isLoggedIn()) {
          openLogin();
          return;
        }
        notifyState.open = !notifyState.open;
        if (notifyState.open) {
          document.querySelectorAll(".mcj-boss-mine.open").forEach(function (n) {
            n.classList.remove("open");
          });
          loadNotifications();
        }
        renderNotifyPanel();
        return;
      }

      var readAll = e.target.closest("[data-mcj-notify-readall]");
      if (readAll) {
        e.preventDefault();
        markAllRead();
        return;
      }

      var notifyItem = e.target.closest("[data-mcj-notify-item]");
      if (notifyItem) {
        e.preventDefault();
        markOneRead(notifyItem.getAttribute("data-mcj-notify-item"));
        return;
      }

      var toggle = e.target.closest("[data-mcj-mine-toggle]");
      if (toggle) {
        e.preventDefault();
        closeNavMoreMenu();
        var wrap = toggle.closest(".mcj-boss-mine");
        if (!wrap) return;
        var open = !wrap.classList.contains("open");
        document.querySelectorAll(".mcj-boss-mine.open").forEach(function (n) {
          n.classList.remove("open");
          var b = n.querySelector("[data-mcj-mine-toggle]");
          if (b) b.setAttribute("aria-expanded", "false");
        });
        if (open) {
          notifyState.open = false;
          renderNotifyPanel();
          wrap.classList.add("open");
          toggle.setAttribute("aria-expanded", "true");
        }
        return;
      }

      var logout = e.target.closest("[data-mcj-boss-logout], [data-boss-logout]");
      if (logout) {
        e.preventDefault();
        clearBossSession();
        location.href = "index.html";
        return;
      }

      if (!e.target.closest("header.mcj-boss-header") && e.target.closest("[data-logout]")) {
        var inOldNav = e.target.closest(".boss-nav, .navlinks, .top-actions, .nav");
        if (inOldNav && isBossPublicPage()) {
          e.preventDefault();
          clearBossSession();
          location.href = "index.html";
        }
      }

      if (!e.target.closest(".mcj-boss-mine")) {
        document.querySelectorAll(".mcj-boss-mine.open").forEach(function (n) {
          n.classList.remove("open");
        });
      }
      if (!e.target.closest(".mcj-boss-more")) {
        closeNavMoreMenu();
      }
      if (!e.target.closest(".mcj-boss-notify")) {
        if (notifyState.open) {
          notifyState.open = false;
          renderNotifyPanel();
        }
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeNavMoreMenu();
    });

    window.addEventListener("scroll", closeNavMoreMenu, { passive: true });

    if (window.matchMedia) {
      var mq = window.matchMedia("(max-width: 820px)");
      var onNavMq = function () {
        closeNavMoreMenu();
        scheduleAuthVisibility();
      };
      if (typeof mq.addEventListener === "function") mq.addEventListener("change", onNavMq);
      else if (typeof mq.addListener === "function") mq.addListener(onNavMq);
    }

    window.addEventListener("mcj:auth-updated", function () {
      scheduleAuthVisibility();
      if (isLoggedIn()) {
        loadNotifications({ silent: true });
        startNotifyPoll();
      } else {
        notifyState.items = [];
        notifyState.unread = 0;
        notifyState.open = false;
        renderNotifyPanel();
      }
    });

    window.addEventListener("mcj:notify", function () {
      if (isLoggedIn()) loadNotifications({ silent: true });
    });

    window.addEventListener("storage", function () {
      scheduleAuthVisibility();
    });

    window.addEventListener("focus", function () {
      scheduleAuthVisibility();
    });

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) scheduleAuthVisibility();
    });
  }

  function ensureAvatarFallback() {
    if (window.__MCJAvatarFallback) return;
    if (document.querySelector('script[data-mcj-avatar-fallback],script[src*="avatar-fallback.js"]')) return;
    var s = document.createElement("script");
    s.src = "/src/avatar-fallback.js";
    s.setAttribute("data-mcj-avatar-fallback", "1");
    document.head.appendChild(s);
  }

  function removeMeowButlerWidgets() {
    var sel = [
      "#floatingCustomerService",
      "#floatingService",
      ".floating-service",
      ".floating-cs-button",
      ".floating-cs-panel",
      ".floating-cs-root",
      ".service-float",
      ".online-service",
      "#mcjButler",
      "#mcjButlerModal",
      "#mcjFloatingAssistant",
      "#mcjFloatingAssistantBackdrop",
      "[data-mcj-meow-butler]",
      "link[data-mcj-meow-butler-css]",
    ].join(",");
    document.querySelectorAll(sel).forEach(function (el) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
    });
    document.documentElement.classList.remove("mcj-floating-cs-lock");
    if (document.body) document.body.classList.remove("mcj-floating-cs-lock");
  }

  function ensureMeowButler() {
    // Permanently removed: no floating 喵管家 on homepage / boss public pages.
    removeMeowButlerWidgets();
  }

  function closeNavMoreMenu() {
    var wrap = document.querySelector(".mcj-boss-more");
    var toggle = document.querySelector("[data-mcj-nav-more]");
    var menu = document.querySelector("[data-mcj-nav-more-menu]");
    if (wrap) wrap.classList.remove("open");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    if (menu) menu.hidden = true;
  }

  function toggleNavMoreMenu(forceClose) {
    var wrap = document.querySelector(".mcj-boss-more");
    var toggle = document.querySelector("[data-mcj-nav-more]");
    var menu = document.querySelector("[data-mcj-nav-more-menu]");
    if (!wrap || !toggle || !menu) return;
    var open = forceClose === true ? false : !wrap.classList.contains("open");
    wrap.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    menu.hidden = !open;
  }

  function boot() {
    if (!isBossPublicPage()) return;
    ensureAvatarFallback();
    mount();
    bind();
    scheduleAuthVisibility();
    ensureMeowButler();
    if (isLoggedIn()) startNotifyPoll();
  }

  window.MCJBossHeader = {
    mount: mount,
    sync: scheduleAuthVisibility,
    clearSession: clearBossSession,
    openLogin: openLogin,
    refreshNotifications: function () {
      return loadNotifications({ silent: true });
    },
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
