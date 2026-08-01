(function () {
  "use strict";

  if (window.MCJServiceAuth) return;

  var SESSION_KEY = "mcjServiceSession";
  var REFRESH_BUFFER_MS = 90 * 1000;
  var EXPIRED_MESSAGE = "登录已过期，请重新登录。";
  var refreshPromise = null;
  var sessionReadyPromise = null;
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
      input.refreshToken || input.refresh_token || readItem("mcjAuthRefreshToken") || ""
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

  function persistAuthMirrors(session) {
    // Keep soft portal keys + shared auth mirrors in sync for role-gates / API.
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
      localStorage.setItem("mcjRole", "customer_service");
      if (session.token) localStorage.setItem("mcjAuthAccessToken", session.token);
      if (session.refreshToken) localStorage.setItem("mcjAuthRefreshToken", session.refreshToken);
      if (session.expiresAt != null && session.expiresAt !== "") {
        localStorage.setItem("mcjAuthExpiresAt", String(session.expiresAt));
      }
      sessionStorage.removeItem("customerServiceAuthToken");
      sessionStorage.removeItem("customerServiceUser");
    } catch (e) {}
  }

  function saveSession(input, remember) {
    var session = normalizeSession(input, remember !== false);
    if (!session) return null;
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
      "mcjAuthAccessToken",
      "mcjAuthRefreshToken",
      "mcjAuthExpiresAt",
    ].forEach(function (key) {
      try {
        localStorage.removeItem(key);
        sessionStorage.removeItem(key);
      } catch (e) {}
    });
    try {
      if (localStorage.getItem("mcjRole") === "customer_service") {
        localStorage.removeItem("mcjRole");
      }
      if (sessionStorage.getItem("mcjRole") === "customer_service") {
        sessionStorage.removeItem("mcjRole");
      }
    } catch (e) {}
    emit("SIGNED_OUT", { reason: reason || "logout" });
  }

  function getAccessToken() {
    var s = readRaw();
    return String((s && (s.token || s.accessToken)) || readItem("mcjAuthAccessToken") || "").trim();
  }

  function getRefreshToken() {
    var s = readRaw();
    return String((s && (s.refreshToken || s.refresh_token)) || readItem("mcjAuthRefreshToken") || "").trim();
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
      var user = JSON.parse(localStorage.getItem("customerServiceUser") || "null");
      var role = String((user && (user.role || user.user_role)) || "").toLowerCase();
      if (role === "customer_service" || role === "service") return true;
    } catch (e) {}
    try {
      var shared = String(localStorage.getItem("mcjAuthRole") || "").toLowerCase();
      if (shared === "customer_service" || shared === "service") return true;
    } catch (e2) {}
    return false;
  }

  /** CS session only — never treat boss/admin shared tokens as logged-in CS. */
  function hasSession() {
    var blob = readRaw();
    if (blob && (blob.token || blob.accessToken || blob.access_token)) return true;
    // Shared mirrors only count when role is explicitly customer_service.
    if (hasCsRoleHint() && (getAccessToken() || getRefreshToken())) return true;
    return false;
  }

  function needsRefresh() {
    var access = getAccessToken();
    var refresh = getRefreshToken();
    if (!access && refresh) return true;
    if (!access) return false;
    var exp = getExpiresAtMs();
    if (!exp) return false;
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
    sessionReadyPromise = getSession().then(function (result) {
      if (!hasSession()) return result;
      if (!needsRefresh()) return result;
      return refreshSession().then(function () {
        return getSession();
      });
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

  function redirectToLogin(returnTo) {
    try {
      if (returnTo) sessionStorage.setItem("mcjAfterLoginRedirect", returnTo);
    } catch (e) {}
    location.replace("/customer-service/login/");
  }

  /**
   * Gate CS pages: wait for session restore/refresh before deciding redirect.
   * Never bounce to login solely because init is still in flight.
   */
  function revealCsPage() {
    try {
      document.documentElement.setAttribute("data-mcj-service-auth", "ready");
      document.documentElement.style.visibility = "";
    } catch (e) {}
  }

  function guardCustomerServicePages() {
    var path = String(location.pathname || "").replace(/\\/g, "/");
    if (!/\/customer-service(\/|$)/i.test(path)) return Promise.resolve(true);
    if (/\/customer-service\/login/i.test(path)) {
      return ensureSession()
        .then(function () {
          if (hasSession()) {
            location.replace("/customer-service/dashboard/");
            return false;
          }
          revealCsPage();
          return true;
        })
        .catch(function () {
          revealCsPage();
          return true;
        });
    }
    try {
      document.documentElement.setAttribute("data-mcj-service-auth", "pending");
      document.documentElement.style.visibility = "hidden";
    } catch (e) {}
    // Never leave the page permanently black if refresh hangs.
    var safety = setTimeout(function () {
      if (!hasSession()) {
        revealCsPage();
        redirectToLogin(path + String(location.search || "") + String(location.hash || ""));
      } else {
        revealCsPage();
      }
    }, 8000);
    return ensureSession()
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
      });
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
