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
  function readUser(role) { var cfg = cfgFor(role); try { return JSON.parse(localStorage.getItem(cfg.user) || sessionStorage.getItem(cfg.user) || "{}"); } catch (e) { return {}; } }
  function readToken(role) { var cfg = cfgFor(role); return localStorage.getItem(cfg.token) || sessionStorage.getItem(cfg.token) || ""; }
  function isAllowed(role) { var cfg = cfgFor(role); if (!cfg) return true; return cfg.allowed.some(function (rule) { return rule.test(path()); }); }
  function readAccessToken() {
    return localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "";
  }
  function readSharedRole() {
    return localStorage.getItem("mcjRole") || sessionStorage.getItem("mcjRole") || "";
  }
  function wipeStorageKeys(keys) {
    (keys || []).forEach(function (key) {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (e) {}
    });
  }

  /**
   * P0 identity isolation: only one end may own the shared JWT mirrors.
   * Login for role X must wipe soft sessions + portal blobs for every other role
   * so boss pages never keep customerUser while mcjAuth* still belongs to CS/etc.
   */
  var PORTAL_KEYS = {
    customer: ["customerAuthToken", "customerUser"],
    boss: ["customerAuthToken", "customerUser"],
    companion: ["companionAuthToken", "companionUser", "mcjCompanionSession"],
    customer_service: ["customerServiceAuthToken", "customerServiceUser", "mcjServiceSession"],
    admin: ["adminAuthToken", "adminUser"],
  };
  var SHARED_AUTH_KEYS = ["mcjAuthAccessToken", "mcjAuthRefreshToken", "mcjAuthExpiresAt", "mcjRole"];

  function clearOtherRoleSessions(keepRole) {
    var keep = storageRole(keepRole);
    ["customer", "companion", "customer_service", "admin"].forEach(function (role) {
      if (role === keep) return;
      wipeStorageKeys(PORTAL_KEYS[role] || []);
    });
    // Extra portal blobs / aliases (safe no-ops if already wiped).
    if (keep !== "customer_service") {
      wipeStorageKeys(["mcjServiceSession", "customerServiceAuthToken", "customerServiceUser"]);
    }
    if (keep !== "companion") {
      wipeStorageKeys(["mcjCompanionSession", "companionAuthToken", "companionUser"]);
    }
    if (keep !== "customer" && keep !== "boss") {
      wipeStorageKeys(["customerAuthToken", "customerUser"]);
    }
    if (keep !== "admin") {
      wipeStorageKeys(["adminAuthToken", "adminUser"]);
    }
  }

  function clearSharedAuthMirrors() {
    wipeStorageKeys(SHARED_AUTH_KEYS);
  }

  function isBossSurfaceRole(role) {
    var key = storageRole(role);
    return key === "customer" || key === "boss";
  }

  function looksLikeJwt(token) {
    var t = String(token || "").trim();
    if (!t || t.length < 20) return false;
    var parts = t.split(".");
    return parts.length === 3 && parts.every(function (part) {
      return part.length > 0;
    });
  }

  function readRefreshToken() {
    return localStorage.getItem("mcjAuthRefreshToken") || sessionStorage.getItem("mcjAuthRefreshToken") || "";
  }

  function hasLiveAuthMaterial(access, refresh) {
    return looksLikeJwt(access) || !!String(refresh || "").trim();
  }

  function isLogged(role) {
    var key = storageRole(role);
    var token = readToken(role);
    var u = readUser(role);
    var sharedRole = readSharedRole();
    var softOk =
      !!token &&
      (String(token).indexOf(key + "_session_" + SESSION_VERSION + "_") === 0 ||
        String(token).indexOf(key + "_session_") === 0);
    if (!softOk) return false;
    // Soft session alone NEVER unlocks — require JWT or refresh (same bar as early gate).
    if (!hasLiveAuthMaterial(readAccessToken(), readRefreshToken())) return false;
    if (sharedRole && !roleMatches(role, sharedRole)) return false;
    if (!roleMatches(role, u.role || role)) return false;
    // Boss pages: never treat an orphan CS/companion/admin JWT as a boss login.
    if (isBossSurfaceRole(role)) {
      var effective = (u && u.role) || sharedRole;
      if (!effective) return false;
      return roleMatches(role, effective);
    }
    return true;
  }

  function humanizeAuthError(error) {
    var msg = String((error && error.message) || error || "").trim();
    if (!msg || /failed to fetch|fetch failed|networkerror|network request failed|load failed|err_connection|econnrefused|econnreset|enotfound|timeout/i.test(msg)) {
      return "暂时无法连接服务器，请稍后重试";
    }
    if (/invalid login credentials|invalid.*(email|password)|email not confirmed/i.test(msg)) {
      return "邮箱或密码错误。";
    }
    if (/手机号已|phone.*(already|exist|unique|duplicate)|phone_e164/i.test(msg)) {
      return "该手机号已注册，请更换号码或直接登录。";
    }
    if (/user already registered|already.*(registered|exists)|邮箱.*已|duplicate.*email|email.*unique/i.test(msg)) {
      return "该邮箱已注册，请直接登录。";
    }
    if (/duplicate|unique/i.test(msg)) {
      return "该账号信息已存在，请更换后重试。";
    }
    return msg;
  }

  function setLoginMessage(anchor, message) {
    var box = document.getElementById("loginState") || document.querySelector("[data-login-error]");
    if (!box && anchor && anchor.parentNode) {
      box = document.createElement("p");
      box.setAttribute("data-login-error", "true");
      box.style.margin = "10px 0 0";
      box.style.color = "#ff8fc5";
      box.style.fontSize = "13px";
      anchor.parentNode.insertBefore(box, anchor.nextSibling);
    }
    if (box) box.textContent = message;
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
    role = String(role || "").trim().toLowerCase();
    return role === "admin" || role === "super_admin" || role === "finance_admin" || role === "管理员" || role === "超级管理员";
  }

  function saveSession(session, remember) {
    var userData = session && session.user || {};
    var role = storageRole(userData.role || "boss");
    var cfg = cfgFor(role);
    if (!cfg) return null;
    var store = remember === false ? sessionStorage : localStorage;
    var otherStore = remember === false ? localStorage : sessionStorage;
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
      adminRole: adminOk
        ? userData.role === "super_admin"
          ? "super_admin"
          : userData.role === "finance_admin"
            ? "finance_admin"
            : "admin"
        : "",
      permissions: adminOk
        ? [
            userData.role === "super_admin"
              ? "super_admin"
              : userData.role === "finance_admin"
                ? "finance_admin"
                : "admin",
          ]
        : [],
    };
    // Drop every other end first (incl. mcjServiceSession / mcjCompanionSession).
    clearOtherRoleSessions(role);
    // Avoid stale copies across storage buckets after remember toggle.
    otherStore.removeItem(cfg.token);
    otherStore.removeItem(cfg.user);
    otherStore.removeItem("mcjRole");
    otherStore.removeItem("mcjAuthAccessToken");
    otherStore.removeItem("mcjAuthRefreshToken");
    otherStore.removeItem("mcjAuthExpiresAt");
    // Ensure shared mirrors are exclusive to this login write.
    clearSharedAuthMirrors();
    store.setItem(cfg.token, token);
    store.setItem(cfg.user, JSON.stringify(user));
    store.setItem("mcjRole", userData.role || role);
    if (session.accessToken) store.setItem("mcjAuthAccessToken", session.accessToken);
    if (session.refreshToken) store.setItem("mcjAuthRefreshToken", session.refreshToken);
    if (session.expiresAt) store.setItem("mcjAuthExpiresAt", String(session.expiresAt));
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
      countryCode: payload.countryCode || payload.country_code || "MY",
      dialCode: payload.dialCode || payload.dial_code || "",
      phoneE164: payload.phoneE164 || payload.phone_e164 || "",
    });
    saveSession(body.session, remember !== false);
    return body;
  }

  function syncRegisterDialDisplay() {
    var select = document.getElementById("registerCountry");
    var dialEl = document.getElementById("registerDialCode");
    if (!select || !dialEl) return;
    var opt = select.options[select.selectedIndex];
    var dial = (opt && opt.getAttribute("data-dial")) || "";
    if (!dial && window.MCJCountries && typeof window.MCJCountries.byCode === "function") {
      dial = (window.MCJCountries.byCode(select.value) || {}).dial || "+60";
    }
    dialEl.value = dial || "+60";
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
      var pw = {
        token: token,
        accessToken: token,
        refreshToken: session.refreshToken || session.refresh_token || "",
        expiresAt: session.expiresAt || session.expires_at || "",
        user: user,
        remember: remember !== false,
      };
      // Dual-write so refresh + new tabs keep companion login (and refreshToken).
      localStorage.setItem("mcjCompanionSession", JSON.stringify(pw));
      sessionStorage.setItem("mcjCompanionSession", JSON.stringify(pw));
      if (remember === false) {
        localStorage.removeItem("mcjCompanionSession");
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

    // In-place resume: click → login modal → continue same action (no homepage jump).
    var Cont = window.MCJAuthContinue;
    if (profileRole(role) === "boss" && Cont && typeof Cont.hasPending === "function" && Cont.hasPending()) {
      try {
        sessionStorage.removeItem("mcjAfterLoginRedirect");
      } catch (e) {}
      if (typeof Cont.runPending === "function") Cont.runPending();
      else if (typeof Cont.consumePending === "function") {
        var fn = Cont.consumePending();
        if (typeof fn === "function") setTimeout(fn, 0);
      }
      return;
    }

    var pending = sessionStorage.getItem("mcjAfterLoginRedirect");
    sessionStorage.removeItem("mcjAfterLoginRedirect");
    var roleHome = result.redirect || routeFor(role);
    // Boss may resume a pending page; other roles always land on their portal.
    var redirect = profileRole(role) === "boss" && pending ? pending : roleHome;
    var here = String(location.pathname || "").replace(/\/+$/, "") || "/";
    var dest = String(redirect || "/").replace(/\/+$/, "") || "/";
    if (dest !== here && dest + ".html" !== here && here + "/" !== dest) {
      location.href = redirect;
      return;
    }
    if (profileRole(role) === "boss") {
      location.reload();
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
    var storageKey = role ? storageRole(role) : "";
    if (!role) {
      // Full wipe across all ends.
      clearOtherRoleSessions("__none__");
      wipeStorageKeys((PORTAL_KEYS.customer || []).concat(PORTAL_KEYS.companion || [], PORTAL_KEYS.customer_service || [], PORTAL_KEYS.admin || []));
      clearSharedAuthMirrors();
      wipeStorageKeys(["mcjAfterLoginRedirect", "mcjAdminLoginNotice"]);
      refreshAuthUi();
      return;
    }
    var cfg = cfgFor(role);
    if (cfg) {
      wipeStorageKeys([cfg.token, cfg.user]);
    }
    wipeStorageKeys(PORTAL_KEYS[storageKey] || []);
    if (storageKey === "customer_service") {
      wipeStorageKeys(["mcjServiceSession", "customerServiceAuthToken", "customerServiceUser"]);
    }
    if (storageKey === "companion") {
      wipeStorageKeys(["mcjCompanionSession", "companionAuthToken", "companionUser"]);
    }
    // Shared JWT mirrors are single-owner: always clear on logout of the active end.
    var shared = readSharedRole();
    if (!shared || roleMatches(role, shared) || storageKey === "customer" || storageKey === "admin" || role === "boss") {
      clearSharedAuthMirrors();
    }
    wipeStorageKeys(["mcjAfterLoginRedirect"]);
    refreshAuthUi();
  }
  function hasPortalSession(role) {
    var key = profileRole(role);
    if (key === "customer_service") {
      try {
        var cs = JSON.parse(localStorage.getItem("mcjServiceSession") || sessionStorage.getItem("mcjServiceSession") || "null");
        var csAccess = cs && (cs.token || cs.accessToken || cs.access_token);
        var csRefresh = (cs && (cs.refreshToken || cs.refresh_token)) || "";
        if (!hasLiveAuthMaterial(csAccess, csRefresh)) return false;
      } catch (e) {
        return false;
      }
      var csSoft = readToken("customer_service");
      if (String(csSoft).indexOf("customer_service_session_") !== 0) return false;
      if (window.MCJServiceAuth && typeof window.MCJServiceAuth.hasSession === "function") {
        if (!window.MCJServiceAuth.hasSession()) return false;
      }
      return true;
    }
    if (key === "companion") {
      try {
        var pw = JSON.parse(localStorage.getItem("mcjCompanionSession") || sessionStorage.getItem("mcjCompanionSession") || "null");
        var pwAccess = pw && (pw.token || pw.accessToken || pw.access_token);
        var pwRefresh = (pw && (pw.refreshToken || pw.refresh_token)) || "";
        if (!hasLiveAuthMaterial(pwAccess, pwRefresh)) return false;
      } catch (e) {
        return false;
      }
      var pwSoft = readToken("companion");
      if (String(pwSoft).indexOf("companion_session_") !== 0) return false;
      return true;
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

    if (/\/(mine|orders|support|recharge)\.html$/i.test(p)) {
      if (!isLogged("customer") && !isLogged("boss") && !readAccessToken()) {
        scheduleBossSoftLoginGate();
      }
      return true;
    }
    return true;
  }

  function whenAuthContinueReady(cb, fallback) {
    var tries = 0;
    function tick() {
      if (window.MCJAuthContinue && typeof window.MCJAuthContinue.requireLogin === "function") {
        cb(window.MCJAuthContinue);
        return;
      }
      if (window.MCJModal && typeof window.MCJModal.openLogin === "function" && tries > 4) {
        if (typeof fallback === "function") fallback();
        else window.MCJModal.openLogin("login");
        return;
      }
      tries += 1;
      if (tries > 60) {
        if (typeof fallback === "function") fallback();
        else denyUnauthed("/login.html", returnPath());
        return;
      }
      setTimeout(tick, 50);
    }
    tick();
  }

  function scheduleBossSoftLoginGate() {
    function openGate() {
      whenAuthContinueReady(
        function (Cont) {
          Cont.requireLogin(function () {
            location.reload();
          });
        },
        function () {
          if (window.MCJModal && typeof window.MCJModal.openLogin === "function") {
            window.MCJModal.openLogin("login");
            return;
          }
          denyUnauthed("/login.html", returnPath());
        }
      );
    }
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        setTimeout(openGate, 0);
      });
    } else {
      setTimeout(openGate, 0);
    }
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
      if (/\/(mine|orders|support|recharge)\.html$/i.test(path())) {
        if (!isLogged("customer") && !isLogged("boss") && !readAccessToken()) {
          scheduleBossSoftLoginGate();
          return true;
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
    document.addEventListener("change", function (event) {
      if (event.target && event.target.id === "registerCountry") syncRegisterDialDisplay();
    });
    document.addEventListener("click", function (event) {
      var switchBtn = event.target && event.target.closest && event.target.closest("[data-switch-auth]");
      if (switchBtn) {
        var mode = switchBtn.getAttribute("data-switch-auth") === "register" ? "register" : "login";
        var body = document.getElementById("modalBody");
        if (body && typeof window.bossLoginHtml === "function") {
          event.preventDefault();
          body.innerHTML = window.bossLoginHtml(mode);
          syncRegisterDialDisplay();
        }
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
        var countryCode = (fieldValue(["registerCountry"]) || "MY").trim().toUpperCase() || "MY";
        var localPhone = fieldValue(["registerPhone"]).trim();
        var countrySelect = document.getElementById("registerCountry");
        var selectedOpt = countrySelect && countrySelect.options ? countrySelect.options[countrySelect.selectedIndex] : null;
        var dialCode = (selectedOpt && selectedOpt.getAttribute("data-dial")) || fieldValue(["registerDialCode"]) || "+60";
        if (window.MCJCountries && typeof window.MCJCountries.byCode === "function") {
          dialCode = dialCode || (window.MCJCountries.byCode(countryCode) || {}).dial || "+60";
        }
        var phoneE164 = "";
        var nationalPhone = localPhone;
        if (window.MCJCountries) {
          if (typeof window.MCJCountries.normalizeLocalPhone === "function") {
            nationalPhone = window.MCJCountries.normalizeLocalPhone(localPhone, dialCode) || localPhone.replace(/\D+/g, "");
          }
          if (typeof window.MCJCountries.toE164 === "function") {
            phoneE164 = window.MCJCountries.toE164(countryCode, localPhone) || "";
          }
        } else if (localPhone) {
          nationalPhone = String(localPhone).replace(/\D+/g, "").replace(/^0+/, "");
          phoneE164 = dialCode + nationalPhone;
        }
        if (!nickname) { setLoginMessage(registerBtn, "请输入昵称。"); return; }
        if (!email || !password) { setLoginMessage(registerBtn, "请输入邮箱和密码。"); return; }
        if (password.length < 6) { setLoginMessage(registerBtn, "密码至少 6 位。"); return; }
        if (password !== confirmPassword) { setLoginMessage(registerBtn, "两次输入的密码不一致。"); return; }
        if (registerBtn.disabled) return;
        registerBtn.disabled = true;
        var oldReg = registerBtn.textContent;
        registerBtn.textContent = "注册中...";
        registerWithDatabase({
          email: email,
          password: password,
          displayName: nickname,
          phone: nationalPhone || phoneE164 || localPhone || "",
          countryCode: countryCode,
          dialCode: dialCode,
          phoneE164: phoneE164,
        }, true)
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
    clearOtherRoleSessions: clearOtherRoleSessions,
    clearSharedAuthMirrors: clearSharedAuthMirrors,
  };

  (function loadBossLoginPortal() {
    if (window.__MCJLoginPortalScript) return;
    var p = String(location.pathname || "").replace(/\\/g, "/");
    if (/\/admin(\/|\.html|$)/i.test(p) || /\/companion\//i.test(p) || /\/customer-service(\/|\.html|$)/i.test(p)) return;
    window.__MCJLoginPortalScript = true;
    var s = document.createElement("script");
    s.src = "/src/login-modal-portal.js?v=20260804authContinue";
    s.defer = true;
    document.head.appendChild(s);
  })();

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
    s.src = "/src/boss-header.js?v=20260803idP0";
    s.defer = true;
    document.head.appendChild(s);
  })();

  bindLoginButtons();
  bootRouteProtection();

  // Back-button / bfcache: re-run portal protection after logout history restore.
  window.addEventListener(
    "pageshow",
    function (event) {
      if (event && event.persisted) {
        if (window.MCJPortalEarlyGate && typeof window.MCJPortalEarlyGate.evaluate === "function") {
          window.MCJPortalEarlyGate.evaluate();
        }
        bootRouteProtection();
      }
    },
    true
  );

  // Guest clicks to auth-required boss pages → in-place login modal, then continue to target.
  document.addEventListener(
    "click",
    function (event) {
      var a = event.target && event.target.closest && event.target.closest("a[href]");
      if (!a) return;
      var href = String(a.getAttribute("href") || "");
      if (!/mine\.html|orders\.html|support\.html|recharge\.html/i.test(href)) return;
      if (isLogged("customer") || isLogged("boss") || readAccessToken()) return;
      event.preventDefault();
      var target = href;
      try {
        var abs = new URL(href, location.href);
        target = abs.pathname + abs.search + abs.hash;
      } catch (e) {}
      whenAuthContinueReady(
        function (Cont) {
          Cont.requireLogin(function () {
            location.href = target;
          });
        },
        function () {
          try {
            sessionStorage.setItem("mcjAfterLoginRedirect", target);
          } catch (e2) {}
          if (window.MCJModal && typeof window.MCJModal.openLogin === "function") {
            window.MCJModal.openLogin("login");
            return;
          }
          location.href = "/login.html";
        }
      );
    },
    true
  );

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", refreshAuthUi);
  } else {
    refreshAuthUi();
  }
})();
