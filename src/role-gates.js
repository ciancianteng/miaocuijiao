(function () {
  var SESSION_VERSION = "v4";
  var routes = {
    customer: { token: "customerAuthToken", user: "customerUser", login: "/login.html", allowed: [/\/index\.html$/, /\/$/, /\/login\.html$/, /\/mine\.html$/, /\/companion-center\.html$/, /\/profile\.html$/, /\/orders\.html$/, /\/messages\.html$/, /\/custom-order\.html$/, /\/order-confirm\.html$/, /\/payment-confirm\.html$/, /\/recharge\.html$/, /\/gifts\.html$/, /\/support\.html$/, /\/favorites\.html$/, /\/leaderboard\.html$/, /\/ranking\.html$/, /\/more-gameplays\.html$/, /\/gameplay-product\.html$/, /\/fixed-order\.html$/, /\/team-lobby\.html$/, /\/companion-apply\.html$/, /\/activities\.html$/] },
    boss: { token: "customerAuthToken", user: "customerUser", login: "/login.html", allowed: [/\/index\.html$/, /\/$/, /\/login\.html$/, /\/mine\.html$/, /\/companion-center\.html$/, /\/profile\.html$/, /\/orders\.html$/, /\/messages\.html$/, /\/custom-order\.html$/, /\/order-confirm\.html$/, /\/payment-confirm\.html$/, /\/recharge\.html$/, /\/gifts\.html$/, /\/support\.html$/, /\/favorites\.html$/, /\/leaderboard\.html$/, /\/ranking\.html$/, /\/more-gameplays\.html$/, /\/gameplay-product\.html$/, /\/fixed-order\.html$/, /\/team-lobby\.html$/, /\/companion-apply\.html$/, /\/activities\.html$/] },
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

  function isLogged(role) {
    var key = storageRole(role);
    var u = readUser(role);
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
    document.body.classList.toggle("is-logged-in", isLogged("customer") || isLogged("boss"));
    window.dispatchEvent(new CustomEvent("mcj:auth-updated"));
  }

  function isAdminRole(role) {
    role = String(role || "");
    return role === "admin" || role === "super_admin";
  }

  function saveSession(session, remember) {
    var userData = session && session.user || {};
    var role = storageRole(userData.role || "boss");
    var cfg = cfgFor(role);
    if (!cfg) return null;
    // Persist login across refresh by default; only skip when remember === false.
    var store = remember === false ? sessionStorage : localStorage;
    var otherStore = store === localStorage ? sessionStorage : localStorage;
    var token = role + "_session_" + SESSION_VERSION + "_" + Date.now();
    var adminOk = isAdminRole(userData.role);
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
      adminRole: adminOk ? (userData.role === "super_admin" ? "super_admin" : "admin") : "",
      permissions: adminOk ? [userData.role === "super_admin" ? "super_admin" : "admin"] : []
    };
    otherStore.removeItem(cfg.token);
    otherStore.removeItem(cfg.user);
    otherStore.removeItem("mcjRole");
    otherStore.removeItem("mcjAuthAccessToken");
    otherStore.removeItem("mcjAuthRefreshToken");
    otherStore.removeItem("mcjAuthExpiresAt");
    otherStore.removeItem("mcjCurrentUser");
    store.setItem(cfg.token, token);
    store.setItem(cfg.user, JSON.stringify(user));
    store.setItem("mcjRole", userData.role || role);
    if (session.accessToken) store.setItem("mcjAuthAccessToken", session.accessToken);
    if (session.refreshToken) store.setItem("mcjAuthRefreshToken", session.refreshToken);
    if (session.expiresAt) store.setItem("mcjAuthExpiresAt", String(session.expiresAt));
    // Admin JWT must live in dedicated keys so boss wipe never deletes them.
    if (adminOk) {
      if (session.accessToken) store.setItem("mcjAdminAccessToken", session.accessToken);
      if (session.refreshToken) store.setItem("mcjAdminRefreshToken", session.refreshToken);
      if (session.expiresAt) store.setItem("mcjAdminExpiresAt", String(session.expiresAt));
      if (window.MCJAdminAuthFetch && typeof window.MCJAdminAuthFetch.saveTokens === "function") {
        window.MCJAdminAuthFetch.saveTokens(session);
      }
    }
    if (window.MCJBossAuth && typeof window.MCJBossAuth.saveSession === "function" && (role === "customer" || role === "boss")) {
      try {
        window.MCJBossAuth.saveSession(session, remember !== false);
      } catch (e) {}
    }
    ["customer", "companion", "customer_service", "admin"].forEach(function (other) {
      if (other === role) return;
      var otherCfg = cfgFor(other);
      localStorage.removeItem(otherCfg.token); localStorage.removeItem(otherCfg.user);
      sessionStorage.removeItem(otherCfg.token); sessionStorage.removeItem(otherCfg.user);
      if (other === "admin") {
        ["mcjAdminAccessToken", "mcjAdminRefreshToken", "mcjAdminExpiresAt"].forEach(function (k) {
          localStorage.removeItem(k);
          sessionStorage.removeItem(k);
        });
      }
    });
    return user;
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

  async function loginWithDatabase(account, password, remember) {
    var body = await postAuth({ action: "login", email: account, password: password });
    saveSession(body.session, remember);
    return body;
  }

  async function registerWithDatabase(payload, remember) {
    var body = await postAuth({
      action: "register",
      email: payload.email,
      password: payload.password,
      displayName: payload.displayName || payload.nickname || "",
      phone: payload.phone || "",
    });
    saveSession(body.session, remember !== false);
    return body;
  }

  function syncPortalSessions(session, remember) {
    var user = (session && session.user) || {};
    var role = profileRole(user.role || "");
    var token = (session && (session.accessToken || session.token || session.access_token)) || "";
    if (!token) return;
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
        };
        // Always dual-write so refresh / new tabs keep CS login.
        localStorage.setItem("mcjServiceSession", JSON.stringify(cs));
        sessionStorage.setItem("mcjServiceSession", JSON.stringify(cs));
      }
    }
    if (role === "companion") {
      var pw = { token: token, user: user, remember: remember !== false };
      if (remember === false) {
        sessionStorage.setItem("mcjCompanionSession", JSON.stringify(pw));
        localStorage.removeItem("mcjCompanionSession");
      } else {
        localStorage.setItem("mcjCompanionSession", JSON.stringify(pw));
        sessionStorage.removeItem("mcjCompanionSession");
      }
    }
  }

  function afterAuthSuccess(result, options) {
    options = options || {};
    closeLoginModal();
    refreshAuthUi();
    if (window.MCJBossHeader && typeof window.MCJBossHeader.sync === "function") {
      window.MCJBossHeader.sync();
    }
    if (window.MCJBossHeader && typeof window.MCJBossHeader.refreshNotifications === "function") {
      window.MCJBossHeader.refreshNotifications();
    }
    var role = (result.session && result.session.user && result.session.user.role) || "boss";
    syncPortalSessions(result.session, options.remember !== false);
    var pending = sessionStorage.getItem("mcjAfterLoginRedirect");
    sessionStorage.removeItem("mcjAfterLoginRedirect");
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
    if (dest !== here && dest + ".html" !== here && here + "/" !== dest) {
      location.href = String(redirect || "/").replace(/#(login|register)$/i, "");
      return;
    }
    if (profileRole(role) === "boss") {
      location.replace((location.pathname || "/") + (location.search || ""));
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
    var body = await loginWithDatabase(account, password, remember !== false);
    var role = (body.session && body.session.user && body.session.user.role) || "";
    var want = profileRole(expectedRole);
    var got = profileRole(role);
    if (want === "admin") {
      if (!isAdminRole(role)) {
        logout("admin");
        logout("customer");
        throw new Error("非管理员账号不得进入后台中心。");
      }
    } else if (got !== want) {
      logout(got);
      logout(want);
      throw new Error(
        want === "boss"
          ? "非老板账号，请使用对应入口登录。"
          : want === "companion"
            ? "无权访问陪玩端。"
            : want === "customer_service"
              ? "无权访问客服端。"
              : "账号角色与当前入口不匹配。"
      );
    }
    syncPortalSessions(body.session, remember !== false);
    return body;
  }
  function user(role) { return readUser(role); }
  function logout(role) {
    var cfg = cfgFor(role);
    if (cfg) {
      localStorage.removeItem(cfg.token);
      localStorage.removeItem(cfg.user);
      sessionStorage.removeItem(cfg.token);
      sessionStorage.removeItem(cfg.user);
    }
    var storageKey = storageRole(role);
    if (storageKey === "customer_service" || !role) {
      if (window.MCJServiceAuth && typeof window.MCJServiceAuth.clearSession === "function") {
        window.MCJServiceAuth.clearSession("logout");
      } else {
        localStorage.removeItem("mcjServiceSession");
        sessionStorage.removeItem("mcjServiceSession");
      }
    }
    if (storageKey === "companion" || !role) {
      localStorage.removeItem("mcjCompanionSession");
      sessionStorage.removeItem("mcjCompanionSession");
    }
    if (storageKey === "admin" || storageKey === "customer" || role === "boss" || !role) {
      localStorage.removeItem("mcjRole");
      sessionStorage.removeItem("mcjRole");
      localStorage.removeItem("mcjAuthAccessToken");
      sessionStorage.removeItem("mcjAuthAccessToken");
      localStorage.removeItem("mcjAuthRefreshToken");
      sessionStorage.removeItem("mcjAuthRefreshToken");
      localStorage.removeItem("mcjAuthExpiresAt");
      sessionStorage.removeItem("mcjAuthExpiresAt");
      localStorage.removeItem("mcjCurrentUser");
      sessionStorage.removeItem("mcjCurrentUser");
      localStorage.removeItem("customerAuthToken");
      sessionStorage.removeItem("customerAuthToken");
      localStorage.removeItem("customerUser");
      sessionStorage.removeItem("customerUser");
      if (window.MCJBossAuth && typeof window.MCJBossAuth.clearSession === "function") {
        try { window.MCJBossAuth.clearSession(); } catch (e) {}
      }
    }
    if (storageKey === "admin" || !role) {
      ["mcjAdminAccessToken", "mcjAdminRefreshToken", "mcjAdminExpiresAt"].forEach(function (k) {
        localStorage.removeItem(k);
        sessionStorage.removeItem(k);
      });
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
        if (cs && (cs.token || cs.accessToken || cs.refreshToken)) return true;
      } catch (e) {}
    }
    if (key === "companion") {
      try {
        var pw = JSON.parse(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "null");
        if (pw && pw.token) return true;
      } catch (e) {}
    }
    return isLogged(role);
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
      // Login page: shared CS auth decides whether to bounce to dashboard after restore.
      if (window.MCJServiceAuth && typeof window.MCJServiceAuth.guardCustomerServicePages === "function") {
        window.MCJServiceAuth.guardCustomerServicePages();
      }
      return true;
    }
    if (/\/companion\/login/i.test(p)) return true;
    if (/^\/?$|\/index\.html$/i.test(p) || /\/login\.html$/i.test(p)) return true;

    if (/\/admin\.html$/i.test(p) || (/\/admin(\/|$)/i.test(p) && !isAdminLoginPath())) {
      if (!isLogged("admin")) return denyUnauthed("/admin/login/", returnPath());
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

    if (/\/(mine|orders|support|recharge|messages|favorites|payment-confirm|order-confirm|gifts)\.html$/i.test(p)) {
      // Soft / refresh alone insufficient — require non-expired access JWT.
      // profile.html is public companion detail and stays ungated.
      if (!hasValidBossAccessToken()) {
        wipeBossGuestArtifacts();
        return denyUnauthed("/login.html", returnPath());
      }
      return true;
    }
    return true;
  }

  function guard(role) {
    var cfg = cfgFor(role);
    if (!cfg) return true;
    if (storageRole(role) === "admin") {
      if (isAdminLoginPath()) return true;
      if (!isLogged("admin")) {
        return denyUnauthed(cfg.login || "/admin/login/", returnPath());
      }
      return true;
    }
    if (storageRole(role) === "customer" || role === "boss") {
      if (/\/(mine|orders|support|recharge|messages|favorites|payment-confirm|order-confirm|gifts)\.html$/i.test(path())) {
        if (!hasValidBossAccessToken()) {
          wipeBossGuestArtifacts();
          return denyUnauthed("/login.html", returnPath());
        }
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
            var left = 60;
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

      var registerBtn = event.target && event.target.closest && event.target.closest("[data-register-confirm]");
      if (registerBtn) {
        event.preventDefault();
        event.stopPropagation();
        if (event.stopImmediatePropagation) event.stopImmediatePropagation();
        var nickname = fieldValue(["registerNickname", "displayName", "nickname"]).trim();
        var email = fieldValue(["registerEmail", "loginGmail", "loginEmail", "email"]).trim();
        var password = fieldValue(["registerPassword", "loginGmailCode", "loginPassword", "password"]);
        var confirmPassword = fieldValue(["registerPasswordConfirm", "confirmPassword"]);
        if (!nickname) { setLoginMessage(registerBtn, "请输入昵称。"); return; }
        if (!email || !password) { setLoginMessage(registerBtn, "请输入邮箱和密码。"); return; }
        if (password.length < 6) { setLoginMessage(registerBtn, "密码至少 6 位。"); return; }
        if (password !== confirmPassword) { setLoginMessage(registerBtn, "两次输入的密码不一致。"); return; }
        if (registerBtn.disabled) return;
        registerBtn.disabled = true;
        var oldReg = registerBtn.textContent;
        registerBtn.textContent = "注册中...";
        registerWithDatabase({ email: email, password: password, displayName: nickname }, true)
          .then(function (result) {
            afterAuthSuccess(result, { remember: true });
          })
          .catch(function (error) {
            setLoginMessage(registerBtn, humanizeAuthError(error));
          })
          .finally(function () {
            registerBtn.disabled = false;
            registerBtn.textContent = oldReg || "注册";
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
        fetch("/api/auth", {
          method: "POST",
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({
            action: "login_with_otp",
            email: otpAccount,
            code: otpCode,
            role: target.getAttribute("data-login-role") || "boss",
          }),
        })
          .then(function (r) {
            return r.json().then(function (j) {
              if (!r.ok || j.ok === false) throw new Error((j && j.message) || "登录失败");
              return j;
            });
          })
          .then(function (result) {
            saveSession(result.session, true);
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
      loginWithDatabase(account, passwordLogin, true)
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
    logout: logout,
    isLogged: isLogged,
    user: user,
    isAdminRole: isAdminRole,
    routeFor: routeFor,
    profileRole: profileRole,
    humanizeAuthError: humanizeAuthError,
    syncPortalSessions: syncPortalSessions,
  };

  (function loadBossHeader() {
    if (window.__MCJBossHeaderScript) return;
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
      if (!/mine\.html|orders\.html|support\.html|recharge\.html|messages\.html|favorites\.html|profile\.html|gifts\.html/i.test(href)) return;
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
