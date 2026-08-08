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
  var chatUnreadState = { unread: 0, pollTimer: null };

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
    try {
      return (
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        ""
      );
    } catch (e) {
      return "";
    }
  }

  function looksLikeJwt(token) {
    var t = String(token || "").trim();
    if (!t || t.length < 20) return false;
    var parts = t.split(".");
    return parts.length === 3 && parts.every(function (part) {
      return part.length > 0;
    });
  }

  function decodeJwtExpMs(raw) {
    try {
      var parts = String(raw || "").split(".");
      if (parts.length < 2) return 0;
      var payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
      return payload.exp ? Number(payload.exp) * 1000 : 0;
    } catch (e) {
      return 0;
    }
  }

  function hasValidBossJwt() {
    if (window.MCJBossAuth && typeof window.MCJBossAuth.hasValidAccessToken === "function") {
      try {
        if (window.MCJBossAuth.hasValidAccessToken()) return true;
        return false;
      } catch (e) {}
    }
    if (window.MCJBossAuth && typeof window.MCJBossAuth.hasSession === "function") {
      try {
        if (window.MCJBossAuth.hasSession()) return true;
      } catch (e2) {}
    }
    var token = accessToken();
    if (!looksLikeJwt(token)) return false;
    var expRaw = "";
    try {
      expRaw = sessionStorage.getItem("mcjAuthExpiresAt") || localStorage.getItem("mcjAuthExpiresAt") || "";
    } catch (e3) {}
    var exp = 0;
    if (expRaw) {
      var n = Number(expRaw);
      if (Number.isFinite(n) && n > 0) exp = n < 1e12 ? n * 1000 : n;
    }
    if (!exp) exp = decodeJwtExpMs(token);
    if (exp && Date.now() >= exp) return false;
    return true;
  }

  function purgeGuestAuthArtifacts() {
    // Keep persisted login across refresh; only clear when no valid JWT remains.
    if (hasValidBossJwt()) return;
    [
      "customerAuthToken",
      "customerUser",
      "mcjCurrentUser",
      "mcjAuthAccessToken",
      "mcjAuthRefreshToken",
      "mcjAuthExpiresAt",
      "mcjRole",
    ].forEach(function (key) {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (e) {}
    });
    if (window.MCJBossAuth && typeof window.MCJBossAuth.clearSession === "function") {
      try { window.MCJBossAuth.clearSession(); } catch (e3) {}
    }
  }

  function hasAuthSession() {
    return hasValidBossJwt();
  }

  function isLoggedIn() {
    return hasValidBossJwt();
  }

  function deskAuthLinkHtml() {
    if (isLoggedIn()) {
      return (
        navLink("mine.html", "个人中心") +
        '<button type="button" class="mcj-desk-logout" data-mcj-boss-logout>退出登录</button>'
      );
    }
    return (
      '<a href="login.html" data-mcj-boss-login' +
      (activeHref("login.html") ? ' class="active"' : "") +
      ">登录</a>"
    );
  }

  function applyAuthVisibility() {
    if (!document.body) return;
    var logged = isLoggedIn();
    document.body.classList.toggle("is-logged-in", logged);
    document.body.classList.toggle("is-guest", !logged);
    document.body.setAttribute("data-mcj-auth", logged ? "in" : "out");

    var header = document.querySelector("header.mcj-boss-header");
    if (!header) return;
    header.setAttribute("data-mcj-auth", logged ? "in" : "out");
    header.classList.toggle("is-logged-in", logged);
    header.classList.toggle("is-guest", !logged);

    // Remove legacy / conflicting chrome (stars, old brand duplicates, old hamburger, old tabs)
    // Keep .mcj-header-brand — that is the live left brand block.
    header.querySelectorAll(
      ".mcj-boss-user, .top-actions, .live2d-avatar, .mcj-boss-mine, .mcj-boss-login, .mcj-boss-more, .mcj-boss-brand:not(.mcj-header-brand), .brand:not(.mcj-header-brand), .mcj-mnav-brand, [data-favorite], [data-mcj-favorite], .mcj-boss-star, .header-star, [data-mcj-notify-toggle], [data-mcj-nav-more], nav.header-nav:not(.mcj-desk-nav), nav.mcj-boss-nav:not(.mcj-desk-nav)"
    ).forEach(function (el) {
      el.remove();
    });

    // Keep mobile menu button as plain ☰ (strip design-system star SVG injection)
    header.querySelectorAll(".mcj-mnav-toggle, [data-mcj-mnav-toggle]").forEach(function (btn) {
      btn.querySelectorAll(".mcj-line-icon, .mcj-inline-icon, svg").forEach(function (n) {
        n.remove();
      });
      if ((btn.textContent || "").trim() !== "☰") btn.textContent = "☰";
    });

    if (
      !header.querySelector(".mcj-header-brand") ||
      !header.querySelector(".mcj-desk-nav") ||
      !header.querySelector(".mcj-mnav")
    ) {
      header.innerHTML = headerHtml();
      fillMobileDrawerLinks();
    } else {
      var desk = header.querySelector(".mcj-desk-nav");
      if (desk) {
        desk.innerHTML =
          navLink("index.html", "首页") +
          navLink("companion-center.html", "大厅") +
          navLink("orders.html", "订单") +
          supportNavLink() +
          deskAuthLinkHtml();
      }
      fillMobileDrawerLinks();
    }
    setChatUnread(chatUnreadState.unread);
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

  function supportNavLink() {
    var active = activeHref("support.html") ? ' class="active"' : "";
    var n = Number(chatUnreadState.unread || 0);
    var badge =
      n > 0
        ? '<em class="mcj-chat-unread-badge" data-mcj-chat-unread-badge>' +
          esc(unreadLabel(n)) +
          "</em>"
        : '<em class="mcj-chat-unread-badge" data-mcj-chat-unread-badge hidden></em>';
    return '<a href="support.html?start=1"' + active + ">客服" + badge + "</a>";
  }

  function setChatUnread(n) {
    chatUnreadState.unread = Math.max(0, Number(n || 0));
    document.querySelectorAll("[data-mcj-chat-unread-badge]").forEach(function (badge) {
      var label = unreadLabel(chatUnreadState.unread);
      if (label) {
        badge.hidden = false;
        badge.textContent = label;
      } else {
        badge.hidden = true;
        badge.textContent = "";
      }
    });
  }

  function refreshChatUnread() {
    if (!isLoggedIn()) {
      setChatUnread(0);
      return Promise.resolve(0);
    }
    var token =
      localStorage.getItem("mcjAuthAccessToken") ||
      sessionStorage.getItem("mcjAuthAccessToken") ||
      "";
    if (!token) {
      setChatUnread(0);
      return Promise.resolve(0);
    }
    return fetch("/api/chat?action=conversations", {
      headers: { Accept: "application/json", Authorization: "Bearer " + token },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        });
      })
      .then(function (body) {
        if (!body || body.ok === false) return chatUnreadState.unread;
        var total =
          body.unreadCount != null
            ? Number(body.unreadCount)
            : body.unread != null
              ? Number(body.unread)
              : (body.conversations || []).reduce(function (sum, c) {
                  return sum + Number(c.unreadCount || c.unread || 0);
                }, 0);
        setChatUnread(total);
        return total;
      })
      .catch(function () {
        return chatUnreadState.unread;
      });
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

  function mobileAuthLinkHtml() {
    if (isLoggedIn()) {
      return (
        navLink("mine.html", "个人中心") +
        '<button type="button" class="mcj-mnav-logout" data-mcj-boss-logout>退出登录</button>'
      );
    }
    return (
      '<a href="login.html" data-mcj-boss-login' +
      (activeHref("login.html") ? ' class="active"' : "") +
      ">登录</a>"
    );
  }

  function mobileDrawerLinksHtml() {
    // mobileAuthLinkHtml already includes one logout when logged in — do not append a second.
    return (
      navLink("index.html", "首页") +
      navLink("companion-center.html", "大厅") +
      navLink("orders.html", "订单") +
      supportNavLink() +
      mobileAuthLinkHtml()
    );
  }

  function fillMobileDrawerLinks() {
    var links = document.querySelector("[data-mcj-mnav-links]");
    if (links) links.innerHTML = mobileDrawerLinksHtml();
  }

  function brandHtml() {
    return (
      '<a class="mcj-header-brand" href="/" aria-label="MEOW CUI JIAO 妙脆角 首页">' +
      '<img class="mcj-header-brand-logo" src="/src/assets/meow-cuijiao-brand.jpg" alt="MEOW CUI JIAO" width="40" height="40" decoding="async" data-mcj-brand-logo="1">' +
      '<span class="mcj-header-brand-text">' +
      '<span class="mcj-header-brand-en">Meow Cui Jiao</span>' +
      '<span class="mcj-header-brand-zh">妙脆角</span>' +
      "</span></a>"
    );
  }

  function headerHtml() {
    return (
      '<div class="mcj-boss-header-inner header-inner">' +
      brandHtml() +
      '<nav class="mcj-desk-nav" aria-label="桌面主导航">' +
      navLink("index.html", "首页") +
      navLink("companion-center.html", "大厅") +
      navLink("orders.html", "订单") +
      supportNavLink() +
      deskAuthLinkHtml() +
      "</nav>" +
      '<div class="mcj-mnav">' +
      '<button type="button" class="mcj-mnav-toggle" data-mcj-mnav-toggle aria-controls="mcjMnavSheet" aria-expanded="false" aria-label="打开菜单">☰</button>' +
      "</div></div>"
    );
  }

  function ensureMobileNavSheet() {
    var sheet = document.getElementById("mcjMnavSheet");
    if (sheet) {
      fillMobileDrawerLinks();
      return sheet;
    }
    sheet = document.createElement("div");
    sheet.id = "mcjMnavSheet";
    sheet.className = "mcj-mnav-sheet";
    sheet.setAttribute("data-mcj-mnav-sheet", "1");
    sheet.hidden = true;
    sheet.innerHTML =
      '<button type="button" class="mcj-mnav-backdrop" data-mcj-mnav-backdrop aria-label="关闭菜单" tabindex="-1"></button>' +
      '<div class="mcj-mnav-drawer" data-mcj-mnav-drawer role="dialog" aria-modal="true" aria-label="导航菜单">' +
      '<div class="mcj-mnav-drawer-head">' +
      "<strong>菜单</strong>" +
      '<button type="button" class="mcj-mnav-close" data-mcj-mnav-close aria-label="关闭菜单">×</button>' +
      "</div>" +
      '<nav class="mcj-mnav-drawer-links" data-mcj-mnav-links aria-label="移动端主导航">' +
      mobileDrawerLinksHtml() +
      "</nav></div>";
    document.body.appendChild(sheet);
    return sheet;
  }

  function setMobileNavScrollLock(lock) {
    var html = document.documentElement;
    var body = document.body;
    if (!body) return;
    if (lock) {
      if (body.classList.contains("mcj-mnav-open")) return;
      var y = window.scrollY || window.pageYOffset || 0;
      body.dataset.mcjMnavScrollY = String(y);
      html.classList.add("mcj-mnav-open");
      body.classList.add("mcj-mnav-open");
      body.style.position = "fixed";
      body.style.top = "-" + y + "px";
      body.style.left = "0";
      body.style.right = "0";
      body.style.width = "100%";
      body.style.overflow = "hidden";
    } else {
      if (!body.classList.contains("mcj-mnav-open")) return;
      var restoreY = Number(body.dataset.mcjMnavScrollY || 0) || 0;
      html.classList.remove("mcj-mnav-open");
      body.classList.remove("mcj-mnav-open");
      body.style.position = "";
      body.style.top = "";
      body.style.left = "";
      body.style.right = "";
      body.style.width = "";
      body.style.overflow = "";
      delete body.dataset.mcjMnavScrollY;
      window.scrollTo(0, restoreY);
    }
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
    // Always rebuild header markup for tab-nav-only layout
    ensureCss("/src/boss-header.css?v=20260804navAuth4", "data-mcj-boss-header-css");
    ensureCss("/src/mcj-safe-area.css?v=20260802mobileP0c", "data-mcj-safe-area-css");
    ensureCss("/src/home-mobile.css?v=20260802mobileP0c", "data-mcj-home-mobile-css");
    document.body.classList.add("mcj-boss-shell");
    purgeGuestAuthArtifacts();

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
    ensureMobileNavSheet();
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
      "mcjCurrentUser",
      "mcjAuthAccessToken",
      "mcjAuthRefreshToken",
      "mcjAuthExpiresAt",
      "mcjRole",
      "mcjAfterLoginRedirect",
    ].forEach(function (key) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    if (window.MCJBossAuth && typeof window.MCJBossAuth.clearSession === "function") {
      try { window.MCJBossAuth.clearSession(); } catch (e) {}
    }
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
      var moreToggle = e.target.closest("[data-mcj-mnav-toggle], [data-mcj-nav-more]");
      if (moreToggle) {
        e.preventDefault();
        e.stopPropagation();
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

      var mnavClose = e.target.closest("[data-mcj-mnav-close], [data-mcj-mnav-backdrop]");
      if (mnavClose) {
        e.preventDefault();
        closeNavMoreMenu();
        return;
      }

      var mnavLink = e.target.closest("[data-mcj-mnav-links] a");
      if (mnavLink && !mnavLink.hasAttribute("data-mcj-boss-login")) {
        closeNavMoreMenu();
        // allow default navigation
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
      if (
        !e.target.closest(".mcj-mnav") &&
        !e.target.closest(".mcj-boss-more") &&
        !e.target.closest("[data-mcj-mnav-sheet]")
      ) {
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

    if (window.matchMedia) {
      var mq = window.matchMedia("(max-width: 899px)");
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
    s.src = "/src/avatar-fallback.js?v=20260806paySave1";
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
    var wrap = document.querySelector(".mcj-mnav");
    var toggle = document.querySelector("[data-mcj-mnav-toggle]");
    var sheet = document.getElementById("mcjMnavSheet") || document.querySelector("[data-mcj-mnav-sheet]");
    if (wrap) wrap.classList.remove("open");
    if (toggle) {
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "打开菜单");
    }
    if (sheet) {
      sheet.hidden = true;
      sheet.classList.remove("open");
    }
    setMobileNavScrollLock(false);
  }

  function toggleNavMoreMenu(forceClose) {
    ensureMobileNavSheet();
    var wrap = document.querySelector(".mcj-mnav");
    var toggle = document.querySelector("[data-mcj-mnav-toggle]");
    var sheet = document.getElementById("mcjMnavSheet") || document.querySelector("[data-mcj-mnav-sheet]");
    if (!wrap || !toggle || !sheet) return;
    var open = forceClose === true ? false : !wrap.classList.contains("open");
    wrap.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "关闭菜单" : "打开菜单");
    sheet.hidden = !open;
    sheet.classList.toggle("open", open);
    fillMobileDrawerLinks();
    setMobileNavScrollLock(open);
  }

  function boot() {
    if (!isBossPublicPage()) return;
    ensureAvatarFallback();
    mount();
    bind();
    scheduleAuthVisibility();
    ensureMeowButler();
    if (isLoggedIn()) {
      startNotifyPoll();
      refreshChatUnread();
      if (chatUnreadState.pollTimer) clearInterval(chatUnreadState.pollTimer);
      chatUnreadState.pollTimer = setInterval(function () {
        if (!document.hidden && isLoggedIn()) refreshChatUnread();
      }, 20000);
    }
    window.addEventListener("mcj-boss-chat-unread", function (ev) {
      var n = ev && ev.detail ? ev.detail.unread : 0;
      setChatUnread(n);
    });
  }

  window.MCJBossHeader = {
    mount: mount,
    sync: scheduleAuthVisibility,
    clearSession: clearBossSession,
    openLogin: openLogin,
    setChatUnread: setChatUnread,
    refreshChatUnread: refreshChatUnread,
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
