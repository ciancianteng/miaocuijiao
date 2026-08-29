(function () {
  var SESSION_VERSION = "v4";
  var routes = {
    customer: { token: "customerAuthToken", user: "customerUser", login: "/login.html", allowed: [/\/index\.html$/, /\/$/, /\/login\.html$/, /\/mine\.html$/, /\/companion-center\.html$/, /\/profile\.html$/, /\/orders\.html$/, /\/messages\.html$/, /\/custom-order\.html$/, /\/order-confirm\.html$/, /\/payment-confirm\.html$/, /\/recharge\.html$/, /\/points\.html$/, /\/invite\.html$/, /\/gifts\.html$/, /\/support\.html$/, /\/favorites\.html$/, /\/leaderboard\.html$/, /\/ranking\.html$/, /\/more-gameplays\.html$/, /\/gameplay-product\.html$/, /\/fixed-order\.html$/, /\/team-lobby\.html$/, /\/companion-apply\.html$/, /\/activities\.html$/] },
    boss: { token: "customerAuthToken", user: "customerUser", login: "/login.html", allowed: [/\/index\.html$/, /\/$/, /\/login\.html$/, /\/mine\.html$/, /\/companion-center\.html$/, /\/profile\.html$/, /\/orders\.html$/, /\/messages\.html$/, /\/custom-order\.html$/, /\/order-confirm\.html$/, /\/payment-confirm\.html$/, /\/recharge\.html$/, /\/points\.html$/, /\/invite\.html$/, /\/gifts\.html$/, /\/support\.html$/, /\/favorites\.html$/, /\/leaderboard\.html$/, /\/ranking\.html$/, /\/more-gameplays\.html$/, /\/gameplay-product\.html$/, /\/fixed-order\.html$/, /\/team-lobby\.html$/, /\/companion-apply\.html$/, /\/activities\.html$/] },
    companion: { token: "companionAuthToken", user: "companionUser", login: "/companion/login", allowed: [/\/companion\//] },
    customer_service: { token: "customerServiceAuthToken", user: "customerServiceUser", login: "/customer-service/login", allowed: [/\/customer-service\//] },
    admin: { token: "adminAuthToken", user: "adminUser", login: "/admin/login", allowed: [/\/admin\.html$/, /\/admin\//] }
  };

  function path() { return location.pathname.replace(/\\/g, "/"); }
  function storageRole(role) {
    role = String(role || "");
    if (role === "boss") return "customer";
    if (role === "service") return "customer_service";
    if (role === "player") return "companion";
    if (role === "super_admin") return "admin";
    return role;
  }
  function profileRole(role) { role = String(role || ""); if (role === "customer") return "boss"; if (role === "service") return "customer_service"; if (role === "player") return "companion"; if (role === "super_admin") return "admin"; return role; }
  function roleMatches(expected, actual) { return profileRole(expected) === profileRole(actual); }
  function routeFor(role) {
    var key = profileRole(role);
    return {
      boss: "/index.html",
      customer: "/index.html",
      companion: "/companion/dashboard/",
      customer_service: "/customer-service/dashboard/",
      admin: "/admin.html#dashboard",
    }[key] || "/index.html";
  }
  function isAdminLoginPath(p) {
    p = String(p || path()).replace(/\/+$/, "") || "/";
    return p === "/admin/login" || /\/admin\/login\/index\.html$/.test(p);
  }

  function cfgFor(role) { return routes[storageRole(role)] || routes[role]; }
  function readUser(role) {
    var cfg = cfgFor(role);
    try {
      return JSON.parse(localStorage.getItem(cfg.user) || sessionStorage.getItem(cfg.user) || "{}");
    } catch (e) {
      return {};
    }
  }
  function readToken(role) {
    var cfg = cfgFor(role);
    return localStorage.getItem(cfg.token) || sessionStorage.getItem(cfg.token) || "";
  }
  function isAllowed(role) { var cfg = cfgFor(role); if (!cfg) return true; return cfg.allowed.some(function (rule) { return rule.test(path()); }); }
  function hasAdminSoftSession() {
    try {
      var soft = localStorage.getItem("adminAuthToken") || sessionStorage.getItem("adminAuthToken") || "";
      return String(soft).indexOf("admin_session_") === 0;
    } catch (e) {
      return false;
    }
  }

  function readAccessToken() {
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

  function hasValidBossAccessToken() {
    var access = readAccessToken();
    if (!looksLikeJwt(access)) return false;
    var expRaw = "";
    try {
      expRaw = sessionStorage.getItem("mcjAuthExpiresAt") || localStorage.getItem("mcjAuthExpiresAt") || "";
    } catch (e) {}
    var exp = 0;
    if (expRaw) {
      var n = Number(expRaw);
      if (Number.isFinite(n) && n > 0) exp = n < 1e12 ? n * 1000 : n;
    }
    if (!exp) exp = decodeJwtExpMs(access);
    if (exp && Date.now() >= exp) return false;
    return true;
  }

  function wipeBossGuestArtifacts() {
    // Never touch dedicated admin JWT keys. Shared mcjAuth* only cleared when no admin session.
    var adminSoft =
      String(localStorage.getItem("adminAuthToken") || sessionStorage.getItem("adminAuthToken") || "").indexOf(
        "admin_session_"
      ) === 0;
    [
      "customerAuthToken",
      "customerUser",
      "mcjCurrentUser",
    ]
      .concat(
        adminSoft
          ? []
          : ["mcjAuthAccessToken", "mcjAuthRefreshToken", "mcjAuthExpiresAt", "mcjRole"]
      )
      .forEach(function (key) {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      });
  }

  function isBossSurfaceRole(role) {
    var key = storageRole(role);
    return key === "customer" || key === "boss";
  }

  function hasValidAdminAccessToken() {
    var access = "";
    try {
      access =
        sessionStorage.getItem("mcjAdminAccessToken") ||
        localStorage.getItem("mcjAdminAccessToken") ||
        "";
      if (!access && hasAdminSoftSession()) {
        access =
          sessionStorage.getItem("mcjAuthAccessToken") ||
          localStorage.getItem("mcjAuthAccessToken") ||
          "";
      }
    } catch (e) {
      access = "";
    }
    if (!looksLikeJwt(access)) return false;
    var expRaw = "";
    try {
      expRaw =
        sessionStorage.getItem("mcjAdminExpiresAt") ||
        localStorage.getItem("mcjAdminExpiresAt") ||
        sessionStorage.getItem("mcjAuthExpiresAt") ||
        localStorage.getItem("mcjAuthExpiresAt") ||
        "";
    } catch (e2) {}
    var exp = 0;
    if (expRaw) {
      var n = Number(expRaw);
      if (Number.isFinite(n) && n > 0) exp = n < 1e12 ? n * 1000 : n;
    }
    if (!exp) exp = decodeJwtExpMs(access);
    if (exp && Date.now() >= exp) return false;
    return true;
  }

  function clearAdminClientSession() {
    [
      "adminAuthToken",
      "adminUser",
      "mcjAdminAccessToken",
      "mcjAdminRefreshToken",
      "mcjAdminExpiresAt",
    ].forEach(function (key) {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (e) {}
    });
    try {
      var role = localStorage.getItem("mcjRole") || sessionStorage.getItem("mcjRole") || "";
      if (role === "admin" || role === "super_admin") {
        localStorage.removeItem("mcjRole");
        sessionStorage.removeItem("mcjRole");
      }
    } catch (e2) {}
  }

  function isLogged(role) {
    var key = storageRole(role);
    var u = readUser(role);
    // Admin: soft session alone NEVER counts — require live admin JWT + admin role.
    if (key === "admin") {
      if (!hasValidAdminAccessToken()) return false;
      if (!hasAdminSoftSession()) return false;
      if (u && (u.role || u.adminRole)) {
        return isAdminRole(u.role) || isAdminRole(u.adminRole);
      }
      // JWT + soft present; identity refresh will confirm role before rendering.
      return true;
    }
    // Companion: soft alone NEVER counts — require portal-scoped JWT blob.
    if (key === "companion") {
      return hasPortalSession("companion");
    }
    // Boss / customer: soft session alone NEVER counts — require live access JWT.
    if (isBossSurfaceRole(role)) {
      if (!hasValidBossAccessToken()) return false;
      if (!u || !u.role) return true;
      return roleMatches(role, u.role);
    }
    var token = readToken(role);
    if (token) {
      if (String(token).indexOf(key + "_session_" + SESSION_VERSION + "_") === 0) {
        return roleMatches(role, u.role || role);
      }
      if (String(token).indexOf(key + "_session_") === 0) {
        return roleMatches(role, u.role || role);
      }
    }
    return false;
  }

  function humanizeAuthError(error) {
    var msg = String((error && error.message) || error || "").trim();
    if (!msg || /failed to fetch|fetch failed|networkerror|network request failed|load failed|err_connection|econnrefused|econnreset|enotfound|timeout/i.test(msg)) {
      return "暂时无法连接服务器，请稍后重试";
    }
    if (/invalid login credentials|invalid.*(email|password)|email not confirmed/i.test(msg)) {
      return "邮箱或密码错误。";
    }
    if (/尚未设置密码|NO_PASSWORD/i.test(msg) || /请使用验证码登录后前往账号安全/i.test(msg)) {
      return "该账号尚未设置密码，请使用验证码登录后前往账号安全设置密码。";
    }
    if (/user already registered|already.*(registered|exists)|duplicate|邮箱.*已/i.test(msg)) {
      return "该邮箱已注册，请直接登录。";
    }
    return msg;
  }

  function setLoginMessage(anchor, message) {
    var root =
      (anchor && anchor.closest && (anchor.closest(".boss-login-modal") || anchor.closest("[data-auth-mode]"))) ||
      document;
    var box =
      (root.querySelector && (root.querySelector("#loginState") || root.querySelector("[data-login-error]"))) ||
      document.getElementById("loginState") ||
      document.querySelector("[data-login-error]");
    if (!box && anchor && anchor.parentNode) {
      box = document.createElement("p");
      box.id = "loginState";
      box.setAttribute("data-login-error", "true");
      box.style.margin = "10px 0 0";
      box.style.color = "#ff8fc5";
      box.style.fontSize = "13px";
      box.style.fontWeight = "700";
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    if (box) {
      box.textContent = message || "";
      box.hidden = !message;
      try {
        box.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch (e) {}
    } else if (message) {
      try {
        window.alert(message);
      } catch (e2) {}
    }
  }

  function fieldValue(ids) { for (var i = 0; i < ids.length; i += 1) { var el = document.getElementById(ids[i]); if (el) return el.value || ""; } return ""; }
  function closeLoginModal() {
    if (window.MCJModal && typeof window.MCJModal.close === "function") {
      window.MCJModal.close();
      return;
    }
    var modal = document.getElementById("modal");
    if (modal) modal.classList.remove("open");
    document.body.style.overflow = "";
  }
  function refreshAuthUi() {
    if (!document.body) return;
    if (window.__mcjAuthUiRefreshing) return;
    window.__mcjAuthUiRefreshing = true;
    try {
      document.body.classList.toggle("is-logged-in", isLogged("customer") || isLogged("boss"));
      window.dispatchEvent(new CustomEvent("mcj:auth-updated"));
    } finally {
      window.__mcjAuthUiRefreshing = false;
    }
  }

  function inferPortalFromPage() {
    var p = path();
    if (/\/companion(\/|$)/i.test(p)) return "companion";
    if (/\/customer-service(\/|$)/i.test(p)) return "customer_service";
    if (/\/admin(\/|\.html|$)/i.test(p)) return "admin";
    // Boss dedicated surfaces (homepage modal / login.html / mine) — never role-pick here.
    if (/^\/?$|\/index\.html$/i.test(p) || /\/login\.html$/i.test(p) || /\/mine\.html$/i.test(p)) return "boss";
    return "";
  }

  function portalDeniedMessage(portal) {
    if (portal === "boss") return "该账号暂无老板端权限";
    if (portal === "companion") return "该账号暂无陪玩端权限";
    if (portal === "customer_service") return "该账号暂无客服权限";
    if (portal === "admin") return "该账号暂无管理员权限";
    return "账号角色与当前入口不匹配。";
  }

  function isAdminRole(role) {
    role = String(role || "");
    return role === "admin" || role === "super_admin";
  }

  function writeCompanionPortalSession(session, remember) {
    var userData = (session && session.user) || {};
    var access = String((session && (session.accessToken || session.token || session.access_token)) || "").trim();
    var refresh = String((session && (session.refreshToken || session.refresh_token)) || "").trim();
    var expiresAt = (session && (session.expiresAt != null ? session.expiresAt : session.expires_at)) || "";
    if (!looksLikeJwt(access) && !refresh) return null;
    var user = Object.assign({}, userData, {
      role: "companion",
      email: userData.email || "",
      id: userData.id || userData.user_id || "",
    });
    var soft = "companion_session_" + SESSION_VERSION + "_" + Date.now();
    var blob = {
      token: access,
      accessToken: access,
      refreshToken: refresh,
      expiresAt: expiresAt,
      user: user,
      remember: remember !== false,
      portal: "companion",
      portalLoginAt: Date.now(),
    };
    var stores = remember !== false ? [localStorage, sessionStorage] : [sessionStorage];
    stores.forEach(function (store) {
      try {
        store.setItem("mcjCompanionSession", JSON.stringify(blob));
        store.setItem("companionAuthToken", soft);
        store.setItem("companionUser", JSON.stringify(user));
      } catch (e) {}
    });
    if (remember === false) {
      try {
        localStorage.removeItem("mcjCompanionSession");
        localStorage.removeItem("companionAuthToken");
        localStorage.removeItem("companionUser");
      } catch (e2) {}
    }
    return user;
  }

  function clearCompanionPortalSession() {
    [
      "mcjCompanionSession",
      "companionAuthToken",
      "companionUser",
    ].forEach(function (key) {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (e) {}
    });
  }

  function readStoredUserIdFrom(raw) {
    try {
      var u = typeof raw === "string" ? JSON.parse(raw || "null") : raw;
      if (!u || typeof u !== "object") return "";
      return String(u.id || u.user_id || u.userId || "").trim();
    } catch (e) {
      return "";
    }
  }

  function readCompanionPortalUserId() {
    try {
      var raw = localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "";
      if (!raw) return "";
      var sess = JSON.parse(raw);
      return readStoredUserIdFrom(sess && sess.user);
    } catch (e) {
      return "";
    }
  }

  function readBossPortalUserId() {
    try {
      var raw =
        sessionStorage.getItem("customerUser") ||
        localStorage.getItem("customerUser") ||
        sessionStorage.getItem("mcjCurrentUser") ||
        localStorage.getItem("mcjCurrentUser") ||
        "";
      var id = readStoredUserIdFrom(raw);
      if (id) return id;
    } catch (e) {}
    try {
      var tok =
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        "";
      var part = String(tok || "").split(".")[1];
      if (!part) return "";
      var b64 = part.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      var payload = JSON.parse(atob(b64));
      return String((payload && (payload.sub || payload.user_id || payload.userId)) || "").trim();
    } catch (e2) {
      return "";
    }
  }

  /**
   * Boss logout must drop a same-User-ID companion apply session.
   * Otherwise header shows guest while companion-apply still restores that
   * user's draft via mcjCompanionSession (portal isolation leftover).
   * Different-user companion sessions are kept (true dual-login).
   */
  function clearCompanionSessionIfSameUser(bossUserId) {
    var bossId = String(bossUserId || "").trim() || readBossPortalUserId();
    if (!bossId) return false;
    var companionId = readCompanionPortalUserId();
    if (!companionId || companionId !== bossId) return false;
    clearCompanionPortalSession();
    return true;
  }

  function clearBossPortalSession() {
    // Capture boss uid before wiping keys — needed to clear same-user apply session.
    var bossUid = readBossPortalUserId();
    // Boss-only keys. Never touch CS / dedicated admin JWT.
    // Same-user companion apply session is cleared below (draft isolation).
    var adminSoft = hasAdminSoftSession();
    [
      "customerAuthToken",
      "customerUser",
      "mcjCurrentUser",
      "mcjBossSession",
      "mcjActivePortal",
    ]
      .concat(adminSoft ? [] : ["mcjAuthAccessToken", "mcjAuthRefreshToken", "mcjAuthExpiresAt", "mcjRole"])
      .forEach(function (key) {
        try {
          localStorage.removeItem(key);
          sessionStorage.removeItem(key);
        } catch (e) {}
      });
    if (window.MCJBossAuth && typeof window.MCJBossAuth.clearSession === "function") {
      try {
        window.MCJBossAuth.clearSession();
      } catch (e2) {}
    }
    clearCompanionSessionIfSameUser(bossUid);
  }

  function saveSession(session, remember) {
    var userData = session && session.user || {};
    var role = storageRole(userData.role || "boss");
    var cfg = cfgFor(role);
    if (!cfg) return null;
    // Persist across refresh by default. Always mirror into sessionStorage for the
    // current tab so portal-early-gate can read JWT immediately after login/register.
    // remember === false → sessionStorage only (tab session).
    var rememberMe = remember !== false;
    var stores = rememberMe ? [sessionStorage, localStorage] : [sessionStorage];
    var token = role + "_session_" + SESSION_VERSION + "_" + Date.now();
    var adminOk = isAdminRole(userData.role);
    var isCompanion = role === "companion";
    var isCs = role === "customer_service";
    var user = {
      id: userData.id || "",
      uid: userData.bossUid || userData.boss_uid || userData.uid || userData.id || "",
      bossUid: userData.bossUid || userData.boss_uid || "",
      boss_uid: userData.bossUid || userData.boss_uid || "",
      account: userData.email || "",
      user_id: userData.id || "",
      name: userData.displayName || userData.email || "",
      nickname: userData.displayName || "",
      email: userData.email || "",
      phone: userData.phone || "",
      avatarUrl: userData.avatarUrl || "",
      role: userData.role || role,
      status: userData.status || "active",
      hasBoss: !!userData.hasBoss,
      hasCompanion: !!userData.hasCompanion,
      roles: Array.isArray(userData.roles) ? userData.roles : [],
      adminRole: adminOk ? (userData.role === "super_admin" ? "super_admin" : "admin") : "",
      permissions: adminOk ? [userData.role === "super_admin" ? "super_admin" : "admin"] : []
    };

    // Companion / CS: portal-scoped JWT only — never overwrite boss mcjAuth*.
    if (isCompanion) {
      writeCompanionPortalSession(
        {
          accessToken: session.accessToken || session.token || "",
          refreshToken: session.refreshToken || "",
          expiresAt: session.expiresAt || "",
          user: user,
        },
        rememberMe
      );
      return user;
    }
    if (isCs) {
      syncPortalSessions(
        {
          accessToken: session.accessToken || session.token || "",
          refreshToken: session.refreshToken || "",
          expiresAt: session.expiresAt || "",
          user: user,
        },
        rememberMe
      );
      stores.forEach(function (store) {
        try {
          store.setItem(cfg.token, token);
          store.setItem(cfg.user, JSON.stringify(user));
        } catch (e) {}
      });
      return user;
    }

    stores.forEach(function (store) {
      try {
        store.setItem(cfg.token, token);
        store.setItem(cfg.user, JSON.stringify(user));
        // mcjRole / mcjAuth* are boss (and admin soft) markers — do not use for companion/CS.
        if (!adminOk) {
          store.setItem("mcjRole", userData.role || role);
          store.setItem("mcjCurrentUser", JSON.stringify(user));
          if (session.accessToken) store.setItem("mcjAuthAccessToken", session.accessToken);
          if (session.refreshToken) store.setItem("mcjAuthRefreshToken", session.refreshToken);
          if (session.expiresAt) store.setItem("mcjAuthExpiresAt", String(session.expiresAt));
        } else {
          store.setItem("mcjRole", userData.role || role);
          if (session.accessToken) store.setItem("mcjAdminAccessToken", session.accessToken);
          if (session.refreshToken) store.setItem("mcjAdminRefreshToken", session.refreshToken);
          if (session.expiresAt) store.setItem("mcjAdminExpiresAt", String(session.expiresAt));
        }
      } catch (e) {}
    });
    if (!rememberMe) {
      try {
        localStorage.removeItem(cfg.token);
        localStorage.removeItem(cfg.user);
        if (!adminOk) {
          localStorage.removeItem("mcjRole");
          localStorage.removeItem("mcjAuthAccessToken");
          localStorage.removeItem("mcjAuthRefreshToken");
          localStorage.removeItem("mcjAuthExpiresAt");
          localStorage.removeItem("mcjCurrentUser");
        }
      } catch (e2) {}
    }
    if (adminOk && window.MCJAdminAuthFetch && typeof window.MCJAdminAuthFetch.saveTokens === "function") {
      window.MCJAdminAuthFetch.saveTokens(session);
    }
    if (window.MCJBossAuth && typeof window.MCJBossAuth.saveSession === "function" && (role === "customer" || role === "boss")) {
      try {
        window.MCJBossAuth.saveSession(session, rememberMe);
      } catch (e) {}
    }
    // P0 portal isolation: NEVER clear companion / CS / admin when saving boss (and vice versa).
    // Each portal must be logged out explicitly. Same email may hold boss+companion after separate logins.
    return user;
  }

  /**
   * Switch UI hint only — NEVER copy boss JWT into companion session.
   * Opening 陪玩端 requires an explicit companion portal login.
   */
  function switchActivePortal(targetRole, sessionHint) {
    var want = profileRole(targetRole || "");
    if (want === "companion") {
      try {
        localStorage.setItem("mcjActivePortal", "companion");
        sessionStorage.setItem("mcjActivePortal", "companion");
      } catch (e) {}
      return {
        ok: true,
        redirect: "/companion/login/",
        role: "companion",
        requireLogin: true,
        message: "请使用陪玩账号登录陪玩端（不会沿用老板端登录态）。",
      };
    }
    var access =
      (sessionHint && (sessionHint.accessToken || sessionHint.token)) ||
      readAccessToken() ||
      "";
    if (!looksLikeJwt(access)) return { ok: false, message: "请先登录后再切换身份。" };
    var refresh = "";
    var expiresAt = "";
    try {
      refresh =
        sessionStorage.getItem("mcjAuthRefreshToken") ||
        localStorage.getItem("mcjAuthRefreshToken") ||
        "";
      expiresAt =
        sessionStorage.getItem("mcjAuthExpiresAt") ||
        localStorage.getItem("mcjAuthExpiresAt") ||
        "";
    } catch (e) {}
    var baseUser = {};
    try {
      baseUser = JSON.parse(localStorage.getItem("mcjCurrentUser") || sessionStorage.getItem("mcjCurrentUser") || "{}") || {};
    } catch (e2) {
      baseUser = {};
    }
    if (sessionHint && sessionHint.user) baseUser = Object.assign({}, baseUser, sessionHint.user);
    var session = {
      accessToken: access,
      refreshToken: refresh,
      expiresAt: expiresAt,
      user: Object.assign({}, baseUser, {
        role: "boss",
        hasBoss: true,
        hasCompanion: !!(baseUser.hasCompanion || (sessionHint && sessionHint.user && sessionHint.user.hasCompanion)),
      }),
    };
    saveSession(session, true);
    try {
      localStorage.setItem("mcjActivePortal", "boss");
      sessionStorage.setItem("mcjActivePortal", "boss");
    } catch (e4) {}
    return { ok: true, redirect: "/index.html", role: "boss" };
  }

  function showRolePickModal(body, remember) {
    return new Promise(function (resolve) {
      var existing = document.getElementById("mcjRolePickModal");
      if (existing) existing.remove();
      var mask = document.createElement("div");
      mask.id = "mcjRolePickModal";
      mask.setAttribute("role", "dialog");
      mask.style.cssText =
        "position:fixed;inset:0;z-index:99999;background:rgba(8,4,12,.72);display:flex;align-items:center;justify-content:center;padding:20px;";
      mask.innerHTML =
        '<div style="width:min(420px,100%);border-radius:18px;background:#161018;border:1px solid rgba(243,168,203,.28);padding:22px 20px;color:#fff5fa;font-family:inherit;">' +
        "<h2 style=\"margin:0 0 8px;font-size:20px;\">选择进入身份</h2>" +
        "<p style=\"margin:0 0 18px;color:#d9bfcd;font-size:14px;line-height:1.5;\">同一邮箱可拥有老板与陪玩资料。进入陪玩端需在陪玩登录页确认身份，不会从老板端自动带入。</p>" +
        '<div style="display:flex;flex-direction:column;gap:10px;">' +
        '<button type="button" data-role-pick="boss" style="padding:12px 14px;border-radius:12px;border:1px solid rgba(243,168,203,.35);background:rgba(243,168,203,.16);color:#fff5fa;font-weight:800;cursor:pointer;">进入老板端</button>' +
        '<button type="button" data-role-pick="companion" style="padding:12px 14px;border-radius:12px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.06);color:#fff5fa;font-weight:800;cursor:pointer;">去陪玩端登录</button>' +
        "</div></div>";
      document.body.appendChild(mask);
      mask.addEventListener("click", function (ev) {
        var btn = ev.target.closest("[data-role-pick]");
        if (!btn) return;
        var pick = btn.getAttribute("data-role-pick");
        mask.remove();
        resolve(pick);
      });
    }).then(function (pick) {
      if (!pick) return body;
      body._pickedRole = pick;
      if (pick === "companion") {
        // Explicit choice from login: write companion portal session from this auth,
        // without claiming boss soft session as companion auto-entry later is gated by portal blob.
        if (body.session) {
          var u = Object.assign({}, body.session.user || {}, { role: "companion" });
          writeCompanionPortalSession(
            {
              accessToken: body.session.accessToken,
              refreshToken: body.session.refreshToken,
              expiresAt: body.session.expiresAt,
              user: u,
            },
            remember !== false
          );
          body.session = Object.assign({}, body.session, { user: u });
        }
        body.redirect = "/companion/review-status";
        return body;
      }
      if (body.session) {
        var bossUser = Object.assign({}, body.session.user || {}, { role: "boss" });
        body.session = Object.assign({}, body.session, { user: bossUser });
        saveSession(body.session, remember !== false);
      }
      body.redirect = "/index.html";
      return body;
    });
  }

  async function postAuth(payload) {
    var response;
    try {
      response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
    } catch (error) {
      throw new Error(humanizeAuthError(error));
    }
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok || !body.ok) throw new Error(humanizeAuthError(body.message || "请求失败。"));
    return body;
  }

  async function loginWithDatabase(account, password, remember, options) {
    options = options || {};
    var expectedPortal = profileRole(options.expectedPortal || options.expectedRole || "");
    // Dedicated portal pages never show the boss/companion picker.
    if (!expectedPortal && !options.allowRolePick) {
      expectedPortal = inferPortalFromPage();
    }
    if (options.allowRolePick) expectedPortal = "";
    var staffPortal =
      expectedPortal === "customer_service" || expectedPortal === "admin" || expectedPortal === "super_admin";
    var body = await postAuth({
      action: "login",
      email: account,
      password: password,
      loginPortal: expectedPortal || undefined,
      role: expectedPortal || undefined,
    });
    var u = (body.session && body.session.user) || {};

    if (expectedPortal === "companion") {
      if (!(u.hasCompanion || profileRole(u.role) === "companion")) {
        throw new Error(portalDeniedMessage("companion"));
      }
      var companionUser = Object.assign({}, u, { role: "companion" });
      body.session = Object.assign({}, body.session, { user: companionUser });
      writeCompanionPortalSession(body.session, remember !== false);
      // Do not copy companion JWT into boss soft session.
      body.redirect = body.redirect || "/companion/review-status";
      body._pickedRole = "companion";
      body.needRolePick = false;
      return body;
    }
    if (expectedPortal === "customer_service") {
      if (profileRole(u.role) !== "customer_service") {
        throw new Error(portalDeniedMessage("customer_service"));
      }
      saveSession(body.session, remember !== false);
      syncPortalSessions(body.session, remember !== false);
      body.needRolePick = false;
      return body;
    }
    if (expectedPortal === "admin") {
      if (!isAdminRole(u.role)) {
        throw new Error(portalDeniedMessage("admin"));
      }
      saveSession(body.session, remember !== false);
      body.needRolePick = false;
      return body;
    }
    if (expectedPortal === "boss") {
      if (!(u.hasBoss || profileRole(u.role) === "boss")) {
        throw new Error(portalDeniedMessage("boss"));
      }
      var bossUser = Object.assign({}, u, { role: "boss" });
      body.session = Object.assign({}, body.session, { user: bossUser });
      saveSession(body.session, remember !== false);
      body.redirect = body.redirect || "/index.html";
      body._pickedRole = "boss";
      body.needRolePick = false;
      return body;
    }

    // Public unified login only: role picker when account truly has both consumer portals.
    var needPick =
      !staffPortal &&
      !!options.allowRolePick &&
      (body.needRolePick ||
        (!!u.hasBoss && !!u.hasCompanion) ||
        (Array.isArray(u.roles) && u.roles.indexOf("boss") >= 0 && u.roles.indexOf("companion") >= 0));
    if (needPick && typeof document !== "undefined") {
      body = await showRolePickModal(body, remember);
    } else {
      if (body.session && body.session.user) {
        var fallbackRole = u.hasBoss || profileRole(u.role) === "boss" ? "boss" : u.hasCompanion ? "companion" : u.role;
        body.session = Object.assign({}, body.session, {
          user: Object.assign({}, body.session.user, { role: fallbackRole }),
        });
        if (profileRole(fallbackRole) === "companion") {
          writeCompanionPortalSession(body.session, remember !== false);
          body.redirect = body.redirect || "/companion/review-status";
          body._pickedRole = "companion";
        } else {
          saveSession(body.session, remember !== false);
        }
      }
    }
    return body;
  }

  async function registerWithDatabase(payload, remember) {
    var body = await postAuth({
      action: "register",
      email: payload.email,
      password: payload.password,
      confirmPassword: payload.confirmPassword || payload.confirm_password || "",
      displayName: payload.displayName || payload.nickname || "",
      phone: payload.phone || "",
      registerToken: payload.registerToken || payload.emailOtpToken || "",
      role: "boss",
    });
    saveSession(body.session, remember !== false);
    return body;
  }

  function syncPortalSessions(session, remember) {
    var user = (session && session.user) || {};
    var role = profileRole(user.role || "");
    var token = (session && (session.accessToken || session.token || session.access_token)) || "";
    if (!token && role !== "companion") return;
    if (role === "customer_service") {
      if (window.MCJServiceAuth && typeof window.MCJServiceAuth.saveSession === "function") {
        window.MCJServiceAuth.saveSession(
          {
            token: token,
            accessToken: token,
            refreshToken: session.refreshToken || session.refresh_token || "",
            expiresAt: session.expiresAt || session.expires_at || "",
            user: user,
          },
          remember !== false
        );
      } else {
        var cs = {
          token: token,
          accessToken: token,
          refreshToken: session.refreshToken || session.refresh_token || "",
          expiresAt: session.expiresAt || session.expires_at || "",
          user: user,
          remember: remember !== false,
          portal: "customer_service",
        };
        localStorage.setItem("mcjServiceSession", JSON.stringify(cs));
        sessionStorage.setItem("mcjServiceSession", JSON.stringify(cs));
        var soft = "customer_service_session_" + SESSION_VERSION + "_" + Date.now();
        localStorage.setItem("customerServiceAuthToken", soft);
        sessionStorage.setItem("customerServiceAuthToken", soft);
        localStorage.setItem("customerServiceUser", JSON.stringify(Object.assign({}, user, { role: "customer_service" })));
        sessionStorage.setItem("customerServiceUser", JSON.stringify(Object.assign({}, user, { role: "customer_service" })));
      }
    }
    if (role === "companion") {
      writeCompanionPortalSession(session, remember !== false);
    }
  }

  function showAuthBootOverlay(message) {
    try {
      var existing = document.getElementById("mcjAuthBootOverlay");
      if (existing) {
        var msg = existing.querySelector("[data-mcj-auth-boot-msg]");
        if (msg) msg.textContent = message || "正在登录…";
        return existing;
      }
      var el = document.createElement("div");
      el.id = "mcjAuthBootOverlay";
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
        "background:rgba(18,10,16,.72);color:#fff;font:600 15px/1.4 system-ui,sans-serif;backdrop-filter:blur(2px)";
      el.innerHTML = '<div data-mcj-auth-boot-msg style="padding:14px 18px;border-radius:12px;background:rgba(0,0,0,.45)">' +
        String(message || "正在登录…").replace(/[<>]/g, "") +
        "</div>";
      (document.body || document.documentElement).appendChild(el);
      return el;
    } catch (e) {
      return null;
    }
  }

  function hideAuthBootOverlay() {
    try {
      var el = document.getElementById("mcjAuthBootOverlay");
      if (el && el.parentNode) el.parentNode.removeChild(el);
    } catch (e) {}
  }

  function sessionReadable() {
    try {
      var a =
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        "";
      if (a && a.split(".").length === 3) return true;
      var pw = JSON.parse(
        localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "null"
      );
      var pt = pw && (pw.token || pw.accessToken);
      if (pt && String(pt).split(".").length === 3) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  function afterAuthSuccess(result, options) {
    options = options || {};
    if (window.__mcjAfterAuthBusy) return;
    window.__mcjAfterAuthBusy = true;
    showAuthBootOverlay("正在登录…");
    // Session must already be saved by caller; re-confirm dual-write before navigate.
    var picked = result && result._pickedRole;
    if (result && result.session) {
      try {
        if (profileRole(picked) === "companion" || profileRole((result.session.user || {}).role) === "companion") {
          writeCompanionPortalSession(result.session, options.remember !== false);
        } else {
          saveSession(result.session, options.remember !== false);
        }
      } catch (e) {}
    }
    if (!sessionReadable()) {
      window.__mcjAfterAuthBusy = false;
      hideAuthBootOverlay();
      setLoginMessage(document.body, "登录态保存失败，请重试。");
      return;
    }
    closeLoginModal();
    refreshAuthUi();
    if (window.MCJBossHeader && typeof window.MCJBossHeader.sync === "function") {
      window.MCJBossHeader.sync();
    }
    if (window.MCJBossHeader && typeof window.MCJBossHeader.refreshNotifications === "function") {
      window.MCJBossHeader.refreshNotifications();
    }
    var role =
      profileRole(picked) ||
      (result.session && result.session.user && result.session.user.role) ||
      "boss";
    if (profileRole(role) !== "companion") {
      syncPortalSessions(result.session, options.remember !== false);
    }
    var pending = sessionStorage.getItem("mcjAfterLoginRedirect") || localStorage.getItem("mcjAfterLoginRedirect");
    try {
      sessionStorage.removeItem("mcjAfterLoginRedirect");
      localStorage.removeItem("mcjAfterLoginRedirect");
    } catch (e2) {}
    var roleHome = result.redirect || routeFor(role);
    // Boss may resume a pending page; other roles always land on their portal.
    var redirect = profileRole(role) === "boss" && pending ? pending : roleHome;
    var here = String(location.pathname || "").replace(/\/+$/, "") || "/";
    var dest = String(redirect || "/").replace(/\/+$/, "") || "/";
    // Never reopen login/register after success (clear #login / #register).
    try {
      if (/^#(login|register)$/i.test(location.hash || "")) {
        history.replaceState(null, "", location.pathname + location.search);
      }
    } catch (e) {}
    // Yield one frame so storage flush is visible to the next document before navigate.
    var go = function () {
      if (!sessionReadable()) {
        window.__mcjAfterAuthBusy = false;
        hideAuthBootOverlay();
        setLoginMessage(document.body, "登录态保存失败，请重试。");
        return;
      }
      var destPath = String(dest || "/").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
      var herePath = String(here || "/").split("?")[0].split("#")[0].replace(/\/+$/, "") || "/";
      var sameDoc =
        destPath === herePath ||
        destPath + ".html" === herePath ||
        herePath + ".html" === destPath ||
        (herePath === "/" && /index\.html$/i.test(destPath)) ||
        (destPath === "/" && /index\.html$/i.test(herePath));
      if (!sameDoc) {
        location.href = String(redirect || "/").replace(/#(login|register)$/i, "");
        return;
      }
      // Same document: do NOT location.replace(self) — that re-booted auth listeners and
      // caused Maximum call stack / login flicker loops on boss homepage.
      hideAuthBootOverlay();
      window.__mcjAfterAuthBusy = false;
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(function () {
        setTimeout(go, 0);
      });
    } else {
      setTimeout(go, 0);
    }
  }

  function loginWithPassword() { return { ok: false, message: "请使用数据库账号邮箱登录。" }; }
  /** @deprecated Prefer loginWithDatabase — kept so legacy callers do not fake-login. */
  function login() {
    return null;
  }

  /**
   * Portal login: one Supabase /api/auth call, enforce expected role, then redirect.
   * expectedRole: boss | companion | customer_service | admin
   */
  async function loginPortal(expectedRole, account, password, remember) {
    var want = profileRole(expectedRole);
    var body = await loginWithDatabase(account, password, remember !== false, { expectedPortal: want });
    var role = (body.session && body.session.user && body.session.user.role) || "";
    var got = profileRole(role);
    var u = (body.session && body.session.user) || {};
    if (want === "admin") {
      if (!isAdminRole(role)) {
        logout("admin");
        throw new Error(portalDeniedMessage("admin"));
      }
    } else if (want === "companion") {
      if (!(u.hasCompanion || got === "companion")) {
        clearCompanionPortalSession();
        throw new Error(portalDeniedMessage("companion"));
      }
    } else if (want === "boss") {
      if (!(u.hasBoss || got === "boss")) {
        logout("boss");
        throw new Error(portalDeniedMessage("boss"));
      }
    } else if (got !== want) {
      logout(got);
      logout(want);
      throw new Error(portalDeniedMessage(want) || "账号角色与当前入口不匹配。");
    }
    if (want === "companion") {
      syncPortalSessions(body.session, remember !== false);
    } else if (want !== "boss") {
      syncPortalSessions(body.session, remember !== false);
    }
    return body;
  }
  function user(role) { return readUser(role); }
  function purgeUnscopedCompanionApplyDraft() {
    try {
      localStorage.removeItem("mcjCompanionApplicationDraft.v1");
      sessionStorage.removeItem("mcjCompanionApplicationDraft.v1");
      localStorage.removeItem("mcjCompanionApplicantId.v1");
      sessionStorage.removeItem("mcjCompanionApplicantId.v1");
    } catch (e) {}
    if (window.MCJCompanionApplyDraft && typeof window.MCJCompanionApplyDraft.purgeUnscopedDraftKeys === "function") {
      try {
        window.MCJCompanionApplyDraft.purgeUnscopedDraftKeys();
      } catch (e2) {}
    }
  }
  function logout(role) {
    var storageKey = storageRole(role);
    if (!role) {
      clearCompanionPortalSession();
      clearBossPortalSession();
      purgeUnscopedCompanionApplyDraft();
      if (window.MCJServiceAuth && typeof window.MCJServiceAuth.clearSession === "function") {
        window.MCJServiceAuth.clearSession("logout");
      } else {
        ["mcjServiceSession", "customerServiceAuthToken", "customerServiceUser"].forEach(function (k) {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
      }
      clearAdminClientSession();
      refreshAuthUi();
      return;
    }
    if (storageKey === "companion") {
      clearCompanionPortalSession();
      purgeUnscopedCompanionApplyDraft();
      refreshAuthUi();
      return;
    }
    if (storageKey === "customer_service") {
      if (window.MCJServiceAuth && typeof window.MCJServiceAuth.clearSession === "function") {
        window.MCJServiceAuth.clearSession("logout");
      } else {
        ["mcjServiceSession", "customerServiceAuthToken", "customerServiceUser"].forEach(function (k) {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
      }
      refreshAuthUi();
      return;
    }
    if (storageKey === "admin") {
      clearAdminClientSession();
      refreshAuthUi();
      return;
    }
    if (storageKey === "customer" || role === "boss") {
      clearBossPortalSession();
      purgeUnscopedCompanionApplyDraft();
      refreshAuthUi();
      return;
    }
    var cfg = cfgFor(role);
    if (cfg) {
      localStorage.removeItem(cfg.token);
      localStorage.removeItem(cfg.user);
      sessionStorage.removeItem(cfg.token);
      sessionStorage.removeItem(cfg.user);
    }
    refreshAuthUi();
  }
  function hasPortalSession(role) {
    var key = profileRole(role);
    if (key === "customer_service") {
      if (window.MCJServiceAuth && typeof window.MCJServiceAuth.hasSession === "function") {
        if (window.MCJServiceAuth.hasSession()) return true;
      }
      try {
        var cs = JSON.parse(localStorage.getItem("mcjServiceSession") || sessionStorage.getItem("mcjServiceSession") || "null");
        var csTok = cs && (cs.token || cs.accessToken);
        if (cs && (looksLikeJwt(csTok) || cs.refreshToken)) return true;
      } catch (e) {}
      return false;
    }
    if (key === "companion") {
      try {
        var pw = JSON.parse(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "null");
        var soft = localStorage.getItem("companionAuthToken") || sessionStorage.getItem("companionAuthToken") || "";
        var access = pw && (pw.token || pw.accessToken);
        var softOk = String(soft).indexOf("companion_session_") === 0;
        if (!softOk) return false;
        if (!(looksLikeJwt(access) || (pw && pw.refreshToken))) return false;
        var pwRole = pw && pw.user && pw.user.role;
        if (pwRole && profileRole(pwRole) !== "companion") return false;
        return true;
      } catch (e2) {
        return false;
      }
    }
    if (key === "admin") return isLogged("admin");
    return isLogged(role);
  }

  /**
   * Clear soft sessions of OTHER portals. Boss↔companion coexist — do not wipe the twin.
   * Used by callers that previously expected exclusive soft sessions.
   */
  function clearOtherRoleSessions(keepRole) {
    var keep = profileRole(keepRole || "");
    if (keep !== "companion" && keep !== "boss" && keep !== "customer") {
      // Admin / CS login: do not steal boss/companion coexistence unless explicitly logging those out.
    }
    if (keep === "companion") {
      // Companion login must NOT clear boss.
      return;
    }
    if (keep === "boss" || keep === "customer") {
      // Boss login must NOT clear companion.
      return;
    }
    if (keep === "customer_service") {
      // CS must not inherit/clear boss+companion JWT stores.
      return;
    }
    if (keep === "admin") {
      return;
    }
  }

  function clearSharedAuthMirrors() {
    // Deprecated no-op for portal isolation: shared mcjAuth* belongs to boss only.
    // Companion/CS must not wipe boss JWT when claiming their own portal session.
  }

  function denyUnauthed(loginHref, returnTo) {
    try {
      document.documentElement.setAttribute("data-mcj-auth-gate", "1");
      document.documentElement.style.visibility = "hidden";
      if (document.body) document.body.innerHTML = "";
    } catch (e) {}
    if (returnTo) sessionStorage.setItem("mcjAfterLoginRedirect", returnTo);
    location.replace(loginHref);
    return false;
  }

  function returnPath() {
    return String(location.pathname || "/") + String(location.search || "") + String(location.hash || "");
  }

  function bootRouteProtection() {
    var p = path();
    if (isAdminLoginPath()) return true;
    if (/\/customer-service\/login/i.test(p)) {
      // Login page must not enter redirect races. Only reveal; login script owns submit→dashboard.
      try {
        document.documentElement.removeAttribute("data-mcj-auth-gate");
        document.documentElement.style.visibility = "";
        document.documentElement.setAttribute("data-mcj-service-auth", "ready");
      } catch (e) {}
      return true;
    }
    if (/\/companion\/login/i.test(p)) return true;
    if (/^\/?$|\/index\.html$/i.test(p) || /\/login\.html$/i.test(p)) return true;

    if (/\/admin\.html$/i.test(p) || /\/admin-(dashboard|center|audit)\.html$/i.test(p) || (/\/admin(\/|$)/i.test(p) && !isAdminLoginPath())) {
      if (!isLogged("admin")) {
        clearAdminClientSession();
        return denyUnauthed("/admin/login/", returnPath());
      }
      return true;
    }

    if (/\/customer-service(\/|$)/i.test(p)) {
      // Never sync-redirect before session restore/refresh finishes.
      if (window.MCJServiceAuth && typeof window.MCJServiceAuth.guardCustomerServicePages === "function") {
        window.MCJServiceAuth.guardCustomerServicePages();
        return true;
      }
      if (!hasPortalSession("customer_service")) return denyUnauthed("/customer-service/login/", returnPath());
      return true;
    }

    if (/\/companion(\/|$)/i.test(p)) {
      if (!hasPortalSession("companion")) return denyUnauthed("/companion/login/", returnPath());
      return true;
    }

    if (/\/(mine|orders|support|recharge|points|messages|favorites|payment-confirm|order-confirm|gifts)\.html$/i.test(p)) {
      // Soft / refresh alone insufficient for sync deny — wait restoreSession before claiming guest.
      // profile.html is public companion detail and stays ungated.
      if (hasValidBossAccessToken()) return true;
      var canRestore = false;
      try {
        canRestore = !!(
          sessionStorage.getItem("mcjAuthRefreshToken") ||
          localStorage.getItem("mcjAuthRefreshToken") ||
          (window.MCJBossAuth &&
            typeof window.MCJBossAuth.canRestoreSession === "function" &&
            window.MCJBossAuth.canRestoreSession())
        );
      } catch (eRest) {}
      if (!canRestore) {
        wipeBossGuestArtifacts();
        return denyUnauthed("/login.html", returnPath());
      }
      try {
        document.documentElement.setAttribute("data-mcj-auth-gate", "pending");
        document.documentElement.style.visibility = "hidden";
      } catch (eHide) {}
      var finishBossGate = function (ok) {
        try {
          document.documentElement.removeAttribute("data-mcj-auth-gate");
          document.documentElement.style.visibility = "";
        } catch (eShow) {}
        if (!ok) {
          wipeBossGuestArtifacts();
          denyUnauthed("/login.html", returnPath());
        }
      };
      var safety = setTimeout(function () {
        finishBossGate(hasValidBossAccessToken());
      }, 8000);
      // role-gates often loads before boss-auth-session.js — wait for SoT then ensureSession.
      (function waitBossAuth(tries) {
        if (window.MCJBossAuth && typeof window.MCJBossAuth.ensureSession === "function") {
          window.MCJBossAuth.ensureSession()
            .catch(function () {
              return null;
            })
            .then(function () {
              clearTimeout(safety);
              finishBossGate(hasValidBossAccessToken());
            });
          return;
        }
        if (tries >= 40) {
          clearTimeout(safety);
          finishBossGate(hasValidBossAccessToken());
          return;
        }
        setTimeout(function () {
          waitBossAuth(tries + 1);
        }, 50);
      })(0);
      return true;
    }
    return true;
  }

  function guard(role) {
    var cfg = cfgFor(role);
    if (!cfg) return true;
    if (storageRole(role) === "admin") {
      if (isAdminLoginPath()) return true;
      var p = path();
      if (
        /\/admin\.html$/i.test(p) ||
        /\/admin-(dashboard|center|audit)\.html$/i.test(p) ||
        (/\/admin(\/|$)/i.test(p) && !isAdminLoginPath())
      ) {
        if (!isLogged("admin")) {
          clearAdminClientSession();
          return denyUnauthed(cfg.login || "/admin/login/", returnPath());
        }
      }
      return true;
    }
    if (storageRole(role) === "customer" || role === "boss") {
      if (/\/(mine|orders|support|recharge|points|messages|favorites|payment-confirm|order-confirm|gifts)\.html$/i.test(path())) {
        if (hasValidBossAccessToken()) return true;
        var canRestoreGuard = false;
        try {
          canRestoreGuard = !!(
            sessionStorage.getItem("mcjAuthRefreshToken") ||
            localStorage.getItem("mcjAuthRefreshToken") ||
            (window.MCJBossAuth &&
              typeof window.MCJBossAuth.canRestoreSession === "function" &&
              window.MCJBossAuth.canRestoreSession())
          );
        } catch (eG) {}
        if (!canRestoreGuard) {
          wipeBossGuestArtifacts();
          return denyUnauthed("/login.html", returnPath());
        }
        // Defer decision to bootRouteProtection / MCJBossAuth.ensureSession — do not flash guest.
        return true;
      }
    }
    if (storageRole(role) === "customer_service") {
      if (window.MCJServiceAuth && typeof window.MCJServiceAuth.guardCustomerServicePages === "function") {
        window.MCJServiceAuth.guardCustomerServicePages();
        return true;
      }
      if (!hasPortalSession("customer_service")) {
        return denyUnauthed("/customer-service/login/", returnPath());
      }
      return true;
    }
    if (storageRole(role) === "companion") {
      if (!hasPortalSession("companion")) {
        return denyUnauthed("/companion/login/", returnPath());
      }
      return true;
    }
    if (!isAllowed(role)) {
      location.replace(cfg.login);
      return false;
    }
    return true;
  }

  function bindLoginButtons() {
    document.addEventListener("click", function (event) {
      var switchBtn = event.target && event.target.closest && event.target.closest("[data-switch-auth]");
      if (switchBtn) {
        var mode = switchBtn.getAttribute("data-switch-auth") === "register" ? "register" : "login";
        var body = document.getElementById("modalBody");
        if (body && typeof window.bossLoginHtml === "function") {
          event.preventDefault();
          body.innerHTML = window.bossLoginHtml(mode);
          if (window.MCJAuthShell && typeof window.MCJAuthShell.prepareAuthForm === "function") {
            window.MCJAuthShell.prepareAuthForm(body.querySelector(".boss-login-modal") || body, { clearAccount: true });
          } else if (window.MCJModal && typeof window.MCJModal.prepareAuthSurface === "function") {
            window.MCJModal.prepareAuthSurface(body.querySelector(".boss-login-modal") || body, { clearAccount: true });
          }
        }
        return;
      }

      var tabBtn = event.target && event.target.closest && event.target.closest("[data-login-tab]");
      if (tabBtn) {
        event.preventDefault();
        var tab = tabBtn.getAttribute("data-login-tab") || "otp";
        var modal = tabBtn.closest(".boss-login-modal") || document;
        modal.querySelectorAll("[data-login-tab]").forEach(function (el) {
          el.classList.toggle("active", el === tabBtn);
        });
        modal.querySelectorAll("[data-login-panel]").forEach(function (panel) {
          var key = panel.getAttribute("data-login-panel");
          if (key === "register") return;
          panel.classList.toggle("active", key === tab);
        });
        // Always wipe OTP / password residual when switching login method.
        if (window.MCJAuthShell && typeof window.MCJAuthShell.clearAuthFields === "function") {
          window.MCJAuthShell.clearAuthFields(modal, {
            clearCode: true,
            clearPassword: true,
            clearAccount: false,
          });
        } else {
          modal.querySelectorAll("#loginOtpCode, #loginCode, #loginGmailCode, [data-auth-code], input[autocomplete='one-time-code'], input[type='password']").forEach(function (el) {
            try {
              el.value = "";
              el.defaultValue = "";
              el.removeAttribute("value");
            } catch (e) {}
          });
          modal.querySelectorAll("[data-login-error], #loginState").forEach(function (box) {
            box.textContent = "";
          });
        }
        return;
      }

      var sendOtpBtn = event.target && event.target.closest && event.target.closest("[data-send-login-otp]");
      if (sendOtpBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (sendOtpBtn.disabled) return;
        var otpEmail = fieldValue(["loginOtpEmail", "loginGmail", "loginEmail", "email"]).trim().toLowerCase();
        if (!otpEmail || !/^\S+@\S+\.\S+$/.test(otpEmail)) {
          setLoginMessage(sendOtpBtn, "请输入有效邮箱。");
          return;
        }
        var role = sendOtpBtn.getAttribute("data-login-role") || "boss";
        sendOtpBtn.disabled = true;
        var oldSend = sendOtpBtn.textContent;
        sendOtpBtn.textContent = "发送中…";
        fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ action: "send_login_otp", email: otpEmail, role: role }),
        })
          .then(function (r) {
            return r.json().then(function (j) {
              if (!r.ok || j.ok === false) throw new Error((j && j.message) || "发送失败");
              return j;
            });
          })
          .then(function (j) {
            var tip = j.message || "验证码已发送";
            if (j.devCode) tip += "（测试 " + j.devCode + "）";
            setLoginMessage(sendOtpBtn, tip);
            var left = Number(j.retryAfterSec) || 60;
            sendOtpBtn.textContent = left + "s";
            var timer = setInterval(function () {
              left -= 1;
              if (left <= 0) {
                clearInterval(timer);
                sendOtpBtn.disabled = false;
                sendOtpBtn.textContent = oldSend || "获取验证码";
              } else {
                sendOtpBtn.textContent = left + "s";
              }
            }, 1000);
          })
          .catch(function (err) {
            sendOtpBtn.disabled = false;
            sendOtpBtn.textContent = oldSend || "获取验证码";
            setLoginMessage(sendOtpBtn, humanizeAuthError(err));
          });
        return;
      }

      var sendRegOtpBtn = event.target && event.target.closest && event.target.closest("[data-send-register-otp]");
      if (sendRegOtpBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (sendRegOtpBtn.disabled) return;
        var regEmail = fieldValue(["registerEmail", "loginGmail", "loginEmail", "email"]).trim().toLowerCase();
        if (!regEmail || !/^\S+@\S+\.\S+$/.test(regEmail)) {
          setLoginMessage(sendRegOtpBtn, "请输入有效邮箱。");
          return;
        }
        var regRole = sendRegOtpBtn.getAttribute("data-register-role") || "boss";
        sendRegOtpBtn.disabled = true;
        var oldRegSend = sendRegOtpBtn.textContent;
        sendRegOtpBtn.textContent = "发送中…";
        // Changing email invalidates prior verification.
        var tokenEl = document.getElementById("registerEmailToken");
        if (tokenEl) tokenEl.value = "";
        var regBtnGate = document.querySelector("[data-register-confirm]");
        if (regBtnGate) regBtnGate.disabled = true;
        var hint = document.querySelector("[data-register-verified-hint]");
        if (hint) hint.textContent = "请先完成邮箱验证，验证成功后才能注册。";
        fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ action: "send_register_otp", email: regEmail, role: regRole }),
        })
          .then(function (r) {
            return r.json().then(function (j) {
              if (!r.ok || j.ok === false) throw new Error((j && j.message) || "发送失败");
              return j;
            });
          })
          .then(function (j) {
            var tip = j.message || "验证码已发送";
            if (j.devCode) tip += "（测试 " + j.devCode + "）";
            setLoginMessage(sendRegOtpBtn, tip);
            var left = Number(j.retryAfterSec) || 60;
            sendRegOtpBtn.textContent = left + "s";
            var timer = setInterval(function () {
              left -= 1;
              if (left <= 0) {
                clearInterval(timer);
                sendRegOtpBtn.disabled = false;
                sendRegOtpBtn.textContent = oldRegSend || "获取验证码";
              } else {
                sendRegOtpBtn.textContent = left + "s";
              }
            }, 1000);
          })
          .catch(function (err) {
            sendRegOtpBtn.disabled = false;
            sendRegOtpBtn.textContent = oldRegSend || "获取验证码";
            setLoginMessage(sendRegOtpBtn, humanizeAuthError(err));
          });
        return;
      }

      var verifyRegOtpBtn = event.target && event.target.closest && event.target.closest("[data-verify-register-otp]");
      if (verifyRegOtpBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (verifyRegOtpBtn.disabled) return;
        var vEmail = fieldValue(["registerEmail", "loginGmail", "loginEmail", "email"]).trim().toLowerCase();
        var vCode = fieldValue(["registerOtpCode", "otp", "code"]);
        if (!vEmail || !/^\S+@\S+\.\S+$/.test(vEmail)) {
          setLoginMessage(verifyRegOtpBtn, "请输入有效邮箱。");
          return;
        }
        if (!/^\d{6}$/.test(String(vCode || "").trim())) {
          setLoginMessage(verifyRegOtpBtn, "请输入 6 位邮箱验证码。");
          return;
        }
        var vRole = verifyRegOtpBtn.getAttribute("data-register-role") || "boss";
        verifyRegOtpBtn.disabled = true;
        var oldVerify = verifyRegOtpBtn.textContent;
        verifyRegOtpBtn.textContent = "验证中…";
        fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ action: "verify_register_otp", email: vEmail, code: String(vCode).trim(), role: vRole }),
        })
          .then(function (r) {
            return r.json().then(function (j) {
              if (!r.ok || j.ok === false) throw new Error((j && j.message) || "验证失败");
              return j;
            });
          })
          .then(function (j) {
            var tok = document.getElementById("registerEmailToken");
            if (tok) tok.value = j.registerToken || "";
            var regConfirm = document.querySelector("[data-register-confirm]");
            if (regConfirm) regConfirm.disabled = !(j.registerToken);
            var verifiedHint = document.querySelector("[data-register-verified-hint]");
            if (verifiedHint) verifiedHint.textContent = "邮箱已验证 · " + (j.emailMasked || vEmail) + "，请设置密码并注册。";
            var codeInput = document.getElementById("registerOtpCode");
            if (codeInput) {
              try { codeInput.value = ""; } catch (e) {}
            }
            setLoginMessage(verifyRegOtpBtn, j.message || "邮箱已验证");
            verifyRegOtpBtn.disabled = false;
            verifyRegOtpBtn.textContent = oldVerify || "验证邮箱";
          })
          .catch(function (err) {
            var tokFail = document.getElementById("registerEmailToken");
            if (tokFail) tokFail.value = "";
            var regFail = document.querySelector("[data-register-confirm]");
            if (regFail) regFail.disabled = true;
            verifyRegOtpBtn.disabled = false;
            verifyRegOtpBtn.textContent = oldVerify || "验证邮箱";
            setLoginMessage(verifyRegOtpBtn, humanizeAuthError(err));
          });
        return;
      }

      var registerBtn = event.target && event.target.closest && event.target.closest("[data-register-confirm]");
      if (registerBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        var nickname = fieldValue(["registerNickname", "displayName", "nickname"]).trim();
        var email = fieldValue(["registerEmail", "loginGmail", "loginEmail", "email"]).trim();
        var password = fieldValue(["registerPassword", "loginGmailCode", "loginPassword", "password"]);
        var confirmPassword = fieldValue(["registerPasswordConfirm", "confirmPassword"]);
        var registerToken = fieldValue(["registerEmailToken", "registerToken"]);
        if (!nickname) { setLoginMessage(registerBtn, "请输入昵称。"); return; }
        if (!email) { setLoginMessage(registerBtn, "请输入邮箱。"); return; }
        if (!registerToken) { setLoginMessage(registerBtn, "请先完成邮箱验证。"); return; }
        if (!password) { setLoginMessage(registerBtn, "请设置登录密码。"); return; }
        if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
          setLoginMessage(registerBtn, "密码至少 8 位，且需同时包含字母和数字。");
          return;
        }
        if (password !== confirmPassword) { setLoginMessage(registerBtn, "两次输入的密码不一致。"); return; }
        if (registerBtn.disabled) return;
        registerBtn.disabled = true;
        var oldReg = registerBtn.textContent;
        registerBtn.textContent = "注册中...";
        registerWithDatabase({
          email: email,
          password: password,
          confirmPassword: confirmPassword,
          displayName: nickname,
          registerToken: registerToken,
        }, true)
          .then(function (result) {
            afterAuthSuccess(result, { remember: true });
          })
          .catch(function (error) {
            setLoginMessage(registerBtn, humanizeAuthError(error));
            registerBtn.disabled = false;
            registerBtn.textContent = oldReg || "注册";
          })
          .finally(function () {
            /* keep disabled on success (modal closes); restore on failure above */
            if (document.querySelector("[data-register-confirm]") === registerBtn && registerBtn.isConnected) {
              /* no-op: failure path already restored */
            }
          });
        return;
      }

      var target = event.target && event.target.closest && event.target.closest("[data-login-confirm]");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      var method = String(target.getAttribute("data-login-method") || "email").toLowerCase();
      if (method === "otp") {
        var otpAccount = fieldValue(["loginOtpEmail", "loginGmail", "loginEmail", "email"]).trim().toLowerCase();
        var otpCode = fieldValue(["loginOtpCode", "loginCode", "otp"]);
        if (!otpAccount || !otpCode) { setLoginMessage(target, "请输入邮箱和验证码。"); return; }
        if (target.disabled) return;
        target.disabled = true;
        var oldOtpText = target.textContent;
        target.textContent = "登录中...";
        var otpPortal =
          profileRole(target.getAttribute("data-login-portal") || target.getAttribute("data-login-role") || "") ||
          inferPortalFromPage() ||
          "boss";
        var allowPick = String(target.getAttribute("data-login-portal") || "").toLowerCase() === "public";
        fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            action: "login_with_otp",
            email: otpAccount,
            code: otpCode,
            role: allowPick ? "boss" : otpPortal,
            loginPortal: allowPick ? undefined : otpPortal,
          }),
        })
          .then(function (r) {
            return r.json().then(function (j) {
              if (!r.ok || j.ok === false) throw new Error((j && j.message) || "登录失败");
              return j;
            });
          })
          .then(async function (result) {
            var u = (result.session && result.session.user) || {};
            if (!allowPick) {
              if (otpPortal === "companion") {
                if (!(u.hasCompanion || profileRole(u.role) === "companion")) throw new Error(portalDeniedMessage("companion"));
                result.session = Object.assign({}, result.session, { user: Object.assign({}, u, { role: "companion" }) });
                writeCompanionPortalSession(result.session, true);
                result._pickedRole = "companion";
                result.redirect = result.redirect || "/companion/review-status";
              } else if (otpPortal === "boss") {
                if (!(u.hasBoss || profileRole(u.role) === "boss")) throw new Error(portalDeniedMessage("boss"));
                result.session = Object.assign({}, result.session, { user: Object.assign({}, u, { role: "boss" }) });
                saveSession(result.session, true);
                result._pickedRole = "boss";
              } else {
                saveSession(result.session, true);
              }
            } else if (result.needRolePick && u.hasBoss && u.hasCompanion) {
              result = await showRolePickModal(result, true);
            } else {
              saveSession(result.session, true);
            }
            afterAuthSuccess(result, { remember: true });
          })
          .catch(function (error) {
            setLoginMessage(target, humanizeAuthError(error));
          })
          .finally(function () {
            target.disabled = false;
            target.textContent = oldOtpText || "验证码登录";
          });
        return;
      }
      var account = fieldValue(["loginGmail", "loginEmail", "adminEmail", "email"]);
      var passwordLogin = fieldValue(["loginGmailCode", "loginPassword", "adminPassword", "password"]);
      if (!account || !passwordLogin) { setLoginMessage(target, "请输入邮箱和密码。"); return; }
      if (target.disabled) return;
      target.disabled = true;
      var oldText = target.textContent;
      target.textContent = "登录中...";
      var passPortalAttr = String(target.getAttribute("data-login-portal") || "").toLowerCase();
      var passOpts =
        passPortalAttr === "public"
          ? { allowRolePick: true }
          : { expectedPortal: profileRole(passPortalAttr || inferPortalFromPage() || "boss") };
      loginWithDatabase(account, passwordLogin, true, passOpts)
        .then(function (result) {
          afterAuthSuccess(result, { remember: true });
        })
        .catch(function (error) {
          setLoginMessage(target, humanizeAuthError(error));
        })
        .finally(function () {
          target.disabled = false;
          target.textContent = oldText || "登录";
        });
    }, true);
  }

  window.MCJRoleGate = {
    routes: routes,
    guard: guard,
    login: login,
    loginWithPassword: loginWithPassword,
    loginWithDatabase: loginWithDatabase,
    loginPortal: loginPortal,
    registerWithDatabase: registerWithDatabase,
    saveSession: saveSession,
    switchActivePortal: switchActivePortal,
    showRolePickModal: showRolePickModal,
    inferPortalFromPage: inferPortalFromPage,
    portalDeniedMessage: portalDeniedMessage,
    logout: logout,
    isLogged: isLogged,
    user: user,
    isAdminRole: isAdminRole,
    routeFor: routeFor,
    profileRole: profileRole,
    humanizeAuthError: humanizeAuthError,
    syncPortalSessions: syncPortalSessions,
    hasPortalSession: hasPortalSession,
    clearOtherRoleSessions: clearOtherRoleSessions,
    clearSharedAuthMirrors: clearSharedAuthMirrors,
    clearCompanionPortalSession: clearCompanionPortalSession,
    clearCompanionSessionIfSameUser: clearCompanionSessionIfSameUser,
    clearBossPortalSession: clearBossPortalSession,
    writeCompanionPortalSession: writeCompanionPortalSession,
  };

  (function loadBossHeader() {
    if (window.__MCJBossHeaderScript || window.__MCJBossHeaderLoaded || window.MCJBossHeader) return;
    var p = String(location.pathname || "").replace(/\\/g, "/");
    if (/\/admin(\/|\.html|$)/i.test(p) || /\/companion\//i.test(p) || /\/customer-service(\/|\.html|$)/i.test(p)) return;
    window.__MCJBossHeaderScript = true;
    if (!window.__MCJLaunchFreezeScript) {
      window.__MCJLaunchFreezeScript = true;
      var f = document.createElement("script");
      f.src = "/src/launch-feature-freeze.js";
      document.head.appendChild(f);
    }
    var s = document.createElement("script");
    s.src = "/src/boss-header.js";
    s.defer = true;
    document.head.appendChild(s);
  })();

  bindLoginButtons();
  bootRouteProtection();

  // Guest clicks to auth-required boss pages → login.html (covers homepage quick entries / bottom nav).
  document.addEventListener(
    "click",
    function (event) {
      var a = event.target && event.target.closest && event.target.closest("a[href]");
      if (!a) return;
      var href = String(a.getAttribute("href") || "");
      if (!/mine\.html|orders\.html|support\.html|recharge\.html|points\.html|messages\.html|favorites\.html|profile\.html|gifts\.html/i.test(href)) return;
      if (hasValidBossAccessToken()) return;
      event.preventDefault();
      wipeBossGuestArtifacts();
      try {
        var abs = new URL(href, location.href);
        sessionStorage.setItem("mcjAfterLoginRedirect", abs.pathname + abs.search + abs.hash);
      } catch (e) {
        sessionStorage.setItem("mcjAfterLoginRedirect", href);
      }
      location.href = "/login.html";
    },
    true
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshAuthUi);
  } else {
    refreshAuthUi();
  }
})();
