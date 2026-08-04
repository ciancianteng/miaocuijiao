/**
 * Sync early gate (classic script, NOT type=module).
 * Soft localStorage tokens alone NEVER unlock a portal — require non-expired access JWT.
 * Refresh-only leftovers NEVER unlock boss private pages (prevents auto re-entry).
 * Full role verify still runs in role-gates.js after modules load.
 * Also re-checks on pageshow (bfcache / back-button after logout).
 */
(function () {
  "use strict";

  var GATE_VERSION = "20260804adminAuthP0";

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
    // Boss private pages: sessionStorage only — never revive localStorage JWT.
    // Exception: preserve shared mcjAuth* in localStorage while admin soft session is live
    // (admin APIs still read those / dedicated mcjAdmin* keys).
    var preserveSharedAuth =
      hasAdminSoftSession && hasAdminSoftSession() && /^mcjAuth(AccessToken|RefreshToken|ExpiresAt)$/.test(key);
    if (!preserveSharedAuth && !/^mcjAdmin/.test(key)) {
      try {
        localStorage.removeItem(key);
      } catch (e) {}
    }
    try {
      return sessionStorage.getItem(key) || "";
    } catch (e2) {
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
      expRaw = sessionStorage.getItem("mcjAuthExpiresAt") || "";
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
    return role === "boss" || role === "customer" || role === "user";
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
    var preserveSharedAuth = hasAdminSoftSession();
    [
      "customerAuthToken",
      "customerUser",
      "mcjCurrentUser",
      "mcjAfterLoginRedirect",
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

  function deny(loginHref) {
    hideShell();
    try {
      if (document.body) document.body.innerHTML = "";
    } catch (e) {}
    try {
      sessionStorage.setItem(
        "mcjAfterLoginRedirect",
        String(location.pathname || "/") + String(location.search || "") + String(location.hash || "")
      );
    } catch (e2) {}
    location.replace(loginHref);
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
      var adminAccess = item("mcjAdminAccessToken") || item("mcjAuthAccessToken");
      var adminRefresh = item("mcjAdminRefreshToken") || item("mcjAuthRefreshToken");
      if (!adminOkSoft || !adminRoleOk || !hasJwtOrRefresh(adminAccess, adminRefresh)) {
        return deny("/admin/login/");
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
      var pwShared = String(item("mcjRole") || "").toLowerCase();
      var pwSoft = item("companionAuthToken");
      var pwSoftOk = String(pwSoft).indexOf("companion_session_") === 0;
      var pwRoleOk =
        isCompanionRole(roleOf(pwUser)) ||
        isCompanionRole(pwShared) ||
        (pwSoftOk && !pwShared);
      if (!pwSoftOk || !hasJwtOrRefresh(pwAccess, pwRefresh) || !pwRoleOk) {
        return deny("/companion/login/");
      }
      if (pwShared && !isCompanionRole(pwShared)) {
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
      var csShared = String(item("mcjRole") || "").toLowerCase();
      var csSoft = item("customerServiceAuthToken");
      var csSoftOk = String(csSoft).indexOf("customer_service_session_") === 0;
      var csRoleOk =
        isCsRole(roleOf(csUser)) ||
        isCsRole(csShared) ||
        (csSoftOk && !csShared);
      if (!csSoftOk || !hasJwtOrRefresh(csAccess, csRefresh) || !csRoleOk) {
        return deny("/customer-service/login/");
      }
      if (csShared && !isCsRole(csShared)) {
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
