(function () {
  "use strict";

  if (window.MCJServiceAuth) return;

  var SESSION_KEY = "mcjServiceSession";
  var REFRESH_BUFFER_MS = 90 * 1000;
  var EXPIRED_MESSAGE = "登录已过期，请重新登录。";
  var refreshPromise = null;
  var sessionReadyPromise = null;
  var guardPromise = null;
  var listeners = [];

  function readRaw() {
    try {
      return JSON.parse(
        localStorage.getItem(SESSION_KEY) || sessionStorage.getItem(SESSION_KEY) || "null"
      );
    } catch (e) {
      return null;
    }
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

  function normalizeSession(input, remember) {
    if (!input || typeof input !== "object") return null;
    var token = String(input.token || input.accessToken || input.access_token || "").trim();
    var refreshToken = String(
      input.refreshToken || input.refresh_token || ""
    ).trim();
    if (!token && !refreshToken) return null;
    var expiresAt = input.expiresAt != null ? input.expiresAt : input.expires_at;
    if (expiresAt == null || expiresAt === "") {
      var expMs = decodeJwtExpMs(token);
      expiresAt = expMs ? Math.floor(expMs / 1000) : "";
    }
    var user = input.user || {};
    return {
      token: token,
      accessToken: token,
      refreshToken: refreshToken,
      expiresAt: expiresAt,
      user: user,
      remember: remember !== false && input.remember !== false,
    };
  }

  function readItem(key) {
    return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
  }

  function clearForeignRoleSessions() {
    // Portal isolation: CS login must NOT wipe boss/companion sessions.
    if (window.MCJRoleGate && typeof window.MCJRoleGate.clearOtherRoleSessions === "function") {
      window.MCJRoleGate.clearOtherRoleSessions("customer_service");
      return;
    }
  }

  function persistAuthMirrors(session) {
    // Soft portal keys only — never overwrite boss mcjAuth*.
    var soft = "customer_service_session_v4_" + Date.now();
    try {
      localStorage.setItem("customerServiceAuthToken", soft);
      localStorage.setItem(
        "customerServiceUser",
        JSON.stringify(
          Object.assign({}, session.user || {}, {
            role: (session.user && session.user.role) || "customer_service",
          })
        )
      );
      sessionStorage.setItem("customerServiceAuthToken", soft);
      sessionStorage.setItem(
        "customerServiceUser",
        JSON.stringify(
          Object.assign({}, session.user || {}, {
            role: (session.user && session.user.role) || "customer_service",
          })
        )
      );
    } catch (e) {}
  }

  function saveSession(input, remember) {
    var session = normalizeSession(input, remember !== false);
    if (!session) return null;
    clearForeignRoleSessions();
    // P0: always persist to localStorage so refresh + new tabs keep login.
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    } catch (e) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      } catch (err) {}
    }
    persistAuthMirrors(session);
    emit("SIGNED_IN", session);
    return session;
  }

  function clearSession(reason) {
    [
      SESSION_KEY,
      "customerServiceAuthToken",
      "customerServiceUser",
    ].forEach(function (key) {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (e) {}
    });
    emit("SIGNED_OUT", { reason: reason || "logout" });
  }

  function getAccessToken() {
    var s = readRaw();
    return String((s && (s.token || s.accessToken)) || "").trim();
  }

  function getRefreshToken() {
    var s = readRaw();
    return String((s && (s.refreshToken || s.refresh_token)) || "").trim();
  }

  function getExpiresAtMs() {
    var s = readRaw();
    var raw = (s && (s.expiresAt != null ? s.expiresAt : s.expires_at)) || readItem("mcjAuthExpiresAt");
    if (raw !== "" && raw != null) {
      var n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
    }
    return decodeJwtExpMs(getAccessToken());
  }

  function hasCsRoleHint() {
    try {
      var user = JSON.parse(
        localStorage.getItem("customerServiceUser") || sessionStorage.getItem("customerServiceUser") || "null"
      );
      var role = String((user && (user.role || user.user_role)) || "").toLowerCase();
      if (role === "customer_service" || role === "service") return true;
    } catch (e) {}
    try {
      var shared = String(localStorage.getItem("mcjRole") || sessionStorage.getItem("mcjRole") || "").toLowerCase();
      if (shared === "customer_service" || shared === "service") return true;
    } catch (e2) {}
    return false;
  }

  function looksLikeJwt(token) {
    var access = String(token || "").trim();
    return (
      access.length >= 20 &&
      access.split(".").length === 3 &&
      access.split(".").every(function (p) {
        return p.length > 0;
      })
    );
  }

  /** Heal soft/mirror leftovers into mcjServiceSession so login↔dashboard never loop. */
  function healSessionBlobIfNeeded() {
    var blob = readRaw();
    var blobAccess = String((blob && (blob.token || blob.accessToken || blob.access_token)) || "").trim();
    var blobRefresh = String((blob && (blob.refreshToken || blob.refresh_token)) || "").trim();
    if (blob && (looksLikeJwt(blobAccess) || blobRefresh)) return blob;
    // Never heal CS session from boss mcjAuth* — that caused cross-portal inheritance.
    return blob;
  }

  /** CS session only — require portal blob (after heal). Soft mirrors alone never unlock. */
  function hasSession() {
    healSessionBlobIfNeeded();
    var blob = readRaw();
    if (!blob) return false;
    var access = String(blob.token || blob.accessToken || blob.access_token || "").trim();
    var refresh = String(blob.refreshToken || blob.refresh_token || "").trim();
    if (!looksLikeJwt(access) && !refresh) return false;
    if (!hasCsRoleHint()) {
      var softHint = readItem("customerServiceAuthToken");
      if (String(softHint).indexOf("customer_service_session_") !== 0) return false;
    }
    // Keep soft portal token in sync with early-gate (missing soft ⇒ login↔dashboard bounce).
    var soft = readItem("customerServiceAuthToken");
    if (String(soft).indexOf("customer_service_session_") !== 0) {
      try {
        persistAuthMirrors(
          normalizeSession(blob, true) || {
            token: access,
            refreshToken: refresh,
            expiresAt: (blob && (blob.expiresAt != null ? blob.expiresAt : blob.expires_at)) || "",
            user: (blob && blob.user) || {},
          }
        );
      } catch (e) {}
      soft = readItem("customerServiceAuthToken");
      if (String(soft).indexOf("customer_service_session_") !== 0) return false;
    }
    return true;
  }

  function needsRefresh() {
    var access = getAccessToken();
    var refresh = getRefreshToken();
    if (!access && refresh) return true;
    if (!access) return false;
    // Unparseable / non-expiring access token with a refresh token must be rotated
    // (avoids treating garbage JWT as a valid logged-in session).
    var exp = getExpiresAtMs();
    if (!exp) return !!refresh;
    return Date.now() >= exp - REFRESH_BUFFER_MS;
  }

  function getSession() {
    return Promise.resolve().then(function () {
      var session = normalizeSession(readRaw(), true);
      if (!session && hasSession()) {
        session = normalizeSession(
          {
            token: getAccessToken(),
            refreshToken: getRefreshToken(),
            expiresAt: readItem("mcjAuthExpiresAt"),
            user: (function () {
              try {
                return JSON.parse(localStorage.getItem("customerServiceUser") || "{}");
              } catch (e) {
                return {};
              }
            })(),
          },
          true
        );
      }
      if (session && (!session.token || !session.refreshToken) && hasSession()) {
        // Heal incomplete portal blob from shared mirrors.
        session = saveSession(
          {
            token: session.token || getAccessToken(),
            refreshToken: session.refreshToken || getRefreshToken(),
            expiresAt: session.expiresAt || readItem("mcjAuthExpiresAt"),
            user: session.user || {},
          },
          true
        );
      }
      return { data: { session: session }, error: null };
    });
  }

  function refreshSession() {
    if (refreshPromise) return refreshPromise;
    var refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearSession("no_refresh_token");
      return Promise.reject(new Error(EXPIRED_MESSAGE));
    }
    refreshPromise = fetch("/api/auth", {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ action: "refresh", refreshToken: refreshToken }),
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body || !body.ok || !body.session || !body.session.accessToken) {
            clearSession("refresh_failed");
            throw new Error((body && body.message) || EXPIRED_MESSAGE);
          }
          var prev = readRaw() || {};
          var next = saveSession(
            {
              token: body.session.accessToken,
              refreshToken: body.session.refreshToken || refreshToken,
              expiresAt: body.session.expiresAt,
              user: body.session.user || prev.user || {},
            },
            true
          );
          emit("TOKEN_REFRESHED", next);
          return { data: { session: next }, error: null };
        });
      })
      .catch(function (err) {
        clearSession("refresh_error");
        throw new Error(EXPIRED_MESSAGE);
      })
      .finally(function () {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  function ensureSession() {
    if (sessionReadyPromise) return sessionReadyPromise;
    sessionReadyPromise = getSession()
      .then(function (result) {
        if (!hasSession()) return result;
        if (!needsRefresh()) return result;
        return refreshSession().then(function () {
          return getSession();
        });
      })
      .finally(function () {
        sessionReadyPromise = null;
      });
    return sessionReadyPromise;
  }

  function emit(event, session) {
    listeners.slice().forEach(function (fn) {
      try {
        fn(event, session);
      } catch (e) {}
    });
    try {
      window.dispatchEvent(
        new CustomEvent("mcj:service-auth", { detail: { event: event, session: session } })
      );
    } catch (e) {}
  }

  function onAuthStateChange(callback) {
    if (typeof callback !== "function") return function () {};
    listeners.push(callback);
    return function () {
      listeners = listeners.filter(function (fn) {
        return fn !== callback;
      });
    };
  }

  function authHeaders(extra) {
    var headers = Object.assign({ Accept: "application/json" }, extra || {});
    var token = getAccessToken();
    if (token) {
      headers.Authorization = "Bearer " + token;
      headers["x-mcj-service-token"] = token;
    }
    return headers;
  }

  function isAuthUnauthorized(status, message) {
    if (Number(status) === 401) return true;
    var text = String(message || "").toLowerCase();
    return (
      text.indexOf("登录已过期") > -1 ||
      text.indexOf("请先登录") > -1 ||
      text.indexOf("jwt") > -1 ||
      text.indexOf("token is expired") > -1 ||
      text.indexOf("invalid jwt") > -1
    );
  }

  function authFetch(url, init, retried) {
    init = init || {};
    return ensureSession()
      .then(function () {
        if (!hasSession()) throw new Error("请先登录客服端。");
        var headers = authHeaders(init.headers || {});
        return fetch(url, Object.assign({}, init, { headers: headers, cache: init.cache || "no-store" }));
      })
      .then(function (res) {
        return res.text().then(function (text) {
          var body = {};
          try {
            body = text ? JSON.parse(text) : {};
          } catch (e) {
            body = { message: text || "请求失败" };
          }
          var message = body.message || "请求失败";
          if ((!res.ok || body.ok === false) && !retried && isAuthUnauthorized(res.status, message)) {
            return refreshSession()
              .then(function () {
                return authFetch(url, init, true);
              })
              .catch(function () {
                clearSession("api_unauthorized");
                throw new Error(EXPIRED_MESSAGE);
              });
          }
          if (!res.ok || body.ok === false) {
            var err = new Error(message);
            err.status = res.status;
            throw err;
          }
          return body;
        });
      });
  }

  function revealCsPage() {
    try {
      document.documentElement.setAttribute("data-mcj-service-auth", "ready");
      document.documentElement.style.visibility = "";
      document.documentElement.removeAttribute("data-mcj-auth-gate");
      document.documentElement.removeAttribute("data-mcj-auth-reason");
      var overlay = document.getElementById("mcjAuthBootOverlay");
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
    } catch (e) {}
  }

  function showCsPendingGate() {
    try {
      document.documentElement.setAttribute("data-mcj-service-auth", "pending");
      document.documentElement.setAttribute("data-mcj-auth-gate", "pending");
      document.documentElement.setAttribute("data-mcj-auth-reason", "pending_restore");
      // P0: never blank with visibility:hidden — show a visible verifying overlay.
      document.documentElement.style.visibility = "";
    } catch (e) {}
    function paint() {
      var body = document.body;
      if (!body) {
        document.addEventListener("DOMContentLoaded", paint, { once: true });
        return;
      }
      var el = document.getElementById("mcjAuthBootOverlay");
      if (!el) {
        el = document.createElement("div");
        el.id = "mcjAuthBootOverlay";
        body.appendChild(el);
      }
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;" +
        "padding:24px;box-sizing:border-box;background:#0f1115;color:#f5f5f5;font-family:system-ui,-apple-system,sans-serif;" +
        "visibility:visible!important;opacity:1!important;";
      el.innerHTML =
        '<div style="max-width:360px;text-align:center;line-height:1.5">' +
        '<h1 style="margin:0 0 12px;font-size:20px;font-weight:700">正在验证登录状态</h1>' +
        '<p style="margin:0;font-size:15px;opacity:.9">请稍候，正在确认客服会话…</p></div>';
    }
    paint();
  }

  function redirectToLogin(returnTo) {
    try {
      if (returnTo) sessionStorage.setItem("mcjAfterLoginRedirect", returnTo);
    } catch (e) {
      try {
        if (returnTo) localStorage.setItem("mcjAfterLoginRedirect", returnTo);
      } catch (e2) {}
    }
    var href = "/customer-service/login/";
    try {
      document.documentElement.setAttribute("data-mcj-auth-gate", "1");
      document.documentElement.style.visibility = "";
    } catch (eGate) {}
    function paint() {
      var body = document.body;
      if (!body) {
        document.addEventListener("DOMContentLoaded", paint, { once: true });
        return;
      }
      var el = document.getElementById("mcjAuthBootOverlay");
      if (!el) {
        el = document.createElement("div");
        el.id = "mcjAuthBootOverlay";
        body.appendChild(el);
      }
      el.innerHTML =
        '<div style="max-width:360px;text-align:center;line-height:1.5;color:#f5f5f5;font-family:system-ui,-apple-system,sans-serif">' +
        '<h1 style="margin:0 0 12px;font-size:20px">需要登录后继续</h1>' +
        '<p style="margin:0;font-size:15px;opacity:.9">未登录或登录已失效，正在前往登录页…</p>' +
        '<p style="margin:20px 0 0"><a href="' +
        href +
        '" style="color:#7dd3fc;font-size:16px;font-weight:600">点击前往登录</a></p></div>';
      el.style.cssText =
        "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;" +
        "padding:24px;box-sizing:border-box;background:#0f1115;visibility:visible!important";
    }
    paint();
    try {
      location.replace(href);
    } catch (eNav) {
      try {
        location.href = href;
      } catch (eHref) {}
    }
  }

  /**
   * Gate CS pages: wait for session restore/refresh before deciding redirect.
   * Never bounce to login solely because init is still in flight.
   */
  function guardCustomerServicePages() {
    if (guardPromise) return guardPromise;
    var path = String(location.pathname || "").replace(/\\/g, "/");
    if (!/\/customer-service(\/|$)/i.test(path)) return Promise.resolve(true);
    if (/\/customer-service\/login/i.test(path)) {
      // Login surface must stay put — never auto-bounce to dashboard here.
      // (Dual redirects from role-gates + login script caused infinite flicker.)
      if (window.__MCJCsLoginRedirecting) {
        revealCsPage();
        return Promise.resolve(false);
      }
      guardPromise = Promise.resolve()
        .then(function () {
          revealCsPage();
          return true;
        })
        .finally(function () {
          guardPromise = null;
        });
      return guardPromise;
    }
    showCsPendingGate();
    // Never leave the page permanently blank if refresh hangs.
    var safety = setTimeout(function () {
      if (!hasSession()) {
        revealCsPage();
        redirectToLogin(path + String(location.search || "") + String(location.hash || ""));
      } else {
        revealCsPage();
      }
    }, 8000);
    guardPromise = ensureSession()
      .then(function () {
        clearTimeout(safety);
        if (hasSession()) {
          revealCsPage();
          return true;
        }
        revealCsPage();
        redirectToLogin(path + String(location.search || "") + String(location.hash || ""));
        return false;
      })
      .catch(function () {
        clearTimeout(safety);
        if (hasSession()) {
          revealCsPage();
          return true;
        }
        revealCsPage();
        redirectToLogin(path + String(location.search || "") + String(location.hash || ""));
        return false;
      })
      .finally(function () {
        guardPromise = null;
      });
    return guardPromise;
  }

  window.MCJServiceAuth = {
    SESSION_KEY: SESSION_KEY,
    getSession: getSession,
    refreshSession: refreshSession,
    ensureSession: ensureSession,
    saveSession: saveSession,
    clearSession: clearSession,
    hasSession: hasSession,
    getAccessToken: getAccessToken,
    authHeaders: authHeaders,
    authFetch: authFetch,
    onAuthStateChange: onAuthStateChange,
    guardCustomerServicePages: guardCustomerServicePages,
    redirectToLogin: redirectToLogin,
    expiredMessage: EXPIRED_MESSAGE,
  };
})();
