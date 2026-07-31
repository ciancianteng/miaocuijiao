(function () {
  "use strict";

  if (window.MCJBossAuth) return;

  var REFRESH_BUFFER_MS = 60 * 1000;
  var EXPIRED_MESSAGE = "登录已过期，请重新登录。";
  var refreshPromise = null;
  var sessionReadyPromise = null;

  function readItem(key) {
    return localStorage.getItem(key) || sessionStorage.getItem(key) || "";
  }

  function authStore() {
    if (localStorage.getItem("mcjAuthAccessToken")) return localStorage;
    if (sessionStorage.getItem("mcjAuthAccessToken")) return sessionStorage;
    return localStorage;
  }

  function getAccessToken() {
    return readItem("mcjAuthAccessToken");
  }

  function getRefreshToken() {
    return readItem("mcjAuthRefreshToken");
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

  function getExpiresAtMs() {
    var raw = readItem("mcjAuthExpiresAt");
    if (raw) {
      var n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n < 1e12 ? n * 1000 : n;
    }
    return decodeJwtExpMs(getAccessToken());
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

  function saveSession(session) {
    if (!session) return;
    var store = authStore();
    if (session.accessToken) store.setItem("mcjAuthAccessToken", session.accessToken);
    if (session.refreshToken) store.setItem("mcjAuthRefreshToken", session.refreshToken);
    if (session.expiresAt != null && session.expiresAt !== "") {
      store.setItem("mcjAuthExpiresAt", String(session.expiresAt));
    }
  }

  function clearSession() {
    [
      "mcjAuthAccessToken",
      "mcjAuthRefreshToken",
      "mcjAuthExpiresAt",
    ].forEach(function (key) {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    });
    try {
      window.dispatchEvent(new CustomEvent("mcj:auth-expired"));
    } catch (e) {}
  }

  function hasSession() {
    return !!(getAccessToken() || getRefreshToken());
  }

  /** Equivalent to supabase.auth.getSession() via local /api auth session. */
  function getSession() {
    return Promise.resolve().then(function () {
      if (!hasSession()) {
        return { data: { session: null }, error: null };
      }
      var expMs = getExpiresAtMs();
      return {
        data: {
          session: {
            expires_at: expMs ? Math.floor(expMs / 1000) : null,
          },
        },
        error: null,
      };
    });
  }

  /** Equivalent to supabase.auth.refreshSession() via /api/auth. */
  function refreshSession() {
    if (refreshPromise) return refreshPromise;
    var refreshToken = getRefreshToken();
    if (!refreshToken) {
      clearSession();
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
            clearSession();
            throw new Error((body && body.message) || EXPIRED_MESSAGE);
          }
          saveSession(body.session);
          return { data: { session: { expires_at: body.session.expiresAt || null } }, error: null };
        });
      })
      .catch(function (err) {
        clearSession();
        throw new Error(EXPIRED_MESSAGE);
      })
      .finally(function () {
        refreshPromise = null;
      });
    return refreshPromise;
  }

  /** Wait for getSession, then refreshSession when near expiry. */
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

  function authHeaders(extra) {
    var headers = Object.assign({ Accept: "application/json" }, extra || {});
    var token = getAccessToken();
    if (token) {
      headers.Authorization = "Bearer " + token;
      headers["x-mcj-access-token"] = token;
    }
    return headers;
  }

  function isAuthUnauthorized(status, message) {
    if (Number(status) === 401) return true;
    var text = String(message || "").toLowerCase();
    return (
      text.indexOf("登录已过期") > -1 ||
      text.indexOf("jwt") > -1 ||
      text.indexOf("token is expired") > -1 ||
      text.indexOf("invalid claims") > -1 ||
      text.indexOf("unable to parse or verify signature") > -1
    );
  }

  function authFetch(url, init, retried) {
    init = init || {};
    return ensureSession()
      .then(function () {
        if (!hasSession()) throw new Error("请先登录");
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
                clearSession();
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

  window.MCJBossAuth = {
    getSession: getSession,
    refreshSession: refreshSession,
    ensureSession: ensureSession,
    authFetch: authFetch,
    authHeaders: authHeaders,
    clearSession: clearSession,
    hasSession: hasSession,
    expiredMessage: EXPIRED_MESSAGE,
  };
})();
