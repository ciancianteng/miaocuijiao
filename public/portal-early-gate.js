/**
 * Sync early gate (classic script, NOT type=module).
 * Soft localStorage tokens alone NEVER unlock a portal — require non-expired access JWT.
 * Boss JWT may live in sessionStorage and/or localStorage (remember-me dual-write).
 * Full role verify still runs in role-gates.js after modules load.
 * Also re-checks on pageshow (bfcache / back-button after logout).
 */
(function () {
  "use strict";

  var GATE_VERSION = "20260908antiBlank1";
  var OVERLAY_ID = "mcjAuthBootOverlay";

  function pathNow() {
    return String(location.pathname || "/").replace(/\\/g, "/");
  }

  function item(key) {
    try {
      return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
    } catch (e) {
      // Private mode / WeChat WebView / QuotaExceeded / SecurityError
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

  function rememberReturnTo(returnTo) {
    var value = String(returnTo || "");
    if (!value) return false;
    try {
      sessionStorage.setItem("mcjAfterLoginRedirect", value);
      return true;
    } catch (e1) {
      try {
        localStorage.setItem("mcjAfterLoginRedirect", value);
        return true;
      } catch (e2) {
        return false;
      }
    }
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /**
   * P0 anti-blank: never clear body / never hide the whole document.
   * Paint a visible overlay so users always see a login guide or verifying state.
   */
  function paintAuthGateOverlay(opts) {
    opts = opts || {};
    var mode = opts.mode === "pending" ? "pending" : "redirect";
    var loginHref = String(opts.loginHref || "/login.html");
    var title =
      opts.title || (mode === "pending" ? "正在验证登录状态" : "需要登录后继续");
    var message =
      opts.message ||
      (mode === "pending"
        ? "请稍候，正在确认会话…"
        : "未登录或登录已失效，正在前往登录页…");
    var reason = String(opts.reason || "");

    try {
      document.documentElement.setAttribute("data-mcj-auth-gate", mode === "pending" ? "pending" : "1");
      if (reason) document.documentElement.setAttribute("data-mcj-auth-reason", reason);
      // Critical: never blank the page with visibility:hidden on <html>.
      document.documentElement.style.visibility = "";
    } catch (eGate) {}

    function ensureOverlay() {
      var body = document.body;
      if (!body) {
        document.addEventListener("DOMContentLoaded", ensureOverlay, { once: true });
        return;
      }
      var el = document.getElementById(OVERLAY_ID);
      if (!el) {
        el = document.createElement("div");
        el.id = OVERLAY_ID;
        body.appendChild(el);
      }
      el.setAttribute("role", "status");
      el.setAttribute("aria-live", "polite");
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;" +
        "padding:24px;box-sizing:border-box;background:#0f1115;color:#f5f5f5;font-family:system-ui,-apple-system,sans-serif;" +
        "visibility:visible!important;opacity:1!important;";
      var linkHtml =
        mode === "redirect"
          ? '<p style="margin:20px 0 0"><a href="' +
            escapeHtml(loginHref) +
            '" style="color:#7dd3fc;font-size:16px;font-weight:600;text-decoration:underline">点击前往登录</a></p>' +
            '<p style="margin:12px 0 0;font-size:13px;opacity:.75">若页面未自动跳转，请点上方链接</p>'
          : "";
      el.innerHTML =
        '<div style="max-width:360px;text-align:center;line-height:1.5">' +
        "<h1 style=\"margin:0 0 12px;font-size:20px;font-weight:700\">" +
        escapeHtml(title) +
        "</h1>" +
        '<p style="margin:0;font-size:15px;opacity:.9">' +
        escapeHtml(message) +
        "</p>" +
        linkHtml +
        "</div>";
    }
    ensureOverlay();
  }

  function removeAuthGateOverlay() {
    try {
      var el = document.getElementById(OVERLAY_ID);
      if (el && el.parentNode) el.parentNode.removeChild(el);
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

  function hideShell(reason) {
    // Pending check: cover private UI without blanking the document.
    paintAuthGateOverlay({
      mode: "pending",
      title: "正在验证登录状态",
      message: "请稍候，正在确认会话…",
      reason: reason || "pending",
    });
  }

  function revealShell() {
    try {
      document.documentElement.removeAttribute("data-mcj-auth-gate");
      document.documentElement.removeAttribute("data-mcj-auth-reason");
      document.documentElement.style.visibility = "";
    } catch (e) {}
    removeAuthGateOverlay();
  }

  function deny(loginHref, reason) {
    var returnTo =
      String(location.pathname || "/") + String(location.search || "") + String(location.hash || "");
    rememberReturnTo(returnTo);
    paintAuthGateOverlay({
      mode: "redirect",
      loginHref: loginHref,
      title: "需要登录后继续",
      message: "未登录或登录已失效，正在前往登录页…",
      reason: reason || "unauthenticated",
    });
    // Prefer replace; keep visible link as WeChat / storage-failure fallback.
    try {
      location.replace(loginHref);
    } catch (eNav) {
      try {
        location.href = loginHref;
      } catch (eHref) {}
    }
    return false;
  }

  function classifyAuthFailure(access, refresh) {
    try {
      // Probe storage availability (private mode / WeChat ITP).
      var probeKey = "__mcj_auth_probe__";
      sessionStorage.setItem(probeKey, "1");
      sessionStorage.removeItem(probeKey);
    } catch (eStore) {
      return "storage_unavailable";
    }
    if (!looksLikeJwt(access) && !String(refresh || "").trim()) return "token_missing";
    if (looksLikeJwt(access) && !hasValidAccessJwt(access) && !String(refresh || "").trim()) {
      return "token_expired";
    }
    return "unauthenticated";
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
        return deny("/admin/login/", "role_mismatch");
      }
      if (!adminOkSoft || !adminRoleOk || !hasJwtOrRefresh(adminAccess, adminRefresh)) {
        return deny("/admin/login/", classifyAuthFailure(adminAccess, adminRefresh));
      }
      // Expired access JWT without refresh → login.
      if (looksLikeJwt(adminAccess) && !hasValidAccessJwt(adminAccess) && !String(adminRefresh || "").trim()) {
        return deny("/admin/login/", "token_expired");
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
        return deny("/login.html", classifyAuthFailure(applyBossAccess, applyBossRefresh));
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
        return deny("/companion/login/", classifyAuthFailure(pwAccess, pwRefresh));
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
      if (!csCredOk || !csRoleOk) {
        // Only wipe when credentials/role are actually invalid — keep healable JWT blob
        // if soft marker alone is missing (customer-service-auth can rebuild soft).
        ["mcjServiceSession", "customerServiceAuthToken", "customerServiceUser"].forEach(removeItem);
        return deny("/customer-service/login/", classifyAuthFailure(csAccess, csRefresh));
      }
      if (!csSoftOk) {
        // Soft marker missing but JWT/role OK — leave pending for module restore; do not wipe.
        hideShell("cs_soft_pending");
        return true;
      }
      revealShell();
      return true;
    }

    // —— Boss protected pages ——
    // Soft session alone NEVER unlocks. Non-expired access JWT unlocks immediately.
    // Expired access + refresh → keep pending overlay; role-gates/MCJBossAuth restores.
    // NOTE: profile.html is public companion detail — do NOT gate it.
    if (
      /\/(mine|orders|support|recharge|messages|favorites|payment-confirm|order-confirm|gifts)\.html$/i.test(
        p
      )
    ) {
      // P0: never clear body here — blank DOM was the white-screen trigger for guests
      // and for late-running scripts when body already existed.
      hideShell("boss_private_pending");
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
        return deny("/login.html", "role_mismatch");
      }
      var bossAccess = bossItem("mcjAuthAccessToken");
      var bossRefresh = bossItem("mcjAuthRefreshToken");
      if (hasValidAccessJwt(bossAccess)) {
        revealShell();
        return true;
      }
      // Token expired / missing access but refresh still present — do not wipe; let restore run.
      if (String(bossRefresh || "").trim()) {
        hideShell("pending_restore");
        return true;
      }
      wipeBossIdentity();
      return deny("/login.html", classifyAuthFailure(bossAccess, bossRefresh));
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
