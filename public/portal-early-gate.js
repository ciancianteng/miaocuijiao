/**
 * Sync early gate (classic script, NOT type=module).
 * Soft localStorage tokens alone NEVER unlock a portal — require non-expired access JWT.
 * Boss JWT may live in sessionStorage and/or localStorage (remember-me dual-write).
 * Full role verify still runs in role-gates.js after modules load.
 * Also re-checks on pageshow (bfcache / back-button after logout).
 */
(function () {
  "use strict";

  var GATE_VERSION = "20260828applyLogin1";

  function pathNow() {
    return String(location.pathname || "/").replace(/\\/g, "/");
  }

  function item(key) {
    try {
      return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
    } catch (e) {
      return "";
    }
  }

  function bossItem(key) {
    // Boss private pages: accept JWT from either store.
    // Remember-me writes localStorage; current-tab also mirrors to sessionStorage.
    // NEVER delete localStorage here — that kicked remembered sessions after login.
    try {
      return sessionStorage.getItem(key) || localStorage.getItem(key) || "";
    } catch (e) {
      return "";
    }
  }

  function removeItem(key) {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch (e) {}
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

  function hasValidAccessJwt(access) {
    if (!looksLikeJwt(access)) return false;
    var expRaw = "";
    try {
      expRaw =
        sessionStorage.getItem("mcjAdminExpiresAt") ||
        localStorage.getItem("mcjAdminExpiresAt") ||
        sessionStorage.getItem("mcjAuthExpiresAt") ||
        localStorage.getItem("mcjAuthExpiresAt") ||
        "";
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

  function readJson(key) {
    try {
      return JSON.parse(item(key) || "null");
    } catch (e) {
      return null;
    }
  }

  function hasJwtOrRefresh(access, refresh) {
    return looksLikeJwt(access) || !!String(refresh || "").trim();
  }

  function roleOf(user) {
    return String((user && (user.role || user.user_role || user.adminRole)) || "")
      .trim()
      .toLowerCase();
  }

  function isAdminRole(role) {
    role = String(role || "").trim().toLowerCase();
    return (
      role === "admin" ||
      role === "super_admin" ||
      role === "finance_admin" ||
      role === "管理员" ||
      role === "超级管理员"
    );
  }

  function isBossRole(role) {
    role = String(role || "").trim().toLowerCase();
    return role === "boss" || role === "customer" || role === "owner" || role === "user";
  }

  function isCompanionRole(role) {
    role = String(role || "").trim().toLowerCase();
    return role === "companion" || role === "player";
  }

  function isCsRole(role) {
    role = String(role || "").trim().toLowerCase();
    return role === "customer_service" || role === "service";
  }

  function hasAdminSoftSession() {
    var soft = item("adminAuthToken");
    return String(soft).indexOf("admin_session_") === 0;
  }

  function wipeBossIdentity() {
    // Never touch dedicated admin JWT. Keep shared mcjAuth* when admin soft session is live.
    // Do NOT clear mcjAfterLoginRedirect / apply resume flags — login must resume companion-apply.
    var preserveSharedAuth = hasAdminSoftSession();
    [
      "customerAuthToken",
      "customerUser",
      "mcjCurrentUser",
    ]
      .concat(
        preserveSharedAuth
          ? []
          : ["mcjAuthAccessToken", "mcjAuthRefreshToken", "mcjAuthExpiresAt", "mcjRole"]
      )
      .forEach(removeItem);
  }

  function hideShell() {
    try {
      document.documentElement.setAttribute("data-mcj-auth-gate", "1");
      document.documentElement.style.visibility = "hidden";
    } catch (e) {}
  }

  function revealShell() {
    try {
      document.documentElement.removeAttribute("data-mcj-auth-gate");
      document.documentElement.style.visibility = "";
    } catch (e) {}
  }

  function rememberAfterLoginRedirect(ret, applyFlag) {
    var path = String(ret || "/") || "/";
    try {
      sessionStorage.setItem("mcjAfterLoginRedirect", path);
      localStorage.setItem("mcjAfterLoginRedirect", path);
      if (applyFlag) {
        sessionStorage.setItem("mcjCompanionApplyAfterLogin", "1");
        localStorage.setItem("mcjCompanionApplyAfterLogin", "1");
      }
    } catch (e) {}
  }

  function deny(loginHref) {
    hideShell();
    try {
      if (document.body) document.body.innerHTML = "";
    } catch (e) {}
    var ret =
      String(location.pathname || "/") + String(location.search || "") + String(location.hash || "");
    var isApply = /\/companion-apply\.html$/i.test(String(location.pathname || ""));
    rememberAfterLoginRedirect(isApply ? "/companion-apply.html" : ret, isApply);
    var href = String(loginHref || "/login.html");
    if (isApply && href.indexOf("return=") < 0) {
      href =
        href.split("#")[0] +
        (href.indexOf("?") >= 0 ? "&" : "?") +
        "return=" +
        encodeURIComponent("/companion-apply.html");
    }
    location.replace(href);
    return false;
  }

  function isAdminLogin(p) {
    var n = String(p || pathNow()).replace(/\/+$/, "") || "/";
    return n === "/admin/login" || /\/admin\/login(\/|$)/i.test(p);
  }

  function isLoginSurface(p) {
    p = String(p || pathNow());
    if (isAdminLogin(p)) return true;
    if (/\/companion\/login/i.test(p)) return true;
    if (/\/customer-service\/login/i.test(p)) return true;
    if (/\/login\.html$/i.test(p)) return true;
    return false;
  }

  /**
   * @returns {true|false} true = allowed (or public), false = denied/redirecting
   */
  function evaluate() {
    var p = pathNow();

    // Login pages are public (role-gates may bounce already-authed users later).
    if (isLoginSurface(p)) {
      revealShell();
      return true;
    }

    // —— Admin shell + legacy admin-* pages ——
    if (
      /\/admin\.html$/i.test(p) ||
      (/\/admin(\/|$)/i.test(p) && !isAdminLogin(p)) ||
      /\/admin-(dashboard|center|audit)\.html$/i.test(p)
    ) {
      hideShell();
      var adminSoft = item("adminAuthToken");
      var adminOkSoft =
        String(adminSoft).indexOf("admin_session_") === 0 ||
        String(adminSoft).indexOf("admin_session_v4_") === 0;
      var adminUser = readJson("adminUser") || {};
      var sharedRole = String(item("mcjRole") || "").toLowerCase();
      var adminRoleOk =
        isAdminRole(roleOf(adminUser)) || isAdminRole(sharedRole) || isAdminRole(adminUser.adminRole);
      var adminAccess = item("mcjAdminAccessToken") || (adminOkSoft ? item("mcjAuthAccessToken") : "");
      var adminRefresh = item("mcjAdminRefreshToken") || (adminOkSoft ? item("mcjAuthRefreshToken") : "");
      // Soft session alone NEVER unlocks admin. Require admin-role marker + live JWT/refresh.
      // Never accept boss/companion/CS roles via shared mcjRole.
      if (sharedRole && !isAdminRole(sharedRole) && !adminOkSoft) {
        return deny("/admin/login/");
      }
      if (!adminOkSoft || !adminRoleOk || !hasJwtOrRefresh(adminAccess, adminRefresh)) {
        return deny("/admin/login/");
      }
      // Expired access JWT without refresh → login.
      if (looksLikeJwt(adminAccess) && !hasValidAccessJwt(adminAccess) && !String(adminRefresh || "").trim()) {
        return deny("/admin/login/");
      }
      revealShell();
      return true;
    }

    // —— Companion apply (root URL; must login first) ——
    // Guests must not fill the apply form. Accept companion session OR boss JWT.
    // Logged-in bosses keep「使用当前老板账号申请」; pure guests → /login.html.
    if (/\/companion-apply\.html$/i.test(p)) {
      hideShell();
      var applyPw = readJson("mcjCompanionSession");
      var applyPwAccess = applyPw && (applyPw.token || applyPw.accessToken || applyPw.access_token);
      var applyPwRefresh = applyPw && (applyPw.refreshToken || applyPw.refresh_token);
      var applyCompanionOk = hasJwtOrRefresh(applyPwAccess, applyPwRefresh);
      var applyBossAccess = bossItem("mcjAuthAccessToken");
      var applyBossRefresh = bossItem("mcjAuthRefreshToken");
      var applyBossOk =
        hasValidAccessJwt(applyBossAccess) || !!String(applyBossRefresh || "").trim();
      if (!applyCompanionOk && !applyBossOk) {
        return deny("/login.html");
      }
      revealShell();
      return true;
    }

    // —— Companion ——
    if (/\/companion(\/|$)/i.test(p)) {
      hideShell();
      var pw = readJson("mcjCompanionSession");
      var pwAccess = pw && (pw.token || pw.accessToken || pw.access_token);
      var pwRefresh = pw && (pw.refreshToken || pw.refresh_token);
      var pwUser = (pw && pw.user) || readJson("companionUser") || {};
      var pwSoft = item("companionAuthToken");
      var pwSoftOk = String(pwSoft).indexOf("companion_session_") === 0;
      // Portal isolation: ignore shared mcjRole / boss JWT. Companion blob + soft only.
      var pwRoleOk = isCompanionRole(roleOf(pwUser)) || (pwSoftOk && !roleOf(pwUser));
      if (!pwSoftOk || !hasJwtOrRefresh(pwAccess, pwRefresh) || !pwRoleOk) {
        return deny("/companion/login/");
      }
      revealShell();
      return true;
    }

    // —— Customer service ——
    if (/\/customer-service(\/|$)/i.test(p)) {
      hideShell();
      var cs = readJson("mcjServiceSession");
      var csAccess = cs && (cs.token || cs.accessToken || cs.access_token);
      var csRefresh = cs && (cs.refreshToken || cs.refresh_token);
      var csUser = (cs && cs.user) || readJson("customerServiceUser") || {};
      var csSoft = item("customerServiceAuthToken");
      var csSoftOk = String(csSoft).indexOf("customer_service_session_") === 0;
      var csRoleOk = isCsRole(roleOf(csUser)) || (csSoftOk && !roleOf(csUser));
      var csCredOk = hasValidAccessJwt(csAccess) || !!String(csRefresh || "").trim();
      if (!csSoftOk || !csCredOk || !csRoleOk) {
        // Wipe CS half-sessions only — never touch boss mcjAuth*.
        ["mcjServiceSession", "customerServiceAuthToken", "customerServiceUser"].forEach(removeItem);
        return deny("/customer-service/login/");
      }
      revealShell();
      return true;
    }

    // —— Boss protected pages ——
    // Soft / refresh / URL params NEVER unlock. Require non-expired access JWT.
    // NOTE: profile.html is public companion detail — do NOT gate it.
    if (
      /\/(mine|orders|support|recharge|messages|favorites|payment-confirm|order-confirm|gifts)\.html$/i.test(
        p
      )
    ) {
      hideShell();
      try {
        if (document.body) document.body.innerHTML = "";
      } catch (e0) {}
      var bossUser = null;
      try {
        bossUser = JSON.parse(bossItem("customerUser") || "null") || {};
      } catch (e1) {
        bossUser = {};
      }
      var bossShared = String(bossItem("mcjRole") || "").toLowerCase();
      var roleHint = roleOf(bossUser) || bossShared;
      if (roleHint && !isBossRole(roleHint)) {
        wipeBossIdentity();
        return deny("/login.html");
      }
      if (!hasValidAccessJwt(bossItem("mcjAuthAccessToken"))) {
        wipeBossIdentity();
        return deny("/login.html");
      }
      revealShell();
      return true;
    }

    return true;
  }

  evaluate();

  window.addEventListener(
    "pageshow",
    function (event) {
      if (event && event.persisted) {
        evaluate();
      }
    },
    true
  );

  window.MCJPortalEarlyGate = {
    version: GATE_VERSION,
    evaluate: evaluate,
    looksLikeJwt: looksLikeJwt,
    hasValidAccessJwt: hasValidAccessJwt,
    wipeBossIdentity: wipeBossIdentity,
  };
})();
